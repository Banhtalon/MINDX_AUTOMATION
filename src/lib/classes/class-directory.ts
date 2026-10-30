import { getRunningClasses, type RunningClassItem } from "@/lib/db/json-config";
import { getDb, studentRepo, type StudentRecord } from "@/lib/db/sqlite";
import {
  FINISHED_CLASS_GRACE_DAYS,
  isFinishedClassWithinGraceWindow,
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

  for (const code of orderedCodes) {
    const isSynth = isSyntheticClassCode(code);
    if (isSynth && !includeSynthetic) {
      continue;
    }

    const cachedItem = cachedRunningMap.get(code);
    const dbRow = dbRowMap.get(code);
    const isFinishedStatus = cachedItem?.status === "Finished";

    const activeSess = Number(dbRow?.activeSessionNumber) || 0;
    const maxSess = Number(dbRow?.maxSessionNumber) || 0;
    let currentSessionNumber = dbRow
      ? hasAnySyncedDate
        ? activeSess
        : maxSess
      : isFinishedStatus
      ? 14
      : 0;
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
      : cachedItem?.status === "Running"
      ? "Running"
      : !isSynth &&
        graceCheck.isKnownDate &&
        (graceCheck.daysSinceSession14 ?? -1) > 0
      ? "Finished"
      : "Running";

    // Unified 15-day grace rule for `running` and `spck` scopes:
    // Exclude classes that have finished Buổi 14 more than `includeFinishedDays` ago.
    if (
      scope !== "all" &&
      resolvedStatus === "Finished" &&
      graceCheck.isKnownDate &&
      !graceCheck.withinWindow &&
      (!isSynth || isFinishedStatus)
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
      maxSessionNumber: effectiveMaxSession,
      spckSessions: [12, 13, 14],
    };

    allClassesMap.set(code, entry);

    const isAllowed =
      !allowedClassCodes ||
      allowedClassCodes.size === 0 ||
      allowedClassCodes.has(code);
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
