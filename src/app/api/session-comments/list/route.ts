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

function isSession14Category(cat: { category?: string; categoryName?: string; track?: string } | null | undefined): boolean {
  if (!cat) return false;
  const track = String(cat.track || "").trim().toLowerCase();
  const key = String(cat.category || "").trim().toLowerCase();
  const name = String(cat.categoryName || "").trim().toLowerCase();
  return (
    track === "session14" ||
    track === "spck" ||
    key.startsWith("spck_") ||
    key.includes("session14") ||
    /buổi\s*14|spck/i.test(name)
  );
}

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
    const runningClasses = buildMergedRunningClasses();
    let classId = rawClassId && rawClassId.trim() ? rawClassId.trim().toUpperCase() : null;
    if (!classId) {
      if (runningClasses.length > 0) {
        classId = runningClasses[0].classCode;
      } else {
        try {
          const db = typeof getDb === "function" ? getDb() : null;
          if (typeof (db as any)?.prepare === "function") {
            const firstRow = (db as any)
              .prepare(`SELECT classId FROM classes_sessions ORDER BY id ASC LIMIT 1`)
              .get() as { classId?: string } | undefined;
            if (firstRow?.classId) {
              classId = String(firstRow.classId).trim().toUpperCase();
            }
          }
        } catch {}
      }
    }
    const sessionId = url.searchParams.get("sessionId");

    const includeInactive = url.searchParams.get("includeInactive") === "true";
    const allSessions = classId ? classSessionRepo.findByClass(classId) : [];
    const allStudents = classId ? studentRepo.findByClass(classId, !includeInactive) : [];
    const feedbacks = classId && sessionId ? sessionFeedbackRepo.findBySession(classId, sessionId) : [];

    const rawCategories = typeof getQuickTags === "function" ? getQuickTags() || [] : [];
    const quickCategories = rawCategories.filter((c) => !isSession14Category(c));
    const quickTags = quickCategories.flatMap((c) =>
      (c.tags || [])
        .filter((t) => !String(t?.id || "").toLowerCase().startsWith("s14_"))
        .map((t) => ({
          ...t,
          category: c.category || "",
          categoryName: c.categoryName || c.category || "",
          track: c.track || "",
        }))
    );
    const syllabusList = getCoursesSyllabus();
    const zaloTemplates = getZaloTemplates();

    return NextResponse.json({
      success: true,
      data: {
        resolvedClassId: classId || undefined,
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
