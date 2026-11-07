import { getRunningClasses, type RunningClassItem } from "@/lib/db/json-config";
import { getDb, studentRepo, type StudentRecord } from "@/lib/db/sqlite";
import {
  FINISHED_CLASS_GRACE_DAYS,
  ONE_DAY_MS,
  formatMsToDdMmYyyy,
  isConfirmedRunningStatus,
  isFinishedClassSupersededByRunningSuccessor,
  isFinishedClassWithinGraceWindow,
  parseClassDateToEndOfDayMs,
  resolveClassDateRangeInfo,
} from "@/lib/playwright/sync-class";

/**
 * Single canonical regex for filtering synthetic / test / audit class codes
 * across all routes and screens.
 */
export const SYNTHETIC_CLASS_REGEX = /^(TEST|AUDIT|R\d+|CLASS_|SYNTH)/i;

export const DEFAULT_FINISHED_GRACE_DAYS = FINISHED_CLASS_GRACE_DAYS;

export type ClassDirectoryScope = "running" | "spck" | "all";

export interface ListClassesOptions {
  scope?: ClassDirectoryScope;
  includeFinishedDays?: number;
  minSessionNumber?: number;
  allowedClassCodes?: Set<string>;
  includeSynthetic?: boolean;
  nowMs?: number;
}

export interface ClassDirectoryItem extends RunningClassItem {
  classId: string;
  classCode: string;
  className: string;
  courseName?: string;
  center?: string;
  timeSlot?: string;
  status: "Running" | "Finished";
  startDate?: string;
  endDate?: string;
  session14Date?: string;
  currentSessionNumber: number;
  currentSessionDate?: string;
  maxSessionNumber: number;
  spckSessions: number[];
}

export function isSyntheticClassCode(classCode: unknown): boolean {
  const normalized = String(classCode ?? "").trim().toUpperCase();
  if (!normalized) return true;
  return SYNTHETIC_CLASS_REGEX.test(normalized);
}

interface DbAggregatedClassRow {
  classId: string;
  className: string;
  activeSessionNumber: number;
  maxSessionNumber: number;
  latestUpdatedAt?: string;
}

/**
 * Resolves the unified class directory and returns both the filtered `classes`
 * list for the requested `scope` and `allClassesMap` (pre-scope-session filter,
 * used by SPCK sync diffing).
 */
