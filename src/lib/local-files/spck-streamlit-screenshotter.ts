/**
 * MINDX AUTOMATION BOT - SPCK STREAMLIT APP RUNNER & INTERFACE SCREENSHOTTER
 * Automatically launches student Streamlit Python apps (`app.py` / `streamlit_app.py` / ...)
 * strictly on loopback (`127.0.0.1`) with sanitized non-secret environment variables, waits for
 * the WebSocket + React UI to settle in a temporary headless Chromium/Edge CDP session, captures
 * multi-view screenshots (`Hero`, `st.tabs`, multipage sidebar, or scrolled sections), normalizes
 * them into LMS-safe `960×540` PNGs (`_spck_app_shots/`), and terminates all child processes.
 *
 * Security invariants:
 * - Zero `playwright` imports & single `BrowserContext` invariant (uses temporary loopback CDP WebSocket only).
 * - Strict path containment & symlink/junction rejection inside the student's allowlisted folder.
 * - Strict allowlist-based child env (never leaks `GEMINI_API_KEY`, `LMS_PASSWORD`, `TEACHING_PASSWORD`, etc.).
 * - Headless CDP strictly restricted to `127.0.0.1` loopback.
 */

import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { SequentialTaskQueue } from "../queue/task-queue";
import { assertPathAllowed } from "../security/path-allowlist";
import {
  LMS_IMAGE_HEIGHT,
  LMS_IMAGE_WIDTH,
  normalizeImagesToLms16x9,
} from "./spck-image-normalizer";

export interface CapturedStreamlitScreenItem {
  filePath: string;
  screenName: string;
  sourceFile: string;
  width: number;
  height: number;
  widgetCount: number;
  colorRichness: number;
  isAuthScreen: boolean;
  heuristicScore: number;
}

export interface StreamlitPythonResolution {
  cmd: string;
  prefixArgs: string[];
  source: "env_override" | "project_streamlit_venv" | "project_venv" | "system";
}

export interface StreamlitCaptureBatchResult {
  items: CapturedStreamlitScreenItem[];
  warning?: string;
}

const STREAMLIT_VIEWPORT_WIDTH = 1440;
const STREAMLIT_VIEWPORT_HEIGHT = 810;
const MAX_STREAMLIT_SHOTS_PER_RUN = 4;

const SKIP_DIRS = new Set([
  ".git",
  ".venv",
  "venv",
  "env",
  "__pycache__",
  "node_modules",
  "dist",
  "build",
  "site-packages",
]);

const DRAFT_DIR_REGEX =
  /^(draf|draft|drafts|backup|backups|old|temp|tmp|archive)$/i;

const STREAMLIT_PRIORITY_ENTRY_NAMES = new Set([
  "app.py",
  "streamlit_app.py",
  "main.py",
  "home.py",
  "index.py",
]);

const SAFE_OS_ENV_ALLOWLIST = new Set([
  "PATH",
  "Path",
  "SYSTEMROOT",
  "SystemRoot",
  "COMSPEC",
  "ComSpec",
  "WINDIR",
  "TEMP",
  "TMP",
  "LOCALAPPDATA",
  "APPDATA",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "PATHEXT",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "COMMONPROGRAMFILES",
  "CommonProgramFiles",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PROCESSOR_ARCHITECTURE",
  "HOME",
  "LANG",
  "LC_ALL",
]);

const FORBIDDEN_ENV_KEY_REGEX =
  /(?:PASSWORD|PASS|SECRET|TOKEN|API_KEY|PRIVATE_KEY|COOKIE|AUTH|CREDENTIAL|TEACHING|LMS|GEMINI|GITHUB|OPENAI|ANTHROPIC|GOOGLE_API)/i;

let cachedGlobalStreamlitPython: StreamlitPythonResolution | null | undefined =
  undefined;

export function resetStreamlitPythonCacheForTests(): void {
  cachedGlobalStreamlitPython = undefined;
}

function ensureCaptureNotStopped(): void {
  if (
    SequentialTaskQueue.getInstance().getStatus().isStopped ||
    Boolean((process as unknown as Record<string, unknown>).__mindxQueueStopped)
  ) {
    throw new Error(
      "TASK_CANCELLED: Hàng đợi đã bị tạm dừng bởi giáo viên (Stop Bot)."
    );
  }
}

function isOfflineAuditMode(): boolean {
  if (process.env.MINDX_ALLOW_STREAMLIT_CAPTURE_IN_TEST === "1") {
    return false;
  }
  return Boolean(
    process.env.AUDIT_RENDERER_OUT ||
      process.env.AUDIT_COMPAT_OUT ||
      process.env.AUDIT_PAYLOAD_OUT ||
      (process.env.NODE_OPTIONS || "").includes("network-guard")
  );
}

/**
 * Checks whether a Python source file contains an actual (non-commented, non-docstring) `streamlit` import.
 */
export function isStreamlitSourceCode(source: string): boolean {
  if (!source) return false;
  const withoutDocstrings = source
    .replace(/"""[\s\S]*?"""/g, "\n")
    .replace(/'''[\s\S]*?'''/g, "\n");
  const lines = withoutDocstrings.split(/\r?\n/);
  for (const rawLine of lines) {
    const codeOnly = rawLine.replace(/#.*$/, "").trim();
    if (!codeOnly) continue;
    if (
      /^(?:import\s+(?:[^;\n]*,\s*)?streamlit(?:\s|$|,|\.)|from\s+streamlit(?:\.|\s+import))/i.test(
        codeOnly
      )
    ) {
      return true;
    }
  }
  return false;
}

function isSubpathOrEqual(candidate: string, root: string): boolean {
  const normCand = path.resolve(candidate);
  const normRoot = path.resolve(root);
  const cmpCand = process.platform === "win32" ? normCand.toLowerCase() : normCand;
  const cmpRoot = process.platform === "win32" ? normRoot.toLowerCase() : normRoot;
  if (cmpCand === cmpRoot) return true;
  const prefix = cmpRoot.endsWith(path.sep) ? cmpRoot : cmpRoot + path.sep;
  return cmpCand.startsWith(prefix);
}

/**
 * Validates and ensures `targetDir` stays strictly inside `studentRealRoot` with ZERO
 * symlink/junction segments anywhere along the path before creating or writing to it.
 */
function resolveSafeDirWithinStudent(
  studentRealRoot: string,
  targetDir: string
): string | null {
  try {
    const safeTarget = assertPathAllowed(targetDir);
    if (!isSubpathOrEqual(safeTarget, studentRealRoot)) {
      return null;
    }
    const rel = path.relative(studentRealRoot, safeTarget);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return null;
    }
    const segments = rel ? rel.split(path.sep).filter(Boolean) : [];
    let cursor = studentRealRoot;
    for (const seg of segments) {
      cursor = path.join(cursor, seg);
      const lst = fs.lstatSync(cursor, { throwIfNoEntry: false });
      if (lst) {
        if (lst.isSymbolicLink() || !lst.isDirectory()) return null;
      } else {
        fs.mkdirSync(cursor);
      }
      const realCursor = assertPathAllowed(fs.realpathSync(cursor));
      if (!isSubpathOrEqual(realCursor, studentRealRoot)) {
        return null;
      }
    }
    const finalReal = assertPathAllowed(fs.realpathSync(safeTarget));
    return isSubpathOrEqual(finalReal, studentRealRoot) ? finalReal : null;
  } catch {
    return null;
  }
}

