import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { sessionFeedbackRepo, studentRepo, calculateSha256 } from "@/lib/db/sqlite";

function approveSingleItem(params: {
  defaultClassId: string;
  defaultSessionId: string;
  item: any;
  defaultClientInstanceId: string;
  defaultClientRev: number;
  defaultExpectedRowVer: number | null;
}): {
  statusHttp: number;
  studentId: string;
  body: Record<string, any>;
} {
  const {
    defaultClassId,
    defaultSessionId,
    item,
    defaultClientInstanceId,
    defaultClientRev,
    defaultExpectedRowVer,
  } = params;

  const rawClassId = item?.classId ?? defaultClassId;
  const rawSessionId = item?.sessionId ?? defaultSessionId;
  const rawStudentId = item?.studentId;
  const approvedText = item?.approvedText ?? item?.finalText;
  const rawAttendanceStatus = item?.attendanceStatus;
  const rawStatus = item?.status ? String(item.status).trim().toUpperCase() : "";

  const classId = typeof rawClassId === "string" ? rawClassId.trim().toUpperCase() : "";
  const sessionId = typeof rawSessionId === "string" ? rawSessionId.trim() : "";
  const studentId = typeof rawStudentId === "string" ? rawStudentId.trim() : "";

  if (!classId || !sessionId || !studentId) {
    return {
      statusHttp: 400,
      studentId,
      body: {
        success: false,
        studentId,
        error: "Thiếu classId, sessionId hoặc studentId.",
      },
    };
  }

  const escapedClassId = classId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sessionPrefixRegex = new RegExp(`^${escapedClassId}(?:_SESS_|[^a-zA-Z0-9_-])`, "i");
  if (!sessionPrefixRegex.test(sessionId)) {
    return {
      statusHttp: 400,
      studentId,
      body: {
        success: false,
        studentId,
        error: `Mã buổi học '${sessionId}' không thuộc đúng lớp '${classId}'.`,
      },
    };
  }

  const dbStudent = studentRepo.findOne(studentId, classId);
  if (!dbStudent || dbStudent.classId !== classId || dbStudent.isActive !== 1) {
    return {
      statusHttp: 400,
      studentId,
      body: {
        success: false,
        studentId,
        error: `Học viên '${studentId}' không tồn tại trong lớp '${classId}' hoặc đã nghỉ học.`,
      },
    };
  }

  if (approvedText !== undefined && approvedText !== null && typeof approvedText !== "string") {
    return {
      statusHttp: 400,
      studentId,
      body: {
        success: false,
        studentId,
        error: "Nội dung nhận xét phải là chuỗi ký tự hợp lệ.",
      },
    };
  }

  const textToApprove = String(approvedText || "").trim();
  if (textToApprove.length === 0 || textToApprove.startsWith("Chưa đủ thông tin")) {
    return {
      statusHttp: 400,
      studentId,
      body: {
        success: false,
        studentId,
        error: "Nội dung nhận xét không được để trống hoặc chưa đủ thông tin khi duyệt.",
      },
    };
  }

  const existing = sessionFeedbackRepo.findOne(classId, sessionId, studentId);
  const existingStatus = existing?.status ? String(existing.status).trim().toUpperCase() : "";
  if (
    rawStatus === "INSUFFICIENT_INFO" ||
    rawStatus === "FAILED" ||
    existingStatus === "INSUFFICIENT_INFO" ||
    existingStatus === "FAILED"
  ) {
    return {
      statusHttp: 400,
      studentId,
      body: {
        success: false,
        studentId,
        error: `Không thể duyệt học viên đang ở trạng thái '${rawStatus || existingStatus}'.`,
      },
    };
  }
  if (
    rawAttendanceStatus !== undefined &&
    rawAttendanceStatus !== null &&
    rawAttendanceStatus !== "" &&
    rawAttendanceStatus !== "PRESENT" &&
    rawAttendanceStatus !== "LATE"
  ) {
    return {
      statusHttp: 400,
      studentId,
      body: {
        success: false,
        studentId,
        error: `Không thể duyệt nhận xét cho học viên có điểm danh '${rawAttendanceStatus}'. Chỉ học viên có mặt (PRESENT) hoặc đi muộn (LATE) mới được duyệt.`,
      },
    };
  }

  const effectiveAttendance = existing?.attendanceStatus || rawAttendanceStatus || "UNKNOWN";
  if (effectiveAttendance !== "PRESENT" && effectiveAttendance !== "LATE") {
    return {
      statusHttp: 400,
      studentId,
      body: {
        success: false,
        studentId,
        error: `Không thể duyệt nhận xét khi học viên '${studentId}' chưa được xác nhận có mặt hoặc đi muộn (trạng thái hiện tại: ${effectiveAttendance}).`,
      },
    };
  }

  const contentHash = calculateSha256(textToApprove);

  const clientInstanceId =
    typeof item?.clientInstanceId === "string" && item.clientInstanceId.trim()
      ? item.clientInstanceId.trim()
      : defaultClientInstanceId;
  const itemParsedRev = Number(item?.clientRevision ?? item?.rev ?? NaN);
  const clientRev =
    Number.isFinite(itemParsedRev) && itemParsedRev > 0 ? itemParsedRev : defaultClientRev;

  const itemParsedBase =
    item?.expectedRowVer !== undefined &&
    item?.expectedRowVer !== null &&
    item?.expectedRowVer !== ""
      ? Number(item.expectedRowVer)
      : item?.baseRowVer !== undefined && item?.baseRowVer !== null && item?.baseRowVer !== ""
      ? Number(item.baseRowVer)
      : NaN;
  const expectedRowVer =
    Number.isFinite(itemParsedBase) && itemParsedBase >= 0
      ? itemParsedBase
      : defaultExpectedRowVer;

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
      if ((condRes as any).reason === "INVALID_STATUS") {
        return {
          statusHttp: 400,
          studentId,
          body: {
            success: false,
            studentId,
            error: "Không thể duyệt học viên đang ở trạng thái INSUFFICIENT_INFO hoặc FAILED.",
          },
        };
      }
      return {
        statusHttp: 409,
        studentId,
        body: {
          success: false,
          studentId,
          conflict: Boolean(condRes.conflict),
          error:
            "Xung đột phiên bản: Nội dung nhận xét đã được chỉnh sửa mới hơn trước khi yêu cầu duyệt hoàn tất.",
        },
      };
    }

    return {
      statusHttp: 200,
      studentId,
      body: {
        success: true,
        studentId,
        message: "Đã duyệt nhận xét và lưu mã băm toàn vẹn (contentHash).",
        contentHash,
        versionMeta: condRes.versionMeta,
      },
    };
  }

  // Fallback for lightweight mocks without approveConditional
  if (
    existing &&
    (expectedRowVer !== null || clientInstanceId || clientRev > 0) &&
    (existing.finalText || "").trim() !== textToApprove
  ) {
    return {
      statusHttp: 409,
      studentId,
      body: {
        success: false,
        studentId,
        conflict: true,
        error:
          "Xung đột phiên bản: Nội dung nhận xét đã được chỉnh sửa mới hơn trước khi yêu cầu duyệt hoàn tất.",
      },
    };
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

  return {
    statusHttp: 200,
    studentId,
    body: {
      success: true,
      studentId,
      message: "Đã duyệt nhận xét và lưu mã băm toàn vẹn (contentHash).",
      contentHash,
    },
  };
}

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();

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

    const defaultClientInstanceId = cidMatch
      ? cidMatch[1]
      : headerCid || String(body?.clientInstanceId || "");
    const parsedRev = Number(
      revMatch ? revMatch[1] : headerRev || String(body?.clientRevision ?? "0")
    );
    const defaultClientRev = Number.isFinite(parsedRev) && parsedRev > 0 ? parsedRev : 0;

    const rawBaseStr = baseMatch
      ? baseMatch[1]
      : headerBase || (body?.expectedRowVer !== undefined ? String(body.expectedRowVer) : "");
    const parsedBase = rawBaseStr !== "" ? Number(rawBaseStr) : NaN;
    const defaultExpectedRowVer =
      Number.isFinite(parsedBase) && parsedBase >= 0 ? parsedBase : null;

    const batchItems: any[] | null = Array.isArray(body?.items)
      ? body.items
      : Array.isArray(body)
      ? body
      : null;

    if (batchItems !== null) {
      if (batchItems.length === 0) {
        return NextResponse.json(
          { success: false, error: "Danh sách nhận xét cần duyệt trống." },
          { status: 400 }
        );
      }

      const defaultClassId = typeof body?.classId === "string" ? body.classId : "";
      const defaultSessionId = typeof body?.sessionId === "string" ? body.sessionId : "";

      const results: Array<Record<string, any>> = [];
      const contentHashByStudent: Record<string, string> = {};
      const versionMetaByStudent: Record<string, any> = {};
      let approvedCount = 0;
      let failedCount = 0;
      let firstError = "";
      let firstFailureStatus = 400;

      for (const rawItem of batchItems) {
        let itemRes: {
          statusHttp: number;
          studentId: string;
          body: Record<string, any>;
        };
        try {
          itemRes = approveSingleItem({
            defaultClassId,
            defaultSessionId,
            item: rawItem,
            defaultClientInstanceId,
            defaultClientRev,
            defaultExpectedRowVer,
          });
        } catch (itemErr: any) {
          const fallbackStudentId =
            typeof rawItem?.studentId === "string" ? rawItem.studentId.trim() : "";
          itemRes = {
            statusHttp: 500,
            studentId: fallbackStudentId,
            body: {
              success: false,
              studentId: fallbackStudentId,
              error: itemErr instanceof Error ? itemErr.message : String(itemErr),
            },
          };
        }
        results.push(itemRes.body);
        if (itemRes.body.success) {
          approvedCount++;
          if (itemRes.studentId && itemRes.body.contentHash) {
            contentHashByStudent[itemRes.studentId] = itemRes.body.contentHash;
          }
          if (itemRes.studentId && itemRes.body.versionMeta) {
            versionMetaByStudent[itemRes.studentId] = itemRes.body.versionMeta;
          }
        } else {
          failedCount++;
          if (!firstError && itemRes.body.error) {
            firstError = itemRes.body.error;
            firstFailureStatus = itemRes.statusHttp;
          }
        }
      }

      if (batchItems.length === 1) {
        const single = results[0];
        return NextResponse.json(
          {
            ...single,
            batch: true,
            approvedCount,
            failedCount,
            results,
            contentHashByStudent,
            versionMetaByStudent,
          },
          { status: failedCount === 0 ? 200 : firstFailureStatus }
        );
      }

      return NextResponse.json(
        {
          success: failedCount === 0,
          batch: true,
          approvedCount,
          failedCount,
          results,
          contentHashByStudent,
          versionMetaByStudent,
          ...(failedCount > 0
            ? { error: firstError || "Một số nhận xét không thể duyệt." }
            : { message: `Đã duyệt hàng loạt ${approvedCount}/${batchItems.length} nhận xét.` }),
        },
        { status: failedCount === 0 ? 200 : firstFailureStatus }
      );
    }

    const singleRes = approveSingleItem({
      defaultClassId: typeof body?.classId === "string" ? body.classId : "",
      defaultSessionId: typeof body?.sessionId === "string" ? body.sessionId : "",
      item: body,
      defaultClientInstanceId,
      defaultClientRev,
      defaultExpectedRowVer,
    });

    return NextResponse.json(singleRes.body, { status: singleRes.statusHttp });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
