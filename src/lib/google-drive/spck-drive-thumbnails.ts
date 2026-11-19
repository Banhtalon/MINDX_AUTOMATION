/**
 * MINDX AUTOMATION BOT - GOOGLE DRIVE STUDENT DEMO PHOTO THUMBNAIL SYNC (v3.6.3)
 * Scans a shared Google Drive root folder (containing class subfolders -> student photos),
 * matches the active class & student roster safely, downloads/caches valid student photos into
 * `<studentFolder>/_spck_owner_uploads/thumb_gdrive_<fileId><ext>`, and falls back strictly
 * to the default MindX Logo (`data/config/default-spck-thumbnail.png`) when no photo is found.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  getDb,
  spckSessionRepo,
  spckUploadRepo,
  studentRepo,
  type SpckSessionSlotNumber,
  type SpckUploadRecord,
} from "../db/sqlite";
import { parseMediaBuffer } from "../file-parsers/media-reader";
import {
  DEFAULT_SPCK_THUMBNAIL_PATH,
  MAX_SPCK_SCREENSHOTS,
  extractSpckClassFolderCode,
  resolveDefaultSpckClassFolder,
  resolveStudentFolderInsideClassRoot,
} from "../local-files/spck-scanner";
import {
  downloadDriveFileBufferViaBrowser,
  extractDriveFolderId,
  isRoboticsCourseClassId,
  listDriveFolderItemsReadOnlyViaBrowser,
} from "../playwright/spck-drive-uploader";
import { taskQueue } from "../queue/task-queue";
import { assertPathAllowed } from "../security/path-allowlist";
import {
  type StudentCandidate,
  normalizeVietnameseName,
  normalizeVietnameseNamePreserveTones,
  stripVietnameseDiacritics,
} from "../utils/vietnamese-match";

export const DEFAULT_SPCK_STUDENT_THUMBNAIL_DRIVE_URL =
  "https://drive.google.com/drive/folders/1FmMyv6YkfeJ6mCgSs1_gDxZGyUI3pXvs";

export const DEFAULT_SPCK_STUDENT_THUMBNAIL_FOLDER_ID =
  "1FmMyv6YkfeJ6mCgSs1_gDxZGyUI3pXvs";

export const ACTIVE_GDRIVE_THUMB_MANIFEST = ".active_gdrive_thumb.json";
export const MAX_DRIVE_THUMBNAIL_BYTES = 20 * 1024 * 1024;
const OWNER_UPLOADS_DIR_NAME = "_spck_owner_uploads";
const VALID_DRIVE_IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export interface DriveEntryItem {
  id: string;
  name: string;
  isFolder: boolean;
}

export interface DriveThumbTestProvider {
  listFolder: (folderId: string) => Promise<DriveEntryItem[] | null>;
  downloadFile: (fileId: string) => Promise<Buffer | null>;
}

export interface DrivePhotoStudentMatchResult {
  matchedByStudentId: Map<
    string,
    {
      file: DriveEntryItem;
      tier: "PASS_1A_TONED" | "PASS_1B_ASCII" | "PASS_1C_SINGLE" | "PASS_2_UNIQUE_GIVEN";
      score: number;
      matchWarning?: string;
    }
  >;
  unmatchedFiles: DriveEntryItem[];
  ambiguousWarnings: string[];
  inactiveClaimedFiles: Array<{ fileName: string; studentName: string }>;
}

export interface StudentDriveThumbSyncItemResult {
  studentId: string;
  fullName: string;
  status: "APPLIED_DRIVE" | "CACHED_DRIVE" | "FALLBACK_MINDX_LOGO" | "KEPT_MANUAL_OWNER" | "SKIPPED" | "FAILED";
  thumbnailPath: string;
  matchedFileName?: string;
  driveFileId?: string;
  matchTier?: string;
  matchWarning?: string;
  errorMessage?: string;
}

export interface ClassDriveThumbSyncResult {
  classId: string;
  driveFolderUrl: string;
  driveFolderId: string;
  classSubfolderFound: boolean;
  classSubfolderId?: string;
  classSubfolderName?: string;
  totalProcessed: number;
  matchedFromDriveCount: number;
  downloadedCount: number;
  reusedCachedCount: number;
  fallbackLogoCount: number;
  keptManualOwnerCount: number;
  failedCount: number;
  warnings: string[];
  results: StudentDriveThumbSyncItemResult[];
}

export interface ActiveGdriveThumbManifest {
  version: number;
  status: "ACTIVE" | "NONE";
  activeFileName: string | null;
  fileId?: string;
  sourceFileName?: string;
  updatedAt: string;
}

function assertDriveThumbNotStopped(): void {
  if (
    taskQueue.getStatus().isStopped ||
    (process as unknown as { __mindxQueueStopped?: boolean })?.__mindxQueueStopped === true
  ) {
    throw new Error("Đã dừng đồng bộ ảnh bìa Google Drive theo lệnh Dừng khẩn cấp (Stop Bot).");
  }
}

const HTML_NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  agrave: "à",
  aacute: "á",
  acirc: "â",
  atilde: "ã",
  egrave: "è",
  eacute: "é",
  ecirc: "ê",
  igrave: "ì",
  iacute: "í",
  ograve: "ò",
  oacute: "ó",
  ocirc: "ô",
  otilde: "õ",
  ugrave: "ù",
  uacute: "ú",
  yacute: "ý",
  Agrave: "À",
  Aacute: "Á",
  Acirc: "Â",
  Atilde: "Ã",
  Egrave: "È",
  Eacute: "É",
  Ecirc: "Ê",
  Igrave: "Ì",
  Iacute: "Í",
  Ograve: "Ò",
  Oacute: "Ó",
  Ocirc: "Ô",
  Otilde: "Õ",
  Ugrave: "Ù",
  Uacute: "Ú",
  Yacute: "Ý",
};

export function decodeHtmlEntities(input: string): string {
  return String(input || "")
    .replace(/&([a-zA-Z]+);/g, (full, name) =>
      name in HTML_NAMED_ENTITIES ? HTML_NAMED_ENTITIES[name] : full
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const cp = Number.parseInt(hex, 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : "";
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const cp = Number.parseInt(dec, 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : "";
    });
}

/**
 * Parses Google Drive's `embeddedfolderview?id=<ID>#list` HTML into structured items.
 * Returns:
 * - `DriveEntryItem[]` (including empty `[]`) when the folder is publicly readable (`class="flip-entries"` exists)
 * - `null` when Google Drive returns a login wall, error page, or unexpected HTML (triggers Tier 2 browser fallback).
 */
export function parseDriveEmbeddedFolderHtml(html: string): DriveEntryItem[] | null {
  const raw = String(html || "");
  if (
    !raw ||
    !/class=["'](?:[^"']*\s)?flip-entries(?:\s[^"']*)?["']/i.test(raw)
  ) {
    return null;
  }

  const items: DriveEntryItem[] = [];
  const seenIds = new Set<string>();
  const entryStartRegex =
    /<div\b(?=[^>]*\bclass=["'](?:[^"']*\s)?flip-entry(?:\s[^"']*)?["'])(?=[^>]*\bid=["']entry-([a-zA-Z0-9_-]{10,120})["'])[^>]*>/gi;
  const entryStarts = Array.from(raw.matchAll(entryStartRegex));

  for (let i = 0; i < entryStarts.length; i++) {
    const m = entryStarts[i];
    const id = String(m[1] || "").trim();
    const blockStart = (m.index ?? 0) + m[0].length;
    const blockEnd =
      i + 1 < entryStarts.length
        ? entryStarts[i + 1].index ?? raw.length
        : raw.length;
    const block = raw.slice(blockStart, blockEnd);
    if (!id || seenIds.has(id)) continue;

    const titleMatch = block.match(
      /<div\b[^>]*\bclass=["'](?:[^"']*\s)?flip-entry-title(?:\s[^"']*)?["'][^>]*>([\s\S]*?)<\/div>/i
    );
    const rawTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "") : "";
    const name = decodeHtmlEntities(rawTitle).trim();
    if (!name) continue;

    const isFolderHref =
      new RegExp(`drive\\.google\\.com\\/drive\\/(?:u\\/\\d+\\/)?folders\\/${id}`, "i").test(
        block
      ) || /aria-label=["'][^"']*(?:Folder|Thư mục)[^"']*["']/i.test(block);
    const isFileHref = new RegExp(`drive\\.google\\.com\\/file\\/d\\/${id}`, "i").test(block);
    const isFolder = isFolderHref && !isFileHref;

    seenIds.add(id);
    items.push({ id, name, isFolder });
  }

  return items;
}

