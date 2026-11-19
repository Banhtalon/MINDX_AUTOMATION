import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../config";

let genAiInstance: GoogleGenerativeAI | null = null;

export const MAX_GEMINI_RETRIES_CAP = 6;

export interface GeminiRetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxRetryHintMs?: number;
  label?: string;
  shouldAbort?: () => boolean;
}

function isAbortRequested(shouldAbort?: () => boolean): boolean {
  return Boolean(shouldAbort?.()) || (process as any)?.__mindxQueueStopped === true;
}

function createStopBotAiError(): Error {
  return new Error("Đã dừng tác vụ gọi AI theo lệnh Dừng khẩn cấp (Stop Bot).");
}

function normalizeMaxRetries(raw?: number): number {
  if (raw === Infinity) return MAX_GEMINI_RETRIES_CAP;
  if (raw === -Infinity) return 0;
  if (typeof raw === "number" && !Number.isNaN(raw)) {
    if (raw < 0) return 0;
    if (Number.isFinite(raw)) {
      return Math.min(MAX_GEMINI_RETRIES_CAP, Math.max(0, Math.floor(raw)));
    }
  }
  return 3;
}

function normalizeBoundedMs(
  raw: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw === Infinity) return max;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.min(max, Math.max(min, Math.round(raw)));
  }
  return Math.min(max, Math.max(min, Math.round(fallback)));
}

interface ErrorChainSummary {
  statuses: number[];
  codes: string[];
  text: string;
}

function collectErrorChainSummary(err: unknown): ErrorChainSummary {
  const statuses: number[] = [];
  const codes: string[] = [];
  const parts: string[] = [];
  const seen = new Set<unknown>();
  const queue: Array<{ val: unknown; depth: number }> = [{ val: err, depth: 0 }];
  let visited = 0;

  while (queue.length > 0 && visited < 16) {
    const item = queue.shift()!;
    const cur: any = item.val;
    if (cur === undefined || cur === null) continue;
    visited += 1;

    if (typeof cur === "string") {
      parts.push(cur);
      continue;
    }
    if (typeof cur === "object") {
      if (seen.has(cur)) continue;
      seen.add(cur);

      for (const rawStatus of [cur.status, cur.statusCode, cur.response?.status]) {
        const num = Number(rawStatus);
        if (Number.isFinite(num) && !statuses.includes(num)) {
          statuses.push(num);
        }
      }
      for (const rawCode of [cur.code, cur.errno, cur.syscall, cur.name]) {
        if (typeof rawCode === "string" && rawCode.trim()) {
          codes.push(rawCode.trim());
        }
      }
      if (typeof cur.message === "string" && cur.message.trim()) {
        parts.push(cur.message.trim());
      }
      if (item.depth < 3) {
        if (cur.cause !== undefined && cur.cause !== null) {
          queue.push({ val: cur.cause, depth: item.depth + 1 });
        }
        if (Array.isArray(cur.errors)) {
          for (const childErr of cur.errors.slice(0, 4)) {
            queue.push({ val: childErr, depth: item.depth + 1 });
          }
        }
      }
    } else {
      parts.push(String(cur));
    }
  }

  return {
    statuses,
    codes,
    text: `${codes.join(" ")} ${parts.join(" ")}`.trim(),
  };
}

const TRANSIENT_NETWORK_RE =
  /\b(?:ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|EPIPE|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|UND_ERR_SOCKET|FETCH_ERROR)\b|fetch failed|socket hang up|network error|client network socket disconnected/i;

const KNOWN_SAFE_CODE_RE =
  /\b(ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|EPIPE|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|UND_ERR_SOCKET|FETCH_ERROR|UNAVAILABLE|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED)\b/i;

/**
 * Classifies whether a Gemini failure is transient (upstream overload, rate limit, or brief network glitch).
 * Emergency stops, malformed JSON syntax errors, and invalid keys/requests return false immediately.
 */
