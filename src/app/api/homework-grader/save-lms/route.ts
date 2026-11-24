import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { taskQueue } from "@/lib/queue/task-queue";
import { HomeworkGradeWorker } from "@/lib/playwright/grade-worker";
import { ScoreScraper } from "@/lib/playwright/scrape-scores";
import { isRoboticsClassCode } from "@/lib/db/sqlite";

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const classId = String(body.classId || "").trim().toUpperCase();
    const classCode = String(body.classCode || classId).trim().toUpperCase();
    const sessionId = String(body.sessionId || "").trim();
    const lessonId = body.lessonId ? String(body.lessonId).trim() : undefined;
    const submissionId = body.submissionId ? String(body.submissionId).trim() : undefined;

    if (!classId || !classCode || classId !== classCode || !sessionId) {
      return NextResponse.json(
        {
          success: false,
          error: "Thiếu hoặc xung đột mã định danh lớp (classId/classCode) và buổi học (sessionId).",
        },
        { status: 400 }
      );
    }

    if (isRoboticsClassCode(classCode)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Lớp Robotics kiểm tra trên giấy (không đẩy điểm qua Tab Chấm bài LMS). Giáo viên tự nhập điểm trực tiếp.",
        },
        { status: 400 }
      );
    }

    const result = await taskQueue.enqueue({
      id: `save_homework_grades_${classCode}_${sessionId}_${Date.now()}`,
      jobType: "GRADE_HOMEWORK",
      description: submissionId
        ? `Lưu điểm & nhận xét bài nộp ${submissionId} (${classCode}) lên LMS`
        : `Lưu hàng loạt điểm & nhận xét bài nộp lớp ${classCode} (${sessionId}) lên LMS`,
      classId,
      sessionId,
      execute: async () => {
        const gradeRes = await HomeworkGradeWorker.saveApprovedGrades({
          classId,
          classCode,
          sessionId,
          lessonId,
          submissionId,
        });
        if (gradeRes.verifiedCount > 0 && body.refreshScores !== false) {
          await ScoreScraper.scrapeClassScores(classCode).catch(() => null);
        }
        return gradeRes;
      },
    });

    return NextResponse.json({
      success: result.failedCount === 0,
      data: result,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
