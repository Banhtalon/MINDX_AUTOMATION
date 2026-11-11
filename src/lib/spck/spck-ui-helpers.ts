import type {
  RelatedLinkItem,
  ScannedFolderUIItem,
  Session14CompetencyScoresUI,
  Session14DemoScoresUI,
  SpckRecordRow,
  SpckRowReadinessSummaryUI,
  SpckSessionResultsMapUI,
  SpckSlotDisplayUI,
  StudentOption,
} from "../../components/final-project/types";

export const DEFAULT_SPCK_TAGS = [
  "Hoàn thành tốt sản phẩm cuối khóa",
  "Ý tưởng sáng tạo, giao diện trực quan",
  "Vận dụng vững kiến thức lập trình đã học",
  "Chủ động tìm tòi, xử lý lỗi tốt",
  "Cần trau chuốt thêm phần giao diện và tối ưu code",
  "Thuyết trình tự tin, trình bày rõ ràng mạch lạc",
];

export const SESSION14_SPCK_TAGS = [
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

export const COMPETENCY_ITEMS_UI: Array<{
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

export const DEMO_SCORE_ITEMS_UI: Array<{
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

export const DEMO_SCORE_ITEMS_ROBOTICS_UI: Array<{
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

const spckUiHelpersBundle = {
  DEFAULT_SPCK_TAGS,
  SESSION14_SPCK_TAGS,
  COMPETENCY_ITEMS_UI,
  DEMO_SCORE_ITEMS_UI,
  DEMO_SCORE_ITEMS_ROBOTICS_UI,
  extractSession14TagLabelsFromConfig,
  getStageMeta,
  stripUiSessionSuffix,
  formatUiSessionTitle,
  isDefaultUiProductTitle,
  classifyUiLinkCategory,
  parseJsonSafe,
  parseSessionResultsMap,
  getSessionSlotDisplay,
  serializeRelatedLinksToText,
  parseRelatedLinksFromText,
  parseYoutubeUrlsFromText,
  getRowReadinessSummary,
  buildRowFromDbRecord,
};

if (typeof console !== "undefined" && console && typeof console === "object") {
  (console as unknown as { __mindxSpckUiHelpers?: typeof spckUiHelpersBundle }).__mindxSpckUiHelpers =
    spckUiHelpersBundle;
}
