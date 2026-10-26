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
  OWNER_UPLOADS_SUBDIR,
} from "@/lib/local-files/spck-app-screenshotter";
import {
  DEFAULT_SPCK_THUMBNAIL_PATH,
  MAX_SPCK_SCREENSHOTS,
} from "@/lib/local-files/spck-scanner";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { assertPathAllowed } from "@/lib/security/path-allowlist";
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
        if (Array.isArray(parsed)) currentScreenshots = parsed;
      } catch {
        currentScreenshots = [];
      }

      const validUploadPayloads: Array<{ outName: string; buf: Buffer }> = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const rawName = String(f?.fileName || `owner_image_${i}.png`);
        const ext = path.extname(rawName).toLowerCase() || ".png";
        if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
          continue;
        }
        const safeBase =
          path
            .basename(rawName, ext)
            .replace(/[^a-zA-Z0-9_-]+/g, "_")
            .slice(0, 40) || "owner_img";
        const prefix = role === "thumbnail" ? "thumb_" : "owner_";
        const outName = `${prefix}${Date.now()}_${i}_${safeBase}${ext}`;
        const dataUrl = String(f?.dataUrl || "");
        const commaIdx = dataUrl.indexOf(",");
        const base64 = commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : dataUrl;
        const buf = Buffer.from(base64, "base64");
        if (buf.length > 0) {
          validUploadPayloads.push({ outName, buf });
        }
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

      const safeStudentDir = assertPathAllowed(existing.localFolderPath);
      const ownerDir = assertPathAllowed(
        path.join(safeStudentDir, OWNER_UPLOADS_SUBDIR)
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
        return NextResponse.json(
          {
            success: false,
            error: `Số lượng ảnh bổ sung vượt giới hạn LMS (${newScreenshots.length}/${MAX_SPCK_SCREENSHOTS} ảnh). Vui lòng chọn tối đa ${MAX_SPCK_SCREENSHOTS} ảnh.`,
          },
          { status: 400 }
        );
      }

      fs.mkdirSync(ownerDir, { recursive: true });
      const savedPaths: string[] = [];
      for (let i = 0; i < validUploadPayloads.length; i++) {
        const outPath = candidatePaths[i];
        fs.writeFileSync(outPath, validUploadPayloads[i].buf);
        savedPaths.push(outPath);
      }

      spckUploadRepo.updateSharedResources(
        classId,
        studentId,
        {
          thumbnailPath: newThumbnailPath,
          screenshotsJson: JSON.stringify(newScreenshots),
        },
        existing.localFolderPath
      );

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

    const batchResult = await captureClassAppScreenshotsAndSelectThumbnails({
      classId,
      studentIds,
      useAiVision: body?.useAiVision !== false,
      sessionNumber: body?.syncActiveSession !== false ? activeSessionNumber : undefined,
    });

    const updatedRecords = buildEnrichedClassSpckRecords(classId, activeSessionNumber);
    const failedItems = (batchResult.results || []).filter((r) => Boolean(r.error));
    if (failedItems.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: failedItems.map((r) => `[${r.studentId}]: ${r.error}`).join(" | "),
          batchResult,
          records: updatedRecords,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      batchResult,
      records: updatedRecords,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
