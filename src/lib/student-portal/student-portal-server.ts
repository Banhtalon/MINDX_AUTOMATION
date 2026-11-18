/**
 * MINDX AUTOMATION BOT - STUDENT SPCK UPLOAD PORTAL SERVER (DIRECTION 1)
 * Provides an isolated, token-protected HTTP server + automatic Public Internet Tunnel
 * (Cloudflare Quick Tunnel / SSH Tunnel + Classroom LAN IP) so students can select their name,
 * drag-and-drop their Final Project (SPCK) folder or files, and have them automatically:
 *   1. Saved into the teacher's local class SPCK folder (<rootFolderPath>/<StudentFullName>/)
 *   2. Scanned and mapped 100% to their exact `studentId` in SQLite (`spck_uploads`)
 *   3. Uploaded automatically to Google Drive (`CODING - SPCK -> Course -> Class -> Student`)
 *      with the Google Drive folder link attached to `relatedLinksJson` for LMS submission.
 */

import { type ChildProcess, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import AdmZip from "adm-zip";
import {
  canonicalizeSpckFolderPath,
  classSessionRepo,
  getDb,
  jobLogRepo,
  normalizeSpckFolderKey,
  spckSessionRepo,
  spckUploadRepo,
  studentRepo,
  type SpckSessionNumber,
} from "../db/sqlite";
import { SpckWebDeployer } from "../github/spck-web-deployer";
import { captureClassAppScreenshotsAndSelectThumbnails } from "../local-files/spck-app-screenshotter";
import {
  computeStudentFolderContentDigest,
  isWebOrCsGithubTrack,
  MAX_SPCK_TITLE_LENGTH,
  resolveStudentFolderInsideClassRoot,
  resolveTargetSpckClassFolder,
  sanitizeSpckTitle,
  scanStudentSpckFolderAsync,
  type StudentSpckPackage,
  validateSpckRelatedUrl,
  validateSpckYoutubeUrl,
} from "../local-files/spck-scanner";
import {
  DEFAULT_SPCK_DRIVE_FOLDER_URL,
  isCourseExemptFromSpck,
  SpckDriveUploader,
} from "../playwright/spck-drive-uploader";
import { SequentialTaskQueue } from "../queue/task-queue";
import {
  assertPathAllowed,
  registerTeacherSelectedDirectory,
} from "../security/path-allowlist";

export interface StudentPortalSubmissionItem {
  classId?: string;
  studentId: string;
  fullName: string;
  folderName: string;
  folderPath: string;
  projectTitle: string;
  filesCount: number;
  totalBytes: number;
  submittedAt: string;
  confirmedByTeacher?: boolean;
  driveStatus: "IDLE" | "QUEUED" | "UPLOADING" | "UPLOADED" | "EXEMPT" | "FAILED";
  driveFolderUrl?: string;
  driveError?: string;
}

export interface StudentPortalStatus {
  isRunning: boolean;
  stateVersion: number;
  classId: string;
  className: string;
  rootFolderPath: string;
  driveFolderUrl: string;
  autoUploadDrive: boolean;
  sessionToken: string;
  port: number;
  localUrl: string;
  lanUrl: string;
  publicTunnelUrl: string | null;
  primaryShareUrl: string;
  tunnelStatus: "STOPPED" | "STARTING" | "READY" | "LAN_ONLY";
  tunnelProvider: string;
  startedAt: string | null;
  submissions: StudentPortalSubmissionItem[];
}

export interface StartStudentPortalOptions {
  classId: string;
  folderPath?: string;
  driveFolderUrl?: string;
  autoUploadDrive?: boolean;
  requireTeacherConfirmation?: boolean;
  sessionNumber?: SpckSessionNumber;
}

interface IncomingStudentFilePayload {
  relativePath: string;
  base64Data: string;
}

interface IncomingStudentUploadBody {
  studentId: string;
  projectTitle?: string;
  youtubeUrl?: string;
  presentationUrl?: string;
  replaceExisting?: boolean;
  files: IncomingStudentFilePayload[];
}

const MAX_UPLOAD_BODY_BYTES = 180 * 1024 * 1024; // 180 MB JSON payload limit
const MAX_TOTAL_RAW_BYTES = 130 * 1024 * 1024; // 130 MB raw files limit per student submission
const MAX_FILES_PER_SUBMISSION = 600;
const MAX_RELATIVE_PATH_DEPTH = 10;

const IGNORED_PATH_SEGMENTS = new Set([
  "__pycache__",
  "__macosx",
  "node_modules",
  ".git",
  ".venv",
  "venv",
  "env",
  ".idea",
  ".vscode",
  "_spck_app_shots",
  "_spck_owner_uploads",
  "_spck_youtube_frames",
  "_spck_prev_backup",
  "_spck_temp",
  "_portal_backups",
]);

export const UNSUPPORTED_ARCHIVE_EXTENSIONS = new Set([
  ".rar",
  ".7z",
  ".tar",
  ".gz",
  ".bz2",
  ".xz",
]);

export const FORBIDDEN_EXECUTABLE_EXTENSIONS = new Set([
  ".exe",
  ".dll",
  ".bat",
  ".cmd",
  ".ps1",
  ".vbs",
  ".msi",
  ".scr",
  ".com",
  ".pif",
  ".lnk",
  ".hta",
  ".jar",
  ".reg",
  ".wsf",
]);

const WINDOWS_RESERVED_BASENAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

export type RelativeUploadPathInspection =
  | { status: "OK"; cleanRelPath: string }
  | { status: "IGNORED" }
  | { status: "REJECTED"; error: string };

function getLanIpAddress(): string {
  try {
    const interfaces = os.networkInterfaces();
    const candidates: string[] = [];
    for (const name of Object.keys(interfaces)) {
      const netList = interfaces[name] || [];
      for (const net of netList) {
        if (net.family === "IPv4" && !net.internal) {
          if (
            net.address.startsWith("192.168.") ||
            net.address.startsWith("10.") ||
            /^172\.(1[6-9]|2\d|3[0-1])\./.test(net.address)
          ) {
            candidates.unshift(net.address);
          } else {
            candidates.push(net.address);
          }
        }
      }
    }
    return candidates[0] || "127.0.0.1";
  } catch {
    return "127.0.0.1";
  }
}

function sanitizeFolderDisplayName(fullName: string, fallbackId: string): string {
  const cleaned = String(fullName || fallbackId)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "")
    .trim();
  return cleaned || fallbackId;
}

export function inspectRelativeUploadPath(rawRelPath: string): RelativeUploadPathInspection {
  const normalized = String(rawRelPath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .trim();
  if (!normalized) return { status: "IGNORED" };

  const rawSegments = normalized.split("/").filter((s) => s.length > 0);
  if (rawSegments.length === 0) return { status: "IGNORED" };

  for (const seg of rawSegments) {
    if (seg.trim() === "..") {
      return {
        status: "REJECTED",
        error: `Đường dẫn tệp chứa ký tự điều hướng không hợp lệ ('..'): '${rawRelPath}'.`,
      };
    }
  }

  // 1. Always enforce forbidden executable extension check FIRST at any folder depth
  const lastRawSeg = rawSegments[rawSegments.length - 1].trim();
  const rawLastExt = path.extname(lastRawSeg).toLowerCase();
  const cleanLastCandidate = lastRawSeg
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[\s.]+$/, "")
    .trim();
  const cleanLastExt = path.extname(cleanLastCandidate).toLowerCase();
  if (
    FORBIDDEN_EXECUTABLE_EXTENSIONS.has(rawLastExt) ||
    FORBIDDEN_EXECUTABLE_EXTENSIONS.has(cleanLastExt)
  ) {
    return {
      status: "REJECTED",
      error: `Tệp thực thi bị cấm không được phép nộp qua cổng trực tuyến: '${lastRawSeg}'. Vui lòng bỏ tệp này ra khỏi thư mục dự án.`,
    };
  }
  if (
    UNSUPPORTED_ARCHIVE_EXTENSIONS.has(rawLastExt) ||
    UNSUPPORTED_ARCHIVE_EXTENSIONS.has(cleanLastExt)
  ) {
    return {
      status: "REJECTED",
      error: `Hệ thống không hỗ trợ định dạng nén '${lastRawSeg}' (.rar/.7z). Vui lòng nén dạng .zip hoặc chọn trực tiếp cả thư mục dự án.`,
    };
  }

  const safeSegments: string[] = [];
  for (let idx = 0; idx < rawSegments.length; idx++) {
    const trimmed = rawSegments[idx].trim();
    if (!trimmed || trimmed === ".") {
      return { status: "IGNORED" };
    }
    const isFinalGitkeep =
      idx === rawSegments.length - 1 && trimmed.toLowerCase() === ".gitkeep";
    if (trimmed.startsWith(".") && !isFinalGitkeep) {
      return { status: "IGNORED" };
    }
    const lowerTrimmed = trimmed.toLowerCase();
    if (
      IGNORED_PATH_SEGMENTS.has(lowerTrimmed) ||
      lowerTrimmed.startsWith("_spck_") ||
      lowerTrimmed.startsWith(".spck_portal_")
    ) {
      return { status: "IGNORED" };
    }
    const cleanSeg = isFinalGitkeep
      ? ".gitkeep"
      : trimmed
          .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
          .replace(/\.+$/, "")
          .trim();
    if (!cleanSeg) return { status: "IGNORED" };
    const stemLower = cleanSeg.split(".")[0]?.toLowerCase() || "";
    if (WINDOWS_RESERVED_BASENAMES.has(stemLower)) {
      return {
        status: "REJECTED",
        error: `Tên tệp/thư mục trùng tên thiết bị hệ thống Windows không hợp lệ: '${cleanSeg}'.`,
      };
    }
    safeSegments.push(cleanSeg);
  }

  const finalExt = path.extname(safeSegments[safeSegments.length - 1]).toLowerCase();
  if (FORBIDDEN_EXECUTABLE_EXTENSIONS.has(finalExt)) {
    return {
      status: "REJECTED",
      error: `Tệp thực thi bị cấm không được phép nộp qua cổng trực tuyến: '${safeSegments[safeSegments.length - 1]}'.`,
    };
  }
  if (UNSUPPORTED_ARCHIVE_EXTENSIONS.has(finalExt)) {
    return {
      status: "REJECTED",
      error: `Hệ thống không hỗ trợ định dạng nén '${safeSegments[safeSegments.length - 1]}' (.rar/.7z). Vui lòng nén dạng .zip hoặc chọn trực tiếp cả thư mục dự án.`,
    };
  }

  return {
    status: "OK",
    cleanRelPath: safeSegments.join("/"),
  };
}

export function sanitizeRelativeUploadPath(rawRelPath: string): string | null {
  const res = inspectRelativeUploadPath(rawRelPath);
  if (res.status !== "OK") return null;
  const depth = res.cleanRelPath.split("/").filter(Boolean).length;
  if (depth > MAX_RELATIVE_PATH_DEPTH) return null;
  return res.cleanRelPath;
}

/**
 * If all uploaded files share a single top-level directory (from `<input webkitdirectory>`),
 * strips that outer folder prefix so files sit directly inside `<ClassFolder>/<StudentFullName>/`.
 */
function stripCommonTopLevelDirectory<T extends { cleanRelPath: string }>(
  items: T[]
): T[] {
  if (items.length === 0) return items;
  const allHaveSubfolder = items.every((item) => item.cleanRelPath.includes("/"));
  if (!allHaveSubfolder) return items;

  const firstPrefix = items[0].cleanRelPath.split("/")[0];
  const sameTopFolder = items.every(
    (item) => item.cleanRelPath.split("/")[0].toLowerCase() === firstPrefix.toLowerCase()
  );
  if (!sameTopFolder) return items;

  return items.map((item) => ({
    ...item,
    cleanRelPath: item.cleanRelPath.split("/").slice(1).join("/"),
  }));
}

/**
 * Safely expands top-level `.zip` archives uploaded via the Student Portal into genuine project files,
 * enforcing Zip-Slip traversal checks, forbidden executable/archive checks, depth limits, file count
 * limits (`<= 600`), and total uncompressed byte limits (`<= 130 MB`), and unwrapping single outer folders.
 */
