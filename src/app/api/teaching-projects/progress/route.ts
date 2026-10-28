import { NextRequest, NextResponse } from "next/server";
import {
  normalizeTeachingProjectTasks,
  teachingProjectRepo,
} from "@/lib/db/sqlite";
import {
  TeachingProjectService,
  parseStrictPositiveIntInput,
  parseStrictTeachingProgressInput,
} from "@/lib/playwright/teaching-project-service";
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

    let updates: Array<{
      taskId: number;
      studentId: number;
      progressPercent: number;
    }> = [];

    if (body?.updates !== undefined) {
      if (!Array.isArray(body.updates) || body.updates.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: "Danh sách cập nhật tiến độ (updates) trống hoặc không hợp lệ.",
          },
          { status: 400 }
        );
      }
      for (let i = 0; i < body.updates.length; i++) {
        const rawItem = body.updates[i];
        const taskId = parseStrictPositiveIntInput(rawItem?.taskId);
        const studentId = parseStrictPositiveIntInput(rawItem?.studentId);
        const progressPercent = parseStrictTeachingProgressInput(
          rawItem?.progressPercent
        );
        if (taskId === null || studentId === null || progressPercent === null) {
          return NextResponse.json(
            {
              success: false,
              error: `Mục cập nhật tiến độ #${i + 1} không hợp lệ: taskId, studentId phải là số nguyên dương và progressPercent phải là số nguyên từ 0 đến 100.`,
            },
            { status: 400 }
          );
        }
        updates.push({
          taskId,
          studentId,
          progressPercent,
        });
      }
    } else if (body?.milestoneTaskCount !== undefined) {
      // Bulk milestone helper: sets tasks 1..milestoneTaskCount to 100% and remaining tasks to 0% (or leaves them if resetOthers=false)
      const parsedMilestone = parseStrictTeachingProgressInput(
        body.milestoneTaskCount
      );
      if (
        parsedMilestone === null ||
        parsedMilestone < 0 ||
        parsedMilestone > 5
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Mốc số công việc hoàn thành (milestoneTaskCount) không hợp lệ (phải là số nguyên từ 0 đến 5).",
          },
          { status: 400 }
        );
      }
      const milestoneCount = parsedMilestone;
      const resetOthers = body?.resetOthers === true;
      const current = teachingProjectRepo.getOrInit(classCode);
      const tasks = normalizeTeachingProjectTasks(current.tasksJson, current.endDate);

      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        const tid = Number(t.taskId);
        if (!Number.isInteger(tid) || tid <= 0) {
          return NextResponse.json(
            {
              success: false,
              error: `Công việc thứ ${i + 1} chưa có ID trên Teaching. Vui lòng bấm "Đẩy Dự án & 5 Công việc lên Teaching" trước khi cập nhật tiến độ!`,
            },
            { status: 400 }
          );
        }
        const isCompletedSlot = i < milestoneCount;
        if (!isCompletedSlot && !resetOthers) continue;
        const pct = isCompletedSlot ? 100 : 0;
        for (const sid of t.assignedStudentIds) {
          updates.push({
            taskId: tid,
            studentId: sid,
            progressPercent: pct,
          });
        }
      }
    }

    const res = await TeachingProjectService.updateTaskProgressOnTeaching(
      classCode,
      updates
    );

    if (!res.success) {
      return NextResponse.json(
        {
          success: false,
          error: res.error,
          progress: res.progress,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      updatedCount: res.updatedCount,
      progress: res.progress,
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
