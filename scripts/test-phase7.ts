import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { GET as getConfigRoute, POST as postConfigRoute } from "../src/app/api/config/route";
import {
  GET as getQueueControlRoute,
  POST as postQueueControlRoute,
} from "../src/app/api/queue/control/route";
import { GET as getQueueStreamRoute } from "../src/app/api/queue/stream/route";
import { calculateSha256, getDb, sessionFeedbackRepo } from "../src/lib/db/sqlite";
import { taskQueue } from "../src/lib/queue/task-queue";

const ROOT_DIR = process.cwd();
const CONFIG_DIR = path.join(ROOT_DIR, "data", "config");
const CONFIG_FILES = [
  "courses_syllabus.json",
  "grading_rubrics.json",
  "quick_tags.json",
  "zalo_templates.json",
];

function makeLocalGetRequest(urlPath: string): Request {
  return new Request(`http://127.0.0.1:3000${urlPath}`, {
    method: "GET",
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
    },
  });
}

function makeLocalPostRequest(urlPath: string, body: unknown): Request {
  return new Request(`http://127.0.0.1:3000${urlPath}`, {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function makeEvilOriginRequest(urlPath: string, method: "GET" | "POST"): Request {
  return new Request(`http://127.0.0.1:3000${urlPath}`, {
    method,
    headers: {
      host: "127.0.0.1:3000",
      origin: "https://evil-attacker.example.com",
      "content-type": "application/json",
    },
    body: method === "POST" ? JSON.stringify({}) : undefined,
  });
}

async function runPhase7Tests() {
  console.log("==============================================================");
  console.log("🚀 BẮT ĐẦU KIỂM THỬ GIAI ĐOẠN 7 (TASK-7.1 -> TASK-7.3)");
  console.log("==============================================================\n");

  // Backup original JSON config files to restore cleanly in finally block
  const backups = new Map<string, string>();
  for (const fileName of CONFIG_FILES) {
    const filePath = path.join(CONFIG_DIR, fileName);
    if (fs.existsSync(filePath)) {
      backups.set(filePath, fs.readFileSync(filePath, "utf-8"));
    }
  }

  const testClassId = "TEST-P7-CLASS";
  const testSessionId = "TEST-P7-SESSION-01";
  const testStudentId = "TEST-P7-STU-01";

  try {
    // =========================================================================
    // 1. TASK-7.1: /api/config & /syllabus-config
    // =========================================================================
    console.log("👉 [TASK-7.1] Kiểm tra API /api/config & Giao diện Quản lý Giáo trình / Barem...");

    // 1.1 Security Guard check
    const evilGetRes = await getConfigRoute(makeEvilOriginRequest("/api/config", "GET"));
    assert.strictEqual(
      evilGetRes.status,
      403,
      "GET /api/config phải chặn request từ Origin lạ với mã 403"
    );
    const evilPostRes = await postConfigRoute(makeEvilOriginRequest("/api/config", "POST"));
    assert.strictEqual(
      evilPostRes.status,
      403,
      "POST /api/config phải chặn request từ Origin lạ với mã 403"
    );

    // 1.2 GET /api/config
    const initConfigRes = await getConfigRoute(makeLocalGetRequest("/api/config"));
    assert.strictEqual(initConfigRes.status, 200, "GET /api/config phải trả về HTTP 200");
    const initConfigJson = await initConfigRes.json();
    assert.strictEqual(initConfigJson.success, true);
    assert.ok(Array.isArray(initConfigJson.courses), "courses phải là mảng");
    assert.ok(Array.isArray(initConfigJson.rubrics), "rubrics phải là mảng");
    assert.ok(Array.isArray(initConfigJson.quickTags), "quickTags phải là mảng");
    assert.ok(Array.isArray(initConfigJson.zaloTemplates), "zaloTemplates phải là mảng");

    // 1.3 POST /api/config (section = courses)
    const testCourses = [
      ...initConfigJson.courses.filter((c: any) => c.courseCode !== "ROB-P7"),
      {
        courseCode: "ROB-P7",
        courseName: "Robotics Cơ Bản (Test P7)",
        description: "Khóa học lắp ráp và lập trình Robot thông minh.",
        sessions: [
          {
            sessionNumber: 1,
            topic: "Làm quen với cảm biến và động cơ",
            keyKnowledge: ["Sensor", "Motor", "Loop"],
            homeworkBrief: "Lập trình robot di chuyển theo hình vuông.",
          },
        ],
      },
    ];
    const saveCoursesRes = await postConfigRoute(
      makeLocalPostRequest("/api/config", {
        section: "courses",
        courses: testCourses,
      })
    );
    assert.strictEqual(saveCoursesRes.status, 200, "Lưu courses phải trả về HTTP 200");
    const saveCoursesJson = await saveCoursesRes.json();
    assert.strictEqual(saveCoursesJson.success, true);
    assert.ok(
      saveCoursesJson.courses.some((c: any) => c.courseCode === "ROB-P7"),
      "Khóa ROB-P7 vừa thêm phải được lưu vào courses_syllabus.json"
    );

    // 1.4 POST /api/config (section = rubrics) + deterministic sum(criteria.maxPoints) === 100
    const invalidScaleRubricRes = await postConfigRoute(
      makeLocalPostRequest("/api/config", {
        section: "rubrics",
        rubrics: [
          {
            rubricId: "RUBRIC_ROB_INVALID_10",
            courseCode: "ROB-P7",
            sessionNumber: 1,
            assignmentTitle: "Bài tập thang 10 sai quy chuẩn",
            assignmentPrompt: "Test",
            maxTotalScore: 10,
            criteria: [
              { criterionId: "C1", name: "C1", maxPoints: 4 },
              { criterionId: "C2", name: "C2", maxPoints: 6 },
            ],
          },
        ],
      })
    );
    assert.strictEqual(
      invalidScaleRubricRes.status,
      400,
      "Barem có tổng điểm khác 100 (thang 10) phải bị từ chối với HTTP 400"
    );

    const testRubrics = [
      ...initConfigJson.rubrics.filter((r: any) => r.rubricId !== "RUBRIC_ROB_S01"),
      {
        rubricId: "RUBRIC_ROB_S01",
        courseCode: "ROB-P7",
        sessionNumber: 1,
        assignmentTitle: "Bài tập Robot hình vuông",
        assignmentPrompt: "Viết chương trình điều khiển robot đi theo hình vuông 4 cạnh bằng nhau.",
        maxTotalScore: 999, // Intentionally wrong to verify server recalculates deterministically to 100
        criteria: [
          {
            criterionId: "C1",
            name: "Kết nối đúng cổng động cơ",
            description: "Khai báo đúng cổng A và B cho 2 motor.",
            maxPoints: 40,
            expectedSnippetOrConcept: "Motor(Port.A), Motor(Port.B)",
          },
          {
            criterionId: "C2",
            name: "Vòng lặp 4 cạnh",
            description: "Sử dụng vòng lặp repeat 4 lần.",
            maxPoints: 60,
            expectedSnippetOrConcept: "for i in range(4):",
          },
        ],
      },
    ];
    const saveRubricsRes = await postConfigRoute(
      makeLocalPostRequest("/api/config", {
        section: "rubrics",
        rubrics: testRubrics,
      })
    );
    assert.strictEqual(saveRubricsRes.status, 200, "Lưu rubrics phải trả về HTTP 200");
    const saveRubricsJson = await saveRubricsRes.json();
    const savedRobRubric = saveRubricsJson.rubrics.find((r: any) => r.rubricId === "RUBRIC_ROB_S01");
    assert.ok(savedRobRubric, "Phải tìm thấy RUBRIC_ROB_S01 sau khi lưu");
    assert.strictEqual(
      savedRobRubric.maxTotalScore,
      100,
      "Server phải tự cộng lại maxTotalScore = 40 + 60 = 100 bằng code TypeScript"
    );

    // 1.5 POST /api/config (section = quickTags)
    const testTags = [
      ...initConfigJson.quickTags,
      {
        category: "robotics_practice",
        categoryName: "Thực hành Robotics (Test P7)",
        tags: [
          {
            id: "TAG_P7_TEST",
            label: "Lắp ráp mạch nhanh",
            sentiment: "positive",
            hint: "Học sinh thao tác lắp ráp linh kiện và mạch điện nhanh, chính xác.",
          },
        ],
      },
    ];
    const saveTagsRes = await postConfigRoute(
      makeLocalPostRequest("/api/config", {
        section: "quickTags",
        quickTags: testTags,
      })
    );
    assert.strictEqual(saveTagsRes.status, 200, "Lưu quickTags phải trả về HTTP 200");
    const saveTagsJson = await saveTagsRes.json();
    assert.ok(
      saveTagsJson.quickTags.some((cat: any) =>
        cat.tags?.some((t: any) => t.id === "TAG_P7_TEST")
      ),
      "Thẻ đánh giá nhanh TAG_P7_TEST phải tồn tại sau khi lưu"
    );

    // 1.6 POST /api/config (section = zaloTemplates)
    const testZalo = [
      ...initConfigJson.zaloTemplates,
      {
        id: "ZALO_P7_TEST",
        name: "Mẫu thông báo buổi học thử nghiệm P7",
        template:
          "Chào Ba Mẹ lớp {Ten_Lop}, hôm nay buổi {Buoi_So} các con đã học: {Noi_Dung_Bai_Hoc}.",
      },
    ];
    const saveZaloRes = await postConfigRoute(
      makeLocalPostRequest("/api/config", {
        section: "zaloTemplates",
        zaloTemplates: testZalo,
      })
    );
    assert.strictEqual(saveZaloRes.status, 200, "Lưu zaloTemplates phải trả về HTTP 200");
    const saveZaloJson = await saveZaloRes.json();
    assert.ok(
      saveZaloJson.zaloTemplates.some((z: any) => z.id === "ZALO_P7_TEST"),
      "Mẫu Zalo ZALO_P7_TEST phải tồn tại sau khi lưu"
    );

    // 1.7 Verify /syllabus-config Client Component boundary & features
    const syllabusPagePath = path.join(ROOT_DIR, "src", "app", "syllabus-config", "page.tsx");
    const syllabusSource = fs.readFileSync(syllabusPagePath, "utf-8");
    assert.ok(
      syllabusSource.startsWith('"use client";'),
      "syllabus-config/page.tsx phải là Client Component ('use client')"
    );
    assert.ok(
      syllabusSource.includes('fetch("/api/config"'),
      "syllabus-config/page.tsx phải kết nối tới /api/config"
    );
    for (const forbidden of [
      "TEACHING_PASSWORD",
      "LMS_PASSWORD",
      "GEMINI_API_KEY",
      "@/lib/config",
      "@/lib/db/",
      "@/lib/playwright/",
    ]) {
      assert.ok(
        !syllabusSource.includes(forbidden),
        `syllabus-config/page.tsx tuyệt đối không được chứa '${forbidden}'`
      );
    }
    console.log("   ✅ [TASK-7.1] Đạt 100% kiểm thử /api/config & /syllabus-config!\n");

    // =========================================================================
    // 2. TASK-7.2: Live Automation Log / Status Drawer & Emergency Stop
    // =========================================================================
    console.log("👉 [TASK-7.2] Kiểm tra SSE Stream (/api/queue/stream) & Dừng khẩn cấp (Stop Bot)...");

    // 2.1 Security Guard check on queue routes
    const evilStreamRes = await getQueueStreamRoute(
      makeEvilOriginRequest("/api/queue/stream", "GET")
    );
    assert.strictEqual(evilStreamRes.status, 403, "GET /api/queue/stream phải chặn Origin lạ (403)");
    const evilControlRes = await postQueueControlRoute(
      makeEvilOriginRequest("/api/queue/control", "POST")
    );
    assert.strictEqual(
      evilControlRes.status,
      403,
      "POST /api/queue/control phải chặn Origin lạ (403)"
    );

    // 2.2 Test SSE stream initial payload (STATUS + RECENT_LOGS) and live events
    const abortController = new AbortController();
    const streamReq = new Request("http://127.0.0.1:3000/api/queue/stream", {
      method: "GET",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
      },
      signal: abortController.signal,
    });
    const streamRes = await getQueueStreamRoute(streamReq);
    assert.strictEqual(streamRes.status, 200);
    assert.strictEqual(streamRes.headers.get("Content-Type"), "text/event-stream");
    assert.ok(streamRes.body, "SSE response phải có ReadableStream body");

    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();
    let collectedSseText = "";

    // Read initial chunks (STATUS + RECENT_LOGS)
    for (let i = 0; i < 2; i++) {
      const chunk = await reader.read();
      if (chunk.value) {
        collectedSseText += decoder.decode(chunk.value, { stream: true });
      }
      if (collectedSseText.includes('"type":"STATUS"') && collectedSseText.includes('"type":"RECENT_LOGS"')) {
        break;
      }
    }
    assert.ok(
      collectedSseText.includes('"type":"STATUS"'),
      "SSE stream phải phát sự kiện STATUS ngay khi kết nối"
    );
    assert.ok(
      collectedSseText.includes('"type":"RECENT_LOGS"'),
      "SSE stream phải phát sự kiện RECENT_LOGS ngay khi kết nối"
    );

    // 2.3 Seed a VERIFIED record in SQLite and test Emergency Stop while queue has pending tasks
    const verifiedFinalText = "Nhận xét đã được kiểm chứng VERIFIED trước khi bấm Stop Bot.";
    sessionFeedbackRepo.upsert({
      classId: testClassId,
      sessionId: testSessionId,
      studentId: testStudentId,
      attendanceStatus: "PRESENT",
      quickTagsJson: '["TAG_01"]',
      teacherNote: "Học tốt",
      finalText: verifiedFinalText,
      contentHash: calculateSha256(verifiedFinalText),
      status: "VERIFIED",
    });

    // Ensure queue is resumed and clean before test
    taskQueue.resumeQueue();
    taskQueue.clearQueue();

    let releaseTask1!: () => void;
    const task1Gate = new Promise<void>((resolve) => {
      releaseTask1 = resolve;
    });

    let task2Executed = false;

    const p1 = taskQueue.enqueue({
      id: "P7_TASK_1",
      jobType: "CUSTOM",
      description: "Đang xử lý học viên 01...",
      classId: testClassId,
      execute: async () => {
        await task1Gate;
        return "DONE_1";
      },
    });

    const p2 = taskQueue.enqueue({
      id: "P7_TASK_2",
      jobType: "CUSTOM",
      description: "Đang chờ xử lý học viên 02 (sẽ bị hủy bởi Stop Bot)...",
      classId: testClassId,
      execute: async () => {
        task2Executed = true;
        return "DONE_2";
      },
    });

    // Trigger Emergency Stop via POST /api/queue/control { action: "stop" }
    const stopRes = await postQueueControlRoute(
      makeLocalPostRequest("/api/queue/control", { action: "stop" })
    );
    assert.strictEqual(stopRes.status, 200, "POST /api/queue/control (stop) phải trả về 200");
    const stopJson = await stopRes.json();
    assert.strictEqual(stopJson.success, true);
    assert.strictEqual(
      stopJson.status.isStopped,
      true,
      "Trạng thái hàng đợi phải chuyển sang isStopped = true ngay lập tức"
    );
    assert.strictEqual(
      stopJson.status.pendingCount,
      0,
      "Toàn bộ tác vụ đang chờ trong hàng đợi phải bị rút sạch (pendingCount = 0)"
    );

    // Verify p2 was rejected with TASK_CANCELLED
    let p2RejectedError = "";
    try {
      await p2;
    } catch (err) {
      p2RejectedError = err instanceof Error ? err.message : String(err);
    }
    assert.ok(
      p2RejectedError.includes("TASK_CANCELLED"),
      "Tác vụ đang chờ thứ 2 phải bị hủy với mã TASK_CANCELLED"
    );
    assert.strictEqual(task2Executed, false, "Tác vụ thứ 2 tuyệt đối không được phép chạy sau khi Stop Bot");

    // Release task 1 and verify it finishes cleanly
    releaseTask1();
    const res1 = await p1;
    assert.strictEqual(res1, "DONE_1");

    // Verify previously VERIFIED record in SQLite is 100% preserved
    const preservedRecord = sessionFeedbackRepo.findOne(testClassId, testSessionId, testStudentId);
    assert.ok(preservedRecord, "Bản ghi trong SQLite phải còn nguyên");
    assert.strictEqual(
      preservedRecord.status,
      "VERIFIED",
      "Trạng thái bản ghi đã VERIFIED trước đó phải được giữ nguyên tuyệt đối khi bấm Stop Bot"
    );

    // Resume queue via POST /api/queue/control { action: "resume" }
    const resumeRes = await postQueueControlRoute(
      makeLocalPostRequest("/api/queue/control", { action: "resume" })
    );
    assert.strictEqual(resumeRes.status, 200);
    const resumeJson = await resumeRes.json();
    assert.strictEqual(resumeJson.status.isStopped, false, "Hàng đợi phải mở khóa lại sau khi resume");

    // Verify GET /api/queue/control returns status
    const statusRes = await getQueueControlRoute(makeLocalGetRequest("/api/queue/control"));
    assert.strictEqual(statusRes.status, 200);

    abortController.abort();
    try {
      await reader.cancel();
    } catch {
      // Ignore stream cancellation error
    }

    // 2.4 Verify LiveLogDrawer client component boundary
    const drawerPath = path.join(ROOT_DIR, "src", "components", "live-log-drawer.tsx");
    const drawerSource = fs.readFileSync(drawerPath, "utf-8");
    assert.ok(
      drawerSource.startsWith('"use client";'),
      "live-log-drawer.tsx phải là Client Component ('use client')"
    );
    assert.ok(
      drawerSource.includes('new EventSource("/api/queue/stream")'),
      "live-log-drawer.tsx phải kết nối SSE tới /api/queue/stream"
    );
    assert.ok(
      drawerSource.includes("Dừng khẩn cấp (Stop Bot)"),
      "live-log-drawer.tsx phải có nút 'Dừng khẩn cấp (Stop Bot)'"
    );
    for (const forbidden of [
      "TEACHING_PASSWORD",
      "LMS_PASSWORD",
      "GEMINI_API_KEY",
      "@/lib/config",
      "@/lib/db/",
      "@/lib/playwright/",
      "@/lib/queue/",
    ]) {
      assert.ok(
        !drawerSource.includes(forbidden),
        `live-log-drawer.tsx tuyệt đối không được import module server hoặc chứa biến nhạy cảm '${forbidden}'`
      );
    }
    console.log("   ✅ [TASK-7.2] Đạt 100% kiểm thử SSE Live Log Drawer & Nút Dừng Khẩn Cấp!\n");

    // =========================================================================
    // 3. TASK-7.3: One-click Startup Scripts (start-bot.bat & start-bot.command)
    // =========================================================================
    console.log("👉 [TASK-7.3] Kiểm tra bộ file khởi chạy 1 chạm (start-bot.bat & start-bot.command)...");

    const batPath = path.join(ROOT_DIR, "start-bot.bat");
    const cmdPath = path.join(ROOT_DIR, "start-bot.command");

    assert.ok(fs.existsSync(batPath), "Phải tồn tại file start-bot.bat ở thư mục gốc");
    assert.ok(fs.existsSync(cmdPath), "Phải tồn tại file start-bot.command ở thư mục gốc");

    const batContent = fs.readFileSync(batPath, "utf-8");
    const cmdContent = fs.readFileSync(cmdPath, "utf-8");

    assert.ok(
      batContent.includes("http://127.0.0.1:3000") && batContent.includes("npm run dev"),
      "start-bot.bat phải khởi chạy server local http://127.0.0.1:3000 và tự mở trình duyệt"
    );
    assert.ok(
      batContent.includes("where node") && batContent.includes("node_modules"),
      "start-bot.bat phải tự động kiểm tra môi trường Node.js và node_modules"
    );

    assert.ok(
      cmdContent.startsWith("#!/usr/bin/env bash"),
      "start-bot.command phải có shebang #!/usr/bin/env bash chuẩn macOS"
    );
    assert.ok(
      cmdContent.includes("http://127.0.0.1:3000") && cmdContent.includes("npm run dev"),
      "start-bot.command phải khởi chạy server local http://127.0.0.1:3000 và tự mở trình duyệt"
    );
    assert.ok(
      cmdContent.includes("command -v node") && cmdContent.includes("node_modules"),
      "start-bot.command phải tự động kiểm tra môi trường Node.js và node_modules"
    );
    console.log("   ✅ [TASK-7.3] Đạt 100% kiểm thử start-bot.bat (Windows) & start-bot.command (macOS)!\n");

    console.log("==============================================================");
    console.log("🎉 HOÀN TẤT KIỂM THỬ GIAI ĐOẠN 7: TẤT CẢ CÁC HẠNG MỤC ĐỀU PASS!");
    console.log("==============================================================");
  } finally {
    // Restore original JSON config files
    for (const [filePath, originalContent] of backups.entries()) {
      fs.writeFileSync(filePath, originalContent, "utf-8");
    }

    // Clean up temporary SQLite records created during Phase 7 test
    try {
      const db = getDb();
      db.prepare("DELETE FROM session_feedbacks WHERE classId = ?").run(testClassId);
      db.prepare("DELETE FROM job_logs WHERE classId = ? OR jobId LIKE 'P7_%'").run(testClassId);
      db.prepare("DELETE FROM job_logs WHERE message LIKE '%Stop Bot%' OR message LIKE '%mở khóa tiếp tục chạy%'").run();
    } catch {
      // Ignore cleanup errors
    }
  }
}

runPhase7Tests().catch((err) => {
  console.error("❌ KIỂM THỬ GIAI ĐOẠN 7 THẤT BẠI:", err);
  process.exit(1);
});