export async function listPublicDriveFolderHttp(folderId: string): Promise<DriveEntryItem[] | null> {
  const cleanId = extractDriveFolderId(folderId);
  const url = `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(cleanId)}#list`;
  try {
    const resp = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    if (
      resp.url.includes("accounts.google.com") ||
      /<title>\s*(?:Sign in|Đăng nhập)/i.test(html)
    ) {
      return null;
    }
    return parseDriveEmbeddedFolderHtml(html);
  } catch {
    return null;
  }
}

export function detectImageExtensionFromMagicBytes(buf: Buffer): ".png" | ".jpg" | ".webp" | null {
  if (!buf || buf.length < 16) return null;
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return ".png";
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return ".jpg";
  }
  if (
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return ".webp";
  }
  return null;
}

export function validateDownloadedDriveImageBuffer(
  buf: Buffer,
  fileName: string
): { valid: boolean; detectedExt?: ".png" | ".jpg" | ".webp"; reason?: string } {
  if (!buf || buf.length <= 32) {
    return { valid: false, reason: "Tệp ảnh tải về rỗng hoặc quá nhỏ." };
  }
  if (buf.length > MAX_DRIVE_THUMBNAIL_BYTES) {
    return { valid: false, reason: "Tệp ảnh vượt quá giới hạn 20MB." };
  }
  const detectedExt = detectImageExtensionFromMagicBytes(buf);
  if (!detectedExt) {
    return {
      valid: false,
      reason: `Tệp '${fileName}' không có chữ ký nhị phân ảnh hợp lệ (.png/.jpg/.webp).`,
    };
  }
  const mediaCheck = parseMediaBuffer(buf, `${path.parse(fileName).name}${detectedExt}`, detectedExt);
  if (!mediaCheck.success) {
    return {
      valid: false,
      reason: `Tệp ảnh '${fileName}' bị hỏng cấu trúc (${mediaCheck.errorReason || "PARSE_ERROR"}).`,
    };
  }
  return { valid: true, detectedExt };
}

export async function downloadPublicDriveImageHttp(fileId: string): Promise<Buffer | null> {
  const cleanFileId = String(fileId || "").trim();
  if (!cleanFileId || !/^[a-zA-Z0-9_-]{10,120}$/.test(cleanFileId)) {
    return null;
  }
  const candidateUrls = [
    `https://drive.google.com/uc?export=download&id=${encodeURIComponent(cleanFileId)}&confirm=t`,
    `https://lh3.googleusercontent.com/d/${encodeURIComponent(cleanFileId)}=s0`,
  ];

  for (const url of candidateUrls) {
    try {
      const resp = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(25_000),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        },
      });
      if (!resp.ok) {
        await resp.body?.cancel().catch(() => {});
        continue;
      }
      const contentType = String(resp.headers.get("content-type") || "").toLowerCase();
      if (contentType.includes("text/html") || contentType.includes("svg")) {
        await resp.body?.cancel().catch(() => {});
        continue;
      }
      const contentLengthHeader = Number(resp.headers.get("content-length") || 0);
      if (
        Number.isFinite(contentLengthHeader) &&
        contentLengthHeader > MAX_DRIVE_THUMBNAIL_BYTES
      ) {
        await resp.body?.cancel().catch(() => {});
        continue;
      }

      let buf: Buffer | null = null;
      if (resp.body && typeof resp.body.getReader === "function") {
        const reader = resp.body.getReader();
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        let exceeded = false;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value || value.byteLength === 0) continue;
          totalBytes += value.byteLength;
          if (totalBytes > MAX_DRIVE_THUMBNAIL_BYTES) {
            exceeded = true;
            await reader.cancel().catch(() => {});
            break;
          }
          chunks.push(Buffer.from(value));
        }
        if (exceeded) continue;
        buf = Buffer.concat(chunks, totalBytes);
      } else {
        const arr = await resp.arrayBuffer();
        if (arr.byteLength > MAX_DRIVE_THUMBNAIL_BYTES) continue;
        buf = Buffer.from(arr);
      }

      if (buf && buf.length > 32 && buf.length <= MAX_DRIVE_THUMBNAIL_BYTES) {
        if (detectImageExtensionFromMagicBytes(buf)) {
          return buf;
        }
      }
    } catch {
      // Try next URL
    }
  }
  return null;
}

function normalizeDriveClassFolderCode(rawName: string): {
  hyphenCode: string;
  tokens: string[];
} {
  let clean = stripVietnameseDiacritics(String(rawName || ""))
    .toUpperCase()
    .trim();
  clean = clean.replace(/^(?:LOP|CLASS)\s*[-_:]*\s*/i, "");
  const hyphenCode = clean
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const tokens = hyphenCode.split("-").filter(Boolean);
  return { hyphenCode, tokens };
}

/**
 * Matches a Google Drive subfolder to `classId` using strict token/code boundaries.
 * Prevents cross-class collisions such as `JSB15` vs `JSB16`, `ARMA13` vs `ARMI13`, or `PTA12` vs `PTI12`.
 */
export function matchDriveClassSubfolder(
  classId: string,
  subfolders: DriveEntryItem[]
): DriveEntryItem | null {
  const { shortCode, tailCode, fullCode } = extractSpckClassFolderCode(classId);
  if (!fullCode) return null;

  const onlyFolders = (subfolders || []).filter((item) => item && item.isFolder && item.name);
  if (onlyFolders.length === 0) return null;

  const normalizedFolders = onlyFolders.map((item) => ({
    item,
    ...normalizeDriveClassFolderCode(item.name),
  }));

  const exactCandidates = [fullCode, tailCode, shortCode]
    .map((c) => c.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean);

  for (const targetCode of exactCandidates) {
    const exactMatches = normalizedFolders.filter((f) => f.hyphenCode === targetCode);
    if (exactMatches.length === 1) {
      return exactMatches[0].item;
    }
  }

  // Secondary check: folder name has descriptive text (e.g. "Lớp GA38 - Demo Day")
  // Match strictly on whole token boundary, only when unambiguous.
  for (const targetCode of exactCandidates) {
    const targetTokens = targetCode.split("-").filter(Boolean);
    if (targetTokens.length === 0) continue;
    const tokenBoundaryMatches = normalizedFolders.filter((f) => {
      if (f.tokens.length < targetTokens.length) return false;
      for (let i = 0; i <= f.tokens.length - targetTokens.length; i++) {
        let allEq = true;
        for (let j = 0; j < targetTokens.length; j++) {
          if (f.tokens[i + j] !== targetTokens[j]) {
            allEq = false;
            break;
          }
        }
        if (allEq) return true;
      }
      return false;
    });
    if (tokenBoundaryMatches.length === 1) {
      return tokenBoundaryMatches[0].item;
    }
  }

  return null;
}

/**
 * Cleans a student photo filename on Google Drive into a clean person-name stem
 * while carefully preserving Vietnamese diacritics (e.g. removing `"ảnh"` only with
 * the `ả` diacritic or `"anh bia"`/`"anh hoc vien"` so `"Thế Anh"` is never truncated).
 */
