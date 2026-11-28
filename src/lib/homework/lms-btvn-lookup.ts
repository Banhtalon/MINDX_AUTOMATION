import {
  classSessionRepo,
  homeworkSubmissionRepo,
  isRoboticsClassCode,
  parseReportCardLmsSnapshot,
  reportCardRepo,
  scoreMatrixRepo,
  studentRepo,
  type StudentRecord,
} from "@/lib/db/sqlite";
import { resolveCheckpointColumnStagePure } from "@/lib/checkpoint/checkpoint-competency";
import { isDedicatedCheckpointColumn } from "@/lib/checkpoint/checkpoint-column-resolver";
import {
  resolveHomeworkCompletionState,
  type HomeworkCellInput,
} from "@/lib/report-card/homework-completion-helpers";
import {
  ScoreScraper,
  type ScoreColumnInfo,
  type StudentScoreRow,
} from "@/lib/playwright/scrape-scores";
import { isQueueStoppedError } from "@/lib/lms/lms-http-client";
import { taskQueue } from "@/lib/queue/task-queue";
import { buildBtvnPart2, formatShortZaloName } from "@/lib/zalo/zalo-summary";
import { normalizeVietnameseName } from "@/lib/utils/vietnamese-match";

const VALID_CLASS_ID_REGEX = /^[A-Z0-9_-]{2,64}$/;

export class BtvnLookupError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 400, code = "BTVN_LOOKUP_ERROR") {
    super(message);
    this.name = "BtvnLookupError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface LookupPreviousSessionUnsubmittedBtvnParams {
  classId: string;
  sessionNumber: number;
  forceLiveScrape?: boolean;
}

export interface LookupPreviousSessionUnsubmittedBtvnResult {
  classId: string;
  sessionNumber: number;
  targetHomeworkSession: number;
  columnId: string;
  columnTitle: string;
  source: "SCORE_MATRIX_CACHE" | "REPORT_CARD_SNAPSHOT" | "LIVE_SCRAPE";
  totalActiveStudents: number;
  unsubmittedStudentIds: string[];
  unsubmittedRawNames: string[];
  unsubmittedShortNames: string[];
  part2Text: string;
  scrapedAt: string | null;
}

export interface ParsedBtvnLookupRequest {
  classId: string;
  sessionNumber: number;
  forceLiveScrape: boolean;
}

/**
 * Validates and normalizes JSON request body fields shared by BTVN lookup endpoints.
 */
export function parseBtvnLookupRequestBody(
  body: Record<string, unknown>
): ParsedBtvnLookupRequest {
  const hasClassId = body.classId !== undefined && body.classId !== null;
  const hasClassCode = body.classCode !== undefined && body.classCode !== null;

  if (hasClassId && typeof body.classId !== "string") {
    throw new BtvnLookupError("Trường 'classId' phải là chuỗi ký tự hợp lệ.", 400, "INVALID_CLASS_ID");
  }
  if (hasClassCode && typeof body.classCode !== "string") {
    throw new BtvnLookupError("Trường 'classCode' phải là chuỗi ký tự hợp lệ.", 400, "INVALID_CLASS_ID");
  }

  const normClassId = hasClassId ? String(body.classId).trim().toUpperCase() : "";
  const normClassCode = hasClassCode ? String(body.classCode).trim().toUpperCase() : "";

  if (normClassId && normClassCode && normClassId !== normClassCode) {
    throw new BtvnLookupError(
      `Mã lớp classId ('${normClassId}') và classCode ('${normClassCode}') không đồng nhất.`,
      400,
      "CLASS_ID_MISMATCH"
    );
  }

  const resolvedClassId = normClassId || normClassCode;
  if (!resolvedClassId || !VALID_CLASS_ID_REGEX.test(resolvedClassId)) {
    throw new BtvnLookupError(
      "Thiếu hoặc sai định dạng mã lớp (classId).",
      400,
      "INVALID_CLASS_ID"
    );
  }

  const rawSession = body.sessionNumber;
  let parsedSession = NaN;
  if (typeof rawSession === "number") {
    parsedSession = rawSession;
  } else if (typeof rawSession === "string" && /^\d+$/.test(rawSession.trim())) {
    parsedSession = Number(rawSession.trim());
  }

  if (!Number.isInteger(parsedSession) || parsedSession < 2 || parsedSession > 14) {
    throw new BtvnLookupError(
      "Số buổi học (sessionNumber) phải là số nguyên từ 2 đến 14 để kiểm tra BTVN buổi trước.",
      400,
      "INVALID_SESSION_NUMBER"
    );
  }

  if (body.forceLiveScrape !== undefined && typeof body.forceLiveScrape !== "boolean") {
    throw new BtvnLookupError(
      "Trường 'forceLiveScrape' phải là boolean (true/false).",
      400,
      "INVALID_FORCE_FLAG"
    );
  }

  return {
    classId: resolvedClassId,
    sessionNumber: parsedSession,
    forceLiveScrape: body.forceLiveScrape === true,
  };
}

