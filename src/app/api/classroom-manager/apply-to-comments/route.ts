import { NextResponse } from "next/server";
import { validateLocalRequest, parseJsonPlainObjectBody } from "@/lib/security/local-guard";
import {
  applyClassroomLogsToSessionComments,
  buildClassroomSessionsList,
  parseValidatedClassId,
  parseValidatedSessionNumber,
  validateAndNormalizeSaveItems,
} from "@/lib/classroom/classroom-server-helpers";
import type { ClassroomSessionLogUpsertInput } from "@/lib/db/sqlite";

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

    let upsertInputs: ClassroomSessionLogUpsertInput[] | undefined = undefined;
    if (body.items !== undefined) {
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
      upsertInputs = validation.upsertInputs;
    }

    const result = applyClassroomLogsToSessionComments({
      classId,
      sessionNumber,
      upsertInputs,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : "Lỗi máy chủ khi chuyển dữ liệu sang trang Nhận xét buổi học.";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