export function cleanDrivePhotoStem(fileName: string, classId?: string): string {
  const ext = path.extname(String(fileName || ""));
  let stem = (ext ? fileName.slice(0, -ext.length) : String(fileName || ""))
    .normalize("NFC")
    .trim();

  // Strip Google Drive duplicate copy suffixes, versioning, separators, and leading sequence indices
  stem = stem
    .replace(/\s*\(\d+\)\s*$/u, "")
    .replace(/[-_|]+/g, " ")
    .replace(/(?:\s+(?:copy|final|edited|edit|ok|v\d+))+$/iu, "")
    .replace(/^\d{1,3}\s*[.\s]+\s*/u, "")
    .replace(/\s+/g, " ")
    .trim();

  // Strip explicit class code prefixes/suffixes
  if (classId) {
    const { shortCode, tailCode, fullCode } = extractSpckClassFolderCode(classId);
    const codeVariants = Array.from(new Set([fullCode, tailCode, shortCode].filter(Boolean))).sort(
      (a, b) => b.length - a.length
    );
    for (const code of codeVariants) {
      const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/-/g, "[-_\\s]*");
      stem = stem
        .replace(new RegExp(`^(?:l[ớo]p\\s*)?${escaped}(?:\\s*[:]\\s*|\\s+|$)`, "iu"), " ")
        .replace(new RegExp(`(?:^|\\s+|\\s*[:]\\s*)(?:l[ớo]p\\s*)?${escaped}$`, "iu"), " ");
    }
  }

  // Strip Vietnamese/English photo label keywords WITHOUT using ASCII `\b` (which breaks on diacritics)
  // and WITHOUT stripping given name "Anh" (only "ảnh" with diacritic `ả` or multi-word phrases).
  const keywordPattern =
    "(?:ảnh\\s*bìa|anh\\s*bia|ảnh\\s*đại\\s*diện|anh\\s*dai\\s*dien|ảnh\\s*học\\s*viên|anh\\s*hoc\\s*vien|ảnh\\s*học\\s*sinh|anh\\s*hoc\\s*sinh|ảnh\\s*cá\\s*nhân|anh\\s*ca\\s*nhan|học\\s*viên|hoc\\s*vien|học\\s*sinh|hoc\\s*sinh|demo\\s*day|thumbnail|thumb|spck|poster|demo|ảnh|lớp|lop|class)";
  const keywordRegex = new RegExp(`(?:^|\\s)${keywordPattern}(?=\\s|$)`, "giu");
  for (let pass = 0; pass < 3; pass++) {
    const next = stem.replace(keywordRegex, " ").replace(/\s+/g, " ").trim();
    if (next === stem) break;
    stem = next;
  }

  return stem;
}

function scoreNameTokenMatch(queryTokens: string[], fullTokens: string[]): number {
  if (queryTokens.length === 0 || fullTokens.length === 0) return 0;

  if (
    queryTokens.length === fullTokens.length &&
    queryTokens.every((t, idx) => t === fullTokens[idx])
  ) {
    return 100;
  }

  if (queryTokens.length >= 2 && queryTokens.length < fullTokens.length) {
    const suffix = fullTokens.slice(-queryTokens.length);
    if (queryTokens.every((t, idx) => t === suffix[idx])) {
      return 96 + Math.min(queryTokens.length, 3);
    }
  }

  // Ordered subsequence ending at the exact last token (given name)
  if (
    queryTokens.length >= 2 &&
    queryTokens[queryTokens.length - 1] === fullTokens[fullTokens.length - 1]
  ) {
    let qIdx = 0;
    for (let fIdx = 0; fIdx < fullTokens.length && qIdx < queryTokens.length; fIdx++) {
      if (fullTokens[fIdx] === queryTokens[qIdx]) {
        qIdx++;
      }
    }
    if (qIdx === queryTokens.length) {
      return 92;
    }
  }

  return 0;
}

/**
 * Matches Google Drive image files to a class's complete student roster (including inactive students,
 * so photos belonging to inactive students never mis-assign to active students sharing a given name).
 */
