import { NextRequest, NextResponse } from "next/server";
import { getRunningClasses, type RunningClassItem } from "@/lib/db/json-config";
import {
  getDb,
  isRoboticsClassCode,
  parseManualOverridesMap,
  parseReportCardLmsSnapshot,
  reportCardRepo,
} from "@/lib/db/sqlite";
import { ScoreScraper } from "@/lib/playwright/scrape-scores";
import { resolveClassDateRangeInfo } from "@/lib/playwright/sync-class";
import { parseStrictPositiveIntInput } from "@/lib/playwright/teaching-project-service";
import { taskQueue } from "@/lib/queue/task-queue";
import { computeClassReportCard } from "@/lib/report-card/report-card-calculator";
import { validateLocalRequest } from "@/lib/security/local-guard";

function listAvailableClassesForReportCard(): RunningClassItem[] {
  const running = getRunningClasses();
  const map = new Map<string, RunningClassItem>();

  for (const item of running) {
    const code = String(item.classCode || "").trim().toUpperCase();
    if (!code || /^(TEST|AUDIT|R\d+|CLASS_|SYNTH)/i.test(code)) continue;
    map.set(code, { ...item, classCode: code });
  }

  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT classId, MAX(className) AS className
         FROM classes_sessions
         GROUP BY classId
         ORDER BY MAX(updatedAt) DESC`
      )
      .all() as Array<{ classId: string; className?: string }>;

    for (const r of rows) {
      const code = String(r.classId || "").trim().toUpperCase();
      if (!code || /^(TEST|AUDIT|R\d+|CLASS_|SYNTH)/i.test(code)) continue;
      if (!map.has(code)) {
        const range = resolveClassDateRangeInfo(code);
        map.set(code, {
          classCode: code,
          courseName:
            r.className && r.className !== code ? r.className : range.courseName,
          status: "Running",
          ...(range.startDateDmy ? { startDate: range.startDateDmy } : {}),
          ...(range.endDateDmy ? { endDate: range.endDateDmy } : {}),
        });
      }
    }
  } catch {
    // ignore DB errors
  }

  return Array.from(map.values());
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

  return {
    classId: record.classId,
    classCode: record.classCode,
    isRobotics: Boolean(snapshot.isRobotics || isRoboticsClassCode(classId)),
    record,
    snapshot: parsedSnapshot,
    overrides,
    reportCard,
  };
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

    const visibleParam = searchParams.get("visibleSessions");
    let selectedBtvnSessions: number[] | undefined = undefined;
    if (visibleParam !== null && visibleParam.trim() !== "") {
      const parsedSessions: number[] = [];
      for (const part of visibleParam.split(",")) {
        const sn = parseStrictPositiveIntInput(part.trim());
        if (sn !== null) parsedSessions.push(sn);
      }
      selectedBtvnSessions = parsedSessions;
    }

    const payload = buildReportCardResponsePayload(identity.classId, {
      selectedBtvnSessions,
    });

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
      const jobId = `rc_scrape_${classId}_${Date.now()}`;
      const scrapeRes = await taskQueue.enqueue({
        id: jobId,
        jobType: "SCRAPE_SCORES",
        classId,
        description: `Quét điểm LMS (BTVN, CP1, CP2, Final DEMO) cho lớp ${classId}`,
        execute: async () => await ScoreScraper.scrapeClassScores(classId),
      });

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
        const approveRes = reportCardRepo.approveReportCard(
          classId,
          expectedVersion
        );
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
