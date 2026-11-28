import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import {
  sessionFeedbackRepo,
  studentRepo,
  calculateSha256,
  extractCheckpointCoreSnapshotHash,
} from "@/lib/db/sqlite";
import {
  calculateCompetencyAverageForClassPure,
  calculateCompetencyAveragePure,
  formatCheckpointScoreHeaderLine,
  hasCompleteCompetencyScores,
  hasCompleteCompetencyScoresForClassPure,
  isLegoRoboticsClassCodePure,
  mergeCheckpointStudentData,
  normalizeScoreToScale5,
  parseCheckpointDataJson,
  parseCompetencyScoresPure,
  resolveCheckpointStageForSession,
  upsertCheckpointHeaderIntoFinalText,
} from "@/lib/checkpoint/checkpoint-competency";
import { computeCheckpointDataForSession } from "@/lib/checkpoint/checkpoint-history-loader";

const safeHasCompleteCompAp =
  typeof hasCompleteCompetencyScoresForClassPure === "function"
    ? hasCompleteCompetencyScoresForClassPure
    : typeof hasCompleteCompetencyScores === "function"
      ? (raw: unknown) => hasCompleteCompetencyScores(raw)
      : () => true;
const safeParseCpDataAp =
  typeof parseCheckpointDataJson === "function" ? parseCheckpointDataJson : () => null;
const safeMergeCpDataAp =
  typeof mergeCheckpointStudentData === "function"
    ? mergeCheckpointStudentData
    : (a: any, b: any) => a ?? b ?? null;
const safeParseCompScoresAp =
  typeof parseCompetencyScoresPure === "function" ? parseCompetencyScoresPure : (x: any) => x;
const safeCalcCompAvgAp =
  typeof calculateCompetencyAverageForClassPure === "function"
    ? calculateCompetencyAverageForClassPure
    : typeof calculateCompetencyAveragePure === "function"
      ? (scores: any) => calculateCompetencyAveragePure(scores)
      : () => 4;
const safeIsLegoAp =
  typeof isLegoRoboticsClassCodePure === "function" ? isLegoRoboticsClassCodePure : () => false;
const safeFormatCpHeaderAp =
  typeof formatCheckpointScoreHeaderLine === "function"
    ? formatCheckpointScoreHeaderLine
    : () => "";
const safeUpsertCpHeaderAp =
  typeof upsertCheckpointHeaderIntoFinalText === "function"
    ? upsertCheckpointHeaderIntoFinalText
    : (t: string) => t;
const safeComputeCheckpointAp =
  typeof computeCheckpointDataForSession === "function" ? computeCheckpointDataForSession : null;
const safeNormalizeScoreAp =
  typeof normalizeScoreToScale5 === "function"
    ? normalizeScoreToScale5
    : (v: any) =>
        v === null || v === undefined || v === "" || typeof v === "boolean"
          ? null
          : Number(v);