/**
 * Validates that `relOrAbsPath` has NO symlinks/junctions anywhere between `studentRealRoot`
 * and the target file, resolves inside `studentRealRoot`, and passes `assertPathAllowed`.
 */
function resolveSafeFileWithinStudent(
  studentRealRoot: string,
  candidateFilePath: string
): string | null {
  try {
    const absTarget = path.resolve(candidateFilePath);
    if (!isSubpathOrEqual(absTarget, studentRealRoot)) {
      return null;
    }
    const rel = path.relative(studentRealRoot, absTarget);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      return null;
    }
    const segments = rel.split(path.sep).filter(Boolean);
    let cursor = studentRealRoot;
    for (let i = 0; i < segments.length; i++) {
      cursor = path.join(cursor, segments[i]);
      const lst = fs.lstatSync(cursor);
      if (lst.isSymbolicLink()) return null;
      if (i < segments.length - 1 && !lst.isDirectory()) return null;
      if (i === segments.length - 1 && !lst.isFile()) return null;
    }
    const realTarget = assertPathAllowed(fs.realpathSync(absTarget));
    if (!isSubpathOrEqual(realTarget, studentRealRoot)) {
      return null;
    }
    return realTarget;
  } catch {
    return null;
  }
}

/**
 * Scans up to depth 3 inside a student's SPCK folder for runnable Streamlit Python scripts,
 * ignoring `.venv` / `venv` / `_spck_*` / symlinks and prioritizing primary entry files
 * (`app.py`, `streamlit_app.py`, `main.py`, `home.py`, `index.py`) before subpage/draft scripts.
 */
export function findProjectStreamlitFiles(studentDir: string): string[] {
  let safeStudentDir: string;
  let realStudentDir: string;
  try {
    safeStudentDir = assertPathAllowed(studentDir);
    if (fs.lstatSync(safeStudentDir).isSymbolicLink()) return [];
    realStudentDir = assertPathAllowed(fs.realpathSync(safeStudentDir));
    if (!fs.statSync(realStudentDir).isDirectory()) return [];
  } catch {
    return [];
  }

  const found: Array<{
    relPath: string;
    priority: number;
    inDraftDir: boolean;
    inPagesDir: boolean;
  }> = [];

  const walk = (
    currentDir: string,
    depth: number,
    inDraftDir: boolean,
    inPagesDir: boolean
  ) => {
    if (depth > 3) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const lowerEntry = entry.name.toLowerCase();
      if (
        entry.name.startsWith(".") ||
        lowerEntry.startsWith("_spck_") ||
        SKIP_DIRS.has(lowerEntry)
      ) {
        continue;
      }
      const fullPath = path.join(currentDir, entry.name);
      let lstat: fs.Stats;
      try {
        lstat = fs.lstatSync(fullPath);
      } catch {
        continue;
      }
      if (lstat.isSymbolicLink()) continue;

      if (lstat.isDirectory()) {
        try {
          const realSub = fs.realpathSync(fullPath);
          if (!isSubpathOrEqual(realSub, realStudentDir)) continue;
        } catch {
          continue;
        }
        walk(
          fullPath,
          depth + 1,
          inDraftDir || DRAFT_DIR_REGEX.test(entry.name),
          inPagesDir || lowerEntry === "pages"
        );
      } else if (lstat.isFile() && lowerEntry.endsWith(".py")) {
        const realFile = resolveSafeFileWithinStudent(realStudentDir, fullPath);
        if (!realFile) continue;
        if (lstat.size > 2 * 1024 * 1024) continue;

        let source = "";
        try {
          source = fs.readFileSync(realFile, "utf8");
        } catch {
          continue;
        }
        if (!isStreamlitSourceCode(source)) continue;

        const relPath = path.relative(realStudentDir, realFile);
        let priority = 55;
        if (inPagesDir || /(colab|test|backup|old|copy|draft)/i.test(lowerEntry)) {
          priority = 85;
        } else if (STREAMLIT_PRIORITY_ENTRY_NAMES.has(lowerEntry)) {
          priority = depth === 0 ? 10 : 18;
        } else if (depth === 0 && /st\.set_page_config\s*\(/.test(source)) {
          priority = 25;
        } else if (depth === 0) {
          priority = 35;
        }

        found.push({ relPath, priority, inDraftDir, inPagesDir });
      }
    }
  };

  walk(realStudentDir, 0, false, false);
  const nonDraft = found.filter((f) => !f.inDraftDir);
  const draftFiltered = nonDraft.length > 0 ? nonDraft : found;
  const nonPages = draftFiltered.filter((f) => !f.inPagesDir);
  const effective = nonPages.length > 0 ? nonPages : draftFiltered;

  effective.sort(
    (a, b) =>
      a.priority - b.priority ||
      a.relPath.localeCompare(b.relPath, "en", { numeric: true })
  );
  return effective.map((f) => f.relPath);
}

/**
 * Constructs a strictly sanitized environment for child Streamlit/browser processes
 * containing ONLY essential OS paths and safe headless Streamlit flags, stripping all secrets.
 */
