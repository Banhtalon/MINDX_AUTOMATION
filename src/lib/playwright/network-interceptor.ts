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
   * Uses a bounded loop popping the first visible toast until no obstruction toasts remain,
   * strictly verifying that each toast is actually hidden before counting.
   */
  public async dismissForbiddenToast(maxAttempts = 5): Promise<number> {
    let dismissedCount = 0;
    try {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const toast = this.page.locator(SELECTORS.common.toastForbidden).first();
        const isVis = await toast.isVisible().catch(() => false);
        if (!isVis) {
          break; // No obstruction toasts remain
        }

        const closeBtn = toast.locator(SELECTORS.common.toastCloseButton).first();
        if (await closeBtn.isVisible().catch(() => false)) {
          await closeBtn.click({ timeout: 1500 }).catch(() => {});
        } else {
          await toast.click({ timeout: 1000 }).catch(() => {});
        }

        // Strictly verify that the toast has become hidden
        try {
          await toast.waitFor({ state: "hidden", timeout: 2000 });
          dismissedCount++;
        } catch {
          // If toast failed to hide within timeout, break loop
          break;
        }
      }
    } catch {
      // Non-critical background cleanup
    }
    return dismissedCount;
  }

  /**
   * Waits for a specific business API response and strictly verifies HTTP status 200/201.
   * Supports filtering by both URL pattern and HTTP method (GET, POST, PUT, etc.).
   * Throws a descriptive error if the API returns 401, 403, 500, or any non-2xx status.
   */
  public async waitForApiResponse(
    urlPattern: string | RegExp,
    options?: {
      method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      timeoutMs?: number;
    } | number
  ): Promise<Response> {
    const opts = typeof options === "number" ? { timeoutMs: options } : options;
    const timeoutMs = opts?.timeoutMs ?? 15000;
    const targetMethod = opts?.method?.toUpperCase();

    const isMatch = (res: Response) => {
      const url = res.url();
      const urlMatches =
        typeof urlPattern === "string" ? url.includes(urlPattern) : urlPattern.test(url);
      if (!urlMatches) return false;
      if (targetMethod && res.request().method().toUpperCase() !== targetMethod) {
        return false;
      }
      return true;
    };

    const response = await this.page.waitForResponse(isMatch, { timeout: timeoutMs });

    const status = response.status();
    const url = response.url();
    const method = response.request().method();

    // Strictly enforce 200 or 201 for business operations
    if (status !== 200 && status !== 201) {
      throw new Error(
        `[Network API Error] Business API ${method} '${url.slice(0, 100)}' failed with HTTP status ${status} (Expected 200/201)`
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
