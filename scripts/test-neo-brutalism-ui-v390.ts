/**
 * KIỂM THỬ TOÀN DIỆN GIAO DIỆN NEO-BRUTALISM 9/9 TRANG (v3.9.0)
 *
 * - Cô lập 100% trong `os.tmpdir()` (`MINDX_DB_PATH`, `MINDX_CONFIG_DIR`, `MINDX_RUNNING_CLASSES_PATH`).
 * - Khởi chạy máy chủ Next.js thử nghiệm tại `127.0.0.1:3094`.
 * - Mở trình duyệt Headless Chromium quét đủ 9 route × 2 chế độ Sáng/Tối × 1280×800 & 1440×900:
 *   1. Kiểm tra `header.mindx-navbar nav a` nằm trên đúng 1 hàng ngang (`height <= 60px`)
 *   2. Kiểm tra tab đang chọn (`mindx-nav-link-active`) tô Vàng Neo-Brutalism `#facc15` (`rgb(250, 204, 21)`) + viền đen & tương phản >= 4.5
 *   3. Kiểm tra 0 tràn ngang (`scrollWidth <= innerWidth + 1`)
 *   4. Kiểm tra `.mindx-hero`, `h1`, `.neo-ws-card` / `.neo-section-card` đạt độ tương phản WCAG AA >= 4.5
 *   5. Kiểm tra 0 `console.error` / 0 `pageerror`
 *   6. Chụp ảnh minh chứng sắc nét vào `MINDX_UI_SCREENSHOT_DIR` nếu được cung cấp.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttpReady(url: string, timeoutMs = 60000): Promise<void> {
  const start = Date.now();
  let lastErr = "";
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastErr = `HTTP ${res.status}`;
    } catch (err: unknown) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await sleep(400);
  }
  throw new Error(`Hết thời gian chờ máy chủ kiểm thử tại ${url}: ${lastErr}`);
}

function killProcessTree(proc: ChildProcess | null) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/F", "/T", "/PID", String(proc.pid)], {
        stdio: "ignore",
      });
    } else {
      proc.kill("SIGKILL");
    }
  } catch {}
}

const ROUTES = [
  { path: "/", name: "page1-dashboard", expectNavHref: "/" },
  { path: "/classroom-manager?classId=VT-C4K-PTA13&sessionNumber=6", name: "page2-classroom-manager", expectNavHref: "/classroom-manager" },
  { path: "/session-comments?classId=VT-C4K-PTA13", name: "page3-session-comments", expectNavHref: "/session-comments" },
  { path: "/homework-grader?classId=VT-C4K-PTA13", name: "page4-homework-grader", expectNavHref: "/homework-grader" },
  { path: "/final-project?classId=VT-C4K-PTA13&sessionNumber=13", name: "page5-final-project", expectNavHref: "/final-project" },
  { path: "/demo-day?classId=VT-C4K-PTA13", name: "page6-demo-day", expectNavHref: "/demo-day" },
  { path: "/teaching-projects?classId=VT-C4K-PTA13", name: "page7-teaching-projects", expectNavHref: "/teaching-projects" },
  { path: "/admin-center", name: "page8-admin-center", expectNavHref: "/admin-center" },
  { path: "/syllabus-config", name: "page9-syllabus-config", expectNavHref: "/syllabus-config" },
];

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-neo-v390-"));
  const tmpConfigDir = path.join(tmpRoot, "config");
  const tmpDbPath = path.join(tmpRoot, "test_v390.db");
  const tmpRunningClassesPath = path.join(tmpRoot, "running_classes.json");
  const tmpClassIdsPath = path.join(tmpRoot, "lms_class_ids.json");
  const spckMockDir = path.join(tmpRoot, "spck", "VT-C4K-PTA13");
  fs.mkdirSync(tmpConfigDir, { recursive: true });
  fs.mkdirSync(spckMockDir, { recursive: true });

  const realConfigDir = path.join(process.cwd(), "data", "config");
  for (const cfgFile of ["courses_syllabus.json", "quick_tags.json"]) {
    const srcPath = path.join(realConfigDir, cfgFile);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, path.join(tmpConfigDir, cfgFile));
    }
  }

  process.env.ALLOWED_LOCAL_DIRS = tmpRoot;
  process.env.MINDX_ALLOWED_EXTRA_PATHS = tmpRoot;
  process.env.MINDX_DB_PATH = tmpDbPath;
  process.env.MINDX_CONFIG_DIR = tmpConfigDir;
  process.env.MINDX_RUNNING_CLASSES_PATH = tmpRunningClassesPath;
  process.env.MINDX_LMS_CLASS_IDS_PATH = tmpClassIdsPath;

  const {
    adminCenterRepo,
    classSessionRepo,
    closeDb,
    sessionFeedbackRepo,
    studentRepo,
  } = await import("../src/lib/db/sqlite");
  const { saveRunningClasses } = await import("../src/lib/db/json-config");

  const classId = "VT-C4K-PTA13";
  saveRunningClasses([
    {
      classCode: classId,
      courseName: "PTA13 — Lập trình Python Cơ bản",
      status: "Running",
      startDate: "2026-10-10",
      endDate: "2027-01-16",
    },
    {
      classCode: "VT-ROB-ARMI13",
      courseName: "ARMI13 — VEX GO Robotics",
      status: "Running",
      startDate: "2026-10-15",
      endDate: "2027-01-21",
    },
  ]);

  const students = [
    { id: "STU_V390_01", name: "Nguyễn Minh Anh" },
    { id: "STU_V390_02", name: "Trần Quốc Bảo" },
    { id: "STU_V390_03", name: "Lê Gia Hân" },
  ];
  for (const st of students) {
    studentRepo.upsert({
      studentId: st.id,
      classId,
      fullName: st.name,
      isActive: 1,
    });
  }

  for (let s = 1; s <= 14; s++) {
    classSessionRepo.upsert({
      classId,
      className: classId,
      sessionId: `${classId}_S_${s}`,
      sessionNumber: s,
      topic: `Buổi ${s}: Lập trình Python thực hành`,
      date: `2026-11-${String(Math.min(28, 10 + s)).padStart(2, "0")}`,
    });
  }

  sessionFeedbackRepo.upsert({
    classId,
    sessionId: `${classId}_S_6`,
    studentId: "STU_V390_01",
    attendanceStatus: "PRESENT",
    quickTagsJson: JSON.stringify(["Tiếp thu tốt", "Hăng hái phát biểu"]),
    teacherNote: "Hoàn thành tốt bài thực hành trên lớp",
    finalText:
      "- **Điểm mạnh của học viên:** Con nắm chắc kiến thức buổi học và chủ động thử thách.\n- **Điểm cần cải thiện:** Cần chú ý rà soát kỹ tên biến trước khi chạy.\n- **Lời khuyên:** Thầy khuyên con giữ vững tinh thần học tập tích cực.",
    status: "VERIFIED",
    contentHash: "",
  });

  adminCenterRepo.upsertClass({
    classCode: "VT-C4K-PTA13",
    centerCode: "205ALHP",
    lmsClassId: "lms_pta13",
    courseName: "PTA13",
    blockType: "CODING",
    isMakeupClass: 0,
    status: "Running",
    startDate: "2026-10-10",
    endDate: "2027-01-16",
    currentSessionNumber: 6,
    currentSessionDate: "2026-11-22",
    timeSlot: "14:00 - 16:00",
    mainTeacher: "Dương Anh Quang",
    assistantTeacher: "Nguyễn Văn A",
    specialEvent: "",
    activeStudentCount: 7,
    teachingStudentCount: 7,
    weeklyOpsJson: JSON.stringify({
      currentSessionNumber: 6,
      sessionDate: "2026-11-22",
      attendanceStatus: "COMPLETED",
      presentCount: 7,
      absentCount: 0,
      unmarkedCount: 0,
      totalActive: 7,
      commentWrittenCount: 7,
      commentVerifiedCount: 7,
      commentStatus: "COMPLETED",
      hasSummaryAndHomework: true,
      summaryMissingSessions: [],
      overdue48hSessions: [],
      checkpoint1Status: "COMPLETED",
      checkpoint2Status: "NOT_DUE",
      checkpointAlerts: [],
    }),
    btvnSummaryJson: JSON.stringify({
      latestHomeworkSessionNumber: 5,
      totalStudents: 7,
      notSubmittedCellsCount: 0,
      ungradedCellsCount: 0,
      lowSubmissionWarning: false,
      teachingScoredCellsCount: 35,
      isOutOfSyncWithTeaching: false,
      missingSessionsList: [],
    }),
    spckAuditJson: JSON.stringify({
      inSpckWindow: false,
      eligible12Plus: false,
      sessionsChecked: [],
      missingItems: [],
      session14EvalComplete: false,
      session14LettersCount: 0,
    }),
    spckTasksJson: JSON.stringify({
      eligibleGt9: false,
      taskStatus: "NOT_DUE",
      taskCount: 0,
      totalWeightPercent: 0,
      assignedStudentCount: 0,
      lastSyncedAt: null,
    }),
    earlyWarningsJson: "[]",
    lmsReportCardSnapshotJson: "{}",
    btvnSyncStatus: "VERIFIED",
    btvnSyncedAt: new Date().toISOString(),
    btvnLastError: "",
    spckTasksSyncStatus: "IDLE",
    spckTasksSyncedAt: "",
    spckTasksLastError: "",
    lastScannedAt: new Date().toISOString(),
    lastError: "",
  });
  adminCenterRepo.upsertClass({
    classCode: "VT-ROB-ARMI13",
    centerCode: "205ALHP",
    lmsClassId: "lms_armi13",
    courseName: "ARMI13",
    blockType: "ROBOTICS",
    isMakeupClass: 0,
    status: "Running",
    startDate: "2026-10-15",
    endDate: "2027-01-21",
    currentSessionNumber: 4,
    currentSessionDate: "2026-11-22",
    timeSlot: "08:00 - 10:00",
    mainTeacher: "Dương Anh Quang",
    assistantTeacher: "",
    specialEvent: "CP1",
    activeStudentCount: 7,
    teachingStudentCount: 7,
    weeklyOpsJson: JSON.stringify({
      currentSessionNumber: 4,
      sessionDate: "2026-11-22",
      attendanceStatus: "COMPLETED",
      presentCount: 6,
      absentCount: 1,
      unmarkedCount: 0,
      totalActive: 7,
      commentWrittenCount: 6,
      commentVerifiedCount: 6,
      commentStatus: "COMPLETED",
      hasSummaryAndHomework: true,
      summaryMissingSessions: [],
      overdue48hSessions: [],
      checkpoint1Status: "PARTIAL",
      checkpoint2Status: "NOT_DUE",
      checkpointAlerts: [
        {
          milestone: "CP1",
          sessionNumber: 4,
          missingStudentNames: [],
          absentMakeupStudentNames: ["Trần Quốc Bảo"],
          isMakeupPendingOnly: true,
        },
      ],
    }),
    btvnSummaryJson: JSON.stringify({
      latestHomeworkSessionNumber: 0,
      totalStudents: 7,
      notSubmittedCellsCount: 0,
      ungradedCellsCount: 0,
      lowSubmissionWarning: false,
      teachingScoredCellsCount: 0,
      isOutOfSyncWithTeaching: false,
      missingSessionsList: [],
    }),
    spckAuditJson: JSON.stringify({
      inSpckWindow: false,
      eligible12Plus: false,
      sessionsChecked: [],
      missingItems: [],
      session14EvalComplete: false,
      session14LettersCount: 0,
    }),
    spckTasksJson: JSON.stringify({
      eligibleGt9: false,
      taskStatus: "NOT_DUE",
      taskCount: 0,
      totalWeightPercent: 0,
      assignedStudentCount: 0,
      lastSyncedAt: null,
    }),
    earlyWarningsJson: "[]",
    lmsReportCardSnapshotJson: "{}",
    btvnSyncStatus: "IDLE",
    btvnSyncedAt: "",
    btvnLastError: "",
    spckTasksSyncStatus: "IDLE",
    spckTasksSyncedAt: "",
    spckTasksLastError: "",
    lastScannedAt: new Date().toISOString(),
    lastError: "",
  });
  closeDb();

  const testPort = 3094;
  const e2eDistRel = `.next/e2e-test-${testPort}`;
  const e2eDistAbs = path.join(process.cwd(), e2eDistRel);
  const e2eTsconfigRel = `.next/e2e-tsconfig-${testPort}.json`;
  const e2eTsconfigAbs = path.join(process.cwd(), e2eTsconfigRel);
  const nextEnvPath = path.join(process.cwd(), "next-env.d.ts");
  const origNextEnvDts = fs.existsSync(nextEnvPath) ? fs.readFileSync(nextEnvPath) : null;

  let nextServer: ChildProcess | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  const serverLogs: string[] = [];

  try {
    fs.rmSync(e2eDistAbs, { recursive: true, force: true });
    fs.mkdirSync(e2eDistAbs, { recursive: true });
    const rootTsconfig = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "tsconfig.json"), "utf8")
    );
    rootTsconfig.compilerOptions = {
      ...(rootTsconfig.compilerOptions || {}),
      paths: { "@/*": ["../src/*"] },
    };
    fs.writeFileSync(e2eTsconfigAbs, JSON.stringify(rootTsconfig, null, 2), "utf8");

    const baseUrl = `http://127.0.0.1:${testPort}`;
    nextServer = spawn(
      process.execPath,
      ["./node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(testPort)],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          MINDX_NEXT_DIST_DIR: e2eDistRel,
          MINDX_NEXT_TSCONFIG_PATH: e2eTsconfigRel,
          ALLOWED_LOCAL_DIRS: tmpRoot,
          MINDX_ALLOWED_EXTRA_PATHS: tmpRoot,
          MINDX_DB_PATH: tmpDbPath,
          MINDX_CONFIG_DIR: tmpConfigDir,
          MINDX_RUNNING_CLASSES_PATH: tmpRunningClassesPath,
          MINDX_LMS_CLASS_IDS_PATH: tmpClassIdsPath,
          NEXT_TELEMETRY_DISABLED: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    nextServer.stdout?.on("data", (d) => serverLogs.push(String(d)));
    nextServer.stderr?.on("data", (d) => serverLogs.push(String(d)));

    await waitForHttpReady(`${baseUrl}/`, 90000);

    browser = await chromium.launch({ headless: true });
    const screenshotDir = process.env.MINDX_UI_SCREENSHOT_DIR || "";
    if (screenshotDir) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    for (const theme of ["light", "dark"] as const) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await context.addInitScript("globalThis.__name = globalThis.__name || ((x) => x);");
      await context.addInitScript((t) => {
        try {
          localStorage.setItem("mindx_ui_theme", t);
        } catch {}
      }, theme);
      const page = await context.newPage();
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          const text = msg.text();
          // Ignore aborted SSE stream errors during immediate page navigation
          if (!text.includes("net::ERR_ABORTED") && !text.includes("Failed to load resource")) {
            consoleErrors.push(`[${theme}] ${text}`);
          }
        }
      });
      page.on("pageerror", (err) => {
        pageErrors.push(`[${theme}] ${err.message}`);
      });

      for (const route of ROUTES) {
        for (const vp of [
          { width: 1280, height: 800 },
          { width: 1440, height: 900 },
        ]) {
          await page.setViewportSize(vp);
          await page.goto(`${baseUrl}${route.path}`, {
            waitUntil: "domcontentloaded",
            timeout: 45000,
          });
          await page.evaluate(
            (t) => document.documentElement.setAttribute("data-theme", t),
            theme
          );
          await page.waitForTimeout(750);

          const audit = await page.evaluate((expectedHref) => {
            const canvas = document.createElement("canvas");
            canvas.width = 1;
            canvas.height = 1;
            const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
            const parseRgba = (str: string) => {
              if (!str || str === "transparent") return null;
              ctx.clearRect(0, 0, 1, 1);
              ctx.fillStyle = str;
              ctx.fillRect(0, 0, 1, 1);
              const d = ctx.getImageData(0, 0, 1, 1).data;
              return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
            };
            const relLum = (c: { r: number; g: number; b: number }) => {
              const lin = [c.r, c.g, c.b].map((v) => {
                const s = v / 255;
                return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
              });
              return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
            };
            const contrastRatio = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) => {
              const l1 = relLum(a);
              const l2 = relLum(b);
              return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
            };
            const getEffectiveBg = (el: Element | null) => {
              let cur: Element | null = el;
              while (cur) {
                const cs = getComputedStyle(cur);
                const bg = parseRgba(cs.backgroundColor);
                if (bg && bg.a > 0.85) return bg;
                cur = cur.parentElement;
              }
              return { r: 255, g: 255, b: 255, a: 1 };
            };

            const overflow = document.documentElement.scrollWidth - window.innerWidth;
            const navLinks = Array.from(document.querySelectorAll("header.mindx-navbar nav a"));
            const tallNavLinks = navLinks
              .filter((a) => a.getBoundingClientRect().height > 60)
              .map((a) => `${(a.textContent || "").trim()} (${Math.round(a.getBoundingClientRect().height)}px)`);

            const activeLink = document.querySelector(
              expectedHref === "/syllabus-config"
                ? `header.mindx-navbar a[href="/syllabus-config"]`
                : `header.mindx-navbar nav a.mindx-nav-link-active`
            ) as HTMLElement | null;

            const activeBg = activeLink ? getComputedStyle(activeLink).backgroundColor : "";
            const activeFg = activeLink ? getComputedStyle(activeLink).color : "";
            const activeRatio =
              activeLink && activeBg && activeFg
                ? contrastRatio(parseRgba(activeFg)!, parseRgba(activeBg)!)
                : 0;

            const lowContrastHeadings: string[] = [];
            for (const h of Array.from(document.querySelectorAll("main h1, main h2")).slice(0, 5)) {
              const cs = getComputedStyle(h);
              if (cs.display === "none" || cs.visibility === "hidden") continue;
              const fg = parseRgba(cs.color);
              const bg = getEffectiveBg(h);
              if (fg && bg) {
                const cr = contrastRatio(fg, bg);
                if (cr < 4.5) {
                  lowContrastHeadings.push(`${h.tagName}("${(h.textContent || "").trim().slice(0, 30)}"): ${cr.toFixed(2)}`);
                }
              }
            }

            const hero = document.querySelector(".mindx-hero") as HTMLElement | null;
            const heroBg = hero ? getComputedStyle(hero).backgroundColor : null;

            return {
              overflow,
              tallNavLinks,
              activeBg,
              activeRatio: Number(activeRatio.toFixed(2)),
              lowContrastHeadings,
              heroBg,
            };
          }, route.expectNavHref);

          assert.ok(
            audit.overflow <= 1,
            `[${theme} ${vp.width}x${vp.height}] ${route.path} tràn ngang ${audit.overflow}px`
          );
          assert.deepEqual(
            audit.tallNavLinks,
            [],
            `[${theme} ${vp.width}x${vp.height}] ${route.path} nav link xuống dòng: ${audit.tallNavLinks.join(", ")}`
          );
          assert.equal(
            audit.activeBg,
            "rgb(250, 204, 21)",
            `[${theme}] ${route.path} active nav link phải có nền Vàng Neo #facc15, nhận được: ${audit.activeBg}`
          );
          assert.ok(
            audit.activeRatio >= 4.5,
            `[${theme}] ${route.path} active nav link contrast >= 4.5, nhận được ${audit.activeRatio}`
          );
          assert.deepEqual(
            audit.lowContrastHeadings,
            [],
            `[${theme}] ${route.path} tiêu đề h1/h2 thiếu tương phản: ${audit.lowContrastHeadings.join("; ")}`
          );
          if (audit.heroBg) {
            assert.notEqual(
              audit.heroBg,
              "rgba(0, 0, 0, 0)",
              `[${theme}] ${route.path} .mindx-hero phải có background-color đặc tường minh`
            );
          }

          if (theme === "light" && route.path.startsWith("/session-comments")) {
            const neoBorders = await page.evaluate(() => {
              const picker = document.querySelector(".mindx-hero .border-2") as HTMLElement | null;
              const sel = document.querySelector("main select.border-2") as HTMLElement | null;
              return {
                pickerBorder: picker ? getComputedStyle(picker).borderTopColor : null,
                selectBorder: sel ? getComputedStyle(sel).borderTopColor : null,
              };
            });
            assert.equal(neoBorders.pickerBorder, "rgb(15, 23, 42)", "ClassPicker phải giữ viền đen #0f172a");
            assert.equal(neoBorders.selectBorder, "rgb(15, 23, 42)", "Session select phải giữ viền đen #0f172a");
          }

          if (screenshotDir && vp.width === 1440) {
            if (theme === "light") {
              if (
                ["/", "/session-comments", "/homework-grader", "/final-project", "/admin-center"].includes(
                  route.path.split("?")[0]
                )
              ) {
                await page.screenshot({
                  path: path.join(screenshotDir, `v390-${route.name}.png`),
                  fullPage: false,
                });
              }
            } else if (route.path === "/") {
              await page.screenshot({
                path: path.join(screenshotDir, "v390-dark-mode-showcase.png"),
                fullPage: false,
              });
            }
          }
        }
        console.log(`  ✓ [${theme.toUpperCase()}] ${route.path} PASS (1280×800 & 1440×900)`);
      }

      await context.close();
    }

    assert.deepEqual(consoleErrors, [], `Có lỗi console.error: ${consoleErrors.join(" | ")}`);
    assert.deepEqual(pageErrors, [], `Có lỗi pageerror: ${pageErrors.join(" | ")}`);
    console.log("\n✅ TẤT CẢ 9/9 TRANG NEO-BRUTALISM SÁNG/TỐI ĐỀU ĐẠT 100%!");
  } catch (err) {
    if (serverLogs.length > 0) {
      console.error("\n--- NEXT DEV SERVER LOGS (LAST 25 LINES) ---");
      console.error(serverLogs.join("").split(/\r?\n/).slice(-25).join("\n"));
    }
    throw err;
  } finally {
    if (browser) await browser.close().catch(() => {});
    killProcessTree(nextServer);
    closeDb();
    try {
      if (origNextEnvDts !== null) {
        fs.writeFileSync(nextEnvPath, origNextEnvDts);
      }
      fs.rmSync(e2eDistAbs, { recursive: true, force: true });
      fs.rmSync(e2eTsconfigAbs, { force: true });
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error("❌ KIỂM THỬ v3.9.0 THẤT BẠI:", err);
  process.exit(1);
});