export function buildSafeStreamlitEnv(
  extraEnv?: Record<string, string>
): NodeJS.ProcessEnv {
  const safeEnv: NodeJS.ProcessEnv = {
    NODE_ENV:
      process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
        ? process.env.NODE_ENV
        : "production",
  };
  for (const key of Object.keys(process.env)) {
    if (!SAFE_OS_ENV_ALLOWLIST.has(key)) continue;
    if (FORBIDDEN_ENV_KEY_REGEX.test(key)) continue;
    const val = process.env[key];
    if (typeof val === "string" && val.length > 0) {
      safeEnv[key] = val;
    }
  }
  // Normalize Windows PATH casing if needed
  if (!safeEnv.PATH && safeEnv.Path) {
    safeEnv.PATH = safeEnv.Path;
  }

  Object.assign(safeEnv, {
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    STREAMLIT_SERVER_HEADLESS: "true",
    STREAMLIT_SERVER_ADDRESS: "127.0.0.1",
    STREAMLIT_SERVER_FILE_WATCHER_TYPE: "none",
    STREAMLIT_SERVER_RUN_ON_SAVE: "false",
    STREAMLIT_BROWSER_GATHER_USAGE_STATS: "false",
    STREAMLIT_GLOBAL_DEVELOPMENT_MODE: "false",
    STREAMLIT_CLIENT_TOOLBAR_MODE: "minimal",
  });

  if (extraEnv) {
    for (const [k, v] of Object.entries(extraEnv)) {
      if (!FORBIDDEN_ENV_KEY_REGEX.test(k)) {
        safeEnv[k] = v;
      }
    }
  }
  return safeEnv;
}

export function detectHeadlessBrowserExecutable(): string | null {
  const candidates: string[] = [];
  if (process.env.MINDX_HEADLESS_BROWSER_BIN) {
    candidates.push(process.env.MINDX_HEADLESS_BROWSER_BIN.trim());
  }
  if (process.platform === "win32") {
    candidates.push(
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    );
  }

  for (const cand of candidates) {
    if (!cand) continue;
    try {
      const lst = fs.lstatSync(cand);
      if (lst.isSymbolicLink()) continue;
      if (fs.statSync(cand).isFile()) {
        return cand;
      }
    } catch {
      // Try next browser binary
    }
  }
  return null;
}

async function probePythonHasStreamlit(
  cmd: string,
  prefixArgs: string[],
  timeoutMs = 5000
): Promise<{ ok: true; executable: string } | { ok: false }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (res: { ok: true; executable: string } | { ok: false }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    };

    let child: ChildProcess;
    try {
      child = spawn(
        cmd,
        [...prefixArgs, "-c", "import streamlit, sys; print(sys.executable)"],
        {
          cwd: process.cwd(),
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
          shell: false,
          env: buildSafeStreamlitEnv(),
        }
      );
    } catch {
      resolve({ ok: false });
      return;
    }

    const outChunks: Buffer[] = [];
    let totalBytes = 0;
    child.stdout?.on("data", (c: Buffer) => {
      totalBytes += c.length;
      if (totalBytes <= 8192) outChunks.push(c);
    });

    const timer = setTimeout(() => {
      killChildTree(child.pid, () => child.kill("SIGKILL"));
      finish({ ok: false });
    }, timeoutMs);
    timer.unref?.();

    child.on("error", () => finish({ ok: false }));
    child.on("close", (code) => {
      if (code !== 0) {
        finish({ ok: false });
        return;
      }
      const line = Buffer.concat(outChunks)
        .toString("utf8")
        .trim()
        .split(/\r?\n/)
        .pop()
        ?.trim();
      if (!line) {
        finish({ ok: false });
        return;
      }
      try {
        if (fs.lstatSync(line).isSymbolicLink() || !fs.statSync(line).isFile()) {
          finish({ ok: false });
          return;
        }
        finish({ ok: true, executable: fs.realpathSync(line) });
      } catch {
        finish({ ok: false });
      }
    });
  });
}

/**
 * Resolves a host-controlled Python interpreter capable of importing `streamlit`:
 * 1) `MINDX_STREAMLIT_PYTHON` override (fail-closed if set to an invalid binary)
 * 2) Bot's isolated `data/streamlit-venv` or project `.venv`
 * 3) Host system Python candidates (`py -3.12`, `python`, `py -3`, `python3`), resolved to
 *    an absolute `sys.executable` path so spawning with `cwd: studentDir` never hijacks Windows CWD.
 * Note: Never executes any binary from inside a student submission folder (`.venv`/`venv`).
 */
export async function resolveStreamlitPythonExecutableAsync(
  _studentDir?: string
): Promise<StreamlitPythonResolution | null> {
  const envOverride = (process.env.MINDX_STREAMLIT_PYTHON || "").trim();
  if (envOverride) {
    try {
      if (
        !fs.lstatSync(envOverride).isSymbolicLink() &&
        fs.statSync(envOverride).isFile()
      ) {
        const probe = await probePythonHasStreamlit(envOverride, []);
        if (probe.ok) {
          return { cmd: probe.executable, prefixArgs: [], source: "env_override" };
        }
      }
    } catch {
      // Do not fall back when override is explicitly provided so missing-env tests stay deterministic
    }
    return null;
  }

  if (cachedGlobalStreamlitPython) {
    try {
      if (
        !fs.lstatSync(cachedGlobalStreamlitPython.cmd).isSymbolicLink() &&
        fs.statSync(cachedGlobalStreamlitPython.cmd).isFile()
      ) {
        return cachedGlobalStreamlitPython;
      }
    } catch {
      // Cache invalidated
    }
    cachedGlobalStreamlitPython = undefined;
  }

  const projectRoot = process.cwd();
  const projectStreamlitPy =
    process.platform === "win32"
      ? path.join(projectRoot, "data", "streamlit-venv", "Scripts", "python.exe")
      : path.join(projectRoot, "data", "streamlit-venv", "bin", "python");
  const projectVenvPy =
    process.platform === "win32"
      ? path.join(projectRoot, ".venv", "Scripts", "python.exe")
      : path.join(projectRoot, ".venv", "bin", "python");

  const globalCandidates: Array<{
    cmd: string;
    prefixArgs: string[];
    source: StreamlitPythonResolution["source"];
    requireExistingFile: boolean;
  }> = [
    {
      cmd: projectStreamlitPy,
      prefixArgs: [],
      source: "project_streamlit_venv",
      requireExistingFile: true,
    },
    {
      cmd: projectVenvPy,
      prefixArgs: [],
      source: "project_venv",
      requireExistingFile: true,
    },
    ...(process.platform === "win32"
      ? [
          {
            cmd: "py",
            prefixArgs: ["-3.12"],
            source: "system" as const,
            requireExistingFile: false,
          },
          {
            cmd: "python",
            prefixArgs: [],
            source: "system" as const,
            requireExistingFile: false,
          },
          {
            cmd: "py",
            prefixArgs: ["-3"],
            source: "system" as const,
            requireExistingFile: false,
          },
        ]
      : [
          {
            cmd: "python3",
            prefixArgs: [],
            source: "system" as const,
            requireExistingFile: false,
          },
          {
            cmd: "python",
            prefixArgs: [],
            source: "system" as const,
            requireExistingFile: false,
          },
        ]),
  ];

  for (const cand of globalCandidates) {
    if (cand.requireExistingFile) {
      try {
        if (
          fs.lstatSync(cand.cmd).isSymbolicLink() ||
          !fs.statSync(cand.cmd).isFile()
        ) {
          continue;
        }
      } catch {
        continue;
      }
    }
    const probe = await probePythonHasStreamlit(cand.cmd, cand.prefixArgs);
    if (probe.ok) {
      cachedGlobalStreamlitPython = {
        cmd: probe.executable,
        prefixArgs: [],
        source: cand.source,
      };
      return cachedGlobalStreamlitPython;
    }
  }

  return null;
}

