/**
 * MINDX AUTOMATION BOT - GOOGLE DRIVE SPCK UPLOADER
 * Uploads each student's local SPCK project folder to Google Drive (creating Class folder -> Student folder),
 * retrieves the shareable Google Drive folder link, and automatically attaches it to `relatedLinksJson`
 * in SQLite so `SpckUploader` pushes the link into "Đường dẫn liên quan (Link)" on MindX LMS.
 */

import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import type { Page } from "playwright";
import {
  jobLogRepo,
  spckSessionRepo,
  spckUploadRepo,
  studentRepo,
  type SpckSessionNumber,
  type SpckUploadRecord,
} from "../db/sqlite";
import {
  computeStudentFolderContentDigest,
  MAX_SPCK_RELATED_LINKS,
  type SpckRelatedLink,
} from "../local-files/spck-scanner";
import { taskQueue } from "../queue/task-queue";
import { assertPathAllowed, isPathAllowed } from "../security/path-allowlist";
import { stripVietnameseDiacritics } from "../utils/vietnamese-match";
import { BrowserManager } from "./browser-manager";

export const DEFAULT_SPCK_DRIVE_FOLDER_URL =
  "https://drive.google.com/drive/folders/1Xl8OZ7i1bOKf7000xbUBYLPcxVb2qvRD";

export const CODING_SPCK_ROOT_FOLDER_ID = "1Xl8OZ7i1bOKf7000xbUBYLPcxVb2qvRD";

const MAX_DRIVE_TREE_DEPTH = 5;
const MAX_DRIVE_FILE_SIZE_BYTES = 150 * 1024 * 1024;

/**
 * Known course subfolders inside CODING - SPCK (1Xl8OZ7i1bOKf7000xbUBYLPcxVb2qvRD)
 */
export const CODING_SPCK_COURSE_FOLDER_MAP: Record<string, string> = {
  SB: "1eE1jxK8zapOyPoXQrp2ohTsusl6KjnRw",
  SA: "1Xw5vOnx9DahGAz6JpxXrI8P6GWK133Jf",
  SI: "19VhAyGVOSzQqxBLf-I2_zW2WMVaJo6G3",
  GB: "1FhX-OQvpBA0l8rOGUfrLLkvJRfKukyiK",
  GA: "1w3fuW9EFFnWZKm3-JagiSrAGUTO7z3ss",
  GI: "1Of7xLsPbxQ11m2ACwJpOCs0i8oR44JDH",
  GMB: "1FhX-OQvpBA0l8rOGUfrLLkvJRfKukyiK",
  GMA: "1w3fuW9EFFnWZKm3-JagiSrAGUTO7z3ss",
  GMI: "1Of7xLsPbxQ11m2ACwJpOCs0i8oR44JDH",
  PTB: "1Wl1NDkZi1oC7vk8x48c9thgFc2hyhaJQ",
  PTA: "1cGbHFR4WhEhp8p-mH1w9AxZGtY89Tzwe",
  PTI: "1nXdgx_aKh2xR7tG14xe25SX6sZtu_VRt",
  PSI: "1nXdgx_aKh2xR7tG14xe25SX6sZtu_VRt",
  JSB: "1XSEXfILQoIYql5Kv0jQaLPFuXr2cl_E7",
  JSA: "1jEyt4ouY_RmgKPTZDtlc74VnQu9l_Pd4",
  JSI: "19hn6Pl9XCgTgtje_0_Uap0-oJbDfbE7H",
  CSB: "1pPJLd2NLjF5j3MyR8uan5F_1BooUpRUq",
  CSA: "1mpmZ_7DQMR6NcvQJ6Mtp5OIbdmhtYpuh",
  CSI: "1LxUOSsLqXlLI5IHsedt6SZKuoT24-bsH",
};

const IGNORED_SUBFOLDER_NAMES = new Set([
  "__pycache__",
  "node_modules",
  ".git",
  ".next",
  ".venv",
  "venv",
  "env",
  "build",
  "dist",
  ".idea",
  ".vscode",
  "_spck_app_shots",
  "_spck_owner_uploads",
  "_spck_youtube_frames",
  "_spck_prev_backup",
  "_spck_temp",
  "_synth_assets",
  "_portal_backups",
]);

/**
 * Returns `true` when a subdirectory name belongs to Bot-generated caches/screenshots/staging
 * or local IDE/build/VCS metadata that must NEVER be uploaded to Google Drive.
 */
export function isBotOrSystemIgnoredDriveDir(dirName: string): boolean {
  const lower = String(dirName || "").trim().toLowerCase();
  if (!lower) return true;
  if (lower.startsWith(".")) return true;
  if (IGNORED_SUBFOLDER_NAMES.has(lower)) return true;
  return /^(?:_spck_|_portal_|\.spck_portal_)/i.test(lower);
}

/**
 * Returns `true` when a file name is a Bot-generated artifact (auto-captured screenshots,
 * auto-bundled ZIP/YYZ archives, temporary Demo sheets, portal markers) or OS/IDE junk.
 * Genuine student-created `.zip` files are intentionally preserved.
 */
export function isBotOrSystemIgnoredDriveFile(fileName: string): boolean {
  const lower = String(fileName || "").trim().toLowerCase();
  if (!lower) return true;
  if (lower.startsWith(".") || lower.startsWith("_spck_") || lower.startsWith("_portal_")) {
    return true;
  }
  if (
    lower === "links.txt" ||
    lower === "link.txt" ||
    lower === "desktop.ini" ||
    lower === "thumbs.db" ||
    lower === ".ds_store" ||
    lower === "portal_unconfirmed.json" ||
    lower === "default-spck-thumbnail.png"
  ) {
    return true;
  }
  if (
    lower.endsWith(".pyc") ||
    lower.endsWith(".pyo") ||
    lower.endsWith(".code-workspace") ||
    lower.endsWith(".tmp")
  ) {
    return true;
  }
  if (
    lower.endsWith("_web_package.zip") ||
    lower.endsWith("_app_package.zip") ||
    lower.endsWith("_robotics_package.zip") ||
    lower.endsWith("_gamemaker.yyz") ||
    /^spck_.*_[a-f0-9]{8}\.zip$/i.test(lower) ||
    /_spck_(?:b1[234]|spck)_\d{4}_\d{6}(?:_\d+)?\.zip$/i.test(lower)
  ) {
    return true;
  }
  if (
    /^app_\d+_.*_[a-f0-9]{6}(?:_[a-z0-9]+)?\.(?:png|jpe?g|webp)$/i.test(lower) ||
    /^owner_photo_[a-f0-9]{6,16}\.png$/i.test(lower) ||
    /^yt_frame_\d+.*\.(?:png|jpe?g|webp)$/i.test(lower)
  ) {
    return true;
  }
  if (/^(?:service[-_]?account.*|credentials?|secrets?)\.json$/i.test(lower)) {
    return true;
  }
  if (
    /^_staging_gsheet_.*\.xlsx$/i.test(lower) ||
    /^bảng chấm điểm buổi demo.*\.xlsx$/i.test(lower)
  ) {
    return true;
  }
  return false;
}

const ROBOTICS_COURSE_PREFIXES = new Set([
  "PREB",
  "PREA",
  "PREI",
  "ARMB",
  "ARMA",
  "ARMI",
  "SEMIB",
  "SEMIA",
  "SEMII",
  "ROB",
]);

export interface SpckDriveStudentResult {
  studentId: string;
  fullName: string;
  status: "SUCCESS" | "FAILED";
  driveFolderId?: string;
  driveFolderUrl?: string;
  uploadedFilesCount: number;
  zipFileName?: string;
  standaloneMediaCount?: number;
  errorMessage?: string;
}

export interface SpckDriveBatchResult {
  classId: string;
  parentDriveFolderUrl: string;
  classDriveFolderUrl?: string;
  totalRequested: number;
  successCount: number;
  failedCount: number;
  uploadedStudentsCount: number;
  failedStudentsCount: number;
  results: SpckDriveStudentResult[];
}

export type SpckDriveUploadMode = "zip_bundle" | "tree";

export interface SpckDriveUploadOptions {
  classId: string;
  driveFolderUrl?: string;
  studentIds?: string[];
  uploadMode?: SpckDriveUploadMode;
  sessionNumber?: SpckSessionNumber;
  syncAllUnverifiedSessions?: boolean;
  allowDemoteApprovedSession?: boolean;
}

function isEmergencyStopped(): boolean {
  return (
    taskQueue.getStatus().isStopped ||
    (process as any)?.__mindxQueueStopped === true
  );
}

function assertDriveNotStopped(): void {
  if (isEmergencyStopped()) {
    throw new Error("Đã dừng tác vụ Google Drive theo lệnh Dừng khẩn cấp (Stop Bot).");
  }
}

export function extractDriveFolderId(rawUrlOrId: string): string {
  const trimmed = String(rawUrlOrId || "").trim();
  if (!trimmed) return CODING_SPCK_ROOT_FOLDER_ID;
  const match = trimmed.match(/\/folders\/([a-zA-Z0-9_-]{15,60})/);
  if (match && match[1]) {
    return match[1];
  }
  if (/^[a-zA-Z0-9_-]{15,60}$/.test(trimmed)) {
    return trimmed;
  }
  throw new Error(
    `Đường dẫn thư mục Google Drive không hợp lệ: '${trimmed}'. Vui lòng dán link dạng https://drive.google.com/drive/folders/...`
  );
}

// v3.5.5 Owner decision: PTB and CSB do not have final exams/Demo and are exempt from SPCK & Drive auto-prep.
export const SPCK_EXEMPT_COURSES = new Set<string>(["PTB", "CSB"]);

export function isCourseExemptFromSpck(classIdOrPrefix: string): boolean {
  const raw = String(classIdOrPrefix || "").trim().toUpperCase();
  if (!raw) return false;
  if (SPCK_EXEMPT_COURSES.has(raw)) return true;
  const prefix = detectCoursePrefixFromClassId(raw);
  return Boolean(prefix && SPCK_EXEMPT_COURSES.has(prefix));
}

export function detectCoursePrefixFromClassId(classId: string): string | null {
  const upper = String(classId || "").toUpperCase();
  const prefixes = [
    "SEMII",
    "SEMIA",
    "SEMIB",
    "ARMI",
    "ARMA",
    "ARMB",
    "PREI",
    "PREA",
    "PREB",
    "PTB",
    "PTA",
    "PTI",
    "PSI",
    "JSB",
    "JSA",
    "JSI",
    "CSB",
    "CSA",
    "CSI",
    "ROB",
    "GMB",
    "GMA",
    "GMI",
    "SB",
    "SA",
    "SI",
    "GB",
    "GA",
    "GI",
  ];
  for (const prefix of prefixes) {
    const regex = new RegExp(`(?:^|[-_\\s])${prefix}(?:\\d|$|[-_\\s])`, "i");
    if (regex.test(upper)) {
      return prefix;
    }
  }
  return null;
}

export function isRoboticsCourseClassId(classId: string): boolean {
  const prefix = detectCoursePrefixFromClassId(classId);
  return Boolean(prefix && ROBOTICS_COURSE_PREFIXES.has(prefix));
}

export function resolveCourseSpecificFolderId(classId: string): string | null {
  const prefix = detectCoursePrefixFromClassId(classId);
  if (prefix && CODING_SPCK_COURSE_FOLDER_MAP[prefix]) {
    return CODING_SPCK_COURSE_FOLDER_MAP[prefix];
  }
  return null;
}

