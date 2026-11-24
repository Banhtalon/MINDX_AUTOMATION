export type HomeworkViewMode = "practice" | "both" | "quiz";

export interface HomeworkCellInput {
  status?: "GRADED" | "SUBMITTED_UNGRADED" | "NOT_SUBMITTED" | "REDO_REQUESTED" | string;
  score?: number | null;
  quizScore?: number | null;
}

export interface HomeworkCompletionItem {
  key: "practice" | "quiz";
  prefix: "TH" | "Q" | null;
  done: boolean;
  label: "Đã làm" | "Chưa làm";
}

/**
 * Shortens verbose LMS column titles (e.g. "Homework 12" -> "HW 12")
 * so all homework sessions fit compactly in the matrix and exported PNG.
 */
export function getHomeworkColumnShortLabel(title?: string, sessionNumber?: number): string {
  const clean = String(title || "").trim();
  if (!/^(?:homework|bài\s*tập|btvn)\b/i.test(clean)) {
    if (
      /(?:checkpoint|check\s*[-_]?\s*point|cp|bài\s*kiểm\s*tra(?:\s*định\s*kỳ)?(?:\s*lần)?|kiểm\s*tra\s*định\s*kỳ(?:\s*lần)?)\s*[-_#]?\s*0?2\b/i.test(
        clean
      )
    ) {
      return "CP 2";
    }
    if (
      /(?:checkpoint|check\s*[-_]?\s*point|cp|bài\s*kiểm\s*tra(?:\s*định\s*kỳ)?(?:\s*lần)?|kiểm\s*tra\s*định\s*kỳ(?:\s*lần)?)\s*[-_#]?\s*0?1\b/i.test(
        clean
      )
    ) {
      return "CP 1";
    }
  }
  const hwMatch = clean.match(/^homework\s*(\d+)$/i);
  if (hwMatch) {
    return `HW ${hwMatch[1]}`;
  }
  const buoiMatch = clean.match(/^(?:buổi|b)\s*(\d+)$/i);
  if (buoiMatch) {
    return `HW ${buoiMatch[1]}`;
  }
  if (clean.length > 0 && clean.length <= 10) {
    return clean;
  }
  if (typeof sessionNumber === "number" && Number.isFinite(sessionNumber) && sessionNumber > 0) {
    return `HW ${sessionNumber}`;
  }
  return clean.slice(0, 10) || "HW";
}

/**
 * Resolves whether practice and quiz parts of a homework cell are completed.
 * Submitted-ungraded LMS entries count as completed ("Đã làm") for practice.
 */
export function resolveHomeworkCompletionState(cell?: HomeworkCellInput | null): {
  practiceDone: boolean;
  quizDone: boolean;
} {
  if (!cell) {
    return { practiceDone: false, quizDone: false };
  }
  const practiceDone = cell.status === "GRADED" || cell.status === "SUBMITTED_UNGRADED";
  const quizDone = typeof cell.quizScore === "number" && Number.isFinite(cell.quizScore);
  return { practiceDone, quizDone };
}

/**
 * Builds the exact list of completion badges for a cell based on the active viewMode.
 * In "both" mode (Cách A), returns two separate items: Practice (TH) and Quiz (Q).
 */
export function getHomeworkCompletionItems(
  cell: HomeworkCellInput | null | undefined,
  viewMode: HomeworkViewMode
): HomeworkCompletionItem[] {
  const { practiceDone, quizDone } = resolveHomeworkCompletionState(cell);

  if (viewMode === "practice") {
    return [
      {
        key: "practice",
        prefix: null,
        done: practiceDone,
        label: practiceDone ? "Đã làm" : "Chưa làm",
      },
    ];
  }

  if (viewMode === "quiz") {
    return [
      {
        key: "quiz",
        prefix: null,
        done: quizDone,
        label: quizDone ? "Đã làm" : "Chưa làm",
      },
    ];
  }

  return [
    {
      key: "practice",
      prefix: "TH",
      done: practiceDone,
      label: practiceDone ? "Đã làm" : "Chưa làm",
    },
    {
      key: "quiz",
      prefix: "Q",
      done: quizDone,
      label: quizDone ? "Đã làm" : "Chưa làm",
    },
  ];
}
