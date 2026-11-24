/**
 * MINDX AUTOMATION BOT - CHECKPOINT COLUMN & SUBMISSION CLASSIFIER HELPERS
 * Pure, deterministic helpers for mapping Coding Checkpoint 1 (Session 5) & Checkpoint 2 (Session 9)
 * columns in MindX LMS `FindStudentSubmissionByClass` / `score_matrix_cache`, and detecting
 * dataset-only upload mistakes (e.g. student only uploaded `car-sales-data.csv` without `.ipynb`/`.py`).
 */

import path from "node:path";
import { isRoboticsClassCodePure } from "./competency-specs";

export interface MatrixColumnLike {
  colIndex?: number;
  columnId: string;
  lessonId?: string;
  title?: string;
  sessionNumber?: number;
  lessonType?: string;
}

const DATA_ONLY_EXTENSIONS = new Set([".csv", ".tsv"]);

const ANSWER_OR_CODE_EXTENSIONS = new Set([
  ".ipynb",
  ".py",
  ".ui",
  ".qss",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".sql",
  ".sb3",
  ".yyz",
  ".yyp",
  ".gml",
  ".yy",
  ".zip",
  ".rar",
  ".7z",
  ".docx",
  ".doc",
  ".pdf",
  ".txt",
  ".md",
  ".json",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
]);

/**
 * Returns true ONLY for dedicated Checkpoint columns (e.g. `lessonType === "CHECKPOINT"`
 * or `"Bài kiểm tra định kỳ lần 1 - CP1"` / `"KIỂM TRA ĐỊNH KỲ LẦN 2"`),
 * strictly excluding regular Homework columns such as `"Homework 5 - Hàm & Checkpoint 1"`.
 */
