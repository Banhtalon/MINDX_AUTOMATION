import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { classSessionRepo, studentRepo, sessionFeedbackRepo, getDb } from "@/lib/db/sqlite";
import {
  getQuickTags,
  getCoursesSyllabus,
  getZaloTemplates,
  getRunningClasses,
  type RunningClassItem,
} from "@/lib/db/json-config";
import {
  detectTrackByClassCode,
  normalizeQuickTagsForTrack,
  filterInheritableQuickTags,
} from "@/lib/quick-tags";
import { listClasses, listStudents } from "@/lib/classes/class-directory";
import { config } from "@/lib/config";
import { normalizeLmsBaseOrigin } from "@/lib/lms/lms-class-url";
import { resolveKnownLmsClassIdsMap } from "@/lib/lms/lms-class-id-store";
import { isSaveCommentsSessionRunning } from "@/lib/queue/task-queue";
import { resolveCheckpointStageForSession } from "@/lib/checkpoint/checkpoint-competency";
import { computeCheckpointDataForSession } from "@/lib/checkpoint/checkpoint-history-loader";

const safeFilterInheritableQuickTags =
  typeof filterInheritableQuickTags === "function"
    ? filterInheritableQuickTags
    : (tags: string[]) => tags;

function parseVerifiedSessionNumber(sid: unknown, dbSessionNum?: unknown): number {
  const n = Number(dbSessionNum);
  if (Number.isInteger(n) && n > 0) return n;
  const match = String(sid || "")
    .trim()
    .match(/(?:^|[_-])SESS(?:ION)?[_-]?0*(\d+)$/i);
  if (!match) return 0;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function hasNonZeroCountsJson(rawJson: unknown): boolean {
  if (!rawJson) return false;
  let parsed: unknown = rawJson;
  if (typeof rawJson === "string") {
    const trimmed = rawJson.trim();
    if (!trimmed || trimmed === "{}") return false;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return false;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  return Object.values(parsed as Record<string, unknown>).some((v) => {
    const n = Number(v);
    return Number.isFinite(n) && n !== 0;
  });
}

function parseClassroomTimestampMs(raw?: string | null): number | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  const isoLike = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s) ? s.replace(" ", "T") : s;
  const ms = Date.parse(isoLike);
  return Number.isFinite(ms) ? ms : null;
}

const safeResolveCheckpointStageList =
  typeof resolveCheckpointStageForSession === "function"
    ? resolveCheckpointStageForSession
    : () => ({
        isCheckpoint: false,
        isRobotics: false,
        cpStage: null,
        stageStartSession: 1,
        stageEndSession: 1,
        previousCpSession: null,
      });
const safeComputeCheckpointList =
  typeof computeCheckpointDataForSession === "function" ? computeCheckpointDataForSession : null;

function isSession14Category(cat: { category?: string; categoryName?: string; track?: string } | null | undefined): boolean {
  if (!cat) return false;
  const track = String(cat.track || "").trim().toLowerCase();
  const key = String(cat.category || "").trim().toLowerCase();
  const name = String(cat.categoryName || "").trim().toLowerCase();
  return (
    track === "session14" ||
    track === "spck" ||
    key.startsWith("spck_") ||
    key.includes("session14") ||
    /buổi\s*14|spck/i.test(name)
  );
}

function buildMergedRunningClasses(): RunningClassItem[] {
  return typeof listClasses === "function" ? listClasses({ scope: "running" }) : [];
}

