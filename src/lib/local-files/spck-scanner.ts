/**
 * MINDX AUTOMATION BOT - SPCK LOCAL DIRECTORY SCANNER & VALIDATOR
 * Phase 6 (TASK-6.2): Scans local SPCK class/student folders under Path Allowlist protection,
 * classifies Thumbnail, Screenshots (max 10), Attachments (max 10), Youtube URLs (max 5),
 * Related Links (max 5), and enforces projectTitle <= 100 chars.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { normalizeSpckFolderKey, spckUploadRepo } from "../db/sqlite";
import { parseZipArchiveBuffer } from "../file-parsers/archive-reader";
import { parseGameMakerBuffer, parseScratchSb3Buffer } from "../file-parsers/game-reader";
import { parseMediaBuffer } from "../file-parsers/media-reader";
import {
  assertPathAllowed,
  registerTeacherSelectedDirectory,
} from "../security/path-allowlist";
import {
  findProjectUiFiles,
  renderPyQtUiScreenshotsAsync,
  renderPyQtUiScreenshotsSync,
} from "./spck-app-screenshotter";
import {
  findProjectGameFiles,
  renderGameArchiveScreenshotsAsync,
  renderGameArchiveScreenshotsSync,
} from "./spck-game-screenshotter";
import { taskQueue } from "../queue/task-queue";
import {
  normalizeImagesToLms16x9,
  normalizeImagesToLms16x9Sync,
} from "./spck-image-normalizer";
import {
  FolderStudentMatchResult,
  StudentCandidate,
  calculateNameSimilarity,
  extractFolderNameVariants,
  matchFoldersToStudents,
  normalizeVietnameseName,
  stripVietnameseDiacritics,
} from "../utils/vietnamese-match";

export const DEFAULT_SPCK_BASE_DIR = "F:\\MINDX_SPCK_FINAL";
export const MAX_SPCK_TITLE_LENGTH = 100;
export const MAX_SPCK_SCREENSHOTS = 10;
export const MAX_SPCK_ATTACHMENTS = 10;
export const MAX_SPCK_BUNDLE_ZIP_FILES = 600;
export const MAX_SPCK_YOUTUBE_URLS = 5;
export const MAX_SPCK_RELATED_LINKS = 5;

const SPCK_PREFIX_TOKENS = new Set([
  "VT",
  "HN",
  "HCM",
  "SG",
  "DN",
  "HP",
  "CT",
  "BH",
  "BD",
  "NT",
  "C4K",
  "ROB",
  "C4T",
  "KID",
  "KIDS",
  "TEENS",
  "ONLINE",
  "ONL",
]);

/**
 * Extracts normalized folder code candidates from an LMS classId.
 * E.g. "VT-JSB16" -> { shortCode: "JSB16", tailCode: "JSB16", fullCode: "VT-JSB16" }
 *      "VT-C4K-GA38" -> { shortCode: "GA38", tailCode: "GA38", fullCode: "VT-C4K-GA38" }
 *      "VT-CSA04-HB" -> { shortCode: "CSA04", tailCode: "CSA04-HB", fullCode: "VT-CSA04-HB" }
 */
export function extractSpckClassFolderCode(classId: string): {
  shortCode: string;
  tailCode: string;
  fullCode: string;
} {
  const fullCode = String(classId || "")
    .trim()
    .toUpperCase()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-");
  if (!fullCode) {
    return { shortCode: "", tailCode: "", fullCode: "" };
  }

  const tokens = fullCode.split(/[-_\s]+/).filter(Boolean);
  const courseIdx = tokens.findIndex(
    (tok) => !SPCK_PREFIX_TOKENS.has(tok) && /^[A-Z]{2,8}\d{1,4}[A-Z]?$/i.test(tok)
  );
  if (courseIdx >= 0) {
    const shortCode = tokens[courseIdx];
    const tailCode = tokens.slice(courseIdx).join("-");
    return { shortCode, tailCode, fullCode };
  }

  const lastToken = tokens[tokens.length - 1] || fullCode;
  return { shortCode: lastToken, tailCode: lastToken, fullCode };
}

function isSyntheticTestClassCode(classId: string): boolean {
  const upper = String(classId || "").trim().toUpperCase();
  return /^(TEST|S5A|S5B|V270|V272)_/.test(upper);
}

/**
 * Resolves the default SPCK folder for a class inside `F:\MINDX_SPCK_FINAL` (or isolated test root).
 * - If a matching subfolder already exists in `F:\MINDX_SPCK_FINAL` (case-insensitive match on
 *   shortCode like `JSB16`, `jsb15`, `GA38`, `PTA12` or fullCode like `VT-JSB16`), selects that exact folder.
 * - If it does not exist yet and `createIfMissing !== false`, automatically creates `F:\MINDX_SPCK_FINAL\<shortCode>`
 *   and registers it in the Path Allowlist.
 */
export function resolveDefaultSpckClassFolder(
  classId: string,
  options?: { createIfMissing?: boolean; baseDir?: string }
): string {
  const { shortCode, tailCode, fullCode } = extractSpckClassFolderCode(classId);
  if (!fullCode) return "";

  const createIfMissing = options?.createIfMissing !== false;
  let baseRoot = options?.baseDir ? path.resolve(options.baseDir) : "";
  if (!baseRoot) {
    if (process.env.MINDX_DB_PATH || isSyntheticTestClassCode(fullCode)) {
      baseRoot = process.env.MINDX_DB_PATH
        ? path.join(path.dirname(path.resolve(process.env.MINDX_DB_PATH)), "spck_root")
        : path.join(os.tmpdir(), "mindx_spck_test_root");
    } else {
      baseRoot = DEFAULT_SPCK_BASE_DIR;
    }
  }

  try {
    if (!fs.existsSync(baseRoot) && createIfMissing) {
      fs.mkdirSync(baseRoot, { recursive: true });
    }
  } catch {
    // Fallback if drive letter does not exist on non-F: environment
    baseRoot = path.resolve(process.cwd(), "data", "spck_root");
    if (!fs.existsSync(baseRoot) && createIfMissing) {
      fs.mkdirSync(baseRoot, { recursive: true });
    }
  }

  const candidateNames = Array.from(
    new Set([shortCode, tailCode, fullCode].filter(Boolean))
  );

  let resolvedDir = "";
  try {
    if (fs.existsSync(baseRoot)) {
      const entries = fs.readdirSync(baseRoot, { withFileTypes: true });
      for (const cand of candidateNames) {
        const match = entries.find(
          (e) => e.isDirectory() && e.name.toLowerCase() === cand.toLowerCase()
        );
        if (match) {
          resolvedDir = path.join(baseRoot, match.name);
          break;
        }
      }
    }
  } catch {
    // Ignore read error
  }

  if (!resolvedDir) {
    resolvedDir = path.join(baseRoot, shortCode || fullCode);
    if (createIfMissing && !fs.existsSync(resolvedDir)) {
      try {
        fs.mkdirSync(resolvedDir, { recursive: true });
      } catch {
        // Ignore mkdir error
      }
    }
  }

  if (fs.existsSync(resolvedDir)) {
    try {
      return registerTeacherSelectedDirectory(resolvedDir);
    } catch {
      return resolvedDir;
    }
  }
  return resolvedDir;
}

/**
 * Normalizes a teacher/UI supplied `candidateFolderPath` for `classId`:
 * If `candidateFolderPath` is empty, points to `process.cwd()`, points to `F:\MINDX_SPCK_FINAL` root
 * without a class subfolder, points to legacy `data/spck/...`, or points to another class's subfolder
 * inside `F:\MINDX_SPCK_FINAL`, automatically resolves to `F:\MINDX_SPCK_FINAL\<Mã-Lớp>`.
 */
export function resolveTargetSpckClassFolder(
  classId: string,
  candidateFolderPath?: string,
  options?: { baseDir?: string }
): string {
  const defaultClassDir = resolveDefaultSpckClassFolder(classId, {
    createIfMissing: true,
    baseDir: options?.baseDir,
  });
  const rawCandidate = String(candidateFolderPath || "").trim();
  if (!rawCandidate) {
    return defaultClassDir;
  }

  const resolvedCandidate = path.resolve(rawCandidate);
  const normCandidate = normalizeSpckFolderKey(resolvedCandidate);
  const normWorkspace = normalizeSpckFolderKey(process.cwd());
  const normDefaultBase = normalizeSpckFolderKey(DEFAULT_SPCK_BASE_DIR);
  const normActiveBase = defaultClassDir
    ? normalizeSpckFolderKey(path.dirname(defaultClassDir))
    : normDefaultBase;
  const normLegacyDataSpck = normalizeSpckFolderKey(
    path.resolve(process.cwd(), "data", "spck")
  );

  if (
    normCandidate === normWorkspace ||
    normCandidate === normDefaultBase ||
    normCandidate === normActiveBase ||
    normCandidate === normLegacyDataSpck ||
    normCandidate.startsWith(normLegacyDataSpck + "/")
  ) {
    return defaultClassDir || resolvedCandidate;
  }

  // If candidate is a direct child of F:\MINDX_SPCK_FINAL (or active baseRoot) for a different class, switch to current class folder
  const candidateParentNorm = normalizeSpckFolderKey(path.dirname(resolvedCandidate));
  if (
    defaultClassDir &&
    (candidateParentNorm === normDefaultBase || candidateParentNorm === normActiveBase)
  ) {
    const { shortCode, tailCode, fullCode } = extractSpckClassFolderCode(classId);
    const baseNameLower = path.basename(resolvedCandidate).toLowerCase();
    const validClassNames = new Set(
      [
        shortCode.toLowerCase(),
        tailCode.toLowerCase(),
        fullCode.toLowerCase(),
        path.basename(defaultClassDir).toLowerCase(),
      ].filter(Boolean)
    );
    if (!validClassNames.has(baseNameLower)) {
      return defaultClassDir;
    }
  }

  return resolvedCandidate;
}

