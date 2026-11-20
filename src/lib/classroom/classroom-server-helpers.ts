import {
  classSessionRepo,
  classroomSessionLogRepo,
  getDb,
  parseFeedbackVersionMeta,
  session14EvalRepo,
  sessionFeedbackRepo,
  type ClassroomSessionLogRecord,
  type ClassroomSessionLogUpsertInput,
} from "@/lib/db/sqlite";
import { findLessonInSyllabus } from "@/lib/db/json-config";
import { listClasses, listStudents } from "@/lib/classes/class-directory";
import {
  CLASSROOM_ISSUE_ITEMS,
  CLASSROOM_PRAISE_ITEMS,
  applyAttendanceToggle,
  buildClassroomToCommentMapping,
  computeCourseAccumulationSummary,
  parseClassroomCountsRecord,
  type ClassroomAttendanceStatus,
  type ClassroomIssueKey,
  type ClassroomPraiseKey,
  type ClassroomStudentState,
} from "./classroom-manager-helpers";

const VALID_CLASS_ID_REGEX = /^[A-Z0-9_-]{2,64}$/;
const PRAISE_KEYS = CLASSROOM_PRAISE_ITEMS.map((i) => i.key) as readonly ClassroomPraiseKey[];
const ISSUE_KEYS = CLASSROOM_ISSUE_ITEMS.map((i) => i.key) as readonly ClassroomIssueKey[];

export function parseValidatedClassId(raw: unknown): string | null {
  const normalized = String(raw ?? "").trim().toUpperCase();
  if (!normalized || !VALID_CLASS_ID_REGEX.test(normalized)) {
    return null;
  }
  return normalized;
}

export function parseValidatedSessionNumber(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const num = Number(raw);
  if (!Number.isInteger(num) || num < 1 || num > 14) {
    return null;
  }
  return num;
}

export function buildClassroomSessionsList(classId: string): Array<{
  sessionNumber: number;
  sessionId: string;
  topic: string;
  date: string;
}> {
  const dbSessions = classSessionRepo.findByClass(classId);
  const byNum = new Map<number, (typeof dbSessions)[number]>();
  for (const s of dbSessions) {
    const n = Number(s.sessionNumber);
    if (Number.isInteger(n) && n >= 1 && n <= 14 && !byNum.has(n)) {
      byNum.set(n, s);
    }
  }

  const out: Array<{ sessionNumber: number; sessionId: string; topic: string; date: string }> = [];
  for (let n = 1; n <= 14; n++) {
    const existing = byNum.get(n);
    const syllabusLesson = findLessonInSyllabus(classId, n);
    const topic =
      (existing?.topic && existing.topic.trim()) ||
      syllabusLesson?.topic ||
      `Buổi học ${n}`;
    out.push({
      sessionNumber: n,
      sessionId: existing?.sessionId || `${classId}_SESS_${n}`,
      topic,
      date: existing?.date || "",
    });
  }
  return out;
}

