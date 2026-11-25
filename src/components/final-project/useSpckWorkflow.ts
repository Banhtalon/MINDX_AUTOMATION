"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ClassOption,
  DEMO_SCORE_ITEMS_ROBOTICS_UI,
  DEMO_SCORE_ITEMS_UI,
  RelatedLinkItem,
  ScannedFolderUIItem,
  SESSION14_SPCK_TAGS,
  Session14ComboStatusUI,
  Session14DemoScoresUI,
  Session14EvalItemUI,
  SnapshotModalDataUI,
  SpckBannerMessageUI,
  SpckBatchSubmissionSummaryUI,
  SpckRecordRow,
  SpckReportCardChainResultUI,
  SpckRowReadinessSummaryUI,
  SpckSessionResultsMapUI,
  SpckSlotDisplayUI,
  SpckTeachingProgressPushResultUI,
  SpckToolErrorKey,
  SpckToolErrorMapUI,
  StudentOption,
  StudentPortalSubmissionUI,
  YoutubeImportReportUI,
} from "./types";

import {
  DEFAULT_SPCK_THUMBNAIL_DRIVE_URL_UI,
  buildDefaultSession14ClassSummaryText,
  buildRowFromDbRecord,
  classifyUiLinkCategory,
  computeClientFallbackAwardMap,
  extractSession14TagLabelsFromConfig,
  formatAwardBadgeMeta,
  formatUiSessionTitle,
  getDemoScoreItemsForClassUi,
  getRowReadinessSummary,
  getSessionSlotDisplay,
  getStageMeta,
  htmlSummaryToPlainText,
  isDefaultUiProductTitle,
  parseJsonSafe,
  parseRelatedLinksFromText,
  parseSessionResultsMap,
  parseYoutubeUrlsFromText,
  plainTextSummaryToHtml,
  resolveStudentAwardLabel,
  serializeRelatedLinksToText,
  stripUiSessionSuffix,
} from "@/lib/spck/spck-ui-helpers";

export {
  DEFAULT_SPCK_THUMBNAIL_DRIVE_URL_UI,
  buildDefaultSession14ClassSummaryText,
  buildRowFromDbRecord,
  classifyUiLinkCategory,
  computeClientFallbackAwardMap,
  extractSession14TagLabelsFromConfig,
  formatAwardBadgeMeta,
  formatUiSessionTitle,
  getDemoScoreItemsForClassUi,
  getRowReadinessSummary,
  getSessionSlotDisplay,
  getStageMeta,
  htmlSummaryToPlainText,
  isDefaultUiProductTitle,
  parseJsonSafe,
  parseRelatedLinksFromText,
  parseSessionResultsMap,
  parseYoutubeUrlsFromText,
  plainTextSummaryToHtml,
  resolveStudentAwardLabel,
  serializeRelatedLinksToText,
  stripUiSessionSuffix,
};

export function mergePortalRecordIntoUiRow(
  row: ScannedFolderUIItem,
  rec: SpckRecordRow
): ScannedFolderUIItem {
  const relatedLinks = parseJsonSafe<RelatedLinkItem[]>(rec.relatedLinksJson, []);
  const screenshots = parseJsonSafe<string[]>(rec.screenshotsJson, []);
  const attachments = parseJsonSafe<string[]>(rec.attachmentsJson, []);
  const youtubeUrls = parseJsonSafe<string[]>(rec.youtubeUrlsJson, []);

  const nextFolderPath = rec.localFolderPath || row.folderPath;
  const nextThumbnailPath = rec.thumbnailPath || row.thumbnailPath;
  const nextScreenshots = screenshots.length > 0 ? screenshots : row.screenshots;
  const nextAttachments = attachments.length > 0 ? attachments : row.attachments;
  const nextSessionResults =
    parseSessionResultsMap(rec.sessionResultsJson) || row.sessionResults;

  const isNewerDraft =
    typeof rec.draftVersion === "number" &&
    rec.draftVersion > (row.draftVersion || 0);
  const resourcesChangedFromPortal =
    (Boolean(rec.localFolderPath) && rec.localFolderPath !== row.folderPath) ||
    JSON.stringify(nextScreenshots) !== JSON.stringify(row.screenshots) ||
    JSON.stringify(nextAttachments) !== JSON.stringify(row.attachments);

  const isLocallyDirty = Boolean(row.isDirty);

  let nextYoutubeText = row.youtubeUrlsText;
  let nextRelatedLinksText = row.relatedLinksText;

  if (isLocallyDirty) {
    // Preserve 100% of teacher's in-progress link/text edits; only append a newly created Google Drive link if missing
    const newDriveLinks = relatedLinks.filter(
      (l) =>
        l &&
        typeof l.url === "string" &&
        /drive\.google\.com\/drive\/folders\//i.test(l.url) &&
        !row.relatedLinksText.includes(l.url)
    );
    if (newDriveLinks.length > 0) {
      const appended = serializeRelatedLinksToText(newDriveLinks);
      nextRelatedLinksText = row.relatedLinksText.trim()
        ? `${row.relatedLinksText.replace(/\s+$/, "")}\n${appended}`
        : appended;
    }
  } else if (isNewerDraft || resourcesChangedFromPortal) {
    if (youtubeUrls.length > 0) {
      nextYoutubeText = youtubeUrls.join("\n");
    }
    if (relatedLinks.length > 0) {
      nextRelatedLinksText = serializeRelatedLinksToText(relatedLinks);
    }
  } else {
    const newDriveLinks = relatedLinks.filter(
      (l) =>
        l &&
        typeof l.url === "string" &&
        /drive\.google\.com\/drive\/folders\//i.test(l.url) &&
        !row.relatedLinksText.includes(l.url)
    );
    if (newDriveLinks.length > 0) {
      const appended = serializeRelatedLinksToText(newDriveLinks);
      nextRelatedLinksText = row.relatedLinksText.trim()
        ? `${row.relatedLinksText.replace(/\s+$/, "")}\n${appended}`
        : appended;
    }
  }

  // Security invariant (v3.4.1 F05): If the server demoted `isConfirmedByTeacher` to 0
  // (e.g. a new unauthenticated Student Portal upload arrived), NEVER carry over a stale
  // `true` confirmation or approved status/hash from the dirty UI row, while still preserving
  // 100% of the teacher's in-progress text/tag edits.
  const serverUnconfirmed =
    rec.isConfirmedByTeacher !== undefined && Number(rec.isConfirmedByTeacher) === 0;

  const nextConfirmed = serverUnconfirmed
    ? false
    : !isLocallyDirty &&
      (isNewerDraft || resourcesChangedFromPortal) &&
      rec.isConfirmedByTeacher !== undefined
    ? Number(rec.isConfirmedByTeacher) === 1
    : row.isConfirmedByTeacher;

  const nextStatus = serverUnconfirmed
    ? "WAITING_APPROVAL"
    : !isLocallyDirty && (isNewerDraft || resourcesChangedFromPortal)
    ? rec.status || row.status
    : row.status;
  const nextContentHash = serverUnconfirmed
    ? ""
    : !isLocallyDirty && (isNewerDraft || resourcesChangedFromPortal)
    ? rec.contentHash ?? row.contentHash
    : row.contentHash;
  const nextDraftVersion = isNewerDraft ? rec.draftVersion : row.draftVersion;

  const nextHasPortalBackup = Boolean(rec.hasPortalBackup ?? row.hasPortalBackup);

  const rowChanged =
    nextFolderPath !== row.folderPath ||
    nextThumbnailPath !== row.thumbnailPath ||
    nextYoutubeText !== row.youtubeUrlsText ||
    nextRelatedLinksText !== row.relatedLinksText ||
    nextConfirmed !== row.isConfirmedByTeacher ||
    nextStatus !== row.status ||
    nextContentHash !== row.contentHash ||
    nextDraftVersion !== row.draftVersion ||
    nextHasPortalBackup !== Boolean(row.hasPortalBackup) ||
    Boolean(rec.hasNewerSharedResources) !== Boolean(row.hasNewerSharedResources) ||
    JSON.stringify(nextScreenshots) !== JSON.stringify(row.screenshots) ||
    JSON.stringify(nextAttachments) !== JSON.stringify(row.attachments) ||
    JSON.stringify(nextSessionResults) !== JSON.stringify(row.sessionResults);

  if (!rowChanged) {
    return row;
  }

  return {
    ...row,
    folderPath: nextFolderPath,
    thumbnailPath: nextThumbnailPath,
    screenshots: nextScreenshots,
    attachments: nextAttachments,
    youtubeUrlsText: nextYoutubeText,
    relatedLinksText: nextRelatedLinksText,
    isConfirmedByTeacher: nextConfirmed,
    requiresManualConfirmation: !nextConfirmed,
    thumbnailInspection: rec.thumbnailInspection || row.thumbnailInspection,
    sessionResults: nextSessionResults,
    sessionHistory: rec.sessionHistory || row.sessionHistory,
    hasNewerSharedResources: Boolean(rec.hasNewerSharedResources),
    hasPortalBackup: nextHasPortalBackup,
    status: nextStatus,
    contentHash: nextContentHash,
    draftVersion: nextDraftVersion,
  };
}

export interface SpckWorkflowHookParams {
  classes: ClassOption[];
  selectedClassId: string;
  students: StudentOption[];
  folderPathInput: string;
  setFolderPathInput: React.Dispatch<React.SetStateAction<string>>;
  rows: ScannedFolderUIItem[];
  setRows: React.Dispatch<React.SetStateAction<ScannedFolderUIItem[]>>;
  loadingInit: boolean;
  browsingFolder: boolean;
  setBrowsingFolder: React.Dispatch<React.SetStateAction<boolean>>;
  folderModalOpen: boolean;
  setFolderModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  browseCurrentPath: string;
  setBrowseCurrentPath: React.Dispatch<React.SetStateAction<string>>;
  browseParentPath: string | null;
  setBrowseParentPath: React.Dispatch<React.SetStateAction<string | null>>;
  browseDrives: string[];
  setBrowseDrives: React.Dispatch<React.SetStateAction<string[]>>;
  browseQuickLinks: Array<{ label: string; path: string }>;
  setBrowseQuickLinks: React.Dispatch<
    React.SetStateAction<Array<{ label: string; path: string }>>
  >;
  browseDirectories: Array<{ name: string; path: string }>;
  setBrowseDirectories: React.Dispatch<
    React.SetStateAction<Array<{ name: string; path: string }>>
  >;
  browseFilter: string;
  setBrowseFilter: React.Dispatch<React.SetStateAction<string>>;
  scanning: boolean;
  generatingAi: boolean;
  uploading: boolean;
  bannerMessage: SpckBannerMessageUI | null;
  setBannerMessage: React.Dispatch<React.SetStateAction<SpckBannerMessageUI | null>>;
  scanningTeacherClasses: boolean;
  driveFolderUrl: string;
  setDriveFolderUrl: React.Dispatch<React.SetStateAction<string>>;
  uploadingDrive: boolean;
  setUploadingDrive: React.Dispatch<React.SetStateAction<boolean>>;
  webRepoUrl: string;
  setWebRepoUrl: React.Dispatch<React.SetStateAction<string>>;
  deployingWeb: boolean;
  setDeployingWeb: React.Dispatch<React.SetStateAction<boolean>>;
  templateSheetUrl: string;
  setTemplateSheetUrl: React.Dispatch<React.SetStateAction<string>>;
  demoDateInput: string;
  setDemoDateInput: React.Dispatch<React.SetStateAction<string>>;
  demoSheetTitle: string;
  setDemoSheetTitle: React.Dispatch<React.SetStateAction<string>>;
  generatedDemoSheetUrl: string;
  setGeneratedDemoSheetUrl: React.Dispatch<React.SetStateAction<string>>;
  creatingDemoSheet: boolean;
  setCreatingDemoSheet: React.Dispatch<React.SetStateAction<boolean>>;
  capturingScreenshots: boolean;
  setCapturingScreenshots: React.Dispatch<React.SetStateAction<boolean>>;
  showYoutubeImport: boolean;
  setShowYoutubeImport: React.Dispatch<React.SetStateAction<boolean>>;
  youtubeImportInput: string;
  setYoutubeImportInput: React.Dispatch<React.SetStateAction<string>>;
  importingYoutube: boolean;
  youtubeImportReport: YoutubeImportReportUI | null;
  studentPortalRunning: boolean;
  setStudentPortalRunning: React.Dispatch<React.SetStateAction<boolean>>;
  studentPortalShareUrl: string;
  setStudentPortalShareUrl: React.Dispatch<React.SetStateAction<string>>;
  studentPortalLanUrl: string;
  setStudentPortalLanUrl: React.Dispatch<React.SetStateAction<string>>;
  studentPortalLocalUrl: string;
  setStudentPortalLocalUrl: React.Dispatch<React.SetStateAction<string>>;
  studentPortalPublicUrl: string;
  setStudentPortalPublicUrl: React.Dispatch<React.SetStateAction<string>>;
  studentPortalTunnelStatus: string;
  setStudentPortalTunnelStatus: React.Dispatch<React.SetStateAction<string>>;
  studentPortalTunnelProvider: string;
  setStudentPortalTunnelProvider: React.Dispatch<React.SetStateAction<string>>;
  studentPortalAutoDrive: boolean;
  setStudentPortalAutoDrive: React.Dispatch<React.SetStateAction<boolean>>;
  studentPortalSubmissions: StudentPortalSubmissionUI[];
  setStudentPortalSubmissions: React.Dispatch<
    React.SetStateAction<StudentPortalSubmissionUI[]>
  >;
  togglingStudentPortal: boolean;
  setTogglingStudentPortal: React.Dispatch<React.SetStateAction<boolean>>;
  showPortalQr: boolean;
  setShowPortalQr: React.Dispatch<React.SetStateAction<boolean>>;
  selectedSessionNumber: 12 | 13 | 14;
  selectedStudentIds: string[];
  setSelectedStudentIds: React.Dispatch<React.SetStateAction<string[]>>;
  expandedRowKeys: Record<string, boolean>;
  setExpandedRowKeys: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  showOptionalTools: boolean;
  setShowOptionalTools: React.Dispatch<React.SetStateAction<boolean>>;
  showDemoPrepPanel: boolean;
  setShowDemoPrepPanel: React.Dispatch<React.SetStateAction<boolean>>;
  lastSubmissionSummary: SpckBatchSubmissionSummaryUI | null;
  setLastSubmissionSummary: React.Dispatch<
    React.SetStateAction<SpckBatchSubmissionSummaryUI | null>
  >;
  activeActionLabel: string | null;
  snapshotModalData: SnapshotModalDataUI | null;
  setSnapshotModalData: React.Dispatch<React.SetStateAction<SnapshotModalDataUI | null>>;
  session14Evals: Session14EvalItemUI[];
  setSession14Evals: React.Dispatch<React.SetStateAction<Session14EvalItemUI[]>>;
  demoScoreSourceInput: string;
  setDemoScoreSourceInput: React.Dispatch<React.SetStateAction<string>>;
  importingDemoScores: boolean;
  setImportingDemoScores: React.Dispatch<React.SetStateAction<boolean>>;
  generatingS14EvalAi: boolean;
  setGeneratingS14EvalAi: React.Dispatch<React.SetStateAction<boolean>>;
  uploadingS14EvalLms: boolean;
  setUploadingS14EvalLms: React.Dispatch<React.SetStateAction<boolean>>;
  expandedS14EvalIds: Record<string, boolean>;
  setExpandedS14EvalIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  session14TagLabels: string[];
  duplicateStudentIds: Set<string>;
  confirmedReadyStudentIds: string[];
  assignableStudentIds: string[];
  effectiveSelectedStudentIds: string[];
  unsubmittedForActiveSessionStudentIds: string[];
  isAnyOperationBusy: boolean;
  hydrateRowsFromDb: (
    dbRecords: SpckRecordRow[],
    classStudents: StudentOption[],
    activeSessNum?: 12 | 13 | 14
  ) => void;
  loadClassData: (
    targetClassId?: string,
    targetSessionNumber?: 12 | 13 | 14
  ) => Promise<void>;
  handleClassChange: (newClassId: string) => Promise<void>;
  handleScanTeacherClasses: () => Promise<void>;
  handleScanFolder: (
    overrideFolderPath?: string | React.MouseEvent,
    options?: { action?: "init_student_folders" }
  ) => Promise<
    | void
    | {
        success: boolean;
        scannedItems: ScannedFolderUIItem[];
        classId?: string;
        sessionNumber?: 12 | 13 | 14;
      }
  >;
  persistRowDraft: (
    row: ScannedFolderUIItem,
    overrides?: Partial<ScannedFolderUIItem>,
    overrideSessionNumber?: 12 | 13 | 14,
    options?: { autoRetryOnConflict?: boolean; silentErrorBanner?: boolean }
  ) => Promise<boolean>;
  handleSessionChange: (nextSessionNum: 12 | 13 | 14) => Promise<void>;
  handleGenerateAiComments: (targetFolderPaths?: string[]) => Promise<void>;
  handleApproveAndUpload: (
    targetStudentIds: string[],
    autoUploadAfterApprove?: boolean,
    overrideSessionNum?: 12 | 13 | 14 | number
  ) => Promise<SpckBatchSubmissionSummaryUI | null | void>;
  handleImportYoutubeProducts: (
    sourceRows?: ScannedFolderUIItem[]
  ) => Promise<SpckToolStepResult | void>;
  getActiveUiClassId: () => string;
  bumpRowDraftSeq: (rowKey: string) => void;
}

export interface SpckToolStepResult {
  success: boolean;
  updatedRows?: ScannedFolderUIItem[];
  errorSummary?: string;
}

export function formatAutoPrepStepFailure(
  stepName: string,
  errorSummary?: string
): string {
  const detail = String(errorSummary || "").trim();
  return detail ? `${stepName} (${detail})` : stepName;
}

export function formatAutoPrepSummaryBanner(
  totalSteps: number,
  stepFailures: string[]
): string {
  const completedCount = Math.max(0, totalSteps - stepFailures.length);
  return `Đã chạy công cụ tự động sau khi quét (${completedCount}/${totalSteps} bước hoàn tất • Chưa xong: ${stepFailures.join(" | ")}).`;
}

