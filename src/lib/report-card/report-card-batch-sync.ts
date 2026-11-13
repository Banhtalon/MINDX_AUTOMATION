import {
  isSyntheticClassCode,
  listClasses,
} from "@/lib/classes/class-directory";
import {
  computeReportCardContentHash,
  parseManualOverridesMap,
  parseReportCardLmsSnapshot,
  reportCardRepo,
} from "@/lib/db/sqlite";
import {
  ClassSyncer,
  DASHBOARD_FINISHED_CLASS_GRACE_DAYS,
  isConfirmedRunningStatus,
  isFinishedClassSupersededByRunningSuccessor,
  isFinishedClassWithinGraceWindow,
} from "@/lib/playwright/sync-class";
import {
  TeachingReportCardSyncService,
  type SkippedTeachingStudentInfo,
} from "@/lib/playwright/teaching-report-card-sync";
import { taskQueue } from "@/lib/queue/task-queue";
import {
  computeClassReportCard,
  type ComputedClassReportCard,
} from "@/lib/report-card/report-card-calculator";
import { enqueueScrapeClassScores } from "@/lib/report-card/report-card-staleness";
import { ensureQueueNotStopped } from "@/lib/teaching/teaching-http-client";

export type BatchSyncClassOutcome =
  | "SYNCED"
  | "SKIPPED_UNCHANGED"
  | "SKIPPED_NO_SCORES"
  | "NEEDS_ATTENTION"
  | "CANCELLED";

export interface BatchTargetClassItem {
  classCode: string;
  courseName?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}

export type SingleClassBatchSyncStage =
  | "INIT"
  | "SCRAPE_LMS"
  | "CHECK_SCORES"
  | "CONCURRENT_EDIT"
  | "CHECK_HASH"
  | "APPROVE"
  | "SYNC_TEACHING";

export interface SingleClassBatchSyncResult {
  success: boolean;
  statusCode: number;
  classCode: string;
  outcome: BatchSyncClassOutcome;
  stage: SingleClassBatchSyncStage;
  syncedScoreCount: number;
  declaredExerciseCount: number;
  matchedStudentCount?: number;
  skippedStudentCount?: number;
  skippedStudents?: SkippedTeachingStudentInfo[];
  warning?: string;
  conflict?: boolean;
  cancelled?: boolean;
  message?: string;
  error?: string;
}

export interface DiscoverRunningClassesBatchResult {
  success: boolean;
  statusCode: number;
  classes: BatchTargetClassItem[];
  cancelled?: boolean;
  error?: string;
}

export interface BatchReportCardSyncSummary {
  success: boolean;
  statusCode: number;
  totalClasses: number;
  syncedCount: number;
  skippedUnchangedCount: number;
  skippedNoScoresCount: number;
  needsAttentionCount: number;
  cancelledCount: number;
  conflict?: boolean;
  cancelled?: boolean;
  results: SingleClassBatchSyncResult[];
  error?: string;
}

export type FetchRunningClassesFn = (opts?: {
  persistToConfig?: boolean;
}) => Promise<{
  success: boolean;
  classes?: Array<{
    classCode?: string;
    courseName?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
  }>;
  error?: string;
}>;

export type ScrapeClassScoresFn = (classCode: string) => Promise<{
  success: boolean;
  error?: string;
}>;

export type SyncReportCardToTeachingFn = (
  classId: string,
  options?: { classCode?: string; expectedVersion?: number }
) => Promise<{
  success: boolean;
  syncedScoreCount: number;
  declaredExerciseCount: number;
  matchedStudentCount?: number;
  skippedStudentCount?: number;
  skippedStudents?: SkippedTeachingStudentInfo[];
  warning?: string;
  error?: string;
}>;

/**
 * Safely extracts skipped Teaching student entries stored inside
 * `teachingVerifiedSnapshotJson` from the previous sync.
 */
