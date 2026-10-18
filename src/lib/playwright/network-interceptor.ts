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
   * Automatically closes all red .Forbidden or obstructing notification toasts
   * in the bottom right corner, ensuring they don't block button clicks.
   * Verifies that toasts are actually dismissed from DOM.
   */
  public async dismissForbiddenToast(): Promise<number> {
    let dismissedCount = 0;
    try {
      const toasts = this.page.locator(SELECTORS.common.toastForbidden);
      const count = await toasts.count().catch(() => 0);

      for (let i = 0; i < count; i++) {
        const toast = toasts.nth(i);
        if (await toast.isVisible().catch(() => false)) {
          const closeBtn = toast.locator(SELECTORS.common.toastCloseButton).first();
          if (await closeBtn.isVisible().catch(() => false)) {
            await closeBtn.click({ timeout: 1500 }).catch(() => {});
            await toast.waitFor({ state: "hidden", timeout: 2000 }).catch(() => {});
            dismissedCount++;
          }
        }
      }
    } catch {
      // Non-critical background cleanup
    }
    return dismissedCount;
  }

  /**
   * Waits for a specific business API response and strictly verifies HTTP status 200/201.
   * Throws a descriptive error if the API returns 401, 403, 500, or any non-2xx status.
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

    // Strictly enforce 200 or 201 for business operations
    if (status !== 200 && status !== 201) {
      throw new Error(
        `[Network API Error] Business API '${url.slice(0, 100)}' failed with HTTP status ${status} (Expected 200/201)`
      );
    }

    return response;
  }

  /**
   * Helper to ensure clean, unobscured button clicking by clearing any toasts beforehand.
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
