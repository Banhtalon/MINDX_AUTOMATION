/**
 * MINDX AUTOMATION BOT - CHECKPOINT HISTORY LOADER & DB COMPUTATION SERVICE (v3.8.6)
 * Server-side helper to load stage history (prior session_feedbacks, classroom_session_logs,
 * and Coding score_matrix_cache / class_report_cards BTVN + #tab-3 Checkpoint scores) for a Checkpoint session,
 * reconcile #tab-10 slot vs #tab-3 submission scores, compute the 9 [ĐNL] competency ratings + process summary,
 * and optionally persist them.
 */

import {
  classSessionRepo,
  classroomSessionLogRepo,
  extractCheckpointCoreSnapshotHash,
  getDb,
  parseFeedbackVersionMeta,
  reportCardRepo,
  scoreMatrixRepo,
  sessionFeedbackRepo,
  studentRepo,
  type SessionFeedbackRecord,
} from "../db/sqlite";
import {
  computeStudentProcessCompetency,
  formatCheckpointScoreHeaderLine,
  parseCheckpointDataJson,
  reconcileCheckpointTestScores,
  resolveCheckpointColumnStagePure,
  resolveCheckpointStageForSession,
  scaleSubmissionScoreTo5,
  upsertCheckpointHeaderIntoFinalText,
  type CheckpointStudentData,
  type HomeworkHistoryInput,
  type PriorClassroomLogInput,
  type PriorSessionFeedbackInput,
} from "./checkpoint-competency";

