/**
 * MINDX AUTOMATION BOT - SPCK LOCAL DIRECTORY SCANNER & VALIDATOR
 * Phase 6 (TASK-6.2): Scans local SPCK class/student folders under Path Allowlist protection,
 * classifies Thumbnail, Screenshots (max 10), Attachments (max 10), Youtube URLs (max 5),
 * Related Links (max 5), and enforces projectTitle <= 100 chars.
 */

import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { normalizeSpckFolderKey, spckUploadRepo } from "../db/sqlite";
import { parseZipArchiveBuffer } from "../file-parsers/archive-reader";
import { parseGameMakerBuffer, parseScratchSb3Buffer } from "../file-parsers/game-reader";
import { parseMediaBuffer } from "../file-parsers/media-reader";
import { assertPathAllowed } from "../security/path-allowlist";
import {
  FolderStudentMatchResult,
  StudentCandidate,
  matchFoldersToStudents,
  stripVietnameseDiacritics,
} from "../utils/vietnamese-match";

export const MAX_SPCK_TITLE_LENGTH = 100;
export const MAX_SPCK_SCREENSHOTS = 10;
export const MAX_SPCK_ATTACHMENTS = 10;
export const MAX_SPCK_YOUTUBE_URLS = 5;
export const MAX_SPCK_RELATED_LINKS = 5;

export const ALLOWED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  ".py",
  ".ipynb",
  ".ui",
  ".qss",
  ".zip",
  ".sb3",
  ".yyz",
  ".gml",
  ".yy",
  ".html",
  ".css",
  ".js",
  ".pptx",
  ".pdf",
  ".docx",
  ".txt",
  ".sql",
  ".json",
]);

export const ROBOTICS_RAW_EXTENSIONS = new Set([
  ".ev3",
  ".llsp",
  ".llsp3",
  ".lms",
  ".rbf",
  ".rbt",
  ".io",
  ".lxf",
  ".ldr",
  ".mpd",
  ".stl",
  ".obj",
  ".ino",
  ".hex",
  ".uf2",
  ".mblock",
  ".vex",
  ".v5python",
  ".v5blocks",
]);

export const ROBOTICS_ZIP_CONTAINER_EXTENSIONS = new Set([
  ".ev3",
  ".llsp",
  ".llsp3",
  ".io",
  ".lxf",
  ".mblock",
]);

export type SpckRelatedLinkCategory = "LIVE_PRODUCT" | "SOURCE_DOWNLOAD" | "OTHER_DOC";

export interface SpckRelatedLink {
  name: string;
  url: string;
  category?: SpckRelatedLinkCategory;
  categoryLabel?: string;
}

export type SpckThumbnailSourceType =
  | "TEACHER_UPLOADED"
  | "PRODUCT_IMAGE"
  | "APP_SCREENSHOT"
  | "RECONSTRUCTED_APP_SHOT"
  | "DEFAULT_MINDX_LOGO";

export interface SpckThumbnailInspection {
  thumbnailPath: string;
  sourceType: SpckThumbnailSourceType;
  isDefaultMindxLogo: boolean;
  badgeLabel: string;
  width: number | null;
  height: number | null;
  aspectRatio: number | null;
  is16By9: boolean;
  aspectRatioLabel: string;
  qualityWarning: string | null;
}

export function classifySpckRelatedLink(link: {
  name?: string | null;
  url?: string | null;
}): {
  category: SpckRelatedLinkCategory;
  categoryLabel: string;
} {
  const urlStr = String(link?.url || "").trim().toLowerCase();
  const nameStr = stripVietnameseDiacritics(String(link?.name || "").trim()).toLowerCase();

  if (
    /\.github\.io\b|\.vercel\.app\b|\.netlify\.app\b|\.pages\.dev\b|\.web\.app\b|\.firebaseapp\.com\b|scratch\.mit\.edu\/projects\/|replit\.com\/|repl\.co\b|codepen\.io\/|itch\.io\/|makecode\.com\/|tinkercad\.com\/|figma\.com\/proto/i.test(
      urlStr
    ) ||
    /(?:chay\s*thu|live\s*demo|web\s*demo|su\s*dung\s*san\s*pham|trai\s*nghiem|choi\s*thu)/i.test(
      nameStr
    )
  ) {
    return {
      category: "LIVE_PRODUCT",
      categoryLabel: "Chạy thử sản phẩm",
    };
  }

  if (
    /drive\.google\.com\/|github\.com\/|gitlab\.com\/|dropbox\.com\/|onedrive\.live\.com\/|1drv\.ms\/|mega\.nz\//i.test(
      urlStr
    ) ||
    /(?:ma\s*nguon|source\s*code|tai\s*xuong|download|google\s*drive|thu\s*muc\s*drive)/i.test(
      nameStr
    )
  ) {
    return {
      category: "SOURCE_DOWNLOAD",
      categoryLabel: "Mã nguồn/Tải xuống",
    };
  }

  return {
    category: "OTHER_DOC",
    categoryLabel: "Tài liệu khác",
  };
}

export function extractImageDimensionsFromBuffer(
  buf: Buffer,
  ext: string
): { width: number; height: number } | null {
  if (!buf || buf.length < 24) return null;
  const lowerExt = (ext || "").toLowerCase();

  // PNG
  if (
    lowerExt === ".png" ||
    (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
  ) {
    if (buf.length >= 24) {
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      if (width > 0 && height > 0) return { width, height };
    }
  }

  // JPEG
  if (lowerExt === ".jpg" || lowerExt === ".jpeg" || (buf[0] === 0xff && buf[1] === 0xd8)) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buf[offset + 1];
      if (marker === 0xff) {
        offset++;
        continue;
      }
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        offset += 2;
        continue;
      }
      if (offset + 4 > buf.length) break;
      const segLen = buf.readUInt16BE(offset + 2);
      if (segLen < 2) break;
      const isSof =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isSof && offset + 9 <= buf.length) {
        const height = buf.readUInt16BE(offset + 5);
        const width = buf.readUInt16BE(offset + 7);
        if (width > 0 && height > 0) return { width, height };
      }
      offset += 2 + segLen;
    }
  }

  // WebP
  if (
    lowerExt === ".webp" ||
    (buf.length >= 30 &&
      buf.toString("ascii", 0, 4) === "RIFF" &&
      buf.toString("ascii", 8, 12) === "WEBP")
  ) {
    const chunkType = buf.toString("ascii", 12, 16);
    if (chunkType === "VP8 " && buf.length >= 30) {
      const width = buf.readUInt16LE(26) & 0x3fff;
      const height = buf.readUInt16LE(28) & 0x3fff;
      if (width > 0 && height > 0) return { width, height };
    } else if (chunkType === "VP8L" && buf.length >= 25) {
      const b0 = buf[21];
      const b1 = buf[22];
      const b2 = buf[23];
      const b3 = buf[24];
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      if (width > 0 && height > 0) return { width, height };
    } else if (chunkType === "VP8X" && buf.length >= 30) {
      const width = 1 + buf.readUIntLE(24, 3);
      const height = 1 + buf.readUIntLE(27, 3);
      if (width > 0 && height > 0) return { width, height };
    }
  }

  return null;
}

