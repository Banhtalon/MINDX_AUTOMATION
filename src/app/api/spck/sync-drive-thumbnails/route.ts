import { NextResponse } from "next/server";
import {
  assertClassHasSpckSession,
  type SpckSessionNumber,
} from "@/lib/db/sqlite";
import {
  DEFAULT_SPCK_STUDENT_THUMBNAIL_DRIVE_URL,
  syncClassStudentThumbnailsFromGoogleDrive,
} from "@/lib/google-drive/spck-drive-thumbnails";
import { isCourseExemptFromSpck } from "@/lib/local-files/spck-scanner";
import {
  parseJsonPlainObjectBody,
  validateLocalRequest,
} from "@/lib/security/local-guard";
import { buildEnrichedClassSpckRecords } from "../list/route";

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  const parsed = await parseJsonPlainObjectBody(req);
  if (!parsed.ok) return parsed.response;

  try {
    const body = parsed.body;
    const classId = String(body.classId ?? "").trim().toUpperCase();
    if (!classId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Thiếu mã lớp (classId) khi thực hiện quét ảnh bìa học viên từ Google Drive.",
        },
        { status: 400 }
      );
    }

    if (isCourseExemptFromSpck(classId)) {
      return NextResponse.json(
        {
          success: false,
          error: `Lớp ${classId} thuộc diện miễn trừ Sản phẩm cuối khóa (PTB/CSB).`,
        },
        { status: 400 }
      );
    }

    let activeSessionNumber: SpckSessionNumber | undefined = undefined;
    if (
      body.sessionNumber !== undefined &&
      body.sessionNumber !== null &&
      String(body.sessionNumber).trim() !== "" &&
      Number(body.sessionNumber) !== 0
    ) {
      const rawSessionNum = Number(body.sessionNumber);
      if (!Number.isInteger(rawSessionNum)) {
        return NextResponse.json(
          {
            success: false,
            error: "Số buổi SPCK (sessionNumber) không hợp lệ.",
          },
          { status: 400 }
        );
      }
      const stageInfo = assertClassHasSpckSession(classId, rawSessionNum);
      activeSessionNumber = stageInfo.sessionNumber;
    }

    const driveFolderUrl =
      String(body.driveFolderUrl ?? "").trim() ||
      DEFAULT_SPCK_STUDENT_THUMBNAIL_DRIVE_URL;

    const studentIds: string[] | undefined = Array.isArray(body.studentIds)
      ? body.studentIds.map((id) => String(id ?? "").trim()).filter(Boolean)
      : body.studentId
      ? [String(body.studentId).trim()]
      : undefined;

    const syncResult = await syncClassStudentThumbnailsFromGoogleDrive({
      classId,
      driveFolderUrl,
      studentIds,
      sessionNumber:
        body.syncActiveSession !== false ? activeSessionNumber : undefined,
      allowDemoteApprovedSession: body.allowDemoteApprovedSession !== false,
      forceOverwriteVerifiedSession:
        body.forceOverwriteVerifiedSession === true,
      forceRedownload: body.forceRedownload === true,
      seedMissingActiveStudents: body.seedMissingActiveStudents === true,
    });

    const records = buildEnrichedClassSpckRecords(classId, activeSessionNumber);
    const partialFailure = syncResult.failedCount > 0;
    const warning =
      syncResult.warnings.length > 0
        ? syncResult.warnings.join(" | ")
        : undefined;

    return NextResponse.json({
      success: true,
      syncResult,
      records,
      partialFailure,
      warning,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isClientError =
      message.includes("Thiếu mã lớp") ||
      message.includes("không hợp lệ") ||
      message.includes("chỉ áp dụng") ||
      message.includes("không thuộc") ||
      message.includes("Google Drive") && message.includes("ID") && message.includes("thư mục");
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: isClientError ? 400 : 500 }
    );
  }
}