function parseSessionNumberSafe(sessionId: string, dbNum?: number | null): number {
  if (typeof dbNum === "number" && Number.isInteger(dbNum) && dbNum > 0) return dbNum;
  const m = String(sessionId || "")
    .trim()
    .match(/(?:^|[_-])SESS(?:ION)?[_-]?0*(\d+)$/i);
  if (!m) return 0;
  const parsed = Number(m[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function parseJsonObjectSafe<T = Record<string, any>>(raw?: string | null, fallback: T = {} as T): T {
  if (!raw || typeof raw !== "string") return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function parseStringArraySafe(raw?: string | null): string[] {
  if (!raw || typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function extractHomeworkHistoryForClass(
  classId: string,
  stageStart: number,
  stageEnd: number,
  isRobotics: boolean
): Map<string, HomeworkHistoryInput> {
  const result = new Map<string, HomeworkHistoryInput>();
  if (isRobotics) return result;

  // 1. Primary source: score_matrix_cache
  try {
    const cached = typeof scoreMatrixRepo?.findByClass === "function"
      ? scoreMatrixRepo.findByClass(classId)
      : null;
    const matrix = cached?.matrix;
    if (matrix && Array.isArray(matrix.columns) && Array.isArray(matrix.rows)) {
      const eligibleColIds = new Set<string>();
      for (const col of matrix.columns) {
        const isCpCol =
          String(col?.lessonType || "").toUpperCase() === "CHECKPOINT" ||
          /bài\s*kiểm\s*tra|kiểm\s*tra\s*định\s*kỳ|checkpoint/i.test(String(col?.title || "")) ||
          resolveCheckpointColumnStagePure({
            id: col?.lessonId || col?.columnId,
            title: col?.title,
            lessonType: col?.lessonType,
          }) !== null;
        if (isCpCol) continue;
        const sNum = Number(col?.sessionNumber || 0);
        if (sNum >= stageStart && sNum < stageEnd) {
          eligibleColIds.add(String(col.columnId));
        }
      }
      if (eligibleColIds.size > 0) {
        for (const row of matrix.rows) {
          const sid = String(row?.studentId || "").trim();
          if (!sid || !row.cells || typeof row.cells !== "object") continue;
          let gradedCount = 0;
          let submittedCount = 0;
          let scoreSum100 = 0;
          let scoreSamples = 0;

          for (const cid of eligibleColIds) {
            const cell = row.cells[cid];
            if (!cell) continue;
            const st = String(cell.status || "").toUpperCase();
            if (st === "GRADED") {
              gradedCount++;
              submittedCount++;
              const maxScore = Number(cell.maxScore || 100) || 100;
              if (typeof cell.score === "number" && Number.isFinite(cell.score)) {
                scoreSum100 += (cell.score / maxScore) * 100;
                scoreSamples++;
              }
            } else if (st === "SUBMITTED_UNGRADED" || st === "REDO_REQUESTED") {
              submittedCount++;
            }
          }

          result.set(sid, {
            gradedCount: submittedCount,
            totalEligible: eligibleColIds.size,
            completionRate: submittedCount / eligibleColIds.size,
            avgScore100: scoreSamples > 0 ? scoreSum100 / scoreSamples : null,
          });
        }
        if (result.size > 0) return result;
      }
    }
  } catch {}

  // 2. Fallback source: class_report_cards LMS snapshot
  try {
    const rc = typeof reportCardRepo?.findOne === "function"
      ? reportCardRepo.findOne(classId)
      : undefined;
    if (rc?.lmsSnapshotJson) {
      const snap = parseJsonObjectSafe<any>(rc.lmsSnapshotJson, {});
      const studentsArr = Array.isArray(snap?.students) ? snap.students : [];
      for (const st of studentsArr) {
        const sid = String(st?.studentId || "").trim();
        const btvnList = Array.isArray(st?.btvnSessions) ? st.btvnSessions : [];
        if (!sid || btvnList.length === 0) continue;
        const stageBtvn = btvnList.filter((b: any) => {
          const sNum = Number(b?.sessionNumber || 0);
          return sNum >= stageStart && sNum < stageEnd;
        });
        if (stageBtvn.length === 0) continue;
        let submitted = 0;
        let sum100 = 0;
        let cntScore = 0;
        for (const item of stageBtvn) {
          if (typeof item?.score === "number" && Number.isFinite(item.score)) {
            submitted++;
            const max = Number(item.maxScore || 100) || 100;
            sum100 += (item.score / max) * 100;
            cntScore++;
          } else if (item?.submitted) {
            submitted++;
          }
        }
        result.set(sid, {
          gradedCount: submitted,
          totalEligible: stageBtvn.length,
          completionRate: submitted / stageBtvn.length,
          avgScore100: cntScore > 0 ? sum100 / cntScore : null,
        });
      }
    }
  } catch {}

  return result;
}

export interface SubmissionCheckpointScoreEntry {
  subTheory: number | null;
  subPractice: number | null;
  subPracticeStatus: string | null;
  subPracticeHasAttachments: boolean;
}

/**
 * Trích xuất điểm Lý thuyết (Quiz) & Thực hành (Submission) của chặng Checkpoint từ `#tab-3 Chấm bài`
 * (`score_matrix_cache`) cho các lớp Coding.
 * Lớp Robotics bỏ qua ngay lập tức (trả Map rỗng).
 */
export function extractCheckpointSubmissionScoresForClass(
  classId: string,
  cpStage: 1 | 2,
  isRobotics: boolean
): Map<string, SubmissionCheckpointScoreEntry> {
  const result = new Map<string, SubmissionCheckpointScoreEntry>();
  if (isRobotics) return result;

  // 1. Primary source: score_matrix_cache CHECKPOINT column
  try {
    const cached =
      typeof scoreMatrixRepo?.findByClass === "function"
        ? scoreMatrixRepo.findByClass(classId)
        : null;
    const matrix = cached?.matrix;
    if (matrix && Array.isArray(matrix.columns) && Array.isArray(matrix.rows)) {
      const cpCol = matrix.columns.find(
        (col: any) =>
          resolveCheckpointColumnStagePure({
            id: col?.lessonId || col?.columnId,
            title: col?.title,
            lessonType: col?.lessonType,
          }) === cpStage
      );

      if (cpCol?.columnId) {
        const colKey = String(cpCol.columnId);
        for (const row of matrix.rows) {
          const sid = String(row?.studentId || "").trim();
          const uid = String(row?.studentUid || "").trim();
          const cell = row?.cells?.[colKey];
          if (!cell || typeof cell !== "object") continue;

          const maxScore =
            typeof cell.maxScore === "number" && Number.isFinite(cell.maxScore) && cell.maxScore > 0
              ? cell.maxScore
              : 100;
          const subTheory =
            typeof cell.quizScore === "number" && Number.isFinite(cell.quizScore)
              ? scaleSubmissionScoreTo5(cell.quizScore, maxScore)
              : null;

          const statusUpper = String(cell.status || "").trim().toUpperCase();
          const subPractice =
            statusUpper === "GRADED" &&
            typeof cell.score === "number" &&
            Number.isFinite(cell.score)
              ? scaleSubmissionScoreTo5(cell.score, maxScore)
              : null;
          const subPracticeHasAttachments =
            (Array.isArray(cell.attachments) && cell.attachments.length > 0) ||
            Boolean(String(cell.submittedAt || "").trim());

          const entry: SubmissionCheckpointScoreEntry = {
            subTheory,
            subPractice,
            subPracticeStatus: statusUpper || null,
            subPracticeHasAttachments,
          };
          if (sid) result.set(sid, entry);
          if (uid && uid !== sid && !result.has(uid)) {
            result.set(uid, entry);
          }
        }
      }
    }
  } catch {}

  return result;
}

export interface ComputeCheckpointForSessionOptions {
  classId: string;
  sessionId: string;
  sessionNumber?: number;
  forceRecalculate?: boolean;
  persist?: boolean;
}

/**
 * Computes (or refreshes while preserving manual `[ĐNL]` edits unless `forceRecalculate` is set)
 * Checkpoint data for all students in the given session.
 */
export function computeCheckpointDataForSession(
  opts: ComputeCheckpointForSessionOptions
): {
  isCheckpoint: boolean;
  cpStage: 1 | 2 | null;
  byStudent: Record<string, CheckpointStudentData>;
  updatedCount: number;
  ungradedPracticeStudents: string[];
} {
  const classId = String(opts.classId || "").trim().toUpperCase();
  const sessionId = String(opts.sessionId || "").trim();
  const sessions = typeof classSessionRepo?.findByClass === "function"
    ? classSessionRepo.findByClass(classId)
    : [];
  const currentSess = sessions.find((s) => s.sessionId === sessionId);
  const sessionNumber = parseSessionNumberSafe(
    sessionId,
    opts.sessionNumber ?? currentSess?.sessionNumber
  );

  const stage = resolveCheckpointStageForSession(classId, sessionNumber);
  if (!stage.isCheckpoint || !stage.cpStage) {
    return {
      isCheckpoint: false,
      cpStage: null,
      byStudent: {},
      updatedCount: 0,
      ungradedPracticeStudents: [],
    };
  }

  const sessNumBySessionId = new Map<string, number>();
  for (const s of sessions) {
    sessNumBySessionId.set(s.sessionId, parseSessionNumberSafe(s.sessionId, s.sessionNumber));
  }

  const allFeedbacks = typeof sessionFeedbackRepo?.findByClass === "function"
    ? sessionFeedbackRepo.findByClass(classId)
    : [];
  const allLogs = typeof classroomSessionLogRepo?.findByClassAllSessions === "function"
    ? classroomSessionLogRepo.findByClassAllSessions(classId)
    : [];
  const students = typeof studentRepo?.findByClass === "function"
    ? studentRepo.findByClass(classId, true)
    : [];
  const hwByStudent = extractHomeworkHistoryForClass(
    classId,
    stage.stageStartSession,
    stage.stageEndSession,
    stage.isRobotics
  );
  const subCpByStudent = extractCheckpointSubmissionScoresForClass(
    classId,
    stage.cpStage,
    stage.isRobotics
  );
  const activeStudentNameById = new Map<string, string>();
  for (const stu of students) {
    if (stu?.studentId) {
      activeStudentNameById.set(stu.studentId, stu.fullName || stu.studentId);
    }
  }

  const feedbacksByStudent = new Map<string, PriorSessionFeedbackInput[]>();
  const currentFeedbackByStudent = new Map<string, SessionFeedbackRecord>();

  for (const fb of allFeedbacks) {
    if (fb.sessionId === sessionId) {
      currentFeedbackByStudent.set(fb.studentId, fb);
    }
    const sNum = parseSessionNumberSafe(fb.sessionId, sessNumBySessionId.get(fb.sessionId));
    if (!sNum) continue;
    const arr = feedbacksByStudent.get(fb.studentId) || [];
    arr.push({
      sessionNumber: sNum,
      attendanceStatus: fb.attendanceStatus || "UNKNOWN",
      quickTags: parseStringArraySafe(fb.quickTagsJson),
      teacherNote: fb.teacherNote || "",
      finalText: fb.finalText || "",
      checkpointData: parseCheckpointDataJson(fb.checkpointDataJson),
    });
    feedbacksByStudent.set(fb.studentId, arr);
  }

  const logsByStudent = new Map<string, PriorClassroomLogInput[]>();
  for (const log of allLogs) {
    const arr = logsByStudent.get(log.studentId) || [];
    arr.push({
      sessionNumber: log.sessionNumber,
      attendanceStatus: log.attendanceStatus,
      stars: Number(log.stars || 0),
      medals: Number(log.medals || 0),
      issueCounts: parseJsonObjectSafe<Record<string, number>>(log.issueCountsJson, {}),
      praiseCounts: parseJsonObjectSafe<Record<string, number>>(log.praiseCountsJson, {}),
    });
    logsByStudent.set(log.studentId, arr);
  }

  const byStudent: Record<string, CheckpointStudentData> = {};
  let updatedCount = 0;
  const ungradedPracticeStudents: string[] = [];

  const targetStudentIds = new Set<string>([
    ...students.map((s) => s.studentId),
    ...currentFeedbackByStudent.keys(),
  ]);

  const db = opts.persist && typeof getDb === "function" ? getDb() : null;
  const updateCpOnlyStmt =
    opts.persist && typeof (db as any)?.prepare === "function"
      ? (db as any).prepare(
          `UPDATE session_feedbacks
           SET checkpointDataJson = ?, updatedAt = datetime('now', 'localtime')
           WHERE classId = ? AND sessionId = ? AND studentId = ?`
        )
      : null;

  for (const studentId of targetStudentIds) {
    const currentFb = currentFeedbackByStudent.get(studentId);
    const existingCp = parseCheckpointDataJson(currentFb?.checkpointDataJson);
    const currentTags = parseStringArraySafe(currentFb?.quickTagsJson);
    const subEntry = subCpByStudent.get(studentId);

    const slotTheory =
      existingCp?.slotTheoryScore !== undefined
        ? existingCp.slotTheoryScore
        : !existingCp?.userEditedTheory
          ? existingCp?.theoryScore ?? null
          : null;
    const slotPractice =
      existingCp?.slotPracticeScore !== undefined
        ? existingCp.slotPracticeScore
        : !existingCp?.userEditedPractice
          ? existingCp?.practiceScore ?? null
          : null;

    const reconciled = reconcileCheckpointTestScores({
      slotTheory,
      slotPractice,
      subTheory: subEntry?.subTheory ?? null,
      subPractice: subEntry?.subPractice ?? null,
      subPracticeStatus: subEntry?.subPracticeStatus ?? null,
      subPracticeHasAttachments: subEntry?.subPracticeHasAttachments ?? false,
      manualTheory: existingCp?.userEditedTheory ? existingCp.theoryScore ?? null : null,
      manualPractice: existingCp?.userEditedPractice ? existingCp.practiceScore ?? null : null,
      userEditedTheory: Boolean(existingCp?.userEditedTheory),
      userEditedPractice: Boolean(existingCp?.userEditedPractice),
    });

    const attUpper = String(currentFb?.attendanceStatus || "UNKNOWN").trim().toUpperCase();
    const isActiveForWarning =
      (students.length === 0 || activeStudentNameById.has(studentId)) &&
      attUpper !== "ABSENT" &&
      attUpper !== "EXCUSED";
    if (reconciled.hasUngradedPractice && isActiveForWarning) {
      ungradedPracticeStudents.push(activeStudentNameById.get(studentId) || studentId);
    }

    const computed = computeStudentProcessCompetency({
      classCode: classId,
      sessionNumber,
      theoryScore: reconciled.theoryScore,
      practiceScore: reconciled.practiceScore,
      priorFeedbacks: feedbacksByStudent.get(studentId) || [],
      classroomLogs: logsByStudent.get(studentId) || [],
      homeworkHistory: hwByStudent.get(studentId) || null,
      currentAttendanceStatus: currentFb?.attendanceStatus || "UNKNOWN",
      currentQuickTags: currentTags,
      existingLmsRatings: existingCp?.lmsCompetencyScores || null,
    });

    const preserveManualCompetency =
      !opts.forceRecalculate &&
      Boolean(existingCp?.userEditedCompetency) &&
      Boolean(existingCp?.competencyScores);

    const extraCheckpointMeta = {
      slotTheoryScore: slotTheory,
      slotPracticeScore: slotPractice,
      userEditedTheory: Boolean(existingCp?.userEditedTheory),
      userEditedPractice: Boolean(existingCp?.userEditedPractice),
      hasUngradedPractice: reconciled.hasUngradedPractice,
    };

    const finalCp: CheckpointStudentData = preserveManualCompetency
      ? {
          ...computed,
          ...extraCheckpointMeta,
          competencyScores: existingCp!.competencyScores,
          competencyAverage: existingCp!.competencyAverage,
          source: "MANUAL_UI",
          userEditedCompetency: true,
          lmsSyncedAt: existingCp?.lmsSyncedAt ?? null,
          approvedSnapshotHash: existingCp?.approvedSnapshotHash ?? null,
        }
      : {
          ...computed,
          ...extraCheckpointMeta,
          lmsSyncedAt: existingCp?.lmsSyncedAt ?? null,
          approvedSnapshotHash: existingCp?.approvedSnapshotHash ?? null,
        };

    byStudent[studentId] = finalCp;

    if (opts.persist) {
      const prevCoreHash = extractCheckpointCoreSnapshotHash(currentFb?.checkpointDataJson);
      const nextJsonInitial = JSON.stringify(finalCp);
      const nextCoreHash = extractCheckpointCoreSnapshotHash(nextJsonInitial);
      const coreScoresChanged = nextCoreHash !== prevCoreHash;

      if (coreScoresChanged) {
        finalCp.approvedSnapshotHash = null;
      }
      const nextJson = JSON.stringify(finalCp);

      if (currentFb) {
        const curText = String(currentFb.finalText || "");
        const hasEditableCommentBody =
          curText.trim().length > 0 && !curText.trim().startsWith("Chưa đủ thông tin");
        let refreshedFinalText = curText;
        if (hasEditableCommentBody && (coreScoresChanged || opts.forceRecalculate)) {
          const headerLine = formatCheckpointScoreHeaderLine({
            cpStage: finalCp.cpStage,
            theoryScore: finalCp.theoryScore,
            practiceScore: finalCp.practiceScore,
            competencyAverage: finalCp.competencyAverage,
          });
          refreshedFinalText = upsertCheckpointHeaderIntoFinalText(curText, headerLine);
        }
        const finalTextChanged = refreshedFinalText !== curText;

        if (coreScoresChanged || finalTextChanged) {
          const prevMeta = parseFeedbackVersionMeta(currentFb.versionMetaJson);
          const shouldDemote =
            coreScoresChanged &&
            (currentFb.status === "APPROVED" || currentFb.status === "VERIFIED");
          sessionFeedbackRepo.upsert({
            ...currentFb,
            classId,
            sessionId,
            studentId,
            finalText: refreshedFinalText,
            status: shouldDemote ? "DRAFT" : currentFb.status,
            contentHash: shouldDemote ? "" : currentFb.contentHash,
            verifiedAt: shouldDemote ? null : currentFb.verifiedAt,
            versionMetaJson: JSON.stringify({
              rowVer: (prevMeta.rowVer || 0) + 1,
              fields: prevMeta.fields || {},
            }),
            checkpointDataJson: nextJson,
          });
          updatedCount++;
        } else if (
          updateCpOnlyStmt &&
          (opts.forceRecalculate ||
            !existingCp ||
            JSON.stringify(existingCp.processSummary || null) !==
              JSON.stringify(finalCp.processSummary || null) ||
            Boolean(existingCp.hasUngradedPractice) !== Boolean(finalCp.hasUngradedPractice) ||
            existingCp.slotTheoryScore === undefined ||
            !existingCp.competencyScores)
        ) {
          updateCpOnlyStmt.run(nextJson, classId, sessionId, studentId);
          updatedCount++;
        }
      } else {
        sessionFeedbackRepo.upsert({
          classId,
          sessionId,
          studentId,
          attendanceStatus: "UNKNOWN",
          status: "DRAFT",
          checkpointDataJson: nextJson,
        });
        updatedCount++;
      }
    }
  }

  return {
    isCheckpoint: true,
    cpStage: stage.cpStage,
    byStudent,
    updatedCount,
    ungradedPracticeStudents,
  };
}