function normalizeFolderTitle(name: string): string {
  return stripVietnameseDiacritics(String(name || ""))
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseJsonArraySafe<T>(raw?: string | null): T[] {
  if (!raw || typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Prepares the list of direct files in a directory for upload to Google Drive (no synthetic .zip created).
 */
export function prepareStudentFilesForDriveUpload(
  localFolderPath: string,
  _studentId: string,
  fullName: string
): string[] {
  const safeFolder = assertPathAllowed(localFolderPath);
  if (!fs.existsSync(safeFolder) || !fs.statSync(safeFolder).isDirectory()) {
    throw new Error(`Thư mục SPCK của '${fullName}' không tồn tại: '${localFolderPath}'`);
  }

  const entries = fs
    .readdirSync(safeFolder, { withFileTypes: true })
    .filter((e) => !e.name.startsWith(".") && !e.name.toLowerCase().startsWith("_spck_"))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));

  const filesToUpload: string[] = [];

  for (const entry of entries) {
    if (isBotOrSystemIgnoredDriveFile(entry.name)) {
      continue;
    }
    const fullEntryPath = assertPathAllowed(path.join(safeFolder, entry.name));
    let st: fs.Stats;
    try {
      st = fs.lstatSync(fullEntryPath);
    } catch {
      continue;
    }
    if (st.isSymbolicLink() || !st.isFile()) continue;

    if (st.size > MAX_DRIVE_FILE_SIZE_BYTES) {
      throw new Error(
        `Tệp '${entry.name}' của '${fullName}' vượt quá giới hạn 150MB (${Math.round(
          st.size / (1024 * 1024)
        )}MB).`
      );
    }

    if (st.size > 0) {
      filesToUpload.push(fullEntryPath);
    }
  }

  return filesToUpload;
}

/**
 * Extracts child items (folders and files) strictly belonging to the current Google Drive folder (`parentFolderId`).
 * Ignores breadcrumb links, sidebar items, and ancestor folders.
 */
async function listDriveItemsOnPage(
  page: Page,
  parentFolderId?: string
): Promise<Array<{ id: string; name: string; isFolder: boolean }>> {
  const results = new Map<string, { id: string; name: string; isFolder: boolean }>();

  try {
    await page
      .evaluate("window.__name = window.__name || function(f){ return f; }")
      .catch(() => {});
    const domItems = await page.evaluate(async (expectedParentId) => {
      const mainEl = document.querySelector('[role="main"]');
      if (!mainEl) return [];

      const scrollable =
        (mainEl.querySelector('[role="grid"]')?.parentElement as HTMLElement | null) ||
        (mainEl as HTMLElement);
      const canScrollGrid = Boolean(
        scrollable &&
          typeof scrollable.scrollTop === "number" &&
          scrollable.clientHeight > 0 &&
          scrollable.scrollHeight > scrollable.clientHeight + 20
      );
      if (scrollable && typeof scrollable.scrollTop === "number") {
        scrollable.scrollTop = 0;
        scrollable.dispatchEvent(new Event("scroll", { bubbles: true }));
      }

      const collected = new Map<string, { id: string; name: string; isFolder: boolean }>();
      const stepPx =
        scrollable && scrollable.clientHeight > 0
          ? Math.max(250, Math.floor(scrollable.clientHeight * 0.8))
          : 250;
      let prevScrollTop = -1;

      for (let pass = 0; pass <= 15; pass++) {
        // Map exact label from inner `<div data-id="...">Name</div>` inside `[role="main"]`
        const exactLabelById = new Map<string, string>();
        const allMainDataIdEls = Array.from(mainEl.querySelectorAll("[data-id]"));
        for (const el of allMainDataIdEls) {
          const id = el.getAttribute("data-id") || "";
          if (!id || id.length < 15 || id === expectedParentId) continue;
          if (el.getAttribute("data-target") === "doc") continue;
          const txt = ((el as HTMLElement).innerText || "").trim();
          if (txt && !txt.includes("\n") && !txt.includes("\t")) {
            exactLabelById.set(id, txt);
          }
        }

        const rowNodes = Array.from(
          mainEl.querySelectorAll('[data-target="doc"][data-id]')
        );
        for (const el of rowNodes) {
          const id = el.getAttribute("data-id") || "";
          if (!id || id.length < 15 || id === "EBS5u" || id === expectedParentId) continue;

          const rawText = (el as HTMLElement).innerText || el.getAttribute("aria-label") || "";
          const tokens = rawText
            .split(/[\r\n\t]+/)
            .map((s) => s.trim())
            .filter(
              (s) =>
                s.length > 0 &&
                s !== "Shared folder" &&
                s !== "Thư mục được chia sẻ" &&
                s !== "Thư mục" &&
                s !== "Folder"
            );
          let firstLine = exactLabelById.get(id) || tokens[0] || "";
          if (firstLine && (firstLine.includes("…") || firstLine.endsWith("..."))) {
            const fullTip = (
              el.getAttribute("data-tooltip") ||
              el.getAttribute("title") ||
              ""
            ).trim();
            if (fullTip && !fullTip.includes("\n")) {
              firstLine = fullTip;
            }
          }

          const html = (el.innerHTML || "").toLowerCase();
          const dataType = (el.getAttribute("data-type") || "").toLowerCase();
          const ariaLabel = (el.getAttribute("aria-label") || "").toLowerCase();
          const knownFileExtRe =
            /\.(?:zip|rar|7z|tar|gz|py|ipynb|ui|qss|html?|css|js|mjs|ts|tsx|jsx|json|xml|csv|txt|md|sql|png|jpe?g|webp|gif|svg|bmp|ico|avif|mp4|webm|mov|avi|mkv|mp3|wav|ogg|m4a|pdf|pptx?|docx?|xlsx?|sb3|yyz|yyp|gml|gmx|apk|rbxl|exe)$/i;
          const isExplicitFolderLabel =
            dataType === "folder" ||
            ariaLabel.includes("google drive folder") ||
            ariaLabel.includes("thư mục google drive") ||
            ariaLabel.includes("thư mục được chia sẻ") ||
            ariaLabel.startsWith("thư mục ") ||
            /\bfolder\b/.test(ariaLabel);
          const hasExplicitFileLabel =
            dataType === "file" ||
            (!isExplicitFolderLabel && knownFileExtRe.test(firstLine)) ||
            ariaLabel.includes("tệp") ||
            ariaLabel.includes("file") ||
            ariaLabel.includes("compressed archive") ||
            ariaLabel.includes("kho lưu trữ") ||
            ariaLabel.includes("zip");
          const isFolder =
            !hasExplicitFileLabel &&
            (isExplicitFolderLabel ||
              html.includes("folder") ||
              rawText.includes("Shared folder") ||
              rawText.includes("Thư mục") ||
              ariaLabel.includes("thư mục") ||
              (rawText.includes("—") && !/\.[a-z0-9]{1,8}$/i.test(firstLine)));
          if (firstLine && !collected.has(id)) {
            collected.set(id, { id, name: firstLine, isFolder });
          }
        }

        if (
          !canScrollGrid ||
          !scrollable ||
          pass === 15 ||
          scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight - 4 ||
          scrollable.scrollTop === prevScrollTop
        ) {
          break;
        }
        prevScrollTop = scrollable.scrollTop;
        scrollable.scrollTop = Math.min(
          scrollable.scrollHeight,
          scrollable.scrollTop + stepPx
        );
        scrollable.dispatchEvent(new Event("scroll", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 80));
      }

      if (canScrollGrid && scrollable) {
        scrollable.scrollTop = 0;
        scrollable.dispatchEvent(new Event("scroll", { bubbles: true }));
      }

      return Array.from(collected.values());
    }, parentFolderId || "");
    for (const item of domItems) {
      results.set(item.id, item);
    }
  } catch {
    // Ignore evaluation errors
  }

  return Array.from(results.values());
}

function isExactDriveFolderUrl(currentUrl: string, folderId: string): boolean {
  const m = String(currentUrl || "").match(/\/folders\/([^/?#]+)/i);
  return Boolean(m && m[1] === folderId);
}

/**
 * Ensures the Playwright browser is on the exact target Google Drive folder (`folderId`)
 * and logged into a Google account with edit permission (`+ Mới` / `+ New` button visible).
 */
async function ensureGoogleDriveFolderReadyAndAuthenticated(
  page: Page,
  folderId: string
): Promise<void> {
  assertDriveNotStopped();
  const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
  if (!isExactDriveFolderUrl(page.url(), folderId)) {
    await page.goto(folderUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
  }

  const newBtnSelector =
    'button[guidedhelpid="new_menu_button"], button[aria-label="Mới"], button[aria-label="New"]';
  const newBtn = page.locator(newBtnSelector).first();

  if (
    isExactDriveFolderUrl(page.url(), folderId) &&
    (await newBtn.isVisible().catch(() => false))
  ) {
    return;
  }

  // Check if user needs to sign into Google
  const signInLink = page
    .locator(
      'a[href*="ServiceLogin"], a:has-text("Đăng nhập"), a:has-text("Sign in"), button:has-text("Đăng nhập"), button:has-text("Sign in")'
    )
    .first();

  if (await signInLink.isVisible().catch(() => false)) {
    await page.bringToFront().catch(() => {});
    await signInLink.click().catch(() => {});
  } else if (!page.url().includes("accounts.google.com")) {
    await page.bringToFront().catch(() => {});
  }

  // Poll up to 180 seconds for the teacher to complete Google Sign-In once in the visible browser window
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    assertDriveNotStopped();

    const currentUrl = page.url();
    if (
      currentUrl.includes("drive.google.com/drive/") &&
      isExactDriveFolderUrl(currentUrl, folderId) &&
      (await newBtn.isVisible().catch(() => false))
    ) {
      return;
    }

    // If user finished sign-in and landed on My Drive or a different folder instead of `folderId`, redirect back to `folderUrl`
    if (
      currentUrl.includes("drive.google.com/drive/") &&
      !isExactDriveFolderUrl(currentUrl, folderId) &&
      (await newBtn.isVisible().catch(() => false))
    ) {
      await page.goto(folderUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2000);
      if (
        isExactDriveFolderUrl(page.url(), folderId) &&
        (await newBtn.isVisible().catch(() => false))
      ) {
        return;
      }
    }

    await page.waitForTimeout(1500);
  }

  throw new Error(
    "Chưa phát hiện quyền tạo thư mục trên Google Drive (nút '+ Mới' chưa xuất hiện tại đúng thư mục đích). Vui lòng đăng nhập tài khoản Google có quyền chỉnh sửa thư mục SPCK trên cửa sổ trình duyệt của Bot rồi bấm chạy lại."
  );
}

/**
 * Scrolls the Google Drive `[role="main"]` virtualized list until a target `[data-id]` row is mounted in the DOM.
 */
async function scrollDriveItemIntoDom(page: Page, itemId: string): Promise<void> {
  try {
    await page
      .evaluate("window.__name = window.__name || function(f){ return f; }")
      .catch(() => {});
    await page.evaluate(async (targetId) => {
      const mainEl = document.querySelector('[role="main"]');
      if (!mainEl) return;
      const targetSel = `[data-target="doc"][data-id="${targetId}"]`;
      if (mainEl.querySelector(targetSel)) return;

      const scrollable =
        (mainEl.querySelector('[role="grid"]')?.parentElement as HTMLElement | null) ||
        (mainEl as HTMLElement);
      if (!scrollable || typeof scrollable.scrollTop !== "number") return;
      if (scrollable.scrollHeight <= scrollable.clientHeight + 20) return;

      const stepPx = Math.max(200, Math.floor(scrollable.clientHeight * 0.75));
      scrollable.scrollTop = 0;
      scrollable.dispatchEvent(new Event("scroll", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 60));
      if (mainEl.querySelector(targetSel)) return;

      let steps = 0;
      let prevScrollTop = -1;
      while (
        steps < 25 &&
        scrollable.scrollTop + scrollable.clientHeight < scrollable.scrollHeight - 4 &&
        scrollable.scrollTop !== prevScrollTop
      ) {
        steps += 1;
        prevScrollTop = scrollable.scrollTop;
        scrollable.scrollTop = Math.min(
          scrollable.scrollHeight,
          scrollable.scrollTop + stepPx
        );
        scrollable.dispatchEvent(new Event("scroll", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 80));
        if (mainEl.querySelector(targetSel)) return;
      }
    }, itemId);
  } catch {
    // Ignore evaluation errors
  }
}

/**
 * Dismisses/confirms Google Drive's Shared-Folder trash confirmation modal
 * ("Chuyển vào thùng rác?" / "Move to trash?") if it appears after deleting an item.
 */
export async function confirmDriveTrashDialogIfPresent(page: Page): Promise<boolean> {
  await page.waitForTimeout(350);
  const confirmTrashBtn = page
    .locator(
      '[role="dialog"] button:has-text("Chuyển vào thùng rác"):visible, [role="dialog"] button:has-text("Đưa vào thùng rác"):visible, [role="dialog"] button:has-text("Move to trash"):visible, [role="dialog"] button:has-text("Move to bin"):visible, [role="dialog"] button:has-text("Delete forever"):visible, [role="dialog"] button:has-text("Xóa"):visible, [role="alertdialog"] button:has-text("Chuyển vào thùng rác"):visible, [role="alertdialog"] button:has-text("Move to trash"):visible'
    )
    .first();
  if (await confirmTrashBtn.isVisible().catch(() => false)) {
    await confirmTrashBtn.click().catch(() => {});
    await page.waitForTimeout(500);
    return true;
  }
  return false;
}

/**
 * Safely opens Google Drive's "+ Mới" / "+ New" menu and returns the visible target menuitem.
 * Handles the real-world Drive bug where `+ Mới` already has `aria-expanded="true"` and an open
 * `<li role="menuitem">` subtree intercepts pointer clicks on `button[guidedhelpid="new_menu_button"]`.
 * Compatible with minimal Playwright mock locators used in regression unit tests.
 */
export async function openDriveNewMenuAndGetItem(
  page: Page,
  menuItemSelector: string
): Promise<{ menuItem: ReturnType<Page["locator"]>; openedDirectlyFromMenu: boolean }> {
  const rawMenuItem = page.locator(menuItemSelector);
  const menuItem =
    typeof (rawMenuItem as any).first === "function" ? rawMenuItem.first() : rawMenuItem;

  // Case 1: "+ Mới" menu is already open (`aria-expanded="true"`) with our target menuitem visible.
  // Do NOT click `newBtn` again (which would hit pointer interception on `<li role="menuitem">`).
  if (await menuItem.isVisible().catch(() => false)) {
    return { menuItem, openedDirectlyFromMenu: true };
  }

  // Case 2: Another leftover menu (e.g. row context menu) is open — close it first.
  const anyVisibleMenu = page.locator('[role="menu"]:visible, [role="menuitem"]:visible');
  const anyMenuFirst =
    typeof (anyVisibleMenu as any).first === "function"
      ? anyVisibleMenu.first()
      : anyVisibleMenu;
  if (await anyMenuFirst.isVisible().catch(() => false)) {
    await page.keyboard?.press("Escape").catch(() => {});
    await page.waitForTimeout(250);
  }

  const rawNewBtn = page.locator(
    'button[guidedhelpid="new_menu_button"]:visible, button[aria-label="Mới"]:visible, button[aria-label="New"]:visible, [guidedhelpid="new_menu_button"]:visible'
  );
  const newBtn =
    typeof (rawNewBtn as any).first === "function" ? rawNewBtn.first() : rawNewBtn;

  const tryClickNewBtn = async () => {
    try {
      await (newBtn as any).click({ timeout: 5000 });
    } catch {
      if (await menuItem.isVisible().catch(() => false)) {
        return;
      }
      await page.keyboard?.press("Escape").catch(() => {});
      await page.waitForTimeout(250);
      if (await menuItem.isVisible().catch(() => false)) {
        return;
      }
      try {
        await (newBtn as any).click({ timeout: 5000 });
      } catch {
        if (typeof (newBtn as any).evaluate === "function") {
          await (newBtn as any)
            .evaluate((el: unknown) => (el as HTMLElement | null)?.click())
            .catch(() => {});
        }
      }
    }
  };

  await tryClickNewBtn();
  await page.waitForTimeout(450);

  if (!(await menuItem.isVisible().catch(() => false))) {
    await page.keyboard?.press("Escape").catch(() => {});
    await page.waitForTimeout(250);
    await tryClickNewBtn();
    await page.waitForTimeout(450);
  }

  try {
    await menuItem.waitFor({ state: "visible", timeout: 8000 });
  } catch (waitErr) {
    // One last recovery attempt in case Google Drive closed the menu on focus change
    await page.keyboard?.press("Escape").catch(() => {});
    await page.waitForTimeout(250);
    await tryClickNewBtn();
    await menuItem.waitFor({ state: "visible", timeout: 8000 }).catch(() => {
      throw waitErr;
    });
  }

  return { menuItem, openedDirectlyFromMenu: false };
}

/**
 * Moves an existing file item in the currently open Google Drive folder to trash so an updated local version can replace it cleanly.
 */
async function moveDriveItemToTrash(page: Page, itemId: string): Promise<void> {
  await scrollDriveItemIntoDom(page, itemId);
  const row = page
    .locator(`[role="main"] [data-target="doc"][data-id="${itemId}"]`)
    .first();
  if (typeof (row as any).scrollIntoViewIfNeeded === "function") {
    await row.scrollIntoViewIfNeeded().catch(() => {});
  }
  if (!(await row.isVisible().catch(() => false))) return;

  await row.click({ button: "right" }).catch(() => {});
  await page.waitForTimeout(350);
  const trashMenuItem = page
    .locator(
      '[role="menuitem"]:has-text("Chuyển vào thùng rác"):visible, [role="menuitem"]:has-text("Đưa vào thùng rác"):visible, [role="menuitem"]:has-text("Move to trash"):visible, [role="menuitem"]:has-text("Move to bin"):visible, [role="menuitem"]:has-text("Xóa"):visible, [role="menuitem"]:has-text("Remove"):visible'
    )
    .first();
  if (await trashMenuItem.isVisible().catch(() => false)) {
    await trashMenuItem.click().catch(() => {});
    await confirmDriveTrashDialogIfPresent(page);
    await page.waitForTimeout(550);
  } else {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(150);
    await row.click().catch(() => {});
    await page.waitForTimeout(150);
    await page.keyboard.press("Delete").catch(() => {});
    await confirmDriveTrashDialogIfPresent(page);
    await page.waitForTimeout(450);
  }
}

/**
 * Finds an existing subfolder by name inside `parentFolderId`, or creates it on Google Drive and returns its `folderId`.
 */
async function findOrCreateDriveSubfolder(
  page: Page,
  parentFolderId: string,
  targetFolderName: string
): Promise<string> {
  assertDriveNotStopped();
  await ensureGoogleDriveFolderReadyAndAuthenticated(page, parentFolderId);

  const existingItems = await listDriveItemsOnPage(page, parentFolderId);
  const normTarget = normalizeFolderTitle(targetFolderName);

  const matchingExisting = existingItems.filter(
    (item) => item.isFolder && normalizeFolderTitle(item.name) === normTarget
  );
  if (matchingExisting.length === 1) {
    return matchingExisting[0].id;
  }
  if (matchingExisting.length > 1) {
    let bestId = matchingExisting[0].id;
    let bestCount = -1;
    for (const cand of matchingExisting) {
      assertDriveNotStopped();
      await ensureGoogleDriveFolderReadyAndAuthenticated(page, cand.id);
      const children = await listDriveItemsOnPage(page, cand.id);
      if (children.length > bestCount) {
        bestCount = children.length;
        bestId = cand.id;
      }
    }
    return bestId;
  }

  // Dismiss any leftover modal dialog ("Thư mục mới" / "New folder") before opening "+ Mới"
  const newFolderModalLocator = page
    .locator('[role="dialog"]')
    .filter({ hasText: /Thư mục mới|New folder/i });
  if ((await newFolderModalLocator.count()) > 0) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(400);
  }

  // Safely open "+ Mới" / "+ New" -> "Thư mục mới" / "New folder" (or fall back to Shift+F shortcut)
  const newFolderMenuSelector =
    '[role="menuitem"]:has-text("Thư mục mới"):visible, [role="menuitem"]:has-text("New folder"):visible';
  try {
    const { menuItem: newFolderMenuItem } = await openDriveNewMenuAndGetItem(
      page,
      newFolderMenuSelector
    );
    await newFolderMenuItem.click();
  } catch {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(200);
    await page.keyboard.press("Shift+F");
  }

  const activeNewFolderDialog = page
    .locator('[role="dialog"]')
    .filter({ hasText: /Thư mục mới|New folder/i })
    .last();
  await activeNewFolderDialog.waitFor({ state: "visible", timeout: 10000 });

  const dialogInput = activeNewFolderDialog.locator('input[type="text"]').first();
  await dialogInput.waitFor({ state: "visible", timeout: 8000 });
  await dialogInput.click().catch(() => {});
  await dialogInput.fill(targetFolderName);
  await page.waitForTimeout(250);

  const createBtn = activeNewFolderDialog
    .locator(
      'button:has-text("Tạo"), button:has-text("Create"), button[data-id="EBS5u"]'
    )
    .last();
  if (await createBtn.isVisible().catch(() => false)) {
    await createBtn.click();
  } else {
    await dialogInput.press("Enter");
  }

  // Poll up to 15 seconds strictly for the newly created folder matching `targetFolderName` inside `parentFolderId`
  const pollDeadline = Date.now() + 15_000;
  while (Date.now() < pollDeadline) {
    assertDriveNotStopped();
    await page.waitForTimeout(900);
    const afterItems = await listDriveItemsOnPage(page, parentFolderId);
    const byName = afterItems.find(
      (item) =>
        item.id !== parentFolderId &&
        item.isFolder &&
        normalizeFolderTitle(item.name) === normTarget
    );
    if (byName) {
      return byName.id;
    }
  }

  // Reload once if Google Drive UI didn't refresh DOM data-id immediately
  await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const reloadedItems = await listDriveItemsOnPage(page, parentFolderId);
  const afterReload = reloadedItems.find(
    (item) =>
      item.id !== parentFolderId &&
      item.isFolder &&
      normalizeFolderTitle(item.name) === normTarget
  );
  if (afterReload) {
    return afterReload.id;
  }

  throw new Error(
    `Không thể xác nhận thư mục '${targetFolderName}' sau khi tạo trên Google Drive.`
  );
}

const DRIVE_UPLOAD_ERROR_SELECTOR =
  '[aria-label*="Tải lên không thành công"]:visible, [aria-label*="Upload failed"]:visible, [role="alert"]:has-text("Tải lên không thành công"):visible, [role="alert"]:has-text("Upload failed"):visible';

const DRIVE_UPLOAD_PROGRESS_SELECTOR =
  '[role="progressbar"]:visible, [aria-label*="Đang tải lên"]:visible, [aria-label*="Uploading"]:visible';

const DRIVE_ACTIVE_DIALOG_SELECTOR = '[role="dialog"]:visible';

const DRIVE_INDICATOR_REGEX_SOURCES = {
  // Active upload state: exclude filename extensions like `uploading.py` via negative lookahead
  activeUpload:
    "(?:đang tải(?:\\s+\\d+\\s*(?:mục|tệp|thư mục|lần)?)?\\s+lên|đang tải lên|đang bắt đầu(?:\\s+tải)?|đang chuẩn bị(?:\\s+tải)?|đang xử lý|đang hoàn tất(?:\\s+quá trình)?|starting upload|preparing upload|finishing upload|(?:^|[\\s:])uploading(?!\\.[a-z0-9]{1,8}\\b)(?:\\s+\\d+|\\s+item|\\s+file|\\.\\.\\.|\\s*$)|còn\\s+\\d+\\s*(?:giây|phút|giờ)|còn chưa đầy|seconds?\\s+left|minutes?\\s+left|hours?\\s+left|less than a minute)",
  completedUpload:
    "(?:đã hoàn tất.*tải lên|hoàn tất.*tải lên|tải lên hoàn tất|tải lên xong|đã tải xong|đã tải(?:\\s+\\d+\\s*(?:mục|tệp|thư mục|lần)?)?\\s+lên|đã tải lên(?:\\s+\\d+|\\s+xong)?|\\b\\d+\\s*(?:mục|tệp|thư mục|lần)\\s+đã\\s+(?:được\\s+)?tải\\s+lên|uploads?\\s+complete|upload\\s+complete|upload\\s+finished|uploaded\\s+\\d+|\\b\\d+\\s+(?:items?|files?|uploads?)\\s+(?:uploaded|complete))",
  failedUpload: "(?:tải lên không thành công|upload failed)",
  cancelButton:
    "(?:hủy tải|huỷ tải|hủy tất cả|huỷ tất cả|cancel upload|cancel all|^(?:hủy|huỷ|cancel)$)",
  duplicateOption:
    "(?:tùy chọn tải lên|upload options|thay thế tệp|replace existing|update existing|cập nhật tệp|giữ cả hai|keep both|keep separate|giữ tất cả)",
  storageQuota:
    "(?:bộ nhớ|storage|get more storage|mua thêm bộ nhớ|đã sử dụng\\s+[\\d.,]+\\s*(?:bytes?|b|kb|mb|gb|tb)|trong tổng số\\s+[\\d.,]+\\s*(?:bytes?|b|kb|mb|gb|tb)|[\\d.,]+\\s*(?:bytes?|b|kb|mb|gb|tb)\\s+(?:đã dùng|đã sử dụng|used)|\\bof\\s+[\\d.,]+\\s*(?:bytes?|b|kb|mb|gb|tb)\\s*used\\b|\\bof\\s+\\d+(?:[.,]\\d+)?\\s*(?:gb|tb|mb)\\b)",
  promoCallout:
    "(?:đã hiểu|got it|không phải bây giờ|not now|để sau|maybe later|bỏ qua|dismiss|tìm hiểu thêm|learn more|dùng thử gemini|try gemini|ask gemini|hỏi gemini|chế độ ngoại tuyến|offline|bật thông báo|desktop notifications|drive cho máy tính|drive for desktop|có gì mới|what's new)",
  modalActionGuard:
    "(?:tải lên|upload|thay thế|replace|giữ cả hai|keep both|thư mục mới|new folder|đổi tên|rename|thùng rác|trash)",
};

/**
 * Checks whether ANY visible element matches `selector` (which already filters by `:visible`),
 * safely handling 0, 1, or multiple simultaneous elements without Playwright strict-mode errors.
 * Fails closed (`inspectionFailed: true`) if locator inspection throws for any reason.
 */
async function hasAnyVisibleDriveElement(
  page: Page,
  selector: string
): Promise<{ visible: boolean; inspectionFailed: boolean }> {
  try {
    const rawLoc = page.locator(selector);
    const firstLoc = typeof rawLoc.first === "function" ? rawLoc.first() : rawLoc;
    const visible = Boolean(await firstLoc.isVisible());
    return { visible, inspectionFailed: false };
  } catch {
    return { visible: false, inspectionFailed: true };
  }
}

/**
 * Filters `[role="progressbar"]` candidates in real Chromium DOM so Google Drive's persistent
 * left-sidebar Storage quota bar, opacity:0/aria-hidden loaders, 100% completed bars, and bars
 * inside completed bottom-right upload trays do not cause false 45s upload timeouts.
 * Falls back to `true` (fail-closed) if `evaluateAll` is unavailable on lightweight unit-test mocks
 * or throws at runtime.
 */
async function hasActiveDriveUploadProgress(page: Page): Promise<boolean> {
  const loc = page.locator(DRIVE_UPLOAD_PROGRESS_SELECTOR);
  if (typeof (loc as any).evaluateAll !== "function") {
    return true;
  }
  try {
    const active = await (loc as any).evaluateAll(
      (els: Element[], rxSrc: typeof DRIVE_INDICATOR_REGEX_SOURCES) => {
        const activeRe = new RegExp(rxSrc.activeUpload, "i");
        const completedRe = new RegExp(rxSrc.completedUpload, "i");
        const cancelRe = new RegExp(rxSrc.cancelButton, "i");
        const quotaRe = new RegExp(rxSrc.storageQuota, "i");

        for (let i = 0; i < els.length; i++) {
          const el = els[i] as HTMLElement | null;
          if (!el || !el.isConnected) continue;

          const rect = el.getBoundingClientRect();
          if (rect.width < 2 || rect.height < 2) continue;

          let hiddenOrZeroOpacity = false;
          let walk: HTMLElement | null = el;
          while (walk && walk !== document.body) {
            if (
              walk.hasAttribute("hidden") ||
              walk.getAttribute("aria-hidden") === "true"
            ) {
              hiddenOrZeroOpacity = true;
              break;
            }
            const cs = window.getComputedStyle(walk);
            if (
              cs.display === "none" ||
              cs.visibility === "hidden" ||
              parseFloat(cs.opacity || "1") === 0
            ) {
              hiddenOrZeroOpacity = true;
              break;
            }
            walk = walk.parentElement;
          }
          if (hiddenOrZeroOpacity) continue;

          if (
            el.closest(
              'nav, [role="navigation"], [role="complementary"], [data-target="sidebar"], aside, header, [guidedhelpid*="storage" i], a[href*="quota"], a[href*="storage"], [aria-label*="Bộ nhớ" i], [aria-label*="Storage" i]'
            )
          ) {
            continue;
          }

          const elLabel = (el.getAttribute("aria-label") || "").trim();
          if (el.closest('[role="main"] [data-id]')) {
            continue;
          }
          if ((el.getAttribute("role") || "").toLowerCase() !== "progressbar") {
            if (!activeRe.test(elLabel) || completedRe.test(elLabel)) {
              continue;
            }
          }
          const insideDialog = el.closest('[role="dialog"]') as HTMLElement | null;

          if (!insideDialog) {
            let isSidebarQuotaBar = quotaRe.test(elLabel);
            let qWalk: HTMLElement | null = el.parentElement;
            let depth = 0;
            while (
              qWalk &&
              qWalk !== document.body &&
              !isSidebarQuotaBar &&
              depth < 10
            ) {
              const qRole = (qWalk.getAttribute("role") || "").toLowerCase();
              if (qRole === "main" || qRole === "dialog") break;
              const qAria = qWalk.getAttribute("aria-label") || "";
              const qText = (qWalk.innerText || "").trim();
              const qCombined = (qAria + " " + qText).replace(/\s+/g, " ").trim();
              if (qCombined.length > 0 && qCombined.length < 800 && quotaRe.test(qCombined)) {
                isSidebarQuotaBar = true;
                break;
              }
              qWalk = qWalk.parentElement;
              depth += 1;
            }
            if (isSidebarQuotaBar) continue;
          }

          const rawNow = el.getAttribute("aria-valuenow");
          const rawMax = el.getAttribute("aria-valuemax");
          if (rawNow !== null && rawNow !== "" && rawMax !== null && rawMax !== "") {
            const nowNum = Number(rawNow);
            const maxNum = Number(rawMax);
            if (Number.isFinite(nowNum) && Number.isFinite(maxNum) && maxNum > 0 && nowNum >= maxNum) {
              continue;
            }
          }

          if (insideDialog) {
            const dlgText = (
              (insideDialog.getAttribute("aria-label") || "") +
              " " +
              (insideDialog.innerText || insideDialog.textContent || "")
            )
              .replace(/\s+/g, " ")
              .trim();

            let dlgHasCancel = false;
            const btns = insideDialog.querySelectorAll('button, [role="button"]');
            for (let b = 0; b < btns.length; b++) {
              const btn = btns[b] as HTMLElement;
              const br = btn.getBoundingClientRect();
              if (br.width < 2 || br.height < 2) continue;
              const bcs = window.getComputedStyle(btn);
              if (
                bcs.display === "none" ||
                bcs.visibility === "hidden" ||
                parseFloat(bcs.opacity || "1") === 0
              ) {
                continue;
              }
              const bLabel = (
                (btn.getAttribute("aria-label") || "") +
                " " +
                (btn.getAttribute("title") || "") +
                " " +
                (btn.innerText || btn.textContent || "")
              )
                .replace(/\s+/g, " ")
                .trim();
              if (bLabel && cancelRe.test(bLabel)) {
                dlgHasCancel = true;
                break;
              }
            }

            if (completedRe.test(dlgText) && !activeRe.test(dlgText) && !dlgHasCancel) {
              continue;
            }
          }

          return true;
        }

        return false;
      },
      DRIVE_INDICATOR_REGEX_SOURCES
    );
    return Boolean(active);
  } catch {
    return true;
  }
}

/**
 * Classifies visible `[role="dialog"]` elements in real Chromium DOM so finished bottom-right
 * upload trays ("Đã hoàn tất 1 lần tải lên" / "1 upload complete") and non-modal promo callouts
 * do not stall uploads, while overwrite/duplicate dialogs and active upload trays remain blocking.
 * Falls back to `true` (fail-closed) for mock locators or evaluation errors.
 */
async function hasBlockingDriveDialog(page: Page): Promise<boolean> {
  const loc = page.locator(DRIVE_ACTIVE_DIALOG_SELECTOR);
  if (typeof (loc as any).evaluateAll !== "function") {
    return true;
  }
  try {
    const blocking = await (loc as any).evaluateAll(
      (dialogs: Element[], rxSrc: typeof DRIVE_INDICATOR_REGEX_SOURCES) => {
        const dupRe = new RegExp(rxSrc.duplicateOption, "i");
        const failedRe = new RegExp(rxSrc.failedUpload, "i");
        const activeRe = new RegExp(rxSrc.activeUpload, "i");
        const completedRe = new RegExp(rxSrc.completedUpload, "i");
        const cancelRe = new RegExp(rxSrc.cancelButton, "i");
        const promoRe = new RegExp(rxSrc.promoCallout, "i");
        const actionGuardRe = new RegExp(rxSrc.modalActionGuard, "i");

        for (let i = 0; i < dialogs.length; i++) {
          const dlg = dialogs[i] as HTMLElement | null;
          if (!dlg || !dlg.isConnected) continue;

          const rect = dlg.getBoundingClientRect();
          if (rect.width < 4 || rect.height < 4) continue;

          let hiddenOrZeroOpacity = false;
          let walk: HTMLElement | null = dlg;
          while (walk && walk !== document.body) {
            if (
              walk.hasAttribute("hidden") ||
              walk.getAttribute("aria-hidden") === "true"
            ) {
              hiddenOrZeroOpacity = true;
              break;
            }
            const cs = window.getComputedStyle(walk);
            if (
              cs.display === "none" ||
              cs.visibility === "hidden" ||
              parseFloat(cs.opacity || "1") === 0
            ) {
              hiddenOrZeroOpacity = true;
              break;
            }
            walk = walk.parentElement;
          }
          if (hiddenOrZeroOpacity) continue;

          const combined = (
            (dlg.getAttribute("aria-label") || "") +
            " " +
            (dlg.getAttribute("data-tooltip") || "") +
            " " +
            (dlg.innerText || dlg.textContent || "")
          )
            .replace(/\s+/g, " ")
            .trim();

          // Priority 1: Duplicate/overwrite resolution dialog or failure tray must always block completion
          if (dupRe.test(combined) || failedRe.test(combined)) {
            return true;
          }

          // Priority 2: Upload manager tray in bottom-right corner
          const hasActiveText = activeRe.test(combined);
          const isCompletedTrayText = completedRe.test(combined);

          let hasCancelBtn = false;
          const btns = dlg.querySelectorAll('button, [role="button"]');
          for (let b = 0; b < btns.length; b++) {
            const btn = btns[b] as HTMLElement;
            const br = btn.getBoundingClientRect();
            if (br.width < 2 || br.height < 2) continue;
            const bcs = window.getComputedStyle(btn);
            if (
              bcs.display === "none" ||
              bcs.visibility === "hidden" ||
              parseFloat(bcs.opacity || "1") === 0
            ) {
              continue;
            }
            const bLabel = (
              (btn.getAttribute("aria-label") || "") +
              " " +
              (btn.getAttribute("title") || "") +
              " " +
              (btn.innerText || btn.textContent || "")
            )
              .replace(/\s+/g, " ")
              .trim();
            if (bLabel && cancelRe.test(bLabel)) {
              hasCancelBtn = true;
              break;
            }
          }

          let hasUnfinishedBar = false;
          const bars = dlg.querySelectorAll('[role="progressbar"]');
          for (let p = 0; p < bars.length; p++) {
            const bar = bars[p] as HTMLElement;
            const pr = bar.getBoundingClientRect();
            if (pr.width < 2 || pr.height < 2) continue;
            const pcs = window.getComputedStyle(bar);
            if (
              pcs.display === "none" ||
              pcs.visibility === "hidden" ||
              parseFloat(pcs.opacity || "1") === 0
            ) {
              continue;
            }
            const rawNow = bar.getAttribute("aria-valuenow");
            const rawMax = bar.getAttribute("aria-valuemax");
            const isComplete100 =
              rawNow !== null &&
              rawNow !== "" &&
              rawMax !== null &&
              rawMax !== "" &&
              Number.isFinite(Number(rawNow)) &&
              Number.isFinite(Number(rawMax)) &&
              Number(rawMax) > 0 &&
              Number(rawNow) >= Number(rawMax);
            if (!isComplete100 && !isCompletedTrayText) {
              hasUnfinishedBar = true;
              break;
            }
          }

          if (hasActiveText || hasCancelBtn || hasUnfinishedBar) {
            return true;
          }
          if (isCompletedTrayText) {
            continue;
          }

          // Priority 3: Skip non-modal Drive feature tips / promo callouts / non-upload side panels
          const isModal = dlg.getAttribute("aria-modal") === "true";
          const hasGuidedHelp =
            dlg.hasAttribute("guidedhelpid") || dlg.querySelector("[guidedhelpid]") !== null;
          if (
            !isModal &&
            (hasGuidedHelp || !actionGuardRe.test(combined) || promoRe.test(combined))
          ) {
            continue;
          }

          // Fail-closed for any modal or upload/action-related visible dialog
          return true;
        }

        return false;
      },
      DRIVE_INDICATOR_REGEX_SOURCES
    );
    return Boolean(blocking);
  } catch {
    return true;
  }
}

/**
 * Clicks the close ("Đóng" / "Close") button on any idle bottom-right Google Drive upload tray
 * so it neither obscures lower file rows nor leaves stale failure trays from an earlier student.
 */
export async function dismissIdleDriveUploadTray(
  page: Page,
  includeFailedIdleTray = false
): Promise<void> {
  try {
    const loc = page.locator(DRIVE_ACTIVE_DIALOG_SELECTOR);
    if (typeof (loc as any).evaluateAll !== "function") {
      return;
    }
    const clickedCount = await (loc as any).evaluateAll(
      (
        dialogs: Element[],
        arg: { rx: typeof DRIVE_INDICATOR_REGEX_SOURCES; includeFailed: boolean }
      ) => {
        const dupRe = new RegExp(arg.rx.duplicateOption, "i");
        const activeRe = new RegExp(arg.rx.activeUpload, "i");
        const completedRe = new RegExp(arg.rx.completedUpload, "i");
        const failedRe = new RegExp(arg.rx.failedUpload, "i");
        const cancelRe = new RegExp(arg.rx.cancelButton, "i");
        const closeRe = /(?:đóng|close|dismiss)/i;
        const nonCloseRe = /(?:thu gọn|minimize|mở rộng|expand|chi tiết|details|hủy|huỷ|cancel)/i;
        let closed = 0;

        for (let i = 0; i < dialogs.length; i++) {
          const dlg = dialogs[i] as HTMLElement | null;
          if (!dlg || !dlg.isConnected) continue;
          if (dlg.getAttribute("aria-modal") === "true") continue;

          const dlgRect = dlg.getBoundingClientRect();
          if (dlgRect.width < 4 || dlgRect.height < 4) continue;

          const combined = (
            (dlg.getAttribute("aria-label") || "") +
            " " +
            (dlg.innerText || dlg.textContent || "")
          )
            .replace(/\s+/g, " ")
            .trim();

          if (!combined || dupRe.test(combined) || activeRe.test(combined)) continue;

          let hasCancelBtn = false;
          const allBtns = dlg.querySelectorAll('button, [role="button"]');
          for (let b = 0; b < allBtns.length; b++) {
            const btn = allBtns[b] as HTMLElement;
            const bLabel = (
              (btn.getAttribute("aria-label") || "") +
              " " +
              (btn.getAttribute("title") || "") +
              " " +
              (btn.getAttribute("data-tooltip") || "") +
              " " +
              (btn.innerText || btn.textContent || "")
            )
              .replace(/\s+/g, " ")
              .trim();
            if (bLabel && cancelRe.test(bLabel)) {
              hasCancelBtn = true;
              break;
            }
          }
          if (hasCancelBtn) continue;

          const matchesIdleTray =
            completedRe.test(combined) || (arg.includeFailed && failedRe.test(combined));
          if (!matchesIdleTray) continue;

          for (let c = 0; c < allBtns.length; c++) {
            const closeBtn = allBtns[c] as HTMLElement;
            const labelledByIds = (closeBtn.getAttribute("aria-labelledby") || "")
              .split(/\s+/)
              .filter(Boolean);
            let labelledByText = "";
            for (let l = 0; l < labelledByIds.length; l++) {
              const refEl = document.getElementById(labelledByIds[l]);
              if (refEl) {
                labelledByText += " " + (refEl.textContent || "");
              }
            }
            const closeAttrLabel = (
              (closeBtn.getAttribute("aria-label") || "") +
              " " +
              (closeBtn.getAttribute("title") || "") +
              " " +
              (closeBtn.getAttribute("data-tooltip") || "") +
              labelledByText
            )
              .replace(/\s+/g, " ")
              .trim();
            if (
              !closeAttrLabel ||
              nonCloseRe.test(closeAttrLabel) ||
              !closeRe.test(closeAttrLabel)
            ) {
              continue;
            }
            const cr = closeBtn.getBoundingClientRect();
            const ccs = window.getComputedStyle(closeBtn);
            if (
              cr.width >= 2 &&
              cr.height >= 2 &&
              ccs.display !== "none" &&
              ccs.visibility !== "hidden" &&
              parseFloat(ccs.opacity || "1") > 0
            ) {
              closeBtn.click();
              closed += 1;
              break;
            }
          }
        }
        return closed;
      },
      { rx: DRIVE_INDICATOR_REGEX_SOURCES, includeFailed: includeFailedIdleTray }
    );
    if (Number(clickedCount) > 0) {
      await page.waitForTimeout(250).catch(() => {});
    }
  } catch {
    // Non-fatal tray dismissal
  }
}

export async function inspectDriveUploadIndicators(
  page: Page
): Promise<{ hasError: boolean; isBusy: boolean }> {
  const errState = await hasAnyVisibleDriveElement(page, DRIVE_UPLOAD_ERROR_SELECTOR);
  if (errState.visible) {
    return { hasError: true, isBusy: false };
  }
  const progressState = await hasAnyVisibleDriveElement(page, DRIVE_UPLOAD_PROGRESS_SELECTOR);
  const dialogState = await hasAnyVisibleDriveElement(page, DRIVE_ACTIVE_DIALOG_SELECTOR);
  const hasRealProgress =
    progressState.visible && !progressState.inspectionFailed
      ? await hasActiveDriveUploadProgress(page)
      : false;
  const hasRealDialog =
    dialogState.visible && !dialogState.inspectionFailed
      ? await hasBlockingDriveDialog(page)
      : false;
  const isBusy =
    errState.inspectionFailed ||
    progressState.inspectionFailed ||
    dialogState.inspectionFailed ||
    hasRealProgress ||
    hasRealDialog;
  return { hasError: false, isBusy };
}

function stripDriveDuplicateSuffix(fileNameLower: string): string {
  return fileNameLower.replace(/\s+\(\d+\)(\.[a-z0-9_-]+)?$/i, "$1");
}

/**
 * Uploads local files into an open Google Drive student folder via "+ Mới" -> "Tải tệp lên".
 * Safety invariant (v3.4.1):
 *   1. NEVER moves any pre-existing file to trash BEFORE new files are uploaded and verified.
 *   2. Pre-existing files (`preExistingFileIds`) are recorded up-front and NEVER mistaken for newly
 *      uploaded files unless either a distinct new Drive item ID appears (`!preExistingFileIds.has(id)`)
 *      or Google Drive's duplicate-replacement dialog was explicitly confirmed and finished uploading.
 *   3. Stale files are trashed ONLY after the upload succeeds (or deferred until the entire directory tree succeeds).
 */
async function renameDriveItemIfNeeded(
  page: Page,
  itemId: string,
  targetCleanName: string
): Promise<void> {
  await scrollDriveItemIntoDom(page, itemId);
  const row = page
    .locator(`[role="main"] [data-target="doc"][data-id="${itemId}"]`)
    .first();
  if (typeof (row as any).scrollIntoViewIfNeeded === "function") {
    await row.scrollIntoViewIfNeeded().catch(() => {});
  }
  if (!(await row.isVisible().catch(() => false))) return;

  await row.click({ button: "right" }).catch(() => {});
  await page.waitForTimeout(350);
  const renameMenuItem = page
    .locator(
      '[role="menuitem"]:has-text("Đổi tên"):visible, [role="menuitem"]:has-text("Rename"):visible'
    )
    .first();
  if (!(await renameMenuItem.isVisible().catch(() => false))) {
    await page.keyboard.press("Escape").catch(() => {});
    return;
  }
  await renameMenuItem.click().catch(() => {});
  await page.waitForTimeout(350);
  const renameInput = page
    .locator('[role="dialog"] input[type="text"]:visible, [role="dialog"] input:visible')
    .first();
  if (!(await renameInput.isVisible().catch(() => false))) {
    await page.keyboard.press("Escape").catch(() => {});
    return;
  }
  await renameInput.fill(targetCleanName);
  await page.waitForTimeout(150);
  const okBtn = page
    .locator(
      '[role="dialog"] button:has-text("OK"):visible, [role="dialog"] button:has-text("Lưu"):visible, [role="dialog"] button:has-text("Save"):visible'
    )
    .last();
  if (await okBtn.isVisible().catch(() => false)) {
    await okBtn.click().catch(() => {});
  } else {
    await renameInput.press("Enter").catch(() => {});
  }
  await page.waitForTimeout(700);
}

export async function uploadFilesIntoDriveFolder(
  page: Page,
  studentDriveFolderId: string,
  localFilePaths: string[],
  replaceAllStaleFiles = true,
  deferredCleanupOut?: Array<{ folderId: string; itemIds: string[] }>,
  deferredRenameOut?: Array<{
    folderId: string;
    items: Array<{ id: string; cleanName: string }>;
  }>,
  options?: {
    avoidInPlaceReplace?: boolean;
  }
): Promise<number> {
  if (localFilePaths.length === 0 && !replaceAllStaleFiles) return 0;
  assertDriveNotStopped();

  await ensureGoogleDriveFolderReadyAndAuthenticated(page, studentDriveFolderId);
  const existingItems = await listDriveItemsOnPage(page, studentDriveFolderId);
  const preExistingFiles = existingItems.filter((item) => !item.isFolder);
  const preExistingFileIds = new Set(preExistingFiles.map((item) => item.id));
  const preExistingNamesLower = new Set(
    preExistingFiles.map((item) => item.name.toLowerCase())
  );

  const targetLowerNames = new Set(
    localFilePaths.map((p) => path.basename(p).toLowerCase())
  );

  if (localFilePaths.length === 0) {
    const staleIdsWhenEmpty = replaceAllStaleFiles
      ? preExistingFiles.map((item) => item.id)
      : [];
    if (staleIdsWhenEmpty.length > 0) {
      if (deferredCleanupOut) {
        deferredCleanupOut.push({
          folderId: studentDriveFolderId,
          itemIds: staleIdsWhenEmpty,
        });
      } else {
        for (const oldId of staleIdsWhenEmpty) {
          await moveDriveItemToTrash(page, oldId);
        }
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(300);
      }
    }
    return 0;
  }

  assertDriveNotStopped();
  await dismissIdleDriveUploadTray(page, true);

  const fileUploadMenuSelector =
    '[role="menuitem"]:has-text("Tải tệp lên"):visible, [role="menuitem"]:has-text("File upload"):visible';
  const { menuItem: fileUploadMenuItem } = await openDriveNewMenuAndGetItem(
    page,
    fileUploadMenuSelector
  );

  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 12000 }),
    fileUploadMenuItem.click(),
  ]);
  await fileChooser.setFiles(localFilePaths);

  // Wait for all uploaded files to appear AND finish uploading (no active progressbar/dialog/error)
  // before ever moving obsolete/duplicate items to Trash.
  const expectedBaseNames = localFilePaths.map((p) => path.basename(p).toLowerCase());
  const exactExpectedByLower = new Map<string, string>(
    localFilePaths.map((p) => [path.basename(p).toLowerCase(), path.basename(p)])
  );
  const uploadTimeoutMs = Math.min(
    180_000,
    Math.max(45_000, 30_000 + localFilePaths.length * 2_000)
  );
  const uploadDeadline = Date.now() + uploadTimeoutMs;
  const maxPollIterations = Math.max(40, Math.floor(uploadTimeoutMs / 1125));
  let pollIterations = 0;
  let verifiedAllPresent = false;
  let sawIncompleteUploadProgress = false;
  let confirmedInPlaceReplace = false;
  let sawKeepBothFallbackModal = false;
  let latestItemsAfterUpload = existingItems;

  const avoidInPlaceReplace = Boolean(options?.avoidInPlaceReplace);

  while (Date.now() < uploadDeadline && pollIterations < maxPollIterations) {
    pollIterations += 1;
    assertDriveNotStopped();
    await page.waitForTimeout(1200);

    // In atomic `zip_bundle` mode (`avoidInPlaceReplace: true`), NEVER overwrite an existing Drive file
    // in place before the entire upload batch has completed and verified.
    const replaceExistingOption = page
      .locator(
        '[role="dialog"] [role="radio"]:has-text("Thay thế tệp hiện có"):visible, [role="dialog"] [role="radio"]:has-text("Thay thế tệp đã có"):visible, [role="dialog"] [role="radio"]:has-text("Cập nhật tệp hiện có"):visible, [role="dialog"] [role="radio"]:has-text("Replace existing"):visible, [role="dialog"] [role="radio"]:has-text("Update existing"):visible, [role="dialog"] label:has-text("Thay thế tệp hiện có"):visible, [role="dialog"] label:has-text("Thay thế tệp đã có"):visible, [role="dialog"] label:has-text("Cập nhật tệp hiện có"):visible, [role="dialog"] label:has-text("Replace existing"):visible, [role="dialog"] label:has-text("Update existing"):visible, [role="dialog"] button:has-text("Thay thế tệp hiện có"):visible, [role="dialog"] button:has-text("Thay thế tệp đã có"):visible, [role="dialog"] button:has-text("Replace existing"):visible'
      )
      .first();
    const sawReplaceOption = avoidInPlaceReplace
      ? false
      : await replaceExistingOption.isVisible().catch(() => false);
    if (sawReplaceOption) {
      await replaceExistingOption.click().catch(() => {});
      confirmedInPlaceReplace = true;
      await page.waitForTimeout(200);
      const replaceConfirmBtn = page
        .locator(
          '[role="dialog"] button:has-text("Tải lên"):visible, [role="dialog"] button:has-text("Tiếp tục"):visible, [role="dialog"] button:has-text("Thay thế"):visible, [role="dialog"] button:has-text("Cập nhật"):visible, [role="dialog"] button:has-text("Upload"):visible, [role="dialog"] button:has-text("Continue"):visible, [role="dialog"] button:has-text("Replace"):visible, [role="dialog"] button:has-text("Update"):visible, [role="dialog"] button:has-text("OK"):visible, [role="dialog"] button[data-id="EBS5u"]:visible'
        )
        .last();
      if (await replaceConfirmBtn.isVisible().catch(() => false)) {
        await replaceConfirmBtn.click().catch(() => {});
        await page.waitForTimeout(600);
      }
    } else {
      const keepBothRadio = page
        .locator(
          '[role="dialog"] [role="radio"]:has-text("Giữ cả hai"):visible, [role="dialog"] [role="radio"]:has-text("Keep both"):visible, [role="dialog"] [role="radio"]:has-text("Giữ tất cả"):visible, [role="dialog"] [role="radio"]:has-text("Keep separate"):visible, [role="dialog"] label:has-text("Giữ cả hai"):visible, [role="dialog"] label:has-text("Keep both"):visible'
        )
        .first();
      if (await keepBothRadio.isVisible().catch(() => false)) {
        sawKeepBothFallbackModal = true;
        await keepBothRadio.click().catch(() => {});
        await page.waitForTimeout(200);
        const keepBothConfirmBtn = page
          .locator(
            '[role="dialog"] button:has-text("Tải lên"):visible, [role="dialog"] button:has-text("Tiếp tục"):visible, [role="dialog"] button:has-text("Upload"):visible, [role="dialog"] button:has-text("Continue"):visible, [role="dialog"] button:has-text("OK"):visible, [role="dialog"] button[data-id="EBS5u"]:visible'
          )
          .last();
        if (await keepBothConfirmBtn.isVisible().catch(() => false)) {
          await keepBothConfirmBtn.click().catch(() => {});
          await page.waitForTimeout(600);
        }
      } else if (!avoidInPlaceReplace) {
        const directReplaceConfirmBtn = page
          .locator(
            '[role="dialog"] button:has-text("Thay thế"):visible, [role="dialog"] button:has-text("Replace"):visible, [role="dialog"] button:has-text("Cập nhật"):visible, [role="dialog"] button:has-text("Update"):visible, [role="dialog"] button:has-text("Tiếp tục"):visible, [role="dialog"] button:has-text("Continue"):visible, [role="dialog"] button:has-text("OK"):visible'
          )
          .last();
        if (await directReplaceConfirmBtn.isVisible().catch(() => false)) {
          confirmedInPlaceReplace = true;
          await directReplaceConfirmBtn.click().catch(() => {});
          await page.waitForTimeout(600);
        }
      }
    }

    const preDomIndicators = await inspectDriveUploadIndicators(page);
    if (preDomIndicators.hasError) {
      throw new Error(
        "Google Drive báo lỗi tải tệp lên (Upload failed). Đã hủy dọn dẹp để giữ nguyên 100% bài cũ trên Drive."
      );
    }
    if (preDomIndicators.isBusy) {
      sawIncompleteUploadProgress = true;
      continue;
    }
    sawIncompleteUploadProgress = false;

    const currentItems = await listDriveItemsOnPage(page, studentDriveFolderId);
    latestItemsAfterUpload = currentItems;

    const newItemNormalizedNames = new Set<string>();
    const presentExactNames = new Set<string>();

    for (const item of currentItems) {
      if (item.isFolder) continue;
      const lower = item.name.toLowerCase();
      presentExactNames.add(lower);
      const strippedDup = stripDriveDuplicateSuffix(lower);
      if (!preExistingFileIds.has(item.id)) {
        newItemNormalizedNames.add(lower);
        // Only treat "(1)" as a synthetic Drive duplicate when the student doesn't genuinely have a file named "... (1).ext"
        if (!exactExpectedByLower.has(lower)) {
          newItemNormalizedNames.add(strippedDup);
        }
      }
    }

    const canTrustSameIdReplacement = avoidInPlaceReplace
      ? false
      : confirmedInPlaceReplace || (pollIterations >= 2 && !sawKeepBothFallbackModal);

    const allPresent = expectedBaseNames.every((name) => {
      if (newItemNormalizedNames.has(name)) {
        return true;
      }
      if (preExistingNamesLower.has(name) && presentExactNames.has(name) && canTrustSameIdReplacement) {
        return true;
      }
      return false;
    });

    if (allPresent) {
      // Re-check progress bar, error alerts, AND dialogs once more after reading DOM entries
      // to prevent TOCTOU races and fail closed if multiple elements or inspection errors occur.
      const postDomIndicators = await inspectDriveUploadIndicators(page);
      if (postDomIndicators.hasError) {
        throw new Error(
          "Google Drive báo lỗi tải tệp lên (Upload failed). Đã hủy dọn dẹp để giữ nguyên 100% bài cũ trên Drive."
        );
      }
      if (!postDomIndicators.isBusy) {
        verifiedAllPresent = true;
        break;
      }
      sawIncompleteUploadProgress = true;
    }
  }

  if (!verifiedAllPresent) {
    const integrityNote =
      preExistingFiles.length > 0
        ? "Bài cũ được giữ nguyên."
        : "Vui lòng bấm tải lại Google Drive.";
    const timeoutSec = Math.round(uploadTimeoutMs / 1000);
    throw new Error(
      sawIncompleteUploadProgress
        ? `Không thể xác nhận hoàn tất tải ${localFilePaths.length} tệp mới lên Google Drive (thanh tiến trình vẫn đang chạy hoặc hộp thoại chưa đóng). ${integrityNote}`
        : `Không thể xác nhận đủ ${localFilePaths.length} tệp mới đã tải lên thư mục Google Drive sau ${timeoutSec} giây. ${integrityNote}`
    );
  }

  await dismissIdleDriveUploadTray(page, false);

  // Determine which pre-existing files are now superseded and safe to move to trash.
  // Never trash an in-place replaced file keeping the same ID!
  const newItemsWithDistinctIds = new Set<string>();
  const duplicateNewItemsToRename: Array<{ id: string; cleanName: string }> = [];
  for (const item of latestItemsAfterUpload) {
    if (!item.isFolder && !preExistingFileIds.has(item.id)) {
      const lower = item.name.toLowerCase();
      const stripped = stripDriveDuplicateSuffix(lower);
      newItemsWithDistinctIds.add(lower);
      if (!exactExpectedByLower.has(lower)) {
        newItemsWithDistinctIds.add(stripped);
        if (stripped !== lower && exactExpectedByLower.has(stripped)) {
          duplicateNewItemsToRename.push({
            id: item.id,
            cleanName: exactExpectedByLower.get(stripped)!,
          });
        }
      }
    }
  }

  const staleOldIds: string[] = [];
  for (const oldFile of preExistingFiles) {
    const oldLower = oldFile.name.toLowerCase();
    const isTargetSameName = targetLowerNames.has(oldLower);
    const isOldDuplicateOfTarget =
      !targetLowerNames.has(oldLower) &&
      stripDriveDuplicateSuffix(oldLower) !== oldLower &&
      targetLowerNames.has(stripDriveDuplicateSuffix(oldLower));
    if (!isTargetSameName) {
      if (replaceAllStaleFiles || isOldDuplicateOfTarget) {
        staleOldIds.push(oldFile.id);
      }
    } else if (newItemsWithDistinctIds.has(oldLower)) {
      // Only trash the older copy when a distinct new item ID was created alongside it
      staleOldIds.push(oldFile.id);
    }
  }

  if (staleOldIds.length > 0) {
    if (deferredCleanupOut) {
      deferredCleanupOut.push({
        folderId: studentDriveFolderId,
        itemIds: staleOldIds,
      });
    } else {
      for (const oldId of staleOldIds) {
        await moveDriveItemToTrash(page, oldId);
      }
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(300);
    }
  }

  if (duplicateNewItemsToRename.length > 0) {
    if (deferredRenameOut) {
      deferredRenameOut.push({
        folderId: studentDriveFolderId,
        items: duplicateNewItemsToRename,
      });
    } else if (!deferredCleanupOut) {
      for (const dup of duplicateNewItemsToRename) {
        await renameDriveItemIfNeeded(page, dup.id, dup.cleanName);
      }
    }
  }

  await page.waitForTimeout(800);
  return localFilePaths.length;
}

