import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempTestDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-quick-tags-v300-"));
if (!process.env.MINDX_DB_PATH) {
  process.env.MINDX_DB_PATH = path.join(tempTestDir, "test_quick_tags.db");
}
if (!process.env.MINDX_RUNNING_CLASSES_PATH) {
  const realRunning = path.resolve(process.cwd(), "data", "running_classes.json");
  const tempRunning = path.join(tempTestDir, "running_classes.json");
  if (fs.existsSync(realRunning)) {
    fs.copyFileSync(realRunning, tempRunning);
  } else {
    fs.writeFileSync(tempRunning, "[]", "utf8");
  }
  process.env.MINDX_RUNNING_CLASSES_PATH = tempRunning;
}

import { GET as getSessionCommentsList } from "../src/app/api/session-comments/list/route";
import { GET as getSpckList } from "../src/app/api/spck/list/route";
import { getCoursesSyllabus, getQuickTags } from "../src/lib/db/json-config";
import { closeDb, getDb, sessionFeedbackRepo, studentRepo } from "../src/lib/db/sqlite";
import { CommentGenerator, computeCommentSimilarity } from "../src/lib/gemini/comment-generator";
import * as geminiClient from "../src/lib/gemini/client";
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
  console.log("=== BẮT ĐẦU KIỂM THỬ QUICK TAGS & CHỐNG TRÙNG LẶP NHẬN XÉT AI (v3.0.0+) ===");

  // 1. Verify quick_tags.json structure
  const categories = getQuickTags();
  const codingCat = categories.find((c) => c.category === "regular_coding");
  const roboticsCat = categories.find((c) => c.category === "regular_robotics");
  const s14PresCat = categories.find((c) => c.category === "spck_session14_presentation");
  const s14ProdCat = categories.find((c) => c.category === "spck_session14_product");

  assert.ok(codingCat, "Phải có nhóm regular_coding trong quick_tags.json");
  assert.strictEqual(codingCat.tags.length, 7, "Nhóm Lập trình phải có đúng 7 thẻ ngắn gọn");
  assert.ok(roboticsCat, "Phải có nhóm regular_robotics trong quick_tags.json");
  assert.strictEqual(roboticsCat.tags.length, 7, "Nhóm Robotics phải có đúng 7 thẻ (4 tích cực + 3 cần cải thiện)");
  assert.deepStrictEqual(
    roboticsCat.tags.map((t) => t.label),
    [
      "🔧 Lắp ráp đúng mẫu",
      "💻 Lập trình chạy đúng",
      "🧠 Chủ động thử & sửa lỗi",
      "🤝 Hợp tác nhóm tốt",
      "🔩 Lắp ráp cần hỗ trợ",
      "🧩 Lập trình cần hỗ trợ",
      "👀 Cần nhắc tập trung",
    ],
    "Danh sách 7 thẻ Robotics phải khớp đúng bộ thẻ chuẩn đã duyệt"
  );
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
  assert.strictEqual(returnedTags.length, 14, "Màn hình 1 chỉ nhận đúng 14 thẻ (7 Lập trình + 7 Robotics)");
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
    classifyStudentSkillLevel(["🧠 Chủ động thử & sửa lỗi", "🔧 Lắp ráp đúng mẫu"], regCats).levelCode,
    1,
    "Thẻ Robotics Chủ động thử & sửa lỗi -> Cấp độ 1 (Giỏi)"
  );
  assert.strictEqual(
    classifyStudentSkillLevel(["✅ Tiếp thu tốt", "📝 Làm bài tập đầy đủ"], regCats).levelCode,
    2,
    "Thẻ Tiếp thu tốt + Làm bài tập đầy đủ -> Cấp độ 2 (Khá)"
  );
  assert.strictEqual(
    classifyStudentSkillLevel(["🔧 Lắp ráp đúng mẫu", "💻 Lập trình chạy đúng"], regCats).levelCode,
    2,
    "Thẻ Robotics Lắp ráp đúng mẫu + Lập trình chạy đúng -> Cấp độ 2 (Khá)"
  );
  assert.strictEqual(
    classifyStudentSkillLevel(["🔧 Lắp ráp đúng mẫu", "👀 Cần nhắc tập trung"], regCats).levelCode,
    3,
    "Thẻ tốt + Cần nhắc tập trung -> Cấp độ 3 (Khá nhưng mất tập trung)"
  );
  assert.strictEqual(
    classifyStudentSkillLevel(["🐢 Tiếp thu chậm"], regCats).levelCode,
    4,
    "Thẻ Tiếp thu chậm -> Cấp độ 4 (Trung bình)"
  );
  assert.strictEqual(
    classifyStudentSkillLevel(["🔩 Lắp ráp cần hỗ trợ"], regCats).levelCode,
    4,
    "Thẻ Lắp ráp cần hỗ trợ -> Cấp độ 4 (Trung bình)"
  );
  assert.strictEqual(
    classifyStudentSkillLevel(["🔩 Lắp ráp cần hỗ trợ", "👀 Cần nhắc tập trung"], regCats).levelCode,
    5,
    "Thẻ chậm + Cần nhắc tập trung -> Cấp độ 5 (Trung bình, mất tập trung)"
  );
  // Legacy backward compatibility
  assert.strictEqual(
    classifyStudentSkillLevel(["🌟 Xuất sắc & Sáng tạo"], regCats).levelCode,
    1,
    "Tương thích ngược thẻ cũ 🌟 Xuất sắc & Sáng tạo -> Cấp độ 1"
  );
  assert.strictEqual(
    classifyStudentSkillLevel(["🤖 Lắp ráp & Lập trình tốt", "👀 Mất tập trung"], regCats).levelCode,
    3,
    "Tương thích ngược thẻ cũ 🤖 Lắp ráp & Lập trình tốt + 👀 Mất tập trung -> Cấp độ 3"
  );
  assert.strictEqual(
    classifyStudentSkillLevel(["🛠️ Cần kèm thêm"], regCats).levelCode,
    4,
    "Tương thích ngược thẻ cũ 🛠️ Cần kèm thêm -> Cấp độ 4"
  );

  // 4b. Regression assertions for Codex CLI Phase 1 findings:
  assert.strictEqual(
    classifyStudentSkillLevel(["✅ Tiếp thu tốt", "⌨️ Thao tác / Cú pháp còn chậm"], regCats).levelCode,
    2,
    "Thẻ Tiếp thu tốt + Thao tác/Cú pháp còn chậm (role: improve) phải ra Cấp độ 2 (Khá), không bị nhầm sang Cấp độ 4"
  );
  assert.strictEqual(
    classifyStudentSkillLevel(["🔧 Lắp ráp đúng mẫu", "🧩 Lập trình cần hỗ trợ"], regCats).levelCode,
    2,
    "Thẻ Lắp ráp đúng mẫu + Lập trình cần hỗ trợ (role: improve) phải ra Cấp độ 2 (Khá)"
  );
  assert.strictEqual(
    classifyStudentSkillLevel(["✅ Tiếp thu tốt", "⌨️ Thao tác / Cú pháp còn chậm"]).levelCode,
    2,
    "Ngay cả khi không truyền categories, regex fallback vẫn phân loại Thao tác/Cú pháp còn chậm là improve -> Cấp độ 2"
  );

  assert.strictEqual(
    classifyStudentSkillLevel(
      ["💡 Vận dụng & Sáng tạo tốt", "🐢 Tiếp thu chậm", "👀 Mất tập trung"],
      regCats
    ).levelCode,
    5,
    "Kết hợp thẻ Giỏi + Tiếp thu chậm + Mất tập trung ưu tiên cảnh báo Cấp độ 5"
  );

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
    ["🔧 Lắp ráp đúng mẫu", "🤝 Hợp tác nhóm tốt"],
    "Chuẩn hóa thẻ cũ sang bộ thẻ Robotics mới"
  );
  assert.deepStrictEqual(
    normalizeQuickTagsForTrack(
      ["🔩 Lắp ráp còn chậm / Nhầm chốt", "🔌 Lập trình / Đấu mạch còn lúng túng", "👀 Mất tập trung"],
      "robotics"
    ),
    ["🔩 Lắp ráp cần hỗ trợ", "🧩 Lập trình cần hỗ trợ", "👀 Cần nhắc tập trung"],
    "Chuẩn hóa thẻ cần cải thiện cũ của Robotics sang 3 thẻ mới"
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
  const testClassId = "TEST_V311_ROB_SEMIA05";
  const db = getDb();
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
      quickTagsJson: JSON.stringify(["🔧 Lắp ráp đúng mẫu"]),
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

    const s2Res = await getSessionCommentsList(
      new Request(
        `http://127.0.0.1:3000/api/session-comments/list?classId=${testClassId}&sessionId=${testClassId}_SESS_02`,
        { method: "GET", headers: { host: "127.0.0.1:3000" } }
      )
    );
    const s2Json = await s2Res.json();
    assert.deepStrictEqual(s2Json.data?.previousQuickTagsByStudent?.["STU_INHERIT_1"], {
      tags: ["🔧 Lắp ráp đúng mẫu", "🤝 Hợp tác nhóm tốt"],
      fromSessionNumber: 1,
    });

    const s3Res = await getSessionCommentsList(
      new Request(
        `http://127.0.0.1:3000/api/session-comments/list?classId=${testClassId}&sessionId=${testClassId}_SESS_03`,
        { method: "GET", headers: { host: "127.0.0.1:3000" } }
      )
    );
    const s3Json = await s3Res.json();
    assert.deepStrictEqual(s3Json.data?.previousQuickTagsByStudent?.["STU_INHERIT_1"], {
      tags: ["🔧 Lắp ráp đúng mẫu", "🤝 Hợp tác nhóm tốt"],
      fromSessionNumber: 1,
    });
    assert.strictEqual(
      s3Json.data?.previousQuickTagsByStudent?.["STU_CLEARED_IN_S2"],
      undefined,
      "Học viên đã bị xóa thẻ chủ động ở Buổi 2 không được tự động lấy lại thẻ từ Buổi 1 khi sang Buổi 3"
    );

    // 7. Verify 4-Layer Anti-Duplication & Similarity Rewrite Guard
    const dupCommentA =
      "- **Điểm mạnh của học viên:** Trong buổi học lắp ráp **Robot thám hiểm**, con đã hoàn thành mô hình đúng mẫu và chạy thử ổn định.\n\n- **Điểm cần cải thiện:** Con cần rèn thêm **tốc độ tìm linh kiện** để hoàn thiện nhanh hơn.\n\n- **Lời khuyên:** Ba mẹ nhắc con **ôn lại các bước lắp truyền động** tại nhà nhé.";
    const dupCommentB = dupCommentA;
    const distinctCommentC =
      "- **Điểm mạnh của học viên:** Ở chủ đề **Robot thám hiểm** hôm nay, con nắm bắt rất nhanh nguyên lý kết nối cảm biến và chủ động thiết lập khối lệnh di chuyển chuẩn xác.\n\n- **Điểm cần cải thiện:** Khi tinh chỉnh góc quay, con nên kiểm tra kỹ thông số vòng quay trước khi bấm chạy.\n\n- **Lời khuyên:** Gia đình có thể khuyến khích con kể lại cách hoạt động của robot vượt chướng ngại vật sau giờ học.";

    assert.strictEqual(
      computeCommentSimilarity(dupCommentA, dupCommentB),
      1,
      "Hai nhận xét giống hệt nhau phải có similarity = 1.0 (100%)"
    );
    assert.ok(
      computeCommentSimilarity(dupCommentA, distinctCommentC) < 0.35,
      "Hai nhận xét cùng chủ đề nhưng khác cấu trúc câu phải có similarity < 0.35"
    );

    studentRepo.upsert({
      studentId: "STU_DUP_1",
      classId: testClassId,
      fullName: "Nguyễn Minh Khôi",
      isActive: 1,
    });
    studentRepo.upsert({
      studentId: "STU_DUP_2",
      classId: testClassId,
      fullName: "Trần Bảo Nam",
      isActive: 1,
    });

    const capturedPrompts: string[] = [];
    const origFetch = globalThis.fetch;
    process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "TEST_DUMMY_KEY";
    globalThis.fetch = (async (_input: any, init?: any) => {
      const bodyStr = typeof init?.body === "string" ? init.body : "";
      capturedPrompts.push(bodyStr);
      const payload =
        capturedPrompts.length === 1
          ? {
              feedbacks: [
                {
                  anonymousId: "STUDENT_01",
                  strengths:
                    "Trong buổi học lắp ráp **Robot thám hiểm**, con đã hoàn thành mô hình đúng mẫu và chạy thử ổn định.",
                  improvements:
                    "Con cần rèn thêm **tốc độ tìm linh kiện** để hoàn thiện nhanh hơn.",
                  actionPlan:
                    "Ba mẹ nhắc con **ôn lại các bước lắp truyền động** tại nhà nhé.",
                  formattedFullComment: dupCommentA,
                },
                {
                  anonymousId: "STUDENT_02",
                  strengths:
                    "Trong buổi học lắp ráp **Robot thám hiểm**, con đã hoàn thành mô hình đúng mẫu và chạy thử ổn định.",
                  improvements:
                    "Con cần rèn thêm **tốc độ tìm linh kiện** để hoàn thiện nhanh hơn.",
                  actionPlan:
                    "Ba mẹ nhắc con **ôn lại các bước lắp truyền động** tại nhà nhé.",
                  formattedFullComment: dupCommentB,
                },
              ],
            }
          : {
              feedbacks: [
                {
                  anonymousId: "STUDENT_02",
                  strengths:
                    "Ở chủ đề **Robot thám hiểm** hôm nay, con nắm bắt rất nhanh nguyên lý kết nối cảm biến và chủ động thiết lập khối lệnh di chuyển chuẩn xác.",
                  improvements:
                    "Khi tinh chỉnh góc quay, con nên kiểm tra kỹ **thông số vòng quay** trước khi bấm chạy.",
                  actionPlan:
                    "Gia đình có thể khuyến khích con **kể lại cách hoạt động của robot** sau giờ học.",
                  formattedFullComment: distinctCommentC,
                },
              ],
            };
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(payload) }],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as any;

    try {
      const batchOut = await CommentGenerator.generateBatchComments(
        {
          classId: testClassId,
          classCode: testClassId,
          sessionId: `${testClassId}_SESS_04`,
          sessionNumber: 4,
          topic: "Robot thám hiểm vượt địa hình",
          keyKnowledge: ["Cơ cấu bánh răng truyền động", "Khối lệnh điều khiển động cơ đôi"],
        },
        [
          {
            studentId: "STU_DUP_1",
            fullName: "Nguyễn Minh Khôi",
            isActive: true,
            attendanceStatus: "PRESENT",
            quickTags: ["🔧 Lắp ráp đúng mẫu", "💻 Lập trình chạy đúng"],
          },
          {
            studentId: "STU_DUP_2",
            fullName: "Trần Bảo Nam",
            isActive: true,
            attendanceStatus: "PRESENT",
            quickTags: ["🔧 Lắp ráp đúng mẫu", "💻 Lập trình chạy đúng"],
          },
        ]
      );

      assert.strictEqual(
        capturedPrompts.length,
        2,
        "Khi AI trả về 2 nhận xét trùng nhau >= 48%, hệ thống phải tự động gọi lượt viết lại (Layer 4)"
      );
      assert.ok(
        capturedPrompts[0].includes("Góc nhìn 1") && capturedPrompts[0].includes("Góc nhìn 5"),
        "Prompt đầu tiên phải gán góc nhìn diễn đạt (narrativeAngle) khác nhau cho 2 học sinh cùng nhóm thẻ"
      );
      assert.strictEqual(batchOut.length, 2);
      const finalSim = computeCommentSimilarity(
        batchOut[0].formattedFullComment,
        batchOut[1].formattedFullComment
      );
      assert.ok(
        finalSim < 0.35,
        `Sau khi qua chốt chặn chống trùng lặp, độ giống nhau giữa 2 học sinh phải < 35% (thực tế: ${(
          finalSim * 100
        ).toFixed(1)}%)`
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  } finally {
    closeDb();
    try {
      fs.rmSync(tempTestDir, { recursive: true, force: true });
    } catch {}
  }

  console.log("✅ TẤT CẢ KIỂM THỬ QUICK TAGS ROBOTICS & CHỐNG TRÙNG LẶP AI ĐỀU PASS 100%!");
}

runQuickTagsV300Tests().catch((err) => {
  console.error("❌ LỖI KIỂM THỬ QUICK TAGS v3.0.0:", err);
  process.exit(1);
});
