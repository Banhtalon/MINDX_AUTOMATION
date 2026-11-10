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
  SpckRowReadinessSummaryUI,
  SpckSessionResultsMapUI,
  SpckSlotDisplayUI,
  SpckToolErrorKey,
  SpckToolErrorMapUI,
  StudentOption,
  StudentPortalSubmissionUI,
  YoutubeImportReportUI,
} from "./types";

export function extractSession14TagLabelsFromConfig(rawCategories: unknown): string[] {
  if (!Array.isArray(rawCategories)) return SESSION14_SPCK_TAGS;
  const labels: string[] = [];
  for (const cat of rawCategories) {
    if (!cat || typeof cat !== "object") continue;
    const c = cat as {
      category?: string;
      categoryName?: string;
      track?: string;
      tags?: Array<{ label?: string }>;
    };
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

export function getStageMeta(sessionNum: 12 | 13 | 14): {
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

export function stripUiSessionSuffix(rawTitle: string): string {
  return String(rawTitle || "")
    .replace(
      /\s*(?:—|-|\|)\s*Buổi\s*(?:12|13|14)(?:\s*\((?:GĐ[12]|Giai\s*đoạn\s*[12])\))?\s*$/gi,
      ""
    )
    .replace(
      /\s*\(Buổi\s*(?:12|13|14)(?:\s*-\s*(?:GĐ[12]|Giai\s*đoạn\s*[12]))?\)\s*$/gi,
      ""
    )
    .replace(/\s*(?:—|–|-|\|)?\s*\(?(?:GĐ\s*2|Giai\s*đoạn\s*2)\)?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatUiSessionTitle(
  rawTitle: string,
  sessionNum: 12 | 13 | 14,
  fallbackStudentName = "Học viên"
): string {
  const base = stripUiSessionSuffix(rawTitle) || `SPCK ${fallbackStudentName}`;
  const stage = getStageMeta(sessionNum);
  return `${base}${stage.suffix}`;
}

export function isDefaultUiProductTitle(
  rawTitle: string,
  studentFullName = ""
): boolean {
  const base = stripUiSessionSuffix(rawTitle);
  if (!base) return true;
  if (/^SPCK\b/i.test(base)) {
    const rest = base.replace(/^SPCK\s*[-:–—]?\s*/i, "").trim();
    if (!rest) return true;
    if (
      studentFullName &&
      rest.toLowerCase() === studentFullName.trim().toLowerCase()
    ) {
      return true;
    }
    if (!/[-:–—|]/.test(base) && base.split(/\s+/).length <= 6) {
      return true;
    }
  }
  return false;
}

export function classifyUiLinkCategory(url: string): {
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

export function parseJsonSafe<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function parseSessionResultsMap(raw?: string | null): SpckSessionResultsMapUI {
  if (!raw || typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: SpckSessionResultsMapUI = {};
    for (const key of ["12", "13", "14"] as const) {
      const entry = parsed[key];
      if (
        entry &&
        typeof entry === "object" &&
        (entry.status === "VERIFIED" || entry.status === "FAILED")
      ) {
        out[key] = {
          sessionNumber: Number(key) as 12 | 13 | 14,
          status: entry.status,
          submittedContentHash:
            typeof entry.submittedContentHash === "string"
              ? entry.submittedContentHash
              : undefined,
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

export function getSessionSlotDisplay(
  row: ScannedFolderUIItem,
  sessionNum: 12 | 13 | 14
): SpckSlotDisplayUI {
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
        corruptedReason:
          row.sessionHistory?.historyCorruptedReason || "Dữ liệu lịch sử cần kiểm tra",
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
    if (histSlot.displayState === "ABSENT_EXEMPT") {
      return {
        state: "ABSENT_EXEMPT",
        tone: "slate",
        label: "Vắng mặt (Miễn nộp)",
        detail: `Buổi ${sessionNum}: Học viên vắng mặt trên LMS nên không có ô nộp sản phẩm (được miễn nộp buổi này).`,
        subLabel: "Vắng mặt trên LMS",
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

export function serializeRelatedLinksToText(links: RelatedLinkItem[]): string {
  return (links || []).map((l) => `${l.name} | ${l.url}`).join("\n");
}

export function parseRelatedLinksFromText(text: string): RelatedLinkItem[] {
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

export function parseYoutubeUrlsFromText(text: string): string[] {
  return (text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function getRowReadinessSummary(
  row: ScannedFolderUIItem,
  duplicateStudentIds: Set<string>
): SpckRowReadinessSummaryUI {
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

export function buildRowFromDbRecord(
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
    overrideSessionNumber?: 12 | 13 | 14
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
  ) => Promise<{ success: boolean; updatedRows?: ScannedFolderUIItem[] } | void>;
  getActiveUiClassId: () => string;
  bumpRowDraftSeq: (rowKey: string) => void;
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
    setLastSubmissionSummary,
    activeActionLabel,
    session14Evals,
    setSession14Evals,
    demoScoreSourceInput,
    importingDemoScores,
    setImportingDemoScores,
    generatingS14EvalAi,
    setGeneratingS14EvalAi,
    uploadingS14EvalLms,
    setUploadingS14EvalLms,
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
  const [toolErrorsByStudent, setToolErrorsByStudent] =
    useState<SpckToolErrorMapUI>({});
  const [expandedRowTabByStudent, setExpandedRowTabByStudent] = useState<
    Record<string, "spck" | "eval14">
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
    });
  const autoImportedDemoClassKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
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
    Boolean(autoPrepStepProgress) ||
    session14ComboStatus.running;

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
  ): Promise<{ success: boolean; updatedRows: ScannedFolderUIItem[] } | void> => {
    const requestClassId = options?.classIdOverride || selectedClassId;
    const requestSessionNum = options?.sessionOverride || selectedSessionNumber;
    const activeRows = options?.sourceRows || rows;
    if (!requestClassId) {
      setBannerMessage({
        type: "warning",
        text: "Vui lòng chọn Lớp học trước khi tải sản phẩm lên Google Drive.",
      });
      return { success: false, updatedRows: activeRows };
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
      return { success: false, updatedRows: activeRows };
    }

    if (
      !options?.skipApprovalConfirm &&
      !confirmBeforeDemotingApprovedRows(idsToUpload, activeRows)
    ) {
      return { success: false, updatedRows: activeRows };
    }

    setUploadingDrive(true);
    setBannerMessage({
      type: "warning",
      text: `Đang mở Google Drive để tạo thư mục cho ${idsToUpload.length} học viên và tải sản phẩm lên... (Nếu lần đầu chưa đăng nhập Google trên trình duyệt Bot, vui lòng đăng nhập trực tiếp trên cửa sổ Chrome của Bot)`,
    });

    const flushedRows = [...activeRows];
    try {
      for (let idx = 0; idx < flushedRows.length; idx++) {
        const row = flushedRows[idx];
        if (idsToUpload.includes(row.assignedStudentId)) {
          const saved: any = await persistRowDraft(row, undefined, requestSessionNum);
          const activeClass = getActiveUiClassId();
          if (activeClass && activeClass !== requestClassId) {
            return { success: false, updatedRows: flushedRows };
          }
          if (!saved) {
            const errMsg = `Lưu bản nháp cho học viên '${row.folderName || row.assignedStudentId}' thất bại. Đã dừng tải lên Google Drive để tránh dùng dữ liệu cũ.`;
            setStudentToolError(row.assignedStudentId, "drive", errMsg);
            setBannerMessage({
              type: "error",
              text: errMsg,
            });
            return { success: false, updatedRows: flushedRows };
          }
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

      const res = await fetch("/api/spck/upload-drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: requestClassId,
          sessionNumber: requestSessionNum,
          driveFolderUrl: driveFolderUrl.trim(),
          studentIds: idsToUpload,
          syncActiveSession: true,
        }),
      });
      const data = await res.json();
      const activeClass = getActiveUiClassId();
      if (activeClass && activeClass !== requestClassId) {
        return { success: false, updatedRows: flushedRows };
      }

      if (!data.success) {
        for (const sid of idsToUpload) {
          setStudentToolError(
            sid,
            "drive",
            data.error || "Lỗi khi tải sản phẩm lên Google Drive."
          );
        }
        setBannerMessage({
          type: "error",
          text: data.error || "Lỗi khi tải sản phẩm lên Google Drive.",
        });
        return { success: false, updatedRows: flushedRows };
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
      return { success: failedCount === 0, updatedRows: nextRows };
    } catch (err) {
      const activeClass = getActiveUiClassId();
      if (!activeClass || activeClass === requestClassId) {
        const msg = err instanceof Error ? err.message : String(err);
        for (const sid of idsToUpload) {
          setStudentToolError(sid, "drive", msg);
        }
        setBannerMessage({
          type: "error",
          text: msg,
        });
      }
      return { success: false, updatedRows: flushedRows };
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
  ): Promise<{ success: boolean; updatedRows: ScannedFolderUIItem[] } | void> => {
    const requestClassId = options?.classIdOverride || selectedClassId;
    const requestSessionNum = options?.sessionOverride || selectedSessionNumber;
    const activeRows = options?.sourceRows || rows;
    if (!requestClassId) {
      setBannerMessage({
        type: "warning",
        text: "Vui lòng chọn Lớp học trước khi đẩy sản phẩm Web lên GitHub Pages.",
      });
      return { success: false, updatedRows: activeRows };
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
      return { success: false, updatedRows: activeRows };
    }

    if (
      !options?.skipApprovalConfirm &&
      !confirmBeforeDemotingApprovedRows(idsToDeploy, activeRows)
    ) {
      return { success: false, updatedRows: activeRows };
    }

    setDeployingWeb(true);
    setBannerMessage({
      type: "warning",
      text: `Đang đẩy thư mục Web của ${idsToDeploy.length} học viên lên GitHub Pages (Banhtalon/WEB_PRODUCT_SHOW) và tự động gắn Link Web Live...`,
    });

    const flushedRows = [...activeRows];
    try {
      for (let idx = 0; idx < flushedRows.length; idx++) {
        const row = flushedRows[idx];
        if (idsToDeploy.includes(row.assignedStudentId)) {
          const saved: any = await persistRowDraft(row, undefined, requestSessionNum);
          const activeClass = getActiveUiClassId();
          if (activeClass && activeClass !== requestClassId) {
            return { success: false, updatedRows: flushedRows };
          }
          if (!saved) {
            const errMsg = `Lưu bản nháp cho học viên '${row.folderName || row.assignedStudentId}' thất bại. Đã dừng triển khai GitHub Pages để tránh dùng dữ liệu cũ.`;
            setStudentToolError(row.assignedStudentId, "web", errMsg);
            setBannerMessage({
              type: "error",
              text: errMsg,
            });
            return { success: false, updatedRows: flushedRows };
          }
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

      const res = await fetch("/api/spck/deploy-web", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: requestClassId,
          sessionNumber: requestSessionNum,
          repoUrl: webRepoUrl.trim(),
          studentIds: idsToDeploy,
          syncActiveSession: true,
        }),
      });
      const data = await res.json();
      const activeClass = getActiveUiClassId();
      if (activeClass && activeClass !== requestClassId) {
        return { success: false, updatedRows: flushedRows };
      }

      if (!data.success) {
        for (const sid of idsToDeploy) {
          setStudentToolError(
            sid,
            "web",
            data.error || "Lỗi khi đẩy sản phẩm Web lên GitHub Pages."
          );
        }
        setBannerMessage({
          type: "error",
          text: data.error || "Lỗi khi đẩy sản phẩm Web lên GitHub Pages.",
        });
        return { success: false, updatedRows: flushedRows };
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
      return { success: failedCount === 0, updatedRows: nextRows };
    } catch (err) {
      const activeClass = getActiveUiClassId();
      if (!activeClass || activeClass === requestClassId) {
        const msg = err instanceof Error ? err.message : String(err);
        for (const sid of idsToDeploy) {
          setStudentToolError(sid, "web", msg);
        }
        setBannerMessage({
          type: "error",
          text: msg,
        });
      }
      return { success: false, updatedRows: flushedRows };
    } finally {
      setDeployingWeb(false);
    }
  };

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
  ): Promise<{ success: boolean; updatedRows: ScannedFolderUIItem[] } | void> => {
    const requestClassId = options?.classIdOverride || selectedClassId;
    const requestSessionNum = options?.sessionOverride || selectedSessionNumber;
    const activeRows = options?.sourceRows || rows;
    if (!requestClassId) {
      setBannerMessage({
        type: "warning",
        text: "Vui lòng chọn Lớp học trước khi chụp hình giao diện App.",
      });
      return { success: false, updatedRows: activeRows };
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
      return { success: false, updatedRows: activeRows };
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
          syncActiveSession: true,
        }),
      });
      const data = await res.json();
      const activeClass = getActiveUiClassId();
      if (activeClass && activeClass !== requestClassId) {
        return { success: false, updatedRows: activeRows };
      }
      if (!data.success) {
        for (const sid of idsToCapture) {
          setStudentToolError(
            sid,
            "screenshot",
            data.error || "Không thể chụp hình giao diện App."
          );
        }
        setBannerMessage({
          type: "error",
          text: data.error || "Không thể chụp hình giao diện App.",
        });
        return { success: false, updatedRows: activeRows };
      }

      const dbByStu = new Map<string, SpckRecordRow>(
        (data.records || [])
          .filter((r: SpckRecordRow) => !r.classId || r.classId === requestClassId)
          .map((r: SpckRecordRow) => [r.studentId, r])
      );

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
            draftVersion: rec.draftVersion ?? row.draftVersion,
            hasNewerSharedResources: Boolean(rec.hasNewerSharedResources),
            thumbnailInspection: nextThumbInspection,
            sessionResults:
              parseSessionResultsMap(rec.sessionResultsJson) || row.sessionResults,
            sessionHistory: rec.sessionHistory || row.sessionHistory,
            isDirty: false,
          };
        });

      const nextRows = mergeScreenshotRecords(activeRows);
      setRows((prev) => mergeScreenshotRecords(prev));

      const bRes = data.batchResult;
      let hasFailedScreenshot = false;
      if (Array.isArray(bRes?.results)) {
        for (const item of bRes.results) {
          if (!item?.studentId) continue;
          if (item.status === "FAILED" || item.errorMessage) {
            hasFailedScreenshot = true;
            setStudentToolError(
              item.studentId,
              "screenshot",
              item.errorMessage || "Lỗi chụp hình giao diện."
            );
          } else {
            setStudentToolError(item.studentId, "screenshot", null);
          }
        }
      } else {
        for (const sid of idsToCapture) {
          setStudentToolError(sid, "screenshot", null);
        }
      }
      const hasNewerCount = (data.records || []).filter(
        (r: SpckRecordRow) => r.hasNewerSharedResources
      ).length;
      setBannerMessage({
        type: "success",
        text: `Đã chụp tổng cộng ${bRes?.totalScreenshotsCaptured || 0} màn hình giao diện App cho ${bRes?.totalProcessed || 0} học viên và gắn vào bản nháp!${
          hasNewerCount > 0
            ? ` Bấm "Dùng tài nguyên mới nhất" ở học viên cần áp dụng ảnh mới vào bản nháp Buổi ${requestSessionNum}.`
            : ""
        }`,
      });
      return { success: !hasFailedScreenshot, updatedRows: nextRows };
    } catch (err) {
      const activeClass = getActiveUiClassId();
      if (!activeClass || activeClass === requestClassId) {
        const msg = err instanceof Error ? err.message : String(err);
        for (const sid of idsToCapture) {
          setStudentToolError(sid, "screenshot", msg);
        }
        setBannerMessage({
          type: "error",
          text: msg,
        });
      }
      return { success: false, updatedRows: activeRows };
    } finally {
      setCapturingScreenshots(false);
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
      if (
        pStatus.rootFolderPath &&
        (!folderPathInput ||
          (pStatus.isRunning && (!pStatus.classId || pStatus.classId === selectedClassId)))
      ) {
        setFolderPathInput(pStatus.rootFolderPath);
      }
    },
    [
      folderPathInput,
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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch("/api/spck/student-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          action: "start",
          classId: selectedClassId,
          sessionNumber: selectedSessionNumber,
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
      setTogglingStudentPortal(false);
    }
  };

  const handleStopStudentPortal = async () => {
    setTogglingStudentPortal(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch("/api/spck/student-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          action: "stop",
          classId: selectedClassId,
          sessionNumber: selectedSessionNumber,
        }),
      });
      const data = await res.json();
      if (data.portalStatus) {
        applyPortalStatusState(data.portalStatus);
      } else {
        setStudentPortalRunning(false);
      }
      if (Array.isArray(data.records) && data.records.length > 0) {
        hydrateRowsFromDb(data.records, students);
      }
      setShowPortalQr(false);
      setBannerMessage({
        type: "warning",
        text: "Đã đóng Cổng Cho Học Sinh Nộp Bài.",
      });
    } catch {
      setStudentPortalRunning(false);
      setShowPortalQr(false);
      setBannerMessage({
        type: "warning",
        text: "Đã đóng Cổng Cho Học Sinh Nộp Bài.",
      });
    } finally {
      clearTimeout(timeoutId);
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

        const validRecords = data.records.filter(
          (r: any) => !r.classId || String(r.classId).trim().toUpperCase() === reqClass
        );

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
  }) => {
    if (!selectedClassId) return;
    const reqClassId = String(selectedClassId).trim().toUpperCase();
    const g = globalThis as any;
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
    if (!options?.isAutoImport) {
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
      if (String(selectedClassId || "").trim().toUpperCase() !== reqClassId) return;
      if (
        g.__s14LatestRenderedClassId &&
        String(g.__s14LatestRenderedClassId).trim().toUpperCase() !== reqClassId
      ) {
        return;
      }
      if (!data.success) {
        if (!options?.isAutoImport) {
          setBannerMessage({
            type: "error",
            text: data.error || "Không thể đọc điểm Demo từ file chấm điểm.",
          });
        }
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
      const matched = data.importResult?.matchedCount || 0;
      if (matched > 0 || !options?.isAutoImport) {
        setBannerMessage({
          type: "success",
          text: `Đã đọc thành công Điểm Demo & gợi ý Điểm Năng lực [ĐNL] cho ${matched} học viên lớp ${reqClassId}!`,
        });
      }
    } catch (err) {
      if (!options?.isAutoImport) {
        setBannerMessage({
          type: "error",
          text: err instanceof Error ? err.message : String(err),
        });
      }
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
    targetStudentIds?: string[]
  ): Promise<{
    verifiedCount: number;
    verifiedStudentIds: string[];
    failedCount: number;
    retryStudentIds: string[];
    errorMessage: string | null;
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
      const warnMsg =
        "Chưa có học viên nào đủ nội dung 3 phần Thư từ MindX để duyệt và đẩy lên LMS.";
      setBannerMessage({
        type: "warning",
        text: warnMsg,
      });
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
    setBannerMessage(null);
    try {
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
              return {
                verifiedCount: 0,
                verifiedStudentIds: [],
                failedCount: ids.length,
                retryStudentIds: ids,
                errorMessage: "Lưu nháp thất bại trước khi duyệt.",
              };
            }
          }
        }
      }

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
              setTimeout(() => resolve({ timedOut: true }), 150)
            ),
          ]);
          if (
            !flushRes ||
            (flushRes as any).timedOut ||
            !(flushRes as any).success
          ) {
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
        const errMsg =
          appData.errors?.[0]?.error ||
          appData.error ||
          "Không thể duyệt đánh giá Buổi 14 trước khi đẩy lên LMS.";
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

      const upRes = await fetch("/api/spck/session14-eval/upload-lms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: reqClassId,
          studentIds: approvedIds,
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
        const validRecords = upData.records.filter(
          (r: any) => !r.classId || String(r.classId).trim().toUpperCase() === reqClassId
        );
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
        setBannerMessage({
          type: "error",
          text: errMsg,
        });
        return {
          verifiedCount: 0,
          verifiedStudentIds: [],
          failedCount: approvedIds.length,
          retryStudentIds: approvedIds,
          errorMessage: errMsg,
        };
      }
      const verCount = upData.uploadResult?.verifiedCount || 0;
      const failCount = upData.uploadResult?.failedCount || 0;
      const verifiedStudentIds = Array.isArray(upData.uploadResult?.results)
        ? upData.uploadResult.results
            .filter((r: any) => r.status === "VERIFIED")
            .map((r: any) => String(r.studentId || ""))
            .filter(Boolean)
        : verCount > 0 && failCount === 0
        ? approvedIds
        : [];
      const failedRetryIds = Array.isArray(upData.uploadResult?.results)
        ? upData.uploadResult.results
            .filter((r: any) => r.status !== "VERIFIED")
            .map((r: any) => String(r.studentId || ""))
            .filter(Boolean)
        : failCount > 0
        ? approvedIds
        : [];
      const firstFailedItem = Array.isArray(upData.uploadResult?.results)
        ? upData.uploadResult.results.find(
            (r: any) => r.status === "FAILED" && r.errorMessage
          )
        : null;
      const statusText =
        failCount > 0 && firstFailedItem
          ? `Đã đẩy & xác minh ${verCount}/${approvedIds.length} học viên lên LMS (${failCount} lỗi — ${firstFailedItem.fullName || firstFailedItem.studentId}: ${firstFailedItem.errorMessage})`
          : `Đã đẩy & xác minh (Read-after-Write) đánh giá tổng kết + Điểm Demo Buổi 14 cho ${verCount}/${approvedIds.length} học viên lên LMS!`;
      setBannerMessage({
        type:
          failCount === 0 && verCount > 0
            ? "success"
            : failCount > 0
            ? "error"
            : "warning",
        text: statusText,
      });
      return {
        verifiedCount: verCount,
        verifiedStudentIds,
        failedCount: failCount,
        retryStudentIds: failedRetryIds,
        errorMessage:
          failCount > 0
            ? firstFailedItem?.errorMessage || "Một số học viên lỗi lưu Đánh giá Buổi 14."
            : null,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
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
          `/api/spck/student-portal?classId=${encodeURIComponent(
            selectedClassId
          )}&sessionNumber=${selectedSessionNumber}`
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
              return dbRecords.map((rec) =>
                buildRowFromDbRecord(
                  rec,
                  studentMap.get(rec.studentId),
                  selectedSessionNumber
                )
              );
            }

            const existingIds = new Set(prev.map((r) => r.assignedStudentId));
            const studentMap = new Map(students.map((s) => [s.studentId, s]));
            let anyChanged = false;
            const updatedRows = prev.map((row) => {
              const rec = dbRecords.find(
                (r) => r.studentId === row.assignedStudentId
              );
              if (!rec) return row;
              const relatedLinks = parseJsonSafe<RelatedLinkItem[]>(
                rec.relatedLinksJson,
                []
              );
              const screenshots = parseJsonSafe<string[]>(rec.screenshotsJson, []);
              const attachments = parseJsonSafe<string[]>(rec.attachmentsJson, []);
              const youtubeUrls = parseJsonSafe<string[]>(rec.youtubeUrlsJson, []);

              const nextFolderPath = rec.localFolderPath || row.folderPath;
              const nextThumbnailPath = rec.thumbnailPath || row.thumbnailPath;
              const nextScreenshots =
                screenshots.length > 0 ? screenshots : row.screenshots;
              const nextAttachments =
                attachments.length > 0 ? attachments : row.attachments;
              const nextYoutubeText =
                youtubeUrls.length > 0
                  ? youtubeUrls.join("\n")
                  : row.youtubeUrlsText;
              const nextRelatedLinksText =
                relatedLinks.length > 0
                  ? serializeRelatedLinksToText(relatedLinks)
                  : row.relatedLinksText;
              const nextSessionResults =
                parseSessionResultsMap(rec.sessionResultsJson) ||
                row.sessionResults;

              const isNewerDraft =
                typeof rec.draftVersion === "number" &&
                rec.draftVersion > (row.draftVersion || 0);
              const nextStatus = isNewerDraft
                ? rec.status || row.status
                : row.status;
              const nextContentHash = isNewerDraft
                ? rec.contentHash ?? row.contentHash
                : row.contentHash;
              const nextDraftVersion = isNewerDraft
                ? rec.draftVersion
                : row.draftVersion;

              const rowChanged =
                nextFolderPath !== row.folderPath ||
                nextThumbnailPath !== row.thumbnailPath ||
                nextYoutubeText !== row.youtubeUrlsText ||
                nextRelatedLinksText !== row.relatedLinksText ||
                nextStatus !== row.status ||
                nextContentHash !== row.contentHash ||
                nextDraftVersion !== row.draftVersion ||
                Boolean(rec.hasNewerSharedResources) !==
                  Boolean(row.hasNewerSharedResources) ||
                JSON.stringify(nextScreenshots) !==
                  JSON.stringify(row.screenshots) ||
                JSON.stringify(nextAttachments) !==
                  JSON.stringify(row.attachments) ||
                JSON.stringify(nextSessionResults) !==
                  JSON.stringify(row.sessionResults);

              if (!rowChanged) {
                return row;
              }
              anyChanged = true;
              return {
                ...row,
                folderPath: nextFolderPath,
                thumbnailPath: nextThumbnailPath,
                screenshots: nextScreenshots,
                attachments: nextAttachments,
                youtubeUrlsText: nextYoutubeText,
                relatedLinksText: nextRelatedLinksText,
                thumbnailInspection:
                  rec.thumbnailInspection || row.thumbnailInspection,
                sessionResults: nextSessionResults,
                sessionHistory: rec.sessionHistory || row.sessionHistory,
                hasNewerSharedResources: Boolean(rec.hasNewerSharedResources),
                status: nextStatus,
                contentHash: nextContentHash,
                draftVersion: nextDraftVersion,
              };
            });

            for (const rec of dbRecords) {
              if (!existingIds.has(rec.studentId)) {
                anyChanged = true;
                updatedRows.push(
                  buildRowFromDbRecord(
                    rec,
                    studentMap.get(rec.studentId),
                    selectedSessionNumber
                  )
                );
              }
            }
            return anyChanged ? updatedRows : prev;
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
  }, [
    selectedClassId,
    studentPortalRunning,
    students,
    selectedSessionNumber,
    applyPortalStatusState,
    setRows,
  ]);

  const activeBusyDescription = useMemo(() => {
    if (autoPrepStepProgress) {
      return autoPrepStepProgress;
    }
    if (session14ComboStatus.running) {
      if (session14ComboStatus.currentPhase === "spck") {
        return "[1/2] Đang duyệt và nộp Sản phẩm SPCK (Cột 3) Buổi 14 lên LMS...";
      }
      if (session14ComboStatus.currentPhase === "eval") {
        return "[2/2] Đang duyệt và đẩy Đánh giá tổng kết & Điểm Demo (Cột 2) Buổi 14 lên LMS...";
      }
    }
    if (uploading) {
      return (
        activeActionLabel ||
        `Đang nộp SPCK lên LMS — Buổi ${selectedSessionNumber} (${effectiveSelectedStudentIds.length} bài)...`
      );
    }
    if (uploadingS14EvalLms) {
      return "Đang duyệt và đẩy Đánh giá tổng kết Buổi 14 (Điểm Demo, ĐNL & Thư từ MindX) lên LMS...";
    }
    if (generatingS14EvalAi) {
      return "Đang gọi AI soạn Thư tổng kết 3 phần (Buổi 14) cho học viên...";
    }
    if (importingDemoScores) {
      return "Đang đọc Điểm Demo từ file chấm điểm BGK (.xlsx / Google Sheet)...";
    }
    if (scanning)
      return "Đang quét thư mục sản phẩm trên máy và khớp danh sách học viên...";
    if (generatingAi)
      return "Đang gọi AI soạn nhận xét cuối khóa cho các học viên...";
    if (uploadingDrive)
      return "Đang tải sản phẩm lên Google Drive và tự động gắn link...";
    if (deployingWeb)
      return "Đang đẩy sản phẩm Web lên GitHub Pages và gắn link chạy thử...";
    if (creatingDemoSheet)
      return "Đang tạo Bảng chấm điểm buổi Demo (Buổi 14) trên Google Drive...";
    if (capturingScreenshots)
      return "Đang chụp giao diện App và chọn ảnh bìa (Thumbnail)...";
    if (importingYoutube)
      return "Đang đọc Playlist YouTube, khớp tên học viên và lấy 2 ảnh thuyết trình cho từng bạn...";
    if (scanningTeacherClasses)
      return "Đang quét danh sách lớp từ tài khoản giáo viên...";
    return "";
  }, [
    autoPrepStepProgress,
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
  }> = isRoboticsClass ? DEMO_SCORE_ITEMS_ROBOTICS_UI : DEMO_SCORE_ITEMS_UI;

  const totalStepsCount = 3;

  const isWebClassOrProduct = useMemo(() => {
    const classText = `${selectedClassId} ${selectedClassMeta?.className || ""}`.toUpperCase();
    const hasWebClassCode = /\b(JSB|JSA|JSI|WEB|HTML)[A-Z0-9]*\b/.test(classText);
    const hasNonWebTrackCode = /\b(PTA|PTI|PTB|CSI|CSA|CSB|GMA|GMI|GMB|GA|GB|GI|SB|SA|SI)[A-Z0-9]*\b/.test(
      classText
    );
    const hasHtmlFiles = rows.some(
      (r) =>
        (r.attachments || []).some((f) => /(\.html?|_web_package\.zip)$/i.test(f)) ||
        /github\.io/i.test(r.relatedLinksText || "")
    );
    return hasWebClassCode || (!hasNonWebTrackCode && hasHtmlFiles);
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

  const handleImportYoutubeProducts = async (options?: {
    skipApprovalConfirm?: boolean;
    sourceRows?: ScannedFolderUIItem[];
  }): Promise<{ success: boolean; updatedRows?: ScannedFolderUIItem[] } | void> => {
    if (
      !options?.skipApprovalConfirm &&
      !confirmBeforeDemotingApprovedRows(undefined, options?.sourceRows)
    ) {
      return { success: false, updatedRows: options?.sourceRows || rows };
    }
    return await baseHandleImportYoutubeProducts(options?.sourceRows);
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
    await handleGenerateSession14EvalAi(targetStudentIds);
  };

  const handleSubmitSession14Combo = async (
    targetStudentIds?: string[],
    partToRun: "both" | "spck_only" | "eval_only" = "both"
  ) => {
    if (!selectedClassId) return;
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
        text: "Vui lòng chọn ít nhất 1 học viên để nộp Buổi 14.",
      });
      return;
    }

    if (partToRun === "both") {
      setLastSubmissionSummary(null);
      setBannerMessage(null);
    }

    setSession14ComboStatus((prev) =>
      partToRun === "both"
        ? {
            classId: reqClassId,
            running: true,
            currentPhase: "spck",
            spckSummary: null,
            evalVerifiedCount: 0,
            evalVerifiedStudentIds: [],
            evalFailedCount: 0,
            evalRetryStudentIds: [],
            evalErrorMessage: null,
          }
        : {
            ...prev,
            classId: reqClassId,
            running: true,
            currentPhase: partToRun === "eval_only" ? "eval" : "spck",
          }
    );

    let nextSpckSummary =
      partToRun === "both" ? null : session14ComboStatus.spckSummary;
    let nextEvalVerified =
      partToRun === "both" ? 0 : session14ComboStatus.evalVerifiedCount;
    let nextEvalVerifiedIds =
      partToRun === "both"
        ? []
        : [...(session14ComboStatus.evalVerifiedStudentIds || [])];
    let nextEvalFailed =
      partToRun === "both" ? 0 : session14ComboStatus.evalFailedCount;
    let nextEvalRetryIds =
      partToRun === "both" ? [] : [...session14ComboStatus.evalRetryStudentIds];
    let nextEvalError =
      partToRun === "both" ? null : session14ComboStatus.evalErrorMessage;

    try {
      if (partToRun === "both" || partToRun === "spck_only") {
        setSession14ComboStatus((prev) => ({
          ...prev,
          classId: reqClassId,
          running: true,
          currentPhase: "spck",
        }));
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

        if (partToRun === "spck_only" && session14ComboStatus.spckSummary) {
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

      if (partToRun === "both" || partToRun === "eval_only") {
        setSession14ComboStatus((prev) => ({
          ...prev,
          classId: reqClassId,
          running: true,
          currentPhase: "eval",
          spckSummary: nextSpckSummary,
        }));
        const evalRes = await handleApproveAndUploadSession14Eval(ids);
        if (isStaleClass()) return;
        if (partToRun === "eval_only") {
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
        } else {
          nextEvalVerifiedIds = evalRes.verifiedStudentIds || [];
          nextEvalVerified = evalRes.verifiedCount;
          nextEvalFailed = evalRes.failedCount;
          nextEvalRetryIds = evalRes.retryStudentIds;
          nextEvalError = evalRes.errorMessage;
        }
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
      });

      const spckVerifiedCount = nextSpckSummary?.verifiedItems.length || 0;
      const spckRetryCount = nextSpckSummary?.retryStudentIds.length || 0;
      if (partToRun === "both") {
        const hasAnyIssue =
          spckRetryCount > 0 ||
          nextEvalFailed > 0 ||
          nextEvalRetryIds.length > 0;
        setBannerMessage({
          type: hasAnyIssue ? "warning" : "success",
          text: `Hoàn tất nộp Buổi 14 đầy đủ: Phần Sản phẩm SPCK (Cột 3): ${spckVerifiedCount}/${ids.length} bài thành công${
            spckRetryCount > 0 ? ` (${spckRetryCount} cần thử lại)` : ""
          } • Phần Đánh giá tổng kết & Điểm Demo (Cột 2): ${nextEvalVerified}/${ids.length} bài thành công${
            nextEvalRetryIds.length > 0
              ? ` (${nextEvalRetryIds.length} cần thử lại)`
              : ""
          }.`,
        });
      }
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

  const runAutoPrepAfterScan = async (
    scannedItems: ScannedFolderUIItem[],
    scanClassId: string,
    scanSessionNum: 12 | 13 | 14
  ) => {
    const unapprovedRows = scannedItems.filter(
      (r) =>
        r.assignedStudentId &&
        r.status !== "APPROVED" &&
        r.status !== "VERIFIED" &&
        getSessionSlotDisplay(r, scanSessionNum).state !== "VERIFIED_CURRENT"
    );
    const unapprovedIds = unapprovedRows
      .map((r) => r.assignedStudentId)
      .filter(Boolean);
    if (unapprovedIds.length === 0) return;

    const classMeta = classes.find((c) => c.classId === scanClassId);
    const classText = `${scanClassId} ${classMeta?.className || ""}`.toUpperCase();
    const isRobotics = /\b(ROB|ROBO|ROBOT|ROBOTICS|PREB|PREA|PREI|ARM|ARMA|ARMB|ARMI|SEM|SEMA|SEMB|SEMI|EV3|VEX|SPIKE|WEDO|ARDUINO)[A-Z0-9]*\b/i.test(
      classText
    );
    const isCanvaOrDesign = /\b(CANVA|DESIGN|FIGMA|PHOTOSHOP|ILLUSTRATOR|GRAPHIC)[A-Z0-9]*\b/i.test(
      classText
    );
    const hasWebCode = /\b(JSB|JSA|JSI|WEB|HTML)[A-Z0-9]*\b/.test(classText);
    const hasNonWebTrackCode = /\b(PTA|PTI|PTB|CSI|CSA|CSB|GMA|GMI|GMB|GA|GB|GI|SB|SA|SI)[A-Z0-9]*\b/.test(
      classText
    );
    const hasHtmlFiles = unapprovedRows.some((r) =>
      (r.attachments || []).some((f) => /(\.html?|_web_package\.zip)$/i.test(f))
    );
    const isWeb =
      !isRobotics &&
      !isCanvaOrDesign &&
      (hasWebCode || (!hasNonWebTrackCode && hasHtmlFiles));
    const hasUiOrAppFiles = unapprovedRows.some((r) =>
      (r.attachments || []).some((f) =>
        /(\.(ui|py|sb3|apk|exe|gmx|yyz|rbxl|html?)|_(web|app)_package\.zip)$/i.test(f)
      )
    );
    const hasAppCode = /\b(PTA|PTI|PTB|CSI|CSA|CSB|GMA|GMI|GMB|GA|GB|GI|SB|SA|SI|GAME|APP|PYTHON|SCRATCH)[A-Z0-9]*\b/.test(
      classText
    );
    const shouldCaptureScreenshots =
      !isRobotics && !isCanvaOrDesign && (isWeb || hasAppCode || hasUiOrAppFiles);

    const hasRowFileDrift = (r: ScannedFolderUIItem): boolean =>
      Boolean(
        r.hasNewerSharedResources ||
          Object.values(r.sessionHistory?.sessions || {}).some((s) => s?.hasFileDrift)
      );

    const idsNeedingScreenshots = unapprovedRows
      .filter(
        (r) =>
          hasRowFileDrift(r) ||
          !(
            /_spck_(?:app_shots|owner_media)/i.test(r.thumbnailPath || "") &&
            (r.screenshots || []).length > 0
          )
      )
      .map((r) => r.assignedStudentId)
      .filter(Boolean);

    const idsNeedingWebDeploy = unapprovedRows
      .filter(
        (r) =>
          hasRowFileDrift(r) || !/Link Web Chạy Thử/i.test(r.relatedLinksText || "")
      )
      .map((r) => r.assignedStudentId)
      .filter(Boolean);

    const idsNeedingDriveUpload = unapprovedRows
      .filter(
        (r) =>
          hasRowFileDrift(r) ||
          !/Link Google Drive SPCK/i.test(r.relatedLinksText || "")
      )
      .map((r) => r.assignedStudentId)
      .filter(Boolean);

    let currentRows = scannedItems;
    const steps: Array<{
      label: string;
      run: () => Promise<{ success: boolean; updatedRows?: ScannedFolderUIItem[] } | void>;
    }> = [];

    if (isRobotics && youtubeImportInput.trim()) {
      steps.push({
        label: "Đang nhập Playlist YouTube & lấy 2 ảnh thuyết trình...",
        run: async () =>
          await handleImportYoutubeProducts({
            skipApprovalConfirm: true,
            sourceRows: currentRows,
          }),
      });
    }

    if (shouldCaptureScreenshots && idsNeedingScreenshots.length > 0) {
      steps.push({
        label: isWeb
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
        label: "Đang đẩy sản phẩm Web lên GitHub Pages...",
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
        label: "Đang tải sản phẩm lên Google Drive & gắn link...",
        run: async () =>
          await handleUploadToGoogleDrive(idsNeedingDriveUpload, {
            skipApprovalConfirm: true,
            sourceRows: currentRows,
            classIdOverride: scanClassId,
            sessionOverride: scanSessionNum,
          }),
      });
    }

    if (steps.length === 0) return;

    const stepFailures: string[] = [];
    try {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        setAutoPrepStepProgress(`[${i + 1}/${steps.length}] ${step.label}`);
        try {
          const stepRes = await step.run();
          if (stepRes && Array.isArray(stepRes.updatedRows)) {
            currentRows = stepRes.updatedRows;
          }
          if (stepRes && stepRes.success === false) {
            stepFailures.push(step.label);
          }
        } catch (err) {
          stepFailures.push(
            `${step.label}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
      if (stepFailures.length > 0) {
        setBannerMessage({
          type: "warning",
          text: `Đã chạy công cụ tự động sau khi quét (${steps.length - stepFailures.length}/${steps.length} bước hoàn tất; lỗi: ${stepFailures.join(" | ")}).`,
        });
      }
    } finally {
      setAutoPrepStepProgress(null);
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
    toolErrorsByStudent,
    setStudentToolError,
    expandedRowTabByStudent,
    setRowActiveTab,
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
    isRoboticsClass,
    activeDemoScoreItems,
    totalStepsCount,
    isWebClassOrProduct,
    isAppOrGameProduct,
    toggleSelectStudent,
    toggleExpandRow,
  };
}

export type SpckWorkflowController = ReturnType<typeof useSpckWorkflow>;