function expandTopLevelZipEntriesSafe(
  entries: Array<{ cleanRelPath: string; buf: Buffer }>
): {
  success: true;
  expanded: Array<{ cleanRelPath: string; buf: Buffer }>;
  totalBytes: number;
} | {
  success: false;
  error: string;
} {
  const hasTopLevelZip = entries.some(
    (e) => !e.cleanRelPath.includes("/") && path.extname(e.cleanRelPath).toLowerCase() === ".zip"
  );
  if (!hasTopLevelZip) {
    const sumBytes = entries.reduce((acc, item) => acc + item.buf.length, 0);
    return { success: true, expanded: entries, totalBytes: sumBytes };
  }

  const finalEntries: Array<{ cleanRelPath: string; buf: Buffer }> = [];
  const seenLowerPaths = new Map<string, string>();
  const seenDirPrefixesLower = new Set<string>();
  let runningBytes = 0;
  const allowedZeroByteMarkers = new Set(["__init__.py", "py.typed"]);
  const _zlib = typeof zlib !== "undefined" ? zlib : undefined;

  const isZeroByteDisallowed = (normalizedRelPath: string, byteLen: number): boolean => {
    if (byteLen > 0) return false;
    const baseLower = path.posix.basename(normalizedRelPath).toLowerCase();
    return !allowedZeroByteMarkers.has(baseLower);
  };

  const registerFinalEntry = (
    cleanRelPath: string,
    buf: Buffer,
    sourceLabel: string
  ): string | null => {
    const segments = cleanRelPath.split("/").filter(Boolean);
    if (segments.length === 0) return null;
    if (segments.length > MAX_RELATIVE_PATH_DEPTH) {
      return `Đường dẫn tệp bên trong '${sourceLabel}' quá sâu (${segments.length} tầng, tối đa ${MAX_RELATIVE_PATH_DEPTH} tầng): '${cleanRelPath}'.`;
    }
    const check = inspectRelativeUploadPath(cleanRelPath);
    if (check.status !== "OK") {
      return check.status === "REJECTED"
        ? check.error
        : `Đường dẫn tệp không hợp lệ trong '${sourceLabel}': '${cleanRelPath}'.`;
    }
    const normalizedRel = check.cleanRelPath;
    const lowerRel = normalizedRel.toLowerCase();

    if (isZeroByteDisallowed(normalizedRel, buf.length)) {
      return `Tệp '${normalizedRel}' trong '${sourceLabel}' bị rỗng (0 byte). Vui lòng kiểm tra lại bài nộp trước khi tải lên.`;
    }

    if (seenLowerPaths.has(lowerRel)) {
      return `Phát hiện hai tệp trùng đường dẫn đích sau khi giải nén ('${seenLowerPaths.get(
        lowerRel
      )}' và '${sourceLabel}/${normalizedRel}'). Vui lòng kiểm tra lại.`;
    }
    if (seenDirPrefixesLower.has(lowerRel)) {
      return `Xung đột tên tệp và thư mục tại '${normalizedRel}'.`;
    }
    let dirAccum = "";
    const parts = normalizedRel.split("/");
    for (let i = 0; i < parts.length - 1; i++) {
      dirAccum = dirAccum ? `${dirAccum}/${parts[i].toLowerCase()}` : parts[i].toLowerCase();
      if (seenLowerPaths.has(dirAccum)) {
        return `Xung đột tên tệp và thư mục tại '${normalizedRel}'.`;
      }
      seenDirPrefixesLower.add(dirAccum);
    }

    if (finalEntries.length + 1 > MAX_FILES_PER_SUBMISSION) {
      return `Tổng số lượng tệp sau khi giải nén vượt quá giới hạn ${MAX_FILES_PER_SUBMISSION} tệp (có thể chứa node_modules hoặc thư viện thừa).`;
    }
    runningBytes += buf.length;
    if (runningBytes > MAX_TOTAL_RAW_BYTES) {
      return `Tổng dung lượng tệp sau khi giải nén vượt quá giới hạn 130MB. Vui lòng kiểm tra lại.`;
    }

    seenLowerPaths.set(lowerRel, `${sourceLabel}:${normalizedRel}`);
    finalEntries.push({ cleanRelPath: normalizedRel, buf });
    return null;
  };

  for (const item of entries) {
    const isTopZip =
      !item.cleanRelPath.includes("/") && path.extname(item.cleanRelPath).toLowerCase() === ".zip";
    if (!isTopZip) {
      const err = registerFinalEntry(item.cleanRelPath, item.buf, item.cleanRelPath);
      if (err) return { success: false, error: err };
      continue;
    }

    let zip: AdmZip;
    try {
      zip = new AdmZip(item.buf);
    } catch {
      return {
        success: false,
        error: `Tệp nén '${item.cleanRelPath}' bị hỏng hoặc không phải định dạng .zip chuẩn. Vui lòng nén lại dạng .zip hoặc chọn cả thư mục dự án.`,
      };
    }

    const rawZipEntries = zip.getEntries();
    const validatedZipEntries: Array<{
      zEntry: AdmZip.IZipEntry;
      cleanRelPath: string;
      declaredSize: number;
    }> = [];
    let declaredZipBytesAccum = runningBytes;
    let crc32Table: Uint32Array | null = null;
    const computeZipCrc32 = (buf: Buffer): number => {
      if (!crc32Table) {
        crc32Table = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
          let c = i;
          for (let k = 0; k < 8; k++) {
            c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
          }
          crc32Table[i] = c >>> 0;
        }
      }
      let crc = 0xffffffff;
      for (let i = 0; i < buf.length; i++) {
        crc = (crc32Table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
      }
      return (crc ^ 0xffffffff) >>> 0;
    };

    // Pass 1: Zero-allocation metadata, Unix symlink/special-file, 0-byte, count, and cumulative size check BEFORE decompressing
    for (const zEntry of rawZipEntries) {
      const rawEntryName = String(zEntry.entryName || "");
      const unixMode = (Number(zEntry.header?.attr || 0) >>> 16) & 0xffff;
      const unixFileType = unixMode & 0o170000;
      if (
        unixFileType !== 0 &&
        unixFileType !== 0o100000 &&
        unixFileType !== 0o040000
      ) {
        return {
          success: false,
          error: `Trong gói nén '${item.cleanRelPath}': không chấp nhận tệp liên kết tượng trưng (symlink) hoặc tệp hệ thống đặc biệt ('${rawEntryName}').`,
        };
      }
      if (
        zEntry.isDirectory ||
        unixFileType === 0o040000 ||
        rawEntryName.endsWith("/") ||
        rawEntryName.endsWith("\\")
      ) {
        continue;
      }
      const insp = inspectRelativeUploadPath(rawEntryName);
      if (insp.status === "IGNORED") {
        continue;
      }
      if (insp.status === "REJECTED") {
        return {
          success: false,
          error: `Trong gói nén '${item.cleanRelPath}': ${insp.error}`,
        };
      }
      if (finalEntries.length + validatedZipEntries.length + 1 > MAX_FILES_PER_SUBMISSION) {
        return {
          success: false,
          error: `Gói nén '${item.cleanRelPath}' chứa quá nhiều tệp (>${MAX_FILES_PER_SUBMISSION} tệp).`,
        };
      }
      const declaredSize = Number(zEntry.header?.size ?? 0);
      if (!Number.isFinite(declaredSize) || declaredSize < 0) {
        return {
          success: false,
          error: `Tệp '${insp.cleanRelPath}' bên trong '${item.cleanRelPath}' có thông tin dung lượng không hợp lệ.`,
        };
      }
      if (isZeroByteDisallowed(insp.cleanRelPath, declaredSize)) {
        return {
          success: false,
          error: `Tệp '${insp.cleanRelPath}' bên trong '${item.cleanRelPath}' bị rỗng (0 byte). Vui lòng kiểm tra lại bài nộp.`,
        };
      }
      if (
        declaredSize > MAX_TOTAL_RAW_BYTES ||
        declaredZipBytesAccum + declaredSize > MAX_TOTAL_RAW_BYTES
      ) {
        return {
          success: false,
          error: `Tổng dung lượng giải nén của '${item.cleanRelPath}' vượt quá giới hạn an toàn 130MB.`,
        };
      }
      declaredZipBytesAccum += declaredSize;
      validatedZipEntries.push({ zEntry, cleanRelPath: insp.cleanRelPath, declaredSize });
    }

    // Pass 2: Bounded per-entry decompression enforcing remaining RAM budget BEFORE exceeding MAX_TOTAL_RAW_BYTES
    const zipItemsRaw: Array<{ cleanRelPath: string; buf: Buffer }> = [];
    let actualZipBytesAccum = runningBytes;
    for (const { zEntry, cleanRelPath, declaredSize } of validatedZipEntries) {
      const remainingBudget = MAX_TOTAL_RAW_BYTES - actualZipBytesAccum;
      if (remainingBudget < 0) {
        return {
          success: false,
          error: `Tổng dung lượng giải nén của '${item.cleanRelPath}' vượt quá giới hạn an toàn 130MB.`,
        };
      }
      let dataBuf: Buffer;
      let usedBoundedZlibPath = false;
      try {
        const method = Number(zEntry.header?.method ?? -1);
        const flags = Number(zEntry.header?.flags ?? 0);
        const isEncrypted = (flags & 0x1) !== 0;
        if (isEncrypted) {
          throw new Error("ENCRYPTED_ZIP_ENTRY");
        }
        if (
          _zlib &&
          typeof (zEntry as any).getCompressedData === "function" &&
          (method === 0 || method === 8)
        ) {
          usedBoundedZlibPath = true;
          const compBuf: Buffer = (zEntry as any).getCompressedData();
          if (method === 0) {
            if (compBuf.length > remainingBudget) {
              return {
                success: false,
                error: `Tổng dung lượng giải nén của '${item.cleanRelPath}' vượt quá giới hạn an toàn 130MB.`,
              };
            }
            dataBuf = Buffer.from(compBuf);
          } else {
            dataBuf = _zlib.inflateRawSync(compBuf, {
              maxOutputLength: Math.max(1, remainingBudget),
            });
            if (remainingBudget === 0 && dataBuf.length > 0) {
              return {
                success: false,
                error: `Tổng dung lượng giải nén của '${item.cleanRelPath}' vượt quá giới hạn an toàn 130MB.`,
              };
            }
          }
        } else {
          dataBuf = zEntry.getData();
        }
      } catch (err: any) {
        const code = String(err?.code || "");
        const msg = String(err?.message || "");
        if (code === "ERR_BUFFER_TOO_LARGE" || /maxOutputLength|Cannot create a Buffer larger/i.test(msg)) {
          return {
            success: false,
            error: `Tổng dung lượng giải nén của '${item.cleanRelPath}' vượt quá giới hạn an toàn 130MB.`,
          };
        }
        return {
          success: false,
          error: `Không thể giải nén tệp '${cleanRelPath}' bên trong '${item.cleanRelPath}' (có thể tệp đặt mật khẩu hoặc bị lỗi).`,
        };
      }
      if (isZeroByteDisallowed(cleanRelPath, dataBuf.length)) {
        return {
          success: false,
          error: `Tệp '${cleanRelPath}' bên trong '${item.cleanRelPath}' bị rỗng (0 byte). Vui lòng kiểm tra lại bài nộp.`,
        };
      }
      if (dataBuf.length > remainingBudget || actualZipBytesAccum + dataBuf.length > MAX_TOTAL_RAW_BYTES) {
        return {
          success: false,
          error: `Tổng dung lượng giải nén của '${item.cleanRelPath}' vượt quá giới hạn an toàn 130MB.`,
        };
      }
      if (usedBoundedZlibPath) {
        if (dataBuf.length !== declaredSize) {
          return {
            success: false,
            error: `Tệp '${cleanRelPath}' bên trong '${item.cleanRelPath}' bị lỗi dữ liệu nén (dung lượng giải nén thực tế không khớp thông tin gói nén). Vui lòng nén lại thư mục dự án và nộp lại.`,
          };
        }
        const expectedCrc = (Number(zEntry.header?.crc ?? 0)) >>> 0;
        const actualCrc = computeZipCrc32(dataBuf);
        if (actualCrc !== expectedCrc) {
          return {
            success: false,
            error: `Tệp '${cleanRelPath}' bên trong '${item.cleanRelPath}' bị lỗi toàn vẹn dữ liệu nén (CRC32 không khớp). Vui lòng nén lại thư mục dự án và nộp lại.`,
          };
        }
      }
      actualZipBytesAccum += dataBuf.length;
      zipItemsRaw.push({ cleanRelPath, buf: dataBuf });
    }

    const unwrappedZipItems = stripCommonTopLevelDirectory(zipItemsRaw).filter((x) =>
      Boolean(x.cleanRelPath)
    );
    if (unwrappedZipItems.length === 0) {
      return {
        success: false,
        error: `Gói nén '${item.cleanRelPath}' rỗng hoặc không chứa tệp bài làm hợp lệ nào.`,
      };
    }

    for (const zItem of unwrappedZipItems) {
      const err = registerFinalEntry(zItem.cleanRelPath, zItem.buf, item.cleanRelPath);
      if (err) return { success: false, error: err };
    }
  }

  if (finalEntries.length === 0 || runningBytes === 0) {
    return {
      success: false,
      error: "Các tệp sau khi giải nén đều rỗng (0 byte). Vui lòng kiểm tra lại bài nộp.",
    };
  }

  return {
    success: true,
    expanded: finalEntries,
    totalBytes: runningBytes,
  };
}

function copyDirectoryTreeVerified(
  srcDir: string,
  destDir: string,
  options?: {
    skipTopLevelPred?: (entryName: string) => boolean;
  }
): { filesCopied: number; bytesCopied: number } {
  let rootStat: fs.Stats;
  try {
    rootStat = fs.lstatSync(srcDir);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return { filesCopied: 0, bytesCopied: 0 };
    }
    throw err;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    return { filesCopied: 0, bytesCopied: 0 };
  }
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  let filesCopied = 0;
  let bytesCopied = 0;

  for (const entry of entries) {
    if (options?.skipTopLevelPred && options.skipTopLevelPred(entry.name)) {
      continue;
    }
    const srcPath = path.join(srcDir, entry.name);
    const st = fs.lstatSync(srcPath);
    if (st.isSymbolicLink()) continue;

    const dstPath = path.join(destDir, entry.name);
    if (st.isDirectory()) {
      fs.mkdirSync(dstPath, { recursive: true });
      const subRes = copyDirectoryTreeVerified(srcPath, dstPath);
      filesCopied += subRes.filesCopied;
      bytesCopied += subRes.bytesCopied;
    } else if (st.isFile()) {
      const parent = path.dirname(dstPath);
      if (!fs.existsSync(parent)) {
        fs.mkdirSync(parent, { recursive: true });
      }
      fs.copyFileSync(srcPath, dstPath);
      const dstStat = fs.statSync(dstPath);
      if (dstStat.size !== st.size) {
        throw new Error(
          `Sao lưu không toàn vẹn cho tệp '${entry.name}' (${dstStat.size}/${st.size} bytes).`
        );
      }
      filesCopied += 1;
      bytesCopied += st.size;
    }
  }

  return { filesCopied, bytesCopied };
}

/**
 * Strictly preserves any `_spck_app_shots` evidence files referenced by an `APPROVED` or `SAVING`
 * session draft (or upload record) into `stagingDir/_spck_app_shots` BEFORE swapping `safeStudentFolder`.
 * Fails closed (throws immediately) on any DB read error, permission/disk copy error (`EACCES`/`ENOSPC`),
 * byte/SHA-256 mismatch, or `.active_shots.json` manifest write failure so `safeStudentFolder` stays 100% untouched.
 */
function preserveProtectedAppShotsVerified(params: {
  classId: string;
  studentId: string;
  safeStudentFolder: string;
  stagingDir: string;
}): void {
  const normClassId = String(params.classId || "").trim().toUpperCase();
  const normStudentId = String(params.studentId || "").trim();
  if (!normClassId || !normStudentId) return;

  const sessMap = spckSessionRepo.findByStudent(normClassId, normStudentId);
  const uploadRow = spckUploadRepo.findOne(normClassId, normStudentId);

  const protectedPathsByLower = new Map<string, string>();
  const addCandidatePath = (rawVal: unknown): void => {
    let candidate = "";
    if (typeof rawVal === "string") {
      candidate = rawVal.trim();
    } else if (
      rawVal &&
      typeof rawVal === "object" &&
      typeof (rawVal as { path?: unknown }).path === "string"
    ) {
      candidate = (rawVal as { path: string }).path.trim();
    }
    if (!candidate) return;
    const resolved = path.resolve(candidate);
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (!protectedPathsByLower.has(key)) {
      protectedPathsByLower.set(key, resolved);
    }
  };

  const addJsonArrayField = (rawJson: string | null | undefined, fieldLabel: string): void => {
    const trimmed = String(rawJson ?? "").trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(
        `Không thể đọc danh sách ảnh minh chứng được bảo vệ (${fieldLabel}): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        addCandidatePath(item);
      }
    }
  };

  for (const sr of Object.values(sessMap)) {
    if (!sr || (sr.draftStatus !== "APPROVED" && sr.draftStatus !== "SAVING")) {
      continue;
    }
    addCandidatePath(sr.thumbnailPath);
    addJsonArrayField(sr.screenshotsJson, `session_${sr.sessionNumber}.screenshotsJson`);
    const rawSnap = String(sr.approvedSnapshotJson ?? "").trim();
    if (rawSnap) {
      let snap: { thumbnailPath?: unknown; screenshots?: unknown } | null = null;
      try {
        snap = JSON.parse(rawSnap) as { thumbnailPath?: unknown; screenshots?: unknown };
      } catch (err) {
        throw new Error(
          `Không thể đọc bản chụp duyệt (session_${sr.sessionNumber}.approvedSnapshotJson): ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
      if (snap && typeof snap === "object") {
        addCandidatePath(snap.thumbnailPath);
        if (Array.isArray(snap.screenshots)) {
          for (const sp of snap.screenshots) {
            addCandidatePath(sp);
          }
        }
      }
    }
  }

  if (uploadRow && (uploadRow.status === "APPROVED" || uploadRow.status === "SAVING")) {
    addCandidatePath(uploadRow.thumbnailPath);
    addJsonArrayField(uploadRow.screenshotsJson, "spck_uploads.screenshotsJson");
  }

  if (protectedPathsByLower.size === 0) {
    return;
  }

  const srcAppShotsDir = assertPathAllowed(
    assertInsideDirectory(
      params.safeStudentFolder,
      path.join(params.safeStudentFolder, "_spck_app_shots")
    )
  );
  const dstAppShotsDir = assertPathAllowed(
    assertInsideDirectory(params.stagingDir, path.join(params.stagingDir, "_spck_app_shots"))
  );

  const srcPrefixCandidates: string[] = [path.resolve(srcAppShotsDir)];
  try {
    const realSrc = fs.realpathSync(srcAppShotsDir);
    if (realSrc && !srcPrefixCandidates.some((c) => c.toLowerCase() === realSrc.toLowerCase())) {
      srcPrefixCandidates.push(realSrc);
    }
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code && code !== "ENOENT" && code !== "ENOTDIR") {
      throw err;
    }
  }

  const resolveRelativeInsideAppShots = (absCandidate: string): string | null => {
    const candidatesToTry: string[] = [absCandidate];
    try {
      const realCand = fs.realpathSync(absCandidate);
      if (realCand && realCand.toLowerCase() !== absCandidate.toLowerCase()) {
        candidatesToTry.push(realCand);
      }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code && code !== "ENOENT" && code !== "ENOTDIR") {
        throw err;
      }
    }
    for (const cand of candidatesToTry) {
      const normCand = process.platform === "win32" ? cand.toLowerCase() : cand;
      for (const prefixDir of srcPrefixCandidates) {
        const withSep = prefixDir.endsWith(path.sep) ? prefixDir : prefixDir + path.sep;
        const normWithSep = process.platform === "win32" ? withSep.toLowerCase() : withSep;
        if (normCand.startsWith(normWithSep)) {
          const rel = cand.slice(withSep.length);
          if (rel && rel !== "." && rel !== "..") {
            return rel;
          }
        }
      }
    }
    return null;
  };

  let copiedProtectedCount = 0;
  for (const pAbs of protectedPathsByLower.values()) {
    const relInsideShots = resolveRelativeInsideAppShots(pAbs);
    if (!relInsideShots) {
      continue;
    }
    const srcShotPath = assertPathAllowed(
      assertInsideDirectory(srcAppShotsDir, path.join(srcAppShotsDir, relInsideShots))
    );
    let st: fs.Stats;
    try {
      st = fs.lstatSync(srcShotPath);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        continue;
      }
      throw err;
    }
    if (st.isSymbolicLink() || !st.isFile()) {
      throw new Error(
        `Tệp ảnh minh chứng được bảo vệ không hợp lệ hoặc là liên kết tượng trưng: '${path.basename(
          srcShotPath
        )}'.`
      );
    }

    const srcBuf = fs.readFileSync(srcShotPath);
    if (srcBuf.length !== st.size) {
      throw new Error(
        `Không thể đọc trọn vẹn ảnh minh chứng được bảo vệ '${path.basename(srcShotPath)}' (${
          srcBuf.length
        }/${st.size} bytes).`
      );
    }
    const srcSha256 = crypto.createHash("sha256").update(srcBuf).digest("hex");

    const dstShotPath = assertPathAllowed(
      assertInsideDirectory(dstAppShotsDir, path.join(dstAppShotsDir, relInsideShots))
    );
    fs.mkdirSync(path.dirname(dstShotPath), { recursive: true });
    fs.copyFileSync(srcShotPath, dstShotPath);

    const dstStat = fs.statSync(dstShotPath);
    if (!dstStat.isFile() || dstStat.size !== st.size) {
      throw new Error(
        `Sao lưu ảnh minh chứng được bảo vệ không toàn vẹn cho '${path.basename(
          srcShotPath
        )}' (${dstStat.size}/${st.size} bytes).`
      );
    }
    const dstSha256 = crypto
      .createHash("sha256")
      .update(fs.readFileSync(dstShotPath))
      .digest("hex");
    if (dstSha256 !== srcSha256) {
      throw new Error(
        `Sai lệch dữ liệu byte khi bảo toàn ảnh minh chứng '${path.basename(srcShotPath)}'.`
      );
    }
    copiedProtectedCount += 1;
  }

  if (copiedProtectedCount > 0) {
    const dstManifestPath = assertPathAllowed(
      assertInsideDirectory(dstAppShotsDir, path.join(dstAppShotsDir, ".active_shots.json"))
    );
    const existingManifestStat = fs.lstatSync(dstManifestPath, { throwIfNoEntry: false });
    if (!existingManifestStat) {
      fs.writeFileSync(
        dstManifestPath,
        JSON.stringify({ version: 1, files: [], updatedAt: new Date().toISOString() }, null, 2),
        "utf8"
      );
    }
    const verifyManifest = JSON.parse(fs.readFileSync(dstManifestPath, "utf8")) as {
      files?: unknown;
    };
    if (!verifyManifest || !Array.isArray(verifyManifest.files)) {
      throw new Error(
        "Không thể xác minh tệp manifest .active_shots.json sau khi bảo toàn ảnh minh chứng."
      );
    }
  }
}