export function extractPriorSkippedTeachingStudents(
  verifiedSnapshotJson: string | null | undefined
): SkippedTeachingStudentInfo[] {
  if (!verifiedSnapshotJson || typeof verifiedSnapshotJson !== "string") {
    return [];
  }
  try {
    const parsed = JSON.parse(verifiedSnapshotJson);
    if (!parsed || typeof parsed !== "object") {
      return [];
    }
    const rawList = Array.isArray((parsed as any).skippedStudents)
      ? (parsed as any).skippedStudents
      : [];
    const normalized: SkippedTeachingStudentInfo[] = [];
    for (const entry of rawList) {
      if (!entry || typeof entry !== "object") continue;
      const fullName = String((entry as any).localFullName || "").trim();
      if (!fullName) continue;
      normalized.push({
        localStudentId: String((entry as any).localStudentId || ""),
        localFullName: fullName,
        reason:
          (entry as any).reason === "INACTIVE_ON_TEACHING"
            ? "INACTIVE_ON_TEACHING"
            : "NOT_FOUND_ON_TEACHING",
        detail: String((entry as any).detail || ""),
      });
    }
    if (normalized.length > 0) {
      return normalized;
    }
    const declaredCount = Number((parsed as any).skippedStudentCount || 0);
    if (Number.isFinite(declaredCount) && declaredCount > 0) {
      return [
        {
          localStudentId: "",
          localFullName: `${declaredCount} học viên chưa khớp trên Teaching`,
          reason: "NOT_FOUND_ON_TEACHING",
          detail: "",
        },
      ];
    }
    return [];
  } catch {
    return [];
  }
}

export interface DiscoverRunningClassesBatchOptions {
  refreshFromLms?: boolean;
  allowSyntheticForTest?: boolean;
  nowMs?: number;
  fetchRunningClassesFn?: FetchRunningClassesFn;
  isQueueStoppedFn?: () => boolean;
}

export interface SyncSingleClassReportCardFlowOptions {
  forceSyncUnchanged?: boolean;
  allowSyntheticForTest?: boolean;
  scrapeFn?: ScrapeClassScoresFn;
  syncTeachingFn?: SyncReportCardToTeachingFn;
  isQueueStoppedFn?: () => boolean;
}

export interface RunBatchReportCardSyncOptions {
  classCodes?: string[];
  refreshFromLms?: boolean;
  forceSyncUnchanged?: boolean;
  allowSyntheticForTest?: boolean;
  nowMs?: number;
  fetchRunningClassesFn?: FetchRunningClassesFn;
  scrapeFn?: ScrapeClassScoresFn;
  syncTeachingFn?: SyncReportCardToTeachingFn;
  isQueueStoppedFn?: () => boolean;
}

const SAFE_BATCH_CLASS_CODE_REGEX = /^[A-Z0-9][A-Z0-9_-]{1,63}$/;
const QUEUE_STOPPED_ERROR_REGEX = /QUEUE_STOPPED|TASK_CANCELLED/i;

const globalForBatchSync = globalThis as unknown as {
  __mindxReportCardSingleClassBatchLocks?: Set<string>;
  __mindxReportCardBatchSyncInFlight?: boolean;
};

function getSingleClassLocks(): Set<string> {
  if (!globalForBatchSync.__mindxReportCardSingleClassBatchLocks) {
    globalForBatchSync.__mindxReportCardSingleClassBatchLocks = new Set<string>();
  }
  return globalForBatchSync.__mindxReportCardSingleClassBatchLocks;
}

function defaultIsQueueStopped(): boolean {
  return Boolean(
    (process as any).__mindxQueueStopped || taskQueue.getStatus().isStopped
  );
}

/**
 * Normalizes and validates a candidate class code for batch report-card operations.
 * Rejects synthetic/test codes unless `allowSyntheticForTest` is explicitly set.
 */
export function isSafeBatchClassCode(
  raw: unknown,
  opts?: { allowSyntheticForTest?: boolean }
): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  if (!SAFE_BATCH_CLASS_CODE_REGEX.test(code)) {
    return null;
  }
  if (!opts?.allowSyntheticForTest && isSyntheticClassCode(code)) {
    return null;
  }
  return code;
}