/**
 * Excludes dedicated CHECKPOINT and FINAL_DEMO columns while preserving regular
 * homework columns (including titles like "Homework 5 - Ôn tập Checkpoint 1").
 */
function isExcludedCheckpointOrFinalColumn(col: {
  columnId?: string;
  lessonId?: string;
  title?: string;
  lessonType?: string;
}): boolean {
  const typeUpper = String(col?.lessonType || "").trim().toUpperCase();
  if (typeUpper === "CHECKPOINT" || typeUpper === "FINAL_DEMO") {
    return true;
  }

  const title = String(col?.title || "").trim();
  if (/^(?:homework|bài\s*tập|btvn)\b/i.test(title)) {
    return false;
  }

  const cpStage = resolveCheckpointColumnStagePure({
    id: col?.lessonId || col?.columnId,
    title: col?.title,
    lessonType: col?.lessonType,
  });
  if (cpStage !== null) {
    return true;
  }

  return isDedicatedCheckpointColumn(col as ScoreColumnInfo);
}

interface ResolvedMatrixSource {
  columns: ScoreColumnInfo[];
  rows: StudentScoreRow[];
  source: "SCORE_MATRIX_CACHE" | "REPORT_CARD_SNAPSHOT" | "LIVE_SCRAPE";
  scrapedAt: string | null;
}

