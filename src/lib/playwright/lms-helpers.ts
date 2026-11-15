import type { Page, Locator } from "playwright";
import { config } from "../config";
import { resolveKnownLmsClassId } from "../lms/lms-class-id-store";
import { buildLmsClassCommentsUrl } from "../lms/lms-class-url";
import { SELECTORS } from "./selectors";
import { createNetworkInterceptor } from "./network-interceptor";
import { authService, isLoginHostOrPath, parseUrlParts } from "./auth";

export class LmsHelpers {
  private static getDebugScreenshotPath(filename: string): string {
    const overrideDir = process.env.MINDX_DEBUG_SCREENSHOT_DIR?.trim();
    return overrideDir ? `${overrideDir.replace(/[\\/]+$/, "")}/${filename}` : `data/${filename}`;
  }

  private static async scrollRowToCenter(row: Locator): Promise<void> {
    await row
      .evaluate((el) => {
        try {
          el.scrollIntoView({ block: "center", inline: "nearest" });
        } catch {}
      })
      .catch(() => {});
    await row.scrollIntoViewIfNeeded().catch(() => {});
  }

  private static async clickLocatorSafely(
    locator: Locator,
    interceptor: ReturnType<typeof createNetworkInterceptor>,
    position?: { x: number; y: number }
  ): Promise<boolean> {
    if (!(await locator.isVisible().catch(() => false))) return false;
    await interceptor.dismissForbiddenToast();
    const clickOpts = position ? { position, timeout: 2500 } : { timeout: 2500 };
    const forceOpts = position ? { force: true, position, timeout: 2500 } : { force: true, timeout: 2500 };
    try {
      await locator.click(clickOpts);
      return true;
    } catch {
      await interceptor.dismissForbiddenToast();
      try {
        await locator.click(forceOpts);
        return true;
      } catch {
        return false;
      }
    }
  }

  private static async computeCellPaddingClickPoint(
    cell: Locator
  ): Promise<{ x: number; y: number } | undefined> {
    return await cell
      .evaluate((td) => {
        const r = td.getBoundingClientRect();
        if (!r.width || !r.height) return undefined;
        const child = td.querySelector("pre, span, a, button, p, div");
        if (child) {
          const cr = child.getBoundingClientRect();
          if (cr.top - r.top >= 4) {
            return { x: Math.min(10, Math.max(2, r.width / 2)), y: Math.max(2, (cr.top - r.top) / 2) };
          }
          if (cr.left - r.left >= 4) {
            return { x: Math.max(2, (cr.left - r.left) / 2), y: r.height / 2 };
          }
          if (r.bottom - cr.bottom >= 4) {
            return {
              x: Math.min(10, Math.max(2, r.width / 2)),
              y: cr.bottom - r.top + (r.bottom - cr.bottom) / 2,
            };
          }
          if (r.right - cr.right >= 4) {
            return {
              x: cr.right - r.left + (r.right - cr.right) / 2,
              y: r.height / 2,
            };
          }
        }
        return undefined;
      })
      .catch(() => undefined);
  }

  private static async clickRowTarget(
    row: Locator,
    regexPattern: RegExp,
    interceptor: ReturnType<typeof createNetworkInterceptor>,
    mode: "primary" | "cell" | "row" | "dom"
  ): Promise<void> {
    await LmsHelpers.scrollRowToCenter(row);
    const matchingCell = row
      .locator('td, th, [role="cell"], [role="gridcell"]')
      .filter({ hasText: regexPattern })
      .first();
    const secondCell = row.locator("td:nth-child(2)").first();
    if (mode === "primary") {
      const innerTarget = row
        .locator('a, button, [role="button"], pre, span')
        .filter({ hasText: regexPattern })
        .first();
      if (await LmsHelpers.clickLocatorSafely(innerTarget, interceptor)) return;
      if (await LmsHelpers.clickLocatorSafely(matchingCell, interceptor)) return;
      await LmsHelpers.clickLocatorSafely(row, interceptor);
      return;
    }
    if (mode === "cell") {
      const cellPoint = await LmsHelpers.computeCellPaddingClickPoint(matchingCell);
      if (await LmsHelpers.clickLocatorSafely(matchingCell, interceptor, cellPoint)) return;
      const filteredSecondCell = secondCell.filter({ hasText: regexPattern });
      const secondPoint = await LmsHelpers.computeCellPaddingClickPoint(filteredSecondCell);
      if (await LmsHelpers.clickLocatorSafely(filteredSecondCell, interceptor, secondPoint)) return;
      await LmsHelpers.clickLocatorSafely(row, interceptor);
      return;
    }
    if (mode === "row") {
      await LmsHelpers.clickLocatorSafely(row, interceptor);
      return;
    }
    await row
      .evaluate(
        (el, opts: { regexSource: string; regexFlags: string }) => {
          const rx = new RegExp(opts.regexSource, opts.regexFlags);
          let chosen: HTMLElement | null = null;
          const selectorTiers = [
            'a, button, [role="button"]',
            'td, th, [role="cell"], [role="gridcell"]',
            "pre, span",
          ];
          for (const selector of selectorTiers) {
            const nodes = Array.from(el.querySelectorAll(selector));
            for (const node of nodes) {
              if (!node || typeof (node as HTMLElement).click !== "function") continue;
              const txt = (node.textContent || "").trim();
              if (rx.test(txt)) {
                chosen = node as HTMLElement;
                break;
              }
            }
            if (chosen) break;
          }
          const finalTarget = chosen || (el as HTMLElement);
          if (finalTarget && typeof finalTarget.click === "function") {
            finalTarget.click();
          }
        },
        { regexSource: regexPattern.source, regexFlags: regexPattern.flags }
      )
      .catch(() => {});
  }

  private static readonly verifiedDrawerPageCache = new WeakMap<
    Page,
    { targetCode: string; expectedId: string | null; docToken: string; interactiveSeq: number }
  >();

  private static async readDocumentVerifyState(
    page: Page
  ): Promise<{ docToken: string; interactiveSeq: number } | null> {
    if (typeof (page as any).evaluate !== "function") return null;
    return page
      .evaluate(() => {
        const w = window as any;
        return {
          docToken: typeof w.__mindxVerifiedDocToken === "string" ? w.__mindxVerifiedDocToken : "",
          interactiveSeq: Number(w.__mindxInteractiveSeq || 0),
        };
      })
      .catch(() => null);
  }

  private static async checkTrustedVerifiedDrawer(
    page: Page,
    targetCode: string,
    expectedId: string | null
  ): Promise<"trusted" | "invalidated" | "missing"> {
    const cached = LmsHelpers.verifiedDrawerPageCache.get(page);
    if (!cached) return "missing";
    if (cached.targetCode !== targetCode || (cached.expectedId ?? null) !== (expectedId ?? null)) {
      return "missing";
    }
    const stateNow = await LmsHelpers.readDocumentVerifyState(page);
    if (!stateNow) return "invalidated";
    if (
      stateNow.docToken === cached.docToken &&
      stateNow.interactiveSeq === cached.interactiveSeq
    ) {
      return "trusted";
    }
    return "invalidated";
  }

  private static async markVerifiedDrawerOnPage(
    page: Page,
    targetCode: string,
    expectedId: string | null
  ): Promise<void> {
    const freshToken = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    let state: { docToken: string; interactiveSeq: number } | null = null;
    if (typeof (page as any).evaluate === "function") {
      state = await page
        .evaluate((token: string) => {
          const w = window as any;
          if (!w.__mindxClickGuardInstalled) {
            w.__mindxClickGuardInstalled = true;
            w.__mindxInteractiveSeq = Number(w.__mindxInteractiveSeq || 0);
            document.addEventListener(
              "click",
              () => {
                w.__mindxInteractiveSeq = Number(w.__mindxInteractiveSeq || 0) + 1;
              },
              true
            );
          }
          w.__mindxVerifiedDocToken = token;
          return {
            docToken: token,
            interactiveSeq: Number(w.__mindxInteractiveSeq || 0),
          };
        }, freshToken)
        .catch(() => null);
    }
    LmsHelpers.verifiedDrawerPageCache.set(page, {
      targetCode,
      expectedId: expectedId ?? null,
      docToken: state?.docToken || freshToken,
      interactiveSeq: state?.interactiveSeq ?? 0,
    });
  }

