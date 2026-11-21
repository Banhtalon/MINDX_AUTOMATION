/**
 * MINDX AUTOMATION BOT - DEMO DAY SAFE LOCAL LAUNCHER & GAMEMAKER STAGER
 * Strictly validates containment inside an allowlisted student SPCK folder (no symlinks,
 * no traversal, no forbidden executables) before launching Python apps, GameMaker LTS 2026
 * projects (staged safely into `os.tmpdir()`), or local Slide files (`.pptx`/`.pdf`).
 */

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import AdmZip from "adm-zip";
import { isSensitiveSecretFile } from "../local-files/spck-scanner";
import { assertPathAllowed } from "../security/path-allowlist";

export const ALLOWED_LOCAL_SLIDE_EXTS = new Set([".pptx", ".ppt", ".pdf"]);
export const ALLOWED_LAUNCH_PRODUCT_EXTS = new Set([
  ".py",
  ".html",
  ".htm",
  ".yyp",
  ".yyz",
  ".exe",
  ".sb3",
  ".mp4",
  ".webm",
  ".mov",
]);

const MAX_GAMEMAKER_COMPRESSED_BYTES = 250 * 1024 * 1024;
const MAX_GAMEMAKER_ARCHIVE_BYTES = 600 * 1024 * 1024;
const MAX_GAMEMAKER_SINGLE_ENTRY_BYTES = 200 * 1024 * 1024;
const MAX_GAMEMAKER_ARCHIVE_ENTRIES = 8000;
const MAX_GAMEMAKER_COMPRESSION_RATIO = 100;
const DUPLICATE_LAUNCH_COOLDOWN_MS = 1800;
const PYTHON_CRASH_WAIT_MS = 1200;

interface ActiveDemoProcInfo {
  pid: number;
  classId: string;
  studentId: string;
  fileName: string;
  startedAtMs: number;
}

export interface DryRunLaunchRecord {
  timestamp: string;
  action: string;
  classId: string;
  studentId: string;
  filePath: string;
  stagedYypPath?: string;
  reusedCache?: boolean;
}

export interface DemoLaunchResult {
  ok: boolean;
  message?: string;
  error?: string;
  debounced?: boolean;
  dryRun?: boolean;
  pid?: number;
  stagedYypPath?: string;
  reusedCache?: boolean;
  activeProcessCount: number;
}

const g = globalThis as unknown as {
  __mindxDemoActiveProcs?: Map<number, ActiveDemoProcInfo>;
  __mindxDemoLaunchCooldowns?: Map<string, number>;
  __mindxDemoDryRunLog?: DryRunLaunchRecord[];
  __mindxDemoPythonCmd?: { cmd: string; prefixArgs: string[] } | null;
  __mindxDemoGameMakerExe?: string | null;
};

function getActiveProcsMap(): Map<number, ActiveDemoProcInfo> {
  if (!g.__mindxDemoActiveProcs) {
    g.__mindxDemoActiveProcs = new Map();
  }
  return g.__mindxDemoActiveProcs;
}

function getCooldownMap(): Map<string, number> {
  if (!g.__mindxDemoLaunchCooldowns) {
    g.__mindxDemoLaunchCooldowns = new Map();
  }
  return g.__mindxDemoLaunchCooldowns;
}

export function getDryRunLaunchLog(): DryRunLaunchRecord[] {
  if (!g.__mindxDemoDryRunLog) {
    g.__mindxDemoDryRunLog = [];
  }
  return [...g.__mindxDemoDryRunLog];
}

export function clearDryRunLaunchLog(): void {
  g.__mindxDemoDryRunLog = [];
  getCooldownMap().clear();
}

function pushDryRunRecord(rec: DryRunLaunchRecord): void {
  if (!g.__mindxDemoDryRunLog) {
    g.__mindxDemoDryRunLog = [];
  }
  g.__mindxDemoDryRunLog.push(rec);
  if (g.__mindxDemoDryRunLog.length > 100) {
    g.__mindxDemoDryRunLog.shift();
  }
}

function isDryRunMode(): boolean {
  return process.env.MINDX_DEMO_LAUNCH_DRY_RUN === "1";
}

function allowPythonInDryRun(): boolean {
  return process.env.MINDX_DEMO_ALLOW_PYTHON_IN_DRY_RUN === "1";
}

