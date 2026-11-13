import type { Page, Locator } from "playwright";
import { BrowserManager } from "./browser-manager";
import { authService, isLoginHostOrPath, parseUrlParts } from "./auth";
import { LmsHelpers } from "./lms-helpers";
import { SELECTORS } from "./selectors";
import { createNetworkInterceptor } from "./network-interceptor";
import {
  classSessionRepo,
  studentRepo,
  jobLogRepo,
  getDb,
  calculateSha256 as _calculateSha256,
  computeSession14EvalHash as _computeSession14EvalHash,
  session14EvalRepo as _session14EvalRepo,
  type ClassSessionRecord,
  type StudentRecord,
} from "../db/sqlite";
import {
  getCoursesSyllabus,
  getRunningClasses,
  saveRunningClasses,
  saveLmsClassIdMapping as _saveLmsClassIdMapping,
  saveLmsClassIdMappingsBatch as _saveLmsClassIdMappingsBatch,
  type RunningClassItem,
} from "../db/json-config";
import { config } from "../config";
import {
  extractLmsClassIdFromDrawerUrl as _extractLmsClassIdFromDrawerUrl,
  isValidLmsClassCode as _isValidLmsClassCode,
  isValidLmsClassObjectId as _isValidLmsClassObjectId,
} from "../lms/lms-class-url";
import { resolveKnownLmsClassId as _resolveKnownLmsClassId } from "../lms/lms-class-id-store";
import { toVietnameseUpperSlug as _toVietnameseUpperSlug } from "../utils/vietnamese-match";

const toVietnameseUpperSlug =
  typeof _toVietnameseUpperSlug === "function"
    ? _toVietnameseUpperSlug
    : (console as any).__mindxVietnameseMatch?.toVietnameseUpperSlug;

const saveLmsClassIdMapping =
  typeof _saveLmsClassIdMapping === "function" ? _saveLmsClassIdMapping : () => {};
const saveLmsClassIdMappingsBatch =
  typeof _saveLmsClassIdMappingsBatch === "function"
    ? _saveLmsClassIdMappingsBatch
    : () => {};
const extractLmsClassIdFromDrawerUrl =
  typeof _extractLmsClassIdFromDrawerUrl === "function"
    ? _extractLmsClassIdFromDrawerUrl
    : () => null;
const isValidLmsClassCode =
  typeof _isValidLmsClassCode === "function"
    ? _isValidLmsClassCode
    : (raw: unknown) => /^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(String(raw ?? "").trim().toUpperCase());
const isValidLmsClassObjectId =
  typeof _isValidLmsClassObjectId === "function"
    ? _isValidLmsClassObjectId
    : (raw: unknown) => /^[a-zA-Z0-9_-]{8,64}$/.test(String(raw ?? "").trim());
const resolveKnownLmsClassId =
  typeof _resolveKnownLmsClassId === "function"
    ? _resolveKnownLmsClassId
    : () => ({ lmsClassId: null, source: "NONE" as const });

export const FINISHED_CLASS_GRACE_DAYS = 15;
export const DASHBOARD_FINISHED_CLASS_GRACE_DAYS = 7;
export const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Checks whether a Finished class (e.g. `VT-JSB15`, `VT-C4K-PTA12`) has already
 * transitioned to its next-tier Running class (`B -> A/I` or `A -> I`, e.g. `VT-JSA15`, `VT-C4K-PTI12`).
 */
export function isFinishedClassSupersededByRunningSuccessor(
  finishedClassCode: string,
  activeRunningCodes: Iterable<string>
): boolean {
  const code = String(finishedClassCode || "").trim().toUpperCase();
  if (!code) return false;

  const match = code.match(
    /^(.*?(?:^|[-_])(?:JS|PT|CS|S|G|GM|PRE|ARM|SEMI))([BAI])(\d+)((?:[-_].*)?)$/i
  );
  if (!match) return false;

  const prefixTrack = match[1].toUpperCase();
  const tier = match[2].toUpperCase();
  const cohortRaw = match[3];
  const suffix = (match[4] || "").toUpperCase();

  const nextTiers =
    tier === "B" ? ["A", "I"] : tier === "A" ? ["I"] : [];
  if (nextTiers.length === 0) return false;

  const runningSet = new Set<string>();
  for (const r of activeRunningCodes) {
    const norm = String(r || "").trim().toUpperCase();
    if (norm) runningSet.add(norm);
  }
  if (runningSet.size === 0) return false;

  const cohortVariants = Array.from(
    new Set([
      cohortRaw,
      String(Number(cohortRaw)),
      String(Number(cohortRaw)).padStart(2, "0"),
    ])
  );

  for (const nextTier of nextTiers) {
    for (const cNum of cohortVariants) {
      const candidate = `${prefixTrack}${nextTier}${cNum}${suffix}`;
      if (runningSet.has(candidate)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Checks whether a class status string represents an actively running class (`Running` / `Active`).
 */
export function isConfirmedRunningStatus(rawStatus: unknown): boolean {
  const normalized = String(rawStatus ?? "")
    .trim()
    .toUpperCase();
  return normalized === "RUNNING" || normalized === "ACTIVE";
}

/**
 * Parses a date string (`DD/MM/YYYY`, `DD-MM-YYYY`, `YYYY-MM-DD`, `YYYY/MM/DD`, or `DD/MM/YY`)
 * into an end-of-day timestamp (`23:59:59.999` local time).
 */
export function parseClassDateToEndOfDayMs(rawDate?: string | null): number | null {
  const text = String(rawDate || "").trim();
  if (!text || text === "0000-00-00") return null;

  const buildValidatedEndOfDayMs = (year: number, month: number, day: number): number | null => {
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      !Number.isInteger(day) ||
      year < 2020 ||
      year > 2100 ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31
    ) {
      return null;
    }
    const dt = new Date(year, month - 1, day, 23, 59, 59, 999);
    if (
      dt.getFullYear() !== year ||
      dt.getMonth() !== month - 1 ||
      dt.getDate() !== day
    ) {
      return null;
    }
    return dt.getTime();
  };

  // 1. Check anchored/word-bounded YYYY-MM-DD or YYYY/MM/DD first so 4-digit year prefix is never misread as 2-digit day
  const ymd = text.match(/(?:^|\b)(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\b|$)/);
  if (ymd) {
    const year = parseInt(ymd[1], 10);
    const month = parseInt(ymd[2], 10);
    const day = parseInt(ymd[3], 10);
    return buildValidatedEndOfDayMs(year, month, day);
  }

  // 2. Check anchored/word-bounded DD/MM/YYYY, DD-MM-YYYY, or DD/MM/YY
  const dmy = text.match(/(?:^|\b)(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})(?:\b|$)/);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const month = parseInt(dmy[2], 10);
    const yearRaw = dmy[3];
    const year = yearRaw.length === 2 ? 2000 + parseInt(yearRaw, 10) : parseInt(yearRaw, 10);
    return buildValidatedEndOfDayMs(year, month, day);
  }

  return null;
}

export function formatMsToDdMmYyyy(ms: number): string {
  const d = new Date(ms);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear());
  return `${day}/${month}/${year}`;
}

/**
 * Parses either an ISO datetime string (e.g. `2026-11-07T10:00:00.000Z` from `GetClassById.slots`)
 * or a standard class date string (`DD/MM/YYYY`, `YYYY-MM-DD`, etc.) into local end-of-day (`23:59:59.999`).
 */
export function parseSlotOrClassDateToEndOfDayMs(rawDate?: string | null): number | null {
  const text = String(rawDate || "").trim();
  if (!text || text === "0000-00-00") return null;

  if (/^\d{4}-\d{1,2}-\d{1,2}T/i.test(text)) {
    const ts = Date.parse(text);
    if (Number.isFinite(ts)) {
      const dt = new Date(ts);
      const year = dt.getFullYear();
      if (year >= 2020 && year <= 2100) {
        return new Date(year, dt.getMonth(), dt.getDate(), 23, 59, 59, 999).getTime();
      }
    }
  }

  return parseClassDateToEndOfDayMs(text);
}

/**
 * Enriches scraped class sessions with dates from `GetClassById.slots` and weekly `+7 days` progression
 * up to today (`<= todayEndOfDayMs`), advancing `latestActiveSessionId` when a session falls on today
 * even if MindX LMS still keeps the slot `.disabled` before the class's scheduled hour starts.
 */
export function enrichClassSessionsWithScheduleDates(params: {
  classCode: string;
  sessions: ClassSessionRecord[];
  latestActiveSessionId: string;
  slots?: any[] | null;
  nowMs?: number;
}): { latestActiveSessionId: string } {
  const { classCode, sessions, slots } = params;
  let latestActiveSessionId = params.latestActiveSessionId;
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return { latestActiveSessionId };
  }

  const nowMs = params.nowMs ?? Date.now();
  const todayDmy = formatMsToDdMmYyyy(nowMs);
  const todayEndOfDayMs = parseClassDateToEndOfDayMs(todayDmy) ?? nowMs;

  const slotEndMsBySession = new Map<number, number>();
  if (Array.isArray(slots)) {
    for (let idx = 0; idx < slots.length; idx++) {
      const sl = slots[idx];
      if (!sl || typeof sl !== "object") continue;
      const sessNum = typeof sl.index === "number" ? sl.index + 1 : idx + 1;
      const rawSlotDate = sl.startTime || sl.date || sl.startDate;
      if (!rawSlotDate) continue;
      const ms = parseSlotOrClassDateToEndOfDayMs(String(rawSlotDate));
      if (ms !== null) {
        slotEndMsBySession.set(sessNum, ms);
      }
    }
  }

  // 1. Fill dates for any session where GetClassById.slots provides a date <= todayEndOfDayMs
  for (const s of sessions) {
    const sessNum = Number(s.sessionNumber) || 0;
    const slotMs = slotEndMsBySession.get(sessNum);
    if (slotMs !== undefined && slotMs <= todayEndOfDayMs && !s.date) {
      s.date = formatMsToDdMmYyyy(slotMs);
    }
  }

  // 2. Also ensure the DOM-selected active session has a date if GetClassById.slots or startDate provides it
  const domActiveSession = sessions.find((s) => s.sessionId === latestActiveSessionId);
  if (domActiveSession && !domActiveSession.date) {
    const sessNum = Number(domActiveSession.sessionNumber) || 0;
    const slotMs = slotEndMsBySession.get(sessNum);
    if (slotMs !== undefined) {
      domActiveSession.date = formatMsToDdMmYyyy(slotMs);
    } else if (sessNum === 1) {
      try {
        const rangeInfo = resolveClassDateRangeInfo(classCode);
        const startEndMs = parseClassDateToEndOfDayMs(rangeInfo.startDateDmy);
        if (startEndMs !== null && startEndMs <= todayEndOfDayMs) {
          domActiveSession.date = formatMsToDdMmYyyy(startEndMs);
        }
      } catch {}
    }
  }

  // 3. Find the highest session currently having a valid date <= todayEndOfDayMs as our schedule anchor
  let anchorSession: ClassSessionRecord | null = null;
  let anchorEndMs: number | null = null;
  for (const s of sessions) {
    if (!s.date) continue;
    const ms = parseClassDateToEndOfDayMs(s.date);
    if (ms !== null && ms <= todayEndOfDayMs) {
      if (
        !anchorSession ||
        Number(s.sessionNumber) >= Number(anchorSession.sessionNumber)
      ) {
        anchorSession = s;
        anchorEndMs = ms;
      }
    }
  }

  // 4. From anchorSession, backfill past sessions (1..anchor-1) and advance to today's session (anchor+1..14)
  // if its weekly +7 days schedule falls in the current week up to today (<= todayEndOfDayMs)
  if (anchorSession && anchorEndMs !== null) {
    const anchorNum = Number(anchorSession.sessionNumber) || 0;
    for (const s of sessions) {
      const sessNum = Number(s.sessionNumber) || 0;
      if (sessNum < 1 || sessNum > 14 || sessNum === anchorNum) continue;

      if (sessNum < anchorNum) {
        if (!s.date) {
          const prevMs = anchorEndMs - (anchorNum - sessNum) * 7 * ONE_DAY_MS;
          s.date = formatMsToDdMmYyyy(prevMs);
        }
      } else if (sessNum > anchorNum) {
        const explicitSlotMs = slotEndMsBySession.get(sessNum);
        if (explicitSlotMs !== undefined) {
          if (explicitSlotMs <= todayEndOfDayMs && !s.date) {
            s.date = formatMsToDdMmYyyy(explicitSlotMs);
          } else if (explicitSlotMs > todayEndOfDayMs) {
            Object.defineProperty(s, "_scheduledFutureDate", {
              value: formatMsToDdMmYyyy(explicitSlotMs),
              enumerable: false,
              configurable: true,
              writable: true,
            });
          }
          continue;
        }
        const projectedMs = anchorEndMs + (sessNum - anchorNum) * 7 * ONE_DAY_MS;
        if (
          projectedMs <= todayEndOfDayMs &&
          todayEndOfDayMs - projectedMs < 7 * ONE_DAY_MS &&
          !s.date
        ) {
          s.date = formatMsToDdMmYyyy(projectedMs);
        }
      }
    }
  }

  // 5. Update latestActiveSessionId to the highest session whose date is <= todayEndOfDayMs
  let highestDatedSession: ClassSessionRecord | null = null;
  for (const s of sessions) {
    if (!s.date) continue;
    const ms = parseClassDateToEndOfDayMs(s.date);
    if (ms !== null && ms <= todayEndOfDayMs) {
      if (
        !highestDatedSession ||
        Number(s.sessionNumber) >= Number(highestDatedSession.sessionNumber)
      ) {
        highestDatedSession = s;
      }
    }
  }
  if (highestDatedSession) {
    latestActiveSessionId = highestDatedSession.sessionId;
  }

  return { latestActiveSessionId };
}