function buildMatrixFromReportCardSnapshot(
  cleanClassId: string,
  targetHomeworkSession: number
): ResolvedMatrixSource | null {
  const rc = reportCardRepo.findOne(cleanClassId);
  if (!rc?.lmsSnapshotJson) return null;

  const snap = parseReportCardLmsSnapshot(rc.lmsSnapshotJson, cleanClassId);
  if (
    !snap ||
    !Array.isArray(snap.students) ||
    snap.students.length === 0 ||
    !Array.isArray(snap.btvnSessions) ||
    snap.btvnSessions.length === 0
  ) {
    return null;
  }

  const columns: ScoreColumnInfo[] = snap.btvnSessions.map((s, idx) => ({
    colIndex: idx,
    columnId: String(s.lessonId || `RC_BTVN_S${s.sessionNumber}`),
    lessonId: s.lessonId ? String(s.lessonId) : undefined,
    title: String(s.title || `Homework ${s.sessionNumber}`),
    sessionNumber: Number(s.sessionNumber),
    lessonType: "REVIEW_AND_PRACTICE",
  }));

  const targetCol = columns.find(
    (c) => !isExcludedCheckpointOrFinalColumn(c) && Number(c.sessionNumber) === targetHomeworkSession
  );
  if (!targetCol) {
    return null;
  }

  const candidateSessionIds = new Set<string>([
    `${cleanClassId}_SESS_${String(targetHomeworkSession).padStart(2, "0")}`,
    `${cleanClassId}_SESS_${targetHomeworkSession}`,
  ]);
  try {
    if (typeof classSessionRepo?.findByClass === "function") {
      const classSessions = classSessionRepo.findByClass(cleanClassId);
      for (const cs of classSessions) {
        if (Number(cs?.sessionNumber) === targetHomeworkSession && cs?.sessionId) {
          candidateSessionIds.add(String(cs.sessionId).trim());
        }
      }
    }
  } catch {
    // Best-effort lookup of class session IDs
  }

  const subByStudentId = new Map<
    string,
    { id?: number; decision?: string; status?: string; score?: number }
  >();
  const rankSubmissionEntry = (entry: { decision?: string; status?: string }): number => {
    if (entry.status === "VERIFIED") return 4;
    if (entry.status === "APPROVED") return 3;
    if (entry.decision !== "REDO") return 2;
    return 1;
  };
  try {
    for (const sid of candidateSessionIds) {
      const subs = homeworkSubmissionRepo.findBySession(cleanClassId, sid);
      for (const sub of subs) {
        if (!sub?.studentId) continue;
        const prev = subByStudentId.get(sub.studentId);
        const nextEntry = {
          id: sub.id,
          decision: sub.decision,
          status: sub.status,
          score: sub.teacherOverrideScore ?? sub.calculatedScore,
        };
        if (
          !prev ||
          rankSubmissionEntry(nextEntry) > rankSubmissionEntry(prev) ||
          (rankSubmissionEntry(nextEntry) === rankSubmissionEntry(prev) &&
            (nextEntry.id ?? 0) >= (prev.id ?? 0))
        ) {
          subByStudentId.set(sub.studentId, nextEntry);
        }
      }
    }
  } catch {
    // Best-effort overlay from downloaded homework_submissions
  }

  const rows: StudentScoreRow[] = snap.students.map((stu) => {
    const cells: Record<string, any> = {};
    if (targetCol) {
      const rawEntry = stu.btvnScores?.[targetHomeworkSession];
      const hasPracticeScore =
        typeof rawEntry?.practiceRaw === "number" && Number.isFinite(rawEntry.practiceRaw);
      const localSub = subByStudentId.get(stu.studentId);

      let status: "GRADED" | "SUBMITTED_UNGRADED" | "NOT_SUBMITTED" | "REDO_REQUESTED" =
        "NOT_SUBMITTED";
      let score: number | null = null;

      if (hasPracticeScore) {
        status = "GRADED";
        score = rawEntry!.practiceRaw!;
      } else if (localSub) {
        if (localSub.decision === "REDO") {
          status = "REDO_REQUESTED";
        } else if (localSub.status === "VERIFIED" || localSub.status === "APPROVED") {
          status = "GRADED";
          score = typeof localSub.score === "number" ? localSub.score : 0;
        } else {
          status = "SUBMITTED_UNGRADED";
        }
      }

      cells[targetCol.columnId] = {
        columnId: targetCol.columnId,
        lessonId: targetCol.lessonId,
        sessionNumber: targetHomeworkSession,
        status,
        score,
        quizScore:
          typeof rawEntry?.theoryRaw === "number" && Number.isFinite(rawEntry.theoryRaw)
            ? rawEntry.theoryRaw
            : null,
        maxScore: rawEntry?.practiceMax || 100,
        rawText: status,
      };
    }

    return {
      studentId: stu.studentId,
      studentUid: stu.studentUid,
      fullName: stu.fullName,
      isActive: stu.isActive !== false,
      cells,
      averageScore: null,
      averageQuizScore: null,
      gradedCount: 0,
      submittedUngradedCount: 0,
      notSubmittedCount: 0,
      redoCount: 0,
    };
  });

  return {
    columns,
    rows,
    source: "REPORT_CARD_SNAPSHOT",
    scrapedAt: snap.scrapedAt || rc.updatedAt || null,
  };
}

function doesMatrixCoverActiveRoster(
  rows: StudentScoreRow[],
  activeDbStudents: StudentRecord[]
): boolean {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  if (activeDbStudents.length === 0) {
    return rows.some((r) => r.isActive !== false);
  }

  const rowIds = new Set<string>();
  const rowNameCounts = new Map<string, number>();
  for (const r of rows) {
    if (r?.studentId) rowIds.add(String(r.studentId).trim());
    if (r?.studentUid) rowIds.add(String(r.studentUid).trim());
    const norm = normalizeVietnameseName(r?.fullName || "");
    if (norm) {
      rowNameCounts.set(norm, (rowNameCounts.get(norm) || 0) + 1);
    }
  }

  const activeNameCounts = new Map<string, number>();
  for (const stu of activeDbStudents) {
    const norm = normalizeVietnameseName(stu.fullName || "");
    if (norm) {
      activeNameCounts.set(norm, (activeNameCounts.get(norm) || 0) + 1);
    }
  }

  return activeDbStudents.every((stu) => {
    if (rowIds.has(stu.studentId)) return true;
    const norm = normalizeVietnameseName(stu.fullName || "");
    return Boolean(norm && activeNameCounts.get(norm) === 1 && rowNameCounts.get(norm) === 1);
  });
}