async function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr !== "string" && addr.port > 0) {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("Không cấp phát được cổng nội bộ.")));
      }
    });
  });
}

function killChildTree(
  pid: number | undefined,
  killSelf: () => void
): Promise<void> {
  if (!pid || pid <= 0) {
    try {
      killSelf();
    } catch {
      // ignore
    }
    return Promise.resolve();
  }
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      const done = () => {
        try {
          killSelf();
        } catch {
          // ignore
        }
        resolve();
      };
      try {
        // Run taskkill /T /F BEFORE killSelf() so parent PID is still alive and child subtree dies completely
        const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
          shell: false,
        });
        const fallback = setTimeout(done, 2500);
        fallback.unref?.();
        killer.on("error", () => {
          clearTimeout(fallback);
          done();
        });
        killer.on("close", () => {
          clearTimeout(fallback);
          done();
        });
      } catch {
        done();
      }
    });
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // ignore
  }
  try {
    killSelf();
  } catch {
    // ignore
  }
  return Promise.resolve();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStreamlitHealth(params: {
  port: number;
  proc: ChildProcess;
  getStderrTail: () => string;
  timeoutMs?: number;
}): Promise<void> {
  const { port, proc, getStderrTail, timeoutMs = 25_000 } = params;
  const deadline = Date.now() + timeoutMs;
  const healthUrl = `http://127.0.0.1:${port}/_stcore/health`;

  while (Date.now() < deadline) {
    ensureCaptureNotStopped();
    if (proc.exitCode !== null) {
      throw new Error(
        `Streamlit thoát sớm (code ${proc.exitCode}): ${getStderrTail().slice(0, 240)}`
      );
    }
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 1500);
    t.unref?.();
    try {
      const res = await fetch(healthUrl, { signal: controller.signal });
      if (res.ok) {
        return;
      }
    } catch {
      // Not ready yet
    } finally {
      clearTimeout(t);
    }
    await sleep(250);
  }
  throw new Error(
    `Streamlit không phản hồi sau ${Math.round(timeoutMs / 1000)}s.`
  );
}

async function waitForDevToolsPort(params: {
  proc: ChildProcess;
  getStderr: () => string;
  timeoutMs?: number;
}): Promise<number> {
  const { proc, getStderr, timeoutMs = 12_000 } = params;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    ensureCaptureNotStopped();
    if (proc.exitCode !== null) {
      throw new Error(
        `Trình duyệt headless thoát sớm (code ${proc.exitCode}).`
      );
    }
    const stderr = getStderr();
    const m = stderr.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//i);
    if (m) {
      const port = Number(m[1]);
      if (Number.isInteger(port) && port > 0) {
        return port;
      }
    }
    await sleep(100);
  }
  throw new Error("Không mở được cổng DevTools nội bộ của trình duyệt headless.");
}

async function fetchLoopbackPageWsUrl(cdpPort: number): Promise<string> {
  const listUrl = `http://127.0.0.1:${cdpPort}/json/list`;
  const deadline = Date.now() + 6000;
  let lastErr = "empty /json/list";

  while (Date.now() < deadline) {
    ensureCaptureNotStopped();
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2000);
    t.unref?.();
    try {
      const res = await fetch(listUrl, { signal: controller.signal });
      if (res.ok) {
        const targets = (await res.json()) as Array<{
          type?: string;
          webSocketDebuggerUrl?: string;
        }>;
        const pageTarget = Array.isArray(targets)
          ? targets.find(
              (t) =>
                t?.type === "page" &&
                typeof t.webSocketDebuggerUrl === "string" &&
                t.webSocketDebuggerUrl.startsWith(`ws://127.0.0.1:${cdpPort}/`)
            )
          : undefined;
        if (pageTarget?.webSocketDebuggerUrl) {
          return pageTarget.webSocketDebuggerUrl;
        }
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(t);
    }
    await sleep(120);
  }
  throw new Error(`Không tìm thấy Page WebSocket CDP trên 127.0.0.1 (${lastErr}).`);
}