export function queryClassDirectory(options?: ListClassesOptions): {
  classes: ClassDirectoryItem[];
  allClassesMap: Map<string, ClassDirectoryItem>;
} {
  const scope: ClassDirectoryScope = options?.scope ?? "running";
  const includeFinishedDays =
    typeof options?.includeFinishedDays === "number" &&
    Number.isFinite(options.includeFinishedDays)
      ? Math.max(0, options.includeFinishedDays)
      : DEFAULT_FINISHED_GRACE_DAYS;
  const minSessionNumber =
    typeof options?.minSessionNumber === "number" &&
    Number.isFinite(options.minSessionNumber)
      ? options.minSessionNumber
      : 12;
  const includeSynthetic = Boolean(options?.includeSynthetic);
  const allowedClassCodes = options?.allowedClassCodes;
  const nowMs = options?.nowMs ?? Date.now();
  const todayDmy = formatMsToDdMmYyyy(nowMs);
  const todayEndMs = parseClassDateToEndOfDayMs(todayDmy) ?? nowMs;

  const cachedList =
    typeof getRunningClasses === "function" ? getRunningClasses() : [];
  const cachedRunningMap = new Map<string, RunningClassItem>();
  for (const item of cachedList) {
    const code = String(item?.classCode || "").trim().toUpperCase();
    if (!code) continue;
    cachedRunningMap.set(code, {
      ...item,
      classCode: code,
    });
  }

  let dbRows: DbAggregatedClassRow[] = [];
  const datedSessionRowsByClass = new Map<
    string,
    Array<{ sessionNumber: number; dateDmy: string; endMs: number }>
  >();
  try {
    const db = typeof getDb === "function" ? getDb() : null;
    if (typeof (db as any)?.prepare === "function") {
      dbRows = (db as any)
        .prepare(
          `SELECT
             classId,
             MAX(className) AS className,
             MAX(CASE WHEN TRIM(COALESCE(date, '')) <> '' THEN sessionNumber ELSE 0 END) AS activeSessionNumber,
             MAX(sessionNumber) AS maxSessionNumber,
             MAX(updatedAt) AS latestUpdatedAt
           FROM classes_sessions
           GROUP BY classId
           ORDER BY classId ASC`
        )
        .all() as DbAggregatedClassRow[];

      const rawDatedRows = (db as any)
        .prepare(
          `SELECT classId, sessionNumber, date
           FROM classes_sessions
           WHERE TRIM(COALESCE(date, '')) <> ''
           ORDER BY classId ASC, sessionNumber ASC`
        )
        .all() as Array<{ classId: string; sessionNumber: number; date: string }>;

      for (const dr of rawDatedRows) {
        const code = String(dr?.classId || "").trim().toUpperCase();
        const sNum = Number(dr?.sessionNumber) || 0;
        if (!code || sNum < 1) continue;
        const endMs = parseClassDateToEndOfDayMs(dr.date);
        if (endMs === null) continue;
        const list = datedSessionRowsByClass.get(code) || [];
        list.push({
          sessionNumber: sNum,
          dateDmy: formatMsToDdMmYyyy(endMs),
          endMs,
        });
        datedSessionRowsByClass.set(code, list);
      }
    }
  } catch {
    // Ignore DB errors when running in stripped / uninitialized environments
  }

  const dbRowMap = new Map<string, DbAggregatedClassRow>();
  for (const r of dbRows) {
    const code = String(r?.classId || "").trim().toUpperCase();
    if (!code) continue;
    dbRowMap.set(code, {
      ...r,
      classId: code,
    });
  }

  const hasAnySyncedDate = dbRows.some(
    (r) => Number(r?.activeSessionNumber) > 0
  );

  // Candidate ordering:
  // - For `spck`, prioritize SQLite `classes_sessions` ascending order (matching legacy SPCK list),
  //   followed by any cached running classes not yet in `dbRowMap`.
  // - For `running` and `all`, prioritize `running_classes.json` order, followed by SQLite `classes_sessions`.
  const orderedCodes: string[] = [];
  const seenCodes = new Set<string>();
  const pushCode = (raw: string) => {
    const code = String(raw || "").trim().toUpperCase();
    if (!code || seenCodes.has(code)) return;
    seenCodes.add(code);
    orderedCodes.push(code);
  };

  if (scope === "spck") {
    for (const r of dbRows) pushCode(r.classId);
    for (const item of cachedList) pushCode(item.classCode);
  } else {
    for (const item of cachedList) pushCode(item.classCode);
    for (const r of dbRows) pushCode(r.classId);
  }

  const allClassesMap = new Map<string, ClassDirectoryItem>();
  const classes: ClassDirectoryItem[] = [];
  const activeRunningCodeSet = new Set<string>();
  for (const [cCode, cItem] of cachedRunningMap.entries()) {
    if (isConfirmedRunningStatus(cItem.status)) {
      activeRunningCodeSet.add(cCode);
    }
  }

  for (const code of orderedCodes) {
    const isSynth = isSyntheticClassCode(code);
    if (isSynth && !includeSynthetic) {
      continue;
    }

    const cachedItem = cachedRunningMap.get(code);
    const dbRow = dbRowMap.get(code);
    const rawCachedStatus = String(cachedItem?.status || "").trim().toUpperCase();
    const isFinishedStatus = rawCachedStatus === "FINISHED";
    const isExplicitRunningStatus = isConfirmedRunningStatus(cachedItem?.status);

    const activeSess = Number(dbRow?.activeSessionNumber) || 0;
    const maxSess = Number(dbRow?.maxSessionNumber) || 0;
    const datedList = datedSessionRowsByClass.get(code) || [];
    const datedUpToToday = datedList.filter((d) => d.endMs <= todayEndMs);
    const anchorDated =
      datedUpToToday.length > 0
        ? datedUpToToday[datedUpToToday.length - 1]
        : datedList.length > 0
        ? datedList[0]
        : undefined;

    let currentSessionNumber = dbRow
      ? hasAnySyncedDate
        ? anchorDated?.sessionNumber ?? activeSess
        : maxSess
      : isFinishedStatus
      ? 14
      : 0;
    let currentSessionDate = anchorDated?.dateDmy || "";

    if (isFinishedStatus && currentSessionNumber < 14 && maxSess >= 14) {
      currentSessionNumber = 14;
    }

    const graceCheck = isFinishedClassWithinGraceWindow(
      code,
      cachedItem?.endDate,
      includeFinishedDays,
      nowMs
    );

    const resolvedStatus: "Running" | "Finished" = isFinishedStatus
      ? "Finished"
      : isExplicitRunningStatus
      ? "Running"
      : !isSynth &&
        graceCheck.isKnownDate &&
        (graceCheck.daysSinceSession14 ?? -1) > 0
      ? "Finished"
      : "Running";

    // Same-day / current-week advancement for Running classes:
    // If MindX LMS still had today's slot `.disabled` before the class's scheduled hour (so SQLite only has last week's date on session N),
    // and `anchorDated.endMs + 7 days` falls in the current week up to today (`<= todayEndMs` and within `< 7 days`),
    // automatically advance `currentSessionNumber` to `N + 1` and resolve `currentSessionDate` to today's session date —
    // UNLESS session `N + 1` already has an explicit future date (`endMs > todayEndMs`, e.g. postponed due to holiday).
    if (
      resolvedStatus === "Running" &&
      anchorDated &&
      anchorDated.endMs <= todayEndMs &&
      currentSessionNumber >= 1 &&
      currentSessionNumber < maxSess
    ) {
      const nextSessNum = anchorDated.sessionNumber + 1;
      const explicitNextDated = datedList.find(
        (d) => d.sessionNumber === nextSessNum
      );
      const isNextExplicitlyPostponed =
        explicitNextDated !== undefined && explicitNextDated.endMs > todayEndMs;
      if (!isNextExplicitlyPostponed) {
        const nextSessEndMs = anchorDated.endMs + 7 * ONE_DAY_MS;
        if (
          nextSessEndMs <= todayEndMs &&
          todayEndMs - nextSessEndMs < 7 * ONE_DAY_MS
        ) {
          currentSessionNumber = nextSessNum;
          currentSessionDate = formatMsToDdMmYyyy(nextSessEndMs);
        }
      }
    }

    // Unified grace rule for `running` and `spck` scopes:
    // Exclude classes that have finished Buổi 14 more than `includeFinishedDays` ago,
    // or have already transitioned to their next-tier Running class (e.g. JSB15 -> JSA15, PTA12 -> PTI12).
    if (
      scope !== "all" &&
      resolvedStatus === "Finished" &&
      (!isSynth || isFinishedStatus) &&
      ((graceCheck.isKnownDate && !graceCheck.withinWindow) ||
        isFinishedClassSupersededByRunningSuccessor(code, activeRunningCodeSet))
    ) {
      continue;
    }

    let startDate = cachedItem?.startDate;
    let endDate = cachedItem?.endDate;
    let courseName = cachedItem?.courseName;
    if (!startDate || !endDate || !courseName) {
      try {
        const range = resolveClassDateRangeInfo(code);
        if (!startDate && range.startDateDmy) startDate = range.startDateDmy;
        if (!endDate && range.endDateDmy) endDate = range.endDateDmy;
        if (!courseName) {
          courseName =
            dbRow?.className && dbRow.className !== code
              ? dbRow.className
              : range.courseName || "";
        }
      } catch {
        if (!courseName) {
          courseName =
            dbRow?.className && dbRow.className !== code
              ? dbRow.className
              : "";
        }
      }
    }

    const effectiveCurrentSession =
      resolvedStatus === "Finished"
        ? Math.max(currentSessionNumber, 14)
        : currentSessionNumber;
    const effectiveMaxSession =
      dbRow || resolvedStatus === "Finished" ? Math.max(maxSess, 14) : maxSess;
    const session14Date =
      graceCheck.session14Date || endDate || undefined;

    const exactEffectiveSessionDated = datedList.find(
      (d) => d.sessionNumber === effectiveCurrentSession
    );
    if (exactEffectiveSessionDated) {
      currentSessionDate = exactEffectiveSessionDated.dateDmy;
    } else if (
      anchorDated &&
      effectiveCurrentSession !== anchorDated.sessionNumber &&
      !(
        resolvedStatus === "Running" &&
        effectiveCurrentSession === anchorDated.sessionNumber + 1
      )
    ) {
      currentSessionDate = "";
    }

    if (!currentSessionDate) {
      if (effectiveCurrentSession === 14 && session14Date) {
        currentSessionDate = session14Date;
      } else if (effectiveCurrentSession === 1 && startDate) {
        currentSessionDate = startDate;
      }
    }

    const entry: ClassDirectoryItem = {
      ...(cachedItem || {}),
      classId: code,
      classCode: code,
      className: dbRow?.className || courseName || code,
      courseName: courseName || "",
      status: resolvedStatus,
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
      ...(session14Date ? { session14Date } : {}),
      currentSessionNumber: effectiveCurrentSession,
      ...(currentSessionDate ? { currentSessionDate } : {}),
      maxSessionNumber: effectiveMaxSession,
      spckSessions: [12, 13, 14],
    };

    allClassesMap.set(code, entry);

    const isAllowed =
      !allowedClassCodes || allowedClassCodes.has(code);
    if (!isAllowed) {
      continue;
    }

    if (scope === "spck") {
      // SPCK scope requires class sessions in SQLite and currentSessionNumber >= minSessionNumber (default 12)
      if (!dbRow || entry.currentSessionNumber < minSessionNumber) {
        continue;
      }
    }

    classes.push(entry);
  }

  return { classes, allClassesMap };
}

/**
 * Unified class list getter across all screens (`running` | `spck` | `all`).
 */
export function listClasses(options?: ListClassesOptions): ClassDirectoryItem[] {
  return queryClassDirectory(options).classes;
}

/**
 * Unified student list getter for a class.
 */
export function listStudents(
  classId: string,
  options?: { activeOnly?: boolean }
): StudentRecord[] {
  const normalizedClassId = String(classId || "").trim().toUpperCase();
  if (!normalizedClassId) return [];
  const activeOnly = options?.activeOnly ?? true;
  try {
    return studentRepo.findByClass(normalizedClassId, activeOnly);
  } catch {
    return [];
  }
}
