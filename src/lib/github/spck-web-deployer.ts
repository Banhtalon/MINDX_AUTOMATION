/**
 * MINDX AUTOMATION BOT - GITHUB PAGES WEB SPCK DEPLOYER
 * Automatically deploys student Web SPCK folders (HTML/CSS/JS/Assets) to the shared GitHub Pages repository
 * (`https://github.com/Banhtalon/WEB_PRODUCT_SHOW.git` -> `https://banhtalon.github.io/WEB_PRODUCT_SHOW/<classId>/<studentSlug>/`),
 * and attaches the live URL into `relatedLinksJson` ("Đường dẫn liên quan") in SQLite.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
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
  isCourseExemptFromSpck,
  MAX_SPCK_RELATED_LINKS,
  type SpckRelatedLink,
} from "../local-files/spck-scanner";
import { taskQueue } from "../queue/task-queue";
import { assertPathAllowed } from "../security/path-allowlist";
import { stripVietnameseDiacritics } from "../utils/vietnamese-match";

export const DEFAULT_SPCK_WEB_REPO_URL =
  "https://github.com/Banhtalon/WEB_PRODUCT_SHOW.git";

export const DEFAULT_SPCK_WEB_PAGES_BASE_URL =
  "https://banhtalon.github.io/WEB_PRODUCT_SHOW";

const SAFE_CLASS_ID_REGEX = /^[A-Z0-9_-]{2,80}$/;

const IGNORED_WEB_DIRS = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
  ".idea",
  ".vscode",
  "dist",
  "build",
  "_spck_app_shots",
  "_spck_owner_uploads",
  "_spck_youtube_frames",
  "_spck_prev_backup",
  "_spck_temp",
  "_portal_backups",
]);

const ALLOWED_WEB_ASSET_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".css",
  ".js",
  ".mjs",
  ".json",
  ".png",
  ".jpg",
  ".jpeg",
  ".jfif",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".bmp",
  ".avif",
  ".mp3",
  ".wav",
  ".ogg",
  ".mp4",
  ".webm",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".txt",
  ".text",
  ".md",
  ".csv",
  ".xml",
  ".glb",
  ".gltf",
  ".obj",
  ".mtl",
  ".pdf",
]);

const FORBIDDEN_SENSITIVE_FILENAME_REGEX =
  /^(?:credentials?|secrets?|tokens?|auth|private|id_rsa|id_ed25519|config\.local|package-lock|yarn\.lock|pnpm-lock|service[-_]?account|\..*)/i;

const FORBIDDEN_JSON_CONTENT_REGEX =
  /"(?:private_key|client_secret|api_key|gemini_api_key|lms_password|teaching_password|access_token|refresh_token|secret_key)"\s*:/i;

export interface SpckWebDeployStudentResult {
  studentId: string;
  fullName: string;
  status: "SUCCESS" | "SKIPPED_NO_HTML" | "FAILED";
  skippedUnchanged?: boolean;
  liveWebUrl?: string;
  entryHtmlFile?: string;
  copiedFilesCount: number;
  errorMessage?: string;
}

export interface SpckWebDeployBatchResult {
  classId: string;
  repoUrl: string;
  pagesBaseUrl: string;
  totalRequested: number;
  successCount?: number;
  deployedStudentsCount: number;
  skippedUnchangedCount?: number;
  skippedNoHtmlCount: number;
  failedStudentsCount: number;
  results: SpckWebDeployStudentResult[];
}

export interface SpckWebDeployOptions {
  classId: string;
  repoUrl?: string;
  studentIds?: string[];
  sessionNumber?: SpckSessionNumber;
  syncAllUnverifiedSessions?: boolean;
  forceReupload?: boolean;
  forceRedeploy?: boolean;
}

function isEmergencyStopped(): boolean {
  return (
    taskQueue.getStatus().isStopped ||
    (process as any)?.__mindxQueueStopped === true
  );
}

function assertEmergencyNotStopped(): void {
  if (isEmergencyStopped()) {
    throw new Error("Đã dừng tác vụ triển khai Web SPCK theo lệnh Dừng khẩn cấp (Stop Bot).");
  }
}

/**
 * Verifies that `targetPath` resolves strictly inside `baseDir` and contains no symlink/junction components.
 */