export function inspectSpckThumbnail(rawThumbnailPath?: string | null): SpckThumbnailInspection {
  const trimmed = String(rawThumbnailPath || "").trim();
  const defaultLogoPath = path.resolve(process.cwd(), "data", "config", "default-spck-thumbnail.png");

  const isDefaultLogo =
    !trimmed ||
    path.basename(trimmed).toLowerCase() === "default-spck-thumbnail.png" ||
    path.resolve(trimmed).toLowerCase() === defaultLogoPath.toLowerCase();

  if (isDefaultLogo) {
    return {
      thumbnailPath: trimmed || defaultLogoPath,
      sourceType: "DEFAULT_MINDX_LOGO",
      isDefaultMindxLogo: true,
      badgeLabel: "Ảnh mặc định — nên bổ sung ảnh sản phẩm",
      width: null,
      height: null,
      aspectRatio: null,
      is16By9: false,
      aspectRatioLabel: "Logo mặc định",
      qualityWarning: "Ảnh mặc định — nên bổ sung ảnh sản phẩm",
    };
  }

  let sourceType: SpckThumbnailSourceType = "PRODUCT_IMAGE";
  if (/[\\/]_spck_owner_uploads[\\/]/i.test(trimmed)) {
    sourceType = "TEACHER_UPLOADED";
  } else if (/[\\/]_spck_app_shots[\\/]/i.test(trimmed)) {
    const baseLower = path.basename(trimmed).toLowerCase();
    if (/(?:synthetic|reconstruct|fallback|phuc[_-]?dung)/i.test(baseLower)) {
      sourceType = "RECONSTRUCTED_APP_SHOT";
    } else {
      sourceType = "APP_SCREENSHOT";
    }
  }

  let width: number | null = null;
  let height: number | null = null;
  try {
    const safe = assertPathAllowed(trimmed);
    if (fs.existsSync(safe) && fs.statSync(safe).isFile()) {
      const buf = fs.readFileSync(safe);
      const dims = extractImageDimensionsFromBuffer(buf, path.extname(safe));
      if (dims) {
        width = dims.width;
        height = dims.height;
      }
    }
  } catch {}

  const aspectRatio = width && height ? width / height : null;
  const is16By9 = aspectRatio !== null ? Math.abs(aspectRatio - 16 / 9) <= 0.16 : false;
  const is4By3 = aspectRatio !== null ? Math.abs(aspectRatio - 4 / 3) <= 0.1 : false;
  const aspectRatioLabel =
    width && height
      ? is16By9
        ? `16:9 (${width}×${height})`
        : is4By3
        ? `4:3 (${width}×${height})`
        : `${width}×${height}`
      : "Chưa rõ kích thước";

  const warnings: string[] = [];
  if (sourceType === "RECONSTRUCTED_APP_SHOT") {
    warnings.push("Ảnh giao diện phục dựng");
  }
  if (aspectRatio !== null && !is16By9) {
    warnings.push(`Khác tỷ lệ 16:9 (${width}×${height})`);
  }

  return {
    thumbnailPath: trimmed,
    sourceType,
    isDefaultMindxLogo: false,
    badgeLabel: is16By9
      ? `Ảnh sản phẩm 16:9 (${width}×${height})`
      : warnings.length > 0
      ? warnings.join(" • ")
      : aspectRatioLabel,
    width,
    height,
    aspectRatio,
    is16By9,
    aspectRatioLabel,
    qualityWarning: warnings.length > 0 ? warnings.join(" • ") : null,
  };
}

export function validateSpckResourceLimits(params: {
  screenshots?: unknown[];
  attachments?: unknown[];
  youtubeUrls?: unknown[];
  relatedLinks?: unknown[];
}): { valid: boolean; reason?: string } {
  if (Array.isArray(params.screenshots) && params.screenshots.length > MAX_SPCK_SCREENSHOTS) {
    return {
      valid: false,
      reason: `Số lượng ảnh sản phẩm vượt quá giới hạn LMS (${params.screenshots.length}/${MAX_SPCK_SCREENSHOTS} ảnh). Vui lòng bỏ bớt thay vì cắt tự động.`,
    };
  }
  if (Array.isArray(params.attachments) && params.attachments.length > MAX_SPCK_ATTACHMENTS) {
    return {
      valid: false,
      reason: `Số lượng tài liệu đính kèm vượt quá giới hạn LMS (${params.attachments.length}/${MAX_SPCK_ATTACHMENTS} tệp). Vui lòng bỏ bớt hoặc gom vào file .zip.`,
    };
  }
  if (Array.isArray(params.youtubeUrls) && params.youtubeUrls.length > MAX_SPCK_YOUTUBE_URLS) {
    return {
      valid: false,
      reason: `Số lượng link YouTube vượt quá giới hạn LMS (${params.youtubeUrls.length}/${MAX_SPCK_YOUTUBE_URLS} link).`,
    };
  }
  if (Array.isArray(params.relatedLinks) && params.relatedLinks.length > MAX_SPCK_RELATED_LINKS) {
    return {
      valid: false,
      reason: `Số lượng đường dẫn liên quan vượt quá giới hạn LMS (${params.relatedLinks.length}/${MAX_SPCK_RELATED_LINKS} link).`,
    };
  }
  return { valid: true };
}

export interface ParsedLinksFileResult {
  customTitle?: string;
  youtubeUrls: string[];
  relatedLinks: SpckRelatedLink[];
  allYoutubeUrls?: string[];
  allRelatedLinks?: SpckRelatedLink[];
  warnings: string[];
}

export type SpckPackageThumbnailSource =
  | "OWNER_UPLOAD"
  | "OWNER_ROOT_PHOTO"
  | "AUTO_IMAGE"
  | "DEFAULT_LOGO";

export interface StudentSpckPackage {
  folderName: string;
  folderPath: string;
  projectTitle: string;
  rawProjectTitle?: string;
  thumbnailPath: string;
  thumbnailInspection?: SpckThumbnailInspection;
  /** Where the chosen Thumbnail comes from (Owner photos always win over auto screenshots). */
  thumbnailSource?: SpckPackageThumbnailSource;
  /** All Owner-provided photos found (owner uploads + unreferenced root photos), in priority order. */
  ownerPhotos?: string[];
  screenshots: string[];
  attachments: string[];
  youtubeUrls: string[];
  relatedLinks: SpckRelatedLink[];
  allScreenshots?: string[];
  allAttachments?: string[];
  allYoutubeUrls?: string[];
  allRelatedLinks?: SpckRelatedLink[];
  warnings: string[];
}

export interface ScannedClassSpckItem {
  folderName: string;
  folderPath: string;
  match: FolderStudentMatchResult;
  packageData: StudentSpckPackage;
}

export interface ScanClassSpckDirectoryResult {
  classId: string;
  rootFolderPath: string;
  scannedAt: string;
  totalFolders: number;
  items: ScannedClassSpckItem[];
}

export function getDefaultMindxLogoThumbnailPath(): string {
  return path.resolve(process.cwd(), "data", "config", "default-spck-thumbnail.png");
}

export const DEFAULT_SPCK_THUMBNAIL_PATH = getDefaultMindxLogoThumbnailPath();

/**
 * Normalizes project title whitespace and falls back to `SPCK <Name>` when empty.
 * Does NOT silently slice titles > 100 chars so `validateSpckTitleLength` can reject over-limit titles explicitly.
 */