/**
 * Counts how many finite score items `TeachingReportCardSyncService` will actually push
 * to Teaching (matching `if (!isRobotics)` BTVN rules and CP1/CP2/Final stage fields).
 */
export function countSyncableReportCardScores(
  computed: ComputedClassReportCard
): number {
  let count = 0;
  const students = Array.isArray(computed?.students) ? computed.students : [];
  const sessions = Array.isArray(computed?.btvnSessions)
    ? computed.btvnSessions
    : [];

  for (const stu of students) {
    if (!computed.isRobotics) {
      for (const sess of sessions) {
        const cell = stu.btvnCells?.[sess.sessionNumber];
        if (!cell) continue;
        if (
          typeof cell.theoryRaw === "number" &&
          Number.isFinite(cell.theoryRaw)
        ) {
          count += 1;
        }
        if (
          typeof cell.practiceRaw === "number" &&
          Number.isFinite(cell.practiceRaw)
        ) {
          count += 1;
        }
      }
    }

    const stageVals = [
      stu.cp1?.theory?.value,
      stu.cp1?.practice?.value,
      stu.cp1?.competency?.value,
      stu.cp2?.theory?.value,
      stu.cp2?.practice?.value,
      stu.cp2?.competency?.value,
      stu.final?.product?.value,
      stu.final?.competency?.value,
    ];
    for (const val of stageVals) {
      if (typeof val === "number" && Number.isFinite(val)) {
        count += 1;
      }
    }
  }

  return count;
}

function buildFilteredBatchTargetClasses(
  rawList: Array<{
    classCode?: string;
    courseName?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
  }>,
  opts?: { allowSyntheticForTest?: boolean; nowMs?: number }
): BatchTargetClassItem[] {
  const allowSyntheticForTest = Boolean(opts?.allowSyntheticForTest);
  const nowMs =
    typeof opts?.nowMs === "number" && Number.isFinite(opts.nowMs)
      ? opts.nowMs
      : Date.now();

  const activeRunningCodes = new Set<string>();
  for (const item of rawList) {
    if (!isConfirmedRunningStatus(item?.status)) continue;
    const safeCode = isSafeBatchClassCode(item?.classCode, {
      allowSyntheticForTest,
    });
    if (safeCode) {
      activeRunningCodes.add(safeCode);
    }
  }

  const targets: BatchTargetClassItem[] = [];
  const seen = new Set<string>();

  for (const item of rawList) {
    const code = isSafeBatchClassCode(item?.classCode, {
      allowSyntheticForTest,
    });
    if (!code || seen.has(code)) continue;

    if (item?.status === "Finished") {
      if (
        isFinishedClassSupersededByRunningSuccessor(code, activeRunningCodes)
      ) {
        continue;
      }
      const grace = isFinishedClassWithinGraceWindow(
        code,
        item.endDate,
        DASHBOARD_FINISHED_CLASS_GRACE_DAYS,
        nowMs
      );
      if (
        grace.isKnownDate &&
        !grace.withinWindow &&
        (grace.daysSinceSession14 ?? -1) > 0
      ) {
        continue;
      }
    }

    seen.add(code);
    targets.push({
      classCode: code,
      courseName: item?.courseName,
      status: item?.status,
      startDate: item?.startDate,
      endDate: item?.endDate,
    });
  }

  return targets;
}

/**
 * Discovers active running classes (plus recent Finished classes within grace window
 * not yet superseded by a running successor) for batch report-card sync.
 */