export function validateAndNormalizeSaveItems(params: {
  classId: string;
  sessionNumber: number;
  sessionId: string;
  rawItems: unknown;
}):
  | { ok: true; upsertInputs: ClassroomSessionLogUpsertInput[]; statesByStudent: Map<string, ClassroomStudentState> }
  | { ok: false; error: string } {
  const { classId, sessionNumber, sessionId, rawItems } = params;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { ok: false, error: "Danh sách 'items' phải là mảng không rỗng." };
  }

  const activeStudents = listStudents(classId, { activeOnly: true });
  const studentMap = new Map(activeStudents.map((s) => [s.studentId.trim(), s]));
  if (studentMap.size === 0) {
    return {
      ok: false,
      error: `Lớp ${classId} chưa có học viên đang theo học trong cơ sở dữ liệu.`,
    };
  }

  const upsertInputs: ClassroomSessionLogUpsertInput[] = [];
  const statesByStudent = new Map<string, ClassroomStudentState>();
  const seenStudents = new Set<string>();

  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      return { ok: false, error: "Mỗi phần tử trong 'items' phải là đối tượng hợp lệ." };
    }
    const item = rawItem as Record<string, unknown>;
    const studentId = String(item.studentId ?? "").trim();
    if (!studentId || !studentMap.has(studentId)) {
      return {
        ok: false,
        error: `Học viên '${studentId || "(trống)"}' không thuộc danh sách đang học của lớp ${classId}.`,
      };
    }
    if (seenStudents.has(studentId)) {
      return {
        ok: false,
        error: `Trùng lặp học viên '${studentId}' trong cùng một lần lưu.`,
      };
    }
    seenStudents.add(studentId);

    const rawAtt = String(item.attendanceStatus ?? "PRESENT").trim().toUpperCase();
    if (rawAtt !== "PRESENT" && rawAtt !== "LATE" && rawAtt !== "ABSENT") {
      return {
        ok: false,
        error: `Trạng thái điểm danh '${rawAtt}' của học viên '${studentId}' không hợp lệ.`,
      };
    }

    const starsRaw = item.stars === undefined ? 0 : item.stars;
    const medalsRaw = item.medals === undefined ? 0 : item.medals;
    if (
      typeof starsRaw !== "number" ||
      !Number.isInteger(starsRaw) ||
      starsRaw < 0 ||
      starsRaw > 999
    ) {
      return {
        ok: false,
        error: `Số sao của học viên '${studentId}' phải là số nguyên từ 0 đến 999.`,
      };
    }
    if (
      typeof medalsRaw !== "number" ||
      !Number.isInteger(medalsRaw) ||
      medalsRaw < 0 ||
      medalsRaw > 999
    ) {
      return {
        ok: false,
        error: `Số huy hiệu của học viên '${studentId}' phải là số nguyên từ 0 đến 999.`,
      };
    }

    const praiseCounts = parseClassroomCountsRecord(
      item.praiseCounts ?? item.praiseCountsJson ?? {},
      PRAISE_KEYS
    );
    const issueCounts = parseClassroomCountsRecord(
      item.issueCounts ?? item.issueCountsJson ?? {},
      ISSUE_KEYS
    );

    const baseState: ClassroomStudentState = {
      studentId,
      fullName: studentMap.get(studentId)!.fullName,
      attendanceStatus: rawAtt as ClassroomAttendanceStatus,
      stars: starsRaw,
      medals: medalsRaw,
      praiseCounts,
      issueCounts,
      teacherQuickNote: String(item.teacherQuickNote ?? "").slice(0, 1000),
    };

    const syncedState = applyAttendanceToggle(baseState, baseState.attendanceStatus);
    let expectedRowVer: number | undefined = undefined;
    if (item.expectedRowVer !== undefined && item.expectedRowVer !== null) {
      if (
        typeof item.expectedRowVer !== "number" ||
        !Number.isInteger(item.expectedRowVer) ||
        item.expectedRowVer < 0 ||
        item.expectedRowVer > 1_000_000
      ) {
        return {
          ok: false,
          error: `Phiên bản dòng (expectedRowVer) của học viên '${studentId}' phải là số nguyên không âm.`,
        };
      }
      expectedRowVer = item.expectedRowVer;
    }

    upsertInputs.push({
      classId,
      sessionNumber,
      sessionId,
      studentId,
      attendanceStatus: syncedState.attendanceStatus,
      stars: syncedState.stars,
      medals: syncedState.medals,
      praiseCountsJson: JSON.stringify(syncedState.praiseCounts),
      issueCountsJson: JSON.stringify(syncedState.issueCounts),
      teacherQuickNote: syncedState.teacherQuickNote,
      expectedRowVer,
    });
    statesByStudent.set(studentId, syncedState);
  }

  return { ok: true, upsertInputs, statesByStudent };
}

