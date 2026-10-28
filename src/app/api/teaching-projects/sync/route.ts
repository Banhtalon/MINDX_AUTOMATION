import { NextRequest, NextResponse } from "next/server";
import {
  normalizeTeachingProjectTasks,
  teachingProjectRepo,
  type TeachingProjectTaskItem,
} from "@/lib/db/sqlite";
import { TeachingProjectService } from "@/lib/playwright/teaching-project-service";
import { validateLocalRequest } from "@/lib/security/local-guard";

export async function POST(request: NextRequest) {
  const guardError = validateLocalRequest(request);
  if (guardError) return guardError;

  try {
    const body = await request.json();
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

    // 1. If payload is provided, save draft & approve atomically with optimistic concurrency check
    if (
      body?.projectName !== undefined ||
      body?.startDate !== undefined ||
      body?.endDate !== undefined ||
      Array.isArray(body?.tasks)
    ) {
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
          },
          { status: 409 }
        );
      }

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
    } else {
      const current = teachingProjectRepo.getOrInit(classCode);
      if (Number(expectedVersion) !== Number(current.draftVersion)) {
        return NextResponse.json(
          {
            success: false,
            conflict: true,
            currentVersion: current.draftVersion,
            error: `Bản nháp dự án lớp ${classCode} đã thay đổi (v${current.draftVersion}). Vui lòng tải lại trước khi đồng bộ.`,
            record: current,
          },
          { status: 409 }
        );
      }
      if (current.status !== "APPROVED" && current.status !== "VERIFIED") {
        const approveRes = teachingProjectRepo.approveDraft(classCode, expectedVersion);
        if (!approveRes.success) {
          return NextResponse.json(
            {
              success: false,
              conflict: approveRes.conflict,
              currentVersion: approveRes.currentVersion,
              error: approveRes.error,
              record: approveRes.record,
            },
            { status: approveRes.conflict ? 409 : 400 }
          );
        }
      }
    }

    // 2. Push to Teaching & perform Read-after-Write Verification
    const syncRes = await TeachingProjectService.syncProjectAndTasksToTeaching(
      classCode,
      {
        cleanupExtraTasks: body?.cleanupExtraTasks !== false,
      }
    );

    if (!syncRes.success) {
      return NextResponse.json(
        {
          success: false,
          error: syncRes.error,
          record: syncRes.record,
          tasks: normalizeTeachingProjectTasks(
            syncRes.record.tasksJson,
            syncRes.record.endDate
          ),
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      teachingProjectId: syncRes.teachingProjectId,
      record: syncRes.record,
      tasks:
        syncRes.verifiedTasks ||
        normalizeTeachingProjectTasks(
          syncRes.record.tasksJson,
          syncRes.record.endDate
        ),
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