/**
 * Resolves a student's subfolder inside `classRootDir` (`F:\MINDX_SPCK_FINAL\<Mã-Lớp>`):
 * Reuses an existing subfolder if its diacritic-stripped normalized name matches `studentFullName`
 * (e.g. `Duong Dang Khôi` matches `Dương Đăng Khôi`), or returns `<classRootDir>/<studentFullName>`.
 */
export function resolveStudentFolderInsideClassRoot(
  classRootDir: string,
  studentFullName: string,
  fallbackStudentId: string,
  otherStudentFolderPaths: string[] = []
): string {
  const resolvedRoot = path.resolve(classRootDir);
  const otherNormSet = new Set(
    otherStudentFolderPaths.filter(Boolean).map((p) => normalizeSpckFolderKey(p))
  );
  const normTargetName = stripVietnameseDiacritics(studentFullName || fallbackStudentId)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normTargetName && fs.existsSync(resolvedRoot)) {
    try {
      const subdirs = fs
        .readdirSync(resolvedRoot, { withFileTypes: true })
        .filter(
          (d) =>
            d.isDirectory() &&
            !d.name.startsWith(".") &&
            !d.name.toLowerCase().startsWith("_spck_")
        );
      for (const sub of subdirs) {
        const subPath = path.join(resolvedRoot, sub.name);
        if (otherNormSet.has(normalizeSpckFolderKey(subPath))) continue;
        const normSub = stripVietnameseDiacritics(sub.name)
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (normSub && normSub === normTargetName) {
          return subPath;
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  const cleanName =
    String(studentFullName || fallbackStudentId)
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\.+$/, "")
      .trim() || fallbackStudentId;

  let candidatePath = path.join(resolvedRoot, cleanName);
  if (otherNormSet.has(normalizeSpckFolderKey(candidatePath))) {
    candidatePath = path.join(
      resolvedRoot,
      `${cleanName}_${String(fallbackStudentId).slice(-4)}`
    );
  }
  return candidatePath;
}

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
  ".htm",
  ".css",
  ".js",
  ".mjs",
  ".pptx",
  ".pdf",
  ".docx",
  ".txt",
  ".text",
  ".md",
  ".csv",
  ".xml",
  ".sql",
  ".json",
]);

const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  ".py",
  ".ipynb",
  ".ui",
  ".qss",
  ".gml",
  ".yy",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".mjs",
  ".txt",
  ".text",
  ".md",
  ".csv",
  ".xml",
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
  ".vexblocks",
  ".iqblocks",
  ".v5python",
  ".v5blocks",
]);

const DETERMINISTIC_ZIP_TIMESTAMP = new Date("2026-01-01T00:00:00.000Z");

/**
 * Writes a deterministic `.zip` archive (sorted entries + fixed entry header timestamp)
 * so repeated folder scans do not change the `.zip` file's SHA-256 when source files are unchanged.
 */
export function writeDeterministicZipFile(
  bundleZipPath: string,
  entries: Array<{ entryName: string; data: Buffer }>
): void {
  const sortedEntries = [...entries].sort((a, b) =>
    a.entryName.localeCompare(b.entryName, "en")
  );
  const zip = new AdmZip();
  for (const item of sortedEntries) {
    zip.addFile(item.entryName, item.data);
  }
  for (const zipEntry of zip.getEntries()) {
    zipEntry.header.time = DETERMINISTIC_ZIP_TIMESTAMP;
  }
  const nextZipBuffer = zip.toBuffer();
  if (fs.existsSync(bundleZipPath)) {
    try {
      const existingBuf = fs.readFileSync(bundleZipPath);
      if (existingBuf.equals(nextZipBuffer)) {
        return;
      }
    } catch {
      // Rewrite below if unreadable
    }
  }
  fs.writeFileSync(bundleZipPath, nextZipBuffer);
}

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
  if (TEXT_ATTACHMENT_EXTENSIONS.has(ext)) {
    if (buf.includes(0x00)) {
      return {
        valid: false,
        reason: `File mã nguồn '${fileName}' chứa dữ liệu nhị phân không hợp lệ (null byte) nên bị loại bỏ.`,
      };
    }
    const textContent = buf.toString("utf8").replace(/^\uFEFF/, "");
    if (textContent.trim().length === 0) {
      return {
        valid: false,
        reason: `Tài liệu đính kèm '${fileName}' chỉ chứa khoảng trắng nên bị bỏ qua.`,
      };
    }
  }
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

