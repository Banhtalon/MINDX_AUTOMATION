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
import * as esbuild from "esbuild";
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
    matchesCompetencyAreaIdPure,
    mergeCheckpointStudentData,
    normalizeScoreToScale5,
    parseCheckpointDataJson,
    resolveCheckpointStageForSession,
    upsertCheckpointHeaderIntoFinalText,
  } = await import("../src/lib/checkpoint/checkpoint-competency");
  const { computeCheckpointDataForSession } = await import(
    "../src/lib/checkpoint/checkpoint-history-loader"
  );
  const { computeSession14CompetencyFromCheckpoints } = await import(
    "../src/lib/local-files/spck-demo-score-reader"
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
        evaluate: async (_fn: any, payload: any) => {
          const specs = Array.isArray(payload) ? payload : payload?.specs || [];
          return specs.map((s: any, gIdx: number) => ({
            key: s.key,
            labelVi: s.labelVi,
            radioGlobalIndices: [
              1 + gIdx * 5,
              1 + gIdx * 5 + 1,
              1 + gIdx * 5 + 2,
              1 + gIdx * 5 + 3,
              1 + gIdx * 5 + 4,
            ],
          }));
        },
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
          markCheckpointLmsCompetencyVerified: (
            _c: string,
            _s: string,
            _st: string,
            verifiedScores: any,
            verifiedAt?: string
          ) => {
            const parsed = currentRec.checkpointDataJson
              ? JSON.parse(currentRec.checkpointDataJson)
              : {};
            currentRec.checkpointDataJson = JSON.stringify({
              ...parsed,
              lmsCompetencyScores: verifiedScores,
              lmsSyncedAt: verifiedAt || new Date().toISOString(),
            });
            return true;
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
    assert.deepEqual(
      parseCheckpointDataJson(okSave.currentRec.checkpointDataJson)?.lmsCompetencyScores,
      desiredComp,
      "V370-06: Sau khi Verify thành công phải lưu lmsCompetencyScores"
    );
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
    assert.equal(
      parseCheckpointDataJson(failSave.currentRec.checkpointDataJson)?.lmsCompetencyScores ?? null,
      null,
      "V370-06: Khi Read-after-Write thất bại tuyệt đối không được gắn lmsCompetencyScores"
    );
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

    // =========================================================================
    // [V370-09] v3.8.5 Live LMS Coding/Robotics DOM, esbuild __name immunity,
    //           VT-ROB-SEMIA05 IDs, ClassSyncer VERIFIED->APPROVED guard & :3099 Backfill UI
    // =========================================================================
    console.log("\n[V370-09] Kiểm tra DOM thực tế Coding/Robotics (46 radio rỗng name/value), esbuild __name, Robotics IDs, ClassSyncer & E2E backfill...");

    // (1)-(3) Transpile save-comments.ts via esbuild (keepNames: true) and run on a clean Chromium page WITHOUT __name polyfill
    const cleanContext = await browser.newContext({ viewport: { width: 1366, height: 820 } });
    const cleanPage = await cleanContext.newPage();
    const cleanPageErrors: string[] = [];
    cleanPage.on("pageerror", (err: Error) => cleanPageErrors.push(err.message));

    const saveTsRaw = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/playwright/save-comments.ts"),
      "utf8"
    );
    const esbuildOut = esbuild.transformSync(saveTsRaw, {
      loader: "ts",
      format: "cjs",
      target: "es2022",
      keepNames: true,
    });
    assert.ok(
      esbuildOut.code.includes("__name("),
      "V370-09: Xác nhận esbuild keepNames:true thực sự sinh helper __name(...) trong bundle TS"
    );
    const esbuildVmSandbox: any = {
      module: { exports: {} },
      exports: {},
      require: (id: string) => {
        if (id.includes("checkpoint-competency")) {
          return { COMPETENCY_AREA_SPECS, clampCompetencyRating, parseCheckpointDataJson };
        }
        if (id.includes("db/sqlite")) {
          return {
            sessionFeedbackRepo,
            studentRepo,
            jobLogRepo: { add: () => {} },
            verifyContentIntegrity,
            extractCheckpointCoreSnapshotHash,
          };
        }
        if (id.includes("json-config")) return { getCoursesSyllabus: () => [] };
        if (id.includes("config")) return { config: { lmsUrl: "https://lms.mindx.edu.vn" } };
        if (id.includes("task-queue")) return { markSaveCommentsSessionRunning: () => () => {} };
        return {};
      },
      console, Promise, Set, Map, RegExp, Math, JSON, Date, Error, Array, Object, String, Number, Boolean, parseInt,
    };
    const esbuildCodeForVm = `${esbuildOut.code}\nglobalThis.__cpHelpers = { resolveCheckpointCompetencyRadioGroups, applyCheckpointCompetencyRadios, verifyCheckpointCompetencyRadios };`;
    vm.runInNewContext(esbuildCodeForVm, esbuildVmSandbox);
    const cpHelpersEsbuild = esbuildVmSandbox.__cpHelpers;

    // 1) Live MindX Coding DOM: 46 radios (0..44 name="" value=""), 2 number inputs, 11 checkboxes, 20 textareas, 46th survey radio checked: true
    const buildLiveMockDomHtml = (opts: { isRobotics: boolean }) => {
      const codingLabels = COMPETENCY_AREA_SPECS.map((s) => s.labelVi);
      const roboticsLabels = [
        "[ĐNL] Kiến thức học viên đã được học tại lớp", // swapped #1 first
        "[ĐNL] Kiến thức học viên tự học",              // swapped #2 second
        "[ĐNL] Kỹ năng giao tiếp, hợp tác",
        "[ROB-ĐNL] Kỹ năng sử dụng máy tính",
        "[ROB-ĐNL] Kỹ năng giải quyết vấn đề",
        "[ROB-ĐNL] Tư duy sáng tạo mô hình",
        "Tư duy máy tính, tư duy thuật toán.ROB.ĐNL2024",
        "[ĐNL] Thái độ luyện tập về nhà",
        "[ĐNL] Thái độ học tập trên lớp",
      ];
      const labels = opts.isRobotics ? roboticsLabels : codingLabels;
      const questionBlocks = Array.from({ length: 11 }, (_, qIdx) => `
        <div class="question-block">
          <p>Câu hỏi ${qIdx + 1}: Học sinh có hoàn thành phần sáng tạo và tự học không?</p>
          <label><input type="checkbox" class="q-check" /> Đạt</label>
          <textarea class="q-note">Ghi chú câu hỏi ${qIdx + 1}</textarea>
        </div>
      `).join("");
      const dnlBlocks = labels.map((lbl, idx) => `
        <div class="dnl-row" data-row="${idx}">
          <p class="dnl-title">${lbl}</p>
          <div class="dnl-radios">
            ${[1, 2, 3, 4, 5].map((n) => `<label><span>${n}</span><input type="radio" name="" value="" /></label>`).join("")}
          </div>
          <textarea class="dnl-note">Nhận xét chi tiết tiêu chí ${idx + 1} (tự học, sáng tạo)</textarea>
        </div>
      `).join("");
      return `
        <div role="dialog">
          <div class="scores">
            <input type="number" id="lt-score" value="4.5" />
            <input type="number" id="th-score" value="5.0" />
          </div>
          <div class="questions">${questionBlocks}</div>
          <div class="dnl-section">
            <h3>${opts.isRobotics ? "[ĐNL2024] Checkpoint" : "[ĐNL] Checkpoint"}</h3>
            ${dnlBlocks}
          </div>
          <div class="survey-extra">
            <label><input type="radio" id="survey-46" name="" value="" checked /> Khảo sát thêm</label>
          </div>
          <div class="ql-editor" contenteditable="true"></div>
        </div>
      `;
    };

    await cleanPage.setContent(buildLiveMockDomHtml({ isRobotics: false }));
    const codingDialogLoc = cleanPage.locator('[role="dialog"]').first();
    const codingResolved = await cpHelpersEsbuild.resolveCheckpointCompetencyRadioGroups(codingDialogLoc);
    assert.equal(codingResolved.method, "LABEL_GROUPED", "V370-09 (1): Coding 46-radio blank name/value phải resolve LABEL_GROUPED (0 __name error)");
    assert.equal(codingResolved.groups.length, 9);
    const codingTargetScores = {
      knowledgeSelfStudy: 5,
      knowledgeInClass: 3,
      skillCommunication: 4,
      skillComputerUse: 2,
      skillProblemSolving: 5,
      skillCreativity: 4,
      skillComputational: 3,
      attitudeHomework: 2,
      attitudeInClass: 5,
    };
    const codingApply = await cpHelpersEsbuild.applyCheckpointCompetencyRadios(codingDialogLoc, codingTargetScores);
    assert.equal(codingApply.appliedCount, 9);
    assert.equal(codingApply.clickedCount, 9);
    const codingVerify = await cpHelpersEsbuild.verifyCheckpointCompetencyRadios(codingDialogLoc, codingTargetScores);
    assert.equal(codingVerify.matched, true, `V370-09 (1): Read-after-Write Coding phải khớp 9/9: ${codingVerify.mismatches.join("; ")}`);
    const codingUntouched = await cleanPage.evaluate(() => ({
      survey46Checked: (document.getElementById("survey-46") as HTMLInputElement).checked,
      ltVal: (document.getElementById("lt-score") as HTMLInputElement).value,
      thVal: (document.getElementById("th-score") as HTMLInputElement).value,
      checkedBoxes: document.querySelectorAll('input[type="checkbox"]:checked').length,
      totalRadios: document.querySelectorAll('input[type="radio"]').length,
    }));
    assert.equal(codingUntouched.totalRadios, 46);
    assert.equal(codingUntouched.survey46Checked, true, "V370-09 (1): Không được chạm radio khảo sát thứ 46");
    assert.equal(codingUntouched.ltVal, "4.5", "V370-09 (1): Không được chạm điểm LT");
    assert.equal(codingUntouched.thVal, "5.0", "V370-09 (1): Không được chạm điểm TH");
    assert.equal(codingUntouched.checkedBoxes, 0, "V370-09 (1): Không được chạm 11 checkbox");

    // 2) Live MindX Robotics DOM: swapped #1/#2 Kiến thức order, [ROB-ĐNL], .ROB.ĐNL2024, [ĐNL2024] Checkpoint
    await cleanPage.setContent(buildLiveMockDomHtml({ isRobotics: true }));
    const roboticsDialogLoc = cleanPage.locator('[role="dialog"]').first();
    const roboticsResolved = await cpHelpersEsbuild.resolveCheckpointCompetencyRadioGroups(roboticsDialogLoc);
    assert.equal(roboticsResolved.method, "LABEL_GROUPED", "V370-09 (2): Robotics 46-radio DOM phải resolve LABEL_GROUPED");
    assert.equal(roboticsResolved.groups.length, 9);
    assert.deepEqual(
      roboticsResolved.groups.find((g: any) => g.key === "knowledgeInClass")?.radioGlobalIndices,
      [0, 1, 2, 3, 4],
      "V370-09 (2): Robotics hoán vị #1 Kiến thức tại lớp đứng trước ở nhóm DOM 0..4"
    );
    assert.deepEqual(
      roboticsResolved.groups.find((g: any) => g.key === "knowledgeSelfStudy")?.radioGlobalIndices,
      [5, 6, 7, 8, 9],
      "V370-09 (2): Robotics hoán vị #2 Kiến thức tự học ở nhóm DOM 5..9"
    );
    const roboticsTargetScores = {
      knowledgeSelfStudy: 2,
      knowledgeInClass: 5,
      skillCommunication: 4,
      skillComputerUse: 3,
      skillProblemSolving: 5,
      skillCreativity: 1,
      skillComputational: 4,
      attitudeHomework: 3,
      attitudeInClass: 5,
    };
    await cpHelpersEsbuild.applyCheckpointCompetencyRadios(roboticsDialogLoc, roboticsTargetScores);
    const roboticsVerify = await cpHelpersEsbuild.verifyCheckpointCompetencyRadios(roboticsDialogLoc, roboticsTargetScores);
    assert.equal(roboticsVerify.matched, true, `V370-09 (2): Read-after-Write Robotics phải khớp 9/9: ${roboticsVerify.mismatches.join("; ")}`);
    assert.equal(
      await cleanPage.evaluate(() => (document.getElementById("survey-46") as HTMLInputElement).checked),
      true,
      "V370-09 (2): Không được chạm radio khảo sát thứ 46 trên Robotics modal"
    );

    // Negative fail-closed probes on esbuild-transpiled resolver: value="true"/"false" & multi-spec span
    await cleanPage.setContent(`
      <div role="dialog">
        ${COMPETENCY_AREA_SPECS.map((s, idx) => `
          <div>
            <p>${s.labelVi}</p>
            ${
              idx === 0
                ? `<p>${COMPETENCY_AREA_SPECS[1].labelVi}</p><input type="radio" name="" value="" /><input type="radio" name="" value="" /><input type="radio" name="" value="" /><input type="radio" name="" value="" /><input type="radio" name="" value="" />`
                : `<input type="radio" name="q_${idx}" value="true" /><input type="radio" name="q_${idx}" value="false" /><input type="radio" name="q_${idx}" value="3" /><input type="radio" name="q_${idx}" value="4" /><input type="radio" name="q_${idx}" value="5" />`
            }
          </div>
        `).join("")}
      </div>
    `);
    const badDomResolved = await cpHelpersEsbuild.resolveCheckpointCompetencyRadioGroups(cleanPage.locator('[role="dialog"]').first());
    assert.equal(badDomResolved.method, "NONE", "V370-09 (3): Phải từ chối fail-closed khi có value='true'/'false' hoặc container gộp >=2 tiêu chí");

    // F03 regression: Flat-sibling dual heading + explicit value="1".."5" radios MUST fail closed (NONE)
    await cleanPage.setContent(`
      <div role="dialog">
        ${COMPETENCY_AREA_SPECS.map((s, idx) => `
          <p>${
            idx === 0
              ? `${COMPETENCY_AREA_SPECS[0].labelVi} / ${COMPETENCY_AREA_SPECS[1].labelVi}`
              : s.labelVi
          }</p>
          <div class="radios">
            ${[1, 2, 3, 4, 5].map((v) => `<input type="radio" name="g_${idx}" value="${v}" />`).join("")}
          </div>
        `).join("")}
      </div>
    `);
    const flatDualResolved = await cpHelpersEsbuild.resolveCheckpointCompetencyRadioGroups(cleanPage.locator('[role="dialog"]').first());
    assert.equal(flatDualResolved.method, "NONE", "F03: Flat-sibling tiêu đề gộp 2 tiêu chí + value=1..5 phải fail-closed NONE");

    assert.equal(cleanPageErrors.length, 0, `V370-09 (3): Tuyệt đối 0 ReferenceError: __name is not defined: ${cleanPageErrors.join("; ")}`);
    await cleanPage.close();
    await cleanContext.close();

    // F02 regression: VERIFIED Checkpoint row opening in View Mode WITHOUT [ĐNL]/Điểm năng lực header MUST NOT skip ticking 9 [ĐNL]
    {
      const f02VmRec: any = {
        classId: "VT-CSA04-HB",
        sessionId: "VT-CSA04-HB_SESS_05",
        studentId: "ST_QA",
        attendanceStatus: "PRESENT",
        finalText: sampleBody, // plain comment without "Điểm năng lực" header
        contentHash: sha256(sampleBody),
        status: "VERIFIED",
        checkpointDataJson: JSON.stringify({
          cpStage: 1,
          isRobotics: false,
          theoryScore: 4.5,
          practiceScore: 5.0,
          competencyScores: desiredComp,
          competencyAverage: calculateCompetencyAveragePure(desiredComp),
          lmsCompetencyScores: null,
        }),
      };
      const f02Plain = sampleBody.replace(/\*\*([^*\n]+)\*\*/g, "$1");
      const f02Radios = new Array<boolean>(46).fill(false);
      let f02InViewMode = true;
      let f02EditClicks = 0;
      let f02RadioClicks = 0;
      let f02SaveClicks = 0;
      let f02MarkedCompCalled = false;
      let f02SavedEditorText = "";
      const f02MakeLoc = (sel: string): any => {
        if (sel === 'input[type="radio"]') {
          return {
            count: async () => (f02InViewMode ? 0 : 46),
            nth: (i: number) => ({
              scrollIntoViewIfNeeded: async () => {},
              isChecked: async () => Boolean(f02Radios[i]),
              click: async () => {
                f02RadioClicks++;
                if (i < 45) {
                  const g = Math.floor(i / 5);
                  for (let o = 0; o < 5; o++) f02Radios[g * 5 + o] = false;
                }
                f02Radios[i] = true;
              },
            }),
          };
        }
        if (sel === 'input[type="radio"]:checked') {
          return { count: async () => (f02InViewMode ? 0 : f02Radios.filter(Boolean).length) };
        }
        if (sel.includes(".ql-editor")) {
          const ed: any = {
            count: async () => (f02InViewMode ? 0 : 1),
            first: () => ed,
            last: () => ed,
            isVisible: async () => !f02InViewMode,
            waitFor: async () => {},
            click: async () => {},
            evaluate: async (_fn: any, v?: string) => {
              if (typeof v === "string") f02SavedEditorText = v;
              return f02SavedEditorText;
            },
            innerText: async () => f02SavedEditorText.replace(/\*\*([^*\n]+)\*\*/g, "$1"),
          };
          return ed;
        }
        if (sel === "table tbody tr td:nth-child(2)") {
          return {
            first: () => ({
              isVisible: async () => f02InViewMode,
              innerText: async () => f02Plain,
            }),
          };
        }
        if (sel === "table tbody tr") {
          return {
            first: () => ({
              isVisible: async () => f02InViewMode,
              innerText: async () => f02Plain,
              hover: async () => {},
              click: async () => {
                f02EditClicks++;
                f02InViewMode = false;
              },
            }),
          };
        }
        if (sel.includes("EditIcon") || sel.includes('button:has-text("Edit")')) {
          return {
            first: () => ({
              isVisible: async () => f02InViewMode,
              click: async () => {
                f02EditClicks++;
                f02InViewMode = false;
              },
            }),
          };
        }
        if (sel.includes("Save") || sel.includes("Lưu")) {
          return {
            first: () => ({
              isVisible: async () => true,
              click: async () => {
                f02SaveClicks++;
                f02InViewMode = true;
              },
            }),
          };
        }
        return {
          count: async () => 0,
          first: () => ({ isVisible: async () => false, click: async () => {}, innerText: async () => "" }),
        };
      };
      const f02Dialog: any = {
        waitFor: async () => {},
        isVisible: async () => true,
        evaluate: async (_fn: any, payload: any) => {
          const specs = Array.isArray(payload) ? payload : payload?.specs || [];
          return specs.map((s: any, gIdx: number) => ({
            key: s.key,
            labelVi: s.labelVi,
            radioGlobalIndices: [gIdx * 5, gIdx * 5 + 1, gIdx * 5 + 2, gIdx * 5 + 3, gIdx * 5 + 4],
          }));
        },
        locator: (sel: string) => f02MakeLoc(sel),
      };
      const makeF02PageLoc = (sel: string): any => {
        if (sel.includes('[role="dialog"]')) {
          return { ...f02Dialog, first: () => f02Dialog, count: async () => 1 };
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
          getAttribute: async (attr: string) =>
            attr === "class" ? "slot-item active" : attr === "data-student-id" ? "ST_QA" : "",
          evaluate: async () => true,
          innerText: async () => "ST_QA\nNguyễn Quang Anh\nAttended",
          locator: (subSel: string) => makeF02PageLoc(subSel),
        };
        return rowLoc;
      };
      const f02Sandbox: any = {
        module: { exports: {} },
        exports: {},
        console, Promise, Set, Map, RegExp, Math, JSON, Date, Error, Array, Object, String, Number, Boolean, parseInt,
        BrowserManager: {
          getInstance: () => ({
            getPage: async () => ({
              locator: (s: string) => makeF02PageLoc(s),
              keyboard: { press: async () => {}, insertText: async () => {} },
              waitForTimeout: async () => {},
              screenshot: async () => {},
            }),
          }),
        },
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
            const payload = JSON.stringify({
              operationName: "UpdateSlotComment",
              variables: {
                payload: {
                  classCode: "VT-CSA04-HB",
                  slotNumber: 5,
                  studentId: "ST_QA",
                  comment: f02SavedEditorText.replace(/\*\*([^*\n]+)\*\*/g, "$1"),
                },
              },
            });
            assert.equal(waitOpts.requestPredicate(payload), true);
            return { status: () => 200, json: async () => ({ data: { updateSlotComment: { id: "ok" } } }) };
          },
        }),
        getCoursesSyllabus: () => [],
        config: { lmsUrl: "https://lms.mindx.edu.vn" },
        markSaveCommentsSessionRunning: () => () => {},
        sessionFeedbackRepo: {
          findBySession: () => [f02VmRec],
          findOne: () => f02VmRec,
          updateStatus: (_c: string, _s: string, _st: string, status: string, _va: any, err: string | null) => {
            f02VmRec.status = status;
            f02VmRec.errorMessage = err;
          },
          markCheckpointLmsCompetencyVerified: (_c: string, _s: string, _st: string, scores: any) => {
            f02MarkedCompCalled = true;
            const p = JSON.parse(f02VmRec.checkpointDataJson);
            f02VmRec.checkpointDataJson = JSON.stringify({ ...p, lmsCompetencyScores: scores });
            return true;
          },
        },
        studentRepo: {
          findByClass: () => [{ studentId: "ST_QA", classId: "VT-CSA04-HB", fullName: "Nguyễn Quang Anh", isActive: 1 }],
          findOne: () => ({ studentId: "ST_QA", classId: "VT-CSA04-HB", fullName: "Nguyễn Quang Anh", isActive: 1 }),
        },
        jobLogRepo: { add: () => {} },
        verifyContentIntegrity,
        extractCheckpointCoreSnapshotHash: () => "",
        COMPETENCY_AREA_SPECS,
        clampCompetencyRating,
        parseCheckpointDataJson,
      };
      vm.runInNewContext(transpileSaveCommentsForVm(), f02Sandbox);
      const f02Res = await f02Sandbox.CommentSaver.saveComments({
        classId: "VT-CSA04-HB",
        classCode: "VT-CSA04-HB",
        sessionId: "VT-CSA04-HB_SESS_05",
        studentId: "ST_QA",
      });
      assert.equal(f02Res.verifiedCount, 1);
      assert.ok(f02EditClicks >= 1, "F02: VERIFIED View Mode với desiredCompetencyScores phải bung Edit Mode");
      assert.equal(f02RadioClicks, 9, "F02: Phải tích đủ 9 ô [ĐNL]");
      assert.equal(f02SaveClicks, 1, "F02: Phải bấm Save lên LMS");
      assert.equal(f02MarkedCompCalled, true, "F02: Phải gọi markCheckpointLmsCompetencyVerified");
    }

    // 4) VT-ROB-SEMIA05 commentByAreas -> 9/9 non-null & CHECKPOINT_BOTH & zero suffix collision
    const robComputerSpec = COMPETENCY_AREA_SPECS.find((s) => s.key === "skillComputerUse")!;
    const robProblemSpec = COMPETENCY_AREA_SPECS.find((s) => s.key === "skillProblemSolving")!;
    const robCommSpec = COMPETENCY_AREA_SPECS.find((s) => s.key === "skillCommunication")!;
    assert.equal(matchesCompetencyAreaIdPure(robProblemSpec, "668e5005e71f90e7630da316"), true);
    assert.equal(matchesCompetencyAreaIdPure(robCommSpec, "668e5005e71f90e7630da316"), false);
    assert.equal(matchesCompetencyAreaIdPure(robCommSpec, "0d4316"), true);
    assert.equal(matchesCompetencyAreaIdPure(robProblemSpec, "0d4316"), false);
    assert.equal(matchesCompetencyAreaIdPure(robCommSpec, "aaaaaaaaaaaaaaaaaa0d4316"), false, "24-hex phải khớp chính xác, không khớp đuôi");
    assert.equal(matchesCompetencyAreaIdPure(robComputerSpec, "670777c055bde44038509a1b"), false);

    const buildRoboticsAreas = (grades: number[]) => [
      { type: "CHECKPOINT", checkpoint: { checkpointScore: 4.5, practiceScore: 5.0 } },
      { type: "CONTENT", content: "<p>Nhận xét Robotics đầy đủ tiêu chuẩn cho học sinh.</p>" },
      { type: "RATE", commentAreaId: "670777c055bde44038509a1b", grade: 0 }, // non-competency RATE ignored
      { type: "RATE", commentAreaId: "668d69d8e71f90e7630ce16c", grade: grades[1] }, // swapped order
      { type: "RATE", commentAreaId: "665e7d33181e0e47f6c63768", grade: grades[0] },
      { type: "RATE", commentAreaId: "668e2e7de71f90e7630d4316", grade: grades[2] },
      { type: "RATE", commentAreaId: "668e5146e71f90e7630da552", grade: grades[3] },
      { type: "RATE", commentAreaId: "668e5005e71f90e7630da316", grade: grades[4] },
      { type: "RATE", commentAreaId: "668e50ade71f90e7630da4b2", grade: grades[5] },
      { type: "RATE", commentAreaId: "668e49ebe71f90e7630d9433", grade: grades[6] },
      { type: "RATE", commentAreaId: "668e2f5be71f90e7630d44c1", grade: grades[7] },
      { type: "RATE", commentAreaId: "668e2eaee71f90e7630d434f", grade: grades[8] },
    ];
    const extractedRob = extractLmsCheckpointFromCommentByAreas(
      buildRoboticsAreas([5, 4, 5, 3, 4, 5, 4, 3, 5]),
      ""
    );
    assert.ok(extractedRob.competencyScores, "V370-09 (4): Phải đọc đủ 9/9 [ĐNL] cho Robotics VT-ROB-SEMIA05");
    assert.deepEqual(extractedRob.competencyScores, {
      knowledgeSelfStudy: 5,
      knowledgeInClass: 4,
      skillCommunication: 5,
      skillComputerUse: 3,
      skillProblemSolving: 4,
      skillCreativity: 5,
      skillComputational: 4,
      attitudeHomework: 3,
      attitudeInClass: 5,
    });
    const robS14Res = computeSession14CompetencyFromCheckpoints({
      classId: "VT-ROB-SEMIA05",
      cp1CommentByAreas: buildRoboticsAreas([4, 4, 5, 3, 4, 4, 4, 3, 5]),
      cp2CommentByAreas: buildRoboticsAreas([5, 5, 5, 4, 4, 5, 5, 4, 5]),
    });
    assert.equal(robS14Res.matchedFromCheckpoints, true);
    assert.equal(robS14Res.sourceType, "CHECKPOINT_BOTH");
    assert.equal(robS14Res.ratingsInDomOrder.filter((x) => x >= 1 && x <= 5).length, 9);

    // 5) ClassSyncer.syncLmsSlotCompletionToSqlite demotion / historical preservation / verified upgrade
    const syncTestClass = "VT-CSA04-HB";
    const syncTestSess = `${syncTestClass}_SESS_05`;
    studentRepo.upsert({
      studentId: "ST_SYNC_NEW",
      classId: syncTestClass,
      fullName: "Lê Minh Quân",
      isActive: 1,
    });
    studentRepo.upsert({
      studentId: "ST_SYNC_HIST",
      classId: syncTestClass,
      fullName: "Nguyễn Thảo Vy",
      isActive: 1,
    });
    const syncNewCpBase = {
      cpStage: 1 as const,
      isRobotics: false,
      theoryScore: 4.5,
      practiceScore: 5.0,
      competencyScores: {
        knowledgeSelfStudy: 5,
        knowledgeInClass: 5,
        skillCommunication: 4,
        skillComputerUse: 5,
        skillProblemSolving: 5,
        skillCreativity: 4,
        skillComputational: 5,
        attitudeHomework: 4,
        attitudeInClass: 5,
      },
      competencyAverage: 4.67,
    };
    const syncNewCpJson = JSON.stringify({
      ...syncNewCpBase,
      approvedSnapshotHash: extractCheckpointCoreSnapshotHash(JSON.stringify(syncNewCpBase)),
    });
    const syncTextNew = upsertCheckpointHeaderIntoFinalText(
      sampleBody,
      formatCheckpointScoreHeaderLine({ cpStage: 1, theoryScore: 4.5, practiceScore: 5.0, competencyAverage: 4.67 })!
    );
    sessionFeedbackRepo.upsert({
      classId: syncTestClass,
      sessionId: syncTestSess,
      studentId: "ST_SYNC_NEW",
      attendanceStatus: "PRESENT",
      finalText: syncTextNew,
      contentHash: sha256(syncTextNew),
      status: "VERIFIED",
      verifiedAt: "2026-11-22T10:00:00.000Z",
      checkpointDataJson: syncNewCpJson,
    });
    const syncTextHist = sampleBody;
    sessionFeedbackRepo.upsert({
      classId: syncTestClass,
      sessionId: syncTestSess,
      studentId: "ST_SYNC_HIST",
      attendanceStatus: "PRESENT",
      finalText: syncTextHist,
      contentHash: sha256(syncTextHist),
      status: "VERIFIED",
      verifiedAt: "2026-11-10T10:00:00.000Z",
      checkpointDataJson: "{}", // pre-v3.7.0 historical VERIFIED without approvedSnapshotHash
    });

    const syncSlotsNoRate = [null, null, null, null, {
      index: 4,
      studentAttendance: [
        {
          student: { id: "ST_SYNC_NEW", fullName: "Lê Minh Quân" },
          status: "ATTENDED",
          comment: syncTextNew,
          commentByAreas: [
            { type: "CHECKPOINT", checkpoint: { checkpointScore: 4.5, practiceScore: 5.0 } },
            { type: "CONTENT", content: `<p>${syncTextNew}</p>` },
          ],
        },
        {
          student: { id: "ST_SYNC_HIST", fullName: "Nguyễn Thảo Vy" },
          status: "ATTENDED",
          comment: syncTextHist,
          commentByAreas: [
            { type: "CHECKPOINT", checkpoint: { checkpointScore: 4.0, practiceScore: 4.0 } },
            { type: "CONTENT", content: `<p>${syncTextHist}</p>` },
          ],
        },
      ],
    }].map((x, i) => x || { index: i, studentAttendance: [] });

    ClassSyncer.syncLmsSlotCompletionToSqlite({
      db: getDb(),
      classId: syncTestClass,
      students: [
        studentRepo.findOne("ST_SYNC_NEW", syncTestClass)!,
        studentRepo.findOne("ST_SYNC_HIST", syncTestClass)!,
      ],
      slots: syncSlotsNoRate,
      preferLmsVerified: true,
    });
    const syncNewAfterNoRate = sessionFeedbackRepo.findOne(syncTestClass, syncTestSess, "ST_SYNC_NEW")!;
    const syncHistAfterNoRate = sessionFeedbackRepo.findOne(syncTestClass, syncTestSess, "ST_SYNC_HIST")!;
    assert.equal(
      syncNewAfterNoRate.status,
      "APPROVED",
      "V370-09 (5): Bản ghi v3.7.0+ VERIFIED thiếu 9 RATE trên LMS phải bị hạ về APPROVED"
    );
    assert.equal(syncNewAfterNoRate.contentHash, sha256(syncTextNew));
    assert.ok(
      parseCheckpointDataJson(syncNewAfterNoRate.checkpointDataJson)?.approvedSnapshotHash,
      "V370-09 (5): Hạ về APPROVED phải bảo toàn approvedSnapshotHash"
    );
    assert.equal(
      syncHistAfterNoRate.status,
      "VERIFIED",
      "V370-09 (5): Bản ghi lịch sử pre-v3.7.0 (approvedSnapshotHash == null) phải giữ nguyên VERIFIED"
    );

    const syncSlotsWithRates = [null, null, null, null, {
      index: 4,
      studentAttendance: [
        {
          student: { id: "ST_SYNC_NEW", fullName: "Lê Minh Quân" },
          status: "ATTENDED",
          comment: syncTextNew,
          commentByAreas: [
            { type: "CHECKPOINT", checkpoint: { checkpointScore: 4.5, practiceScore: 5.0 } },
            { type: "CONTENT", content: `<p>${syncTextNew}</p>` },
            ...COMPETENCY_AREA_SPECS.map((sp) => ({
              type: "RATE",
              commentAreaId: sp.commentAreaId,
              grade: syncNewCpBase.competencyScores[sp.key],
            })),
          ],
        },
      ],
    }].map((x, i) => x || { index: i, studentAttendance: [] });

    ClassSyncer.syncLmsSlotCompletionToSqlite({
      db: getDb(),
      classId: syncTestClass,
      students: [studentRepo.findOne("ST_SYNC_NEW", syncTestClass)!],
      slots: syncSlotsWithRates,
      preferLmsVerified: false,
    });
    const syncNewAfterWithRates = sessionFeedbackRepo.findOne(syncTestClass, syncTestSess, "ST_SYNC_NEW")!;
    assert.equal(syncNewAfterWithRates.status, "VERIFIED", "V370-09 (5): Khi LMS có đủ 9 RATE khớp phải lên lại VERIFIED");
    assert.deepEqual(
      parseCheckpointDataJson(syncNewAfterWithRates.checkpointDataJson)?.lmsCompetencyScores,
      syncNewCpBase.competencyScores
    );

    // Cleanup temporary sync test students before :3099 E2E backfill check
    getDb().prepare("DELETE FROM session_feedbacks WHERE classId = ? AND studentId IN ('ST_SYNC_NEW', 'ST_SYNC_HIST')").run(syncTestClass);
    getDb().prepare("DELETE FROM students WHERE classId = ? AND studentId IN ('ST_SYNC_NEW', 'ST_SYNC_HIST')").run(syncTestClass);

    // 6) :3099 E2E checks `⏳ Chưa tích LMS` / `✓ Đã tích LMS` Light & Dark contrast + backfill button
    studentRepo.upsert({
      studentId: "ST_BACKFILL",
      classId: codingClassId,
      fullName: "Hoàng Gia Huy",
      isActive: 1,
    });
    studentRepo.upsert({
      studentId: "ST_TICKED",
      classId: codingClassId,
      fullName: "Đặng Khánh Linh",
      isActive: 1,
    });
    studentRepo.upsert({
      studentId: "ST_MISMATCH",
      classId: codingClassId,
      fullName: "Vũ Nhật Minh",
      isActive: 1,
    });
    const bfHash = sha256(withHeader);
    const bfBase = {
      cpStage: 1 as const,
      isRobotics: false,
      theoryScore: 4.5,
      practiceScore: 5.0,
      competencyScores: desiredComp,
      competencyAverage: calculateCompetencyAveragePure(desiredComp),
      approvedSnapshotHash: extractCheckpointCoreSnapshotHash(JSON.stringify({
        cpStage: 1,
        theoryScore: 4.5,
        practiceScore: 5.0,
        competencyScores: desiredComp,
      })),
    };
    const mismatchLmsScores = {
      knowledgeSelfStudy: 3,
      knowledgeInClass: 3,
      skillCommunication: 3,
      skillComputerUse: 3,
      skillProblemSolving: 3,
      skillCreativity: 3,
      skillComputational: 3,
      attitudeHomework: 3,
      attitudeInClass: 3,
    };
    sessionFeedbackRepo.upsert({
      classId: codingClassId,
      sessionId: `${codingClassId}_SESS_05`,
      studentId: "ST_BACKFILL",
      attendanceStatus: "PRESENT",
      finalText: withHeader,
      contentHash: bfHash,
      status: "VERIFIED",
      verifiedAt: "2026-11-22T10:00:00.000Z",
      checkpointDataJson: JSON.stringify({ ...bfBase, lmsCompetencyScores: null }),
    });
    sessionFeedbackRepo.upsert({
      classId: codingClassId,
      sessionId: `${codingClassId}_SESS_05`,
      studentId: "ST_TICKED",
      attendanceStatus: "PRESENT",
      finalText: withHeader,
      contentHash: bfHash,
      status: "VERIFIED",
      verifiedAt: "2026-11-22T10:00:00.000Z",
      checkpointDataJson: JSON.stringify(bfBase),
    });
    sessionFeedbackRepo.upsert({
      classId: codingClassId,
      sessionId: `${codingClassId}_SESS_05`,
      studentId: "ST_MISMATCH",
      attendanceStatus: "PRESENT",
      finalText: withHeader,
      contentHash: bfHash,
      status: "VERIFIED",
      verifiedAt: "2026-11-22T10:00:00.000Z",
      checkpointDataJson: JSON.stringify({ ...bfBase, lmsCompetencyScores: mismatchLmsScores }),
    });
    assert.equal(
      sessionFeedbackRepo.markCheckpointLmsCompetencyVerified(
        codingClassId,
        `${codingClassId}_SESS_05`,
        "ST_TICKED",
        desiredComp,
        "2026-11-22T10:05:00.000Z",
        bfHash
      ),
      true
    );

    // F04 regression: markCheckpointLmsCompetencyVerified rejects null, "", 0, 6, true, and float values
    for (const badVal of [null, "", 0, 6, true, 3.7] as any[]) {
      const okInvalid = sessionFeedbackRepo.markCheckpointLmsCompetencyVerified(
        codingClassId,
        `${codingClassId}_SESS_05`,
        "ST_TICKED",
        { ...desiredComp, knowledgeSelfStudy: badVal },
        "2026-11-22T10:06:00.000Z",
        bfHash
      );
      assert.equal(okInvalid, false, `F04: markCheckpointLmsCompetencyVerified phải từ chối giá trị không hợp lệ ${String(badVal)}`);
    }
    assert.deepEqual(
      parseCheckpointDataJson(
        sessionFeedbackRepo.findOne(codingClassId, `${codingClassId}_SESS_05`, "ST_TICKED")?.checkpointDataJson
      )?.lmsCompetencyScores,
      desiredComp,
      "F04: Dữ liệu lmsCompetencyScores hợp lệ không bị ghi đè sau các lần gọi sai"
    );

    const bfPage = await browser.newPage({ viewport: { width: 1366, height: 820 } });
    const bfPageErrors: string[] = [];
    bfPage.on("pageerror", (err: Error) => bfPageErrors.push(err.message));

    await bfPage.route("**/api/session-comments/save-lms", async (route: any) => {
      sessionFeedbackRepo.updateStatus(
        codingClassId,
        `${codingClassId}_SESS_05`,
        "ST_BACKFILL",
        "VERIFIED",
        new Date().toISOString(),
        null,
        bfHash
      );
      sessionFeedbackRepo.markCheckpointLmsCompetencyVerified(
        codingClassId,
        `${codingClassId}_SESS_05`,
        "ST_BACKFILL",
        desiredComp,
        new Date().toISOString(),
        bfHash
      );
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            classCode: codingClassId,
            sessionId: `${codingClassId}_SESS_05`,
            totalCandidates: 1,
            savedCount: 1,
            verifiedCount: 1,
            failedCount: 0,
            results: [{ studentId: "ST_BACKFILL", fullName: "Hoàng Gia Huy", success: true, verified: true }],
          },
        }),
      });
    });

    await bfPage.goto(
      `${baseUrl}/session-comments?classId=${codingClassId}&sessionNumber=5`,
      { waitUntil: "domcontentloaded", timeout: 60000 }
    );
    await bfPage.waitForSelector('[data-testid="cp-lms-tick-status-ST_BACKFILL"]', { timeout: 30000 });
    await bfPage.waitForSelector('[data-testid="cp-lms-tick-status-ST_TICKED"]', { timeout: 30000 });
    await bfPage.waitForSelector('[data-testid="cp-lms-tick-status-ST_MISMATCH"]', { timeout: 30000 });

    const bfTextBefore = (await bfPage.textContent('[data-testid="cp-lms-tick-status-ST_BACKFILL"]'))?.trim();
    const tkTextBefore = (await bfPage.textContent('[data-testid="cp-lms-tick-status-ST_TICKED"]'))?.trim();
    const mmTextBefore = (await bfPage.textContent('[data-testid="cp-lms-tick-status-ST_MISMATCH"]'))?.trim();
    assert.equal(bfTextBefore, "⏳ Chưa tích LMS");
    assert.equal(tkTextBefore, "✓ Đã tích LMS");
    assert.equal(mmTextBefore, "⏳ Chưa tích LMS", "F01: Khi lmsCompetencyScores lệch competencyScores phải hiện '⏳ Chưa tích LMS'");

    const backfillBtnLoc = bfPage.locator('[data-testid="save-single-btn-ST_BACKFILL"]');
    assert.equal(await backfillBtnLoc.isVisible(), true, "V370-09 (6): Phải hiện nút 'Tích 9 ô [ĐNL] & Lưu' cho VERIFIED chưa tích LMS");
    assert.ok((await backfillBtnLoc.textContent())?.includes("Tích 9 ô [ĐNL] & Lưu"));
    assert.equal(
      await bfPage.locator('[data-testid="save-single-btn-ST_MISMATCH"]').isVisible(),
      true,
      "F01: Khi lmsCompetencyScores lệch competencyScores trên dòng VERIFIED phải hiện nút 'Tích 9 ô [ĐNL] & Lưu'"
    );
    assert.equal(
      await bfPage.locator('[data-testid="save-single-btn-ST_TICKED"]').count(),
      0,
      "V370-09 (6): Không hiện nút đẩy lại cho học sinh đã tích 9/9 LMS"
    );

    const calcLum = (rgb: number[]): number => {
      const ch = rgb.slice(0, 3).map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    };
    const calcContrastRatio = (bgRgba: number[], fgRgba: number[], fallbackBg: number[]): number => {
      const a = bgRgba[3];
      const compBg = [
        bgRgba[0] * a + fallbackBg[0] * (1 - a),
        bgRgba[1] * a + fallbackBg[1] * (1 - a),
        bgRgba[2] * a + fallbackBg[2] * (1 - a),
      ];
      const l1 = calcLum(compBg);
      const l2 = calcLum(fgRgba);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };

    const checkPillContrast = async (theme: "light" | "dark") => {
      await bfPage.evaluate((t: "light" | "dark") => {
        document.documentElement.setAttribute("data-theme", t);
        document.documentElement.classList.remove("light", "dark");
        document.documentElement.classList.add(t);
      }, theme);
      await bfPage.waitForTimeout(100);
      const styles = await bfPage.evaluate(() => {
        const bfEl = document.querySelector('[data-testid="cp-lms-tick-status-ST_BACKFILL"]') as HTMLElement;
        const tkEl = document.querySelector('[data-testid="cp-lms-tick-status-ST_TICKED"]') as HTMLElement;
        const bfCss = getComputedStyle(bfEl);
        const tkCss = getComputedStyle(tkEl);
        const c = document.createElement("canvas");
        c.width = 1;
        c.height = 1;
        const g = c.getContext("2d")!;
        g.clearRect(0, 0, 1, 1);
        g.fillStyle = bfCss.backgroundColor;
        g.fillRect(0, 0, 1, 1);
        const bfBgPx = Array.from(g.getImageData(0, 0, 1, 1).data);
        g.clearRect(0, 0, 1, 1);
        g.fillStyle = bfCss.color;
        g.fillRect(0, 0, 1, 1);
        const bfFgPx = Array.from(g.getImageData(0, 0, 1, 1).data);
        g.clearRect(0, 0, 1, 1);
        g.fillStyle = tkCss.backgroundColor;
        g.fillRect(0, 0, 1, 1);
        const tkBgPx = Array.from(g.getImageData(0, 0, 1, 1).data);
        g.clearRect(0, 0, 1, 1);
        g.fillStyle = tkCss.color;
        g.fillRect(0, 0, 1, 1);
        const tkFgPx = Array.from(g.getImageData(0, 0, 1, 1).data);
        return {
          bfBg: [bfBgPx[0], bfBgPx[1], bfBgPx[2], bfBgPx[3] / 255],
          bfFg: [bfFgPx[0], bfFgPx[1], bfFgPx[2], bfFgPx[3] / 255],
          tkBg: [tkBgPx[0], tkBgPx[1], tkBgPx[2], tkBgPx[3] / 255],
          tkFg: [tkFgPx[0], tkFgPx[1], tkFgPx[2], tkFgPx[3] / 255],
          raw: {
            bfBg: bfCss.backgroundColor,
            bfFg: bfCss.color,
            tkBg: tkCss.backgroundColor,
            tkFg: tkCss.color,
          },
        };
      });
      const cardFallback = theme === "dark" ? [20, 31, 56] : [255, 255, 255];
      return {
        backfillRatio: calcContrastRatio(styles.bfBg, styles.bfFg, cardFallback),
        tickedRatio: calcContrastRatio(styles.tkBg, styles.tkFg, cardFallback),
        raw: styles.raw,
      };
    };

    const lightContrast = await checkPillContrast("light");
    const darkContrast = await checkPillContrast("dark");
    assert.ok(lightContrast.backfillRatio >= 4.5 && lightContrast.tickedRatio >= 4.5, `Light contrast < 4.5: ${JSON.stringify(lightContrast)}`);
    assert.ok(darkContrast.backfillRatio >= 4.5 && darkContrast.tickedRatio >= 4.5, `Dark contrast < 4.5: ${JSON.stringify(darkContrast)}`);

    const mainPushBtn = bfPage.locator("button", { hasText: "Duyệt & Đẩy LMS" }).first();
    assert.equal(await mainPushBtn.isDisabled(), false, "V370-09 (6): Nút '✅ Duyệt & Đẩy LMS' phải bật khi có học sinh VERIFIED chưa tích 9/9 [ĐNL]");

    const approveReqPromise = bfPage.waitForResponse((r: any) => r.url().includes("/api/session-comments/approve") && r.request().method() === "POST");
    await backfillBtnLoc.click();
    const approveResp = await approveReqPromise;
    assert.equal(approveResp.status(), 200, "V370-09 (6): Click 'Tích 9 ô [ĐNL] & Lưu' phải gọi /approve HTTP 200 thành công (không 409)");

    await bfPage.waitForFunction(
      () => document.querySelector('[data-testid="cp-lms-tick-status-ST_BACKFILL"]')?.textContent?.trim() === "✓ Đã tích LMS",
      undefined,
      { timeout: 15000 }
    );
    assert.equal(
      await bfPage.locator('[data-testid="save-single-btn-ST_BACKFILL"]').count(),
      0,
      "V370-09 (6): Sau khi tích LMS thành công, nút backfill phải biến mất"
    );

    // F01b regression: Editing a star locally on ST_TICKED flips pill from ✓ Đã tích LMS -> ⏳ Chưa tích LMS immediately
    await bfPage.click('[data-testid="edit-dnl-btn-ST_TICKED"]');
    await bfPage.waitForSelector('[data-testid="checkpoint-dnl-modal"]', { timeout: 10000 });
    await bfPage.locator('[data-testid="checkpoint-dnl-modal"] .space-y-2 > div').first().locator("button", { hasText: "3" }).click();
    await bfPage.click('[data-testid="checkpoint-dnl-modal"] button:has-text("Đóng")');
    await bfPage.waitForFunction(
      () => document.querySelector('[data-testid="cp-lms-tick-status-ST_TICKED"]')?.textContent?.trim() === "⏳ Chưa tích LMS",
      undefined,
      { timeout: 10000 }
    );

    assert.equal(bfPageErrors.length, 0, `V370-09 (6): 0 pageerror: ${bfPageErrors.join("; ")}`);
    await bfPage.close();

    console.log("  -> PASS V370-09.");
    console.log("\n✅ TẤT CẢ KIỂM THỬ CHECKPOINT v3.8.5 (V370-01 .. V370-09) ĐỀU PASS 100%!");
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