export function isDedicatedCheckpointColumn(col?: MatrixColumnLike | null): boolean {
  if (!col || typeof col !== "object") return false;
  const lessonType = String(col.lessonType || "").trim().toUpperCase();
  if (lessonType === "CHECKPOINT") return true;
  const title = String(col.title || "").trim();
  if (!title || /^(?:homework|bài\s*tập|btvn)\b/i.test(title)) {
    return false;
  }
  return /(?:bài\s*kiểm\s*tra|kiểm\s*tra\s*định\s*kỳ|^checkpoint\b|\bcp\s*[-_#]?\s*0?[12]\b)/i.test(
    title
  );
}

/**
 * Resolves whether a dedicated Checkpoint column corresponds to Checkpoint 1 (`1`) or Checkpoint 2 (`2`).
 */
export function resolveCheckpointColumnStage(col?: MatrixColumnLike | null): 1 | 2 | null {
  if (!isDedicatedCheckpointColumn(col)) return null;
  const titleStr = String(col?.title || "").trim();
  const idStr = String(col?.lessonId || col?.columnId || "").trim();
  const combined = `${titleStr} ${idStr}`.trim();

  if (
    /(?:checkpoint|check\s*[-_]?\s*point|cp|lần|định\s*kỳ(?:\s*lần)?)\s*[-_#]?\s*0?2\b/i.test(
      combined
    ) ||
    /(?:buổi|bài|session|slot|lesson)\s*0?(?:8|9)\b/i.test(titleStr)
  ) {
    return 2;
  }
  if (
    /(?:checkpoint|check\s*[-_]?\s*point|cp|lần|định\s*kỳ(?:\s*lần)?)\s*[-_#]?\s*0?1\b/i.test(
      combined
    ) ||
    /(?:buổi|bài|session|slot|lesson)\s*0?(?:4|5)\b/i.test(titleStr)
  ) {
    return 1;
  }
  if (Number(col?.sessionNumber) === 2 || Number(col?.sessionNumber) === 8 || Number(col?.sessionNumber) === 9) {
    return 2;
  }
  if (Number(col?.sessionNumber) === 1 || Number(col?.sessionNumber) === 4 || Number(col?.sessionNumber) === 5) {
    return 1;
  }
  return null;
}

/**
 * Maps Checkpoint stage (`1` or `2`) to the canonical session number of the class
 * (Coding: `5` & `9`; Robotics: `4` & `8`).
 */
export function getCanonicalCheckpointSessionNumber(
  stage: 1 | 2,
  classCode?: string | null
): number {
  const isRob = isRoboticsClassCodePure(classCode || "");
  if (isRob) return stage === 1 ? 4 : 8;
  return stage === 1 ? 5 : 9;
}

/**
 * Returns the Checkpoint stage (`1` or `2`) if `sessionNumber` is a Checkpoint session for `classCode`.
 */
export function getCheckpointStageFromSessionNumber(
  classCode: string | null | undefined,
  sessionNumber: number
): 1 | 2 | null {
  const isRob = isRoboticsClassCodePure(classCode || "");
  if (isRob) {
    if (sessionNumber === 4) return 1;
    if (sessionNumber === 8) return 2;
    return null;
  }
  if (sessionNumber === 5) return 1;
  if (sessionNumber === 9) return 2;
  return null;
}

/**
 * Checks whether a matrix column legitimately belongs to `targetSessionNumber` for `classCode`
 * (including backward compatibility with cached CP1/CP2 columns whose `sessionNumber` was parsed as `1`/`2`).
 */
export function doesColumnMatchSessionNumber(
  col: MatrixColumnLike,
  classCode: string,
  targetSessionNumber: number
): boolean {
  if (isDedicatedCheckpointColumn(col)) {
    const stage = resolveCheckpointColumnStage(col);
    if (stage) {
      return getCanonicalCheckpointSessionNumber(stage, classCode) === targetSessionNumber;
    }
  }
  return Number(col.sessionNumber) === targetSessionNumber;
}

/**
 * Resolves the authoritative matrix column for `(classCode, sessionNumber)` and optional `explicitLessonId`.
 * - For Coding Checkpoint sessions (`5` -> CP1, `9` -> CP2): prefers the dedicated `CHECKPOINT` column
 *   even if an empty `"Homework 5"` column also exists, and seamlessly handles legacy caches where CP1/CP2 had `sessionNumber: 1|2`.
 * - For regular Homework sessions: excludes dedicated `CHECKPOINT` columns so legacy `CP1 (sessionNumber=1)` never collides with `Homework 1`.
 */
export function resolveTargetMatrixColumn<T extends MatrixColumnLike>(
  columns: T[],
  classCode: string,
  sessionNumber: number,
  explicitLessonId?: string
): { column: T | null; mismatchError?: string } {
  if (!Array.isArray(columns) || columns.length === 0) {
    return { column: null };
  }

  if (explicitLessonId) {
    const cleanLessonId = String(explicitLessonId).trim();
    const byLesson = columns.find(
      (c) => c.columnId === cleanLessonId || c.lessonId === cleanLessonId
    );
    if (!byLesson) {
      return {
        column: null,
        mismatchError: `Không tìm thấy cột bài tập có lessonId='${cleanLessonId}' trong lớp ${classCode}.`,
      };
    }
    if (!doesColumnMatchSessionNumber(byLesson, classCode, sessionNumber)) {
      const actualSession = isDedicatedCheckpointColumn(byLesson)
        ? getCanonicalCheckpointSessionNumber(resolveCheckpointColumnStage(byLesson) || 1, classCode)
        : byLesson.sessionNumber;
      return {
        column: null,
        mismatchError: `[Integrity Violation] lessonId '${cleanLessonId}' thuộc Buổi ${actualSession}, không khớp với Buổi ${sessionNumber}.`,
      };
    }
    return { column: byLesson };
  }

  const cpStage = getCheckpointStageFromSessionNumber(classCode, sessionNumber);
  if (cpStage !== null) {
    const dedicatedCp = columns.find(
      (c) => isDedicatedCheckpointColumn(c) && resolveCheckpointColumnStage(c) === cpStage
    );
    if (dedicatedCp) {
      return { column: dedicatedCp };
    }
    const fallbackSameSession = columns.find(
      (c) => !isDedicatedCheckpointColumn(c) && Number(c.sessionNumber) === sessionNumber
    );
    return { column: fallbackSameSession || null };
  }

  const regularMatch = columns.find(
    (c) => !isDedicatedCheckpointColumn(c) && Number(c.sessionNumber) === sessionNumber
  );
  return { column: regularMatch || null };
}

/**
 * Strips MindX LMS upload timestamp prefix (e.g. `1795323429624-CSA04_thien_Checkpoint1.ipynb` -> `CSA04_thien_Checkpoint1.ipynb`).
 */
export function stripMindxUploadTimestampPrefix(rawFileName: string): string {
  const base = path.basename(String(rawFileName || "").trim());
  const stripped = base.replace(/^\d{10,16}-/, "").trim();
  return stripped || base;
}

/**
 * Classifies attachment filenames to detect dataset-only upload mistakes (e.g. student only uploaded `car-sales-data.csv`
 * without any `.ipynb` / `.py` / code / document file) and pick the primary display filename.
 */
export function classifySubmissionAttachments(attachments?: string[] | null): {
  cleanAttachments: string[];
  primaryFileName: string;
  hasCodeOrAnswerFile: boolean;
  isDatasetOnlyMistake: boolean;
  datasetFiles: string[];
  codeOrAnswerFiles: string[];
} {
  const cleanAttachments = Array.isArray(attachments)
    ? attachments.map((a) => String(a || "").trim()).filter(Boolean)
    : [];

  const datasetFiles: string[] = [];
  const codeOrAnswerFiles: string[] = [];

  for (const att of cleanAttachments) {
    const base = path.basename(att);
    const ext = path.extname(base).toLowerCase();
    if (DATA_ONLY_EXTENSIONS.has(ext)) {
      datasetFiles.push(base);
    } else if (ANSWER_OR_CODE_EXTENSIONS.has(ext) || ext.length > 0) {
      codeOrAnswerFiles.push(base);
    }
  }

  const hasCodeOrAnswerFile = codeOrAnswerFiles.length > 0;
  const isDatasetOnlyMistake = datasetFiles.length > 0 && !hasCodeOrAnswerFile;
  const primaryFileName =
    codeOrAnswerFiles[0] || datasetFiles[0] || "";

  return {
    cleanAttachments,
    primaryFileName,
    hasCodeOrAnswerFile,
    isDatasetOnlyMistake,
    datasetFiles,
    codeOrAnswerFiles,
  };
}
