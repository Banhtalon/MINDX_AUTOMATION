import { NextResponse } from "next/server";
import {
  DemoDayClassNotFoundError,
  inspectClassDemoDayState,
} from "@/lib/demo-day/demo-day-inspector";
import { validateLocalRequest } from "@/lib/security/local-guard";

export async function GET(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const url = new URL(req.url);
    const hasClassParam = url.searchParams.has("classId");
    const rawClassId = String(url.searchParams.get("classId") || "").trim();
    const classId = rawClassId.toUpperCase();

    if (hasClassParam && !/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(classId)) {
      return NextResponse.json(
        { success: false, error: "Định dạng mã lớp (classId) không hợp lệ." },
        { status: 400 }
      );
    }

    const data = await inspectClassDemoDayState(classId);
    return NextResponse.json({ success: true, data });
  } catch (err: unknown) {
    if (err instanceof DemoDayClassNotFoundError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: 404 }
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Không tải được dữ liệu Thi Demo.",
      },
      { status: 500 }
    );
  }
}
