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
  getDb,
  isDefaultSpckProductTitle,
  studentRepo,
  stripSpckSessionSuffix,
  validateSpckTitleLength,
} from "../src/lib/db/sqlite";
import {
  detectLimitationEvidence,
  detectPresentationEvidence,
  SpckCommentGenerator,
} from "../src/lib/gemini/spck-comment";
import { parseCodeBuffer } from "../src/lib/file-parsers/code-reader";
import { DEFAULT_SPCK_THUMBNAIL_PATH } from "../src/lib/local-files/spck-scanner";
import {
  detectSpckCourseProfile,
  getSpckQuickTagGroups,
  isLimitationOrNextStepQuickTag,
  isPresentationQuickTag,
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
    fs.rmSync(tempBuildDir, { recursive: true, force: true });
  }

  console.log("\n🎉 TẤT CẢ CÁC BÀI KIỂM THỬ GIAI ĐOẠN S5b ĐỀU PASS 100%!");
}

runTests().catch((err) => {
  console.error("❌ LỖI KIỂM THỬ S5b:", err);
  process.exit(1);
});
