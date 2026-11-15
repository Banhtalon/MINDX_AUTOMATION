/**
 * MINDX AUTOMATION BOT - v3.5.2 LMS CLASS DRAWER RECOVERY TEST SUITE
 * Kiểm định sửa lỗi "[LmsHelpers Error] Timeout khi chờ Drawer chi tiết lớp ... xuất hiện sau khi click dòng lớp học"
 * cùng toàn bộ các ranh giới F01–F05 sau kiểm định Codex CLI (v3.5.2):
 * - DR-01..DR-07: Center-scroll mép thanh cuộn, Stage B cell/row retry, Stage C Search, Stage D ID tự cô lập config/DB, fail-closed, mock compat, SpckUploader Slot 13.
 * - DR-08 (F01): Chặn tiêu đề/ID lớp khác dù nội dung phụ #drawer-body nhắc đúng mã lớp; chấp nhận layout MindX ("Update Classes" + Typography header); kiểm tra cả existingDrawer và GetClassById API.
 * - DR-09 (F02): Nhánh DOM fallback chỉ phát đúng 1 sự kiện click (không bấm đúp đóng lại Drawer toggle).
 * - DR-10 (F03): Bỏ qua nút chức năng ("Archive") đứng trước ô tên lớp ở mọi nhánh bấm.
 * - DR-11 (F04): Tham số URL cũ có tiền tố giống (AUDIT_DOM_130) hoặc tham số khác (returnTo=AUDIT_DOM_13) phải xóa bộ lọc sạch.
 * - DR-12: Phân biệt ranh giới VT-C4K-PTA1 vs VT-C4K-PTA13 và giữ nguyên nhánh legacy tab SPCK.
 * - DR-13..DR-17 (R2-F01..R2-F05): Chặn [data-class-code] trong body thắng title; chặn generic <p> trong header thắng <h4> xung đột;
 *   chờ in-flight GetClassById chậm tránh thoát sớm; chặn HTTP 500 & HTTP 200 GraphQL errors; cách ly đồng thời sai/đúng cả 2 thứ tự & operation Classes.
 *
 * Tự cô lập hoàn toàn trong os.tmpdir() (DB, Config, RunningClasses, Screenshots, Allowlist) — không phụ thuộc cấu hình gitignored bên ngoài.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-drawer-v352-"));
const tempDbPath = path.join(tempRoot, "test_drawer_v352.db");
const tempConfigDir = path.join(tempRoot, "config");
const tempShotDir = path.join(tempRoot, "shots");
fs.mkdirSync(tempConfigDir, { recursive: true });
fs.mkdirSync(tempShotDir, { recursive: true });

// Self-contained config files inside tempConfigDir (F05: zero dependency on gitignored workspace data/config)
fs.writeFileSync(
  path.join(tempConfigDir, "lms_class_ids.json"),
  JSON.stringify(
    {
      TEST_CFG_DR04A: "7e7381ebb20e9bcfaa5a63af",
      AUDIT_DEEP_13: "651111111111111111111113",
      AUDIT_DOM_13: "652222222222222222222213",
    },
    null,
    2
  ),
  "utf8"
);
fs.writeFileSync(path.join(tempConfigDir, "running_classes.json"), "[]", "utf8");

process.env.MINDX_DB_PATH = tempDbPath;
process.env.MINDX_CONFIG_DIR = tempConfigDir;
process.env.MINDX_DEBUG_SCREENSHOT_DIR = tempShotDir;
process.env.ALLOWED_LOCAL_DIRS = tempRoot;

type MockScenario =
  | "bottom-scrollbar-center-fix"
  | "cell-retry-needed"
  | "search-filter-only"
  | "deeplink-only-table-row"
  | "deeplink-only-missing-row"
  | "spck-stale-query-recovery"
  | "f01-a06-wrong-title-body-mention"
  | "f01-existing-drawer-body-mention"
  | "f01-typography-header-valid"
  | "f01-api-id-mismatch"
  | "f02-dom-toggle-once"
  | "f03-archive-button-guard"
  | "f04-prefix-and-returnto-query"
  | "prefix-boundary-pta1"
  | "legacy-spck-tab"
  | "unreachable-drawer";

function buildMockAdminClassesHtml(scenario: MockScenario, requestUrl: string): string {
  const parsed = new URL(requestUrl, "http://127.0.0.1");
  const queryId = (parsed.searchParams.get("id") || "").replace(/"/g, "").trim();
  const querySearch = (parsed.searchParams.get("search") || "").replace(/"/g, "").trim();
  const queryTab = parsed.searchParams.get("tab") || "0";

  let rows = [
    "VT-JSA15",
    "VT-C4K-PTI12",
    "VT-ROB-ARMI13",
    "VT-CSA04-HB",
    "VT-C4K-GI34",
    "VT-C4K-PTA13",
  ];
  if (scenario === "deeplink-only-table-row") {
    rows[5] = "TEST_CFG_DR04A";
  } else if (scenario === "deeplink-only-missing-row" || scenario === "f01-a06-wrong-title-body-mention" || scenario === "f01-api-id-mismatch") {
    rows[5] = "VT-OTHER-99";
  } else if (scenario === "f01-existing-drawer-body-mention" || scenario === "f01-typography-header-valid") {
    rows[5] = "AUDIT_DEEP_13";
  } else if (scenario === "f04-prefix-and-returnto-query") {
    rows[5] = "AUDIT_DOM_13";
  } else if (scenario === "prefix-boundary-pta1") {
    rows = ["VT-C4K-PTA13", "VT-C4K-PTA1", "VT-JSA15"];
  } else if (scenario === "unreachable-drawer") {
    rows[5] = "UNKNOWN_NOID_99";
  }

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>MindX LMS Mock Classes</title>
  <style>
    body { margin: 0; font-family: sans-serif; height: 2200px; }
    .toolbar { padding: 12px; position: sticky; top: 0; background: #fff; z-index: 5; }
    .spacer { height: 760px; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 14px 12px; border-bottom: 1px solid #ddd; cursor: pointer; }
    .bottom-scrollbar-cover {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      height: 54px;
      background: rgba(180, 180, 180, 0.35);
      z-index: 20;
    }
    .MuiDrawer-paperAnchorRight {
      display: none;
      position: fixed;
      right: 0;
      top: 0;
      bottom: 0;
      width: 520px;
      background: #fff;
      box-shadow: -4px 0 18px rgba(0,0,0,0.2);
      z-index: 1300;
      padding: 16px;
    }
    .MuiDrawer-paperAnchorRight.open { display: block; }
  </style>
</head>
<body>
  <div class="toolbar">
    <input placeholder="Search classes" id="search-input" value="${querySearch.replace(/"/g, "&quot;")}" />
    <button class="ant-input-search-button" id="search-btn" type="button">Search</button>
    <div id="debug-stats" data-pre="0" data-td="0" data-dom="0" data-archive="0" data-search="0"></div>
  </div>
  <div class="spacer"></div>
  <table>
    <tbody id="class-tbody"></tbody>
  </table>
  <div class="bottom-scrollbar-cover" id="hscroll-guard"></div>

  <div class="MuiDrawer-paperAnchorRight" aria-labelledby="class-detail" id="class-drawer">
    <button type="button" id="drawer-close-btn" aria-label="Close" style="float:right">✕</button>
    <div id="drawer-header-wrap">
      <h2 id="drawer-title"></h2>
      <p class="MuiTypography-root" id="drawer-sub-code" style="display:none"></p>
    </div>
    <div role="tablist">
      <button role="tab" id="tab-0" aria-selected="true">Course</button>
      <button role="tab" id="tab-10" aria-selected="false">Comments</button>
      ${scenario === "legacy-spck-tab" ? '<button role="tab" id="tab-spck" aria-selected="false">SPCK</button>' : ""}
    </div>
    <div id="drawer-body">
      <div id="drawer-note"></div>
      <div id="class-comments-slot-carousel-12" class="inactive">
        <div class="info-container">Session 13</div>
      </div>
      ${scenario === "legacy-spck-tab" ? '<div data-student-id="STU_DR12_LEG"></div>' : ""}
      <table><tbody><tr><td>Student Sample</td></tr></tbody></table>
    </div>
  </div>

  <script>
    const SCENARIO = ${JSON.stringify(scenario)};
    const ALL_ROWS = ${JSON.stringify(rows)};
    const QUERY_ID = ${JSON.stringify(queryId)};
    const QUERY_SEARCH = ${JSON.stringify(querySearch)};
    const QUERY_TAB = ${JSON.stringify(queryTab)};

    const tbody = document.getElementById("class-tbody");
    const drawer = document.getElementById("class-drawer");
    const drawerTitle = document.getElementById("drawer-title");
    const drawerSubCode = document.getElementById("drawer-sub-code");
    const drawerNote = document.getElementById("drawer-note");
    const tab0 = document.getElementById("tab-0");
    const tab10 = document.getElementById("tab-10");
    const tabSpck = document.getElementById("tab-spck");
    const slot12 = document.getElementById("class-comments-slot-carousel-12");
    const stats = document.getElementById("debug-stats");
    const closeDrawer = () => {
      drawer.classList.remove("open");
      if (SCENARIO === "f01-existing-drawer-body-mention") {
        window.name = "dismissed_existing_drawer";
      }
    };
    document.getElementById("drawer-close-btn").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") closeDrawer();
    });

    tab10.addEventListener("click", () => {
      tab10.setAttribute("aria-selected", "true");
      tab0.setAttribute("aria-selected", "false");
    });

    if (tabSpck) {
      tabSpck.addEventListener("click", () => {
        tabSpck.setAttribute("aria-selected", "true");
        tabSpck.dataset.clicked = "1";
      });
    }

    slot12.querySelector(".info-container").addEventListener("click", () => {
      slot12.classList.remove("inactive");
      slot12.classList.add("active");
    });

    function openDrawerFor(code, tabNum, noteText = "") {
      if (SCENARIO === "f01-typography-header-valid") {
        drawerTitle.textContent = "";
        drawerTitle.id = "legacy-non-title-ignored";
        const heading = document.createElement("h4");
        heading.textContent = "Update Classes";
        drawerTitle.replaceWith(heading);
        drawerSubCode.style.display = "block";
        drawerSubCode.textContent = code;
      } else {
        drawerTitle.textContent = code;
      }
      drawerNote.textContent = noteText;
      drawer.classList.add("open");
      if (String(tabNum) === "10") {
        tab10.setAttribute("aria-selected", "true");
        tab0.setAttribute("aria-selected", "false");
      } else {
        tab0.setAttribute("aria-selected", "true");
        tab10.setAttribute("aria-selected", "false");
      }
    }

    function renderRows(filterText) {
      const f = (filterText || "").trim().toUpperCase();
      const visible = f ? ALL_ROWS.filter(r => r.toUpperCase().includes(f)) : ALL_ROWS;
      tbody.innerHTML = "";
      for (const code of visible) {
        const tr = document.createElement("tr");
        const td1 = document.createElement("td");
        if (SCENARIO === "f03-archive-button-guard") {
          const arch = document.createElement("button");
          arch.type = "button";
          arch.textContent = "Archive";
          arch.addEventListener("click", (ev) => {
            ev.stopPropagation();
            stats.dataset.archive = String(Number(stats.dataset.archive || "0") + 1);
          });
          td1.appendChild(arch);
        } else {
          td1.textContent = "Row";
        }
        const td2 = document.createElement("td");
        const pre = document.createElement("pre");
        pre.textContent = code;
        pre.style.margin = "0";
        td2.appendChild(pre);
        tr.appendChild(td1);
        tr.appendChild(td2);

        if (SCENARIO === "f02-dom-toggle-once") {
          // Trusted Playwright pointer clicks are swallowed at pre/td2/tr; non-trusted DOM click bubbles once to tr
          pre.addEventListener("click", (ev) => {
            if (ev.isTrusted) {
              ev.stopPropagation();
              return;
            }
          });
          td2.addEventListener("click", (ev) => {
            if (ev.isTrusted) {
              ev.stopPropagation();
              return;
            }
          });
          tr.addEventListener("click", (ev) => {
            if (ev.isTrusted) {
              ev.stopPropagation();
              return;
            }
            stats.dataset.dom = String(Number(stats.dataset.dom || "0") + 1);
            if (drawer.classList.contains("open")) {
              drawer.classList.remove("open");
            } else {
              openDrawerFor(code, 0);
            }
          });
        } else {
          pre.addEventListener("click", (ev) => {
            stats.dataset.pre = String(Number(stats.dataset.pre || "0") + 1);
            if (SCENARIO === "cell-retry-needed" || SCENARIO === "f03-archive-button-guard") {
              ev.stopPropagation();
              return;
            }
            if ((SCENARIO === "search-filter-only" || SCENARIO === "spck-stale-query-recovery") && !f) {
              ev.stopPropagation();
              return;
            }
            if (SCENARIO === "deeplink-only-table-row" || SCENARIO === "unreachable-drawer") {
              ev.stopPropagation();
              return;
            }
            openDrawerFor(code, 0, SCENARIO === "f01-typography-header-valid" ? "Previous class: OTHER_CLASS_99" : "");
          });

          td2.addEventListener("click", (ev) => {
            stats.dataset.td = String(Number(stats.dataset.td || "0") + 1);
            if ((SCENARIO === "search-filter-only" || SCENARIO === "spck-stale-query-recovery") && !f) {
              ev.stopPropagation();
              return;
            }
            if (SCENARIO === "deeplink-only-table-row" || SCENARIO === "unreachable-drawer") {
              ev.stopPropagation();
              return;
            }
            openDrawerFor(code, 0, SCENARIO === "f01-typography-header-valid" ? "Previous class: OTHER_CLASS_99" : "");
          });
        }

        tbody.appendChild(tr);
      }
    }

    const searchInput = document.getElementById("search-input");
    const triggerSearch = () => {
      stats.dataset.search = String(Number(stats.dataset.search || "0") + 1);
      renderRows(searchInput.value);
    };
    searchInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") triggerSearch();
    });
    document.getElementById("search-btn").addEventListener("click", triggerSearch);

    renderRows("");

    // Initial state handlers
    if (SCENARIO === "deeplink-only-table-row" && QUERY_ID === "7e7381ebb20e9bcfaa5a63af" && QUERY_SEARCH.toUpperCase() === "TEST_CFG_DR04A") {
      openDrawerFor("TEST_CFG_DR04A", QUERY_TAB);
    } else if (SCENARIO === "deeplink-only-missing-row" && QUERY_ID === "65abc123def4567890abcdef" && QUERY_SEARCH.toUpperCase() === "TEST_DB_DR04B") {
      openDrawerFor("TEST_DB_DR04B", QUERY_TAB);
    } else if (SCENARIO === "f01-a06-wrong-title-body-mention" && QUERY_ID === "651111111111111111111113") {
      // Malicious/stale drawer: title is OTHER_CLASS_99, only body mentions AUDIT_DEEP_13!
      openDrawerFor("OTHER_CLASS_99", QUERY_TAB, "Previous class: AUDIT_DEEP_13");
    } else if (SCENARIO === "f01-existing-drawer-body-mention" && !QUERY_ID && !window.name.includes("dismissed_existing_drawer")) {
      // Pre-existing drawer open on OTHER_CLASS_99 before openClassDrawer("AUDIT_DEEP_13") runs
      openDrawerFor("OTHER_CLASS_99", 0, "Previous class: AUDIT_DEEP_13");
    } else if (SCENARIO === "f01-api-id-mismatch" && QUERY_ID === "651111111111111111111113") {
      // Even trigger fake GraphQL response returning wrong _id & wrong class code
      fetch("https://lms-api.mindx.edu.vn/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationName: "GetClassById" }),
      }).then(() => openDrawerFor("AUDIT_DEEP_13", QUERY_TAB)).catch(() => {});
    } else if (SCENARIO === "spck-stale-query-recovery" && QUERY_SEARCH === "VT-OTHER-99") {
      openDrawerFor("VT-OTHER-99", 0);
    }
  </script>
</body>
</html>`;
}

async function runTests() {
  const { classSessionRepo, getDb, spckSessionRepo, spckUploadRepo, studentRepo } =
    await import("../src/lib/db/sqlite");
  const { authService } = await import("../src/lib/playwright/auth");
  const { BrowserManager } = await import("../src/lib/playwright/browser-manager");
  const { LmsHelpers } = await import("../src/lib/playwright/lms-helpers");
  const { SpckUploader } = await import("../src/lib/playwright/spck-uploader");

  assert.equal(
    path.resolve(getDb().name),
    path.resolve(tempDbPath),
    "Temp DB isolation failed: getDb() must point to tempDbPath!"
  );

  console.log("=== KIỂM THỬ KHÔI PHỤC MỞ DRAWER LỚP LMS & RANH GIỚI F01–F05 (v3.5.2) ===");

  let scenario: MockScenario = "bottom-scrollbar-center-fix";
  const requestedUrls: string[] = [];

  // Seed temp SQLite class_report_cards snapshot for DR-04B synthetic class
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO class_report_cards (classId, classCode, lmsSnapshotJson, updatedAt) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
  ).run(
    "TEST_DB_DR04B",
    "TEST_DB_DR04B",
    JSON.stringify({ lmsClassId: "65abc123def4567890abcdef" })
  );

  let browser: Browser | null = null;
  const origEnsureAuth = authService.ensureAuthenticated.bind(authService);
  const bm = BrowserManager.getInstance();
  const origGetPage = bm.getPage.bind(bm);

  (authService as any).ensureAuthenticated = async () => {};

  const seedStudentSession13 = (classCode: string, stuId: string, stuName: string) => {
    const stuFolder = path.join(tempRoot, `stu_${classCode}_${stuId}`);
    fs.mkdirSync(stuFolder, { recursive: true });
    const defaultThumbPath = path.resolve("data/config/default-spck-thumbnail.png");

    classSessionRepo.upsert({
      classId: classCode,
      className: classCode,
      sessionId: `${classCode}_SESS_13`,
      sessionNumber: 13,
      date: "2026-11-15",
      topic: "SPCK Stage 1",
    });
    studentRepo.upsert({
      classId: classCode,
      studentId: stuId,
      fullName: stuName,
      isActive: 1,
    });
    spckUploadRepo.upsert({
      classId: classCode,
      studentId: stuId,
      localFolderPath: stuFolder,
      matchScore: 1,
      isConfirmedByTeacher: 1,
      projectTitle: "Sản Phẩm Học Viên 01",
      thumbnailPath: defaultThumbPath,
      screenshotsJson: "[]",
      attachmentsJson: "[]",
      youtubeUrlsJson: "[]",
      relatedLinksJson: "[]",
      teacherComment: "Nhận xét kiểm thử E2E.",
      contentHash: "",
      status: "WAITING_APPROVAL",
    });
    spckSessionRepo.saveSessionDraft({
      classId: classCode,
      studentId: stuId,
      sessionNumber: 13,
      localFolderPath: stuFolder,
      isConfirmedByTeacher: 1,
      projectTitle: "Sản Phẩm Học Viên 01",
      thumbnailPath: defaultThumbPath,
      teacherComment: "Nhận xét kiểm thử E2E.",
    });
    spckSessionRepo.approveSessionDraft(classCode, stuId, 13);
  };

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.route("https://lms.mindx.edu.vn/**", async (route) => {
      const reqUrl = route.request().url();
      const parsed = new URL(reqUrl);
      requestedUrls.push(`${parsed.pathname}${parsed.search}`);
      const html = buildMockAdminClassesHtml(scenario, `${parsed.pathname}${parsed.search}`);
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: html,
      });
    });
    await context.route("https://lms-api.mindx.edu.vn/**", async (route) => {
      if (scenario === "f01-api-id-mismatch") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              class: {
                _id: "999999999999999999999999",
                name: "OTHER_CLASS_99",
              },
            },
          }),
        });
        return;
      }
      await route.abort();
    });

    const newClassesPage = async (targetScenario: MockScenario, customPath = "/admin/classes"): Promise<Page> => {
      scenario = targetScenario;
      const p = await context.newPage();
      await p.goto(`https://lms.mindx.edu.vn${customPath}`, { waitUntil: "domcontentloaded" });
      return p;
    };

    // DR-01: Bottom edge covered by fixed bottom scrollbar cover -> scrollIntoView center recovers
    {
      const page = await newClassesPage("bottom-scrollbar-center-fix");
      await page.evaluate(() => {
        const row = document.querySelectorAll("#class-tbody tr")[5] as HTMLElement;
        const rect = row.getBoundingClientRect();
        window.scrollTo(0, window.scrollY + rect.top - (window.innerHeight - 25));
      });
      await LmsHelpers.openClassDrawer(page, "VT-C4K-PTA13");
      assert.equal((await page.locator("#drawer-title").innerText()).trim(), "VT-C4K-PTA13");
      await page.close();
      console.log("[DR-01] PASS: Row 6 bị thanh cuộn che mép dưới -> tự căn giữa và mở Drawer.");
    }

    // DR-02: <pre> click swallowed -> Stage B cell click retry recovers immediately
    {
      const page = await newClassesPage("cell-retry-needed");
      await LmsHelpers.openClassDrawer(page, "VT-C4K-PTA13");
      assert.equal((await page.locator("#drawer-title").innerText()).trim(), "VT-C4K-PTA13");
      const tdClicks = await page.locator("#debug-stats").getAttribute("data-td");
      assert(Number(tdClicks) >= 1, "Expected Stage B td click fallback to fire");
      await page.close();
      console.log("[DR-02] PASS: Nút <pre> rớt click -> Stage B thử lại ô chứa tên lớp và mở Drawer.");
    }

    // DR-03: Unfiltered row click dead -> Stage C fills Search classes to isolate Row 1 & opens Drawer
    {
      const page = await newClassesPage("search-filter-only");
      await LmsHelpers.openClassDrawer(page, "VT-C4K-PTA13");
      assert.equal((await page.locator("#drawer-title").innerText()).trim(), "VT-C4K-PTA13");
      assert.equal((await page.locator("#search-input").inputValue()).toUpperCase(), "VT-C4K-PTA13");
      await page.close();
      console.log("[DR-03] PASS: Bảng chưa lọc không nhận click -> Stage C tự lọc Search kéo lên dòng 1.");
    }

    // DR-04A (F05 Fixed): Uses self-contained TEST_CFG_DR04A in tempConfigDir/lms_class_ids.json
    {
      const page = await newClassesPage("deeplink-only-table-row");
      await LmsHelpers.openClassDrawer(page, "TEST_CFG_DR04A", { preferredTab: 10 });
      assert.equal((await page.locator("#drawer-title").innerText()).trim(), "TEST_CFG_DR04A");
      assert.equal(await page.locator("#tab-10").getAttribute("aria-selected"), "true");
      assert(page.url().includes("7e7381ebb20e9bcfaa5a63af"));
      await page.close();
      console.log("[DR-04A] PASS: Độc lập 100% với tempConfigDir -> Stage D mở ID TEST_CFG_DR04A (tab=10).");
    }

    // DR-04B: Class missing from Page 1 -> Step 4 deep-link fallback using temp SQLite snapshot ID
    {
      const page = await newClassesPage("deeplink-only-missing-row");
      await LmsHelpers.openClassDrawer(page, "TEST_DB_DR04B", { preferredTab: 10 });
      assert.equal((await page.locator("#drawer-title").innerText()).trim(), "TEST_DB_DR04B");
      assert(page.url().includes("65abc123def4567890abcdef"));
      await page.close();
      console.log("[DR-04B] PASS: Lớp không nằm ở trang 1 -> tự mở qua ID trong temp SQLite.");
    }

    // DR-05: Truly unreachable drawer fails closed cleanly & writes screenshot in tempShotDir
    {
      const page = await newClassesPage("unreachable-drawer");
      let caught: Error | null = null;
      try {
        await LmsHelpers.openClassDrawer(page, "UNKNOWN_NOID_99");
      } catch (err) {
        caught = err as Error;
      }
      assert(caught && caught.message.includes("Timeout khi chờ Drawer chi tiết lớp 'UNKNOWN_NOID_99'"));
      assert(fs.existsSync(path.join(tempShotDir, "debug_drawer_timeout.png")));
      await page.close();
      console.log("[DR-05] PASS: Thất bại thật báo lỗi chuẩn & lưu ảnh chẩn đoán vào tempShotDir.");
    }

    // DR-06: Minimal mock page compatibility
    {
      const fakeDrawerLoc: any = {
        first: () => fakeDrawerLoc,
        isVisible: async () => true,
        innerText: async () => "MOCK_CLS\nStudent A",
        locator: () => ({ count: async () => 1 }),
        count: async () => 1,
      };
      const fakePage: any = {
        url: () => "/admin/classes",
        waitForTimeout: async () => {},
        locator: (sel: string) => {
          if (sel.includes('type="password"')) {
            return { first: () => ({ isVisible: async () => false }) };
          }
          if (sel.includes("aria-labelledby")) {
            return fakeDrawerLoc;
          }
          return { first: () => ({ isVisible: async () => false, count: async () => 0 }) };
        },
      };
      await LmsHelpers.openClassDrawer(fakePage, "MOCK_CLS");
      console.log("[DR-06] PASS: Tương thích mock page tối giản.");
    }

    // DR-07: End-to-end SpckUploader resets stale query, recovers Drawer, switches #tab-10 & Slot 13
    {
      seedStudentSession13("VT-C4K-PTA13", "STU_DR07", "Hoc Vien Kiem Thu DR07");
      const page = await newClassesPage(
        "spck-stale-query-recovery",
        '/admin/classes?search=%22VT-OTHER-99%22&id=%22111111111111111111111111%22'
      );
      requestedUrls.length = 0;
      (bm as any).getPage = async () => page;

      const batchRes = await SpckUploader.uploadApprovedSpck({
        classId: "VT-C4K-PTA13",
        sessionNumber: 13,
        studentIds: ["STU_DR07"],
      });

      assert(requestedUrls.some((u) => u === "/admin/classes"));
      assert.equal((await page.locator("#drawer-title").innerText()).trim(), "VT-C4K-PTA13");
      assert.equal(await page.locator("#tab-10").getAttribute("aria-selected"), "true");
      assert(((await page.locator("#class-comments-slot-carousel-12").getAttribute("class")) || "").includes("active"));
      assert(batchRes.results[0]?.errorMessage?.includes("Không tìm thấy học viên"));
      await page.close();
      console.log("[DR-07] PASS: SpckUploader xóa query cũ, mở Drawer VT-C4K-PTA13, bật #tab-10 & Slot 13.");
    }

    // DR-08 (F01): Header-only identity & GetClassById API check (blocks A06, closes mismatched existingDrawer, allows real MUI Typography header)
    {
      // DR-08A: Wrong #drawer-title "OTHER_CLASS_99" + body "Previous class: AUDIT_DEEP_13" -> MUST REJECT
      const pageA06 = await newClassesPage("f01-a06-wrong-title-body-mention");
      let errA06: Error | null = null;
      try {
        await LmsHelpers.openClassDrawer(pageA06, "AUDIT_DEEP_13");
      } catch (e) {
        errA06 = e as Error;
      }
      assert(
        errA06 && errA06.message.includes("nội dung trong Drawer không khớp mã lớp 'AUDIT_DEEP_13'"),
        `F01 A06 must reject wrong-title drawer even when body mentions target class! Got: ${errA06?.message}`
      );
      await pageA06.close();

      // DR-08B: Pre-existing OTHER_CLASS_99 drawer mentioning AUDIT_DEEP_13 in body -> Step 2 rejects & opens real AUDIT_DEEP_13
      const pageExisting = await newClassesPage("f01-existing-drawer-body-mention");
      await LmsHelpers.openClassDrawer(pageExisting, "AUDIT_DEEP_13");
      assert.equal((await pageExisting.locator("#drawer-title").innerText()).trim(), "AUDIT_DEEP_13");
      await pageExisting.close();

      // DR-08C: MindX Typography header ("Update Classes" + <p>AUDIT_DEEP_13</p> above tabs, body mentions OTHER_CLASS_99) -> PASS
      const pageTypo = await newClassesPage("f01-typography-header-valid");
      await LmsHelpers.openClassDrawer(pageTypo, "AUDIT_DEEP_13");
      assert.equal((await pageTypo.locator("#drawer-sub-code").innerText()).trim(), "AUDIT_DEEP_13");
      await pageTypo.close();

      // DR-08D: GetClassById API returns mismatched _id & code even when DOM spoofs AUDIT_DEEP_13 -> MUST REJECT
      const pageApiMismatch = await newClassesPage("f01-api-id-mismatch");
      let errApi: Error | null = null;
      try {
        await LmsHelpers.openClassDrawer(pageApiMismatch, "AUDIT_DEEP_13");
      } catch (e) {
        errApi = e as Error;
      }
      assert(
        errApi && errApi.message.includes("không khớp mã lớp 'AUDIT_DEEP_13'"),
        `F01 API mismatch must reject even if DOM title matches! Got: ${errApi?.message}`
      );
      await pageApiMismatch.close();
      console.log("[DR-08] PASS (F01): Chặn triệt để sai tiêu đề / sai API ID kể cả khi body nhắc tên lớp.");
    }

    // DR-09 (F02): DOM fallback fires ONLY ONE click event on toggle row (never double-fires & closes)
    {
      const page = await newClassesPage("f02-dom-toggle-once");
      await LmsHelpers.openClassDrawer(page, "VT-C4K-PTA13");
      assert.equal((await page.locator("#drawer-title").innerText()).trim(), "VT-C4K-PTA13");
      const domCount = Number((await page.locator("#debug-stats").getAttribute("data-dom")) || "0");
      assert.equal(domCount, 1, `F02: Expected single DOM click (1), got ${domCount}`);
      await page.close();
      console.log("[DR-09] PASS (F02): Nhánh DOM dự phòng chỉ phát 1 sự kiện click (dom=1), không đóng lại Drawer.");
    }

    // DR-10 (F03): Unrelated "Archive" button before name cell is NEVER clicked
    {
      const page = await newClassesPage("f03-archive-button-guard");
      await LmsHelpers.openClassDrawer(page, "VT-C4K-PTA13");
      assert.equal((await page.locator("#drawer-title").innerText()).trim(), "VT-C4K-PTA13");
      const archiveClicks = Number((await page.locator("#debug-stats").getAttribute("data-archive")) || "0");
      assert.equal(archiveClicks, 0, `F03: Archive button must NEVER be clicked, got ${archiveClicks}`);
      await page.close();
      console.log("[DR-10] PASS (F03): Nút Archive đứng trước tên lớp không bao giờ bị bấm nhầm (archive=0).");
    }

    // DR-11 (F04): Prefix URL search ("AUDIT_DOM_130") or unrelated returnTo=AUDIT_DOM_13 MUST reset URL cleanly
    {
      const stalePaths = [
        '/admin/classes?search=%22AUDIT_DOM_130%22&id=%22111111111111111111111111%22',
        '/admin/classes?search=%22OTHER_CLASS%22&returnTo=AUDIT_DOM_13',
      ];
      for (let i = 0; i < stalePaths.length; i++) {
        const stalePath = stalePaths[i];
        const dr11StudentId = `STU_DR11_${i}`;
        seedStudentSession13("AUDIT_DOM_13", dr11StudentId, `Hoc Vien F04 ${i}`);
        const page = await newClassesPage("f04-prefix-and-returnto-query", stalePath);
        requestedUrls.length = 0;
        (bm as any).getPage = async () => page;

        await SpckUploader.uploadApprovedSpck({
          classId: "AUDIT_DOM_13",
          sessionNumber: 13,
          studentIds: [dr11StudentId],
        });

        assert(
          requestedUrls.some((u) => u === "/admin/classes"),
          `F04: Expected clean reset to /admin/classes for stale URL '${stalePath}', saw: ${JSON.stringify(requestedUrls)}`
        );
        assert.equal((await page.locator("#drawer-title").innerText()).trim(), "AUDIT_DOM_13");
        assert.equal(await page.locator("#tab-10").getAttribute("aria-selected"), "true");
        await page.close();
      }
      console.log("[DR-11] PASS (F04): Xóa sạch URL query cũ có tiền tố giống (AUDIT_DOM_130) và returnTo=.");
    }

    // DR-12: Strict prefix boundary (VT-C4K-PTA1 vs VT-C4K-PTA13) + legacy spckTab branch
    {
      const pageBound = await newClassesPage("prefix-boundary-pta1");
      await LmsHelpers.openClassDrawer(pageBound, "VT-C4K-PTA1");
      assert.equal((await pageBound.locator("#drawer-title").innerText()).trim(), "VT-C4K-PTA1");
      await pageBound.close();

      seedStudentSession13("VT-C4K-PTA13", "STU_DR12_LEG", "Hoc Vien Legacy");
      const pageLegacy = await newClassesPage("legacy-spck-tab");
      (bm as any).getPage = async () => pageLegacy;
      await SpckUploader.uploadApprovedSpck({
        classId: "VT-C4K-PTA13",
        sessionNumber: 13,
        studentIds: ["STU_DR12_LEG"],
      });
      assert.equal(await pageLegacy.locator("#tab-spck").getAttribute("aria-selected"), "true");
      assert.equal(await pageLegacy.locator("#tab-10").getAttribute("aria-selected"), "false");
      await pageLegacy.close();
      console.log("[DR-12] PASS: Khớp đúng ranh giới VT-C4K-PTA1 vs VT-C4K-PTA13 & bảo toàn nhánh legacy tab SPCK.");
    }

    // DR-13 (R2-F01): [data-class-code] inside #drawer-body MUST NEVER beat conflicting #drawer-title
    {
      for (const preOpened of [true, false]) {
        const p = await context.newPage();
        await p.route("https://lms.mindx.edu.vn/**", (route) =>
          route.fulfill({
            status: 200,
            contentType: "text/html; charset=utf-8",
            body: `<!doctype html><html><body style="margin:0">
              <table><tbody><tr id="row-target"><td>Row</td><td><pre>AUDIT_DEEP_13</pre></td></tr></tbody></table>
              <div id="class-drawer" class="MuiDrawer-paperAnchorRight" aria-labelledby="class-detail" style="${preOpened ? "display:block" : "display:none"}">
                <h2 id="drawer-title">OTHER_CLASS_99</h2>
                <div role="tablist"><button role="tab" id="tab-10" aria-selected="false">Comments</button></div>
                <div id="drawer-body">
                  <span data-class-code="AUDIT_DEEP_13">Previous class</span>
                  <table><tbody><tr><td>Student Row</td></tr></tbody></table>
                </div>
              </div>
              <script>
                document.getElementById("row-target").addEventListener("click", () => {
                  document.getElementById("class-drawer").style.display = "block";
                });
              </script></body></html>`,
          })
        );
        await p.goto("https://lms.mindx.edu.vn/admin/classes", { waitUntil: "domcontentloaded" });
        let rejected = false;
        try {
          await LmsHelpers.openClassDrawer(p, "AUDIT_DEEP_13");
        } catch {
          rejected = true;
        }
        assert.equal(rejected, true, `DR-13 (preOpened=${preOpened}): Body [data-class-code] must not override OTHER_CLASS_99 title`);
        await p.close();
      }
      console.log("[DR-13] PASS (R2-F01): Thuộc tính [data-class-code] trong nội dung phụ không vượt mặt #drawer-title.");
    }

    // DR-14 (R2-F02): Conflicting <h4>OTHER_CLASS_99</h4> MUST NOT be overridden by generic <p> mentioning target
    {
      const p = await context.newPage();
      await p.route("https://lms.mindx.edu.vn/**", (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: `<!doctype html><html><body>
            <table><tbody><tr id="row-target"><td>Row</td><td><pre>AUDIT_DEEP_13</pre></td></tr></tbody></table>
            <div id="class-drawer" class="MuiDrawer-paperAnchorRight" aria-labelledby="class-detail" style="display:none">
              <h4>OTHER_CLASS_99</h4>
              <p class="MuiTypography-root">Previous class: AUDIT_DEEP_13</p>
              <div role="tablist"><button role="tab" id="tab-10">Comments</button></div>
              <div id="drawer-body"><table><tbody><tr><td>Student</td></tr></tbody></table></div>
            </div>
            <script>
              document.getElementById("row-target").addEventListener("click", () => {
                document.getElementById("class-drawer").style.display = "block";
              });
            </script></body></html>`,
        })
      );
      await p.goto("https://lms.mindx.edu.vn/admin/classes", { waitUntil: "domcontentloaded" });
      let rejected = false;
      try {
        await LmsHelpers.openClassDrawer(p, "AUDIT_DEEP_13");
      } catch {
        rejected = true;
      }
      assert.equal(rejected, true, "DR-14: Generic <p> header mention must not override conflicting <h4>OTHER_CLASS_99</h4>");
      await p.close();
      console.log("[DR-14] PASS (R2-F02): Chặn dòng <p> nhắc lớp đích vượt qua tiêu đề <h4> xung đột.");
    }

    // DR-15 (R2-F03): Wait for in-flight delayed GetClassById (1500ms) and reject if server returns wrong class
    {
      const p = await context.newPage();
      await p.route("https://lms.mindx.edu.vn/**", (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: `<!doctype html><html><body>
            <table><tbody><tr id="row-target"><td>Row</td><td><pre>AUDIT_DEEP_13</pre></td></tr></tbody></table>
            <div id="class-drawer" class="MuiDrawer-paperAnchorRight" aria-labelledby="class-detail" style="display:none">
              <h2 id="drawer-title">AUDIT_DEEP_13</h2>
              <div role="tablist"><button role="tab" id="tab-10">Comments</button></div>
              <div id="drawer-body"><table><tbody><tr><td>Student</td></tr></tbody></table></div>
            </div>
            <script>
              document.getElementById("row-target").addEventListener("click", () => {
                document.getElementById("class-drawer").style.display = "block";
                fetch("https://lms-api.mindx.edu.vn/graphql", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ operationName: "GetClassById", variables: { id: "651111111111111111111113" } }),
                });
              });
            </script></body></html>`,
        })
      );
      await p.route("https://lms-api.mindx.edu.vn/graphql", async (route) => {
        await new Promise((r) => setTimeout(r, 1500));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "access-control-allow-origin": "*" },
          body: JSON.stringify({
            data: { class: { _id: "999999999999999999999999", name: "OTHER_CLASS_99" } },
          }),
        });
      });
      await p.goto("https://lms.mindx.edu.vn/admin/classes", { waitUntil: "domcontentloaded" });
      const startedAt = Date.now();
      let rejected = false;
      try {
        await LmsHelpers.openClassDrawer(p, "AUDIT_DEEP_13");
      } catch {
        rejected = true;
      }
      const elapsedMs = Date.now() - startedAt;
      assert.equal(rejected, true, "DR-15: Delayed mismatched GetClassById must cause rejection even if DOM shows target");
      assert(elapsedMs >= 1200, `DR-15: Expected openClassDrawer to wait for delayed API (>=1200ms), returned in ${elapsedMs}ms`);
      assert.equal((p as any).listenerCount("response"), 0, "DR-15: Response listeners must be cleaned up after rejection");
      assert.equal((p as any).listenerCount("request"), 0, "DR-15: Request listeners must be cleaned up after rejection");
      assert.equal((p as any).listenerCount("requestfailed"), 0, "DR-15: Requestfailed listeners must be cleaned up after rejection");
      await p.close();
      console.log(`[DR-15] PASS (R2-F03): Đợi API chậm (${elapsedMs}ms) và chặn kịp thời phản hồi lệch lớp.`);
    }

    // DR-16 (R2-F04): Reject HTTP 500 (with or without class payload) and HTTP 200 with GraphQL errors; accept clean 200
    {
      const variants = [
        { name: "http500-with-payload", status: 500, body: { data: { class: { _id: "651111111111111111111113", name: "AUDIT_DEEP_13" } }, errors: [{ message: "fail" }] }, shouldPass: false },
        { name: "http500-empty", status: 500, body: {}, shouldPass: false },
        { name: "http200-graphql-errors", status: 200, body: { data: { class: { _id: "651111111111111111111113", name: "AUDIT_DEEP_13" } }, errors: [{ message: "Partial GraphQL error" }] }, shouldPass: false },
        { name: "http200-clean", status: 200, body: { data: { class: { _id: "651111111111111111111113", name: "AUDIT_DEEP_13" } } }, shouldPass: true },
      ];
      for (const v of variants) {
        const p = await context.newPage();
        await p.route("https://lms.mindx.edu.vn/**", (route) =>
          route.fulfill({
            status: 200,
            contentType: "text/html; charset=utf-8",
            body: `<!doctype html><html><body>
              <table><tbody><tr id="row-target"><td>Row</td><td><pre>AUDIT_DEEP_13</pre></td></tr></tbody></table>
              <div id="class-drawer" class="MuiDrawer-paperAnchorRight" aria-labelledby="class-detail" style="display:none">
                <h2 id="drawer-title">Update Classes</h2>
                <div role="tablist"><button role="tab" id="tab-10">Comments</button></div>
                <div id="drawer-body"><table><tbody><tr><td>Student</td></tr></tbody></table></div>
              </div>
              <script>
                document.getElementById("row-target").addEventListener("click", () => {
                  document.getElementById("class-drawer").style.display = "block";
                  fetch("https://lms-api.mindx.edu.vn/graphql", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ operationName: "GetClassById", variables: { id: "651111111111111111111113" } }),
                  });
                });
              </script></body></html>`,
          })
        );
        await p.route("https://lms-api.mindx.edu.vn/graphql", (route) =>
          route.fulfill({
            status: v.status,
            contentType: "application/json",
            headers: { "access-control-allow-origin": "*" },
            body: JSON.stringify(v.body),
          })
        );
        await p.goto("https://lms.mindx.edu.vn/admin/classes", { waitUntil: "domcontentloaded" });
        let accepted = false;
        try {
          await LmsHelpers.openClassDrawer(p, "AUDIT_DEEP_13");
          accepted = true;
        } catch {}
        assert.equal(accepted, v.shouldPass, `DR-16 (${v.name}): expected accepted=${v.shouldPass}, got ${accepted}`);
        await p.close();
      }
      console.log("[DR-16] PASS (R2-F04): Chặn HTTP 500 (có/không payload) & HTTP 200 kèm GraphQL errors; chỉ nhận HTTP 200 sạch.");
    }

    // DR-17 (R2-F05): Unrelated GetClassById (wrong ID first or last) and Classes list query must NOT poison target
    {
      for (const order of ["wrong-first", "right-first"] as const) {
        const p = await context.newPage();
        await p.route("https://lms.mindx.edu.vn/**", (route) =>
          route.fulfill({
            status: 200,
            contentType: "text/html; charset=utf-8",
            body: `<!doctype html><html><body>
              <table><tbody><tr id="row-target"><td>Row</td><td><pre>AUDIT_DEEP_13</pre></td></tr></tbody></table>
              <div id="class-drawer" class="MuiDrawer-paperAnchorRight" aria-labelledby="class-detail" style="display:none">
                <h2 id="drawer-title">AUDIT_DEEP_13</h2>
                <div role="tablist"><button role="tab" id="tab-10">Comments</button></div>
                <div id="drawer-body"><table><tbody><tr><td>Student</td></tr></tbody></table></div>
              </div>
              <script>
                document.getElementById("row-target").addEventListener("click", () => {
                  document.getElementById("class-drawer").style.display = "block";
                  fetch("https://lms-api.mindx.edu.vn/graphql", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ operationName: "Classes" }),
                  });
                  fetch("https://lms-api.mindx.edu.vn/graphql", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ operationName: "GetClassById", variables: { id: "999999999999999999999999" } }),
                  });
                  fetch("https://lms-api.mindx.edu.vn/graphql", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ operationName: "GetClassById", variables: { id: "651111111111111111111113" } }),
                  });
                });
              </script></body></html>`,
          })
        );
        await p.route("https://lms-api.mindx.edu.vn/graphql", async (route) => {
          const reqBody = JSON.parse(route.request().postData() || "{}");
          const isClassesOp = reqBody.operationName === "Classes";
          const isStaleId = reqBody.variables?.id === "999999999999999999999999";
          const delayMs = isClassesOp
            ? 20
            : order === "wrong-first"
              ? isStaleId ? 30 : 250
              : isStaleId ? 250 : 30;
          await new Promise((r) => setTimeout(r, delayMs));
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "access-control-allow-origin": "*" },
            body: JSON.stringify({
              data: {
                class: {
                  _id: isStaleId || isClassesOp ? "999999999999999999999999" : "651111111111111111111113",
                  name: isStaleId || isClassesOp ? "OTHER_CLASS_99" : "AUDIT_DEEP_13",
                },
              },
            }),
          });
        });
        await p.goto("https://lms.mindx.edu.vn/admin/classes", { waitUntil: "domcontentloaded" });
        await LmsHelpers.openClassDrawer(p, "AUDIT_DEEP_13");
        assert.equal((await p.locator("#drawer-title").innerText()).trim(), "AUDIT_DEEP_13");
        await p.close();
      }
      console.log("[DR-17] PASS (R2-F05): Phản hồi lớp cũ sai ID (đến trước/sau) và query Classes không làm nhiễm lớp đích.");
    }

    // DR-18 (R3-F01): Authoritative DOM conflicts BEFORE positive match + C03/C11 controls
    {
      const p = await browser.newPage();
      const targetCode = "AUDIT_DEEP_13";
      const rx = /(^|[^a-zA-Z0-9_-])AUDIT_DEEP_13([^a-zA-Z0-9_-]|$)/i;

      // 18A: root data-class-code=TARGET + <h4>OTHER_CLASS_99</h4> -> MUST CONFLICT
      await p.setContent(
        `<div id="drawer" class="MuiDrawer-paperAnchorRight" aria-labelledby="class-detail" data-class-code="${targetCode}">
          <h4>OTHER_CLASS_99</h4>
          <div role="tablist"><button role="tab">Comments</button></div>
          <div id="drawer-body"><table><tbody><tr><td>row</td></tr></tbody></table></div>
        </div>`
      );
      const conflictRootAttrVsH4 = await (LmsHelpers as any).verifyDrawerMatchesTargetClass(
        p.locator("#drawer"),
        rx
      );
      assert.equal(conflictRootAttrVsH4.matched, false, "DR-18A: root data-class-code must not override <h4>OTHER</h4>");

      // 18B: #drawer-title=TARGET + <h4>OTHER_CLASS_99</h4> -> MUST CONFLICT
      await p.setContent(
        `<div id="drawer" class="MuiDrawer-paperAnchorRight" aria-labelledby="class-detail">
          <h2 id="drawer-title">${targetCode}</h2><h4>OTHER_CLASS_99</h4>
          <div role="tablist"><button role="tab">Comments</button></div>
          <div id="drawer-body"><table><tbody><tr><td>row</td></tr></tbody></table></div>
        </div>`
      );
      const conflictTitleVsH4 = await (LmsHelpers as any).verifyDrawerMatchesTargetClass(
        p.locator("#drawer"),
        rx
      );
      assert.equal(conflictTitleVsH4.matched, false, "DR-18B: #drawer-title must not override sibling <h4>OTHER</h4>");

      // 18C: #drawer-title=OTHER + span[data-testid="class-code"]=TARGET -> MUST CONFLICT
      await p.setContent(
        `<div id="drawer" class="MuiDrawer-paperAnchorRight" aria-labelledby="class-detail">
          <h2 id="drawer-title">OTHER_CLASS_99</h2><span data-testid="class-code">${targetCode}</span>
          <div role="tablist"><button role="tab">Comments</button></div>
          <div id="drawer-body"><table><tbody><tr><td>row</td></tr></tbody></table></div>
        </div>`
      );
      const conflictTwoExplicit = await (LmsHelpers as any).verifyDrawerMatchesTargetClass(
        p.locator("#drawer"),
        rx
      );
      assert.equal(conflictTwoExplicit.matched, false, "DR-18C: explicit title conflict must reject");

      // 18D (C03 positive control): <h4>Update Classes</h4> + <p class="MuiTypography-root">TARGET</p> -> MUST PASS
      await p.setContent(
        `<div id="drawer" class="MuiDrawer-paperAnchorRight" aria-labelledby="class-detail">
          <h4>Update Classes</h4><p class="MuiTypography-root">${targetCode}</p>
          <div role="tablist"><button role="tab">Comments</button></div>
          <div id="drawer-body"><table><tbody><tr><td>row</td></tr></tbody></table></div>
        </div>`
      );
      const validC03 = await (LmsHelpers as any).verifyDrawerMatchesTargetClass(
        p.locator("#drawer"),
        rx
      );
      assert.equal(validC03.matched, true, "DR-18D: C03 Update Classes + <p>TARGET</p> must match");

      // 18E (C11 positive control): <h4>Update Classes</h4> + <input name="classCode" value="TARGET"> inside #drawer-body -> MUST PASS
      await p.setContent(
        `<div id="drawer" class="MuiDrawer-paperAnchorRight" aria-labelledby="class-detail">
          <h4>Update Classes</h4>
          <div id="drawer-body"><input name="classCode" value="${targetCode}" /><table><tbody><tr><td>row</td></tr></tbody></table></div>
        </div>`
      );
      const validC11 = await (LmsHelpers as any).verifyDrawerMatchesTargetClass(
        p.locator("#drawer"),
        rx
      );
      assert.equal(validC11.matched, true, "DR-18E: C11 input[name=classCode] must match");
      await p.close();
      console.log("[DR-18] PASS (R3-F01): Chặn xung đột đa nguồn trước khi match & giữ nguyên C03/C11.");
    }

    // DR-19 (R3-F02): Known expectedId enforced unconditionally across DOM attr & GetClassById without variables
    {
      const targetCode = "R3_ID_13";
      const expectedId = "651111111111111111111113";
      const wrongId = "999999999999999999999999";
      db.prepare(
        `INSERT OR REPLACE INTO class_report_cards (classId, classCode, lmsSnapshotJson, updatedAt) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
      ).run(targetCode, targetCode, JSON.stringify({ lmsClassId: expectedId }));

      const makePage = async (opts: { drawerAttrId?: string; apiResId?: string }) => {
        const p = await browser!.newPage();
        await p.route("https://lms.mindx.edu.vn/**", (route) =>
          route.fulfill({
            status: 200,
            contentType: "text/html",
            body: `<!doctype html><html><body>
              <table><tbody><tr id="row"><td>${targetCode}</td></tr></tbody></table>
              <div id="drawer" class="MuiDrawer-paperAnchorRight" aria-labelledby="class-detail" style="display:none" ${opts.drawerAttrId ? `data-class-id="${opts.drawerAttrId}"` : ""}>
                <h2 id="drawer-title">${targetCode}</h2>
                <div role="tablist"><button role="tab">Comments</button></div>
                <div id="drawer-body"><table><tbody><tr><td>HV</td></tr></tbody></table></div>
              </div>
              <script>
                document.getElementById('row').onclick = () => {
                  document.getElementById('drawer').style.display = 'block';
                  if (${JSON.stringify(Boolean(opts.apiResId))}) {
                    fetch('https://lms-api.mindx.edu.vn/graphql', {
                      method: 'POST',
                      body: JSON.stringify({ operationName: 'GetClassById' })
                    });
                  }
                };
              </script></body></html>`,
          })
        );
        if (opts.apiResId) {
          await p.route("https://lms-api.mindx.edu.vn/graphql", (route) =>
            route.fulfill({
              status: 200,
              contentType: "application/json",
              headers: { "access-control-allow-origin": "*" },
              body: JSON.stringify({
                data: { class: { _id: opts.apiResId, name: targetCode } },
              }),
            })
          );
        }
        await p.goto("https://lms.mindx.edu.vn/admin/classes");
        return p;
      };

      // 19A: DOM data-class-id=wrongId on row-opened drawer -> MUST REJECT
      const pWrongAttr = await makePage({ drawerAttrId: wrongId });
      let err19A = false;
      try {
        await LmsHelpers.openClassDrawer(pWrongAttr, targetCode);
      } catch {
        err19A = true;
      }
      assert.equal(err19A, true, "DR-19A: Wrong DOM data-class-id must reject even on row click");
      await pWrongAttr.close();

      // 19B: GetClassById without variables returns _id=wrongId with name=targetCode -> MUST REJECT
      const pWrongApi = await makePage({ apiResId: wrongId });
      let err19B = false;
      try {
        await LmsHelpers.openClassDrawer(pWrongApi, targetCode);
      } catch {
        err19B = true;
      }
      assert.equal(err19B, true, "DR-19B: GetClassById wrong _id without variables must reject");
      await pWrongApi.close();

      // 19C: Positive control with matching expectedId -> MUST PASS
      const pRight = await makePage({ drawerAttrId: expectedId, apiResId: expectedId });
      await LmsHelpers.openClassDrawer(pRight, targetCode);
      await pRight.close();
      console.log("[DR-19] PASS (R3-F02): Khóa chặt expectedId từ CSDL trên cả DOM attr lẫn GetClassById không variables.");
    }

    // DR-20 (R3-F03): Pre-opened drawer external click catches 1200ms mismatched GetClassById, while B02 cache preserves #legacy
    {
      const targetCode = "AUDIT_DEEP_13";
      const makePreOpenedPage = async (opts: { apiDelayMs?: number; apiName?: string; noApi?: boolean }) => {
        const p = await browser!.newPage();
        await p.route("https://lms.mindx.edu.vn/**", (route) =>
          route.fulfill({
            status: 200,
            contentType: "text/html",
            body: `<!doctype html><html><body>
              <table><tbody><tr id="row"><td>${targetCode}</td></tr></tbody></table>
              <div id="drawer" class="MuiDrawer-paperAnchorRight" aria-labelledby="class-detail" style="display:none">
                <h2 id="drawer-title">${targetCode}</h2>
                <div role="tablist"><button role="tab" id="tab-10">Comments</button></div>
                <div id="drawer-body"><table><tbody><tr><td>HV</td></tr></tbody></table></div>
              </div>
              <script>
                document.getElementById('row').onclick = () => {
                  document.getElementById('drawer').style.display = 'block';
                  if (${JSON.stringify(!opts.noApi)}) {
                    fetch('https://lms-api.mindx.edu.vn/graphql', {
                      method: 'POST',
                      body: JSON.stringify({ operationName: 'GetClassById' })
                    });
                  }
                };
              </script></body></html>`,
          })
        );
        if (!opts.noApi) {
          await p.route("https://lms-api.mindx.edu.vn/graphql", async (route) => {
            if (opts.apiDelayMs) await new Promise((r) => setTimeout(r, opts.apiDelayMs));
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              headers: { "access-control-allow-origin": "*" },
              body: JSON.stringify({
                data: { class: { _id: "999999999999999999999999", name: opts.apiName || "OTHER_CLASS_99" } },
              }),
            });
          });
        }
        await p.goto("https://lms.mindx.edu.vn/admin/classes");
        return p;
      };

      // 20A (A10): external #row.click() 40ms before openClassDrawer -> 1200ms OTHER_CLASS_99 -> MUST REJECT + 0 leaked listeners
      const pA10 = await makePreOpenedPage({ apiDelayMs: 1200, apiName: "OTHER_CLASS_99" });
      const beforeRes = (pA10 as any).listenerCount("response");
      await pA10.locator("#row").click();
      await new Promise((r) => setTimeout(r, 40));
      let rejectedA10 = false;
      try {
        await LmsHelpers.openClassDrawer(pA10, targetCode);
      } catch {
        rejectedA10 = true;
      }
      assert.equal(rejectedA10, true, "DR-20A: Pre-opened drawer must wait/catch in-flight mismatched GetClassById");
      assert.equal((pA10 as any).listenerCount("response"), beforeRes, "DR-20A: No leaked response listener");
      assert.equal((pA10 as any).listenerCount("request"), 0, "DR-20A: No leaked request listener");
      await pA10.close();

      // 20B (B02 preserved): verified openClassDrawer + DOM mutation #legacy -> 2nd openClassDrawer keeps #legacy fast
      const pB02 = await makePreOpenedPage({ noApi: true });
      await LmsHelpers.openClassDrawer(pB02, targetCode);
      await pB02.locator("#drawer").evaluate((el) => {
        const b = document.createElement("button");
        b.id = "legacy";
        b.textContent = "SPCK";
        el.appendChild(b);
      });
      const t0 = Date.now();
      await LmsHelpers.openClassDrawer(pB02, targetCode);
      const elapsedB02 = Date.now() - t0;
      assert.equal(await pB02.locator("#legacy").count(), 1, "DR-20B: Mutated #legacy button must remain intact");
      assert(elapsedB02 < 800, `DR-20B: Clean cache hit must be fast (<800ms), took ${elapsedB02}ms`);
      await pB02.close();
      console.log("[DR-20] PASS (R3-F03): Chặn Drawer mở sẵn có API lệch đang bay & giữ nguyên B02 #legacy.");
    }

    // DR-21 (R3-F04): route.abort('timedout' | 'failed' | 'aborted') on in-scope GetClassById MUST REJECT
    {
      for (const abortMode of ["timedout", "failed", "aborted"] as const) {
        const p = await browser.newPage();
        await p.route("https://lms.mindx.edu.vn/**", (route) =>
          route.fulfill({
            status: 200,
            contentType: "text/html",
            body: `<!doctype html><html><body>
              <table><tbody><tr id="row"><td>AUDIT_DEEP_13</td></tr></tbody></table>
              <div id="drawer" class="MuiDrawer-paperAnchorRight" aria-labelledby="class-detail" style="display:none">
                <h2 id="drawer-title">AUDIT_DEEP_13</h2>
                <div role="tablist"><button role="tab">Comments</button></div>
                <div id="drawer-body"><table><tbody><tr><td>HV</td></tr></tbody></table></div>
              </div>
              <script>
                document.getElementById('row').onclick = () => {
                  document.getElementById('drawer').style.display = 'block';
                  fetch('https://lms-api.mindx.edu.vn/graphql', {
                    method: 'POST',
                    body: JSON.stringify({ operationName: 'GetClassById' })
                  }).catch(() => {});
                };
              </script></body></html>`,
          })
        );
        await p.route("https://lms-api.mindx.edu.vn/graphql", (route) => route.abort(abortMode));
        await p.goto("https://lms.mindx.edu.vn/admin/classes");
        let rejected = false;
        try {
          await LmsHelpers.openClassDrawer(p, "AUDIT_DEEP_13");
        } catch {
          rejected = true;
        }
        assert.equal(rejected, true, `DR-21: GetClassById abort(${abortMode}) must reject even when DOM renders`);
        assert.equal((p as any).listenerCount("requestfailed"), 0, `DR-21 (${abortMode}): No leaked requestfailed listener`);
        await p.close();
      }
      console.log("[DR-21] PASS (R3-F04): Từ chối cả 3 chế độ đứt mạng timedout/failed/aborted ở tầng API.");
    }

    // DR-22 (R3-F05): Epoch-1 slow streaming body completing late MUST NOT poison Epoch-2 retry
    {
      const httpMod = await import("node:http");
      const targetCode = "R3_ID_13";
      const expectedId = "651111111111111111111113";
      let gqlCount = 0;
      const server = httpMod.createServer((req, res) => {
        const u = req.url || "/";
        if (u.startsWith("/graphql")) {
          gqlCount++;
          const seq = gqlCount;
          res.writeHead(200, {
            "content-type": "application/json",
            "access-control-allow-origin": "*",
          });
          if (seq === 1) {
            // Stream headers immediately, delay mismatched body 5000ms (past Stage B retry!)
            setTimeout(() => {
              if (!res.destroyed) {
                res.end(
                  JSON.stringify({
                    data: { class: { _id: "999999999999999999999999", name: "OTHER_CLASS_99" } },
                  })
                );
              }
            }, 5000);
          } else {
            res.end(JSON.stringify({ data: { class: { _id: expectedId, name: targetCode } } }));
          }
          return;
        }
        res.writeHead(200, { "content-type": "text/html" });
        res.end(`<!doctype html><html><body>
          <table><tbody><tr id="row"><td>${targetCode}</td></tr></tbody></table>
          <div id="drawer" class="MuiDrawer-paperAnchorRight" aria-labelledby="class-detail" style="display:none">
            <h2 id="drawer-title">${targetCode}</h2>
            <div role="tablist"><button role="tab">Comments</button></div>
            <div id="drawer-body"><table><tbody><tr><td>HV</td></tr></tbody></table></div>
          </div>
          <script>
            let clicks = 0;
            document.getElementById('row').onclick = () => {
              clicks++;
              fetch('/graphql', { method: 'POST', body: JSON.stringify({ operationName: 'GetClassById' }) }).catch(() => {});
              if (clicks >= 2) document.getElementById('drawer').style.display = 'block';
            };
          </script></body></html>`);
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as any).port;
      const p = await browser.newPage();
      await p.goto(`http://127.0.0.1:${port}/admin/classes`);
      (p as any).url = () => "https://lms.mindx.edu.vn/admin/classes";
      const t0 = Date.now();
      await LmsHelpers.openClassDrawer(p, targetCode);
      const elapsed = Date.now() - t0;
      assert(elapsed < 4900, `DR-22: Epoch-2 should finish before Epoch-1 5000ms stream completes (${elapsed}ms)`);
      assert.equal(gqlCount, 2, "DR-22: Expected Stage A (req 1) + Stage B (req 2)");
      await new Promise((r) => setTimeout(r, 900));
      await p.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      console.log("[DR-22] PASS (R3-F05): Cách ly thân phản hồi streaming chậm từ lần thử cũ sang lần thử mới.");
    }

    // DR-23 (R3-F06): Unnamed GraphQL notifications/classes errors ignored; unnamed class(...) error rejects
    {
      const setupUnnamedPage = async (queries: Array<{ query: string; status: number; body: any }>) => {
        const p = await browser!.newPage();
        let idx = 0;
        await p.route("https://lms.mindx.edu.vn/**", (route) =>
          route.fulfill({
            status: 200,
            contentType: "text/html",
            body: `<!doctype html><html><body>
              <table><tbody><tr id="row"><td>AUDIT_DEEP_13</td></tr></tbody></table>
              <div id="drawer" class="MuiDrawer-paperAnchorRight" aria-labelledby="class-detail" style="display:none">
                <h2 id="drawer-title">AUDIT_DEEP_13</h2>
                <div role="tablist"><button role="tab">Comments</button></div>
                <div id="drawer-body"><table><tbody><tr><td>HV</td></tr></tbody></table></div>
              </div>
              <script>
                const payloads = ${JSON.stringify(queries.map((q) => q.query))};
                document.getElementById('row').onclick = () => {
                  document.getElementById('drawer').style.display = 'block';
                  for (const q of payloads) {
                    fetch('https://lms-api.mindx.edu.vn/graphql', { method: 'POST', body: JSON.stringify({ query: q }) });
                  }
                };
              </script></body></html>`,
          })
        );
        await p.route("https://lms-api.mindx.edu.vn/graphql", (route) => {
          const item = queries[Math.min(idx++, queries.length - 1)];
          return route.fulfill({
            status: item.status,
            contentType: "application/json",
            headers: { "access-control-allow-origin": "*" },
            body: JSON.stringify(item.body),
          });
        });
        await p.goto("https://lms.mindx.edu.vn/admin/classes");
        return p;
      };

      // 23A (A09): Unnamed notifications + classes list queries returning GraphQL errors -> MUST PASS
      const pIgnore = await setupUnnamedPage([
        { query: "query { notifications { unread } }", status: 200, body: { errors: [{ message: "notif fail" }] } },
        { query: "query { classes { _id name } }", status: 200, body: { errors: [{ message: "list fail" }] } },
      ]);
      await LmsHelpers.openClassDrawer(pIgnore, "AUDIT_DEEP_13");
      await pIgnore.close();

      // 23B (Positive control): Unnamed singular class(...) query failing -> MUST REJECT
      const pFail = await setupUnnamedPage([
        {
          query: 'query { class(id: "651111111111111111111113") { _id name } }',
          status: 200,
          body: { errors: [{ message: "class load error" }] },
        },
      ]);
      let rejected23B = false;
      try {
        await LmsHelpers.openClassDrawer(pFail, "AUDIT_DEEP_13");
      } catch {
        rejected23B = true;
      }
      assert.equal(rejected23B, true, "DR-23B: Unnamed singular class(...) error must reject");
      await pFail.close();
      console.log("[DR-23] PASS (R3-F06): Loại query ẩn danh ngoài phạm vi (notifications/classes), giữ bắt lỗi query class(...) đơn lẻ.");
    }

    console.log("=== TẤT CẢ 23 NHÓM KIỂM THỬ DR-01 .. DR-23 ĐÃ ĐẠT (100% PASS) ===");
  } finally {
    (bm as any).getPage = origGetPage;
    (authService as any).ensureAuthenticated = origEnsureAuth;
    if (browser) await browser.close().catch(() => {});
    try {
      db.close();
    } catch {}
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  }
}

runTests().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