  private static async verifyDrawerMatchesTargetClass(
    drawer: Locator,
    regexPattern: RegExp,
    apiIdentity?: {
      expectedId?: string | null;
      enforceExpectedId?: boolean;
      mismatch: boolean;
      confirmed: boolean;
      apiError?: boolean;
    }
  ): Promise<{ matched: boolean; explicitConflict: boolean; rawText: string }> {
    const rawText = await drawer.innerText().catch(() => "");
    if (apiIdentity?.mismatch || apiIdentity?.apiError) {
      return { matched: false, explicitConflict: true, rawText };
    }

    const expectedId = apiIdentity?.expectedId ? String(apiIdentity.expectedId).trim() : "";

    if (typeof (drawer as any).evaluate === "function") {
      const domIdentity = await drawer
        .evaluate((el) => {
          const bodyOrTabScope =
            '[role="tabpanel"], #drawer-body, .drawer-body, .ant-tabs-content, table, tbody, [role="tablist"], textarea, .ql-editor, [id^="class-comments-slot-carousel-"]';
          const tabOrBodyAnchor = el.querySelector(
            '[role="tablist"], #drawer-body, .drawer-body, [role="tabpanel"], table'
          );
          const anchorTop = tabOrBodyAnchor
            ? tabOrBodyAnchor.getBoundingClientRect().top
            : Number.POSITIVE_INFINITY;

          const attrClassIds: string[] = [];
          const rootId = (el.getAttribute("data-class-id") || "").trim();
          if (rootId) attrClassIds.push(rootId);
          for (const node of Array.from(el.querySelectorAll("[data-class-id]"))) {
            if (node.closest(bodyOrTabScope)) continue;
            if (tabOrBodyAnchor) {
              const rel = node.compareDocumentPosition(tabOrBodyAnchor);
              const isBeforeAnchor = Boolean(rel & Node.DOCUMENT_POSITION_FOLLOWING);
              const rect = node.getBoundingClientRect();
              const isVisuallyAbove = anchorTop > 0 && rect.bottom <= anchorTop + 4;
              if (!isBeforeAnchor && !isVisuallyAbove) continue;
            }
            const v = (node.getAttribute("data-class-id") || "").trim();
            if (v) attrClassIds.push(v);
          }

          const attrClassCodes: string[] = [];
          const rootCode = (el.getAttribute("data-class-code") || "").trim();
          if (rootCode) attrClassCodes.push(rootCode);
          for (const node of Array.from(el.querySelectorAll("[data-class-code]"))) {
            if (node.closest(bodyOrTabScope)) continue;
            if (tabOrBodyAnchor) {
              const rel = node.compareDocumentPosition(tabOrBodyAnchor);
              const isBeforeAnchor = Boolean(rel & Node.DOCUMENT_POSITION_FOLLOWING);
              const rect = node.getBoundingClientRect();
              const isVisuallyAbove = anchorTop > 0 && rect.bottom <= anchorTop + 4;
              if (!isBeforeAnchor && !isVisuallyAbove) continue;
            }
            const v = (node.getAttribute("data-class-code") || "").trim();
            if (v) attrClassCodes.push(v);
          }

          const explicitTitleNodes = Array.from(
            el.querySelectorAll(
              '#drawer-title, .ant-drawer-title, [data-class-code], [data-testid*="class-code"], [data-testid*="class-name"]'
            )
          );
          const explicitTitleTexts: string[] = [];
          for (const node of explicitTitleNodes) {
            if (node.closest(bodyOrTabScope)) continue;
            if (tabOrBodyAnchor) {
              const rel = node.compareDocumentPosition(tabOrBodyAnchor);
              const isBeforeAnchor = Boolean(rel & Node.DOCUMENT_POSITION_FOLLOWING);
              const rect = node.getBoundingClientRect();
              const isVisuallyAbove = anchorTop > 0 && rect.bottom <= anchorTop + 4;
              if (!isBeforeAnchor && !isVisuallyAbove) continue;
            }
            const txt = ((node as HTMLElement).innerText || node.textContent || "").trim();
            if (txt) explicitTitleTexts.push(txt);
          }

          const titleNodes = Array.from(
            el.querySelectorAll(
              '.drawer-header, h1, h2, h3, h4, h5, h6, .MuiTypography-h4, .MuiTypography-h5, .MuiTypography-h6'
            )
          );
          const titleTexts: string[] = [];
          for (const node of titleNodes) {
            if (node.closest(bodyOrTabScope)) continue;
            if (node.closest("button")) continue;
            if (tabOrBodyAnchor) {
              const rel = node.compareDocumentPosition(tabOrBodyAnchor);
              const isBeforeAnchor = Boolean(rel & Node.DOCUMENT_POSITION_FOLLOWING);
              const rect = node.getBoundingClientRect();
              const isVisuallyAbove = anchorTop > 0 && rect.bottom <= anchorTop + 4;
              if (!isBeforeAnchor && !isVisuallyAbove) continue;
            }
            if (
              node.classList?.contains("drawer-header") &&
              node.querySelector(
                'h1, h2, h3, h4, h5, h6, #drawer-title, .ant-drawer-title, [data-class-code]'
              )
            ) {
              continue;
            }
            let txt = "";
            if (node.querySelector('button, [role="button"]')) {
              const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
              const parts: string[] = [];
              let cur = walker.nextNode();
              while (cur) {
                const parentEl = cur.parentElement;
                if (!parentEl || !parentEl.closest('button, [role="button"]')) {
                  const piece = (cur.nodeValue || "").trim();
                  if (piece) parts.push(piece);
                }
                cur = walker.nextNode();
              }
              txt = parts.join(" ").trim();
            } else {
              txt = ((node as HTMLElement).innerText || node.textContent || "").trim();
            }
            if (txt) titleTexts.push(txt);
          }

          const headerTexts: string[] = [];
          const headerCandidates = Array.from(
            el.querySelectorAll(
              '.MuiTypography-root, p, span, strong, b, a, [data-testid*="class"]'
            )
          );
          for (const node of headerCandidates) {
            if (node.closest(bodyOrTabScope)) continue;
            if (node.closest("button")) continue;
            if (tabOrBodyAnchor) {
              const rel = node.compareDocumentPosition(tabOrBodyAnchor);
              const isBeforeAnchor = Boolean(rel & Node.DOCUMENT_POSITION_FOLLOWING);
              const rect = node.getBoundingClientRect();
              const isVisuallyAbove = anchorTop > 0 && rect.bottom <= anchorTop + 4;
              if (!isBeforeAnchor && !isVisuallyAbove) continue;
            }
            const txt = ((node as HTMLElement).innerText || node.textContent || "").trim();
            if (txt) headerTexts.push(txt);
          }

          const inputCodeValues: string[] = [];
          for (const inp of Array.from(el.querySelectorAll('input[name="code"], input[name="classCode"]'))) {
            const val = String((inp as HTMLInputElement).value || "").trim();
            if (val) inputCodeValues.push(val);
          }

          const inputNameValues: string[] = [];
          for (const inp of Array.from(el.querySelectorAll('input[name="name"]'))) {
            const val = String((inp as HTMLInputElement).value || "").trim();
            if (val) inputNameValues.push(val);
          }

          const hasStructuredContainer = Boolean(
            el.querySelector(
              '[role="tablist"], [role="tabpanel"], #drawer-body, .drawer-body, table, #drawer-title'
            )
          );

          return {
            attrClassIds,
            attrClassCodes,
            explicitTitleTexts,
            titleTexts,
            headerTexts,
            inputCodeValues,
            inputNameValues,
            hasStructuredContainer,
          };
        })
        .catch(() => null);

      if (domIdentity) {
        if (expectedId && domIdentity.attrClassIds.some((id) => id !== expectedId)) {
          return { matched: false, explicitConflict: true, rawText };
        }

        const isBoilerplate = (txt: string) =>
          /^(update classes|class detail|class details|chi tiết lớp học|back|quay lại)$/i.test(
            txt.replace(/\s+/g, " ").trim()
          );

        const nonBoilerplateExplicitTitles = domIdentity.explicitTitleTexts.filter(
          (t) => !isBoilerplate(t)
        );
        const nonBoilerplateTitles = domIdentity.titleTexts.filter((t) => !isBoilerplate(t));
        const nonBoilerplateHeaders = domIdentity.headerTexts.filter((t) => !isBoilerplate(t));

        // Enforce ALL authoritative conflict checks BEFORE any positive match return (fixes R3-F01)
        if (domIdentity.attrClassCodes.some((c) => !regexPattern.test(c))) {
          return { matched: false, explicitConflict: true, rawText };
        }
        if (nonBoilerplateExplicitTitles.some((t) => !regexPattern.test(t))) {
          return { matched: false, explicitConflict: true, rawText };
        }
        if (nonBoilerplateTitles.some((t) => !regexPattern.test(t))) {
          return { matched: false, explicitConflict: true, rawText };
        }
        if (domIdentity.inputCodeValues.some((v) => !regexPattern.test(v))) {
          return { matched: false, explicitConflict: true, rawText };
        }
        if (
          domIdentity.inputCodeValues.length === 0 &&
          domIdentity.inputNameValues.some((v) => !regexPattern.test(v))
        ) {
          return { matched: false, explicitConflict: true, rawText };
        }

        const hasPositiveMatch =
          domIdentity.attrClassCodes.some((c) => regexPattern.test(c)) ||
          nonBoilerplateExplicitTitles.some((t) => regexPattern.test(t)) ||
          nonBoilerplateTitles.some((t) => regexPattern.test(t)) ||
          domIdentity.inputCodeValues.some((v) => regexPattern.test(v)) ||
          domIdentity.inputNameValues.some((v) => regexPattern.test(v)) ||
          nonBoilerplateHeaders.some((t) => regexPattern.test(t)) ||
          Boolean(apiIdentity?.confirmed);

        if (hasPositiveMatch) {
          return { matched: true, explicitConflict: false, rawText };
        }

        if (domIdentity.hasStructuredContainer) {
          return { matched: false, explicitConflict: false, rawText };
        }
      }
    }

    // Minimal mock fallback (or flat unstructured drawer without title/tab/body containers): inspect only top header lines
    const topHeaderLines = rawText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(
        (line) =>
          line.length > 0 &&
          !/^(update classes|class detail|class details|chi tiết lớp học|back|quay lại)$/i.test(line)
      )
      .slice(0, 3)
      .join("\n");

    return {
      matched: regexPattern.test(topHeaderLines),
      explicitConflict: false,
      rawText,
    };
  }