async function resolveMatrixSource(
  cleanClassId: string,
  targetHomeworkSession: number,
  forceLiveScrape: boolean,
  activeDbStudents: StudentRecord[]
): Promise<ResolvedMatrixSource> {
  if (!forceLiveScrape) {
    const cachedMatrix = scoreMatrixRepo.findByClass(cleanClassId);
    const matrix = cachedMatrix?.matrix;
    const hasValidStructure =
      Boolean(matrix) &&
      Array.isArray(matrix.columns) &&
      matrix.columns.length > 0 &&
      Array.isArray(matrix.rows) &&
      matrix.rows.length > 0;

    if (hasValidStructure) {
      const cols = matrix.columns as ScoreColumnInfo[];
      const rows = matrix.rows as StudentScoreRow[];
      const hasTargetHomeworkColumn = cols.some(
        (col) =>
          !isExcludedCheckpointOrFinalColumn(col) &&
          Number(col?.sessionNumber) === targetHomeworkSession
      );
      if (hasTargetHomeworkColumn && doesMatrixCoverActiveRoster(rows, activeDbStudents)) {
        return {
          columns: cols,
          rows,
          source: "SCORE_MATRIX_CACHE",
          scrapedAt: matrix.scrapedAt || cachedMatrix?.updatedAt || null,
        };
      }
    }
  }

  let liveScrapeError: unknown = null;
  try {
    const scrapeRes = await taskQueue.enqueue({
      id: `btvn_lookup_${cleanClassId}_${Date.now()}`,
      jobType: "SCRAPE_SCORES",
      description: `Quét BTVN Buổi ${targetHomeworkSession} lớp ${cleanClassId} từ LMS`,
      classId: cleanClassId,
      execute: async () => ScoreScraper.scrapeClassScores(cleanClassId),
    });

    if (scrapeRes && scrapeRes.success) {
      return {
        columns: scrapeRes.columns || [],
        rows: scrapeRes.rows || [],
        source: "LIVE_SCRAPE",
        scrapedAt: scrapeRes.scrapedAt || new Date().toISOString(),
      };
    }

    liveScrapeError = new Error(
      scrapeRes?.error || `Không thể cào bảng điểm BTVN lớp ${cleanClassId} từ LMS.`
    );
  } catch (err: unknown) {
    if (isQueueStoppedError(err)) {
      throw err;
    }
    liveScrapeError = err;
  }

  // Only fall back to class_report_cards offline snapshot when !forceLiveScrape and live scrape failed.
  if (!forceLiveScrape) {
    const fromReportCard = buildMatrixFromReportCardSnapshot(cleanClassId, targetHomeworkSession);
    if (fromReportCard) {
      return fromReportCard;
    }
  }

  const errMsg =
    liveScrapeError instanceof Error
      ? liveScrapeError.message
      : `Không thể cào bảng điểm BTVN lớp ${cleanClassId} từ LMS.`;
  throw new BtvnLookupError(errMsg, 502, "SCRAPE_FAILED");
}

/**
 * Looks up active students who have NOT submitted practice homework for
 * `targetHomeworkSession = sessionNumber - 1` from MindX LMS (pure Node HTTP <1s or cached matrix).
 */
