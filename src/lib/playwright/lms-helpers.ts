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

    // 1. Check if page is stuck at Login screen
    const isPwdVisible = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
    if (isPwdVisible) {
      throw new Error(
        "[LMS Error] Trình duyệt đang ở màn hình Đăng nhập LMS. Phiên đăng nhập chưa hoàn tất hoặc tài khoản chưa hợp lệ. Vui lòng đăng nhập trên trình duyệt một lần để lưu phiên."
      );
    }

    // 2. Ensure we are on the class list page (click "Lớp học" menu if needed)
    const hasTableOrCard = await page
      .locator("table, .class-card, [data-testid='class-row'], input[placeholder*='Tìm kiếm' i]")
      .first()
      .isVisible()
      .catch(() => false);

    if (!hasTableOrCard) {
      const classMenu = page
        .locator('a:has-text("Lớp học"), .ant-menu-item:has-text("Lớp học"), [aria-label*="Lớp học"], a[href*="class"]')
        .first();
      if (await classMenu.isVisible().catch(() => false)) {
        await classMenu.click();
        await page.waitForTimeout(2000);
      }
    }

    // 3. If search input exists, filter by class code
    const searchInput = page.locator(SELECTORS.classes.searchInput).first();
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.click().catch(() => {});
      await searchInput.fill(classCode);
      await page.keyboard.press("Enter");
      const searchBtn = page.locator(".ant-input-search-button, button:has(.anticon-search)").first();
      if (await searchBtn.isVisible().catch(() => false)) {
        await searchBtn.click().catch(() => {});
      }
      await page.waitForTimeout(1500);
    }

    // 4. Click the matching class row
    const targetCode = classCode.trim();
    const regexPattern = new RegExp(`(^|[^a-zA-Z0-9_-])${targetCode}([^a-zA-Z0-9_-]|$)`, "i");
    let matchedRow = page.locator("table tbody tr, .class-card, .class-item").filter({ hasText: regexPattern }).first();

    const isVisibleDirect = await matchedRow.waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);

    if (!isVisibleDirect) {
      // Fallback: check tab "Đang học" or "Tất cả" if present
      const runningTab = page.locator('button:has-text("Đang học"), [role="tab"]:has-text("Đang học"), a:has-text("Đang học")').first();
      if (await runningTab.isVisible().catch(() => false)) {
        await runningTab.click().catch(() => {});
        await page.waitForTimeout(1500);
      }

      // Try substring match as fallback
      matchedRow = page.locator("table tbody tr, .class-card, .class-item").filter({ hasText: new RegExp(targetCode, "i") }).first();
      await matchedRow.waitFor({ state: "visible", timeout: 10000 }).catch(async (err) => {
        // Take diagnostic screenshot before throwing
        await page.screenshot({ path: "data/debug_class_not_found.png" }).catch(() => {});
        throw new Error(
          `[LmsHelpers Error] Không tìm thấy lớp '${targetCode}' trên danh sách lớp LMS. Vui lòng kiểm tra lại mã lớp hoặc bộ lọc 'Đang học' trên LMS. (Ảnh chẩn đoán lưu tại data/debug_class_not_found.png)`
        );
      });
    }

    await interceptor.dismissForbiddenToast();
    await matchedRow.click();

    // 5. Wait for the Drawer to appear and Read-after-Write verify it belongs to the target class
    const drawer = page.locator(SELECTORS.classes.drawer).first();
    await drawer.waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(500);

    const drawerText = await drawer.innerText().catch(() => "");
    if (!regexPattern.test(drawerText) && !drawerText.toUpperCase().includes(targetCode.toUpperCase())) {
      throw new Error(
        `[LmsHelpers Error] Đã mở Drawer nhưng nội dung Drawer không khớp mã lớp '${targetCode}'. Thao tác bị hủy để tránh nhầm lớp!`
      );
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
