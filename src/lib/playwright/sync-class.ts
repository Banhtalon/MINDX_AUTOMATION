import type { Page, Locator } from "playwright";
import { BrowserManager } from "./browser-manager";
import { authService } from "./auth";
import { LmsHelpers } from "./lms-helpers";
import { SELECTORS } from "./selectors";
import { createNetworkInterceptor } from "./network-interceptor";
import {
  classSessionRepo,
  studentRepo,
  jobLogRepo,
  getDb,
  type ClassSessionRecord,
  type StudentRecord,
} from "../db/sqlite";
import {
  getCoursesSyllabus,
  getRunningClasses,
  saveRunningClasses,
  type RunningClassItem,
} from "../db/json-config";
import { config } from "../config";

export interface SyncClassResult {
  success: boolean;
  classId: string;
  classCode: string;
  courseName?: string;
  sessionsCount: number;
  studentsCount: number;
  activeStudentsCount: number;
  latestActiveSessionId?: string;
  sessions: ClassSessionRecord[];
  students: StudentRecord[];
  error?: string;
}

export class ClassSyncer {
  /**
   * Synchronizes class details, schedule/sessions, and student roster from LMS into SQLite.
   * Locked strictly by classCode / classId (normalized to UPPERCASE).
   */
  public static async syncClass(rawClassCode: string): Promise<SyncClassResult> {
    const classCode = rawClassCode.trim().toUpperCase();
    const jobId = `sync_${classCode}_${Date.now()}`;
    jobLogRepo.add({
      jobId,
      jobType: "SYNC_CLASS",
      level: "INFO",
      message: `Bắt đầu đồng bộ dữ liệu lớp ${classCode} từ LMS...`,
    });

    const browserManager = BrowserManager.getInstance();
    const page =
      typeof browserManager.getPage === "function"
        ? await browserManager.getPage()
        : (await browserManager.getContext()).pages()[0] ||
          (await (await browserManager.getContext()).newPage());
    const interceptor = createNetworkInterceptor(page);

    try {
      // 1. Ensure authenticated on MindX LMS
      await authService.ensureAuthenticated("LMS");

      // 2. Navigate to LMS Classes page if not already there
      const currentUrl = typeof page.url === "function" ? page.url() : "";
      if (
        currentUrl &&
        (currentUrl.includes("/dashboard") ||
          (!currentUrl.includes("/class") && !currentUrl.includes("/classes")))
      ) {
        jobLogRepo.add({
          jobId,
          jobType: "SYNC_CLASS",
          level: "INFO",
          message: `Điều hướng tới danh sách lớp học LMS...`,
        });
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
          await page.goto(`${config.lmsUrl.replace(/\/+$/, "")}/admin/classes`, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          }).catch(() => {});
          await page.waitForTimeout(1500);
        }
      }

      await interceptor.dismissForbiddenToast();

      // 3. Open the drawer for target class
      jobLogRepo.add({
        jobId,
        jobType: "SYNC_CLASS",
        level: "INFO",
        message: `Đang tìm và mở Drawer chi tiết của lớp ${classCode}...`,
      });
      await LmsHelpers.openClassDrawer(page, classCode);

      // Strictly lock classId to normalized uppercase classCode
      const classId = classCode;

      // 4. Scrape Sessions & Active Slot from "Nhận xét / Comments" tab (#tab-10)
      jobLogRepo.add({
        jobId,
        jobType: "SYNC_CLASS",
        classId,
        level: "INFO",
        message: `Đang quét danh sách buổi học (Slots) từ tab Comments cho lớp ${classCode}...`,
      });
      await LmsHelpers.switchDrawerTab(page, SELECTORS.tabs.comments);
      await page.waitForTimeout(1200);
      await interceptor.dismissForbiddenToast();

      const { sessions, latestActiveSessionId } = await this.scrapeSessions(page, classId, classCode);

      // 5. Scrape Students from "Học viên" tab
      jobLogRepo.add({
        jobId,
        jobType: "SYNC_CLASS",
        classId,
        level: "INFO",
        message: `Đang quét tab Học viên (Students) cho lớp ${classCode}...`,
      });
      await LmsHelpers.switchDrawerTab(page, SELECTORS.tabs.students);
      await page.waitForTimeout(1000);
      await interceptor.dismissForbiddenToast();

      const students = await this.scrapeStudents(page, classId);