class MinimalCdpClient {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private closed = false;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (evt) => {
      if (typeof evt.data !== "string") return;
      let msg: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (typeof msg.id === "number") {
        const entry = this.pending.get(msg.id);
        if (!entry) return;
        this.pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.error) {
          entry.reject(new Error(msg.error.message || "CDP command failed"));
        } else {
          entry.resolve(msg.result);
        }
      }
    });
    ws.addEventListener("close", () => {
      this.closed = true;
      for (const [id, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error("CDP WebSocket closed"));
        this.pending.delete(id);
      }
    });
  }

  static async connect(wsUrl: string, expectedPort: number): Promise<MinimalCdpClient> {
    if (!wsUrl.startsWith(`ws://127.0.0.1:${expectedPort}/`)) {
      throw new Error("Từ chối địa chỉ WebSocket CDP không phải loopback.");
    }
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {}
        reject(new Error("Quá thời gian kết nối CDP WebSocket."));
      }, 6000);
      timer.unref?.();

      const onOpen = () => {
        clearTimeout(timer);
        ws.removeEventListener("error", onErr);
        resolve(new MinimalCdpClient(ws));
      };
      const onErr = () => {
        clearTimeout(timer);
        ws.removeEventListener("open", onOpen);
        reject(new Error("Lỗi kết nối CDP WebSocket."));
      };
      ws.addEventListener("open", onOpen, { once: true });
      ws.addEventListener("error", onErr, { once: true });
    });
  }

  send<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 15_000
  ): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error("CDP WebSocket already closed"));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout waiting for ${method}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async evalJson<T = unknown>(expression: string, timeoutMs = 10_000): Promise<T> {
    const res = await this.send<{
      result?: { value?: T };
      exceptionDetails?: { text?: string };
    }>(
      "Runtime.evaluate",
      {
        expression,
        returnByValue: true,
        awaitPromise: true,
      },
      timeoutMs
    );
    if (res?.exceptionDetails) {
      throw new Error(res.exceptionDetails.text || "Runtime.evaluate exception");
    }
    return res?.result?.value as T;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    try {
      await Promise.race([
        this.send("Browser.close", {}, 500).catch(() => undefined),
        sleep(500),
      ]);
    } catch {
      // ignore
    }
    try {
      this.ws.close();
    } catch {
      // ignore
    }
    this.closed = true;
  }
}

interface StreamlitPageInspectState {
  readyState: string;
  hasAppContainer: boolean;
  isRunning: boolean;
  skeletonCount: number;
  textLen: number;
  widgetCount: number;
  exceptionCount: number;
  exceptionText: string;
  tabCount: number;
  sidebarNavCount: number;
  scrollHeight: number;
  clientHeight: number;
}

async function inspectStreamlitPage(
  cdp: MinimalCdpClient
): Promise<StreamlitPageInspectState | null> {
  return cdp.evalJson<StreamlitPageInspectState | null>(`(() => {
    const root = document.querySelector('[data-testid="stAppViewContainer"]') || document.querySelector('.stApp');
    if (!root) {
      return {
        readyState: document.readyState || '',
        hasAppContainer: false,
        isRunning: true,
        skeletonCount: 0,
        textLen: 0,
        widgetCount: 0,
        exceptionCount: 0,
        exceptionText: '',
        tabCount: 0,
        sidebarNavCount: 0,
        scrollHeight: 0,
        clientHeight: 0
      };
    }
    const isElVisible = (el) => {
      if (!el || !el.getBoundingClientRect) return false;
      const r = el.getBoundingClientRect();
      if (!r || r.width <= 1 || r.height <= 1) return false;
      const cs = window.getComputedStyle(el);
      return Boolean(cs && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0');
    };
    const statusEl = document.querySelector('[data-testid="stStatusWidget"]');
    const statusText = statusEl ? String(statusEl.textContent || '') : '';
    const isRunning = /\\b(running|please wait|connecting)\\b/i.test(statusText);
    const skeletonCount = document.querySelectorAll('[data-testid="stSkeleton"]').length;
    const exceptionEls = Array.from(document.querySelectorAll('[data-testid="stException"]')).filter(isElVisible);
    const exceptionCount = exceptionEls.length;
    const exceptionText = exceptionEls.length > 0
      ? String(exceptionEls[0].textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 260)
      : '';
    const widgetSelectors = [
      '[data-testid="stMarkdownContainer"]',
      '[data-testid="stHeading"]',
      '[data-testid="stTitle"]',
      '[data-testid="stButton"]',
      '[data-testid="stSelectbox"]',
      '[data-testid="stTextInput"]',
      '[data-testid="stChatInput"]',
      '[data-testid="stDataFrame"]',
      '[data-testid="stTable"]',
      '[data-testid="stMetric"]',
      '[data-testid="stPlotlyChart"]',
      '[data-testid="stImage"]',
      '[data-testid="stSidebar"] [data-testid="stElementContainer"]',
      '[data-testid="stTabs"]',
      '[data-baseweb="tab-list"]'
    ].join(',');
    const widgetCount = document.querySelectorAll(widgetSelectors).length;
    const mainEl = document.querySelector('[data-testid="stMain"]') || document.querySelector('section.main') || root;
    const cloned = mainEl ? mainEl.cloneNode(true) : null;
    if (cloned && cloned.querySelectorAll) {
      cloned.querySelectorAll('[data-testid="stException"], style, script').forEach((n) => n.remove());
    }
    const textLen = cloned ? String(cloned.textContent || '').replace(/\\s+/g, ' ').trim().length : 0;
    const tabCount = document.querySelectorAll('[data-testid="stTabs"] [role="tab"], [data-baseweb="tab-list"] [role="tab"], [role="tablist"] [role="tab"]').length;
    const sidebarNavCount = document.querySelectorAll('[data-testid="stSidebarNav"] a').length;
    const scrollers = [
      document.querySelector('[data-testid="stMain"]'),
      document.querySelector('[data-testid="stAppViewContainer"]'),
      document.querySelector('section.main'),
      document.scrollingElement
    ].filter(Boolean);
    let scrollHeight = window.innerHeight || ${STREAMLIT_VIEWPORT_HEIGHT};
    let clientHeight = window.innerHeight || ${STREAMLIT_VIEWPORT_HEIGHT};
    for (const sc of scrollers) {
      if (sc && sc.scrollHeight > sc.clientHeight + 20) {
        scrollHeight = sc.scrollHeight;
        clientHeight = sc.clientHeight || clientHeight;
        break;
      }
    }
    return {
      readyState: document.readyState || '',
      hasAppContainer: true,
      isRunning,
      skeletonCount,
      textLen,
      widgetCount,
      exceptionCount,
      exceptionText,
      tabCount,
      sidebarNavCount,
      scrollHeight,
      clientHeight
    };
  })()`);
}

