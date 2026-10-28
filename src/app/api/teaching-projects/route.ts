import { NextRequest, NextResponse } from "next/server";
import { getRunningClasses, type RunningClassItem } from "@/lib/db/json-config";
import {
  buildDefaultTeachingProjectName,
  getDb,
  normalizeTeachingProjectTasks,
  teachingProjectRepo,
  type TeachingProjectTaskItem,
} from "@/lib/db/sqlite";
import { TeachingProjectService } from "@/lib/playwright/teaching-project-service";
import { resolveClassDateRangeInfo } from "@/lib/playwright/sync-class";
import { validateLocalRequest } from "@/lib/security/local-guard";

function listAvailableClassesForTeaching(): RunningClassItem[] {
  const running = getRunningClasses();
  const map = new Map<string, RunningClassItem>();

  for (const item of running) {
    const code = String(item.classCode || "").trim().toUpperCase();
    if (!code || /^(TEST|AUDIT|R\d+|CLASS_|SYNTH)/i.test(code)) continue;
    map.set(code, { ...item, classCode: code });
  }

  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT classId, MAX(className) AS className
         FROM classes_sessions
         GROUP BY classId
         ORDER BY MAX(updatedAt) DESC`
      )
      .all() as Array<{ classId: string; className?: string }>;

    for (const r of rows) {
      const code = String(r.classId || "").trim().toUpperCase();
      if (!code || /^(TEST|AUDIT|R\d+|CLASS_|SYNTH)/i.test(code)) continue;
      if (!map.has(code)) {
        const range = resolveClassDateRangeInfo(code);
        map.set(code, {
          classCode: code,
          courseName: r.className && r.className !== code ? r.className : range.courseName,
          status: "Running",
          ...(range.startDateDmy ? { startDate: range.startDateDmy } : {}),
          ...(range.endDateDmy ? { endDate: range.endDateDmy } : {}),
        });
      }
    }
  } catch {
    // ignore DB errors
  }

  return Array.from(map.values());
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

    return NextResponse.json({
      ...loaded,
      classes,
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

    if (action === "save_draft" || action === "approve_and_save") {
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

      if (action === "save_draft") {
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

      // If approve_and_save, approve using the newly saved draftVersion
      const approveRes = teachingProjectRepo.approveDraft(
        classCode,
        saveRes.record.draftVersion
      );
      if (!approveRes.success) {
        return NextResponse.json(
          {
            success: false,
            error: approveRes.error,
            record: approveRes.record,
            tasks: normalizeTeachingProjectTasks(
              approveRes.record.tasksJson,
              approveRes.record.endDate
            ),
          },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        record: approveRes.record,
        tasks: normalizeTeachingProjectTasks(
          approveRes.record.tasksJson,
          approveRes.record.endDate
        ),
      });
    }

    if (action === "approve") {
      const approveRes = teachingProjectRepo.approveDraft(classCode, expectedVersion);
      if (!approveRes.success) {
        return NextResponse.json(
          {
            success: false,
            conflict: approveRes.conflict,
            currentVersion: approveRes.currentVersion,
            error: approveRes.error,
            record: approveRes.record,
            tasks: normalizeTeachingProjectTasks(
              approveRes.record.tasksJson,
              approveRes.record.endDate
            ),
          },
          { status: approveRes.conflict ? 409 : 400 }
        );
      }

      return NextResponse.json({
        success: true,
        record: approveRes.record,
        tasks: normalizeTeachingProjectTasks(
          approveRes.record.tasksJson,
          approveRes.record.endDate
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