export function isTransientGeminiError(err: unknown): boolean {
  if ((process as any)?.__mindxQueueStopped === true) {
    return false;
  }
  if (err instanceof SyntaxError) {
    return false;
  }

  const { statuses, codes, text } = collectErrorChainSummary(err);

  if (/đã dừng tác vụ|dừng khẩn cấp|aborted by stop/i.test(text)) {
    return false;
  }

  if (statuses.some((s) => [400, 401, 403, 404, 422].includes(s))) {
    return false;
  }
  if (/API_KEY_INVALID|API key not valid|\bSAFETY\b|\bSyntaxError\b/i.test(text)) {
    return false;
  }

  if (statuses.some((s) => [429, 500, 502, 503, 504].includes(s))) {
    return true;
  }

  if (
    /\[\s*(?:429|500|502|503|504)\b|\b(?:HTTP|status(?:\s*code)?)\s*(?:429|500|502|503|504)\b/i.test(
      text
    )
  ) {
    return true;
  }

  if (
    /\b(?:UNAVAILABLE|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED)\b|experiencing high demand|spikes in demand|currently overloaded|model is overloaded|temporarily unavailable|service unavailable|too many requests|rate limit exceeded/i.test(
      text
    )
  ) {
    return true;
  }

  if (codes.some((c) => TRANSIENT_NETWORK_RE.test(c)) || TRANSIENT_NETWORK_RE.test(text)) {
    return true;
  }

  return false;
}

/**
 * Produces a strictly non-PII, non-secret structural error summary for console logs.
 * Never interpolates arbitrary exception messages, URLs, or student tokens.
 */
export function summarizeSafeGeminiErrorForLog(err: unknown): string {
  const { statuses, codes, text } = collectErrorChainSummary(err);

  let statusNum = statuses.find((s) => s >= 400 && s <= 599);
  if (!statusNum) {
    const m = text.match(
      /(?:\[\s*|HTTP\s+|status(?:\s*code)?\s+)(400|401|403|404|422|429|500|502|503|504)\b/i
    );
    if (m) statusNum = Number(m[1]);
  }

  const codeMatch = codes.join(" ").match(KNOWN_SAFE_CODE_RE) || text.match(KNOWN_SAFE_CODE_RE);
  const codeToken = codeMatch ? codeMatch[1].toUpperCase() : "";

  let category = "api_error";
  if (/đã dừng tác vụ|dừng khẩn cấp|aborted by stop/i.test(text)) {
    category = "aborted";
  } else if (err instanceof SyntaxError || /\bSyntaxError\b|JSON/i.test(text)) {
    category = "json_parse_error";
  } else if (/experiencing high demand|spikes in demand/i.test(text)) {
    category = "high_demand";
  } else if (statusNum === 429 || /RESOURCE_EXHAUSTED|too many requests|rate limit/i.test(text)) {
    category = "rate_limited";
  } else if (statusNum === 503 || /UNAVAILABLE|overloaded|service unavailable/i.test(text)) {
    category = "overloaded";
  } else if (TRANSIENT_NETWORK_RE.test(text) || /DEADLINE_EXCEEDED/i.test(text)) {
    category = "network_error";
  } else if (statusNum === 401 || statusNum === 403 || /API_KEY_INVALID|API key not valid/i.test(text)) {
    category = "auth_error";
  } else if (statusNum === 400 || statusNum === 422 || statusNum === 404) {
    category = "bad_request";
  } else if (/\bSAFETY\b/i.test(text)) {
    category = "safety_blocked";
  }

  const prefixParts = [statusNum ? `HTTP ${statusNum}` : "", codeToken].filter(Boolean);
  return prefixParts.length > 0 ? `${prefixParts.join(" ")} (${category})` : category;
}

function sanitizeRetryLabelForLog(label?: string): string {
  const raw = String(label || "").trim();
  if (!raw) return "";
  return raw
    .replace(/\bSTU_[A-Za-z0-9_-]+/gi, "STU_REDACTED")
    .replace(/[^A-Za-z0-9_.:/-]/g, "_")
    .slice(0, 64);
}

/**
 * Sleeps in short chunks so Stop Bot / abort flags interrupt backoff wait promptly.
 */
export async function sleepAbortable(ms: number, shouldAbort?: () => boolean): Promise<void> {
  if (isAbortRequested(shouldAbort)) {
    throw createStopBotAiError();
  }
  let remaining = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0;
  while (remaining > 0) {
    if (isAbortRequested(shouldAbort)) {
      throw createStopBotAiError();
    }
    const chunk = Math.min(50, remaining);
    await new Promise((resolve) => setTimeout(resolve, chunk));
    remaining -= chunk;
    if (isAbortRequested(shouldAbort)) {
      throw createStopBotAiError();
    }
  }
}

function extractRawRetryHintMs(err: unknown): number | null {
  const { text } = collectErrorChainSummary(err);
  const m =
    text.match(/retry\s+in\s+(\d+(?:\.\d+)?)s\b/i) ||
    text.match(/retryDelay["']?\s*:\s*["']?(\d+(?:\.\d+)?)s/i);
  if (!m) return null;
  const secs = Number(m[1]);
  if (!Number.isFinite(secs) || secs <= 0) return null;
  return Math.round(secs * 1000);
}

async function awaitWithAbortRace<T>(
  fn: () => Promise<T>,
  shouldAbort?: () => boolean
): Promise<T> {
  if (isAbortRequested(shouldAbort)) {
    throw createStopBotAiError();
  }

  const workPromise = Promise.resolve().then(fn);
  // Prevent delayed rejection from triggering unhandledRejection if aborted early
  workPromise.catch(() => null);

  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    timer = setInterval(() => {
      if (!settled && isAbortRequested(shouldAbort)) {
        settled = true;
        cleanup();
        reject(createStopBotAiError());
      }
    }, 20);
    (timer as any)?.unref?.();

    workPromise.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (isAbortRequested(shouldAbort)) {
          reject(createStopBotAiError());
        } else {
          resolve(value);
        }
      },
      (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (isAbortRequested(shouldAbort)) {
          reject(createStopBotAiError());
        } else {
          reject(err);
        }
      }
    );
  });
}

