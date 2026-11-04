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
      // Bulk milestone helper:
      // - Default (quick update, allowDecrease !== true): non-decreasing, only raises tasks 1..milestoneTaskCount to 100% and preserves existing higher progress.
      // - Explicit decrease (resetOthers === true && allowDecrease === true): sets tasks 1..milestoneTaskCount to 100% and remaining tasks to 0%.
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
      const allowDecrease = body?.allowDecrease === true || milestoneCount === 0;
      const current = teachingProjectRepo.getOrInit(classCode);
      const tasks = normalizeTeachingProjectTasks(current.tasksJson, current.endDate);

      let existingProgressMap: Record<string, number> = {};
      try {
        const parsedProg = JSON.parse(current.progressJson || "{}");
        if (parsedProg && typeof parsedProg === "object" && !Array.isArray(parsedProg)) {
          existingProgressMap = parsedProg as Record<string, number>;
        }
      } catch {
        existingProgressMap = {};
      }

      let cachedStudents: Array<{ id: number; status?: string }> = [];
      try {
        const parsedStu = JSON.parse(current.studentsJson || "[]");
        if (Array.isArray(parsedStu)) {
          cachedStudents = parsedStu;
        }
      } catch {
        cachedStudents = [];
      }
      const activeRosterIds = cachedStudents
        .filter((s) => {
          const st = String(s?.status || "").toLowerCase();
          return !st.includes("bảo lưu") && !st.includes("nghỉ học");
        })
        .map((s) => Number(s.id))
        .filter((id) => Number.isInteger(id) && id > 0);

      let eligibleStudentIdSet: Set<number> | null = null;
      if (body?.eligibleStudentIds !== undefined || body?.studentIds !== undefined) {
        const rawIds = body?.eligibleStudentIds ?? body?.studentIds;
        if (!Array.isArray(rawIds) || rawIds.length === 0) {
          return NextResponse.json(
            {
              success: false,
              error: "Danh sách học viên đủ điều kiện (eligibleStudentIds) trống hoặc không hợp lệ.",
            },
            { status: 400 }
          );
        }
        eligibleStudentIdSet = new Set<number>();
        for (const rawId of rawIds) {
          const parsedId = parseStrictPositiveIntInput(rawId);
          if (parsedId === null) {
            return NextResponse.json(
              {
                success: false,
                error: "Mã học viên trong eligibleStudentIds phải là số nguyên dương.",
              },
              { status: 400 }
            );
          }
          eligibleStudentIdSet.add(parsedId);
        }
      } else if (
        body?.verifiedSpckCount !== undefined &&
        body?.expectedRosterCount !== undefined
      ) {
        const verifiedCount = Number(body.verifiedSpckCount);
        const expectedCount = Number(body.expectedRosterCount);
        if (
          Number.isFinite(verifiedCount) &&
          Number.isFinite(expectedCount) &&
          expectedCount > 0 &&
          verifiedCount < expectedCount
        ) {
          return NextResponse.json(
            {
              success: false,
              error: `Chưa đủ học viên hoàn thành bài nộp (${verifiedCount}/${expectedCount} học viên). Chỉ cập nhật tiến độ cả lớp khi đủ danh sách học viên đủ điều kiện.`,
            },
            { status: 400 }
          );
        }
      }

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
        // Quick milestone updates never reset higher slots unless both resetOthers and allowDecrease are explicitly enabled
        if (!isCompletedSlot && !(resetOthers && allowDecrease)) continue;

        const targetStudentIds = eligibleStudentIdSet
          ? t.assignedStudentIds.filter((sid) => eligibleStudentIdSet!.has(sid))
          : t.assignedStudentIds;

        if (!eligibleStudentIdSet && activeRosterIds.length > 0 && isCompletedSlot) {
          const assignedSet = new Set(t.assignedStudentIds);
          const missingFromTask = activeRosterIds.filter(
            (rid) => !assignedSet.has(rid)
          );
          if (missingFromTask.length > 0) {
            return NextResponse.json(
              {
                success: false,
                error: `Công việc thứ ${i + 1} chưa giao đủ danh sách học viên đang học của lớp (thiếu ${missingFromTask.length} học viên). Để cập nhật riêng học viên đủ điều kiện, vui lòng truyền eligibleStudentIds hoặc giao đủ danh sách lớp.`,
              },
              { status: 400 }
            );
          }
        }

        const targetPct = isCompletedSlot ? 100 : 0;
        for (const sid of targetStudentIds) {
          const existingPct = Number(existingProgressMap[`${tid}_${sid}`] ?? 0);
          const finalPct = allowDecrease
            ? targetPct
            : Math.max(Number.isFinite(existingPct) ? existingPct : 0, targetPct);
          updates.push({
            taskId: tid,
            studentId: sid,
            progressPercent: finalPct,
          });
        }
      }

      if (updates.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: "Không có học viên hoặc công việc nào đủ điều kiện để cập nhật tiến độ.",
          },
          { status: 400 }
        );
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
