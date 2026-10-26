import { NextResponse } from "next/server";
import {
  assertClassHasSpckSession,
  canonicalizeSpckFolderPath,
  formatSpckSessionTitle,
  getDb,
  normalizeSpckFolderKey,
  spckSessionRepo,
  spckUploadRepo,
  stripSpckSessionSuffix,
  studentRepo,
  validateSpckTitleLength,
} from "@/lib/db/sqlite";
import {
  sanitizeSpckTitle,
  validateSpckResourceLimits,
} from "@/lib/local-files/spck-scanner";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { assertPathAllowed } from "@/lib/security/path-allowlist";
import { buildEnrichedClassSpckRecords } from "../list/route";

const latestSessionDraftByStudent = new Map<
  string,
  { clientSessionId: string; seq: number }
>();

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const classId = String(body?.classId || "").trim().toUpperCase();
    const studentId = String(body?.studentId || "").trim();

    if (!classId || !studentId) {
      return NextResponse.json(
        {
          success: false,
          error: "Thiếu classId hoặc studentId khi lưu nháp SPCK.",
        },
        { status: 400 }
      );
    }

    const stageInfo = assertClassHasSpckSession(classId, body?.sessionNumber);
    const sessionNumber = stageInfo.sessionNumber;

    const student = studentRepo.findOne(studentId, classId);
    if (!student) {
      return NextResponse.json(
        {
          success: false,
          error: `Học viên '${studentId}' không thuộc lớp '${classId}'.`,
        },
        { status: 400 }
      );
    }

    const expectedVersion =
      typeof body?.expectedVersion === "number" && Number.isFinite(body.expectedVersion)
        ? Math.floor(body.expectedVersion)
        : undefined;

    if (String(body?.action || "").trim() === "sync_latest_resources") {
      const syncRes = spckSessionRepo.syncLatestSharedResourcesToSessionDraft(
        classId,
        studentId,
        sessionNumber,
        expectedVersion
      );
      if (syncRes.conflict) {
        return NextResponse.json(
          {
            success: false,
            conflict: true,
            error: `[Stale Conflict] Bản nháp Buổi ${sessionNumber} của học viên '${studentId}' đã thay đổi trên phiên khác. Vui lòng tải lại trước khi đồng bộ tài nguyên.`,
            currentDraftVersion: syncRes.record.draftVersion,
          },
          { status: 409 }
        );
      }
      const enrichedList = buildEnrichedClassSpckRecords(classId, sessionNumber);
      const enrichedRecord = enrichedList.find((r) => r.studentId === studentId);
      return NextResponse.json({
        success: true,
        record: enrichedRecord || spckUploadRepo.findOne(classId, studentId),
        sessionDraft: syncRes.record,
      });
    }

    const existing = spckUploadRepo.findOne(classId, studentId);
    const existingSessionDraft = spckSessionRepo.getOrInitSessionDraft(
      classId,
      studentId,
      sessionNumber
    );

    if (
      expectedVersion !== undefined &&
      Number.isFinite(expectedVersion) &&
      expectedVersion !== existingSessionDraft.draftVersion
    ) {
      return NextResponse.json(
        {
          success: false,
          conflict: true,
          error: `[Stale Conflict] Bản nháp Buổi ${sessionNumber} của học viên '${studentId}' đã được cập nhật ở tab/tác vụ khác (version hiện tại: ${existingSessionDraft.draftVersion}). Vui lòng tải lại trước khi lưu.`,
          currentDraftVersion: existingSessionDraft.draftVersion,
        },
        { status: 409 }
      );
    }

    const incomingSeq =
      typeof body.draftSeq === "number" && Number.isFinite(body.draftSeq)
        ? Math.floor(body.draftSeq)
        : null;
    const clientSessionId =
      typeof body.clientSessionId === "string" ? body.clientSessionId.trim() : "";
    const currentSeq = existing?.draftSeq ?? 0;
    const studentSessionKey = `${classId}::${studentId}::${sessionNumber}`;

    if (clientSessionId && incomingSeq !== null) {
      const prevSession = latestSessionDraftByStudent.get(studentSessionKey);
      if (
        prevSession &&
        prevSession.clientSessionId === clientSessionId &&
        incomingSeq < prevSession.seq
      ) {
        return NextResponse.json({
          success: true,
          staleIgnored: true,
          record: existing,
        });
      }
      latestSessionDraftByStudent.set(studentSessionKey, {
        clientSessionId,
        seq: incomingSeq,
      });
    } else if (existing && incomingSeq !== null && incomingSeq < currentSeq) {
      return NextResponse.json({
        success: true,
        staleIgnored: true,
        record: existing,
      });
    }

    const rawFolderPath =
      body.localFolderPath !== undefined
        ? String(body.localFolderPath || "").trim()
        : existingSessionDraft.localFolderPath || existing?.localFolderPath || "";
    const localFolderPath = rawFolderPath ? canonicalizeSpckFolderPath(rawFolderPath) : "";
    const folderKey = normalizeSpckFolderKey(localFolderPath);

    let duplicateBindingToReassign: string | null = null;

    if (folderKey) {
      const classRecords = spckUploadRepo.findByClass(classId);
      const duplicateBinding = classRecords.find(
        (r) =>
          r.studentId !== studentId &&
          normalizeSpckFolderKey(r.localFolderPath) === folderKey
      );
      if (duplicateBinding) {
        const requestedReassignFrom = String(body.reassignFromStudentId || "").trim();
        const hasExplicitReassignFlag =
          requestedReassignFrom === duplicateBinding.studentId ||
          body.reassignFolder === true;
        const isExplicitReassignment =
          Boolean(body.isConfirmedByTeacher) &&
          (hasExplicitReassignFlag ||
            (duplicateBinding.status !== "APPROVED" &&
              duplicateBinding.status !== "VERIFIED" &&
              /đổi\s*học\s*viên|chuyển\s*học\s*viên|reassign/i.test(
                String(body.teacherComment || "")
              )));

        if (!isExplicitReassignment) {
          return NextResponse.json(
            {
              success: false,
              error: `Thư mục '${localFolderPath}' đã được ghép với học viên '${duplicateBinding.studentId}'. Không thể ghép trùng 1 thư mục cho 2 học viên.`,
            },
            { status: 409 }
          );
        }

        duplicateBindingToReassign = duplicateBinding.studentId;
      }
    }

    const isConfirmedByTeacher =
      body.isConfirmedByTeacher !== undefined
        ? body.isConfirmedByTeacher
          ? 1
          : 0
        : existingSessionDraft.isConfirmedByTeacher ?? existing?.isConfirmedByTeacher ?? 0;

    const rawTitleInput =
      body.projectTitle !== undefined
        ? String(body.projectTitle || "")
        : existingSessionDraft.projectTitle ||
          existing?.baseProjectTitle ||
          existing?.projectTitle ||
          `SPCK ${student.fullName}`;
    const baseProjectTitle = sanitizeSpckTitle(
      stripSpckSessionSuffix(rawTitleInput),
      student.fullName
    );
    const projectTitle = formatSpckSessionTitle(
      baseProjectTitle,
      sessionNumber,
      student.fullName
    );
    const titleLengthCheck = validateSpckTitleLength(projectTitle, sessionNumber);
    if (!titleLengthCheck.valid) {
      return NextResponse.json(
        {
          success: false,
          error: titleLengthCheck.reason || `Tiêu đề dự án vượt quá giới hạn 100 ký tự (${projectTitle.length}/100).`,
        },
        { status: 400 }
      );
    }

    const thumbnailPath =
      body.thumbnailPath !== undefined
        ? String(body.thumbnailPath || "").trim()
        : existingSessionDraft.thumbnailPath || existing?.thumbnailPath || "";
    if (thumbnailPath) {
      assertPathAllowed(thumbnailPath);
    }

    const rawScreenshots: string[] = Array.isArray(body.screenshots)
      ? body.screenshots.map((p: string) => assertPathAllowed(String(p)))
      : existingSessionDraft.screenshotsJson
      ? JSON.parse(existingSessionDraft.screenshotsJson)
      : existing?.screenshotsJson
      ? JSON.parse(existing.screenshotsJson)
      : [];

    const rawAttachments: string[] = Array.isArray(body.attachments)
      ? body.attachments.map((p: string) => assertPathAllowed(String(p)))
      : existingSessionDraft.attachmentsJson
      ? JSON.parse(existingSessionDraft.attachmentsJson)
      : existing?.attachmentsJson
      ? JSON.parse(existing.attachmentsJson)
      : [];

    const rawYoutubeUrls: string[] = Array.isArray(body.youtubeUrls)
      ? body.youtubeUrls
          .map((u: string) => String(u || "").trim())
          .filter(Boolean)
      : existingSessionDraft.youtubeUrlsJson
      ? JSON.parse(existingSessionDraft.youtubeUrlsJson)
      : existing?.youtubeUrlsJson
      ? JSON.parse(existing.youtubeUrlsJson)
      : [];

    const rawRelatedLinks: Array<{ name: string; url: string; category?: string }> =
      Array.isArray(body.relatedLinks)
        ? body.relatedLinks
            .map((l: any) => ({
              name: String(l?.name || "Link sản phẩm").trim().slice(0, 80),
              url: String(l?.url || "").trim(),
            }))
            .filter((l: { name: string; url: string }) => Boolean(l.url))
        : existingSessionDraft.relatedLinksJson
        ? JSON.parse(existingSessionDraft.relatedLinksJson)
        : existing?.relatedLinksJson
        ? JSON.parse(existing.relatedLinksJson)
        : [];

    const limitCheck = validateSpckResourceLimits({
      screenshots: rawScreenshots,
      attachments: rawAttachments,
      youtubeUrls: rawYoutubeUrls,
      relatedLinks: rawRelatedLinks,
    });
    if (!limitCheck.valid) {
      return NextResponse.json(
        {
          success: false,
          error: limitCheck.reason,
        },
        { status: 400 }
      );
    }

    const teacherComment =
      body.teacherComment !== undefined
        ? String(body.teacherComment ?? "")
        : existingSessionDraft.teacherComment ?? existing?.teacherComment ?? "";

    const teacherNote =
      body.teacherNote !== undefined
        ? String(body.teacherNote ?? "")
        : existingSessionDraft.teacherNote ?? "";

    const quickTagsJson = Array.isArray(body.quickTags)
      ? JSON.stringify(body.quickTags)
      : typeof body.quickTagsJson === "string"
      ? body.quickTagsJson
      : existingSessionDraft.quickTagsJson ?? "[]";

    const matchScore =
      typeof body.matchScore === "number"
        ? body.matchScore
        : existing?.matchScore ?? 0.0;

    const nextDraftSeq =
      incomingSeq !== null
        ? Math.max(incomingSeq, clientSessionId ? currentSeq + 1 : currentSeq)
        : currentSeq + 1;

    const db = getDb();
    let sessionConflict = false;
    let savedSessionRow = existingSessionDraft;

    const runSaveDraftTx = db.transaction(() => {
      const saveDraftRes = spckSessionRepo.saveSessionDraft({
        classId,
        studentId,
        sessionNumber,
        expectedVersion,
        localFolderPath,
        isConfirmedByTeacher,
        projectTitle,
        thumbnailPath,
        screenshotsJson: JSON.stringify(rawScreenshots),
        attachmentsJson: JSON.stringify(rawAttachments),
        youtubeUrlsJson: JSON.stringify(rawYoutubeUrls),
        relatedLinksJson: JSON.stringify(rawRelatedLinks),
        teacherNote,
        quickTagsJson,
        teacherComment,
        updateSharedPool: false,
      });

      if (saveDraftRes.conflict) {
        sessionConflict = true;
        savedSessionRow = saveDraftRes.record;
        throw new Error("__SPCK_SAVE_DRAFT_VERSION_CONFLICT__");
      }

      if (duplicateBindingToReassign) {
        // T16: Detach folder from previous student WITHOUT deleting their submission history
        db.prepare(
          `UPDATE spck_uploads
           SET localFolderPath = '',
               matchScore = 0,
               isConfirmedByTeacher = 0,
               status = 'WAITING_APPROVAL',
               contentHash = '',
               approvedSessionNumber = NULL,
               draftSeq = COALESCE(draftSeq, 0) + 1,
               updatedAt = CURRENT_TIMESTAMP
           WHERE classId = ? AND studentId = ?`
        ).run(classId, duplicateBindingToReassign);

        db.prepare(
          `UPDATE spck_session_submissions
           SET localFolderPath = '',
               isConfirmedByTeacher = 0,
               draftVersion = COALESCE(draftVersion, 1) + 1,
               draftStatus = CASE WHEN draftStatus = 'APPROVED' THEN 'WAITING_APPROVAL' ELSE draftStatus END,
               approvedContentHash = '',
               updatedAt = CURRENT_TIMESTAMP
           WHERE classId = ? AND studentId = ?`
        ).run(classId, duplicateBindingToReassign);
      }

      savedSessionRow = saveDraftRes.record;

      const preserveOtherApprovedSession = Boolean(
        existing &&
          (existing.status === "APPROVED" || existing.status === "VERIFIED") &&
          existing.approvedSessionNumber &&
          existing.approvedSessionNumber !== sessionNumber
      );

      spckUploadRepo.upsert({
        classId,
        studentId,
        localFolderPath,
        matchScore,
        isConfirmedByTeacher,
        projectTitle: preserveOtherApprovedSession
          ? existing!.projectTitle
          : projectTitle,
        baseProjectTitle,
        thumbnailPath:
          body.thumbnailPath !== undefined
            ? thumbnailPath
            : existing?.thumbnailPath || thumbnailPath,
        screenshotsJson: Array.isArray(body.screenshots)
          ? JSON.stringify(rawScreenshots)
          : existing?.screenshotsJson || JSON.stringify(rawScreenshots),
        attachmentsJson: Array.isArray(body.attachments)
          ? JSON.stringify(rawAttachments)
          : existing?.attachmentsJson || JSON.stringify(rawAttachments),
        youtubeUrlsJson: Array.isArray(body.youtubeUrls)
          ? JSON.stringify(rawYoutubeUrls)
          : existing?.youtubeUrlsJson || JSON.stringify(rawYoutubeUrls),
        relatedLinksJson: Array.isArray(body.relatedLinks)
          ? JSON.stringify(rawRelatedLinks)
          : existing?.relatedLinksJson || JSON.stringify(rawRelatedLinks),
        teacherComment: preserveOtherApprovedSession
          ? existing!.teacherComment
          : teacherComment,
        contentHash: preserveOtherApprovedSession
          ? existing!.contentHash
          : savedSessionRow.draftStatus === "APPROVED"
          ? savedSessionRow.approvedContentHash
          : savedSessionRow.draftStatus === "VERIFIED"
          ? savedSessionRow.lastVerifiedHash
          : "",
        status: preserveOtherApprovedSession
          ? existing!.status
          : savedSessionRow.draftStatus === "APPROVED"
          ? "APPROVED"
          : savedSessionRow.draftStatus === "VERIFIED"
          ? "VERIFIED"
          : "WAITING_APPROVAL",
        verifiedAt: savedSessionRow.lastVerifiedAt ?? existing?.verifiedAt ?? null,
        errorMessage: null,
        draftSeq: nextDraftSeq,
        approvedSessionNumber: preserveOtherApprovedSession
          ? existing!.approvedSessionNumber
          : savedSessionRow.draftStatus === "APPROVED" || savedSessionRow.draftStatus === "VERIFIED"
          ? sessionNumber
          : null,
      });
    });
    try {
      runSaveDraftTx();
    } catch (txErr) {
      if (
        !(txErr instanceof Error && txErr.message === "__SPCK_SAVE_DRAFT_VERSION_CONFLICT__")
      ) {
        throw txErr;
      }
    }

    if (sessionConflict) {
      return NextResponse.json(
        {
          success: false,
          conflict: true,
          error: `[Stale Conflict] Bản nháp Buổi ${sessionNumber} của học viên '${studentId}' đã được cập nhật ở tab/tác vụ khác (version hiện tại: ${savedSessionRow.draftVersion}). Vui lòng tải lại trước khi lưu.`,
          currentDraftVersion: savedSessionRow.draftVersion,
        },
        { status: 409 }
      );
    }

    const enrichedList = buildEnrichedClassSpckRecords(classId, sessionNumber);
    const enrichedRecord = enrichedList.find((r) => r.studentId === studentId);

    return NextResponse.json({
      success: true,
      record: enrichedRecord || spckUploadRepo.findOne(classId, studentId),
      sessionDraft: savedSessionRow,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: message.includes("Security Exception") ? 403 : 400 }
    );
  }
}
