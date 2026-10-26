import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { CommentGenerator } from "@/lib/gemini/comment-generator";
import { studentRepo } from "@/lib/db/sqlite";

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const { session, students } = body;

    if (!session || !students || !Array.isArray(students)) {
      return NextResponse.json(
        { success: false, error: "Dữ liệu buổi học hoặc danh sách học viên không hợp lệ." },
        { status: 400 }
      );
    }

    const normalizedClassId =
      typeof session.classId === "string" ? session.classId.trim().toUpperCase() : "";
    const normalizedClassCode =
      typeof session.classCode === "string" && session.classCode.trim()
        ? session.classCode.trim().toUpperCase()
        : normalizedClassId;
    const normalizedSessionId =
      typeof session.sessionId === "string" ? session.sessionId.trim() : "";

    if (!normalizedClassId || !normalizedSessionId) {
      return NextResponse.json(
        { success: false, error: "Thiếu classId hoặc sessionId bắt buộc khi gọi AI." },
        { status: 400 }
      );
    }

    if (normalizedClassId !== normalizedClassCode) {
      return NextResponse.json(
        {
          success: false,
          error: `Xung đột mã lớp: classId ('${normalizedClassId}') khác classCode ('${normalizedClassCode}').`,
        },
        { status: 400 }
      );
    }

    const escapedClassId = normalizedClassId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sessionPrefixRegex = new RegExp(`^${escapedClassId}(?:_SESS_|[^a-zA-Z0-9_-])`, "i");
    if (!sessionPrefixRegex.test(normalizedSessionId)) {
      return NextResponse.json(
        {
          success: false,
          error: `Mã buổi học '${normalizedSessionId}' không thuộc đúng lớp '${normalizedClassId}'.`,
        },
        { status: 400 }
      );
    }

    const normalizedSession = {
      ...session,
      classId: normalizedClassId,
      classCode: normalizedClassCode,
      sessionId: normalizedSessionId,
    };

    const eligibleStudents = students.filter((st: any) => {
      if (!st || !st.studentId) return false;
      if (st.isActive === false || st.isActive === 0) return false;
      const dbStudent =
        typeof studentRepo?.findOne === "function"
          ? studentRepo.findOne(st.studentId, normalizedSession.classId)
          : undefined;
      if (!dbStudent || dbStudent.isActive !== 1) return false;
      return st.attendanceStatus === "PRESENT" || st.attendanceStatus === "LATE";
    });

    const results = await CommentGenerator.generateBatchComments(normalizedSession, eligibleStudents);

    return NextResponse.json({
      success: true,
      data: results,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
