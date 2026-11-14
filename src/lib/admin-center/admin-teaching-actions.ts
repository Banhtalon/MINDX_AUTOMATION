import { getDynamicAdminConfig } from "../config";
import {
  adminCenterRepo,
  buildDefaultTeachingProjectName,
  isRoboticsClassCode,
  jobLogRepo,
  normalizeAssignedStudentIds,
  normalizeDateToIsoYmd,
  parseManualOverridesMap,
  parseReportCardLmsSnapshot,
  reportCardRepo,
  type AdminBtvnSyncStatus,
  type AdminCenterClassRecord,
  type AdminSpckTasksSyncStatus,
} from "../db/sqlite";
import {
  findMatchedCourseSyllabus,
  getStandardFiveTasksForClass,
  mergeExistingTeachingTasksWithStandardFive,
} from "../gemini/teaching-project-generator";
import { isValidLmsClassCode } from "../lms/lms-class-url";
import { authService } from "../playwright/auth";
import {
  isConfirmedRunningStatus,
  resolveClassDateRangeInfo,
} from "../playwright/sync-class";
import {
  LiveTeachingHttpTransport,
  type TeachingHttpTransport,
} from "../playwright/teaching-project-service";
import {
  executeReportCardTeachingTransportSync,
  LiveTeachingReportCardHttpTransport,
  type TeachingReportCardHttpTransport,
} from "../playwright/teaching-report-card-sync";
import { taskQueue } from "../queue/task-queue";
import { computeClassReportCard } from "../report-card/report-card-calculator";
import { redactSecrets, sanitizeErrorMessage } from "../security/secret-redactor";
import { mapSessionToTeachingProgressMilestone } from "../teaching/session-progress-mapper";
import {
  ensureQueueNotStopped,
  runWithStopGuard,
} from "../teaching/teaching-http-client";
import {
  computeAdminClassAudits,
  evaluateTeachingSpckTasksCompliance,
  fetchSingleLmsClassGqlInAdminSession,
} from "./admin-lms-scanner";
import {
  fetchTeachingClassDetailsBatch,
  type AdminTeachingHttpFetcherDeps,
} from "./admin-teaching-scraper";
import type {
  AdminBtvnCodingSummary,
  AdminSpckTeachingTasksSummary,
} from "./admin-types";

export interface AdminBtvnSyncActionResult {
  success: boolean;
  statusCode: number;
  classCode: string;
  status: AdminBtvnSyncStatus;
  matchedCount: number;
  unmatchedStudentNames: string[];
  pushedScoresCount: number;
  error?: string;
}

export interface AdminBatchBtvnSyncActionResult {
  success: boolean;
  statusCode: number;
  totalTargets: number;
  verifiedCount: number;
  needsAttentionCount: number;
  failedCount: number;
  results: AdminBtvnSyncActionResult[];
  error?: string;
}

export interface AdminSpckTasksProvisionResult {
  success: boolean;
  statusCode: number;
  classCode: string;
  status: AdminSpckTasksSyncStatus | "NEEDS_ATTENTION";
  projectId: number | null;
  projectName: string;
  taskCount: number;
  totalWeightPercent: number;
  assignedStudentCount: number;
  syncedProgressTasksCount: number;
  targetProgressPercent: number;
  error?: string;
}

export interface AdminBatchSpckTasksProvisionResult {
  success: boolean;
  statusCode: number;
  totalTargets: number;
  verifiedCount: number;
  needsAttentionCount: number;
  failedCount: number;
  results: AdminSpckTasksProvisionResult[];
  error?: string;
}

export type SingleLmsGqlHook = (classCode: string) => Promise<{
  lmsClassId: string;
  classByIdData: any | null;
  submissionGqlData: any | null;
  studentWorks: any[];
}>;

export interface AdminBtvnSyncOptions {
  refreshFromLms?: boolean;
  transport?: TeachingReportCardHttpTransport;
  teachingDeps?: AdminTeachingHttpFetcherDeps;
  fetchSingleLmsHook?: SingleLmsGqlHook;
}

export interface AdminSpckTasksProvisionOptions {
  syncProgressBySession?: boolean;
  cleanupExtraTasks?: boolean;
  transport?: TeachingHttpTransport;
  startDateOverride?: string;
  endDateOverride?: string;
  courseNameOverride?: string;
}

function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function isRemoteStudentInactive(status: unknown): boolean {
  const s = String(status || "").trim().toLowerCase();
  if (!s) return false;
  return /nghỉ|bảo\s*lưu|inactive|dropped|dừng|chuyển\s*lớp|quit|pause|hold/i.test(
    s
  );
}

function validateExplicitClassCodes(
  rawCodes: unknown
):
  | { mode: "AUTO" }
  | { mode: "EXPLICIT"; codes: string[] }
  | { mode: "INVALID"; error: string } {
  if (rawCodes === undefined) {
    return { mode: "AUTO" };
  }
  if (!Array.isArray(rawCodes) || rawCodes.length === 0) {
    return {
      mode: "INVALID",
      error: "Danh sách mã lớp (classCodes) không được để trống.",
    };
  }
  const normalized: string[] = [];
  for (const item of rawCodes) {
    const code = String(item ?? "").trim().toUpperCase();
    if (!isValidLmsClassCode(code)) {
      return {
        mode: "INVALID",
        error: redactSecrets(
          `Danh sách classCodes chứa mã lớp không hợp lệ: "${String(item ?? "")}".`
        ),
      };
    }
    normalized.push(code);
  }
  return {
    mode: "EXPLICIT",
    codes: Array.from(new Set(normalized)),
  };
}

