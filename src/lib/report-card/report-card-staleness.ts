import { queryClassDirectory } from "@/lib/classes/class-directory";
import {
  getCoursesSyllabus,
  getRunningClasses,
  type CourseSyllabus,
} from "@/lib/db/json-config";
import {
  classSessionRepo,
  session14EvalRepo,
  sessionFeedbackRepo,
  studentRepo,
  type SpckSession14EvaluationRecord,
} from "@/lib/db/sqlite";
import { taskQueue } from "@/lib/queue/task-queue";
import { ScoreScraper } from "@/lib/playwright/scrape-scores";
import { resolveCheckpointSessionsForClass } from "@/lib/quick-tags";
import {
  round2,
  type ClassReportCardLmsSnapshot,
} from "@/lib/report-card/report-card-calculator";
import { stripVietnameseDiacritics } from "@/lib/utils/vietnamese-match";

export interface ComputeReportCardStalenessOptions {
  currentSessionNumber?: number | null;
  syllabusList?: Array<Pick<CourseSyllabus, "courseCode" | "checkpointSessions">>;
  nowMs?: number;
}

export interface ReportCardStalenessInfo {
  isStale: boolean;
  hasNewerSession14: boolean;
  hasNewerManualCheckpoint?: boolean;
  missingCheckpointScores: boolean;
  missingCp1: boolean;
  missingCp2: boolean;
  latestSession14UpdatedAt: string | null;
  scrapedAt: string | null;
  reasons: string[];
}

export async function enqueueScrapeClassScores(classCode: string) {
  const cleanCode = classCode.trim().toUpperCase();
  return taskQueue.enqueue({
    id: `scrape_scores_${cleanCode}_${Date.now()}`,
    jobType: "SCRAPE_SCORES",
    description: `Cào bảng điểm toàn khóa lớp ${cleanCode} từ LMS`,
    classId: cleanCode,
    execute: async () => {
      return ScoreScraper.scrapeClassScores(cleanCode);
    },
  });
}