async function waitForStreamlitUiReady(
  cdp: MinimalCdpClient,
  timeoutMs = 20_000
): Promise<StreamlitPageInspectState> {
  const deadline = Date.now() + timeoutMs;
  let lastState: StreamlitPageInspectState | null = null;
  let stableReadyTicks = 0;
  let stableExceptionTicks = 0;
  let stableBlankTicks = 0;

  while (Date.now() < deadline) {
    ensureCaptureNotStopped();
    try {
      lastState = await inspectStreamlitPage(cdp);
    } catch {
      lastState = null;
    }

    if (lastState && lastState.readyState === "complete" && lastState.hasAppContainer) {
      if (lastState.exceptionCount > 0) {
        stableExceptionTicks++;
        if (stableExceptionTicks >= 2) {
          return lastState;
        }
      } else {
        stableExceptionTicks = 0;
      }

      if (
        !lastState.isRunning &&
        lastState.skeletonCount === 0 &&
        (lastState.textLen >= 25 || lastState.widgetCount >= 2 || lastState.exceptionCount > 0)
      ) {
        stableBlankTicks = 0;
        stableReadyTicks++;
        if (stableReadyTicks >= 2) {
          await sleep(600);
          return (await inspectStreamlitPage(cdp)) || lastState;
        }
      } else {
        stableReadyTicks = 0;
        if (
          !lastState.isRunning &&
          lastState.skeletonCount === 0 &&
          lastState.exceptionCount === 0 &&
          lastState.textLen < 10 &&
          lastState.widgetCount === 0
        ) {
          stableBlankTicks++;
          if (stableBlankTicks >= 10) {
            return lastState;
          }
        } else {
          stableBlankTicks = 0;
        }
      }
    }
    await sleep(300);
  }

  if (lastState) {
    return lastState;
  }
  throw new Error("Giao diện Streamlit chưa tải hoàn tất trước thời hạn chờ.");
}

async function waitAfterInteractionSettle(cdp: MinimalCdpClient, minWaitMs: number): Promise<void> {
  await sleep(minWaitMs);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    ensureCaptureNotStopped();
    try {
      const st = await inspectStreamlitPage(cdp);
      if (st && !st.isRunning && st.skeletonCount === 0) {
        await sleep(300);
        return;
      }
    } catch {
      return;
    }
    await sleep(250);
  }
}

/**
 * Estimates visual color richness (`18..140`) by reading sampled pixels from a standard
 * uncompressed-filter/filter0-4 RGB/RGBA PNG (such as `normalizeImagesToLms16x9` output).
 */
function estimatePngColorRichness(pngBuf: Buffer): number {
  try {
    if (pngBuf.length < 33) return 24;
    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    const idatParts: Buffer[] = [];
    while (offset + 8 <= pngBuf.length) {
      const length = pngBuf.readUInt32BE(offset);
      const type = pngBuf.toString("ascii", offset + 4, offset + 8);
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      if (dataEnd + 4 > pngBuf.length) break;
      if (type === "IHDR" && length >= 13) {
        width = pngBuf.readUInt32BE(dataStart);
        height = pngBuf.readUInt32BE(dataStart + 4);
        bitDepth = pngBuf[dataStart + 8];
        colorType = pngBuf[dataStart + 9];
      } else if (type === "IDAT") {
        idatParts.push(pngBuf.subarray(dataStart, dataEnd));
      } else if (type === "IEND") {
        break;
      }
      offset = dataEnd + 4;
    }
    if (width <= 0 || height <= 0 || bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
      return 40;
    }
    const inflated = zlib.inflateSync(Buffer.concat(idatParts));
    const bpp = colorType === 2 ? 3 : 4;
    const rowBytes = 1 + width * bpp;
    if (inflated.length < height * rowBytes) return 40;

    const stepX = Math.max(1, Math.floor(width / 36));
    const stepY = Math.max(1, Math.floor(height / 24));
    const buckets = new Set<string>();
    for (let y = 0; y < height; y += stepY) {
      const rowOffset = y * rowBytes;
      if (inflated[rowOffset] !== 0) continue;
      for (let x = 0; x < width; x += stepX) {
        const px = rowOffset + 1 + x * bpp;
        const r = inflated[px] >> 4;
        const g = inflated[px + 1] >> 4;
        const b = inflated[px + 2] >> 4;
        buckets.add(`${r}-${g}-${b}`);
      }
    }
    if (buckets.size === 0) return 40;
    return Math.max(18, Math.min(140, buckets.size * 2));
  } catch {
    return 40;
  }
}

