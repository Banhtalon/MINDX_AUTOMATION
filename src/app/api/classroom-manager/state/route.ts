import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import {
  buildClassroomStatePayload,
  parseValidatedClassId,
  parseValidatedSessionNumber,
} from "@/lib/classroom/classroom-server-helpers";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const url = new URL(req.url);
    const rawClassId = url.searchParams.get("classId");
    const rawSessionNumber = url.searchParams.get("sessionNumber");

    let requestedClassId: string | null = null;
    if (rawClassId !== null && rawClassId.trim() !== "") {
      requestedClassId = parseValidatedClassId(rawClassId);
      if (!requestedClassId) {
        return NextResponse.json(
          { success: false, error: "Mã lớp (classId) không hợp lệ." },
          { status: 400 }
        );
      }
    }

    let requestedSessionNumber: number | null = null;
    if (rawSessionNumber !== null && rawSessionNumber.trim() !== "") {
      requestedSessionNumber = parseValidatedSessionNumber(rawSessionNumber);
      if (!requestedSessionNumber) {
        return NextResponse.json(
          { success: false, error: "Số buổi học (sessionNumber) phải nằm trong khoảng 1–14." },
          { status: 400 }
        );
      }
    }

    const data = buildClassroomStatePayload({
      requestedClassId,
      requestedSessionNumber,
    });

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Không thể tải dữ liệu quản lý giờ học.";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