function cleanupOrphanPortalTempDirs(safeClassRoot: string): void {
  try {
    if (!fs.existsSync(safeClassRoot)) return;
    const entries = fs.readdirSync(safeClassRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".spck_portal_staging_")) {
        const tmpPath = assertInsideDirectory(
          safeClassRoot,
          path.join(safeClassRoot, entry.name)
        );
        try {
          fs.rmSync(tmpPath, { recursive: true, force: true });
        } catch {}
        continue;
      }

      if (entry.name.startsWith(".spck_portal_rollback_")) {
        // Never blindly delete `.spck_portal_rollback_*` because it may hold the sole recovery
        // copy of a student's original work after an interrupted swap or failed restore.
        // If encoded with `<hexFolderName>__<txToken>` and the target student folder is missing,
        // automatically self-heal by restoring the rollback directory back into place.
        const rollbackPath = assertInsideDirectory(
          safeClassRoot,
          path.join(safeClassRoot, entry.name)
        );
        const remainder = entry.name.slice(".spck_portal_rollback_".length);
        const sepIdx = remainder.indexOf("__");
        if (sepIdx > 0) {
          const hexFolderName = remainder.slice(0, sepIdx);
          if (/^[0-9a-f]+$/i.test(hexFolderName) && hexFolderName.length % 2 === 0) {
            try {
              const folderName = Buffer.from(hexFolderName, "hex").toString("utf8");
              if (
                folderName &&
                !folderName.includes("/") &&
                !folderName.includes("\\") &&
                folderName !== "." &&
                folderName !== ".."
              ) {
                const targetFolder = assertInsideDirectory(
                  safeClassRoot,
                  path.join(safeClassRoot, folderName)
                );
                if (!fs.existsSync(targetFolder)) {
                  fs.renameSync(rollbackPath, targetFolder);
                }
              }
            } catch {}
          }
        }
      }
    }
  } catch {}
}

function assertInsideDirectory(parentDir: string, targetPath: string): string {
  const resolvedParent = path.resolve(parentDir);
  const resolvedTarget = path.resolve(targetPath);
  const normParent =
    process.platform === "win32" ? resolvedParent.toLowerCase() : resolvedParent;
  const normTarget =
    process.platform === "win32" ? resolvedTarget.toLowerCase() : resolvedTarget;

  if (
    normTarget !== normParent &&
    !normTarget.startsWith(normParent + path.sep.toLowerCase())
  ) {
    throw new Error(
      `[Security Exception] Đường dẫn tệp tải lên thoát khỏi thư mục học viên được cấp phép.`
    );
  }
  return resolvedTarget;
}

const PORTAL_UNCONFIRMED_MARKER_REL = path.join("_spck_prev_backup", "portal_unconfirmed.json");