function normalizePathKey(p: string): string {
  return process.platform === "win32" ? p.toLowerCase() : p;
}

/**
 * Strictly validates that `relPath` points to an existing regular file strictly contained
 * inside `studentRootDir` (and inside `ALLOWED_LOCAL_DIRS`), with zero symlinks or junctions
 * anywhere along the chain.
 */
export function resolveSafeStudentFile(
  studentRootDir: string,
  relPath: string
): string {
  const rawRoot = String(studentRootDir || "").trim();
  const rawRel = String(relPath || "").trim();

  if (!rawRoot || !rawRel) {
    throw new Error("Thiếu đường dẫn thư mục hoặc tệp sản phẩm.");
  }
  if (rawRoot.includes("\0") || rawRel.includes("\0")) {
    throw new Error("Đường dẫn chứa ký tự null không hợp lệ.");
  }
  if (/^[a-z]:/i.test(rawRel) || rawRel.startsWith("/") || rawRel.startsWith("\\")) {
    throw new Error("Chỉ chấp nhận đường dẫn tương đối bên trong thư mục học sinh.");
  }

  const safeRoot = assertPathAllowed(rawRoot);
  let rootStat: fs.Stats;
  try {
    rootStat = fs.lstatSync(safeRoot);
  } catch {
    throw new Error("Không tìm thấy thư mục bài làm của học sinh.");
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("Thư mục học sinh không hợp lệ hoặc là symlink.");
  }
  const realRoot = fs.realpathSync(safeRoot);

  const segs = rawRel
    .replace(/\\/g, "/")
    .split("/")
    .filter((s) => s.length > 0);
  if (segs.length === 0) {
    throw new Error("Đường dẫn tệp rỗng.");
  }
  for (const seg of segs) {
    if (seg === "." || seg === ".." || seg.includes("\0")) {
      throw new Error(`Đường dẫn không hợp lệ ('${seg}').`);
    }
    if (isSensitiveSecretFile(seg)) {
      throw new Error(`Bị chặn mở tệp nhạy cảm '${seg}'.`);
    }
  }

  let current = safeRoot;
  for (let i = 0; i < segs.length; i++) {
    current = path.join(current, segs[i]);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(current);
    } catch {
      throw new Error(`Không tìm thấy tệp '${rawRel}'.`);
    }
    if (st.isSymbolicLink()) {
      throw new Error(`Từ chối mở symlink/junction '${segs[i]}'.`);
    }
    if (i < segs.length - 1 && !st.isDirectory()) {
      throw new Error(`Đường dẫn thư mục không hợp lệ tại '${segs[i]}'.`);
    }
  }

  const finalStat = fs.lstatSync(current);
  if (!finalStat.isFile()) {
    throw new Error(`'${rawRel}' không phải là tệp hợp lệ.`);
  }

  assertPathAllowed(current);
  const realTarget = fs.realpathSync(current);
  const normRoot = normalizePathKey(realRoot);
  const normTarget = normalizePathKey(realTarget);
  const rootPrefix = normRoot.endsWith(path.sep) ? normRoot : normRoot + path.sep;
  if (!normTarget.startsWith(rootPrefix)) {
    throw new Error("Đường dẫn tệp vượt ra ngoài thư mục của học sinh.");
  }

  const baseLower = path.basename(realTarget).toLowerCase();
  const sampleBuf = finalStat.size <= 64 * 1024 ? fs.readFileSync(realTarget) : undefined;
  if (isSensitiveSecretFile(baseLower, sampleBuf)) {
    throw new Error(`Tệp '${path.basename(realTarget)}' bị chặn vì chứa thông tin nhạy cảm.`);
  }

  return realTarget;
}

