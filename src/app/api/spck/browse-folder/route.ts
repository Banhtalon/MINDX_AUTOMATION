import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { registerTeacherSelectedDirectory } from "@/lib/security/path-allowlist";

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

function detectWindowsDrives(): string[] {
  if (process.platform !== "win32") {
    return ["/"];
  }
  const drives: string[] = [];
  for (let code = 67; code <= 90; code++) {
    const letter = String.fromCharCode(code);
    const root = `${letter}:\\`;
    try {
      if (fs.existsSync(root)) {
        drives.push(root);
      }
    } catch {
      // Ignore inaccessible drive letters
    }
  }
  return drives;
}

function getQuickLinks(): QuickLinkEntry[] {
  const home = os.homedir();
  const candidates: QuickLinkEntry[] = [
    { label: "Desktop", path: path.join(home, "Desktop") },
    { label: "Downloads", path: path.join(home, "Downloads") },
    { label: "Documents", path: path.join(home, "Documents") },
    { label: "Thư mục Dự án", path: process.cwd() },
  ];
  return candidates.filter((item) => {
    try {
      return fs.existsSync(item.path) && fs.statSync(item.path).isDirectory();
    } catch {
      return false;
    }
  });
}

function listSubdirectories(dirPath: string): FolderEntry[] {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const folders: FolderEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const lower = entry.name.toLowerCase();
    if (IGNORED_SYSTEM_DIR_NAMES.has(lower) || entry.name.startsWith("$")) {
      continue;
    }
    folders.push({
      name: entry.name,
      path: path.join(dirPath, entry.name),
    });
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, "vi", { numeric: true, sensitivity: "base" }));
  return folders;
}

function resolveStartDirectory(rawPath: string, quickLinks: QuickLinkEntry[], drives: string[]): string {
  const trimmed = String(rawPath || "").trim();
  if (trimmed) {
    try {
      const resolved = path.resolve(trimmed);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        return resolved;
      }
      const parent = path.dirname(resolved);
      if (fs.existsSync(parent) && fs.statSync(parent).isDirectory()) {
        return parent;
      }
    } catch {
      // Fallback below
    }
  }
  if (quickLinks.length > 0) {
    return quickLinks[0].path;
  }
  if (drives.length > 0) {
    return drives[0];
  }
  return process.cwd();
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

    const drives = detectWindowsDrives();
    const quickLinks = getQuickLinks();
    const rawTarget = String(body?.path || body?.initialDir || "").trim();
    const currentPath = resolveStartDirectory(rawTarget, quickLinks, drives);
    const parentCandidate = path.dirname(currentPath);
    const parentPath =
      parentCandidate && parentCandidate !== currentPath ? parentCandidate : null;

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