async function renderSingleStreamlitEntry(params: {
  python: StreamlitPythonResolution;
  browserBin: string;
  studentRealRoot: string;
  relEntry: string;
  realEntryFile: string;
  safeOutDir: string;
  maxShots: number;
  startIndex: number;
}): Promise<{ items: CapturedStreamlitScreenItem[]; warning?: string }> {
  const {
    python,
    browserBin,
    relEntry,
    realEntryFile,
    safeOutDir,
    maxShots,
    startIndex,
  } = params;

  const stPort = await allocateLoopbackPort();
  const tmpProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindx_st_cdp_"));
  let stProc: ChildProcess | null = null;
  let chromeProc: ChildProcess | null = null;
  let cdp: MinimalCdpClient | null = null;

  let stStderrTail = "";
  let chromeStderrTail = "";

  try {
    ensureCaptureNotStopped();
    const stArgs = [
      ...python.prefixArgs,
      "-m",
      "streamlit",
      "run",
      realEntryFile,
      "--server.address",
      "127.0.0.1",
      "--server.port",
      String(stPort),
      "--server.headless",
      "true",
      "--server.fileWatcherType",
      "none",
      "--server.runOnSave",
      "false",
      "--browser.gatherUsageStats",
      "false",
      "--global.developmentMode",
      "false",
      "--client.toolbarMode",
      "minimal",
    ];

    stProc = spawn(python.cmd, stArgs, {
      cwd: path.dirname(realEntryFile),
      env: buildSafeStreamlitEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    stProc.stdout?.on("data", () => {
      // Drain stdout so Streamlit cannot block on pipe buffer
    });
    stProc.stderr?.on("data", (chunk: Buffer) => {
      stStderrTail = (stStderrTail + chunk.toString("utf8")).slice(-1500);
    });

    await waitForStreamlitHealth({
      port: stPort,
      proc: stProc,
      getStderrTail: () => stStderrTail,
      timeoutMs: 25_000,
    });

    ensureCaptureNotStopped();
    const chromeArgs = [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-sync",
      "--disable-background-networking",
      "--mute-audio",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      `--user-data-dir=${tmpProfileDir}`,
      `--window-size=${STREAMLIT_VIEWPORT_WIDTH},${STREAMLIT_VIEWPORT_HEIGHT}`,
      "about:blank",
    ];

    chromeProc = spawn(browserBin, chromeArgs, {
      env: buildSafeStreamlitEnv(),
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
      shell: false,
    });
    chromeProc.stderr?.on("data", (chunk: Buffer) => {
      chromeStderrTail = (chromeStderrTail + chunk.toString("utf8")).slice(-3000);
    });

    const cdpPort = await waitForDevToolsPort({
      proc: chromeProc,
      getStderr: () => chromeStderrTail,
      timeoutMs: 12_000,
    });
    const pageWsUrl = await fetchLoopbackPageWsUrl(cdpPort);
    cdp = await MinimalCdpClient.connect(pageWsUrl, cdpPort);

    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: STREAMLIT_VIEWPORT_WIDTH,
      height: STREAMLIT_VIEWPORT_HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send("Page.enable");
    await cdp.send("Page.navigate", {
      url: `http://127.0.0.1:${stPort}/`,
    });

    const initialState = await waitForStreamlitUiReady(cdp, 20_000);
    if (initialState.exceptionCount > 0) {
      return {
        items: [],
        warning: `Ứng dụng Streamlit '${path.basename(relEntry)}' gặp lỗi khi khởi chạy (${initialState.exceptionText || "Traceback"}), đã bỏ qua ảnh lỗi.`,
      };
    }
    if (
      !initialState.hasAppContainer ||
      (initialState.textLen < 10 && initialState.widgetCount === 0)
    ) {
      return {
        items: [],
        warning: `Ứng dụng Streamlit '${path.basename(relEntry)}' chưa hiển thị nội dung trên giao diện (trang trống).`,
      };
    }

    // Hide Streamlit toolbar / decoration / running banner & scrollbars only AFTER UI is ready
    await cdp.evalJson(`(() => {
      if (!document.getElementById('mindx-st-hide-chrome')) {
        const s = document.createElement('style');
        s.id = 'mindx-st-hide-chrome';
        s.textContent = '[data-testid="stToolbar"], [data-testid="stDecoration"], [data-testid="stStatusWidget"], #MainMenu, footer, .stDeployButton { visibility: hidden !important; display: none !important; } ::-webkit-scrollbar { display: none !important; } * { scrollbar-width: none !important; }';
        document.head && document.head.appendChild(s);
      }
      return true;
    })()`);
    await sleep(150);

    const baseStem = path.basename(relEntry, path.extname(relEntry));
    const safeStem =
      baseStem.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") ||
      "streamlit";
    const capLimit = Math.min(Math.max(1, maxShots), MAX_STREAMLIT_SHOTS_PER_RUN);
    const items: CapturedStreamlitScreenItem[] = [];
    const seenHashes = new Set<string>();

    const captureCurrentView = async (
      suffix: string,
      screenLabel: string,
      isHero: boolean,
      widgetCountHint: number
    ) => {
      ensureCaptureNotStopped();
      if (items.length >= capLimit) return;
      const shot = await cdp!.send<{ data?: string }>(
        "Page.captureScreenshot",
        { format: "png", fromSurface: true },
        10_000
      );
      if (!shot?.data) return;
      const rawBuf = Buffer.from(shot.data, "base64");
      if (rawBuf.length < 64) return;

      const normalized = await normalizeImagesToLms16x9([
        { buffer: rawBuf, mimeType: "image/png", fit: "cover" },
      ]);
      ensureCaptureNotStopped();
      const finalBuf = normalized[0];
      if (!finalBuf || finalBuf.length < 64) return;

      const hash6 = crypto.createHash("md5").update(finalBuf).digest("hex").slice(0, 6);
      if (seenHashes.has(hash6)) return;
      seenHashes.add(hash6);

      const shotNum = startIndex + items.length + 1;
      const fileName = suffix
        ? `app_${String(shotNum).padStart(2, "0")}_${safeStem}_${suffix}_${hash6}.png`
        : `app_${String(shotNum).padStart(2, "0")}_${safeStem}_${hash6}.png`;
      const outPath = assertPathAllowed(path.join(safeOutDir, fileName));
      if (!isSubpathOrEqual(outPath, safeOutDir)) return;
      if (fs.lstatSync(outPath, { throwIfNoEntry: false })?.isSymbolicLink()) return;
      fs.writeFileSync(outPath, finalBuf);

      const colorRichness = estimatePngColorRichness(finalBuf);
      const heuristicScore =
        colorRichness * 3 +
        Math.min(widgetCountHint, 60) * 2 +
        (isHero ? 180 : 40);

      items.push({
        filePath: outPath,
        screenName: screenLabel,
        sourceFile: relEntry,
        width: LMS_IMAGE_WIDTH,
        height: LMS_IMAGE_HEIGHT,
        widgetCount: widgetCountHint,
        colorRichness,
        isAuthScreen: false,
        heuristicScore,
      });
    };

    // 1. Hero view (top viewport)
    await captureCurrentView("", baseStem, true, initialState.widgetCount);

    const clickIndexedElementViaCdp = async (
      selector: string,
      index: number
    ): Promise<boolean> => {
      const targetBox = await cdp!.evalJson<{
        found: boolean;
        x?: number;
        y?: number;
      }>(`(() => {
        const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
        const el = els[${index}];
        if (!el) return { found: false };
        try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
        const r = el.getBoundingClientRect();
        if (r && r.width > 1 && r.height > 1) {
          return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        el.click();
        return { found: true };
      })()`);
      if (!targetBox?.found) return false;
      if (typeof targetBox.x === "number" && typeof targetBox.y === "number") {
        await cdp!.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: targetBox.x,
          y: targetBox.y,
        });
        await cdp!.send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          x: targetBox.x,
          y: targetBox.y,
          button: "left",
          clickCount: 1,
        });
        await cdp!.send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x: targetBox.x,
          y: targetBox.y,
          button: "left",
          clickCount: 1,
        });
      }
      return true;
    };

    // 2. Interactive / scrolled extra views
    if (items.length < capLimit && initialState.tabCount >= 2) {
      const extraTabs = Math.min(initialState.tabCount - 1, capLimit - items.length);
      for (let tIdx = 1; tIdx <= extraTabs; tIdx++) {
        ensureCaptureNotStopped();
        const clicked = await clickIndexedElementViaCdp(
          '[data-testid="stTabs"] [role="tab"], [data-baseweb="tab-list"] [role="tab"], [role="tablist"] [role="tab"]',
          tIdx
        );
        if (!clicked) continue;
        await waitAfterInteractionSettle(cdp, 650);
        const stNow = await inspectStreamlitPage(cdp);
        if (stNow && stNow.exceptionCount > 0) continue;
        await captureCurrentView(
          `tab${tIdx + 1}`,
          `${baseStem}_tab${tIdx + 1}`,
          false,
          stNow?.widgetCount ?? initialState.widgetCount
        );
      }
    } else if (items.length < capLimit && initialState.sidebarNavCount >= 2) {
      const extraPages = Math.min(
        initialState.sidebarNavCount - 1,
        capLimit - items.length,
        2
      );
      for (let pIdx = 1; pIdx <= extraPages; pIdx++) {
        ensureCaptureNotStopped();
        const clicked = await clickIndexedElementViaCdp(
          '[data-testid="stSidebarNav"] a',
          pIdx
        );
        if (!clicked) continue;
        await waitAfterInteractionSettle(cdp, 900);
        const stNow = await inspectStreamlitPage(cdp);
        if (stNow && stNow.exceptionCount > 0) continue;
        await captureCurrentView(
          `page${pIdx + 1}`,
          `${baseStem}_page${pIdx + 1}`,
          false,
          stNow?.widgetCount ?? initialState.widgetCount
        );
      }
    } else if (
      items.length < capLimit &&
      initialState.scrollHeight >= Math.round(initialState.clientHeight * 1.45)
    ) {
      const maxScrollY = Math.max(0, initialState.scrollHeight - initialState.clientHeight);
      const stepY = Math.max(300, Math.round(initialState.clientHeight * 0.85));
      const maxExtraScrolls = Math.min(2, capLimit - items.length);
      for (let sIdx = 1; sIdx <= maxExtraScrolls; sIdx++) {
        ensureCaptureNotStopped();
        const targetY = Math.min(sIdx * stepY, maxScrollY);
        if (targetY < 160) break;
        const scrolled = await cdp.evalJson<boolean>(`(() => {
          const scrollers = [
            document.querySelector('[data-testid="stMain"]'),
            document.querySelector('[data-testid="stAppViewContainer"]'),
            document.querySelector('section.main'),
            document.scrollingElement
          ].filter(Boolean);
          for (const sc of scrollers) {
            if (sc && sc.scrollHeight > sc.clientHeight + 20) {
              sc.scrollTop = ${targetY};
              if (sc === document.scrollingElement) {
                window.scrollTo(0, ${targetY});
              }
              return true;
            }
          }
          window.scrollTo(0, ${targetY});
          return true;
        })()`);
        if (!scrolled) break;
        await sleep(450);
        await captureCurrentView(
          `sec${sIdx}`,
          `${baseStem}_section${sIdx}`,
          false,
          initialState.widgetCount
        );
        if (targetY >= maxScrollY) break;
      }
    }

    return { items };
  } finally {
    if (cdp) {
      await cdp.close().catch(() => undefined);
    }
    await Promise.all([
      chromeProc
        ? killChildTree(chromeProc.pid, () => chromeProc?.kill("SIGKILL"))
        : Promise.resolve(),
      stProc
        ? killChildTree(stProc.pid, () => stProc?.kill("SIGKILL"))
        : Promise.resolve(),
    ]);
    await sleep(200);
    try {
      fs.rmSync(tmpProfileDir, {
        recursive: true,
        force: true,
        maxRetries: 6,
        retryDelay: 200,
      });
    } catch {
      // ignore temp profile cleanup locks on Windows
    }
  }
}