function checkAndRecordCooldown(
  classId: string,
  studentId: string,
  action: string
): boolean {
  const key = `${classId.toUpperCase()}::${studentId}::${action}`;
  const now = Date.now();
  const prev = getCooldownMap().get(key) || 0;
  if (now - prev < DUPLICATE_LAUNCH_COOLDOWN_MS) {
    return true;
  }
  getCooldownMap().set(key, now);
  return false;
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function getActiveDemoProcessCount(): number {
  const map = getActiveProcsMap();
  for (const [pid] of map) {
    if (!isPidAlive(pid)) {
      map.delete(pid);
    }
  }
  return map.size;
}

export function stopActiveDemoProcesses(): {
  stoppedCount: number;
  activeProcessCount: number;
} {
  const map = getActiveProcsMap();
  let stoppedCount = 0;
  for (const [pid] of map) {
    try {
      if (isPidAlive(pid)) {
        if (process.platform === "win32") {
          spawnSync("taskkill", ["/F", "/T", "/PID", String(pid)], {
            stdio: "ignore",
            windowsHide: true,
            shell: false,
          });
        } else {
          process.kill(pid, "SIGKILL");
        }
        stoppedCount++;
      }
    } catch {
      // Ignore already exited processes
    } finally {
      map.delete(pid);
    }
  }
  return {
    stoppedCount,
    activeProcessCount: getActiveDemoProcessCount(),
  };
}

function resolvePythonExecutable(): { cmd: string; prefixArgs: string[] } {
  if (g.__mindxDemoPythonCmd) {
    return g.__mindxDemoPythonCmd;
  }
  const candidates: Array<{ cmd: string; prefixArgs: string[] }> =
    process.platform === "win32"
      ? [
          { cmd: "python", prefixArgs: [] },
          { cmd: "py", prefixArgs: ["-3"] },
        ]
      : [
          { cmd: "python3", prefixArgs: [] },
          { cmd: "python", prefixArgs: [] },
        ];

  for (const cand of candidates) {
    try {
      const probe = spawnSync(cand.cmd, [...cand.prefixArgs, "--version"], {
        stdio: "ignore",
        windowsHide: true,
        shell: false,
        timeout: 4000,
      });
      if (probe.status === 0) {
        g.__mindxDemoPythonCmd = cand;
        return cand;
      }
    } catch {
      // Try next
    }
  }

  throw new Error("Không tìm thấy Python trên máy tính này.");
}

function resolveGameMakerExecutable(): string | null {
  if (g.__mindxDemoGameMakerExe !== undefined) {
    return g.__mindxDemoGameMakerExe;
  }

  if (process.platform === "win32") {
    const regKeys = [
      "HKLM\\Software\\Classes\\GMS2-LTS2026_Project\\shell\\open\\command",
      "HKCU\\Software\\Classes\\GMS2-LTS2026_Project\\shell\\open\\command",
      "HKLM\\Software\\Classes\\GameMakerStudio2_Project\\shell\\open\\command",
    ];
    for (const key of regKeys) {
      try {
        const res = spawnSync("reg", ["query", key, "/ve"], {
          encoding: "utf8",
          windowsHide: true,
          shell: false,
          timeout: 3000,
        });
        if (res.status === 0 && res.stdout) {
          const match = res.stdout.match(/"([^"]+GameMaker[^"]*\.exe)"/i);
          if (match && fs.existsSync(match[1])) {
            g.__mindxDemoGameMakerExe = match[1];
            return match[1];
          }
        }
      } catch {
        // Continue fallback
      }
    }

    const fallbackPaths = [
      "E:\\SOFT\\GameMaker-LTS2026\\GameMaker-LTS2026.exe",
      "C:\\Program Files\\GameMaker\\GameMaker.exe",
      "C:\\Program Files\\GameMaker Studio 2\\GameMakerStudio.exe",
      path.join(
        process.env.LOCALAPPDATA || "",
        "GameMakerStudio2",
        "GameMakerStudio.exe"
      ),
    ];
    for (const cand of fallbackPaths) {
      if (cand && fs.existsSync(cand)) {
        g.__mindxDemoGameMakerExe = cand;
        return cand;
      }
    }
  }

  g.__mindxDemoGameMakerExe = null;
  return null;
}

function copyProjectTreeSafe(srcDir: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  const skippedDirs = new Set([
    "node_modules",
    ".git",
    ".venv",
    "venv",
    "__pycache__",
    "_spck_app_shots",
    "_spck_owner_uploads",
    "_spck_youtube_frames",
    "_spck_prev_backup",
    "_portal_backups",
  ]);
  for (const entry of entries) {
    const lower = entry.name.toLowerCase();
    if (entry.name.startsWith(".") || skippedDirs.has(lower)) continue;
    const srcChild = path.join(srcDir, entry.name);
    const destChild = path.join(destDir, entry.name);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(srcChild);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      copyProjectTreeSafe(srcChild, destChild);
    } else if (st.isFile()) {
      fs.copyFileSync(srcChild, destChild);
    }
  }
}

