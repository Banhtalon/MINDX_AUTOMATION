import fs from "node:fs";
import path from "node:path";
import { config } from "../config";

/**
 * Normalizes a file/folder path for consistent comparison across platforms.
 * Resolves symlinks and junctions (realpath) when the path exists.
 * On Windows, paths are case-insensitive.
 */
function normalizePath(p: string): string {
  let current = path.resolve(p);
  const remainingParts: string[] = [];

  // Traverse up to find the closest existing ancestor directory to resolve any symlinks/junctions
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    remainingParts.unshift(path.basename(current));
    current = parent;
  }

  if (fs.existsSync(current)) {
    try {
      const realParent = fs.realpathSync(current);
      current = remainingParts.length > 0 ? path.join(realParent, ...remainingParts) : realParent;
    } catch {
      // Keep resolved path if realpath fails
    }
  }

  return process.platform === "win32" ? current.toLowerCase() : current;
}

const runtimeTeacherSelectedDirs = new Set<string>();
const TEACHER_BROWSED_DIRS_FILE = path.join(
  process.cwd(),
  "data",
  "config",
  "teacher_browsed_dirs.json"
);

function isForbiddenSystemOrRootDirectory(targetPath: string): boolean {
  const raw = String(targetPath || "").trim();
  if (!raw) return true;

  // Check both the unresolved and realpath-resolved forms
  const candidates = [path.resolve(raw), normalizePath(raw)];

  for (const cand of candidates) {
    const winNorm = cand.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
    if (/^[a-z]:$/i.test(winNorm) || winNorm === "" || winNorm === "\\") {
      return true;
    }
    const winForbiddenPrefixes = [
      "c:\\windows",
      "c:\\program files",
      "c:\\program files (x86)",
      "c:\\programdata",
      "c:\\system volume information",
    ];
    for (const prefix of winForbiddenPrefixes) {
      if (winNorm === prefix || winNorm.startsWith(prefix + "\\")) {
        return true;
      }
    }

    const posixNorm = cand.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    if (posixNorm === "") return true;
    const posixForbiddenPrefixes = [
      "/etc",
      "/bin",
      "/sbin",
      "/usr",
      "/var",
      "/proc",
      "/sys",
      "/dev",
      "/root",
    ];
    for (const prefix of posixForbiddenPrefixes) {
      if (posixNorm === prefix || posixNorm.startsWith(prefix + "/")) {
        return true;
      }
    }
  }

  return false;
}

function loadPersistedTeacherDirs(): string[] {
  try {
    if (!fs.existsSync(TEACHER_BROWSED_DIRS_FILE)) return [];
    const raw = fs.readFileSync(TEACHER_BROWSED_DIRS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .filter((dir) => fs.existsSync(dir))
      .map((dir) => {
        try {
          return fs.realpathSync(path.resolve(dir));
        } catch {
          return path.resolve(dir);
        }
      })
      .filter((dir) => !isForbiddenSystemOrRootDirectory(dir));
  } catch {
    return [];
  }
}

/**
 * Registers a directory explicitly chosen by the teacher via the native folder picker dialog
 * into the local Path Allowlist (both in-memory and persisted in data/config/teacher_browsed_dirs.json).
 */
export function registerTeacherSelectedDirectory(dirPath: string): string {
  const rawInput = String(dirPath || "").trim();
  const resolved = path.resolve(rawInput);
  if (!rawInput || !resolved || isForbiddenSystemOrRootDirectory(resolved)) {
    throw new Error(
      `[Security Exception] Không cho phép chọn thư mục hệ thống hoặc ổ đĩa gốc ('${dirPath}'). Vui lòng chọn thư mục SPCK cụ thể của lớp.`
    );
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Thư mục không tồn tại hoặc không hợp lệ: '${resolved}'.`);
  }

  let realResolved = resolved;
  try {
    realResolved = fs.realpathSync(resolved);
  } catch {
    throw new Error(`[Security Exception] Không thể xác thực đường dẫn thực tế của '${resolved}'.`);
  }

  if (isForbiddenSystemOrRootDirectory(realResolved)) {
    throw new Error(
      `[Security Exception] Đường dẫn đích thực tế '${realResolved}' thuộc thư mục hệ thống bị cấm.`
    );
  }

  runtimeTeacherSelectedDirs.add(realResolved);
  try {
    const existing = loadPersistedTeacherDirs();
    const merged = Array.from(new Set([...existing, ...runtimeTeacherSelectedDirs]));
    const dir = path.dirname(TEACHER_BROWSED_DIRS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(TEACHER_BROWSED_DIRS_FILE, JSON.stringify(merged, null, 2), "utf8");
  } catch {
    // Non-fatal if persistence write fails; runtimeTeacherSelectedDirs still holds it
  }
  return realResolved;
}

/**
 * Returns all currently allowed base directories.
 * Always includes the project workspace root, configured directories in ALLOWED_LOCAL_DIRS,
 * and directories explicitly selected by the teacher via the native folder picker.
 */
export function getAllowedDirectories(): string[] {
  const defaultAllowed = [process.cwd()];
  const configured = config.allowedLocalDirs || [];
  const persistedTeacherDirs = loadPersistedTeacherDirs();
  return [
    ...defaultAllowed,
    ...configured,
    ...persistedTeacherDirs,
    ...runtimeTeacherSelectedDirs,
  ].map((dir) => path.resolve(dir));
}

/**
 * Verifies if the target file or directory path is located inside one of the allowlisted paths.
 * Defends strictly against directory traversal and symlink escape attacks.
 *
 * @param targetPath Absolute or relative path to check
 * @returns boolean true if path is allowed, false otherwise
 */
export function isPathAllowed(targetPath: string): boolean {
  if (!targetPath || typeof targetPath !== "string") {
    return false;
  }

  const normalizedTarget = normalizePath(targetPath);
  const allowedRoots = getAllowedDirectories();

  for (const root of allowedRoots) {
    const normalizedRoot = normalizePath(root);
    // Path must either be identical to root or be a child of root
    if (
      normalizedTarget === normalizedRoot ||
      normalizedTarget.startsWith(normalizedRoot + path.sep.toLowerCase())
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Asserts that the path is allowed; throws a security Error if not.
 * Returns the resolved absolute path.
 */
export function assertPathAllowed(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  if (!isPathAllowed(resolved)) {
    throw new Error(
      `[Security Exception] Access denied: Path '${targetPath}' is outside the configured ALLOWED_LOCAL_DIRS allowlist.`
    );
  }
  return resolved;
}