async function refreshSingleClassSnapshotInsideQueue(
  classCode: string,
  existing: AdminCenterClassRecord | undefined,
  options?: {
    fetchSingleLmsHook?: SingleLmsGqlHook;
    teachingDeps?: AdminTeachingHttpFetcherDeps;
  }
): Promise<AdminCenterClassRecord | undefined> {
  const adminCfg = getDynamicAdminConfig();
  const lmsFetched = options?.fetchSingleLmsHook
    ? await options.fetchSingleLmsHook(classCode)
    : await authService.withAdminLmsSession((page) =>
        fetchSingleLmsClassGqlInAdminSession(page, classCode)
      );

  if (!lmsFetched || !lmsFetched.classByIdData) {
    throw new Error(
      `Không tìm thấy hoặc không đọc được dữ liệu lớp ${classCode} trên LMS dưới quyền Admin.`
    );
  }

  const { detailsByClass } = await fetchTeachingClassDetailsBatch(
    [
      {
        classCode,
        blockType: isRoboticsClassCode(classCode) ? "ROBOTICS" : "CODING",
        needScores: !isRoboticsClassCode(classCode),
        needSpckProject: true,
      },
    ],
    options?.teachingDeps
  );

  const teachingDetail = detailsByClass.get(classCode) || null;
  const audited = computeAdminClassAudits({
    centerCode: existing?.centerCode || adminCfg.adminCenterCode || "205ALHP",
    rawClassMeta: {
      classCode,
      lmsClassId: lmsFetched.lmsClassId || existing?.lmsClassId || "",
      courseName: existing?.courseName || "",
      status: existing?.status || "Running",
      startDate: existing?.startDate || "",
      endDate: existing?.endDate || "",
      mainTeacher: existing?.mainTeacher || "",
      assistantTeacher: existing?.assistantTeacher || "",
    },
    classByIdData: lmsFetched.classByIdData,
    submissionGqlData: lmsFetched.submissionGqlData,
    studentWorks: lmsFetched.studentWorks || [],
    teachingDetail,
  });

  // Preserve previously scraped Teaching weekly schedule/check fields (index.php / check_nhanxet.php)
  // and cached SPCK task status if Teaching endpoints failed during refresh.
  if (existing) {
    audited.timeSlot = audited.timeSlot || existing.timeSlot;
    audited.specialEvent = audited.specialEvent || existing.specialEvent;
    if (
      teachingDetail?.failedEndpoints?.includes("project") ||
      teachingDetail?.failedEndpoints?.includes("tasks")
    ) {
      audited.spckTasksJson = existing.spckTasksJson;
    }
    const prevWeekly = safeParseJson<Record<string, any> | null>(
      existing.weeklyOpsJson,
      null
    );
    const nextWeekly = safeParseJson<Record<string, any> | null>(
      audited.weeklyOpsJson,
      null
    );
    if (prevWeekly && nextWeekly) {
      if (!nextWeekly.zaloStatus && prevWeekly.zaloStatus) {
        nextWeekly.zaloStatus = prevWeekly.zaloStatus;
        nextWeekly.zaloDeadline = prevWeekly.zaloDeadline;
        nextWeekly.isZaloLateOrMissing = prevWeekly.isZaloLateOrMissing;
      }
      if (!nextWeekly.lmsCheckStatus && prevWeekly.lmsCheckStatus) {
        nextWeekly.lmsCheckStatus = prevWeekly.lmsCheckStatus;
        nextWeekly.lmsDeadline = prevWeekly.lmsDeadline;
        nextWeekly.isLmsLateOrMissing = prevWeekly.isLmsLateOrMissing;
      }
      if (!nextWeekly.checkIssueNote && prevWeekly.checkIssueNote) {
        nextWeekly.checkIssueNote = prevWeekly.checkIssueNote;
      }
      audited.weeklyOpsJson = JSON.stringify(nextWeekly);
    }
  }

  return adminCenterRepo.upsertClass(audited);
}