  private static async applyClassSearchFilter(
    page: Page,
    classCode: string,
    forceApply: boolean
  ): Promise<boolean> {
    const searchInput = page.locator(SELECTORS.classes.searchInput).first();
    if (!(await searchInput.isVisible().catch(() => false))) return false;
    if (!forceApply) {
      const curVal =
        typeof (searchInput as any).inputValue === "function"
          ? await searchInput.inputValue().catch(() => "")
          : "";
      if (curVal.trim().toUpperCase() === classCode.trim().toUpperCase()) {
        return false;
      }
    }
    await searchInput.click().catch(() => {});
    await searchInput.fill(classCode).catch(() => {});
    if (page.keyboard && typeof page.keyboard.press === "function") {
      await page.keyboard.press("Enter").catch(() => {});
    }
    const searchBtn = page.locator(".ant-input-search-button, button:has(.anticon-search)").first();
    if (await searchBtn.isVisible().catch(() => false)) {
      await searchBtn.click().catch(() => {});
    }
    await page.waitForTimeout(1500);
    return true;
  }

  private static async tryOpenDrawerByKnownClassId(
    page: Page,
    targetCode: string,
    drawer: Locator,
    preferredTab: number,
    checkIsAtLogin: () => Promise<boolean>,
    apiIdentity: {
      expectedId?: string | null;
      enforceExpectedId?: boolean;
      mismatch: boolean;
      confirmed: boolean;
      apiError?: boolean;
      apiErrorDetail?: string;
    },
    onBeforeNavigate?: () => void
  ): Promise<boolean> {
    let knownId: string | null = null;
    try {
      knownId = resolveKnownLmsClassId(targetCode).lmsClassId;
    } catch {
      knownId = null;
    }
    if (!knownId || typeof page.goto !== "function") return false;

    const rawUrl = typeof page.url === "function" ? page.url() : "";
    if (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://")) {
      return false;
    }

    onBeforeNavigate?.();
    apiIdentity.expectedId = knownId;
    apiIdentity.enforceExpectedId = true;
    apiIdentity.mismatch = false;
    apiIdentity.confirmed = false;
    apiIdentity.apiError = false;
    apiIdentity.apiErrorDetail = undefined;

    const baseOrigin =
      rawUrl.startsWith("http://127.0.0.1") || rawUrl.startsWith("http://localhost")
        ? new URL(rawUrl).origin
        : config.lmsUrl.replace(/\/$/, "");
    const deepUrl = buildLmsClassCommentsUrl({
      lmsBaseUrl: baseOrigin,
      classCode: targetCode,
      lmsClassId: knownId,
      tab: preferredTab,
    });

    await page
      .goto(deepUrl, {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      })
      .catch(() => {});

    if (await checkIsAtLogin()) {
      await authService.ensureAuthenticated("LMS");
      onBeforeNavigate?.();
      await page
        .goto(deepUrl, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        })
        .catch(() => {});
    }

