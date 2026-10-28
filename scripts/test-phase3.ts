import assert from "node:assert";
import { CommentGenerator } from "../src/lib/gemini/comment-generator";
import { ZaloBroadcastGenerator } from "../src/lib/zalo/broadcast-generator";
import {
  sessionFeedbackRepo,
  studentRepo,
  classSessionRepo,
  calculateSha256,
  verifyContentIntegrity,
} from "../src/lib/db/sqlite";

async function testPhase3() {
  console.log("==================================================");
  console.log("🚀 KIỂM THỬ GIAI ĐOẠN 3 VỚI LỚP: VT-C4K-GI34");
  console.log("==================================================");

  const testClassCode = "VT-C4K-GI34";
  const testClassId = "VT-C4K-GI34";
  const testSessionId = `${testClassId}_SESS_01`;

  // 1. Kiểm tra lưu dữ liệu Lớp và Học viên mẫu vào SQLite
  console.log("\n[1] Kiểm tra nạp dữ liệu lớp học & học viên vào SQLite...");
  classSessionRepo.upsert({
    classId: testClassId,
    className: testClassCode,
    sessionId: testSessionId,
    sessionNumber: 1,
    topic: "Giới thiệu GameMaker & Cấu trúc Sprite, Object",
    date: "2026-10-19",
  });

  const studentsMock = [
    { studentId: "STU_GI34_01", classId: testClassId, fullName: "Nguyễn Hoàng Long", isActive: 1 },
    { studentId: "STU_GI34_02", classId: testClassId, fullName: "Trần Minh Đức", isActive: 1 },
    { studentId: "STU_GI34_03", classId: testClassId, fullName: "Lê Bảo Châu", isActive: 1 },
  ];

  for (const s of studentsMock) {
    studentRepo.upsert(s);
  }

  const loadedStudents = studentRepo.findByClass(testClassId);
  assert.strictEqual(loadedStudents.length >= 3, true, "Đã lưu học viên vào SQLite");
  console.log(`✅ [1] Đã lưu ${loadedStudents.length} học viên lớp ${testClassCode} vào SQLite.`);

  // 2. Kiểm tra Nguyên tắc Sư phạm & AI Guardrail (Cấm bịa đặt khi không có tag/note)
  console.log("\n[2] Kiểm tra Anti-Hallucination Guardrail (Cấm AI bịa đặt)...");
  const candidatesInput = [
    {
      studentId: "STU_GI34_01",
      fullName: "Nguyễn Hoàng Long",
      attendanceStatus: "PRESENT" as const,
      quickTags: ["Tích cực", "Hiểu bài nhanh", "Sáng tạo"],
      teacherNote: "Lập trình đối tượng di chuyển rất mượt, tự làm thêm hiệu ứng particle.",
    },
    {
      studentId: "STU_GI34_02",
      fullName: "Trần Minh Đức",
      attendanceStatus: "PRESENT" as const,
      quickTags: [], // KHÔNG CÓ TAG
      teacherNote: "", // KHÔNG CÓ NOTE -> BẮT BUỘC INSUFFICIENT_INFO (KHÔNG GỌI AI)
    },
    {
      studentId: "STU_GI34_03",
      fullName: "Lê Bảo Châu",
      attendanceStatus: "PRESENT" as const,
      quickTags: ["Cần tập trung hơn", "Còn chậm"],
      teacherNote: "Còn lúng túng khi gán sprite vào object, cần hỗ trợ thêm.",
    },
  ];

  const sessionContext = {
    classId: testClassId,
    classCode: testClassCode,
    sessionId: testSessionId,
    sessionNumber: 1,
    topic: "Làm quen GameMaker: Sprites, Objects & Events",
    keyKnowledge: ["Sprite & Origin", "Object & Instance", "Event Create & Step"],
  };

  console.log("Đang thực hiện AI batch generation (Ẩn danh hóa STUDENT_01...)...");
  const aiResults = await CommentGenerator.generateBatchComments(sessionContext, candidatesInput);

  console.log(`Kết quả sinh nhận xét (${aiResults.length} học viên):`);
  for (const r of aiResults) {
    console.log(`- [${r.fullName}] Trạng thái: ${r.status}`);
    if (r.status === "INSUFFICIENT_INFO") {
      console.log(`  👉 Lý do: ${r.formattedFullComment}`);
    } else {
      console.log(`  🌟 Điểm mạnh: ${r.strengths.slice(0, 60)}...`);
      console.log(`  ⚠️ Cần cải thiện: ${r.improvements.slice(0, 60)}...`);
      console.log(`  🎯 Hướng rèn luyện: ${r.actionPlan.slice(0, 60)}...`);
      console.log(`  📝 Toàn văn: ${r.formattedFullComment.slice(0, 90)}...`);
    }
  }

  // Kiểm tra học sinh 2 bắt buộc là INSUFFICIENT_INFO
  const student2Result = aiResults.find((r) => r.studentId === "STU_GI34_02");
  assert.strictEqual(
    student2Result?.status,
    "INSUFFICIENT_INFO",
    "Học sinh không có tag và note phải trả về INSUFFICIENT_INFO"
  );
  console.log("✅ [2] Anti-Hallucination Guardrail ĐẠT: Không tự bịa thông tin cho học sinh thiếu dữ liệu.");

  // Kiểm tra học sinh 1 được sinh đúng văn phong và đã giải ẩn danh (có tên thật trong nhận xét)
  const student1Result = aiResults.find((r) => r.studentId === "STU_GI34_01");
  assert.strictEqual(student1Result?.status, "DRAFT");
  assert.strictEqual(
    !student1Result?.formattedFullComment.includes("STUDENT_") && student1Result?.formattedFullComment.includes("- **Điểm mạnh của học viên:**"),
    true,
    "Đã giải ẩn danh thay STUDENT_01 bằng tên thật Nguyễn Hoàng Long"
  );
  console.log("✅ [2] Anonymization & De-anonymization ĐẠT: Thay mã ẩn danh bằng tên học sinh thật.");

  // 3. Kiểm tra Duyệt và Mã băm Toàn vẹn (Content Hash SHA-256)
  console.log("\n[3] Kiểm tra Quy trình Duyệt & Khóa Hash SHA-256...");
  const approvedText = student1Result?.formattedFullComment || "";
  const calculatedHash = calculateSha256(approvedText);

  sessionFeedbackRepo.upsert({
    classId: testClassId,
    sessionId: testSessionId,
    studentId: "STU_GI34_01",
    finalText: approvedText,
    contentHash: calculatedHash,
    status: "APPROVED",
  });

  const approvedRecord = sessionFeedbackRepo.findOne(testClassId, testSessionId, "STU_GI34_01");
  assert.strictEqual(approvedRecord?.status, "APPROVED");
  assert.strictEqual(verifyContentIntegrity(approvedText, approvedRecord?.contentHash), true);
  console.log("✅ [3] Khóa mã băm SHA-256 ĐẠT khi giáo viên duyệt.");

  // 4. Kiểm tra Tự động Hạ cấp về DRAFT khi nội dung bị sửa sau khi Duyệt (Iron Rule 4)
  console.log("\n[4] Kiểm tra Hash Drift & Auto-Demotion (Sửa chữ bắt buộc duyệt lại)...");
  const tamperedText = approvedText + " [Đã sửa đổi thêm một câu nhưng không duyệt lại]";
  sessionFeedbackRepo.upsert({
    classId: testClassId,
    sessionId: testSessionId,
    studentId: "STU_GI34_01",
    finalText: tamperedText,
    contentHash: calculatedHash, // Cố tình giữ hash cũ
    status: "APPROVED",
  });

  const tamperedRecord = sessionFeedbackRepo.findOne(testClassId, testSessionId, "STU_GI34_01");
  assert.strictEqual(
    tamperedRecord?.status,
    "DRAFT",
    "Khi sửa chữ mà không có hash mới, hệ thống tự động hạ trạng thái về DRAFT"
  );
  console.log("✅ [4] Tự động hạ trạng thái về DRAFT khi sửa nhận xét đã duyệt ĐẠT 100%.");

  // 5. Kiểm tra Zalo Broadcast Generator cho lớp VT-C4K-GI34
  console.log("\n[5] Kiểm tra Bộ tạo Thông báo Zalo cho lớp VT-C4K-GI34...");
  const zaloResult = ZaloBroadcastGenerator.generate({
    classCode: testClassCode,
    sessionNumber: 1,
    topicOverride: "Làm quen GameMaker: Sprites, Objects & Events",
    keyKnowledgeOverride: [
      "Khái niệm Sprite, Object và Instance trong GameMaker",
      "Gán Sprite cho Object và xử lý sự kiện di chuyển",
      "Quản lý Room và bố cục trò chơi",
    ],
    homeworkBriefOverride: "Lập trình cho nhân vật di chuyển 4 hướng và hoàn thành bài tập trên LMS.",
    teacherName: "Thầy Giáo MindX",
  });

  console.log("--- BẢN XEM TRƯỚC TIN NHẮN ZALO ---");
  console.log(zaloResult.renderedText);
  console.log("-----------------------------------");

  assert.strictEqual(zaloResult.renderedText.includes(testClassCode), true);
  assert.strictEqual(zaloResult.renderedText.includes("buổi học số 1"), true);
  assert.strictEqual(zaloResult.renderedText.toUpperCase().includes("LÀM QUEN GAMEMAKER"), true);
  console.log("✅ [5] Bộ tạo Thông báo Zalo Broadcast ĐẠT chuẩn format.");

  console.log("\n🎉 HOÀN TẤT KIỂM THỬ TOÀN DIỆN GIAI ĐOẠN 3 CHO LỚP VT-C4K-GI34!");
}

testPhase3().catch((err) => {
  console.error("❌ Kiểm thử thất bại:", err);
  process.exit(1);
});
