import fs from "node:fs";
import path from "node:path";
import { config } from "../config";

/**
 * Normalizes a file/folder path for consistent comparison across platforms.
 * Resolves symlinks and junctions (realpath) when the path exists.
 * On Windows, paths are case-insensitive.
 */
function normalizePath(p: string): string {
  let resolved = path.resolve(p);
  if (fs.existsSync(resolved)) {
    try {
      resolved = fs.realpathSync(resolved);
    } catch {
      // Keep standard path.resolve
    }
  }
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * Returns all currently allowed base directories.
 * Always includes the project workspace root and any configured directories in ALLOWED_LOCAL_DIRS.
 */
export function getAllowedDirectories(): string[] {
  const defaultAllowed = [process.cwd()];
  const configured = config.allowedLocalDirs || [];
  return [...defaultAllowed, ...configured].map((dir) => path.resolve(dir));
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
