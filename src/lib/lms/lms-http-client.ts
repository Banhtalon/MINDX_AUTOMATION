import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import dnsCallback from "node:dns";
import dnsPromises from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { config, getDynamicLmsApiReadEnvValue } from "../config";
import { taskQueue } from "../queue/task-queue";
import { assertPathAllowed } from "../security/path-allowlist";
import { redactSecrets, sanitizeErrorMessage } from "../security/secret-redactor";
import { ensureQueueNotStopped } from "../teaching/teaching-http-client";
import {
  authService,
  matchesExpectedLmsIdentity,
  resolveLmsCredentialsForRole,
  type LmsAuthRole,
} from "../playwright/auth";
import { BrowserManager } from "../playwright/browser-manager";
import {
  LMS_CLASS_FIELD_BY_ID_MINIMAL_QUERY,
  LMS_CLASS_FIELD_BY_ID_QUERY,
  LMS_FIND_ALL_STUDENT_WORKS_MINIMAL_QUERY,
  LMS_FIND_ALL_STUDENT_WORKS_QUERY,
  LMS_FIND_STUDENT_LETTERS_BY_CLASS_QUERY,
  LMS_FIND_STUDENT_SUBMISSION_BY_CLASS_LEGACY_QUERY,
  LMS_FIND_STUDENT_SUBMISSION_BY_CLASS_QUERY,
  LMS_GET_CLASS_BY_ID_MINIMAL_QUERY,
  LMS_GET_CLASS_BY_ID_QUERY,
  LMS_GET_CLASS_BY_ID_SAFE_QUERY,
  LMS_GET_CLASSES_MINIMAL_QUERY,
  LMS_GET_CLASSES_QUERY,
  LMS_MISS_ATTEND_CLASSES_QUERY,
  LMS_MISS_ATTEND_MINIMAL_QUERY,
  LMS_TEACHER_BY_USER_ID_QUERY,
} from "./lms-graphql-queries";
import { normalizeLmsBaseOrigin } from "./lms-class-url";

export const DEFAULT_MINDX_LMS_API_URL = "https://lms-api.mindx.edu.vn/";
export const DEFAULT_MINDX_LMS_IP = "103.109.43.92";
export const DEFAULT_MINDX_RESOURCES_IP = "45.117.83.246";
export const MINDX_AUTH_NAMESERVERS = ["115.84.177.33", "115.84.182.199"];
const DNS_CACHE_TTL_MS = 5 * 60 * 1000;
const TOKEN_EXPIRY_SAFETY_MARGIN_MS = 5 * 60 * 1000;
const DEFAULT_HTTP_TIMEOUT_MS = 25000;
const DEFAULT_RESOURCE_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_BATCH_PACE_MS = 300;

export const NATIVE_GLOBAL_FETCH: typeof globalThis.fetch | undefined =
  typeof globalThis.fetch === "function" ? globalThis.fetch : undefined;

export interface CachedLmsFirebaseToken {
  role: LmsAuthRole;
  username: string;
  email: string;
  userId: string;
  firebaseApiKey: string;
  idToken: string;
  refreshToken: string;
  expiresAtMs: number;
  updatedAt: string;
}

export interface LmsHttpTransportResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

export type LmsHttpTransportFn = (params: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | Buffer;
  timeoutMs: number;
  signal?: AbortSignal;
}) => Promise<LmsHttpTransportResponse>;

export type LmsBootstrapFn = (role: LmsAuthRole) => Promise<CachedLmsFirebaseToken>;

const globalForLmsHttp = globalThis as unknown as {
  __mindxLmsDnsCache?: { lmsIp: string; resourcesIp: string; resolvedAtMs: number };
  __mindxLmsDnsInFlight?: Promise<{ lmsIp: string; resourcesIp: string }> | null;
  __mindxLmsHttpTransportForTest?: LmsHttpTransportFn | null;
  __mindxLmsBootstrapForTest?: LmsBootstrapFn | null;
  __mindxLmsRefreshInFlightByRole?: Map<LmsAuthRole, Promise<CachedLmsFirebaseToken>>;
  __mindxLmsBootstrapInFlightByRole?: Map<LmsAuthRole, Promise<CachedLmsFirebaseToken>>;
};

export function isQueueStoppedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /QUEUE_STOPPED/i.test(msg);
}

/**
 * Checks whether pure-Node LMS GraphQL/HTTP reading is enabled.
 * Always honors explicit `MINDX_LMS_API_READ` (`true`/`false`), falls back to Playwright when disabled,
 * and auto-disables during legacy offline test runs unless explicitly opted in.
 */
export function isLmsApiReadEnabled(options?: {
  forcePlaywright?: boolean;
  testPage?: unknown;
}): boolean {
  if (options?.forcePlaywright || options?.testPage) {
    return false;
  }
  const raw = getDynamicLmsApiReadEnvValue();
  if (raw !== undefined && String(raw).trim() !== "") {
    const trimmed = String(raw).trim().toLowerCase();
    if (/^(?:false|0|off|no)$/.test(trimmed)) return false;
    if (/^(?:true|1|on|yes)$/.test(trimmed)) return true;
  }
  if (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.MINDX_DB_PATH?.trim()) ||
    Boolean(process.env.MINDX_ROLE_STATE_DIR?.trim())
  ) {
    return false;
  }
  return true;
}

export function setLmsHttpTransportForTest(fn: LmsHttpTransportFn | null): void {
  globalForLmsHttp.__mindxLmsHttpTransportForTest = fn;
}

export function setLmsBootstrapHandlerForTest(fn: LmsBootstrapFn | null): void {
  globalForLmsHttp.__mindxLmsBootstrapForTest = fn;
}

export function clearMindxDnsCacheForTest(): void {
  globalForLmsHttp.__mindxLmsDnsCache = undefined;
  globalForLmsHttp.__mindxLmsDnsInFlight = null;
}

/**
 * Resolves `lms.mindx.edu.vn` / `lms-api.mindx.edu.vn` and `resources.mindx.edu.vn` IPs
 * via MindX authoritative nameservers so Cloudflare WARP (`1.1.1.1`) SERVFAIL never blocks Node HTTP requests.
 */
export async function resolveMindxAuthoritativeIps(): Promise<{
  lmsIp: string;
  resourcesIp: string;
}> {
  const cached = globalForLmsHttp.__mindxLmsDnsCache;
  if (cached && Date.now() - cached.resolvedAtMs < DNS_CACHE_TTL_MS) {
    return { lmsIp: cached.lmsIp, resourcesIp: cached.resourcesIp };
  }
  if (globalForLmsHttp.__mindxLmsDnsInFlight) {
    return globalForLmsHttp.__mindxLmsDnsInFlight;
  }

  const job = (async () => {
    let lmsIp = DEFAULT_MINDX_LMS_IP;
    let resourcesIp = DEFAULT_MINDX_RESOURCES_IP;
    try {
      const resolver = new dnsPromises.Resolver({ timeout: 2000, tries: 1 });
      resolver.setServers(MINDX_AUTH_NAMESERVERS);
      const [lmsIps, resIps] = await Promise.all([
        resolver.resolve4("lms-api.mindx.edu.vn").catch(() => []),
        resolver.resolve4("resources.mindx.edu.vn").catch(() => []),
      ]);
      if (lmsIps.length > 0 && /^\d+\.\d+\.\d+\.\d+$/.test(lmsIps[0])) {
        lmsIp = lmsIps[0];
      }
      if (resIps.length > 0 && /^\d+\.\d+\.\d+\.\d+$/.test(resIps[0])) {
        resourcesIp = resIps[0];
      }
    } catch {
      // Fallback safely to known MindX IPs
    }
    const result = { lmsIp, resourcesIp, resolvedAtMs: Date.now() };
    globalForLmsHttp.__mindxLmsDnsCache = result;
    return { lmsIp, resourcesIp };
  })();

  globalForLmsHttp.__mindxLmsDnsInFlight = job;
  try {
    return await job;
  } finally {
    globalForLmsHttp.__mindxLmsDnsInFlight = null;
  }
}

