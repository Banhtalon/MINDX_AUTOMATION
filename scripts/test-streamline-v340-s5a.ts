/**
 * MINDX AUTOMATION BOT - STAGE S5a VERIFICATION SUITE (v3.4.0)
 * Verifies:
 * - [S5a-T1] Modularization of src/app/final-project/page.tsx into src/components/final-project/*
 * - [S5a-T2] Local-only security: zero secret env vars or server imports in client components
 * - [S5a-T3] Backward compatibility with node:vm pre-JSX harness (exact first 5 useState hooks & return anchor)
 * - [S5a-T4] Zero behavior / zero visual change with REAL compiled Tailwind v4 + globals.css:
 *            Playwright headless DOM innerHTML & PNG screenshot byte-for-byte parity between
 *            pre-S5a (commit 93b77e0) and post-S5a across 9 scenarios:
 *            sess12, sess13, sess14, snapshot-modal, folder-modal,
 *            banner-error (+ close button action), banner-success, banner-warning, busy-uploading
 */

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import tailwindcssPostcss from "@tailwindcss/postcss";
import * as esbuild from "esbuild";
import { chromium } from "playwright";
import postcss from "postcss";
import "../src/lib/spck/spck-ui-helpers";

const ROOT = process.cwd();

const EXPECTED_COMPONENT_FILES = [
  "src/components/final-project/types.ts",
  "src/components/final-project/useSpckWorkflow.ts",
  "src/components/final-project/Step1Header.tsx",
  "src/components/final-project/ToolsDrawer.tsx",
  "src/components/final-project/StudentRow.tsx",
  "src/components/final-project/StudentTable.tsx",
  "src/components/final-project/SubmitBar.tsx",
  "src/components/final-project/Session14Panel.tsx",
  "src/components/final-project/FolderBrowserModal.tsx",
  "src/components/final-project/SnapshotModal.tsx",
  "src/components/final-project/index.ts",
];

function sha256(buf: Buffer | string): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

type ScenarioName =
  | "sess12"
  | "sess13"
  | "sess14"
  | "snapshot-modal"
  | "folder-modal"
  | "banner-error"
  | "banner-success"
  | "banner-warning"
  | "busy-uploading";

const SCENARIOS: readonly ScenarioName[] = [
  "sess12",
  "sess13",
  "sess14",
  "snapshot-modal",
  "folder-modal",
  "banner-error",
  "banner-success",
  "banner-warning",
  "busy-uploading",
] as const;

async function compileRealAppCss(): Promise<string> {
  const globalsCssPath = path.join(ROOT, "src/app/globals.css");
  const rawCss = fs.readFileSync(globalsCssPath, "utf8");
  const result = await postcss([tailwindcssPostcss({ base: ROOT })]).process(rawCss, {
    from: globalsCssPath,
  });
  return result.css;
}

