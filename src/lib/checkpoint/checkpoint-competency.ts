/**
 * MINDX AUTOMATION BOT - CHECKPOINT STAGE PROCESS & [ĐNL] COMPETENCY ENGINE (v3.8.6)
 * Pure, deterministic helpers (browser + server safe) for:
 *  1. Resolving Checkpoint sessions (Robotics: Buổi 4 & 8; Coding: Buổi 5 & 9).
 *  2. Parsing MindX LMS `commentByAreas` Checkpoint scores (LT & TH scale 5) + 9 `[ĐNL]` ratings.
 *  3. Reconciling #tab-10 slot manual LT/TH scores vs #tab-3 Submission Quiz/Practice scores + UI manual overrides.
 *  4. Computing process-based 9 `[ĐNL]` competency ratings (1..5) from stage history
 *     (prior session_feedbacks + classroom_session_logs + Coding BTVN matrix + LMS LT/TH scores).
 *  5. Formatting the deterministic Checkpoint score line (`📊 Kết quả Checkpoint [1/2]: ...`).
 *  6. Building the Zalo Group Checkpoint overview & praise block WITHOUT exposing per-student numeric scores.
 */

import {
  COMPETENCY_AREA_SPECS,
  COMPETENCY_KEYS,
  LEGO_COMPETENCY_AREA_SPECS,
  LEGO_COMPETENCY_KEYS,
  calculateCompetencyAverageForClassPure,
  calculateCompetencyAveragePure,
  clampCompetencyRating,
  getCompetencyKeysForClassPure,
  getCompetencySpecsForClassPure,
  hasCompleteCompetencyScores,
  hasCompleteCompetencyScoresForClassPure,
  isLegoRoboticsClassCodePure,
  isRoboticsClassCodePure,
  matchesCompetencyAreaIdPure,
  parseCompetencyScoresPure,
  type AnyCompetencyAreaSpec,
  type CompetencyAreaSpec,
  type CompetencyScores,
  type LegoCompetencyAreaSpec,
} from "./competency-specs";

function formatShortZaloName(fullName: string): string {
  const words = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.length >= 3 ? words.slice(1).join(" ") : words.join(" ");
}

export {
  COMPETENCY_AREA_SPECS,
  COMPETENCY_KEYS,
  LEGO_COMPETENCY_AREA_SPECS,
  LEGO_COMPETENCY_KEYS,
  calculateCompetencyAverageForClassPure,
  calculateCompetencyAveragePure,
  clampCompetencyRating,
  getCompetencyKeysForClassPure,
  getCompetencySpecsForClassPure,
  hasCompleteCompetencyScores,
  hasCompleteCompetencyScoresForClassPure,
  isLegoRoboticsClassCodePure,
  isRoboticsClassCodePure,
  matchesCompetencyAreaIdPure,
  parseCompetencyScoresPure,
  type AnyCompetencyAreaSpec,
  type CompetencyAreaSpec,
  type CompetencyScores,
  type LegoCompetencyAreaSpec,
};

export interface CheckpointStageInfo {
  isCheckpoint: boolean;
  isRobotics: boolean;
  isLego?: boolean;
  cpStage: 1 | 2 | null;
  stageStartSession: number;
  stageEndSession: number;
  previousCpSession: number | null;
}

export interface CheckpointProcessSummary {
  stageStartSession: number;
  stageEndSession: number;
  priorSessionsObserved: number;
  presentCount: number;
  lateCount: number;
  absentCount: number;
  totalStars: number;
  totalMedals: number;
  totalIssues: number;
  issueBreakdown: Record<string, number>;
  topStrengthTags: string[];
  topImprovementTags: string[];
  /** Coding classes only; null for Robotics (Robotics has no LMS BTVN) or when no BTVN cache exists */
  homeworkSummary: {
    gradedCount: number;
    totalEligible: number;
    completionRatePct: number;
    avgScore100: number | null;
  } | null;
  previousCheckpoint: {
    sessionNumber: number;
    theoryScore: number | null;
    practiceScore: number | null;
    competencyAverage: number | null;
  } | null;
}

export interface CheckpointStudentData {
  cpStage: 1 | 2;
  isRobotics: boolean;
  isLego?: boolean;
  /** Lý thuyết trên LMS (thang 5.0) — hợp nhất giữa #tab-10 và #tab-3 */
  theoryScore: number | null;
  /** Thực hành trên LMS (thang 5.0) — hợp nhất giữa #tab-10 và #tab-3 */
  practiceScore: number | null;
  /** Điểm Lý thuyết thô đọc trực tiếp từ #tab-10 Nhận xét LMS (thang 5.0) */
  slotTheoryScore?: number | null;
  /** Điểm Thực hành thô đọc trực tiếp từ #tab-10 Nhận xét LMS (thang 5.0) */
  slotPracticeScore?: number | null;
  /** Giáo viên chỉnh tay điểm Lý thuyết ngay trong Bot UI */
  userEditedTheory?: boolean;
  /** Giáo viên chỉnh tay điểm Thực hành ngay trong Bot UI */
  userEditedPractice?: boolean;
  /** Học viên đã nộp bài Thực hành Checkpoint bên #tab-3 LMS nhưng chưa chấm (0/1) */
  hasUngradedPractice?: boolean;
  /** 9 ô [ĐNL] (1..5) — Bot tự tính theo quá trình hoặc giáo viên chỉnh tay */
  competencyScores: CompetencyScores | null;
  competencyAverage: number | null;
  /** 9 ô [ĐNL] đang lưu trên LMS (nếu đã đồng bộ về) */
  lmsCompetencyScores?: CompetencyScores | null;
  processSummary?: CheckpointProcessSummary | null;
  source?: "AUTO_PROCESS" | "LMS_SYNC" | "MANUAL_UI";
  userEditedCompetency?: boolean;
  lmsSyncedAt?: string | null;
  computedAt?: string | null;
  /** Hash của (competencyScores + theoryScore + practiceScore) lúc Duyệt để phát hiện sửa sau khi duyệt */
  approvedSnapshotHash?: string | null;
}

export interface PriorSessionFeedbackInput {
  sessionNumber: number;
  attendanceStatus: string;
  quickTags: string[];
  teacherNote: string;
  finalText: string;
  checkpointData?: CheckpointStudentData | null;
}

export interface PriorClassroomLogInput {
  sessionNumber: number;
  attendanceStatus: string;
  stars: number;
  medals: number;
  issueCounts: Record<string, number>;
  praiseCounts?: Record<string, number>;
}

export interface HomeworkHistoryInput {
  gradedCount: number;
  totalEligible: number;
  completionRate: number | null;
  avgScore100: number | null;
}

export interface ComputeStudentProcessCompetencyInput {
  classCode: string;
  sessionNumber: number;
  theoryScore: number | null;
  practiceScore: number | null;
  priorFeedbacks: PriorSessionFeedbackInput[];
  classroomLogs: PriorClassroomLogInput[];
  homeworkHistory?: HomeworkHistoryInput | null;
  currentAttendanceStatus?: string;
  currentQuickTags?: string[];
  existingLmsRatings?: CompetencyScores | null;
}

export const CODING_CHECKPOINT_SESSIONS = [5, 9] as const;
export const ROBOTICS_CHECKPOINT_SESSIONS = [4, 8] as const;
export const LEGO_CHECKPOINT_SESSIONS = [5, 9] as const;

export function resolveCheckpointStageForSession(
  classCode?: string | null,
  sessionNumber?: number | null
): CheckpointStageInfo {
  const isLego = isLegoRoboticsClassCodePure(classCode);
  const isRobotics = isLego || isRoboticsClassCodePure(classCode);
  const num = Number(sessionNumber || 0);
  const checkpoints = isLego
    ? LEGO_CHECKPOINT_SESSIONS
    : isRobotics
      ? ROBOTICS_CHECKPOINT_SESSIONS
      : CODING_CHECKPOINT_SESSIONS;

  if (num === checkpoints[0]) {
    return {
      isCheckpoint: true,
      isRobotics,
      ...(isLego ? { isLego: true } : {}),
      cpStage: 1,
      stageStartSession: 1,
      stageEndSession: checkpoints[0],
      previousCpSession: null,
    };
  }
  if (num === checkpoints[1]) {
    return {
      isCheckpoint: true,
      isRobotics,
      ...(isLego ? { isLego: true } : {}),
      cpStage: 2,
      stageStartSession: checkpoints[0] + 1,
      stageEndSession: checkpoints[1],
      previousCpSession: checkpoints[0],
    };
  }
  return {
    isCheckpoint: false,
    isRobotics,
    ...(isLego ? { isLego: true } : {}),
    cpStage: null,
    stageStartSession: 1,
    stageEndSession: num || 1,
    previousCpSession: null,
  };
}

