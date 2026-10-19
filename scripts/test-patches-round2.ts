import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { isLocalRequest } from "../src/lib/security/local-guard";
import { isPathAllowed, assertPathAllowed } from "../src/lib/security/path-allowlist";
import {
  homeworkSubmissionRepo,
  sessionFeedbackRepo,
  calculateSha256,
  verifyContentIntegrity,
  getDb
} from "../src/lib/db/sqlite";

async function runTests() {
  console.log("=== BẮT ĐẦU KIỂM THỬ HARDENING ROUND 2 ===");

  // 1. Kiểm tra Origin & Host Security trong local-guard
  console.log("Test 1: Kiểm tra Origin & Host Security...");
  {
    // Port 9999 must be REJECTED
    const reqForeignPort = new Request("http://127.0.0.1:3000/api/queue/control", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:9999",
      },
    });
    assert.strictEqual(isLocalRequest(reqForeignPort), false, "Chặn Origin port 9999");

    // Same host + port must be ACCEPTED
    const reqValidLocal = new Request("http://127.0.0.1:3000/api/queue/control", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
      },
    });
    assert.strictEqual(isLocalRequest(reqValidLocal), true, "Chấp nhận Origin port 3000");

    // Localhost port 3000 must be ACCEPTED
    const reqValidLocalhost = new Request("http://localhost:3000/api/queue/control", {
      method: "POST",
      headers: {
        host: "localhost:3000",
        origin: "http://localhost:3000",
      },
    });
    assert.strictEqual(isLocalRequest(reqValidLocalhost), true, "Chấp nhận Origin localhost:3000");

    // Sec-Fetch-Site: cross-site must be REJECTED
    const reqCrossSite = new Request("http://127.0.0.1:3000/api/queue/control", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        "sec-fetch-site": "cross-site",
      },
    });
    assert.strictEqual(isLocalRequest(reqCrossSite), false, "Chặn sec-fetch-site cross-site");
    console.log("✅ Test 1 Passed: local-guard chặn triệt để cross-port và cross-site!");
  }

  // 2. Kiểm tra Path Allowlist cho file chưa tồn tại
  console.log("Test 2: Kiểm tra Path Allowlist với file chưa tồn tại...");
  {
    // File chưa tồn tại nằm trong workspace hiện tại: phải được duyệt
    const nonExistentInside = path.join(process.cwd(), "temp_submissions", "class_test", "lesson_test", "sub_123.py");
    assert.strictEqual(isPathAllowed(nonExistentInside), true, "Cho phép file chưa tồn tại trong allowed dir");

    // File chưa tồn tại nằm ngoài allowlist: phải bị chặn
    const nonExistentOutside = "C:\\Windows\\System32\\malicious_fake_file_xyz.exe";
    assert.strictEqual(isPathAllowed(nonExistentOutside), false, "Chặn file chưa tồn tại ngoài allowlist");
    console.log("✅ Test 2 Passed: path-allowlist phân giải realpath đúng kể cả file chưa tồn tại!");
  }

  // 3. Kiểm tra bảo vệ liên kết 3 định danh: submissionId -> studentId, classId, sessionId
  console.log("Test 3: Kiểm tra SQLite ID tuple integrity...");
  {
    const subId = "SUB_TEST_LOCK_" + Date.now();
    // Tạo bản ghi ban đầu
    homeworkSubmissionRepo.upsert({
      classId: "CLASS_01",
      sessionId: "SESS_01",
      studentId: "STUDENT_01",
      submissionId: subId,
      parseStatus: "PARSED",
      status: "PENDING",
      decision: "GRADE",
    });

    // Thử đổi studentId: BẮT BUỘC THROW
    let studentChangeBlocked = false;
    try {
      homeworkSubmissionRepo.upsert({
        classId: "CLASS_01",
        sessionId: "SESS_01",
        studentId: "STUDENT_02",
        submissionId: subId,
        parseStatus: "PARSED",
        status: "PENDING",
        decision: "GRADE",
      });
    } catch (err: any) {
      if (err.message.includes("[Integrity Violation]")) {
        studentChangeBlocked = true;
      }
    }
    assert.strictEqual(studentChangeBlocked, true, "Bắt buộc chặn đổi studentId");

    // Thử đổi classId: BẮT BUỘC THROW
    let classChangeBlocked = false;
    try {
      homeworkSubmissionRepo.upsert({
        classId: "CLASS_02",
        sessionId: "SESS_01",
        studentId: "STUDENT_01",
        submissionId: subId,
        parseStatus: "PARSED",
        status: "PENDING",
        decision: "GRADE",
      });
    } catch (err: any) {
      if (err.message.includes("[Integrity Violation]")) {
        classChangeBlocked = true;
      }
    }
    assert.strictEqual(classChangeBlocked, true, "Bắt buộc chặn đổi classId");

    // Thử đổi sessionId: BẮT BUỘC THROW
    let sessionChangeBlocked = false;
    try {
      homeworkSubmissionRepo.upsert({
        classId: "CLASS_01",
        sessionId: "SESS_02",
        studentId: "STUDENT_01",
        submissionId: subId,
        parseStatus: "PARSED",
        status: "PENDING",
        decision: "GRADE",
      });
    } catch (err: any) {
      if (err.message.includes("[Integrity Violation]")) {
        sessionChangeBlocked = true;
      }
    }
    assert.strictEqual(sessionChangeBlocked, true, "Bắt buộc chặn đổi sessionId");
    console.log("✅ Test 3 Passed: Khóa cứng toàn bộ bộ 3 (submissionId -> studentId + classId + sessionId)!");
  }

  // 4. Kiểm tra tự động hạ cấp DRAFT khi chỉnh sửa nội dung sau khi APPROVED
  console.log("Test 4: Kiểm tra Hash Drift & Auto Demotion...");
  {
    const classId = "CLASS_FEEDBACK_" + Date.now();
    const sessionId = "SESS_FB_01";
    const studentId = "STUDENT_FB_01";
    const approvedText = "Học sinh hiểu bài tốt, lập trình mạch lạc.";
    const approvedHash = calculateSha256(approvedText);

    // Lưu bản ghi APPROVED
    sessionFeedbackRepo.upsert({
      classId,
      sessionId,
      studentId,
      attendanceStatus: "PRESENT",
      finalText: approvedText,
      contentHash: approvedHash,
      status: "APPROVED",
    });

    const saved = sessionFeedbackRepo.findOne(classId, sessionId, studentId);
    assert.strictEqual(saved?.status, "APPROVED");

    // Chỉnh sửa văn bản nhưng cố tình giữ nguyên hash cũ hoặc không duyệt lại
    const editedText = "Học sinh KHÔNG hiểu bài, sửa đổi sau khi duyệt.";
    sessionFeedbackRepo.upsert({
      classId,
      sessionId,
      studentId,
      attendanceStatus: "PRESENT",
      finalText: editedText,
      contentHash: approvedHash, // Hash cũ không khớp
      status: "APPROVED",
    });

    const modified = sessionFeedbackRepo.findOne(classId, sessionId, studentId);
    assert.strictEqual(modified?.status, "DRAFT", "Tự động hạ cấp về DRAFT khi nội dung bị sửa sau khi duyệt!");
    assert.strictEqual(modified?.contentHash, calculateSha256(editedText), "Hash được tính lại đúng cho nội dung mới");
    console.log("✅ Test 4 Passed: Tự động hạ trạng thái về DRAFT khi sửa nhận xét đã duyệt!");
  }

  console.log("\n🎉 TẤT CẢ CÁC BÀI KIỂM THỬ HARDENING ROUND 2 ĐÃ VƯỢT QUA 100%!");
}

runTests().catch((err) => {
  console.error("❌ Test thất bại:", err);
  process.exit(1);
});
