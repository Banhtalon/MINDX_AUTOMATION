import { config } from "../config";
import { taskQueue } from "../queue/task-queue";

export interface SharedRemoteTeachingStudent {
  id: number;
  student_name: string;
  class_code: string;
  status: string;
}

interface SharedSessionEntry {
  cookieHeader: string;
  loginPromise: Promise<void> | null;
  fetchRef: typeof globalThis.fetch;
}

interface CachedStudentsEntry {
  rawPayload: unknown;
  cachedAt: number;
  fetchRef: typeof globalThis.fetch;
  username: string;
}

const sharedSessions = new Map<string, SharedSessionEntry>();
const sharedStudentCache = new Map<string, CachedStudentsEntry>();

function cloneJsonPayload<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

export function clearSharedTeachingSession(): void {
  sharedSessions.clear();
  sharedStudentCache.clear();
}

export function resolveTeachingBaseOrigin(): string {
  const raw = String(config.teachingUrl || "").trim();
  try {
    if (raw) {
      const parsed = new URL(raw);
      if (parsed.hostname.includes("teachingmindx.top")) {
        return parsed.origin;
      }
    }
  } catch {
    // ignore invalid URL
  }
  return "https://teachingmindx.top";
}

export function ensureQueueNotStopped(): void {
  if ((process as any).__mindxQueueStopped || taskQueue.getStatus().isStopped) {
    throw new Error("QUEUE_STOPPED: Tác vụ đã bị dừng khẩn cấp (Stop Bot).");
  }
}

export async function runWithStopGuard<T>(operation: () => Promise<T>): Promise<T> {
  ensureQueueNotStopped();
  let unsubscribe: (() => void) | null = null;
  try {
    let rejectStop!: (err: Error) => void;
    const stopPromise = new Promise<never>((_resolve, reject) => {
      rejectStop = reject;
    });
    unsubscribe = taskQueue.subscribeStatus((st) => {
      if (st.isStopped || (process as any).__mindxQueueStopped) {
        rejectStop(
          new Error("QUEUE_STOPPED: Tác vụ đã bị dừng khẩn cấp (Stop Bot).")
        );
      }
    });
    if ((process as any).__mindxQueueStopped || taskQueue.getStatus().isStopped) {
      rejectStop(
        new Error("QUEUE_STOPPED: Tác vụ đã bị dừng khẩn cấp (Stop Bot).")
      );
    }
    const result = await Promise.race([operation(), stopPromise]);
    ensureQueueNotStopped();
    return result;
  } finally {
    if (unsubscribe) {
      unsubscribe();
    }
  }
}

export function requireTeachingArrayPayload<T>(
  parsed: unknown,
  endpointName: string
): T[] {
  if (Array.isArray(parsed)) {
    return parsed as T[];
  }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (
      obj.success === false ||
      obj.ok === false ||
      obj.status === "error" ||
      typeof obj.error === "string"
    ) {
      const errMsg =
        typeof obj.message === "string" && obj.message.trim()
          ? obj.message.trim()
          : typeof obj.error === "string" && obj.error.trim()
          ? obj.error.trim()
          : `Teaching từ chối truy cập dữ liệu (${endpointName}).`;
      throw new Error(`[Teaching Protocol Error] ${errMsg}`);
    }
    if (obj.success === true && Array.isArray(obj.data)) {
      return obj.data as T[];
    }
  }
  throw new Error(
    `[Teaching Protocol Error] Phản hồi từ Teaching (${endpointName}) không phải danh sách mảng hợp lệ.`
  );
}

export function requireTeachingMutationAck(
  parsed: unknown,
  actionName: string
): { success: boolean; message?: string; id?: number } {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `[Teaching Protocol Error] Phản hồi từ Teaching (${actionName}) không đúng định dạng JSON object.`
    );
  }
  const obj = parsed as Record<string, unknown>;
  if (
    obj.success === false ||
    obj.ok === false ||
    obj.status === "error" ||
    typeof obj.error === "string"
  ) {
    const msg =
      typeof obj.message === "string" && obj.message.trim()
        ? obj.message.trim()
        : typeof obj.error === "string" && obj.error.trim()
        ? obj.error.trim()
        : `Thao tác ${actionName} trên Teaching thất bại.`;
    return { success: false, message: msg };
  }
  if (obj.success === true) {
    const idVal =
      obj.id !== undefined && obj.id !== null && Number.isFinite(Number(obj.id))
        ? Number(obj.id)
        : undefined;
    return {
      success: true,
      message: typeof obj.message === "string" ? obj.message : undefined,
      ...(idVal !== undefined ? { id: idVal } : {}),
    };
  }
  throw new Error(
    `[Teaching Protocol Error] Phản hồi từ Teaching (${actionName}) thiếu xác nhận success=true.`
  );
}