export function buildClassroomStatePayload(params: {
  requestedClassId?: string | null;
  requestedSessionNumber?: number | null;
}) {
  const runningClasses = listClasses({ scope: "running" });
  let classId = params.requestedClassId ? parseValidatedClassId(params.requestedClassId) : null;

  if (!classId && runningClasses.length > 0) {
    classId = String(runningClasses[0].classCode || "").trim().toUpperCase();
  }
  if (!classId) {
    try {
      const db = getDb();
      const firstRow = db
        .prepare(`SELECT classId FROM classes_sessions ORDER BY id ASC LIMIT 1`)
        .get() as { classId?: string } | undefined;
      if (firstRow?.classId) {
        classId = String(firstRow.classId).trim().toUpperCase();
      }
    } catch {}
  }

  if (!classId) {
    return {
      runningClasses,
      classId: "",
      sessionNumber: 1,
      sessions: [],
      students: [] as Array<
        ClassroomStudentState & {
          commentStatus?: string;
        }
      >,
      courseAccumulation: [],
    };
  }

  const matchedClass = runningClasses.find(
    (c) => String(c.classCode || "").trim().toUpperCase() === classId
  );
  const sessions = buildClassroomSessionsList(classId);

  let sessionNumber = params.requestedSessionNumber ?? null;
  if (!sessionNumber) {
    const inferredCurrent = Number(matchedClass?.currentSessionNumber || 0);
    if (Number.isInteger(inferredCurrent) && inferredCurrent >= 1 && inferredCurrent <= 14) {
      sessionNumber = inferredCurrent;
    } else {
      const dbSessions = classSessionRepo.findByClass(classId);
      const maxSess = dbSessions.reduce(
        (acc, s) => Math.max(acc, Number(s.sessionNumber || 0)),
        0
      );
      sessionNumber = maxSess >= 1 && maxSess <= 14 ? maxSess : 1;
    }
  }

  const activeStudents = listStudents(classId, { activeOnly: true });
  const sessionLogs = classroomSessionLogRepo.findBySession(classId, sessionNumber);
  const logByStudent = new Map<string, ClassroomSessionLogRecord>(
    sessionLogs.map((l) => [l.studentId, l])
  );

  const allLogs = classroomSessionLogRepo.findByClassAllSessions(classId);
  const courseAccumulation = computeCourseAccumulationSummary(
    activeStudents.map((s) => ({ studentId: s.studentId, fullName: s.fullName })),
    allLogs
  );
  const accByStudent = new Map(courseAccumulation.map((c) => [c.studentId, c]));

  const currentSessInfo = sessions.find((s) => s.sessionNumber === sessionNumber);
  const targetSessionId = currentSessInfo?.sessionId || `${classId}_SESS_${sessionNumber}`;
  const feedbackMap = new Map<string, { attendanceStatus?: string; status?: string }>(
    sessionNumber <= 13
      ? sessionFeedbackRepo
          .findBySession(classId, targetSessionId)
          .map((f) => [f.studentId, { attendanceStatus: f.attendanceStatus, status: f.status }])
      : session14EvalRepo
          .findByClass(classId)
          .map((e) => [e.studentId, { status: e.status }])
  );

  const students = activeStudents.map((st) => {
    const log = logByStudent.get(st.studentId);
    const fb = feedbackMap.get(st.studentId);
    const acc = accByStudent.get(st.studentId);
    const rawAtt = log?.attendanceStatus
      ? log.attendanceStatus
      : fb && "attendanceStatus" in fb && fb.attendanceStatus === "ABSENT"
      ? "ABSENT"
      : fb && "attendanceStatus" in fb && fb.attendanceStatus === "LATE"
      ? "LATE"
      : "PRESENT";
    const att: ClassroomAttendanceStatus =
      rawAtt === "ABSENT" || rawAtt === "LATE" ? rawAtt : "PRESENT";

    const baseRow: ClassroomStudentState = {
      studentId: st.studentId,
      fullName: st.fullName,
      attendanceStatus: att,
      stars: Math.max(0, Math.floor(Number(log?.stars || 0))),
      medals: Math.max(0, Math.floor(Number(log?.medals || 0))),
      praiseCounts: parseClassroomCountsRecord(log?.praiseCountsJson, PRAISE_KEYS),
      issueCounts: parseClassroomCountsRecord(log?.issueCountsJson, ISSUE_KEYS),
      teacherQuickNote: String(log?.teacherQuickNote ?? ""),
      courseTotalStars: acc?.totalStars ?? 0,
      courseTotalMedals: acc?.totalMedals ?? 0,
      rowVer: Number(log?.rowVer || 0),
      appliedToCommentAt: log?.appliedToCommentAt ?? null,
    };

    const synced = applyAttendanceToggle(baseRow, baseRow.attendanceStatus);
    return {
      ...synced,
      commentStatus: (fb as any)?.status || "DRAFT",
    };
  });

  return {
    runningClasses,
    classId,
    sessionNumber,
    sessions,
    students,
    courseAccumulation,
  };
}

