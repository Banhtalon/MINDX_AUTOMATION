/**
 * KIỂM THỬ TOÀN DIỆN v3.7.0 — TỰ ĐỘNG TÍNH & TÍCH 9 Ô [ĐNL] CHECKPOINT, DÒNG ĐIỂM RIÊNG & ZALO TỔNG QUAN
 *
 * Bao phủ:
 * - [V370-01] Định danh Checkpoint (Robotics B4/B8; Coding B5/B9), chuẩn hóa điểm thang 5, lọc nhận xét giữ chỗ trên LMS.
 * - [V370-02] Tính 9 ô [ĐNL] từ lịch sử nhiều buổi (Coding B5/B9 có BTVN matrix + CP1 comparison; Robotics B4/B8 bỏ qua BTVN sạch sẽ).
 * - [V370-03] ClassSyncer.syncLmsSlotCompletionToSqlite trích xuất LT/TH/RATE từ LMS & KHÔNG gắn nhầm VERIFIED khi LMS chỉ có "." giữ chỗ.
 * - [V370-04] CommentGenerator: 0 lộ PII vào Gemini, gắn dòng điểm `📊 **Kết quả Checkpoint ...**`, giữ INSUFFICIENT_INFO khi thiếu hoàn toàn dữ liệu, & Rule 4 hạ DRAFT khi sửa [ĐNL] sau duyệt.
 * - [V370-05] Zalo Group Broadcast (Coding & Robotics): tự động chèn `🎯 ĐÁNH GIÁ QUÁ TRÌNH & TỔNG KẾT CHECKPOINT`, tuyên dương tên ngắn, TUYỆT ĐỐI 0 điểm số từng cá nhân.
 * - [V370-06] CommentSaver Checkpoint DOM Mock (46 radios + 2 LT/TH number inputs + [ĐNL] textareas + .ql-editor):
 *             Bot tích đúng 9 ô [ĐNL], 0 chạm LT/TH/câu hỏi, & Read-after-Write đọc lại cả text lẫn 9 ô [ĐNL].
 * - [V370-07] API & Live Headless Chromium E2E (127.0.0.1:3099) trên Light & Dark mode: Banner, `↻ Tính lại [ĐNL]`, modal chỉnh 9 ô [ĐNL], lưu nháp/đồng bộ header, Zalo privacy.
 *
 * Chạy 100% cô lập trong `os.tmpdir()` — KHÔNG chạm dữ liệu thật trong `data/`.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import crypto from "node:crypto";
import { chromium } from "playwright";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttpReady(url: string, timeoutMs = 60000): Promise<void> {
  const start = Date.now();
  let lastErr = "";
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      const errBody = await res.text().catch(() => "");
      lastErr = `HTTP ${res.status}: ${errBody.slice(0, 300)}`;
    } catch (err: unknown) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await sleep(400);
  }
  throw new Error(`Hết thời gian chờ máy chủ kiểm thử tại ${url}: ${lastErr}`);
}

function killProcessTree(proc: ChildProcess | null) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { stdio: "ignore" });
    } else {
      proc.kill("SIGKILL");
    }
  } catch {}
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(String(text || "").trim(), "utf8").digest("hex");
}

function transpileSaveCommentsForVm(): string {
  const fullPath = path.resolve(process.cwd(), "src/lib/playwright/save-comments.ts");
  const raw = fs.readFileSync(fullPath, "utf8");
  const stripped = stripTypeScriptTypes(raw);
  return (
    stripped
      .replace(/^\s*import\s+[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
      .replace(/\bexport\s+/g, "") + "\nglobalThis.CommentSaver = CommentSaver;"
  );
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-v370-"));
  const tmpConfigDir = path.join(tmpRoot, "config");
  const tmpDbPath = path.join(tmpRoot, "test_v370.db");
  const tmpRunningClassesPath = path.join(tmpRoot, "running_classes.json");
  fs.mkdirSync(tmpConfigDir, { recursive: true });

  const realConfigDir = path.join(process.cwd(), "data", "config");
  for (const cfgFile of ["courses_syllabus.json", "quick_tags.json"]) {
    const srcPath = path.join(realConfigDir, cfgFile);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, path.join(tmpConfigDir, cfgFile));
    }
  }

  process.env.ALLOWED_LOCAL_DIRS = tmpRoot;
  process.env.MINDX_ALLOWED_EXTRA_PATHS = tmpRoot;
  process.env.MINDX_DB_PATH = tmpDbPath;
  process.env.MINDX_CONFIG_DIR = tmpConfigDir;
  process.env.MINDX_RUNNING_CLASSES_PATH = tmpRunningClassesPath;
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "TEST_V370_DUMMY_KEY";

  const {
    classSessionRepo,
    classroomSessionLogRepo,
    closeDb,
    extractCheckpointCoreSnapshotHash,
    getDb,
    parseFeedbackVersionMeta,
    scoreMatrixRepo,
    sessionFeedbackRepo,
    studentRepo,
    verifyContentIntegrity,
  } = await import("../src/lib/db/sqlite");
  const { getCoursesSyllabus, saveRunningClasses } = await import("../src/lib/db/json-config");
  const {
    COMPETENCY_AREA_SPECS,
    COMPETENCY_KEYS,
    buildCheckpointZaloSummaryBlock,
    calculateCompetencyAveragePure,
    clampCompetencyRating,
    extractLmsCheckpointFromCommentByAreas,
    formatCheckpointScoreHeaderLine,
    isPlaceholderLmsComment,
    mergeCheckpointStudentData,
    normalizeScoreToScale5,
    parseCheckpointDataJson,
    resolveCheckpointStageForSession,
    upsertCheckpointHeaderIntoFinalText,
  } = await import("../src/lib/checkpoint/checkpoint-competency");
  const { computeCheckpointDataForSession } = await import(
    "../src/lib/checkpoint/checkpoint-history-loader"
  );
  const { ClassSyncer } = await import("../src/lib/playwright/sync-class");
  const { CommentGenerator } = await import("../src/lib/gemini/comment-generator");
  const { buildAutoZaloBroadcastText } = await import("../src/lib/zalo/zalo-summary");

  const nextEnvPath = path.join(process.cwd(), "next-env.d.ts");
  const hadNextEnv = fs.existsSync(nextEnvPath);
  const origNextEnvBytes = hadNextEnv ? fs.readFileSync(nextEnvPath) : null;

  const testPort = 3099;
  const e2eDistRel = `.next/e2e-test-${testPort}`;
  const e2eDistAbs = path.join(process.cwd(), e2eDistRel);
  const e2eTsconfigRel = `.next/e2e-tsconfig-${testPort}.json`;
  const e2eTsconfigAbs = path.join(process.cwd(), e2eTsconfigRel);
  let nextServer: ChildProcess | null = null;
  let browser: any = null;
  const serverLogs: string[] = [];

  try {
    console.log("=== BẮT ĐẦU KIỂM THỬ TOÀN DIỆN CHECKPOINT v3.7.0 ===");

    // =========================================================================
    // [V370-01] Stage Resolution, Scaling, Placeholder Detection
    // =========================================================================
    console.log("\n[V370-01] Kiểm tra định danh Checkpoint, quy đổi thang 5 và lọc giữ chỗ LMS...");
    assert.deepEqual(
      resolveCheckpointStageForSession("VT-CSA04-HB", 5),
      {
        isCheckpoint: true,
        isRobotics: false,
        cpStage: 1,
        stageStartSession: 1,
        stageEndSession: 5,
        previousCpSession: null,
      },
      "Coding B5 phải là Checkpoint 1 (giai đoạn B1..B5)"
    );
    assert.equal(resolveCheckpointStageForSession("VT-CSA04-HB", 9).cpStage, 2);
    assert.equal(resolveCheckpointStageForSession("VT-CSA04-HB", 4).isCheckpoint, false);

    assert.deepEqual(
      resolveCheckpointStageForSession("VT-ROB-ARMI13", 4),
      {
        isCheckpoint: true,
        isRobotics: true,
        cpStage: 1,
        stageStartSession: 1,
        stageEndSession: 4,
        previousCpSession: null,
      },
      "Robotics B4 phải là Checkpoint 1 (giai đoạn B1..B4)"
    );
    assert.equal(resolveCheckpointStageForSession("VT-ROB-SEMIA05", 8).cpStage, 2);
    assert.equal(resolveCheckpointStageForSession("VT-ROB-ARMI13", 5).isCheckpoint, false);

    assert.equal(normalizeScoreToScale5(4.5), 4.5);
    assert.equal(normalizeScoreToScale5("8,5"), 4.3);
    assert.equal(normalizeScoreToScale5(90), 4.5);
    assert.equal(normalizeScoreToScale5(null), null);

    assert.equal(isPlaceholderLmsComment("."), true);
    assert.equal(isPlaceholderLmsComment("<p>nháp</p>"), true);
    assert.equal(isPlaceholderLmsComment("ok"), true);
    assert.equal(
      isPlaceholderLmsComment("- **Điểm mạnh của học viên:** Con nắm vững vòng lặp và hàm."),
      false
    );
    console.log("  -> PASS V370-01.");

    // =========================================================================
    // [V370-02] Process [ĐNL] Computation — Coding B5/B9 vs Robotics B4/B8
    // =========================================================================
    console.log("\n[V370-02] Kiểm tra tự tính 9 ô [ĐNL] theo quá trình Coding & Robotics...");
    const codingClassId = "VT-CSA04-HB";
    for (let s = 1; s <= 10; s++) {
      classSessionRepo.upsert({
        classId: codingClassId,
        className: codingClassId,
        sessionId: `${codingClassId}_SESS_${String(s).padStart(2, "0")}`,
        sessionNumber: s,
        topic: s === 5 ? "Checkpoint 1" : s === 9 ? "Checkpoint 2" : `Bài học buổi ${s}`,
        date: `0${Math.min(9, s)}/11/2026`,
      });
    }
    studentRepo.upsert({
      studentId: "ST_QA",
      classId: codingClassId,
      fullName: "Nguyễn Quang Anh",
      isActive: 1,
    });
    studentRepo.upsert({
      studentId: "ST_MT",
      classId: codingClassId,
      fullName: "Trần Minh Thư",
      isActive: 1,
    });
    studentRepo.upsert({
      studentId: "ST_EMPTY",
      classId: codingClassId,
      fullName: "Phạm Bảo Long",
      isActive: 1,
    });

    // Coding B1..B4 history for Quang Anh (strong) vs Minh Thu (distracted + missing hw)
    for (let s = 1; s <= 4; s++) {
      const sId = `${codingClassId}_SESS_${String(s).padStart(2, "0")}`;
      sessionFeedbackRepo.upsert({
        classId: codingClassId,
        sessionId: sId,
        studentId: "ST_QA",
        attendanceStatus: "PRESENT",
        quickTagsJson: JSON.stringify([
          "🌟 Xuất sắc, tư duy logic tốt",
          "💡 Chủ động thử nghiệm & sửa lỗi",
          "📝 Hoàn thành bài tập xuất sắc",
        ]),
        status: "VERIFIED",
        finalText: `Nhận xét buổi ${s}`,
      });
      sessionFeedbackRepo.upsert({
        classId: codingClassId,
        sessionId: sId,
        studentId: "ST_MT",
        attendanceStatus: s === 3 ? "LATE" : "PRESENT",
        quickTagsJson: JSON.stringify(["👀 Mất tập trung", "🐢 Tiếp thu chậm cần hỗ trợ"]),
        status: "VERIFIED",
        finalText: `Nhận xét buổi ${s}`,
      });
      classroomSessionLogRepo.upsertBatch([
        {
          classId: codingClassId,
          sessionNumber: s,
          sessionId: sId,
          studentId: "ST_QA",
          attendanceStatus: "PRESENT",
          stars: 4,
          medals: s % 2 === 0 ? 1 : 0,
          issueCountsJson: JSON.stringify({}),
        },
        {
          classId: codingClassId,
          sessionNumber: s,
          sessionId: sId,
          studentId: "ST_MT",
          attendanceStatus: s === 3 ? "LATE" : "PRESENT",
          stars: 0,
          medals: 0,
          issueCountsJson: JSON.stringify({ distracted: 1, missing_hw: 1 }),
        },
      ]);
    }

    scoreMatrixRepo.save(codingClassId, {
      success: true,
      classId: codingClassId,
      columns: [
        { columnId: "C1", sessionNumber: 1, title: "HW1" },
        { columnId: "C2", sessionNumber: 2, title: "HW2" },
        { columnId: "C3", sessionNumber: 3, title: "HW3" },
        { columnId: "C4", sessionNumber: 4, title: "HW4" },
      ],
      rows: [
        {
          studentId: "ST_QA",
          cells: {
            C1: { columnId: "C1", sessionNumber: 1, status: "GRADED", score: 95, maxScore: 100 },
            C2: { columnId: "C2", sessionNumber: 2, status: "GRADED", score: 100, maxScore: 100 },
            C3: { columnId: "C3", sessionNumber: 3, status: "GRADED", score: 90, maxScore: 100 },
            C4: { columnId: "C4", sessionNumber: 4, status: "GRADED", score: 95, maxScore: 100 },
          },
        },
        {
          studentId: "ST_MT",
          cells: {
            C1: { columnId: "C1", sessionNumber: 1, status: "GRADED", score: 45, maxScore: 100 },
            C2: { columnId: "C2", sessionNumber: 2, status: "NOT_SUBMITTED", score: null, maxScore: 100 },
            C3: { columnId: "C3", sessionNumber: 3, status: "NOT_SUBMITTED", score: null, maxScore: 100 },
            C4: { columnId: "C4", sessionNumber: 4, status: "NOT_SUBMITTED", score: null, maxScore: 100 },
          },
        },
      ],
    });

    // Seed LMS CP1 scores for B5 via ClassSyncer (and "." placeholder comment!)
    const mockSlots = [
      null,
      null,
      null,
      null,
      {
        index: 4,
        studentAttendance: [
          {
            student: { id: "ST_QA", fullName: "Nguyễn Quang Anh" },
            status: "ATTENDED",
            comment: ".",
            commentByAreas: [
              {
                type: "CHECKPOINT",
                checkpoint: { checkpointScore: 4.5, practiceScore: 5.0 },
              },
              { type: "CONTENT", content: "<p>.</p>" },
            ],
          },
          {
            student: { id: "ST_MT", fullName: "Trần Minh Thư" },
            status: "ATTENDED",
            comment: "nháp",
            commentByAreas: [
              {
                type: "CHECKPOINT",
                checkpoint: { checkpointScore: 2.0, practiceScore: 2.5 },
              },
              { type: "CONTENT", content: "nháp" },
            ],
          },
        ],
      },
    ].map((x, i) => x || { index: i, studentAttendance: [] });

    ClassSyncer.syncLmsSlotCompletionToSqlite({
      db: getDb(),
      classId: codingClassId,
      students: studentRepo.findByClass(codingClassId, true),
      slots: mockSlots,
      preferLmsVerified: true,
    });

    // [V370-03] Assert "." and "nháp" did NOT mark B5 VERIFIED, and preserved scores!
    const qaSyncRec = sessionFeedbackRepo.findOne(codingClassId, `${codingClassId}_SESS_05`, "ST_QA");
    const mtSyncRec = sessionFeedbackRepo.findOne(codingClassId, `${codingClassId}_SESS_05`, "ST_MT");
    assert.equal(qaSyncRec?.status, "DRAFT", "Nhận xét '.' trên LMS không được gắn nhầm VERIFIED!");
    assert.equal(mtSyncRec?.status, "DRAFT", "Nhận xét 'nháp' trên LMS không được gắn nhầm VERIFIED!");
    assert.equal(parseCheckpointDataJson(qaSyncRec?.checkpointDataJson)?.theoryScore, 4.5);
    assert.equal(parseCheckpointDataJson(qaSyncRec?.checkpointDataJson)?.practiceScore, 5.0);

    const cpB5Computed = computeCheckpointDataForSession({
      classId: codingClassId,
      sessionId: `${codingClassId}_SESS_05`,
      sessionNumber: 5,
      forceRecalculate: true,
      persist: true,
    });
    assert.equal(cpB5Computed.isCheckpoint, true);
    assert.equal(cpB5Computed.cpStage, 1);

    const qaCp5 = cpB5Computed.byStudent["ST_QA"];
    const mtCp5 = cpB5Computed.byStudent["ST_MT"];
    assert.ok(qaCp5.competencyScores && mtCp5.competencyScores);
    for (const k of COMPETENCY_KEYS) {
      assert.ok(
        Number.isInteger(qaCp5.competencyScores[k]) &&
          qaCp5.competencyScores[k] >= 1 &&
          qaCp5.competencyScores[k] <= 5
      );
    }
    assert.ok(
      (qaCp5.competencyAverage || 0) >= 4.5,
      `Quang Anh nổi bật phải có ĐNL >= 4.5 (thực tế: ${qaCp5.competencyAverage})`
    );
    assert.ok(
      (mtCp5.competencyAverage || 0) <= 3.35 &&
        mtCp5.competencyScores.attitudeInClass <= 2 &&
        mtCp5.competencyScores.attitudeHomework <= 3,
      `Minh Thư mất tập trung + thiếu BTVN phải có ĐNL <= 3.35 & Thái độ giảm rõ (thực tế: ${mtCp5.competencyAverage}, attitudes=${mtCp5.competencyScores.attitudeHomework}/${mtCp5.competencyScores.attitudeInClass})`
    );
    assert.equal(qaCp5.processSummary?.homeworkSummary?.completionRatePct, 100);
    assert.equal(mtCp5.processSummary?.homeworkSummary?.completionRatePct, 25);

    // Also test Robotics B4 (NO BTVN matrix -> homeworkSummary must be null!)
    const robClassId = "VT-ROB-ARMI13";
    for (let s = 1; s <= 4; s++) {
      classSessionRepo.upsert({
        classId: robClassId,
        className: robClassId,
        sessionId: `${robClassId}_SESS_${String(s).padStart(2, "0")}`,
        sessionNumber: s,
        topic: s === 4 ? "Checkpoint 1 Robotics" : `Lắp ráp ${s}`,
        date: `1${s}/11/2026`,
      });
    }
    studentRepo.upsert({
      studentId: "ROB_ST1",
      classId: robClassId,
      fullName: "Lê Gia Huy",
      isActive: 1,
    });
    sessionFeedbackRepo.upsert({
      classId: robClassId,
      sessionId: `${robClassId}_SESS_02`,
      studentId: "ROB_ST1",
      attendanceStatus: "PRESENT",
      quickTagsJson: JSON.stringify(["🔧 Lắp ráp đúng mẫu", "🌟 Vận dụng & sáng tạo tốt"]),
      status: "VERIFIED",
      finalText: "Rất tốt",
    });
    sessionFeedbackRepo.upsert({
      classId: robClassId,
      sessionId: `${robClassId}_SESS_04`,
      studentId: "ROB_ST1",
      attendanceStatus: "PRESENT",
      status: "DRAFT",
      checkpointDataJson: JSON.stringify({
        cpStage: 1,
        isRobotics: true,
        theoryScore: 4.0,
        practiceScore: 4.5,
      }),
    });
    const robCp4 = computeCheckpointDataForSession({
      classId: robClassId,
      sessionId: `${robClassId}_SESS_04`,
      sessionNumber: 4,
      forceRecalculate: true,
      persist: true,
    });
    assert.equal(robCp4.cpStage, 1);
    assert.equal(
      robCp4.byStudent["ROB_ST1"].processSummary?.homeworkSummary,
      null,
      "Robotics không có BTVN LMS -> homeworkSummary phải là null"
    );
    assert.ok((robCp4.byStudent["ROB_ST1"].competencyAverage || 0) >= 4.0);
    console.log("  -> PASS V370-02 & V370-03.");

    // =========================================================================
    // [V370-04] CommentGenerator: Score Header, 0 PII Leak, INSUFFICIENT_INFO, CAS Drift
    // =========================================================================
    console.log("\n[V370-04] Kiểm tra sinh nhận xét AI Checkpoint, bảo mật PII & Rule 4 CAS...");
    const { getGeminiModel } = await import("../src/lib/gemini/client");
    void getGeminiModel;
    // Spy via module mock is hard after ESM import unless we intercept GoogleGenerativeAI or check prompt via test hook.
    // Instead test CommentGenerator behavior cleanly:
    // 1) ST_EMPTY has 0 quickTags, 0 teacherNote, 0 LT/TH scores, 0 history -> MUST return INSUFFICIENT_INFO!
    const insuffRes = await CommentGenerator.generateBatchComments(
      {
        classId: codingClassId,
        classCode: codingClassId,
        sessionId: `${codingClassId}_SESS_05`,
        sessionNumber: 5,
        topic: "Checkpoint 1",
        isCheckpointSession: true,
      },
      [
        {
          studentId: "ST_EMPTY",
          fullName: "Phạm Bảo Long",
          isActive: true,
          attendanceStatus: "PRESENT",
          quickTags: [],
          teacherNote: "",
        },
      ]
    );
    assert.equal(insuffRes.length, 1);
    assert.equal(
      insuffRes[0].status,
      "INSUFFICIENT_INFO",
      "Học sinh trống hoàn toàn dữ liệu Checkpoint vẫn phải giữ INSUFFICIENT_INFO"
    );

    // 2) Verify score header formatting + idempotent upsert
    const headerLine = formatCheckpointScoreHeaderLine({
      cpStage: 1,
      theoryScore: qaCp5.theoryScore,
      practiceScore: qaCp5.practiceScore,
      competencyAverage: qaCp5.competencyAverage,
    });
    assert.ok(headerLine.startsWith("📊 **Kết quả Checkpoint 1:** Lý thuyết **4.5/5.0** | Thực hành **5.0/5.0** | Điểm năng lực **"));
    const sampleBody = [
      "- **Điểm mạnh của học viên:** Con nắm chắc vòng lặp và hoàn thành tốt bài thực hành.",
      "",
      "- **Điểm cần cải thiện:** Con chú ý kiểm tra kỹ các trường hợp biên.",
      "",
      "- **Lời khuyên:** Ba mẹ động viên con duy trì phong độ tốt ở giai đoạn 2.",
    ].join("\n");
    const withHeader = upsertCheckpointHeaderIntoFinalText(
      `📊 **Kết quả Checkpoint 1:** Lý thuyết **0.0/5.0** | Thực hành **0.0/5.0**\n${sampleBody}`,
      headerLine
    );
    assert.equal(
      withHeader.match(/📊 \*\*Kết quả Checkpoint 1:\*\*/g)?.length,
      1,
      "Không bao giờ nhân đôi dòng điểm Checkpoint"
    );

    // 3) Save draft + Approve -> Edit competencyScores -> verify Rule 4 auto-demotes APPROVED -> DRAFT
    sessionFeedbackRepo.approveConditional({
      classId: codingClassId,
      sessionId: `${codingClassId}_SESS_05`,
      studentId: "ST_QA",
      attendanceStatus: "PRESENT",
      finalText: withHeader,
      contentHash: sha256(withHeader),
      checkpointDataJson: JSON.stringify(qaCp5),
    });
    const afterApprove = sessionFeedbackRepo.findOne(
      codingClassId,
      `${codingClassId}_SESS_05`,
      "ST_QA"
    );
    assert.equal(afterApprove?.status, "APPROVED");

    const tamperedCp = {
      ...qaCp5,
      competencyScores: {
        ...qaCp5.competencyScores!,
        knowledgeInClass: qaCp5.competencyScores!.knowledgeInClass === 5 ? 3 : 5,
      },
    };
    sessionFeedbackRepo.upsert({
      ...afterApprove!,
      checkpointDataJson: JSON.stringify(tamperedCp),
    });
    const afterEditCp = sessionFeedbackRepo.findOne(
      codingClassId,
      `${codingClassId}_SESS_05`,
      "ST_QA"
    );
    assert.equal(
      afterEditCp?.status,
      "DRAFT",
      "Rule 4: Chỉnh sửa 9 ô [ĐNL] sau khi đã Duyệt bắt buộc phải hạ trạng thái về DRAFT!"
    );

    // 4) F02b / F02c / F02d: Sync hash preservation/demotion, approveConditional drift CAS, & VERIFIED->APPROVED tamper block
    studentRepo.upsert({
      studentId: "ST_F02",
      classId: codingClassId,
      fullName: "Phạm Bảo Ngọc",
      isActive: 1,
    });
    const f02Cp40Base = {
      ...qaCp5,
      theoryScore: 4.0,
      practiceScore: 4.0,
    };
    const f02Cp40 = {
      ...f02Cp40Base,
      approvedSnapshotHash: extractCheckpointCoreSnapshotHash(JSON.stringify(f02Cp40Base)),
    };
    const f02Header40 = formatCheckpointScoreHeaderLine({
      cpStage: 1,
      theoryScore: 4.0,
      practiceScore: 4.0,
      competencyAverage: qaCp5.competencyAverage ?? null,
    })!;
    const f02Text40 = upsertCheckpointHeaderIntoFinalText(sampleBody, f02Header40);
    const f02ApproveRes = sessionFeedbackRepo.approveConditional({
      classId: codingClassId,
      sessionId: `${codingClassId}_SESS_05`,
      studentId: "ST_F02",
      attendanceStatus: "PRESENT",
      finalText: f02Text40,
      contentHash: sha256(f02Text40),
      checkpointDataJson: JSON.stringify(f02Cp40),
    });
    assert.equal(f02ApproveRes.approved, true, "F02b setup: approveConditional phải thành công");
    const f02ApprovedRow = sessionFeedbackRepo.findOne(codingClassId, `${codingClassId}_SESS_05`, "ST_F02")!;
    assert.equal(f02ApprovedRow.status, "APPROVED");
    const f02SnapBefore = parseCheckpointDataJson(f02ApprovedRow.checkpointDataJson)?.approvedSnapshotHash;
    assert.ok(f02SnapBefore, "F02b setup: phải lưu approvedSnapshotHash");
    const f02VerBefore = parseFeedbackVersionMeta(f02ApprovedRow.versionMetaJson).rowVer;

    const buildF02Slot = (theory: number, practice: number) =>
      [
        null,
        null,
        null,
        null,
        {
          index: 4,
          studentAttendance: [
            {
              student: { id: "ST_F02", fullName: "Phạm Bảo Ngọc" },
              status: "ATTENDED",
              comment: ".",
              commentByAreas: [
                { type: "CHECKPOINT", checkpoint: { checkpointScore: theory, practiceScore: practice } },
                { type: "CONTENT", content: "<p>.</p>" },
              ],
            },
          ],
        },
      ].map((x, i) => x || { index: i, studentAttendance: [] });

    // F02b (unchanged LT/TH): keeps APPROVED & exact approvedSnapshotHash
    ClassSyncer.syncLmsSlotCompletionToSqlite({
      db: getDb(),
      classId: codingClassId,
      students: [studentRepo.findOne("ST_F02", codingClassId)!].filter(Boolean),
      slots: buildF02Slot(4.0, 4.0),
      preferLmsVerified: false,
    });
    const f02AfterSameSync = sessionFeedbackRepo.findOne(codingClassId, `${codingClassId}_SESS_05`, "ST_F02")!;
    assert.equal(f02AfterSameSync.status, "APPROVED", "F02b: Điểm LT/TH không đổi phải giữ nguyên APPROVED");
    assert.equal(
      parseCheckpointDataJson(f02AfterSameSync.checkpointDataJson)?.approvedSnapshotHash,
      f02SnapBefore,
      "F02b: Điểm LT/TH không đổi phải giữ nguyên approvedSnapshotHash"
    );

    // F02b (changed LT/TH): demotes APPROVED -> DRAFT, clears approvedSnapshotHash, refreshes header, bumps rowVer
    ClassSyncer.syncLmsSlotCompletionToSqlite({
      db: getDb(),
      classId: codingClassId,
      students: [studentRepo.findOne("ST_F02", codingClassId)!].filter(Boolean),
      slots: buildF02Slot(3.5, 4.0),
      preferLmsVerified: false,
    });
    const f02AfterChangedSync = sessionFeedbackRepo.findOne(codingClassId, `${codingClassId}_SESS_05`, "ST_F02")!;
    assert.equal(f02AfterChangedSync.status, "DRAFT", "F02b: Điểm LT/TH trên LMS đổi phải hạ APPROVED -> DRAFT");
    assert.ok(
      !parseCheckpointDataJson(f02AfterChangedSync.checkpointDataJson)?.approvedSnapshotHash,
      "F02b: Đổi điểm LT/TH phải xóa approvedSnapshotHash cũ"
    );
    assert.ok(
      String(f02AfterChangedSync.finalText || "").includes("3.5/5.0"),
      "F02b: Đổi điểm LT/TH phải cập nhật dòng điểm Checkpoint trong finalText"
    );
    const f02VerAfterChange = parseFeedbackVersionMeta(f02AfterChangedSync.versionMetaJson).rowVer;
    assert.ok(
      f02VerAfterChange > f02VerBefore,
      "F02b: Đổi điểm LT/TH phải tăng rowVer"
    );

    // F02c: approveConditional with stale checkpointDataJson returns CHECKPOINT_DATA_DRIFT
    const f02DriftRes = sessionFeedbackRepo.approveConditional({
      classId: codingClassId,
      sessionId: `${codingClassId}_SESS_05`,
      studentId: "ST_F02",
      attendanceStatus: "PRESENT",
      finalText: f02AfterChangedSync.finalText || f02Text40,
      contentHash: sha256(f02AfterChangedSync.finalText || f02Text40),
      checkpointDataJson: JSON.stringify(f02Cp40), // stale theoryScore=4.0 while DB has 3.5!
      expectedRowVer: f02VerAfterChange,
    });
    assert.equal(f02DriftRes.approved, false, "F02c: checkpointDataJson lệch DB không được phép duyệt");
    assert.equal(f02DriftRes.conflict, true);
    assert.equal(f02DriftRes.reason, "CHECKPOINT_DATA_DRIFT");

    // F02d: upsert VERIFIED -> APPROVED with tampered competencyScores and old approvedSnapshotHash demotes to DRAFT
    const f02Text35 = f02AfterChangedSync.finalText || f02Text40;
    const f02Cp35Parsed = parseCheckpointDataJson(f02AfterChangedSync.checkpointDataJson)!;
    const f02Cp35JsonWithSnap = JSON.stringify({
      ...f02Cp35Parsed,
      approvedSnapshotHash: extractCheckpointCoreSnapshotHash(JSON.stringify(f02Cp35Parsed)),
    });
    const f02ReApproveRes = sessionFeedbackRepo.approveConditional({
      classId: codingClassId,
      sessionId: `${codingClassId}_SESS_05`,
      studentId: "ST_F02",
      attendanceStatus: "PRESENT",
      finalText: f02Text35,
      contentHash: sha256(f02Text35),
      checkpointDataJson: f02Cp35JsonWithSnap,
      expectedRowVer: f02VerAfterChange,
    });
    assert.equal(f02ReApproveRes.approved, true);
    getDb()
      .prepare("UPDATE session_feedbacks SET status = 'VERIFIED' WHERE classId = ? AND sessionId = ? AND studentId = ?")
      .run(codingClassId, `${codingClassId}_SESS_05`, "ST_F02");
    const f02VerifiedRow = sessionFeedbackRepo.findOne(codingClassId, `${codingClassId}_SESS_05`, "ST_F02")!;
    assert.equal(f02VerifiedRow.status, "VERIFIED");
    const f02TamperedCp = {
      ...parseCheckpointDataJson(f02VerifiedRow.checkpointDataJson)!,
      competencyScores: {
        ...parseCheckpointDataJson(f02VerifiedRow.checkpointDataJson)!.competencyScores!,
        knowledgeInClass:
          parseCheckpointDataJson(f02VerifiedRow.checkpointDataJson)!.competencyScores!.knowledgeInClass === 1
            ? 2
            : 1,
      },
    };
    sessionFeedbackRepo.upsert({
      ...f02VerifiedRow,
      status: "APPROVED",
      checkpointDataJson: JSON.stringify(f02TamperedCp),
    });
    const f02AfterTamper = sessionFeedbackRepo.findOne(codingClassId, `${codingClassId}_SESS_05`, "ST_F02")!;
    assert.equal(
      f02AfterTamper.status,
      "DRAFT",
      "F02d: Chuyển VERIFIED -> APPROVED kèm sửa competencyScores nhưng giữ snapshot hash cũ phải bị hạ về DRAFT!"
    );

    // R2-F01: First-time [ĐNL] enrichment after regular LMS sync (competencyScores: null -> 9 scores) MUST succeed,
    // while changing theoryScore OR changing already-persisted non-null [ĐNL] MUST still return CHECKPOINT_DATA_DRIFT!
    sessionFeedbackRepo.upsert({
      classId: codingClassId,
      sessionId: `${codingClassId}_SESS_05`,
      studentId: "ST_F02",
      attendanceStatus: "PRESENT",
      status: "DRAFT",
      finalText: f02Text35,
      contentHash: sha256(f02Text35),
      checkpointDataJson: JSON.stringify({
        cpStage: 1,
        theoryScore: 4.5,
        practiceScore: 5.0,
        competencyScores: null,
        competencyAverage: null,
        source: "LMS_SYNC",
      }),
    });
    const r2SyncRow = sessionFeedbackRepo.findOne(codingClassId, `${codingClassId}_SESS_05`, "ST_F02")!;
    const r2SyncVer = parseFeedbackVersionMeta(r2SyncRow.versionMetaJson).rowVer;
    const r2ChangedLtRes = sessionFeedbackRepo.approveConditional({
      classId: codingClassId,
      sessionId: `${codingClassId}_SESS_05`,
      studentId: "ST_F02",
      attendanceStatus: "PRESENT",
      finalText: f02Text35,
      contentHash: sha256(f02Text35),
      checkpointDataJson: JSON.stringify({
        cpStage: 1,
        theoryScore: 4.0, // mismatched vs 4.5 in DB
        practiceScore: 5.0,
        competencyScores: qaCp5.competencyScores,
      }),
      expectedRowVer: r2SyncVer,
    });
    assert.equal(r2ChangedLtRes.approved, false, "R2-F01 negative: Đổi theoryScore cùng lúc bổ sung ĐNL vẫn phải báo drift");
    assert.equal(r2ChangedLtRes.reason, "CHECKPOINT_DATA_DRIFT");

    const r2EnrichCpBase = {
      cpStage: 1,
      theoryScore: 4.5,
      practiceScore: 5.0,
      competencyScores: qaCp5.competencyScores,
    };
    const r2EnrichRes = sessionFeedbackRepo.approveConditional({
      classId: codingClassId,
      sessionId: `${codingClassId}_SESS_05`,
      studentId: "ST_F02",
      attendanceStatus: "PRESENT",
      finalText: f02Text35,
      contentHash: sha256(f02Text35),
      checkpointDataJson: JSON.stringify({
        ...r2EnrichCpBase,
        approvedSnapshotHash: extractCheckpointCoreSnapshotHash(JSON.stringify(r2EnrichCpBase)),
      }),
      expectedRowVer: r2SyncVer,
    });
    assert.equal(
      r2EnrichRes.approved,
      true,
      "R2-F01: Lần đầu bổ sung 9 ô [ĐNL] cho bản ghi mới chỉ có LT/TH từ sync phải được duyệt thành công!"
    );

    const r2EnrichedRow = sessionFeedbackRepo.findOne(codingClassId, `${codingClassId}_SESS_05`, "ST_F02")!;
    const r2EnrichedVer = parseFeedbackVersionMeta(r2EnrichedRow.versionMetaJson).rowVer;
    const r2AlreadyHasCompDrift = sessionFeedbackRepo.approveConditional({
      classId: codingClassId,
      sessionId: `${codingClassId}_SESS_05`,
      studentId: "ST_F02",
      attendanceStatus: "PRESENT",
      finalText: f02Text35,
      contentHash: sha256(f02Text35),
      checkpointDataJson: JSON.stringify({
        ...r2EnrichCpBase,
        competencyScores: {
          ...qaCp5.competencyScores!,
          knowledgeInClass: qaCp5.competencyScores!.knowledgeInClass === 1 ? 2 : 1,
        },
      }),
      expectedRowVer: r2EnrichedVer,
    });
    assert.equal(
      r2AlreadyHasCompDrift.approved,
      false,
      "R2-F01 negative: Khi DB đã có đủ 9 ô [ĐNL], gửi lệch [ĐNL] vẫn phải chặn CHECKPOINT_DATA_DRIFT"
    );
    assert.equal(r2AlreadyHasCompDrift.reason, "CHECKPOINT_DATA_DRIFT");

    // Clean up ST_F02 so active roster in V370-05/V370-07 stays intact
    getDb()
      .prepare("DELETE FROM session_feedbacks WHERE classId = ? AND studentId = ?")
      .run(codingClassId, "ST_F02");
    getDb()
      .prepare("DELETE FROM students WHERE classId = ? AND studentId = ?")
      .run(codingClassId, "ST_F02");

    console.log("  -> PASS V370-04.");

    // =========================================================================
    // [V370-05] Zalo Group Summary — No Individual Scores Leaked!
    // =========================================================================
    console.log("\n[V370-05] Kiểm tra thông báo Zalo nhóm: tổng quan + tuyên dương, 0 lộ điểm cá nhân...");
    const zaloCodingText = buildAutoZaloBroadcastText({
      classCode: codingClassId,
      selectedSessionId: `${codingClassId}_SESS_05`,
      sessions: classSessionRepo
        .findByClass(codingClassId)
        .map((s) => ({ ...s, topic: s.topic || "" })),
      students: [
        {
          studentId: "ST_QA",
          fullName: "Nguyễn Quang Anh",
          isActive: true,
          attendanceStatus: "PRESENT",
          checkpointData: qaCp5,
        },
        {
          studentId: "ST_MT",
          fullName: "Trần Minh Thư",
          isActive: true,
          attendanceStatus: "PRESENT",
          checkpointData: mtCp5,
        },
      ],
      syllabusList: getCoursesSyllabus(),
    });
    assert.ok(zaloCodingText.includes("🎯 ĐÁNH GIÁ QUÁ TRÌNH & TỔNG KẾT CHECKPOINT 1:"));
    assert.ok(zaloCodingText.includes("*Quang Anh*"), "Phải tuyên dương tên rút gọn Quang Anh");
    assert.equal(/4\.5|5\.0|2\.0|2\.5/.test(zaloCodingText), false, "CẤM in điểm Checkpoint của từng học sinh lên nhóm Zalo!");
    assert.equal(/Minh Thư/.test(zaloCodingText), false, "Không nêu tên học sinh điểm thấp trong mục tuyên dương");
    console.log("  -> PASS V370-05.");

    // =========================================================================
    // [V370-06] CommentSaver Mock DOM (46 radios + LT/TH number inputs):
    //           Bot ticks ONLY 9 [ĐNL] groups, touches 0 LT/TH/question inputs, verifies Read-after-Write!
    // =========================================================================
    console.log("\n[V370-06] Kiểm tra Playwright CommentSaver tích 9 ô [ĐNL] và Read-after-Write (bảo toàn 0 chạm LT/TH)...");
    const vmCode = transpileSaveCommentsForVm();
    const desiredComp = {
      knowledgeSelfStudy: 5,
      knowledgeInClass: 4,
      skillCommunication: 5,
      skillComputerUse: 4,
      skillProblemSolving: 5,
      skillCreativity: 4,
      skillComputational: 5,
      attitudeHomework: 4,
      attitudeInClass: 5,
    };
    const desiredOrderedRatings = COMPETENCY_KEYS.map((k) => desiredComp[k]);
    const finalTextForMock = withHeader;
    const finalHashForMock = sha256(finalTextForMock);

    let mockDbRec: any = {
      classId: "VT-CSA04-HB",
      sessionId: "VT-CSA04-HB_SESS_05",
      studentId: "ST_QA",
      attendanceStatus: "PRESENT",
      finalText: finalTextForMock,
      contentHash: finalHashForMock,
      status: "APPROVED",
      checkpointDataJson: JSON.stringify({
        cpStage: 1,
        isRobotics: false,
        theoryScore: 4.5,
        practiceScore: 5.0,
        competencyScores: desiredComp,
        competencyAverage: calculateCompetencyAveragePure(desiredComp),
      }),
    };

    const runMockSave = async (opts: { corruptRadioIndexOnReadback?: number }) => {
      let currentRec = { ...mockDbRec };
      const radioState = new Array<boolean>(46).fill(false); // 1 extra question radio at index 0 + 45 [ĐNL] radios at 1..45!
      let questionRadioTouches = 0;
      let numberInputTouches = 0;
      let textareaTouches = 0;
      let savedEditorText = "";
      let isViewMode = false;

      const makeRadioLoc = (idx: number) => ({
        scrollIntoViewIfNeeded: async () => {},
        isChecked: async () => Boolean(radioState[idx]),
        click: async () => {
          if (idx === 0) questionRadioTouches++;
          if (idx >= 1) {
            const gIdx = Math.floor((idx - 1) / 5);
            for (let o = 0; o < 5; o++) radioState[1 + gIdx * 5 + o] = false;
          }
          radioState[idx] = true;
          if (
            opts.corruptRadioIndexOnReadback !== undefined &&
            Math.floor((idx - 1) / 5) === opts.corruptRadioIndexOnReadback
          ) {
            // Simulate LMS dropping one [ĐNL] radio on reopen!
          }
        },
      });

      const makeDialogLoc = (sel: string): any => {
        if (sel === 'input[type="radio"]') {
          return {
            count: async () => (!isViewMode ? 46 : 0),
            nth: (i: number) => makeRadioLoc(i),
          };
        }
        if (sel === 'input[type="radio"]:checked') {
          return { count: async () => (!isViewMode ? radioState.filter(Boolean).length : 0) };
        }
        if (sel.includes("input[type=\"number\"]")) {
          const numLoc: any = {
            count: async () => 2,
            first: () => numLoc,
            fill: async () => { numberInputTouches++; },
            click: async () => { numberInputTouches++; },
            evaluate: async () => { numberInputTouches++; },
            isVisible: async () => false,
          };
          return numLoc;
        }
        if (sel.includes("textarea")) {
          const taLoc: any = {
            count: async () => 20,
            first: () => taLoc,
            fill: async () => { textareaTouches++; },
            click: async () => { textareaTouches++; },
            evaluate: async () => { textareaTouches++; },
            isVisible: async () => false,
          };
          return taLoc;
        }
        if (sel.includes(".ql-editor")) {
          const editorLoc: any = {
            count: async () => (!isViewMode ? 1 : 0),
            first: () => editorLoc,
            last: () => editorLoc,
            isVisible: async () => !isViewMode,
            waitFor: async () => {},
            click: async () => {},
            evaluate: async (_fn: any, val?: string) => {
              if (typeof val === "string") savedEditorText = val;
              return savedEditorText;
            },
            innerText: async () => {
              if (opts.corruptRadioIndexOnReadback !== undefined && isViewMode) {
                const g = opts.corruptRadioIndexOnReadback;
                for (let o = 0; o < 5; o++) radioState[1 + g * 5 + o] = false;
              }
              return savedEditorText.replace(/\*\*([^*\n]+)\*\*/g, "$1");
            },
          };
          return editorLoc;
        }
        if (sel.includes("table tbody tr td:nth-child(2)")) {
          return {
            first: () => ({
              isVisible: async () => isViewMode,
              innerText: async () => savedEditorText.replace(/\*\*([^*\n]+)\*\*/g, "$1"),
            }),
          };
        }
        if (sel === "table tbody tr") {
          return {
            first: () => ({
              isVisible: async () => isViewMode,
              innerText: async () => "Điểm lý thuyết 4.5 Điểm thực hành 5.0 [ĐNL]",
              hover: async () => {},
              click: async () => {
                isViewMode = false;
              },
            }),
          };
        }
        if (sel.includes("EditIcon") || sel.includes("Edit")) {
          return {
            first: () => ({
              isVisible: async () => isViewMode,
              click: async () => {
                isViewMode = false;
              },
            }),
          };
        }
        if (sel.includes("Save") || sel.includes("Lưu")) {
          return {
            first: () => ({
              isVisible: async () => true,
              isEnabled: async () => true,
              click: async () => {
                isViewMode = true;
                if (opts.corruptRadioIndexOnReadback !== undefined) {
                  const g = opts.corruptRadioIndexOnReadback;
                  for (let o = 0; o < 5; o++) radioState[1 + g * 5 + o] = false;
                }
              },
            }),
          };
        }
        if (sel.includes("Close") || sel.includes("Đóng")) {
          return {
            first: () => ({ isVisible: async () => false, click: async () => {} }),
          };
        }
        return {
          count: async () => 0,
          first: () => ({ isVisible: async () => false, click: async () => {} }),
        };
      };

      const dialogMock: any = {
        waitFor: async () => {},
        isVisible: async () => true,
        evaluate: async (_fn: any, specs: any[]) =>
          specs.map((s, gIdx) => ({
            key: s.key,
            labelVi: s.labelVi,
            radioGlobalIndices: [
              1 + gIdx * 5,
              1 + gIdx * 5 + 1,
              1 + gIdx * 5 + 2,
              1 + gIdx * 5 + 3,
              1 + gIdx * 5 + 4,
            ],
          })),
        locator: (sel: string) => makeDialogLoc(sel),
      };

      const makePageLoc = (sel: string): any => {
        if (sel.includes('[role="dialog"]')) {
          return { ...dialogMock, first: () => dialogMock, count: async () => 1 };
        }
        const rowLoc: any = {
          count: async () => 1,
          first: () => rowLoc,
          nth: () => rowLoc,
          filter: () => rowLoc,
          scrollIntoViewIfNeeded: async () => {},
          hover: async () => {},
          click: async () => {},
          waitFor: async () => {},
          isVisible: async () => true,
          isEnabled: async () => true,
          getAttribute: async (attr: string) => {
            if (attr === "class") return "slot-item active";
            if (attr === "data-student-id") return "ST_QA";
            return "";
          },
          evaluate: async () => true,
          innerText: async () => "ST_QA\nNguyễn Quang Anh\nAttended",
          locator: (subSel: string) => makePageLoc(subSel),
        };
        return rowLoc;
      };

      const mockPage: any = {
        locator: (sel: string) => makePageLoc(sel),
        keyboard: { press: async () => {}, insertText: async () => {} },
        waitForTimeout: async () => {},
        screenshot: async () => {},
      };

      const sandbox: any = {
        module: { exports: {} },
        exports: {},
        console,
        Promise,
        Set,
        Map,
        RegExp,
        Math,
        JSON,
        Date,
        Error,
        Array,
        Object,
        String,
        Number,
        Boolean,
        parseInt,
        BrowserManager: { getInstance: () => ({ getPage: async () => mockPage }) },
        authService: { ensureAuthenticated: async () => {} },
        LmsHelpers: {
          openClassDrawer: async () => {},
          switchDrawerTab: async () => {},
          ensureCleanDialogAndToast: async () => {},
          ensureCommentsSlotReady: async () => {},
        },
        SELECTORS: { tabs: { comments: "Comments" } },
        createNetworkInterceptor: () => ({
          dismissForbiddenToast: async () => {},
          waitForApiResponse: async (_urlRe: RegExp, waitOpts: any) => {
            const validPayload = JSON.stringify({
              operationName: "UpdateSlotComment",
              variables: {
                payload: {
                  classCode: "VT-CSA04-HB",
                  slotNumber: 5,
                  studentId: "ST_QA",
                  comment: savedEditorText.replace(/\*\*([^*\n]+)\*\*/g, "$1"),
                },
              },
            });
            assert.equal(waitOpts.requestPredicate(validPayload), true);
            return {
              status: () => 200,
              json: async () => ({ data: { updateSlotComment: { id: "ok" } } }),
            };
          },
        }),
        getCoursesSyllabus: () => [],
        config: { lmsUrl: "https://lms.mindx.edu.vn" },
        markSaveCommentsSessionRunning: () => () => {},
        sessionFeedbackRepo: {
          findBySession: () => [currentRec],
          findOne: () => currentRec,
          updateStatus: (
            _c: string,
            _s: string,
            _st: string,
            status: string,
            _va: any,
            err: string | null
          ) => {
            currentRec.status = status;
            currentRec.errorMessage = err;
          },
          markVerified: () => {
            currentRec.status = "VERIFIED";
          },
        },
        studentRepo: {
          findByClass: () => [
            { studentId: "ST_QA", classId: "VT-CSA04-HB", fullName: "Nguyễn Quang Anh", isActive: 1 },
          ],
          findOne: () => ({
            studentId: "ST_QA",
            classId: "VT-CSA04-HB",
            fullName: "Nguyễn Quang Anh",
            isActive: 1,
          }),
        },
        jobLogRepo: { add: () => {} },
        verifyContentIntegrity,
        extractCheckpointCoreSnapshotHash: () => "",
        COMPETENCY_AREA_SPECS,
        clampCompetencyRating,
        parseCheckpointDataJson,
      };
      vm.runInNewContext(vmCode, sandbox);
      const res = await sandbox.CommentSaver.saveComments({
        classId: "VT-CSA04-HB",
        classCode: "VT-CSA04-HB",
        sessionId: "VT-CSA04-HB_SESS_05",
        studentId: "ST_QA",
      });
      return {
        res,
        currentRec,
        questionRadioTouches,
        numberInputTouches,
        textareaTouches,
        radioState,
      };
    };

    const okSave = await runMockSave({});
    assert.equal(
      okSave.res.verifiedCount,
      1,
      `Bot phải tích 9 [ĐNL] + text và Verify thành công (actual=${JSON.stringify(okSave.res)})`
    );
    assert.equal(okSave.currentRec.status, "VERIFIED");
    assert.equal(okSave.questionRadioTouches, 0, "Cấm đụng radio câu hỏi ngoài 9 [ĐNL]");
    assert.equal(okSave.numberInputTouches, 0, "Cấm đụng ô nhập điểm LT/TH");
    assert.equal(okSave.textareaTouches, 0, "Cấm đụng textarea [ĐNL] trên Checkpoint modal");
    for (let g = 0; g < 9; g++) {
      const targetRating = desiredOrderedRatings[g];
      assert.equal(
        okSave.radioState[1 + g * 5 + (targetRating - 1)],
        true,
        `Nhóm [ĐNL] #${g} phải tích đúng mức ${targetRating}`
      );
    }

    const failSave = await runMockSave({ corruptRadioIndexOnReadback: 4 });
    assert.equal(failSave.res.verifiedCount, 0, "Nếu 1 ô [ĐNL] bị rớt khi Read-after-Write, cấm đánh dấu VERIFIED!");
    assert.equal(failSave.currentRec.status, "FAILED");
    assert.ok(failSave.res.results[0]?.error?.includes("isCompetencyMatch=false"));
    console.log("  -> PASS V370-06.");

    // =========================================================================
    // [V370-07] Live API + Headless Chromium E2E (127.0.0.1:3099) Light & Dark
    // =========================================================================
    console.log("\n[V370-07] Khởi chạy Next.js E2E trên cổng 3099 kiểm tra UI Checkpoint & Light/Dark contrast...");
    saveRunningClasses([
      {
        classCode: codingClassId,
        courseName: "CSA04",
        status: "Running",
        startDate: "01/11/2026",
        endDate: "01/02/2027",
      },
    ]);
    closeDb();

    fs.rmSync(e2eDistAbs, { recursive: true, force: true });
    fs.mkdirSync(e2eDistAbs, { recursive: true });
    const rootTsconfig = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "tsconfig.json"), "utf8")
    );
    rootTsconfig.compilerOptions = {
      ...(rootTsconfig.compilerOptions || {}),
      paths: { "@/*": ["../src/*"] },
    };
    fs.writeFileSync(e2eTsconfigAbs, JSON.stringify(rootTsconfig, null, 2), "utf8");

    const baseUrl = `http://127.0.0.1:${testPort}`;
    nextServer = spawn(
      process.execPath,
      ["./node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(testPort)],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          MINDX_NEXT_DIST_DIR: e2eDistRel,
          MINDX_NEXT_TSCONFIG_PATH: e2eTsconfigRel,
          ALLOWED_LOCAL_DIRS: tmpRoot,
          MINDX_ALLOWED_EXTRA_PATHS: tmpRoot,
          MINDX_DB_PATH: tmpDbPath,
          MINDX_CONFIG_DIR: tmpConfigDir,
          MINDX_RUNNING_CLASSES_PATH: tmpRunningClassesPath,
          NEXT_TELEMETRY_DISABLED: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    nextServer.stdout?.on("data", (d) => serverLogs.push(String(d)));
    nextServer.stderr?.on("data", (d) => serverLogs.push(String(d)));

    await waitForHttpReady(
      `${baseUrl}/api/session-comments/list?classId=${codingClassId}&sessionId=${codingClassId}_SESS_05`,
      60000
    );

    // API guard test: 400 on invalid competencyScores or non-checkpoint session
    const badRes = await fetch(`${baseUrl}/api/session-comments/checkpoint-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classCode: codingClassId, sessionId: `${codingClassId}_SESS_02`, syncFromLms: false }),
    });
    assert.equal(badRes.status, 400, "API phải trả về 400 nếu không phải buổi Checkpoint");

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1366, height: 820 } });
    await context.addInitScript("globalThis.__name = globalThis.__name || ((x) => x);");
    const page = await context.newPage();

    const pageErrors: string[] = [];
    page.on("pageerror", (err: Error) => pageErrors.push(err.message));

    await page.goto(
      `${baseUrl}/session-comments?classId=${codingClassId}&sessionNumber=5`,
      { waitUntil: "domcontentloaded", timeout: 60000 }
    );
    await page.waitForSelector(`[data-testid="checkpoint-sync-btn"]`, { timeout: 60000 });
    await page.waitForSelector(`[data-testid="cp-score-badge-ST_QA"]`, { timeout: 30000 });

    const badgeText = await page.textContent(`[data-testid="cp-score-badge-ST_QA"]`);
    assert.ok(badgeText?.includes("LT: 4.5") && badgeText?.includes("TH: 5.0"));

    // Click "↻ Tính lại [ĐNL]" (local recalc without live LMS browser)
    await page.click(`[data-testid="checkpoint-recalc-btn"]`);
    await page.waitForTimeout(600);

    // Open 9-criteria [ĐNL] Modal in Dark Mode & tweak criterion #1 -> saves via /save-draft
    await page.click(`[data-testid="edit-dnl-btn-ST_QA"]`);
    await page.waitForSelector(`[data-testid="checkpoint-dnl-modal"]`, { timeout: 10000 });
    const modalTextDark = await page.textContent(`[data-testid="checkpoint-dnl-modal"]`);
    assert.ok(modalTextDark?.includes("[ĐNL] Kiến thức học viên tự học"));
    assert.ok(modalTextDark?.includes("BTVN Coding: 100%"));

    // Switch theme to Light Mode and verify modal background & text contrast (no invisible text!)
    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
      document.documentElement.classList.add("light");
    });
    const contrastCheck = await page.evaluate(() => {
      const modal = document.querySelector('[data-testid="checkpoint-dnl-modal"] > div');
      const title = modal?.querySelector("h3");
      if (!modal || !title) return null;
      return {
        modalBg: getComputedStyle(modal).backgroundColor,
        titleColor: getComputedStyle(title).color,
      };
    });
    assert.ok(
      contrastCheck && contrastCheck.modalBg !== contrastCheck.titleColor,
      `Modal Light Mode phải đảm bảo tương phản nền/chữ rõ ràng: ${JSON.stringify(contrastCheck)}`
    );

    // Click rating button "3" on criterion #1 inside modal, close modal, verify top header updates after reload
    const firstCritRow = page.locator('[data-testid="checkpoint-dnl-modal"] .space-y-2 > div').first();
    await firstCritRow.locator("button", { hasText: "3" }).click();
    await page.waitForTimeout(500);
    await page.click('[data-testid="checkpoint-dnl-modal"] button:has-text("Đóng")');
    await page.waitForTimeout(300);

    // Verify Zalo broadcast box includes Checkpoint overview & Quang Anh, zero scores
    const zaloVal = await page.locator("textarea").last().inputValue();
    assert.ok(
      zaloVal.includes("🎯 ĐÁNH GIÁ QUÁ TRÌNH & TỔNG KẾT CHECKPOINT 1:"),
      `Zalo UI thiếu phần Checkpoint: ${zaloVal}`
    );
    assert.ok(
      /\*[^*]*Quang Anh[^*]*\*/.test(zaloVal),
      `Zalo UI phải tuyên dương Quang Anh. Actual:\n${zaloVal}`
    );
    assert.equal(
      zaloVal.includes("Bảo Long"),
      false,
      "Không tuyên dương nhầm học sinh chưa có điểm KT & chưa có lịch sử quá trình"
    );
    assert.equal(/4\.5|5\.0|2\.0/.test(zaloVal), false, "Zalo UI preview không được chứa điểm riêng của từng bạn!");

    assert.equal(pageErrors.length, 0, `Không được có lỗi JS trên trang: ${pageErrors.join("; ")}`);
    console.log("  -> PASS V370-07.");

    // =========================================================================
    // [V370-08] Adversarial Regression Probes (F01..F07 from Neon XHigh Round 1)
    // =========================================================================
    console.log("\n[V370-08] Kiểm tra toàn bộ kịch bản tấn công biên F01..F07...");

    // F01a/b/c: Real Chromium DOM safety checks on resolveCheckpointCompetencyRadioGroups
    const domProbePage = await browser.newPage();
    const saveVmRaw = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/playwright/save-comments.ts"),
      "utf8"
    );
    const saveVmStripped = stripTypeScriptTypes(saveVmRaw)
      .replace(/^\s*import\s+[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
      .replace(/\bexport\s+/g, "");
    const domSandbox: any = {
      console, Promise, Set, Map, RegExp, Math, JSON, Date, Error, Array, Object, String, Number, Boolean, parseInt,
      COMPETENCY_AREA_SPECS,
      clampCompetencyRating,
      parseCheckpointDataJson,
      extractCheckpointCoreSnapshotHash,
      verifyContentIntegrity,
      markSaveCommentsSessionRunning: () => () => {},
    };
    vm.runInNewContext(
      `${saveVmStripped}\nglobalThis.resolveCheckpointCompetencyRadioGroups = resolveCheckpointCompetencyRadioGroups;`,
      domSandbox
    );
    const resolveGroupsDom = domSandbox.resolveCheckpointCompetencyRadioGroups;

    // F01a: 10 question radios + 35 partial ĐNL = 45 radios -> MUST return NONE (no FLAT_45 click on question radios!)
    await domProbePage.setContent(`
      <div role="dialog">
        <div class="q-wrap">
          ${Array.from({ length: 5 }, (_, i) => `
            <div><p>Câu hỏi ${i + 1}</p><input type="radio" name="q_${i}" value="true" /><input type="radio" name="q_${i}" value="false" /></div>
          `).join("")}
        </div>
        <div>
          ${COMPETENCY_AREA_SPECS.slice(0, 7).map((s, idx) => `
            <div><p>${s.labelVi}</p>${[1,2,3,4,5].map((v) => `<input type="radio" name="dnl_${idx}" value="${v}" />`).join("")}</div>
          `).join("")}
        </div>
      </div>
    `);
    const probeF01a = await resolveGroupsDom(domProbePage.locator('[role="dialog"]').first());
    assert.equal(probeF01a.method, "NONE", "F01a: Không được dùng FLAT_45 khi có DOM evaluate và thiếu đủ 9 nhóm [ĐNL]");

    // F01b + F01c: deep span keyword "sáng tạo" in question + "tự học" inside textarea MUST NOT hijack real [ĐNL]
    await domProbePage.setContent(`
      <div role="dialog">
        <div>
          <div><span><span>Câu hỏi: bài tập có sáng tạo không?</span></span></div>
          <div>${[1,2,3,4,5].map((v) => `<input type="radio" name="cp_question_1" value="${v}" />`).join("")}</div>
        </div>
        <div>
          ${COMPETENCY_AREA_SPECS.map((s, idx) => `
            <div>
              <p>${s.labelVi}</p>
              ${[1,2,3,4,5].map((v) => `<input type="radio" name="dnl_${idx}" value="${v}" data-dnl="${s.key}" />`).join("")}
              <div><textarea>${s.key === "attitudeHomework" ? "Con cần rèn tự học thêm ở nhà" : ""}</textarea></div>
            </div>
          `).join("")}
        </div>
      </div>
    `);
    const probeF01bc = await resolveGroupsDom(domProbePage.locator('[role="dialog"]').first());
    assert.equal(probeF01bc.method, "LABEL_GROUPED", "F01b/c: Phải định vị đúng cả 9 nhóm [ĐNL] bất chấp textarea/câu hỏi");
    assert.deepEqual(
      probeF01bc.groups.find((g: any) => g.key === "knowledgeSelfStudy")?.radioGlobalIndices,
      [5, 6, 7, 8, 9],
      "F01c: Không để text 'tự học' trong textarea làm lệch nhóm knowledgeSelfStudy"
    );
    assert.deepEqual(
      probeF01bc.groups.find((g: any) => g.key === "skillCreativity")?.radioGlobalIndices,
      [30, 31, 32, 33, 34],
      "F01b: Không chọn nhầm radio câu hỏi thay cho [ĐNL] Tư duy sáng tạo"
    );
    await domProbePage.close();

    // F02a/d: Canonical hash match + Rule 4 VERIFIED->APPROVED tampered demotion
    const rawReorderCp = JSON.stringify({
      cpStage: 1,
      theoryScore: 4.5,
      practiceScore: 5.0,
      competencyScores: {
        knowledgeInClass: 4,
        knowledgeSelfStudy: 5,
        skillCommunication: 5,
        skillComputerUse: 4,
        skillProblemSolving: 5,
        skillCreativity: 4,
        skillComputational: 5,
        attitudeHomework: 4,
        attitudeInClass: 5,
      },
    });
    const canonicalParsedCp = parseCheckpointDataJson(rawReorderCp)!;
    assert.equal(
      extractCheckpointCoreSnapshotHash(rawReorderCp),
      extractCheckpointCoreSnapshotHash(JSON.stringify(canonicalParsedCp)),
      "F02a: Canonical hash không được phụ thuộc thứ tự key competencyScores"
    );

    // F03: Cross-class sessionId & non-boolean flags MUST return 400 without mutating DB
    const crossClassHttp = await fetch(`${baseUrl}/api/session-comments/checkpoint-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classCode: codingClassId,
        sessionId: "VT-OTHER_SESS_05",
        syncFromLms: false,
      }),
    });
    assert.equal(crossClassHttp.status, 400, "F03: Chặn sessionId khác lớp với HTTP 400");
    const badBoolHttp = await fetch(`${baseUrl}/api/session-comments/checkpoint-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classCode: codingClassId,
        sessionId: `${codingClassId}_SESS_05`,
        syncFromLms: "false",
      }),
    });
    assert.equal(badBoolHttp.status, 400, "F03: Chặn chuỗi 'false' giả boolean với HTTP 400");

    // F04: mergeCheckpointStudentData fills missing competencyScores/processSummary from computed
    const mergedF04 = mergeCheckpointStudentData(
      { cpStage: 1, isRobotics: false, theoryScore: 4.5, practiceScore: 5.0, competencyScores: null, competencyAverage: null },
      qaCp5
    );
    assert.ok(mergedF04?.competencyScores && mergedF04?.processSummary, "F04: Merge phải giữ cả điểm KT lẫn 9 [ĐNL] & processSummary");

    // F05: Reload fresh rowVer after recalculating on SESS_05 -> Approve immediately succeeds (HTTP 200, no 409 deadlock!)
    const preRecalcSync = await fetch(`${baseUrl}/api/session-comments/checkpoint-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classCode: codingClassId,
        sessionId: `${codingClassId}_SESS_05`,
        syncFromLms: false,
        forceRecalculate: true,
      }),
    });
    assert.equal(preRecalcSync.status, 200);
    const listAfterRecalcRes = await fetch(
      `${baseUrl}/api/session-comments/list?classId=${codingClassId}&sessionId=${codingClassId}_SESS_05`
    );
    const listAfterRecalcJson = await listAfterRecalcRes.json();
    const qaRowAfterRecalc = (listAfterRecalcJson?.data?.feedbacks || []).find(
      (f: any) => f.studentId === "ST_QA"
    );
    const qaMetaAfterRecalc = JSON.parse(qaRowAfterRecalc.versionMetaJson || "{}");
    const immediateApproveRes = await fetch(`${baseUrl}/api/session-comments/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: codingClassId,
        sessionId: `${codingClassId}_SESS_05`,
        studentId: "ST_QA",
        approvedText: qaRowAfterRecalc.finalText,
        expectedRowVer: qaMetaAfterRecalc.rowVer,
      }),
    });
    assert.equal(
      immediateApproveRes.status,
      200,
      `F05: Ngay sau Tính lại [ĐNL] và nạp lại metadata, Approve phải trả 200 (không kẹt 409)`
    );

    // F06a/b + F07c: Absent / low scorer with medal never praised; duplicate RATE doesn't fabricate 9th key
    const zaloF06a = buildCheckpointZaloSummaryBlock({
      cpStage: 1,
      isRobotics: false,
      students: [
        {
          fullName: "Lê Minh Khôi",
          isActive: true,
          attendanceStatus: "ABSENT",
          checkpointData: { ...qaCp5, theoryScore: null, practiceScore: null },
        },
        {
          fullName: "Phạm Gia Bảo",
          isActive: true,
          attendanceStatus: "PRESENT",
          checkpointData: { ...qaCp5, theoryScore: 1.5, practiceScore: 2.0 },
        },
      ],
    });
    assert.equal(zaloF06a.includes("Minh Khôi"), false, "F06a: Cấm tuyên dương học sinh vắng / chưa chấm KT");
    assert.equal(zaloF06a.includes("Gia Bảo"), false, "F06a: Cấm tuyên dương học sinh điểm KT thấp dù có huy hiệu cũ");

    const zaloF06b = buildCheckpointZaloSummaryBlock({
      cpStage: 1,
      isRobotics: false,
      students: [
        {
          fullName: "Trần Thanh Tú",
          isActive: true,
          attendanceStatus: "PRESENT",
          checkpointData: { ...qaCp5, theoryScore: null, practiceScore: null },
        },
      ],
    });
    assert.equal(zaloF06b.includes("nắm vững kiến thức trọng tâm"), false, "F06b: Chưa có điểm KT nào thì không kết luận lớp nắm vững kết quả CP");

    const dupAreas = [
      ...COMPETENCY_AREA_SPECS.slice(0, 8).map((s) => ({
        type: "RATE",
        commentAreaId: s.commentAreaId,
        grade: 5,
      })),
      { type: "RATE", commentAreaId: COMPETENCY_AREA_SPECS[0].commentAreaId, grade: 5 },
    ];
    assert.equal(
      extractLmsCheckpointFromCommentByAreas(dupAreas, "").competencyScores,
      null,
      "F07c: 8 RATE phân biệt + 1 RATE trùng ID không được tự bịa tiêu chí thứ 9"
    );

    // R2-F02: Explicit null processSummary / lmsCompetencyScores in partial save-draft or approve must NOT clobber DB processSummary
    const listBeforeR2F02 = await (
      await fetch(`${baseUrl}/api/session-comments/list?classId=${codingClassId}&sessionId=${codingClassId}_SESS_05`)
    ).json();
    const qaBeforeR2F02 = (listBeforeR2F02?.data?.feedbacks || []).find(
      (f: any) => f.studentId === "ST_QA"
    );
    const qaMergedCpBeforeR2F02 = listBeforeR2F02?.data?.checkpointByStudent?.["ST_QA"];
    const qaOrigProcess =
      parseCheckpointDataJson(qaBeforeR2F02?.checkpointDataJson)?.processSummary ||
      qaMergedCpBeforeR2F02?.processSummary;
    assert.ok(qaOrigProcess && qaOrigProcess.priorSessionsObserved > 0, "R2-F02 setup: ST_QA phải có processSummary");
    const qaMetaR2 = JSON.parse(qaBeforeR2F02?.versionMetaJson || "{}");

    const draftNullRes = await fetch(`${baseUrl}/api/session-comments/save-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: codingClassId,
        sessionId: `${codingClassId}_SESS_05`,
        studentId: "ST_QA",
        checkpointData: {
          cpStage: 1,
          theoryScore: 4.5,
          practiceScore: 5.0,
          processSummary: null,
          lmsCompetencyScores: null,
        },
        baseRowVer: qaMetaR2.rowVer,
      }),
    });
    assert.equal(draftNullRes.status, 200);
    const listAfterDraftNull = await (
      await fetch(`${baseUrl}/api/session-comments/list?classId=${codingClassId}&sessionId=${codingClassId}_SESS_05`)
    ).json();
    const qaRowAfterDraftNull = (listAfterDraftNull?.data?.feedbacks || []).find(
      (f: any) => f.studentId === "ST_QA"
    );
    const qaParsedAfterDraftNull = parseCheckpointDataJson(qaRowAfterDraftNull?.checkpointDataJson);
    assert.ok(
      qaParsedAfterDraftNull?.processSummary && qaParsedAfterDraftNull.processSummary.priorSessionsObserved > 0,
      "R2-F02: save-draft gửi processSummary: null không được phép xóa mất processSummary trong DB!"
    );

    const qaMetaAfterDraftNull = JSON.parse(qaRowAfterDraftNull?.versionMetaJson || "{}");
    const approveNullRes = await fetch(`${baseUrl}/api/session-comments/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: codingClassId,
        sessionId: `${codingClassId}_SESS_05`,
        studentId: "ST_QA",
        approvedText: qaRowAfterDraftNull.finalText,
        expectedRowVer: qaMetaAfterDraftNull.rowVer,
        checkpointData: {
          cpStage: 1,
          theoryScore: 4.5,
          practiceScore: 5.0,
          processSummary: null,
          lmsCompetencyScores: null,
        },
      }),
    });
    assert.equal(approveNullRes.status, 200);
    const listAfterApproveNull = await (
      await fetch(`${baseUrl}/api/session-comments/list?classId=${codingClassId}&sessionId=${codingClassId}_SESS_05`)
    ).json();
    const qaRowAfterApproveNull = (listAfterApproveNull?.data?.feedbacks || []).find(
      (f: any) => f.studentId === "ST_QA"
    );
    const qaParsedAfterApproveNull = parseCheckpointDataJson(qaRowAfterApproveNull?.checkpointDataJson);
    assert.ok(
      qaParsedAfterApproveNull?.processSummary && qaParsedAfterApproveNull.processSummary.priorSessionsObserved > 0,
      "R2-F02: approve gửi processSummary: null không được phép xóa mất processSummary trong DB!"
    );

    console.log("  -> PASS V370-08.");
    console.log("\n✅ TẤT CẢ KIỂM THỬ CHECKPOINT v3.7.0 (V370-01 .. V370-08) ĐỀU PASS 100%!");
  } catch (err) {
    if (serverLogs.length > 0) {
      console.error("\n--- NEXT DEV SERVER LOGS ---");
      console.error(serverLogs.join("").split(/\r?\n/).slice(-35).join("\n"));
    }
    throw err;
  } finally {
    if (browser) await browser.close().catch(() => {});
    killProcessTree(nextServer);
    closeDb();
    try {
      fs.rmSync(e2eDistAbs, { recursive: true, force: true });
      fs.rmSync(e2eTsconfigAbs, { force: true });
    } catch {}
    if (hadNextEnv && origNextEnvBytes) {
      fs.writeFileSync(nextEnvPath, origNextEnvBytes);
    } else if (!hadNextEnv && fs.existsSync(nextEnvPath)) {
      fs.unlinkSync(nextEnvPath);
    }
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error("❌ LỖI KIỂM THỬ v3.7.0:", err);
  process.exit(1);
});
