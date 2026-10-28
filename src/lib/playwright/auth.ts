import { browserManager } from "./browser-manager";
import { SELECTORS } from "./selectors";
import { config } from "../config";
import { createNetworkInterceptor } from "./network-interceptor";

export interface AuthStatusResult {
  system: "TEACHING" | "LMS";
  isAuthenticated: boolean;
  currentUrl: string;
  username: string;
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

export class AuthService {
  /**
   * Checks whether the user is already authenticated on LMS or Teaching
   * using the persistent browser context.
   * Strictly parses hostname and pathname (never trusting query strings like ?callbackUrl=...)
   * and waits for client-side SSO redirects to settle before concluding authenticated status.
   */
  public async checkAuthStatus(system: "TEACHING" | "LMS"): Promise<AuthStatusResult> {
    const page = await browserManager.getPage();
    const targetUrl = system === "TEACHING" ? config.teachingUrl : config.lmsUrl;
    const username = system === "TEACHING" ? config.teachingUsername : config.lmsUsername;
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
          return { system, isAuthenticated: false, currentUrl, username };
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
          return { system, isAuthenticated: false, currentUrl: activeUrl, username };
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
            return {
              system,
              isAuthenticated: true,
              currentUrl: confirmUrl,
              username,
            };
          }
          return {
            system,
            isAuthenticated: false,
            currentUrl: confirmUrl,
            username,
          };
        }

        await page.waitForTimeout(500);
      }

      return {
        system,
        isAuthenticated: false,
        currentUrl: page.url(),
        username,
      };
    } catch {
      return {
        system,
        isAuthenticated: false,
        currentUrl: page.url(),
        username,
      };
    }
  }

  /**
   * Attempts automatic login for LMS or Teaching using credentials from environment.
   */
  public async login(system: "TEACHING" | "LMS"): Promise<{ success: boolean; message: string }> {
    const page = await browserManager.getPage();
    const interceptor = createNetworkInterceptor(page);

    const targetUrl = system === "TEACHING" ? config.teachingUrl : config.lmsUrl;
    const username = system === "TEACHING" ? config.teachingUsername : config.lmsUsername;
    const password = system === "TEACHING" ? config.teachingPassword : config.lmsPassword;

    if (!username || !password) {
      return {
        success: false,
        message: `Chưa cấu hình tài khoản hoặc mật khẩu ${system} trong .env.local`,
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

        const status = await this.checkAuthStatus(system);
        if (status.isAuthenticated) {
          return { success: true, message: `Đã đăng nhập sẵn trên ${system}` };
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

      // Fill username reliably (clearing any browser autofill first so React state updates)
      const usernameInput = page.locator(userInputSelector).first();
      await usernameInput.waitFor({ state: "visible", timeout: 15000 });
      await usernameInput.click({ force: true }).catch(() => {});
      await usernameInput.fill("");
      await usernameInput.fill(username);
      if ((await usernameInput.inputValue().catch(() => "")).trim() !== username.trim()) {
        await usernameInput.pressSequentially(username, { delay: 15 });
      }

      // Fill password reliably
      await passwordInput.waitFor({ state: "visible", timeout: 15000 });
      await passwordInput.click({ force: true }).catch(() => {});
      await passwordInput.fill("");
      await passwordInput.fill(password);
      if (!(await passwordInput.inputValue().catch(() => ""))) {
        await passwordInput.pressSequentially(password, { delay: 15 });
      }

      // Dismiss any toasts before clicking submit
      await interceptor.dismissForbiddenToast();

      // Click submit
      const submitBtn = page.locator(submitSelector).first();
      await submitBtn.waitFor({ state: "visible", timeout: 10000 });
      await submitBtn.click();

      // Wait for SSO navigation / redirect and indicator (up to 16s)
      for (let attempt = 0; attempt < 8; attempt++) {
        await page.waitForTimeout(2000);
        const postStatus = await this.checkAuthStatus(system);
        if (postStatus.isAuthenticated) {
          return { success: true, message: `Đăng nhập ${system} thành công!` };
        }
      }

      return {
        success: false,
        message: `Đã gửi form đăng nhập ${system} nhưng chưa phát hiện phiên thành công. Vui lòng kiểm tra lại tài khoản.`,
      };
    } catch (err) {
      await page.screenshot({ path: `data/debug_auth_${system}_failed.png` }).catch(() => {});
      return {
        success: false,
        message: `Lỗi đăng nhập ${system} (URL: ${page.url()}): ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Guarantees that the session is authenticated before proceeding with actions.
   */
  public async ensureAuthenticated(system: "TEACHING" | "LMS"): Promise<void> {
    const status = await this.checkAuthStatus(system);
    if (!status.isAuthenticated) {
      const loginRes = await this.login(system);
      if (!loginRes.success) {
        throw new Error(`[Auth Error] Không thể xác thực ${system}: ${loginRes.message}`);
      }
    }
  }
}

export const authService = new AuthService();