function parseDbOrIsoTimestampMs(raw: string | null | undefined): number | null {
  if (!raw || !String(raw).trim()) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(s)) {
    const t = new Date(s.replace(" ", "T")).getTime();
    return Number.isFinite(t) ? t : null;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function normalizeStudentNameKey(name: string | null | undefined): string {
  return stripVietnameseDiacritics(String(name || "")).replace(/\s+/g, " ").trim();
}

function hasEvaluatedSession14Record(r: SpckSession14EvaluationRecord): boolean {
  return (
    (typeof r.demoTotalScore === "number" &&
      Number.isFinite(r.demoTotalScore) &&
      r.demoTotalScore > 0) ||
    r.status === "APPROVED" ||
    r.status === "VERIFIED" ||
    Boolean(String(r.learnedFromMindx || "").trim())
  );
}

function resolveSnapshotFloorSession(
  activeStudents: ClassReportCardLmsSnapshot["students"],
  cp1Sess: number | null,
  cp2Sess: number | null
): number | null {
  if (!Array.isArray(activeStudents) || activeStudents.length === 0) {
    return null;
  }
  const hasAnyFinal = activeStudents.some(
    (s) =>
      s.stageScores?.finalProduct != null ||
      s.stageScores?.finalCompetency != null
  );
  if (hasAnyFinal) {
    return 14;
  }
  if (cp2Sess !== null) {
    const hasAnyCp2 = activeStudents.some(
      (s) =>
        s.stageScores?.cp2Theory != null ||
        s.stageScores?.cp2Practice != null ||
        s.stageScores?.cp2Competency != null
    );
    if (hasAnyCp2) {
      return cp2Sess;
    }
  }
  if (cp1Sess !== null) {
    const hasAnyCp1 = activeStudents.some(
      (s) =>
        s.stageScores?.cp1Theory != null ||
        s.stageScores?.cp1Practice != null ||
        s.stageScores?.cp1Competency != null
    );
    if (hasAnyCp1) {
      return cp1Sess;
    }
  }
  return null;
}

function resolveEffectiveSessionForStaleness(
  cleanClassId: string,
  hasEvaluatedS14: boolean,
  snapshotFloor: number | null,
  options?: ComputeReportCardStalenessOptions
): number | null {
  if (
    typeof options?.currentSessionNumber === "number" &&
    Number.isFinite(options.currentSessionNumber) &&
    options.currentSessionNumber > 0
  ) {
    return Math.min(14, Math.max(1, Math.floor(options.currentSessionNumber)));
  }
  if (hasEvaluatedS14) {
    return 14;
  }
  try {
    const { allClassesMap } = queryClassDirectory({
      scope: "all",
      includeSynthetic: true,
      nowMs: options?.nowMs,
    });
    const dirItem = allClassesMap.get(cleanClassId);
    let inferred: number | null = null;
    if (dirItem && dirItem.currentSessionNumber > 0) {
      inferred = Math.min(14, Math.max(1, Math.floor(dirItem.currentSessionNumber)));
    } else {
      const runningList =
        typeof getRunningClasses === "function" ? getRunningClasses() : [];
      const matchedRunning = Array.isArray(runningList)
        ? runningList.find(
            (r) => String(r?.classCode || "").trim().toUpperCase() === cleanClassId
          )
        : undefined;
      const runningSess = Number((matchedRunning as any)?.currentSessionNumber);
      if (Number.isFinite(runningSess) && runningSess > 0) {
        inferred = Math.min(14, Math.max(1, Math.floor(runningSess)));
      } else if (dirItem?.status === "Running") {
        inferred = 1;
      }
    }
    if (inferred !== null) {
      return snapshotFloor !== null ? Math.max(inferred, snapshotFloor) : inferred;
    }
  } catch {
    // Fallback to null when directory/config is unavailable in stripped test harnesses
  }
  return null;
}

export function computeReportCardStaleness(
  classId: string,
  parsedSnapshot: ClassReportCardLmsSnapshot | null,
  options?: ComputeReportCardStalenessOptions
): ReportCardStalenessInfo {
  const cleanClassId = String(classId || "").trim().toUpperCase();
  let resolvedSyllabusList = Array.isArray(options?.syllabusList)
    ? options.syllabusList
    : undefined;
  if (!resolvedSyllabusList) {
    try {
      resolvedSyllabusList =
        typeof getCoursesSyllabus === "function" ? getCoursesSyllabus() : undefined;
    } catch {
      resolvedSyllabusList = undefined;
    }
  }
  const cpSessions = resolveCheckpointSessionsForClass(
    cleanClassId,
    resolvedSyllabusList
  );
  const cp1Sess: number | null = cpSessions.length >= 1 ? cpSessions[0] : null;
  const cp2Sess: number | null = cpSessions.length >= 2 ? cpSessions[1] : null;
  const s14Rows = session14EvalRepo.findByClass(cleanClassId);
  const scrapedAt = parsedSnapshot?.scrapedAt || null;
  const scrapedAtMs = parseDbOrIsoTimestampMs(scrapedAt);

  let latestSession14UpdatedAt: string | null = null;
  let latestS14Ms: number | null = null;

  for (const r of s14Rows) {
    const ms = parseDbOrIsoTimestampMs(r.updatedAt);
    if (ms !== null && (latestS14Ms === null || ms > latestS14Ms)) {
      latestS14Ms = ms;
      latestSession14UpdatedAt = r.updatedAt || null;
    }
  }

  let hasNewerSession14 = false;
  const evaluatedRows = s14Rows.filter(hasEvaluatedSession14Record);
  if (evaluatedRows.length > 0) {
    if (!parsedSnapshot || scrapedAtMs === null) {
      hasNewerSession14 = true;
    } else if (!Array.isArray(parsedSnapshot.students) || parsedSnapshot.students.length === 0) {
      if (latestS14Ms !== null && latestS14Ms > scrapedAtMs) {
        hasNewerSession14 = true;
      }
    } else {
      const snapStudents = parsedSnapshot.students || [];
      const existingStudents = studentRepo.findByClass(cleanClassId, false);
      const existingById = new Map(
        existingStudents.map((st) => [String(st.studentId || "").trim(), st])
      );

      // Build Session 14 evaluation maps using the exact same rules as ScoreScraper
      const evalByStudentId = new Map<string, SpckSession14EvaluationRecord>();
      const evalByNormName = new Map<string, SpckSession14EvaluationRecord>();
      for (const ev of s14Rows) {
        const sid = String(ev?.studentId || "").trim();
        if (!sid) continue;
        evalByStudentId.set(sid, ev);
        const matchedSt = existingById.get(sid);
        if (matchedSt) {
          evalByNormName.set(normalizeStudentNameKey(matchedSt.fullName), ev);
        }
      }

      const findSession14EvalForSnapshotStudent = (
        s: (typeof snapStudents)[number]
      ): SpckSession14EvaluationRecord | undefined => {
        const sid = String(s.studentId || "").trim();
        const crmId = String((s as any).crmStudentId || "").trim();
        const suid = String(s.studentUid || "").trim();
        const lmsUid = String((s as any).lmsStudentUid || "").trim();

        const direct =
          (sid ? evalByStudentId.get(sid) : undefined) ||
          (crmId ? evalByStudentId.get(crmId) : undefined) ||
          (suid ? evalByStudentId.get(suid) : undefined) ||
          (lmsUid ? evalByStudentId.get(lmsUid) : undefined);
        if (direct) return direct;

        const normName = normalizeStudentNameKey(s.fullName);
        if (normName && evalByNormName.has(normName)) {
          return evalByNormName.get(normName);
        }
        if (!normName) return undefined;

        const expectedSlugId = `STU_${cleanClassId}_${normName
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .toUpperCase()}`;
        return evalByStudentId.get(expectedSlugId);
      };

      const knownSnapshotEvalKeys = new Set<string>();
      for (const s of snapStudents) {
        const sid = String(s.studentId || "").trim();
        const crmId = String((s as any).crmStudentId || "").trim();
        const suid = String(s.studentUid || "").trim();
        const lmsUid = String((s as any).lmsStudentUid || "").trim();
        if (sid) knownSnapshotEvalKeys.add(sid);
        if (crmId) knownSnapshotEvalKeys.add(crmId);
        if (suid) knownSnapshotEvalKeys.add(suid);
        if (lmsUid) knownSnapshotEvalKeys.add(lmsUid);

        const normName = normalizeStudentNameKey(s.fullName);
        if (normName) {
          const expectedSlugId = `STU_${cleanClassId}_${normName
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "")
            .toUpperCase()}`;
          knownSnapshotEvalKeys.add(expectedSlugId);
          for (const st of existingStudents) {
            if (normalizeStudentNameKey(st.fullName) === normName) {
              knownSnapshotEvalKeys.add(String(st.studentId || "").trim());
            }
          }
        }

        const matchedEval = findSession14EvalForSnapshotStudent(s);
        if (!matchedEval || !hasEvaluatedSession14Record(matchedEval)) {
          continue;
        }

        const evalMs = parseDbOrIsoTimestampMs(matchedEval.updatedAt);

        if (
          typeof matchedEval.demoTotalScore === "number" &&
          Number.isFinite(matchedEval.demoTotalScore) &&
          matchedEval.demoTotalScore >= 0
        ) {
          const expectedProduct = round2(
            Math.max(0, Math.min(5, matchedEval.demoTotalScore))
          );
          if (s.stageScores?.finalProduct !== expectedProduct) {
            hasNewerSession14 = true;
            break;
          }
        }

        if (
          typeof matchedEval.competencyTotalScore === "number" &&
          Number.isFinite(matchedEval.competencyTotalScore) &&
          matchedEval.competencyTotalScore > 0
        ) {
          const expectedCompetency = round2(
            Math.max(0, Math.min(5, matchedEval.competencyTotalScore))
          );
          if (s.stageScores?.finalCompetency !== expectedCompetency) {
            hasNewerSession14 = true;
            break;
          }
        }

        const verifiedMs =
          matchedEval.status === "VERIFIED"
            ? parseDbOrIsoTimestampMs(matchedEval.verifiedAt)
            : null;
        const isAlreadyVerifiedBeforeScrape =
          matchedEval.status === "VERIFIED" &&
          verifiedMs !== null &&
          verifiedMs <= scrapedAtMs;
        if (!isAlreadyVerifiedBeforeScrape && evalMs !== null && evalMs > scrapedAtMs) {
          hasNewerSession14 = true;
          break;
        }
      }

      if (!hasNewerSession14) {
        for (const r of evaluatedRows) {
          const sid = String(r.studentId || "").trim();
          if (sid && !knownSnapshotEvalKeys.has(sid)) {
            hasNewerSession14 = true;
            break;
          }
        }
      }
    }
  }

  let hasNewerManualCheckpoint = false;
  try {
    const fbRows =
      typeof sessionFeedbackRepo?.findByClass === "function"
        ? sessionFeedbackRepo.findByClass(cleanClassId)
        : [];
    const classSessRows =
      typeof classSessionRepo?.findByClass === "function"
        ? classSessionRepo.findByClass(cleanClassId)
        : [];
    const sessNumById = new Map<string, number>();
    for (const s of classSessRows) {
      if (s?.sessionId && typeof s.sessionNumber === "number") {
        sessNumById.set(s.sessionId, s.sessionNumber);
      }
    }
    const snapStudents = parsedSnapshot?.students || [];
    const findSnapStudentForFb = (fbStudentId: string) => {
      for (const s of snapStudents) {
        const sid = String(s.studentId || "").trim();
        const crmId = String((s as any).crmStudentId || "").trim();
        const suid = String(s.studentUid || "").trim();
        const lmsUid = String((s as any).lmsStudentUid || "").trim();
        const normName = normalizeStudentNameKey(s.fullName);
        const slugId = normName
          ? `STU_${cleanClassId}_${normName
              .replace(/[^a-z0-9]+/g, "_")
              .replace(/^_+|_+$/g, "")
              .toUpperCase()}`
          : "";
        if (
          fbStudentId === sid ||
          (crmId && fbStudentId === crmId) ||
          (suid && fbStudentId === suid) ||
          (lmsUid && fbStudentId === lmsUid) ||
          (slugId && fbStudentId === slugId)
        ) {
          return s;
        }
      }
      return undefined;
    };

    for (const fb of fbRows) {
      if (!fb?.checkpointDataJson || fb.checkpointDataJson === "{}") continue;
      let sNum = sessNumById.get(fb.sessionId) || 0;
      if (!sNum) {
        const m = String(fb.sessionId || "").match(/(?:^|[_-])SESS(?:ION)?[_-]?0*(\d+)$/i);
        if (m) sNum = Number(m[1]);
      }
      const cpStage = sNum === cp1Sess ? 1 : sNum === cp2Sess ? 2 : 0;
      if (!cpStage) continue;
      let cpParsed: any = null;
      try {
        cpParsed = JSON.parse(fb.checkpointDataJson);
      } catch {
        cpParsed = null;
      }
      if (!cpParsed || typeof cpParsed !== "object") continue;
      if (!cpParsed.userEditedTheory && !cpParsed.userEditedPractice) continue;

      if (!parsedSnapshot || snapStudents.length === 0) {
        hasNewerManualCheckpoint = true;
        break;
      }
      const matchedSnap = findSnapStudentForFb(String(fb.studentId || "").trim());
      if (!matchedSnap) {
        hasNewerManualCheckpoint = true;
        break;
      }
      const tVal =
        cpStage === 1
          ? matchedSnap.stageScores?.cp1Theory ?? null
          : matchedSnap.stageScores?.cp2Theory ?? null;
      const pVal =
        cpStage === 1
          ? matchedSnap.stageScores?.cp1Practice ?? null
          : matchedSnap.stageScores?.cp2Practice ?? null;
      if (
        (cpParsed.userEditedTheory && tVal !== (cpParsed.theoryScore ?? null)) ||
        (cpParsed.userEditedPractice && pVal !== (cpParsed.practiceScore ?? null))
      ) {
        hasNewerManualCheckpoint = true;
        break;
      }
    }
  } catch {}

  const activeStudents = (parsedSnapshot?.students || []).filter(
    (s) => s.isActive !== false
  );
  const snapshotFloor = resolveSnapshotFloorSession(
    activeStudents,
    cp1Sess,
    cp2Sess
  );
  const effectiveSession = resolveEffectiveSessionForStaleness(
    cleanClassId,
    evaluatedRows.length > 0,
    snapshotFloor,
    options
  );
  const isCp1Due =
    cp1Sess !== null &&
    (effectiveSession === null || effectiveSession >= cp1Sess);
  const isCp2Due =
    cp2Sess !== null &&
    (effectiveSession === null || effectiveSession >= cp2Sess);

  const missingCp1 =
    isCp1Due &&
    activeStudents.length > 0 &&
    activeStudents.every(
      (s) =>
        s.stageScores?.cp1Theory == null &&
        s.stageScores?.cp1Practice == null &&
        s.stageScores?.cp1Competency == null
    );
  const missingCp2 =
    isCp2Due &&
    activeStudents.length > 0 &&
    activeStudents.every(
      (s) =>
        s.stageScores?.cp2Theory == null &&
        s.stageScores?.cp2Practice == null &&
        s.stageScores?.cp2Competency == null
    );
  const missingCheckpointScores = missingCp1 || missingCp2;
  const isStale = hasNewerSession14 || missingCheckpointScores || hasNewerManualCheckpoint;

  const reasons: string[] = [];
  if (hasNewerSession14) {
    reasons.push("Có dữ liệu Buổi 14 mới, bấm Quét lại");
  }
  if (hasNewerManualCheckpoint) {
    reasons.push("Có điểm Check-point sửa tay mới từ trang Nhận xét buổi học");
  }
  if (missingCheckpointScores) {
    reasons.push(
      missingCp1 && missingCp2
        ? "Chưa có điểm Check-point 1 & 2 trên bản quét hiện tại"
        : missingCp1
        ? "Chưa có điểm Check-point 1 trên bản quét hiện tại"
        : "Chưa có điểm Check-point 2 trên bản quét hiện tại"
    );
  }

  return {
    isStale,
    hasNewerSession14,
    hasNewerManualCheckpoint,
    missingCheckpointScores,
    missingCp1,
    missingCp2,
    latestSession14UpdatedAt,
    scrapedAt,
    reasons,
  };
}