export class TeachingHttpClient {
  public readonly baseOrigin: string;
  public readonly requestTimeoutMs: number;
  private readonly customUsername?: string;
  private readonly customPassword?: string;

  constructor(
    baseOrigin?: string,
    requestTimeoutMs: number = 30000,
    credentials?: { username?: string; password?: string }
  ) {
    this.baseOrigin = (baseOrigin || resolveTeachingBaseOrigin()).replace(/\/+$/, "");
    this.requestTimeoutMs = requestTimeoutMs;
    this.customUsername = credentials?.username?.trim() || undefined;
    this.customPassword = credentials?.password || undefined;
  }

  private resolveAuthCredentials(): { username: string; password: string } {
    return {
      username: (this.customUsername || config.teachingUsername || "").trim(),
      password: this.customPassword || config.teachingPassword || "",
    };
  }

  private getSessionKey(): string {
    const { username } = this.resolveAuthCredentials();
    return `${this.baseOrigin}::${username}`;
  }

  private getOrInitSessionEntry(): SharedSessionEntry {
    const key = this.getSessionKey();
    const currentFetch = globalThis.fetch;
    const existing = sharedSessions.get(key);
    if (existing && existing.fetchRef === currentFetch) {
      return existing;
    }
    const fresh: SharedSessionEntry = {
      cookieHeader: "",
      loginPromise: null,
      fetchRef: currentFetch,
    };
    sharedSessions.set(key, fresh);
    return fresh;
  }

  public invalidateSession(): void {
    const sessionKey = this.getSessionKey();
    const entry = this.getOrInitSessionEntry();
    entry.cookieHeader = "";
    entry.loginPromise = null;
    for (const key of Array.from(sharedStudentCache.keys())) {
      if (key.startsWith(`${sessionKey}::`)) {
        sharedStudentCache.delete(key);
      }
    }
  }

  public getCookieHeader(): string {
    return this.getOrInitSessionEntry().cookieHeader;
  }

  public async fetchWithStopAndTimeout<T = Response>(
    url: string,
    init?: RequestInit,
    consumeResponse?: (res: Response) => Promise<T>
  ): Promise<T> {
    ensureQueueNotStopped();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => void) | null = null;