function isExplicitProductScreenshotFilename(fileName: string): boolean {
  const baseName = stripVietnameseDiacritics(path.parse(fileName).name);
  return /^(?:screenshots?|anh[\s_-]*chup|man[\s_-]*hinh)(?:$|[\s_-]*\d+)/i.test(baseName);
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
const GENERIC_ROOT_ASSET_STEM_REGEX =
  /^(?:images?|img|bg|background|banner|logo|icons?|avatar|buttons?|btn|cards?|items?|food|drinks?|games?|sprites?|tiles?|walls?|players?|enemy|enemies|bullets?|coins?|hearts?|stars?|menu|home|login|logon|register|regiter|signup|untitled|\d{1,6})$/i;
const CAMERA_OR_PHONE_PHOTO_STEM_REGEX =
  /^(?:\d{10,}[_-]\d+|z\d{8,}|20\d{6}[_-]\d{4,}|img[_-]?\d{3,}|dsc[_-]?\d+|pxl[_-]?\d+|screenshot)/i;

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
    isLandscape: boolean;
    area: number;
    name: string;
  }> = [];

  const isRootImageReferencedByCode = (imgName: string): boolean => {
    const baseLower = imgName.toLowerCase();
    if (combinedSourceText && combinedSourceText.includes(baseLower)) return true;
    const stemLower = path.parse(imgName).name.toLowerCase();
    if (stemLower.length >= 2 && dynamicCodeText) {
      const escapedStem = stemLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`["'\`/\\\\]${escapedStem}["'\`]`).test(dynamicCodeText)) return true;
    }
    return false;
  };

  let referencedRootImageCount = 0;
  for (const imgEntry of rootImages) {
    if (isRootImageReferencedByCode(imgEntry.name)) {
      referencedRootImageCount++;
    }
  }

  for (const imgEntry of rootImages) {
    if (isRootImageReferencedByCode(imgEntry.name)) continue;
    const fullPath = path.join(safeStudentDir, imgEntry.name);
    try {
      const buf = fs.readFileSync(fullPath);
      const ext = path.extname(imgEntry.name).toLowerCase();
      if (!parseMediaBuffer(buf, imgEntry.name, ext).success) continue;
      const dims = extractImageDimensionsFromBuffer(buf, ext);
      if (dims && (dims.width < 200 || dims.height < 200)) continue;
      const asciiStem = stripVietnameseDiacritics(path.parse(imgEntry.name).name).trim();
      if (GENERIC_ROOT_ASSET_STEM_REGEX.test(asciiStem)) continue;
      const isExplicitThumb = isThumbnailFilename(imgEntry.name);
      const isOwnerLikeName = OWNER_PHOTO_NAME_REGEX.test(asciiStem);
      const isStrongOwnerName =
        STRONG_OWNER_PHOTO_NAME_REGEX.test(asciiStem) ||
        CAMERA_OR_PHONE_PHOTO_STEM_REGEX.test(asciiStem);
      const isCameraLikePhoto =
        (ext === ".jpg" || ext === ".jpeg") &&
        Boolean(dims && dims.width >= 800 && dims.height >= 450) &&
        (referencedRootImageCount <= 1 || isStrongOwnerName);
      // When the project has code that may load images dynamically (Python / JavaScript) or stores
      // multiple referenced assets in the root directory, an unreferenced root image needs STRONG
      // evidence that it was added by the Owner (V272-R2-02).
      const hasStrongOwnerEvidence = isStrongOwnerName || isCameraLikePhoto;
      if ((hasDynamicCode || referencedRootImageCount >= 2) && !hasStrongOwnerEvidence) continue;
      candidates.push({
        fullPath,
        isExplicitThumb,
        isOwnerLikeName,
        isLandscape: Boolean(dims && dims.width >= dims.height),
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
    if (a.isLandscape !== b.isLandscape) return a.isLandscape ? -1 : 1;
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
  preferredStudentName?: string,
  options?: { skipSyncAutoRender?: boolean; skipSyncImageNormalize?: boolean }
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

  // Detect Web (.html/.htm) and App/Code/Game (.py/.ui/.qss/.ipynb/.cs/.cpp/.java/.yyz/.sb3/...) project structure
  // in root or subfolders up to depth 3 so project asset images (icons, banners, avatars, buttons in img/Image/Icon/...)
  // are not misclassified as LMS product screenshots, and multi-file/subfolder code can be bundled into a .zip.
  const webHtmlFiles: string[] = [];
  const webSourceFiles: Array<{ fullPath: string; relPosix: string }> = [];
  const appCodePrimaryFiles: string[] = [];
  const appSourceFiles: Array<{ fullPath: string; relPosix: string }> = [];
  const appResourceAssets: Array<{ fullPath: string; relPosix: string; size: number; depth: number }> = [];
  const gameMakerYypFiles: string[] = [];
  let hasRawYyzArchive = false;
  let hasSubfolderWebCode = false;
  let hasSubfolderAppCode = false;
  const WEB_SOURCE_BUNDLE_EXTS = new Set([
    ".html",
    ".htm",
    ".css",
    ".js",
    ".mjs",
    ".json",
    ".txt",
    ".text",
    ".md",
    ".csv",
    ".xml",
  ]);
  const APP_PRIMARY_CODE_EXTS = new Set([
    ".py",
    ".ui",
    ".qss",
    ".ipynb",
    ".cs",
    ".cpp",
    ".c",
    ".java",
    ".lua",
    ".gmx",
    ".yyz",
    ".yyp",
    ".gml",
    ".yy",
    ".sb3",
    ".rbxl",
  ]);
  const APP_SOURCE_BUNDLE_EXTS = new Set([
    ".py",
    ".ui",
    ".qss",
    ".ipynb",
    ".cs",
    ".cpp",
    ".c",
    ".h",
    ".hpp",
    ".java",
    ".lua",
    ".yyp",
    ".gml",
    ".yy",
    ".json",
    ".txt",
    ".text",
    ".md",
    ".csv",
    ".xml",
    ".sql",
  ]);
  const APP_ASSET_BUNDLE_EXTS = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".svg",
    ".ico",
    ".bmp",
    ".jfif",
    ".avif",
    ".qrc",
    ".db",
    ".sqlite",
    ".sqlite3",
    ".ttf",
    ".otf",
    ".woff",
    ".woff2",
    ".eot",
    ".mp3",
    ".wav",
    ".ogg",
    ".mp4",
    ".webm",
  ]);
  const walkWebProject = (curDir: string, depth: number) => {
    if (depth > 3) return;
    let dirItems: fs.Dirent[] = [];
    try {
      dirItems = fs
        .readdirSync(curDir, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name, "en"));
    } catch {
      return;
    }
    for (const item of dirItems) {
      if (item.name.startsWith(".")) continue;
      const lower = item.name.toLowerCase();
      if (
        lower.startsWith("_spck_") ||
        lower === "__pycache__" ||
        lower === "node_modules" ||
        lower === ".git" ||
        lower === ".venv" ||
        lower === "venv" ||
        lower === "build" ||
        lower === "dist"
      ) {
        continue;
      }
      let fullItemPath: string;
      try {
        fullItemPath = assertPathAllowed(path.join(curDir, item.name));
        const st = fs.lstatSync(fullItemPath);
        if (st.isSymbolicLink()) continue;
        if (st.isDirectory()) {
          walkWebProject(fullItemPath, depth + 1);
        } else if (st.isFile()) {
          if (
            lower === "links.txt" ||
            lower === "link.txt" ||
            lower.endsWith("_robotics_package.zip") ||
            lower.endsWith("_web_package.zip") ||
            lower.endsWith("_app_package.zip") ||
            lower.endsWith("_gamemaker.yyz")
          ) {
            continue;
          }
          const itemExt = path.extname(lower);
          if (itemExt === ".yyp") {
            gameMakerYypFiles.push(fullItemPath);
          } else if (itemExt === ".yyz") {
            hasRawYyzArchive = true;
          }
          if (itemExt === ".html" || itemExt === ".htm") {
            webHtmlFiles.push(fullItemPath);
            if (depth >= 1) hasSubfolderWebCode = true;
          } else if (depth >= 1 && WEB_SOURCE_BUNDLE_EXTS.has(itemExt)) {
            hasSubfolderWebCode = true;
          }
          if (APP_PRIMARY_CODE_EXTS.has(itemExt)) {
            appCodePrimaryFiles.push(fullItemPath);
            if (depth >= 1) hasSubfolderAppCode = true;
          }
          if (
            (WEB_SOURCE_BUNDLE_EXTS.has(itemExt) || APP_SOURCE_BUNDLE_EXTS.has(itemExt)) &&
            st.size > 0
          ) {
            if (st.size <= 15 * 1024 * 1024) {
              const rawBuf = fs.readFileSync(fullItemPath);
              if (!rawBuf.includes(0x00)) {
                const textContent = rawBuf.toString("utf8").replace(/^\uFEFF/, "");
                if (textContent.trim().length > 0) {
                  const relPosix = path
                    .relative(safeFolderPath, fullItemPath)
                    .split(path.sep)
                    .join("/");
                  if (relPosix && !relPosix.startsWith("..")) {
                    if (WEB_SOURCE_BUNDLE_EXTS.has(itemExt)) {
                      webSourceFiles.push({ fullPath: fullItemPath, relPosix });
                    }
                    if (APP_SOURCE_BUNDLE_EXTS.has(itemExt)) {
                      appSourceFiles.push({ fullPath: fullItemPath, relPosix });
                    }
                  }
                }
              }
            } else {
              warnings.push(
                `File mã nguồn '${item.name}' vượt quá giới hạn 15MB cho 1 tệp trong gói nén ZIP nên không tự động đóng gói.`
              );
            }
          } else if (APP_ASSET_BUNDLE_EXTS.has(itemExt) && st.size > 0) {
            if (st.size <= 15 * 1024 * 1024) {
              const relPosix = path
                .relative(safeFolderPath, fullItemPath)
                .split(path.sep)
                .join("/");
              if (relPosix && !relPosix.startsWith("..")) {
                appResourceAssets.push({
                  fullPath: fullItemPath,
                  relPosix,
                  size: st.size,
                  depth,
                });
              }
            } else {
              warnings.push(
                `Tài nguyên dự án '${item.name}' vượt quá giới hạn 15MB cho 1 tệp trong gói nén ZIP nên không tự động đóng gói.`
              );
            }
          }
        }
      } catch {
        continue;
      }
    }
  };
  walkWebProject(safeFolderPath, 0);
  const sortBundleSources = (list: Array<{ fullPath: string; relPosix: string }>) => {
    list.sort((a, b) => {
      const aDepth = a.relPosix.split("/").length - 1;
      const bDepth = b.relPosix.split("/").length - 1;
      if (aDepth !== bDepth) return aDepth - bDepth;
      const aPrimary = /\.(?:html?|css|js|mjs|py|ui|qss|ipynb)$/i.test(a.relPosix) ? 0 : 1;
      const bPrimary = /\.(?:html?|css|js|mjs|py|ui|qss|ipynb)$/i.test(b.relPosix) ? 0 : 1;
      if (aPrimary !== bPrimary) return aPrimary - bPrimary;
      return a.relPosix.localeCompare(b.relPosix, "en");
    });
  };
  sortBundleSources(webSourceFiles);
  sortBundleSources(appSourceFiles);
  const hasWebProjectHtmlFiles = webHtmlFiles.length > 0;
  const hasUnpackedGameMakerProject = !hasRawYyzArchive && gameMakerYypFiles.length > 0;
  const hasAppProjectCodeFiles = appCodePrimaryFiles.length > 0;
  const hasCodeOrUiProjectFiles = hasWebProjectHtmlFiles || hasAppProjectCodeFiles;
  const ownerRootPhotoPaths = findOwnerProvidedRootPhotos(safeFolderPath);
  const ownerRootPhotoKeySet = new Set(
    ownerRootPhotoPaths.map((p) => path.resolve(p).toLowerCase())
  );

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
      // In a Web (.html/.htm) or App/Code (.py/.ui/.qss/.ipynb/...) project, subfolders other than _spck_*
      // (such as img/, Image/, images/, Icon/, assets/, GUI/) contain project resource assets, not LMS product screenshots.
      const isSpckManagedImageDir =
        lowerDir === "_spck_app_shots" ||
        lowerDir === "_spck_owner_uploads" ||
        lowerDir === "_spck_youtube_frames";
      if (
        (lowerDir.startsWith("_spck_") && !isSpckManagedImageDir) ||
        (hasCodeOrUiProjectFiles && !isSpckManagedImageDir)
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
          const non16x9ShotJobs: Array<{ path: string; ext: string; buffer: Buffer }> = [];
          for (const subEntry of subEntries) {
            if (subEntry.name.startsWith(".")) continue;
            const subPath = assertPathAllowed(path.join(fullEntryPath, subEntry.name));
            const subStat = fs.lstatSync(subPath);
            if (subStat.isSymbolicLink() || !subStat.isFile()) continue;
            const subExt = path.extname(subEntry.name).toLowerCase();
            if (!ALLOWED_IMAGE_EXTENSIONS.has(subExt)) continue;
            try {
              const buf = fs.readFileSync(subPath);
              const dims = extractImageDimensionsFromBuffer(buf, subExt);
              if (
                dims &&
                dims.width > 0 &&
                dims.height > 0 &&
                Math.abs(dims.width / dims.height - 16 / 9) > 0.05
              ) {
                non16x9ShotJobs.push({ path: subPath, ext: subExt, buffer: buf });
              }
            } catch {}
          }
          if (!options?.skipSyncImageNormalize && non16x9ShotJobs.length > 0) {
            const normBufs = normalizeImagesToLms16x9Sync(
              non16x9ShotJobs.map((j) => ({ buffer: j.buffer, fit: "contain" }))
            );
            let renamedAny = false;
            for (let i = 0; i < non16x9ShotJobs.length; i++) {
              const nb = normBufs[i];
              const job = non16x9ShotJobs[i];
              if (nb && nb.length > 0) {
                try {
                  if (fs.lstatSync(job.path, { throwIfNoEntry: false })?.isSymbolicLink()) continue;
                  const targetPngPath =
                    job.ext === ".png"
                      ? job.path
                      : assertPathAllowed(
                          path.join(
                            fullEntryPath,
                            `${path.basename(job.path, job.ext)}.png`
                          )
                        );
                  if (fs.lstatSync(targetPngPath, { throwIfNoEntry: false })?.isSymbolicLink()) {
                    continue;
                  }
                  const tmpPngPath = `${targetPngPath}.tmp`;
                  if (fs.lstatSync(tmpPngPath, { throwIfNoEntry: false })) {
                    fs.unlinkSync(tmpPngPath);
                  }
                  fs.writeFileSync(tmpPngPath, nb);
                  fs.renameSync(tmpPngPath, targetPngPath);
                  if (job.ext !== ".png" && targetPngPath !== job.path) {
                    fs.unlinkSync(job.path);
                    renamedAny = true;
                  }
                } catch {}
              }
            }
            if (renamedAny) {
              subEntries = fs
                .readdirSync(fullEntryPath, { withFileTypes: true })
                .sort((a, b) => a.name.localeCompare(b.name, "en"));
            }
          }
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

    // Skip previously auto-generated robotics/web/app/gamemaker bundle or IDE/OS metadata files during re-scan
    if (
      lowerName.endsWith("_robotics_package.zip") ||
      lowerName.endsWith("_web_package.zip") ||
      lowerName.endsWith("_app_package.zip") ||
      lowerName.endsWith("_gamemaker.yyz") ||
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
        const hasCapturedOrWebAppContext =
          hasCodeOrUiProjectFiles ||
          entries.some(
            (e) =>
              e.name.toLowerCase() === "_spck_app_shots" ||
              /\.(?:html?|ui|py)$/i.test(e.name)
          );
        if (isOtherValidImageFormat && hasCapturedOrWebAppContext) {
          continue;
        }
        warnings.push(
          `Ảnh '${entry.name}' bị hỏng hoặc sai định dạng nên bị loại bỏ: ${mediaCheck.errorReason || "PARSE_ERROR"}`
        );
        continue;
      }
      // In a Web (.html/.htm) or App/Code (.py/.ui/...) project, root images that are neither Owner-provided photos
      // nor explicit thumbnails/screenshots (e.g. Icon.png, Matrix.png, logo.png) are project assets and not LMS product screenshots.
      if (
        hasCodeOrUiProjectFiles &&
        !ownerRootPhotoKeySet.has(path.resolve(fullEntryPath).toLowerCase()) &&
        !isThumbnailFilename(entry.name) &&
        !isExplicitProductScreenshotFilename(entry.name)
      ) {
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

    if (
      hasCodeOrUiProjectFiles &&
      (/\.(?:jfif|svg|ico|gif|bmp|avif|qrc|db|sqlite3?|woff2?|ttf|otf|eot|mp3|wav|ogg|mp4|webm|yyp|resource_order|bat|cmd|sh|rules|lock)$/i.test(
        lowerName
      ) ||
        lowerName === "firestore.rules")
    ) {
      continue;
    }

    warnings.push(`Đã bỏ qua file không thuộc danh mục hỗ trợ SPCK: '${entry.name}'`);
  }

  const safeSlugForBundle =
    stripVietnameseDiacritics(folderName)
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "student";

  const isNonAssetRootPhoto = (fullPath: string, depth: number) =>
    depth === 0 &&
    (ownerRootPhotoKeySet.has(path.resolve(fullPath).toLowerCase()) ||
      isThumbnailFilename(path.basename(fullPath)) ||
      isExplicitProductScreenshotFilename(path.basename(fullPath)));

  const nonOwnerAppAssets = appResourceAssets.filter(
    (asset) => !isNonAssetRootPhoto(asset.fullPath, asset.depth)
  );
  const hasSubfolderAppAssets = nonOwnerAppAssets.some((asset) => asset.depth >= 1);
  const hasUiWithRootAssets =
    appSourceFiles.some((f) => f.fullPath.toLowerCase().endsWith(".ui")) &&
    nonOwnerAppAssets.length > 0;

  // Package unpacked GameMaker Studio 2 (.yyp) project into a standard <safeSlug>_gamemaker.yyz archive
  if (hasUnpackedGameMakerProject) {
    try {
      const gmProjectRoot = path.dirname(gameMakerYypFiles[0]);
      const gmZipEntries: Array<{ entryName: string; data: Buffer }> = [];
      let totalGmBytes = 0;
      const GM_BUNDLE_EXTS = new Set([
        ".yyp",
        ".yy",
        ".gml",
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".wav",
        ".mp3",
        ".ogg",
        ".txt",
        ".json",
      ]);
      const walkGmDir = (curDir: string, depth: number) => {
        if (depth > 6 || gmZipEntries.length >= 1500) return;
        let items: fs.Dirent[] = [];
        try {
          items = fs
            .readdirSync(curDir, { withFileTypes: true })
            .sort((a, b) => a.name.localeCompare(b.name, "en"));
        } catch {
          return;
        }
        for (const item of items) {
          if (gmZipEntries.length >= 1500) break;
          if (item.name.startsWith(".")) continue;
          const lower = item.name.toLowerCase();
          if (
            lower.startsWith("_spck_") ||
            lower === ".git" ||
            lower === "node_modules" ||
            lower === "__pycache__" ||
            lower.endsWith("_gamemaker.yyz")
          ) {
            continue;
          }
          const fullItemPath = assertPathAllowed(path.join(curDir, item.name));
          const st = fs.lstatSync(fullItemPath);
          if (st.isSymbolicLink()) continue;
          const relPosix = path
            .relative(gmProjectRoot, fullItemPath)
            .split(path.sep)
            .join("/");
          if (!relPosix || relPosix.startsWith("..")) continue;
          if (st.isDirectory()) {
            // Skip duplicate sprite layer PNG folders (sprites/<name>/layers/...)
            if (relPosix.toLowerCase().startsWith("sprites/") && lower === "layers") {
              continue;
            }
            walkGmDir(fullItemPath, depth + 1);
          } else if (st.isFile()) {
            const ext = path.extname(lower);
            if (!GM_BUNDLE_EXTS.has(ext)) continue;
            if (st.size > 15 * 1024 * 1024) continue;
            if (st.size === 0 && ext !== ".gml") continue;
            if (totalGmBytes + st.size > 45 * 1024 * 1024) continue;
            const buf = fs.readFileSync(fullItemPath);
            gmZipEntries.push({ entryName: relPosix, data: buf });
            totalGmBytes += buf.length;
          }
        }
      };
      walkGmDir(gmProjectRoot, 0);
      if (gmZipEntries.length > 0) {
        const gmBundlePath = assertPathAllowed(
          path.join(safeFolderPath, `${safeSlugForBundle}_gamemaker.yyz`)
        );
        writeDeterministicZipFile(gmBundlePath, gmZipEntries);
        const yyzCheck = validateSpckAttachmentFile(gmBundlePath);
        if (yyzCheck.valid) {
          const filteredAttachments = validAttachments.filter(
            (attPath) => !/\.(?:yy|gml)$/i.test(attPath)
          );
          validAttachments.length = 0;
          validAttachments.push(gmBundlePath, ...filteredAttachments);
        } else {
          warnings.push(yyzCheck.reason || "Không thể xác thực gói GameMaker (.yyz) vừa đóng gói.");
        }
      }
    } catch (err) {
      warnings.push(
        `Lỗi khi đóng gói dự án GameMaker (.yyp): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } else {
    try {
      const staleGmYyz = assertPathAllowed(
        path.join(safeFolderPath, `${safeSlugForBundle}_gamemaker.yyz`)
      );
      if (fs.existsSync(staleGmYyz) && !fs.lstatSync(staleGmYyz).isSymbolicLink()) {
        fs.unlinkSync(staleGmYyz);
      }
    } catch {}
  }

  // Package multi-file / subfolder Web source files (.html/.htm/.css/.js/.mjs/...) into a single .zip attachment
  // when the student's Web project exceeds the 10-file LMS attachment limit or organizes code in subfolders.
  if (
    hasWebProjectHtmlFiles &&
    webSourceFiles.length > 0 &&
    (validAttachments.length > MAX_SPCK_ATTACHMENTS ||
      webSourceFiles.length > MAX_SPCK_ATTACHMENTS ||
      hasSubfolderWebCode)
  ) {
    try {
      const zipEntries: Array<{ entryName: string; data: Buffer }> = [];
      const bundledWebSourcePathKeys = new Set<string>();
      const skippedWebBundleFileNames: string[] = [];
      let totalWebZipBytes = 0;
      for (const webFile of webSourceFiles) {
        if (zipEntries.length >= MAX_SPCK_BUNDLE_ZIP_FILES) {
          skippedWebBundleFileNames.push(webFile.relPosix);
          continue;
        }
        const buf = fs.readFileSync(webFile.fullPath);
        if (totalWebZipBytes + buf.length > 45 * 1024 * 1024) {
          skippedWebBundleFileNames.push(webFile.relPosix);
          continue;
        }
        zipEntries.push({ entryName: webFile.relPosix, data: buf });
        bundledWebSourcePathKeys.add(path.resolve(webFile.fullPath).toLowerCase());
        totalWebZipBytes += buf.length;
      }
      for (const assetFile of nonOwnerAppAssets) {
        if (zipEntries.length >= MAX_SPCK_BUNDLE_ZIP_FILES) {
          skippedWebBundleFileNames.push(assetFile.relPosix);
          continue;
        }
        if (totalWebZipBytes + assetFile.size > 45 * 1024 * 1024) {
          skippedWebBundleFileNames.push(assetFile.relPosix);
          continue;
        }
        const buf = fs.readFileSync(assetFile.fullPath);
        zipEntries.push({ entryName: assetFile.relPosix, data: buf });
        totalWebZipBytes += buf.length;
      }
      const bundleZipPath = assertPathAllowed(
        path.join(safeFolderPath, `${safeSlugForBundle}_web_package.zip`)
      );
      writeDeterministicZipFile(bundleZipPath, zipEntries);
      const zipCheck = validateSpckAttachmentFile(bundleZipPath);
      if (zipCheck.valid) {
        const unbundledAttachments = validAttachments.filter(
          (attPath) => !bundledWebSourcePathKeys.has(path.resolve(attPath).toLowerCase())
        );
        validAttachments.length = 0;
        validAttachments.push(bundleZipPath, ...unbundledAttachments);
        if (skippedWebBundleFileNames.length > 0) {
          warnings.push(
            `Gói nén '${path.basename(bundleZipPath)}' đã đạt giới hạn an toàn (${MAX_SPCK_BUNDLE_ZIP_FILES} tệp / 45MB), không thể gộp thêm ${skippedWebBundleFileNames.length} tệp (${skippedWebBundleFileNames.slice(0, 5).join(", ")}${skippedWebBundleFileNames.length > 5 ? "..." : ""}).`
          );
        }
      } else {
        warnings.push(zipCheck.reason || "Không thể xác thực gói ZIP Web vừa đóng gói.");
      }
    } catch (err) {
      warnings.push(
        `Lỗi khi đóng gói ZIP cho mã nguồn Web: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } else {
    try {
      const staleWebZip = assertPathAllowed(
        path.join(safeFolderPath, `${safeSlugForBundle}_web_package.zip`)
      );
      if (fs.existsSync(staleWebZip) && !fs.lstatSync(staleWebZip).isSymbolicLink()) {
        fs.unlinkSync(staleWebZip);
      }
    } catch {}
  }

  // Package multi-file / subfolder App/Code source files (.py/.ui/.qss/.ipynb/...) and project assets (img/, Image/, Icon/...)
  // into a single .zip attachment when the student's App/Code project exceeds the 10-file LMS attachment limit or organizes code/UI/assets in subfolders.
  const hasAppUiOrQssFiles = appSourceFiles.some((f) => /\.(?:ui|qss)$/i.test(f.fullPath));
  if (
    !hasWebProjectHtmlFiles &&
    !hasUnpackedGameMakerProject &&
    !hasRawYyzArchive &&
    hasAppProjectCodeFiles &&
    appSourceFiles.length > 0 &&
    ((hasAppUiOrQssFiles &&
      (validAttachments.length > MAX_SPCK_ATTACHMENTS ||
        appSourceFiles.length > MAX_SPCK_ATTACHMENTS)) ||
      hasSubfolderAppCode ||
      hasSubfolderAppAssets ||
      hasUiWithRootAssets)
  ) {
    try {
      const zipEntries: Array<{ entryName: string; data: Buffer }> = [];
      const bundledSourcePathKeys = new Set<string>();
      const skippedBundleFileNames: string[] = [];
      let totalZipBytes = 0;
      for (const appFile of appSourceFiles) {
        if (zipEntries.length >= MAX_SPCK_BUNDLE_ZIP_FILES) {
          skippedBundleFileNames.push(appFile.relPosix);
          continue;
        }
        const buf = fs.readFileSync(appFile.fullPath);
        if (totalZipBytes + buf.length > 45 * 1024 * 1024) {
          skippedBundleFileNames.push(appFile.relPosix);
          continue;
        }
        zipEntries.push({ entryName: appFile.relPosix, data: buf });
        bundledSourcePathKeys.add(path.resolve(appFile.fullPath).toLowerCase());
        totalZipBytes += buf.length;
      }
      for (const assetFile of nonOwnerAppAssets) {
        if (zipEntries.length >= MAX_SPCK_BUNDLE_ZIP_FILES) {
          skippedBundleFileNames.push(assetFile.relPosix);
          continue;
        }
        if (totalZipBytes + assetFile.size > 45 * 1024 * 1024) {
          skippedBundleFileNames.push(assetFile.relPosix);
          continue;
        }
        const buf = fs.readFileSync(assetFile.fullPath);
        zipEntries.push({ entryName: assetFile.relPosix, data: buf });
        totalZipBytes += buf.length;
      }
      const bundleZipPath = assertPathAllowed(
        path.join(safeFolderPath, `${safeSlugForBundle}_app_package.zip`)
      );
      writeDeterministicZipFile(bundleZipPath, zipEntries);
      const zipCheck = validateSpckAttachmentFile(bundleZipPath);
      if (zipCheck.valid) {
        const unbundledAttachments = validAttachments.filter(
          (attPath) => !bundledSourcePathKeys.has(path.resolve(attPath).toLowerCase())
        );
        validAttachments.length = 0;
        validAttachments.push(bundleZipPath, ...unbundledAttachments);
        if (skippedBundleFileNames.length > 0) {
          warnings.push(
            `Gói nén '${path.basename(bundleZipPath)}' đã đạt giới hạn an toàn (${MAX_SPCK_BUNDLE_ZIP_FILES} tệp / 45MB), không thể gộp thêm ${skippedBundleFileNames.length} tệp (${skippedBundleFileNames.slice(0, 5).join(", ")}${skippedBundleFileNames.length > 5 ? "..." : ""}).`
          );
        }
      } else {
        warnings.push(zipCheck.reason || "Không thể xác thực gói ZIP App vừa đóng gói.");
      }
    } catch (err) {
      warnings.push(
        `Lỗi khi đóng gói ZIP cho mã nguồn App: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } else {
    try {
      const staleAppZip = assertPathAllowed(
        path.join(safeFolderPath, `${safeSlugForBundle}_app_package.zip`)
      );
      if (fs.existsSync(staleAppZip) && !fs.lstatSync(staleAppZip).isSymbolicLink()) {
        fs.unlinkSync(staleAppZip);
      }
    } catch {}
  }

  // Package valid raw Robotics files into a lossless .zip attachment ONLY if raw Robotics code/model files exist (T14).
  // When a Robotics student folder only contains photos provided by the Owner, do NOT create a .zip bundle.
  if (validRoboticsRawFiles.length > 0) {
    try {
      const zipEntries = validRoboticsRawFiles.map((robPath) => ({
        entryName: path.basename(robPath),
        data: fs.readFileSync(robPath),
      }));
      const bundleZipPath = assertPathAllowed(
        path.join(safeFolderPath, `${safeSlugForBundle}_robotics_package.zip`)
      );
      writeDeterministicZipFile(bundleZipPath, zipEntries);
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
  } else {
    try {
      const staleRobZip = assertPathAllowed(
        path.join(safeFolderPath, `${safeSlugForBundle}_robotics_package.zip`)
      );
      if (fs.existsSync(staleRobZip) && !fs.lstatSync(staleRobZip).isSymbolicLink()) {
        fs.unlinkSync(staleRobZip);
      }
    } catch {}
  }

  // Auto-render PyQt6 (.ui) app windows, GameMaker (.yyz/.yyp) / Scratch (.sb3) room/stage screenshots,
  // or pure-Python GUI/Streamlit app preview into _spck_app_shots when the student folder has no existing product images yet.
  if (!options?.skipSyncAutoRender && validImages.length === 0) {
    const uiRelList = findProjectUiFiles(safeFolderPath);
    if (uiRelList.length > 0) {
      try {
        const autoOutDir = assertPathAllowed(path.join(safeFolderPath, "_spck_app_shots"));
        const renderedUiShots = renderPyQtUiScreenshotsSync({
          studentDir: safeFolderPath,
          uiFiles: uiRelList,
          outDir: autoOutDir,
          maxShots: MAX_SPCK_SCREENSHOTS + 1,
        });
        for (const shot of renderedUiShots) {
          if (!shot?.filePath || !fs.existsSync(shot.filePath)) continue;
          const shotPath = assertPathAllowed(shot.filePath);
          const shotName = path.basename(shotPath);
          const shotExt = path.extname(shotName).toLowerCase();
          const buf = fs.readFileSync(shotPath);
          const mediaCheck = parseMediaBuffer(buf, shotName, shotExt);
          if (mediaCheck.success) {
            pushValidatedImage(shotName, shotPath, buf, shotExt);
          }
        }
      } catch {
        // Ignore auto-render errors during scan; teacher can still upload or capture manually
      }
    }
  }
  if (!options?.skipSyncAutoRender && validImages.length === 0) {
    const allGameFiles = findProjectGameFiles(safeFolderPath);
    const validAttKeySet = new Set(validAttachments.map((p) => path.resolve(p).toLowerCase()));
    const isSafeValidatedGameSource = (rel: string): boolean => {
      try {
        const full = assertPathAllowed(path.join(safeFolderPath, rel));
        if (rel.toLowerCase().endsWith(".yyp")) {
          return hasUnpackedGameMakerProject;
        }
        if (validAttKeySet.has(path.resolve(full).toLowerCase())) {
          return true;
        }
        return validateSpckAttachmentFile(full).valid;
      } catch {
        return false;
      }
    };
    const yyzRelList = allGameFiles.yyzFiles.filter(isSafeValidatedGameSource);
    const sb3RelList = allGameFiles.sb3Files.filter(isSafeValidatedGameSource);
    if (yyzRelList.length > 0 || sb3RelList.length > 0) {
      try {
        const autoOutDir = assertPathAllowed(path.join(safeFolderPath, "_spck_app_shots"));
        const renderedShots = renderGameArchiveScreenshotsSync({
          studentDir: safeFolderPath,
          yyzFiles: yyzRelList,
          sb3Files: sb3RelList,
          outDir: autoOutDir,
          maxShots: MAX_SPCK_SCREENSHOTS + 1,
        });
        for (const shot of renderedShots) {
          if (!shot?.filePath || !fs.existsSync(shot.filePath)) continue;
          const shotPath = assertPathAllowed(shot.filePath);
          const shotName = path.basename(shotPath);
          const shotExt = path.extname(shotName).toLowerCase();
          const buf = fs.readFileSync(shotPath);
          const mediaCheck = parseMediaBuffer(buf, shotName, shotExt);
          if (mediaCheck.success) {
            pushValidatedImage(shotName, shotPath, buf, shotExt);
          }
        }
      } catch {
        // Ignore auto-render errors during scan; teacher can still upload or capture manually
      }
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
  const ownerRootImages = ownerRootPhotoPaths
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
    screenshotCandidates =
      ordered.length > 0 || youtubeFrameImages.length > 0
        ? ordered
        : [chosenOwnerThumb.fullPath];
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
 * Infers a candidate student from high-signal UI/code titles inside a folder when the
 * folder itself has a generic name (e.g., "bai thuyet tring" containing "MINH HYPERCAR CLUB").
 * Always requires manual teacher confirmation (`autoConfirmed: false`).
 */
function inferStudentFromFolderCodeHints(
  folderPath: string,
  unmatchedStudents: StudentCandidate[],
  allStudents: StudentCandidate[]
): StudentCandidate | null {
  if (unmatchedStudents.length === 0) return null;

  const titleHints: string[] = [];
  const inspectedFiles: string[] = [];

  const collectCodeFiles = (dir: string, depth: number) => {
    if (depth > 3 || inspectedFiles.length >= 25) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (inspectedFiles.length >= 25) break;
      const name = entry.name;
      if (name.startsWith(".") || name.startsWith("_spck_")) continue;
      const fullPath = path.join(dir, name);
      if (entry.isDirectory()) {
        const lower = name.toLowerCase();
        if (lower === "node_modules" || lower === "__pycache__" || lower === "venv" || lower === ".venv") {
          continue;
        }
        collectCodeFiles(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(name).toLowerCase();
        if (ext === ".ui" || ext === ".py" || ext === ".html" || ext === ".htm") {
          inspectedFiles.push(fullPath);
        }
      }
    }
  };

  collectCodeFiles(folderPath, 0);
  if (inspectedFiles.length === 0) return null;

  for (const filePath of inspectedFiles) {
    let raw = "";
    try {
      raw = fs.readFileSync(filePath, "utf-8").slice(0, 60000);
    } catch {
      continue;
    }
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".ui") {
      for (const m of raw.matchAll(/<class>\s*([^<]{2,80})\s*<\/class>/gi)) {
        const camelSplit = (m[1] || "").replace(/([a-z])([A-Z])/g, "$1 $2");
        titleHints.push(camelSplit);
      }
      for (const m of raw.matchAll(
        /<property\s+name="windowTitle">\s*<string[^>]*>([^<]{2,120})<\/string>/gi
      )) {
        titleHints.push(m[1] || "");
      }
      let textCount = 0;
      for (const m of raw.matchAll(
        /<property\s+name="text">\s*<string[^>]*>([^<]{2,90})<\/string>/gi
      )) {
        titleHints.push(m[1] || "");
        textCount++;
        if (textCount >= 4) break;
      }
    } else if (ext === ".py") {
      for (const m of raw.matchAll(/setWindowTitle\s*\(\s*["']([^"']{2,120})["']\s*\)/gi)) {
        titleHints.push(m[1] || "");
      }
      const headLines = raw.split(/\r?\n/).slice(0, 10);
      for (const line of headLines) {
        if (/^\s*#/.test(line)) {
          titleHints.push(line.replace(/^\s*#+/, ""));
        }
      }
    } else if (ext === ".html" || ext === ".htm") {
      for (const m of raw.matchAll(/<(?:title|h1)\b[^>]*>([^<]{2,120})<\/(?:title|h1)>/gi)) {
        titleHints.push(m[1] || "");
      }
    }
  }

  const normalizedHints = titleHints
    .map((h) => normalizeVietnameseName(h))
    .filter((h) => h.length >= 2);
  if (normalizedHints.length === 0) return null;

  // 1. Check multi-token full name or (middle + given) suffix match among unmatched students
  const phraseMatches = unmatchedStudents.filter((stu) => {
    const stuNorm = normalizeVietnameseName(stu.fullName);
    const stuTokens = stuNorm.split(" ").filter(Boolean);
    if (stuTokens.length < 2) return false;
    const lastTwo = stuTokens.slice(-2).join(" ");
    return normalizedHints.some(
      (hint) =>
        ` ${hint} `.includes(` ${stuNorm} `) ||
        (lastTwo.length >= 5 && ` ${hint} `.includes(` ${lastTwo} `))
    );
  });
  if (phraseMatches.length === 1) {
    return phraseMatches[0];
  }

  // 2. Check unique given-name token in class appearing in window/class/heading titles
  const classGivenNameCounts = new Map<string, number>();
  for (const stu of allStudents) {
    const tokens = normalizeVietnameseName(stu.fullName).split(" ").filter(Boolean);
    const given = tokens[tokens.length - 1] || "";
    if (given.length >= 2) {
      classGivenNameCounts.set(given, (classGivenNameCounts.get(given) || 0) + 1);
    }
  }

  const hintTokenSet = new Set<string>();
  for (const hint of normalizedHints) {
    for (const tok of hint.split(" ")) {
      if (tok.length >= 2) hintTokenSet.add(tok);
    }
  }

  const givenMatches = unmatchedStudents.filter((stu) => {
    const tokens = normalizeVietnameseName(stu.fullName).split(" ").filter(Boolean);
    const given = tokens[tokens.length - 1] || "";
    if (given.length < 2) return false;
    if ((classGivenNameCounts.get(given) || 0) !== 1) return false;
    return hintTokenSet.has(given);
  });

  if (givenMatches.length === 1) {
    return givenMatches[0];
  }

  return null;
}

function isSampleOrTemplateFolderName(folderName: string): boolean {
  const ascii = stripVietnameseDiacritics(folderName).toLowerCase();
  return /(?:^|[^a-z0-9])(?:samples?|templates?|bai[\s_-]*mau|bo[\s_-]*khung|code[\s_-]*mau)(?:$|[^a-z0-9])/i.test(
    ascii
  );
}

const NON_STUDENT_SUBFOLDER_NAMES = new Set([
  "node_modules",
  "__pycache__",
  "venv",
  ".venv",
  "build",
  "dist",
  "img",
  "imgs",
  "image",
  "images",
  "icon",
  "icons",
  "assets",
  "asset",
  "static",
  "public",
  "css",
  "js",
  "style",
  "styles",
  "scripts",
  "script",
  "src",
  "gui",
  "ui",
  "data",
  "db",
  "fonts",
  "font",
  "audio",
  "sound",
  "sounds",
  "media",
  "sprites",
  "objects",
  "rooms",
  "options",
]);

function inferStudentFromSingleNestedChildFolder(
  folderPath: string,
  unmatchedStudents: StudentCandidate[]
): { student: StudentCandidate; childFolderName: string; score: number } | null {
  if (unmatchedStudents.length === 0) return null;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(folderPath, { withFileTypes: true });
  } catch {
    return null;
  }
  const childDirs = entries.filter((e) => {
    if (!e.isDirectory() || e.name.startsWith(".")) return false;
    const lower = e.name.toLowerCase();
    if (lower.startsWith("_spck_") || NON_STUDENT_SUBFOLDER_NAMES.has(lower)) return false;
    if (isSampleOrTemplateFolderName(e.name)) return false;
    return true;
  });
  if (childDirs.length !== 1) return null;
  const childName = childDirs[0].name;
  const scored = unmatchedStudents
    .map((stu) => ({
      student: stu,
      score: calculateNameSimilarity(childName, stu.fullName),
    }))
    .filter((item) => item.score >= 0.7)
    .sort((a, b) => b.score - a.score);
  if (
    scored.length >= 1 &&
    (scored.length === 1 || scored[0].score - scored[1].score >= 0.05)
  ) {
    return {
      student: scored[0].student,
      childFolderName: childName,
      score: scored[0].score,
    };
  }
  return null;
}

/**
 * Scans the entire class SPCK root directory, matches each student subfolder against LMS student records,
 * and returns a structured list ready for the Mapping Table and SQLite persistence.
 */
export function scanClassSpckDirectory(
  classId: string,
  rootFolderPath: string,
  students: StudentCandidate[],
  options?: { skipSyncAutoRender?: boolean; skipSyncImageNormalize?: boolean }
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
  const preliminaryResults: FolderStudentMatchResult[] = rawMatchResults.map((rawMatch) => {
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

  const claimedStudentIds = new Set<string>();
  for (const m of preliminaryResults) {
    if (m.suggestedStudentId) claimedStudentIds.add(m.suggestedStudentId);
  }
  for (const confirmedId of confirmedFolderByStudent.keys()) {
    claimedStudentIds.add(confirmedId);
  }

  const afterCodeHintResults: FolderStudentMatchResult[] = preliminaryResults.map((match) => {
    if (match.suggestedStudentId || isSampleOrTemplateFolderName(match.folderName)) {
      return match;
    }
    const unmatchedCandidates = students.filter(
      (s) => !claimedStudentIds.has(s.studentId) && !detachedStudents.has(s.studentId)
    );
    const nestedChildMatch = inferStudentFromSingleNestedChildFolder(
      match.folderPath,
      unmatchedCandidates
    );
    if (nestedChildMatch) {
      claimedStudentIds.add(nestedChildMatch.student.studentId);
      return {
        ...match,
        suggestedStudentId: nestedChildMatch.student.studentId,
        suggestedStudentName: nestedChildMatch.student.fullName,
        matchScore: nestedChildMatch.score,
        autoConfirmed: false,
        requiresManualConfirmation: true,
        warningReasons: [
          `Gợi ý học viên từ tên thư mục con bên trong ('${nestedChildMatch.childFolderName}')`,
        ],
      };
    }

    const inferredStu = inferStudentFromFolderCodeHints(
      match.folderPath,
      unmatchedCandidates,
      students
    );
    if (!inferredStu) return match;

    claimedStudentIds.add(inferredStu.studentId);
    return {
      ...match,
      suggestedStudentId: inferredStu.studentId,
      suggestedStudentName: inferredStu.fullName,
      matchScore: 0.68,
      autoConfirmed: false,
      requiresManualConfirmation: true,
      warningReasons: [
        "Gợi ý học viên từ tiêu đề giao diện bên trong dự án (tên thư mục chung chung)",
      ],
    };
  });

  const remainingUnmatchedFolders = afterCodeHintResults.filter(
    (m) => !m.suggestedStudentId && !isSampleOrTemplateFolderName(m.folderName)
  );
  const remainingUnmatchedStudents = students.filter(
    (s) => !claimedStudentIds.has(s.studentId) && !detachedStudents.has(s.studentId)
  );
  const matchResults: FolderStudentMatchResult[] =
    remainingUnmatchedFolders.length === 1 &&
    remainingUnmatchedStudents.length === 1 &&
    Boolean(extractFolderNameVariants(remainingUnmatchedFolders[0].folderName).isGenericOnly)
      ? afterCodeHintResults.map((match) => {
          if (match.suggestedStudentId || isSampleOrTemplateFolderName(match.folderName)) {
            return match;
          }
          const lastStu = remainingUnmatchedStudents[0];
          return {
            ...match,
            suggestedStudentId: lastStu.studentId,
            suggestedStudentName: lastStu.fullName,
            matchScore: 0.6,
            autoConfirmed: false,
            requiresManualConfirmation: true,
            warningReasons: [
              "Gợi ý học viên còn lại duy nhất trong lớp (tên thư mục chung chung, cần giáo viên xác nhận)",
            ],
          };
        })
      : afterCodeHintResults;

  const items: ScannedClassSpckItem[] = matchResults.map((match) => {
    const matchedStudent = match.suggestedStudentId
      ? studentMap.get(match.suggestedStudentId)
      : undefined;
    const packageData = scanStudentSpckFolder(
      match.folderPath,
      matchedStudent?.fullName || match.folderName,
      options
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

async function normalizeStudentAppShotsFolderAsync(safeFolderPath: string): Promise<void> {
  if (taskQueue.getStatus().isStopped) return;
  try {
    const appShotsDir = assertPathAllowed(path.join(safeFolderPath, "_spck_app_shots"));
    if (!fs.existsSync(appShotsDir)) return;
    const dirStat = fs.lstatSync(appShotsDir);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) return;

    const rawSubEntries = fs
      .readdirSync(appShotsDir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, "en"));
    const bySlotKey = new Map<string, { entry: fs.Dirent; mtimeMs: number }>();
    for (const se of rawSubEntries) {
      if (se.name.startsWith(".")) continue;
      const slotMatch = se.name.match(/^(app_\d+_.*?)_[0-9a-f]{6}\.png$/i);
      const slotKey = slotMatch ? slotMatch[1].toLowerCase() : se.name.toLowerCase();
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(path.join(appShotsDir, se.name)).mtimeMs;
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

    const subEntries = Array.from(bySlotKey.values())
      .map((v) => v.entry)
      .sort((a, b) => a.name.localeCompare(b.name, "en"));

    const non16x9ShotJobs: Array<{ path: string; ext: string; buffer: Buffer }> = [];
    for (const subEntry of subEntries) {
      if (subEntry.name.startsWith(".")) continue;
      const subPath = assertPathAllowed(path.join(appShotsDir, subEntry.name));
      const subStat = fs.lstatSync(subPath);
      if (subStat.isSymbolicLink() || !subStat.isFile()) continue;
      const subExt = path.extname(subEntry.name).toLowerCase();
      if (!ALLOWED_IMAGE_EXTENSIONS.has(subExt)) continue;
      try {
        const buf = fs.readFileSync(subPath);
        const dims = extractImageDimensionsFromBuffer(buf, subExt);
        if (
          dims &&
          dims.width > 0 &&
          dims.height > 0 &&
          Math.abs(dims.width / dims.height - 16 / 9) > 0.05
        ) {
          non16x9ShotJobs.push({ path: subPath, ext: subExt, buffer: buf });
        }
      } catch {}
    }

    if (non16x9ShotJobs.length === 0 || taskQueue.getStatus().isStopped) {
      return;
    }

    const normBufs = await normalizeImagesToLms16x9(
      non16x9ShotJobs.map((j) => ({ buffer: j.buffer, fit: "contain" }))
    );

    for (let i = 0; i < non16x9ShotJobs.length; i++) {
      const nb = normBufs[i];
      const job = non16x9ShotJobs[i];
      if (!nb || nb.length === 0) continue;
      try {
        if (fs.lstatSync(job.path, { throwIfNoEntry: false })?.isSymbolicLink()) continue;
        const targetPngPath =
          job.ext === ".png"
            ? job.path
            : assertPathAllowed(
                path.join(appShotsDir, `${path.basename(job.path, job.ext)}.png`)
              );
        if (fs.lstatSync(targetPngPath, { throwIfNoEntry: false })?.isSymbolicLink()) {
          continue;
        }
        const tmpPngPath = `${targetPngPath}.tmp`;
        if (fs.lstatSync(tmpPngPath, { throwIfNoEntry: false })) {
          fs.unlinkSync(tmpPngPath);
        }
        fs.writeFileSync(tmpPngPath, nb);
        fs.renameSync(tmpPngPath, targetPngPath);
        if (job.ext !== ".png" && targetPngPath !== job.path) {
          fs.unlinkSync(job.path);
        }
      } catch {}
    }
  } catch {
    // Ignore non-fatal normalization errors during async scan
  }
}

/**
 * Non-blocking async variant of `scanStudentSpckFolder`: performs fast filesystem validation
 * without blocking the Node.js Event Loop on Python subprocess rendering (`renderPyQtUiScreenshotsAsync`,
 * `renderGameArchiveScreenshotsAsync`, or legacy `_spck_app_shots` JPEG normalization), supporting
 * timeout and Emergency Stop.
 */
export async function scanStudentSpckFolderAsync(
  studentFolderPath: string,
  preferredStudentName?: string
): Promise<StudentSpckPackage> {
  const safeFolderPath = assertPathAllowed(studentFolderPath);
  await normalizeStudentAppShotsFolderAsync(safeFolderPath);

  const initial = scanStudentSpckFolder(safeFolderPath, preferredStudentName, {
    skipSyncAutoRender: true,
    skipSyncImageNormalize: true,
  });

  const hasExistingRealOrRenderedShots =
    (initial.allScreenshots?.length ?? initial.screenshots.length) > 0 ||
    (Boolean(initial.thumbnailPath) &&
      path.resolve(initial.thumbnailPath) !== path.resolve(DEFAULT_SPCK_THUMBNAIL_PATH));

  if (hasExistingRealOrRenderedShots || taskQueue.getStatus().isStopped) {
    return initial;
  }

  let renderedAny = false;
  const uiRelList = findProjectUiFiles(safeFolderPath);
  if (uiRelList.length > 0 && !taskQueue.getStatus().isStopped) {
    try {
      const autoOutDir = assertPathAllowed(path.join(safeFolderPath, "_spck_app_shots"));
      const renderedUiShots = await renderPyQtUiScreenshotsAsync({
        studentDir: safeFolderPath,
        uiFiles: uiRelList,
        outDir: autoOutDir,
        maxShots: MAX_SPCK_SCREENSHOTS + 1,
      });
      if (renderedUiShots.some((s) => Boolean(s?.filePath) && fs.existsSync(s.filePath))) {
        renderedAny = true;
      }
    } catch {
      // Ignore auto-render errors during scan; teacher can still upload or capture manually
    }
  }

  if (!renderedAny && !taskQueue.getStatus().isStopped) {
    const allGameFiles = findProjectGameFiles(safeFolderPath);
    const validAttKeySet = new Set(
      (initial.allAttachments || initial.attachments).map((p) => path.resolve(p).toLowerCase())
    );
    let hasUnpackedYyp = false;
    try {
      const topEntries = fs.readdirSync(safeFolderPath, { withFileTypes: true });
      hasUnpackedYyp = topEntries.some(
        (d) => d.isFile() && d.name.toLowerCase().endsWith(".yyp")
      );
    } catch {}

    const isSafeValidatedGameSource = (rel: string): boolean => {
      try {
        const full = assertPathAllowed(path.join(safeFolderPath, rel));
        if (rel.toLowerCase().endsWith(".yyp")) {
          return hasUnpackedYyp;
        }
        if (validAttKeySet.has(path.resolve(full).toLowerCase())) {
          return true;
        }
        return validateSpckAttachmentFile(full).valid;
      } catch {
        return false;
      }
    };

    const yyzRelList = allGameFiles.yyzFiles.filter(isSafeValidatedGameSource);
    const sb3RelList = allGameFiles.sb3Files.filter(isSafeValidatedGameSource);
    if (yyzRelList.length > 0 || sb3RelList.length > 0) {
      try {
        const autoOutDir = assertPathAllowed(path.join(safeFolderPath, "_spck_app_shots"));
        const renderedGameShots = await renderGameArchiveScreenshotsAsync({
          studentDir: safeFolderPath,
          yyzFiles: yyzRelList,
          sb3Files: sb3RelList,
          outDir: autoOutDir,
          maxShots: MAX_SPCK_SCREENSHOTS + 1,
        });
        if (renderedGameShots.some((s) => Boolean(s?.filePath) && fs.existsSync(s.filePath))) {
          renderedAny = true;
        }
      } catch {
        // Ignore auto-render errors during scan; teacher can still upload or capture manually
      }
    }
  }

  if (!renderedAny) {
    return initial;
  }

  await normalizeStudentAppShotsFolderAsync(safeFolderPath);
  return scanStudentSpckFolder(safeFolderPath, preferredStudentName, {
    skipSyncAutoRender: true,
    skipSyncImageNormalize: true,
  });
}

/**
 * Non-blocking async variant of `scanClassSpckDirectory` used by API routes so PyQt/GameMaker
 * screenshot rendering and legacy `_spck_app_shots` JPEG normalization never block the Node.js Event Loop.
 */
export async function scanClassSpckDirectoryAsync(
  classId: string,
  rootFolderPath: string,
  students: StudentCandidate[]
): Promise<ScanClassSpckDirectoryResult> {
  const safeRootPath = assertPathAllowed(rootFolderPath);
  if (fs.existsSync(safeRootPath)) {
    try {
      const rootStat = fs.lstatSync(safeRootPath);
      if (!rootStat.isSymbolicLink() && rootStat.isDirectory()) {
        const subDirs = fs
          .readdirSync(safeRootPath, { withFileTypes: true })
          .filter((d) => {
            if (d.name.startsWith(".")) return false;
            const lower = d.name.toLowerCase();
            if (lower.startsWith("_spck_") || NON_STUDENT_SUBFOLDER_NAMES.has(lower)) return false;
            try {
              const full = assertPathAllowed(path.join(safeRootPath, d.name));
              const st = fs.lstatSync(full);
              return !st.isSymbolicLink() && st.isDirectory();
            } catch {
              return false;
            }
          })
          .sort((a, b) => a.name.localeCompare(b.name, "en"));

        for (const sub of subDirs) {
          if (taskQueue.getStatus().isStopped) break;
          const fullSubPath = assertPathAllowed(path.join(safeRootPath, sub.name));
          await normalizeStudentAppShotsFolderAsync(fullSubPath);
        }
      }
    } catch {
      // Let scanClassSpckDirectory throw structured validation errors if rootFolderPath is invalid
    }
  }

  const fastResult = scanClassSpckDirectory(classId, rootFolderPath, students, {
    skipSyncAutoRender: true,
    skipSyncImageNormalize: true,
  });

  const studentMap = new Map(students.map((s) => [s.studentId, s]));
  for (const item of fastResult.items) {
    if (taskQueue.getStatus().isStopped) {
      break;
    }
    const hasShots =
      (item.packageData.allScreenshots?.length ?? item.packageData.screenshots.length) > 0 ||
      (Boolean(item.packageData.thumbnailPath) &&
        path.resolve(item.packageData.thumbnailPath) !==
          path.resolve(DEFAULT_SPCK_THUMBNAIL_PATH));
    if (!hasShots) {
      const matchedStudent = item.match.suggestedStudentId
        ? studentMap.get(item.match.suggestedStudentId)
        : undefined;
      item.packageData = await scanStudentSpckFolderAsync(
        item.folderPath,
        matchedStudent?.fullName || item.folderName
      );
    }
  }

  return fastResult;
}