function findShallowestYypInsideDir(rootDir: string): string | null {
  const found: Array<{ filePath: string; depth: number }> = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".yyp")) {
        found.push({ filePath: full, depth });
      }
    }
  };
  walk(rootDir, 0);
  if (found.length === 0) return null;
  found.sort((a, b) => a.depth - b.depth || a.filePath.localeCompare(b.filePath, "en"));
  return found[0].filePath;
}

/**
 * Unpacks a student GameMaker `.yyz` archive (or copies a `.yyp` folder) strictly inside
 * `os.tmpdir()/mindx-demo-gm-stage/` so the original student SPCK folder is never mutated.
 */
export function stageGameMakerProjectToTemp(params: {
  classId: string;
  studentId: string;
  studentRootDir: string;
  relPath: string;
}): { stagedYypPath: string; reusedCache: boolean } {
  const safeFile = resolveSafeStudentFile(params.studentRootDir, params.relPath);
  const ext = path.extname(safeFile).toLowerCase();
  if (ext !== ".yyz" && ext !== ".yyp") {
    throw new Error("Tệp không phải dự án GameMaker (.yyz hoặc .yyp).");
  }

  const stat = fs.statSync(safeFile);
  const stageKey = crypto
    .createHash("sha256")
    .update(`${params.classId.toUpperCase()}|${params.studentId}|${safeFile}`)
    .digest("hex")
    .slice(0, 16);

  const stageBase = path.join(os.tmpdir(), "mindx-demo-gm-stage");
  const stageDir = path.join(stageBase, stageKey);
  const readyMarkerPath = path.join(stageDir, ".ready.json");

  if (fs.existsSync(readyMarkerPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(readyMarkerPath, "utf8")) as {
        sourcePath?: string;
        size?: number;
        mtimeMs?: number;
        stagedYypPath?: string;
      };
      if (
        meta.sourcePath === safeFile &&
        meta.size === stat.size &&
        meta.mtimeMs === stat.mtimeMs &&
        meta.stagedYypPath &&
        fs.existsSync(meta.stagedYypPath)
      ) {
        return { stagedYypPath: meta.stagedYypPath, reusedCache: true };
      }
    } catch {
      // Rebuild stage below
    }
  }

  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  try {
    let stagedYypPath = "";
    if (ext === ".yyz") {
      if (stat.size > MAX_GAMEMAKER_COMPRESSED_BYTES) {
        throw new Error("Dung lượng tệp nén .yyz vượt quá giới hạn an toàn (250 MB).");
      }

      const zip = new AdmZip(safeFile);
      const entries = zip.getEntries();
      if (entries.length > MAX_GAMEMAKER_ARCHIVE_ENTRIES) {
        throw new Error("Gói .yyz chứa quá nhiều tệp vượt giới hạn an toàn.");
      }

      let declaredTotalBytes = 0;
      for (const entry of entries) {
        const rawName = String(entry.entryName || "").replace(/\\/g, "/");
        if (!rawName || rawName.includes("\0") || rawName.startsWith("/") || /^[a-z]:/i.test(rawName)) {
          throw new Error(`Phát hiện đường dẫn không hợp lệ bên trong .yyz: '${rawName}'.`);
        }
        const segs = rawName.split("/").filter(Boolean);
        if (segs.some((s) => s === "." || s === "..")) {
          throw new Error(`Phát hiện đường dẫn thoát thư mục bên trong .yyz: '${rawName}'.`);
        }
        if (entry.isDirectory) continue;

        const declaredSize = Number(entry.header?.size ?? 0);
        const compressedSize = Number(entry.header?.compressedSize ?? 0);
        if (!Number.isFinite(declaredSize) || declaredSize < 0 || declaredSize > MAX_GAMEMAKER_SINGLE_ENTRY_BYTES) {
          throw new Error("Một tệp bên trong .yyz vượt quá giới hạn 200 MB.");
        }
        declaredTotalBytes += declaredSize;
        if (declaredTotalBytes > MAX_GAMEMAKER_ARCHIVE_BYTES) {
          throw new Error("Tổng dung lượng khai báo trong .yyz vượt quá 600 MB.");
        }
        if (
          declaredSize > 5 * 1024 * 1024 &&
          compressedSize > 0 &&
          declaredSize / compressedSize > MAX_GAMEMAKER_COMPRESSION_RATIO
        ) {
          throw new Error("Phát hiện tệp nén có tỷ lệ nén bất thường bên trong .yyz.");
        }
      }

      let totalBytes = 0;
      const realStageDir = fs.realpathSync(stageDir);
      const normStagePrefix = normalizePathKey(realStageDir).endsWith(path.sep)
        ? normalizePathKey(realStageDir)
        : normalizePathKey(realStageDir) + path.sep;

      for (const entry of entries) {
        if (entry.isDirectory) continue;
        const segs = String(entry.entryName || "")
          .replace(/\\/g, "/")
          .split("/")
          .filter(Boolean);

        const remainingBudget = MAX_GAMEMAKER_ARCHIVE_BYTES - totalBytes;
        const entryCap = Math.min(remainingBudget, MAX_GAMEMAKER_SINGLE_ENTRY_BYTES);
        if (entryCap <= 0) {
          throw new Error("Dung lượng giải nén .yyz vượt quá 600 MB.");
        }

        let data: Buffer;
        const method = Number(entry.header?.method ?? 0);
        if (method === 0) {
          const raw = entry.getCompressedData();
          if (raw.length > entryCap) {
            throw new Error("Dung lượng giải nén .yyz vượt quá 600 MB.");
          }
          data = raw;
        } else if (method === 8) {
          const compressed = entry.getCompressedData();
          try {
            data = zlib.inflateRawSync(compressed, { maxOutputLength: entryCap });
          } catch {
            throw new Error("Dung lượng giải nén .yyz vượt quá giới hạn an toàn (600 MB).");
          }
        } else {
          data = entry.getData();
          if (data.length > entryCap) {
            throw new Error("Dung lượng giải nén .yyz vượt quá 600 MB.");
          }
        }

        totalBytes += data.length;
        if (totalBytes > MAX_GAMEMAKER_ARCHIVE_BYTES) {
          throw new Error("Dung lượng giải nén .yyz vượt quá 600 MB.");
        }

        const destPath = path.resolve(stageDir, ...segs);
        const normDest = normalizePathKey(destPath);
        if (!normDest.startsWith(normStagePrefix)) {
          throw new Error("Đường dẫn giải nén thoát khỏi vùng tạm cho phép.");
        }
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.writeFileSync(destPath, data);
      }
      stagedYypPath = findShallowestYypInsideDir(stageDir) || "";
      if (!stagedYypPath) {
        throw new Error("Không tìm thấy tệp .yyp bên trong gói GameMaker .yyz.");
      }
    } else {
      const projectDir = path.dirname(safeFile);
      copyProjectTreeSafe(projectDir, stageDir);
      stagedYypPath = path.join(stageDir, path.basename(safeFile));
      if (!fs.existsSync(stagedYypPath)) {
        stagedYypPath = findShallowestYypInsideDir(stageDir) || "";
      }
      if (!stagedYypPath) {
        throw new Error("Không sao chép được tệp .yyp sang thư mục tạm.");
      }
    }

    fs.writeFileSync(
      readyMarkerPath,
      JSON.stringify({
        sourcePath: safeFile,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        stagedYypPath,
      }),
      "utf8"
    );

    return { stagedYypPath, reusedCache: false };
  } catch (err) {
    fs.rmSync(stageDir, { recursive: true, force: true });
    throw err;
  }
}