    return drawer
      .waitFor({ state: "visible", timeout: 6000 })
      .then(() => true)
      .catch(() => false);
  }

  /**
   * Opens the slide-over drawer for a specific class code or classId.
   */
  public static async openClassDrawer(
    page: Page,
    classCode: string,
    options?: { preferredTab?: number }
  ): Promise<void> {
    const interceptor = createNetworkInterceptor(page);
    await interceptor.dismissForbiddenToast();

    // 1. Check if page is at Login screen -> auto-login first before throwing
    const checkIsAtLogin = async () => {
      const isPwdVisible = await page
        .locator('input[type="password"]')
        .first()
        .isVisible()
        .catch(() => false);
      const urlNow = typeof page.url === "function" ? page.url() : "";
      const isLoginUrl = Boolean(urlNow && isLoginHostOrPath(urlNow, "lms.mindx.edu.vn"));
      return isPwdVisible || isLoginUrl;
    };

    if (await checkIsAtLogin()) {
      await authService.ensureAuthenticated("LMS");
      if (await checkIsAtLogin()) {
        throw new Error(
          "[LMS Error] Trình duyệt đang ở màn hình Đăng nhập LMS. Phiên đăng nhập chưa hoàn tất hoặc tài khoản chưa hợp lệ. Vui lòng kiểm tra lại cấu hình LMS_USERNAME / LMS_PASSWORD."
        );
      }
    }

    // 2. Check if the target class drawer is ALREADY open (using strict identity header verification)
    const targetCode = classCode.trim().toUpperCase();
    const escapedTargetCode = targetCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regexPattern = new RegExp(`(^|[^a-zA-Z0-9_-])${escapedTargetCode}([^a-zA-Z0-9_-]|$)`, "i");
    let knownClassIdForTarget: string | null = null;
    try {
      knownClassIdForTarget = resolveKnownLmsClassId(targetCode).lmsClassId;
    } catch {
      knownClassIdForTarget = null;
    }

    const apiIdentity: {
      expectedId?: string | null;
      enforceExpectedId?: boolean;
      mismatch: boolean;
      confirmed: boolean;
      apiError: boolean;
      apiErrorDetail?: string;
    } = {
      expectedId: knownClassIdForTarget,
      enforceExpectedId: false,
      mismatch: false,
      confirmed: false,
      apiError: false,
    };

    let apiTimedOut = false;
    let activeEpoch = 0;
    let disposed = false;
    const inFlightRequests = new Set<any>();
    const pendingTasksByEpoch = new Map<number, Set<Promise<void>>>();
    const requestEpochMap = new Map<any, { epoch: number; reqClassId: string }>();
    let apiIdleWaiters: Array<() => void> = [];

    const getPendingSetForEpoch = (epoch: number): Set<Promise<void>> => {
      let set = pendingTasksByEpoch.get(epoch);
      if (!set) {
        set = new Set<Promise<void>>();
        pendingTasksByEpoch.set(epoch, set);
      }
      return set;
    };

    const getActivePendingTaskCount = (): number =>
      pendingTasksByEpoch.get(activeEpoch)?.size ?? 0;

    const notifyApiIdleIfReady = () => {
      if (inFlightRequests.size === 0 && getActivePendingTaskCount() === 0) {
        const waiters = apiIdleWaiters;
        apiIdleWaiters = [];
        for (const resolve of waiters) resolve();
      }
    };

    const waitForInFlightApis = async (maxWaitMs: number): Promise<boolean> => {
      const deadline = Date.now() + maxWaitMs;
      while (inFlightRequests.size > 0 || getActivePendingTaskCount() > 0) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          return false;
        }
        await Promise.race([
          new Promise<void>((resolve) => {
            apiIdleWaiters.push(resolve);
          }),
          typeof (page as any).waitForTimeout === "function"
            ? page.waitForTimeout(Math.min(remaining, 250))
            : new Promise((r) => setTimeout(r, Math.min(remaining, 250))),
        ]);
        if (apiIdentity.mismatch || apiIdentity.apiError || apiTimedOut) {
          return true;
        }
      }
      return true;
    };

    const beginAttemptEpoch = () => {
      activeEpoch++;
      inFlightRequests.clear();
      apiIdleWaiters = [];
      apiTimedOut = false;
      apiIdentity.mismatch = false;
      apiIdentity.confirmed = false;
      apiIdentity.apiError = false;
      apiIdentity.apiErrorDetail = undefined;
    };

    const classifyClassDetailRequest = (
      req: any
    ): { inScope: boolean; reqClassId: string } => {
      try {
        const u = typeof req?.url === "function" ? String(req.url()) : "";
        if (!u || (!u.includes("lms") && !u.includes("mindx") && !u.includes("graphql"))) {
          return { inScope: false, reqClassId: "" };
        }
        const resourceType =
          typeof req?.resourceType === "function" ? String(req.resourceType()) : "";
        if (
          resourceType &&
          resourceType !== "xhr" &&
          resourceType !== "fetch" &&
          resourceType !== "other"
        ) {
          return { inScope: false, reqClassId: "" };
        }
        const postData = typeof req?.postData === "function" ? String(req.postData() || "") : "";
        let opName = "";
        let queryText = "";
        let reqClassId = "";
        let hasStructuredPostPayload = false;

        if (postData) {
          try {
            const parsed = JSON.parse(postData);
            hasStructuredPostPayload = Boolean(parsed && typeof parsed === "object");
            opName = String(parsed?.operationName || "").trim();
            queryText = String(parsed?.query || "");
            reqClassId = String(
              parsed?.variables?.id || parsed?.variables?._id || parsed?.variables?.classId || ""
            ).trim();
          } catch {
            const opMatch = /operationName["']?\s*:\s*["']([^"']+)["']/i.exec(postData);
            if (opMatch) opName = opMatch[1].trim();
            const qMatch = /"query"\s*:\s*"([^"]+)"/i.exec(postData);
            if (qMatch) queryText = qMatch[1];
          }
        }

        if (opName) {
          if (!/^(get)?class(byid(minimal)?|detail)?$/i.test(opName)) {
            return { inScope: false, reqClassId };
          }
        } else if (queryText) {
          if (/^\s*(?:mutation|subscription)\b/i.test(queryText)) {
            return { inScope: false, reqClassId };
          }
          const hasSingularClassField =
            /\b(?:getClassById|classById|classesById|class)\s*(?:\(|\{)/i.test(queryText);
          if (!hasSingularClassField) {
            return { inScope: false, reqClassId };
          }
        } else if (postData || hasStructuredPostPayload) {
          const isRestClassDetailUrl = /\/class(?:es)?\/[^/?#]+/i.test(u);
          if (!reqClassId && !isRestClassDetailUrl) {
            return { inScope: false, reqClassId };
          }
        } else {
          const parsedUrl = new URL(u, "https://lms.mindx.edu.vn");
          const urlOpName = String(parsedUrl.searchParams.get("operationName") || "").trim();
          const urlQuery = String(parsedUrl.searchParams.get("query") || "");
          const urlVarsRaw = parsedUrl.searchParams.get("variables");
          if (urlVarsRaw) {
            try {
              const urlVars = JSON.parse(urlVarsRaw);
              reqClassId = String(
                urlVars?.id || urlVars?._id || urlVars?.classId || reqClassId || ""
              ).trim();
            } catch {}
          }
          if (!reqClassId) {
            reqClassId = String(
              parsedUrl.searchParams.get("classId") || parsedUrl.searchParams.get("id") || ""
            ).trim();
          }
          if (!reqClassId) {
            const idFromPath = /\/class(?:es)?\/([0-9a-f]{24})(?:\/|$)/i.exec(
              parsedUrl.pathname
            );
            if (idFromPath) reqClassId = idFromPath[1];
          }
          if (urlOpName) {
            if (!/^(get)?class(byid(minimal)?|detail)?$/i.test(urlOpName)) {
              return { inScope: false, reqClassId };
            }
          } else if (urlQuery) {
            if (/^\s*(?:mutation|subscription)\b/i.test(urlQuery)) {
              return { inScope: false, reqClassId };
            }
            if (!/\b(?:getClassById|classById|classesById|class)\s*(?:\(|\{)/i.test(urlQuery)) {
              return { inScope: false, reqClassId };
            }
          } else if (!/\/class(?:es)?\/[^/?#]+/i.test(parsedUrl.pathname)) {
            return { inScope: false, reqClassId };
          }
        }

        if (apiIdentity.expectedId && reqClassId && reqClassId !== apiIdentity.expectedId) {
          return { inScope: false, reqClassId };
        }
        return { inScope: true, reqClassId };
      } catch {
        return { inScope: false, reqClassId: "" };
      }
    };

    const onClassApiRequest = (req: any) => {
      if (disposed) return;
      const meta = classifyClassDetailRequest(req);
      if (meta.inScope) {
        inFlightRequests.add(req);
        requestEpochMap.set(req, { epoch: activeEpoch, reqClassId: meta.reqClassId });
      }
    };

    const onFail = (req: any) => {
      try {
        if (disposed) return;
        const tracked = requestEpochMap.get(req);
        const isCurrentEpoch = tracked
          ? tracked.epoch === activeEpoch
          : activeEpoch === 0 && classifyClassDetailRequest(req).inScope;
        inFlightRequests.delete(req);
        if (isCurrentEpoch) {
          const errText = String(req?.failure?.()?.errorText || "").trim();
          apiIdentity.apiError = true;
          apiIdentity.apiErrorDetail = errText || "Request failed";
          if (/TIMED_OUT|TIMEOUT|DISCONNECTED|RESET|ABORTED|FAILED/i.test(errText) || !errText) {
            apiTimedOut = true;
          }
        }
      } catch {}
      notifyApiIdleIfReady();
    };

    const onClassApiResponse = (res: any) => {
      if (disposed) return;
      const responseEpoch = activeEpoch;
      const req = typeof res?.request === "function" ? res.request() : null;
      if (req) {
        const tracked = requestEpochMap.get(req);
        if (responseEpoch > 0) {
          if (!tracked || tracked.epoch !== responseEpoch) {
            inFlightRequests.delete(req);
            notifyApiIdleIfReady();
            return;
          }
        } else if (tracked && tracked.epoch !== 0) {
          inFlightRequests.delete(req);
          notifyApiIdleIfReady();
          return;
        }
      }
      const meta = req
        ? classifyClassDetailRequest(req)
        : (() => {
            const u = typeof res?.url === "function" ? String(res.url()) : "";
            return {
              inScope: Boolean(
                u && (u.includes("lms") || u.includes("mindx") || u.includes("graphql"))
              ),
              reqClassId: "",
            };
          })();
      if (!meta.inScope) {
        if (req) inFlightRequests.delete(req);
        notifyApiIdleIfReady();
        return;
      }

      const epochTasks = getPendingSetForEpoch(responseEpoch);
      const task = (async () => {
        try {
          if (disposed || responseEpoch !== activeEpoch) return;
          const status = typeof res?.status === "function" ? Number(res.status()) : 200;
          if (Number.isFinite(status) && status >= 400) {
            if (disposed || responseEpoch !== activeEpoch) return;
            apiIdentity.apiError = true;
            apiIdentity.apiErrorDetail = `HTTP ${status}`;
            return;
          }
          const headers = typeof res?.headers === "function" ? res.headers() : {};
          const ct = String(headers?.["content-type"] || "").toLowerCase();
          if (ct && !ct.includes("json")) return;
          if (typeof res?.json !== "function") return;
          const json = await res.json().catch(() => null);
          if (disposed || responseEpoch !== activeEpoch) return;
          if (!json || typeof json !== "object") return;
          const gqlErrors = Array.isArray((json as any).errors) ? (json as any).errors : [];
          if (gqlErrors.length > 0) {
            apiIdentity.apiError = true;
            apiIdentity.apiErrorDetail = String(gqlErrors[0]?.message || "GraphQL error");
            return;
          }
          const clsObj =
            json?.data?.class ||
            json?.data?.classById ||
            json?.data?.getClassById ||
            json?.data?.classesById ||
            json?.class ||
            (json?._id && (json?.name || json?.code || json?.classCode) ? json : null);
          if (!clsObj || typeof clsObj !== "object" || Array.isArray(clsObj)) return;
          const resId = String(clsObj._id || clsObj.id || "").trim();
          const resCode = String(clsObj.code || clsObj.classCode || clsObj.name || "").trim();
          const mustCheckExpectedId = Boolean(apiIdentity.expectedId);
          if (mustCheckExpectedId && resId && resId !== apiIdentity.expectedId) {
            apiIdentity.mismatch = true;
            return;
          }
          if (resCode && !regexPattern.test(resCode)) {
            apiIdentity.mismatch = true;
            return;
          }
          if (
            resCode &&
            regexPattern.test(resCode) &&
            (!mustCheckExpectedId || !resId || resId === apiIdentity.expectedId)
          ) {
            apiIdentity.confirmed = true;
          }
        } catch {}
      })().finally(() => {
        if (req && responseEpoch === activeEpoch) inFlightRequests.delete(req);
        epochTasks.delete(task);
        if (responseEpoch === activeEpoch) {
          notifyApiIdleIfReady();
        }
      });

      epochTasks.add(task);
    };

    const hasNetworkHooks = typeof (page as any).on === "function";
    if (hasNetworkHooks) {
      (page as any).on("request", onClassApiRequest);
      (page as any).on("requestfailed", onFail);
      (page as any).on("response", onClassApiResponse);
    }

    const cleanupListeners = () => {
      disposed = true;
      if (typeof (page as any).off === "function") {
        (page as any).off("request", onClassApiRequest);
        (page as any).off("requestfailed", onFail);
        (page as any).off("response", onClassApiResponse);
      } else if (typeof (page as any).removeListener === "function") {
        (page as any).removeListener("request", onClassApiRequest);
        (page as any).removeListener("requestfailed", onFail);
        (page as any).removeListener("response", onClassApiResponse);
      }
      apiIdleWaiters = [];
      inFlightRequests.clear();
    };

    try {
      const existingDrawer = page
        .locator('div[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight')
        .first();
      if (await existingDrawer.isVisible().catch(() => false)) {
        const existingCheck = await LmsHelpers.verifyDrawerMatchesTargetClass(
          existingDrawer,
          regexPattern,
          apiIdentity
        );
        const hasLoadedContent =
          (await existingDrawer
            .locator('[id^="class-comments-slot-carousel-"], table tbody tr')
            .count()
            .catch(() => 0)) > 0;
        if (existingCheck.matched && hasLoadedContent) {
          const trustStatus = await LmsHelpers.checkTrustedVerifiedDrawer(
            page,
            targetCode,
            knownClassIdForTarget
          );
          if (
            trustStatus === "trusted" &&
            inFlightRequests.size === 0 &&
            getActivePendingTaskCount() === 0 &&
            !apiIdentity.mismatch &&
            !apiIdentity.apiError &&
            !apiTimedOut
          ) {
            return;
          }

          if (hasNetworkHooks && typeof (page as any).waitForTimeout === "function") {
            const settleWindowMs = trustStatus === "invalidated" ? 3200 : 1200;
            const settleDeadline = Date.now() + settleWindowMs;
            while (Date.now() < settleDeadline) {
              if (apiIdentity.mismatch || apiIdentity.apiError || apiTimedOut) break;
              if (inFlightRequests.size > 0 || getActivePendingTaskCount() > 0) {
                const settled = await waitForInFlightApis(8000);
                if (!settled && (inFlightRequests.size > 0 || getActivePendingTaskCount() > 0)) {
                  apiTimedOut = true;
                  apiIdentity.apiErrorDetail =
                    apiIdentity.apiErrorDetail || "Response body timeout";
                }
                break;
              }
              if (apiIdentity.confirmed) break;
              await page.waitForTimeout(100);
            }
            if (
              !apiTimedOut &&
              (inFlightRequests.size > 0 || getActivePendingTaskCount() > 0)
            ) {
              const settled = await waitForInFlightApis(8000);
              if (!settled && (inFlightRequests.size > 0 || getActivePendingTaskCount() > 0)) {
                apiTimedOut = true;
                apiIdentity.apiErrorDetail =
                  apiIdentity.apiErrorDetail || "Response body timeout";
              }
            }
          }

          const postSettleCheck = await LmsHelpers.verifyDrawerMatchesTargetClass(
            existingDrawer,
            regexPattern,
            apiIdentity
          );
          if (apiIdentity.mismatch) {
            const contentShotPath = LmsHelpers.getDebugScreenshotPath("debug_drawer_content.png");
            await page.screenshot?.({ path: contentShotPath }).catch(() => {});
            throw new Error(
              `[LmsHelpers Error] Đã mở Drawer nhưng nội dung trong Drawer không khớp mã lớp '${targetCode}'. Đã chặn thao tác để tránh nhầm lớp. (Ảnh: ${contentShotPath}).`
            );
          }
          if (apiIdentity.apiError || apiTimedOut) {
            const contentShotPath = LmsHelpers.getDebugScreenshotPath("debug_drawer_content.png");
            await page.screenshot?.({ path: contentShotPath }).catch(() => {});
            if (apiTimedOut && !apiIdentity.apiErrorDetail?.includes("HTTP")) {
              throw new Error(
                `[LmsHelpers Error] Máy chủ MindX LMS (lms-api.mindx.edu.vn) đang bị nghẽn hoặc mất kết nối mạng (${apiIdentity.apiErrorDetail || "ERR_CONNECTION_TIMED_OUT"}) khi tải dữ liệu lớp '${targetCode}'. Vui lòng kiểm tra lại kết nối mạng hoặc thử lại sau ít phút.`
              );
            }
            throw new Error(
              `[LmsHelpers Error] Máy chủ MindX LMS trả về lỗi API (${apiIdentity.apiErrorDetail || "HTTP/GraphQL error"}) khi xác minh lớp '${targetCode}'. Đã chặn thao tác để bảo vệ dữ liệu. (Ảnh: ${contentShotPath}).`
            );
          }
          if (apiIdentity.confirmed && postSettleCheck.matched) {
            await LmsHelpers.markVerifiedDrawerOnPage(page, targetCode, knownClassIdForTarget);
            return;
          }
          if (!hasNetworkHooks && postSettleCheck.matched) {
            return;
          }
        }
        // Close mismatched or stuck drawer
        const backBtn = existingDrawer.locator('button:has-text("Back")').first();
        if (await backBtn.isVisible().catch(() => false)) {
          await backBtn.click().catch(() => {});
        } else {
          await page.keyboard.press("Escape").catch(() => {});
          const closeBtn = page.locator(SELECTORS.classes.closeDrawerButton).first();
          if (await closeBtn.isVisible().catch(() => false)) {
            await closeBtn.click().catch(() => {});
          }
        }
        await page.waitForTimeout(500);
        if (await existingDrawer.isVisible().catch(() => false)) {
          const backdrop = page.locator(".MuiBackdrop-root").first();
          if (await backdrop.isVisible().catch(() => false)) {
            await backdrop.click({ position: { x: 10, y: 10 }, force: true }).catch(() => {});
            await page.waitForTimeout(600);
          }
        }
        if (await existingDrawer.isVisible().catch(() => false)) {
          await page
            .goto("https://lms.mindx.edu.vn/admin/classes", {
              waitUntil: "domcontentloaded",
              timeout: 25000,
            })
            .catch(() => {});
          await page.waitForTimeout(2000);
        } else {
          await existingDrawer.waitFor({ state: "hidden", timeout: 2000 }).catch(() => {});
        }
      }

    // 3. Ensure we are on the class list page (expand "> Classes" and click child "Classes" if on /admin/dashboard)
    const isOnClassesPathname = (rawUrl: string) => {
      const { hostname, pathname } = parseUrlParts(rawUrl);
      if (!hostname) {
        return rawUrl.includes("/class") || rawUrl.includes("/classes");
      }
      return (
        hostname === "lms.mindx.edu.vn" &&
        !isLoginHostOrPath(rawUrl, "lms.mindx.edu.vn") &&
        (pathname.includes("/class") || pathname.includes("/classes"))
      );
    };

    const currentUrl = page.url();
    const currentParts = parseUrlParts(currentUrl);
    if (
      currentParts.pathname.includes("/dashboard") ||
      !isOnClassesPathname(currentUrl)
    ) {
      const sidebarClassesItems = page.locator(
        '[data-testid="sidebar"] :text-is("Classes"), .MuiDrawer-docked :text-is("Classes"), aside :text-is("Classes"), nav :text-is("Classes"), :text-is("Classes"), :text-is("Lớp học")'
      );
      const initialCount = await sidebarClassesItems.count().catch(() => 0);
      if (initialCount > 0) {
        if (initialCount === 1) {
          await sidebarClassesItems.first().click({ force: true }).catch(() => {});
          await page.waitForTimeout(700);
        }
        const afterExpandCount = await sidebarClassesItems.count().catch(() => 0);
        if (afterExpandCount >= 2) {
          await sidebarClassesItems.nth(1).click({ force: true }).catch(() => {});
        } else {
          const classMenu = page
            .locator(
              'a[href*="class"], .ant-menu-item:has-text("Lớp học"), a:has-text("Lớp học"), span:has-text("Lớp học"), [aria-label*="Lớp học"]'
            )
            .first();
          if (await classMenu.isVisible().catch(() => false)) {
            await classMenu.click();
          } else {
            await sidebarClassesItems.first().click({ force: true }).catch(() => {});
          }
        }
        await page.waitForTimeout(2000);
      } else {
        const classMenu = page
          .locator(
            'a[href*="class"], .ant-menu-item:has-text("Lớp học"), a:has-text("Lớp học"), span:has-text("Lớp học"), [aria-label*="Lớp học"]'
          )
          .first();
        if (await classMenu.isVisible().catch(() => false)) {
          await classMenu.click();
          await page.waitForTimeout(2000);
        }
      }
      if (!isOnClassesPathname(page.url())) {
        await page
          .goto("https://lms.mindx.edu.vn/admin/classes", {
            waitUntil: "domcontentloaded",
            timeout: 25000,
          })
          .catch(() => {});
        await page.waitForTimeout(1500);
      }
    }

    // If navigating to /admin/classes triggered a delayed SSO redirect to the login page, auto-login and return to /admin/classes
    if (await checkIsAtLogin()) {
      await authService.ensureAuthenticated("LMS");
      if (!isOnClassesPathname(page.url())) {
        await page
          .goto("https://lms.mindx.edu.vn/admin/classes", {
            waitUntil: "domcontentloaded",
            timeout: 25000,
          })
          .catch(() => {});
        await page.waitForTimeout(2000);
      }
    }

      // 4. Check if target class row is ALREADY visible in the current table before triggering a slow search reload
      const findMatchingClassRow = () =>
        page
          .locator("table tbody tr, .class-card, .class-item")
          .filter({
            has: page.locator("pre, td, a, span, div").filter({ hasText: regexPattern }),
          })
          .or(
            page
              .locator("table tbody tr, .class-card, .class-item")
              .filter({ hasText: regexPattern })
          )
          .first();

      let matchedRow = findMatchingClassRow();
      let isVisibleDirect = await matchedRow.isVisible().catch(() => false);
      const drawer = page.locator(SELECTORS.classes.drawer).first();
      const preferredTab = options?.preferredTab ?? 0;
      let drawerAlreadyOpened = false;

      if (!isVisibleDirect) {
        // If a delayed SSO redirect happened while loading the table, auto-login and navigate back to /admin/classes
        if (await checkIsAtLogin()) {
          await authService.ensureAuthenticated("LMS");
          await page
            .goto("https://lms.mindx.edu.vn/admin/classes", {
              waitUntil: "domcontentloaded",
              timeout: 25000,
            })
            .catch(() => {});
          await page.waitForTimeout(2000);
        }

        // If search input exists, filter by class code
        await LmsHelpers.applyClassSearchFilter(page, classCode, true);

        matchedRow = findMatchingClassRow();
        isVisibleDirect = await matchedRow
          .waitFor({ state: "visible", timeout: 8000 })
          .then(() => true)
          .catch(() => false);
      }

      if (!isVisibleDirect) {
        // One more check in case the session expired during search
        if (await checkIsAtLogin()) {
          await authService.ensureAuthenticated("LMS");
          await page
            .goto("https://lms.mindx.edu.vn/admin/classes", {
              waitUntil: "domcontentloaded",
              timeout: 25000,
            })
            .catch(() => {});
          await page.waitForTimeout(2000);
        }

        // Clear any stale filters (e.g. Session range 3 -> 5) and re-apply search
        const clearBtn = page.locator('button:has-text("Clear")').first();
        if (await clearBtn.isVisible().catch(() => false)) {
          await clearBtn.click({ force: true }).catch(() => {});
          await page.waitForTimeout(1500);
          await LmsHelpers.applyClassSearchFilter(page, classCode, true);
        }

        // Fallback: check tab "Tất cả" / "All" first (so Finished classes within 15 days can also be opened), then "Đang học"
        const allOrRunningTab = page
          .locator(
            'button:has-text("Tất cả"), [role="tab"]:has-text("Tất cả"), a:has-text("Tất cả"), button:has-text("All"), [role="tab"]:has-text("All"), button:has-text("Đang học"), [role="tab"]:has-text("Đang học"), a:has-text("Đang học")'
          )
          .first();
        if (await allOrRunningTab.isVisible().catch(() => false)) {
          await allOrRunningTab.click().catch(() => {});
          await page.waitForTimeout(1500);
        }

        // Re-try with strict boundary regex only (never substring match), or fallback to known lmsClassId URL
        matchedRow = findMatchingClassRow();
        const foundRow = await matchedRow
          .waitFor({ state: "visible", timeout: 10000 })
          .then(() => true)
          .catch(() => false);
        if (!foundRow) {
          drawerAlreadyOpened = await LmsHelpers.tryOpenDrawerByKnownClassId(
            page,
            targetCode,
            drawer,
            preferredTab,
            checkIsAtLogin,
            apiIdentity,
            beginAttemptEpoch
          );
          if (!drawerAlreadyOpened) {
            const shotPath = LmsHelpers.getDebugScreenshotPath("debug_class_not_found.png");
            await page
              .screenshot({ path: shotPath })
              .catch(() => {});
            throw new Error(
              `[LmsHelpers Error] Không tìm thấy lớp '${targetCode}' trên danh sách lớp LMS. Vui lòng kiểm tra lại mã lớp hoặc bộ lọc trên LMS. (Ảnh chẩn đoán lưu tại ${shotPath})`
            );
          }
        }
      }

      await interceptor.dismissForbiddenToast();

      const waitForDrawerVisible = async (timeoutMs: number): Promise<boolean> => {
        return drawer
          .waitFor({ state: "visible", timeout: timeoutMs })
          .then(() => true)
          .catch(() => false);
      };

      if (!drawerAlreadyOpened) {
        // Allow React/MUI table event handlers and layout to settle right after domcontentloaded
        await page.waitForTimeout(200);

        // Stage A: Center-scroll row (away from bottom horizontal scrollbar) & normal-first click
        beginAttemptEpoch();
        await LmsHelpers.clickRowTarget(matchedRow, regexPattern, interceptor, "primary");
        drawerAlreadyOpened = await waitForDrawerVisible(4000);
      }

      if (!drawerAlreadyOpened && !(await drawer.isVisible().catch(() => false))) {
        // Stage B: Handle late SSO redirect or hydration race; retry cell -> row -> DOM click
        if (await checkIsAtLogin()) {
          await authService.ensureAuthenticated("LMS");
          await page
            .goto("https://lms.mindx.edu.vn/admin/classes", {
              waitUntil: "domcontentloaded",
              timeout: 25000,
            })
            .catch(() => {});
          await page.waitForTimeout(1500);
        }

        matchedRow = findMatchingClassRow();
        beginAttemptEpoch();
        await LmsHelpers.clickRowTarget(matchedRow, regexPattern, interceptor, "cell");
        drawerAlreadyOpened = await waitForDrawerVisible(2500);

        if (!drawerAlreadyOpened && !(await drawer.isVisible().catch(() => false))) {
          beginAttemptEpoch();
          await LmsHelpers.clickRowTarget(matchedRow, regexPattern, interceptor, "row");
          drawerAlreadyOpened = await waitForDrawerVisible(1500);
        }

        if (!drawerAlreadyOpened && !(await drawer.isVisible().catch(() => false))) {
          beginAttemptEpoch();
          await LmsHelpers.clickRowTarget(matchedRow, regexPattern, interceptor, "dom");
          drawerAlreadyOpened = await waitForDrawerVisible(1500);
        }
      }

      if (!drawerAlreadyOpened && !(await drawer.isVisible().catch(() => false))) {
        // Stage C: Isolate target row to Row 1 via Search input (escapes bottom scrollbar / overlapping rows)
        const filtered = await LmsHelpers.applyClassSearchFilter(page, classCode, false);
        if (filtered && !(await drawer.isVisible().catch(() => false))) {
          matchedRow = findMatchingClassRow();
          const isolatedVisible = await matchedRow
            .waitFor({ state: "visible", timeout: 5000 })
            .then(() => true)
            .catch(() => false);
          if (isolatedVisible && !(await drawer.isVisible().catch(() => false))) {
            beginAttemptEpoch();
            await LmsHelpers.clickRowTarget(matchedRow, regexPattern, interceptor, "primary");
            drawerAlreadyOpened = await waitForDrawerVisible(3500);
            if (!drawerAlreadyOpened && !(await drawer.isVisible().catch(() => false))) {
              beginAttemptEpoch();
              await LmsHelpers.clickRowTarget(matchedRow, regexPattern, interceptor, "cell");
              drawerAlreadyOpened = await waitForDrawerVisible(2000);
            }
          }
        }
      }

      if (!drawerAlreadyOpened && !(await drawer.isVisible().catch(() => false))) {
        // Stage D: Navigate directly via cached lmsClassId deep-link (?search=...&id=...&tab=...)
        drawerAlreadyOpened = await LmsHelpers.tryOpenDrawerByKnownClassId(
          page,
          targetCode,
          drawer,
          preferredTab,
          checkIsAtLogin,
          apiIdentity,
          beginAttemptEpoch
        );
      }

      // 6. Final verification that Drawer appeared (preserving Playwright waitFor error semantics) and strictly belongs to targetCode
      try {
        if (!drawerAlreadyOpened) {
          await drawer.waitFor({ state: "visible", timeout: 1500 });
        }
      } catch (err) {
        const timeoutShotPath = LmsHelpers.getDebugScreenshotPath("debug_drawer_timeout.png");
        await page
          .screenshot({ path: timeoutShotPath })
          .catch(() => {});
        throw new Error(
          `[LmsHelpers Error] Timeout khi chờ Drawer chi tiết lớp '${targetCode}' xuất hiện sau khi click dòng lớp học. (Ảnh chụp màn hình: ${timeoutShotPath}): ${err instanceof Error ? err.message : String(err)}`
        );
      }

      let drawerText = "";
      let matchesDrawer = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        await page.waitForTimeout(attempt === 0 ? 200 : 500);
        const identityCheck = await LmsHelpers.verifyDrawerMatchesTargetClass(
          drawer,
          regexPattern,
          apiIdentity
        );
        drawerText = identityCheck.rawText;
        if (apiIdentity.mismatch || apiIdentity.apiError || apiTimedOut) {
          break;
        }
        if (identityCheck.matched) {
          if (inFlightRequests.size > 0 || getActivePendingTaskCount() > 0) {
            const settled = await waitForInFlightApis(8000);
            const postApiCheck = await LmsHelpers.verifyDrawerMatchesTargetClass(
              drawer,
              regexPattern,
              apiIdentity
            );
            drawerText = postApiCheck.rawText;
            if (!settled && (inFlightRequests.size > 0 || getActivePendingTaskCount() > 0)) {
              apiTimedOut = true;
              apiIdentity.apiErrorDetail =
                apiIdentity.apiErrorDetail || "Response body timeout";
              break;
            }
            if (apiIdentity.mismatch || apiIdentity.apiError || apiTimedOut || !postApiCheck.matched) {
              break;
            }
          }
          matchesDrawer = true;
          break;
        }
        if (
          (apiTimedOut && attempt >= 10) ||
          (apiIdentity.mismatch && attempt >= 3) ||
          (identityCheck.explicitConflict && attempt >= 5)
        ) {
          break;
        }
      }

      if (!matchesDrawer) {
        const contentShotPath = LmsHelpers.getDebugScreenshotPath("debug_drawer_content.png");
        await page
          .screenshot({ path: contentShotPath })
          .catch(() => {});
        if (apiIdentity.apiError && !apiTimedOut) {
          throw new Error(
            `[LmsHelpers Error] Máy chủ MindX LMS trả về lỗi API (${apiIdentity.apiErrorDetail || "HTTP/GraphQL error"}) khi xác minh lớp '${targetCode}'. Đã chặn thao tác để bảo vệ dữ liệu. (Ảnh: ${contentShotPath}).`
          );
        }
        if (apiTimedOut || drawerText.trim() === "Update Classes") {
          throw new Error(
            `[LmsHelpers Error] Máy chủ MindX LMS (lms-api.mindx.edu.vn) đang bị nghẽn hoặc mất kết nối mạng (${apiIdentity.apiErrorDetail || "ERR_CONNECTION_TIMED_OUT"}) khi tải dữ liệu lớp '${targetCode}' nên màn hình LMS bị treo ở vòng xoay tải. Vui lòng kiểm tra lại kết nối mạng (Wi-Fi/4G IPv4) hoặc thử lại sau ít phút.`
          );
        }
        throw new Error(
          `[LmsHelpers Error] Đã mở Drawer nhưng nội dung trong Drawer không khớp mã lớp '${targetCode}'. Đã chặn thao tác để tránh nhầm lớp. (Ảnh: ${contentShotPath}).`
        );
      }

      await LmsHelpers.markVerifiedDrawerOnPage(page, targetCode, knownClassIdForTarget);
    } finally {
      cleanupListeners();
    }
  }

  /**
   * Switches to a specific tab inside the open class Drawer.
   */
  public static async switchDrawerTab(
    page: Page,
    tabSelector: string
  ): Promise<void> {
    const interceptor = createNetworkInterceptor(page);
    await interceptor.dismissForbiddenToast();

    const TAB_ALIAS_MAP: Record<string, string> = {
      comments: SELECTORS.tabs.comments,
      comment: SELECTORS.tabs.comments,
      nhậnxét: SELECTORS.tabs.comments,
      students: SELECTORS.tabs.students,
      student: SELECTORS.tabs.students,
      họcviên: SELECTORS.tabs.students,
      grading: SELECTORS.tabs.grading,
      submission: SELECTORS.tabs.grading,
      chấmbài: SELECTORS.tabs.grading,
      homework: SELECTORS.tabs.homework,
      bàitậpvềnhà: SELECTORS.tabs.homework,
      attendance: SELECTORS.tabs.attendance,
      điểmdanh: SELECTORS.tabs.attendance,
      schedule: SELECTORS.tabs.schedule,
      lịchhọc: SELECTORS.tabs.schedule,
      general: SELECTORS.tabs.general,
      generalinfo: SELECTORS.tabs.general,
      thôngtinchung: SELECTORS.tabs.general,
      spck: SELECTORS.tabs.spck,
    };
    const normalizedTabKey = String(tabSelector || "").replace(/\s+/g, "").toLowerCase();
    const resolvedTabSelector = TAB_ALIAS_MAP[normalizedTabKey] || tabSelector;

    // Try finding tab inside the drawer first
    const drawer = page.locator('div[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight').first();
    const isDrawerOpen = await drawer.isVisible().catch(() => false);
    const context = isDrawerOpen ? drawer : page;

    let tab = context.locator(resolvedTabSelector).first();
    let isVisible = await tab.isVisible().catch(() => false);

    if (!isVisible) {
      tab = page.locator(resolvedTabSelector).first();
      isVisible = await tab.isVisible().catch(() => false);
    }

    if (!isVisible) {
      // If tab is overflowed, click the next arrow button or scroll into view
      const nextArrow = context.locator(SELECTORS.tabs.nextTabArrow).last();
      if (await nextArrow.isVisible().catch(() => false)) {
        await nextArrow.click({ force: true }).catch(() => {});
        await page.waitForTimeout(300);
        await nextArrow.click({ force: true }).catch(() => {});
        await page.waitForTimeout(300);
      }
    }

    await tab.scrollIntoViewIfNeeded().catch(() => {});
    await tab.waitFor({ state: "attached", timeout: 10000 });
    await tab.click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);

    // Ensure the MUI tab actually became selected (in case horizontal scroll button overlapped the click coordinate)
    const isSelected = await tab.getAttribute("aria-selected").catch(() => null);
    if (isSelected === "false") {
      await tab
        .evaluate((el: HTMLElement) => {
          el.scrollIntoView({ inline: "center", block: "nearest" });
          el.click();
        })
        .catch(() => {});
      await page.waitForTimeout(400);
    }

    await page.waitForTimeout(700);
  }

  /**
   * Sets table pagination to 100 rows per page if available,
   * then iterates through every page and executes rowCallback on each row.
   */
  public static async iterateAllPages(
    page: Page,
    rowCallback: (row: Locator, index: number) => Promise<void>
  ): Promise<number> {
    const interceptor = createNetworkInterceptor(page);
    let totalProcessed = 0;

    // Try setting page size to 100
    const pageSizeSelect = page.locator(SELECTORS.students.pageSizeSelect).first();
    if (await pageSizeSelect.isVisible().catch(() => false)) {
      try {
        await pageSizeSelect.click();
        await page.waitForTimeout(300);
        const option100 = page.locator('.ant-select-item-option-content:has-text("100"), option[value="100"]').first();
        if (await option100.isVisible().catch(() => false)) {
          await option100.click();
          await page.waitForTimeout(1000);
        }
      } catch {
        // Fallback to default pagination
      }
    }

    let hasNextPage = true;
    while (hasNextPage) {
      await interceptor.dismissForbiddenToast();
      const rows = page.locator(SELECTORS.students.tableRows);
      const rowCount = await rows.count();

      for (let i = 0; i < rowCount; i++) {
        const row = rows.nth(i);
        await rowCallback(row, totalProcessed);
        totalProcessed++;
      }

      // Check if there is a next page
      const nextBtn = page.locator(SELECTORS.students.paginationNext).first();
      const isNextAvailable = await nextBtn.isVisible().catch(() => false);

      if (isNextAvailable) {
        const isDisabled = await nextBtn.getAttribute("aria-disabled");
        if (isDisabled === "true") {
          hasNextPage = false;
        } else {
          await nextBtn.click();
          await page.waitForTimeout(1200);
        }
      } else {
        hasNextPage = false;
      }
    }

    return totalProcessed;
  }

  /**
   * Closes the active drawer.
   */
  public static async closeDrawer(page: Page): Promise<void> {
    const closeBtn = page.locator(SELECTORS.classes.closeDrawerButton).first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
      await page.waitForTimeout(500);
    }
  }

  /**
   * Self-Healing UI Helper 1: Ensures no stale modal dialog (`[role="dialog"]`) or `.Forbidden` toast
   * is blocking the screen before interacting with the student table.
   * IMPORTANT: Only presses `Escape` when a `[role="dialog"]` is actually visible, because pressing
   * `Escape` without an open modal closes the entire Class Drawer on MindX LMS.
   */
  public static async ensureCleanDialogAndToast(
    page: Page,
    interceptor?: { dismissForbiddenToast?: () => Promise<unknown> }
  ): Promise<void> {
    if (interceptor && typeof interceptor.dismissForbiddenToast === "function") {
      await interceptor.dismissForbiddenToast().catch(() => {});
    }
    const visibleDialogs = page.locator('[role="dialog"]:visible');
    const countVisibleDialogs = async (): Promise<number> =>
      typeof (visibleDialogs as any).count === "function"
        ? await (visibleDialogs as any).count().catch(() => 0)
        : 0;
    const initialVisibleCount = await countVisibleDialogs();
    if (initialVisibleCount > 0) {
      await page.keyboard?.press?.("Escape").catch(() => {});
      await page.waitForTimeout(250);
      if ((await countVisibleDialogs()) > 0) {
        const currentDialog = visibleDialogs.first();
        // Strictly scope backdrop lookup to the dialog's own .MuiDialog-root ancestor so we NEVER click .MuiDrawer-root's backdrop
        const dialogBackdrop = currentDialog
          .locator(
            'xpath=ancestor::*[contains(@class,"MuiDialog-root") and not(contains(@class,"MuiDrawer-root"))][1]//*[contains(@class,"MuiBackdrop-root")]'
          )
          .first();
        if (await dialogBackdrop.isVisible().catch(() => false)) {
          await dialogBackdrop.click({ force: true, position: { x: 10, y: 10 } }).catch(() => {});
          await page.waitForTimeout(250);
        } else {
          const closeBtn = currentDialog
            .locator('button[aria-label*="close" i], button[title*="close" i]')
            .first();
          if (await closeBtn.isVisible().catch(() => false)) {
            await closeBtn.click({ force: true }).catch(() => {});
            await page.waitForTimeout(250);
          }
        }
      }
      if ((await countVisibleDialogs()) > 0) {
        throw new Error(
          "Không thể đóng hộp thoại ([role='dialog']) đang bị kẹt trên LMS sau khi bấm Escape và backdrop. Đã dừng thao tác để tránh ghi nhầm dữ liệu!"
        );
      }
    }
  }

  /**
   * Self-Healing UI Helper 2: Ensures the Class Drawer, Comments tab (`#tab-10`), and target
   * session slot (`#class-comments-slot-carousel-{slotIndex}`) are `.active` and the student table
   * is visible.
   *
   * CRITICAL:
   * 1. Never clicks the slot when it is ALREADY `.active`, because clicking an active slot
   *    on MindX LMS toggles it back to `.inactive` and hides the student table!
   * 2. Throws an explicit error if the target slot cannot be confirmed `.active` or if the
   *    student table fails to become visible, preventing cross-session writes into another slot.
   */
  public static async ensureCommentsSlotReady(
    page: Page,
    classCode: string,
    slotNumber: number,
    options?: { reopenDrawerIfClosed?: boolean; waitForTableMs?: number }
  ): Promise<{ drawer: Locator; slotItem: Locator; isSlotActive: boolean }> {
    const slotIndex = Math.max(0, slotNumber - 1);
    const drawer = page
      .locator('div[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight')
      .first();

    if (options?.reopenDrawerIfClosed) {
      const isDrawerVisible = await drawer.isVisible().catch(() => true);
      if (!isDrawerVisible) {
        await LmsHelpers.openClassDrawer(page, classCode);
        await LmsHelpers.switchDrawerTab(page, SELECTORS.tabs.comments);
        await page.waitForTimeout(800);
      } else {
        const commentsTab = drawer.locator(SELECTORS.tabs.comments).first();
        if (await commentsTab.isVisible().catch(() => false)) {
          const selected = await commentsTab.getAttribute("aria-selected").catch(() => "true");
          if (selected === "false") {
            await LmsHelpers.switchDrawerTab(page, SELECTORS.tabs.comments);
            await page.waitForTimeout(800);
          }
        }
      }
    }

    const slotItem = drawer
      .locator(`[id="class-comments-slot-carousel-${slotIndex}"]`)
      .first();

    let slotCount =
      typeof (slotItem as any).count === "function"
        ? await (slotItem as any).count().catch(() => 0)
        : 1;
    const waitForTableMs = options?.waitForTableMs ?? 3000;
    if (
      slotCount === 0 &&
      options?.reopenDrawerIfClosed &&
      waitForTableMs >= 1500 &&
      typeof (slotItem as any).waitFor === "function"
    ) {
      await slotItem
        .waitFor({ state: "attached", timeout: Math.min(waitForTableMs, 6000) })
        .catch(() => {});
      slotCount =
        typeof (slotItem as any).count === "function"
          ? await (slotItem as any).count().catch(() => 0)
          : 1;
    }
    if (slotCount === 0) {
      throw new Error(
        `Không tìm thấy ô Buổi học số ${slotNumber} (#class-comments-slot-carousel-${slotIndex}) của lớp ${classCode} trên LMS.`
      );
    }

    const slotClassAttr = (await slotItem.getAttribute("class").catch(() => "")) || "";
    if (slotClassAttr.includes("disabled")) {
      throw new Error(
        `Buổi học số ${slotNumber} (#${slotNumber}) của lớp ${classCode} đang bị khóa (disabled) trên LMS.`
      );
    }

    let isSlotActive = await slotItem
      .evaluate((el) => el.classList.contains("active"))
      .catch(() => false);

    if (!isSlotActive) {
      const infoContainer = slotItem.locator(".info-container").first();
      for (let attempt = 1; attempt <= 3 && !isSlotActive; attempt++) {
        await slotItem.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(200);
        if (await infoContainer.isVisible().catch(() => false)) {
          await infoContainer.click({ force: true }).catch(() => {});
        } else {
          await slotItem.click({ force: true }).catch(() => {});
        }
        await page.waitForTimeout(1000);
        isSlotActive = await slotItem
          .evaluate((el) => el.classList.contains("active"))
          .catch(() => false);
      }
    }

    if (!isSlotActive) {
      throw new Error(
        `Không thể kích hoạt Buổi học số ${slotNumber} (#class-comments-slot-carousel-${slotIndex}) sang trạng thái .active trên LMS. Đã dừng thao tác để tránh ghi nhầm sang buổi học khác!`
      );
    }

    const waitMs = options?.waitForTableMs ?? 6000;
    if (waitMs > 0) {
      const studentTable = drawer.locator(".comment-list-table table, table").first();
      await studentTable.waitFor({ state: "visible", timeout: waitMs });
    }

    return { drawer, slotItem, isSlotActive };
  }
}