export function sanitizeSpckTitle(rawTitle: string, fallbackName: string): string {
  const cleaned = (rawTitle || "").replace(/\s+/g, " ").trim();
  const base = cleaned || `SPCK ${(fallbackName || "Học Viên").replace(/\s+/g, " ").trim()}`;
  return base;
}

/**
 * Checks whether a hostname belongs to YouTube.
 */
export function isYoutubeHostname(hostname: string): boolean {
  const host = (hostname || "").toLowerCase().replace(/^www\./, "");
  return (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "youtu.be" ||
    host === "studio.youtube.com" ||
    host.endsWith(".youtube.com")
  );
}

/**
 * Validates that a YouTube URL uses HTTP(S) and a valid YouTube hostname.
 */
export function validateSpckYoutubeUrl(rawUrl: string): {
  valid: boolean;
  normalizedUrl?: string;
  reason?: string;
} {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) {
    return { valid: false, reason: "Đường dẫn YouTube rỗng." };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        valid: false,
        reason: `Đường dẫn YouTube '${trimmed}' sử dụng giao thức không hợp lệ (${parsed.protocol}). Chỉ chấp nhận http/https.`,
      };
    }
    if (!isYoutubeHostname(parsed.hostname)) {
      return {
        valid: false,
        reason: `Đường dẫn '${trimmed}' không thuộc tên miền YouTube hợp lệ.`,
      };
    }
    return { valid: true, normalizedUrl: parsed.toString() };
  } catch {
    return {
      valid: false,
      reason: `Đường dẫn YouTube '${trimmed}' không phải URL hợp lệ.`,
    };
  }
}

/**
 * Validates that a Related Link URL uses HTTP(S).
 */
export function validateSpckRelatedUrl(rawUrl: string): {
  valid: boolean;
  normalizedUrl?: string;
  reason?: string;
} {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) {
    return { valid: false, reason: "Đường dẫn liên quan rỗng." };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        valid: false,
        reason: `Đường dẫn liên quan '${trimmed}' sử dụng giao thức không hợp lệ (${parsed.protocol}). Chỉ chấp nhận http/https.`,
      };
    }
    return { valid: true, normalizedUrl: parsed.toString() };
  } catch {
    return {
      valid: false,
      reason: `Đường dẫn liên quan '${trimmed}' không phải URL hợp lệ.`,
    };
  }
}

/**
 * Validates that an attachment file is in ALLOWED_ATTACHMENT_EXTENSIONS and has valid binary/package structure.
 */
