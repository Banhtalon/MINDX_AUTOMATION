import { NextResponse } from "next/server";
import { studentRepo } from "@/lib/db/sqlite";
import {
  Session14CourseSummaryGenerator,
  type Session14EvalStudentInput,
} from "@/lib/gemini/session14-course-summary";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { buildEnrichedSession14EvalList } from "../route";

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const classId = String(body?.classId || "").trim().toUpperCase();
    const rawStudents: any[] = Array.isArray(body?.students) ? body.students : [];

    if (!classId || rawStudents.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Thiếu mã lớp (classId) hoặc danh sách học viên (students) để AI soạn Thư tổng kết Buổi 14.",
        },
        { status: 400 }
      );
    }

    const roster = studentRepo.findByClass(classId, false);
    const rosterMap = new Map(roster.map((s) => [s.studentId, s]));

    const inputs: Session14EvalStudentInput[] = [];
    for (const s of rawStudents) {
      const studentId = String(s?.studentId || "").trim();
      const dbStu = rosterMap.get(studentId);
      if (!dbStu) {
        return NextResponse.json(
          {
            success: false,
            error: `Học viên "${studentId}" không thuộc lớp ${classId}.`,
          },
          { status: 400 }
        );
      }

      inputs.push({
        studentId,
        fullName: dbStu.fullName,
        expectedVersion:
          typeof s?.expectedVersion === "number" && Number.isFinite(s.expectedVersion)
            ? s.expectedVersion
            : undefined,
        competencyScores: s?.competencyScores,
        demoScores: s?.demoScores,
        quickTags: Array.isArray(s?.quickTags) ? s.quickTags : undefined,
        teacherNote: typeof s?.teacherNote === "string" ? s.teacherNote : undefined,
      });
    }

    const results = await Session14CourseSummaryGenerator.generateBatch(classId, inputs);
    const records = buildEnrichedSession14EvalList(classId);

    return NextResponse.json({
      success: true,
      classId,
      results,
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
