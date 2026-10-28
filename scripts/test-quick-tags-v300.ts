import assert from "node:assert";
import { GET as getSessionCommentsList } from "../src/app/api/session-comments/list/route";
import { GET as getSpckList } from "../src/app/api/spck/list/route";
import { getCoursesSyllabus, getQuickTags } from "../src/lib/db/json-config";
import { getDb, sessionFeedbackRepo } from "../src/lib/db/sqlite";
import {
  classifyQuickTagTrack,
  classifyStudentSkillLevel,
  detectTrackByClassCode,
  filterRegularSessionQuickTagCategories,
  isCheckpointSession,
  isSession14QuickTagCategory,
  normalizeQuickTagsForTrack,
} from "../src/lib/quick-tags";

async function runQuickTagsV300Tests() {
  console.log("=== BẮT ĐẦU KIỂM THỬ QUICK TAGS & PHÂN LOẠI BUỔI HỌC (v3.0.0) ===");

  // 1. Verify quick_tags.json structure
  const categories = getQuickTags();
  const codingCat = categories.find((c) => c.category === "regular_coding");
  const roboticsCat = categories.find((c) => c.category === "regular_robotics");
  const s14PresCat = categories.find((c) => c.category === "spck_session14_presentation");
  const s14ProdCat = categories.find((c) => c.category === "spck_session14_product");

  assert.ok(codingCat, "Phải có nhóm regular_coding trong quick_tags.json");
  assert.strictEqual(codingCat.tags.length, 7, "Nhóm Lập trình phải có đúng 7 thẻ ngắn gọn");
  assert.ok(roboticsCat, "Phải có nhóm regular_robotics trong quick_tags.json");
  assert.strictEqual(roboticsCat.tags.length, 6, "Nhóm Robotics phải có đúng 6 thẻ ngắn gọn");
  assert.ok(s14PresCat && s14ProdCat, "Phải giữ đủ 2 nhóm thẻ Buổi 14 SPCK");

  // 2. Verify GET /api/session-comments/list never leaks Session 14 tags
  const listReq = new Request("http://127.0.0.1:3000/api/session-comments/list?classId=VT-C4K-PTA12", {
    method: "GET",
    headers: { host: "127.0.0.1:3000" },
  });
  const listRes = await getSessionCommentsList(listReq);
  assert.strictEqual(listRes.status, 200);
  const listJson = await listRes.json();
  assert.strictEqual(listJson.success, true);
  const returnedTags: any[] = listJson.data?.quickTags || [];
  assert.strictEqual(returnedTags.length, 13, "Màn hình 1 chỉ nhận đúng 13 thẻ (7 Lập trình + 6 Robotics)");
  const leakedS14 = returnedTags.filter((t) => isSession14QuickTagCategory(t));
  assert.strictEqual(leakedS14.length, 0, "Tuyệt đối không được rò rỉ thẻ Buổi 14 sang Màn hình 1");

  // 3. Verify GET /api/spck/list includes quickTags for Screen 3
  const spckReq = new Request("http://127.0.0.1:3000/api/spck/list", {
    method: "GET",
    headers: { host: "127.0.0.1:3000" },
  });
  const spckRes = await getSpckList(spckReq);
  assert.strictEqual(spckRes.status, 200);
  const spckJson = await spckRes.json();
  assert.ok(Array.isArray(spckJson.quickTags), "GET /api/spck/list phải trả về quickTags");
  assert.strictEqual(
    spckJson.quickTags.filter((c: any) => isSession14QuickTagCategory(c)).length,
    2,
    "GET /api/spck/list phải có đủ 2 nhóm thẻ Buổi 14"
  );

  // 4. Verify 5-level classification for both new tags and legacy tags
  const regCats = filterRegularSessionQuickTagCategories(categories);
  assert.strictEqual(
    classifyStudentSkillLevel(["💡 Vận dụng & Sáng tạo tốt", "✅ Tiếp thu tốt"], regCats).levelCode,
    1,
    "Thẻ Vận dụng & Sáng tạo tốt -> Cấp độ 1 (Giỏi)"
  );
  assert.strictEqual(
    classifyStudentSkillLevel(["✅ Tiếp thu tốt", "📝 Làm bài tập đầy đủ"], regCats).levelCode,
    2,
    "Thẻ Tiếp thu tốt + Làm bài tập đầy đủ -> Cấp độ 2 (Khá)"
  );
  assert.strictEqual(
    classifyStudentSkillLevel(["🤖 Lắp ráp & Lập trình tốt", "👀 Mất tập trung"], regCats).levelCode,
    3,
    "Thẻ tốt + Mất tập trung -> Cấp độ 3 (Khá nhưng mất tập trung)"
  );
  assert.strictEqual(
    classifyStudentSkillLevel(["🐢 Tiếp thu chậm"], regCats).levelCode,
    4,
    "Thẻ Tiếp thu chậm -> Cấp độ 4 (Trung bình)"
  );
  assert.strictEqual(
    classifyStudentSkillLevel(["🔩 Lắp ráp còn chậm / Nhầm chốt", "👀 Mất tập trung"], regCats).levelCode,
    5,
    "Thẻ chậm + Mất tập trung -> Cấp độ 5 (Trung bình, mất tập trung)"
  );
  // Legacy backward compatibility
  assert.strictEqual(
    classifyStudentSkillLevel(["🌟 Xuất sắc & Sáng tạo"], regCats).levelCode,
    1,
    "Tương thích ngược thẻ cũ 🌟 Xuất sắc & Sáng tạo -> Cấp độ 1"
  );
  assert.strictEqual(
    classifyStudentSkillLevel(["🛠️ Cần kèm thêm"], regCats).levelCode,
    4,
    "Tương thích ngược thẻ cũ 🛠️ Cần kèm thêm -> Cấp độ 4"
  );

  // 4b. Regression assertions for Codex CLI Phase 1 findings:
  // Finding 1: "⌨️ Thao tác / Cú pháp còn chậm" (role: "improve") + "✅ Tiếp thu tốt" (role: "good") -> Level 2 (Khá), NOT Level 4!
  assert.strictEqual(
    classifyStudentSkillLevel(["✅ Tiếp thu tốt", "⌨️ Thao tác / Cú pháp còn chậm"], regCats).levelCode,
    2,
    "Thẻ Tiếp thu tốt + Thao tác/Cú pháp còn chậm (role: improve) phải ra Cấp độ 2 (Khá), không bị nhầm sang Cấp độ 4"
  );
  assert.strictEqual(
    classifyStudentSkillLevel(["✅ Tiếp thu tốt", "⌨️ Thao tác / Cú pháp còn chậm"]).levelCode,
    2,
    "Ngay cả khi không truyền categories, regex fallback vẫn phân loại Thao tác/Cú pháp còn chậm là improve -> Cấp độ 2"
  );

  // Finding 2: Mixed excellent + slow + distracted -> Level 5 (consistent between quick-tags and comment-generator)
  assert.strictEqual(
    classifyStudentSkillLevel(
      ["💡 Vận dụng & Sáng tạo tốt", "🐢 Tiếp thu chậm", "👀 Mất tập trung"],
      regCats
    ).levelCode,
    5,
    "Kết hợp thẻ Giỏi + Tiếp thu chậm + Mất tập trung ưu tiên cảnh báo Cấp độ 5"
  );

  // Finding 3: Session 14 tags must be stripped by classifyStudentSkillLevel
  assert.strictEqual(
    classifyStudentSkillLevel(["s14_pres_slide_good", "🎤 Slide thuyết trình rõ ràng, tự tin"], categories)
      .levelCode,
    0,
    "Nếu chỉ truyền thẻ Buổi 14 vào bộ phân loại buổi thường thì phải lọc bỏ hoàn toàn (levelCode = 0)"
  );

  // 5. Verify track & Checkpoint session detection for Coding (5, 9) and Robotics (4, 8)
  const syllabus = getCoursesSyllabus();
  assert.strictEqual(detectTrackByClassCode("VT-C4K-PTA12"), "coding");
  assert.strictEqual(detectTrackByClassCode("VT-ROB-ARMA13"), "robotics");
  assert.strictEqual(detectTrackByClassCode("VT-ROB-SEMIA05"), "robotics");
  assert.strictEqual(detectTrackByClassCode("VT-KIND-ROB4I02"), "robotics");
  assert.strictEqual(detectTrackByClassCode("VT-SEMIB02"), "robotics");

  assert.deepStrictEqual(
    normalizeQuickTagsForTrack(["👍 Đạt yêu cầu", "📝 Làm bài tập đầy đủ"], "coding"),
    ["✅ Tiếp thu tốt", "📝 Làm bài tập đầy đủ"],
    "Chuẩn hóa thẻ cũ sang bộ thẻ Lập trình mới"
  );
  assert.deepStrictEqual(
    normalizeQuickTagsForTrack(["👍 Đạt yêu cầu", "🙋 Hăng hái phát biểu"], "robotics"),
    ["🤖 Lắp ráp & Lập trình tốt", "🙋 Hăng hái phát biểu"],
    "Chuẩn hóa thẻ cũ sang bộ thẻ Robotics mới"
  );

  assert.strictEqual(isCheckpointSession("VT-C4K-PTA12", 5, syllabus), true, "PTA12 Buổi 5 là Checkpoint");
  assert.strictEqual(isCheckpointSession("VT-C4K-PTA12", 9, syllabus), true, "PTA12 Buổi 9 là Checkpoint");
  assert.strictEqual(isCheckpointSession("VT-C4K-PTA12", 4, syllabus), false, "PTA12 Buổi 4 không phải Checkpoint");
  assert.strictEqual(isCheckpointSession("VT-C4K-PTA12", 14, syllabus), false, "Buổi 14 không phải Checkpoint");

  assert.strictEqual(isCheckpointSession("VT-ROB-ARMA13", 4, syllabus), true, "ARMA13 Buổi 4 là Checkpoint");
  assert.strictEqual(isCheckpointSession("VT-ROB-ARMA13", 8, syllabus), true, "ARMA13 Buổi 8 là Checkpoint");
  assert.strictEqual(isCheckpointSession("VT-ROB-ARMA13", 5, syllabus), false, "ARMA13 Buổi 5 không phải Checkpoint");

  assert.strictEqual(classifyQuickTagTrack(codingCat), "coding");
  assert.strictEqual(classifyQuickTagTrack(roboticsCat), "robotics");
  assert.strictEqual(classifyQuickTagTrack(s14PresCat), "session14");

  // 6. Verify previousQuickTagsByStudent inheritance across sessions (v3.1.1)
  // R1-01: Use an isolated synthetic classId and delete only the exact test rows so real class data is never touched
  const testClassId = "TEST_V311_ROB_SEMIA05";
  const sentinelClassId = "VT-ROB-SEMIA05";
  const sentinelSessionId = `${sentinelClassId}_SESS_99_SENTINEL`;
  const sentinelStudentId = "STU_SENTINEL_R101";
  const db = getDb();
  const hadPreExistingSentinel = Boolean(
    sessionFeedbackRepo.findOne(sentinelClassId, sentinelSessionId, sentinelStudentId)
  );
  if (!hadPreExistingSentinel) {
    sessionFeedbackRepo.upsert({
      classId: sentinelClassId,
      sessionId: sentinelSessionId,
      studentId: sentinelStudentId,
      attendanceStatus: "PRESENT",
      quickTagsJson: "[]",
      teacherNote: "Sentinel row must not be deleted",
      strengths: "",
      improvements: "",
      actionPlan: "",
      finalText: "Sentinel content",
      status: "DRAFT",
    });
  }
  try {
    sessionFeedbackRepo.upsert({
      classId: testClassId,
      sessionId: `${testClassId}_SESS_01`,
      studentId: "STU_INHERIT_1",
      attendanceStatus: "PRESENT",
      quickTagsJson: JSON.stringify(["👍 Đạt yêu cầu", "🙋 Hăng hái phát biểu"]),
      teacherNote: "",
      strengths: "",
      improvements: "",
      actionPlan: "",
      finalText: "",
      status: "DRAFT",
      versionMetaJson: JSON.stringify({ rowVer: 1, fields: { quickTags: { ver: 1, cid: "t", rev: 1 } } }),
    });
    sessionFeedbackRepo.upsert({
      classId: testClassId,
      sessionId: `${testClassId}_SESS_01`,
      studentId: "STU_CLEARED_IN_S2",
      attendanceStatus: "PRESENT",
      quickTagsJson: JSON.stringify(["🤖 Lắp ráp & Lập trình tốt"]),
      teacherNote: "",
      strengths: "",
      improvements: "",
      actionPlan: "",
      finalText: "",
      status: "DRAFT",
      versionMetaJson: JSON.stringify({ rowVer: 1, fields: { quickTags: { ver: 1, cid: "t", rev: 1 } } }),
    });
    // SESS_02: STU_INHERIT_1 only has attendance marked (no explicit quickTags edit)
    sessionFeedbackRepo.upsert({
      classId: testClassId,
      sessionId: `${testClassId}_SESS_02`,
      studentId: "STU_INHERIT_1",
      attendanceStatus: "PRESENT",
      quickTagsJson: "[]",
      teacherNote: "",
      strengths: "",
      improvements: "",
      actionPlan: "",
      finalText: "",
      status: "DRAFT",
      versionMetaJson: JSON.stringify({ rowVer: 1, fields: { attendanceStatus: { ver: 1, cid: "t", rev: 1 } } }),
    });
    // SESS_02: STU_CLEARED_IN_S2 had quickTags explicitly cleared by teacher
    sessionFeedbackRepo.upsert({
      classId: testClassId,
      sessionId: `${testClassId}_SESS_02`,
      studentId: "STU_CLEARED_IN_S2",
      attendanceStatus: "PRESENT",
      quickTagsJson: "[]",
      teacherNote: "",
      strengths: "",
      improvements: "",
      actionPlan: "",
      finalText: "",
      status: "DRAFT",
      versionMetaJson: JSON.stringify({ rowVer: 1, fields: { quickTags: { ver: 1, cid: "t", rev: 1 } } }),
    });

    // Query SESS_02 -> STU_INHERIT_1 should inherit normalized Robotics tags from SESS_01
    const s2Res = await getSessionCommentsList(
      new Request(
        `http://127.0.0.1:3000/api/session-comments/list?classId=${testClassId}&sessionId=${testClassId}_SESS_02`,
        { method: "GET", headers: { host: "127.0.0.1:3000" } }
      )
    );
    const s2Json = await s2Res.json();
    assert.deepStrictEqual(s2Json.data?.previousQuickTagsByStudent?.["STU_INHERIT_1"], {
      tags: ["🤖 Lắp ráp & Lập trình tốt", "🙋 Hăng hái phát biểu"],
      fromSessionNumber: 1,
    });

    // Query SESS_03 -> STU_INHERIT_1 skips attendance-only SESS_02 and inherits from SESS_01;
    // STU_CLEARED_IN_S2 respects explicit tag clear in SESS_02
    const s3Res = await getSessionCommentsList(
      new Request(
        `http://127.0.0.1:3000/api/session-comments/list?classId=${testClassId}&sessionId=${testClassId}_SESS_03`,
        { method: "GET", headers: { host: "127.0.0.1:3000" } }
      )
    );
    const s3Json = await s3Res.json();
    assert.deepStrictEqual(s3Json.data?.previousQuickTagsByStudent?.["STU_INHERIT_1"], {
      tags: ["🤖 Lắp ráp & Lập trình tốt", "🙋 Hăng hái phát biểu"],
      fromSessionNumber: 1,
    });
    assert.strictEqual(
      s3Json.data?.previousQuickTagsByStudent?.["STU_CLEARED_IN_S2"],
      undefined,
      "Học viên đã bị xóa thẻ chủ động ở Buổi 2 không được tự động lấy lại thẻ từ Buổi 1 khi sang Buổi 3"
    );
  } finally {
    db.prepare(
      `DELETE FROM session_feedbacks
       WHERE classId = ?
         AND sessionId IN (?, ?)
         AND studentId IN (?, ?)`
    ).run(
      testClassId,
      `${testClassId}_SESS_01`,
      `${testClassId}_SESS_02`,
      "STU_INHERIT_1",
      "STU_CLEARED_IN_S2"
    );
  }

  assert.ok(
    sessionFeedbackRepo.findOne(sentinelClassId, sentinelSessionId, sentinelStudentId),
    "R1-01: Dữ liệu của lớp thật VT-ROB-SEMIA05 phải còn nguyên vẹn sau khi chạy test"
  );
  if (!hadPreExistingSentinel) {
    db.prepare(
      `DELETE FROM session_feedbacks WHERE classId = ? AND sessionId = ? AND studentId = ?`
    ).run(sentinelClassId, sentinelSessionId, sentinelStudentId);
  }

  console.log("✅ TẤT CẢ KIỂM THỬ QUICK TAGS & CHECKPOINT (v3.0.0 / v3.1.1) ĐỀU PASS 100%!");
}

runQuickTagsV300Tests().catch((err) => {
  console.error("❌ LỖI KIỂM THỬ QUICK TAGS v3.0.0:", err);
  process.exit(1);
});
