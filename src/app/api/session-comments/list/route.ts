import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { classSessionRepo, studentRepo, sessionFeedbackRepo } from "@/lib/db/sqlite";
import { getQuickTags, getCoursesSyllabus, getZaloTemplates } from "@/lib/db/json-config";

export async function GET(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const url = new URL(req.url);
    const classId = url.searchParams.get("classId");
    const sessionId = url.searchParams.get("sessionId");

    const allSessions = classId ? classSessionRepo.findByClass(classId) : [];
    const allStudents = classId ? studentRepo.findByClass(classId) : [];
    const feedbacks = classId && sessionId ? sessionFeedbackRepo.findBySession(classId, sessionId) : [];

    const quickCategories = getQuickTags();
    const quickTags = quickCategories.flatMap((c) => c.tags || []);
    const syllabusList = getCoursesSyllabus();
    const zaloTemplates = getZaloTemplates();

    return NextResponse.json({
      success: true,
      data: {
        sessions: allSessions,
        students: allStudents,
        feedbacks,
        quickTags,
        syllabusList,
        zaloTemplates,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
