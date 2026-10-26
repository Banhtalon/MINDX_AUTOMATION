import { NextResponse } from "next/server";
import {
  assertClassHasSpckSession,
  studentRepo,
} from "@/lib/db/sqlite";
import { SpckUploader } from "@/lib/playwright/spck-uploader";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { buildEnrichedClassSpckRecords } from "../list/route";

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const classId = String(body?.classId || "").trim().toUpperCase();
    const studentIds: string[] | undefined = Array.isArray(body?.studentIds)
      ? body.studentIds.map((id: any) => String(id).trim()).filter(Boolean)
      : body?.studentId
      ? [String(body.studentId).trim()]
      : undefined;

    if (!classId) {
      return NextResponse.json(
        {
          success: false,
          error: "Thiếu mã lớp (classId) khi thực hiện Upload SPCK lên LMS.",
        },
        { status: 400 }
      );
    }

    let sessionNumber: 12 | 13 | 14;
    try {
      const stageInfo = assertClassHasSpckSession(classId, body?.sessionNumber);
      sessionNumber = stageInfo.sessionNumber;
    } catch (sessionErr) {
      return NextResponse.json(
        {
          success: false,
          error:
            sessionErr instanceof Error
              ? sessionErr.message
              : "Buổi nộp SPCK không hợp lệ hoặc chưa được chọn.",
        },
        { status: 400 }
      );
    }

    if (studentIds && studentIds.length > 0) {
      for (const sid of studentIds) {
        const stu = studentRepo.findOne(sid, classId);
        if (!stu) {
          return NextResponse.json(
            {
              success: false,
              error: `Học viên '${sid}' không thuộc lớp '${classId}'. Hệ thống đã chặn thao tác nộp bài.`,
            },
            { status: 400 }
          );
        }
      }
    }

    if (String(body?.action || "").toLowerCase() === "clear") {
      const clearResult = await SpckUploader.clearSessionSpck({
        classId,
        sessionNumber,
        studentIds,
      });
      return NextResponse.json({
        success: true,
        clearResult,
        records: buildEnrichedClassSpckRecords(classId, sessionNumber),
      });
    }

    const uploadResult = await SpckUploader.uploadApprovedSpck({
      classId,
      sessionNumber,
      studentIds,
    });

    const updatedRecords = buildEnrichedClassSpckRecords(classId, sessionNumber);

    return NextResponse.json({
      success: true,
      uploadResult,
      records: updatedRecords,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isClientErr =
      message.includes("Buổi nộp SPCK") ||
      message.includes("không tồn tại trong danh sách buổi học") ||
      message.includes("không thuộc lớp");
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: isClientErr ? 400 : 500 }
    );
  }
}
