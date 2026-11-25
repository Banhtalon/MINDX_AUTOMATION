import crypto from "node:crypto";
import type { Page } from "playwright";
import { config, getDynamicAdminConfig } from "../config";
import {
  adminCenterRepo,
  getDb,
  isLegoRoboticsClassCode,
  isRoboticsClassCode,
  jobLogRepo,
  normalizeDateToIsoYmd,
  type AdminCenterClassRecord,
  type StudentRecord,
} from "../db/sqlite";
import { buildLmsClassCommentsUrl, isValidLmsClassCode } from "../lms/lms-class-url";
import { LMS_FIND_STUDENT_LETTERS_BY_CLASS_QUERY } from "../lms/lms-graphql-queries";
import {
  isLmsApiReadEnabled,
  isQueueStoppedError,
  lmsHttpClient,
  paceLmsBatchRequest,
} from "../lms/lms-http-client";
import {
  AuthService,
  authService,
  extractIdentityFromMindxCookies,
} from "../playwright/auth";
import { LmsHelpers } from "../playwright/lms-helpers";
import { createNetworkInterceptor } from "../playwright/network-interceptor";
import { ScoreScraper } from "../playwright/scrape-scores";
import { SELECTORS } from "../playwright/selectors";
import type { RemoteTeachingScoreRow } from "../playwright/teaching-report-card-sync";
import { redactSecrets, sanitizeErrorMessage } from "../security/secret-redactor";
import {
  isConfirmedRunningStatus,
  ONE_DAY_MS,
  parseClassDateToEndOfDayMs,
  parseSlotOrClassDateToEndOfDayMs,
} from "../playwright/sync-class";
import { taskQueue } from "../queue/task-queue";
import { getStandardFiveTasksForClass } from "../gemini/teaching-project-generator";
import { computeClassReportCard } from "../report-card/report-card-calculator";
import { mapSessionToTeachingProgressMilestone } from "../teaching/session-progress-mapper";
import { ensureQueueNotStopped } from "../teaching/teaching-http-client";
import { normalizeVietnameseName } from "../utils/vietnamese-match";
import {
  fetchAdminTeachingOverviewPages,
  fetchTeachingClassDetailsBatch,
  isCompletedOrCancelledMakeupStatus,
  isMakeupCancelledStatus,
  isMakeupCompletedStatus,
  isTeachingCheckLateOrMissing,
  type AdminTeachingHttpFetcherDeps,
  type TeachingCheckNhanXetEntry,
  type TeachingHocBuEntry,
  type TeachingPerClassDetail,
  type TeachingScheduleClassEntry,
} from "./admin-teaching-scraper";
import { buildInstructorSummariesAndCampusText } from "./admin-zalo-reminder";
import type {
  AdminBlockType,
  AdminBtvnCodingSummary,
  AdminCenterOverviewResponse,
  AdminClassRowDto,
  AdminEarlyWarningItem,
  AdminOverviewKpis,
  AdminScanProgressState,
  AdminSpckAuditSummary,
  AdminSpckSlotAuditItem,
  AdminSpckTeachingTasksSummary,
  AdminWeeklyCheckpointAlert,
  AdminWeeklyOpsSummary,
} from "./admin-types";

export type AdminScanScope =
  | "ALL"
  | "CODING_ONLY"
  | "SINGLE_CLASS"
  | "TEACHING_ONLY";

export function normalizeAdminDateToIsoYmd(rawDate: unknown): string {
  if (typeof rawDate === "number" && Number.isFinite(rawDate) && rawDate > 0) {
    const ms = rawDate > 1e12 ? rawDate : rawDate * 1000;
    const vn = new Date(ms + 7 * 60 * 60 * 1000);
    if (Number.isFinite(vn.getTime())) {
      const y = String(vn.getUTCFullYear()).padStart(4, "0");
      const m = String(vn.getUTCMonth() + 1).padStart(2, "0");
      const d = String(vn.getUTCDate()).padStart(2, "0");
      return normalizeDateToIsoYmd(`${y}-${m}-${d}`);
    }
    return "";
  }
  const text = String(rawDate ?? "").trim();
  if (!text || text === "0000-00-00") return "";
  if (/^\d{10,13}$/.test(text)) {
    return normalizeAdminDateToIsoYmd(Number(text));
  }
  const fromSqlite = normalizeDateToIsoYmd(text);
  if (fromSqlite) return fromSqlite;
  const parsedMs = Date.parse(text);
  if (Number.isFinite(parsedMs)) {
    const vn = new Date(parsedMs + 7 * 60 * 60 * 1000);
    if (Number.isFinite(vn.getTime())) {
      const y = String(vn.getUTCFullYear()).padStart(4, "0");
      const m = String(vn.getUTCMonth() + 1).padStart(2, "0");
      const d = String(vn.getUTCDate()).padStart(2, "0");
      return normalizeDateToIsoYmd(`${y}-${m}-${d}`);
    }
  }
  return "";
}

export function isAdminFinishedClassWithinGraceWindow(
  rawEndDate: unknown,
  graceDays: number = 14,
  nowMs: number = Date.now()
): boolean {
  const iso = normalizeAdminDateToIsoYmd(rawEndDate);
  if (!iso) return false;
  const endOfDayMs = parseClassDateToEndOfDayMs(iso);
  if (endOfDayMs === null) return false;
  const diffMs = nowMs - endOfDayMs;
  return diffMs <= graceDays * ONE_DAY_MS && diffMs >= -14 * ONE_DAY_MS;
}

/**
 * PTB & CSB courses are exempt from Demo / SPCK on MindX LHP curriculum.
 */
export function isAdminSpckExemptClass(
  classCode?: string | null,
  courseName?: string | null
): boolean {
  const combined = `${String(classCode || "")} ${String(courseName || "")}`.toUpperCase();
  if (!combined.trim()) return false;
  return /(?:^|[-_\s])(PTB|CSB)(?:\d|$|[-_\s])/i.test(combined);
}

const globalScanState = globalThis as unknown as {
  __mindxAdminScanProgress?: AdminScanProgressState;
};

function initProgressState(): AdminScanProgressState {
  if (!globalScanState.__mindxAdminScanProgress) {
    globalScanState.__mindxAdminScanProgress = {
      isRunning: false,
      runId: null,
      scanScope: null,
      totalClasses: 0,
      scannedClasses: 0,
      currentClassCode: null,
      stopAfterCurrentRequested: false,
      lastError: null,
      startedAt: null,
      finishedAt: null,
    };
  }
  return globalScanState.__mindxAdminScanProgress;
}

export function getAdminScanProgressState(): AdminScanProgressState {
  return { ...initProgressState() };
}

export function requestStopAdminScanAfterCurrent(): AdminScanProgressState {
  const state = initProgressState();
  if (state.isRunning) {
    state.stopAfterCurrentRequested = true;
  }
  return { ...state };
}

export function resetAdminScanProgressForTest(): void {
  const state = initProgressState();
  Object.assign(state, {
    isRunning: false,
    runId: null,
    scanScope: null,
    totalClasses: 0,
    scannedClasses: 0,
    currentClassCode: null,
    stopAfterCurrentRequested: false,
    lastError: null,
    startedAt: null,
    finishedAt: null,
  });
}

export function mapSessionToCompletedTaskMilestoneCount(
  sessionNumber: number
): number {
  return mapSessionToTeachingProgressMilestone(sessionNumber).milestoneTaskCount;
}

export function mapSessionToTargetProgressPercent(
  sessionNumber: number
): number {
  return mapSessionToTeachingProgressMilestone(sessionNumber).targetPercent;
}

function stripHtmlPlain(raw: unknown): string {
  return String(raw ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRemoteStudentInactive(status: unknown): boolean {
  const s = String(status || "").trim().toLowerCase();
  if (!s) return false;
  return /nghỉ|bảo\s*lưu|inactive|dropped|dừng|chuyển\s*lớp|quit|pause|hold/i.test(
    s
  );
}

function normalizeAttendanceTag(raw: unknown): "PRESENT" | "ABSENT" | "UNMARKED" {
  const up = String(raw ?? "").trim().toUpperCase();
  if (!up) return "UNMARKED";
  if (
    up.includes("ATTEND") ||
    up.includes("PRESENT") ||
    up.includes("LATE") ||
    up === "ON_TIME" ||
    up.includes("CÓ MẶT") ||
    up.includes("ĐI HỌC") ||
    up.includes("MUỘN")
  ) {
    return "PRESENT";
  }
  if (
    up.includes("ABSENT") ||
    up.includes("EXCUS") ||
    up.includes("OFF") ||
    up.includes("VẮNG") ||
    up.includes("NGHỈ") ||
    up.includes("PHÉP")
  ) {
    return "ABSENT";
  }
  return "UNMARKED";
}

function parseSlotTimeMs(rawDate: unknown): number | null {
  const text = String(rawDate ?? "").trim();
  if (!text) return null;
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return parsed;
  return parseClassDateToEndOfDayMs(text);
}

function parseTimestampAssumeVnIfNaive(rawText: string): number | null {
  const s = String(rawText || "").trim();
  if (!s) return null;
  const hasExplicitTz = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s);
  const normalized = hasExplicitTz
    ? s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")
    : /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(s)
    ? `${s.replace(" ", "T")}+07:00`
    : s;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

function isVnWallClockMidnight(ms: number): boolean {
  const vn = new Date(ms + 7 * 60 * 60 * 1000);
  return (
    vn.getUTCHours() === 0 &&
    vn.getUTCMinutes() === 0 &&
    vn.getUTCSeconds() === 0
  );
}

/**
 * Determines whether a scheduled LMS slot has actually started/passed by `nowMs` (Asia/Ho_Chi_Minh UTC+7),
 * WITHOUT any artificial +6h ahead-of-time inflation so same-day evening slots (e.g. 18:00-20:00) do not
 * appear as occurred earlier in the day.
 */
export function hasLmsSlotTimePassed(
  slot: any,
  nowMs: number = Date.now(),
  fallbackTimeSlot?: string | null
): boolean {
  const rawStart = String(slot?.startTime || "").trim();
  const rawEnd = String(slot?.endTime || "").trim();

  // Check explicit start timestamp only when it carries a real non-midnight VN time
  if (rawStart && /T\d{2}:\d{2}/i.test(rawStart)) {
    const startMs = parseTimestampAssumeVnIfNaive(rawStart);
    if (startMs !== null && !isVnWallClockMidnight(startMs)) {
      return startMs <= nowMs;
    }
  }

  const ymd = normalizeAdminDateToIsoYmd(slot?.date || rawStart || rawEnd);
  if (!ymd) return false;

  const isBareTime = (v: string) => /^\d{1,2}:\d{2}(?:\s*[-–]\s*\d{1,2}:\d{2})?$/.test(v);
  const timeSource = String(
    slot?.timeRange ||
      slot?.timeSlot ||
      (isBareTime(rawStart) ? rawStart : "") ||
      fallbackTimeSlot ||
      (isBareTime(rawEnd) ? rawEnd : "") ||
      ""
  ).trim();
  const timeMatch = timeSource.match(/\b(\d{1,2}):(\d{2})\b/);
  if (timeMatch) {
    const hh = String(Math.min(23, Math.max(0, Number(timeMatch[1])))).padStart(2, "0");
    const mm = String(Math.min(59, Math.max(0, Number(timeMatch[2])))).padStart(2, "0");
    const slotStartMs = Date.parse(`${ymd}T${hh}:${mm}:00+07:00`);
    if (Number.isFinite(slotStartMs)) {
      return slotStartMs <= nowMs;
    }
  }

  if (rawEnd && /T\d{2}:\d{2}/i.test(rawEnd)) {
    const endMs = parseTimestampAssumeVnIfNaive(rawEnd);
    if (endMs !== null && !isVnWallClockMidnight(endMs)) {
      return endMs <= nowMs;
    }
  }

  const endOfDayMs = Date.parse(`${ymd}T23:59:59.999+07:00`);
  if (Number.isFinite(endOfDayMs)) {
    return endOfDayMs <= nowMs;
  }
  const parsed = parseSlotTimeMs(slot?.date || rawStart || rawEnd);
  return parsed !== null && parsed <= nowMs;
}

/**
 * Option B: Detects unstarted / `PENDING` / opening classes that have not conducted Session 1 yet,
 * so they remain hidden on `/admin-center` until the first session actually begins.
 */
export function isAdminUnstartedOrPendingClass(params: {
  status?: string | null;
  currentSessionNumber?: number | null;
  hasSlots?: boolean;
}): boolean {
  const statusStr = String(params.status || "").trim();
  if (/\b(?:PENDING|UPCOMING|NOT_STARTED|OPENING|WAITING|PREPARING|NEW|DRAFT)\b/i.test(statusStr)) {
    return true;
  }
  const isFinished = /FINISH|CLOSED|END|COMPLETED|DONE/i.test(statusStr);
  if (!isFinished && params.hasSlots !== false && Number(params.currentSessionNumber ?? 0) <= 0) {
    return true;
  }
  return false;
}

function hasValidStudentLetterRecord(letter: any): boolean {
  if (!letter || typeof letter !== "object") return false;
  const macros: Array<{ key?: string; value?: string }> = Array.isArray(letter.macros)
    ? letter.macros
    : [];
  const getMacro = (...keys: string[]) => {
    for (const k of keys) {
      const val = stripHtmlPlain(
        macros.find((m) => String(m?.key || "").trim() === k)?.value || ""
      );
      if (val) return val;
    }
    return "";
  };
  const p1 = getMacro("@learnedFromMindx", "learned_from_mindx");
  const p2 = getMacro("@suggestionsFromMindx", "suggestions_from_mindx");
  const p3 = getMacro("@futureDirection", "future_direction");
  if (p1.length >= 5 && p2.length >= 5 && p3.length >= 5) {
    return true;
  }
  const plainContent = stripHtmlPlain(letter.approvedContent || letter.content || "");
  return plainContent.length >= 60 && hasThreePartMindxComment(plainContent);
}

function hasThreePartMindxComment(text: string): boolean {
  const plain = stripHtmlPlain(text).toLowerCase();
  if (!plain) return false;
  const hasPart1 =
    /điểm\s*mạnh|ưu\s*điểm|học\s*được|kiến\s*thức|nắm\s*vững|thành\s*tạo/i.test(
      plain
    );
  const hasPart2 =
    /cần\s*cải\s*thiện|điểm\s*yếu|hạn\s*chế|lưu\s*ý|cần\s*chú\s*ý|sản\s*phẩm|dự\s*án|spck/i.test(
      plain
    );
  const hasPart3 =
    /lời\s*khuyên|gợi\s*ý|định\s*hướng|khóa\s*(?:học\s*)?(?:tiếp\s*theo|sau)|chặng\s*đường/i.test(
      plain
    );
  return hasPart1 && hasPart2 && hasPart3;
}

export function assertMatchingLmsClassPayload(
  clsPayload: any,
  expectedClassCode: string,
  expectedLmsClassId?: string
): void {
  if (!clsPayload || typeof clsPayload !== "object") {
    throw new Error(
      `[LMS Class Mismatch] Dữ liệu lớp ${expectedClassCode} trả về rỗng.`
    );
  }
  const expCode = String(expectedClassCode || "").trim().toUpperCase();
  const actCode = String(clsPayload?.name || clsPayload?.code || "")
    .trim()
    .toUpperCase();
  if (!actCode || actCode !== expCode) {
    throw new Error(
      `[LMS Class Mismatch] Yêu cầu lớp ${expCode} nhưng LMS trả về mã lớp "${actCode || "<rỗng>"}".`
    );
  }
  const expId = String(expectedLmsClassId || "").trim();
  if (expId) {
    const actId = String(clsPayload?.id || clsPayload?._id || "").trim();
    if (!actId || actId !== expId) {
      throw new Error(
        `[LMS Class Mismatch] Yêu cầu ID="${expId}" (${expCode}) nhưng LMS trả về ID="${actId || "<rỗng>"}".`
      );
    }
  }
}

/**
 * Shared SPCK Teaching 5-task compliance evaluator used by Admin scanner audit,
 * Read-after-Write verification, and batch AUTO class selection.
 * Requires a valid project, all 5 canonical track tasks each at exactly 20% weight
 * with non-empty descriptions and valid deadlines, total weight === 100% (no negative weights),
 * and every active student assigned while preserving valid extra 0%-weight teacher tasks.
 */
export function evaluateTeachingSpckTasksCompliance(params: {
  classCode: string;
  courseName?: string;
  endDate?: string;
  eligibleGt9: boolean;
  project: { id?: number | string | null } | null | undefined;
  tasks: Array<any>;
  activeStudentIds: number[];
}): {
  taskStatus: AdminSpckTeachingTasksSummary["taskStatus"];
  totalWeightPercent: number;
  hasNegativeWeight: boolean;
  assignedStudentIdSet: Set<number>;
  matchedStandardTaskCount: number;
} {
  const tasks = Array.isArray(params.tasks) ? params.tasks : [];
  const parseTaskWeight = (t: any): { value: number; valid: boolean } => {
    const raw = t?.weight_percent ?? t?.weightPercent;
    if (
      raw === null ||
      raw === undefined ||
      (typeof raw === "string" && raw.trim() === "")
    ) {
      return { value: 0, valid: true };
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      return { value: Number.isFinite(n) ? n : 0, valid: false };
    }
    return { value: n, valid: true };
  };

  let rawWeightSum = 0;
  let hasInvalidOrNegativeWeight = false;
  for (const t of tasks) {
    const w = parseTaskWeight(t);
    if (!w.valid) {
      hasInvalidOrNegativeWeight = true;
    } else {
      rawWeightSum += w.value;
    }
  }
  const totalWeightPercent = rawWeightSum;
  const hasNegativeWeight = hasInvalidOrNegativeWeight;

  const parseAssigned = (raw: unknown): Set<number> => {
    const out = new Set<number>();
    if (Array.isArray(raw)) {
      for (const sid of raw) {
        const n = Number(sid);
        if (Number.isInteger(n) && n > 0) out.add(n);
      }
    } else if (typeof raw === "string" && raw.trim()) {
      const trimmed = raw.trim();
      if (trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            for (const sid of parsed) {
              const n = Number(sid);
              if (Number.isInteger(n) && n > 0) out.add(n);
            }
          }
        } catch {}
      } else {
        for (const part of trimmed.split(",")) {
          const n = Number(part.trim());
          if (Number.isInteger(n) && n > 0) out.add(n);
        }
      }
    }
    return out;
  };

  const assignedStudentIdSet = new Set<number>();
  const weightedTasks: Array<{ assignedIds: Set<number> }> = [];
  for (const t of tasks) {
    const idsForTask = parseAssigned(t?.assigned_students ?? t?.assignedStudentIds);
    for (const n of idsForTask) assignedStudentIdSet.add(n);
    if ((Number(t?.weight_percent ?? t?.weightPercent) || 0) > 0) {
      weightedTasks.push({ assignedIds: idsForTask });
    }
  }

  const projectId = Number(params.project?.id);
  const hasProject = Number.isInteger(projectId) && projectId > 0;
  const isExemptCourse =
    isAdminSpckExemptClass(params.classCode, params.courseName) ||
    isLegoRoboticsClassCode(params.classCode, params.courseName);
  if (!params.eligibleGt9 && (isExemptCourse || !hasProject)) {
    return {
      taskStatus: "NOT_ELIGIBLE",
      totalWeightPercent,
      hasNegativeWeight,
      assignedStudentIdSet,
      matchedStandardTaskCount: 0,
    };
  }
  if (!hasProject) {
    return {
      taskStatus: "MISSING_PROJECT",
      totalWeightPercent,
      hasNegativeWeight,
      assignedStudentIdSet,
      matchedStandardTaskCount: 0,
    };
  }

  const standardFive = getStandardFiveTasksForClass(
    params.classCode,
    params.endDate,
    params.activeStudentIds,
    params.courseName
  );
  const claimedIndices = new Set<number>();
  const matchedTasks: Array<{ assignedIds: Set<number> }> = [];
  for (const std of standardFive.slice(0, 5)) {
    const stdName = std.taskName.trim();
    const matchIdx = tasks.findIndex((rt, idx) => {
      if (claimedIndices.has(idx)) return false;
      const rtName = String(rt?.task_name ?? rt?.taskName ?? "").trim();
      const parsedRtWeight = parseTaskWeight(rt);
      const rtDesc = String(rt?.description ?? "").trim();
      const rtDeadline = normalizeDateToIsoYmd(rt?.deadline);
      return (
        rtName === stdName &&
        parsedRtWeight.valid &&
        Math.abs(parsedRtWeight.value - 20) <= 1e-6 &&
        rtDesc.length > 0 &&
        Boolean(rtDeadline)
      );
    });
    if (matchIdx >= 0) {
      claimedIndices.add(matchIdx);
      const rt = tasks[matchIdx];
      matchedTasks.push({
        assignedIds: parseAssigned(rt?.assigned_students ?? rt?.assignedStudentIds),
      });
    }
  }

  const matchedStandardTaskCount = matchedTasks.length;
  const hasNonZeroExtraWeight = tasks.some((t, idx) => {
    if (claimedIndices.has(idx)) return false;
    const parsedExtraWeight = parseTaskWeight(t);
    return !parsedExtraWeight.valid || Math.abs(parsedExtraWeight.value) > 1e-6;
  });
  if (
    matchedStandardTaskCount < 5 ||
    Math.abs(rawWeightSum - 100) > 1e-6 ||
    hasNegativeWeight ||
    hasNonZeroExtraWeight
  ) {
    return {
      taskStatus: "INCOMPLETE_TASKS",
      totalWeightPercent,
      hasNegativeWeight,
      assignedStudentIdSet,
      matchedStandardTaskCount,
    };
  }

  const activeIds = params.activeStudentIds || [];
  if (
    activeIds.length > 0 &&
    (activeIds.some((sid) => !assignedStudentIdSet.has(sid)) ||
      matchedTasks.some((mt) => activeIds.some((sid) => !mt.assignedIds.has(sid))) ||
      weightedTasks.some((wt) => activeIds.some((sid) => !wt.assignedIds.has(sid))))
  ) {
    return {
      taskStatus: "NEEDS_STUDENT_ASSIGN",
      totalWeightPercent,
      hasNegativeWeight,
      assignedStudentIdSet,
      matchedStandardTaskCount,
    };
  }

  return {
    taskStatus: "READY",
    totalWeightPercent,
    hasNegativeWeight,
    assignedStudentIdSet,
    matchedStandardTaskCount,
  };
}

