import {
  session14EvalRepo,
  studentRepo,
  type SpckSession14EvaluationRecord,
} from "@/lib/db/sqlite";
import { taskQueue } from "@/lib/queue/task-queue";
import { ScoreScraper } from "@/lib/playwright/scrape-scores";
import {
  round2,
  type ClassReportCardLmsSnapshot,
} from "@/lib/report-card/report-card-calculator";
import { stripVietnameseDiacritics } from "@/lib/utils/vietnamese-match";

export interface ReportCardStalenessInfo {
  isStale: boolean;
  hasNewerSession14: boolean;
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

export function computeReportCardStaleness(
  classId: string,
  parsedSnapshot: ClassReportCardLmsSnapshot | null
): ReportCardStalenessInfo {
  const cleanClassId = String(classId || "").trim().toUpperCase();
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
        if (evalMs !== null && evalMs > scrapedAtMs) {
          hasNewerSession14 = true;
          break;
        }

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

  const activeStudents = (parsedSnapshot?.students || []).filter(
    (s) => s.isActive !== false
  );
  const missingCp1 =
    activeStudents.length > 0 &&
    activeStudents.every(
      (s) =>
        s.stageScores?.cp1Theory == null &&
        s.stageScores?.cp1Practice == null &&
        s.stageScores?.cp1Competency == null
    );
  const missingCp2 =
    activeStudents.length > 0 &&
    activeStudents.every(
      (s) =>
        s.stageScores?.cp2Theory == null &&
        s.stageScores?.cp2Practice == null &&
        s.stageScores?.cp2Competency == null
    );
  const missingCheckpointScores = missingCp1 || missingCp2;
  const isStale = hasNewerSession14 || missingCheckpointScores;

  const reasons: string[] = [];
  if (hasNewerSession14) {
    reasons.push("Có dữ liệu Buổi 14 mới, bấm Quét lại");
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
    missingCheckpointScores,
    missingCp1,
    missingCp2,
    latestSession14UpdatedAt,
    scrapedAt,
    reasons,
  };
}