function writeDiskPortalUnconfirmedMarker(
  targetFolder: string,
  classId: string,
  studentId: string
): void {
  const markerPath = path.join(targetFolder, PORTAL_UNCONFIRMED_MARKER_REL);
  const markerDir = path.dirname(markerPath);
  if (!fs.existsSync(markerDir)) {
    fs.mkdirSync(markerDir, { recursive: true });
  }
  fs.writeFileSync(
    markerPath,
    JSON.stringify(
      {
        classId: String(classId || "").trim().toUpperCase(),
        studentId: String(studentId || "").trim(),
        submittedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf-8"
  );
}

type DiskPortalMarkerState = "PRESENT" | "ABSENT" | "UNVERIFIABLE";

function inspectDiskPortalUnconfirmedMarker(
  folderPath: string | null | undefined,
  classId?: string,
  studentId?: string
): DiskPortalMarkerState {
  if (!folderPath || !String(folderPath).trim()) return "ABSENT";

  let safeFolder: string;
  try {
    safeFolder = assertPathAllowed(folderPath);
  } catch {
    return "UNVERIFIABLE";
  }

  const markerPath = path.join(safeFolder, PORTAL_UNCONFIRMED_MARKER_REL);

  let st: fs.Stats;
  try {
    // Call lstatSync directly (NEVER existsSync, which silently maps EACCES/EPERM to false!)
    st = fs.lstatSync(markerPath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return "ABSENT";
    }
    return "UNVERIFIABLE";
  }

  if (st.isSymbolicLink() || !st.isFile()) {
    return "UNVERIFIABLE";
  }

  try {
    const raw = fs.readFileSync(markerPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "UNVERIFIABLE";
    }
    if (classId) {
      if (typeof parsed.classId !== "string" || !parsed.classId.trim()) {
        return "UNVERIFIABLE";
      }
      const expectedClass = String(classId).trim().toUpperCase();
      if (parsed.classId.trim().toUpperCase() !== expectedClass) {
        return "ABSENT";
      }
    }
    if (studentId) {
      if (typeof parsed.studentId !== "string" || !parsed.studentId.trim()) {
        return "UNVERIFIABLE";
      }
      const expectedStu = String(studentId).trim();
      if (parsed.studentId.trim() !== expectedStu) {
        return "ABSENT";
      }
    }
    return "PRESENT";
  } catch {
    return "UNVERIFIABLE";
  }
}

function hasDiskPortalUnconfirmedMarker(
  folderPath: string | null | undefined,
  classId?: string,
  studentId?: string
): boolean {
  const state = inspectDiskPortalUnconfirmedMarker(folderPath, classId, studentId);
  // Fail closed: treat both PRESENT and UNVERIFIABLE (EACCES, corrupt JSON, symlink) as pending unconfirmed!
  return state !== "ABSENT";
}

function removeDiskPortalUnconfirmedMarker(folderPath: string | null | undefined): void {
  if (!folderPath || !String(folderPath).trim()) return;
  try {
    const safeFolder = assertPathAllowed(folderPath);
    const markerPath = path.join(safeFolder, PORTAL_UNCONFIRMED_MARKER_REL);
    if (fs.lstatSync(markerPath, { throwIfNoEntry: false })) {
      fs.unlinkSync(markerPath);
    }
  } catch {}
}

class StudentPortalManager {
  private server: http.Server | null = null;
  private activeSockets = new Set<net.Socket>();
  private tunnelProcess: ChildProcess | null = null;
  private isRunning = false;
  private portalGeneration = 0;
  private stateVersion = 1;
  private classId = "";
  private className = "";
  private rootFolderPath = "";
  private driveFolderUrl = DEFAULT_SPCK_DRIVE_FOLDER_URL;
  private autoUploadDrive = true;
  private requireTeacherConfirmation = true;
  private activeSessionNumber: SpckSessionNumber = 12;
  private sessionToken = "";
  private port = 3088;
  private localUrl = "";
  private lanUrl = "";
  private publicTunnelUrl: string | null = null;
  private tunnelStatus: StudentPortalStatus["tunnelStatus"] = "STOPPED";
  private tunnelProvider = "Mạng LAN / Máy Giáo Viên";
  private startedAt: string | null = null;
  private submissions = new Map<string, StudentPortalSubmissionItem>();
  private unconfirmedPortalByClassStudent = new Set<string>();
  private submissionLocksByStudent = new Map<string, Promise<unknown>>();
    private driveUploadStateByStudent = new Map<
      string,
      {
        running: boolean;
        pendingRerun: boolean;
        driveFolderUrl: string;
        runFullAutoPrep?: boolean;
      }
    >();

  public getStateVersion(): number {
    return this.stateVersion;
  }

  public bumpStateVersion(): number {
    this.stateVersion += 1;
    return this.stateVersion;
  }

  public getStatus(
    filterClassId?: string,
    options?: { skipDiskSync?: boolean }
  ): StudentPortalStatus {
    if (!options?.skipDiskSync) {
      this.syncSubmissionsWithExistingRecords();
    }
    const submissionsList = Array.from(this.submissions.values()).sort((a, b) =>
      b.submittedAt.localeCompare(a.submittedAt)
    );

    const primaryShareUrl =
      this.publicTunnelUrl || this.lanUrl || this.localUrl || "";

    return {
      isRunning:
        this.isRunning &&
        (!filterClassId ||
          !this.classId ||
          this.classId.toUpperCase() === filterClassId.trim().toUpperCase()),
      stateVersion: this.stateVersion,
      classId: this.classId,
      className: this.className,
      rootFolderPath: this.rootFolderPath,
      driveFolderUrl: this.driveFolderUrl,
      autoUploadDrive: this.autoUploadDrive,
      sessionToken: this.sessionToken,
      port: this.port,
      localUrl: this.localUrl,
      lanUrl: this.lanUrl,
      publicTunnelUrl: this.publicTunnelUrl,
      primaryShareUrl,
      tunnelStatus: this.isRunning ? this.tunnelStatus : "STOPPED",
      tunnelProvider: this.tunnelProvider,
      startedAt: this.startedAt,
      submissions: submissionsList,
    };
  }

  public setAutoUploadDrive(enabled: boolean, driveFolderUrl?: string): StudentPortalStatus {
    this.autoUploadDrive = Boolean(enabled);
    if (driveFolderUrl && driveFolderUrl.trim()) {
      this.driveFolderUrl = driveFolderUrl.trim();
    }
    this.bumpStateVersion();
    return this.getStatus();
  }

  public async startPortal(options: StartStudentPortalOptions): Promise<StudentPortalStatus> {
    const normalizedClassId = String(options.classId || "").trim().toUpperCase();
    if (!normalizedClassId || !/^[A-Z0-9_-]{2,80}$/.test(normalizedClassId)) {
      throw new Error("Mã lớp (classId) không hợp lệ. Vui lòng chọn lớp học trước khi mở cổng nộp bài.");
    }
    if (isCourseExemptFromSpck(normalizedClassId)) {
      throw new Error(
        `Lớp '${normalizedClassId}' thuộc khóa miễn thi cuối khóa (PTB/CSB) nên không cần mở Cổng Thu Bài SPCK.`
      );
    }

    const students = studentRepo.findByClass(normalizedClassId, false);
    if (students.length === 0) {
      throw new Error(
        `Chưa có danh sách học viên cho lớp '${normalizedClassId}'. Vui lòng bấm đồng bộ hoặc chọn lớp có học viên trước.`
      );
    }

    // Resolve and register the target class SPCK directory
    const targetRootDir = resolveTargetSpckClassFolder(
      normalizedClassId,
      options.folderPath
    );

    if (!fs.existsSync(targetRootDir)) {
      fs.mkdirSync(targetRootDir, { recursive: true });
    }
    const safeRootDir = registerTeacherSelectedDirectory(targetRootDir);
    cleanupOrphanPortalTempDirs(safeRootDir);

    // If portal is already running for the exact same class & folder, return existing status
    if (
      this.isRunning &&
      this.server &&
      this.classId === normalizedClassId &&
      normalizeSpckFolderKey(this.rootFolderPath) === normalizeSpckFolderKey(safeRootDir)
    ) {
      let changed = false;
      if (options.driveFolderUrl?.trim() && this.driveFolderUrl !== options.driveFolderUrl.trim()) {
        this.driveFolderUrl = options.driveFolderUrl.trim();
        changed = true;
      }
      if (
        typeof options.autoUploadDrive === "boolean" &&
        this.autoUploadDrive !== options.autoUploadDrive
      ) {
        this.autoUploadDrive = options.autoUploadDrive;
        changed = true;
      }
      if (
        typeof options.requireTeacherConfirmation === "boolean" &&
        this.requireTeacherConfirmation !== options.requireTeacherConfirmation
      ) {
        this.requireTeacherConfirmation = options.requireTeacherConfirmation;
        changed = true;
      }
      if (
        (options.sessionNumber === 12 ||
          options.sessionNumber === 13 ||
          options.sessionNumber === 14) &&
        this.activeSessionNumber !== options.sessionNumber
      ) {
        this.activeSessionNumber = options.sessionNumber;
        changed = true;
      }
      if (changed) {
        this.bumpStateVersion();
      }
      return this.getStatus();
    }

    // Stop any previous portal instance before starting a fresh one
    await this.stopPortal();

    const sessions = classSessionRepo.findByClass(normalizedClassId);
    this.classId = normalizedClassId;
    this.className = sessions[0]?.className || normalizedClassId;
    this.rootFolderPath = safeRootDir;
    this.driveFolderUrl =
      options.driveFolderUrl?.trim() || DEFAULT_SPCK_DRIVE_FOLDER_URL;
    this.autoUploadDrive =
      typeof options.autoUploadDrive === "boolean" ? options.autoUploadDrive : true;
    this.requireTeacherConfirmation =
      typeof options.requireTeacherConfirmation === "boolean"
        ? options.requireTeacherConfirmation
        : true;
    this.activeSessionNumber =
      options.sessionNumber === 12 ||
      options.sessionNumber === 13 ||
      options.sessionNumber === 14
        ? options.sessionNumber
        : 12;
    this.sessionToken = crypto.randomBytes(6).toString("hex");
    this.submissions.clear();
    this.syncSubmissionsWithExistingRecords();

    // Start HTTP Server on an available port (3088..3099)
    this.port = await this.listenOnAvailablePort(3088, 3099);
    const lanIp = getLanIpAddress();
    this.localUrl = `http://127.0.0.1:${this.port}/s/${this.sessionToken}`;
    this.lanUrl = `http://${lanIp}:${this.port}/s/${this.sessionToken}`;
    const disableTunnel = process.env.MINDX_DISABLE_PORTAL_TUNNEL === "1";
    this.publicTunnelUrl = null;
    this.tunnelStatus = disableTunnel ? "LAN_ONLY" : "STARTING";
    this.tunnelProvider = disableTunnel
      ? "Mạng LAN Phòng Học / Wi-Fi Chung"
      : "Đang khởi tạo Link Internet...";
    this.startedAt = new Date().toISOString();
    this.isRunning = true;
    this.bumpStateVersion();

    // Launch Public Internet Tunnel in background so startPortal returns fast (unless disabled in offline/test mode)
    if (!disableTunnel) {
      this.startPublicTunnelInBackground(this.port, this.sessionToken).catch(() => {
        if (this.isRunning && !this.publicTunnelUrl) {
          this.tunnelStatus = "LAN_ONLY";
          this.tunnelProvider = "Mạng LAN Phòng Học / Wi-Fi Chung";
          this.bumpStateVersion();
        }
      });
    }

    jobLogRepo.add({
      jobId: `PORTAL_${Date.now()}`,
      jobType: "SPCK_STUDENT_PORTAL",
      classId: this.classId,
      level: "INFO",
      message: `[StudentPortal] Đã mở Cổng Thu Bài SPCK cho lớp ${this.classId} tại ${this.lanUrl} (Thư mục đích: ${this.rootFolderPath})`,
    });

    return this.getStatus();
  }

  public async stopPortal(): Promise<void> {
    const wasRunning = this.isRunning || Boolean(this.server);
    this.portalGeneration++;
    this.isRunning = false;
    this.tunnelStatus = "STOPPED";
    this.publicTunnelUrl = null;
    if (wasRunning) {
      this.bumpStateVersion();
    }

    for (const state of this.driveUploadStateByStudent.values()) {
      state.pendingRerun = false;
    }

    if (this.tunnelProcess) {
      const proc = this.tunnelProcess;
      this.tunnelProcess = null;
      try {
        proc.stdout?.removeAllListeners();
        proc.stderr?.removeAllListeners();
        proc.stdout?.destroy();
        proc.stderr?.destroy();
        proc.kill("SIGKILL");
        if (process.platform === "win32" && proc.pid) {
          const killer = spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
          });
          killer.unref();
        }
      } catch {}
    }

    if (this.server) {
      const srv = this.server;
      this.server = null;
      try {
        (srv as unknown as { closeIdleConnections?: () => void }).closeIdleConnections?.();
        (srv as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
      } catch {}
      for (const socket of Array.from(this.activeSockets)) {
        try {
          socket.destroy();
        } catch {}
      }
      this.activeSockets.clear();
      await Promise.race([
        new Promise<void>((resolve) => {
          try {
            srv.close(() => resolve());
          } catch {
            resolve();
          }
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 600)),
      ]);
    }
  }

  private syncSubmissionsWithExistingRecords(): void {
    if (!this.classId) return;
    try {
      const students = studentRepo.findByClass(this.classId, false);
      const studentMap = new Map(students.map((s) => [s.studentId, s]));
      const records = spckUploadRepo.findByClass(this.classId);

      for (const rec of records) {
        if (!rec.localFolderPath || !fs.existsSync(rec.localFolderPath)) continue;
        const existingItem = this.submissions.get(rec.studentId);
        const relatedLinks: Array<{ name: string; url: string }> = (() => {
          try {
            return JSON.parse(rec.relatedLinksJson || "[]");
          } catch {
            return [];
          }
        })();
        const driveLinkObj = relatedLinks.find((l) =>
          /drive\.google\.com\/drive\/folders\//i.test(l.url || "")
        );

        const diskUnconfirmed =
          Number(rec.pendingPortalConfirmation) === 1 ||
          hasDiskPortalUnconfirmedMarker(
            rec.localFolderPath,
            this.classId,
            rec.studentId
          );
        const isConfirmed = Number(rec.isConfirmedByTeacher) === 1 && !diskUnconfirmed;
        if (!isConfirmed && diskUnconfirmed) {
          this.unconfirmedPortalByClassStudent.add(
            `${this.classId.trim().toUpperCase()}::${rec.studentId}`
          );
        }

        if (existingItem) {
          existingItem.classId = this.classId;
          existingItem.confirmedByTeacher = isConfirmed;
          if (driveLinkObj?.url && existingItem.driveStatus !== "UPLOADING") {
            existingItem.driveFolderUrl = driveLinkObj.url;
            existingItem.driveStatus = "UPLOADED";
          }
          continue;
        }

        const stu = studentMap.get(rec.studentId);
        const attachments: string[] = (() => {
          try {
            return JSON.parse(rec.attachmentsJson || "[]");
          } catch {
            return [];
          }
        })();
        const screenshots: string[] = (() => {
          try {
            return JSON.parse(rec.screenshotsJson || "[]");
          } catch {
            return [];
          }
        })();

        this.submissions.set(rec.studentId, {
          classId: this.classId,
          studentId: rec.studentId,
          fullName: stu?.fullName || rec.studentId,
          folderName: path.basename(rec.localFolderPath),
          folderPath: rec.localFolderPath,
          projectTitle: rec.projectTitle || `SPCK ${stu?.fullName || rec.studentId}`,
          filesCount: attachments.length + screenshots.length,
          totalBytes: 0,
          submittedAt: (rec as any).updatedAt || new Date().toISOString(),
          confirmedByTeacher: isConfirmed,
          driveStatus: driveLinkObj?.url
            ? "UPLOADED"
            : isCourseExemptFromSpck(this.classId)
            ? "EXEMPT"
            : "IDLE",
          driveFolderUrl: driveLinkObj?.url,
        });
      }
    } catch {
      // Ignore sync errors
    }
  }

  private async listenOnAvailablePort(startPort: number, maxPort: number): Promise<number> {
    this.activeSockets.clear();
    for (let candidatePort = startPort; candidatePort <= maxPort; candidatePort++) {
      try {
        const srv = http.createServer((req, res) => {
          this.handleHttpRequest(req, res).catch((err) => {
            if (!res.headersSent) {
              res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
              res.end(
                JSON.stringify({
                  success: false,
                  error: err instanceof Error ? err.message : String(err),
                })
              );
            }
          });
        });
        srv.keepAliveTimeout = 2000;
        srv.headersTimeout = 10000;
        srv.on("connection", (socket: net.Socket) => {
          this.activeSockets.add(socket);
          socket.once("close", () => {
            this.activeSockets.delete(socket);
          });
        });

        await new Promise<void>((resolve, reject) => {
          srv.once("error", reject);
          srv.listen(candidatePort, "0.0.0.0", () => {
            srv.removeListener("error", reject);
            resolve();
          });
        });

        this.server = srv;
        return candidatePort;
      } catch {
        continue;
      }
    }
    throw new Error(
      `Không tìm thấy cổng mạng trống trong khoảng ${startPort}..${maxPort} để mở Cổng Thu Bài.`
    );
  }

  private async ensureCloudflaredBinary(): Promise<string | null> {
    if (process.platform !== "win32") return "cloudflared";
    const downloadDir = path.resolve(process.cwd(), "data", "downloads");
    const cloudflaredPath = path.join(downloadDir, "cloudflared.exe");
    if (
      fs.existsSync(cloudflaredPath) &&
      fs.statSync(cloudflaredPath).size > 5 * 1024 * 1024
    ) {
      return cloudflaredPath;
    }

    try {
      if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true });
      }
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(
          "curl.exe",
          [
            "-L",
            "-s",
            "-o",
            cloudflaredPath,
            "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe",
          ],
          { windowsHide: true }
        );
        proc.on("error", reject);
        proc.on("exit", (code) =>
          code === 0 ? resolve() : reject(new Error(`curl exited ${code}`))
        );
      });
      if (
        fs.existsSync(cloudflaredPath) &&
        fs.statSync(cloudflaredPath).size > 5 * 1024 * 1024
      ) {
        return cloudflaredPath;
      }
    } catch {}
    return null;
  }

  private async startPublicTunnelInBackground(port: number, token: string): Promise<void> {
    // 1. Try Cloudflare Quick Tunnel first (auto-downloads cloudflared.exe if missing)
    const cloudflaredPath = await this.ensureCloudflaredBinary();

    if (cloudflaredPath && this.isRunning) {
      const cfUrl = await this.trySpawnTunnelProcess(
        cloudflaredPath,
        [
          "tunnel",
          "--url",
          `http://127.0.0.1:${port}`,
          "--no-autoupdate",
          "--protocol",
          "http2",
        ],
        /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i,
        18000
      );
      if (cfUrl && this.isRunning && this.sessionToken === token) {
        this.publicTunnelUrl = `${cfUrl.replace(/\/+$/, "")}/s/${token}`;
        this.tunnelStatus = "READY";
        this.tunnelProvider = "Cloudflare Internet Tunnel (Toàn cầu)";
        this.bumpStateVersion();
        return;
      }
    }

    // 2. Fallback to built-in Windows OpenSSH -> localhost.run (zero-install HTTPS tunnel)
    const sshExe =
      process.platform === "win32"
        ? "C:\\Windows\\System32\\OpenSSH\\ssh.exe"
        : "ssh";
    if (this.isRunning) {
      const lhrUrl = await this.trySpawnTunnelProcess(
        sshExe,
        [
          "-o",
          "StrictHostKeyChecking=no",
          "-o",
          "UserKnownHostsFile=NUL",
          "-o",
          "ServerAliveInterval=30",
          "-R",
          `80:127.0.0.1:${port}`,
          "nokey@localhost.run",
        ],
        /https:\/\/[a-z0-9-]+\.lhr\.life/i,
        12000
      );
      if (lhrUrl && this.isRunning && this.sessionToken === token) {
        this.publicTunnelUrl = `${lhrUrl.replace(/\/+$/, "")}/s/${token}`;
        this.tunnelStatus = "READY";
        this.tunnelProvider = "Internet Tunnel (localhost.run)";
        this.bumpStateVersion();
        return;
      }
    }

    if (this.isRunning && this.sessionToken === token && !this.publicTunnelUrl) {
      this.tunnelStatus = "LAN_ONLY";
      this.tunnelProvider = "Mạng LAN Phòng Học / Wi-Fi Chung";
      this.bumpStateVersion();
    }
  }

  private trySpawnTunnelProcess(
    command: string,
    args: string[],
    urlRegex: RegExp,
    timeoutMs: number
  ): Promise<string | null> {
    return new Promise((resolve) => {
      let settled = false;
      let proc: ChildProcess | null = null;

      const finish = (matchedUrl: string | null) => {
        if (settled) return;
        settled = true;
        if (!matchedUrl && proc) {
          try {
            proc.kill();
          } catch {}
        }
        resolve(matchedUrl);
      };

      const timer = setTimeout(() => finish(null), timeoutMs);

      try {
        proc = spawn(command, args, {
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        this.tunnelProcess = proc;

        const onChunk = (chunk: Buffer) => {
          const text = chunk.toString("utf8");
          const match = text.match(urlRegex);
          if (match && match[0]) {
            clearTimeout(timer);
            finish(match[0]);
          }
        };

        proc.stdout?.on("data", onChunk);
        proc.stderr?.on("data", onChunk);
        proc.on("error", () => {
          clearTimeout(timer);
          finish(null);
        });
        proc.on("exit", () => {
          clearTimeout(timer);
          finish(null);
        });
      } catch {
        clearTimeout(timer);
        finish(null);
      }
    });
  }

  private async handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // Standard security headers for the isolated student portal
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Cache-Control", "no-store, max-age=0");

    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname.replace(/\/+$/, "") || "/";
    const expectedPrefix = `/s/${this.sessionToken}`;

    if (!this.isRunning || !this.sessionToken || !pathname.startsWith(expectedPrefix)) {
      res.writeHead(403, {
        "Content-Type": "text/html; charset=utf-8",
        Connection: "close",
      });
      res.end(
        `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><title>Cổng nộp bài đã đóng</title></head><body style="background:#0f172a;color:#f8fafc;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div style="text-align:center;max-width:460px;padding:24px;border:1px solid #334155;border-radius:16px;background:#1e293b;"><h2>🔒 Đường dẫn nộp bài không hợp lệ hoặc đã đóng</h2><p style="color:#94a3b8;font-size:14px;">Vui lòng xin lại đường dẫn mới nhất từ Thầy giảng viên.</p></div></body></html>`
      );
      return;
    }

    const subRoute = pathname.slice(expectedPrefix.length) || "/";

    // 1. GET /s/<token> -> Render Student Upload HTML Page
    if (req.method === "GET" && subRoute === "/") {
      const html = this.renderStudentPortalHtml();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    // 2. GET /s/<token>/status -> Return class & student list + submission statuses
    if (req.method === "GET" && subRoute === "/status") {
      this.syncSubmissionsWithExistingRecords();
      const students = studentRepo
        .findByClass(this.classId, false)
        .filter((s) => s.isActive !== 0);

      const studentItems = students.map((stu) => {
        const sub = this.submissions.get(stu.studentId);
        return {
          studentId: stu.studentId,
          fullName: stu.fullName,
          hasSubmitted: Boolean(sub),
          projectTitle: sub?.projectTitle || `SPCK ${stu.fullName}`,
          filesCount: sub?.filesCount || 0,
          submittedAt: sub?.submittedAt || null,
          driveStatus: sub?.driveStatus || "IDLE",
          driveFolderUrl: sub?.driveFolderUrl || null,
          driveError: sub?.driveError || null,
        };
      });

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          success: true,
          classId: this.classId,
          className: this.className,
          autoUploadDrive: this.autoUploadDrive,
          students: studentItems,
        })
      );
      return;
    }

    // 3. POST /s/<token>/upload -> Receive Student SPCK files, save locally, scan & trigger Drive Upload
    if (req.method === "POST" && subRoute === "/upload") {
      const rawBody = await this.readRequestBody(req, MAX_UPLOAD_BODY_BYTES);
      let body: IncomingStudentUploadBody;
      try {
        body = JSON.parse(rawBody) as IncomingStudentUploadBody;
      } catch {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: false, error: "Dữ liệu tải lên không đúng định dạng JSON." }));
        return;
      }

      const result = await this.processStudentSubmission(body);
      res.writeHead(result.success ? 200 : 400, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(result));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ success: false, error: "Không tìm thấy đường dẫn yêu cầu." }));
  }

  private readRequestBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;

      req.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          req.destroy();
          reject(
            new Error(
              `Tổng dung lượng bài nộp vượt quá giới hạn cho phép (${Math.round(
                maxBytes / (1024 * 1024)
              )} MB).`
            )
          );
          return;
        }
        chunks.push(chunk);
      });

      req.on("end", () => {
        resolve(Buffer.concat(chunks).toString("utf8"));
      });

      req.on("error", (err) => {
        reject(err);
      });
    });
  }

  public async processStudentSubmission(body: IncomingStudentUploadBody): Promise<{
    success: boolean;
    error?: string;
    submission?: StudentPortalSubmissionItem;
  }> {
    const lockKey = `${this.classId || ""}::${String(body?.studentId || "").trim()}`;
    const prev = this.submissionLocksByStudent.get(lockKey) || Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(() => this.processStudentSubmissionUnlocked(body));
    this.submissionLocksByStudent.set(lockKey, next);
    try {
      return await next;
    } finally {
      if (this.submissionLocksByStudent.get(lockKey) === next) {
        this.submissionLocksByStudent.delete(lockKey);
      }
    }
  }

  private async processStudentSubmissionUnlocked(
    body: IncomingStudentUploadBody
  ): Promise<{
    success: boolean;
    error?: string;
    submission?: StudentPortalSubmissionItem;
  }> {
    if (!this.isRunning || !this.classId || !this.rootFolderPath) {
      return {
        success: false,
        error: "Cổng thu bài hiện đang đóng. Vui lòng báo Thầy mở lại cổng thu bài.",
      };
    }

    const activeClassId = this.classId;
    const activeRootFolderPath = this.rootFolderPath;

    const studentId = String(body?.studentId || "").trim();
    if (!studentId) {
      return {
        success: false,
        error: "Vui lòng chọn Họ và Tên của con trong danh sách lớp.",
      };
    }

    const students = studentRepo.findByClass(activeClassId, false);
    const student = students.find((s) => s.studentId === studentId);
    if (!student) {
      return {
        success: false,
        error: `Không tìm thấy học viên (${studentId}) trong danh sách lớp ${activeClassId}.`,
      };
    }

    const rawFiles = Array.isArray(body?.files) ? body.files : [];
    if (rawFiles.length === 0) {
      return {
        success: false,
        error: "Con chưa chọn file hoặc thư mục sản phẩm nào để nộp.",
      };
    }

    if (rawFiles.length > MAX_FILES_PER_SUBMISSION) {
      return {
        success: false,
        error: `Số lượng file vượt quá giới hạn (${rawFiles.length}/${MAX_FILES_PER_SUBMISSION} file). Vui lòng bỏ các thư mục thư viện phụ hoặc nén thành file .zip.`,
      };
    }

    // Step 1 (In-memory validation before touching disk):
    // Inspect all relative paths, reject forbidden extensions/invalid paths at any depth,
    // strip common outer folder, enforce depth limit, prevent case-insensitive destination collisions,
    // and decode Base64 payloads within the 130 MB raw byte budget.
    const inspectedEntries: Array<{
      rawRelPath: string;
      cleanRelPath: string;
      base64Data: string;
    }> = [];

    for (const item of rawFiles) {
      const rawRelPath = String(item?.relativePath || "");
      const inspection = inspectRelativeUploadPath(rawRelPath);
      if (inspection.status === "REJECTED") {
        return {
          success: false,
          error: inspection.error,
        };
      }
      if (inspection.status === "IGNORED") {
        continue;
      }
      if (
        item?.base64Data === undefined ||
        item?.base64Data === null ||
        typeof item.base64Data !== "string"
      ) {
        return {
          success: false,
          error: `Dữ liệu nội dung tệp '${inspection.cleanRelPath}' không hợp lệ.`,
        };
      }
      inspectedEntries.push({
        rawRelPath,
        cleanRelPath: inspection.cleanRelPath,
        base64Data: item.base64Data,
      });
    }

    const normalizedEntries = stripCommonTopLevelDirectory(inspectedEntries).filter(
      (item) => Boolean(item.cleanRelPath)
    );

    if (normalizedEntries.length === 0) {
      return {
        success: false,
        error: "Không có tệp hợp lệ nào sau khi lọc bỏ các tệp hệ thống/thư mục rỗng.",
      };
    }

    const seenFilePathsLower = new Map<string, string>();
    const seenDirPrefixesLower = new Set<string>();
    const decodedEntries: Array<{ cleanRelPath: string; buf: Buffer }> = [];
    let totalRawBytes = 0;

    for (const entry of normalizedEntries) {
      const segments = entry.cleanRelPath.split("/").filter(Boolean);
      if (segments.length === 0) continue;
      if (segments.length > MAX_RELATIVE_PATH_DEPTH) {
        return {
          success: false,
          error: `Đường dẫn thư mục quá sâu (${segments.length} tầng, tối đa ${MAX_RELATIVE_PATH_DEPTH} tầng): '${entry.cleanRelPath}'. Vui lòng đưa thư mục dự án ra ngoài hoặc nén thành .zip.`,
        };
      }

      // Re-verify final extension after stripping common outer folder
      const postStripCheck = inspectRelativeUploadPath(entry.cleanRelPath);
      if (postStripCheck.status !== "OK") {
        return {
          success: false,
          error:
            postStripCheck.status === "REJECTED"
              ? postStripCheck.error
              : `Đường dẫn tệp không hợp lệ: '${entry.cleanRelPath}'.`,
        };
      }

      const cleanRelPath = postStripCheck.cleanRelPath;
      const lowerRelPath = cleanRelPath.toLowerCase();

      if (seenFilePathsLower.has(lowerRelPath)) {
        const prevOriginal = seenFilePathsLower.get(lowerRelPath)!;
        return {
          success: false,
          error: `Phát hiện hai tệp trùng đường dẫn đích sau khi chuẩn hóa ('${prevOriginal}' và '${entry.rawRelPath}' -> '${cleanRelPath}'). Vui lòng đổi tên tệp bị trùng trước khi nộp.`,
        };
      }
      if (seenDirPrefixesLower.has(lowerRelPath)) {
        return {
          success: false,
          error: `Xung đột tên tệp và thư mục tại '${cleanRelPath}'. Vui lòng kiểm tra lại cấu trúc thư mục bài nộp.`,
        };
      }

      let dirPrefixAccum = "";
      const cleanParts = cleanRelPath.split("/");
      for (let i = 0; i < cleanParts.length - 1; i++) {
        dirPrefixAccum = dirPrefixAccum
          ? `${dirPrefixAccum}/${cleanParts[i].toLowerCase()}`
          : cleanParts[i].toLowerCase();
        if (seenFilePathsLower.has(dirPrefixAccum)) {
          return {
            success: false,
            error: `Xung đột tên tệp và thư mục tại '${cleanRelPath}'. Vui lòng kiểm tra lại cấu trúc thư mục bài nộp.`,
          };
        }
        seenDirPrefixesLower.add(dirPrefixAccum);
      }
      seenFilePathsLower.set(lowerRelPath, entry.rawRelPath);

      const hasDataUriPrefix = /^data:[^,]*,/i.test(entry.base64Data);
      const base64Clean = hasDataUriPrefix
        ? entry.base64Data.slice(entry.base64Data.indexOf(",") + 1)
        : entry.base64Data;
      const trimmedB64 = base64Clean.replace(/\s+/g, "");

      if (trimmedB64.length > 0) {
        if (
          !/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmedB64) ||
          trimmedB64.length % 4 === 1
        ) {
          return {
            success: false,
            error: `Dữ liệu mã hóa Base64 của tệp '${cleanRelPath}' bị hỏng hoặc không hợp lệ.`,
          };
        }
      }

      const buf = trimmedB64.length === 0 ? Buffer.alloc(0) : Buffer.from(trimmedB64, "base64");
      totalRawBytes += buf.length;
      if (totalRawBytes > MAX_TOTAL_RAW_BYTES) {
        return {
          success: false,
          error: `Tổng dung lượng file vượt quá giới hạn 130MB. Vui lòng kiểm tra lại.`,
        };
      }

      decodedEntries.push({ cleanRelPath, buf });
    }

    if (decodedEntries.length === 0 || totalRawBytes === 0) {
      return {
        success: false,
        error: "Các tệp tải lên đều rỗng (0 byte). Vui lòng chọn lại tệp bài làm.",
      };
    }

    const zipExpandRes = expandTopLevelZipEntriesSafe(decodedEntries);
    if (!zipExpandRes.success) {
      return {
        success: false,
        error: zipExpandRes.error,
      };
    }
    const finalDecodedEntries = zipExpandRes.expanded;
    totalRawBytes = zipExpandRes.totalBytes;

    const needTeacherConfirm = this.requireTeacherConfirmation !== false;

    // Prepare student folder inside the allowlisted class SPCK directory
    const safeClassRoot = assertPathAllowed(activeRootFolderPath);
    const existingRecord = spckUploadRepo.findOne(activeClassId, student.studentId);

    let studentFolderPath: string;
    if (
      existingRecord?.localFolderPath &&
      fs.existsSync(existingRecord.localFolderPath) &&
      normalizeSpckFolderKey(path.dirname(existingRecord.localFolderPath)) ===
        normalizeSpckFolderKey(safeClassRoot)
    ) {
      studentFolderPath = assertInsideDirectory(safeClassRoot, existingRecord.localFolderPath);
    } else {
      const otherRecords = spckUploadRepo.findByClass(activeClassId);
      const otherPaths = otherRecords
        .filter((r) => r.studentId !== student.studentId && r.localFolderPath)
        .map((r) => r.localFolderPath!);
      const candidatePath = resolveStudentFolderInsideClassRoot(
        safeClassRoot,
        student.fullName,
        student.studentId,
        otherPaths
      );
      studentFolderPath = assertInsideDirectory(safeClassRoot, candidatePath);
    }

    const safeStudentFolder = assertPathAllowed(studentFolderPath);

    // Prepare optional links.txt content in memory before disk writes
    const rawTitle = String(body?.projectTitle || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_SPCK_TITLE_LENGTH);
    const finalTitle = sanitizeSpckTitle(
      rawTitle || existingRecord?.projectTitle || `SPCK ${student.fullName}`,
      student.fullName
    );

    const youtubeInput = String(body?.youtubeUrl || "").trim();
    const presentationInput = String(body?.presentationUrl || "").trim();

    const linksLines: string[] = [`Tiêu đề: ${finalTitle}`];
    if (youtubeInput) {
      const ytCheck = validateSpckYoutubeUrl(youtubeInput);
      if (ytCheck.valid && ytCheck.normalizedUrl) {
        linksLines.push(ytCheck.normalizedUrl);
      }
    }
    if (presentationInput) {
      const relCheck = validateSpckRelatedUrl(presentationInput);
      if (relCheck.valid && relCheck.normalizedUrl) {
        linksLines.push(
          `Slide / Link thuyết trình (${student.fullName}) | ${relCheck.normalizedUrl}`
        );
      }
    }

    // Step 2 (Atomic staging on the same filesystem inside safeClassRoot):
    const txToken = `${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
    const folderHex = Buffer.from(path.basename(safeStudentFolder), "utf8").toString("hex");
    const stagingDir = assertPathAllowed(
      assertInsideDirectory(safeClassRoot, path.join(safeClassRoot, `.spck_portal_staging_${txToken}`))
    );
    const rollbackDir = assertPathAllowed(
      assertInsideDirectory(
        safeClassRoot,
        path.join(safeClassRoot, `.spck_portal_rollback_${folderHex}__${txToken}`)
      )
    );

    let swappedToTarget = false;
    let hadExistingFolder = false;
    let canCleanupRollbackDir = true;

    try {
      fs.mkdirSync(stagingDir, { recursive: true });

      for (const entry of finalDecodedEntries) {
        const destFilePath = assertInsideDirectory(
          stagingDir,
          path.join(stagingDir, entry.cleanRelPath)
        );
        assertPathAllowed(destFilePath);
        const parentDir = path.dirname(destFilePath);
        assertInsideDirectory(stagingDir, parentDir);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        fs.writeFileSync(destFilePath, entry.buf);
      }

      if (rawTitle || youtubeInput || presentationInput) {
        const linksFilePath = assertInsideDirectory(
          stagingDir,
          path.join(stagingDir, "links.txt")
        );
        fs.writeFileSync(linksFilePath, linksLines.join("\n") + "\n", "utf8");
      }

      if (needTeacherConfirm) {
        // Persist unconfirmed portal marker inside `stagingDir` BEFORE touching or renaming `safeStudentFolder`
        // so any disk error (ENOSPC/EACCES) leaves `safeStudentFolder` 100% intact in place immediately!
        writeDiskPortalUnconfirmedMarker(stagingDir, activeClassId, student.studentId);
      }

      hadExistingFolder = fs.existsSync(safeStudentFolder);
      if (hadExistingFolder) {
        // Preserve teacher-owned folders across student re-uploads (fail closed on read/copy error)
        for (const teacherOwnedDirName of ["_spck_owner_uploads", "_spck_youtube_frames"]) {
          const srcTeacherDir = path.join(safeStudentFolder, teacherOwnedDirName);
          let teacherDirStat: fs.Stats | undefined;
          try {
            teacherDirStat = fs.lstatSync(srcTeacherDir);
          } catch (err: unknown) {
            const code = (err as NodeJS.ErrnoException | undefined)?.code;
            if (code !== "ENOENT" && code !== "ENOTDIR") {
              throw err;
            }
          }
          if (teacherDirStat && teacherDirStat.isDirectory() && !teacherDirStat.isSymbolicLink()) {
            const dstTeacherDir = path.join(stagingDir, teacherOwnedDirName);
            fs.mkdirSync(dstTeacherDir, { recursive: true });
            copyDirectoryTreeVerified(srcTeacherDir, dstTeacherDir);
          }
        }

        // Preserve any `_spck_app_shots` files still referenced by an APPROVED/SAVING session draft (fail closed)
        preserveProtectedAppShotsVerified({
          classId: activeClassId,
          studentId: student.studentId,
          safeStudentFolder,
          stagingDir,
        });

        // Preserve 100% of previous student files in `_spck_prev_backup/{protected,latest}`
        // BEFORE moving `safeStudentFolder`. If any directory/file read or copy fails, throw
        // immediately so `safeStudentFolder` remains completely untouched.
        const existingTopEntries = fs.readdirSync(safeStudentFolder);
        const hasPriorStudentFiles = existingTopEntries.some((name) => {
          const lower = name.toLowerCase();
          return (
            !lower.startsWith("_spck_") &&
            lower !== ".ds_store" &&
            lower !== "thumbs.db"
          );
        });

        const existingProtectedBackup = path.join(
          safeStudentFolder,
          "_spck_prev_backup",
          "protected"
        );
        const stagingProtectedBackup = path.join(stagingDir, "_spck_prev_backup", "protected");
        const stagingLatestBackup = path.join(stagingDir, "_spck_prev_backup", "latest");

        if (
          fs.existsSync(existingProtectedBackup) &&
          existingRecord?.status !== "VERIFIED"
        ) {
          fs.mkdirSync(stagingProtectedBackup, { recursive: true });
          copyDirectoryTreeVerified(existingProtectedBackup, stagingProtectedBackup);
        } else if (hasPriorStudentFiles) {
          fs.mkdirSync(stagingProtectedBackup, { recursive: true });
          copyDirectoryTreeVerified(safeStudentFolder, stagingProtectedBackup, {
            skipTopLevelPred: (name) => name.toLowerCase().startsWith("_spck_"),
          });
        }

        if (hasPriorStudentFiles) {
          fs.mkdirSync(stagingLatestBackup, { recursive: true });
          copyDirectoryTreeVerified(safeStudentFolder, stagingLatestBackup, {
            skipTopLevelPred: (name) => name.toLowerCase().startsWith("_spck_"),
          });
        }

        // Swap existing folder -> rollbackDir, then stagingDir -> safeStudentFolder.
        // Mark `canCleanupRollbackDir = false` until either SQLite commits OR rollback restore succeeds.
        fs.renameSync(safeStudentFolder, rollbackDir);
        canCleanupRollbackDir = false;
      }

      try {
        fs.renameSync(stagingDir, safeStudentFolder);
        swappedToTarget = true;
      } catch (renameErr) {
        if (hadExistingFolder && fs.existsSync(rollbackDir) && !fs.existsSync(safeStudentFolder)) {
          try {
            fs.renameSync(rollbackDir, safeStudentFolder);
            if (fs.existsSync(safeStudentFolder)) {
              canCleanupRollbackDir = true;
            }
          } catch (restoreErr) {
            throw new Error(
              `Không thể hoán đổi thư mục nộp bài và không thể tự động khôi phục thư mục gốc (${
                restoreErr instanceof Error ? restoreErr.message : String(restoreErr)
              }). Bản gốc đầy đủ đang được bảo toàn tại '${rollbackDir}'.`
            );
          }
        }
        throw renameErr;
      }

      // Step 3 (Async non-blocking scan & atomic SQLite commit; restore rollbackDir on any failure):
      let canonicalStudentFolder = "";
      let packageData: StudentSpckPackage;
      try {
        canonicalStudentFolder = canonicalizeSpckFolderPath(safeStudentFolder);
        packageData = await scanStudentSpckFolderAsync(canonicalStudentFolder, student.fullName);

        const parseSafeArray = <T>(raw?: string | null): T[] => {
          if (!raw) return [];
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        };

        const existingLinks = parseSafeArray<{ name: string; url: string }>(
          existingRecord?.relatedLinksJson
        );
        const preservedInfraLinks = existingLinks.filter(
          (l) =>
            String(l?.url || "").includes("drive.google.com/drive/folders/") ||
            String(l?.url || "").includes(".github.io/")
        );
        const otherExistingLinks = existingLinks.filter(
          (l) =>
            !String(l?.url || "").includes("drive.google.com/drive/folders/") &&
            !String(l?.url || "").includes(".github.io/")
        );
        const mergedLinksMap = new Map<string, { name: string; url: string }>();
        const orderedCandidates = presentationInput
          ? [...preservedInfraLinks, ...(packageData.relatedLinks || []), ...otherExistingLinks]
          : [...existingLinks, ...(packageData.relatedLinks || [])];
        for (const l of orderedCandidates) {
          if (l && l.url && !mergedLinksMap.has(l.url)) {
            mergedLinksMap.set(l.url, l);
          }
        }
        const mergedRelatedLinks = Array.from(mergedLinksMap.values()).slice(0, 5);

        const existingYt = parseSafeArray<string>(existingRecord?.youtubeUrlsJson);
        const mergedYoutubeUrls = Array.from(
          new Set(
            youtubeInput
              ? [...(packageData.youtubeUrls || []), ...existingYt]
              : [...existingYt, ...(packageData.youtubeUrls || [])]
          )
        ).slice(0, 5);

        const commitDb = getDb().transaction(() => {
          spckUploadRepo.upsert({
            classId: activeClassId,
            studentId: student.studentId,
            localFolderPath: canonicalStudentFolder,
            matchScore: 1.0,
            isConfirmedByTeacher: needTeacherConfirm ? 0 : 1,
            pendingPortalConfirmation: needTeacherConfirm ? 1 : 0,
            projectTitle: finalTitle || packageData.projectTitle,
            thumbnailPath: packageData.thumbnailPath,
            screenshotsJson: JSON.stringify(packageData.screenshots),
            attachmentsJson: JSON.stringify(packageData.attachments),
            youtubeUrlsJson: JSON.stringify(mergedYoutubeUrls),
            relatedLinksJson: JSON.stringify(mergedRelatedLinks),
            teacherComment: existingRecord?.teacherComment ?? "",
            lastPreppedFolderDigest: "",
            // Content changed -> reset contentHash & set status to WAITING_APPROVAL (Rule 4)
            contentHash: "",
            status: "WAITING_APPROVAL",
            verifiedAt: null,
            errorMessage: null,
          });

          // Keep unverified session drafts (12, 13, 14) in sync while preserving teacherComment/teacherNote/quickTags
          this.syncStudentUnverifiedSessionDrafts(
            activeClassId,
            student.studentId,
            rawTitle ? finalTitle : undefined,
            needTeacherConfirm ? 0 : 1
          );
        });
        commitDb();
        if (needTeacherConfirm) {
          this.unconfirmedPortalByClassStudent.add(
            `${activeClassId.trim().toUpperCase()}::${student.studentId}`
          );
        } else {
          this.unconfirmedPortalByClassStudent.delete(
            `${activeClassId.trim().toUpperCase()}::${student.studentId}`
          );
          removeDiskPortalUnconfirmedMarker(canonicalStudentFolder);
        }
        canCleanupRollbackDir = true;
      } catch (commitErr) {
        let restoredOriginalOk = !hadExistingFolder;
        if (swappedToTarget) {
          try {
            if (fs.existsSync(safeStudentFolder)) {
              fs.rmSync(safeStudentFolder, { recursive: true, force: true });
            }
          } catch {}
          if (hadExistingFolder && fs.existsSync(rollbackDir)) {
            try {
              fs.renameSync(rollbackDir, safeStudentFolder);
              restoredOriginalOk = fs.existsSync(safeStudentFolder);
            } catch {
              restoredOriginalOk = false;
            }
          }
          swappedToTarget = false;
        }
        canCleanupRollbackDir = restoredOriginalOk;
        if (!restoredOriginalOk && fs.existsSync(rollbackDir)) {
          const baseMsg =
            commitErr instanceof Error ? commitErr.message : String(commitErr);
          throw new Error(
            `${baseMsg} (Bản sao khôi phục nguyên vẹn của bài cũ đang được giữ an toàn tại '${rollbackDir}')`
          );
        }
        throw commitErr;
      }

      const writtenFilesCount = finalDecodedEntries.length;
      const isExempt = isCourseExemptFromSpck(activeClassId);
      const shouldRunAutoPrep = !needTeacherConfirm && !isExempt;
      const shouldQueueDrive = shouldRunAutoPrep && this.autoUploadDrive;

      const submissionItem: StudentPortalSubmissionItem = {
        classId: activeClassId,
        studentId: student.studentId,
        fullName: student.fullName,
        folderName: path.basename(canonicalStudentFolder),
        folderPath: canonicalStudentFolder,
        projectTitle: finalTitle || packageData.projectTitle,
        filesCount: writtenFilesCount,
        totalBytes: totalRawBytes,
        submittedAt: new Date().toISOString(),
        confirmedByTeacher: !needTeacherConfirm,
        driveStatus: isExempt ? "EXEMPT" : shouldQueueDrive ? "QUEUED" : "IDLE",
      };

      this.submissions.set(student.studentId, submissionItem);
      this.bumpStateVersion();

      jobLogRepo.add({
        jobId: `STUDENT_SUBMIT_${Date.now()}`,
        jobType: "SPCK_STUDENT_SUBMIT",
        classId: activeClassId,
        studentId: student.studentId,
        level: "INFO",
        message: needTeacherConfirm
          ? `[StudentPortal] Học viên ${student.fullName} (${student.studentId}) đã nộp ${writtenFilesCount} file (${Math.round(
              totalRawBytes / 1024
            )} KB) vào ${canonicalStudentFolder} (chờ giáo viên xác nhận).`
          : `[StudentPortal] Học viên ${student.fullName} (${student.studentId}) đã nộp ${writtenFilesCount} file (${Math.round(
              totalRawBytes / 1024
            )} KB) vào ${canonicalStudentFolder} — tự động chạy chuẩn bị ảnh/Web/Drive.`,
      });

      if (shouldRunAutoPrep) {
        this.uploadSingleStudentToDriveInBackground(
          activeClassId,
          student.studentId,
          this.driveFolderUrl,
          { runFullAutoPrep: true }
        ).catch(() => {});
      }

      return {
        success: true,
        submission: submissionItem,
      };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : "Không thể lưu bài nộp vào thư mục lớp. Bài cũ (nếu có) vẫn được giữ nguyên.",
      };
    } finally {
      try {
        if (fs.existsSync(stagingDir)) {
          fs.rmSync(stagingDir, { recursive: true, force: true });
        }
      } catch {}
      if (canCleanupRollbackDir) {
        try {
          if (fs.existsSync(rollbackDir)) {
            fs.rmSync(rollbackDir, { recursive: true, force: true });
          }
        } catch {}
      }
    }
  }

  private syncStudentUnverifiedSessionDrafts(
    classId: string,
    studentId: string,
    explicitBaseTitle?: string,
    confirmedOverride?: 0 | 1
  ): void {
    for (const slotNum of [12, 13, 14] as const) {
      try {
        const sessRow = spckSessionRepo.findOne(classId, studentId, slotNum);
        if (
          !sessRow ||
          sessRow.lastVerifiedAt ||
          sessRow.draftStatus === "VERIFIED" ||
          sessRow.draftStatus === "APPROVED" ||
          sessRow.draftStatus === "SAVING"
        ) {
          continue;
        }
        spckSessionRepo.syncLatestSharedResourcesToSessionDraft(
          classId,
          studentId,
          slotNum
        );
        if (confirmedOverride !== undefined || explicitBaseTitle) {
          spckSessionRepo.saveSessionDraft({
            classId,
            studentId,
            sessionNumber: slotNum,
            ...(confirmedOverride !== undefined
              ? { isConfirmedByTeacher: confirmedOverride }
              : {}),
            ...(explicitBaseTitle ? { projectTitle: explicitBaseTitle } : {}),
            updateSharedPool: false,
          });
        }
      } catch {}
    }
  }

  public hasUnconfirmedSubmission(
    classId: string,
    studentId: string,
    candidateFolderPath?: string | null
  ): boolean {
    const normalizedClassId = String(classId || "").trim().toUpperCase();
    const normalizedStudentId = String(studentId || "").trim();
    if (!normalizedClassId || !normalizedStudentId) return false;
    if (this.unconfirmedPortalByClassStudent.has(`${normalizedClassId}::${normalizedStudentId}`)) {
      return true;
    }
    const sub = this.submissions.get(normalizedStudentId);
    if (sub) {
      const subClass = String(sub.classId || this.classId || "").trim().toUpperCase();
      if (subClass === normalizedClassId && sub.confirmedByTeacher === false) {
        return true;
      }
    }
    try {
      const rec = spckUploadRepo.findOne(normalizedClassId, normalizedStudentId);
      if (rec && Number(rec.isConfirmedByTeacher) === 0) {
        if (
          Number(rec.pendingPortalConfirmation) === 1 ||
          hasDiskPortalUnconfirmedMarker(
            rec.localFolderPath,
            normalizedClassId,
            normalizedStudentId
          )
        ) {
          this.unconfirmedPortalByClassStudent.add(
            `${normalizedClassId}::${normalizedStudentId}`
          );
          return true;
        }
      }
      const sameAsConfirmedDbFolder =
        Boolean(rec) &&
        Number(rec?.isConfirmedByTeacher) === 1 &&
        Number(rec?.pendingPortalConfirmation ?? 0) === 0 &&
        Boolean(candidateFolderPath) &&
        Boolean(rec?.localFolderPath) &&
        path.resolve(String(candidateFolderPath)).toLowerCase() ===
          path.resolve(String(rec?.localFolderPath)).toLowerCase();
      if (
        candidateFolderPath &&
        !sameAsConfirmedDbFolder &&
        hasDiskPortalUnconfirmedMarker(
          candidateFolderPath,
          normalizedClassId,
          normalizedStudentId
        )
      ) {
        return true;
      }
    } catch {
      // Fail closed if SQLite lookup fails unexpectedly
      return true;
    }
    return false;
  }

  public clearUnconfirmedSubmission(
    classId: string,
    studentId: string,
    folderPath?: string | null
  ): void {
    const normalizedClassId = String(classId || "").trim().toUpperCase();
    const normalizedStudentId = String(studentId || "").trim();
    if (!normalizedClassId || !normalizedStudentId) return;
    this.unconfirmedPortalByClassStudent.delete(`${normalizedClassId}::${normalizedStudentId}`);
    const sub = this.submissions.get(normalizedStudentId);
    if (sub) {
      const subClass = String(sub.classId || this.classId || "").trim().toUpperCase();
      if (subClass === normalizedClassId) {
        sub.confirmedByTeacher = true;
      }
    }
    if (folderPath) {
      removeDiskPortalUnconfirmedMarker(folderPath);
    }
    try {
      const rec = spckUploadRepo.findOne(normalizedClassId, normalizedStudentId);
      if (rec?.localFolderPath) {
        removeDiskPortalUnconfirmedMarker(rec.localFolderPath);
      }
    } catch {}
  }

  public queueDriveUploadForConfirmedStudent(classId: string, studentId: string): void {
    const normalizedClassId = String(classId || "").trim().toUpperCase();
    const normalizedStudentId = String(studentId || "").trim();
    this.clearUnconfirmedSubmission(normalizedClassId, normalizedStudentId);
    const sub = this.submissions.get(normalizedStudentId);
    if (
      !this.isRunning ||
      !this.autoUploadDrive ||
      !normalizedClassId ||
      !normalizedStudentId ||
      this.classId !== normalizedClassId ||
      isCourseExemptFromSpck(normalizedClassId)
    ) {
      return;
    }
    if (sub && sub.driveStatus === "IDLE") {
      sub.driveStatus = "QUEUED";
      this.bumpStateVersion();
      this.uploadSingleStudentToDriveInBackground(
        normalizedClassId,
        normalizedStudentId,
        this.driveFolderUrl
      ).catch(() => {});
    }
  }

  public async restoreStudentPreviousBackup(
    classId: string,
    studentId: string,
    sessionNumber?: SpckSessionNumber
  ): Promise<{
    restoredFrom: "latest" | "protected";
    folderPath: string;
    hasRemainingBackup: boolean;
  }> {
    const normalizedClassId = String(classId || "").trim().toUpperCase();
    const normalizedStudentId = String(studentId || "").trim();
    if (!normalizedClassId || !normalizedStudentId) {
      throw new Error("Thiếu mã lớp hoặc mã học viên khi khôi phục bản sao lưu.");
    }

    const existing = spckUploadRepo.findOne(normalizedClassId, normalizedStudentId);
    if (!existing?.localFolderPath || !fs.existsSync(existing.localFolderPath)) {
      throw new Error("Không tìm thấy thư mục bài làm của học viên để khôi phục.");
    }

    const safeStudentFolder = assertPathAllowed(existing.localFolderPath);
    const safeClassRoot = assertPathAllowed(path.dirname(safeStudentFolder));
    const latestBackupDir = path.join(safeStudentFolder, "_spck_prev_backup", "latest");
    const protectedBackupDir = path.join(safeStudentFolder, "_spck_prev_backup", "protected");

    let chosenSource: "latest" | "protected" | null = null;
    if (fs.existsSync(latestBackupDir) && fs.readdirSync(latestBackupDir).length > 0) {
      chosenSource = "latest";
    } else if (fs.existsSync(protectedBackupDir) && fs.readdirSync(protectedBackupDir).length > 0) {
      chosenSource = "protected";
    }

    if (!chosenSource) {
      throw new Error("Học viên này chưa có bản sao lưu trước đó để khôi phục.");
    }

    const sourceBackupDir = chosenSource === "latest" ? latestBackupDir : protectedBackupDir;
    const txToken = `${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
    const folderHex = Buffer.from(path.basename(safeStudentFolder), "utf8").toString("hex");
    const stagingDir = assertPathAllowed(
      assertInsideDirectory(
        safeClassRoot,
        path.join(safeClassRoot, `.spck_portal_restore_${txToken}`)
      )
    );
    const rollbackDir = assertPathAllowed(
      assertInsideDirectory(
        safeClassRoot,
        path.join(safeClassRoot, `.spck_portal_rollback_${folderHex}__${txToken}`)
      )
    );
    const failedSwapDir = assertPathAllowed(
      assertInsideDirectory(
        safeClassRoot,
        path.join(safeClassRoot, `.spck_portal_restore_failed_${txToken}`)
      )
    );

    let swapped = false;
    let restoreCommitted = false;
    let canCleanupRollbackDir = false;
    try {
      fs.mkdirSync(stagingDir, { recursive: true });
      copyDirectoryTreeVerified(sourceBackupDir, stagingDir);

      // Preserve teacher-owned folders (fail closed on read/copy error)
      for (const teacherOwnedDirName of ["_spck_owner_uploads", "_spck_youtube_frames"]) {
        const srcTeacherDir = path.join(safeStudentFolder, teacherOwnedDirName);
        let teacherDirStat: fs.Stats | undefined;
        try {
          teacherDirStat = fs.lstatSync(srcTeacherDir);
        } catch (err: unknown) {
          const code = (err as NodeJS.ErrnoException | undefined)?.code;
          if (code !== "ENOENT" && code !== "ENOTDIR") {
            throw err;
          }
        }
        if (teacherDirStat && teacherDirStat.isDirectory() && !teacherDirStat.isSymbolicLink()) {
          const dstTeacherDir = path.join(stagingDir, teacherOwnedDirName);
          fs.mkdirSync(dstTeacherDir, { recursive: true });
          copyDirectoryTreeVerified(srcTeacherDir, dstTeacherDir);
        }
      }

      // Preserve any `_spck_app_shots` files still referenced by an APPROVED/SAVING session draft (fail closed)
      preserveProtectedAppShotsVerified({
        classId: normalizedClassId,
        studentId: normalizedStudentId,
        safeStudentFolder,
        stagingDir,
      });

      // If we restored `latest` and `protected` also existed, promote `protected` into `latest`
      // so a second click can step all the way back to `protected`.
      let hasRemainingBackup = false;
      if (
        chosenSource === "latest" &&
        fs.existsSync(protectedBackupDir) &&
        fs.readdirSync(protectedBackupDir).length > 0
      ) {
        const nextLatest = path.join(stagingDir, "_spck_prev_backup", "latest");
        fs.mkdirSync(nextLatest, { recursive: true });
        copyDirectoryTreeVerified(protectedBackupDir, nextLatest);
        hasRemainingBackup = true;
      }

      fs.renameSync(safeStudentFolder, rollbackDir);
      fs.renameSync(stagingDir, safeStudentFolder);
      swapped = true;

      removeDiskPortalUnconfirmedMarker(safeStudentFolder);
      const stu = studentRepo.findOne(normalizedClassId, normalizedStudentId);
      const fullName = stu?.fullName || normalizedStudentId;
      const canonicalFolder = canonicalizeSpckFolderPath(safeStudentFolder);
      const scanned = await scanStudentSpckFolderAsync(canonicalFolder, fullName);

      spckUploadRepo.upsert({
        ...existing,
        localFolderPath: canonicalFolder,
        isConfirmedByTeacher: 1,
        pendingPortalConfirmation: 0,
        thumbnailPath: scanned.thumbnailPath,
        screenshotsJson: JSON.stringify(scanned.screenshots),
        attachmentsJson: JSON.stringify(scanned.attachments),
        lastPreppedFolderDigest: "",
        contentHash: "",
        status: "WAITING_APPROVAL",
        verifiedAt: null,
        errorMessage: null,
      });

      this.clearUnconfirmedSubmission(normalizedClassId, normalizedStudentId, canonicalFolder);
      this.syncStudentUnverifiedSessionDrafts(
        normalizedClassId,
        normalizedStudentId,
        undefined,
        1
      );
      if (sessionNumber) {
        try {
          const targetSessRow = spckSessionRepo.findOne(
            normalizedClassId,
            normalizedStudentId,
            sessionNumber
          );
          if (
            targetSessRow &&
            !targetSessRow.lastVerifiedAt &&
            targetSessRow.draftStatus !== "VERIFIED" &&
            targetSessRow.draftStatus !== "SAVING"
          ) {
            spckSessionRepo.syncLatestSharedResourcesToSessionDraft(
              normalizedClassId,
              normalizedStudentId,
              sessionNumber
            );
          }
        } catch {}
      }
      this.bumpStateVersion();
      restoreCommitted = true;
      canCleanupRollbackDir = true;

      // Best-effort audit telemetry AFTER commit: log failures must never destroy or roll back a completed restore
      try {
        jobLogRepo.add({
          jobId: `RESTORE_PORTAL_BACKUP_${Date.now()}`,
          jobType: "SPCK_STUDENT_PORTAL",
          classId: normalizedClassId,
          studentId: normalizedStudentId,
          level: "SUCCESS",
          message: `Đã khôi phục bản bài làm trước đó (${chosenSource}) cho học viên '${fullName}'.`,
        });
      } catch {}

      return {
        restoredFrom: chosenSource,
        folderPath: canonicalFolder,
        hasRemainingBackup,
      };
    } catch (err) {
      if (!restoreCommitted) {
        if (swapped) {
          // Never delete `safeStudentFolder` unless `rollbackDir` is verifiably present to take its place!
          if (fs.existsSync(rollbackDir)) {
            try {
              if (fs.existsSync(safeStudentFolder)) {
                fs.renameSync(safeStudentFolder, failedSwapDir);
              }
              fs.renameSync(rollbackDir, safeStudentFolder);
              canCleanupRollbackDir = fs.existsSync(safeStudentFolder);
              if (canCleanupRollbackDir && fs.existsSync(failedSwapDir)) {
                fs.rmSync(failedSwapDir, { recursive: true, force: true });
              }
            } catch {
              // If rollback rename failed and safeStudentFolder is missing, recover from failedSwapDir so student work is never lost
              try {
                if (!fs.existsSync(safeStudentFolder) && fs.existsSync(failedSwapDir)) {
                  fs.renameSync(failedSwapDir, safeStudentFolder);
                }
              } catch {}
              canCleanupRollbackDir = false;
            }
          }
        } else if (fs.existsSync(rollbackDir) && !fs.existsSync(safeStudentFolder)) {
          try {
            fs.renameSync(rollbackDir, safeStudentFolder);
            canCleanupRollbackDir = fs.existsSync(safeStudentFolder);
          } catch {
            canCleanupRollbackDir = false;
          }
        } else {
          canCleanupRollbackDir = fs.existsSync(safeStudentFolder);
        }
      }
      throw err;
    } finally {
      try {
        if (fs.existsSync(stagingDir)) {
          fs.rmSync(stagingDir, { recursive: true, force: true });
        }
      } catch {}
      try {
        if (fs.existsSync(safeStudentFolder) && fs.existsSync(failedSwapDir)) {
          fs.rmSync(failedSwapDir, { recursive: true, force: true });
        }
      } catch {}
      if (canCleanupRollbackDir && fs.existsSync(safeStudentFolder)) {
        try {
          if (fs.existsSync(rollbackDir)) {
            fs.rmSync(rollbackDir, { recursive: true, force: true });
          }
        } catch {}
      }
    }
  }

  private async uploadSingleStudentToDriveInBackground(
    classId: string,
    studentId: string,
    driveFolderUrl: string,
    options?: { runFullAutoPrep?: boolean }
  ): Promise<void> {
    const stateKey = `${classId}::${studentId}`;
    const existingState = this.driveUploadStateByStudent.get(stateKey);
    if (existingState?.running) {
      existingState.pendingRerun = true;
      existingState.driveFolderUrl = driveFolderUrl;
      if (options?.runFullAutoPrep) {
        existingState.runFullAutoPrep = true;
      }
      const sub = this.submissions.get(studentId);
      if (sub && this.autoUploadDrive) {
        sub.driveStatus = "UPLOADING";
        sub.driveError = undefined;
        this.bumpStateVersion();
      }
      return;
    }

    const state = {
      running: true,
      pendingRerun: false,
      driveFolderUrl,
      runFullAutoPrep: Boolean(options?.runFullAutoPrep),
    };
    this.driveUploadStateByStudent.set(stateKey, state);
    const startGen = this.portalGeneration;

    try {
      while (true) {
        state.pendingRerun = false;
        const currentDriveFolderUrl = state.driveFolderUrl;
        const runFullAutoPrep = Boolean(state.runFullAutoPrep);
        const targetSession = this.activeSessionNumber;
        const prePrepRec = spckUploadRepo.findOne(classId, studentId);
        const prePrepDigestInfo = prePrepRec?.localFolderPath
          ? computeStudentFolderContentDigest(prePrepRec.localFolderPath)
          : null;
        let allPrepStepsSucceeded = true;
        let driveStepSucceeded = true;

        // 1. Auto-capture fresh 16:9 screenshots (and AI Vision thumbnail) when in full Auto-Prep mode
        if (runFullAutoPrep) {
          try {
            const shotRes = await SequentialTaskQueue.getInstance().enqueue({
              id: `portal_shots_${classId}_${studentId}_${Date.now()}`,
              jobType: "UPLOAD_SPCK",
              classId,
              description: `Tự động chụp ảnh SPCK cho học viên ${studentId} (${classId})`,
              execute: async () =>
                captureClassAppScreenshotsAndSelectThumbnails({
                  classId,
                  studentIds: [studentId],
                  useAiVision: true,
                  sessionNumber: targetSession,
                  allowDemoteApprovedSession: false,
                }),
            });
            if (shotRes.results.some((r) => Boolean(r.error))) {
              allPrepStepsSucceeded = false;
            }
            this.syncStudentUnverifiedSessionDrafts(classId, studentId, undefined, 1);
            this.bumpStateVersion();
          } catch {
            allPrepStepsSucceeded = false;
            // Non-fatal: continue to Web deploy & Google Drive upload even if screenshot capture warns
          }
        }

        // 2. Auto-deploy to GitHub Pages for Web (JSB/JSA/JSI) and CS (CSA/CSI) when `.html` exists
        if (runFullAutoPrep && isWebOrCsGithubTrack(classId)) {
          try {
            const webRes = await SequentialTaskQueue.getInstance().enqueue({
              id: `portal_web_${classId}_${studentId}_${Date.now()}`,
              jobType: "UPLOAD_SPCK",
              classId,
              description: `Tự động đẩy Web SPCK lên GitHub Pages cho ${studentId} (${classId})`,
              execute: async () =>
                SpckWebDeployer.deployClassWebSpckToGithubPages({
                  classId,
                  studentIds: [studentId],
                  sessionNumber: targetSession,
                  syncAllUnverifiedSessions: true,
                }),
            });
            if (webRes.failedStudentsCount > 0) {
              allPrepStepsSucceeded = false;
            }
            this.syncStudentUnverifiedSessionDrafts(classId, studentId, undefined, 1);
            this.bumpStateVersion();
          } catch {
            allPrepStepsSucceeded = false;
            // Non-fatal: continue to Google Drive upload even if GitHub Pages fails/offline
          }
        }

        // 3. Auto-upload versioned `.zip` bundle (+ standalone Slide/Video) to Google Drive
        if (!this.autoUploadDrive) {
          this.syncStudentUnverifiedSessionDrafts(classId, studentId, undefined, 1);
          this.bumpStateVersion();
        } else {
          const sub = this.submissions.get(studentId);
          if (sub) {
            sub.driveStatus = "UPLOADING";
            sub.driveError = undefined;
            this.bumpStateVersion();
          }

          try {
            const batchResult = await SpckDriveUploader.uploadClassSpckToGoogleDrive({
              classId,
              driveFolderUrl: currentDriveFolderUrl,
              studentIds: [studentId],
              uploadMode: "zip_bundle",
              sessionNumber: targetSession,
              syncAllUnverifiedSessions: true,
              allowDemoteApprovedSession: false,
            });

            this.syncStudentUnverifiedSessionDrafts(
              classId,
              studentId,
              undefined,
              runFullAutoPrep ? 1 : undefined
            );

            const stuRes = batchResult.results.find((r) => r.studentId === studentId);
            const driveOk = Boolean(
              stuRes && stuRes.status === "SUCCESS" && stuRes.driveFolderUrl
            );
            driveStepSucceeded = driveOk;

            const currentSub = this.submissions.get(studentId);
            if (currentSub && !state.pendingRerun) {
              if (driveOk && stuRes?.driveFolderUrl) {
                currentSub.driveStatus = "UPLOADED";
                currentSub.driveFolderUrl = stuRes.driveFolderUrl;
                currentSub.driveError = undefined;
              } else {
                currentSub.driveStatus = "FAILED";
                currentSub.driveError =
                  stuRes?.errorMessage || "Không thể tải lên Google Drive.";
              }
            }
            this.bumpStateVersion();
          } catch (err) {
            driveStepSucceeded = false;
            const currentSub = this.submissions.get(studentId);
            if (currentSub && !state.pendingRerun) {
              currentSub.driveStatus = "FAILED";
              currentSub.driveError =
                err instanceof Error ? err.message : String(err);
            }
            this.bumpStateVersion();
          }
        }

        // Unified end-of-pass consistency verification: stamp `lastPreppedFolderDigest` ONLY if
        // the student's folder stayed 100% identical across Screenshots -> Web -> Drive; otherwise clear `""`.
        try {
          const latestRec = spckUploadRepo.findOne(classId, studentId);
          if (latestRec) {
            const sameFolder =
              Boolean(latestRec.localFolderPath) &&
              Boolean(prePrepRec?.localFolderPath) &&
              normalizeSpckFolderKey(latestRec.localFolderPath) ===
                normalizeSpckFolderKey(prePrepRec!.localFolderPath);
            const postDigestInfo = latestRec.localFolderPath
              ? computeStudentFolderContentDigest(latestRec.localFolderPath)
              : null;
            const driveDigestVerified =
              !this.autoUploadDrive ||
              Boolean(
                postDigestInfo?.digest &&
                  latestRec.lastPreppedFolderDigest === postDigestInfo.digest
              );
            const wholePassConsistent =
              allPrepStepsSucceeded &&
              driveStepSucceeded &&
              !state.pendingRerun &&
              sameFolder &&
              (prePrepDigestInfo?.filesCount ?? 0) > 0 &&
              Boolean(prePrepDigestInfo?.digest) &&
              Boolean(
                postDigestInfo &&
                  postDigestInfo.filesCount > 0 &&
                  postDigestInfo.digest === prePrepDigestInfo!.digest
              ) &&
              driveDigestVerified;
            spckUploadRepo.markFolderPrepped(
              classId,
              studentId,
              wholePassConsistent ? postDigestInfo!.digest : ""
            );
          }
        } catch {}

        if (!state.pendingRerun || !this.isRunning || this.portalGeneration !== startGen) {
          break;
        }
      }
    } finally {
      state.running = false;
      this.driveUploadStateByStudent.delete(stateKey);
    }
  }

  private renderStudentPortalHtml(): string {
    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Nộp Sản Phẩm Cuối Khóa (SPCK) — Lớp ${this.classId}</title>
  <style>
    :root {
      --bg: #090d16;
      --card: #111827;
      --border: #1f2937;
      --mindx: #e11d48;
      --emerald: #10b981;
      --sky: #0284c7;
      --text: #f8fafc;
      --muted: #94a3b8;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: radial-gradient(circle at top, #1e1b4b 0%, var(--bg) 60%);
      color: var(--text);
      min-height: 100vh;
      padding: 24px 16px 60px;
    }
    .container {
      max-width: 720px;
      margin: 0 auto;
    }
    .header-card {
      background: linear-gradient(135deg, rgba(225,29,72,0.18), rgba(17,24,39,0.95));
      border: 1px solid rgba(225,29,72,0.4);
      border-radius: 18px;
      padding: 22px 24px;
      margin-bottom: 20px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.4);
    }
    .badge {
      display: inline-block;
      background: var(--mindx);
      color: #fff;
      font-weight: 700;
      font-size: 11px;
      padding: 4px 10px;
      border-radius: 999px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    h1 {
      margin: 0 0 6px;
      font-size: 22px;
      line-height: 1.3;
    }
    .sub {
      margin: 0;
      color: #cbd5e1;
      font-size: 13.5px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 22px 24px;
      margin-bottom: 18px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.25);
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 700;
      color: #e2e8f0;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    select, input[type="text"], input[type="url"] {
      width: 100%;
      padding: 12px 14px;
      border-radius: 10px;
      border: 1px solid #334155;
      background: #030712;
      color: #fff;
      font-size: 14.5px;
      outline: none;
      transition: border-color 0.2s;
    }
    select:focus, input:focus {
      border-color: var(--emerald);
    }
    .field-group {
      margin-bottom: 18px;
    }
    .hint {
      font-size: 12px;
      color: var(--muted);
      margin-top: 5px;
    }
    .upload-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-top: 10px;
    }
    @media (max-width: 560px) {
      .upload-grid { grid-template-columns: 1fr; }
    }
    .pick-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 18px 14px;
      border-radius: 12px;
      border: 2px dashed #3b82f6;
      background: rgba(59, 130, 246, 0.08);
      color: #dbeafe;
      cursor: pointer;
      text-align: center;
      transition: all 0.2s;
    }
    .pick-btn:hover {
      background: rgba(59, 130, 246, 0.16);
      border-color: #60a5fa;
    }
    .pick-btn.emerald {
      border-color: #10b981;
      background: rgba(16, 185, 129, 0.08);
      color: #d1fae5;
    }
    .pick-btn.emerald:hover {
      background: rgba(16, 185, 129, 0.16);
      border-color: #34d399;
    }
    .pick-btn strong {
      font-size: 14px;
      margin-top: 6px;
    }
    .pick-btn span {
      font-size: 11.5px;
      color: var(--muted);
      margin-top: 4px;
    }
    .file-list {
      margin-top: 14px;
      max-height: 210px;
      overflow-y: auto;
      background: #030712;
      border: 1px solid #1e293b;
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 12.5px;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    }
    .file-item {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      border-bottom: 1px solid #111827;
      color: #cbd5e1;
    }
    .file-item:last-child { border-bottom: none; }
    .submit-btn {
      width: 100%;
      padding: 15px 20px;
      border-radius: 12px;
      border: none;
      background: linear-gradient(135deg, #10b981, #059669);
      color: #fff;
      font-size: 16px;
      font-weight: 800;
      cursor: pointer;
      box-shadow: 0 6px 20px rgba(16, 185, 129, 0.35);
      transition: transform 0.15s, opacity 0.2s;
    }
    .submit-btn:hover:not(:disabled) {
      transform: translateY(-1px);
    }
    .submit-btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    .status-box {
      padding: 16px 18px;
      border-radius: 12px;
      margin-top: 16px;
      font-size: 14px;
      line-height: 1.5;
    }
    .status-box.success {
      background: rgba(16, 185, 129, 0.14);
      border: 1px solid rgba(16, 185, 129, 0.5);
      color: #d1fae5;
    }
    .status-box.warning {
      background: rgba(245, 158, 11, 0.14);
      border: 1px solid rgba(245, 158, 11, 0.5);
      color: #fef3c7;
    }
    .status-box.error {
      background: rgba(244, 63, 94, 0.14);
      border: 1px solid rgba(244, 63, 94, 0.5);
      color: #ffe4e6;
    }
    .progress-bar-wrap {
      width: 100%;
      height: 10px;
      background: #1e293b;
      border-radius: 999px;
      overflow: hidden;
      margin-top: 12px;
      display: none;
    }
    .progress-bar {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #0ea5e9, #10b981);
      transition: width 0.2s;
    }
    .drive-btn {
      display: inline-block;
      margin-top: 10px;
      padding: 8px 14px;
      border-radius: 8px;
      background: #0284c7;
      color: #fff;
      text-decoration: none;
      font-weight: 700;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header-card">
      <span class="badge">MINDX TECH &amp; AI SCHOOL</span>
      <h1>🚀 Cổng Nộp Sản Phẩm Cuối Khóa — Lớp ${this.classId}</h1>
      <p class="sub">Con chọn đúng Họ Tên, tải thư mục hoặc file dự án lên. Hệ thống sẽ tự động lưu bài và đẩy lên Google Drive của lớp!</p>
    </div>

    <div class="card">
      <div class="field-group">
        <label for="studentSelect">1. Chọn Họ và Tên Học Viên *</label>
        <select id="studentSelect">
          <option value="">-- Đang tải danh sách học viên lớp ${this.classId}... --</option>
        </select>
        <div class="hint" id="studentStatusHint">Hãy chọn đúng tên của con trong danh sách lớp.</div>
      </div>

      <div class="field-group">
        <label for="projectTitle">2. Tên Sản Phẩm / Dự Án Cuối Khóa *</label>
        <input type="text" id="projectTitle" maxlength="100" placeholder="VD: Ứng dụng Quản lý Thư viện / Game Không Chiến..." />
        <div class="hint">Tối đa 100 ký tự (Nếu để trống sẽ tự động đặt là SPCK + Họ Tên).</div>
      </div>

      <div class="field-group" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label for="youtubeUrl">3. Link Video YouTube (Nếu có)</label>
          <input type="url" id="youtubeUrl" placeholder="https://www.youtube.com/watch?v=..." />
        </div>
        <div>
          <label for="presentationUrl">4. Link Slide / Canva (Nếu có)</label>
          <input type="url" id="presentationUrl" placeholder="https://www.canva.com/..." />
        </div>
      </div>

      <div class="field-group">
        <label>5. Chọn Thư Mục Dự Án hoặc File Bài Làm *</label>
        <div class="upload-grid">
          <label class="pick-btn emerald">
            <span style="font-size:26px;">📁</span>
            <strong>Chọn Cả Thư Mục Dự Án</strong>
            <span>Dành cho Python, PyQt6 (.ui), Web (.html/.css/.js)... Giữ nguyên các thư mục ảnh/giao diện con!</span>
            <input type="file" id="folderInput" webkitdirectory directory multiple style="display:none;" />
          </label>

          <label class="pick-btn">
            <span style="font-size:26px;">📄</span>
            <strong>Chọn File Lẻ (.zip, .sb3, .yyz, .pptx...)</strong>
            <span>Dành cho Scratch (.sb3), GameMaker (.yyz), file nén .zip, Slide thuyết trình, hình ảnh...</span>
            <input type="file" id="filesInput" multiple style="display:none;" />
          </label>
        </div>

        <div id="selectedSummary" style="display:none;margin-top:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span id="fileCountLabel" style="font-size:13px;font-weight:700;color:#34d399;"></span>
            <button type="button" id="clearFilesBtn" style="background:transparent;border:1px solid #475569;color:#cbd5e1;border-radius:6px;padding:3px 10px;font-size:12px;cursor:pointer;">Xóa chọn lại</button>
          </div>
          <div class="file-list" id="fileListBox"></div>
        </div>
      </div>

      <button type="button" id="submitBtn" class="submit-btn" disabled>
        🚀 NỘP SẢN PHẨM CUỐI KHÓA
      </button>

      <div class="progress-bar-wrap" id="progressWrap">
        <div class="progress-bar" id="progressBar"></div>
      </div>

      <div id="statusBox" style="display:none;"></div>
    </div>
  </div>

  <script>
    const IGNORED_DIRS = new Set(['node_modules', '__pycache__', '.git', '.venv', 'venv', 'env', '.idea', '.vscode', '_spck_app_shots', '_spck_owner_uploads', '_spck_youtube_frames', '_spck_prev_backup']);
    const FORBIDDEN_EXTS = new Set(['.exe', '.dll', '.bat', '.cmd', '.ps1', '.vbs', '.msi', '.scr', '.com', '.pif', '.lnk', '.hta', '.jar', '.reg', '.wsf']);
    const UNSUPPORTED_ARCHIVES = new Set(['.rar', '.7z', '.tar', '.gz', '.bz2', '.xz']);

    const studentSelect = document.getElementById('studentSelect');
    const studentStatusHint = document.getElementById('studentStatusHint');
    const projectTitleInput = document.getElementById('projectTitle');
    const youtubeUrlInput = document.getElementById('youtubeUrl');
    const presentationUrlInput = document.getElementById('presentationUrl');
    const folderInput = document.getElementById('folderInput');
    const filesInput = document.getElementById('filesInput');
    const selectedSummary = document.getElementById('selectedSummary');
    const fileCountLabel = document.getElementById('fileCountLabel');
    const fileListBox = document.getElementById('fileListBox');
    const clearFilesBtn = document.getElementById('clearFilesBtn');
    const submitBtn = document.getElementById('submitBtn');
    const progressWrap = document.getElementById('progressWrap');
    const progressBar = document.getElementById('progressBar');
    const statusBox = document.getElementById('statusBox');

    let studentsData = [];
    let selectedFiles = [];
    let pollTimer = null;

    function escapeHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function formatBytes(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    function showStatus(type, html) {
      statusBox.style.display = 'block';
      statusBox.className = 'status-box ' + type;
      statusBox.innerHTML = html;
    }

    function updateSubmitButtonState() {
      const totalBytes = selectedFiles.reduce((acc, item) => acc + item.file.size, 0);
      submitBtn.disabled = !studentSelect.value || selectedFiles.length === 0 || totalBytes === 0;
    }

    async function loadPortalStatus() {
      try {
        const res = await fetch(window.location.pathname.replace(/\\/+$/, '') + '/status');
        const data = await res.json();
        if (!data.success) return;
        studentsData = data.students || [];
        const currentVal = studentSelect.value;

        studentSelect.innerHTML = '<option value="">-- Chọn Họ và Tên của con --</option>';
        for (const s of studentsData) {
          const opt = document.createElement('option');
          opt.value = s.studentId;
          const badge = s.hasSubmitted
            ? (s.driveStatus === 'UPLOADED' ? ' ✅ (Đã nộp & Đã lên Drive)' : ' ✅ (Đã nộp)')
            : '';
          opt.textContent = s.fullName + badge;
          studentSelect.appendChild(opt);
        }
        if (currentVal) {
          studentSelect.value = currentVal;
        }
      } catch (e) {}
    }

    studentSelect.addEventListener('change', () => {
      const stu = studentsData.find(s => s.studentId === studentSelect.value);
      if (stu) {
        if (!projectTitleInput.value.trim() || projectTitleInput.value.startsWith('SPCK ')) {
          projectTitleInput.value = stu.projectTitle || ('SPCK ' + stu.fullName);
        }
        if (stu.hasSubmitted) {
          studentStatusHint.innerHTML = '💡 Con đã nộp trước đó (' + stu.filesCount + ' file). Nếu nộp lại, hệ thống sẽ cập nhật bản mới nhất cho con.';
          studentStatusHint.style.color = '#34d399';
        } else {
          studentStatusHint.textContent = 'Đã chọn học viên: ' + stu.fullName;
          studentStatusHint.style.color = '#94a3b8';
        }
      }
      updateSubmitButtonState();
    });

    function addFilesFromInput(fileList) {
      const blockedFiles = [];
      const unsupportedArchives = [];
      for (const file of Array.from(fileList || [])) {
        const relPath = (file.webkitRelativePath || file.name || '').replace(/\\\\/g, '/');
        const parts = relPath.split('/').filter(Boolean);
        if (parts.length === 0) continue;
        const isDotOrIgnored = parts.some((p, idx) => {
          const lower = p.toLowerCase();
          const isFinalGitkeep = idx === parts.length - 1 && lower === '.gitkeep';
          if (p.startsWith('.') && !isFinalGitkeep) return true;
          if (IGNORED_DIRS.has(lower) || lower.startsWith('_spck_')) return true;
          return false;
        });
        if (isDotOrIgnored) {
          continue;
        }
        const lastSeg = parts[parts.length - 1];
        const dotIdx = lastSeg.lastIndexOf('.');
        const ext = dotIdx >= 0 ? lastSeg.slice(dotIdx).toLowerCase() : '';
        if (UNSUPPORTED_ARCHIVES.has(ext)) {
          unsupportedArchives.push(relPath);
          continue;
        }
        if (FORBIDDEN_EXTS.has(ext)) {
          blockedFiles.push(relPath);
          continue;
        }
        selectedFiles.push({ file, relativePath: relPath });
      }
      if (unsupportedArchives.length > 0) {
        showStatus(
          'error',
          '⚠️ Hệ thống không hỗ trợ định dạng nén <strong>' +
          escapeHtml(unsupportedArchives.slice(0, 3).join(', ')) +
          '</strong> — Con vui lòng nén dạng <strong>.zip</strong> hoặc bấm <strong>"Chọn Cả Thư Mục Dự Án"</strong> nhé!'
        );
      } else if (blockedFiles.length > 0) {
        showStatus(
          'error',
          '⚠️ Đã tự động chặn ' + blockedFiles.length + ' tệp thực thi không được phép nộp: <strong>' +
          escapeHtml(blockedFiles.slice(0, 3).join(', ')) + '</strong>'
        );
      }
      renderSelectedFiles();
    }

    function renderSelectedFiles() {
      if (selectedFiles.length === 0) {
        selectedSummary.style.display = 'none';
        updateSubmitButtonState();
        return;
      }
      selectedSummary.style.display = 'block';
      const totalBytes = selectedFiles.reduce((acc, item) => acc + item.file.size, 0);
      fileCountLabel.textContent = 'Đã chọn ' + selectedFiles.length + ' file (' + formatBytes(totalBytes) + ')';
      fileListBox.innerHTML = selectedFiles
        .slice(0, 80)
        .map(item => '<div class="file-item"><span>' + escapeHtml(item.relativePath) + '</span><span>' + formatBytes(item.file.size) + '</span></div>')
        .join('') + (selectedFiles.length > 80 ? '<div class="file-item"><span>... và ' + (selectedFiles.length - 80) + ' file khác</span></div>' : '');
      updateSubmitButtonState();
    }

    folderInput.addEventListener('change', (e) => {
      addFilesFromInput(e.target.files);
      folderInput.value = '';
    });

    filesInput.addEventListener('change', (e) => {
      addFilesFromInput(e.target.files);
      filesInput.value = '';
    });

    clearFilesBtn.addEventListener('click', () => {
      selectedFiles = [];
      renderSelectedFiles();
    });

    function readFileAsBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const str = String(reader.result || '');
          const base64 = str.includes(',') ? str.split(',').pop() : str;
          resolve(base64);
        };
        reader.onerror = () => reject(new Error('Không đọc được file: ' + file.name));
        reader.readAsDataURL(file);
      });
    }

    async function pollDriveStatusForStudent(studentId) {
      if (pollTimer) clearInterval(pollTimer);
      let pollAttempts = 0;
      pollTimer = setInterval(async () => {
        pollAttempts++;
        if (pollAttempts > 60) {
          clearInterval(pollTimer);
          pollTimer = null;
          return;
        }
        try {
          const res = await fetch(window.location.pathname.replace(/\\/+$/, '') + '/status');
          if (!res.ok) {
            clearInterval(pollTimer);
            pollTimer = null;
            return;
          }
          const data = await res.json();
          if (!data.success) return;
          const stu = (data.students || []).find(s => s.studentId === studentId);
          if (!stu) return;

          if (stu.driveStatus === 'UPLOADED' && stu.driveFolderUrl) {
            clearInterval(pollTimer);
            pollTimer = null;
            const safeDriveUrl = /^https:\/\/drive\.google\.com\//i.test(stu.driveFolderUrl) ? escapeHtml(stu.driveFolderUrl) : '#';
            showStatus(
              'success',
              '<strong>🎉 Nộp bài &amp; Đồng bộ Google Drive hoàn tất!</strong><br/>' +
              'Toàn bộ ' + Number(stu.filesCount || 0) + ' file sản phẩm của <strong>' + escapeHtml(stu.fullName) + '</strong> đã được lưu vào máy Thầy và tải lên Google Drive của lớp.<br/>' +
              '<a class="drive-btn" href="' + safeDriveUrl + '" target="_blank" rel="noreferrer">🔗 Mở Thư Mục Google Drive Của Con</a>'
            );
            loadPortalStatus();
          } else if (stu.driveStatus === 'FAILED') {
            clearInterval(pollTimer);
            pollTimer = null;
            showStatus(
              'warning',
              '<strong>✅ Đã lưu bài vào máy Thầy thành công (' + Number(stu.filesCount || 0) + ' file)!</strong><br/>' +
              'Lưu ý: Bước tự động đẩy lên Google Drive cần Thầy kiểm tra lại trên máy chủ (' + escapeHtml(stu.driveError || 'chưa đăng nhập Drive') + '). Bài của con đã an toàn trong máy của Thầy!'
            );
            loadPortalStatus();
          }
        } catch (e) {}
      }, 3000);
    }

    submitBtn.addEventListener('click', async () => {
      const studentId = studentSelect.value;
      if (!studentId || selectedFiles.length === 0) return;

      const selectedStudent = studentsData.find(s => s.studentId === studentId);
      if (selectedStudent && selectedStudent.hasSubmitted) {
        const ok = window.confirm(
          'Bạn "' + selectedStudent.fullName + '" đã nộp bài trước đó.\nCon có chắc chắn đây là bài mới của ' + selectedStudent.fullName + ' để cập nhật không?'
        );
        if (!ok) return;
      }

      submitBtn.disabled = true;
      progressWrap.style.display = 'block';
      progressBar.style.width = '10%';
      showStatus('warning', '⏳ Đang chuẩn bị và tải ' + selectedFiles.length + ' file lên hệ thống của Thầy...');

      try {
        const filesPayload = [];
        for (let i = 0; i < selectedFiles.length; i++) {
          const item = selectedFiles[i];
          const base64Data = await readFileAsBase64(item.file);
          filesPayload.push({
            relativePath: item.relativePath,
            base64Data
          });
          const pct = Math.min(65, Math.round(((i + 1) / selectedFiles.length) * 60) + 10);
          progressBar.style.width = pct + '%';
        }

        progressBar.style.width = '80%';
        const uploadUrl = window.location.pathname.replace(/\\/+$/, '') + '/upload';
        const res = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentId,
            projectTitle: projectTitleInput.value.trim(),
            youtubeUrl: youtubeUrlInput.value.trim(),
            presentationUrl: presentationUrlInput.value.trim(),
            files: filesPayload
          })
        });

        const data = await res.json();
        progressBar.style.width = '100%';

        if (!data.success) {
          showStatus('error', '❌ <strong>Lỗi khi nộp bài:</strong> ' + escapeHtml(data.error || 'Không thể tải bài lên.'));
          submitBtn.disabled = false;
          return;
        }

        const sub = data.submission;
        selectedFiles = [];
        renderSelectedFiles();
        await loadPortalStatus();

        if (sub.driveStatus === 'QUEUED' || sub.driveStatus === 'UPLOADING') {
          showStatus(
            'success',
            '<strong>✅ Đã nộp thành công ' + Number(sub.filesCount || 0) + ' file vào máy của Thầy!</strong><br/>' +
            '⏳ Hệ thống đang tự động tạo thư mục <strong>' + escapeHtml(sub.fullName) + '</strong> và tải sản phẩm lên Google Drive của lớp... Con chờ vài giây để nhận Link Drive nhé!'
          );
          pollDriveStatusForStudent(studentId);
        } else {
          showStatus(
            'success',
            '<strong>🎉 Chúc mừng ' + escapeHtml(sub.fullName) + ' đã nộp Sản phẩm cuối khóa thành công!</strong><br/>' +
            'Đã lưu ' + Number(sub.filesCount || 0) + ' file vào thư mục lớp trên máy Thầy.'
          );
        }
      } catch (err) {
        showStatus('error', '❌ <strong>Lỗi kết nối khi nộp bài:</strong> ' + escapeHtml(err.message || String(err)));
        submitBtn.disabled = false;
      }
    });

    loadPortalStatus();
  </script>
</body>
</html>`;
  }
}

const globalForStudentPortal = globalThis as unknown as {
  __mindxStudentPortalManager?: StudentPortalManager;
};

export const studentPortalManager: StudentPortalManager =
  globalForStudentPortal.__mindxStudentPortalManager ||
  (globalForStudentPortal.__mindxStudentPortalManager = new StudentPortalManager());
