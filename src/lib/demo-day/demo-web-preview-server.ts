/**
 * MINDX AUTOMATION BOT - ISOLATED LOCAL WEB PREVIEW SERVER FOR DEMO DAY
 * Serves static student Web projects (`.html/.css/.js/...`) over an ephemeral loopback port
 * (`127.0.0.1:0`) isolated from `:3000`, using random 36-hex tokens and strict containment checks.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { isSensitiveSecretFile } from "../local-files/spck-scanner";
import { assertPathAllowed } from "../security/path-allowlist";

const MIME_BY_EXT: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

interface DemoPreviewServerState {
  server: http.Server | null;
  port: number | null;
  startPromise: Promise<number> | null;
  tokenToRoot: Map<string, string>;
  rootToToken: Map<string, string>;
}

const g = globalThis as unknown as {
  __mindxDemoWebPreviewState?: DemoPreviewServerState;
};

function getState(): DemoPreviewServerState {
  if (!g.__mindxDemoWebPreviewState) {
    g.__mindxDemoWebPreviewState = {
      server: null,
      port: null,
      startPromise: null,
      tokenToRoot: new Map(),
      rootToToken: new Map(),
    };
  }
  return g.__mindxDemoWebPreviewState;
}

function isLoopbackAddress(addr: string | undefined | null): boolean {
  const clean = String(addr || "").trim();
  return clean === "127.0.0.1" || clean === "::1" || clean === "::ffff:127.0.0.1";
}

function normalizeRootKey(realDir: string): string {
  return process.platform === "win32" ? realDir.toLowerCase() : realDir;
}

function resolveContainedNonSymlinkFile(
  rootDir: string,
  relSegments: string[]
): { ok: true; filePath: string } | { ok: false; status: number; reason: string } {
  try {
    assertPathAllowed(rootDir);
  } catch {
    return { ok: false, status: 403, reason: "Root outside allowlist" };
  }

  let current = rootDir;
  let rootReal = "";
  try {
    const rootStat = fs.lstatSync(rootDir);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      return { ok: false, status: 403, reason: "Invalid student root" };
    }
    rootReal = fs.realpathSync(rootDir);
  } catch {
    return { ok: false, status: 404, reason: "Student folder missing" };
  }

  for (let i = 0; i < relSegments.length; i++) {
    const seg = relSegments[i];
    if (!seg || seg === "." || seg === ".." || seg.includes("\0") || seg.startsWith(".")) {
      return { ok: false, status: 403, reason: "Invalid segment" };
    }
    if (isSensitiveSecretFile(seg)) {
      return { ok: false, status: 403, reason: "Forbidden sensitive file" };
    }
    current = path.join(current, seg);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(current);
    } catch {
      return { ok: false, status: 404, reason: "Not found" };
    }
    if (st.isSymbolicLink()) {
      return { ok: false, status: 403, reason: "Symlink rejected" };
    }
    if (i < relSegments.length - 1 && !st.isDirectory()) {
      return { ok: false, status: 404, reason: "Not a directory" };
    }
  }

  try {
    assertPathAllowed(current);
    const realTarget = fs.realpathSync(current);
    const normRoot = normalizeRootKey(rootReal);
    const normTarget = normalizeRootKey(realTarget);
    const prefix = normRoot.endsWith(path.sep) ? normRoot : normRoot + path.sep;
    if (normTarget !== normRoot && !normTarget.startsWith(prefix)) {
      return { ok: false, status: 403, reason: "Escaped student root" };
    }
    const finalStat = fs.lstatSync(current);
    if (finalStat.isDirectory()) {
      const idxHtml = path.join(current, "index.html");
      if (fs.existsSync(idxHtml)) {
        return resolveContainedNonSymlinkFile(rootDir, [...relSegments, "index.html"]);
      }
      return { ok: false, status: 404, reason: "Directory index missing" };
    }
    if (!finalStat.isFile()) {
      return { ok: false, status: 403, reason: "Not a regular file" };
    }
    const rawPreviewBuf = finalStat.size <= 64 * 1024 ? fs.readFileSync(current) : undefined;
    if (isSensitiveSecretFile(path.basename(current), rawPreviewBuf)) {
      return { ok: false, status: 403, reason: "Sensitive file blocked" };
    }
    return { ok: true, filePath: current };
  } catch {
    return { ok: false, status: 403, reason: "Access denied" };
  }
}

function handlePreviewRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  if (!isLoopbackAddress(req.socket?.remoteAddress)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method Not Allowed");
    return;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(req.url || "/", "http://127.0.0.1");
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad Request");
    return;
  }

  const match = parsedUrl.pathname.match(/^\/p\/([a-f0-9]{36})(?:\/(.*))?$/i);
  if (!match) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }

  const token = match[1].toLowerCase();
  const rootDir = getState().tokenToRoot.get(token);
  if (!rootDir) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Invalid token");
    return;
  }

  const rawRest = match[2] || "index.html";
  let decodedParts: string[] = [];
  try {
    const rawParts = rawRest.split("/").filter((s) => s.length > 0);
    decodedParts = rawParts.map((seg) => decodeURIComponent(seg));
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad path encoding");
    return;
  }

  if (decodedParts.length === 0) {
    decodedParts = ["index.html"];
  }

  const resolved = resolveContainedNonSymlinkFile(rootDir, decodedParts);
  if (!resolved.ok) {
    res.writeHead(resolved.status, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(resolved.reason);
    return;
  }

  const ext = path.extname(resolved.filePath).toLowerCase();
  const mime = MIME_BY_EXT[ext] || "application/octet-stream";

  try {
    const st = fs.statSync(resolved.filePath);
    res.writeHead(200, {
      "Content-Type": mime,
      "Content-Length": String(st.size),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(resolved.filePath).pipe(res);
  } catch {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Read error");
  }
}

export async function ensureDemoWebPreviewServer(): Promise<number> {
  const state = getState();
  if (state.server && state.port !== null && state.server.listening) {
    return state.port;
  }
  if (state.startPromise) {
    return state.startPromise;
  }

  state.startPromise = new Promise<number>((resolve, reject) => {
    const srv = http.createServer(handlePreviewRequest);
    srv.once("error", (err) => {
      state.startPromise = null;
      reject(err);
    });
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address() as AddressInfo | null;
      if (!addr || typeof addr.port !== "number") {
        state.startPromise = null;
        reject(new Error("Failed to bind Demo Web Preview server"));
        return;
      }
      state.server = srv;
      state.port = addr.port;
      state.startPromise = null;
      resolve(addr.port);
    });
  });

  return state.startPromise;
}

/**
 * Registers `studentRootDir` and returns a clean loopback URL for `relHtmlPath`
 * (e.g. `http://127.0.0.1:54123/p/<token>/index.html`).
 */