/**
 * Creates a `net.connect` / `https.request` compatible `lookup` function that bypasses
 * Cloudflare WARP DNS issues for `*.mindx.edu.vn` while preserving TLS SNI & certificate checks.
 */
export function createMindxDnsLookup(ips: { lmsIp: string; resourcesIp: string }) {
  return (hostname: string, optionsOrCb: any, maybeCb?: any): void => {
    const cb = typeof optionsOrCb === "function" ? optionsOrCb : maybeCb;
    const opts = typeof optionsOrCb === "function" ? {} : optionsOrCb || {};
    const lower = String(hostname || "").trim().toLowerCase();

    let overrideIp: string | null = null;
    if (lower === "resources.mindx.edu.vn" || lower === "resources.mindx.vn") {
      overrideIp = ips.resourcesIp;
    } else if (lower === "mindx.edu.vn" || lower.endsWith(".mindx.edu.vn")) {
      overrideIp = ips.lmsIp;
    }

    if (overrideIp) {
      if (opts && opts.all) {
        cb(null, [{ address: overrideIp, family: 4 }]);
      } else {
        cb(null, overrideIp, 4);
      }
      return;
    }

    (dnsCallback.lookup as any)(hostname, opts, cb);
  };
}

function getHeaderSingle(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string {
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers || {})) {
    if (k.toLowerCase() === target) {
      return Array.isArray(v) ? String(v[0] || "") : String(v || "");
    }
  }
  return "";
}

/**
 * Low-level HTTP/HTTPS transport using MindX authoritative DNS lookup, strict TLS verification,
 * request timeout, AbortSignal support, and immediate `Stop Bot` queue cancellation.
 */
export async function mindxNodeHttpRequest(params: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
}): Promise<LmsHttpTransportResponse> {
  ensureQueueNotStopped();

  const method = String(params.method || "GET").toUpperCase();
  const headers = { ...(params.headers || {}) };
  const timeoutMs = params.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;

  if (globalForLmsHttp.__mindxLmsHttpTransportForTest) {
    const testResp = await globalForLmsHttp.__mindxLmsHttpTransportForTest({
      url: params.url,
      method,
      headers,
      body: params.body,
      timeoutMs,
      signal: params.signal,
    });
    ensureQueueNotStopped();
    if (typeof params.maxBytes === "number" && params.maxBytes > 0) {
      const declaredLen = Number(getHeaderSingle(testResp.headers, "content-length") || 0);
      if (
        (Number.isFinite(declaredLen) && declaredLen > params.maxBytes) ||
        testResp.body.byteLength > params.maxBytes
      ) {
        const overMb = Math.round(
          Math.max(Number.isFinite(declaredLen) ? declaredLen : 0, testResp.body.byteLength) /
            (1024 * 1024)
        );
        throw new Error(
          `Dữ liệu tải về vượt quá giới hạn cho phép (${overMb}MB > ${Math.round(
            params.maxBytes / (1024 * 1024)
          )}MB).`
        );
      }
    }
    return testResp;
  }

  const parsed = new URL(params.url);
  const isHttps = parsed.protocol === "https:";
  const isHttp = parsed.protocol === "http:";
  if (!isHttps && !isHttp) {
    throw new Error(`Giao thức URL không được hỗ trợ: ${parsed.protocol}`);
  }

  const lowerHost = parsed.hostname.toLowerCase();
  const needsMindxDns =
    lowerHost === "mindx.edu.vn" ||
    lowerHost.endsWith(".mindx.edu.vn") ||
    lowerHost === "resources.mindx.vn";
  const ips = needsMindxDns
    ? await resolveMindxAuthoritativeIps()
    : { lmsIp: DEFAULT_MINDX_LMS_IP, resourcesIp: DEFAULT_MINDX_RESOURCES_IP };
  ensureQueueNotStopped();

  return await new Promise<LmsHttpTransportResponse>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribeQueue: (() => void) | null = null;
    let req: http.ClientRequest | null = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (unsubscribeQueue) {
        unsubscribeQueue();
        unsubscribeQueue = null;
      }
      if (params.signal) {
        params.signal.removeEventListener("abort", onExternalAbort);
      }
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (req && !req.destroyed) {
        req.destroy();
      }
      reject(err);
    };

    const onExternalAbort = () => {
      const reason = params.signal?.reason;
      fail(
        reason instanceof Error
          ? reason
          : new Error(String(reason || "Yêu cầu mạng LMS đã bị hủy."))
      );
    };

    if (params.signal?.aborted) {
      onExternalAbort();
      return;
    }

    const reqOptions: https.RequestOptions = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : isHttps ? 443 : 80,
      path: `${parsed.pathname}${parsed.search}`,
      method,
      headers: {
        Host: parsed.host,
        ...headers,
      },
      ...(isHttps
        ? {
            servername: parsed.hostname,
            rejectUnauthorized: true,
          }
        : {}),
      ...(needsMindxDns ? { lookup: createMindxDnsLookup(ips) as any } : {}),
    };

    const transportModule = isHttps ? https : http;
    req = transportModule.request(reqOptions, (res) => {
      const status = Number(res.statusCode || 0);
      const declaredLen = Number(res.headers["content-length"] || 0);
      if (
        typeof params.maxBytes === "number" &&
        params.maxBytes > 0 &&
        Number.isFinite(declaredLen) &&
        declaredLen > params.maxBytes
      ) {
        res.destroy();
        fail(
          new Error(
            `Dữ liệu tải về vượt quá giới hạn cho phép (${Math.round(
              declaredLen / (1024 * 1024)
            )}MB > ${Math.round(params.maxBytes / (1024 * 1024))}MB).`
          )
        );
        return;
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;

      res.on("data", (chunk: Buffer) => {
        if (settled) return;
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buf.byteLength;
        if (
          typeof params.maxBytes === "number" &&
          params.maxBytes > 0 &&
          totalBytes > params.maxBytes
        ) {
          res.destroy();
          fail(
            new Error(
              `Dữ liệu tải về vượt quá dung lượng tối đa ${Math.round(
                params.maxBytes / (1024 * 1024)
              )}MB.`
            )
          );
          return;
        }
        chunks.push(buf);
      });

      res.on("end", () => {
        if (settled) return;
        settled = true;
        cleanup();
        try {
          ensureQueueNotStopped();
        } catch (stopErr: any) {
          reject(stopErr);
          return;
        }
        resolve({
          status,
          headers: res.headers as Record<string, string | string[] | undefined>,
          body: Buffer.concat(chunks, totalBytes),
        });
      });

      res.on("error", (err) => {
        fail(err instanceof Error ? err : new Error(String(err)));
      });
    });

    req.on("error", (err) => {
      fail(err instanceof Error ? err : new Error(String(err)));
    });

    if (params.signal) {
      params.signal.addEventListener("abort", onExternalAbort, { once: true });
    }

    unsubscribeQueue = taskQueue.subscribeStatus((st) => {
      if (st.isStopped || (process as any).__mindxQueueStopped) {
        fail(new Error("QUEUE_STOPPED: Tác vụ đã bị dừng khẩn cấp (Stop Bot)."));
      }
    });

    if ((process as any).__mindxQueueStopped || taskQueue.getStatus().isStopped) {
      fail(new Error("QUEUE_STOPPED: Tác vụ đã bị dừng khẩn cấp (Stop Bot)."));
      return;
    }

    timer = setTimeout(() => {
      fail(
        new Error(
          `Quá thời gian chờ (${timeoutMs}ms) khi kết nối tới ${parsed.hostname}.`
        )
      );
    }, timeoutMs);

    if (params.body !== undefined && params.body !== null) {
      req.write(params.body);
    }
    req.end();
  });
}