/**
 * Chuẩn hóa điểm từ nhiều thang (100, 10, 5) về thang 5.0 (làm tròn 1 chữ số thập phân).
 */
export function normalizeScoreToScale5(raw: unknown): number | null {
  if (raw === null || raw === undefined || typeof raw === "boolean" || raw === "") return null;
  const cleaned = typeof raw === "string" ? raw.replace(",", ".").trim() : raw;
  if (cleaned === "") return null;
  const val = Number(cleaned);
  if (!Number.isFinite(val) || val < 0) return null;
  let scaled = val;
  if (val > 10 && val <= 100) {
    scaled = val / 20;
  } else if (val > 5 && val <= 10) {
    scaled = val / 2;
  } else if (val > 100) {
    return null;
  }
  const clamped = Math.max(0, Math.min(5, scaled));
  return Math.round(clamped * 10) / 10;
}

/**
 * Quy đổi điểm từ mục Chấm bài (`#tab-3 Submission`, mặc định thang 100) trực tiếp về thang 5.0 (1dp).
 * Khác với `normalizeScoreToScale5` ở chỗ `10/100` phải thành `0.5/5.0` thay vì đoán nhầm thang 10 (`5.0`).
 */
export function scaleSubmissionScoreTo5(raw: unknown, maxScore = 100): number | null {
  if (raw === null || raw === undefined || typeof raw === "boolean" || raw === "") return null;
  const cleaned = typeof raw === "string" ? raw.replace(",", ".").trim() : raw;
  if (cleaned === "") return null;
  const val = Number(cleaned);
  if (!Number.isFinite(val) || val < 0) return null;
  const safeMax =
    typeof maxScore === "number" && Number.isFinite(maxScore) && maxScore > 0 ? maxScore : 100;
  const scaled = (val / safeMax) * 5;
  const clamped = Math.max(0, Math.min(5, scaled));
  return Math.round(clamped * 10) / 10;
}

/**
 * Xác định chặng Checkpoint (1 hoặc 2) từ metadata cột/bài học trong `#tab-3 Chấm bài`.
 */
export function resolveCheckpointColumnStagePure(lesson: {
  id?: string | null;
  title?: string | null;
  lessonType?: string | null;
}): 1 | 2 | null {
  const titleStr = String(lesson?.title || "").trim();
  const idStr = String(lesson?.id || "").trim();
  const typeUpper = String(lesson?.lessonType || "").trim().toUpperCase();
  const isCheckpointTypeOrTitle =
    typeUpper === "CHECKPOINT" ||
    /bài\s*kiểm\s*tra|kiểm\s*tra\s*định\s*kỳ|checkpoint|\bcp\s*0?[12]\b/i.test(titleStr);
  if (!isCheckpointTypeOrTitle) return null;

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
  return null;
}

export interface ReconcileCheckpointTestScoresInput {
  slotTheory: number | null | undefined;
  slotPractice: number | null | undefined;
  subTheory: number | null | undefined;
  subPractice: number | null | undefined;
  subPracticeStatus?: string | null;
  subPracticeHasAttachments?: boolean;
  manualTheory?: number | null;
  manualPractice?: number | null;
  userEditedTheory?: boolean;
  userEditedPractice?: boolean;
}

export interface ReconcileCheckpointTestScoresResult {
  theoryScore: number | null;
  practiceScore: number | null;
  hasUngradedPractice: boolean;
}

/**
 * Hợp nhất điểm Kiểm tra Lý thuyết / Thực hành theo thứ tự ưu tiên chuẩn:
 * 1. Điểm sửa tay trực tiếp trong Bot UI (`userEditedTheory` / `userEditedPractice`) — nếu giáo viên đã nhập tay.
 * 2. Điểm chấm tay ở trang Nhận xét LMS (`#tab-10`, > 0) — bảo vệ điểm tay như Đặng Trọng Khang khỏi Quiz=0 ở #tab-3.
 * 3. Điểm hệ thống/chấm bài ở `#tab-3 Submission` (> 0) — tự lấy Quiz/TH của các lớp kiểu mới (`CSA04`).
 * 4. Chốt chống 0 điểm oan: nếu bài TH ở `#tab-3` đang nộp file chờ chấm (`SUBMITTED_UNGRADED`/`REDO_REQUESTED` có file/ngày nộp) và chưa có điểm TH `> 0` ở `#tab-10`, trả `practiceScore = null` & `hasUngradedPractice = true`.
 * 5. Cuối cùng mới nhận giá trị `0` tường minh từ `#tab-10` hoặc `#tab-3`; nếu đều trống trả `null`.
 */