/**
 * Pre-validates the student's entire local directory tree (allowlist, depth, size, and >0 valid
 * student files excluding Bot artifacts) BEFORE trashing any existing remote Drive contents.
 */
export function validateLocalDriveTreeBeforeUpload(
  localDirPath: string,
  studentId: string,
  fullName: string,
  depth = 0
): number {
  assertDriveNotStopped();
  if (depth > MAX_DRIVE_TREE_DEPTH) {
    throw new Error(
      `Cấu trúc thư mục SPCK của '${fullName}' vượt quá độ sâu cho phép (${MAX_DRIVE_TREE_DEPTH} cấp): '${localDirPath}'.`
    );
  }
  const safeDir = assertPathAllowed(localDirPath);
  const directFiles = prepareStudentFilesForDriveUpload(safeDir, studentId, fullName);
  let totalValid = directFiles.length;

  const entries = fs
    .readdirSync(safeDir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (isBotOrSystemIgnoredDriveDir(entry.name)) continue;
    const subLocalPath = assertPathAllowed(path.join(safeDir, entry.name));
    let st: fs.Stats;
    try {
      st = fs.lstatSync(subLocalPath);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    totalValid += validateLocalDriveTreeBeforeUpload(
      subLocalPath,
      studentId,
      fullName,
      depth + 1
    );
  }

  if (depth === 0 && totalValid === 0) {
    throw new Error(
      `Thư mục SPCK của '${fullName}' không có tệp hợp lệ nào để tải lên Google Drive.`
    );
  }
  return totalValid;
}

/**
 * Moves every existing direct child item (files and old subfolders) inside `targetDriveFolderId`
 * to Google Drive Trash, keeping `targetDriveFolderId` itself (and its share URL) intact.
 */
async function purgeAllItemsInsideDriveFolder(
  page: Page,
  targetDriveFolderId: string
): Promise<number> {
  await ensureGoogleDriveFolderReadyAndAuthenticated(page, targetDriveFolderId);
  let trashedCount = 0;

  for (let pass = 0; pass < 3; pass++) {
    assertDriveNotStopped();
    const items = await listDriveItemsOnPage(page, targetDriveFolderId);
    if (items.length === 0) {
      return trashedCount;
    }
    for (const item of items) {
      assertDriveNotStopped();
      await moveDriveItemToTrash(page, item.id);
      trashedCount += 1;
    }
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(450);
  }

  let remaining = await listDriveItemsOnPage(page, targetDriveFolderId);
  if (remaining.length > 0) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    await ensureGoogleDriveFolderReadyAndAuthenticated(page, targetDriveFolderId);
    remaining = await listDriveItemsOnPage(page, targetDriveFolderId);
    for (const item of remaining) {
      assertDriveNotStopped();
      await moveDriveItemToTrash(page, item.id);
      trashedCount += 1;
    }
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(450);
    remaining = await listDriveItemsOnPage(page, targetDriveFolderId);
  }

  if (remaining.length > 0) {
    throw new Error(
      `Không thể dọn sạch ${remaining.length} tệp/thư mục cũ trong thư mục Google Drive trước khi tải lên (${remaining
        .map((r) => r.name)
        .slice(0, 3)
        .join(", ")}). Đã dừng để tránh trộn lẫn bài cũ và mới.`
    );
  }

  return trashedCount;
}

