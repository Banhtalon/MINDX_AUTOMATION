/**
 * MINDX AUTOMATION BOT - STAGE S5b VERIFICATION SUITE (v3.4.0)
 * Verifies:
 * - [S5b-T1] S5b.1 + S5b.2: Auto-run preparation tools toggle (default ON) by class type (JSB / SB / App-Robotics) + step progress + approval demotion confirm guard
 * - [S5b-T2] S5b.3: Single place for tools in ToolsDrawer; StudentRow hides normal-state duplicate tool buttons and only shows "🔄 Thử lại" when a tool fails
 * - [S5b-T3] S5b.4 + S5b.5: Session 14 unified flow ("✨ AI soạn tất cả (SPCK + Thư 3 phần)", "🚀 Nộp Buổi 14 đầy đủ (Sản phẩm + Đánh giá)" with independent retry, 2-tab StudentRow editor, no duplicate student list in Session14Panel, auto-import Demo scores)
 * - [S5b-T4] S5b.6 + S5b.7 + S5b.8: Session 13 auto-selects unsubmitted students + "nêu tiến bộ so với Buổi 12" in Gemini prompt, zero "{false &&" blocks, and strict title/comment/thumbnail guardrails
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import AdmZip from "adm-zip";
import tailwindcssPostcss from "@tailwindcss/postcss";
import * as esbuild from "esbuild";
import { chromium } from "playwright";
import postcss from "postcss";
import { POST as scanPost } from "../src/app/api/spck/scan/route";
import { config as appConfig } from "../src/lib/config";
import {
  classSessionRepo,
  closeDb,
  formatSpckSessionTitle,
  getDb,
  isDefaultSpckProductTitle,
  spckSessionRepo,
  spckUploadRepo,
  studentRepo,
  stripSpckSessionSuffix,
  validateSpckTitleLength,
} from "../src/lib/db/sqlite";
import {
  buildPreliminaryProjectSummary,
  detectLimitationEvidence,
  detectPresentationEvidence,
  SpckCommentGenerator,
} from "../src/lib/gemini/spck-comment";
import { parseCodeBuffer } from "../src/lib/file-parsers/code-reader";
import {
  DEFAULT_SPCK_THUMBNAIL_PATH,
  scanStudentSpckFolder,
} from "../src/lib/local-files/spck-scanner";
import {
  detectCoursePrefixFromClassId,
  isRoboticsCourseClassId,
  prepareStudentFilesForDriveUpload,
  resolveCourseSpecificFolderId,
} from "../src/lib/playwright/spck-drive-uploader";
import {
  detectSpckCourseProfile,
  getSpckQuickTagGroups,
  isLimitationOrNextStepQuickTag,
  isPresentationQuickTag,
  suggestSpckQuickTagsFromProject,
} from "../src/lib/spck/spck-quick-tags";

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
  const isolatedDbDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-v340-s5-db-"));
  process.env.MINDX_DB_PATH = path.join(isolatedDbDir, "s5_test.db");
  process.env.MINDX_RUNNING_CLASSES_PATH = path.join(isolatedDbDir, "running_classes_s5.json");
  if (!appConfig.allowedLocalDirs.includes(isolatedDbDir)) {
    appConfig.allowedLocalDirs.push(isolatedDbDir);
  }
  console.log("=== BẮT ĐẦU KIỂM THỬ GIAI ĐOẠN S5b (TINH GỌN MÀN HÌNH 3 SPCK & HỢP NHẤT BUỔI 14) ===");

  // =========================================================================
  // [S5b-T4] Kiểm tra S5b.6, S5b.7 (Zero {false && ...}) & S5b.8 (Guardrails)
  // =========================================================================
  console.log("\n[S5b-T4] Kiểm tra S5b.6 (tiến bộ so với Buổi 12), S5b.7 (0 khối {false && ...}) và S5b.8 (Guardrails)...");

  const targetFiles = [
    "src/app/final-project/page.tsx",
    "src/components/final-project/Step1Header.tsx",
    "src/components/final-project/ToolsDrawer.tsx",
    "src/components/final-project/StudentRow.tsx",
    "src/components/final-project/StudentTable.tsx",
    "src/components/final-project/SubmitBar.tsx",
    "src/components/final-project/Session14Panel.tsx",
    "src/components/final-project/FolderBrowserModal.tsx",
    "src/components/final-project/SnapshotModal.tsx",
  ];
  for (const relPath of targetFiles) {
    const content = fs.readFileSync(path.join(ROOT, relPath), "utf8");
    assert.ok(
      !content.includes("{false &&"),
      `File ${relPath} không được còn chứa khối code chết '{false && ...}' (S5b.7)`
    );
  }

  // Kiểm tra S5b.8: Tên sản phẩm làm sạch hậu tố buổi/GĐ2 và phát hiện tên mặc định "SPCK <Họ tên>"
  const cleanedStage2Title = formatSpckSessionTitle(
    stripSpckSessionSuffix(
      "Web Cửa Hàng Bánh Ngọt - Giai đoạn 2 (GĐ2) — Buổi 12 (GĐ1)"
    ),
    14
  );
  assert.strictEqual(
    cleanedStage2Title,
    "Web Cửa Hàng Bánh Ngọt",
    `Tên sản phẩm Buổi 14 sau khi làm sạch phải giữ nguyên tên dự án và loại bỏ hoàn toàn hậu tố buổi/giai đoạn: '${cleanedStage2Title}'`
  );
  assert.strictEqual(
    validateSpckTitleLength("Web Cửa Hàng Bánh Ngọt (GĐ2)", 14).valid,
    false,
    "validateSpckTitleLength phải từ chối tiêu đề chứa nhãn 'GĐ2' / 'Giai đoạn 2' (S5b.8)"
  );
  assert.strictEqual(
    isDefaultSpckProductTitle("SPCK Nguyễn Minh Khôi", "Nguyễn Minh Khôi"),
    true,
    "isDefaultSpckProductTitle phải phát hiện tiêu đề mặc định 'SPCK <Họ tên>' (S5b.8)"
  );
  assert.strictEqual(
    isDefaultSpckProductTitle("Web Cửa Hàng Bánh Ngọt", "Nguyễn Minh Khôi"),
    false,
    "isDefaultSpckProductTitle phải chấp nhận tên đề tài sản phẩm cụ thể (S5b.8)"
  );

  // Kiểm tra S5b.8: Ảnh bìa mặc định Logo MindX luôn tồn tại
  assert.ok(
    fs.existsSync(DEFAULT_SPCK_THUMBNAIL_PATH) &&
      fs.statSync(DEFAULT_SPCK_THUMBNAIL_PATH).size > 100,
    "Ảnh bìa mặc định Logo MindX (data/config/default-spck-thumbnail.png) phải tồn tại và hợp lệ"
  );

  // Kiểm tra S5b.6 & S5b.8 trong SpckCommentGenerator.generateBatchSpckComments (mock Gemini fetch)
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-s5b-dummy-key";
  (appConfig as any).geminiApiKey ||= "test-s5b-dummy-key";
  try {
    studentRepo.upsert({
      studentId: "S5B_STU_01",
      classId: "VT-C4K-JSB15",
      fullName: "Nguyễn Minh Khôi",
      isActive: 1,
    });

    globalThis.fetch = async () =>
      Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    attitudeSummary:
                      "Ở Buổi 13 (Giai đoạn 2 - GĐ2), STUDENT_01 thể hiện tinh thần học tập nghiêm túc và chủ động tiếp thu góp ý.",
                    productAndDesignEvaluation:
                      "So với Buổi 12 ở Giai đoạn 1 (GĐ1), sản phẩm của STUDENT_01 đã bổ sung thêm trang giỏ hàng và bộ lọc sản phẩm trực quan.",
                    technicalApplicationEvaluation:
                      "STUDENT_01 cần trau chuốt thêm phần kiểm tra dữ liệu đầu vào ở biểu mẫu thanh toán trước khi bước vào Buổi 14.",
                    presentationEvaluation: "",
                  }),
                },
              ],
            },
          },
        ],
      });

    const batchRes = await SpckCommentGenerator.generateBatchSpckComments(
      {
        classId: "VT-C4K-JSB15",
        sessionNumber: 13,
      },
      [
        {
          studentId: "S5B_STU_01",
          fullName: "Nguyễn Minh Khôi",
          projectTitle: "Web Cửa Hàng Bánh Ngọt",
          quickTags: ["Hoàn thành tốt sản phẩm cuối khóa"],
          teacherNote: "Bổ sung giỏ hàng so với buổi trước",
          priorSession12Summary:
            "Buổi 12 đã nộp khung trang chủ HTML/CSS cơ bản.",
          attachments: [],
        },
      ]
    );

    assert.strictEqual(batchRes.length, 1);
    const aiRes = batchRes[0];
    assert.strictEqual(aiRes.status, "WAITING_APPROVAL");
    const promptSample = aiRes.outboundPromptSample || "";
    assert.ok(
      promptSample.includes("nêu tiến bộ so với Buổi 12"),
      "Prompt Buổi 13 khi có dữ liệu Buổi 12 phải yêu cầu AI 'nêu tiến bộ so với Buổi 12' (S5b.6)"
    );
    assert.ok(
      promptSample.includes("đã nộp khung trang chủ HTML/CSS cơ bản"),
      "Prompt Buổi 13 phải đính kèm tóm tắt kết quả Buổi 12 (S5b.6)"
    );
    assert.ok(
      !/Buổi\s*1[234]|Giai\s*đoạn\s*[12]|GĐ\s*[12]/i.test(
        aiRes.formattedTeacherComment
      ),
      `Nhận xét AI đầu ra phải lọc sạch nhãn nội bộ (Buổi 12/13/14, GĐ1/2): '${aiRes.formattedTeacherComment}' (S5b.8)`
    );

    // =========================================================================
    // [S5b-T5] Kiểm tra Quick Tags & Nhận xét AI theo đúng 6 nhóm môn học ở Buổi 12, 13, 14
    // =========================================================================
    console.log("\n[S5b-T5] Kiểm tra bộ Quick Tags & Nhận xét AI chuyên biệt cho 6 nhóm môn (Scratch, GameMaker, Python App, Web, Computer Science, Robotics)...");

    const expectedPrefixTracks = [
      ["VT-C4K-SB28", "SB", "SCRATCH", "SCRATCH_BASIC"],
      ["HN-SA05", "SA", "SCRATCH", "SCRATCH_ADVANCE"],
      ["HCM-SI12", "SI", "SCRATCH", "SCRATCH_MICROBIT"],
      ["VT-GB10", "GB", "GAMEMAKER", "GAMEMAKER_BASIC"],
      ["DN-GA04", "GA", "GAMEMAKER", "GAMEMAKER_GML"],
      ["HCM-GI02", "GI", "GAMEMAKER", "GAMEMAKER_FSM"],
      ["VT-PTB09", "PTB", "PYTHON_APP", "PYTHON_CLI"],
      ["VT-PTA11", "PTA", "PYTHON_APP", "PYTHON_GUI"],
      ["HCM-PTI03", "PTI", "PYTHON_APP", "PYTHON_GUI"],
      ["VT-JSB16", "JSB", "WEB", "WEB_BASIC"],
      ["HN-JSA08", "JSA", "WEB", "WEB_JS"],
      ["HCM-JSI04", "JSI", "WEB", "WEB_FIREBASE"],
      ["VT-CSB03", "CSB", "COMPUTER_SCIENCE", "CS_ALGO"],
      ["HN-CSA06", "CSA", "COMPUTER_SCIENCE", "CS_DATA_STREAMLIT"],
      ["HCM-CSI02", "CSI", "COMPUTER_SCIENCE", "CS_AI_STREAMLIT"],
      ["VT-PREB14", "PREB", "ROBOTICS", "ROBOTICS_VEXGO"],
      ["VT-PREA05", "PREA", "ROBOTICS", "ROBOTICS_VEXGO"],
      ["VT-PREI02", "PREI", "ROBOTICS", "ROBOTICS_VEXGO"],
      ["VT-ARMB03", "ARMB", "ROBOTICS", "ROBOTICS_VEXIQ"],
      ["VT-ARMA02", "ARMA", "ROBOTICS", "ROBOTICS_VEXIQ"],
      ["VT-ARMI01", "ARMI", "ROBOTICS", "ROBOTICS_VEXIQ"],
      ["VT-SEMIB02", "SEMIB", "ROBOTICS", "ROBOTICS_GENERAL"],
      ["VT-SEMIA01", "SEMIA", "ROBOTICS", "ROBOTICS_GENERAL"],
      ["VT-SEMII01", "SEMII", "ROBOTICS", "ROBOTICS_GENERAL"],
      ["VT-ROB12", "ROB", "ROBOTICS", "ROBOTICS_GENERAL"],
    ] as const;

    for (const [sampleClassId, expPrefix, expTrack, expSubTrack] of expectedPrefixTracks) {
      const prof = detectSpckCourseProfile(sampleClassId);
      assert.strictEqual(
        prof.coursePrefix,
        expPrefix,
        `Lớp ${sampleClassId} phải nhận diện đúng mã khóa ${expPrefix}`
      );
      assert.strictEqual(
        prof.track,
        expTrack,
        `Lớp ${sampleClassId} phải nhận diện đúng nhóm môn ${expTrack}`
      );
      assert.strictEqual(
        prof.subTrack,
        expSubTrack,
        `Lớp ${sampleClassId} phải nhận diện đúng phân nhánh ${expSubTrack}`
      );

      for (const sNum of [12, 13, 14] as const) {
        const bundle = getSpckQuickTagGroups({
          classId: sampleClassId,
          sessionNumber: sNum,
        });
        assert.strictEqual(
          bundle.groups.length,
          2,
          `Lớp ${sampleClassId} ở Buổi ${sNum} phải có đúng 2 hàng nhóm Quick Tags`
        );
        if (sNum === 12 || sNum === 13) {
          assert.strictEqual(bundle.groups[0].id, "progress");
          assert.strictEqual(bundle.groups[1].id, "next_step");
          assert.strictEqual(bundle.groups[0].tags.length, 4);
          assert.strictEqual(bundle.groups[1].tags.length, 3);
          assert.ok(
            bundle.optionalPresentationGroup &&
              bundle.optionalPresentationGroup.tags.length === 2,
            `Buổi ${sNum} phải có nhóm thẻ thuyết trình thử tùy chọn`
          );
          for (const progTag of bundle.groups[0].tags) {
            assert.strictEqual(
              isPresentationQuickTag(progTag),
              false,
              `Thẻ tiến độ '${progTag}' tuyệt đối không được nhận nhầm là thẻ thuyết trình (F01)`
            );
            assert.strictEqual(
              detectPresentationEvidence([progTag], "", false),
              false,
              `Thẻ tiến độ '${progTag}' tuyệt đối không được bật detectPresentationEvidence (F01)`
            );
            assert.strictEqual(
              isLimitationOrNextStepQuickTag(progTag),
              false,
              `Thẻ tiến độ '${progTag}' tuyệt đối không được nhận nhầm là thẻ hạn chế (F04)`
            );
            assert.strictEqual(
              detectLimitationEvidence([progTag], ""),
              false,
              `Thẻ tiến độ '${progTag}' tuyệt đối không được bật detectLimitationEvidence (F04)`
            );
          }
          for (const limTag of bundle.groups[1].tags) {
            assert.strictEqual(
              isPresentationQuickTag(limTag),
              false,
              `Thẻ định hướng '${limTag}' (kể cả nhắc chuẩn bị Slide cho buổi 14) không được coi là đã thuyết trình (F01)`
            );
            assert.strictEqual(
              detectPresentationEvidence([limTag], "", false),
              false,
              `Thẻ định hướng '${limTag}' không được bật detectPresentationEvidence (F01)`
            );
            assert.strictEqual(
              isLimitationOrNextStepQuickTag(limTag),
              true,
              `Thẻ định hướng '${limTag}' phải được nhận diện bởi isLimitationOrNextStepQuickTag`
            );
            assert.strictEqual(
              detectLimitationEvidence([limTag], ""),
              true,
              `Thẻ định hướng '${limTag}' phải được detectLimitationEvidence nhận diện`
            );
          }
        } else {
          assert.strictEqual(bundle.groups[0].id, "presentation");
          assert.strictEqual(bundle.groups[1].id, "product");
          assert.ok(bundle.groups[0].tags.length >= 5);
          assert.ok(bundle.groups[1].tags.length >= 5);
          for (const presTag of bundle.groups[0].tags) {
            assert.strictEqual(
              isPresentationQuickTag(presTag),
              true,
              `Thẻ thuyết trình '${presTag}' phải được nhận diện bởi isPresentationQuickTag`
            );
            assert.strictEqual(
              detectPresentationEvidence([presTag], "", false),
              true,
              `Chọn thẻ thuyết trình '${presTag}' phải tự kích hoạt detectPresentationEvidence = true kể cả khi cờ cũ là false`
            );
          }
          for (const prodTag of bundle.groups[1].tags) {
            assert.strictEqual(
              isPresentationQuickTag(prodTag),
              false,
              `Thẻ sản phẩm '${prodTag}' tuyệt đối không được nhận nhầm là thẻ thuyết trình (F01)`
            );
            assert.strictEqual(
              detectPresentationEvidence([prodTag], "", false),
              false,
              `Thẻ sản phẩm '${prodTag}' tuyệt đối không được bật detectPresentationEvidence (F01)`
            );
            const expectLim = /^🔧/u.test(prodTag);
            assert.strictEqual(
              isLimitationOrNextStepQuickTag(prodTag),
              expectLim,
              `Thẻ sản phẩm '${prodTag}' phải phân loại limitation = ${expectLim} (F04)`
            );
            assert.strictEqual(
              detectLimitationEvidence([prodTag], ""),
              expectLim,
              `Thẻ sản phẩm '${prodTag}' phải có detectLimitationEvidence = ${expectLim} (F04)`
            );
          }
        }
      }
    }

    // Kiểm tra F05-R2: Bộ đọc CSV RFC-4180 (tối đa 5 dòng dữ liệu, ô có dấu phẩy trong ngoặc kép & ô nhiều dòng trong ngoặc kép)
    {
      const csv20 =
        "name,score\n" +
        Array.from({ length: 20 }, (_, i) => `STUDENT_${i},${i}`).join("\n");
      const rBound = parseCodeBuffer(Buffer.from(csv20), "dataset.csv", ".csv");
      assert.strictEqual(rBound.success, true);
      assert.match(rBound.extractedText, /Số dòng dữ liệu: 20 \| Số cột: 2/);
      const previewCount = rBound.extractedText
        .split("\n")
        .filter((x) => /^\s*\d+ \|/.test(x)).length;
      assert.strictEqual(previewCount, 6);
      assert.doesNotMatch(rBound.extractedText, /STUDENT_5,/);

      const rQuotedHeader = parseCodeBuffer(
        Buffer.from('"student,name",score\n"Nguyen, An",9'),
        "quoted.csv",
        ".csv"
      );
      assert.strictEqual(rQuotedHeader.success, true);
      assert.deepStrictEqual(rQuotedHeader.summary.classes, ["student,name", "score"]);
      assert.match(rQuotedHeader.extractedText, /Số dòng dữ liệu: 1 \| Số cột: 2/);

      const rMultiline = parseCodeBuffer(
        Buffer.from('name,note\nAn,"line1\nline2"\nBinh,ok'),
        "multiline.csv",
        ".csv"
      );
      assert.strictEqual(rMultiline.success, true);
      assert.match(rMultiline.extractedText, /Số dòng dữ liệu: 2 \| Số cột: 2/);
    }

    // Kiểm tra AI Prompt & Sanitizer Buổi 14 cho các môn khác nhau (Scratch, GameMaker, Python PTB/PTA, CS CSA/CSB, Robotics PREB)
    const subjectTestCases = [
      {
        classId: "VT-C4K-SB28",
        expectPromptKeyword: "Scratch Basic (SB)",
        forbidWebTerms: true,
      },
      {
        classId: "VT-GA04",
        expectPromptKeyword: "GameMaker Advance (GA)",
        forbidWebTerms: true,
      },
      {
        classId: "VT-PTB09",
        expectPromptKeyword: "Python Basic (PTB)",
        forbidWebTerms: true,
      },
      {
        classId: "VT-PTA11",
        expectPromptKeyword: "Python App PyQt6 (PTA)",
        forbidWebTerms: true,
      },
      {
        classId: "VT-CSB03",
        expectPromptKeyword: "Computer Science Basic (CSB)",
        forbidWebTerms: true,
      },
      {
        classId: "VT-CSA06",
        expectPromptKeyword: "Computer Science Advance - Data & Streamlit (CSA)",
        forbidWebTerms: true,
      },
      {
        classId: "VT-PREB14",
        expectPromptKeyword: "Robotics VEX GO Basic (PREB)",
        forbidWebTerms: true,
      },
      {
        classId: "VT-JSB16",
        expectPromptKeyword: "Web Basic (JSB)",
        forbidWebTerms: false,
      },
    ];

    globalThis.fetch = async () =>
      Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    attitudeSummary:
                      "STUDENT_01 đã hoàn thiện website sản phẩm cuối khóa với bố cục Flexbox rõ ràng.",
                    productAndDesignEvaluation:
                      "Em đã vận dụng kiến thức HTML, CSS, JavaScript để xây dựng các chức năng hoạt động ổn định.",
                    technicalApplicationEvaluation:
                      "Giáo viên đánh giá cao sự nỗ lực của em, tuy nhiên em cần tinh chỉnh thêm một số chi tiết nhỏ để sản phẩm hoàn thiện hơn.",
                    presentationEvaluation:
                      "STUDENT_01 chuẩn bị slide đẹp mắt, bố cục rõ ràng và trình bày tự tin trước lớp.",
                  }),
                },
              ],
            },
          },
        ],
      });

    for (const tc of subjectTestCases) {
      studentRepo.upsert({
        studentId: "S5B_STU_01",
        classId: tc.classId,
        fullName: "Nguyễn Minh Khôi",
        isActive: 1,
      });
      const s14Bundle = getSpckQuickTagGroups({
        classId: tc.classId,
        sessionNumber: 14,
      });
      const chosenPresTag = s14Bundle.groups[0].tags[0]; // Thẻ thuyết trình
      const chosenProdTag = s14Bundle.groups[1].tags[0]; // Thẻ sản phẩm theo môn

      const res14 = await SpckCommentGenerator.generateBatchSpckComments(
        {
          classId: tc.classId,
          sessionNumber: 14,
        },
        [
          {
            studentId: "S5B_STU_01",
            fullName: "Nguyễn Minh Khôi",
            projectTitle: "Dự Án Cuối Khóa Thông Minh",
            quickTags: [chosenPresTag, chosenProdTag],
            teacherNote: "",
            includePresentation: false, // Kiểm tra chọn thẻ thuyết trình tự bật nhận xét 2 phần!
            attachments: [],
          },
        ]
      );
      assert.strictEqual(res14.length, 1);
      const item14 = res14[0];
      assert.strictEqual(item14.status, "WAITING_APPROVAL");
      assert.strictEqual(
        item14.hasPresentationEvidence,
        true,
        `Khi chọn thẻ thuyết trình '${chosenPresTag}' ở lớp ${tc.classId}, hasPresentationEvidence phải bằng true`
      );
      assert.ok(
        item14.outboundPromptSample?.includes(tc.expectPromptKeyword),
        `Prompt Buổi 14 của lớp ${tc.classId} phải chứa hướng dẫn chuyên môn '${tc.expectPromptKeyword}'`
      );
      assert.ok(
        item14.formattedTeacherComment.includes("1. Về phần thuyết trình") &&
          item14.formattedTeacherComment.includes("2. Về phần sản phẩm cuối khóa"),
        `Nhận xét Buổi 14 khi chọn thẻ thuyết trình phải xuất đúng cấu trúc 2 phần cho lớp ${tc.classId}`
      );
      if (tc.forbidWebTerms) {
        assert.ok(
          !/\b(website|Flexbox|HTML,\s*CSS)\b/i.test(item14.formattedTeacherComment),
          `Nhận xét đầu ra của môn ${tc.classId} phải tự động lọc sạch thuật ngữ Web bịa đặt (website/Flexbox/HTML, CSS): '${item14.formattedTeacherComment}'`
        );
      }
    }
    console.log("  -> PASS [S5b-T5]: Bộ Quick Tags & Nhận xét AI chuyên biệt cho cả 6 nhóm môn (25 mã khóa) ở Buổi 12, 13, 14 hoạt động chính xác.");

    // =========================================================================
    // [S5b-T6] Kiểm tra 5 hạng mục nâng cấp SPCK Buổi 12-13-14 (Coding & Robotics)
    // =========================================================================
    console.log("\n[S5b-T6] Kiểm tra 5 hạng mục nâng cấp: Đồng bộ 12->13->14, Chống trùng Drive/LMS, Luồng Robotics chuyên biệt, Deep Project Inspector + Multimodal Vision & Giọng văn kiểm tra tiến độ...");
    const tmpT6Root = path.resolve(ROOT, "temp_submissions", `tmp_s5b_t6_${Date.now()}`);
    fs.mkdirSync(tmpT6Root, { recursive: true });
    const makeTestPng = (w: number, h: number, seed = 42): Buffer => {
      const crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
      const crc32 = (buf: Buffer) => {
        let c = 0xffffffff;
        for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
      };
      const chunk = (type: string, data: Buffer) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length, 0);
        const t = Buffer.from(type, "ascii");
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
        return Buffer.concat([len, t, data, crc]);
      };
      const ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(w, 0);
      ihdr.writeUInt32BE(h, 4);
      ihdr[8] = 8;
      ihdr[9] = 2;
      const stride = w * 3 + 1;
      const raw = Buffer.alloc(stride * h);
      for (let y = 0; y < h; y++) {
        raw[y * stride] = 0;
        for (let x = 0; x < w; x++) {
          const idx = y * stride + 1 + x * 3;
          raw[idx] = (x + y + seed) & 0xff;
          raw[idx + 1] = ((x * 3) ^ (y + seed)) & 0xff;
          raw[idx + 2] = ((x + y * 5 + seed * 7) & 0xff);
        }
      }
      return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk("IHDR", ihdr),
        chunk("IDAT", zlib.deflateSync(raw)),
        chunk("IEND", Buffer.alloc(0)),
      ]);
    };

    try {
      // 1. Kiểm tra khởi tạo thư mục học viên ("init_student_folders") & Luồng Robotics chỉ có ảnh
      const robClassId = "VT-PREB99";
      for (const sNum of [12, 13, 14] as const) {
        classSessionRepo.upsert({
          sessionId: `${robClassId}_S${sNum}`,
          classId: robClassId,
          className: "Lớp Robotics VEX GO",
          sessionNumber: sNum,
          topic: `Buổi ${sNum}`,
          date: `2026-10-${10 + sNum}`,
        });
      }
      studentRepo.upsert({
        studentId: "S5B_ROB_01",
        classId: robClassId,
        fullName: "Lê Hoàng Bách",
        isActive: 1,
      });
      const robClassDir = path.join(tmpT6Root, robClassId);
      fs.mkdirSync(robClassDir, { recursive: true });

      const initResp = await scanPost(
        new Request("http://127.0.0.1:3000/api/spck/scan", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            host: "127.0.0.1:3000",
            origin: "http://127.0.0.1:3000",
          },
          body: JSON.stringify({
            classId: robClassId,
            folderPath: robClassDir,
            sessionNumber: 12,
            action: "init_student_folders",
            syncActiveSession: true,
            autoSuggestQuickTags: true,
          }),
        })
      );
      const initJson = await initResp.json();
      assert.strictEqual(
        initJson.success,
        true,
        `init_student_folders phải thành công (${initJson.error || ""})`
      );
      assert.strictEqual(initJson.createdFoldersCount, 1, "Phải tạo đúng 1 thư mục học viên mới");
      const bachDir = path.join(robClassDir, "Lê Hoàng Bách");
      assert.ok(fs.existsSync(bachDir), "Thư mục 'Lê Hoàng Bách' phải tồn tại trên ổ cứng");

      // Thư mục rỗng vừa tạo chưa có bài -> không tự gợi ý Quick Tags
      const emptyDraft12 = spckSessionRepo.getOrInitSessionDraft(
        robClassId,
        "S5B_ROB_01",
        12,
        "Lê Hoàng Bách"
      );
      assert.deepStrictEqual(
        JSON.parse(emptyDraft12.quickTagsJson || "[]"),
        [],
        "Thư mục rỗng vừa tạo chưa có ảnh/file thì không được tự tích chọn Quick Tags"
      );

      // Thả 2 ảnh vào thư mục Robotics: 1 ảnh dọc (400x600) và 1 ảnh ngang toàn cảnh (800x450)
      fs.writeFileSync(path.join(bachDir, "01_portrait_detail.png"), makeTestPng(400, 600, 10));
      fs.writeFileSync(path.join(bachDir, "02_landscape_model.png"), makeTestPng(800, 450, 20));
      const robScannedOnlyPhotos = scanStudentSpckFolder(bachDir, "Lê Hoàng Bách");
      assert.strictEqual(
        path.basename(robScannedOnlyPhotos.thumbnailPath),
        "02_landscape_model.png",
        "Khi có nhiều ảnh Owner chụp mô hình, phải ưu tiên ảnh ngang (landscape/16:9) làm Thumbnail"
      );
      assert.strictEqual(
        robScannedOnlyPhotos.attachments.length,
        0,
        "Thư mục Robotics chỉ có ảnh chụp của Owner tuyệt đối KHÔNG được tạo file _robotics_package.zip"
      );
      assert.strictEqual(
        fs.readdirSync(bachDir).some((f) => f.endsWith("_robotics_package.zip")),
        false,
        "Không được sinh file _robotics_package.zip trên đĩa khi chỉ có ảnh"
      );

      // Kiểm tra thư mục Robotics chỉ có 1 ảnh duy nhất của Owner -> vẫn giữ ảnh đó ở screenshots để LMS không trống
      const singlePhotoDir = path.join(tmpT6Root, "SinglePhotoRobot");
      fs.mkdirSync(singlePhotoDir, { recursive: true });
      fs.writeFileSync(path.join(singlePhotoDir, "only_photo.png"), makeTestPng(800, 450, 33));
      const singlePhotoPkg = scanStudentSpckFolder(singlePhotoDir, "Single Photo");
      assert.strictEqual(path.basename(singlePhotoPkg.thumbnailPath), "only_photo.png");
      assert.strictEqual(
        singlePhotoPkg.screenshots.length,
        1,
        "Khi thư mục chỉ có 1 ảnh Owner duy nhất và 0 ảnh khác, phải giữ ảnh đó trong screenshots để không trống ô LMS"
      );

      // Thêm file code Robotics (.vexblocks) -> tạo _robotics_package.zip tất định (SHA-256 cố định qua nhiều lần quét)
      fs.writeFileSync(path.join(bachDir, "robot_arm.vexblocks"), '{"blocks":["move_forward","claw_grab"]}');
      const robScannedWithCode1 = scanStudentSpckFolder(bachDir, "Lê Hoàng Bách");
      assert.strictEqual(robScannedWithCode1.attachments.length, 1);
      const zipPath1 = robScannedWithCode1.attachments[0];
      assert.ok(zipPath1.endsWith("_robotics_package.zip"));
      const sha1 = crypto.createHash("sha256").update(fs.readFileSync(zipPath1)).digest("hex");
      const robScannedWithCode2 = scanStudentSpckFolder(bachDir, "Lê Hoàng Bách");
      const sha2 = crypto
        .createHash("sha256")
        .update(fs.readFileSync(robScannedWithCode2.attachments[0]))
        .digest("hex");
      assert.strictEqual(
        sha1,
        sha2,
        "Gói nén _robotics_package.zip phải hoàn toàn tất định (deterministic SHA-256) khi quét lại"
      );

      // 2. Kiểm tra đồng bộ tài nguyên giữa các buổi (12 -> 13) & Auto-suggest Quick Tags
      await scanPost(
        new Request("http://127.0.0.1:3000/api/spck/scan", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            host: "127.0.0.1:3000",
            origin: "http://127.0.0.1:3000",
          },
          body: JSON.stringify({
            classId: robClassId,
            folderPath: robClassDir,
            sessionNumber: 12,
            syncActiveSession: true,
            autoSuggestQuickTags: true,
          }),
        })
      );
      const draft12AfterScan = spckSessionRepo.getOrInitSessionDraft(
        robClassId,
        "S5B_ROB_01",
        12,
        "Lê Hoàng Bách"
      );
      const autoTags12 = JSON.parse(draft12AfterScan.quickTagsJson || "[]");
      assert.ok(
        autoTags12.length >= 2,
        `Khi thư mục đã có ảnh/file sản phẩm, quét với autoSuggestQuickTags=true phải tự gợi ý Quick Tags: ${JSON.stringify(autoTags12)}`
      );

      // Giả lập Buổi 12 đã nộp thành công (VERIFIED)
      spckSessionRepo.saveSessionDraft({
        classId: robClassId,
        studentId: "S5B_ROB_01",
        sessionNumber: 12,
        teacherComment: "Ở buổi kiểm tra tiến độ này, con đã lắp xong khung cơ khí.",
        updateSharedPool: true,
      });
      spckSessionRepo.approveSessionDraft(robClassId, "S5B_ROB_01", 12);
      spckUploadRepo.markVerified(robClassId, "S5B_ROB_01", undefined, 12);

      // Sang Buổi 13: khởi tạo nháp Buổi 13 trước, sau đó Owner thêm ảnh mới 03_sensor_upgrade.png vào thư mục và bấm Quét
      spckSessionRepo.getOrInitSessionDraft(robClassId, "S5B_ROB_01", 13, "Lê Hoàng Bách");
      fs.writeFileSync(path.join(bachDir, "03_sensor_upgrade.png"), makeTestPng(800, 450, 99));
      const scan13Resp = await scanPost(
        new Request("http://127.0.0.1:3000/api/spck/scan", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            host: "127.0.0.1:3000",
            origin: "http://127.0.0.1:3000",
          },
          body: JSON.stringify({
            classId: robClassId,
            folderPath: robClassDir,
            sessionNumber: 13,
            syncActiveSession: true,
            autoSuggestQuickTags: true,
          }),
        })
      );
      const scan13Json = await scan13Resp.json();
      assert.strictEqual(scan13Json.success, true);
      const draft13Synced = spckSessionRepo.getOrInitSessionDraft(
        robClassId,
        "S5B_ROB_01",
        13,
        "Lê Hoàng Bách"
      );
      const s13Shots: string[] = JSON.parse(draft13Synced.screenshotsJson || "[]");
      assert.strictEqual(
        s13Shots.length,
        2,
        "Khi quét ở Buổi 13 với syncActiveSession=true, bản nháp Buổi 13 phải tự nhận ngay ảnh mới vừa thêm"
      );
      const s12Preserved = spckSessionRepo.getOrInitSessionDraft(
        robClassId,
        "S5B_ROB_01",
        12,
        "Lê Hoàng Bách"
      );
      assert.strictEqual(
        s12Preserved.draftStatus,
        "VERIFIED",
        "Bản ghi Buổi 12 đã VERIFIED phải giữ nguyên bất biến khi quét và đồng bộ ở Buổi 13"
      );

      // 3. Kiểm tra chuẩn bị file Google Drive (chặn thư mục nội bộ _spck_* và gói *_package.zip) & nhận diện khóa Robotics
      assert.strictEqual(detectCoursePrefixFromClassId("VT-PREB14"), "PREB");
      assert.strictEqual(detectCoursePrefixFromClassId("HN-ARMA02"), "ARMA");
      assert.strictEqual(detectCoursePrefixFromClassId("HCM-SEMIB01"), "SEMIB");
      assert.strictEqual(isRoboticsCourseClassId("VT-PREB14"), true);
      assert.strictEqual(isRoboticsCourseClassId("VT-JSB15"), false);
      assert.strictEqual(
        resolveCourseSpecificFolderId("TEST_ROBO_UNCONFIGURED_01"),
        null,
        "Mã lớp không thuộc danh mục chuẩn phải trả về null"
      );

      fs.mkdirSync(path.join(bachDir, "_spck_app_shots"), { recursive: true });
      fs.writeFileSync(path.join(bachDir, "_spck_app_shots", "shot.png"), makeTestPng(320, 180, 5));
      const drivePrep = prepareStudentFilesForDriveUpload(
        bachDir,
        "S5B_ROB_01",
        "Lê Hoàng Bách"
      );
      assert.strictEqual(
        drivePrep.some((f) => f.endsWith("_robotics_package.zip")),
        false,
        "prepareStudentFilesForDriveUpload tuyệt đối không được đẩy gói nén nội bộ *_robotics_package.zip lên Google Drive"
      );
      assert.strictEqual(
        drivePrep.some((f) => f.includes("_spck_app_shots")),
        false,
        "prepareStudentFilesForDriveUpload tuyệt đối không được đẩy các thư mục nội bộ _spck_* lên Google Drive"
      );

      // 4. Kiểm tra Deep Project Inspector + Chống bịa tính năng Web (Bootstrap/Giỏ hàng/LocalStorage/Fetch) + Multimodal Vision + Giọng văn kiểm tra tiến độ Buổi 12
      const webStuDir = path.join(tmpT6Root, "WebStudent_Boba");
      fs.mkdirSync(webStuDir, { recursive: true });
      fs.writeFileSync(
        path.join(webStuDir, "index.html"),
        `<!DOCTYPE html>
<html>
<head><title>Tiệm Trà Sữa Mùa Hè</title><link rel="stylesheet" href="style.css"></head>
<body>
  <nav><a href="#home">Trang chủ</a><a href="#menu">Thực đơn trà sữa</a><a href="#contact">Liên hệ</a></nav>
  <h1>Tiệm Trà Sữa Mùa Hè</h1>
  <h2>Danh sách đồ uống nổi bật</h2>
  <form><input type="text" placeholder="Tìm trà sữa..." /><button type="submit">Tìm kiếm</button></form>
</body>
</html>`,
        "utf8"
      );
      fs.writeFileSync(
        path.join(webStuDir, "style.css"),
        `.menu-list { display: flex; gap: 16px; } @keyframes floatIn { from { opacity: 0; } to { opacity: 1; } }`,
        "utf8"
      );
      const webThumbPath = path.join(webStuDir, "Demo_web.png");
      fs.writeFileSync(webThumbPath, makeTestPng(800, 450, 77));

      let capturedGeminiBody: any = null;
      globalThis.fetch = async (_input: any, init?: any) => {
        if (init && typeof init.body === "string") {
          try {
            capturedGeminiBody = JSON.parse(init.body);
          } catch {}
        }
        return Response.json({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      attitudeSummary:
                        "Trong Buổi 12 (Giai đoạn 1), STUDENT_01 đã hoàn thiện trang chủ Tiệm Trà Sữa Mùa Hè với thanh điều hướng Thực đơn trà sữa rõ ràng.",
                      productAndDesignEvaluation:
                        "Em đã sử dụng Bootstrap 5 để chia cột kết hợp chức năng giỏ hàng, LocalStorage và gọi Fetch API rất mượt mà.",
                      technicalApplicationEvaluation:
                        "Ở Buổi 13 sắp tới, em cần hoàn thiện thêm các trang con còn đang để trống để sản phẩm chỉn chu hơn.",
                      presentationEvaluation: "",
                    }),
                  },
                ],
              },
            },
          ],
        });
      };

      studentRepo.upsert({
        studentId: "S5B_WEB_01",
        classId: "VT-C4K-JSB15",
        fullName: "Phạm Gia Hưng",
        isActive: 1,
      });
      const deepWebRes = await SpckCommentGenerator.generateBatchSpckComments(
        {
          classId: "VT-C4K-JSB15",
          sessionNumber: 12,
        },
        [
          {
            studentId: "S5B_WEB_01",
            fullName: "Phạm Gia Hưng",
            projectTitle: "Tiệm Trà Sữa Mùa Hè",
            localFolderPath: webStuDir,
            thumbnailPath: webThumbPath,
            screenshots: [webThumbPath],
            quickTags: [
              "✅ Đã dựng xong khung giao diện các trang chính và thanh điều hướng",
              "🔧 Cần hoàn thiện thêm nội dung các trang con/mục con còn đang để trống",
            ],
            teacherNote: "",
            attachments: [path.join(webStuDir, "index.html"), path.join(webStuDir, "style.css")],
          },
        ]
      );
      assert.strictEqual(deepWebRes.length, 1);
      const webCommentItem = deepWebRes[0];
      assert.strictEqual(webCommentItem.status, "WAITING_APPROVAL");
      const webPrompt = webCommentItem.outboundPromptSample || "";
      assert.ok(
        webPrompt.includes("Tiệm Trà Sữa Mùa Hè") &&
          webPrompt.includes("Thực đơn trà sữa") &&
          webPrompt.includes("CẢNH BÁO CHỐNG BỊA ĐẶT TÍNH NĂNG WEB"),
        "Deep Project Inspector phải trích xuất đúng tiêu đề trang, mục menu <nav> và danh sách kỹ thuật KHÔNG CÓ trong code của học sinh"
      );
      const sentParts = capturedGeminiBody?.contents?.[0]?.parts || [];
      assert.ok(
        sentParts.some((p: any) => p.inlineData && p.inlineData.mimeType === "image/png"),
        "SpckCommentGenerator phải đính kèm ảnh chụp thực tế của sản phẩm (Multimodal inlineData) khi gọi Gemini API"
      );
      assert.ok(
        !/\b(Bootstrap|LocalStorage|Fetch\s*API|giỏ\s*hàng|Buổi\s*12|Buổi\s*13|đợt\s*thực\s*hiện\s*dự\s*án)\b/i.test(
          webCommentItem.formattedTeacherComment
        ),
        `Hậu kiểm phải lọc sạch các tính năng Web không có trong bài (Bootstrap/LocalStorage/Fetch API/giỏ hàng) và dùng giọng văn kiểm tra tiến độ tự nhiên: '${webCommentItem.formattedTeacherComment}'`
      );
      assert.ok(
        /ở buổi kiểm tra tiến độ tiếp theo/i.test(webCommentItem.formattedTeacherComment),
        `Nhận xét tiến độ phải chuyển tự nhiên sang 'ở buổi kiểm tra tiến độ tiếp theo': '${webCommentItem.formattedTeacherComment}'`
      );

      // 5. Kiểm tra hồi quy các trường hợp biên đối kháng (F01-F10):
      // - F01: Chỉ có PDF không được tự suy diễn thẻ thuyết trình hoặc lắp ráp robot
      assert.deepStrictEqual(
        suggestSpckQuickTagsFromProject({
          classId: robClassId,
          sessionNumber: 14,
          fileExtensions: [".pdf"],
          attachmentCount: 1,
          slideCount: 1,
        }),
        [],
        "F01: Chỉ có 1 file PDF không được tự động gợi ý thẻ thuyết trình hoặc chất lượng mô hình"
      );
      assert.deepStrictEqual(
        suggestSpckQuickTagsFromProject({
          classId: "VT-C4K-JSA15",
          sessionNumber: 13,
          fileExtensions: [".js"],
        }),
        [],
        "R2-F01-01: Chỉ có đuôi .js chưa kiểm chứng mã nguồn thì không được tự lưu thẻ hoàn thiện tương tác"
      );
      assert.deepStrictEqual(
        suggestSpckQuickTagsFromProject({
          classId: robClassId,
          sessionNumber: 13,
          screenshotCount: 1,
        }),
        [],
        "R2-F01-03: Chỉ có số lượng 1 ảnh không được tự khẳng định robot hoàn thiện chắc chắn hay có cảm biến/động cơ"
      );
      const r3TagsClick = suggestSpckQuickTagsFromProject({
        classId: "VT-C4K-JSA15",
        sessionNumber: 12,
        hasEventBinding: true,
        hasDomUpdate: true,
        hasJsInteraction: true,
      });
      assert.ok(
        !r3TagsClick.some((t) => /Array\/Object|cấu trúc dữ liệu JavaScript|cần đẩy nhanh/i.test(t)),
        `R3-F01-01: Chỉ gắn sự kiện click đổi textContent không được tự lưu thẻ Array/Object hay đánh giá tốc độ: ${JSON.stringify(r3TagsClick)}`
      );
      // - F07 & F08: Hợp nhất attachment JS ngoài thư mục HTML & phân biệt chuỗi hiển thị kế hoạch với mã thực thi thật
      const r3MixDir = path.join(tmpT6Root, "R3MixedWeb");
      const r3SubProj = path.join(r3MixDir, "project");
      fs.mkdirSync(r3SubProj, { recursive: true });
      const r3HtmlPath = path.join(r3SubProj, "index.html");
      const r3LooseJsPath = path.join(r3MixDir, "feature.js");
      fs.writeFileSync(r3HtmlPath, '<title>Plants</title><script src="../feature.js"></script>', "utf8");
      fs.writeFileSync(
        r3LooseJsPath,
        'import { initializeApp } from "firebase/app"; initializeApp({}); localStorage.setItem("x", "y");',
        "utf8"
      );
      const r3MixSummary = buildPreliminaryProjectSummary(
        [r3HtmlPath, r3LooseJsPath],
        "Phạm Gia Hưng",
        "STUDENT_01",
        [],
        r3SubProj
      );
      assert.strictEqual(
        r3MixSummary.absentWebFeatures.noFirebase,
        false,
        "R3-F07-02: File JS hợp lệ ở attachments ngoài thư mục con vẫn phải được hợp nhất vào phân tích sâu"
      );
      assert.strictEqual(
        r3MixSummary.absentWebFeatures.noLocalStorage,
        false,
        "R3-F07-02: localStorage trong file JS đính kèm ngoài thư mục phải được ghi nhận"
      );

      const r3PlanStringDir = path.join(tmpT6Root, "R3PlanStringWeb");
      fs.mkdirSync(r3PlanStringDir, { recursive: true });
      const r3PlanHtml = path.join(r3PlanStringDir, "index.html");
      fs.writeFileSync(
        r3PlanHtml,
        '<title>Plants</title><script>const helpText="Next session we will add Firebase Firestore localStorage login shopping cart"; document.body.textContent=helpText;</script>',
        "utf8"
      );
      const r3PlanSummary = buildPreliminaryProjectSummary(
        [],
        "Phạm Gia Hưng",
        "STUDENT_01",
        [],
        r3PlanStringDir
      );
      assert.strictEqual(r3PlanSummary.absentWebFeatures.noFirebase, true, "R3-F08-01: Chuỗi hiển thị kế hoạch không phải Firebase thật");
      assert.strictEqual(r3PlanSummary.absentWebFeatures.noLocalStorage, true, "R3-F08-01: Chuỗi hiển thị kế hoạch không phải LocalStorage thật");
      assert.strictEqual(r3PlanSummary.absentWebFeatures.noAuth, true, "R3-F08-01: Chuỗi hiển thị kế hoạch không phải Auth thật");
      assert.strictEqual(r3PlanSummary.absentWebFeatures.noCart, true, "R3-F08-01: Chuỗi hiển thị kế hoạch không phải Cart thật");

      // - R4-F07-01: Trùng basename (project/main.js vs ../shared/main.js chưa đọc) phải giữ trạng thái unknown
      const r4BaseCollisionRoot = path.join(tmpT6Root, "R4BasenameCollision");
      const r4ProjDir = path.join(r4BaseCollisionRoot, "project");
      const r4SharedDir = path.join(r4BaseCollisionRoot, "shared");
      fs.mkdirSync(r4ProjDir, { recursive: true });
      fs.mkdirSync(r4SharedDir, { recursive: true });
      fs.writeFileSync(path.join(r4ProjDir, "index.html"), '<title>Plants</title><script src="../shared/main.js"></script>', "utf8");
      fs.writeFileSync(path.join(r4ProjDir, "main.js"), 'console.log("static");', "utf8");
      fs.writeFileSync(path.join(r4SharedDir, "main.js"), 'import { initializeApp } from "firebase/app"; initializeApp({}); localStorage.setItem("x", "y");', "utf8");
      const r4BaseCollisionSummary = buildPreliminaryProjectSummary([], "Phạm Gia Hưng", "STUDENT_01", [], r4ProjDir);
      assert.notStrictEqual(r4BaseCollisionSummary.absentWebFeatures.noFirebase, true, "R4-F07-01: Không được kết luận noFirebase=true khi ../shared/main.js chưa được đọc");
      assert.ok(!r4BaseCollisionSummary.summaryText.includes("KHÔNG có ["), "R4-F07-01: Không được phát cảnh báo KHÔNG có [...] khi script tham chiếu chưa đọc");

      // - R4-F08-01 & R4-F08-04: Chuỗi ví dụ import không tính là Firebase, nhưng biểu thức ${...} trong template literal vẫn giữ mã thực thi
      const r4ImportStrDir = path.join(tmpT6Root, "R4ImportStrWeb");
      fs.mkdirSync(r4ImportStrDir, { recursive: true });
      fs.writeFileSync(
        path.join(r4ImportStrDir, "index.html"),
        `<title>Import guide</title><script>const helpText = "import { initializeApp } from 'firebase/app'"; document.body.textContent = helpText;</script>`,
        "utf8"
      );
      const r4ImportStrSummary = buildPreliminaryProjectSummary([], "Phạm Gia Hưng", "STUDENT_01", [], r4ImportStrDir);
      assert.strictEqual(r4ImportStrSummary.absentWebFeatures.noFirebase, true, "R4-F08-01: Chuỗi ví dụ import không phải câu lệnh import thật");

      const r4TplExprDir = path.join(tmpT6Root, "R4TplExprWeb");
      fs.mkdirSync(r4TplExprDir, { recursive: true });
      fs.writeFileSync(
        path.join(r4TplExprDir, "index.html"),
        "<title>Plants</title><script>const text = `${localStorage.setItem('x','y')} ${fetch('/api/products')}`;document.body.textContent=text;</script>",
        "utf8"
      );
      const r4TplExprSummary = buildPreliminaryProjectSummary([], "Phạm Gia Hưng", "STUDENT_01", [], r4TplExprDir);
      assert.strictEqual(r4TplExprSummary.absentWebFeatures.noLocalStorage, false, "R4-F08-04: Biểu thức ${localStorage.setItem(...)} phải được nhận diện");
      assert.strictEqual(r4TplExprSummary.absentWebFeatures.noFetchApi, false, "R4-F08-04: Biểu thức ${fetch(...)} phải được nhận diện");

      // - R5-F08-01 & R5-F08-02: Chuỗi <style> bên trong <script> không được tính là CSS/Bootstrap thật; regex literal /initializeApp()/ không được tính là lời gọi Firebase
      const r5StyleInScriptDir = path.join(tmpT6Root, "R5StyleInScriptWeb");
      fs.mkdirSync(r5StyleInScriptDir, { recursive: true });
      fs.writeFileSync(
        path.join(r5StyleInScriptDir, "index.html"),
        '<title>CSS guide</title><script>const helpText = \'<style>@import "bootstrap.css";.demo{display:flex}</style>\'; document.body.textContent = helpText;</script>',
        "utf8"
      );
      const r5StyleInScriptSummary = buildPreliminaryProjectSummary([], "Phạm Gia Hưng", "STUDENT_01", [], r5StyleInScriptDir);
      assert.strictEqual(r5StyleInScriptSummary.absentWebFeatures.noBootstrap, true, "R5-F08-01: Chuỗi <style> trong JS không phải Bootstrap thật");
      assert.ok(!/CSS Flexbox/i.test(r5StyleInScriptSummary.summaryText), "R5-F08-01: Chuỗi <style> trong JS không phải CSS Flexbox thật");

      const r5RegexLitDir = path.join(tmpT6Root, "R5RegexLitWeb");
      fs.mkdirSync(r5RegexLitDir, { recursive: true });
      fs.writeFileSync(
        path.join(r5RegexLitDir, "index.html"),
        "<title>Regex guide</title><script>const pattern = /initializeApp()/; document.body.textContent = pattern.source;</script>",
        "utf8"
      );
      const r5RegexLitSummary = buildPreliminaryProjectSummary([], "Phạm Gia Hưng", "STUDENT_01", [], r5RegexLitDir);
      assert.strictEqual(r5RegexLitSummary.absentWebFeatures.noFirebase, true, "R5-F08-02: Regex literal /initializeApp()/ không phải lời gọi Firebase thật");

      // - R6-F08-01 & R6-F08-02: Regex sau khối lệnh (if (true) {} /initializeApp()/) không phải Firebase; phép chia sau postfix ++ (n++ / initializeApp({}) / 2) giữ nguyên lời gọi thật
      const r6BlockRegexDir = path.join(tmpT6Root, "R6BlockRegexWeb");
      fs.mkdirSync(r6BlockRegexDir, { recursive: true });
      fs.writeFileSync(
        path.join(r6BlockRegexDir, "index.html"),
        '<title>Regex after block</title><script>if (true) {} /initializeApp()/.test("x");</script>',
        "utf8"
      );
      const r6BlockRegexSummary = buildPreliminaryProjectSummary([], "Phạm Gia Hưng", "STUDENT_01", [], r6BlockRegexDir);
      assert.strictEqual(r6BlockRegexSummary.absentWebFeatures.noFirebase, true, "R6-F08-01: Regex sau khối lệnh if (true) {} không phải lời gọi Firebase thật");

      const r6PostfixDivDir = path.join(tmpT6Root, "R6PostfixDivWeb");
      fs.mkdirSync(r6PostfixDivDir, { recursive: true });
      fs.writeFileSync(
        path.join(r6PostfixDivDir, "index.html"),
        "<title>Division after increment</title><script>let n=4; n++ / initializeApp({}) / 2;</script>",
        "utf8"
      );
      const r6PostfixDivSummary = buildPreliminaryProjectSummary([], "Phạm Gia Hưng", "STUDENT_01", [], r6PostfixDivDir);
      assert.strictEqual(r6PostfixDivSummary.absentWebFeatures.noFirebase, false, "R6-F08-02: Phép chia sau n++ vẫn phải giữ lời gọi initializeApp({}) thật");

      // - R7-F08-01: Classic <script> với số kiểu cũ (010) không bật strict mode vẫn phải đọc trọn vẹn lời gọi initializeApp({}) phía sau
      const r7ClassicOctalDir = path.join(tmpT6Root, "R7ClassicOctalWeb");
      fs.mkdirSync(r7ClassicOctalDir, { recursive: true });
      fs.writeFileSync(
        path.join(r7ClassicOctalDir, "index.html"),
        "<title>Classic script octal</title><script>const n=010; initializeApp({});</script>",
        "utf8"
      );
      const r7ClassicOctalSummary = buildPreliminaryProjectSummary([], "Phạm Gia Hưng", "STUDENT_01", [], r7ClassicOctalDir);
      assert.strictEqual(r7ClassicOctalSummary.absentWebFeatures.noFirebase, false, "R7-F08-01: Classic script với số 010 vẫn phải giữ lời gọi initializeApp({}) thật");

      // - R8-F08-04/05/06: Tệp module .mjs có lỗi từ vựng (010) qua 3 đường (folder, attachment, ZIP) phải giữ trạng thái no* chưa xác định (không khẳng định vắng mặt)
      const r8MjsHtml = '<title>External context audit</title><script type="module" src="./main.mjs"></script>';
      const r8MjsBadCode = "const n=010;";
      const r8MjsFolderDir = path.join(tmpT6Root, "R8MjsFolderWeb");
      fs.mkdirSync(r8MjsFolderDir, { recursive: true });
      const r8MjsHtmlPath = path.join(r8MjsFolderDir, "index.html");
      const r8MjsFilePath = path.join(r8MjsFolderDir, "main.mjs");
      fs.writeFileSync(r8MjsHtmlPath, r8MjsHtml, "utf8");
      fs.writeFileSync(r8MjsFilePath, r8MjsBadCode, "utf8");
      const r8FolderSummary = buildPreliminaryProjectSummary([], "Phạm Gia Hưng", "STUDENT_01", [], r8MjsFolderDir);
      assert.ok(
        Object.entries(r8FolderSummary.absentWebFeatures)
          .filter(([k]) => k.startsWith("no"))
          .every(([, v]) => v === false),
        "R8-F08-04: Tệp .mjs lỗi từ vựng trong thư mục phải giữ các cờ no* chưa xác định"
      );
      const r8AttSummary = buildPreliminaryProjectSummary([r8MjsHtmlPath, r8MjsFilePath], "Phạm Gia Hưng", "STUDENT_01", []);
      assert.ok(
        Object.entries(r8AttSummary.absentWebFeatures)
          .filter(([k]) => k.startsWith("no"))
          .every(([, v]) => v === false),
        "R8-F08-05: Tệp .mjs lỗi từ vựng qua attachments phải giữ các cờ no* chưa xác định"
      );
      const r8Zip = new AdmZip();
      r8Zip.addFile("index.html", Buffer.from(r8MjsHtml, "utf8"));
      r8Zip.addFile("main.mjs", Buffer.from(r8MjsBadCode, "utf8"));
      const r8ZipPath = path.join(tmpT6Root, "R8MjsZipWeb.zip");
      fs.writeFileSync(r8ZipPath, r8Zip.toBuffer());
      const r8ZipSummary = buildPreliminaryProjectSummary([r8ZipPath], "Phạm Gia Hưng", "STUDENT_01", []);
      assert.ok(
        Object.entries(r8ZipSummary.absentWebFeatures)
          .filter(([k]) => k.startsWith("no"))
          .every(([, v]) => v === false),
        "R8-F08-06: Tệp .mjs lỗi từ vựng trong ZIP phải giữ các cờ no* chưa xác định"
      );

      // - F02: Ghi chú phủ định ('Bài không dùng Bootstrap') không được vô hiệu hóa bộ lọc hậu kiểm, và chặn cả Firebase/đăng nhập/fetch('/api/products')/getDocs(collection(...)) bịa đặt
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        attitudeSummary: "STUDENT_01 làm bài nghiêm túc.",
                        productAndDesignEvaluation:
                          "STUDENT_01 đã áp dụng Bootstrap và xây dựng chức năng đăng nhập và đăng ký tài khoản bằng Firebase rất tốt. Con đã dùng fetch('/api/products') để tải dữ liệu thành công. Con đã dùng getDocs(collection(db, 'products')) để hiển thị danh sách sản phẩm thành công.",
                        technicalApplicationEvaluation:
                          "Con đã vận dụng Firebase Authentication và Cloud Firestore hiệu quả ở Buổi 13.",
                        presentationEvaluation: "",
                      }),
                    },
                  ],
                },
                finishReason: "STOP",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      const negNoteRes = await SpckCommentGenerator.generateBatchSpckComments(
        { classId: "VT-C4K-JSB15", sessionNumber: 13 },
        [
          {
            studentId: "S5B_WEB_01",
            fullName: "Phạm Gia Hưng",
            projectTitle: "Tiệm Trà Sữa Mùa Hè",
            localFolderPath: webStuDir,
            quickTags: ["✅ Đã dựng xong khung giao diện các trang chính và thanh điều hướng"],
            teacherNote: "Bài không dùng Bootstrap, chỉ có HTML/CSS tự viết.",
            attachments: [path.join(webStuDir, "index.html"), path.join(webStuDir, "style.css")],
          },
        ]
      );
      assert.ok(
        !/\b(Bootstrap|Firebase|Firestore|getDocs|collection|đăng\s*nhập|đăng\s*ký)\b|fetch\s*\(|tải dữ liệu thành công/i.test(
          negNoteRes[0].formattedTeacherComment
        ),
        `F02: Ghi chú phủ định không được cho phép khen Bootstrap và phải lọc sạch Firebase/getDocs/collection/đăng nhập/fetch(...) bịa đặt: '${negNoteRes[0].formattedTeacherComment}'`
      );
      // - F05: Thư mục chỉ có _spck_owner_uploads không được trả file nội bộ khi chuẩn bị tải lên Google Drive
      const ownerOnlyDir = path.join(tmpT6Root, "OwnerOnlyDriveTest");
      fs.mkdirSync(path.join(ownerOnlyDir, "_spck_owner_uploads"), { recursive: true });
      fs.writeFileSync(
        path.join(ownerOnlyDir, "_spck_owner_uploads", "private.png"),
        makeTestPng(320, 180, 9)
      );
      assert.deepStrictEqual(
        prepareStudentFilesForDriveUpload(ownerOnlyDir, "S5B_ROB_01", "Lê Hoàng Bách"),
        [],
        "F05: prepareStudentFilesForDriveUpload phải loại trừ hoàn toàn _spck_owner_uploads"
      );
    } finally {
      try {
        const dbConn = getDb();
        dbConn
          .prepare(
            `DELETE FROM spck_session_submissions WHERE studentId IN ('S5B_ROB_01', 'S5B_WEB_01')`
          )
          .run();
        dbConn
          .prepare(`DELETE FROM spck_uploads WHERE studentId IN ('S5B_ROB_01', 'S5B_WEB_01')`)
          .run();
        dbConn
          .prepare(`DELETE FROM students WHERE studentId IN ('S5B_ROB_01', 'S5B_WEB_01')`)
          .run();
        dbConn.prepare(`DELETE FROM classes_sessions WHERE classId = 'VT-PREB99'`).run();
      } catch {}
      fs.rmSync(tmpT6Root, { recursive: true, force: true });
    }
    console.log("  -> PASS [S5b-T6]: Cả 5 hạng mục nâng cấp SPCK Buổi 12-13-14 (Coding & Robotics) đều hoạt động chính xác.");
  } finally {
    try {
      const dbConn = getDb();
      dbConn.prepare(`DELETE FROM spck_session_submissions WHERE studentId = 'S5B_STU_01'`).run();
      dbConn.prepare(`DELETE FROM spck_uploads WHERE studentId = 'S5B_STU_01'`).run();
      dbConn.prepare(`DELETE FROM students WHERE studentId = 'S5B_STU_01'`).run();
    } catch {}
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalApiKey;
    }
  }
  console.log("  -> PASS [S5b-T4]: S5b.6 (Prompt tiến bộ so với Buổi 12), S5b.7 (0 khối {false && ...}) & S5b.8 (Guardrails) đạt chuẩn.");

  // =========================================================================
  // Đóng gói UI FinalProjectPage bằng esbuild + CSS thật để kiểm thử Playwright
  // =========================================================================
  console.log("\n[S5b-UI] Đang biên dịch bundle UI FinalProjectPage để kiểm thử S5b.1 -> S5b.6...");
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
    const page = await context.newPage();
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
  </script>
  <script>${bundleCode}</script>
</body>
</html>`;

    await page.setContent(html, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="s5b-auto-run-tools-checkbox"]', {
      timeout: 3000,
    });

    // =========================================================================
    // [S5b-T1] Kiểm tra S5b.1 (Auto-run tools theo loại lớp) & S5b.2 (Confirm khi hạ APPROVED)
    // =========================================================================
    console.log("\n[S5b-T1] Kiểm tra S5b.1 (Auto-run tools sau Quét) & S5b.2 (Xác nhận trước khi hạ trạng thái ĐÃ DUYỆT)...");
    const isCheckedByDefault = await page
      .locator('[data-testid="s5b-auto-run-tools-checkbox"]')
      .isChecked();
    assert.strictEqual(
      isCheckedByDefault,
      true,
      "Checkbox '⚡ Tự chạy công cụ chuẩn bị sau khi Quét' phải mặc định BẬT (S5b.1)"
    );

    // Kiểm tra S5b.6: Ở Buổi 13 (mặc định khi tải lớp JSB15 có STU_01 đã nộp B.13 và STU_02 chưa nộp B.13),
    // chỉ STU_02 được tự động tích chọn!
    const selectedTextSess13 = await page.locator("text=Đang chọn:").first().innerText();
    assert.ok(
      selectedTextSess13.includes("1/2"),
      `Buổi 13 phải tự động lọc chọn đúng 1 học viên chưa nộp Buổi 13 (STU_02), thực tế: '${selectedTextSess13}' (S5b.6)`
    );

    // Kiểm tra S5B-04: Khi cả 2/2 học viên đã nộp Buổi 13 (VERIFIED), tự động chọn 0/2 thay vì chọn lại cả 2/2
    await page.evaluate(() => {
      (window as any).__simulateAllSess13Verified = true;
    });
    await page.locator('button:has-text("Buổi 12")').first().click();
    await page.locator('button:has-text("Buổi 13")').first().click();
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll("*")).some((el) =>
          el.textContent?.includes("Đang chọn: 0/2")
        ),
      undefined,
      { timeout: 5000 }
    );
    await page.evaluate(() => {
      (window as any).__simulateAllSess13Verified = false;
    });
    await page.locator('button:has-text("Buổi 12")').first().click();
    await page.locator('button:has-text("Buổi 13")').first().click();
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll("*")).some((el) =>
          el.textContent?.includes("Đang chọn: 1/2")
        ),
      undefined,
      { timeout: 5000 }
    );

    // Kiểm tra S5b.2: Hiện tại STU_01 đang có status = APPROVED. Khi bấm thủ công "Up Sản Phẩm Cả Lớp lên Drive & Gắn Link" mà từ chối confirm -> không gọi API upload-drive
    await page.evaluate(() => {
      (window as any).__apiCalls = [];
      (window as any).__confirmCalls = [];
      (window as any).__confirmNextResult = false;
    });
    await page.locator('button:has-text("Công cụ Drive & Cổng thu bài")').click();
    await page.locator('button:has-text("Up Sản Phẩm Cả Lớp lên Drive & Gắn Link")').click();
    const confirmCallsAfterCancel = await page.evaluate(() => (window as any).__confirmCalls);
    const apiCallsAfterCancel = await page.evaluate(() =>
      (window as any).__apiCalls.filter((c: any) => c.url.includes("/api/spck/upload-drive"))
    );
    assert.strictEqual(
      confirmCallsAfterCancel.length,
      1,
      "Khi có học viên ĐÃ DUYỆT, chạy lại công cụ chia sẻ phải hiện hộp thoại xác nhận (S5b.2)"
    );
    assert.strictEqual(
      apiCallsAfterCancel.length,
      0,
      "Khi giáo viên bấm Hủy xác nhận, không được chạy công cụ làm mất trạng thái ĐÃ DUYỆT (S5b.2)"
    );

    // Bấm "Quét & Khớp HV" trên lớp Web JSB15 -> phải tự chạy tuần tự: scan -> capture-screenshots -> deploy-web -> upload-drive
    await page.evaluate(() => {
      (window as any).__apiCalls = [];
      (window as any).__confirmNextResult = true;
    });
    await page.locator('button:has-text("Quét & Khớp HV")').click();
    await page.waitForFunction(
      () =>
        (window as any).__apiCalls.some((c: any) =>
          c.url.includes("/api/spck/upload-drive")
        ),
      undefined,
      { timeout: 5000 }
    );
    const jsbAutoRunUrls: string[] = await page.evaluate(() =>
      (window as any).__apiCalls
        .map((c: any) => c.url)
        .filter((u: string) =>
          /\/api\/spck\/(scan|upload-drive|deploy-web|capture-screenshots)$/.test(u)
        )
    );
    assert.deepStrictEqual(
      jsbAutoRunUrls,
      [
        "/api/spck/scan",
        "/api/spck/capture-screenshots",
        "/api/spck/deploy-web",
        "/api/spck/upload-drive",
      ],
      "Lớp Web (JSB) khi bấm 'Quét & Khớp HV' phải tự chạy đúng thứ tự: Scan -> Chụp ảnh tự động -> Deploy GitHub -> Upload Drive (S5b.1)"
    );
    const jsbScanCallBody = await page.evaluate(() => {
      const call = (window as any).__apiCalls.find((c: any) =>
        c.url.includes("/api/spck/scan")
      );
      return call ? call.body : null;
    });
    assert.strictEqual(
      jsbScanCallBody?.syncActiveSession,
      true,
      "Nút 'Quét & Khớp HV' phải truyền syncActiveSession: true để đồng bộ tài nguyên mới vào buổi đang chọn"
    );
    assert.strictEqual(
      jsbScanCallBody?.autoSuggestQuickTags,
      true,
      "Nút 'Quét & Khớp HV' phải truyền autoSuggestQuickTags: true để tự gợi ý Quick Tags khi chưa chọn"
    );

    // Kiểm tra nút "📁 Tạo thư mục HV" (s5b-init-student-folders-btn): chỉ gọi /api/spck/scan với action="init_student_folders", không tự chạy công cụ chuẩn bị trên thư mục rỗng
    await page.evaluate(() => {
      (window as any).__apiCalls = [];
    });
    await page.locator('[data-testid="s5b-init-student-folders-btn"]').click();
    await page.waitForFunction(
      () =>
        (window as any).__apiCalls.some(
          (c: any) =>
            c.url.includes("/api/spck/scan") &&
            c.body &&
            c.body.action === "init_student_folders"
        ),
      undefined,
      { timeout: 5000 }
    );
    const initFolderUrls: string[] = await page.evaluate(() =>
      (window as any).__apiCalls
        .map((c: any) => c.url)
        .filter((u: string) =>
          /\/api\/spck\/(scan|upload-drive|deploy-web|capture-screenshots)$/.test(u)
        )
    );
    assert.deepStrictEqual(
      initFolderUrls,
      ["/api/spck/scan"],
      "Nút '📁 Tạo thư mục HV' chỉ tạo thư mục và khớp học viên, không chạy sớm công cụ chụp ảnh/up Drive khi thư mục vừa tạo"
    );

    // Kiểm tra S5B-07: Lớp App/Python (PTA08) -> tự chạy: Scan -> Chụp ảnh -> Upload Drive (bỏ qua GitHub Pages)
    await page.locator("select").first().selectOption("VT-C4K-PTA08");
    await page.evaluate(() => {
      (window as any).__apiCalls = [];
    });
    await page.locator('button:has-text("Quét & Khớp HV")').click();
    await page.waitForFunction(
      () =>
        (window as any).__apiCalls.some((c: any) =>
          c.url.includes("/api/spck/upload-drive")
        ),
      undefined,
      { timeout: 5000 }
    );
    const ptaAutoRunUrls: string[] = await page.evaluate(() =>
      (window as any).__apiCalls
        .map((c: any) => c.url)
        .filter((u: string) =>
          /\/api\/spck\/(scan|upload-drive|deploy-web|capture-screenshots|import-youtube)$/.test(u)
        )
    );
    assert.deepStrictEqual(
      ptaAutoRunUrls,
      ["/api/spck/scan", "/api/spck/capture-screenshots", "/api/spck/upload-drive"],
      "Lớp App/Python (PTA) khi bấm 'Quét & Khớp HV' phải tự chạy: Scan -> Chụp ảnh -> Upload Drive (không chạy GitHub Pages) (S5B-07)"
    );

    // Kiểm tra S5B-07: Lớp Thiết kế (CANVA01) -> chỉ chạy: Scan -> Upload Drive
    await page.locator("select").first().selectOption("VT-C4K-CANVA01");
    await page.evaluate(() => {
      (window as any).__apiCalls = [];
    });
    await page.locator('button:has-text("Quét & Khớp HV")').click();
    await page.waitForFunction(
      () =>
        (window as any).__apiCalls.some((c: any) =>
          c.url.includes("/api/spck/upload-drive")
        ),
      undefined,
      { timeout: 5000 }
    );
    const canvaAutoRunUrls: string[] = await page.evaluate(() =>
      (window as any).__apiCalls
        .map((c: any) => c.url)
        .filter((u: string) =>
          /\/api\/spck\/(scan|upload-drive|deploy-web|capture-screenshots|import-youtube)$/.test(u)
        )
    );
    assert.deepStrictEqual(
      canvaAutoRunUrls,
      ["/api/spck/scan", "/api/spck/upload-drive"],
      "Lớp Canva/Thiết kế khi bấm 'Quét & Khớp HV' chỉ chạy: Scan -> Upload Drive (S5B-07)"
    );

    // Chuyển lại về lớp JSB15 để tiếp tục kiểm thử [S5b-T2] và [S5b-T3]
    await page.locator("select").first().selectOption("VT-C4K-JSB15");
    console.log("  -> PASS [S5b-T1]: Auto-run tools sau Quét (JSB / PTA / CANVA) & khóa bảo vệ trạng thái ĐÃ DUYỆT hoạt động chính xác.");

    // =========================================================================
    // [S5b-T2] Kiểm tra S5b.3: StudentRow ẩn nút công cụ trùng lặp ở trạng thái bình thường, chỉ hiện "🔄 Thử lại" khi có lỗi
    // =========================================================================
    console.log("\n[S5b-T2] Kiểm tra S5b.3 (Chỉ 1 nơi chứa nút công cụ; chỉ hiện nút '🔄 Thử lại' trên dòng bị lỗi)...");
    await page.locator('button:has-text("Chi tiết ▾")').first().click();

    // Kiểm tra UI Quick Tags ở Buổi 13 (lớp VT-C4K-JSB15 -> Web Basic (JSB)):
    // Phải hiển thị 2 nhóm: "🟢 Tiến độ & Phần đã làm được" + "🟠 Phần cần hoàn thiện tiếp theo", và ẩn nhóm thuyết trình thử khi chưa tích checkbox
    const expandedRow13Text = await page.locator("#root").innerText();
    assert.ok(
      expandedRow13Text.includes("🏷️ Web Basic (JSB) • Buổi 13") &&
        expandedRow13Text.includes("🟢 Tiến độ & Phần đã làm được") &&
        expandedRow13Text.includes("🟠 Phần cần hoàn thiện tiếp theo") &&
        !expandedRow13Text.includes("🎤 Kỹ năng thuyết trình thử"),
      "Ở Buổi 13 khi chưa tích thuyết trình, phải hiển thị đúng 2 hàng Quick Tags theo môn (Tiến độ + Cần hoàn thiện) và ẩn thẻ thuyết trình"
    );

    const retryDriveCountBeforeError = await page
      .locator('button:has-text("🔄 Thử lại Up Drive & Gắn Link")')
      .count();
    assert.strictEqual(
      retryDriveCountBeforeError,
      0,
      "Ở trạng thái bình thường (không lỗi), dòng học viên không được hiện nút công cụ trùng lặp (S5b.3)"
    );

    // Giả lập lỗi Upload Drive cho STU_01
    await page.evaluate(() => {
      (window as any).__simulateDriveStudentFail = true;
    });
    await page.locator('button:has-text("Up Sản Phẩm Cả Lớp lên Drive & Gắn Link")').click();
    await page.waitForSelector('button:has-text("🔄 Thử lại Up Drive & Gắn Link")', {
      timeout: 5000,
    });

    const retryDriveCountOnExpandedStu01 = await page
      .locator('button:has-text("🔄 Thử lại Up Drive & Gắn Link")')
      .count();
    assert.strictEqual(
      retryDriveCountOnExpandedStu01,
      1,
      "Học viên bị lỗi Upload Drive (STU_01) phải hiện nút '🔄 Thử lại Up Drive & Gắn Link' ngay trên dòng (S5b.3)"
    );

    // Bấm nút "🔄 Thử lại Up Drive & Gắn Link" trên dòng STU_01 -> hết lỗi -> nút tự ẩn
    await page.evaluate(() => {
      (window as any).__simulateDriveStudentFail = false;
    });
    await page.locator('button:has-text("🔄 Thử lại Up Drive & Gắn Link")').click();
    await page.waitForFunction(
      () =>
        !Array.from(document.querySelectorAll("button")).some((b) =>
          b.textContent?.includes("🔄 Thử lại Up Drive & Gắn Link")
        ),
      undefined,
      { timeout: 5000 }
    );
    console.log("  -> PASS [S5b-T2]: StudentRow chỉ hiện nút '🔄 Thử lại' khi có lỗi và tự ẩn sau khi thử lại thành công.");

    // =========================================================================
    // [S5b-T3] Kiểm tra S5b.4 & S5b.5: Hợp nhất Buổi 14 (Auto-import Demo, 2 Tab trong StudentRow, AI soạn tất cả, Nộp Buổi 14 đầy đủ + Thử lại độc lập)
    // =========================================================================
    console.log("\n[S5b-T3] Kiểm tra S5b.4 & S5b.5 (Luồng hợp nhất Buổi 14: Auto-import Điểm Demo, 2 Tab StudentRow, AI soạn tất cả & Nộp Buổi 14 đầy đủ)...");
    await page.evaluate(() => {
      (window as any).__apiCalls = [];
    });

    // Chuyển sang Buổi 14
    await page.locator('button:has-text("Buổi 14")').first().click();

    // S5b.5 & S5B-03: Phải tự động gọi import-demo-scores với onlyMissingStudents=true khi chuyển sang Buổi 14 mà có học viên chưa có điểm Demo (STU_01 đã có 4.5, STU_02 đang 0)
    await page.waitForFunction(
      () =>
        (window as any).__apiCalls.some(
          (c: any) =>
            c.url.includes("/api/spck/session14-eval/import-demo-scores") &&
            c.body &&
            c.body.onlyMissingStudents === true
        ),
      undefined,
      { timeout: 5000 }
    );

    // S5b.4: Dòng học viên đang mở ở Buổi 14 -> phải có 2 Tab (Tab 1: Sản phẩm SPCK | Tab 2: Điểm Demo, ĐNL & Thư 3 phần)
    await page.waitForSelector('button:has-text("📦 Tab 1: Sản phẩm SPCK (Cột 3)")', {
      timeout: 5000,
    });
    const expandedRow14Tab1Text = await page.locator("#root").innerText();
    assert.ok(
      expandedRow14Tab1Text.includes("🏷️ Web Basic (JSB) • Buổi 14") &&
        expandedRow14Tab1Text.includes("🎤 1. Về phần thuyết trình & Slide") &&
        expandedRow14Tab1Text.includes("🏆 2. Về sản phẩm cuối khóa — Web Basic (JSB)"),
      "Ở Buổi 14 (Tab 1), phải hiển thị 2 hàng Quick Tags: 1. Về phần thuyết trình & Slide và 2. Về sản phẩm cuối khóa theo đúng môn học"
    );
    await page.waitForSelector(
      'button:has-text("🏅 Tab 2: Điểm Demo, ĐNL & Thư 3 phần (Cột 2)")',
      { timeout: 5000 }
    );
    await page
      .locator('button:has-text("🏅 Tab 2: Điểm Demo, ĐNL & Thư 3 phần (Cột 2)")')
      .first()
      .click();
    await page.waitForSelector('text=Phần 1: Learned From Mindx', {
      timeout: 5000,
    });

    const rootTextAtTab2 = await page.locator("#root").innerText();
    assert.ok(
      rootTextAtTab2.includes("1. Điểm Demo") &&
        rootTextAtTab2.includes("2. Điểm Năng Lực [ĐNL]") &&
        rootTextAtTab2.includes("Phần 1: Learned From Mindx"),
      "Tab 2 trong StudentRow ở Buổi 14 phải hiển thị đầy đủ Điểm Demo, 9 tiêu chí ĐNL và Thư 3 phần (S5b.4)"
    );

    // S5b.4: Kiểm tra nút "✨ AI soạn tất cả (SPCK + Thư 3 phần)" trong ToolsDrawer
    await page.evaluate(() => {
      (window as any).__apiCalls = [];
    });
    await page
      .locator('button:has-text("✨ AI soạn tất cả (SPCK + Thư 3 phần)")')
      .click();
    await page.waitForFunction(
      () =>
        (window as any).__apiCalls.some((c: any) => c.url.includes("/api/spck/generate-ai")) &&
        (window as any).__apiCalls.some((c: any) =>
          c.url.includes("/api/spck/session14-eval/generate-ai")
        ),
      undefined,
      { timeout: 5000 }
    );

    // S5b.4 & S5B-02-R2:
    // Bước A: Chạy đợt nộp 1 (Phần 1 thành công 2/2, Phần 2 có 1 học viên lỗi "Không tìm thấy nút Lưu cho Ngọc")
    await page.evaluate(() => {
      (window as any).__apiCalls = [];
      (window as any).__simulateSaveDraftConflict = false;
      (window as any).__simulateS14EvalStudentFail = true;
    });
    await page
      .locator('button:has-text("🚀 Nộp Buổi 14 đầy đủ (Sản phẩm + Đánh giá)")')
      .click();
    await page.waitForSelector('button:has-text("🔄 Thử lại riêng phần Đánh giá")', {
      timeout: 5000,
    });
    const batchAText = await page.locator("#root").innerText();
    assert.ok(
      batchAText.includes("Đã lưu & xác minh 1 học viên (1 cần thử lại)") &&
        batchAText.includes("Không tìm thấy nút Lưu cho Ngọc"),
      "Đợt A phải hiển thị 1 học viên xác minh, 1 cần thử lại và thông báo lỗi của Đợt A"
    );

    // Bước B (S5B-02-R2 + S5B-02): Bắt đầu Đợt B mới bằng "🚀 Nộp Buổi 14 đầy đủ", giữ save-draft ở trạng thái chờ để kiểm tra giao diện TRƯỚC KHI hoàn tất
    await page.evaluate(() => {
      (window as any).__apiCalls = [];
      (window as any).__delaySaveDraftOnce = true;
      (window as any).__releaseSaveDraft = null;
      (window as any).__simulateSaveDraftConflict = true;
      (window as any).__simulateS14EvalStudentFail = false;
    });
    await page
      .locator('button:has-text("🚀 Nộp Buổi 14 đầy đủ (Sản phẩm + Đánh giá)")')
      .click();
    await page.waitForFunction(
      () => typeof (window as any).__releaseSaveDraft === "function",
      undefined,
      { timeout: 5000 }
    );

    const duringNewBatchText = await page.locator("#root").innerText();
    assert.strictEqual(
      duringNewBatchText.includes("Đã lưu & xác minh 1 học viên (1 cần thử lại)"),
      false,
      "Khi bắt đầu đợt 'both' mới (đang chờ save-draft), phải xóa ngay số xác minh/thử lại của đợt cũ (S5B-02-R2)"
    );
    assert.strictEqual(
      duringNewBatchText.includes("Không tìm thấy nút Lưu cho Ngọc"),
      false,
      "Khi bắt đầu đợt 'both' mới (đang chờ save-draft), phải xóa ngay thông báo lỗi Đánh giá của đợt cũ (S5B-02-R2)"
    );
    assert.strictEqual(
      /Đã nộp\s+2\/2\s+—/.test(duringNewBatchText),
      false,
      "Khi bắt đầu đợt 'both' mới (đang chờ save-draft), phải xóa ngay bảng tổng kết Sản phẩm của đợt cũ (S5B-02-R2)"
    );
    assert.strictEqual(
      await page.locator('button:has-text("🔄 Thử lại riêng phần Đánh giá")').count(),
      0,
      "Khi bắt đầu đợt 'both' mới (đang chờ save-draft), không được còn hiển thị nút thử lại của đợt cũ (S5B-02-R2)"
    );

    // Giải phóng save-draft để kiểm tra lỗi sớm HTTP 409 ở Phần 1 vẫn hiện retry Sản phẩm và Phần 2 vẫn chạy độc lập
    await page.evaluate(() => {
      (window as any).__releaseSaveDraft();
    });
    await page.waitForSelector('button:has-text("🔄 Thử lại riêng phần Sản phẩm")', {
      timeout: 5000,
    });
    const earlyFailText = await page.locator("#root").innerText();
    assert.ok(
      earlyFailText.includes("Đã nộp 0/2 bài") &&
        earlyFailText.includes("2 bài cần thử lại") &&
        earlyFailText.includes("🔄 Thử lại riêng phần Sản phẩm") &&
        earlyFailText.includes("Đã lưu & xác minh 2 học viên (0 cần thử lại)"),
      "Khi Phần 1 bị lỗi sớm ở save-draft (HTTP 409), phải báo 'Đã nộp 0/2 bài (2 bài cần thử lại)', hiện nút '🔄 Thử lại riêng phần Sản phẩm' và Phần 2 vẫn chạy độc lập (S5B-02)"
    );

    // Bước C: Kiểm tra nút "🚀 Nộp Buổi 14 đầy đủ (Sản phẩm + Đánh giá)" khi Phần 1 (SPCK) thành công và Phần 2 (Đánh giá) có 1 học viên lỗi -> giữ nguyên VERIFIED của Phần 1 và hiện nút "🔄 Thử lại riêng phần Đánh giá"
    await page.evaluate(() => {
      (window as any).__apiCalls = [];
      (window as any).__simulateSaveDraftConflict = false;
      (window as any).__simulateS14EvalStudentFail = true;
    });
    await page
      .locator('button:has-text("🚀 Nộp Buổi 14 đầy đủ (Sản phẩm + Đánh giá)")')
      .click();
    await page.waitForSelector('button:has-text("🔄 Thử lại riêng phần Đánh giá")', {
      timeout: 5000,
    });

    const comboRootText = await page.locator("#root").innerText();
    assert.ok(
      comboRootText.includes("Phần 1: Sản phẩm SPCK (Cột 3 LMS)") &&
        comboRootText.includes("Đã nộp 2/2 bài") &&
        comboRootText.includes("Phần 2: Điểm Demo, ĐNL & Thư 3 phần (Cột 2 LMS)") &&
        comboRootText.includes("1 cần thử lại"),
      "Bảng trạng thái Nộp Buổi 14 đầy đủ phải tách bạch Phần 1 (Đã nộp 2/2 bài) và Phần 2 (1 cần thử lại) (S5b.4)"
    );

    // Bấm "🔄 Thử lại riêng phần Đánh giá (1)" -> chỉ gọi /api/spck/session14-eval/upload-lms cho STU_02, KHÔNG nộp lại Phần 1 (/api/spck/upload-lms), và cộng dồn thành "Đã xác minh 2 bài" (S5B-05)
    await page.evaluate(() => {
      (window as any).__apiCalls = [];
      (window as any).__simulateS14EvalStudentFail = false;
    });
    await page
      .locator('button:has-text("🔄 Thử lại riêng phần Đánh giá")')
      .click();
    await page.waitForFunction(
      () =>
        (window as any).__apiCalls.some((c: any) =>
          c.url.includes("/api/spck/session14-eval/upload-lms")
        ) &&
        Array.from(document.querySelectorAll("*")).some((el) =>
          el.textContent?.includes("Đã lưu & xác minh 2 học viên (0 cần thử lại)")
        ),
      undefined,
      { timeout: 5000 }
    );
    const retryOnlyEvalCalls = await page.evaluate(() => (window as any).__apiCalls);
    assert.strictEqual(
      retryOnlyEvalCalls.some(
        (c: any) =>
          c.url.includes("/api/spck/upload-lms") &&
          !c.url.includes("/api/spck/session14-eval/upload-lms")
      ),
      false,
      "Khi bấm 'Thử lại riêng phần Đánh giá', tuyệt đối không được nộp lại Phần 1 Sản phẩm SPCK (S5b.4)"
    );
    const evalSubmitCall = retryOnlyEvalCalls.find((c: any) =>
      c.url.includes("/api/spck/session14-eval/upload-lms")
    );
    assert.deepStrictEqual(
      evalSubmitCall.body.studentIds,
      ["STU_02"],
      "Nút 'Thử lại riêng phần Đánh giá' phải chỉ gửi lại đúng học viên bị lỗi (STU_02) (S5b.4)"
    );
    const postRetryComboText = await page.locator("#root").innerText();
    assert.ok(
      postRetryComboText.includes("Đã lưu & xác minh 2 học viên (0 cần thử lại)"),
      "Sau khi thử lại thành công 1 học viên bị lỗi ở Phần 2, tổng số bài đã xác minh phải cộng dồn thành 'Đã lưu & xác minh 2 học viên (0 cần thử lại)' (S5B-05)"
    );
    console.log("  -> PASS [S5b-T3]: Hợp nhất Buổi 14 (Auto-import Điểm Demo một phần, 2 Tab StudentRow, AI soạn tất cả & Nộp Buổi 14 đầy đủ + Thử lại độc lập cộng dồn) hoạt động hoàn hảo.");

    await context.close();
  } finally {
    await browser.close();
    closeDb();
    fs.rmSync(tempBuildDir, { recursive: true, force: true });
    fs.rmSync(isolatedDbDir, { recursive: true, force: true });
  }

  console.log("\n🎉 TẤT CẢ CÁC BÀI KIỂM THỬ GIAI ĐOẠN S5b ĐỀU PASS 100%!");
}

runTests().catch((err) => {
  console.error("❌ LỖI KIỂM THỬ S5b:", err);
  process.exit(1);
});
