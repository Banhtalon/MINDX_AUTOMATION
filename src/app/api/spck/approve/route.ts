import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  assertClassHasSpckSession,
  formatSpckSessionTitle,
  getDb,
  normalizeSpckFolderKey,
  spckSessionRepo,
  spckUploadRepo,
  stripSpckSessionSuffix,
  studentRepo,
  validateSpckTitleLength,
  type SpckSessionSubmissionRecord,
} from "@/lib/db/sqlite";
import { parseMediaBuffer } from "@/lib/file-parsers/media-reader";
import {
  ALLOWED_IMAGE_EXTENSIONS,
  validateSpckAttachmentFile,
  validateSpckRelatedUrl,
  validateSpckResourceLimits,
  validateSpckYoutubeUrl,
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
    const studentIds: string[] = Array.isArray(body?.studentIds)
      ? body.studentIds.map((id: any) => String(id).trim()).filter(Boolean)
      : body?.studentId
      ? [String(body.studentId).trim()]
      : [];

    if (!classId || studentIds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Thiếu classId hoặc danh sách studentIds cần duyệt.",
        },
        { status: 400 }
      );
    }

    const stageInfo = assertClassHasSpckSession(classId, body?.sessionNumber);
    const sessionNumber = stageInfo.sessionNumber;

    if (!Array.isArray(body?.reviewedItems) || body.reviewedItems.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Bắt buộc gửi đầy đủ snapshot reviewedItems của các bản ghi đã xem trên giao diện trước khi duyệt.",
        },
        { status: 400 }
      );
    }

    const reviewedMap = new Map<string, any>(
      body.reviewedItems.map((item: any) => [String(item?.studentId || "").trim(), item])
    );

    const allClassRecords = spckUploadRepo.findByClass(classId);
    const folderUsage = new Map<string, string[]>();
    for (const r of allClassRecords) {
      const f = normalizeSpckFolderKey(r.localFolderPath);
      if (f) {
        const list = folderUsage.get(f) || [];
        list.push(r.studentId);
        folderUsage.set(f, list);
      }
    }

    const approvedStudentIds: string[] = [];
    const skipped: Array<{ studentId: string; reason: string }> = [];
    const pendingApprovals: Array<{
      studentId: string;
      expectedVersion: number;
      formattedTitle: string;
      baseTitle: string;
    }> = [];

    for (const studentId of studentIds) {
      const student = studentRepo.findOne(studentId, classId);
      if (!student) {
        skipped.push({ studentId, reason: "Học viên không tồn tại trong lớp." });
        continue;
      }

      const record = spckUploadRepo.findOne(classId, studentId);
      if (!record) {
        skipped.push({ studentId, reason: "Chưa có bản ghi SPCK cho học viên này." });
        continue;
      }

      let sessionDraft = spckSessionRepo.getOrInitSessionDraft(
        classId,
        studentId,
        sessionNumber
      );

      if (
        record.status === "INSUFFICIENT_INFO" ||
        sessionDraft.draftStatus === "INSUFFICIENT_INFO"
      ) {
        skipped.push({
          studentId,
          reason:
            "Bản ghi đang ở trạng thái INSUFFICIENT_INFO (chưa đủ thông tin). Không thể duyệt.",
        });
        continue;
      }

      const rev = reviewedMap.get(studentId);
      if (!rev) {
        return NextResponse.json(
          {
            success: false,
            error: `[Stale Conflict] Thiếu snapshot đã xem trên giao diện (reviewedItems) cho học viên '${studentId}'.`,
          },
          { status: 409 }
        );
      }

      if (
        rev.draftVersion !== undefined &&
        rev.draftVersion !== null &&
        Number(rev.draftVersion) !== Number(sessionDraft.draftVersion)
      ) {
        return NextResponse.json(
          {
            success: false,
            conflict: true,
            error: `[Stale Conflict] Phiên bản nháp Buổi ${sessionNumber} của học viên '${studentId}' đã thay đổi (UI=${rev.draftVersion}, DB=${sessionDraft.draftVersion}). Vui lòng tải lại trước khi duyệt.`,
          },
          { status: 409 }
        );
      }

      const revScreenshotsJson =
        typeof rev.screenshotsJson === "string"
          ? rev.screenshotsJson
          : Array.isArray(rev.screenshots)
          ? JSON.stringify(rev.screenshots)
          : "__MISSING__";
      const revAttachmentsJson =
        typeof rev.attachmentsJson === "string"
          ? rev.attachmentsJson
          : Array.isArray(rev.attachments)
          ? JSON.stringify(rev.attachments)
          : "__MISSING__";
      const revYoutubeUrlsJson =
        typeof rev.youtubeUrlsJson === "string"
          ? rev.youtubeUrlsJson
          : Array.isArray(rev.youtubeUrls)
          ? JSON.stringify(rev.youtubeUrls)
          : "__MISSING__";
      const normalizeLinksJson = (rawOrArr: unknown): string => {
        let arr: any[] = [];
        if (Array.isArray(rawOrArr)) {
          arr = rawOrArr;
        } else if (typeof rawOrArr === "string") {
          try {
            const parsed = JSON.parse(rawOrArr);
            if (Array.isArray(parsed)) arr = parsed;
          } catch {
            return "__INVALID_JSON__";
          }
        } else {
          return "__MISSING__";
        }
        return JSON.stringify(
          arr
            .filter((item) => item && typeof item === "object")
            .map((item) => ({
              name: String(item.name ?? "").trim(),
              url: String(item.url ?? "").trim(),
            }))
        );
      };

      const revRelatedLinksJson =
        typeof rev.relatedLinksJson === "string"
          ? normalizeLinksJson(rev.relatedLinksJson)
          : Array.isArray(rev.relatedLinks)
          ? normalizeLinksJson(rev.relatedLinks)
          : "__MISSING__";
      const revConfirmed =
        rev.isConfirmedByTeacher === undefined ? -1 : rev.isConfirmedByTeacher ? 1 : 0;

      const matchesTarget = (target: {
        localFolderPath?: string;
        projectTitle?: string;
        baseProjectTitle?: string;
        teacherComment?: string;
        thumbnailPath?: string;
        screenshotsJson?: string;
        attachmentsJson?: string;
        youtubeUrlsJson?: string;
        relatedLinksJson?: string;
        isConfirmedByTeacher?: number;
      }): boolean => {
        const revTitle = String(rev.projectTitle ?? "").trim();
        const targetTitle = String(target.projectTitle ?? "").trim();
        const targetBase = String(target.baseProjectTitle ?? "").trim();
        const strippedRevTitle = stripSpckSessionSuffix(revTitle);
        const strippedTargetTitle = stripSpckSessionSuffix(targetTitle);
        const formattedRevTitle = formatSpckSessionTitle(
          strippedRevTitle,
          sessionNumber,
          student.fullName
        );

        const folderMismatch =
          typeof rev.localFolderPath !== "string" ||
          normalizeSpckFolderKey(rev.localFolderPath) !==
            normalizeSpckFolderKey(target.localFolderPath);
        const titleMismatch =
          revTitle !== targetTitle &&
          revTitle !== targetBase &&
          formattedRevTitle !== targetTitle &&
          strippedRevTitle !== strippedTargetTitle;
        const commentMismatch =
          String(rev.teacherComment ?? "").trim() !==
          String(target.teacherComment ?? "").trim();
        const thumbMismatch =
          String(rev.thumbnailPath ?? "").trim() !==
          String(target.thumbnailPath ?? "").trim();
        const screenshotsMismatch =
          revScreenshotsJson !== String(target.screenshotsJson ?? "[]");
        const attachmentsMismatch =
          revAttachmentsJson !== String(target.attachmentsJson ?? "[]");
        const youtubeMismatch =
          revYoutubeUrlsJson !== String(target.youtubeUrlsJson ?? "[]");
        const relatedLinksMismatch =
          revRelatedLinksJson !== normalizeLinksJson(target.relatedLinksJson ?? "[]");
        const confirmedMismatch = revConfirmed !== Number(target.isConfirmedByTeacher);

        return !(
          folderMismatch ||
          titleMismatch ||
          commentMismatch ||
          thumbMismatch ||
          screenshotsMismatch ||
          attachmentsMismatch ||
          youtubeMismatch ||
          relatedLinksMismatch ||
          confirmedMismatch
        );
      };

      let isMatch = matchesTarget(sessionDraft);
      if (!isMatch && rev.draftVersion === undefined && matchesTarget(record)) {
        // Sync direct spck_uploads modification when caller did not use session draftVersion
        const baseTitle =
          stripSpckSessionSuffix(record.projectTitle) || `SPCK ${student.fullName}`;
        const formattedTitle = formatSpckSessionTitle(
          baseTitle,
          sessionNumber,
          student.fullName
        );
        const synced = spckSessionRepo.saveSessionDraft({
          classId,
          studentId,
          sessionNumber,
          localFolderPath: record.localFolderPath,
          isConfirmedByTeacher: record.isConfirmedByTeacher,
          projectTitle: formattedTitle,
          thumbnailPath: record.thumbnailPath,
          screenshotsJson: record.screenshotsJson,
          attachmentsJson: record.attachmentsJson,
          youtubeUrlsJson: record.youtubeUrlsJson,
          relatedLinksJson: record.relatedLinksJson,
          teacherComment: record.teacherComment,
        });
        sessionDraft = synced.record;
        isMatch = true;
      }

      if (!isMatch) {
        return NextResponse.json(
          {
            success: false,
            conflict: true,
            error: `[Stale Conflict] Dữ liệu SPCK Buổi ${sessionNumber} của học viên '${studentId}' trong DB đã thay đổi so với bản hiển thị trên giao diện. Vui lòng tải lại trước khi duyệt.`,
          },
          { status: 409 }
        );
      }

      if (Number(sessionDraft.isConfirmedByTeacher) !== 1) {
        skipped.push({
          studentId,
          reason:
            "Chưa xác nhận ghép nối studentId (isConfirmedByTeacher !== 1). Vui lòng xác nhận học viên trên Bảng Ghép nối trước khi duyệt.",
        });
        continue;
      }

      const normFolder = normalizeSpckFolderKey(sessionDraft.localFolderPath);
      if (!normFolder) {
        skipped.push({
          studentId,
          reason: "Chưa ghép nối thư mục bài làm cục bộ cho học viên.",
        });
        continue;
      }
      if (normFolder && (folderUsage.get(normFolder)?.length || 0) > 1) {
        skipped.push({
          studentId,
          reason: `Thư mục '${sessionDraft.localFolderPath}' đang bị gán trùng cho nhiều học viên (${folderUsage.get(normFolder)?.join(", ")}).`,
        });
        continue;
      }

      const rawTitle = (sessionDraft.projectTitle || "").trim();
      const baseTitle = stripSpckSessionSuffix(rawTitle);
      if (!baseTitle) {
        skipped.push({
          studentId,
          reason: "Tiêu đề sản phẩm* không được để trống.",
        });
        continue;
      }
      const formattedTitle = formatSpckSessionTitle(
        baseTitle,
        sessionNumber,
        student.fullName
      );
      const titleValidation = validateSpckTitleLength(formattedTitle, sessionNumber);
      if (!titleValidation.valid) {
        skipped.push({
          studentId,
          reason: titleValidation.reason || "Tiêu đề sản phẩm không hợp lệ.",
        });
        continue;
      }

      const comment = (sessionDraft.teacherComment || "").trim();
      if (!comment) {
        skipped.push({
          studentId,
          reason: "Bình luận của giáo viên* không được để trống.",
        });
        continue;
      }

      if (!sessionDraft.thumbnailPath || !sessionDraft.thumbnailPath.trim()) {
        skipped.push({
          studentId,
          reason: "Ảnh đại diện sản phẩm (Thumbnail*) không được để trống.",
        });
        continue;
      }

      const screenshots = JSON.parse(sessionDraft.screenshotsJson || "[]");
      const attachments = JSON.parse(sessionDraft.attachmentsJson || "[]");
      const youtubeUrls = JSON.parse(sessionDraft.youtubeUrlsJson || "[]");
      const relatedLinks = JSON.parse(sessionDraft.relatedLinksJson || "[]");

      const limitCheck = validateSpckResourceLimits({
        screenshots,
        attachments,
        youtubeUrls,
        relatedLinks,
      });
      if (!limitCheck.valid) {
        skipped.push({
          studentId,
          reason:
            limitCheck.reason ||
            "Số lượng ảnh/tài liệu/link vượt quá giới hạn cho phép của LMS.",
        });
        continue;
      }

      let resourceError = "";
      for (const yt of youtubeUrls) {
        const ytCheck = validateSpckYoutubeUrl(String(yt || ""));
        if (!ytCheck.valid) {
          resourceError = ytCheck.reason || "Đường dẫn YouTube không hợp lệ.";
          break;
        }
      }
      if (!resourceError) {
        for (const rel of relatedLinks) {
          const relCheck = validateSpckRelatedUrl(String(rel?.url || ""));
          if (!relCheck.valid) {
            resourceError = relCheck.reason || "Đường dẫn liên quan không hợp lệ.";
            break;
          }
        }
      }
      if (!resourceError) {
        try {
          const safeThumb = assertPathAllowed(sessionDraft.thumbnailPath);
          const thumbExt = path.extname(safeThumb).toLowerCase();
          if (!ALLOWED_IMAGE_EXTENSIONS.has(thumbExt) || !fs.existsSync(safeThumb)) {
            resourceError = `File ảnh Thumbnail '${sessionDraft.thumbnailPath}' không hợp lệ.`;
          } else {
            const mediaCheck = parseMediaBuffer(
              fs.readFileSync(safeThumb),
              path.basename(safeThumb),
              thumbExt
            );
            if (!mediaCheck.success) {
              resourceError = `File ảnh Thumbnail bị lỗi cấu trúc: ${mediaCheck.errorReason}`;
            }
          }
        } catch (err) {
          resourceError = err instanceof Error ? err.message : String(err);
        }
      }
      if (!resourceError) {
        for (const imgPath of screenshots) {
          try {
            const safeImg = assertPathAllowed(String(imgPath || ""));
            const imgExt = path.extname(safeImg).toLowerCase();
            if (!ALLOWED_IMAGE_EXTENSIONS.has(imgExt) || !fs.existsSync(safeImg)) {
              resourceError = `File ảnh sản phẩm '${imgPath}' không hợp lệ.`;
              break;
            }
            const mediaCheck = parseMediaBuffer(
              fs.readFileSync(safeImg),
              path.basename(safeImg),
              imgExt
            );
            if (!mediaCheck.success) {
              resourceError = `File ảnh sản phẩm '${path.basename(safeImg)}' bị lỗi cấu trúc: ${mediaCheck.errorReason}`;
              break;
            }
          } catch (err) {
            resourceError = err instanceof Error ? err.message : String(err);
            break;
          }
        }
      }
      if (!resourceError) {
        for (const attPath of attachments) {
          try {
            const attCheck = validateSpckAttachmentFile(String(attPath || ""));
            if (!attCheck.valid) {
              resourceError = attCheck.reason || `Tài liệu đính kèm '${attPath}' không hợp lệ.`;
              break;
            }
          } catch (err) {
            resourceError = err instanceof Error ? err.message : String(err);
            break;
          }
        }
      }

      if (resourceError) {
        skipped.push({
          studentId,
          reason: resourceError,
        });
        continue;
      }

      pendingApprovals.push({
        studentId,
        expectedVersion: sessionDraft.draftVersion,
        formattedTitle,
        baseTitle,
      });
    }

    if (pendingApprovals.length > 0) {
      const db = getDb();
      let conflictErr: string | null = null;
      const applyBatchApproval = db.transaction(() => {
        for (const item of pendingApprovals) {
          const curDraft = spckSessionRepo.getOrInitSessionDraft(
            classId,
            item.studentId,
            sessionNumber
          );
          if (curDraft.projectTitle !== item.formattedTitle) {
            const updated = spckSessionRepo.saveSessionDraft({
              classId,
              studentId: item.studentId,
              sessionNumber,
              expectedVersion: item.expectedVersion,
              projectTitle: item.formattedTitle,
            });
            if (updated.conflict) {
              conflictErr = `[Stale Conflict] Bản nháp của học viên '${item.studentId}' đã thay đổi trong lúc duyệt.`;
              return;
            }
            item.expectedVersion = updated.record.draftVersion;
          }

          const appRes = spckSessionRepo.approveSessionDraft(
            classId,
            item.studentId,
            sessionNumber,
            item.expectedVersion
          );
          if (appRes.conflict) {
            conflictErr =
              appRes.reason ||
              `[Stale Conflict] Bản nháp của học viên '${item.studentId}' đã thay đổi trong lúc duyệt.`;
            return;
          }
          approvedStudentIds.push(item.studentId);
        }
      });
      applyBatchApproval();

      if (conflictErr) {
        return NextResponse.json(
          {
            success: false,
            conflict: true,
            error: conflictErr,
          },
          { status: 409 }
        );
      }
    }

    const updatedRecords = buildEnrichedClassSpckRecords(classId, sessionNumber);

    if (approvedStudentIds.length === 0 && skipped.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: skipped[0].reason,
          approvedStudentIds,
          skipped,
          records: updatedRecords,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      sessionNumber,
      approvedCount: approvedStudentIds.length,
      approvedStudentIds,
      skipped,
      records: updatedRecords,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isClientErr =
      message.includes("Buổi nộp SPCK") ||
      message.includes("không tồn tại trong danh sách buổi học") ||
      message.includes("Thiếu mã lớp");
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: isClientErr ? 400 : 500 }
    );
  }
}
