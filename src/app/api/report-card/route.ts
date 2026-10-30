import { NextRequest, NextResponse } from "next/server";
import { type RunningClassItem } from "@/lib/db/json-config";
import {
  isRoboticsClassCode,
  parseManualOverridesMap,
  parseReportCardLmsSnapshot,
  reportCardRepo,
  session14EvalRepo,
  studentRepo,
  type SpckSession14EvaluationRecord,
} from "@/lib/db/sqlite";
import { parseStrictPositiveIntInput } from "@/lib/playwright/teaching-project-service";
import {
  computeClassReportCard,
  round2,
  type ClassReportCardLmsSnapshot,
} from "@/lib/report-card/report-card-calculator";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { listClasses } from "@/lib/classes/class-directory";
import { enqueueScrapeClassScores } from "@/app/api/homework-grader/scores/route";

export interface ReportCardStalenessInfo {
  isStale: boolean;
  hasNewerSession14: boolean;
  missingCheckpointScores: boolean;
  missingCp1: boolean;
  missingCp2: boolean;
  latestSession14UpdatedAt: string | null;
  scrapedAt: string | null;
  reasons: string[];
}

function parseDbOrIsoTimestampMs(raw: string | null | undefined): number | null {
  if (!raw || !String(raw).trim()) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(s)) {
    const t = new Date(s.replace(" ", "T")).getTime();
    return Number.isFinite(t) ? t : null;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function normalizeStudentNameKey(name: string | null | undefined): string {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hasEvaluatedSession14Record(r: SpckSession14EvaluationRecord): boolean {
  return (
    (typeof r.demoTotalScore === "number" &&
      Number.isFinite(r.demoTotalScore) &&
      r.demoTotalScore > 0) ||
    r.status === "APPROVED" ||
    r.status === "VERIFIED" ||
    Boolean(String(r.learnedFromMindx || "").trim())
  );
}

export function computeReportCardStaleness(
  classId: string,
  parsedSnapshot: ClassReportCardLmsSnapshot | null
): ReportCardStalenessInfo {
  const cleanClassId = String(classId || "").trim().toUpperCase();
  const s14Rows = session14EvalRepo.findByClass(cleanClassId);
  const scrapedAt = parsedSnapshot?.scrapedAt || null;
  const scrapedAtMs = parseDbOrIsoTimestampMs(scrapedAt);

  let latestSession14UpdatedAt: string | null = null;
  let latestS14Ms: number | null = null;

  for (const r of s14Rows) {
    const ms = parseDbOrIsoTimestampMs(r.updatedAt);
    if (ms !== null && (latestS14Ms === null || ms > latestS14Ms)) {
      latestS14Ms = ms;
      latestSession14UpdatedAt = r.updatedAt || null;
    }
  }

  let hasNewerSession14 = false;
  const evaluatedRows = s14Rows.filter(hasEvaluatedSession14Record);
  if (evaluatedRows.length > 0) {
    if (!parsedSnapshot || scrapedAtMs === null) {
      hasNewerSession14 = true;
    } else {
      const snapStudents = parsedSnapshot.students || [];
      const existingStudents = studentRepo.findByClass(cleanClassId, false);
      const existingById = new Map(
        existingStudents.map((st) => [String(st.studentId || "").trim(), st])
      );

      // Build Session 14 evaluation maps using the exact same rules as ScoreScraper
      const evalByStudentId = new Map<string, SpckSession14EvaluationRecord>();
      const evalByNormName = new Map<string, SpckSession14EvaluationRecord>();
      for (const ev of s14Rows) {
        const sid = String(ev?.studentId || "").trim();
        if (!sid) continue;
        evalByStudentId.set(sid, ev);
        const matchedSt = existingById.get(sid);
        if (matchedSt) {
          evalByNormName.set(normalizeStudentNameKey(matchedSt.fullName), ev);
        }
      }

      const findSession14EvalForSnapshotStudent = (
        s: (typeof snapStudents)[number]
      ): SpckSession14EvaluationRecord | undefined => {
        const sid = String(s.studentId || "").trim();
        const crmId = String((s as any).crmStudentId || "").trim();
        const suid = String(s.studentUid || "").trim();
        const lmsUid = String((s as any).lmsStudentUid || "").trim();

        const direct =
          (sid ? evalByStudentId.get(sid) : undefined) ||
          (crmId ? evalByStudentId.get(crmId) : undefined) ||
          (suid ? evalByStudentId.get(suid) : undefined) ||
          (lmsUid ? evalByStudentId.get(lmsUid) : undefined);
        if (direct) return direct;

        const normName = normalizeStudentNameKey(s.fullName);
        if (normName && evalByNormName.has(normName)) {
          return evalByNormName.get(normName);
        }
        if (!normName) return undefined;

        const expectedSlugId = `STU_${cleanClassId}_${normName
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .toUpperCase()}`;
        return evalByStudentId.get(expectedSlugId);
      };

      const knownSnapshotEvalKeys = new Set<string>();
      for (const s of snapStudents) {
        const sid = String(s.studentId || "").trim();
        const crmId = String((s as any).crmStudentId || "").trim();
        const suid = String(s.studentUid || "").trim();
        const lmsUid = String((s as any).lmsStudentUid || "").trim();
        if (sid) knownSnapshotEvalKeys.add(sid);
        if (crmId) knownSnapshotEvalKeys.add(crmId);
        if (suid) knownSnapshotEvalKeys.add(suid);
        if (lmsUid) knownSnapshotEvalKeys.add(lmsUid);

        const normName = normalizeStudentNameKey(s.fullName);
        if (normName) {
          const expectedSlugId = `STU_${cleanClassId}_${normName
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "")
            .toUpperCase()}`;
          knownSnapshotEvalKeys.add(expectedSlugId);
          for (const st of existingStudents) {
            if (normalizeStudentNameKey(st.fullName) === normName) {
              knownSnapshotEvalKeys.add(String(st.studentId || "").trim());
            }
          }
        }

        const matchedEval = findSession14EvalForSnapshotStudent(s);
        if (!matchedEval || !hasEvaluatedSession14Record(matchedEval)) {
          continue;
        }

        const evalMs = parseDbOrIsoTimestampMs(matchedEval.updatedAt);
        if (evalMs !== null && evalMs > scrapedAtMs) {
          hasNewerSession14 = true;
          break;
        }

        if (
          typeof matchedEval.demoTotalScore === "number" &&
          Number.isFinite(matchedEval.demoTotalScore) &&
          matchedEval.demoTotalScore >= 0
        ) {
          const expectedProduct = round2(
            Math.max(0, Math.min(5, matchedEval.demoTotalScore))
          );
          if (s.stageScores?.finalProduct !== expectedProduct) {
            hasNewerSession14 = true;
            break;
          }
        }

        if (
          typeof matchedEval.competencyTotalScore === "number" &&
          Number.isFinite(matchedEval.competencyTotalScore) &&
          matchedEval.competencyTotalScore > 0
        ) {
          const expectedCompetency = round2(
            Math.max(0, Math.min(5, matchedEval.competencyTotalScore))
          );
          if (s.stageScores?.finalCompetency !== expectedCompetency) {
            hasNewerSession14 = true;
            break;
          }
        }
      }

      if (!hasNewerSession14) {
        for (const r of evaluatedRows) {
          const sid = String(r.studentId || "").trim();
          if (sid && !knownSnapshotEvalKeys.has(sid)) {
            hasNewerSession14 = true;
            break;
          }
        }
      }
    }
  }

  const activeStudents = (parsedSnapshot?.students || []).filter(
    (s) => s.isActive !== false
  );
  const missingCp1 =
    activeStudents.length > 0 &&
    activeStudents.every(
      (s) =>
        s.stageScores?.cp1Theory == null &&
        s.stageScores?.cp1Practice == null &&
        s.stageScores?.cp1Competency == null
    );
  const missingCp2 =
    activeStudents.length > 0 &&
    activeStudents.every(
      (s) =>
        s.stageScores?.cp2Theory == null &&
        s.stageScores?.cp2Practice == null &&
        s.stageScores?.cp2Competency == null
    );
  const missingCheckpointScores = missingCp1 || missingCp2;
  const isStale = hasNewerSession14 || missingCheckpointScores;

  const reasons: string[] = [];
  if (hasNewerSession14) {
    reasons.push("Có dữ liệu Buổi 14 mới, bấm Quét lại");
  }
  if (missingCheckpointScores) {
    reasons.push(
      missingCp1 && missingCp2
        ? "Chưa có điểm Check-point 1 & 2 trên bản quét hiện tại"
        : missingCp1
        ? "Chưa có điểm Check-point 1 trên bản quét hiện tại"
        : "Chưa có điểm Check-point 2 trên bản quét hiện tại"
    );
  }

  return {
    isStale,
    hasNewerSession14,
    missingCheckpointScores,
    missingCp1,
    missingCp2,
    latestSession14UpdatedAt,
    scrapedAt,
    reasons,
  };
}

function listAvailableClassesForReportCard(): RunningClassItem[] {
  return listClasses({ scope: "running" });
}

function resolveRequestClassIdentity(
  rawClassId: unknown,
  rawClassCode: unknown
): { ok: true; classId: string } | { ok: false; error: string } {
  const cid =
    rawClassId !== undefined && rawClassId !== null
      ? String(rawClassId).trim().toUpperCase()
      : "";
  const ccode =
    rawClassCode !== undefined && rawClassCode !== null
      ? String(rawClassCode).trim().toUpperCase()
      : "";

  if (cid && ccode && cid !== ccode) {
    return {
      ok: false,
      error: `Mã lớp classId (${cid}) và classCode (${ccode}) không đồng nhất.`,
    };
  }

  const resolved = cid || ccode;
  if (!resolved) {
    return {
      ok: false,
      error: "Thiếu mã lớp (classId / classCode).",
    };
  }

  return { ok: true, classId: resolved };
}

function buildReportCardResponsePayload(
  classId: string,
  options?: {
    selectedBtvnSessions?: number[];
    includeInactiveStudents?: boolean;
  }
) {
  const record = reportCardRepo.getOrInit(classId);
  const parsedSnapshot = parseReportCardLmsSnapshot(
    record.lmsSnapshotJson,
    classId
  );
  const snapshot = parsedSnapshot ?? {
    classId: record.classId,
    classCode: record.classCode,
    isRobotics: isRoboticsClassCode(classId),
    btvnSessions: [],
    students: [],
    scrapedAt: "",
  };
  const overrides = parseManualOverridesMap(record.manualOverridesJson);
  const reportCard = computeClassReportCard(snapshot, overrides, options);
  const staleness = computeReportCardStaleness(classId, parsedSnapshot);

  return {
    classId: record.classId,
    classCode: record.classCode,
    isRobotics: Boolean(snapshot.isRobotics || isRoboticsClassCode(classId)),
    record,
    snapshot: parsedSnapshot,
    overrides,
    reportCard,
    staleness,
  };
}

function executeApproveReportCard(
  classId: string,
  expectedVersion: number
): NextResponse {
  const approveRes = reportCardRepo.approveReportCard(classId, expectedVersion);
  const payload = buildReportCardResponsePayload(classId);

  if (!approveRes.success) {
    return NextResponse.json(
      {
        success: false,
        conflict: approveRes.conflict,
        currentVersion: approveRes.currentVersion,
        error: approveRes.error,
        ...payload,
      },
      { status: approveRes.conflict ? 409 : 400 }
    );
  }

  return NextResponse.json({
    success: true,
    ...payload,
  });
}

export async function GET(request: NextRequest) {
  const guardError = validateLocalRequest(request);
  if (guardError) return guardError;

  try {
    const { searchParams } = new URL(request.url);
    const rawClassId = searchParams.get("classId");
    const rawClassCode = searchParams.get("classCode");
    const classes = listAvailableClassesForReportCard();

    if (
      (!rawClassId || !rawClassId.trim()) &&
      (!rawClassCode || !rawClassCode.trim())
    ) {
      return NextResponse.json({
        success: true,
        classes,
      });
    }

    const identity = resolveRequestClassIdentity(rawClassId, rawClassCode);
    if (!identity.ok) {
      return NextResponse.json(
        { success: false, error: identity.error },
        { status: 400 }
      );
    }

    const payload = buildReportCardResponsePayload(identity.classId);

    return NextResponse.json({
      success: true,
      classes,
      ...payload,
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

async function parseJsonObjectBody(
  request: NextRequest
): Promise<
  | { ok: true; body: Record<string, any> }
  | { ok: false; response: NextResponse }
> {
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            success: false,
            error: "Dữ liệu gửi lên phải là một đối tượng JSON hợp lệ.",
          },
          { status: 400 }
        ),
      };
    }
    return { ok: true, body: parsed as Record<string, any> };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error: "Cú pháp JSON trong yêu cầu không hợp lệ.",
        },
        { status: 400 }
      ),
    };
  }
}

