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
      operationName?: string | RegExp;
      requestPredicate?: (postData: string) => boolean;
    } | number
  ): Promise<Response> {
    const opts = typeof options === "number" ? { timeoutMs: options } : options;
    const timeoutMs = opts?.timeoutMs ?? 15000;
    const targetMethod = opts?.method?.toUpperCase();

    const isMatch = (res: Response) => {
      const url = res.url();
      let urlMatches = false;
      if (typeof urlPattern === "string") {
        try {
          const parsedUrl = new URL(url);
          const host = parsedUrl.hostname.toLowerCase();
          const pat = urlPattern.toLowerCase();
          if (!pat.includes("/") && !pat.includes(":")) {
            if (pat.includes(".")) {
              urlMatches = host === pat || host.endsWith("." + pat);
            } else {
              urlMatches = host === pat || host.split(".").includes(pat);
            }
          } else {
            urlMatches = url.includes(urlPattern);
          }
        } catch {
          urlMatches = url.includes(urlPattern);
        }
      } else {
        urlMatches = urlPattern.test(url);
      }
      if (!urlMatches) return false;
      if (targetMethod && res.request().method().toUpperCase() !== targetMethod) {
        return false;
      }
      if (opts && typeof opts === "object") {
        const reqObj: any = res.request();
        const postData = typeof reqObj.postData === "function" ? reqObj.postData() || "" : "";
        let parsedBody: any = null;
        if (postData) {
          try {
            parsedBody = JSON.parse(postData);
          } catch {
            parsedBody = null;
          }
        } else if (typeof reqObj.postDataJSON === "function") {
          try {
            parsedBody = reqObj.postDataJSON();
          } catch {
            parsedBody = null;
          }
        }

        if (opts.operationName) {
          const actualOpName =
            parsedBody && typeof parsedBody.operationName === "string"
              ? parsedBody.operationName.trim()
              : "";
          if (!actualOpName) return false;
          const opMatches =
            typeof opts.operationName === "string"
              ? actualOpName === opts.operationName
              : opts.operationName.test(actualOpName);
          if (!opMatches) return false;
        }
        if (opts.requestPredicate && !opts.requestPredicate(postData)) {
          return false;
        }
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

    // Also inspect GraphQL body for top-level errors array even when HTTP status is 200
    if (typeof (response as any).json === "function") {
      const bodyJson = await response.json().catch(() => null);
      if (bodyJson && Array.isArray(bodyJson.errors) && bodyJson.errors.length > 0) {
        const firstErrMsg = bodyJson.errors[0]?.message || JSON.stringify(bodyJson.errors[0]);
        throw new Error(
          `[GraphQL API Error] Business API ${method} '${url.slice(0, 100)}' returned GraphQL errors: ${firstErrMsg}`
        );
      }
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
