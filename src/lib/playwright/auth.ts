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

export class AuthService {
  /**
   * Checks whether the user is already authenticated on LMS or Teaching
   * using the persistent browser context.
   */
  public async checkAuthStatus(system: "TEACHING" | "LMS"): Promise<AuthStatusResult> {
    const page = await browserManager.getPage();
    const targetUrl = system === "TEACHING" ? config.teachingUrl : config.lmsUrl;
    const username = system === "TEACHING" ? config.teachingUsername : config.lmsUsername;

    try {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(1500);

      const currentUrl = page.url();
      const isLoginUrl = currentUrl.includes("/login") || currentUrl.includes("/signin") || currentUrl.includes("/auth");

      if (isLoginUrl) {
        return { system, isAuthenticated: false, currentUrl, username };
      }

      // Check DOM indicators
      const selector = system === "TEACHING"
        ? SELECTORS.auth.teaching.loggedInIndicator
        : SELECTORS.auth.lms.loggedInIndicator;

      const indicator = page.locator(selector).first();
      const hasIndicator = await indicator.isVisible().catch(() => false);

      const isAuthenticated = hasIndicator || (!isLoginUrl && currentUrl.startsWith(targetUrl));

      return {
        system,
        isAuthenticated,
        currentUrl,
        username,
      };
    } catch (err) {
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

    try {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(1000);

      // Check if already authenticated
      const status = await this.checkAuthStatus(system);
      if (status.isAuthenticated) {
        return { success: true, message: `Đã đăng nhập sẵn trên ${system}` };
      }

      const userInputSelector =
        system === "TEACHING"
          ? SELECTORS.auth.teaching.emailInput
          : SELECTORS.auth.lms.usernameInput;

      // Fill username
      const usernameInput = page.locator(userInputSelector).first();
      await usernameInput.waitFor({ state: "visible", timeout: 10000 });
      await usernameInput.fill(username);

      // Fill password
      const passwordSelector =
        system === "TEACHING"
          ? SELECTORS.auth.teaching.passwordInput
          : SELECTORS.auth.lms.passwordInput;
      const passwordInput = page.locator(passwordSelector).first();
      await passwordInput.waitFor({ state: "visible", timeout: 10000 });
      await passwordInput.fill(password);

      // Dismiss any toasts before clicking submit
      await interceptor.dismissForbiddenToast();

      // Click submit
      const submitSelector =
        system === "TEACHING"
          ? SELECTORS.auth.teaching.submitButton
          : SELECTORS.auth.lms.submitButton;
      const submitBtn = page.locator(submitSelector).first();
      await submitBtn.click();

      // Wait for navigation or indicator
      await page.waitForTimeout(3000);

      const postStatus = await this.checkAuthStatus(system);
      if (postStatus.isAuthenticated) {
        return { success: true, message: `Đăng nhập ${system} thành công!` };
      }

      return {
        success: false,
        message: `Đã gửi form đăng nhập ${system} nhưng chưa phát hiện phiên thành công. Vui lòng kiểm tra lại tài khoản.`,
      };
    } catch (err) {
      return {
        success: false,
        message: `Lỗi đăng nhập ${system}: ${err instanceof Error ? err.message : String(err)}`,
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