/**
 * Fetches JSON from MindX `resources.mindx.edu.vn` with WARP-safe DNS lookup and redirect block.
 */
export async function fetchMindxResourceJson<T = any>(
  url: string,
  options?: {
    timeoutMs?: number;
    isAllowedUrl?: (candidateUrl: string) => boolean;
  }
): Promise<{ status: number; data: T | null }> {
  if (options?.isAllowedUrl && !options.isAllowedUrl(url)) {
    return { status: 0, data: null };
  }
  const resp = await mindxNodeHttpRequest({
    url,
    method: "GET",
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
    },
    timeoutMs: options?.timeoutMs ?? 12000,
    maxBytes: 2 * 1024 * 1024,
  });
  if (resp.status >= 300 && resp.status < 400) {
    return { status: resp.status, data: null };
  }
  if (resp.status < 200 || resp.status >= 300) {
    return { status: resp.status, data: null };
  }
  try {
    return { status: resp.status, data: JSON.parse(resp.body.toString("utf8")) as T };
  } catch {
    return { status: resp.status, data: null };
  }
}

/**
 * Downloads a binary attachment buffer with manual redirect validation (max 3 hops),
 * host allowlist check at every hop, WARP-safe MindX DNS, and strict streaming byte cap (25MB).
 */
export async function fetchMindxResourceBuffer(
  initialUrl: string,
  options?: {
    label?: string;
    maxBytes?: number;
    maxRedirects?: number;
    timeoutMs?: number;
    isAllowedUrl?: (candidateUrl: string) => boolean;
  }
): Promise<Buffer | null> {
  const label = options?.label || "attachment";
  const maxBytes = options?.maxBytes ?? DEFAULT_RESOURCE_MAX_BYTES;
  const maxRedirects = options?.maxRedirects ?? 3;
  const timeoutMs = options?.timeoutMs ?? 20000;

  let currentUrl = initialUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (options?.isAllowedUrl && !options.isAllowedUrl(currentUrl)) {
      return null;
    }
    let resp: LmsHttpTransportResponse;
    try {
      resp = await mindxNodeHttpRequest({
        url: currentUrl,
        method: "GET",
        timeoutMs,
        maxBytes,
      });
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("vượt quá") || msg.includes("QUEUE_STOPPED")) {
        throw new Error(
          msg.includes("QUEUE_STOPPED")
            ? msg
            : `Tệp '${label}' vượt quá dung lượng tối đa ${Math.round(
                maxBytes / (1024 * 1024)
              )}MB.`
        );
      }
      return null;
    }

    if (resp.status >= 300 && resp.status < 400) {
      const loc = getHeaderSingle(resp.headers, "location");
      if (!loc || hop === maxRedirects) {
        return null;
      }
      try {
        currentUrl = new URL(loc, currentUrl).toString();
      } catch {
        return null;
      }
      continue;
    }
    if (resp.status < 200 || resp.status >= 300) {
      return null;
    }
    return resp.body.length > 0 ? resp.body : null;
  }
  return null;
}

/**
 * Light batch pacing between MindX API requests (~300ms) that aborts immediately on Stop Bot.
 */
export async function paceLmsBatchRequest(delayMs: number = DEFAULT_BATCH_PACE_MS): Promise<void> {
  ensureQueueNotStopped();
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsub: (() => void) | null = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (unsub) {
        unsub();
        unsub = null;
      }
    };

    unsub = taskQueue.subscribeStatus((st) => {
      if (settled) return;
      if (st.isStopped || (process as any).__mindxQueueStopped) {
        settled = true;
        cleanup();
        reject(new Error("QUEUE_STOPPED: Tác vụ đã bị dừng khẩn cấp (Stop Bot)."));
      }
    });

    if ((process as any).__mindxQueueStopped || taskQueue.getStatus().isStopped) {
      settled = true;
      cleanup();
      reject(new Error("QUEUE_STOPPED: Tác vụ đã bị dừng khẩn cấp (Stop Bot)."));
      return;
    }

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }, delayMs);
  });
}

export function resolveLmsTokenDir(): string {
  const custom = process.env.MINDX_LMS_TOKEN_DIR?.trim();
  if (custom) {
    const resolved = path.resolve(process.cwd(), custom);
    const tmpRoot = path.resolve(os.tmpdir());
    const normResolved = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    const normTmp = process.platform === "win32" ? tmpRoot.toLowerCase() : tmpRoot;
    const sep = path.sep.toLowerCase();
    if (normResolved === normTmp || normResolved.startsWith(normTmp + sep)) {
      return resolved;
    }
    return assertPathAllowed(resolved);
  }
  return assertPathAllowed(path.resolve(process.cwd(), "playwright-auth"));
}

export function resolveLmsTokenFilePath(role: LmsAuthRole): string {
  const dir = resolveLmsTokenDir();
  const fileName = role === "ADMIN" ? "lms_token_admin.json" : "lms_token_teacher.json";
  return path.join(dir, fileName);
}

export function decodeJwtPayloadUnsafe(token: string): Record<string, unknown> | null {
  const clean = String(token || "")
    .trim()
    .replace(/^"+|"+$/g, "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  const parts = clean.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(padded, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readCachedLmsToken(role: LmsAuthRole): CachedLmsFirebaseToken | null {
  try {
    const filePath = resolveLmsTokenFilePath(role);
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.role !== role) return null;
    const idToken = String(parsed.idToken || "").trim();
    const refreshToken = String(parsed.refreshToken || "").trim();
    if (!idToken && !refreshToken) return null;
    return {
      role,
      username: String(parsed.username || "").trim(),
      email: String(parsed.email || "").trim().toLowerCase(),
      userId: String(parsed.userId || "").trim(),
      firebaseApiKey: String(parsed.firebaseApiKey || "").trim(),
      idToken,
      refreshToken,
      expiresAtMs: Number(parsed.expiresAtMs || 0),
      updatedAt: String(parsed.updatedAt || ""),
    };
  } catch {
    return null;
  }
}