/**
 * Launches up to the first 2 candidate Streamlit scripts for a student folder,
 * captures up to `maxShots` `960×540` screenshots into `outDir`, and returns
 * captured items plus a diagnostic warning if execution/rendering failed.
 */
export async function captureStreamlitAppScreenshotsAsync(params: {
  studentDir: string;
  streamlitFiles?: string[];
  outDir: string;
  maxShots: number;
}): Promise<StreamlitCaptureBatchResult> {
  ensureCaptureNotStopped();
  if (isOfflineAuditMode()) {
    return { items: [] };
  }

  const safeStudentDir = assertPathAllowed(params.studentDir);
  if (fs.lstatSync(safeStudentDir).isSymbolicLink()) {
    return { items: [], warning: "Từ chối thư mục học viên dạng symlink." };
  }
  const realStudentRoot = assertPathAllowed(fs.realpathSync(safeStudentDir));
  const safeOutDir = resolveSafeDirWithinStudent(realStudentRoot, params.outDir);
  if (!safeOutDir) {
    return {
      items: [],
      warning: "Từ chối thư mục xuất ảnh nằm ngoài thư mục học viên hoặc chứa symlink.",
    };
  }

  const candidates =
    params.streamlitFiles && params.streamlitFiles.length > 0
      ? params.streamlitFiles
      : findProjectStreamlitFiles(realStudentRoot);
  if (candidates.length === 0) {
    return { items: [] };
  }

  const browserBin = detectHeadlessBrowserExecutable();
  if (!browserBin) {
    return {
      items: [],
      warning:
        "Không tìm thấy trình duyệt Chrome/Edge để chụp giao diện Streamlit tự động.",
    };
  }

  const python = await resolveStreamlitPythonExecutableAsync(realStudentRoot);
  if (!python || (python.source !== "env_override" && isSubpathOrEqual(python.cmd, realStudentRoot))) {
    return {
      items: [],
      warning:
        "Không tìm thấy môi trường Python có cài `streamlit` để chụp tự động ứng dụng app.py.",
    };
  }

  const warnings: string[] = [];
  for (let i = 0; i < Math.min(2, candidates.length); i++) {
    ensureCaptureNotStopped();
    const relEntry = candidates[i];
    const absCandidate = path.resolve(realStudentRoot, relEntry);
    const realEntryFile = resolveSafeFileWithinStudent(realStudentRoot, absCandidate);
    if (!realEntryFile) continue;

    try {
      const rendered = await renderSingleStreamlitEntry({
        python,
        browserBin,
        studentRealRoot: realStudentRoot,
        relEntry,
        realEntryFile,
        safeOutDir,
        maxShots: Math.min(Math.max(1, params.maxShots), MAX_STREAMLIT_SHOTS_PER_RUN),
        startIndex: 0,
      });
      if (rendered.items.length > 0) {
        return { items: rendered.items };
      }
      if (rendered.warning) {
        warnings.push(rendered.warning);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("TASK_CANCELLED:")) {
        throw err;
      }
      warnings.push(
        `Không thể chụp tự động '${path.basename(relEntry)}': ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  return {
    items: [],
    warning: warnings.length > 0 ? warnings.join(" | ") : undefined,
  };
}
