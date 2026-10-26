import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { classSessionRepo, studentRepo, sessionFeedbackRepo, getDb } from "@/lib/db/sqlite";
import {
  getQuickTags,
  getCoursesSyllabus,
  getZaloTemplates,
  getRunningClasses,
  type RunningClassItem,
} from "@/lib/db/json-config";

function buildMergedRunningClasses(): RunningClassItem[] {
  const fromCache = typeof getRunningClasses === "function" ? getRunningClasses() : [];
  if (fromCache.length > 0) {
    return fromCache.map((item) => ({
      ...item,
      classCode: item.classCode.trim().toUpperCase(),
    }));
  }
  const map = new Map<string, RunningClassItem>();
  try {
    const db = typeof getDb === "function" ? getDb() : null;
    if (typeof (db as any)?.prepare === "function") {
      const rows = (db as any)
        .prepare(`SELECT DISTINCT classId, className FROM classes_sessions ORDER BY classId ASC`)
        .all() as Array<{ classId: string; className?: string }>;
      for (const r of rows) {
        const code = String(r?.classId || "").trim().toUpperCase();
        if (!code || /^(TEST|AUDIT|R\d+|CLASS_|SYNTH)/i.test(code)) continue;
        if (!map.has(code)) {
          map.set(code, {
            classCode: code,
            courseName: r.className && r.className !== code ? r.className : "",
            status: "Running",
          });
        }
      }
    }
  } catch {}
  return Array.from(map.values());
}

export async function GET(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const url = new URL(req.url);
    const rawClassId = url.searchParams.get("classId");
    const classId = rawClassId ? rawClassId.trim().toUpperCase() : null;
    const sessionId = url.searchParams.get("sessionId");

    const includeInactive = url.searchParams.get("includeInactive") === "true";
    const allSessions = classId ? classSessionRepo.findByClass(classId) : [];
    const allStudents = classId ? studentRepo.findByClass(classId, !includeInactive) : [];
    const feedbacks = classId && sessionId ? sessionFeedbackRepo.findBySession(classId, sessionId) : [];

    const quickCategories = getQuickTags();
    const quickTags = quickCategories.flatMap((c) =>
      (c.tags || []).map((t) => ({
        ...t,
        category: c.category || "",
        categoryName: c.categoryName || c.category || "",
      }))
    );
    const syllabusList = getCoursesSyllabus();
    const zaloTemplates = getZaloTemplates();
    const runningClasses = buildMergedRunningClasses();

    return NextResponse.json({
      success: true,
      data: {
        sessions: allSessions,
        students: allStudents,
        feedbacks,
        quickTags,
        syllabusList,
        zaloTemplates,
        runningClasses,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
