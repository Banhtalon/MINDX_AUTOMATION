"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  FolderSearch,
  Image as ImageIcon,
  Link2,
  Loader2,
  Paperclip,
  RefreshCw,
  Rocket,
  Sparkles,
  UploadCloud,
  Video,
} from "lucide-react";

interface ClassOption {
  classId: string;
  className: string;
  currentSessionNumber?: number;
  maxSessionNumber?: number;
  spckSessions?: number[];
  status?: string;
  session14Date?: string;
}

interface StudentOption {
  studentId: string;
  classId: string;
  fullName: string;
  isActive: number;
}

interface RelatedLinkItem {
  name: string;
  url: string;
  category?: "LIVE_PRODUCT" | "SOURCE_DOWNLOAD" | "OTHER_DOC";
}

interface SpckVerifiedSnapshotUI {
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

interface SpckSessionSlotSummaryUI {
  sessionNumber: 12 | 13 | 14;
  stageLabel: string;
  displayState:
    | "VERIFIED"
    | "VERIFIED_WITH_UNSUBMITTED_EDITS"
    | "VERIFIED_FILE_DRIFT"
    | "FAILED_AFTER_VERIFIED"
    | "FAILED"
    | "UNKNOWN_LEGACY"
    | "CORRUPTED"
    | "NOT_SUBMITTED";
  badgeLabel: string;
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

interface SpckStudentSessionHistorySummaryUI {
  classId: string;
  studentId: string;
  hasLegacyUnknownSessionHistory: boolean;
  legacyNote: string | null;
  historyCorrupted: boolean;
  historyCorruptedReason: string | null;
  sessions: Record<"12" | "13" | "14", SpckSessionSlotSummaryUI>;
}

interface ThumbnailInspectionUI {
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

interface SpckSessionSubmissionResultUI {
  sessionNumber: 12 | 13 | 14;
  status: "VERIFIED" | "FAILED";
  submittedContentHash?: string;
  verifiedAt?: string | null;
  lastVerifiedContentHash?: string;
  lastVerifiedAt?: string | null;
  errorMessage?: string | null;
  lastVerifiedSnapshot?: SpckVerifiedSnapshotUI | null;
}

type SpckSessionResultsMapUI = Partial<
  Record<"12" | "13" | "14", SpckSessionSubmissionResultUI>
>;

interface SpckBatchSubmissionSummaryUI {
  sessionNumber: 12 | 13 | 14;
  completedAt: string;
  totalSelected: number;
  verifiedItems: Array<{ studentId: string; studentName: string }>;
  failedItems: Array<{ studentId: string; studentName: string; reason: string }>;
  skippedItems: Array<{ studentId: string; studentName: string; reason: string }>;
  retryStudentIds: string[];
}

interface SpckRecordRow {
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

interface ScannedFolderUIItem {
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

const DEFAULT_SPCK_TAGS = [
  "Hoàn thành tốt sản phẩm cuối khóa",
  "Ý tưởng sáng tạo, giao diện trực quan",
  "Vận dụng vững kiến thức lập trình đã học",
  "Chủ động tìm tòi, xử lý lỗi tốt",
  "Cần trau chuốt thêm phần giao diện và tối ưu code",
  "Thuyết trình tự tin, trình bày rõ ràng mạch lạc",
];

const SESSION14_SPCK_TAGS = [
  "Chuẩn bị slide thuyết trình đầy đủ, bố cục rõ ràng và sáng tạo",
  "Nếu luyện tập thêm và tự tin hơn khi trình bày trước lớp sẽ phát huy tốt hơn",
  "Cần tìm hiểu kỹ hơn về đoạn code trong sản phẩm để tự tin giải thích khi thuyết trình",
  "Giao diện đẹp mắt, bố cục hợp lý, sử dụng Flexbox phù hợp",
  "Vận dụng tốt kiến thức đã học, có sự sáng tạo và đầu tư vào sản phẩm",
  "Còn phụ thuộc khá nhiều vào AI, chưa thực sự hiểu sâu phần cốt lõi của code",
  "Tự giác tìm hiểu và hoàn thành bài tập mà không phụ thuộc vào AI",
];

interface Session14CompetencyScoresUI {
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

interface Session14DemoScoresUI {
  algorithm: number;
  creativity: number;
  communication: number;
  problemSolving: number;
  computerSkills: number;
}

interface Session14EvalItemUI {
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
  quickTags: string[];
  teacherNote: string;
  draftVersion: number;
  status: "DRAFT" | "WAITING_APPROVAL" | "APPROVED" | "VERIFIED" | "FAILED";
  contentHash: string;
  verifiedAt?: string | null;
  errorMessage?: string | null;
}

const COMPETENCY_ITEMS_UI: Array<{
  key: keyof Session14CompetencyScoresUI;
  label: string;
}> = [
  { key: "knowledgeInClass", label: "1. [ĐNL] Kiến thức học tại lớp" },
  { key: "knowledgeSelfStudy", label: "2. [ĐNL] Kiến thức tự học" },
  { key: "skillCommunication", label: "3. [ĐNL] Giao tiếp, hợp tác" },
  { key: "skillComputerUse", label: "4. [ĐNL] Sử dụng máy tính" },
  { key: "skillProblemSolving", label: "5. [ĐNL] Giải quyết vấn đề" },
  { key: "skillCreativity", label: "6. [ĐNL] Tư duy sáng tạo" },
  { key: "skillComputational", label: "7. [ĐNL] Tư duy máy tính" },
  { key: "attitudeHomework", label: "8. [ĐNL] Thái độ BTVN" },
  { key: "attitudeInClass", label: "9. [ĐNL] Thái độ trên lớp" },
];

const DEMO_SCORE_ITEMS_UI: Array<{
  key: keyof Session14DemoScoresUI;
  label: string;
  max: number;
}> = [
  { key: "algorithm", label: "Tư duy máy tính, thuật toán", max: 1.5 },
  { key: "creativity", label: "Tư duy sáng tạo", max: 1.0 },
  { key: "communication", label: "Kỹ năng giao tiếp, hợp tác", max: 0.5 },
  { key: "problemSolving", label: "Giải quyết vấn đề", max: 1.0 },
  { key: "computerSkills", label: "Kỹ năng sử dụng máy tính", max: 1.0 },
];

function getStageMeta(sessionNum: 12 | 13 | 14): {
  stageNumber: 1 | 2;
  stageLabel: string;
  stageTitle: string;
  shortStageLabel: string;
  stageShort: string;
  suffix: string;
  noteHint: string;
  commentHint: string;
} {
  if (sessionNum === 12) {
    const hint =
      "Buổi 12 (Giai đoạn 1): Nêu tiến độ hiện tại và phần cần hoàn thiện tiếp theo.";
    return {
      stageNumber: 1,
      stageLabel: "Giai đoạn 1",
      stageTitle: "Giai đoạn 1",
      shortStageLabel: "GĐ1",
      stageShort: "GĐ1",
      suffix: " — Buổi 12 (GĐ1)",
      noteHint: hint,
      commentHint: hint,
    };
  }
  if (sessionNum === 13) {
    const hint =
      "Buổi 13 (Giai đoạn 1): Nêu tiến độ hiện tại, phần đã bổ sung và phần còn cần hoàn thiện (chỉ đối chiếu Buổi 12 khi có dữ liệu).";
    return {
      stageNumber: 1,
      stageLabel: "Giai đoạn 1",
      stageTitle: "Giai đoạn 1",
      shortStageLabel: "GĐ1",
      stageShort: "GĐ1",
      suffix: " — Buổi 13 (GĐ1)",
      noteHint: hint,
      commentHint: hint,
    };
  }
  const hint =
    "Buổi 14 (Tổng kết cuối khóa): Đánh giá kết quả sản phẩm hoàn thiện, nội dung cập nhật và hạn chế nếu có.";
  return {
    stageNumber: 2,
    stageLabel: "Tổng kết cuối khóa",
    stageTitle: "Tổng kết cuối khóa",
    shortStageLabel: "CK",
    stageShort: "CK",
    suffix: "",
    noteHint: hint,
    commentHint: hint,
  };
}

function stripUiSessionSuffix(rawTitle: string): string {
  return String(rawTitle || "")
    .replace(/\s*(?:—|-|\|)\s*Buổi\s*(?:12|13|14)(?:\s*\((?:GĐ[12]|Giai\s*đoạn\s*[12])\))?\s*$/gi, "")
    .replace(/\s*\(Buổi\s*(?:12|13|14)(?:\s*-\s*(?:GĐ[12]|Giai\s*đoạn\s*[12]))?\)\s*$/gi, "")
    .replace(/\s*(?:—|–|-|\|)?\s*\(?(?:GĐ\s*2|Giai\s*đoạn\s*2)\)?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatUiSessionTitle(
  rawTitle: string,
  sessionNum: 12 | 13 | 14,
  fallbackStudentName = "Học viên"
): string {
  const base = stripUiSessionSuffix(rawTitle) || `SPCK ${fallbackStudentName}`;
  const stage = getStageMeta(sessionNum);
  return `${base}${stage.suffix}`;
}

function isDefaultUiProductTitle(rawTitle: string, studentFullName = ""): boolean {
  const base = stripUiSessionSuffix(rawTitle);
  if (!base) return true;
  if (/^SPCK\b/i.test(base)) {
    const rest = base.replace(/^SPCK\s*[-:–—]?\s*/i, "").trim();
    if (!rest) return true;
    if (studentFullName && rest.toLowerCase() === studentFullName.trim().toLowerCase()) {
      return true;
    }
    if (!/[-:–—|]/.test(base) && base.split(/\s+/).length <= 6) {
      return true;
    }
  }
  return false;
}

function classifyUiLinkCategory(url: string): {
  category: "LIVE_PRODUCT" | "SOURCE_DOWNLOAD" | "OTHER_DOC";
  label: string;
  badgeClass: string;
} {
  const u = String(url || "").trim().toLowerCase();
  if (
    u.includes(".github.io") ||
    u.includes("vercel.app") ||
    u.includes("netlify.app") ||
    u.includes("scratch.mit.edu/projects") ||
    u.includes("replit.com") ||
    u.includes("codepen.io") ||
    u.includes("itch.io") ||
    u.includes("roblox.com/games")
  ) {
    return {
      category: "LIVE_PRODUCT",
      label: "Chạy thử sản phẩm",
      badgeClass: "bg-indigo-950 text-indigo-300 border-indigo-700/60",
    };
  }
  if (
    u.includes("drive.google.com") ||
    u.includes("github.com/") ||
    u.includes("gitlab.com/") ||
    u.includes("onedrive.live.com") ||
    u.includes("dropbox.com")
  ) {
    return {
      category: "SOURCE_DOWNLOAD",
      label: "Mã nguồn/Tải xuống",
      badgeClass: "bg-sky-950 text-sky-300 border-sky-700/60",
    };
  }
  return {
    category: "OTHER_DOC",
    label: "Tài liệu khác",
    badgeClass: "bg-slate-900 text-slate-300 border-slate-700",
  };
}

function parseJsonSafe<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parseSessionResultsMap(raw?: string | null): SpckSessionResultsMapUI {
  if (!raw || typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: SpckSessionResultsMapUI = {};
    for (const key of ["12", "13", "14"] as const) {
      const entry = parsed[key];
      if (entry && typeof entry === "object" && (entry.status === "VERIFIED" || entry.status === "FAILED")) {
        out[key] = {
          sessionNumber: Number(key) as 12 | 13 | 14,
          status: entry.status,
          submittedContentHash:
            typeof entry.submittedContentHash === "string" ? entry.submittedContentHash : undefined,
          verifiedAt: typeof entry.verifiedAt === "string" ? entry.verifiedAt : null,
          lastVerifiedContentHash:
            typeof entry.lastVerifiedContentHash === "string"
              ? entry.lastVerifiedContentHash
              : undefined,
          lastVerifiedAt:
            typeof entry.lastVerifiedAt === "string" ? entry.lastVerifiedAt : null,
          errorMessage:
            typeof entry.errorMessage === "string" ? entry.errorMessage : null,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function getSessionSlotDisplay(
  row: ScannedFolderUIItem,
  sessionNum: 12 | 13 | 14
): {
  state:
    | "VERIFIED_CURRENT"
    | "VERIFIED_DRAFT_CHANGED"
    | "VERIFIED_FILE_DRIFT"
    | "FAILED"
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
} {
  const key = String(sessionNum) as "12" | "13" | "14";
  const histSlot = row.sessionHistory?.sessions?.[key];

  if (histSlot) {
    if (histSlot.displayState === "CORRUPTED") {
      return {
        state: "CORRUPTED",
        tone: "amber",
        label: "Cần kiểm tra",
        detail: `Buổi ${sessionNum}: Dữ liệu lịch sử cần kiểm tra (${row.sessionHistory?.historyCorruptedReason || "lỗi định dạng JSON"}).`,
        subLabel: "Dữ liệu lịch sử lỗi",
        corruptedReason: row.sessionHistory?.historyCorruptedReason || "Dữ liệu lịch sử cần kiểm tra",
      };
    }
    if (histSlot.displayState === "VERIFIED_FILE_DRIFT") {
      return {
        state: "VERIFIED_FILE_DRIFT",
        tone: "amber",
        label: "Đã nộp ✓ (Tệp gốc đã đổi)",
        detail: `Buổi ${sessionNum}: Đã nộp thành công (${histSlot.lastVerifiedAt || "đã lưu"}), nhưng tệp trên ổ cứng đã thay đổi (${histSlot.driftedFiles.join(", ")}).`,
        subLabel: "Tệp gốc đã đổi",
        verifiedAt: histSlot.lastVerifiedAt,
        hasVerifiedEvidence: true,
        snapshot: histSlot.lastVerifiedSnapshot,
        driftedFiles: histSlot.driftedFiles,
      };
    }
    if (histSlot.displayState === "VERIFIED_WITH_UNSUBMITTED_EDITS") {
      return {
        state: "VERIFIED_DRAFT_CHANGED",
        tone: "teal",
        label: "Đã nộp ✓ (Có bản sửa mới)",
        detail: `Buổi ${sessionNum}: Đã nộp thành công trước đó (${histSlot.lastVerifiedAt || "đã lưu"}), hiện bản nháp của buổi này đã được chỉnh sửa.`,
        subLabel: "Có bản sửa mới chưa nộp",
        verifiedAt: histSlot.lastVerifiedAt,
        hasVerifiedEvidence: true,
        snapshot: histSlot.lastVerifiedSnapshot,
      };
    }
    if (histSlot.displayState === "VERIFIED") {
      const isRowCurrentSessionEdited = Boolean(
        row.contentHash &&
          histSlot.lastVerifiedContentHash &&
          row.contentHash !== histSlot.lastVerifiedContentHash
      );
      if (isRowCurrentSessionEdited) {
        return {
          state: "VERIFIED_DRAFT_CHANGED",
          tone: "teal",
          label: "Đã nộp ✓ (Bản nháp đã đổi)",
          detail: `Buổi ${sessionNum}: Đã nộp thành công (${histSlot.lastVerifiedAt || "đã lưu"}).`,
          subLabel: "Bản nháp đã đổi",
          verifiedAt: histSlot.lastVerifiedAt,
          hasVerifiedEvidence: true,
          snapshot: histSlot.lastVerifiedSnapshot,
        };
      }
      return {
        state: "VERIFIED_CURRENT",
        tone: "emerald",
        label: "Đã nộp ✓",
        detail: `Buổi ${sessionNum}: Đã nộp và xác nhận trên LMS (${histSlot.lastVerifiedAt || "đã lưu"}).`,
        subLabel: histSlot.lastVerifiedContentHash
          ? `#${histSlot.lastVerifiedContentHash.slice(0, 6)}`
          : undefined,
        verifiedAt: histSlot.lastVerifiedAt,
        hasVerifiedEvidence: true,
        snapshot: histSlot.lastVerifiedSnapshot,
      };
    }
    if (histSlot.displayState === "FAILED_AFTER_VERIFIED") {
      return {
        state: "FAILED",
        tone: "rose",
        label: `Lỗi nộp lại (Đã nộp ✓)`,
        detail: `Buổi ${sessionNum}: Lần nộp lại gần nhất bị lỗi (${histSlot.lastErrorMessage || "chưa rõ"}), nhưng vẫn giữ nguyên bằng chứng đã nộp thành công lúc ${histSlot.lastVerifiedAt || ""}.`,
        subLabel: `Đã nộp lúc ${histSlot.lastVerifiedAt || ""}`,
        verifiedAt: histSlot.lastVerifiedAt,
        errorMessage: histSlot.lastErrorMessage,
        hasVerifiedEvidence: true,
        snapshot: histSlot.lastVerifiedSnapshot,
      };
    }
    if (histSlot.displayState === "FAILED") {
      return {
        state: "FAILED",
        tone: "rose",
        label: "Lỗi nộp",
        detail: `Buổi ${sessionNum}: Nộp bị lỗi — ${histSlot.lastErrorMessage || "Vui lòng thử lại"}.`,
        subLabel: histSlot.lastErrorMessage || "Cần thử lại",
        errorMessage: histSlot.lastErrorMessage,
      };
    }
    if (histSlot.displayState === "UNKNOWN_LEGACY") {
      return {
        state: "UNKNOWN_LEGACY",
        tone: "amber",
        label: "Chưa xác định",
        detail:
          row.sessionHistory?.legacyNote ||
          "Bản ghi cũ chỉ có trạng thái đã nộp chung, thiếu bằng chứng xác định đã nộp ở buổi 12, 13 hay 14.",
        subLabel: "Thiếu bản lưu nội dung cũ",
        verifiedAt: row.verifiedAt,
        legacyNote:
          row.sessionHistory?.legacyNote ||
          "Thiếu bản lưu nội dung cũ (dữ liệu trước khi tách riêng từng buổi).",
      };
    }
  }

  const sessionMap = row.sessionResults || {};
  const entry = sessionMap[key];
  const hasAnySessionEntry = Boolean(
    sessionMap["12"] || sessionMap["13"] || sessionMap["14"]
  );

  if (entry?.status === "VERIFIED") {
    const isCurrentDraftSame = Boolean(
      row.contentHash &&
        entry.submittedContentHash &&
        row.contentHash === entry.submittedContentHash &&
        (row.status === "VERIFIED" || row.status === "APPROVED")
    );
    if (isCurrentDraftSame) {
      return {
        state: "VERIFIED_CURRENT",
        tone: "emerald",
        label: "Đã nộp ✓",
        detail: `Buổi ${sessionNum}: Đã nộp và xác nhận trên LMS (${entry.verifiedAt || "đã lưu"}). Bản hiện tại trùng khớp.`,
        subLabel: entry.submittedContentHash
          ? `#${entry.submittedContentHash.slice(0, 6)}`
          : undefined,
        verifiedAt: entry.verifiedAt,
        hasVerifiedEvidence: true,
        snapshot: entry.lastVerifiedSnapshot || null,
      };
    }
    return {
      state: "VERIFIED_DRAFT_CHANGED",
      tone: "teal",
      label: "Đã nộp ✓ (Bản nháp đã đổi)",
      detail: `Buổi ${sessionNum}: Đã nộp thành công trước đó (${entry.verifiedAt || "đã lưu"}), hiện bản nháp trên màn hình đã được chỉnh sửa cho lần nộp tiếp theo.`,
      subLabel: "Bản nháp hiện tại đã đổi",
      verifiedAt: entry.verifiedAt,
      hasVerifiedEvidence: true,
      snapshot: entry.lastVerifiedSnapshot || null,
    };
  }

  if (entry?.status === "FAILED") {
    if (entry.lastVerifiedContentHash) {
      return {
        state: "FAILED",
        tone: "rose",
        label: "Lỗi nộp lại (Có bản cũ ✓)",
        detail: `Buổi ${sessionNum}: Lần nộp lại gần nhất bị lỗi (${entry.errorMessage || "chưa rõ"}), nhưng đã có bản nộp thành công trước đó (${entry.lastVerifiedAt || ""}).`,
        subLabel: "Đã có bản nộp trước",
        verifiedAt: entry.lastVerifiedAt,
        errorMessage: entry.errorMessage,
        hasVerifiedEvidence: true,
        snapshot: entry.lastVerifiedSnapshot || null,
      };
    }
    return {
      state: "FAILED",
      tone: "rose",
      label: "Lỗi nộp",
      detail: `Buổi ${sessionNum}: Nộp bị lỗi — ${entry.errorMessage || "Vui lòng thử lại"}.`,
      subLabel: entry.errorMessage || "Cần thử lại",
      errorMessage: entry.errorMessage,
    };
  }

  if ((row.status === "VERIFIED" || Boolean(row.verifiedAt)) && !hasAnySessionEntry) {
    return {
      state: "UNKNOWN_LEGACY",
      tone: "amber",
      label: "Chưa xác định",
      detail:
        "Bản ghi cũ chỉ có trạng thái đã nộp chung, chưa có thông tin xác định đã nộp ở buổi 12, 13 hay 14.",
      subLabel: "Thiếu bản lưu nội dung cũ",
      verifiedAt: row.verifiedAt,
      legacyNote: "Thiếu bản lưu nội dung cũ (dữ liệu trước khi tách riêng từng buổi).",
    };
  }

  return {
    state: "NOT_SUBMITTED",
    tone: "slate",
    label: "Chưa nộp",
    detail: `Buổi ${sessionNum}: Chưa nộp.`,
  };
}

function getRowReadinessSummary(
  row: ScannedFolderUIItem,
  duplicateStudentIds: Set<string>
): {
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
} {
  const missingReasons: string[] = [];
  if (!row.assignedStudentId) {
    missingReasons.push("Chưa chọn học viên");
  } else if (duplicateStudentIds.has(row.assignedStudentId)) {
    missingReasons.push("Bị trùng học viên");
  } else if (!row.isConfirmedByTeacher) {
    missingReasons.push("Chưa xác nhận đúng học viên");
  }
  const cleanTitle = (row.projectTitle || "").trim();
  const baseTitle = stripUiSessionSuffix(cleanTitle);
  if (!cleanTitle || !baseTitle) {
    missingReasons.push("Thiếu tiêu đề dự án");
  } else if (cleanTitle.length > 100) {
    missingReasons.push(`Tiêu đề vượt 100 ký tự (${cleanTitle.length}/100)`);
  }
  if (!(row.thumbnailPath || "").trim()) {
    missingReasons.push("Thiếu ảnh đại diện (Thumbnail*)");
  }
  if (!(row.teacherComment || "").trim()) {
    missingReasons.push("Thiếu nhận xét giáo viên");
  }
  if (row.status === "INSUFFICIENT_INFO") {
    missingReasons.push("Chưa đủ thông tin tạo nhận xét");
  }

  const parsedYt = parseYoutubeUrlsFromText(row.youtubeUrlsText);
  const parsedLinks = parseRelatedLinksFromText(row.relatedLinksText);
  if ((row.screenshots || []).length > 10) {
    missingReasons.push(`Vượt giới hạn 10 ảnh (${row.screenshots.length}/10)`);
  }
  if ((row.attachments || []).length > 10) {
    missingReasons.push(`Vượt giới hạn 10 file (${row.attachments.length}/10)`);
  }
  if (parsedYt.length > 5) {
    missingReasons.push(`Vượt giới hạn 5 link YouTube (${parsedYt.length}/5)`);
  }
  if (parsedLinks.length > 5) {
    missingReasons.push(`Vượt giới hạn 5 link liên quan (${parsedLinks.length}/5)`);
  }

  const reusedAssetsNotes: string[] = [];
  const rawThumbBase = row.thumbnailPath
    ? row.thumbnailPath.split(/[\\/]/).pop() || ""
    : "";
  const isDefaultThumb =
    !rawThumbBase || rawThumbBase.toLowerCase().includes("default-spck-thumbnail");
  const thumbName = isDefaultThumb ? "Logo MindX" : rawThumbBase;
  const thumbAspect = row.thumbnailInspection?.is16By9
    ? "16:9"
    : row.thumbnailInspection?.aspectRatioLabel || "Khác";
  const thumbBadgeLabel =
    row.thumbnailInspection?.badgeLabel ||
    (isDefaultThumb
      ? "Ảnh mặc định — nên bổ sung ảnh sản phẩm"
      : /_spck_app_shots/i.test(row.thumbnailPath || "")
      ? "Ảnh giao diện phục dựng"
      : "Có ảnh bìa riêng");

  if (isDefaultThumb) {
    reusedAssetsNotes.push("Logo MindX dự phòng");
  } else {
    reusedAssetsNotes.push("Có ảnh bìa riêng");
  }

  const classifiedLinks = parsedLinks.map((lnk) => {
    const cls = classifyUiLinkCategory(lnk.url);
    return {
      name: lnk.name,
      url: lnk.url,
      category:
        cls.category === "LIVE_PRODUCT"
          ? ("DIRECT_PRODUCT_USE" as const)
          : cls.category === "SOURCE_DOWNLOAD"
          ? ("SOURCE_OR_FILE_STORAGE" as const)
          : ("OTHER_DOC" as const),
      categoryLabel:
        cls.category === "LIVE_PRODUCT"
          ? "Mở dùng sản phẩm"
          : cls.category === "SOURCE_DOWNLOAD"
          ? "Kho file / mã nguồn"
          : "Tài liệu khác",
    };
  });

  const hasDriveLink = /drive\.google\.com/i.test(row.relatedLinksText || "");
  const hasLiveWebLink = /github\.io/i.test(row.relatedLinksText || "");
  const hasDirectUseLink = classifiedLinks.some(
    (l) => l.category === "DIRECT_PRODUCT_USE"
  );
  const hasSourceStorageLink = classifiedLinks.some(
    (l) => l.category === "SOURCE_OR_FILE_STORAGE"
  );
  const hasYoutubeLink = parsedYt.length > 0;
  if (hasDriveLink) {
    reusedAssetsNotes.push("Đã gắn link Drive");
  }
  if (hasLiveWebLink) {
    reusedAssetsNotes.push("Đã gắn link Web chạy thử");
  }

  return {
    ready: missingReasons.length === 0,
    missingItems: missingReasons,
    missingReasons,
    reusedAssetsNotes,
    isDefaultTitle: Boolean(
      row.isDefaultProductTitle ?? isDefaultUiProductTitle(cleanTitle)
    ),
    isDefaultThumb,
    thumbName,
    thumbAspect,
    thumbBadgeLabel,
    hasDriveLink,
    hasLiveWebLink,
    hasDirectUseLink,
    hasSourceStorageLink,
    hasYoutubeLink,
    classifiedLinks,
  };
}

function serializeRelatedLinksToText(links: RelatedLinkItem[]): string {
  return (links || []).map((l) => `${l.name} | ${l.url}`).join("\n");
}

function parseRelatedLinksFromText(text: string): RelatedLinkItem[] {
  return (text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (line.includes("|")) {
        const parts = line.split("|");
        const url = parts[parts.length - 1].trim();
        const name = parts.slice(0, -1).join("|").trim() || "Link sản phẩm";
        return { name: name.slice(0, 80), url };
      }
      return { name: "Link sản phẩm", url: line };
    })
    .filter((item) => Boolean(item.url));
}

function parseYoutubeUrlsFromText(text: string): string[] {
  return (text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Builds one UI row from a DB record (shared by hydrateRowsFromDb and the YouTube import merge). */
function buildRowFromDbRecord(
  rec: SpckRecordRow,
  stu: StudentOption | undefined,
  targetSess: 12 | 13 | 14
): ScannedFolderUIItem {
  const screenshots = parseJsonSafe<string[]>(rec.screenshotsJson, []);
  const attachments = parseJsonSafe<string[]>(rec.attachmentsJson, []);
  const youtubeUrls = parseJsonSafe<string[]>(rec.youtubeUrlsJson, []);
  const relatedLinks = parseJsonSafe<RelatedLinkItem[]>(rec.relatedLinksJson, []);
  const quickTags = parseJsonSafe<string[]>(rec.quickTagsJson, []);
  const folderParts = (rec.localFolderPath || "").split(/[\\/]/).filter(Boolean);
  const folderName = folderParts[folderParts.length - 1] || stu?.fullName || rec.studentId;
  const fallbackName = stu?.fullName || rec.studentId;
  const rawTitle = rec.projectTitle || `SPCK ${fallbackName}`;
  const formattedTitle =
    rec.activeSessionNumber === targetSess
      ? rawTitle
      : formatUiSessionTitle(rawTitle, targetSess, fallbackName);

  return {
    folderName,
    folderPath: rec.localFolderPath || "",
    assignedStudentId: rec.studentId,
    matchScore: typeof rec.matchScore === "number" ? rec.matchScore : 1.0,
    requiresManualConfirmation: Number(rec.isConfirmedByTeacher) !== 1,
    isConfirmedByTeacher: Number(rec.isConfirmedByTeacher) === 1,
    warningReasons:
      Number(rec.isConfirmedByTeacher) !== 1
        ? ["Cần giáo viên xác nhận ghép nối studentId trước khi duyệt."]
        : [],
    projectTitle: formattedTitle,
    baseProjectTitle: rec.baseProjectTitle || stripUiSessionSuffix(formattedTitle),
    thumbnailPath: rec.thumbnailPath || "",
    screenshots,
    attachments,
    youtubeUrlsText: youtubeUrls.join("\n"),
    relatedLinksText: serializeRelatedLinksToText(relatedLinks),
    quickTags,
    teacherNote: rec.teacherNote || "",
    includePresentation: targetSess === 14,
    teacherComment: rec.teacherComment || "",
    contentHash: rec.contentHash || "",
    status: rec.status || "DRAFT",
    verifiedAt: rec.verifiedAt,
    errorMessage: rec.errorMessage,
    sessionResults: parseSessionResultsMap(rec.sessionResultsJson),
    sessionHistory: rec.sessionHistory,
    draftVersion: rec.draftVersion,
    hasNewerSharedResources: Boolean(rec.hasNewerSharedResources),
    isDefaultProductTitle:
      rec.isDefaultProductTitle !== undefined
        ? rec.isDefaultProductTitle
        : isDefaultUiProductTitle(formattedTitle, stu?.fullName),
    thumbnailInspection: rec.thumbnailInspection,
    isDirty: false,
  };
}

let clientDraftSequence = 0;
let activeUiClassId = "";
const pageSessionId = `UI_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const latestRowSaveSequence = new Map<string, number>();

export default function FinalProjectPage() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [folderPathInput, setFolderPathInput] = useState<string>("");
  const [rows, setRows] = useState<ScannedFolderUIItem[]>([]);

  const [loadingInit, setLoadingInit] = useState<boolean>(false);
  const [browsingFolder, setBrowsingFolder] = useState<boolean>(false);
  const [folderModalOpen, setFolderModalOpen] = useState<boolean>(false);
  const [browseCurrentPath, setBrowseCurrentPath] = useState<string>("");
  const [browseParentPath, setBrowseParentPath] = useState<string | null>(null);
  const [browseDrives, setBrowseDrives] = useState<string[]>([]);
  const [browseQuickLinks, setBrowseQuickLinks] = useState<
    Array<{ label: string; path: string }>
  >([]);
  const [browseDirectories, setBrowseDirectories] = useState<
    Array<{ name: string; path: string }>
  >([]);
  const [browseFilter, setBrowseFilter] = useState<string>("");
  const [scanning, setScanning] = useState<boolean>(false);
  const [generatingAi, setGeneratingAi] = useState<boolean>(false);
  const [uploading, setUploading] = useState<boolean>(false);

  const [bannerMessage, setBannerMessage] = useState<{
    type: "success" | "warning" | "error";
    text: string;
  } | null>(null);
  const [scanningTeacherClasses, setScanningTeacherClasses] = useState<boolean>(false);
  const [driveFolderUrl, setDriveFolderUrl] = useState<string>(
    "https://drive.google.com/drive/folders/1Xl8OZ7i1bOKf7000xbUBYLPcxVb2qvRD"
  );
  const [uploadingDrive, setUploadingDrive] = useState<boolean>(false);
  const [webRepoUrl, setWebRepoUrl] = useState<string>(
    "https://github.com/Banhtalon/WEB_PRODUCT_SHOW.git"
  );
  const [deployingWeb, setDeployingWeb] = useState<boolean>(false);
  const [templateSheetUrl, setTemplateSheetUrl] = useState<string>("");
  const [demoDateInput, setDemoDateInput] = useState<string>("");
  const [demoSheetTitle, setDemoSheetTitle] = useState<string>(
    "Bảng chấm điểm buổi Demo App Producer - Advanced"
  );
  const [generatedDemoSheetUrl, setGeneratedDemoSheetUrl] = useState<string>("");
  const [creatingDemoSheet, setCreatingDemoSheet] = useState<boolean>(false);
  const [capturingScreenshots, setCapturingScreenshots] = useState<boolean>(false);
  // Robotics (product = YouTube video only): paste class playlist / video links
  const [showYoutubeImport, setShowYoutubeImport] = useState<boolean>(false);
  const [youtubeImportInput, setYoutubeImportInput] = useState<string>("");
  const [importingYoutube, setImportingYoutube] = useState<boolean>(false);
  const [youtubeImportReport, setYoutubeImportReport] = useState<{
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
  } | null>(null);

  // Student Upload Portal State (Direction 1: Direct Student Upload -> Local Folder + Google Drive)
  const [studentPortalRunning, setStudentPortalRunning] = useState<boolean>(false);
  const [studentPortalShareUrl, setStudentPortalShareUrl] = useState<string>("");
  const [studentPortalLanUrl, setStudentPortalLanUrl] = useState<string>("");
  const [studentPortalLocalUrl, setStudentPortalLocalUrl] = useState<string>("");
  const [studentPortalPublicUrl, setStudentPortalPublicUrl] = useState<string>("");
  const [studentPortalTunnelStatus, setStudentPortalTunnelStatus] =
    useState<string>("STOPPED");
  const [studentPortalTunnelProvider, setStudentPortalTunnelProvider] =
    useState<string>("");
  const [studentPortalAutoDrive, setStudentPortalAutoDrive] = useState<boolean>(true);
  const [studentPortalSubmissions, setStudentPortalSubmissions] = useState<
    Array<{
      studentId: string;
      fullName: string;
      filesCount: number;
      driveStatus: string;
      driveFolderUrl?: string;
      driveError?: string;
      submittedAt: string;
    }>
  >([]);
  const [togglingStudentPortal, setTogglingStudentPortal] = useState<boolean>(false);
  const [showPortalQr, setShowPortalQr] = useState<boolean>(false);

  // Streamlined 3-step workflow state (appended after existing state hooks to preserve uiHarness indices)
  const [selectedSessionNumber, setSelectedSessionNumber] = useState<12 | 13 | 14>(13);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([
    "__AUTO_SELECT__",
  ]);
  const [expandedRowKeys, setExpandedRowKeys] = useState<Record<string, boolean>>({});
  const [showOptionalTools, setShowOptionalTools] = useState<boolean>(false);
  const [showDemoPrepPanel, setShowDemoPrepPanel] = useState<boolean>(false);
  const [lastSubmissionSummary, setLastSubmissionSummary] =
    useState<SpckBatchSubmissionSummaryUI | null>(null);
  const [activeActionLabel, setActiveActionLabel] = useState<string | null>(null);
  const [snapshotModalData, setSnapshotModalData] = useState<{
    studentName: string;
    studentId: string;
    sessionNumber: 12 | 13 | 14;
    slot: ReturnType<typeof getSessionSlotDisplay>;
  } | null>(null);

  // Session 14 Course Evaluation & Demo Score State (appended at end of state hooks)
  const [session14Evals, setSession14Evals] = useState<Session14EvalItemUI[]>([]);
  const [demoScoreSourceInput, setDemoScoreSourceInput] = useState<string>("");
  const [importingDemoScores, setImportingDemoScores] = useState<boolean>(false);
  const [generatingS14EvalAi, setGeneratingS14EvalAi] = useState<boolean>(false);
  const [uploadingS14EvalLms, setUploadingS14EvalLms] = useState<boolean>(false);
  const [expandedS14EvalIds, setExpandedS14EvalIds] = useState<Record<string, boolean>>({});

  const hydrateRowsFromDb = useCallback(
    (
      dbRecords: SpckRecordRow[],
      classStudents: StudentOption[],
      activeSessNum?: 12 | 13 | 14
    ) => {
      const targetSess = activeSessNum || 13;
      for (const rec of dbRecords) {
        const recSeq = typeof (rec as any).draftSeq === "number" ? (rec as any).draftSeq : 0;
        if (recSeq > clientDraftSequence) {
          clientDraftSequence = recSeq;
        }
      }
      const studentMap = new Map(classStudents.map((s) => [s.studentId, s]));
      const mapped: ScannedFolderUIItem[] = dbRecords.map((rec) => {
        const stu = studentMap.get(rec.studentId);
        const screenshots = parseJsonSafe<string[]>(rec.screenshotsJson, []);
        const attachments = parseJsonSafe<string[]>(rec.attachmentsJson, []);
        const youtubeUrls = parseJsonSafe<string[]>(rec.youtubeUrlsJson, []);
        const relatedLinks = parseJsonSafe<RelatedLinkItem[]>(rec.relatedLinksJson, []);
        const quickTags = parseJsonSafe<string[]>(rec.quickTagsJson, []);
        const folderParts = (rec.localFolderPath || "").split(/[\\/]/).filter(Boolean);
        const folderName =
          folderParts[folderParts.length - 1] || stu?.fullName || rec.studentId;
        const fallbackName = stu?.fullName || rec.studentId;
        const rawTitle = rec.projectTitle || `SPCK ${fallbackName}`;
        const formattedTitle =
          rec.activeSessionNumber === targetSess
            ? rawTitle
            : formatUiSessionTitle(rawTitle, targetSess, fallbackName);

        return {
          folderName,
          folderPath: rec.localFolderPath || "",
          assignedStudentId: rec.studentId,
          matchScore: typeof rec.matchScore === "number" ? rec.matchScore : 1.0,
          requiresManualConfirmation: Number(rec.isConfirmedByTeacher) !== 1,
          isConfirmedByTeacher: Number(rec.isConfirmedByTeacher) === 1,
          warningReasons:
            Number(rec.isConfirmedByTeacher) !== 1
              ? ["Cần giáo viên xác nhận ghép nối studentId trước khi duyệt."]
              : [],
          projectTitle: formattedTitle,
          baseProjectTitle: rec.baseProjectTitle || stripUiSessionSuffix(formattedTitle),
          thumbnailPath: rec.thumbnailPath || "",
          screenshots,
          attachments,
          youtubeUrlsText: youtubeUrls.join("\n"),
          relatedLinksText: serializeRelatedLinksToText(relatedLinks),
          quickTags,
          teacherNote: rec.teacherNote || "",
          includePresentation: targetSess === 14,
          teacherComment: rec.teacherComment || "",
          contentHash: rec.contentHash || "",
          status: rec.status || "DRAFT",
          verifiedAt: rec.verifiedAt,
          errorMessage: rec.errorMessage,
          sessionResults: parseSessionResultsMap(rec.sessionResultsJson),
          sessionHistory: rec.sessionHistory,
          draftVersion: rec.draftVersion,
          hasNewerSharedResources: Boolean(rec.hasNewerSharedResources),
          isDefaultProductTitle:
            rec.isDefaultProductTitle !== undefined
              ? rec.isDefaultProductTitle
              : isDefaultUiProductTitle(formattedTitle, stu?.fullName),
          thumbnailInspection: rec.thumbnailInspection,
          isDirty: false,
        };
      });
      setRows(mapped);
      const assignedIds = mapped.map((r) => r.assignedStudentId).filter(Boolean);
      const readyIds = mapped
        .filter(
          (r) =>
            r.assignedStudentId &&
            r.isConfirmedByTeacher &&
            (r.projectTitle || "").trim().length > 0 &&
            (r.projectTitle || "").trim().length <= 100 &&
            (r.teacherComment || "").trim().length > 0 &&
            r.status !== "INSUFFICIENT_INFO"
        )
        .map((r) => r.assignedStudentId);
      setSelectedStudentIds((prev) =>
        prev.includes("__AUTO_SELECT__")
          ? readyIds.length > 0
            ? readyIds
            : assignedIds
          : prev.filter((id) => assignedIds.includes(id))
      );
    },
    []
  );

  const loadClassData = useCallback(
    async (targetClassId?: string, targetSessionNumber?: 12 | 13 | 14) => {
      setLoadingInit(true);
      try {
        const params = new URLSearchParams();
        if (targetClassId) {
          params.set("classId", targetClassId);
        }
        if (targetSessionNumber) {
          params.set("sessionNumber", String(targetSessionNumber));
        }
        const query = params.toString() ? `?${params.toString()}` : "";
        const res = await fetch(`/api/spck/list${query}`);
        const data = await res.json();
        if (!data.success) {
          setBannerMessage({
            type: "error",
            text: data.error || "Không thể tải dữ liệu lớp học SPCK.",
          });
          return;
        }
        const classList: ClassOption[] = data.classes || [];
        setClasses(classList);
        const resolvedClassId = targetClassId || data.selectedClassId || "";
        if (!targetClassId && resolvedClassId) {
          setSelectedClassId(resolvedClassId);
        }
        const matchedClass = classList.find((c) => c.classId === resolvedClassId);
        const resolvedSession: 12 | 13 | 14 =
          targetSessionNumber ||
          ([12, 13, 14].includes(Number(data.activeSessionNumber))
            ? (Number(data.activeSessionNumber) as 12 | 13 | 14)
            : matchedClass?.currentSessionNumber &&
              [12, 13, 14].includes(Number(matchedClass.currentSessionNumber))
            ? (Number(matchedClass.currentSessionNumber) as 12 | 13 | 14)
            : 13);
        setSelectedSessionNumber(resolvedSession);
        setStudents(data.students || []);
        if (data.demoSheetMeta) {
          setDemoSheetTitle(
            data.demoSheetMeta.sheetTitle ||
              "Bảng chấm điểm buổi Demo App Producer - Advanced"
          );
          setDemoDateInput(data.demoSheetMeta.demoDate || "");
          setGeneratedDemoSheetUrl(data.demoSheetMeta.latestDemoSheetUrl || "");
        }
        setSelectedStudentIds(["__AUTO_SELECT__"]);
        hydrateRowsFromDb(data.records || [], data.students || [], resolvedSession);
      } catch (err) {
        setBannerMessage({
          type: "error",
          text: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setLoadingInit(false);
      }
    },
    [hydrateRowsFromDb]
  );

  useEffect(() => {
    loadClassData();
  }, [loadClassData]);

  const handleClassChange = async (newClassId: string) => {
    activeUiClassId = newClassId;
    clientDraftSequence++;
    setSelectedClassId(newClassId);
    setBannerMessage(null);
    setLastSubmissionSummary(null);
    setExpandedRowKeys({});
    await loadClassData(newClassId);
  };

  const handleScanTeacherClasses = async () => {
    setScanningTeacherClasses(true);
    setBannerMessage(null);
    try {
      const res = await fetch("/api/spck/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: selectedClassId,
          sessionNumber: selectedSessionNumber,
          forceResyncAll: true,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setBannerMessage({
          type: "error",
          text: data.error || "Không thể quét danh sách lớp từ tài khoản giáo viên trên LMS.",
        });
        return;
      }
      const classList: ClassOption[] = data.classes || [];
      setClasses(classList);
      const resolvedClassId = data.selectedClassId || "";
      setSelectedClassId(resolvedClassId);
      const matchedClass = classList.find((c) => c.classId === resolvedClassId);
      const resolvedSession: 12 | 13 | 14 =
        matchedClass?.currentSessionNumber &&
        [12, 13, 14].includes(Number(matchedClass.currentSessionNumber))
          ? (Number(matchedClass.currentSessionNumber) as 12 | 13 | 14)
          : selectedSessionNumber;
      setSelectedSessionNumber(resolvedSession);
      setStudents(data.students || []);
      if (data.demoSheetMeta) {
        setDemoSheetTitle(
          data.demoSheetMeta.sheetTitle ||
            "Bảng chấm điểm buổi Demo App Producer - Advanced"
        );
        setDemoDateInput(data.demoSheetMeta.demoDate || "");
        setGeneratedDemoSheetUrl(data.demoSheetMeta.latestDemoSheetUrl || "");
      }
      hydrateRowsFromDb(data.records || [], data.students || [], resolvedSession);
      setBannerMessage({
        type: "success",
        text: `Đã quét tài khoản giáo viên (${data.totalRunningClasses || 0} lớp đang dạy & mới kết thúc ≤ 15 ngày) → Lọc được ${(data.classes || []).length} lớp đủ điều kiện nộp SPCK (Buổi ≥ 12).`,
      });
    } catch (err) {
      setBannerMessage({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setScanningTeacherClasses(false);
    }
  };

  // Detect duplicate studentId assignments across rows in the UI
  const duplicateStudentIds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (r.assignedStudentId) {
        counts.set(r.assignedStudentId, (counts.get(r.assignedStudentId) || 0) + 1);
      }
    }
    const dupes = new Set<string>();
    for (const [sid, count] of counts.entries()) {
      if (count > 1) dupes.add(sid);
    }
    return dupes;
  }, [rows]);

  const handleScanFolder = async (overrideFolderPath?: string | React.MouseEvent) => {
    const targetFolderPath =
      typeof overrideFolderPath === "string"
        ? overrideFolderPath.trim()
        : folderPathInput.trim();

    if (!selectedClassId || !targetFolderPath) {
      setBannerMessage({
        type: "warning",
        text: "Vui lòng chọn Lớp học và nhập đường dẫn thư mục SPCK trên máy tính.",
      });
      return;
    }

    const requestClassId = selectedClassId;
    if (!activeUiClassId) {
      activeUiClassId = selectedClassId;
    }
    setScanning(true);
    setBannerMessage(null);
    try {
      const res = await fetch("/api/spck/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: requestClassId,
          folderPath: targetFolderPath,
          sessionNumber: selectedSessionNumber,
        }),
      });
      const data = await res.json();
      if (activeUiClassId && activeUiClassId !== requestClassId) {
        return;
      }
      if (!data.success) {
        setBannerMessage({
          type: "error",
          text: data.error || "Lỗi khi quét thư mục SPCK.",
        });
        return;
      }

      const dbRecordMap = new Map<string, SpckRecordRow>(
        (data.records || []).map((r: SpckRecordRow) => [r.studentId, r])
      );
      const prevRowByStudent = new Map<string, ScannedFolderUIItem>(
        rows
          .filter((r) => Boolean(r.assignedStudentId))
          .map((r) => [r.assignedStudentId, r])
      );

      const scannedItems: ScannedFolderUIItem[] = (data.scanResult?.items || []).map(
        (item: any) => {
          const suggestedId = item.match?.suggestedStudentId || "";
          const dbRec = suggestedId ? dbRecordMap.get(suggestedId) : undefined;
          const prevRow = suggestedId ? prevRowByStudent.get(suggestedId) : undefined;
          const pkg = item.packageData || {};
          const warningList = [
            ...(item.match?.warningReasons || []),
            ...(pkg.warnings || []),
          ];

          const dbYtUrls = dbRec?.youtubeUrlsJson
            ? parseJsonSafe<string[]>(dbRec.youtubeUrlsJson, [])
            : [];
          const dbRelLinks = dbRec?.relatedLinksJson
            ? parseJsonSafe<RelatedLinkItem[]>(dbRec.relatedLinksJson, [])
            : [];
          const dbScreenshots = dbRec?.screenshotsJson
            ? parseJsonSafe<string[]>(dbRec.screenshotsJson, [])
            : [];
          const dbQuickTags = parseJsonSafe<string[]>(dbRec?.quickTagsJson, []);
          // V272-F04: values kept from the screen (not yet in DB) must stay marked as unsaved
          const keptUnsavedFromScreen = Boolean(
            prevRow &&
              ((dbQuickTags.length === 0 && (prevRow.quickTags || []).length > 0) ||
                (!dbRec?.teacherNote && (prevRow.teacherNote || "").trim()) ||
                (!dbRec?.teacherComment && (prevRow.teacherComment || "").trim()))
          );
          const rawTitle =
            dbRec?.projectTitle || pkg.projectTitle || `SPCK ${item.folderName}`;
          const formattedTitle = formatUiSessionTitle(
            rawTitle,
            selectedSessionNumber,
            item.folderName
          );

          return {
            folderName: item.folderName,
            folderPath: item.folderPath,
            assignedStudentId: suggestedId,
            matchScore: item.match?.matchScore ?? 0,
            requiresManualConfirmation: Boolean(item.match?.requiresManualConfirmation),
            isConfirmedByTeacher: dbRec
              ? Number(dbRec.isConfirmedByTeacher) === 1
              : Boolean(item.match?.autoConfirmed),
            warningReasons: warningList,
            projectTitle: formattedTitle,
            baseProjectTitle: stripUiSessionSuffix(formattedTitle),
            thumbnailPath: dbRec?.thumbnailPath || pkg.thumbnailPath || "",
            screenshots: dbScreenshots.length > 0 ? dbScreenshots : pkg.screenshots || [],
            attachments: pkg.attachments || [],
            youtubeUrlsText: (dbYtUrls.length > 0 ? dbYtUrls : pkg.youtubeUrls || []).join("\n"),
            relatedLinksText: serializeRelatedLinksToText(
              dbRelLinks.length > 0 ? dbRelLinks : pkg.relatedLinks || []
            ),
            quickTags:
              dbQuickTags.length > 0 ? dbQuickTags : prevRow?.quickTags || [],
            teacherNote: dbRec?.teacherNote || prevRow?.teacherNote || "",
            includePresentation: prevRow?.includePresentation ?? false,
            teacherComment: dbRec?.teacherComment || prevRow?.teacherComment || "",
            contentHash: dbRec?.contentHash || "",
            status: dbRec?.status || "DRAFT",
            verifiedAt: dbRec?.verifiedAt || null,
            errorMessage: dbRec?.errorMessage || null,
            sessionResults: parseSessionResultsMap(dbRec?.sessionResultsJson),
            sessionHistory: dbRec?.sessionHistory,
            draftVersion: dbRec?.draftVersion ?? 1,
            hasNewerSharedResources: Boolean(dbRec?.hasNewerSharedResources),
            isDefaultProductTitle:
              dbRec?.isDefaultProductTitle ??
              isDefaultUiProductTitle(formattedTitle, item.folderName),
            thumbnailInspection: dbRec?.thumbnailInspection,
            isDirty: keptUnsavedFromScreen,
          };
        }
      );

      setRows(scannedItems);
      const readyAfterScan = scannedItems
        .filter(
          (r) =>
            r.assignedStudentId &&
            r.isConfirmedByTeacher &&
            r.projectTitle.trim().length > 0 &&
            r.projectTitle.trim().length <= 100 &&
            r.teacherComment.trim().length > 0
        )
        .map((r) => r.assignedStudentId);
      const assignedAfterScan = scannedItems
        .map((r) => r.assignedStudentId)
        .filter(Boolean);
      setSelectedStudentIds(
        readyAfterScan.length > 0 ? readyAfterScan : assignedAfterScan
      );
      setBannerMessage({
        type: "success",
        text: `Đã quét thành công ${scannedItems.length} thư mục học viên trong '${data.scanResult?.rootFolderPath}'.`,
      });
    } catch (err) {
      setBannerMessage({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setScanning(false);
    }
  };

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

  const persistRowDraft = async (
    row: ScannedFolderUIItem,
    overrides?: Partial<ScannedFolderUIItem>,
    overrideSessionNumber?: 12 | 13 | 14
  ): Promise<boolean> => {
    const merged = { ...row, ...overrides };
    if (!selectedClassId || !merged.assignedStudentId) return false;

    const targetSessionNum = overrideSessionNumber || selectedSessionNumber;
    const requestClassId = selectedClassId;
    if (!activeUiClassId) {
      activeUiClassId = selectedClassId;
    }
    const rowKey = `${requestClassId}::${merged.folderPath || merged.assignedStudentId}`;
    const seq = ++clientDraftSequence;
    latestRowSaveSequence.set(rowKey, seq);

    if (overrides && Object.keys(overrides).length > 0) {
      setRows((prev) =>
        prev.map((r) => (r.folderPath === merged.folderPath ? { ...merged } : r))
      );
    }

    const youtubeUrls = parseYoutubeUrlsFromText(merged.youtubeUrlsText);
    const relatedLinks = parseRelatedLinksFromText(merged.relatedLinksText);
    const isStudentChanged = Boolean(
      overrides?.assignedStudentId &&
        overrides.assignedStudentId !== row.assignedStudentId
    );
    const reassignFromStudentId =
      isStudentChanged && row.assignedStudentId ? row.assignedStudentId : undefined;
    const effectiveExpectedVersion = isStudentChanged
      ? overrides?.draftVersion ??
        rows.find(
          (r) =>
            r.assignedStudentId === merged.assignedStudentId &&
            r.folderPath !== merged.folderPath
        )?.draftVersion
      : merged.draftVersion;

    try {
      const res = await fetch("/api/spck/save-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: requestClassId,
          studentId: merged.assignedStudentId,
          sessionNumber: targetSessionNum,
          expectedVersion: effectiveExpectedVersion,
          localFolderPath: merged.folderPath,
          matchScore: merged.matchScore,
          isConfirmedByTeacher: merged.isConfirmedByTeacher,
          projectTitle: merged.projectTitle,
          thumbnailPath: merged.thumbnailPath,
          screenshots: merged.screenshots,
          attachments: merged.attachments,
          youtubeUrls,
          relatedLinks,
          teacherComment: merged.teacherComment,
          teacherNote: merged.teacherNote,
          quickTags: merged.quickTags,
          draftSeq: seq,
          clientSessionId: pageSessionId,
          reassignFromStudentId,
          reassignFolder: Boolean(reassignFromStudentId),
        }),
      });
      const data = await res.json();
      const isLatestForRow =
        latestRowSaveSequence.get(rowKey) === seq &&
        (!activeUiClassId || activeUiClassId === requestClassId);

      if (res.ok && data?.success) {
        if (data.staleIgnored && isLatestForRow) {
          setBannerMessage({
            type: "warning",
            text: "Phiên bản bản nháp trên máy chủ mới hơn. Vui lòng tải lại dữ liệu trước khi lưu tiếp.",
          });
          return false;
        }
        const resolvedNextDraftVersion =
          data.sessionDraft?.draftVersion ??
          data.record?.draftVersion ??
          merged.draftVersion ??
          row.draftVersion;
        const resolvedSavedRow: ScannedFolderUIItem = {
          ...merged,
          projectTitle: data.record?.projectTitle || merged.projectTitle,
          baseProjectTitle:
            data.record?.baseProjectTitle ||
            stripUiSessionSuffix(data.record?.projectTitle || merged.projectTitle),
          status: data.record?.status || merged.status,
          contentHash: data.record?.contentHash || "",
          errorMessage: data.record?.errorMessage || null,
          draftVersion: resolvedNextDraftVersion,
          isDirty: false,
        };
        if (isLatestForRow && data.record && !data.staleIgnored) {
          setRows((prev) =>
            prev.map((r) => {
              if (r.folderPath !== merged.folderPath) return r;
              const hasLocalEditSinceRequest =
                r.assignedStudentId !== merged.assignedStudentId ||
                r.isConfirmedByTeacher !== merged.isConfirmedByTeacher ||
                r.projectTitle !== merged.projectTitle ||
                r.thumbnailPath !== merged.thumbnailPath ||
                r.youtubeUrlsText !== merged.youtubeUrlsText ||
                r.relatedLinksText !== merged.relatedLinksText ||
                r.teacherComment !== merged.teacherComment ||
                (r.teacherNote || "") !== (merged.teacherNote || "") ||
                JSON.stringify(r.quickTags || []) !==
                  JSON.stringify(merged.quickTags || []) ||
                Boolean(r.includePresentation) !==
                  Boolean(merged.includePresentation) ||
                JSON.stringify(r.screenshots) !== JSON.stringify(merged.screenshots) ||
                JSON.stringify(r.attachments) !== JSON.stringify(merged.attachments);
              const nextSessionResults =
                parseSessionResultsMap(data.record.sessionResultsJson) ||
                merged.sessionResults ||
                r.sessionResults;
              const nextSessionHistory =
                data.record.sessionHistory || merged.sessionHistory || r.sessionHistory;
              const nextDraftVersion = resolvedNextDraftVersion;
              if (hasLocalEditSinceRequest) {
                return {
                  ...r,
                  sessionResults: nextSessionResults,
                  sessionHistory: nextSessionHistory,
                  draftVersion: nextDraftVersion,
                };
              }
              return {
                ...r,
                projectTitle: data.record.projectTitle || merged.projectTitle,
                baseProjectTitle:
                  data.record.baseProjectTitle ||
                  stripUiSessionSuffix(data.record.projectTitle || merged.projectTitle),
                thumbnailPath: merged.thumbnailPath,
                screenshots: merged.screenshots,
                attachments: merged.attachments,
                youtubeUrlsText: merged.youtubeUrlsText,
                relatedLinksText: merged.relatedLinksText,
                teacherComment: merged.teacherComment,
                teacherNote: merged.teacherNote,
                quickTags: merged.quickTags,
                isConfirmedByTeacher: merged.isConfirmedByTeacher,
                assignedStudentId: merged.assignedStudentId,
                status: data.record.status,
                contentHash: data.record.contentHash || "",
                errorMessage: data.record.errorMessage || null,
                sessionResults: nextSessionResults,
                sessionHistory: nextSessionHistory,
                draftVersion: nextDraftVersion,
                hasNewerSharedResources: Boolean(data.record.hasNewerSharedResources),
                isDefaultProductTitle:
                  data.record.isDefaultProductTitle ??
                  isDefaultUiProductTitle(data.record.projectTitle || merged.projectTitle),
                thumbnailInspection:
                  data.record.thumbnailInspection || r.thumbnailInspection,
                isDirty: false,
              };
            })
          );
        }
        return {
          ok: true,
          draftVersion: resolvedNextDraftVersion,
          row: resolvedSavedRow,
        } as any;
      }

      setBannerMessage({
        type: "error",
        text: data?.error || "Không thể lưu nháp SPCK.",
      });
      return false;
    } catch (err) {
      setBannerMessage({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  };

  // Safe session switch: flushes any unsaved drafts for the current session before loading the next session
  const handleSessionChange = async (nextSessionNum: 12 | 13 | 14) => {
    if (nextSessionNum === selectedSessionNumber) return;
    if (isAnyOperationBusy) return;

    const dirtyRows = rows.filter((r) => r.assignedStudentId && r.isDirty);
    if (dirtyRows.length > 0 && selectedClassId) {
      for (const dirtyRow of dirtyRows) {
        const savedOk = await persistRowDraft(
          dirtyRow,
          undefined,
          selectedSessionNumber
        );
        if (!savedOk) {
          setBannerMessage({
            type: "error",
            text: `Không thể lưu nháp Buổi ${selectedSessionNumber} cho học viên '${dirtyRow.folderName || dirtyRow.assignedStudentId}' trước khi chuyển sang Buổi ${nextSessionNum}. Đã giữ nguyên màn hình hiện tại để tránh mất dữ liệu.`,
          });
          return;
        }
      }
    }

    setSelectedSessionNumber(nextSessionNum);
    setBannerMessage(null);
    if (selectedClassId) {
      await loadClassData(selectedClassId, nextSessionNum);
    } else {
      setRows((prev) =>
        prev.map((r) => {
          const nextTitle = formatUiSessionTitle(
            r.baseProjectTitle || r.projectTitle,
            nextSessionNum,
            r.folderName
          );
          return {
            ...r,
            projectTitle: nextTitle,
          };
        })
      );
    }
  };

  // Explicit "Dùng tài nguyên mới nhất" action
  const handleSyncLatestResources = async (row: ScannedFolderUIItem) => {
    if (!selectedClassId || !row.assignedStudentId) return;
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

  const handleGenerateAiComments = async (targetFolderPaths?: string[]) => {
    const targetRows = rows.filter(
      (r) =>
        r.assignedStudentId &&
        (!targetFolderPaths || targetFolderPaths.includes(r.folderPath))
    );

    if (targetRows.length === 0) {
      setBannerMessage({
        type: "warning",
        text: "Chưa có học viên nào được gán studentId để AI soạn nhận xét cuối khóa.",
      });
      return;
    }

    const requestClassId = selectedClassId;
    const requestSessionNum = selectedSessionNumber;
    if (!activeUiClassId) {
      activeUiClassId = selectedClassId;
    }
    const initialRowSnapshots = new Map<
      string,
      {
        teacherComment: string;
        projectTitle: string;
        folderPath: string;
        teacherNote: string;
        quickTagsJson: string;
        includePresentation: boolean;
        thumbnailPath: string;
        screenshotsJson: string;
        attachmentsJson: string;
        youtubeUrlsText: string;
        relatedLinksText: string;
      }
    >(
      targetRows.map((r) => [
        r.assignedStudentId,
        {
          teacherComment: r.teacherComment,
          projectTitle: r.projectTitle,
          folderPath: r.folderPath,
          teacherNote: r.teacherNote || "",
          quickTagsJson: JSON.stringify(r.quickTags || []),
          includePresentation: Boolean(r.includePresentation),
          thumbnailPath: r.thumbnailPath || "",
          screenshotsJson: JSON.stringify(r.screenshots || []),
          attachmentsJson: JSON.stringify(r.attachments || []),
          youtubeUrlsText: r.youtubeUrlsText || "",
          relatedLinksText: r.relatedLinksText || "",
        },
      ])
    );

    setGeneratingAi(true);
    setBannerMessage(null);
    try {
      const payloadStudents = targetRows.map((r) => ({
        studentId: r.assignedStudentId,
        expectedVersion: r.draftVersion,
        projectTitle: r.projectTitle,
        localFolderPath: r.folderPath,
        thumbnailPath: r.thumbnailPath,
        screenshots: r.screenshots,
        attachments: r.attachments,
        youtubeUrls: parseYoutubeUrlsFromText(r.youtubeUrlsText),
        relatedLinks: parseRelatedLinksFromText(r.relatedLinksText),
        quickTags: r.quickTags,
        teacherNote: r.teacherNote,
        includePresentation: r.includePresentation,
      }));

      const res = await fetch("/api/spck/generate-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: requestClassId,
          sessionNumber: requestSessionNum,
          students: payloadStudents,
        }),
      });
      const data = await res.json();
      if (activeUiClassId && activeUiClassId !== requestClassId) {
        return;
      }
      if (!data.success) {
        setBannerMessage({
          type: "error",
          text: data.error || "Lỗi khi gọi AI soạn nhận xét cuối khóa.",
        });
        return;
      }

      const resultByStudent = new Map<string, any>(
        (data.results || []).map((item: any) => [item.studentId, item])
      );
      const recordByStudent = new Map<string, SpckRecordRow>(
        (data.records || []).map((rec: SpckRecordRow) => [rec.studentId, rec])
      );

      setRows((prev) =>
        prev.map((row) => {
          const gen = resultByStudent.get(row.assignedStudentId);
          const updatedRec = recordByStudent.get(row.assignedStudentId);
          const resolvedDraftVersion =
            (typeof gen?.draftVersion === "number" ? gen.draftVersion : undefined) ??
            updatedRec?.draftVersion ??
            row.draftVersion;
          if (!gen || gen.staleIgnored) {
            return {
              ...row,
              draftVersion: resolvedDraftVersion,
              sessionHistory: updatedRec?.sessionHistory || row.sessionHistory,
            };
          }
          const snap = initialRowSnapshots.get(row.assignedStudentId);
          if (
            snap &&
            (row.teacherComment !== snap.teacherComment ||
              row.projectTitle !== snap.projectTitle ||
              row.folderPath !== snap.folderPath ||
              (row.teacherNote || "") !== snap.teacherNote ||
              JSON.stringify(row.quickTags || []) !== snap.quickTagsJson ||
              Boolean(row.includePresentation) !== snap.includePresentation ||
              (row.thumbnailPath || "") !== snap.thumbnailPath ||
              JSON.stringify(row.screenshots || []) !== snap.screenshotsJson ||
              JSON.stringify(row.attachments || []) !== snap.attachmentsJson ||
              (row.youtubeUrlsText || "") !== snap.youtubeUrlsText ||
              (row.relatedLinksText || "") !== snap.relatedLinksText)
          ) {
            return {
              ...row,
              draftVersion: resolvedDraftVersion,
              sessionHistory: updatedRec?.sessionHistory || row.sessionHistory,
              isDirty: true,
            };
          }
          return {
            ...row,
            projectTitle: updatedRec?.projectTitle || row.projectTitle,
            teacherComment:
              gen.status === "WAITING_APPROVAL"
                ? gen.formattedTeacherComment
                : row.teacherComment,
            status: gen.status,
            contentHash: "",
            errorMessage: gen.errorMessage || null,
            draftVersion: resolvedDraftVersion,
            sessionHistory: updatedRec?.sessionHistory || row.sessionHistory,
            isDirty: false,
          };
        })
      );

      const stageMeta = getStageMeta(requestSessionNum);
      const generatedResults = Array.isArray(data.results) ? data.results : [];
      const successCount = generatedResults.filter(
        (item: any) =>
          item.status === "WAITING_APPROVAL" &&
          !item.staleIgnored &&
          String(item.formattedTeacherComment || "").trim().length > 0
      ).length;
      const insufficientItems = generatedResults.filter(
        (item: any) => item.status === "INSUFFICIENT_INFO"
      );
      const failedItems = generatedResults.filter(
        (item: any) => item.status === "FAILED"
      );

      if (insufficientItems.length === 0 && failedItems.length === 0 && successCount >= targetRows.length) {
        setBannerMessage({
          type: "success",
          text: `Đã hoàn tất AI soạn nhận xét Buổi ${requestSessionNum}${stageMeta.stageLabel ? ` (${stageMeta.stageLabel})` : ""} cho ${successCount}/${targetRows.length} học viên.`,
        });
      } else {
        const detailParts: string[] = [];
        if (insufficientItems.length > 0) {
          detailParts.push(
            `${insufficientItems.length} học viên thiếu Quick Tags / Ghi chú (${insufficientItems
              .map((it: any) => it.fullName || it.studentId)
              .join(", ")})`
          );
        }
        if (failedItems.length > 0) {
          detailParts.push(
            `${failedItems.length} học viên lỗi AI (${failedItems
              .map((it: any) => `${it.fullName || it.studentId}: ${it.errorMessage || "Lỗi"}`)
              .join("; ")})`
          );
        }
        setBannerMessage({
          type: successCount > 0 ? "warning" : "error",
          text: `AI đã soạn ${successCount}/${targetRows.length} nhận xét Buổi ${requestSessionNum}${
            detailParts.length > 0 ? ` — ${detailParts.join(" | ")}` : ""
          }.`,
        });
      }
    } catch (err) {
      setBannerMessage({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setGeneratingAi(false);
    }
  };

  const handleApproveAndUpload = async (
    targetStudentIds: string[],
    _triggerUploadAfterApprove = true,
    overrideSessionNumber?: number
  ) => {
    const rawSessionNum =
      overrideSessionNumber !== undefined
        ? Number(overrideSessionNumber)
        : Number(selectedSessionNumber);
    if (![12, 13, 14].includes(rawSessionNum)) {
      setBannerMessage({
        type: "error",
        text: `Buổi nộp SPCK không hợp lệ (${String(overrideSessionNumber ?? selectedSessionNumber)}). Vui lòng chọn đúng Buổi 12, 13 hoặc 14 ở Bước 1 trước khi nộp (không tự động chuyển sang Buổi 13).`,
      });
      return;
    }
    const targetSessionNum = rawSessionNum as 12 | 13 | 14;

    const normalizedTargetIds = Array.from(
      new Set((targetStudentIds || []).map((id) => String(id || "").trim()).filter(Boolean))
    );
    if (!selectedClassId || normalizedTargetIds.length === 0) {
      setBannerMessage({
        type: "warning",
        text: "Chưa có học viên hợp lệ nào được chọn để nộp SPCK.",
      });
      return;
    }

    if (duplicateStudentIds.size > 0) {
      setBannerMessage({
        type: "error",
        text: `Phát hiện học viên bị ghép trùng nhiều thư mục (${Array.from(duplicateStudentIds).join(", ")}). Vui lòng xử lý trên Bảng Ghép nối trước khi nộp.`,
      });
      return;
    }

    const requestClassId = selectedClassId;
    if (!activeUiClassId) {
      activeUiClassId = selectedClassId;
    }

    const studentNameMap = new Map(students.map((s) => [s.studentId, s.fullName]));
    const resolveStudentLabel = (sid: string) =>
      studentNameMap.get(sid) ||
      rows.find((r) => r.assignedStudentId === sid)?.folderName ||
      sid;

    setUploading(true);
    setActiveActionLabel(
      `Đang kiểm tra & nộp ${normalizedTargetIds.length} bài — Buổi ${targetSessionNum} (Lớp ${requestClassId})...`
    );
    setBannerMessage(null);
    try {
      const savedRowsByStudent = new Map<string, ScannedFolderUIItem>();
      // Save latest drafts first; abort immediately if any draft save fails
      for (const sid of normalizedTargetIds) {
        const row = rows.find((r) => r.assignedStudentId === sid);
        if (row) {
          const savedRes: any = await persistRowDraft(row, undefined, targetSessionNum);
          if (!savedRes || (activeUiClassId && activeUiClassId !== requestClassId)) {
            return;
          }
          if (typeof savedRes === "object" && savedRes.row) {
            savedRowsByStudent.set(sid, savedRes.row);
          } else if (typeof savedRes === "object" && typeof savedRes.draftVersion === "number") {
            savedRowsByStudent.set(sid, {
              ...row,
              draftVersion: savedRes.draftVersion,
            });
          }
        }
      }

      if (activeUiClassId && activeUiClassId !== requestClassId) {
        return;
      }

      const reviewedItems = normalizedTargetIds
        .map((sid) => savedRowsByStudent.get(sid) || rows.find((r) => r.assignedStudentId === sid))
        .filter(Boolean)
        .map((r) => ({
          studentId: r!.assignedStudentId,
          draftVersion: r!.draftVersion,
          localFolderPath: r!.folderPath,
          isConfirmedByTeacher: r!.isConfirmedByTeacher ? 1 : 0,
          projectTitle: r!.projectTitle,
          thumbnailPath: r!.thumbnailPath,
          screenshotsJson: JSON.stringify(r!.screenshots || []),
          attachmentsJson: JSON.stringify(r!.attachments || []),
          youtubeUrlsJson: JSON.stringify(parseYoutubeUrlsFromText(r!.youtubeUrlsText)),
          relatedLinksJson: JSON.stringify(parseRelatedLinksFromText(r!.relatedLinksText)),
          teacherComment: r!.teacherComment,
        }));

      const approveRes = await fetch("/api/spck/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: requestClassId,
          sessionNumber: targetSessionNum,
          studentIds: normalizedTargetIds,
          reviewedItems,
        }),
      });
      const approveData = await approveRes.json();
      if (activeUiClassId && activeUiClassId !== requestClassId) {
        return;
      }

      if (!approveData.success) {
        const approveSkippedList: Array<{
          studentId: string;
          studentName: string;
          reason: string;
        }> = Array.isArray(approveData.skipped)
          ? approveData.skipped.map((item: any) => ({
              studentId: String(item.studentId || ""),
              studentName: resolveStudentLabel(String(item.studentId || "")),
              reason: String(item.reason || approveData.error || "Chưa đủ điều kiện nộp."),
            }))
          : [];
        if (approveSkippedList.length > 0) {
          setLastSubmissionSummary({
            sessionNumber: targetSessionNum,
            totalSelected: normalizedTargetIds.length,
            verifiedItems: [],
            failedItems: [],
            skippedItems: approveSkippedList,
            retryStudentIds: normalizedTargetIds,
            completedAt: new Date().toLocaleTimeString("vi-VN"),
          });
          setBannerMessage({
            type: "error",
            text: `Đã nộp 0/${normalizedTargetIds.length} bài (Buổi ${targetSessionNum}) — ${approveSkippedList.length} bài bị bỏ qua: ${approveSkippedList
              .map((s) => `${s.studentName} (${s.reason})`)
              .join("; ")}`,
          });
        } else {
          setBannerMessage({
            type: "error",
            text: approveData.error || "Không thể chuẩn bị gói SPCK trước khi nộp.",
          });
        }
        return;
      }

      const dbByStu = new Map<string, SpckRecordRow>(
        (approveData.records || [])
          .filter((r: SpckRecordRow) => !r.classId || r.classId === requestClassId)
          .map((r: SpckRecordRow) => [r.studentId, r])
      );
      setRows((prev) =>
        prev.map((row) => {
          const rec = dbByStu.get(row.assignedStudentId);
          if (!rec) return row;
          return {
            ...row,
            projectTitle: rec.projectTitle || row.projectTitle,
            status: rec.status,
            contentHash: rec.contentHash || "",
            verifiedAt: rec.verifiedAt,
            errorMessage: rec.errorMessage,
            draftVersion: rec.draftVersion ?? row.draftVersion,
            sessionResults:
              parseSessionResultsMap(rec.sessionResultsJson) || row.sessionResults,
            sessionHistory: rec.sessionHistory || row.sessionHistory,
            isDirty: false,
          };
        })
      );

      const approvedIds: string[] = Array.isArray(approveData.approvedStudentIds)
        ? approveData.approvedStudentIds
        : [];
      const approveSkippedMap = new Map<string, string>();
      if (Array.isArray(approveData.skipped)) {
        for (const sk of approveData.skipped) {
          if (sk?.studentId) {
            approveSkippedMap.set(
              String(sk.studentId),
              String(sk.reason || "Bị bỏ qua ở bước kiểm tra điều kiện trước khi nộp.")
            );
          }
        }
      }
      for (const sid of normalizedTargetIds) {
        if (!approvedIds.includes(sid) && !approveSkippedMap.has(sid)) {
          approveSkippedMap.set(
            sid,
            "Chưa đủ điều kiện duyệt để đưa vào hàng đợi nộp LMS."
          );
        }
      }

      if (approvedIds.length === 0) {
        const skippedOnly = Array.from(approveSkippedMap.entries()).map(
          ([studentId, reason]) => ({
            studentId,
            studentName: resolveStudentLabel(studentId),
            reason,
          })
        );
        setLastSubmissionSummary({
          sessionNumber: targetSessionNum,
          totalSelected: normalizedTargetIds.length,
          verifiedItems: [],
          failedItems: [],
          skippedItems: skippedOnly,
          retryStudentIds: normalizedTargetIds,
          completedAt: new Date().toLocaleTimeString("vi-VN"),
        });
        setBannerMessage({
          type: "error",
          text: `Đã nộp 0/${normalizedTargetIds.length} bài (Buổi ${targetSessionNum}) — ${skippedOnly.length} bài bị bỏ qua: ${skippedOnly
            .map((s) => `${s.studentName} (${s.reason})`)
            .join("; ")}`,
        });
        return;
      }

      const uploadRes = await fetch("/api/spck/upload-lms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: requestClassId,
          sessionNumber: targetSessionNum,
          studentIds: approvedIds,
        }),
      });
      const uploadData = await uploadRes.json();
      if (activeUiClassId && activeUiClassId !== requestClassId) {
        return;
      }
      if (!uploadData.success) {
        setBannerMessage({
          type: "error",
          text: uploadData.error || "Lỗi khi Auto-Upload SPCK lên LMS.",
        });
        return;
      }

      const postUploadMap = new Map<string, SpckRecordRow>(
        (uploadData.records || [])
          .filter((r: SpckRecordRow) => !r.classId || r.classId === requestClassId)
          .map((r: SpckRecordRow) => [r.studentId, r])
      );
      setRows((prev) =>
        prev.map((row) => {
          const rec = postUploadMap.get(row.assignedStudentId);
          if (!rec) return row;
          return {
            ...row,
            status: rec.status,
            contentHash: rec.contentHash || "",
            verifiedAt: rec.verifiedAt,
            errorMessage: rec.errorMessage,
            draftVersion: rec.draftVersion ?? row.draftVersion,
            hasNewerSharedResources: Boolean(rec.hasNewerSharedResources),
            thumbnailInspection: rec.thumbnailInspection || row.thumbnailInspection,
            sessionResults:
              parseSessionResultsMap(rec.sessionResultsJson) || row.sessionResults,
            sessionHistory: rec.sessionHistory || row.sessionHistory,
          };
        })
      );

      const uSummary = uploadData.uploadResult;
      const verifiedItems: Array<{ studentId: string; studentName: string }> = [];
      const failedItems: Array<{
        studentId: string;
        studentName: string;
        reason: string;
      }> = [];
      const skippedItems: Array<{
        studentId: string;
        studentName: string;
        reason: string;
      }> = Array.from(approveSkippedMap.entries()).map(([studentId, reason]) => ({
        studentId,
        studentName: resolveStudentLabel(studentId),
        reason,
      }));

      if (Array.isArray(uSummary?.results)) {
        const reportedIds = new Set<string>();
        for (const item of uSummary.results) {
          const sid = String(item?.studentId || "");
          if (!sid) continue;
          reportedIds.add(sid);
          const sName = resolveStudentLabel(sid);
          if (item.status === "VERIFIED") {
            verifiedItems.push({ studentId: sid, studentName: sName });
          } else if (item.status === "FAILED") {
            failedItems.push({
              studentId: sid,
              studentName: sName,
              reason: String(item.errorMessage || "Lỗi khi nộp lên LMS."),
            });
          } else if (item.status === "WAITING_APPROVAL") {
            skippedItems.push({
              studentId: sid,
              studentName: sName,
              reason: String(
                item.errorMessage ||
                  "Nội dung SPCK thay đổi trước khi lưu, cần duyệt lại."
              ),
            });
          } else {
            skippedItems.push({
              studentId: sid,
              studentName: sName,
              reason: String(item.errorMessage || "Bị bỏ qua trong quá trình nộp LMS."),
            });
          }
        }
        for (const sid of approvedIds) {
          if (!reportedIds.has(sid)) {
            const rec = postUploadMap.get(sid);
            const sName = resolveStudentLabel(sid);
            if (rec?.status === "VERIFIED") {
              verifiedItems.push({ studentId: sid, studentName: sName });
            } else if (rec?.status === "FAILED") {
              failedItems.push({
                studentId: sid,
                studentName: sName,
                reason: String(rec.errorMessage || "Lỗi khi nộp lên LMS."),
              });
            } else {
              skippedItems.push({
                studentId: sid,
                studentName: sName,
                reason: String(
                  rec?.errorMessage ||
                    "Chưa được xử lý hoàn tất (tác vụ dừng sớm hoặc cần duyệt lại)."
                ),
              });
            }
          }
        }
      } else {
        for (const sid of approvedIds) {
          const rec = postUploadMap.get(sid);
          const sName = resolveStudentLabel(sid);
          if (rec?.status === "VERIFIED") {
            verifiedItems.push({ studentId: sid, studentName: sName });
          } else if (rec?.status === "FAILED") {
            failedItems.push({
              studentId: sid,
              studentName: sName,
              reason: String(rec.errorMessage || "Lỗi khi nộp lên LMS."),
            });
          } else if (rec) {
            skippedItems.push({
              studentId: sid,
              studentName: sName,
              reason: String(
                rec.errorMessage || "Bị bỏ qua do thay đổi dữ liệu trong lúc nộp."
              ),
            });
          }
        }
      }

      const totalSelected = normalizedTargetIds.length;
      const verifiedCount =
        verifiedItems.length > 0 || failedItems.length > 0 || skippedItems.length > 0
          ? verifiedItems.length
          : Number(uSummary?.verifiedCount || 0);
      const failedCount =
        failedItems.length > 0
          ? failedItems.length
          : Number(uSummary?.failedCount || 0);
      const skippedCount = skippedItems.length;
      const unsubmittedCount = Math.max(0, totalSelected - verifiedCount);
      const retryStudentIds = Array.from(
        new Set([
          ...failedItems.map((f) => f.studentId),
          ...skippedItems.map((s) => s.studentId),
        ])
      );

      setLastSubmissionSummary({
        sessionNumber: targetSessionNum,
        totalSelected,
        verifiedItems,
        failedItems,
        skippedItems,
        retryStudentIds,
        completedAt: new Date().toLocaleTimeString("vi-VN"),
      });

      if (retryStudentIds.length > 0) {
        setSelectedStudentIds(retryStudentIds);
      }

      if (unsubmittedCount === 0 && failedCount === 0 && skippedCount === 0) {
        setBannerMessage({
          type: "success",
          text: `Đã nộp ${verifiedCount}/${totalSelected} bài — Buổi ${targetSessionNum} (Đã đối chiếu VERIFIED đầy đủ trên LMS, lỗi 0, bỏ qua 0).`,
        });
      } else {
        const detailParts: string[] = [];
        if (skippedCount > 0) {
          detailParts.push(
            `Bị bỏ qua ${skippedCount}: ${skippedItems
              .map((s) => `${s.studentName} (${s.reason})`)
              .join("; ")}`
          );
        }
        if (failedCount > 0) {
          detailParts.push(
            `Lỗi ${failedCount}: ${failedItems
              .map((f) => `${f.studentName} (${f.reason})`)
              .join("; ")}`
          );
        }
        setBannerMessage({
          type: verifiedCount > 0 ? "warning" : "error",
          text: `Đã nộp ${verifiedCount}/${totalSelected} bài (Buổi ${targetSessionNum}) — ${unsubmittedCount} bài chưa nộp${
            detailParts.length > 0 ? ` • ${detailParts.join(" | ")}` : ""
          }.`,
        });
      }
    } catch (err) {
      if (!activeUiClassId || activeUiClassId === requestClassId) {
        setBannerMessage({
          type: "error",
          text: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      setUploading(false);
      setActiveActionLabel(null);
    }
  };

  // 7. Upload student local folders to Google Drive & auto-attach Drive link into relatedLinksText
  const handleUploadToGoogleDrive = async (targetStudentIds?: string[]) => {
    if (!selectedClassId) {
      setBannerMessage({
        type: "warning",
        text: "Vui lòng chọn Lớp học trước khi tải sản phẩm lên Google Drive.",
      });
      return;
    }

    const idsToUpload =
      targetStudentIds && targetStudentIds.length > 0
        ? targetStudentIds
        : rows
            .filter((r) => r.assignedStudentId && r.folderPath)
            .map((r) => r.assignedStudentId);

    if (idsToUpload.length === 0) {
      setBannerMessage({
        type: "warning",
        text: "Chưa có học viên nào có thư mục sản phẩm trên máy tính để tải lên Google Drive.",
      });
      return;
    }

    const requestClassId = selectedClassId;
    setUploadingDrive(true);
    setBannerMessage({
      type: "warning",
      text: `Đang mở Google Drive để tạo thư mục cho ${idsToUpload.length} học viên và tải sản phẩm lên... (Nếu lần đầu chưa đăng nhập Google trên trình duyệt Bot, vui lòng đăng nhập trực tiếp trên cửa sổ Chrome của Bot)`,
    });

    try {
      for (const row of rows) {
        if (idsToUpload.includes(row.assignedStudentId)) {
          const saved = await persistRowDraft(row);
          if (activeUiClassId && activeUiClassId !== requestClassId) {
            return;
          }
          if (!saved) {
            setBannerMessage({
              type: "error",
              text: `Lưu bản nháp cho học viên '${row.folderName || row.assignedStudentId}' thất bại. Đã dừng tải lên Google Drive để tránh dùng dữ liệu cũ.`,
            });
            return;
          }
        }
      }

      const res = await fetch("/api/spck/upload-drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: requestClassId,
          sessionNumber: selectedSessionNumber,
          driveFolderUrl: driveFolderUrl.trim(),
          studentIds: idsToUpload,
        }),
      });
      const data = await res.json();
      if (activeUiClassId && activeUiClassId !== requestClassId) {
        return;
      }

      if (!data.success) {
        setBannerMessage({
          type: "error",
          text: data.error || "Lỗi khi tải sản phẩm lên Google Drive.",
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
          };
        })
      );

      const dResult = data.driveResult;
      const failedCount = dResult?.failedStudentsCount || 0;
      const firstErr = dResult?.results?.find((r: any) => r.status === "FAILED")?.errorMessage;
      const hasNewerCount = (data.records || []).filter((r: SpckRecordRow) => r.hasNewerSharedResources).length;
      setBannerMessage({
        type: failedCount > 0 ? "warning" : "success",
        text:
          failedCount > 0
            ? `Đã tải lên Google Drive cho ${dResult?.uploadedStudentsCount || 0}/${dResult?.totalRequested || 0} học viên (Lỗi: ${failedCount}${firstErr ? ` — ${firstErr}` : ""}).`
            : `Đã tạo thư mục Google Drive và lưu vào kho tài nguyên chung cho ${dResult?.uploadedStudentsCount || 0}/${dResult?.totalRequested || 0} học viên!${
                hasNewerCount > 0
                  ? ` Bấm "Dùng tài nguyên mới nhất" ở học viên cần cập nhật vào bản nháp Buổi ${selectedSessionNumber}.`
                  : ""
              }`,
      });
    } catch (err) {
      if (!activeUiClassId || activeUiClassId === requestClassId) {
        setBannerMessage({
          type: "error",
          text: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      setUploadingDrive(false);
    }
  };

  // 8. Auto-deploy Web SPCK folders (.html/.css/.js) to GitHub Pages & attach Live Demo Link
  const handleDeployWebToGithubPages = async (targetStudentIds?: string[]) => {
    if (!selectedClassId) {
      setBannerMessage({
        type: "warning",
        text: "Vui lòng chọn Lớp học trước khi đẩy sản phẩm Web lên GitHub Pages.",
      });
      return;
    }

    const idsToDeploy =
      targetStudentIds && targetStudentIds.length > 0
        ? targetStudentIds
        : rows
            .filter((r) => r.assignedStudentId && r.folderPath)
            .map((r) => r.assignedStudentId);

    if (idsToDeploy.length === 0) {
      setBannerMessage({
        type: "warning",
        text: "Chưa có học viên nào có thư mục sản phẩm trên máy tính để đẩy lên GitHub Pages.",
      });
      return;
    }

    const requestClassId = selectedClassId;
    setDeployingWeb(true);
    setBannerMessage({
      type: "warning",
      text: `Đang đẩy thư mục Web của ${idsToDeploy.length} học viên lên GitHub Pages (Banhtalon/WEB_PRODUCT_SHOW) và tự động gắn Link Web Live...`,
    });

    try {
      for (const row of rows) {
        if (idsToDeploy.includes(row.assignedStudentId)) {
          const saved = await persistRowDraft(row);
          if (activeUiClassId && activeUiClassId !== requestClassId) {
            return;
          }
          if (!saved) {
            setBannerMessage({
              type: "error",
              text: `Lưu bản nháp cho học viên '${row.folderName || row.assignedStudentId}' thất bại. Đã dừng triển khai GitHub Pages để tránh dùng dữ liệu cũ.`,
            });
            return;
          }
        }
      }

      const res = await fetch("/api/spck/deploy-web", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: requestClassId,
          sessionNumber: selectedSessionNumber,
          repoUrl: webRepoUrl.trim(),
          studentIds: idsToDeploy,
        }),
      });
      const data = await res.json();
      if (activeUiClassId && activeUiClassId !== requestClassId) {
        return;
      }

      if (!data.success) {
        setBannerMessage({
          type: "error",
          text: data.error || "Lỗi khi đẩy sản phẩm Web lên GitHub Pages.",
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
          };
        })
      );

      const dRes = data.deployResult;
      const deployedCount = dRes?.deployedStudentsCount || 0;
      const skippedCount = dRes?.skippedNoHtmlCount || 0;
      const failedCount = dRes?.failedStudentsCount || 0;
      const hasNewerCount = (data.records || []).filter((r: SpckRecordRow) => r.hasNewerSharedResources).length;

      if (deployedCount === 0 && skippedCount > 0) {
        setBannerMessage({
          type: "warning",
          text: `Không tìm thấy file .html nào trong thư mục của ${skippedCount} học viên (tính năng tạo Link Web Live dành cho các lớp Web có file .html).`,
        });
      } else {
        setBannerMessage({
          type: failedCount > 0 ? "warning" : "success",
          text: `Đã đẩy Web lên GitHub Pages và lưu Link Web Chạy Thử vào kho tài nguyên chung cho ${deployedCount}/${dRes?.totalRequested || 0} học viên!${
            hasNewerCount > 0
              ? ` Bấm "Dùng tài nguyên mới nhất" ở học viên cần cập nhật vào bản nháp Buổi ${selectedSessionNumber}.`
              : ""
          }`,
        });
      }
    } catch (err) {
      if (!activeUiClassId || activeUiClassId === requestClassId) {
        setBannerMessage({
          type: "error",
          text: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      setDeployingWeb(false);
    }
  };

  // 9. Create multi-tab Demo Scoring Sheet (1 tab per student, Demo Date = Session 14) & upload to Class Google Drive folder
  const handleCreateDemoScoringSheet = async () => {
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
      text: `Đang tạo "${demoSheetTitle}" (${students.length || rows.length} tab học viên, Ngày Demo Buổi 14: ${demoDateInput || "tự động"}) và tải vào thư mục Google Drive của lớp ${requestClassId}...`,
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
        }),
      });
      const data = await res.json();
      if (activeUiClassId && activeUiClassId !== requestClassId) {
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
      }
      if (dSheet?.demoDate) {
        setDemoDateInput(dSheet.demoDate);
      }
      if (dSheet?.sheetTitle) {
        setDemoSheetTitle(dSheet.sheetTitle);
      }

      setBannerMessage({
        type: "success",
        text: `Đã tạo "${dSheet?.sheetTitle}" gồm ${dSheet?.studentCount || 0} tab học viên (Ngày Demo Buổi 14: ${dSheet?.demoDate}), lưu vào thư mục bài của lớp và tải lên Google Drive để giám khảo chấm!`,
      });
    } catch (err) {
      if (!activeUiClassId || activeUiClassId === requestClassId) {
        setBannerMessage({
          type: "error",
          text: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      setCreatingDemoSheet(false);
    }
  };

  // 10. Auto-capture App Interface Screenshots & AI selects best Thumbnail
  const handleCaptureAppScreenshots = async (targetStudentIds?: string[]) => {
    if (!selectedClassId) {
      setBannerMessage({
        type: "warning",
        text: "Vui lòng chọn Lớp học trước khi chụp hình giao diện App.",
      });
      return;
    }

    const requestClassId = selectedClassId;
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
          sessionNumber: selectedSessionNumber,
          studentIds: targetStudentIds,
          useAiVision: true,
        }),
      });
      const data = await res.json();
      if (activeUiClassId && activeUiClassId !== requestClassId) {
        return;
      }
      if (!data.success) {
        setBannerMessage({
          type: "error",
          text: data.error || "Không thể chụp hình giao diện App.",
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
          return {
            ...row,
            thumbnailPath: rec.thumbnailPath || row.thumbnailPath,
            screenshots,
            status: rec.status || "WAITING_APPROVAL",
            contentHash: rec.contentHash || "",
            draftVersion: rec.draftVersion ?? row.draftVersion,
            hasNewerSharedResources: Boolean(rec.hasNewerSharedResources),
            thumbnailInspection: rec.thumbnailInspection || row.thumbnailInspection,
            sessionResults:
              parseSessionResultsMap(rec.sessionResultsJson) || row.sessionResults,
            sessionHistory: rec.sessionHistory || row.sessionHistory,
          };
        })
      );

      const bRes = data.batchResult;
      const hasNewerCount = (data.records || []).filter((r: SpckRecordRow) => r.hasNewerSharedResources).length;
      setBannerMessage({
        type: "success",
        text: `Đã chụp tổng cộng ${bRes?.totalScreenshotsCaptured || 0} màn hình giao diện App cho ${bRes?.totalProcessed || 0} học viên và lưu vào kho tài nguyên chung!${
          hasNewerCount > 0
            ? ` Bấm "Dùng tài nguyên mới nhất" ở học viên cần áp dụng ảnh mới vào bản nháp Buổi ${selectedSessionNumber}.`
            : ""
        }`,
      });
    } catch (err) {
      if (!activeUiClassId || activeUiClassId === requestClassId) {
        setBannerMessage({
          type: "error",
          text: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      setCapturingScreenshots(false);
    }
  };

  // 10b. Robotics: import class YouTube playlist / video links → match students → 2 presentation frames
  const handleImportYoutubeProducts = async () => {
    if (!selectedClassId) {
      setBannerMessage({
        type: "warning",
        text: "Vui lòng chọn Lớp học trước khi nhập link YouTube.",
      });
      return;
    }
    if (!youtubeImportInput.trim()) {
      setBannerMessage({
        type: "warning",
        text: "Vui lòng dán link Playlist YouTube của lớp (hoặc danh sách 'Tên học viên - link video').",
      });
      return;
    }

    const requestClassId = selectedClassId;
    const requestSessionNum = selectedSessionNumber;
    setImportingYoutube(true);
    setYoutubeImportReport(null);
    setBannerMessage(null);
    try {
      const res = await fetch("/api/spck/import-youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: requestClassId,
          sessionNumber: requestSessionNum,
          input: youtubeImportInput,
        }),
      });
      const data = await res.json();
      if (activeUiClassId && activeUiClassId !== requestClassId) {
        return;
      }
      if (data.importResult) {
        setYoutubeImportReport(data.importResult);
      }
      if (!data.success) {
        setBannerMessage({
          type: "error",
          text: data.error || "Không thể nhập link YouTube cho lớp này.",
        });
        return;
      }

      // V272-F03: merge server results into the LATEST row state (functional update), so anything the
      // teacher typed while the import was running is kept. Only resource fields come from the server.
      const records: SpckRecordRow[] = (data.records || []).filter(
        (r: SpckRecordRow) => !r.classId || r.classId === requestClassId
      );
      const studentById = new Map(students.map((s) => [s.studentId, s]));
      const appliedIds = new Set<string>(
        (data.importResult?.results || [])
          .filter((r: any) => r.applied)
          .map((r: any) => String(r.studentId))
      );
      for (const rec of records) {
        const recSeq = typeof (rec as any).draftSeq === "number" ? (rec as any).draftSeq : 0;
        if (recSeq > clientDraftSequence) clientDraftSequence = recSeq;
      }
      setRows((prev) => {
        const prevByStudent = new Map(
          prev.filter((r) => r.assignedStudentId).map((r) => [r.assignedStudentId, r])
        );
        const recordIds = new Set(records.map((r) => r.studentId));
        const merged: ScannedFolderUIItem[] = records.map((rec) => {
          const fresh = buildRowFromDbRecord(rec, studentById.get(rec.studentId), requestSessionNum);
          const current = prevByStudent.get(rec.studentId);
          if (!current) return fresh;
          if (!appliedIds.has(rec.studentId)) return current;
          // V272-R2-01: never apply an out-of-order import response whose draftVersion is older
          // than the row already on screen; keep the newer version and flag resource sync if needed.
          const currentVersion = typeof current.draftVersion === "number" ? current.draftVersion : 0;
          const freshVersion = typeof fresh.draftVersion === "number" ? fresh.draftVersion : 0;
          if (currentVersion > 0 && freshVersion < currentVersion) {
            const resourcesDiffer =
              current.thumbnailPath !== fresh.thumbnailPath ||
              current.youtubeUrlsText !== fresh.youtubeUrlsText ||
              JSON.stringify(current.screenshots) !== JSON.stringify(fresh.screenshots);
            return {
              ...current,
              folderPath: current.folderPath || fresh.folderPath,
              isConfirmedByTeacher: current.isConfirmedByTeacher || fresh.isConfirmedByTeacher,
              draftVersion: currentVersion,
              hasNewerSharedResources: Boolean(current.hasNewerSharedResources || resourcesDiffer),
            };
          }
          return {
            ...current,
            folderPath: current.folderPath || fresh.folderPath,
            isConfirmedByTeacher: current.isConfirmedByTeacher || fresh.isConfirmedByTeacher,
            thumbnailPath: fresh.thumbnailPath,
            screenshots: fresh.screenshots,
            youtubeUrlsText: fresh.youtubeUrlsText,
            draftVersion: Math.max(currentVersion, freshVersion),
            hasNewerSharedResources: fresh.hasNewerSharedResources,
            thumbnailInspection: fresh.thumbnailInspection,
            sessionHistory: fresh.sessionHistory,
          };
        });
        // Keep rows that are not part of the class records (e.g. unassigned scanned folders)
        const untouched = prev.filter(
          (r) => !r.assignedStudentId || !recordIds.has(r.assignedStudentId)
        );
        return [...merged, ...untouched];
      });

      const ir = data.importResult;
      const resultsList: any[] = ir?.results || [];
      const notApplied = resultsList.filter((r) => !r.applied);
      const appliedList = resultsList.filter((r) => r.applied);
      const fullOk = appliedList.filter(
        (r) => (r.frames || []).length >= 2 && r.syncedToSession !== false
      );
      const missingFrames = appliedList.filter((r) => (r.frames || []).length < 2);
      const notSynced = appliedList.filter((r) => r.syncedToSession === false);
      const withoutVideo = ir?.studentsWithoutVideo || [];
      // V272-F08: honest summary — count real frames and real session sync
      const parts = [
        `Đã gắn link YouTube + đủ 2 ảnh thuyết trình cho ${fullOk.length}/${ir?.totalVideos || 0} video (Buổi ${requestSessionNum}).`,
      ];
      if (missingFrames.length > 0) {
        parts.push(
          `${missingFrames.length} bạn thiếu ảnh thuyết trình: ${missingFrames
            .map((r) => `${r.fullName} (${(r.frames || []).length}/2 ảnh)`)
            .join(", ")}.`
        );
      }
      if (notSynced.length > 0) {
        parts.push(
          `${notSynced.length} bạn đã duyệt/nộp Buổi ${requestSessionNum} nên chỉ lưu vào kho chung: ${notSynced
            .map((r) => r.fullName)
            .join(", ")}.`
        );
      }
      if (notApplied.length > 0) {
        parts.push(`${notApplied.length} video chưa gắn được — xem bảng chi tiết bên dưới.`);
      }
      if (withoutVideo.length > 0) {
        parts.push(
          `${withoutVideo.length} học viên chưa có video: ${withoutVideo
            .map((s: any) => s.fullName)
            .join(", ")}.`
        );
      }
      const allGood =
        notApplied.length === 0 &&
        withoutVideo.length === 0 &&
        missingFrames.length === 0 &&
        notSynced.length === 0;
      setBannerMessage({
        type: allGood ? "success" : fullOk.length > 0 || appliedList.length > 0 ? "warning" : "error",
        text: parts.join(" "),
      });
    } catch (err) {
      if (!activeUiClassId || activeUiClassId === requestClassId) {
        setBannerMessage({
          type: "error",
          text: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      setImportingYoutube(false);
    }
  };

  // 11. Owner uploads custom Thumbnail or Gallery images
  const handleOwnerUploadImage = async (
    studentId: string,
    role: "thumbnail" | "gallery",
    fileList: FileList | null
  ) => {
    if (!selectedClassId || !studentId || !fileList || fileList.length === 0) {
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
          return {
            ...row,
            thumbnailPath: rec.thumbnailPath || row.thumbnailPath,
            screenshots,
            status: rec.status || "WAITING_APPROVAL",
            contentHash: rec.contentHash || "",
            draftVersion: rec.draftVersion ?? row.draftVersion,
            hasNewerSharedResources: Boolean(rec.hasNewerSharedResources),
            thumbnailInspection: rec.thumbnailInspection || row.thumbnailInspection,
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

  // 12. Start / Stop / Poll Student SPCK Upload Portal (Direction 1)
  const applyPortalStatusState = useCallback(
    (pStatus: any) => {
      if (!pStatus) return;
      setStudentPortalRunning(Boolean(pStatus.isRunning));
      setStudentPortalShareUrl(pStatus.primaryShareUrl || "");
      setStudentPortalLanUrl(pStatus.lanUrl || "");
      setStudentPortalLocalUrl(pStatus.localUrl || "");
      setStudentPortalPublicUrl(pStatus.publicTunnelUrl || "");
      setStudentPortalTunnelStatus(pStatus.tunnelStatus || "STOPPED");
      setStudentPortalTunnelProvider(pStatus.tunnelProvider || "");
      if (typeof pStatus.autoUploadDrive === "boolean") {
        setStudentPortalAutoDrive(pStatus.autoUploadDrive);
      }
      if (Array.isArray(pStatus.submissions)) {
        setStudentPortalSubmissions(pStatus.submissions);
      }
      if (pStatus.rootFolderPath && !folderPathInput) {
        setFolderPathInput(pStatus.rootFolderPath);
      }
    },
    [folderPathInput]
  );

  const handleStartStudentPortal = async () => {
    if (!selectedClassId) {
      setBannerMessage({
        type: "warning",
        text: "Vui lòng chọn Lớp học trước khi mở Cổng Cho Học Sinh Nộp Bài.",
      });
      return;
    }

    setTogglingStudentPortal(true);
    setBannerMessage({
      type: "warning",
      text: `Đang mở Cổng Thu Bài Trực Tuyến cho lớp ${selectedClassId} và khởi tạo đường dẫn gửi cho học sinh...`,
    });

    try {
      const res = await fetch("/api/spck/student-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          classId: selectedClassId,
          folderPath: folderPathInput.trim(),
          driveFolderUrl: driveFolderUrl.trim(),
          autoUploadDrive: studentPortalAutoDrive,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setBannerMessage({
          type: "error",
          text: data.error || "Không thể mở Cổng Cho Học Sinh Nộp Bài.",
        });
        return;
      }

      const pStatus = data.portalStatus;
      applyPortalStatusState(pStatus);
      if (pStatus?.rootFolderPath) {
        setFolderPathInput(pStatus.rootFolderPath);
      }
      if (Array.isArray(data.records) && data.records.length > 0) {
        hydrateRowsFromDb(data.records, students);
      }

      setBannerMessage({
        type: "success",
        text: `Đã mở Cổng Cho Học Sinh Nộp Bài lớp ${selectedClassId}! Hãy bấm "Copy Link Nộp Bài" để gửi cho học sinh. Khi học sinh nộp bài, sản phẩm sẽ tự lưu vào máy Thầy và tự động tải lên Google Drive!`,
      });
    } catch (err) {
      setBannerMessage({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTogglingStudentPortal(false);
    }
  };

  const handleStopStudentPortal = async () => {
    setTogglingStudentPortal(true);
    try {
      const res = await fetch("/api/spck/student-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "stop",
          classId: selectedClassId,
        }),
      });
      const data = await res.json();
      if (data.portalStatus) {
        applyPortalStatusState(data.portalStatus);
      } else {
        setStudentPortalRunning(false);
      }
      setShowPortalQr(false);
      setBannerMessage({
        type: "warning",
        text: "Đã đóng Cổng Cho Học Sinh Nộp Bài.",
      });
    } catch (err) {
      setBannerMessage({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTogglingStudentPortal(false);
    }
  };

  const handleTogglePortalAutoDrive = async (enabled: boolean) => {
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
      if (data.portalStatus) {
        applyPortalStatusState(data.portalStatus);
      }
    } catch {}
  };

  // 13. Session 14 Course Final Evaluation & Demo Score Handlers (v2.9.0)
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

      let snapshotsBeforeLoad = new Map<string, any>();
      setSession14Evals((prev: Session14EvalItemUI[]) => {
        if (Array.isArray(prev)) {
          for (const item of prev) {
            if (item?.studentId) {
              snapshotsBeforeLoad.set(item.studentId, JSON.parse(JSON.stringify(item)));
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

        const validRecords = data.records.filter(
          (r: any) => !r.classId || String(r.classId).trim().toUpperCase() === reqClass
        );

        const editableKeys = [
          "learnedFromMindx",
          "suggestionsFromMindx",
          "futureDirection",
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
                if (JSON.stringify((prevItem as any)[k]) !== JSON.stringify(snapBefore[k])) {
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
    [selectedClassId]
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
    if (!reqClassId || !sid) return { success: false, error: "Missing classId or studentId" };

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
      let current: Session14EvalItemUI[] = Array.isArray(session14Evals) ? session14Evals : [];
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
          const errMsg = data?.error || `Lỗi khi lưu nháp đánh giá Buổi 14 (HTTP ${res.status}).`;
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
          runtime.lastServerSnapshots.set(saveKey, JSON.parse(JSON.stringify(srvStudentRec)));
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
                (p) => p?.classId && String(p.classId).trim().toUpperCase() !== reqClassId
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
              if (srv.classId && String(srv.classId).trim().toUpperCase() !== reqClassId) {
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
                  const beforeValStr = JSON.stringify((snapshotBeforeSend as any)[k]);
                  if (!wasInPatch && currentValStr !== beforeValStr) {
                    merged[k] = (prevItem as any)[k];
                    hasUnsavedLocalEdit = true;
                  } else if (wasInPatch) {
                    const patchValStr = JSON.stringify((patch as any)[k]);
                    if (currentValStr !== patchValStr && currentValStr !== beforeValStr) {
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

  const handleImportDemoScores = async () => {
    if (!selectedClassId) return;
    const reqClassId = String(selectedClassId).trim().toUpperCase();
    const g = globalThis as any;
    const editableKeys = [
      "learnedFromMindx",
      "suggestionsFromMindx",
      "futureDirection",
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
            snapshotsBefore.set(item.studentId, JSON.parse(JSON.stringify(item)));
          }
        }
      }
      return prev;
    });

    setImportingDemoScores(true);
    setBannerMessage(null);
    try {
      const source = (demoScoreSourceInput || generatedDemoSheetUrl || "").trim();
      const res = await fetch("/api/spck/session14-eval/import-demo-scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: reqClassId,
          sourcePathOrUrl: source,
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
        setBannerMessage({
          type: "error",
          text: data.error || "Không thể đọc điểm Demo từ file chấm điểm.",
        });
        return;
      }
      if (Array.isArray(data.records)) {
        const validRecords = data.records.filter(
          (r: any) => !r.classId || String(r.classId).trim().toUpperCase() === reqClassId
        );
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
                if (JSON.stringify((prevItem as any)[k]) !== JSON.stringify(snapBefore[k])) {
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
      const matched = data.importResult?.matchedCount || 0;
      setBannerMessage({
        type: "success",
        text: `Đã đọc thành công Điểm Demo & gợi ý Điểm Năng lực [ĐNL] cho ${matched} học viên lớp ${reqClassId}!`,
      });
    } catch (err) {
      setBannerMessage({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setImportingDemoScores(false);
    }
  };

  const handleGenerateSession14EvalAi = async (targetStudentIds?: string[]) => {
    if (!selectedClassId) return;
    const reqClassId = String(selectedClassId).trim().toUpperCase();
    const g = globalThis as any;
    const editableKeys = [
      "learnedFromMindx",
      "suggestionsFromMindx",
      "futureDirection",
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
            snapshotsBefore.set(item.studentId, JSON.parse(JSON.stringify(item)));
          }
        }
      }
      return prev;
    });

    const listToGen =
      targetStudentIds && targetStudentIds.length > 0
        ? liveStartList.filter((e) => targetStudentIds.includes(e.studentId))
        : liveStartList;
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
        setBannerMessage({
          type: "error",
          text: data.error || "Lỗi khi AI soạn Thư tổng kết Buổi 14.",
        });
        return;
      }
      if (Array.isArray(data.records)) {
        const validRecords = data.records.filter(
          (r: any) => !r.classId || String(r.classId).trim().toUpperCase() === reqClassId
        );
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
                if (JSON.stringify((prevItem as any)[k]) !== JSON.stringify(snapBefore[k])) {
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
      const okCount = (data.results || []).filter(
        (r: any) => r.status === "SUCCESS"
      ).length;
      setBannerMessage({
        type: okCount > 0 ? "success" : "warning",
        text: `AI đã soạn xong Thư tổng kết 3 phần (Learned / Suggestions / Future Direction) cho ${okCount}/${listToGen.length} học viên!`,
      });
    } catch (err) {
      setBannerMessage({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setGeneratingS14EvalAi(false);
    }
  };

  const handleApproveAndUploadSession14Eval = async (targetStudentIds?: string[]) => {
    if (!selectedClassId) return;
    const reqClassId = String(selectedClassId).trim().toUpperCase();

    const readLiveList = (): Session14EvalItemUI[] => {
      let current: Session14EvalItemUI[] = Array.isArray(session14Evals) ? session14Evals : [];
      setSession14Evals((prev: Session14EvalItemUI[]) => {
        if (Array.isArray(prev)) current = prev;
        return prev;
      });
      return current;
    };

    const currentList = readLiveList();
    const ids =
      targetStudentIds && targetStudentIds.length > 0
        ? targetStudentIds
        : currentList
            .filter(
              (ev) =>
                ev.learnedFromMindx.trim() &&
                ev.suggestionsFromMindx.trim() &&
                ev.futureDirection.trim()
            )
            .map((ev) => ev.studentId);

    if (ids.length === 0) {
      setBannerMessage({
        type: "warning",
        text: "Chưa có học viên nào đủ nội dung 3 phần Thư từ MindX để duyệt và đẩy lên LMS.",
      });
      return;
    }

    const g = globalThis as any;
    const runtime = g.__s14EvalRuntime as
      | {
          inFlightSaves: Map<string, Promise<any>>;
          lastServerSnapshots: Map<string, any>;
        }
      | undefined;

    setUploadingS14EvalLms(true);
    setBannerMessage(null);
    try {
      // 1. Wait for any in-flight blur save for the target students (F07)
      if (runtime) {
        for (const sid of ids) {
          const saveKey = `${reqClassId}:${sid}`;
          const pending = runtime.inFlightSaves.get(saveKey);
          if (pending) {
            const raceRes = await Promise.race([
              pending,
              new Promise<{ timedOut: true }>((resolve) =>
                setTimeout(() => resolve({ timedOut: true }), 150)
              ),
            ]);
            if (raceRes && (raceRes as any).timedOut) {
              setBannerMessage({
                type: "error",
                text: `Thao tác lưu nháp của học viên ${sid} chưa hoàn tất. Đã dừng duyệt và đẩy LMS để tránh gửi bản cũ.`,
              });
              return;
            }
            if (!raceRes || !raceRes.success) {
              return;
            }
          }
        }
      }

      // 2. Flush visible state if any target student has unsaved changes compared to last server snapshot
      const latestBeforeApprove = readLiveList();
      const expectedVersions: Record<string, number> = {};

      for (const sid of ids) {
        const visibleItem = latestBeforeApprove.find((r) => r.studentId === sid);
        if (!visibleItem) continue;
        const saveKey = `${reqClassId}:${sid}`;
        const lastSrv = runtime?.lastServerSnapshots.get(saveKey);
        const needsFlush =
          !lastSrv ||
          lastSrv.learnedFromMindx !== visibleItem.learnedFromMindx ||
          lastSrv.suggestionsFromMindx !== visibleItem.suggestionsFromMindx ||
          lastSrv.futureDirection !== visibleItem.futureDirection ||
          (visibleItem.teacherNote !== undefined &&
            lastSrv.teacherNote !== visibleItem.teacherNote);

        if (needsFlush) {
          const flushPromise = handleSaveSession14EvalDraft(sid, {
            learnedFromMindx: visibleItem.learnedFromMindx,
            suggestionsFromMindx: visibleItem.suggestionsFromMindx,
            futureDirection: visibleItem.futureDirection,
            teacherNote: visibleItem.teacherNote,
            demoScores: visibleItem.demoScores,
            competencyScores: visibleItem.competencyScores,
            quickTags: visibleItem.quickTags,
          });
          const flushRes = await Promise.race([
            flushPromise,
            new Promise<{ timedOut: true }>((resolve) =>
              setTimeout(() => resolve({ timedOut: true }), 150)
            ),
          ]);
          if (!flushRes || (flushRes as any).timedOut || !(flushRes as any).success) {
            setBannerMessage({
              type: "error",
              text: `Không thể lưu bản đang hiển thị của học viên ${sid} trước khi duyệt.`,
            });
            return;
          }
          if (typeof (flushRes as any).record?.draftVersion === "number") {
            expectedVersions[sid] = (flushRes as any).record.draftVersion;
          }
        } else if (typeof lastSrv?.draftVersion === "number") {
          expectedVersions[sid] = lastSrv.draftVersion;
        } else if (typeof visibleItem.draftVersion === "number") {
          expectedVersions[sid] = visibleItem.draftVersion;
        }
      }

      if (String(selectedClassId || "").trim().toUpperCase() !== reqClassId) return;
      if (
        g.__s14LatestRenderedClassId &&
        String(g.__s14LatestRenderedClassId).trim().toUpperCase() !== reqClassId
      ) {
        return;
      }

      const snapshotsBeforeUpload = new Map<string, any>();
      for (const item of readLiveList()) {
        if (item?.studentId) {
          snapshotsBeforeUpload.set(item.studentId, JSON.parse(JSON.stringify(item)));
        }
      }

      const appRes = await fetch("/api/spck/session14-eval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          classId: reqClassId,
          studentIds: ids,
          expectedVersions,
          ...(ids.length === 1 && expectedVersions[ids[0]] !== undefined
            ? { expectedVersion: expectedVersions[ids[0]] }
            : {}),
        }),
      });
      const appData = await appRes.json().catch(() => ({}));
      const approvedIds: string[] = Array.isArray(appData.approvedIds)
        ? appData.approvedIds
        : [];
      if (!appRes.ok || !appData.success || approvedIds.length !== ids.length) {
        setBannerMessage({
          type: "error",
          text:
            appData.errors?.[0]?.error ||
            appData.error ||
            "Không thể duyệt đánh giá Buổi 14 trước khi đẩy lên LMS.",
        });
        return;
      }

      const upRes = await fetch("/api/spck/session14-eval/upload-lms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: reqClassId,
          studentIds: approvedIds,
        }),
      });
      const upData = await upRes.json();
      if (String(selectedClassId || "").trim().toUpperCase() !== reqClassId) return;
      if (
        g.__s14LatestRenderedClassId &&
        String(g.__s14LatestRenderedClassId).trim().toUpperCase() !== reqClassId
      ) {
        return;
      }
      if (Array.isArray(upData.records)) {
        const validRecords = upData.records.filter(
          (r: any) => !r.classId || String(r.classId).trim().toUpperCase() === reqClassId
        );
        const editableKeys = [
          "learnedFromMindx",
          "suggestionsFromMindx",
          "futureDirection",
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
                if (JSON.stringify((prevItem as any)[k]) !== JSON.stringify(snapBefore[k])) {
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
      const verCount = upData.uploadResult?.verifiedCount || 0;
      const failCount = upData.uploadResult?.failedCount || 0;
      setBannerMessage({
        type: failCount === 0 && verCount > 0 ? "success" : "warning",
        text: `Đã đẩy & xác minh (Read-after-Write) đánh giá tổng kết + Điểm Demo Buổi 14 cho ${verCount}/${approvedIds.length} học viên lên LMS!`,
      });
    } catch (err) {
      setBannerMessage({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setUploadingS14EvalLms(false);
    }
  };

  useEffect(() => {
    if (!selectedClassId) return;
    let cancelled = false;

    const checkPortalOnce = async () => {
      try {
        const res = await fetch(
          `/api/spck/student-portal?classId=${encodeURIComponent(selectedClassId)}`
        );
        const data = await res.json();
        if (cancelled || !data.success || !data.portalStatus) return;
        applyPortalStatusState(data.portalStatus);

        if (
          data.portalStatus.isRunning &&
          Array.isArray(data.records) &&
          data.records.length > 0
        ) {
          const dbRecords: SpckRecordRow[] = data.records;
          setRows((prev) => {
            if (prev.length === 0) {
              const studentMap = new Map(students.map((s) => [s.studentId, s]));
              return dbRecords.map((rec) => {
                const stu = studentMap.get(rec.studentId);
                const screenshots = parseJsonSafe<string[]>(rec.screenshotsJson, []);
                const attachments = parseJsonSafe<string[]>(rec.attachmentsJson, []);
                const youtubeUrls = parseJsonSafe<string[]>(rec.youtubeUrlsJson, []);
                const relatedLinks = parseJsonSafe<RelatedLinkItem[]>(
                  rec.relatedLinksJson,
                  []
                );
                const folderParts = (rec.localFolderPath || "")
                  .split(/[\\/]/)
                  .filter(Boolean);
                const folderName =
                  folderParts[folderParts.length - 1] ||
                  stu?.fullName ||
                  rec.studentId;
                return {
                  folderName,
                  folderPath: rec.localFolderPath || "",
                  assignedStudentId: rec.studentId,
                  matchScore: typeof rec.matchScore === "number" ? rec.matchScore : 1.0,
                  requiresManualConfirmation: Number(rec.isConfirmedByTeacher) !== 1,
                  isConfirmedByTeacher: Number(rec.isConfirmedByTeacher) === 1,
                  warningReasons: [],
                  projectTitle:
                    rec.projectTitle || `SPCK ${stu?.fullName || rec.studentId}`,
                  thumbnailPath: rec.thumbnailPath || "",
                  screenshots,
                  attachments,
                  youtubeUrlsText: youtubeUrls.join("\n"),
                  relatedLinksText: serializeRelatedLinksToText(relatedLinks),
                  quickTags: [],
                  teacherNote: "",
                  includePresentation: false,
                  teacherComment: rec.teacherComment || "",
                  contentHash: rec.contentHash || "",
                  status: rec.status || "WAITING_APPROVAL",
                  verifiedAt: rec.verifiedAt,
                  errorMessage: rec.errorMessage,
                  sessionResults: parseSessionResultsMap(rec.sessionResultsJson),
                };
              });
            }

            const existingIds = new Set(prev.map((r) => r.assignedStudentId));
            const studentMap = new Map(students.map((s) => [s.studentId, s]));
            const updatedRows = prev.map((row) => {
              const rec = dbRecords.find((r) => r.studentId === row.assignedStudentId);
              if (!rec) return row;
              const relatedLinks = parseJsonSafe<RelatedLinkItem[]>(
                rec.relatedLinksJson,
                []
              );
              const screenshots = parseJsonSafe<string[]>(rec.screenshotsJson, []);
              const attachments = parseJsonSafe<string[]>(rec.attachmentsJson, []);
              const youtubeUrls = parseJsonSafe<string[]>(rec.youtubeUrlsJson, []);
              return {
                ...row,
                folderPath: rec.localFolderPath || row.folderPath,
                thumbnailPath: rec.thumbnailPath || row.thumbnailPath,
                screenshots: screenshots.length > 0 ? screenshots : row.screenshots,
                attachments: attachments.length > 0 ? attachments : row.attachments,
                youtubeUrlsText:
                  youtubeUrls.length > 0 ? youtubeUrls.join("\n") : row.youtubeUrlsText,
                relatedLinksText:
                  relatedLinks.length > 0
                    ? serializeRelatedLinksToText(relatedLinks)
                    : row.relatedLinksText,
                sessionResults:
                  parseSessionResultsMap(rec.sessionResultsJson) || row.sessionResults,
              };
            });

            for (const rec of dbRecords) {
              if (!existingIds.has(rec.studentId)) {
                const stu = studentMap.get(rec.studentId);
                const screenshots = parseJsonSafe<string[]>(rec.screenshotsJson, []);
                const attachments = parseJsonSafe<string[]>(rec.attachmentsJson, []);
                const youtubeUrls = parseJsonSafe<string[]>(rec.youtubeUrlsJson, []);
                const relatedLinks = parseJsonSafe<RelatedLinkItem[]>(
                  rec.relatedLinksJson,
                  []
                );
                const folderParts = (rec.localFolderPath || "")
                  .split(/[\\/]/)
                  .filter(Boolean);
                const folderName =
                  folderParts[folderParts.length - 1] ||
                  stu?.fullName ||
                  rec.studentId;
                updatedRows.push({
                  folderName,
                  folderPath: rec.localFolderPath || "",
                  assignedStudentId: rec.studentId,
                  matchScore: 1.0,
                  requiresManualConfirmation: false,
                  isConfirmedByTeacher: true,
                  warningReasons: [],
                  projectTitle:
                    rec.projectTitle || `SPCK ${stu?.fullName || rec.studentId}`,
                  thumbnailPath: rec.thumbnailPath || "",
                  screenshots,
                  attachments,
                  youtubeUrlsText: youtubeUrls.join("\n"),
                  relatedLinksText: serializeRelatedLinksToText(relatedLinks),
                  quickTags: [],
                  teacherNote: "",
                  includePresentation: false,
                  teacherComment: rec.teacherComment || "",
                  contentHash: rec.contentHash || "",
                  status: rec.status || "WAITING_APPROVAL",
                  verifiedAt: rec.verifiedAt,
                  errorMessage: rec.errorMessage,
                  sessionResults: parseSessionResultsMap(rec.sessionResultsJson),
                });
              }
            }
            return updatedRows;
          });
        }
      } catch {}
    };

    checkPortalOnce();
    if (!studentPortalRunning) {
      return () => {
        cancelled = true;
      };
    }

    const interval = setInterval(checkPortalOnce, 3500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedClassId, studentPortalRunning, students, applyPortalStatusState]);

  const confirmedReadyStudentIds = useMemo(
    () =>
      rows
        .filter((r) => getRowReadinessSummary(r, duplicateStudentIds).ready)
        .map((r) => r.assignedStudentId),
    [rows, duplicateStudentIds]
  );

  const assignableStudentIds = useMemo(
    () =>
      Array.from(
        new Set(rows.map((r) => r.assignedStudentId).filter(Boolean))
      ),
    [rows]
  );

  const effectiveSelectedStudentIds = useMemo(() => {
    const validSet = new Set(assignableStudentIds);
    if (selectedStudentIds.includes("__AUTO_SELECT__")) {
      return confirmedReadyStudentIds.length > 0
        ? confirmedReadyStudentIds
        : assignableStudentIds;
    }
    return selectedStudentIds.filter((id) => validSet.has(id));
  }, [selectedStudentIds, assignableStudentIds, confirmedReadyStudentIds]);

  const unsubmittedForActiveSessionStudentIds = useMemo(
    () =>
      rows
        .filter((r) => {
          if (!r.assignedStudentId) return false;
          const slot = getSessionSlotDisplay(r, selectedSessionNumber);
          return !slot.label.startsWith("Đã nộp ✓");
        })
        .map((r) => r.assignedStudentId),
    [rows, selectedSessionNumber]
  );

  const isAnyOperationBusy =
    loadingInit ||
    scanningTeacherClasses ||
    scanning ||
    browsingFolder ||
    generatingAi ||
    uploading ||
    uploadingDrive ||
    deployingWeb ||
    creatingDemoSheet ||
    capturingScreenshots ||
    importingYoutube ||
    togglingStudentPortal;

  const activeBusyDescription = useMemo(() => {
    if (uploading) {
      return (
        activeActionLabel ||
        `Đang nộp SPCK lên LMS — Buổi ${selectedSessionNumber} (${effectiveSelectedStudentIds.length} bài)...`
      );
    }
    if (scanning) return "Đang quét thư mục sản phẩm trên máy và khớp danh sách học viên...";
    if (generatingAi) return "Đang gọi AI soạn nhận xét cuối khóa cho các học viên...";
    if (uploadingDrive) return "Đang tải sản phẩm lên Google Drive và tự động gắn link...";
    if (deployingWeb) return "Đang đẩy sản phẩm Web lên GitHub Pages và gắn link chạy thử...";
    if (creatingDemoSheet) return "Đang tạo Bảng chấm điểm buổi Demo (Buổi 14) trên Google Drive...";
    if (capturingScreenshots) return "Đang chụp giao diện App và chọn ảnh bìa (Thumbnail)...";
    if (importingYoutube)
      return "Đang đọc Playlist YouTube, khớp tên học viên và lấy 2 ảnh thuyết trình cho từng bạn...";
    if (scanningTeacherClasses) return "Đang quét danh sách lớp từ tài khoản giáo viên...";
    return "";
  }, [
    uploading,
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

  const isWebClassOrProduct = useMemo(() => {
    const classText = `${selectedClassId} ${selectedClassMeta?.className || ""}`.toUpperCase();
    const hasWebClassCode = /\b(JSB|JSA|JSI|WEB|HTML)\b/.test(classText);
    const hasHtmlFiles = rows.some(
      (r) =>
        (r.attachments || []).some((f) => /\.html?$/i.test(f)) ||
        /github\.io/i.test(r.relatedLinksText || "")
    );
    return hasWebClassCode || hasHtmlFiles;
  }, [selectedClassId, selectedClassMeta, rows]);

  const isAppOrGameProduct = useMemo(() => {
    const classText = `${selectedClassId} ${selectedClassMeta?.className || ""}`.toUpperCase();
    const hasAppClassCode = /\b(PTA|PTI|CSI|CSA|GMA|GMI|GAME|APP|PYTHON|SCRATCH)\b/.test(
      classText
    );
    const hasAppFiles = rows.some((r) =>
      (r.attachments || []).some((f) =>
        /\.(py|sb3|apk|exe|gmx|yyz|rbxl|html?)$/i.test(f)
      )
    );
    return hasAppClassCode || hasAppFiles || !isWebClassOrProduct;
  }, [selectedClassId, selectedClassMeta, rows, isWebClassOrProduct]);

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

  return (
    <div className="space-y-6">
      {/* Active Processing Lock Banner */}
      {isAnyOperationBusy && activeBusyDescription && (
        <div className="p-3.5 rounded-xl bg-amber-950/70 border border-amber-500/60 text-amber-200 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center space-x-2.5">
            <Loader2 className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
            <span className="font-semibold">{activeBusyDescription}</span>
          </div>
          <span className="text-[11px] text-amber-300/90 shrink-0">
            Các nút thao tác xung đột đang tạm khóa cho đến khi hoàn tất
          </span>
        </div>
      )}

      {/* BƯỚC 1: Chọn lớp -> Chọn buổi 12/13/14 -> Chọn thư mục và kiểm tra học viên */}
      <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 text-xs font-bold">
              Bước 1 / 3
            </span>
            <h2 className="text-sm font-bold text-white">
              Chọn Lớp &rarr; Chọn Buổi Nộp (12 / 13 / 14) &rarr; Chọn Thư Mục &amp; Khớp Học Viên
            </h2>
          </div>
          <button
            type="button"
            onClick={handleScanTeacherClasses}
            disabled={isAnyOperationBusy}
            title="Quét các lớp đang dạy trên tài khoản giáo viên và chỉ lọc các lớp có buổi học >= 12"
            className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${scanningTeacherClasses ? "animate-spin" : ""}`}
            />
            <span>
              {scanningTeacherClasses ? "Đang quét TK GV..." : "Quét lớp TK GV (Buổi ≥ 12)"}
            </span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
          {/* 1A. Chọn Lớp */}
          <div className="md:col-span-4">
            <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
              1A. Chọn Lớp nộp SPCK (Buổi ≥ 12)
            </label>
            <select
              value={selectedClassId}
              onChange={(e) => handleClassChange(e.target.value)}
              disabled={isAnyOperationBusy}
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-60"
            >
              <option value="">-- Chọn lớp đủ điều kiện (Buổi ≥ 12) --</option>
              {classes.map((cls) => (
                <option key={cls.classId} value={cls.classId}>
                  {cls.classId}
                  {cls.status === "Finished"
                    ? ` — Đã xong Buổi 14${
                        cls.session14Date ? ` (${cls.session14Date})` : " (≤ 15 ngày)"
                      }`
                    : cls.currentSessionNumber
                    ? ` — Đang ở Buổi ${cls.currentSessionNumber}`
                    : ` (${cls.className})`}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] text-slate-400">
              Áp dụng cho tất cả các lớp có buổi 12, 13, 14 (bao gồm{" "}
              <span className="font-semibold text-emerald-400">PTB</span> và{" "}
              <span className="font-semibold text-emerald-400">CSB</span>).
            </p>
          </div>

          {/* 1B. Chọn Buổi nộp một lần ở đầu trang */}
          <div className="md:col-span-3">
            <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
              1B. Chọn Buổi Nộp LMS ({getStageMeta(selectedSessionNumber).stageTitle})
            </label>
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-lg bg-slate-950 border border-slate-700">
              {([12, 13, 14] as const).map((sessNum) => {
                const isSelected = selectedSessionNumber === sessNum;
                const stageMeta = getStageMeta(sessNum);
                return (
                  <button
                    key={sessNum}
                    type="button"
                    disabled={isAnyOperationBusy}
                    onClick={() => handleSessionChange(sessNum)}
                    className={`py-1.5 px-2 rounded-md text-xs font-bold transition-all cursor-pointer disabled:opacity-50 ${
                      isSelected
                        ? "bg-emerald-600 text-white shadow"
                        : "text-slate-300 hover:bg-slate-800 hover:text-white"
                    }`}
                  >
                    Buổi {sessNum} ({stageMeta.stageShort})
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">
              Đang chọn nộp cho{" "}
              <strong className="text-emerald-400">
                Buổi {selectedSessionNumber} ({getStageMeta(selectedSessionNumber).stageShort})
              </strong>{" "}
              — chỉ nộp đúng buổi đã chọn, lưu nháp &amp; kết quả riêng từng buổi.
            </p>
          </div>

          {/* 1C. Chọn Thư mục & Quét */}
          <div className="md:col-span-5">
            <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
              1C. Thư mục SPCK trên máy tính (Allowlisted)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={folderPathInput}
                onChange={(e) => setFolderPathInput(e.target.value)}
                disabled={isAnyOperationBusy}
                placeholder="VD: D:\SPCK_MindX\VT-C4K-PTA12"
                className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={handleBrowseFolder}
                disabled={isAnyOperationBusy}
                title="Mở cửa sổ chọn thư mục trên máy tính"
                className="shrink-0 flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 disabled:opacity-50 text-slate-100 font-medium text-xs transition-colors cursor-pointer"
              >
                {browsingFolder ? (
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                ) : (
                  <FolderOpen className="w-4 h-4 text-emerald-400" />
                )}
                <span>Chọn...</span>
              </button>
              <button
                type="button"
                onClick={() => handleScanFolder()}
                disabled={isAnyOperationBusy || !selectedClassId}
                className="shrink-0 flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-xs transition-colors cursor-pointer"
              >
                {scanning ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FolderSearch className="w-4 h-4" />
                )}
                <span>Quét &amp; Khớp HV</span>
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">
              Khi quét lại cùng thư mục, ảnh bìa đã chụp và đường dẫn Drive / Web Live đã có sẽ được giữ nguyên để tái sử dụng.
            </p>
          </div>
        </div>

        {/* 1D. Robotics / sản phẩm chỉ có video YouTube */}
        <div className="rounded-lg border border-rose-500/30 bg-rose-950/20">
          <button
            type="button"
            onClick={() => setShowYoutubeImport((v) => !v)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left cursor-pointer"
          >
            <span className="flex items-center gap-2 text-xs font-semibold text-rose-200">
              <Video className="w-4 h-4 text-rose-400" />
              1D. Lớp Robotics (sản phẩm chỉ có video YouTube): Dán link Playlist của lớp → bot tự gắn link &amp; lấy 2 ảnh thuyết trình cho từng học viên
            </span>
            <span className="text-[11px] text-rose-300 shrink-0">
              {showYoutubeImport ? "Thu gọn ▴" : "Mở ▾"}
            </span>
          </button>
          {showYoutubeImport && (
            <div className="px-3 pb-3 space-y-2">
              <textarea
                value={youtubeImportInput}
                onChange={(e) => setYoutubeImportInput(e.target.value)}
                disabled={isAnyOperationBusy}
                rows={4}
                placeholder={
                  "Dán 1 link Playlist của lớp, ví dụ:\nhttps://m.youtube.com/playlist?list=PL...\nHoặc mỗi dòng 1 học viên: Minh Khang - https://youtu.be/..."
                }
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-rose-500 disabled:opacity-60"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-slate-400">
                  Bot đọc tên học viên trong tiêu đề từng video (bỏ mã lớp như &ldquo;SB28&rdquo;), gắn đúng link vào ô YouTube URL, lấy{" "}
                  <strong className="text-slate-200">2 ảnh thuyết trình</strong> vào ảnh bổ sung. Ảnh đại diện: ảnh Owner tải lên, nếu không có thì{" "}
                  <strong className="text-slate-200">Logo MindX</strong>. Áp dụng cho{" "}
                  <strong className="text-rose-300">Buổi {selectedSessionNumber}</strong>.
                </p>
                <button
                  type="button"
                  onClick={handleImportYoutubeProducts}
                  disabled={isAnyOperationBusy || !selectedClassId || !youtubeImportInput.trim()}
                  className="shrink-0 flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-semibold text-xs transition-colors cursor-pointer"
                >
                  {importingYoutube ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Video className="w-4 h-4" />
                  )}
                  <span>Nhập YouTube &amp; Lấy 2 Ảnh</span>
                </button>
              </div>

              {youtubeImportReport && (
                <div className="rounded-lg border border-slate-700 bg-slate-950/70 p-2 space-y-1.5">
                  {youtubeImportReport.playlists.map((pl, idx) => (
                    <p key={idx} className="text-[11px] text-slate-300">
                      Playlist <strong className="text-white">{pl.playlistTitle || "(không tên)"}</strong>:{" "}
                      {pl.error ? (
                        <span className="text-rose-300">{pl.error}</span>
                      ) : (
                        <span>{pl.videoCount} video</span>
                      )}
                    </p>
                  ))}
                  <div className="max-h-56 overflow-y-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="text-slate-400 text-left">
                          <th className="py-1 pr-2">Tiêu đề video</th>
                          <th className="py-1 pr-2">Học viên</th>
                          <th className="py-1 pr-2">Kết quả</th>
                        </tr>
                      </thead>
                      <tbody>
                        {youtubeImportReport.results.map((r) => (
                          <tr key={r.videoId} className="border-t border-slate-800 align-top">
                            <td className="py-1 pr-2 text-slate-200">
                              <a href={r.url} target="_blank" rel="noreferrer" className="underline hover:text-rose-300">
                                {r.videoTitle || r.videoId}
                              </a>
                            </td>
                            <td className="py-1 pr-2 text-slate-200">{r.fullName || "—"}</td>
                            <td className="py-1 pr-2">
                              {r.applied ? (
                                <span className="text-emerald-300">
                                  ✓ Đã gắn link + {r.frames.length} ảnh
                                  {r.thumbnailIsOwnerPhoto ? " (giữ ảnh đại diện Owner)" : " (ảnh đại diện: Logo MindX)"}
                                  {r.message ? <span className="block text-amber-300">{r.message}</span> : null}
                                </span>
                              ) : (
                                <span className="text-amber-300">{r.message || "Chưa khớp học viên"}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {youtubeImportReport.studentsWithoutVideo.length > 0 && (
                    <p className="text-[11px] text-amber-300">
                      Học viên chưa có video:{" "}
                      {youtubeImportReport.studentsWithoutVideo.map((s) => s.fullName).join(", ")}
                    </p>
                  )}
                  {youtubeImportReport.invalidLines.length > 0 && (
                    <p className="text-[11px] text-slate-400">
                      Dòng không nhận ra link YouTube: {youtubeImportReport.invalidLines.join(" | ")}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Status Alert Banner */}
      {bannerMessage && (
        <div
          className={`p-4 rounded-xl border text-sm flex items-center justify-between ${
            bannerMessage.type === "success"
              ? "bg-emerald-950/50 border-emerald-800 text-emerald-200"
              : bannerMessage.type === "warning"
              ? "bg-amber-950/50 border-amber-800 text-amber-200"
              : "bg-rose-950/50 border-rose-800 text-rose-200"
          }`}
        >
          <span>{bannerMessage.text}</span>
          <button
            type="button"
            onClick={() => setBannerMessage(null)}
            className="text-xs underline ml-4 shrink-0"
          >
            Đóng
          </button>
        </div>
      )}

      {/* BƯỚC 2: Chuẩn bị, xem lại bài & Công cụ tùy chọn thu gọn */}
      <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/50 text-purple-300 text-xs font-bold">
                Bước 2 / 3
              </span>
              <h2 className="text-sm font-bold text-white">
                Chuẩn Bị &amp; Xem Lại Bài ({rows.length} học viên)
              </h2>
              <span className="text-xs text-slate-400">
                • Đủ điều kiện nộp:{" "}
                <strong className="text-emerald-400">{confirmedReadyStudentIds.length}</strong>/{rows.length}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Bảng gọn bên dưới hiển thị tình trạng đủ/thiếu và kết quả riêng từng buổi 12, 13, 14. Bấm{" "}
              <strong className="text-slate-200">&ldquo;Chi tiết&rdquo;</strong> ở từng học viên khi cần sửa tiêu đề, đường dẫn hoặc nhận xét.
            </p>
          </div>

          {/* Primary Preparation Actions & Collapsible Tool Toggles */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleGenerateAiComments()}
              disabled={isAnyOperationBusy || rows.length === 0}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              {generatingAi ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>AI Soạn Nhận Xét Cả Lớp</span>
            </button>

            {isAppOrGameProduct && (
              <button
                type="button"
                onClick={() => handleCaptureAppScreenshots()}
                disabled={isAnyOperationBusy || rows.length === 0}
                title="Tự động mở giao diện App (.ui) hoặc Website (.html) của học viên để chụp hình 16:9 và AI chọn Thumbnail"
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                {capturingScreenshots ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ImageIcon className="w-3.5 h-3.5" />
                )}
                <span>{isWebClassOrProduct ? "Chụp Giao Diện Web" : "Chụp Giao Diện App"}</span>
              </button>
            )}

            {isWebClassOrProduct && (
              <button
                type="button"
                onClick={() => handleDeployWebToGithubPages()}
                disabled={isAnyOperationBusy || !selectedClassId || rows.length === 0}
                title="Đẩy sản phẩm Web (.html) lên GitHub Pages và gắn Link chạy thử"
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                {deployingWeb ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Rocket className="w-3.5 h-3.5" />
                )}
                <span>Chạy Thử Web (GitHub Pages)</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowOptionalTools((v) => !v)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                showOptionalTools || studentPortalRunning
                  ? "bg-sky-950/60 border-sky-500/60 text-sky-200"
                  : "bg-slate-950 border-slate-700 text-slate-300 hover:bg-slate-800"
              }`}
            >
              {showOptionalTools ? "Thu gọn Công cụ Drive & Thu bài ▴" : "Công cụ Drive & Cổng thu bài (Tùy chọn) ▾"}
            </button>

            <button
              type="button"
              onClick={() => setShowDemoPrepPanel((v) => !v)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                showDemoPrepPanel || Boolean(generatedDemoSheetUrl)
                  ? "bg-amber-950/60 border-amber-500/60 text-amber-200"
                  : "bg-slate-950 border-slate-700 text-slate-300 hover:bg-slate-800"
              }`}
            >
              {showDemoPrepPanel ? "Thu gọn Chuẩn bị Demo ▴" : "Chuẩn bị Demo (Bảng chấm điểm) ▾"}
            </button>
          </div>
        </div>

        {/* Collapsible Panel A: Optional Drive, Student Upload Portal & Web/App Tools */}
        {(showOptionalTools || studentPortalRunning) && (
          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-sky-300 uppercase">
                Công cụ tùy chọn: Cổng thu bài học sinh, Google Drive &amp; Cấu hình chạy thử
              </span>
              {!isWebClassOrProduct && (
                <button
                  type="button"
                  onClick={() => handleDeployWebToGithubPages()}
                  disabled={isAnyOperationBusy || !selectedClassId || rows.length === 0}
                  className="inline-flex items-center space-x-1 px-2.5 py-1 rounded bg-indigo-600/80 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium cursor-pointer"
                >
                  <Rocket className="w-3.5 h-3.5" />
                  <span>Đẩy Web Live (Nếu có file .html)</span>
                </button>
              )}
            </div>

            {/* Student Direct SPCK Upload Portal */}
            <div className="p-3.5 rounded-xl bg-gradient-to-r from-rose-950/35 via-slate-950 to-emerald-950/35 border border-rose-500/35 space-y-3">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-bold uppercase tracking-wider">
                      Cổng Thu Bài Học Sinh
                    </span>
                    <span className="text-xs font-bold text-white">
                      Học Sinh Tự Nộp Sản Phẩm &rarr; Tự Lưu Máy Thầy &amp; Tự Động Lên Google Drive
                    </span>
                    {studentPortalRunning && (
                      <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 text-[11px] font-semibold">
                        ● Đang mở cho lớp {selectedClassId} (Đã nộp:{" "}
                        {studentPortalSubmissions.length}/{students.length || rows.length} HV)
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-300">
                    Bấm mở cổng để lấy <strong>Link nộp bài (hoặc Mã QR)</strong> gửi cho học sinh.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                  <label className="inline-flex items-center space-x-1.5 text-xs text-slate-200 cursor-pointer bg-slate-900/90 px-2.5 py-1.5 rounded-lg border border-slate-700">
                    <input
                      type="checkbox"
                      checked={studentPortalAutoDrive}
                      onChange={(e) => handleTogglePortalAutoDrive(e.target.checked)}
                      className="rounded border-slate-600"
                    />
                    <span>Tự động Up lên Drive khi HS nộp</span>
                  </label>

                  {!studentPortalRunning ? (
                    <button
                      type="button"
                      onClick={handleStartStudentPortal}
                      disabled={isAnyOperationBusy || !selectedClassId}
                      className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold text-xs transition-colors cursor-pointer"
                    >
                      {togglingStudentPortal ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Link2 className="w-3.5 h-3.5" />
                      )}
                      <span>Mở Link Cho Học Sinh Nộp Bài</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleStopStudentPortal}
                      disabled={togglingStudentPortal}
                      className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/70 border border-rose-500/50 text-rose-200 font-semibold text-xs transition-colors cursor-pointer"
                    >
                      <span>Đóng Cổng Thu Bài</span>
                    </button>
                  )}
                </div>
              </div>

              {studentPortalRunning && (
                <div className="pt-2.5 border-t border-slate-800/80 space-y-2.5">
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center">
                    <div className="md:col-span-7">
                      <div className="text-[11px] text-slate-400 mb-1 flex items-center justify-between">
                        <span>
                          🌐 <strong>Link gửi học sinh ({studentPortalTunnelProvider}):</strong>
                        </span>
                        {studentPortalTunnelStatus === "STARTING" && (
                          <span className="text-amber-300 animate-pulse">
                            ⏳ Đang tạo Link Internet toàn cầu (~3-5 giây)...
                          </span>
                        )}
                      </div>
                      <input
                        type="text"
                        readOnly
                        value={
                          studentPortalPublicUrl ||
                          studentPortalShareUrl ||
                          studentPortalLanUrl ||
                          studentPortalLocalUrl
                        }
                        className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-emerald-600/60 text-emerald-300 text-xs font-mono"
                      />
                    </div>

                    <div className="md:col-span-5 flex flex-wrap items-center gap-2 pt-4">
                      <button
                        type="button"
                        onClick={() => {
                          const urlToCopy =
                            studentPortalPublicUrl ||
                            studentPortalShareUrl ||
                            studentPortalLanUrl ||
                            studentPortalLocalUrl;
                          navigator.clipboard?.writeText(urlToCopy);
                          setBannerMessage({
                            type: "success",
                            text: `Đã copy Link nộp bài cho học sinh: ${urlToCopy}`,
                          });
                        }}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
                      >
                        📋 Copy Link Gửi Học Sinh
                      </button>

                      <a
                        href={studentPortalLocalUrl || studentPortalShareUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
                      >
                        Mở Xem Thử Trang HS
                      </a>

                      <button
                        type="button"
                        onClick={() => setShowPortalQr((v) => !v)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 text-xs font-semibold cursor-pointer"
                      >
                        {showPortalQr ? "Ẩn QR" : "📱 Hiện Mã QR"}
                      </button>
                    </div>
                  </div>

                  {studentPortalLanUrl && studentPortalPublicUrl && (
                    <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-3">
                      <span>
                        📶 Link dự phòng cùng Wi-Fi lớp học:{" "}
                        <code className="text-sky-300">{studentPortalLanUrl}</code>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(studentPortalLanUrl);
                          setBannerMessage({
                            type: "success",
                            text: `Đã copy Link Wi-Fi nội bộ lớp học: ${studentPortalLanUrl}`,
                          });
                        }}
                        className="underline text-sky-400 hover:text-sky-300 cursor-pointer"
                      >
                        Copy Link Wi-Fi
                      </button>
                    </div>
                  )}

                  {showPortalQr && (
                    <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center space-x-4">
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(
                          studentPortalPublicUrl ||
                            studentPortalShareUrl ||
                            studentPortalLanUrl
                        )}`}
                        alt="QR Nộp Bài SPCK"
                        className="w-28 h-28 rounded bg-white p-1.5 shrink-0"
                      />
                      <div className="text-xs text-slate-300 space-y-1">
                        <div className="font-bold text-white">
                          Mã QR Nộp Sản Phẩm Cuối Khóa — Lớp {selectedClassId}
                        </div>
                        <p className="text-slate-400">
                          Học sinh có thể quét mã QR hoặc mở đường dẫn thầy gửi trong nhóm Zalo để chọn tên và tải sản phẩm lên.
                        </p>
                      </div>
                    </div>
                  )}

                  {studentPortalSubmissions.length > 0 && (
                    <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800 space-y-1.5">
                      <div className="text-[11px] font-bold text-slate-300 uppercase">
                        📥 Trạng thái Học sinh nộp bài &amp; Tự động đẩy lên Google Drive:
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {studentPortalSubmissions.map((sub) => (
                          <div
                            key={sub.studentId}
                            className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-xs"
                          >
                            <span className="font-semibold text-white">
                              {sub.fullName}
                            </span>
                            <span className="text-slate-400">
                              ({sub.filesCount} file)
                            </span>
                            {sub.driveStatus === "UPLOADED" && sub.driveFolderUrl ? (
                              <a
                                href={sub.driveFolderUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-emerald-400 font-bold hover:underline"
                              >
                                ✅ Đã lên Drive
                              </a>
                            ) : sub.driveStatus === "UPLOADING" ||
                              sub.driveStatus === "QUEUED" ? (
                              <span className="text-amber-300 animate-pulse">
                                ⏳ Đang Up Drive...
                              </span>
                            ) : sub.driveStatus === "FAILED" ? (
                              <span
                                title={sub.driveError || ""}
                                className="text-rose-400"
                              >
                                ⚠️ Chờ Up Drive
                              </span>
                            ) : (
                              <span className="text-sky-300">✅ Đã lưu máy</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Google Drive Auto-Upload & Link Attachment Bar */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-8">
                <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">
                  Link Google Drive Gốc (Tự tạo thư mục Lớp &rarr; Học viên &amp; gắn Link vào bài)
                </label>
                <input
                  type="text"
                  value={driveFolderUrl}
                  onChange={(e) => setDriveFolderUrl(e.target.value)}
                  disabled={isAnyOperationBusy}
                  placeholder="https://drive.google.com/drive/folders/1Xl8OZ7i1bOKf7000xbUBYLPcxVb2qvRD"
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-sky-500"
                />
              </div>
              <div className="md:col-span-4">
                <button
                  type="button"
                  onClick={() => handleUploadToGoogleDrive()}
                  disabled={isAnyOperationBusy || !selectedClassId || rows.length === 0}
                  className="w-full flex items-center justify-center space-x-1.5 px-3.5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold text-xs transition-colors cursor-pointer"
                >
                  {uploadingDrive ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <UploadCloud className="w-4 h-4" />
                  )}
                  <span>Up Sản Phẩm Cả Lớp lên Drive &amp; Gắn Link</span>
                </button>
              </div>
            </div>

            {/* GitHub Pages Web Repo Config */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-8">
                <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">
                  Kho GitHub Pages Chạy Thử Web Live (Dành cho sản phẩm Web có file .html)
                </label>
                <input
                  type="text"
                  value={webRepoUrl}
                  onChange={(e) => setWebRepoUrl(e.target.value)}
                  disabled={isAnyOperationBusy}
                  placeholder="https://github.com/Banhtalon/WEB_PRODUCT_SHOW.git"
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div className="md:col-span-4">
                <button
                  type="button"
                  onClick={() => handleDeployWebToGithubPages()}
                  disabled={isAnyOperationBusy || !selectedClassId || rows.length === 0}
                  className="w-full flex items-center justify-center space-x-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-xs transition-colors cursor-pointer"
                >
                  {deployingWeb ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Rocket className="w-4 h-4" />
                  )}
                  <span>Đẩy Web Cả Lớp lên GitHub Pages &amp; Gắn Link</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Collapsible Panel B: Chuẩn bị Demo (Bảng chấm điểm Buổi 14 - cho phép tạo trước Buổi 14) */}
        {(showDemoPrepPanel || Boolean(generatedDemoSheetUrl)) && (
          <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-700/50 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-amber-300 uppercase">
                Chuẩn bị Demo: Tạo Bảng Chấm Điểm Buổi 14 (Có thể chuẩn bị trước Buổi 14 bất kỳ lúc nào)
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-6">
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">
                  Link Google Sheet Bảng Chấm Điểm Mẫu (Để trống dùng mẫu chuẩn: &ldquo;{demoSheetTitle}&rdquo;)
                </label>
                <input
                  type="text"
                  value={templateSheetUrl}
                  onChange={(e) => setTemplateSheetUrl(e.target.value)}
                  disabled={isAnyOperationBusy}
                  placeholder="Dán link Google Sheet mẫu hoặc để trống dùng mẫu chuẩn MindX"
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">
                  Ngày Demo (Buổi 14)
                </label>
                <input
                  type="text"
                  value={demoDateInput}
                  onChange={(e) => setDemoDateInput(e.target.value)}
                  disabled={isAnyOperationBusy}
                  placeholder="YYYY-MM-DD"
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-amber-300 text-xs font-mono focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="md:col-span-4">
                <button
                  type="button"
                  onClick={handleCreateDemoScoringSheet}
                  disabled={isAnyOperationBusy || !selectedClassId}
                  className="w-full flex items-center justify-center space-x-1.5 px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-semibold text-xs transition-colors cursor-pointer"
                >
                  {creatingDemoSheet ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  <span>
                    Tạo Bảng Chấm Điểm Demo ({students.length || rows.length} Tab HV) &amp; Lưu Drive
                  </span>
                </button>
              </div>
            </div>

            {generatedDemoSheetUrl && (
              <div className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-700/60 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center space-x-2 truncate">
                  <span className="font-bold text-emerald-300">
                    📊 {demoSheetTitle}:
                  </span>
                  <a
                    href={generatedDemoSheetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-300 hover:underline font-mono truncate"
                  >
                    {generatedDemoSheetUrl}
                  </a>
                </div>
                <div className="flex items-center space-x-2 shrink-0">
                  <a
                    href={generatedDemoSheetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                  >
                    Mở Google Sheet
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(generatedDemoSheetUrl);
                      setBannerMessage({
                        type: "success",
                        text: `Đã sao chép link Bảng chấm điểm Demo để gửi Giám khảo: ${generatedDemoSheetUrl}`,
                      });
                    }}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 font-semibold cursor-pointer"
                  >
                    Copy Link Cho Giám Khảo
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Quick Selection Bar & Compact Student Table */}
        {rows.length === 0 ? (
          <div className="p-8 rounded-xl bg-slate-950/60 border border-slate-800 text-center text-slate-400 text-sm">
            Chưa có dữ liệu thư mục SPCK. Hãy chọn Lớp học, chọn Buổi nộp và bấm{" "}
            <strong>&ldquo;Quét &amp; Khớp HV&rdquo;</strong> ở Bước 1.
          </div>
        ) : (
          <div className="space-y-3">
            {/* Selection Filters */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-400 font-medium">
                  Đang chọn:{" "}
                  <strong className="text-emerald-400">
                    {effectiveSelectedStudentIds.length}
                  </strong>
                  /{assignableStudentIds.length} học viên
                </span>
                <button
                  type="button"
                  disabled={isAnyOperationBusy}
                  onClick={() => setSelectedStudentIds(confirmedReadyStudentIds)}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 font-medium cursor-pointer disabled:opacity-50"
                >
                  Chọn bài đủ điều kiện ({confirmedReadyStudentIds.length})
                </button>
                <button
                  type="button"
                  disabled={isAnyOperationBusy}
                  onClick={() =>
                    setSelectedStudentIds(unsubmittedForActiveSessionStudentIds)
                  }
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 font-medium cursor-pointer disabled:opacity-50"
                >
                  Chọn bài chưa nộp Buổi {selectedSessionNumber} (
                  {unsubmittedForActiveSessionStudentIds.length})
                </button>
                <button
                  type="button"
                  disabled={isAnyOperationBusy}
                  onClick={() => setSelectedStudentIds(assignableStudentIds)}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium cursor-pointer disabled:opacity-50"
                >
                  Chọn tất cả ({assignableStudentIds.length})
                </button>
                <button
                  type="button"
                  disabled={isAnyOperationBusy}
                  onClick={() => setSelectedStudentIds([])}
                  className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-400 cursor-pointer disabled:opacity-50"
                >
                  Bỏ chọn
                </button>
              </div>
              <div className="text-[11px] text-slate-400">
                Sửa bản nháp chỉ đánh dấu <span className="text-teal-300">bản hiện tại đã đổi</span>, không xóa kết quả đã nộp của các buổi trước.
              </div>
            </div>

            {/* Compact Student Rows with Expandable "Chi tiết" */}
            <div className="space-y-2.5">
              {rows.map((row, idx) => {
                const rowKey = row.folderPath || row.assignedStudentId || String(idx);
                const isExpanded = Boolean(expandedRowKeys[rowKey]);
                const isSelected =
                  Boolean(row.assignedStudentId) &&
                  effectiveSelectedStudentIds.includes(row.assignedStudentId);
                const isDupeStudent =
                  Boolean(row.assignedStudentId) &&
                  duplicateStudentIds.has(row.assignedStudentId);
                const readiness = getRowReadinessSummary(row, duplicateStudentIds);
                const slot12 = getSessionSlotDisplay(row, 12);
                const slot13 = getSessionSlotDisplay(row, 13);
                const slot14 = getSessionSlotDisplay(row, 14);
                const activeSlot = getSessionSlotDisplay(row, selectedSessionNumber);

                const renderSlotPill = (
                  sessNum: 12 | 13 | 14,
                  slot: ReturnType<typeof getSessionSlotDisplay>
                ) => {
                  const isTarget = selectedSessionNumber === sessNum;
                  const toneClass =
                    slot.tone === "emerald"
                      ? "bg-emerald-950/80 border-emerald-600/70 text-emerald-300"
                      : slot.tone === "teal"
                      ? "bg-teal-950/80 border-teal-500/70 text-teal-200"
                      : slot.tone === "rose"
                      ? "bg-rose-950/80 border-rose-600/70 text-rose-300"
                      : slot.tone === "amber"
                      ? "bg-amber-950/80 border-amber-600/70 text-amber-300"
                      : "bg-slate-950 border-slate-800 text-slate-400";
                  const canViewSnapshot =
                    slot.hasVerifiedEvidence ||
                    slot.state === "UNKNOWN_LEGACY" ||
                    slot.state === "CORRUPTED";
                  const stuName =
                    students.find((s) => s.studentId === row.assignedStudentId)
                      ?.fullName ||
                    row.folderName ||
                    row.assignedStudentId;
                  return (
                    <div
                      key={sessNum}
                      title={slot.detail}
                      className={`px-2 py-1 rounded-md border text-[11px] leading-tight ${toneClass} ${
                        isTarget ? "ring-1 ring-emerald-400/60" : ""
                      }`}
                    >
                      <div className="font-bold flex items-center justify-between gap-1">
                        <span>B.{sessNum}</span>
                        {isTarget && (
                          <span className="text-[9px] uppercase px-1 rounded bg-emerald-500/20 text-emerald-300">
                            Đang chọn
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 font-medium truncate">{slot.label}</div>
                      {canViewSnapshot && (
                        <button
                          type="button"
                          onClick={() =>
                            setSnapshotModalData({
                              studentId: row.assignedStudentId,
                              studentName: stuName,
                              sessionNumber: sessNum,
                              slot,
                            })
                          }
                          className="mt-1 inline-flex items-center text-[10px] underline text-sky-300 hover:text-sky-200 cursor-pointer"
                        >
                          Xem bản đã nộp
                        </button>
                      )}
                    </div>
                  );
                };

                return (
                  <div
                    key={rowKey}
                    className={`rounded-xl border transition-all ${
                      !readiness.ready && !row.isConfirmedByTeacher
                        ? "bg-amber-950/15 border-amber-600/50"
                        : readiness.ready
                        ? "bg-slate-950/90 border-slate-800"
                        : "bg-slate-950/60 border-slate-800/80"
                    }`}
                  >
                    {/* Compact Summary Row */}
                    <div className="p-3.5 grid grid-cols-1 lg:grid-cols-12 gap-3 items-center">
                      {/* Col 1-4: Checkbox + Folder & Student Mapping */}
                      <div className="lg:col-span-4 flex items-start space-x-2.5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={!row.assignedStudentId || isAnyOperationBusy}
                          onChange={() => toggleSelectStudent(row.assignedStudentId)}
                          className="mt-1 rounded border-slate-600 cursor-pointer"
                          title="Chọn học viên này để nộp theo danh sách đã chọn"
                        />
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-xs font-mono truncate max-w-[200px]">
                              📁 {row.folderName}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                row.matchScore === 1.0
                                  ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                                  : "bg-amber-950 text-amber-300 border border-amber-700"
                              }`}
                            >
                              Khớp {Math.round(row.matchScore * 100)}%
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              value={row.assignedStudentId}
                              disabled={isAnyOperationBusy}
                              onChange={(e) => {
                                const newStuId = e.target.value;
                                const stu = students.find(
                                  (s) => s.studentId === newStuId
                                );
                                const updatedTitle = stu
                                  ? formatUiSessionTitle(
                                      `SPCK ${stu.fullName}`,
                                      selectedSessionNumber,
                                      stu.fullName
                                    )
                                  : row.projectTitle;
                                const overrides: Partial<ScannedFolderUIItem> = {
                                  assignedStudentId: newStuId,
                                  isConfirmedByTeacher: Boolean(newStuId),
                                  projectTitle: updatedTitle,
                                  isDirty: true,
                                  status: "WAITING_APPROVAL",
                                  contentHash: "",
                                };
                                setRows((prev) =>
                                  prev.map((r, i) =>
                                    i === idx ? { ...r, ...overrides } : r
                                  )
                                );
                                persistRowDraft(row, overrides);
                              }}
                              className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-white text-xs focus:outline-none focus:border-emerald-500 max-w-full"
                            >
                              <option value="">-- Ghép học viên --</option>
                              {students.map((stu) => (
                                <option key={stu.studentId} value={stu.studentId}>
                                  {stu.fullName} ({stu.studentId})
                                </option>
                              ))}
                            </select>

                            <label className="inline-flex items-center space-x-1 text-[11px] text-slate-300 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={row.isConfirmedByTeacher}
                                disabled={!row.assignedStudentId || isAnyOperationBusy}
                                onChange={(e) => {
                                  const confirmed = e.target.checked;
                                  const overrides: Partial<ScannedFolderUIItem> = {
                                    isConfirmedByTeacher: confirmed,
                                    isDirty: true,
                                    status: "WAITING_APPROVAL",
                                    contentHash: "",
                                  };
                                  setRows((prev) =>
                                    prev.map((r, i) =>
                                      i === idx ? { ...r, ...overrides } : r
                                    )
                                  );
                                  persistRowDraft(row, overrides);
                                }}
                                className="rounded border-slate-600"
                              />
                              <span>Đúng HV</span>
                            </label>
                          </div>
                        </div>
                      </div>

                      {/* Col 5-6: Thumbnail, Reusable Links & Readiness Status */}
                      <div className="lg:col-span-3 space-y-1 text-xs">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`px-2 py-0.5 rounded font-semibold text-[11px] ${
                              readiness.ready
                                ? "bg-emerald-500/15 text-emerald-300 border border-emerald-600/50"
                                : "bg-amber-500/15 text-amber-300 border border-amber-600/50"
                            }`}
                          >
                            {readiness.ready
                              ? "Đủ điều kiện nộp (*)"
                              : `Thiếu/Lỗi: ${readiness.missingItems.join(", ")}`}
                          </span>
                          {row.hasNewerSharedResources && (
                            <button
                              type="button"
                              onClick={() => handleSyncLatestResources(row)}
                              disabled={isAnyOperationBusy}
                              title="Kho tài nguyên chung vừa có ảnh hoặc đường dẫn mới. Bấm để cập nhật vào bản nháp buổi này."
                              className="px-2 py-0.5 rounded bg-sky-600 hover:bg-sky-500 text-white font-semibold text-[10px] cursor-pointer"
                            >
                              🔄 Dùng tài nguyên mới nhất
                            </button>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                          <span
                            title={readiness.thumbBadgeLabel}
                            className={
                              readiness.isDefaultThumb
                                ? "text-amber-300"
                                : readiness.thumbAspect === "16:9"
                                ? "text-emerald-300"
                                : "text-slate-300"
                            }
                          >
                            🖼️ {readiness.thumbBadgeLabel}
                          </span>
                          <span>• {row.screenshots.length}/10 ảnh</span>
                          <span>• {row.attachments.length}/10 file</span>
                          {readiness.hasDirectUseLink && (
                            <span className="px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-700/60">
                              Mở dùng SP ✓
                            </span>
                          )}
                          {readiness.hasSourceStorageLink && (
                            <span className="px-1.5 py-0.2 rounded bg-sky-950 text-sky-300 border border-sky-700/60">
                              Kho file/code ✓
                            </span>
                          )}
                          {readiness.hasYoutubeLink && (
                            <span className="px-1.5 py-0.2 rounded bg-rose-950 text-rose-300 border border-rose-700/60">
                              YouTube ✓
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Col 7-9: Separate Per-Session Status Columns (12, 13, 14) */}
                      <div className="lg:col-span-3 grid grid-cols-3 gap-1.5">
                        {renderSlotPill(12, slot12)}
                        {renderSlotPill(13, slot13)}
                        {renderSlotPill(14, slot14)}
                      </div>

                      {/* Col 10-12: Single Per-Student Submit/Retry Button + "Chi tiết" Toggle */}
                      <div className="lg:col-span-2 flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            row.assignedStudentId &&
                            handleApproveAndUpload(
                              [row.assignedStudentId],
                              true,
                              selectedSessionNumber
                            )
                          }
                          disabled={
                            isAnyOperationBusy ||
                            !row.assignedStudentId ||
                            isDupeStudent
                          }
                          title={`Nộp riêng học viên này cho Buổi ${selectedSessionNumber}`}
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold cursor-pointer"
                        >
                          {activeSlot.tone === "rose"
                            ? `Thử lại B.${selectedSessionNumber}`
                            : `Nộp riêng B.${selectedSessionNumber}`}
                        </button>

                        <button
                          type="button"
                          onClick={() => toggleExpandRow(rowKey)}
                          className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer transition-colors ${
                            isExpanded
                              ? "bg-slate-800 border-emerald-500/60 text-emerald-300"
                              : "bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-200"
                          }`}
                        >
                          {isExpanded ? "Thu gọn ▴" : "Chi tiết ▾"}
                        </button>
                      </div>
                    </div>

                    {/* Inline Warnings / Error Alerts (Always visible when present) */}
                    {(() => {
                      const visibleWarnings = row.warningReasons.filter(
                        (w) =>
                          !(
                            row.isConfirmedByTeacher &&
                            w.includes("Độ khớp tên đạt")
                          )
                      );
                      if (
                        visibleWarnings.length === 0 &&
                        !isDupeStudent &&
                        !row.errorMessage
                      ) {
                        return null;
                      }
                      return (
                        <div className="mx-3.5 mb-3 p-2.5 rounded-lg bg-amber-950/40 border border-amber-700/60 text-amber-200 text-xs space-y-1">
                          {isDupeStudent && (
                            <div className="flex items-center space-x-1.5 font-semibold text-rose-300">
                              <AlertTriangle className="w-4 h-4 shrink-0" />
                              <span>
                                Cảnh báo trùng studentId: Học viên này đang được gán cho
                                nhiều thư mục khác nhau!
                              </span>
                            </div>
                          )}
                          {visibleWarnings.map((w, wIdx) => (
                            <div key={wIdx} className="flex items-center space-x-1.5">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                              <span>{w}</span>
                            </div>
                          ))}
                          {row.errorMessage && (
                            <div className="text-rose-300 font-medium">
                              Lỗi gần nhất: {row.errorMessage}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Expandable Full Editor ("Chi tiết") */}
                    {isExpanded && (
                      <div className="p-4 border-t border-slate-800 bg-slate-900/70 space-y-4 rounded-b-xl">
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800 text-xs">
                          <div className="flex items-center space-x-2 text-slate-300">
                            <span className="font-bold">
                              Chỉnh sửa chi tiết Buổi {selectedSessionNumber} (
                              {getStageMeta(selectedSessionNumber).stageTitle}):
                            </span>
                            <span className="font-mono text-slate-400">
                              {row.status} • v{row.draftVersion || 1}
                              {row.contentHash
                                ? ` • #${row.contentHash.slice(0, 8)}`
                                : ""}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            {row.hasNewerSharedResources && (
                              <button
                                type="button"
                                onClick={() => handleSyncLatestResources(row)}
                                disabled={isAnyOperationBusy}
                                className="px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold cursor-pointer"
                              >
                                🔄 Dùng tài nguyên mới nhất
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleGenerateAiComments([row.folderPath])}
                              disabled={isAnyOperationBusy || !row.assignedStudentId}
                              className="px-2.5 py-1 rounded bg-purple-600/85 hover:bg-purple-500 disabled:opacity-40 text-white text-xs font-medium cursor-pointer"
                            >
                              AI Soạn riêng (B.{selectedSessionNumber})
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                row.assignedStudentId &&
                                handleUploadToGoogleDrive([row.assignedStudentId])
                              }
                              disabled={
                                isAnyOperationBusy ||
                                !row.assignedStudentId ||
                                !row.folderPath
                              }
                              className="px-2.5 py-1 rounded bg-sky-600/85 hover:bg-sky-500 disabled:opacity-40 text-white text-xs font-medium cursor-pointer"
                            >
                              {uploadingDrive
                                ? "Đang Up Drive..."
                                : "Up Drive & Gắn Link"}
                            </button>

                            {isWebClassOrProduct && (
                              <button
                                type="button"
                                onClick={() =>
                                  row.assignedStudentId &&
                                  handleDeployWebToGithubPages([row.assignedStudentId])
                                }
                                disabled={
                                  isAnyOperationBusy ||
                                  !row.assignedStudentId ||
                                  !row.folderPath
                                }
                                className="px-2.5 py-1 rounded bg-indigo-600/85 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium cursor-pointer"
                              >
                                {deployingWeb ? "Đang Up Web..." : "Up Web Live"}
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                          {/* Left Column: Title, Files Summary & Links */}
                          <div className="lg:col-span-5 space-y-3">
                            <div>
                              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                                <span className="font-semibold text-white">
                                  1. Tiêu đề dự án * (Tự gắn nhãn buổi, tối đa 100 ký tự)
                                </span>
                                <span
                                  className={
                                    row.projectTitle.length > 100
                                      ? "text-rose-400 font-bold"
                                      : "text-slate-400"
                                  }
                                >
                                  {row.projectTitle.length}/100
                                </span>
                              </div>
                              <input
                                type="text"
                                value={row.projectTitle}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  latestRowSaveSequence.set(
                                    `${selectedClassId}::${row.folderPath || row.assignedStudentId}`,
                                    ++clientDraftSequence
                                  );
                                  setRows((prev) =>
                                    prev.map((r, i) =>
                                      i === idx
                                        ? {
                                            ...r,
                                            projectTitle: val,
                                            isDirty: true,
                                            status: "WAITING_APPROVAL",
                                            contentHash: "",
                                          }
                                        : r
                                    )
                                  );
                                }}
                                onBlur={(e) => {
                                  const stu = students.find(
                                    (s) => s.studentId === row.assignedStudentId
                                  );
                                  const formatted = formatUiSessionTitle(
                                    e.target.value,
                                    selectedSessionNumber,
                                    stu?.fullName
                                  );
                                  const overrides =
                                    formatted !== row.projectTitle
                                      ? { projectTitle: formatted }
                                      : undefined;
                                  if (overrides) {
                                    setRows((prev) =>
                                      prev.map((r, i) =>
                                        i === idx ? { ...r, ...overrides } : r
                                      )
                                    );
                                  }
                                  persistRowDraft(row, overrides);
                                }}
                                className={`w-full px-3 py-1.5 rounded bg-slate-950 border text-white text-xs ${
                                  row.projectTitle.length > 100
                                    ? "border-rose-500"
                                    : "border-slate-700"
                                }`}
                              />
                              {row.projectTitle.length > 100 && (
                                <p className="mt-1 text-[11px] text-rose-400 font-medium">
                                  Tiêu đề đang vượt quá 100 ký tự ({row.projectTitle.length}/100). Vui lòng rút gọn tên sản phẩm trước khi duyệt.
                                </p>
                              )}
                              {readiness.isDefaultTitle && (
                                <p className="mt-1 text-[11px] text-amber-300/90">
                                  💡 Đang dùng tên mặc định (SPCK + tên học viên). Giáo viên có thể nhập tên sản phẩm cụ thể hơn (vẫn cho phép duyệt nộp).
                                </p>
                              )}
                            </div>

                            {/* Resource Counters */}
                            <div className="grid grid-cols-3 gap-2 text-xs">
                              <div className="p-2 rounded bg-slate-950 border border-slate-800">
                                <div className="text-slate-400 flex items-center space-x-1">
                                  <ImageIcon className="w-3.5 h-3.5 text-emerald-400" />
                                  <span>3. Thumbnail *</span>
                                </div>
                                <div className="mt-1 font-semibold text-white truncate">
                                  {readiness.thumbBadgeLabel}
                                </div>
                              </div>

                              <div className="p-2 rounded bg-slate-950 border border-slate-800">
                                <div className="text-slate-400 flex items-center space-x-1">
                                  <ImageIcon className="w-3.5 h-3.5 text-cyan-400" />
                                  <span>4. Ảnh bổ sung</span>
                                </div>
                                <div className="mt-1 font-semibold text-white">
                                  {row.screenshots.length}/10 ảnh
                                </div>
                              </div>

                              <div className="p-2 rounded bg-slate-950 border border-slate-800">
                                <div className="text-slate-400 flex items-center space-x-1">
                                  <Paperclip className="w-3.5 h-3.5 text-orange-400" />
                                  <span>5. Đính kèm</span>
                                </div>
                                <div className="mt-1 font-semibold text-white">
                                  {row.attachments.length}/10 files
                                </div>
                              </div>
                            </div>

                            {/* App Screenshot Capture & Owner Image Upload Controls */}
                            <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800 space-y-2 text-xs">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    row.assignedStudentId &&
                                    handleCaptureAppScreenshots([row.assignedStudentId])
                                  }
                                  disabled={
                                    isAnyOperationBusy ||
                                    !row.assignedStudentId ||
                                    !row.folderPath
                                  }
                                  className="inline-flex items-center space-x-1 px-2.5 py-1 rounded bg-teal-600/85 hover:bg-teal-500 disabled:opacity-40 text-white font-semibold cursor-pointer"
                                >
                                  <ImageIcon className="w-3.5 h-3.5" />
                                  <span>Chụp App &amp; AI Chọn Thumb</span>
                                </button>

                                <label className="inline-flex items-center space-x-1 px-2.5 py-1 rounded bg-amber-600/80 hover:bg-amber-500 text-white font-semibold cursor-pointer">
                                  <span>+ Owner Up Thumbnail</span>
                                  <input
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp"
                                    className="hidden"
                                    onChange={(e) => {
                                      handleOwnerUploadImage(
                                        row.assignedStudentId,
                                        "thumbnail",
                                        e.target.files
                                      );
                                      e.target.value = "";
                                    }}
                                  />
                                </label>

                                <label className="inline-flex items-center space-x-1 px-2.5 py-1 rounded bg-cyan-700/80 hover:bg-cyan-600 text-white font-semibold cursor-pointer">
                                  <span>+ Owner Up Ô Dưới</span>
                                  <input
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp"
                                    multiple
                                    className="hidden"
                                    onChange={(e) => {
                                      handleOwnerUploadImage(
                                        row.assignedStudentId,
                                        "gallery",
                                        e.target.files
                                      );
                                      e.target.value = "";
                                    }}
                                  />
                                </label>
                              </div>

                              <div className="text-[11px] text-slate-400">
                                Ưu tiên Thumbnail tỉ lệ <strong>16:9</strong> thể hiện rõ sản phẩm (Logo MindX chỉ dùng dự phòng khi chưa có ảnh). Ô 4 dùng cho ảnh chi tiết sản phẩm, thuyết trình hoặc hoạt động.
                              </div>

                              {row.screenshots.length > 0 && (
                                <div className="text-[11px] text-slate-400 leading-relaxed">
                                  <span className="text-cyan-300 font-semibold">
                                    Hình ở ô dưới ({row.screenshots.length}):
                                  </span>{" "}
                                  {row.screenshots
                                    .map((p) => p.split(/[\\/]/).pop())
                                    .join(", ")}
                                </div>
                              )}
                            </div>

                            {/* YouTube URLs */}
                            <div>
                              <label className="flex items-center space-x-1 text-xs text-slate-400 mb-1">
                                <Video className="w-3.5 h-3.5 text-rose-400" />
                                <span>
                                  2. YouTube Video URLs (Tùy chọn, tối đa 5 link)
                                </span>
                              </label>
                              <textarea
                                rows={2}
                                value={row.youtubeUrlsText}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  latestRowSaveSequence.set(
                                    `${selectedClassId}::${row.folderPath || row.assignedStudentId}`,
                                    ++clientDraftSequence
                                  );
                                  setRows((prev) =>
                                    prev.map((r, i) =>
                                      i === idx
                                        ? {
                                            ...r,
                                            youtubeUrlsText: val,
                                            isDirty: true,
                                            status: "WAITING_APPROVAL",
                                            contentHash: "",
                                          }
                                        : r
                                    )
                                  );
                                }}
                                onBlur={() => persistRowDraft(row)}
                                placeholder="https://www.youtube.com/watch?v=..."
                                className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-white text-xs font-mono"
                              />
                            </div>

                            {/* Related Links */}
                            <div>
                              <label className="flex items-center space-x-1 text-xs text-slate-400 mb-1">
                                <Link2 className="w-3.5 h-3.5 text-cyan-400" />
                                <span>
                                  6. Đường dẫn liên quan (Tùy chọn, tối đa 5:{" "}
                                  <code>Tên | https://...</code>)
                                </span>
                              </label>
                              <textarea
                                rows={2}
                                value={row.relatedLinksText}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  latestRowSaveSequence.set(
                                    `${selectedClassId}::${row.folderPath || row.assignedStudentId}`,
                                    ++clientDraftSequence
                                  );
                                  setRows((prev) =>
                                    prev.map((r, i) =>
                                      i === idx
                                        ? {
                                            ...r,
                                            relatedLinksText: val,
                                            isDirty: true,
                                            status: "WAITING_APPROVAL",
                                            contentHash: "",
                                          }
                                        : r
                                    )
                                  );
                                }}
                                onBlur={() => persistRowDraft(row)}
                                placeholder="Web chạy thử | https://... hoặc Kho file Drive | https://..."
                                className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-white text-xs font-mono"
                              />
                              {readiness.classifiedLinks.length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                                  {readiness.classifiedLinks.map((lnk, lIdx) => (
                                    <span
                                      key={lIdx}
                                      className={`px-2 py-0.5 rounded border ${
                                        lnk.category === "DIRECT_PRODUCT_USE"
                                          ? "bg-indigo-950/80 border-indigo-600/60 text-indigo-200"
                                          : lnk.category === "SOURCE_OR_FILE_STORAGE"
                                          ? "bg-sky-950/80 border-sky-600/60 text-sky-200"
                                          : "bg-slate-950 border-slate-700 text-slate-300"
                                      }`}
                                    >
                                      {lnk.categoryLabel}: {lnk.name}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Right Column: Quick Tags, Presentation Guardrail & Teacher Comment */}
                          <div className="lg:col-span-7 space-y-3">
                            <div>
                              <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                                <span className="font-semibold">
                                  Thẻ đánh giá nhanh (Quick Tags — hỗ trợ AI soạn bình luận)
                                </span>
                                <label className="inline-flex items-center space-x-1.5 text-emerald-400 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={row.includePresentation}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      setRows((prev) =>
                                        prev.map((r, i) =>
                                          i === idx
                                            ? { ...r, includePresentation: checked }
                                            : r
                                        )
                                      );
                                    }}
                                    className="rounded border-slate-600"
                                  />
                                  <span>Có đánh giá kỹ năng thuyết trình</span>
                                </label>
                              </div>

                              <div className="flex flex-wrap gap-1.5">
                                {(selectedSessionNumber === 14
                                  ? SESSION14_SPCK_TAGS
                                  : DEFAULT_SPCK_TAGS
                                ).map((tag) => {
                                  const active = row.quickTags.includes(tag);
                                  return (
                                    <button
                                      key={tag}
                                      type="button"
                                      onClick={() => {
                                        const nextTags = active
                                          ? row.quickTags.filter((t) => t !== tag)
                                          : [...row.quickTags, tag];
                                        const overrides = {
                                          quickTags: nextTags,
                                          isDirty: true,
                                        };
                                        setRows((prev) =>
                                          prev.map((r, i) =>
                                            i === idx ? { ...r, ...overrides } : r
                                          )
                                        );
                                        persistRowDraft(row, overrides);
                                      }}
                                      className={`px-2 py-1 rounded text-xs transition-colors cursor-pointer ${
                                        active
                                          ? "bg-purple-600/30 border border-purple-500 text-purple-200"
                                          : "bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200"
                                      }`}
                                    >
                                      {tag}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            <div>
                              <label className="block text-xs text-slate-400 mb-1">
                                Ghi chú riêng của Giáo viên cho AI — Buổi {selectedSessionNumber} (Tùy chọn)
                              </label>
                              <input
                                type="text"
                                value={row.teacherNote}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  const rowKey = `${selectedClassId}::${row.folderPath || row.assignedStudentId}`;
                                  latestRowSaveSequence.set(rowKey, ++clientDraftSequence);
                                  setRows((prev) =>
                                    prev.map((r, i) =>
                                      i === idx
                                        ? { ...r, teacherNote: val, isDirty: true }
                                        : r
                                    )
                                  );
                                }}
                                onBlur={() => persistRowDraft(row)}
                                placeholder={getStageMeta(selectedSessionNumber).noteHint}
                                className="w-full px-3 py-1.5 rounded bg-slate-950 border border-slate-700 text-white text-xs"
                              />
                            </div>

                            <div>
                              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                                <span className="font-semibold text-white">
                                  7. Bình luận của giáo viên * — Buổi {selectedSessionNumber} (
                                  {getStageMeta(selectedSessionNumber).stageTitle})
                                </span>
                                {row.verifiedAt && (
                                  <span className="text-emerald-400 flex items-center space-x-1">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    <span>Đã đối chiếu LMS gần nhất: {row.verifiedAt}</span>
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-400 mb-1.5">
                                📌 Yêu cầu giai đoạn: {getStageMeta(selectedSessionNumber).commentHint}
                              </p>
                              <textarea
                                rows={4}
                                value={row.teacherComment}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  latestRowSaveSequence.set(
                                    `${selectedClassId}::${row.folderPath || row.assignedStudentId}`,
                                    ++clientDraftSequence
                                  );
                                  setRows((prev) =>
                                    prev.map((r, i) =>
                                      i === idx
                                        ? {
                                            ...r,
                                            teacherComment: val,
                                            isDirty: true,
                                            status: "WAITING_APPROVAL",
                                            contentHash: "",
                                          }
                                        : r
                                    )
                                  );
                                }}
                                onBlur={() => persistRowDraft(row)}
                                placeholder={getStageMeta(selectedSessionNumber).commentHint}
                                className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-white text-xs leading-relaxed"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* BƯỚC 3: Nộp các bài đã chọn & Xem kết quả đầy đủ */}
      <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 text-xs font-bold">
                Bước 3 / 3
              </span>
              <h2 className="text-sm font-bold text-white">
                Nộp Các Bài Đã Chọn &amp; Đối Chiếu Kết Quả LMS
              </h2>
            </div>
            <p className="text-xs text-slate-400">
              Hệ thống sẽ kiểm tra nội dung đã duyệt, nộp đúng{" "}
              <strong className="text-emerald-400">Buổi {selectedSessionNumber}</strong> và đọc lại từ LMS để xác nhận lưu thật trước khi đánh dấu hoàn tất.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {lastSubmissionSummary &&
              lastSubmissionSummary.retryStudentIds.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    handleApproveAndUpload(
                      lastSubmissionSummary.retryStudentIds,
                      true,
                      lastSubmissionSummary.sessionNumber
                    )
                  }
                  disabled={isAnyOperationBusy}
                  className="flex items-center space-x-1.5 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-bold transition-colors cursor-pointer"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${uploading ? "animate-spin" : ""}`}
                  />
                  <span>
                    Thử lại {lastSubmissionSummary.retryStudentIds.length} bài chưa nộp — Buổi{" "}
                    {lastSubmissionSummary.sessionNumber}
                  </span>
                </button>
              )}

            <button
              type="button"
              onClick={() =>
                handleApproveAndUpload(
                  effectiveSelectedStudentIds,
                  true,
                  selectedSessionNumber
                )
              }
              disabled={
                isAnyOperationBusy ||
                !selectedClassId ||
                effectiveSelectedStudentIds.length === 0
              }
              className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold shadow-lg shadow-emerald-950/50 transition-colors cursor-pointer"
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <UploadCloud className="w-4 h-4" />
              )}
              <span>
                Nộp {effectiveSelectedStudentIds.length} bài — Buổi {selectedSessionNumber}
              </span>
            </button>
          </div>
        </div>

        {/* Detailed Batch Submission Result Card */}
        {lastSubmissionSummary && (
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
              <div className="font-bold text-white flex flex-wrap items-center gap-2">
                <span>
                  📊 Kết quả đợt nộp Buổi {lastSubmissionSummary.sessionNumber} (Lúc{" "}
                  {lastSubmissionSummary.completedAt}):
                </span>
                <span
                  className={`px-2 py-0.5 rounded ${
                    lastSubmissionSummary.verifiedItems.length ===
                      lastSubmissionSummary.totalSelected &&
                    lastSubmissionSummary.failedItems.length === 0 &&
                    lastSubmissionSummary.skippedItems.length === 0
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-600"
                      : "bg-amber-500/20 text-amber-300 border border-amber-600"
                  }`}
                >
                  Đã nộp {lastSubmissionSummary.verifiedItems.length}/
                  {lastSubmissionSummary.totalSelected} —{" "}
                  {Math.max(
                    0,
                    lastSubmissionSummary.totalSelected -
                      lastSubmissionSummary.verifiedItems.length
                  )}{" "}
                  bài chưa nộp
                </span>
              </div>
              <button
                type="button"
                onClick={() => setLastSubmissionSummary(null)}
                className="text-slate-400 hover:text-slate-200 underline cursor-pointer"
              >
                Ẩn bảng kết quả
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Verified List */}
              <div className="p-3 rounded-lg bg-emerald-950/25 border border-emerald-800/60 space-y-1.5">
                <div className="font-bold text-emerald-300">
                  ✅ Thành công ({lastSubmissionSummary.verifiedItems.length}/
                  {lastSubmissionSummary.totalSelected})
                </div>
                {lastSubmissionSummary.verifiedItems.length === 0 ? (
                  <div className="text-slate-500">Chưa có bài nào hoàn tất trong đợt này.</div>
                ) : (
                  <ul className="space-y-1 text-emerald-200">
                    {lastSubmissionSummary.verifiedItems.map((item) => (
                      <li key={item.studentId}>
                        • {item.studentName} ({item.studentId})
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Skipped List */}
              <div className="p-3 rounded-lg bg-amber-950/25 border border-amber-800/60 space-y-1.5">
                <div className="font-bold text-amber-300">
                  ⚠️ Bị bỏ qua ({lastSubmissionSummary.skippedItems.length})
                </div>
                {lastSubmissionSummary.skippedItems.length === 0 ? (
                  <div className="text-slate-500">Không có bài nào bị bỏ qua.</div>
                ) : (
                  <ul className="space-y-1 text-amber-200">
                    {lastSubmissionSummary.skippedItems.map((item) => (
                      <li key={item.studentId}>
                        • <strong>{item.studentName}:</strong> {item.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Failed List */}
              <div className="p-3 rounded-lg bg-rose-950/25 border border-rose-800/60 space-y-1.5">
                <div className="font-bold text-rose-300">
                  ❌ Lỗi khi nộp ({lastSubmissionSummary.failedItems.length})
                </div>
                {lastSubmissionSummary.failedItems.length === 0 ? (
                  <div className="text-slate-500">Không có bài nào gặp lỗi.</div>
                ) : (
                  <ul className="space-y-1 text-rose-200">
                    {lastSubmissionSummary.failedItems.map((item) => (
                      <li key={item.studentId}>
                        • <strong>{item.studentName}:</strong> {item.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* BƯỚC 4 (RIÊNG BUỔI 14): Đánh giá Tổng kết Cuối khóa & Điểm Demo (Cột 2 LMS: "Nhận xét học sinh" / Thư từ MindX) */}
      {selectedSessionNumber === 14 && selectedClassId && (
        <div className="p-5 rounded-xl bg-slate-900 border border-indigo-500/40 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 border border-indigo-500/50 text-indigo-300 text-xs font-bold">
                  Riêng Buổi 14 — Tổng kết cuối khóa
                </span>
                <h2 className="text-sm font-bold text-white">
                  Đánh Giá Tổng Kết Cuối Khóa, Điểm Demo &amp; Thư Từ MindX (Cột 2 LMS: &quot;Nhận xét học sinh&quot;)
                </h2>
              </div>
              <p className="text-xs text-slate-400">
                Đọc tự động 5 tiêu chí Điểm Demo từ file chấm điểm BGK (.xlsx / Google Sheet), chọn 9 mục Điểm Năng lực [ĐNL], AI soạn Thư tổng kết 3 phần (Learned From Mindx / Suggestions From Mindx / Future Direction) và tự động đẩy lên LMS.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={generatingS14EvalAi || uploadingS14EvalLms || importingDemoScores}
                onClick={() => handleGenerateSession14EvalAi()}
                className="px-3.5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-bold flex items-center space-x-1.5 cursor-pointer"
              >
                {generatingS14EvalAi ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                <span>✨ AI Soạn Thư Tổng Kết 3 Phần (Cả lớp)</span>
              </button>

              <button
                type="button"
                disabled={uploadingS14EvalLms || generatingS14EvalAi || importingDemoScores}
                onClick={() => handleApproveAndUploadSession14Eval()}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold flex items-center space-x-1.5 cursor-pointer"
              >
                {uploadingS14EvalLms ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <UploadCloud className="w-3.5 h-3.5" />
                )}
                <span>🚀 Duyệt &amp; Đẩy Đánh Giá Buổi 14 Lên LMS</span>
              </button>
            </div>
          </div>

          {/* Thanh đọc Điểm Demo từ file chấm điểm BGK */}
          <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 flex flex-wrap items-center gap-2.5">
            <span className="text-xs font-semibold text-indigo-300 shrink-0">
              📊 File chấm điểm BGK (.xlsx hoặc Link Google Sheet):
            </span>
            <input
              type="text"
              value={demoScoreSourceInput}
              onChange={(e) => setDemoScoreSourceInput(e.target.value)}
              placeholder={
                generatedDemoSheetUrl ||
                "Để trống để tự tìm file 'Bảng chấm điểm buổi Demo.xlsx' trong thư mục lớp, hoặc dán đường dẫn/link Google Sheet..."
              }
              className="flex-1 min-w-[260px] px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs font-mono"
            />
            <button
              type="button"
              disabled={importingDemoScores || uploadingS14EvalLms}
              onClick={handleImportDemoScores}
              className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
            >
              {importingDemoScores ? "Đang đọc điểm..." : "📥 Đọc Điểm Demo từ File Chấm Điểm"}
            </button>
          </div>

          {/* Danh sách đánh giá Buổi 14 của từng học viên */}
          <div className="space-y-2.5">
            {session14Evals.map((ev) => {
              const isExpanded = Boolean(expandedS14EvalIds[ev.studentId]);
              return (
                <div
                  key={ev.studentId}
                  className="rounded-lg bg-slate-950 border border-slate-800 overflow-hidden"
                >
                  <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 bg-slate-900/60">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-xs font-bold text-white">{ev.fullName}</span>
                      <span className="px-2 py-0.5 rounded bg-indigo-950 border border-indigo-700/60 text-indigo-300 text-[11px] font-semibold">
                        Điểm Demo: {ev.demoTotalScore} / 5.0
                      </span>
                      <span className="px-2 py-0.5 rounded bg-cyan-950 border border-cyan-700/60 text-cyan-300 text-[11px] font-semibold">
                        Điểm Năng lực [ĐNL]: {ev.competencyTotalScore} / 5.0
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                          ev.status === "VERIFIED"
                            ? "bg-emerald-950 border border-emerald-600/60 text-emerald-300"
                            : ev.status === "APPROVED"
                            ? "bg-teal-950 border border-teal-600/60 text-teal-300"
                            : ev.status === "FAILED"
                            ? "bg-rose-950 border border-rose-600/60 text-rose-300"
                            : "bg-slate-800 text-slate-300"
                        }`}
                      >
                        {ev.status === "VERIFIED"
                          ? "Đã lưu LMS ✓"
                          : ev.status === "APPROVED"
                          ? "Đã duyệt"
                          : ev.status === "FAILED"
                          ? "Lỗi lưu"
                          : ev.learnedFromMindx
                          ? "Chờ duyệt"
                          : "Chưa soạn"}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        disabled={generatingS14EvalAi}
                        onClick={() => handleGenerateSession14EvalAi([ev.studentId])}
                        className="px-2.5 py-1 rounded bg-purple-600/20 hover:bg-purple-600/40 border border-purple-500/40 text-purple-200 text-xs font-semibold cursor-pointer"
                      >
                        ✨ AI Soạn riêng
                      </button>
                      <button
                        type="button"
                        disabled={uploadingS14EvalLms}
                        onClick={() => handleApproveAndUploadSession14Eval([ev.studentId])}
                        className="px-2.5 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/40 border border-emerald-500/40 text-emerald-200 text-xs font-semibold cursor-pointer"
                      >
                        🚀 Đẩy lên LMS
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedS14EvalIds((prev) => ({
                            ...prev,
                            [ev.studentId]: !prev[ev.studentId],
                          }))
                        }
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs cursor-pointer"
                      >
                        {isExpanded ? "Thu gọn ▲" : "Chi tiết Điểm & Thư 3 phần ▼"}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="p-4 space-y-4 border-t border-slate-800 text-xs">
                      {/* 5 Tiêu chí Điểm Demo */}
                      <div>
                        <div className="font-semibold text-indigo-300 mb-2">
                          1. Điểm Demo (5 tiêu chí — Tổng: {ev.demoTotalScore} / 5.0 điểm)
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                          {DEMO_SCORE_ITEMS_UI.map((item) => (
                            <div
                              key={item.key}
                              className="p-2 rounded bg-slate-900 border border-slate-800 space-y-1"
                            >
                              <label className="block text-[11px] text-slate-400">
                                {item.label} (tối đa {item.max})
                              </label>
                              <input
                                type="number"
                                step="0.05"
                                min={0}
                                max={item.max}
                                value={ev.demoScores[item.key]}
                                onChange={(e) => {
                                  const val = Number(e.target.value) || 0;
                                  const nextDemo = {
                                    ...ev.demoScores,
                                    [item.key]: Math.min(item.max, Math.max(0, val)),
                                  };
                                  handleSaveSession14EvalDraft(ev.studentId, {
                                    demoScores: nextDemo,
                                  });
                                }}
                                className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-white text-xs font-mono"
                              />
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* 9 Tiêu chí Điểm Năng Lực [ĐNL] */}
                      <div>
                        <div className="font-semibold text-cyan-300 mb-2">
                          2. Điểm Năng Lực [ĐNL] (9 tiêu chí thang 1..5 — Trung bình: {ev.competencyTotalScore} / 5.0)
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                          {COMPETENCY_ITEMS_UI.map((item) => (
                            <div
                              key={item.key}
                              className="p-2 rounded bg-slate-900 border border-slate-800 flex items-center justify-between gap-2"
                            >
                              <span className="text-[11px] text-slate-300">{item.label}</span>
                              <select
                                value={ev.competencyScores[item.key]}
                                onChange={(e) => {
                                  const nextComp = {
                                    ...ev.competencyScores,
                                    [item.key]: Number(e.target.value) || 4,
                                  };
                                  handleSaveSession14EvalDraft(ev.studentId, {
                                    competencyScores: nextComp,
                                  });
                                }}
                                className="px-2 py-1 rounded bg-slate-950 border border-slate-700 text-cyan-300 text-xs font-bold"
                              >
                                {[1, 2, 3, 4, 5].map((score) => (
                                  <option key={score} value={score}>
                                    {score} điểm
                                  </option>
                                ))}
                              </select>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* 3 Ô Thư từ MindX */}
                      <div className="space-y-3">
                        <div>
                          <label className="block font-semibold text-emerald-300 mb-1">
                            Phần 1: Learned From Mindx (Thư tổng kết khóa học &amp; Kết quả đánh giá)
                          </label>
                          <textarea
                            rows={10}
                            value={ev.learnedFromMindx}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSession14Evals((prev) =>
                                prev.map((it) =>
                                  it.studentId === ev.studentId
                                    ? { ...it, learnedFromMindx: val }
                                    : it
                                )
                              );
                            }}
                            onBlur={() =>
                              handleSaveSession14EvalDraft(ev.studentId, {
                                learnedFromMindx: ev.learnedFromMindx,
                              })
                            }
                            className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-white text-xs leading-relaxed"
                          />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block font-semibold text-amber-300 mb-1">
                              Phần 2: Suggestions From Mindx (Lời khuyên cải thiện)
                            </label>
                            <textarea
                              rows={4}
                              value={ev.suggestionsFromMindx}
                              onChange={(e) => {
                                const val = e.target.value;
                                setSession14Evals((prev) =>
                                  prev.map((it) =>
                                    it.studentId === ev.studentId
                                      ? { ...it, suggestionsFromMindx: val }
                                      : it
                                  )
                                );
                              }}
                              onBlur={() =>
                                handleSaveSession14EvalDraft(ev.studentId, {
                                  suggestionsFromMindx: ev.suggestionsFromMindx,
                                })
                              }
                              className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-white text-xs leading-relaxed"
                            />
                          </div>

                          <div>
                            <label className="block font-semibold text-sky-300 mb-1">
                              Phần 3: Future Direction (Định hướng khóa học tiếp theo)
                            </label>
                            <textarea
                              rows={4}
                              value={ev.futureDirection}
                              onChange={(e) => {
                                const val = e.target.value;
                                setSession14Evals((prev) =>
                                  prev.map((it) =>
                                    it.studentId === ev.studentId
                                      ? { ...it, futureDirection: val }
                                      : it
                                  )
                                );
                              }}
                              onBlur={() =>
                                handleSaveSession14EvalDraft(ev.studentId, {
                                  futureDirection: ev.futureDirection,
                                })
                              }
                              className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-white text-xs leading-relaxed"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* In-Page Folder Browser Modal */}
      {folderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-3xl rounded-xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-5 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <FolderOpen className="w-5 h-5 text-emerald-400" />
                <h2 className="text-base font-bold text-white">
                  Chọn Thư Mục SPCK Trên Máy Tính
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setFolderModalOpen(false)}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
              >
                Đóng (Esc)
              </button>
            </div>

            <div className="p-4 space-y-3 border-b border-slate-800 bg-slate-900/90">
              {/* Quick Drives & Shortcuts */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-400 mr-1">
                  Ổ đĩa & Truy cập nhanh:
                </span>
                {browseDrives.map((drv) => (
                  <button
                    key={drv}
                    type="button"
                    onClick={() => loadBrowseDirectory(drv)}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors cursor-pointer ${
                      browseCurrentPath.toUpperCase().startsWith(drv.toUpperCase())
                        ? "bg-emerald-600/20 border-emerald-500 text-emerald-300"
                        : "bg-slate-950 border-slate-700 text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    💽 {drv}
                  </button>
                ))}
                {browseQuickLinks.map((ql) => (
                  <button
                    key={ql.path}
                    type="button"
                    onClick={() => loadBrowseDirectory(ql.path)}
                    className="px-2.5 py-1 rounded-md text-xs font-medium bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-300 transition-colors cursor-pointer"
                  >
                    📁 {ql.label}
                  </button>
                ))}
              </div>

              {/* Current Path Bar + Up Button */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!browseParentPath || browsingFolder}
                  onClick={() => browseParentPath && loadBrowseDirectory(browseParentPath)}
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-slate-700 text-slate-200 text-xs font-medium cursor-pointer"
                >
                  ⬆️ Lên 1 cấp
                </button>
                <input
                  type="text"
                  value={browseCurrentPath}
                  onChange={(e) => setBrowseCurrentPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      loadBrowseDirectory(browseCurrentPath);
                    }
                  }}
                  placeholder="Nhập đường dẫn thư mục rồi nhấn Enter..."
                  className="flex-1 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-emerald-300 font-mono text-xs focus:outline-none focus:border-emerald-500"
                />
                <button
                  type="button"
                  disabled={browsingFolder}
                  onClick={() => loadBrowseDirectory(browseCurrentPath)}
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium cursor-pointer"
                >
                  Đến
                </button>
              </div>

              {/* Quick Filter */}
              <div className="flex items-center justify-between gap-2">
                <input
                  type="text"
                  value={browseFilter}
                  onChange={(e) => setBrowseFilter(e.target.value)}
                  placeholder="🔍 Lọc nhanh tên thư mục con..."
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-xs focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            {/* Subdirectories List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1 bg-slate-950/60 min-h-[260px] max-h-[380px]">
              {browsingFolder ? (
                <div className="py-12 flex items-center justify-center space-x-2 text-slate-400 text-sm">
                  <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
                  <span>Đang đọc danh sách thư mục...</span>
                </div>
              ) : (
                (() => {
                  const filteredDirs = browseDirectories.filter((d) =>
                    !browseFilter.trim()
                      ? true
                      : d.name.toLowerCase().includes(browseFilter.trim().toLowerCase())
                  );
                  if (filteredDirs.length === 0) {
                    return (
                      <div className="py-10 text-center text-slate-500 text-xs">
                        Không có thư mục con nào trong đường dẫn này. Bạn có thể bấm{" "}
                        <strong className="text-emerald-400">
                          &quot;Chọn thư mục đang mở&quot;
                        </strong>{" "}
                        ở bên dưới.
                      </div>
                    );
                  }
                  return filteredDirs.map((dir) => (
                    <div
                      key={dir.path}
                      className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-800/80 transition-colors group"
                    >
                      <button
                        type="button"
                        onClick={() => loadBrowseDirectory(dir.path)}
                        className="flex-1 flex items-center space-x-2.5 text-left text-sm text-slate-200 group-hover:text-emerald-300 truncate cursor-pointer"
                      >
                        <FolderOpen className="w-4 h-4 text-amber-400 shrink-0" />
                        <span className="truncate font-medium">{dir.name}</span>
                      </button>
                      <div className="flex items-center space-x-2 shrink-0 ml-2">
                        <button
                          type="button"
                          onClick={() => loadBrowseDirectory(dir.path)}
                          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs cursor-pointer"
                        >
                          Mở ra
                        </button>
                        <button
                          type="button"
                          onClick={() => handleConfirmBrowseSelection(dir.path)}
                          className="px-2.5 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600 border border-emerald-500/40 text-emerald-300 hover:text-white text-xs font-semibold transition-colors cursor-pointer"
                        >
                          Chọn
                        </button>
                      </div>
                    </div>
                  ));
                })()
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3.5 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-400 truncate max-w-md">
                Đang mở: <span className="text-emerald-300 font-mono">{browseCurrentPath}</span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setFolderModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  disabled={!browseCurrentPath || browsingFolder}
                  onClick={() => handleConfirmBrowseSelection(browseCurrentPath)}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
                >
                  ✅ Chọn thư mục đang mở ({browseDirectories.length} thư mục con)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Xem bản đã nộp (Verified Snapshot / Legacy History / Corrupted History) */}
      {snapshotModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-5 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div className="space-y-0.5">
                <h2 className="text-sm font-bold text-white">
                  Bằng Chứng Bản Đã Nộp — Buổi {snapshotModalData.sessionNumber} (
                  {getStageMeta(snapshotModalData.sessionNumber).stageShort})
                </h2>
                <p className="text-xs text-slate-400">
                  Học viên: <strong className="text-emerald-300">{snapshotModalData.studentName}</strong> ({snapshotModalData.studentId})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSnapshotModalData(null)}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
              >
                Đóng
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                <div className="font-semibold text-white">
                  Trạng thái hiển thị: <span className="text-emerald-300">{snapshotModalData.slot.label}</span>
                </div>
                <div className="text-slate-400">{snapshotModalData.slot.detail}</div>
              </div>

              {snapshotModalData.slot.state === "CORRUPTED" && (
                <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-700/60 text-rose-200 space-y-1">
                  <div className="font-bold">⚠️ Lịch sử lỗi dữ liệu</div>
                  <div>
                    {snapshotModalData.slot.corruptedReason ||
                      "Dữ liệu lịch sử nộp bài của học viên này không đọc được JSON hợp lệ. Hệ thống không tự coi là chưa nộp để bảo toàn dấu vết."}
                  </div>
                </div>
              )}

              {snapshotModalData.slot.state === "UNKNOWN_LEGACY" &&
                !snapshotModalData.slot.snapshot && (
                  <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-700/60 text-amber-200 space-y-1">
                    <div className="font-bold">ℹ️ Lịch sử cũ (Chưa rõ buổi)</div>
                    <div>
                      Bản ghi này được đối chiếu thành công ở phiên bản cũ khi hệ thống chưa tách riêng buổi 12 / 13 / 14. Hệ thống giữ nguyên dấu vết lịch sử và không tự gán bừa vào buổi cụ thể.
                    </div>
                  </div>
                )}

              {snapshotModalData.slot.snapshot ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
                      <span className="text-slate-400">Thời điểm xác nhận LMS:</span>
                      <div className="font-semibold text-emerald-300 mt-0.5">
                        {snapshotModalData.slot.verifiedAt ||
                          snapshotModalData.slot.snapshot.capturedAt ||
                          "Đã xác nhận"}
                      </div>
                    </div>
                    <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
                      <span className="text-slate-400">Mã kiểm tra nội dung (Hash):</span>
                      <div className="font-mono text-slate-300 mt-0.5 truncate">
                        {snapshotModalData.slot.snapshot.contentHash || "N/A"}
                      </div>
                    </div>
                  </div>

                  {(snapshotModalData.slot.driftedFiles || []).length > 0 && (
                    <div className="p-2.5 rounded bg-amber-950/40 border border-amber-700/60 text-amber-200">
                      ⚠️ Một số tệp trên ổ cứng đã thay đổi hoặc di chuyển sau thời điểm nộp ({(snapshotModalData.slot.driftedFiles || []).join("; ")}). Nội dung chữ đã gửi bên dưới vẫn được lưu nguyên vẹn.
                    </div>
                  )}

                  <div className="p-3 rounded bg-slate-950 border border-slate-800 space-y-2">
                    <div>
                      <span className="text-slate-400 font-semibold">1. Tiêu đề đã nộp:</span>
                      <div className="text-white font-semibold mt-0.5">
                        {snapshotModalData.slot.snapshot.projectTitle}
                      </div>
                    </div>

                    <div>
                      <span className="text-slate-400 font-semibold">7. Bình luận giáo viên đã nộp:</span>
                      <div className="text-slate-200 whitespace-pre-wrap mt-1 p-2.5 rounded bg-slate-900 border border-slate-800 leading-relaxed">
                        {snapshotModalData.slot.snapshot.teacherComment}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-1">
                      <div className="p-2 rounded bg-slate-900 border border-slate-800">
                        <div className="text-slate-400">3. Thumbnail đã nộp</div>
                        <div className="text-white font-medium truncate mt-0.5">
                          {snapshotModalData.slot.snapshot.thumbnailPath
                            ? snapshotModalData.slot.snapshot.thumbnailPath.split(/[\\/]/).pop()
                            : "Không có"}
                        </div>
                      </div>
                      <div className="p-2 rounded bg-slate-900 border border-slate-800">
                        <div className="text-slate-400">4. Ảnh bổ sung</div>
                        <div className="text-white font-medium mt-0.5">
                          {(snapshotModalData.slot.snapshot.screenshots || []).length} ảnh
                        </div>
                      </div>
                      <div className="p-2 rounded bg-slate-900 border border-slate-800">
                        <div className="text-slate-400">5. Tệp đính kèm</div>
                        <div className="text-white font-medium mt-0.5">
                          {(snapshotModalData.slot.snapshot.attachments || []).length} tệp
                        </div>
                      </div>
                    </div>

                    {(snapshotModalData.slot.snapshot.youtubeUrls || []).length > 0 && (
                      <div>
                        <span className="text-slate-400 font-semibold">2. YouTube URLs đã nộp:</span>
                        <ul className="mt-0.5 space-y-0.5 font-mono text-rose-300">
                          {snapshotModalData.slot.snapshot.youtubeUrls.map((u, i) => (
                            <li key={i} className="truncate">• {u}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {(snapshotModalData.slot.snapshot.relatedLinks || []).length > 0 && (
                      <div>
                        <span className="text-slate-400 font-semibold">6. Đường dẫn liên quan đã nộp:</span>
                        <ul className="mt-0.5 space-y-0.5 font-mono text-sky-300">
                          {snapshotModalData.slot.snapshot.relatedLinks.map((l, i) => (
                            <li key={i} className="truncate">
                              • {l.name}: {l.url}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="px-5 py-3 bg-slate-950 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setSnapshotModalData(null)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