export async function discoverRunningClassesForBatchSync(
  options?: DiscoverRunningClassesBatchOptions
): Promise<DiscoverRunningClassesBatchResult> {
  const isQueueStoppedFn = options?.isQueueStoppedFn || defaultIsQueueStopped;
  if (isQueueStoppedFn()) {
    return {
      success: false,
      statusCode: 409,
      cancelled: true,
      classes: [],
      error:
        "Hàng đợi đang ở trạng thái Dừng khẩn cấp. Vui lòng bấm 'Mở khóa hàng đợi' trước khi quét.",
    };
  }

  const allowSyntheticForTest = Boolean(options?.allowSyntheticForTest);
  const refreshFromLms = options?.refreshFromLms !== false;
  const fetchRunningClassesFn =
    options?.fetchRunningClassesFn ||
    ((opts) => ClassSyncer.fetchRunningClasses(opts));

  if (!refreshFromLms) {
    const localList = listClasses({
      scope: "running",
      includeFinishedDays: DASHBOARD_FINISHED_CLASS_GRACE_DAYS,
      includeSynthetic: allowSyntheticForTest,
      nowMs: options?.nowMs,
    });
    const classes = buildFilteredBatchTargetClasses(localList, {
      allowSyntheticForTest,
      nowMs: options?.nowMs,
    });
    return {
      success: true,
      statusCode: 200,
      classes,
    };
  }

  try {
    const fetchRes = await taskQueue.enqueue({
      id: `batch_rc_discover_${Date.now()}`,
      jobType: "SYNC_CLASS",
      description:
        "Quét danh sách các lớp đang dạy từ LMS để đồng bộ điểm Teaching",
      execute: async () => {
        ensureQueueNotStopped();
        const res = await fetchRunningClassesFn({ persistToConfig: true });
        ensureQueueNotStopped();
        return res;
      },
    });

    if (!fetchRes?.success) {
      const errMsg =
        fetchRes?.error ||
        "Không thể lấy danh sách lớp đang dạy từ MindX LMS.";
      if (QUEUE_STOPPED_ERROR_REGEX.test(errMsg)) {
        return {
          success: false,
          statusCode: 409,
          cancelled: true,
          classes: [],
          error: errMsg,
        };
      }
      return {
        success: false,
        statusCode: 502,
        classes: [],
        error: errMsg,
      };
    }

    const rawList = Array.isArray(fetchRes.classes) ? fetchRes.classes : [];
    const classes = buildFilteredBatchTargetClasses(rawList, {
      allowSyntheticForTest,
      nowMs: options?.nowMs,
    });

    return {
      success: true,
      statusCode: 200,
      classes,
    };
  } catch (err: any) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (QUEUE_STOPPED_ERROR_REGEX.test(errMsg) || isQueueStoppedFn()) {
      return {
        success: false,
        statusCode: 409,
        cancelled: true,
        classes: [],
        error: errMsg,
      };
    }
    return {
      success: false,
      statusCode: 502,
      classes: [],
      error: errMsg,
    };
  }
}

/**
 * Runs the 1-class scrape -> verify scores -> auto-approve -> Teaching sync pipeline.
 * NOTE: Never wraps `enqueueScrapeClassScores` or `syncReportCardToTeaching` inside an
 * outer `taskQueue.enqueue` call because both functions already enqueue their own top-level tasks.
 */
