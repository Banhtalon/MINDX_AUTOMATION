import type { Page, Response } from "playwright";
import { SELECTORS } from "./selectors";

export interface ApiFilter {
  urlMatch: string | RegExp;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
}

export class NetworkInterceptor {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Automatically attempts to close any red .Forbidden or non-blocking notification toast
   * in the bottom right corner so it doesn't obstruct clicks on action buttons.
   */
  public async dismissForbiddenToast(): Promise<boolean> {
    try {
      const toast = this.page.locator(SELECTORS.common.toastForbidden).first();
      const isVisible = await toast.isVisible().catch(() => false);

      if (isVisible) {
        const closeBtn = toast.locator(SELECTORS.common.toastCloseButton).first();
        if (await closeBtn.isVisible().catch(() => false)) {
          await closeBtn.click({ timeout: 1000 }).catch(() => {});
          return true;
        }
      }
    } catch {
      // Non-critical, ignore
    }
    return false;
  }

  /**
   * Waits for a specific business API response and verifies HTTP status 200/201.
   * Throws a descriptive error if the API returns 401, 403, or 500.
   */
  public async waitForApiResponse(
    urlPattern: string | RegExp,
    timeoutMs = 15000
  ): Promise<Response> {
    const isMatch = (url: string) => {
      if (typeof urlPattern === "string") {
        return url.includes(urlPattern);
      }
      return urlPattern.test(url);
    };

    const response = await this.page.waitForResponse(
      (res) => isMatch(res.url()),
      { timeout: timeoutMs }
    );

    const status = response.status();
    const url = response.url();

    if (status >= 400) {
      throw new Error(
        `[Network API Error] Business API '${url.slice(0, 100)}' failed with HTTP ${status}`
      );
    }

    return response;
  }

  /**
   * Helper to ensure clean button clicking by clearing any obstructing toasts beforehand.
   */
  public async clickSafe(selector: string, timeoutMs = 8000): Promise<void> {
    await this.dismissForbiddenToast();
    const locator = this.page.locator(selector).first();
    await locator.waitFor({ state: "visible", timeout: timeoutMs });
    await this.dismissForbiddenToast();
    await locator.click();
  }
}

export function createNetworkInterceptor(page: Page): NetworkInterceptor {
  return new NetworkInterceptor(page);
}