async function syncSingleBtvnInsideQueue(
  rawClassCode: string,
  options?: AdminBtvnSyncOptions
): Promise<AdminBtvnSyncActionResult> {
  const classCode = String(rawClassCode || "").trim().toUpperCase();
  if (!isValidLmsClassCode(classCode)) {
    return {
      success: false,
      statusCode: 400,
      classCode,
      status: "FAILED",
      matchedCount: 0,
      unmatchedStudentNames: [],
      pushedScoresCount: 0,
      error: redactSecrets(`Mã lớp không hợp lệ: "${rawClassCode}".`),
    };
  }

  let record = adminCenterRepo.findClass(classCode);
  if (isRoboticsClassCode(classCode) || record?.blockType === "ROBOTICS") {
    return {
      success: false,
      statusCode: 400,
      classCode,
      status: "FAILED",
      matchedCount: 0,
      unmatchedStudentNames: [],
      pushedScoresCount: 0,
      error: "Khối Robotics không áp dụng đồng bộ điểm BTVN Coding.",
    };
  }

  const jobId = `admin_btvn_sync_${classCode}_${Date.now()}`;
  const adminCfg = getDynamicAdminConfig();

  try {
    ensureQueueNotStopped();
    if (record) {
      adminCenterRepo.updateBtvnSyncState(classCode, {
        btvnSyncStatus: "SYNCING",
        btvnLastError: null,
      });
    }

    const hasCachedSnapshot =
      Boolean(record?.lmsReportCardSnapshotJson) &&
      record?.lmsReportCardSnapshotJson.trim() !== "{}";

    if (options?.refreshFromLms || !hasCachedSnapshot) {
      record = await refreshSingleClassSnapshotInsideQueue(classCode, record, {
        fetchSingleLmsHook: options?.fetchSingleLmsHook,
        teachingDeps: options?.teachingDeps,
      });
    }

    const snapshot = parseReportCardLmsSnapshot(
      record?.lmsReportCardSnapshotJson,
      classCode
    );
    if (!snapshot) {
      const msg = `Chưa có dữ liệu điểm BTVN LMS của lớp ${classCode}. Vui lòng quét lớp trước khi đồng bộ.`;
      if (record) {
        adminCenterRepo.updateBtvnSyncState(classCode, {
          btvnSyncStatus: "FAILED",
          btvnLastError: msg,
        });
      }
      return {
        success: false,
        statusCode: 400,
        classCode,
        status: "FAILED",
        matchedCount: 0,
        unmatchedStudentNames: [],
        pushedScoresCount: 0,
        error: msg,
      };
    }

    if (snapshot.isRobotics) {
      return {
        success: false,
        statusCode: 400,
        classCode,
        status: "FAILED",
        matchedCount: 0,
        unmatchedStudentNames: [],
        pushedScoresCount: 0,
        error: "Khối Robotics không áp dụng đồng bộ điểm BTVN Coding.",
      };
    }

    // Read-only lookup of any teacher manual overrides; NEVER writes to teacher tables
    const teacherCardReadOnly = reportCardRepo.findOne(classCode);
    const manualOverrides = parseManualOverridesMap(
      teacherCardReadOnly?.manualOverridesJson
    );
    const computed = computeClassReportCard(snapshot, manualOverrides);

    const studentsWithGradedBtvn = computed.students.filter(
      (s) => s.isActive && s.btvnAvgNorm !== null
    );
    if (studentsWithGradedBtvn.length === 0) {
      const msg =
        "Chưa có điểm BTVN nào đã chấm trên LMS để đẩy sang Teaching.";
      adminCenterRepo.updateBtvnSyncState(classCode, {
        btvnSyncStatus: "NEEDS_ATTENTION",
        btvnLastError: msg,
      });
      return {
        success: false,
        statusCode: 200,
        classCode,
        status: "NEEDS_ATTENTION",
        matchedCount: 0,
        unmatchedStudentNames: [],
        pushedScoresCount: 0,
        error: msg,
      };
    }

    const transport: TeachingReportCardHttpTransport =
      options?.transport ||
      new LiveTeachingReportCardHttpTransport(undefined, undefined, {
        username: adminCfg.adminTeachingUsername,
        password: adminCfg.adminTeachingPassword,
      });

    const syncRes = await executeReportCardTeachingTransportSync({
      classId: classCode,
      computed,
      isRobotics: false,
      transport,
      allowPartialStudentMatch: true,
      btvnOnly: true,
      skipNullSlotVerification: true,
      jobId,
    });

    const syncedAt = new Date().toISOString();
    const unmatchedStudentNames = syncRes.skippedStudents.map(
      (s) => s.localFullName
    );
    const currentBtvnSummary = safeParseJson<AdminBtvnCodingSummary>(
      record?.btvnSummaryJson,
      {
        applicable: true,
        latestHomeworkSessionNumber: 0,
        submittedCount: 0,
        expectedCount: 0,
        submissionRatePercent: 0,
        lowSubmissionWarning: false,
        ungradedCellsCount: 0,
        ungradedSessions: [],
        gradedCellsCount: 0,
        redoCellsCount: 0,
        notSubmittedCellsCount: 0,
        teachingDeclaredBtvnSessions: [],
        teachingScoredCellsCount: 0,
        isOutOfSyncWithTeaching: false,
      }
    );

    const updatedBtvnSummary: AdminBtvnCodingSummary = {
      ...currentBtvnSummary,
      teachingDeclaredBtvnSessions: Array.from(
        new Set([
          ...(currentBtvnSummary.teachingDeclaredBtvnSessions || []),
          ...computed.btvnSessions.map((s) => s.sessionNumber),
        ])
      ).sort((a, b) => a - b),
      teachingScoredCellsCount: Math.max(
        currentBtvnSummary.teachingScoredCellsCount || 0,
        syncRes.scoresToSave.length
      ),
      isOutOfSyncWithTeaching: false,
    };

    const safeSkippedWarning = syncRes.skippedWarning
      ? redactSecrets(syncRes.skippedWarning)
      : undefined;

    adminCenterRepo.updateBtvnSyncState(classCode, {
      btvnSyncStatus: "VERIFIED",
      btvnSyncedAt: syncedAt,
      btvnLastError: safeSkippedWarning || null,
      btvnSummaryJson: JSON.stringify(updatedBtvnSummary),
    });

    jobLogRepo.add({
      jobId,
      jobType: "CUSTOM",
      classId: classCode,
      level: syncRes.skippedStudents.length > 0 ? "WARN" : "INFO",
      message: redactSecrets(
        `Admin BTVN Sync VERIFIED cho lớp ${classCode}: ${syncRes.scoresToSave.length} ô điểm BTVN (${syncRes.studentMatches.size} HV khớp Teaching).`
      ),
    });

    return {
      success: true,
      statusCode: 200,
      classCode,
      status: "VERIFIED",
      matchedCount: syncRes.studentMatches.size,
      unmatchedStudentNames,
      pushedScoresCount: syncRes.scoresToSave.length,
      ...(safeSkippedWarning ? { error: safeSkippedWarning } : {}),
    };
  } catch (err: any) {
    const errMsg = sanitizeErrorMessage(err);
    if (adminCenterRepo.findClass(classCode)) {
      adminCenterRepo.updateBtvnSyncState(classCode, {
        btvnSyncStatus: "FAILED",
        btvnLastError: errMsg,
      });
    }
    jobLogRepo.add({
      jobId,
      jobType: "CUSTOM",
      classId: classCode,
      level: "ERROR",
      message: redactSecrets(`Admin BTVN Sync thất bại cho lớp ${classCode}: ${errMsg}`),
    });
    return {
      success: false,
      statusCode: 500,
      classCode,
      status: "FAILED",
      matchedCount: 0,
      unmatchedStudentNames: [],
      pushedScoresCount: 0,
      error: errMsg,
    };
  }
}

