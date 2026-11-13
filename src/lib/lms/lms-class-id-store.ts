import fs from "node:fs";
import path from "node:path";
import { getLmsClassIdsMap, getRunningClasses } from "../db/json-config";
import { getDb } from "../db/sqlite";
import { assertPathAllowed } from "../security/path-allowlist";
import { isValidLmsClassCode, isValidLmsClassObjectId } from "./lms-class-url";

export type LmsClassIdLookupSource =
  | "CONFIG_CACHE"
  | "RUNNING_CLASSES"
  | "REPORT_CARDS_DB"
  | "NONE";

function resolveConfiguredDbPath(): string {
  const customDbPath = process.env.MINDX_DB_PATH?.trim();
  if (customDbPath) {
    return assertPathAllowed(path.resolve(process.cwd(), customDbPath));
  }
  return assertPathAllowed(path.resolve(process.cwd(), "data", "mindx_bot.db"));
}

function readReportCardSnapshotIds(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const dbPath = resolveConfiguredDbPath();
    if (!fs.existsSync(dbPath)) {
      return out;
    }
    const db = typeof getDb === "function" ? getDb() : null;
    if (!db || typeof (db as any).prepare !== "function") {
      return out;
    }
    const tableRow = (db as any)
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'class_report_cards'`
      )
      .get();
    if (!tableRow) {
      return out;
    }
    const rows = (db as any)
      .prepare(
        `SELECT classId, classCode, lmsSnapshotJson
         FROM class_report_cards
         WHERE TRIM(COALESCE(lmsSnapshotJson, '')) <> ''`
      )
      .all() as Array<{
      classId?: string;
      classCode?: string;
      lmsSnapshotJson?: string;
    }>;

    for (const row of rows) {
      const code = String(row?.classCode || row?.classId || "")
        .trim()
        .toUpperCase();
      if (!isValidLmsClassCode(code)) continue;
      try {
        const snap = JSON.parse(String(row.lmsSnapshotJson || "{}"));
        const candidateId = String(
          snap?.lmsClassId || snap?.id || snap?._id || snap?.classId || ""
        ).trim();
        if (
          isValidLmsClassObjectId(candidateId) &&
          candidateId.toUpperCase() !== code
        ) {
          out[code] = candidateId;
        }
      } catch {}
    }
  } catch {}
  return out;
}

/**
 * Merges known `{ [CLASS_CODE]: lmsClassId }` mappings (strictly read-only, zero DB/disk writes)
 * in ascending authority order:
 *   1. SQLite `class_report_cards.lmsSnapshotJson`
 *   2. `running_classes.json` (`item.lmsClassId`)
 *   3. `data/config/lms_class_ids.json`
 */
export function resolveKnownLmsClassIdsMap(): Record<string, string> {
  const merged: Record<string, string> = {
    ...readReportCardSnapshotIds(),
  };

  try {
    const running = typeof getRunningClasses === "function" ? getRunningClasses() : [];
    for (const item of running) {
      const code = String(item?.classCode || "").trim().toUpperCase();
      const id = String(item?.lmsClassId || "").trim();
      if (isValidLmsClassCode(code) && isValidLmsClassObjectId(id)) {
        merged[code] = id;
      }
    }
  } catch {}

  try {
    const configMap = typeof getLmsClassIdsMap === "function" ? getLmsClassIdsMap() : {};
    for (const [k, v] of Object.entries(configMap)) {
      const code = String(k || "").trim().toUpperCase();
      const id = String(v || "").trim();
      if (isValidLmsClassCode(code) && isValidLmsClassObjectId(id)) {
        merged[code] = id;
      }
    }
  } catch {}

  return merged;
}

/**
 * Resolves a single class's known `lmsClassId` and its local cache source (read-only).
 */
export function resolveKnownLmsClassId(rawClassCode: string): {
  lmsClassId: string | null;
  source: LmsClassIdLookupSource;
} {
  const code = String(rawClassCode || "").trim().toUpperCase();
  if (!isValidLmsClassCode(code)) {
    return { lmsClassId: null, source: "NONE" };
  }

  try {
    const configMap = typeof getLmsClassIdsMap === "function" ? getLmsClassIdsMap() : {};
    if (isValidLmsClassObjectId(configMap[code])) {
      return { lmsClassId: configMap[code], source: "CONFIG_CACHE" };
    }
  } catch {}

  try {
    const running = typeof getRunningClasses === "function" ? getRunningClasses() : [];
    const matched = running.find(
      (item) => String(item?.classCode || "").trim().toUpperCase() === code
    );
    const id = String(matched?.lmsClassId || "").trim();
    if (isValidLmsClassObjectId(id)) {
      return { lmsClassId: id, source: "RUNNING_CLASSES" };
    }
  } catch {}

  const snapshotIds = readReportCardSnapshotIds();
  if (isValidLmsClassObjectId(snapshotIds[code])) {
    return { lmsClassId: snapshotIds[code], source: "REPORT_CARDS_DB" };
  }

  return { lmsClassId: null, source: "NONE" };
}
