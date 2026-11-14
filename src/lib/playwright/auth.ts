import fs from "node:fs";
import path from "node:path";
import type { Cookie, Page } from "playwright";
import { browserManager } from "./browser-manager";
import { SELECTORS } from "./selectors";
import { config, getDynamicAdminConfig } from "../config";
import { createNetworkInterceptor } from "./network-interceptor";
import { assertPathAllowed } from "../security/path-allowlist";
import { redactSecrets, sanitizeErrorMessage } from "../security/secret-redactor";
import { ensureQueueNotStopped } from "../teaching/teaching-http-client";

export type LmsAuthRole = "TEACHER" | "ADMIN";

export interface AuthOptions {
  role?: LmsAuthRole;
}

export interface AuthStatusResult {
  system: "TEACHING" | "LMS";
  isAuthenticated: boolean;
  currentUrl: string;
  username: string;
  role?: LmsAuthRole;
  detectedIdentity?: string;
}

export interface MindxRoleSessionSnapshot {
  role: LmsAuthRole;
  username: string;
  cookies: Cookie[];
  localStorage: Record<string, string>;
  savedAt: string;
}

export interface MindxRoleStateFile {
  TEACHER?: MindxRoleSessionSnapshot;
  ADMIN?: MindxRoleSessionSnapshot;
}

export interface AdminRoleSessionAdapter {
  getCredentials(role: LmsAuthRole): { username: string; password: string };
  captureCurrentSnapshot(expectedRole: LmsAuthRole): Promise<MindxRoleSessionSnapshot>;
  restoreSnapshot(snapshot: MindxRoleSessionSnapshot): Promise<void>;
  ensureRoleAuthenticated(role: LmsAuthRole): Promise<{
    page: Page | null;
    detectedIdentity: string;
  }>;
  verifyActiveIdentity(expectedUsername: string): Promise<string>;
}

export function isMindxAuthDomain(domainOrHost: string): boolean {
  const clean = String(domainOrHost || "")
    .trim()
    .replace(/^\.+/, "")
    .toLowerCase();
  if (!clean) return false;
  return /(^|\.)mindx\.(edu|net)\.vn$/i.test(clean);
}

export function filterMindxCookiesForBackup(cookies: Cookie[]): Cookie[] {
  if (!Array.isArray(cookies)) return [];
  return cookies.filter((c) => isMindxAuthDomain(c?.domain || ""));
}

export function resolveLmsCredentialsForRole(role: LmsAuthRole = "TEACHER"): {
  username: string;
  password: string;
} {
  if (role === "ADMIN") {
    const adminCfg = getDynamicAdminConfig();
    return {
      username: adminCfg.adminLmsUsername,
      password: adminCfg.adminLmsPassword,
    };
  }
  return {
    username: (process.env.LMS_USERNAME || process.env.MINDX_USERNAME || config.lmsUsername || "").trim(),
    password: process.env.LMS_PASSWORD || process.env.MINDX_PASSWORD || config.lmsPassword || "",
  };
}

export function matchesExpectedLmsIdentity(
  detectedIdentity: string,
  expectedUsername: string
): boolean {
  const det = String(detectedIdentity || "").trim().toLowerCase();
  const exp = String(expectedUsername || "").trim().toLowerCase();
  if (!det || !exp) return false;
  if (det === exp) return true;

  const detLocal = det.includes("@") ? det.split("@")[0] : det;
  const expLocal = exp.includes("@") ? exp.split("@")[0] : exp;
  if (!detLocal || !expLocal) return false;
  return detLocal === expLocal;
}

