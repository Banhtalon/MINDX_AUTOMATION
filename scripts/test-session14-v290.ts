/**
 * MINDX AUTOMATION BOT - SESSION 14 REDESIGN VERIFICATION SUITE (v2.9.0)
 * Verifies:
 * - [S14-01] Blocking Session 14 (_SESS_14) from regular 3-bullet /session-comments API & CommentSaver
 * - [S14-02] Session 14 SPCK 2-part teacherComment ("1. Về phần thuyết trình" / "2. Về phần sản phẩm cuối khóa") + short call name + HTML/CSS/Flexbox scan
 * - [S14-03] Reading graded "Bảng chấm điểm buổi Demo (.xlsx)" -> 5 Demo Score items + 9 [ĐNL] Competency Score average
 * - [S14-04] 3-part "Thư từ MindX" AI generation (Mccully Mac Dallas sample layout, PII anonymization, deterministic score injection, INSUFFICIENT_INFO guardrail)
 * - [S14-05] Hash integrity & automatic demotion to WAITING_APPROVAL on post-approval edit
 * - [S14-06] Playwright Session14EvalUploader (45 radios, 6 number inputs, 3 .ql-editor boxes, Read-after-Write verification -> VERIFIED)
 */

import assert from "node:assert";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { GoogleGenerativeAI } from "@google/generative-ai";
import AdmZip from "adm-zip";
import { chromium } from "playwright";
import { POST as saveCommentsLmsPost } from "../src/app/api/session-comments/save-lms/route";
import { POST as s14EvalGenerateAiPost } from "../src/app/api/spck/session14-eval/generate-ai/route";
import { POST as s14EvalImportDemoPost } from "../src/app/api/spck/session14-eval/import-demo-scores/route";
import { GET as s14EvalGet, POST as s14EvalPost } from "../src/app/api/spck/session14-eval/route";
import {
  classSessionRepo,
  getDb,
  SESSION14_COMPETENCY_KEYS,
  session14EvalRepo,
  sessionFeedbackRepo,
  spckSessionRepo,
  spckUploadRepo,
  studentRepo,
} from "../src/lib/db/sqlite";
import {
  anonymizeSession14Text,
  assembleLearnedFromMindxLetter,
  Session14CourseSummaryGenerator,
} from "../src/lib/gemini/session14-course-summary";
import {
  formatSpckStudentCallName,
  SpckCommentGenerator,
} from "../src/lib/gemini/spck-comment";
import { parseDemoWorkbookBufferForClass } from "../src/lib/local-files/spck-demo-score-reader";
import { LmsHelpers } from "../src/lib/playwright/lms-helpers";
import { CommentSaver } from "../src/lib/playwright/save-comments";
import { Session14EvalUploader } from "../src/lib/playwright/session14-eval-uploader";

function makeJsonReq(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Host: "127.0.0.1:3000",
    },
    body: JSON.stringify(body),
  });
}

