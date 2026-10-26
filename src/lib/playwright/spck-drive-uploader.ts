/**
 * MINDX AUTOMATION BOT - GOOGLE DRIVE SPCK UPLOADER
 * Uploads each student's local SPCK project folder to Google Drive (creating Class folder -> Student folder),
 * retrieves the shareable Google Drive folder link, and automatically attaches it to `relatedLinksJson`
 * in SQLite so `SpckUploader` pushes the link into "Đường dẫn liên quan (Link)" on MindX LMS.
 */

import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import {
  jobLogRepo,
  spckUploadRepo,
  studentRepo,
  type SpckUploadRecord,
} from "../db/sqlite";
import {
  MAX_SPCK_RELATED_LINKS,
  type SpckRelatedLink,
} from "../local-files/spck-scanner";
import { taskQueue } from "../queue/task-queue";
import { assertPathAllowed } from "../security/path-allowlist";
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
  ".venv",
  "venv",
  "build",
  "dist",
  ".idea",
  ".vscode",
]);

export interface SpckDriveStudentResult {
  studentId: string;
  fullName: string;
  status: "SUCCESS" | "FAILED";
  driveFolderId?: string;
  driveFolderUrl?: string;
  uploadedFilesCount: number;
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

export interface SpckDriveUploadOptions {
  classId: string;
  driveFolderUrl?: string;
  studentIds?: string[];
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

// Owner confirmed in v2.7.0: SPCK applies to ALL classes, including PTB and CSB.
export const SPCK_EXEMPT_COURSES = new Set<string>([]);

export function isCourseExemptFromSpck(_classIdOrPrefix: string): boolean {
  return false;
}

export function detectCoursePrefixFromClassId(classId: string): string | null {
  const upper = String(classId || "").toUpperCase();
  const prefixes = [
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
    "SB",
    "SA",
    "SI",
    "GB",
    "GA",
    "GI",
  ];
  for (const prefix of prefixes) {
    const regex = new RegExp(`(?:^|[-_\\s])${prefix}\\d*`, "i");
    if (regex.test(upper)) {
      return prefix;
    }
  }
  return null;
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
    .filter((e) => !e.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));

  const filesToUpload: string[] = [];

  for (const entry of entries) {
    const fullEntryPath = assertPathAllowed(path.join(safeFolder, entry.name));
    let st: fs.Stats;
    try {
      st = fs.lstatSync(fullEntryPath);
    } catch {
      continue;
    }
    if (st.isSymbolicLink() || !st.isFile()) continue;

    const lower = entry.name.toLowerCase();
    if (lower === "links.txt" || lower === "link.txt" || lower.endsWith(".pyc")) {
      continue;
    }

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
    const domItems = await page.evaluate((expectedParentId) => {
      const mainEl = document.querySelector('[role="main"]');
      if (!mainEl) return [];

      // Scroll container slightly to ensure virtualized rows in medium-sized folders are rendered
      const scrollable =
        mainEl.querySelector('[ role="grid" ]')?.parentElement || mainEl;
      if (scrollable && typeof scrollable.scrollTop === "number") {
        scrollable.scrollTop = 0;
      }

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
      const extracted: Array<{ id: string; name: string; isFolder: boolean }> = [];
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
        const firstLine = exactLabelById.get(id) || tokens[0] || "";

        const html = (el.innerHTML || "").toLowerCase();
        const dataType = (el.getAttribute("data-type") || "").toLowerCase();
        const ariaLabel = (el.getAttribute("aria-label") || "").toLowerCase();
        const hasExplicitFileLabel =
          dataType === "file" ||
          ariaLabel.includes("tệp") ||
          ariaLabel.includes("file");
        const isFolder =
          !hasExplicitFileLabel &&
          (dataType === "folder" ||
            html.includes("folder") ||
            rawText.includes("Shared folder") ||
            rawText.includes("Thư mục") ||
            ariaLabel.includes("folder") ||
            ariaLabel.includes("thư mục") ||
            (rawText.includes("—") && !/\.[a-z0-9]{1,8}$/i.test(firstLine)));
        if (firstLine) {
          extracted.push({ id, name: firstLine, isFolder });
        }
      }
      return extracted;
    }, parentFolderId || "");
    for (const item of domItems) {
      results.set(item.id, item);
    }
  } catch {
    // Ignore evaluation errors
  }

