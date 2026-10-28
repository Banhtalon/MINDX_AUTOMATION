import { NextRequest, NextResponse } from "next/server";
import {
  normalizeTeachingProjectTasks,
  teachingProjectRepo,
  type TeachingStudentItem,
} from "@/lib/db/sqlite";
import {
  generateTeachingProjectTasksWithAI,
  getStandardFiveTasksForClass,
} from "@/lib/gemini/teaching-project-generator";
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

    const mode = body?.mode === "template" ? "template" : "ai";
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

    const current = teachingProjectRepo.getOrInit(classCode);
    if (Number(expectedVersion) !== Number(current.draftVersion)) {
      return NextResponse.json(
        {
          success: false,
          conflict: true,
          currentVersion: current.draftVersion,
          error: `Bản nháp dự án lớp ${classCode} đã thay đổi ở phiên bản mới hơn (v${current.draftVersion}).`,
          record: current,
        },
        { status: 409 }
      );
    }

    const endDate = String(body?.endDate || current.endDate || "").trim();
    const courseName = String(body?.courseName || "").trim();

    let students: TeachingStudentItem[] = [];
    try {
      students = JSON.parse(current.studentsJson || "[]");
    } catch {
      students = [];
    }

    const assignedStudentIds: number[] = Array.isArray(body?.assignedStudentIds)
      ? body.assignedStudentIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
      : students
          .filter((s) => !s.status || /đang học|active/i.test(s.status))
          .map((s) => s.id);

    const existingTasks = normalizeTeachingProjectTasks(
      body?.existingTasks ?? current.tasksJson,
      endDate,
      assignedStudentIds
    );

    if (mode === "template") {
      const tplTasks = getStandardFiveTasksForClass(
        classCode,
        endDate,
        assignedStudentIds,
        courseName
      ).map((t, idx) => ({
        ...t,
        taskId: existingTasks[idx]?.taskId ?? null,
      }));

      const saved = teachingProjectRepo.saveDraft({
        classId: classCode,
        endDate: endDate || current.endDate,
        tasks: tplTasks,
        expectedVersion: current.draftVersion,
      });

      if (!saved.success && saved.conflict) {
        return NextResponse.json(
          {
            success: false,
            conflict: true,
            currentVersion: saved.currentVersion,
            error: saved.error,
            record: saved.record,
          },
          { status: 409 }
        );
      }

      return NextResponse.json({
        success: true,
        usedAi: false,
        record: saved.record,
        tasks: normalizeTeachingProjectTasks(
          saved.record.tasksJson,
          saved.record.endDate,
          assignedStudentIds
        ),
      });
    }

    const aiRes = await generateTeachingProjectTasksWithAI({
      classCode,
      courseName,
      endDate,
      assignedStudentIds,
      existingTasks,
      teacherHint: body?.teacherHint,
      studentNamesToRedact: students.map((s) => s.studentName),
    });

    if (!aiRes.success || aiRes.error === "INSUFFICIENT_INFO") {
      return NextResponse.json(
        {
          success: false,
          error:
            aiRes.error === "INSUFFICIENT_INFO"
              ? "INSUFFICIENT_INFO: Chưa tìm thấy giáo trình của mã lớp này và chưa có gợi ý chủ đề từ giáo viên."
              : aiRes.error || "Không thể soạn bộ 5 công việc bằng AI.",
          record: current,
          tasks: existingTasks,
        },
        { status: 400 }
      );
    }

    const saved = teachingProjectRepo.saveDraft({
      classId: classCode,
      endDate: endDate || current.endDate,
      description: current.description || aiRes.projectDescription,
      tasks: aiRes.tasks,
      expectedVersion,
    });

    if (!saved.success && saved.conflict) {
      return NextResponse.json(
        {
          success: false,
          conflict: true,
          currentVersion: saved.currentVersion,
          error: saved.error,
          record: saved.record,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      usedAi: aiRes.usedAi,
      projectDescription: aiRes.projectDescription,
      record: saved.record,
      tasks: normalizeTeachingProjectTasks(
        saved.record.tasksJson,
        saved.record.endDate,
        assignedStudentIds
      ),
      ...(aiRes.error ? { warning: aiRes.error } : {}),
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