export function reconcileCheckpointTestScores(
  params: ReconcileCheckpointTestScoresInput
): ReconcileCheckpointTestScoresResult {
  const normOpt = (v: unknown): number | null => {
    if (v === null || v === undefined || typeof v === "boolean" || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(Math.max(0, Math.min(5, n)) * 100) / 100;
  };

  const slotLt = normOpt(params.slotTheory);
  const slotTh = normOpt(params.slotPractice);
  const subLt = normOpt(params.subTheory);
  const subTh = normOpt(params.subPractice);
  const manualLt = normOpt(params.manualTheory);
  const manualTh = normOpt(params.manualPractice);

  let theoryScore: number | null = null;
  if (params.userEditedTheory && manualLt !== null) {
    theoryScore = manualLt;
  } else if (slotLt !== null && slotLt > 0) {
    theoryScore = slotLt;
  } else if (subLt !== null && subLt > 0) {
    theoryScore = subLt;
  } else if (slotLt === 0) {
    theoryScore = 0;
  } else if (subLt === 0) {
    theoryScore = 0;
  }

  const subStatusUpper = String(params.subPracticeStatus || "").trim().toUpperCase();
  const isWaitingTeacherGradeOnSub =
    subTh === null &&
    (subStatusUpper === "SUBMITTED_UNGRADED" || subStatusUpper === "REDO_REQUESTED") &&
    Boolean(params.subPracticeHasAttachments);

  let practiceScore: number | null = null;
  let hasUngradedPractice = false;

  if (params.userEditedPractice && manualTh !== null) {
    practiceScore = manualTh;
    hasUngradedPractice = false;
  } else if (slotTh !== null && slotTh > 0) {
    practiceScore = slotTh;
    hasUngradedPractice = false;
  } else if (subTh !== null && subTh > 0) {
    practiceScore = subTh;
    hasUngradedPractice = false;
  } else if (isWaitingTeacherGradeOnSub) {
    practiceScore = null;
    hasUngradedPractice = true;
  } else if (slotTh === 0) {
    practiceScore = 0;
    hasUngradedPractice = false;
  } else if (subTh === 0) {
    practiceScore = 0;
    hasUngradedPractice = false;
  }

  return {
    theoryScore,
    practiceScore,
    hasUngradedPractice,
  };
}

function stripHtmlPlain(raw: string): string {
  return String(raw || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Phát hiện nhận xét tạm/giữ chỗ giáo viên gõ trên LMS khi nhập điểm Checkpoint
 * (ví dụ ".", "-", "nháp", "ok", "chờ nhận xét") để không đánh dấu nhầm là VERIFIED.
 */
export function isPlaceholderLmsComment(raw?: string | null): boolean {
  const plain = stripHtmlPlain(raw || "");
  if (!plain) return true;
  if (/^(?:[.\-_*•+=~!?/\\|]+|nháp|nhap|test|ok|tạm|tam|chờ.*|\.{1,5}|n\/a)$/i.test(plain)) {
    return true;
  }
  if (
    plain.length < 24 &&
    !/điểm mạnh|cần cải thiện|lời khuyên|kết quả checkpoint/i.test(plain)
  ) {
    return true;
  }
  return false;
}

function normalizeAsciiVi(raw: string): string {
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function matchAreaSpecFromLmsItem(
  area: any
): { key: keyof CompetencyScores; isLegoSpec: boolean } | null {
  if (!area || typeof area !== "object") return null;
  const rawType = String(area.type ?? area.commentArea?.type ?? "").trim().toUpperCase();
  if (rawType && rawType !== "RATE") return null;

  const areaId = String(
    area.commentAreaId || area.areaId || area.commentArea?._id || area.commentArea?.id || area.id || ""
  )
    .trim()
    .toLowerCase();
  if (areaId) {
    const byLegoId = LEGO_COMPETENCY_AREA_SPECS.find(
      (s) => s.commentAreaId.toLowerCase() === areaId
    );
    if (byLegoId) return { key: byLegoId.key, isLegoSpec: true };
    const byId = COMPETENCY_AREA_SPECS.find((s) => matchesCompetencyAreaIdPure(s, areaId));
    if (byId) return { key: byId.key, isLegoSpec: false };
  }

  const labelNorm = normalizeAsciiVi(
    String(
      area.commentArea?.name ||
        area.commentArea?.title ||
        area.name ||
        area.title ||
        area.label ||
        ""
    )
  );
  if (labelNorm) {
    const byExactLegoLabel = LEGO_COMPETENCY_AREA_SPECS.find(
      (s) => normalizeAsciiVi(s.labelVi) === labelNorm
    );
    if (byExactLegoLabel) return { key: byExactLegoLabel.key, isLegoSpec: true };

    const byExactLabel = COMPETENCY_AREA_SPECS.find(
      (s) =>
        normalizeAsciiVi(s.labelVi) === labelNorm ||
        (s.roboticsLabelVi ? normalizeAsciiVi(s.roboticsLabelVi) === labelNorm : false)
    );
    if (byExactLabel) return { key: byExactLabel.key, isLegoSpec: false };

    if (labelNorm.includes("su dung cong nghe") || labelNorm.includes("su dung cong cu")) {
      return { key: "skillComputerUse", isLegoSpec: false };
    }
    const byLabel = COMPETENCY_AREA_SPECS.find((s) =>
      s.keywordsNorm.some((kw) => labelNorm.includes(kw))
    );
    if (byLabel) return { key: byLabel.key, isLegoSpec: false };
  }

  return null;
}

export interface ExtractedLmsCheckpointAreas {
  theoryScore: number | null;
  practiceScore: number | null;
  competencyScores: CompetencyScores | null;
  competencyAverage: number | null;
  hasAnyRate: boolean;
  contentText: string;
}

/**
 * Trích xuất điểm Lý thuyết, Thực hành và 9 ô [ĐNL] (hoặc 7 ô LEGO) từ mảng `att.commentByAreas` của MindX LMS.
 */
export function extractLmsCheckpointFromCommentByAreas(
  commentByAreas: unknown,
  fallbackComment?: string | null,
  options?: { classCode?: string }
): ExtractedLmsCheckpointAreas {
  const areas = Array.isArray(commentByAreas) ? commentByAreas : [];
  const ratePartial: Partial<CompetencyScores> = {};
  let matchedLegoIdOrLabelCount = 0;

  for (const area of areas) {
    const spec = matchAreaSpecFromLmsItem(area);
    const grade = Number(area?.grade);
    if (spec && Number.isFinite(grade) && grade >= 1 && grade <= 5) {
      ratePartial[spec.key] = clampCompetencyRating(grade);
      if (spec.isLegoSpec) {
        matchedLegoIdOrLabelCount++;
      }
    }
  }

  const explicitClassCode = String(options?.classCode || "").trim();
  const explicitIsLego = explicitClassCode ? isLegoRoboticsClassCodePure(explicitClassCode) : false;
  const explicitNonLego = explicitClassCode ? !explicitIsLego : false;
  const effectiveIsLego = explicitIsLego || (!explicitNonLego && matchedLegoIdOrLabelCount >= 5);
  const classHint = effectiveIsLego ? "LEGO" : explicitClassCode || undefined;

  const activeKeySet = effectiveIsLego ? new Set<keyof CompetencyScores>(LEGO_COMPETENCY_KEYS) : null;
  const distinctRateKeys = (Object.keys(ratePartial) as Array<keyof CompetencyScores>).filter(
    (k) => !activeKeySet || activeKeySet.has(k)
  );
  const distinctRateCount = distinctRateKeys.length;
  const competencyScores = hasCompleteCompetencyScoresForClassPure(ratePartial, classHint)
    ? parseCompetencyScoresPure(ratePartial)
    : null;
  const competencyAverage = competencyScores
    ? calculateCompetencyAverageForClassPure(competencyScores, classHint)
    : distinctRateCount > 0
      ? Number(
          (
            distinctRateKeys.reduce((sum, k) => sum + Number(ratePartial[k] || 0), 0) /
            distinctRateCount
          ).toFixed(2)
        )
      : null;

  const cpArea = areas.find(
    (a) =>
      String(a?.type || "").trim().toUpperCase() === "CHECKPOINT" ||
      Boolean(a?.checkpoint)
  );

  let theoryScore: number | null = null;
  let practiceScore: number | null = null;

  if (cpArea?.checkpoint && typeof cpArea.checkpoint === "object") {
    const rawLt = cpArea.checkpoint.checkpointScore;
    const rawTh = cpArea.checkpoint.practiceScore;
    const normLt = normalizeScoreToScale5(rawLt);
    const normTh = normalizeScoreToScale5(rawTh);
    const hasScoredQuestion =
      Array.isArray(cpArea.checkpoint.checkpointQuestions) &&
      cpArea.checkpoint.checkpointQuestions.some((q: any) => q?.result === true);
    const hasTextScore = /Điểm\s*(?:thực\s*hành|trắc\s*nghiệm|lý\s*thuyết)/i.test(
      String(cpArea.content || "")
    );
    const isGradedSlot =
      (normLt !== null && normLt > 0) ||
      (normTh !== null && normTh > 0) ||
      distinctRateCount > 0 ||
      hasScoredQuestion ||
      hasTextScore;

    if (isGradedSlot) {
      theoryScore = normLt;
      practiceScore = normTh;
    }
  } else if (cpArea?.content) {
    const thMatch = String(cpArea.content).match(
      /Điểm\s*thực\s*hành\s*:\s*(\d+(?:[.,]\d+)?)/i
    );
    const ltMatch = String(cpArea.content).match(
      /Điểm\s*(?:trắc\s*nghiệm|lý\s*thuyết)\s*:\s*(\d+(?:[.,]\d+)?)/i
    );
    if (thMatch) practiceScore = normalizeScoreToScale5(thMatch[1]);
    if (ltMatch) theoryScore = normalizeScoreToScale5(ltMatch[1]);
  }

  const contentArea = areas.find(
    (a) => String(a?.type || "").trim().toUpperCase() === "CONTENT" && a?.content
  );
  const contentText = stripHtmlPlain(
    String(contentArea?.content || fallbackComment || "")
  );

  return {
    theoryScore,
    practiceScore,
    competencyScores,
    competencyAverage,
    hasAnyRate: distinctRateCount > 0,
    contentText,
  };
}

function sanitizeFiniteNonNegInt(raw: unknown, fallback = 0): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n);
}

function sanitizeProcessSummary(raw: any): CheckpointProcessSummary | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const issueBreakdown: Record<string, number> = {};
  if (raw.issueBreakdown && typeof raw.issueBreakdown === "object" && !Array.isArray(raw.issueBreakdown)) {
    for (const [k, v] of Object.entries(raw.issueBreakdown)) {
      const cleanKey = String(k || "").trim().slice(0, 64);
      const cnt = Number(v);
      if (cleanKey && Number.isFinite(cnt) && cnt >= 0) {
        issueBreakdown[cleanKey] = Math.round(cnt);
      }
    }
  }
  const cleanTagArray = (arr: unknown): string[] =>
    Array.isArray(arr)
      ? arr
          .filter((x) => typeof x === "string")
          .map((x) => x.trim().slice(0, 120))
          .filter(Boolean)
          .slice(0, 10)
      : [];

  let homeworkSummary: CheckpointProcessSummary["homeworkSummary"] = null;
  if (raw.homeworkSummary && typeof raw.homeworkSummary === "object" && !Array.isArray(raw.homeworkSummary)) {
    const rawAvg = raw.homeworkSummary.avgScore100;
    const avgNum =
      rawAvg !== null && rawAvg !== undefined && rawAvg !== "" && Number.isFinite(Number(rawAvg))
        ? Math.max(0, Math.min(100, Number(Number(rawAvg).toFixed(1))))
        : null;
    homeworkSummary = {
      gradedCount: sanitizeFiniteNonNegInt(raw.homeworkSummary.gradedCount, 0),
      totalEligible: sanitizeFiniteNonNegInt(raw.homeworkSummary.totalEligible, 0),
      completionRatePct: Math.max(
        0,
        Math.min(100, sanitizeFiniteNonNegInt(raw.homeworkSummary.completionRatePct, 0))
      ),
      avgScore100: avgNum,
    };
  }

  let previousCheckpoint: CheckpointProcessSummary["previousCheckpoint"] = null;
  if (raw.previousCheckpoint && typeof raw.previousCheckpoint === "object" && !Array.isArray(raw.previousCheckpoint)) {
    const sNum = sanitizeFiniteNonNegInt(raw.previousCheckpoint.sessionNumber, 0);
    const prevComp = raw.previousCheckpoint.competencyAverage;
    const prevCompNum =
      prevComp !== null && prevComp !== undefined && prevComp !== "" && Number.isFinite(Number(prevComp))
        ? Math.max(1, Math.min(5, Number(Number(prevComp).toFixed(2))))
        : null;
    if (sNum > 0) {
      previousCheckpoint = {
        sessionNumber: sNum,
        theoryScore: normalizeScoreToScale5(raw.previousCheckpoint.theoryScore),
        practiceScore: normalizeScoreToScale5(raw.previousCheckpoint.practiceScore),
        competencyAverage: prevCompNum,
      };
    }
  }

  return {
    stageStartSession: sanitizeFiniteNonNegInt(raw.stageStartSession, 1),
    stageEndSession: sanitizeFiniteNonNegInt(raw.stageEndSession, 1),
    priorSessionsObserved: sanitizeFiniteNonNegInt(raw.priorSessionsObserved, 0),
    presentCount: sanitizeFiniteNonNegInt(raw.presentCount, 0),
    lateCount: sanitizeFiniteNonNegInt(raw.lateCount, 0),
    absentCount: sanitizeFiniteNonNegInt(raw.absentCount, 0),
    totalStars: sanitizeFiniteNonNegInt(raw.totalStars, 0),
    totalMedals: sanitizeFiniteNonNegInt(raw.totalMedals, 0),
    totalIssues: sanitizeFiniteNonNegInt(raw.totalIssues, 0),
    issueBreakdown,
    topStrengthTags: cleanTagArray(raw.topStrengthTags),
    topImprovementTags: cleanTagArray(raw.topImprovementTags),
    homeworkSummary,
    previousCheckpoint,
  };
}

export function parseCheckpointDataJson(raw?: string | null): CheckpointStudentData | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "{}") return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const cpStage = parsed.cpStage === 2 ? 2 : parsed.cpStage === 1 ? 1 : null;
    if (!cpStage) return null;

    const isLego = Boolean(parsed.isLego);
    const classHint = isLego ? "LEGO" : undefined;
    const compScores = hasCompleteCompetencyScoresForClassPure(parsed.competencyScores, classHint)
      ? parseCompetencyScoresPure(parsed.competencyScores)
      : null;
    const compAvg = compScores
      ? calculateCompetencyAverageForClassPure(compScores, classHint)
      : typeof parsed.competencyAverage === "number" && Number.isFinite(parsed.competencyAverage)
        ? Number(parsed.competencyAverage.toFixed(2))
        : null;

    const lmsComp = hasCompleteCompetencyScoresForClassPure(parsed.lmsCompetencyScores, classHint)
      ? parseCompetencyScoresPure(parsed.lmsCompetencyScores)
      : null;

    const normTheory = normalizeScoreToScale5(parsed.theoryScore);
    const normPractice = normalizeScoreToScale5(parsed.practiceScore);
    const userEditedTheory = Boolean(parsed.userEditedTheory);
    const userEditedPractice = Boolean(parsed.userEditedPractice);

    return {
      cpStage,
      isRobotics: Boolean(parsed.isRobotics),
      ...(isLego ? { isLego: true } : {}),
      theoryScore: normTheory,
      practiceScore: normPractice,
      ...(parsed.slotTheoryScore !== undefined
        ? {
            slotTheoryScore:
              parsed.slotTheoryScore === null ? null : normalizeScoreToScale5(parsed.slotTheoryScore),
          }
        : {}),
      ...(parsed.slotPracticeScore !== undefined
        ? {
            slotPracticeScore:
              parsed.slotPracticeScore === null ? null : normalizeScoreToScale5(parsed.slotPracticeScore),
          }
        : {}),
      userEditedTheory,
      userEditedPractice,
      hasUngradedPractice:
        Boolean(parsed.hasUngradedPractice) && normPractice === null && !userEditedPractice,
      competencyScores: compScores,
      competencyAverage: compAvg,
      lmsCompetencyScores: lmsComp,
      processSummary: sanitizeProcessSummary(parsed.processSummary),
      source:
        parsed.source === "MANUAL_UI" || parsed.source === "LMS_SYNC"
          ? parsed.source
          : "AUTO_PROCESS",
      userEditedCompetency: Boolean(parsed.userEditedCompetency),
      lmsSyncedAt: typeof parsed.lmsSyncedAt === "string" ? parsed.lmsSyncedAt : null,
      computedAt: typeof parsed.computedAt === "string" ? parsed.computedAt : null,
      approvedSnapshotHash:
        typeof parsed.approvedSnapshotHash === "string" ? parsed.approvedSnapshotHash : null,
    };
  } catch {
    return null;
  }
}

