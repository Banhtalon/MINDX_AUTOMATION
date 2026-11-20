import { NextResponse } from "next/server";
import { validateLocalRequest, parseJsonPlainObjectBody } from "@/lib/security/local-guard";
import { classroomSessionLogRepo } from "@/lib/db/sqlite";
import {
  buildClassroomSessionsList,
  buildClassroomStatePayload,
  parseValidatedClassId,
  parseValidatedSessionNumber,
  syncSessionTop3MedalsInDb,
  validateAndNormalizeSaveItems,
} from "@/lib/classroom/classroom-server-helpers";

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  const parsedBody = await parseJsonPlainObjectBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const body = parsedBody.body;
    const classId = parseValidatedClassId(body.classId);
    if (!classId) {
      return NextResponse.json(
        { success: false, error: "Thiếu hoặc sai định dạng mã lớp (classId)." },
        { status: 400 }
      );
    }

    const sessionNumber = parseValidatedSessionNumber(body.sessionNumber);
    if (!sessionNumber) {
      return NextResponse.json(
        { success: false, error: "Số buổi học (sessionNumber) phải là số nguyên từ 1 đến 14." },
        { status: 400 }
      );
    }

    const sessions = buildClassroomSessionsList(classId);
    const sessionInfo = sessions.find((s) => s.sessionNumber === sessionNumber);
    const sessionId = sessionInfo?.sessionId || `${classId}_SESS_${sessionNumber}`;

    const validation = validateAndNormalizeSaveItems({
      classId,
      sessionNumber,
      sessionId,
      rawItems: body.items,
    });

    if (!validation.ok) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: 400 }
      );
    }

    const savedResults = classroomSessionLogRepo.upsertBatch(validation.upsertInputs);
    if (savedResults.some((r) => !r.staleIgnored)) {
      syncSessionTop3MedalsInDb(classId, sessionNumber);
    }
    const state = buildClassroomStatePayload({
      requestedClassId: classId,
      requestedSessionNumber: sessionNumber,
    });

    return NextResponse.json({
      success: true,
      savedCount: savedResults.filter((r) => !r.staleIgnored).length,
      staleIgnoredCount: savedResults.filter((r) => r.staleIgnored).length,
      results: savedResults.map((r) => ({
        studentId: r.studentId,
        staleIgnored: r.staleIgnored,
        rowVer: r.record.rowVer,
      })),
      data: state,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Lỗi máy chủ khi lưu dữ liệu giờ học.";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