export function matchDrivePhotosToStudents(
  files: DriveEntryItem[],
  allClassStudents: StudentCandidate[],
  classId?: string
): DrivePhotoStudentMatchResult {
  const imageFiles = (files || [])
    .filter((f) => {
      if (!f || f.isFolder || !f.id || !f.name) return false;
      if (f.name.startsWith(".")) return false;
      if (f.name.toLowerCase() === "default-spck-thumbnail.png") return false;
      const ext = path.extname(f.name).toLowerCase();
      return VALID_DRIVE_IMAGE_EXTS.has(ext);
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en"));

  const preparedStudents = (allClassStudents || [])
    .map((stu) => {
      const tonedTokens = normalizeVietnameseNamePreserveTones(stu.fullName)
        .split(" ")
        .filter(Boolean);
      const asciiTokens = normalizeVietnameseName(stu.fullName)
        .split(" ")
        .filter(Boolean);
      return {
        stu,
        isActive: stu.isActive !== 0,
        tonedTokens,
        asciiTokens,
        tonedGiven: tonedTokens[tonedTokens.length - 1] || "",
        asciiGiven: asciiTokens[asciiTokens.length - 1] || "",
      };
    })
    .filter((s) => s.tonedTokens.length > 0 && s.asciiTokens.length > 0);

  const tonedGivenCount = new Map<string, number>();
  const asciiGivenCount = new Map<string, number>();
  for (const s of preparedStudents) {
    tonedGivenCount.set(s.tonedGiven, (tonedGivenCount.get(s.tonedGiven) || 0) + 1);
    asciiGivenCount.set(s.asciiGiven, (asciiGivenCount.get(s.asciiGiven) || 0) + 1);
  }

  const preparedFiles = imageFiles.map((file) => {
    const cleaned = cleanDrivePhotoStem(file.name, classId);
    const tonedTokens = normalizeVietnameseNamePreserveTones(cleaned)
      .split(" ")
      .filter(Boolean);
    const asciiTokens = normalizeVietnameseName(cleaned).split(" ").filter(Boolean);
    return {
      file,
      cleaned,
      tonedTokens,
      asciiTokens,
      tonedGiven: tonedTokens[tonedTokens.length - 1] || "",
      asciiGiven: asciiTokens[asciiTokens.length - 1] || "",
    };
  });

  const matchedByStudentId: DrivePhotoStudentMatchResult["matchedByStudentId"] = new Map();
  const claimedStudentIds = new Set<string>();
  const claimedFileIds = new Set<string>();
  const ambiguousWarnings: string[] = [];
  const inactiveClaimedFiles: Array<{ fileName: string; studentName: string }> = [];

  const recordMatch = (
    stuEntry: (typeof preparedStudents)[number],
    file: DriveEntryItem,
    tier: "PASS_1A_TONED" | "PASS_1B_ASCII" | "PASS_1C_SINGLE" | "PASS_2_UNIQUE_GIVEN",
    score: number,
    matchWarning?: string
  ) => {
    claimedStudentIds.add(stuEntry.stu.studentId);
    claimedFileIds.add(file.id);
    if (stuEntry.isActive) {
      matchedByStudentId.set(stuEntry.stu.studentId, {
        file,
        tier,
        score,
        matchWarning,
      });
    } else {
      inactiveClaimedFiles.push({
        fileName: file.name,
        studentName: stuEntry.stu.fullName,
      });
    }
  };

  // Pass 1A: Exact / ordered suffix toned Vietnamese match (>= 2 tokens)
  const pass1aCandidates: Array<{
    pf: (typeof preparedFiles)[number];
    stuEntry: (typeof preparedStudents)[number];
    score: number;
  }> = [];

  for (const pf of preparedFiles) {
    if (pf.tonedTokens.length < 2) continue;
    const scored = preparedStudents
      .map((stuEntry) => ({
        stuEntry,
        score: scoreNameTokenMatch(pf.tonedTokens, stuEntry.tonedTokens),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) continue;
    const topScore = scored[0].score;
    const tiedTop = scored.filter((x) => x.score === topScore);
    if (tiedTop.length > 1) {
      ambiguousWarnings.push(
        `Ảnh '${pf.file.name}' khớp trùng nhiều học viên (${tiedTop
          .map((t) => t.stuEntry.stu.fullName)
          .join(", ")}) nên bỏ qua không tự ghép.`
      );
      claimedFileIds.add(pf.file.id);
      continue;
    }
    pass1aCandidates.push({ pf, stuEntry: tiedTop[0].stuEntry, score: topScore });
  }

  pass1aCandidates.sort(
    (a, b) => b.score - a.score || a.pf.file.name.localeCompare(b.pf.file.name, "en")
  );
  for (const cand of pass1aCandidates) {
    if (claimedFileIds.has(cand.pf.file.id) || claimedStudentIds.has(cand.stuEntry.stu.studentId)) {
      continue;
    }
    recordMatch(cand.stuEntry, cand.pf.file, "PASS_1A_TONED", cand.score);
  }

  // Pass 1B: ASCII unaccented multi-token match (>= 2 tokens), checking ambiguity against ALL students
  for (const pf of preparedFiles) {
    if (claimedFileIds.has(pf.file.id) || pf.asciiTokens.length < 2) continue;
    const scoredAll = preparedStudents
      .map((stuEntry) => ({
        stuEntry,
        score: scoreNameTokenMatch(pf.asciiTokens, stuEntry.asciiTokens),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scoredAll.length === 0) continue;
    const topScore = scoredAll[0].score;
    const tiedTop = scoredAll.filter((x) => x.score === topScore);
    if (tiedTop.length > 1) {
      ambiguousWarnings.push(
        `Ảnh không dấu '${pf.file.name}' có thể thuộc nhiều học viên (${tiedTop
          .map((t) => t.stuEntry.stu.fullName)
          .join(", ")}) nên giữ Logo MindX để tránh nhầm.`
      );
      claimedFileIds.add(pf.file.id);
      continue;
    }
    const target = tiedTop[0].stuEntry;
    if (!claimedStudentIds.has(target.stu.studentId)) {
      recordMatch(target, pf.file, "PASS_1B_ASCII", topScore);
    }
  }

  // Pass 1C: Single-token filename (e.g. "Khang.png") ONLY when given name is unique across the entire class
  const remainingSingleFiles = preparedFiles.filter(
    (pf) => !claimedFileIds.has(pf.file.id) && pf.tonedTokens.length === 1
  );
  for (const pf of remainingSingleFiles) {
    const tonedMatches = preparedStudents.filter((s) => s.tonedGiven === pf.tonedGiven);
    if (tonedMatches.length === 1) {
      const sameGivenFiles = remainingSingleFiles.filter(
        (other) => other.tonedGiven === pf.tonedGiven
      );
      if (sameGivenFiles.length === 1 && !claimedStudentIds.has(tonedMatches[0].stu.studentId)) {
        recordMatch(tonedMatches[0], pf.file, "PASS_1C_SINGLE", 88);
      }
      continue;
    }
    if (tonedMatches.length === 0) {
      const asciiMatches = preparedStudents.filter((s) => s.asciiGiven === pf.asciiGiven);
      if (asciiMatches.length === 1) {
        const sameAsciiFiles = remainingSingleFiles.filter(
          (other) => other.asciiGiven === pf.asciiGiven
        );
        if (sameAsciiFiles.length === 1 && !claimedStudentIds.has(asciiMatches[0].stu.studentId)) {
          recordMatch(asciiMatches[0], pf.file, "PASS_1C_SINGLE", 85);
        }
      }
    }
  }

  // Pass 2: Different middle name, unique toned given name across ENTIRE class (active + inactive)
  // e.g. "Tuấn Kiệt.png" -> "Nguyễn Trần Gia Kiệt" when class has only 1 "Kiệt".
  const remainingMultiFiles = preparedFiles.filter(
    (pf) => !claimedFileIds.has(pf.file.id) && pf.tonedTokens.length >= 2
  );
  for (const pf of remainingMultiFiles) {
    if (!pf.tonedGiven) continue;
    if ((tonedGivenCount.get(pf.tonedGiven) || 0) !== 1) continue;

    const sameGivenRemaining = remainingMultiFiles.filter(
      (other) => other.tonedGiven === pf.tonedGiven
    );
    if (sameGivenRemaining.length !== 1) continue;

    const target = preparedStudents.find(
      (s) => s.tonedGiven === pf.tonedGiven && !claimedStudentIds.has(s.stu.studentId)
    );
    if (!target) continue;

    const displayGiven =
      target.stu.fullName.trim().split(/\s+/).pop() || pf.tonedGiven;
    const matchWarning = `Ảnh '${pf.file.name}' trên Drive khác tên đệm nhưng trùng tên chính duy nhất '${displayGiven}' trong lớp (${target.stu.fullName}).`;
    recordMatch(target, pf.file, "PASS_2_UNIQUE_GIVEN", 75, matchWarning);
  }

  const unmatchedFiles = imageFiles.filter((f) => !claimedFileIds.has(f.id));
  return {
    matchedByStudentId,
    unmatchedFiles,
    ambiguousWarnings,
    inactiveClaimedFiles,
  };
}

/**
 * Rejects symlink/junction directories even when the resolved target falls under
 * an allowed local root (preventing cross-student folder redirection).
 */
export function assertSafeRealDirectory(
  dirPath: string,
  expectedParentRealDir?: string
): string {
  const safe = assertPathAllowed(dirPath);
  const lst = fs.lstatSync(safe, { throwIfNoEntry: false });
  if (lst) {
    if (lst.isSymbolicLink()) {
      throw new Error(
        `[Security] Từ chối thư mục liên kết (symlink/junction): ${safe}`
      );
    }
    if (!lst.isDirectory()) {
      throw new Error(`Đường dẫn không phải thư mục hợp lệ: ${safe}`);
    }
    const real = assertPathAllowed(fs.realpathSync(safe));
    if (expectedParentRealDir) {
      const parentReal = fs.realpathSync(expectedParentRealDir);
      const cmpReal = process.platform === "win32" ? real.toLowerCase() : real;
      const cmpParent =
        process.platform === "win32" ? parentReal.toLowerCase() : parentReal;
      const prefix = cmpParent.endsWith(path.sep)
        ? cmpParent
        : `${cmpParent}${path.sep}`;
      if (!cmpReal.startsWith(prefix)) {
        throw new Error(
          `[Security] Thư mục '${safe}' trỏ ra ngoài thư mục học viên '${expectedParentRealDir}'.`
        );
      }
    }
    return real;
  }
  return safe;
}

export function readActiveGdriveThumbManifest(ownerDir: string): ActiveGdriveThumbManifest | null {
  try {
    const safeOwnerDir = assertPathAllowed(ownerDir);
    const ownerStat = fs.lstatSync(safeOwnerDir, { throwIfNoEntry: false });
    if (!ownerStat || ownerStat.isSymbolicLink() || !ownerStat.isDirectory()) {
      return null;
    }
    const manifestPath = assertPathAllowed(path.join(safeOwnerDir, ACTIVE_GDRIVE_THUMB_MANIFEST));
    if (!fs.existsSync(manifestPath) || fs.lstatSync(manifestPath).isSymbolicLink()) {
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as ActiveGdriveThumbManifest;
    if (!raw || (raw.status !== "ACTIVE" && raw.status !== "NONE")) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

export function writeActiveGdriveThumbManifest(
  ownerDir: string,
  manifest: ActiveGdriveThumbManifest,
  expectedParentRealDir?: string
): void {
  const safeOwnerDir = assertSafeRealDirectory(ownerDir, expectedParentRealDir);
  if (!fs.existsSync(safeOwnerDir)) {
    fs.mkdirSync(safeOwnerDir, { recursive: true });
    assertSafeRealDirectory(safeOwnerDir, expectedParentRealDir);
  }
  const manifestPath = assertPathAllowed(path.join(safeOwnerDir, ACTIVE_GDRIVE_THUMB_MANIFEST));
  if (fs.lstatSync(manifestPath, { throwIfNoEntry: false })?.isSymbolicLink()) {
    fs.unlinkSync(manifestPath);
  }
  const tmpPath = `${manifestPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), "utf8");
  fs.renameSync(tmpPath, manifestPath);
}

/**
 * Collects all thumbnail/screenshot paths currently referenced by frozen/verified snapshots
 * (or approved/saving drafts of OTHER sessions) so cleanup never causes `VERIFIED_FILE_DRIFT`.
 */
export function collectProtectedThumbPathsForStudent(params: {
  classId: string;
  studentId: string;
  forceOverwriteSessionNumber?: SpckSessionSlotNumber;
}): Set<string> {
  const protectedLower = new Set<string>();
  const addPath = (rawPath: unknown) => {
    let p = "";
    if (typeof rawPath === "string") {
      p = rawPath.trim();
    } else if (
      rawPath &&
      typeof rawPath === "object" &&
      typeof (rawPath as { path?: unknown }).path === "string"
    ) {
      p = (rawPath as { path: string }).path.trim();
    }
    if (!p) return;
    try {
      protectedLower.add(path.resolve(p).toLowerCase());
    } catch {}
  };
  const addJsonPathList = (rawJson: unknown) => {
    if (!rawJson || typeof rawJson !== "string") return;
    try {
      const arr = JSON.parse(rawJson);
      if (Array.isArray(arr)) {
        for (const item of arr) addPath(item);
      }
    } catch {}
  };
  const addSnapshotPaths = (rawSnap: unknown) => {
    if (!rawSnap || typeof rawSnap !== "string" || rawSnap.trim() === "{}") return;
    try {
      const snap = JSON.parse(rawSnap) as {
        thumbnailPath?: unknown;
        screenshots?: unknown[];
      };
      addPath(snap?.thumbnailPath);
      if (Array.isArray(snap?.screenshots)) {
        for (const sp of snap.screenshots) addPath(sp);
      }
    } catch {}
  };

  const db = getDb();
  const normClassId = String(params.classId || "").trim().toUpperCase();
  const normStuId = String(params.studentId || "").trim();
  if (!normClassId || !normStuId) return protectedLower;

  const sessRows = db
    .prepare(
      `SELECT sessionNumber, draftStatus, lastVerifiedAt, thumbnailPath, screenshotsJson, approvedSnapshotJson, lastVerifiedSnapshotJson
       FROM spck_session_submissions
       WHERE classId = ? AND studentId = ?`
    )
    .all(normClassId, normStuId) as Array<{
    sessionNumber: number;
    draftStatus?: string | null;
    lastVerifiedAt?: string | null;
    thumbnailPath?: string | null;
    screenshotsJson?: string | null;
    approvedSnapshotJson?: string | null;
    lastVerifiedSnapshotJson?: string | null;
  }>;

  for (const sr of sessRows) {
    // Always protect every path inside frozen verified/approved snapshots across all sessions
    addSnapshotPaths(sr.approvedSnapshotJson);
    addSnapshotPaths(sr.lastVerifiedSnapshotJson);

    const status = String(sr.draftStatus || "").toUpperCase();
    const isProtectedState =
      Boolean(sr.lastVerifiedAt) ||
      status === "APPROVED" ||
      status === "SAVING" ||
      status === "VERIFIED";
    const isBeingForceOverwritten =
      Boolean(params.forceOverwriteSessionNumber) &&
      Number(sr.sessionNumber) === Number(params.forceOverwriteSessionNumber) &&
      !sr.lastVerifiedAt;
    if (isProtectedState && !isBeingForceOverwritten) {
      addPath(sr.thumbnailPath);
      addJsonPathList(sr.screenshotsJson);
    }
  }

  return protectedLower;
}

function cleanupObsoleteGdriveThumbFiles(
  ownerDir: string,
  activeFileName: string | null,
  protectedPathsLower: Set<string>,
  expectedParentRealDir?: string
): boolean {
  const safeOwnerDir = assertSafeRealDirectory(ownerDir, expectedParentRealDir);
  if (!fs.existsSync(safeOwnerDir)) return false;
  let keptProtectedLegacy = false;
  const activeLower = activeFileName ? activeFileName.toLowerCase() : "";

  for (const entryName of fs.readdirSync(safeOwnerDir)) {
    const lower = entryName.toLowerCase();
    if (!lower.startsWith("thumb_gdrive_")) continue;
    if (activeLower && lower === activeLower) continue;

    const fullPath = assertPathAllowed(path.join(safeOwnerDir, entryName));
    const resolvedLower = path.resolve(fullPath).toLowerCase();
    if (protectedPathsLower.has(resolvedLower)) {
      keptProtectedLegacy = true;
      continue;
    }
    try {
      if (!fs.lstatSync(fullPath).isSymbolicLink()) {
        fs.unlinkSync(fullPath);
      }
    } catch {
      keptProtectedLegacy = true;
    }
  }

  return keptProtectedLegacy;
}

/**
 * Deactivates any previously cached/downloaded Google Drive thumbnail for a student
 * (for example when the teacher manually uploads a replacement thumbnail).
 * Files referenced by frozen/verified snapshots are retained on disk and marked
 * inactive via `.active_gdrive_thumb.json` (`status: "NONE"`).
 */
export function deactivateGdriveThumbnailForStudent(params: {
  classId: string;
  studentId: string;
  ownerDir: string;
  expectedParentRealDir?: string;
  forceOverwriteSessionNumber?: SpckSessionSlotNumber;
}): void {
  const safeOwnerDir = assertSafeRealDirectory(
    params.ownerDir,
    params.expectedParentRealDir
  );
  if (!fs.existsSync(safeOwnerDir)) return;
  const protectedPathsLower = collectProtectedThumbPathsForStudent({
    classId: params.classId,
    studentId: params.studentId,
    forceOverwriteSessionNumber: params.forceOverwriteSessionNumber,
  });
  const keptLegacy = cleanupObsoleteGdriveThumbFiles(
    safeOwnerDir,
    null,
    protectedPathsLower,
    params.expectedParentRealDir
  );
  if (keptLegacy) {
    writeActiveGdriveThumbManifest(
      safeOwnerDir,
      {
        version: 1,
        status: "NONE",
        activeFileName: null,
        updatedAt: new Date().toISOString(),
      },
      params.expectedParentRealDir
    );
  } else {
    const manifestPath = assertPathAllowed(
      path.join(safeOwnerDir, ACTIVE_GDRIVE_THUMB_MANIFEST)
    );
    try {
      if (
        fs.existsSync(manifestPath) &&
        !fs.lstatSync(manifestPath).isSymbolicLink()
      ) {
        fs.unlinkSync(manifestPath);
      }
    } catch {}
  }
}

function findManualLocalOwnerThumbnail(
  ownerDir: string,
  expectedParentRealDir?: string
): string | null {
  const safeOwnerDir = assertSafeRealDirectory(ownerDir, expectedParentRealDir);
  if (!fs.existsSync(safeOwnerDir) || !fs.statSync(safeOwnerDir).isDirectory()) {
    return null;
  }
  const files = fs
    .readdirSync(safeOwnerDir)
    .filter((f) => {
      const lower = f.toLowerCase();
      if (lower.startsWith(".") || lower.startsWith("thumb_gdrive_")) return false;
      if (!VALID_DRIVE_IMAGE_EXTS.has(path.extname(lower))) return false;
      try {
        const st = fs.lstatSync(path.join(safeOwnerDir, f));
        return !st.isSymbolicLink() && st.isFile();
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.localeCompare(b, "en"));
  const explicitThumb = files.find((f) => /^thumb_/i.test(f));
  const picked = explicitThumb || files[0];
  return picked ? assertPathAllowed(path.join(safeOwnerDir, picked)) : null;
}

function parseScreenshotsArraySafe(rawJson?: string | null): string[] {
  if (!rawJson) return [];
  try {
    const parsed = JSON.parse(rawJson);
    return Array.isArray(parsed)
      ? parsed.map((p) => String(p || "").trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function computeNextGalleryAfterThumbnailChange(params: {
  oldThumbnailPath?: string | null;
  newThumbnailPath: string;
  currentScreenshotsJson?: string | null;
}): string[] {
  const samePath = (a: string, b: string) =>
    path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

  let gallery = parseScreenshotsArraySafe(params.currentScreenshotsJson).filter((p) => {
    if (!p) return false;
    if (samePath(p, params.newThumbnailPath)) return false;
    if (/[\\/]_spck_owner_uploads[\\/]thumb_gdrive_/i.test(p)) return false;
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });

  const prevThumb = String(params.oldThumbnailPath || "").trim();
  if (
    prevThumb &&
    !samePath(prevThumb, params.newThumbnailPath) &&
    /[\\/]_spck_app_shots[\\/]/i.test(prevThumb) &&
    !gallery.some((g) => samePath(g, prevThumb)) &&
    fs.existsSync(prevThumb)
  ) {
    gallery = [prevThumb, ...gallery];
  }

  if (gallery.length > MAX_SPCK_SCREENSHOTS) {
    gallery = gallery.slice(0, MAX_SPCK_SCREENSHOTS);
  }
  return gallery;
}

async function listDriveFolderWithFallback(
  folderId: string,
  classId: string,
  testProvider?: DriveThumbTestProvider
): Promise<DriveEntryItem[]> {
  if (testProvider) {
    const res = await testProvider.listFolder(folderId);
    if (res === null) {
      throw new Error(`Không thể đọc danh sách Google Drive (${folderId}).`);
    }
    return res;
  }

  const tier1 = await listPublicDriveFolderHttp(folderId);
  if (tier1 !== null) {
    return tier1;
  }

  if (process.env.MINDX_DISABLE_BROWSER_EXPORT_FALLBACK === "1") {
    throw new Error(
      `Không thể đọc thư mục Google Drive công khai (${folderId}) trong chế độ kiểm thử.`
    );
  }

  const tier2 = await listDriveFolderItemsReadOnlyViaBrowser(folderId, classId);
  return tier2;
}

async function downloadDriveFileWithFallback(
  fileId: string,
  classId: string,
  testProvider?: DriveThumbTestProvider
): Promise<Buffer> {
  if (testProvider) {
    const buf = await testProvider.downloadFile(fileId);
    if (!buf) {
      throw new Error(`Không thể tải tệp ảnh Drive (${fileId}).`);
    }
    return buf;
  }

  const tier1Buf = await downloadPublicDriveImageHttp(fileId);
  if (tier1Buf) {
    return tier1Buf;
  }

  if (process.env.MINDX_DISABLE_BROWSER_EXPORT_FALLBACK === "1") {
    throw new Error(`Không thể tải tệp ảnh Drive (${fileId}) ở chế độ HTTP công khai.`);
  }

  const tier2Buf = await downloadDriveFileBufferViaBrowser(fileId, classId);
  if (tier2Buf) {
    return tier2Buf;
  }

  throw new Error(
    `Không thể tải tệp ảnh từ Google Drive (ID: ${fileId}). Vui lòng kiểm tra quyền chia sẻ hoặc đăng nhập Google.`
  );
}

function applyDriveThumbnailDbUpdate(params: {
  classId: string;
  row: SpckUploadRecord;
  resolvedThumb: string;
  nextGallery: string[];
  newLocalFolderPath?: string;
  sessionNumber?: SpckSessionSlotNumber;
  allowDemote: boolean;
  forceOverwriteVerifiedSession?: boolean;
}): void {
  const nextScreensJson = JSON.stringify(params.nextGallery);
  const sharedChanged =
    params.row.thumbnailPath !== params.resolvedThumb ||
    (params.row.screenshotsJson || "[]") !== nextScreensJson ||
    Boolean(params.newLocalFolderPath && !params.row.localFolderPath);

  const sessionsMap = spckSessionRepo.findByStudent(params.classId, params.row.studentId);
  const anyUnverifiedSessionNeedsSync = ([12, 13, 14] as const).some((slotNum) => {
    const s = sessionsMap[String(slotNum) as "12" | "13" | "14"];
    if (!s) return false;
    if (s.lastVerifiedAt || s.draftStatus === "APPROVED" || s.draftStatus === "VERIFIED" || s.draftStatus === "SAVING") {
      return false;
    }
    return s.thumbnailPath !== params.resolvedThumb || (s.screenshotsJson || "[]") !== nextScreensJson;
  });

  const targetSlot = params.sessionNumber
    ? sessionsMap[String(params.sessionNumber) as "12" | "13" | "14"]
    : undefined;
  const targetIsAlreadyVerified = Boolean(
    targetSlot && (targetSlot.lastVerifiedAt || targetSlot.draftStatus === "VERIFIED")
  );
  const targetSessionNeedsForceSync = Boolean(
    params.sessionNumber &&
      params.allowDemote &&
      targetSlot &&
      targetSlot.draftStatus !== "SAVING" &&
      (!targetIsAlreadyVerified || params.forceOverwriteVerifiedSession === true) &&
      (targetSlot.thumbnailPath !== params.resolvedThumb ||
        (targetSlot.screenshotsJson || "[]") !== nextScreensJson)
  );

  if (!sharedChanged && !anyUnverifiedSessionNeedsSync && !targetSessionNeedsForceSync) {
    return;
  }

  const upd = spckUploadRepo.updateSharedResources({
    classId: params.classId,
    studentId: params.row.studentId,
    expectedFolderPath: params.row.localFolderPath || undefined,
    localFolderPath: params.newLocalFolderPath,
    thumbnailPath: params.resolvedThumb,
    screenshotsJson: nextScreensJson,
    syncSessionNumber: params.sessionNumber,
    forceSyncTargetSession: targetSessionNeedsForceSync,
    syncAllUnverifiedSessions: true,
  });
  if (!upd.updated) {
    throw new Error(upd.reason || "Không thể cập nhật Thumbnail vào CSDL.");
  }
}

const classDriveSyncTailByClassId = new Map<string, Promise<unknown>>();

export async function syncClassStudentThumbnailsFromGoogleDrive(options: {
  classId: string;
  driveFolderUrl?: string;
  studentIds?: string[];
  sessionNumber?: SpckSessionSlotNumber;
  allowDemoteApprovedSession?: boolean;
  forceOverwriteVerifiedSession?: boolean;
  forceRedownload?: boolean;
  seedMissingActiveStudents?: boolean;
  _testDriveProvider?: DriveThumbTestProvider;
}): Promise<ClassDriveThumbSyncResult> {
  const lockKey = String(options.classId || "").trim().toUpperCase() || "__DEFAULT__";
  const prevTail = classDriveSyncTailByClassId.get(lockKey) || Promise.resolve();
  let nextResult!: Promise<ClassDriveThumbSyncResult>;
  nextResult = prevTail
    .catch(() => {})
    .then(() => syncClassStudentThumbnailsFromGoogleDriveInternal(options));
  const settledMarker = nextResult.then(
    () => undefined,
    () => undefined
  );
  classDriveSyncTailByClassId.set(lockKey, settledMarker);
  settledMarker.finally(() => {
    if (classDriveSyncTailByClassId.get(lockKey) === settledMarker) {
      classDriveSyncTailByClassId.delete(lockKey);
    }
  });
  return nextResult;
}

async function syncClassStudentThumbnailsFromGoogleDriveInternal(options: {
  classId: string;
  driveFolderUrl?: string;
  studentIds?: string[];
  sessionNumber?: SpckSessionSlotNumber;
  allowDemoteApprovedSession?: boolean;
  forceOverwriteVerifiedSession?: boolean;
  forceRedownload?: boolean;
  seedMissingActiveStudents?: boolean;
  _testDriveProvider?: DriveThumbTestProvider;
}): Promise<ClassDriveThumbSyncResult> {
  assertDriveThumbNotStopped();
  const normalizedClassId = String(options.classId || "").trim().toUpperCase();
  if (!normalizedClassId) {
    throw new Error("Thiếu mã lớp (classId) khi đồng bộ ảnh bìa từ Google Drive.");
  }

  const effectiveUrl =
    String(options.driveFolderUrl || "").trim() || DEFAULT_SPCK_STUDENT_THUMBNAIL_DRIVE_URL;
  const rootDriveFolderId = extractDriveFolderId(effectiveUrl);
  const allowDemote = options.allowDemoteApprovedSession !== false;
  const forceRedownload = options.forceRedownload === true;

  // Step 1: Read root Drive folder & locate matching class subfolder BEFORE changing any local files/DB
  const rootEntries = await listDriveFolderWithFallback(
    rootDriveFolderId,
    normalizedClassId,
    options._testDriveProvider
  );
  assertDriveThumbNotStopped();

  let matchedClassFolder = matchDriveClassSubfolder(normalizedClassId, rootEntries);
  let classFolderFiles: DriveEntryItem[] = [];
  if (matchedClassFolder) {
    classFolderFiles = await listDriveFolderWithFallback(
      matchedClassFolder.id,
      normalizedClassId,
      options._testDriveProvider
    );
  } else {
    // Allow teacher to paste a direct class subfolder URL containing student images
    const rootHasStudentImages = rootEntries.some(
      (e) => !e.isFolder && VALID_DRIVE_IMAGE_EXTS.has(path.extname(e.name).toLowerCase())
    );
    if (rootHasStudentImages && rootDriveFolderId !== DEFAULT_SPCK_STUDENT_THUMBNAIL_FOLDER_ID) {
      matchedClassFolder = {
        id: rootDriveFolderId,
        name: normalizedClassId,
        isFolder: true,
      };
      classFolderFiles = rootEntries;
    }
  }

  // Load FULL class roster (both active and inactive) to guard against inactive name stealing
  const allClassStudents = studentRepo.findByClass(normalizedClassId, true);
  const activeStudents = allClassStudents.filter((s) => s.isActive !== 0);
  const studentMap = new Map(allClassStudents.map((s) => [s.studentId, s]));

  const matchResult = matchDrivePhotosToStudents(
    classFolderFiles,
    allClassStudents,
    normalizedClassId
  );

  // Optionally seed Robotics students if no spck_uploads rows exist yet and explicitly requested
  if (
    options.seedMissingActiveStudents &&
    spckUploadRepo.findByClass(normalizedClassId).length === 0 &&
    isRoboticsCourseClassId(normalizedClassId) &&
    activeStudents.length > 0
  ) {
    const safeClassSlug = normalizedClassId.replace(/[^A-Za-z0-9_-]+/g, "_");
    for (const stu of activeStudents) {
      if (!matchResult.matchedByStudentId.has(stu.studentId)) continue;
      const safeStuSlug = stu.studentId.replace(/[^A-Za-z0-9_-]+/g, "_") || "student";
      const stuDir = assertPathAllowed(
        path.resolve(process.cwd(), "data", "spck_youtube", safeClassSlug, safeStuSlug)
      );
      fs.mkdirSync(stuDir, { recursive: true });
      spckUploadRepo.upsert({
        classId: normalizedClassId,
        studentId: stu.studentId,
        localFolderPath: stuDir,
        matchScore: 1,
        isConfirmedByTeacher: 1,
        projectTitle: `SPCK ${stu.fullName}`,
        baseProjectTitle: `SPCK ${stu.fullName}`,
        thumbnailPath: DEFAULT_SPCK_THUMBNAIL_PATH,
        screenshotsJson: "[]",
        attachmentsJson: "[]",
        youtubeUrlsJson: "[]",
        relatedLinksJson: "[]",
        teacherComment: "",
        contentHash: "",
        status: "DRAFT",
      });
    }
  }

  const allDbRows = spckUploadRepo.findByClass(normalizedClassId);
  const targetIdSet =
    options.studentIds && options.studentIds.length > 0
      ? new Set(options.studentIds.map((s) => String(s || "").trim()).filter(Boolean))
      : null;
  const targetRows = targetIdSet
    ? allDbRows.filter((r) => targetIdSet.has(r.studentId))
    : allDbRows;

  const warnings: string[] = [...matchResult.ambiguousWarnings];
  if (!matchedClassFolder) {
    const { shortCode } = extractSpckClassFolderCode(normalizedClassId);
    warnings.push(
      `Chưa tìm thấy thư mục lớp '${shortCode || normalizedClassId}' trên Google Drive Ảnh Học Viên (đã dùng Logo MindX dự phòng cho các bạn chưa có ảnh riêng).`
    );
  }

  const results: StudentDriveThumbSyncItemResult[] = [];
  let matchedFromDriveCount = 0;
  let downloadedCount = 0;
  let reusedCachedCount = 0;
  let fallbackLogoCount = 0;
  let keptManualOwnerCount = 0;
  let failedCount = 0;

  for (const row of targetRows) {
    assertDriveThumbNotStopped();
    const stu = studentMap.get(row.studentId);
    const fullName = stu?.fullName || row.studentId;
    const driveMatch = matchResult.matchedByStudentId.get(row.studentId);
    const protectedPathsLower = collectProtectedThumbPathsForStudent({
      classId: normalizedClassId,
      studentId: row.studentId,
      forceOverwriteSessionNumber: allowDemote ? options.sessionNumber : undefined,
    });

    try {
      let studentFolder = String(row.localFolderPath || "").trim();
      if (!studentFolder && driveMatch) {
        const defaultRoot = resolveDefaultSpckClassFolder(normalizedClassId, {
          createIfMissing: true,
        });
        assertSafeRealDirectory(defaultRoot);
        studentFolder = resolveStudentFolderInsideClassRoot(
          defaultRoot,
          fullName,
          row.studentId
        );
        assertSafeRealDirectory(studentFolder, defaultRoot);
        if (!fs.existsSync(studentFolder)) {
          fs.mkdirSync(assertPathAllowed(studentFolder), { recursive: true });
        }
      }
      const safeStudentFolder = studentFolder
        ? assertSafeRealDirectory(studentFolder)
        : "";
      const ownerDir = safeStudentFolder
        ? assertSafeRealDirectory(
            path.join(safeStudentFolder, OWNER_UPLOADS_DIR_NAME),
            safeStudentFolder
          )
        : "";

      if (driveMatch && ownerDir) {
        matchedFromDriveCount++;
        const safeFileId = driveMatch.file.id.replace(/[^a-zA-Z0-9_-]/g, "");
        if (!safeFileId) {
          throw new Error(`Mã tệp Google Drive không hợp lệ cho '${driveMatch.file.name}'.`);
        }

        const existingExtCandidates = [".png", ".jpg", ".webp"];
        let cachedPath = "";
        if (!forceRedownload && fs.existsSync(ownerDir)) {
          const activeManifest = readActiveGdriveThumbManifest(ownerDir);
          if (
            activeManifest?.status === "ACTIVE" &&
            activeManifest.fileId === driveMatch.file.id &&
            activeManifest.activeFileName
          ) {
            const manifestTarget = assertPathAllowed(
              path.join(ownerDir, path.basename(activeManifest.activeFileName))
            );
            try {
              const st = fs.lstatSync(manifestTarget);
              if (!st.isSymbolicLink() && st.isFile() && st.size > 32) {
                const buf = fs.readFileSync(manifestTarget);
                if (
                  validateDownloadedDriveImageBuffer(
                    buf,
                    activeManifest.activeFileName
                  ).valid
                ) {
                  cachedPath = manifestTarget;
                }
              }
            } catch {}
          }
          if (!cachedPath) {
            for (const candExt of existingExtCandidates) {
              const candidateName = `thumb_gdrive_${safeFileId}${candExt}`;
              const candidateFull = assertPathAllowed(path.join(ownerDir, candidateName));
              try {
                const st = fs.lstatSync(candidateFull);
                if (!st.isSymbolicLink() && st.isFile() && st.size > 32) {
                  const buf = fs.readFileSync(candidateFull);
                  if (validateDownloadedDriveImageBuffer(buf, candidateName).valid) {
                    cachedPath = candidateFull;
                    break;
                  }
                }
              } catch {}
            }
          }
        }

        let finalDriveThumbPath = cachedPath;
        let usedCache = Boolean(cachedPath);
        if (!finalDriveThumbPath) {
          const buf = await downloadDriveFileWithFallback(
            driveMatch.file.id,
            normalizedClassId,
            options._testDriveProvider
          );
          const check = validateDownloadedDriveImageBuffer(buf, driveMatch.file.name);
          if (!check.valid || !check.detectedExt) {
            throw new Error(check.reason || "Ảnh tải từ Google Drive không hợp lệ.");
          }
          if (!fs.existsSync(ownerDir)) {
            fs.mkdirSync(ownerDir, { recursive: true });
          }
          assertSafeRealDirectory(ownerDir, safeStudentFolder);

          const newSha256 = crypto.createHash("sha256").update(buf).digest("hex");
          const sha8 = newSha256.slice(0, 8);
          const baseName = `thumb_gdrive_${safeFileId}${check.detectedExt}`;
          let candidateWritePath = assertPathAllowed(path.join(ownerDir, baseName));

          // Never overwrite a frozen/protected snapshot file on disk (prevents VERIFIED_FILE_DRIFT).
          const isProtectedAndDifferent = (targetPath: string): "REUSE" | "COLLISION" | "WRITE" => {
            const lower = path.resolve(targetPath).toLowerCase();
            if (!protectedPathsLower.has(lower)) {
              return "WRITE";
            }
            const st = fs.lstatSync(targetPath, { throwIfNoEntry: false });
            if (st && !st.isSymbolicLink() && st.isFile()) {
              const existingSha = crypto
                .createHash("sha256")
                .update(fs.readFileSync(targetPath))
                .digest("hex");
              return existingSha === newSha256 ? "REUSE" : "COLLISION";
            }
            return "WRITE";
          };

          let disposition = isProtectedAndDifferent(candidateWritePath);
          if (disposition === "COLLISION") {
            const fallbackSuffixes = [
              sha8,
              newSha256.slice(0, 16),
              newSha256.slice(0, 32),
              `${sha8}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
            ];
            for (const suffix of fallbackSuffixes) {
              const altName = `thumb_gdrive_${safeFileId}_${suffix}${check.detectedExt}`;
              const altPath = assertPathAllowed(path.join(ownerDir, altName));
              const altDisp = isProtectedAndDifferent(altPath);
              if (altDisp !== "COLLISION") {
                candidateWritePath = altPath;
                disposition = altDisp;
                break;
              }
            }
          }

          finalDriveThumbPath = candidateWritePath;
          if (
            disposition === "COLLISION" ||
            (disposition !== "REUSE" &&
              protectedPathsLower.has(path.resolve(finalDriveThumbPath).toLowerCase()))
          ) {
            throw new Error(
              `[Security] Không thể ghi đè tệp ảnh bìa đang được khóa trong lịch sử đã nộp: ${finalDriveThumbPath}`
            );
          }

          if (disposition !== "REUSE") {
            if (fs.lstatSync(finalDriveThumbPath, { throwIfNoEntry: false })?.isSymbolicLink()) {
              fs.unlinkSync(finalDriveThumbPath);
            }
            const tmpPath = `${finalDriveThumbPath}.tmp`;
            if (fs.lstatSync(tmpPath, { throwIfNoEntry: false })) {
              fs.unlinkSync(tmpPath);
            }
            fs.writeFileSync(tmpPath, buf);
            fs.renameSync(tmpPath, finalDriveThumbPath);
          }
          usedCache = false;
          downloadedCount++;
        } else {
          reusedCachedCount++;
        }

        const activeFileName = path.basename(finalDriveThumbPath);
        writeActiveGdriveThumbManifest(
          ownerDir,
          {
            version: 1,
            status: "ACTIVE",
            activeFileName,
            fileId: driveMatch.file.id,
            sourceFileName: driveMatch.file.name,
            updatedAt: new Date().toISOString(),
          },
          safeStudentFolder
        );
        cleanupObsoleteGdriveThumbFiles(
          ownerDir,
          activeFileName,
          protectedPathsLower,
          safeStudentFolder
        );

        const nextGallery = computeNextGalleryAfterThumbnailChange({
          oldThumbnailPath: row.thumbnailPath,
          newThumbnailPath: finalDriveThumbPath,
          currentScreenshotsJson: row.screenshotsJson,
        });

        applyDriveThumbnailDbUpdate({
          classId: normalizedClassId,
          row,
          resolvedThumb: finalDriveThumbPath,
          nextGallery,
          newLocalFolderPath: row.localFolderPath ? undefined : safeStudentFolder,
          sessionNumber: options.sessionNumber,
          allowDemote,
          forceOverwriteVerifiedSession: options.forceOverwriteVerifiedSession === true,
        });

        if (driveMatch.matchWarning) {
          warnings.push(driveMatch.matchWarning);
        }

        results.push({
          studentId: row.studentId,
          fullName,
          status: usedCache ? "CACHED_DRIVE" : "APPLIED_DRIVE",
          thumbnailPath: finalDriveThumbPath,
          matchedFileName: driveMatch.file.name,
          driveFileId: driveMatch.file.id,
          matchTier: driveMatch.tier,
          matchWarning: driveMatch.matchWarning,
        });
      } else {
        // No matching Drive photo for this student
        if (ownerDir && fs.existsSync(ownerDir)) {
          const keptLegacy = cleanupObsoleteGdriveThumbFiles(
            ownerDir,
            null,
            protectedPathsLower,
            safeStudentFolder
          );
          if (keptLegacy) {
            writeActiveGdriveThumbManifest(
              ownerDir,
              {
                version: 1,
                status: "NONE",
                activeFileName: null,
                updatedAt: new Date().toISOString(),
              },
              safeStudentFolder
            );
          } else {
            const manifestPath = path.join(ownerDir, ACTIVE_GDRIVE_THUMB_MANIFEST);
            try {
              if (
                fs.existsSync(manifestPath) &&
                !fs.lstatSync(manifestPath).isSymbolicLink()
              ) {
                fs.unlinkSync(manifestPath);
              }
            } catch {}
          }
        }

        const manualOwnerThumb = ownerDir
          ? findManualLocalOwnerThumbnail(ownerDir, safeStudentFolder)
          : null;
        const resolvedThumb = manualOwnerThumb || DEFAULT_SPCK_THUMBNAIL_PATH;
        const nextGallery = computeNextGalleryAfterThumbnailChange({
          oldThumbnailPath: row.thumbnailPath,
          newThumbnailPath: resolvedThumb,
          currentScreenshotsJson: row.screenshotsJson,
        });

        applyDriveThumbnailDbUpdate({
          classId: normalizedClassId,
          row,
          resolvedThumb,
          nextGallery,
          sessionNumber: options.sessionNumber,
          allowDemote,
          forceOverwriteVerifiedSession: options.forceOverwriteVerifiedSession === true,
        });

        if (manualOwnerThumb) {
          keptManualOwnerCount++;
        } else {
          fallbackLogoCount++;
        }

        results.push({
          studentId: row.studentId,
          fullName,
          status: manualOwnerThumb ? "KEPT_MANUAL_OWNER" : "FALLBACK_MINDX_LOGO",
          thumbnailPath: resolvedThumb,
        });
      }
    } catch (err) {
      failedCount++;
      results.push({
        studentId: row.studentId,
        fullName,
        status: "FAILED",
        thumbnailPath: row.thumbnailPath || DEFAULT_SPCK_THUMBNAIL_PATH,
        matchedFileName: driveMatch?.file.name,
        driveFileId: driveMatch?.file.id,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    classId: normalizedClassId,
    driveFolderUrl: effectiveUrl,
    driveFolderId: rootDriveFolderId,
    classSubfolderFound: Boolean(matchedClassFolder),
    classSubfolderId: matchedClassFolder?.id,
    classSubfolderName: matchedClassFolder?.name,
    totalProcessed: targetRows.length,
    matchedFromDriveCount,
    downloadedCount,
    reusedCachedCount,
    fallbackLogoCount,
    keptManualOwnerCount,
    failedCount,
    warnings: Array.from(new Set(warnings)),
    results,
  };
}
