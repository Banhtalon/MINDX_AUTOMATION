"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  FolderBrowserModal,
  Session14Panel,
  SnapshotModal,
  Step1Header,
  StudentTable,
  SubmitBar,
  ToolsDrawer,
  useSpckWorkflow,
} from "@/components/final-project";

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
  classId?: string;
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
  "📊 Slide đẹp, bố cục rõ ràng, dễ nhìn",
  "🗣️ Trình bày tốt, giới thiệu rõ nội dung chính",
  "😳 Cần luyện diễn đạt & tự tin hơn trước lớp",
  "🔍 Cần tìm hiểu kỹ code hơn để tự tin giải thích khi hỏi",
  "🎨 Thiết kế rất đẹp, màu sắc hài hòa và bắt mắt",
  "📐 Dùng Flexbox / Layout đa dạng, đủ các trang chức năng",
  "🌐 Chủ động tìm hiểu, học hỏi thêm từ sản phẩm thực tế",
  "💪 Tự giác tìm hiểu và tự viết code, không phụ thuộc AI",
  "🤖 Còn phụ thuộc khá nhiều vào AI, chưa hiểu sâu phần cốt lõi của code",
];

function extractSession14TagLabelsFromConfig(rawCategories: unknown): string[] {
  if (!Array.isArray(rawCategories)) return SESSION14_SPCK_TAGS;
  const labels: string[] = [];
  for (const cat of rawCategories) {
    if (!cat || typeof cat !== "object") continue;
    const c = cat as { category?: string; categoryName?: string; track?: string; tags?: Array<{ label?: string }> };
    const track = String(c.track || "").toLowerCase();
    const key = String(c.category || "").toLowerCase();
    const name = String(c.categoryName || "").toLowerCase();
    if (track === "session14" || key.startsWith("spck_") || /buổi\s*14|spck/i.test(name)) {
      for (const t of c.tags || []) {
        const lbl = String(t?.label || "").trim();
        if (lbl && !labels.includes(lbl)) labels.push(lbl);
      }
    }
  }
  return labels.length > 0 ? labels : SESSION14_SPCK_TAGS;
}

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

const DEMO_SCORE_ITEMS_ROBOTICS_UI: Array<{
  key: keyof Session14DemoScoresUI;
  label: string;
  max: number;
}> = [
  { key: "creativity", label: "Tư duy sáng tạo", max: 1.25 },
  { key: "communication", label: "Kỹ năng giao tiếp, hợp tác", max: 0.75 },
  { key: "problemSolving", label: "Giải quyết vấn đề", max: 1.0 },
  { key: "computerSkills", label: "Kỹ năng sử dụng máy tính", max: 0.5 },
  { key: "algorithm", label: "Tư duy máy tính, thuật toán", max: 1.0 },
];