function isRealCalendarYmd(rawDate?: string | null): boolean {
  const s = String(rawDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s === "0000-00-00") return false;
  const [yStr, mStr, dStr] = s.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!Number.isInteger(y) || y < 1900 || y > 2199) return false;
  if (!Number.isInteger(m) || m < 1 || m > 12) return false;
  if (!Number.isInteger(d) || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Normalizes any calendar date or ISO timestamp (including pre-2020 sentinel dates
 * such as 1999-01-01) into Asia/Ho_Chi_Minh (UTC+7) YYYY-MM-DD for session matching.
 */
function normalizeCalendarDateForMatch(rawDate?: string | null): string {
  const s = String(rawDate || "").trim();
  if (!s || s === "0000-00-00") return "";
  if (isRealCalendarYmd(s)) return s;

  const naiveDt = s.match(
    /^(\d{4}-\d{2}-\d{2})[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/
  );
  if (naiveDt) {
    return isRealCalendarYmd(naiveDt[1]) ? naiveDt[1] : "";
  }

  const tzDt = s.match(
    /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i
  );
  if (tzDt && isRealCalendarYmd(tzDt[1])) {
    const normalizedIso = s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    const ms = Date.parse(normalizedIso);
    if (Number.isFinite(ms)) {
      const vn = new Date(ms + 7 * 60 * 60 * 1000);
      const candidate = `${String(vn.getUTCFullYear()).padStart(4, "0")}-${String(
        vn.getUTCMonth() + 1
      ).padStart(2, "0")}-${String(vn.getUTCDate()).padStart(2, "0")}`;
      return isRealCalendarYmd(candidate) ? candidate : "";
    }
  }

  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    const first = Number(dmy[1]);
    const second = Number(dmy[2]);
    const thirdRaw = dmy[3];
    if (dmy[1].length === 4 || first > 31) {
      const candidate = `${String(first).padStart(4, "0")}-${String(second).padStart(
        2,
        "0"
      )}-${String(Number(thirdRaw)).padStart(2, "0")}`;
      return isRealCalendarYmd(candidate) ? candidate : "";
    }
    const year = thirdRaw.length === 2 ? 2000 + Number(thirdRaw) : Number(thirdRaw);
    const candidate = `${String(year).padStart(4, "0")}-${String(second).padStart(
      2,
      "0"
    )}-${String(first).padStart(2, "0")}`;
    return isRealCalendarYmd(candidate) ? candidate : "";
  }
  return "";
}

function findMatchingCheckNhanXetRow(
  checkRows: TeachingCheckNhanXetEntry[],
  classCode: string,
  sessionNumber: number,
  sessionDateIso?: string
): TeachingCheckNhanXetEntry | null {
  if (!Array.isArray(checkRows) || checkRows.length === 0 || sessionNumber <= 0) {
    return null;
  }
  const normClass = classCode.trim().toUpperCase();
  const candidates = checkRows.filter(
    (r) =>
      (!r.classCode || r.classCode.trim().toUpperCase() === normClass) &&
      r.sessionNumber === sessionNumber
  );
  if (candidates.length === 0) return null;

  const rawTarget = String(sessionDateIso || "").trim();
  const targetYmd = normalizeCalendarDateForMatch(rawTarget);
  if (rawTarget && !targetYmd) {
    return null;
  }
  if (targetYmd) {
    return (
      candidates.find(
        (r) => normalizeCalendarDateForMatch(r.sessionDate) === targetYmd
      ) || null
    );
  }

  const blankDateMatches = candidates.filter(
    (r) => !String(r.sessionDate || "").trim()
  );
  return blankDateMatches.length > 0
    ? blankDateMatches[blankDateMatches.length - 1]
    : null;
}

function isBtvnScoreCellOutOfSync(
  localRaw: number,
  localMax: number,
  localNorm5: number | null | undefined,
  remoteRow: RemoteTeachingScoreRow | undefined,
  declaredExerciseMax: number | undefined
): boolean {
  if (
    !remoteRow ||
    remoteRow.raw_score === null ||
    remoteRow.raw_score === undefined ||
    String(remoteRow.raw_score).trim() === ""
  ) {
    return true;
  }
  const remoteRaw = Number(remoteRow.raw_score);
  if (!Number.isFinite(remoteRaw)) return true;

  const effLocalMax = Number.isFinite(localMax) && localMax > 0 ? localMax : 100;
  const effLocalNorm5 =
    typeof localNorm5 === "number" && Number.isFinite(localNorm5)
      ? localNorm5
      : (localRaw / effLocalMax) * 5;

  const explicitRemoteMax = Number(remoteRow.max_score);
  const effRemoteMax =
    Number.isFinite(explicitRemoteMax) && explicitRemoteMax > 0
      ? explicitRemoteMax
      : declaredExerciseMax && Number.isFinite(declaredExerciseMax) && declaredExerciseMax > 0
      ? declaredExerciseMax
      : 0;

  if (effRemoteMax > 0) {
    const remoteNorm5 = (remoteRaw / effRemoteMax) * 5;
    return Math.abs(remoteNorm5 - effLocalNorm5) > 0.06;
  }

  const remoteExplicitNorm = Number(remoteRow.normalized_score);
  if (
    remoteRow.normalized_score !== null &&
    remoteRow.normalized_score !== undefined &&
    Number.isFinite(remoteExplicitNorm)
  ) {
    return Math.abs(remoteExplicitNorm - effLocalNorm5) > 0.06;
  }

  const fallbackNorm5 = (remoteRaw / effLocalMax) * 5;
  return Math.abs(fallbackNorm5 - effLocalNorm5) > 0.06;
}

function buildSubmissionStudentIdResolver(
  activeLmsStudents: Array<{ id: string; fullName: string }>,
  submissionGqlData: any
): Map<string, string> {
  const aliasToCrmId = new Map<string, string>();
  const crmById = new Map<string, { id: string; fullName: string }>();
  const crmByNormName = new Map<string, { id: string; fullName: string }>();
  const crmNameCounts = new Map<string, number>();

  for (const stu of activeLmsStudents) {
    aliasToCrmId.set(stu.id, stu.id);
    crmById.set(stu.id, stu);
    const norm = normalizeVietnameseName(stu.fullName);
    if (norm) {
      crmNameCounts.set(norm, (crmNameCounts.get(norm) || 0) + 1);
      crmByNormName.set(norm, stu);
    }
  }

  const gqlStudents: any[] = Array.isArray(submissionGqlData?.students)
    ? submissionGqlData.students
    : [];
  const gqlNameCounts = new Map<string, number>();
  for (const gs of gqlStudents) {
    const norm = normalizeVietnameseName(String(gs?.displayName || gs?.fullName || ""));
    if (norm) gqlNameCounts.set(norm, (gqlNameCounts.get(norm) || 0) + 1);
  }

  for (const gs of gqlStudents) {
    const gid = String(gs?.id || "").trim();
    const guid = String(gs?.studentUid || "").trim();
    const norm = normalizeVietnameseName(String(gs?.displayName || gs?.fullName || ""));

    let matchedCrmId = gid && crmById.has(gid) ? gid : guid && crmById.has(guid) ? guid : "";
    if (
      !matchedCrmId &&
      norm &&
      (crmNameCounts.get(norm) || 0) === 1 &&
      (gqlNameCounts.get(norm) || 0) <= 1
    ) {
      matchedCrmId = crmByNormName.get(norm)?.id || "";
    }

    if (matchedCrmId) {
      if (gid) aliasToCrmId.set(gid, matchedCrmId);
      if (guid) aliasToCrmId.set(guid, matchedCrmId);
    }
  }

  return aliasToCrmId;
}

function getRawSubmissionItems(submissionGqlData: any): any[] {
  if (!submissionGqlData || typeof submissionGqlData !== "object") return [];
  if (Array.isArray(submissionGqlData.submissions)) {
    return submissionGqlData.submissions;
  }
  if (Array.isArray(submissionGqlData.studentSubmissions)) {
    return submissionGqlData.studentSubmissions;
  }
  return [];
}

function hasSubmissionUploadEvidence(sub: any): boolean {
  const hasAttachments =
    Array.isArray(sub?.content?.attachments) && sub.content.attachments.length > 0;
  return (sub?.submittedCount ?? 0) > 0 || Boolean(sub?.submittedAt) || hasAttachments;
}

function extractBtvnLessonsFromGql(submissionGqlData: any): Array<{
  id: string;
  title: string;
  sessionNumber: number;
  isCheckpoint: boolean;
}> {
  const rawLessons: any[] = Array.isArray(submissionGqlData?.lessons)
    ? [...submissionGqlData.lessons]
    : [];
  return rawLessons
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    .map((l, idx) => {
      const title = String(l?.name || l?.title || `Buổi ${idx + 1}`).trim();
      const typeUp = String(l?.type || "").toUpperCase();
      const isCp =
        typeUp === "CHECKPOINT" ||
        /check[-\s]?point|bài\s*kiểm\s*tra|kiểm\s*tra\s*định\s*kỳ/i.test(title);
      const m = title.match(/(?:buổi|bài|session|lesson)\s*0*(\d+)/i) || title.match(/(\d+)/);
      const sessionNumber = m ? Number(m[1]) : idx + 1;
      return {
        id: String(l?.id || "").trim(),
        title,
        sessionNumber,
        isCheckpoint: isCp,
      };
    })
    .filter((l) => l.id && !l.isCheckpoint);
}

export interface ComputeAdminClassAuditsInput {
  centerCode?: string;
  rawClassMeta: {
    classCode: string;
    lmsClassId?: string;
    courseName?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    mainTeacher?: string;
    assistantTeacher?: string;
  };
  classByIdData: any | null;
  submissionGqlData: any | null;
  studentWorks: any[];
  studentLetters?: any[];
  teachingScheduleEntry?: TeachingScheduleClassEntry | null;
  teachingCheckRows?: TeachingCheckNhanXetEntry[];
  teachingDetail?: TeachingPerClassDetail | null;
  teachingMakeupRows?: TeachingHocBuEntry[];
  teachingAllMakeupRows?: TeachingHocBuEntry[];
  nowMs?: number;
}

export function computeAdminClassAudits(
  input: ComputeAdminClassAuditsInput
): Omit<AdminCenterClassRecord, "updatedAt"> {
  const nowMs = input.nowMs ?? Date.now();
  const classCode = String(input.rawClassMeta.classCode || "")
    .trim()
    .toUpperCase();
  const centerCode = String(input.centerCode || "205ALHP")
    .trim()
    .toUpperCase();
  const isMakeupClass = /-HB$/i.test(classCode) ? 1 : 0;

  if (input.classByIdData) {
    assertMatchingLmsClassPayload(
      input.classByIdData,
      classCode,
      input.rawClassMeta.lmsClassId
    );
  }

  const clsData = input.classByIdData || {};
  const lmsClassId = String(
    clsData?.id || clsData?._id || input.rawClassMeta.lmsClassId || ""
  ).trim();
  const courseName = String(
    clsData?.course?.name ||
      clsData?.courseName ||
      input.rawClassMeta.courseName ||
      ""
  ).trim();
  const status = String(
    clsData?.status || input.rawClassMeta.status || "Running"
  ).trim();
  const startDate =
    normalizeAdminDateToIsoYmd(clsData?.startDate ?? input.rawClassMeta.startDate) ||
    String(clsData?.startDate || input.rawClassMeta.startDate || "").trim();
  const endDate =
    normalizeAdminDateToIsoYmd(clsData?.endDate ?? input.rawClassMeta.endDate) ||
    String(clsData?.endDate || input.rawClassMeta.endDate || "").trim();

  const blockType: AdminBlockType =
    input.teachingScheduleEntry?.blockType === "ROBOTICS" ||
    isRoboticsClassCode(classCode) ||
    /robotics|robo\b/i.test(courseName)
      ? "ROBOTICS"
      : "CODING";

  // Extract main & assistant teachers from LMS teachers list, falling back to slot-level teachers (FINISHED classes) then Teaching schedule
  let mainTeacher = String(input.rawClassMeta.mainTeacher || "").trim();
  let assistantTeacher = String(input.rawClassMeta.assistantTeacher || "").trim();
  const extractTeachersFromList = (list: any[]) => {
    const ordered = [...list].sort((a, b) => {
      const aAct = a?.isActive !== false ? 0 : 1;
      const bAct = b?.isActive !== false ? 0 : 1;
      return aAct - bAct;
    });
    for (const t of ordered) {
      const tName = String(
        t?.teacher?.fullName || t?.fullName || t?.teacher?.username || ""
      ).trim();
      const roleName = String(
        t?.role?.name || t?.role?.shortName || t?.role || ""
      ).toLowerCase();
      if (!tName) continue;
      if (
        roleName === "ta" ||
        /\bta\b/.test(roleName) ||
        roleName.includes("assistant") ||
        roleName.includes("trợ") ||
        roleName.includes("mentor") ||
        roleName.includes("tutor")
      ) {
        if (!assistantTeacher) assistantTeacher = tName;
      } else if (!mainTeacher) {
        mainTeacher = tName;
      }
    }
  };
  extractTeachersFromList(Array.isArray(clsData?.teachers) ? clsData.teachers : []);
  const slotsForTeachers: any[] = Array.isArray(clsData?.slots) ? clsData.slots : [];
  if (!mainTeacher || !assistantTeacher) {
    for (let si = slotsForTeachers.length - 1; si >= 0; si--) {
      const s = slotsForTeachers[si];
      if (Array.isArray(s?.teachers) && s.teachers.length > 0) {
        extractTeachersFromList(s.teachers);
      }
      if (!mainTeacher && Array.isArray(s?.teacherAttendance) && s.teacherAttendance.length > 0) {
        const assistantNorm = assistantTeacher
          ? normalizeVietnameseName(assistantTeacher)
          : "";
        for (const ta of s.teacherAttendance) {
          const taName = String(ta?.teacher?.fullName || ta?.teacher?.username || "").trim();
          if (
            taName &&
            (!assistantNorm || normalizeVietnameseName(taName) !== assistantNorm)
          ) {
            mainTeacher = taName;
            break;
          }
        }
      }
      if (mainTeacher && assistantTeacher) break;
    }
  }
  if (!mainTeacher && input.teachingScheduleEntry?.instructor) {
    mainTeacher = input.teachingScheduleEntry.instructor;
  }
  if (!assistantTeacher && input.teachingScheduleEntry?.assistantTeacher) {
    assistantTeacher = input.teachingScheduleEntry.assistantTeacher;
  }

  // Active students on LMS
  const rawCrmStudents: any[] = Array.isArray(clsData?.students)
    ? clsData.students
    : [];
  const activeLmsStudents: Array<{ id: string; fullName: string }> = [];
  const activeLmsIdSet = new Set<string>();
  for (const cs of rawCrmStudents) {
    const sid = String(cs?.student?.id || cs?.id || "").trim();
    const fullName = String(cs?.student?.fullName || cs?.fullName || "").trim();
    const activeInClass = cs?.activeInClass !== false;
    if (sid && fullName && activeInClass && !activeLmsIdSet.has(sid)) {
      activeLmsIdSet.add(sid);
      activeLmsStudents.push({ id: sid, fullName });
    }
  }

  // Slots 1..14
  const slots: any[] = Array.isArray(clsData?.slots) ? clsData.slots : [];
  let latestOccurredIdx = -1;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const attArr: any[] = Array.isArray(s?.studentAttendance)
      ? s.studentAttendance
      : [];
    const hasAttendanceActivity = attArr.some(
      (a) =>
        normalizeAttendanceTag(a?.status) !== "UNMARKED" ||
        stripHtmlPlain(a?.comment).length > 0
    );
    const slotDatePassed = hasLmsSlotTimePassed(
      s,
      nowMs,
      input.teachingScheduleEntry?.timeSlot
    );
    if (hasAttendanceActivity || slotDatePassed || stripHtmlPlain(s?.summary).length > 0) {
      latestOccurredIdx = i;
    }
  }

  const teachingSessNum = Number(input.teachingScheduleEntry?.sessionNumber || 0);
  const isFinishedStatusInitial = /finish|completed|done/i.test(status);
  const occurredSessionNumber =
    latestOccurredIdx >= 0
      ? latestOccurredIdx + 1
      : isFinishedStatusInitial
      ? slots.length
      : 0;
  // Separate actual occurred LMS session from upcoming Teaching schedule so future CP1/CP2/DEMO schedule does NOT inflate alerts!
  const currentSessionNumber =
    slots.length > 0 ? occurredSessionNumber : teachingSessNum;
  const evalSlotIdx =
    latestOccurredIdx >= 0
      ? latestOccurredIdx
      : currentSessionNumber > 0 && currentSessionNumber <= slots.length
      ? currentSessionNumber - 1
      : -1;
  const evalSlot = evalSlotIdx >= 0 ? slots[evalSlotIdx] : null;
  const evaluatedSessionNumber =
    evalSlotIdx >= 0 ? evalSlotIdx + 1 : currentSessionNumber;
  const evaluatedSessionDate =
    normalizeDateToIsoYmd(evalSlot?.date || evalSlot?.startTime) ||
    String(evalSlot?.date || "").trim();

  // Build StudentRecords for ReportCard snapshot extractor
  const existingStudentRecords: StudentRecord[] = activeLmsStudents.map((s) => ({
    studentId: s.id,
    classId: classCode,
    fullName: s.fullName,
    isActive: 1,
    avatarUrl: "",
  }));

  const reportCardSnapshot =
    blockType === "CODING" && input.submissionGqlData
      ? ScoreScraper.extractReportCardSnapshotFromGql({
          classId: classCode,
          classCode,
          lmsClassId,
          isRobotics: false,
          submissionGqlData: input.submissionGqlData,
          classByIdGqlData: clsData,
          existingStudents: existingStudentRecords,
          session14Evals: [],
          scrapedAt: new Date(nowMs).toISOString(),
        })
      : clsData && (activeLmsStudents.length > 0 || slots.length > 0)
      ? ScoreScraper.extractReportCardSnapshotFromGql({
          classId: classCode,
          classCode,
          lmsClassId,
          isRobotics: blockType === "ROBOTICS",
          submissionGqlData: input.submissionGqlData || { lessons: [], submissions: [] },
          classByIdGqlData: clsData,
          existingStudents: existingStudentRecords,
          session14Evals: [],
          scrapedAt: new Date(nowMs).toISOString(),
        })
      : null;

  const computedReportCard = reportCardSnapshot
    ? computeClassReportCard(reportCardSnapshot, {})
    : null;

  // ========================================================
  // TAB 1: Weekly Operations Summary
  // ========================================================
  let presentCount = 0;
  let absentCount = 0;
  let unmarkedCount = 0;
  let commentedPresentCount = 0;
  const missingCommentStudentNames: string[] = [];

  if (evalSlot) {
    const attById = new Map<string, any>();
    const attByNorm = new Map<string, any>();
    for (const att of evalSlot?.studentAttendance || []) {
      const sid = String(att?.student?.id || att?.studentId || "").trim();
      const sName = String(att?.student?.fullName || "").trim();
      if (sid) attById.set(sid, att);
      if (sName) attByNorm.set(normalizeVietnameseName(sName), att);
    }

    const rosterToInspect =
      activeLmsStudents.length > 0
        ? activeLmsStudents
        : (evalSlot?.studentAttendance || []).map((a: any, idx: number) => ({
            id: String(a?.student?.id || `ATT_${idx}`),
            fullName: String(a?.student?.fullName || `HV ${idx + 1}`).trim(),
          }));

    for (const stu of rosterToInspect) {
      const att =
        attById.get(stu.id) || attByNorm.get(normalizeVietnameseName(stu.fullName));
      const tag = normalizeAttendanceTag(att?.status);
      if (tag === "PRESENT") {
        presentCount++;
        const commentPlain = stripHtmlPlain(att?.comment);
        if (commentPlain.length > 0) {
          commentedPresentCount++;
        } else {
          missingCommentStudentNames.push(stu.fullName);
        }
      } else if (tag === "ABSENT") {
        absentCount++;
      } else {
        unmarkedCount++;
      }
    }
  }

  let attendanceStatus: AdminWeeklyOpsSummary["attendanceStatus"] = "NOT_DUE";
  if (evaluatedSessionNumber > 0) {
    if (presentCount === 0 && absentCount === 0) {
      attendanceStatus = "NOT_MARKED";
    } else if (unmarkedCount > 0) {
      attendanceStatus = "PARTIAL";
    } else {
      attendanceStatus = "COMPLETED";
    }
  }

  const hasSummaryText = stripHtmlPlain(evalSlot?.summary || evalSlot?.note).length > 0;
  // Cách 1B: Ô BTVN trên LMS là optional cho cả Coding lẫn Robotics — chỉ cần có Tổng kết buổi học là đạt
  const hasSummaryAndHomework = Boolean(evalSlot) && hasSummaryText;

  const checkRows = input.teachingCheckRows || [];
  const matchedCheckRow = findMatchingCheckNhanXetRow(
    checkRows,
    classCode,
    evaluatedSessionNumber,
    evaluatedSessionDate
  );

  const zaloStatus =
    matchedCheckRow?.zaloStatus ||
    (evaluatedSessionNumber > 0 ? "Chưa xác minh" : "");
  const zaloDeadline = matchedCheckRow?.zaloDeadline || "";
  const isZaloLateOrMissing = isTeachingCheckLateOrMissing(zaloStatus);
  const lmsCheckStatus =
    matchedCheckRow?.lmsStatus ||
    (evaluatedSessionNumber > 0 ? "Chưa xác minh" : "");
  const lmsDeadline = matchedCheckRow?.lmsDeadline || "";
  const isLmsLateOrMissing = isTeachingCheckLateOrMissing(lmsCheckStatus);
  const checkIssueNote = matchedCheckRow?.issueDescription || "";

  // Checkpoint Alert (Coding: Buổi 5, 9, 14; VEX Robotics: Buổi 4, 8, 14; LEGO ROB4/6: Buổi 5 & 9 check 7 sao năng lực, Buổi 14 Demo)
  const spckExemptCourse = isAdminSpckExemptClass(classCode, courseName);
  const isLegoClass = isLegoRoboticsClassCode(classCode, courseName);
  const cp1Session = isLegoClass ? 5 : blockType === "ROBOTICS" ? 4 : 5;
  const cp2Session = isLegoClass ? 9 : blockType === "ROBOTICS" ? 8 : 9;
  let checkpointAlert: AdminWeeklyOpsSummary["checkpointAlert"] = null;

  const findSlotForSessionNumber = (targetSession: number): any | null => {
    const targetIdx = targetSession - 1;
    const byIndex = slots.find(
      (sl) =>
        sl?.index !== null &&
        sl?.index !== undefined &&
        sl?.index !== "" &&
        Number.isInteger(Number(sl.index)) &&
        Number(sl.index) === targetIdx
    );
    if (byIndex) return byIndex;
    if (targetIdx >= 0 && targetIdx < slots.length) {
      const cand = slots[targetIdx];
      const hasExplicitOtherIdx =
        cand?.index !== null &&
        cand?.index !== undefined &&
        cand?.index !== "" &&
        Number.isInteger(Number(cand.index)) &&
        Number(cand.index) !== targetIdx;
      if (!hasExplicitOtherIdx) return cand;
    }
    return null;
  };

  const doesMakeupEntryMatchMilestone = (
    entry: TeachingHocBuEntry,
    targetSession: number,
    milestone: "CP1" | "CP2" | "DEMO"
  ): boolean => {
    const rawLabel = String(entry?.sessionLabel || "").trim();
    if (!rawLabel) return false;
    // Strip calendar dates (e.g., 04/11/2026, 2026-11-04) so day numbers never masquerade as sessions
    const label = rawLabel
      .replace(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g, " ")
      .replace(/\b\d{1,2}[-/]\d{1,2}(?:[-/]\d{2,4})?\b/g, " ")
      .trim();
    const sessionMatches = Array.from(
      label.matchAll(
        /(?:^|[^\p{L}\p{N}_])(?:buổi|bài|session|slot|b)\s*[:#]?\s*0*(\d{1,2})(?!\d)/giu
      )
    );
    if (sessionMatches.length > 0) {
      return sessionMatches.some((m) => Number(m[1]) === targetSession);
    }
    const bareNum = label.match(/^0*(\d{1,2})$/);
    if (bareNum) {
      return Number(bareNum[1]) === targetSession;
    }
    if (milestone === "CP1") return /\b(?:cp\s*1|check[-\s]?point\s*1)\b/i.test(label);
    if (milestone === "CP2") return /\b(?:cp\s*2|check[-\s]?point\s*2)\b/i.test(label);
    return /\b(?:demo|spck|cuối\s*khóa|cuối\s*khoá)\b/i.test(label);
  };

  const formatCompactStudentNames = (names: string[], maxShow: number = 3): string =>
    names.length <= maxShow
      ? names.join(", ")
      : `${names.slice(0, maxShow).join(", ")} +${names.length - maxShow} HV`;

  const buildCheckpointAlertForMilestone = (
    milestone: "CP1" | "CP2" | "DEMO",
    targetSession: number
  ): AdminWeeklyCheckpointAlert | null => {
    if (!computedReportCard) return null;
    const milestoneSlot = findSlotForSessionNumber(targetSession);
    const attById = new Map<string, any>();
    const attByNorm = new Map<string, any>();
    for (const att of milestoneSlot?.studentAttendance || []) {
      const sid = String(att?.student?.id || att?.studentId || "").trim();
      const sName = String(att?.student?.fullName || "").trim();
      if (sid) attById.set(sid, att);
      if (sName) attByNorm.set(normalizeVietnameseName(sName), att);
    }

    const activeNameCounts = new Map<string, number>();
    for (const st of computedReportCard.students) {
      if (!st.isActive) continue;
      const n = normalizeVietnameseName(st.fullName);
      if (n) activeNameCounts.set(n, (activeNameCounts.get(n) || 0) + 1);
    }

    const rawSnapshotById = new Map(
      (reportCardSnapshot?.students || []).map((st) => [st.studentId, st.stageScores])
    );
    const makeupRows = Array.isArray(input.teachingAllMakeupRows)
      ? input.teachingAllMakeupRows
      : Array.isArray(input.teachingMakeupRows)
      ? input.teachingMakeupRows
      : [];

    const maxSlotRateCount = (milestoneSlot?.studentAttendance || []).reduce(
      (maxCnt: number, item: any) => {
        const cnt = Array.isArray(item?.commentByAreas)
          ? item.commentByAreas.filter(
              (a: any) => String(a?.type || "").toUpperCase() === "RATE"
            ).length
          : 0;
        return Math.max(maxCnt, cnt);
      },
      0
    );
    const minLegoCpRates =
      maxSlotRateCount >= 6 ? Math.min(7, maxSlotRateCount) : 7;

    const missingStudentNames: string[] = [];
    const absentMakeupStudentNames: string[] = [];

    for (const s of computedReportCard.students) {
      if (!s.isActive) continue;
      const normName = normalizeVietnameseName(s.fullName);
      const isUniqueName = Boolean(normName) && (activeNameCounts.get(normName) || 0) === 1;
      const att = attById.get(s.studentId) || (isUniqueName ? attByNorm.get(normName) : undefined);

      let isMissingScore = false;
      let stageNote = "";
      const rawStage = rawSnapshotById.get(s.studentId);

      if (isLegoClass && (milestone === "CP1" || milestone === "CP2")) {
        // LEGO ROB4/ROB6 has no numeric LT/TH test at B5/B9 — M1 checks 7 competency RATE areas instead
        const tickedRateCount = Array.isArray(att?.commentByAreas)
          ? att.commentByAreas.filter(
              (a: any) =>
                String(a?.type || "").toUpperCase() === "RATE" &&
                Number.isFinite(Number(a?.grade)) &&
                Number(a?.grade) > 0
            ).length
          : 0;
        isMissingScore = tickedRateCount < minLegoCpRates;
        stageNote = milestone === "CP1" ? rawStage?.cp1Note || "" : rawStage?.cp2Note || "";
      } else if (milestone === "CP1") {
        isMissingScore = s.cp1.theory.value === null && s.cp1.practice.value === null;
        stageNote = s.cp1.competency.note || rawStage?.cp1Note || "";
      } else if (milestone === "CP2") {
        isMissingScore = s.cp2.theory.value === null && s.cp2.practice.value === null;
        stageNote = s.cp2.competency.note || rawStage?.cp2Note || "";
      } else {
        const hasDirectSlotDemoScore =
          Array.isArray(att?.commentByAreas) &&
          att.commentByAreas.some(
            (a: any) =>
              (String(a?.type || "").toUpperCase() === "DEMO" || Boolean(a?.courseProcessDemoId)) &&
              ((typeof a?.grade === "number" && a.grade > 0) ||
                (Array.isArray(a?.demoQuestions) &&
                  a.demoQuestions.some((q: any) => Number(q?.score) > 0)))
          );
        isMissingScore = s.final.product.value === null && !hasDirectSlotDemoScore;
        stageNote = s.final.competency.note || rawStage?.finalNote || "";
      }

      if (!isMissingScore) continue;

      const attTag = normalizeAttendanceTag(att?.status);
      const matchingMakeup = isUniqueName
        ? makeupRows.filter(
            (m) =>
              normalizeVietnameseName(m.studentName) === normName &&
              doesMakeupEntryMatchMilestone(m, targetSession, milestone)
          )
        : [];
      const hasCompletedMakeup = matchingMakeup.some((m) =>
        isMakeupCompletedStatus(m.status, m.attendanceStatus)
      );
      const hasPendingMakeup = matchingMakeup.some(
        (m) =>
          !isMakeupCompletedStatus(m.status, m.attendanceStatus) &&
          !isMakeupCancelledStatus(m.status)
      );

      const notePlain = stripHtmlPlain(att?.comment) || stripHtmlPlain(stageNote);
      const hasExplicitShortAbsenceNote =
        notePlain.length > 0 &&
        notePlain.length <= 45 &&
        /^(?:bạn\s*|hv\s*|học\s*viên\s*|con\s*|bé\s*)?(?:nghỉ|vắng)(?:\s+học|\s+phép|\s+có\s+phép|\s+ốm|\s+bệnh|\s+chờ\s+học\s+bù|\s*!|\s*\.|$)/i.test(
          notePlain
        );

      if (hasCompletedMakeup) {
        missingStudentNames.push(s.fullName);
      } else if (
        attTag === "ABSENT" ||
        hasPendingMakeup ||
        (attTag !== "PRESENT" && hasExplicitShortAbsenceNote)
      ) {
        absentMakeupStudentNames.push(s.fullName);
      } else {
        missingStudentNames.push(s.fullName);
      }
    }

    if (missingStudentNames.length === 0 && absentMakeupStudentNames.length === 0) {
      return null;
    }

    const prefix = `Buổi ${targetSession} (${milestone})`;
    const missingLabel =
      isLegoClass && milestone === "CP1"
        ? "chưa tích sao năng lực Check-point 1"
        : isLegoClass && milestone === "CP2"
        ? "chưa tích sao năng lực Check-point 2"
        : milestone === "CP1"
        ? "thiếu điểm Check-point 1"
        : milestone === "CP2"
        ? "thiếu điểm Check-point 2"
        : "chưa có điểm sản phẩm cuối khóa";
    const missingPhrase =
      missingStudentNames.length > 0
        ? `còn ${missingStudentNames.length} HV ${missingLabel} (${formatCompactStudentNames(
            missingStudentNames
          )})`
        : "";
    const makeupPhrase =
      absentMakeupStudentNames.length > 0
        ? `${absentMakeupStudentNames.length} HV nghỉ chờ học bù (${formatCompactStudentNames(
            absentMakeupStudentNames
          )})`
        : "";

    const isMakeupPendingOnly = missingStudentNames.length === 0;
    const message =
      missingPhrase && makeupPhrase
        ? `${prefix}: ${missingPhrase} • ${makeupPhrase}`
        : `${prefix}: ${missingPhrase || makeupPhrase}`;

    return {
      milestone,
      sessionNumber: targetSession,
      missingScoreCount: missingStudentNames.length,
      missingStudentNames,
      absentMakeupCount: absentMakeupStudentNames.length,
      absentMakeupStudentNames,
      isMakeupPendingOnly,
      message,
    };
  };

  if (!spckExemptCourse && currentSessionNumber >= 14) {
    checkpointAlert = buildCheckpointAlertForMilestone("DEMO", 14);
  } else if (currentSessionNumber >= cp2Session) {
    checkpointAlert = buildCheckpointAlertForMilestone("CP2", cp2Session);
  } else if (currentSessionNumber >= cp1Session) {
    checkpointAlert = buildCheckpointAlertForMilestone("CP1", cp1Session);
  }

  const weeklyOps: AdminWeeklyOpsSummary = {
    evaluatedSessionNumber,
    evaluatedSessionDate,
    attendanceStatus,
    presentCount,
    absentCount,
    unmarkedCount,
    hasSummaryAndHomework,
    commentedPresentCount,
    missingCommentStudentNames,
    zaloStatus,
    zaloDeadline,
    isZaloLateOrMissing,
    lmsCheckStatus,
    lmsDeadline,
    isLmsLateOrMissing,
    checkIssueNote,
    checkpointAlert,
  };

  // ========================================================
  // TAB 2: BTVN & Grading Status (Coding only)
  // ========================================================
  const teachingDetail = input.teachingDetail || null;
  const teachingExercises = teachingDetail?.exercises || [];
  const teachingScores = teachingDetail?.scores || [];
  const teachingStudents = teachingDetail?.students || [];
  const activeTeachingStudents = teachingStudents.filter(
    (s) => !isRemoteStudentInactive(s.status)
  );

  const teachingDeclaredBtvnSessions = Array.from(
    new Set(
      teachingExercises
        .filter((e) => String(e.exercise_type).toLowerCase() === "btvn")
        .map((e) => Number(e.session_number))
        .filter((n) => Number.isInteger(n) && n > 0)
    )
  ).sort((a, b) => a - b);

  const teachingBtvnScoreRows = teachingScores.filter(
    (sc) =>
      String(sc.exercise_type).toLowerCase() === "btvn" &&
      sc.raw_score !== null &&
      sc.raw_score !== undefined &&
      String(sc.raw_score).trim() !== ""
  );

  let btvnSummary: AdminBtvnCodingSummary = {
    applicable: false,
    latestHomeworkSessionNumber: 0,
    submittedCount: 0,
    expectedCount: 0,
    submissionRatePercent: 0,
    lowSubmissionWarning: false,
    ungradedCellsCount: 0,
    ungradedSessions: [],
    gradedCellsCount: 0,
    redoCellsCount: 0,
    notSubmittedCellsCount: 0,
    teachingDeclaredBtvnSessions,
    teachingScoredCellsCount: teachingBtvnScoreRows.length,
    isOutOfSyncWithTeaching: false,
  };

  const subStudentAliasMap = buildSubmissionStudentIdResolver(
    activeLmsStudents,
    input.submissionGqlData
  );

  if (blockType === "CODING" && input.submissionGqlData) {
    const rawSubs = getRawSubmissionItems(input.submissionGqlData);
    const btvnLessons = extractBtvnLessonsFromGql(input.submissionGqlData);

    const occurredLessons = btvnLessons.filter(
      (l) =>
        currentSessionNumber === 0 ||
        l.sessionNumber <= currentSessionNumber ||
        rawSubs.some((s) => String(s?.lessonId || "").trim() === l.id)
    );

    const subsByStudentLesson = new Map<string, any[]>();
    for (const sub of rawSubs) {
      const rawSid = String(sub?.studentId || sub?.studentUid || "").trim();
      const stuId = subStudentAliasMap.get(rawSid) || rawSid;
      const lessonId = String(sub?.lessonId || "").trim();
      if (!stuId || !lessonId) continue;
      const key = `${stuId}::${lessonId}`;
      const list = subsByStudentLesson.get(key) || [];
      list.push(sub);
      subsByStudentLesson.set(key, list);
    }

    let ungradedCellsCount = 0;
    const ungradedSessionSet = new Set<number>();
    let gradedCellsCount = 0;
    let redoCellsCount = 0;
    let notSubmittedCellsCount = 0;

    // Choose latest BTVN lesson that has occurred and preferably prior to an unstarted today slot
    let latestHomeworkSessionNumber = 0;
    let latestSubmittedCount = 0;
    const activeCount = activeLmsStudents.length;

    for (const lesson of occurredLessons) {
      let lessonSubmittedOrGraded = 0;
      const isLessonNotYetDue =
        currentSessionNumber > 0 && lesson.sessionNumber >= currentSessionNumber;
      for (const stu of activeLmsStudents) {
        const subs = subsByStudentLesson.get(`${stu.id}::${lesson.id}`) || [];
        const hasAnySubmitted = subs.some((s) => {
          const st = String(s?.status || "").toUpperCase();
          return (
            st === "MARKED" ||
            st === "SUBMITTED" ||
            st === "REDO" ||
            hasSubmissionUploadEvidence(s)
          );
        });
        if (hasAnySubmitted) lessonSubmittedOrGraded++;

        const practiceSubs = subs.filter(
          (s) => String(s?.category || "").toUpperCase() !== "QUIZ"
        );
        const targetList = practiceSubs.length > 0 ? practiceSubs : subs;
        if (targetList.length === 0) {
          if (!isLessonNotYetDue) {
            notSubmittedCellsCount++;
          }
          continue;
        }
        const statuses = targetList.map((s) => String(s?.status || "").toUpperCase());
        const hasMarked = statuses.some((st) => st === "MARKED");
        const hasRedo = statuses.some((st) => st === "REDO");
        const ungradedSubsInCell = targetList.filter((s) => {
          const st = String(s?.status || "").toUpperCase();
          return st === "SUBMITTED" || (st === "IN_PROGRESS" && hasSubmissionUploadEvidence(s));
        });

        if (ungradedSubsInCell.length > 0) {
          ungradedCellsCount += ungradedSubsInCell.length;
          ungradedSessionSet.add(lesson.sessionNumber);
        }
        if (hasMarked && ungradedSubsInCell.length === 0) {
          gradedCellsCount++;
        } else if (hasRedo && ungradedSubsInCell.length === 0 && !hasMarked) {
          redoCellsCount++;
        } else if (!hasMarked && !hasRedo && ungradedSubsInCell.length === 0) {
          if (!isLessonNotYetDue) {
            notSubmittedCellsCount++;
          }
        }
      }

      // Only track due lessons (sessionNumber <= currentSessionNumber - 1); Session 1 or current-session BTVN is not due yet
      if (currentSessionNumber === 0 || lesson.sessionNumber < currentSessionNumber) {
        latestHomeworkSessionNumber = lesson.sessionNumber;
        latestSubmittedCount = lessonSubmittedOrGraded;
      }
    }

    const expectedCount = latestHomeworkSessionNumber > 0 ? activeCount : 0;
    const submissionRatePercent =
      expectedCount > 0 ? Math.round((latestSubmittedCount / expectedCount) * 100) : 0;

    // Compare LMS ReportCard graded BTVN scores vs Teaching get_scores (scale-normalized)
    let isOutOfSyncWithTeaching = false;
    if (computedReportCard) {
      const teachingIdByNorm = new Map<string, number>();
      for (const ts of activeTeachingStudents) {
        teachingIdByNorm.set(normalizeVietnameseName(ts.student_name), ts.id);
      }
      const teachingExerciseMaxMap = new Map<string, number>();
      for (const ex of teachingExercises) {
        if (String(ex.exercise_type || "").toLowerCase() !== "btvn") continue;
        const maxVal = Number(ex.max_score);
        if (Number.isFinite(maxVal) && maxVal > 0) {
          teachingExerciseMaxMap.set(
            `${ex.session_number}-${String(ex.exercise_form || "").toLowerCase()}`,
            maxVal
          );
        }
      }
      const teachingScoreRowMap = new Map<string, RemoteTeachingScoreRow>();
      for (const sc of teachingBtvnScoreRows) {
        const val = Number(sc.raw_score);
        if (Number.isFinite(val)) {
          teachingScoreRowMap.set(
            `${sc.student_id}-${sc.session_number}-${String(sc.exercise_form || "").toLowerCase()}`,
            sc
          );
        }
      }

      for (const stu of computedReportCard.students) {
        if (!stu.isActive) continue;
        const tid = teachingIdByNorm.get(normalizeVietnameseName(stu.fullName));
        if (!tid) continue;
        for (const [snStr, cell] of Object.entries(stu.btvnCells || {})) {
          const sn = Number(snStr);
          if (cell?.theoryRaw !== null && cell?.theoryRaw !== undefined) {
            const remoteRow = teachingScoreRowMap.get(`${tid}-${sn}-theory`);
            const declaredMax = teachingExerciseMaxMap.get(`${sn}-theory`);
            if (
              isBtvnScoreCellOutOfSync(
                cell.theoryRaw,
                cell.theoryMax || 100,
                cell.theoryNorm,
                remoteRow,
                declaredMax
              )
            ) {
              isOutOfSyncWithTeaching = true;
              break;
            }
          }
          if (cell?.practiceRaw !== null && cell?.practiceRaw !== undefined) {
            const remoteRow = teachingScoreRowMap.get(`${tid}-${sn}-practice`);
            const declaredMax = teachingExerciseMaxMap.get(`${sn}-practice`);
            if (
              isBtvnScoreCellOutOfSync(
                cell.practiceRaw,
                cell.practiceMax || 100,
                cell.practiceNorm,
                remoteRow,
                declaredMax
              )
            ) {
              isOutOfSyncWithTeaching = true;
              break;
            }
          }
        }
        if (isOutOfSyncWithTeaching) break;
      }
    }

    btvnSummary = {
      applicable: true,
      latestHomeworkSessionNumber,
      submittedCount: latestSubmittedCount,
      expectedCount,
      submissionRatePercent,
      lowSubmissionWarning: expectedCount > 0 && submissionRatePercent < 50,
      ungradedCellsCount,
      ungradedSessions: Array.from(ungradedSessionSet).sort((a, b) => a - b),
      gradedCellsCount,
      redoCellsCount,
      notSubmittedCellsCount,
      teachingDeclaredBtvnSessions,
      teachingScoredCellsCount: teachingBtvnScoreRows.length,
      isOutOfSyncWithTeaching,
    };
  }

  // ========================================================
  // TAB 3: SPCK Audit (Buổi 12, 13, 14 & Finished; LEGO B12 exempt + B13-14 cluster)
  // ========================================================
  const isFinishedClass = /finish|completed|done/i.test(status);
  const spckApplicable =
    !spckExemptCourse &&
    (isLegoClass
      ? currentSessionNumber >= 13 || isFinishedClass
      : currentSessionNumber >= 12 || isFinishedClass);
  const works = Array.isArray(input.studentWorks)
    ? input.studentWorks.filter(
        (w) => w?.isDeleted !== true && String(w?.isDeleted || "").toLowerCase() !== "true"
      )
    : [];

  const slotIdToSession = new Map<string, 12 | 13 | 14>();
  for (const sn of [12, 13, 14] as const) {
    const slotObj = slots[sn - 1];
    const sid = String(slotObj?._id || slotObj?.id || "").trim();
    if (sid) slotIdToSession.set(sid, sn);
  }

  const buildEmptySpckSlot = (sn: 12 | 13 | 14): AdminSpckSlotAuditItem => ({
    sessionNumber: sn,
    sessionOccurred: false,
    requiredCount: 0,
    uploadedCount: 0,
    commentedCount: 0,
    missingUploadStudents: [],
    missingImageOrLinkStudents: [],
    missingTeacherCommentStudents: [],
  });

  const spckSlots: AdminSpckAuditSummary["slots"] = {
    "12": buildEmptySpckSlot(12),
    "13": buildEmptySpckSlot(13),
    "14": buildEmptySpckSlot(14),
  };

  let totalMissingUploads = 0;
  let totalMissingMediaOrLinks = 0;
  let totalMissingTeacherComments = 0;

  const session14FinalEval: AdminSpckAuditSummary["session14FinalEval"] = {
    applicable: false,
    requiredCount: 0,
    requiredCompetencyCount: isLegoClass ? 7 : 9,
    demoScoredCount: 0,
    competencyCompleteCount: 0,
    mindx3PartCommentCount: 0,
    missingEvalStudents: [],
  };

  const doesWorkHaveImageOrLink = (stuWork: any): boolean => {
    const latest = stuWork?.latestData || {};
    const hasThumbnailObjOrStr = Boolean(
      (typeof latest?.thumbnail === "string" && latest.thumbnail.trim()) ||
        (latest?.thumbnail &&
          typeof latest.thumbnail === "object" &&
          Boolean(latest.thumbnail.url || latest.thumbnail.path || latest.thumbnail.name))
    );
    return Boolean(
      hasThumbnailObjOrStr ||
        (typeof latest?.thumbnailUrl === "string" && latest.thumbnailUrl.trim()) ||
        (typeof latest?.imageUrl === "string" && latest.imageUrl.trim()) ||
        (Array.isArray(latest?.imageUrl) && latest.imageUrl.length > 0) ||
        (Array.isArray(latest?.screenshots) && latest.screenshots.length > 0) ||
        (Array.isArray(latest?.images) && latest.images.length > 0) ||
        (Array.isArray(latest?.attachments) && latest.attachments.length > 0) ||
        (Array.isArray(latest?.attachmentUrls) && latest.attachmentUrls.length > 0) ||
        (Array.isArray(latest?.videoUrls) && latest.videoUrls.length > 0) ||
        (Array.isArray(latest?.relatedUrls) && latest.relatedUrls.length > 0) ||
        (Array.isArray(latest?.links) && latest.links.length > 0) ||
        (Array.isArray(latest?.youtubeUrls) && latest.youtubeUrls.length > 0) ||
        (Array.isArray(latest?.referenceUrls) && latest.referenceUrls.length > 0) ||
        (typeof latest?.productUrl === "string" && latest.productUrl.trim()) ||
        (typeof latest?.youtubeUrl === "string" && latest.youtubeUrl.trim()) ||
        (typeof stuWork?.url === "string" && stuWork.url.trim())
    );
  };

  if (spckApplicable) {
    if (isLegoClass) {
      // LEGO ROB4/ROB6 (2A): Session 12 is a normal class (exempt), and Sessions 13-14 share 1 photo-only SPCK requirement
      const clusterTargetSn: 13 | 14 =
        currentSessionNumber >= 14 || isFinishedClass ? 14 : 13;
      const clusterSlot = buildEmptySpckSlot(clusterTargetSn);
      clusterSlot.sessionOccurred = true;
      clusterSlot.isLegoCluster1314 = true;

      const clusterWorks = works.filter((w) => {
        const wSid = String(w?.classSessionId || "").trim();
        const mappedSn = slotIdToSession.get(wSid);
        if (mappedSn === 13 || mappedSn === 14) return true;
        const explicitSn = Number(w?.classSessionNumber);
        return explicitSn === 13 || explicitSn === 14;
      });

      const buildAttMapForSn = (sn: 13 | 14) => {
        const byId = new Map<string, string>();
        const byNorm = new Map<string, string>();
        for (const att of slots[sn - 1]?.studentAttendance || []) {
          const sid = String(att?.student?.id || att?.studentId || "").trim();
          const sName = String(att?.student?.fullName || "").trim();
          const tag = normalizeAttendanceTag(att?.status);
          if (sid) byId.set(sid, tag);
          if (sName) byNorm.set(normalizeVietnameseName(sName), tag);
        }
        return { byId, byNorm };
      };
      const att13Map = buildAttMapForSn(13);
      const att14Map = clusterTargetSn === 14 ? buildAttMapForSn(14) : null;

      for (const stu of activeLmsStudents) {
        const normStuName = normalizeVietnameseName(stu.fullName);
        const tag13 = att13Map.byId.get(stu.id) || att13Map.byNorm.get(normStuName) || "UNMARKED";
        const tag14 = att14Map
          ? att14Map.byId.get(stu.id) || att14Map.byNorm.get(normStuName) || "UNMARKED"
          : null;
        const stuWorks = clusterWorks.filter(
          (w) => String(w?.studentId || "").trim() === stu.id
        );
        const absentAllOccurred =
          tag13 === "ABSENT" && (tag14 === null || tag14 === "ABSENT");
        if (absentAllOccurred && stuWorks.length === 0) {
          continue;
        }

        clusterSlot.requiredCount++;
        if (stuWorks.length === 0) {
          clusterSlot.missingUploadStudents.push(stu.fullName);
          totalMissingUploads++;
          continue;
        }

        clusterSlot.uploadedCount++;
        const bestWork =
          stuWorks.find(
            (w) =>
              doesWorkHaveImageOrLink(w) &&
              stripHtmlPlain(
                w?.latestData?.comment || w?.latestData?.teacherComment || w?.comment || ""
              ).length > 0
          ) ||
          stuWorks.find((w) => doesWorkHaveImageOrLink(w)) ||
          stuWorks[0];

        if (!doesWorkHaveImageOrLink(bestWork)) {
          clusterSlot.missingImageOrLinkStudents.push(stu.fullName);
          totalMissingMediaOrLinks++;
        }

        const spckComment = stripHtmlPlain(
          bestWork?.latestData?.comment ||
            bestWork?.latestData?.teacherComment ||
            bestWork?.comment ||
            ""
        );
        if (spckComment.length > 0) {
          clusterSlot.commentedCount++;
        } else {
          clusterSlot.missingTeacherCommentStudents.push(stu.fullName);
          totalMissingTeacherComments++;
        }
      }

      spckSlots[String(clusterTargetSn) as "13" | "14"] = clusterSlot;
    } else {
      for (const sn of [12, 13, 14] as const) {
        const slotIdx = sn - 1;
        const slotObj = slots[slotIdx];
        const slotWorks = works.filter((w) => {
          const wSid = String(w?.classSessionId || "").trim();
          const mappedSn = slotIdToSession.get(wSid);
          if (mappedSn === sn) return true;
          if (Number(w?.classSessionNumber) === sn) return true;
          return false;
        });

        const occurred =
          currentSessionNumber >= sn || isFinishedClass || slotWorks.length > 0;
        const slotAudit = buildEmptySpckSlot(sn);
        slotAudit.sessionOccurred = occurred;

        if (occurred) {
          const attById = new Map<string, string>();
          const attByNorm = new Map<string, string>();
          for (const att of slotObj?.studentAttendance || []) {
            const sid = String(att?.student?.id || att?.studentId || "").trim();
            const sName = String(att?.student?.fullName || "").trim();
            const tag = normalizeAttendanceTag(att?.status);
            if (sid) attById.set(sid, tag);
            if (sName) attByNorm.set(normalizeVietnameseName(sName), tag);
          }

          for (const stu of activeLmsStudents) {
            const attTag =
              attById.get(stu.id) ||
              attByNorm.get(normalizeVietnameseName(stu.fullName)) ||
              "UNMARKED";
            // On sessions 12 & 13, ABSENT students are exempt from SPCK upload audit; session 14 requires everyone.
            if ((sn === 12 || sn === 13) && attTag === "ABSENT") {
              continue;
            }

            slotAudit.requiredCount++;
            const stuWork = slotWorks.find(
              (w) => String(w?.studentId || "").trim() === stu.id
            );

            if (!stuWork) {
              slotAudit.missingUploadStudents.push(stu.fullName);
              totalMissingUploads++;
              continue;
            }

            slotAudit.uploadedCount++;
            const latest = stuWork?.latestData || {};
            if (!doesWorkHaveImageOrLink(stuWork)) {
              slotAudit.missingImageOrLinkStudents.push(stu.fullName);
              totalMissingMediaOrLinks++;
            }

            const spckComment = stripHtmlPlain(
              latest?.comment || latest?.teacherComment || stuWork?.comment || ""
            );
            if (spckComment.length > 0) {
              slotAudit.commentedCount++;
            } else {
              slotAudit.missingTeacherCommentStudents.push(stu.fullName);
              totalMissingTeacherComments++;
            }
          }
        }

        spckSlots[String(sn) as "12" | "13" | "14"] = slotAudit;
      }
    }

    // Session 14 final evaluation & 3-part MindX comment check
    const slot14 = slots[13];
    if (!spckExemptCourse && (currentSessionNumber >= 14 || isFinishedClass || Boolean(slot14))) {
      session14FinalEval.applicable = currentSessionNumber >= 14 || isFinishedClass;
      if (session14FinalEval.applicable) {
        const requiredCompetencyCount = isLegoClass ? 7 : 9;
        session14FinalEval.requiredCompetencyCount = requiredCompetencyCount;
        session14FinalEval.requiredCount = activeLmsStudents.length;
        const att14ById = new Map<string, any>();
        for (const att of slot14?.studentAttendance || []) {
          const sid = String(att?.student?.id || att?.studentId || "").trim();
          if (sid) att14ById.set(sid, att);
        }

        const rcById = new Map(
          (computedReportCard?.students || []).map((s) => [s.studentId, s])
        );

        const letterByStudentId = new Map<string, any>();
        for (const lt of input.studentLetters || []) {
          const lSid = String(lt?.studentId || "").trim();
          if (!lSid) continue;
          const prevLt = letterByStudentId.get(lSid);
          if (
            !prevLt ||
            (!hasValidStudentLetterRecord(prevLt) && hasValidStudentLetterRecord(lt))
          ) {
            letterByStudentId.set(lSid, lt);
          }
        }

        for (const stu of activeLmsStudents) {
          const rcStu = rcById.get(stu.id);
          const att14 = att14ById.get(stu.id);
          const hasDirectDemoScore =
            Array.isArray(att14?.commentByAreas) &&
            att14.commentByAreas.some(
              (a: any) =>
                (String(a?.type || "").toUpperCase() === "DEMO" ||
                  Boolean(a?.courseProcessDemoId)) &&
                ((typeof a?.grade === "number" && a.grade > 0) ||
                  (Array.isArray(a?.demoQuestions) &&
                    a.demoQuestions.some((q: any) => Number(q?.score) > 0)))
            );
          const hasDemoScore =
            (rcStu?.final?.product?.value !== null &&
              rcStu?.final?.product?.value !== undefined) ||
            hasDirectDemoScore;
          const rateCount = Array.isArray(att14?.commentByAreas)
            ? att14.commentByAreas.filter(
                (a: any) =>
                  String(a?.type || "").toUpperCase() === "RATE" &&
                  Number.isFinite(Number(a?.grade)) &&
                  Number(a?.grade) > 0
              ).length
            : 0;
          const evalCriteriaCount = Array.isArray(att14?.evaluation?.criteria)
            ? att14.evaluation.criteria.filter((c: any) => {
                const v = Number(c?.level ?? c?.score ?? c?.grade);
                return Number.isFinite(v) && v > 0;
              }).length
            : 0;
          const hasAllRequiredCompetency =
            Math.max(rateCount, evalCriteriaCount) >= requiredCompetencyCount;
          const hasCompetency =
            hasAllRequiredCompetency &&
            ((rcStu?.final?.competency?.value !== null &&
              rcStu?.final?.competency?.value !== undefined) ||
              rateCount >= requiredCompetencyCount);
          const contentAreas = Array.isArray(att14?.commentByAreas)
            ? att14.commentByAreas
                .filter(
                  (a: any) =>
                    String(a?.type || "").toUpperCase() === "CONTENT" &&
                    stripHtmlPlain(a?.content).length > 0
                )
                .map((a: any) => stripHtmlPlain(a.content))
            : [];
          const combinedS14Comment = [
            stripHtmlPlain(att14?.comment || ""),
            ...contentAreas,
          ]
            .filter(Boolean)
            .join("\n");
          const has3Part =
            hasValidStudentLetterRecord(letterByStudentId.get(stu.id)) ||
            hasThreePartMindxComment(combinedS14Comment);

          if (hasDemoScore) session14FinalEval.demoScoredCount++;
          if (hasCompetency) session14FinalEval.competencyCompleteCount++;
          if (has3Part) session14FinalEval.mindx3PartCommentCount++;

          if (!hasDemoScore || !hasCompetency || !has3Part) {
            session14FinalEval.missingEvalStudents.push(stu.fullName);
          }
        }
      }
    }
  }

  const spckAudit: AdminSpckAuditSummary = {
    applicable: spckApplicable,
    slots: spckSlots,
    session14FinalEval,
    totalMissingUploads,
    totalMissingMediaOrLinks,
    totalMissingTeacherComments,
  };

  // ========================================================
  // TAB 4: > Buổi 9 SPCK Tasks on Teaching (Exempt PTB/CSB and LEGO ROB4/ROB6)
  // ========================================================
  const eligibleGt9 =
    !spckExemptCourse &&
    !isLegoClass &&
    currentSessionNumber >= 10 &&
    !isFinishedClass &&
    isConfirmedRunningStatus(status);
  const targetProgressPercent = mapSessionToTargetProgressPercent(currentSessionNumber);

  const remoteProject = teachingDetail?.project || null;
  const remoteTasks = teachingDetail?.tasks || [];
  const remoteProgress = teachingDetail?.taskProgress || {};

  const spckCompliance = evaluateTeachingSpckTasksCompliance({
    classCode,
    courseName,
    endDate,
    eligibleGt9,
    project: remoteProject,
    tasks: remoteTasks,
    activeStudentIds: activeTeachingStudents.map((s) => s.id),
  });
  const totalWeightPercent = spckCompliance.totalWeightPercent;
  const assignedStudentIdSet = spckCompliance.assignedStudentIdSet;
  const taskStatus = spckCompliance.taskStatus;

  let avgPct = 0;
  if (remoteTasks.length > 0 && activeTeachingStudents.length > 0) {
    let totalStuWeighted = 0;
    for (const st of activeTeachingStudents) {
      let stuScore = 0;
      for (const t of remoteTasks) {
        const pct = Number(remoteProgress[`${t.id}_${st.id}`] ?? 0);
        const w = Number(t.weight_percent) || 0;
        stuScore += (pct * w) / 100;
      }
      totalStuWeighted += stuScore;
    }
    avgPct = Math.round(totalStuWeighted / activeTeachingStudents.length);
  }

  const spckTasks: AdminSpckTeachingTasksSummary = {
    eligibleGt9,
    hasProject: Boolean(remoteProject?.id),
    projectId: remoteProject?.id ? Number(remoteProject.id) : null,
    projectName: remoteProject?.project_name || "",
    startDate:
      normalizeDateToIsoYmd(remoteProject?.start_date) || startDate,
    endDate:
      normalizeDateToIsoYmd(remoteProject?.end_date) || endDate,
    taskCount: remoteTasks.length,
    totalWeightPercent,
    assignedStudentCount: assignedStudentIdSet.size,
    averageProgressPercent: avgPct,
    targetProgressPercent,
    taskStatus,
  };

  // ========================================================
  // TAB 5: Early Warning Student Radar & Roster Drift
  // ========================================================
  const earlyWarnings: AdminEarlyWarningItem[] = [];
  const occurredSlots =
    latestOccurredIdx >= 0 ? slots.slice(0, latestOccurredIdx + 1) : [];

  // 5a. Consecutive absences >= 2
  if (occurredSlots.length >= 2) {
    const tail2 = occurredSlots.slice(-2);
    for (const stu of activeLmsStudents) {
      const absentBoth = tail2.every((slot) => {
        const att = (slot?.studentAttendance || []).find(
          (a: any) =>
            String(a?.student?.id || "").trim() === stu.id ||
            normalizeVietnameseName(a?.student?.fullName || "") ===
              normalizeVietnameseName(stu.fullName)
        );
        return normalizeAttendanceTag(att?.status) === "ABSENT";
      });
      if (absentBoth) {
        earlyWarnings.push({
          type: "CONSECUTIVE_ABSENCE",
          severity: "HIGH",
          studentName: stu.fullName,
          detail: `Vắng 2 buổi học liên tiếp gần nhất (Buổi ${occurredSlots.length - 1} & ${occurredSlots.length})`,
        });
      }
    }
  }

  // 5b. Consecutive missing BTVN >= 3 (Coding only)
  if (blockType === "CODING" && input.submissionGqlData) {
    const rawSubs = getRawSubmissionItems(input.submissionGqlData);
    const btvnLessons = extractBtvnLessonsFromGql(input.submissionGqlData).filter(
      (l) => currentSessionNumber > 1 && l.sessionNumber <= currentSessionNumber - 1
    );

    if (btvnLessons.length >= 3) {
      const tail3 = btvnLessons.slice(-3);
      for (const stu of activeLmsStudents) {
        const missedAll3 = tail3.every((lesson) => {
          const subs = rawSubs.filter((s) => {
            const rawSid = String(s?.studentId || s?.studentUid || "").trim();
            const canonicalStuId = subStudentAliasMap.get(rawSid) || rawSid;
            return (
              canonicalStuId === stu.id &&
              String(s?.lessonId || "").trim() === lesson.id
            );
          });
          return !subs.some((s) => {
            const st = String(s?.status || "").toUpperCase();
            return (
              st === "MARKED" ||
              st === "SUBMITTED" ||
              st === "REDO" ||
              hasSubmissionUploadEvidence(s)
            );
          });
        });
        if (missedAll3) {
          earlyWarnings.push({
            type: "CONSECUTIVE_MISSING_BTVN",
            severity: "HIGH",
            studentName: stu.fullName,
            detail: `Không nộp BTVN 3 buổi liên tiếp (Buổi ${tail3.map((l) => l.sessionNumber).join(", ")})`,
          });
        }
      }
    }
  }

  // 5c. Low CP score (< 2.5/5)
  if (computedReportCard) {
    for (const stu of computedReportCard.students) {
      if (!stu.isActive) continue;
      for (const [label, stage] of [
        ["CP1", stu.cp1],
        ["CP2", stu.cp2],
      ] as const) {
        const vals = [stage.theory.value, stage.practice.value].filter(
          (v): v is number => v !== null && Number.isFinite(v)
        );
        if (vals.length > 0) {
          const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
          if (avg < 2.5) {
            earlyWarnings.push({
              type: "LOW_CHECKPOINT_SCORE",
              severity: "HIGH",
              studentName: stu.fullName,
              detail: `Điểm ${label} dưới 2.5/5 (${avg.toFixed(1)}/5)`,
            });
          }
        }
      }
    }
  }

  // 5d. Roster Mismatch (LMS vs Teaching)
  const studentsEndpointOk =
    Boolean(teachingDetail) &&
    !teachingDetail?.failedEndpoints?.includes("students");
  if (
    studentsEndpointOk &&
    (activeLmsStudents.length > 0 || activeTeachingStudents.length > 0)
  ) {
    const teachingNormSet = new Set(
      activeTeachingStudents.map((s) => normalizeVietnameseName(s.student_name))
    );
    const missingOnTeaching = activeLmsStudents
      .filter((s) => !teachingNormSet.has(normalizeVietnameseName(s.fullName)))
      .map((s) => s.fullName);

    if (
      activeLmsStudents.length !== activeTeachingStudents.length ||
      missingOnTeaching.length > 0
    ) {
      earlyWarnings.push({
        type: "ROSTER_MISMATCH",
        severity: "MEDIUM",
        detail: `Lệch sĩ số LMS (${activeLmsStudents.length} HV) vs Teaching (${activeTeachingStudents.length} HV)${
          missingOnTeaching.length > 0
            ? ` — chưa khớp: ${missingOnTeaching.join(", ")}`
            : ""
        }`,
      });
    }
  }

  // 5e. Makeup debt (hocbu.php) — strictly pending/active debts only
  for (const m of input.teachingMakeupRows || []) {
    if (isCompletedOrCancelledMakeupStatus(m.status, m.attendanceStatus)) {
      continue;
    }
    earlyWarnings.push({
      type: "MAKEUP_DEBT",
      severity: "MEDIUM",
      studentName: m.studentName || undefined,
      detail: `Học bù ${m.sessionLabel || ""}: ${m.status}`.trim(),
    });
  }

  const btvnSyncStatus: AdminCenterClassRecord["btvnSyncStatus"] =
    blockType !== "CODING"
      ? "IDLE"
      : btvnSummary.ungradedCellsCount > 0 && btvnSummary.gradedCellsCount === 0
      ? "NEEDS_ATTENTION"
      : btvnSummary.isOutOfSyncWithTeaching
      ? "OUT_OF_SYNC"
      : btvnSummary.teachingScoredCellsCount > 0 && btvnSummary.gradedCellsCount > 0
      ? "VERIFIED"
      : "IDLE";

  const spckTasksSyncStatus: AdminCenterClassRecord["spckTasksSyncStatus"] =
    taskStatus === "READY"
      ? "VERIFIED"
      : taskStatus === "MISSING_PROJECT"
      ? "MISSING"
      : taskStatus === "INCOMPLETE_TASKS" || taskStatus === "NEEDS_STUDENT_ASSIGN"
      ? "INCOMPLETE"
      : "IDLE";

  return {
    classCode,
    centerCode,
    lmsClassId,
    courseName,
    blockType,
    isMakeupClass,
    status,
    startDate,
    endDate,
    currentSessionNumber,
    currentSessionDate: evaluatedSessionDate,
    timeSlot: input.teachingScheduleEntry?.timeSlot || "",
    mainTeacher,
    assistantTeacher,
    specialEvent:
      !teachingSessNum || currentSessionNumber <= 0 || teachingSessNum === currentSessionNumber
        ? input.teachingScheduleEntry?.specialEvent || ""
        : "",
    activeStudentCount: activeLmsStudents.length,
    teachingStudentCount: activeTeachingStudents.length,
    weeklyOpsJson: JSON.stringify(weeklyOps),
    btvnSummaryJson: JSON.stringify(btvnSummary),
    spckAuditJson: JSON.stringify(spckAudit),
    spckTasksJson: JSON.stringify(spckTasks),
    earlyWarningsJson: JSON.stringify(earlyWarnings),
    lmsReportCardSnapshotJson: reportCardSnapshot
      ? JSON.stringify(reportCardSnapshot)
      : "{}",
    btvnSyncStatus,
    btvnSyncedAt:
      btvnSyncStatus === "VERIFIED" ? new Date(nowMs).toISOString() : null,
    btvnLastError: null,
    spckTasksSyncStatus,
    spckTasksSyncedAt:
      spckTasksSyncStatus === "VERIFIED" ? new Date(nowMs).toISOString() : null,
    spckTasksLastError: null,
    lastScannedAt: new Date(nowMs).toISOString(),
    lastError: null,
  };
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function mapAdminClassRecordToDto(
  row: AdminCenterClassRecord,
  teachingBaseOrigin: string = "https://teachingmindx.top"
): AdminClassRowDto {
  const origin = teachingBaseOrigin.replace(/\/+$/, "");
  const defaultWeeklyOps: AdminWeeklyOpsSummary = {
    evaluatedSessionNumber: row.currentSessionNumber,
    evaluatedSessionDate: row.currentSessionDate,
    attendanceStatus: "NOT_DUE",
    presentCount: 0,
    absentCount: 0,
    unmarkedCount: 0,
    hasSummaryAndHomework: false,
    commentedPresentCount: 0,
    missingCommentStudentNames: [],
    zaloStatus: "",
    zaloDeadline: "",
    isZaloLateOrMissing: false,
    lmsCheckStatus: "",
    lmsDeadline: "",
    isLmsLateOrMissing: false,
    checkIssueNote: "",
    checkpointAlert: null,
  };
  const defaultBtvn: AdminBtvnCodingSummary = {
    applicable: row.blockType === "CODING",
    latestHomeworkSessionNumber: 0,
    submittedCount: 0,
    expectedCount: 0,
    submissionRatePercent: 0,
    lowSubmissionWarning: false,
    ungradedCellsCount: 0,
    ungradedSessions: [],
    gradedCellsCount: 0,
    redoCellsCount: 0,
    notSubmittedCellsCount: 0,
    teachingDeclaredBtvnSessions: [],
    teachingScoredCellsCount: 0,
    isOutOfSyncWithTeaching: false,
  };
  const emptySlot = (sn: 12 | 13 | 14): AdminSpckSlotAuditItem => ({
    sessionNumber: sn,
    sessionOccurred: false,
    requiredCount: 0,
    uploadedCount: 0,
    commentedCount: 0,
    missingUploadStudents: [],
    missingImageOrLinkStudents: [],
    missingTeacherCommentStudents: [],
  });
  const defaultSpck: AdminSpckAuditSummary = {
    applicable: false,
    slots: { "12": emptySlot(12), "13": emptySlot(13), "14": emptySlot(14) },
    session14FinalEval: {
      applicable: false,
      requiredCount: 0,
      demoScoredCount: 0,
      competencyCompleteCount: 0,
      mindx3PartCommentCount: 0,
      missingEvalStudents: [],
    },
    totalMissingUploads: 0,
    totalMissingMediaOrLinks: 0,
    totalMissingTeacherComments: 0,
  };
  const rowSpckExempt =
    isAdminSpckExemptClass(row.classCode, row.courseName) ||
    isLegoRoboticsClassCode(row.classCode, row.courseName);
  const defaultTasks: AdminSpckTeachingTasksSummary = {
    eligibleGt9:
      !rowSpckExempt && row.currentSessionNumber >= 10 && isConfirmedRunningStatus(row.status),
    hasProject: false,
    projectId: null,
    projectName: "",
    startDate: row.startDate,
    endDate: row.endDate,
    taskCount: 0,
    totalWeightPercent: 0,
    assignedStudentCount: 0,
    averageProgressPercent: 0,
    targetProgressPercent: mapSessionToTargetProgressPercent(row.currentSessionNumber),
    taskStatus:
      !rowSpckExempt && row.currentSessionNumber >= 10 && isConfirmedRunningStatus(row.status)
        ? "MISSING_PROJECT"
        : "NOT_ELIGIBLE",
  };

  return {
    classCode: row.classCode,
    centerCode: row.centerCode,
    lmsClassId: row.lmsClassId,
    courseName: row.courseName,
    blockType: row.blockType,
    isMakeupClass: Boolean(row.isMakeupClass),
    status: row.status,
    startDate: row.startDate,
    endDate: row.endDate,
    currentSessionNumber: row.currentSessionNumber,
    currentSessionDate: row.currentSessionDate,
    timeSlot: row.timeSlot,
    mainTeacher: row.mainTeacher,
    assistantTeacher: row.assistantTeacher,
    specialEvent: row.specialEvent,
    activeStudentCount: row.activeStudentCount,
    teachingStudentCount: row.teachingStudentCount,
    weeklyOps: {
      ...defaultWeeklyOps,
      ...safeJsonParse<Partial<AdminWeeklyOpsSummary>>(row.weeklyOpsJson, {}),
    },
    btvnSummary: {
      ...defaultBtvn,
      ...safeJsonParse<Partial<AdminBtvnCodingSummary>>(row.btvnSummaryJson, {}),
    },
    spckAudit: {
      ...defaultSpck,
      ...safeJsonParse<Partial<AdminSpckAuditSummary>>(row.spckAuditJson, {}),
    },
    spckTasks: {
      ...defaultTasks,
      ...safeJsonParse<Partial<AdminSpckTeachingTasksSummary>>(row.spckTasksJson, {}),
    },
    earlyWarnings: safeJsonParse<AdminEarlyWarningItem[]>(row.earlyWarningsJson, []),
    btvnSyncStatus: row.btvnSyncStatus,
    btvnSyncedAt: row.btvnSyncedAt,
    btvnLastError: row.btvnLastError ? redactSecrets(row.btvnLastError) : null,
    spckTasksSyncStatus: row.spckTasksSyncStatus,
    spckTasksSyncedAt: row.spckTasksSyncedAt,
    spckTasksLastError: row.spckTasksLastError ? redactSecrets(row.spckTasksLastError) : null,
    lastScannedAt: row.lastScannedAt,
    lastError: row.lastError ? redactSecrets(row.lastError) : null,
    lmsCommentsUrl: buildLmsClassCommentsUrl({
      lmsBaseUrl: config.lmsUrl,
      classCode: row.classCode,
      lmsClassId: row.lmsClassId || undefined,
      tab: 10,
    }),
    lmsHomeworkUrl: buildLmsClassCommentsUrl({
      lmsBaseUrl: config.lmsUrl,
      classCode: row.classCode,
      lmsClassId: row.lmsClassId || undefined,
      tab: 3,
    }),
    teachingScoreBoardUrl: `${origin}/diem-tong-ket.php?class_code=${encodeURIComponent(row.classCode)}`,
    teachingStudentsUrl: `${origin}/hocsinh.php?class_code=${encodeURIComponent(row.classCode)}`,
    teachingProgressUrl: `${origin}/duan_tiendo_hocsinh.php?class_code=${encodeURIComponent(row.classCode)}`,
  };
}

export function buildAdminOverviewResponse(options?: {
  includeMakeup?: boolean;
  centerCode?: string;
  makeupRecords?: TeachingHocBuEntry[];
}): AdminCenterOverviewResponse {
  const adminCfg = getDynamicAdminConfig();
  const centerCode = (options?.centerCode || adminCfg.adminCenterCode || "205ALHP")
    .trim()
    .toUpperCase();
  const includeMakeup = Boolean(options?.includeMakeup);

  const rawRows = adminCenterRepo
    .listClasses({ centerCode, includeMakeup })
    .filter(
      (r) =>
        !isAdminUnstartedOrPendingClass({
          status: r.status,
          currentSessionNumber: r.currentSessionNumber,
          hasSlots: true,
        })
    );
  const classes = rawRows.map((r) => mapAdminClassRecordToDto(r, "https://teachingmindx.top"));
  const { instructors, campusZaloSummaryText } = buildInstructorSummariesAndCampusText(
    classes,
    centerCode
  );

  let runningClasses = 0;
  let codingClasses = 0;
  let roboticsClasses = 0;
  let weeklyOpsIssuesCount = 0;
  let codingBtvnIssuesCount = 0;
  let codingUngradedSubmissionsTotal = 0;
  let spckAuditIssuesCount = 0;
  let gt9ClassesTotal = 0;
  let gt9MissingTasksCount = 0;
  let earlyWarningsTotal = 0;
  let rosterMismatchClassesCount = 0;
  let makeupDebtClassesCount = 0;

  for (const c of classes) {
    if (isConfirmedRunningStatus(c.status)) runningClasses++;
    if (c.blockType === "ROBOTICS") roboticsClasses++;
    else codingClasses++;

    const hasWeeklyIssue =
      c.weeklyOps.attendanceStatus === "NOT_MARKED" ||
      c.weeklyOps.attendanceStatus === "PARTIAL" ||
      (c.weeklyOps.evaluatedSessionNumber > 0 && !c.weeklyOps.hasSummaryAndHomework) ||
      c.weeklyOps.missingCommentStudentNames.length > 0 ||
      c.weeklyOps.isZaloLateOrMissing ||
      c.weeklyOps.isLmsLateOrMissing ||
      Boolean(
        c.weeklyOps.checkpointAlert &&
          !c.weeklyOps.checkpointAlert.isMakeupPendingOnly &&
          c.weeklyOps.checkpointAlert.missingScoreCount > 0
      );
    if (hasWeeklyIssue) weeklyOpsIssuesCount++;

    if (c.blockType === "CODING" && c.btvnSummary.applicable) {
      codingUngradedSubmissionsTotal += c.btvnSummary.ungradedCellsCount;
      if (
        c.btvnSummary.ungradedCellsCount > 0 ||
        c.btvnSummary.lowSubmissionWarning ||
        c.btvnSummary.isOutOfSyncWithTeaching
      ) {
        codingBtvnIssuesCount++;
      }
    }

    if (
      c.spckAudit.applicable &&
      (c.spckAudit.totalMissingUploads > 0 ||
        c.spckAudit.totalMissingMediaOrLinks > 0 ||
        c.spckAudit.totalMissingTeacherComments > 0)
    ) {
      spckAuditIssuesCount++;
    }

    if (c.spckTasks.eligibleGt9) {
      gt9ClassesTotal++;
      if (c.spckTasks.taskStatus !== "READY") {
        gt9MissingTasksCount++;
      }
    }

    earlyWarningsTotal += c.earlyWarnings.length;
    if (c.earlyWarnings.some((w) => w.type === "ROSTER_MISMATCH")) {
      rosterMismatchClassesCount++;
    }
    if (c.earlyWarnings.some((w) => w.type === "MAKEUP_DEBT")) {
      makeupDebtClassesCount++;
    }
  }

  const kpis: AdminOverviewKpis = {
    totalClasses: classes.length,
    runningClasses,
    codingClasses,
    roboticsClasses,
    weeklyOpsIssuesCount,
    codingBtvnIssuesCount,
    codingUngradedSubmissionsTotal,
    spckAuditIssuesCount,
    gt9ClassesTotal,
    gt9MissingTasksCount,
    earlyWarningsTotal,
    rosterMismatchClassesCount,
    makeupDebtClassesCount,
  };

  const latestRunRaw = adminCenterRepo.getLatestScanRun(centerCode);
  const maskSimple = (u: string) =>
    !u
      ? ""
      : u.includes("@")
      ? u.replace(/^(.{2})(.*)(@.*)$/, "$1***$3")
      : u.length > 3
      ? `${u.slice(0, 2)}***${u.slice(-1)}`
      : "***";

  const rawProgress = getAdminScanProgressState();
  return {
    success: true,
    centerCode,
    hasAdminLmsAuth: Boolean(adminCfg.adminLmsUsername && adminCfg.adminLmsPassword),
    adminLmsUsernameMasked: maskSimple(adminCfg.adminLmsUsername),
    adminTeachingUsernameMasked: maskSimple(adminCfg.adminTeachingUsername),
    teachingBaseOrigin: "https://teachingmindx.top",
    scanProgress: {
      ...rawProgress,
      lastError: rawProgress.lastError ? redactSecrets(rawProgress.lastError) : null,
    },
    latestScanRun: latestRunRaw
      ? {
          runId: latestRunRaw.runId,
          scanScope: latestRunRaw.scanScope,
          status: latestRunRaw.status,
          totalClasses: latestRunRaw.totalClasses,
          scannedClasses: latestRunRaw.scannedClasses,
          startedAt: latestRunRaw.startedAt,
          finishedAt: latestRunRaw.finishedAt,
        }
      : null,
    kpis,
    classes,
    instructors,
    campusZaloSummaryText,
    makeupRecords: options?.makeupRecords || [],
  };
}

// =========================================================================
// Live LMS GraphQL Scanner (inside single BrowserContext + Admin role swap)
// =========================================================================

const FALLBACK_CLASSES_QUERY = `
  query AdminSearchClasses($text: String, $pageIndex: Int, $itemsPerPage: Int) {
    classes(payload: { filter_textSearch: $text, pageIndex: $pageIndex, itemsPerPage: $itemsPerPage }) {
      data {
        id
        name
        status
        startDate
        endDate
        course {
          id
          name
        }
        teachers {
          role {
            name
          }
          teacher {
            fullName
            username
          }
        }
      }
      pagination {
        total
      }
    }
  }
`;

const MINIMAL_CLASSES_QUERY = `
  query AdminSearchClassesMinimal($text: String) {
    classes(payload: { filter_textSearch: $text }) {
      data {
        id
        name
        status
        startDate
        endDate
      }
    }
  }
`;

const CAMPUS_CLASSES_BY_CENTRE_QUERY = `
  query AdminCampusClassesByCentre($centres: [String], $status: [String], $pageIndex: Int, $itemsPerPage: Int) {
    classes(payload: { centre_in: $centres, status_in: $status, pageIndex: $pageIndex, itemsPerPage: $itemsPerPage }) {
      data {
        id
        name
        status
        startDate
        endDate
        course {
          id
          name
        }
        teachers {
          role {
            name
          }
          teacher {
            fullName
            username
          }
        }
      }
      pagination {
        total
      }
    }
  }
`;

const CAMPUS_CLASSES_BY_CENTRE_NO_STATUS_QUERY = `
  query AdminCampusClassesByCentreNoStatus($centres: [String], $pageIndex: Int, $itemsPerPage: Int) {
    classes(payload: { centre_in: $centres, pageIndex: $pageIndex, itemsPerPage: $itemsPerPage }) {
      data {
        id
        name
        status
        startDate
        endDate
        course {
          id
          name
        }
        teachers {
          role {
            name
          }
          teacher {
            fullName
            username
          }
        }
      }
      pagination {
        total
      }
    }
  }
`;

const CAMPUS_MISS_ATTEND_CLASSES_QUERY = `
  query classesMissAttendOrComment($type: [String], $search: String, $centres: [String], $pageIndex: Int, $itemsPerPage: Int, $orderBy: String, $status: [String]) {
    classesMissAttendOrComment(
      payload: {
        type: $type,
        filter_textSearch: $search,
        centre_in: $centres,
        pageIndex: $pageIndex,
        itemsPerPage: $itemsPerPage,
        orderBy: $orderBy,
        status_in: $status
      }
    ) {
      data {
        id
        name
        status
        startDate
        endDate
        course {
          id
          name
        }
        teachers {
          role {
            name
          }
          teacher {
            fullName
            username
          }
        }
      }
    }
  }
`;

const CAMPUS_MISS_ATTEND_MINIMAL_QUERY = `
  query classesMissAttendOrCommentMinimal($type: [String], $search: String, $centres: [String], $pageIndex: Int, $itemsPerPage: Int, $orderBy: String, $status: [String]) {
    classesMissAttendOrComment(
      payload: {
        type: $type,
        filter_textSearch: $search,
        centre_in: $centres,
        pageIndex: $pageIndex,
        itemsPerPage: $itemsPerPage,
        orderBy: $orderBy,
        status_in: $status
      }
    ) {
      data {
        id
        name
      }
    }
  }
`;

const FALLBACK_GET_CLASS_BY_ID_QUERY = `
  query GetClassById($id: ID!) {
    classesById(id: $id) {
      id
      name
      status
      startDate
      endDate
      course {
        id
        name
      }
      teachers {
        role {
          name
        }
        teacher {
          fullName
          username
        }
      }
      students {
        activeInClass
        student {
          id
          fullName
        }
      }
      slots {
        _id
        summary
        homework
        date
        startTime
        endTime
        teachers {
          isActive
          role {
            name
            shortName
          }
          teacher {
            id
            fullName
            username
          }
        }
        teacherAttendance {
          status
          teacher {
            id
            fullName
            username
          }
        }
        studentAttendance {
          _id
          status
          comment
          sendCommentStatus
          commentByAreas {
            type
            grade
            content
            courseProcessDemoId
            checkpoint {
              checkpointScore
              practiceScore
              checkpointQuestions {
                result
              }
            }
            demoQuestions {
              courseProcessDemoDetailId
              title
              result
              score
              maxScore
            }
          }
          student {
            id
            fullName
          }
        }
      }
    }
  }
`;

const FALLBACK_GET_CLASS_BY_ID_MINIMAL_QUERY = `
  query GetClassByIdMinimal($id: ID!) {
    classesById(id: $id) {
      id
      name
      status
      startDate
      endDate
      course {
        id
        name
      }
      teachers {
        role {
          name
        }
        teacher {
          fullName
          username
        }
      }
      students {
        activeInClass
        student {
          id
          fullName
        }
      }
      slots {
        _id
        summary
        homework
        date
        startTime
        endTime
        studentAttendance {
          status
          comment
          sendCommentStatus
          student {
            id
            fullName
          }
        }
      }
    }
  }
`;

const FALLBACK_CLASS_FIELD_BY_ID_QUERY = `
  query AdminGetClassFieldById($id: ID!) {
    class(id: $id) {
      id
      name
      status
      startDate
      endDate
      course {
        id
        name
      }
      teachers {
        role {
          name
        }
        teacher {
          fullName
          username
        }
      }
      students {
        activeInClass
        student {
          id
          fullName
        }
      }
      slots {
        _id
        summary
        homework
        date
        startTime
        endTime
        teachers {
          isActive
          role {
            name
            shortName
          }
          teacher {
            id
            fullName
            username
          }
        }
        teacherAttendance {
          status
          teacher {
            id
            fullName
            username
          }
        }
        studentAttendance {
          _id
          status
          comment
          sendCommentStatus
          commentByAreas {
            type
            grade
            content
            courseProcessDemoId
            checkpoint {
              checkpointScore
              practiceScore
              checkpointQuestions {
                result
              }
            }
            demoQuestions {
              courseProcessDemoDetailId
              title
              result
              score
              maxScore
            }
          }
          student {
            id
            fullName
          }
        }
      }
    }
  }
`;

const FALLBACK_CLASS_FIELD_BY_ID_MINIMAL_QUERY = `
  query AdminGetClassFieldByIdMinimal($id: ID!) {
    class(id: $id) {
      id
      name
      status
      startDate
      endDate
      course {
        id
        name
      }
      teachers {
        role {
          name
        }
        teacher {
          fullName
          username
        }
      }
      students {
        activeInClass
        student {
          id
          fullName
        }
      }
      slots {
        _id
        summary
        homework
        date
        startTime
        endTime
        studentAttendance {
          status
          comment
          sendCommentStatus
          student {
            id
            fullName
          }
        }
      }
    }
  }
`;

const FALLBACK_SUBMISSION_QUERY = `
  query FindStudentSubmissionByClass($payload: FindStudentSubmissionByClassQuery) {
    findStudentSubmissionByClass(payload: $payload) {
      lessons {
        id
        name
        type
        displayOrder
      }
      students {
        id
        studentUid
        displayName
      }
      submissions {
        id
        lessonId
        studentUid
        category
        status
        score
        submittedCount
        submittedAt
        content {
          attachments
        }
      }
    }
  }
`;

const FALLBACK_SUBMISSION_LEGACY_QUERY = `
  query FindStudentSubmissionByClassLegacy($classId: ID!) {
    findStudentSubmissionByClass(classId: $classId) {
      lessons {
        id
        name
        type
        displayOrder
      }
      students {
        id
        studentUid
        displayName
      }
      submissions {
        id
        lessonId
        studentId
        studentUid
        category
        status
        score
        submittedCount
        submittedAt
        content {
          attachments
        }
      }
    }
  }
`;

const FIND_ALL_STUDENT_WORKS_QUERY = `
  query AdminFindWorks($classId: String) {
    findAllStudentWorks(payload: { classId_equals: $classId }) {
      data {
        id
        status
        studentId
        classSessionId
        classSessionNumber
        classId
        isDeleted
        latestData {
          title
          comment
          thumbnail
          imageUrl
          attachmentUrls
          videoUrls
        }
      }
    }
  }
`;

const FIND_ALL_STUDENT_WORKS_MINIMAL_QUERY = `
  query AdminFindWorksMinimal($classId: String) {
    findAllStudentWorks(payload: { classId_equals: $classId }) {
      data {
        id
        status
        studentId
        classSessionId
        classSessionNumber
        classId
        isDeleted
        latestData {
          title
          comment
        }
      }
    }
  }
`;

export function buildLmsClassSearchCandidates(classCode: string): string[] {
  const code = String(classCode || "").trim().toUpperCase();
  if (!code) return [];
  const out: string[] = [];
  const add = (candidate: string) => {
    const clean = String(candidate || "").trim().toUpperCase();
    if (!clean || clean === "HB" || clean === "VT" || clean.length < 4) return;
    if (!out.includes(clean)) out.push(clean);
  };
  add(code);
  const withoutHb = code.replace(/-HB$/i, "");
  add(withoutHb);
  for (const base of [code, withoutHb]) {
    add(base.replace(/^VT-(?:C4K-|ROB-|KIND-)?/i, ""));
    add(base.replace(/^VT-/i, ""));
    const dashParts = base.split("-").filter(Boolean);
    add(dashParts[dashParts.length - 1] || "");
  }
  return out;
}

function buildLmsGqlCaptureListener(state: {
  capturedHeaders: Record<string, string>;
  capturedGetClassQuery: string;
  capturedSubmissionQuery: string;
  capturedSubmissionVars: any;
  capturedCentres?: string[];
}) {
  return (req: any) => {
    try {
      if (
        typeof req?.url === "function" &&
        req.url().toLowerCase().includes("lms-api.mindx.edu.vn") &&
        typeof req?.method === "function" &&
        req.method().toUpperCase() === "POST"
      ) {
        const h = req.headers();
        if (h?.authorization || h?.Authorization || h?.token || h?.Token) {
          state.capturedHeaders = { ...state.capturedHeaders, ...h };
        }
        const postBody = req.postDataJSON?.();
        if (postBody?.operationName === "GetClassById" && typeof postBody?.query === "string") {
          state.capturedGetClassQuery = postBody.query;
        }
        if (
          postBody?.operationName === "FindStudentSubmissionByClass" &&
          typeof postBody?.query === "string"
        ) {
          state.capturedSubmissionQuery = postBody.query;
          if (postBody?.variables && typeof postBody.variables === "object") {
            state.capturedSubmissionVars = postBody.variables;
          }
        }
        const reqCentres = postBody?.variables?.centres;
        if (Array.isArray(reqCentres) && state.capturedCentres) {
          for (const cid of reqCentres) {
            const s = String(cid || "").trim();
            if (s && !state.capturedCentres.includes(s)) {
              state.capturedCentres.push(s);
            }
          }
        }
      }
    } catch {
      // ignore malformed request
    }
  };
}

function isLikelyJwtToken(raw: string): boolean {
  const clean = String(raw || "")
    .trim()
    .replace(/^"+|"+$/g, "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (clean.length < 30) return false;
  return clean.split(".").length === 3 && /^eyJ/i.test(clean);
}

async function resolveAdminPageAuthHeaders(
  page: Page,
  capturedHeaders: Record<string, string>
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let authHeader = "";
  let tokenHeader = "";

  for (const [k, v] of Object.entries(capturedHeaders || {})) {
    const kl = k.toLowerCase();
    const val = String(v || "").trim();
    if (!val) continue;
    if (kl === "authorization") {
      authHeader = val;
      out[k] = val;
    } else if (kl === "token") {
      tokenHeader = val;
      out[k] = val;
    } else if (kl.startsWith("x-") || kl.startsWith("apollo-")) {
      out[k] = val;
    }
  }

  let rawJwt = "";
  if (authHeader) {
    rawJwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  } else if (tokenHeader) {
    rawJwt = tokenHeader.replace(/^Bearer\s+/i, "").trim();
  }

  if ((!authHeader || !tokenHeader) && !rawJwt) {
    if (typeof (page as any)?.context === "function") {
      try {
        const cookies = await page.context().cookies();
        const preferredOrder = [
          "session",
          "id_token",
          "access_token",
          "lms_token",
          "auth_token",
          "token",
        ];
        const mindxCookies = cookies.filter((c) =>
          /(^|\.)mindx\.(edu|net|com)\.vn$/i.test(String(c?.domain || "").replace(/^\.+/, ""))
        );
        mindxCookies.sort((a, b) => {
          const ai = preferredOrder.indexOf(String(a?.name || "").toLowerCase());
          const bi = preferredOrder.indexOf(String(b?.name || "").toLowerCase());
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        });
        for (const c of mindxCookies) {
          let decoded = String(c?.value || "").trim();
          try {
            decoded = decodeURIComponent(decoded).trim();
          } catch {
            // keep raw value
          }
          if (isLikelyJwtToken(decoded)) {
            rawJwt = decoded.replace(/^"+|"+$/g, "").replace(/^Bearer\s+/i, "").trim();
            break;
          }
          if (decoded.startsWith("{")) {
            try {
              const obj = JSON.parse(decoded);
              for (const k of ["id_token", "access_token", "lms_token", "auth_token", "token", "idToken", "accessToken"]) {
                const candidate = String(obj?.[k] || "").trim();
                if (isLikelyJwtToken(candidate)) {
                  rawJwt = candidate.replace(/^Bearer\s+/i, "").trim();
                  break;
                }
              }
              if (rawJwt) break;
            } catch {
              // ignore non-JSON cookie
            }
          }
        }
        // Validate identity hint is available without failing if omitted
        void extractIdentityFromMindxCookies(cookies);
      } catch {
        // ignore cookie lookup failure
      }
    }

    if (!rawJwt && typeof (page as any)?.evaluate === "function") {
      try {
        const lsToken = await page
          .evaluate(() => {
            try {
              const keys = ["id_token", "access_token", "lms_token", "auth_token", "token"];
              for (const k of keys) {
                const raw = String(window.localStorage.getItem(k) || "").trim().replace(/^"+|"+$/g, "");
                if (raw.split(".").length === 3 && /^eyJ/i.test(raw)) return raw;
              }
              for (let i = 0; i < window.localStorage.length; i++) {
                const lk = window.localStorage.key(i);
                if (!lk) continue;
                const val = String(window.localStorage.getItem(lk) || "").trim();
                const unquoted = val.replace(/^"+|"+$/g, "");
                if (unquoted.split(".").length === 3 && /^eyJ/i.test(unquoted)) {
                  return unquoted;
                }
                if (val.startsWith("{")) {
                  try {
                    const p = JSON.parse(val);
                    const nested =
                      p?.stsTokenManager?.accessToken || p?.idToken || p?.accessToken || p?.token || "";
                    if (typeof nested === "string" && nested.split(".").length === 3 && /^eyJ/i.test(nested)) {
                      return nested;
                    }
                  } catch {
                    // ignore
                  }
                }
              }
            } catch {
              // ignore
            }
            return "";
          })
          .catch(() => "");
        if (lsToken && isLikelyJwtToken(lsToken)) {
          rawJwt = lsToken.replace(/^Bearer\s+/i, "").trim();
        }
      } catch {
        // ignore localStorage fallback errors
      }
    }
  }

  if (rawJwt) {
    if (!authHeader) {
      out.authorization = rawJwt.startsWith("Bearer ") ? rawJwt : `Bearer ${rawJwt}`;
    }
    if (!tokenHeader) {
      out.token = rawJwt.replace(/^Bearer\s+/i, "").trim();
    }
  }

  return out;
}

export interface AdminLmsFetchedBundle {
  discoveredClasses: Array<{
    lmsClassId: string;
    classCode: string;
    courseName: string;
    status: string;
    startDate: string;
    endDate: string;
    mainTeacher: string;
    assistantTeacher: string;
  }>;
  perClass: Map<
    string,
    {
      classByIdData: any | null;
      submissionGqlData: any | null;
      studentWorks: any[];
      studentLetters?: any[];
      error?: string;
      subError?: string;
      worksError?: string;
    }
  >;
  stoppedEarly: boolean;
  discoveryComplete?: boolean;
  discoveryError?: string;
  expectedTotal?: number | null;
}

export async function fetchSingleLmsClassGqlInAdminSession(
  page: Page,
  classCode: string,
  options?: { lmsClassId?: string }
): Promise<{
  lmsClassId: string;
  classByIdData: any | null;
  submissionGqlData: any | null;
  studentWorks: any[];
}> {
  const adminCfg = getDynamicAdminConfig();
  const knownLmsClassId = String(options?.lmsClassId || "").trim();
  const captureState = {
    capturedHeaders: {} as Record<string, string>,
    capturedGetClassQuery: "",
    capturedSubmissionQuery: "",
    capturedSubmissionVars: null as any,
    capturedCentres: [] as string[],
  };
  const reqListener = buildLmsGqlCaptureListener(captureState);

  page.on("request", reqListener);
  try {
    const targetUrl = buildLmsClassCommentsUrl({
      lmsBaseUrl: config.lmsUrl,
      classCode,
      ...(knownLmsClassId ? { lmsClassId: knownLmsClassId } : {}),
      tab: 3,
    });
    await page
      .goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 25000 })
      .catch(() => {});
    const interceptor = createNetworkInterceptor(page);
    await interceptor.dismissForbiddenToast().catch(() => {});

    try {
      await LmsHelpers.openClassDrawer(page, classCode);
      await LmsHelpers.switchDrawerTab(page, SELECTORS.tabs.grading);
      await page.waitForTimeout(1500);
    } catch {
      // Fallback directly to cookie-JWT GraphQL queries when UI drawer times out (F05)
    }

    const resolvedHeaders = await resolveAdminPageAuthHeaders(page, captureState.capturedHeaders);
    const activeCentreIds = adminCfg.adminLmsCentreFilterDisabled
      ? []
      : captureState.capturedCentres.length > 0
        ? Array.from(new Set([...adminCfg.adminLmsCentreIds, ...captureState.capturedCentres]))
        : adminCfg.adminLmsCentreIds;
    const searchCandidates = buildLmsClassSearchCandidates(classCode);

    await page.evaluate("window.__name = window.__name || function(f){ return f; }").catch(() => {});
    const res = await page.evaluate(
      async ({
        clsCode,
        knownLmsId,
        hdrs,
        centreIds,
        searchCandidates: candList,
        getClassQ,
        getClassMinQ,
        classFieldQ,
        classFieldMinQ,
        subQ,
        subLegacyQ,
        subVarsTemplate,
        classesQ,
        minClassesQ,
        missAttendQ,
        missAttendMinQ,
        worksQ,
        worksMinQ,
        isRobotics,
      }: any) => {
        const headers: Record<string, string> = {
          "content-type": "application/json",
        };
        for (const [k, v] of Object.entries(hdrs || {})) {
          const kl = k.toLowerCase();
          if (
            kl === "authorization" ||
            kl === "token" ||
            kl.startsWith("x-") ||
            kl.startsWith("apollo-")
          ) {
            headers[k] = String(v);
          }
        }
        const gql = async (query: string, variables?: any, operationName?: string) => {
          const r = await fetch("https://lms-api.mindx.edu.vn/", {
            method: "POST",
            headers,
            body: JSON.stringify({ query, variables, ...(operationName ? { operationName } : {}) }),
          });
          const parsed =
            typeof r?.json === "function" ? await r.json().catch(() => null) : null;
          if (!r || !r.ok) {
            const gqlMsg =
              Array.isArray(parsed?.errors) && parsed.errors.length > 0
                ? String(parsed.errors[0]?.message || "")
                : "";
            return {
              __httpError: true,
              status: Number(r?.status || 0),
              errors: [{ message: gqlMsg || `LMS GraphQL HTTP ${r?.status ?? "ERR"}` }],
              data: null,
            };
          }
          if (!parsed || typeof parsed !== "object") {
            return {
              __httpError: true,
              status: Number(r.status || 0),
              errors: [{ message: `LMS GraphQL phản hồi không hợp lệ (HTTP ${r.status})` }],
              data: null,
            };
          }
          return parsed;
        };

        const isTransportOrAuthErr = (resObj: any) =>
          Boolean(resObj?.__httpError) &&
          (Number(resObj?.status) === 401 ||
            Number(resObj?.status) === 403 ||
            Number(resObj?.status) >= 500);

        const normalizedTarget = String(clsCode || "").trim().toUpperCase();
        const candidates =
          Array.isArray(candList) && candList.length > 0 ? candList : [normalizedTarget];
        let matched: any = null;
        let listErr = "";
        let anyListCallOk = false;
        let sawListTransportOrAuthErr = false;

        for (const cand of candidates) {
          let listRes = await gql(classesQ, { text: cand, pageIndex: 0, itemsPerPage: 20 });
          if (
            ((Array.isArray(listRes?.errors) && listRes.errors.length > 0) ||
              !Array.isArray(listRes?.data?.classes?.data)) &&
            minClassesQ &&
            !isTransportOrAuthErr(listRes)
          ) {
            listRes = await gql(minClassesQ, { text: cand });
          }
          if (
            (!Array.isArray(listRes?.errors) || listRes.errors.length === 0) &&
            Array.isArray(listRes?.data?.classes?.data)
          ) {
            anyListCallOk = true;
            const list = listRes.data.classes.data;
            const found = list.find(
              (c: any) => String(c?.name || "").trim().toUpperCase() === normalizedTarget
            );
            if (found?.id) {
              matched = found;
              break;
            }
          } else {
            const errMsg =
              (Array.isArray(listRes?.errors) && listRes.errors[0]?.message) ||
              "Không đọc được danh sách lớp từ LMS GraphQL.";
            if (isTransportOrAuthErr(listRes)) {
              listErr = errMsg;
              sawListTransportOrAuthErr = true;
              break;
            }
            if (!listErr) {
              listErr = errMsg;
            }
          }
        }

        if (!matched && !sawListTransportOrAuthErr && Array.isArray(centreIds) && centreIds.length > 0 && missAttendQ) {
          for (const cand of candidates) {
            const missAttempts = [
              {
                type: [],
                search: cand,
                centres: centreIds,
                status: ["RUNNING", "FINISHED"],
                pageIndex: 0,
                itemsPerPage: 50,
                orderBy: "createdAt_desc",
              },
              {
                type: [],
                search: cand,
                centres: centreIds,
                pageIndex: 0,
                itemsPerPage: 50,
                orderBy: "createdAt_desc",
              },
            ];
            for (const vars of missAttempts) {
              let mRes = await gql(missAttendQ, vars, "classesMissAttendOrComment");
              if (
                ((Array.isArray(mRes?.errors) && mRes.errors.length > 0) ||
                  !Array.isArray(mRes?.data?.classesMissAttendOrComment?.data)) &&
                missAttendMinQ &&
                !isTransportOrAuthErr(mRes)
              ) {
                mRes = await gql(missAttendMinQ, vars, "classesMissAttendOrComment");
              }
              const mData = mRes?.data?.classesMissAttendOrComment?.data;
              if (
                (!Array.isArray(mRes?.errors) || mRes.errors.length === 0) &&
                Array.isArray(mData)
              ) {
                anyListCallOk = true;
                const found = mData.find(
                  (c: any) => String(c?.name || "").trim().toUpperCase() === normalizedTarget
                );
                if (found?.id) {
                  matched = found;
                  break;
                }
              } else {
                const errMsg =
                  (Array.isArray(mRes?.errors) && mRes.errors[0]?.message) || listErr;
                if (isTransportOrAuthErr(mRes)) {
                  listErr = errMsg;
                  sawListTransportOrAuthErr = true;
                  break;
                }
                if (!listErr) {
                  listErr = errMsg;
                }
              }
            }
            if (matched || sawListTransportOrAuthErr) break;
          }
        }

        const fallbackKnownId = String(knownLmsId || "").trim();
        if (sawListTransportOrAuthErr || (!matched && !anyListCallOk && !fallbackKnownId)) {
          return {
            lmsClassId: "",
            classByIdData: null,
            submissionGqlData: null,
            studentWorks: [],
            err: listErr || "Không đọc được danh sách lớp từ LMS GraphQL.",
          };
        }

        const lmsId = String(matched?.id || fallbackKnownId || "").trim();
        if (!lmsId) {
          return {
            lmsClassId: "",
            classByIdData: null,
            submissionGqlData: null,
            studentWorks: [],
            err: `Không tìm thấy lớp ${clsCode} trong danh sách LMS.`,
          };
        }

        const extractCls = (obj: any) =>
          obj?.data?.classesById ||
          obj?.data?.class ||
          obj?.data?.getClassById ||
          null;

        const clsQueries: Array<[string, string]> = [
          [getClassQ, "GetClassById"],
          ...(getClassMinQ ? [[getClassMinQ, "GetClassByIdMinimal"] as [string, string]] : []),
          ...(classFieldQ ? [[classFieldQ, "AdminGetClassFieldById"] as [string, string]] : []),
          ...(classFieldMinQ ? [[classFieldMinQ, "AdminGetClassFieldByIdMinimal"] as [string, string]] : []),
        ];
        let resolvedClsPayload: any = null;
        let clsLastErr = "";
        for (const [qText, opName] of clsQueries) {
          const rCls = await gql(qText, { id: lmsId }, opName);
          const candidatePayload = extractCls(rCls);
          const hasErr = Array.isArray(rCls?.errors) && rCls.errors.length > 0;
          if (!hasErr && candidatePayload) {
            resolvedClsPayload = candidatePayload;
            clsLastErr = "";
            break;
          }
          if (isTransportOrAuthErr(rCls)) {
            clsLastErr = String(
              rCls?.errors?.[0]?.message || `LMS GraphQL HTTP ${rCls?.status || "ERR"}`
            );
            break;
          }
          if (hasErr && !clsLastErr) {
            clsLastErr = String(rCls.errors[0]?.message || "GraphQL error");
          }
        }

        if (!resolvedClsPayload || clsLastErr) {
          return {
            lmsClassId: lmsId,
            classByIdData: null,
            submissionGqlData: null,
            studentWorks: [],
            err:
              clsLastErr ||
              `Không đọc được chi tiết lớp ${clsCode} từ LMS GraphQL.`,
          };
        }

        let submissionGqlData: any = null;
        let subErr = "";
        if (!isRobotics) {
          const usePayloadVars =
            String(subQ || "").includes("$payload") ||
            Boolean(subVarsTemplate && typeof subVarsTemplate === "object" && "payload" in subVarsTemplate);
          const subVariables = usePayloadVars
            ? {
                ...(subVarsTemplate || {}),
                payload: { ...(subVarsTemplate?.payload || {}), classId: lmsId },
              }
            : { classId: lmsId };
          const extractSub = (obj: any) =>
            obj?.data?.findStudentSubmissionByClass ||
            obj?.data?.studentSubmissions ||
            null;
          let subRes = await gql(subQ, subVariables, "FindStudentSubmissionByClass");
          if (
            ((Array.isArray(subRes?.errors) && subRes.errors.length > 0) ||
              !extractSub(subRes)) &&
            subLegacyQ
          ) {
            subRes = await gql(subLegacyQ, { classId: lmsId });
          }
          submissionGqlData = extractSub(subRes);
          if (
            (Array.isArray(subRes?.errors) && subRes.errors.length > 0) ||
            !submissionGqlData
          ) {
            subErr =
              (Array.isArray(subRes?.errors) && subRes.errors[0]?.message) ||
              `Không đọc được dữ liệu BTVN (submissions) của lớp ${clsCode} từ LMS GraphQL.`;
          }
        }

        let worksRes = await gql(worksQ, { classId: lmsId });
        if (
          ((Array.isArray(worksRes?.errors) && worksRes.errors.length > 0) ||
            !Array.isArray(worksRes?.data?.findAllStudentWorks?.data)) &&
          worksMinQ
        ) {
          worksRes = await gql(worksMinQ, { classId: lmsId });
        }
        const rawWorksData = worksRes?.data?.findAllStudentWorks?.data;
        let studentWorks: any[] = [];
        let worksErr = "";
        if (
          (Array.isArray(worksRes?.errors) && worksRes.errors.length > 0) ||
          !Array.isArray(rawWorksData)
        ) {
          worksErr =
            (Array.isArray(worksRes?.errors) && worksRes.errors[0]?.message) ||
            `Không đọc được danh sách sản phẩm SPCK của lớp ${clsCode} từ LMS GraphQL.`;
        } else {
          studentWorks = rawWorksData;
        }

        return {
          lmsClassId: lmsId,
          classByIdData: resolvedClsPayload,
          submissionGqlData,
          studentWorks,
          err: subErr || worksErr || "",
        };
      },
      {
        clsCode: classCode,
        knownLmsId: knownLmsClassId,
        hdrs: resolvedHeaders,
        centreIds: activeCentreIds,
        searchCandidates,
        getClassQ: captureState.capturedGetClassQuery || FALLBACK_GET_CLASS_BY_ID_QUERY,
        getClassMinQ: FALLBACK_GET_CLASS_BY_ID_MINIMAL_QUERY,
        classFieldQ: FALLBACK_CLASS_FIELD_BY_ID_QUERY,
        classFieldMinQ: FALLBACK_CLASS_FIELD_BY_ID_MINIMAL_QUERY,
        subQ: captureState.capturedSubmissionQuery || FALLBACK_SUBMISSION_QUERY,
        subLegacyQ: FALLBACK_SUBMISSION_LEGACY_QUERY,
        subVarsTemplate: captureState.capturedSubmissionVars,
        classesQ: FALLBACK_CLASSES_QUERY,
        minClassesQ: MINIMAL_CLASSES_QUERY,
        missAttendQ: CAMPUS_MISS_ATTEND_CLASSES_QUERY,
        missAttendMinQ: CAMPUS_MISS_ATTEND_MINIMAL_QUERY,
        worksQ: FIND_ALL_STUDENT_WORKS_QUERY,
        worksMinQ: FIND_ALL_STUDENT_WORKS_MINIMAL_QUERY,
        isRobotics: isRoboticsClassCode(classCode),
      }
    );
    if (res?.err) {
      throw new Error(redactSecrets(res.err));
    }
    if (res?.classByIdData) {
      assertMatchingLmsClassPayload(res.classByIdData, classCode, res.lmsClassId);
    }
    return {
      lmsClassId: res.lmsClassId,
      classByIdData: res.classByIdData,
      submissionGqlData: res.submissionGqlData,
      studentWorks: res.studentWorks,
    };
  } finally {
    page.off("request", reqListener);
  }
}

function parseAdminNodeDateMs(rawDate: unknown): number | null {
  if (typeof rawDate === "number" && Number.isFinite(rawDate) && rawDate > 0) {
    const ms = rawDate > 1e12 ? rawDate : rawDate * 1000;
    return parseSlotOrClassDateToEndOfDayMs(normalizeAdminDateToIsoYmd(ms)) ?? ms;
  }
  const text = String(rawDate ?? "").trim();
  if (!text || text === "0000-00-00") return null;
  if (/^\d{10,13}$/.test(text)) {
    const num = Number(text);
    const ms = num > 1e12 ? num : num * 1000;
    return parseSlotOrClassDateToEndOfDayMs(normalizeAdminDateToIsoYmd(ms)) ?? ms;
  }
  return (
    parseSlotOrClassDateToEndOfDayMs(text) ??
    parseSlotOrClassDateToEndOfDayMs(normalizeAdminDateToIsoYmd(text))
  );
}

async function resolveAdminNodeCentreIds(
  adminCfg: ReturnType<typeof getDynamicAdminConfig>
): Promise<string[]> {
  if (adminCfg.adminLmsCentreFilterDisabled) return [];
  if (Array.isArray(adminCfg.adminLmsCentreIds) && adminCfg.adminLmsCentreIds.length > 0) {
    return [...adminCfg.adminLmsCentreIds];
  }
  try {
    const tokenRec = await lmsHttpClient.getValidTokenRecord("ADMIN");
    if (tokenRec.userId) {
      const teacherInfo = await lmsHttpClient.getTeacherByUserId("ADMIN", tokenRec.userId);
      const mainId = String(teacherInfo?.mainCentre?.id || "").trim();
      if (mainId) return [mainId];
    }
  } catch (err) {
    if (isQueueStoppedError(err)) throw err;
  }
  return [];
}

async function findSingleClassViaAdminApi(
  targetCode: string,
  candidates: string[],
  centreIds: string[]
): Promise<{ found: any | null; anyOk: boolean; error: string }> {
  const normTarget = String(targetCode || "").trim().toUpperCase();
  const candList = Array.isArray(candidates) && candidates.length > 0 ? candidates : [normTarget];
  let anyOk = false;
  let lastErr = "";

  for (const cand of candList) {
    ensureQueueNotStopped();
    const res = await lmsHttpClient.listClasses("ADMIN", {
      filter_textSearch: cand,
      pageIndex: 0,
      itemsPerPage: 20,
    });
    if (!Array.isArray(res.errors) || res.errors.length === 0) {
      anyOk = true;
      const found = res.data.find(
        (c: any) => String(c?.name || "").trim().toUpperCase() === normTarget
      );
      if (found?.id) {
        return { found, anyOk: true, error: "" };
      }
    } else if (!lastErr) {
      lastErr = String(res.errors[0]?.message || `GraphQL error (${normTarget})`);
    }
  }

  if (Array.isArray(centreIds) && centreIds.length > 0) {
    for (const cand of candList) {
      const missAttempts = [
        {
          type: [],
          search: cand,
          centres: centreIds,
          status: ["RUNNING", "FINISHED"],
          pageIndex: 0,
          itemsPerPage: 50,
          orderBy: "createdAt_desc",
        },
        {
          type: [],
          search: cand,
          centres: centreIds,
          pageIndex: 0,
          itemsPerPage: 50,
          orderBy: "createdAt_desc",
        },
      ];
      for (const vars of missAttempts) {
        ensureQueueNotStopped();
        const mRes = await lmsHttpClient.findClassesMissAttendOrComment("ADMIN", vars);
        if (!mRes.error) {
          anyOk = true;
          const found = mRes.data.find(
            (c: any) => String(c?.name || "").trim().toUpperCase() === normTarget
          );
          if (found?.id) {
            return { found, anyOk: true, error: "" };
          }
        } else if (!lastErr) {
          lastErr = mRes.error;
        }
      }
    }
  }

  return { found: null, anyOk, error: lastErr };
}

export async function fetchSingleLmsClassViaAdminApi(
  classCode: string,
  options?: { lmsClassId?: string }
): Promise<{
  lmsClassId: string;
  classByIdData: any | null;
  submissionGqlData: any | null;
  studentWorks: any[];
}> {
  ensureQueueNotStopped();
  const normCode = String(classCode || "").trim().toUpperCase();
  const knownLmsId = String(options?.lmsClassId || "").trim();
  const adminCfg = getDynamicAdminConfig();
  const isRob = isRoboticsClassCode(normCode);

  let lmsId = knownLmsId;
  let resolvedClsPayload: any = null;

  if (lmsId) {
    const byKnown = await lmsHttpClient.getClassById("ADMIN", lmsId, {
      allowClassFieldFallback: true,
    });
    if (byKnown.clsPayload) {
      try {
        assertMatchingLmsClassPayload(byKnown.clsPayload, normCode, lmsId);
        resolvedClsPayload = byKnown.clsPayload;
      } catch {
        resolvedClsPayload = null;
        lmsId = "";
      }
    } else {
      lmsId = "";
    }
  }

  if (!resolvedClsPayload) {
    const activeCentreIds = await resolveAdminNodeCentreIds(adminCfg);
    const searchCandidates = buildLmsClassSearchCandidates(normCode);
    const foundRes = await findSingleClassViaAdminApi(normCode, searchCandidates, activeCentreIds);
    if (foundRes.found?.id) {
      lmsId = String(foundRes.found.id).trim();
    } else if (!lmsId) {
      throw new Error(
        redactSecrets(
          foundRes.error || `Không tìm thấy lớp ${normCode} trong danh sách LMS (Admin API).`
        )
      );
    }

    const byFound = await lmsHttpClient.getClassById("ADMIN", lmsId, {
      allowClassFieldFallback: true,
    });
    if (!byFound.clsPayload) {
      throw new Error(
        redactSecrets(
          byFound.error || `Không đọc được chi tiết lớp ${normCode} từ LMS GraphQL.`
        )
      );
    }
    assertMatchingLmsClassPayload(byFound.clsPayload, normCode, lmsId);
    resolvedClsPayload = byFound.clsPayload;
  }

  let submissionGqlData: any = null;
  if (!isRob) {
    const subRes = await lmsHttpClient.findStudentSubmissionByClass("ADMIN", lmsId);
    if (subRes.error || !subRes.submissionGqlData) {
      throw new Error(
        redactSecrets(
          subRes.error ||
            `Không đọc được dữ liệu BTVN (submissions) của lớp ${normCode} từ LMS GraphQL.`
        )
      );
    }
    submissionGqlData = subRes.submissionGqlData;
  }

  const worksRes = await lmsHttpClient.findAllStudentWorks("ADMIN", lmsId);
  if (worksRes.error) {
    throw new Error(
      redactSecrets(
        worksRes.error ||
          `Không đọc được danh sách sản phẩm SPCK của lớp ${normCode} từ LMS GraphQL.`
      )
    );
  }

  return {
    lmsClassId: lmsId,
    classByIdData: resolvedClsPayload,
    submissionGqlData,
    studentWorks: worksRes.works,
  };
}

async function fetchAdminLmsBundleViaNodeApi(params: {
  adminCfg: ReturnType<typeof getDynamicAdminConfig>;
  centerCode: string;
  scope: AdminScanScope;
  singleClassCode: string;
  teachingOverview: Awaited<ReturnType<typeof fetchAdminTeachingOverviewPages>>;
  progressState: AdminScanProgressState;
}): Promise<AdminLmsFetchedBundle> {
  ensureQueueNotStopped();
  const { adminCfg, centerCode, scope, singleClassCode, teachingOverview, progressState } = params;
  const activeCentreIds = await resolveAdminNodeCentreIds(adminCfg);
  const hasCentres = activeCentreIds.length > 0;
  const nowMs = Date.now();
  const recentFinishedCutoffMs = nowMs - 21 * ONE_DAY_MS;

  const teachingScheduleCodeSet = new Set<string>();
  const teachingScheduleTargets: Array<{ classCode: string; candidates: string[] }> = [];
  if (!singleClassCode) {
    for (const rawCode of teachingOverview.scheduleByClass.keys()) {
      const cleanCode = String(rawCode || "").trim().toUpperCase();
      if (!cleanCode) continue;
      if (scope === "CODING_ONLY" && isRoboticsClassCode(cleanCode)) {
        continue;
      }
      if (!teachingScheduleCodeSet.has(cleanCode)) {
        teachingScheduleCodeSet.add(cleanCode);
        teachingScheduleTargets.push({
          classCode: cleanCode,
          candidates: buildLmsClassSearchCandidates(cleanCode),
        });
      }
    }
  }

  const collected: any[] = [];
  const seenNames = new Set<string>();
  const pushUnique = (items: any[]) => {
    for (const c of items || []) {
      const n = String(c?.name || "").trim().toUpperCase();
      if (!n || seenNames.has(n)) continue;
      seenNames.add(n);
      collected.push(c);
    }
  };

  const isPageAllOlderFinished = (items: any[]): boolean => {
    if (!Array.isArray(items) || items.length === 0) return false;
    let hasValidDate = false;
    for (const item of items) {
      const ms = parseAdminNodeDateMs(item?.endDate);
      if (ms === null) return false;
      hasValidDate = true;
      if (ms >= recentFinishedCutoffMs) return false;
    }
    return hasValidDate;
  };

  let expectedTotal: number | null = null;
  let discoveryComplete = true;
  let discoveryError = "";

  if (singleClassCode) {
    const singleRes = await findSingleClassViaAdminApi(
      singleClassCode,
      buildLmsClassSearchCandidates(singleClassCode),
      activeCentreIds
    );
    if (singleRes.found) {
      pushUnique([singleRes.found]);
      expectedTotal = 1;
      discoveryComplete = true;
    } else if (!singleRes.anyOk) {
      discoveryComplete = false;
      discoveryError = singleRes.error || "Không đọc được danh sách lớp từ LMS GraphQL.";
    }
  } else {
    let tier1Complete = false;
    let tier1Err = "";

    // Tier 1: Query classes by centre_in for RUNNING and recent FINISHED
    if (hasCentres) {
      let schemaSupportsStatus = true;
      let runningComplete = true;
      let runningErr = "";
      let runningCollectedCount = 0;

      for (let pageIdx = 0; pageIdx < 25; pageIdx++) {
        if (pageIdx > 0) await paceLmsBatchRequest(150);
        ensureQueueNotStopped();
        let res = await lmsHttpClient.listClasses("ADMIN", {
          centre_in: activeCentreIds,
          ...(schemaSupportsStatus ? { status_in: ["RUNNING"] } : {}),
          pageIndex: pageIdx,
          itemsPerPage: 100,
        });
        if (
          pageIdx === 0 &&
          schemaSupportsStatus &&
          Array.isArray(res.errors) &&
          res.errors.length > 0
        ) {
          schemaSupportsStatus = false;
          res = await lmsHttpClient.listClasses("ADMIN", {
            centre_in: activeCentreIds,
            pageIndex: pageIdx,
            itemsPerPage: 100,
          });
        }
        if (Array.isArray(res.errors) && res.errors.length > 0) {
          runningComplete = false;
          runningErr = String(
            res.errors[0]?.message || `GraphQL classes error trang ${pageIdx + 1}`
          );
          break;
        }
        pushUnique(res.data);
        runningCollectedCount += res.data.length;
        if (res.data.length === 0) {
          if (res.total !== null && runningCollectedCount < res.total) {
            runningComplete = false;
            runningErr = `Danh sách lớp RUNNING thiếu: ${runningCollectedCount}/${res.total}`;
          }
          break;
        }
        if (res.total !== null) {
          if (runningCollectedCount >= res.total) break;
        } else if (res.data.length < 100) {
          break;
        }
        if (pageIdx === 24) {
          runningComplete = false;
          runningErr = `Danh sách lớp RUNNING vượt quá 25 trang (${runningCollectedCount}).`;
        }
      }

      let finishedComplete = true;
      let finishedErr = "";
      if (runningComplete && schemaSupportsStatus) {
        let finishedCollectedCount = 0;
        for (let pageIdx = 0; pageIdx < 3; pageIdx++) {
          await paceLmsBatchRequest(150);
          ensureQueueNotStopped();
          const resFin = await lmsHttpClient.listClasses("ADMIN", {
            centre_in: activeCentreIds,
            status_in: ["FINISHED"],
            pageIndex: pageIdx,
            itemsPerPage: 100,
          });
          if (Array.isArray(resFin.errors) && resFin.errors.length > 0) {
            finishedComplete = false;
            finishedErr = String(
              resFin.errors[0]?.message || `GraphQL FINISHED error trang ${pageIdx + 1}`
            );
            break;
          }
          pushUnique(resFin.data);
          finishedCollectedCount += resFin.data.length;
          if (resFin.data.length === 0) break;
          if (isPageAllOlderFinished(resFin.data)) break;
          if (resFin.total !== null) {
            if (finishedCollectedCount >= resFin.total) break;
          } else if (resFin.data.length < 100) {
            break;
          }
        }
      }

      tier1Complete = runningComplete && finishedComplete;
      tier1Err = runningErr || finishedErr;
      if (!tier1Complete) {
        discoveryComplete = false;
        discoveryError = tier1Err;
      }
    }

    // Tier 2: classesMissAttendOrComment fallback when Tier 1 failed or returned 0
    let tier2Complete = false;
    let tier2Err = "";
    let tier2RawCount = 0;
    if (hasCentres && (!tier1Complete || collected.length === 0)) {
      let runOk = true;
      let runErr = "";
      for (let pageIdx = 0; pageIdx < 15; pageIdx++) {
        if (pageIdx > 0) await paceLmsBatchRequest(150);
        ensureQueueNotStopped();
        const r = await lmsHttpClient.findClassesMissAttendOrComment("ADMIN", {
          type: [],
          centres: activeCentreIds,
          status: ["RUNNING"],
          pageIndex: pageIdx,
          itemsPerPage: 100,
          orderBy: "createdAt_desc",
        });
        if (r.error) {
          runOk = false;
          runErr = r.error;
          break;
        }
        tier2RawCount += r.data.length;
        pushUnique(r.data);
        if (r.data.length < 100) break;
        if (pageIdx === 14) {
          runOk = false;
          runErr = "Danh sách lớp classesMissAttendOrComment vượt quá 15 trang.";
        }
      }

      let finOk = true;
      let finErr = "";
      if (runOk) {
        for (let pageIdx = 0; pageIdx < 3; pageIdx++) {
          await paceLmsBatchRequest(150);
          ensureQueueNotStopped();
          const rFin = await lmsHttpClient.findClassesMissAttendOrComment("ADMIN", {
            type: [],
            centres: activeCentreIds,
            status: ["FINISHED"],
            pageIndex: pageIdx,
            itemsPerPage: 100,
            orderBy: "createdAt_desc",
          });
          if (rFin.error) {
            finOk = false;
            finErr = rFin.error;
            break;
          }
          tier2RawCount += rFin.data.length;
          pushUnique(rFin.data);
          if (rFin.data.length === 0 || isPageAllOlderFinished(rFin.data) || rFin.data.length < 100) {
            break;
          }
        }
      }

      tier2Complete = runOk && finOk;
      tier2Err = runErr || finErr;
      if (tier2Complete && (tier2RawCount > 0 || !tier1Err)) {
        discoveryComplete = true;
        discoveryError = "";
      } else if (!tier1Complete && !tier2Complete) {
        discoveryError = tier1Err || tier2Err;
      }
    }

    // Tier 3: search filter fallback by centerCode
    if (!hasCentres || (collected.length === 0 && !tier1Complete && !tier2Complete)) {
      let legacyComplete = true;
      let legacyErr = "";
      let legacyExpected: number | null = null;
      let legacyCount = 0;
      let tier3RawCount = 0;

      for (let pageIdx = 0; pageIdx < 25; pageIdx++) {
        if (pageIdx > 0) await paceLmsBatchRequest(150);
        ensureQueueNotStopped();
        const r = await lmsHttpClient.listClasses("ADMIN", {
          filter_textSearch: centerCode,
          pageIndex: pageIdx,
          itemsPerPage: 100,
        });
        if (Array.isArray(r.errors) && r.errors.length > 0) {
          legacyComplete = false;
          legacyErr = String(r.errors[0]?.message || `GraphQL error ở trang ${pageIdx + 1}`);
          break;
        }
        if (r.total !== null) legacyExpected = r.total;
        tier3RawCount += r.data.length;
        pushUnique(r.data);
        legacyCount += r.data.length;
        if (r.data.length === 0) {
          if (legacyExpected !== null && legacyCount < legacyExpected) {
            legacyComplete = false;
            legacyErr = `Danh sách lớp thiếu: ${legacyCount}/${legacyExpected}`;
          }
          break;
        }
        if (legacyExpected !== null && legacyCount >= legacyExpected) break;
        if (legacyExpected === null && r.data.length < 100) break;
        if (pageIdx === 24 && (legacyExpected === null || legacyCount < legacyExpected)) {
          legacyComplete = false;
          legacyErr = `Danh sách lớp vượt quá 25 trang (${legacyCount}/${legacyExpected ?? "?"}).`;
        }
      }

      if (!hasCentres) {
        discoveryComplete = legacyComplete;
        expectedTotal = legacyExpected;
        discoveryError = legacyErr;
      } else if (legacyComplete && (tier3RawCount > 0 || (!tier1Err && !tier2Err))) {
        discoveryComplete = true;
        discoveryError = "";
      }
    }

    // Tier 4: Cross-check classes on Teaching weekly schedule
    for (const t of teachingScheduleTargets) {
      const codeUpper = String(t?.classCode || "").trim().toUpperCase();
      if (!codeUpper || seenNames.has(codeUpper)) continue;
      const resT = await findSingleClassViaAdminApi(codeUpper, t.candidates, activeCentreIds);
      if (resT.found) {
        pushUnique([resT.found]);
      }
    }
  }

  const filteredDiscovery = collected
    .map((c: any) => {
      const classCode = String(c?.name || "").trim().toUpperCase();
      let mainT = "";
      let taT = "";
      for (const t of c?.teachers || []) {
        const tn = String(t?.teacher?.fullName || t?.teacher?.username || "").trim();
        const rn = String(t?.role?.name || "").toLowerCase();
        if (!tn) continue;
        if (rn.includes("ta") || rn.includes("assistant")) {
          if (!taT) taT = tn;
        } else if (!mainT) {
          mainT = tn;
        }
      }
      return {
        lmsClassId: String(c?.id || "").trim(),
        classCode,
        courseName: String(c?.course?.name || "").trim(),
        status: String(c?.status || "").trim(),
        startDate:
          c?.startDate !== undefined && c?.startDate !== null ? String(c.startDate).trim() : "",
        endDate:
          c?.endDate !== undefined && c?.endDate !== null ? String(c.endDate).trim() : "",
        mainTeacher: mainT,
        assistantTeacher: taT,
      };
    })
    .filter((c) => {
      if (!c.classCode || !c.lmsClassId) return false;
      if (singleClassCode) return c.classCode === singleClassCode;
      const statusUp = String(c.status || "").trim().toUpperCase();
      if (/CANCEL|CLOSE|DROP|PENDING|UPCOMING|OPENING|WAITING|PREPARING/.test(statusUp)) return false;
      const isRunning = isConfirmedRunningStatus(c.status);
      const isRecentFinished =
        statusUp.includes("FINISH") &&
        isAdminFinishedClassWithinGraceWindow(c.endDate, 14, nowMs);
      const onTeachingSchedule = teachingScheduleCodeSet.has(c.classCode);
      const needsDetailCheck = statusUp === "";
      if (!isRunning && !isRecentFinished && !onTeachingSchedule && !needsDetailCheck) {
        return false;
      }
      if (scope === "CODING_ONLY" && isRoboticsClassCode(c.classCode)) {
        return false;
      }
      return true;
    });

  const uniqueMap = new Map<string, (typeof filteredDiscovery)[number]>();
  for (const c of filteredDiscovery) {
    if (!uniqueMap.has(c.classCode)) uniqueMap.set(c.classCode, c);
  }
  const targetList = Array.from(uniqueMap.values());
  progressState.totalClasses = targetList.length;

  const perClass = new Map<
    string,
    {
      classByIdData: any | null;
      submissionGqlData: any | null;
      studentWorks: any[];
      studentLetters?: any[];
      error?: string;
      subError?: string;
      worksError?: string;
    }
  >();
  const skippedHistoricalClasses = new Set<string>();
  const recentGraceCutoffMs = nowMs - 14 * ONE_DAY_MS;
  let stoppedEarly = false;

  for (let idx = 0; idx < targetList.length; idx++) {
    const item = targetList[idx];
    ensureQueueNotStopped();
    if (progressState.stopAfterCurrentRequested) {
      stoppedEarly = true;
      break;
    }
    if (idx > 0) {
      await paceLmsBatchRequest(300);
    }
    progressState.currentClassCode = item.classCode;
    const isRob = isRoboticsClassCode(item.classCode);
    const onTeachingSchedule = teachingScheduleCodeSet.has(item.classCode);
    const checkActiveAfterDetail = !singleClassCode && !onTeachingSchedule;

    try {
      const clsRes = await lmsHttpClient.getClassById("ADMIN", item.lmsClassId, {
        allowClassFieldFallback: true,
      });
      if (!clsRes.clsPayload) {
        throw new Error(clsRes.error || `Không đọc được chi tiết lớp ${item.classCode}.`);
      }
      const clsPayload = clsRes.clsPayload;
      assertMatchingLmsClassPayload(clsPayload, item.classCode, item.lmsClassId);

      if (!singleClassCode) {
        const stUpCheck = String(clsPayload?.status || "").trim().toUpperCase();
        if (/PENDING|UPCOMING|OPENING|WAITING|PREPARING/.test(stUpCheck)) {
          skippedHistoricalClasses.add(item.classCode);
          continue;
        }
      }
      if (checkActiveAfterDetail) {
        const stUp = String(clsPayload?.status || "").trim().toUpperCase();
        const isCancelled = /CANCEL|CLOSE|DROP|PENDING|UPCOMING|OPENING|WAITING|PREPARING/.test(stUp);
        const isRunningSt = stUp === "RUNNING" || stUp === "ACTIVE";
        if (isCancelled) {
          skippedHistoricalClasses.add(item.classCode);
          continue;
        }
        if (!isRunningSt) {
          const endMs = parseAdminNodeDateMs(clsPayload?.endDate);
          if (
            (stUp.includes("FINISH") && endMs !== null && endMs < recentGraceCutoffMs) ||
            (!stUp.includes("FINISH") && stUp !== "")
          ) {
            skippedHistoricalClasses.add(item.classCode);
            continue;
          }
        }
        const detailRunning = isConfirmedRunningStatus(String(clsPayload?.status || "").trim());
        const detailRecentFin =
          stUp.includes("FINISH") &&
          isAdminFinishedClassWithinGraceWindow(clsPayload?.endDate, 14, nowMs);
        if (!detailRunning && !detailRecentFin && stUp !== "") {
          skippedHistoricalClasses.add(item.classCode);
          continue;
        }
      }

      if (clsPayload?.status) item.status = String(clsPayload.status).trim();
      if (clsPayload?.startDate) item.startDate = String(clsPayload.startDate).trim();
      if (clsPayload?.endDate) item.endDate = String(clsPayload.endDate).trim();
      if (clsPayload?.course?.name) item.courseName = String(clsPayload.course.name).trim();
      for (const t of clsPayload?.teachers || []) {
        const tn = String(t?.teacher?.fullName || t?.teacher?.username || "").trim();
        const rn = String(t?.role?.name || "").toLowerCase();
        if (!tn) continue;
        if (rn.includes("ta") || rn.includes("assistant")) {
          if (!item.assistantTeacher) item.assistantTeacher = tn;
        } else if (!item.mainTeacher) {
          item.mainTeacher = tn;
        }
      }

      let submissionGqlData: any = null;
      let subError = "";
      if (!isRob) {
        const subRes = await lmsHttpClient.findStudentSubmissionByClass("ADMIN", item.lmsClassId);
        if (subRes.error || !subRes.submissionGqlData) {
          subError =
            subRes.error || "Không đọc được dữ liệu BTVN (submissions) từ LMS GraphQL.";
        } else {
          submissionGqlData = subRes.submissionGqlData;
        }
      }

      const slotsArr: any[] = Array.isArray(clsPayload?.slots) ? clsPayload.slots : [];
      const stUp = String(clsPayload?.status || "").toUpperCase();
      const needsWorks = stUp.includes("FINISH") || slotsArr.length >= 12;

      let studentWorks: any[] = [];
      let studentLetters: any[] = [];
      let worksError = "";
      if (needsWorks) {
        const worksRes = await lmsHttpClient.findAllStudentWorks("ADMIN", item.lmsClassId);
        if (worksRes.error) {
          worksError =
            worksRes.error || "Không đọc được danh sách sản phẩm SPCK (findAllStudentWorks) từ LMS GraphQL.";
        } else {
          studentWorks = worksRes.works;
        }
        const lettersRes = await lmsHttpClient.findStudentLettersByClass("ADMIN", item.lmsClassId);
        studentLetters = lettersRes.letters || [];
      }

      perClass.set(item.classCode, {
        classByIdData: clsPayload,
        submissionGqlData,
        studentWorks,
        studentLetters,
        ...(subError ? { subError: sanitizeErrorMessage(subError) } : {}),
        ...(worksError ? { worksError: sanitizeErrorMessage(worksError) } : {}),
      });
    } catch (clsErr: any) {
      if (isQueueStoppedError(clsErr)) {
        throw clsErr;
      }
      perClass.set(item.classCode, {
        classByIdData: null,
        submissionGqlData: null,
        studentWorks: [],
        error: sanitizeErrorMessage(clsErr),
      });
    }
  }

  return {
    discoveredClasses: targetList.filter((c) => !skippedHistoricalClasses.has(c.classCode)),
    perClass,
    stoppedEarly,
    discoveryComplete,
    discoveryError: discoveryError || undefined,
    expectedTotal,
  };
}

export async function scanAdminCenterClasses(options?: {
  scope?: AdminScanScope;
  classCode?: string;
  centerCode?: string;
  includeMakeup?: boolean;
  lmsBundleOverride?: AdminLmsFetchedBundle;
  teachingDeps?: AdminTeachingHttpFetcherDeps;
}): Promise<{
  success: boolean;
  runId: string;
  status: "COMPLETED" | "PARTIAL" | "STOPPED" | "FAILED";
  scannedCount: number;
  failedClasses: Array<{ classCode: string; error: string }>;
  warnings?: string[];
  overview: AdminCenterOverviewResponse;
  error?: string;
}> {
  const adminCfg = getDynamicAdminConfig();
  const centerCode = (options?.centerCode || adminCfg.adminCenterCode || "205ALHP")
    .trim()
    .toUpperCase();
  const scope: AdminScanScope = options?.scope || "ALL";
  const singleClassCode = options?.classCode
    ? String(options.classCode).trim().toUpperCase()
    : "";
  const includeMakeup = options?.includeMakeup !== false;

  if (scope === "SINGLE_CLASS" && !isValidLmsClassCode(singleClassCode)) {
    throw new Error(redactSecrets(`Mã lớp không hợp lệ: "${options?.classCode || ""}".`));
  }

  const progressState = initProgressState();
  if (progressState.isRunning) {
    throw new Error(
      "Đang có tiến trình quét Cơ sở Admin khác đang chạy. Vui lòng chờ hoàn tất hoặc bấm Dừng."
    );
  }

  const runId = `admin_scan_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const nowIso = new Date().toISOString();
  let scanRunCreated = false;

  try {
    Object.assign(progressState, {
      isRunning: true,
      runId,
      scanScope: scope,
      totalClasses: 0,
      scannedClasses: 0,
      currentClassCode: null,
      stopAfterCurrentRequested: false,
      lastError: null,
      startedAt: nowIso,
      finishedAt: null,
    });

    adminCenterRepo.createScanRun({
      runId,
      centerCode,
      scanScope: scope,
      status: "RUNNING",
      totalClasses: 0,
      scannedClasses: 0,
      failedClassesJson: "[]",
      summaryJson: "{}",
    });
    scanRunCreated = true;

    return await taskQueue.enqueue({
      id: runId,
      jobType: "CUSTOM",
      classId: singleClassCode || centerCode,
      description: `Quét Quản lý Cơ sở ${centerCode} (${scope})`,
      execute: async () => {
        const failedClasses: Array<{ classCode: string; error: string }> = [];
        const runWarnings: string[] = [];
        let scannedCount = 0;
        let scannedOkCount = 0;
        let hasPartialClassData = false;
        let finalRunStatus: "COMPLETED" | "PARTIAL" | "STOPPED" | "FAILED" = "COMPLETED";

        try {
          ensureQueueNotStopped();

          // 1. Fetch Teaching weekly overview (index.php, check_nhanxet.php, hocbu.php)
          const teachingOverview = await fetchAdminTeachingOverviewPages(
            options?.teachingDeps
          );
          for (const w of teachingOverview.fetchWarnings || []) {
            runWarnings.push(redactSecrets(w));
          }

          // Quick TEACHING_ONLY mode: refresh Teaching schedule / check_nhanxet / hocbu / projects without browser
          if (scope === "TEACHING_ONLY") {
            const existingRows = adminCenterRepo.listClasses({
              centerCode,
              includeMakeup: true,
            });
            progressState.totalClasses = existingRows.length;

            const detailTargets = existingRows.map((r) => ({
              classCode: r.classCode,
              blockType: r.blockType,
              needScores: r.blockType === "CODING",
              needSpckProject: r.currentSessionNumber >= 10,
            }));
            const { detailsByClass, warnings: detailWarnings } =
              await fetchTeachingClassDetailsBatch(detailTargets, options?.teachingDeps);
            for (const w of detailWarnings || []) {
              runWarnings.push(redactSecrets(w));
            }
            const hasCheckNhanXetError = teachingOverview.fetchWarnings.some((w) =>
              w.includes("/check_nhanxet.php")
            );

            for (const existing of existingRows) {
              ensureQueueNotStopped();
              if (progressState.stopAfterCurrentRequested) {
                finalRunStatus = "STOPPED";
                break;
              }
              progressState.currentClassCode = existing.classCode;

              const schedule = teachingOverview.scheduleByClass.get(existing.classCode);
              const checkRows = teachingOverview.checkRowsByClass.get(existing.classCode) || [];
              const detail = detailsByClass.get(existing.classCode) || null;
              const makeupRows = teachingOverview.makeupByClass.get(existing.classCode) || [];

              const weeklyOps = safeJsonParse<AdminWeeklyOpsSummary>(
                existing.weeklyOpsJson,
                {} as AdminWeeklyOpsSummary
              );
              const matchedCheck = findMatchingCheckNhanXetRow(
                checkRows,
                existing.classCode,
                weeklyOps.evaluatedSessionNumber || 0,
                weeklyOps.evaluatedSessionDate
              );
              if (matchedCheck) {
                weeklyOps.zaloStatus = matchedCheck.zaloStatus;
                weeklyOps.zaloDeadline = matchedCheck.zaloDeadline;
                weeklyOps.isZaloLateOrMissing = isTeachingCheckLateOrMissing(
                  matchedCheck.zaloStatus
                );
                weeklyOps.lmsCheckStatus = matchedCheck.lmsStatus;
                weeklyOps.lmsDeadline = matchedCheck.lmsDeadline;
                weeklyOps.isLmsLateOrMissing = isTeachingCheckLateOrMissing(
                  matchedCheck.lmsStatus
                );
                weeklyOps.checkIssueNote = matchedCheck.issueDescription;
              } else if (!hasCheckNhanXetError && (weeklyOps.evaluatedSessionNumber || 0) > 0) {
                weeklyOps.zaloStatus = "Chưa xác minh";
                weeklyOps.zaloDeadline = "";
                weeklyOps.isZaloLateOrMissing = false;
                weeklyOps.lmsCheckStatus = "Chưa xác minh";
                weeklyOps.lmsDeadline = "";
                weeklyOps.isLmsLateOrMissing = false;
                weeklyOps.checkIssueNote = "";
              }

              const existingSnap = safeJsonParse<any>(existing.lmsReportCardSnapshotJson, null);
              const updatedRecord = computeAdminClassAudits({
                centerCode,
                rawClassMeta: {
                  classCode: existing.classCode,
                  lmsClassId: existing.lmsClassId,
                  courseName: existing.courseName,
                  status: existing.status,
                  startDate: existing.startDate,
                  endDate: existing.endDate,
                  mainTeacher: existing.mainTeacher,
                  assistantTeacher: existing.assistantTeacher,
                },
                classByIdData: existingSnap
                  ? {
                      id: existing.lmsClassId,
                      name: existing.classCode,
                      status: existing.status,
                      startDate: existing.startDate,
                      endDate: existing.endDate,
                      students: (existingSnap.students || []).map((s: any) => ({
                        activeInClass: s.isActive !== false,
                        student: { id: s.studentId, fullName: s.fullName },
                      })),
                      slots: [],
                    }
                  : null,
                submissionGqlData: null,
                studentWorks: [],
                teachingScheduleEntry: schedule || null,
                teachingCheckRows: checkRows,
                teachingDetail: detail,
                teachingMakeupRows: makeupRows,
              });

              const failedEps = new Set(detail?.failedEndpoints || []);
              const preservedTeachingStudentCount = failedEps.has("students")
                ? existing.teachingStudentCount
                : updatedRecord.teachingStudentCount;
              const preserveSpck = failedEps.has("project") || failedEps.has("tasks");
              const classErrText =
                detail?.hasFetchError && (detail.fetchErrors || []).length > 0
                  ? redactSecrets(detail.fetchErrors!.join(" | "))
                  : null;
              if (classErrText) {
                failedClasses.push({ classCode: existing.classCode, error: classErrText });
              } else {
                scannedOkCount++;
              }

              // Preserve existing LMS-derived weeklyOps / btvn / spckAudit / snapshot while updating Teaching fields
              adminCenterRepo.upsertClass({
                ...existing,
                timeSlot: schedule?.timeSlot || existing.timeSlot,
                specialEvent: schedule?.specialEvent || existing.specialEvent,
                teachingStudentCount: preservedTeachingStudentCount,
                weeklyOpsJson: JSON.stringify(weeklyOps),
                spckTasksJson: preserveSpck ? existing.spckTasksJson : updatedRecord.spckTasksJson,
                spckTasksSyncStatus: preserveSpck
                  ? existing.spckTasksSyncStatus
                  : updatedRecord.spckTasksSyncStatus,
                lastError: classErrText,
              });
              scannedCount++;
              progressState.scannedClasses = scannedCount;
            }

            if (finalRunStatus !== "STOPPED" && (failedClasses.length > 0 || runWarnings.length > 0)) {
              finalRunStatus = scannedOkCount > 0 || existingRows.length === 0 && failedClasses.length === 0 ? "PARTIAL" : "FAILED";
              if (existingRows.length === 0 && failedClasses.length === 0 && runWarnings.length > 0) {
                finalRunStatus = "FAILED";
              }
            }

            adminCenterRepo.updateScanRun(runId, {
              status: finalRunStatus,
              totalClasses: progressState.totalClasses,
              scannedClasses: scannedCount,
              failedClassesJson: JSON.stringify(failedClasses),
              finishedAt: new Date().toISOString(),
            });

            const overview = buildAdminOverviewResponse({
              includeMakeup,
              centerCode,
              makeupRecords: teachingOverview.makeupRows,
            });
            return {
              success: finalRunStatus === "COMPLETED",
              runId,
              status: finalRunStatus,
              scannedCount,
              failedClasses,
              ...(runWarnings.length > 0 ? { warnings: runWarnings } : {}),
              ...(finalRunStatus !== "COMPLETED" && (runWarnings.length > 0 || failedClasses.length > 0)
                ? {
                    error: redactSecrets(
                      runWarnings[0] || failedClasses[0]?.error || "Quét Teaching chưa hoàn tất."
                    ),
                  }
                : {}),
              overview,
            };
          }

        // 2. LMS GraphQL scan via pure-Node ADMIN API first, with Single Persistent Context + Admin Role Swap fallback
        let lmsBundle: AdminLmsFetchedBundle;
        if (options?.lmsBundleOverride) {
          lmsBundle = options.lmsBundleOverride;
        } else {
          const runPlaywrightAdminBundle = (): Promise<AdminLmsFetchedBundle> =>
            authService.withAdminLmsSession(async (page) => {
            const interceptor = createNetworkInterceptor(page);
            const captureState = {
              capturedHeaders: {} as Record<string, string>,
              capturedGetClassQuery: "",
              capturedSubmissionQuery: "",
              capturedSubmissionVars: null as any,
              capturedCentres: [] as string[],
            };
            const reqListener = buildLmsGqlCaptureListener(captureState);

            page.on("request", reqListener);
            try {
              const initialCentreIds = adminCfg.adminLmsCentreIds;
              const classesUrl =
                initialCentreIds.length > 0
                  ? `${config.lmsUrl.replace(/\/$/, "")}/admin/classes?centres=${encodeURIComponent(JSON.stringify(initialCentreIds))}`
                  : `${config.lmsUrl.replace(/\/$/, "")}/admin/classes`;
              await page.goto(classesUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
              await page.waitForTimeout(1800);
              await interceptor.dismissForbiddenToast();

              if (
                !captureState.capturedHeaders.authorization &&
                !captureState.capturedHeaders.Authorization &&
                !captureState.capturedHeaders.token &&
                !captureState.capturedHeaders.Token
              ) {
                await page.reload({ waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
                await page.waitForTimeout(2000);
              }

              await page
                .evaluate("window.__name = window.__name || function(f){ return f; }")
                .catch(() => {});

              const activeCentreIds = adminCfg.adminLmsCentreFilterDisabled
                ? []
                : captureState.capturedCentres.length > 0 && initialCentreIds.length === 0
                  ? [...captureState.capturedCentres]
                  : initialCentreIds;
              const discoveryHeaders = await resolveAdminPageAuthHeaders(
                page,
                captureState.capturedHeaders
              );

              const teachingScheduleCodeSet = new Set<string>();
              const teachingScheduleTargets: Array<{ classCode: string; candidates: string[] }> = [];
              if (!singleClassCode) {
                for (const rawCode of teachingOverview.scheduleByClass.keys()) {
                  const cleanCode = String(rawCode || "").trim().toUpperCase();
                  if (!cleanCode) continue;
                  if (scope === "CODING_ONLY" && isRoboticsClassCode(cleanCode)) {
                    continue;
                  }
                  if (!teachingScheduleCodeSet.has(cleanCode)) {
                    teachingScheduleCodeSet.add(cleanCode);
                    teachingScheduleTargets.push({
                      classCode: cleanCode,
                      candidates: buildLmsClassSearchCandidates(cleanCode),
                    });
                  }
                }
              }

              // Step 2a: Discover campus classes via GraphQL pagination (strict completeness check)
              const discoveryResult = await page.evaluate(
                async ({
                  hdrs,
                  cCode,
                  centreIds,
                  isSingleClass,
                  singleCandidates,
                  teachingTargets,
                  recentFinishedCutoffMs,
                  clsQuery,
                  minClsQuery,
                  campusClassesQ,
                  campusClassesNoStatusQ,
                  missAttendQ,
                  missAttendMinQ,
                }: any) => {
                  const headers: Record<string, string> = {
                    "content-type": "application/json",
                  };
                  for (const [k, v] of Object.entries(hdrs || {})) {
                    const kl = k.toLowerCase();
                    if (
                      kl === "authorization" ||
                      kl === "token" ||
                      kl.startsWith("x-") ||
                      kl.startsWith("apollo-")
                    ) {
                      headers[k] = String(v);
                    }
                  }
                  const gql = async (query: string, variables?: any, operationName?: string) => {
                    const r = await fetch("https://lms-api.mindx.edu.vn/", {
                      method: "POST",
                      headers,
                      body: JSON.stringify({
                        query,
                        variables,
                        ...(operationName ? { operationName } : {}),
                      }),
                    });
                    const parsed =
                      typeof r?.json === "function" ? await r.json().catch(() => null) : null;
                    if (!r || !r.ok) {
                      const gqlMsg =
                        Array.isArray(parsed?.errors) && parsed.errors.length > 0
                          ? String(parsed.errors[0]?.message || "")
                          : "";
                      return {
                        __httpError: true,
                        status: Number(r?.status || 0),
                        errors: [{ message: gqlMsg || `LMS GraphQL HTTP ${r?.status ?? "ERR"}` }],
                        data: null,
                      };
                    }
                    if (!parsed || typeof parsed !== "object") {
                      return {
                        __httpError: true,
                        status: Number(r.status || 0),
                        errors: [{ message: `LMS GraphQL phản hồi không hợp lệ (HTTP ${r.status})` }],
                        data: null,
                      };
                    }
                    return parsed;
                  };
                  const isTransportOrAuthErr = (resObj: any) =>
                    Boolean(resObj?.__httpError) &&
                    (Number(resObj?.status) === 401 ||
                      Number(resObj?.status) === 403 ||
                      Number(resObj?.status) >= 500);

                  const collected: any[] = [];
                  const seenIds = new Set<string>();
                  const seenNames = new Set<string>();
                  const pushUnique = (items: any[]) => {
                    for (const item of items || []) {
                      if (!item || typeof item !== "object") continue;
                      const id = String(item.id || "").trim();
                      const nm = String(item.name || "").trim().toUpperCase();
                      if (!id && !nm) continue;
                      if ((id && seenIds.has(id)) || (nm && seenNames.has(nm))) continue;
                      if (id) seenIds.add(id);
                      if (nm) seenNames.add(nm);
                      collected.push(item);
                    }
                  };

                  const parseEndDateMs = (raw: any): number | null => {
                    if (typeof raw === "number" && Number.isFinite(raw)) {
                      return raw > 1e12 ? raw : raw * 1000;
                    }
                    const s = String(raw || "").trim();
                    if (!s || s === "0000-00-00") return null;
                    const iso = Date.parse(s);
                    if (Number.isFinite(iso)) return iso;
                    const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
                    if (dmy) {
                      const d = Number(dmy[1]);
                      const m = Number(dmy[2]);
                      let y = Number(dmy[3]);
                      if (y < 100) y += 2000;
                      const dt = Date.UTC(y, m - 1, d);
                      return Number.isFinite(dt) ? dt : null;
                    }
                    return null;
                  };

                  const isPageAllOlderFinished = (items: any[]): boolean => {
                    if (!Array.isArray(items) || items.length === 0) return false;
                    let hasValidDate = false;
                    for (const item of items) {
                      const ms = parseEndDateMs(item?.endDate);
                      if (ms === null) return false;
                      hasValidDate = true;
                      if (ms >= recentFinishedCutoffMs) return false;
                    }
                    return hasValidDate;
                  };

                  let expectedTotal: number | null = null;
                  let complete = true;
                  let errorMsg = "";

                  const searchSingleExact = async (targetCode: string, candidates: string[]) => {
                    const normTarget = String(targetCode || "").trim().toUpperCase();
                    let anyOk = false;
                    let lastErr = "";
                    let sawTransportErr = false;

                    for (const cand of candidates) {
                      let r = await gql(clsQuery, { text: cand, pageIndex: 0, itemsPerPage: 20 });
                      if (
                        ((Array.isArray(r?.errors) && r.errors.length > 0) ||
                          !Array.isArray(r?.data?.classes?.data)) &&
                        minClsQuery &&
                        !isTransportOrAuthErr(r)
                      ) {
                        r = await gql(minClsQuery, { text: cand });
                      }
                      if (
                        (!Array.isArray(r?.errors) || r.errors.length === 0) &&
                        Array.isArray(r?.data?.classes?.data)
                      ) {
                        anyOk = true;
                        const found = r.data.classes.data.find(
                          (c: any) => String(c?.name || "").trim().toUpperCase() === normTarget
                        );
                        if (found) return { found, anyOk: true, error: "" };
                      } else {
                        const errMsg =
                          (Array.isArray(r?.errors) && r.errors[0]?.message) ||
                          `LMS GraphQL error (${normTarget})`;
                        if (isTransportOrAuthErr(r)) {
                          lastErr = errMsg;
                          sawTransportErr = true;
                          break;
                        }
                        if (!lastErr) {
                          lastErr = errMsg;
                        }
                      }
                    }

                    if (!sawTransportErr && Array.isArray(centreIds) && centreIds.length > 0 && missAttendQ) {
                      for (const cand of candidates) {
                        const vars = {
                          type: [],
                          search: cand,
                          centres: centreIds,
                          status: ["RUNNING", "FINISHED"],
                          pageIndex: 0,
                          itemsPerPage: 50,
                          orderBy: "createdAt_desc",
                        };
                        let mRes = await gql(missAttendQ, vars, "classesMissAttendOrComment");
                        if (
                          ((Array.isArray(mRes?.errors) && mRes.errors.length > 0) ||
                            !Array.isArray(mRes?.data?.classesMissAttendOrComment?.data)) &&
                          missAttendMinQ &&
                          !isTransportOrAuthErr(mRes)
                        ) {
                          mRes = await gql(missAttendMinQ, vars, "classesMissAttendOrComment");
                        }
                        const mData = mRes?.data?.classesMissAttendOrComment?.data;
                        if (
                          (!Array.isArray(mRes?.errors) || mRes.errors.length === 0) &&
                          Array.isArray(mData)
                        ) {
                          anyOk = true;
                          const found = mData.find(
                            (c: any) => String(c?.name || "").trim().toUpperCase() === normTarget
                          );
                          if (found) return { found, anyOk: true, error: "" };
                        } else {
                          const errMsg =
                            (Array.isArray(mRes?.errors) && mRes.errors[0]?.message) || lastErr;
                          if (isTransportOrAuthErr(mRes)) {
                            lastErr = errMsg;
                            break;
                          }
                          if (!lastErr) {
                            lastErr = errMsg;
                          }
                        }
                      }
                    }

                    return { found: null, anyOk, error: lastErr };
                  };

                  if (isSingleClass) {
                    const candList =
                      Array.isArray(singleCandidates) && singleCandidates.length > 0
                        ? singleCandidates
                        : [String(cCode || "").trim().toUpperCase()];
                    const singleRes = await searchSingleExact(cCode, candList);
                    if (singleRes.found) {
                      pushUnique([singleRes.found]);
                      expectedTotal = 1;
                      complete = true;
                    } else if (!singleRes.anyOk) {
                      complete = false;
                      errorMsg = singleRes.error || "Không đọc được danh sách lớp từ LMS GraphQL.";
                    }
                    return {
                      collected,
                      complete,
                      expectedTotal,
                      error: errorMsg,
                    };
                  }

                  const hasCentres = Array.isArray(centreIds) && centreIds.length > 0;
                  let tier1Complete = false;
                  let tier1Err = "";
                  let tier1ExpectedRunningTotal: number | null = null;

                  // Tier 1: Query classes by centre_in for RUNNING and recent FINISHED
                  if (hasCentres && campusClassesQ) {
                    let schemaSupportsStatus = true;
                    let runningComplete = true;
                    let runningErr = "";
                    let runningCollectedCount = 0;

                    for (let pageIdx = 0; pageIdx < 25; pageIdx++) {
                      const activeQ = schemaSupportsStatus
                        ? campusClassesQ
                        : campusClassesNoStatusQ;
                      const vars = schemaSupportsStatus
                        ? {
                            centres: centreIds,
                            status: ["RUNNING"],
                            pageIndex: pageIdx,
                            itemsPerPage: 100,
                          }
                        : {
                            centres: centreIds,
                            pageIndex: pageIdx,
                            itemsPerPage: 100,
                          };
                      let r = await gql(activeQ, vars);
                      if (
                        pageIdx === 0 &&
                        schemaSupportsStatus &&
                        campusClassesNoStatusQ &&
                        Array.isArray(r?.errors) &&
                        r.errors.length > 0 &&
                        !isTransportOrAuthErr(r)
                      ) {
                        schemaSupportsStatus = false;
                        r = await gql(campusClassesNoStatusQ, {
                          centres: centreIds,
                          pageIndex: pageIdx,
                          itemsPerPage: 100,
                        });
                      }
                      if (Array.isArray(r?.errors) && r.errors.length > 0) {
                        runningComplete = false;
                        runningErr = String(
                          r.errors[0]?.message || `GraphQL classes error trang ${pageIdx + 1}`
                        );
                        break;
                      }
                      const conn = r?.data?.classes;
                      const data = conn?.data;
                      if (!Array.isArray(data)) {
                        runningComplete = false;
                        runningErr = `Dữ liệu classes.data trang ${pageIdx + 1} không hợp lệ.`;
                        break;
                      }
                      const rawPageTotal = conn?.pagination?.total;
                      const pageTotal =
                        typeof rawPageTotal === "number"
                          ? rawPageTotal
                          : typeof rawPageTotal === "string" && rawPageTotal.trim() !== ""
                            ? Number(rawPageTotal)
                            : NaN;
                      if (Number.isFinite(pageTotal) && pageTotal >= 0) {
                        tier1ExpectedRunningTotal = pageTotal;
                      }
                      pushUnique(data);
                      runningCollectedCount += data.length;
                      if (data.length === 0) {
                        if (
                          Number.isFinite(pageTotal) &&
                          pageTotal >= 0 &&
                          runningCollectedCount < pageTotal
                        ) {
                          runningComplete = false;
                          runningErr = `Danh sách lớp RUNNING thiếu: ${runningCollectedCount}/${pageTotal}`;
                        }
                        break;
                      }
                      if (Number.isFinite(pageTotal) && pageTotal >= 0) {
                        if (runningCollectedCount >= pageTotal) {
                          break;
                        }
                      } else if (data.length < 100) {
                        break;
                      }
                      if (pageIdx === 24) {
                        runningComplete = false;
                        runningErr = `Danh sách lớp RUNNING vượt quá 25 trang (${runningCollectedCount}).`;
                      }
                    }

                    let finishedComplete = true;
                    let finishedErr = "";
                    if (runningComplete && schemaSupportsStatus) {
                      let finishedCollectedCount = 0;
                      for (let pageIdx = 0; pageIdx < 3; pageIdx++) {
                        const rFin = await gql(campusClassesQ, {
                          centres: centreIds,
                          status: ["FINISHED"],
                          pageIndex: pageIdx,
                          itemsPerPage: 100,
                        });
                        if (Array.isArray(rFin?.errors) && rFin.errors.length > 0) {
                          finishedComplete = false;
                          finishedErr = String(
                            rFin.errors[0]?.message || `GraphQL FINISHED error trang ${pageIdx + 1}`
                          );
                          break;
                        }
                        const connFin = rFin?.data?.classes;
                        const dataFin = connFin?.data;
                        if (!Array.isArray(dataFin)) {
                          finishedComplete = false;
                          finishedErr = `Dữ liệu FINISHED classes.data trang ${pageIdx + 1} không hợp lệ.`;
                          break;
                        }
                        const rawTotalFin = connFin?.pagination?.total;
                        const pageTotalFin =
                          typeof rawTotalFin === "number"
                            ? rawTotalFin
                            : typeof rawTotalFin === "string" && rawTotalFin.trim() !== ""
                              ? Number(rawTotalFin)
                              : NaN;
                        pushUnique(dataFin);
                        finishedCollectedCount += dataFin.length;
                        if (dataFin.length === 0) break;
                        if (isPageAllOlderFinished(dataFin)) break;
                        if (Number.isFinite(pageTotalFin) && pageTotalFin >= 0) {
                          if (finishedCollectedCount >= pageTotalFin) {
                            break;
                          }
                        } else if (dataFin.length < 100) {
                          break;
                        }
                      }
                    }

                    tier1Complete = runningComplete && finishedComplete;
                    tier1Err = runningErr || finishedErr;
                    if (!tier1Complete) {
                      complete = false;
                      errorMsg = tier1Err;
                    }
                  }

                  // Tier 2: Proven classesMissAttendOrComment (type: [], centre_in) if Tier 1 failed or returned 0
                  let tier2Complete = false;
                  let tier2Err = "";
                  let tier2RawCount = 0;
                  if (hasCentres && missAttendQ && (!tier1Complete || collected.length === 0)) {
                    let useMinimalMiss = false;
                    let runOk = true;
                    let runErr = "";

                    for (let pageIdx = 0; pageIdx < 15; pageIdx++) {
                      const vars = {
                        type: [],
                        centres: centreIds,
                        status: ["RUNNING"],
                        pageIndex: pageIdx,
                        itemsPerPage: 100,
                        orderBy: "createdAt_desc",
                      };
                      let r = await gql(
                        useMinimalMiss && missAttendMinQ ? missAttendMinQ : missAttendQ,
                        vars,
                        "classesMissAttendOrComment"
                      );
                      if (
                        pageIdx === 0 &&
                        !useMinimalMiss &&
                        missAttendMinQ &&
                        ((Array.isArray(r?.errors) && r.errors.length > 0) ||
                          !Array.isArray(r?.data?.classesMissAttendOrComment?.data)) &&
                        !isTransportOrAuthErr(r)
                      ) {
                        useMinimalMiss = true;
                        r = await gql(missAttendMinQ, vars, "classesMissAttendOrComment");
                      }
                      if (Array.isArray(r?.errors) && r.errors.length > 0) {
                        runOk = false;
                        runErr = String(
                          r.errors[0]?.message || `classesMissAttendOrComment error trang ${pageIdx + 1}`
                        );
                        break;
                      }
                      const data = r?.data?.classesMissAttendOrComment?.data;
                      if (!Array.isArray(data)) {
                        runOk = false;
                        runErr = `Dữ liệu classesMissAttendOrComment trang ${pageIdx + 1} không hợp lệ.`;
                        break;
                      }
                      tier2RawCount += data.length;
                      pushUnique(data);
                      if (data.length < 100) break;
                      if (pageIdx === 14) {
                        runOk = false;
                        runErr = "Danh sách lớp classesMissAttendOrComment vượt quá 15 trang.";
                      }
                    }

                    let finOk = true;
                    let finErr = "";
                    if (runOk) {
                      const finVars = {
                        type: [],
                        centres: centreIds,
                        status: ["FINISHED"],
                        pageIndex: 0,
                        itemsPerPage: 60,
                        orderBy: "createdAt_desc",
                      };
                      const rFin = await gql(
                        useMinimalMiss && missAttendMinQ ? missAttendMinQ : missAttendQ,
                        finVars,
                        "classesMissAttendOrComment"
                      );
                      if (Array.isArray(rFin?.errors) && rFin.errors.length > 0) {
                        finOk = false;
                        finErr = String(
                          rFin.errors[0]?.message || "classesMissAttendOrComment FINISHED error"
                        );
                      } else {
                        const finData = rFin?.data?.classesMissAttendOrComment?.data;
                        if (!Array.isArray(finData)) {
                          finOk = false;
                          finErr = "Dữ liệu classesMissAttendOrComment FINISHED không hợp lệ.";
                        } else {
                          tier2RawCount += finData.length;
                          pushUnique(finData);
                        }
                      }
                    }

                    tier2Complete = runOk && finOk;
                    tier2Err = runErr || finErr;
                    if (
                      tier2Complete &&
                      (tier2RawCount > 0 || !tier1Err) &&
                      (tier1ExpectedRunningTotal === null ||
                        collected.length >= tier1ExpectedRunningTotal)
                    ) {
                      complete = true;
                      errorMsg = "";
                    } else if (!tier2Complete) {
                      complete = false;
                      errorMsg = tier2Err || tier1Err;
                    }
                  }

                  // Tier 3: Legacy filter_textSearch fallback when centreIds is empty OR both Tier 1 & 2 yielded 0
                  if (!hasCentres || (collected.length === 0 && !tier1Complete && !tier2Complete)) {
                    let legacyComplete = true;
                    let legacyErr = "";
                    let legacyExpected: number | null = null;
                    let legacyCount = 0;
                    let tier3RawCount = 0;

                    for (let pageIdx = 0; pageIdx < 25; pageIdx++) {
                      const r = await gql(clsQuery, {
                        text: cCode,
                        pageIndex: pageIdx,
                        itemsPerPage: 100,
                      });
                      if (Array.isArray(r?.errors) && r.errors.length > 0) {
                        if (pageIdx === 0 && minClsQuery && !isTransportOrAuthErr(r)) {
                          const rMin = await gql(minClsQuery, { text: cCode });
                          const minData = rMin?.data?.classes?.data;
                          if (
                            (!Array.isArray(rMin?.errors) || rMin.errors.length === 0) &&
                            Array.isArray(minData)
                          ) {
                            tier3RawCount += minData.length;
                            pushUnique(minData);
                            if (minData.length >= 100) {
                              legacyComplete = false;
                              legacyErr =
                                "Truy vấn tối giản chạm giới hạn 100 lớp nên chưa xác minh đủ.";
                            }
                            break;
                          }
                          legacyComplete = false;
                          legacyErr = String(
                            rMin?.errors?.[0]?.message || "GraphQL minimal error"
                          );
                          break;
                        }
                        legacyComplete = false;
                        legacyErr = String(
                          r.errors[0]?.message || `GraphQL error ở trang ${pageIdx + 1}`
                        );
                        break;
                      }

                      const conn = r?.data?.classes;
                      const data = conn?.data;
                      if (!Array.isArray(data)) {
                        legacyComplete = false;
                        legacyErr = `Dữ liệu classes.data ở trang ${pageIdx + 1} không hợp lệ.`;
                        break;
                      }
                      const pageTotal = Number(conn?.pagination?.total ?? NaN);
                      if (Number.isFinite(pageTotal) && pageTotal >= 0) {
                        legacyExpected = pageTotal;
                      }
                      tier3RawCount += data.length;
                      pushUnique(data);
                      legacyCount += data.length;
                      if (data.length === 0) {
                        if (legacyExpected !== null && legacyCount < legacyExpected) {
                          legacyComplete = false;
                          legacyErr = `Danh sách lớp thiếu: ${legacyCount}/${legacyExpected}`;
                        }
                        break;
                      }
                      if (legacyExpected !== null && legacyCount >= legacyExpected) {
                        break;
                      }
                      if (legacyExpected === null && data.length < 100) {
                        break;
                      }
                      if (pageIdx === 24 && (legacyExpected === null || legacyCount < legacyExpected)) {
                        legacyComplete = false;
                        legacyErr = `Danh sách lớp vượt quá 25 trang (${legacyCount}/${legacyExpected ?? "?"}).`;
                      }
                    }

                    if (!hasCentres) {
                      complete = legacyComplete;
                      expectedTotal = legacyExpected;
                      errorMsg = legacyErr;
                    } else if (legacyComplete && (tier3RawCount > 0 || (!tier1Err && !tier2Err))) {
                      complete = true;
                      errorMsg = "";
                    }
                  }

                  // Tier 4: Cross-check classes on Teaching weekly schedule missing from collected
                  if (Array.isArray(teachingTargets) && teachingTargets.length > 0) {
                    for (const t of teachingTargets) {
                      const codeUpper = String(t?.classCode || "").trim().toUpperCase();
                      if (!codeUpper || seenNames.has(codeUpper)) continue;
                      const resT = await searchSingleExact(
                        codeUpper,
                        Array.isArray(t?.candidates) && t.candidates.length > 0
                          ? t.candidates
                          : [codeUpper]
                      );
                      if (resT.found) {
                        pushUnique([resT.found]);
                      }
                    }
                  }

                  return {
                    collected,
                    complete,
                    expectedTotal,
                    error: errorMsg,
                  };
                },
                {
                  hdrs: discoveryHeaders,
                  cCode: singleClassCode || centerCode,
                  centreIds: activeCentreIds,
                  isSingleClass: Boolean(singleClassCode),
                  singleCandidates: singleClassCode
                    ? buildLmsClassSearchCandidates(singleClassCode)
                    : [],
                  teachingTargets: teachingScheduleTargets,
                  recentFinishedCutoffMs: Date.now() - 21 * ONE_DAY_MS,
                  clsQuery: FALLBACK_CLASSES_QUERY,
                  minClsQuery: MINIMAL_CLASSES_QUERY,
                  campusClassesQ: CAMPUS_CLASSES_BY_CENTRE_QUERY,
                  campusClassesNoStatusQ: CAMPUS_CLASSES_BY_CENTRE_NO_STATUS_QUERY,
                  missAttendQ: CAMPUS_MISS_ATTEND_CLASSES_QUERY,
                  missAttendMinQ: CAMPUS_MISS_ATTEND_MINIMAL_QUERY,
                }
              );

              const nowMs = Date.now();
              const filteredDiscovery = (discoveryResult?.collected || [])
                .map((c: any) => {
                  const classCode = String(c?.name || "").trim().toUpperCase();
                  let mainT = "";
                  let taT = "";
                  for (const t of c?.teachers || []) {
                    const tn = String(
                      t?.teacher?.fullName || t?.teacher?.username || ""
                    ).trim();
                    const rn = String(t?.role?.name || "").toLowerCase();
                    if (!tn) continue;
                    if (rn.includes("ta") || rn.includes("assistant")) {
                      if (!taT) taT = tn;
                    } else if (!mainT) {
                      mainT = tn;
                    }
                  }
                  return {
                    lmsClassId: String(c?.id || "").trim(),
                    classCode,
                    courseName: String(c?.course?.name || "").trim(),
                    status: String(c?.status || "").trim(),
                    startDate:
                      c?.startDate !== undefined && c?.startDate !== null
                        ? String(c.startDate).trim()
                        : "",
                    endDate:
                      c?.endDate !== undefined && c?.endDate !== null
                        ? String(c.endDate).trim()
                        : "",
                    mainTeacher: mainT,
                    assistantTeacher: taT,
                  };
                })
                .filter((c: any) => {
                  if (!c.classCode || !c.lmsClassId) return false;
                  if (singleClassCode) return c.classCode === singleClassCode;
                  const statusUp = String(c.status || "").trim().toUpperCase();
                  if (/CANCEL|CLOSE|DROP|PENDING|UPCOMING|OPENING|WAITING|PREPARING/.test(statusUp)) return false;
                  const isRunning = isConfirmedRunningStatus(c.status);
                  const isRecentFinished =
                    statusUp.includes("FINISH") &&
                    isAdminFinishedClassWithinGraceWindow(c.endDate, 14, nowMs);
                  const onTeachingSchedule = teachingScheduleCodeSet.has(c.classCode);
                  const needsDetailCheck = statusUp === "";
                  if (
                    !isRunning &&
                    !isRecentFinished &&
                    !onTeachingSchedule &&
                    !needsDetailCheck
                  ) {
                    return false;
                  }
                  if (scope === "CODING_ONLY" && isRoboticsClassCode(c.classCode)) {
                    return false;
                  }
                  return true;
                });

              // Deduplicate by classCode
              const uniqueMap = new Map<string, any>();
              for (const c of filteredDiscovery) {
                if (!uniqueMap.has(c.classCode)) uniqueMap.set(c.classCode, c);
              }
              const targetList = Array.from(uniqueMap.values());
              progressState.totalClasses = targetList.length;

              // Warm capture live GetClassById / FindStudentSubmissionByClass query text once
              const seedCodingClass =
                targetList.find((c) => !isRoboticsClassCode(c.classCode)) ||
                targetList[0];
              if (
                seedCodingClass &&
                (!captureState.capturedGetClassQuery || !captureState.capturedSubmissionQuery)
              ) {
                try {
                  const seedUrl = buildLmsClassCommentsUrl({
                    lmsBaseUrl: config.lmsUrl,
                    classCode: seedCodingClass.classCode,
                    lmsClassId: seedCodingClass.lmsClassId,
                    tab: 3,
                  });
                  await page.goto(seedUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
                  await page.waitForTimeout(1500);
                  await interceptor.dismissForbiddenToast();
                  await LmsHelpers.openClassDrawer(page, seedCodingClass.classCode).catch(() => {});
                  if (
                    !captureState.capturedSubmissionQuery &&
                    typeof (page as any)?.locator === "function"
                  ) {
                    const tab3 = page
                      .locator(
                        '.MuiDrawer-root #tab-3, [role="dialog"] #tab-3, #tab-3, [role="tab"]:has-text("Submission"), [role="tab"]:has-text("Chấm bài")'
                      )
                      .first();
                    const isAlreadyTab3 =
                      (await tab3.getAttribute("aria-selected").catch(() => "false")) === "true";
                    if (isAlreadyTab3) {
                      const tab0 = page
                        .locator('.MuiDrawer-root #tab-0, [role="dialog"] #tab-0, #tab-0')
                        .first();
                      if ((await tab0.count().catch(() => 0)) > 0) {
                        await tab0.click({ force: true }).catch(() => {});
                        await page.waitForTimeout(500);
                      }
                    }
                  }
                  await LmsHelpers.switchDrawerTab(page, SELECTORS.tabs.grading).catch(() => {});
                  await page.waitForTimeout(1500);
                } catch {
                  // ignore seed capture timeout; fallback GraphQL queries remain ready
                }
              }

              const detailHeaders = await resolveAdminPageAuthHeaders(
                page,
                captureState.capturedHeaders
              );

              const perClass = new Map<
                string,
                {
                  classByIdData: any | null;
                  submissionGqlData: any | null;
                  studentWorks: any[];
                  studentLetters?: any[];
                  error?: string;
                  subError?: string;
                  worksError?: string;
                }
              >();
              const skippedHistoricalClasses = new Set<string>();

              let stoppedEarly = false;
              for (const item of targetList) {
                ensureQueueNotStopped();
                if (progressState.stopAfterCurrentRequested) {
                  stoppedEarly = true;
                  break;
                }
                progressState.currentClassCode = item.classCode;
                const isRob = isRoboticsClassCode(item.classCode);
                const onTeachingSchedule = teachingScheduleCodeSet.has(item.classCode);

                try {
                  await page
                    .evaluate("window.__name = window.__name || function(f){ return f; }")
                    .catch(() => {});
                  const fetched = await page.evaluate(
                    async ({
                      lmsId,
                      hdrs,
                      getClassQ,
                      getClassMinQ,
                      classFieldQ,
                      classFieldMinQ,
                      subQ,
                      subLegacyQ,
                      subVarsTemplate,
                      worksQ,
                      worksMinQ,
                      lettersQ,
                      includeSubmissions,
                      checkActiveAfterDetail,
                      recentGraceCutoffMs,
                    }: any) => {
                      const headers: Record<string, string> = {
                        "content-type": "application/json",
                      };
                      for (const [k, v] of Object.entries(hdrs || {})) {
                        const kl = k.toLowerCase();
                        if (
                          kl === "authorization" ||
                          kl === "token" ||
                          kl.startsWith("x-") ||
                          kl.startsWith("apollo-")
                        ) {
                          headers[k] = String(v);
                        }
                      }
                      const gql = async (
                        query: string,
                        variables?: any,
                        operationName?: string
                      ) => {
                        const r = await fetch("https://lms-api.mindx.edu.vn/", {
                          method: "POST",
                          headers,
                          body: JSON.stringify({
                            query,
                            variables,
                            ...(operationName ? { operationName } : {}),
                          }),
                        });
                        const parsed =
                          typeof r?.json === "function"
                            ? await r.json().catch(() => null)
                            : null;
                        if (!r || !r.ok) {
                          const gqlMsg =
                            Array.isArray(parsed?.errors) && parsed.errors.length > 0
                              ? String(parsed.errors[0]?.message || "")
                              : "";
                          return {
                            __httpError: true,
                            status: Number(r?.status || 0),
                            errors: [
                              { message: gqlMsg || `LMS GraphQL HTTP ${r?.status ?? "ERR"}` },
                            ],
                            data: null,
                          };
                        }
                        if (!parsed || typeof parsed !== "object") {
                          return {
                            __httpError: true,
                            status: Number(r.status || 0),
                            errors: [
                              { message: `LMS GraphQL phản hồi không hợp lệ (HTTP ${r.status})` },
                            ],
                            data: null,
                          };
                        }
                        return parsed;
                      };

                      const extractCls = (obj: any) =>
                        obj?.data?.classesById ||
                        obj?.data?.class ||
                        obj?.data?.getClassById ||
                        null;
                      const isTransportOrAuthErr = (resObj: any) =>
                        Boolean(resObj?.__httpError) &&
                        (Number(resObj?.status) === 401 ||
                          Number(resObj?.status) === 403 ||
                          Number(resObj?.status) >= 500);
                      const clsQueries: Array<[string, string]> = [
                        [getClassQ, "GetClassById"],
                        ...(getClassMinQ
                          ? [[getClassMinQ, "GetClassByIdMinimal"] as [string, string]]
                          : []),
                        ...(classFieldQ
                          ? [[classFieldQ, "AdminGetClassFieldById"] as [string, string]]
                          : []),
                        ...(classFieldMinQ
                          ? [[classFieldMinQ, "AdminGetClassFieldByIdMinimal"] as [string, string]]
                          : []),
                      ];
                      let clsPayload: any = null;
                      let clsLastErr = "";
                      for (const [qText, opName] of clsQueries) {
                        const rCls = await gql(qText, { id: lmsId }, opName);
                        const candidatePayload = extractCls(rCls);
                        const hasErr = Array.isArray(rCls?.errors) && rCls.errors.length > 0;
                        if (!hasErr && candidatePayload) {
                          clsPayload = candidatePayload;
                          clsLastErr = "";
                          break;
                        }
                        if (isTransportOrAuthErr(rCls)) {
                          clsLastErr = String(
                            rCls?.errors?.[0]?.message || `LMS GraphQL HTTP ${rCls?.status || "ERR"}`
                          );
                          break;
                        }
                        if (hasErr && !clsLastErr) {
                          clsLastErr = String(rCls.errors[0]?.message || "GraphQL error");
                        }
                      }
                      if (!clsPayload || clsLastErr) {
                        return {
                          classByIdData: null,
                          submissionGqlData: null,
                          studentWorks: [],
                          err: clsLastErr || "Không đọc được chi tiết lớp từ LMS GraphQL.",
                          subError: "",
                          worksError: "",
                        };
                      }

                      if (checkActiveAfterDetail) {
                        const stUp = String(clsPayload?.status || "").trim().toUpperCase();
                        const isCancelled = /CANCEL|CLOSE|DROP/.test(stUp);
                        const isRunningSt = stUp === "RUNNING" || stUp === "ACTIVE";
                        if (isCancelled) {
                          return {
                            skippedHistoricalFinished: true,
                            classByIdData: clsPayload,
                            submissionGqlData: null,
                            studentWorks: [],
                            err: "",
                            subError: "",
                            worksError: "",
                          };
                        }
                        if (!isRunningSt) {
                          let endMs: number | null = null;
                          const rawEnd = clsPayload?.endDate;
                          if (typeof rawEnd === "number" && Number.isFinite(rawEnd)) {
                            endMs = rawEnd > 1e12 ? rawEnd : rawEnd * 1000;
                          } else if (typeof rawEnd === "string" && rawEnd.trim() && rawEnd.trim() !== "0000-00-00") {
                            const rawTrim = rawEnd.trim();
                            if (/^\d{10,13}$/.test(rawTrim)) {
                              const num = Number(rawTrim);
                              endMs = num > 1e12 ? num : num * 1000;
                            } else {
                              const parsedMs = Date.parse(rawTrim);
                              if (Number.isFinite(parsedMs)) {
                                endMs = parsedMs;
                              } else {
                                const dmy = rawTrim.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
                                if (dmy) {
                                  let y = Number(dmy[3]);
                                  if (y < 100) y += 2000;
                                  endMs = Date.UTC(y, Number(dmy[2]) - 1, Number(dmy[1]));
                                }
                              }
                            }
                          }
                          if (
                            (stUp.includes("FINISH") && endMs !== null && endMs < recentGraceCutoffMs) ||
                            (!stUp.includes("FINISH") && stUp !== "")
                          ) {
                            return {
                              skippedHistoricalFinished: true,
                              classByIdData: clsPayload,
                              submissionGqlData: null,
                              studentWorks: [],
                              err: "",
                              subError: "",
                              worksError: "",
                            };
                          }
                        }
                      }

                      let submissionGqlData: any = null;
                      let subError = "";
                      if (includeSubmissions) {
                        const usePayloadVars =
                          String(subQ || "").includes("$payload") ||
                          Boolean(
                            subVarsTemplate &&
                              typeof subVarsTemplate === "object" &&
                              "payload" in subVarsTemplate
                          );
                        const subVariables = usePayloadVars
                          ? {
                              ...(subVarsTemplate || {}),
                              payload: {
                                ...(subVarsTemplate?.payload || {}),
                                classId: lmsId,
                              },
                            }
                          : { classId: lmsId };
                        const extractSub = (obj: any) =>
                          obj?.data?.findStudentSubmissionByClass ||
                          obj?.data?.studentSubmissions ||
                          null;
                        let subRes = await gql(
                          subQ,
                          subVariables,
                          "FindStudentSubmissionByClass"
                        );
                        if (
                          ((Array.isArray(subRes?.errors) && subRes.errors.length > 0) ||
                            !extractSub(subRes)) &&
                          subLegacyQ
                        ) {
                          subRes = await gql(subLegacyQ, { classId: lmsId });
                        }
                        submissionGqlData = extractSub(subRes);
                        if (
                          (Array.isArray(subRes?.errors) && subRes.errors.length > 0) ||
                          !submissionGqlData
                        ) {
                          submissionGqlData = null;
                          subError =
                            (Array.isArray(subRes?.errors) && subRes.errors[0]?.message) ||
                            "Không đọc được dữ liệu BTVN (submissions) từ LMS GraphQL.";
                        }
                      }

                      const slotsArr: any[] = Array.isArray(clsPayload?.slots)
                        ? clsPayload.slots
                        : [];
                      const stUp = String(clsPayload?.status || "").toUpperCase();
                      const needsWorks =
                        stUp.includes("FINISH") || slotsArr.length >= 12;

                      let studentWorks: any[] = [];
                      let studentLetters: any[] = [];
                      let worksError = "";
                      if (needsWorks) {
                        let wRes = await gql(worksQ, { classId: lmsId });
                        if (
                          ((Array.isArray(wRes?.errors) && wRes.errors.length > 0) ||
                            !Array.isArray(wRes?.data?.findAllStudentWorks?.data)) &&
                          worksMinQ
                        ) {
                          wRes = await gql(worksMinQ, { classId: lmsId });
                        }
                        const rawWorksData = wRes?.data?.findAllStudentWorks?.data;
                        if (
                          (Array.isArray(wRes?.errors) && wRes.errors.length > 0) ||
                          !Array.isArray(rawWorksData)
                        ) {
                          worksError =
                            (Array.isArray(wRes?.errors) && wRes.errors[0]?.message) ||
                            "Không đọc được danh sách sản phẩm SPCK (findAllStudentWorks) từ LMS GraphQL.";
                        } else {
                          studentWorks = rawWorksData;
                        }
                        if (lettersQ) {
                          try {
                            const lRes = await gql(
                              lettersQ,
                              { classId: lmsId },
                              "FindStudentLettersByClass"
                            );
                            const rawLetters =
                              lRes?.data?.studentLetters?.data ||
                              lRes?.data?.findStudentLettersPagination?.data ||
                              lRes?.data?.findStudentLettersByClass?.data ||
                              lRes?.data?.findAllStudentLetters?.data;
                            if (Array.isArray(rawLetters)) {
                              studentLetters = rawLetters;
                            }
                          } catch {}
                        }
                      }

                      return {
                        classByIdData: clsPayload,
                        submissionGqlData,
                        studentWorks,
                        studentLetters,
                        err: "",
                        subError,
                        worksError,
                      };
                    },
                    {
                      lmsId: item.lmsClassId,
                      hdrs: detailHeaders,
                      getClassQ:
                        captureState.capturedGetClassQuery || FALLBACK_GET_CLASS_BY_ID_QUERY,
                      getClassMinQ: FALLBACK_GET_CLASS_BY_ID_MINIMAL_QUERY,
                      classFieldQ: FALLBACK_CLASS_FIELD_BY_ID_QUERY,
                      classFieldMinQ: FALLBACK_CLASS_FIELD_BY_ID_MINIMAL_QUERY,
                      subQ:
                        captureState.capturedSubmissionQuery || FALLBACK_SUBMISSION_QUERY,
                      subLegacyQ: FALLBACK_SUBMISSION_LEGACY_QUERY,
                      subVarsTemplate: captureState.capturedSubmissionVars,
                      worksQ: FIND_ALL_STUDENT_WORKS_QUERY,
                      worksMinQ: FIND_ALL_STUDENT_WORKS_MINIMAL_QUERY,
                      lettersQ: LMS_FIND_STUDENT_LETTERS_BY_CLASS_QUERY,
                      includeSubmissions: !isRob,
                      checkActiveAfterDetail: !singleClassCode && !onTeachingSchedule,
                      recentGraceCutoffMs: nowMs - 14 * ONE_DAY_MS,
                    }
                  );

                  if (fetched.classByIdData) {
                    assertMatchingLmsClassPayload(
                      fetched.classByIdData,
                      item.classCode,
                      item.lmsClassId
                    );
                  }

                  if (fetched.skippedHistoricalFinished) {
                    skippedHistoricalClasses.add(item.classCode);
                    continue;
                  }

                  if (fetched.err) {
                    throw new Error(fetched.err);
                  }
                  if (fetched.classByIdData) {
                    const clsDetail = fetched.classByIdData;
                    if (!singleClassCode && /PENDING|UPCOMING|OPENING|WAITING|PREPARING/i.test(String(clsDetail?.status || ""))) {
                      skippedHistoricalClasses.add(item.classCode);
                      continue;
                    }
                    if (!singleClassCode && !onTeachingSchedule) {
                      const detailStatus = String(clsDetail?.status || "").trim();
                      const detailStatusUp = detailStatus.toUpperCase();
                      const detailRunning = isConfirmedRunningStatus(detailStatus);
                      const detailRecentFin =
                        detailStatusUp.includes("FINISH") &&
                        isAdminFinishedClassWithinGraceWindow(
                          clsDetail?.endDate,
                          14,
                          nowMs
                        );
                      if (
                        /CANCEL|CLOSE|DROP|PENDING|UPCOMING|OPENING|WAITING|PREPARING/.test(detailStatusUp) ||
                        (!detailRunning && !detailRecentFin && detailStatusUp !== "")
                      ) {
                        skippedHistoricalClasses.add(item.classCode);
                        continue;
                      }
                    }

                    // Enrich item metadata from authoritative GetClassById payload
                    if (clsDetail?.status) item.status = String(clsDetail.status).trim();
                    if (clsDetail?.startDate) item.startDate = String(clsDetail.startDate).trim();
                    if (clsDetail?.endDate) item.endDate = String(clsDetail.endDate).trim();
                    if (clsDetail?.course?.name) item.courseName = String(clsDetail.course.name).trim();
                    for (const t of [...(clsDetail?.teachers || [])].sort(
                      (a: any, b: any) =>
                        (a?.isActive !== false ? 0 : 1) - (b?.isActive !== false ? 0 : 1)
                    )) {
                      const tn = String(
                        t?.teacher?.fullName || t?.teacher?.username || ""
                      ).trim();
                      const rn = String(t?.role?.name || "").toLowerCase();
                      if (!tn) continue;
                      if (/\bta\b/.test(rn) || rn.includes("assistant") || rn.includes("trợ")) {
                        if (!item.assistantTeacher) item.assistantTeacher = tn;
                      } else if (!item.mainTeacher) {
                        item.mainTeacher = tn;
                      }
                    }
                  } else {
                    throw new Error(`LMS không trả về dữ liệu chi tiết lớp ${item.classCode}.`);
                  }

                  perClass.set(item.classCode, {
                    classByIdData: fetched.classByIdData,
                    submissionGqlData: fetched.submissionGqlData,
                    studentWorks: fetched.studentWorks || [],
                    studentLetters: fetched.studentLetters || [],
                    ...(fetched.subError ? { subError: sanitizeErrorMessage(fetched.subError) } : {}),
                    ...(fetched.worksError ? { worksError: sanitizeErrorMessage(fetched.worksError) } : {}),
                  });
                } catch (clsErr: any) {
                  if (String(clsErr?.message || "").includes("QUEUE_STOPPED")) {
                    throw clsErr;
                  }
                  perClass.set(item.classCode, {
                    classByIdData: null,
                    submissionGqlData: null,
                    studentWorks: [],
                    error: sanitizeErrorMessage(clsErr),
                  });
                }
              }

              return {
                discoveredClasses: targetList.filter(
                  (c) => !skippedHistoricalClasses.has(c.classCode)
                ),
                perClass,
                stoppedEarly,
                discoveryComplete: Boolean(discoveryResult?.complete),
                discoveryError: discoveryResult?.error || undefined,
                expectedTotal: discoveryResult?.expectedTotal ?? null,
              };
            } finally {
              page.off("request", reqListener);
            }
          });
          if (
            isLmsApiReadEnabled() &&
            authService.withAdminLmsSession === AuthService.prototype.withAdminLmsSession
          ) {
            let apiBundle: AdminLmsFetchedBundle | null = null;
            try {
              const candidate = await fetchAdminLmsBundleViaNodeApi({
                adminCfg,
                centerCode,
                scope,
                singleClassCode,
                teachingOverview,
                progressState,
              });
              if (
                !candidate.stoppedEarly &&
                candidate.discoveryComplete === false &&
                candidate.discoveredClasses.length === 0
              ) {
                ensureQueueNotStopped();
                runWarnings.push(
                  redactSecrets(
                    `Quét LMS Admin qua API thuần chưa thu thập được lớp nào (${
                      candidate.discoveryError || "discoveryComplete=false"
                    }), tự động lùi về Playwright Admin Session.`
                  )
                );
              } else {
                apiBundle = candidate;
              }
            } catch (apiErr: any) {
              if (isQueueStoppedError(apiErr)) {
                throw apiErr;
              }
              runWarnings.push(
                redactSecrets(
                  `Quét LMS Admin qua API thuần chưa hoàn tất (${sanitizeErrorMessage(
                    apiErr
                  )}), tự động lùi về Playwright Admin Session.`
                )
              );
            }
            lmsBundle = apiBundle ?? (await runPlaywrightAdminBundle());
          } else {
            lmsBundle = await runPlaywrightAdminBundle();
          }
        }

        if (lmsBundle.discoveryComplete === false || lmsBundle.discoveryError) {
          const discErr = redactSecrets(
            lmsBundle.discoveryError ||
              "Quét danh sách lớp từ LMS chưa đầy đủ (lỗi phân trang). Đã giữ nguyên các lớp cũ."
          );
          if (lmsBundle.discoveredClasses.length === 0) {
            throw new Error(discErr);
          }
          runWarnings.push(discErr);
        }

        // 3. Merge Teaching detail (students, exercises/scores for Coding, SPCK project & tasks for >= Buổi 10)
        const targetMetaList = lmsBundle.discoveredClasses.filter((c) => {
          if (singleClassCode) return c.classCode === singleClassCode;
          if (scope === "CODING_ONLY" && isRoboticsClassCode(c.classCode)) {
            return false;
          }
          return lmsBundle.perClass.has(c.classCode);
        });

        progressState.totalClasses = targetMetaList.length;

        const detailTargets = targetMetaList.map((c) => {
          const per = lmsBundle.perClass.get(c.classCode);
          const blockType: AdminBlockType =
            teachingOverview.scheduleByClass.get(c.classCode)?.blockType === "ROBOTICS" ||
            isRoboticsClassCode(c.classCode)
              ? "ROBOTICS"
              : "CODING";
          const schedEntry = teachingOverview.scheduleByClass.get(c.classCode);
          const rawSlotsArr = Array.isArray(per?.classByIdData?.slots)
            ? per!.classByIdData.slots
            : [];
          const slotCount = rawSlotsArr.filter((s: any) => {
            const hasAttOrSummary =
              stripHtmlPlain(s?.summary).length > 0 ||
              (Array.isArray(s?.studentAttendance) &&
                s.studentAttendance.some(
                  (a: any) =>
                    normalizeAttendanceTag(a?.status) !== "UNMARKED" ||
                    stripHtmlPlain(a?.comment).length > 0
                ));
            return (
              hasAttOrSummary ||
              hasLmsSlotTimePassed(s, Date.now(), schedEntry?.timeSlot)
            );
          }).length;
          const schedSess = schedEntry?.sessionNumber || 0;
          const estSession = rawSlotsArr.length > 0 ? slotCount : schedSess;
          return {
            classCode: c.classCode,
            blockType,
            needScores: blockType === "CODING",
            needSpckProject: estSession >= 10,
          };
        });

        const { detailsByClass, warnings: detailWarnings } =
          await fetchTeachingClassDetailsBatch(detailTargets, options?.teachingDeps);
        for (const w of detailWarnings || []) {
          runWarnings.push(redactSecrets(w));
        }
        const hasCheckNhanXetError = teachingOverview.fetchWarnings.some((w) =>
          w.includes("/check_nhanxet.php")
        );

        // 4. Compute audits & upsert ONLY into admin_center_classes (strict isolation!)
        for (const meta of targetMetaList) {
          ensureQueueNotStopped();
          if (progressState.stopAfterCurrentRequested) {
            finalRunStatus = "STOPPED";
            break;
          }
          progressState.currentClassCode = meta.classCode;
          const per = lmsBundle.perClass.get(meta.classCode);
          const prevRecord = adminCenterRepo.findClass(meta.classCode);

          let perError = per?.error ? redactSecrets(per.error) : "";
          if (!perError && per?.classByIdData) {
            try {
              assertMatchingLmsClassPayload(
                per.classByIdData,
                meta.classCode,
                meta.lmsClassId
              );
            } catch (mismatchErr: any) {
              perError = sanitizeErrorMessage(mismatchErr);
            }
          } else if (!perError && !per?.classByIdData) {
            perError = `Không đọc được dữ liệu LMS lớp ${meta.classCode}.`;
          }

          if (perError || !per?.classByIdData) {
            const safeErr =
              perError || `Không đọc được dữ liệu LMS lớp ${meta.classCode}.`;
            failedClasses.push({ classCode: meta.classCode, error: safeErr });
            if (prevRecord) {
              // Preserve last known good metrics on partial/LMS failure; never overwrite with zeros
              adminCenterRepo.upsertClass({
                ...prevRecord,
                lastError: safeErr,
              });
            }
            scannedCount++;
            progressState.scannedClasses = scannedCount;
            continue;
          }

          const tDetail = detailsByClass.get(meta.classCode) || null;
          const auditRecord = computeAdminClassAudits({
            centerCode,
            rawClassMeta: meta,
            classByIdData: per.classByIdData,
            submissionGqlData: per.submissionGqlData || null,
            studentWorks: per.studentWorks || [],
            studentLetters: per.studentLetters || [],
            teachingScheduleEntry: teachingOverview.scheduleByClass.get(meta.classCode) || null,
            teachingCheckRows: teachingOverview.checkRowsByClass.get(meta.classCode) || [],
            teachingDetail: tDetail,
            teachingMakeupRows: teachingOverview.makeupByClass.get(meta.classCode) || [],
            teachingAllMakeupRows:
              teachingOverview.allMakeupByClass?.get(meta.classCode) ||
              teachingOverview.makeupByClass.get(meta.classCode) ||
              [],
          });

          // Option B: Hide/prune unstarted or PENDING classes (0 occurred sessions) from /admin-center (including single-class scan)
          if (
            isAdminUnstartedOrPendingClass({
              status: auditRecord.status,
              currentSessionNumber: auditRecord.currentSessionNumber,
              hasSlots:
                Array.isArray(per.classByIdData?.slots) &&
                per.classByIdData.slots.length > 0,
            })
          ) {
            try {
              getDb()
                .prepare(`DELETE FROM admin_center_classes WHERE centerCode = ? AND classCode = ?`)
                .run(centerCode, meta.classCode);
            } catch {}
            progressState.totalClasses = Math.max(
              scannedCount,
              progressState.totalClasses - 1
            );
            continue;
          }

          const failedEps = new Set(tDetail?.failedEndpoints || []);
          if (prevRecord && failedEps.size > 0) {
            if (failedEps.has("students")) {
              auditRecord.teachingStudentCount = prevRecord.teachingStudentCount;
              const currWarnings = safeJsonParse<AdminEarlyWarningItem[]>(
                auditRecord.earlyWarningsJson,
                []
              ).filter((w) => w.type !== "ROSTER_MISMATCH");
              const prevRosterWarnings = safeJsonParse<AdminEarlyWarningItem[]>(
                prevRecord.earlyWarningsJson,
                []
              ).filter((w) => w.type === "ROSTER_MISMATCH");
              auditRecord.earlyWarningsJson = JSON.stringify([
                ...currWarnings,
                ...prevRosterWarnings,
              ]);
            }
            if (failedEps.has("project") || failedEps.has("tasks")) {
              auditRecord.spckTasksJson = prevRecord.spckTasksJson;
              auditRecord.spckTasksSyncStatus = prevRecord.spckTasksSyncStatus;
              auditRecord.spckTasksSyncedAt = prevRecord.spckTasksSyncedAt;
            }
            if (failedEps.has("scores") || failedEps.has("exercises")) {
              const prevBtvn = safeJsonParse<Partial<AdminBtvnCodingSummary>>(
                prevRecord.btvnSummaryJson,
                {}
              );
              const currBtvn = safeJsonParse<AdminBtvnCodingSummary>(
                auditRecord.btvnSummaryJson,
                {} as AdminBtvnCodingSummary
              );
              auditRecord.btvnSummaryJson = JSON.stringify({
                ...currBtvn,
                teachingDeclaredBtvnSessions:
                  prevBtvn.teachingDeclaredBtvnSessions ||
                  currBtvn.teachingDeclaredBtvnSessions,
                teachingScoredCellsCount:
                  prevBtvn.teachingScoredCellsCount ??
                  currBtvn.teachingScoredCellsCount,
                isOutOfSyncWithTeaching:
                  prevBtvn.isOutOfSyncWithTeaching ?? currBtvn.isOutOfSyncWithTeaching,
              });
              auditRecord.btvnSyncStatus = prevRecord.btvnSyncStatus;
              auditRecord.btvnSyncedAt = prevRecord.btvnSyncedAt;
            }
          }

          if (prevRecord && hasCheckNhanXetError) {
            const prevWeekly = safeJsonParse<Partial<AdminWeeklyOpsSummary>>(
              prevRecord.weeklyOpsJson,
              {}
            );
            const currWeekly = safeJsonParse<AdminWeeklyOpsSummary>(
              auditRecord.weeklyOpsJson,
              {} as AdminWeeklyOpsSummary
            );
            auditRecord.weeklyOpsJson = JSON.stringify({
              ...currWeekly,
              zaloStatus: prevWeekly.zaloStatus ?? currWeekly.zaloStatus,
              zaloDeadline: prevWeekly.zaloDeadline ?? currWeekly.zaloDeadline,
              isZaloLateOrMissing:
                prevWeekly.isZaloLateOrMissing ?? currWeekly.isZaloLateOrMissing,
              lmsCheckStatus: prevWeekly.lmsCheckStatus ?? currWeekly.lmsCheckStatus,
              lmsDeadline: prevWeekly.lmsDeadline ?? currWeekly.lmsDeadline,
              isLmsLateOrMissing:
                prevWeekly.isLmsLateOrMissing ?? currWeekly.isLmsLateOrMissing,
              checkIssueNote: prevWeekly.checkIssueNote ?? currWeekly.checkIssueNote,
            });
          }

          const lmsSideErrors: string[] = [];
          if (per?.subError) {
            lmsSideErrors.push(redactSecrets(per.subError));
            if (prevRecord) {
              auditRecord.btvnSummaryJson = prevRecord.btvnSummaryJson;
              auditRecord.btvnSyncStatus = prevRecord.btvnSyncStatus;
              auditRecord.btvnSyncedAt = prevRecord.btvnSyncedAt;
              auditRecord.lmsReportCardSnapshotJson = prevRecord.lmsReportCardSnapshotJson;
              const currWarnings = safeJsonParse<AdminEarlyWarningItem[]>(
                auditRecord.earlyWarningsJson,
                []
              ).filter((w) => w.type !== "CONSECUTIVE_MISSING_BTVN");
              const prevBtvnWarnings = safeJsonParse<AdminEarlyWarningItem[]>(
                prevRecord.earlyWarningsJson,
                []
              ).filter((w) => w.type === "CONSECUTIVE_MISSING_BTVN");
              auditRecord.earlyWarningsJson = JSON.stringify([
                ...currWarnings,
                ...prevBtvnWarnings,
              ]);
            }
          }
          if (per?.worksError) {
            lmsSideErrors.push(redactSecrets(per.worksError));
            if (prevRecord) {
              auditRecord.spckAuditJson = prevRecord.spckAuditJson;
            }
          }

          const combinedClassErrors = [
            ...lmsSideErrors,
            ...(tDetail?.hasFetchError ? tDetail.fetchErrors || [] : []),
          ];
          if (combinedClassErrors.length > 0) {
            hasPartialClassData = true;
            const safeClassErr = redactSecrets(combinedClassErrors.join(" | "));
            auditRecord.lastError = safeClassErr;
            failedClasses.push({ classCode: meta.classCode, error: safeClassErr });
          } else {
            scannedOkCount++;
          }

          adminCenterRepo.upsertClass(auditRecord);
          scannedCount++;
          progressState.scannedClasses = scannedCount;
        }

        if (lmsBundle.stoppedEarly || progressState.stopAfterCurrentRequested) {
          finalRunStatus = "STOPPED";
        } else if (failedClasses.length > 0 || runWarnings.length > 0) {
          finalRunStatus =
            scannedOkCount > 0 || hasPartialClassData ? "PARTIAL" : "FAILED";
        }

        // Only prune classes not in active set after a full, uninterrupted, 100%-clean ALL scan
        if (
          scope === "ALL" &&
          finalRunStatus === "COMPLETED" &&
          lmsBundle.discoveryComplete !== false &&
          !lmsBundle.discoveryError &&
          failedClasses.length === 0 &&
          runWarnings.length === 0 &&
          targetMetaList.length > 0 &&
          !progressState.stopAfterCurrentRequested
        ) {
          adminCenterRepo.clearCenterClassesNotIn(
            centerCode,
            targetMetaList.map((c) => c.classCode)
          );
        }

        adminCenterRepo.updateScanRun(runId, {
          status: finalRunStatus,
          totalClasses: progressState.totalClasses,
          scannedClasses: scannedCount,
          failedClassesJson: JSON.stringify(failedClasses),
          finishedAt: new Date().toISOString(),
        });

        jobLogRepo.add({
          jobId: runId,
          jobType: "CUSTOM",
          classId: singleClassCode || centerCode,
          level: finalRunStatus === "COMPLETED" ? "SUCCESS" : "WARN",
          message: redactSecrets(
            `Admin Center (${centerCode}, ${scope}): đã quét ${scannedCount}/${progressState.totalClasses} lớp (${finalRunStatus}, lỗi=${failedClasses.length}).`
          ),
        });

        const overview = buildAdminOverviewResponse({
          includeMakeup,
          centerCode,
          makeupRecords: teachingOverview.makeupRows,
        });

        return {
          success: finalRunStatus === "COMPLETED",
          runId,
          status: finalRunStatus,
          scannedCount,
          failedClasses,
          ...(runWarnings.length > 0 ? { warnings: runWarnings } : {}),
          ...(finalRunStatus !== "COMPLETED"
            ? {
                error: redactSecrets(
                  failedClasses[0]?.error ||
                    runWarnings[0] ||
                    `Quá trình quét kết thúc với trạng thái ${finalRunStatus}.`
                ),
              }
            : {}),
          overview,
        };
      } catch (err: any) {
        const errMsg = sanitizeErrorMessage(err);
        const isStopped = /QUEUE_STOPPED|TASK_CANCELLED/i.test(errMsg);
        finalRunStatus = isStopped ? "STOPPED" : "FAILED";
        progressState.lastError = errMsg;

        adminCenterRepo.updateScanRun(runId, {
          status: finalRunStatus,
          totalClasses: progressState.totalClasses,
          scannedClasses: scannedCount,
          failedClassesJson: JSON.stringify(failedClasses),
          finishedAt: new Date().toISOString(),
        });

        jobLogRepo.add({
          jobId: runId,
          jobType: "CUSTOM",
          classId: singleClassCode || centerCode,
          level: "ERROR",
          message: redactSecrets(`Admin Center (${centerCode}, ${scope}) lỗi: ${errMsg}`),
        });

        const overview = buildAdminOverviewResponse({
          includeMakeup,
          centerCode,
        });

        return {
          success: false,
          runId,
          status: finalRunStatus,
          scannedCount,
          failedClasses,
          ...(runWarnings.length > 0 ? { warnings: runWarnings } : {}),
          overview,
          error: errMsg,
        };
      } finally {
        progressState.isRunning = false;
        progressState.currentClassCode = null;
        progressState.finishedAt = new Date().toISOString();
      }
      },
    });
  } catch (enqueueErr: any) {
    const errMsg = sanitizeErrorMessage(enqueueErr);
    const isStopped = /QUEUE_STOPPED|TASK_CANCELLED/i.test(errMsg);
    progressState.lastError = errMsg;
    if (scanRunCreated) {
      try {
        adminCenterRepo.updateScanRun(runId, {
          status: isStopped ? "STOPPED" : "FAILED",
          totalClasses: progressState.totalClasses,
          scannedClasses: progressState.scannedClasses,
          failedClassesJson: JSON.stringify([]),
          finishedAt: new Date().toISOString(),
        });
      } catch {
        // Ignore follow-up DB update errors so finally always releases progressState.isRunning
      }
    }
    throw new Error(errMsg);
  } finally {
    progressState.isRunning = false;
    progressState.currentClassCode = null;
    progressState.finishedAt = progressState.finishedAt || new Date().toISOString();
  }
}