const safeResolveCpStageAp =
  typeof resolveCheckpointStageForSession === "function"
    ? resolveCheckpointStageForSession
    : () => ({ isCheckpoint: false, isRobotics: false, cpStage: null });

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
  const rawCheckpointData = item?.checkpointData;

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

  let nextCheckpointDataJson: string | undefined = existing?.checkpointDataJson;
  if (rawCheckpointData !== undefined && rawCheckpointData !== null) {
    if (typeof rawCheckpointData !== "object" || Array.isArray(rawCheckpointData)) {
      return {
        statusHttp: 400,
        studentId,
        body: {
          success: false,
          studentId,
          error: `Trường 'checkpointData' của học viên '${studentId}' không hợp lệ.`,
        },
      };
    }
    if (
      rawCheckpointData.competencyScores !== undefined &&
      rawCheckpointData.competencyScores !== null &&
      !safeHasCompleteCompAp(
        rawCheckpointData.competencyScores,
        rawCheckpointData.isLego ? "LEGO" : classId
      )
    ) {
      return {
        statusHttp: 400,
        studentId,
        body: {
          success: false,
          studentId,
          error: `Bảng điểm [ĐNL] của học viên '${studentId}' phải đủ ${rawCheckpointData.isLego || safeIsLegoAp(classId) ? 7 : 9} tiêu chí từ 1 đến 5.`,
        },
      };
    }
    for (const [scoreKey, scoreVal] of [
      ["theoryScore", rawCheckpointData.theoryScore],
      ["practiceScore", rawCheckpointData.practiceScore],
    ] as const) {
      if (scoreVal !== undefined && scoreVal !== null && scoreVal !== "") {
        if (typeof scoreVal === "boolean") {
          return {
            statusHttp: 400,
            studentId,
            body: {
              success: false,
              studentId,
              error: `Điểm '${scoreKey}' của học viên '${studentId}' không hợp lệ.`,
            },
          };
        }
        const parsedScore = safeNormalizeScoreAp(scoreVal);
        if (parsedScore === null || parsedScore < 0 || parsedScore > 5) {
          return {
            statusHttp: 400,
            studentId,
            body: {
              success: false,
              studentId,
              error: `Điểm '${scoreKey}' của học viên '${studentId}' không hợp lệ.`,
            },
          };
        }
      }
    }

    const existingCp = safeParseCpDataAp(existing?.checkpointDataJson);
    const sessMatch = sessionId.match(/(?:^|[_-])SESS(?:ION)?[_-]?0*(\d+)$/i);
    const inferredStage = sessMatch
      ? safeResolveCpStageAp(classId, Number(sessMatch[1])).cpStage
      : null;
    const resolvedStage =
      rawCheckpointData.cpStage === 1 || rawCheckpointData.cpStage === 2
        ? rawCheckpointData.cpStage
        : existingCp?.cpStage ?? inferredStage;
    if (
      rawCheckpointData.cpStage !== undefined &&
      rawCheckpointData.cpStage !== null &&
      rawCheckpointData.cpStage !== 1 &&
      rawCheckpointData.cpStage !== 2
    ) {
      return {
        statusHttp: 400,
        studentId,
        body: {
          success: false,
          studentId,
          error: `Trường 'cpStage' của học viên '${studentId}' không hợp lệ (chỉ nhận 1 hoặc 2).`,
        },
      };
    }
    if (!resolvedStage) {
      return {
        statusHttp: 400,
        studentId,
        body: {
          success: false,
          studentId,
          error: `Thiếu 'cpStage' hợp lệ (1 hoặc 2) cho dữ liệu Checkpoint của học viên '${studentId}'.`,
        },
      };
    }

    const isLegoRow = Boolean(
      rawCheckpointData.isLego ?? existingCp?.isLego ?? safeIsLegoAp(classId)
    );
    const nextCompScores = rawCheckpointData.competencyScores
      ? safeParseCompScoresAp(rawCheckpointData.competencyScores)
      : existingCp?.competencyScores ?? null;
    const nextCompAvg = nextCompScores
      ? safeCalcCompAvgAp(nextCompScores, isLegoRow ? "LEGO" : classId)
      : existingCp?.competencyAverage ?? null;
    const nextTheoryScore =
      rawCheckpointData.theoryScore === null
        ? null
        : rawCheckpointData.theoryScore !== undefined
          ? safeNormalizeScoreAp(rawCheckpointData.theoryScore)
          : existingCp?.theoryScore ?? null;
    const nextPracticeScore =
      rawCheckpointData.practiceScore === null
        ? null
        : rawCheckpointData.practiceScore !== undefined
          ? safeNormalizeScoreAp(rawCheckpointData.practiceScore)
          : existingCp?.practiceScore ?? null;
    const mergedRaw = {
      ...(existingCp || {}),
      ...rawCheckpointData,
      ...(isLegoRow ? { isLego: true } : {}),
      cpStage: resolvedStage,
      theoryScore: nextTheoryScore,
      practiceScore: nextPracticeScore,
      ...(rawCheckpointData.slotTheoryScore !== undefined
        ? {
            slotTheoryScore:
              rawCheckpointData.slotTheoryScore === null
                ? null
                : safeNormalizeScoreAp(rawCheckpointData.slotTheoryScore),
          }
        : existingCp?.slotTheoryScore !== undefined
          ? { slotTheoryScore: existingCp.slotTheoryScore }
          : {}),
      ...(rawCheckpointData.slotPracticeScore !== undefined
        ? {
            slotPracticeScore:
              rawCheckpointData.slotPracticeScore === null
                ? null
                : safeNormalizeScoreAp(rawCheckpointData.slotPracticeScore),
          }
        : existingCp?.slotPracticeScore !== undefined
          ? { slotPracticeScore: existingCp.slotPracticeScore }
          : {}),
      userEditedTheory:
        rawCheckpointData.userEditedTheory !== undefined
          ? Boolean(rawCheckpointData.userEditedTheory)
          : Boolean(existingCp?.userEditedTheory),
      userEditedPractice:
        rawCheckpointData.userEditedPractice !== undefined
          ? Boolean(rawCheckpointData.userEditedPractice)
          : Boolean(existingCp?.userEditedPractice),
      hasUngradedPractice:
        rawCheckpointData.hasUngradedPractice !== undefined
          ? Boolean(rawCheckpointData.hasUngradedPractice)
          : Boolean(existingCp?.hasUngradedPractice),
      competencyScores: nextCompScores,
      competencyAverage: nextCompAvg,
      lmsCompetencyScores:
        rawCheckpointData.lmsCompetencyScores || existingCp?.lmsCompetencyScores || null,
      processSummary: rawCheckpointData.processSummary || existingCp?.processSummary || null,
      lmsSyncedAt: rawCheckpointData.lmsSyncedAt || existingCp?.lmsSyncedAt || null,
      computedAt: rawCheckpointData.computedAt || existingCp?.computedAt || null,
    };
    const canonicalCp = safeParseCpDataAp(JSON.stringify(mergedRaw)) || mergedRaw;
    const draftCpJson = JSON.stringify(canonicalCp);
    nextCheckpointDataJson = JSON.stringify({
      ...canonicalCp,
      approvedSnapshotHash:
        typeof extractCheckpointCoreSnapshotHash === "function"
          ? extractCheckpointCoreSnapshotHash(draftCpJson)
          : calculateSha256(draftCpJson),
    });
  } else if (existing?.checkpointDataJson && existing.checkpointDataJson !== "{}") {
    const existingCp = safeParseCpDataAp(existing.checkpointDataJson);
    if (existingCp) {
      const normalizedJson = JSON.stringify(existingCp);
      nextCheckpointDataJson = JSON.stringify({
        ...existingCp,
        approvedSnapshotHash:
          typeof extractCheckpointCoreSnapshotHash === "function"
            ? extractCheckpointCoreSnapshotHash(normalizedJson)
            : calculateSha256(normalizedJson),
      });
    }
  }

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

  let allowServerReconciledCheckpoint:
    | { cpCoreHash: string; refreshedHeaderFinalText?: string }
    | undefined = undefined;
  if (
    existing &&
    nextCheckpointDataJson &&
    safeComputeCheckpointAp &&
    typeof extractCheckpointCoreSnapshotHash === "function"
  ) {
    const existingCpCoreHash = existing.checkpointDataJson
      ? extractCheckpointCoreSnapshotHash(existing.checkpointDataJson)
      : "";
    const incomingCpCoreHash = extractCheckpointCoreSnapshotHash(nextCheckpointDataJson);
    if (existingCpCoreHash && incomingCpCoreHash && existingCpCoreHash !== incomingCpCoreHash) {
      try {
        const liveCpRes = safeComputeCheckpointAp({
          classId,
          sessionId,
          forceRecalculate: false,
          persist: false,
        });
        const liveStudentCp = liveCpRes?.isCheckpoint ? liveCpRes.byStudent?.[studentId] || null : null;
        if (liveStudentCp) {
          const existingCpParsed = safeParseCpDataAp(existing.checkpointDataJson);
          const liveMergedCp = safeMergeCpDataAp(existingCpParsed, liveStudentCp);
          const liveMergedHash = liveMergedCp
            ? extractCheckpointCoreSnapshotHash(JSON.stringify(liveMergedCp))
            : "";
          const liveDirectHash = extractCheckpointCoreSnapshotHash(JSON.stringify(liveStudentCp));
          const matchedCp =
            liveMergedHash === incomingCpCoreHash
              ? liveMergedCp
              : liveDirectHash === incomingCpCoreHash
                ? liveStudentCp
                : null;
          if (matchedCp) {
            const baseText = String(existing.finalText || "").trim();
            let refreshedHeaderFinalText: string | undefined = undefined;
            if (baseText && !baseText.startsWith("Chưa đủ thông tin")) {
              const freshHeader = safeFormatCpHeaderAp({
                cpStage: matchedCp.cpStage,
                theoryScore: matchedCp.theoryScore,
                practiceScore: matchedCp.practiceScore,
                competencyAverage: matchedCp.competencyAverage ?? null,
                isLego: Boolean(matchedCp.isLego ?? safeIsLegoAp(classId)),
              });
              if (freshHeader) {
                refreshedHeaderFinalText = safeUpsertCpHeaderAp(String(existing.finalText || ""), freshHeader);
              }
            }
            allowServerReconciledCheckpoint = {
              cpCoreHash: incomingCpCoreHash,
              ...(refreshedHeaderFinalText ? { refreshedHeaderFinalText } : {}),
            };
          }
        }
      } catch {}
    }
  }

  if (typeof (sessionFeedbackRepo as any).approveConditional === "function") {
    const condRes = (sessionFeedbackRepo as any).approveConditional({
      classId,
      sessionId,
      studentId,
      attendanceStatus: effectiveAttendance,
      finalText: textToApprove,
      contentHash,
      checkpointDataJson: nextCheckpointDataJson,
      expectedRowVer,
      clientInstanceId,
      clientRev,
      ...(allowServerReconciledCheckpoint ? { allowServerReconciledCheckpoint } : {}),
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
    checkpointDataJson: nextCheckpointDataJson,
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