export function applyClassroomLogsToSessionComments(params: {
  classId: string;
  sessionNumber: number;
  upsertInputs?: ClassroomSessionLogUpsertInput[];
}): {
  targetUrl: string;
  sessionId: string;
  appliedCount: number;
  skippedVerifiedCount: number;
} {
  const { classId, sessionNumber, upsertInputs } = params;
  const db = getDb();

  const runTx = () => {
    const sessions = buildClassroomSessionsList(classId);
    const targetSessInfo = sessions.find((s) => s.sessionNumber === sessionNumber);
    const targetSessionId = targetSessInfo?.sessionId || `${classId}_SESS_${sessionNumber}`;
    const runningClasses = listClasses({ scope: "all" });
    const matchedClass = runningClasses.find(
      (c) => String(c.classCode || "").trim().toUpperCase() === classId
    );

    if (upsertInputs && upsertInputs.length > 0) {
      classroomSessionLogRepo.upsertBatch(upsertInputs);
    }

    const activeStudents = listStudents(classId, { activeOnly: true });
    const sessionLogs = classroomSessionLogRepo.findBySession(classId, sessionNumber);
    const logMap = new Map(sessionLogs.map((l) => [l.studentId, l]));

    const nowStamp = new Date().toISOString();
    let appliedCount = 0;
    let skippedVerifiedCount = 0;

    const markAppliedStmt = db.prepare(`
      INSERT INTO classroom_session_logs (
        classId, sessionNumber, sessionId, studentId,
        attendanceStatus, stars, medals, praiseCountsJson, issueCountsJson,
        teacherQuickNote, appliedToCommentAt, rowVer, updatedAt
      )
      VALUES (
        @classId, @sessionNumber, @sessionId, @studentId,
        @attendanceStatus, @stars, @medals, @praiseCountsJson, @issueCountsJson,
        @teacherQuickNote, @appliedToCommentAt, 1, datetime('now', 'localtime')
      )
      ON CONFLICT(classId, sessionNumber, studentId) DO UPDATE SET
        appliedToCommentAt = excluded.appliedToCommentAt,
        updatedAt = datetime('now', 'localtime')
    `);

    if (sessionNumber >= 1 && sessionNumber <= 13) {
      const existingSessions = classSessionRepo.findByClass(classId);
      const hasSessionRow = existingSessions.some(
        (s) => Number(s.sessionNumber) === sessionNumber
      );
      if (!hasSessionRow) {
        classSessionRepo.upsert({
          classId,
          className: matchedClass?.className || classId,
          sessionId: targetSessionId,
          sessionNumber,
          topic: targetSessInfo?.topic || `Buổi học ${sessionNumber}`,
          date: targetSessInfo?.date || "",
        });
      }

      for (const st of activeStudents) {
        const log = logMap.get(st.studentId);
        const rowState: ClassroomStudentState = applyAttendanceToggle(
          {
            studentId: st.studentId,
            fullName: st.fullName,
            attendanceStatus:
              log?.attendanceStatus === "ABSENT" || log?.attendanceStatus === "LATE"
                ? log.attendanceStatus
                : "PRESENT",
            stars: Math.max(0, Math.floor(Number(log?.stars || 0))),
            medals: Math.max(0, Math.floor(Number(log?.medals || 0))),
            praiseCounts: parseClassroomCountsRecord(log?.praiseCountsJson, PRAISE_KEYS),
            issueCounts: parseClassroomCountsRecord(log?.issueCountsJson, ISSUE_KEYS),
            teacherQuickNote: String(log?.teacherQuickNote ?? ""),
          },
          log?.attendanceStatus === "ABSENT" || log?.attendanceStatus === "LATE"
            ? log.attendanceStatus
            : "PRESENT"
        );

        const existingFb = sessionFeedbackRepo.findOne(classId, targetSessionId, st.studentId);
        if (existingFb?.status === "VERIFIED" || existingFb?.status === "SAVING") {
          skippedVerifiedCount += 1;
          continue;
        }

        const mapped = buildClassroomToCommentMapping({
          classCode: classId,
          sessionNumber,
          studentRow: rowState,
        });

        const prevMeta = parseFeedbackVersionMeta(existingFb?.versionMetaJson);
        const prevFields = prevMeta.fields || {};
        const nextMeta = {
          rowVer: (prevMeta.rowVer || 0) + 1,
          fields: {
            ...prevFields,
            attendanceStatus: {
              ver: (prevFields.attendanceStatus?.ver || 0) + 1,
              cid: "classroom-manager",
              rev: (prevFields.attendanceStatus?.rev || 0) + 1,
            },
            quickTags: {
              ver: (prevFields.quickTags?.ver || 0) + 1,
              cid: "classroom-manager",
              rev: (prevFields.quickTags?.rev || 0) + 1,
            },
            teacherNote: {
              ver: (prevFields.teacherNote?.ver || 0) + 1,
              cid: "classroom-manager",
              rev: (prevFields.teacherNote?.rev || 0) + 1,
            },
          },
        };

        const preservedFinalText = existingFb?.finalText || "";
        const nextStatus: "DRAFT" = "DRAFT";

        sessionFeedbackRepo.upsert({
          classId,
          sessionId: targetSessionId,
          studentId: st.studentId,
          attendanceStatus: mapped.attendanceStatus,
          quickTagsJson: JSON.stringify(mapped.quickTags),
          teacherNote: mapped.teacherNote,
          strengths: existingFb?.strengths ?? "",
          improvements: existingFb?.improvements ?? "",
          actionPlan: existingFb?.actionPlan ?? "",
          finalText: preservedFinalText,
          contentHash: "",
          status: nextStatus,
          verifiedAt: null,
          errorMessage: null,
          versionMetaJson: JSON.stringify(nextMeta),
        });

        appliedCount += 1;
        markAppliedStmt.run({
          classId,
          sessionNumber,
          sessionId: targetSessionId,
          studentId: st.studentId,
          attendanceStatus: rowState.attendanceStatus,
          stars: rowState.stars,
          medals: rowState.medals,
          praiseCountsJson: JSON.stringify(rowState.praiseCounts),
          issueCountsJson: JSON.stringify(rowState.issueCounts),
          teacherQuickNote: rowState.teacherQuickNote,
          appliedToCommentAt: nowStamp,
        });
      }

      return {
        targetUrl: `/session-comments?classId=${encodeURIComponent(classId)}&sessionNumber=${sessionNumber}&fromClassroom=1`,
        sessionId: targetSessionId,
        appliedCount,
        skippedVerifiedCount,
      };
    }

    // Session 14 routes to /final-project Session 14 evaluation notes
    for (const st of activeStudents) {
      const log = logMap.get(st.studentId);
      const rowState: ClassroomStudentState = applyAttendanceToggle(
        {
          studentId: st.studentId,
          fullName: st.fullName,
          attendanceStatus:
            log?.attendanceStatus === "ABSENT" || log?.attendanceStatus === "LATE"
              ? log.attendanceStatus
              : "PRESENT",
          stars: Math.max(0, Math.floor(Number(log?.stars || 0))),
          medals: Math.max(0, Math.floor(Number(log?.medals || 0))),
          praiseCounts: parseClassroomCountsRecord(log?.praiseCountsJson, PRAISE_KEYS),
          issueCounts: parseClassroomCountsRecord(log?.issueCountsJson, ISSUE_KEYS),
          teacherQuickNote: String(log?.teacherQuickNote ?? ""),
        },
        log?.attendanceStatus === "ABSENT" || log?.attendanceStatus === "LATE"
          ? log.attendanceStatus
          : "PRESENT"
      );

      const existing14 = session14EvalRepo.findOne(classId, st.studentId);
      if (existing14?.status === "VERIFIED" || (existing14?.status as string) === "SAVING") {
        skippedVerifiedCount += 1;
        continue;
      }

      const mapped = buildClassroomToCommentMapping({
        classCode: classId,
        sessionNumber: 14,
        studentRow: rowState,
      });

      const prevNote = String(existing14?.teacherNote || "").trim();
      const classroomTag = "[Giờ học B14]";
      const s14Summary = mapped.teacherNote.replace(/[\r\n]+/g, " ").trim();
      const s14LineRegex = /^[ \t]*\[Giờ học B14\][^\r\n]*$/im;
      const replacementLine = `${classroomTag} ${s14Summary}`;
      const mergedNote = s14Summary
        ? s14LineRegex.test(prevNote)
          ? prevNote.replace(s14LineRegex, replacementLine)
          : prevNote
          ? `${prevNote}\n${replacementLine}`
          : replacementLine
        : prevNote;

      session14EvalRepo.saveDraft({
        classId,
        studentId: st.studentId,
        teacherNote: mergedNote,
      });

      appliedCount += 1;
      markAppliedStmt.run({
        classId,
        sessionNumber: 14,
        sessionId: targetSessionId,
        studentId: st.studentId,
        attendanceStatus: rowState.attendanceStatus,
        stars: rowState.stars,
        medals: rowState.medals,
        praiseCountsJson: JSON.stringify(rowState.praiseCounts),
        issueCountsJson: JSON.stringify(rowState.issueCounts),
        teacherQuickNote: rowState.teacherQuickNote,
        appliedToCommentAt: nowStamp,
      });
    }

    return {
      targetUrl: `/final-project?classId=${encodeURIComponent(classId)}&sessionNumber=14&fromClassroom=1`,
      sessionId: targetSessionId,
      appliedCount,
      skippedVerifiedCount,
    };
  };

  if (typeof (db as any).transaction === "function") {
    return (db as any).transaction(runTx)();
  }
  return runTx();
}