export function assertInsideDirectory(baseDir: string, targetPath: string): string {
  const resolvedBase = fs.existsSync(baseDir)
    ? fs.realpathSync(baseDir)
    : path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);

  const normBase =
    process.platform === "win32" ? resolvedBase.toLowerCase() : resolvedBase;
  const normTarget =
    process.platform === "win32" ? resolvedTarget.toLowerCase() : resolvedTarget;

  if (
    normTarget !== normBase &&
    !normTarget.startsWith(normBase + path.sep.toLowerCase())
  ) {
    throw new Error(
      `[Security Exception] Đường dẫn đích '${targetPath}' nằm ngoài thư mục cho phép '${baseDir}'.`
    );
  }

  // Ensure no existing segment between baseDir and targetPath is a symlink/junction
  const rel = path.relative(resolvedBase, resolvedTarget);
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
    const parts = rel.split(path.sep).filter(Boolean);
    let cur = resolvedBase;
    for (const part of parts) {
      cur = path.join(cur, part);
      if (fs.existsSync(cur)) {
        const st = fs.lstatSync(cur);
        if (st.isSymbolicLink()) {
          throw new Error(
            `[Security Exception] Phát hiện symlink/junction không an toàn tại '${cur}'.`
          );
        }
        const realCur = fs.realpathSync(cur);
        const normRealCur =
          process.platform === "win32" ? realCur.toLowerCase() : realCur;
        if (
          normRealCur !== normBase &&
          !normRealCur.startsWith(normBase + path.sep.toLowerCase())
        ) {
          throw new Error(
            `[Security Exception] Đường dẫn thực tế '${realCur}' thoát khỏi thư mục gốc '${resolvedBase}'.`
          );
        }
      }
    }
  }

  return resolvedTarget;
}

/**
 * Derives the GitHub Pages base URL (`https://<owner>.github.io/<repo>`) from a GitHub repository URL.
 */
export function deriveGithubPagesBaseUrl(repoUrl: string): string {
  const trimmed = String(repoUrl || "").trim();
  const match = trimmed.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?/i);
  if (!match) {
    return DEFAULT_SPCK_WEB_PAGES_BASE_URL;
  }
  const owner = match[1].toLowerCase();
  const repo = match[2];
  return `https://${owner}.github.io/${repo}`;
}

/**
 * Converts a student full name or ID into a clean URL-safe folder slug (e.g. "Hà Nhật Minh" -> "Ha-Nhat-Minh").
 * If `disambiguateWithId` is true, appends a safe studentId suffix so two students with the same name never collide.
 */