export function useSpckWorkflow(params: SpckWorkflowHookParams) {
  const {
    classes,
    selectedClassId,
    students,
    folderPathInput,
    setFolderPathInput,
    rows,
    setRows,
    loadingInit,
    browsingFolder,
    setBrowsingFolder,
    setFolderModalOpen,
    browseCurrentPath,
    setBrowseCurrentPath,
    setBrowseParentPath,
    setBrowseDrives,
    setBrowseQuickLinks,
    setBrowseDirectories,
    setBrowseFilter,
    scanning,
    generatingAi,
    uploading,
    setBannerMessage,
    scanningTeacherClasses,
    driveFolderUrl,
    uploadingDrive,
    setUploadingDrive,
    webRepoUrl,
    deployingWeb,
    setDeployingWeb,
    templateSheetUrl,
    demoDateInput,
    setDemoDateInput,
    demoSheetTitle,
    setDemoSheetTitle,
    generatedDemoSheetUrl,
    setGeneratedDemoSheetUrl,
    creatingDemoSheet,
    setCreatingDemoSheet,
    capturingScreenshots,
    setCapturingScreenshots,
    setShowYoutubeImport,
    youtubeImportInput,
    importingYoutube,
    studentPortalRunning,
    setStudentPortalRunning,
    setStudentPortalShareUrl,
    setStudentPortalLanUrl,
    setStudentPortalLocalUrl,
    setStudentPortalPublicUrl,
    setStudentPortalTunnelStatus,
    setStudentPortalTunnelProvider,
    studentPortalAutoDrive,
    setStudentPortalAutoDrive,
    setStudentPortalSubmissions,
    setTogglingStudentPortal,
    setShowPortalQr,
    selectedSessionNumber,
    setSelectedStudentIds,
    setExpandedRowKeys,
    setShowOptionalTools,
    lastSubmissionSummary,
    setLastSubmissionSummary,
    activeActionLabel,
    session14Evals,
    setSession14Evals,
    demoScoreSourceInput,
    setDemoScoreSourceInput,
    importingDemoScores,
    setImportingDemoScores,
    generatingS14EvalAi,
    setGeneratingS14EvalAi,
    uploadingS14EvalLms,
    setUploadingS14EvalLms,
    duplicateStudentIds,
    effectiveSelectedStudentIds,
    isAnyOperationBusy: baseIsAnyOperationBusy,
    hydrateRowsFromDb,
    handleScanFolder: baseHandleScanFolder,
    persistRowDraft,
    handleGenerateAiComments: baseHandleGenerateAiComments,
    handleApproveAndUpload: baseHandleApproveAndUpload,
    handleImportYoutubeProducts: baseHandleImportYoutubeProducts,
    getActiveUiClassId,
  } = params;

  const [autoRunToolsAfterScan, setAutoRunToolsAfterScan] = useState<boolean>(true);
  const [autoPrepStepProgress, setAutoPrepStepProgress] = useState<string | null>(
    null
  );
  const [thumbnailDriveFolderUrl, setThumbnailDriveFolderUrlState] =
    useState<string>(DEFAULT_SPCK_THUMBNAIL_DRIVE_URL_UI);
  const [syncingDriveThumbnails, setSyncingDriveThumbnails] =
    useState<boolean>(false);
  const [refreshingStudentId, setRefreshingStudentId] = useState<string | null>(
    null
  );
  const [restoringBackupStudentId, setRestoringBackupStudentId] = useState<
    string | null
  >(null);
  const [toolErrorsByStudent, setToolErrorsByStudent] =
    useState<SpckToolErrorMapUI>({});
  const [expandedRowTabByStudent, setExpandedRowTabByStudent] = useState<
    Record<string, "spck" | "eval14">
  >({});
  const [showAdvancedTools, setShowAdvancedTools] = useState<boolean>(false);
  const [showFolderEditor, setShowFolderEditor] = useState<boolean>(false);
  const [session14ClassSummaryText, setSession14ClassSummaryText] =
    useState<string>("");
  const [session14ClassSummaryRawHtml, setSession14ClassSummaryRawHtml] =
    useState<string>("");
  const [session14ClassSummaryDirty, setSession14ClassSummaryDirty] =
    useState<boolean>(false);
  const [showSession14SummaryBox, setShowSession14SummaryBox] =
    useState<boolean>(false);
  const [mainSyncRunning, setMainSyncRunning] = useState<boolean>(false);
  const [mainStep3Running, setMainStep3Running] = useState<boolean>(false);
  const [mainStep3PhaseLabel, setMainStep3PhaseLabel] = useState<string | null>(
    null
  );
  const [teachingProgressPushState, setTeachingProgressPushState] =
    useState<SpckTeachingProgressPushResultUI>({
      status: "IDLE",
      targetPercent: null,
      updatedCount: null,
      message: null,
    });
  const [reportCardChainState, setReportCardChainState] =
    useState<SpckReportCardChainResultUI>({
      status: "IDLE",
      syncedScoreCount: null,
      matchedStudentCount: null,
      skippedStudentCount: null,
      warningMessage: null,
    });
  const [skippedUnreadyByStudent, setSkippedUnreadyByStudent] = useState<
    Record<string, string>
  >({});
  const [session14ComboStatus, setSession14ComboStatus] =
    useState<Session14ComboStatusUI>({
      classId: selectedClassId,
      running: false,
      currentPhase: "idle",
      spckSummary: null,
      evalVerifiedCount: 0,
      evalVerifiedStudentIds: [],
      evalFailedCount: 0,
      evalRetryStudentIds: [],
      evalErrorMessage: null,
      classSummaryVerified: false,
      teachingProgressResult: null,
      reportCardResult: null,
    });
  const autoImportedDemoClassKeysRef = useRef<Set<string>>(new Set());
  const portalKnownStateVersionRef = useRef<{
    classId: string;
    sessionNumber: number;
    stateVersion: number;
  } | null>(null);
  const portalLastCheckedTargetRef = useRef<{
    classId: string;
    sessionNumber: number;
  } | null>(null);
  const portalInFlightByTargetRef = useRef<
    Map<
      string,
      {
        promise: Promise<any>;
        controller: AbortController;
        subscribers: number;
      }
    >
  >(new Map());
  const portalMutationSeqRef = useRef<number>(0);
  const portalActivePostControllerRef = useRef<AbortController | null>(null);
  const latestSelectedClassIdRef = useRef<string>(selectedClassId);
  latestSelectedClassIdRef.current = selectedClassId;
  const latestSelectedSessionRef = useRef<12 | 13 | 14>(selectedSessionNumber);
  latestSelectedSessionRef.current = selectedSessionNumber;
  const latestStudentsRef = useRef<StudentOption[]>(students);
  latestStudentsRef.current = students;
  const latestGetActiveUiClassIdRef = useRef(getActiveUiClassId);
  latestGetActiveUiClassIdRef.current = getActiveUiClassId;

  const isCurrentPortalUiClassMatch = useCallback((expectedClassUpper: string): boolean => {
    const activeUi = String(latestGetActiveUiClassIdRef.current() || "")
      .trim()
      .toUpperCase();
    const renderedUi = String(latestSelectedClassIdRef.current || "")
      .trim()
      .toUpperCase();
    if (activeUi && activeUi !== expectedClassUpper) return false;
    if (renderedUi && renderedUi !== expectedClassUpper) return false;
    return true;
  }, []);

  useEffect(() => {
    if (portalActivePostControllerRef.current) {
      portalActivePostControllerRef.current.abort();
      portalActivePostControllerRef.current = null;
    }
    portalMutationSeqRef.current += 1;
    setTogglingStudentPortal(false);
    for (const [key, entry] of portalInFlightByTargetRef.current.entries()) {
      if (!key.startsWith(`${String(selectedClassId || "").trim().toUpperCase()}::`)) {
        entry.controller.abort();
        portalInFlightByTargetRef.current.delete(key);
      }
    }
  }, [selectedClassId, setTogglingStudentPortal]);

  useEffect(() => {
    setSession14ClassSummaryText("");
    setSession14ClassSummaryRawHtml("");
    setSession14ClassSummaryDirty(false);
    setShowSession14SummaryBox(false);
    setShowFolderEditor(false);
    setSkippedUnreadyByStudent({});
  }, [selectedClassId]);

  useEffect(() => {
    setSkippedUnreadyByStudent({});
    setTeachingProgressPushState({
      status: "IDLE",
      targetPercent: null,
      updatedCount: null,
      message: null,
    });
    setReportCardChainState({
      status: "IDLE",
      syncedScoreCount: null,
      matchedStudentCount: null,
      skippedStudentCount: null,
      warningMessage: null,
    });
    setSession14ComboStatus({
      classId: selectedClassId,
      running: false,
      currentPhase: "idle",
      spckSummary: null,
      evalVerifiedCount: 0,
      evalVerifiedStudentIds: [],
      evalFailedCount: 0,
      evalRetryStudentIds: [],
      evalErrorMessage: null,
      classSummaryVerified: false,
      teachingProgressResult: null,
      reportCardResult: null,
    });
    setLastSubmissionSummary((prev) =>
      prev &&
      prev.sessionNumber === selectedSessionNumber &&
      (!prev.classId || prev.classId === selectedClassId)
        ? prev
        : null
    );
  }, [selectedClassId, selectedSessionNumber, setLastSubmissionSummary]);

  useEffect(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const stored = window.localStorage.getItem(
          "mindx_spck_auto_prep_after_scan"
        );
        if (stored === "false") {
          setAutoRunToolsAfterScan(false);
        } else if (stored === "true") {
          setAutoRunToolsAfterScan(true);
        }
        const storedThumbDrive = window.localStorage.getItem(
          "mindx_spck_thumb_drive_url"
        );
        if (storedThumbDrive && storedThumbDrive.trim()) {
          setThumbnailDriveFolderUrlState(storedThumbDrive.trim());
        }
      }
    } catch {}
  }, []);

  const setThumbnailDriveFolderUrl = useCallback((nextUrl: string) => {
    setThumbnailDriveFolderUrlState(nextUrl);
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const trimmed = nextUrl.trim();
        if (trimmed) {
          window.localStorage.setItem("mindx_spck_thumb_drive_url", trimmed);
        } else {
          window.localStorage.removeItem("mindx_spck_thumb_drive_url");
        }
      }
    } catch {}
  }, []);

  const handleToggleAutoRunToolsAfterScan = useCallback((enabled: boolean) => {
    setAutoRunToolsAfterScan(enabled);
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(
          "mindx_spck_auto_prep_after_scan",
          enabled ? "true" : "false"
        );
      }
    } catch {}
  }, []);

  const setStudentToolError = useCallback(
    (studentId: string, toolKey: SpckToolErrorKey, errMsg: string | null) => {
      if (!studentId) return;
      setToolErrorsByStudent((prev) => {
        const current = { ...(prev[studentId] || {}) };
        if (errMsg) {
          current[toolKey] = errMsg;
        } else {
          delete current[toolKey];
        }
        return {
          ...prev,
          [studentId]: current,
        };
      });
    },
    []
  );

  const setRowActiveTab = useCallback(
    (studentId: string, tab: "spck" | "eval14") => {
      if (!studentId) return;
      setExpandedRowTabByStudent((prev) => ({
        ...prev,
        [studentId]: tab,
      }));
    },
    []
  );

  const confirmBeforeDemotingApprovedRows = useCallback(
    (
      targetStudentIds?: string[],
      sourceRows?: ScannedFolderUIItem[]
    ): boolean => {
      const list = sourceRows || rows;
      const targetSet =
        targetStudentIds && targetStudentIds.length > 0
          ? new Set(targetStudentIds)
          : null;
      const approvedRows = list.filter((r) => {
        if (!r.assignedStudentId) return false;
        if (targetSet && !targetSet.has(r.assignedStudentId)) return false;
        const slot = getSessionSlotDisplay(r, selectedSessionNumber);
        return (
          r.status === "APPROVED" ||
          r.status === "VERIFIED" ||
          slot.state === "VERIFIED_CURRENT"
        );
      });
      if (approvedRows.length === 0) return true;
      if (typeof window !== "undefined" && typeof window.confirm === "function") {
        return window.confirm(
          `Bài của ${approvedRows.length} bạn sẽ phải duyệt lại, tiếp tục?`
        );
      }
      return true;
    },
    [rows, selectedSessionNumber]
  );

  const isAnyOperationBusy =
    baseIsAnyOperationBusy ||
    syncingDriveThumbnails ||
    mainSyncRunning ||
    mainStep3Running ||
    Boolean(autoPrepStepProgress) ||
    Boolean(refreshingStudentId) ||
    Boolean(restoringBackupStudentId) ||
    session14ComboStatus.running;

  const activeStudentIdSet = useMemo(() => {
    const activeIds = (students || [])
      .filter((s) => s && s.isActive !== 0 && Boolean(s.studentId))
      .map((s) => s.studentId);
    if (activeIds.length > 0) {
      return new Set<string>(activeIds);
    }
    return new Set<string>(
      (rows || []).map((r) => r.assignedStudentId).filter(Boolean)
    );
  }, [students, rows]);

  const session14AwardMap = useMemo(
    () => computeClientFallbackAwardMap(session14Evals, activeStudentIdSet),
    [session14Evals, activeStudentIdSet]
  );

  const session14DirtyRef = useRef<boolean>(false);
  session14DirtyRef.current = session14ClassSummaryDirty;

  const hydrateClassSummaryFromPayload = useCallback(
    (
      payload: any,
      targetClassId: string,
      evalRecords?: Session14EvalItemUI[],
      options?: { autoShowBox?: boolean; forceRefresh?: boolean }
    ) => {
      let srvHtml = "";
      let srvText = "";
      const rawSummary =
        payload?.classSummary ??
        payload?.importResult?.classSummary ??
        payload?.summary;
      if (typeof rawSummary === "string" && rawSummary.trim()) {
        if (/<[a-z][\s\S]*>/i.test(rawSummary)) {
          srvHtml = rawSummary.trim();
          srvText = htmlSummaryToPlainText(srvHtml);
        } else {
          srvText = rawSummary.trim();
        }
      } else if (rawSummary && typeof rawSummary === "object") {
        if (
          typeof rawSummary.summaryHtml === "string" &&
          rawSummary.summaryHtml.trim()
        ) {
          srvHtml = rawSummary.summaryHtml.trim();
        } else if (
          typeof rawSummary.html === "string" &&
          rawSummary.html.trim()
        ) {
          srvHtml = rawSummary.html.trim();
        } else if (
          typeof rawSummary.classSummaryHtml === "string" &&
          rawSummary.classSummaryHtml.trim()
        ) {
          srvHtml = rawSummary.classSummaryHtml.trim();
        }
        if (
          typeof rawSummary.bodyText === "string" &&
          rawSummary.bodyText.trim()
        ) {
          const titlePrefix =
            typeof rawSummary.title === "string" &&
            rawSummary.title.trim() &&
            !rawSummary.bodyText.includes(rawSummary.title.trim())
              ? `${rawSummary.title.trim()}\n`
              : "";
          srvText = `${titlePrefix}${rawSummary.bodyText.trim()}`;
        } else if (
          typeof rawSummary.text === "string" &&
          rawSummary.text.trim()
        ) {
          srvText = rawSummary.text.trim();
        } else if (
          typeof rawSummary.plainText === "string" &&
          rawSummary.plainText.trim()
        ) {
          srvText = rawSummary.plainText.trim();
        }
      }
      if (!srvHtml && typeof payload?.classSummaryHtml === "string") {
        srvHtml = payload.classSummaryHtml.trim();
      }
      if (
        !srvHtml &&
        typeof payload?.importResult?.classSummaryHtml === "string"
      ) {
        srvHtml = payload.importResult.classSummaryHtml.trim();
      }
      if (!srvText && typeof payload?.classSummaryText === "string") {
        srvText = payload.classSummaryText.trim();
      }
      if (!srvText && srvHtml) {
        srvText = htmlSummaryToPlainText(srvHtml);
      }

      if (!session14DirtyRef.current || options?.forceRefresh) {
        if (srvText || srvHtml) {
          const resolvedText = srvText || htmlSummaryToPlainText(srvHtml);
          setSession14ClassSummaryText(resolvedText);
          setSession14ClassSummaryRawHtml(
            srvHtml || plainTextSummaryToHtml(resolvedText)
          );
          if (options?.forceRefresh) {
            setSession14ClassSummaryDirty(false);
          }
        } else if (Array.isArray(evalRecords) && evalRecords.length > 0) {
          const fallbackText = buildDefaultSession14ClassSummaryText(
            targetClassId,
            evalRecords,
            activeStudentIdSet
          );
          if (fallbackText) {
            setSession14ClassSummaryText((prev) => prev || fallbackText);
            setSession14ClassSummaryRawHtml((prev) =>
              prev || plainTextSummaryToHtml(fallbackText)
            );
          }
        }
      }
      if (options?.autoShowBox) {
        setShowSession14SummaryBox(true);
      }
    },
    [activeStudentIdSet]
  );

  const enrichEvalRecordsWithAwards = useCallback(
    (rawRecords: any[], payload?: any): Session14EvalItemUI[] => {
      const awardByStudent = new Map<
        string,
        { awardLabel?: string; awardRank?: string | number | null; raw3dp?: number }
      >();
      const rankLists = [
        payload?.rankings,
        payload?.awardRankings,
        payload?.importResult?.rankings,
        payload?.importResult?.awardRankings,
        payload?.classSummary?.awardRankings,
      ];
      for (const list of rankLists) {
        if (Array.isArray(list)) {
          for (const item of list) {
            const sid = String(item?.studentId || "").trim();
            const lbl = String(
              item?.awardLabel ||
                item?.rankLabel ||
                (typeof item?.awardRank === "string" &&
                !/^\d+$/.test(item.awardRank.trim())
                  ? item.awardRank
                  : "")
            ).trim();
            const rk = item?.awardRank ?? null;
            const raw3 =
              typeof item?.demoRawTotalScore === "number"
                ? item.demoRawTotalScore
                : typeof item?.rawScore3dp === "number"
                ? item.rawScore3dp
                : typeof item?.demoRawScore3dp === "number"
                ? item.demoRawScore3dp
                : undefined;
            if (sid && (lbl || rk !== null || raw3 !== undefined)) {
              awardByStudent.set(sid, {
                awardLabel: lbl || undefined,
                awardRank: rk,
                raw3dp: raw3,
              });
            }
          }
        } else if (list && typeof list === "object") {
          for (const [sid, val] of Object.entries(list)) {
            if (typeof val === "string" && val.trim()) {
              awardByStudent.set(sid, { awardLabel: val.trim() });
            } else if (val && typeof val === "object") {
              const obj = val as any;
              awardByStudent.set(sid, {
                awardLabel: String(
                  obj.awardLabel || obj.label || obj.awardRank || ""
                ).trim(),
                raw3dp:
                  typeof obj.demoRawTotalScore === "number"
                    ? obj.demoRawTotalScore
                    : typeof obj.rawScore3dp === "number"
                    ? obj.rawScore3dp
                    : undefined,
              });
            }
          }
        }
      }

      return rawRecords.map((rec: any) => {
        const extra = awardByStudent.get(String(rec?.studentId || ""));
        const resolvedLabel = String(
          rec?.awardLabel ||
            extra?.awardLabel ||
            (typeof rec?.awardRank === "string" &&
            !/^\d+$/.test(rec.awardRank.trim())
              ? rec.awardRank
              : "") ||
            rec?.demoAwardRank ||
            ""
        ).trim();
        const resolvedRank = rec?.awardRank ?? extra?.awardRank;
        const resolvedRaw3dp =
          typeof rec?.demoRawTotalScore === "number"
            ? rec.demoRawTotalScore
            : typeof rec?.demoRawScore3dp === "number"
            ? rec.demoRawScore3dp
            : typeof rec?.rawScore3dp === "number"
            ? rec.rawScore3dp
            : extra?.raw3dp;
        return {
          ...rec,
          ...(resolvedLabel ? { awardLabel: resolvedLabel } : {}),
          ...(resolvedRank !== undefined && resolvedRank !== null
            ? { awardRank: resolvedRank }
            : {}),
          ...(resolvedRaw3dp !== undefined
            ? {
                demoRawTotalScore: resolvedRaw3dp,
                demoRawScore3dp: resolvedRaw3dp,
              }
            : {}),
        };
      });
    },
    []
  );

  const handleUpdateSession14ClassSummaryText = useCallback((nextText: string) => {
    setSession14ClassSummaryText(nextText);
    setSession14ClassSummaryRawHtml(plainTextSummaryToHtml(nextText));
    setSession14ClassSummaryDirty(true);
  }, []);

  const handlePersistSession14ClassSummary = useCallback(
    async (overrideText?: string, approve = false) => {
      const reqClassId = String(selectedClassId || "").trim().toUpperCase();
      if (!reqClassId) return;
      const textToSave =
        overrideText !== undefined ? overrideText : session14ClassSummaryText;
      try {
        const res = await fetch("/api/spck/session14-eval", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save_class_summary",
            classId: reqClassId,
            bodyText: textToSave,
            summaryHtml: plainTextSummaryToHtml(textToSave),
            approve,
          }),
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.success && data?.classSummary?.summaryHtml) {
          setSession14ClassSummaryRawHtml(String(data.classSummary.summaryHtml));
          setSession14ClassSummaryDirty(false);
        }
      } catch {}
    },
    [selectedClassId, session14ClassSummaryText]
  );

  const handleResetSession14ClassSummary = useCallback(async () => {
    const reqClassId = String(selectedClassId || "").trim().toUpperCase();
    if (!reqClassId) return;
    try {
      const res = await fetch("/api/spck/session14-eval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reset_class_summary",
          classId: reqClassId,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && data?.classSummary) {
        hydrateClassSummaryFromPayload(data, reqClassId, session14Evals, {
          forceRefresh: true,
          autoShowBox: true,
        });
        return;
      }
    } catch {}
    const fallback = buildDefaultSession14ClassSummaryText(
      selectedClassId,
      session14Evals,
      activeStudentIdSet
    );
    handleUpdateSession14ClassSummaryText(fallback);
  }, [
    selectedClassId,
    session14Evals,
    activeStudentIdSet,
    hydrateClassSummaryFromPayload,
    handleUpdateSession14ClassSummaryText,
  ]);

  const getEffectiveClassSummaryHtml = useCallback((): string => {
    if (session14ClassSummaryDirty) {
      return plainTextSummaryToHtml(session14ClassSummaryText);
    }
    if (session14ClassSummaryRawHtml.trim()) {
      return session14ClassSummaryRawHtml.trim();
    }
    if (session14ClassSummaryText.trim()) {
      return plainTextSummaryToHtml(session14ClassSummaryText);
    }
    const fallbackText = buildDefaultSession14ClassSummaryText(
      selectedClassId,
      session14Evals,
      activeStudentIdSet
    );
    return plainTextSummaryToHtml(fallbackText);
  }, [
    session14ClassSummaryDirty,
    session14ClassSummaryRawHtml,
    session14ClassSummaryText,
    selectedClassId,
    session14Evals,
    activeStudentIdSet,
  ]);

  const loadBrowseDirectory = async (targetPath?: string) => {
    setBrowsingFolder(true);
    try {
      const res = await fetch("/api/spck/browse-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "list",
          path: targetPath ?? folderPathInput.trim(),
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setBannerMessage({
          type: "error",
          text: data.error || "Không thể đọc danh sách thư mục.",
        });
        return;
      }
      setBrowseCurrentPath(data.currentPath || "");
      setBrowseParentPath(data.parentPath || null);
      setBrowseDrives(data.drives || []);
      setBrowseQuickLinks(data.quickLinks || []);
      setBrowseDirectories(data.directories || []);
      setBrowseFilter("");
      setFolderModalOpen(true);
    } catch (err) {
      setBannerMessage({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBrowsingFolder(false);
    }
  };

  const handleBrowseFolder = async () => {
    setBannerMessage(null);
    await loadBrowseDirectory(folderPathInput.trim() || browseCurrentPath);
  };

  const handleConfirmBrowseSelection = async (chosenPath: string) => {
    if (!chosenPath.trim()) return;
    setBrowsingFolder(true);
    try {
      const res = await fetch("/api/spck/browse-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "select",
          folderPath: chosenPath.trim(),
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setBannerMessage({
          type: "error",
          text: data.error || "Không thể chọn thư mục này.",
        });
        return;
      }
      const finalPath = data.folderPath || chosenPath.trim();
      setFolderPathInput(finalPath);
      setFolderModalOpen(false);
      if (selectedClassId) {
        await handleScanFolder(finalPath);
      } else {
        setBannerMessage({
          type: "success",
          text: `Đã chọn thư mục '${finalPath}'. Vui lòng chọn Lớp học ở mục (1) rồi bấm 'Quét & Khớp Thư Mục Học Viên'.`,
        });
      }
    } catch (err) {
      setBannerMessage({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBrowsingFolder(false);
    }
  };

  const handleSyncLatestResources = async (
    row: ScannedFolderUIItem,
    options?: { skipApprovalConfirm?: boolean }
  ) => {
    if (!selectedClassId || !row.assignedStudentId) return;
    if (
      !options?.skipApprovalConfirm &&
      !confirmBeforeDemotingApprovedRows([row.assignedStudentId])
    ) {
      return;
    }
    try {
      const res = await fetch("/api/spck/save-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: selectedClassId,
          studentId: row.assignedStudentId,
          sessionNumber: selectedSessionNumber,
          expectedVersion: row.draftVersion,
          action: "sync_latest_resources",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setBannerMessage({
          type: "error",
          text:
            data?.error ||
            "Không thể đồng bộ tài nguyên mới nhất cho buổi học hiện tại.",
        });
        return;
      }
      const rec: SpckRecordRow | undefined = data.record;
      if (rec) {
        const screenshots = parseJsonSafe<string[]>(rec.screenshotsJson, []);
        const attachments = parseJsonSafe<string[]>(rec.attachmentsJson, []);
        const youtubeUrls = parseJsonSafe<string[]>(rec.youtubeUrlsJson, []);
        const relatedLinks = parseJsonSafe<RelatedLinkItem[]>(
          rec.relatedLinksJson,
          []
        );
        setRows((prev) =>
          prev.map((r) =>
            r.assignedStudentId === row.assignedStudentId
              ? {
                  ...r,
                  thumbnailPath: rec.thumbnailPath || r.thumbnailPath,
                  screenshots,
                  attachments,
                  youtubeUrlsText: youtubeUrls.join("\n"),
                  relatedLinksText: serializeRelatedLinksToText(relatedLinks),
                  status: rec.status || "WAITING_APPROVAL",
                  contentHash: rec.contentHash || "",
                  draftVersion:
                    data.sessionDraft?.draftVersion ?? rec.draftVersion ?? r.draftVersion,
                  hasNewerSharedResources: false,
                  thumbnailInspection: rec.thumbnailInspection || r.thumbnailInspection,
                  sessionHistory: rec.sessionHistory || r.sessionHistory,
                  isDirty: false,
                }
              : r
          )
        );
      }
      setBannerMessage({
        type: "success",
        text: `Đã cập nhật tài nguyên mới nhất (ảnh bìa, ảnh bổ sung, file, đường dẫn) vào bản nháp Buổi ${selectedSessionNumber} của '${row.folderName}'!`,
      });
    } catch (err) {
      setBannerMessage({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleUploadToGoogleDrive = async (
    targetStudentIds?: string[],
    options?: {
      skipApprovalConfirm?: boolean;
      sourceRows?: ScannedFolderUIItem[];
      classIdOverride?: string;
      sessionOverride?: 12 | 13 | 14;
    }
  ): Promise<{
    success: boolean;
    updatedRows: ScannedFolderUIItem[];
    errorSummary?: string;
  } | void> => {
    const requestClassId = options?.classIdOverride || selectedClassId;
    const requestSessionNum = options?.sessionOverride || selectedSessionNumber;
    const activeRows = options?.sourceRows || rows;
    if (!requestClassId) {
      setBannerMessage({
        type: "warning",
        text: "Vui lòng chọn Lớp học trước khi tải sản phẩm lên Google Drive.",
      });
      return {
        success: false,
        updatedRows: activeRows,
        errorSummary: "Chưa chọn Lớp học",
      };
    }

    const idsToUpload =
      targetStudentIds && targetStudentIds.length > 0
        ? targetStudentIds
        : activeRows
            .filter((r) => r.assignedStudentId && r.folderPath)
            .map((r) => r.assignedStudentId);

    if (idsToUpload.length === 0) {
      setBannerMessage({
        type: "warning",
        text: "Chưa có học viên nào có thư mục sản phẩm trên máy tính để tải lên Google Drive.",
      });
      return {
        success: false,
        updatedRows: activeRows,
        errorSummary: "Chưa có thư mục sản phẩm trên máy tính",
      };
    }

    if (
      !options?.skipApprovalConfirm &&
      !confirmBeforeDemotingApprovedRows(idsToUpload, activeRows)
    ) {
      return {
        success: false,
        updatedRows: activeRows,
        errorSummary: "Đã hủy xác nhận trước khi tải lên",
      };
    }

    setUploadingDrive(true);
    setBannerMessage({
      type: "warning",
      text: `Đang mở Google Drive để tạo thư mục cho ${idsToUpload.length} học viên và tải sản phẩm lên... (Nếu lần đầu chưa đăng nhập Google trên trình duyệt Bot, vui lòng đăng nhập trực tiếp trên cửa sổ Chrome của Bot)`,
    });

    const flushedRows = [...activeRows];
    const effectiveIdsToUpload: string[] = [];
    try {
      for (let idx = 0; idx < flushedRows.length; idx++) {
        const row = flushedRows[idx];
        if (idsToUpload.includes(row.assignedStudentId)) {
          const saved: any = await persistRowDraft(
            row,
            undefined,
            requestSessionNum,
            {
              autoRetryOnConflict: true,
              silentErrorBanner: idsToUpload.length > 1,
            }
          );
          const activeClass = getActiveUiClassId();
          if (activeClass && activeClass !== requestClassId) {
            return {
              success: false,
              updatedRows: flushedRows,
              errorSummary: "Đã chuyển sang lớp học khác",
            };
          }
          if (!saved) {
            const errMsg = `Lưu bản nháp cho học viên '${row.folderName || row.assignedStudentId}' thất bại trước khi tải lên Google Drive.`;
            setStudentToolError(row.assignedStudentId, "drive", errMsg);
            if (idsToUpload.length === 1) {
              setBannerMessage({
                type: "error",
                text: errMsg,
              });
              return {
                success: false,
                updatedRows: flushedRows,
                errorSummary: errMsg,
              };
            }
            continue;
          }
          effectiveIdsToUpload.push(row.assignedStudentId);
          if (typeof saved === "object" && saved.row) {
            flushedRows[idx] = saved.row;
          } else if (typeof saved === "object" && typeof saved.draftVersion === "number") {
            flushedRows[idx] = {
              ...row,
              draftVersion: saved.draftVersion,
              isDirty: false,
            };
          }
        }
      }

      if (effectiveIdsToUpload.length === 0) {
        const errMsg = "Không thể lưu bản nháp cho các học viên trước khi tải lên Google Drive.";
        setBannerMessage({ type: "error", text: errMsg });
        return {
          success: false,
          updatedRows: flushedRows,
          errorSummary: errMsg,
        };
      }

      const res = await fetch("/api/spck/upload-drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: requestClassId,
          sessionNumber: requestSessionNum,
          driveFolderUrl: driveFolderUrl.trim(),
          studentIds: effectiveIdsToUpload,
          syncActiveSession: true,
        }),
      });
      const data = await res.json();
      const activeClass = getActiveUiClassId();
      if (activeClass && activeClass !== requestClassId) {
        return {
          success: false,
          updatedRows: flushedRows,
          errorSummary: "Đã chuyển sang lớp học khác",
        };
      }

      if (!data.success) {
        const errSummary =
          data.error || "Lỗi khi tải sản phẩm lên Google Drive.";
        for (const sid of idsToUpload) {
          setStudentToolError(sid, "drive", errSummary);
        }
        setBannerMessage({
          type: "error",
          text: errSummary,
        });
        return {
          success: false,
          updatedRows: flushedRows,
          errorSummary: errSummary,
        };
      }

      const dbByStu = new Map<string, SpckRecordRow>(
        (data.records || [])
          .filter((r: SpckRecordRow) => !r.classId || r.classId === requestClassId)
          .map((r: SpckRecordRow) => [r.studentId, r])
      );

      const mergeDriveRecords = (baseList: ScannedFolderUIItem[]): ScannedFolderUIItem[] =>
        baseList.map((row) => {
          const rec = dbByStu.get(row.assignedStudentId);
          if (!rec) return row;
          const relatedLinks = parseJsonSafe<RelatedLinkItem[]>(rec.relatedLinksJson, []);
          return {
            ...row,
            relatedLinksText: serializeRelatedLinksToText(relatedLinks),
            status: rec.status || "WAITING_APPROVAL",
            contentHash: rec.contentHash || "",
            verifiedAt: rec.verifiedAt,
            errorMessage: rec.errorMessage,
            draftVersion: rec.draftVersion ?? row.draftVersion,
            hasNewerSharedResources: Boolean(rec.hasNewerSharedResources),
            thumbnailInspection: rec.thumbnailInspection || row.thumbnailInspection,
            sessionResults:
              parseSessionResultsMap(rec.sessionResultsJson) || row.sessionResults,
            sessionHistory: rec.sessionHistory || row.sessionHistory,
            hasPortalBackup: Boolean(rec.hasPortalBackup ?? row.hasPortalBackup),
            folderContentChanged: false,
            isDirty: false,
          };
        });

      const nextRows = mergeDriveRecords(flushedRows);
      setRows((prev) => mergeDriveRecords(prev));

      const dResult = data.driveResult;
      if (Array.isArray(dResult?.results)) {
        for (const item of dResult.results) {
          if (!item?.studentId) continue;
          if (item.status === "FAILED") {
            setStudentToolError(
              item.studentId,
              "drive",
              item.errorMessage || "Lỗi tải lên Google Drive."
            );
          } else {
            setStudentToolError(item.studentId, "drive", null);
          }
        }
      } else {
        for (const sid of idsToUpload) {
          setStudentToolError(sid, "drive", null);
        }
      }
      const failedCount = dResult?.failedStudentsCount || 0;
      const firstErr = dResult?.results?.find((r: any) => r.status === "FAILED")
        ?.errorMessage;
      const hasNewerCount = (data.records || []).filter(
        (r: SpckRecordRow) => r.hasNewerSharedResources
      ).length;
      setBannerMessage({
        type: failedCount > 0 ? "warning" : "success",
        text:
          failedCount > 0
            ? `Đã tải lên Google Drive cho ${dResult?.uploadedStudentsCount || 0}/${dResult?.totalRequested || 0} học viên (Lỗi: ${failedCount}${firstErr ? ` — ${firstErr}` : ""}).`
            : `Đã tạo thư mục Google Drive và gắn Link vào bản nháp cho ${dResult?.uploadedStudentsCount || 0}/${dResult?.totalRequested || 0} học viên!${
                hasNewerCount > 0
                  ? ` Bấm "Dùng tài nguyên mới nhất" ở học viên cần cập nhật vào bản nháp Buổi ${requestSessionNum}.`
                  : ""
              }`,
      });
      const driveErrorSummary =
        failedCount > 0
          ? `${failedCount}/${dResult?.totalRequested || idsToUpload.length} học viên lỗi${firstErr ? `: ${firstErr}` : ""}`
          : undefined;
      return {
        success: failedCount === 0,
        updatedRows: nextRows,
        ...(driveErrorSummary ? { errorSummary: driveErrorSummary } : {}),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const activeClass = getActiveUiClassId();
      if (!activeClass || activeClass === requestClassId) {
        for (const sid of idsToUpload) {
          setStudentToolError(sid, "drive", msg);
        }
        setBannerMessage({
          type: "error",
          text: msg,
        });
      }
      return {
        success: false,
        updatedRows: flushedRows,
        errorSummary:
          activeClass && activeClass !== requestClassId
            ? "Đã chuyển sang lớp học khác"
            : msg || "Lỗi không xác định khi tải Google Drive",
      };
    } finally {
      setUploadingDrive(false);
    }
  };

  const handleDeployWebToGithubPages = async (
    targetStudentIds?: string[],
    options?: {
      skipApprovalConfirm?: boolean;
      sourceRows?: ScannedFolderUIItem[];
      classIdOverride?: string;
      sessionOverride?: 12 | 13 | 14;
    }
  ): Promise<{
    success: boolean;
    updatedRows: ScannedFolderUIItem[];
    errorSummary?: string;
  } | void> => {
    const requestClassId = options?.classIdOverride || selectedClassId;
    const requestSessionNum = options?.sessionOverride || selectedSessionNumber;
    const activeRows = options?.sourceRows || rows;
    if (!requestClassId) {
      setBannerMessage({
        type: "warning",
        text: "Vui lòng chọn Lớp học trước khi đẩy sản phẩm Web lên GitHub Pages.",
      });
      return {
        success: false,
        updatedRows: activeRows,
        errorSummary: "Chưa chọn Lớp học",
      };
    }

    const idsToDeploy =
      targetStudentIds && targetStudentIds.length > 0
        ? targetStudentIds
        : activeRows
            .filter((r) => r.assignedStudentId && r.folderPath)
            .map((r) => r.assignedStudentId);

    if (idsToDeploy.length === 0) {
      setBannerMessage({
        type: "warning",
        text: "Chưa có học viên nào có thư mục sản phẩm trên máy tính để đẩy lên GitHub Pages.",
      });
      return {
        success: false,
        updatedRows: activeRows,
        errorSummary: "Chưa có thư mục sản phẩm trên máy tính",
      };
    }

    if (
      !options?.skipApprovalConfirm &&
      !confirmBeforeDemotingApprovedRows(idsToDeploy, activeRows)
    ) {
      return {
        success: false,
        updatedRows: activeRows,
        errorSummary: "Đã hủy xác nhận trước khi đẩy Web",
      };
    }

    setDeployingWeb(true);
    setBannerMessage({
      type: "warning",
      text: `Đang đẩy thư mục Web của ${idsToDeploy.length} học viên lên GitHub Pages (Banhtalon/WEB_PRODUCT_SHOW) và tự động gắn Link Web Live...`,
    });

    const flushedRows = [...activeRows];
    const effectiveIdsToDeploy: string[] = [];
    try {
      for (let idx = 0; idx < flushedRows.length; idx++) {
        const row = flushedRows[idx];
        if (idsToDeploy.includes(row.assignedStudentId)) {
          const saved: any = await persistRowDraft(
            row,
            undefined,
            requestSessionNum,
            {
              autoRetryOnConflict: true,
              silentErrorBanner: idsToDeploy.length > 1,
            }
          );
          const activeClass = getActiveUiClassId();
          if (activeClass && activeClass !== requestClassId) {
            return {
              success: false,
              updatedRows: flushedRows,
              errorSummary: "Đã chuyển sang lớp học khác",
            };
          }
          if (!saved) {
            const errMsg = `Lưu bản nháp cho học viên '${row.folderName || row.assignedStudentId}' thất bại trước khi đẩy GitHub Pages.`;
            setStudentToolError(row.assignedStudentId, "web", errMsg);
            if (idsToDeploy.length === 1) {
              setBannerMessage({
                type: "error",
                text: errMsg,
              });
              return {
                success: false,
                updatedRows: flushedRows,
                errorSummary: errMsg,
              };
            }
            continue;
          }
          effectiveIdsToDeploy.push(row.assignedStudentId);
          if (typeof saved === "object" && saved.row) {
            flushedRows[idx] = saved.row;
          } else if (typeof saved === "object" && typeof saved.draftVersion === "number") {
            flushedRows[idx] = {
              ...row,
              draftVersion: saved.draftVersion,
              isDirty: false,
            };
          }
        }
      }

      if (effectiveIdsToDeploy.length === 0) {
        const errMsg = "Không thể lưu bản nháp cho các học viên trước khi đẩy GitHub Pages.";
        setBannerMessage({ type: "error", text: errMsg });
        return {
          success: false,
          updatedRows: flushedRows,
          errorSummary: errMsg,
        };
      }

      const res = await fetch("/api/spck/deploy-web", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: requestClassId,
          sessionNumber: requestSessionNum,
          repoUrl: webRepoUrl.trim(),
          studentIds: effectiveIdsToDeploy,
          syncActiveSession: true,
        }),
      });
      const data = await res.json();
      const activeClass = getActiveUiClassId();
      if (activeClass && activeClass !== requestClassId) {
        return {
          success: false,
          updatedRows: flushedRows,
          errorSummary: "Đã chuyển sang lớp học khác",
        };
      }

      if (!data.success) {
        const errSummary =
          data.error || "Lỗi khi đẩy sản phẩm Web lên GitHub Pages.";
        for (const sid of idsToDeploy) {
          setStudentToolError(sid, "web", errSummary);
        }
        setBannerMessage({
          type: "error",
          text: errSummary,
        });
        return {
          success: false,
          updatedRows: flushedRows,
          errorSummary: errSummary,
        };
      }

      const dbByStu = new Map<string, SpckRecordRow>(
        (data.records || [])
          .filter((r: SpckRecordRow) => !r.classId || r.classId === requestClassId)
          .map((r: SpckRecordRow) => [r.studentId, r])
      );

      const mergeWebRecords = (baseList: ScannedFolderUIItem[]): ScannedFolderUIItem[] =>
        baseList.map((row) => {
          const rec = dbByStu.get(row.assignedStudentId);
          if (!rec) return row;
          const relatedLinks = parseJsonSafe<RelatedLinkItem[]>(rec.relatedLinksJson, []);
          return {
            ...row,
            relatedLinksText: serializeRelatedLinksToText(relatedLinks),
            status: rec.status || "WAITING_APPROVAL",
            contentHash: rec.contentHash || "",
            verifiedAt: rec.verifiedAt,
            errorMessage: rec.errorMessage,
            draftVersion: rec.draftVersion ?? row.draftVersion,
            hasNewerSharedResources: Boolean(rec.hasNewerSharedResources),
            thumbnailInspection: rec.thumbnailInspection || row.thumbnailInspection,
            sessionResults:
              parseSessionResultsMap(rec.sessionResultsJson) || row.sessionResults,
            sessionHistory: rec.sessionHistory || row.sessionHistory,
            hasPortalBackup: Boolean(rec.hasPortalBackup ?? row.hasPortalBackup),
            folderContentChanged: false,
            isDirty: false,
          };
        });

      const nextRows = mergeWebRecords(flushedRows);
      setRows((prev) => mergeWebRecords(prev));

      const dRes = data.deployResult;
      if (Array.isArray(dRes?.results)) {
        for (const item of dRes.results) {
          if (!item?.studentId) continue;
          if (item.status === "FAILED") {
            setStudentToolError(
              item.studentId,
              "web",
              item.errorMessage || "Lỗi đẩy Web lên GitHub Pages."
            );
          } else {
            setStudentToolError(item.studentId, "web", null);
          }
        }
      } else {
        for (const sid of idsToDeploy) {
          setStudentToolError(sid, "web", null);
        }
      }
      const deployedCount = dRes?.deployedStudentsCount || 0;
      const skippedCount = dRes?.skippedNoHtmlCount || 0;
      const failedCount = dRes?.failedStudentsCount || 0;
      const firstErr = dRes?.results?.find((r: any) => r.status === "FAILED")
        ?.errorMessage;
      const hasNewerCount = (data.records || []).filter(
        (r: SpckRecordRow) => r.hasNewerSharedResources
      ).length;

      if (deployedCount === 0 && skippedCount > 0) {
        setBannerMessage({
          type: "warning",
          text: `Không tìm thấy file .html nào trong thư mục của ${skippedCount} học viên (tính năng tạo Link Web Live dành cho các lớp Web có file .html).`,
        });
      } else {
        setBannerMessage({
          type: failedCount > 0 ? "warning" : "success",
          text: `Đã đẩy Web lên GitHub Pages và gắn Link Web Chạy Thử vào bản nháp cho ${deployedCount}/${dRes?.totalRequested || 0} học viên!${
            hasNewerCount > 0
              ? ` Bấm "Dùng tài nguyên mới nhất" ở học viên cần cập nhật vào bản nháp Buổi ${requestSessionNum}.`
              : ""
          }`,
        });
      }
      const webErrorSummary =
        failedCount > 0
          ? `${failedCount}/${dRes?.totalRequested || idsToDeploy.length} học viên lỗi${firstErr ? `: ${firstErr}` : ""}`
          : undefined;
      return {
        success: failedCount === 0,
        updatedRows: nextRows,
        ...(webErrorSummary ? { errorSummary: webErrorSummary } : {}),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const activeClass = getActiveUiClassId();
      if (!activeClass || activeClass === requestClassId) {
        for (const sid of idsToDeploy) {
          setStudentToolError(sid, "web", msg);
        }
        setBannerMessage({
          type: "error",
          text: msg,
        });
      }
      return {
        success: false,
        updatedRows: flushedRows,
        errorSummary:
          activeClass && activeClass !== requestClassId
            ? "Đã chuyển sang lớp học khác"
            : msg || "Lỗi không xác định khi đẩy GitHub Pages",
      };
    } finally {
      setDeployingWeb(false);
    }
  };

  const handleCreateDemoScoringSheet = async (enableAiPreScore = true) => {
    if (!selectedClassId) {
      setBannerMessage({
        type: "warning",
        text: "Vui lòng chọn Lớp học trước khi tạo Bảng chấm điểm buổi Demo.",
      });
      return;
    }

    const requestClassId = selectedClassId;
    setCreatingDemoSheet(true);
    setBannerMessage({
      type: "warning",
      text: enableAiPreScore
        ? `Đang nhờ AI phân tích SPCK để chấm nháp phần sản phẩm & tạo câu hỏi BGK (Cột G), rồi tạo Google Trang tính "${demoSheetTitle}" (${students.length || rows.length} tab học viên) cho lớp ${requestClassId}...`
        : `Đang tạo Google Trang tính "${demoSheetTitle}" (${students.length || rows.length} tab học viên, Ngày Demo Buổi 14: ${demoDateInput || "tự động"}) trực tiếp trong thư mục Google Drive của lớp ${requestClassId}...`,
    });

    try {
      const res = await fetch("/api/spck/create-demo-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: requestClassId,
          templateSheetUrl: templateSheetUrl.trim(),
          driveFolderUrl: driveFolderUrl.trim(),
          localClassFolderPath: folderPathInput.trim(),
          demoDate: demoDateInput.trim(),
          enableAiPreScore,
        }),
      });
      const data = await res.json();
      const activeClass = getActiveUiClassId();
      if (activeClass && activeClass !== requestClassId) {
        return;
      }

      if (!data.success) {
        setBannerMessage({
          type: "error",
          text: data.error || "Lỗi khi tạo Bảng chấm điểm buổi Demo.",
        });
        return;
      }

      const dSheet = data.demoSheetResult;
      if (dSheet?.googleSheetUrl) {
        setGeneratedDemoSheetUrl(dSheet.googleSheetUrl);
        setDemoScoreSourceInput((prev) => prev || dSheet.googleSheetUrl);
      }
      if (dSheet?.demoDate) {
        setDemoDateInput(dSheet.demoDate);
      }
      if (dSheet?.sheetTitle) {
        setDemoSheetTitle(dSheet.sheetTitle);
      }

      const skipReasons = dSheet?.aiSkipReasons as
        | { noEvidenceCount?: number; parseErrorCount?: number; aiErrorCount?: number }
        | undefined;
      const fallbackReasons: string[] = [];
      if ((skipReasons?.noEvidenceCount || 0) > 0) {
        fallbackReasons.push("chưa có tệp/link bài nộp");
      }
      if ((skipReasons?.parseErrorCount || 0) > 0) {
        fallbackReasons.push("tệp dự án lỗi đọc tự động");
      }
      if ((skipReasons?.aiErrorCount || 0) > 0) {
        fallbackReasons.push("không gọi được AI chấm nháp lúc này");
      }

      const aiSummaryPart =
        typeof dSheet?.aiPreScoredCount === "number" && dSheet.aiPreScoredCount > 0
          ? ` — AI đã chấm nháp phần sản phẩm & gợi ý câu hỏi BGK (Cột G) cho ${dSheet.aiPreScoredCount}/${dSheet?.studentCount || 0} học viên`
          : enableAiPreScore &&
            dSheet?.aiPreScoredCount === 0 &&
            (dSheet?.aiSkippedCount || 0) > 0
          ? ` — tạm giữ mức mặc định 'Tốt' cho các tiêu chí (${
              fallbackReasons.length > 0
                ? fallbackReasons.join(", ")
                : "giám khảo chấm trực tiếp"
            })`
          : "";

      setBannerMessage({
        type: "success",
        text: `Đã tạo Google Trang tính "${dSheet?.sheetTitle}" gồm ${dSheet?.studentCount || 0} tab học viên (Ngày Demo Buổi 14: ${dSheet?.demoDate})${aiSummaryPart} trực tiếp trong thư mục Google Drive của lớp để giám khảo chấm!`,
      });
    } catch (err) {
      const activeClass = getActiveUiClassId();
      if (!activeClass || activeClass === requestClassId) {
        setBannerMessage({
          type: "error",
          text: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      setCreatingDemoSheet(false);
    }
  };

  const handleCaptureAppScreenshots = async (
    targetStudentIds?: string[],
    options?: {
      skipApprovalConfirm?: boolean;
      sourceRows?: ScannedFolderUIItem[];
      classIdOverride?: string;
      sessionOverride?: 12 | 13 | 14;
    }
  ): Promise<{
    success: boolean;
    updatedRows: ScannedFolderUIItem[];
    errorSummary?: string;
  } | void> => {
    const requestClassId = options?.classIdOverride || selectedClassId;
    const requestSessionNum = options?.sessionOverride || selectedSessionNumber;
    const activeRows = options?.sourceRows || rows;
    if (!requestClassId) {
      setBannerMessage({
        type: "warning",
        text: "Vui lòng chọn Lớp học trước khi chụp hình giao diện App.",
      });
      return {
        success: false,
        updatedRows: activeRows,
        errorSummary: "Chưa chọn Lớp học",
      };
    }

    const idsToCapture =
      targetStudentIds && targetStudentIds.length > 0
        ? targetStudentIds
        : activeRows
            .filter((r) => r.assignedStudentId && r.folderPath)
            .map((r) => r.assignedStudentId);

    if (
      !options?.skipApprovalConfirm &&
      !confirmBeforeDemotingApprovedRows(idsToCapture, activeRows)
    ) {
      return {
        success: false,
        updatedRows: activeRows,
        errorSummary: "Đã hủy xác nhận trước khi chụp hình",
      };
    }

    setCapturingScreenshots(true);
    setBannerMessage({
      type: "warning",
      text: "Đang mở tự động giao diện App của học viên để chụp hình các màn hình và dùng AI chọn hình đẹp nhất làm Thumbnail...",
    });

    try {
      const res = await fetch("/api/spck/capture-screenshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: requestClassId,
          sessionNumber: requestSessionNum,
          studentIds: targetStudentIds,
          useAiVision: true,
          preferDefaultLogoWhenNoOwnerPhoto: true,
          syncActiveSession: true,
        }),
      });
      const data = await res.json();
      const activeClass = getActiveUiClassId();
      if (activeClass && activeClass !== requestClassId) {
        return {
          success: false,
          updatedRows: activeRows,
          errorSummary: "Đã chuyển sang lớp học khác",
        };
      }
      if (!data.success) {
        const errSummary =
          data.error || "Không thể chụp hình giao diện App.";
        for (const sid of idsToCapture) {
          setStudentToolError(sid, "screenshot", errSummary);
        }
        setBannerMessage({
          type: "error",
          text: errSummary,
        });
        return {
          success: false,
          updatedRows: activeRows,
          errorSummary: errSummary,
        };
      }

      const dbByStu = new Map<string, SpckRecordRow>(
        (data.records || [])
          .filter((r: SpckRecordRow) => !r.classId || r.classId === requestClassId)
          .map((r: SpckRecordRow) => [r.studentId, r])
      );

      const bRes = data.batchResult;
      const failedByStudentId = new Map<string, string>();
      if (Array.isArray(data.failedItems)) {
        for (const fItem of data.failedItems) {
          if (!fItem?.studentId) continue;
          const fMsg = String(
            fItem.error || fItem.errorMessage || "Lỗi chụp hình giao diện."
          ).trim();
          failedByStudentId.set(fItem.studentId, fMsg || "Lỗi chụp hình giao diện.");
        }
      }
      if (Array.isArray(bRes?.results)) {
        for (const rItem of bRes.results) {
          if (!rItem?.studentId) continue;
          if (rItem.error || rItem.errorMessage || rItem.status === "FAILED") {
            const rMsg = String(
              rItem.error || rItem.errorMessage || "Lỗi chụp hình giao diện."
            ).trim();
            failedByStudentId.set(rItem.studentId, rMsg || "Lỗi chụp hình giao diện.");
          }
        }
      }

      const mergeScreenshotRecords = (
        baseList: ScannedFolderUIItem[]
      ): ScannedFolderUIItem[] =>
        baseList.map((row) => {
          const rec = dbByStu.get(row.assignedStudentId);
          if (!rec) return row;
          const screenshots = parseJsonSafe<string[]>(rec.screenshotsJson, []);
          const nextThumbInspection = rec.thumbnailInspection || row.thumbnailInspection;
          const hasRealProductImage =
            Boolean(nextThumbInspection && !nextThumbInspection.isDefaultMindxLogo) ||
            screenshots.length > 0;
          const nextWarningReasons = hasRealProductImage
            ? (row.warningReasons || []).filter(
                (w) => !w.includes("Chưa có ảnh sản phẩm trong thư mục")
              )
            : row.warningReasons;
          return {
            ...row,
            thumbnailPath: rec.thumbnailPath || row.thumbnailPath,
            screenshots,
            warningReasons: nextWarningReasons,
            status: rec.status || "WAITING_APPROVAL",
            contentHash: rec.contentHash || "",
            verifiedAt: rec.verifiedAt,
            errorMessage: rec.errorMessage,
            draftVersion: rec.draftVersion ?? row.draftVersion,
            hasNewerSharedResources: Boolean(rec.hasNewerSharedResources),
            thumbnailInspection: nextThumbInspection,
            sessionResults:
              parseSessionResultsMap(rec.sessionResultsJson) || row.sessionResults,
            sessionHistory: rec.sessionHistory || row.sessionHistory,
            hasPortalBackup: Boolean(rec.hasPortalBackup ?? row.hasPortalBackup),
            folderContentChanged: failedByStudentId.has(row.assignedStudentId)
              ? row.folderContentChanged
              : false,
            isDirty: false,
          };
        });

      const nextRows = mergeScreenshotRecords(activeRows);
      setRows((prev) => mergeScreenshotRecords(prev));

      const seenStudentIds = new Set<string>();
      if (Array.isArray(bRes?.results)) {
        for (const item of bRes.results) {
          if (!item?.studentId) continue;
          seenStudentIds.add(item.studentId);
          if (failedByStudentId.has(item.studentId)) {
            setStudentToolError(
              item.studentId,
              "screenshot",
              failedByStudentId.get(item.studentId) || "Lỗi chụp hình giao diện."
            );
          } else {
            setStudentToolError(item.studentId, "screenshot", null);
          }
        }
      }
      for (const [sid, shotErrMsg] of failedByStudentId.entries()) {
        if (!seenStudentIds.has(sid)) {
          seenStudentIds.add(sid);
          setStudentToolError(sid, "screenshot", shotErrMsg);
        }
      }
      if (
        !Array.isArray(bRes?.results) &&
        failedByStudentId.size === 0 &&
        !data.partialFailure
      ) {
        for (const sid of idsToCapture) {
          setStudentToolError(sid, "screenshot", null);
        }
      }

      const hasFailedScreenshot =
        failedByStudentId.size > 0 || Boolean(data.partialFailure);
      const failedShotCount =
        failedByStudentId.size > 0
          ? failedByStudentId.size
          : hasFailedScreenshot
          ? 1
          : 0;
      const firstShotErr =
        failedByStudentId.values().next().value ||
        (typeof data.warning === "string" && data.warning.trim()
          ? data.warning.trim()
          : undefined);
      const totalShotStudents = bRes?.totalProcessed || idsToCapture.length;
      const succeededShotStudents =
        totalShotStudents > failedShotCount ? totalShotStudents - failedShotCount : 0;
      const hasNewerCount = (data.records || []).filter(
        (r: SpckRecordRow) => r.hasNewerSharedResources
      ).length;
      const newerSuffix =
        hasNewerCount > 0
          ? ` Bấm "Dùng tài nguyên mới nhất" ở học viên cần áp dụng ảnh mới vào bản nháp Buổi ${requestSessionNum}.`
          : "";
      setBannerMessage({
        type: hasFailedScreenshot ? "warning" : "success",
        text: hasFailedScreenshot
          ? `Chụp hình giao diện hoàn tất một phần (${succeededShotStudents}/${totalShotStudents} học viên thành công, ${
              bRes?.totalScreenshotsCaptured || 0
            } ảnh; ${failedShotCount} học viên lỗi${
              data.warning
                ? ` — ${data.warning}`
                : firstShotErr
                ? ` — ${firstShotErr}`
                : ""
            }).${newerSuffix}`
          : `Đã chụp tổng cộng ${bRes?.totalScreenshotsCaptured || 0} màn hình giao diện App cho ${
              bRes?.totalProcessed || 0
            } học viên và gắn vào bản nháp!${newerSuffix}`,
      });
      const shotErrorSummary = hasFailedScreenshot
        ? `${failedShotCount}/${totalShotStudents} học viên lỗi${
            firstShotErr ? `: ${firstShotErr}` : ""
          }`
        : undefined;
      return {
        success: !hasFailedScreenshot,
        updatedRows: nextRows,
        ...(shotErrorSummary ? { errorSummary: shotErrorSummary } : {}),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const activeClass = getActiveUiClassId();
      if (!activeClass || activeClass === requestClassId) {
        for (const sid of idsToCapture) {
          setStudentToolError(sid, "screenshot", msg);
        }
        setBannerMessage({
          type: "error",
          text: msg,
        });
      }
      return {
        success: false,
        updatedRows: activeRows,
        errorSummary:
          activeClass && activeClass !== requestClassId
            ? "Đã chuyển sang lớp học khác"
            : msg || "Lỗi không xác định khi chụp hình giao diện",
      };
    } finally {
      setCapturingScreenshots(false);
    }
  };

  const handleSyncDriveThumbnails = async (
    targetStudentIds?: string[],
    options?: {
      skipApprovalConfirm?: boolean;
      sourceRows?: ScannedFolderUIItem[];
      classIdOverride?: string;
      sessionOverride?: 12 | 13 | 14;
      forceRedownload?: boolean;
      seedMissingActiveStudents?: boolean;
      silentSuccessBanner?: boolean;
    }
  ): Promise<SpckToolStepResult> => {
    const activeRows = options?.sourceRows || rows;
    const requestClassId = options?.classIdOverride || selectedClassId;
    const requestSessionNum = options?.sessionOverride || selectedSessionNumber;
    if (!requestClassId) {
      return {
        success: false,
        updatedRows: activeRows,
        errorSummary: "Chưa chọn Lớp học",
      };
    }
    if (syncingDriveThumbnails) {
      return {
        success: false,
        updatedRows: activeRows,
        errorSummary: "Đang đồng bộ ảnh bìa Google Drive.",
      };
    }

    const idsToSync =
      targetStudentIds && targetStudentIds.length > 0
        ? targetStudentIds
        : activeRows.map((r) => r.assignedStudentId).filter(Boolean);

    if (
      !options?.skipApprovalConfirm &&
      idsToSync.length > 0 &&
      !confirmBeforeDemotingApprovedRows(idsToSync, activeRows)
    ) {
      return {
        success: false,
        updatedRows: activeRows,
        errorSummary: "Đã hủy xác nhận trước khi đồng bộ ảnh bìa Drive",
      };
    }

    setSyncingDriveThumbnails(true);
    if (!options?.silentSuccessBanner) {
      setBannerMessage({
        type: "warning",
        text: "Đang quét thư mục Google Drive ảnh học viên để tự động gắn Thumbnail (thiếu dùng Logo MindX)...",
      });
    }

    try {
      const res = await fetch("/api/spck/sync-drive-thumbnails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: requestClassId,
          sessionNumber: requestSessionNum,
          driveFolderUrl:
            thumbnailDriveFolderUrl.trim() ||
            DEFAULT_SPCK_THUMBNAIL_DRIVE_URL_UI,
          studentIds:
            targetStudentIds && targetStudentIds.length > 0
              ? targetStudentIds
              : undefined,
          forceRedownload: options?.forceRedownload === true,
          forceOverwriteVerifiedSession: !options?.skipApprovalConfirm,
          seedMissingActiveStudents: options?.seedMissingActiveStudents === true,
          syncActiveSession: true,
        }),
      });
      const data = await res.json();
      const activeClass = getActiveUiClassId();
      if (activeClass && activeClass !== requestClassId) {
        return {
          success: false,
          updatedRows: activeRows,
          errorSummary: "Đã chuyển sang lớp học khác",
        };
      }

      if (!res.ok || !data?.success) {
        const errSummary =
          data?.error || "Không thể đồng bộ ảnh bìa học viên từ Google Drive.";
        for (const sid of idsToSync) {
          setStudentToolError(sid, "thumb_drive", errSummary);
        }
        setBannerMessage({
          type: "error",
          text: errSummary,
        });
        return {
          success: false,
          updatedRows: activeRows,
          errorSummary: errSummary,
        };
      }

      const dbRecords: SpckRecordRow[] = Array.isArray(data.records)
        ? data.records
        : [];
      const dbByStu = new Map<string, SpckRecordRow>(
        dbRecords
          .filter((r) => !r.classId || r.classId === requestClassId)
          .map((r) => [r.studentId, r])
      );

      const sRes = data.syncResult;
      const failedByStudentId = new Map<string, string>();
      if (Array.isArray(sRes?.results)) {
        for (const rItem of sRes.results) {
          if (!rItem?.studentId) continue;
          if (rItem.status === "FAILED" || rItem.errorMessage) {
            const rMsg = String(
              rItem.errorMessage || "Lỗi đồng bộ ảnh bìa Google Drive."
            ).trim();
            failedByStudentId.set(rItem.studentId, rMsg);
          }
        }
      }

      const mergeDriveThumbRecords = (
        baseList: ScannedFolderUIItem[]
      ): ScannedFolderUIItem[] => {
        const stuMetaMap = new Map(
          (latestStudentsRef.current || []).map((s) => [s.studentId, s])
        );
        const mapped = baseList.map((row) => {
          const rec = dbByStu.get(row.assignedStudentId);
          if (!rec) return row;
          const screenshots = parseJsonSafe<string[]>(rec.screenshotsJson, []);
          const nextThumbInspection =
            rec.thumbnailInspection || row.thumbnailInspection;
          const hasRealProductImage =
            Boolean(
              nextThumbInspection && !nextThumbInspection.isDefaultMindxLogo
            ) || screenshots.length > 0;
          const nextWarningReasons = hasRealProductImage
            ? (row.warningReasons || []).filter(
                (w) => !w.includes("Chưa có ảnh sản phẩm trong thư mục")
              )
            : row.warningReasons;
          return {
            ...row,
            folderPath: rec.localFolderPath || row.folderPath,
            thumbnailPath: rec.thumbnailPath || row.thumbnailPath,
            screenshots,
            warningReasons: nextWarningReasons,
            status: rec.status || row.status,
            contentHash: rec.contentHash || "",
            verifiedAt: rec.verifiedAt,
            errorMessage: rec.errorMessage,
            draftVersion: rec.draftVersion ?? row.draftVersion,
            hasNewerSharedResources: Boolean(rec.hasNewerSharedResources),
            thumbnailInspection: nextThumbInspection,
            sessionResults:
              parseSessionResultsMap(rec.sessionResultsJson) || row.sessionResults,
            sessionHistory: rec.sessionHistory || row.sessionHistory,
            hasPortalBackup: Boolean(rec.hasPortalBackup ?? row.hasPortalBackup),
            isDirty: false,
          };
        });
        const existingIds = new Set(
          mapped.map((r) => r.assignedStudentId).filter(Boolean)
        );
        for (const rec of dbByStu.values()) {
          if (!rec.studentId || existingIds.has(rec.studentId)) continue;
          mapped.push(
            buildRowFromDbRecord(
              rec,
              stuMetaMap.get(rec.studentId),
              requestSessionNum
            )
          );
        }
        return mapped;
      };

      const nextRows = mergeDriveThumbRecords(activeRows);
      setRows((prev) => mergeDriveThumbRecords(prev));

      const seenIds = new Set<string>();
      if (Array.isArray(sRes?.results)) {
        for (const item of sRes.results) {
          if (!item?.studentId) continue;
          seenIds.add(item.studentId);
          if (failedByStudentId.has(item.studentId)) {
            setStudentToolError(
              item.studentId,
              "thumb_drive",
              failedByStudentId.get(item.studentId) ||
                "Lỗi tải ảnh học viên từ Google Drive."
            );
          } else {
            setStudentToolError(item.studentId, "thumb_drive", null);
          }
        }
      }
      for (const sid of idsToSync) {
        if (!seenIds.has(sid) && !failedByStudentId.has(sid)) {
          setStudentToolError(sid, "thumb_drive", null);
        }
      }

      const failedCount = Number(
        sRes?.failedCount ?? failedByStudentId.size ?? 0
      );
      const hasFailed = failedCount > 0 || Boolean(data.partialFailure);
      const matchedCount = Number(sRes?.matchedFromDriveCount || 0);
      const logoFallbackCount = Number(sRes?.fallbackLogoCount || 0);
      const manualKeptCount = Number(sRes?.keptManualOwnerCount || 0);
      const totalProcessed = Number(
        sRes?.totalProcessed || idsToSync.length || 0
      );
      const firstErr =
        failedByStudentId.values().next().value ||
        (typeof data.warning === "string" && data.warning.trim()
          ? data.warning.trim()
          : undefined);

      if (hasFailed || !options?.silentSuccessBanner) {
        const warnNote =
          typeof data.warning === "string" && data.warning.trim()
            ? ` (${data.warning.trim()})`
            : "";
        setBannerMessage({
          type: hasFailed || warnNote ? "warning" : "success",
          text: hasFailed
            ? `Đồng bộ ảnh bìa Drive hoàn tất một phần (${matchedCount}/${totalProcessed} bạn lấy từ Drive, ${logoFallbackCount} bạn dùng Logo MindX${
                manualKeptCount > 0
                  ? `, ${manualKeptCount} bạn giữ ảnh tải tay`
                  : ""
              }; ${failedCount} bạn lỗi${warnNote}).`
            : `Đã gắn ảnh học viên từ Google Drive cho ${matchedCount}/${totalProcessed} bạn (${logoFallbackCount} bạn chưa có ảnh trên Drive → dùng Logo MindX${
                manualKeptCount > 0
                  ? `, ${manualKeptCount} bạn giữ ảnh tải tay`
                  : ""
              })${warnNote}.`,
        });
      }

      const errorSummary = hasFailed
        ? `${failedCount}/${totalProcessed || 1} ảnh Drive lỗi${
            firstErr ? `: ${firstErr}` : ""
          }`
        : undefined;

      return {
        success: !hasFailed,
        updatedRows: nextRows,
        ...(errorSummary ? { errorSummary } : {}),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const activeClass = getActiveUiClassId();
      if (!activeClass || activeClass === requestClassId) {
        for (const sid of idsToSync) {
          setStudentToolError(sid, "thumb_drive", msg);
        }
        setBannerMessage({
          type: "error",
          text: msg,
        });
      }
      return {
        success: false,
        updatedRows: activeRows,
        errorSummary:
          activeClass && activeClass !== requestClassId
            ? "Đã chuyển sang lớp học khác"
            : msg || "Lỗi không xác định khi đồng bộ ảnh bìa Drive",
      };
    } finally {
      setSyncingDriveThumbnails(false);
    }
  };

  const handleOwnerUploadImage = async (
    studentId: string,
    role: "thumbnail" | "gallery",
    fileList: FileList | null
  ) => {
    if (!selectedClassId || !studentId || !fileList || fileList.length === 0) {
      return;
    }
    if (!confirmBeforeDemotingApprovedRows([studentId])) {
      return;
    }
    const requestClassId = selectedClassId;
    setCapturingScreenshots(true);
    try {
      const filesPayload: Array<{ fileName: string; dataUrl: string }> = [];
      for (const file of Array.from(fileList)) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(new Error("Không đọc được file ảnh."));
          reader.readAsDataURL(file);
        });
        filesPayload.push({ fileName: file.name, dataUrl });
      }

      const res = await fetch("/api/spck/capture-screenshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: requestClassId,
          sessionNumber: selectedSessionNumber,
          action: "upload_owner_image",
          studentId,
          role,
          files: filesPayload,
          syncActiveSession: true,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setBannerMessage({
          type: "error",
          text: data.error || "Không thể tải hình của Owner lên.",
        });
        return;
      }

      const dbByStu = new Map<string, SpckRecordRow>(
        (data.records || [])
          .filter((r: SpckRecordRow) => !r.classId || r.classId === requestClassId)
          .map((r: SpckRecordRow) => [r.studentId, r])
      );

      setRows((prev) =>
        prev.map((row) => {
          const rec = dbByStu.get(row.assignedStudentId);
          if (!rec) return row;
          const screenshots = parseJsonSafe<string[]>(rec.screenshotsJson, []);
          const nextThumbInspection = rec.thumbnailInspection || row.thumbnailInspection;
          const hasRealProductImage =
            Boolean(nextThumbInspection && !nextThumbInspection.isDefaultMindxLogo) ||
            screenshots.length > 0;
          const nextWarningReasons = hasRealProductImage
            ? (row.warningReasons || []).filter(
                (w) => !w.includes("Chưa có ảnh sản phẩm trong thư mục")
              )
            : row.warningReasons;
          return {
            ...row,
            thumbnailPath: rec.thumbnailPath || row.thumbnailPath,
            screenshots,
            warningReasons: nextWarningReasons,
            status: rec.status || "WAITING_APPROVAL",
            contentHash: rec.contentHash || "",
            verifiedAt: rec.verifiedAt,
            errorMessage: rec.errorMessage,
            draftVersion: rec.draftVersion ?? row.draftVersion,
            hasNewerSharedResources: Boolean(rec.hasNewerSharedResources),
            thumbnailInspection: nextThumbInspection,
            sessionResults:
              parseSessionResultsMap(rec.sessionResultsJson) || row.sessionResults,
            sessionHistory: rec.sessionHistory || row.sessionHistory,
          };
        })
      );

      setBannerMessage({
        type: "success",
        text:
          role === "thumbnail"
            ? "Đã cập nhật hình Owner tải lên làm Thumbnail (hình chụp App đẹp nhất trước đó vẫn được giữ ở ô Ảnh SP bên dưới)!"
            : "Đã thêm hình Owner tải lên vào danh sách Ảnh SP (ô dưới)!",
      });
    } catch (err) {
      setBannerMessage({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCapturingScreenshots(false);
    }
  };

  const applyPortalStatusState = useCallback(
    (pStatus: any) => {
      if (!pStatus) return;
      const nextRunning = Boolean(pStatus.isRunning);
      const nextShareUrl = pStatus.primaryShareUrl || "";
      const nextLanUrl = pStatus.lanUrl || "";
      const nextLocalUrl = pStatus.localUrl || "";
      const nextPublicUrl = pStatus.publicTunnelUrl || "";
      const nextTunnelStatus = pStatus.tunnelStatus || "STOPPED";
      const nextTunnelProvider = pStatus.tunnelProvider || "";

      setStudentPortalRunning((prev) => (prev === nextRunning ? prev : nextRunning));
      setStudentPortalShareUrl((prev) => (prev === nextShareUrl ? prev : nextShareUrl));
      setStudentPortalLanUrl((prev) => (prev === nextLanUrl ? prev : nextLanUrl));
      setStudentPortalLocalUrl((prev) => (prev === nextLocalUrl ? prev : nextLocalUrl));
      setStudentPortalPublicUrl((prev) =>
        prev === nextPublicUrl ? prev : nextPublicUrl
      );
      setStudentPortalTunnelStatus((prev) =>
        prev === nextTunnelStatus ? prev : nextTunnelStatus
      );
      setStudentPortalTunnelProvider((prev) =>
        prev === nextTunnelProvider ? prev : nextTunnelProvider
      );
      if (nextRunning && typeof pStatus.autoUploadDrive === "boolean") {
        const nextAutoDrive = pStatus.autoUploadDrive;
        setStudentPortalAutoDrive((prev) =>
          prev === nextAutoDrive ? prev : nextAutoDrive
        );
      }
      if (Array.isArray(pStatus.submissions)) {
        const nextSubmissions = pStatus.submissions;
        setStudentPortalSubmissions((prev) =>
          JSON.stringify(prev) === JSON.stringify(nextSubmissions)
            ? prev
            : nextSubmissions
        );
      }
      if (pStatus.rootFolderPath) {
        const nextRoot = String(pStatus.rootFolderPath);
        const canOverwriteExisting =
          nextRunning && (!pStatus.classId || pStatus.classId === selectedClassId);
        setFolderPathInput((prev) => {
          if (!prev || canOverwriteExisting) {
            return prev === nextRoot ? prev : nextRoot;
          }
          return prev;
        });
      }
    },
    [
      selectedClassId,
      setFolderPathInput,
      setStudentPortalAutoDrive,
      setStudentPortalLanUrl,
      setStudentPortalLocalUrl,
      setStudentPortalPublicUrl,
      setStudentPortalRunning,
      setStudentPortalShareUrl,
      setStudentPortalSubmissions,
      setStudentPortalTunnelProvider,
      setStudentPortalTunnelStatus,
    ]
  );

  const latestApplyPortalStatusRef = useRef(applyPortalStatusState);
  latestApplyPortalStatusRef.current = applyPortalStatusState;

  const handleStartStudentPortal = async () => {
    if (!selectedClassId) {
      setBannerMessage({
        type: "warning",
        text: "Vui lòng chọn Lớp học trước khi mở Cổng Cho Học Sinh Nộp Bài.",
      });
      return;
    }

    const reqClassId = selectedClassId;
    const reqClassUpper = reqClassId.trim().toUpperCase();
    const reqSessionNum = selectedSessionNumber;
    const mutSeq = ++portalMutationSeqRef.current;

    if (portalActivePostControllerRef.current) {
      portalActivePostControllerRef.current.abort();
    }
    const controller = new AbortController();
    portalActivePostControllerRef.current = controller;

    setTogglingStudentPortal(true);
    setBannerMessage({
      type: "warning",
      text: `Đang mở Cổng Thu Bài Trực Tuyến cho lớp ${reqClassId} và khởi tạo đường dẫn gửi cho học sinh...`,
    });

    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch("/api/spck/student-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          action: "start",
          classId: reqClassId,
          sessionNumber: reqSessionNum,
          folderPath: folderPathInput.trim(),
          driveFolderUrl: driveFolderUrl.trim(),
          autoUploadDrive: studentPortalAutoDrive,
        }),
      });
      const data = await res.json();
      if (
        mutSeq !== portalMutationSeqRef.current ||
        !isCurrentPortalUiClassMatch(reqClassUpper)
      ) {
        return;
      }

      if (!res.ok || !data?.success || !data?.portalStatus) {
        setBannerMessage({
          type: "error",
          text: data?.error || "Không thể mở Cổng Cho Học Sinh Nộp Bài.",
        });
        return;
      }

      const pStatus = data.portalStatus;
      const isSameSession = latestSelectedSessionRef.current === reqSessionNum;
      if (isSameSession) {
        portalLastCheckedTargetRef.current = {
          classId: reqClassId,
          sessionNumber: reqSessionNum,
        };
        if (typeof pStatus.stateVersion === "number") {
          portalKnownStateVersionRef.current = {
            classId: reqClassId,
            sessionNumber: reqSessionNum,
            stateVersion: pStatus.stateVersion,
          };
        }
      } else {
        portalLastCheckedTargetRef.current = null;
      }

      latestApplyPortalStatusRef.current(pStatus);
      if (pStatus?.rootFolderPath) {
        setFolderPathInput(pStatus.rootFolderPath);
      }
      if (isSameSession && Array.isArray(data.records) && data.records.length > 0) {
        hydrateRowsFromDb(data.records, latestStudentsRef.current, reqSessionNum);
      }

      setBannerMessage({
        type: "success",
        text: `Đã mở Cổng Cho Học Sinh Nộp Bài lớp ${reqClassId}! Hãy bấm "Copy Link Nộp Bài" để gửi cho học sinh. Khi học sinh nộp bài, sản phẩm sẽ tự lưu vào máy Thầy và tự động tải lên Google Drive!`,
      });
    } catch (err) {
      if (
        mutSeq !== portalMutationSeqRef.current ||
        !isCurrentPortalUiClassMatch(reqClassUpper)
      ) {
        return;
      }
      const isTimeout = err instanceof Error && err.name === "AbortError";
      setBannerMessage({
        type: "error",
        text: isTimeout
          ? "Quá thời gian khởi tạo Cổng Thu Bài (15s). Vui lòng thử lại."
          : err instanceof Error
          ? err.message
          : String(err),
      });
    } finally {
      clearTimeout(timeoutId);
      if (portalActivePostControllerRef.current === controller) {
        portalActivePostControllerRef.current = null;
      }
      if (mutSeq === portalMutationSeqRef.current) {
        setTogglingStudentPortal(false);
      }
    }
  };

  const handleStopStudentPortalInternal = async (options?: {
    silentSuccessBanner?: boolean;
  }): Promise<boolean> => {
    const reqClassId = selectedClassId;
    const reqClassUpper = String(reqClassId || "").trim().toUpperCase();
    const reqSessionNum = selectedSessionNumber;
    const mutSeq = ++portalMutationSeqRef.current;

    if (portalActivePostControllerRef.current) {
      portalActivePostControllerRef.current.abort();
    }
    const controller = new AbortController();
    portalActivePostControllerRef.current = controller;

    setTogglingStudentPortal(true);
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch("/api/spck/student-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          action: "stop",
          classId: reqClassId,
          sessionNumber: reqSessionNum,
        }),
      });
      const data = await res.json().catch(() => null);
      if (
        mutSeq !== portalMutationSeqRef.current ||
        (reqClassUpper && !isCurrentPortalUiClassMatch(reqClassUpper))
      ) {
        return false;
      }

      const confirmedStopped =
        res.ok &&
        Boolean(data?.success) &&
        Boolean(data?.portalStatus) &&
        !Boolean(data.portalStatus.isRunning);

      if (!confirmedStopped) {
        portalLastCheckedTargetRef.current = null;
        if (data?.portalStatus) {
          latestApplyPortalStatusRef.current(data.portalStatus);
        }
        setBannerMessage({
          type: "error",
          text:
            data?.error ||
            "Chưa xác nhận đóng được Cổng Cho Học Sinh Nộp Bài (cổng có thể vẫn đang mở). Vui lòng bấm Đóng Cổng lại.",
        });
        return false;
      }

      const isSameSession = latestSelectedSessionRef.current === reqSessionNum;
      if (isSameSession) {
        portalLastCheckedTargetRef.current = {
          classId: reqClassId,
          sessionNumber: reqSessionNum,
        };
        if (typeof data.portalStatus.stateVersion === "number") {
          portalKnownStateVersionRef.current = {
            classId: reqClassId,
            sessionNumber: reqSessionNum,
            stateVersion: data.portalStatus.stateVersion,
          };
        }
      } else {
        portalLastCheckedTargetRef.current = null;
      }

      latestApplyPortalStatusRef.current(data.portalStatus);
      if (isSameSession && Array.isArray(data.records) && data.records.length > 0) {
        hydrateRowsFromDb(data.records, latestStudentsRef.current, reqSessionNum);
      }
      setShowPortalQr(false);
      if (!options?.silentSuccessBanner) {
        setBannerMessage({
          type: "warning",
          text: "Đã đóng Cổng Cho Học Sinh Nộp Bài.",
        });
      }
      return true;
    } catch (err) {
      if (
        mutSeq !== portalMutationSeqRef.current ||
        (reqClassUpper && !isCurrentPortalUiClassMatch(reqClassUpper))
      ) {
        return false;
      }
      portalLastCheckedTargetRef.current = null;
      const isTimeout = err instanceof Error && err.name === "AbortError";
      setBannerMessage({
        type: "error",
        text: isTimeout
          ? "Quá thời gian phản hồi khi đóng Cổng Thu Bài — chưa xác nhận được cổng đã tắt, vui lòng thử lại."
          : "Lỗi kết nối khi đóng Cổng Cho Học Sinh Nộp Bài — chưa xác nhận được cổng đã tắt, vui lòng thử lại.",
      });
      return false;
    } finally {
      clearTimeout(timeoutId);
      if (portalActivePostControllerRef.current === controller) {
        portalActivePostControllerRef.current = null;
      }
      if (mutSeq === portalMutationSeqRef.current) {
        setTogglingStudentPortal(false);
      }
    }
  };

  const handleStopStudentPortal = async () => {
    await handleStopStudentPortalInternal({ silentSuccessBanner: false });
  };

  const handleTogglePortalAutoDrive = async (enabled: boolean) => {
    const reqClassUpper = String(selectedClassId || "").trim().toUpperCase();
    setStudentPortalAutoDrive(enabled);
    if (!studentPortalRunning) return;
    try {
      const res = await fetch("/api/spck/student-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle_auto_drive",
          autoUploadDrive: enabled,
          driveFolderUrl: driveFolderUrl.trim(),
        }),
      });
      const data = await res.json();
      if (reqClassUpper && !isCurrentPortalUiClassMatch(reqClassUpper)) {
        return;
      }
      if (res.ok && data?.success && data.portalStatus) {
        latestApplyPortalStatusRef.current(data.portalStatus);
      }
    } catch {}
  };

  const recordS14ServerSnapshots = useCallback(
    (classCode: string, serverRecords: any[]) => {
      if (!classCode || !Array.isArray(serverRecords)) return;
      const normClass = String(classCode).trim().toUpperCase();
      const g = globalThis as any;
      if (!g.__s14EvalRuntime) {
        g.__s14EvalRuntime = {
          inFlightSaves: new Map<string, Promise<any>>(),
          lastServerSnapshots: new Map<string, any>(),
          loadSeq: 0,
          latestAppliedLoadSeq: new Map<string, number>(),
        };
      }
      if (!(g.__s14EvalRuntime.lastServerSnapshots instanceof Map)) {
        g.__s14EvalRuntime.lastServerSnapshots = new Map<string, any>();
      }
      const snapMap: Map<string, any> = g.__s14EvalRuntime.lastServerSnapshots;
      for (const srv of serverRecords) {
        const sid = String(srv?.studentId || "").trim();
        if (!sid) continue;
        const key = `${normClass}:${sid}`;
        const existing = snapMap.get(key);
        if (
          existing &&
          typeof existing.draftVersion === "number" &&
          typeof srv.draftVersion === "number" &&
          existing.draftVersion > srv.draftVersion
        ) {
          continue;
        }
        snapMap.set(key, JSON.parse(JSON.stringify(srv)));
      }
    },
    []
  );

  const loadSession14Evals = useCallback(
    async (targetClassId: string) => {
      if (!targetClassId) return;
      const reqClass = String(targetClassId).trim().toUpperCase();
      const g = globalThis as any;
      if (!g.__s14EvalRuntime) {
        g.__s14EvalRuntime = {
          inFlightSaves: new Map<string, Promise<any>>(),
          lastServerSnapshots: new Map<string, any>(),
          loadSeq: 0,
          latestAppliedLoadSeq: new Map<string, number>(),
        };
      }
      const runtime = g.__s14EvalRuntime;
      if (typeof runtime.loadSeq !== "number") runtime.loadSeq = 0;
      if (!(runtime.latestAppliedLoadSeq instanceof Map)) {
        runtime.latestAppliedLoadSeq = new Map<string, number>();
      }
      const reqSeq = ++runtime.loadSeq;

      const snapshotsBeforeLoad = new Map<string, any>();
      setSession14Evals((prev: Session14EvalItemUI[]) => {
        if (Array.isArray(prev)) {
          for (const item of prev) {
            if (item?.studentId) {
              snapshotsBeforeLoad.set(
                item.studentId,
                JSON.parse(JSON.stringify(item))
              );
            }
          }
        }
        return prev;
      });

      try {
        const res = await fetch(
          `/api/spck/session14-eval?classId=${encodeURIComponent(reqClass)}`
        );
        const data = await res.json();
        if (!data?.success || !Array.isArray(data.records)) return;
        if (String(selectedClassId || "").trim().toUpperCase() !== reqClass) return;
        if (
          g.__s14LatestRenderedClassId &&
          String(g.__s14LatestRenderedClassId).trim().toUpperCase() !== reqClass
        ) {
          return;
        }

        const validRecords = enrichEvalRecordsWithAwards(
          data.records.filter(
            (r: any) => !r.classId || String(r.classId).trim().toUpperCase() === reqClass
          ),
          data
        );
        recordS14ServerSnapshots(reqClass, validRecords);
        hydrateClassSummaryFromPayload(data, reqClass, validRecords);

        const editableKeys = [
          "learnedFromMindx",
          "suggestionsFromMindx",
          "futureDirection",
          "awardRanking",
          "teacherNote",
          "demoScores",
          "competencyScores",
          "quickTags",
        ] as const;

        setSession14Evals((prev: Session14EvalItemUI[]) => {
          if (String(selectedClassId || "").trim().toUpperCase() !== reqClass) {
            return prev;
          }
          if (
            g.__s14LatestRenderedClassId &&
            String(g.__s14LatestRenderedClassId).trim().toUpperCase() !== reqClass
          ) {
            return prev;
          }
          if (
            Array.isArray(prev) &&
            prev.some(
              (p) => p?.classId && String(p.classId).trim().toUpperCase() !== reqClass
            )
          ) {
            return prev;
          }
          const latestSeq = runtime.latestAppliedLoadSeq.get(reqClass) || 0;
          if (reqSeq < latestSeq) {
            return prev;
          }
          runtime.latestAppliedLoadSeq.set(reqClass, reqSeq);

          const prevList = Array.isArray(prev) ? prev : [];
          if (prevList.length === 0) {
            return validRecords;
          }

          const prevMap = new Map(prevList.map((p) => [p.studentId, p]));
          return validRecords.map((srv: any) => {
            const prevItem = prevMap.get(srv.studentId);
            if (!prevItem) return srv;
            if (
              typeof prevItem.draftVersion === "number" &&
              typeof srv.draftVersion === "number" &&
              prevItem.draftVersion > srv.draftVersion
            ) {
              return prevItem;
            }
            const merged: any = { ...prevItem, ...srv };
            const snapBefore = snapshotsBeforeLoad.get(srv.studentId);
            let hasUnsavedLocalEdit = false;
            if (snapBefore) {
              for (const k of editableKeys) {
                if (
                  JSON.stringify((prevItem as any)[k]) !==
                  JSON.stringify(snapBefore[k])
                ) {
                  merged[k] = (prevItem as any)[k];
                  hasUnsavedLocalEdit = true;
                }
              }
            }
            if (hasUnsavedLocalEdit) {
              merged.status = "WAITING_APPROVAL";
              merged.contentHash = "";
            }
            return merged;
          });
        });
      } catch {}
    },
    [selectedClassId, setSession14Evals]
  );

  if (typeof globalThis !== "undefined") {
    (globalThis as any).__s14LatestRenderedClassId = String(selectedClassId || "")
      .trim()
      .toUpperCase();
  }

  useEffect(() => {
    if (selectedClassId && selectedSessionNumber === 14) {
      loadSession14Evals(selectedClassId);
    }
  }, [selectedClassId, selectedSessionNumber, loadSession14Evals]);

  const handleSaveSession14EvalDraft = async (
    studentId: string,
    patch: Partial<Session14EvalItemUI>
  ): Promise<{ success: boolean; record?: any; conflict?: boolean; error?: string }> => {
    const reqClassId = String(selectedClassId || "").trim().toUpperCase();
    const sid = String(studentId || "").trim();
    if (!reqClassId || !sid)
      return { success: false, error: "Missing classId or studentId" };

    const g = globalThis as any;
    if (!g.__s14EvalRuntime) {
      g.__s14EvalRuntime = {
        inFlightSaves: new Map<string, Promise<any>>(),
        lastServerSnapshots: new Map<string, any>(),
        loadSeq: 0,
        latestAppliedLoadSeq: new Map<string, number>(),
      };
    }
    const runtime = g.__s14EvalRuntime as {
      inFlightSaves: Map<string, Promise<any>>;
      lastServerSnapshots: Map<string, any>;
    };

    const readLiveList = (): Session14EvalItemUI[] => {
      let current: Session14EvalItemUI[] = Array.isArray(session14Evals)
        ? session14Evals
        : [];
      setSession14Evals((prev: Session14EvalItemUI[]) => {
        if (Array.isArray(prev)) current = prev;
        return prev;
      });
      return current;
    };

    const liveBefore = readLiveList();
    const snapshotBeforeSend = liveBefore.find((r) => r.studentId === sid)
      ? JSON.parse(JSON.stringify(liveBefore.find((r) => r.studentId === sid)))
      : undefined;

    const saveKey = `${reqClassId}:${sid}`;
    const editableKeys = [
      "learnedFromMindx",
      "suggestionsFromMindx",
      "futureDirection",
      "awardRanking",
      "awardRankGrade",
      "teacherNote",
      "demoScores",
      "competencyScores",
      "quickTags",
    ] as const;

    let taskPromise!: Promise<any>;
    taskPromise = (async () => {
      try {
        const res = await fetch("/api/spck/session14-eval", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save_draft",
            classId: reqClassId,
            studentId: sid,
            ...(typeof snapshotBeforeSend?.draftVersion === "number"
              ? { expectedVersion: snapshotBeforeSend.draftVersion }
              : {}),
            ...patch,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success) {
          const errMsg =
            data?.error ||
            `Lỗi khi lưu nháp đánh giá Buổi 14 (HTTP ${res.status}).`;
          setBannerMessage({ type: "error", text: errMsg });
          return {
            success: false,
            conflict: Boolean(data?.conflict || res.status === 409),
            error: errMsg,
          };
        }

        if (String(selectedClassId || "").trim().toUpperCase() !== reqClassId) {
          return { success: true, ignoredDueToClassSwitch: true };
        }
        if (
          g.__s14LatestRenderedClassId &&
          String(g.__s14LatestRenderedClassId).trim().toUpperCase() !== reqClassId
        ) {
          return { success: true, ignoredDueToClassSwitch: true };
        }

        const serverRecords: any[] = Array.isArray(data.records) ? data.records : [];
        const srvStudentRec =
          data.record || serverRecords.find((r: any) => r.studentId === sid);
        if (srvStudentRec) {
          runtime.lastServerSnapshots.set(
            saveKey,
            JSON.parse(JSON.stringify(srvStudentRec))
          );
        }

        if (serverRecords.length > 0 || srvStudentRec) {
          setSession14Evals((prev: Session14EvalItemUI[]) => {
            if (String(selectedClassId || "").trim().toUpperCase() !== reqClassId) {
              return prev;
            }
            if (
              g.__s14LatestRenderedClassId &&
              String(g.__s14LatestRenderedClassId).trim().toUpperCase() !== reqClassId
            ) {
              return prev;
            }
            if (
              Array.isArray(prev) &&
              prev.some(
                (p) =>
                  p?.classId && String(p.classId).trim().toUpperCase() !== reqClassId
              )
            ) {
              return prev;
            }
            return (prev || []).map((prevItem) => {
              if (prevItem.studentId !== sid) return prevItem;
              const srv =
                serverRecords.find((r: any) => r.studentId === sid) ||
                srvStudentRec ||
                prevItem;
              if (
                srv.classId &&
                String(srv.classId).trim().toUpperCase() !== reqClassId
              ) {
                return prevItem;
              }
              if (
                typeof prevItem.draftVersion === "number" &&
                typeof srv.draftVersion === "number" &&
                prevItem.draftVersion > srv.draftVersion
              ) {
                return prevItem;
              }
              const merged: any = { ...prevItem, ...srv };
              let hasUnsavedLocalEdit = false;
              if (snapshotBeforeSend) {
                for (const k of editableKeys) {
                  const wasInPatch = Object.prototype.hasOwnProperty.call(patch, k);
                  const currentValStr = JSON.stringify((prevItem as any)[k]);
                  const beforeValStr = JSON.stringify(
                    (snapshotBeforeSend as any)[k]
                  );
                  if (!wasInPatch && currentValStr !== beforeValStr) {
                    merged[k] = (prevItem as any)[k];
                    hasUnsavedLocalEdit = true;
                  } else if (wasInPatch) {
                    const patchValStr = JSON.stringify((patch as any)[k]);
                    if (
                      currentValStr !== patchValStr &&
                      currentValStr !== beforeValStr
                    ) {
                      merged[k] = (prevItem as any)[k];
                      hasUnsavedLocalEdit = true;
                    }
                  }
                }
              }
              if (hasUnsavedLocalEdit) {
                merged.status = "WAITING_APPROVAL";
                merged.contentHash = "";
              }
              return merged;
            });
          });
        }

        return { success: true, record: srvStudentRec };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        setBannerMessage({ type: "error", text: errMsg });
        return { success: false, error: errMsg };
      } finally {
        if (runtime.inFlightSaves.get(saveKey) === taskPromise) {
          runtime.inFlightSaves.delete(saveKey);
        }
      }
    })();

    runtime.inFlightSaves.set(saveKey, taskPromise);
    return taskPromise;
  };

  const handleImportDemoScores = async (options?: {
    isAutoImport?: boolean;
    isMainSync?: boolean;
  }): Promise<{ success: boolean; matchedCount?: number; errorSummary?: string }> => {
    if (!selectedClassId) return { success: false, errorSummary: "Chưa chọn lớp" };
    const reqClassId = String(selectedClassId).trim().toUpperCase();
    const g = globalThis as any;
    const editableKeys = [
      "learnedFromMindx",
      "suggestionsFromMindx",
      "futureDirection",
      "awardRanking",
      "awardRankGrade",
      "teacherNote",
      "demoScores",
      "competencyScores",
      "quickTags",
    ] as const;

    const snapshotsBefore = new Map<string, any>();
    setSession14Evals((prev: Session14EvalItemUI[]) => {
      if (Array.isArray(prev)) {
        for (const item of prev) {
          if (item?.studentId) {
            snapshotsBefore.set(
              item.studentId,
              JSON.parse(JSON.stringify(item))
            );
          }
        }
      }
      return prev;
    });

    setImportingDemoScores(true);
    if (!options?.isAutoImport && !options?.isMainSync) {
      setBannerMessage(null);
    }
    try {
      const source = (demoScoreSourceInput || generatedDemoSheetUrl || "").trim();
      const res = await fetch("/api/spck/session14-eval/import-demo-scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: reqClassId,
          sourcePathOrUrl: source,
          onlyMissingStudents: Boolean(options?.isAutoImport),
        }),
      });
      const data = await res.json();
      if (String(selectedClassId || "").trim().toUpperCase() !== reqClassId) {
        return { success: false, errorSummary: "Đã chuyển sang lớp khác" };
      }
      if (
        g.__s14LatestRenderedClassId &&
        String(g.__s14LatestRenderedClassId).trim().toUpperCase() !== reqClassId
      ) {
        return { success: false, errorSummary: "Đã chuyển sang lớp khác" };
      }
      if (!data.success) {
        if (options?.isMainSync && /(?:^|[-_\s])(PTB|CSB)(?:\d|$|[-_\s])/i.test(reqClassId)) {
          await loadSession14Evals(reqClassId);
          return { success: true, matchedCount: 0 };
        }
        if (!options?.isAutoImport && !options?.isMainSync) {
          setBannerMessage({
            type: "error",
            text: data.error || "Không thể đọc điểm Demo từ file chấm điểm.",
          });
        }
        return {
          success: false,
          errorSummary: data.error || "Không thể đọc điểm Demo BGK",
        };
      }
      if (Array.isArray(data.records)) {
        const validRecords = enrichEvalRecordsWithAwards(
          data.records.filter(
            (r: any) => !r.classId || String(r.classId).trim().toUpperCase() === reqClassId
          ),
          data
        );
        recordS14ServerSnapshots(reqClassId, validRecords);
        hydrateClassSummaryFromPayload(data, reqClassId, validRecords, {
          forceRefresh: !session14DirtyRef.current,
        });
        setSession14Evals((prev: Session14EvalItemUI[]) => {
          if (String(selectedClassId || "").trim().toUpperCase() !== reqClassId) {
            return prev;
          }
          if (
            g.__s14LatestRenderedClassId &&
            String(g.__s14LatestRenderedClassId).trim().toUpperCase() !== reqClassId
          ) {
            return prev;
          }
          if (
            Array.isArray(prev) &&
            prev.some(
              (p) => p?.classId && String(p.classId).trim().toUpperCase() !== reqClassId
            )
          ) {
            return prev;
          }
          const prevList = Array.isArray(prev) ? prev : [];
          if (prevList.length === 0) return validRecords;
          const prevMap = new Map(prevList.map((p) => [p.studentId, p]));
          return validRecords.map((srv: any) => {
            const prevItem = prevMap.get(srv.studentId);
            if (!prevItem) return srv;
            if (options?.isAutoImport && Number(prevItem.demoTotalScore) > 0) {
              return prevItem;
            }
            if (
              typeof prevItem.draftVersion === "number" &&
              typeof srv.draftVersion === "number" &&
              prevItem.draftVersion > srv.draftVersion
            ) {
              return prevItem;
            }
            const merged: any = { ...prevItem, ...srv };
            const snapBefore = snapshotsBefore.get(srv.studentId);
            let hasUnsavedLocalEdit = false;
            if (snapBefore) {
              for (const k of editableKeys) {
                if (
                  JSON.stringify((prevItem as any)[k]) !==
                  JSON.stringify(snapBefore[k])
                ) {
                  merged[k] = (prevItem as any)[k];
                  hasUnsavedLocalEdit = true;
                }
              }
            }
            if (hasUnsavedLocalEdit) {
              merged.status = "WAITING_APPROVAL";
              merged.contentHash = "";
            }
            return merged;
          });
        });
      }
      if (Array.isArray(data.spckRecords) && data.spckRecords.length > 0) {
        const spckByStu = new Map<string, SpckRecordRow>(
          data.spckRecords.map((r: SpckRecordRow) => [r.studentId, r])
        );
        setRows((prev) =>
          prev.map((row) => {
            if (row.isDirty) return row;
            const srvRec = spckByStu.get(row.assignedStudentId);
            if (!srvRec) return row;
            const nextTags = parseJsonSafe<string[]>(srvRec.quickTagsJson, []);
            if (nextTags.length === 0) return row;
            return {
              ...row,
              quickTags: nextTags,
              includePresentation: true,
              draftVersion: srvRec.draftVersion ?? row.draftVersion,
            };
          })
        );
      }
      const matched = data.importResult?.matchedCount || 0;
      if ((matched > 0 || !options?.isAutoImport) && !options?.isMainSync) {
        setBannerMessage({
          type: "success",
          text: `Đã đọc thành công Điểm Demo, xếp hạng Nhất/Nhì/Ba & tính Điểm Năng lực [ĐNL] cho ${matched} học viên lớp ${reqClassId}!`,
        });
      }
      return { success: true, matchedCount: matched };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (!options?.isAutoImport && !options?.isMainSync) {
        setBannerMessage({
          type: "error",
          text: errMsg,
        });
      }
      return { success: false, errorSummary: errMsg };
    } finally {
      setImportingDemoScores(false);
    }
  };

  useEffect(() => {
    if (!selectedClassId || selectedSessionNumber !== 14) return;
    if (importingDemoScores || session14Evals.length === 0) return;
    const reqClassId = String(selectedClassId).trim().toUpperCase();
    const hasMissingDemoScore = session14Evals.some(
      (ev) => !(Number(ev.demoTotalScore) > 0)
    );
    if (!hasMissingDemoScore) return;
    const sourceKey = `${reqClassId}::${(
      demoScoreSourceInput ||
      generatedDemoSheetUrl ||
      ""
    ).trim()}`;
    if (autoImportedDemoClassKeysRef.current.has(sourceKey)) return;
    autoImportedDemoClassKeysRef.current.add(sourceKey);
    void handleImportDemoScores({ isAutoImport: true });
  }, [
    selectedClassId,
    selectedSessionNumber,
    session14Evals,
    importingDemoScores,
    demoScoreSourceInput,
    generatedDemoSheetUrl,
  ]);

  const handleGenerateSession14EvalAi = async (targetStudentIds?: string[]) => {
    if (!selectedClassId) return;
    const reqClassId = String(selectedClassId).trim().toUpperCase();
    const g = globalThis as any;
    const editableKeys = [
      "learnedFromMindx",
      "suggestionsFromMindx",
      "futureDirection",
      "awardRanking",
      "awardRankGrade",
      "teacherNote",
      "demoScores",
      "competencyScores",
      "quickTags",
    ] as const;

    let liveStartList: Session14EvalItemUI[] = Array.isArray(session14Evals)
      ? session14Evals
      : [];
    const snapshotsBefore = new Map<string, any>();
    setSession14Evals((prev: Session14EvalItemUI[]) => {
      if (Array.isArray(prev)) {
        liveStartList = prev;
        for (const item of prev) {
          if (item?.studentId) {
            snapshotsBefore.set(
              item.studentId,
              JSON.parse(JSON.stringify(item))
            );
          }
        }
      }
      return prev;
    });

    const listToGen =
      targetStudentIds && targetStudentIds.length > 0
        ? liveStartList.filter((e) => targetStudentIds.includes(e.studentId))
        : liveStartList.filter(
            (e) =>
              activeStudentIdSet.size === 0 || activeStudentIdSet.has(e.studentId)
          );
    if (listToGen.length === 0) return;

    setGeneratingS14EvalAi(true);
    setBannerMessage(null);
    try {
      const spckRowMap = new Map(rows.map((r) => [r.assignedStudentId, r]));
      const payloadStudents = listToGen.map((ev) => {
        const spckRow = spckRowMap.get(ev.studentId);
        return {
          studentId: ev.studentId,
          expectedVersion: ev.draftVersion,
          competencyScores: ev.competencyScores,
          demoScores: ev.demoScores,
          quickTags:
            ev.quickTags && ev.quickTags.length > 0
              ? ev.quickTags
              : spckRow?.quickTags || [],
          teacherNote: ev.teacherNote || spckRow?.teacherNote || "",
        };
      });

      const res = await fetch("/api/spck/session14-eval/generate-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: reqClassId,
          students: payloadStudents,
        }),
      });
      const data = await res.json();
      if (String(selectedClassId || "").trim().toUpperCase() !== reqClassId) return;
      if (
        g.__s14LatestRenderedClassId &&
        String(g.__s14LatestRenderedClassId).trim().toUpperCase() !== reqClassId
      ) {
        return;
      }
      if (!data.success) {
        for (const ev of listToGen) {
          setStudentToolError(
            ev.studentId,
            "s14_ai",
            data.error || "Lỗi khi AI soạn Thư tổng kết Buổi 14."
          );
        }
        setBannerMessage({
          type: "error",
          text: data.error || "Lỗi khi AI soạn Thư tổng kết Buổi 14.",
        });
        return;
      }
      if (Array.isArray(data.records)) {
        const validRecords = enrichEvalRecordsWithAwards(
          data.records.filter(
            (r: any) => !r.classId || String(r.classId).trim().toUpperCase() === reqClassId
          ),
          data
        );
        recordS14ServerSnapshots(reqClassId, validRecords);
        hydrateClassSummaryFromPayload(data, reqClassId, validRecords, {
          autoShowBox: true,
        });
        setSession14Evals((prev: Session14EvalItemUI[]) => {
          if (String(selectedClassId || "").trim().toUpperCase() !== reqClassId) {
            return prev;
          }
          if (
            g.__s14LatestRenderedClassId &&
            String(g.__s14LatestRenderedClassId).trim().toUpperCase() !== reqClassId
          ) {
            return prev;
          }
          if (
            Array.isArray(prev) &&
            prev.some(
              (p) => p?.classId && String(p.classId).trim().toUpperCase() !== reqClassId
            )
          ) {
            return prev;
          }
          const prevList = Array.isArray(prev) ? prev : [];
          if (prevList.length === 0) return validRecords;
          const prevMap = new Map(prevList.map((p) => [p.studentId, p]));
          return validRecords.map((srv: any) => {
            const prevItem = prevMap.get(srv.studentId);
            if (!prevItem) return srv;
            if (
              typeof prevItem.draftVersion === "number" &&
              typeof srv.draftVersion === "number" &&
              prevItem.draftVersion > srv.draftVersion
            ) {
              return prevItem;
            }
            const merged: any = { ...prevItem, ...srv };
            const snapBefore = snapshotsBefore.get(srv.studentId);
            let hasUnsavedLocalEdit = false;
            if (snapBefore) {
              for (const k of editableKeys) {
                if (
                  JSON.stringify((prevItem as any)[k]) !==
                  JSON.stringify(snapBefore[k])
                ) {
                  merged[k] = (prevItem as any)[k];
                  hasUnsavedLocalEdit = true;
                }
              }
            }
            if (hasUnsavedLocalEdit) {
              merged.status = "WAITING_APPROVAL";
              merged.contentHash = "";
            }
            return merged;
          });
        });
      }
      if (Array.isArray(data.results)) {
        for (const r of data.results) {
          if (!r?.studentId) continue;
          if (r.status === "SUCCESS") {
            setStudentToolError(r.studentId, "s14_ai", null);
          } else {
            setStudentToolError(
              r.studentId,
              "s14_ai",
              r.errorMessage || r.status || "Lỗi AI soạn Thư 3 phần."
            );
          }
        }
      }
      if (!Array.isArray(data.records)) {
        hydrateClassSummaryFromPayload(data, reqClassId, liveStartList, {
          autoShowBox: true,
        });
      }
      const okCount = (data.results || []).filter(
        (r: any) => r.status === "SUCCESS"
      ).length;
      setBannerMessage({
        type: okCount > 0 ? "success" : "warning",
        text: `AI đã soạn xong Thư tổng kết 3 phần (Learned / Suggestions / Future Direction) cho ${okCount}/${listToGen.length} học viên!`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      for (const ev of listToGen) {
        setStudentToolError(ev.studentId, "s14_ai", msg);
      }
      setBannerMessage({
        type: "error",
        text: msg,
      });
    } finally {
      setGeneratingS14EvalAi(false);
    }
  };

  const handleApproveAndUploadSession14Eval = async (
    targetStudentIds?: string[],
    options?: {
      classSummaryHtml?: string;
      allowPartialApproval?: boolean;
      silentBanner?: boolean;
    }
  ): Promise<{
    verifiedCount: number;
    verifiedStudentIds: string[];
    failedCount: number;
    retryStudentIds: string[];
    errorMessage: string | null;
    classSummarySaved?: boolean;
  }> => {
    if (!selectedClassId) {
      return {
        verifiedCount: 0,
        verifiedStudentIds: [],
        failedCount: 0,
        retryStudentIds: targetStudentIds || [],
        errorMessage: "Chưa chọn lớp học.",
      };
    }
    const reqClassId = String(selectedClassId).trim().toUpperCase();

    const readLiveList = (): Session14EvalItemUI[] => {
      let current: Session14EvalItemUI[] = Array.isArray(session14Evals)
        ? session14Evals
        : [];
      setSession14Evals((prev: Session14EvalItemUI[]) => {
        if (Array.isArray(prev)) current = prev;
        return prev;
      });
      return current;
    };

    const currentList = readLiveList();
    const rawIds =
      targetStudentIds && targetStudentIds.length > 0
        ? targetStudentIds
        : currentList
            .filter(
              (ev) =>
                (activeStudentIdSet.size === 0 ||
                  activeStudentIdSet.has(ev.studentId)) &&
                ev.learnedFromMindx.trim() &&
                ev.suggestionsFromMindx.trim() &&
                ev.futureDirection.trim()
            )
            .map((ev) => ev.studentId);
    const ids = rawIds.filter(
      (sid) => activeStudentIdSet.size === 0 || activeStudentIdSet.has(sid)
    );

    if (ids.length === 0) {
      const warnMsg =
        "Chưa có học viên nào đủ nội dung 3 phần Thư từ MindX để duyệt và đẩy lên LMS.";
      if (!options?.silentBanner) {
        setBannerMessage({
          type: "warning",
          text: warnMsg,
        });
      }
      return {
        verifiedCount: 0,
        verifiedStudentIds: [],
        failedCount: 0,
        retryStudentIds: [],
        errorMessage: warnMsg,
      };
    }

    const g = globalThis as any;
    const runtime = g.__s14EvalRuntime as
      | {
          inFlightSaves: Map<string, Promise<any>>;
          lastServerSnapshots: Map<string, any>;
        }
      | undefined;

    setUploadingS14EvalLms(true);
    if (!options?.silentBanner) {
      setBannerMessage(null);
    }
    const preApproveFailedIds: string[] = [];
    try {
      const candidateApproveIds: string[] = [];
      if (runtime) {
        for (const sid of ids) {
          const saveKey = `${reqClassId}:${sid}`;
          const pending = runtime.inFlightSaves.get(saveKey);
          if (pending) {
            const raceRes = await Promise.race([
              pending,
              new Promise<{ timedOut: true }>((resolve) =>
                setTimeout(() => resolve({ timedOut: true }), 5000)
              ),
            ]);
            if (raceRes && (raceRes as any).timedOut) {
              if (options?.allowPartialApproval && ids.length > 1) {
                preApproveFailedIds.push(sid);
                continue;
              }
              const errMsg = `Thao tác lưu nháp của học viên ${sid} chưa hoàn tất. Đã dừng duyệt và đẩy LMS để tránh gửi bản cũ.`;
              setBannerMessage({
                type: "error",
                text: errMsg,
              });
              return {
                verifiedCount: 0,
                verifiedStudentIds: [],
                failedCount: ids.length,
                retryStudentIds: ids,
                errorMessage: errMsg,
              };
            }
            if (!raceRes || !raceRes.success) {
              if (options?.allowPartialApproval && ids.length > 1) {
                preApproveFailedIds.push(sid);
                continue;
              }
              return {
                verifiedCount: 0,
                verifiedStudentIds: [],
                failedCount: ids.length,
                retryStudentIds: ids,
                errorMessage: "Lưu nháp thất bại trước khi duyệt.",
              };
            }
          }
          candidateApproveIds.push(sid);
        }
      } else {
        candidateApproveIds.push(...ids);
      }

      const latestBeforeApprove = readLiveList();
      const expectedVersions: Record<string, number> = {};
      const flushedIds: string[] = [];

      for (const sid of candidateApproveIds) {
        const visibleItem = latestBeforeApprove.find((r) => r.studentId === sid);
        if (!visibleItem) {
          flushedIds.push(sid);
          continue;
        }
        const saveKey = `${reqClassId}:${sid}`;
        const lastSrv = runtime?.lastServerSnapshots.get(saveKey);
        const needsFlush =
          !lastSrv ||
          lastSrv.learnedFromMindx !== visibleItem.learnedFromMindx ||
          lastSrv.suggestionsFromMindx !== visibleItem.suggestionsFromMindx ||
          lastSrv.futureDirection !== visibleItem.futureDirection ||
          String(lastSrv.awardRanking || "") !==
            String(visibleItem.awardRanking || "") ||
          (visibleItem.teacherNote !== undefined &&
            lastSrv.teacherNote !== visibleItem.teacherNote);

        if (needsFlush) {
          const flushPromise = handleSaveSession14EvalDraft(sid, {
            learnedFromMindx: visibleItem.learnedFromMindx,
            suggestionsFromMindx: visibleItem.suggestionsFromMindx,
            futureDirection: visibleItem.futureDirection,
            awardRanking: visibleItem.awardRanking || "",
            teacherNote: visibleItem.teacherNote,
            demoScores: visibleItem.demoScores,
            competencyScores: visibleItem.competencyScores,
            quickTags: visibleItem.quickTags,
          });
          const flushRes = await Promise.race([
            flushPromise,
            new Promise<{ timedOut: true }>((resolve) =>
              setTimeout(() => resolve({ timedOut: true }), 5000)
            ),
          ]);
          if (
            !flushRes ||
            (flushRes as any).timedOut ||
            !(flushRes as any).success
          ) {
            if (options?.allowPartialApproval && candidateApproveIds.length > 1) {
              preApproveFailedIds.push(sid);
              continue;
            }
            const errMsg = `Không thể lưu bản đang hiển thị của học viên ${sid} trước khi duyệt.`;
            setBannerMessage({
              type: "error",
              text: errMsg,
            });
            return {
              verifiedCount: 0,
              verifiedStudentIds: [],
              failedCount: ids.length,
              retryStudentIds: ids,
              errorMessage: errMsg,
            };
          }
          if (typeof (flushRes as any).record?.draftVersion === "number") {
            expectedVersions[sid] = (flushRes as any).record.draftVersion;
          }
        } else if (typeof lastSrv?.draftVersion === "number") {
          expectedVersions[sid] = lastSrv.draftVersion;
        } else if (typeof visibleItem.draftVersion === "number") {
          expectedVersions[sid] = visibleItem.draftVersion;
        }
        flushedIds.push(sid);
      }

      if (flushedIds.length === 0) {
        const errMsg = "Không thể lưu bản nháp đánh giá Buổi 14 cho học viên nào trước khi duyệt.";
        if (!options?.silentBanner) {
          setBannerMessage({ type: "error", text: errMsg });
        }
        return {
          verifiedCount: 0,
          verifiedStudentIds: [],
          failedCount: ids.length,
          retryStudentIds: ids,
          errorMessage: errMsg,
        };
      }

      if (String(selectedClassId || "").trim().toUpperCase() !== reqClassId) {
        return {
          verifiedCount: 0,
          verifiedStudentIds: [],
          failedCount: 0,
          retryStudentIds: [],
          errorMessage: null,
        };
      }
      if (
        g.__s14LatestRenderedClassId &&
        String(g.__s14LatestRenderedClassId).trim().toUpperCase() !== reqClassId
      ) {
        return {
          verifiedCount: 0,
          verifiedStudentIds: [],
          failedCount: 0,
          retryStudentIds: [],
          errorMessage: null,
        };
      }

      const snapshotsBeforeUpload = new Map<string, any>();
      for (const item of readLiveList()) {
        if (item?.studentId) {
          snapshotsBeforeUpload.set(
            item.studentId,
            JSON.parse(JSON.stringify(item))
          );
        }
      }

      if (session14ClassSummaryDirty && session14ClassSummaryText.trim()) {
        await handlePersistSession14ClassSummary(
          session14ClassSummaryText,
          true
        );
      }

      const appRes = await fetch("/api/spck/session14-eval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          classId: reqClassId,
          studentIds: flushedIds,
          expectedVersions,
          ...(options?.allowPartialApproval
            ? { isolatePerStudent: true, allowPartial: true }
            : {}),
          ...(flushedIds.length === 1 &&
          expectedVersions[flushedIds[0]] !== undefined
            ? { expectedVersion: expectedVersions[flushedIds[0]] }
            : {}),
        }),
      });
      const appData = await appRes.json().catch(() => ({}));
      const approvedIds: string[] = Array.isArray(appData.approvedIds)
        ? appData.approvedIds
        : [];
      const approvalRejectedIds = flushedIds.filter(
        (sid) => !approvedIds.includes(sid)
      );
      if (
        approvedIds.length === 0 ||
        (!options?.allowPartialApproval &&
          (!appRes.ok || !appData.success || approvedIds.length !== flushedIds.length))
      ) {
        const errMsg =
          appData.errors?.[0]?.error ||
          appData.error ||
          "Không thể duyệt đánh giá Buổi 14 trước khi đẩy lên LMS.";
        if (!options?.silentBanner) {
          setBannerMessage({
            type: "error",
            text: errMsg,
          });
        }
        return {
          verifiedCount: 0,
          verifiedStudentIds: [],
          failedCount: ids.length,
          retryStudentIds: ids,
          errorMessage: errMsg,
        };
      }

      const resolvedSummaryHtml =
        options?.classSummaryHtml !== undefined
          ? options.classSummaryHtml
          : getEffectiveClassSummaryHtml();

      const upRes = await fetch("/api/spck/session14-eval/upload-lms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: reqClassId,
          studentIds: approvedIds,
          ...(resolvedSummaryHtml
            ? { classSummaryHtml: resolvedSummaryHtml, uploadClassSummary: true }
            : {}),
          ...(options?.allowPartialApproval
            ? { skipUnapproved: true, allowPartial: true }
            : {}),
        }),
      });
      const upData = await upRes.json();
      if (String(selectedClassId || "").trim().toUpperCase() !== reqClassId) {
        return {
          verifiedCount: 0,
          verifiedStudentIds: [],
          failedCount: 0,
          retryStudentIds: [],
          errorMessage: null,
        };
      }
      if (
        g.__s14LatestRenderedClassId &&
        String(g.__s14LatestRenderedClassId).trim().toUpperCase() !== reqClassId
      ) {
        return {
          verifiedCount: 0,
          verifiedStudentIds: [],
          failedCount: 0,
          retryStudentIds: [],
          errorMessage: null,
        };
      }
      if (Array.isArray(upData.records) && upData.records.length > 0) {
        const validRecords = enrichEvalRecordsWithAwards(
          upData.records.filter(
            (r: any) => !r.classId || String(r.classId).trim().toUpperCase() === reqClassId
          ),
          upData
        );
        recordS14ServerSnapshots(reqClassId, validRecords);
        const editableKeys = [
          "learnedFromMindx",
          "suggestionsFromMindx",
          "futureDirection",
          "awardRanking",
          "teacherNote",
          "demoScores",
          "competencyScores",
          "quickTags",
        ] as const;
        setSession14Evals((prev: Session14EvalItemUI[]) => {
          if (String(selectedClassId || "").trim().toUpperCase() !== reqClassId) {
            return prev;
          }
          if (
            g.__s14LatestRenderedClassId &&
            String(g.__s14LatestRenderedClassId).trim().toUpperCase() !== reqClassId
          ) {
            return prev;
          }
          if (
            Array.isArray(prev) &&
            prev.some(
              (p) => p?.classId && String(p.classId).trim().toUpperCase() !== reqClassId
            )
          ) {
            return prev;
          }
          const prevList = Array.isArray(prev) ? prev : [];
          if (prevList.length === 0) return validRecords;
          const prevMap = new Map(prevList.map((p) => [p.studentId, p]));
          return validRecords.map((srv: any) => {
            const prevItem = prevMap.get(srv.studentId);
            if (!prevItem) return srv;
            if (
              typeof prevItem.draftVersion === "number" &&
              typeof srv.draftVersion === "number" &&
              prevItem.draftVersion > srv.draftVersion
            ) {
              return prevItem;
            }
            const merged: any = { ...prevItem, ...srv };
            const snapBefore = snapshotsBeforeUpload.get(srv.studentId);
            let hasUnsavedLocalEdit = false;
            if (snapBefore) {
              for (const k of editableKeys) {
                if (
                  JSON.stringify((prevItem as any)[k]) !==
                  JSON.stringify(snapBefore[k])
                ) {
                  merged[k] = (prevItem as any)[k];
                  hasUnsavedLocalEdit = true;
                }
              }
            }
            if (hasUnsavedLocalEdit) {
              merged.status = "WAITING_APPROVAL";
              merged.contentHash = "";
            }
            return merged;
          });
        });
      } else if (Array.isArray(upData.uploadResult?.results)) {
        const resByStu = new Map<string, any>(
          upData.uploadResult.results
            .filter((r: any) => r?.studentId)
            .map((r: any) => [String(r.studentId), r])
        );
        setSession14Evals((prev: Session14EvalItemUI[]) => {
          if (!Array.isArray(prev) || prev.length === 0) return prev;
          if (String(selectedClassId || "").trim().toUpperCase() !== reqClassId) {
            return prev;
          }
          return prev.map((item) => {
            const r = resByStu.get(item.studentId);
            if (!r || !r.status) return item;
            return {
              ...item,
              status: r.status,
              errorMessage: r.errorMessage || null,
            };
          });
        });
      }
      if (!upRes.ok || (!upData?.success && !upData?.uploadResult)) {
        const errMsg =
          upData?.error ||
          `Lỗi khi đẩy đánh giá Buổi 14 lên LMS (HTTP ${upRes.status}).`;
        if (!options?.silentBanner) {
          setBannerMessage({
            type: "error",
            text: errMsg,
          });
        }
        return {
          verifiedCount: 0,
          verifiedStudentIds: [],
          failedCount: approvedIds.length + preApproveFailedIds.length + approvalRejectedIds.length,
          retryStudentIds: Array.from(
            new Set([...approvedIds, ...preApproveFailedIds, ...approvalRejectedIds])
          ),
          errorMessage: errMsg,
        };
      }
      const verCount = upData.uploadResult?.verifiedCount || 0;
      const uploadFailCount = upData.uploadResult?.failedCount || 0;
      const verifiedStudentIds = Array.isArray(upData.uploadResult?.results)
        ? upData.uploadResult.results
            .filter((r: any) => r.status === "VERIFIED")
            .map((r: any) => String(r.studentId || ""))
            .filter(Boolean)
        : verCount > 0 && uploadFailCount === 0
        ? approvedIds
        : [];
      const uploadFailedRetryIds = Array.isArray(upData.uploadResult?.results)
        ? upData.uploadResult.results
            .filter((r: any) => r.status !== "VERIFIED")
            .map((r: any) => String(r.studentId || ""))
            .filter(Boolean)
        : uploadFailCount > 0
        ? approvedIds
        : [];
      const failedRetryIds = Array.from(
        new Set([
          ...uploadFailedRetryIds,
          ...preApproveFailedIds,
          ...approvalRejectedIds,
        ])
      );
      const failCount = failedRetryIds.length;
      const firstFailedItem = Array.isArray(upData.uploadResult?.results)
        ? upData.uploadResult.results.find(
            (r: any) => r.status === "FAILED" && r.errorMessage
          )
        : null;
      const firstApproveErr = appData.errors?.[0]?.error;
      const statusText =
        failCount > 0
          ? `Đã đẩy & xác minh ${verCount}/${ids.length} học viên lên LMS (${failCount} cần kiểm tra${
              firstFailedItem
                ? ` — ${firstFailedItem.fullName || firstFailedItem.studentId}: ${firstFailedItem.errorMessage}`
                : firstApproveErr
                ? ` — ${firstApproveErr}`
                : ""
            })`
          : `Đã đẩy & xác minh (Read-after-Write) đánh giá tổng kết + Điểm Demo + Summary Buổi 14 cho ${verCount}/${approvedIds.length} học viên lên LMS!`;
      if (!options?.silentBanner) {
        setBannerMessage({
          type:
            failCount === 0 && verCount > 0
              ? "success"
              : verCount > 0
              ? "warning"
              : failCount > 0
              ? "error"
              : "warning",
          text: statusText,
        });
      }
      return {
        verifiedCount: verCount,
        verifiedStudentIds,
        failedCount: failCount,
        retryStudentIds: failedRetryIds,
        errorMessage:
          failCount > 0
            ? firstFailedItem?.errorMessage ||
              firstApproveErr ||
              "Một số học viên lỗi lưu Đánh giá Buổi 14."
            : null,
        classSummarySaved: Boolean(
          upData.uploadResult?.classSummaryStatus === "VERIFIED" ||
            upData.uploadResult?.classSummarySaved ||
            upData.uploadResult?.summarySaved ||
            (upData.uploadResult?.classSummaryStatus !== "FAILED" &&
              Boolean(resolvedSummaryHtml))
        ),
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (!options?.silentBanner) {
        setBannerMessage({
          type: "error",
          text: errMsg,
        });
      }
      return {
        verifiedCount: 0,
        verifiedStudentIds: [],
        failedCount: ids.length,
        retryStudentIds: ids,
        errorMessage: errMsg,
      };
    } finally {
      setUploadingS14EvalLms(false);
    }
  };

  useEffect(() => {
    if (!selectedClassId || loadingInit) {
      portalLastCheckedTargetRef.current = null;
      return;
    }
    let cancelled = false;
    let effectSubscribedEntry: {
      promise: Promise<any>;
      controller: AbortController;
      subscribers: number;
    } | null = null;

    const reqClassId = selectedClassId;
    const reqClassUpper = reqClassId.trim().toUpperCase();
    const reqSessionNum = selectedSessionNumber;
    const targetKey = `${reqClassUpper}::${reqSessionNum}`;
    const PORTAL_GET_TIMEOUT_MS = 3000;

    const releaseEffectSubscription = () => {
      if (!effectSubscribedEntry) return;
      const entry = effectSubscribedEntry;
      effectSubscribedEntry = null;
      entry.subscribers = Math.max(0, entry.subscribers - 1);
      if (entry.subscribers === 0) {
        entry.controller.abort();
      }
    };

    const fetchOrJoinPortalStatus = (): Promise<any> => {
      const existing = portalInFlightByTargetRef.current.get(targetKey);
      if (existing) {
        if (effectSubscribedEntry === existing) {
          return Promise.resolve(null);
        }
        releaseEffectSubscription();
        existing.subscribers += 1;
        effectSubscribedEntry = existing;
        return existing.promise;
      }

      const knownEntry = portalKnownStateVersionRef.current;
      const versionQuery =
        knownEntry &&
        knownEntry.classId === reqClassId &&
        knownEntry.sessionNumber === reqSessionNum
          ? `&knownStateVersion=${knownEntry.stateVersion}`
          : "";

      const controller = new AbortController();
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const rawPromise = fetch(
        `/api/spck/student-portal?classId=${encodeURIComponent(
          reqClassId
        )}&sessionNumber=${reqSessionNum}${versionQuery}`,
        { signal: controller.signal }
      ).then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json();
      });

      const racedPromise = new Promise<any>((resolve, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          if (portalInFlightByTargetRef.current.get(targetKey) === entry) {
            portalInFlightByTargetRef.current.delete(targetKey);
          }
          reject(new Error("PORTAL_GET_TIMEOUT"));
        }, PORTAL_GET_TIMEOUT_MS);

        rawPromise.then(
          (val) => {
            if (timeoutId) clearTimeout(timeoutId);
            if (portalInFlightByTargetRef.current.get(targetKey) === entry) {
              portalInFlightByTargetRef.current.delete(targetKey);
            }
            resolve(val);
          },
          (err) => {
            if (timeoutId) clearTimeout(timeoutId);
            if (portalInFlightByTargetRef.current.get(targetKey) === entry) {
              portalInFlightByTargetRef.current.delete(targetKey);
            }
            reject(err);
          }
        );
      });

      const entry = {
        promise: racedPromise,
        controller,
        subscribers: 1,
      };
      portalInFlightByTargetRef.current.set(targetKey, entry);
      releaseEffectSubscription();
      effectSubscribedEntry = entry;
      return racedPromise;
    };

    const checkPortalOnce = async () => {
      if (cancelled) return;
      try {
        const data = await fetchOrJoinPortalStatus();
        if (!data || cancelled || !data.success || !data.portalStatus) return;
        if (
          !isCurrentPortalUiClassMatch(reqClassUpper) ||
          latestSelectedSessionRef.current !== reqSessionNum
        ) {
          return;
        }

        portalLastCheckedTargetRef.current = {
          classId: reqClassId,
          sessionNumber: reqSessionNum,
        };
        if (typeof data.portalStatus.stateVersion === "number") {
          portalKnownStateVersionRef.current = {
            classId: reqClassId,
            sessionNumber: reqSessionNum,
            stateVersion: data.portalStatus.stateVersion,
          };
        }
        latestApplyPortalStatusRef.current(data.portalStatus);

        if (data.unchanged === true) {
          return;
        }

        if (
          data.portalStatus.isRunning &&
          Array.isArray(data.records) &&
          data.records.length > 0
        ) {
          const dbRecords: SpckRecordRow[] = data.records;
          const currentStudents = latestStudentsRef.current;
          setRows((prev) => {
            if (
              !isCurrentPortalUiClassMatch(reqClassUpper) ||
              latestSelectedSessionRef.current !== reqSessionNum
            ) {
              return prev;
            }
            if (prev.length === 0) {
              const studentMap = new Map(currentStudents.map((s) => [s.studentId, s]));
              return dbRecords.map((rec) =>
                buildRowFromDbRecord(
                  rec,
                  studentMap.get(rec.studentId),
                  reqSessionNum
                )
              );
            }

            const existingIds = new Set(prev.map((r) => r.assignedStudentId));
            const studentMap = new Map(currentStudents.map((s) => [s.studentId, s]));
            let anyChanged = false;
            const updatedRows = prev.map((row) => {
              const rec = dbRecords.find(
                (r) => r.studentId === row.assignedStudentId
              );
              if (!rec) return row;
              const mergedRow = mergePortalRecordIntoUiRow(row, rec);
              if (mergedRow !== row) {
                anyChanged = true;
              }
              return mergedRow;
            });

            for (const rec of dbRecords) {
              if (!existingIds.has(rec.studentId)) {
                anyChanged = true;
                updatedRows.push(
                  buildRowFromDbRecord(
                    rec,
                    studentMap.get(rec.studentId),
                    reqSessionNum
                  )
                );
              }
            }
            return anyChanged ? updatedRows : prev;
          });
        }
      } catch {
      } finally {
        if (
          effectSubscribedEntry &&
          portalInFlightByTargetRef.current.get(targetKey) !== effectSubscribedEntry
        ) {
          effectSubscribedEntry = null;
        }
      }
    };

    const lastChecked = portalLastCheckedTargetRef.current;
    const alreadyCheckedCurrentTarget =
      lastChecked !== null &&
      lastChecked.classId === reqClassId &&
      lastChecked.sessionNumber === reqSessionNum;

    if (!alreadyCheckedCurrentTarget) {
      void checkPortalOnce();
    }
    if (!studentPortalRunning) {
      return () => {
        cancelled = true;
        releaseEffectSubscription();
      };
    }

    const interval = setInterval(checkPortalOnce, 3500);
    return () => {
      cancelled = true;
      clearInterval(interval);
      releaseEffectSubscription();
    };
  }, [
    selectedClassId,
    selectedSessionNumber,
    loadingInit,
    studentPortalRunning,
    isCurrentPortalUiClassMatch,
    setRows,
  ]);

  const activeBusyDescription = useMemo(() => {
    if (mainStep3PhaseLabel) {
      return mainStep3PhaseLabel;
    }
    if (autoPrepStepProgress) {
      return autoPrepStepProgress;
    }
    if (mainSyncRunning) {
      return "Đang đồng bộ bài làm trọn gói (Quét bài • Chụp ảnh 16:9 • GitHub Live • Google Drive)...";
    }
    if (restoringBackupStudentId) {
      return "Đang khôi phục bản nộp trước từ kho dự phòng cho học viên...";
    }
    if (refreshingStudentId) {
      return "Đang làm mới trọn gói (Chụp lại 16:9 • GitHub Live • Đóng gói .zip lên Drive) cho học viên...";
    }
    if (session14ComboStatus.running) {
      if (session14ComboStatus.currentPhase === "spck") {
        return "[1/4] Đang duyệt và nộp Sản phẩm SPCK (Cột 3) Buổi 14 lên LMS...";
      }
      if (session14ComboStatus.currentPhase === "eval") {
        return "[2/4] Đang duyệt và đẩy Đánh giá tổng kết, Điểm Demo & Summary (Cột 2) Buổi 14 lên LMS...";
      }
      if (session14ComboStatus.currentPhase === "teaching_progress") {
        return "[3/4] Đang cập nhật Tiến độ dự án lên 100% trên Teaching...";
      }
      if (session14ComboStatus.currentPhase === "report_card") {
        return "[4/4] Đang quét điểm LMS & đồng bộ Phiếu điểm cuối khóa sang Teaching...";
      }
    }
    if (uploading) {
      return (
        activeActionLabel ||
        `Đang nộp SPCK lên LMS — Buổi ${selectedSessionNumber} (${effectiveSelectedStudentIds.length} bài)...`
      );
    }
    if (uploadingS14EvalLms) {
      return "Đang duyệt và đẩy Đánh giá tổng kết Buổi 14 (Điểm Demo, ĐNL, Summary & Thư từ MindX) lên LMS...";
    }
    if (generatingS14EvalAi) {
      return "Đang gọi AI soạn Thư tổng kết 3 phần (Buổi 14) cho học viên...";
    }
    if (importingDemoScores) {
      return "Đang đọc Điểm Demo BGK, xếp hạng Nhất/Nhì/Ba & tính Điểm Năng lực [ĐNL]...";
    }
    if (scanning)
      return "Đang quét thư mục sản phẩm trên máy và khớp danh sách học viên...";
    if (generatingAi)
      return "Đang gọi AI soạn nhận xét cuối khóa cho các học viên...";
    if (uploadingDrive)
      return "Đang đóng gói .zip & tải sản phẩm lên Google Drive (Xóa cũ – Thêm mới)...";
    if (deployingWeb)
      return "Đang đẩy sản phẩm lên GitHub Pages (Xóa cũ – Thêm mới) & gắn link chạy thử...";
    if (creatingDemoSheet)
      return "Đang tạo Bảng chấm điểm buổi Demo trên Google Drive...";
    if (capturingScreenshots)
      return "Đang chụp mới giao diện 16:9 và chọn ảnh bìa (Thumbnail)...";
    if (importingYoutube)
      return "Đang đọc Playlist YouTube, khớp tên học viên và lấy 2 ảnh thuyết trình cho từng bạn...";
    if (scanningTeacherClasses)
      return "Đang quét danh sách lớp từ tài khoản giáo viên...";
    return "";
  }, [
    mainStep3PhaseLabel,
    autoPrepStepProgress,
    mainSyncRunning,
    restoringBackupStudentId,
    refreshingStudentId,
    session14ComboStatus.running,
    session14ComboStatus.currentPhase,
    uploading,
    uploadingS14EvalLms,
    generatingS14EvalAi,
    importingDemoScores,
    activeActionLabel,
    selectedSessionNumber,
    effectiveSelectedStudentIds.length,
    scanning,
    generatingAi,
    uploadingDrive,
    deployingWeb,
    creatingDemoSheet,
    capturingScreenshots,
    importingYoutube,
    scanningTeacherClasses,
  ]);

  const selectedClassMeta = useMemo(
    () => classes.find((c) => c.classId === selectedClassId),
    [classes, selectedClassId]
  );

  const isSpckExemptClass = useMemo(() => {
    const classText = `${selectedClassId} ${selectedClassMeta?.className || ""}`.toUpperCase();
    return /(?:^|[-_\s])(PTB|CSB)(?:\d|$|[-_\s])/i.test(classText);
  }, [selectedClassId, selectedClassMeta]);

  const isRoboticsClass = useMemo(() => {
    const classText = `${selectedClassId} ${selectedClassMeta?.className || ""}`.toUpperCase();
    return /\b(ROB|ROBO|ROBOT|ROBOTICS|PREB|PREA|PREI|ARM|ARMA|ARMB|ARMI|SEM|SEMA|SEMB|SEMI|EV3|VEX|SPIKE|WEDO|ARDUINO)[A-Z0-9]*\b/i.test(
      classText
    );
  }, [selectedClassId, selectedClassMeta]);

  const activeDemoScoreItems: Array<{
    key: keyof Session14DemoScoresUI;
    label: string;
    max: number;
  }> = useMemo(
    () => getDemoScoreItemsForClassUi(selectedClassId, isRoboticsClass),
    [selectedClassId, isRoboticsClass]
  );

  const totalStepsCount = 3;

  const isWebClassOrProduct = useMemo(() => {
    const classText = `${selectedClassId} ${selectedClassMeta?.className || ""}`.toUpperCase();
    const hasWebOrCsGithubCode = /\b(JSB|JSA|JSI|CSA|CSI|WEB|HTML)[A-Z0-9]*\b/.test(
      classText
    );
    const hasNonWebTrackCode = /\b(PTA|PTI|PTB|CSB|GMA|GMI|GMB|GA|GB|GI|SB|SA|SI)[A-Z0-9]*\b/.test(
      classText
    );
    const hasHtmlFiles = rows.some(
      (r) =>
        r.hasHtmlFiles === true ||
        (r.attachments || []).some((f) => /(\.html?|_web_package\.zip)$/i.test(f)) ||
        /github\.io/i.test(r.relatedLinksText || "")
    );
    if (/\b(CSA|CSI)[A-Z0-9]*\b/.test(classText)) {
      return hasHtmlFiles || rows.length === 0;
    }
    return hasWebOrCsGithubCode || (!hasNonWebTrackCode && hasHtmlFiles);
  }, [selectedClassId, selectedClassMeta, rows]);

  const isAppOrGameProduct = useMemo(() => {
    const classText = `${selectedClassId} ${selectedClassMeta?.className || ""}`.toUpperCase();
    const hasAppClassCode = /\b(PTA|PTI|PTB|CSI|CSA|CSB|GMA|GMI|GMB|GA|GB|GI|SB|SA|SI|GAME|APP|PYTHON|SCRATCH)[A-Z0-9]*\b/.test(
      classText
    );
    const hasAppFiles = rows.some((r) =>
      (r.attachments || []).some((f) =>
        /(\.(ui|py|sb3|apk|exe|gmx|yyz|rbxl|html?)|_(web|app)_package\.zip)$/i.test(f)
      )
    );
    return hasAppClassCode || hasAppFiles || !isWebClassOrProduct;
  }, [selectedClassId, selectedClassMeta, rows, isWebClassOrProduct]);

  // Do not auto-open YouTube playlist panel for Robotics by default (teacher can open Ngăn 1 manually if recording videos)
  useEffect(() => {
    if (studentPortalRunning) {
      setShowOptionalTools(true);
    }
  }, [studentPortalRunning, setShowOptionalTools]);

  // Auto-open Ngăn 2 ("Tùy chọn nâng cao") only when partial errors require manual retry
  useEffect(() => {
    const hasToolErr = Object.values(toolErrorsByStudent).some(
      (map) => map && Object.keys(map).length > 0
    );
    const hasFailedSpck = Boolean(
      lastSubmissionSummary && lastSubmissionSummary.failedItems.length > 0
    );
    const hasFailedS14 = session14ComboStatus.evalFailedCount > 0;
    if (hasToolErr || hasFailedSpck || hasFailedS14) {
      setShowAdvancedTools(true);
    }
  }, [
    toolErrorsByStudent,
    lastSubmissionSummary,
    session14ComboStatus.evalFailedCount,
  ]);

  const pushTeachingProgressInternal = useCallback(
    async (
      targetClassCode: string,
      milestoneTaskCount: 3 | 4 | 5
    ): Promise<SpckTeachingProgressPushResultUI> => {
      const targetPercent: 60 | 80 | 100 =
        milestoneTaskCount === 3 ? 60 : milestoneTaskCount === 4 ? 80 : 100;
      setTeachingProgressPushState({
        status: "RUNNING",
        targetPercent,
        updatedCount: null,
        message: `Đang cập nhật Tiến độ dự án Teaching lên ${targetPercent}%...`,
      });
      try {
        const res = await fetch("/api/teaching-projects/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            classCode: targetClassCode,
            milestoneTaskCount,
            resetOthers: false,
            allowDecrease: false,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.success === false) {
          const warnMsg =
            data?.error ||
            `Cảnh báo Tiến độ dự án Teaching (${targetPercent}%): HTTP ${res.status}`;
          const nextState: SpckTeachingProgressPushResultUI = {
            status: "WARNING",
            targetPercent,
            updatedCount: null,
            message: warnMsg,
          };
          setTeachingProgressPushState(nextState);
          return nextState;
        }
        const updatedCount =
          typeof data?.updatedCount === "number"
            ? data.updatedCount
            : typeof data?.result?.updatedCount === "number"
            ? data.result.updatedCount
            : null;
        const warnText =
          data?.warning ||
          (Array.isArray(data?.warnings) && data.warnings.length > 0
            ? data.warnings.join("; ")
            : "");
        const nextState: SpckTeachingProgressPushResultUI = {
          status: warnText ? "WARNING" : "SUCCESS",
          targetPercent,
          updatedCount,
          message:
            warnText ||
            data?.message ||
            `Đã cập nhật Tiến độ dự án Teaching lên ${targetPercent}%!`,
        };
        setTeachingProgressPushState(nextState);
        return nextState;
      } catch (err) {
        const warnMsg = `Cảnh báo Tiến độ dự án Teaching (${targetPercent}%): ${
          err instanceof Error ? err.message : String(err)
        }`;
        const nextState: SpckTeachingProgressPushResultUI = {
          status: "WARNING",
          targetPercent,
          updatedCount: null,
          message: warnMsg,
        };
        setTeachingProgressPushState(nextState);
        return nextState;
      }
    },
    []
  );

  const runReportCardSyncChainInternal = useCallback(
    async (targetClassId: string): Promise<SpckReportCardChainResultUI> => {
      setReportCardChainState({
        status: "RUNNING",
        syncedScoreCount: null,
        matchedStudentCount: null,
        skippedStudentCount: null,
        warningMessage: "Đang quét Phiếu điểm cuối khóa từ LMS...",
      });
      try {
        const scrapeRes = await fetch("/api/report-card", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "scrape_lms",
            classId: targetClassId,
          }),
        });
        const scrapeData = await scrapeRes.json().catch(() => ({}));
        if (!scrapeRes.ok || !scrapeData?.success) {
          const nextState: SpckReportCardChainResultUI = {
            status: "WARNING",
            syncedScoreCount: null,
            matchedStudentCount: null,
            skippedStudentCount: null,
            warningMessage:
              scrapeData?.error ||
              `Chưa thể quét Phiếu điểm cuối khóa từ LMS (HTTP ${scrapeRes.status}).`,
          };
          setReportCardChainState(nextState);
          return nextState;
        }

        const scrapedVersion = scrapeData?.record?.draftVersion;
        const approveRes = await fetch("/api/report-card", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "approve",
            classId: targetClassId,
            ...(typeof scrapedVersion === "number"
              ? { expectedVersion: scrapedVersion }
              : {}),
          }),
        });
        const approveData = await approveRes.json().catch(() => ({}));
        if (!approveRes.ok || !approveData?.success) {
          const nextState: SpckReportCardChainResultUI = {
            status: "WARNING",
            syncedScoreCount: null,
            matchedStudentCount: null,
            skippedStudentCount: null,
            warningMessage:
              approveData?.error ||
              `Chưa thể tự động duyệt Phiếu điểm cuối khóa (HTTP ${approveRes.status}).`,
          };
          setReportCardChainState(nextState);
          return nextState;
        }

        const approvedVersion =
          approveData?.record?.draftVersion ?? scrapedVersion;
        const syncRes = await fetch("/api/report-card/sync-teaching", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            classId: targetClassId,
            classCode: targetClassId,
            ...(typeof approvedVersion === "number"
              ? { expectedVersion: approvedVersion }
              : {}),
          }),
        });
        const syncData = await syncRes.json().catch(() => ({}));
        if (!syncRes.ok || !syncData?.success) {
          const nextState: SpckReportCardChainResultUI = {
            status: "WARNING",
            syncedScoreCount: null,
            matchedStudentCount: null,
            skippedStudentCount: null,
            warningMessage:
              syncData?.error ||
              `Cảnh báo đồng bộ Phiếu điểm sang Teaching (HTTP ${syncRes.status}).`,
          };
          setReportCardChainState(nextState);
          return nextState;
        }

        const syncedScoreCount =
          typeof syncData.syncedScoreCount === "number"
            ? syncData.syncedScoreCount
            : null;
        const matchedStudentCount =
          typeof syncData.matchedStudentCount === "number"
            ? syncData.matchedStudentCount
            : null;
        const skippedStudentCount =
          typeof syncData.skippedStudentCount === "number"
            ? syncData.skippedStudentCount
            : 0;
        const warnMsg =
          syncData.warning ||
          (skippedStudentCount > 0
            ? `Đã đồng bộ ${matchedStudentCount ?? 0} HV sang Teaching (còn ${skippedStudentCount} HV thiếu/lệch trên Teaching).`
            : null);

        const nextState: SpckReportCardChainResultUI = {
          status: warnMsg ? "WARNING" : "SUCCESS",
          syncedScoreCount,
          matchedStudentCount,
          skippedStudentCount,
          warningMessage: warnMsg,
        };
        setReportCardChainState(nextState);
        return nextState;
      } catch (err) {
        const nextState: SpckReportCardChainResultUI = {
          status: "WARNING",
          syncedScoreCount: null,
          matchedStudentCount: null,
          skippedStudentCount: null,
          warningMessage: `Cảnh báo đồng bộ Phiếu điểm Teaching: ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
        setReportCardChainState(nextState);
        return nextState;
      }
    },
    []
  );

  const handleImportYoutubeProducts = async (options?: {
    skipApprovalConfirm?: boolean;
    sourceRows?: ScannedFolderUIItem[];
  }): Promise<SpckToolStepResult | void> => {
    if (
      !options?.skipApprovalConfirm &&
      !confirmBeforeDemotingApprovedRows(undefined, options?.sourceRows)
    ) {
      return {
        success: false,
        updatedRows: options?.sourceRows || rows,
        errorSummary: "Đã hủy xác nhận trước khi nhập YouTube",
      };
    }
    const ytRes = (await baseHandleImportYoutubeProducts(options?.sourceRows)) as
      | SpckToolStepResult
      | undefined;
    if (
      ytRes &&
      ytRes.success !== false &&
      thumbnailDriveFolderUrl.trim()
    ) {
      const thumbRes = await handleSyncDriveThumbnails(undefined, {
        skipApprovalConfirm: true,
        sourceRows: ytRes.updatedRows,
        silentSuccessBanner: true,
      });
      return {
        success: Boolean(thumbRes.success),
        updatedRows: thumbRes.updatedRows || ytRes.updatedRows,
        errorSummary: thumbRes.errorSummary || ytRes.errorSummary,
      };
    }
    return ytRes;
  };

  const handleGenerateAiComments = async (targetFolderPaths?: string[]) => {
    await baseHandleGenerateAiComments(targetFolderPaths);
  };

  const handleApproveAndUpload = async (
    targetStudentIds: string[],
    autoUploadAfterApprove = true,
    overrideSessionNum?: 12 | 13 | 14 | number
  ) => {
    return await baseHandleApproveAndUpload(
      targetStudentIds,
      autoUploadAfterApprove,
      overrideSessionNum
    );
  };

  const handleGenerateSession14AllAi = async (targetStudentIds?: string[]) => {
    if (!selectedClassId) return;
    if (!isSpckExemptClass && rows.length > 0) {
      const targetFolders =
        targetStudentIds && targetStudentIds.length > 0
          ? rows
              .filter(
                (r) =>
                  r.assignedStudentId &&
                  targetStudentIds.includes(r.assignedStudentId)
              )
              .map((r) => r.folderPath)
              .filter(Boolean)
          : undefined;
      await handleGenerateAiComments(
        targetFolders && targetFolders.length > 0 ? targetFolders : undefined
      );
    }
    await handleGenerateSession14EvalAi(targetStudentIds);
    setShowSession14SummaryBox(true);
  };

  const runAutoPrepAfterScan = async (
    scannedItems: ScannedFolderUIItem[],
    scanClassId: string,
    scanSessionNum: 12 | 13 | 14
  ): Promise<{
    totalSteps: number;
    stepFailures: string[];
    updatedRows: ScannedFolderUIItem[];
  }> => {
    const classMeta = classes.find((c) => c.classId === scanClassId);
    const classText = `${scanClassId} ${classMeta?.className || ""}`.toUpperCase();
    if (/(?:^|[-_\s])(PTB|CSB)(?:\d|$|[-_\s])/i.test(classText)) {
      return { totalSteps: 0, stepFailures: [], updatedRows: scannedItems };
    }

    const candidateRows = scannedItems.filter(
      (r) =>
        r.assignedStudentId &&
        r.status !== "APPROVED" &&
        r.status !== "SAVING" &&
        r.status !== "VERIFIED" &&
        getSessionSlotDisplay(r, scanSessionNum).state !== "VERIFIED_CURRENT"
    );
    const candidateIds = candidateRows
      .map((r) => r.assignedStudentId)
      .filter(Boolean);
    if (candidateIds.length === 0) {
      return { totalSteps: 0, stepFailures: [], updatedRows: scannedItems };
    }

    const isRobotics = /\b(ROB|ROBO|ROBOT|ROBOTICS|PREB|PREA|PREI|ARM|ARMA|ARMB|ARMI|SEM|SEMA|SEMB|SEMI|EV3|VEX|SPIKE|WEDO|ARDUINO)[A-Z0-9]*\b/i.test(
      classText
    );
    const isCanvaOrDesign = /\b(CANVA|DESIGN|FIGMA|PHOTOSHOP|ILLUSTRATOR|GRAPHIC)[A-Z0-9]*\b/i.test(
      classText
    );
    const hasWebOrCsGithubCode = /\b(JSB|JSA|JSI|CSA|CSI|WEB|HTML)[A-Z0-9]*\b/.test(
      classText
    );
    const hasNonWebTrackCode = /\b(PTA|PTI|PTB|CSB|GMA|GMI|GMB|GA|GB|GI|SB|SA|SI)[A-Z0-9]*\b/.test(
      classText
    );
    const rowHasHtml = (r: ScannedFolderUIItem): boolean =>
      r.hasHtmlFiles !== undefined
        ? Boolean(r.hasHtmlFiles)
        : (r.attachments || []).some((f) => /(\.html?|_web_package\.zip)$/i.test(f));

    const hasHtmlFiles = candidateRows.some(rowHasHtml);
    const isWeb =
      !isRobotics &&
      !isCanvaOrDesign &&
      (hasWebOrCsGithubCode
        ? hasHtmlFiles || /\b(JSB|JSA|JSI|WEB|HTML)[A-Z0-9]*\b/.test(classText)
        : !hasNonWebTrackCode && hasHtmlFiles);
    const hasUiOrAppFiles = candidateRows.some((r) =>
      (r.attachments || []).some((f) =>
        /(\.(ui|py|sb3|apk|exe|gmx|yyz|rbxl|html?)|_(web|app)_package\.zip)$/i.test(f)
      )
    );
    const hasAppCode = /\b(PTA|PTI|CSI|CSA|GMA|GMI|GMB|GA|GB|GI|SB|SA|SI|GAME|APP|PYTHON|SCRATCH)[A-Z0-9]*\b/.test(
      classText
    );
    const shouldCaptureScreenshots =
      !isRobotics && !isCanvaOrDesign && (isWeb || hasAppCode || hasUiOrAppFiles);

    const hasRowFileDrift = (r: ScannedFolderUIItem): boolean =>
      Boolean(
        r.folderContentChanged !== false ||
          r.hasNewerSharedResources ||
          Object.values(r.sessionHistory?.sessions || {}).some(
            (s) =>
              Boolean(
                s?.hasFileDriftAfterVerified ||
                  s?.hasUnsubmittedChanges ||
                  s?.hasNewerSharedResources
              )
          )
      );

    const idsNeedingScreenshots = candidateRows
      .filter(
        (r) =>
          hasRowFileDrift(r) ||
          !(
            (/_spck_(?:app_shots|owner_uploads)/i.test(r.thumbnailPath || "") ||
              (r.screenshots || []).some((s) => /_spck_app_shots/i.test(s))) &&
            (r.screenshots || []).length > 0
          )
      )
      .map((r) => r.assignedStudentId)
      .filter(Boolean);

    const idsNeedingWebDeploy = candidateRows
      .filter(
        (r) =>
          rowHasHtml(r) &&
          (hasRowFileDrift(r) || !/Link Web Chạy Thử|github\.io/i.test(r.relatedLinksText || ""))
      )
      .map((r) => r.assignedStudentId)
      .filter(Boolean);

    const idsNeedingDriveUpload = candidateRows
      .filter(
        (r) =>
          hasRowFileDrift(r) ||
          !/Link Google Drive SPCK|drive\.google\.com\/drive\/folders\//i.test(
            r.relatedLinksText || ""
          )
      )
      .map((r) => r.assignedStudentId)
      .filter(Boolean);

    let currentRows = scannedItems;
    const steps: Array<{
      stepName: string;
      progressLabel: string;
      run: () => Promise<SpckToolStepResult | void>;
    }> = [];

    if (isRobotics && youtubeImportInput.trim()) {
      steps.push({
        stepName: "Nhập Playlist YouTube",
        progressLabel: "Đang nhập Playlist YouTube & lấy 2 ảnh thuyết trình...",
        run: async () =>
          await handleImportYoutubeProducts({
            skipApprovalConfirm: true,
            sourceRows: currentRows,
          }),
      });
    }

    if (thumbnailDriveFolderUrl.trim()) {
      steps.push({
        stepName: "Đồng bộ Ảnh Bìa Drive",
        progressLabel:
          "Đang quét ảnh học viên từ Google Drive làm Thumbnail (thiếu dùng Logo MindX)...",
        run: async () =>
          await handleSyncDriveThumbnails(candidateIds, {
            skipApprovalConfirm: true,
            sourceRows: currentRows,
            classIdOverride: scanClassId,
            sessionOverride: scanSessionNum,
            silentSuccessBanner: true,
          }),
      });
    }

    if (shouldCaptureScreenshots && idsNeedingScreenshots.length > 0) {
      steps.push({
        stepName: isWeb ? "Chụp giao diện Web" : "Chụp giao diện App",
        progressLabel: isWeb
          ? "Đang chụp giao diện Web & chọn Thumbnail 16:9..."
          : "Đang chụp giao diện App & chọn Thumbnail 16:9...",
        run: async () =>
          await handleCaptureAppScreenshots(idsNeedingScreenshots, {
            skipApprovalConfirm: true,
            sourceRows: currentRows,
            classIdOverride: scanClassId,
            sessionOverride: scanSessionNum,
          }),
      });
    }

    if (isWeb && webRepoUrl.trim() && idsNeedingWebDeploy.length > 0) {
      steps.push({
        stepName: "Đẩy Web GitHub Pages",
        progressLabel: "Đang đẩy sản phẩm lên GitHub Pages (Xóa cũ – Thêm mới)...",
        run: async () =>
          await handleDeployWebToGithubPages(idsNeedingWebDeploy, {
            skipApprovalConfirm: true,
            sourceRows: currentRows,
            classIdOverride: scanClassId,
            sessionOverride: scanSessionNum,
          }),
      });
    }

    if (driveFolderUrl.trim() && idsNeedingDriveUpload.length > 0) {
      steps.push({
        stepName: "Tải Google Drive",
        progressLabel: "Đang đóng gói .zip & tải lên Google Drive (Xóa cũ – Thêm mới)...",
        run: async () =>
          await handleUploadToGoogleDrive(idsNeedingDriveUpload, {
            skipApprovalConfirm: true,
            sourceRows: currentRows,
            classIdOverride: scanClassId,
            sessionOverride: scanSessionNum,
          }),
      });
    }

    if (steps.length === 0) {
      return { totalSteps: 0, stepFailures: [], updatedRows: currentRows };
    }

    const stepFailures: string[] = [];
    try {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        setAutoPrepStepProgress(`[${i + 1}/${steps.length}] ${step.progressLabel}`);
        try {
          const stepRes = await step.run();
          if (stepRes && Array.isArray(stepRes.updatedRows)) {
            currentRows = stepRes.updatedRows;
          }
          if (stepRes && stepRes.success === false) {
            stepFailures.push(
              formatAutoPrepStepFailure(step.stepName, stepRes.errorSummary)
            );
          }
        } catch (err) {
          stepFailures.push(
            formatAutoPrepStepFailure(
              step.stepName,
              err instanceof Error ? err.message : String(err)
            )
          );
        }
      }
      if (stepFailures.length > 0) {
        setBannerMessage({
          type: "warning",
          text: formatAutoPrepSummaryBanner(steps.length, stepFailures),
        });
      }
      return {
        totalSteps: steps.length,
        stepFailures,
        updatedRows: currentRows,
      };
    } finally {
      setAutoPrepStepProgress(null);
    }
  };

  // =========================================================================
  // NÚT 1 CỐ ĐỊNH: "1. Đồng bộ bài làm" (Dùng chung cho Buổi 12, 13 & 14)
  // =========================================================================
  const handleMainStep1Sync = async () => {
    if (!selectedClassId || isAnyOperationBusy) return;
    const reqClassId = selectedClassId;
    const reqSessionNum = selectedSessionNumber;
    const isStaleClass = () => {
      const currentActive = getActiveUiClassId?.();
      return Boolean(currentActive && currentActive !== reqClassId);
    };

    setMainSyncRunning(true);
    setSkippedUnreadyByStudent({});

    try {
      // (0) Nếu Cổng thu bài học sinh đang mở -> tự động đóng cổng trước
      if (studentPortalRunning) {
        setAutoPrepStepProgress("Đang đóng Cổng thu bài học sinh trước khi đồng bộ...");
        const stoppedOk = await handleStopStudentPortalInternal({
          silentSuccessBanner: true,
        });
        if (!stoppedOk || isStaleClass()) {
          return;
        }
      }

      const stepIssues: string[] = [];
      let scannedCount = rows.length;

      // (a)-(d) Quét thư mục + khớp HV + Chụp 16:9 + GitHub Live + Up Drive
      if (!isSpckExemptClass) {
        const effectiveFolder =
          folderPathInput.trim() ||
          `D:\\MINDX DATA\\MINDX_SPCK_FINAL\\${reqClassId}`;
        setAutoPrepStepProgress(
          "Đang quét thư mục bài làm & khớp danh sách học viên..."
        );
        const scanRes = await baseHandleScanFolder(effectiveFolder);
        if (isStaleClass()) return;

        if (scanRes && typeof scanRes === "object" && scanRes.success) {
          scannedCount = Array.isArray(scanRes.scannedItems)
            ? scanRes.scannedItems.length
            : 0;
          if (scannedCount > 0) {
            const prepRes = await runAutoPrepAfterScan(
              scanRes.scannedItems,
              scanRes.classId || reqClassId,
              scanRes.sessionNumber || reqSessionNum
            );
            if (isStaleClass()) return;
            if (prepRes.stepFailures.length > 0) {
              stepIssues.push(...prepRes.stepFailures);
            }
          } else if (isRoboticsClass && thumbnailDriveFolderUrl.trim()) {
            setAutoPrepStepProgress(
              "Đang quét ảnh học viên từ Google Drive làm Thumbnail (thiếu dùng Logo MindX)..."
            );
            const driveThumbRes = await handleSyncDriveThumbnails(undefined, {
              skipApprovalConfirm: true,
              seedMissingActiveStudents: true,
              classIdOverride: reqClassId,
              sessionOverride: reqSessionNum,
              silentSuccessBanner: true,
            });
            if (isStaleClass()) return;
            if (!driveThumbRes.success && driveThumbRes.errorSummary) {
              stepIssues.push(`Ảnh bìa Drive: ${driveThumbRes.errorSummary}`);
            } else if ((driveThumbRes.updatedRows?.length || 0) > 0) {
              scannedCount = driveThumbRes.updatedRows!.length;
            }
          }
        } else if (isRoboticsClass && thumbnailDriveFolderUrl.trim()) {
          setAutoPrepStepProgress(
            "Đang quét ảnh học viên từ Google Drive làm Thumbnail (thiếu dùng Logo MindX)..."
          );
          const driveThumbRes = await handleSyncDriveThumbnails(undefined, {
            skipApprovalConfirm: true,
            seedMissingActiveStudents: true,
            classIdOverride: reqClassId,
            sessionOverride: reqSessionNum,
            silentSuccessBanner: true,
          });
          if (isStaleClass()) return;
          if (!driveThumbRes.success && driveThumbRes.errorSummary) {
            stepIssues.push(`Ảnh bìa Drive: ${driveThumbRes.errorSummary}`);
          } else if ((driveThumbRes.updatedRows?.length || 0) > 0) {
            scannedCount = driveThumbRes.updatedRows!.length;
          }
        } else if (reqSessionNum !== 14) {
          return;
        } else {
          stepIssues.push("Chưa quét được thư mục bài làm SPCK");
        }
      }

      // (e) Riêng ở Buổi 14: nạp Điểm Demo BGK + xếp hạng Nhất/Nhì/Ba + Summary + [ĐNL] TB B5+9
      let demoMatchedCount = 0;
      if (reqSessionNum === 14) {
        setAutoPrepStepProgress(
          isSpckExemptClass
            ? "Đang tải Điểm Năng lực [ĐNL] trung bình Buổi 5+9..."
            : "Đang nạp Điểm Demo BGK, xếp hạng Giải Nhất/Nhì/Ba & tính [ĐNL] trung bình B5+9..."
        );
        if (isSpckExemptClass) {
          await loadSession14Evals(reqClassId);
        } else {
          const hasDemoSource = Boolean(
            (demoScoreSourceInput || generatedDemoSheetUrl || "").trim()
          );
          const demoRes = await handleImportDemoScores({ isMainSync: true });
          if (isStaleClass()) return;
          if (demoRes.success) {
            demoMatchedCount = demoRes.matchedCount || 0;
          } else {
            await loadSession14Evals(reqClassId);
            if (hasDemoSource && demoRes.errorSummary) {
              stepIssues.push(`Điểm BGK: ${demoRes.errorSummary}`);
            }
          }
        }
      }

      if (isStaleClass()) return;

      if (stepIssues.length > 0) {
        setBannerMessage({
          type: "warning",
          text: `Đã đồng bộ bài làm Buổi ${reqSessionNum} nhưng có mục cần lưu ý: ${stepIssues.join(
            " | "
          )}. Bạn có thể sang Bước 2 (AI Soạn nhận xét) hoặc kiểm tra Tùy chọn nâng cao.`,
        });
      } else if (reqSessionNum === 14) {
        setBannerMessage({
          type: "success",
          text: isSpckExemptClass
            ? `Đã đồng bộ Điểm Năng lực [ĐNL] trung bình Buổi 5+9 cho lớp ${reqClassId} (miễn SPCK/Demo). Hãy bấm "2. AI Soạn nhận xét"!`
            : `Đã đồng bộ trọn gói bài làm Buổi 14 (${scannedCount} bài SPCK${
                demoMatchedCount > 0
                  ? ` • ${demoMatchedCount} học viên có Điểm Demo BGK & xếp hạng Nhất/Nhì/Ba`
                  : " • đã nạp [ĐNL] trung bình B5+9"
              })! Tiếp theo hãy bấm "2. AI Soạn nhận xét".`,
        });
      } else {
        setBannerMessage({
          type: "success",
          text: `Đã đồng bộ trọn gói bài làm Buổi ${reqSessionNum} (${scannedCount} bài làm đã quét, chụp ảnh 16:9 & đồng bộ tài nguyên)! Tiếp theo hãy bấm "2. AI Soạn nhận xét".`,
        });
      }
    } finally {
      setAutoPrepStepProgress(null);
      setMainSyncRunning(false);
    }
  };

  // =========================================================================
  // NÚT 2 CỐ ĐỊNH: "2. AI Soạn nhận xét" (Dùng chung cho Buổi 12, 13 & 14)
  // =========================================================================
  const handleMainStep2Ai = async () => {
    if (!selectedClassId || isAnyOperationBusy) return;
    if (selectedSessionNumber === 14) {
      await handleGenerateSession14AllAi();
    } else {
      await handleGenerateAiComments();
    }
  };

  // =========================================================================
  // NÚT 3 CỐ ĐỊNH: "3. Duyệt & Nộp tất cả" (Dùng chung cho Buổi 12, 13 & 14)
  // Không chặn cả lớp vì 1–2 bạn thiếu bài/thiếu điểm + Chạy nối tiếp LMS -> Teaching!
  // =========================================================================
  const handleMainStep3SubmitAll = async (explicitStudentIds?: string[]) => {
    if (!selectedClassId || isAnyOperationBusy) return;
    const reqClassId = selectedClassId;
    const reqSessionNum = selectedSessionNumber;
    const isStaleClass = () => {
      const currentActive = getActiveUiClassId?.();
      return Boolean(currentActive && currentActive !== reqClassId);
    };

    const explicitSet =
      explicitStudentIds && explicitStudentIds.length > 0
        ? new Set(explicitStudentIds)
        : null;
    const selectedSet = new Set(effectiveSelectedStudentIds);

    // Build active roster + matched rows candidate universe
    const activeRosterStudents = (students || []).filter(
      (s) => s && s.isActive !== 0 && Boolean(s.studentId)
    );
    const activeRosterMap = new Map(
      activeRosterStudents.map((s) => [s.studentId, s])
    );
    const matchedRowByStudent = new Map<string, ScannedFolderUIItem>();
    for (const r of rows) {
      if (r.assignedStudentId && !duplicateStudentIds.has(r.assignedStudentId)) {
        matchedRowByStudent.set(r.assignedStudentId, r);
      }
    }

    const candidateUniverseIds = Array.from(
      new Set([
        ...activeRosterStudents.map((s) => s.studentId),
        ...Array.from(matchedRowByStudent.keys()),
      ])
    ).filter((sid) => {
      if (explicitSet) return explicitSet.has(sid);
      // Include roster students without rows so we flag them clearly as missing/unready
      if (!matchedRowByStudent.has(sid) && reqSessionNum !== 14) return true;
      if (selectedSet.size > 0) {
        return selectedSet.has(sid) || !matchedRowByStudent.has(sid);
      }
      return true;
    });

    const unreadyReasons: Record<string, string> = {};

    // ---------------- BUỔI 12 & BUỔI 13 ----------------
    if (reqSessionNum === 12 || reqSessionNum === 13) {
      const readySpckIds: string[] = [];
      let alreadyVerifiedCount = 0;

      for (const sid of candidateUniverseIds) {
        const row = matchedRowByStudent.get(sid);
        const rosterStu = activeRosterMap.get(sid);
        if (!row) {
          const isAbsent =
            String(rosterStu?.attendanceStatus || "")
              .trim()
              .toUpperCase() === "ABSENT";
          unreadyReasons[sid] = isAbsent
            ? "Vắng mặt — chưa có thư mục bài làm (nộp bù sau)"
            : "Chưa có thư mục bài làm SPCK (nộp bù sau)";
          continue;
        }

        const slot = getSessionSlotDisplay(row, reqSessionNum);
        if (slot.state === "VERIFIED_CURRENT" && !explicitSet) {
          alreadyVerifiedCount += 1;
          continue;
        }
        if (slot.state === "ABSENT_EXEMPT" && !explicitSet) {
          continue;
        }
        if (!explicitSet && selectedSet.size > 0 && !selectedSet.has(sid)) {
          continue;
        }

        const readiness = getRowReadinessSummary(row, duplicateStudentIds, selectedClassId);
        if (readiness.ready) {
          readySpckIds.push(sid);
        } else {
          unreadyReasons[sid] =
            readiness.missingItems.length > 0
              ? `Chưa đủ điều kiện nộp (${readiness.missingItems.join(", ")}) — nộp bù sau`
              : "Chưa đủ điều kiện nộp — nộp bù sau";
        }
      }

      setSkippedUnreadyByStudent(unreadyReasons);

      if (readySpckIds.length === 0 && alreadyVerifiedCount === 0) {
        setBannerMessage({
          type: "warning",
          text: `Chưa có học viên nào đủ điều kiện nộp Buổi ${reqSessionNum} (cần có sản phẩm + nhận xét AI). Hãy chạy "1. Đồng bộ bài làm" và "2. AI Soạn nhận xét" trước!`,
        });
        return;
      }

      setMainStep3Running(true);
      try {
        let verifiedNowCount = 0;
        let failedNowCount = 0;

        if (readySpckIds.length > 0) {
          setMainStep3PhaseLabel(
            `[1/2] Đang duyệt & nộp SPCK Buổi ${reqSessionNum} lên MindX LMS (${readySpckIds.length} HV sẵn sàng)...`
          );
          const spckRes = await baseHandleApproveAndUpload(
            readySpckIds,
            true,
            reqSessionNum
          );
          if (isStaleClass()) return;
          verifiedNowCount = spckRes?.verifiedItems?.length || 0;
          failedNowCount = spckRes?.failedItems?.length || 0;
        }

        const totalVerifiedForSession = verifiedNowCount + alreadyVerifiedCount;
        const targetMilestone: 3 | 4 = reqSessionNum === 12 ? 3 : 4;
        const targetPct = reqSessionNum === 12 ? 60 : 80;

        if (totalVerifiedForSession > 0) {
          setMainStep3PhaseLabel(
            `[2/2] Đang tự động cập nhật Tiến độ dự án Teaching lên ${targetPct}%...`
          );
          const tpRes = await pushTeachingProgressInternal(
            reqClassId,
            targetMilestone
          );
          if (isStaleClass()) return;

          const skippedUnreadyCount = Object.keys(unreadyReasons).length;
          const hasAnyWarning =
            failedNowCount > 0 ||
            tpRes.status === "WARNING" ||
            skippedUnreadyCount > 0;

          const summaryParts: string[] = [
            `LMS Buổi ${reqSessionNum}: Đã xác minh ${totalVerifiedForSession} HV`,
          ];
          if (tpRes.status === "SUCCESS") {
            summaryParts.push(`Teaching: Đã cập nhật tiến độ ${targetPct}%`);
          } else {
            summaryParts.push(`Teaching (${targetPct}%): ${tpRes.message}`);
          }
          if (skippedUnreadyCount > 0) {
            summaryParts.push(
              `Tạm bỏ qua ${skippedUnreadyCount} HV thiếu bài/nhận xét (đã gắn nhãn cảnh báo trên bảng để nộp bù sau)`
            );
          }
          if (failedNowCount > 0) {
            summaryParts.push(`${failedNowCount} HV lỗi LMS cần thử lại`);
          }

          setBannerMessage({
            type: hasAnyWarning ? "warning" : "success",
            text: summaryParts.join(" • "),
          });
        }
      } finally {
        setMainStep3PhaseLabel(null);
        setMainStep3Running(false);
      }
      return;
    }

    // ---------------- BUỔI 14 (COMBO 4 BƯỚC LMS + TEACHING) ----------------
    const evalMap = new Map(session14Evals.map((ev) => [ev.studentId, ev]));
    const readySpckIds: string[] = [];
    const readyEvalIds: string[] = [];
    let alreadyVerifiedSpckCount = 0;
    let alreadyVerifiedEvalCount = 0;

    for (const sid of candidateUniverseIds) {
      if (!explicitSet && selectedSet.size > 0 && !selectedSet.has(sid)) {
        const hasRow = matchedRowByStudent.has(sid);
        const ev = evalMap.get(sid);
        if (hasRow || ev?.status === "VERIFIED") {
          if (
            hasRow &&
            getSessionSlotDisplay(matchedRowByStudent.get(sid)!, 14).state ===
              "VERIFIED_CURRENT"
          ) {
            alreadyVerifiedSpckCount += 1;
          }
          if (ev?.status === "VERIFIED") {
            alreadyVerifiedEvalCount += 1;
          }
          continue;
        }
      }

      const missingNotesForStu: string[] = [];

      // Check Part 1: SPCK Column 3 readiness (unless PTB/CSB exempt)
      if (!isSpckExemptClass) {
        const row = matchedRowByStudent.get(sid);
        if (!row) {
          missingNotesForStu.push("thiếu thư mục SPCK");
        } else {
          const slot = getSessionSlotDisplay(row, 14);
          if (slot.state === "VERIFIED_CURRENT" && !explicitSet) {
            alreadyVerifiedSpckCount += 1;
          } else {
            const readiness = getRowReadinessSummary(row, duplicateStudentIds, selectedClassId);
            if (readiness.ready) {
              readySpckIds.push(sid);
            } else {
              missingNotesForStu.push(
                readiness.missingItems.length > 0
                  ? `SPCK: ${readiness.missingItems.join(", ")}`
                  : "SPCK chưa đủ điều kiện"
              );
            }
          }
        }
      }

      // Check Part 2: Session 14 Eval Column 2 readiness
      const ev = evalMap.get(sid);
      if (!ev) {
        missingNotesForStu.push("chưa có dữ liệu Đánh giá B14");
      } else if (ev.status === "VERIFIED" && !explicitSet) {
        alreadyVerifiedEvalCount += 1;
      } else {
        const has3PartLetter = Boolean(
          String(ev.learnedFromMindx || "").trim() &&
            String(ev.suggestionsFromMindx || "").trim() &&
            String(ev.futureDirection || "").trim()
        );
        const hasDemoScoreOk =
          isSpckExemptClass || Number(ev.demoTotalScore || 0) > 0;
        if (has3PartLetter && hasDemoScoreOk) {
          readyEvalIds.push(sid);
        } else {
          if (!hasDemoScoreOk) {
            missingNotesForStu.push("thiếu Điểm Demo BGK");
          }
          if (!has3PartLetter) {
            missingNotesForStu.push("thiếu Thư 3 phần AI");
          }
        }
      }

      if (missingNotesForStu.length > 0) {
        unreadyReasons[sid] = `Chưa đủ mục (${missingNotesForStu.join(
          ", "
        )}) — chờ nộp bù sau`;
      }
    }

    setSkippedUnreadyByStudent(unreadyReasons);

    const hasAnyReadyNow = readySpckIds.length > 0 || readyEvalIds.length > 0;
    const hasAnyAlreadyVerified =
      alreadyVerifiedSpckCount > 0 || alreadyVerifiedEvalCount > 0;

    if (!hasAnyReadyNow && !hasAnyAlreadyVerified) {
      setBannerMessage({
        type: "warning",
        text: "Chưa có học viên nào đủ điều kiện nộp Buổi 14 (cần Điểm Demo BGK + Nhận xét AI). Hãy chạy Bước 1 và Bước 2 trước!",
      });
      return;
    }

    setMainStep3Running(true);
    setLastSubmissionSummary(null);
    setBannerMessage(null);
    setSession14ComboStatus({
      classId: reqClassId,
      running: true,
      currentPhase: !isSpckExemptClass && readySpckIds.length > 0 ? "spck" : "eval",
      spckSummary: null,
      evalVerifiedCount: 0,
      evalVerifiedStudentIds: [],
      evalFailedCount: 0,
      evalRetryStudentIds: [],
      evalErrorMessage: null,
      classSummaryVerified: false,
      teachingProgressResult: null,
      reportCardResult: null,
    });

    let nextSpckSummary: SpckBatchSubmissionSummaryUI | null = null;
    let nextEvalVerified = 0;
    let nextEvalVerifiedIds: string[] = [];
    let nextEvalFailed = 0;
    let nextEvalRetryIds: string[] = [];
    let nextEvalError: string | null = null;
    let nextClassSummarySaved = false;
    let tpResult: SpckTeachingProgressPushResultUI | null = null;
    let rcResult: SpckReportCardChainResultUI | null = null;

    try {
      // (1) Duyệt & Đẩy Sản phẩm SPCK Cột 3 (nếu lớp không miễn SPCK và có HV sẵn sàng)
      if (!isSpckExemptClass && readySpckIds.length > 0) {
        setMainStep3PhaseLabel(
          `[1/4] Đang duyệt & đẩy Sản phẩm SPCK (Cột 3) cho ${readySpckIds.length} HV...`
        );
        setSession14ComboStatus((prev) => ({
          ...prev,
          classId: reqClassId,
          running: true,
          currentPhase: "spck",
        }));
        const spckRes = await baseHandleApproveAndUpload(readySpckIds, true, 14);
        if (isStaleClass()) return;
        nextSpckSummary =
          spckRes && typeof spckRes === "object"
            ? { ...spckRes, classId: reqClassId }
            : null;
      }

      // (2) Duyệt & Đẩy Đánh giá Cột 2 + Summary vinh danh Nhất/Nhì/Ba đầu trang
      if (readyEvalIds.length > 0) {
        setMainStep3PhaseLabel(
          `[2/4] Đang đẩy Đánh giá Cột 2 (9 ô [ĐNL] TB B5+9 + Điểm Demo + Thư 3 phần) & Summary vinh danh cho ${readyEvalIds.length} HV...`
        );
        setSession14ComboStatus((prev) => ({
          ...prev,
          classId: reqClassId,
          running: true,
          currentPhase: "eval",
          spckSummary: nextSpckSummary,
        }));
        const classSummaryHtml = getEffectiveClassSummaryHtml();
        const evalRes = await handleApproveAndUploadSession14Eval(readyEvalIds, {
          classSummaryHtml,
          allowPartialApproval: true,
          silentBanner: true,
        });
        if (isStaleClass()) return;
        nextEvalVerified = evalRes.verifiedCount;
        nextEvalVerifiedIds = evalRes.verifiedStudentIds || [];
        nextEvalFailed = evalRes.failedCount;
        nextEvalRetryIds = evalRes.retryStudentIds || [];
        nextEvalError = evalRes.errorMessage;
        nextClassSummarySaved = Boolean(evalRes.classSummarySaved);
      }

      const spckVerifiedTotal =
        (nextSpckSummary?.verifiedItems?.length || 0) + alreadyVerifiedSpckCount;
      const evalVerifiedTotal = nextEvalVerified + alreadyVerifiedEvalCount;

      // (3) & (4) Nếu có ít nhất >= 1 HV đạt VERIFIED trên LMS -> Chạy nối tiếp Teaching 100% + Phiếu điểm cuối khóa!
      if (spckVerifiedTotal > 0 || evalVerifiedTotal > 0) {
        setMainStep3PhaseLabel(
          "[3/4] Đang tự động đẩy Tiến độ dự án Teaching lên 100%..."
        );
        setSession14ComboStatus((prev) => ({
          ...prev,
          classId: reqClassId,
          running: true,
          currentPhase: "teaching_progress",
          spckSummary: nextSpckSummary,
          evalVerifiedCount: nextEvalVerified,
          evalVerifiedStudentIds: nextEvalVerifiedIds,
          evalFailedCount: nextEvalFailed,
          evalRetryStudentIds: nextEvalRetryIds,
          evalErrorMessage: nextEvalError,
          classSummaryVerified: nextClassSummarySaved,
        }));
        tpResult = await pushTeachingProgressInternal(reqClassId, 5);
        if (isStaleClass()) return;

        setMainStep3PhaseLabel(
          "[4/4] Đang quét lại điểm LMS & đồng bộ Phiếu điểm cuối khóa sang Teaching..."
        );
        setSession14ComboStatus((prev) => ({
          ...prev,
          classId: reqClassId,
          running: true,
          currentPhase: "report_card",
          teachingProgressResult: tpResult,
        }));
        rcResult = await runReportCardSyncChainInternal(reqClassId);
        if (isStaleClass()) return;
      }

      setSession14ComboStatus({
        classId: reqClassId,
        running: false,
        currentPhase: "done",
        spckSummary: nextSpckSummary,
        evalVerifiedCount: nextEvalVerified,
        evalVerifiedStudentIds: nextEvalVerifiedIds,
        evalFailedCount: nextEvalFailed,
        evalRetryStudentIds: nextEvalRetryIds,
        evalErrorMessage: nextEvalError,
        classSummaryVerified: nextClassSummarySaved,
        teachingProgressResult: tpResult,
        reportCardResult: rcResult,
      });

      const spckRetryCount = nextSpckSummary?.retryStudentIds?.length || 0;
      const skippedUnreadyCount = Object.keys(unreadyReasons).length;
      const hasAnyIssue =
        spckRetryCount > 0 ||
        nextEvalFailed > 0 ||
        skippedUnreadyCount > 0 ||
        tpResult?.status === "WARNING" ||
        rcResult?.status === "WARNING";

      const msgParts: string[] = [];
      if (!isSpckExemptClass) {
        msgParts.push(
          `LMS Cột 3 (SPCK): ${spckVerifiedTotal} HV đã xác minh${
            spckRetryCount > 0 ? ` (${spckRetryCount} lỗi)` : ""
          }`
        );
      }
      msgParts.push(
        `LMS Cột 2 (Đánh giá + Summary): ${evalVerifiedTotal} HV đã xác minh${
          nextEvalFailed > 0 ? ` (${nextEvalFailed} lỗi)` : ""
        }`
      );
      if (tpResult) {
        msgParts.push(
          tpResult.status === "SUCCESS"
            ? "Teaching Tiến độ: 100% ✓"
            : `Teaching Tiến độ: ${tpResult.message}`
        );
      }
      if (rcResult) {
        msgParts.push(
          rcResult.status === "SUCCESS"
            ? `Phiếu điểm Teaching: Đã đồng bộ ${
                rcResult.matchedStudentCount ?? ""
              } HV ✓`.trim()
            : `Phiếu điểm Teaching: ${
                rcResult.warningMessage || "Cần kiểm tra"
              }`
        );
      }
      if (skippedUnreadyCount > 0) {
        msgParts.push(
          `Còn ${skippedUnreadyCount} HV thiếu bài/điểm (đã gắn nhãn cảnh báo trên bảng để nộp bù sau)`
        );
      }

      setBannerMessage({
        type: hasAnyIssue ? "warning" : "success",
        text: msgParts.join(" • "),
      });
    } finally {
      setMainStep3PhaseLabel(null);
      setMainStep3Running(false);
      if (!isStaleClass()) {
        setSession14ComboStatus((prev) => ({
          ...prev,
          classId: reqClassId,
          running: false,
          currentPhase: "done",
        }));
      }
    }
  };

  const handleSubmitSession14Combo = async (
    targetStudentIds?: string[],
    partToRun: "both" | "spck_only" | "eval_only" = "both"
  ) => {
    if (!selectedClassId) return;
    if (partToRun === "both") {
      await handleMainStep3SubmitAll(targetStudentIds);
      return;
    }

    const reqClassId = selectedClassId;
    const isStaleClass = () => {
      const currentActive = getActiveUiClassId?.();
      return Boolean(currentActive && currentActive !== reqClassId);
    };
    const ids =
      targetStudentIds && targetStudentIds.length > 0
        ? targetStudentIds
        : effectiveSelectedStudentIds;
    if (ids.length === 0) {
      setBannerMessage({
        type: "warning",
        text: "Vui lòng chọn ít nhất 1 học viên để thử lại Buổi 14.",
      });
      return;
    }

    setSession14ComboStatus((prev) => ({
      ...prev,
      classId: reqClassId,
      running: true,
      currentPhase: partToRun === "eval_only" ? "eval" : "spck",
    }));

    let nextSpckSummary = session14ComboStatus.spckSummary;
    let nextEvalVerified = session14ComboStatus.evalVerifiedCount;
    let nextEvalVerifiedIds = [
      ...(session14ComboStatus.evalVerifiedStudentIds || []),
    ];
    let nextEvalFailed = session14ComboStatus.evalFailedCount;
    let nextEvalRetryIds = [...session14ComboStatus.evalRetryStudentIds];
    let nextEvalError = session14ComboStatus.evalErrorMessage;

    try {
      if (partToRun === "spck_only") {
        const spckRes = await baseHandleApproveAndUpload(ids, true, 14);
        if (isStaleClass()) return;
        const resolvedSpckSummary: SpckBatchSubmissionSummaryUI =
          spckRes && typeof spckRes === "object"
            ? { ...spckRes, classId: reqClassId }
            : {
                classId: reqClassId,
                sessionNumber: 14,
                totalSelected: ids.length,
                verifiedItems: [],
                failedItems: ids.map((sid) => ({
                  studentId: sid,
                  studentName: sid,
                  reason: "Không thể hoàn tất nộp Sản phẩm SPCK (Buổi 14).",
                })),
                skippedItems: [],
                retryStudentIds: ids,
                completedAt: new Date().toLocaleTimeString("vi-VN"),
              };

        if (session14ComboStatus.spckSummary) {
          const prevSpck = session14ComboStatus.spckSummary;
          const retriedSet = new Set(ids);
          const mergedVerifiedMap = new Map<
            string,
            { studentId: string; studentName: string }
          >();
          for (const it of prevSpck.verifiedItems) {
            if (!retriedSet.has(it.studentId)) {
              mergedVerifiedMap.set(it.studentId, it);
            }
          }
          for (const it of resolvedSpckSummary.verifiedItems) {
            mergedVerifiedMap.set(it.studentId, it);
          }
          const mergedVerified = Array.from(mergedVerifiedMap.values());
          const mergedFailed = [
            ...prevSpck.failedItems.filter((it) => !retriedSet.has(it.studentId)),
            ...resolvedSpckSummary.failedItems,
          ];
          const mergedSkipped = [
            ...prevSpck.skippedItems.filter((it) => !retriedSet.has(it.studentId)),
            ...resolvedSpckSummary.skippedItems,
          ];
          const mergedRetryIds = Array.from(
            new Set([
              ...mergedFailed.map((f) => f.studentId),
              ...mergedSkipped
                .filter(
                  (s) => !/vắng mặt.*miễn nộp/i.test(String(s.reason || ""))
                )
                .map((s) => s.studentId),
            ])
          );
          nextSpckSummary = {
            ...resolvedSpckSummary,
            classId: reqClassId,
            totalSelected: Math.max(
              prevSpck.totalSelected,
              mergedVerified.length + mergedRetryIds.length
            ),
            verifiedItems: mergedVerified,
            failedItems: mergedFailed,
            skippedItems: mergedSkipped,
            retryStudentIds: mergedRetryIds,
          };
          setLastSubmissionSummary(nextSpckSummary);
        } else {
          nextSpckSummary = resolvedSpckSummary;
        }
      }

      if (partToRun === "eval_only") {
        const evalRes = await handleApproveAndUploadSession14Eval(ids, {
          classSummaryHtml: getEffectiveClassSummaryHtml(),
          allowPartialApproval: true,
        });
        if (isStaleClass()) return;
        const retriedSet = new Set(ids);
        const prevVerifiedIds = (
          session14ComboStatus.evalVerifiedStudentIds || []
        ).filter((sid) => !retriedSet.has(sid));
        const mergedVerifiedIds = Array.from(
          new Set([...prevVerifiedIds, ...(evalRes.verifiedStudentIds || [])])
        );
        const prevRemainingRetryIds = (
          session14ComboStatus.evalRetryStudentIds || []
        ).filter(
          (sid) => !retriedSet.has(sid) && !mergedVerifiedIds.includes(sid)
        );
        const mergedRetryIds = Array.from(
          new Set([...prevRemainingRetryIds, ...(evalRes.retryStudentIds || [])])
        );
        nextEvalVerifiedIds = mergedVerifiedIds;
        nextEvalVerified =
          mergedVerifiedIds.length > 0
            ? mergedVerifiedIds.length
            : evalRes.verifiedCount;
        nextEvalRetryIds = mergedRetryIds;
        nextEvalFailed = mergedRetryIds.length;
        nextEvalError = mergedRetryIds.length > 0 ? evalRes.errorMessage : null;
      }

      setSession14ComboStatus((prev) => ({
        ...prev,
        classId: reqClassId,
        running: false,
        currentPhase: "done",
        spckSummary: nextSpckSummary,
        evalVerifiedCount: nextEvalVerified,
        evalVerifiedStudentIds: nextEvalVerifiedIds,
        evalFailedCount: nextEvalFailed,
        evalRetryStudentIds: nextEvalRetryIds,
        evalErrorMessage: nextEvalError,
      }));
    } finally {
      if (!isStaleClass()) {
        setSession14ComboStatus((prev) => ({
          ...prev,
          classId: reqClassId,
          running: false,
          currentPhase: "done",
        }));
      }
    }
  };

  const handleRefreshSingleStudentAllInOne = async (studentId: string) => {
    if (!selectedClassId || !studentId) return;
    if (isSpckExemptClass) {
      setBannerMessage({
        type: "warning",
        text: `Lớp ${selectedClassId} thuộc khóa PTB / CSB được miễn nộp SPCK tự động.`,
      });
      return;
    }
    if (!confirmBeforeDemotingApprovedRows([studentId], rows)) {
      return;
    }

    const reqClassId = selectedClassId;
    const reqSessionNum = selectedSessionNumber;
    const stuName =
      students.find((s) => s.studentId === studentId)?.fullName ||
      rows.find((r) => r.assignedStudentId === studentId)?.folderName ||
      studentId;

    setRefreshingStudentId(studentId);
    setBannerMessage({
      type: "warning",
      text: `Đang làm mới trọn gói bài làm cho ${stuName} (Xóa cũ – Thêm mới: Chụp hình 16:9 • GitHub Live • Đóng gói .zip lên Google Drive)...`,
    });

    try {
      let latestRows = rows;
      if (folderPathInput.trim()) {
        const scanRes = await baseHandleScanFolder(folderPathInput.trim());
        if (
          scanRes &&
          typeof scanRes === "object" &&
          scanRes.success &&
          Array.isArray(scanRes.scannedItems) &&
          scanRes.scannedItems.length > 0
        ) {
          latestRows = scanRes.scannedItems;
        }
      }

      const targetRow = latestRows.find((r) => r.assignedStudentId === studentId);
      const stepFailures: string[] = [];

      if (thumbnailDriveFolderUrl.trim()) {
        setAutoPrepStepProgress(
          `[Làm mới ${stuName}] Đang tải lại ảnh bìa học viên từ Google Drive...`
        );
        const thumbRes = await handleSyncDriveThumbnails([studentId], {
          skipApprovalConfirm: true,
          sourceRows: latestRows,
          classIdOverride: reqClassId,
          sessionOverride: reqSessionNum,
          forceRedownload: true,
          silentSuccessBanner: true,
        });
        if (thumbRes && Array.isArray(thumbRes.updatedRows)) {
          latestRows = thumbRes.updatedRows;
        }
        if (thumbRes && thumbRes.success === false) {
          stepFailures.push(
            formatAutoPrepStepFailure("Ảnh bìa Drive", thumbRes.errorSummary)
          );
        }
      }

      if (!isRoboticsClass && targetRow?.folderPath) {
        setAutoPrepStepProgress(`[Làm mới ${stuName}] Đang chụp mới giao diện 16:9...`);
        const shotRes = await handleCaptureAppScreenshots([studentId], {
          skipApprovalConfirm: true,
          sourceRows: latestRows,
          classIdOverride: reqClassId,
          sessionOverride: reqSessionNum,
        });
        if (shotRes && Array.isArray(shotRes.updatedRows)) {
          latestRows = shotRes.updatedRows;
        }
        if (shotRes && shotRes.success === false) {
          stepFailures.push(
            formatAutoPrepStepFailure("Chụp giao diện", shotRes.errorSummary)
          );
        }
      }

      const hasHtmlForStudent =
        targetRow?.hasHtmlFiles !== undefined
          ? Boolean(targetRow.hasHtmlFiles)
          : Boolean(
              (targetRow?.attachments || []).some((f) =>
                /(\.html?|_web_package\.zip)$/i.test(f)
              )
            );

      if (isWebClassOrProduct && webRepoUrl.trim() && hasHtmlForStudent) {
        setAutoPrepStepProgress(
          `[Làm mới ${stuName}] Đang đẩy bản mới lên GitHub Pages...`
        );
        const webRes = await handleDeployWebToGithubPages([studentId], {
          skipApprovalConfirm: true,
          sourceRows: latestRows,
          classIdOverride: reqClassId,
          sessionOverride: reqSessionNum,
        });
        if (webRes && Array.isArray(webRes.updatedRows)) {
          latestRows = webRes.updatedRows;
        }
        if (webRes && webRes.success === false) {
          stepFailures.push(
            formatAutoPrepStepFailure("GitHub Pages", webRes.errorSummary)
          );
        }
      }

      if (driveFolderUrl.trim() && targetRow?.folderPath) {
        setAutoPrepStepProgress(
          `[Làm mới ${stuName}] Đang đóng gói .zip & đẩy lên Google Drive...`
        );
        const driveRes = await handleUploadToGoogleDrive([studentId], {
          skipApprovalConfirm: true,
          sourceRows: latestRows,
          classIdOverride: reqClassId,
          sessionOverride: reqSessionNum,
        });
        if (driveRes && Array.isArray(driveRes.updatedRows)) {
          latestRows = driveRes.updatedRows;
        }
        if (driveRes && driveRes.success === false) {
          stepFailures.push(
            formatAutoPrepStepFailure("Google Drive", driveRes.errorSummary)
          );
        }
      }

      if (stepFailures.length > 0) {
        setBannerMessage({
          type: "warning",
          text: `Làm mới bài cho ${stuName} chưa hoàn tất trọn vẹn: ${stepFailures.join(" | ")}.`,
        });
      } else {
        setBannerMessage({
          type: "success",
          text: `Đã làm mới trọn gói bài làm cho ${stuName} (Ảnh 16:9 mới + Link mới nhất đã cập nhật sẵn sàng để nộp Buổi ${reqSessionNum})!`,
        });
      }
    } catch (err) {
      setBannerMessage({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setAutoPrepStepProgress(null);
      setRefreshingStudentId(null);
    }
  };

  const handleRestorePortalBackup = async (studentId: string) => {
    if (!selectedClassId || !studentId) return;
    const reqClassId = selectedClassId;
    const reqSessionNum = selectedSessionNumber;
    const stuName =
      students.find((s) => s.studentId === studentId)?.fullName ||
      rows.find((r) => r.assignedStudentId === studentId)?.folderName ||
      studentId;

    setRestoringBackupStudentId(studentId);
    setBannerMessage({
      type: "warning",
      text: `Đang khôi phục bản nộp trước đó từ kho dự phòng cho ${stuName}...`,
    });

    try {
      const res = await fetch("/api/spck/student-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "restore_backup",
          classId: reqClassId,
          studentId,
          sessionNumber: reqSessionNum,
        }),
      });
      const data = await res.json();
      const activeClass = getActiveUiClassId();
      if (activeClass && activeClass !== reqClassId) return;

      if (!res.ok || !data?.success) {
        setBannerMessage({
          type: "error",
          text:
            data?.error ||
            `Không thể khôi phục bản dự phòng trước đó cho ${stuName}.`,
        });
        return;
      }

      if (Array.isArray(data.records) && data.records.length > 0) {
        hydrateRowsFromDb(data.records, latestStudentsRef.current, reqSessionNum);
      }

      setBannerMessage({
        type: "success",
        text: `Đã khôi phục thành công bản nộp trước đó (${data.restoredFilesCount ?? 0} file) cho ${stuName}! Bạn có thể bấm "🔄 Làm mới trọn gói" nếu muốn chụp lại ảnh & đóng gói lại lên Drive.`,
      });
    } catch (err) {
      setBannerMessage({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRestoringBackupStudentId(null);
    }
  };

  const handleScanFolder = async (
    overrideFolderPath?: string | React.MouseEvent,
    options?: { action?: "init_student_folders" }
  ) => {
    const res = await baseHandleScanFolder(overrideFolderPath, options);
    if (
      res &&
      typeof res === "object" &&
      res.success &&
      options?.action !== "init_student_folders" &&
      autoRunToolsAfterScan &&
      Array.isArray(res.scannedItems) &&
      res.scannedItems.length > 0
    ) {
      await runAutoPrepAfterScan(
        res.scannedItems,
        res.classId || selectedClassId,
        res.sessionNumber || selectedSessionNumber
      );
    }
    return res;
  };

  const handleInitStudentFolders = async () => {
    return await handleScanFolder(undefined, {
      action: "init_student_folders",
    });
  };

  const toggleSelectStudent = (studentId: string) => {
    if (!studentId) return;
    setSelectedStudentIds((prev) => {
      const base = prev.includes("__AUTO_SELECT__")
        ? effectiveSelectedStudentIds
        : prev;
      if (base.includes(studentId)) {
        return base.filter((id) => id !== studentId);
      }
      return [...base, studentId];
    });
  };

  const toggleExpandRow = (rowKey: string) => {
    setExpandedRowKeys((prev) => ({
      ...prev,
      [rowKey]: !prev[rowKey],
    }));
  };

  return {
    ...params,
    isAnyOperationBusy,
    autoRunToolsAfterScan,
    handleToggleAutoRunToolsAfterScan,
    autoPrepStepProgress,
    thumbnailDriveFolderUrl,
    setThumbnailDriveFolderUrl,
    syncingDriveThumbnails,
    handleSyncDriveThumbnails,
    toolErrorsByStudent,
    setStudentToolError,
    expandedRowTabByStudent,
    setRowActiveTab,
    showAdvancedTools,
    setShowAdvancedTools,
    showFolderEditor,
    setShowFolderEditor,
    session14ClassSummaryText,
    session14ClassSummaryDirty,
    showSession14SummaryBox,
    setShowSession14SummaryBox,
    handleUpdateSession14ClassSummaryText,
    handlePersistSession14ClassSummary,
    handleResetSession14ClassSummary,
    getEffectiveClassSummaryHtml,
    session14AwardMap,
    activeStudentIdSet,
    mainSyncRunning,
    mainStep3Running,
    mainStep3PhaseLabel,
    teachingProgressPushState,
    reportCardChainState,
    skippedUnreadyByStudent,
    pushTeachingProgressInternal,
    runReportCardSyncChainInternal,
    handleMainStep1Sync,
    handleMainStep2Ai,
    handleMainStep3SubmitAll,
    session14ComboStatus,
    loadBrowseDirectory,
    handleBrowseFolder,
    handleConfirmBrowseSelection,
    handleSyncLatestResources,
    handleUploadToGoogleDrive,
    handleDeployWebToGithubPages,
    handleCreateDemoScoringSheet,
    handleCaptureAppScreenshots,
    handleOwnerUploadImage,
    applyPortalStatusState,
    handleStartStudentPortal,
    handleStopStudentPortal,
    handleTogglePortalAutoDrive,
    loadSession14Evals,
    handleSaveSession14EvalDraft,
    handleImportDemoScores,
    handleGenerateSession14EvalAi,
    handleApproveAndUploadSession14Eval,
    handleImportYoutubeProducts,
    handleGenerateAiComments,
    handleApproveAndUpload,
    handleGenerateSession14AllAi,
    handleSubmitSession14Combo,
    handleScanFolder,
    handleInitStudentFolders,
    activeBusyDescription,
    selectedClassMeta,
    isSpckExemptClass,
    isRoboticsClass,
    activeDemoScoreItems,
    totalStepsCount,
    isWebClassOrProduct,
    isAppOrGameProduct,
    refreshingStudentId,
    restoringBackupStudentId,
    handleRefreshSingleStudentAllInOne,
    handleRestorePortalBackup,
    toggleSelectStudent,
    toggleExpandRow,
  };
}

export type SpckWorkflowController = ReturnType<typeof useSpckWorkflow>;