/**
 * Uploads a student's local directory (including subdirectories like `gui/`, `img/`, `image/`, `src/`)
 * into `targetDriveFolderId` preserving the exact folder structure without creating any synthetic `.zip`.
 * When `options.cleanDestinationBeforeUpload` is true, pre-validates the local tree and moves all old items
 * inside `targetDriveFolderId` to Trash first (preserving `targetDriveFolderId` and its Drive URL).
 * Otherwise preserves upload-first / cleanup-after behavior for direct low-level callers.
 */
export async function uploadStudentDirectoryTreeToDrive(
  page: Page,
  targetDriveFolderId: string,
  localDirPath: string,
  studentId: string,
  fullName: string,
  depth = 0,
  replaceAllStaleFiles = true,
  deferredCleanupAccumulator?: Array<{ folderId: string; itemIds: string[] }>,
  deferredRenameAccumulator?: Array<{
    folderId: string;
    items: Array<{ id: string; cleanName: string }>;
  }>,
  options?: { cleanDestinationBeforeUpload?: boolean }
): Promise<number> {
  assertDriveNotStopped();
  if (depth > MAX_DRIVE_TREE_DEPTH) {
    throw new Error(
      `Cấu trúc thư mục SPCK của '${fullName}' vượt quá độ sâu cho phép (${MAX_DRIVE_TREE_DEPTH} cấp): '${localDirPath}'.`
    );
  }
  const safeDir = assertPathAllowed(localDirPath);
  const cleanMode = depth === 0 && options?.cleanDestinationBeforeUpload === true;
  if (cleanMode) {
    validateLocalDriveTreeBeforeUpload(safeDir, studentId, fullName, 0);
    await purgeAllItemsInsideDriveFolder(page, targetDriveFolderId);
  }

  const effectiveReplaceStale = cleanMode ? false : replaceAllStaleFiles;
  const directFiles = prepareStudentFilesForDriveUpload(safeDir, studentId, fullName);
  const cleanupQueue =
    deferredCleanupAccumulator || ([] as Array<{ folderId: string; itemIds: string[] }>);
  const renameQueue =
    deferredRenameAccumulator ||
    ([] as Array<{ folderId: string; items: Array<{ id: string; cleanName: string }> }>);

  await ensureGoogleDriveFolderReadyAndAuthenticated(page, targetDriveFolderId);

  let totalUploaded = await uploadFilesIntoDriveFolder(
    page,
    targetDriveFolderId,
    directFiles,
    effectiveReplaceStale,
    cleanupQueue,
    renameQueue
  );

  // Recursively recreate non-ignored subdirectories (e.g. `gui`, `img`, `image`, `assets`, `src`)
  const entries = fs
    .readdirSync(safeDir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));

  const validSubdirEntries: Array<{ name: string; subLocalPath: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (isBotOrSystemIgnoredDriveDir(entry.name)) {
      continue;
    }
    const subLocalPath = assertPathAllowed(path.join(safeDir, entry.name));
    let st: fs.Stats;
    try {
      st = fs.lstatSync(subLocalPath);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    validSubdirEntries.push({ name: entry.name, subLocalPath });
  }

  if (effectiveReplaceStale) {
    await ensureGoogleDriveFolderReadyAndAuthenticated(page, targetDriveFolderId);
    const existingRemoteItems = await listDriveItemsOnPage(page, targetDriveFolderId);
    const localSubdirNormNames = new Set(
      validSubdirEntries.map((d) => normalizeFolderTitle(d.name))
    );
    const staleSubfolderIds = existingRemoteItems
      .filter(
        (remoteItem) =>
          remoteItem.isFolder &&
          !localSubdirNormNames.has(normalizeFolderTitle(remoteItem.name))
      )
      .map((remoteItem) => remoteItem.id);
    if (staleSubfolderIds.length > 0) {
      cleanupQueue.push({
        folderId: targetDriveFolderId,
        itemIds: staleSubfolderIds,
      });
    }
  }

  for (const subEntry of validSubdirEntries) {
    assertDriveNotStopped();
    const subDriveFolderId = await findOrCreateDriveSubfolder(
      page,
      targetDriveFolderId,
      subEntry.name
    );
    totalUploaded += await uploadStudentDirectoryTreeToDrive(
      page,
      subDriveFolderId,
      subEntry.subLocalPath,
      studentId,
      fullName,
      depth + 1,
      effectiveReplaceStale,
      cleanupQueue,
      renameQueue
    );
  }

  if (depth === 0 && totalUploaded === 0) {
    throw new Error(
      `Thư mục SPCK của '${fullName}' không có tệp hợp lệ nào để tải lên Google Drive.`
    );
  }

  if (depth === 0 && cleanupQueue.length > 0) {
    for (const batch of cleanupQueue) {
      if (batch.itemIds.length === 0) continue;
      await ensureGoogleDriveFolderReadyAndAuthenticated(page, batch.folderId);
      for (const staleId of batch.itemIds) {
        assertDriveNotStopped();
        await moveDriveItemToTrash(page, staleId);
      }
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(250);
    }
  }

  if (depth === 0 && renameQueue.length > 0) {
    for (const batch of renameQueue) {
      if (batch.items.length === 0) continue;
      await ensureGoogleDriveFolderReadyAndAuthenticated(page, batch.folderId);
      for (const dup of batch.items) {
        assertDriveNotStopped();
        await renameDriveItemIfNeeded(page, dup.id, dup.cleanName);
      }
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(250);
    }
  }

  return totalUploaded;
}

