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
  deployedStudentsCount: number;
  skippedNoHtmlCount: number;
  failedStudentsCount: number;
  results: SpckWebDeployStudentResult[];
}

export interface SpckWebDeployOptions {
  classId: string;
  repoUrl?: string;
  studentIds?: string[];
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
  if (size <= 0 || size > 25 * 1024 * 1024) return false;
  if (fileName.startsWith(".")) return false;

  const lower = fileName.toLowerCase();
  if (lower === "links.txt" || lower === "link.txt") return false;

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

  // Check 1 level of subdirectories
  const subDirs = fs
    .readdirSync(safeRoot, { withFileTypes: true })
    .filter(
      (e) =>
        e.isDirectory() &&
        !e.name.startsWith(".") &&
        !IGNORED_WEB_DIRS.has(e.name.toLowerCase())
    )
    .sort((a, b) => a.name.localeCompare(b.name, "en"));

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
      if (IGNORED_WEB_DIRS.has(lowerName)) continue;
      copiedCount += copyWebDirectoryRecursive(srcPath, destPath, allowedDestBaseDir);
    } else if (st.isFile() && isSafeWebAssetFile(srcPath, entry.name, st.size)) {
      fs.copyFileSync(srcPath, destPath);
      copiedCount++;
    }
  }

  return copiedCount;
}

function runGitCommand(args: string[], cwd: string): string {
  assertEmergencyNotStopped();
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  }).trim();
}

/**
 * Prepares the local clone of the target GitHub Pages repository inside `temp_submissions/_github_pages_repo`.
 */
function ensureLocalGitRepoReady(repoUrl: string): string {
  assertEmergencyNotStopped();
  const workParent = path.resolve(process.cwd(), "temp_submissions");
  fs.mkdirSync(workParent, { recursive: true });
  const repoDir = assertInsideDirectory(workParent, path.join(workParent, "_github_pages_repo"));

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
    if (fs.existsSync(repoDir)) {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
    execFileSync("git", ["clone", repoUrl, repoDir], {
      cwd: workParent,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
  } else {
    const lsRemote = runGitCommand(["ls-remote", "--heads", "origin", "main"], repoDir);
    if (lsRemote.length > 0) {
      runGitCommand(["fetch", "origin", "main"], repoDir);
      runGitCommand(["reset", "--hard", "origin/main"], repoDir);
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
        deployedStudentsCount: 0,
        skippedNoHtmlCount: 0,
        failedStudentsCount: 0,
        results: [],
      };
    }

    const studentsInClass = studentRepo.findByClass(normalizedClassId);
    const studentMap = new Map(studentsInClass.map((s) => [s.studentId, s]));

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

    const workParent = path.resolve(process.cwd(), "temp_submissions");
    const stagingBaseDir = assertInsideDirectory(
      workParent,
      path.join(workParent, `_web_stage_${Date.now()}`)
    );
    fs.mkdirSync(stagingBaseDir, { recursive: true });

    const results: SpckWebDeployStudentResult[] = [];
    const deployedQueue: Array<{
      record: SpckUploadRecord;
      fullName: string;
      studentSlug: string;
      relGitPath: string;
      liveWebUrl: string;
      entryHtmlFile: string;
      copiedFilesCount: number;
    }> = [];
    let skippedNoHtmlCount = 0;
    let failedStudentsCount = 0;

    try {
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
      runGitCommand(["add", "--", ...pathsToStage], repoDir);

      const statusOut = runGitCommand(
        ["status", "--porcelain", "--", ...pathsToStage],
        repoDir
      );
      if (statusOut.length > 0) {
        runGitCommand(
          [
            "commit",
            "-m",
            `Deploy SPCK Web class ${normalizedClassId} (${deployedQueue.length} students)`,
          ],
          repoDir
        );
      }

      assertEmergencyNotStopped();
      runGitCommand(["push", "origin", "HEAD:main"], repoDir);

      // Update SQLite relatedLinksJson for all deployed students
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

        // Rule 4: Update shared resource pool without overwriting session submission history
        spckUploadRepo.updateSharedResources(
          normalizedClassId,
          item.record.studentId,
          {
            relatedLinksJson: JSON.stringify(updatedLinks),
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

    const actualSuccessCount = results.filter((r) => r.status === "SUCCESS").length;

    return {
      classId: normalizedClassId,
      repoUrl,
      pagesBaseUrl,
      totalRequested: targetRecords.length,
      deployedStudentsCount: actualSuccessCount,
      skippedNoHtmlCount,
      failedStudentsCount,
      results,
    };
  }
}