export async function ensureStudentWebPreviewUrl(
  studentRootDir: string,
  relHtmlPath: string
): Promise<string> {
  const safeRoot = assertPathAllowed(studentRootDir);
  const rootStat = fs.lstatSync(safeRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("Thư mục học sinh không hợp lệ hoặc là symlink.");
  }
  const realRoot = fs.realpathSync(safeRoot);
  const key = normalizeRootKey(realRoot);

  const state = getState();
  let token = state.rootToToken.get(key);
  if (!token) {
    token = crypto.randomBytes(18).toString("hex");
    state.rootToToken.set(key, token);
    state.tokenToRoot.set(token, realRoot);
  }

  const port = await ensureDemoWebPreviewServer();
  const cleanSegs = relHtmlPath
    .replace(/\\/g, "/")
    .split("/")
    .filter((s) => s.length > 0 && s !== "." && s !== "..")
    .map((s) => encodeURIComponent(s));

  return `http://127.0.0.1:${port}/p/${token}/${cleanSegs.join("/")}`;
}

export async function closeDemoWebPreviewServer(): Promise<void> {
  const state = getState();
  const srv = state.server;
  state.server = null;
  state.port = null;
  state.startPromise = null;
  state.tokenToRoot.clear();
  state.rootToToken.clear();
  if (!srv) return;
  await new Promise<void>((resolve) => {
    srv.close(() => resolve());
  });
}