async function runTests() {
  console.log("=== BẮT ĐẦU KIỂM THỬ GIAI ĐOẠN S5a (TÁCH COMPONENT SPCK — ZERO BEHAVIOR CHANGE) ===");

  // =========================================================================
  // [S5a-T1] & [S5a-T2] Kiểm tra cấu trúc file & bảo mật Client Components
  // =========================================================================
  console.log("\n[S5a-T1/T2] Kiểm tra các file trong src/components/final-project/* và quy tắc bảo mật...");
  const allClientFiles = ["src/app/final-project/page.tsx", ...EXPECTED_COMPONENT_FILES];
  const sourceFingerprints: Record<string, string> = {};
  for (const relPath of allClientFiles) {
    const absPath = path.join(ROOT, relPath);
    assert.ok(fs.existsSync(absPath), `File bắt buộc phải tồn tại: ${relPath}`);
    const content = fs.readFileSync(absPath, "utf8");
    sourceFingerprints[relPath] = sha256(content);
    assert.ok(
      !/TEACHING_PASSWORD|LMS_PASSWORD|GEMINI_API_KEY|from\s+["'][^"']*(?:lib\/db|lib\/config|lib\/playwright)/.test(
        content
      ),
      `File client ${relPath} không được chứa biến môi trường nhạy cảm hoặc import thư viện server`
    );
  }
  console.log("  -> PASS [S5a-T1/T2]: Đủ 11 file trong src/components/final-project/* và không rò rỉ biến nhạy cảm.");

  // =========================================================================
  // [S5a-T3] Kiểm tra tương thích ngược với node:vm harness (R32/R38/Phase6)
  // =========================================================================
  console.log("\n[S5a-T3] Kiểm tra tương thích ngược với node:vm pre-JSX harness...");
  const pageSrc = fs.readFileSync(path.join(ROOT, "src/app/final-project/page.tsx"), "utf8");
  const cut = pageSrc.indexOf('\n  return (\n    <div className="space-y-6">');
  assert.ok(cut > 0, "Phải giữ nguyên mốc cắt '\\n  return (\\n    <div className=\"space-y-6\">'");

  const clean = (s: string) =>
    s
      .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
      .replace(/\bexport\s+default\s+/g, "")
      .replace(/\bexport\s+/g, "");

  const partial =
    pageSrc.slice(0, cut) +
    "\nreturn {loadClassData,handleClassChange,persistRowDraft,handleGenerateAiComments,handleApproveAndUpload,hydrateRowsFromDb};\n}\nglobalThis.api=FinalProjectPage();";

  const states: any[] = [
    [],
    "S5A_TEST_CLASS",
    [{ studentId: "S5A_STU_1", classId: "S5A_TEST_CLASS", fullName: "Nguyễn Văn An", isActive: 1 }],
    "D:\\SPCK\\S5A_TEST_CLASS",
    [],
    false,
    false,
    false,
    false,
    false,
    null,
  ];
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
  assert.strictEqual(typeof ctx.api.loadClassData, "function");
  assert.strictEqual(typeof ctx.api.handleClassChange, "function");
  assert.strictEqual(typeof ctx.api.persistRowDraft, "function");
  assert.strictEqual(typeof ctx.api.handleGenerateAiComments, "function");
  assert.strictEqual(typeof ctx.api.handleApproveAndUpload, "function");
  assert.strictEqual(typeof ctx.api.hydrateRowsFromDb, "function");
  console.log("  -> PASS [S5a-T3]: node:vm harness thực thi FinalProjectPage() thành công.");

  // =========================================================================
  // [S5a-T4] Đối chiếu DOM innerHTML & ảnh chụp màn hình Playwright (Before vs After S5a)
  // =========================================================================
  console.log("\n[S5a-T4] Biên dịch CSS thật (Tailwind v4 + globals.css), đóng gói esbuild & chụp màn hình 9 kịch bản...");
  const compiledAppCss = await compileRealAppCss();
  assert.ok(compiledAppCss.includes(".mindx-hero") && compiledAppCss.length > 10000, "Phải biên dịch được CSS thật của ứng dụng");

  const tempBuildDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-s5a-compare-"));
  const screenshotDir = path.join(ROOT, "docs", "audits", "v340", "s5a-screenshots");
  fs.mkdirSync(screenshotDir, { recursive: true });

  const preS5aSource = execSync("git show 93b77e0:src/app/final-project/page.tsx", {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const preS5aEntryFile = path.join(tempBuildDir, "pre-s5a-page.tsx");
  fs.writeFileSync(preS5aEntryFile, preS5aSource, "utf8");

  const postS5aRoot = path.join(tempBuildDir, "post-s5a");
  const s5aCommitFingerprints: Record<string, string> = {};
  for (const relPath of allClientFiles) {
    const fileContent = execSync(`git show a78c5a1:${relPath}`, {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    s5aCommitFingerprints[relPath] = sha256(fileContent);
    const destPath = path.join(postS5aRoot, relPath);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, fileContent, "utf8");
  }

  const harnessEntry = (pageImportPath: string) => `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import FinalProjectPage from ${JSON.stringify(pageImportPath)};

    const rootEl = document.getElementById("root")!;
    const root = createRoot(rootEl);
    root.render(<FinalProjectPage />);
  `;

  const preHarnessFile = path.join(tempBuildDir, "entry-before.tsx");
  const postHarnessFile = path.join(tempBuildDir, "entry-after.tsx");
  fs.writeFileSync(preHarnessFile, harnessEntry(preS5aEntryFile), "utf8");
  fs.writeFileSync(
    postHarnessFile,
    harnessEntry(path.join(postS5aRoot, "src/app/final-project/page.tsx")),
    "utf8"
  );

  const createAliasPlugin = (overrideSrcRoot?: string): esbuild.Plugin => ({
    name: "tsconfig-path-alias",
    setup(build) {
      build.onResolve({ filter: /^@\// }, (args) => {
        const subPath = args.path.slice(2);
        const searchRoots = overrideSrcRoot
          ? [path.join(overrideSrcRoot, "src"), path.join(ROOT, "src")]
          : [path.join(ROOT, "src")];
        for (const srcBase of searchRoots) {
          const targetBase = path.join(srcBase, subPath);
          for (const ext of ["", ".tsx", ".ts", ".jsx", ".js", "/index.ts", "/index.tsx"]) {
            if (fs.existsSync(targetBase + ext) && fs.statSync(targetBase + ext).isFile()) {
              return { path: targetBase + ext };
            }
          }
        }
        return { path: path.join(ROOT, "src", subPath) };
      });
    },
  });

  const buildBundle = async (entryPoint: string, outName: string, overrideSrcRoot?: string) => {
    const outFile = path.join(tempBuildDir, outName);
    await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      outfile: outFile,
      format: "iife",
      platform: "browser",
      target: ["es2020"],
      jsx: "automatic",
      absWorkingDir: ROOT,
      nodePaths: [path.join(ROOT, "node_modules")],
      plugins: [createAliasPlugin(overrideSrcRoot)],
      define: {
        "process.env.NODE_ENV": '"production"',
      },
    });
    return fs.readFileSync(outFile, "utf8");
  };

  const beforeBundleJs = await buildBundle(preHarnessFile, "bundle-before.js");
  const afterBundleJs = await buildBundle(postHarnessFile, "bundle-after.js", postS5aRoot);

  const buildMockedHtmlPage = (bundleCode: string, scenarioMode: ScenarioName) => `<!DOCTYPE html>
<html lang="vi" class="dark">
<head>
  <meta charset="utf-8" />
  <style>${compiledAppCss}</style>
  <style>
    body { margin: 0; padding: 24px; background: #020617; color: #f8fafc; font-family: system-ui, sans-serif; }
    *, *::before, *::after { transition: none !important; animation: none !important; }
  </style>
</head>
<body spellcheck="false">
  <div id="root"></div>
  <script>
    const SCENARIO = ${JSON.stringify(scenarioMode)};
    const mockClasses = [
      { classId: "VT-C4K-JSB15", className: "Lớp Web JSB15", studentCount: 2, spckCount: 2, latestSessionNumber: 14, eligibleForSpck: true }
    ];
    const mockStudents = [
      { studentId: "STU_01", classId: "VT-C4K-JSB15", fullName: "Nguyễn Minh Khôi", isActive: 1 },
      { studentId: "STU_02", classId: "VT-C4K-JSB15", fullName: "Trần Bảo Ngọc", isActive: 1 }
    ];
    const mockRecords = [
      {
        classId: "VT-C4K-JSB15",
        studentId: "STU_01",
        localFolderPath: "D:\\\\SPCK\\\\VT-C4K-JSB15\\\\01_Nguyen_Minh_Khoi",
        matchScore: 1,
        isConfirmedByTeacher: 1,
        projectTitle: "SPCK Nguyễn Minh Khôi - Buổi 13",
        thumbnailPath: "D:\\\\SPCK\\\\VT-C4K-JSB15\\\\01_Nguyen_Minh_Khoi\\\\thumb.png",
        screenshotsJson: JSON.stringify(["D:\\\\SPCK\\\\VT-C4K-JSB15\\\\01_Nguyen_Minh_Khoi\\\\screen1.png"]),
        attachmentsJson: JSON.stringify(["D:\\\\SPCK\\\\VT-C4K-JSB15\\\\01_Nguyen_Minh_Khoi\\\\index.html"]),
        youtubeUrlsJson: JSON.stringify(["https://youtu.be/demo1"]),
        relatedLinksJson: JSON.stringify([
          { name: "Web chạy thử (Live)", url: "https://banhtalon.github.io/WEB_PRODUCT_SHOW/khoi/" },
          { name: "Sản phẩm trên Google Drive", url: "https://drive.google.com/drive/folders/demo1" }
        ]),
        quickTagsJson: JSON.stringify(["Code chạy tốt", "Giao diện đẹp"]),
        teacherNote: "Khôi làm tốt.",
        teacherComment: "Khôi hoàn thành tốt phần giao diện và bố cục trang web.",
        contentHash: "abcdef1234567890",
        status: "APPROVED",
        verifiedAt: "2026-10-30 10:00:00",
        draftVersion: 2,
        hasNewerSharedResources: true,
        thumbnailInspection: { exists: true, isDefaultLogo: false, width: 1280, height: 720, aspectCategory: "16:9", label: "Ảnh SP 16:9 (1280x720)" },
        sessionResultsJson: JSON.stringify({
          "12": {
            status: "VERIFIED",
            verifiedAt: "2026-10-23 10:00:00",
            submittedContentHash: "abcdef1234567890",
            lastVerifiedSnapshot: {
              sessionNumber: 12,
              capturedAt: "2026-10-23 10:00:00",
              contentHash: "abcdef1234567890",
              projectTitle: "SPCK Nguyễn Minh Khôi - Buổi 12",
              teacherComment: "Đã hoàn thành ý tưởng Buổi 12.",
              thumbnailPath: "D:\\\\SPCK\\\\VT-C4K-JSB15\\\\01_Nguyen_Minh_Khoi\\\\thumb.png",
              screenshots: ["D:\\\\SPCK\\\\VT-C4K-JSB15\\\\01_Nguyen_Minh_Khoi\\\\screen1.png"],
              attachments: ["D:\\\\SPCK\\\\VT-C4K-JSB15\\\\01_Nguyen_Minh_Khoi\\\\index.html"],
              youtubeUrls: ["https://youtu.be/demo1"],
              relatedLinks: [{ name: "Kho file Drive", url: "https://drive.google.com/drive/folders/demo1" }]
            }
          }
        })
      },
      {
        classId: "VT-C4K-JSB15",
        studentId: "STU_02",
        localFolderPath: "D:\\\\SPCK\\\\VT-C4K-JSB15\\\\02_Tran_Bao_Ngoc",
        matchScore: 0.85,
        isConfirmedByTeacher: 0,
        projectTitle: "SPCK Trần Bảo Ngọc - Buổi 13",
        thumbnailPath: "D:\\\\MINDX\\\\default-spck-thumbnail.png",
        screenshotsJson: "[]",
        attachmentsJson: JSON.stringify(["D:\\\\SPCK\\\\VT-C4K-JSB15\\\\02_Tran_Bao_Ngoc\\\\main.py"]),
        youtubeUrlsJson: "[]",
        relatedLinksJson: "[]",
        quickTagsJson: "[]",
        teacherNote: "",
        teacherComment: "",
        contentHash: "",
        status: "DRAFT",
        draftVersion: 1,
        thumbnailInspection: { exists: true, isDefaultLogo: true, width: 800, height: 800, aspectCategory: "DEFAULT_LOGO", label: "Logo MindX mặc định" }
      }
    ];
    const mockS14Evals = [
      {
        classId: "VT-C4K-JSB15",
        studentId: "STU_01",
        fullName: "Nguyễn Minh Khôi",
        callName: "Minh Khôi",
        demoScores: { algorithm: 1.4, creativity: 0.9, communication: 0.45, problemSolving: 0.9, computerSkills: 0.95 },
        demoTotalScore: 4.6,
        competencyScores: {
          computationalThinking: 4,
          creativity: 5,
          communication: 4,
          collaboration: 4,
          problemSolving: 4,
          computerUsage: 5,
          programmingKnowledge: 4,
          learningAttitude: 5,
          debuggingSkill: 4
        },
        competencyTotalScore: 4.3,
        quickTags: ["Sản phẩm hoàn thiện tốt"],
        teacherNote: "Thuyết trình tự tin.",
        learnedFromMindx: "Thư tổng kết khóa học cho Minh Khôi.\\nĐiểm Demo: 4.6 điểm\\nĐiểm Năng lực: 4.3 điểm",
        suggestionsFromMindx: "Cần rèn luyện thêm kỹ năng quản lý thời gian.",
        futureDirection: "Tiếp tục học lên khóa JSA.",
        awardRanking: "Giải Nhất",
        contentHash: "hashs14",
        status: "APPROVED",
        draftVersion: 1
      }
    ];

    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/api/spck/list")) {
        const sess = SCENARIO === "sess14" ? 14 : SCENARIO === "sess12" ? 12 : 13;
        return new Response(JSON.stringify({
          success: true,
          classes: mockClasses,
          selectedClassId: "VT-C4K-JSB15",
          selectedSessionNumber: sess,
          activeSessionNumber: sess,
          students: mockStudents,
          records: mockRecords,
          session14TagLabels: ["Thuyết trình tự tin", "Sản phẩm hoàn thiện tốt"],
          demoSheetInfo: {
            spreadsheetUrl: "https://docs.google.com/spreadsheets/d/demo-sheet",
            sheetTitle: "Bảng chấm điểm buổi Demo - VT-C4K-JSB15",
            demoDate: "2026-10-30"
          }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/api/spck/student-portal")) {
        return new Response(JSON.stringify({
          success: true,
          portalStatus: {
            isRunning: SCENARIO === "sess13" || SCENARIO === "banner-success",
            primaryShareUrl: "https://demo-portal.trycloudflare.com/?t=tok123",
            lanUrl: "http://192.168.1.10:3050/?t=tok123",
            localUrl: "http://127.0.0.1:3050/?t=tok123",
            publicTunnelUrl: "https://demo-portal.trycloudflare.com/?t=tok123",
            tunnelStatus: "READY",
            tunnelProvider: "Cloudflare Quick Tunnel",
            autoUploadDrive: true,
            rootFolderPath: SCENARIO === "banner-warning" ? "" : "D:\\\\SPCK\\\\VT-C4K-JSB15",
            submissions: [
              { studentId: "STU_01", fullName: "Nguyễn Minh Khôi", filesCount: 3, driveStatus: "UPLOADED", driveFolderUrl: "https://drive.google.com/drive/folders/demo1" }
            ]
          }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/api/spck/approve")) {
        if (SCENARIO === "busy-uploading") {
          return new Promise(() => {}); // Keep uploading=true to capture Active Processing Lock Banner
        }
        return new Response(JSON.stringify({
          success: true,
          approvedCount: 1,
          results: [{ studentId: "STU_01", contentHash: "abcdef1234567890", status: "APPROVED" }]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/api/spck/session14-eval")) {
        return new Response(JSON.stringify({
          success: true,
          records: mockS14Evals
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/api/spck/browse-folder")) {
        if (SCENARIO === "banner-error") {
          return new Response(JSON.stringify({
            success: false,
            error: "S5A_SYNTHETIC_DIRECTORY_ERROR: Không thể mở thư mục"
          }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({
          success: true,
          currentPath: "D:\\\\SPCK\\\\VT-C4K-JSB15",
          parentPath: "D:\\\\SPCK",
          drives: ["C:\\\\", "D:\\\\"],
          quickLinks: [{ label: "Desktop", path: "C:\\\\Users\\\\Teacher\\\\Desktop" }],
          directories: [
            { name: "01_Nguyen_Minh_Khoi", path: "D:\\\\SPCK\\\\VT-C4K-JSB15\\\\01_Nguyen_Minh_Khoi" },
            { name: "02_Tran_Bao_Ngoc", path: "D:\\\\SPCK\\\\VT-C4K-JSB15\\\\02_Tran_Bao_Ngoc" }
          ]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/api/spck/save-draft")) {
        return new Response(JSON.stringify({
          success: true,
          draftVersion: 3
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/api/spck/upload-drive")) {
        if (SCENARIO === "banner-warning") {
          return new Response(JSON.stringify({
            success: true,
            results: [{ studentId: "STU_01", status: "FAILED", error: "Drive quota warning" }]
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
      }
      if (url.includes("/api/spck/upload-lms") || url.includes("/api/spck/submit")) {
        if (SCENARIO === "busy-uploading") {
          return new Promise(() => {}); // Keep uploading=true to capture Active Processing Lock Banner
        }
      }
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
  </script>
  <script>${bundleCode}</script>
</body>
</html>`;

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-gpu", "--font-render-hinting=none"],
  });
  const parityManifest: Record<string, any> = {
    baselineCommit: "93b77e0098d45becd38ac377e473534682e9d98c",
    sourceFingerprints: s5aCommitFingerprints,
    scenarios: {},
  };

  try {
    for (const scenario of SCENARIOS) {
      const renderAndCapture = async (bundleCode: string, label: "before" | "after") => {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1800 } });
        const page = await context.newPage();
        await page.setContent(buildMockedHtmlPage(bundleCode, scenario), {
          waitUntil: "networkidle",
        });
        await page.waitForSelector("text=Bước 1 /");
        await page.waitForSelector('button:has-text("Chi tiết ▾")');

        const domClick = async (selector: string) => {
          await page.locator(selector).first().evaluate((el: HTMLElement) => el.click());
        };

        if (scenario === "sess12") {
          await page.waitForSelector("text=1B. Chọn Buổi Nộp LMS (Giai đoạn 1)");
          await domClick('button:has-text("Công cụ Drive & Cổng thu bài")');
          await domClick('button:has-text("Chi tiết ▾")');
          await page.waitForSelector("text=Chỉnh sửa chi tiết Buổi 12");
        } else if (scenario === "sess13") {
          await domClick('button:has-text("Chi tiết ▾")');
          await page.waitForSelector("text=Chỉnh sửa chi tiết Buổi 13");
        } else if (scenario === "sess14") {
          await page.waitForSelector("text=Bước 4 / 4 — Riêng Buổi 14");
          await domClick('button:has-text("Chi tiết Điểm & Thư 3 phần ▼")');
          await page.waitForSelector("text=Phần 1: Learned From Mindx");
        } else if (scenario === "snapshot-modal") {
          await domClick('button:has-text("Xem bản đã nộp")');
          await page.waitForSelector("text=Bằng Chứng Bản Đã Nộp — Buổi 12");
        } else if (scenario === "folder-modal") {
          await domClick('button:has-text("Chọn...")');
          await page.waitForSelector("text=Chọn Thư Mục SPCK Trên Máy Tính");
          await page.waitForSelector("text=01_Nguyen_Minh_Khoi");
        } else if (scenario === "banner-error") {
          await domClick('button:has-text("Chọn...")');
          await page.waitForSelector("text=S5A_SYNTHETIC_DIRECTORY_ERROR");
        } else if (scenario === "banner-success") {
          await domClick('button:has-text("Copy Link Gửi Học Sinh")');
          await page.waitForSelector("text=Đã copy Link nộp bài cho học sinh");
        } else if (scenario === "banner-warning") {
          await domClick('button:has-text("Quét & Khớp HV")');
          await page.waitForSelector("text=Vui lòng chọn Lớp học và nhập đường dẫn thư mục SPCK trên máy tính.");
        } else if (scenario === "busy-uploading") {
          await domClick('button:has-text("Nộp riêng B.13")');
          await page.waitForSelector("text=Các nút thao tác xung đột đang tạm khóa cho đến khi hoàn tất");
        }

        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
          document.documentElement.style.display = "none";
          void document.documentElement.offsetHeight;
          document.documentElement.style.display = "";
        });
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            )
        );

        const innerHtml = await page.locator("#root").innerHTML();
        const screenshotPath = path.join(screenshotDir, `${label}-s5a-${scenario}.png`);
        const pngBuffer = await page.screenshot({
          path: screenshotPath,
          fullPage: true,
          animations: "disabled",
        });
        if (scenario === "sess13") {
          fs.writeFileSync(path.join(screenshotDir, `${label}-s5a.png`), pngBuffer);
        }

        // Verify close button on banner-error
        if (scenario === "banner-error") {
          await page.locator('button:has-text("Đóng")').first().click();
          const errCount = await page.locator("text=S5A_SYNTHETIC_DIRECTORY_ERROR").count();
          assert.strictEqual(errCount, 0, "Nút 'Đóng' trên Status Alert Banner phải xóa thông báo");
        }

        await context.close();
        return { innerHtml, pngBuffer, screenshotPath };
      };

      const beforeRes = await renderAndCapture(beforeBundleJs, "before");
      const afterRes = await renderAndCapture(afterBundleJs, "after");

      assert.strictEqual(
        afterRes.innerHtml,
        beforeRes.innerHtml,
        `[S5a-T4] DOM innerHTML của kịch bản '${scenario}' phải khớp 100% giữa trước và sau khi tách component`
      );
      assert.strictEqual(
        Buffer.compare(beforeRes.pngBuffer, afterRes.pngBuffer),
        0,
        `[S5a-T4] Ảnh chụp màn hình PNG của kịch bản '${scenario}' phải giống hệt 100% từng byte`
      );
      const pngSha = sha256(afterRes.pngBuffer);
      const htmlSha = sha256(afterRes.innerHtml);
      parityManifest.scenarios[scenario] = {
        htmlSha256: htmlSha,
        pngSha256: pngSha,
        bytes: afterRes.pngBuffer.length,
        exactByteMatch: true,
      };
      console.log(
        `  -> PASS [S5a-T4] (${scenario}): DOM innerHTML & PNG screenshot khớp 100% (PNG SHA-256: ${pngSha.slice(
          0,
          16
        )}...)`
      );
    }

    fs.writeFileSync(
      path.join(screenshotDir, "parity-manifest.json"),
      JSON.stringify(parityManifest, null, 2),
      "utf8"
    );
  } finally {
    await browser.close();
    fs.rmSync(tempBuildDir, { recursive: true, force: true });
  }

  console.log("\n🎉 TẤT CẢ CÁC BÀI KIỂM THỬ GIAI ĐOẠN S5a (9 KỊCH BẢN + CSS THẬT) ĐỀU PASS 100%!");
}

runTests().catch((err) => {
  console.error("❌ LỖI KIỂM THỬ S5a:", err);
  process.exit(1);
});
