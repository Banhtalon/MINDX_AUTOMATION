import { NextRequest, NextResponse } from "next/server";
import { getRunningClasses } from "@/lib/db/json-config";
import {
  buildDefaultTeachingProjectName,
  getDb,
  normalizeTeachingProjectTasks,
  teachingProjectRepo,
  type TeachingProjectTaskItem,
} from "@/lib/db/sqlite";
import { TeachingProjectService } from "@/lib/playwright/teaching-project-service";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { listClasses, type ClassDirectoryItem } from "@/lib/classes/class-directory";

function listAvailableClassesForTeaching(): ClassDirectoryItem[] {
  return listClasses({ scope: "running" });
}

function resolveClassCurrentSessionNumber(
  classCode: string,
  classes: ClassDirectoryItem[]
): number {
  const matched = classes.find(
    (c) => String(c.classCode || "").trim().toUpperCase() === classCode
  );
  if (matched && Number(matched.currentSessionNumber) > 0) {
    return Number(matched.currentSessionNumber);
  }
  try {
    const rawRunning = getRunningClasses() || [];
    const matchedRunning = rawRunning.find(
      (r) => String(r.classCode || "").trim().toUpperCase() === classCode
    );
    const runningSess = Number((matchedRunning as any)?.currentSessionNumber) || 0;
    if (runningSess > 0) {
      return runningSess;
    }
  } catch {
    // ignore running classes lookup error
  }
  try {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT
           MAX(CASE WHEN TRIM(COALESCE(date, '')) <> '' THEN sessionNumber ELSE 0 END) AS activeSess,
           MAX(sessionNumber) AS maxSess
         FROM classes_sessions
         WHERE classId = ?`
      )
      .get(classCode) as { activeSess?: number; maxSess?: number } | undefined;
    const active = Number(row?.activeSess) || 0;
    const max = Number(row?.maxSess) || 0;
    if (active > 0) return active;
    if (max > 0) return max;
  } catch {
    // ignore DB lookup error
  }
  return 0;
}

export async function GET(request: NextRequest) {
  const guardError = validateLocalRequest(request);
  if (guardError) return guardError;

  try {
    const { searchParams } = new URL(request.url);
    const rawClassCode = searchParams.get("classCode") || "";
    const force = searchParams.get("force") === "1";
    const classes = listAvailableClassesForTeaching();

    if (!rawClassCode.trim()) {
      return NextResponse.json({
        success: true,
        classes,
      });
    }

    const classCode = rawClassCode.trim().toUpperCase();
    const loaded = await TeachingProjectService.loadClassProject(classCode, {
      forceRefreshFromTeaching: force,
    });
    const currentSessionNumber = resolveClassCurrentSessionNumber(classCode, classes);

    return NextResponse.json({
      ...loaded,
      classes,
      currentSessionNumber,
      defaultShortProjectName: buildDefaultTeachingProjectName(classCode, false),
      defaultFullProjectName: buildDefaultTeachingProjectName(classCode, true),
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const guardError = validateLocalRequest(request);
  if (guardError) return guardError;

  try {
    const body = await request.json();
    const action = String(body?.action || "save_draft").trim();
    const classCode = String(body?.classCode || "").trim().toUpperCase();

    if (!classCode) {
      return NextResponse.json(
        { success: false, error: "Thiếu mã lớp (classCode)." },
        { status: 400 }
      );
    }

    const expectedVersion =
      body?.expectedVersion !== undefined && body?.expectedVersion !== null
        ? Number(body.expectedVersion)
        : NaN;
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return NextResponse.json(
        {
          success: false,
          error: "Thiếu phiên bản bản nháp hợp lệ (expectedVersion).",
        },
        { status: 400 }
      );
    }

    if (action === "save_draft") {
      const saveRes = teachingProjectRepo.saveDraft({
        classId: classCode,
        projectName: body?.projectName,
        startDate: body?.startDate,
        endDate: body?.endDate,
        description: body?.description,
        tasks: Array.isArray(body?.tasks)
          ? (body.tasks as TeachingProjectTaskItem[])
          : undefined,
        expectedVersion,
      });

      if (!saveRes.success && saveRes.conflict) {
        return NextResponse.json(
          {
            success: false,
            conflict: true,
            currentVersion: saveRes.currentVersion,
            error: saveRes.error,
            record: saveRes.record,
            tasks: normalizeTeachingProjectTasks(
              saveRes.record.tasksJson,
              saveRes.record.endDate
            ),
          },
          { status: 409 }
        );
      }

      return NextResponse.json({
        success: true,
        downgradedFromApproved: saveRes.downgradedFromApproved,
        record: saveRes.record,
        tasks: normalizeTeachingProjectTasks(
          saveRes.record.tasksJson,
          saveRes.record.endDate
        ),
      });
    }

    return NextResponse.json(
      { success: false, error: `Hành động không hợp lệ: ${action}` },
      { status: 400 }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