export async function syncSingleClassReportCardFlow(
  rawClassCode: string,
  options?: SyncSingleClassReportCardFlowOptions
): Promise<SingleClassBatchSyncResult> {
  const classId = isSafeBatchClassCode(rawClassCode, {
    allowSyntheticForTest: options?.allowSyntheticForTest,
  });
  if (!classId) {
    return {
      success: false,
      statusCode: 400,
      classCode: String(rawClassCode || "").trim().toUpperCase(),
      outcome: "NEEDS_ATTENTION",
      stage: "INIT",
      syncedScoreCount: 0,
      declaredExerciseCount: 0,
      error: "Mã lớp không hợp lệ.",
    };
  }

  const locks = getSingleClassLocks();
  if (locks.has(classId)) {
    return {
      success: false,
      statusCode: 409,
      conflict: true,
      classCode: classId,
      outcome: "NEEDS_ATTENTION",
      stage: "INIT",
      syncedScoreCount: 0,
      declaredExerciseCount: 0,
      error: `Lớp ${classId} đang được đồng bộ ở một yêu cầu khác.`,
    };
  }

  locks.add(classId);
  try {
    const isQueueStoppedFn = options?.isQueueStoppedFn || defaultIsQueueStopped;
    if (isQueueStoppedFn()) {
      return {
        success: false,
        statusCode: 409,
        cancelled: true,
        classCode: classId,
        outcome: "CANCELLED",
        stage: "INIT",
        syncedScoreCount: 0,
        declaredExerciseCount: 0,
        error:
          "Hàng đợi đang ở trạng thái Dừng khẩn cấp (Stop Bot). Đã dừng trước khi quét lớp này.",
      };
    }

    const beforeRecord = reportCardRepo.findOne(classId);
    const overridesBeforeJson = beforeRecord?.manualOverridesJson || "{}";
    const hadPriorTeachingSync = Boolean(
      beforeRecord?.teachingSyncedAt ||
        beforeRecord?.teachingSyncStatus === "VERIFIED" ||
        beforeRecord?.status === "VERIFIED"
    );

    const scrapeFn =
      options?.scrapeFn || ((code) => enqueueScrapeClassScores(code));

    let scrapeRes: { success: boolean; error?: string };
    try {
      scrapeRes = await scrapeFn(classId);
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (QUEUE_STOPPED_ERROR_REGEX.test(errMsg) || isQueueStoppedFn()) {
        return {
          success: false,
          statusCode: 409,
          cancelled: true,
          classCode: classId,
          outcome: "CANCELLED",
          stage: "SCRAPE_LMS",
          syncedScoreCount: 0,
          declaredExerciseCount: 0,
          error: errMsg,
        };
      }
      return {
        success: false,
        statusCode: 200,
        classCode: classId,
        outcome: "NEEDS_ATTENTION",
        stage: "SCRAPE_LMS",
        syncedScoreCount: 0,
        declaredExerciseCount: 0,
        error: errMsg,
      };
    }

    if (!scrapeRes?.success) {
      const errMsg =
        scrapeRes?.error || `Không thể quét điểm từ LMS cho lớp ${classId}.`;
      if (QUEUE_STOPPED_ERROR_REGEX.test(errMsg) || isQueueStoppedFn()) {
        return {
          success: false,
          statusCode: 409,
          cancelled: true,
          classCode: classId,
          outcome: "CANCELLED",
          stage: "SCRAPE_LMS",
          syncedScoreCount: 0,
          declaredExerciseCount: 0,
          error: errMsg,
        };
      }
      return {
        success: false,
        statusCode: 200,
        classCode: classId,
        outcome: "NEEDS_ATTENTION",
        stage: "SCRAPE_LMS",
        syncedScoreCount: 0,
        declaredExerciseCount: 0,
        error: errMsg,
      };
    }

    const afterScrape = reportCardRepo.findOne(classId);
    const snapshot = afterScrape
      ? parseReportCardLmsSnapshot(afterScrape.lmsSnapshotJson, classId)
      : null;
    const overrides = parseManualOverridesMap(afterScrape?.manualOverridesJson);

    if (
      !afterScrape ||
      !snapshot ||
      !Array.isArray(snapshot.students) ||
      snapshot.students.length === 0
    ) {
      if (hadPriorTeachingSync) {
        return {
          success: false,
          statusCode: 200,
          classCode: classId,
          outcome: "NEEDS_ATTENTION",
          stage: "CHECK_SCORES",
          syncedScoreCount: 0,
          declaredExerciseCount: 0,
          error: `Lớp ${classId} từng đồng bộ Teaching nhưng bản quét hiện tại trống danh sách học viên — vui lòng kiểm tra lại.`,
        };
      }
      return {
        success: true,
        statusCode: 200,
        classCode: classId,
        outcome: "SKIPPED_NO_SCORES",
        stage: "CHECK_SCORES",
        syncedScoreCount: 0,
        declaredExerciseCount: 0,
        message:
          "Lớp mới mở hoặc chưa có danh sách học viên trên bảng điểm LMS.",
      };
    }

    if ((afterScrape.manualOverridesJson || "{}") !== overridesBeforeJson) {
      return {
        success: false,
        statusCode: 200,
        classCode: classId,
        outcome: "NEEDS_ATTENTION",
        stage: "CONCURRENT_EDIT",
        syncedScoreCount: 0,
        declaredExerciseCount: 0,
        error:
          "Giáo viên vừa sửa điểm thủ công lớp này trong lúc đang quét — đã giữ nguyên điểm vừa sửa, vui lòng bấm Duyệt & Đồng bộ riêng lớp này.",
      };
    }

    const computed = computeClassReportCard(snapshot, overrides);
    const syncableCount = countSyncableReportCardScores(computed);
    if (syncableCount === 0) {
      if (hadPriorTeachingSync) {
        return {
          success: false,
          statusCode: 200,
          classCode: classId,
          outcome: "NEEDS_ATTENTION",
          stage: "CHECK_SCORES",
          syncedScoreCount: 0,
          declaredExerciseCount: 0,
          error: `Lớp ${classId} từng đồng bộ Teaching nhưng hiện không còn đầu điểm nào hợp lệ trên LMS — vui lòng kiểm tra lại.`,
        };
      }
      return {
        success: true,
        statusCode: 200,
        classCode: classId,
        outcome: "SKIPPED_NO_SCORES",
        stage: "CHECK_SCORES",
        syncedScoreCount: 0,
        declaredExerciseCount: 0,
        message: computed.isRobotics
          ? "Lớp Robotics chưa tới kỳ Check-point / chưa có điểm đánh giá trên LMS."
          : "Lớp mới mở / chưa có bài tập nào được chấm điểm trên LMS.",
      };
    }

    const liveHash = computeReportCardContentHash(snapshot, overrides);
    const priorSkipped = extractPriorSkippedTeachingStudents(
      afterScrape.teachingVerifiedSnapshotJson
    );
    if (
      !options?.forceSyncUnchanged &&
      priorSkipped.length === 0 &&
      afterScrape.status === "VERIFIED" &&
      afterScrape.teachingSyncStatus === "VERIFIED" &&
      Boolean(afterScrape.contentHash) &&
      afterScrape.contentHash === liveHash
    ) {
      return {
        success: true,
        statusCode: 200,
        classCode: classId,
        outcome: "SKIPPED_UNCHANGED",
        stage: "CHECK_HASH",
        syncedScoreCount: 0,
        declaredExerciseCount: 0,
        message:
          "Điểm không thay đổi so với bản đã đồng bộ Teaching gần nhất.",
      };
    }

    let expectedVersion = afterScrape.draftVersion;
    const isAlreadyReadyWithCurrentHash =
      afterScrape.status === "APPROVED" ||
      (afterScrape.status === "VERIFIED" &&
        afterScrape.contentHash === liveHash);

    if (!isAlreadyReadyWithCurrentHash) {
      const approveRes = reportCardRepo.approveReportCard(
        classId,
        afterScrape.draftVersion
      );
      if (!approveRes.success) {
        return {
          success: false,
          statusCode: 200,
          classCode: classId,
          outcome: "NEEDS_ATTENTION",
          stage: "APPROVE",
          syncedScoreCount: 0,
          declaredExerciseCount: 0,
          error:
            approveRes.error ||
            `Không thể tự động duyệt phiếu điểm lớp ${classId}.`,
        };
      }
      expectedVersion = approveRes.record.draftVersion;
    }

    const syncTeachingFn =
      options?.syncTeachingFn ||
      ((id, syncOpts) =>
        TeachingReportCardSyncService.syncReportCardToTeaching(id, syncOpts));

    let syncRes: {
      success: boolean;
      syncedScoreCount: number;
      declaredExerciseCount: number;
      matchedStudentCount?: number;
      skippedStudentCount?: number;
      skippedStudents?: SkippedTeachingStudentInfo[];
      warning?: string;
      error?: string;
    };
    try {
      syncRes = await syncTeachingFn(classId, {
        classCode: classId,
        expectedVersion,
      });
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (QUEUE_STOPPED_ERROR_REGEX.test(errMsg) || isQueueStoppedFn()) {
        return {
          success: false,
          statusCode: 409,
          cancelled: true,
          classCode: classId,
          outcome: "CANCELLED",
          stage: "SYNC_TEACHING",
          syncedScoreCount: 0,
          declaredExerciseCount: 0,
          error: errMsg,
        };
      }
      return {
        success: false,
        statusCode: 200,
        classCode: classId,
        outcome: "NEEDS_ATTENTION",
        stage: "SYNC_TEACHING",
        syncedScoreCount: 0,
        declaredExerciseCount: 0,
        error: errMsg,
      };
    }

    if (!syncRes?.success) {
      const errMsg =
        syncRes?.error ||
        `Lỗi đồng bộ điểm lớp ${classId} lên Teaching.`;
      if (QUEUE_STOPPED_ERROR_REGEX.test(errMsg) || isQueueStoppedFn()) {
        return {
          success: false,
          statusCode: 409,
          cancelled: true,
          classCode: classId,
          outcome: "CANCELLED",
          stage: "SYNC_TEACHING",
          syncedScoreCount: 0,
          declaredExerciseCount: 0,
          error: errMsg,
        };
      }
      return {
        success: false,
        statusCode: 200,
        classCode: classId,
        outcome: "NEEDS_ATTENTION",
        stage: "SYNC_TEACHING",
        syncedScoreCount: 0,
        declaredExerciseCount: 0,
        error: errMsg,
      };
    }

    const skippedCount = Number(
      syncRes.skippedStudentCount ?? syncRes.skippedStudents?.length ?? 0
    );
    const syncedCount = Number(syncRes.syncedScoreCount || 0);
    const skippedWarning =
      syncRes.warning ||
      (skippedCount > 0
        ? `Đã bỏ qua ${skippedCount} học viên chưa khớp trên Teaching.`
        : undefined);

    return {
      success: true,
      statusCode: 200,
      classCode: classId,
      outcome: "SYNCED",
      stage: "SYNC_TEACHING",
      syncedScoreCount: syncedCount,
      declaredExerciseCount: Number(syncRes.declaredExerciseCount || 0),
      ...(syncRes.matchedStudentCount !== undefined
        ? { matchedStudentCount: syncRes.matchedStudentCount }
        : {}),
      ...(skippedCount > 0 ? { skippedStudentCount: skippedCount } : {}),
      ...(Array.isArray(syncRes.skippedStudents) &&
      syncRes.skippedStudents.length > 0
        ? { skippedStudents: syncRes.skippedStudents }
        : {}),
      ...(skippedWarning ? { warning: skippedWarning } : {}),
      message:
        skippedCount > 0
          ? `Đã đồng bộ & đối chiếu ${syncedCount} đầu điểm lên Teaching (${skippedWarning})`
          : `Đã đồng bộ & đối chiếu ${syncedCount} đầu điểm lên Teaching.`,
    };
  } finally {
    locks.delete(classId);
  }
}

