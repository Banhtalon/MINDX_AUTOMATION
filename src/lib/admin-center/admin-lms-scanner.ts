import crypto from "node:crypto";
import type { Page } from "playwright";
import { config, getDynamicAdminConfig } from "../config";
import {
  adminCenterRepo,
  isRoboticsClassCode,
  jobLogRepo,
  normalizeDateToIsoYmd,
  type AdminCenterClassRecord,
  type StudentRecord,
} from "../db/sqlite";
import { buildLmsClassCommentsUrl, isValidLmsClassCode } from "../lms/lms-class-url";
import { authService } from "../playwright/auth";
import { LmsHelpers } from "../playwright/lms-helpers";
import { createNetworkInterceptor } from "../playwright/network-interceptor";
import { ScoreScraper } from "../playwright/scrape-scores";
import { SELECTORS } from "../playwright/selectors";
import type { RemoteTeachingScoreRow } from "../playwright/teaching-report-card-sync";
import { redactSecrets, sanitizeErrorMessage } from "../security/secret-redactor";
import {
  isConfirmedRunningStatus,
  isFinishedClassWithinGraceWindow,
  ONE_DAY_MS,
  parseClassDateToEndOfDayMs,
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
  AdminWeeklyOpsSummary,
} from "./admin-types";

export type AdminScanScope =
  | "ALL"
  | "CODING_ONLY"
  | "SINGLE_CLASS"
  | "TEACHING_ONLY";

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
  if (!params.eligibleGt9 && !hasProject) {
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
  teachingScheduleEntry?: TeachingScheduleClassEntry | null;
  teachingCheckRows?: TeachingCheckNhanXetEntry[];
  teachingDetail?: TeachingPerClassDetail | null;
  teachingMakeupRows?: TeachingHocBuEntry[];
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
    normalizeDateToIsoYmd(clsData?.startDate || input.rawClassMeta.startDate) ||
    String(clsData?.startDate || input.rawClassMeta.startDate || "").trim();
  const endDate =
    normalizeDateToIsoYmd(clsData?.endDate || input.rawClassMeta.endDate) ||
    String(clsData?.endDate || input.rawClassMeta.endDate || "").trim();

  const blockType: AdminBlockType =
    input.teachingScheduleEntry?.blockType === "ROBOTICS" ||
    isRoboticsClassCode(classCode) ||
    /robotics|robo\b/i.test(courseName)
      ? "ROBOTICS"
      : "CODING";

  // Extract main & assistant teachers from LMS teachers list or fallback to Teaching schedule/check
  let mainTeacher = String(input.rawClassMeta.mainTeacher || "").trim();
  let assistantTeacher = String(input.rawClassMeta.assistantTeacher || "").trim();
  const lmsTeachers: any[] = Array.isArray(clsData?.teachers)
    ? clsData.teachers
    : [];
  for (const t of lmsTeachers) {
    const tName = String(
      t?.teacher?.fullName || t?.fullName || t?.teacher?.username || ""
    ).trim();
    const roleName = String(t?.role?.name || t?.role || "").toLowerCase();
    if (!tName) continue;
    if (roleName.includes("ta") || roleName.includes("assistant") || roleName.includes("trợ")) {
      if (!assistantTeacher) assistantTeacher = tName;
    } else if (!mainTeacher) {
      mainTeacher = tName;
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
    const slotMs = parseSlotTimeMs(s?.date || s?.startTime);
    const slotDatePassed = slotMs !== null && slotMs <= nowMs + ONE_DAY_MS * 0.25;
    if (hasAttendanceActivity || slotDatePassed || stripHtmlPlain(s?.summary).length > 0) {
      latestOccurredIdx = i;
    }
  }

  const teachingSessNum = Number(input.teachingScheduleEntry?.sessionNumber || 0);
  const currentSessionNumber = Math.max(
    latestOccurredIdx >= 0 ? latestOccurredIdx + 1 : 0,
    teachingSessNum
  );
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
  const hasHomeworkText = stripHtmlPlain(evalSlot?.homework).length > 0;
  const hasSummaryAndHomework =
    Boolean(evalSlot) &&
    hasSummaryText &&
    (evaluatedSessionNumber >= 14 || hasHomeworkText);

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

  // Checkpoint Alert (Coding: Buổi 5, 9, 14; Robotics: Buổi 4, 8, 14)
  const cp1Session = blockType === "ROBOTICS" ? 4 : 5;
  const cp2Session = blockType === "ROBOTICS" ? 8 : 9;
  let checkpointAlert: AdminWeeklyOpsSummary["checkpointAlert"] = null;

  const checkMilestoneMissingCount = (milestone: "CP1" | "CP2" | "DEMO"): number => {
    if (!computedReportCard) return 0;
    let missing = 0;
    for (const s of computedReportCard.students) {
      if (!s.isActive) continue;
      if (milestone === "CP1") {
        if (s.cp1.theory.value === null && s.cp1.practice.value === null) missing++;
      } else if (milestone === "CP2") {
        if (s.cp2.theory.value === null && s.cp2.practice.value === null) missing++;
      } else {
        if (s.final.product.value === null) missing++;
      }
    }
    return missing;
  };

  if (currentSessionNumber >= 14) {
    const m = checkMilestoneMissingCount("DEMO");
    if (m > 0) {
      checkpointAlert = {
        milestone: "DEMO",
        sessionNumber: 14,
        missingScoreCount: m,
        message: `Buổi 14 (DEMO): còn ${m} HV chưa có điểm sản phẩm cuối khóa`,
      };
    }
  } else if (currentSessionNumber >= cp2Session) {
    const m = checkMilestoneMissingCount("CP2");
    if (m > 0) {
      checkpointAlert = {
        milestone: "CP2",
        sessionNumber: cp2Session,
        missingScoreCount: m,
        message: `Buổi ${cp2Session} (CP2): còn ${m} HV thiếu điểm Check-point 2`,
      };
    }
  } else if (currentSessionNumber >= cp1Session) {
    const m = checkMilestoneMissingCount("CP1");
    if (m > 0) {
      checkpointAlert = {
        milestone: "CP1",
        sessionNumber: cp1Session,
        missingScoreCount: m,
        message: `Buổi ${cp1Session} (CP1): còn ${m} HV thiếu điểm Check-point 1`,
      };
    }
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
          notSubmittedCellsCount++;
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
          notSubmittedCellsCount++;
        }
      }

      if (
        lesson.sessionNumber < currentSessionNumber ||
        lessonSubmittedOrGraded > 0 ||
        latestHomeworkSessionNumber === 0
      ) {
        latestHomeworkSessionNumber = lesson.sessionNumber;
        latestSubmittedCount = lessonSubmittedOrGraded;
      }
    }

    const expectedCount = activeCount;
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
  // TAB 3: SPCK Audit (Buổi 12, 13, 14 & Finished)
  // ========================================================
  const isFinishedClass = /finish|completed|done/i.test(status);
  const spckApplicable = currentSessionNumber >= 12 || isFinishedClass;
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
    demoScoredCount: 0,
    competencyCompleteCount: 0,
    mindx3PartCommentCount: 0,
    missingEvalStudents: [],
  };

  if (spckApplicable) {
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
          const hasThumbnailObjOrStr = Boolean(
            (typeof latest?.thumbnail === "string" && latest.thumbnail.trim()) ||
              (latest?.thumbnail &&
                typeof latest.thumbnail === "object" &&
                Boolean(latest.thumbnail.url || latest.thumbnail.path || latest.thumbnail.name))
          );
          const hasImageOrLink = Boolean(
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

          if (!hasImageOrLink) {
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

    // Session 14 final evaluation & 3-part MindX comment check
    const slot14 = slots[13];
    if (currentSessionNumber >= 14 || isFinishedClass || Boolean(slot14)) {
      session14FinalEval.applicable = currentSessionNumber >= 14 || isFinishedClass;
      if (session14FinalEval.applicable) {
        session14FinalEval.requiredCount = activeLmsStudents.length;
        const att14ById = new Map<string, any>();
        for (const att of slot14?.studentAttendance || []) {
          const sid = String(att?.student?.id || att?.studentId || "").trim();
          if (sid) att14ById.set(sid, att);
        }

        const rcById = new Map(
          (computedReportCard?.students || []).map((s) => [s.studentId, s])
        );

        for (const stu of activeLmsStudents) {
          const rcStu = rcById.get(stu.id);
          const hasDemoScore =
            rcStu?.final?.product?.value !== null &&
            rcStu?.final?.product?.value !== undefined;
          const att14 = att14ById.get(stu.id);
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
          const hasAllNineCompetency = Math.max(rateCount, evalCriteriaCount) >= 9;
          const hasCompetency =
            hasAllNineCompetency &&
            rcStu?.final?.competency?.value !== null &&
            rcStu?.final?.competency?.value !== undefined;
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
          const has3Part = hasThreePartMindxComment(combinedS14Comment);

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
  // TAB 4: > Buổi 9 SPCK Tasks on Teaching
  // ========================================================
  const eligibleGt9 =
    currentSessionNumber >= 10 && !isFinishedClass && isConfirmedRunningStatus(status);
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
      (l) => currentSessionNumber <= 1 || l.sessionNumber <= currentSessionNumber - 1
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

  // 5e. Makeup debt (hocbu.php)
  for (const m of input.teachingMakeupRows || []) {
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
    specialEvent: input.teachingScheduleEntry?.specialEvent || "",
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
  const defaultTasks: AdminSpckTeachingTasksSummary = {
    eligibleGt9: row.currentSessionNumber >= 10 && isConfirmedRunningStatus(row.status),
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
      row.currentSessionNumber >= 10 && isConfirmedRunningStatus(row.status)
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

  const rawRows = adminCenterRepo.listClasses({ centerCode, includeMakeup });
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
      Boolean(c.weeklyOps.checkpointAlert);
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
        studentAttendance {
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

function buildLmsGqlCaptureListener(state: {
  capturedHeaders: Record<string, string>;
  capturedGetClassQuery: string;
  capturedSubmissionQuery: string;
  capturedSubmissionVars: any;
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
        if (h?.authorization || h?.Authorization) {
          state.capturedHeaders = h;
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
      }
    } catch {
      // ignore malformed request
    }
  };
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
  classCode: string
): Promise<{
  lmsClassId: string;
  classByIdData: any | null;
  submissionGqlData: any | null;
  studentWorks: any[];
}> {
  const captureState = {
    capturedHeaders: {} as Record<string, string>,
    capturedGetClassQuery: "",
    capturedSubmissionQuery: "",
    capturedSubmissionVars: null as any,
  };
  const reqListener = buildLmsGqlCaptureListener(captureState);

  page.on("request", reqListener);
  try {
    const targetUrl = buildLmsClassCommentsUrl({
      lmsBaseUrl: config.lmsUrl,
      classCode,
      tab: 3,
    });
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
    const interceptor = createNetworkInterceptor(page);
    await interceptor.dismissForbiddenToast();

    await LmsHelpers.openClassDrawer(page, classCode);
    await LmsHelpers.switchDrawerTab(page, SELECTORS.tabs.grading);
    await page.waitForTimeout(1500);

    await page.evaluate("window.__name = window.__name || function(f){ return f; }").catch(() => {});
    const res = await page.evaluate(
      async ({
        clsCode,
        hdrs,
        getClassQ,
        getClassMinQ,
        subQ,
        subLegacyQ,
        subVarsTemplate,
        classesQ,
        minClassesQ,
        worksQ,
        worksMinQ,
        isRobotics,
      }: any) => {
        const headers: Record<string, string> = {
          "content-type": "application/json",
        };
        for (const [k, v] of Object.entries(hdrs || {})) {
          const kl = k.toLowerCase();
          if (kl === "authorization" || kl.startsWith("x-") || kl.startsWith("apollo-")) {
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

        let listRes = await gql(classesQ, { text: clsCode, pageIndex: 0, itemsPerPage: 20 });
        if (
          ((Array.isArray(listRes?.errors) && listRes.errors.length > 0) ||
            !Array.isArray(listRes?.data?.classes?.data)) &&
          minClassesQ
        ) {
          listRes = await gql(minClassesQ, { text: clsCode });
        }
        if (
          (Array.isArray(listRes?.errors) && listRes.errors.length > 0) ||
          !Array.isArray(listRes?.data?.classes?.data)
        ) {
          return {
            lmsClassId: "",
            classByIdData: null,
            submissionGqlData: null,
            studentWorks: [],
            err:
              (Array.isArray(listRes?.errors) && listRes.errors[0]?.message) ||
              "Không đọc được danh sách lớp từ LMS GraphQL.",
          };
        }

        const list = listRes?.data?.classes?.data || [];
        const matched = list.find(
          (c: any) => String(c?.name || "").trim().toUpperCase() === clsCode
        );
        const lmsId = String(matched?.id || "").trim();
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
        let clsByIdRes = await gql(getClassQ, { id: lmsId }, "GetClassById");
        if (
          ((Array.isArray(clsByIdRes?.errors) && clsByIdRes.errors.length > 0) ||
            !extractCls(clsByIdRes)) &&
          getClassMinQ
        ) {
          clsByIdRes = await gql(getClassMinQ, { id: lmsId }, "GetClassByIdMinimal");
        }
        const resolvedClsPayload = extractCls(clsByIdRes);
        if (
          (Array.isArray(clsByIdRes?.errors) && clsByIdRes.errors.length > 0) ||
          !resolvedClsPayload
        ) {
          return {
            lmsClassId: lmsId,
            classByIdData: null,
            submissionGqlData: null,
            studentWorks: [],
            err:
              (Array.isArray(clsByIdRes?.errors) && clsByIdRes.errors[0]?.message) ||
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
        hdrs: captureState.capturedHeaders,
        getClassQ: captureState.capturedGetClassQuery || FALLBACK_GET_CLASS_BY_ID_QUERY,
        getClassMinQ: FALLBACK_GET_CLASS_BY_ID_MINIMAL_QUERY,
        subQ: captureState.capturedSubmissionQuery || FALLBACK_SUBMISSION_QUERY,
        subLegacyQ: FALLBACK_SUBMISSION_LEGACY_QUERY,
        subVarsTemplate: captureState.capturedSubmissionVars,
        classesQ: FALLBACK_CLASSES_QUERY,
        minClassesQ: MINIMAL_CLASSES_QUERY,
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

        // 2. LMS GraphQL scan inside Single Persistent Context + Admin Role Swap (or injected mock bundle in tests)
        let lmsBundle: AdminLmsFetchedBundle;
        if (options?.lmsBundleOverride) {
          lmsBundle = options.lmsBundleOverride;
        } else {
          lmsBundle = await authService.withAdminLmsSession(async (page) => {
            const interceptor = createNetworkInterceptor(page);
            const captureState = {
              capturedHeaders: {} as Record<string, string>,
              capturedGetClassQuery: "",
              capturedSubmissionQuery: "",
              capturedSubmissionVars: null as any,
            };
            const reqListener = buildLmsGqlCaptureListener(captureState);

            page.on("request", reqListener);
            try {
              const classesUrl = `${config.lmsUrl.replace(/\/$/, "")}/admin/classes`;
              await page.goto(classesUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
              await page.waitForTimeout(1800);
              await interceptor.dismissForbiddenToast();

              if (!captureState.capturedHeaders.authorization && !captureState.capturedHeaders.Authorization) {
                await page.reload({ waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
                await page.waitForTimeout(2000);
              }

              await page
                .evaluate("window.__name = window.__name || function(f){ return f; }")
                .catch(() => {});

              // Step 2a: Discover campus classes via GraphQL pagination (strict completeness check)
              const discoveryResult = await page.evaluate(
                async ({ hdrs, cCode, clsQuery, minClsQuery }: any) => {
                  const headers: Record<string, string> = {
                    "content-type": "application/json",
                  };
                  for (const [k, v] of Object.entries(hdrs || {})) {
                    const kl = k.toLowerCase();
                    if (
                      kl === "authorization" ||
                      kl.startsWith("x-") ||
                      kl.startsWith("apollo-")
                    ) {
                      headers[k] = String(v);
                    }
                  }
                  const collected: any[] = [];
                  let expectedTotal: number | null = null;
                  let complete = true;
                  let errorMsg = "";

                  for (let pageIdx = 0; pageIdx < 25; pageIdx++) {
                    const r = await fetch("https://lms-api.mindx.edu.vn/", {
                      method: "POST",
                      headers,
                      body: JSON.stringify({
                        query: clsQuery,
                        variables: {
                          text: cCode,
                          pageIndex: pageIdx,
                          itemsPerPage: 100,
                        },
                      }),
                    });
                    if (!r.ok) {
                      complete = false;
                      errorMsg = `LMS GraphQL HTTP ${r.status} ở trang ${pageIdx + 1}`;
                      break;
                    }
                    const json = await r.json().catch(() => null);
                    if (!json || typeof json !== "object") {
                      complete = false;
                      errorMsg = `Phản hồi danh sách lớp trang ${pageIdx + 1} không hợp lệ.`;
                      break;
                    }
                    if (Array.isArray(json?.errors) && json.errors.length > 0) {
                      if (pageIdx === 0 && minClsQuery) {
                        const rMin = await fetch("https://lms-api.mindx.edu.vn/", {
                          method: "POST",
                          headers,
                          body: JSON.stringify({
                            query: minClsQuery,
                            variables: { text: cCode },
                          }),
                        });
                        if (!rMin.ok) {
                          complete = false;
                          errorMsg = `LMS GraphQL minimal HTTP ${rMin.status}`;
                          break;
                        }
                        const jsonMin = await rMin.json().catch(() => null);
                        if (Array.isArray(jsonMin?.errors) && jsonMin.errors.length > 0) {
                          complete = false;
                          errorMsg = String(jsonMin.errors[0]?.message || "GraphQL minimal error");
                          break;
                        }
                        const minData = jsonMin?.data?.classes?.data;
                        if (!Array.isArray(minData)) {
                          complete = false;
                          errorMsg = "GraphQL minimal không trả về mảng lớp.";
                          break;
                        }
                        collected.push(...minData);
                        if (minData.length >= 100) {
                          complete = false;
                          errorMsg = "Truy vấn tối giản chạm giới hạn 100 lớp nên chưa xác minh đủ.";
                        }
                        break;
                      }
                      complete = false;
                      errorMsg = String(json.errors[0]?.message || `GraphQL error ở trang ${pageIdx + 1}`);
                      break;
                    }

                    const conn = json?.data?.classes;
                    const data = conn?.data;
                    if (!Array.isArray(data)) {
                      complete = false;
                      errorMsg = `Dữ liệu classes.data ở trang ${pageIdx + 1} không hợp lệ.`;
                      break;
                    }
                    const pageTotal = Number(conn?.pagination?.total ?? NaN);
                    if (Number.isFinite(pageTotal) && pageTotal >= 0) {
                      expectedTotal = pageTotal;
                    }
                    collected.push(...data);
                    if (data.length === 0) {
                      if (expectedTotal !== null && collected.length < expectedTotal) {
                        complete = false;
                        errorMsg = `Danh sách lớp thiếu: ${collected.length}/${expectedTotal}`;
                      }
                      break;
                    }
                    if (expectedTotal !== null && collected.length >= expectedTotal) {
                      break;
                    }
                    if (expectedTotal === null && data.length < 100) {
                      break;
                    }
                    if (pageIdx === 24 && (expectedTotal === null || collected.length < expectedTotal)) {
                      complete = false;
                      errorMsg = `Danh sách lớp vượt quá 25 trang (${collected.length}/${expectedTotal ?? "?"}).`;
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
                  hdrs: captureState.capturedHeaders,
                  cCode: singleClassCode || centerCode,
                  clsQuery: FALLBACK_CLASSES_QUERY,
                  minClsQuery: MINIMAL_CLASSES_QUERY,
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
                    startDate: String(c?.startDate || "").trim(),
                    endDate: String(c?.endDate || "").trim(),
                    mainTeacher: mainT,
                    assistantTeacher: taT,
                  };
                })
                .filter((c: any) => {
                  if (!c.classCode || !c.lmsClassId) return false;
                  if (singleClassCode) return c.classCode === singleClassCode;
                  const isRunning = isConfirmedRunningStatus(c.status);
                  const isRecentFinished =
                    String(c.status || "").toUpperCase().includes("FINISH") &&
                    isFinishedClassWithinGraceWindow(
                      c.classCode,
                      c.endDate,
                      14,
                      nowMs
                    ).withinWindow;
                  if (!isRunning && !isRecentFinished) return false;
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
                  await LmsHelpers.switchDrawerTab(page, SELECTORS.tabs.grading).catch(() => {});
                  await page.waitForTimeout(1500);
                } catch {
                  // ignore seed capture timeout; fallback GraphQL queries remain ready
                }
              }

              const perClass = new Map<
                string,
                {
                  classByIdData: any | null;
                  submissionGqlData: any | null;
                  studentWorks: any[];
                  error?: string;
                  subError?: string;
                  worksError?: string;
                }
              >();

              let stoppedEarly = false;
              for (const item of targetList) {
                ensureQueueNotStopped();
                if (progressState.stopAfterCurrentRequested) {
                  stoppedEarly = true;
                  break;
                }
                progressState.currentClassCode = item.classCode;
                const isRob = isRoboticsClassCode(item.classCode);

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
                      subQ,
                      subLegacyQ,
                      subVarsTemplate,
                      worksQ,
                      worksMinQ,
                      includeSubmissions,
                    }: any) => {
                      const headers: Record<string, string> = {
                        "content-type": "application/json",
                      };
                      for (const [k, v] of Object.entries(hdrs || {})) {
                        const kl = k.toLowerCase();
                        if (
                          kl === "authorization" ||
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
                      let clsByIdRes = await gql(
                        getClassQ,
                        { id: lmsId },
                        "GetClassById"
                      );
                      if (
                        ((Array.isArray(clsByIdRes?.errors) && clsByIdRes.errors.length > 0) ||
                          !extractCls(clsByIdRes)) &&
                        getClassMinQ
                      ) {
                        clsByIdRes = await gql(
                          getClassMinQ,
                          { id: lmsId },
                          "GetClassByIdMinimal"
                        );
                      }
                      const clsPayload = extractCls(clsByIdRes);
                      const clsErr =
                        Array.isArray(clsByIdRes?.errors) && clsByIdRes.errors.length > 0
                          ? String(clsByIdRes.errors[0]?.message || "GraphQL error")
                          : !clsPayload
                          ? "Không đọc được chi tiết lớp từ LMS GraphQL."
                          : "";
                      if (clsErr) {
                        return {
                          classByIdData: null,
                          submissionGqlData: null,
                          studentWorks: [],
                          err: clsErr,
                          subError: "",
                          worksError: "",
                        };
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
                      }

                      return {
                        classByIdData: clsPayload,
                        submissionGqlData,
                        studentWorks,
                        err: "",
                        subError,
                        worksError,
                      };
                    },
                    {
                      lmsId: item.lmsClassId,
                      hdrs: captureState.capturedHeaders,
                      getClassQ:
                        captureState.capturedGetClassQuery || FALLBACK_GET_CLASS_BY_ID_QUERY,
                      getClassMinQ: FALLBACK_GET_CLASS_BY_ID_MINIMAL_QUERY,
                      subQ:
                        captureState.capturedSubmissionQuery || FALLBACK_SUBMISSION_QUERY,
                      subLegacyQ: FALLBACK_SUBMISSION_LEGACY_QUERY,
                      subVarsTemplate: captureState.capturedSubmissionVars,
                      worksQ: FIND_ALL_STUDENT_WORKS_QUERY,
                      worksMinQ: FIND_ALL_STUDENT_WORKS_MINIMAL_QUERY,
                      includeSubmissions: !isRob,
                    }
                  );

                  if (fetched.err) {
                    throw new Error(fetched.err);
                  }
                  if (fetched.classByIdData) {
                    assertMatchingLmsClassPayload(
                      fetched.classByIdData,
                      item.classCode,
                      item.lmsClassId
                    );
                  } else {
                    throw new Error(`LMS không trả về dữ liệu chi tiết lớp ${item.classCode}.`);
                  }

                  perClass.set(item.classCode, {
                    classByIdData: fetched.classByIdData,
                    submissionGqlData: fetched.submissionGqlData,
                    studentWorks: fetched.studentWorks || [],
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
                discoveredClasses: targetList,
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
          const slotCount = Array.isArray(per?.classByIdData?.slots)
            ? per!.classByIdData.slots.filter((s: any) => {
                const slotMs = parseSlotTimeMs(s?.date || s?.startTime);
                return (
                  (slotMs !== null && slotMs <= Date.now() + ONE_DAY_MS * 0.25) ||
                  (Array.isArray(s?.studentAttendance) &&
                    s.studentAttendance.some(
                      (a: any) => normalizeAttendanceTag(a?.status) !== "UNMARKED"
                    ))
                );
              }).length
            : 0;
          const schedSess =
            teachingOverview.scheduleByClass.get(c.classCode)?.sessionNumber || 0;
          const estSession = Math.max(slotCount, schedSess);
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
            teachingScheduleEntry: teachingOverview.scheduleByClass.get(meta.classCode) || null,
            teachingCheckRows: teachingOverview.checkRowsByClass.get(meta.classCode) || [],
            teachingDetail: tDetail,
            teachingMakeupRows: teachingOverview.makeupByClass.get(meta.classCode) || [],
          });

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
