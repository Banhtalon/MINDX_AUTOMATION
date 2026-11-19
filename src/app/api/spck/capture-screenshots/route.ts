import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  spckSessionRepo,
  spckUploadRepo,
  type SpckSessionNumber,
} from "@/lib/db/sqlite";
import {
  captureClassAppScreenshotsAndSelectThumbnails,
  isOwnerUploadImageActive,
  OWNER_UPLOADS_SUBDIR,
} from "@/lib/local-files/spck-app-screenshotter";
import {
  assertSafeRealDirectory,
  deactivateGdriveThumbnailForStudent,
  MAX_DRIVE_THUMBNAIL_BYTES,
  validateDownloadedDriveImageBuffer,
} from "@/lib/google-drive/spck-drive-thumbnails";
import {
  DEFAULT_SPCK_THUMBNAIL_PATH,
  MAX_SPCK_SCREENSHOTS,
} from "@/lib/local-files/spck-scanner";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { assertPathAllowed } from "@/lib/security/path-allowlist";
import { SequentialTaskQueue } from "@/lib/queue/task-queue";
import { buildEnrichedClassSpckRecords } from "../list/route";

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const classId = String(body?.classId || "").trim().toUpperCase();
    const action = String(body?.action || "capture").trim();
    const rawSession = Number(body?.sessionNumber);
    const activeSessionNumber: SpckSessionNumber | undefined =
      rawSession === 12 || rawSession === 13 || rawSession === 14
        ? (rawSession as SpckSessionNumber)
        : undefined;

    if (!classId) {
      return NextResponse.json(
        {
          success: false,
          error: "Thiếu mã lớp (classId).",
        },
        { status: 400 }
      );
    }

    // Action 1: Owner uploads custom image(s) for Thumbnail or Gallery
    if (action === "upload_owner_image") {
      const studentId = String(body?.studentId || "").trim();
      const role = body?.role === "gallery" ? "gallery" : "thumbnail";
      const files: Array<{ fileName: string; dataUrl: string }> = Array.isArray(
        body?.files
      )
        ? body.files
        : [];

      if (!studentId || files.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: "Thiếu mã học viên (studentId) hoặc danh sách ảnh tải lên.",
          },
          { status: 400 }
        );
      }

      if (
        (role === "gallery" && files.length > MAX_SPCK_SCREENSHOTS) ||
        (role === "thumbnail" && files.length - 1 > MAX_SPCK_SCREENSHOTS)
      ) {
        return NextResponse.json(
          {
            success: false,
            error: `Số lượng ảnh bổ sung vượt giới hạn LMS (${files.length}/${MAX_SPCK_SCREENSHOTS} ảnh). Vui lòng chọn tối đa ${MAX_SPCK_SCREENSHOTS} ảnh.`,
          },
          { status: 400 }
        );
      }

      const existing = spckUploadRepo.findOne(classId, studentId);
      if (!existing || !existing.localFolderPath) {
        return NextResponse.json(
          {
            success: false,
            error: "Chưa tìm thấy thư mục sản phẩm của học viên này.",
          },
          { status: 404 }
        );
      }

      let currentScreenshots: string[] = [];
      try {
        const parsed = JSON.parse(existing.screenshotsJson || "[]");
        if (Array.isArray(parsed)) {
          currentScreenshots = parsed.filter((p: unknown) => {
            const str = String(p || "").trim();
            if (!str) return false;
            if (/[\\/]_spck_owner_uploads[\\/]/i.test(str)) {
              return isOwnerUploadImageActive(str);
            }
            return true;
          });
        }
      } catch {
        currentScreenshots = [];
      }

      const validUploadPayloads: Array<{ outName: string; buf: Buffer }> = [];
      const maxEncodedLen = Math.ceil(MAX_DRIVE_THUMBNAIL_BYTES * 1.4) + 512;
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const rawName = String(f?.fileName || `owner_image_${i}.png`);
        const ext = path.extname(rawName).toLowerCase() || ".png";
        if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
          return NextResponse.json(
            {
              success: false,
              error: `Định dạng ảnh '${rawName}' không được hỗ trợ. Chỉ chấp nhận .png, .jpg, .jpeg, .webp.`,
            },
            { status: 400 }
          );
        }
        const dataUrl = String(f?.dataUrl || "");
        if (dataUrl.length > maxEncodedLen) {
          return NextResponse.json(
            {
              success: false,
              error: `Tệp ảnh '${rawName}' vượt quá giới hạn dung lượng 20MB.`,
            },
            { status: 400 }
          );
        }
        const commaIdx = dataUrl.indexOf(",");
        const base64 = commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : dataUrl;
        const buf = Buffer.from(base64, "base64");
        if (buf.length > MAX_DRIVE_THUMBNAIL_BYTES) {
          return NextResponse.json(
            {
              success: false,
              error: `Tệp ảnh '${rawName}' vượt quá giới hạn dung lượng 20MB.`,
            },
            { status: 400 }
          );
        }
        const imgCheck = validateDownloadedDriveImageBuffer(buf, rawName);
        if (!imgCheck.valid || !imgCheck.detectedExt) {
          return NextResponse.json(
            {
              success: false,
              error:
                imgCheck.reason ||
                `Tệp ảnh '${rawName}' không đúng cấu trúc ảnh hợp lệ (.png/.jpg/.webp).`,
            },
            { status: 400 }
          );
        }
        const safeBase =
          path
            .basename(rawName, ext)
            .replace(/[^a-zA-Z0-9_-]+/g, "_")
            .slice(0, 40) || "owner_img";
        const prefix = role === "thumbnail" ? "thumb_" : "owner_";
        const outName = `${prefix}${Date.now()}_${i}_${safeBase}${imgCheck.detectedExt}`;
        validUploadPayloads.push({ outName, buf });
      }

      if (validUploadPayloads.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: "Không có tệp hình ảnh hợp lệ (.png, .jpg, .webp) để lưu.",
          },
          { status: 400 }
        );
      }

      const safeStudentDir = assertSafeRealDirectory(
        assertPathAllowed(existing.localFolderPath)
      );
      const ownerDir = assertSafeRealDirectory(
        assertPathAllowed(path.join(safeStudentDir, OWNER_UPLOADS_SUBDIR)),
        safeStudentDir
      );
      const candidatePaths = validUploadPayloads.map((item) =>
        assertPathAllowed(path.join(ownerDir, item.outName))
      );

      let newThumbnailPath = existing.thumbnailPath || DEFAULT_SPCK_THUMBNAIL_PATH;
      let newScreenshots = [...currentScreenshots];

      if (role === "thumbnail") {
        const prevThumb = existing.thumbnailPath;
        newThumbnailPath = candidatePaths[0];
        if (
          prevThumb &&
          prevThumb !== DEFAULT_SPCK_THUMBNAIL_PATH &&
          prevThumb !== newThumbnailPath &&
          !/[\\/]_spck_owner_uploads[\\/]thumb_gdrive_/i.test(prevThumb) &&
          !newScreenshots.includes(prevThumb)
        ) {
          newScreenshots = [prevThumb, ...newScreenshots];
        }
        for (const extra of candidatePaths.slice(1)) {
          if (!newScreenshots.includes(extra)) {
            newScreenshots = [extra, ...newScreenshots];
          }
        }
      } else {
        for (const p of candidatePaths) {
          if (p !== newThumbnailPath && !newScreenshots.includes(p)) {
            newScreenshots = [p, ...newScreenshots];
          }
        }
      }

      newScreenshots = newScreenshots.filter((p) => p !== newThumbnailPath);

      if (newScreenshots.length > MAX_SPCK_SCREENSHOTS) {
        const isBotGeneratedShot = (p: string) =>
          /[\\/](?:_spck_app_shots|_spck_youtube_frames)[\\/]/i.test(p);
        const nonBotShots = newScreenshots.filter((p) => !isBotGeneratedShot(p));
        const botShots = newScreenshots.filter((p) => isBotGeneratedShot(p));
        if (botShots.length > 0 && nonBotShots.length <= MAX_SPCK_SCREENSHOTS) {
          const remainingSlots = Math.max(0, MAX_SPCK_SCREENSHOTS - nonBotShots.length);
          newScreenshots = [...nonBotShots, ...botShots.slice(0, remainingSlots)];
        }
      }

      if (newScreenshots.length > MAX_SPCK_SCREENSHOTS) {
        return NextResponse.json(
          {
            success: false,
            error: `Số lượng ảnh bổ sung vượt giới hạn LMS (${newScreenshots.length}/${MAX_SPCK_SCREENSHOTS} ảnh). Vui lòng chọn tối đa ${MAX_SPCK_SCREENSHOTS} ảnh.`,
          },
          { status: 400 }
        );
      }

      if (!fs.existsSync(ownerDir)) {
        fs.mkdirSync(ownerDir, { recursive: true });
      }
      assertSafeRealDirectory(ownerDir, safeStudentDir);
      const savedPaths: string[] = [];
      for (let i = 0; i < validUploadPayloads.length; i++) {
        const outPath = candidatePaths[i];
        if (fs.lstatSync(outPath, { throwIfNoEntry: false })?.isSymbolicLink()) {
          fs.unlinkSync(outPath);
        }
        fs.writeFileSync(outPath, validUploadPayloads[i].buf);
        savedPaths.push(outPath);
      }

      const upd = spckUploadRepo.updateSharedResources(
        classId,
        studentId,
        {
          thumbnailPath: newThumbnailPath,
          screenshotsJson: JSON.stringify(newScreenshots),
        },
        existing.localFolderPath
      );
      if (!upd.updated) {
        for (const sp of savedPaths) {
          try {
            if (fs.existsSync(sp) && !fs.lstatSync(sp).isSymbolicLink()) {
              fs.unlinkSync(sp);
            }
          } catch {}
        }
        return NextResponse.json(
          {
            success: false,
            error: upd.reason || "Không thể cập nhật ảnh tải lên vào cơ sở dữ liệu.",
          },
          { status: 409 }
        );
      }

      if (role === "thumbnail") {
        deactivateGdriveThumbnailForStudent({
          classId,
          studentId,
          ownerDir,
          expectedParentRealDir: safeStudentDir,
          forceOverwriteSessionNumber: activeSessionNumber,
        });
      }

      // If teacher explicitly uploaded an image while viewing a specific session, also sync into that active session draft if requested
      if (activeSessionNumber && body?.syncActiveSession !== false) {
        spckSessionRepo.syncLatestSharedResourcesToSessionDraft(
          classId,
          studentId,
          activeSessionNumber
        );
      }

      const updatedRecords = buildEnrichedClassSpckRecords(classId, activeSessionNumber);
      return NextResponse.json({
        success: true,
        savedPaths,
        records: updatedRecords,
      });
    }

    // Action 2 (default): Auto-capture app screenshots & AI selects best Thumbnail
    const studentIds: string[] | undefined = Array.isArray(body?.studentIds)
      ? body.studentIds.map((id: any) => String(id).trim()).filter(Boolean)
      : body?.studentId
      ? [String(body.studentId).trim()]
      : undefined;

    const batchResult = await SequentialTaskQueue.getInstance().enqueue({
      id: `spck_shots_${classId}_${Date.now()}`,
      jobType: "UPLOAD_SPCK",
      classId,
      description: `Chụp ảnh giao diện SPCK cho lớp ${classId}`,
      execute: async () =>
        captureClassAppScreenshotsAndSelectThumbnails({
          classId,
          studentIds,
          useAiVision: body?.useAiVision !== false,
          preferDefaultLogoWhenNoOwnerPhoto: Boolean(
            body?.preferDefaultLogoWhenNoOwnerPhoto
          ),
          sessionNumber: body?.syncActiveSession !== false ? activeSessionNumber : undefined,
        }),
    });

    const updatedRecords = buildEnrichedClassSpckRecords(classId, activeSessionNumber);
    const dedupedByStudent = new Map<string, (typeof batchResult.results)[number]>();
    for (const item of batchResult.results || []) {
      const sid = String(item?.studentId || "").trim();
      if (!sid) continue;
      const existingItem = dedupedByStudent.get(sid);
      if (!existingItem || Boolean(item.error)) {
        dedupedByStudent.set(sid, item);
      }
    }
    const allResults = Array.from(dedupedByStudent.values());
    const normalizedBatchResult = {
      ...batchResult,
      totalProcessed: allResults.length,
      results: allResults,
    };
    const failedItems = allResults.filter((r) => Boolean(r.error));
    const succeededCount = allResults.length - failedItems.length;
    if (failedItems.length > 0 && succeededCount === 0) {
      return NextResponse.json(
        {
          success: false,
          error: failedItems.map((r) => `[${r.studentId}]: ${r.error}`).join(" | "),
          failedItems,
          batchResult: normalizedBatchResult,
          records: updatedRecords,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      partialFailure: failedItems.length > 0,
      failedItems: failedItems.length > 0 ? failedItems : undefined,
      warning:
        failedItems.length > 0
          ? failedItems.map((r) => `[${r.studentId}]: ${r.error}`).join(" | ")
          : undefined,
      batchResult: normalizedBatchResult,
      records: updatedRecords,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("[Security]") ? 403 : 500;
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status }
    );
  }
}