export function validateSpckAttachmentFile(fullEntryPath: string): {
  valid: boolean;
  reason?: string;
} {
  const safePath = assertPathAllowed(fullEntryPath);
  if (!fs.existsSync(safePath)) {
    return { valid: false, reason: `Không tìm thấy tài liệu đính kèm trên ổ cứng: '${fullEntryPath}'` };
  }
  let lstat: fs.Stats;
  try {
    lstat = fs.lstatSync(safePath);
  } catch {
    return { valid: false, reason: `Không thể đọc thuộc tính file đính kèm: '${fullEntryPath}'` };
  }
  if (lstat.isSymbolicLink() || !lstat.isFile()) {
    return { valid: false, reason: `Tài liệu đính kèm '${path.basename(safePath)}' không phải là file hợp lệ.` };
  }
  if (lstat.size === 0) {
    return { valid: false, reason: `Tài liệu đính kèm '${path.basename(safePath)}' rỗng (0 bytes) nên bị bỏ qua.` };
  }
  const fileName = path.basename(safePath);
  const ext = path.extname(fileName).toLowerCase();
  if (!ALLOWED_ATTACHMENT_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      reason: `File '${fileName}' có phần mở rộng '${ext}' không nằm trong danh mục hỗ trợ của LMS.`,
    };
  }

  const buf = fs.readFileSync(safePath);
  if (ext === ".pdf") {
    const pdfCheck = parseMediaBuffer(buf, fileName, ext);
    if (!pdfCheck.success) {
      return {
        valid: false,
        reason: `Tài liệu PDF '${fileName}' bị hỏng cấu trúc nên bị loại bỏ: ${pdfCheck.errorReason || "PARSE_ERROR"}`,
      };
    }
  } else if (ext === ".zip") {
    const zipCheck = parseZipArchiveBuffer(buf, fileName);
    if (!zipCheck.success) {
      return {
        valid: false,
        reason: `Gói nén ZIP '${fileName}' bị hỏng cấu trúc: ${zipCheck.errorReason || "PARSE_ERROR"}`,
      };
    }
  } else if (ext === ".sb3") {
    const sb3Check = parseScratchSb3Buffer(buf, fileName);
    if (!sb3Check.success) {
      return {
        valid: false,
        reason: `Gói Scratch '${fileName}' bị hỏng cấu trúc: ${sb3Check.errorReason || "PARSE_ERROR"}`,
      };
    }
  } else if (ext === ".yyz") {
    const yyzCheck = parseGameMakerBuffer(buf, fileName, ".yyz");
    if (!yyzCheck.success) {
      return {
        valid: false,
        reason: `Gói GameMaker '${fileName}' bị hỏng cấu trúc: ${yyzCheck.errorReason || "PARSE_ERROR"}`,
      };
    }
  } else if (ext === ".docx" || ext === ".pptx") {
    const hasZipSignature =
      buf.length >= 4 &&
      buf[0] === 0x50 &&
      buf[1] === 0x4b &&
      buf[2] === 0x03 &&
      buf[3] === 0x04;
    if (!hasZipSignature) {
      return {
        valid: false,
        reason: `Tài liệu Office '${fileName}' thiếu chữ ký gói OpenXML (PK\\x03\\x04).`,
      };
    }
    try {
      const zip = new AdmZip(buf);
      const entries = zip.getEntries().map((e) => e.entryName.replace(/\\/g, "/"));
      const hasContentTypes = entries.includes("[Content_Types].xml");
      const expectedPrefix = ext === ".docx" ? "word/" : "ppt/";
      const hasMainFolder = entries.some((name) => name.startsWith(expectedPrefix));
      if (!hasContentTypes || !hasMainFolder) {
        return {
          valid: false,
          reason: `Tài liệu Office '${fileName}' thiếu cấu trúc '${expectedPrefix}' hoặc '[Content_Types].xml'.`,
        };
      }
    } catch (err) {
      return {
        valid: false,
        reason: `Tài liệu Office '${fileName}' không thể giải nén OpenXML: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  }

  return { valid: true };
}

/**
 * Parses the content of a `links.txt` file into YouTube URLs (max 5) and Related Links (max 5).
 */
export function parseLinksTxtContent(rawText: string): ParsedLinksFileResult {
  const youtubeUrls: string[] = [];
  const relatedLinks: SpckRelatedLink[] = [];
  const allYoutubeUrls: string[] = [];
  const allRelatedLinks: SpckRelatedLink[] = [];
  const warnings: string[] = [];
  let customTitle: string | undefined;

  const seenYoutube = new Set<string>();
  const seenRelated = new Set<string>();

  const lines = (rawText || "").split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) {
      continue;
    }

    // Optional custom title directive: "Title: ..." or "Tiêu đề: ..."
    const titleMatch = line.match(/^(?:title|tieu\s*de|tiêu\s*đề)\s*:\s*(.+)$/i);
    if (titleMatch && ! /^https?:\/\//i.test(titleMatch[1].trim())) {
      customTitle = titleMatch[1].trim();
      continue;
    }

    // Markdown link [Label](https://...)
    let explicitLabel = "";
    let candidateUrl = line;

    const mdMatch = line.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/i);
    if (mdMatch) {
      explicitLabel = mdMatch[1].trim();
      candidateUrl = mdMatch[2].trim();
    } else if (line.includes("|")) {
      const parts = line.split("|");
      const lastPart = parts[parts.length - 1].trim();
      if (/^https?:\/\//i.test(lastPart)) {
        explicitLabel = parts.slice(0, -1).join("|").trim();
        candidateUrl = lastPart;
      }
    } else {
      const colonUrlMatch = line.match(/^([^:]+):\s*(https?:\/\/\S+)$/i);
      if (colonUrlMatch && !/^https?$/i.test(colonUrlMatch[1].trim())) {
        explicitLabel = colonUrlMatch[1].trim();
        candidateUrl = colonUrlMatch[2].trim();
      }
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(candidateUrl);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        warnings.push(`Dòng ${i + 1} trong links.txt có giao thức không hợp lệ: '${line}'`);
        continue;
      }
    } catch {
      warnings.push(`Dòng ${i + 1} trong links.txt không phải URL hợp lệ: '${line}'`);
      continue;
    }

    const normalizedHref = parsedUrl.toString();

    if (isYoutubeHostname(parsedUrl.hostname)) {
      if (seenYoutube.has(normalizedHref)) continue;
      seenYoutube.add(normalizedHref);
      allYoutubeUrls.push(normalizedHref);
      if (youtubeUrls.length >= MAX_SPCK_YOUTUBE_URLS) {
        warnings.push(
          `Vượt quá giới hạn ${MAX_SPCK_YOUTUBE_URLS} link YouTube trên LMS. Đã bỏ qua: ${normalizedHref}`
        );
        continue;
      }
      youtubeUrls.push(normalizedHref);
    } else {
      if (seenRelated.has(normalizedHref)) continue;
      seenRelated.add(normalizedHref);
      const cleanHost = parsedUrl.hostname.replace(/^www\./i, "");
      const linkName = (explicitLabel || `Link dự án (${cleanHost})`).slice(0, 80).trim();
      const finalName = linkName || "Link sản phẩm";
      const cls = classifySpckRelatedLink({ name: finalName, url: normalizedHref });
      const relItem: SpckRelatedLink = {
        name: finalName,
        url: normalizedHref,
        category: cls.category,
        categoryLabel: cls.categoryLabel,
      };
      allRelatedLinks.push(relItem);
      if (relatedLinks.length >= MAX_SPCK_RELATED_LINKS) {
        warnings.push(
          `Vượt quá giới hạn ${MAX_SPCK_RELATED_LINKS} đường dẫn liên quan trên LMS. Đã bỏ qua: ${normalizedHref}`
        );
        continue;
      }
      relatedLinks.push(relItem);
    }
  }

  return {
    customTitle,
    youtubeUrls,
    relatedLinks,
    allYoutubeUrls,
    allRelatedLinks,
    warnings,
  };
}

/**
 * Validates a raw Robotics model/code file before packaging it into a ZIP archive.
 */
export function validateRoboticsRawFile(fullEntryPath: string): {
  valid: boolean;
  reason?: string;
} {
  const safePath = assertPathAllowed(fullEntryPath);
  if (!fs.existsSync(safePath)) {
    return { valid: false, reason: `Không tìm thấy file Robotics: '${fullEntryPath}'` };
  }
  let lstat: fs.Stats;
  try {
    lstat = fs.lstatSync(safePath);
  } catch {
    return { valid: false, reason: `Không thể đọc thuộc tính file Robotics: '${fullEntryPath}'` };
  }
  const fileName = path.basename(safePath);
  if (lstat.isSymbolicLink() || !lstat.isFile()) {
    return { valid: false, reason: `File Robotics '${fileName}' không phải là file hợp lệ.` };
  }
  if (lstat.size === 0) {
    return { valid: false, reason: `File Robotics '${fileName}' rỗng (0 bytes) nên bị loại bỏ.` };
  }
  const ext = path.extname(fileName).toLowerCase();
  const buf = fs.readFileSync(safePath);

  if (ROBOTICS_ZIP_CONTAINER_EXTENSIONS.has(ext)) {
    const hasZipMagic =
      buf.length >= 4 &&
      buf[0] === 0x50 &&
      buf[1] === 0x4b &&
      buf[2] === 0x03 &&
      buf[3] === 0x04;
    if (!hasZipMagic) {
      return {
        valid: false,
        reason: `File Robotics '${fileName}' (${ext}) thiếu chữ ký gói nén hợp lệ (PK\\x03\\x04) nên bị loại bỏ.`,
      };
    }
    try {
      const zip = new AdmZip(buf);
      const entries = zip.getEntries();
      if (!entries || entries.length === 0) {
        return {
          valid: false,
          reason: `File Robotics '${fileName}' (${ext}) có gói nén rỗng nên bị loại bỏ.`,
        };
      }
    } catch (err) {
      return {
        valid: false,
        reason: `File Robotics '${fileName}' (${ext}) bị hỏng cấu trúc gói nén: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  } else if (ext === ".ino" || ext === ".hex" || ext === ".ldr" || ext === ".mpd" || ext === ".v5python") {
    const textSample = buf.toString("utf-8").trim();
    if (!textSample || buf.includes(0x00)) {
      return {
        valid: false,
        reason: `File Robotics '${fileName}' (${ext}) bị hỏng hoặc chứa dữ liệu nhị phân không hợp lệ.`,
      };
    }
  }

  return { valid: true };
}

/**
 * Checks whether a filename indicates a dedicated thumbnail/cover image.
 */
function isThumbnailFilename(fileName: string): boolean {
  const baseName = stripVietnameseDiacritics(path.parse(fileName).name);
  return /(?:^|[^a-z0-9])(?:thumb|thumbnail|bia|cover|anh\s*bia)(?:$|[^a-z0-9])/i.test(baseName) ||
    baseName.includes("thumb") ||
    baseName.includes("bia") ||
    baseName.includes("cover");
}

/** Filenames that typically belong to photos the Owner/teacher took (presentation, demo, class photos). */
const OWNER_PHOTO_NAME_REGEX =
  /(thumb|thumbnail|bia|cover|demo|thuyet\s*trinh|trinh\s*bay|hoc\s*vien|hocvien|student|photo|img[_-]?\d|dsc|pxl|chup|poster|banner|san\s*pham|sanpham|spck)/i;
/**
 * Strong evidence of an Owner photo (class presentation / camera file names / explicit thumbnail).
 * Generic design words like `banner`, `poster`, `photo`, `cover` are NOT enough when the project
 * has Python/JS code that may build asset names dynamically (V272-R2-02).
 */
const STRONG_OWNER_PHOTO_NAME_REGEX =
  /(demo|presentation|thuyet[\s_-]*trinh|trinh[\s_-]*bay|hoc[\s_-]*vien|thumb|thumbnail|anh[\s_-]*bia|anh[\s_-]*lop|chup|img[_-]?\d{3,}|dsc[_-]?\d|pxl[_-]?\d)/i;

const OWNER_PHOTO_CODE_REFERENCE_EXTS = new Set([
  ".html",
  ".htm",
  ".css",
  ".js",
  ".mjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".ui",
  ".qss",
  ".json",
  ".ipynb",
]);

/**
 * Finds photos the Owner placed DIRECTLY in the root of a student's SPCK folder (e.g. a class
 * presentation photo `Demo.png`, a cover image, a photo of the student with the product) that are
 * NOT used as assets inside the student's own code (`.html/.css/.js/.py/.ui/.qss/...`).
 *
 * Sorted by priority: explicit thumbnail/cover names → owner-like photo names → larger images first.
 * Tiny icons (< 200px on any side) and corrupted images are ignored.
 */
export function findOwnerProvidedRootPhotos(studentDir: string): string[] {
  let safeStudentDir: string;
  try {
    safeStudentDir = assertPathAllowed(studentDir);
  } catch {
    return [];
  }
  let rootEntries: fs.Dirent[] = [];
  try {
    rootEntries = fs.readdirSync(safeStudentDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const rootImages = rootEntries.filter(
    (e) =>
      e.isFile() &&
      !e.name.startsWith(".") &&
      ALLOWED_IMAGE_EXTENSIONS.has(path.extname(e.name).toLowerCase())
  );
  if (rootImages.length === 0) return [];

  const textChunks: string[] = [];
  const dynamicCodeChunks: string[] = [];
  let hasDynamicCode = false;
  const collectCodeText = (dir: string, depth: number) => {
    if (depth > 3) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (
        entry.name.startsWith(".") ||
        entry.name.startsWith("_spck") ||
        entry.name === "node_modules" ||
        entry.name === "__pycache__" ||
        entry.name === "venv" ||
        entry.name === ".venv"
      ) {
        continue;
      }
      const fp = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectCodeText(fp, depth + 1);
      } else if (
        entry.isFile() &&
        OWNER_PHOTO_CODE_REFERENCE_EXTS.has(path.extname(entry.name).toLowerCase())
      ) {
        try {
          if (fs.statSync(fp).size > 3 * 1024 * 1024) continue;
          const raw = fs.readFileSync(fp, "utf8");
          const rawLower = raw.toLowerCase();
          if (/\.(py|js|mjs|jsx|ts|tsx|ipynb)$/i.test(entry.name)) {
            hasDynamicCode = true;
            let folded = rawLower;
            for (let i = 0; i < 4; i++) {
              const next = folded.replace(
                /(["'`])([^"'`\r\n]*)\1\s*\+\s*(["'`])([^"'`\r\n]*)\3/g,
                "$1$2$4$1"
              );
              if (next === folded) break;
              folded = next;
            }
            dynamicCodeChunks.push(rawLower, folded);
            textChunks.push(folded);
          }
          textChunks.push(rawLower);
          try {
            textChunks.push(decodeURIComponent(raw).toLowerCase());
          } catch {
            // ignore malformed URI sequences
          }
        } catch {
          // ignore unreadable code file
        }
      }
    }
  };
  collectCodeText(safeStudentDir, 0);
  const combinedSourceText = textChunks.join("\n");
  const dynamicCodeText = dynamicCodeChunks.join("\n");

  const candidates: Array<{
    fullPath: string;
    isExplicitThumb: boolean;
    isOwnerLikeName: boolean;
    area: number;
    name: string;
  }> = [];

  for (const imgEntry of rootImages) {
    const baseLower = imgEntry.name.toLowerCase();
    if (combinedSourceText && combinedSourceText.includes(baseLower)) continue;
    // V272-F07: in Python / JavaScript code, also treat the bare file stem inside quotes as a
    // reference (e.g. `QPixmap("banner" + ".png")`, `img.src = 'banner' + ext`). HTML/CSS class
    // names are NOT checked here to avoid false matches like `class="demo"`.
    const stemLower = path.parse(imgEntry.name).name.toLowerCase();
    if (stemLower.length >= 2 && dynamicCodeText) {
      const escapedStem = stemLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`["'\`/\\\\]${escapedStem}["'\`]`).test(dynamicCodeText)) continue;
    }
    const fullPath = path.join(safeStudentDir, imgEntry.name);
    try {
      const buf = fs.readFileSync(fullPath);
      const ext = path.extname(imgEntry.name).toLowerCase();
      if (!parseMediaBuffer(buf, imgEntry.name, ext).success) continue;
      const dims = extractImageDimensionsFromBuffer(buf, ext);
      if (dims && (dims.width < 200 || dims.height < 200)) continue;
      const asciiStem = stripVietnameseDiacritics(path.parse(imgEntry.name).name);
      const isExplicitThumb = isThumbnailFilename(imgEntry.name);
      const isOwnerLikeName = OWNER_PHOTO_NAME_REGEX.test(asciiStem);
      const isCameraLikePhoto =
        (ext === ".jpg" || ext === ".jpeg") &&
        Boolean(dims && dims.width >= 800 && dims.height >= 450);
      // When the project has code that may load images dynamically (Python / JavaScript), an
      // unreferenced root image needs STRONG evidence that it was added by the Owner: a class /
      // presentation / camera file name, or a camera-like JPEG photo (V272-R2-02).
      const hasStrongOwnerEvidence =
        STRONG_OWNER_PHOTO_NAME_REGEX.test(asciiStem) || isCameraLikePhoto;
      if (hasDynamicCode && !hasStrongOwnerEvidence) continue;
      candidates.push({
        fullPath,
        isExplicitThumb,
        isOwnerLikeName,
        area: dims ? dims.width * dims.height : 0,
        name: imgEntry.name,
      });
    } catch {
      // ignore unreadable image
    }
  }

  candidates.sort((a, b) => {
    if (a.isExplicitThumb !== b.isExplicitThumb) return a.isExplicitThumb ? -1 : 1;
    if (a.isOwnerLikeName !== b.isOwnerLikeName) return a.isOwnerLikeName ? -1 : 1;
    if (a.area !== b.area) return b.area - a.area;
    return a.name.localeCompare(b.name, "en");
  });

  return candidates.map((c) => c.fullPath);
}