export async function POST(request: NextRequest) {
  const guardError = validateLocalRequest(request);
  if (guardError) return guardError;

  const parsedBody = await parseJsonObjectBody(request);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.body;

  try {
    const action =
      body.action !== undefined ? String(body.action).trim() : "approve";
    const identity = resolveRequestClassIdentity(body?.classId, body?.classCode);
    if (!identity.ok) {
      return NextResponse.json(
        { success: false, error: identity.error },
        { status: 400 }
      );
    }
    const classId = identity.classId;

    if (action === "scrape_lms") {
      const scrapeRes = await enqueueScrapeClassScores(classId);

      const payload = buildReportCardResponsePayload(classId);
      if (!scrapeRes.success) {
        return NextResponse.json(
          {
            success: false,
            error:
              scrapeRes.error || `Không thể lấy điểm từ LMS cho lớp ${classId}.`,
            ...payload,
          },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        ...payload,
      });
    }

    if (action === "approve") {
      const expectedVersion = parseStrictPositiveIntInput(body?.expectedVersion);
      if (expectedVersion === null) {
        return NextResponse.json(
          {
            success: false,
            error: "Thiếu phiên bản bản nháp hợp lệ (expectedVersion).",
          },
          { status: 400 }
        );
      }

      return executeApproveReportCard(classId, expectedVersion);
    }

    return NextResponse.json(
      { success: false, error: `Hành động không hợp lệ: ${action}` },
      { status: 400 }
    );
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

export async function PUT(request: NextRequest) {
  const guardError = validateLocalRequest(request);
  if (guardError) return guardError;

  const parsedBody = await parseJsonObjectBody(request);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.body;

  try {
    const identity = resolveRequestClassIdentity(body?.classId, body?.classCode);
    if (!identity.ok) {
      return NextResponse.json(
        { success: false, error: identity.error },
        { status: 400 }
      );
    }
    const classId = identity.classId;

    const expectedVersion = parseStrictPositiveIntInput(body?.expectedVersion);
    if (expectedVersion === null) {
      return NextResponse.json(
        {
          success: false,
          error: "Thiếu phiên bản bản nháp hợp lệ (expectedVersion).",
        },
        { status: 400 }
      );
    }

    const hasExplicitAction =
      Object.prototype.hasOwnProperty.call(body, "action") &&
      body.action !== undefined;

    if (hasExplicitAction) {
      if (typeof body.action !== "string" || !body.action.trim()) {
        return NextResponse.json(
          { success: false, error: "Tham số action không hợp lệ." },
          { status: 400 }
        );
      }
      const action = body.action.trim();
      const hasUpdatesPayload =
        body.updates !== undefined || body.patchOverrides !== undefined;
      const hasRestorePayload = body.restoreLms !== undefined;

      if (action === "approve") {
        if (hasUpdatesPayload || hasRestorePayload) {
          return NextResponse.json(
            {
              success: false,
              error:
                "Hành động approve không được đi kèm updates hoặc restoreLms.",
            },
            { status: 400 }
          );
        }
        return executeApproveReportCard(classId, expectedVersion);
      }

      if (action === "clear_override") {
        if (hasUpdatesPayload) {
          return NextResponse.json(
            {
              success: false,
              error:
                "Hành động clear_override không được đi kèm dữ liệu ghi đè (updates / patchOverrides).",
            },
            { status: 400 }
          );
        }
        const studentId = String(
          body.studentId ?? body.restoreLms?.studentId ?? ""
        ).trim();
        const fieldKey = String(
          body.fieldKey ?? body.restoreLms?.fieldKey ?? ""
        ).trim();
        if (!studentId || studentId === "*" || !fieldKey) {
          return NextResponse.json(
            {
              success: false,
              error:
                "Thiếu studentId hoặc fieldKey hợp lệ khi thực hiện clear_override.",
            },
            { status: 400 }
          );
        }
        const restoreRes = reportCardRepo.restoreLmsValues({
          classId,
          expectedVersion,
          studentId,
          fieldKey,
        });
        const payload = buildReportCardResponsePayload(classId);
        if (!restoreRes.success) {
          return NextResponse.json(
            {
              success: false,
              conflict: restoreRes.conflict,
              currentVersion: restoreRes.currentVersion,
              error: restoreRes.error,
              ...payload,
            },
            { status: restoreRes.conflict ? 409 : 400 }
          );
        }
        return NextResponse.json({
          success: true,
          ...payload,
        });
      }

      if (action === "reset_student_overrides") {
        if (hasUpdatesPayload) {
          return NextResponse.json(
            {
              success: false,
              error:
                "Hành động reset_student_overrides không được đi kèm dữ liệu ghi đè (updates / patchOverrides).",
            },
            { status: 400 }
          );
        }
        const studentId = String(
          body.studentId ?? body.restoreLms?.studentId ?? ""
        ).trim();
        if (!studentId || studentId === "*") {
          return NextResponse.json(
            {
              success: false,
              error:
                "Thiếu studentId hợp lệ khi thực hiện reset_student_overrides.",
            },
            { status: 400 }
          );
        }
        const restoreRes = reportCardRepo.restoreLmsValues({
          classId,
          expectedVersion,
          studentId,
        });
        const payload = buildReportCardResponsePayload(classId);
        if (!restoreRes.success) {
          return NextResponse.json(
            {
              success: false,
              conflict: restoreRes.conflict,
              currentVersion: restoreRes.currentVersion,
              error: restoreRes.error,
              ...payload,
            },
            { status: restoreRes.conflict ? 409 : 400 }
          );
        }
        return NextResponse.json({
          success: true,
          ...payload,
        });
      }

      if (action === "reset_all_overrides") {
        if (hasUpdatesPayload) {
          return NextResponse.json(
            {
              success: false,
              error:
                "Hành động reset_all_overrides không được đi kèm dữ liệu ghi đè (updates / patchOverrides).",
            },
            { status: 400 }
          );
        }
        const restoreRes = reportCardRepo.restoreLmsValues({
          classId,
          expectedVersion,
          studentId: "*",
        });
        const payload = buildReportCardResponsePayload(classId);
        if (!restoreRes.success) {
          return NextResponse.json(
            {
              success: false,
              conflict: restoreRes.conflict,
              currentVersion: restoreRes.currentVersion,
              error: restoreRes.error,
              ...payload,
            },
            { status: restoreRes.conflict ? 409 : 400 }
          );
        }
        return NextResponse.json({
          success: true,
          ...payload,
        });
      }

      if (action !== "set_override" && action !== "save_overrides") {
        return NextResponse.json(
          {
            success: false,
            error: `Hành động PUT không hợp lệ: ${action}`,
          },
          { status: 400 }
        );
      }

      if (hasRestorePayload) {
        return NextResponse.json(
          {
            success: false,
            error: `Hành động ${action} không được đi kèm restoreLms.`,
          },
          { status: 400 }
        );
      }
    } else if (
      body.restoreLms !== undefined &&
      (body.updates !== undefined || body.patchOverrides !== undefined)
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Không được truyền đồng thời restoreLms và dữ liệu ghi đè (updates / patchOverrides).",
        },
        { status: 400 }
      );
    }

    // 1. Handle restoreLmsValues if requested (when no explicit set_override action)
    if (body?.restoreLms && typeof body.restoreLms === "object") {
      const studentId = String(body.restoreLms.studentId || "").trim();
      const fieldKey = body.restoreLms.fieldKey
        ? String(body.restoreLms.fieldKey).trim()
        : undefined;
      if (!studentId) {
        return NextResponse.json(
          { success: false, error: "Thiếu studentId khi khôi phục điểm LMS." },
          { status: 400 }
        );
      }
      const restoreRes = reportCardRepo.restoreLmsValues({
        classId,
        expectedVersion,
        studentId,
        fieldKey,
      });
      const payload = buildReportCardResponsePayload(classId);
      if (!restoreRes.success) {
        return NextResponse.json(
          {
            success: false,
            conflict: restoreRes.conflict,
            currentVersion: restoreRes.currentVersion,
            error: restoreRes.error,
            ...payload,
          },
          { status: restoreRes.conflict ? 409 : 400 }
        );
      }
      return NextResponse.json({
        success: true,
        ...payload,
      });
    }

    // 2. Reject conflicting override payload sources before building updates
    const hasUpdatesSource = body.updates !== undefined;
    const hasPatchOverridesSource = body.patchOverrides !== undefined;
    const hasTopLevelOverrideSource =
      body.studentId !== undefined ||
      body.fieldKey !== undefined ||
      body.normScore !== undefined ||
      body.rawScore !== undefined ||
      body.maxScore !== undefined ||
      body.note !== undefined;

    const overrideSourceCount =
      (hasUpdatesSource ? 1 : 0) +
      (hasPatchOverridesSource ? 1 : 0) +
      (hasTopLevelOverrideSource ? 1 : 0);

    if (overrideSourceCount > 1) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Yêu cầu chứa nhiều nguồn dữ liệu ghi đè điểm mâu thuẫn (updates, patchOverrides và các trường top-level không được truyền đồng thời).",
        },
        { status: 400 }
      );
    }

    // 3. Build updates array from body.updates, body.patchOverrides, or top-level single override
    const updates: Array<{
      studentId: string;
      fieldKey: string;
      normScore: number | null;
      rawScore?: number | null;
      maxScore?: number;
      note?: string;
    }> = [];

    if (Array.isArray(body?.updates)) {
      for (const item of body.updates) {
        updates.push({
          studentId: String(item?.studentId || "").trim(),
          fieldKey: String(item?.fieldKey || "").trim(),
          normScore: item?.normScore ?? null,
          ...(item?.rawScore !== undefined ? { rawScore: item.rawScore } : {}),
          ...(item?.maxScore !== undefined ? { maxScore: item.maxScore } : {}),
          ...(item?.note !== undefined ? { note: item.note } : {}),
        });
      }
    } else if (body?.patchOverrides && typeof body.patchOverrides === "object") {
      for (const [compKey, val] of Object.entries(body.patchOverrides)) {
        const sepIdx = compKey.indexOf("::");
        if (sepIdx <= 0) continue;
        const studentId = compKey.slice(0, sepIdx).trim();
        const fieldKey = compKey.slice(sepIdx + 2).trim();
        if (val && typeof val === "object") {
          const obj = val as any;
          updates.push({
            studentId,
            fieldKey,
            normScore: obj.normScore ?? obj.value ?? null,
            ...(obj.rawScore !== undefined ? { rawScore: obj.rawScore } : {}),
            ...(obj.maxScore !== undefined ? { maxScore: obj.maxScore } : {}),
            ...(obj.note !== undefined ? { note: obj.note } : {}),
          });
        } else {
          updates.push({
            studentId,
            fieldKey,
            normScore: val as number | null,
          });
        }
      }
    } else if (
      typeof body?.studentId === "string" &&
      body.studentId.trim() &&
      typeof body?.fieldKey === "string" &&
      body.fieldKey.trim() &&
      (body.normScore !== undefined || body.rawScore !== undefined)
    ) {
      updates.push({
        studentId: body.studentId.trim(),
        fieldKey: body.fieldKey.trim(),
        normScore: body.normScore ?? null,
        ...(body.rawScore !== undefined ? { rawScore: body.rawScore } : {}),
        ...(body.maxScore !== undefined ? { maxScore: body.maxScore } : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
      });
    }

    if (updates.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Không có dữ liệu cập nhật điểm (updates / patchOverrides).",
        },
        { status: 400 }
      );
    }

    const saveRes = reportCardRepo.saveManualOverrides({
      classId,
      expectedVersion,
      updates,
    });

    const payload = buildReportCardResponsePayload(classId);

    if (!saveRes.success) {
      return NextResponse.json(
        {
          success: false,
          conflict: saveRes.conflict,
          currentVersion: saveRes.currentVersion,
          error: saveRes.error,
          ...payload,
        },
        { status: saveRes.conflict ? 409 : 400 }
      );
    }

    return NextResponse.json({
      success: true,
      ...payload,
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