function writeCachedLmsToken(token: CachedLmsFirebaseToken): void {
  const filePath = resolveLmsTokenFilePath(token.role);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${crypto
    .randomBytes(4)
    .toString("hex")}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(token, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(tmpPath, filePath);
}

export function invalidateCachedLmsToken(role: LmsAuthRole): void {
  try {
    const filePath = resolveLmsTokenFilePath(role);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore cleanup error
  }
}

function doesTokenMatchExpectedUsername(
  token: Pick<CachedLmsFirebaseToken, "username" | "email" | "idToken">,
  expectedUsername: string
): boolean {
  const exp = String(expectedUsername || "").trim();
  if (!exp) return true;
  const jwtPayload = token.idToken ? decodeJwtPayloadUnsafe(token.idToken) : null;
  const jwtIdentity = String(
    jwtPayload?.email || jwtPayload?.username || jwtPayload?.preferred_username || ""
  )
    .trim()
    .toLowerCase();
  if (jwtIdentity) {
    return matchesExpectedLmsIdentity(jwtIdentity, exp);
  }
  const fallbackIdentity = token.email || token.username;
  return fallbackIdentity ? matchesExpectedLmsIdentity(fallbackIdentity, exp) : false;
}

function isTokenWithinValidWindow(token: CachedLmsFirebaseToken): boolean {
  if (!token.idToken) return false;
  let expiresAtMs = token.expiresAtMs;
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) {
    const jwt = decodeJwtPayloadUnsafe(token.idToken);
    const expSec = Number(jwt?.exp || 0);
    if (Number.isFinite(expSec) && expSec > 0) {
      expiresAtMs = expSec * 1000;
    }
  }
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) return false;
  return Date.now() < expiresAtMs - TOKEN_EXPIRY_SAFETY_MARGIN_MS;
}

function isLmsAuthErrorStatusOrMessage(status: number, bodyObj: any): boolean {
  if (status === 401) return true;
  const errors = Array.isArray(bodyObj?.errors) ? bodyObj.errors : [];
  if (errors.length > 0) {
    const joined = errors.map((e: any) => String(e?.message || "")).join(" ");
    const codeStr = errors
      .map((e: any) => String(e?.extensions?.code || ""))
      .join(" ");
    if (
      /\bUNAUTHENTICATED\b/i.test(codeStr) ||
      /authentication\s+(?:token\s+is\s+missing|failed)|unauthenticated|unauthorized|token.*(?:expired|invalid|missing|revoked)|jwt\s+expired|id-token-expired|failed\s+to\s+build\s+auth\s+user/i.test(
        joined
      )
    ) {
      return true;
    }
    // Pure permission GraphQL FORBIDDEN (status 200 or 403 with GraphQL errors lacking auth/token keywords)
    // should not trigger token refresh or Playwright re-login loops.
    return false;
  }
  return status === 403;
}

export const READ_FIREBASE_IDB_SCRIPT = `(() => {
  return new Promise((resolve) => {
    try {
      var pickRecord = function(rec) {
        if (!rec || typeof rec !== "object") return null;
        var v = rec.value && typeof rec.value === "object" ? rec.value : rec;
        var stm = v.stsTokenManager && typeof v.stsTokenManager === "object" ? v.stsTokenManager : v;
        var idToken = String(stm.accessToken || v.accessToken || v.idToken || "").trim();
        var refreshToken = String(stm.refreshToken || v.refreshToken || "").trim();
        var expRaw = Number(stm.expirationTime || v.expirationTime || 0);
        var apiKey = String(v.apiKey || "").trim();
        if (!apiKey && typeof rec.fbase_key === "string") {
          var m = rec.fbase_key.match(/^firebase:authUser:([^:]+):/);
          if (m && m[1]) apiKey = m[1];
        }
        var email = String(v.email || "").trim().toLowerCase();
        var uid = String(v.uid || "").trim();
        if (!idToken && !refreshToken) return null;
        return {
          idToken: idToken,
          refreshToken: refreshToken,
          firebaseApiKey: apiKey,
          expiresAtMs: expRaw,
          email: email,
          uid: uid
        };
      };
      var req = window.indexedDB.open("firebaseLocalStorageDb");
      req.onerror = function() { resolve([]); };
      req.onsuccess = function(ev) {
        try {
          var db = ev.target.result;
          if (!db.objectStoreNames || !db.objectStoreNames.contains("firebaseLocalStorage")) {
            try { db.close(); } catch (e) {}
            resolve([]);
            return;
          }
          var tx = db.transaction(["firebaseLocalStorage"], "readonly");
          var store = tx.objectStore("firebaseLocalStorage");
          var getAll = store.getAll();
          getAll.onerror = function() { try { db.close(); } catch (e) {} resolve([]); };
          getAll.onsuccess = function() {
            var rows = Array.isArray(getAll.result) ? getAll.result : [];
            var out = [];
            for (var i = 0; i < rows.length; i++) {
              var cand = pickRecord(rows[i]);
              if (cand) out.push(cand);
            }
            try { db.close(); } catch (e) {}
            resolve(out);
          };
        } catch (err) {
          resolve([]);
        }
      };
    } catch (e) {
      resolve([]);
    }
  });
})()`;

export function selectBestFirebaseIdbCandidate(
  rawList: unknown,
  expectedUsername?: string,
  capturedAuthHeader?: string
): { picked: any | null; mismatchedEmails: string[] } {
  const expected = String(expectedUsername || "").trim();
  const list = Array.isArray(rawList)
    ? rawList
    : rawList && typeof rawList === "object"
      ? [rawList]
      : [];
  if (list.length === 0) return { picked: null, mismatchedEmails: [] };
  const scored = list
    .filter((c: any) => c && typeof c === "object")
    .map((cand: any) => {
      const jp = cand.idToken ? decodeJwtPayloadUnsafe(String(cand.idToken)) : null;
      const candEmail = String(jp?.email || cand.email || "")
        .trim()
        .toLowerCase();
      const matchesHeader = Boolean(
        capturedAuthHeader &&
          cand.idToken &&
          String(cand.idToken).trim() === capturedAuthHeader
      );
      const matchesExpected = expected
        ? Boolean(candEmail && matchesExpectedLmsIdentity(candEmail, expected))
        : true;
      return { cand, candEmail, matchesHeader, matchesExpected };
    });

  if (expected) {
    const matched =
      scored.find((s) => s.matchesExpected && s.matchesHeader && s.cand.refreshToken) ||
      scored.find((s) => s.matchesExpected && s.cand.refreshToken) ||
      scored.find((s) => s.matchesExpected);
    if (matched) {
      return { picked: matched.cand, mismatchedEmails: [] };
    }
    const mismatchedEmails = scored
      .map((s) => s.candEmail)
      .filter((em) => Boolean(em));
    if (mismatchedEmails.length === 0 && scored.length === 1) {
      return { picked: scored[0].cand, mismatchedEmails: [] };
    }
    return { picked: null, mismatchedEmails };
  }

  const anyBest =
    scored.find((s) => s.matchesHeader && s.cand.refreshToken) ||
    scored.find((s) => s.cand.refreshToken) ||
    scored[0];
  return { picked: anyBest?.cand || null, mismatchedEmails: [] };
}

