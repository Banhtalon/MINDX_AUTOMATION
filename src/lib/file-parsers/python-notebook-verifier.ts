/**
 * MINDX AUTOMATION BOT - ISOLATED PYTHON / JUPYTER SUBMISSION VERIFIER
 * Runs `.ipynb` / `.py` student submissions inside a disposable temporary directory (`os.tmpdir()`)
 * with strict CPython `sys.addaudithook` filesystem/network/process isolation, 6-second timeout,
 * pre-opened out-of-band result file handle (anti-spoofing), and sanitized environment variables
 * (zero project secrets).
 *
 * Purpose:
 * 1. Detect stale/un-run `.ipynb` cell outputs (e.g. student edited code or forgot to re-run cells,
 *    or left old error tracebacks while code is fixed, or vice versa).
 * 2. Verify actual computed values on Data Analysis / Python Checkpoint tasks (e.g. `CSA` Session 5
 *    `car-sales-data.csv`) so Gemini grades against ground-truth execution results instead of guessing.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import AdmZip from "adm-zip";
import { assertPathAllowed } from "../security/path-allowlist";

const MAX_SANDBOX_TIMEOUT_MS = 6000;
const MAX_ZIP_ENTRIES = 60;
const MAX_ZIP_UNCOMPRESSED_BYTES = 10 * 1024 * 1024;

const SAFE_ENV_KEYS = new Set([
  "SYSTEMROOT",
  "SystemRoot",
  "COMSPEC",
  "ComSpec",
  "WINDIR",
  "PATHEXT",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PROCESSOR_ARCHITECTURE",
]);

const FORBIDDEN_ENV_KEY_REGEX =
  /(?:PASSWORD|PASS|SECRET|TOKEN|API_KEY|PRIVATE_KEY|COOKIE|AUTH|CREDENTIAL|TEACHING|LMS|GEMINI|GITHUB|OPENAI|ANTHROPIC|GOOGLE_API)/i;

export function isValidSafeRubricId(raw?: string | null): boolean {
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(trimmed);
}

function sanitizeCompanionSegment(raw: string): string {
  const cleaned = path
    .basename(String(raw || "").trim())
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^\.+/, "");
  return cleaned || "sub";
}

function buildIsolatedSandboxEnv(sandboxDir: string): NodeJS.ProcessEnv {
  const cleanEnv: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    MPLBACKEND: "Agg",
    TEMP: sandboxDir,
    TMP: sandboxDir,
    HOME: sandboxDir,
    USERPROFILE: sandboxDir,
  };
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v !== "string") continue;
    if (FORBIDDEN_ENV_KEY_REGEX.test(k)) continue;
    if (SAFE_ENV_KEYS.has(k)) {
      cleanEnv[k] = v;
    }
  }
  return cleanEnv;
}

function resolveProjectPythonExe(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "data", "streamlit-venv", "Scripts", "python.exe"),
    path.resolve(process.cwd(), "data", "streamlit-venv", "bin", "python"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function killProcessTreeSafe(pid: number | undefined): Promise<void> {
  if (!pid || pid <= 0) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.on("close", () => resolve());
      killer.on("error", () => resolve());
      setTimeout(resolve, 1500);
    });
  } else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
}

const PYTHON_AUDIT_RUNNER_SCRIPT = String.raw`
def _mindx_main():
    import ast
    import builtins
    import io
    import json
    import os
    import sys

    runner_self = sys.argv[0] if len(sys.argv) > 0 else ""
    cfg_path = sys.argv[1]
    sys.argv[:] = ["submission.py"]

    with open(cfg_path, "r", encoding="utf-8") as f:
        cfg = json.load(f)

    res_fp = open(cfg["resultPath"], "w", encoding="utf-8")
    nonce = str(cfg.get("nonce", ""))
    cells = list(cfg.get("cells", []))
    sandbox_real = os.path.realpath(cfg["sandboxDir"])
    del cfg

    for p_rm in (cfg_path, runner_self):
        if p_rm:
            try:
                os.unlink(p_rm)
            except Exception:
                pass
    del cfg_path, runner_self

    python_prefix_real = os.path.realpath(sys.prefix)
    base_prefix_real = os.path.realpath(getattr(sys, "base_prefix", sys.prefix))
    runtime_roots = (
        python_prefix_real.lower(),
        base_prefix_real.lower(),
    )
    stdlib_roots = (
        sandbox_real.lower(),
        python_prefix_real.lower(),
        base_prefix_real.lower(),
    )

    os.chdir(sandbox_real)

    def _is_inside(path_str, allowed_prefixes):
        try:
            rp = os.path.realpath(os.fspath(path_str)).lower()
            for pref in allowed_prefixes:
                if rp == pref or rp.startswith(pref + os.sep):
                    return True
            return False
        except Exception:
            return False

    sys.path = [sandbox_real] + [p for p in sys.path if p and _is_inside(p, runtime_roots)]
    builtins.input = lambda prompt="": "0"

    # Detach real OS stdout/stderr streams so student code cannot spoof or flood host pipes
    sys.__stdout__ = io.StringIO()
    sys.__stderr__ = io.StringIO()
    sys.stdout = sys.__stdout__
    sys.stderr = sys.__stderr__

    # Pre-warm scientific packages BEFORE arming audit hook if referenced in student cells
    _joined_src = "\n".join(str(it.get("code", "")) for it in cells)
    if "pandas" in _joined_src or "numpy" in _joined_src:
        try:
            import numpy  # noqa: F401
            import pandas  # noqa: F401
        except Exception:
            pass
    if "matplotlib" in _joined_src or "seaborn" in _joined_src:
        try:
            import matplotlib  # noqa: F401
            matplotlib.use("Agg")
            import matplotlib.pyplot  # noqa: F401
        except Exception:
            pass

    BLOCKED_IMPORT_TOP = {
        "_winapi",
        "ctypes",
        "_ctypes",
        "sqlite3",
        "_sqlite3",
        "msvcrt",
        "mmap",
        "winreg",
        "socket",
        "_socket",
        "ssl",
        "_ssl",
        "subprocess",
        "multiprocessing",
        "_multiprocessing",
        "urllib",
        "http",
        "ftplib",
        "smtplib",
        "poplib",
        "imaplib",
        "telnetlib",
        "webbrowser",
        "shutil",
        "tempfile",
        "pty",
        "fcntl",
        "resource",
    }

    BLOCKED_PREFIXES = (
        "_winapi.",
        "ctypes.",
        "sqlite3.",
        "msvcrt.",
        "mmap.",
        "winreg.",
        "shutil.",
        "socket.",
        "_socket.",
        "ssl.",
        "_ssl.",
        "urllib.",
        "http.client.",
        "ftplib.",
        "smtplib.",
        "poplib.",
        "imaplib.",
        "telnetlib.",
        "webbrowser.",
        "subprocess.",
        "multiprocessing.",
    )

    BLOCKED_EXACT = {
        "os.system",
        "os.popen",
        "os.spawn",
        "os.spawnl",
        "os.spawnle",
        "os.spawnlp",
        "os.spawnlpe",
        "os.spawnv",
        "os.spawnve",
        "os.spawnvp",
        "os.spawnvpe",
        "os.exec",
        "os.execl",
        "os.execle",
        "os.execlp",
        "os.execlpe",
        "os.execv",
        "os.execve",
        "os.execvp",
        "os.execvpe",
        "os.startfile",
        "os.kill",
        "os.remove",
        "os.unlink",
        "os.rmdir",
        "os.rename",
        "os.replace",
        "os.chmod",
        "os.chown",
        "os.chdir",
        "os.fchdir",
        "os.link",
        "os.symlink",
        "os.truncate",
        "os.utime",
        "os.add_dll_directory",
        "os._exit",
        "os.putenv",
        "os.unsetenv",
        "sys._getframe",
        "sys._current_frames",
        "gc.get_objects",
        "gc.get_referrers",
        "gc.get_referents",
        "builtins.breakpoint",
        "cpython.PyEval_SetTrace",
        "cpython.PyEval_SetProfile",
    }

    WRITE_FLAGS = (
        getattr(os, "O_WRONLY", 1)
        | getattr(os, "O_RDWR", 2)
        | getattr(os, "O_CREAT", 0x100)
        | getattr(os, "O_TRUNC", 0x200)
        | getattr(os, "O_APPEND", 8)
    )

    _writing_final = [False]

    def _audit_hook(event, args):
        if _writing_final[0]:
            return
        if event == "import" and args:
            mod_name = str(args[0] or "")
            top_mod = mod_name.split(".", 1)[0]
            if top_mod in BLOCKED_IMPORT_TOP or mod_name in BLOCKED_IMPORT_TOP:
                raise PermissionError(f"Sandbox blocked restricted module import: {mod_name}")
        if event.startswith(BLOCKED_PREFIXES) or event in BLOCKED_EXACT:
            raise PermissionError(f"Sandbox blocked restricted operation: {event}")
        if event == "open":
            file_arg = args[0] if len(args) > 0 else None
            mode_arg = args[1] if len(args) > 1 else None
            flags_arg = args[2] if len(args) > 2 else 0
            if isinstance(file_arg, int):
                raise PermissionError("Sandbox blocked raw file descriptor open")
            is_write = (
                mode_arg is None
                or any(ch in str(mode_arg) for ch in ("w", "a", "x", "+"))
                or (isinstance(flags_arg, int) and bool(flags_arg & WRITE_FLAGS))
            )
            if is_write:
                if not _is_inside(file_arg, (sandbox_real.lower(),)):
                    raise PermissionError("Sandbox blocked write outside temporary directory")
            else:
                if not _is_inside(file_arg, stdlib_roots):
                    raise PermissionError(f"Sandbox blocked read outside sandbox: {file_arg}")
        elif event in ("os.mkdir", "os.makedirs"):
            target_dir = args[0] if args and args[0] is not None else ""
            if isinstance(target_dir, int) or not _is_inside(target_dir, (sandbox_real.lower(),)):
                raise PermissionError("Sandbox blocked directory creation outside temporary directory")
        elif event in ("os.listdir", "os.scandir"):
            target = args[0] if args and args[0] is not None else sandbox_real
            if isinstance(target, int) or not _is_inside(target, stdlib_roots):
                raise PermissionError("Sandbox blocked directory listing outside sandbox")

    # Scrub any already-loaded dangerous modules from sys.modules unless required internally
    for _m in list(sys.modules.keys()):
        _top = _m.split(".", 1)[0]
        if _top in BLOCKED_IMPORT_TOP:
            sys.modules.pop(_m, None)

    sys.addaudithook(_audit_hook)

    ns = {"__name__": "__main__"}
    results = []

    for item in cells:
        idx = item.get("index", 0)
        code = str(item.get("code", ""))
        if not code.strip():
            continue
        buf = io.StringIO()
        old_out, old_err = sys.stdout, sys.stderr
        sys.stdout = buf
        sys.stderr = buf
        status = "OK"
        err_text = ""
        last_repr = ""
        try:
            tree = ast.parse(code, filename=f"cell_{idx}.py", mode="exec")
            if tree.body and isinstance(tree.body[-1], ast.Expr):
                prefix_mod = ast.Module(body=tree.body[:-1], type_ignores=[])
                last_expr = ast.Expression(body=tree.body[-1].value)
                if prefix_mod.body:
                    exec(compile(prefix_mod, f"cell_{idx}.py", "exec"), ns, ns)
                val = eval(compile(last_expr, f"cell_{idx}.py", "eval"), ns, ns)
                if val is not None:
                    last_repr = repr(val)[:2000]
            else:
                exec(compile(tree, f"cell_{idx}.py", "exec"), ns, ns)
        except BaseException as ex:
            status = "ERROR"
            err_text = f"{type(ex).__name__}: {ex}"
        finally:
            sys.stdout = old_out
            sys.stderr = old_err
        out_str = buf.getvalue()[:3000]
        results.append({
            "index": idx,
            "status": status,
            "stdout": out_str,
            "lastExpr": last_repr,
            "error": err_text[:600],
        })

    _writing_final[0] = True
    res_fp.write(json.dumps({"nonce": nonce, "results": results}, ensure_ascii=False))
    res_fp.flush()
    res_fp.close()

_mindx_main()
`;

export interface PythonVerificationOptions {
  localFilePath: string;
  submissionId?: string;
  rubricId?: string;
  shouldStop?: () => boolean;
}

export interface PythonCellRunResult {
  index: number;
  status: "OK" | "ERROR";
  stdout: string;
  lastExpr: string;
  error: string;
  savedOutputSnippet?: string;
  hasStaleMismatch?: boolean;
}

export interface PythonVerificationReport {
  executed: boolean;
  timedOut?: boolean;
  cells: PythonCellRunResult[];
  summaryText: string;
}

function normalizeOutputForComparison(raw: string): string {
  return String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function detectStaleCellOutputMismatch(params: {
  savedOutput: string;
  liveStdout: string;
  liveLastExpr: string;
  liveError: string;
  liveStatus: "OK" | "ERROR";
}): boolean {
  const normSaved = normalizeOutputForComparison(params.savedOutput);
  if (!normSaved) return false;

  const liveCombined = [
    params.liveStdout.trim(),
    params.liveLastExpr.trim(),
    params.liveError ? `[Error] ${params.liveError}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const normLive = normalizeOutputForComparison(liveCombined);

  // Saved cell had output, but live code produced nothing at all
  if (!normLive) return true;

  // Saved cell had normal output, but live execution raised an error (or vice versa)
  const savedWasError = normSaved.startsWith("[Error]");
  if (params.liveStatus === "ERROR" && !savedWasError) return true;
  if (params.liveStatus === "OK" && savedWasError) return true;

  if (normSaved === normLive) return false;

  // Allow substring tolerance ONLY for long multi-token outputs (>= 24 chars) when status is OK
  if (params.liveStatus === "OK" && Math.min(normSaved.length, normLive.length) >= 24) {
    if (normLive.includes(normSaved) || normSaved.includes(normLive)) {
      return false;
    }
  }
  return true;
}

/**
 * Collects reference dataset files for a rubric (e.g. `data/config/checkpoint-datasets/CSA_SESSION_05/car-sales-data.csv`).
 * Strictly validates `rubricId` against path traversal (`..`, `.`, slashes).
 */