function getStageMeta(sessionNum: 12 | 13 | 14): {
  stageNumber: 1 | 2;
  stageTitle: string;
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
      stageTitle: "Giai đoạn 1",
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
      stageTitle: "Giai đoạn 1",
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
    stageTitle: "Tổng kết cuối khóa",
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
let loadClassRequestSeq = 0;
const pageSessionId = `UI_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const latestRowSaveSequence = new Map<string, number>();
const latestKnownDraftVersionByRow = new Map<string, number>();
const inFlightRowSavePromises = new Map<string, Promise<any>>();

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
  const [session14TagLabels, setSession14TagLabels] = useState<string[]>(SESSION14_SPCK_TAGS);

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
      const mapped: ScannedFolderUIItem[] = dbRecords.map((rec) =>
        buildRowFromDbRecord(rec, studentMap.get(rec.studentId), targetSess)
      );
      for (const item of mapped) {
        if (item.assignedStudentId && typeof item.draftVersion === "number") {
          const rKey = `${(dbRecords[0]?.classId || activeUiClassId || "").toUpperCase()}::${
            item.folderPath || item.assignedStudentId
          }`;
          latestKnownDraftVersionByRow.set(rKey, item.draftVersion);
        }
      }
      setRows(mapped);
      const assignedIds = mapped.map((r) => r.assignedStudentId).filter(Boolean);
      const unsubmittedForTargetIds = mapped
        .filter((r) => {
          if (!r.assignedStudentId) return false;
          const slot = getSessionSlotDisplay(r, targetSess);
          return !slot.label.startsWith("Đã nộp ✓");
        })
        .map((r) => r.assignedStudentId);
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
          ? targetSess === 13
            ? unsubmittedForTargetIds
            : readyIds.length > 0
            ? readyIds
            : assignedIds
          : prev.filter((id) => assignedIds.includes(id))
      );
    },
    []
  );

  const loadClassData = useCallback(
    async (targetClassId?: string, targetSessionNumber?: 12 | 13 | 14) => {
      const reqSeq = ++loadClassRequestSeq;
      const requestedClassId = String(targetClassId || "").trim().toUpperCase();
      if (requestedClassId) {
        activeUiClassId = requestedClassId;
      } else {
        activeUiClassId = "";
      }
      setLoadingInit(true);
      try {
        const params = new URLSearchParams();
        if (requestedClassId) {
          params.set("classId", requestedClassId);
        }
        if (targetSessionNumber) {
          params.set("sessionNumber", String(targetSessionNumber));
        }
        const query = params.toString() ? `?${params.toString()}` : "";
        const res = await fetch(`/api/spck/list${query}`);
        const data = await res.json();
        if (
          reqSeq !== loadClassRequestSeq ||
          (requestedClassId && activeUiClassId && activeUiClassId !== requestedClassId)
        ) {
          return;
        }
        if (!data.success) {
          setBannerMessage({
            type: "error",
            text: data.error || "Không thể tải dữ liệu lớp học SPCK.",
          });
          return;
        }
        const classList: ClassOption[] = data.classes || [];
        let savedClassId = "";
        let urlSessionNum: 12 | 13 | 14 | undefined = undefined;
        try {
          if (typeof window !== "undefined") {
            const urlParams = new URLSearchParams(window.location?.search || "");
            const urlClass = String(
              urlParams.get("classId") || urlParams.get("classCode") || ""
            )
              .trim()
              .toUpperCase();
            const rawUrlSess = Number(urlParams.get("sessionNumber"));
            if ([12, 13, 14].includes(rawUrlSess)) {
              urlSessionNum = rawUrlSess as 12 | 13 | 14;
            }
            savedClassId =
              urlClass ||
              String(
                window.localStorage?.getItem("mindx_last_class_code") || ""
              )
                .trim()
                .toUpperCase();
          }
        } catch {}
        const effectiveTargetSession = targetSessionNumber || urlSessionNum;
        if (
          !requestedClassId &&
          savedClassId &&
          savedClassId !== data.selectedClassId &&
          classList.some((c) => c.classId === savedClassId)
        ) {
          activeUiClassId = savedClassId;
          setSelectedClassId(savedClassId);
          setClasses(classList);
          await loadClassData(savedClassId, effectiveTargetSession);
          return;
        }
        const resolvedClassId = requestedClassId || data.selectedClassId || "";
        if (
          reqSeq !== loadClassRequestSeq ||
          (requestedClassId && activeUiClassId && activeUiClassId !== resolvedClassId)
        ) {
          return;
        }
        activeUiClassId = resolvedClassId;
        setClasses(classList);
        if (!requestedClassId && resolvedClassId) {
          setSelectedClassId(resolvedClassId);
        }
        const matchedClass = classList.find((c) => c.classId === resolvedClassId);
        const apiSelectedSession = Number(
          data.selectedSessionNumber ?? data.activeSessionNumber
        );
        const resolvedSession: 12 | 13 | 14 =
          effectiveTargetSession ||
          ([12, 13, 14].includes(apiSelectedSession)
            ? (apiSelectedSession as 12 | 13 | 14)
            : matchedClass?.currentSessionNumber &&
              [12, 13, 14].includes(Number(matchedClass.currentSessionNumber))
            ? (Number(matchedClass.currentSessionNumber) as 12 | 13 | 14)
            : 13);
        setSelectedSessionNumber(resolvedSession);
        setStudents(data.students || []);
        if (Array.isArray(data.quickTags)) {
          setSession14TagLabels(extractSession14TagLabelsFromConfig(data.quickTags));
        }
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
        if (reqSeq === loadClassRequestSeq) {
          setBannerMessage({
            type: "error",
            text: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        if (reqSeq === loadClassRequestSeq) {
          setLoadingInit(false);
        }
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
    try {
      if (newClassId && typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(
          "mindx_last_class_code",
          newClassId.trim().toUpperCase()
        );
      }
    } catch {}
    setBannerMessage(null);
    setLastSubmissionSummary(null);
    setRows([]);
    setSession14Evals([]);
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
      const apiSelectedSession = Number(
        data.selectedSessionNumber ?? data.activeSessionNumber
      );
      const resolvedSession: 12 | 13 | 14 =
        [12, 13, 14].includes(apiSelectedSession)
          ? (apiSelectedSession as 12 | 13 | 14)
          : matchedClass?.currentSessionNumber &&
            [12, 13, 14].includes(Number(matchedClass.currentSessionNumber))
          ? (Number(matchedClass.currentSessionNumber) as 12 | 13 | 14)
          : selectedSessionNumber;
      setSelectedSessionNumber(resolvedSession);
      setStudents(data.students || []);
        if (Array.isArray(data.quickTags)) {
          setSession14TagLabels(extractSession14TagLabelsFromConfig(data.quickTags));
        }
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
          const dbAttachments = dbRec?.attachmentsJson
            ? parseJsonSafe<string[]>(dbRec.attachmentsJson, [])
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
            screenshots: dbRec ? dbScreenshots : pkg.screenshots || [],
            attachments: dbRec ? dbAttachments : pkg.attachments || [],
            youtubeUrlsText: (dbRec ? dbYtUrls : pkg.youtubeUrls || []).join("\n"),
            relatedLinksText: serializeRelatedLinksToText(
              dbRec ? dbRelLinks : pkg.relatedLinks || []
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
      const unsubmittedAfterScan = scannedItems
        .filter((r) => {
          if (!r.assignedStudentId) return false;
          const slot = getSessionSlotDisplay(r, selectedSessionNumber);
          return !slot.label.startsWith("Đã nộp ✓");
        })
        .map((r) => r.assignedStudentId);
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
        selectedSessionNumber === 13
          ? unsubmittedAfterScan
          : readyAfterScan.length > 0
          ? readyAfterScan
          : assignedAfterScan
      );
      setBannerMessage({
        type: data.warning ? "warning" : "success",
        text: data.warning
          ? `Đã quét ${scannedItems.length} thư mục học viên trong '${data.scanResult?.rootFolderPath}' (Cảnh báo cần kiểm tra: ${data.warning})`
          : `Đã quét thành công ${scannedItems.length} thư mục học viên trong '${data.scanResult?.rootFolderPath}'.`,
      });
      return {
        success: true,
        scannedItems,
        classId: requestClassId,
        sessionNumber: selectedSessionNumber,
      };
    } catch (err) {
      setBannerMessage({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
      return { success: false, scannedItems: [] as ScannedFolderUIItem[] };
    } finally {
      setScanning(false);
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

    const _inFlightMap: Map<string, Promise<any>> =
      typeof inFlightRowSavePromises !== "undefined"
        ? inFlightRowSavePromises
        : ((globalThis as any).__spckInFlightRowSavePromises ||= new Map());
    const _knownVerMap: Map<string, number> =
      typeof latestKnownDraftVersionByRow !== "undefined"
        ? latestKnownDraftVersionByRow
        : ((globalThis as any).__spckLatestKnownDraftVersionByRow ||= new Map());
    const prevInFlight = _inFlightMap.get(rowKey);
    const runRowSave = async (): Promise<any> => {
      if (prevInFlight) {
        await prevInFlight.catch(() => null);
      }
      const knownVer = prevInFlight ? _knownVerMap.get(rowKey) : undefined;
      const effectiveExpectedVersion = isStudentChanged
        ? overrides?.draftVersion ??
          rows.find(
            (r) =>
              r.assignedStudentId === merged.assignedStudentId &&
              r.folderPath !== merged.folderPath
          )?.draftVersion
        : typeof knownVer === "number" &&
          typeof merged.draftVersion === "number" &&
          knownVer > merged.draftVersion
        ? knownVer
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
            effectiveExpectedVersion ??
            merged.draftVersion ??
            row.draftVersion;
          if (typeof resolvedNextDraftVersion === "number") {
            const prevKnown = _knownVerMap.get(rowKey) ?? 0;
            if (resolvedNextDraftVersion >= prevKnown) {
              _knownVerMap.set(rowKey, resolvedNextDraftVersion);
            }
          }
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
          if (data.record && !data.staleIgnored) {
            setRows((prev) =>
              prev.map((r) => {
                if (r.folderPath !== merged.folderPath) return r;
                const nextDraftVersion =
                  typeof resolvedNextDraftVersion === "number" &&
                  typeof r.draftVersion === "number"
                    ? Math.max(r.draftVersion, resolvedNextDraftVersion)
                    : resolvedNextDraftVersion;
                if (!isLatestForRow) {
                  return {
                    ...r,
                    draftVersion: nextDraftVersion,
                  };
                }
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
                    isDefaultUiProductTitle(
                      data.record.projectTitle || merged.projectTitle
                    ),
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

        if (typeof data?.currentDraftVersion === "number") {
          _knownVerMap.set(rowKey, data.currentDraftVersion);
          setRows((prev) =>
            prev.map((r) =>
              r.folderPath === merged.folderPath
                ? {
                    ...r,
                    draftVersion: Math.max(
                      r.draftVersion || 0,
                      data.currentDraftVersion
                    ),
                  }
                : r
            )
          );
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

    const savePromise = runRowSave();
    _inFlightMap.set(rowKey, savePromise);
    try {
      return await savePromise;
    } finally {
      if (_inFlightMap.get(rowKey) === savePromise) {
        _inFlightMap.delete(rowKey);
      }
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
    setSelectedStudentIds(["__AUTO_SELECT__"]);
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

    const _inFlightMap: Map<string, Promise<any>> =
      typeof inFlightRowSavePromises !== "undefined"
        ? inFlightRowSavePromises
        : ((globalThis as any).__spckInFlightRowSavePromises ||= new Map());
    const _knownVerMap: Map<string, number> =
      typeof latestKnownDraftVersionByRow !== "undefined"
        ? latestKnownDraftVersionByRow
        : ((globalThis as any).__spckLatestKnownDraftVersionByRow ||= new Map());

    setGeneratingAi(true);
    setBannerMessage(null);
    try {
      const hadInFlightSaves = _inFlightMap.size > 0;
      if (hadInFlightSaves) {
        await Promise.allSettled(Array.from(_inFlightMap.values()));
      }

      const payloadStudents = targetRows.map((r) => {
        const rKey = `${requestClassId}::${r.folderPath || r.assignedStudentId}`;
        const knownVer = hadInFlightSaves ? _knownVerMap.get(rKey) : undefined;
        return {
          studentId: r.assignedStudentId,
          expectedVersion:
            typeof knownVer === "number" &&
            typeof r.draftVersion === "number" &&
            knownVer > r.draftVersion
              ? knownVer
              : r.draftVersion,
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
        };
      });

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
          if (typeof resolvedDraftVersion === "number" && row.assignedStudentId) {
            const rKey = `${requestClassId}::${row.folderPath || row.assignedStudentId}`;
            const prevKnown = _knownVerMap.get(rKey) ?? 0;
            if (resolvedDraftVersion >= prevKnown) {
              _knownVerMap.set(rKey, resolvedDraftVersion);
            }
          }
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
      const staleItems = generatedResults.filter(
        (item: any) => Boolean(item.staleIgnored)
      );

      if (
        insufficientItems.length === 0 &&
        failedItems.length === 0 &&
        staleItems.length === 0 &&
        successCount >= targetRows.length
      ) {
        setBannerMessage({
          type: "success",
          text: `Đã hoàn tất AI soạn nhận xét Buổi ${requestSessionNum}${stageMeta.stageTitle ? ` (${stageMeta.stageTitle})` : ""} cho ${successCount}/${targetRows.length} học viên.`,
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
        if (staleItems.length > 0) {
          detailParts.push(
            `${staleItems.length} học viên đang có thao tác lưu khác (${staleItems
              .map((it: any) => it.fullName || it.studentId)
              .join(", ")})`
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
      const dupErr = `Phát hiện học viên bị ghép trùng nhiều thư mục (${Array.from(duplicateStudentIds).join(", ")}). Vui lòng xử lý trên Bảng Ghép nối trước khi nộp.`;
      setBannerMessage({
        type: "error",
        text: dupErr,
      });
      const dupSummary: SpckBatchSubmissionSummaryUI = {
        sessionNumber: targetSessionNum,
        totalSelected: normalizedTargetIds.length,
        verifiedItems: [],
        failedItems: normalizedTargetIds.map((id) => ({
          studentId: id,
          studentName: id,
          reason: dupErr,
        })),
        skippedItems: [],
        retryStudentIds: normalizedTargetIds,
        completedAt: new Date().toLocaleTimeString("vi-VN"),
      };
      setLastSubmissionSummary(dupSummary);
      return dupSummary;
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
          if (activeUiClassId && activeUiClassId !== requestClassId) {
            return;
          }
          if (!savedRes) {
            const failReason =
              "Không thể lưu bản nháp trước khi duyệt (xung đột phiên bản hoặc dữ liệu không hợp lệ).";
            const failSummary: SpckBatchSubmissionSummaryUI = {
              sessionNumber: targetSessionNum,
              totalSelected: normalizedTargetIds.length,
              verifiedItems: [],
              failedItems: normalizedTargetIds.map((id) => ({
                studentId: id,
                studentName: resolveStudentLabel(id),
                reason:
                  id === sid
                    ? failReason
                    : "Đã dừng nộp hàng loạt do lỗi lưu nháp trước đó.",
              })),
              skippedItems: [],
              retryStudentIds: normalizedTargetIds,
              completedAt: new Date().toLocaleTimeString("vi-VN"),
            };
            setLastSubmissionSummary(failSummary);
            return failSummary;
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
        const approveErrReason =
          approveData.error || "Không thể chuẩn bị gói SPCK trước khi nộp.";
        const approveFailSummary: SpckBatchSubmissionSummaryUI = {
          sessionNumber: targetSessionNum,
          totalSelected: normalizedTargetIds.length,
          verifiedItems: [],
          failedItems:
            approveSkippedList.length > 0
              ? []
              : normalizedTargetIds.map((id) => ({
                  studentId: id,
                  studentName: resolveStudentLabel(id),
                  reason: approveErrReason,
                })),
          skippedItems: approveSkippedList,
          retryStudentIds: normalizedTargetIds,
          completedAt: new Date().toLocaleTimeString("vi-VN"),
        };
        setLastSubmissionSummary(approveFailSummary);
        if (approveSkippedList.length > 0) {
          setBannerMessage({
            type: "error",
            text: `Đã nộp 0/${normalizedTargetIds.length} bài (Buổi ${targetSessionNum}) — ${approveSkippedList.length} bài bị bỏ qua: ${approveSkippedList
              .map((s) => `${s.studentName} (${s.reason})`)
              .join("; ")}`,
          });
        } else {
          setBannerMessage({
            type: "error",
            text: approveErrReason,
          });
        }
        return approveFailSummary;
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
        const skippedSummary: SpckBatchSubmissionSummaryUI = {
          sessionNumber: targetSessionNum,
          totalSelected: normalizedTargetIds.length,
          verifiedItems: [],
          failedItems: [],
          skippedItems: skippedOnly,
          retryStudentIds: normalizedTargetIds,
          completedAt: new Date().toLocaleTimeString("vi-VN"),
        };
        setLastSubmissionSummary(skippedSummary);
        setBannerMessage({
          type: "error",
          text: `Đã nộp 0/${normalizedTargetIds.length} bài (Buổi ${targetSessionNum}) — ${skippedOnly.length} bài bị bỏ qua: ${skippedOnly
            .map((s) => `${s.studentName} (${s.reason})`)
            .join("; ")}`,
        });
        return skippedSummary;
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
        const uploadErrReason =
          uploadData.error || "Lỗi khi Auto-Upload SPCK lên LMS.";
        const uploadFailSummary: SpckBatchSubmissionSummaryUI = {
          sessionNumber: targetSessionNum,
          totalSelected: normalizedTargetIds.length,
          verifiedItems: [],
          failedItems: approvedIds.map((id) => ({
            studentId: id,
            studentName: resolveStudentLabel(id),
            reason: uploadErrReason,
          })),
          skippedItems: Array.from(approveSkippedMap.entries()).map(
            ([studentId, reason]) => ({
              studentId,
              studentName: resolveStudentLabel(studentId),
              reason,
            })
          ),
          retryStudentIds: normalizedTargetIds,
          completedAt: new Date().toLocaleTimeString("vi-VN"),
        };
        setLastSubmissionSummary(uploadFailSummary);
        setBannerMessage({
          type: "error",
          text: uploadErrReason,
        });
        return uploadFailSummary;
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

      const summaryObj: SpckBatchSubmissionSummaryUI = {
        classId: requestClassId,
        sessionNumber: targetSessionNum,
        totalSelected,
        verifiedItems,
        failedItems,
        skippedItems,
        retryStudentIds,
        completedAt: new Date().toLocaleTimeString("vi-VN"),
      };
      setLastSubmissionSummary(summaryObj);

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
      return summaryObj;
    } catch (err) {
      const errReason = err instanceof Error ? err.message : String(err);
      const catchSummary: SpckBatchSubmissionSummaryUI = {
        sessionNumber: targetSessionNum,
        totalSelected: normalizedTargetIds.length,
        verifiedItems: [],
        failedItems: normalizedTargetIds.map((id) => ({
          studentId: id,
          studentName: resolveStudentLabel(id),
          reason: errReason,
        })),
        skippedItems: [],
        retryStudentIds: normalizedTargetIds,
        completedAt: new Date().toLocaleTimeString("vi-VN"),
      };
      if (!activeUiClassId || activeUiClassId === requestClassId) {
        setLastSubmissionSummary(catchSummary);
        setBannerMessage({
          type: "error",
          text: errReason,
        });
      }
      return catchSummary;
    } finally {
      setUploading(false);
      setActiveActionLabel(null);
    }
  };

  // 7. Upload student local folders (delegated to useSpckWorkflow)

  // 10b. Robotics: import class YouTube playlist / video links → match students → 2 presentation frames
  const handleImportYoutubeProducts = async (
    sourceRows?: ScannedFolderUIItem[]
  ): Promise<{ success: boolean; updatedRows?: ScannedFolderUIItem[] } | void> => {
    const baseRows = sourceRows || rows;
    if (!selectedClassId) {
      setBannerMessage({
        type: "warning",
        text: "Vui lòng chọn Lớp học trước khi nhập link YouTube.",
      });
      return { success: false, updatedRows: baseRows };
    }
    if (!youtubeImportInput.trim()) {
      setBannerMessage({
        type: "warning",
        text: "Vui lòng dán link Playlist YouTube của lớp (hoặc danh sách 'Tên học viên - link video').",
      });
      return { success: false, updatedRows: baseRows };
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
        return { success: false, updatedRows: baseRows };
      }
      if (data.importResult) {
        setYoutubeImportReport(data.importResult);
      }
      if (!data.success) {
        setBannerMessage({
          type: "error",
          text: data.error || "Không thể nhập link YouTube cho lớp này.",
        });
        return { success: false, updatedRows: baseRows };
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
      const mergeYoutubeRecordsIntoRows = (prev: ScannedFolderUIItem[]): ScannedFolderUIItem[] => {
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
      };
      const updatedRows = mergeYoutubeRecordsIntoRows(baseRows);
      setRows((prev) => mergeYoutubeRecordsIntoRows(prev));

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
      return { success: true, updatedRows };
    } catch (err) {
      if (!activeUiClassId || activeUiClassId === requestClassId) {
        setBannerMessage({
          type: "error",
          text: err instanceof Error ? err.message : String(err),
        });
      }
      return { success: false, updatedRows: baseRows };
    } finally {
      setImportingYoutube(false);
    }
  };

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

  const effectiveSelectedStudentIds = useMemo(() => {
    const validSet = new Set(assignableStudentIds);
    if (selectedStudentIds.includes("__AUTO_SELECT__")) {
      if (selectedSessionNumber === 13) {
        return unsubmittedForActiveSessionStudentIds;
      }
      return confirmedReadyStudentIds.length > 0
        ? confirmedReadyStudentIds
        : assignableStudentIds;
    }
    return selectedStudentIds.filter((id) => validSet.has(id));
  }, [
    selectedStudentIds,
    assignableStudentIds,
    confirmedReadyStudentIds,
    selectedSessionNumber,
    unsubmittedForActiveSessionStudentIds,
  ]);

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
    togglingStudentPortal ||
    importingDemoScores ||
    generatingS14EvalAi ||
    uploadingS14EvalLms;

  const workflow =
    typeof useSpckWorkflow === "function"
      ? useSpckWorkflow({
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
          folderModalOpen,
          setFolderModalOpen,
          browseCurrentPath,
          setBrowseCurrentPath,
          browseParentPath,
          setBrowseParentPath,
          browseDrives,
          setBrowseDrives,
          browseQuickLinks,
          setBrowseQuickLinks,
          browseDirectories,
          setBrowseDirectories,
          browseFilter,
          setBrowseFilter,
          scanning,
          generatingAi,
          uploading,
          bannerMessage,
          setBannerMessage,
          scanningTeacherClasses,
          driveFolderUrl,
          setDriveFolderUrl,
          uploadingDrive,
          setUploadingDrive,
          webRepoUrl,
          setWebRepoUrl,
          deployingWeb,
          setDeployingWeb,
          templateSheetUrl,
          setTemplateSheetUrl,
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
          showYoutubeImport,
          setShowYoutubeImport,
          youtubeImportInput,
          setYoutubeImportInput,
          importingYoutube,
          youtubeImportReport,
          studentPortalRunning,
          setStudentPortalRunning,
          studentPortalShareUrl,
          setStudentPortalShareUrl,
          studentPortalLanUrl,
          setStudentPortalLanUrl,
          studentPortalLocalUrl,
          setStudentPortalLocalUrl,
          studentPortalPublicUrl,
          setStudentPortalPublicUrl,
          studentPortalTunnelStatus,
          setStudentPortalTunnelStatus,
          studentPortalTunnelProvider,
          setStudentPortalTunnelProvider,
          studentPortalAutoDrive,
          setStudentPortalAutoDrive,
          studentPortalSubmissions,
          setStudentPortalSubmissions,
          togglingStudentPortal,
          setTogglingStudentPortal,
          showPortalQr,
          setShowPortalQr,
          selectedSessionNumber,
          selectedStudentIds,
          setSelectedStudentIds,
          expandedRowKeys,
          setExpandedRowKeys,
          showOptionalTools,
          setShowOptionalTools,
          showDemoPrepPanel,
          setShowDemoPrepPanel,
          lastSubmissionSummary,
          setLastSubmissionSummary,
          activeActionLabel,
          snapshotModalData,
          setSnapshotModalData,
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
          expandedS14EvalIds,
          setExpandedS14EvalIds,
          session14TagLabels,
          duplicateStudentIds,
          confirmedReadyStudentIds,
          assignableStudentIds,
          effectiveSelectedStudentIds,
          unsubmittedForActiveSessionStudentIds,
          isAnyOperationBusy,
          hydrateRowsFromDb,
          loadClassData,
          handleClassChange,
          handleScanTeacherClasses,
          handleScanFolder,
          persistRowDraft,
          handleSessionChange,
          handleGenerateAiComments,
          handleApproveAndUpload,
          handleImportYoutubeProducts,
          getActiveUiClassId: () => activeUiClassId,
          bumpRowDraftSeq: (rowKey: string) => {
            latestRowSaveSequence.set(rowKey, ++clientDraftSequence);
          },
        })
      : (null as any);

  return (
    <div className="space-y-6">
      {/* Active Processing Lock Banner */}
      {isAnyOperationBusy && workflow.activeBusyDescription && (
        <div className="p-3.5 rounded-xl bg-amber-950/70 border border-amber-500/60 text-amber-200 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center space-x-2.5">
            <Loader2 className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
            <span className="font-semibold">{workflow.activeBusyDescription}</span>
          </div>
          <span className="text-[11px] text-amber-300/90 shrink-0">
            Các nút thao tác xung đột đang tạm khóa cho đến khi hoàn tất
          </span>
        </div>
      )}

      {/* <Step1Header /> renders <ClassPicker scope="spck" autoRestore={false} /> */}
      <Step1Header workflow={workflow} />

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
      <div className="mindx-card-blue p-5 rounded-xl space-y-4">
        <ToolsDrawer workflow={workflow} />
        <StudentTable workflow={workflow} />
      </div>

      <SubmitBar workflow={workflow} />
      <Session14Panel workflow={workflow} />
      <FolderBrowserModal workflow={workflow} />
      <SnapshotModal workflow={workflow} />
    </div>
  );
}