export function isBatchReportCardSyncRunning(): boolean {
  return Boolean(globalForBatchSync.__mindxReportCardBatchSyncInFlight);
}

/**
 * Executes a full server-side batch run across discovered or explicitly passed classes.
 */
export async function runBatchReportCardSync(
  options?: RunBatchReportCardSyncOptions
): Promise<BatchReportCardSyncSummary> {
  if (globalForBatchSync.__mindxReportCardBatchSyncInFlight) {
    return {
      success: false,
      statusCode: 409,
      conflict: true,
      totalClasses: 0,
      syncedCount: 0,
      skippedUnchangedCount: 0,
      skippedNoScoresCount: 0,
      needsAttentionCount: 0,
      cancelledCount: 0,
      results: [],
      error: "Đang có một tiến trình Quét & Đồng bộ hàng loạt khác đang chạy.",
    };
  }

  globalForBatchSync.__mindxReportCardBatchSyncInFlight = true;
  try {
    const isQueueStoppedFn = options?.isQueueStoppedFn || defaultIsQueueStopped;
    let targetCodes: string[] = [];

    if (Array.isArray(options?.classCodes)) {
      const seen = new Set<string>();
      for (const rawCode of options.classCodes) {
        const safe = isSafeBatchClassCode(rawCode, {
          allowSyntheticForTest: options?.allowSyntheticForTest,
        });
        if (!safe) {
          return {
            success: false,
            statusCode: 400,
            totalClasses: 0,
            syncedCount: 0,
            skippedUnchangedCount: 0,
            skippedNoScoresCount: 0,
            needsAttentionCount: 0,
            cancelledCount: 0,
            results: [],
            error: `Mã lớp '${String(rawCode)}' không hợp lệ.`,
          };
        }
        if (!seen.has(safe)) {
          seen.add(safe);
          targetCodes.push(safe);
        }
      }
    } else {
      const discovered = await discoverRunningClassesForBatchSync({
        refreshFromLms: options?.refreshFromLms,
        allowSyntheticForTest: options?.allowSyntheticForTest,
        nowMs: options?.nowMs,
        fetchRunningClassesFn: options?.fetchRunningClassesFn,
        isQueueStoppedFn,
      });
      if (!discovered.success) {
        return {
          success: false,
          statusCode: discovered.statusCode,
          cancelled: discovered.cancelled,
          totalClasses: 0,
          syncedCount: 0,
          skippedUnchangedCount: 0,
          skippedNoScoresCount: 0,
          needsAttentionCount: 0,
          cancelledCount: 0,
          results: [],
          error: discovered.error,
        };
      }
      targetCodes = discovered.classes.map((c) => c.classCode);
    }

    const results: SingleClassBatchSyncResult[] = [];
    let haltedByStop = false;

    for (const code of targetCodes) {
      if (haltedByStop || isQueueStoppedFn()) {
        haltedByStop = true;
        results.push({
          success: false,
          statusCode: 409,
          cancelled: true,
          classCode: code,
          outcome: "CANCELLED",
          stage: "INIT",
          syncedScoreCount: 0,
          declaredExerciseCount: 0,
          error: "Đã dừng trước khi xử lý lớp này theo yêu cầu dừng khẩn cấp.",
        });
        continue;
      }

      const itemRes = await syncSingleClassReportCardFlow(code, {
        forceSyncUnchanged: options?.forceSyncUnchanged,
        allowSyntheticForTest: options?.allowSyntheticForTest,
        scrapeFn: options?.scrapeFn,
        syncTeachingFn: options?.syncTeachingFn,
        isQueueStoppedFn,
      });
      results.push(itemRes);
      if (itemRes.outcome === "CANCELLED") {
        haltedByStop = true;
      }
    }

    let syncedCount = 0;
    let skippedUnchangedCount = 0;
    let skippedNoScoresCount = 0;
    let needsAttentionCount = 0;
    let cancelledCount = 0;
    for (const r of results) {
      if (r.outcome === "SYNCED") syncedCount++;
      else if (r.outcome === "SKIPPED_UNCHANGED") skippedUnchangedCount++;
      else if (r.outcome === "SKIPPED_NO_SCORES") skippedNoScoresCount++;
      else if (r.outcome === "NEEDS_ATTENTION") needsAttentionCount++;
      else if (r.outcome === "CANCELLED") cancelledCount++;
    }

    return {
      success: !haltedByStop,
      statusCode: haltedByStop ? 409 : 200,
      cancelled: haltedByStop,
      totalClasses: targetCodes.length,
      syncedCount,
      skippedUnchangedCount,
      skippedNoScoresCount,
      needsAttentionCount,
      cancelledCount,
      results,
    };
  } finally {
    globalForBatchSync.__mindxReportCardBatchSyncInFlight = false;
  }
}
