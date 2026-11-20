/**
 * KIỂM THỬ TỰ ĐỘNG v3.6.6:
 * - V366-01: Chuẩn hóa bố cục nhận xét SPCK Buổi 12 & 13 (2 dòng mở đầu Tên + Dự án & Tiến độ thực tế,
 *            [ĐÃ LÀM ĐƯỢC], [CẦN HOÀN THIỆN TIẾP], tùy chọn [THUYẾT TRÌNH THỬ]); triệt tiêu câu khen
 *            thái độ rập khuôn khi không có ghi chú thái độ; lọc sạch tiêu đề mặc định "SPCK <Tên>".
 * - V366-02: Chuẩn hóa bố cục nhận xét SPCK Buổi 14 đồng bộ ([THUYẾT TRÌNH & SLIDE], [ĐIỂM NỔI BẬT CỦA SẢN PHẨM],
 *            [ĐIỂM CẦN HOÀN THIỆN THÊM]); ẩn mục thuyết trình khi thiếu dữ kiện; giữ nguyên Thư từ MindX 3 ô & ẩn danh PII.
 * - V366-03: Hậu kiểm Web theo từng dòng '+' (cắt sạch dòng bịa mà giữ dòng hợp lệ) + INSUFFICIENT_INFO giữ nguyên bản cũ.
 *
 * Chạy 100% cô lập trong `os.tmpdir()` — không chạm dữ liệu thật.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-spck-v366-"));
  const tempCfgDir = path.join(tempRoot, "config");
  const tempClassDir = path.join(tempRoot, "PTA13_SPCK");
  const webClassDir = path.join(tempRoot, "JSB16_SPCK");
  fs.mkdirSync(tempCfgDir, { recursive: true });
  fs.mkdirSync(tempClassDir, { recursive: true });
  fs.mkdirSync(webClassDir, { recursive: true });

  process.env.MINDX_DB_PATH = path.join(tempRoot, "test_v366.db");
  process.env.MINDX_CONFIG_DIR = tempCfgDir;
  process.env.MINDX_RUNNING_CLASSES_PATH = path.join(tempRoot, "running_classes.json");
  process.env.MINDX_ALLOWED_EXTRA_PATHS = tempRoot;
  process.env.GEMINI_API_KEY = "AIzaDummyTestKeyV366_NeverLive";

  const { getDb, session14EvalRepo, spckSessionRepo, spckUploadRepo, studentRepo } =
    await import("../src/lib/db/sqlite");
  const {
    SpckCommentGenerator,
    detectExplicitAttitudeNote,
    extractRawBulletItems,
    formatSpckBulletSection,
    resolveCleanSpckHeaderTopic,
    stripGenericAttitudeClichéForStage1,
  } = await import("../src/lib/gemini/spck-comment");
  const { Session14CourseSummaryGenerator, normalizeTeacherSelfReferenceToGiaoVien } =
    await import("../src/lib/gemini/session14-course-summary");
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const origGetModel = GoogleGenerativeAI.prototype.getGenerativeModel;

  try {
    console.log("🚀 BẮT ĐẦU KIỂM THỬ v3.6.6 TRONG:", tempRoot);
    const db = getDb();

    const ptaClassId = "VT-C4K-PTA13";
    const stuId = "STU_AN_01";
    const fullName = "Bùi Tú An";
    const stuDir = path.join(tempClassDir, fullName);
    fs.mkdirSync(stuDir, { recursive: true });
    fs.writeFileSync(
      path.join(stuDir, "main.py"),
      "class PlayerCard:\n    pass\n",
      "utf8"
    );

    for (const sNum of [12, 13, 14]) {
      db.prepare(
        `INSERT INTO classes_sessions (sessionId, classId, className, sessionNumber, date) VALUES (?, ?, ?, ?, '2026-11-20')`
      ).run(`${ptaClassId}_SESS_${sNum}`, ptaClassId, ptaClassId, sNum);
    }

    studentRepo.upsert({
      studentId: stuId,
      classId: ptaClassId,
      fullName,
      isActive: 1,
    });
    spckUploadRepo.upsert({
      classId: ptaClassId,
      studentId: stuId,
      isConfirmedByTeacher: 1,
      projectTitle: "Ứng dụng quản lý thông tin bóng đá (PyQt6)",
      localFolderPath: stuDir,
      attachmentsJson: JSON.stringify([path.join(stuDir, "main.py")]),
      screenshotsJson: "[]",
      youtubeUrlsJson: "[]",
      relatedLinksJson: "[]",
      status: "DRAFT",
    });

    // =========================================================================
    // V366-01: Bố cục Buổi 12 & 13 + Triệt tiêu câu khen thái độ + Làm sạch tiêu đề
    // =========================================================================
    console.log("\n[V366-01] Kiểm tra bố cục Buổi 12 & 13 và lọc câu khen thái độ rập khuôn...");
    let mockPayload: Record<string, unknown> = {
      attitudeSummary:
        "STUDENT_01 đã thể hiện tinh thần học tập tập trung, nghiêm túc và chủ động hoàn thiện 12 màn hình giao diện PyQt6.",
      productAndDesignEvaluation:
        "+ Thiết kế đồng bộ 12 màn hình trên Qt Designer với phối màu xanh thể thao (Trang chủ, Danh sách cầu thủ).\n+ Xây dựng các lớp OOP kết nối sự kiện chuyển màn hình mượt mà.",
      technicalApplicationEvaluation:
        "+ Kết nối nốt sự kiện mở chi tiết từng trang hồ sơ cầu thủ.\n+ Tích hợp tệp dữ liệu JSON và hộp thoại QMessageBox kiểm tra nhập liệu.",
      presentationEvaluation:
        "Con trình bày tự tin trước lớp.",
    };

    GoogleGenerativeAI.prototype.getGenerativeModel = function () {
      return {
        generateContent: async () => ({
          response: {
            text: () => JSON.stringify(mockPayload),
          },
        }),
      } as any;
    };

    const res12 = await SpckCommentGenerator.generateBatchSpckComments(
      { classId: ptaClassId, sessionNumber: 12 },
      [
        {
          studentId: stuId,
          fullName,
          projectTitle: "Ứng dụng quản lý thông tin bóng đá (PyQt6)",
          localFolderPath: stuDir,
          attachments: [path.join(stuDir, "main.py")],
          quickTags: [
            "✅ Đã thiết kế được các màn hình chính trên Qt Designer",
            "🔧 Cần hoàn thiện thêm sự kiện & dữ liệu JSON ở buổi 13",
          ],
          teacherNote: "Cần căn chỉnh nút bấm ở màn hình phụ.",
          includePresentation: false,
        },
      ]
    );

    assert.strictEqual(res12.length, 1);
    assert.strictEqual(res12[0].status, "WAITING_APPROVAL");
    const c12 = res12[0].formattedTeacherComment;
    const c12Lines = c12.split("\n");
    assert.strictEqual(
      c12Lines[0],
      "Bùi Tú An — Dự án: Ứng dụng quản lý thông tin bóng đá (PyQt6)."
    );
    assert.ok(
      !/tinh thần học tập|tập trung|nghiêm túc|chủ động/i.test(c12Lines[1]),
      `Dòng 2 Buổi 12 khi không có ghi chú thái độ vẫn bị khen rập khuôn: ${c12Lines[1]}`
    );
    assert.ok(
      c12Lines[1].includes("12 màn hình giao diện PyQt6"),
      `Dòng 2 phải giữ lại thông tin tiến độ thực tế: ${c12Lines[1]}`
    );
    assert.ok(c12.includes("\n\n[ĐÃ LÀM ĐƯỢC]\n+ Thiết kế đồng bộ 12 màn hình"));
    assert.ok(c12.includes("\n\n[CẦN HOÀN THIỆN TIẾP]\n+ Kết nối nốt sự kiện mở chi tiết"));
    assert.ok(!c12.includes("[THUYẾT TRÌNH"));
    assert.ok(!/thuyết trình|Buổi 12|GĐ1|\*\*/i.test(c12));

    // Check pure cliché replacement + default projectTitle ("SPCK Bùi Tú An - Buổi 12") fallback to inferredTopicTitle
    mockPayload = {
      inferredTopicTitle: "Quản lý danh sách cầu thủ bóng đá",
      attitudeSummary: "STUDENT_01 làm bài rất nghiêm túc, tích cực và chăm chỉ.",
      productAndDesignEvaluation: "+ Dựng được trang chủ và danh sách cầu thủ cơ bản.",
      technicalApplicationEvaluation: "+ Bổ sung thêm các trang hồ sơ chi tiết cầu thủ.",
      presentationEvaluation: "",
    };
    const res12Cliché = await SpckCommentGenerator.generateBatchSpckComments(
      { classId: ptaClassId, sessionNumber: 12 },
      [
        {
          studentId: stuId,
          fullName,
          projectTitle: "SPCK Bùi Tú An - Buổi 12",
          localFolderPath: stuDir,
          attachments: [path.join(stuDir, "main.py")],
          quickTags: ["✅ Đã thiết kế được các màn hình chính trên Qt Designer"],
          teacherNote: "",
          includePresentation: false,
        },
      ]
    );
    const c12ClichéLines = res12Cliché[0].formattedTeacherComment.split("\n");
    assert.strictEqual(
      c12ClichéLines[0],
      "Bùi Tú An — Dự án: Quản lý danh sách cầu thủ bóng đá."
    );
    assert.ok(!/SPCK Bùi Tú An|nghiêm túc|chăm chỉ|tích cực/i.test(c12ClichéLines.slice(0, 2).join(" ")));

    // Check explicit teacher attitude note IS preserved honestly
    mockPayload = {
      attitudeSummary: "STUDENT_01 còn mất tập trung khi ngồi máy nên tiến độ còn chậm, mới dựng được trang chủ.",
      productAndDesignEvaluation: "+ Dựng được khung trang chủ ứng dụng PyQt6.",
      technicalApplicationEvaluation: "+ Cần đẩy nhanh tốc độ hoàn thành các màn hình chính.",
      presentationEvaluation: "",
    };
    const res12Honest = await SpckCommentGenerator.generateBatchSpckComments(
      { classId: ptaClassId, sessionNumber: 12 },
      [
        {
          studentId: stuId,
          fullName,
          projectTitle: "Ứng dụng quản lý thông tin bóng đá (PyQt6)",
          localFolderPath: stuDir,
          attachments: [path.join(stuDir, "main.py")],
          quickTags: ["⏳ Tiến độ dựng giao diện hơi chậm"],
          teacherNote: "Con còn mất tập trung, cần nhắc nhở nhiều.",
          includePresentation: false,
        },
      ]
    );
    assert.ok(
      res12Honest[0].formattedTeacherComment.split("\n")[1].includes("còn mất tập trung"),
      "Khi giáo viên có ghi chú thái độ thật thì phải giữ lại nhận xét đó"
    );

    // Approve Session 12 so Session 13 detects prior evidence + enable [THUYẾT TRÌNH THỬ]
    spckSessionRepo.approveSessionDraft(ptaClassId, stuId, 12);
    mockPayload = {
      attitudeSummary:
        "So với Buổi 12, sản phẩm đã mở rộng hoàn chỉnh lên 12 màn hình giao diện.",
      productAndDesignEvaluation:
        "+ Bổ sung đầy đủ các trang hồ sơ cầu thủ Haaland, Harry Kane, Modric.\n+ Kết nối chuyển đổi màn hình mượt mà.",
      technicalApplicationEvaluation:
        "+ Bổ sung kiểm tra nhập liệu bằng QMessageBox ở các màn hình phụ.",
      presentationEvaluation: "+ Trình bày thử to rõ, nêu được ý tưởng chính của sản phẩm.",
    };
    const res13 = await SpckCommentGenerator.generateBatchSpckComments(
      { classId: ptaClassId, sessionNumber: 13 },
      [
        {
          studentId: stuId,
          fullName,
          projectTitle: "Ứng dụng quản lý thông tin bóng đá (PyQt6) - Buổi 13",
          localFolderPath: stuDir,
          attachments: [path.join(stuDir, "main.py")],
          quickTags: [
            "✅ Đã hoàn thiện luồng chính",
            "🗣️ Trình bày tự tin, to rõ, mạch lạc",
          ],
          teacherNote: "Tiến bộ rõ rệt so với buổi trước.",
          includePresentation: true,
        },
      ]
    );
    const c13 = res13[0].formattedTeacherComment;
    assert.strictEqual(res13[0].hasPriorSession12Evidence, true);
    assert.ok(c13.startsWith("Bùi Tú An — Dự án: Ứng dụng quản lý thông tin bóng đá (PyQt6).\n"));
    assert.ok(c13.includes("\n\n[ĐÃ LÀM ĐƯỢC]\n+ "));
    assert.ok(c13.includes("\n\n[CẦN HOÀN THIỆN TIẾP]\n+ "));
    assert.ok(c13.includes("\n\n[THUYẾT TRÌNH THỬ]\n+ Trình bày thử to rõ"));
    assert.ok(!/Buổi 12|Buổi 13|\*\*/i.test(c13));
    console.log("  -> PASS [V366-01].");

    // =========================================================================
    // V366-02: Bố cục Buổi 14 đồng bộ + ẩn/hiện thuyết trình + liên thông Thư từ MindX
    // =========================================================================
    console.log("\n[V366-02] Kiểm tra bố cục Buổi 14 ([THUYẾT TRÌNH & SLIDE] / [ĐIỂM NỔI BẬT...] / [ĐIỂM CẦN HOÀN THIỆN THÊM])...");
    session14EvalRepo.saveDraft({
      classId: ptaClassId,
      studentId: stuId,
      demoRawTotalScore: 4.75,
      demoScores: {
        algorithm: 1.5,
        creativity: 0.9,
        communication: 0.5,
        problemSolving: 0.9,
        computerSkills: 0.95,
      },
      competencyScores: {
        knowledgeSelfStudy: 5,
        knowledgeInClass: 5,
        skillCommunication: 5,
        skillComputerUse: 4,
        skillProblemSolving: 5,
        skillCreativity: 5,
        skillComputational: 4,
        attitudeHomework: 5,
        attitudeInClass: 5,
      },
    });

    mockPayload = {
      attitudeSummary:
        "Em đã hoàn thiện tốt dự án cuối khóa và đạt Giải Nhất trong buổi bảo vệ Buổi 14 (GĐ2).",
      presentationEvaluation:
        "+ Slide giới thiệu có bố cục rõ ràng, hình ảnh trực quan.\n+ Thầy/cô khuyến khích em tìm hiểu sâu hơn nguyên lý hoạt động của từng màn hình.",
      productAndDesignEvaluation:
        "+ Thiết kế trọn vẹn 12 màn hình giao diện trên Qt Designer với phối màu xanh thể thao đồng bộ.\n+ Vận dụng vững OOP và Signal/Slot kết nối mượt mà.",
      technicalApplicationEvaluation:
        "+ Căn chỉnh lại kích thước chữ và nút bấm trên màn hình phụ cho cân đối hơn.",
    };
    const res14Pres = await SpckCommentGenerator.generateBatchSpckComments(
      { classId: ptaClassId, sessionNumber: 14 },
      [
        {
          studentId: stuId,
          fullName,
          projectTitle: "Ứng dụng quản lý thông tin bóng đá (PyQt6)",
          localFolderPath: stuDir,
          attachments: [path.join(stuDir, "main.py")],
          quickTags: [
            "🗣️ Trình bày tự tin, to rõ, mạch lạc",
            "🏆 Vận dụng vững OOP và giao diện PyQt6",
          ],
          teacherNote: "",
          includePresentation: true,
        },
      ]
    );
    const c14 = res14Pres[0].formattedTeacherComment;
    assert.ok(c14.startsWith("Bùi Tú An — Dự án: Ứng dụng quản lý thông tin bóng đá (PyQt6).\n"));
    const idxPres = c14.indexOf("\n\n[THUYẾT TRÌNH & SLIDE]\n+ ");
    const idxHigh = c14.indexOf("\n\n[ĐIỂM NỔI BẬT CỦA SẢN PHẨM]\n+ ");
    const idxImp = c14.indexOf("\n\n[ĐIỂM CẦN HOÀN THIỆN THÊM]\n+ ");
    assert.ok(idxPres > 0 && idxHigh > idxPres && idxImp > idxHigh, `Thứ tự khối Buổi 14 sai: ${c14}`);
    assert.ok(c14.includes("Giáo viên khuyến khích em"), "Buổi 14 phải tự chuẩn hóa 'Thầy/cô' -> 'Giáo viên'");
    assert.ok(!/Buổi 14|GĐ2|Giai đoạn 2|thầy\/cô|\*\*/i.test(c14), `Bị sót từ cấm ở Buổi 14: ${c14}`);

    // Without presentation evidence: omit [THUYẾT TRÌNH & SLIDE]
    const res14NoPres = await SpckCommentGenerator.generateBatchSpckComments(
      { classId: ptaClassId, sessionNumber: 14 },
      [
        {
          studentId: stuId,
          fullName,
          projectTitle: "Ứng dụng quản lý thông tin bóng đá (PyQt6)",
          localFolderPath: stuDir,
          attachments: [path.join(stuDir, "main.py")],
          quickTags: ["🏆 Hoàn thành tốt các màn hình giao diện PyQt6"],
          teacherNote: "",
          includePresentation: false,
        },
      ]
    );
    const c14NoPres = res14NoPres[0].formattedTeacherComment;
    assert.ok(!c14NoPres.includes("[THUYẾT TRÌNH & SLIDE]"));
    assert.ok(c14NoPres.includes("\n\n[ĐIỂM NỔI BẬT CỦA SẢN PHẨM]\n+ "));
    assert.ok(c14NoPres.includes("\n\n[ĐIỂM CẦN HOÀN THIỆN THÊM]\n+ "));

    // Verify Session14CourseSummaryGenerator consumes structured s14 teacherComment with 0 PII leak
    // First re-save c14 with presentation as Session 14 draft
    spckSessionRepo.saveSessionDraft({
      classId: ptaClassId,
      studentId: stuId,
      sessionNumber: 14,
      teacherComment: c14,
      quickTagsJson: JSON.stringify(["🗣️ Trình bày tự tin, to rõ, mạch lạc"]),
      draftStatus: "WAITING_APPROVAL",
    });
    let capturedLetterPrompt = "";
    GoogleGenerativeAI.prototype.getGenerativeModel = function () {
      return {
        generateContent: async (promptText: string) => {
          capturedLetterPrompt = String(promptText);
          return {
            response: {
              text: () =>
                JSON.stringify({
                  knowledgeParagraph1: "Trong suốt khóa học, giáo viên đánh giá cao STUDENT_SHORT_01.",
                  knowledgeParagraph2: "Em cần rèn luyện kỹ năng tự kiểm thử mã nguồn.",
                  knowledgeParagraph3: "Đối với dự án cuối khóa, STUDENT_SHORT_01 hoàn thiện đầy đủ chức năng.",
                  softSkillsParagraph1: "STUDENT_SHORT_01 hợp tác tích cực trên lớp.",
                  softSkillsParagraph2: "Trong phần thuyết trình, slide rõ ràng và tự tin.",
                  personalParagraph1: "STUDENT_SHORT_01 đạt thành tích nổi bật trong lớp.",
                  personalParagraph2: "Giáo viên khuyến khích STUDENT_SHORT_01 phát huy tốt ở chặng tiếp theo.",
                  suggestionsFromMindx: "Em nên duy trì thói quen kiểm thử kỹ từng trường hợp biên.",
                  futureDirection: "Giáo viên khuyến khích STUDENT_SHORT_01 tiếp tục theo học khóa PTI.",
                }),
            },
          };
        },
      } as any;
    };
    const letterRes = await Session14CourseSummaryGenerator.generateBatch(ptaClassId, [
      { studentId: stuId, fullName },
    ]);
    assert.strictEqual(letterRes.length, 1);
    assert.strictEqual(letterRes[0].status, "SUCCESS");
    assert.ok(
      !capturedLetterPrompt.includes("Bùi Tú An") && !capturedLetterPrompt.includes("Tú An"),
      "Prompt Thư từ MindX phải ẩn danh 100% tên học sinh kể cả khi đọc nhận xét SPCK định dạng mới"
    );
    assert.ok(letterRes[0].learnedFromMindx.includes("Về kiến thức chuyên môn:"));
    assert.ok(letterRes[0].learnedFromMindx.includes("Điểm Demo: 4.75 điểm"));
    console.log("  -> PASS [V366-02].");

    // =========================================================================
    // V366-03: Hậu kiểm từng dòng '+' trên lớp Web & INSUFFICIENT_INFO giữ nguyên
    // =========================================================================
    console.log("\n[V366-03] Kiểm tra hậu kiểm Web từng dòng '+' và giữ nguyên INSUFFICIENT_INFO...");
    const jsbClassId = "VT-C4K-JSB16";
    const jsbStuDir = path.join(webClassDir, "Phạm Gia Bảo");
    fs.mkdirSync(jsbStuDir, { recursive: true });
    fs.writeFileSync(
      path.join(jsbStuDir, "index.html"),
      `<!DOCTYPE html><html><body><nav><a href="#menu">Thực đơn</a></nav><main><h1>Tiệm Bánh Ngọt</h1></main></body></html>`,
      "utf8"
    );
    fs.writeFileSync(
      path.join(jsbStuDir, "style.css"),
      `body { font-family: Arial; }`,
      "utf8"
    );
    studentRepo.upsert({
      studentId: "STU_BAO",
      classId: jsbClassId,
      fullName: "Phạm Gia Bảo",
      isActive: 1,
    });
    spckUploadRepo.upsert({
      classId: jsbClassId,
      studentId: "STU_BAO",
      isConfirmedByTeacher: 1,
      projectTitle: "Website Tiệm Bánh Ngọt",
      localFolderPath: jsbStuDir,
      attachmentsJson: JSON.stringify([
        path.join(jsbStuDir, "index.html"),
        path.join(jsbStuDir, "style.css"),
      ]),
      screenshotsJson: "[]",
      youtubeUrlsJson: "[]",
      relatedLinksJson: "[]",
      status: "DRAFT",
    });

    mockPayload = {
      attitudeSummary:
        "Ở đợt kiểm tra tiến độ này, sản phẩm đã hoàn thành phần khung trang chủ và thanh điều hướng.",
      productAndDesignEvaluation:
        "+ Xây dựng phần trang chủ HTML5/CSS3 với thanh điều hướng Thực đơn rõ ràng.\n+ Tích hợp Bootstrap 5, giỏ hàng shopping cart, LocalStorage và Firebase Authentication mượt mà.",
      technicalApplicationEvaluation:
        "+ Bổ sung thêm các trang sản phẩm chi tiết cho từng loại bánh.\n+ Sử dụng Fetch API tải dữ liệu động từ máy chủ ở bước tiếp theo.",
      presentationEvaluation: "",
    };
    GoogleGenerativeAI.prototype.getGenerativeModel = function () {
      return {
        generateContent: async () => ({
          response: {
            text: () => JSON.stringify(mockPayload),
          },
        }),
      } as any;
    };

    const webRes = await SpckCommentGenerator.generateBatchSpckComments(
      { classId: jsbClassId, sessionNumber: 12 },
      [
        {
          studentId: "STU_BAO",
          fullName: "Phạm Gia Bảo",
          projectTitle: "Website Tiệm Bánh Ngọt",
          localFolderPath: jsbStuDir,
          attachments: [
            path.join(jsbStuDir, "index.html"),
            path.join(jsbStuDir, "style.css"),
          ],
          quickTags: ["✅ Đã dựng xong khung giao diện các trang chính và thanh điều hướng"],
          teacherNote: "",
          includePresentation: false,
        },
      ]
    );
    const webComment = webRes[0].formattedTeacherComment;
    assert.ok(webComment.includes("+ Xây dựng phần trang chủ HTML5/CSS3 với thanh điều hướng Thực đơn rõ ràng."));
    assert.ok(webComment.includes("+ Bổ sung thêm các trang sản phẩm chi tiết cho từng loại bánh."));
    assert.ok(
      !/Bootstrap|giỏ hàng|shopping cart|LocalStorage|Firebase|Fetch API/i.test(webComment),
      `Hậu kiểm phải xóa sạch đúng những dòng '+' bịa đặt: ${webComment}`
    );

    // Check INSUFFICIENT_INFO preserves structured comment verbatim
    const insRes = await SpckCommentGenerator.generateBatchSpckComments(
      { classId: jsbClassId, sessionNumber: 12 },
      [
        {
          studentId: "STU_BAO",
          fullName: "Phạm Gia Bảo",
          quickTags: [],
          teacherNote: "",
        },
      ]
    );
    assert.strictEqual(insRes[0].status, "INSUFFICIENT_INFO");
    assert.strictEqual(insRes[0].formattedTeacherComment, webComment);
    assert.strictEqual(insRes[0].preservedExistingComment, true);
    console.log("  -> PASS [V366-03].");

    // =========================================================================
    // V366-04: Giao diện StudentRow (whitespace-pre-line + rows={9}), chuẩn hóa xưng hô Unicode & version 3.6.6
    // =========================================================================
    console.log("\n[V366-04] Kiểm tra UI StudentRow (2 dòng mở đầu + rows={9}), Unicode 'Thầy/cô' & version 3.6.6...");
    const repoRoot = process.cwd();
    const studentRowSrc = fs.readFileSync(
      path.join(repoRoot, "src", "components", "final-project", "StudentRow.tsx"),
      "utf8"
    );
    assert.ok(
      studentRowSrc.includes("spck-clean-comment-preview") &&
        studentRowSrc.includes("line-clamp-2 leading-snug whitespace-pre-line"),
      "StudentRow preview phải bật whitespace-pre-line để xuống 2 dòng mở đầu rõ ràng"
    );
    assert.ok(
      /<textarea[\s\S]*?rows=\{9\}/.test(studentRowSrc),
      "Khung textarea bình luận SPCK trong StudentRow phải mở rộng lên rows={9}"
    );

    const pkgJson = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
    );
    const layoutSrc = fs.readFileSync(
      path.join(repoRoot, "src", "app", "layout.tsx"),
      "utf8"
    );
    const navbarSrc = fs.readFileSync(
      path.join(repoRoot, "src", "components", "top-navbar.tsx"),
      "utf8"
    );
    assert.strictEqual(pkgJson.version, "3.6.6");
    assert.ok(layoutSrc.includes("(v3.6.6)"));
    assert.ok(navbarSrc.includes("MindX Bot v3.6.6"));

    assert.strictEqual(
      normalizeTeacherSelfReferenceToGiaoVien(
        "Thầy/cô khuyến khích em và thầy cô ghi nhận nỗ lực."
      ),
      "Giáo viên khuyến khích em và giáo viên ghi nhận nỗ lực."
    );
    console.log("  -> PASS [V366-04].");

    // =========================================================================
    // V366-05: Hồi quy toàn bộ 6 phát hiện Neon High Round 1 (V366-F01 -> V366-F06)
    // =========================================================================
    console.log("\n[V366-05] Kiểm tra hồi quy F01..F06 (Markdown '**', 'lưới/lười', ngoặc rỗng, 'Thầy/cô/cô bé', tên có dấu & viết hoa Dòng 2)...");
    // F01: Bold Markdown prefix & inline multi-bullet splitting (F06)
    const boldExtracted = extractRawBulletItems(
      "**Thiết kế trang chủ:** Bố cục Quán Cà Phê rõ ràng.\n**Tính năng:** Xử lý sự kiện mượt."
    );
    assert.deepStrictEqual(boldExtracted, [
      "Thiết kế trang chủ: Bố cục Quán Cà Phê rõ ràng.",
      "Tính năng: Xử lý sự kiện mượt.",
    ]);
    assert.ok(!formatSpckBulletSection("[ĐIỂM NỔI BẬT CỦA SẢN PHẨM]", boldExtracted).includes("**"));
    assert.deepStrictEqual(
      extractRawBulletItems("+ Dựng trang chủ. + Kết nối CSS."),
      ["Dựng trang chủ.", "Kết nối CSS."]
    );

    // F02: "lưới" (CSS Grid) vs "lười"
    assert.strictEqual(
      detectExplicitAttitudeNote([], "Cần căn chỉnh lại bố cục dạng lưới (CSS Grid) cho đều hơn."),
      false,
      "Từ kỹ thuật 'lưới' không được nhận nhầm thành 'lười'"
    );
    assert.strictEqual(
      detectExplicitAttitudeNote([], "Con còn hơi lười làm bài tập ở nhà."),
      true,
      "Từ 'lười' phải kích hoạt chế độ cho phép nhận xét thái độ"
    );

    // F03: Parenthesized suffixes should not leave empty () or ( - )
    assert.strictEqual(
      resolveCleanSpckHeaderTopic({
        rawProjectTitle: "Website Quán Cà Phê (Buổi 14)",
        fullName: "Lê Minh Tú",
        productNoun: "Website",
      }),
      "Website Quán Cà Phê"
    );
    assert.strictEqual(
      resolveCleanSpckHeaderTopic({
        rawProjectTitle: "Dự án: Website Tiệm Bánh (Buổi 12 - GĐ1)",
        fullName: "Lê Minh Tú",
        productNoun: "Website",
      }),
      "Website Tiệm Bánh"
    );

    // F04: COMPOUND_AFTER_THAY_CO_REGEX must preserve "cô bé", "cô chủ", "thầy đồ", "nhận thấy"
    assert.strictEqual(
      normalizeTeacherSelfReferenceToGiaoVien(
        "Nhân vật cô bé và cô chủ trong game gặp thầy đồ rất sinh động, giáo viên nhận thấy em tiến bộ."
      ),
      "Nhân vật cô bé và cô chủ trong game gặp thầy đồ rất sinh động, giáo viên nhận thấy em tiến bộ."
    );

    // F04 + E2E Session 14: standalone "Thầy"/"Cô" -> "Giáo viên", clean (Buổi 14) title, zero **
    mockPayload = {
      attitudeSummary: "Thầy đánh giá cao dự án cuối khóa của STUDENT_01.",
      productAndDesignEvaluation: "**Thiết kế giao diện:** Bố cục rõ ràng, trực quan.",
      technicalApplicationEvaluation: "+ Tiếp tục tối ưu hiệu năng khi chuyển màn hình.",
      presentationEvaluation: "Cô khen ngợi slide trình bày rất rõ ràng.",
    };
    const tuClassId = "VT-C4K-PTA14";
    const tuStuId = "STU_TU_01";
    studentRepo.upsert({
      studentId: tuStuId,
      classId: tuClassId,
      fullName: "Lê Minh Tú",
      isActive: 1,
    });
    const res14F04 = await SpckCommentGenerator.generateBatchSpckComments(
      { classId: tuClassId, sessionNumber: 14 },
      [
        {
          studentId: tuStuId,
          fullName: "Lê Minh Tú",
          projectTitle: "Website Quán Cà Phê (Buổi 14)",
          quickTags: ["🗣️ Trình bày tự tin, to rõ, mạch lạc"],
          teacherNote: "",
          includePresentation: true,
        },
      ]
    );
    const c14F04 = res14F04[0].formattedTeacherComment;
    assert.ok(c14F04.startsWith("Lê Minh Tú — Dự án: Website Quán Cà Phê.\n"), c14F04);
    assert.ok(!c14F04.includes("()"), c14F04);
    assert.ok(!c14F04.includes("**"), c14F04);
    assert.ok(!/(?<![\p{L}\p{N}_])(?:Thầy|Cô)(?![\p{L}\p{N}_])/u.test(c14F04), c14F04);
    assert.ok(c14F04.includes("Giáo viên đánh giá cao") && c14F04.includes("Giáo viên khen ngợi"), c14F04);

    // F05: Non-ASCII ending name ("Lê Minh Tú"), pronoun ("Con"), "chăm chỉ", "hăng hái/siêng năng"
    const s1Tu = stripGenericAttitudeClichéForStage1(
      "Lê Minh Tú đã thể hiện tinh thần học tập tập trung, nghiêm túc, chăm chỉ và hoàn thiện 12 màn hình PyQt6.",
      "Lê Minh Tú",
      "Lê Minh Tú",
      false,
      false
    );
    assert.ok(s1Tu.includes("12 màn hình PyQt6") && !/tập trung|nghiêm túc|chăm chỉ/i.test(s1Tu), s1Tu);

    const s1Con = stripGenericAttitudeClichéForStage1(
      "Con đã thể hiện tinh thần học tập rất tích cực để xây dựng trang chủ.",
      "Lê Minh Tú",
      "Lê Minh Tú",
      false,
      false
    );
    assert.ok(s1Con.includes("xây dựng trang chủ") && !/tích cực|tinh thần/i.test(s1Con), s1Con);

    const s1Sieng = stripGenericAttitudeClichéForStage1(
      "Lê Minh Tú học tập rất hăng hái và siêng năng.",
      "Lê Minh Tú",
      "Lê Minh Tú",
      false,
      false
    );
    assert.ok(!/hăng hái|siêng năng/i.test(s1Sieng), s1Sieng);

    // F06: Session 13 without prior Session 12 comparison keeps uppercase Line 2 start
    mockPayload = {
      attitudeSummary:
        "So với buổi 12, sản phẩm đã bổ sung thêm trang menu đồ uống và bố cục rõ ràng hơn.",
      productAndDesignEvaluation: "+ Hoàn thiện trang chủ với bố cục dạng lưới cân đối.",
      technicalApplicationEvaluation: "+ Bổ sung thêm các trang con cho thực đơn.",
      presentationEvaluation: "",
    };
    const res13F06 = await SpckCommentGenerator.generateBatchSpckComments(
      { classId: jsbClassId, sessionNumber: 13 },
      [
        {
          studentId: "STU_BAO",
          fullName: "Phạm Gia Bảo",
          projectTitle: "Website Tiệm Bánh (Buổi 12 - GĐ1)",
          localFolderPath: jsbStuDir,
          attachments: [
            path.join(jsbStuDir, "index.html"),
            path.join(jsbStuDir, "style.css"),
          ],
          quickTags: ["✅ Đã hoàn thiện luồng chính"],
          teacherNote: "Cần căn chỉnh lại bố cục dạng lưới (CSS Grid) cho đều hơn.",
          includePresentation: false,
        },
      ]
    );
    const line2F06 = res13F06[0].formattedTeacherComment.split("\n")[1] || "";
    assert.ok(
      /^\p{Lu}/u.test(line2F06) && res13F06[0].formattedTeacherComment.startsWith("Phạm Gia Bảo — Dự án: Website Tiệm Bánh.\n"),
      `Dòng 2 sau khi cắt so sánh B12 giả phải viết hoa chữ cái đầu: '${line2F06}'`
    );
    console.log("  -> PASS [V366-05].");

    console.log("\n✅ TẤT CẢ 5/5 NHÓM KIỂM THỬ v3.6.6 ĐỀU PASS 100%!");
  } finally {
    GoogleGenerativeAI.prototype.getGenerativeModel = origGetModel;
    try {
      getDb().close();
    } catch {
      // ignore
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("❌ TEST FAILED:", err);
  process.exitCode = 1;
});