/**
 * Hợp nhất dữ liệu Checkpoint đã lưu (vd: bản ghi sync từ LMS chỉ có LT/TH) với bản tự tính từ lịch sử,
 * để không bị che khuất 9 ô [ĐNL] hoặc `processSummary`.
 */
export function mergeCheckpointStudentData(
  primary?: CheckpointStudentData | null,
  fallbackComputed?: CheckpointStudentData | null
): CheckpointStudentData | null {
  if (!primary && !fallbackComputed) return null;
  if (!primary) return fallbackComputed || null;
  if (!fallbackComputed) return primary;

  const isLego = Boolean(primary.isLego ?? fallbackComputed.isLego);
  const mergedCompScores = primary.competencyScores || fallbackComputed.competencyScores || null;
  const mergedCompAvg = mergedCompScores
    ? calculateCompetencyAverageForClassPure(mergedCompScores, isLego ? "LEGO" : undefined)
    : primary.competencyAverage ?? fallbackComputed.competencyAverage ?? null;

  const primaryEditedTheory = Boolean(primary.userEditedTheory);
  const primaryEditedPractice = Boolean(primary.userEditedPractice);

  const mergedTheory = primaryEditedTheory
    ? primary.theoryScore ?? null
    : primary.theoryScore !== null && primary.theoryScore !== undefined
      ? primary.theoryScore === 0 &&
        typeof fallbackComputed.theoryScore === "number" &&
        fallbackComputed.theoryScore > 0
        ? fallbackComputed.theoryScore
        : primary.theoryScore
      : fallbackComputed.theoryScore;

  let mergedPractice: number | null;
  let mergedHasUngradedPractice: boolean;
  if (primaryEditedPractice) {
    mergedPractice = primary.practiceScore ?? null;
    mergedHasUngradedPractice = false;
  } else if (
    Boolean(fallbackComputed.hasUngradedPractice) &&
    (primary.practiceScore === null ||
      primary.practiceScore === undefined ||
      primary.practiceScore === 0)
  ) {
    mergedPractice = fallbackComputed.practiceScore ?? null;
    mergedHasUngradedPractice = true;
  } else if (primary.practiceScore !== null && primary.practiceScore !== undefined) {
    mergedPractice =
      primary.practiceScore === 0 &&
      typeof fallbackComputed.practiceScore === "number" &&
      fallbackComputed.practiceScore > 0
        ? fallbackComputed.practiceScore
        : primary.practiceScore;
    mergedHasUngradedPractice = Boolean(
      primary.hasUngradedPractice ?? fallbackComputed.hasUngradedPractice
    );
  } else {
    mergedPractice = fallbackComputed.practiceScore;
    mergedHasUngradedPractice = Boolean(
      fallbackComputed.hasUngradedPractice ?? primary.hasUngradedPractice
    );
  }
  if (mergedPractice !== null || primaryEditedPractice || Boolean(fallbackComputed.userEditedPractice)) {
    mergedHasUngradedPractice = false;
  }

  return {
    ...fallbackComputed,
    ...primary,
    ...(isLego ? { isLego: true } : {}),
    theoryScore: mergedTheory,
    practiceScore: mergedPractice,
    slotTheoryScore:
      primary.slotTheoryScore !== undefined
        ? primary.slotTheoryScore
        : fallbackComputed.slotTheoryScore,
    slotPracticeScore:
      primary.slotPracticeScore !== undefined
        ? primary.slotPracticeScore
        : fallbackComputed.slotPracticeScore,
    userEditedTheory: primaryEditedTheory || Boolean(fallbackComputed.userEditedTheory),
    userEditedPractice: primaryEditedPractice || Boolean(fallbackComputed.userEditedPractice),
    hasUngradedPractice: mergedHasUngradedPractice,
    competencyScores: mergedCompScores,
    competencyAverage: mergedCompAvg,
    lmsCompetencyScores: primary.lmsCompetencyScores || fallbackComputed.lmsCompetencyScores || null,
    processSummary: primary.processSummary || fallbackComputed.processSummary || null,
    approvedSnapshotHash: primary.approvedSnapshotHash ?? fallbackComputed.approvedSnapshotHash ?? null,
  };
}

