import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { taskQueue } from "@/lib/queue/task-queue";
import { CommentSaver } from "@/lib/playwright/save-comments";

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const { classId, classCode, sessionId, studentId } = body;

    if (!classId || !classCode || !sessionId) {
      return NextResponse.json(
        { success: false, error: "Thiếu classId, classCode hoặc sessionId." },
        { status: 400 }
      );
    }

    const taskLabel = studentId
      ? `Lưu thử nhận xét học viên ${studentId} lên LMS`
      : `Lưu hàng loạt nhận xét lớp ${classCode} lên LMS`;

    const result = await taskQueue.enqueue({
      id: `save_lms_${Date.now()}`,
      jobType: "SAVE_COMMENTS",
      description: taskLabel,
      classId,
      sessionId,
      studentId,
      execute: async () => {
        return CommentSaver.saveComments({
          classId,
          classCode,
          sessionId,
          studentId,
        });
      },
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