const STANDALONE_DRIVE_MEDIA_EXTENSIONS = new Set([
  ".pptx",
  ".ppt",
  ".pdf",
  ".mp4",
  ".mov",
  ".webm",
]);

const MAX_STANDALONE_DRIVE_MEDIA_FILES = 6;

export interface PreparedDriveZipBundle {
  zipFilePath: string;
  zipFileName: string;
  stageDirPath: string;
  archivedFilesCount: number;
  standaloneMediaPaths: string[];
  uploadFilePaths: string[];
  packagedDigest?: string;
  stagedMediaTempRenames?: Array<{
    tempUploadNameLower: string;
    finalCleanName: string;
  }>;
  cleanup: () => void;
}

function formatDriveZipTimestamp(now = new Date()): string {
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${mm}${dd}_${hh}${mi}${ss}`;
}

function resolveDriveZipStageBaseDir(safeStudentDir: string): string {
  if (process.env.MINDX_DB_PATH) {
    const dbDir = path.dirname(path.resolve(process.env.MINDX_DB_PATH));
    if (isPathAllowed(dbDir)) {
      return assertPathAllowed(path.join(dbDir, "_drive_zip_stage"));
    }
    return assertPathAllowed(path.join(safeStudentDir, "_spck_temp", "_drive_zip_stage"));
  }
  return assertPathAllowed(path.join(process.cwd(), "temp_submissions", "_drive_zip_stage"));
}

/**
 * Packages a student's SPCK project directory into 1 versioned `.zip` archive
 * (`<StudentSlug>_SPCK_B<Session>_<MMDD_HHmmss>.zip`) plus standalone Slide/Video files
 * (`.pptx`, `.ppt`, `.pdf`, `.mp4`, `.mov`, `.webm`) so Demo judges can preview slides/videos
 * directly on Google Drive without unzipping while keeping code/assets 100% clean and fast.
 */
export function prepareStudentZipBundleAndStandaloneMediaForDrive(
  localDirPath: string,
  studentId: string,
  fullName: string,
  options?: {
    sessionNumber?: number;
    avoidNamesLower?: Set<string>;
  }
): PreparedDriveZipBundle {
  assertDriveNotStopped();
  const safeRootDir = assertPathAllowed(localDirPath);
  validateLocalDriveTreeBeforeUpload(safeRootDir, studentId, fullName, 0);
  const digestBeforePack = computeStudentFolderContentDigest(safeRootDir);

  interface CollectedGenuineFile {
    absPath: string;
    relPosixPath: string;
    baseName: string;
    extLower: string;
    depth: number;
    size: number;
    mtimeMs: number;
  }

  const genuineFiles: CollectedGenuineFile[] = [];
  let totalInputBytes = 0;

  const walk = (dirPath: string, relPrefix: string, depth: number) => {
    if (depth > MAX_DRIVE_TREE_DEPTH) return;
    const entries = fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((e) => !e.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name, "en"));

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (isBotOrSystemIgnoredDriveDir(entry.name)) continue;
        const subAbs = assertPathAllowed(path.join(dirPath, entry.name));
        let st: fs.Stats;
        try {
          st = fs.lstatSync(subAbs);
        } catch {
          continue;
        }
        if (st.isSymbolicLink()) continue;
        const nextRel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        walk(subAbs, nextRel, depth + 1);
        continue;
      }

      if (isBotOrSystemIgnoredDriveFile(entry.name)) continue;
      const fileAbs = assertPathAllowed(path.join(dirPath, entry.name));
      let st: fs.Stats;
      try {
        st = fs.lstatSync(fileAbs);
      } catch {
        continue;
      }
      if (st.isSymbolicLink() || !st.isFile() || st.size <= 0) continue;
      if (st.size > MAX_DRIVE_FILE_SIZE_BYTES) {
        throw new Error(
          `Tệp '${entry.name}' của '${fullName}' vượt quá giới hạn 150MB (${Math.round(
            st.size / (1024 * 1024)
          )}MB).`
        );
      }

      totalInputBytes += st.size;
      if (totalInputBytes > MAX_DRIVE_FILE_SIZE_BYTES * 2) {
        throw new Error(
          `Tổng dung lượng dự án SPCK của '${fullName}' vượt quá giới hạn đóng gói 300MB.`
        );
      }

      const relPosixPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      genuineFiles.push({
        absPath: fileAbs,
        relPosixPath,
        baseName: entry.name,
        extLower: path.extname(entry.name).toLowerCase(),
        depth,
        size: st.size,
        mtimeMs: st.mtimeMs || 0,
      });
    }
  };

  walk(safeRootDir, "", 0);

  if (genuineFiles.length === 0) {
    throw new Error(
      `Thư mục SPCK của '${fullName}' không có tệp hợp lệ nào để tải lên Google Drive.`
    );
  }

  // Select standalone Slide (.pptx/.ppt/.pdf) and Video (.mp4/.mov/.webm) files,
  // preferring shallower depth first and newer mtime second, deduplicated by basename.
  const mediaCandidates = genuineFiles
    .filter((f) => STANDALONE_DRIVE_MEDIA_EXTENSIONS.has(f.extLower))
    .sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
      return a.relPosixPath.localeCompare(b.relPosixPath, "en");
    });

  const standaloneMediaPaths: string[] = [];
  const usedStandaloneNamesLower = new Set<string>();
  for (const cand of mediaCandidates) {
    if (standaloneMediaPaths.length >= MAX_STANDALONE_DRIVE_MEDIA_FILES) break;
    const key = cand.baseName.toLowerCase();
    if (usedStandaloneNamesLower.has(key)) continue;
    usedStandaloneNamesLower.add(key);
    standaloneMediaPaths.push(cand.absPath);
  }

  const rawSlug = stripVietnameseDiacritics(fullName || studentId)
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  const studentSlug = rawSlug || String(studentId || "Student").replace(/[^a-zA-Z0-9_-]/g, "_");
  const sessionLabel =
    options?.sessionNumber === 12 ||
    options?.sessionNumber === 13 ||
    options?.sessionNumber === 14
      ? `B${options.sessionNumber}`
      : "SPCK";
  const tsTag = formatDriveZipTimestamp();
  const avoidSet = new Set<string>([
    ...(options?.avoidNamesLower ? Array.from(options.avoidNamesLower) : []),
    ...Array.from(usedStandaloneNamesLower),
  ]);

  let zipFileName = `${studentSlug}_SPCK_${sessionLabel}_${tsTag}.zip`;
  let collisionIdx = 2;
  while (avoidSet.has(zipFileName.toLowerCase())) {
    zipFileName = `${studentSlug}_SPCK_${sessionLabel}_${tsTag}_${collisionIdx}.zip`;
    collisionIdx += 1;
  }

  const stageBaseDir = resolveDriveZipStageBaseDir(safeRootDir);
  const stageRunId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const stageDirPath = assertPathAllowed(path.join(stageBaseDir, stageRunId));
  fs.mkdirSync(stageDirPath, { recursive: true });
  const zipFilePath = assertPathAllowed(path.join(stageDirPath, zipFileName));

  const cleanup = () => {
    try {
      if (fs.existsSync(stageDirPath)) {
        fs.rmSync(stageDirPath, { recursive: true, force: true });
      }
      const spckTempParent = path.join(safeRootDir, "_spck_temp");
      if (fs.existsSync(spckTempParent)) {
        const remStage = path.join(spckTempParent, "_drive_zip_stage");
        if (fs.existsSync(remStage) && fs.readdirSync(remStage).length === 0) {
          fs.rmdirSync(remStage);
        }
        if (fs.readdirSync(spckTempParent).length === 0) {
          fs.rmdirSync(spckTempParent);
        }
      }
    } catch {
      // Ignore staging cleanup errors
    }
  };

  try {
    const zip = new AdmZip();
    for (const item of genuineFiles) {
      const zipFolder = path.posix.dirname(item.relPosixPath);
      zip.addLocalFile(
        item.absPath,
        zipFolder === "." ? "" : zipFolder,
        path.posix.basename(item.relPosixPath)
      );
    }
    zip.writeZip(zipFilePath);

    if (!fs.existsSync(zipFilePath)) {
      throw new Error(`Không thể tạo gói nén .zip cho '${fullName}'.`);
    }
    const zipStat = fs.statSync(zipFilePath);
    if (zipStat.size <= 0) {
      throw new Error(`Gói nén .zip của '${fullName}' bị rỗng (0 byte).`);
    }
    if (zipStat.size > MAX_DRIVE_FILE_SIZE_BYTES) {
      throw new Error(
        `Gói nén .zip của '${fullName}' vượt quá giới hạn 150MB (${Math.round(
          zipStat.size / (1024 * 1024)
        )}MB).`
      );
    }

    const preExistingAvoidLower = options?.avoidNamesLower || new Set<string>();
    const stagedUploadMediaPaths: string[] = [];
    const stagedMediaTempRenames: Array<{
      tempUploadNameLower: string;
      finalCleanName: string;
    }> = [];
    const reservedUploadNames = new Set<string>([
      ...Array.from(preExistingAvoidLower),
      zipFileName.toLowerCase(),
    ]);

    for (const mediaPath of standaloneMediaPaths) {
      const origBase = path.basename(mediaPath);
      const origLower = origBase.toLowerCase();
      if (!preExistingAvoidLower.has(origLower)) {
        reservedUploadNames.add(origLower);
        stagedUploadMediaPaths.push(mediaPath);
        continue;
      }
      // Pre-existing file with the same name exists on Drive: stage under a distinct temporary
      // filename so Google Drive uploads a brand-new item ID without overwriting the old file!
      const ext = path.extname(origBase);
      const stem = path.basename(origBase, ext);
      let tempName = `${stem}__spck_new_${tsTag}${ext}`;
      let tempIdx = 2;
      while (reservedUploadNames.has(tempName.toLowerCase())) {
        tempName = `${stem}__spck_new_${tsTag}_${tempIdx}${ext}`;
        tempIdx += 1;
      }
      reservedUploadNames.add(tempName.toLowerCase());
      const tempDestPath = assertPathAllowed(path.join(stageDirPath, tempName));
      fs.copyFileSync(mediaPath, tempDestPath);
      stagedUploadMediaPaths.push(tempDestPath);
      stagedMediaTempRenames.push({
        tempUploadNameLower: tempName.toLowerCase(),
        finalCleanName: origBase,
      });
    }

    const digestAfterPack = computeStudentFolderContentDigest(safeRootDir);
    const packagedDigest =
      digestBeforePack.filesCount > 0 &&
      digestBeforePack.digest &&
      digestBeforePack.digest === digestAfterPack.digest
        ? digestBeforePack.digest
        : "";

    return {
      zipFilePath,
      zipFileName,
      stageDirPath,
      archivedFilesCount: genuineFiles.length,
      standaloneMediaPaths,
      uploadFilePaths: [zipFilePath, ...stagedUploadMediaPaths],
      packagedDigest,
      stagedMediaTempRenames,
      cleanup,
    };
  } catch (err) {
    cleanup();
    throw err;
  }
}

/**
 * "Cách 1" Upload-First Google Drive Bundle Uploader:
 * 1. Validates local folder BEFORE touching Google Drive.
 * 2. Uploads the new versioned `.zip` archive (+ standalone Slide/Video files using collision-free
 *    temporary names when an older file shares the same name) FIRST into `targetDriveFolderId`.
 * 3. Verifies 100% upload completion (no active progress bar, no error alert, all new IDs visible in DOM).
 * 4. ONLY AFTER verified completion, moves all superseded older `.zip` files, raw files, and legacy subfolders
 *    inside `targetDriveFolderId` to Trash and renames any temporary media items to their clean filenames,
 *    preserving `targetDriveFolderId` and its share URL 100% intact.
 */
export async function uploadStudentZipBundleToDrive(
  page: Page,
  targetDriveFolderId: string,
  localDirPath: string,
  studentId: string,
  fullName: string,
  options?: {
    sessionNumber?: number;
  }
): Promise<{
  uploadedFilesCount: number;
  zipFileName: string;
  standaloneMediaCount: number;
  packagedDigest?: string;
}> {
  assertDriveNotStopped();
  const safeDir = assertPathAllowed(localDirPath);
  validateLocalDriveTreeBeforeUpload(safeDir, studentId, fullName, 0);

  await ensureGoogleDriveFolderReadyAndAuthenticated(page, targetDriveFolderId);
  const preExistingItems = await listDriveItemsOnPage(page, targetDriveFolderId);
  const preExistingItemIds = new Set(preExistingItems.map((item) => item.id));
  const preExistingNamesLower = new Set(
    preExistingItems.map((item) => item.name.toLowerCase())
  );
  const preExistingFolderIds = preExistingItems
    .filter((item) => item.isFolder)
    .map((item) => item.id);

  const bundle = prepareStudentZipBundleAndStandaloneMediaForDrive(
    safeDir,
    studentId,
    fullName,
    {
      sessionNumber: options?.sessionNumber,
      avoidNamesLower: preExistingNamesLower,
    }
  );

  const cleanupQueue: Array<{ folderId: string; itemIds: string[] }> = [];
  const renameQueue: Array<{
    folderId: string;
    items: Array<{ id: string; cleanName: string }>;
  }> = [];

  try {
    await uploadFilesIntoDriveFolder(
      page,
      targetDriveFolderId,
      bundle.uploadFilePaths,
      true,
      cleanupQueue,
      renameQueue,
      { avoidInPlaceReplace: true }
    );

    if (preExistingFolderIds.length > 0) {
      cleanupQueue.push({
        folderId: targetDriveFolderId,
        itemIds: preExistingFolderIds,
      });
    }

    const trashedIds = new Set<string>();
    for (const batch of cleanupQueue) {
      if (batch.itemIds.length === 0) continue;
      await ensureGoogleDriveFolderReadyAndAuthenticated(page, batch.folderId);
      for (const staleId of batch.itemIds) {
        if (trashedIds.has(staleId)) continue;
        assertDriveNotStopped();
        await moveDriveItemToTrash(page, staleId);
        trashedIds.add(staleId);
      }
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(250);
    }

    if (bundle.stagedMediaTempRenames && bundle.stagedMediaTempRenames.length > 0) {
      const postTrashItems = await listDriveItemsOnPage(page, targetDriveFolderId);
      const stagedRenameItems: Array<{ id: string; cleanName: string }> = [];
      for (const pendingRename of bundle.stagedMediaTempRenames) {
        const matchedNew = postTrashItems.find((item) => {
          if (item.isFolder || preExistingItemIds.has(item.id) || trashedIds.has(item.id)) {
            return false;
          }
          const lower = item.name.toLowerCase();
          return (
            lower === pendingRename.tempUploadNameLower ||
            stripDriveDuplicateSuffix(lower) === pendingRename.tempUploadNameLower
          );
        });
        if (matchedNew) {
          stagedRenameItems.push({
            id: matchedNew.id,
            cleanName: pendingRename.finalCleanName,
          });
        }
      }
      if (stagedRenameItems.length > 0) {
        renameQueue.push({
          folderId: targetDriveFolderId,
          items: stagedRenameItems,
        });
      }
    }

    for (const batch of renameQueue) {
      if (batch.items.length === 0) continue;
      await ensureGoogleDriveFolderReadyAndAuthenticated(page, batch.folderId);
      for (const dup of batch.items) {
        assertDriveNotStopped();
        await renameDriveItemIfNeeded(page, dup.id, dup.cleanName);
      }
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(250);
    }

    return {
      uploadedFilesCount: bundle.archivedFilesCount,
      zipFileName: bundle.zipFileName,
      standaloneMediaCount: bundle.standaloneMediaPaths.length,
      packagedDigest: bundle.packagedDigest,
    };
  } finally {
    bundle.cleanup();
  }
}

export class SpckDriveUploader {
  /**
   * Enqueues the Google Drive SPCK folder creation & upload job on SequentialTaskQueue.
   */
  public static async uploadClassSpckToGoogleDrive(
    options: SpckDriveUploadOptions
  ): Promise<SpckDriveBatchResult> {
    const normalizedClassId = (options.classId || "").trim().toUpperCase();
    if (!normalizedClassId) {
      throw new Error("[SpckDriveUploader] Thiếu mã lớp (classId).");
    }

    const jobId = `UPLOAD_SPCK_DRIVE_${normalizedClassId}_${Date.now()}`;
    return await taskQueue.enqueue<SpckDriveBatchResult>({
      id: jobId,
      jobType: "UPLOAD_SPCK",
      description: `Tải SPCK lên Google Drive & Gắn Link (${normalizedClassId})`,
      classId: normalizedClassId,
      execute: async () => {
        return await SpckDriveUploader.executeDriveUploadJob(
          { ...options, classId: normalizedClassId },
          jobId
        );
      },
    });
  }

  private static async executeDriveUploadJob(
    options: SpckDriveUploadOptions,
    jobId: string
  ): Promise<SpckDriveBatchResult> {
    const normalizedClassId = options.classId.trim().toUpperCase();
    const rawDriveUrl = (options.driveFolderUrl || DEFAULT_SPCK_DRIVE_FOLDER_URL).trim();
    const inputFolderId = extractDriveFolderId(rawDriveUrl);
    const coursePrefix = detectCoursePrefixFromClassId(normalizedClassId);

    if (
      isCourseExemptFromSpck(normalizedClassId) &&
      inputFolderId === CODING_SPCK_ROOT_FOLDER_ID
    ) {
      throw new Error(
        `Khóa ${coursePrefix || normalizedClassId} (${normalizedClassId}) không thi cuối khóa nên được miễn nộp SPCK & Google Drive.`
      );
    }

    const allClassRecords = spckUploadRepo.findByClass(normalizedClassId);
    const targetRecords =
      options.studentIds && options.studentIds.length > 0
        ? allClassRecords.filter((r) => options.studentIds!.includes(r.studentId))
        : allClassRecords.filter((r) => Boolean(r.localFolderPath));

    if (targetRecords.length === 0) {
      return {
        classId: normalizedClassId,
        parentDriveFolderUrl: rawDriveUrl,
        totalRequested: 0,
        successCount: 0,
        failedCount: 0,
        uploadedStudentsCount: 0,
        failedStudentsCount: 0,
        results: [],
      };
    }

    const studentsInClass = studentRepo.findByClass(normalizedClassId);
    const studentMap = new Map(studentsInClass.map((s) => [s.studentId, s]));

    // Detect duplicate normalized student names in the class to prevent two students from sharing one Drive folder
    const nameOwners = new Map<string, Set<string>>();
    const registerNameCandidate = (stuId: string, name: string) => {
      const norm = normalizeFolderTitle(name || stuId);
      if (!nameOwners.has(norm)) {
        nameOwners.set(norm, new Set());
      }
      nameOwners.get(norm)!.add(stuId);
    };
    for (const s of studentsInClass) {
      registerNameCandidate(s.studentId, s.fullName);
    }
    for (const r of allClassRecords) {
      const s = studentMap.get(r.studentId);
      registerNameCandidate(r.studentId, s?.fullName || r.studentId);
    }

    // If teacher gave the root CODING - SPCK folder (1Xl8OZ7i1bOKf7000xbUBYLPcxVb2qvRD),
    // strictly resolve the course subfolder (e.g. 2. PTA for VT-C4K-PTA12, or find/create course folder for Robotics)
    const isRoboticsClass = Boolean(coursePrefix && ROBOTICS_COURSE_PREFIXES.has(coursePrefix));
    let courseOrParentFolderId = inputFolderId;
    if (inputFolderId === CODING_SPCK_ROOT_FOLDER_ID) {
      if (coursePrefix && CODING_SPCK_COURSE_FOLDER_MAP[coursePrefix]) {
        courseOrParentFolderId = CODING_SPCK_COURSE_FOLDER_MAP[coursePrefix];
      } else if (!isRoboticsClass) {
        throw new Error(
          `Khóa học '${coursePrefix || normalizedClassId}' của lớp '${normalizedClassId}' chưa có thư mục khóa học cấu hình sẵn trong thư mục gốc Google Drive. Vui lòng dán trực tiếp link thư mục Google Drive riêng của lớp hoặc khóa học (hệ thống không tự chọn thư mục của môn khác để thay thế).`
        );
      }
    }

    let classDriveFolderId = courseOrParentFolderId;
    try {
      const page = await BrowserManager.getInstance().getPage();

      if (inputFolderId === CODING_SPCK_ROOT_FOLDER_ID && isRoboticsClass && coursePrefix) {
        await ensureGoogleDriveFolderReadyAndAuthenticated(page, CODING_SPCK_ROOT_FOLDER_ID);
        courseOrParentFolderId = await findOrCreateDriveSubfolder(
          page,
          CODING_SPCK_ROOT_FOLDER_ID,
          coursePrefix
        );
      }

      await ensureGoogleDriveFolderReadyAndAuthenticated(page, courseOrParentFolderId);

      // Ensure class folder (e.g. VT-C4K-PTA12) exists inside the course folder
      const pageTitle = (await page.title().catch(() => "")).toUpperCase();
      classDriveFolderId = courseOrParentFolderId;
      if (!pageTitle.includes(normalizedClassId)) {
        classDriveFolderId = await findOrCreateDriveSubfolder(
          page,
          courseOrParentFolderId,
          normalizedClassId
        );
      }
    } catch (preErr) {
      const preErrMsg = preErr instanceof Error ? preErr.message : String(preErr);
      jobLogRepo.add({
        jobId,
        jobType: "SPCK_DRIVE_UPLOAD",
        classId: normalizedClassId,
        level: "ERROR",
        message: `Lỗi chuẩn bị thư mục Google Drive cho lớp ${normalizedClassId}: ${preErrMsg}`,
      });
      throw preErr;
    }

    const page = await BrowserManager.getInstance().getPage();
    const effectiveUploadMode: SpckDriveUploadMode =
      options.uploadMode === "tree" ? "tree" : "zip_bundle";

    const classDriveFolderUrl = `https://drive.google.com/drive/folders/${classDriveFolderId}`;
    const results: SpckDriveStudentResult[] = [];
    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < targetRecords.length; i++) {
      if (isEmergencyStopped()) {
        break;
      }

      const record = targetRecords[i];
      const stu = studentMap.get(record.studentId);
      const fullName = stu?.fullName || record.studentId;

      try {
        if (!record.localFolderPath) {
          throw new Error(`Học viên '${fullName}' chưa có đường dẫn thư mục SPCK trên máy.`);
        }
        if (Number(record.isConfirmedByTeacher) !== 1) {
          throw new Error(
            `Học viên '${fullName}' chưa được giáo viên xác nhận ghép thư mục SPCK.`
          );
        }

        const normName = normalizeFolderTitle(fullName);
        const hasNameCollision = (nameOwners.get(normName)?.size || 0) > 1;
        const targetStudentFolderName = hasNameCollision
          ? `${fullName} (${record.studentId})`
          : fullName;

        const studentDriveFolderId = await findOrCreateDriveSubfolder(
          page,
          classDriveFolderId,
          targetStudentFolderName
        );

        const preUploadDigestInfo = computeStudentFolderContentDigest(
          record.localFolderPath
        );
        let uploadedFilesCount = 0;
        let zipFileName: string | undefined;
        let standaloneMediaCount: number | undefined;
        let packagedDigestFromUpload: string | undefined;

        if (effectiveUploadMode === "tree") {
          uploadedFilesCount = await uploadStudentDirectoryTreeToDrive(
            page,
            studentDriveFolderId,
            record.localFolderPath,
            record.studentId,
            fullName,
            0,
            true,
            undefined,
            undefined,
            { cleanDestinationBeforeUpload: true }
          );
        } else {
          const zipUploadRes = await uploadStudentZipBundleToDrive(
            page,
            studentDriveFolderId,
            record.localFolderPath,
            record.studentId,
            fullName,
            { sessionNumber: options.sessionNumber }
          );
          uploadedFilesCount = zipUploadRes.uploadedFilesCount;
          zipFileName = zipUploadRes.zipFileName;
          standaloneMediaCount = zipUploadRes.standaloneMediaCount;
          packagedDigestFromUpload = zipUploadRes.packagedDigest;
        }

        const studentDriveUrl = `https://drive.google.com/drive/folders/${studentDriveFolderId}`;

        // Read freshest DB record BEFORE merging links so links added concurrently are never lost
        const latestDbRecord = spckUploadRepo.findOne(
          normalizedClassId,
          record.studentId
        );
        if (
          !latestDbRecord ||
          latestDbRecord.localFolderPath !== record.localFolderPath
        ) {
          throw new Error(
            `Bản ghi SPCK của '${fullName}' đã thay đổi thư mục trong lúc tải lên Google Drive. Đã hủy cập nhật link.`
          );
        }

        const existingLinks = parseJsonArraySafe<SpckRelatedLink>(
          latestDbRecord.relatedLinksJson
        );
        const nonDriveLinks = existingLinks.filter(
          (l) => !String(l.url || "").includes("drive.google.com/drive/folders/")
        );
        const updatedLinks: SpckRelatedLink[] = [
          { name: `Link Google Drive SPCK (${fullName})`.slice(0, 80), url: studentDriveUrl },
          ...nonDriveLinks,
        ];
        if (updatedLinks.length > MAX_SPCK_RELATED_LINKS) {
          throw new Error(
            `Không thể tự động thêm Link Google Drive cho '${fullName}' vì danh sách Đường dẫn liên quan đã đạt tối đa ${MAX_SPCK_RELATED_LINKS} link trên LMS. Vui lòng xóa bớt 1 link trước.`
          );
        }

        const postUploadDigestInfo = computeStudentFolderContentDigest(
          record.localFolderPath
        );
        const expectedUploadedDigest =
          packagedDigestFromUpload !== undefined
            ? packagedDigestFromUpload
            : (preUploadDigestInfo.filesCount ?? 1) > 0
            ? preUploadDigestInfo.digest
            : "";
        const verifiedPreppedDigest =
          expectedUploadedDigest &&
          (postUploadDigestInfo.filesCount ?? 1) > 0 &&
          postUploadDigestInfo.digest === expectedUploadedDigest
            ? expectedUploadedDigest
            : "";

        const nextRecord: SpckUploadRecord = {
          ...latestDbRecord,
          relatedLinksJson: JSON.stringify(updatedLinks),
          lastPreppedFolderDigest: verifiedPreppedDigest,
        };

        // Rule 4: Do NOT recompute contentHash here; if relatedLinksJson changed,
        // spckUploadRepo.upsert automatically downgrades APPROVED/VERIFIED -> WAITING_APPROVAL
        spckUploadRepo.upsert(nextRecord);

        if (options.syncAllUnverifiedSessions) {
          for (const slot of [12, 13, 14] as const) {
            try {
              const sessRow = spckSessionRepo.findOne(
                normalizedClassId,
                record.studentId,
                slot
              );
              const allowForceTargetApproved =
                options.allowDemoteApprovedSession === true &&
                Boolean(options.sessionNumber) &&
                slot === options.sessionNumber;
              if (
                !sessRow ||
                sessRow.lastVerifiedAt ||
                sessRow.draftStatus === "VERIFIED" ||
                sessRow.draftStatus === "SAVING" ||
                (!allowForceTargetApproved && sessRow.draftStatus === "APPROVED")
              ) {
                continue;
              }
              spckSessionRepo.syncLatestSharedResourcesToSessionDraft(
                normalizedClassId,
                record.studentId,
                slot
              );
            } catch {}
          }
        } else if (options.sessionNumber) {
          try {
            const sessRow = spckSessionRepo.findOne(
              normalizedClassId,
              record.studentId,
              options.sessionNumber
            );
            if (
              sessRow &&
              !sessRow.lastVerifiedAt &&
              sessRow.draftStatus !== "VERIFIED" &&
              sessRow.draftStatus !== "SAVING" &&
              !(options.allowDemoteApprovedSession === false && sessRow.draftStatus === "APPROVED")
            ) {
              spckSessionRepo.syncLatestSharedResourcesToSessionDraft(
                normalizedClassId,
                record.studentId,
                options.sessionNumber
              );
            }
          } catch {}
        }

        jobLogRepo.add({
          jobId,
          jobType: "SPCK_DRIVE_UPLOAD",
          classId: normalizedClassId,
          studentId: record.studentId,
          level: "SUCCESS",
          message:
            effectiveUploadMode === "zip_bundle" && zipFileName
              ? `Đã đóng gói '${zipFileName}' (${uploadedFilesCount} file${
                  standaloneMediaCount ? ` + ${standaloneMediaCount} Slide/Video lẻ` : ""
                }) của '${fullName}' lên Google Drive (${studentDriveUrl}) và gắn vào Đường dẫn liên quan.`
              : `Đã tải ${uploadedFilesCount} file SPCK của '${fullName}' lên Google Drive (${studentDriveUrl}) và gắn vào Đường dẫn liên quan.`,
          detailsJson: JSON.stringify({
            studentDriveFolderId,
            studentDriveUrl,
            uploadedFilesCount,
            uploadMode: effectiveUploadMode,
            zipFileName,
            standaloneMediaCount,
          }),
        });

        successCount++;
        results.push({
          studentId: record.studentId,
          fullName,
          status: "SUCCESS",
          driveFolderId: studentDriveFolderId,
          driveFolderUrl: studentDriveUrl,
          uploadedFilesCount,
          zipFileName,
          standaloneMediaCount,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        failedCount++;
        jobLogRepo.add({
          jobId,
          jobType: "SPCK_DRIVE_UPLOAD",
          classId: normalizedClassId,
          studentId: record.studentId,
          level: "ERROR",
          message: `Lỗi tải SPCK của '${fullName}' lên Google Drive: ${errMsg}`,
        });
        results.push({
          studentId: record.studentId,
          fullName,
          status: "FAILED",
          uploadedFilesCount: 0,
          errorMessage: errMsg,
        });
      }
    }

    return {
      classId: normalizedClassId,
      parentDriveFolderUrl: rawDriveUrl,
      classDriveFolderUrl,
      totalRequested: targetRecords.length,
      successCount,
      failedCount,
      uploadedStudentsCount: successCount,
      failedStudentsCount: failedCount,
      results,
    };
  }
}
