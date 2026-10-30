// @ts-nocheck -- independent audit, not a product test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tailwindcssPostcss from '@tailwindcss/postcss';
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';
import postcss from 'postcss';
const ROOT=process.cwd();
async function compileRealAppCss(): Promise<string> {
  const globalsCssPath = path.join(ROOT, "src/app/globals.css");
  const rawCss = fs.readFileSync(globalsCssPath, "utf8");
  const result = await postcss([tailwindcssPostcss({ base: ROOT })]).process(rawCss, {
    from: globalsCssPath,
  });
  return result.css;
}


async function runTests(){
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
    window.__simulateSaveDraftConflict = false;
    window.__simulateAllSess13Verified = false;
    window.__serverDraftVersions = { STU_01: 1, STU_02: 1 };

    window.confirm = (msg) => {
      window.__confirmCalls.push(String(msg));
      return window.__confirmNextResult;
    };

    const mockClasses = [
      { classId: "VT-C4K-JSB15", className: "Lớp Web JSB15", studentCount: 2, spckCount: 2, latestSessionNumber: 13, eligibleForSpck: true },
      { classId: "VT-C4K-PTA08", className: "Lớp Python App PTA08", studentCount: 1, spckCount: 1, latestSessionNumber: 12, eligibleForSpck: true },
      { classId: "VT-C4K-CANVA01", className: "Lớp Thiết kế Canva01", studentCount: 1, spckCount: 1, latestSessionNumber: 12, eligibleForSpck: true },
      { classId: "VT-ROB-B09", className: "Lớp Robotics B09", studentCount: 1, spckCount: 1, latestSessionNumber: 12, eligibleForSpck: true }
    ];

    const mockStudentsByClass = {
      "VT-C4K-JSB15": [
        { studentId: "STU_01", classId: "VT-C4K-JSB15", fullName: "Nguyễn Minh Khôi", isActive: 1 },
        { studentId: "STU_02", classId: "VT-C4K-JSB15", fullName: "Trần Bảo Ngọc", isActive: 1 }
      ],
      "VT-C4K-PTA08": [
        { studentId: "STU_01", classId: "VT-C4K-PTA08", fullName: "Nguyễn Minh Khôi", isActive: 1 },
        { studentId: "STU_02", classId: "VT-C4K-PTA08", fullName: "Trần Bảo Ngọc", isActive: 1 }
      ],
      "VT-C4K-CANVA01": [
        { studentId: "STU_01", classId: "VT-C4K-CANVA01", fullName: "Nguyễn Minh Khôi", isActive: 1 },
        { studentId: "STU_02", classId: "VT-C4K-CANVA01", fullName: "Trần Bảo Ngọc", isActive: 1 }
      ],
      "VT-ROB-B09": [
        { studentId: "STU_01", classId: "VT-ROB-B09", fullName: "Nguyễn Minh Khôi", isActive: 1 },
        { studentId: "STU_02", classId: "VT-ROB-B09", fullName: "Trần Bảo Ngọc", isActive: 1 }
      ]
    };

    const getAttachmentForClass = (classId, studentId) => {
      if (classId.includes("PTA")) return ["D:\\\\SPCK\\\\" + classId + "\\\\01_" + studentId + "\\\\main.py"];
      if (classId.includes("CANVA") || classId.includes("ROB")) return ["D:\\\\SPCK\\\\" + classId + "\\\\01_" + studentId + "\\\\poster.pdf"];
      return ["D:\\\\SPCK\\\\" + classId + "\\\\01_" + studentId + "\\\\index.html"];
    };

    const buildScannedRecord = (classId, studentId, fullName, statusOverride, draftVerOverride) => {
      const ver = draftVerOverride || window.__serverDraftVersions[studentId] || 1;
      const isStu02Sess13Verified = Boolean(window.__simulateAllSess13Verified);
      return {
        classId,
        studentId,
        localFolderPath: "D:\\\\SPCK\\\\" + classId + "\\\\01_" + studentId,
        matchScore: 1,
        isConfirmedByTeacher: 1,
        projectTitle: "Dự án " + fullName,
        thumbnailPath: "D:\\\\SPCK\\\\" + classId + "\\\\01_" + studentId + "\\\\thumb.png",
        screenshotsJson: JSON.stringify(["D:\\\\SPCK\\\\" + classId + "\\\\01_" + studentId + "\\\\screen1.png"]),
        attachmentsJson: JSON.stringify(getAttachmentForClass(classId, studentId)),
        youtubeUrlsJson: JSON.stringify([]),
        relatedLinksJson: JSON.stringify([
          { name: "Sản phẩm trên Google Drive", url: "https://drive.google.com/drive/folders/" + studentId },
          ...(classId.includes("JSB")
            ? [{ name: "Web chạy thử (Live)", url: "https://banhtalon.github.io/WEB_PRODUCT_SHOW/" + studentId }]
            : [])
        ]),
        quickTagsJson: JSON.stringify(["Hoàn thành tốt sản phẩm cuối khóa"]),
        teacherNote: "Làm bài tốt",
        teacherComment: "Trong quá trình thực hiện dự án, con đã chủ động hoàn thiện đầy đủ tính năng và giao diện rõ ràng.",
        contentHash: "hash_" + studentId,
        status: statusOverride || "WAITING_APPROVAL",
        draftVersion: ver,
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
          "13": studentId === "STU_01" || (studentId === "STU_02" && isStu02Sess13Verified)
            ? {
                status: "VERIFIED",
                verifiedAt: "2026-10-25 10:00:00",
                submittedContentHash: "hash_" + studentId,
                lastVerifiedSnapshot: {
                  sessionNumber: 13,
                  capturedAt: "2026-10-25 10:00:00",
                  contentHash: "hash_" + studentId,
                  projectTitle: "Dự án " + fullName,
                  teacherComment: "Đã nộp tiến độ hoàn thiện.",
                  thumbnailPath: "D:\\\\SPCK\\\\" + classId + "\\\\01_" + studentId + "\\\\thumb.png",
                  screenshots: [],
                  attachments: [],
                  youtubeUrls: [],
                  relatedLinks: []
                }
              }
            : { status: "DRAFT" }
        })
      };
    };

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
        window.__serverDraftVersions = { STU_01: 1, STU_02: 1 };
        const records = students.map((s, idx) =>
          buildScannedRecord(
            cid,
            s.studentId,
            s.fullName,
            idx === 0 || (idx === 1 && window.__simulateAllSess13Verified) ? "VERIFIED" : "WAITING_APPROVAL",
            1
          )
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
        if (window.__delaySaveDraftOnce) {
          window.__delaySaveDraftOnce = false;
          await new Promise((resolve) => {
            window.__releaseSaveDraft = resolve;
          });
        }
        if (window.__simulateSaveDraftConflict) {
          return new Response(JSON.stringify({
            success: false,
            conflict: true,
            error: "Xung đột phiên bản bản nháp (409)."
          }), { status: 409 });
        }
        const sid = (bodyObj && bodyObj.studentId) || "STU_01";
        const cid = (bodyObj && bodyObj.classId) || "VT-C4K-JSB15";
        const currentVer = window.__serverDraftVersions[sid] || 1;
        if (typeof (bodyObj && bodyObj.expectedVersion) === "number" && bodyObj.expectedVersion !== currentVer) {
          return new Response(JSON.stringify({
            success: false,
            conflict: true,
            error: "Expected draftVersion " + currentVer + " but got " + bodyObj.expectedVersion
          }), { status: 409 });
        }
        const nextVer = currentVer + 1;
        window.__serverDraftVersions[sid] = nextVer;
        const stuName = sid === "STU_02" ? "Trần Bảo Ngọc" : "Nguyễn Minh Khôi";
        const rec = buildScannedRecord(cid, sid, stuName, "WAITING_APPROVAL", nextVer);
        return new Response(JSON.stringify({
          success: true,
          draftVersion: nextVer,
          sessionDraft: { draftVersion: nextVer },
          record: rec
        }), { status: 200 });
      }
      if (url.includes("/api/spck/scan") && method === "POST") {
        const cid = (bodyObj && bodyObj.classId) || "VT-C4K-JSB15";
        const students = mockStudentsByClass[cid] || mockStudentsByClass["VT-C4K-JSB15"];
        window.__serverDraftVersions = { STU_01: 1, STU_02: 1 };
        const records = students.map((s) =>
          buildScannedRecord(cid, s.studentId, s.fullName, "WAITING_APPROVAL", 1)
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
            attachments: getAttachmentForClass(cid, s.studentId),
            youtubeUrls: [],
            relatedLinks: [
              { name: "Sản phẩm trên Google Drive", url: "https://drive.google.com/drive/folders/" + s.studentId },
              ...(cid.includes("JSB")
                ? [{ name: "Web chạy thử (Live)", url: "https://banhtalon.github.io/WEB_PRODUCT_SHOW/" + s.studentId }]
                : [])
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
        const records = students.map((s) => {
          const nextVer = (window.__serverDraftVersions[s.studentId] || 1) + 1;
          window.__serverDraftVersions[s.studentId] = nextVer;
          return buildScannedRecord(cid, s.studentId, s.fullName, "WAITING_APPROVAL", nextVer);
        });
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
            totalRequested: students.length,
            uploadedStudentsCount: students.length,
            failedStudentsCount: 0,
            results: students.map((s) => ({ studentId: s.studentId, fullName: s.fullName, status: "UPLOADED" }))
          }
        }), { status: 200 });
      }
      if (url.includes("/api/spck/deploy-web")) {
        const cid = (bodyObj && bodyObj.classId) || "VT-C4K-JSB15";
        const students = mockStudentsByClass[cid] || mockStudentsByClass["VT-C4K-JSB15"];
        const records = students.map((s) => {
          const nextVer = (window.__serverDraftVersions[s.studentId] || 1) + 1;
          window.__serverDraftVersions[s.studentId] = nextVer;
          return buildScannedRecord(cid, s.studentId, s.fullName, "WAITING_APPROVAL", nextVer);
        });
        return new Response(JSON.stringify({
          success: true,
          records,
          deployResult: {
            totalRequested: students.length,
            deployedStudentsCount: students.length,
            failedStudentsCount: 0,
            skippedNoHtmlCount: 0,
            results: students.map((s) => ({ studentId: s.studentId, fullName: s.fullName, status: "DEPLOYED" }))
          }
        }), { status: 200 });
      }
      if (url.includes("/api/spck/capture-screenshots")) {
        const cid = (bodyObj && bodyObj.classId) || "VT-C4K-JSB15";
        const students = mockStudentsByClass[cid] || mockStudentsByClass["VT-C4K-JSB15"];
        const records = students.map((s) => {
          const nextVer = (window.__serverDraftVersions[s.studentId] || 1) + 1;
          window.__serverDraftVersions[s.studentId] = nextVer;
          return buildScannedRecord(cid, s.studentId, s.fullName, "WAITING_APPROVAL", nextVer);
        });
        return new Response(JSON.stringify({
          success: true,
          records,
          batchResult: {
            totalProcessed: students.length,
            totalScreenshotsCaptured: 4,
            results: students.map((s) => ({ studentId: s.studentId, fullName: s.fullName, status: "CAPTURED" }))
          }
        }), { status: 200 });
      }
      if (url.includes("/api/spck/import-youtube")) {
        const cid = (bodyObj && bodyObj.classId) || "VT-ROB-B09";
        const students = mockStudentsByClass[cid] || mockStudentsByClass["VT-ROB-B09"];
        const records = students.map((s) => {
          const nextVer = (window.__serverDraftVersions[s.studentId] || 1) + 1;
          window.__serverDraftVersions[s.studentId] = nextVer;
          return buildScannedRecord(cid, s.studentId, s.fullName, "WAITING_APPROVAL", nextVer);
        });
        return new Response(JSON.stringify({
          success: true,
          records,
          importResult: {
            playlists: [],
            totalVideos: 1,
            appliedCount: 1,
            results: students.map((s) => ({
              videoId: "vid1",
              url: "https://youtube.com/watch?v=vid1",
              videoTitle: s.fullName,
              extractedName: s.fullName,
              studentId: s.studentId,
              fullName: s.fullName,
              status: "MATCHED",
              applied: true,
              frames: ["frame1.png", "frame2.png"],
              syncedToSession: true
            })),
            studentsWithoutVideo: [],
            invalidLines: []
          }
        }), { status: 200 });
      }
      if (url.includes("/api/spck/generate-ai")) {
        const cid = (bodyObj && bodyObj.classId) || "VT-C4K-JSB15";
        const students = mockStudentsByClass[cid] || mockStudentsByClass["VT-C4K-JSB15"];
        const records = students.map((s) => {
          const nextVer = (window.__serverDraftVersions[s.studentId] || 1) + 1;
          window.__serverDraftVersions[s.studentId] = nextVer;
          return buildScannedRecord(cid, s.studentId, s.fullName, "WAITING_APPROVAL", nextVer);
        });
        return new Response(JSON.stringify({
          success: true,
          records,
          results: students.map((s) => ({
            studentId: s.studentId,
            status: "WAITING_APPROVAL",
            formattedTeacherComment: "Nhận xét AI đã soạn cho " + s.fullName + ".",
            draftVersion: window.__serverDraftVersions[s.studentId]
          }))
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
              demoScores: { algorithm: 1.25, creativity: 1.0, communication: 0.5, problemSolving: 1.0, computerSkills: 0.75 },
              demoTotalScore: 4.5,
              demoSourcePath: "D:\\\\SCORE\\\\Khoi_existing.xlsx",
              demoJudgeNote: "Điểm đã nhập trước",
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
    const baseFetch=window.fetch;
    window.__responses=[]; window.__conflicts=[]; window.__resources={};
    window.fetch=async(input,init)=>{
      const url=typeof input==='string'?input:input.url;
      const body=init?.body?JSON.parse(init.body):{};
      const mode=window.__mode;
      const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
      if(url.endsWith('/session14-eval/upload-lms') && window.__holdEvalUploadOnce){
        window.__holdEvalUploadOnce=false;
        window.__heldEvalRequest={url,body};
        await new Promise(resolve=>window.__releaseEvalUpload=resolve);
      }
      if(url.endsWith('/spck/save-draft') && mode==='delaySaveFail') {
        window.__apiCalls.push({url,body});
        if(!window.__didDelay){window.__didDelay=true;await new Promise(resolve=>window.__releaseSave=resolve);}
        return response({success:false,error:'AUDIT delayed 409'},409);
      }
      if(url.endsWith('/spck/save-draft') && mode==='saveFail') {
        window.__apiCalls.push({url,body}); return response({success:false,error:'AUDIT save 409'},409);
      }
      if(url.endsWith('/spck/approve') && ['approveFail','approveSkip','approvePartial','exception'].includes(mode)){
        window.__apiCalls.push({url,body});
        if(mode==='exception')throw new Error('AUDIT offline');
        if(mode==='approvePartial')return response({success:false,error:'AUDIT rejected',skipped:[{studentId:'STU_01',reason:'AUDIT skip one'}]},409);
        return response(mode==='approveSkip'?{success:true,approvedStudentIds:[],skipped:body.studentIds.map(studentId=>({studentId,reason:'AUDIT skip'}))}:{success:false,error:'AUDIT rejected'},mode==='approveSkip'?200:409);
      }
      if(url.endsWith('/spck/upload-lms') && mode==='uploadFail'){
        window.__apiCalls.push({url,body}); return response({success:false,error:'AUDIT upload failed'},500);
      }
      if(url.endsWith('/spck/save-draft') && mode==='versions'){
        const current=window.__serverDraftVersions[body.studentId]||1;
        if(body.expectedVersion!==current)window.__conflicts.push({body,current});
        const r=window.__resources[body.studentId];
        if(r && (body.thumbnailPath!==r.thumbnailPath || JSON.stringify(body.screenshots)!==r.screenshotsJson || JSON.stringify(body.relatedLinks)!==r.relatedLinksJson || JSON.stringify(body.youtubeUrls)!==r.youtubeUrlsJson))window.__conflicts.push({reason:'resource lost',body,expected:r});
      }
      const orig=await baseFetch(input,init); const data=await orig.json();
      if(window.__extension){
        for(const r of data.records||[])if(r.attachmentsJson)r.attachmentsJson=JSON.stringify(['D:/audit/project'+window.__extension]);
        for(const r of data.scanResult?.items||[])r.packageData.attachments=['D:/audit/project'+window.__extension];
      }
      if(mode==='allSubmitted' || mode==='noneSubmitted') {
        for(const r of data.records||[]){
          if(r.sessionResultsJson){let map=JSON.parse(r.sessionResultsJson);map['13']=mode==='allSubmitted'?{status:'VERIFIED',verifiedAt:'2026-10-30 10:00:00',submittedContentHash:r.contentHash,lastVerifiedSnapshot:{sessionNumber:13,contentHash:r.contentHash}}:{status:'DRAFT'};r.sessionResultsJson=JSON.stringify(map);}
        }
      }
      if(url.includes('/session14-eval?')){
        if(mode==='allDemo')data.records.forEach(r=>r.demoTotalScore=4.5);
        if(mode==='zeroDemo')data.records.forEach(r=>r.demoTotalScore=0);
      }
      if(url.endsWith('/import-demo-scores') && mode==='partialDemo'){
        data.records[0].demoTotalScore=4.5;
      }
      if(mode==='versions'){
        if(url.endsWith('/capture-screenshots')){
          for(const r of data.records||[]){r.thumbnailPath='D:/audit/new-'+r.studentId+'.png';r.screenshotsJson=JSON.stringify(['D:/audit/shot-'+r.studentId+'.png']);window.__resources[r.studentId]={thumbnailPath:r.thumbnailPath,screenshotsJson:r.screenshotsJson,relatedLinksJson:r.relatedLinksJson,youtubeUrlsJson:r.youtubeUrlsJson};}
        }
        if(url.endsWith('/import-youtube')){
          for(const r of data.records||[]){r.youtubeUrlsJson=JSON.stringify(['https://youtube.com/watch?v=AUDIT123456']);r.screenshotsJson=JSON.stringify(['D:/audit/frame1.png','D:/audit/frame2.png']);window.__resources[r.studentId]={thumbnailPath:r.thumbnailPath,screenshotsJson:r.screenshotsJson,relatedLinksJson:r.relatedLinksJson,youtubeUrlsJson:r.youtubeUrlsJson};}
        }
        if(url.endsWith('/deploy-web') || url.endsWith('/upload-drive')){
          for(const r of data.records||[]){const resources=window.__resources[r.studentId];if(resources)Object.assign(r,resources);const links=JSON.parse(r.relatedLinksJson);links.push({name:url.endsWith('/deploy-web')?'AUDIT Web':'AUDIT Drive',url:url.endsWith('/deploy-web')?'https://audit.example/web':'https://drive.google.com/drive/folders/AUDIT'});r.relatedLinksJson=JSON.stringify(links);window.__resources[r.studentId]={thumbnailPath:r.thumbnailPath,screenshotsJson:r.screenshotsJson,relatedLinksJson:r.relatedLinksJson,youtubeUrlsJson:r.youtubeUrlsJson};}
        }
      }
      if(url.endsWith('/spck/upload-lms') && window.__spckPartial){data.uploadResult.results=data.uploadResult.results.map(r=>({...r,status:r.studentId==='STU_02'?'FAILED':'VERIFIED',errorMessage:r.studentId==='STU_02'?'AUDIT partial':undefined}));}
      window.__responses.push({url,status:orig.status,success:data.success});
      return response(data,orig.status);
    };

  </script>
  <script>${bundleCode}</script>
</body>
</html>`;

    const observations=[];const output=process.env.S5B_R3_EVIDENCE!;
    const record=(id,details)=>{observations.push({id,...details});fs.writeFileSync(path.join(output,'matrix-observations.json'),JSON.stringify(observations,null,2));console.log('PASS',id);};
    const fresh=async(cid,label,ext,mode='normal')=>{
      await page.close();page=await context.newPage();await context.route('**/*',r=>r.abort());
      const content=html.replaceAll('VT-C4K-JSB15',cid).replaceAll('Lớp Web JSB15',label).replace('window.__apiCalls = [];','window.__mode='+JSON.stringify(mode)+'; window.__extension='+JSON.stringify(ext)+'; window.__apiCalls = [];');
      await page.setContent(content,{waitUntil:'networkidle'});await page.waitForFunction(()=>document.body.innerText.includes('Đang chọn:'));
    };
    const scan=async()=>{await page.locator('button:has-text("Quét & Khớp HV")').click();await page.waitForFunction(()=>!document.querySelector('[data-testid="s5b-auto-prep-progress"]'));await page.waitForTimeout(100);};
    const cases=[
      ['JSI01','Lớp lập trình','.js',['scan','capture-screenshots','deploy-web','upload-drive']],
      ['UNCLASSIFIED01','Lớp mẫu','.html',['scan','capture-screenshots','deploy-web','upload-drive']],
      ['PTA08','Lớp Python','.py',['scan','capture-screenshots','upload-drive']],
      ['GMA22','Lớp Game','.exe',['scan','capture-screenshots','upload-drive']],
      ['SB28','Lớp Scratch','.sb3',['scan','capture-screenshots','upload-drive']],
      ['CANVA01','Lớp thiết kế','.pdf',['scan','upload-drive']],
      ['ROB01','Lớp Robotics','.pdf',['scan','upload-drive']],
    ];
    for(const [code,label,ext,expected] of cases){
      await fresh('VT-C4K-'+code,label,ext);await scan();
      const calls=await page.evaluate(()=>(window as any).__apiCalls);const actual=calls.filter(c=>['/scan','/capture-screenshots','/deploy-web','/upload-drive','/import-youtube'].some(s=>c.url.endsWith(s))).map(c=>c.url.split('/').pop());
      assert.deepEqual(actual,expected);record('R3-M-'+code,{classId:'VT-C4K-'+code,ext,expected,actual});
    }
    await fresh('VT-C4K-JSB15','Lớp Web JSB15','.html','saveFail');await scan();
    const calls=await page.evaluate(()=>(window as any).__apiCalls);assert.equal(calls.some(c=>c.url==='/api/spck/deploy-web'||c.url==='/api/spck/upload-drive'),false);
    await page.locator('button:has-text("Chi tiết ▾")').first().click();
    assert.equal(await page.locator('button:has-text("Thử lại Up Drive & Gắn Link")').count(),1);
    assert.equal(await page.locator('button:has-text("Thử lại Up Web Live")').count(),1);
    record('R3-M-saveFail',{scenario:'Save-before-Web/Drive 409 blocks unsafe call and creates both row tool retries',calls:calls.map(c=>c.url)});
    await context.close();

  } finally { await browser.close(); }
}
runTests().catch(e=>{console.error(e);process.exitCode=1;});