export async function GET(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const url = new URL(req.url);
    const rawClassId = url.searchParams.get("classId");
    const runningClasses = buildMergedRunningClasses();
    let classId = rawClassId && rawClassId.trim() ? rawClassId.trim().toUpperCase() : null;
    if (!classId) {
      if (runningClasses.length > 0) {
        classId = runningClasses[0].classCode;
      } else {
        try {
          const db = typeof getDb === "function" ? getDb() : null;
          if (typeof (db as any)?.prepare === "function") {
            const firstRow = (db as any)
              .prepare(`SELECT classId FROM classes_sessions ORDER BY id ASC LIMIT 1`)
              .get() as { classId?: string } | undefined;
            if (firstRow?.classId) {
              classId = String(firstRow.classId).trim().toUpperCase();
            }
          }
        } catch {}
      }
    }
    const sessionId = url.searchParams.get("sessionId");

    const includeInactive = url.searchParams.get("includeInactive") === "true";
    const allSessions = classId ? classSessionRepo.findByClass(classId) : [];
    if (classId && allSessions.length > 0) {
      const matchedRunning = runningClasses.find(
        (c) => String(c?.classCode || "").trim().toUpperCase() === classId
      ) as any;
      const curNum = Number(matchedRunning?.currentSessionNumber) || 0;
      const curDate = String(matchedRunning?.currentSessionDate || "").trim();
      if (curNum >= 1 && curDate) {
        const targetSess = allSessions.find((s) => Number(s.sessionNumber) === curNum);
        if (targetSess && !String(targetSess.date || "").trim()) {
          targetSess.date = curDate;
        }
      }
    }
    const allStudents = classId
      ? typeof listStudents === "function"
        ? listStudents(classId, { activeOnly: !includeInactive })
        : studentRepo.findByClass(classId, !includeInactive)
      : [];
    const feedbacks = classId && sessionId ? sessionFeedbackRepo.findBySession(classId, sessionId) : [];

    // Auto-heal orphaned "SAVING" records when no SAVE_COMMENTS task for this class/session is active
    if (
      classId &&
      sessionId &&
      feedbacks.some((f) => f.status === "SAVING") &&
      (typeof isSaveCommentsSessionRunning !== "function" ||
        !isSaveCommentsSessionRunning(classId, sessionId))
    ) {
      for (const fb of feedbacks) {
        if (fb.status !== "SAVING") continue;
        const hasApprovedPayload = Boolean(fb.contentHash && String(fb.finalText || "").trim());
        const nextStatus = hasApprovedPayload ? "FAILED" : "DRAFT";
        const nextError = hasApprovedPayload
          ? "Phiên lưu trước bị ngắt giữa chừng (trình duyệt đã đóng). Bấm 'Đồng bộ buổi học' hoặc 'Thử lại' để xác nhận."
          : null;
        try {
          if (typeof sessionFeedbackRepo?.updateStatus === "function") {
            sessionFeedbackRepo.updateStatus(
              classId,
              sessionId,
              fb.studentId,
              nextStatus,
              null,
              nextError,
              hasApprovedPayload ? fb.contentHash : undefined
            );
          }
          fb.status = nextStatus;
          fb.errorMessage = nextError ?? undefined;
        } catch {
          // Non-fatal fallback
        }
      }
    }

    const rawCategories = typeof getQuickTags === "function" ? getQuickTags() || [] : [];

    const curSessRow = sessionId ? allSessions.find((s) => s.sessionId === sessionId) : undefined;
    const curSessNum = sessionId
      ? parseVerifiedSessionNumber(sessionId, curSessRow?.sessionNumber)
      : 0;

    const previousQuickTagsByStudent: Record<
      string,
      { tags: string[]; fromSessionNumber?: number }
    > = {};
    if (classId && sessionId) {
      try {
        const db = typeof getDb === "function" ? getDb() : null;
        if (typeof (db as any)?.prepare === "function") {
          const track = detectTrackByClassCode(classId);
          const prevRows =
            curSessNum > 0
              ? ((db as any)
                  .prepare(
                    `SELECT sf.studentId, sf.sessionId, sf.quickTagsJson, sf.versionMetaJson, COALESCE(cs.sessionNumber, 0) as sessionNumber
                     FROM session_feedbacks sf
                     LEFT JOIN classes_sessions cs ON cs.classId = sf.classId AND cs.sessionId = sf.sessionId
                     WHERE sf.classId = ?
                       AND sf.sessionId != ?
                     ORDER BY
                       COALESCE(cs.sessionNumber, 0) DESC,
                       sf.updatedAt DESC,
                       sf.id DESC`
                  )
                  .all(classId, sessionId) as Array<{
                  studentId: string;
                  sessionId: string;
                  quickTagsJson: string;
                  versionMetaJson?: string;
                  sessionNumber: number;
                }>)
              : [];

          const inferSessNum = (r: { sessionId: string; sessionNumber: number }) =>
            parseVerifiedSessionNumber(r.sessionId, r.sessionNumber);

          const eligiblePrevRows = prevRows
            .filter((r) => {
              const rNum = inferSessNum(r);
              return curSessNum > 0 && rNum > 0 && rNum < curSessNum;
            })
            .sort((a, b) => {
              const aNum = inferSessNum(a);
              const bNum = inferSessNum(b);
              if (aNum !== bNum) return bNum - aNum;
              return 0;
            });

          const resolvedStudents = new Set<string>();
          for (const row of eligiblePrevRows) {
            if (!row?.studentId || resolvedStudents.has(row.studentId)) continue;
            try {
              const parsed = row.quickTagsJson ? JSON.parse(row.quickTagsJson) : [];
              if (Array.isArray(parsed) && parsed.length > 0) {
                const normalized = normalizeQuickTagsForTrack(parsed, track);
                const inheritable = safeFilterInheritableQuickTags(normalized, rawCategories);
                const inferredNum = inferSessNum(row);
                if (inheritable.length > 0 && inferredNum > 0) {
                  previousQuickTagsByStudent[row.studentId] = {
                    tags: inheritable,
                    fromSessionNumber: inferredNum,
                  };
                }
                if (normalized.length > 0) {
                  resolvedStudents.add(row.studentId);
                }
                continue;
              }
              if (row.versionMetaJson) {
                const meta = JSON.parse(row.versionMetaJson);
                if (meta?.fields?.quickTags) {
                  resolvedStudents.add(row.studentId);
                }
              }
            } catch {}
          }
        }
      } catch {}
    }

    let pendingClassroomLogsCount = 0;
    const activeStudentIds = new Set(
      allStudents
        .filter((st: any) => st?.isActive !== false && st?.isActive !== 0 && st?.studentId)
        .map((st: any) => String(st.studentId).trim())
    );
    const lockedCommentStudentIds = new Set(
      (feedbacks || [])
        .filter(
          (fb) =>
            fb?.studentId && (fb.status === "VERIFIED" || fb.status === "SAVING")
        )
        .map((fb) => String(fb.studentId).trim())
    );
    if (classId && curSessNum > 0 && activeStudentIds.size > 0) {
      try {
        const db = typeof getDb === "function" ? getDb() : null;
        if (typeof (db as any)?.prepare === "function") {
          const logRows = (db as any)
            .prepare(
              `SELECT studentId, attendanceStatus, stars, medals, praiseCountsJson, issueCountsJson, teacherQuickNote, appliedToCommentAt, updatedAt
               FROM classroom_session_logs
               WHERE classId = ? AND sessionNumber = ?`
            )
            .all(classId, curSessNum) as Array<{
            studentId?: string;
            attendanceStatus?: string;
            stars?: number;
            medals?: number;
            praiseCountsJson?: string;
            issueCountsJson?: string;
            teacherQuickNote?: string;
            appliedToCommentAt?: string | null;
            updatedAt?: string | null;
          }>;
          const pendingIds = new Set<string>();
          for (const log of logRows || []) {
            const sid = String(log?.studentId || "").trim();
            if (!sid || !activeStudentIds.has(sid) || lockedCommentStudentIds.has(sid)) continue;
            const att = String(log?.attendanceStatus || "").trim().toUpperCase();
            const hasMeaningfulData =
              Number(log?.stars || 0) > 0 ||
              Number(log?.medals || 0) > 0 ||
              hasNonZeroCountsJson(log?.praiseCountsJson) ||
              hasNonZeroCountsJson(log?.issueCountsJson) ||
              String(log?.teacherQuickNote || "").trim() !== "" ||
              (att !== "" && att !== "PRESENT" && att !== "UNKNOWN");
            if (!hasMeaningfulData) continue;

            const appliedRaw = String(log?.appliedToCommentAt || "").trim();
            if (!appliedRaw) {
              pendingIds.add(sid);
              continue;
            }
            const updatedRaw = String(log?.updatedAt || "").trim();
            const appliedMs = parseClassroomTimestampMs(appliedRaw);
            const updatedMs = parseClassroomTimestampMs(updatedRaw);
            const isUpdatedAfterApply =
              appliedMs === null
                ? true
                : updatedMs !== null
                  ? updatedMs > appliedMs
                  : updatedRaw > appliedRaw;
            if (isUpdatedAfterApply) {
              pendingIds.add(sid);
            }
          }
          pendingClassroomLogsCount = pendingIds.size;
        }
      } catch {}
    }

    const quickCategories = rawCategories.filter((c) => !isSession14Category(c));
    const quickTags = quickCategories.flatMap((c) =>
      (c.tags || [])
        .filter((t) => !String(t?.id || "").toLowerCase().startsWith("s14_"))
        .map((t) => ({
          ...t,
          category: c.category || "",
          categoryName: c.categoryName || c.category || "",
          track: c.track || "",
        }))
    );
    const syllabusList = getCoursesSyllabus();
    const zaloTemplates = getZaloTemplates();
    const lmsClassIds =
      typeof resolveKnownLmsClassIdsMap === "function"
        ? resolveKnownLmsClassIdsMap()
        : {};
    const lmsBaseUrl =
      typeof normalizeLmsBaseOrigin === "function"
        ? normalizeLmsBaseOrigin(typeof config !== "undefined" ? config?.lmsUrl : undefined)
        : "https://lms.mindx.edu.vn";

    let checkpointStageInfo = safeResolveCheckpointStageList(classId, 0);
    let checkpointByStudent: Record<string, any> = {};
    if (classId && sessionId) {
      checkpointStageInfo = safeResolveCheckpointStageList(classId, curSessNum);
      if (checkpointStageInfo.isCheckpoint && safeComputeCheckpointList) {
        try {
          const cpResult = safeComputeCheckpointList({
            classId,
            sessionId,
            sessionNumber: curSessNum,
            forceRecalculate: false,
            persist: false,
          });
          checkpointByStudent = cpResult.byStudent;
        } catch {
          checkpointByStudent = {};
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        resolvedClassId: classId || undefined,
        lmsBaseUrl,
        lmsClassIds,
        lmsClassId: classId ? lmsClassIds[classId] || undefined : undefined,
        sessions: allSessions,
        students: allStudents,
        feedbacks,
        previousQuickTagsByStudent,
        pendingClassroomLogsCount,
        quickTags,
        syllabusList,
        zaloTemplates,
        runningClasses,
        checkpointStageInfo,
        checkpointByStudent,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