/**
 * Verifies that a network request is specifically a MindX LMS class-list / class-search request
 * for the exact `targetClassCode` (never a prefix match like `SYNTH-LMS-F11-OTHER` and never an
 * unrelated operation like `GetStudents` or `GetComments`).
 */
export function isLmsClassSearchRequestForCode(
  resUrl: string,
  method: string,
  postData: string,
  targetClassCode: string
): boolean {
  if (String(method || "").toUpperCase() === "OPTIONS") return false;
  const target = String(targetClassCode || "").trim().toUpperCase();
  if (!target) return false;

  const urlStr = String(resUrl || "");
  const isLmsEndpoint =
    urlStr.includes("lms-api.mindx.edu.vn") ||
    urlStr.includes("graphql") ||
    urlStr.includes("/classes");
  if (!isLmsEndpoint) return false;

  const bodyStr = String(postData || "").trim();
  if (bodyStr) {
    // Reject non-class operations (e.g., GetStudents, GetComments, GetAttendance, GetSlots)
    try {
      const parsed = JSON.parse(bodyStr);
      const opText = `${parsed?.operationName || ""} ${parsed?.query || ""}`;
      if (
        /\b(getstudents|students|getcomments|comments|getslots|slots|attendance|submissions|homework)\b/i.test(
          opText
        ) &&
        !/\b(getclasses|searchclasses|findclasses|classlist)\b/i.test(opText)
      ) {
        return false;
      }
      if (!/\b(getclasses|searchclasses|findclasses|classes|classlist)\b/i.test(opText)) {
        return false;
      }
    } catch {
      if (
        /\b(getstudents|getcomments|getslots|attendance|submissions)\b/i.test(bodyStr) ||
        !/\b(getclasses|searchclasses|findclasses|classes|classlist)\b/i.test(bodyStr)
      ) {
        return false;
      }
    }
  } else {
    // GET request must target a /classes endpoint, not /students or /comments
    if (!/\/classes\b/i.test(urlStr) || /\/(students|comments|slots|attendance)\b/i.test(urlStr)) {
      return false;
    }
  }

  const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exactCodeRegex = new RegExp(`(?<![A-Z0-9_-])${escapedTarget}(?![A-Z0-9_-])`, "i");
  return exactCodeRegex.test(`${urlStr} ${bodyStr}`);
}

export function doesLmsClassSearchPayloadMatchCode(
  payload: unknown,
  targetClassCode: string
): boolean {
  const target = String(targetClassCode || "").trim().toUpperCase();
  if (!target || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }

  const obj = payload as Record<string, any>;
  if (obj.success === false) {
    return false;
  }
  if (Array.isArray(obj.errors) && obj.errors.length > 0) {
    return false;
  }

  const candidates =
    obj?.data?.classes?.data ??
    obj?.data?.classes?.items ??
    obj?.data?.classes?.docs ??
    obj?.data?.classes ??
    obj?.data?.searchClasses?.data ??
    obj?.data?.searchClasses?.items ??
    obj?.data?.searchClasses ??
    obj?.data?.findClasses?.data ??
    obj?.data?.findClasses?.items ??
    obj?.data?.findClasses ??
    obj?.classes?.data ??
    obj?.classes?.items ??
    obj?.classes?.docs ??
    obj?.classes ??
    (Array.isArray(obj?.data) ? obj.data : null);

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return false;
  }

  return candidates.some((item: any) => {
    if (!item || typeof item !== "object") return false;
    const codes = [item.code, item.classCode, item.class_code, item.name]
      .filter((v) => typeof v === "string")
      .map((v: string) => v.trim().toUpperCase());
    return codes.includes(target);
  });
}

/**
 * Extracts the MindX LMS backend `lmsClassId` (e.g. 24-hex ObjectId) for an exact `targetClassCode`
 * from a search/list API JSON payload, preferring an actively `Running` entry when duplicates exist.
 */
export function extractLmsClassIdFromSearchPayload(
  payload: unknown,
  targetClassCode: string
): string | null {
  const target = String(targetClassCode || "").trim().toUpperCase();
  if (!target || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const obj = payload as Record<string, any>;
  if (obj.success === false || (Array.isArray(obj.errors) && obj.errors.length > 0)) {
    return null;
  }

  const candidates =
    obj?.data?.classes?.data ??
    obj?.data?.classes?.items ??
    obj?.data?.classes?.docs ??
    obj?.data?.classes ??
    obj?.data?.getClasses?.data ??
    obj?.data?.getClasses?.items ??
    obj?.data?.getClasses ??
    obj?.data?.searchClasses?.data ??
    obj?.data?.searchClasses?.items ??
    obj?.data?.searchClasses ??
    obj?.data?.findClasses?.data ??
    obj?.data?.findClasses?.items ??
    obj?.data?.findClasses ??
    obj?.classes?.data ??
    obj?.classes?.items ??
    obj?.classes?.docs ??
    obj?.classes ??
    (Array.isArray(obj?.data) ? obj.data : null);

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const matches = candidates.filter((item: any) => {
    if (!item || typeof item !== "object") return false;
    const codes = [item.code, item.classCode, item.class_code, item.name]
      .filter((v) => typeof v === "string")
      .map((v: string) => v.trim().toUpperCase());
    return codes.includes(target);
  });

  if (matches.length === 0) return null;

  const preferred =
    matches.find(
      (item: any) =>
        String(item?.status || "")
          .trim()
          .toLowerCase() === "running"
    ) || matches[0];

  const candidateId = String(
    preferred?.id ??
      preferred?._id ??
      preferred?.classId ??
      preferred?.lmsClassId ??
      ""
  ).trim();

  if (
    !isValidLmsClassObjectId(candidateId) ||
    candidateId.toUpperCase() === target
  ) {
    return null;
  }
  return candidateId;
}

/**
 * Resolves the date of Session 14 (Buổi 14) for a class from SQLite `classes_sessions`
 * or an optional end-date string scraped from the LMS classes table row.
 * If SQLite only has an earlier session date (e.g. Session 12 or 13 from the previous week's sync),
 * estimates Session 14's date by adding `(14 - sessionNumber) * 7` days.
 */
export function resolveClassSession14DateInfo(
  classCode: string,
  rowEndDateHint?: string | null
): {
  session14Date: string;
  session14EndMs: number | null;
  isExactSession14: boolean;
} {
  const normalizedCode = String(classCode || "").trim().toUpperCase();
  if (normalizedCode) {
    try {
      const db = getDb();
      if (typeof (db as any)?.prepare === "function") {
        const rows = (db as any)
          .prepare(
            `SELECT sessionNumber, date FROM classes_sessions
             WHERE classId = ? AND TRIM(COALESCE(date, '')) <> ''
             ORDER BY sessionNumber DESC`
          )
          .all(normalizedCode) as Array<{ sessionNumber: number; date: string }>;

        const s14 = rows.find((r) => Number(r.sessionNumber) === 14);
        if (s14) {
          const ms = parseClassDateToEndOfDayMs(s14.date);
          if (ms !== null) {
            return {
              session14Date: formatMsToDdMmYyyy(ms),
              session14EndMs: ms,
              isExactSession14: true,
            };
          }
        }

        const hintMs = parseClassDateToEndOfDayMs(rowEndDateHint);
        if (hintMs !== null) {
          return {
            session14Date: formatMsToDdMmYyyy(hintMs),
            session14EndMs: hintMs,
            isExactSession14: true,
          };
        }

        if (rows.length > 0) {
          const latest = rows[0];
          const baseMs = parseClassDateToEndOfDayMs(latest.date);
          const sessNum = Number(latest.sessionNumber) || 0;
          if (baseMs !== null && sessNum >= 1 && sessNum < 14) {
            const estMs = baseMs + (14 - sessNum) * 7 * ONE_DAY_MS;
            return {
              session14Date: formatMsToDdMmYyyy(estMs),
              session14EndMs: estMs,
              isExactSession14: false,
            };
          }
        }
      }
    } catch {
      // Ignore DB lookup errors
    }
  }

  const hintMs = parseClassDateToEndOfDayMs(rowEndDateHint);
  if (hintMs !== null) {
    return {
      session14Date: formatMsToDdMmYyyy(hintMs),
      session14EndMs: hintMs,
      isExactSession14: true,
    };
  }

  return {
    session14Date: "",
    session14EndMs: null,
    isExactSession14: false,
  };
}

/**
 * Checks whether a Finished class is within `graceDays` (default 15 days) after its Session 14 date.
 */
export function isFinishedClassWithinGraceWindow(
  classCode: string,
  rowEndDateHint?: string | null,
  graceDays: number = FINISHED_CLASS_GRACE_DAYS,
  nowMs: number = Date.now()
): {
  withinWindow: boolean;
  isKnownDate: boolean;
  session14Date: string;
  daysSinceSession14: number | null;
} {
  const info = resolveClassSession14DateInfo(classCode, rowEndDateHint);
  if (info.session14EndMs === null) {
    return {
      withinWindow: false,
      isKnownDate: false,
      session14Date: "",
      daysSinceSession14: null,
    };
  }
  const diffMs = nowMs - info.session14EndMs;
  const daysSinceSession14 = diffMs / ONE_DAY_MS;
  const withinWindow = diffMs <= graceDays * ONE_DAY_MS && diffMs >= -14 * ONE_DAY_MS;
  return {
    withinWindow,
    isKnownDate: true,
    session14Date: info.session14Date,
    daysSinceSession14,
  };
}

function formatMsToIsoYmd(ms: number): string {
  const d = new Date(ms);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear());
  return `${year}-${month}-${day}`;
}

/**
 * Resolves both Start Date (Buổi 1 / cột Bắt đầu) and End Date (Buổi 14 / cột Kết thúc)
 * for a class from `running_classes.json` or SQLite `classes_sessions`.
 */