export async function syncAdminClassBtvnToTeaching(
  rawClassCode: string,
  options?: AdminBtvnSyncOptions
): Promise<AdminBtvnSyncActionResult> {
  const classCode = String(rawClassCode || "").trim().toUpperCase();
  if (!isValidLmsClassCode(classCode)) {
    return {
      success: false,
      statusCode: 400,
      classCode,
      status: "FAILED",
      matchedCount: 0,
      unmatchedStudentNames: [],
      pushedScoresCount: 0,
      error: redactSecrets(`Mã lớp không hợp lệ: "${rawClassCode}".`),
    };
  }

  const existing = adminCenterRepo.findClass(classCode);
  if (isRoboticsClassCode(classCode) || existing?.blockType === "ROBOTICS") {
    return {
      success: false,
      statusCode: 400,
      classCode,
      status: "FAILED",
      matchedCount: 0,
      unmatchedStudentNames: [],
      pushedScoresCount: 0,
      error: "Khối Robotics không áp dụng đồng bộ điểm BTVN Coding.",
    };
  }

  return await taskQueue.enqueue({
    id: `admin_btvn_single_${classCode}_${Date.now()}`,
    jobType: "CUSTOM",
    classId: classCode,
    description: `Admin đồng bộ điểm BTVN Coding sang Teaching (${classCode})`,
    execute: () => syncSingleBtvnInsideQueue(classCode, options),
  });
}

export async function syncAdminBatchBtvnToTeaching(
  rawClassCodes?: string[],
  options?: AdminBtvnSyncOptions
): Promise<AdminBatchBtvnSyncActionResult> {
  const adminCfg = getDynamicAdminConfig();
  const validated = validateExplicitClassCodes(rawClassCodes);
  if (validated.mode === "INVALID") {
    return {
      success: false,
      statusCode: 400,
      totalTargets: 0,
      verifiedCount: 0,
      needsAttentionCount: 0,
      failedCount: 0,
      results: [],
      error: validated.error,
    };
  }

  let targetCodes: string[] =
    validated.mode === "EXPLICIT" ? validated.codes : [];

  if (validated.mode === "AUTO") {
    targetCodes = adminCenterRepo
      .listClasses({
        centerCode: adminCfg.adminCenterCode || "205ALHP",
        includeMakeup: false,
      })
      .filter((c) => {
        if (c.blockType !== "CODING") return false;
        const stUp = String(c.status || "").toUpperCase();
        return stUp === "RUNNING" || stUp === "ACTIVE";
      })
      .map((c) => c.classCode);
  }

  if (targetCodes.length === 0) {
    return {
      success: true,
      statusCode: 200,
      totalTargets: 0,
      verifiedCount: 0,
      needsAttentionCount: 0,
      failedCount: 0,
      results: [],
    };
  }

  const results: AdminBtvnSyncActionResult[] = [];
  await taskQueue.enqueue({
    id: `admin_btvn_batch_${Date.now()}`,
    jobType: "CUSTOM",
    classId: adminCfg.adminCenterCode || "205ALHP",
    description: `Admin đồng bộ hàng loạt điểm BTVN Coding (${targetCodes.length} lớp)`,
    execute: async () => {
      for (const code of targetCodes) {
        ensureQueueNotStopped();
        if (isRoboticsClassCode(code)) {
          results.push({
            success: false,
            statusCode: 400,
            classCode: code,
            status: "FAILED",
            matchedCount: 0,
            unmatchedStudentNames: [],
            pushedScoresCount: 0,
            error: "Khối Robotics không áp dụng đồng bộ điểm BTVN Coding.",
          });
          continue;
        }
        const r = await syncSingleBtvnInsideQueue(code, options);
        results.push(r);
      }
      return results;
    },
  });

  const verifiedCount = results.filter((r) => r.status === "VERIFIED").length;
  const needsAttentionCount = results.filter(
    (r) => r.status === "NEEDS_ATTENTION"
  ).length;
  const failedCount = results.filter((r) => r.status === "FAILED").length;

  return {
    success: failedCount === 0,
    statusCode: 200,
    totalTargets: targetCodes.length,
    verifiedCount,
    needsAttentionCount,
    failedCount,
    results,
  };
}

function validateSpckTaskEligibility(
  classCode: string
):
  | { ok: true; existing: AdminCenterClassRecord }
  | { ok: false; result: AdminSpckTasksProvisionResult } {
  const existing = adminCenterRepo.findClass(classCode);
  if (
    existing &&
    isConfirmedRunningStatus(existing.status) &&
    existing.currentSessionNumber >= 10
  ) {
    return { ok: true, existing };
  }
  const reasonMsg = !existing
    ? `Lớp ${classCode} chưa có trong dữ liệu quét cơ sở — vui lòng Quét cơ sở trước khi tạo nhiệm vụ SPCK.`
    : !isConfirmedRunningStatus(existing.status)
    ? `Lớp ${classCode} có trạng thái "${existing.status || "Không xác định"}" (không phải Running) — không tạo nhiệm vụ SPCK.`
    : `Lớp ${classCode} đang ở Buổi ${existing.currentSessionNumber} (<= Buổi 9) — chỉ tạo 5 nhiệm vụ SPCK cho lớp > Buổi 9.`;
  return {
    ok: false,
    result: {
      success: false,
      statusCode: 400,
      classCode,
      status: "INCOMPLETE",
      projectId: null,
      projectName: buildDefaultTeachingProjectName(classCode),
      taskCount: 0,
      totalWeightPercent: 0,
      assignedStudentCount: 0,
      syncedProgressTasksCount: 0,
      targetProgressPercent: 0,
      error: redactSecrets(reasonMsg),
    },
  };
}