export function buildStudentWebFolderSlug(
  fullName: string,
  fallbackId: string,
  disambiguateWithId = false
): string {
  const ascii = stripVietnameseDiacritics(fullName || fallbackId)
    .replace(/[^a-zA-Z0-9\s_-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-");
  const safeId = String(fallbackId || "stu")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/^-+|-+$/g, "");
  const baseSlug = ascii || safeId || "student";
  if (disambiguateWithId && safeId) {
    return `${baseSlug}-${safeId}`;
  }
  return baseSlug;
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

function isSafeWebAssetFile(filePath: string, fileName: string, size: number): boolean {
  if (size < 0 || size > 25 * 1024 * 1024) return false;
  if (fileName.startsWith(".")) return false;
  if (Buffer.byteLength(fileName, "utf8") > 240) return false;

  const lower = fileName.toLowerCase();
  if (
    lower === "links.txt" ||
    lower === "link.txt" ||
    lower === "default-spck-thumbnail.png" ||
    lower === "portal_unconfirmed.json" ||
    lower.startsWith("_spck_") ||
    lower.startsWith("_portal_") ||
    /^app_\d+_.*_[a-f0-9]{6}(?:_[a-z0-9]+)?\.(?:png|jpe?g|webp)$/i.test(lower) ||
    /^yt_frame_\d+.*\.(?:png|jpe?g|webp)$/i.test(lower)
  ) {
    return false;
  }

  const parsed = path.parse(lower);
  const ext = parsed.ext.toLowerCase();
  if (!ALLOWED_WEB_ASSET_EXTENSIONS.has(ext)) {
    return false;
  }

  if (
    FORBIDDEN_SENSITIVE_FILENAME_REGEX.test(parsed.name) ||
    FORBIDDEN_SENSITIVE_FILENAME_REGEX.test(lower)
  ) {
    return false;
  }

  if (ext === ".json") {
    if (/credential|secret|token|auth|key|cookie|session|account|password|firebase/i.test(lower)) {
      return false;
    }
    try {
      if (size <= 512 * 1024) {
        const content = fs.readFileSync(filePath, "utf-8");
        if (FORBIDDEN_JSON_CONTENT_REGEX.test(content)) {
          return false;
        }
      }
    } catch {
      return false;
    }
  }

  return true;
}

/**
 * Finds the entry `.html` file inside a student's local SPCK folder (either in the root folder
 * or 1 level deep inside a subfolder), while always preserving `safeRoot` as `projectRootDir`
 * so relative paths like `../assets/hero.png` remain intact.
 */
export function findStudentWebRootAndEntryHtml(studentLocalFolder: string): {
  projectRootDir: string;
  webRootDir: string;
  entryRelativePath: string;
  htmlFiles: string[];
} | null {
  const safeRoot = assertPathAllowed(studentLocalFolder);
  if (!fs.existsSync(safeRoot) || !fs.statSync(safeRoot).isDirectory()) {
    return null;
  }

  const listHtmlFilesInDir = (dir: string): string[] => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && !e.name.startsWith(".") && /\.html?$/i.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => {
        if (a.toLowerCase() === "index.html") return -1;
        if (b.toLowerCase() === "index.html") return 1;
        return a.localeCompare(b, "en");
      });
  };

  const rootHtml = listHtmlFilesInDir(safeRoot);
  if (rootHtml.length > 0) {
    return {
      projectRootDir: safeRoot,
      webRootDir: safeRoot,
      entryRelativePath: rootHtml[0],
      htmlFiles: rootHtml,
    };
  }

  // Check subdirectories up to 3 levels deep (preferring index.html / main.html / home.html)
  const listSubDirs = (dir: string): fs.Dirent[] =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(
        (e) =>
          e.isDirectory() &&
          !e.name.startsWith(".") &&
          !e.name.toLowerCase().startsWith("_spck_") &&
          !IGNORED_WEB_DIRS.has(e.name.toLowerCase())
      )
      .sort((a, b) => a.name.localeCompare(b.name, "en"));

  const subDirs = listSubDirs(safeRoot);
  for (const sub of subDirs) {
    const subPath = assertPathAllowed(path.join(safeRoot, sub.name));
    const subHtml = listHtmlFilesInDir(subPath);
    if (subHtml.length > 0) {
      return {
        projectRootDir: safeRoot,
        webRootDir: safeRoot,
        entryRelativePath: `${sub.name}/${subHtml[0]}`,
        htmlFiles: subHtml,
      };
    }
  }

  // Check 2–3 levels deep when HTML files are organized inside nested folders (e.g. `html/main/index.html`)
  const nestedCandidates: Array<{ relDir: string; htmlFiles: string[]; hasIndex: boolean; isMainDir: boolean }> = [];
  const walkNestedDirs = (curDir: string, relPrefix: string, depth: number) => {
    if (depth > 3) return;
    let children: fs.Dirent[] = [];
    try {
      children = listSubDirs(curDir);
    } catch {
      return;
    }
    for (const child of children) {
      const childPath = assertPathAllowed(path.join(curDir, child.name));
      const childRel = `${relPrefix}/${child.name}`;
      const htmlList = listHtmlFilesInDir(childPath);
      if (htmlList.length > 0) {
        nestedCandidates.push({
          relDir: childRel,
          htmlFiles: htmlList,
          hasIndex: htmlList[0].toLowerCase() === "index.html",
          isMainDir: /(?:^|\/)(?:main|home|index)(?:$|\/)/i.test(childRel),
        });
      }
      walkNestedDirs(childPath, childRel, depth + 1);
    }
  };
  for (const sub of subDirs) {
    const subPath = assertPathAllowed(path.join(safeRoot, sub.name));
    walkNestedDirs(subPath, sub.name, 2);
  }
  if (nestedCandidates.length > 0) {
    nestedCandidates.sort((a, b) => {
      if (a.hasIndex !== b.hasIndex) return a.hasIndex ? -1 : 1;
      if (a.isMainDir !== b.isMainDir) return a.isMainDir ? -1 : 1;
      return a.relDir.localeCompare(b.relDir, "en");
    });
    const best = nestedCandidates[0];
    return {
      projectRootDir: safeRoot,
      webRootDir: safeRoot,
      entryRelativePath: `${best.relDir}/${best.htmlFiles[0]}`,
      htmlFiles: best.htmlFiles,
    };
  }

  return null;
}

/**
 * Copies static web assets recursively from `srcDir` into `destDir` while skipping ignored/sensitive files.
 */
function copyWebDirectoryRecursive(
  srcDir: string,
  destDir: string,
  allowedDestBaseDir: string
): number {
  assertEmergencyNotStopped();
  const safeSrc = assertPathAllowed(srcDir);
  const safeDest = assertInsideDirectory(allowedDestBaseDir, destDir);
  fs.mkdirSync(safeDest, { recursive: true });
  let copiedCount = 0;

  const entries = fs.readdirSync(safeSrc, { withFileTypes: true });
  for (const entry of entries) {
    assertEmergencyNotStopped();
    if (entry.name.startsWith(".")) continue;
    const lowerName = entry.name.toLowerCase();

    const srcPath = assertPathAllowed(path.join(safeSrc, entry.name));
    const destPath = assertInsideDirectory(allowedDestBaseDir, path.join(safeDest, entry.name));

    let st: fs.Stats;
    try {
      st = fs.lstatSync(srcPath);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;

    if (st.isDirectory()) {
      if (lowerName.startsWith("_spck_") || IGNORED_WEB_DIRS.has(lowerName)) continue;
      copiedCount += copyWebDirectoryRecursive(srcPath, destPath, allowedDestBaseDir);
    } else if (st.isFile() && isSafeWebAssetFile(srcPath, entry.name, st.size)) {
      fs.copyFileSync(srcPath, destPath);
      copiedCount++;
    }
  }

  return copiedCount;
}

const NON_INTERACTIVE_GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GCM_INTERACTIVE: "never",
  GIT_TERMINAL_PROMPT: "0",
};

