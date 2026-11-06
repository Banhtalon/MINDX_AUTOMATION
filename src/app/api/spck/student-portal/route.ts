import { NextResponse } from "next/server";
import { type SpckSessionSlotNumber } from "@/lib/db/sqlite";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { studentPortalManager } from "@/lib/student-portal/student-portal-server";
import { buildEnrichedClassSpckRecords } from "../list/route";

function resolveSessionSlot(raw: unknown): SpckSessionSlotNumber {
  const num = Number(raw);
  return num === 12 || num === 13 || num === 14 ? num : 12;
}

export async function GET(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const url = new URL(req.url);
    const classId = String(url.searchParams.get("classId") || "")
      .trim()
      .toUpperCase();
    const sessionSlot = resolveSessionSlot(url.searchParams.get("sessionNumber"));

    const portalStatus = studentPortalManager.getStatus(classId || undefined);
    const activeClassId = classId || portalStatus.classId;
    const records = activeClassId
      ? buildEnrichedClassSpckRecords(activeClassId, sessionSlot)
      : [];

    return NextResponse.json({
      success: true,
      portalStatus,
      records,
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

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const action = String(body?.action || "start").trim().toLowerCase();
    const classId = String(body?.classId || "").trim().toUpperCase();
    const sessionSlot = resolveSessionSlot(body?.sessionNumber);

    if (action === "stop") {
      await studentPortalManager.stopPortal();
      const portalStatus = studentPortalManager.getStatus();
      const activeClassId = classId || portalStatus.classId;
      const records = activeClassId
        ? buildEnrichedClassSpckRecords(activeClassId, sessionSlot)
        : [];
      return NextResponse.json({
        success: true,
        portalStatus,
        records,
      });
    }

    if (action === "toggle_auto_drive") {
      const portalStatus = studentPortalManager.setAutoUploadDrive(
        Boolean(body?.autoUploadDrive),
        String(body?.driveFolderUrl || "").trim() || undefined
      );
      return NextResponse.json({
        success: true,
        portalStatus,
      });
    }

    if (!classId) {
      return NextResponse.json(
        {
          success: false,
          error: "Vui lòng chọn Lớp học trước khi mở Cổng Cho Học Sinh Nộp Bài.",
        },
        { status: 400 }
      );
    }

    const portalStatus = await studentPortalManager.startPortal({
      classId,
      folderPath: String(body?.folderPath || "").trim() || undefined,
      driveFolderUrl: String(body?.driveFolderUrl || "").trim() || undefined,
      autoUploadDrive:
        typeof body?.autoUploadDrive === "boolean" ? body.autoUploadDrive : true,
    });

    const records = buildEnrichedClassSpckRecords(classId, sessionSlot);

    return NextResponse.json({
      success: true,
      portalStatus,
      records,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 400 }
    );
  }
}