export function resolveClassDateRangeInfo(
  classCode: string,
  hints?: { startDateHint?: string | null; endDateHint?: string | null }
): {
  startDateIso: string;
  endDateIso: string;
  startDateDmy: string;
  endDateDmy: string;
  courseName: string;
  source: "LMS_CACHE" | "SQLITE_EXACT" | "SQLITE_ESTIMATED" | "NONE";
} {
  const normalizedCode = String(classCode || "").trim().toUpperCase();
  let startMs: number | null = parseClassDateToEndOfDayMs(hints?.startDateHint);
  let endMs: number | null = parseClassDateToEndOfDayMs(hints?.endDateHint);
  let courseName = "";
  let source: "LMS_CACHE" | "SQLITE_EXACT" | "SQLITE_ESTIMATED" | "NONE" =
    startMs !== null && endMs !== null ? "LMS_CACHE" : "NONE";

  if (normalizedCode) {
    try {
      const running = getRunningClasses();
      const matchedClass = running.find(
        (c) => String(c.classCode || "").trim().toUpperCase() === normalizedCode
      );
      if (matchedClass) {
        if (matchedClass.courseName) courseName = matchedClass.courseName;
        if (startMs === null && matchedClass.startDate) {
          startMs = parseClassDateToEndOfDayMs(matchedClass.startDate);
        }
        if (endMs === null && matchedClass.endDate) {
          endMs = parseClassDateToEndOfDayMs(matchedClass.endDate);
        }
        if (startMs !== null && endMs !== null && source === "NONE") {
          source = "LMS_CACHE";
        }
      }
    } catch {
      // ignore
    }

    try {
      const db = getDb();
      if (typeof (db as any)?.prepare === "function") {
        const rows = (db as any)
          .prepare(
            `SELECT sessionNumber, date, className FROM classes_sessions
             WHERE classId = ? AND TRIM(COALESCE(date, '')) <> ''
             ORDER BY sessionNumber DESC`
          )
          .all(normalizedCode) as Array<{
          sessionNumber: number;
          date: string;
          className?: string;
        }>;

        if (
          !courseName &&
          rows.length > 0 &&
          rows[0].className &&
          rows[0].className !== normalizedCode
        ) {
          courseName = rows[0].className;
        }

        const s1 = rows.find((r) => Number(r.sessionNumber) === 1);
        const s14 = rows.find((r) => Number(r.sessionNumber) === 14);

        if (startMs === null && s1) {
          const ms = parseClassDateToEndOfDayMs(s1.date);
          if (ms !== null) {
            const laterRow = rows.find((r) => Number(r.sessionNumber) > 1);
            const laterMs = laterRow ? parseClassDateToEndOfDayMs(laterRow.date) : null;
            if (laterMs === null || ms <= laterMs) {
              startMs = ms;
            }
          }
        }

        if (endMs === null && s14) {
          const ms = parseClassDateToEndOfDayMs(s14.date);
          if (ms !== null) {
            endMs = ms;
          }
        }

        if (startMs !== null && endMs !== null && source === "NONE") {
          source = "SQLITE_EXACT";
        }

        if ((startMs === null || endMs === null) && rows.length > 0) {
          const anchor = rows[0];
          const anchorMs = parseClassDateToEndOfDayMs(anchor.date);
          const sessNum = Number(anchor.sessionNumber) || 0;
          if (anchorMs !== null && sessNum >= 1 && sessNum <= 14) {
            if (startMs === null) {
              startMs = anchorMs - (sessNum - 1) * 7 * ONE_DAY_MS;
            }
            if (endMs === null) {
              endMs = anchorMs + (14 - sessNum) * 7 * ONE_DAY_MS;
            }
            if (source === "NONE") {
              source = "SQLITE_ESTIMATED";
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  if (startMs === null && endMs !== null) {
    startMs = endMs - 13 * 7 * ONE_DAY_MS;
    if (source === "NONE") source = "SQLITE_ESTIMATED";
  } else if (endMs === null && startMs !== null) {
    endMs = startMs + 13 * 7 * ONE_DAY_MS;
    if (source === "NONE") source = "SQLITE_ESTIMATED";
  }

  return {
    startDateIso: startMs !== null ? formatMsToIsoYmd(startMs) : "",
    endDateIso: endMs !== null ? formatMsToIsoYmd(endMs) : "",
    startDateDmy: startMs !== null ? formatMsToDdMmYyyy(startMs) : "",
    endDateDmy: endMs !== null ? formatMsToDdMmYyyy(endMs) : "",
    courseName,
    source,
  };
}

export interface SyncClassOptions {
  forceFreshDrawer?: boolean;
  syncLmsCompletionStatus?: boolean;
  preferLmsVerified?: boolean;
}

export interface SyncClassResult {
  success: boolean;
  classId: string;
  classCode: string;
  lmsClassId?: string;
  courseName?: string;
  sessionsCount: number;
  studentsCount: number;
  activeStudentsCount: number;
  latestActiveSessionId?: string;
  lmsVerifiedSessionsCount?: number;
  sessions: ClassSessionRecord[];
  students: StudentRecord[];
  error?: string;
}

function stripLmsHtmlToPlainText(rawHtml?: string | null): string {
  return String(rawHtml || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export class ClassSyncer {
  /**
   * Synchronizes class details, schedule/sessions, and student roster from LMS into SQLite.
   * Locked strictly by classCode / classId (normalized to UPPERCASE).
   */
  public static async syncClass(
    rawClassCode: string,
    options?: SyncClassOptions
  ): Promise<SyncClassResult> {
    const classCode = rawClassCode.trim().toUpperCase();
    const shouldSyncCompletion = options?.syncLmsCompletionStatus !== false;
    const preferLmsVerified = options?.preferLmsVerified ?? Boolean(options?.forceFreshDrawer);
    const jobId = `sync_${classCode}_${Date.now()}`;
    jobLogRepo.add({
      jobId,
      jobType: "SYNC_CLASS",
      level: "INFO",
      message: `Bắt đầu đồng bộ dữ liệu lớp ${classCode} từ LMS...`,
    });

    const browserManager = BrowserManager.getInstance();
    const page =
      typeof browserManager.getPage === "function"
        ? await browserManager.getPage()
        : (await browserManager.getContext()).pages()[0] ||
          (await (await browserManager.getContext()).newPage());
    const interceptor = createNetworkInterceptor(page);

    let classByIdGqlData: any = null;
    const freshClassByIdRequests = new Set<any>();
    const pendingClassByIdTasks = new Set<Promise<void>>();
    const canListenNetwork =
      typeof (page as any)?.on === "function" &&
      typeof (page as any)?.off === "function";

    const onRequest = (req: any) => {
      try {
        if (typeof req?.method === "function" && req.method() !== "POST") return;
        const reqBody = req?.postDataJSON?.();
        if (reqBody?.operationName === "GetClassById") {
          freshClassByIdRequests.add(req);
        }
      } catch {}
    };

    const onResponse = async (res: any) => {
      try {
        const resUrl = typeof res?.url === "function" ? res.url() : "";
        const reqObj = typeof res?.request === "function" ? res.request() : null;
        if (!resUrl.includes("mindx.edu.vn") || !reqObj) return;
        if (typeof reqObj.method === "function" && reqObj.method() !== "POST") return;
        let reqBody: any;
        try {
          reqBody = reqObj.postDataJSON?.();
        } catch {
          return;
        }
        if (reqBody?.operationName !== "GetClassById") return;
        if (freshClassByIdRequests.size > 0 && !freshClassByIdRequests.has(reqObj)) return;

        const task = (async () => {
          try {
            const status = typeof res.status === "function" ? res.status() : 200;
            if (status !== 200 && status !== 201) return;
            const resJson = await res.json();
            if (resJson && Array.isArray(resJson.errors) && resJson.errors.length > 0) return;
            const clsPayload =
              resJson?.data?.classesById ||
              resJson?.data?.class ||
              resJson?.data?.getClassById;
            if (!clsPayload || typeof clsPayload !== "object") return;
            const payloadCode = String(
              clsPayload.name || clsPayload.code || clsPayload.classCode || ""
            )
              .trim()
              .toUpperCase();
            if (payloadCode && payloadCode !== classCode) return;
            classByIdGqlData = clsPayload;
          } catch {}
        })();
        pendingClassByIdTasks.add(task);
        try {
          await task;
        } finally {
          pendingClassByIdTasks.delete(task);
        }
      } catch {}
    };

    if (canListenNetwork) {
      (page as any).on("request", onRequest);
      (page as any).on("response", onResponse);
    }

    try {
      // 1. Ensure authenticated on MindX LMS
      await authService.ensureAuthenticated("LMS");

      // 2. Navigate to LMS Classes page if not already there
      const isOnClassesPathname = (rawUrl: string) => {
        const { hostname, pathname } = parseUrlParts(rawUrl);
        if (!hostname) {
          return rawUrl.includes("/class") || rawUrl.includes("/classes");
        }
        return (
          hostname === "lms.mindx.edu.vn" &&
          !isLoginHostOrPath(rawUrl, "lms.mindx.edu.vn") &&
          (pathname.includes("/class") || pathname.includes("/classes"))
        );
      };
      const currentUrl = typeof page.url === "function" ? page.url() : "";
      const currentParts = parseUrlParts(currentUrl);
      if (
        currentUrl &&
        (currentParts.pathname.includes("/dashboard") || !isOnClassesPathname(currentUrl))
      ) {
        jobLogRepo.add({
          jobId,
          jobType: "SYNC_CLASS",
          level: "INFO",
          message: `Điều hướng tới danh sách lớp học LMS...`,
        });
        const sidebarClassesItems = page.locator(
          '[data-testid="sidebar"] :text-is("Classes"), .MuiDrawer-docked :text-is("Classes"), aside :text-is("Classes"), nav :text-is("Classes"), :text-is("Classes"), :text-is("Lớp học")'
        );
        const initialCount = await sidebarClassesItems.count().catch(() => 0);
        if (initialCount > 0) {
          if (initialCount === 1) {
            await sidebarClassesItems.first().click({ force: true }).catch(() => {});
            await page.waitForTimeout(700);
          }
          const afterExpandCount = await sidebarClassesItems.count().catch(() => 0);
          if (afterExpandCount >= 2) {
            await sidebarClassesItems.nth(1).click({ force: true }).catch(() => {});
          } else {
            const classMenu = page
              .locator(
                'a[href*="class"], .ant-menu-item:has-text("Lớp học"), a:has-text("Lớp học"), span:has-text("Lớp học"), [aria-label*="Lớp học"]'
              )
              .first();
            if (await classMenu.isVisible().catch(() => false)) {
              await classMenu.click();
            } else {
              await sidebarClassesItems.first().click({ force: true }).catch(() => {});
            }
          }
          await page.waitForTimeout(2000);
        } else {
          const classMenu = page
            .locator(
              'a[href*="class"], .ant-menu-item:has-text("Lớp học"), a:has-text("Lớp học"), span:has-text("Lớp học"), [aria-label*="Lớp học"]'
            )
            .first();
          if (await classMenu.isVisible().catch(() => false)) {
            await classMenu.click();
            await page.waitForTimeout(2000);
          }
        }
        const afterNavUrl = typeof page.url === "function" ? page.url() : "";
        if (!isOnClassesPathname(afterNavUrl)) {
          await page.goto(`${config.lmsUrl.replace(/\/+$/, "")}/admin/classes`, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          }).catch(() => {});
          await page.waitForTimeout(1500);
        }
      }

      await interceptor.dismissForbiddenToast();

      // If forceFreshDrawer is requested on a real browser page, close any pre-existing drawer so GetClassById fires fresh
      if (options?.forceFreshDrawer && typeof (page as any).keyboard?.press === "function") {
        const preExistingDrawer = page
          .locator('div[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight')
          .first();
        if (await preExistingDrawer.isVisible().catch(() => false)) {
          const backBtn = preExistingDrawer.locator('button:has-text("Back")').first();
          if (await backBtn.isVisible().catch(() => false)) {
            await backBtn.click({ force: true }).catch(() => {});
          } else {
            await (page as any).keyboard.press("Escape").catch(() => {});
          }
          await page.waitForTimeout(450);
        }
      }

      // 3. Open the drawer for target class
      jobLogRepo.add({
        jobId,
        jobType: "SYNC_CLASS",
        level: "INFO",
        message: `Đang tìm và mở Drawer chi tiết của lớp ${classCode}...`,
      });
      await LmsHelpers.openClassDrawer(page, classCode);

      // Strictly lock classId to normalized uppercase classCode
      const classId = classCode;

      // 4. Scrape Sessions & Active Slot from "Nhận xét / Comments" tab (#tab-10)
      jobLogRepo.add({
        jobId,
        jobType: "SYNC_CLASS",
        classId,
        level: "INFO",
        message: `Đang quét danh sách buổi học (Slots) từ tab Comments cho lớp ${classCode}...`,
      });
      await LmsHelpers.switchDrawerTab(page, SELECTORS.tabs.comments);
      await page.waitForTimeout(1200);
      await interceptor.dismissForbiddenToast();

      const scrapedSessionData = await this.scrapeSessions(page, classId, classCode);
      const sessions = scrapedSessionData.sessions;
      let latestActiveSessionId = scrapedSessionData.latestActiveSessionId;

      // 5. Scrape Students from "Học viên" tab
      jobLogRepo.add({
        jobId,
        jobType: "SYNC_CLASS",
        classId,
        level: "INFO",
        message: `Đang quét tab Học viên (Students) cho lớp ${classCode}...`,
      });
      await LmsHelpers.switchDrawerTab(page, SELECTORS.tabs.students);
      await page.waitForTimeout(1000);
      await interceptor.dismissForbiddenToast();

      const students = await this.scrapeStudents(page, classId);

      // Strict Completeness Guardrail: Abort if sessions or students are empty to protect existing SQLite records
      if (sessions.length === 0 || students.length === 0) {
        await page.screenshot({ path: "data/debug_sync_empty.png" }).catch(() => {});
        throw new Error(
          `Dữ liệu đồng bộ lớp ${classCode} chưa tải đủ (${sessions.length} buổi học, ${students.length} học viên) do máy chủ LMS phản hồi chậm hoặc mất kết nối. Đã hủy cập nhật để bảo vệ dữ liệu hiện có trong SQLite.`
        );
      }

      if (pendingClassByIdTasks.size > 0) {
        await Promise.allSettled(Array.from(pendingClassByIdTasks));
      }

      const rawGqlId = String(
        classByIdGqlData?.id ?? classByIdGqlData?._id ?? ""
      ).trim();
      const drawerUrlId = extractLmsClassIdFromDrawerUrl(
        typeof page.url === "function" ? page.url() : ""
      );
      const syncedLmsClassId =
        isValidLmsClassObjectId(rawGqlId) && rawGqlId.toUpperCase() !== classCode
          ? rawGqlId
          : drawerUrlId && drawerUrlId.toUpperCase() !== classCode
            ? drawerUrlId
            : undefined;
      if (
        syncedLmsClassId &&
        !/^(TEST|AUDIT|R\d+|CLASS_|SYNTH)/i.test(classCode)
      ) {
        try {
          saveLmsClassIdMapping(classCode, syncedLmsClassId);
        } catch {}
      }

      // Enrich session dates from GetClassById.slots and weekly +7 days schedule up to today (<= todayEndOfDayMs),
      // advancing latestActiveSessionId when a session falls on today even before the class hour unlocks the DOM slot.
      const enrichedSchedule = enrichClassSessionsWithScheduleDates({
        classCode,
        sessions,
        latestActiveSessionId,
        slots: Array.isArray(classByIdGqlData?.slots) ? classByIdGqlData.slots : null,
      });
      latestActiveSessionId = enrichedSchedule.latestActiveSessionId;

      let lmsVerifiedSessionsCount = 0;

      // 6. Save all verified scraped records to SQLite atomically without deleting historical feedbacks
      const db = getDb();
      const saveTransaction = () => {
        for (const s of sessions) {
          classSessionRepo.upsert(s);
        }
        if (typeof (db as any)?.prepare === "function") {
          const validIds = new Set(students.map((st) => st.studentId));
          const existing = studentRepo.findByClass(classId, false) || [];
          const delStmt = (db as any).prepare(
            "DELETE FROM students WHERE classId = ? AND studentId = ?"
          );
          for (const ex of existing) {
            if (!validIds.has(ex.studentId) && /^STU_.*_\d+$/.test(ex.studentId)) {
              delStmt.run(classId, ex.studentId);
            }
          }
        }
        for (const st of students) {
          studentRepo.upsert(st);
        }
        if (
          shouldSyncCompletion &&
          typeof (db as any)?.prepare === "function" &&
          Array.isArray(classByIdGqlData?.slots) &&
          classByIdGqlData.slots.length > 0
        ) {
          lmsVerifiedSessionsCount = this.syncLmsSlotCompletionToSqlite({
            db,
            classId,
            students,
            slots: classByIdGqlData.slots,
            preferLmsVerified,
          });
        }
      };

      if (typeof (db as any).transaction === "function") {
        (db as any).transaction(saveTransaction)();
      } else {
        saveTransaction();
      }

      const activeStudentsCount = students.filter((s) => s.isActive).length;

      jobLogRepo.add({
        jobId,
        jobType: "SYNC_CLASS",
        classId,
        level: "SUCCESS",
        message: `Đồng bộ thành công lớp ${classCode}: ${sessions.length} buổi học (Buổi hiện tại: ${latestActiveSessionId || "N/A"}), ${students.length} học viên (${activeStudentsCount} đang hoạt động).`,
      });

      return {
        success: true,
        classId,
        classCode,
        ...(syncedLmsClassId ? { lmsClassId: syncedLmsClassId } : {}),
        sessionsCount: sessions.length,
        studentsCount: students.length,
        activeStudentsCount,
        latestActiveSessionId,
        lmsVerifiedSessionsCount,
        sessions,
        students,
      };
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      jobLogRepo.add({
        jobId,
        jobType: "SYNC_CLASS",
        level: "ERROR",
        message: `Lỗi đồng bộ lớp ${classCode}: ${errMsg}`,
      });
      return {
        success: false,
        classId: classCode,
        classCode,
        sessionsCount: 0,
        studentsCount: 0,
        activeStudentsCount: 0,
        sessions: [],
        students: [],
        error: errMsg,
      };
    } finally {
      if (canListenNetwork) {
        try {
          (page as any).off("request", onRequest);
          (page as any).off("response", onResponse);
        } catch {}
      }
    }
  }

  /**
   * Synchronizes already-completed LMS session comments & Session 14 evaluations from GetClassById.slots
   * into SQLite so "📌 Việc cần làm hôm nay" reflects real-time LMS completion status.
   */
  public static syncLmsSlotCompletionToSqlite(params: {
    db: any;
    classId: string;
    students: StudentRecord[];
    slots: any[];
    preferLmsVerified?: boolean;
  }): number {
    const { db, classId, students, slots, preferLmsVerified = false } = params;
    if (!db || typeof db.prepare !== "function" || !Array.isArray(slots) || slots.length === 0) {
      return 0;
    }

    const byId = new Map<string, StudentRecord>();
    const slugCounts = new Map<string, number>();
    const bySlug = new Map<string, StudentRecord>();
    for (const st of students) {
      byId.set(st.studentId, st);
      const slug = typeof toVietnameseUpperSlug === "function" ? toVietnameseUpperSlug(st.fullName) : "";
      if (slug) {
        slugCounts.set(slug, (slugCounts.get(slug) || 0) + 1);
        bySlug.set(slug, st);
      }
    }

    const computeHashSafe = (text: string): string => {
      if (typeof _calculateSha256 === "function") {
        return _calculateSha256(text);
      }
      return `sha_${text.length}_${text.slice(0, 16)}`;
    };

    const selectFbStmt = db.prepare(
      `SELECT status, finalText, attendanceStatus, verifiedAt
       FROM session_feedbacks
       WHERE classId = ? AND sessionId = ? AND studentId = ?`
    );
    const upsertFbVerifiedStmt = db.prepare(
      `INSERT INTO session_feedbacks (
         classId, sessionId, studentId, attendanceStatus,
         quickTagsJson, teacherNote, strengths, improvements, actionPlan,
         finalText, contentHash, status, verifiedAt, errorMessage, updatedAt
       ) VALUES (
         @classId, @sessionId, @studentId, @attendanceStatus,
         '[]', '', '', '', '',
         @finalText, @contentHash, 'VERIFIED', COALESCE(@verifiedAt, datetime('now', 'localtime')), NULL, datetime('now', 'localtime')
       )
       ON CONFLICT(classId, sessionId, studentId) DO UPDATE SET
         attendanceStatus = excluded.attendanceStatus,
         finalText = CASE WHEN TRIM(COALESCE(session_feedbacks.finalText, '')) <> '' THEN session_feedbacks.finalText ELSE excluded.finalText END,
         contentHash = excluded.contentHash,
         status = 'VERIFIED',
         verifiedAt = COALESCE(session_feedbacks.verifiedAt, datetime('now', 'localtime')),
         errorMessage = NULL,
         updatedAt = datetime('now', 'localtime')`
    );
    const upsertFbAbsentStmt = db.prepare(
      `INSERT INTO session_feedbacks (
         classId, sessionId, studentId, attendanceStatus,
         quickTagsJson, teacherNote, strengths, improvements, actionPlan,
         finalText, contentHash, status, updatedAt
       ) VALUES (
         @classId, @sessionId, @studentId, 'ABSENT',
         '[]', '', '', '', '',
         '', '', 'DRAFT', datetime('now', 'localtime')
       )
       ON CONFLICT(classId, sessionId, studentId) DO UPDATE SET
         attendanceStatus = 'ABSENT',
         updatedAt = datetime('now', 'localtime')`
    );

    let verifiedSessionsCount = 0;

    for (let idx = 0; idx < slots.length; idx++) {
      const slot = slots[idx];
      if (!slot || typeof slot !== "object") continue;
      const sessionNumber = typeof slot.index === "number" ? slot.index + 1 : idx + 1;
      if (sessionNumber < 1 || sessionNumber > 14) continue;
      const sessionId = `${classId}_SESS_${String(sessionNumber).padStart(2, "0")}`;
      const attendances = Array.isArray(slot.studentAttendance) ? slot.studentAttendance : [];
      if (attendances.length === 0) continue;

      let slotHasVerifiedStudent = false;
      const verifiedStudentIdsInSlot = new Set<string>();

      for (const att of attendances) {
        if (!att || typeof att !== "object") continue;
        const crmId = String(att?.student?.id || att?.studentId || "").trim();
        const crmName = String(att?.student?.fullName || att?.fullName || "").trim();
        const normSlug =
          crmName && typeof toVietnameseUpperSlug === "function"
            ? toVietnameseUpperSlug(crmName)
            : "";
        const matchedStudent =
          (crmId ? byId.get(crmId) : undefined) ||
          (normSlug && slugCounts.get(normSlug) === 1 ? bySlug.get(normSlug) : undefined);
        if (!matchedStudent) continue;

        const studentId = matchedStudent.studentId;
        const rawStatus = String(att.status || "").trim().toUpperCase();
        const lmsAttendance: "PRESENT" | "ABSENT" | "LATE" | "UNKNOWN" =
          rawStatus === "ABSENT" || rawStatus === "EXCUSED"
            ? "ABSENT"
            : rawStatus === "LATE" || rawStatus === "LATE_ARRIVED"
            ? "LATE"
            : rawStatus === "ATTENDED" || rawStatus === "PRESENT"
            ? "PRESENT"
            : "UNKNOWN";

        const areas: any[] = Array.isArray(att.commentByAreas) ? att.commentByAreas : [];
        const contentAreas = areas
          .filter((a) => String(a?.type || "").toUpperCase() === "CONTENT" && a?.content)
          .map((a) => stripLmsHtmlToPlainText(a.content))
          .filter(Boolean);
        const lmsComment =
          contentAreas.join("\n\n").trim() || stripLmsHtmlToPlainText(att.comment);

        const existingFb = selectFbStmt.get(classId, sessionId, studentId) as
          | {
              status?: string;
              finalText?: string;
              attendanceStatus?: string;
              verifiedAt?: string | null;
            }
          | undefined;

        if (lmsComment.length > 0) {
          const canMarkVerified =
            !existingFb ||
            existingFb.status === "VERIFIED" ||
            !String(existingFb.finalText || "").trim() ||
            (preferLmsVerified &&
              existingFb.status !== "APPROVED" &&
              existingFb.status !== "SAVING");

          if (canMarkVerified) {
            const effectiveText = String(existingFb?.finalText || "").trim() || lmsComment;
            upsertFbVerifiedStmt.run({
              classId,
              sessionId,
              studentId,
              attendanceStatus:
                lmsAttendance !== "UNKNOWN"
                  ? lmsAttendance
                  : existingFb?.attendanceStatus || "PRESENT",
              finalText: effectiveText,
              contentHash: computeHashSafe(effectiveText),
              verifiedAt: existingFb?.verifiedAt || null,
            });
            slotHasVerifiedStudent = true;
            verifiedStudentIdsInSlot.add(studentId);
          }
        } else if (lmsAttendance === "ABSENT") {
          if (
            !existingFb ||
            (existingFb.status !== "APPROVED" &&
              existingFb.status !== "SAVING" &&
              existingFb.status !== "VERIFIED")
          ) {
            upsertFbAbsentStmt.run({
              classId,
              sessionId,
              studentId,
            });
          }
        }

        // For Session 14: Also sync spck_session14_evaluations if LMS already has Session 14 evaluation content
        if (
          sessionNumber === 14 &&
          lmsComment.length > 0 &&
          typeof _session14EvalRepo?.getOrInit === "function" &&
          typeof _computeSession14EvalHash === "function"
        ) {
          try {
            const existingEval = _session14EvalRepo.findOne(classId, studentId);
            const canVerifyEval =
              !existingEval ||
              existingEval.status === "VERIFIED" ||
              !String(existingEval.learnedFromMindx || "").trim() ||
              (preferLmsVerified &&
                String(existingEval.status) !== "APPROVED" &&
                String(existingEval.status) !== "SAVING");
            if (canVerifyEval) {
              const currentEval = _session14EvalRepo.getOrInit(classId, studentId);
              const learned =
                String(currentEval.learnedFromMindx || "").trim() ||
                contentAreas[0] ||
                lmsComment;
              const suggestions =
                String(currentEval.suggestionsFromMindx || "").trim() ||
                contentAreas[1] ||
                "Con tiếp tục phát huy tinh thần học tập tốt.";
              const future =
                String(currentEval.futureDirection || "").trim() ||
                contentAreas[2] ||
                "Tiếp tục hoàn thiện kỹ năng ở khóa học tiếp theo.";
              const evalHash = _computeSession14EvalHash({
                classId,
                studentId,
                competencyJson: currentEval.competencyJson,
                competencyTotalScore: currentEval.competencyTotalScore,
                demoScoresJson: currentEval.demoScoresJson,
                demoTotalScore: currentEval.demoTotalScore,
                learnedFromMindx: learned,
                suggestionsFromMindx: suggestions,
                futureDirection: future,
                awardRanking: currentEval.awardRanking,
              });
              db.prepare(
                `UPDATE spck_session14_evaluations
                 SET learnedFromMindx = ?,
                     suggestionsFromMindx = ?,
                     futureDirection = ?,
                     contentHash = ?,
                     status = 'VERIFIED',
                     verifiedAt = COALESCE(verifiedAt, datetime('now', 'localtime')),
                     errorMessage = NULL,
                     updatedAt = datetime('now', 'localtime')
                 WHERE classId = ? AND studentId = ?`
              ).run(learned, suggestions, future, evalHash, classId, studentId);
            }
          } catch {}
        }
      }

      if (slotHasVerifiedStudent) {
        if (preferLmsVerified) {
          for (const st of students) {
            if (!st.isActive || verifiedStudentIdsInSlot.has(st.studentId)) continue;
            const existingFb = selectFbStmt.get(classId, sessionId, st.studentId) as
              | {
                  status?: string;
                  finalText?: string;
                }
              | undefined;
            if (
              !existingFb ||
              (existingFb.status === "DRAFT" &&
                !String(existingFb.finalText || "").trim())
            ) {
              upsertFbAbsentStmt.run({
                classId,
                sessionId,
                studentId: st.studentId,
              });
            }
          }
        }
        verifiedSessionsCount++;
      }
    }

    return verifiedSessionsCount;
  }

  /**
   * Scrapes session list and dates from the Comments tab slot carousel (#class-comments-slot-carousel-0..13)
   * and enriches topics with courses_syllabus.json.
   */
  private static async scrapeSessions(
    page: Page,
    classId: string,
    classCode: string
  ): Promise<{ sessions: ClassSessionRecord[]; latestActiveSessionId: string }> {
    const sessions: ClassSessionRecord[] = [];
    const drawer = page.locator('div[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight').first();
    const isDrawerOpen = await drawer.isVisible().catch(() => false);
    const context = isDrawerOpen ? drawer : page;

    // Match course syllabus by code in classCode
    const syllabusList = typeof getCoursesSyllabus === "function" ? getCoursesSyllabus() : [];
    const matchedCourse = syllabusList.find((c) => classCode.toUpperCase().includes(c.courseCode));

    const slotItems = context.locator('[id^="class-comments-slot-carousel-"]');
    let slotCount = await slotItems.count().catch(() => 0);

    if (slotCount === 0) {
      for (let waitAttempt = 0; waitAttempt < 40; waitAttempt++) {
        await page.waitForTimeout(500);
        slotCount = await slotItems.count().catch(() => 0);
        if (slotCount > 0) break;
        if (waitAttempt === 10 || waitAttempt === 24) {
          const commentsTab = context.locator(SELECTORS.tabs.comments).first();
          if (await commentsTab.isVisible().catch(() => false)) {
            await commentsTab
              .evaluate((el: HTMLElement) => {
                el.scrollIntoView({ inline: "center", block: "nearest" });
                el.click();
              })
              .catch(() => {});
          }
        }
      }
    }

    if (slotCount === 0 && typeof (page as any).screenshot === "function") {
      await page.screenshot({ path: "data/debug_comments_tab.png" }).catch(() => {});
    }

    let latestActiveSessionId = `${classId}_SESS_01`;
    let latestActiveSlotIndex = 0;

    const parseSlotDate = (text: string): string => {
      const dateMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
      if (!dateMatch) return "";
      const day = dateMatch[1].padStart(2, "0");
      const month = dateMatch[2].padStart(2, "0");
      const year = dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3];
      return `${day}/${month}/${year}`;
    };

    if (slotCount > 0) {
      for (let i = 0; i < slotCount; i++) {
        const slot = slotItems.nth(i);
        const idAttr = (await slot.getAttribute("id").catch(() => "")) || "";
        const idxMatch = idAttr.match(/(\d+)$/);
        const sessionNumber = idxMatch ? parseInt(idxMatch[1], 10) + 1 : i + 1;
        const sessionId = `${classId}_SESS_${String(sessionNumber).padStart(2, "0")}`;

        const classAttr = (await slot.getAttribute("class").catch(() => "")) || "";
        const isDisabled = classAttr.includes("disabled");

        const text = await slot.innerText().catch(() => "");
        const sessionDate = parseSlotDate(text);

        if (!isDisabled) {
          latestActiveSessionId = sessionId;
          latestActiveSlotIndex = i;
        }

        const syllabusSession = matchedCourse?.sessions.find((s) => s.sessionNumber === sessionNumber);
        const topic = syllabusSession?.topic || `Buổi ${sessionNumber}: Bài học theo giáo trình ${classCode}`;

        sessions.push({
          classId,
          className: classCode,
          sessionId,
          sessionNumber,
          topic,
          date: sessionDate,
        });
      }

      // MindX LMS only renders the full date text inside the currently .active slot in the carousel.
      // Only click the latest non-disabled slot if it is NOT already .active (clicking an .active slot toggles it off to .inactive!).
      if (latestActiveSlotIndex >= 0 && latestActiveSlotIndex < sessions.length) {
        const latestSlot = slotItems.nth(latestActiveSlotIndex);
        await latestSlot.scrollIntoViewIfNeeded().catch(() => {});
        const isAlreadyActive = await latestSlot
          .evaluate((el) => el.classList.contains("active"))
          .catch(() => false);
        if (!isAlreadyActive) {
          const infoContainer = latestSlot.locator(".info-container").first();
          if (await infoContainer.isVisible().catch(() => false)) {
            await infoContainer.click({ force: true }).catch(() => {});
          } else {
            await latestSlot.click({ force: true }).catch(() => {});
          }
          await page.waitForTimeout(800);
        }

        const activeText = await latestSlot.innerText().catch(() => "");
        const activeDate = parseSlotDate(activeText);
        if (activeDate) {
          sessions[latestActiveSlotIndex].date = activeDate;
        }
      }

      return { sessions, latestActiveSessionId };
    }

    // Do not invent fake 14 sessions when LMS slots failed to load
    return { sessions: [], latestActiveSessionId: "" };
  }

  /**
   * Scrapes students list from Students tab with pagination support.
   */
  private static async scrapeStudents(page: Page, classId: string): Promise<StudentRecord[]> {
    const studentsMap = new Map<string, StudentRecord>();
    const interceptor = createNetworkInterceptor(page);

    const drawer = page.locator('div[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight').first();
    const isDrawerOpen = await drawer.isVisible().catch(() => false);
    const context = isDrawerOpen ? drawer : page;

    // Try setting page size to 100 if size changer exists
    const sizeChanger = context.locator(SELECTORS.students.pageSizeSelect).first();
    if (await sizeChanger.isVisible().catch(() => false)) {
      await sizeChanger.click().catch(() => {});
      const option100 = page.locator(".ant-select-item-option:has-text('100'), .MuiMenuItem-root:has-text('100'), option[value='100']").first();
      if (await option100.isVisible().catch(() => false)) {
        await option100.click().catch(() => {});
        await page.waitForTimeout(1000);
      }
    }

    let hasNextPage = true;
    let pageNum = 1;
    let globalRowIndex = 0;
    const maxPages = 50;

    while (hasNextPage && pageNum <= maxPages) {
      await interceptor.dismissForbiddenToast();
      const rows = context.locator("table tbody tr");
      let count = await rows.count().catch(() => 0);

      if (count === 0 && pageNum === 1) {
        for (let waitAttempt = 0; waitAttempt < 30; waitAttempt++) {
          await page.waitForTimeout(500);
          count = await rows.count().catch(() => 0);
          if (count > 0) break;
        }
      }

      for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        const text = await row.innerText().catch(() => "");
        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

        if (lines.length === 0) continue;

        globalRowIndex++;

        // Extract student name (typically the prominent column)
        const fullName = lines[0] || `Học viên ${globalRowIndex}`;

        // Extract student ID from data attributes, links, or monotonic globalRowIndex
        let studentId =
          (await row.getAttribute("data-student-id").catch(() => null)) ||
          (await row.getAttribute("data-id").catch(() => null));

        if (!studentId) {
          // Check link href (e.g. /students/12345) without hanging 30s if absent
          const link = row.locator("a[href*='student']").first();
          if ((await link.count().catch(() => 0)) > 0) {
            const href = await link.getAttribute("href", { timeout: 800 }).catch(() => null);
            const match = href?.match(/student[s]?\/([a-zA-Z0-9_-]+)/);
            if (match && match[1]) {
              studentId = match[1];
            }
          }
        }

        if (!studentId) {
          // Check if any secondary line contains an explicit LMS UID (24-hex ObjectId) or student code
          const codeLine = lines
            .slice(1)
            .find((l) => /^[a-f0-9]{24}$/i.test(l) || /^(?:HV|MX|STU)[-_]?[A-Z0-9]{3,}$/i.test(l));
          if (codeLine) {
            studentId = codeLine.trim();
          }
        }

        if (!studentId) {
          // Build deterministic identity from normalized student name (order-independent across sync runs)
          const normSlug = toVietnameseUpperSlug(fullName);
          if (!normSlug) {
            throw new Error(
              `Không thể xác định định danh cho dòng học viên thứ ${globalRowIndex} của lớp ${classId}.`
            );
          }
          studentId = `STU_${classId}_${normSlug}`;
          if (studentsMap.has(studentId)) {
            throw new Error(
              `Phát hiện học viên trùng tên '${fullName}' trong lớp ${classId} nhưng DOM thiếu mã studentId riêng biệt. Đã dừng đồng bộ để tránh gán nhầm ID.`
            );
          }
        }

        // Check if student is active (switch is green/checked or no disabled indicator)
        const switchChecked = await row
          .locator(".Mui-checked, .ant-switch-checked, [role='switch'][aria-checked='true'], input[type='checkbox']:checked")
          .first()
          .isVisible()
          .catch(() => false);

        const switchExists = await row
          .locator(".MuiSwitch-root, .ant-switch, [role='switch'], input[type='checkbox']")
          .first()
          .isVisible()
          .catch(() => false);

        const isActive = switchExists ? (switchChecked ? 1 : 0) : 1;

        if (!studentsMap.has(studentId)) {
          studentsMap.set(studentId, {
            studentId,
            classId,
            fullName,
            isActive,
          });
        }
      }

      // Check for next pagination button
      const nextBtn = context
        .locator(
          'button[aria-label*="next page" i], button[aria-label*="next" i], .MuiTablePagination-actions button:last-child, .ant-pagination-next:not(.ant-pagination-disabled)'
        )
        .first();

      const hasNext = (await nextBtn.count().catch(() => 0)) > 0;
      const isVisible = hasNext && (await nextBtn.isVisible().catch(() => false));
      const isEnabled = hasNext && (await nextBtn.isEnabled().catch(() => false));
      const isAriaDisabled = hasNext && ((await nextBtn.getAttribute("aria-disabled", { timeout: 400 }).catch(() => null)) === "true");
      const isMuiDisabled = hasNext && ((await nextBtn.getAttribute("class", { timeout: 400 }).catch(() => "")) || "").includes("Mui-disabled");

      if (isVisible && isEnabled && !isAriaDisabled && !isMuiDisabled) {
        await nextBtn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(800);
        pageNum++;
      } else {
        hasNextPage = false;
      }
    }

    if (hasNextPage) {
      throw new Error(`Phân trang danh sách học viên lớp ${classId} vượt quá giới hạn an toàn (${maxPages} trang), chưa tải hết danh sách.`);
    }

    return Array.from(studentsMap.values());
  }

  /**
   * Scrapes all classes with Status = "Running" (Đang học) from the MindX LMS Classes table
   * and caches them into data/running_classes.json for one-click selection.
   */
  public static async fetchRunningClasses(options?: {
    persistToConfig?: boolean;
    includeFinishedDays?: number;
  }): Promise<{
    success: boolean;
    classes: RunningClassItem[];
    error?: string;
  }> {
    const jobId = `fetch_running_classes_${Date.now()}`;
    jobLogRepo.add({
      jobId,
      jobType: "SYNC_CLASS",
      level: "INFO",
      message: "Đang vào trang Danh sách Lớp học LMS để lấy các lớp đang học (Running)...",
    });

    const browserManager = BrowserManager.getInstance();
    const page =
      typeof browserManager.getPage === "function"
        ? await browserManager.getPage()
        : (await browserManager.getContext()).pages()[0] ||
          (await (await browserManager.getContext()).newPage());
    const interceptor = createNetworkInterceptor(page);
    let classListApiError: string | null = null;
    let awaitingSearchClearApiResponse = false;
    let staleSearchFilterValue = "";
    let searchClearApiConfirmed = false;
    let confirmedApiClassCodes: string[] | null = null;
    let sawAnyClassListApiTraffic = false;
    const discoveredLmsClassIds: Record<string, string> = {};
    const postClearRequests = new Set<any>();
    const onClassListApiRequest = (req: any) => {
      if (!req) return;
      const reqUrl = String(req.url?.() || "");
      const reqPostData = String(req.postData?.() || "");
      const isClassReq =
        /\/api\/classes\b/i.test(reqUrl) ||
        ((reqUrl.includes("lms-api.mindx.edu.vn") || reqUrl.includes("graphql")) &&
          /\b(getclasses|searchclasses|findclasses|classes|classlist)\b/i.test(reqPostData));
      if (isClassReq) {
        sawAnyClassListApiTraffic = true;
      }
      if (awaitingSearchClearApiResponse) {
        postClearRequests.add(req);
      }
    };
    const onClassListApiResponse = async (res: any) => {
      try {
        const req = typeof res.request === "function" ? res.request() : null;
        const method = String(req?.method?.() || "").toUpperCase();
        if (method === "OPTIONS") return;
        const resourceType = String(req?.resourceType?.() || "").toLowerCase();
        if (resourceType === "document") return;
        const url = String(res.url?.() || "");
        const isLmsApi =
          url.includes("lms-api.mindx.edu.vn") ||
          url.includes("graphql") ||
          /\/api\/classes\b/i.test(url);
        if (!isLmsApi) return;
        const postData = String(req?.postData?.() || "");
        if (
          postData &&
          /\b(getstudents|students|getcomments|comments|getslots|slots|attendance|submissions|homework|permission|notification)\b/i.test(
            postData
          ) &&
          !/\b(getclasses|searchclasses|findclasses|classes|classlist)\b/i.test(
            postData
          )
        ) {
          return;
        }
        const status = typeof res.status === "function" ? res.status() : 200;
        if (status >= 400) {
          classListApiError = `API danh sách lớp LMS trả về mã lỗi HTTP ${status}.`;
          return;
        }
        const bodyText =
          typeof res.text === "function"
            ? await res.text().catch(() => "")
            : "";
        let parsed: any = null;
        if (bodyText && bodyText.trim().startsWith("{")) {
          parsed = JSON.parse(bodyText);
          if (Array.isArray(parsed?.errors) && parsed.errors.length > 0) {
            classListApiError =
              parsed.errors[0]?.message ||
              "API danh sách lớp LMS trả về lỗi GraphQL.";
            return;
          }
        }
        let parsedReq: any = null;
        if (postData && postData.trim().startsWith("{")) {
          try {
            parsedReq = JSON.parse(postData);
          } catch {
            parsedReq = null;
          }
        }
        const opTarget = `${String(parsedReq?.operationName || "")} ${String(parsedReq?.query || "")}`;
        const isExplicitClassListRequest =
          /\/api\/classes\b/i.test(url) ||
          /\b(getclasses|searchclasses|findclasses|classes|classlist)\b/i.test(opTarget);
        if (isExplicitClassListRequest) {
          sawAnyClassListApiTraffic = true;
        }
        if (awaitingSearchClearApiResponse && req && postClearRequests.has(req)) {
          let hasNonEmptySearchFilter = false;
          try {
            const uObj = new URL(url, "https://lms.mindx.edu.vn");
            for (const key of ["search", "q", "keyword", "query", "classCode"]) {
              const val = uObj.searchParams.get(key);
              if (val && val.trim().length > 0) {
                hasNonEmptySearchFilter = true;
              }
            }
          } catch {
            // Ignore URL parse error
          }
          const checkVarsObj = (obj: any) => {
            if (!obj || typeof obj !== "object") return;
            for (const key of ["search", "q", "keyword", "query", "classCode", "name"]) {
              if (typeof obj[key] === "string" && obj[key].trim().length > 0) {
                hasNonEmptySearchFilter = true;
              }
            }
          };
          checkVarsObj(parsedReq?.variables);
          checkVarsObj(parsedReq?.variables?.filter);
          checkVarsObj(parsedReq?.variables?.input);
          checkVarsObj(parsedReq?.variables?.where);
          if (
            staleSearchFilterValue &&
            postData.toLowerCase().includes(staleSearchFilterValue.toLowerCase())
          ) {
            hasNonEmptySearchFilter = true;
          }
          const rawClassArray = Array.isArray(parsed?.data?.classes)
            ? parsed.data.classes
            : Array.isArray(parsed?.data?.classes?.data)
              ? parsed.data.classes.data
              : Array.isArray(parsed?.data?.getClasses)
                ? parsed.data.getClasses
                : /\/api\/classes\b/i.test(url) && Array.isArray(parsed?.data || parsed)
                  ? (parsed?.data || parsed)
                  : null;
          if (Array.isArray(rawClassArray)) {
            for (const item of rawClassArray) {
              const code = String(
                item?.classCode || item?.code || item?.name || ""
              )
                .trim()
                .toUpperCase();
              const id = String(item?.id ?? item?._id ?? "").trim();
              if (
                isValidLmsClassCode(code) &&
                !/^(TEST|AUDIT|R\d+|CLASS_|SYNTH)/i.test(code) &&
                isValidLmsClassObjectId(id) &&
                id.toUpperCase() !== code
              ) {
                discoveredLmsClassIds[code] = id;
              }
            }
          }
          if (isExplicitClassListRequest && !hasNonEmptySearchFilter && Array.isArray(rawClassArray)) {
            const extractedCodes = rawClassArray
              .map((item: any) =>
                String(item?.classCode || item?.code || item?.name || "")
                  .trim()
                  .toUpperCase()
              )
              .filter((code: string) => /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/i.test(code));
            if (extractedCodes.length === rawClassArray.length) {
              confirmedApiClassCodes = extractedCodes;
              searchClearApiConfirmed = true;
            }
          }
        }
      } catch {
        // Ignore parse errors
      }
    };
    if (typeof page.on === "function") {
      page.on("request", onClassListApiRequest);
      page.on("response", onClassListApiResponse);
    }

    try {
      await authService.ensureAuthenticated("LMS");

      // Close any open class drawer first so the full classes table is visible
      const existingDrawer = page
        .locator('div[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight')
        .first();
      if (await existingDrawer.isVisible().catch(() => false)) {
        const backBtn = existingDrawer.locator('button:has-text("Back")').first();
        if (await backBtn.isVisible().catch(() => false)) {
          await backBtn.click().catch(() => {});
        } else {
          await page.keyboard.press("Escape").catch(() => {});
          const closeBtn = page.locator(SELECTORS.classes.closeDrawerButton).first();
          if (await closeBtn.isVisible().catch(() => false)) {
            await closeBtn.click().catch(() => {});
          }
        }
        await page.waitForTimeout(600);
      }

      // Navigate to LMS Classes page if not already there (e.g. when at /admin/dashboard "Coming soon")
      const isOnClassesTable = async () => {
        const url = page.url();
        const { hostname, pathname } = parseUrlParts(url);
        if (hostname && isLoginHostOrPath(url, "lms.mindx.edu.vn")) return false;
        if (pathname.includes("/dashboard")) return false;
        const hasSearchOrTable = await page
          .locator('input[placeholder*="Search classes" i], table tbody tr')
          .first()
          .isVisible()
          .catch(() => false);
        return (
          hasSearchOrTable ||
          pathname.includes("/class") ||
          pathname.includes("/classes")
        );
      };

      if (!(await isOnClassesTable())) {
        // On MindX LMS (/admin/dashboard), "Classes" in the left sidebar is an expandable menu:
        // Clicking "> Classes" once expands it to reveal the child "Classes" item underneath.
        const sidebarClassesItems = page.locator(
          '[data-testid="sidebar"] :text-is("Classes"), .MuiDrawer-docked :text-is("Classes"), aside :text-is("Classes"), nav :text-is("Classes"), :text-is("Classes"), :text-is("Lớp học")'
        );
        const initialCount = await sidebarClassesItems.count().catch(() => 0);
        if (initialCount > 0) {
          // If only 1 "Classes" is visible, click it first to expand the submenu
          if (initialCount === 1) {
            await sidebarClassesItems.first().click({ force: true }).catch(() => {});
            await page.waitForTimeout(700);
          }
          // After expanding, click the child "Classes" item (the second/last item in sidebar)
          const afterExpandCount = await sidebarClassesItems.count().catch(() => 0);
          if (afterExpandCount >= 2) {
            await sidebarClassesItems.nth(1).click({ force: true }).catch(() => {});
          } else {
            const directLink = page.locator('a[href*="class"], a:has-text("Classes")').first();
            if (await directLink.isVisible().catch(() => false)) {
              await directLink.click({ force: true }).catch(() => {});
            } else {
              await sidebarClassesItems.first().click({ force: true }).catch(() => {});
            }
          }
          await page.waitForTimeout(2000);
        }

        if (!(await isOnClassesTable())) {
          const baseLmsUrl = config.lmsUrl.replace(/\/+$/, "").replace(/\/(admin\/)?(classes|class|dashboard)$/i, "");
          for (const candidatePath of ["/admin/class", "/classes", "/admin/classes"]) {
            await page
              .goto(`${baseLmsUrl}${candidatePath}`, {
                waitUntil: "domcontentloaded",
                timeout: 20000,
              })
              .catch(() => {});
            await page.waitForTimeout(1500);
            if (await isOnClassesTable()) break;
          }
        }
      }

      await interceptor.dismissForbiddenToast();

      // Clear any previous class search filter so ALL classes are displayed
      const searchInput = page.locator(SELECTORS.classes.searchInput).first();
      if (await searchInput.isVisible().catch(() => false)) {
        const currentSearchVal = await searchInput.inputValue().catch(() => "");
        if (currentSearchVal && currentSearchVal.trim().length > 0) {
          const initialTbodySig = await page
            .locator("table tbody")
            .first()
            .innerText()
            .catch(() => "");
          staleSearchFilterValue = currentSearchVal.trim();
          postClearRequests.clear();
          confirmedApiClassCodes = null;
          awaitingSearchClearApiResponse = true;
          searchClearApiConfirmed = false;
          const clearFilterBtn = page
            .locator('button:has-text("Clear"), .ant-input-clear-icon, [aria-label="close-circle"]')
            .first();
          if (await clearFilterBtn.isVisible().catch(() => false)) {
            await clearFilterBtn.click().catch(() => {});
            await page.waitForTimeout(400);
          }
          const remainingVal = await searchInput.inputValue().catch(() => currentSearchVal);
          if (remainingVal && remainingVal.trim().length > 0) {
            await searchInput.click().catch(() => {});
            await searchInput.fill("").catch(() => {});
            await page.keyboard.press("Enter").catch(() => {});
          } else {
            await searchInput.click().catch(() => {});
            await page.keyboard.press("Enter").catch(() => {});
          }
          const finalSearchVal = await searchInput.inputValue().catch(() => remainingVal);
          if (finalSearchVal && finalSearchVal.trim().length > 0) {
            awaitingSearchClearApiResponse = false;
            throw new Error(
              `Không thể xóa bộ lọc tìm kiếm lớp học ('${finalSearchVal.trim()}') trên MindX LMS. Đã hủy cập nhật để bảo vệ danh sách lớp hiện có.`
            );
          }
          let searchRefreshConfirmed = false;
          for (let waitIdx = 0; waitIdx < 15; waitIdx++) {
            await page.waitForTimeout(400);
            const curTbodySig = await page
              .locator("table tbody")
              .first()
              .innerText()
              .catch(() => "");
            const domSnapshot = await page
              .evaluate(() => {
                const codes: string[] = [];
                const trs = Array.from(document.querySelectorAll("table tbody tr"));
                for (const tr of trs) {
                  if (
                    tr.closest(
                      '[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight'
                    )
                  ) {
                    continue;
                  }
                  const tds = Array.from(tr.querySelectorAll("td")).map((td) =>
                    (td.innerText || td.textContent || "").replace(/\s+/g, " ").trim()
                  );
                  if (tds.length < 2) continue;
                  let code = tds[1] || "";
                  if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/i.test(code)) {
                    const found = tds.find((c) =>
                      /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/i.test(c)
                    );
                    if (found) code = found;
                  }
                  code = code.trim().toUpperCase();
                  if (code) codes.push(code);
                }
                const nextBtn = document.querySelector(
                  '.ant-pagination-next:not(.ant-pagination-disabled), button[aria-label*="next" i]:not(:disabled), li[title="Next Page"]:not([aria-disabled="true"])'
                );
                return { codes, hasNextPage: Boolean(nextBtn) };
              })
              .catch(() => ({ codes: [] as string[], hasNextPage: false }));
            const curDomClassCodes = domSnapshot.codes;
            const domChangedToNonEmpty =
              !sawAnyClassListApiTraffic &&
              curTbodySig !== initialTbodySig &&
              curTbodySig.trim().length > 0;
            const apiCodes = confirmedApiClassCodes as string[] | null;
            let apiMatchesDom = false;
            if (searchClearApiConfirmed && apiCodes !== null && curTbodySig.trim().length > 0) {
              if (apiCodes.length === 0) {
                apiMatchesDom =
                  curDomClassCodes.length === 0 &&
                  (curTbodySig !== initialTbodySig ||
                    /no classes|no data|không có dữ liệu|trống/i.test(curTbodySig));
              } else if (domSnapshot.hasNextPage) {
                apiMatchesDom =
                  curDomClassCodes.length > 0 &&
                  curDomClassCodes.length <= apiCodes.length &&
                  curDomClassCodes.every((code: string, idx: number) => apiCodes[idx] === code);
              } else {
                apiMatchesDom =
                  curDomClassCodes.length === apiCodes.length &&
                  curDomClassCodes.every((code: string, idx: number) => apiCodes[idx] === code);
              }
            }
            if (domChangedToNonEmpty || apiMatchesDom) {
              searchRefreshConfirmed = true;
              break;
            }
          }
          awaitingSearchClearApiResponse = false;
          const priorCachedClasses =
            typeof getRunningClasses === "function" ? getRunningClasses() || [] : [];
          if (
            !searchRefreshConfirmed &&
            ((options?.persistToConfig ?? true) || priorCachedClasses.length > 0)
          ) {
            throw new Error(
              "Bảng danh sách lớp trên MindX LMS chưa xác nhận tải lại sau khi xóa bộ lọc tìm kiếm. Đã hủy cập nhật để bảo vệ danh sách lớp hiện có."
            );
          }
        }
      }

      // Wait for class table rows
      await page
        .locator("table tbody tr")
        .first()
        .waitFor({ state: "visible", timeout: 15000 })
        .catch(() => {});
      await page.waitForTimeout(800);

      const collectedMap = new Map<string, RunningClassItem>();
      const maxPages = 5;
      const nowMs = Date.now();
      let unknownFinishedCandidatesCount = 0;
      let totalScrapedClassRows = 0;
      const tableFinishedGraceDays =
        typeof options?.includeFinishedDays === "number" &&
        Number.isFinite(options.includeFinishedDays)
          ? Math.max(0, Math.floor(options.includeFinishedDays))
          : DASHBOARD_FINISHED_CLASS_GRACE_DAYS;
      const spckDbFinishedGraceDays =
        typeof options?.includeFinishedDays === "number" &&
        Number.isFinite(options.includeFinishedDays)
          ? Math.max(0, Math.floor(options.includeFinishedDays))
          : FINISHED_CLASS_GRACE_DAYS;

      for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
        await interceptor.dismissForbiddenToast();

        const pageRows = await page.evaluate(() => {
          const results: Array<{
            classCode: string;
            courseName: string;
            center: string;
            status: "Running" | "Finished";
            rowStartDate: string;
            rowEndDate: string;
          }> = [];
          const trs = Array.from(document.querySelectorAll("table tbody tr"));
          for (const tr of trs) {
            if (tr.closest('[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight')) {
              continue;
            }
            const tds = Array.from(tr.querySelectorAll("td")).map((td) =>
              (td.innerText || td.textContent || "").replace(/\s+/g, " ").trim()
            );
            if (tds.length < 2) continue;

            // Check if any cell indicates Running / Đang học or Finished / Đã kết thúc
            const hasRunning = tds.some((cell) => /^(running|đang học|đang diễn ra)$/i.test(cell));
            const hasFinished = tds.some((cell) =>
              /^(finished|đã kết thúc|completed|closed)$/i.test(cell)
            );
            const hasCancelled = tds.some((cell) =>
              /^(cancelled|canceled|đã hủy|rejected)$/i.test(cell)
            );
            if (hasCancelled || (!hasRunning && !hasFinished)) continue;

            // Column 2 (index 1) is Name (e.g. VT-C4K-GI34), Column 3 (index 2) is Course, Column 4 (index 3) is Center
            let classCode = tds[1] || "";
            if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/i.test(classCode)) {
              const foundCode = tds.find((c) => /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/i.test(c));
              if (foundCode) classCode = foundCode;
            }
            classCode = classCode.trim().toUpperCase();
            if (!classCode) continue;

            const courseName = (tds[2] || "").trim();
            const center = (tds[3] || "").trim();

            // Extract any date strings in the row cells (Start date / End date columns)
            const dateMatches: string[] = [];
            for (const cell of tds) {
              const matches =
                cell.match(/\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/g) ||
                [];
              for (const m of matches) {
                dateMatches.push(m);
              }
            }
            const rowStartDate = dateMatches.length >= 2 ? dateMatches[0] : "";
            const rowEndDate = dateMatches.length > 0 ? dateMatches[dateMatches.length - 1] : "";

            results.push({
              classCode,
              courseName,
              center,
              status: hasRunning ? "Running" : "Finished",
              rowStartDate,
              rowEndDate,
            });
          }
          return results;
        });

        let foundActiveOrRecentOnThisPage = 0;
        let expiredFinishedOnThisPage = 0;
        const nowIso = new Date().toISOString();
        totalScrapedClassRows += pageRows.length;

        for (const item of pageRows) {
          if (collectedMap.has(item.classCode)) continue;

          const startMs = parseClassDateToEndOfDayMs(item.rowStartDate);
          const endMs = parseClassDateToEndOfDayMs(item.rowEndDate);
          const startDateFormatted = startMs !== null ? formatMsToDdMmYyyy(startMs) : undefined;
          const endDateFormatted = endMs !== null ? formatMsToDdMmYyyy(endMs) : undefined;

          if (item.status === "Running") {
            collectedMap.set(item.classCode, {
              classCode: item.classCode,
              courseName: item.courseName,
              center: item.center,
              status: "Running",
              ...(startDateFormatted ? { startDate: startDateFormatted } : {}),
              ...(endDateFormatted ? { endDate: endDateFormatted } : {}),
              updatedAt: nowIso,
            });
            foundActiveOrRecentOnThisPage++;
            continue;
          }

          // Status === "Finished": only include if within tableFinishedGraceDays (default 7 days = 1 week; 15 days when requested by SPCK) after Buổi 14
          const graceCheck = isFinishedClassWithinGraceWindow(
            item.classCode,
            item.rowEndDate,
            tableFinishedGraceDays,
            nowMs
          );
          if (graceCheck.isKnownDate) {
            if (graceCheck.withinWindow) {
              collectedMap.set(item.classCode, {
                classCode: item.classCode,
                courseName: item.courseName,
                center: item.center,
                status: "Finished",
                ...(startDateFormatted ? { startDate: startDateFormatted } : {}),
                endDate: graceCheck.session14Date,
                updatedAt: nowIso,
              });
              foundActiveOrRecentOnThisPage++;
              // Backfill session 14 date in SQLite classes_sessions if empty
              if (graceCheck.session14Date) {
                try {
                  const db = getDb();
                  if (typeof (db as any)?.prepare === "function") {
                    (db as any)
                      .prepare(
                        `UPDATE classes_sessions
                         SET date = ?
                         WHERE classId = ? AND sessionNumber = 14 AND TRIM(COALESCE(date, '')) = ''`
                      )
                      .run(graceCheck.session14Date, item.classCode);
                  }
                } catch {
                  // ignore
                }
              }
            } else {
              expiredFinishedOnThisPage++;
            }
          } else if (expiredFinishedOnThisPage === 0 && unknownFinishedCandidatesCount < 4) {
            // Recently finished class at the top of Finished rows that has not been synced to SQLite yet
            unknownFinishedCandidatesCount++;
            collectedMap.set(item.classCode, {
              classCode: item.classCode,
              courseName: item.courseName,
              center: item.center,
              status: "Finished",
              ...(startDateFormatted ? { startDate: startDateFormatted } : {}),
              ...(endDateFormatted ? { endDate: endDateFormatted } : {}),
              updatedAt: nowIso,
            });
            foundActiveOrRecentOnThisPage++;
          }
        }

        if (foundActiveOrRecentOnThisPage === 0 || expiredFinishedOnThisPage >= 2) {
          break;
        }

        const nextBtn = page
          .locator(
            'button[aria-label*="next page" i], .MuiTablePagination-actions button:last-child, .ant-pagination-next:not(.ant-pagination-disabled)'
          )
          .first();
        const canGoNext =
          (await nextBtn.isVisible().catch(() => false)) &&
          (await nextBtn.isEnabled().catch(() => false)) &&
          (await nextBtn.getAttribute("aria-disabled").catch(() => null)) !== "true" &&
          !((await nextBtn.getAttribute("class").catch(() => "")) || "").includes("Mui-disabled");

        if (!canGoNext) break;
        await nextBtn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(1200);
      }

      if (totalScrapedClassRows === 0) {
        if (classListApiError) {
          throw new Error(classListApiError);
        }
        const isConfirmedEmptyTable = await page
          .evaluate(() => {
            const table = document.querySelector("table");
            if (!table) return false;
            const bodyText = (
              document.body?.innerText ||
              document.body?.textContent ||
              ""
            )
              .replace(/\s+/g, " ")
              .trim();
            const tableText = (table.innerText || table.textContent || "")
              .replace(/\s+/g, " ")
              .trim();
            const hasLoadError =
              /\b(unable to load|failed to load|error loading|try again|something went wrong|network error|bad gateway|service unavailable)\b/i.test(
                bodyText
              );
            if (hasLoadError) return false;
            const hasSpinner = Boolean(
              document.querySelector(
                '.MuiCircularProgress-root, .ant-spin-spinning, [role="progressbar"], [aria-busy="true"]'
              )
            );
            if (hasSpinner) return false;
            return /\b(no classes|no data|no results|no records|không có lớp|chưa có lớp|không có dữ liệu)\b/i.test(
              tableText
            );
          })
          .catch(() => false);

        if (!isConfirmedEmptyTable) {
          throw new Error(
            "Không tải được bảng danh sách lớp trên MindX LMS (/admin/classes)."
          );
        }
      }

      // Also include any previously synced SQLite classes that reached Buổi 12–14 and whose Buổi 14
      // is within FINISHED_CLASS_GRACE_DAYS (15 days), even if they were on a later page of /admin/classes
      try {
        const priorRunningList =
          typeof getRunningClasses === "function" ? getRunningClasses() || [] : [];
        const priorRunningMap = new Map<string, RunningClassItem>();
        for (const item of priorRunningList) {
          const c = String(item?.classCode || "").trim().toUpperCase();
          if (c) priorRunningMap.set(c, item);
        }

        const db = getDb();
        if (typeof (db as any)?.prepare === "function") {
          const dbClasses = (db as any)
            .prepare(
              `SELECT classId, MAX(className) AS className, MAX(sessionNumber) AS maxSess
               FROM classes_sessions
               GROUP BY classId
               HAVING MAX(sessionNumber) >= 12`
            )
            .all() as Array<{ classId: string; className?: string; maxSess: number }>;
          const nowIso = new Date().toISOString();
          for (const row of dbClasses) {
            const code = String(row.classId || "").trim().toUpperCase();
            if (!code || /^(TEST|AUDIT|R\d+|CLASS_|SYNTH)/i.test(code)) continue;
            if (collectedMap.has(code)) continue;
            const priorItem = priorRunningMap.get(code);
            const graceCheck = isFinishedClassWithinGraceWindow(
              code,
              priorItem?.endDate || null,
              spckDbFinishedGraceDays,
              nowMs
            );
            if (graceCheck.isKnownDate && graceCheck.withinWindow) {
              const isStillRunningBeforeEndDate =
                (graceCheck.daysSinceSession14 ?? 1) <= 0 &&
                isConfirmedRunningStatus(priorItem?.status);
              collectedMap.set(code, {
                ...(priorItem || {}),
                classCode: code,
                courseName:
                  priorItem?.courseName ||
                  (row.className && row.className !== code ? row.className : ""),
                status: isStillRunningBeforeEndDate ? "Running" : "Finished",
                endDate: graceCheck.session14Date || priorItem?.endDate,
                updatedAt: nowIso,
              });
            }
          }
        }
      } catch {
        // Ignore DB fallback errors
      }

      const activeRunningCodeSet = new Set(
        Array.from(collectedMap.values())
          .filter((c) => isConfirmedRunningStatus(c.status))
          .map((c) => c.classCode)
      );
      const runningList = Array.from(collectedMap.values()).filter(
        (c) =>
          c.status !== "Finished" ||
          !isFinishedClassSupersededByRunningSuccessor(c.classCode, activeRunningCodeSet)
      );
      const shouldPersist = options?.persistToConfig !== false;
      if (shouldPersist) {
        saveRunningClasses(runningList);
        if (Object.keys(discoveredLmsClassIds).length > 0) {
          try {
            saveLmsClassIdMappingsBatch(discoveredLmsClassIds);
          } catch {}
        }
      }

      const finalClasses = runningList;
      const runningOnlyCount = finalClasses.filter((c) => isConfirmedRunningStatus(c.status)).length;
      const recentFinishedCount = finalClasses.filter((c) => c.status === "Finished").length;

      jobLogRepo.add({
        jobId,
        jobType: "SYNC_CLASS",
        level: "SUCCESS",
        message: `Đã lấy thành công ${finalClasses.length} lớp từ LMS (${runningOnlyCount} lớp Running + ${recentFinishedCount} lớp Finished trong vòng ${DASHBOARD_FINISHED_CLASS_GRACE_DAYS} ngày sau Buổi 14): ${finalClasses
          .map((c) => `${c.classCode}${c.status === "Finished" ? " [Finished]" : ""}`)
          .join(", ")}.`,
      });

      return {
        success: true,
        classes: finalClasses,
      };
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      jobLogRepo.add({
        jobId,
        jobType: "SYNC_CLASS",
        level: "ERROR",
        message: `Lỗi lấy danh sách lớp đang học từ LMS: ${errMsg}`,
      });
      return {
        success: false,
        classes: getRunningClasses(),
        error: errMsg,
      };
    } finally {
      if (typeof page.off === "function") {
        page.off("request", onClassListApiRequest);
        page.off("response", onClassListApiResponse);
      }
    }
  }

  /**
   * Scrapes the exact Start Date ("Bắt đầu") and End Date ("Kết thúc") columns
   * for a specific classCode directly from the MindX LMS `/admin/classes` table (Ảnh 3).
   */
  public static async fetchClassDatesFromLms(
    rawClassCode: string,
    options?: { testPage?: Page; skipAuth?: boolean; searchTimeoutMs?: number }
  ): Promise<{
    success: boolean;
    classCode: string;
    courseName: string;
    startDateIso: string;
    endDateIso: string;
    startDateDmy: string;
    endDateDmy: string;
    source: "LMS_LIVE" | "NONE";
    error?: string;
  }> {
    const classCode = String(rawClassCode || "").trim().toUpperCase();
    const jobId = `fetch_lms_dates_${classCode}_${Date.now()}`;
    jobLogRepo.add({
      jobId,
      jobType: "SYNC_CLASS",
      classId: classCode,
      level: "INFO",
      message: `Đang lấy Ngày bắt đầu & Ngày kết thúc của lớp ${classCode} từ bảng Lớp học LMS...`,
    });

    const page =
      options?.testPage ??
      (await (async () => {
        const browserManager = BrowserManager.getInstance();
        return typeof browserManager.getPage === "function"
          ? await browserManager.getPage()
          : (await browserManager.getContext()).pages()[0] ||
              (await (await browserManager.getContext()).newPage());
      })());
    const interceptor = createNetworkInterceptor(page);

    try {
      if (!options?.skipAuth && !options?.testPage) {
        await authService.ensureAuthenticated("LMS");
      }

      // Close any open class drawer first so the classes table is accessible
      const existingDrawer = page
        .locator('div[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight')
        .first();
      if (await existingDrawer.isVisible().catch(() => false)) {
        await page.keyboard.press("Escape").catch(() => {});
        const closeBtn = page.locator(SELECTORS.classes.closeDrawerButton).first();
        if (await closeBtn.isVisible().catch(() => false)) {
          await closeBtn.click().catch(() => {});
        }
        await page.waitForTimeout(500);
      }

      const url = page.url();
      const { hostname, pathname } = parseUrlParts(url);
      if (
        !options?.testPage &&
        (!hostname ||
          isLoginHostOrPath(url, "lms.mindx.edu.vn") ||
          pathname.includes("/dashboard") ||
          (!pathname.includes("/class") && !pathname.includes("/classes")))
      ) {
        const baseLmsUrl = config.lmsUrl
          .replace(/\/+$/, "")
          .replace(/\/(admin\/)?(classes|class|dashboard)$/i, "");
        const navResponsePromise = page
          .waitForResponse(
            (res) =>
              (res.url().includes("lms-api.mindx.edu.vn") ||
                res.url().includes("graphql") ||
                res.url().includes("/classes")) &&
              res.request().method() !== "OPTIONS",
            { timeout: 12000 }
          )
          .catch(() => null);
        await page
          .goto(`${baseLmsUrl}/admin/classes`, {
            waitUntil: "domcontentloaded",
            timeout: 25000,
          })
          .catch(() => {});
        const navApiRes = await navResponsePromise;
        if (!navApiRes) {
          throw new Error("Hết thời gian chờ phản hồi API bảng Lớp học trên LMS.");
        }
        if (navApiRes.status() < 200 || navApiRes.status() >= 300) {
          throw new Error(
            `API bảng Lớp học LMS trả về lỗi HTTP ${navApiRes.status()}.`
          );
        }
      }

      await interceptor.dismissForbiddenToast();

      // F11 Guard: Search for classCode in the search input on /admin/classes and strictly verify the class-search API response
      const searchInput = page.locator(SELECTORS.classes.searchInput).first();
      const isSearchVisible = await searchInput.isVisible().catch(() => false);
      if (!isSearchVisible) {
        throw new Error(
          "Không tìm thấy ô tìm kiếm lớp học trên trang /admin/classes của LMS."
        );
      }

      const searchApiPromise = page
        .waitForResponse(
          (res) =>
            isLmsClassSearchRequestForCode(
              res.url(),
              res.request().method(),
              String(res.request().postData() || ""),
              classCode
            ),
          { timeout: options?.searchTimeoutMs ?? 10000 }
        )
        .catch(() => null);

      await searchInput.click({ force: true }).catch(() => {});
      await searchInput.fill("");
      await searchInput.fill(classCode);
      await searchInput.press("Enter").catch(() => {});
      await page.keyboard.press("Enter").catch(() => {});

      const searchApiRes = await searchApiPromise;
      if (!searchApiRes) {
        throw new Error(
          `Hết thời gian chờ phản hồi API tìm kiếm lớp ${classCode} trên MindX LMS.`
        );
      }
      if (searchApiRes.status() < 200 || searchApiRes.status() >= 300) {
        throw new Error(
          `API tìm kiếm lớp ${classCode} trên LMS trả về lỗi HTTP ${searchApiRes.status()}.`
        );
      }
      const searchJson = await searchApiRes.json().catch(() => null);
      if (
        searchJson &&
        Array.isArray(searchJson.errors) &&
        searchJson.errors.length > 0
      ) {
        throw new Error(
          `API GraphQL tìm kiếm lớp ${classCode} trả về lỗi: ${
            searchJson.errors[0]?.message || "GraphQL Error"
          }`
        );
      }
      if (!doesLmsClassSearchPayloadMatchCode(searchJson, classCode)) {
        throw new Error(
          `Phản hồi API tìm kiếm lớp trên LMS không chứa mã lớp chính xác ${classCode}.`
        );
      }
      await page.waitForTimeout(400);

      await interceptor.dismissForbiddenToast();

      const rowMatch = (await page.evaluate(`(() => {
        const targetCode = ${JSON.stringify(classCode)};
        const trs = Array.from(document.querySelectorAll("table tbody tr"));
        for (const tr of trs) {
          if (tr.closest('[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight')) {
            continue;
          }
          const tds = Array.from(tr.querySelectorAll("td")).map((td) =>
            (td.innerText || td.textContent || "").replace(/\\s+/g, " ").trim()
          );
          if (tds.length < 2) continue;
          const matchesTarget = tds.some((c) => c.toUpperCase() === targetCode);
          if (!matchesTarget) continue;

          const courseName = (tds[2] || "").trim();
          const center = (tds[3] || "").trim();
          const dateMatches = [];
          for (const cell of tds) {
            const matches =
              cell.match(
                /\\b(?:\\d{1,2}[\\/\\-]\\d{1,2}[\\/\\-]\\d{2,4}|\\d{4}[\\/\\-]\\d{1,2}[\\/\\-]\\d{1,2})\\b/g
              ) || [];
            for (const m of matches) {
              dateMatches.push(m);
            }
          }
          return {
            found: true,
            courseName,
            center,
            rawStart: dateMatches.length >= 2 ? dateMatches[0] : "",
            rawEnd: dateMatches.length > 0 ? dateMatches[dateMatches.length - 1] : "",
          };
        }
        return { found: false, courseName: "", center: "", rawStart: "", rawEnd: "" };
      })()`)) as {
        found: boolean;
        courseName: string;
        center: string;
        rawStart: string;
        rawEnd: string;
      };

      if (rowMatch.found && rowMatch.rawStart && rowMatch.rawEnd) {
        const startMs = parseClassDateToEndOfDayMs(rowMatch.rawStart);
        const endMs = parseClassDateToEndOfDayMs(rowMatch.rawEnd);
        const startDateDmy = startMs !== null ? formatMsToDdMmYyyy(startMs) : "";
        const endDateDmy = endMs !== null ? formatMsToDdMmYyyy(endMs) : "";
        const startDateIso = startMs !== null ? formatMsToIsoYmd(startMs) : "";
        const endDateIso = endMs !== null ? formatMsToIsoYmd(endMs) : "";

        if (!startDateIso || !endDateIso) {
          throw new Error(
            `Dòng lớp ${classCode} trên LMS thiếu ngày Bắt đầu hoặc Kết thúc hợp lệ (${rowMatch.rawStart} - ${rowMatch.rawEnd}).`
          );
        }

        // Persist into running_classes.json cache
        const existingList = getRunningClasses();
        const idx = existingList.findIndex(
          (c) => String(c.classCode || "").trim().toUpperCase() === classCode
        );
        const nowIso = new Date().toISOString();
        if (idx >= 0) {
          existingList[idx] = {
            ...existingList[idx],
            courseName: rowMatch.courseName || existingList[idx].courseName,
            center: rowMatch.center || existingList[idx].center,
            startDate: startDateDmy,
            endDate: endDateDmy,
            updatedAt: nowIso,
          };
        } else {
          existingList.unshift({
            classCode,
            courseName: rowMatch.courseName,
            center: rowMatch.center,
            status: "Running",
            startDate: startDateDmy,
            endDate: endDateDmy,
            updatedAt: nowIso,
          });
        }
        saveRunningClasses(existingList);

        jobLogRepo.add({
          jobId,
          jobType: "SYNC_CLASS",
          classId: classCode,
          level: "SUCCESS",
          message: `Đã lấy ngày khóa học lớp ${classCode} trực tiếp từ LMS: Bắt đầu ${startDateDmy} - Kết thúc ${endDateDmy}.`,
        });

        return {
          success: true,
          classCode,
          courseName: rowMatch.courseName,
          startDateIso,
          endDateIso,
          startDateDmy,
          endDateDmy,
          source: "LMS_LIVE",
        };
      }

      throw new Error(
        `Không tìm thấy dòng lớp ${classCode} hoặc cột ngày Bắt đầu / Kết thúc trên bảng Lớp học LMS.`
      );
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      jobLogRepo.add({
        jobId,
        jobType: "SYNC_CLASS",
        classId: classCode,
        level: "ERROR",
        message: `Lỗi lấy ngày lớp ${classCode} từ LMS: ${errMsg}`,
      });
      return {
        success: false,
        classCode,
        courseName: "",
        startDateIso: "",
        endDateIso: "",
        startDateDmy: "",
        endDateDmy: "",
        source: "NONE",
        error: errMsg,
      };
    }
  }

  /**
   * Resolves the MindX LMS backend `lmsClassId` (ObjectId) for a given `classCode`
   * using local cache first, then live Playwright lookup:
   *   Tier 0: Currently open class Drawer URL/payload matching `classCode`
   *   Tier 1: `/admin/classes` table search input -> GraphQL/REST API JSON `id`
   *   Tier 2: Open class Drawer via `LmsHelpers.openClassDrawer` -> `GetClassById` / URL `?id=`
   */
  public static async resolveLmsClassId(
    rawClassCode: string,
    options?: {
      testPage?: Page;
      skipAuth?: boolean;
      searchTimeoutMs?: number;
      persistToConfig?: boolean;
    }
  ): Promise<{
    success: boolean;
    classCode: string;
    lmsClassId: string;
    source: "CACHE" | "LMS_DRAWER_URL" | "LMS_SEARCH_API" | "LMS_DRAWER";
    error?: string;
  }> {
    const classCode = String(rawClassCode || "").trim().toUpperCase();
    if (!isValidLmsClassCode(classCode)) {
      return {
        success: false,
        classCode,
        lmsClassId: "",
        source: "CACHE",
        error: "Mã lớp (classCode) không hợp lệ.",
      };
    }

    const cached = resolveKnownLmsClassId(classCode);
    if (
      cached.lmsClassId &&
      isValidLmsClassObjectId(cached.lmsClassId) &&
      cached.lmsClassId.toUpperCase() !== classCode
    ) {
      return {
        success: true,
        classCode,
        lmsClassId: cached.lmsClassId,
        source: "CACHE",
      };
    }

    const jobId = `resolve_lms_id_${classCode}_${Date.now()}`;
    jobLogRepo.add({
      jobId,
      jobType: "SYNC_CLASS",
      classId: classCode,
      level: "INFO",
      message: `Đang lấy đường dẫn LMS trực tiếp của lớp ${classCode}...`,
    });

    const persistIfAllowed = (resolvedId: string) => {
      if (
        options?.persistToConfig !== false &&
        !options?.testPage &&
        !/^(TEST|AUDIT|R\d+|CLASS_|SYNTH)/i.test(classCode)
      ) {
        try {
          saveLmsClassIdMapping(classCode, resolvedId);
        } catch {}
      }
    };

    const page =
      options?.testPage ??
      (await (async () => {
        const browserManager = BrowserManager.getInstance();
        return typeof browserManager.getPage === "function"
          ? await browserManager.getPage()
          : (await browserManager.getContext()).pages()[0] ||
              (await (await browserManager.getContext()).newPage());
      })());
    const interceptor = createNetworkInterceptor(page);

    let capturedDrawerGqlId: string | null = null;
    const pendingDrawerGqlTasks = new Set<Promise<void>>();
    const onDrawerResponse = (res: any) => {
      try {
        const resUrl = typeof res?.url === "function" ? res.url() : "";
        const reqObj = typeof res?.request === "function" ? res.request() : null;
        if (!resUrl.includes("mindx.edu.vn") || !reqObj) return;
        if (typeof reqObj.method === "function" && reqObj.method() !== "POST") return;
        let reqBody: any;
        try {
          reqBody = reqObj.postDataJSON?.();
        } catch {
          return;
        }
        if (reqBody?.operationName !== "GetClassById") return;

        const task = (async () => {
          try {
            const status = typeof res.status === "function" ? res.status() : 200;
            if (status < 200 || status >= 300) return;
            const resJson = await res.json();
            if (resJson && Array.isArray(resJson.errors) && resJson.errors.length > 0) return;
            const clsPayload =
              resJson?.data?.classesById ||
              resJson?.data?.class ||
              resJson?.data?.getClassById;
            if (!clsPayload || typeof clsPayload !== "object") return;
            const payloadCode = String(
              clsPayload.name || clsPayload.code || clsPayload.classCode || ""
            )
              .trim()
              .toUpperCase();
            if (payloadCode && payloadCode !== classCode) return;
            const rawId = String(clsPayload.id ?? clsPayload._id ?? "").trim();
            if (
              isValidLmsClassObjectId(rawId) &&
              rawId.toUpperCase() !== classCode
            ) {
              capturedDrawerGqlId = rawId;
            }
          } catch {}
        })();
        pendingDrawerGqlTasks.add(task);
        task.finally(() => {
          pendingDrawerGqlTasks.delete(task);
        });
      } catch {}
    };

    try {
      if (!options?.skipAuth && !options?.testPage) {
        await authService.ensureAuthenticated("LMS");
      }

      await interceptor.dismissForbiddenToast();

      const escapedTarget = classCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const exactCodeBoundary = new RegExp(
        `(^|[^a-zA-Z0-9_-])${escapedTarget}([^a-zA-Z0-9_-]|$)`,
        "i"
      );

      // Tier 0: Check if the target class Drawer is already open with `?id=...` in URL
      const existingDrawer = page
        .locator('div[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight')
        .first();
      if (await existingDrawer.isVisible().catch(() => false)) {
        const existingText = await existingDrawer.innerText().catch(() => "");
        if (exactCodeBoundary.test(existingText)) {
          const urlId = extractLmsClassIdFromDrawerUrl(
            typeof page.url === "function" ? page.url() : ""
          );
          if (urlId && urlId.toUpperCase() !== classCode) {
            persistIfAllowed(urlId);
            jobLogRepo.add({
              jobId,
              jobType: "SYNC_CLASS",
              classId: classCode,
              level: "SUCCESS",
              message: `Đã lấy ID lớp ${classCode} từ Drawer LMS đang mở.`,
            });
            return {
              success: true,
              classCode,
              lmsClassId: urlId,
              source: "LMS_DRAWER_URL",
            };
          }
        }

        // Close open drawer so the `/admin/classes` search input is accessible
        const backBtn = existingDrawer.locator('button:has-text("Back")').first();
        if (await backBtn.isVisible().catch(() => false)) {
          await backBtn.click({ force: true }).catch(() => {});
        } else {
          await page.keyboard.press("Escape").catch(() => {});
          const closeBtn = page.locator(SELECTORS.classes.closeDrawerButton).first();
          if (await closeBtn.isVisible().catch(() => false)) {
            await closeBtn.click({ force: true }).catch(() => {});
          }
        }
        await page.waitForTimeout(500);
      }

      const currentUrl = typeof page.url === "function" ? page.url() : "";
      const { hostname, pathname } = parseUrlParts(currentUrl);
      if (
        !options?.testPage &&
        (!hostname ||
          isLoginHostOrPath(currentUrl, "lms.mindx.edu.vn") ||
          pathname.includes("/dashboard") ||
          (!pathname.includes("/class") && !pathname.includes("/classes")))
      ) {
        const baseLmsUrl = config.lmsUrl
          .replace(/\/+$/, "")
          .replace(/\/(admin\/)?(classes|class|dashboard)$/i, "");
        await page
          .goto(`${baseLmsUrl}/admin/classes`, {
            waitUntil: "domcontentloaded",
            timeout: 25000,
          })
          .catch(() => {});
        await page
          .locator(SELECTORS.classes.searchInput)
          .first()
          .waitFor({ state: "visible", timeout: 8000 })
          .catch(() => {});
      }

      await interceptor.dismissForbiddenToast();

      // Tier 1: Fast Search API lookup without needing to render full student/slot tabs
      const searchInput = page.locator(SELECTORS.classes.searchInput).first();
      const isSearchVisible = await searchInput.isVisible().catch(() => false);
      if (isSearchVisible) {
        const searchApiPromise = page
          .waitForResponse(
            (res) =>
              isLmsClassSearchRequestForCode(
                res.url(),
                res.request().method(),
                String(res.request().postData() || ""),
                classCode
              ),
            { timeout: options?.searchTimeoutMs ?? 8000 }
          )
          .catch(() => null);

        await searchInput.click({ force: true }).catch(() => {});
        await searchInput.fill("");
        await searchInput.fill(classCode);
        await searchInput.press("Enter").catch(() => {});
        await page.keyboard.press("Enter").catch(() => {});

        const searchApiRes = await searchApiPromise;
        if (
          searchApiRes &&
          searchApiRes.status() >= 200 &&
          searchApiRes.status() < 300
        ) {
          const searchJson = await searchApiRes.json().catch(() => null);
          const apiId = extractLmsClassIdFromSearchPayload(searchJson, classCode);
          if (apiId && apiId.toUpperCase() !== classCode) {
            persistIfAllowed(apiId);
            jobLogRepo.add({
              jobId,
              jobType: "SYNC_CLASS",
              classId: classCode,
              level: "SUCCESS",
              message: `Đã lấy ID lớp ${classCode} trực tiếp từ API tìm kiếm LMS.`,
            });
            return {
              success: true,
              classCode,
              lmsClassId: apiId,
              source: "LMS_SEARCH_API",
            };
          }
        }
      }

      // Tier 2 Fallback: Open the class Drawer and capture GetClassById / URL `?id=`
      if (typeof (page as any)?.on === "function") {
        (page as any).on("response", onDrawerResponse);
      }

      await LmsHelpers.openClassDrawer(page, classCode);
      if (pendingDrawerGqlTasks.size > 0) {
        await Promise.allSettled(Array.from(pendingDrawerGqlTasks));
      } else {
        await page.waitForTimeout(400);
        if (pendingDrawerGqlTasks.size > 0) {
          await Promise.allSettled(Array.from(pendingDrawerGqlTasks));
        }
      }

      const fallbackUrlId = extractLmsClassIdFromDrawerUrl(
        typeof page.url === "function" ? page.url() : ""
      );
      const drawerId =
        capturedDrawerGqlId ||
        (fallbackUrlId && fallbackUrlId.toUpperCase() !== classCode
          ? fallbackUrlId
          : null);

      if (drawerId) {
        persistIfAllowed(drawerId);
        jobLogRepo.add({
          jobId,
          jobType: "SYNC_CLASS",
          classId: classCode,
          level: "SUCCESS",
          message: `Đã lấy ID lớp ${classCode} từ Drawer chi tiết trên LMS.`,
        });
        return {
          success: true,
          classCode,
          lmsClassId: drawerId,
          source: "LMS_DRAWER",
        };
      }

      throw new Error(
        `Không tìm thấy ID lớp ${classCode} từ phản hồi API hoặc Drawer của MindX LMS.`
      );
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      jobLogRepo.add({
        jobId,
        jobType: "SYNC_CLASS",
        classId: classCode,
        level: "ERROR",
        message: `Lỗi lấy đường dẫn LMS lớp ${classCode}: ${errMsg}`,
      });
      return {
        success: false,
        classCode,
        lmsClassId: "",
        source: "LMS_DRAWER",
        error: errMsg,
      };
    } finally {
      if (typeof (page as any)?.off === "function") {
        try {
          (page as any).off("response", onDrawerResponse);
        } catch {}
      }
    }
  }
}