function classifyTagSignals(rawTag: string) {
  const t = normalizeAsciiVi(rawTag);
  const isNegative =
    /(cham|kho khan|chua|thieu|mat tap trung|xao nhang|noi chuyen|nghich|choi game|quen|loi|lung tung|phu thuoc|trung binh|yeu|nghi hoc|tre|can on|can ho tro|can nhac|khong tap trung)/i.test(
      t
    );
  const isPositive =
    !isNegative &&
    /(tot|gioi|xuat sac|nhanh|chac|vung|tich cuc|hang hai|chu dong|sang tao|sach|dep|logic|tu sua|hoan thanh|vuot|dat muc tieu|tien bo|nghiem tuc|hop tac|chia se|tu tin)/i.test(
      t
    );

  const buckets: Array<{ key: keyof CompetencyScores; delta: number }> = [];
  if (isPositive) {
    if (/(hieu|nam|kien thuc|muc tieu|on tap|tu hoc)/i.test(t)) {
      buckets.push({ key: "knowledgeInClass", delta: 0.45 });
      buckets.push({ key: "knowledgeSelfStudy", delta: 0.35 });
    }
    if (/(tu duy|logic|thuat toan|code|giai quyet|sua loi|debug|toi uu)/i.test(t)) {
      buckets.push({ key: "skillComputational", delta: 0.45 });
      buckets.push({ key: "skillProblemSolving", delta: 0.45 });
    }
    if (/(sang tao|cai tien|y tuong|thiet ke|mo hinh|lap rap)/i.test(t)) {
      buckets.push({ key: "skillCreativity", delta: 0.5 });
      buckets.push({ key: "skillComputerUse", delta: 0.3 });
    }
    if (/(giao tiep|hop tac|trinh bay|thuyet trinh|nhom|ho tro ban|chia se|phat bieu|tuong tac)/i.test(t)) {
      buckets.push({ key: "skillCommunication", delta: 0.5 });
    }
    if (/(tap trung|hang hai|chu dong|nghiem tuc|tich cuc|tien bo|thai do)/i.test(t)) {
      buckets.push({ key: "attitudeInClass", delta: 0.4 });
    }
    if (/(bai tap|btvn|ve nha|dung han)/i.test(t)) {
      buckets.push({ key: "attitudeHomework", delta: 0.45 });
    }
    if (buckets.length === 0) {
      buckets.push({ key: "knowledgeInClass", delta: 0.3 });
      buckets.push({ key: "attitudeInClass", delta: 0.3 });
    }
  } else if (isNegative) {
    if (/(tiep thu cham|chua nam|can on|kien thuc|quen cu phap)/i.test(t)) {
      buckets.push({ key: "knowledgeInClass", delta: -0.5 });
      buckets.push({ key: "knowledgeSelfStudy", delta: -0.45 });
    }
    if (/(thao tac.*cham|lung tung|phu thuoc|nhieu loi|gap loi|chua kip)/i.test(t)) {
      buckets.push({ key: "skillProblemSolving", delta: -0.45 });
      buckets.push({ key: "skillComputational", delta: -0.4 });
      buckets.push({ key: "skillComputerUse", delta: -0.35 });
    }
    if (/(mat tap trung|xao nhang|noi chuyen|nghich|choi game|chua nghiem tuc)/i.test(t)) {
      buckets.push({ key: "attitudeInClass", delta: -0.6 });
    }
    if (/(btvn|bai tap|chua lam bai|quen bai)/i.test(t)) {
      buckets.push({ key: "attitudeHomework", delta: -0.6 });
    }
    if (buckets.length === 0) {
      buckets.push({ key: "attitudeInClass", delta: -0.35 });
      buckets.push({ key: "skillProblemSolving", delta: -0.3 });
    }
  }

  return { isPositive, isNegative, buckets };
}

function clamp1to5Float(val: number): number {
  if (!Number.isFinite(val)) return 4.0;
  return Math.max(1.0, Math.min(5.0, val));
}

/**
 * Tính 9 chỉ số [ĐNL] theo quá trình học tập của giai đoạn Checkpoint (1..4 / 5..8 cho Robotics;
 * 1..5 / 6..9 cho Lập trình) dựa trên lịch sử nhiều buổi + điểm LT/TH giáo viên chấm trên LMS.
 */
