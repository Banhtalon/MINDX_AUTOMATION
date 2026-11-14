export type AdminBlockType = "CODING" | "ROBOTICS";

export type AdminBtvnSyncStatus =
  | "IDLE"
  | "SYNCING"
  | "VERIFIED"
  | "OUT_OF_SYNC"
  | "NEEDS_ATTENTION"
  | "FAILED";

export type AdminSpckTasksSyncStatus =
  | "IDLE"
  | "SYNCING"
  | "VERIFIED"
  | "MISSING"
  | "INCOMPLETE"
  | "FAILED";

export interface AdminWeeklyCheckpointAlert {
  milestone: "CP1" | "CP2" | "DEMO";
  sessionNumber: number;
  missingScoreCount: number;
  message: string;
}

export interface AdminWeeklyOpsSummary {
  evaluatedSessionNumber: number;
  evaluatedSessionDate: string;
  attendanceStatus: "COMPLETED" | "PARTIAL" | "NOT_MARKED" | "NOT_DUE";
  presentCount: number;
  absentCount: number;
  unmarkedCount: number;
  hasSummaryAndHomework: boolean;
  commentedPresentCount: number;
  missingCommentStudentNames: string[];
  zaloStatus: string;
  zaloDeadline: string;
  isZaloLateOrMissing: boolean;
  lmsCheckStatus: string;
  lmsDeadline: string;
  isLmsLateOrMissing: boolean;
  checkIssueNote: string;
  checkpointAlert: AdminWeeklyCheckpointAlert | null;
}

export interface AdminBtvnCodingSummary {
  applicable: boolean;
  latestHomeworkSessionNumber: number;
  submittedCount: number;
  expectedCount: number;
  submissionRatePercent: number;
  lowSubmissionWarning: boolean;
  ungradedCellsCount: number;
  ungradedSessions: number[];
  gradedCellsCount: number;
  redoCellsCount: number;
  notSubmittedCellsCount: number;
  teachingDeclaredBtvnSessions: number[];
  teachingScoredCellsCount: number;
  isOutOfSyncWithTeaching: boolean;
}

export interface AdminSpckSlotAuditItem {
  sessionNumber: 12 | 13 | 14;
  sessionOccurred: boolean;
  requiredCount: number;
  uploadedCount: number;
  commentedCount: number;
  missingUploadStudents: string[];
  missingImageOrLinkStudents: string[];
  missingTeacherCommentStudents: string[];
}

export interface AdminSpckSession14EvalAudit {
  applicable: boolean;
  requiredCount: number;
  demoScoredCount: number;
  competencyCompleteCount: number;
  mindx3PartCommentCount: number;
  missingEvalStudents: string[];
}

export interface AdminSpckAuditSummary {
  applicable: boolean;
  slots: {
    "12": AdminSpckSlotAuditItem;
    "13": AdminSpckSlotAuditItem;
    "14": AdminSpckSlotAuditItem;
  };
  session14FinalEval: AdminSpckSession14EvalAudit;
  totalMissingUploads: number;
  totalMissingMediaOrLinks: number;
  totalMissingTeacherComments: number;
}

export type AdminSpckTaskStatus =
  | "NOT_ELIGIBLE"
  | "MISSING_PROJECT"
  | "INCOMPLETE_TASKS"
  | "NEEDS_STUDENT_ASSIGN"
  | "READY";

export interface AdminSpckTeachingTasksSummary {
  eligibleGt9: boolean;
  hasProject: boolean;
  projectId: number | null;
  projectName: string;
  startDate: string;
  endDate: string;
  taskCount: number;
  totalWeightPercent: number;
  assignedStudentCount: number;
  averageProgressPercent: number;
  targetProgressPercent: number;
  taskStatus: AdminSpckTaskStatus;
}

export type AdminEarlyWarningType =
  | "CONSECUTIVE_ABSENCE"
  | "CONSECUTIVE_MISSING_BTVN"
  | "LOW_CHECKPOINT_SCORE"
  | "ROSTER_MISMATCH"
  | "MAKEUP_DEBT";

export interface AdminEarlyWarningItem {
  type: AdminEarlyWarningType;
  severity: "HIGH" | "MEDIUM";
  studentName?: string;
  detail: string;
}

export interface AdminClassRowDto {
  classCode: string;
  centerCode: string;
  lmsClassId: string;
  courseName: string;
  blockType: AdminBlockType;
  isMakeupClass: boolean;
  status: string;
  startDate: string;
  endDate: string;
  currentSessionNumber: number;
  currentSessionDate: string;
  timeSlot: string;
  mainTeacher: string;
  assistantTeacher: string;
  specialEvent: string;
  activeStudentCount: number;
  teachingStudentCount: number;
  weeklyOps: AdminWeeklyOpsSummary;
  btvnSummary: AdminBtvnCodingSummary;
  spckAudit: AdminSpckAuditSummary;
  spckTasks: AdminSpckTeachingTasksSummary;
  earlyWarnings: AdminEarlyWarningItem[];
  btvnSyncStatus: AdminBtvnSyncStatus;
  btvnSyncedAt: string | null;
  btvnLastError: string | null;
  spckTasksSyncStatus: AdminSpckTasksSyncStatus;
  spckTasksSyncedAt: string | null;
  spckTasksLastError: string | null;
  lastScannedAt: string | null;
  lastError: string | null;
  lmsCommentsUrl: string;
  lmsHomeworkUrl: string;
  teachingScoreBoardUrl: string;
  teachingStudentsUrl: string;
  teachingProgressUrl: string;
}

export interface AdminInstructorSummaryDto {
  instructorName: string;
  totalClasses: number;
  missingWeeklyOpsClasses: number;
  ungradedBtvnTotal: number;
  missingSpckCommentsTotal: number;
  missingSpckTasksClasses: number;
  makeupDebtCount: number;
  zaloReminderText: string;
  classCodes: string[];
}

export interface AdminScanProgressState {
  isRunning: boolean;
  runId: string | null;
  scanScope: string | null;
  totalClasses: number;
  scannedClasses: number;
  currentClassCode: string | null;
  stopAfterCurrentRequested: boolean;
  lastError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface AdminOverviewKpis {
  totalClasses: number;
  runningClasses: number;
  codingClasses: number;
  roboticsClasses: number;
  weeklyOpsIssuesCount: number;
  codingBtvnIssuesCount: number;
  codingUngradedSubmissionsTotal: number;
  spckAuditIssuesCount: number;
  gt9ClassesTotal: number;
  gt9MissingTasksCount: number;
  earlyWarningsTotal: number;
  rosterMismatchClassesCount: number;
  makeupDebtClassesCount: number;
}

export interface AdminCenterOverviewResponse {
  success: boolean;
  centerCode: string;
  hasAdminLmsAuth: boolean;
  adminLmsUsernameMasked: string;
  adminTeachingUsernameMasked: string;
  teachingBaseOrigin: string;
  scanProgress: AdminScanProgressState;
  latestScanRun: {
    runId: string;
    scanScope: string;
    status: string;
    totalClasses: number;
    scannedClasses: number;
    startedAt?: string;
    finishedAt?: string | null;
  } | null;
  kpis: AdminOverviewKpis;
  classes: AdminClassRowDto[];
  instructors: AdminInstructorSummaryDto[];
  campusZaloSummaryText: string;
  makeupRecords: Array<{
    classCode: string;
    studentName: string;
    sessionLabel: string;
    teacher: string;
    status: string;
  }>;
}