function runGitCommand(args: string[], cwd: string, timeoutMs = 60_000): string {
  assertEmergencyNotStopped();
  return execFileSync(
    "git",
    ["-c", "core.longpaths=true", "-c", "safe.directory=*", ...args],
    {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      env: NON_INTERACTIVE_GIT_ENV,
    }
  ).trim();
}

function resolveWebDeployWorkParent(): string {
  if (process.env.MINDX_DB_PATH) {
    return path.join(path.dirname(path.resolve(process.env.MINDX_DB_PATH)), "_spck_web_work");
  }
  return path.resolve(process.cwd(), "temp_submissions");
}

/**
 * Prepares the local clone of the target GitHub Pages repository inside `temp_submissions/_github_pages_repo`.
 */
function ensureLocalGitRepoReady(repoUrl: string): string {
  assertEmergencyNotStopped();
  const workParent = resolveWebDeployWorkParent();
  fs.mkdirSync(workParent, { recursive: true });
  const repoDir = assertInsideDirectory(workParent, path.join(workParent, "_github_pages_repo"));

  const cloneFreshRepo = () => {
    assertEmergencyNotStopped();
    if (fs.existsSync(repoDir)) {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
    execFileSync(
      "git",
      [
        "-c",
        "core.longpaths=true",
        "-c",
        "safe.directory=*",
        "clone",
        "--config",
        "core.longpaths=true",
        repoUrl,
        repoDir,
      ],
      {
        cwd: workParent,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000,
        env: NON_INTERACTIVE_GIT_ENV,
      }
    );
  };

  if (fs.existsSync(path.join(repoDir, ".git"))) {
    try {
      const currentRemote = runGitCommand(["remote", "get-url", "origin"], repoDir);
      if (currentRemote.toLowerCase() !== repoUrl.toLowerCase()) {
        fs.rmSync(repoDir, { recursive: true, force: true });
      }
    } catch {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  }

  if (!fs.existsSync(path.join(repoDir, ".git"))) {
    cloneFreshRepo();
  } else {
    const indexLockPath = assertInsideDirectory(
      repoDir,
      path.join(repoDir, ".git", "index.lock")
    );
    if (fs.existsSync(indexLockPath)) {
      fs.rmSync(indexLockPath, { force: true });
    }
    runGitCommand(["config", "core.longpaths", "true"], repoDir);

    const lsRemote = runGitCommand(["ls-remote", "--heads", "origin", "main"], repoDir, 60_000);
    if (lsRemote.length > 0) {
      try {
        runGitCommand(["fetch", "origin", "main"], repoDir, 120_000);
        runGitCommand(["reset", "--hard", "origin/main"], repoDir, 60_000);
        runGitCommand(["clean", "-fd"], repoDir, 60_000);
      } catch {
        cloneFreshRepo();
      }
    }
  }

  // Ensure .nojekyll exists so GitHub Pages serves all subfolders without Jekyll filtering
  const nojekyllPath = assertInsideDirectory(repoDir, path.join(repoDir, ".nojekyll"));
  if (!fs.existsSync(nojekyllPath)) {
    fs.writeFileSync(nojekyllPath, "");
  }

  return repoDir;
}

/**
 * Ensures root `index.html` exists with exact lowercase filename on disk, or writes a clean redirect wrapper
 * when the student's entry HTML resides in a subdirectory (preserving `../assets/...` relative paths).
 */
function ensureRootIndexHtmlEntry(
  stagingStudentDir: string,
  entryRelativePath: string,
  allowedBaseDir: string
): void {
  const normalizedRel = entryRelativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const isSubdirEntry = normalizedRel.includes("/");
  const exactIndexPath = assertInsideDirectory(
    allowedBaseDir,
    path.join(stagingStudentDir, "index.html")
  );

  // Check if root has a case-variant like `INDEX.HTML` or `Index.html` on case-insensitive Windows FS
  const rootEntries = fs.readdirSync(stagingStudentDir);
  const existingCaseVariant = rootEntries.find(
    (name) => name.toLowerCase() === "index.html" && name !== "index.html"
  );
  if (existingCaseVariant) {
    const variantPath = assertInsideDirectory(
      allowedBaseDir,
      path.join(stagingStudentDir, existingCaseVariant)
    );
    const tmpPath = assertInsideDirectory(
      allowedBaseDir,
      path.join(stagingStudentDir, "__index_case_fix__.html")
    );
    fs.renameSync(variantPath, tmpPath);
    fs.renameSync(tmpPath, exactIndexPath);
  }

  if (rootEntries.some((name) => name.toLowerCase() === "index.html")) {
    return;
  }

  if (!isSubdirEntry) {
    const srcPrimary = assertInsideDirectory(
      allowedBaseDir,
      path.join(stagingStudentDir, normalizedRel)
    );
    if (fs.existsSync(srcPrimary)) {
      fs.copyFileSync(srcPrimary, exactIndexPath);
    }
    return;
  }

  // Subdirectory entry (e.g. `pages/index.html`): create a lightweight redirect at root
  // so the browser navigates into `./pages/index.html` and resolves `../assets/...` accurately.
  const encodedRel = normalizedRel
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  const redirectHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="refresh" content="0; url=./${encodedRel}" />
  <title>Redirecting to SPCK Web...</title>
  <script>window.location.replace("./${encodedRel}");</script>
</head>
<body>
  <p>Đang mở sản phẩm: <a href="./${encodedRel}">${normalizedRel}</a></p>
</body>
</html>
`;
  fs.writeFileSync(exactIndexPath, redirectHtml, "utf-8");
}

export class SpckWebDeployer {
  /**
   * Deploys student Web SPCK folders to GitHub Pages (`Banhtalon/WEB_PRODUCT_SHOW`) and attaches live links into SQLite.
   */
  public static async deployClassWebSpckToGithubPages(
    options: SpckWebDeployOptions
  ): Promise<SpckWebDeployBatchResult> {
    const normalizedClassId = (options.classId || "").trim().toUpperCase();
    if (!normalizedClassId) {
      throw new Error("[SpckWebDeployer] Thiếu mã lớp (classId).");
    }
    if (!SAFE_CLASS_ID_REGEX.test(normalizedClassId)) {
      throw new Error(
        `[Security Exception] Mã lớp '${normalizedClassId}' chứa ký tự không hợp lệ.`
      );
    }
    if (isCourseExemptFromSpck(normalizedClassId)) {
      throw new Error(
        `Khóa học của lớp '${normalizedClassId}' không thi cuối khóa nên được miễn triển khai Web SPCK.`
      );
    }

    const repoUrl = (options.repoUrl || DEFAULT_SPCK_WEB_REPO_URL).trim();
    const pagesBaseUrl = deriveGithubPagesBaseUrl(repoUrl);
    const jobId = `DEPLOY_SPCK_WEB_${normalizedClassId}_${Date.now()}`;

    const allClassRecords = spckUploadRepo.findByClass(normalizedClassId);
    const targetRecords =
      options.studentIds && options.studentIds.length > 0
        ? allClassRecords.filter((r) => options.studentIds!.includes(r.studentId))
        : allClassRecords.filter((r) => Boolean(r.localFolderPath));

    if (targetRecords.length === 0) {
      return {
        classId: normalizedClassId,
        repoUrl,
        pagesBaseUrl,
        totalRequested: 0,
        successCount: 0,
        deployedStudentsCount: 0,
        skippedUnchangedCount: 0,
        skippedNoHtmlCount: 0,
        failedStudentsCount: 0,
        results: [],
      };
    }

    const studentsInClass = studentRepo.findByClass(normalizedClassId);
    const studentMap = new Map(studentsInClass.map((s) => [s.studentId, s]));
    const forceDeploy = Boolean(options.forceReupload || options.forceRedeploy);

    const syncWebLinkSessionsIfNeeded = (studentId: string) => {
      if (options.syncAllUnverifiedSessions) {
        for (const slot of [12, 13, 14] as const) {
          try {
            const sessRow = spckSessionRepo.findOne(normalizedClassId, studentId, slot);
            if (
              !sessRow ||
              sessRow.lastVerifiedAt ||
              sessRow.draftStatus === "VERIFIED" ||
              sessRow.draftStatus === "SAVING" ||
              sessRow.draftStatus === "APPROVED"
            ) {
              continue;
            }
            const sessLinks = parseJsonArraySafe<SpckRelatedLink>(sessRow.relatedLinksJson);
            const hasPagesInSess = sessLinks.some((l) =>
              String(l.url || "").includes(".github.io/")
            );
            if (!hasPagesInSess) {
              spckSessionRepo.syncLatestSharedResourcesToSessionDraft(
                normalizedClassId,
                studentId,
                slot
              );
            }
          } catch {}
        }
      } else if (options.sessionNumber) {
        try {
          const sessRow = spckSessionRepo.findOne(
            normalizedClassId,
            studentId,
            options.sessionNumber
          );
          if (
            sessRow &&
            !sessRow.lastVerifiedAt &&
            sessRow.draftStatus !== "VERIFIED" &&
            sessRow.draftStatus !== "SAVING"
          ) {
            const sessLinks = parseJsonArraySafe<SpckRelatedLink>(sessRow.relatedLinksJson);
            const hasPagesInSess = sessLinks.some((l) =>
              String(l.url || "").includes(".github.io/")
            );
            if (!hasPagesInSess) {
              spckSessionRepo.syncLatestSharedResourcesToSessionDraft(
                normalizedClassId,
                studentId,
                options.sessionNumber
              );
            }
          }
        } catch {}
      }
    };

    const results: SpckWebDeployStudentResult[] = [];
    let skippedNoHtmlCount = 0;
    let skippedUnchangedCount = 0;
    let failedStudentsCount = 0;

    // Pre-validate, locate HTML entry points, and fast-skip unchanged students (< 10ms) BEFORE touching Git
    const htmlReadyTargets: Array<{
      record: SpckUploadRecord;
      fullName: string;
      webInfo: NonNullable<ReturnType<typeof findStudentWebRootAndEntryHtml>>;
    }> = [];

    for (const record of targetRecords) {
      assertEmergencyNotStopped();
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
        const webInfo = findStudentWebRootAndEntryHtml(record.localFolderPath);
        if (!webInfo) {
          skippedNoHtmlCount++;
          results.push({
            studentId: record.studentId,
            fullName,
            status: "SKIPPED_NO_HTML",
            copiedFilesCount: 0,
            errorMessage: "Thư mục dự án không có file .html để tạo Link Web Live.",
          });
          continue;
        }

        if (!forceDeploy) {
          const existingLinks = parseJsonArraySafe<SpckRelatedLink>(record.relatedLinksJson);
          const existingPagesLink = existingLinks.find((l) =>
            String(l.url || "").includes(".github.io/")
          );
          if (existingPagesLink?.url && record.lastWebDeployedDigest) {
            const digestInfo = computeStudentFolderContentDigest(record.localFolderPath);
            if (
              digestInfo.readableDirectory &&
              digestInfo.filesCount > 0 &&
              digestInfo.digest &&
              digestInfo.digest === record.lastWebDeployedDigest
            ) {
              syncWebLinkSessionsIfNeeded(record.studentId);
              skippedUnchangedCount++;
              results.push({
                studentId: record.studentId,
                fullName,
                status: "SUCCESS",
                skippedUnchanged: true,
                liveWebUrl: existingPagesLink.url,
                entryHtmlFile: webInfo.entryRelativePath,
                copiedFilesCount: 0,
              });
              continue;
            }
          }
        }

        htmlReadyTargets.push({ record, fullName, webInfo });
      } catch (err) {
        failedStudentsCount++;
        results.push({
          studentId: record.studentId,
          fullName,
          status: "FAILED",
          copiedFilesCount: 0,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (htmlReadyTargets.length === 0) {
      return {
        classId: normalizedClassId,
        repoUrl,
        pagesBaseUrl,
        totalRequested: targetRecords.length,
        successCount: skippedUnchangedCount,
        deployedStudentsCount: 0,
        skippedUnchangedCount,
        skippedNoHtmlCount,
        failedStudentsCount,
        results,
      };
    }

    // Detect duplicate base slugs across the class roster + records
    const baseSlugOwners = new Map<string, Set<string>>();
    const registerSlugCandidate = (stuId: string, name: string) => {
      const slug = buildStudentWebFolderSlug(name, stuId, false).toLowerCase();
      if (!baseSlugOwners.has(slug)) {
        baseSlugOwners.set(slug, new Set());
      }
      baseSlugOwners.get(slug)!.add(stuId);
    };
    for (const s of studentsInClass) {
      registerSlugCandidate(s.studentId, s.fullName);
    }
    for (const r of allClassRecords) {
      const s = studentMap.get(r.studentId);
      registerSlugCandidate(r.studentId, s?.fullName || r.studentId);
    }

    const repoDir = ensureLocalGitRepoReady(repoUrl);
    const classWebDir = assertInsideDirectory(repoDir, path.join(repoDir, normalizedClassId));
    fs.mkdirSync(classWebDir, { recursive: true });

    // Load or initialize persistent slug -> studentId map inside classWebDir so separate runs never collide
    const slugMapPath = assertInsideDirectory(
      classWebDir,
      path.join(classWebDir, ".mindx-students.json")
    );
    let persistedSlugOwners: Record<string, string> = {};
    if (fs.existsSync(slugMapPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(slugMapPath, "utf-8"));
        if (parsed && typeof parsed === "object") {
          persistedSlugOwners = parsed;
        }
      } catch {
        persistedSlugOwners = {};
      }
    }

    const workParent = resolveWebDeployWorkParent();
    fs.mkdirSync(workParent, { recursive: true });
    const stagingBaseDir = assertInsideDirectory(
      workParent,
      path.join(workParent, `_web_stage_${Date.now()}`)
    );
    fs.mkdirSync(stagingBaseDir, { recursive: true });

    const deployedQueue: Array<{
      record: SpckUploadRecord;
      fullName: string;
      studentSlug: string;
      relGitPath: string;
      liveWebUrl: string;
      entryHtmlFile: string;
      copiedFilesCount: number;
    }> = [];

    try {
      for (const targetItem of htmlReadyTargets) {
        assertEmergencyNotStopped();
        const { record, fullName, webInfo } = targetItem;

        try {
          const baseSlug = buildStudentWebFolderSlug(fullName, record.studentId, false);
          const lowerBaseSlug = baseSlug.toLowerCase();
          const ownersSet = baseSlugOwners.get(lowerBaseSlug);
          const existingPersistedOwner = persistedSlugOwners[lowerBaseSlug];
          const hasCollision =
            (ownersSet && ownersSet.size > 1) ||
            (Boolean(existingPersistedOwner) && existingPersistedOwner !== record.studentId);

          const studentSlug = buildStudentWebFolderSlug(
            fullName,
            record.studentId,
            hasCollision
          );

          // Stage into temporary directory first so a partial failure never corrupts the live repo
          const stageStudentDir = assertInsideDirectory(
            stagingBaseDir,
            path.join(stagingBaseDir, studentSlug)
          );
          if (fs.existsSync(stageStudentDir)) {
            fs.rmSync(stageStudentDir, { recursive: true, force: true });
          }
          fs.mkdirSync(stageStudentDir, { recursive: true });

          const copiedFilesCount = copyWebDirectoryRecursive(
            webInfo.projectRootDir,
            stageStudentDir,
            stagingBaseDir
          );

          if (copiedFilesCount === 0) {
            throw new Error(
              `Không có tệp tài nguyên Web hợp lệ nào được sao chép cho '${fullName}'.`
            );
          }

          ensureRootIndexHtmlEntry(
            stageStudentDir,
            webInfo.entryRelativePath,
            stagingBaseDir
          );

          // Swap staged directory into repo destination atomically
          const destStudentDir = assertInsideDirectory(
            classWebDir,
            path.join(classWebDir, studentSlug)
          );
          if (fs.existsSync(destStudentDir)) {
            fs.rmSync(destStudentDir, { recursive: true, force: true });
          }
          fs.mkdirSync(destStudentDir, { recursive: true });
          copyWebDirectoryRecursive(stageStudentDir, destStudentDir, classWebDir);

          persistedSlugOwners[studentSlug.toLowerCase()] = record.studentId;

          const liveWebUrl = `${pagesBaseUrl}/${encodeURIComponent(
            normalizedClassId
          )}/${encodeURIComponent(studentSlug)}/`;

          deployedQueue.push({
            record,
            fullName,
            studentSlug,
            relGitPath: `${normalizedClassId}/${studentSlug}`,
            liveWebUrl,
            entryHtmlFile: webInfo.entryRelativePath,
            copiedFilesCount,
          });
        } catch (err) {
          failedStudentsCount++;
          results.push({
            studentId: record.studentId,
            fullName,
            status: "FAILED",
            copiedFilesCount: 0,
            errorMessage: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } finally {
      if (fs.existsSync(stagingBaseDir)) {
        fs.rmSync(stagingBaseDir, { recursive: true, force: true });
      }
    }

    if (deployedQueue.length > 0) {
      assertEmergencyNotStopped();
      fs.writeFileSync(slugMapPath, JSON.stringify(persistedSlugOwners, null, 2), "utf-8");

      const pathsToStage = [
        ".nojekyll",
        `${normalizedClassId}/.mindx-students.json`,
        ...deployedQueue.map((item) => item.relGitPath),
      ];
      runGitCommand(["add", "-A", "--", ...pathsToStage], repoDir);

      const statusOut = runGitCommand(
        ["status", "--porcelain", "--", ...pathsToStage],
        repoDir
      );
      if (statusOut.trim().length > 0) {
        runGitCommand(
          [
            "-c",
            "user.name=MindX Automation Bot",
            "-c",
            "user.email=bot@mindx.local",
            "commit",
            "-m",
            `Deploy SPCK Web class ${normalizedClassId} (${deployedQueue.length} students)`,
          ],
          repoDir
        );

        assertEmergencyNotStopped();
        try {
          runGitCommand(["push", "origin", "HEAD:main"], repoDir, 180_000);
        } catch (pushErr) {
          const pushMsg = pushErr instanceof Error ? pushErr.message : String(pushErr);
          const lowerPush = pushMsg.toLowerCase();
          if (
            lowerPush.includes("authentication failed") ||
            lowerPush.includes("could not read username") ||
            lowerPush.includes("logon failed") ||
            lowerPush.includes("permission to") ||
            lowerPush.includes(" 403") ||
            lowerPush.includes("requested url returned error: 403") ||
            lowerPush.includes("credential")
          ) {
            throw new Error(
              `Chưa đăng nhập GitHub để đẩy Web SPCK lên kho (${repoUrl}). Khi bấm đẩy lại, vui lòng bấm "Sign in with your browser" (tài khoản Banhtalon) trên cửa sổ GitHub Sign in rồi thử lại.`
            );
          }
          throw pushErr;
        }
      }

      // Update SQLite relatedLinksJson + lastWebDeployedDigest for all deployed students
      for (const item of deployedQueue) {
        const latestDbRecord = spckUploadRepo.findOne(
          normalizedClassId,
          item.record.studentId
        );
        if (
          !latestDbRecord ||
          latestDbRecord.localFolderPath !== item.record.localFolderPath
        ) {
          failedStudentsCount++;
          results.push({
            studentId: item.record.studentId,
            fullName: item.fullName,
            status: "FAILED",
            copiedFilesCount: 0,
            errorMessage:
              "Bản ghi SPCK của học viên đã thay đổi thư mục trong lúc triển khai Web. Đã bỏ qua cập nhật link.",
          });
          continue;
        }

        const existingLinks = parseJsonArraySafe<SpckRelatedLink>(
          latestDbRecord.relatedLinksJson
        );
        const nonPagesLinks = existingLinks.filter(
          (l) => !String(l.url || "").includes(".github.io/")
        );
        const updatedLinks: SpckRelatedLink[] = [
          {
            name: `Link Web Chạy Thử (${item.fullName})`.slice(0, 80),
            url: item.liveWebUrl,
          },
          ...nonPagesLinks,
        ];
        if (updatedLinks.length > MAX_SPCK_RELATED_LINKS) {
          failedStudentsCount++;
          results.push({
            studentId: item.record.studentId,
            fullName: item.fullName,
            status: "FAILED",
            copiedFilesCount: 0,
            errorMessage: `Không thể tự động thêm Link Web Chạy Thử cho '${item.fullName}' vì danh sách Đường dẫn liên quan đã đạt tối đa ${MAX_SPCK_RELATED_LINKS} link trên LMS. Vui lòng xóa bớt 1 link trước.`,
          });
          continue;
        }

        const postDeployDigest = computeStudentFolderContentDigest(
          item.record.localFolderPath || ""
        );

        // Rule 4: Update shared resource pool without overwriting session submission history
        spckUploadRepo.updateSharedResources(
          normalizedClassId,
          item.record.studentId,
          {
            relatedLinksJson: JSON.stringify(updatedLinks),
            lastWebDeployedDigest:
              postDeployDigest.readableDirectory && postDeployDigest.filesCount > 0
                ? postDeployDigest.digest
                : "",
            syncSessionNumber: options.sessionNumber,
            syncAllUnverifiedSessions: options.syncAllUnverifiedSessions,
          },
          item.record.localFolderPath
        );

        jobLogRepo.add({
          jobId,
          jobType: "UPLOAD_SPCK",
          classId: normalizedClassId,
          studentId: item.record.studentId,
          level: "SUCCESS",
          message: `Đã đẩy Web SPCK của '${item.fullName}' lên GitHub Pages (${item.liveWebUrl}) và gắn vào Đường dẫn liên quan.`,
          detailsJson: JSON.stringify({
            liveWebUrl: item.liveWebUrl,
            copiedFilesCount: item.copiedFilesCount,
          }),
        });

        results.push({
          studentId: item.record.studentId,
          fullName: item.fullName,
          status: "SUCCESS",
          liveWebUrl: item.liveWebUrl,
          entryHtmlFile: item.entryHtmlFile,
          copiedFilesCount: item.copiedFilesCount,
        });
      }
    }

    const totalSuccessCount = results.filter((r) => r.status === "SUCCESS").length;
    const newlyDeployedCount = results.filter(
      (r) => r.status === "SUCCESS" && !r.skippedUnchanged
    ).length;

    return {
      classId: normalizedClassId,
      repoUrl,
      pagesBaseUrl,
      totalRequested: targetRecords.length,
      successCount: totalSuccessCount,
      deployedStudentsCount: newlyDeployedCount,
      skippedUnchangedCount,
      skippedNoHtmlCount,
      failedStudentsCount,
      results,
    };
  }
}
