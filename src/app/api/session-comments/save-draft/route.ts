import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { sessionFeedbackRepo } from "@/lib/db/sqlite";

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const {
      classId,
      sessionId,
      studentId,
      attendanceStatus,
      quickTags,
      teacherNote,
      strengths,
      improvements,
      actionPlan,
      finalText,
      status,
    } = body;

    if (!classId || !sessionId || !studentId) {
      return NextResponse.json(
        { success: false, error: "Thiếu classId, sessionId hoặc studentId." },
        { status: 400 }
      );
    }

    sessionFeedbackRepo.upsert({
      classId,
      sessionId,
      studentId,
      attendanceStatus: attendanceStatus || "PRESENT",
      quickTagsJson: Array.isArray(quickTags) ? JSON.stringify(quickTags) : quickTags || "[]",
      teacherNote: teacherNote || "",
      strengths: strengths || "",
      improvements: improvements || "",
      actionPlan: actionPlan || "",
      finalText: finalText || "",
      status: status || "DRAFT",
    });

    return NextResponse.json({
      success: true,
      message: "Đã lưu nháp tức thì vào SQLite.",
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
