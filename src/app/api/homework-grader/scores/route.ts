import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { taskQueue } from "@/lib/queue/task-queue";
import { ScoreScraper } from "@/lib/playwright/scrape-scores";
import { classSessionRepo, studentRepo, scoreMatrixRepo } from "@/lib/db/sqlite";
import { getGradingRubrics, getRunningClasses } from "@/lib/db/json-config";

export async function GET(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const url = new URL(req.url);
    const rawClassId = url.searchParams.get("classId");
    const classId = rawClassId ? rawClassId.trim().toUpperCase() : "";

    const cached = classId ? scoreMatrixRepo.findByClass(classId) : null;
    const sessions = classId ? classSessionRepo.findByClass(classId) : [];
    const students = classId ? studentRepo.findByClass(classId, false) : [];
    const rubrics = getGradingRubrics();

    return NextResponse.json({
      success: true,
      data: {
        matrix: cached?.matrix || null,
        updatedAt: cached?.updatedAt || null,
        sessions,
        students,
        rubrics, runningClasses: getRunningClasses().map((c) => c.classCode),
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const { classCode: rawClassCode } = body;

    if (!rawClassCode || typeof rawClassCode !== "string") {
      return NextResponse.json(
        { success: false, error: "Mã lớp (classCode) không hợp lệ." },
        { status: 400 }
      );
    }

    const classCode = rawClassCode.trim().toUpperCase();

    const result = await taskQueue.enqueue({
      id: `scrape_scores_${classCode}_${Date.now()}`,
      jobType: "SCRAPE_SCORES",
      description: `Cào bảng điểm toàn khóa lớp ${classCode} từ LMS`,
      classId: classCode,
      execute: async () => {
        return ScoreScraper.scrapeClassScores(classCode);
      },
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
