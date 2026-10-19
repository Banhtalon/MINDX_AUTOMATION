import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { sessionFeedbackRepo, calculateSha256 } from "@/lib/db/sqlite";

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const { classId, sessionId, studentId, approvedText } = body;

    if (!classId || !sessionId || !studentId) {
      return NextResponse.json(
        { success: false, error: "Thiếu classId, sessionId hoặc studentId." },
        { status: 400 }
      );
    }

    const textToApprove = (approvedText || "").trim();
    if (textToApprove.length === 0) {
      return NextResponse.json(
        { success: false, error: "Nội dung nhận xét không được để trống khi duyệt." },
        { status: 400 }
      );
    }

    const contentHash = calculateSha256(textToApprove);

    const existing = sessionFeedbackRepo.findOne(classId, sessionId, studentId);

    // Save with APPROVED status and exact contentHash
    sessionFeedbackRepo.upsert({
      classId,
      sessionId,
      studentId,
      attendanceStatus: existing?.attendanceStatus || "PRESENT",
      quickTagsJson: existing?.quickTagsJson,
      teacherNote: existing?.teacherNote,
      strengths: existing?.strengths,
      improvements: existing?.improvements,
      actionPlan: existing?.actionPlan,
      finalText: textToApprove,
      contentHash,
      status: "APPROVED",
    });

    return NextResponse.json({
      success: true,
      message: "Đã duyệt nhận xét và lưu mã băm toàn vẹn (contentHash).",
      contentHash,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