function tryDecodeJwtPayload(token: string): Record<string, unknown> | null {
  const clean = String(token || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  const parts = clean.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(padded, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function pickIdentityFromObject(obj: unknown, depth: number = 0): string {
  if (!obj || typeof obj !== "object" || depth > 4) return "";
  const rec = obj as Record<string, unknown>;
  const directKeys = ["email", "preferred_username", "upn", "username", "userName", "unique_name"];
  for (const key of directKeys) {
    const val = rec[key];
    if (typeof val === "string" && val.trim() && val.trim().length <= 120) {
      return val.trim().toLowerCase();
    }
  }
  if (typeof rec.sub === "string" && rec.sub.includes("@")) {
    return rec.sub.trim().toLowerCase();
  }
  for (const nestedKey of ["profile", "user", "account", "idTokenClaims"]) {
    if (rec[nestedKey] && typeof rec[nestedKey] === "object") {
      const hit = pickIdentityFromObject(rec[nestedKey], depth + 1);
      if (hit) return hit;
    }
  }
  return "";
}

export function extractIdentityFromJwtOrStorageDump(
  storageDump: Record<string, string>,
  authHeader?: string
): string {
  if (authHeader) {
    const jwtObj = tryDecodeJwtPayload(authHeader);
    const hit = pickIdentityFromObject(jwtObj);
    if (hit) return hit;
  }
  if (!storageDump || typeof storageDump !== "object") return "";
  for (const [key, rawVal] of Object.entries(storageDump)) {
    const val = String(rawVal || "").trim();
    if (!val) continue;
    const directJwt = tryDecodeJwtPayload(val);
    if (directJwt) {
      const hit = pickIdentityFromObject(directJwt);
      if (hit) return hit;
    }
    if (val.startsWith("{") || val.startsWith("[")) {
      try {
        const parsed = JSON.parse(val);
        if (parsed && typeof parsed === "object") {
          for (const k of Object.keys(parsed as Record<string, unknown>)) {
            const v = (parsed as Record<string, unknown>)[k];
            if (typeof v === "string" && v.split(".").length === 3) {
              const jwtObj = tryDecodeJwtPayload(v);
              const hit = pickIdentityFromObject(jwtObj);
              if (hit) return hit;
            }
          }
          const direct = pickIdentityFromObject(parsed);
          if (direct) return direct;
        }
      } catch {
        // ignore non-JSON entries
      }
    }
    if (key.toLowerCase().includes("email") && val.includes("@")) {
      return val.toLowerCase();
    }
  }
  return "";
}

export function resolveRoleStateFilePath(): string {
  const customDir = process.env.MINDX_ROLE_STATE_DIR?.trim();
  const baseDir = customDir
    ? path.resolve(process.cwd(), customDir)
    : path.resolve(process.cwd(), "playwright-auth");
  return assertPathAllowed(path.join(baseDir, "mindx_role_state.json"));
}

function readRoleStateFile(): MindxRoleStateFile {
  const filePath = resolveRoleStateFilePath();
  if (!fs.existsSync(filePath)) return {};
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as MindxRoleStateFile) : {};
  } catch {
    return {};
  }
}

function writeRoleStateSnapshot(snapshot: MindxRoleSessionSnapshot): void {
  const filePath = resolveRoleStateFilePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const current = readRoleStateFile();
  current[snapshot.role] = {
    ...snapshot,
    cookies: filterMindxCookiesForBackup(snapshot.cookies),
  };
  fs.writeFileSync(filePath, JSON.stringify(current, null, 2), "utf8");
}

export function invalidateRoleStateSnapshot(role: LmsAuthRole): void {
  try {
    const filePath = resolveRoleStateFilePath();
    if (!fs.existsSync(filePath)) return;
    const current = readRoleStateFile();
    if (role in current) {
      delete current[role];
      fs.writeFileSync(filePath, JSON.stringify(current, null, 2), "utf8");
    }
  } catch {
    // ignore snapshot cleanup errors
  }
}

export function parseUrlParts(rawUrl: string): { hostname: string; pathname: string } {
  try {
    const parsed = new URL(rawUrl);
    return {
      hostname: parsed.hostname.toLowerCase(),
      pathname: parsed.pathname.toLowerCase(),
    };
  } catch {
    return { hostname: "", pathname: "" };
  }
}

export function isLoginHostOrPath(rawUrl: string, targetHost: string): boolean {
  const { hostname, pathname } = parseUrlParts(rawUrl);
  if (!hostname) return false;
  const normalizedTargetHost = targetHost.toLowerCase();
  if (
    hostname.includes("base.mindx.edu.vn") ||
    hostname.includes("id.mindx.edu.vn") ||
    hostname.startsWith("auth.") ||
    hostname.startsWith("sso.") ||
    hostname.startsWith("login.")
  ) {
    return true;
  }
  if (
    pathname.includes("/login") ||
    pathname.includes("/signin") ||
    pathname.includes("/auth")
  ) {
    return true;
  }
  return hostname !== normalizedTargetHost;
}

type SsoLoginErrorCode = "USER_DISABLED" | "MFA_REQUIRED" | "WRONG_CREDENTIALS";

async function detectSsoLoginError(page: {
  url: () => string;
  evaluate: <T>(fn: () => T) => Promise<T>;
}): Promise<SsoLoginErrorCode | null> {
  try {
    const currentUrl = String(page.url() || "").toLowerCase();
    if (!currentUrl.includes("/login") && !currentUrl.includes("base.mindx.edu.vn")) {
      return null;
    }
    const bodyText = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
    if (/USER_DISABLED|userDisabled|bị khóa|vô hiệu hóa/i.test(bodyText)) {
      return "USER_DISABLED";
    }
    if (/totp-enrollment-required|otpauth:\/\/totp|xác thực 2 lớp/i.test(bodyText)) {
      return "MFA_REQUIRED";
    }
    if (/wrongLoginCredentials|INVALID_LOGIN_CREDENTIALS|sai mật khẩu|không chính xác/i.test(bodyText)) {
      return "WRONG_CREDENTIALS";
    }
    return null;
  } catch {
    return null;
  }
}

function formatSsoLoginErrorMessage(code: SsoLoginErrorCode, username: string): string {
  if (code === "USER_DISABLED") {
    return `Tài khoản LMS "${username}" đang bị vô hiệu hóa trên MindX SSO (USER_DISABLED). Vui lòng kiểm tra mã tài khoản đang hoạt động (ví dụ tuanpa1) trong .env.local.`;
  }
  if (code === "MFA_REQUIRED") {
    return `Tài khoản LMS "${username}" yêu cầu xác thực 2 lớp (TOTP MFA), không thể tự động đăng nhập ngầm.`;
  }
  return `Sai tài khoản hoặc mật khẩu đăng nhập LMS cho "${username}" (wrongLoginCredentials). Vui lòng kiểm tra lại trong .env.local.`;
}

export class AuthService {
  /**
   * Captures current MindX localStorage on lms.mindx.edu.vn safely (esbuild __name safe).
   */
  public async readLmsStorageDump(page: Page): Promise<{
    localStorage: Record<string, string>;
    domIdentityHint: string;
  }> {
    await page.evaluate("window.__name = window.__name || function(f){ return f; }").catch(() => {});
    return await page
      .evaluate(() => {
        const out: Record<string, string> = {};
        try {
          for (let i = 0; i < window.localStorage.length; i++) {
            const k = window.localStorage.key(i);
            if (k) out[k] = window.localStorage.getItem(k) || "";
          }
        } catch {
          // ignore storage errors
        }
        let domHint = "";
        try {
          const bodyText = document.body?.innerText || "";
          const emailMatch = bodyText.match(/[a-zA-Z0-9._%+-]+@mindx\.(?:edu|net)\.vn/i);
          if (emailMatch) domHint = emailMatch[0].toLowerCase();
        } catch {
          // ignore DOM read errors
        }
        return { localStorage: out, domIdentityHint: domHint };
      })
      .catch(() => ({ localStorage: {}, domIdentityHint: "" }));
  }

  public async detectActiveLmsIdentity(page: Page): Promise<string> {
    const { hostname } = parseUrlParts(page.url());
    const targetHost = parseUrlParts(config.lmsUrl).hostname;
    if (hostname !== targetHost) {
      return "";
    }
    const { localStorage, domIdentityHint } = await this.readLmsStorageDump(page);
    const fromStorage = extractIdentityFromJwtOrStorageDump(localStorage);
    if (fromStorage) return fromStorage;

    try {
      const cookies = filterMindxCookiesForBackup(await page.context().cookies());
      for (const c of cookies) {
        const val = decodeURIComponent(String(c?.value || "")).trim();
        const hit = extractIdentityFromJwtOrStorageDump({}, val);
        if (hit) return hit;
      }
    } catch {
      // ignore cookie read errors
    }

    return domIdentityHint || "";
  }

  public async captureMindxRoleSnapshot(
    role: LmsAuthRole,
    expectedUsername?: string
  ): Promise<MindxRoleSessionSnapshot> {
    const page = await browserManager.getPage();
    const context = page.context();
    const allCookies = await context.cookies();
    const mindxCookies = filterMindxCookiesForBackup(allCookies);
    const { localStorage } = await this.readLmsStorageDump(page);
    const detected = extractIdentityFromJwtOrStorageDump(localStorage);
    return {
      role,
      username: (detected || expectedUsername || resolveLmsCredentialsForRole(role).username || "").trim(),
      cookies: mindxCookies,
      localStorage,
      savedAt: new Date().toISOString(),
    };
  }

  public async applyMindxRoleSnapshot(snapshot: MindxRoleSessionSnapshot): Promise<void> {
    const page = await browserManager.getPage();
    const context = page.context();
    // Selective MindX-only cookie wipe: leaves Google Drive & other domain sessions 100% intact
    await context.clearCookies({ domain: /mindx\.(edu|net)\.vn$/i });

    const cookiesToRestore = filterMindxCookiesForBackup(snapshot.cookies);
    if (cookiesToRestore.length > 0) {
      await context.addCookies(cookiesToRestore);
    }

    const lmsOrigin = `${new URL(config.lmsUrl).origin}/`;
    const currentHost = parseUrlParts(page.url()).hostname;
    const targetHost = parseUrlParts(config.lmsUrl).hostname;
    if (currentHost !== targetHost) {
      await page.goto(lmsOrigin, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
    }

    await page.evaluate("window.__name = window.__name || function(f){ return f; }").catch(() => {});
    await page
      .evaluate((storageEntries: Record<string, string>) => {
        try {
          window.localStorage.clear();
          window.sessionStorage.clear();
          for (const [k, v] of Object.entries(storageEntries || {})) {
            window.localStorage.setItem(k, String(v));
          }
        } catch {
          // ignore storage errors
        }
      }, snapshot.localStorage || {})
      .catch(() => {});

    await page.goto(`${config.lmsUrl.replace(/\/$/, "")}/admin/classes`, {
      waitUntil: "domcontentloaded",
      timeout: 25000,
    }).catch(() => {});
    await page.waitForTimeout(800);
  }

  public async clearMindxAuthState(): Promise<void> {
    const page = await browserManager.getPage();
    const context = page.context();
    await context.clearCookies({ domain: /mindx\.(edu|net)\.vn$/i });
    const currentHost = parseUrlParts(page.url()).hostname;
    if (currentHost.includes("mindx.edu.vn")) {
      await page.evaluate("window.__name = window.__name || function(f){ return f; }").catch(() => {});
      await page
        .evaluate(() => {
          try {
            window.localStorage.clear();
            window.sessionStorage.clear();
          } catch {
            // ignore
          }
        })
        .catch(() => {});
    }
  }

  /**
   * Checks whether the user is already authenticated on LMS or Teaching
   * using the persistent browser context.
   * Strictly parses hostname and pathname (never trusting query strings like ?callbackUrl=...)
   * and waits for client-side SSO redirects to settle before concluding authenticated status.
   */
  public async checkAuthStatus(
    system: "TEACHING" | "LMS",
    options?: AuthOptions
  ): Promise<AuthStatusResult> {
    const page = await browserManager.getPage();
    const role: LmsAuthRole = options?.role ?? "TEACHER";
    const targetUrl = system === "TEACHING" ? config.teachingUrl : config.lmsUrl;
    const creds = system === "LMS" ? resolveLmsCredentialsForRole(role) : null;
    const username = system === "TEACHING" ? config.teachingUsername : creds!.username;
    const targetHost = parseUrlParts(targetUrl).hostname;

    const pwdSelector =
      system === "TEACHING"
        ? SELECTORS.auth.teaching.passwordInput
        : SELECTORS.auth.lms.passwordInput;
    const indicatorSelector =
      system === "TEACHING"
        ? SELECTORS.auth.teaching.loggedInIndicator
        : SELECTORS.auth.lms.loggedInIndicator;

    try {
      const currentUrl = page.url();
      const currentParts = parseUrlParts(currentUrl);

      // If already sitting on a visible login form for this flow, return false immediately
      const initialHasPwd = await page
        .locator(pwdSelector)
        .first()
        .isVisible()
        .catch(() => false);
      if (initialHasPwd && currentParts.hostname) {
        const isRelevantLoginHost =
          system === "LMS"
            ? currentParts.hostname.includes("mindx.edu.vn")
            : currentParts.hostname === targetHost;
        if (isRelevantLoginHost) {
          return { system, isAuthenticated: false, currentUrl, username, role };
        }
      }

      // Navigate to target system if not currently on targetHost
      if (currentParts.hostname !== targetHost || isLoginHostOrPath(currentUrl, targetHost)) {
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
        await page.waitForTimeout(1000);
      }

      // Poll up to 12 times (6s) to let client-side SPA session checks / SSO redirects settle
      for (let attempt = 0; attempt < 12; attempt++) {
        const activeUrl = page.url();
        const { hostname } = parseUrlParts(activeUrl);

        const hasPasswordInput = await page
          .locator(pwdSelector)
          .first()
          .isVisible()
          .catch(() => false);

        if (hasPasswordInput || isLoginHostOrPath(activeUrl, targetHost)) {
          return { system, isAuthenticated: false, currentUrl: activeUrl, username, role };
        }

        const hasIndicator = await page
          .locator(indicatorSelector)
          .first()
          .isVisible()
          .catch(() => false);

        const hasAppContent = await page
          .locator(
            'table, nav, aside, .MuiDrawer-docked, [data-testid="sidebar"], .ant-layout-sider, .ant-menu, a[href*="class"], .class-card, .avatar, [data-testid="user-profile"], button:has-text("Đăng xuất")'
          )
          .first()
          .isVisible()
          .catch(() => false);

        if (hostname === targetHost && (hasIndicator || hasAppContent) && !hasPasswordInput) {
          // Wait briefly to confirm no in-flight client-side redirect to base.mindx.edu.vn/login
          await page.waitForTimeout(500);
          const confirmUrl = page.url();
          const confirmHasPwd = await page
            .locator(pwdSelector)
            .first()
            .isVisible()
            .catch(() => false);
          if (!confirmHasPwd && !isLoginHostOrPath(confirmUrl, targetHost)) {
            let detectedIdentity = "";
            if (system === "LMS") {
              detectedIdentity = await this.detectActiveLmsIdentity(page);
              if (
                detectedIdentity &&
                username &&
                !matchesExpectedLmsIdentity(detectedIdentity, username)
              ) {
                return {
                  system,
                  isAuthenticated: false,
                  currentUrl: confirmUrl,
                  username,
                  role,
                  detectedIdentity,
                };
              }
            }
            return {
              system,
              isAuthenticated: true,
              currentUrl: confirmUrl,
              username,
              role,
              ...(detectedIdentity ? { detectedIdentity } : {}),
            };
          }
          return {
            system,
            isAuthenticated: false,
            currentUrl: confirmUrl,
            username,
            role,
          };
        }

        await page.waitForTimeout(500);
      }

      return {
        system,
        isAuthenticated: false,
        currentUrl: page.url(),
        username,
        role,
      };
    } catch {
      return {
        system,
        isAuthenticated: false,
        currentUrl: page.url(),
        username,
        role,
      };
    }
  }

  /**
   * Attempts automatic login for LMS or Teaching using credentials from environment.
   */
  public async login(
    system: "TEACHING" | "LMS",
    options?: AuthOptions
  ): Promise<{ success: boolean; message: string; detectedIdentity?: string }> {
    const page = await browserManager.getPage();
    const interceptor = createNetworkInterceptor(page);
    const role: LmsAuthRole = options?.role ?? "TEACHER";

    const targetUrl = system === "TEACHING" ? config.teachingUrl : config.lmsUrl;
    const creds = system === "LMS" ? resolveLmsCredentialsForRole(role) : null;
    const username = system === "TEACHING" ? config.teachingUsername : creds!.username;
    const password = system === "TEACHING" ? config.teachingPassword : creds!.password;

    if (!username || !password) {
      return {
        success: false,
        message:
          system === "LMS" && role === "ADMIN"
            ? "Chưa cấu hình tài khoản ADMIN_LMS_USERNAME / ADMIN_LMS_PASSWORD trong .env.local."
            : `Chưa cấu hình tài khoản hoặc mật khẩu ${system} trong .env.local`,
      };
    }

    const userInputSelector =
      system === "TEACHING"
        ? SELECTORS.auth.teaching.emailInput
        : SELECTORS.auth.lms.usernameInput;
    const passwordSelector =
      system === "TEACHING"
        ? SELECTORS.auth.teaching.passwordInput
        : SELECTORS.auth.lms.passwordInput;
    const submitSelector =
      system === "TEACHING"
        ? SELECTORS.auth.teaching.submitButton
        : SELECTORS.auth.lms.submitButton;

    try {
      // If switching LMS role and saved snapshot exists in role cache, try restoring it first
      if (system === "LMS") {
        const preStatus = await this.checkAuthStatus("LMS", { role });
        if (preStatus.isAuthenticated) {
          const snap = await this.captureMindxRoleSnapshot(role, username);
          writeRoleStateSnapshot(snap);
          return {
            success: true,
            message: `Đã đăng nhập sẵn trên LMS (${role})`,
            detectedIdentity: preStatus.detectedIdentity,
          };
        }

        const roleState = readRoleStateFile();
        const cached = roleState[role];
        if (cached && matchesExpectedLmsIdentity(cached.username, username)) {
          await this.applyMindxRoleSnapshot(cached);
          const restoredStatus = await this.checkAuthStatus("LMS", { role });
          if (restoredStatus.isAuthenticated) {
            return {
              success: true,
              message: `Đã khôi phục phiên LMS (${role}) cho ${username}`,
              detectedIdentity: restoredStatus.detectedIdentity,
            };
          }
        }

        // Different role active or session expired -> wipe only MindX auth state before SSO login
        await this.clearMindxAuthState();
      }

      const currentUrl = page.url();
      const { hostname: currentHost } = parseUrlParts(currentUrl);
      const targetHost = parseUrlParts(targetUrl).hostname;
      const isAlreadyOnRelevantLoginForm =
        (await page
          .locator(passwordSelector)
          .first()
          .isVisible()
          .catch(() => false)) &&
        (system === "LMS"
          ? currentHost.includes("mindx.edu.vn")
          : currentHost === targetHost);

      if (!isAlreadyOnRelevantLoginForm) {
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(1000);

        const status = await this.checkAuthStatus(system, { role });
        if (status.isAuthenticated) {
          if (system === "LMS") {
            const snap = await this.captureMindxRoleSnapshot(role, username);
            writeRoleStateSnapshot(snap);
          }
          return {
            success: true,
            message: `Đã đăng nhập sẵn trên ${system}`,
            detectedIdentity: status.detectedIdentity,
          };
        }
      }

      // If LMS is on an intermediate landing screen with a Login button before redirecting to SSO form, click it
      const passwordInput = page.locator(passwordSelector).first();
      const isPwdReadySoon = await passwordInput
        .waitFor({ state: "visible", timeout: 4000 })
        .then(() => true)
        .catch(() => false);

      if (!isPwdReadySoon) {
        const ssoEntryBtn = page
          .locator(
            'button:has-text("Đăng nhập"), button:has-text("Login"), a:has-text("Đăng nhập"), a:has-text("Login")'
          )
          .first();
        if (await ssoEntryBtn.isVisible().catch(() => false)) {
          await ssoEntryBtn.click().catch(() => {});
          await page.waitForTimeout(1500);
        }
      }

      const fillAndSubmit = async (loginUser: string) => {
        const usernameInput = page.locator(userInputSelector).first();
        await usernameInput.waitFor({ state: "visible", timeout: 15000 });
        await usernameInput.click({ force: true }).catch(() => {});
        await usernameInput.fill("");
        await usernameInput.fill(loginUser);
        if ((await usernameInput.inputValue().catch(() => "")).trim() !== loginUser.trim()) {
          await usernameInput.pressSequentially(loginUser, { delay: 15 });
        }

        await passwordInput.waitFor({ state: "visible", timeout: 15000 });
        await passwordInput.click({ force: true }).catch(() => {});
        await passwordInput.fill("");
        await passwordInput.fill(password);
        if (!(await passwordInput.inputValue().catch(() => ""))) {
          await passwordInput.pressSequentially(password, { delay: 15 });
        }

        await interceptor.dismissForbiddenToast();

        const submitBtn = page.locator(submitSelector).first();
        await submitBtn.waitFor({ state: "visible", timeout: 10000 });
        await submitBtn.click();
      };

      await fillAndSubmit(username);

      let triedBareRetry = false;
      const checkSsoErrorWithRetry = async (): Promise<{
        success: false;
        message: string;
      } | null> => {
        let ssoErr = await detectSsoLoginError(page);
        if (
          ssoErr === "WRONG_CREDENTIALS" &&
          system === "LMS" &&
          username.includes("@") &&
          !triedBareRetry
        ) {
          const bareUser = username.split("@")[0].trim();
          if (bareUser) {
            triedBareRetry = true;
            await fillAndSubmit(bareUser);
            await page.waitForTimeout(1200);
            ssoErr = await detectSsoLoginError(page);
          }
        }
        if (ssoErr) {
          return {
            success: false,
            message: formatSsoLoginErrorMessage(ssoErr, username),
          };
        }
        return null;
      };

      // Catch fast SSO toast errors (e.g. USER_DISABLED disappears after ~3s)
      await page.waitForTimeout(1200);
      const fastErr = await checkSsoErrorWithRetry();
      if (fastErr) return fastErr;

      // Wait for SSO navigation / redirect and indicator (up to 16s)
      for (let attempt = 0; attempt < 8; attempt++) {
        await page.waitForTimeout(1800);
        const postStatus = await this.checkAuthStatus(system, { role });
        if (postStatus.isAuthenticated) {
          if (system === "LMS") {
            const detected =
              postStatus.detectedIdentity || (await this.detectActiveLmsIdentity(page));
            if (detected && !matchesExpectedLmsIdentity(detected, username)) {
              return {
                success: false,
                message: `[Auth Role Mismatch] Phiên LMS sau đăng nhập thuộc về "${detected}", không khớp tài khoản yêu cầu "${username}".`,
                detectedIdentity: detected,
              };
            }
            const snap = await this.captureMindxRoleSnapshot(role, detected || username);
            writeRoleStateSnapshot(snap);
          }
          return {
            success: true,
            message: `Đăng nhập ${system} (${role}) thành công!`,
            detectedIdentity: postStatus.detectedIdentity,
          };
        }

        const loopErr = await checkSsoErrorWithRetry();
        if (loopErr) return loopErr;
      }

      return {
        success: false,
        message: `Đã gửi form đăng nhập ${system} nhưng chưa phát hiện phiên thành công. Vui lòng kiểm tra lại tài khoản.`,
      };
    } catch (err) {
      await page.screenshot({ path: `data/debug_auth_${system}_failed.png` }).catch(() => {});
      return {
        success: false,
        message: redactSecrets(
          `Lỗi đăng nhập ${system} (URL: ${page.url()}): ${sanitizeErrorMessage(err)}`
        ),
      };
    }
  }

  /**
   * Guarantees that the session is authenticated before proceeding with actions.
   */
  public async ensureAuthenticated(
    system: "TEACHING" | "LMS",
    options?: AuthOptions
  ): Promise<void> {
    const role: LmsAuthRole = options?.role ?? "TEACHER";
    const status = await this.checkAuthStatus(system, { role });
    if (!status.isAuthenticated) {
      const loginRes = await this.login(system, { role });
      if (!loginRes.success) {
        throw new Error(
          redactSecrets(`[Auth Error] Không thể xác thực ${system} (${role}): ${loginRes.message}`)
        );
      }
    } else if (system === "LMS") {
      const creds = resolveLmsCredentialsForRole(role);
      const snap = await this.captureMindxRoleSnapshot(
        role,
        status.detectedIdentity || creds.username
      );
      if (snap.cookies.length > 0 || Object.keys(snap.localStorage).length > 0) {
        writeRoleStateSnapshot(snap);
      }
    }
  }

  /**
   * Executes an operation using the Admin LMS account inside the single persistent
   * Playwright BrowserContext (`./playwright-auth`), then unconditionally restores
   * the previous Teacher (`TEACHER`) MindX session in a `finally` block.
   */
  public async withAdminLmsSession<T>(
    fn: (page: Page) => Promise<T>,
    options?: { roleAdapter?: AdminRoleSessionAdapter }
  ): Promise<T> {
    const adapter: AdminRoleSessionAdapter = options?.roleAdapter || {
      getCredentials: (r) => resolveLmsCredentialsForRole(r),
      captureCurrentSnapshot: (expectedRole) =>
        this.captureMindxRoleSnapshot(expectedRole),
      restoreSnapshot: (snapshot) => this.applyMindxRoleSnapshot(snapshot),
      ensureRoleAuthenticated: async (r) => {
        await this.ensureAuthenticated("LMS", { role: r });
        const page = await browserManager.getPage();
        const detectedIdentity = await this.detectActiveLmsIdentity(page);
        return { page, detectedIdentity };
      },
      verifyActiveIdentity: async (expectedUsername) => {
        const page = await browserManager.getPage();
        const detected = await this.detectActiveLmsIdentity(page);
        if (!detected || !matchesExpectedLmsIdentity(detected, expectedUsername)) {
          throw new Error(
            redactSecrets(
              `[Auth Role Mismatch] Phiên LMS hiện tại là "${detected || "<chưa xác định>"}", không khớp tài khoản "${expectedUsername}".`
            )
          );
        }
        return detected;
      },
    };

    const adminCreds = adapter.getCredentials("ADMIN");
    const teacherCreds = adapter.getCredentials("TEACHER");
    const authSecrets = [adminCreds.password, teacherCreds.password];
    if (!adminCreds.username || !adminCreds.password) {
      throw new Error(
        "[Auth Error] Chưa cấu hình tài khoản ADMIN_LMS_USERNAME / ADMIN_LMS_PASSWORD trong .env.local."
      );
    }

    ensureQueueNotStopped();

    let restoreTeacherSnapshot: MindxRoleSessionSnapshot | null = null;
    try {
      const captured = await adapter.captureCurrentSnapshot("TEACHER");
      const capturedIsAdmin =
        Boolean(captured.username) &&
        matchesExpectedLmsIdentity(captured.username, adminCreds.username) &&
        !matchesExpectedLmsIdentity(captured.username, teacherCreds.username);
      if (
        !capturedIsAdmin &&
        (captured.cookies.length > 0 || Object.keys(captured.localStorage).length > 0)
      ) {
        restoreTeacherSnapshot = {
          ...captured,
          role: "TEACHER",
          username: captured.username || teacherCreds.username,
        };
        if (!options?.roleAdapter) {
          writeRoleStateSnapshot(restoreTeacherSnapshot);
        }
      } else if (!options?.roleAdapter) {
        const fileState = readRoleStateFile();
        if (fileState.TEACHER) {
          restoreTeacherSnapshot = fileState.TEACHER;
        }
      }
    } catch {
      if (!options?.roleAdapter) {
        const fileState = readRoleStateFile();
        if (fileState.TEACHER) {
          restoreTeacherSnapshot = fileState.TEACHER;
        }
      }
    }

    let fnResult!: T;
    let hasFnResult = false;
    let primaryError: unknown = null;

    try {
      ensureQueueNotStopped();
      const { page, detectedIdentity } = await adapter.ensureRoleAuthenticated("ADMIN");
      const verifiedIdentity = await adapter.verifyActiveIdentity(adminCreds.username);
      const effectiveIdentity = String(verifiedIdentity || detectedIdentity || "").trim();

      if (
        !effectiveIdentity ||
        !matchesExpectedLmsIdentity(effectiveIdentity, adminCreds.username) ||
        (detectedIdentity &&
          !matchesExpectedLmsIdentity(detectedIdentity, adminCreds.username))
      ) {
        invalidateRoleStateSnapshot("ADMIN");
        if (!options?.roleAdapter) {
          await this.clearMindxAuthState().catch(() => {});
        }
        throw new Error(
          redactSecrets(
            `[Auth Role Mismatch] Tài khoản LMS đang hoạt động ("${detectedIdentity || effectiveIdentity || "<chưa xác định>"}") không khớp Admin ("${adminCreds.username}").`,
            authSecrets
          )
        );
      }

      ensureQueueNotStopped();
      fnResult = await fn(page as Page);
      hasFnResult = true;
    } catch (err) {
      primaryError = err;
    }

    // Unconditionally restore Teacher MindX cookies & storage and verify identity
    let restoreFailure: Error | null = null;
    if (restoreTeacherSnapshot) {
      try {
        await adapter.restoreSnapshot(restoreTeacherSnapshot);
        const expectedTeacher = String(
          restoreTeacherSnapshot.username || teacherCreds.username || ""
        ).trim();
        const restoredIdentity = String(
          (await adapter.verifyActiveIdentity(expectedTeacher)) || ""
        ).trim();
        if (
          !restoredIdentity ||
          (expectedTeacher
            ? !matchesExpectedLmsIdentity(restoredIdentity, expectedTeacher)
            : matchesExpectedLmsIdentity(restoredIdentity, adminCreds.username))
        ) {
          throw new Error(
            `Danh tính LMS sau khôi phục là "${restoredIdentity || "<chưa xác định>"}", không khớp phiên Giáo viên ("${expectedTeacher || "non-admin"}").`
          );
        }
      } catch (restoreErr) {
        invalidateRoleStateSnapshot("ADMIN");
        if (!options?.roleAdapter) {
          await this.clearMindxAuthState().catch(() => {});
        }
        const safeRestoreMsg = sanitizeErrorMessage(restoreErr, authSecrets);
        restoreFailure = new Error(
          `[Auth Restore Error] Khôi phục phiên LMS Giáo viên thất bại: ${safeRestoreMsg}`
        );
        console.error("[AuthService.withAdminLmsSession]", restoreFailure.message);
      }
    } else if (!options?.roleAdapter) {
      // Never leave Admin MindX credentials dangling as default if no Teacher snapshot existed
      invalidateRoleStateSnapshot("ADMIN");
      await this.clearMindxAuthState().catch(() => {});
    }

    if (primaryError !== null) {
      const safePrimary = sanitizeErrorMessage(primaryError, authSecrets);
      if (restoreFailure) {
        throw new Error(`${safePrimary} | ${restoreFailure.message}`);
      }
      if (primaryError instanceof Error) {
        primaryError.message = safePrimary;
        if (primaryError.stack) {
          primaryError.stack = redactSecrets(primaryError.stack, authSecrets);
        }
        throw primaryError;
      }
      throw new Error(safePrimary);
    }

    if (restoreFailure) {
      throw restoreFailure;
    }

    if (!hasFnResult) {
      throw new Error("[Auth Error] Không thu được kết quả phiên Admin LMS.");
    }

    return fnResult;
  }
}

export const authService = new AuthService();