      // Strict Completeness Guardrail: Abort if sessions or students are empty to protect existing SQLite records
      if (sessions.length === 0 || students.length === 0) {
        await page.screenshot({ path: "data/debug_sync_empty.png" }).catch(() => {});
        throw new Error(
          `Dữ liệu đồng bộ lớp ${classCode} chưa tải đủ (${sessions.length} buổi học, ${students.length} học viên) do máy chủ LMS phản hồi chậm hoặc mất kết nối. Đã hủy cập nhật để bảo vệ dữ liệu hiện có trong SQLite.`
        );
      }

      // 6. Save all verified scraped records to SQLite atomically without deleting historical feedbacks
      const db = getDb();
      const saveTransaction = () => {
        for (const s of sessions) {
          classSessionRepo.upsert(s);
        }
        if (typeof (db as any)?.prepare === "function") {
          const validIds = new Set(students.map((st) => st.studentId));
          const existing = studentRepo.findByClass(classId, false) || [];
          const delStmt = (db as any).prepare(
            "DELETE FROM students WHERE classId = ? AND studentId = ?"
          );
          for (const ex of existing) {
            if (!validIds.has(ex.studentId) && /^STU_.*_\d+$/.test(ex.studentId)) {
              delStmt.run(classId, ex.studentId);
            }
          }
        }
        for (const st of students) {
          studentRepo.upsert(st);
        }
      };

      if (typeof (db as any).transaction === "function") {
        (db as any).transaction(saveTransaction)();
      } else {
        saveTransaction();
      }

      const activeStudentsCount = students.filter((s) => s.isActive).length;

      jobLogRepo.add({
        jobId,
        jobType: "SYNC_CLASS",
        classId,
        level: "SUCCESS",
        message: `Đồng bộ thành công lớp ${classCode}: ${sessions.length} buổi học (Buổi hiện tại: ${latestActiveSessionId || "N/A"}), ${students.length} học viên (${activeStudentsCount} đang hoạt động).`,
      });