async function provisionSingleSpckTasksInsideQueue(
  rawClassCode: string,
  options?: AdminSpckTasksProvisionOptions
): Promise<AdminSpckTasksProvisionResult> {
  const classCode = String(rawClassCode || "").trim().toUpperCase();
  if (!isValidLmsClassCode(classCode)) {
    return {
      success: false,
      statusCode: 400,
      classCode,
      status: "FAILED",
      projectId: null,
      projectName: buildDefaultTeachingProjectName(classCode),
      taskCount: 0,
      totalWeightPercent: 0,
      assignedStudentCount: 0,
      syncedProgressTasksCount: 0,
      targetProgressPercent: 0,
      error: redactSecrets(`Mã lớp không hợp lệ: "${rawClassCode}".`),
    };
  }

  const eligibility = validateSpckTaskEligibility(classCode);
  if (!eligibility.ok) {
    return eligibility.result;
  }
  const existing = eligibility.existing;

  const dateInfo = resolveClassDateRangeInfo(classCode, {
    startDateHint: options?.startDateOverride || existing?.startDate,
    endDateHint: options?.endDateOverride || existing?.endDate,
  });
  const startDate =
    normalizeDateToIsoYmd(options?.startDateOverride || existing?.startDate) ||
    dateInfo.startDateIso;
  const endDate =
    normalizeDateToIsoYmd(options?.endDateOverride || existing?.endDate) ||
    dateInfo.endDateIso;

  if (!startDate || !endDate || endDate < startDate) {
    const msg = `Lớp ${classCode} thiếu hoặc sai Ngày bắt đầu / Ngày kết thúc hợp lệ từ LMS để tạo dự án SPCK.`;
    if (existing) {
      adminCenterRepo.updateSpckTasksSyncState(classCode, {
        spckTasksSyncStatus: "FAILED",
        spckTasksLastError: msg,
      });
    }
    return {
      success: false,
      statusCode: 400,
      classCode,
      status: "FAILED",
      projectId: null,
      projectName: buildDefaultTeachingProjectName(classCode),
      taskCount: 0,
      totalWeightPercent: 0,
      assignedStudentCount: 0,
      syncedProgressTasksCount: 0,
      targetProgressPercent: 0,
      error: msg,
    };
  }

  const jobId = `admin_spck_tasks_${classCode}_${Date.now()}`;
  const adminCfg = getDynamicAdminConfig();
  const currentSessionNumber = existing?.currentSessionNumber || 0;
  const milestone = mapSessionToTeachingProgressMilestone(currentSessionNumber);

  try {
    ensureQueueNotStopped();
    if (existing) {
      adminCenterRepo.updateSpckTasksSyncState(classCode, {
        spckTasksSyncStatus: "SYNCING",
        spckTasksLastError: null,
      });
    }

    const transport: TeachingHttpTransport =
      options?.transport ||
      new LiveTeachingHttpTransport(undefined, undefined, {
        username: adminCfg.adminTeachingUsername,
        password: adminCfg.adminTeachingPassword,
      });

    // 1. Fetch remote project & Teaching student roster
    let [remoteProject, remoteStudents] = await runWithStopGuard(() =>
      Promise.all([
        transport.getProject(classCode),
        transport.getStudents(classCode),
      ])
    );

    const activeStudents = remoteStudents.filter((s) => {
      const code = String(s.class_code || classCode).trim().toUpperCase();
      return code === classCode && !isRemoteStudentInactive(s.status);
    });
    const activeStudentIds = Array.from(
      new Set(
        activeStudents
          .map((s) => Number(s.id))
          .filter((id) => Number.isInteger(id) && id > 0)
      )
    ).sort((a, b) => a - b);

    if (activeStudentIds.length === 0) {
      const msg = `Lớp ${classCode} chưa có danh sách học viên đang học trên Teaching.`;
      if (existing) {
        adminCenterRepo.updateSpckTasksSyncState(classCode, {
          spckTasksSyncStatus: "INCOMPLETE",
          spckTasksLastError: msg,
        });
      }
      return {
        success: false,
        statusCode: 400,
        classCode,
        status: "NEEDS_ATTENTION",
        projectId: remoteProject?.id ? Number(remoteProject.id) : null,
        projectName:
          remoteProject?.project_name || buildDefaultTeachingProjectName(classCode),
        taskCount: 0,
        totalWeightPercent: 0,
        assignedStudentCount: 0,
        syncedProgressTasksCount: 0,
        targetProgressPercent: milestone.targetPercent,
        error: msg,
      };
    }

    // 2. Create project if missing
    const courseName =
      options?.courseNameOverride || existing?.courseName || dateInfo.courseName || "";
    const syllabus = findMatchedCourseSyllabus(classCode, courseName);
    const defaultProjectName = buildDefaultTeachingProjectName(classCode);
    const defaultDescription =
      syllabus?.description || `Sản phẩm cuối khóa (SPCK) lớp ${classCode}`;

    if (!remoteProject || !Number(remoteProject.id)) {
      const createRes = await runWithStopGuard(() =>
        transport.createProject({
          classCode,
          projectName: defaultProjectName,
          startDate,
          endDate,
          description: defaultDescription,
        })
      );
      if (!createRes || createRes.success === false) {
        throw new Error(
          createRes?.message || `Không tạo được dự án SPCK cho lớp ${classCode} trên Teaching.`
        );
      }
      remoteProject = await runWithStopGuard(() => transport.getProject(classCode));
    }

    const projectId = Number(remoteProject?.id);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      throw new Error(
        `[Read-after-Write Error] Không tìm thấy dự án SPCK của lớp ${classCode} trên Teaching sau khi tạo.`
      );
    }

    // 3. Merge existing tasks with standard 5 tasks (20% x 5 = 100%)
    const existingRemoteTasks = await runWithStopGuard(() =>
      transport.getTasks(projectId)
    );
    const standardFive = getStandardFiveTasksForClass(
      classCode,
      endDate,
      activeStudentIds,
      courseName || syllabus?.courseName
    );
    const merged = mergeExistingTeachingTasksWithStandardFive({
      classCode,
      courseName: courseName || syllabus?.courseName,
      endDate,
      allStudentIds: activeStudentIds,
      existingRemoteTasks,
    });
    for (let idx = 0; idx < 5 && idx < merged.tasks.length && idx < standardFive.length; idx++) {
      merged.tasks[idx] = {
        ...merged.tasks[idx],
        taskName: standardFive[idx].taskName,
        weightPercent: 20,
        deadline: merged.tasks[idx].deadline || standardFive[idx].deadline || endDate,
        description: merged.tasks[idx].description || standardFive[idx].description,
      };
    }

    if (options?.cleanupExtraTasks === true && merged.extraRemoteTaskIds.length > 0) {
      for (const extraId of merged.extraRemoteTaskIds) {
        ensureQueueNotStopped();
        await runWithStopGuard(() => transport.deleteTask(extraId));
      }
    }

    for (const task of merged.tasks) {
      ensureQueueNotStopped();
      const assignedIds = Array.from(
        new Set([...task.assignedStudentIds, ...activeStudentIds])
      ).sort((a, b) => a - b);
      const saveRes = await runWithStopGuard(() =>
        transport.saveTask({
          projectId,
          taskId: task.taskId ?? undefined,
          taskName: task.taskName,
          weightPercent: 20,
          deadline: task.deadline || endDate,
          description: task.description,
          assignedStudentIds: assignedIds,
        })
      );
      if (!saveRes || saveRes.success === false) {
        throw new Error(
          saveRes?.message ||
            `Lỗi khi lưu công việc "${task.taskName}" cho lớp ${classCode} trên Teaching.`
        );
      }
    }

    // 4. Read-after-Write Verification on project + 5 standard tasks
    const [verifiedProject, verifiedTasks] = await runWithStopGuard(() =>
      Promise.all([
        transport.getProject(classCode),
        transport.getTasks(projectId),
      ])
    );

    if (!verifiedProject || Number(verifiedProject.id) !== projectId) {
      throw new Error(
        `[Read-after-Write Error] Không xác minh được dự án ID=${projectId} của lớp ${classCode} sau khi lưu.`
      );
    }
    if (verifiedTasks.length < 5) {
      throw new Error(
        `[Read-after-Write Error] Teaching chỉ trả về ${verifiedTasks.length}/5 công việc sau khi lưu.`
      );
    }

    const claimedTaskIds = new Set<number>();
    const verifiedStandardTaskPairs: Array<{
      remoteTaskId: number;
      assignedStudentIds: number[];
    }> = [];

    for (let i = 0; i < 5; i++) {
      const expected = merged.tasks[i];
      const expectedName = expected.taskName.trim();
      const matched =
        (expected.taskId
          ? verifiedTasks.find(
              (rt) =>
                !claimedTaskIds.has(Number(rt.id)) &&
                Number(rt.id) === Number(expected.taskId) &&
                String(rt.task_name || "").trim() === expectedName
            )
          : undefined) ||
        verifiedTasks.find(
          (rt) =>
            !claimedTaskIds.has(Number(rt.id)) &&
            String(rt.task_name || "").trim() === expectedName
        );
      if (!matched) {
        throw new Error(
          `[Read-after-Write Error] Thiếu công việc chuẩn "${expectedName}" trên Teaching sau khi lưu.`
        );
      }
      const remoteTaskId = Number(matched.id);
      claimedTaskIds.add(remoteTaskId);

      const expectedDesc = String(expected.description || "")
        .replace(/\r\n/g, "\n")
        .trim();
      const remoteDesc = String(matched.description || "")
        .replace(/\r\n/g, "\n")
        .trim();
      if (expectedDesc && remoteDesc !== expectedDesc) {
        throw new Error(
          `[Read-after-Write Error] Mô tả công việc "${matched.task_name}" trên Teaching không khớp nội dung dự kiến.`
        );
      }

      if (Number(matched.weight_percent) !== 20) {
        throw new Error(
          `[Read-after-Write Error] Công việc "${matched.task_name}" có tỷ trọng ${matched.weight_percent}% (yêu cầu 20%).`
        );
      }
      const expectedDeadline = normalizeDateToIsoYmd(expected.deadline || endDate);
      const remoteDeadline = normalizeDateToIsoYmd(matched.deadline);
      if (!remoteDeadline || (expectedDeadline && remoteDeadline !== expectedDeadline)) {
        throw new Error(
          `[Read-after-Write Error] Công việc "${matched.task_name}" sai hoặc thiếu hạn nộp (${remoteDeadline || "trống"}, kỳ vọng ${expectedDeadline || "YYYY-MM-DD"}).`
        );
      }
      const assignedIds = normalizeAssignedStudentIds(matched.assigned_students);
      const missingStudentIds = activeStudentIds.filter(
        (sid) => !assignedIds.includes(sid)
      );
      if (missingStudentIds.length > 0) {
        throw new Error(
          `[Read-after-Write Error] Công việc "${matched.task_name}" thiếu học viên được giao (${missingStudentIds.join(", ")}) trên Teaching.`
        );
      }
      verifiedStandardTaskPairs.push({
        remoteTaskId,
        assignedStudentIds: assignedIds,
      });
    }

    // 5. Optional non-downgrading milestone progress sync by session number
    let syncedProgressTasksCount = 0;
    let progressMap = await runWithStopGuard(() =>
      transport.getTaskProgress(projectId)
    );

    if (options?.syncProgressBySession && milestone.milestoneTaskCount > 0) {
      const tasksToComplete = verifiedStandardTaskPairs.slice(
        0,
        milestone.milestoneTaskCount
      );
      for (const item of tasksToComplete) {
        for (const sid of item.assignedStudentIds) {
          ensureQueueNotStopped();
          const prevPct = Number(
            progressMap[`${item.remoteTaskId}_${sid}`] ?? 0
          );
          const nextPct = Math.max(
            Number.isFinite(prevPct) ? prevPct : 0,
            100
          );
          if (prevPct < 100) {
            const progRes = await runWithStopGuard(() =>
              transport.updateTaskProgress({
                taskId: item.remoteTaskId,
                studentId: sid,
                progressPercent: nextPct,
              })
            );
            if (!progRes || progRes.success === false) {
              throw new Error(
                progRes?.message ||
                  `Lỗi khi cập nhật tiến độ task=${item.remoteTaskId}, student=${sid}.`
              );
            }
          }
        }
        syncedProgressTasksCount++;
      }

      // Read-after-Write verification for updated milestone progress
      progressMap = await runWithStopGuard(() =>
        transport.getTaskProgress(projectId)
      );
      for (const item of tasksToComplete) {
        for (const sid of item.assignedStudentIds) {
          const verifiedPct = Number(
            progressMap[`${item.remoteTaskId}_${sid}`] ?? 0
          );
          if (verifiedPct < 100) {
            throw new Error(
              `[Read-after-Write Error] Tiến độ task=${item.remoteTaskId}, student=${sid} trên Teaching là ${verifiedPct}% (kỳ vọng >= 100%).`
            );
          }
        }
      }
    }

    const assignedUnion = new Set<number>();
    for (const t of verifiedTasks) {
      for (const sid of normalizeAssignedStudentIds(t.assigned_students)) {
        assignedUnion.add(sid);
      }
    }

    let avgPct = 0;
    if (verifiedTasks.length > 0 && activeStudentIds.length > 0) {
      let stuTotal = 0;
      for (const sid of activeStudentIds) {
        let stuScore = 0;
        for (const t of verifiedTasks) {
          const pct = Number(progressMap[`${t.id}_${sid}`] ?? 0);
          const w = Number(t.weight_percent) || 0;
          stuScore += (pct * w) / 100;
        }
        stuTotal += stuScore;
      }
      avgPct = Math.round(stuTotal / activeStudentIds.length);
    }

    const compliance = evaluateTeachingSpckTasksCompliance({
      classCode,
      courseName: courseName || syllabus?.courseName,
      endDate,
      eligibleGt9: existing ? existing.currentSessionNumber >= 10 : true,
      project: verifiedProject,
      tasks: verifiedTasks,
      activeStudentIds,
    });
    const totalWeightPercent = compliance.totalWeightPercent;
    const isCompliantReady = compliance.taskStatus === "READY";

    const updatedSpckSummary: AdminSpckTeachingTasksSummary = {
      eligibleGt9: existing ? existing.currentSessionNumber >= 10 : true,
      hasProject: true,
      projectId,
      projectName: String(verifiedProject.project_name || defaultProjectName).trim(),
      startDate: normalizeDateToIsoYmd(verifiedProject.start_date) || startDate,
      endDate: normalizeDateToIsoYmd(verifiedProject.end_date) || endDate,
      taskCount: verifiedTasks.length,
      totalWeightPercent,
      assignedStudentCount: assignedUnion.size,
      averageProgressPercent: avgPct,
      targetProgressPercent: milestone.targetPercent,
      taskStatus: compliance.taskStatus,
    };

    const syncedAt = new Date().toISOString();
    if (!isCompliantReady) {
      const weightErr = redactSecrets(
        `Dự án SPCK lớp ${classCode} chưa đạt chuẩn 5 nhiệm vụ x 20% (${compliance.matchedStandardTaskCount}/5 công việc chuẩn, tổng tỷ trọng ${totalWeightPercent}% trên ${verifiedTasks.length} công việc, trạng thái ${compliance.taskStatus}; đã giữ nguyên nhiệm vụ bổ sung để kiểm tra).`
      );
      adminCenterRepo.updateSpckTasksSyncState(classCode, {
        spckTasksSyncStatus: "INCOMPLETE",
        spckTasksSyncedAt: syncedAt,
        spckTasksLastError: weightErr,
        spckTasksJson: JSON.stringify(updatedSpckSummary),
      });
      jobLogRepo.add({
        jobId,
        jobType: "CUSTOM",
        classId: classCode,
        level: "WARN",
        message: weightErr,
      });
      return {
        success: false,
        statusCode: 409,
        classCode,
        status: "NEEDS_ATTENTION",
        projectId,
        projectName: updatedSpckSummary.projectName,
        taskCount: verifiedTasks.length,
        totalWeightPercent,
        assignedStudentCount: assignedUnion.size,
        syncedProgressTasksCount,
        targetProgressPercent: milestone.targetPercent,
        error: weightErr,
      };
    }

    adminCenterRepo.updateSpckTasksSyncState(classCode, {
      spckTasksSyncStatus: "VERIFIED",
      spckTasksSyncedAt: syncedAt,
      spckTasksLastError: null,
      spckTasksJson: JSON.stringify(updatedSpckSummary),
    });

    jobLogRepo.add({
      jobId,
      jobType: "CUSTOM",
      classId: classCode,
      level: "INFO",
      message: redactSecrets(
        `Admin tạo/kiểm chuẩn Dự án SPCK VERIFIED cho lớp ${classCode}: ID=${projectId}, ${verifiedTasks.length} công việc (${totalWeightPercent}%), ${assignedUnion.size} HV.`
      ),
    });

    return {
      success: true,
      statusCode: 200,
      classCode,
      status: "VERIFIED",
      projectId,
      projectName: updatedSpckSummary.projectName,
      taskCount: verifiedTasks.length,
      totalWeightPercent,
      assignedStudentCount: assignedUnion.size,
      syncedProgressTasksCount,
      targetProgressPercent: milestone.targetPercent,
    };
  } catch (err: any) {
    const errMsg = sanitizeErrorMessage(err);
    if (adminCenterRepo.findClass(classCode)) {
      adminCenterRepo.updateSpckTasksSyncState(classCode, {
        spckTasksSyncStatus: "FAILED",
        spckTasksLastError: errMsg,
      });
    }
    jobLogRepo.add({
      jobId,
      jobType: "CUSTOM",
      classId: classCode,
      level: "ERROR",
      message: redactSecrets(
        `Admin tạo 5 nhiệm vụ SPCK thất bại cho lớp ${classCode}: ${errMsg}`
      ),
    });
    return {
      success: false,
      statusCode: 500,
      classCode,
      status: "FAILED",
      projectId: null,
      projectName: buildDefaultTeachingProjectName(classCode),
      taskCount: 0,
      totalWeightPercent: 0,
      assignedStudentCount: 0,
      syncedProgressTasksCount: 0,
      targetProgressPercent: milestone.targetPercent,
      error: errMsg,
    };
  }
}

