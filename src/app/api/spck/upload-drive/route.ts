import { NextResponse } from "next/server";
import { type SpckSessionNumber } from "@/lib/db/sqlite";
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

    const driveResult = await SpckDriveUploader.uploadClassSpckToGoogleDrive({
      classId,
      driveFolderUrl,
      studentIds,
    });

    const updatedRecords = buildEnrichedClassSpckRecords(classId, activeSessionNumber);

    return NextResponse.json({
      success: true,
      driveResult,
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