export function computeStudentProcessCompetency(
  input: ComputeStudentProcessCompetencyInput
): CheckpointStudentData {
  const stage = resolveCheckpointStageForSession(input.classCode, input.sessionNumber);
  const cpStage: 1 | 2 = stage.cpStage || 1;
  const isRobotics = stage.isRobotics;
  const isLego = Boolean(stage.isLego);

  const theoryScore = normalizeScoreToScale5(input.theoryScore);
  const practiceScore = normalizeScoreToScale5(input.practiceScore);

  const stageFeedbacks = (input.priorFeedbacks || []).filter(
    (f) => f.sessionNumber >= stage.stageStartSession && f.sessionNumber <= stage.stageEndSession
  );
  const stageLogs = (input.classroomLogs || []).filter(
    (l) => l.sessionNumber >= stage.stageStartSession && l.sessionNumber <= stage.stageEndSession
  );

  // Merge attendance stats by sessionNumber (preferring priorFeedbacks then classroomLogs)
  const attendanceBySession = new Map<number, string>();
  for (const l of stageLogs) {
    if (l.attendanceStatus && l.attendanceStatus !== "UNKNOWN") {
      attendanceBySession.set(l.sessionNumber, l.attendanceStatus.toUpperCase());
    }
  }
  for (const f of stageFeedbacks) {
    if (f.attendanceStatus && f.attendanceStatus !== "UNKNOWN") {
      attendanceBySession.set(f.sessionNumber, f.attendanceStatus.toUpperCase());
    }
  }
  if (input.currentAttendanceStatus && input.currentAttendanceStatus !== "UNKNOWN") {
    attendanceBySession.set(input.sessionNumber, input.currentAttendanceStatus.toUpperCase());
  }

  let presentCount = 0;
  let lateCount = 0;
  let absentCount = 0;
  for (const st of attendanceBySession.values()) {
    if (st === "ABSENT" || st === "EXCUSED") absentCount++;
    else if (st === "LATE") lateCount++;
    else if (st === "PRESENT") presentCount++;
  }

  // Stars, medals, issues from classroom logs in stage
  let totalStars = 0;
  let totalMedals = 0;
  let totalIssues = 0;
  const issueBreakdown: Record<string, number> = {};
  for (const log of stageLogs) {
    totalStars += Math.max(0, Number(log.stars || 0));
    totalMedals += Math.max(0, Number(log.medals || 0));
    const issues = log.issueCounts && typeof log.issueCounts === "object" ? log.issueCounts : {};
    for (const [k, rawCnt] of Object.entries(issues)) {
      const cnt = Math.max(0, Number(rawCnt || 0));
      if (cnt > 0) {
        issueBreakdown[k] = (issueBreakdown[k] || 0) + cnt;
        totalIssues += cnt;
      }
    }
  }

  // Tag tallies + base deltas across stage sessions (current checkpoint quick tags get weight 1.25)
  const deltaMap: Record<keyof CompetencyScores, number> = {
    knowledgeSelfStudy: 0,
    knowledgeInClass: 0,
    skillCommunication: 0,
    skillComputerUse: 0,
    skillProblemSolving: 0,
    skillCreativity: 0,
    skillComputational: 0,
    attitudeHomework: 0,
    attitudeInClass: 0,
  };
  const strengthTagFreq = new Map<string, number>();
  const issueTagFreq = new Map<string, number>();

  const applyTags = (tags: string[], weight: number) => {
    for (const rawTag of tags || []) {
      const clean = String(rawTag || "").trim();
      if (!clean) continue;
      const parsed = classifyTagSignals(clean);
      if (parsed.isPositive) {
        strengthTagFreq.set(clean, (strengthTagFreq.get(clean) || 0) + 1);
      } else if (parsed.isNegative) {
        issueTagFreq.set(clean, (issueTagFreq.get(clean) || 0) + 1);
      }
      for (const b of parsed.buckets) {
        deltaMap[b.key] += b.delta * weight;
      }
    }
  };

  for (const fb of stageFeedbacks) {
    if (fb.sessionNumber !== input.sessionNumber) {
      applyTags(fb.quickTags || [], 0.7);
    }
  }
  applyTags(input.currentQuickTags || [], 1.15);

  // Classroom stars/medals & issue adjustments
  const starBoost = Math.min(1.1, totalStars * 0.08 + totalMedals * 0.35);
  const fullAttendanceBonus =
    presentCount >= 3 && absentCount === 0 && lateCount === 0 && totalIssues === 0 ? 0.2 : 0;
  deltaMap.attitudeInClass += starBoost + fullAttendanceBonus;
  deltaMap.skillCommunication += Math.min(0.9, starBoost * 0.9);
  deltaMap.knowledgeInClass += Math.min(0.7, starBoost * 0.65);
  deltaMap.skillCreativity += Math.min(0.6, starBoost * 0.55);

  const focusIssueCount =
    (issueBreakdown.distracted || 0) +
    (issueBreakdown.chatting || 0) +
    (issueBreakdown.sleeping || 0) +
    (issueBreakdown.using_phone || 0);
  const lateIssueCount = (issueBreakdown.late || 0) + lateCount;
  const hwIssueCount = issueBreakdown.missing_hw || 0;

  deltaMap.attitudeInClass -= Math.min(1.8, focusIssueCount * 0.4 + lateIssueCount * 0.25 + absentCount * 0.25);
  deltaMap.skillCommunication -= Math.min(0.9, (issueBreakdown.chatting || 0) * 0.3);
  deltaMap.attitudeHomework -= Math.min(1.8, hwIssueCount * 0.45);

  // Neutral baseline ~3.9 adjusted smoothly within [1.0, 5.0]
  const processScore: Record<keyof CompetencyScores, number> = {
    knowledgeSelfStudy: clamp1to5Float(3.85 + Math.max(-1.6, Math.min(1.15, deltaMap.knowledgeSelfStudy * 0.55))),
    knowledgeInClass: clamp1to5Float(3.95 + Math.max(-1.6, Math.min(1.05, deltaMap.knowledgeInClass * 0.55))),
    skillCommunication: clamp1to5Float(3.95 + Math.max(-1.4, Math.min(1.05, deltaMap.skillCommunication * 0.55))),
    skillComputerUse: clamp1to5Float(3.95 + Math.max(-1.3, Math.min(1.05, deltaMap.skillComputerUse * 0.55))),
    skillProblemSolving: clamp1to5Float(3.85 + Math.max(-1.5, Math.min(1.15, deltaMap.skillProblemSolving * 0.55))),
    skillCreativity: clamp1to5Float(3.85 + Math.max(-1.3, Math.min(1.15, deltaMap.skillCreativity * 0.55))),
    skillComputational: clamp1to5Float(3.85 + Math.max(-1.5, Math.min(1.15, deltaMap.skillComputational * 0.55))),
    attitudeHomework: clamp1to5Float(3.85 + Math.max(-1.7, Math.min(1.15, deltaMap.attitudeHomework * 0.55))),
    attitudeInClass: clamp1to5Float(4.0 + Math.max(-1.8, Math.min(1.0, deltaMap.attitudeInClass * 0.55))),
  };

  // Blend Coding BTVN score cache (Robotics intentionally skips BTVN cache)
  let hwSummary: CheckpointProcessSummary["homeworkSummary"] = null;
  if (!isRobotics && input.homeworkHistory && input.homeworkHistory.totalEligible > 0) {
    const compPct =
      input.homeworkHistory.completionRate !== null
        ? Math.round(input.homeworkHistory.completionRate * 100)
        : Math.round(
            (input.homeworkHistory.gradedCount /
              Math.max(1, input.homeworkHistory.totalEligible)) *
              100
          );
    const avg100 =
      input.homeworkHistory.avgScore100 !== null
        ? Number(input.homeworkHistory.avgScore100.toFixed(1))
        : null;
    hwSummary = {
      gradedCount: input.homeworkHistory.gradedCount,
      totalEligible: input.homeworkHistory.totalEligible,
      completionRatePct: Math.max(0, Math.min(100, compPct)),
      avgScore100: avg100,
    };

    const effective100 = avg100 !== null ? avg100 * 0.7 + compPct * 0.3 : compPct;
    const hwScale5 = clamp1to5Float(1.5 + (effective100 / 100) * 3.5);
    processScore.attitudeHomework = clamp1to5Float(
      processScore.attitudeHomework * 0.45 + hwScale5 * 0.55
    );
    processScore.knowledgeSelfStudy = clamp1to5Float(
      processScore.knowledgeSelfStudy * 0.65 + hwScale5 * 0.35
    );
  }

  // Blend current LMS Checkpoint LT & TH scores (0..5) with process scores
  // Map 0..5 test score to 1..5 [ĐNL] anchor (score 5 -> 5.0, score 4 -> 4.2, score 3 -> 3.4, score 2 -> 2.6, score <2 -> 1.8)
  const testToDnlAnchor = (score: number) => clamp1to5Float(1.0 + score * 0.8);
  const ltAnchor = theoryScore !== null ? testToDnlAnchor(theoryScore) : null;
  const thAnchor = practiceScore !== null ? testToDnlAnchor(practiceScore) : null;

  if (ltAnchor !== null) {
    processScore.knowledgeInClass = clamp1to5Float(
      processScore.knowledgeInClass * 0.55 + ltAnchor * 0.45
    );
    processScore.knowledgeSelfStudy = clamp1to5Float(
      processScore.knowledgeSelfStudy * 0.65 + ltAnchor * 0.35
    );
  }
  if (thAnchor !== null) {
    processScore.skillComputational = clamp1to5Float(
      processScore.skillComputational * 0.5 + thAnchor * 0.5
    );
    processScore.skillProblemSolving = clamp1to5Float(
      processScore.skillProblemSolving * 0.5 + thAnchor * 0.5
    );
    processScore.skillCreativity = clamp1to5Float(
      processScore.skillCreativity * 0.6 + thAnchor * 0.4
    );
    processScore.skillComputerUse = clamp1to5Float(
      processScore.skillComputerUse * 0.65 + thAnchor * 0.35
    );
    if (ltAnchor === null) {
      processScore.knowledgeInClass = clamp1to5Float(
        processScore.knowledgeInClass * 0.65 + thAnchor * 0.35
      );
    }
  }
  if (ltAnchor !== null && thAnchor !== null) {
    const overallAnchor = (ltAnchor + thAnchor) / 2;
    processScore.attitudeInClass = clamp1to5Float(
      processScore.attitudeInClass * 0.8 + overallAnchor * 0.2
    );
    processScore.skillCommunication = clamp1to5Float(
      processScore.skillCommunication * 0.8 + overallAnchor * 0.2
    );
  }

  // Previous Checkpoint lookup for CP2 comparison
  let previousCheckpoint: CheckpointProcessSummary["previousCheckpoint"] = null;
  if (cpStage === 2 && stage.previousCpSession) {
    const prevFb = (input.priorFeedbacks || []).find(
      (f) => f.sessionNumber === stage.previousCpSession
    );
    if (prevFb?.checkpointData) {
      previousCheckpoint = {
        sessionNumber: stage.previousCpSession,
        theoryScore: prevFb.checkpointData.theoryScore,
        practiceScore: prevFb.checkpointData.practiceScore,
        competencyAverage: prevFb.checkpointData.competencyAverage,
      };
    }
  }

  const finalScores: CompetencyScores = parseCompetencyScoresPure({
    knowledgeSelfStudy: Math.round(processScore.knowledgeSelfStudy),
    knowledgeInClass: Math.round(processScore.knowledgeInClass),
    skillCommunication: Math.round(processScore.skillCommunication),
    skillComputerUse: Math.round(processScore.skillComputerUse),
    skillProblemSolving: Math.round(processScore.skillProblemSolving),
    skillCreativity: Math.round(processScore.skillCreativity),
    skillComputational: Math.round(processScore.skillComputational),
    attitudeHomework: Math.round(processScore.attitudeHomework),
    attitudeInClass: Math.round(processScore.attitudeInClass),
  });

  const competencyAverage = calculateCompetencyAverageForClassPure(finalScores, input.classCode);

  const topStrengthTags = [...strengthTagFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([tag]) => tag);
  const topImprovementTags = [...issueTagFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([tag]) => tag);

  return {
    cpStage,
    isRobotics,
    ...(isLego ? { isLego: true } : {}),
    theoryScore,
    practiceScore,
    competencyScores: finalScores,
    competencyAverage,
    lmsCompetencyScores: input.existingLmsRatings || null,
    processSummary: {
      stageStartSession: stage.stageStartSession,
      stageEndSession: stage.stageEndSession,
      priorSessionsObserved: stageFeedbacks.filter(
        (f) => f.sessionNumber !== input.sessionNumber
      ).length,
      presentCount,
      lateCount,
      absentCount,
      totalStars,
      totalMedals,
      totalIssues,
      issueBreakdown,
      topStrengthTags,
      topImprovementTags,
      homeworkSummary: hwSummary,
      previousCheckpoint,
    },
    source: "AUTO_PROCESS",
    userEditedCompetency: false,
    computedAt: new Date().toISOString(),
  };
}