export function resolveRubricDatasetFiles(
  rubricId?: string
): Array<{ fileName: string; buffer: Buffer }> {
  if (!isValidSafeRubricId(rubricId)) return [];
  const safeId = String(rubricId).trim();
  try {
    const configRoot = process.env.MINDX_CONFIG_DIR?.trim()
      ? path.resolve(process.cwd(), process.env.MINDX_CONFIG_DIR.trim())
      : path.resolve(process.cwd(), "data", "config");
    const datasetsBase = path.resolve(configRoot, "checkpoint-datasets");
    const candidateDir = path.resolve(datasetsBase, safeId);
    if (
      !candidateDir
        .toLowerCase()
        .startsWith((datasetsBase + path.sep).toLowerCase())
    ) {
      return [];
    }
    const dsDir = assertPathAllowed(candidateDir);
    if (!fs.existsSync(dsDir) || !fs.statSync(dsDir).isDirectory()) return [];

    const out: Array<{ fileName: string; buffer: Buffer }> = [];
    for (const entry of fs.readdirSync(dsDir)) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/.test(entry)) continue;
      const full = assertPathAllowed(path.join(dsDir, entry));
      const st = fs.lstatSync(full);
      if (st.isFile() && !st.isSymbolicLink() && st.size > 0 && st.size <= 5 * 1024 * 1024) {
        out.push({ fileName: entry, buffer: fs.readFileSync(full) });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function runIsolatedPythonSubmissionVerification(
  opts: PythonVerificationOptions
): Promise<PythonVerificationReport> {
  const pythonExe = resolveProjectPythonExe();
  if (!pythonExe || !opts.localFilePath) {
    return { executed: false, cells: [], summaryText: "" };
  }

  let safeLocalPath = "";
  try {
    safeLocalPath = assertPathAllowed(opts.localFilePath);
    if (!fs.existsSync(safeLocalPath)) {
      return { executed: false, cells: [], summaryText: "" };
    }
  } catch {
    return { executed: false, cells: [], summaryText: "" };
  }

  const parentDir = path.dirname(safeLocalPath);
  const baseName = path.basename(safeLocalPath);

  // Build candidate companion directories (prefer explicit submissionId, fallback to non-greedy prefix)
  const companionCandidates: string[] = [];
  if (opts.submissionId && String(opts.submissionId).trim()) {
    companionCandidates.push(
      path.join(parentDir, `${sanitizeCompanionSegment(opts.submissionId)}_files`)
    );
  }
  const hex24Match = baseName.match(/^([a-f0-9]{24})_/i);
  if (hex24Match) {
    companionCandidates.push(path.join(parentDir, `${hex24Match[1]}_files`));
  }
  if (fs.existsSync(parentDir)) {
    try {
      for (const dirEntry of fs.readdirSync(parentDir)) {
        if (dirEntry.endsWith("_files")) {
          const prefix = dirEntry.slice(0, -"_files".length);
          if (prefix && baseName.toLowerCase().startsWith(`${prefix.toLowerCase()}_`)) {
            companionCandidates.push(path.join(parentDir, dirEntry));
          }
        }
      }
    } catch {}
  }

  let codeFileBuf: Buffer | null = null;
  let codeFileExt = path.extname(safeLocalPath).toLowerCase();
  const dataFilesToStage = new Map<string, Buffer>();

  try {
    for (const candDir of companionCandidates) {
      if (
        candDir &&
        fs.existsSync(candDir) &&
        fs.statSync(assertPathAllowed(candDir)).isDirectory()
      ) {
        const compDir = assertPathAllowed(candDir);
        for (const f of fs.readdirSync(compDir)) {
          const fp = assertPathAllowed(path.join(compDir, f));
          const st = fs.lstatSync(fp);
          if (!st.isFile() || st.isSymbolicLink() || st.size > 10 * 1024 * 1024) continue;
          const ext = path.extname(f).toLowerCase();
          if ((ext === ".ipynb" || ext === ".py") && !codeFileBuf) {
            codeFileBuf = fs.readFileSync(fp);
            codeFileExt = ext;
          } else if (ext === ".csv" || ext === ".tsv" || ext === ".json" || ext === ".txt") {
            dataFilesToStage.set(f, fs.readFileSync(fp));
          }
        }
        if (codeFileBuf) break;
      }
    }

    // Fallback for student-uploaded `.zip` archives without a companion `_files` folder
    if (!codeFileBuf && codeFileExt === ".zip") {
      const zipStat = fs.lstatSync(safeLocalPath);
      if (zipStat.isFile() && !zipStat.isSymbolicLink() && zipStat.size <= MAX_ZIP_UNCOMPRESSED_BYTES) {
        const zip = new AdmZip(fs.readFileSync(safeLocalPath));
        const entries = zip.getEntries();
        if (entries.length <= MAX_ZIP_ENTRIES) {
          let totalUncompressed = 0;
          for (const entry of entries) {
            if (entry.isDirectory) continue;
            const rawEntryName = String(entry.entryName || "").replace(/\\/g, "/");
            if (
              !rawEntryName ||
              rawEntryName.includes("..") ||
              rawEntryName.startsWith("/") ||
              /(?:^|\/)(?:__MACOSX|\.git|node_modules|venv|\.venv)\//i.test(rawEntryName)
            ) {
              continue;
            }
            const declSize = Number(entry.header?.size || 0);
            if (declSize < 0 || totalUncompressed + declSize > MAX_ZIP_UNCOMPRESSED_BYTES) {
              break;
            }
            const baseEntry = path.basename(rawEntryName);
            const ext = path.extname(baseEntry).toLowerCase();
            if (
              ext !== ".ipynb" &&
              ext !== ".py" &&
              ext !== ".csv" &&
              ext !== ".tsv" &&
              ext !== ".json" &&
              ext !== ".txt"
            ) {
              continue;
            }
            const dataBuf = entry.getData();
            totalUncompressed += dataBuf.length;
            if (totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) break;

            if ((ext === ".ipynb" || ext === ".py") && !codeFileBuf) {
              codeFileBuf = dataBuf;
              codeFileExt = ext;
            } else if (ext === ".csv" || ext === ".tsv" || ext === ".json" || ext === ".txt") {
              if (!dataFilesToStage.has(baseEntry)) {
                dataFilesToStage.set(baseEntry, dataBuf);
              }
            }
          }
        }
      }
    }

    if (!codeFileBuf && (codeFileExt === ".ipynb" || codeFileExt === ".py")) {
      codeFileBuf = fs.readFileSync(safeLocalPath);
    }
  } catch {
    return { executed: false, cells: [], summaryText: "" };
  }

  if (!codeFileBuf || (codeFileExt !== ".ipynb" && codeFileExt !== ".py")) {
    return { executed: false, cells: [], summaryText: "" };
  }

  // Stage fallback reference datasets from rubric config if student didn't attach them
  for (const ds of resolveRubricDatasetFiles(opts.rubricId)) {
    if (!dataFilesToStage.has(ds.fileName)) {
      dataFilesToStage.set(ds.fileName, ds.buffer);
    }
  }

  // Extract cells + saved outputs
  const cellsToRun: Array<{ index: number; code: string; savedOutput: string }> = [];
  try {
    const rawStr = codeFileBuf.toString("utf8").replace(/^\uFEFF/, "");
    if (codeFileExt === ".ipynb") {
      const nb = JSON.parse(rawStr);
      if (!Array.isArray(nb?.cells)) {
        return { executed: false, cells: [], summaryText: "" };
      }
      nb.cells.forEach((cell: any, idx: number) => {
        if (cell?.cell_type !== "code") return;
        const src = Array.isArray(cell.source) ? cell.source.join("") : String(cell.source || "");
        const savedParts: string[] = [];
        if (Array.isArray(cell.outputs)) {
          for (const out of cell.outputs) {
            if (out?.text) {
              savedParts.push(Array.isArray(out.text) ? out.text.join("") : String(out.text));
            } else if (out?.data?.["text/plain"]) {
              const p = out.data["text/plain"];
              savedParts.push(Array.isArray(p) ? p.join("") : String(p));
            } else if (out?.ename || out?.evalue) {
              savedParts.push(`[Error] ${out.ename || ""}: ${out.evalue || ""}`);
            }
          }
        }
        cellsToRun.push({
          index: idx + 1,
          code: src,
          savedOutput: savedParts.join("\n").slice(0, 2000),
        });
      });
    } else {
      cellsToRun.push({ index: 1, code: rawStr, savedOutput: "" });
    }
  } catch {
    return { executed: false, cells: [], summaryText: "" };
  }

  if (cellsToRun.length === 0) {
    return { executed: false, cells: [], summaryText: "" };
  }

  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-py-verify-"));
  const resultDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-py-res-"));
  const runnerPath = path.join(resultDir, "_mindx_runner.py");
  const cfgPath = path.join(resultDir, "_mindx_cfg.json");
  const resultPath = path.join(resultDir, "_mindx_out.json");
  const expectedNonce = crypto.randomBytes(16).toString("hex");

  try {
    for (const [fname, buf] of dataFilesToStage.entries()) {
      const safeName = path.basename(fname).replace(/[^a-zA-Z0-9._-]/g, "_");
      if (safeName && !safeName.startsWith("_mindx_")) {
        fs.writeFileSync(path.join(sandboxDir, safeName), buf);
      }
    }

    fs.writeFileSync(runnerPath, PYTHON_AUDIT_RUNNER_SCRIPT, "utf8");
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({
        sandboxDir,
        resultPath,
        nonce: expectedNonce,
        cells: cellsToRun.map((c) => ({ index: c.index, code: c.code })),
      }),
      "utf8"
    );

    const runOutcome = await new Promise<{ timedOut: boolean }>((resolve) => {
      let timedOut = false;
      let settled = false;

      const child = spawn(pythonExe, ["-I", runnerPath, cfgPath], {
        cwd: sandboxDir,
        env: buildIsolatedSandboxEnv(sandboxDir),
        windowsHide: true,
        stdio: ["ignore", "ignore", "ignore"],
      });

      const finish = async () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(stopPoll);
        if (timedOut) {
          await killProcessTreeSafe(child.pid);
        }
        resolve({ timedOut });
      };

      const timer = setTimeout(() => {
        timedOut = true;
        void finish();
      }, MAX_SANDBOX_TIMEOUT_MS);

      const stopPoll = setInterval(() => {
        if (opts.shouldStop?.()) {
          timedOut = true;
          void finish();
        }
      }, 200);

      child.on("close", () => void finish());
      child.on("error", () => void finish());
    });

    if (runOutcome.timedOut) {
      return {
        executed: true,
        timedOut: true,
        cells: [],
        summaryText:
          "=== KIỂM CHỨNG CHẠY THỰC TẾ (SANDBOX PYTHON) ===\n[TIMEOUT] Mã nguồn chạy quá thời gian giới hạn 6 giây (có thể chứa vòng lặp vô hạn).",
      };
    }

    if (!fs.existsSync(resultPath)) {
      return { executed: false, cells: [], summaryText: "" };
    }

    const rawResultJson = fs.readFileSync(resultPath, "utf8").trim();
    if (!rawResultJson) {
      return { executed: false, cells: [], summaryText: "" };
    }

    const parsed = JSON.parse(rawResultJson) as {
      nonce?: string;
      results?: PythonCellRunResult[];
    };
    if (parsed?.nonce !== expectedNonce || !Array.isArray(parsed?.results)) {
      return { executed: false, cells: [], summaryText: "" };
    }
    const rawResults = parsed.results;

    const savedByIdx = new Map(cellsToRun.map((c) => [c.index, c.savedOutput]));
    const lines: string[] = [
      "=== KIỂM CHỨNG CHẠY LẠI CODE THỰC TẾ (ISOLATED PYTHON 3.12 SANDBOX) ===",
      `Tệp dữ liệu có sẵn trong thư mục chạy: ${
        Array.from(dataFilesToStage.keys()).join(", ") || "(Không có)"
      }`,
    ];

    const enriched: PythonCellRunResult[] = rawResults.map((r) => {
      const saved = savedByIdx.get(r.index) || "";
      const hasStaleMismatch = detectStaleCellOutputMismatch({
        savedOutput: saved,
        liveStdout: r.stdout || "",
        liveLastExpr: r.lastExpr || "",
        liveError: r.error || "",
        liveStatus: r.status,
      });

      lines.push(
        `[Cell #${r.index} - Chạy thực tế: ${r.status}]${
          hasStaleMismatch
            ? " ⚠️ [LỆCH VỚI OUTPUT LƯU CŨ TRONG FILE .IPYNB - HỌC VIÊN ĐÃ SỬA CODE NHƯNG CHƯA CHẠY LẠI CELL]"
            : ""
        }`
      );
      if (r.stdout.trim()) {
        lines.push(`  Stdout thực tế:\n${r.stdout.trim()}`);
      }
      if (r.status === "ERROR") {
        lines.push(`  Lỗi Runtime thực tế: ${r.error}`);
      } else if (r.lastExpr.trim()) {
        lines.push(`  Giá trị biểu thức cuối:\n${r.lastExpr.trim()}`);
      }
      return {
        ...r,
        savedOutputSnippet: saved,
        hasStaleMismatch,
      };
    });

    return {
      executed: true,
      cells: enriched,
      summaryText: lines.join("\n"),
    };
  } catch {
    return { executed: false, cells: [], summaryText: "" };
  } finally {
    try {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    } catch {}
    try {
      fs.rmSync(resultDir, { recursive: true, force: true });
    } catch {}
  }
}