/**
 * Executes a Gemini API call with bounded exponential backoff on transient upstream/network errors.
 */
export async function callGeminiWithRetry<T>(
  fn: () => Promise<T>,
  options?: GeminiRetryOptions
): Promise<T> {
  const maxRetries = normalizeMaxRetries(options?.maxRetries);
  const baseDelayMs = normalizeBoundedMs(options?.baseDelayMs, 1500, 1, 30_000);
  const maxDelayMs = normalizeBoundedMs(
    options?.maxDelayMs,
    Math.max(baseDelayMs, 8000),
    baseDelayMs,
    60_000
  );
  const maxRetryHintMs = normalizeBoundedMs(
    options?.maxRetryHintMs,
    Math.max(maxDelayMs, 30_000),
    maxDelayMs,
    60_000
  );
  const safeLabel = sanitizeRetryLabelForLog(options?.label);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (isAbortRequested(options?.shouldAbort)) {
      throw createStopBotAiError();
    }
    try {
      return await awaitWithAbortRace(fn, options?.shouldAbort);
    } catch (err) {
      if (isAbortRequested(options?.shouldAbort)) {
        throw createStopBotAiError();
      }
      if (attempt >= maxRetries || !isTransientGeminiError(err)) {
        throw err;
      }

      const rawHintMs = extractRawRetryHintMs(err);
      if (rawHintMs !== null && rawHintMs > maxRetryHintMs) {
        // Server asked for longer than our bounded hint wait ceiling; do not retry prematurely
        throw err;
      }

      const backoffMs = Math.min(
        maxDelayMs,
        Math.round(baseDelayMs * Math.pow(2, attempt) * (0.85 + Math.random() * 0.3))
      );
      const delayMs = rawHintMs !== null ? Math.max(baseDelayMs, rawHintMs) : backoffMs;
      const safeErrSummary = summarizeSafeGeminiErrorForLog(err);

      console.warn(
        `[Gemini Retry]${safeLabel ? ` (${safeLabel})` : ""} Máy chủ Gemini tạm bận, thử lại lần ${
          attempt + 1
        }/${maxRetries} sau ${delayMs}ms: ${safeErrSummary}`
      );
      await sleepAbortable(delayMs, options?.shouldAbort);
    }
  }

  throw new Error("Không thể hoàn thành yêu cầu gọi Gemini sau số lần thử lại.");
}

/**
 * Returns the GoogleGenerativeAI client singleton.
 * Throws a helpful error if GEMINI_API_KEY is not configured.
 */
export function getGeminiClient(): GoogleGenerativeAI {
  if (genAiInstance) {
    return genAiInstance;
  }

  const apiKey = config.geminiApiKey;
  if (!apiKey || apiKey === "your_gemini_api_key_here") {
    throw new Error(
      "[Gemini Client] GEMINI_API_KEY chưa được cấu hình trong .env.local. Vui lòng thêm API Key từ Google AI Studio."
    );
  }

  genAiInstance = new GoogleGenerativeAI(apiKey);
  return genAiInstance;
}

/**
 * Returns the configured Gemini model instance with JSON response MIME type and automatic transient retry.
 */
export function getGeminiModel(
  customModelName?: string,
  customTemperature?: number,
  systemInstruction?: string
) {
  const client = getGeminiClient();
  const modelName = customModelName || config.geminiModel || "gemini-3.5-flash-lite";
  const cleanSystemInstruction =
    typeof systemInstruction === "string" && systemInstruction.trim()
      ? systemInstruction.trim()
      : undefined;

  const modelInstance = client.getGenerativeModel({
    model: modelName,
    ...(cleanSystemInstruction ? { systemInstruction: cleanSystemInstruction } : {}),
    generationConfig: {
      responseMimeType: "application/json",
      temperature: typeof customTemperature === "number" ? customTemperature : 0.3,
    },
  });

  const rawGenerateContent = modelInstance.generateContent.bind(modelInstance);
  Object.defineProperty(modelInstance, "__rawGenerateContent", {
    value: rawGenerateContent,
    enumerable: false,
    configurable: true,
  });
  modelInstance.generateContent = ((...args: Parameters<typeof rawGenerateContent>) =>
    callGeminiWithRetry(() => rawGenerateContent(...args), {
      label: modelName,
    })) as typeof modelInstance.generateContent;

  return modelInstance;
}
