import { NextResponse } from "next/server";
import {
  parseSession14CompetencyScores,
  parseSession14DemoScores,
  session14EvalRepo,
  studentRepo,
} from "@/lib/db/sqlite";
import { validateLocalRequest } from "@/lib/security/local-guard";

export function buildEnrichedSession14EvalList(classId: string) {
  const normalizedClassId = String(classId || "").trim().toUpperCase();
  const students = studentRepo.findByClass(normalizedClassId, false);
  return students.map((stu) => {
    const rec = session14EvalRepo.getOrInit(normalizedClassId, stu.studentId);
    let quickTags: string[] = [];
    try {
      quickTags = JSON.parse(rec.quickTagsJson || "[]");
    } catch {
      quickTags = [];
    }
    return {
      ...rec,
      fullName: stu.fullName,
      competencyScores: parseSession14CompetencyScores(rec.competencyJson),
      demoScores: parseSession14DemoScores(rec.demoScoresJson),
      quickTags,
    };
  });
}

export async function GET(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const { searchParams } = new URL(req.url);
    const classId = String(searchParams.get("classId") || "").trim().toUpperCase();
    if (!classId) {
      return NextResponse.json(
        { success: false, error: "Thiếu mã lớp (classId)." },
        { status: 400 }
      );
    }

    const records = buildEnrichedSession14EvalList(classId);
    return NextResponse.json({
      success: true,
      classId,
      records,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const classId = String(body?.classId || "").trim().toUpperCase();
    const action = String(body?.action || "save_draft").trim();

    if (!classId) {
      return NextResponse.json(
        { success: false, error: "Thiếu mã lớp (classId)." },
        { status: 400 }
      );
    }

    if (action === "approve") {
      const studentIds: string[] = Array.isArray(body?.studentIds)
        ? body.studentIds.map((s: unknown) => String(s || "").trim()).filter(Boolean)
        : body?.studentId
        ? [String(body.studentId).trim()]
        : [];

      if (studentIds.length === 0) {
        return NextResponse.json(
          { success: false, error: "Thiếu danh sách học viên (studentIds) cần duyệt." },
          { status: 400 }
        );
      }

      const approvedIds: string[] = [];
      const errors: Array<{ studentId: string; error: string; conflict?: boolean }> = [];
      let hasConflict = false;
      const hasExpectedVersionsProp = body?.expectedVersions !== undefined;
      const expectedVersionsMap =
        hasExpectedVersionsProp &&
        body.expectedVersions &&
        typeof body.expectedVersions === "object" &&
        !Array.isArray(body.expectedVersions)
          ? (body.expectedVersions as Record<string, unknown>)
          : null;

      if (hasExpectedVersionsProp && !expectedVersionsMap) {
        return NextResponse.json(
          {
            success: false,
            approvedIds: [],
            error: "Trường expectedVersions phải là đối tượng bản đồ phiên bản hợp lệ.",
            records: buildEnrichedSession14EvalList(classId),
          },
          { status: 400 }
        );
      }

      const validatedVersions = new Map<string, number>();
      for (const sid of studentIds) {
        const rawVer = expectedVersionsMap
          ? Object.prototype.hasOwnProperty.call(expectedVersionsMap, sid)
            ? expectedVersionsMap[sid]
            : undefined
          : studentIds.length === 1
          ? body?.expectedVersion
          : undefined;

        if (
          typeof rawVer !== "number" ||
          !Number.isFinite(rawVer) ||
          !Number.isInteger(rawVer) ||
          rawVer < 1
        ) {
          errors.push({
            studentId: sid,
            error: `Thiếu phiên bản khóa (expectedVersion) hợp lệ cho học viên ${sid} khi duyệt.`,
          });
        } else {
          validatedVersions.set(sid, rawVer);
        }
      }

      if (errors.length > 0) {
        return NextResponse.json(
          {
            success: false,
            approvedIds: [],
            errors,
            error: errors[0].error,
            records: buildEnrichedSession14EvalList(classId),
          },
          { status: 400 }
        );
      }

      // Pre-check all versions before mutating any student record
      for (const sid of studentIds) {
        const current = session14EvalRepo.getOrInit(classId, sid);
        const expectedVer = validatedVersions.get(sid)!;
        if (current.draftVersion !== expectedVer) {
          hasConflict = true;
          errors.push({
            studentId: sid,
            conflict: true,
            error: `Bản nháp đánh giá Buổi 14 của học viên ${sid} đã thay đổi (expected=${expectedVer}, current=${current.draftVersion}).`,
          });
        }
      }

      if (hasConflict) {
        return NextResponse.json(
          {
            success: false,
            conflict: true,
            approvedIds: [],
            errors,
            error: errors[0].error,
            records: buildEnrichedSession14EvalList(classId),
          },
          { status: 409 }
        );
      }

      for (const sid of studentIds) {
        const expectedVer = validatedVersions.get(sid)!;
        const res = session14EvalRepo.approveDraft(classId, sid, expectedVer);
        if (res.success) {
          approvedIds.push(sid);
        } else {
          if (res.conflict) hasConflict = true;
          errors.push({
            studentId: sid,
            error: res.error || "Không thể duyệt bản ghi.",
            conflict: res.conflict,
          });
        }
      }

      return NextResponse.json(
        {
          success: errors.length === 0,
          conflict: hasConflict || undefined,
          approvedIds,
          errors,
          records: buildEnrichedSession14EvalList(classId),
        },
        { status: errors.length === 0 ? 200 : hasConflict ? 409 : 400 }
      );
    }

    // Default: save_draft for a single student
    const studentId = String(body?.studentId || "").trim();
    if (!studentId) {
      return NextResponse.json(
        { success: false, error: "Thiếu mã học viên (studentId)." },
        { status: 400 }
      );
    }

    const saved = session14EvalRepo.saveDraft({
      classId,
      studentId,
      expectedVersion:
        typeof body?.expectedVersion === "number" && Number.isFinite(body.expectedVersion)
          ? body.expectedVersion
          : undefined,
      competencyScores: body?.competencyScores,
      demoScores: body?.demoScores,
      demoSourcePath: body?.demoSourcePath,
      demoJudgeNote: body?.demoJudgeNote,
      learnedFromMindx: body?.learnedFromMindx,
      suggestionsFromMindx: body?.suggestionsFromMindx,
      futureDirection: body?.futureDirection,
      quickTags: body?.quickTags,
      teacherNote: body?.teacherNote,
    });

    if (saved.conflict) {
      return NextResponse.json(
        {
          success: false,
          conflict: true,
          currentVersion: saved.currentVersion,
          record: saved.record,
          error: `Bản nháp đánh giá Buổi 14 đã có phiên bản mới hơn (${saved.currentVersion}).`,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      record: saved.record,
      records: buildEnrichedSession14EvalList(classId),
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
