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

    // 2. Check if the target class drawer is ALREADY open
    const targetCode = classCode.trim();
    const regexPattern = new RegExp(`(^|[^a-zA-Z0-9_-])${targetCode}([^a-zA-Z0-9_-]|$)`, "i");

    const existingDrawer = page
      .locator('div[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight')
      .first();
    if (await existingDrawer.isVisible().catch(() => false)) {
      const existingText = await existingDrawer.innerText().catch(() => "");
      if (regexPattern.test(existingText) || existingText.toUpperCase().includes(targetCode.toUpperCase())) {
        return; // Already open and matches target class
      }
      // Close mismatched drawer
      await page.keyboard.press("Escape").catch(() => {});
      const closeBtn = page.locator(SELECTORS.classes.closeDrawerButton).first();
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click().catch(() => {});
      }
      await page.waitForTimeout(600);
    }

    // 3. Ensure we are on the class list page (click "Lớp học" menu or navigate)
    const currentUrl = page.url();
    if (!currentUrl.includes("/class") && !currentUrl.includes("/classes")) {
      const classMenu = page
        .locator('a[href*="class"], .ant-menu-item:has-text("Lớp học"), a:has-text("Lớp học"), span:has-text("Lớp học"), [aria-label*="Lớp học"]')
        .first();
      if (await classMenu.isVisible().catch(() => false)) {
        await classMenu.click();
        await page.waitForTimeout(2000);
      }
      if (!page.url().includes("/class") && !page.url().includes("/classes")) {
        await page.goto("https://lms.mindx.edu.vn/admin/classes", {
          waitUntil: "domcontentloaded",
          timeout: 25000,
        }).catch(() => {});
        await page.waitForTimeout(1500);
      }
    }

    // 4. If search input exists, filter by class code
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

    // 5. Click the matching class row
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
        await page.screenshot({ path: "data/debug_class_not_found.png" }).catch(() => {});
        throw new Error(
          `[LmsHelpers Error] Không tìm thấy lớp '${targetCode}' trên danh sách lớp LMS. Vui lòng kiểm tra lại mã lớp hoặc bộ lọc 'Đang học' trên LMS. (Ảnh chẩn đoán lưu tại data/debug_class_not_found.png)`
        );
      });
    }

    await interceptor.dismissForbiddenToast();

    // Click specifically on the class name link, button, or 2nd column (Name column)
    const nameCellOrLink = matchedRow
      .locator('a, button, [role="button"], span, td:nth-child(2)')
      .filter({ hasText: regexPattern })
      .first();

    if (await nameCellOrLink.isVisible().catch(() => false)) {
      await nameCellOrLink.click({ force: true }).catch(async () => {
        await matchedRow.locator("td:nth-child(2)").first().click({ force: true });
      });
    } else {
      const secondCell = matchedRow.locator("td:nth-child(2)").first();
      if (await secondCell.isVisible().catch(() => false)) {
        await secondCell.click({ force: true });
      } else {
        await matchedRow.click({ force: true });
      }
    }

    // 6. Wait for the Drawer or Tabs to appear and Read-after-Write verify it belongs to the target class
    const drawerOrTabLocator = page
      .locator(
        `${SELECTORS.classes.drawer}, [role="tab"]:has-text("Schedule"), [role="tab"]:has-text("Lịch học"), [role="tab"]:has-text("Class Sessions"), [role="tab"]:has-text("Information"), [role="tab"]:has-text("Thông tin chung")`
      )
      .first();

    try {
      await drawerOrTabLocator.waitFor({ state: "visible", timeout: 15000 });
    } catch (err) {
      await page.screenshot({ path: "data/debug_drawer_timeout.png" }).catch(() => {});
      throw new Error(
        `[LmsHelpers Error] Timeout khi chờ Drawer chi tiết lớp '${targetCode}' xuất hiện sau khi click dòng lớp học. (Ảnh chụp màn hình: data/debug_drawer_timeout.png): ${err instanceof Error ? err.message : String(err)}`
      );
    }
    await page.waitForTimeout(600);

    let drawer = page.locator(SELECTORS.classes.drawer).first();
    const isDrawerVisible = await drawer.isVisible().catch(() => false);
    const contextContainer = isDrawerVisible ? drawer : page.locator("body");

    await page.screenshot({ path: "data/debug_drawer_content.png" }).catch(() => {});
    const drawerText = await contextContainer.innerText().catch(() => "");

    // Also check page URL and full page text as fallback
    const pageUrl = page.url();
    const fullBodyText = await page.locator("body").innerText().catch(() => "");
    const matchesDrawer = regexPattern.test(drawerText) || drawerText.toUpperCase().includes(targetCode.toUpperCase());
    const matchesPage = pageUrl.toUpperCase().includes(targetCode.toUpperCase()) || fullBodyText.toUpperCase().includes(targetCode.toUpperCase());

    if (!matchesDrawer && !matchesPage) {
      throw new Error(
        `[LmsHelpers Error] Đã mở Drawer nhưng nội dung không khớp mã lớp '${targetCode}'. (Ảnh: data/debug_drawer_content.png).`
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

    // Try finding tab inside the drawer first
    const drawer = page.locator('div[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight').first();
    const isDrawerOpen = await drawer.isVisible().catch(() => false);
    const context = isDrawerOpen ? drawer : page;

    let tab = context.locator(tabSelector).first();
    let isVisible = await tab.isVisible().catch(() => false);

    if (!isVisible) {
      tab = page.locator(tabSelector).first();
      isVisible = await tab.isVisible().catch(() => false);
    }

    if (!isVisible) {
      // If tab is overflowed, click the next arrow button
      const nextArrow = context.locator(SELECTORS.tabs.nextTabArrow).first();
      if (await nextArrow.isVisible().catch(() => false)) {
        await nextArrow.click({ force: true }).catch(() => {});
        await page.waitForTimeout(300);
      }
    }

    await tab.waitFor({ state: "visible", timeout: 10000 });
    await tab.click({ force: true });
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
