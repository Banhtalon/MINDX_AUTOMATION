/**
 * MINDX AUTOMATION BOT - REGRESSION SUITE: SPCK STUDENT PORTAL NO-INFINITE-LOOP (v3.4.3)
 *
 * Verifies that opening `/final-project` NEVER enters a continuous `GET /api/spck/student-portal`
 * polling loop when the Student Portal is stopped, and polls strictly on a 3.5s cadence when open:
 * - [PT-01] Opening `/final-project` with portal OFF fires EXACTLY 1 `GET /api/spck/student-portal`
 *           request and remains at 1 across idle wait, folder path edits, and row expansion.
 * - [PT-02] Switching session (`Buổi 13` -> `Buổi 12`) with portal OFF fires at most 1 check for the
 *           new session and stays completely quiet thereafter.
 * - [PT-03] Clicking `"Mở Link Cho Học Sinh Nộp Bài"` avoids an immediate duplicate GET storm,
 *           polls cleanly every 3.5s with `knownStateVersion`, and stops polling immediately when
 *           clicking `"Đóng Cổng Thu Bài"`.
 * - [PT-04] Mounting `/final-project` when the Student Portal was already running on the server
 *           hydrates status in 1 initial GET (no transition re-fetch loop) and continues on 3.5s interval.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import * as esbuild from "esbuild";
import { chromium } from "playwright";
import "../src/lib/spck/spck-ui-helpers";

const ROOT = process.cwd();

function createTsconfigAliasPlugin(): esbuild.Plugin {
  return {
    name: "tsconfig-path-alias",
    setup(build) {
      build.onResolve({ filter: /^@\// }, (args) => {
        const subPath = args.path.slice(2);
        const targetBase = path.join(ROOT, "src", subPath);
        for (const ext of ["", ".tsx", ".ts", ".jsx", ".js", "/index.ts", "/index.tsx"]) {
          const candidate = targetBase + ext;
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return { path: candidate };
          }
        }
        return { path: targetBase };
      });
    },
  };
}

async function buildFinalProjectBundle(tempDir: string): Promise<string> {
  const pageImportPath = path.join(ROOT, "src/app/final-project/page.tsx");
  const entryFile = path.join(tempDir, "entry.tsx");
  const outFile = path.join(tempDir, "bundle.js");

  fs.writeFileSync(
    entryFile,
    `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import FinalProjectPage from ${JSON.stringify(pageImportPath)};

      const rootEl = document.getElementById("root")!;
      createRoot(rootEl).render(<FinalProjectPage />);
    `,
    "utf8"
  );

  await esbuild.build({
    entryPoints: [entryFile],
    bundle: true,
    outfile: outFile,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
    jsx: "automatic",
    absWorkingDir: ROOT,
    nodePaths: [path.join(ROOT, "node_modules")],
    plugins: [createTsconfigAliasPlugin()],
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  });

  return fs.readFileSync(outFile, "utf8");
}

function buildHarnessHtml(bundleCode: string, initialPortalRunning: boolean): string {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
</head>
<body>
  <div id="root"></div>
  <script>
    window.__portalCalls = [];
    window.__portalState = {
      isRunning: ${initialPortalRunning ? "true" : "false"},
      stateVersion: ${initialPortalRunning ? 7 : 1},
      primaryShareUrl: ${initialPortalRunning ? '"https://demo-portal.trycloudflare.com/?t=tok"' : '""'},
      lanUrl: ${initialPortalRunning ? '"http://192.168.1.10:3050/?t=tok"' : '""'},
      localUrl: ${initialPortalRunning ? '"http://127.0.0.1:3050/?t=tok"' : '""'},
      publicTunnelUrl: ${initialPortalRunning ? '"https://demo-portal.trycloudflare.com/?t=tok"' : '""'},
      tunnelStatus: ${initialPortalRunning ? '"READY"' : '"STOPPED"'},
      tunnelProvider: ${initialPortalRunning ? '"Cloudflare Quick Tunnel"' : '""'},
      autoUploadDrive: true,
      rootFolderPath: "F:\\\\MINDX_SPCK_FINAL\\\\JSB16",
      submissions: []
    };

    const mockClasses = [
      {
        classId: "VT-JSB16",
        className: "VT-JSB16",
        courseName: "Web Developer - Basic",
        totalSessions: 14,
        currentSessionNumber: 13
      }
    ];
    const mockStudents = [
      {
        studentId: "STU_VT-JSB16_01",
        classId: "VT-JSB16",
        fullName: "Dương Đăng Khôi",
        attendanceStatus: "PRESENT",
        isActive: 1
      }
    ];
    const mockRecords = [
      {
        id: 1,
        classId: "VT-JSB16",
        studentId: "STU_VT-JSB16_01",
        localFolderPath: "F:\\\\MINDX_SPCK_FINAL\\\\JSB16\\\\Duong_Dang_Khoi",
        folderName: "Duong_Dang_Khoi",
        matchScore: 100,
        isConfirmedByTeacher: 1,
        projectTitle: "Website Bán Sách",
        thumbnailPath: "F:\\\\MINDX_SPCK_FINAL\\\\JSB16\\\\Duong_Dang_Khoi\\\\thumb.png",
        screenshotsJson: JSON.stringify(["F:\\\\MINDX_SPCK_FINAL\\\\JSB16\\\\Duong_Dang_Khoi\\\\shot1.png"]),
        attachmentsJson: JSON.stringify(["F:\\\\MINDX_SPCK_FINAL\\\\JSB16\\\\Duong_Dang_Khoi\\\\pkg.zip"]),
        youtubeUrlsJson: "[]",
        relatedLinksJson: JSON.stringify([
          { name: "Link chạy thử Web", url: "https://banhtalon.github.io/WEB_PRODUCT_SHOW/VT-JSB16/Duong-Dang-Khoi/" },
          { name: "Kho file/code Google Drive", url: "https://drive.google.com/drive/folders/demo123" }
        ]),
        quickTagsJson: "[]",
        teacherNote: "",
        teacherComment: "Dương Đăng Khôi thể hiện tinh thần học tập nghiêm túc.",
        contentHash: "hash13",
        status: "VERIFIED",
        draftVersion: 1,
        sessionResultsJson: "{}"
      }
    ];

    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      const method = ((init && init.method) || "GET").toUpperCase();

      if (url.includes("/api/spck/list")) {
        const u = new URL(url, "http://127.0.0.1:3000");
        const sess = Number(u.searchParams.get("sessionNumber") || 13);
        return new Response(
          JSON.stringify({
            success: true,
            classes: mockClasses,
            selectedClassId: "VT-JSB16",
            selectedSessionNumber: sess,
            activeSessionNumber: sess,
            defaultFolderPath: "F:\\\\MINDX_SPCK_FINAL\\\\JSB16",
            students: mockStudents,
            records: mockRecords
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url.includes("/api/spck/student-portal")) {
        const bodyObj = init && init.body ? JSON.parse(String(init.body)) : null;
        window.__portalCalls.push({ method, url, at: Date.now(), body: bodyObj });

        if (method === "POST") {
          if (bodyObj && bodyObj.action === "start") {
            window.__portalState = {
              ...window.__portalState,
              isRunning: true,
              stateVersion: window.__portalState.stateVersion + 1,
              primaryShareUrl: "https://demo-portal.trycloudflare.com/?t=tok",
              lanUrl: "http://192.168.1.10:3050/?t=tok",
              localUrl: "http://127.0.0.1:3050/?t=tok",
              publicTunnelUrl: "https://demo-portal.trycloudflare.com/?t=tok",
              tunnelStatus: "READY",
              tunnelProvider: "Cloudflare Quick Tunnel"
            };
          } else if (bodyObj && bodyObj.action === "stop") {
            window.__portalState = {
              ...window.__portalState,
              isRunning: false,
              stateVersion: window.__portalState.stateVersion + 1,
              primaryShareUrl: "",
              publicTunnelUrl: "",
              tunnelStatus: "STOPPED"
            };
          }
          return new Response(
            JSON.stringify({
              success: true,
              portalStatus: { ...window.__portalState, submissions: [] },
              records: mockRecords
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        const u = new URL(url, "http://127.0.0.1:3000");
        const knownVer = u.searchParams.get("knownStateVersion");
        if (knownVer !== null && Number(knownVer) === window.__portalState.stateVersion) {
          return new Response(
            JSON.stringify({
              success: true,
              unchanged: true,
              portalStatus: { ...window.__portalState, submissions: [] }
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            unchanged: false,
            portalStatus: { ...window.__portalState, submissions: [] },
            records: mockRecords
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url.includes("/api/spck/save-draft")) {
        return new Response(JSON.stringify({ success: true, draftVersion: 2 }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    };
  </script>
  <script>${bundleCode}</script>
</body>
</html>`;
}

async function run() {
  console.log("=== BẮT ĐẦU KIỂM THỬ CHỐNG VÒNG LẶP STUDENT PORTAL TRÊN /final-project ===");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-spck-portal-noloop-"));
  const browser = await chromium.launch({ headless: true });

  try {
    const bundleCode = await buildFinalProjectBundle(tempDir);

    // -------------------------------------------------------------------------
    // PT-01, PT-02, PT-03: Portal initially OFF -> Session switch -> Start -> Stop
    // -------------------------------------------------------------------------
    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
      const page = await context.newPage();
      await page.setContent(buildHarnessHtml(bundleCode, false), {
        waitUntil: "domcontentloaded",
      });
      await page.waitForSelector('button:has-text("Chi tiết")');

      // Wait 2,000ms idle (old buggy code fired 80-150 GET requests here!)
      await page.waitForTimeout(2000);
      let getCalls = await page.evaluate(() =>
        (window as any).__portalCalls.filter((c: any) => c.method === "GET")
      );
      assert.equal(
        getCalls.length,
        1,
        `[PT-01] Khi mở /final-project và Cổng thu bài đang tắt, chỉ được gọi GET /api/spck/student-portal đúng 1 lần (thực tế: ${getCalls.length})`
      );

      // Edit folder path & expand student row -> must still be 0 new portal GET calls
      const folderInput = page.locator('input[placeholder*="SPCK"], input[value*="MINDX_SPCK_FINAL"]').first();
      if ((await folderInput.count()) > 0) {
        await folderInput.fill("F:\\MINDX_SPCK_FINAL\\JSB16_TEST");
      }
      await page.locator('button:has-text("Chi tiết")').first().click();
      await page.waitForTimeout(800);
      getCalls = await page.evaluate(() =>
        (window as any).__portalCalls.filter((c: any) => c.method === "GET")
      );
      assert.equal(
        getCalls.length,
        1,
        `[PT-01] Gõ đường dẫn thư mục hoặc mở chi tiết học viên không được sinh thêm GET student-portal (thực tế: ${getCalls.length})`
      );
      console.log("  [PASS] PT-01: Mở trang Upload SPCK đứng yên tuyệt đối sau 1 lần kiểm tra duy nhất.");

      // PT-02: Switch session Buổi 13 -> Buổi 12 while portal OFF
      await page.locator('button:has-text("Buổi 12")').first().click();
      await page.waitForTimeout(1500);
      getCalls = await page.evaluate(() =>
        (window as any).__portalCalls.filter((c: any) => c.method === "GET")
      );
      assert.equal(
        getCalls.length,
        2,
        `[PT-02] Chuyển sang Buổi 12 chỉ kiểm tra đúng 1 lần rồi đứng yên (thực tế tổng cộng: ${getCalls.length})`
      );
      console.log("  [PASS] PT-02: Chuyển buổi học khi Cổng tắt chỉ kiểm tra đúng 1 lần, không bị lặp.");

      // PT-03: Start Portal -> no immediate tight loop -> polls once at 3.5s -> Stop Portal stops polling
      await page.locator('button:has-text("Công cụ Drive & Cổng thu bài")').first().click();
      await page.locator('button:has-text("Mở Link Cho Học Sinh Nộp Bài")').first().click();
      await page.waitForSelector('button:has-text("Đóng Cổng Thu Bài")');

      // Within first 1,500ms after starting, 0 GET burst
      await page.waitForTimeout(1500);
      const getCountAfterStart1500 = await page.evaluate(
        () => (window as any).__portalCalls.filter((c: any) => c.method === "GET").length
      );
      assert.equal(
        getCountAfterStart1500,
        2,
        `[PT-03] Sau khi bấm Mở Cổng 1.5s không được bắn GET liên thanh (thực tế: ${getCountAfterStart1500})`
      );

      // Wait another 2,500ms (~4,000ms total >= 3,500ms interval) -> exactly 1 interval GET with knownStateVersion=2
      await page.waitForTimeout(2500);
      const getCallsAfterInterval = await page.evaluate(() =>
        (window as any).__portalCalls.filter((c: any) => c.method === "GET")
      );
      assert.equal(
        getCallsAfterInterval.length,
        3,
        `[PT-03] Sau ~4.0s khi Cổng đang bật phải chạy đúng 1 nhịp kiểm tra định kỳ 3.5s (thực tế: ${getCallsAfterInterval.length})`
      );
      assert.ok(
        String(getCallsAfterInterval[2].url).includes("knownStateVersion=2"),
        `[PT-03] Nhịp kiểm tra định kỳ phải gửi kèm knownStateVersion=2: ${getCallsAfterInterval[2].url}`
      );

      // Stop portal -> wait 4,200ms -> 0 further GET requests
      await page.locator('button:has-text("Đóng Cổng Thu Bài")').first().click();
      await page.waitForSelector('button:has-text("Mở Link Cho Học Sinh Nộp Bài")');
      const countAtStop = await page.evaluate(
        () => (window as any).__portalCalls.filter((c: any) => c.method === "GET").length
      );
      await page.waitForTimeout(4200);
      const countAfterStopIdle = await page.evaluate(
        () => (window as any).__portalCalls.filter((c: any) => c.method === "GET").length
      );
      assert.equal(
        countAfterStopIdle,
        countAtStop,
        `[PT-03] Sau khi bấm Đóng Cổng Thu Bài phải dừng hẳn kiểm tra định kỳ (trước=${countAtStop}, sau 4.2s=${countAfterStopIdle})`
      );
      console.log("  [PASS] PT-03: Bật Cổng hỏi đúng nhịp 3.5s/lần; Đóng Cổng dừng ngay lập tức (0 request thừa).");
      await context.close();
    }

    // -------------------------------------------------------------------------
    // PT-04: Mount `/final-project` when Portal WAS ALREADY RUNNING on server
    // -------------------------------------------------------------------------
    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
      const page = await context.newPage();
      await page.setContent(buildHarnessHtml(bundleCode, true), {
        waitUntil: "domcontentloaded",
      });
      await page.waitForSelector('button:has-text("Chi tiết")');

      await page.waitForTimeout(1500);
      const initialRunningGets = await page.evaluate(
        () => (window as any).__portalCalls.filter((c: any) => c.method === "GET").length
      );
      assert.equal(
        initialRunningGets,
        1,
        `[PT-04] Khi mở trang lúc Cổng đang bật sẵn chỉ gọi đúng 1 GET khởi tạo trong 1.5s đầu (thực tế: ${initialRunningGets})`
      );

      await page.waitForTimeout(2600);
      const afterFirstTickGets = await page.evaluate(() =>
        (window as any).__portalCalls.filter((c: any) => c.method === "GET")
      );
      assert.equal(
        afterFirstTickGets.length,
        2,
        `[PT-04] Sau chu kỳ 3.5s đầu tiên chỉ tăng đúng 1 GET định kỳ (thực tế: ${afterFirstTickGets.length})`
      );
      assert.ok(
        String(afterFirstTickGets[1].url).includes("knownStateVersion=7"),
        `[PT-04] Nhịp định kỳ gửi đúng knownStateVersion=7: ${afterFirstTickGets[1].url}`
      );
      console.log("  [PASS] PT-04: Mở lại trang khi Cổng đang bật sẵn tự đồng bộ mượt 3.5s/lần, không bị lặp kép.");
      await context.close();
    }

    // -------------------------------------------------------------------------
    // PT-05..PT-08: Adversarial edge cases (F01 delayed start/stop, F02 failed stop,
    //               F03 session roundtrip dedup/abort, F04 hung GET timeout recovery)
    // -------------------------------------------------------------------------
    {
      const anchor = '\n  return (\n    <div className="space-y-6">';
      const exposure =
        '\n  (window as any).__qa = { selectedClassId, selectedSessionNumber, loadingInit, rows, folderPathInput, studentPortalRunning, bannerMessage, workflow, handleClassChange, handleSessionChange };\n';
      const advEntry = path.join(tempDir, "entry-adv.tsx");
      const advOut = path.join(tempDir, "bundle-adv.js");
      fs.writeFileSync(
        advEntry,
        `
          import React from "react";
          import { createRoot } from "react-dom/client";
          import FinalProjectPage from ${JSON.stringify(
            path.join(ROOT, "src/app/final-project/page.tsx")
          )};
          createRoot(document.getElementById("root")!).render(<FinalProjectPage />);
        `,
        "utf8"
      );
      await esbuild.build({
        entryPoints: [advEntry],
        bundle: true,
        outfile: advOut,
        format: "iife",
        platform: "browser",
        target: ["es2020"],
        jsx: "automatic",
        absWorkingDir: ROOT,
        nodePaths: [path.join(ROOT, "node_modules")],
        plugins: [
          {
            name: "expose-qa",
            setup(b) {
              b.onLoad({ filter: /[\\/]src[\\/]app[\\/]final-project[\\/]page\.tsx$/ }, (args) => ({
                contents: fs.readFileSync(args.path, "utf8").replace(anchor, exposure + anchor),
                loader: "tsx",
              }));
            },
          },
          createTsconfigAliasPlugin(),
        ],
        define: { "process.env.NODE_ENV": '"production"' },
      });
      const advBundle = fs.readFileSync(advOut, "utf8");

      const buildAdvHtml = (initialRunning: boolean) => `<!DOCTYPE html>
<html lang="vi"><body><div id="root"></div><script>
  window.__held = [];
  window.__portalCalls = [];
  window.__postMode = "normal";
  window.__getMode = "normal";
  window.__server = { isRunning: ${initialRunning ? "true" : "false"}, classId: "QA_A", stateVersion: 10 };
  const classes = ["QA_A", "QA_B"].map((classId) => ({
    classId, className: classId, courseName: "Web Developer - Basic", totalSessions: 14, currentSessionNumber: 13
  }));
  const students = (classId) => [{ studentId: classId + "_1", classId, fullName: classId + " Student", attendanceStatus: "PRESENT", isActive: 1 }];
  const records = (classId, sess) => [{
    id: classId === "QA_A" ? 1 : 2, classId, studentId: classId + "_1",
    localFolderPath: "C:\\\\SYNTHETIC\\\\" + classId + "\\\\Stu",
    projectTitle: classId + " SESSION " + sess, activeSessionNumber: sess, matchScore: 100, isConfirmedByTeacher: 1,
    thumbnailPath: "", screenshotsJson: "[]", attachmentsJson: "[]", youtubeUrlsJson: "[]", relatedLinksJson: "[]",
    quickTagsJson: "[]", teacherNote: "", teacherComment: classId + " comment", contentHash: "h", status: "VERIFIED", draftVersion: 1, sessionResultsJson: "{}"
  }];
  const portalStatus = (classId) => ({
    ...window.__server,
    isRunning: window.__server.isRunning && window.__server.classId === classId,
    rootFolderPath: "C:\\\\SYNTHETIC\\\\" + window.__server.classId,
    primaryShareUrl: window.__server.isRunning ? "https://synthetic.invalid/?t=1" : "",
    lanUrl: "", localUrl: "", publicTunnelUrl: "", tunnelStatus: window.__server.isRunning ? "READY" : "STOPPED",
    autoUploadDrive: true, submissions: []
  });
  const jsonResp = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
  window.__releaseAll = () => { for (const h of window.__held.splice(0)) h.resolve(jsonResp(h.payload)); };
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const u = new URL(url, "http://127.0.0.1:3000");
    const method = (init.method || "GET").toUpperCase();
    if (u.pathname === "/api/spck/list") {
      const c = u.searchParams.get("classId") || "QA_A";
      const s = Number(u.searchParams.get("sessionNumber") || 13);
      return jsonResp({ success: true, classes, selectedClassId: c, selectedSessionNumber: s, activeSessionNumber: s, students: students(c), defaultFolderPath: "C:\\\\SYNTHETIC\\\\" + c, records: records(c, s) });
    }
    if (u.pathname === "/api/spck/student-portal") {
      const body = init.body ? JSON.parse(String(init.body)) : null;
      const c = (body && body.classId) || u.searchParams.get("classId") || "QA_A";
      const s = Number((body && body.sessionNumber) || u.searchParams.get("sessionNumber") || 13);
      window.__portalCalls.push({ method, classId: c, session: s, url });
      if (method === "POST") {
        if (window.__postMode === "reject") throw new Error("network stop failure");
        if (window.__postMode === "fail-json") return jsonResp({ success: false, error: "stop failed 500" }, 500);
        if (body.action === "start") { window.__server.isRunning = true; window.__server.classId = c; window.__server.stateVersion++; }
        if (body.action === "stop") { window.__server.isRunning = false; window.__server.stateVersion++; }
        const payload = { success: true, portalStatus: portalStatus(c), records: records(c, s) };
        if (window.__postMode === "hold") return new Promise((resolve) => window.__held.push({ resolve, payload, method, classId: c, session: s }));
        return jsonResp(payload);
      }
      const unchanged = u.searchParams.get("knownStateVersion") !== null && Number(u.searchParams.get("knownStateVersion")) === window.__server.stateVersion;
      const payload = { success: true, unchanged, portalStatus: portalStatus(c), ...(!unchanged ? { records: records(c, s) } : {}) };
      if (window.__getMode === "hold") {
        if (window.__getModeOnce) window.__getMode = "normal";
        return new Promise((resolve) => window.__held.push({ resolve, payload, method, classId: c, session: s }));
      }
      return jsonResp(payload);
    }
    return jsonResp({ success: true, records: [] });
  };
</script><script>${advBundle}</script></body></html>`;

      const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });

      // PT-05A (F01): Delayed start response after switching class QA_A -> QA_B & session 13 -> 14, plus delayed stop response
      {
        const page = await context.newPage();
        await page.setContent(buildAdvHtml(false), { waitUntil: "domcontentloaded" });
        await page.waitForFunction(
          () => (window as any).__qa?.selectedClassId === "QA_A" && !(window as any).__qa.loadingInit
        );
        await page.waitForTimeout(80);
        await page.evaluate(() => {
          (window as any).__postMode = "hold";
        });
        await page.locator('button:has-text("Công cụ Drive & Cổng thu bài")').first().click();
        await page.locator('button:has-text("Mở Link Cho Học Sinh Nộp Bài")').first().click();
        await page.waitForTimeout(60);
        await page.locator("select").first().selectOption("QA_B");
        await page.waitForFunction(
          () => (window as any).__qa.selectedClassId === "QA_B" && !(window as any).__qa.loadingInit
        );
        await page.evaluate(() => {
          (window as any).__postMode = "normal";
          (window as any).__releaseAll();
        });
        await page.waitForTimeout(80);
        const snapClassSwitch = await page.evaluate(() => ({
          classId: (window as any).__qa.selectedClassId,
          running: (window as any).__qa.studentPortalRunning,
          folder: (window as any).__qa.folderPathInput,
          rowIds: (window as any).__qa.rows.map((r: any) => r.assignedStudentId),
        }));
        assert.equal(snapClassSwitch.classId, "QA_B");
        assert.equal(snapClassSwitch.running, false);
        assert.equal(snapClassSwitch.folder, "C:\\SYNTHETIC\\QA_B");
        assert.deepEqual(snapClassSwitch.rowIds, ["QA_B_1"]);

        // Delayed start across session 13 -> 14 on QA_B
        await page.evaluate(() => {
          (window as any).__postMode = "hold";
        });
        await page.locator('button:has-text("Mở Link Cho Học Sinh Nộp Bài")').first().click();
        await page.waitForTimeout(60);
        await page.locator('button:has-text("Buổi 14")').first().click();
        await page.waitForFunction(() => (window as any).__qa.selectedSessionNumber === 14);
        await page.evaluate(() => {
          (window as any).__postMode = "normal";
          (window as any).__releaseAll();
        });
        await page.waitForTimeout(80);
        const snapSessSwitch = await page.evaluate(() => ({
          session: (window as any).__qa.selectedSessionNumber,
          titles: (window as any).__qa.rows.map((r: any) => r.projectTitle),
        }));
        assert.equal(snapSessSwitch.session, 14);
        assert.ok(snapSessSwitch.titles.every((t: string) => !t.includes("SESSION 13")));

        // Delayed stop across class switch QA_B -> QA_A
        await page.evaluate(() => {
          (window as any).__postMode = "hold";
        });
        await page.locator('button:has-text("Đóng Cổng Thu Bài")').first().click();
        await page.waitForTimeout(60);
        await page.locator("select").first().selectOption("QA_A");
        await page.waitForFunction(
          () => (window as any).__qa.selectedClassId === "QA_A" && !(window as any).__qa.loadingInit
        );
        await page.evaluate(() => {
          (window as any).__postMode = "normal";
          (window as any).__releaseAll();
        });
        await page.waitForTimeout(80);
        const snapLateStop = await page.evaluate(() => ({
          classId: (window as any).__qa.selectedClassId,
          rowIds: (window as any).__qa.rows.map((r: any) => r.assignedStudentId),
        }));
        assert.equal(snapLateStop.classId, "QA_A");
        assert.deepEqual(snapLateStop.rowIds, ["QA_A_1"]);
        await page.close();
        console.log("  [PASS] PT-05 (F01): Phản hồi mở/đóng Cổng đến muộn sau khi đổi lớp hoặc đổi buổi không ghi đè màn hình mới.");
      }

      // PT-06 (F02): Failed stop (HTTP 500 & transport error) never falsely reports OFF
      {
        const page = await context.newPage();
        await page.setContent(buildAdvHtml(true), { waitUntil: "domcontentloaded" });
        await page.waitForFunction(
          () => (window as any).__qa?.studentPortalRunning === true && !(window as any).__qa.loadingInit
        );
        await page.evaluate(() => {
          (window as any).__postMode = "fail-json";
          return (window as any).__qa.workflow.handleStopStudentPortal();
        });
        await page.waitForTimeout(60);
        let snapFail = await page.evaluate(() => ({
          running: (window as any).__qa.studentPortalRunning,
          bannerType: (window as any).__qa.bannerMessage?.type,
        }));
        assert.equal(snapFail.running, true);
        assert.equal(snapFail.bannerType, "error");

        await page.evaluate(() => {
          (window as any).__postMode = "reject";
          return (window as any).__qa.workflow.handleStopStudentPortal();
        });
        await page.waitForTimeout(60);
        snapFail = await page.evaluate(() => ({
          running: (window as any).__qa.studentPortalRunning,
          bannerType: (window as any).__qa.bannerMessage?.type,
        }));
        assert.equal(snapFail.running, true);
        assert.equal(snapFail.bannerType, "error");
        await page.close();
        console.log("  [PASS] PT-06 (F02): Đóng Cổng thất bại (HTTP 500 / đứt mạng) giữ nguyên trạng thái đang mở và báo lỗi rõ ràng.");
      }

      // PT-07 (F03) & PT-08 (F04): Session roundtrip dedup + 3s GET timeout recovery
      {
        const page = await context.newPage();
        await page.setContent(buildAdvHtml(true), { waitUntil: "domcontentloaded" });
        await page.waitForFunction(
          () => (window as any).__qa?.studentPortalRunning === true && !(window as any).__qa.loadingInit
        );

        // Hold GET on session 12 -> switch 14 -> back to 12: must NOT duplicate held GET for (QA_A, 12)
        await page.evaluate(() => {
          (window as any).__getMode = "hold";
        });
        await page.locator('button:has-text("Buổi 12")').first().click();
        await page.waitForTimeout(80);
        await page.locator('button:has-text("Buổi 14")').first().click();
        await page.waitForTimeout(80);
        await page.locator('button:has-text("Buổi 12")').first().click();
        await page.waitForTimeout(80);
        const heldSameTarget = await page.evaluate(
          () =>
            (window as any).__held.filter(
              (h: any) => h.method === "GET" && h.classId === "QA_A" && h.session === 12
            ).length
        );
        assert.equal(heldSameTarget, 1, `[PT-07] Không được tạo 2 GET trùng mục QA_A::12 (thực tế: ${heldSameTarget})`);
        console.log("  [PASS] PT-07 (F03): Đổi buổi qua lại nhanh không tạo truy vấn GET chồng lên cùng một lớp/buổi.");

        // PT-08 (F04): Let that held GET time out at 3.0s while server flips to OFF, then verify next 3.5s tick discovers OFF!
        await page.evaluate(() => {
          (window as any).__getMode = "normal";
          (window as any).__server.isRunning = false;
          (window as any).__server.stateVersion += 1;
        });
        await page.waitForTimeout(4300);
        const runningAfterTimeoutRecovery = await page.evaluate(
          () => (window as any).__qa.studentPortalRunning
        );
        assert.equal(
          runningAfterTimeoutRecovery,
          false,
          "[PT-08] Sau khi 1 GET bị treo quá hạn 3s, nhịp kế tiếp phải tự phục hồi và nhận diện Cổng đã tắt"
        );
        await page.close();
        console.log("  [PASS] PT-08 (F04): GET bị treo tự hủy sau 3s và tự phục hồi phát hiện trạng thái Cổng mới.");
      }

      await context.close();
    }

    // -------------------------------------------------------------------------
    // PT-09 (F05): S5a-T3 node:vm pre-JSX harness compatibility check
    // -------------------------------------------------------------------------
    {
      const pageSrc = fs.readFileSync(path.join(ROOT, "src/app/final-project/page.tsx"), "utf8");
      const cut = pageSrc.indexOf('\n  return (\n    <div className="space-y-6">');
      assert.ok(cut > 0, "[PT-09] Phải giữ nguyên mốc cắt JSX của page.tsx");
      const clean = (s: string) =>
        s
          .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
          .replace(/\bexport\s+default\s+/g, "")
          .replace(/\bexport\s+/g, "");
      const partial =
        pageSrc.slice(0, cut) +
        "\nreturn {loadClassData,handleClassChange,persistRowDraft,handleGenerateAiComments,handleApproveAndUpload,hydrateRowsFromDb};\n}\nglobalThis.api=FinalProjectPage();";
      const states: any[] = [[], "S5A_TEST_CLASS", [], "D:\\SPCK\\S5A_TEST_CLASS", []];
      let stateIdx = 0;
      const ctx = vm.createContext({
        console,
        fetch: async () => Response.json({ success: true }),
        useState: (initial: any) => {
          const i = stateIdx++;
          if (!(i in states)) states[i] = initial;
          return [
            states[i],
            (v: any) => {
              states[i] = typeof v === "function" ? v(states[i]) : v;
            },
          ];
        },
        useCallback: (f: any) => f,
        useEffect() {},
        useMemo: (f: any) => f(),
      });
      vm.runInContext(stripTypeScriptTypes(clean(partial), { mode: "transform" } as any), ctx);
      assert.equal(typeof ctx.api.loadClassData, "function");
      assert.equal(typeof ctx.api.handleApproveAndUpload, "function");
      console.log("  [PASS] PT-09 (F05): Tương thích 100% node:vm pre-JSX harness (S5a-T3).");
    }

    console.log("=== TẤT CẢ 9 NHÓM KIỂM THỬ PT-01 -> PT-09 ĐỀU PASS 100%! ===");
  } finally {
    await browser.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error("[FAIL] test-spck-portal-idle-no-loop:", err);
  process.exit(1);
});