export async function lookupPreviousSessionUnsubmittedBtvn(
  params: LookupPreviousSessionUnsubmittedBtvnParams
): Promise<LookupPreviousSessionUnsubmittedBtvnResult> {
  const cleanClassId = String(params?.classId ?? "").trim().toUpperCase();
  if (!cleanClassId || !VALID_CLASS_ID_REGEX.test(cleanClassId)) {
    throw new BtvnLookupError(
      "Thiếu hoặc sai định dạng mã lớp (classId).",
      400,
      "INVALID_CLASS_ID"
    );
  }

  if (isRoboticsClassCode(cleanClassId)) {
    throw new BtvnLookupError(
      `Lớp Robotics (${cleanClassId}) không có bài tập về nhà trên tab Chấm bài LMS.`,
      400,
      "ROBOTICS_NOT_SUPPORTED"
    );
  }

  const sessionNumber = params?.sessionNumber;
  if (typeof sessionNumber !== "number" || !Number.isInteger(sessionNumber)) {
    throw new BtvnLookupError(
      "Số buổi học (sessionNumber) phải là số nguyên từ 2 đến 14.",
      400,
      "INVALID_SESSION_NUMBER"
    );
  }
  if (sessionNumber < 2) {
    throw new BtvnLookupError(
      "Buổi 1 chưa có BTVN buổi trước để kiểm tra (yêu cầu từ Buổi 2 trở lên).",
      400,
      "SESSION_TOO_LOW"
    );
  }
  if (sessionNumber > 14) {
    throw new BtvnLookupError(
      "Số buổi học (sessionNumber) không được vượt quá 14.",
      400,
      "INVALID_SESSION_NUMBER"
    );
  }

  const targetHomeworkSession = sessionNumber - 1;
  const forceLiveScrape = Boolean(params?.forceLiveScrape);

  const allDbStudents = studentRepo.findByClass(cleanClassId, false);
  const activeDbStudents = studentRepo.findByClass(cleanClassId, true);
  if (allDbStudents.length > 0 && activeDbStudents.length === 0) {
    throw new BtvnLookupError(
      `Lớp ${cleanClassId} hiện không có học viên đang theo học (active).`,
      400,
      "NO_ACTIVE_STUDENTS"
    );
  }

  const matrixData = await resolveMatrixSource(
    cleanClassId,
    targetHomeworkSession,
    forceLiveScrape,
    activeDbStudents
  );

  const homeworkColumns = (matrixData.columns || []).filter(
    (col) => !isExcludedCheckpointOrFinalColumn(col)
  );
  const matchingColumns = homeworkColumns.filter(
    (col) => Number(col?.sessionNumber) === targetHomeworkSession
  );

  if (matchingColumns.length === 0) {
    throw new BtvnLookupError(
      `Lớp ${cleanClassId} chưa có cột BTVN cho Buổi ${targetHomeworkSession} trên LMS (buổi này chỉ có cột Checkpoint hoặc chưa mở bài tập).`,
      400,
      "MISSING_BTVN_COLUMN"
    );
  }

  const targetCol = matchingColumns[0];

  let roster: Array<{ studentId: string; fullName: string }> = [];
  if (allDbStudents.length > 0) {
    roster = activeDbStudents.map((s: StudentRecord) => ({
      studentId: s.studentId,
      fullName: s.fullName,
    }));
  } else {
    roster = (matrixData.rows || [])
      .filter((r) => r.isActive !== false)
      .map((r) => ({ studentId: r.studentId, fullName: r.fullName }));
    if (roster.length === 0) {
      throw new BtvnLookupError(
        `Lớp ${cleanClassId} chưa có danh sách học viên đang theo học.`,
        400,
        "NO_ACTIVE_STUDENTS"
      );
    }
  }

  const rowById = new Map<string, StudentScoreRow>();
  const rowNameCounts = new Map<string, number>();
  const rowByUniqueNormName = new Map<string, StudentScoreRow>();

  for (const row of matrixData.rows || []) {
    const sid = String(row?.studentId || "").trim();
    const suid = String(row?.studentUid || "").trim();
    if (sid) rowById.set(sid, row);
    if (suid && !rowById.has(suid)) rowById.set(suid, row);

    const norm = normalizeVietnameseName(row?.fullName || "");
    if (norm) {
      rowNameCounts.set(norm, (rowNameCounts.get(norm) || 0) + 1);
    }
  }

  const rosterNameCounts = new Map<string, number>();
  for (const stu of roster) {
    const norm = normalizeVietnameseName(stu.fullName);
    if (norm) {
      rosterNameCounts.set(norm, (rosterNameCounts.get(norm) || 0) + 1);
    }
  }

  for (const row of matrixData.rows || []) {
    const norm = normalizeVietnameseName(row?.fullName || "");
    if (norm && rowNameCounts.get(norm) === 1 && rosterNameCounts.get(norm) === 1) {
      rowByUniqueNormName.set(norm, row);
    }
  }

  const unsubmittedStudentIds: string[] = [];
  const unsubmittedRawNames: string[] = [];

  for (const stu of roster) {
    const normName = normalizeVietnameseName(stu.fullName);
    const matchedRow =
      rowById.get(stu.studentId) ||
      (normName ? rowByUniqueNormName.get(normName) : undefined);

    const cell: HomeworkCellInput | undefined = matchedRow?.cells?.[targetCol.columnId];
    const { practiceDone } = resolveHomeworkCompletionState(cell);

    if (!practiceDone) {
      unsubmittedStudentIds.push(stu.studentId);
      unsubmittedRawNames.push(stu.fullName);
    }
  }

  const unsubmittedShortNames = unsubmittedRawNames
    .map((name) => formatShortZaloName(name))
    .filter(Boolean);
  const part2Text = buildBtvnPart2(unsubmittedRawNames);

  return {
    classId: cleanClassId,
    sessionNumber,
    targetHomeworkSession,
    columnId: String(targetCol.columnId),
    columnTitle: String(targetCol.title || `Homework ${targetHomeworkSession}`),
    source: matrixData.source,
    totalActiveStudents: roster.length,
    unsubmittedStudentIds,
    unsubmittedRawNames,
    unsubmittedShortNames,
    part2Text,
    scrapedAt: matrixData.scrapedAt,
  };
}
