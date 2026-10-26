import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { taskQueue } from "@/lib/queue/task-queue";
import { ClassSyncer } from "@/lib/playwright/sync-class";
import { getRunningClasses, type RunningClassItem } from "@/lib/db/json-config";
import { getDb } from "@/lib/db/sqlite";

function getMergedRunningClasses(): RunningClassItem[] {
  const fromCache = getRunningClasses();
  if (fromCache.length > 0) {
    return fromCache.map((item) => ({
      ...item,
      classCode: item.classCode.trim().toUpperCase(),
    }));
  }
  const map = new Map<string, RunningClassItem>();

  try {
    const db = getDb();
    if (typeof (db as any)?.prepare === "function") {
      const rows = (db as any)
        .prepare(`SELECT DISTINCT classId, className FROM classes_sessions ORDER BY classId ASC`)
        .all() as Array<{ classId: string; className?: string }>;
      for (const r of rows) {
        const code = String(r?.classId || "").trim().toUpperCase();
        if (
          !code ||
          /^(TEST|AUDIT|R\d+|CLASS_|SYNTH)/i.test(code)
        ) {
          continue;
        }
        if (!map.has(code)) {
          map.set(code, {
            classCode: code,
            courseName: r.className && r.className !== code ? r.className : "",
            status: "Running",
          });
        }
      }
    }
  } catch {
    // Ignore DB read fallback errors
  }

  return Array.from(map.values());
}

export async function GET(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    return NextResponse.json({
      success: true,
      classes: getMergedRunningClasses(),
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
    const result = await taskQueue.enqueue({
      id: `fetch_running_classes_${Date.now()}`,
      jobType: "SYNC_CLASS",
      description: "Lấy danh sách các lớp đang học (Running) từ LMS",
      execute: async () => {
        return ClassSyncer.fetchRunningClasses();
      },
    });

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          classes: getMergedRunningClasses(),
          error: result.error || "Không thể lấy danh sách lớp đang học từ LMS.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      classes: getMergedRunningClasses(),
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        classes: getMergedRunningClasses(),
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
