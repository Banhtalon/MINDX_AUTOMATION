// @ts-nocheck -- independent audit artifact
/**
 * MINDX AUTOMATION BOT - STAGE S5b VERIFICATION SUITE (v3.4.0)
 * Verifies:
 * - [S5b-T1] S5b.1 + S5b.2: Auto-run preparation tools toggle (default ON) by class type (JSB / SB / App-Robotics) + step progress + approval demotion confirm guard
 * - [S5b-T2] S5b.3: Single place for tools in ToolsDrawer; StudentRow hides normal-state duplicate tool buttons and only shows "🔄 Thử lại" when a tool fails
 * - [S5b-T3] S5b.4 + S5b.5: Session 14 unified flow ("✨ AI soạn tất cả (SPCK + Thư 3 phần)", "🚀 Nộp Buổi 14 đầy đủ (Sản phẩm + Đánh giá)" with independent retry, 2-tab StudentRow editor, no duplicate student list in Session14Panel, auto-import Demo scores)
 * - [S5b-T4] S5b.6 + S5b.7 + S5b.8: Session 13 auto-selects unsubmitted students + "nêu tiến bộ so với Buổi 12" in Gemini prompt, zero "{false &&" blocks, and strict title/comment/thumbnail guardrails
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import tailwindcssPostcss from "@tailwindcss/postcss";
import * as esbuild from "esbuild";
import { chromium } from "playwright";
import postcss from "postcss";
import {
  formatSpckSessionTitle,
  isDefaultSpckProductTitle,
  studentRepo,
  stripSpckSessionSuffix,
  validateSpckTitleLength,
} from "../../../../src/lib/db/sqlite";
import { SpckCommentGenerator } from "../../../../src/lib/gemini/spck-comment";
import { DEFAULT_SPCK_THUMBNAIL_PATH } from "../../../../src/lib/local-files/spck-scanner";

const ROOT = process.cwd();

async function compileRealAppCss(): Promise<string> {
  const globalsCssPath = path.join(ROOT, "src/app/globals.css");
  const rawCss = fs.readFileSync(globalsCssPath, "utf8");
  const result = await postcss([tailwindcssPostcss({ base: ROOT })]).process(rawCss, {
    from: globalsCssPath,
  });
  return result.css;
}


async function runTests() {
  const compiledAppCss = await compileRealAppCss();
  const tempBuildDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-s5b-ui-"));

  const entryFile = path.join(tempBuildDir, "entry-s5b.tsx");
  fs.writeFileSync(
    entryFile,
    `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import FinalProjectPage from ${JSON.stringify(
      path.join(ROOT, "src/app/final-project/page.tsx")
    )};

    const rootEl = document.getElementById("root")!;
    const root = createRoot(rootEl);
    root.render(<FinalProjectPage />);
  `,
    "utf8"
  );

  const aliasPlugin: esbuild.Plugin = {
    name: "tsconfig-path-alias",
    setup(build) {
      build.onResolve({ filter: /^@\// }, (args) => {
        const targetBase = path.join(ROOT, "src", args.path.slice(2));
        for (const ext of ["", ".tsx", ".ts", ".jsx", ".js", "/index.ts", "/index.tsx"]) {
          if (fs.existsSync(targetBase + ext) && fs.statSync(targetBase + ext).isFile()) {
            return { path: targetBase + ext };
          }
        }
        return { path: targetBase };
      });
    },
  };

  const outFile = path.join(tempBuildDir, "bundle-s5b.js");
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
    plugins: [aliasPlugin],
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  });
  const bundleCode = fs.readFileSync(outFile, "utf8");

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1800 } });
    let page = await context.newPage();
    page.on("pageerror", (err) => {
      console.error("[PAGEERROR]", err);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.error("[CONSOLE ERROR]", msg.text());
      }
    });

    const html = `<!DOCTYPE html>
<html lang="vi" class="dark">
<head>
  <meta charset="utf-8" />
  <style>${compiledAppCss}</style>
</head>
<body class="bg-slate-950 text-slate-100 p-6">
  <div id="root"></div>
  <script>
    window.__apiCalls = [];
    window.__confirmCalls = [];
    window.__confirmNextResult = true;
    window.__simulateDriveStudentFail = false;
    window.__simulateS14EvalStudentFail = false;

    window.confirm = (msg) => {
      window.__confirmCalls.push(String(msg));
      return window.__confirmNextResult;
    };

    const mockClasses = [
      { classId: "VT-C4K-JSB15", className: "Lớp Web JSB15", studentCount: 2, spckCount: 2, latestSessionNumber: 13, eligibleForSpck: true },
      { classId: "VT-C4K-SB28", className: "Lớp Scratch SB28", studentCount: 2, spckCount: 2, latestSessionNumber: 12, eligibleForSpck: true },
      { classId: "VT-ROB-B09", className: "Lớp Robotics B09", studentCount: 2, spckCount: 2, latestSessionNumber: 12, eligibleForSpck: true }
    ];

    const mockStudentsByClass = {
      "VT-C4K-JSB15": [
        { studentId: "STU_01", classId: "VT-C4K-JSB15", fullName: "Nguyễn Minh Khôi", isActive: 1 },
        { studentId: "STU_02", classId: "VT-C4K-JSB15", fullName: "Trần Bảo Ngọc", isActive: 1 }
      ],
      "VT-C4K-SB28": [
        { studentId: "STU_01", classId: "VT-C4K-SB28", fullName: "Nguyễn Minh Khôi", isActive: 1 }
      ],
      "VT-ROB-B09": [
        { studentId: "STU_01", classId: "VT-ROB-B09", fullName: "Nguyễn Minh Khôi", isActive: 1 }
      ]
    };

    const buildScannedRecord = (classId, studentId, fullName, statusOverride) => ({
      classId,
      studentId,
      localFolderPath: "D:\\\\SPCK\\\\" + classId + "\\\\01_" + studentId,
      matchScore: 1,
      isConfirmedByTeacher: 1,
      projectTitle: "Dự án " + fullName,
      thumbnailPath: "D:\\\\SPCK\\\\" + classId + "\\\\01_" + studentId + "\\\\thumb.png",
      screenshotsJson: JSON.stringify(["D:\\\\SPCK\\\\" + classId + "\\\\01_" + studentId + "\\\\screen1.png"]),
      attachmentsJson: JSON.stringify(["D:\\\\SPCK\\\\" + classId + "\\\\01_" + studentId + "\\\\index.html"]),
      youtubeUrlsJson: JSON.stringify([]),
      relatedLinksJson: JSON.stringify([
        { name: "Sản phẩm trên Google Drive", url: "https://drive.google.com/drive/folders/" + studentId },
        { name: "Web chạy thử (Live)", url: "https://banhtalon.github.io/WEB_PRODUCT_SHOW/" + studentId }
      ]),
      quickTagsJson: JSON.stringify(["Hoàn thành tốt sản phẩm cuối khóa"]),
      teacherNote: "Làm bài tốt",
      teacherComment: "Trong quá trình thực hiện dự án, con đã chủ động hoàn thiện đầy đủ tính năng và giao diện rõ ràng.",
      contentHash: "hash_" + studentId,
      status: statusOverride || "WAITING_APPROVAL",
      draftVersion: 1,
      hasNewerSharedResources: false,
      thumbnailInspection: { exists: true, isDefaultLogo: false, width: 1280, height: 720, aspectCategory: "16:9", label: "Ảnh SP 16:9 (1280x720)" },
      sessionResultsJson: JSON.stringify({
        "12": studentId === "STU_01"
          ? {
              status: "VERIFIED",
              verifiedAt: "2026-10-23 10:00:00",
              submittedContentHash: "hash_STU_01",
              lastVerifiedSnapshot: {
                sessionNumber: 12,
                capturedAt: "2026-10-23 10:00:00",
                contentHash: "hash_STU_01",
                projectTitle: "Dự án Nguyễn Minh Khôi",
                teacherComment: "Đã nộp khung giao diện cơ bản.",
                thumbnailPath: "D:\\\\SPCK\\\\" + classId + "\\\\01_STU_01\\\\thumb.png",
                screenshots: ["D:\\\\SPCK\\\\" + classId + "\\\\01_STU_01\\\\screen1.png"],
                attachments: [],
                youtubeUrls: [],
                relatedLinks: [{ name: "Sản phẩm trên Google Drive", url: "https://drive.google.com/drive/folders/STU_01" }]
              }
            }
          : { status: "DRAFT" },
        "13": studentId === "STU_01"
          ? {
              status: "VERIFIED",
              verifiedAt: "2026-10-25 10:00:00",
              submittedContentHash: "hash_STU_01_13",
              lastVerifiedSnapshot: {
                sessionNumber: 13,
                capturedAt: "2026-10-25 10:00:00",
                contentHash: "hash_STU_01_13",
                projectTitle: "Dự án Nguyễn Minh Khôi",
                teacherComment: "Đã nộp tiến độ hoàn thiện.",
                thumbnailPath: "D:\\\\SPCK\\\\" + classId + "\\\\01_STU_01\\\\thumb.png",
                screenshots: [],
                attachments: [],
                youtubeUrls: [],
                relatedLinks: []
              }
            }
          : { status: "DRAFT" }
      })
    });

    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      const method = (init && init.method) || "GET";
      let bodyObj = null;
      if (init && typeof init.body === "string") {
        try { bodyObj = JSON.parse(init.body); } catch {}
      }
      window.__apiCalls.push({ url, method, body: bodyObj });

      if (url.includes("/api/spck/student-portal")) {
        return new Response(JSON.stringify({
          success: true,
          portalStatus: {
            isRunning: false,
            rootFolderPath: "D:\\\\SPCK\\\\VT-C4K-JSB15",
            submissions: []
          }
        }), { status: 200 });
      }
      if (url.includes("/api/spck/list")) {
        const u = new URL(url, "http://127.0.0.1:3000");
        const cid = u.searchParams.get("classId") || "VT-C4K-JSB15";
        const sess = Number(u.searchParams.get("sessionNumber") || 13);
        const students = mockStudentsByClass[cid] || mockStudentsByClass["VT-C4K-JSB15"];
        const records = students.map((s, idx) =>
          buildScannedRecord(cid, s.studentId, s.fullName, idx === 0 ? "APPROVED" : "WAITING_APPROVAL")
        );
        return new Response(JSON.stringify({
          success: true,
          classes: mockClasses,
          selectedClassId: cid,
          selectedSessionNumber: sess,
          activeSessionNumber: sess,
          students,
          records,
          savedFolderPath: "D:\\\\SPCK\\\\" + cid,
          session14TagLabels: ["Hoàn thành tốt sản phẩm cuối khóa"]
        }), { status: 200 });
      }
      if (url.includes("/api/spck/save-draft")) {
        return new Response(JSON.stringify({
          success: true,
          draftVersion: 2
        }), { status: 200 });
      }
      if (url.includes("/api/spck/scan") && method === "POST") {
        const cid = (bodyObj && bodyObj.classId) || "VT-C4K-JSB15";
        const students = mockStudentsByClass[cid] || mockStudentsByClass["VT-C4K-JSB15"];
        const records = students.map((s) =>
          buildScannedRecord(cid, s.studentId, s.fullName, "WAITING_APPROVAL")
        );
        const items = students.map((s) => ({
          folderName: "01_" + s.studentId,
          folderPath: "D:\\\\SPCK\\\\" + cid + "\\\\01_" + s.studentId,
          match: {
            suggestedStudentId: s.studentId,
            suggestedStudentName: s.fullName,
            matchScore: 1,
            isAutoMatched: true,
            warningReasons: []
          },
          packageData: {
            projectTitle: "Dự án " + s.fullName,
            thumbnailPath: "D:\\\\SPCK\\\\" + cid + "\\\\01_" + s.studentId + "\\\\thumb.png",
            screenshots: ["D:\\\\SPCK\\\\" + cid + "\\\\01_" + s.studentId + "\\\\screen1.png"],
            attachments: ["D:\\\\SPCK\\\\" + cid + "\\\\01_" + s.studentId + "\\\\index.html"],
            youtubeUrls: [],
            relatedLinks: [
              { name: "Sản phẩm trên Google Drive", url: "https://drive.google.com/drive/folders/" + s.studentId },
              { name: "Web chạy thử (Live)", url: "https://banhtalon.github.io/WEB_PRODUCT_SHOW/" + s.studentId }
            ],
            warnings: []
          }
        }));
        return new Response(JSON.stringify({
          success: true,
          records,
          scanResult: { items }
        }), { status: 200 });
      }
      if (url.includes("/api/spck/upload-drive")) {
        const cid = (bodyObj && bodyObj.classId) || "VT-C4K-JSB15";
        const students = mockStudentsByClass[cid] || mockStudentsByClass["VT-C4K-JSB15"];
        const records = students.map((s) =>
          buildScannedRecord(cid, s.studentId, s.fullName, "WAITING_APPROVAL")
        );
        if (window.__simulateDriveStudentFail) {
          return new Response(JSON.stringify({
            success: true,
            records,
            driveResult: {
              totalRequested: 2,
              uploadedStudentsCount: 1,
              failedStudentsCount: 1,
              results: [
                { studentId: "STU_01", fullName: "Nguyễn Minh Khôi", status: "FAILED", errorMessage: "Lỗi kết nối Drive cho Khôi" },
                { studentId: "STU_02", fullName: "Trần Bảo Ngọc", status: "UPLOADED" }
              ]
            }
          }), { status: 200 });
        }
        return new Response(JSON.stringify({
          success: true,
          records,
          driveResult: {
            totalRequested: 2,
            uploadedStudentsCount: 2,
            failedStudentsCount: 0,
            results: [
              { studentId: "STU_01", fullName: "Nguyễn Minh Khôi", status: "UPLOADED" },
              { studentId: "STU_02", fullName: "Trần Bảo Ngọc", status: "UPLOADED" }
            ]
          }
        }), { status: 200 });
      }
      if (url.includes("/api/spck/deploy-web")) {
        const cid = (bodyObj && bodyObj.classId) || "VT-C4K-JSB15";
        const students = mockStudentsByClass[cid] || mockStudentsByClass["VT-C4K-JSB15"];
        const records = students.map((s) =>
          buildScannedRecord(cid, s.studentId, s.fullName, "WAITING_APPROVAL")
        );
        return new Response(JSON.stringify({
          success: true,
          records,
          deployResult: {
            totalRequested: 2,
            deployedStudentsCount: 2,
            failedStudentsCount: 0,
            skippedNoHtmlCount: 0,
            results: [
              { studentId: "STU_01", fullName: "Nguyễn Minh Khôi", status: "DEPLOYED" },
              { studentId: "STU_02", fullName: "Trần Bảo Ngọc", status: "DEPLOYED" }
            ]
          }
        }), { status: 200 });
      }
      if (url.includes("/api/spck/capture-screenshots")) {
        const cid = (bodyObj && bodyObj.classId) || "VT-C4K-JSB15";
        const students = mockStudentsByClass[cid] || mockStudentsByClass["VT-C4K-JSB15"];
        const records = students.map((s) =>
          buildScannedRecord(cid, s.studentId, s.fullName, "WAITING_APPROVAL")
        );
        return new Response(JSON.stringify({
          success: true,
          records,
          batchResult: {
            totalProcessed: 2,
            totalScreenshotsCaptured: 4,
            results: [
              { studentId: "STU_01", fullName: "Nguyễn Minh Khôi", status: "CAPTURED" },
              { studentId: "STU_02", fullName: "Trần Bảo Ngọc", status: "CAPTURED" }
            ]
          }
        }), { status: 200 });
      }
      if (url.includes("/api/spck/generate-ai")) {
        const cid = (bodyObj && bodyObj.classId) || "VT-C4K-JSB15";
        const students = mockStudentsByClass[cid] || mockStudentsByClass["VT-C4K-JSB15"];
        const records = students.map((s) =>
          buildScannedRecord(cid, s.studentId, s.fullName, "WAITING_APPROVAL")
        );
        return new Response(JSON.stringify({
          success: true,
          records,
          results: [
            { studentId: "STU_01", status: "WAITING_APPROVAL", formattedTeacherComment: "Nhận xét AI đã soạn cho Khôi.", draftVersion: 2 },
            { studentId: "STU_02", status: "WAITING_APPROVAL", formattedTeacherComment: "Nhận xét AI đã soạn cho Ngọc.", draftVersion: 2 }
          ]
        }), { status: 200 });
      }
      if (url.includes("/api/spck/session14-eval/import-demo-scores")) {
        return new Response(JSON.stringify({
          success: true,
          matchedStudentsCount: 2,
          records: [
            {
              classId: "VT-C4K-JSB15",
              studentId: "STU_01",
              fullName: "Nguyễn Minh Khôi",
              competencyScores: { knowledgeInClass: 4, knowledgeSelfStudy: 4, skillCommunication: 4, skillComputerUse: 4, skillProblemSolving: 4, skillCreativity: 4, skillComputational: 4, attitudeHomework: 4, attitudeInClass: 4 },
              competencyTotalScore: 36,
              demoScores: { algorithm: 1.5, creativity: 1.0, communication: 0.5, problemSolving: 1.0, computerSkills: 1.0 },
              demoTotalScore: 5.0,
              demoSourcePath: "D:\\\\SCORE\\\\Khoi.xlsx",
              demoJudgeNote: "Điểm tuyệt đối",
              learnedFromMindx: "Đã học tốt HTML/CSS/JS.",
              suggestionsFromMindx: "Rèn luyện thêm kỹ năng thuyết trình.",
              futureDirection: "Tiếp tục học lên khóa JSA.",
              awardRanking: "Giải Nhất",
              quickTags: [],
              teacherNote: "",
              draftVersion: 1,
              status: "APPROVED",
              contentHash: "eval_hash_1"
            },
            {
              classId: "VT-C4K-JSB15",
              studentId: "STU_02",
              fullName: "Trần Bảo Ngọc",
              competencyScores: { knowledgeInClass: 4, knowledgeSelfStudy: 4, skillCommunication: 4, skillComputerUse: 4, skillProblemSolving: 4, skillCreativity: 4, skillComputational: 4, attitudeHomework: 4, attitudeInClass: 4 },
              competencyTotalScore: 36,
              demoScores: { algorithm: 1.25, creativity: 1.0, communication: 0.5, problemSolving: 1.0, computerSkills: 1.0 },
              demoTotalScore: 4.75,
              demoSourcePath: "D:\\\\SCORE\\\\Ngoc.xlsx",
              demoJudgeNote: "Rất tốt",
              learnedFromMindx: "Hoàn thành tốt sản phẩm.",
              suggestionsFromMindx: "Tự tin hơn khi trả lời câu hỏi.",
              futureDirection: "Tiếp tục học lên khóa JSA.",
              awardRanking: "Giải Nhì",
              quickTags: [],
              teacherNote: "",
              draftVersion: 1,
              status: "APPROVED",
              contentHash: "eval_hash_2"
            }
          ]
        }), { status: 200 });
      }
      if (url.includes("/api/spck/session14-eval/generate-ai")) {
        return new Response(JSON.stringify({
          success: true,
          results: [
            { studentId: "STU_01", status: "SUCCESS" },
            { studentId: "STU_02", status: "SUCCESS" }
          ],
          records: []
        }), { status: 200 });
      }
      if (url.includes("/api/spck/session14-eval/upload-lms")) {
        const requestedIds = (bodyObj && bodyObj.studentIds) || ["STU_01", "STU_02"];
        if (window.__simulateS14EvalStudentFail) {
          return new Response(JSON.stringify({
            success: true,
            records: [],
            uploadResult: {
              verifiedCount: 1,
              failedCount: 1,
              results: [
                { studentId: "STU_01", fullName: "Nguyễn Minh Khôi", status: "VERIFIED" },
                { studentId: "STU_02", fullName: "Trần Bảo Ngọc", status: "FAILED", errorMessage: "Không tìm thấy nút Lưu cho Ngọc" }
              ]
            }
          }), { status: 200 });
        }
        return new Response(JSON.stringify({
          success: true,
          records: [],
          uploadResult: {
            verifiedCount: requestedIds.length,
            failedCount: 0,
            results: requestedIds.map((sid) => ({ studentId: sid, status: "VERIFIED" }))
          }
        }), { status: 200 });
      }
      if (url.includes("/api/spck/session14-eval") && method === "GET") {
        return new Response(JSON.stringify({
          success: true,
          records: [
            {
              classId: "VT-C4K-JSB15",
              studentId: "STU_01",
              fullName: "Nguyễn Minh Khôi",
              competencyScores: { knowledgeInClass: 4, knowledgeSelfStudy: 4, skillCommunication: 4, skillComputerUse: 4, skillProblemSolving: 4, skillCreativity: 4, skillComputational: 4, attitudeHomework: 4, attitudeInClass: 4 },
              competencyTotalScore: 36,
              demoScores: { algorithm: 0, creativity: 0, communication: 0, problemSolving: 0, computerSkills: 0 },
              demoTotalScore: 0,
              demoSourcePath: "",
              demoJudgeNote: "",
              learnedFromMindx: "Đã học tốt HTML/CSS/JS.",
              suggestionsFromMindx: "Rèn luyện thêm kỹ năng thuyết trình.",
              futureDirection: "Tiếp tục học lên khóa JSA.",
              awardRanking: "Giải Nhất",
              quickTags: [],
              teacherNote: "",
              draftVersion: 1,
              status: "APPROVED",
              contentHash: "eval_hash_1"
            },
            {
              classId: "VT-C4K-JSB15",
              studentId: "STU_02",
              fullName: "Trần Bảo Ngọc",
              competencyScores: { knowledgeInClass: 4, knowledgeSelfStudy: 4, skillCommunication: 4, skillComputerUse: 4, skillProblemSolving: 4, skillCreativity: 4, skillComputational: 4, attitudeHomework: 4, attitudeInClass: 4 },
              competencyTotalScore: 36,
              demoScores: { algorithm: 0, creativity: 0, communication: 0, problemSolving: 0, computerSkills: 0 },
              demoTotalScore: 0,
              demoSourcePath: "",
              demoJudgeNote: "",
              learnedFromMindx: "Hoàn thành tốt sản phẩm.",
              suggestionsFromMindx: "Tự tin hơn khi trả lời câu hỏi.",
              futureDirection: "Tiếp tục học lên khóa JSA.",
              awardRanking: "Giải Nhì",
              quickTags: [],
              teacherNote: "",
              draftVersion: 1,
              status: "APPROVED",
              contentHash: "eval_hash_2"
            }
          ]
        }), { status: 200 });
      }
      if (url.includes("/api/spck/session14-eval") && method === "POST") {
        const action = bodyObj && bodyObj.action;
        if (action === "approve") {
          const ids = (bodyObj && bodyObj.studentIds) || ["STU_01", "STU_02"];
          return new Response(JSON.stringify({
            success: true,
            approvedIds: ids
          }), { status: 200 });
        }
        return new Response(JSON.stringify({
          success: true,
          record: { studentId: bodyObj && bodyObj.studentId, draftVersion: 2 }
        }), { status: 200 });
      }
      if (url.includes("/api/spck/approve")) {
        const ids = (bodyObj && bodyObj.studentIds) || ["STU_01", "STU_02"];
        return new Response(JSON.stringify({
          success: true,
          approvedStudentIds: ids,
          records: []
        }), { status: 200 });
      }
      if (url.includes("/api/spck/upload-lms")) {
        const ids = (bodyObj && bodyObj.studentIds) || ["STU_01", "STU_02"];
        return new Response(JSON.stringify({
          success: true,
          records: [],
          uploadResult: {
            results: ids.map((sid) => ({ studentId: sid, status: "VERIFIED", verifiedAt: "2026-10-30 16:00:00" }))
          }
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    };

    const originalFetch = window.fetch;
    window.__conflicts = [];
    window.__savedBodies = [];
    window.__versions = {};
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      const body = init && init.body ? JSON.parse(init.body) : {};
      const response = await originalFetch(input, init);
      const data = await response.json();
      let status = response.status;
      if (window.__mode === 'versions') {
        if (url.includes('/capture-screenshots')) {
          data.records.forEach(r => {r.draftVersion = 2; r.thumbnailPath += '.new.png'; window.__versions[r.studentId] = 2;});
        }
        if (url.endsWith('/save-draft')) {
          const current = window.__versions[body.studentId] || 1;
          window.__savedBodies.push(body);
          if (body.expectedVersion !== current) {
            window.__conflicts.push({studentId:body.studentId, expectedVersion:body.expectedVersion, currentVersion:current});
            status = 409; data.success = false; data.error = 'Phiên bản bản nháp đã thay đổi';
          } else {data.sessionDraft = {draftVersion:current};}
        }
      }
      if (window.__mode === 'part1fail' && url.endsWith('/save-draft')) {
        status = 409; data.success = false; data.error = 'AUDIT: lưu nháp Sản phẩm thất bại';
      }
      if (window.__mode === 'partialDemo' && url.includes('/session14-eval?')) {
        data.records[0].demoTotalScore = 4.5;
      }
      if (window.__mode === 'allSubmitted' && url.includes('/spck/list')) {
        for (const rec of data.records || []) {
          const sessions = JSON.parse(rec.sessionResultsJson);
          sessions['13'] = JSON.parse(JSON.stringify(JSON.parse(buildScannedRecord(rec.classId, 'STU_01', 'A').sessionResultsJson)['13']));
          rec.sessionResultsJson = JSON.stringify(sessions);
        }
      }
      if (window.__mode === 'SB' || window.__mode === 'App' || window.__mode === 'JSB-no-html') {
        const ext = window.__mode === 'SB' ? '.sb3' : window.__mode === 'App' ? '.py' : '.js';
        for (const rec of data.records || []) {
          if (rec.attachmentsJson) rec.attachmentsJson = JSON.stringify(['D:/audit/project' + ext]);
        }
        for (const item of data.scanResult?.items || []) item.packageData.attachments = ['D:/audit/project' + ext];
        if (window.__mode === 'App') {
          for (const cls of data.classes || []) {cls.classId = cls.classId.replace('JSB15','PTA15'); cls.className = cls.className.replace('Web JSB15','App PTA15');}
        }
      }
      return new Response(JSON.stringify(data), {status});
    };

  </script>
  <script>${bundleCode}</script>
</body>
</html>`;


    const observations: any[] = [];
    const fresh = async (mode: string) => {
      await page.close();
      page = await context.newPage();
      let scenarioHtml = html.replace('window.__apiCalls = [];', 'window.__mode = ' + JSON.stringify(mode) + '; window.__apiCalls = [];');
      if (mode === 'App') scenarioHtml = scenarioHtml.replaceAll('VT-C4K-JSB15','VT-C4K-PTA15').replaceAll('Lớp Web JSB15','Lớp App PTA15');
      await page.setContent(scenarioHtml, {waitUntil:'networkidle'});
      await page.locator('[data-testid="s5b-auto-run-tools-checkbox"]').waitFor();
      await page.waitForFunction(() => document.body.innerText.includes('Đang chọn:'));
    };
    const calls = () => page.evaluate(() => (window as any).__apiCalls);
    const settle = async () => {
      await page.waitForFunction(() => !document.querySelector('[data-testid="s5b-auto-prep-progress"]'));
      await page.waitForTimeout(120);
    };
    const open14 = async () => {
      await page.locator('button:has-text("Buổi 14")').first().click();
      await page.locator('text=File chấm điểm BGK').first().waitFor();
      await page.waitForTimeout(150);
    };
    const combo = () => page.locator('button:has-text("🚀 Nộp Buổi 14 đầy đủ")');
    await fresh('versions');
    await page.locator('button:has-text("Quét & Khớp HV")').click();
    await settle();
    const versionResult = await page.evaluate(() => ({conflicts:(window as any).__conflicts, calls:(window as any).__apiCalls.map((c:any)=>c.url), saved:(window as any).__savedBodies}));
    assert.equal(versionResult.conflicts.length, 2);
    assert.equal(versionResult.calls.includes('/api/spck/deploy-web'), false);
    assert.equal(versionResult.calls.includes('/api/spck/upload-drive'), false);
    observations.push({id:'P01', defect:true, description:'Sau chụp ảnh version=2, cả Web và Drive dùng lại expectedVersion=1 và bị chặn trước API công cụ', ...versionResult});

    await fresh('partialDemo');
    await open14();
    const partialCalls = await calls();
    assert.equal(partialCalls.some((c:any)=>c.url.includes('/import-demo-scores')), false);
    observations.push({id:'P02', defect:true, description:'Một học viên có Demo>0, học viên còn lại=0: không tự đọc Demo', calls:partialCalls.map((c:any)=>c.url)});

    await fresh('allSubmitted');
    const allText = await page.locator('#root').innerText();
    const selected = await page.locator('text=Đang chọn:').first().innerText();
    assert.ok(selected.includes('2/2'), selected);
    observations.push({id:'P03', defect:true, description:'Cả lớp đã nộp Buổi 13 nhưng vẫn tự chọn 2/2', selected, submittedLabels:(allText.match(/Đã nộp ✓/g)||[]).length});

    await fresh('part1fail');
    await open14();
    await page.evaluate(() => {(window as any).__apiCalls=[];});
    await combo().click();
    await page.waitForFunction(() => document.body.innerText.includes('Hoàn tất nộp Buổi 14 đầy đủ'));
    const failText = await page.locator('#root').innerText();
    const failCalls = await calls();
    assert.equal(failCalls.some((c:any)=>c.url==='/api/spck/upload-lms'), false);
    assert.equal(await page.locator('button:has-text("Thử lại riêng phần Sản phẩm")').count(), 0);
    assert.ok(failText.includes('0/2 bài thành công'));
    observations.push({id:'P04', defect:true, description:'Lưu nháp phần Sản phẩm lỗi 409: phần Đánh giá vẫn chạy, banner hoàn tất, không có retry Sản phẩm', calls:failCalls, status:failText.slice(failText.indexOf('Hoàn tất'),failText.indexOf('Hoàn tất')+400)});
    await page.screenshot({path:path.join(ROOT,'docs/audits/v340/s5b-round1/P04.png'),fullPage:true});

    await fresh('normal');
    await open14();
    await page.evaluate(() => {(window as any).__simulateS14EvalStudentFail=true;});
    await combo().click();
    await page.locator('button:has-text("Thử lại riêng phần Đánh giá")').waitFor();
    await page.evaluate(() => {(window as any).__simulateS14EvalStudentFail=false; (window as any).__apiCalls=[];});
    await page.locator('button:has-text("Thử lại riêng phần Đánh giá")').click();
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).some(b=>b.textContent?.includes('Thử lại riêng phần Đánh giá')));
    const retryText = await page.locator('#root').innerText();
    assert.ok(retryText.includes('Đã lưu & xác minh 1 học viên (0 cần thử lại)'));
    observations.push({id:'P05', defect:true, description:'Đánh giá: lần đầu 1 thành công + retry 1 thành công, tổng hiển thị chỉ 1 thay vì 2', status:retryText.match(/Đã lưu & xác minh[^\n]+/)?.[0], retryCalls:await calls()});

    await fresh('SB');
    await page.locator('select').first().selectOption('VT-C4K-SB28');
    await page.waitForFunction(() => (document.querySelector('select') as HTMLSelectElement)?.value === 'VT-C4K-SB28');
    await page.locator('button:has-text("Quét & Khớp HV")').click();
    await settle();
    const sbCalls = (await calls()).filter((c:any)=> /\/(scan|capture-screenshots|deploy-web|upload-drive)$/.test(c.url));
    assert.deepEqual(sbCalls.map((c:any)=>c.url), ['/api/spck/scan','/api/spck/capture-screenshots','/api/spck/upload-drive']);
    observations.push({id:'P06', defect:false, description:'SB .sb3: đúng thứ tự Quét -> Chụp -> Drive', calls:sbCalls});

    await fresh('App');
    await page.locator('button:has-text("Quét & Khớp HV")').click();
    await settle();
    const appCalls = (await calls()).filter((c:any)=> /\/(scan|capture-screenshots|deploy-web|upload-drive)$/.test(c.url));
    assert.deepEqual(appCalls.map((c:any)=>c.url), ['/api/spck/scan','/api/spck/capture-screenshots','/api/spck/upload-drive']);
    observations.push({id:'P07', defect:true, description:'App/Python PTA15 .py: chạy thêm Chụp trước Drive, khác ma trận yêu cầu hiện tại (nhưng khớp ý App/Game trong kế hoạch duyệt)', calls:appCalls});

    fs.writeFileSync(path.join(ROOT,'docs/audits/v340/s5b-round1/observations.json'),JSON.stringify(observations,null,2));
    console.log(JSON.stringify(observations.map(({id,defect,description})=>({id,defect,description})),null,2));
    await context.close();
  } finally {
    await browser.close();
    fs.rmSync(tempBuildDir, {recursive:true,force:true});
  }
}
runTests().catch(err=>{console.error(err);process.exitCode=1;});