function buildLmsSearchCandidatesPure(classCode: string): string[] {
  const code = String(classCode || "").trim().toUpperCase();
  if (!code) return [];
  const out: string[] = [];
  const add = (candidate: string) => {
    const clean = String(candidate || "").trim().toUpperCase();
    if (!clean || clean === "HB" || clean === "VT" || clean.length < 4) return;
    if (!out.includes(clean)) out.push(clean);
  };
  add(code);
  const withoutHb = code.replace(/-HB$/i, "");
  add(withoutHb);
  for (const base of [code, withoutHb]) {
    add(base.replace(/^VT-(?:C4K-|ROB-|KIND-)?/i, ""));
    add(base.replace(/^VT-/i, ""));
    const dashParts = base.split("-").filter(Boolean);
    add(dashParts[dashParts.length - 1] || "");
  }
  return out;
}

export class LmsHttpClient {
  private readonly lmsApiUrl: string;

  constructor(lmsApiUrl?: string) {
    this.lmsApiUrl = (lmsApiUrl || DEFAULT_MINDX_LMS_API_URL).trim();
  }

  private resolveSecureTokenUrl(apiKey: string): string {
    const customBase = process.env.MINDX_FIREBASE_SECURETOKEN_URL?.trim();
    if (customBase) {
      const sep = customBase.includes("?") ? "&" : "?";
      return `${customBase}${sep}key=${encodeURIComponent(apiKey)}`;
    }
    return `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`;
  }

  private getRefreshMap(): Map<LmsAuthRole, Promise<CachedLmsFirebaseToken>> {
    if (!globalForLmsHttp.__mindxLmsRefreshInFlightByRole) {
      globalForLmsHttp.__mindxLmsRefreshInFlightByRole = new Map();
    }
    return globalForLmsHttp.__mindxLmsRefreshInFlightByRole;
  }

  private getBootstrapMap(): Map<LmsAuthRole, Promise<CachedLmsFirebaseToken>> {
    if (!globalForLmsHttp.__mindxLmsBootstrapInFlightByRole) {
      globalForLmsHttp.__mindxLmsBootstrapInFlightByRole = new Map();
    }
    return globalForLmsHttp.__mindxLmsBootstrapInFlightByRole;
  }