export function hasMatchingCheckpointLmsCompetency(
  cp: CheckpointStudentData | null | undefined,
  classCode?: string | null
): boolean {
  if (!cp?.lmsCompetencyScores) return false;
  if (!cp?.competencyScores) return true;
  const keys =
    cp.isLego || isLegoRoboticsClassCodePure(classCode)
      ? LEGO_COMPETENCY_KEYS
      : COMPETENCY_KEYS;
  return keys.every(
    (k) => cp.competencyScores![k] === cp.lmsCompetencyScores![k]
  );
}

/**
 * Gắn dòng điểm chuẩn cố định (do TypeScript format, AI không được tự bịa số) ở đầu nhận xét Checkpoint.
 */
export function formatCheckpointScoreHeaderLine(params: {
  cpStage: 1 | 2;
  theoryScore: number | null;
  practiceScore: number | null;
  competencyAverage: number | null;
  isLego?: boolean;
}): string {
  const ltText =
    typeof params.theoryScore === "number" && Number.isFinite(params.theoryScore)
      ? `**${params.theoryScore.toFixed(1)}/5.0**`
      : "**Chưa nhập**";
  const thText =
    typeof params.practiceScore === "number" && Number.isFinite(params.practiceScore)
      ? `**${params.practiceScore.toFixed(1)}/5.0**`
      : "**Chưa nhập**";
  const dnlText =
    typeof params.competencyAverage === "number" && Number.isFinite(params.competencyAverage)
      ? `**${params.competencyAverage.toFixed(2)}/5.0**`
      : "**Chưa tính**";

  if (params.isLego) {
    return `📊 **Kết quả Checkpoint ${params.cpStage}:** Điểm năng lực ${dnlText}`;
  }

  return `📊 **Kết quả Checkpoint ${params.cpStage}:** Lý thuyết ${ltText} | Thực hành ${thText} | Điểm năng lực ${dnlText}`;
}

export function stripExistingCheckpointHeaderLine(rawText: string): string {
  return String(rawText || "")
    .replace(/^\s*📊\s*\*\*Kết quả Checkpoint[^\n]*\r?\n*/im, "")
    .trimStart();
}

export function upsertCheckpointHeaderIntoFinalText(
  finalText: string,
  scoreHeaderLine: string | null | undefined
): string {
  const cleanBody = stripExistingCheckpointHeaderLine(finalText || "");
  if (!cleanBody) return "";
  if (!scoreHeaderLine || !scoreHeaderLine.trim()) return cleanBody;
  return `${scoreHeaderLine.trim()}\n${cleanBody}`;
}

export interface CheckpointZaloStudentInput {
  fullName: string;
  isActive?: boolean;
  attendanceStatus?: string;
  quickTags?: string[];
  checkpointData?: CheckpointStudentData | null;
}

/**
 * Tạo mục Tổng kết quá trình & Checkpoint cho nhóm Zalo phụ huynh:
 * - TUYỆT ĐỐI KHÔNG liệt kê điểm Checkpoint cụ thể theo tên từng học sinh.
 * - Nêu tổng quan quá trình học giai đoạn, mức độ nắm bài chung của lớp và tuyên dương các bạn nổi bật / tiến bộ.
 */
