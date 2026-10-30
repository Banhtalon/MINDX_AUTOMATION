import type { StudentScoreCell } from "@/lib/playwright/scrape-scores";

export type ScoreExportMode = "both" | "practice" | "quiz";

export type ExportableScoreCell = Pick<
  StudentScoreCell,
  "status" | "score" | "quizScore"
>;

/**
 * Unified cell formatter for both Excel/CSV export (`/api/homework-grader/export`)
 * and Google Sheets TSV copy (`/homework-grader`).
 */
export function formatCellForExport(
  cell?: ExportableScoreCell | null,
  mode: ScoreExportMode = "both"
): string | number {
  if (!cell) {
    return mode === "quiz" ? "Chưa làm" : "Chưa nộp";
  }

  if (mode === "quiz") {
    return typeof cell.quizScore === "number" ? cell.quizScore : "Chưa làm";
  }

  let basePractice: string | number;
  switch (cell.status) {
    case "GRADED":
      basePractice = typeof cell.score === "number" ? cell.score : 0;
      break;
    case "SUBMITTED_UNGRADED":
      basePractice = "Chưa chấm";
      break;
    case "REDO_REQUESTED":
      basePractice = "Làm lại";
      break;
    case "NOT_SUBMITTED":
    default:
      basePractice = "Chưa nộp";
      break;
  }

  if (mode === "both" && typeof cell.quizScore === "number") {
    return `${basePractice} (Quiz: ${cell.quizScore})`;
  }

  return basePractice;
}

/**
 * Neutralizes spreadsheet formula injection (`=`, `+`, `-`, `@`) while preserving numeric scores.
 */
export function sanitizeSpreadsheetCell(value: string | number): string | number {
  if (typeof value === "number") return value;
  const str = String(value ?? "");
  if (/^[\t\r\n ]*[=+\-@]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

if (typeof URL !== "undefined") {
  (URL as any).__mindxExportHelpers = {
    formatCellForExport,
    sanitizeSpreadsheetCell,
  };
}
if (typeof globalThis !== "undefined") {
  (globalThis as any).__mindxExportHelpers = {
    formatCellForExport,
    sanitizeSpreadsheetCell,
  };
}
if (typeof console !== "undefined") {
  (console as any).__mindxExportHelpers = {
    formatCellForExport,
    sanitizeSpreadsheetCell,
  };
}
