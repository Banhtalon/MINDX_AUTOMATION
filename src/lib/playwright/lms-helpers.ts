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
    const targetCode = classCode.trim().toUpperCase();
    const escapedTargetCode = targetCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regexPattern = new RegExp(`(^|[^a-zA-Z0-9_-])${escapedTargetCode}([^a-zA-Z0-9_-]|$)`, "i");

    const existingDrawer = page
      .locator('div[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight')
      .first();
    if (await existingDrawer.isVisible().catch(() => false)) {
      const existingText = await existingDrawer.innerText().catch(() => "");
      const hasLoadedContent =
        (await existingDrawer
          .locator('[id^="class-comments-slot-carousel-"], table tbody tr')
          .count()
          .catch(() => 0)) > 0;
      if (regexPattern.test(existingText) && hasLoadedContent) {
        return; // Already open, has loaded content, and strictly matches target class boundary
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
      }
    }

    // 3. Ensure we are on the class list page (expand "> Classes" and click child "Classes" if on /admin/dashboard)
    const currentUrl = page.url();
    if (
      currentUrl.includes("/dashboard") ||
      (!currentUrl.includes("/class") && !currentUrl.includes("/classes"))
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
      if (!page.url().includes("/class") && !page.url().includes("/classes")) {
        await page
          .goto("https://lms.mindx.edu.vn/admin/classes", {
            waitUntil: "domcontentloaded",
            timeout: 25000,
          })
          .catch(() => {});
        await page.waitForTimeout(1500);
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

    if (!isVisibleDirect) {
      // If search input exists, filter by class code
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

      matchedRow = findMatchingClassRow();
      isVisibleDirect = await matchedRow
        .waitFor({ state: "visible", timeout: 8000 })
        .then(() => true)
        .catch(() => false);
    }

    if (!isVisibleDirect) {
      // Clear any stale filters (e.g. Session range 3 -> 5) and re-apply search
      const clearBtn = page.locator('button:has-text("Clear")').first();
      if (await clearBtn.isVisible().catch(() => false)) {
        await clearBtn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(1500);
        const searchInput = page.locator(SELECTORS.classes.searchInput).first();
        if (await searchInput.isVisible().catch(() => false)) {
          await searchInput.fill(classCode);
          await page.keyboard.press("Enter");
          await page.waitForTimeout(1500);
        }
      }

      // Fallback: check tab "Đang học" or "Tất cả" if present
      const runningTab = page
        .locator('button:has-text("Đang học"), [role="tab"]:has-text("Đang học"), a:has-text("Đang học")')
        .first();
      if (await runningTab.isVisible().catch(() => false)) {
        await runningTab.click().catch(() => {});
        await page.waitForTimeout(1500);
      }

      // Re-try with strict boundary regex only (never substring match)
      matchedRow = findMatchingClassRow();
      await matchedRow.waitFor({ state: "visible", timeout: 10000 }).catch(async () => {
        await page.screenshot({ path: "data/debug_class_not_found.png" }).catch(() => {});
        throw new Error(
          `[LmsHelpers Error] Không tìm thấy lớp '${targetCode}' trên danh sách lớp LMS. Vui lòng kiểm tra lại mã lớp hoặc bộ lọc 'Đang học' trên LMS. (Ảnh chẩn đoán lưu tại data/debug_class_not_found.png)`
        );
      });
    }

    await interceptor.dismissForbiddenToast();

    let apiTimedOut = false;
    const onFail = (req: any) => {
      try {
        const u = req.url();
        if (u.includes("lms-api") || u.includes("mindx.edu.vn")) {
          const errText = req.failure()?.errorText || "";
          if (errText.includes("TIMED_OUT") || errText.includes("DISCONNECTED") || errText.includes("RESET")) {
            apiTimedOut = true;
          }
        }
      } catch {}
    };
    if (typeof (page as any).on === "function") {
      (page as any).on("requestfailed", onFail);
    }

    // Click specifically on the class name link, pre, button, or 2nd column (Name column)
    const nameCellOrLink = matchedRow
      .locator('pre, a, button, [role="button"], span, td:nth-child(2)')
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

    // 6. Wait for the Drawer to appear and strictly verify its content belongs to targetCode
    const drawer = page.locator(SELECTORS.classes.drawer).first();

    try {
      await drawer.waitFor({ state: "visible", timeout: 15000 });
    } catch (err) {
      if (typeof (page as any).off === "function") {
        (page as any).off("requestfailed", onFail);
      }
      await page.screenshot({ path: "data/debug_drawer_timeout.png" }).catch(() => {});
      throw new Error(
        `[LmsHelpers Error] Timeout khi chờ Drawer chi tiết lớp '${targetCode}' xuất hiện sau khi click dòng lớp học. (Ảnh chụp màn hình: data/debug_drawer_timeout.png): ${err instanceof Error ? err.message : String(err)}`
      );
    }
    let drawerText = "";
    let matchesDrawer = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      await page.waitForTimeout(500);
      drawerText = await drawer.innerText().catch(() => "");
      if (regexPattern.test(drawerText)) {
        matchesDrawer = true;
        break;
      }
      if (apiTimedOut && attempt >= 10) {
        break;
      }
    }

    if (typeof (page as any).off === "function") {
      (page as any).off("requestfailed", onFail);
    }

    await page.screenshot({ path: "data/debug_drawer_content.png" }).catch(() => {});

    if (!matchesDrawer) {
      if (apiTimedOut || drawerText.trim() === "Update Classes") {
        throw new Error(
          `[LmsHelpers Error] Máy chủ MindX LMS (lms-api.mindx.edu.vn) đang bị nghẽn hoặc mất kết nối mạng (ERR_CONNECTION_TIMED_OUT) khi tải dữ liệu lớp '${targetCode}' nên màn hình LMS bị treo ở vòng xoay tải. Vui lòng kiểm tra lại kết nối mạng (Wi-Fi/4G IPv4) hoặc thử lại sau ít phút.`
        );
      }
      throw new Error(
        `[LmsHelpers Error] Đã mở Drawer nhưng nội dung trong Drawer không khớp mã lớp '${targetCode}'. Đã chặn thao tác để tránh nhầm lớp. (Ảnh: data/debug_drawer_content.png).`
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
}