function buildTestDemoWorkbookBuffer(studentName: string): Buffer {
  const zip = new AdmZip();
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${studentName.slice(0, 31)}" sheetId="1" r:id="rId1"/>
    <sheet name="Phân bổ điểm" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>`;

  // E8:E13 sum = 1.35 (algorithm max 1.5)
  // E14:E17 sum = 0.90 (creativity max 1.0)
  // E18:E19 sum = 0.45 (communication max 0.5)
  // E20:E22 sum = 0.90 (problemSolving max 1.0)
  // E23:E27 sum = 0.90 (computerSkills max 1.0)
  // Total = 4.50
  const sheet1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="2">
      <c r="A2" t="inlineStr"><is><t>Họ và tên Học viên:</t></is></c>
      <c r="B2" t="inlineStr"><is><t>${studentName}</t></is></c>
    </row>
    <row r="8"><c r="E8"><v>0.25</v></c></row>
    <row r="9"><c r="E9"><v>0.25</v></c></row>
    <row r="10"><c r="E10"><v>0.25</v></c></row>
    <row r="11"><c r="E11"><v>0.25</v></c></row>
    <row r="12"><c r="E12"><v>0.20</v></c></row>
    <row r="13"><c r="E13"><v>0.15</v></c></row>
    <row r="14"><c r="E14"><v>0.25</v></c></row>
    <row r="15"><c r="E15"><v>0.25</v></c></row>
    <row r="16"><c r="E16"><v>0.20</v></c></row>
    <row r="17"><c r="E17"><v>0.20</v></c></row>
    <row r="18"><c r="E18"><v>0.25</v></c></row>
    <row r="19"><c r="E19"><v>0.20</v></c></row>
    <row r="20"><c r="E20"><v>0.25</v></c></row>
    <row r="21"><c r="E21"><v>0.45</v></c></row>
    <row r="22"><c r="E22"><v>0.20</v></c></row>
    <row r="23"><c r="E23"><v>0.125</v></c></row>
    <row r="24"><c r="E24"><v>0.125</v></c></row>
    <row r="25"><c r="E25"><v>0.25</v></c></row>
    <row r="26"><c r="E26"><v>0.20</v></c></row>
    <row r="27"><c r="E27"><v>0.20</v></c></row>
    <row r="30">
      <c r="B30" t="inlineStr"><is><t>Sản phẩm hoàn thiện tốt, giao diện đẹp mắt, cần tự tin hơn khi thuyết trình.</t></is></c>
    </row>
    <row r="32">
      <c r="A32" t="inlineStr"><is><t>Tư duy thuật toán, tư duy máy tính</t></is></c>
      <c r="B32"><f>SUM(E8:E13)</f><v>1.5</v></c>
    </row>
    <row r="33">
      <c r="A33" t="inlineStr"><is><t>Kỹ năng sử dụng máy tính</t></is></c>
      <c r="B33"><f>SUM(E23:E27)</f><v>1.0</v></c>
    </row>
    <row r="34">
      <c r="A34" t="inlineStr"><is><t>Tư duy sáng tạo</t></is></c>
      <c r="B34"><f>SUM(E14:E17)</f><v>1.0</v></c>
    </row>
    <row r="35">
      <c r="A35" t="inlineStr"><is><t>Giải quyết vấn đề</t></is></c>
      <c r="B35"><f>SUM(E20:E22)</f><v>1.0</v></c>
    </row>
    <row r="36">
      <c r="A36" t="inlineStr"><is><t>Thể hiện khả năng giao tiếp, hợp tác</t></is></c>
      <c r="B36"><f>SUM(E18:E19)</f><v>0.5</v></c>
    </row>
  </sheetData>
</worksheet>`;

  const sheet2Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>`;

  zip.addFile("xl/workbook.xml", Buffer.from(workbookXml, "utf8"));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(relsXml, "utf8"));
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(sheet1Xml, "utf8"));
  zip.addFile("xl/worksheets/sheet2.xml", Buffer.from(sheet2Xml, "utf8"));

  return zip.toBuffer();
}

async function runTests() {
  console.log("=== BẮT ĐẦU KIỂM THỬ BUỔI 14 TỔNG KẾT CUỐI KHÓA (v2.9.0) ===");

  const db = getDb();
  const testClassId = "TEST-JSB15-V290";
  const stuDallasId = "STU_DALLAS_01";
  const stuEmptyId = "STU_EMPTY_02";
  const tempDir = path.resolve(process.cwd(), "data", "temp_v290_test");
  fs.mkdirSync(tempDir, { recursive: true });

  const cleanup = () => {
    db.prepare(`DELETE FROM classes_sessions WHERE classId = ?`).run(testClassId);
    db.prepare(`DELETE FROM students WHERE classId = ?`).run(testClassId);
    db.prepare(`DELETE FROM session_feedbacks WHERE classId = ?`).run(testClassId);
    db.prepare(`DELETE FROM spck_uploads WHERE classId = ?`).run(testClassId);
    db.prepare(`DELETE FROM spck_session_submissions WHERE classId = ?`).run(testClassId);
    db.prepare(`DELETE FROM spck_session14_evaluations WHERE classId = ?`).run(testClassId);
    fs.rmSync(tempDir, { recursive: true, force: true });
  };

  cleanup();
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    // Seed class sessions 13 & 14 and students
    classSessionRepo.upsert({
      classId: testClassId,
      className: "Lớp TEST-JSB15-V290",
      sessionId: `${testClassId}_SESS_13`,
      sessionNumber: 13,
      topic: "Buổi 13 - Hoàn thiện SPCK",
      date: "2026-10-20",
    });
    classSessionRepo.upsert({
      classId: testClassId,
      className: "Lớp TEST-JSB15-V290",
      sessionId: `${testClassId}_SESS_14`,
      sessionNumber: 14,
      topic: "Buổi 14 - Tổng kết cuối khóa",
      date: "2026-10-27",
    });

    studentRepo.upsert({
      classId: testClassId,
      studentId: stuDallasId,
      fullName: "Mccully Mac Dallas",
      isActive: 1,
    });
    studentRepo.upsert({
      classId: testClassId,
      studentId: stuEmptyId,
      fullName: "Nguyễn Thiên Phúc",
      isActive: 1,
    });

    // =========================================================================
    // [S14-01] Chặn lưu nhận xét 3 gạch đầu dòng thông thường ở Buổi 14
    // =========================================================================
    console.log("\n[S14-01] Kiểm tra chặn lưu nhận xét 3 gạch đầu dòng ở Buổi 14 (/session-comments)...");
    const blockApiRes = await saveCommentsLmsPost(
      makeJsonReq("http://127.0.0.1:3000/api/session-comments/save-lms", {
        classId: testClassId,
        classCode: testClassId,
        sessionId: `${testClassId}_SESS_14`,
      })
    );
    assert.strictEqual(
      blockApiRes.status,
      400,
      "API /api/session-comments/save-lms phải trả về HTTP 400 khi gọi cho Buổi 14"
    );
    const blockApiJson = await blockApiRes.json();
    assert.ok(
      String(blockApiJson.error || "").includes("Tab SPCK — Buổi 14"),
      "Thông báo lỗi phải hướng dẫn chuyển sang Tab SPCK — Buổi 14"
    );

    await assert.rejects(
      async () => {
        await CommentSaver.saveComments({
          classId: testClassId,
          classCode: testClassId,
          sessionId: `${testClassId}_SESS_14`,
        });
      },
      /Tab SPCK — Buổi 14/,
      "CommentSaver.saveComments phải chặn sessionId kết thúc bằng _SESS_14"
    );
    console.log("  -> PASS S14-01.");

    // =========================================================================
    // [S14-02] Kiểm tra nhận xét SPCK Buổi 14 (2 mục đánh số + tên gọi ngắn + quét HTML/CSS)
    // =========================================================================
    console.log("\n[S14-02] Kiểm tra nhận xét SPCK Buổi 14 theo mẫu 2 phần của giáo viên...");
    assert.strictEqual(formatSpckStudentCallName("Mccully Mac Dallas"), "Dallas");
    assert.strictEqual(formatSpckStudentCallName("Nguyễn Thiên Phúc"), "Thiên Phúc");
    assert.strictEqual(formatSpckStudentCallName("Trần Thế Ngọc"), "Thế Ngọc");

    const stuFolder = path.join(tempDir, "Dallas_Web");
    fs.mkdirSync(stuFolder, { recursive: true });
    const indexHtml = path.join(stuFolder, "index.html");
    const styleCss = path.join(stuFolder, "style.css");
    fs.writeFileSync(
      indexHtml,
      "<html><head><title>Bubu House Bakery Shop</title></head><body><h1>Bubu House Bakery Shop</h1></body></html>",
      "utf8"
    );
    fs.writeFileSync(
      styleCss,
      ".container { display: flex; justify-content: space-between; @media (max-width: 768px) {} }",
      "utf8"
    );

    const origGetGenModel = GoogleGenerativeAI.prototype.getGenerativeModel;
    try {
      let capturedSpckPrompt = "";
      GoogleGenerativeAI.prototype.getGenerativeModel = function () {
        return {
          generateContent: async (promptText: string) => {
            capturedSpckPrompt = String(promptText);
            return {
              response: {
                text: () =>
                  JSON.stringify({
                    attitudeSummary:
                      "STUDENT_01 đã xây dựng website Bubu House Bakery Shop với giao diện đẹp mắt, bố cục hợp lý và phù hợp với một website bán hàng kết hợp quảng cáo.",
                    productAndDesignEvaluation:
                      "Em sử dụng Flexbox phù hợp để sắp xếp các thành phần trên trang, đồng thời xây dựng nhiều trang và chức năng khá sáng tạo.",
                    technicalApplicationEvaluation:
                      "Sản phẩm thể hiện khả năng vận dụng tốt các kiến thức HTML, CSS và JavaScript đã học, cùng sự sáng tạo và đầu tư của em.",
                    presentationEvaluation:
                      "STUDENT_01 chuẩn bị slide với mẫu thiết kế đẹp, bố cục rõ ràng và nội dung đầy đủ, dễ nhìn. Em trình bày các nội dung chính của dự án khá tốt, thể hiện sự chuẩn bị nghiêm túc cho phần thuyết trình.",
                  }),
              },
            };
          },
        } as any;
      };

      const spckBatchRes = await SpckCommentGenerator.generateBatchSpckComments(
        {
          classId: testClassId,
          sessionNumber: 14,
        },
        [
          {
            studentId: stuDallasId,
            fullName: "Mccully Mac Dallas",
            projectTitle: "Bubu House Bakery Shop",
            localFolderPath: stuFolder,
            attachments: [indexHtml, styleCss],
            quickTags: ["Chuẩn bị slide thuyết trình đầy đủ, bố cục rõ ràng và sáng tạo"],
            teacherNote: "Sử dụng Flexbox tốt, trình bày rõ ràng.",
            includePresentation: true,
          },
        ]
      );

      assert.strictEqual(spckBatchRes.length, 1);
      assert.ok(
        !capturedSpckPrompt.includes("Mccully Mac Dallas") &&
          !capturedSpckPrompt.includes("Dallas"),
        "Prompt gửi Gemini phải ẩn danh 100% tên thật của học viên"
      );
      assert.ok(
        capturedSpckPrompt.includes("Flexbox") &&
          capturedSpckPrompt.includes("Bubu House Bakery Shop"),
        "Prompt phải tự động trích xuất được kỹ thuật Flexbox và tiêu đề từ file .html/.css"
      );

      const formatted = spckBatchRes[0].formattedTeacherComment;
      assert.ok(
        formatted.startsWith("1. Về phần thuyết trình\n") &&
          formatted.includes("\n2. Về phần sản phẩm cuối khóa\n"),
        "Bình luận SPCK Buổi 14 khi có thuyết trình phải có bố cục 2 mục đánh số: '1. Về phần thuyết trình' và '2. Về phần sản phẩm cuối khóa'"
      );
      assert.ok(
        formatted.includes("Dallas chuẩn bị slide") &&
          formatted.includes("Dallas đã xây dựng website"),
        "Bình luận SPCK Buổi 14 phải khử ẩn danh về tên gọi ngắn 'Dallas'"
      );
    } finally {
      GoogleGenerativeAI.prototype.getGenerativeModel = origGetGenModel;
    }
    console.log("  -> PASS S14-02.");

    // =========================================================================
    // [S14-03] Kiểm tra đọc điểm Demo từ file .xlsx & gợi ý Điểm Năng lực [ĐNL]
    // =========================================================================
    console.log("\n[S14-03] Kiểm tra đọc file 'Bảng chấm điểm buổi Demo.xlsx'...");
    const demoXlsxPath = path.join(
      tempDir,
      `Bảng chấm điểm buổi Demo - ${testClassId}.xlsx`
    );
    fs.writeFileSync(demoXlsxPath, buildTestDemoWorkbookBuffer("Mccully Mac Dallas"));

    const importRes = await s14EvalImportDemoPost(
      makeJsonReq("http://127.0.0.1:3000/api/spck/session14-eval/import-demo-scores", {
        classId: testClassId,
        sourcePathOrUrl: demoXlsxPath,
      })
    );
    assert.strictEqual(importRes.status, 200);
    const importJson = await importRes.json();
    assert.strictEqual(importJson.success, true);
    assert.strictEqual(importJson.importResult.matchedCount, 1);

    const dallasEvalAfterImport = session14EvalRepo.findOne(testClassId, stuDallasId)!;
    assert.strictEqual(
      dallasEvalAfterImport.demoTotalScore,
      4.5,
      "Tổng điểm Demo tính từ E8:E27 phải bằng đúng 4.5 điểm"
    );
    assert.ok(
      dallasEvalAfterImport.demoJudgeNote.includes("giao diện đẹp mắt"),
      "Phải trích xuất được nhận xét của BGK tại ô B30"
    );

    // Update Dallas's competency scores to match the sample (8 items = 4, 1 item = 5 -> 37/9 = 4.11)
    const saveCompRes = await s14EvalPost(
      makeJsonReq("http://127.0.0.1:3000/api/spck/session14-eval", {
        action: "save_draft",
        classId: testClassId,
        studentId: stuDallasId,
        competencyScores: {
          knowledgeInClass: 4,
          knowledgeSelfStudy: 5,
          skillCommunication: 4,
          skillComputerUse: 4,
          skillProblemSolving: 4,
          skillCreativity: 4,
          skillComputational: 4,
          attitudeHomework: 4,
          attitudeInClass: 4,
        },
        quickTags: ["Tự giác tìm hiểu và hoàn thành bài tập mà không phụ thuộc vào AI"],
        teacherNote: "Đôi lúc chưa thực sự tập trung, cần chú ý hơn trong giờ học.",
      })
    );
    const saveCompJson = await saveCompRes.json();
    assert.strictEqual(saveCompJson.success, true);
    assert.strictEqual(
      saveCompJson.record.competencyTotalScore,
      4.11,
      "Điểm Năng lực [ĐNL] trung bình (37/9) phải làm tròn chuẩn 4.11"
    );
    console.log("  -> PASS S14-03.");

    // =========================================================================
    // [S14-04] Kiểm tra AI soạn Thư từ MindX 3 phần (Mẫu Mccully Mac Dallas + Guardrails)
    // =========================================================================
    console.log("\n[S14-04] Kiểm tra AI soạn Thư từ MindX 3 phần & Guardrail INSUFFICIENT_INFO...");
    // 1. Student 2 has no tags, no note, no SPCK comment, no history -> must return INSUFFICIENT_INFO
    const emptyAiRes = await s14EvalGenerateAiPost(
      makeJsonReq("http://127.0.0.1:3000/api/spck/session14-eval/generate-ai", {
        classId: testClassId,
        students: [
          {
            studentId: stuEmptyId,
            quickTags: [],
            teacherNote: "",
          },
        ],
      })
    );
    const emptyAiJson = await emptyAiRes.json();
    assert.strictEqual(emptyAiJson.success, true);
    assert.strictEqual(
      emptyAiJson.results[0].status,
      "INSUFFICIENT_INFO",
      "Khi không có dữ kiện đầu vào, AI đánh giá Buổi 14 phải trả về INSUFFICIENT_INFO"
    );

    // 2. Student 1 (Mccully Mac Dallas) with mocked Gemini response
    let capturedS14EvalPrompt = "";
    try {
      GoogleGenerativeAI.prototype.getGenerativeModel = function () {
        return {
          generateContent: async (promptText: string) => {
            capturedS14EvalPrompt = String(promptText);
            return {
              response: {
                text: () =>
                  JSON.stringify({
                    knowledgeParagraph1:
                      "Trong suốt quá trình học, STUDENT_SHORT_01 thể hiện khả năng tiếp thu khá nhanh, tư duy tốt và có ý thức học tập nghiêm túc. Em thường tập trung lắng nghe hướng dẫn, có khả năng ghi nhớ và vận dụng kiến thức vào bài thực hành. Đặc biệt, STUDENT_SHORT_01 có tinh thần tự giác tìm hiểu và chủ động trong học tập, đồng thời chịu khó hoàn thành bài tập mà không phụ thuộc vào AI.",
                    knowledgeParagraph2:
                      "Trong một số buổi học, STUDENT_SHORT_01 đôi lúc chưa thực sự tập trung và còn làm việc riêng, vì vậy cần chú ý hơn để duy trì sự tập trung xuyên suốt buổi học.",
                    knowledgeParagraph3:
                      "Ở dự án cuối khóa, STUDENT_SHORT_01 đã hoàn thiện tốt sản phẩm và slide thuyết trình. Em có sự đầu tư nghiêm túc vào quá trình thực hiện và biết vận dụng các kiến thức đã học để hoàn thiện sản phẩm theo yêu cầu.",
                    softSkillsParagraph1:
                      "STUDENT_SHORT_01 có thái độ học tập và hợp tác tốt với giáo viên, biết lắng nghe hướng dẫn và chủ động thực hiện các yêu cầu trong quá trình học.",
                    softSkillsParagraph2:
                      "Trong phần thuyết trình cuối khóa, STUDENT_SHORT_01 đã chuẩn bị slide với mẫu thiết kế đẹp, bố cục rõ ràng, nội dung đầy đủ và dễ nhìn. Em nên tiếp tục rèn luyện khả năng diễn đạt và trình bày để ngày càng tự tin hơn khi giới thiệu sản phẩm của mình.",
                    personalParagraph1:
                      "STUDENT_SHORT_01 là học viên có khả năng tiếp thu nhanh, tư duy tốt và tinh thần tự học đáng ghi nhận.",
                    personalParagraph2:
                      "Trong thời gian tới, giáo viên khuyến khích STUDENT_SHORT_01 duy trì tinh thần tự học, tiếp tục tìm tòi và phát huy khả năng tư duy, đồng thời chú ý tập trung hơn trong giờ học.",
                    suggestionsFromMindx:
                      "Trong thời gian tới, khuyến khích STUDENT_SHORT_01 duy trì tinh thần tự học, chủ động tìm hiểu và tự thực hành không phụ thuộc vào AI. Bên cạnh đó, em cần chú ý tập trung hơn trong giờ học, hạn chế làm việc riêng.",
                    futureDirection:
                      "STUDENT_SHORT_01 có tiềm năng tốt với môn học nhờ khả năng tiếp thu nhanh, tư duy tốt và tinh thần tự giác tìm hiểu trong quá trình học tập. Khuyến khích STUDENT_SHORT_01 tiếp tục theo học khóa học nâng cao tiếp theo để mở rộng kiến thức chuyên môn.",
                  }),
              },
            };
          },
        } as any;
      };

      const dallasAiRes = await s14EvalGenerateAiPost(
        makeJsonReq("http://127.0.0.1:3000/api/spck/session14-eval/generate-ai", {
          classId: testClassId,
          students: [
            {
              studentId: stuDallasId,
            },
          ],
        })
      );
      const dallasAiJson = await dallasAiRes.json();
      assert.strictEqual(dallasAiJson.success, true);
      const item = dallasAiJson.results[0];
      assert.strictEqual(item.status, "SUCCESS");

      // Verify PII anonymization in prompt
      assert.ok(
        !capturedS14EvalPrompt.includes("Mccully Mac Dallas") &&
          !capturedS14EvalPrompt.includes("Dallas"),
        "Prompt Thư tổng kết Buổi 14 tuyệt đối không được lộ tên thật của học viên"
      );

      // Verify exact Dallas sample layout & TypeScript-injected scores (without redundant greeting/closing)
      assert.ok(
        !item.learnedFromMindx.includes("Kính gửi Quý Phụ huynh") &&
          !item.learnedFromMindx.includes("MindX ghi nhận sự nỗ lực") &&
          item.learnedFromMindx.startsWith("Về kiến thức chuyên môn:") &&
          item.learnedFromMindx.includes("Kết quả đánh giá:\nĐiểm Demo: 4.5 điểm\nĐiểm Năng lực: 4.11 điểm") &&
          item.learnedFromMindx.includes("Về kỹ năng mềm (giao tiếp, hợp tác, thuyết trình):") &&
          item.learnedFromMindx.includes("Nhận xét cá nhân:"),
        "Learned From Mindx phải khớp 100% bố cục không chứa câu chào đầu/chúc cuối thừa và chèn đúng điểm số"
      );
      assert.ok(
        item.suggestionsFromMindx.includes("Dallas duy trì tinh thần tự học") &&
          item.futureDirection.includes("Dallas có tiềm năng tốt"),
        "Suggestions From Mindx và Future Direction phải khử ẩn danh chuẩn về tên gọi ngắn 'Dallas'"
      );
    } finally {
      GoogleGenerativeAI.prototype.getGenerativeModel = origGetGenModel;
    }
    console.log("  -> PASS S14-04.");

    // =========================================================================
    // [S14-05] Kiểm tra Duyệt (APPROVED + SHA-256 Hash) & Tự hạ trạng thái khi sửa sau duyệt
    // =========================================================================
    console.log("\n[S14-05] Kiểm tra khóa SHA-256 khi Duyệt & tự động hạ về WAITING_APPROVAL khi sửa...");
    const dallasBeforeApprove = session14EvalRepo.findOne(testClassId, stuDallasId)!;
    const approveRes = await s14EvalPost(
      makeJsonReq("http://127.0.0.1:3000/api/spck/session14-eval", {
        action: "approve",
        classId: testClassId,
        studentIds: [stuDallasId],
        expectedVersion: dallasBeforeApprove.draftVersion,
      })
    );
    const approveJson = await approveRes.json();
    assert.strictEqual(approveJson.success, true);
    const approvedRec = session14EvalRepo.findOne(testClassId, stuDallasId)!;
    assert.strictEqual(approvedRec.status, "APPROVED");
    assert.ok(approvedRec.contentHash.length === 64, "Phải tạo mã băm SHA-256 khi duyệt");

    // Edit futureDirection after approval -> must demote to WAITING_APPROVAL and clear contentHash
    const editAfterAppRes = await s14EvalPost(
      makeJsonReq("http://127.0.0.1:3000/api/spck/session14-eval", {
        action: "save_draft",
        classId: testClassId,
        studentId: stuDallasId,
        futureDirection: approvedRec.futureDirection + " Chúc em học tốt khóa JSA.",
      })
    );
    const editAfterAppJson = await editAfterAppRes.json();
    assert.strictEqual(editAfterAppJson.success, true);
    assert.strictEqual(
      editAfterAppJson.record.status,
      "WAITING_APPROVAL",
      "Chỉnh sửa nội dung sau khi duyệt phải tự động hạ trạng thái về WAITING_APPROVAL"
    );
    assert.strictEqual(
      editAfterAppJson.record.contentHash,
      "",
      "Chỉnh sửa nội dung sau khi duyệt phải xóa contentHash cũ"
    );

    // Re-approve for Playwright upload test
    const reApprove = session14EvalRepo.approveDraft(testClassId, stuDallasId);
    assert.strictEqual(reApprove.success, true);
    assert.strictEqual(reApprove.record.status, "APPROVED");
    console.log("  -> PASS S14-05.");

    // =========================================================================
    // [S14-06] Kiểm tra Playwright Session14EvalUploader (45 radios, 6 number inputs, 3 .ql-editor, Read-after-Write)
    // =========================================================================
    console.log("\n[S14-06] Kiểm tra Playwright Session14EvalUploader trên DOM mô phỏng LMS Buổi 14...");
    const browser = await chromium.launch({ headless: true });
    const origCleanS6 = LmsHelpers.ensureCleanDialogAndToast;
    const origSlotS6 = LmsHelpers.ensureCommentsSlotReady;
    (LmsHelpers as any).ensureCleanDialogAndToast = async () => {};
    (LmsHelpers as any).ensureCommentsSlotReady = async () => {};
    try {
      const page = await browser.newPage();
      let serverPersistedEval: any = null;
      await page.route("**/*", async (route) => {
        const req = route.request();
        let reqBody: any = null;
        try {
          reqBody = JSON.parse(req.postData() || "{}");
        } catch {}
        if (reqBody?.operationName === "UpdateStudentEvaluation" && reqBody?.variables?.input) {
          serverPersistedEval = {
            id: "EVAL_DALLAS_1",
            studentId: reqBody.variables.studentId,
            classId: reqBody.variables.classId,
            slotNumber: reqBody.variables.slotNumber,
            ...reqBody.variables.input,
          };
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ data: { updateStudentEvaluation: { id: "EVAL_DALLAS_1" } } }),
          });
          return;
        }
        if (reqBody?.operationName === "GetStudentEvaluation" && serverPersistedEval) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ data: { studentEvaluation: serverPersistedEval } }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ data: { updateStudentEvaluation: { id: "EVAL_DALLAS_1" } } }),
        });
      });

      const radiosHtml = Array.from({ length: 9 })
        .map((_, g) =>
          Array.from({ length: 5 })
            .map((__, r) => `<input type="radio" name="comp_${g}" value="${r + 1}" />`)
            .join("")
        )
        .join("<br/>");

      await page.setContent(`
        <html>
          <body>
            <div class="MuiDrawer-root">
              <table>
                <tbody>
                  <tr data-student-id="${stuDallasId}">
                    <td>Mccully Mac Dallas</td>
                    <td><button id="open" type="button">Nhận xét học sinh</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div role="dialog" style="display:none;">
              <div>
                ${radiosHtml}
              </div>
              <div>
                <input type="number" disabled value="0" />
                <input type="number" value="0" />
                <input type="number" value="0" />
                <input type="number" value="0" />
                <input type="number" value="0" />
                <input type="number" value="0" />
              </div>
              <div>
                <div class="ql-editor" contenteditable="true"></div>
                <div class="ql-editor" contenteditable="true"></div>
                <div class="ql-editor" contenteditable="true"></div>
              </div>
              <button id="save" type="button">Save</button>
              <button id="close" type="button" aria-label="close">Cancel</button>
            </div>
          </body>
        </html>
      `);

      await page.evaluate(
        ({ sid, cid }) => {
          let openCount = 0;
          const d = document.querySelector('[role="dialog"]') as HTMLElement;
          document.getElementById("open")!.onclick = () => {
            openCount++;
            d.style.display = "block";
            if (openCount > 1) {
              fetch("https://lms-api.mindx.edu.vn/graphql", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  operationName: "GetStudentEvaluation",
                  variables: { studentId: sid, classId: cid, slotNumber: 14 },
                }),
              })
                .then((r) => r.json())
                .then((json) => {
                  const ev = json?.data?.studentEvaluation;
                  if (!ev) return;
                  document.querySelectorAll(".ql-editor").forEach((el, i) => {
                    el.textContent = ev.texts[i];
                  });
                  document.querySelectorAll('input[type="number"]').forEach((el, i) => {
                    if (i > 0) (el as HTMLInputElement).value = ev.nums[i - 1];
                  });
                  document.querySelectorAll('input[type="radio"]').forEach((el, i) => {
                    (el as HTMLInputElement).checked =
                      Number((el as HTMLInputElement).value) ===
                      ev.ratings[Math.floor(i / 5)];
                  });
                })
                .catch(() => {});
            }
          };
          document.getElementById("close")!.onclick = () => {
            d.style.display = "none";
          };
          document.getElementById("save")!.onclick = () => {
            const texts = Array.from(document.querySelectorAll(".ql-editor")).map(
              (el) => (el as HTMLElement).innerText
            );
            const nums = Array.from(document.querySelectorAll('input[type="number"]'))
              .slice(1)
              .map((el) => (el as HTMLInputElement).value);
            const ratings = Array.from({ length: 9 }, (_, g) =>
              Number(
                (document.querySelector(`input[name=comp_${g}]:checked`) as HTMLInputElement)
                  ?.value
              )
            );
            fetch("https://lms-api.mindx.edu.vn/graphql", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                operationName: "UpdateStudentEvaluation",
                variables: {
                  studentId: sid,
                  classId: cid,
                  slotNumber: 14,
                  input: {
                    learnedFromMindx: texts[0],
                    suggestionsFromMindx: texts[1],
                    futureDirection: texts[2],
                    texts,
                    nums,
                    ratings,
                  },
                },
              }),
            }).catch(() => {});
          };
        },
        { sid: stuDallasId, cid: testClassId }
      );

      const uploadSummary = await Session14EvalUploader.uploadApprovedEvaluations({
        classId: testClassId,
        studentIds: [stuDallasId],
        customPage: page,
        skipNavigation: false,
      });

      assert.strictEqual(
        uploadSummary.verifiedCount,
        1,
        "Session14EvalUploader phải đối chiếu Read-after-Write thành công và đánh dấu VERIFIED"
      );
      assert.strictEqual(uploadSummary.failedCount, 0);

      const finalDbRec = session14EvalRepo.findOne(testClassId, stuDallasId)!;
      assert.strictEqual(finalDbRec.status, "VERIFIED");
      assert.ok(finalDbRec.verifiedAt, "Phải ghi nhận thời điểm verifiedAt");

      // Check GET /api/spck/session14-eval reflects VERIFIED status
      const getRes = await s14EvalGet(
        new Request(
          `http://127.0.0.1:3000/api/spck/session14-eval?classId=${testClassId}`,
          { headers: { Host: "127.0.0.1:3000" } }
        )
      );
      const getJson = await getRes.json();
      assert.strictEqual(getJson.success, true);
      const dallasFromGet = getJson.records.find((r: any) => r.studentId === stuDallasId);
      assert.strictEqual(dallasFromGet.status, "VERIFIED");
    } finally {
      (LmsHelpers as any).ensureCleanDialogAndToast = origCleanS6;
      (LmsHelpers as any).ensureCommentsSlotReady = origSlotS6;
      await browser.close();
    }
    console.log("  -> PASS S14-06.");

    // =========================================================================
    // [S14-07] Kiểm thử hồi quy 12 ranh giới an toàn F01..F12 (Codex Round 1 Audit Fixes)
    // =========================================================================
    console.log("\n[S14-07] Kiểm thử hồi quy 12 ranh giới an toàn F01..F12...");

    // 1. F04 & F10: Ambiguous name, conflicting B2 vs tabName, duplicate tabs, and blank/unscored sheet
    const buildCustomWb = (
      cellB2: string,
      tabName: string,
      opts: { empty?: boolean; duplicate?: boolean; partialOnly?: boolean } = {}
    ): Buffer => {
      const z = new AdmZip();
      z.addFile(
        "xl/workbook.xml",
        Buffer.from(
          `<workbook><sheets><sheet name="${tabName}" r:id="rId1"/>${
            opts.duplicate ? '<sheet name="Copy" r:id="rId2"/>' : ""
          }</sheets></workbook>`
        )
      );
      z.addFile(
        "xl/_rels/workbook.xml.rels",
        Buffer.from(
          `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/>${
            opts.duplicate ? '<Relationship Id="rId2" Target="worksheets/sheet2.xml"/>' : ""
          }</Relationships>`
        )
      );
      const scoresXml = opts.empty
        ? ""
        : opts.partialOnly
        ? '<c r="B32"><v>1.5</v></c>'
        : '<c r="B32"><v>1.5</v></c><c r="B33"><v>1</v></c><c r="B34"><v>1</v></c><c r="B35"><v>1</v></c><c r="B36"><v>0.5</v></c>';
      const sheet1 = `<worksheet><sheetData><row><c r="B2" t="inlineStr"><is><t>${cellB2}</t></is></c>${scoresXml}</row></sheetData></worksheet>`;
      z.addFile("xl/worksheets/sheet1.xml", Buffer.from(sheet1));
      if (opts.duplicate) {
        z.addFile(
          "xl/worksheets/sheet2.xml",
          Buffer.from(sheet1.replace("<v>1.5</v>", "<v>0.2</v>"))
        );
      }
      return z.toBuffer();
    };

    const stuAn1 = `${testClassId}_STU_AN1`;
    const stuAn2 = `${testClassId}_STU_AN2`;
    studentRepo.upsert({ classId: testClassId, studentId: stuAn1, fullName: "Nguyễn Minh An", isActive: 1 });
    studentRepo.upsert({ classId: testClassId, studentId: stuAn2, fullName: "Trần Minh An", isActive: 1 });
    session14EvalRepo.saveDraft({
      classId: testClassId,
      studentId: stuAn1,
      demoScores: { algorithm: 1.2, creativity: 0.9, communication: 0.4, problemSolving: 0.9, computerSkills: 0.9 },
    });

    const ambRes = parseDemoWorkbookBufferForClass(testClassId, buildCustomWb("Minh An", "Minh An"), "synthetic");
    assert.strictEqual(ambRes.matchedCount, 0, "F04: Tên mơ hồ trùng 2 học viên phải bị chặn");

    const conflictRes = parseDemoWorkbookBufferForClass(
      testClassId,
      buildCustomWb("Trần Minh An", "Nguyễn Minh An"),
      "synthetic"
    );
    assert.strictEqual(conflictRes.matchedCount, 0, "F04: Xung đột tên giữa B2 và tên tab phải bị chặn");

    const dupRes = parseDemoWorkbookBufferForClass(
      testClassId,
      buildCustomWb("Nguyễn Minh An", "Nguyễn Minh An", { duplicate: true }),
      "synthetic"
    );
    assert.strictEqual(dupRes.matchedCount, 0, "F04: Hai tab trùng cùng 1 học viên phải bị chặn");
    assert.strictEqual(
      session14EvalRepo.findOne(testClassId, stuAn1)?.demoTotalScore,
      4.3,
      "F04: Điểm cũ của học viên không được bị ghi đè khi có tab trùng"
    );

    const blankRes = parseDemoWorkbookBufferForClass(
      testClassId,
      buildCustomWb("Nguyễn Minh An", "Nguyễn Minh An", { empty: true }),
      "synthetic"
    );
    assert.strictEqual(blankRes.matchedCount, 0, "F10: Sheet trống chưa chấm không được nhập thành 0 điểm");

    const partialRes = parseDemoWorkbookBufferForClass(
      testClassId,
      buildCustomWb("Nguyễn Minh An", "Nguyễn Minh An", { partialOnly: true }),
      "synthetic"
    );
    assert.strictEqual(partialRes.matchedCount, 0, "F10: Sheet chấm thiếu tiêu chí không được ghi đè điểm");

    const buildEdgeWb = (cellsXml: string): Buffer => {
      const z = new AdmZip();
      z.addFile("xl/workbook.xml", Buffer.from('<workbook><sheets><sheet name="Nguyễn Minh An" r:id="rId1"/></sheets></workbook>'));
      z.addFile("xl/_rels/workbook.xml.rels", Buffer.from('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'));
      z.addFile("xl/worksheets/sheet1.xml", Buffer.from(`<worksheet><sheetData><row><c r="B2" t="inlineStr"><is><t>Nguyễn Minh An</t></is></c>${cellsXml}</row></sheetData></worksheet>`));
      return z.toBuffer();
    };

    const partialERes = parseDemoWorkbookBufferForClass(
      testClassId,
      buildEdgeWb([8, 14, 18, 20, 23].map((r) => `<c r="E${r}"><v>0.1</v></c>`).join("")),
      "synthetic"
    );
    assert.strictEqual(partialERes.matchedCount, 0, "F10: Sheet chỉ chấm 1 phần cột E phải bị chặn");

    const invalidRangeRes = parseDemoWorkbookBufferForClass(
      testClassId,
      buildEdgeWb([-1, 100, 100, 100, 100].map((v, j) => `<c r="B${32 + j}"><v>${v}</v></c>`).join("")),
      "synthetic"
    );
    assert.strictEqual(invalidRangeRes.matchedCount, 0, "F10: Sheet có điểm ngoài thang cho phép phải bị chặn");

    // 2. F09: Single-word given name, accentless variant, shared given name, and 1-char name anonymization
    const anonSample = anonymizeSession14Text(
      "Phúc và Phuc phối hợp với Minh An và Tran Minh An rất tốt.",
      "Nguyễn Thiên Phúc",
      "Thiên Phúc",
      "STUDENT_FULL_01",
      "STUDENT_SHORT_01",
      ["Trần Minh An"]
    );
    assert.ok(
      !anonSample.includes("Phúc") &&
        !anonSample.toLowerCase().includes("phuc") &&
        !anonSample.includes("Minh An") &&
        anonSample.includes("STUDENT_SHORT_01") &&
        anonSample.includes("PEER_STUDENT"),
      "F09: Phải ẩn danh cả tên đơn 1 từ, tên không dấu và tên bạn cùng lớp"
    );

    const anonSharedGiven = anonymizeSession14Text(
      "An phối hợp với Trần Hoài An và Tran Hoai An.",
      "Nguyễn Minh An",
      "Minh An",
      "STUDENT_FULL_01",
      "STUDENT_SHORT_01",
      ["Trần Hoài An"]
    );
    assert.ok(
      !anonSharedGiven.includes("Trần Hoài") &&
        !anonSharedGiven.toLowerCase().includes("tran hoai") &&
        anonSharedGiven.includes("PEER_STUDENT"),
      "F09: Khi học viên và bạn cùng lớp trùng tên đơn (An), phải ẩn danh trọn vẹn họ đệm của bạn cùng lớp"
    );

    const anonOneChar = anonymizeSession14Text(
      "Lê Hoài Ý chăm học. Ở lớp cô gọi Ý lên bảng. Y trình bày tốt. ý hợp tác. y có tiến bộ.",
      "Lê Hoài Ý",
      "Hoài Ý",
      "STUDENT_FULL_01",
      "STUDENT_SHORT_01",
      []
    );
    assert.ok(
      !anonOneChar.includes("Ý") &&
        !anonOneChar.includes("ý") &&
        !/(?<![\p{L}\p{N}_])[Yy](?![\p{L}\p{N}_])/u.test(anonOneChar),
      "F09: Tên đơn 1 ký tự (Ý / ý / Y / y) phải được ẩn danh"
    );

    // 3. F06: Score-Letter synchronization & consistency check on approve (including markdown/bold/numbered labels)
    const letterF06 = assembleLearnedFromMindxLetter({
      fullName: "Nguyễn Minh An",
      callName: "Minh An",
      knowledgeParagraph1: "Kiến thức tốt.",
      knowledgeParagraph2: "Cần tập trung.",
      knowledgeParagraph3: "Sản phẩm tốt.",
      demoTotalScore: 4.3,
      competencyTotalScore: 4,
      softSkillsParagraph1: "Hợp tác tốt.",
      softSkillsParagraph2: "Thuyết trình tốt.",
      personalParagraph1: "Tiến bộ.",
      personalParagraph2: "Tiếp tục phát huy.",
    });
    session14EvalRepo.saveDraft({
      classId: testClassId,
      studentId: stuAn1,
      learnedFromMindx: letterF06
        .replace("Điểm Demo:", "1. **Điểm Demo:**")
        .replace("Điểm Năng lực:", "2. **Điểm Năng lực:**"),
      suggestionsFromMindx: "Lời khuyên.",
      futureDirection: "Định hướng.",
    });
    // Now change algorithm from 1.2 -> 0.5 (total 4.3 -> 3.6) without passing learnedFromMindx
    const afterScoreEdit = session14EvalRepo.saveDraft({
      classId: testClassId,
      studentId: stuAn1,
      demoScores: { algorithm: 0.5 },
    });
    assert.strictEqual(afterScoreEdit.record.demoTotalScore, 3.6);
    assert.ok(
      afterScoreEdit.record.learnedFromMindx.includes("1. **Điểm Demo:** 3.6 điểm"),
      "F06: Khi sửa điểm Demo (kể cả nhãn đánh số + in đậm), điểm trong thư phải tự động đồng bộ"
    );
    const missingScoreLinesLetter = afterScoreEdit.record.learnedFromMindx;
    session14EvalRepo.saveDraft({
      classId: testClassId,
      studentId: stuAn1,
      learnedFromMindx: "Thư bị xóa hai dòng điểm.",
    });
    const missingScoreLinesApprove = session14EvalRepo.approveDraft(testClassId, stuAn1);
    assert.strictEqual(
      missingScoreLinesApprove.success,
      false,
      "F06: Thư thiếu dòng Điểm Demo hoặc Điểm Năng lực không được phép duyệt"
    );
    session14EvalRepo.saveDraft({
      classId: testClassId,
      studentId: stuAn1,
      learnedFromMindx: missingScoreLinesLetter,
    });

    // 4. F07 (API): Stale or missing expectedVersion on approve must return HTTP 409 / 400
    const approvedAn1 = session14EvalRepo.approveDraft(testClassId, stuAn1);
    assert.strictEqual(approvedAn1.success, true);
    const staleVer = approvedAn1.record.draftVersion;
    session14EvalRepo.saveDraft({
      classId: testClassId,
      studentId: stuAn1,
      futureDirection: "Định hướng mới chưa duyệt.",
    });
    const staleApproveRes = await s14EvalPost(
      makeJsonReq("http://127.0.0.1:3000/api/spck/session14-eval", {
        action: "approve",
        classId: testClassId,
        studentIds: [stuAn1],
        expectedVersion: staleVer,
      })
    );
    assert.strictEqual(staleApproveRes.status, 409, "F07: Duyệt với expectedVersion cũ phải trả HTTP 409");
    const missingVerRes = await s14EvalPost(
      makeJsonReq("http://127.0.0.1:3000/api/spck/session14-eval", {
        action: "approve",
        classId: testClassId,
        studentIds: [stuAn1],
      })
    );
    assert.strictEqual(missingVerRes.status, 400, "F07: Duyệt thiếu expectedVersion phải trả HTTP 400");
    assert.strictEqual(
      session14EvalRepo.findOne(testClassId, stuAn1)?.status,
      "WAITING_APPROVAL",
      "F07: Trạng thái phải giữ nguyên WAITING_APPROVAL khi xung đột hoặc thiếu phiên bản"
    );

    // 5. F05: Stale AI response must NOT overwrite newer teacher edits or approved record
    let releaseAi!: () => void;
    let enteredAi!: () => void;
    const enteredAiPromise = new Promise<void>((r) => (enteredAi = r));
    const pauseAiPromise = new Promise<void>((r) => (releaseAi = r));
    const currentAn1 = session14EvalRepo.findOne(testClassId, stuAn1)!;
    try {
      GoogleGenerativeAI.prototype.getGenerativeModel = function () {
        return {
          generateContent: async () => {
            enteredAi();
            await pauseAiPromise;
            return {
              response: {
                text: () =>
                  JSON.stringify({
                    knowledgeParagraph1: "Cũ 1.",
                    knowledgeParagraph2: "Cũ 2.",
                    knowledgeParagraph3: "Cũ 3.",
                    softSkillsParagraph1: "Cũ 4.",
                    softSkillsParagraph2: "Cũ 5.",
                    personalParagraph1: "Cũ 6.",
                    personalParagraph2: "Cũ 7.",
                    suggestionsFromMindx: "AI_OLD_SUGGESTION",
                    futureDirection: "AI_OLD_FUTURE",
                  }),
              },
            };
          },
        } as any;
      };

      const pendingAi = Session14CourseSummaryGenerator.generateBatch(testClassId, [
        {
          studentId: stuAn1,
          fullName: "Nguyễn Minh An",
          expectedVersion: currentAn1.draftVersion,
          teacherNote: "An phối hợp tốt.",
        },
      ]);
      await enteredAiPromise;
      session14EvalRepo.saveDraft({
        classId: testClassId,
        studentId: stuAn1,
        futureDirection: "TEACHER_NEW_FUTURE",
        demoScores: { algorithm: 1.5 },
      });
      session14EvalRepo.approveDraft(testClassId, stuAn1);
      releaseAi();
      const aiOut = await pendingAi;
      assert.strictEqual(aiOut[0].status, "CONFLICT", "F05: AI trả về muộn sau khi GV đã sửa/duyệt phải báo CONFLICT");
      const finalAn1 = session14EvalRepo.findOne(testClassId, stuAn1)!;
      assert.strictEqual(finalAn1.status, "APPROVED", "F05: Phải giữ nguyên trạng thái APPROVED của GV");
      assert.strictEqual(finalAn1.futureDirection, "TEACHER_NEW_FUTURE", "F05: Phải giữ nguyên nội dung mới của GV");
      assert.strictEqual(finalAn1.demoTotalScore, 4.6, "F05: Phải giữ nguyên điểm mới của GV");
    } finally {
      GoogleGenerativeAI.prototype.getGenerativeModel = origGetGenModel;
    }

    // 6. F11: Attendance-only row (ABSENT) without tags/notes must return INSUFFICIENT_INFO
    sessionFeedbackRepo.upsert({
      classId: testClassId,
      sessionId: `${testClassId}_SESS_1`,
      studentId: stuAn2,
      attendanceStatus: "ABSENT",
      status: "DRAFT",
    });
    const absHistoryRes = await Session14CourseSummaryGenerator.generateBatch(testClassId, [
      { studentId: stuAn2, fullName: "Trần Minh An" },
    ]);
    assert.strictEqual(
      absHistoryRes[0].status,
      "INSUFFICIENT_INFO",
      "F11: Chỉ có bản ghi điểm danh ABSENT không có nhận xét phải chặn INSUFFICIENT_INFO"
    );

    // 7. F01, F02, F03: Playwright Session14EvalUploader network, full-text & slot-drift checks
    const browserF = await chromium.launch({ headless: true });
    const origClean = LmsHelpers.ensureCleanDialogAndToast;
    const origSlotReady = LmsHelpers.ensureCommentsSlotReady;
    (LmsHelpers as any).ensureCleanDialogAndToast = async () => {};
    (LmsHelpers as any).ensureCommentsSlotReady = async (pg: any) => {
      const slot = await pg.evaluate(() => (window as any).activeSlot);
      if (slot !== 14) throw new Error("slot mismatch");
    };
    try {
      for (const mode of [
        "unrelated-response",
        "query-only",
        "cached-draft",
        "autoclose-cached-draft",
        "escape-cached-draft",
        "state-cached-draft",
        "closure-button",
        "closure-autoclose",
        "closure-escape",
        "truncated-tail",
        "slot-drift",
      ] as const) {
        session14EvalRepo.approveDraft(testClassId, stuAn1);
        const pg = await browserF.newPage();
        await pg.route("**/*", async (route) => {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({
              data:
                mode === "unrelated-response"
                  ? { viewer: { id: "T1" } }
                  : { updateStudentEvaluation: { id: "E1" } },
            }),
          });
        });
        const radios = SESSION14_COMPETENCY_KEYS.map((_, g) =>
          Array.from(
            { length: 5 },
            (__, r) =>
              `<input type="radio" name="g${g}" value="${r + 1}" ${
                mode === "slot-drift" ? 'onclick="window.activeSlot=13"' : ""
              }>`
          ).join("")
        ).join("");
        await pg.setContent(
          `<body><div class="MuiDrawer-root"><table><tr data-student-id="${stuAn1}"><td>Nguyễn Minh An</td><td><button id="open">Nhận xét học sinh</button></td></tr></table></div><div role="dialog" style="display:none">${radios}<input type="number" disabled><input type="number"><input type="number"><input type="number"><input type="number"><input type="number"><div class="ql-editor" contenteditable="true"></div><div class="ql-editor" contenteditable="true"></div><div class="ql-editor" contenteditable="true"></div><button id="save">Save</button><button id="close" aria-label="close">Cancel</button></div></body>`
        );
        await pg.evaluate("globalThis.__name = (f) => f");
        await pg.evaluate(
          ({ m, sid, cid }) => {
            const w = window as any;
            w.activeSlot = 14;
            w.savedSlots = [];
            let closureCached: any = null;
            const serverOld = {
              texts: ["SERVER OLD", "SERVER OLD", "SERVER OLD"],
              nums: ["0", "0", "0", "0", "0"],
              ratings: [1, 1, 1, 1, 1, 1, 1, 1, 1],
            };
            w.persisted = serverOld;
            const d = document.querySelector("[role=dialog]") as HTMLElement;
            const applyForm = (f: any) => {
              document.querySelectorAll(".ql-editor").forEach((el, i) => {
                el.textContent = f.texts[i];
              });
              document.querySelectorAll('input[type="number"]').forEach((el, i) => {
                if (i > 0) (el as HTMLInputElement).value = f.nums[i - 1];
              });
              document.querySelectorAll('input[type="radio"]').forEach((el, i) => {
                (el as HTMLInputElement).checked =
                  Number((el as HTMLInputElement).value) === f.ratings[Math.floor(i / 5)];
              });
            };
            document.getElementById("open")!.onclick = () => {
              if (m.startsWith("closure-") && closureCached) {
                applyForm(closureCached);
              } else if (m === "state-cached-draft" && w.cached) {
                applyForm(w.cached);
              } else if (!m.endsWith("cached-draft")) {
                applyForm(w.persisted);
              }
              d.style.display = "block";
            };
            document.getElementById("close")!.onclick = () => {
              d.style.display = "none";
            };
            if (m === "escape-cached-draft" || m === "closure-escape") {
              document.getElementById("close")!.remove();
              document.addEventListener("keydown", (e) => {
                if (e.key === "Escape") d.style.display = "none";
              });
            }
            document.getElementById("save")!.onclick = () => {
              w.savedSlots.push(w.activeSlot);
              const texts = Array.from(document.querySelectorAll(".ql-editor")).map(
                (el) => (el as HTMLElement).innerText
              );
              const nums = Array.from(document.querySelectorAll('input[type="number"]'))
                .slice(1)
                .map((el) => (el as HTMLInputElement).value);
              const ratings = Array.from({ length: 9 }, (_, g) =>
                Number(
                  (document.querySelector(`input[name=g${g}]:checked`) as HTMLInputElement)
                    ?.value
                )
              );
              const form = { texts, nums, ratings };
              w.cached = form;
              closureCached = form;
              if (m === "autoclose-cached-draft" || m === "closure-autoclose") {
                d.style.display = "none";
              }
              if (m === "truncated-tail") {
                texts[0] = texts[0].slice(0, 60) + " CORRUPTED_TAIL";
              }
              if (
                !m.endsWith("cached-draft") &&
                !m.startsWith("closure-") &&
                m !== "query-only"
              ) {
                w.persisted = form;
              }
              const operationName =
                m === "unrelated-response" ? "GetTeacherProfile" : "UpdateStudentEvaluation";
              const reqPayload: any = {
                operationName,
                variables: { studentId: sid, classId: cid, slotNumber: 14 },
                query:
                  m === "query-only"
                    ? "query UpdateStudentEvaluation { updateStudentEvaluation { id } }"
                    : "mutation UpdateStudentEvaluation($input: EvalInput) { updateStudentEvaluation(input:$input) { id } }",
              };
              fetch("https://lms-api.mindx.edu.vn/graphql", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(reqPayload),
              }).catch(() => {});
            };
          },
          { m: mode, sid: stuAn1, cid: testClassId }
        );
        const upRes = await Session14EvalUploader.uploadApprovedEvaluations({
          classId: testClassId,
          studentIds: [stuAn1],
          customPage: pg,
          skipNavigation: false,
        });
        assert.strictEqual(upRes.verifiedCount, 0, `F01/F02/F03 (${mode}): Không được đánh dấu VERIFIED`);
        assert.strictEqual(upRes.failedCount, 1, `F01/F02/F03 (${mode}): Phải ghi nhận failedCount=1`);
        if (mode === "slot-drift") {
          const savedSlots = await pg.evaluate(() => (window as any).savedSlots);
          assert.strictEqual(savedSlots.length, 0, "F03: Khi lệch buổi sang 13 phải chặn trước khi bấm Save");
        }
        await pg.close();
      }

      // F01 Round 6, Round 7 & Round 8 checks: fractional rating (4.4), out-of-range rating (0/6), wrong integer rating (1), delayed reopen response (450ms/6500ms), delayed reopen request (450ms/1700ms) with fullSave/bareId, and exact request-response pairing when a second reopen request (SECOND) arrives earlier
      for (const srcCase of [
        { id: "save-fractional", source: "save", fullSave: false, ratingVal: 4.4, delay: 0, requestDelay: 0, httpStatus: 200, second: false, secondHttp: 200, secondWrongClass: false, expectVerified: 0 },
        { id: "reopen-fractional", source: "load", fullSave: false, ratingVal: 4.4, delay: 0, requestDelay: 0, httpStatus: 200, second: false, secondHttp: 200, secondWrongClass: false, expectVerified: 0 },
        { id: "save-out-of-range-0", source: "save", fullSave: false, ratingVal: 0, delay: 0, requestDelay: 0, httpStatus: 200, second: false, secondHttp: 200, secondWrongClass: false, expectVerified: 0 },
        { id: "reopen-out-of-range-6", source: "load", fullSave: false, ratingVal: 6, delay: 0, requestDelay: 0, httpStatus: 200, second: false, secondHttp: 200, secondWrongClass: false, expectVerified: 0 },
        { id: "save-wrong-int", source: "save", fullSave: false, ratingVal: 1, delay: 0, requestDelay: 0, httpStatus: 200, second: false, secondHttp: 200, secondWrongClass: false, expectVerified: 0 },
        { id: "reopen-wrong-int", source: "load", fullSave: false, ratingVal: 1, delay: 0, requestDelay: 0, httpStatus: 200, second: false, secondHttp: 200, secondWrongClass: false, expectVerified: 0 },
        { id: "reopen-450ms-valid", source: "load", fullSave: false, ratingVal: 4, delay: 450, requestDelay: 0, httpStatus: 200, second: false, secondHttp: 200, secondWrongClass: false, expectVerified: 1 },
        { id: "fullsave-request-450ms-fractional", source: "load", fullSave: true, ratingVal: 4.4, delay: 0, requestDelay: 450, httpStatus: 200, second: false, secondHttp: 200, secondWrongClass: false, expectVerified: 0 },
        { id: "fullsave-request-450ms-http500", source: "load", fullSave: true, ratingVal: 4, delay: 0, requestDelay: 450, httpStatus: 500, second: false, secondHttp: 200, secondWrongClass: false, expectVerified: 0 },
        { id: "fullsave-reopen-6500ms-fractional", source: "load", fullSave: true, ratingVal: 4.4, delay: 6500, requestDelay: 0, httpStatus: 200, second: false, secondHttp: 200, secondWrongClass: false, expectVerified: 0 },
        { id: "bareid-request-1700ms-valid", source: "load", fullSave: false, ratingVal: 4, delay: 0, requestDelay: 1700, httpStatus: 200, second: false, secondHttp: 200, secondWrongClass: false, expectVerified: 1 },
        { id: "first-500-second-valid", source: "load", fullSave: true, ratingVal: 4, delay: 700, requestDelay: 0, httpStatus: 500, second: true, secondHttp: 200, secondWrongClass: false, expectVerified: 0 },
        { id: "first-fractional-second-valid", source: "load", fullSave: true, ratingVal: 4.4, delay: 700, requestDelay: 0, httpStatus: 200, second: true, secondHttp: 200, secondWrongClass: false, expectVerified: 0 },
        { id: "first-timeout-second-valid", source: "load", fullSave: true, ratingVal: 4, delay: 6500, requestDelay: 0, httpStatus: 200, second: true, secondHttp: 200, secondWrongClass: false, expectVerified: 0 },
        { id: "first-valid-second-500", source: "load", fullSave: true, ratingVal: 4, delay: 700, requestDelay: 0, httpStatus: 200, second: true, secondHttp: 500, secondWrongClass: false, expectVerified: 1 },
        { id: "first-500-second-wrong-class", source: "load", fullSave: true, ratingVal: 4, delay: 700, requestDelay: 0, httpStatus: 500, second: true, secondHttp: 200, secondWrongClass: true, expectVerified: 0 },
        { id: "first-valid-second-valid", source: "load", fullSave: true, ratingVal: 4, delay: 700, requestDelay: 0, httpStatus: 200, second: true, secondHttp: 200, secondWrongClass: false, expectVerified: 1 },
      ] as const) {
        session14EvalRepo.approveDraft(testClassId, stuAn1);
        const pg = await browserF.newPage();
        await pg.route("**/*", async (route) => {
          const reqObj = JSON.parse(route.request().postData() || "{}");
          const isLoad = reqObj.operationName === "GetStudentEvaluation";
          const st = await pg.evaluate(() => (window as any).getSavedForm());
          if (isLoad && reqObj.variables?.auditReq === "SECOND") {
            const secondPayload = {
              id: "E1",
              studentId: stuAn1,
              classId: srcCase.secondWrongClass ? "OTHER" : testClassId,
              slotNumber: 14,
              texts: st.texts,
              nums: st.nums,
              ratings: [...st.ratings.slice(0, 8), 4],
            };
            await route.fulfill({
              status: srcCase.secondHttp,
              contentType: "application/json",
              headers: { "Access-Control-Allow-Origin": "*" },
              body: JSON.stringify({ data: { studentEvaluation: secondPayload } }),
            });
            return;
          }
          const payload = {
            id: "E1",
            studentId: stuAn1,
            classId: testClassId,
            slotNumber: 14,
            texts: st.texts,
            nums: st.nums,
            ratings: [
              ...st.ratings.slice(0, 8),
              srcCase.fullSave && !isLoad ? 4 : srcCase.ratingVal,
            ],
          };
          const selected = (srcCase.source === "load") === isLoad || (!isLoad && srcCase.fullSave);
          if (isLoad && srcCase.delay > 0) {
            await new Promise((r) => setTimeout(r, srcCase.delay));
          }
          try {
            await route.fulfill({
              status: isLoad ? srcCase.httpStatus : 200,
              contentType: "application/json",
              headers: { "Access-Control-Allow-Origin": "*" },
              body: JSON.stringify({
                data: {
                  [isLoad ? "studentEvaluation" : "updateStudentEvaluation"]: selected
                    ? payload
                    : { id: "E1" },
                },
              }),
            });
          } catch (e) {
            if (!pg.isClosed()) throw e;
          }
        });
        const radios = SESSION14_COMPETENCY_KEYS.map((_, g) =>
          Array.from({ length: 5 }, (__, r) => `<input type="radio" name="g${g}" value="${r + 1}">`).join("")
        ).join("");
        await pg.setContent(
          `<body><div class="MuiDrawer-root"><table><tr data-student-id="${stuAn1}"><td>Nguyễn Minh An</td><td><button id="open">Nhận xét học sinh</button></td></tr></table></div><div role="dialog" style="display:none">${radios}<input type="number" disabled><input type="number"><input type="number"><input type="number"><input type="number"><input type="number"><div class="ql-editor" contenteditable="true"></div><div class="ql-editor" contenteditable="true"></div><div class="ql-editor" contenteditable="true"></div><button id="save">Save</button><button id="close" aria-label="close">Cancel</button></div></body>`
        );
        await pg.evaluate("globalThis.__name = (f) => f");
        await pg.evaluate(
          ({ isLoadSource, reqDelay, sendSecond, secondWrongCls, sid, cid }) => {
            const w = window as any;
            w.activeSlot = 14;
            let opens = 0;
            let savedForm: any = {
              texts: ["OLD", "OLD", "OLD"],
              nums: ["0", "0", "0", "0", "0"],
              ratings: [1, 1, 1, 1, 1, 1, 1, 1, 1],
            };
            w.getSavedForm = () => savedForm;
            const d = document.querySelector("[role=dialog]") as HTMLElement;
            const applyForm = (f: any) => {
              document.querySelectorAll(".ql-editor").forEach((el, i) => {
                el.textContent = f.texts[i];
              });
              document.querySelectorAll('input[type="number"]').forEach((el, i) => {
                if (i > 0) (el as HTMLInputElement).value = f.nums[i - 1];
              });
              document.querySelectorAll('input[type="radio"]').forEach((el, i) => {
                (el as HTMLInputElement).checked =
                  Number((el as HTMLInputElement).value) === f.ratings[Math.floor(i / 5)];
              });
            };
            const sendLoad = (auditReq = "FIRST") =>
              fetch("https://lms-api.mindx.edu.vn/graphql", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  operationName: "GetStudentEvaluation",
                  variables: {
                    studentId: sid,
                    classId: auditReq === "SECOND" && secondWrongCls ? "OTHER" : cid,
                    slotNumber: 14,
                    auditReq,
                  },
                  query: "query GetStudentEvaluation { studentEvaluation { id } }",
                }),
              }).catch(() => {});
            document.getElementById("open")!.onclick = () => {
              opens++;
              applyForm(savedForm);
              d.style.display = "block";
              if (opens > 1 && isLoadSource) {
                if (reqDelay > 0) setTimeout(() => sendLoad("FIRST"), reqDelay);
                else sendLoad("FIRST");
                if (sendSecond) setTimeout(() => sendLoad("SECOND"), 100);
              }
            };
            document.getElementById("close")!.onclick = () => {
              d.style.display = "none";
            };
            document.getElementById("save")!.onclick = () => {
              const texts = Array.from(document.querySelectorAll(".ql-editor")).map(
                (el) => (el as HTMLElement).innerText
              );
              const nums = Array.from(document.querySelectorAll('input[type="number"]'))
                .slice(1)
                .map((el) => (el as HTMLInputElement).value);
              const ratings = Array.from({ length: 9 }, (_, g) =>
                Number(
                  (document.querySelector(`input[name=g${g}]:checked`) as HTMLInputElement)?.value
                )
              );
              savedForm = { texts, nums, ratings };
              fetch("https://lms-api.mindx.edu.vn/graphql", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  operationName: "UpdateStudentEvaluation",
                  variables: { studentId: sid, classId: cid, slotNumber: 14 },
                  query:
                    "mutation UpdateStudentEvaluation($input: EvalInput) { updateStudentEvaluation(input:$input) { id } }",
                }),
              }).catch(() => {});
            };
          },
          {
            isLoadSource: srcCase.source === "load",
            reqDelay: srcCase.requestDelay,
            sendSecond: srcCase.second,
            secondWrongCls: srcCase.secondWrongClass,
            sid: stuAn1,
            cid: testClassId,
          }
        );
        const upRes = await Session14EvalUploader.uploadApprovedEvaluations({
          classId: testClassId,
          studentIds: [stuAn1],
          customPage: pg,
          skipNavigation: false,
        });
        assert.strictEqual(
          upRes.verifiedCount,
          srcCase.expectVerified,
          `F01 (${srcCase.id}): Kết quả verifiedCount phải bằng ${srcCase.expectVerified}`
        );
        assert.strictEqual(
          upRes.failedCount,
          srcCase.expectVerified === 1 ? 0 : 1,
          `F01 (${srcCase.id}): Kết quả failedCount phải khớp`
        );
        await pg.close();
      }
    } finally {
      (LmsHelpers as any).ensureCleanDialogAndToast = origClean;
      (LmsHelpers as any).ensureCommentsSlotReady = origSlotReady;
      await browserF.close();
    }

    // 8. F07, F08 & F12: UI Handlers & findLatestActiveSessionId
    const req = createRequire(import.meta.url);
    const swc = req("next/dist/build/swc");
    const scPageSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/session-comments/page.tsx"),
      "utf8"
    );
    const fnSlice = scPageSource.slice(
      scPageSource.indexOf("function findLatestActiveSessionId("),
      scPageSource.indexOf("export default function SessionCommentsPage")
    );
    const fnCompiled = swc.transformSync(
      fnSlice + "\nglobalThis.pick = findLatestActiveSessionId;",
      {
        filename: "selector.ts",
        jsc: { parser: { syntax: "typescript" }, target: "es2022" },
        module: { type: "es6" },
      }
    ).code;
    const scCtx: any = vm.createContext({ Date });
    vm.runInContext(fnCompiled, scCtx);
    assert.strictEqual(
      scCtx.pick([{ sessionId: "ONLY_SESS_14", sessionNumber: 14, date: "27/10/2026" }]),
      "",
      "F12: Khi danh sách chỉ có Buổi 14, findLatestActiveSessionId phải trả về chuỗi rỗng"
    );

    console.log("  -> PASS S14-07.");

    console.log("\n🎉 TẤT CẢ 7 HẠNG MỤC KIỂM THỬ BUỔI 14 (S14-01 -> S14-07) ĐỀU PASS 100%!");
  } finally {
    cleanup();
  }
}

runTests().catch((err) => {
  console.error("❌ LỖI KIỂM THỬ BUỔI 14 v2.9.0:", err);
  process.exit(1);
});