function spawnWindowsShellOpen(targetPath: string): void {
  if (process.platform !== "win32") {
    throw new Error("Mở tệp trực tiếp chỉ hỗ trợ trên Windows.");
  }
  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-Command",
      "Start-Process -LiteralPath $env:MINDX_LAUNCH_TARGET",
    ],
    {
      env: {
        ...process.env,
        MINDX_LAUNCH_TARGET: targetPath,
      },
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: false,
    }
  );
  child.unref();
}

function formatPythonCrashMessage(stderrText: string, fileName: string): string {
  const modMatch = stderrText.match(/ModuleNotFoundError:\s*No module named\s*['"]([^'"]+)['"]/i);
  if (modMatch) {
    return `Thiếu thư viện '${modMatch[1]}' trên máy thầy khi chạy ${fileName}.`;
  }
  const syntaxMatch = stderrText.match(/SyntaxError:\s*([^\r\n]+)/i);
  if (syntaxMatch) {
    return `Lỗi cú pháp trong ${fileName}: ${syntaxMatch[1].slice(0, 120)}`;
  }
  const lastLine = stderrText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  return lastLine
    ? `Không chạy được ${fileName}: ${lastLine.slice(0, 140)}`
    : `Tệp ${fileName} bị thoát lỗi ngay khi mở.`;
}

