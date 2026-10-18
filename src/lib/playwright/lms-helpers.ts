import type { Page, Locator } from "playwright";
import { SELECTORS } from "./selectors";
import { createNetworkInterceptor } from "./network-interceptor";

export class LmsHelpers {
  /**
   * Opens the slide-over drawer for a specific class code or classId.
   */
  public static async openClassDrawer(page: Page, classCode: string): Promise<void> {
    const interceptor = createNetworkInterceptor(page);
    await interceptor.dismissForbiddenToast();

    // 1. If search input exists, filter by class code first
    const searchInput = page.locator(SELECTORS.classes.searchInput).first();
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill(classCode);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1000);
    }

    // 2. Click the exact matching class row (strictly prevents partial match e.g. PTA1 vs PTA13)
    const targetCode = classCode.trim();
    const rows = page.locator("table tbody tr, .class-card");
    const count = await rows.count().catch(() => 0);
    let matchedRow: Locator | null = null;

    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const text = await row.innerText().catch(() => "");
      const tokens = text.split(/[\s,()]+/).map((t) => t.trim().toUpperCase());
      if (tokens.includes(targetCode.toUpperCase())) {
        matchedRow = row;
        break;
      }
    }

    if (!matchedRow) {
      // Fallback with regex boundary filter
      const regexPattern = new RegExp(`(^|[^a-zA-Z0-9_-])${targetCode}([^a-zA-Z0-9_-]|$)`, "i");
      matchedRow = page.locator("table tbody tr, .class-card").filter({ hasText: regexPattern }).first();
    }

    await matchedRow.waitFor({ state: "visible", timeout: 15000 });
    await interceptor.dismissForbiddenToast();
    await matchedRow.click();

    // 3. Wait for the Drawer to appear
    const drawer = page.locator(SELECTORS.classes.drawer).first();
    await drawer.waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(500);
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

    const tab = page.locator(tabSelector).first();
    const isVisible = await tab.isVisible().catch(() => false);

    if (!isVisible) {
      // If tab is overflowed, click the next arrow button
      const nextArrow = page.locator(SELECTORS.tabs.nextTabArrow).first();
      if (await nextArrow.isVisible().catch(() => false)) {
        await nextArrow.click();
        await page.waitForTimeout(300);
      }
    }

    await tab.waitFor({ state: "visible", timeout: 10000 });
    await tab.click();
    await page.waitForTimeout(800);
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
}
