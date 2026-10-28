import { NextRequest, NextResponse } from "next/server";
import { teachingProjectRepo } from "@/lib/db/sqlite";
import { ClassSyncer } from "@/lib/playwright/sync-class";
import { taskQueue } from "@/lib/queue/task-queue";
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

    const beforeRecord = teachingProjectRepo.getOrInit(classCode);
    if (Number(expectedVersion) !== Number(beforeRecord.draftVersion)) {
      return NextResponse.json(
        {
          success: false,
          conflict: true,
          currentVersion: beforeRecord.draftVersion,
          error: `Bản nháp dự án lớp ${classCode} đã thay đổi ở phiên bản mới hơn (v${beforeRecord.draftVersion}).`,
          record: beforeRecord,
        },
        { status: 409 }
      );
    }

    const res = await taskQueue.enqueue({
      id: `lms_dates_${classCode}_${Date.now()}`,
      jobType: "SYNC_CLASS",
      classId: classCode,
      description: `Lấy ngày Bắt đầu & Kết thúc lớp ${classCode} từ bảng Lớp học LMS`,
      execute: async () => {
        return await ClassSyncer.fetchClassDatesFromLms(classCode);
      },
    });

    // F11 Guard: Only save into SQLite if live LMS scrape succeeded with both startDateIso and endDateIso
    if (!res.success || res.source !== "LMS_LIVE" || !res.startDateIso || !res.endDateIso) {
      return NextResponse.json(
        {
          ...res,
          success: false,
          error:
            res.error ||
            `Không lấy được ngày Bắt đầu / Kết thúc trực tiếp từ LMS cho lớp ${classCode}.`,
          record: teachingProjectRepo.getOrInit(classCode),
        },
        { status: 400 }
      );
    }

    const current = teachingProjectRepo.getOrInit(classCode);
    const tasks = (() => {
      try {
        return JSON.parse(current.tasksJson || "[]");
      } catch {
        return [];
      }
    })();
    const updatedTasks = Array.isArray(tasks)
      ? tasks.map((t: any) => ({
          ...t,
          deadline: res.endDateIso || t.deadline,
        }))
      : undefined;

    const saveRes = teachingProjectRepo.saveDraft({
      classId: classCode,
      startDate: res.startDateIso,
      endDate: res.endDateIso,
      tasks: updatedTasks,
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

    return NextResponse.json({
      ...res,
      record: saveRes.record,
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
