"use client";

export interface ClassOption {
  classId: string;
  className: string;
  currentSessionNumber?: number;
  maxSessionNumber?: number;
  spckSessions?: number[];
  status?: string;
  session14Date?: string;
}

export interface StudentOption {
  studentId: string;
  classId: string;
  fullName: string;
  isActive: number;
}

export interface RelatedLinkItem {
  name: string;
  url: string;
  category?: "LIVE_PRODUCT" | "SOURCE_DOWNLOAD" | "OTHER_DOC";
}

export interface SpckVerifiedSnapshotUI {
  sessionNumber: 12 | 13 | 14;
  stageNumber: 1 | 2;
  stageLabel: string;
  capturedAt: string;
  contentHash: string;
  lmsWorkId?: string | null;
  projectTitle: string;
  baseProjectTitle: string;
  thumbnailPath: string;
  thumbnailSha256: string | null;
  screenshots: Array<{ path: string; sha256: string | null }>;
  attachments: Array<{ path: string; sha256: string | null }>;
  youtubeUrls: string[];
  relatedLinks: RelatedLinkItem[];
  teacherComment: string;
  teacherNote?: string;
}

export interface SpckSessionSlotSummaryUI {
  sessionNumber: 12 | 13 | 14;
  stageLabel: string;
  displayState:
    | "VERIFIED"
    | "VERIFIED_WITH_UNSUBMITTED_EDITS"
    | "VERIFIED_FILE_DRIFT"
    | "FAILED_AFTER_VERIFIED"
    | "FAILED"
    | "ABSENT_EXEMPT"
    | "UNKNOWN_LEGACY"
    | "CORRUPTED"
    | "NOT_SUBMITTED";
  badgeLabel: string;
  attendanceStatus?: "PRESENT" | "ABSENT" | null;
  draftVersion: number;
  hasUnsubmittedDraftChanges: boolean;
  hasFileDrift: boolean;
  driftedFiles: string[];
  lastAttemptStatus: string | null;
  lastAttemptAt: string | null;
  lastErrorMessage: string | null;
  lastVerifiedAt: string | null;
  lastVerifiedContentHash: string;
  lastVerifiedSnapshot: SpckVerifiedSnapshotUI | null;
  lmsWorkId: string | null;
}

export interface SpckStudentSessionHistorySummaryUI {
  classId: string;
  studentId: string;
  hasLegacyUnknownSessionHistory: boolean;
  legacyNote: string | null;
  historyCorrupted: boolean;
  historyCorruptedReason: string | null;
  sessions: Record<"12" | "13" | "14", SpckSessionSlotSummaryUI>;
}

export interface ThumbnailInspectionUI {
  exists: boolean;
  isDefaultMindxLogo: boolean;
  isAppGeneratedShot: boolean;
  isOwnerUploaded: boolean;
  width: number | null;
  height: number | null;
  is16By9: boolean;
  aspectRatioLabel: string;
  badgeLabel: string;
}

export interface SpckSessionSubmissionResultUI {
  sessionNumber: 12 | 13 | 14;
  status: "VERIFIED" | "FAILED";
  submittedContentHash?: string;
  verifiedAt?: string | null;
  lastVerifiedContentHash?: string;
  lastVerifiedAt?: string | null;
  errorMessage?: string | null;
  lastVerifiedSnapshot?: SpckVerifiedSnapshotUI | null;
}

export type SpckSessionResultsMapUI = Partial<
  Record<"12" | "13" | "14", SpckSessionSubmissionResultUI>
>;

export interface SpckBatchSubmissionSummaryUI {
  classId?: string;
  sessionNumber: 12 | 13 | 14;
  completedAt: string;
  totalSelected: number;
  verifiedItems: Array<{ studentId: string; studentName: string }>;
  failedItems: Array<{ studentId: string; studentName: string; reason: string }>;
  skippedItems: Array<{ studentId: string; studentName: string; reason: string }>;
  retryStudentIds: string[];
}

export interface SpckRecordRow {
  classId: string;
  studentId: string;
  localFolderPath: string;
  matchScore: number;
  isConfirmedByTeacher: number;
  projectTitle: string;
  baseProjectTitle?: string;
  thumbnailPath: string;
  screenshotsJson: string;
  attachmentsJson: string;
  youtubeUrlsJson: string;
  relatedLinksJson: string;
  teacherComment: string;
  teacherNote?: string;
  quickTagsJson?: string;
  contentHash: string;
  status:
    | "INSUFFICIENT_INFO"
    | "DRAFT"
    | "WAITING_APPROVAL"
    | "APPROVED"
    | "SAVING"
    | "VERIFIED"
    | "FAILED";
  verifiedAt?: string | null;
  errorMessage?: string | null;
  sessionResultsJson?: string | null;
  draftVersion?: number;
  activeSessionNumber?: 12 | 13 | 14;
  hasNewerSharedResources?: boolean;
  isDefaultProductTitle?: boolean;
  thumbnailInspection?: ThumbnailInspectionUI;
  sessionHistory?: SpckStudentSessionHistorySummaryUI;
}