  return Array.from(results.values());
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
  if (!page.url().includes(`/folders/${folderId}`)) {
    await page.goto(folderUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
  }

  const newBtnSelector =
    'button[guidedhelpid="new_menu_button"], button[aria-label="Mới"], button[aria-label="New"]';
  const newBtn = page.locator(newBtnSelector).first();

  if (
    page.url().includes(`/folders/${folderId}`) &&
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
      currentUrl.includes(`drive.google.com/drive/folders/${folderId}`) &&
      (await newBtn.isVisible().catch(() => false))
    ) {
      return;
    }

    // If user finished sign-in and landed on My Drive or a different folder instead of `folderId`, redirect back to `folderUrl`
    if (
      currentUrl.includes("drive.google.com/drive/") &&
      !currentUrl.includes(`/folders/${folderId}`) &&
      (await newBtn.isVisible().catch(() => false))
    ) {
      await page.goto(folderUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2000);
      if (
        page.url().includes(`/folders/${folderId}`) &&
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
 * Moves an existing file item in the currently open Google Drive folder to trash so an updated local version can replace it cleanly.
 */
async function moveDriveItemToTrash(page: Page, itemId: string): Promise<void> {
  const row = page
    .locator(`[role="main"] [data-target="doc"][data-id="${itemId}"]`)
    .first();
  if (!(await row.isVisible().catch(() => false))) return;

  await row.click({ button: "right" }).catch(() => {});
  await page.waitForTimeout(350);
  const trashMenuItem = page
    .locator(
      '[role="menuitem"]:has-text("Chuyển vào thùng rác"):visible, [role="menuitem"]:has-text("Move to trash"):visible'
    )
    .first();
  if (await trashMenuItem.isVisible().catch(() => false)) {
    await trashMenuItem.click().catch(() => {});
    await page.waitForTimeout(700);
  } else {
    await page.keyboard.press("Escape").catch(() => {});
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

  const matchedExisting = existingItems.find(
    (item) => item.isFolder && normalizeFolderTitle(item.name) === normTarget
  );
  if (matchedExisting) {
    return matchedExisting.id;
  }

  // Dismiss any leftover modal dialog ("Thư mục mới" / "New folder") before opening "+ Mới"
  const newFolderModalLocator = page
    .locator('[role="dialog"]')
    .filter({ hasText: /Thư mục mới|New folder/i });
  if ((await newFolderModalLocator.count()) > 0) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(400);
  }

  // Click "+ Mới" / "+ New" -> "Thư mục mới" / "New folder" (or use Shift+F shortcut)
  const newBtn = page
    .locator(
      'button[guidedhelpid="new_menu_button"]:visible, button[aria-label="Mới"]:visible, button[aria-label="New"]:visible, [guidedhelpid="new_menu_button"]:visible'
    )
    .first();
  await newBtn.click();
  await page.waitForTimeout(500);

  const newFolderMenuItem = page
    .locator(
      '[role="menuitem"]:has-text("Thư mục mới"):visible, [role="menuitem"]:has-text("New folder"):visible'
    )
    .first();

  if (await newFolderMenuItem.isVisible().catch(() => false)) {
    await newFolderMenuItem.click();
  } else {
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

/**
 * Uploads local files into an open Google Drive student folder via "+ Mới" -> "Tải tệp lên".
 * Replaces any existing file with the same name so modified local files are never skipped.
 */
async function uploadFilesIntoDriveFolder(
  page: Page,
  studentDriveFolderId: string,
  localFilePaths: string[]
): Promise<number> {
  if (localFilePaths.length === 0) return 0;
  assertDriveNotStopped();

  await ensureGoogleDriveFolderReadyAndAuthenticated(page, studentDriveFolderId);
  const existingItems = await listDriveItemsOnPage(page, studentDriveFolderId);

  // If a file with the same basename already exists in this Drive folder, move the old file to trash first
  // so that modified local files (same name, new content) are always uploaded fresh.
  const targetLowerNames = new Set(
    localFilePaths.map((p) => path.basename(p).toLowerCase())
  );
  for (const item of existingItems) {
    if (!item.isFolder && targetLowerNames.has(item.name.toLowerCase())) {
      await moveDriveItemToTrash(page, item.id);
    }
  }

  assertDriveNotStopped();

  const newBtn = page
    .locator(
      'button[guidedhelpid="new_menu_button"]:visible, button[aria-label="Mới"]:visible, button[aria-label="New"]:visible, [guidedhelpid="new_menu_button"]:visible'
    )
    .first();

  const fcPromise = page.waitForEvent("filechooser", { timeout: 12000 });
  await newBtn.click();
  await page.waitForTimeout(500);

  const fileUploadMenuItem = page
    .locator(
      '[role="menuitem"]:has-text("Tải tệp lên"):visible, [role="menuitem"]:has-text("File upload"):visible'
    )
    .first();
  await fileUploadMenuItem.waitFor({ state: "visible", timeout: 8000 });
  await fileUploadMenuItem.click();

  const fileChooser = await fcPromise;
  await fileChooser.setFiles(localFilePaths);

  // Wait for all uploaded files to appear in the folder DOM (up to 45s)
  const expectedBaseNames = localFilePaths.map((p) => path.basename(p).toLowerCase());
  const uploadDeadline = Date.now() + 45_000;
  let verifiedAllPresent = false;

  while (Date.now() < uploadDeadline) {
    assertDriveNotStopped();
    await page.waitForTimeout(1200);
    const currentItems = await listDriveItemsOnPage(page, studentDriveFolderId);
    const currentNames = new Set(currentItems.map((i) => i.name.toLowerCase()));
    const allPresent = expectedBaseNames.every((name) => currentNames.has(name));
    if (allPresent) {
      verifiedAllPresent = true;
      break;
    }
  }

  if (!verifiedAllPresent) {
    throw new Error(
      `Không thể xác nhận đủ ${localFilePaths.length} tệp đã tải lên thư mục Google Drive sau 45 giây.`
    );
  }

  await page.waitForTimeout(800);
  return localFilePaths.length;
}

/**
 * Uploads a student's local directory (including subdirectories like `gui/`, `img/`, `image/`, `src/`)
 * into `targetDriveFolderId` preserving the exact folder structure without creating any synthetic `.zip`.
 */
async function uploadStudentDirectoryTreeToDrive(
  page: Page,
  targetDriveFolderId: string,
  localDirPath: string,
  studentId: string,
  fullName: string,
  depth = 0
): Promise<number> {
  assertDriveNotStopped();
  if (depth > MAX_DRIVE_TREE_DEPTH) {
    throw new Error(
      `Cấu trúc thư mục SPCK của '${fullName}' vượt quá độ sâu cho phép (${MAX_DRIVE_TREE_DEPTH} cấp): '${localDirPath}'.`
    );
  }
  const safeDir = assertPathAllowed(localDirPath);
  const directFiles = prepareStudentFilesForDriveUpload(safeDir, studentId, fullName);

  await ensureGoogleDriveFolderReadyAndAuthenticated(page, targetDriveFolderId);

  let totalUploaded = await uploadFilesIntoDriveFolder(
    page,
    targetDriveFolderId,
    directFiles
  );

  // Recursively recreate non-ignored subdirectories (e.g. `gui`, `img`, `image`, `assets`, `src`)
  const entries = fs
    .readdirSync(safeDir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));

  for (const entry of entries) {
    assertDriveNotStopped();
    if (!entry.isDirectory()) continue;
    if (IGNORED_SUBFOLDER_NAMES.has(entry.name.toLowerCase())) continue;

    const subLocalPath = assertPathAllowed(path.join(safeDir, entry.name));
    let st: fs.Stats;
    try {
      st = fs.lstatSync(subLocalPath);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;

    const subDriveFolderId = await findOrCreateDriveSubfolder(
      page,
      targetDriveFolderId,
      entry.name
    );
    totalUploaded += await uploadStudentDirectoryTreeToDrive(
      page,
      subDriveFolderId,
      subLocalPath,
      studentId,
      fullName,
      depth + 1
    );
  }

  if (depth === 0 && totalUploaded === 0) {
    throw new Error(
      `Thư mục SPCK của '${fullName}' không có tệp hợp lệ nào để tải lên Google Drive.`
    );
  }

  return totalUploaded;
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
    // strictly resolve the course subfolder (e.g. 2. PTA for VT-C4K-PTA12)
    let courseOrParentFolderId = inputFolderId;
    if (inputFolderId === CODING_SPCK_ROOT_FOLDER_ID) {
      const coursePrefix = detectCoursePrefixFromClassId(normalizedClassId);
      if (!coursePrefix || !CODING_SPCK_COURSE_FOLDER_MAP[coursePrefix]) {
        throw new Error(
          `Khóa học '${coursePrefix || normalizedClassId}' của lớp '${normalizedClassId}' chưa có thư mục khóa học cấu hình sẵn trong thư mục gốc Google Drive. Vui lòng dán trực tiếp link thư mục Google Drive riêng của lớp hoặc khóa học (hệ thống không tự chọn thư mục của môn khác để thay thế).`
        );
      }
      courseOrParentFolderId = CODING_SPCK_COURSE_FOLDER_MAP[coursePrefix];
    }

    const page = await BrowserManager.getInstance().getPage();

    await ensureGoogleDriveFolderReadyAndAuthenticated(page, courseOrParentFolderId);

    // Ensure class folder (e.g. VT-C4K-PTA12) exists inside the course folder
    const pageTitle = (await page.title().catch(() => "")).toUpperCase();
    let classDriveFolderId = courseOrParentFolderId;
    if (!pageTitle.includes(normalizedClassId)) {
      classDriveFolderId = await findOrCreateDriveSubfolder(
        page,
        courseOrParentFolderId,
        normalizedClassId
      );
    }

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

        const uploadedFilesCount = await uploadStudentDirectoryTreeToDrive(
          page,
          studentDriveFolderId,
          record.localFolderPath,
          record.studentId,
          fullName
        );

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

        const nextRecord: SpckUploadRecord = {
          ...latestDbRecord,
          relatedLinksJson: JSON.stringify(updatedLinks),
        };

        // Rule 4: Do NOT recompute contentHash here; if relatedLinksJson changed,
        // spckUploadRepo.upsert automatically downgrades APPROVED/VERIFIED -> WAITING_APPROVAL
        spckUploadRepo.upsert(nextRecord);

        jobLogRepo.add({
          jobId,
          jobType: "SPCK_DRIVE_UPLOAD",
          classId: normalizedClassId,
          studentId: record.studentId,
          level: "SUCCESS",
          message: `Đã tải ${uploadedFilesCount} file SPCK của '${fullName}' lên Google Drive (${studentDriveUrl}) và gắn vào Đường dẫn liên quan.`,
          detailsJson: JSON.stringify({
            studentDriveFolderId,
            studentDriveUrl,
            uploadedFilesCount,
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