/**
 * Scans a single student's SPCK folder and classifies all resources safely.
 */
export function scanStudentSpckFolder(
  studentFolderPath: string,
  preferredStudentName?: string
): StudentSpckPackage {
  const safeFolderPath = assertPathAllowed(studentFolderPath);
  const folderStat = fs.lstatSync(safeFolderPath);
  if (folderStat.isSymbolicLink() || !folderStat.isDirectory()) {
    throw new Error(`[SpckScanner] Đường dẫn '${studentFolderPath}' không phải là thư mục hợp lệ.`);
  }

  const folderName = path.basename(safeFolderPath);
  const warnings: string[] = [];

  const entries = fs
    .readdirSync(safeFolderPath, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, "en"));

  const validImages: Array<{
    fileName: string;
    fullPath: string;
    isThumbCandidate: boolean;
    is16By9: boolean;
    aspectDiffFrom16By9: number;
    isReconstructedAppShot: boolean;
  }> = [];
  const validAttachments: string[] = [];
  const validRoboticsRawFiles: string[] = [];
  let youtubeUrls: string[] = [];
  let relatedLinks: SpckRelatedLink[] = [];
  let allYoutubeUrls: string[] = [];
  let allRelatedLinks: SpckRelatedLink[] = [];
  let customTitleFromLinks: string | undefined;

  const pushValidatedImage = (fileName: string, fullPath: string, buf: Buffer, ext: string) => {
    const dims = extractImageDimensionsFromBuffer(buf, ext);
    const ratio = dims && dims.height > 0 ? dims.width / dims.height : null;
    const diff = ratio !== null ? Math.abs(ratio - 16 / 9) : 999;
    const is16By9 = diff <= 0.16;
    const isReconstructedAppShot =
      /[\\/]_spck_app_shots[\\/]/i.test(fullPath) &&
      /(?:synthetic|reconstruct|fallback|phuc[_-]?dung)/i.test(fileName);
    validImages.push({
      fileName,
      fullPath,
      isThumbCandidate: isThumbnailFilename(fileName),
      is16By9,
      aspectDiffFrom16By9: diff,
      isReconstructedAppShot,
    });
  };

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullEntryPath = assertPathAllowed(path.join(safeFolderPath, entry.name));

    let lstat: fs.Stats;
    try {
      lstat = fs.lstatSync(fullEntryPath);
    } catch {
      continue;
    }

    if (lstat.isSymbolicLink()) {
      warnings.push(`Đã bỏ qua symbolic link không an toàn: '${entry.name}'`);
      continue;
    }

    if (lstat.isDirectory()) {
      const lowerDir = entry.name.toLowerCase();
      if (
        lowerDir === "__pycache__" ||
        lowerDir === "node_modules" ||
        lowerDir === ".git" ||
        lowerDir === ".venv" ||
        lowerDir === "venv" ||
        lowerDir === "build" ||
        lowerDir === "dist"
      ) {
        continue;
      }
      try {
        let subEntries = fs
          .readdirSync(fullEntryPath, { withFileTypes: true })
          .sort((a, b) => a.name.localeCompare(b.name, "en"));
        if (lowerDir === "_spck_app_shots") {
          const bySlotKey = new Map<string, { entry: fs.Dirent; mtimeMs: number }>();
          for (const se of subEntries) {
            if (se.name.startsWith(".")) continue;
            const slotMatch = se.name.match(/^(app_\d+_.*?)_[0-9a-f]{6}\.png$/i);
            const slotKey = slotMatch ? slotMatch[1].toLowerCase() : se.name.toLowerCase();
            let mtimeMs = 0;
            try {
              mtimeMs = fs.statSync(path.join(fullEntryPath, se.name)).mtimeMs;
            } catch {
              mtimeMs = 0;
            }
            const prev = bySlotKey.get(slotKey);
            if (
              !prev ||
              mtimeMs > prev.mtimeMs ||
              (mtimeMs === prev.mtimeMs && se.name > prev.entry.name)
            ) {
              bySlotKey.set(slotKey, { entry: se, mtimeMs });
            }
          }
          subEntries = Array.from(bySlotKey.values())
            .map((v) => v.entry)
            .sort((a, b) => a.name.localeCompare(b.name, "en"));
        }
        for (const subEntry of subEntries) {
          if (subEntry.name.startsWith(".")) continue;
          const subPath = assertPathAllowed(path.join(fullEntryPath, subEntry.name));
          const subStat = fs.lstatSync(subPath);
          if (subStat.isSymbolicLink() || !subStat.isFile()) continue;
          const subExt = path.extname(subEntry.name).toLowerCase();
          if (ALLOWED_IMAGE_EXTENSIONS.has(subExt)) {
            const buf = fs.readFileSync(subPath);
            const mediaCheck = parseMediaBuffer(buf, subEntry.name, subExt);
            if (mediaCheck.success) {
              pushValidatedImage(subEntry.name, subPath, buf, subExt);
            }
          }
        }
      } catch {
        // Ignore unreadable subfolder
      }
      continue;
    }

    if (!lstat.isFile()) {
      continue;
    }

    const lowerName = entry.name.toLowerCase();
    const ext = path.extname(lowerName);

    // Skip previously auto-generated robotics bundle zip or IDE/OS metadata files during re-scan
    if (
      lowerName.endsWith("_robotics_package.zip") ||
      lowerName.endsWith(".code-workspace") ||
      lowerName === "desktop.ini" ||
      lowerName === "thumbs.db"
    ) {
      continue;
    }

    // 1. Check if this is links.txt
    if (lowerName === "links.txt" || lowerName === "link.txt") {
      if (lstat.size > 256 * 1024) {
        warnings.push(`File '${entry.name}' vượt quá 256KB nên bị bỏ qua.`);
        continue;
      }
      const rawContent = fs.readFileSync(fullEntryPath, "utf-8");
      const parsedLinks = parseLinksTxtContent(rawContent);
      youtubeUrls = parsedLinks.youtubeUrls;
      relatedLinks = parsedLinks.relatedLinks;
      allYoutubeUrls = parsedLinks.allYoutubeUrls || parsedLinks.youtubeUrls;
      allRelatedLinks = parsedLinks.allRelatedLinks || parsedLinks.relatedLinks;
      if (parsedLinks.customTitle) {
        customTitleFromLinks = parsedLinks.customTitle;
      }
      warnings.push(...parsedLinks.warnings);
      continue;
    }

    // 2. Check if this is an image (.png, .jpg, .jpeg, .webp)
    if (ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
      const buf = fs.readFileSync(fullEntryPath);
      const mediaCheck = parseMediaBuffer(buf, entry.name, ext);
      if (!mediaCheck.success) {
        // Check if this is a student web/app asset image whose magic bytes belong to another valid image format (.webp/.jpg/.png)
        const isOtherValidImageFormat =
          parseMediaBuffer(buf, entry.name, ".webp").success ||
          parseMediaBuffer(buf, entry.name, ".jpg").success ||
          parseMediaBuffer(buf, entry.name, ".png").success;
        const hasCapturedOrWebAppContext = entries.some(
          (e) =>
            e.name.toLowerCase() === "_spck_app_shots" ||
            /\.(?:html?|ui)$/i.test(e.name)
        );
        if (isOtherValidImageFormat && hasCapturedOrWebAppContext) {
          continue;
        }
        warnings.push(
          `Ảnh '${entry.name}' bị hỏng hoặc sai định dạng nên bị loại bỏ: ${mediaCheck.errorReason || "PARSE_ERROR"}`
        );
        continue;
      }
      pushValidatedImage(entry.name, fullEntryPath, buf, ext);
      continue;
    }

    // 3. Check if this is an allowed project attachment
    if (ALLOWED_ATTACHMENT_EXTENSIONS.has(ext)) {
      const attValidation = validateSpckAttachmentFile(fullEntryPath);
      if (!attValidation.valid) {
        warnings.push(
          attValidation.reason ||
            `Tài liệu đính kèm '${entry.name}' bị hỏng cấu trúc nên bị loại bỏ.`
        );
        continue;
      }
      validAttachments.push(fullEntryPath);
      continue;
    }

    // 4. Check if this is a Robotics model/code file (.ev3, .llsp3, .io, .lxf, .ino, .hex, .uf2, .mblock, etc.)
    if (ROBOTICS_RAW_EXTENSIONS.has(ext)) {
      const robCheck = validateRoboticsRawFile(fullEntryPath);
      if (!robCheck.valid) {
        warnings.push(
          robCheck.reason || `File Robotics '${entry.name}' không hợp lệ nên bị loại bỏ.`
        );
        continue;
      }
      validRoboticsRawFiles.push(fullEntryPath);
      continue;
    }

    warnings.push(`Đã bỏ qua file không thuộc danh mục hỗ trợ SPCK: '${entry.name}'`);
  }

  // Package valid raw Robotics files into a lossless .zip attachment if present (T14)
  if (validRoboticsRawFiles.length > 0) {
    try {
      const zip = new AdmZip();
      for (const robPath of validRoboticsRawFiles) {
        const robBytes = fs.readFileSync(robPath);
        zip.addFile(path.basename(robPath), robBytes);
      }
      const safeSlug =
        stripVietnameseDiacritics(folderName)
          .replace(/[^a-zA-Z0-9_-]+/g, "_")
          .replace(/^_+|_+$/g, "") || "student";
      const bundleZipPath = assertPathAllowed(
        path.join(safeFolderPath, `${safeSlug}_robotics_package.zip`)
      );
      zip.writeZip(bundleZipPath);
      const zipCheck = validateSpckAttachmentFile(bundleZipPath);
      if (zipCheck.valid) {
        validAttachments.push(bundleZipPath);
      } else {
        warnings.push(zipCheck.reason || "Không thể xác thực gói ZIP Robotics vừa đóng gói.");
      }
    } catch (err) {
      warnings.push(
        `Lỗi khi đóng gói ZIP cho file Robotics: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Classify Thumbnail (*) and Screenshots (max 10)
  // Priority:
  // 0. Owner-provided photos (`_spck_owner_uploads/thumb_*`, other owner uploads, or unreferenced root photos like `Demo.png`)
  // 1. Explicit thumbnail filename (thumb, bia, cover) — preferring 16:9 and non-reconstructed images
  // 2. Real product / teacher-uploaded / real app screenshot images — preferring 16:9 closest aspect ratio
  // 3. Reconstructed app screenshot (_spck_app_shots synthetic)
  // 4. Default MindX Logo fallback
  // V272-F06: YouTube presentation frames (Robotics) are NEVER Thumbnail candidates — they only go
  // into the gallery. Thumbnail falls back to Owner photos or the MindX logo.
  const youtubeFrameImages = validImages.filter((img) =>
    /[\\/]_spck_youtube_frames[\\/]/i.test(img.fullPath)
  );
  const thumbPoolImages = validImages.filter((img) => !youtubeFrameImages.includes(img));
  const capturedOrOwnerImages = thumbPoolImages.filter(
    (img) =>
      /[\\/](?:_spck_app_shots|_spck_owner_uploads)[\\/]/i.test(img.fullPath) &&
      !img.isReconstructedAppShot
  );
  const nonReconstructedImages = thumbPoolImages.filter((img) => !img.isReconstructedAppShot);
  const effectiveImages =
    capturedOrOwnerImages.length > 0
      ? capturedOrOwnerImages
      : nonReconstructedImages.length > 0
      ? nonReconstructedImages
      : thumbPoolImages;

  const sortBy16By9Preference = <
    T extends { is16By9: boolean; aspectDiffFrom16By9: number; fileName: string }
  >(
    list: T[]
  ): T[] => {
    return [...list].sort((a, b) => {
      if (a.is16By9 !== b.is16By9) return a.is16By9 ? -1 : 1;
      if (Math.abs(a.aspectDiffFrom16By9 - b.aspectDiffFrom16By9) > 0.05) {
        return a.aspectDiffFrom16By9 - b.aspectDiffFrom16By9;
      }
      return a.fileName.localeCompare(b.fileName, "en");
    });
  };

  let thumbnailPath = "";
  let thumbnailSource: SpckPackageThumbnailSource = "AUTO_IMAGE";
  let screenshotCandidates: string[] = [];

  // OWNER PRIORITY RULE (v2.7.2): photos provided by the Owner always win the Thumbnail slot:
  //   (a) `_spck_owner_uploads/thumb_*` → (b) other `_spck_owner_uploads/*` →
  //   (c) photos placed directly in the student's root folder that are NOT used by the student's code
  //       (e.g. `Demo.png`, presentation photo, cover image).
  // Auto-captured App/Web screenshots are then placed in the bottom gallery.
  const samePath = (a: string, b: string) =>
    path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  const ownerUploadImages = validImages.filter((img) =>
    /[\\/]_spck_owner_uploads[\\/]/i.test(img.fullPath)
  );
  const ownerRootImages = findOwnerProvidedRootPhotos(safeFolderPath)
    .map((p) => validImages.find((img) => samePath(img.fullPath, p)))
    .filter((img): img is (typeof validImages)[number] => Boolean(img));
  const explicitOwnerUploadThumb = ownerUploadImages.find((img) =>
    /^thumb_/i.test(img.fileName)
  );
  const chosenOwnerThumb =
    explicitOwnerUploadThumb || ownerUploadImages[0] || ownerRootImages[0];

  const explicitThumbCandidates = sortBy16By9Preference(
    effectiveImages.filter((img) => img.isThumbCandidate)
  );
  const explicitThumb = explicitThumbCandidates[0];

  if (chosenOwnerThumb) {
    thumbnailPath = chosenOwnerThumb.fullPath;
    thumbnailSource = ownerUploadImages.includes(chosenOwnerThumb)
      ? "OWNER_UPLOAD"
      : "OWNER_ROOT_PHOTO";
    const ownerFirst = [...ownerUploadImages, ...ownerRootImages];
    const capturedShots = validImages.filter(
      (img) =>
        /[\\/]_spck_app_shots[\\/]/i.test(img.fullPath) && !img.isReconstructedAppShot
    );
    const restPool =
      capturedShots.length > 0 || ownerUploadImages.length > 0 ? capturedShots : validImages;
    const ordered: string[] = [];
    for (const img of [...ownerFirst, ...restPool]) {
      if (samePath(img.fullPath, chosenOwnerThumb.fullPath)) continue;
      if (ordered.some((p) => samePath(p, img.fullPath))) continue;
      ordered.push(img.fullPath);
    }
    screenshotCandidates = ordered;
  } else if (explicitThumb) {
    thumbnailPath = explicitThumb.fullPath;
    const poolForGallery =
      capturedOrOwnerImages.length > 0 ? effectiveImages : validImages;
    const otherImages = poolForGallery.filter(
      (img) => img.fullPath !== explicitThumb.fullPath
    );
    screenshotCandidates =
      otherImages.length > 0
        ? otherImages.map((img) => img.fullPath)
        : [explicitThumb.fullPath];
  } else if (effectiveImages.length > 0) {
    const preferredOrder = sortBy16By9Preference(effectiveImages);
    const chosenThumb = preferredOrder[0];
    thumbnailPath = chosenThumb.fullPath;
    const poolForGallery =
      capturedOrOwnerImages.length > 0 ? effectiveImages : validImages;
    const restImages = poolForGallery
      .filter((img) => img.fullPath !== chosenThumb.fullPath)
      .map((img) => img.fullPath);
    screenshotCandidates =
      restImages.length > 0 ? restImages : [chosenThumb.fullPath];
  } else {
    const defaultMindxLogoPath = path.resolve(
      process.cwd(),
      "data",
      "config",
      "default-spck-thumbnail.png"
    );
    if (fs.existsSync(defaultMindxLogoPath)) {
      thumbnailPath = defaultMindxLogoPath;
    }
    thumbnailSource = "DEFAULT_LOGO";
    warnings.push(
      "Chưa có ảnh sản phẩm trong thư mục (đã tự động lấy ảnh Logo MindX làm Thumbnail mặc định)."
    );
  }

  // YouTube presentation frames always stay in the gallery (never as Thumbnail)
  for (const frame of youtubeFrameImages) {
    if (samePath(frame.fullPath, thumbnailPath)) continue;
    if (screenshotCandidates.some((p) => samePath(p, frame.fullPath))) continue;
    screenshotCandidates.push(frame.fullPath);
  }
  // Bot-generated supplementary screenshots (`_spck_app_shots` and `_spck_youtube_frames`) only fill
  // remaining gallery slots up to MAX_SPCK_SCREENSHOTS (10), while Owner/user photos are never silently sliced.
  if (screenshotCandidates.length > MAX_SPCK_SCREENSHOTS) {
    const isBotGeneratedShot = (p: string) =>
      /[\\/](?:_spck_app_shots|_spck_youtube_frames)[\\/]/i.test(p);
    const nonBotShots = screenshotCandidates.filter((p) => !isBotGeneratedShot(p));
    const botShots = screenshotCandidates.filter((p) => isBotGeneratedShot(p));
    if (botShots.length > 0) {
      const remainingSlots = Math.max(0, MAX_SPCK_SCREENSHOTS - nonBotShots.length);
      screenshotCandidates = [...nonBotShots, ...botShots.slice(0, remainingSlots)];
    }
  }
  const ownerPhotos = [...ownerUploadImages, ...ownerRootImages].map((img) => img.fullPath);

  if (screenshotCandidates.length > MAX_SPCK_SCREENSHOTS) {
    warnings.push(
      `Thư mục có ${screenshotCandidates.length} ảnh, vượt giới hạn ${MAX_SPCK_SCREENSHOTS} ảnh của LMS. Đã giữ lại ${MAX_SPCK_SCREENSHOTS} ảnh đầu tiên.`
    );
  }
  const screenshots = screenshotCandidates.slice(0, MAX_SPCK_SCREENSHOTS);

  if (validAttachments.length > MAX_SPCK_ATTACHMENTS) {
    warnings.push(
      `Thư mục có ${validAttachments.length} tài liệu đính kèm, vượt giới hạn ${MAX_SPCK_ATTACHMENTS} file của LMS. Đã giữ lại ${MAX_SPCK_ATTACHMENTS} file đầu tiên.`
    );
  }
  const attachments = validAttachments.slice(0, MAX_SPCK_ATTACHMENTS);

  const displayName = (preferredStudentName || folderName).trim();
  const rawProjectTitle = sanitizeSpckTitle(
    customTitleFromLinks || `SPCK ${displayName}`,
    displayName
  );
  const projectTitle = rawProjectTitle;
  const thumbnailInspection = inspectSpckThumbnail(thumbnailPath);

  return {
    folderName,
    folderPath: safeFolderPath,
    projectTitle,
    rawProjectTitle,
    thumbnailPath,
    thumbnailInspection,
    thumbnailSource,
    ownerPhotos,
    screenshots,
    attachments,
    youtubeUrls,
    relatedLinks,
    allScreenshots: screenshotCandidates,
    allAttachments: validAttachments,
    allYoutubeUrls,
    allRelatedLinks,
    warnings,
  };
}

/**
 * Scans the entire class SPCK root directory, matches each student subfolder against LMS student records,
 * and returns a structured list ready for the Mapping Table and SQLite persistence.
 */
export function scanClassSpckDirectory(
  classId: string,
  rootFolderPath: string,
  students: StudentCandidate[]
): ScanClassSpckDirectoryResult {
  const normalizedClassId = (classId || "").trim().toUpperCase();
  if (!normalizedClassId) {
    throw new Error("[SpckScanner] Thiếu mã lớp (classId).");
  }

  const safeRootPath = assertPathAllowed(rootFolderPath);
  if (!fs.existsSync(safeRootPath)) {
    throw new Error(`[SpckScanner] Thư mục gốc SPCK không tồn tại: '${rootFolderPath}'`);
  }

  const rootStat = fs.lstatSync(safeRootPath);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`[SpckScanner] Đường dẫn '${rootFolderPath}' không phải là thư mục hợp lệ.`);
  }

  const dirEntries = fs
    .readdirSync(safeRootPath, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));

  const subfolders: Array<{ folderName: string; folderPath: string }> = [];
  for (const entry of dirEntries) {
    const childPath = assertPathAllowed(path.join(safeRootPath, entry.name));
    try {
      const st = fs.lstatSync(childPath);
      if (!st.isSymbolicLink() && st.isDirectory()) {
        subfolders.push({
          folderName: entry.name,
          folderPath: childPath,
        });
      }
    } catch {
      // Ignore unreadable entries
    }
  }

  const studentMap = new Map(students.map((s) => [s.studentId, s]));
  const existingClassRecords = spckUploadRepo.findByClass(normalizedClassId);
  const confirmedOwnerByFolder = new Map<string, string>();
  const confirmedFolderByStudent = new Map<string, string>();
  const detachedStudents = new Set<string>();

  for (const rec of existingClassRecords) {
    const normFolder = normalizeSpckFolderKey(rec.localFolderPath);
    if (Number(rec.isConfirmedByTeacher) === 1 && normFolder && rec.studentId) {
      confirmedOwnerByFolder.set(normFolder, rec.studentId);
      confirmedFolderByStudent.set(rec.studentId, normFolder);
    } else if (!normFolder && Number(rec.isConfirmedByTeacher) === 0 && rec.studentId) {
      detachedStudents.add(rec.studentId);
    }
  }

  const rawMatchResults = matchFoldersToStudents(subfolders, students);
  const matchResults: FolderStudentMatchResult[] = rawMatchResults.map((rawMatch) => {
    const normFolder = normalizeSpckFolderKey(rawMatch.folderPath);
    const confirmedOwnerId = confirmedOwnerByFolder.get(normFolder);
    if (confirmedOwnerId && studentMap.has(confirmedOwnerId)) {
      const ownerStu = studentMap.get(confirmedOwnerId)!;
      return {
        ...rawMatch,
        suggestedStudentId: ownerStu.studentId,
        suggestedStudentName: ownerStu.fullName,
        matchScore: 1.0,
        autoConfirmed: true,
        requiresManualConfirmation: false,
        hasFolderCollision: false,
        warningReasons: [],
      };
    }

    if (rawMatch.suggestedStudentId) {
      const suggestedId = rawMatch.suggestedStudentId;
      const existingConfirmedFolder = confirmedFolderByStudent.get(suggestedId);
      if (
        (existingConfirmedFolder && existingConfirmedFolder !== normFolder) ||
        detachedStudents.has(suggestedId)
      ) {
        return {
          ...rawMatch,
          autoConfirmed: false,
          requiresManualConfirmation: true,
          hasFolderCollision: true,
        };
      }
    }

    return rawMatch;
  });

  const items: ScannedClassSpckItem[] = matchResults.map((match) => {
    const matchedStudent = match.suggestedStudentId
      ? studentMap.get(match.suggestedStudentId)
      : undefined;
    const packageData = scanStudentSpckFolder(
      match.folderPath,
      matchedStudent?.fullName || match.folderName
    );
    return {
      folderName: match.folderName,
      folderPath: match.folderPath,
      match,
      packageData,
    };
  });

  return {
    classId: normalizedClassId,
    rootFolderPath: safeRootPath,
    scannedAt: new Date().toISOString(),
    totalFolders: items.length,
    items,
  };
}