export async function provisionAdminSpckTasksOnTeaching(
  rawClassCode: string,
  options?: AdminSpckTasksProvisionOptions
): Promise<AdminSpckTasksProvisionResult> {
  const classCode = String(rawClassCode || "").trim().toUpperCase();
  if (!isValidLmsClassCode(classCode)) {
    return {
      success: false,
      statusCode: 400,
      classCode,
      status: "FAILED",
      projectId: null,
      projectName: buildDefaultTeachingProjectName(classCode),
      taskCount: 0,
      totalWeightPercent: 0,
      assignedStudentCount: 0,
      syncedProgressTasksCount: 0,
      targetProgressPercent: 0,
      error: redactSecrets(`Mã lớp không hợp lệ: "${rawClassCode}".`),
    };
  }

  const eligibility = validateSpckTaskEligibility(classCode);
  if (!eligibility.ok) {
    return eligibility.result;
  }

  return await taskQueue.enqueue({
    id: `admin_spck_single_${classCode}_${Date.now()}`,
    jobType: "CUSTOM",
    classId: classCode,
    description: `Admin tạo dự án & 5 nhiệm vụ SPCK trên Teaching (${classCode})`,
    execute: () => provisionSingleSpckTasksInsideQueue(classCode, options),
  });
}

export async function provisionAdminBatchSpckTasksOnTeaching(
  rawClassCodes?: string[],
  options?: AdminSpckTasksProvisionOptions
): Promise<AdminBatchSpckTasksProvisionResult> {
  const adminCfg = getDynamicAdminConfig();
  const validated = validateExplicitClassCodes(rawClassCodes);
  if (validated.mode === "INVALID") {
    return {
      success: false,
      statusCode: 400,
      totalTargets: 0,
      verifiedCount: 0,
      needsAttentionCount: 0,
      failedCount: 0,
      results: [],
      error: validated.error,
    };
  }

  let targetCodes: string[] =
    validated.mode === "EXPLICIT" ? validated.codes : [];

  if (validated.mode === "AUTO") {
    const allCenterRows = adminCenterRepo.listClasses({
      centerCode: adminCfg.adminCenterCode || "205ALHP",
      includeMakeup: false,
    });
    targetCodes = allCenterRows
      .filter((row) => {
        if (row.currentSessionNumber < 10) return false;
        if (!isConfirmedRunningStatus(row.status)) return false;
        const parsed = safeParseJson<AdminSpckTeachingTasksSummary | null>(
          row.spckTasksJson,
          null
        );
        return (
          row.spckTasksSyncStatus !== "VERIFIED" ||
          !parsed ||
          parsed.taskStatus !== "READY"
        );
      })
      .map((r) => r.classCode);
  }

  if (targetCodes.length === 0) {
    return {
      success: true,
      statusCode: 200,
      totalTargets: 0,
      verifiedCount: 0,
      needsAttentionCount: 0,
      failedCount: 0,
      results: [],
    };
  }

  const results: AdminSpckTasksProvisionResult[] = [];
  await taskQueue.enqueue({
    id: `admin_spck_batch_${Date.now()}`,
    jobType: "CUSTOM",
    classId: adminCfg.adminCenterCode || "205ALHP",
    description: `Admin tạo hàng loạt 5 nhiệm vụ SPCK > Buổi 9 (${targetCodes.length} lớp)`,
    execute: async () => {
      for (const code of targetCodes) {
        ensureQueueNotStopped();
        const r = await provisionSingleSpckTasksInsideQueue(code, options);
        results.push(r);
      }
      return results;
    },
  });

  const verifiedCount = results.filter((r) => r.status === "VERIFIED").length;
  const needsAttentionCount = results.filter(
    (r) => r.status === "NEEDS_ATTENTION"
  ).length;
  const failedCount = results.filter(
    (r) => !r.success && r.status !== "NEEDS_ATTENTION"
  ).length;

  return {
    success: failedCount === 0 && needsAttentionCount === 0,
    statusCode: 200,
    totalTargets: targetCodes.length,
    verifiedCount,
    needsAttentionCount,
    failedCount,
    results,
  };
}