    try {
      const abortPromise = new Promise<never>((_resolve, reject) => {
        const onAbort = () => {
          const reason = controller.signal.reason;
          reject(
            reason instanceof Error
              ? reason
              : new Error(String(reason || "Yêu cầu mạng Teaching đã bị hủy."))
          );
        };
        if (controller.signal.aborted) {
          onAbort();
          return;
        }
        controller.signal.addEventListener("abort", onAbort, { once: true });
      });

      unsubscribe = taskQueue.subscribeStatus((st) => {
        if (st.isStopped || (process as any).__mindxQueueStopped) {
          controller.abort(
            new Error("QUEUE_STOPPED: Tác vụ đã bị dừng khẩn cấp (Stop Bot).")
          );
        }
      });

      if ((process as any).__mindxQueueStopped || taskQueue.getStatus().isStopped) {
        controller.abort(
          new Error("QUEUE_STOPPED: Tác vụ đã bị dừng khẩn cấp (Stop Bot).")
        );
      }

      timer = setTimeout(() => {
        controller.abort(
          new Error(
            `Quá thời gian chờ (${this.requestTimeoutMs}ms) khi kết nối tới Teaching (${url}).`
          )
        );
      }, this.requestTimeoutMs);

      const operationPromise = (async (): Promise<T> => {
        const res = await fetch(url, {
          ...init,
          signal: controller.signal,
        });
        ensureQueueNotStopped();
        if (consumeResponse) {
          const consumed = await consumeResponse(res);
          ensureQueueNotStopped();
          return consumed;
        }
        return res as unknown as T;
      })();

      return await Promise.race([operationPromise, abortPromise]);
    } finally {
      if (timer) clearTimeout(timer);
      if (unsubscribe) unsubscribe();
    }
  }

  public async ensureLoggedIn(): Promise<void> {
    const entry = this.getOrInitSessionEntry();
    if (entry.cookieHeader) return;
    if (entry.loginPromise) {
      await entry.loginPromise;
      return;
    }

    const doLogin = (async () => {
      const { username, password } = this.resolveAuthCredentials();
      if (!username || !password) {
        throw new Error(
          "Chưa cấu hình tài khoản hoặc mật khẩu TEACHING trong file .env.local."
        );
      }

      const loginUrl = `${this.baseOrigin}/login.php`;
      const r1 = await this.fetchWithStopAndTimeout(loginUrl, {
        redirect: "manual",
      });
      if (r1.status < 200 || r1.status >= 400) {
        throw new Error(
          `HTTP ${r1.status} khi truy cập trang đăng nhập Teaching (${loginUrl}).`
        );
      }
      const cookies1 =
        typeof (r1.headers as any).getSetCookie === "function"
          ? ((r1.headers as any).getSetCookie() as string[])
          : [r1.headers.get("set-cookie") || ""];
      const initialCookie = cookies1
        .map((c) => c.split(";")[0].trim())
        .filter(Boolean)
        .join("; ");

      const body = new URLSearchParams({
        username,
        password,
        remember: "on",
        redirect: "/hocsinh.php",
      });

      const r2 = await this.fetchWithStopAndTimeout(loginUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...(initialCookie ? { Cookie: initialCookie } : {}),
        },
        body: body.toString(),
        redirect: "manual",
      });

      if (r2.status < 200 || r2.status >= 400) {
        throw new Error(
          `HTTP ${r2.status} khi xác thực đăng nhập trên hệ thống Teaching (${loginUrl}).`
        );
      }

      const cookies2 =
        typeof (r2.headers as any).getSetCookie === "function"
          ? ((r2.headers as any).getSetCookie() as string[])
          : [r2.headers.get("set-cookie") || ""];

      const cookieMap = new Map<string, string>();
      for (const rawCookie of [...cookies1, ...cookies2]) {
        const pair = rawCookie.split(";")[0].trim();
        if (!pair) continue;
        const eqIdx = pair.indexOf("=");
        if (eqIdx > 0) {
          cookieMap.set(pair.slice(0, eqIdx).trim(), pair.slice(eqIdx + 1).trim());
        }
      }

      const combined = Array.from(cookieMap.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");

      if (!combined) {
        throw new Error(
          "Không nhận được phiên đăng nhập (Cookie) từ hệ thống Teaching."
        );
      }
      entry.cookieHeader = combined;
    })();

    entry.loginPromise = doLogin;
    try {
      await doLogin;
    } finally {
      entry.loginPromise = null;
    }
  }

  private static isSessionExpiredStatus(status: number): boolean {
    return status === 301 || status === 302 || status === 401;
  }

  public async getJson<T>(
    query: string,
    errorContext: string = "đọc dữ liệu từ Teaching"
  ): Promise<T> {
    await this.ensureLoggedIn();
    const url = `${this.baseOrigin}/hocsinh.php${
      query.startsWith("?") ? query : `?${query}`
    }`;
    const firstAttempt = await this.fetchWithStopAndTimeout<
      { redirected: true } | { redirected: false; data: T }
    >(
      url,
      {
        method: "GET",
        headers: {
          Cookie: this.getCookieHeader(),
          Accept: "application/json, text/plain, */*",
        },
        redirect: "manual",
      },
      async (res) => {
        if (TeachingHttpClient.isSessionExpiredStatus(res.status)) {
          return { redirected: true };
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} khi ${errorContext} (${query}).`);
        }
        return { redirected: false, data: (await res.json()) as T };
      }
    );

    if (firstAttempt.redirected) {
      this.invalidateSession();
      await this.ensureLoggedIn();
      return await this.fetchWithStopAndTimeout<T>(
        url,
        {
          method: "GET",
          headers: {
            Cookie: this.getCookieHeader(),
            Accept: "application/json, text/plain, */*",
          },
          redirect: "manual",
        },
        async (retryRes) => {
          if (!retryRes.ok) {
            throw new Error(
              `HTTP ${retryRes.status} khi ${errorContext} (${query}).`
            );
          }
          return (await retryRes.json()) as T;
        }
      );
    }

    return firstAttempt.data;
  }

  private static looksLikeLoginHtml(html: string): boolean {
    const lower = String(html || "").toLowerCase();
    return (
      lower.includes('name="password"') &&
      lower.includes('name="username"') &&
      (lower.includes("login.php") || lower.includes("đăng nhập"))
    );
  }

  public async getHtmlPage(
    relativePathWithQuery: string,
    errorContext: string = "đọc trang Teaching"
  ): Promise<string> {
    await this.ensureLoggedIn();
    const normalizedPath = relativePathWithQuery.startsWith("/")
      ? relativePathWithQuery
      : `/${relativePathWithQuery}`;
    const url = `${this.baseOrigin}${normalizedPath}`;

    const attemptFetch = async (): Promise<{ redirected: boolean; html?: string }> => {
      return await this.fetchWithStopAndTimeout(
        url,
        {
          method: "GET",
          headers: {
            Cookie: this.getCookieHeader(),
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          redirect: "manual",
        },
        async (res) => {
          if (TeachingHttpClient.isSessionExpiredStatus(res.status)) {
            return { redirected: true };
          }
          if (!res.ok) {
            throw new Error(`HTTP ${res.status} khi ${errorContext} (${normalizedPath}).`);
          }
          const html = await res.text();
          if (TeachingHttpClient.looksLikeLoginHtml(html)) {
            return { redirected: true };
          }
          return { redirected: false, html };
        }
      );
    };

    const first = await attemptFetch();
    if (!first.redirected && typeof first.html === "string") {
      return first.html;
    }

    this.invalidateSession();
    await this.ensureLoggedIn();
    const retry = await attemptFetch();
    if (retry.redirected || typeof retry.html !== "string") {
      throw new Error(
        `[Teaching Auth Error] Phiên đăng nhập Teaching không hợp lệ hoặc bị chuyển hướng login khi ${errorContext}.`
      );
    }
    return retry.html;
  }

  public async postForm<T>(
    formParams: URLSearchParams,
    errorContext: string = "gửi dữ liệu lên Teaching"
  ): Promise<T> {
    await this.ensureLoggedIn();
    const url = `${this.baseOrigin}/hocsinh.php`;
    const firstAttempt = await this.fetchWithStopAndTimeout<
      { redirected: true } | { redirected: false; data: T }
    >(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Cookie: this.getCookieHeader(),
          Accept: "application/json, text/plain, */*",
        },
        body: formParams.toString(),
        redirect: "manual",
      },
      async (res) => {
        if (TeachingHttpClient.isSessionExpiredStatus(res.status)) {
          return { redirected: true };
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} khi ${errorContext}.`);
        }
        return { redirected: false, data: (await res.json()) as T };
      }
    );

    if (firstAttempt.redirected) {
      this.invalidateSession();
      await this.ensureLoggedIn();
      return await this.fetchWithStopAndTimeout<T>(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Cookie: this.getCookieHeader(),
            Accept: "application/json, text/plain, */*",
          },
          body: formParams.toString(),
          redirect: "manual",
        },
        async (retryRes) => {
          if (!retryRes.ok) {
            throw new Error(`HTTP ${retryRes.status} khi ${errorContext}.`);
          }
          return (await retryRes.json()) as T;
        }
      );
    }

    return firstAttempt.data;
  }

  private formatStudentsPayload<T>(
    rawPayload: unknown,
    classCode: string,
    strictArrayProtocol?: boolean
  ): T[] {
    const cloned = cloneJsonPayload(rawPayload);
    if (strictArrayProtocol) {
      return requireTeachingArrayPayload<T>(cloned, "get_students_of_class");
    }
    if (!Array.isArray(cloned)) {
      return [];
    }
    return cloned
      .map((s: any) => ({
        id: Number(s?.id),
        student_name: String(s?.student_name || "").trim(),
        class_code: String(s?.class_code || classCode).trim(),
        status: String(s?.status || "đang học").trim(),
      }))
      .filter(
        (s) =>
          Number.isInteger(s.id) && s.id > 0 && s.student_name.length > 0
      ) as unknown as T[];
  }

  public async getStudentsOfClass<T = SharedRemoteTeachingStudent>(
    classCode: string,
    options?: {
      useCache?: boolean;
      ttlMs?: number;
      strictArrayProtocol?: boolean;
      sanitizeForProject?: boolean;
      errorContext?: string;
    }
  ): Promise<T[]> {
    const normCode = String(classCode || "").trim().toUpperCase();
    const { username } = this.resolveAuthCredentials();
    const cacheKey = `${this.getSessionKey()}::${normCode}`;
    const ttlMs = options?.ttlMs ?? 15000;
    const useCache = options?.useCache !== false;
    const currentFetch = globalThis.fetch;

    if (useCache) {
      const hit = sharedStudentCache.get(cacheKey);
      if (
        hit &&
        hit.fetchRef === currentFetch &&
        hit.username === username &&
        Date.now() - hit.cachedAt <= ttlMs
      ) {
        return this.formatStudentsPayload<T>(
          hit.rawPayload,
          classCode,
          options?.strictArrayProtocol
        );
      }
    }

    const data = await this.getJson<unknown>(
      `?get_students_of_class=1&class_code=${encodeURIComponent(classCode)}`,
      options?.errorContext || "đọc dữ liệu học sinh từ Teaching"
    );

    const isCacheableArrayPayload =
      Array.isArray(data) ||
      Boolean(
        data &&
          typeof data === "object" &&
          (data as Record<string, unknown>).success === true &&
          Array.isArray((data as Record<string, unknown>).data)
      );

    if (isCacheableArrayPayload) {
      sharedStudentCache.set(cacheKey, {
        rawPayload: cloneJsonPayload(data),
        cachedAt: Date.now(),
        fetchRef: currentFetch,
        username,
      });
    }

    return this.formatStudentsPayload<T>(
      data,
      classCode,
      options?.strictArrayProtocol
    );
  }
}
