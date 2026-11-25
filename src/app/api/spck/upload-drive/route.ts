import { NextResponse } from "next/server";
import { spckSessionRepo, type SpckSessionNumber } from "@/lib/db/sqlite";
import {
  DEFAULT_SPCK_DRIVE_FOLDER_URL,
  SpckDriveUploader,
} from "@/lib/playwright/spck-drive-uploader";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { buildEnrichedClassSpckRecords } from "../list/route";

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const classId = String(body?.classId || "").trim().toUpperCase();
    const driveFolderUrl =
      String(body?.driveFolderUrl || "").trim() || DEFAULT_SPCK_DRIVE_FOLDER_URL;
    const rawSession = Number(body?.sessionNumber);
    const activeSessionNumber: SpckSessionNumber | undefined =
      rawSession === 12 || rawSession === 13 || rawSession === 14
        ? (rawSession as SpckSessionNumber)
        : undefined;
    const studentIds: string[] | undefined = Array.isArray(body?.studentIds)
      ? body.studentIds.map((id: any) => String(id).trim()).filter(Boolean)
      : body?.studentId
      ? [String(body.studentId).trim()]
      : undefined;

    if (!classId) {
      return NextResponse.json(
        {
          success: false,
          error: "Thiếu mã lớp (classId) khi thực hiện tải SPCK lên Google Drive.",
        },
        { status: 400 }
      );
    }

    const uploadMode = body?.uploadMode === "tree" ? "tree" : "zip_bundle";

    const driveResult = await SpckDriveUploader.uploadClassSpckToGoogleDrive({
      classId,
      driveFolderUrl,
      studentIds,
      uploadMode,
      sessionNumber: activeSessionNumber,
      syncAllUnverifiedSessions: body?.syncActiveSession === true,
      forceReupload: body?.forceReupload === true,
    });

    if (body?.syncActiveSession === true && activeSessionNumber) {
      const succeededIds: string[] = (driveResult.results || [])
        .filter((r: any) => r.status === "SUCCESS" || r.status === "UPLOADED")
        .map((r: any) => String(r.studentId || ""))
        .filter(Boolean);
      const allowedSet =
        studentIds && studentIds.length > 0 ? new Set(studentIds) : null;
      const targetIds = allowedSet
        ? succeededIds.filter((id) => allowedSet.has(id))
        : succeededIds;
      for (const sid of targetIds) {
        try {
          const sessRow = spckSessionRepo.findOne(classId, sid, activeSessionNumber);
          if (
            !sessRow ||
            sessRow.lastVerifiedAt ||
            sessRow.draftStatus === "VERIFIED" ||
            sessRow.draftStatus === "SAVING"
          ) {
            continue;
          }
          spckSessionRepo.syncLatestSharedResourcesToSessionDraft(
            classId,
            sid,
            activeSessionNumber
          );
        } catch {}
      }
    }

    const updatedRecords = buildEnrichedClassSpckRecords(classId, activeSessionNumber);

    return NextResponse.json({
      success: true,
      driveResult,
      records: updatedRecords,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isClientError =
      message.includes("được miễn") ||
      message.includes("Thiếu mã lớp") ||
      message.includes("không hợp lệ") ||
      message.includes("chưa khớp với thư mục khóa học");
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: isClientError ? 400 : 500 }
    );
  }
}