  /**
   * Exchanges a Firebase `refreshToken` for a fresh `idToken` via `securetoken.googleapis.com`
   * using pure Node.js HTTPS (no Chromium).
   */
  public async refreshFirebaseIdToken(
    role: LmsAuthRole,
    cached: CachedLmsFirebaseToken
  ): Promise<CachedLmsFirebaseToken> {
    ensureQueueNotStopped();
    if (!cached.refreshToken || !cached.firebaseApiKey) {
      throw new Error("Thiếu refreshToken hoặc firebaseApiKey để gia hạn phiên LMS.");
    }

    const refreshMap = this.getRefreshMap();
    const existingPromise = refreshMap.get(role);
    if (existingPromise) {
      return await existingPromise;
    }

    const expectedCreds = resolveLmsCredentialsForRole(role);
    const activeSecrets = [
      cached.idToken,
      cached.refreshToken,
      cached.firebaseApiKey,
      expectedCreds.password,
    ];

    const job = (async () => {
      const tokenUrl = this.resolveSecureTokenUrl(cached.firebaseApiKey);
      const bodyStr = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: cached.refreshToken,
      }).toString();

      const resp = await mindxNodeHttpRequest({
        url: tokenUrl,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: bodyStr,
        timeoutMs: 15000,
      });

      const parsed = (() => {
        try {
          return JSON.parse(resp.body.toString("utf8"));
        } catch {
          return null;
        }
      })();

      if (resp.status < 200 || resp.status >= 300 || !parsed?.id_token) {
        if (resp.status === 400 || resp.status === 401 || resp.status === 403) {
          invalidateCachedLmsToken(role);
        }
        const errDetail = parsed?.error?.message || `HTTP ${resp.status}`;
        throw new Error(
          redactSecrets(
            `Không gia hạn được Firebase token LMS (${role}): ${errDetail}`,
            activeSecrets
          )
        );
      }

      const newIdToken = String(parsed.id_token).trim();
      const newRefreshToken = String(parsed.refresh_token || cached.refreshToken).trim();
      const jwtPayload = decodeJwtPayloadUnsafe(newIdToken);
      const jwtExpSec = Number(jwtPayload?.exp || 0);
      const expiresInSec = Number(parsed.expires_in || 3600);
      const expiresAtMs =
        Number.isFinite(jwtExpSec) && jwtExpSec > 0
          ? jwtExpSec * 1000
          : Date.now() + (Number.isFinite(expiresInSec) ? expiresInSec : 3600) * 1000;
      const email = String(jwtPayload?.email || cached.email || "").trim().toLowerCase();
      const userId = String(
        jwtPayload?.id || jwtPayload?.user_id || jwtPayload?.sub || parsed.user_id || cached.userId || ""
      ).trim();

      if (
        expectedCreds.username &&
        email &&
        !matchesExpectedLmsIdentity(email, expectedCreds.username)
      ) {
        invalidateCachedLmsToken(role);
        throw new Error(
          redactSecrets(
            `[Auth Role Mismatch] Token sau gia hạn thuộc tài khoản "${email}", không khớp "${expectedCreds.username}".`,
            activeSecrets
          )
        );
      }

      const updated: CachedLmsFirebaseToken = {
        role,
        username: expectedCreds.username || cached.username || email,
        email: email || cached.email,
        userId,
        firebaseApiKey: cached.firebaseApiKey,
        idToken: newIdToken,
        refreshToken: newRefreshToken,
        expiresAtMs,
        updatedAt: new Date().toISOString(),
      };
      writeCachedLmsToken(updated);
      return updated;
    })();

    refreshMap.set(role, job);
    try {
      return await job;
    } finally {
      refreshMap.delete(role);
    }
  }

  /**
   * Opens Playwright ONLY when cached refreshToken is missing/revoked to log in via SSO
   * and extract `{ idToken, refreshToken, firebaseApiKey }` from `firebaseLocalStorageDb`.
   */
  public async bootstrapFirebaseTokenViaPlaywright(
    role: LmsAuthRole
  ): Promise<CachedLmsFirebaseToken> {
    ensureQueueNotStopped();

    if (globalForLmsHttp.__mindxLmsBootstrapForTest) {
      const mocked = await globalForLmsHttp.__mindxLmsBootstrapForTest(role);
      writeCachedLmsToken(mocked);
      return mocked;
    }

    const bootstrapMap = this.getBootstrapMap();
    const existing = bootstrapMap.get(role);
    if (existing) {
      return await existing;
    }

    const expectedCreds = resolveLmsCredentialsForRole(role);
    const activeSecrets = [expectedCreds.password];

    const extractFromLivePage = async (page: any): Promise<CachedLmsFirebaseToken> => {
      const lmsOrigin = normalizeLmsBaseOrigin(config.lmsUrl);
      let capturedAuthHeader = "";

      const onRequest = (req: any) => {
        try {
          const u = String(req?.url?.() || "").toLowerCase();
          if (!u.includes("lms-api.mindx.edu.vn")) return;
          const h = typeof req.headers === "function" ? req.headers() : {};
          const authVal = String(h?.authorization || h?.Authorization || "").trim();
          if (authVal && authVal.split(".").length === 3) {
            const cleanHdr = authVal.replace(/^Bearer\s+/i, "").trim();
            const hdrJwt = decodeJwtPayloadUnsafe(cleanHdr);
            const hdrEmail = String(hdrJwt?.email || "").trim().toLowerCase();
            if (
              !expectedCreds.username ||
              !hdrEmail ||
              matchesExpectedLmsIdentity(hdrEmail, expectedCreds.username)
            ) {
              capturedAuthHeader = cleanHdr;
            }
          }
        } catch {}
      };

      if (typeof page?.on === "function") {
        page.on("request", onRequest);
      }
      try {
        const currentUrl = typeof page?.url === "function" ? String(page.url()) : "";
        if (!currentUrl.includes("lms.mindx.edu.vn") || currentUrl.includes("/login")) {
          await page
            .goto(`${lmsOrigin}/admin/classes`, {
              waitUntil: "domcontentloaded",
              timeout: 25000,
            })
            .catch(() => {});
        } else if (!currentUrl.includes("/admin/classes")) {
          await page
            .goto(`${lmsOrigin}/admin/classes`, {
              waitUntil: "domcontentloaded",
              timeout: 25000,
            })
            .catch(() => {});
        }

        let extracted: any = null;
        let lastMismatchedEmails: string[] = [];
        for (let attempt = 0; attempt < 18; attempt++) {
          ensureQueueNotStopped();
          const rawCandidates = await page.evaluate(READ_FIREBASE_IDB_SCRIPT).catch(() => []);
          const selected = selectBestFirebaseIdbCandidate(
            rawCandidates,
            expectedCreds.username,
            capturedAuthHeader
          );
          extracted = selected.picked;
          lastMismatchedEmails = selected.mismatchedEmails;
          if (extracted && extracted.refreshToken && (extracted.idToken || capturedAuthHeader)) {
            break;
          }
          await page.waitForTimeout(350);
        }

        if (!extracted && lastMismatchedEmails.length > 0 && expectedCreds.username) {
          throw new Error(
            redactSecrets(
              `[Auth Role Mismatch] IndexedDB chỉ có phiên (${lastMismatchedEmails.join(
                ", "
              )}), không khớp tài khoản "${expectedCreds.username}".`,
              [...activeSecrets, capturedAuthHeader]
            )
          );
        }

        const effectiveIdToken = String(extracted?.idToken || capturedAuthHeader || "").trim();
        const effectiveRefresh = String(extracted?.refreshToken || "").trim();
        const effectiveApiKey = String(extracted?.firebaseApiKey || "").trim();

        if (!effectiveRefresh && !effectiveIdToken) {
          throw new Error(
            `Không đọc được Firebase Token từ trình duyệt LMS cho vai trò ${role}.`
          );
        }

        const jwtPayload = effectiveIdToken ? decodeJwtPayloadUnsafe(effectiveIdToken) : null;
        const jwtExpSec = Number(jwtPayload?.exp || 0);
        const expiresAtMs =
          Number(extracted?.expiresAtMs || 0) > 0
            ? Number(extracted.expiresAtMs)
            : Number.isFinite(jwtExpSec) && jwtExpSec > 0
              ? jwtExpSec * 1000
              : Date.now() + 55 * 60 * 1000;
        const email = String(jwtPayload?.email || extracted?.email || "")
          .trim()
          .toLowerCase();
        const userId = String(
          jwtPayload?.id || jwtPayload?.user_id || jwtPayload?.sub || extracted?.uid || ""
        ).trim();

        if (
          expectedCreds.username &&
          (!email || !matchesExpectedLmsIdentity(email, expectedCreds.username))
        ) {
          if (email || extracted) {
            throw new Error(
              redactSecrets(
                `[Auth Role Mismatch] Phiên trình duyệt LMS (${
                  email || "<thiếu email>"
                }) không khớp tài khoản "${expectedCreds.username}".`,
                [...activeSecrets, effectiveIdToken, effectiveRefresh, effectiveApiKey]
              )
            );
          }
        }

        let finalToken: CachedLmsFirebaseToken = {
          role,
          username: expectedCreds.username || email,
          email,
          userId,
          firebaseApiKey: effectiveApiKey,
          idToken: effectiveIdToken,
          refreshToken: effectiveRefresh,
          expiresAtMs,
          updatedAt: new Date().toISOString(),
        };

        if (!finalToken.idToken && finalToken.refreshToken && finalToken.firebaseApiKey) {
          finalToken = await this.refreshFirebaseIdToken(role, finalToken);
        } else {
          writeCachedLmsToken(finalToken);
        }
        return finalToken;
      } finally {
        if (typeof page?.off === "function") {
          page.off("request", onRequest);
        }
      }
    };

    const job = (async () => {
      if (role === "ADMIN") {
        return await authService.withAdminLmsSession(async (page) => {
          return await extractFromLivePage(page);
        });
      }
      await authService.ensureAuthenticated("LMS", { role: "TEACHER" });
      const page = await BrowserManager.getInstance().getPage();
      return await extractFromLivePage(page);
    })();

    bootstrapMap.set(role, job);
    try {
      return await job;
    } finally {
      bootstrapMap.delete(role);
    }
  }

  /**
   * Returns a valid Firebase `idToken` for `TEACHER` or `ADMIN`, refreshing via Google API
   * when near expiry and bootstrapping via Playwright only when necessary.
   */
  public async getValidTokenRecord(
    role: LmsAuthRole,
    options?: { forceRefresh?: boolean }
  ): Promise<CachedLmsFirebaseToken> {
    ensureQueueNotStopped();
    const expectedCreds = resolveLmsCredentialsForRole(role);
    let cached = readCachedLmsToken(role);

    if (cached && !doesTokenMatchExpectedUsername(cached, expectedCreds.username)) {
      invalidateCachedLmsToken(role);
      cached = null;
    }

    if (cached && !options?.forceRefresh && isTokenWithinValidWindow(cached)) {
      return cached;
    }

    if (cached && cached.refreshToken && cached.firebaseApiKey) {
      try {
        return await this.refreshFirebaseIdToken(role, cached);
      } catch (refreshErr) {
        if (isQueueStoppedError(refreshErr)) throw refreshErr;
        // Refresh token failed/revoked -> fall through to one-time Playwright SSO bootstrap
      }
    }

    return await this.bootstrapFirebaseTokenViaPlaywright(role);
  }

  /**
   * Executes a MindX LMS GraphQL request with automatic auth refresh/re-bootstrap:
   * - If LMS returns 401/403 or GraphQL auth error:
   *   1) Refresh via `refreshToken` once & retry once.
   *   2) If still failing, bootstrap via Playwright once & retry once.
   */
  public async gql<T = any>(params: {
    role: LmsAuthRole;
    query: string;
    variables?: Record<string, unknown>;
    operationName?: string;
    timeoutMs?: number;
  }): Promise<{ status: number; data: T | null; errors?: any[]; rawJson: any }> {
    ensureQueueNotStopped();
    const expectedCreds = resolveLmsCredentialsForRole(params.role);
    let tokenRec = await this.getValidTokenRecord(params.role);
    const activeSecrets = [
      expectedCreds.password,
      tokenRec.idToken,
      tokenRec.refreshToken,
      tokenRec.firebaseApiKey,
    ];

    const executeWithToken = async (rec: CachedLmsFirebaseToken) => {
      activeSecrets.push(rec.idToken, rec.refreshToken, rec.firebaseApiKey);
      const bodyStr = JSON.stringify({
        query: params.query,
        ...(params.variables !== undefined ? { variables: params.variables } : {}),
        ...(params.operationName ? { operationName: params.operationName } : {}),
      });
      const resp = await mindxNodeHttpRequest({
        url: this.lmsApiUrl,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          authorization: rec.idToken,
          "Content-Language": "vi",
        },
        body: bodyStr,
        timeoutMs: params.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS,
      });
      let parsed: any = null;
      try {
        parsed = JSON.parse(resp.body.toString("utf8"));
      } catch {
        parsed = null;
      }
      return { status: resp.status, parsed };
    };

    try {
      let attempt = await executeWithToken(tokenRec);
      if (isLmsAuthErrorStatusOrMessage(attempt.status, attempt.parsed)) {
        // Retry 1: Refresh via refreshToken once
        let refreshedOk = false;
        if (tokenRec.refreshToken && tokenRec.firebaseApiKey) {
          try {
            tokenRec = await this.refreshFirebaseIdToken(params.role, tokenRec);
            refreshedOk = true;
          } catch (refreshErr) {
            if (isQueueStoppedError(refreshErr)) throw refreshErr;
          }
        }

        if (refreshedOk) {
          attempt = await executeWithToken(tokenRec);
        }

        // Retry 2: If refresh failed or still returned auth error, bootstrap via Playwright once
        if (!refreshedOk || isLmsAuthErrorStatusOrMessage(attempt.status, attempt.parsed)) {
          invalidateCachedLmsToken(params.role);
          tokenRec = await this.bootstrapFirebaseTokenViaPlaywright(params.role);
          attempt = await executeWithToken(tokenRec);
        }
      }

      const hasGraphqlErrors =
        Boolean(attempt.parsed && typeof attempt.parsed === "object") &&
        Array.isArray(attempt.parsed.errors) &&
        attempt.parsed.errors.length > 0;
      const isApolloValidation400 = attempt.status === 400 && hasGraphqlErrors;

      if ((attempt.status < 200 || attempt.status >= 300) && !isApolloValidation400) {
        const errMsg = hasGraphqlErrors && attempt.parsed.errors[0]?.message
          ? String(attempt.parsed.errors[0].message)
          : `LMS GraphQL HTTP ${attempt.status}`;
        throw new Error(redactSecrets(errMsg, activeSecrets));
      }

      if (!attempt.parsed || typeof attempt.parsed !== "object") {
        throw new Error(
          redactSecrets(
            `LMS GraphQL phản hồi không phải JSON hợp lệ (HTTP ${attempt.status}).`,
            activeSecrets
          )
        );
      }

      const redactErrorValue = (val: unknown): any => {
        if (typeof val === "string") {
          return redactSecrets(val, activeSecrets);
        }
        if (Array.isArray(val)) {
          return val.map((item) => redactErrorValue(item));
        }
        if (val && typeof val === "object") {
          const out: Record<string, any> = {};
          for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
            out[k] = redactErrorValue(v);
          }
          return out;
        }
        return val;
      };

      const safeErrors = hasGraphqlErrors
        ? (attempt.parsed.errors as any[]).map((e) => redactErrorValue(e))
        : undefined;
      const safeRawJson = safeErrors
        ? { ...attempt.parsed, errors: safeErrors }
        : attempt.parsed;

      return {
        status: attempt.status,
        data: (attempt.parsed.data ?? null) as T | null,
        ...(safeErrors ? { errors: safeErrors } : {}),
        rawJson: safeRawJson,
      };
    } catch (err) {
      if (isQueueStoppedError(err)) throw err;
      throw new Error(redactSecrets(sanitizeErrorMessage(err, activeSecrets), activeSecrets));
    }
  }

  public async listClasses(
    role: LmsAuthRole,
    payload: Record<string, unknown>,
    options?: { allowMinimalFallback?: boolean; timeoutMs?: number }
  ): Promise<{
    data: any[];
    total: number | null;
    errors?: any[];
  }> {
    let res = await this.gql<any>({
      role,
      query: LMS_GET_CLASSES_QUERY,
      variables: { payload },
      operationName: "LmsGetClasses",
      timeoutMs: options?.timeoutMs,
    });

    if (
      options?.allowMinimalFallback !== false &&
      ((Array.isArray(res.errors) && res.errors.length > 0) || !Array.isArray(res.data?.classes?.data))
    ) {
      res = await this.gql<any>({
        role,
        query: LMS_GET_CLASSES_MINIMAL_QUERY,
        variables: { payload },
        operationName: "LmsGetClassesMinimal",
        timeoutMs: options?.timeoutMs,
      });
    }

    if (Array.isArray(res.errors) && res.errors.length > 0) {
      return { data: [], total: null, errors: res.errors };
    }

    const conn = res.data?.classes;
    const rows = Array.isArray(conn?.data) ? conn.data : [];
    const rawTotal = conn?.pagination?.total;
    const total =
      typeof rawTotal === "number" && Number.isFinite(rawTotal)
        ? rawTotal
        : typeof rawTotal === "string" && rawTotal.trim() !== "" && Number.isFinite(Number(rawTotal))
          ? Number(rawTotal)
          : null;

    return { data: rows, total };
  }

  public async findClassByCode(
    role: LmsAuthRole,
    rawClassCode: string,
    searchCandidates?: string[]
  ): Promise<any | null> {
    const normTarget = String(rawClassCode || "").trim().toUpperCase();
    if (!normTarget) return null;
    const candidates =
      Array.isArray(searchCandidates) && searchCandidates.length > 0
        ? searchCandidates
        : buildLmsSearchCandidatesPure(normTarget);
    const activeSecrets = [resolveLmsCredentialsForRole(role).password];

    for (const cand of candidates) {
      ensureQueueNotStopped();
      const res = await this.listClasses(role, {
        filter_textSearch: cand,
        pageIndex: 0,
        itemsPerPage: 20,
      });
      if (Array.isArray(res.errors) && res.errors.length > 0) {
        throw new Error(
          redactSecrets(
            String(res.errors[0]?.message || `GraphQL error tìm lớp ${normTarget}`),
            activeSecrets
          )
        );
      }
      const matched = res.data.find(
        (c: any) => String(c?.name || c?.code || "").trim().toUpperCase() === normTarget
      );
      if (matched) return matched;
    }
    return null;
  }

  public async getClassById(
    role: LmsAuthRole,
    lmsClassId: string,
    options?: { allowClassFieldFallback?: boolean; timeoutMs?: number }
  ): Promise<{ clsPayload: any | null; error?: string }> {
    const cleanId = String(lmsClassId || "").trim();
    if (!cleanId) return { clsPayload: null, error: "Thiếu lmsClassId." };
    const activeSecrets = [resolveLmsCredentialsForRole(role).password];

    const attempts: Array<[string, string]> = [
      [LMS_GET_CLASS_BY_ID_QUERY, "GetClassById"],
      [LMS_GET_CLASS_BY_ID_SAFE_QUERY, "GetClassByIdSafe"],
      [LMS_GET_CLASS_BY_ID_MINIMAL_QUERY, "GetClassByIdMinimal"],
      ...(options?.allowClassFieldFallback
        ? ([
            [LMS_CLASS_FIELD_BY_ID_QUERY, "AdminGetClassFieldById"],
            [LMS_CLASS_FIELD_BY_ID_MINIMAL_QUERY, "AdminGetClassFieldByIdMinimal"],
          ] as Array<[string, string]>)
        : []),
    ];

    let lastErr = "";
    for (const [qText, opName] of attempts) {
      ensureQueueNotStopped();
      const res = await this.gql<any>({
        role,
        query: qText,
        variables: { id: cleanId },
        operationName: opName,
        timeoutMs: options?.timeoutMs,
      });
      const payload =
        res.data?.classesById || res.data?.class || res.data?.getClassById || null;
      const hasErr = Array.isArray(res.errors) && res.errors.length > 0;
      if (!hasErr && payload && typeof payload === "object") {
        return { clsPayload: payload };
      }
      if (hasErr && !lastErr) {
        lastErr = String(res.errors![0]?.message || "GraphQL GetClassById error");
      }
    }

    return {
      clsPayload: null,
      error: redactSecrets(
        lastErr || "Không đọc được chi tiết lớp từ LMS GraphQL.",
        activeSecrets
      ),
    };
  }

  public async findStudentSubmissionByClass(
    role: LmsAuthRole,
    lmsClassId: string,
    options?: { timeoutMs?: number }
  ): Promise<{ submissionGqlData: any | null; error?: string }> {
    const cleanId = String(lmsClassId || "").trim();
    if (!cleanId) return { submissionGqlData: null, error: "Thiếu lmsClassId." };
    const activeSecrets = [resolveLmsCredentialsForRole(role).password];

    let res = await this.gql<any>({
      role,
      query: LMS_FIND_STUDENT_SUBMISSION_BY_CLASS_QUERY,
      variables: { payload: { classId: cleanId } },
      operationName: "FindStudentSubmissionByClass",
      timeoutMs: options?.timeoutMs,
    });

    if (
      (Array.isArray(res.errors) && res.errors.length > 0) ||
      !res.data?.findStudentSubmissionByClass
    ) {
      const legacy = await this.gql<any>({
        role,
        query: LMS_FIND_STUDENT_SUBMISSION_BY_CLASS_LEGACY_QUERY,
        variables: { classId: cleanId },
        operationName: "FindStudentSubmissionByClassLegacy",
        timeoutMs: options?.timeoutMs,
      });
      if (
        (!Array.isArray(legacy.errors) || legacy.errors.length === 0) &&
        legacy.data?.findStudentSubmissionByClass
      ) {
        res = legacy;
      }
    }

    if (Array.isArray(res.errors) && res.errors.length > 0) {
      return {
        submissionGqlData: null,
        error: redactSecrets(
          String(res.errors[0]?.message || "GraphQL FindStudentSubmissionByClass error"),
          activeSecrets
        ),
      };
    }

    return {
      submissionGqlData: res.data?.findStudentSubmissionByClass || null,
    };
  }

  public async findAllStudentWorks(
    role: LmsAuthRole,
    lmsClassId: string,
    options?: { timeoutMs?: number }
  ): Promise<{ works: any[]; error?: string }> {
    const cleanId = String(lmsClassId || "").trim();
    if (!cleanId) return { works: [], error: "Thiếu lmsClassId." };
    const activeSecrets = [resolveLmsCredentialsForRole(role).password];

    let res = await this.gql<any>({
      role,
      query: LMS_FIND_ALL_STUDENT_WORKS_QUERY,
      variables: { classId: cleanId },
      operationName: "AdminFindWorks",
      timeoutMs: options?.timeoutMs,
    });

    if (
      (Array.isArray(res.errors) && res.errors.length > 0) ||
      !Array.isArray(res.data?.findAllStudentWorks?.data)
    ) {
      res = await this.gql<any>({
        role,
        query: LMS_FIND_ALL_STUDENT_WORKS_MINIMAL_QUERY,
        variables: { classId: cleanId },
        operationName: "AdminFindWorksMinimal",
        timeoutMs: options?.timeoutMs,
      });
    }

    if (Array.isArray(res.errors) && res.errors.length > 0) {
      return {
        works: [],
        error: redactSecrets(
          String(res.errors[0]?.message || "GraphQL findAllStudentWorks error"),
          activeSecrets
        ),
      };
    }

    const list = res.data?.findAllStudentWorks?.data;
    return {
      works: Array.isArray(list) ? list : [],
    };
  }

  public async findClassesMissAttendOrComment(
    role: LmsAuthRole,
    variables: Record<string, unknown>,
    options?: { timeoutMs?: number }
  ): Promise<{ data: any[]; error?: string }> {
    const activeSecrets = [resolveLmsCredentialsForRole(role).password];
    let res = await this.gql<any>({
      role,
      query: LMS_MISS_ATTEND_CLASSES_QUERY,
      variables,
      operationName: "classesMissAttendOrComment",
      timeoutMs: options?.timeoutMs,
    });

    if (
      (Array.isArray(res.errors) && res.errors.length > 0) ||
      !Array.isArray(res.data?.classesMissAttendOrComment?.data)
    ) {
      res = await this.gql<any>({
        role,
        query: LMS_MISS_ATTEND_MINIMAL_QUERY,
        variables,
        operationName: "classesMissAttendOrCommentMinimal",
        timeoutMs: options?.timeoutMs,
      });
    }

    if (Array.isArray(res.errors) && res.errors.length > 0) {
      return {
        data: [],
        error: redactSecrets(
          String(res.errors[0]?.message || "GraphQL classesMissAttendOrComment error"),
          activeSecrets
        ),
      };
    }

    const list = res.data?.classesMissAttendOrComment?.data;
    return {
      data: Array.isArray(list) ? list : [],
    };
  }

  public async getTeacherByUserId(
    role: LmsAuthRole,
    userId: string,
    options?: { timeoutMs?: number }
  ): Promise<{ id: string; email?: string; mainCentre?: { id: string; name: string } } | null> {
    const cleanUser = String(userId || "").trim();
    if (!cleanUser) return null;
    const res = await this.gql<any>({
      role,
      query: LMS_TEACHER_BY_USER_ID_QUERY,
      variables: { user: cleanUser },
      operationName: "teacherByUserId",
      timeoutMs: options?.timeoutMs,
    });
    if (Array.isArray(res.errors) && res.errors.length > 0) {
      return null;
    }
    return res.data?.teacherByUserId || null;
  }

  /**
   * Fetches all Session 14 student letters (`findStudentLettersPagination`) for a class.
   * Silently returns `{ letters: [] }` if schema/permission rejects so legacy flows never break.
   */
  public async findStudentLettersByClass(
    role: LmsAuthRole,
    lmsClassId: string,
    options?: { timeoutMs?: number }
  ): Promise<{ letters: any[]; error?: string }> {
    const cleanId = String(lmsClassId || "").trim();
    if (!cleanId) return { letters: [] };
    try {
      const res = await this.gql<any>({
        role,
        query: LMS_FIND_STUDENT_LETTERS_BY_CLASS_QUERY,
        variables: { classId: cleanId },
        operationName: "FindStudentLettersByClass",
        timeoutMs: options?.timeoutMs,
      });
      if (Array.isArray(res.errors) && res.errors.length > 0) {
        return {
          letters: [],
          error: String(res.errors[0]?.message || "GraphQL findStudentLettersPagination error"),
        };
      }
      const list = res.data?.findStudentLettersPagination?.data;
      return { letters: Array.isArray(list) ? list : [] };
    } catch (err) {
      if (isQueueStoppedError(err)) throw err;
      return { letters: [] };
    }
  }
}

export const lmsHttpClient = new LmsHttpClient();