async function launchPythonFile(params: {
  classId: string;
  studentId: string;
  safeFile: string;
}): Promise<DemoLaunchResult> {
  const fileName = path.basename(params.safeFile);
  if (isDryRunMode() && !allowPythonInDryRun()) {
    pushDryRunRecord({
      timestamp: new Date().toISOString(),
      action: "LAUNCH_PYTHON",
      classId: params.classId,
      studentId: params.studentId,
      filePath: params.safeFile,
    });
    return {
      ok: true,
      dryRun: true,
      message: `✓ Đã bật ${fileName}`,
      activeProcessCount: getActiveDemoProcessCount(),
    };
  }

  stopActiveDemoProcesses();
  const py = resolvePythonExecutable();

  return new Promise<DemoLaunchResult>((resolve) => {
    const child = spawn(py.cmd, [...py.prefixArgs, params.safeFile], {
      cwd: path.dirname(params.safeFile),
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: false,
      shell: false,
    });

    let stderrBuf = "";
    let settled = false;

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrBuf.length < 8192) {
        stderrBuf += chunk.toString("utf8");
      }
    });

    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      resolve({
        ok: false,
        error: `Không khởi chạy được Python cho ${fileName}: ${err.message}`,
        activeProcessCount: getActiveDemoProcessCount(),
      });
    });

    child.once("exit", (code) => {
      if (child.pid) {
        getActiveProcsMap().delete(child.pid);
      }
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({
          ok: true,
          pid: child.pid,
          message: `✓ Đã chạy xong ${fileName}`,
          activeProcessCount: getActiveDemoProcessCount(),
        });
      } else {
        resolve({
          ok: false,
          error: formatPythonCrashMessage(stderrBuf, fileName),
          activeProcessCount: getActiveDemoProcessCount(),
        });
      }
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (child.pid) {
        getActiveProcsMap().set(child.pid, {
          pid: child.pid,
          classId: params.classId.toUpperCase(),
          studentId: params.studentId,
          fileName,
          startedAtMs: Date.now(),
        });
      }
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
      resolve({
        ok: true,
        pid: child.pid,
        message: `✓ Đang chạy ${fileName}`,
        activeProcessCount: getActiveDemoProcessCount(),
      });
    }, PYTHON_CRASH_WAIT_MS);
  });
}

export async function launchLocalSlideFile(params: {
  classId: string;
  studentId: string;
  studentRootDir: string;
  relPath: string;
}): Promise<DemoLaunchResult> {
  const safeFile = resolveSafeStudentFile(params.studentRootDir, params.relPath);
  const ext = path.extname(safeFile).toLowerCase();
  if (!ALLOWED_LOCAL_SLIDE_EXTS.has(ext)) {
    throw new Error("Chỉ hỗ trợ mở tệp Slide .pptx, .ppt hoặc .pdf.");
  }

  if (checkAndRecordCooldown(params.classId, params.studentId, "OPEN_SLIDE")) {
    return {
      ok: true,
      debounced: true,
      message: "✓ Đang mở Slide",
      activeProcessCount: getActiveDemoProcessCount(),
    };
  }

  const fileName = path.basename(safeFile);
  if (isDryRunMode()) {
    pushDryRunRecord({
      timestamp: new Date().toISOString(),
      action: "OPEN_SLIDE",
      classId: params.classId,
      studentId: params.studentId,
      filePath: safeFile,
    });
    return {
      ok: true,
      dryRun: true,
      message: `✓ Đã mở ${fileName}`,
      activeProcessCount: getActiveDemoProcessCount(),
    };
  }

  spawnWindowsShellOpen(safeFile);
  return {
    ok: true,
    message: `✓ Đã mở ${fileName}`,
    activeProcessCount: getActiveDemoProcessCount(),
  };
}