      return {
        success: true,
        classId,
        classCode,
        sessionsCount: sessions.length,
        studentsCount: students.length,
        activeStudentsCount,
        latestActiveSessionId,
        sessions,
        students,
      };
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      jobLogRepo.add({
        jobId,
        jobType: "SYNC_CLASS",
        level: "ERROR",
        message: `Lỗi đồng bộ lớp ${classCode}: ${errMsg}`,
      });
      return {
        success: false,
        classId: classCode,
        classCode,
        sessionsCount: 0,
        studentsCount: 0,
        activeStudentsCount: 0,
        sessions: [],
        students: [],
        error: errMsg,
      };
    }
  }

  /**
   * Scrapes session list and dates from the Comments tab slot carousel (#class-comments-slot-carousel-0..13)
   * and enriches topics with courses_syllabus.json.
   */
  private static async scrapeSessions(
    page: Page,
    classId: string,
    classCode: string
  ): Promise<{ sessions: ClassSessionRecord[]; latestActiveSessionId: string }> {
    const sessions: ClassSessionRecord[] = [];
    const drawer = page.locator('div[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight').first();
    const isDrawerOpen = await drawer.isVisible().catch(() => false);
    const context = isDrawerOpen ? drawer : page;

    // Match course syllabus by code in classCode
    const syllabusList = typeof getCoursesSyllabus === "function" ? getCoursesSyllabus() : [];
    const matchedCourse = syllabusList.find((c) => classCode.toUpperCase().includes(c.courseCode));

    const slotItems = context.locator('[id^="class-comments-slot-carousel-"]');
    let slotCount = await slotItems.count().catch(() => 0);

    if (slotCount === 0) {
      for (let waitAttempt = 0; waitAttempt < 40; waitAttempt++) {
        await page.waitForTimeout(500);
        slotCount = await slotItems.count().catch(() => 0);
        if (slotCount > 0) break;
        if (waitAttempt === 10 || waitAttempt === 24) {
          const commentsTab = context.locator(SELECTORS.tabs.comments).first();
          if (await commentsTab.isVisible().catch(() => false)) {
            await commentsTab
              .evaluate((el: HTMLElement) => {
                el.scrollIntoView({ inline: "center", block: "nearest" });
                el.click();
              })
              .catch(() => {});
          }
        }
      }
    }

    if (slotCount === 0 && typeof (page as any).screenshot === "function") {
      await page.screenshot({ path: "data/debug_comments_tab.png" }).catch(() => {});
    }

    let latestActiveSessionId = `${classId}_SESS_01`;
    let latestActiveSlotIndex = 0;

    const parseSlotDate = (text: string): string => {
      const dateMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
      if (!dateMatch) return "";
      const day = dateMatch[1].padStart(2, "0");
      const month = dateMatch[2].padStart(2, "0");
      const year = dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3];
      return `${day}/${month}/${year}`;
    };

    if (slotCount > 0) {
      for (let i = 0; i < slotCount; i++) {
        const slot = slotItems.nth(i);
        const idAttr = (await slot.getAttribute("id").catch(() => "")) || "";
        const idxMatch = idAttr.match(/(\d+)$/);
        const sessionNumber = idxMatch ? parseInt(idxMatch[1], 10) + 1 : i + 1;
        const sessionId = `${classId}_SESS_${String(sessionNumber).padStart(2, "0")}`;

        const classAttr = (await slot.getAttribute("class").catch(() => "")) || "";
        const isDisabled = classAttr.includes("disabled");

        const text = await slot.innerText().catch(() => "");
        const sessionDate = parseSlotDate(text);

        if (!isDisabled) {
          latestActiveSessionId = sessionId;
          latestActiveSlotIndex = i;
        }

        const syllabusSession = matchedCourse?.sessions.find((s) => s.sessionNumber === sessionNumber);
        const topic = syllabusSession?.topic || `Buổi ${sessionNumber}: Bài học theo giáo trình ${classCode}`;

        sessions.push({
          classId,
          className: classCode,
          sessionId,
          sessionNumber,
          topic,
          date: sessionDate,
        });
      }

      // MindX LMS only renders the date text inside the currently .active slot in the carousel.
      // Click the latest non-disabled slot so LMS activates it and renders its exact date (e.g. Buổi 10 - 18/10/2026).
      if (latestActiveSlotIndex >= 0 && latestActiveSlotIndex < sessions.length) {
        const latestSlot = slotItems.nth(latestActiveSlotIndex);
        await latestSlot.scrollIntoViewIfNeeded().catch(() => {});
        const infoContainer = latestSlot.locator(".info-container").first();
        if (await infoContainer.isVisible().catch(() => false)) {
          await infoContainer.click({ force: true }).catch(() => {});
        } else {
          await latestSlot.click({ force: true }).catch(() => {});
        }
        await page.waitForTimeout(800);

        const activeText = await latestSlot.innerText().catch(() => "");
        const activeDate = parseSlotDate(activeText);
        if (activeDate) {
          sessions[latestActiveSlotIndex].date = activeDate;
        }
      }

      return { sessions, latestActiveSessionId };
    }

    // Do not invent fake 14 sessions when LMS slots failed to load
    return { sessions: [], latestActiveSessionId: "" };
  }

  /**
   * Scrapes students list from Students tab with pagination support.
   */
  private static async scrapeStudents(page: Page, classId: string): Promise<StudentRecord[]> {
    const studentsMap = new Map<string, StudentRecord>();
    const interceptor = createNetworkInterceptor(page);

    const drawer = page.locator('div[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight').first();
    const isDrawerOpen = await drawer.isVisible().catch(() => false);
    const context = isDrawerOpen ? drawer : page;

    // Try setting page size to 100 if size changer exists
    const sizeChanger = context.locator(SELECTORS.students.pageSizeSelect).first();
    if (await sizeChanger.isVisible().catch(() => false)) {
      await sizeChanger.click().catch(() => {});
      const option100 = page.locator(".ant-select-item-option:has-text('100'), .MuiMenuItem-root:has-text('100'), option[value='100']").first();
      if (await option100.isVisible().catch(() => false)) {
        await option100.click().catch(() => {});
        await page.waitForTimeout(1000);
      }
    }

    let hasNextPage = true;
    let pageNum = 1;
    let globalRowIndex = 0;
    const maxPages = 50;

    while (hasNextPage && pageNum <= maxPages) {
      await interceptor.dismissForbiddenToast();
      const rows = context.locator("table tbody tr");
      let count = await rows.count().catch(() => 0);

      if (count === 0 && pageNum === 1) {
        for (let waitAttempt = 0; waitAttempt < 30; waitAttempt++) {
          await page.waitForTimeout(500);
          count = await rows.count().catch(() => 0);
          if (count > 0) break;
        }
      }

      for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        const text = await row.innerText().catch(() => "");
        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

        if (lines.length === 0) continue;

        globalRowIndex++;

        // Extract student name (typically the prominent column)
        const fullName = lines[0] || `Học viên ${globalRowIndex}`;

        // Extract student ID from data attributes, links, or monotonic globalRowIndex
        let studentId =
          (await row.getAttribute("data-student-id").catch(() => null)) ||
          (await row.getAttribute("data-id").catch(() => null));

        if (!studentId) {
          // Check link href (e.g. /students/12345) without hanging 30s if absent
          const link = row.locator("a[href*='student']").first();
          if ((await link.count().catch(() => 0)) > 0) {
            const href = await link.getAttribute("href", { timeout: 800 }).catch(() => null);
            const match = href?.match(/student[s]?\/([a-zA-Z0-9_-]+)/);
            if (match && match[1]) {
              studentId = match[1];
            }
          }
        }

        if (!studentId) {
          // Check if any secondary line contains an explicit LMS UID (24-hex ObjectId) or student code
          const codeLine = lines
            .slice(1)
            .find((l) => /^[a-f0-9]{24}$/i.test(l) || /^(?:HV|MX|STU)[-_]?[A-Z0-9]{3,}$/i.test(l));
          if (codeLine) {
            studentId = codeLine.trim();
          }
        }

        if (!studentId) {
          // Build deterministic identity from normalized student name (order-independent across sync runs)
          const normSlug = fullName
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[đĐ]/g, "d")
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "");
          if (!normSlug) {
            throw new Error(
              `Không thể xác định định danh cho dòng học viên thứ ${globalRowIndex} của lớp ${classId}.`
            );
          }
          studentId = `STU_${classId}_${normSlug}`;
          if (studentsMap.has(studentId)) {
            throw new Error(
              `Phát hiện học viên trùng tên '${fullName}' trong lớp ${classId} nhưng DOM thiếu mã studentId riêng biệt. Đã dừng đồng bộ để tránh gán nhầm ID.`
            );
          }
        }

        // Check if student is active (switch is green/checked or no disabled indicator)
        const switchChecked = await row
          .locator(".Mui-checked, .ant-switch-checked, [role='switch'][aria-checked='true'], input[type='checkbox']:checked")
          .first()
          .isVisible()
          .catch(() => false);

        const switchExists = await row
          .locator(".MuiSwitch-root, .ant-switch, [role='switch'], input[type='checkbox']")
          .first()
          .isVisible()
          .catch(() => false);

        const isActive = switchExists ? (switchChecked ? 1 : 0) : 1;

        if (!studentsMap.has(studentId)) {
          studentsMap.set(studentId, {
            studentId,
            classId,
            fullName,
            isActive,
          });
        }
      }

      // Check for next pagination button
      const nextBtn = context
        .locator(
          'button[aria-label*="next page" i], button[aria-label*="next" i], .MuiTablePagination-actions button:last-child, .ant-pagination-next:not(.ant-pagination-disabled)'
        )
        .first();

      const hasNext = (await nextBtn.count().catch(() => 0)) > 0;
      const isVisible = hasNext && (await nextBtn.isVisible().catch(() => false));
      const isEnabled = hasNext && (await nextBtn.isEnabled().catch(() => false));
      const isAriaDisabled = hasNext && ((await nextBtn.getAttribute("aria-disabled", { timeout: 400 }).catch(() => null)) === "true");
      const isMuiDisabled = hasNext && ((await nextBtn.getAttribute("class", { timeout: 400 }).catch(() => "")) || "").includes("Mui-disabled");

      if (isVisible && isEnabled && !isAriaDisabled && !isMuiDisabled) {
        await nextBtn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(800);
        pageNum++;
      } else {
        hasNextPage = false;
      }
    }

    if (hasNextPage) {
      throw new Error(`Phân trang danh sách học viên lớp ${classId} vượt quá giới hạn an toàn (${maxPages} trang), chưa tải hết danh sách.`);
    }

    return Array.from(studentsMap.values());
  }

  /**
   * Scrapes all classes with Status = "Running" (Đang học) from the MindX LMS Classes table
   * and caches them into data/running_classes.json for one-click selection.
   */
  public static async fetchRunningClasses(): Promise<{
    success: boolean;
    classes: RunningClassItem[];
    error?: string;
  }> {
    const jobId = `fetch_running_classes_${Date.now()}`;
    jobLogRepo.add({
      jobId,
      jobType: "SYNC_CLASS",
      level: "INFO",
      message: "Đang vào trang Danh sách Lớp học LMS để lấy các lớp đang học (Running)...",
    });

    const browserManager = BrowserManager.getInstance();
    const page =
      typeof browserManager.getPage === "function"
        ? await browserManager.getPage()
        : (await browserManager.getContext()).pages()[0] ||
          (await (await browserManager.getContext()).newPage());
    const interceptor = createNetworkInterceptor(page);

    try {
      await authService.ensureAuthenticated("LMS");

      // Close any open class drawer first so the full classes table is visible
      const existingDrawer = page
        .locator('div[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight')
        .first();
      if (await existingDrawer.isVisible().catch(() => false)) {
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
        await page.waitForTimeout(600);
      }

      // Navigate to LMS Classes page if not already there (e.g. when at /admin/dashboard "Coming soon")
      const isOnClassesTable = async () => {
        const url = page.url();
        if (url.includes("/dashboard")) return false;
        const hasSearchOrTable = await page
          .locator('input[placeholder*="Search classes" i], table tbody tr')
          .first()
          .isVisible()
          .catch(() => false);
        return hasSearchOrTable || url.includes("/class") || url.includes("/classes");
      };

      if (!(await isOnClassesTable())) {
        // On MindX LMS (/admin/dashboard), "Classes" in the left sidebar is an expandable menu:
        // Clicking "> Classes" once expands it to reveal the child "Classes" item underneath.
        const sidebarClassesItems = page.locator(
          '[data-testid="sidebar"] :text-is("Classes"), .MuiDrawer-docked :text-is("Classes"), aside :text-is("Classes"), nav :text-is("Classes"), :text-is("Classes"), :text-is("Lớp học")'
        );
        const initialCount = await sidebarClassesItems.count().catch(() => 0);
        if (initialCount > 0) {
          // If only 1 "Classes" is visible, click it first to expand the submenu
          if (initialCount === 1) {
            await sidebarClassesItems.first().click({ force: true }).catch(() => {});
            await page.waitForTimeout(700);
          }
          // After expanding, click the child "Classes" item (the second/last item in sidebar)
          const afterExpandCount = await sidebarClassesItems.count().catch(() => 0);
          if (afterExpandCount >= 2) {
            await sidebarClassesItems.nth(1).click({ force: true }).catch(() => {});
          } else {
            const directLink = page.locator('a[href*="class"], a:has-text("Classes")').first();
            if (await directLink.isVisible().catch(() => false)) {
              await directLink.click({ force: true }).catch(() => {});
            } else {
              await sidebarClassesItems.first().click({ force: true }).catch(() => {});
            }
          }
          await page.waitForTimeout(2000);
        }

        if (!(await isOnClassesTable())) {
          const baseLmsUrl = config.lmsUrl.replace(/\/+$/, "").replace(/\/(admin\/)?(classes|class|dashboard)$/i, "");
          for (const candidatePath of ["/admin/class", "/classes", "/admin/classes"]) {
            await page
              .goto(`${baseLmsUrl}${candidatePath}`, {
                waitUntil: "domcontentloaded",
                timeout: 20000,
              })
              .catch(() => {});
            await page.waitForTimeout(1500);
            if (await isOnClassesTable()) break;
          }
        }
      }

      await interceptor.dismissForbiddenToast();

      // Clear any previous class search filter so ALL classes are displayed
      const searchInput = page.locator(SELECTORS.classes.searchInput).first();
      if (await searchInput.isVisible().catch(() => false)) {
        const currentSearchVal = await searchInput.inputValue().catch(() => "");
        if (currentSearchVal && currentSearchVal.trim().length > 0) {
          const clearFilterBtn = page
            .locator('button:has-text("Clear"), .ant-input-clear-icon, [aria-label="close-circle"]')
            .first();
          if (await clearFilterBtn.isVisible().catch(() => false)) {
            await clearFilterBtn.click().catch(() => {});
          } else {
            await searchInput.click().catch(() => {});
            await searchInput.fill("");
            await page.keyboard.press("Enter");
          }
          await page.waitForTimeout(1500);
        }
      }

      // Wait for class table rows
      await page
        .locator("table tbody tr")
        .first()
        .waitFor({ state: "visible", timeout: 15000 })
        .catch(() => {});
      await page.waitForTimeout(800);

      const collectedMap = new Map<string, RunningClassItem>();
      const maxPages = 5;

      for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
        await interceptor.dismissForbiddenToast();

        const pageRows = await page.evaluate(() => {
          const results: Array<{
            classCode: string;
            courseName: string;
            center: string;
            status: string;
          }> = [];
          const trs = Array.from(document.querySelectorAll("table tbody tr"));
          for (const tr of trs) {
            if (tr.closest('[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight')) {
              continue;
            }
            const tds = Array.from(tr.querySelectorAll("td")).map((td) =>
              (td.innerText || td.textContent || "").replace(/\s+/g, " ").trim()
            );
            if (tds.length < 2) continue;

            // Check if any cell indicates Running / Đang học
            const hasRunning = tds.some((cell) => /^(running|đang học|đang diễn ra)$/i.test(cell));
            const hasFinished = tds.some((cell) =>
              /^(finished|đã kết thúc|closed|cancelled|đã hủy|completed)$/i.test(cell)
            );
            if (!hasRunning || hasFinished) continue;

            // Column 2 (index 1) is Name (e.g. VT-C4K-GI34), Column 3 (index 2) is Course, Column 4 (index 3) is Center
            let classCode = tds[1] || "";
            if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/i.test(classCode)) {
              const foundCode = tds.find((c) => /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/i.test(c));
              if (foundCode) classCode = foundCode;
            }
            classCode = classCode.trim().toUpperCase();
            if (!classCode) continue;

            const courseName = (tds[2] || "").trim();
            const center = (tds[3] || "").trim();

            results.push({
              classCode,
              courseName,
              center,
              status: "Running",
            });
          }
          return results;
        });

        let foundRunningOnThisPage = 0;
        const nowIso = new Date().toISOString();
        for (const item of pageRows) {
          if (!collectedMap.has(item.classCode)) {
            collectedMap.set(item.classCode, {
              ...item,
              updatedAt: nowIso,
            });
            foundRunningOnThisPage++;
          }
        }

        // Stop paginating if this page had Finished rows or no new Running rows
        const hasFinishedOnPage = await page
          .evaluate(() => {
            const trs = Array.from(document.querySelectorAll("table tbody tr"));
            return trs.some((tr) =>
              Array.from(tr.querySelectorAll("td")).some((td) =>
                /^(finished|đã kết thúc|closed|cancelled)$/i.test(
                  (td.innerText || td.textContent || "").trim()
                )
              )
            );
          })
          .catch(() => true);

        if (hasFinishedOnPage || foundRunningOnThisPage === 0) {
          break;
        }

        const nextBtn = page
          .locator(
            'button[aria-label*="next page" i], .MuiTablePagination-actions button:last-child, .ant-pagination-next:not(.ant-pagination-disabled)'
          )
          .first();
        const canGoNext =
          (await nextBtn.isVisible().catch(() => false)) &&
          (await nextBtn.isEnabled().catch(() => false)) &&
          (await nextBtn.getAttribute("aria-disabled").catch(() => null)) !== "true" &&
          !((await nextBtn.getAttribute("class").catch(() => "")) || "").includes("Mui-disabled");

        if (!canGoNext) break;
        await nextBtn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(1200);
      }

      const runningList = Array.from(collectedMap.values());
      if (runningList.length > 0) {
        saveRunningClasses(runningList);
      }

      const finalClasses = runningList.length > 0 ? runningList : getRunningClasses();

      jobLogRepo.add({
        jobId,
        jobType: "SYNC_CLASS",
        level: "SUCCESS",
        message: `Đã lấy thành công ${finalClasses.length} lớp đang học (Running) từ LMS: ${finalClasses
          .map((c) => c.classCode)
          .join(", ")}.`,
      });

      return {
        success: true,
        classes: finalClasses,
      };
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      jobLogRepo.add({
        jobId,
        jobType: "SYNC_CLASS",
        level: "ERROR",
        message: `Lỗi lấy danh sách lớp đang học từ LMS: ${errMsg}`,
      });
      return {
        success: false,
        classes: getRunningClasses(),
        error: errMsg,
      };
    }
  }
}
