import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { sessionFeedbackRepo, studentRepo, calculateSha256 } from "@/lib/db/sqlite";

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const {
      classId: rawClassId,
      sessionId: rawSessionId,
      studentId: rawStudentId,
      approvedText,
      attendanceStatus: rawAttendanceStatus,
    } = body;
    const classId = typeof rawClassId === "string" ? rawClassId.trim().toUpperCase() : "";
    const sessionId = typeof rawSessionId === "string" ? rawSessionId.trim() : "";
    const studentId = typeof rawStudentId === "string" ? rawStudentId.trim() : "";

    if (!classId || !sessionId || !studentId) {
      return NextResponse.json(
        { success: false, error: "Thiếu classId, sessionId hoặc studentId." },
        { status: 400 }
      );
    }

    const escapedClassId = classId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sessionPrefixRegex = new RegExp(`^${escapedClassId}(?:_SESS_|[^a-zA-Z0-9_-])`, "i");
    if (!sessionPrefixRegex.test(sessionId)) {
      return NextResponse.json(
        {
          success: false,
          error: `Mã buổi học '${sessionId}' không thuộc đúng lớp '${classId}'.`,
        },
        { status: 400 }
      );
    }

    const dbStudent = studentRepo.findOne(studentId, classId);
    if (!dbStudent || dbStudent.classId !== classId || dbStudent.isActive !== 1) {
      return NextResponse.json(
        {
          success: false,
          error: `Học viên '${studentId}' không tồn tại trong lớp '${classId}' hoặc đã nghỉ học.`,
        },
        { status: 400 }
      );
    }

    const textToApprove = (approvedText || "").trim();
    if (textToApprove.length === 0) {
      return NextResponse.json(
        { success: false, error: "Nội dung nhận xét không được để trống khi duyệt." },
        { status: 400 }
      );
    }

    const existing = sessionFeedbackRepo.findOne(classId, sessionId, studentId);
    if (
      rawAttendanceStatus !== undefined &&
      rawAttendanceStatus !== null &&
      rawAttendanceStatus !== "" &&
      rawAttendanceStatus !== "PRESENT" &&
      rawAttendanceStatus !== "LATE"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: `Không thể duyệt nhận xét cho học viên có điểm danh '${rawAttendanceStatus}'. Chỉ học viên có mặt (PRESENT) hoặc đi muộn (LATE) mới được duyệt.`,
        },
        { status: 400 }
      );
    }

    const effectiveAttendance = existing?.attendanceStatus || rawAttendanceStatus || "UNKNOWN";
    if (effectiveAttendance !== "PRESENT" && effectiveAttendance !== "LATE") {
      return NextResponse.json(
        {
          success: false,
          error: `Không thể duyệt nhận xét khi học viên '${studentId}' chưa được xác nhận có mặt hoặc đi muộn (trạng thái hiện tại: ${effectiveAttendance}).`,
        },
        { status: 400 }
      );
    }

    const contentHash = calculateSha256(textToApprove);

    const rawUrl = typeof req?.url === "string" ? req.url : "";
    const cidMatch = rawUrl.match(/[?&]cid=([a-zA-Z0-9_-]+)/);
    const revMatch = rawUrl.match(/[?&]rev=(\d+)/);
    const baseMatch = rawUrl.match(/[?&]base=(\d+)/);
    const headerCid =
      typeof req?.headers?.get === "function" ? req.headers.get("x-client-instance") || "" : "";
    const headerRev =
      typeof req?.headers?.get === "function" ? req.headers.get("x-edit-revision") || "" : "";
    const headerBase =
      typeof req?.headers?.get === "function" ? req.headers.get("x-base-revision") || "" : "";

    const clientInstanceId = cidMatch ? cidMatch[1] : headerCid || String(body?.clientInstanceId || "");
    const parsedRev = Number(
      revMatch ? revMatch[1] : headerRev || String(body?.clientRevision ?? "0")
    );
    const clientRev = Number.isFinite(parsedRev) && parsedRev > 0 ? parsedRev : 0;

    const rawBaseStr = baseMatch
      ? baseMatch[1]
      : headerBase || (body?.expectedRowVer !== undefined ? String(body.expectedRowVer) : "");
    const parsedBase = rawBaseStr !== "" ? Number(rawBaseStr) : NaN;
    const expectedRowVer = Number.isFinite(parsedBase) && parsedBase >= 0 ? parsedBase : null;

    if (typeof (sessionFeedbackRepo as any).approveConditional === "function") {
      const condRes = (sessionFeedbackRepo as any).approveConditional({
        classId,
        sessionId,
        studentId,
        attendanceStatus: effectiveAttendance,
        finalText: textToApprove,
        contentHash,
        expectedRowVer,
        clientInstanceId,
        clientRev,
      });

      if (!condRes.approved) {
        return NextResponse.json(
          {
            success: false,
            conflict: Boolean(condRes.conflict),
            error:
              "Xung đột phiên bản: Nội dung nhận xét đã được chỉnh sửa mới hơn trước khi yêu cầu duyệt hoàn tất.",
          },
          { status: 409 }
        );
      }

      return NextResponse.json({
        success: true,
        message: "Đã duyệt nhận xét và lưu mã băm toàn vẹn (contentHash).",
        contentHash,
        versionMeta: condRes.versionMeta,
      });
    }

    // Fallback for lightweight mocks without approveConditional
    if (
      existing &&
      (expectedRowVer !== null || clientInstanceId || clientRev > 0) &&
      (existing.finalText || "").trim() !== textToApprove
    ) {
      return NextResponse.json(
        {
          success: false,
          conflict: true,
          error:
            "Xung đột phiên bản: Nội dung nhận xét đã được chỉnh sửa mới hơn trước khi yêu cầu duyệt hoàn tất.",
        },
        { status: 409 }
      );
    }

    sessionFeedbackRepo.upsert({
      classId,
      sessionId,
      studentId,
      attendanceStatus: effectiveAttendance,
      quickTagsJson: existing?.quickTagsJson,
      teacherNote: existing?.teacherNote,
      strengths: existing?.strengths,
      improvements: existing?.improvements,
      actionPlan: existing?.actionPlan,
      finalText: textToApprove,
      contentHash,
      status: "APPROVED",
    });

    return NextResponse.json({
      success: true,
      message: "Đã duyệt nhận xét và lưu mã băm toàn vẹn (contentHash).",
      contentHash,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