export async function launchLocalProductFile(params: {
  classId: string;
  studentId: string;
  studentRootDir: string;
  relPath: string;
  isTest?: boolean;
}): Promise<DemoLaunchResult> {
  const safeFile = resolveSafeStudentFile(params.studentRootDir, params.relPath);
  const ext = path.extname(safeFile).toLowerCase();
  if (!ALLOWED_LAUNCH_PRODUCT_EXTS.has(ext)) {
    throw new Error(`Định dạng tệp '${ext || "(không có đuôi)"}' không được phép chạy trực tiếp.`);
  }

  const fileName = path.basename(safeFile);
  if (ext === ".exe" && /^(unins|setup|install|vcredist|dxsetup)/i.test(fileName)) {
    throw new Error(`Tệp '${fileName}' bị chặn vì không phải tệp game của học sinh.`);
  }

  const actionKey = params.isTest ? "TEST_PRODUCT" : "LAUNCH_PRODUCT";
  if (checkAndRecordCooldown(params.classId, params.studentId, actionKey)) {
    return {
      ok: true,
      debounced: true,
      message: "✓ Đang mở sản phẩm",
      activeProcessCount: getActiveDemoProcessCount(),
    };
  }

  if (ext === ".py") {
    return launchPythonFile({
      classId: params.classId,
      studentId: params.studentId,
      safeFile,
    });
  }

  if (ext === ".yyz" || ext === ".yyp") {
    const staged = stageGameMakerProjectToTemp({
      classId: params.classId,
      studentId: params.studentId,
      studentRootDir: params.studentRootDir,
      relPath: params.relPath,
    });

    if (isDryRunMode()) {
      pushDryRunRecord({
        timestamp: new Date().toISOString(),
        action: "LAUNCH_GAMEMAKER",
        classId: params.classId,
        studentId: params.studentId,
        filePath: safeFile,
        stagedYypPath: staged.stagedYypPath,
        reusedCache: staged.reusedCache,
      });
      return {
        ok: true,
        dryRun: true,
        stagedYypPath: staged.stagedYypPath,
        reusedCache: staged.reusedCache,
        message: "✓ Đã mở GameMaker (bấm F5 để chơi)",
        activeProcessCount: getActiveDemoProcessCount(),
      };
    }

    const gmExe = resolveGameMakerExecutable();
    if (gmExe) {
      const child = spawn(gmExe, [staged.stagedYypPath], {
        cwd: path.dirname(staged.stagedYypPath),
        detached: true,
        stdio: "ignore",
        windowsHide: false,
        shell: false,
      });
      child.unref();
    } else {
      spawnWindowsShellOpen(staged.stagedYypPath);
    }

    return {
      ok: true,
      stagedYypPath: staged.stagedYypPath,
      reusedCache: staged.reusedCache,
      message: "✓ Đã mở GameMaker (bấm F5 để chơi)",
      activeProcessCount: getActiveDemoProcessCount(),
    };
  }

  if (ext === ".exe") {
    stopActiveDemoProcesses();
    if (isDryRunMode()) {
      pushDryRunRecord({
        timestamp: new Date().toISOString(),
        action: "LAUNCH_EXE",
        classId: params.classId,
        studentId: params.studentId,
        filePath: safeFile,
      });
      return {
        ok: true,
        dryRun: true,
        message: `✓ Đã mở ${fileName}`,
        activeProcessCount: getActiveDemoProcessCount(),
      };
    }

    const child = spawn(safeFile, [], {
      cwd: path.dirname(safeFile),
      detached: true,
      stdio: "ignore",
      windowsHide: false,
      shell: false,
    });
    if (child.pid) {
      getActiveProcsMap().set(child.pid, {
        pid: child.pid,
        classId: params.classId.toUpperCase(),
        studentId: params.studentId,
        fileName,
        startedAtMs: Date.now(),
      });
    }
    child.unref();

    return {
      ok: true,
      pid: child.pid,
      message: `✓ Đã mở ${fileName}`,
      activeProcessCount: getActiveDemoProcessCount(),
    };
  }

  // Fallback for .mp4, .webm, .mov, .sb3
  if (isDryRunMode()) {
    pushDryRunRecord({
      timestamp: new Date().toISOString(),
      action: "LAUNCH_OTHER",
      classId: params.classId,
      studentId: params.studentId,
      filePath: safeFile,
    });
    return {
      ok: true,
      dryRun: true,
      message: `✓ Đã mở ${fileName}`,
      activeProcessCount: getActiveDemoProcessCount(),
    };
  }

  spawnWindowsShellOpen(safeFile);
  return {
    ok: true,
    message: `✓ Đã mở ${fileName}`,
    activeProcessCount: getActiveDemoProcessCount(),
  };
}