export interface ScannedFolderUIItem {
  folderName: string;
  folderPath: string;
  assignedStudentId: string;
  matchScore: number;
  requiresManualConfirmation: boolean;
  isConfirmedByTeacher: boolean;
  warningReasons: string[];
  projectTitle: string;
  baseProjectTitle?: string;
  thumbnailPath: string;
  screenshots: string[];
  attachments: string[];
  youtubeUrlsText: string;
  relatedLinksText: string;
  quickTags: string[];
  teacherNote: string;
  includePresentation: boolean;
  teacherComment: string;
  contentHash: string;
  status: SpckRecordRow["status"];
  verifiedAt?: string | null;
  errorMessage?: string | null;
  sessionResults?: SpckSessionResultsMapUI;
  sessionHistory?: SpckStudentSessionHistorySummaryUI;
  draftVersion?: number;
  hasNewerSharedResources?: boolean;
  isDefaultProductTitle?: boolean;
  thumbnailInspection?: ThumbnailInspectionUI;
  isDirty?: boolean;
}

export interface Session14CompetencyScoresUI {
  knowledgeInClass: number;
  knowledgeSelfStudy: number;
  skillCommunication: number;
  skillComputerUse: number;
  skillProblemSolving: number;
  skillCreativity: number;
  skillComputational: number;
  attitudeHomework: number;
  attitudeInClass: number;
}

export interface Session14DemoScoresUI {
  algorithm: number;
  creativity: number;
  communication: number;
  problemSolving: number;
  computerSkills: number;
}

export interface Session14EvalItemUI {
  classId: string;
  studentId: string;
  fullName: string;
  competencyScores: Session14CompetencyScoresUI;
  competencyTotalScore: number;
  demoScores: Session14DemoScoresUI;
  demoTotalScore: number;
  demoSourcePath: string;
  demoJudgeNote: string;
  learnedFromMindx: string;
  suggestionsFromMindx: string;
  futureDirection: string;
  awardRanking?: string;
  quickTags: string[];
  teacherNote: string;
  draftVersion: number;
  status:
    | "DRAFT"
    | "WAITING_APPROVAL"
    | "APPROVED"
    | "VERIFIED"
    | "FAILED"
    | "INSUFFICIENT_INFO";
  contentHash: string;
  verifiedAt?: string | null;
  errorMessage?: string | null;
}

export interface SpckBannerMessageUI {
  type: "success" | "warning" | "error";
  text: string;
}

export interface YoutubeImportReportUI {
  playlists: Array<{ playlistTitle: string; videoCount: number; error?: string }>;
  totalVideos: number;
  appliedCount: number;
  results: Array<{
    videoId: string;
    url: string;
    videoTitle: string;
    extractedName: string;
    studentId: string;
    fullName: string;
    status: string;
    applied: boolean;
    frames: string[];
    thumbnailIsOwnerPhoto?: boolean;
    message?: string;
  }>;
  studentsWithoutVideo: Array<{ studentId: string; fullName: string }>;
  invalidLines: string[];
}

export interface StudentPortalSubmissionUI {
  studentId: string;
  fullName: string;
  filesCount: number;
  driveStatus: string;
  driveFolderUrl?: string;
  driveError?: string;
  submittedAt: string;
}

export interface SpckSlotDisplayUI {
  state:
    | "VERIFIED_CURRENT"
    | "VERIFIED_DRAFT_CHANGED"
    | "VERIFIED_FILE_DRIFT"
    | "FAILED"
    | "ABSENT_EXEMPT"
    | "UNKNOWN_LEGACY"
    | "CORRUPTED"
    | "NOT_SUBMITTED";
  tone: "emerald" | "teal" | "rose" | "amber" | "slate";
  label: string;
  detail: string;
  subLabel?: string;
  verifiedAt?: string | null;
  errorMessage?: string | null;
  hasVerifiedEvidence?: boolean;
  snapshot?: SpckVerifiedSnapshotUI | null;
  driftedFiles?: string[];
  legacyNote?: string | null;
  corruptedReason?: string | null;
}

export interface SpckRowReadinessSummaryUI {
  ready: boolean;
  missingItems: string[];
  missingReasons: string[];
  reusedAssetsNotes: string[];
  isDefaultTitle: boolean;
  isDefaultThumb: boolean;
  thumbName: string;
  thumbAspect: string;
  thumbBadgeLabel: string;
  hasDriveLink: boolean;
  hasLiveWebLink: boolean;
  hasDirectUseLink: boolean;
  hasSourceStorageLink: boolean;
  hasYoutubeLink: boolean;
  classifiedLinks: Array<{
    name: string;
    url: string;
    category: "DIRECT_PRODUCT_USE" | "SOURCE_OR_FILE_STORAGE" | "OTHER_DOC";
    categoryLabel: string;
  }>;
}

export interface SnapshotModalDataUI {
  studentName: string;
  studentId: string;
  sessionNumber: 12 | 13 | 14;
  slot: SpckSlotDisplayUI;
}

export {
  COMPETENCY_ITEMS_UI,
  DEFAULT_SPCK_TAGS,
  DEMO_SCORE_ITEMS_ROBOTICS_UI,
  DEMO_SCORE_ITEMS_UI,
  SESSION14_SPCK_TAGS,
} from "@/lib/spck/spck-ui-helpers";

export type SpckToolErrorKey =
  | "ai"
  | "drive"
  | "web"
  | "screenshot"
  | "youtube"
  | "s14_ai";

export type SpckToolErrorMapUI = Record<
  string,
  Partial<Record<SpckToolErrorKey, string>>
>;

export interface Session14ComboStatusUI {
  classId?: string;
  running: boolean;
  currentPhase: "idle" | "spck" | "eval" | "done";
  spckSummary: SpckBatchSubmissionSummaryUI | null;
  evalVerifiedCount: number;
  evalVerifiedStudentIds?: string[];
  evalFailedCount: number;
  evalRetryStudentIds: string[];
  evalErrorMessage: string | null;
}
