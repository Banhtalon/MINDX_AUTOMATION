import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import {
  assertPathAllowed,
  getAllowedDirectories,
  isPathAllowed,
  registerTeacherSelectedDirectory,
} from "@/lib/security/path-allowlist";

interface FolderEntry {
  name: string;
  path: string;
}

interface QuickLinkEntry {
  label: string;
  path: string;
}

const IGNORED_SYSTEM_DIR_NAMES = new Set([
  "$recycle.bin",
  "system volume information",
  "windows",
  "programdata",
  "recovery",
  "perflogs",
  "node_modules",
  ".git",
  ".next",
]);

function detectAllowedDrivesOrRoots(): string[] {
  const candidates: string[] = [];
  if (process.platform === "win32") {
    for (let code = 67; code <= 90; code++) {
      const letter = String.fromCharCode(code);
      const root = `${letter}:\\`;
      try {
        if (fs.existsSync(root) && isPathAllowed(root)) {
          candidates.push(root);
        }
      } catch {
        // Ignore inaccessible drive letters
      }
    }
  } else if (isPathAllowed("/")) {
    candidates.push("/");
  }

  for (const allowedDir of getAllowedDirectories()) {
    try {
      if (
        fs.existsSync(allowedDir) &&
        fs.statSync(allowedDir).isDirectory() &&
        isPathAllowed(allowedDir)
      ) {
        const real = fs.realpathSync(allowedDir);
        if (!candidates.includes(real)) {
          candidates.push(real);
        }
      }
    } catch {
      // Ignore invalid allowed roots
    }
  }
  return candidates;
}

function getQuickLinks(): QuickLinkEntry[] {
  const home = os.homedir();
  const candidates: QuickLinkEntry[] = [
    { label: "Desktop", path: path.join(home, "Desktop") },
    { label: "Downloads", path: path.join(home, "Downloads") },
    { label: "Documents", path: path.join(home, "Documents") },
    { label: "Thư mục Dự án", path: process.cwd() },
  ];
  for (const allowedDir of getAllowedDirectories()) {
    const resolved = path.resolve(allowedDir);
    if (!candidates.some((c) => path.resolve(c.path).toLowerCase() === resolved.toLowerCase())) {
      candidates.push({
        label: path.basename(resolved) || resolved,
        path: resolved,
      });
    }
  }
  return candidates.filter((item) => {
    try {
      return (
        fs.existsSync(item.path) &&
        fs.statSync(item.path).isDirectory() &&
        isPathAllowed(item.path)
      );
    } catch {
      return false;
    }
  });
}

function listSubdirectories(dirPath: string): FolderEntry[] {
  const safeDir = assertPathAllowed(dirPath);
  const realDir = fs.realpathSync(safeDir);
  assertPathAllowed(realDir);

  const entries = fs.readdirSync(realDir, { withFileTypes: true });
  const folders: FolderEntry[] = [];
  for (const entry of entries) {
    const lower = entry.name.toLowerCase();
    if (IGNORED_SYSTEM_DIR_NAMES.has(lower) || entry.name.startsWith("$")) {
      continue;
    }
    const childPath = path.join(realDir, entry.name);
    try {
      const stat = fs.statSync(childPath);
      if (!stat.isDirectory()) continue;
      if (!isPathAllowed(childPath)) continue;
      const realChild = fs.realpathSync(childPath);
      if (!isPathAllowed(realChild)) continue;
      folders.push({
        name: entry.name,
        path: childPath,
      });
    } catch {
      // Skip broken symlinks/junctions or inaccessible directories
      continue;
    }
  }
  folders.sort((a, b) =>
    a.name.localeCompare(b.name, "vi", { numeric: true, sensitivity: "base" })
  );
  return folders;
}

function resolveStartDirectory(
  rawPath: string,
  quickLinks: QuickLinkEntry[],
  drives: string[]
): string {
  const trimmed = String(rawPath || "").trim();
  if (trimmed) {
    // Strictly enforce Path Allowlist before probing or falling back on any caller-supplied path
    const resolved = assertPathAllowed(trimmed);
    if (fs.existsSync(resolved)) {
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        const real = fs.realpathSync(resolved);
        assertPathAllowed(real);
        return real;
      }
      const parent = path.dirname(resolved);
      assertPathAllowed(parent);
      if (fs.existsSync(parent) && fs.statSync(parent).isDirectory()) {
        const realParent = fs.realpathSync(parent);
        assertPathAllowed(realParent);
        return realParent;
      }
    } else {
      const parent = path.dirname(resolved);
      assertPathAllowed(parent);
      if (fs.existsSync(parent) && fs.statSync(parent).isDirectory()) {
        const realParent = fs.realpathSync(parent);
        assertPathAllowed(realParent);
        return realParent;
      }
    }
    throw new Error(`Thư mục không tồn tại hoặc không hợp lệ: '${resolved}'.`);
  }

  const fallbackCandidates = [
    ...quickLinks.map((q) => q.path),
    ...drives,
    ...getAllowedDirectories(),
  ];
  for (const cand of fallbackCandidates) {
    try {
      if (fs.existsSync(cand) && fs.statSync(cand).isDirectory() && isPathAllowed(cand)) {
        const real = fs.realpathSync(cand);
        assertPathAllowed(real);
        return real;
      }
    } catch {
      continue;
    }
  }

  throw new Error(
    "[Security Exception] Access denied: Không tìm thấy thư mục hợp lệ trong ALLOWED_LOCAL_DIRS allowlist."
  );
}

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "list").trim().toLowerCase();

    if (action === "select") {
      const rawFolderPath = String(body?.folderPath || "").trim();
      if (!rawFolderPath) {
        return NextResponse.json(
          {
            success: false,
            error: "Vui lòng chọn một thư mục hợp lệ.",
          },
          { status: 400 }
        );
      }

      const registeredPath = registerTeacherSelectedDirectory(rawFolderPath);
      return NextResponse.json({
        success: true,
        cancelled: false,
        folderPath: registeredPath,
      });
    }

    const drives = detectAllowedDrivesOrRoots();
    const quickLinks = getQuickLinks();
    const rawTarget = String(body?.path || body?.initialDir || "").trim();
    const currentPath = resolveStartDirectory(rawTarget, quickLinks, drives);
    const parentCandidate = path.dirname(currentPath);
    const parentPath =
      parentCandidate &&
      parentCandidate !== currentPath &&
      isPathAllowed(parentCandidate)
        ? parentCandidate
        : null;

    const directories = listSubdirectories(currentPath);

    return NextResponse.json({
      success: true,
      currentPath,
      parentPath,
      drives,
      quickLinks,
      directories,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("Security Exception") ? 403 : 400;
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status }
    );
  }
}