export function buildCheckpointZaloSummaryBlock(params: {
  cpStage: 1 | 2;
  isRobotics: boolean;
  isLego?: boolean;
  students: CheckpointZaloStudentInput[];
}): string {
  const isLegoClass = Boolean(
    params.isLego || (params.students || []).some((s) => Boolean(s.checkpointData?.isLego))
  );
  const stageLabel = params.cpStage === 1 ? "Chặng 1 (nửa đầu khóa)" : "Chặng 2 (nửa sau khóa)";
  const domainPractice =
    params.isRobotics || isLegoClass
      ? "lắp ráp mô hình và lập trình điều khiển robot"
      : "vận dụng tư duy thuật toán và thực hành viết code";

  const activeStudents = (params.students || []).filter((s) => s.isActive !== false);
  const shortNameFreq = new Map<string, number>();
  for (const st of activeStudents) {
    const sn = formatShortZaloName(st.fullName);
    if (sn) shortNameFreq.set(sn, (shortNameFreq.get(sn) || 0) + 1);
  }

  const scoredStudents: Array<{
    displayName: string;
    combined: number;
    examAvg: number | null;
    lt: number | null;
    th: number | null;
    dnl: number | null;
    medals: number;
    stars: number;
    improvedFromCp1: boolean;
  }> = [];

  for (const st of activeStudents) {
    const attUpper = String(st.attendanceStatus || "").trim().toUpperCase();
    // Học sinh Vắng / Nghỉ phép ở buổi Checkpoint không được xét vào danh sách hoàn thành nổi bật Checkpoint
    if (attUpper === "ABSENT" || attUpper === "EXCUSED") continue;

    const shortName = formatShortZaloName(st.fullName);
    if (!shortName) continue;
    const displayName =
      (shortNameFreq.get(shortName) || 0) > 1
        ? String(st.fullName || shortName).trim()
        : shortName;

    const cp = st.checkpointData;
    const lt = cp?.theoryScore ?? null;
    const th = cp?.practiceScore ?? null;
    const dnl = cp?.competencyAverage ?? null;
    const medals = cp?.processSummary?.totalMedals || 0;
    const stars = cp?.processSummary?.totalStars || 0;
    const isLegoStudent = Boolean(params.isLego || cp?.isLego || isLegoClass);

    const examParts: number[] = [];
    if (lt !== null) examParts.push(lt);
    if (th !== null) examParts.push(th);
    const hasExamScores = examParts.length > 0;
    if (!hasExamScores && !(isLegoStudent && dnl !== null)) continue;

    const examAvg = hasExamScores
      ? examParts.reduce((sum, x) => sum + x, 0) / examParts.length
      : null;
    const allParts = [...examParts];
    if (dnl !== null) allParts.push(dnl);
    const combined = allParts.reduce((sum, x) => sum + x, 0) / allParts.length;

    const prevCp = cp?.processSummary?.previousCheckpoint;
    let improvedFromCp1 = false;
    if (prevCp) {
      const prevExamParts: number[] = [];
      if (prevCp.theoryScore !== null && prevCp.theoryScore !== undefined) {
        prevExamParts.push(prevCp.theoryScore);
      }
      if (prevCp.practiceScore !== null && prevCp.practiceScore !== undefined) {
        prevExamParts.push(prevCp.practiceScore);
      }
      if (examAvg !== null && prevExamParts.length > 0) {
        const prevExamAvg =
          prevExamParts.reduce((sum, x) => sum + x, 0) / prevExamParts.length;
        if (examAvg >= 3.2 && examAvg - prevExamAvg >= 0.4) {
          improvedFromCp1 = true;
        }
      } else if (
        isLegoStudent &&
        dnl !== null &&
        typeof prevCp.competencyAverage === "number" &&
        Number.isFinite(prevCp.competencyAverage)
      ) {
        if (dnl >= 3.5 && dnl - prevCp.competencyAverage >= 0.3) {
          improvedFromCp1 = true;
        }
      }
    }

    scoredStudents.push({
      displayName,
      combined,
      examAvg,
      lt,
      th,
      dnl,
      medals,
      stars,
      improvedFromCp1,
    });
  }

  // Xếp hạng nội bộ để chọn bạn tuyên dương (KHÔNG in điểm số ra ngoài!)
  // Bắt buộc có điểm kiểm tra Checkpoint (hoặc điểm năng lực 7 sao với LEGO) đạt ngưỡng tốt
  const standoutCandidates = [...scoredStudents]
    .filter((s) => {
      if (s.lt !== null && s.th !== null) {
        return (
          s.lt >= 3.5 &&
          s.th >= 3.5 &&
          (s.examAvg! >= 4.0 || (s.combined >= 4.0 && s.medals > 0))
        );
      }
      if (s.examAvg === null) {
        return (
          s.dnl !== null &&
          (s.dnl >= 4.0 || (s.dnl >= 3.8 && (s.stars > 0 || s.medals > 0)))
        );
      }
      return (s.examAvg ?? 0) >= 4.0 && s.combined >= 4.0;
    })
    .sort(
      (a, b) =>
        (b.examAvg ?? b.dnl ?? 0) - (a.examAvg ?? a.dnl ?? 0) ||
        b.combined - a.combined ||
        b.medals - a.medals ||
        b.stars - a.stars
    )
    .slice(0, 4);

  const standoutNames = Array.from(new Set(standoutCandidates.map((s) => s.displayName)));
  const improvedNames = Array.from(
    new Set(
      scoredStudents
        .filter((s) => s.improvedFromCp1 && !standoutNames.includes(s.displayName))
        .slice(0, 3)
        .map((s) => s.displayName)
    )
  );

  const needSupportCount = scoredStudents.filter((s) =>
    s.examAvg !== null ? s.examAvg < 3.2 : s.dnl !== null && s.dnl < 3.2
  ).length;

  const avgClassScore =
    scoredStudents.length > 0
      ? scoredStudents.reduce((sum, s) => sum + s.combined, 0) / scoredStudents.length
      : null;

  const overviewSentence =
    avgClassScore === null
      ? isLegoClass
        ? `- Lớp đã hoàn thành chặng đánh giá định kỳ Checkpoint ${params.cpStage} nhằm đánh giá năng lực học tập quá trình và khả năng ${domainPractice} sau ${stageLabel}.`
        : `- Lớp đã hoàn thành bài kiểm tra định kỳ Checkpoint ${params.cpStage} nhằm đánh giá kiến thức lý thuyết và khả năng ${domainPractice} sau ${stageLabel}.`
      : avgClassScore >= 4.0
        ? isLegoClass
          ? `- Qua quá trình học tập ${stageLabel} và kết quả đánh giá năng lực Checkpoint ${params.cpStage}, tập thể lớp nhìn chung nắm vững kỹ năng trọng tâm, có tinh thần tự giác và thể hiện tốt phần ${domainPractice}.`
          : `- Qua quá trình học tập ${stageLabel} và kết quả Checkpoint ${params.cpStage}, tập thể lớp nhìn chung nắm vững kiến thức trọng tâm, có tinh thần tự giác và thể hiện tốt phần ${domainPractice}.`
        : avgClassScore >= 3.4
          ? isLegoClass
            ? `- Qua quá trình học tập ${stageLabel} và chặng đánh giá năng lực Checkpoint ${params.cpStage}, đa số các con đã làm quen chắc chắn kỹ năng cốt lõi và hoàn thành các yêu cầu ${domainPractice} ở mức khá.`
            : `- Qua quá trình học tập ${stageLabel} và bài đánh giá Checkpoint ${params.cpStage}, đa số các con đã tiếp cận được kiến thức cốt lõi và hoàn thành các yêu cầu ${domainPractice} ở mức khá.`
          : isLegoClass
            ? `- Qua quá trình theo dõi ${stageLabel} và chặng đánh giá Checkpoint ${params.cpStage}, các con đã nỗ lực tham gia thực hành; một số kỹ năng nền tảng và thao tác ${domainPractice} sẽ tiếp tục được giáo viên ôn tập, củng cố thêm ở chặng tới.`
            : `- Qua quá trình theo dõi ${stageLabel} và bài đánh giá Checkpoint ${params.cpStage}, các con đã nỗ lực hoàn thành bài kiểm tra; một số nội dung kiến thức nền và kỹ năng ${domainPractice} sẽ tiếp tục được giáo viên ôn tập, củng cố thêm ở chặng tới.`;

  const lines: string[] = [
    `🎯 ĐÁNH GIÁ QUÁ TRÌNH & TỔNG KẾT CHECKPOINT ${params.cpStage}:`,
    overviewSentence,
  ];

  if (standoutNames.length > 0) {
    lines.push(
      isLegoClass
        ? `- Tuyên dương các bạn duy trì phong độ học tập tích cực, kỹ năng thực hành vững và hoàn thành nổi bật chặng đánh giá Checkpoint ${params.cpStage}: *${standoutNames.join(", ")}*.`
        : `- Tuyên dương các bạn duy trì phong độ học tập tích cực, nền tảng kiến thức vững và hoàn thành nổi bật bài đánh giá Checkpoint ${params.cpStage}: *${standoutNames.join(", ")}*.`
    );
  }
  if (improvedNames.length > 0) {
    lines.push(
      `- Ghi nhận sự bứt phá và tiến bộ rõ rệt so với giai đoạn trước của các bạn: *${improvedNames.join(", ")}*.`
    );
  }
  if (needSupportCount > 0) {
    lines.push(
      "- Với những nội dung thực hành còn vướng mắc, giáo viên đã trao đổi trực tiếp hướng dẫn từng bước và sẽ tiếp tục kèm sát các con trong các buổi học tiếp theo (chi tiết kết quả cá nhân đã được cập nhật riêng tới từng phụ huynh trên hệ thống)."
    );
  } else {
    lines.push(
      "- Chi tiết nhận xét quá trình và mức độ đạt được của từng học viên đã được giáo viên cập nhật đầy đủ để ba mẹ tiện theo dõi đồng hành cùng con."
    );
  }

  return lines.join("\n");
}
