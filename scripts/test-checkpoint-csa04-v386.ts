/**
 * KIỂM THỬ TOÀN DIỆN v3.8.6 — ĐỒNG BỘ ĐIỂM CHECKPOINT #tab-3 (CSA04),
 * ƯU TIÊN ĐIỂM CHẤM TAY #tab-10 (ĐẶNG TRỌNG KHANG) & CHỈNH TAY LT/TH DỰ PHÒNG
 *
 * Bao phủ:
 * - [V386-01] scaleSubmissionScoreTo5, resolveCheckpointColumnStagePure & reconcileCheckpointTestScores (6+ ca thực tế CSA04/Khang/Triều/Robotics/ManualUI)
 * - [V386-02] extractHomeworkHistoryForClass lọc sạch cột CHECKPOINT (B1..B4 = 4 bài), extractCheckpointSubmissionScoresForClass & computeCheckpointDataForSession
 * - [V386-03] ScoreScraper.extractReportCardSnapshotFromGql đồng bộ nhất quán giữa #tab-10, #tab-3 và sửa tay session_feedbacks
 * - [V386-04] ClassSyncer.syncLmsSlotCompletionToSqlite (giữ khóa sửa tay, hạ 4.0 -> 0.0 từ LMS #tab-10, chống #tab-10 0 đè #tab-3 > 0) & API guards save-draft / checkpoint-sync
 * - [V386-05] Live Headless Chromium E2E trên :3095 (Light & Dark 1280x800 / 1440x900): cảnh báo TH chờ chấm, nhập sửa tay 3.5, khôi phục ↺ LMS, giữ nguyên .space-y-2 tiêu chí #1, 0 lỗi JS
 *
 * Chạy 100% cô lập trong `os.tmpdir()` — KHÔNG chạm dữ liệu thật trong `data/` hay tiến trình `:3000`.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-v386-"));
  const tmpConfigDir = path.join(tmpRoot, "config");
  const tmpDbPath = path.join(tmpRoot, "test_v386.db");
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
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "TEST_V386_DUMMY_KEY";

  const {
    classSessionRepo,
    closeDb,
    extractCheckpointCoreSnapshotHash,
    getDb,
    reportCardRepo,
    scoreMatrixRepo,
    sessionFeedbackRepo,
    studentRepo,
  } = await import("../src/lib/db/sqlite");
  const { saveRunningClasses } = await import("../src/lib/db/json-config");
  const {
    calculateCompetencyAveragePure,
    formatCheckpointScoreHeaderLine,
    mergeCheckpointStudentData,
    parseCheckpointDataJson,
    reconcileCheckpointTestScores,
    resolveCheckpointColumnStagePure,
    scaleSubmissionScoreTo5,
  } = await import("../src/lib/checkpoint/checkpoint-competency");
  const {
    computeCheckpointDataForSession,
    extractCheckpointSubmissionScoresForClass,
  } = await import("../src/lib/checkpoint/checkpoint-history-loader");
  const { ClassSyncer } = await import("../src/lib/playwright/sync-class");
  const { ScoreScraper } = await import("../src/lib/playwright/scrape-scores");

  const nextEnvPath = path.join(process.cwd(), "next-env.d.ts");
  const hadNextEnv = fs.existsSync(nextEnvPath);
  const origNextEnvBytes = hadNextEnv ? fs.readFileSync(nextEnvPath) : null;

  const testPort = 3095;
  const e2eDistRel = `.next/e2e-test-${testPort}`;
  const e2eDistAbs = path.join(process.cwd(), e2eDistRel);
  const e2eTsconfigRel = `.next/e2e-tsconfig-${testPort}.json`;
  const e2eTsconfigAbs = path.join(process.cwd(), e2eTsconfigRel);
  let nextServer: ChildProcess | null = null;
  let browser: any = null;
  const serverLogs: string[] = [];

  try {
    console.log("=== BẮT ĐẦU KIỂM THỬ TOÀN DIỆN v3.8.6 (CSA04 + CHẤM TAY KHANG + SỬA TAY) ===");

    // =========================================================================
    // [V386-01] Pure Helpers: scaleSubmissionScoreTo5 & reconcileCheckpointTestScores
    // =========================================================================
    console.log("\n[V386-01] Kiểm tra scaleSubmissionScoreTo5, nhận diện cột & reconcileCheckpointTestScores...");
    assert.equal(scaleSubmissionScoreTo5(10, 100), 0.5, "10/100 phải là 0.5/5.0 (không nhầm thang 10 -> 5.0)");
    assert.equal(scaleSubmissionScoreTo5(90, 100), 4.5);
    assert.equal(scaleSubmissionScoreTo5(80, 100), 4.0);
    assert.equal(scaleSubmissionScoreTo5(50, 100), 2.5);
    assert.equal(scaleSubmissionScoreTo5(0, 100), 0);
    assert.equal(scaleSubmissionScoreTo5(true as any, 100), null);
    assert.equal(scaleSubmissionScoreTo5("", 100), null);
    assert.equal(scaleSubmissionScoreTo5(-5, 100), null);

    assert.equal(
      resolveCheckpointColumnStagePure({
        id: "6abc8813a481fe8e33addd5a",
        title: "Bài kiểm tra định kỳ lần 1 - CP1",
        lessonType: "CHECKPOINT",
      }),
      1
    );
    assert.equal(
      resolveCheckpointColumnStagePure({
        id: "6abc9241a481fe8e33ae0682",
        title: "Bài kiểm tra định kỳ lần 2 - CP2",
        lessonType: "CHECKPOINT",
      }),
      2
    );
    assert.equal(
      resolveCheckpointColumnStagePure({
        id: "66bc3bde5d418ecb74679387",
        title: "Homework 1 - Làm quen với dữ liệu",
        lessonType: "REVIEW_AND_PRACTICE",
      }),
      null
    );

    // 1a. CSA04 auto quiz + graded practice
    assert.deepEqual(
      reconcileCheckpointTestScores({
        slotTheory: null,
        slotPractice: null,
        subTheory: 4.5,
        subPractice: 4.0,
        subPracticeStatus: "GRADED",
        subPracticeHasAttachments: true,
      }),
      { theoryScore: 4.5, practiceScore: 4.0, hasUngradedPractice: false }
    );

    // 1b. CSA04 Khoa: auto quiz + ungraded submitted practice with attachments (stale slotPractice = 0)
    assert.deepEqual(
      reconcileCheckpointTestScores({
        slotTheory: 2.5,
        slotPractice: 0,
        subTheory: 2.5,
        subPractice: null,
        subPracticeStatus: "SUBMITTED_UNGRADED",
        subPracticeHasAttachments: true,
      }),
      { theoryScore: 2.5, practiceScore: null, hasUngradedPractice: true }
    );

    // 1c. CSA04 Khoa later graded 80/100 -> 4.0 overrides stale slotPractice = 0
    assert.deepEqual(
      reconcileCheckpointTestScores({
        slotTheory: 2.5,
        slotPractice: 0,
        subTheory: 2.5,
        subPractice: 4.0,
        subPracticeStatus: "GRADED",
        subPracticeHasAttachments: true,
      }),
      { theoryScore: 2.5, practiceScore: 4.0, hasUngradedPractice: false }
    );

    // 1d. Đặng Trọng Khang: #tab-10 manual 3.0/3.0 beats #tab-3 quiz=0 & empty SUBMITTED_UNGRADED
    assert.deepEqual(
      reconcileCheckpointTestScores({
        slotTheory: 3.0,
        slotPractice: 3.0,
        subTheory: 0,
        subPractice: null,
        subPracticeStatus: "SUBMITTED_UNGRADED",
        subPracticeHasAttachments: false,
      }),
      { theoryScore: 3.0, practiceScore: 3.0, hasUngradedPractice: false }
    );

    // 1e. Trần Vĩnh Triều: NOT_SUBMITTED anywhere -> null/null
    assert.deepEqual(
      reconcileCheckpointTestScores({
        slotTheory: null,
        slotPractice: null,
        subTheory: null,
        subPractice: null,
        subPracticeStatus: "NOT_SUBMITTED",
        subPracticeHasAttachments: false,
      }),
      { theoryScore: null, practiceScore: null, hasUngradedPractice: false }
    );

    // 1f. Manual Bot UI override beats LMS and clears ungraded warning; preserves 3.75 2dp for ScrapeScores
    assert.deepEqual(
      reconcileCheckpointTestScores({
        slotTheory: 2.5,
        slotPractice: 0,
        subTheory: 2.5,
        subPractice: 3.75,
        subPracticeStatus: "GRADED",
        subPracticeHasAttachments: true,
        manualPractice: 4.0,
        userEditedPractice: true,
      }),
      { theoryScore: 2.5, practiceScore: 4.0, hasUngradedPractice: false }
    );
    assert.equal(
      reconcileCheckpointTestScores({
        slotTheory: null,
        slotPractice: null,
        subTheory: 4.5,
        subPractice: 3.75,
        subPracticeStatus: "GRADED",
        subPracticeHasAttachments: true,
      }).practiceScore,
      3.75
    );
    console.log("  -> PASS V386-01.");

    // =========================================================================
    // [V386-02] Seed VT-CSA04-HB Realistic Mirror & Test computeCheckpointDataForSession
    // =========================================================================
    console.log("\n[V386-02] Kiểm tra computeCheckpointDataForSession trên mô hình VT-CSA04-HB Buổi 5...");
    const csaClass = "VT-CSA04-HB";
    const csaStudents = [
      {
        studentId: "STU_VT-CSA04-HB_TRAN_HOANG_THIEN",
        uid: "uid_thien",
        crm: "crm_thien",
        fullName: "Trần Hoàng Thiên",
      },
      {
        studentId: "STU_VT-CSA04-HB_NGUYEN_TRUNG_KHOA",
        uid: "uid_khoa",
        crm: "crm_khoa",
        fullName: "Nguyễn Trung Khoa",
      },
      {
        studentId: "STU_VT-CSA04-HB_DANG_TRONG_KHANG",
        uid: "uid_khang",
        crm: "crm_khang",
        fullName: "Đặng Trọng Khang",
      },
      {
        studentId: "STU_VT-CSA04-HB_TRAN_VINH_TRIEU",
        uid: "uid_trieu",
        crm: "crm_trieu",
        fullName: "Trần Vĩnh Triều",
      },
    ];
    for (const s of csaStudents) {
      studentRepo.upsert({
        studentId: s.studentId,
        classId: csaClass,
        fullName: s.fullName,
        isActive: 1,
      });
    }
    for (let sNum = 1; sNum <= 5; sNum++) {
      classSessionRepo.upsert({
        classId: csaClass,
        className: csaClass,
        sessionId: `${csaClass}_SESS_${String(sNum).padStart(2, "0")}`,
        sessionNumber: sNum,
        topic: sNum === 5 ? "Thuyết trình quá trình thực hành Mini Project 1" : `Buổi ${sNum}`,
        date: `${String(sNum).padStart(2, "0")}/11/2026`,
      });
    }

    // Seed prior session feedbacks B1..B4
    for (let sNum = 1; sNum <= 4; sNum++) {
      for (const s of csaStudents) {
        sessionFeedbackRepo.upsert({
          classId: csaClass,
          sessionId: `${csaClass}_SESS_0${sNum}`,
          studentId: s.studentId,
          attendanceStatus: s.studentId.includes("TRIEU") ? "ABSENT" : "PRESENT",
          quickTagsJson: JSON.stringify(
            s.studentId.includes("KHANG")
              ? ["🐢 Tiếp thu chậm", "📝 Làm bài tập đầy đủ"]
              : ["✅ Tiếp thu tốt", "💡 Vận dụng & Sáng tạo tốt"]
          ),
          finalText: `Nhận xét B${sNum}`,
          status: "VERIFIED",
        });
      }
    }

    // Seed S05: Khang already has #tab-10 manual 3.0 / 3.0 (legacy format without slotTheoryScore field!),
    // Thiên & Khoa only have #tab-10 nothing, Triều nothing.
    sessionFeedbackRepo.upsert({
      classId: csaClass,
      sessionId: `${csaClass}_SESS_05`,
      studentId: "STU_VT-CSA04-HB_TRAN_HOANG_THIEN",
      attendanceStatus: "PRESENT",
      quickTagsJson: JSON.stringify(["🌟 Hoàn thành xuất sắc mục tiêu", "✅ Tiếp thu tốt"]),
      finalText: "- **Điểm mạnh của học viên:** Tốt.\n\n- **Điểm cần cải thiện:** Không.\n\n- **Lời khuyên:** Phát huy.",
      status: "APPROVED",
      contentHash: sha256("- **Điểm mạnh của học viên:** Tốt.\n\n- **Điểm cần cải thiện:** Không.\n\n- **Lời khuyên:** Phát huy."),
    });
    sessionFeedbackRepo.upsert({
      classId: csaClass,
      sessionId: `${csaClass}_SESS_05`,
      studentId: "STU_VT-CSA04-HB_NGUYEN_TRUNG_KHOA",
      attendanceStatus: "PRESENT",
      quickTagsJson: JSON.stringify(["✅ Tiếp thu tốt"]),
      finalText: "- **Điểm mạnh của học viên:** Khá.\n\n- **Điểm cần cải thiện:** Ôn lại.\n\n- **Lời khuyên:** Cố gắng.",
      status: "DRAFT",
    });
    sessionFeedbackRepo.upsert({
      classId: csaClass,
      sessionId: `${csaClass}_SESS_05`,
      studentId: "STU_VT-CSA04-HB_DANG_TRONG_KHANG",
      attendanceStatus: "PRESENT",
      quickTagsJson: JSON.stringify(["🐢 Tiếp thu chậm", "📝 Làm bài tập đầy đủ"]),
      finalText: "- **Điểm mạnh của học viên:** Chăm.\n\n- **Điểm cần cải thiện:** Nhanh hơn.\n\n- **Lời khuyên:** Luyện thêm.",
      status: "DRAFT",
      checkpointDataJson: JSON.stringify({
        cpStage: 1,
        isRobotics: false,
        theoryScore: 3,
        practiceScore: 3,
        source: "AUTO_PROCESS",
        lmsSyncedAt: "2026-11-23T04:57:04.891Z",
      }),
    });
    sessionFeedbackRepo.upsert({
      classId: csaClass,
      sessionId: `${csaClass}_SESS_05`,
      studentId: "STU_VT-CSA04-HB_TRAN_VINH_TRIEU",
      attendanceStatus: "PRESENT",
      quickTagsJson: JSON.stringify(["👍 Đạt yêu cầu"]),
      finalText: "- **Điểm mạnh của học viên:** Có đi học.\n\n- **Điểm cần cải thiện:** Chưa nộp bài.\n\n- **Lời khuyên:** Nộp đủ.",
      status: "DRAFT",
    });

    // Seed score_matrix_cache WITH HW1..HW4 + CP1 (sessionNumber: 1!) + CP2 (sessionNumber: 2!)
    scoreMatrixRepo.save(csaClass, {
      success: true,
      classId: csaClass,
      classCode: csaClass,
      columns: [
        { colIndex: 0, columnId: "HW1", lessonId: "HW1", title: "Homework 1", sessionNumber: 1, lessonType: "REVIEW_AND_PRACTICE" },
        { colIndex: 1, columnId: "HW2", lessonId: "HW2", title: "Homework 2", sessionNumber: 2, lessonType: "REVIEW_AND_PRACTICE" },
        { colIndex: 2, columnId: "HW3", lessonId: "HW3", title: "Homework 3", sessionNumber: 3, lessonType: "REVIEW_AND_PRACTICE" },
        { colIndex: 3, columnId: "HW4", lessonId: "HW4", title: "Homework 4", sessionNumber: 4, lessonType: "REVIEW_AND_PRACTICE" },
        { colIndex: 7, columnId: "6abc8813a481fe8e33addd5a", lessonId: "6abc8813a481fe8e33addd5a", title: "Bài kiểm tra định kỳ lần 1 - CP1", sessionNumber: 1, lessonType: "CHECKPOINT" },
        { colIndex: 8, columnId: "6abc9241a481fe8e33ae0682", lessonId: "6abc9241a481fe8e33ae0682", title: "Bài kiểm tra định kỳ lần 2 - CP2", sessionNumber: 2, lessonType: "CHECKPOINT" },
      ],
      rows: [
        {
          studentId: "STU_VT-CSA04-HB_TRAN_HOANG_THIEN",
          studentUid: "uid_thien",
          fullName: "Trần Hoàng Thiên",
          isActive: true,
          cells: {
            HW1: { columnId: "HW1", sessionNumber: 1, status: "GRADED", score: 80, quizScore: 90, maxScore: 100, rawText: "Đã chấm (80/100)" },
            HW2: { columnId: "HW2", sessionNumber: 2, status: "GRADED", score: 80, quizScore: 90, maxScore: 100, rawText: "Đã chấm (80/100)" },
            HW3: { columnId: "HW3", sessionNumber: 3, status: "GRADED", score: 80, quizScore: 90, maxScore: 100, rawText: "Đã chấm (80/100)" },
            HW4: { columnId: "HW4", sessionNumber: 4, status: "GRADED", score: 80, quizScore: 90, maxScore: 100, rawText: "Đã chấm (80/100)" },
            "6abc8813a481fe8e33addd5a": {
              columnId: "6abc8813a481fe8e33addd5a",
              sessionNumber: 1,
              status: "SUBMITTED_UNGRADED",
              score: null,
              quizScore: 90,
              maxScore: 100,
              attachments: ["uploads/thien.ipynb"],
              submittedAt: "Sun Nov 22 2026 04:58:48 GMT+0000",
              rawText: "Chưa chấm (0/1)",
            },
            "6abc9241a481fe8e33ae0682": {
              columnId: "6abc9241a481fe8e33ae0682",
              sessionNumber: 2,
              status: "NOT_SUBMITTED",
              score: null,
              quizScore: null,
              maxScore: 100,
              rawText: "Chưa nộp",
            },
          },
          averageScore: 80,
          gradedCount: 4,
          submittedUngradedCount: 1,
          notSubmittedCount: 1,
          redoCount: 0,
        },
        {
          studentId: "STU_VT-CSA04-HB_NGUYEN_TRUNG_KHOA",
          studentUid: "uid_khoa",
          fullName: "Nguyễn Trung Khoa",
          isActive: true,
          cells: {
            HW1: { columnId: "HW1", sessionNumber: 1, status: "GRADED", score: 70, maxScore: 100, rawText: "Đã chấm (70/100)" },
            HW2: { columnId: "HW2", sessionNumber: 2, status: "GRADED", score: 70, maxScore: 100, rawText: "Đã chấm (70/100)" },
            HW3: { columnId: "HW3", sessionNumber: 3, status: "GRADED", score: 70, maxScore: 100, rawText: "Đã chấm (70/100)" },
            HW4: { columnId: "HW4", sessionNumber: 4, status: "NOT_SUBMITTED", score: null, maxScore: 100, rawText: "Chưa nộp" },
            "6abc8813a481fe8e33addd5a": {
              columnId: "6abc8813a481fe8e33addd5a",
              sessionNumber: 1,
              status: "SUBMITTED_UNGRADED",
              score: null,
              quizScore: 50,
              maxScore: 100,
              attachments: ["uploads/khoa.ipynb"],
              submittedAt: "Sun Nov 22 2026 04:56:55 GMT+0000",
              rawText: "Chưa chấm (0/1)",
            },
            "6abc9241a481fe8e33ae0682": {
              columnId: "6abc9241a481fe8e33ae0682",
              sessionNumber: 2,
              status: "NOT_SUBMITTED",
              score: null,
              quizScore: null,
              maxScore: 100,
              rawText: "Chưa nộp",
            },
          },
          averageScore: 70,
          gradedCount: 3,
          submittedUngradedCount: 1,
          notSubmittedCount: 2,
          redoCount: 0,
        },
        {
          studentId: "STU_VT-CSA04-HB_DANG_TRONG_KHANG",
          studentUid: "uid_khang",
          fullName: "Đặng Trọng Khang",
          isActive: true,
          cells: {
            HW1: { columnId: "HW1", sessionNumber: 1, status: "GRADED", score: 60, maxScore: 100, rawText: "Đã chấm (60/100)" },
            HW2: { columnId: "HW2", sessionNumber: 2, status: "GRADED", score: 80, maxScore: 100, rawText: "Đã chấm (80/100)" },
            HW3: { columnId: "HW3", sessionNumber: 3, status: "GRADED", score: 60, maxScore: 100, rawText: "Đã chấm (60/100)" },
            HW4: { columnId: "HW4", sessionNumber: 4, status: "NOT_SUBMITTED", score: null, maxScore: 100, rawText: "Chưa nộp" },
            "6abc8813a481fe8e33addd5a": {
              columnId: "6abc8813a481fe8e33addd5a",
              sessionNumber: 1,
              status: "SUBMITTED_UNGRADED",
              score: null,
              quizScore: 0,
              maxScore: 100,
              attachments: [],
              submittedAt: "",
              rawText: "Chưa chấm (0/1)",
            },
            "6abc9241a481fe8e33ae0682": {
              columnId: "6abc9241a481fe8e33ae0682",
              sessionNumber: 2,
              status: "NOT_SUBMITTED",
              score: null,
              quizScore: null,
              maxScore: 100,
              rawText: "Chưa nộp",
            },
          },
          averageScore: 66.7,
          gradedCount: 3,
          submittedUngradedCount: 1,
          notSubmittedCount: 2,
          redoCount: 0,
        },
        {
          studentId: "STU_VT-CSA04-HB_TRAN_VINH_TRIEU",
          studentUid: "uid_trieu",
          fullName: "Trần Vĩnh Triều",
          isActive: true,
          cells: {
            HW1: { columnId: "HW1", sessionNumber: 1, status: "NOT_SUBMITTED", score: null, maxScore: 100, rawText: "Chưa nộp" },
            HW2: { columnId: "HW2", sessionNumber: 2, status: "NOT_SUBMITTED", score: null, maxScore: 100, rawText: "Chưa nộp" },
            HW3: { columnId: "HW3", sessionNumber: 3, status: "NOT_SUBMITTED", score: null, maxScore: 100, rawText: "Chưa nộp" },
            HW4: { columnId: "HW4", sessionNumber: 4, status: "NOT_SUBMITTED", score: null, maxScore: 100, rawText: "Chưa nộp" },
            "6abc8813a481fe8e33addd5a": {
              columnId: "6abc8813a481fe8e33addd5a",
              sessionNumber: 1,
              status: "NOT_SUBMITTED",
              score: null,
              quizScore: null,
              maxScore: 100,
              attachments: [],
              submittedAt: "",
              rawText: "Chưa nộp",
            },
            "6abc9241a481fe8e33ae0682": {
              columnId: "6abc9241a481fe8e33ae0682",
              sessionNumber: 2,
              status: "NOT_SUBMITTED",
              score: null,
              quizScore: null,
              maxScore: 100,
              attachments: [],
              submittedAt: "",
              rawText: "Chưa nộp",
            },
          },
          averageScore: null,
          gradedCount: 0,
          submittedUngradedCount: 0,
          notSubmittedCount: 5,
          redoCount: 0,
        },
      ],
      summary: { totalStudents: 4, totalColumns: 6, gradedCells: 10, submittedUngradedCells: 3, notSubmittedCells: 11, redoCells: 0, zeroScoreCells: 0 },
      scrapedAt: new Date().toISOString(),
    } as any);

    // Robotics submission extractor must return empty map
    assert.equal(extractCheckpointSubmissionScoresForClass(csaClass, 1, true).size, 0);

    const computedCsa = computeCheckpointDataForSession({
      classId: csaClass,
      sessionId: `${csaClass}_SESS_05`,
      sessionNumber: 5,
      forceRecalculate: true,
      persist: true,
    });
    assert.equal(computedCsa.isCheckpoint, true);
    assert.equal(computedCsa.cpStage, 1);

    // Verify BTVN totalEligible filtered out CP1 & CP2 -> exact 4!
    assert.equal(
      computedCsa.byStudent["STU_VT-CSA04-HB_TRAN_HOANG_THIEN"]?.processSummary?.homeworkSummary?.totalEligible,
      4,
      "Lọc bỏ cột CHECKPOINT để totalEligible = 4 thay vì 6"
    );
    assert.equal(computedCsa.byStudent["STU_VT-CSA04-HB_TRAN_HOANG_THIEN"]?.theoryScore, 4.5);
    assert.equal(computedCsa.byStudent["STU_VT-CSA04-HB_TRAN_HOANG_THIEN"]?.practiceScore, null);
    assert.equal(computedCsa.byStudent["STU_VT-CSA04-HB_TRAN_HOANG_THIEN"]?.hasUngradedPractice, true);

    assert.equal(computedCsa.byStudent["STU_VT-CSA04-HB_NGUYEN_TRUNG_KHOA"]?.theoryScore, 2.5);
    assert.equal(computedCsa.byStudent["STU_VT-CSA04-HB_NGUYEN_TRUNG_KHOA"]?.practiceScore, null);
    assert.equal(computedCsa.byStudent["STU_VT-CSA04-HB_NGUYEN_TRUNG_KHOA"]?.hasUngradedPractice, true);

    // Khang keeps 3.0 / 3.0 despite #tab-3 quiz=0 & empty SUBMITTED_UNGRADED
    assert.equal(computedCsa.byStudent["STU_VT-CSA04-HB_DANG_TRONG_KHANG"]?.theoryScore, 3.0);
    assert.equal(computedCsa.byStudent["STU_VT-CSA04-HB_DANG_TRONG_KHANG"]?.practiceScore, 3.0);
    assert.equal(computedCsa.byStudent["STU_VT-CSA04-HB_DANG_TRONG_KHANG"]?.hasUngradedPractice, false);

    // Triều stays null / null
    assert.equal(computedCsa.byStudent["STU_VT-CSA04-HB_TRAN_VINH_TRIEU"]?.theoryScore, null);
    assert.equal(computedCsa.byStudent["STU_VT-CSA04-HB_TRAN_VINH_TRIEU"]?.practiceScore, null);
    assert.equal(computedCsa.byStudent["STU_VT-CSA04-HB_TRAN_VINH_TRIEU"]?.hasUngradedPractice, false);

    // Ungraded list includes ONLY Thiên & Khoa (not Khang, not Triều)
    assert.deepEqual(
      [...computedCsa.ungradedPracticeStudents].sort(),
      ["Nguyễn Trung Khoa", "Trần Hoàng Thiên"]
    );

    // Thiên was APPROVED before points changed -> Rule 4 must demote Thiên to DRAFT
    const thienAfterSync = sessionFeedbackRepo.findOne(
      csaClass,
      `${csaClass}_SESS_05`,
      "STU_VT-CSA04-HB_TRAN_HOANG_THIEN"
    );
    assert.equal(thienAfterSync?.status, "DRAFT", "Rule 4: Khi cập nhật điểm mới sau duyệt phải hạ về DRAFT");
    assert.ok(thienAfterSync?.finalText?.includes("Lý thuyết **4.5/5.0**"));
    console.log("  -> PASS V386-02.");

    // =========================================================================
    // [V386-03] ScoreScraper.extractReportCardSnapshotFromGql 3-Source Sync
    // =========================================================================
    console.log("\n[V386-03] Kiểm tra ScoreScraper.extractReportCardSnapshotFromGql hợp nhất #tab-10, #tab-3 & sửa tay UI...");
    // Simulate teacher manually entering LT=4.0, TH=3.5 for Triều in Bot UI
    sessionFeedbackRepo.upsert({
      classId: csaClass,
      sessionId: `${csaClass}_SESS_05`,
      studentId: "STU_VT-CSA04-HB_TRAN_VINH_TRIEU",
      attendanceStatus: "PRESENT",
      status: "DRAFT",
      checkpointDataJson: JSON.stringify({
        cpStage: 1,
        isRobotics: false,
        theoryScore: 4.0,
        practiceScore: 3.5,
        userEditedTheory: true,
        userEditedPractice: true,
      }),
    });

    const mockGqlSnap = ScoreScraper.extractReportCardSnapshotFromGql({
      classId: csaClass,
      classCode: csaClass,
      lmsClassId: "lms_csa04",
      isRobotics: false,
      classByIdGqlData: {
        id: "lms_csa04",
        students: csaStudents.map((s) => ({
          activeInClass: true,
          student: { id: s.crm, fullName: s.fullName },
        })),
        slots: [
          { index: 0 },
          { index: 1 },
          { index: 2 },
          { index: 3 },
          {
            index: 4, // Coding Buổi 5
            studentAttendance: [
              // Khang has manual #tab-10 3.0 / 3.0
              {
                student: { id: "crm_khang", fullName: "Đặng Trọng Khang" },
                status: "ATTENDED",
                commentByAreas: [
                  {
                    type: "CHECKPOINT",
                    checkpoint: { checkpointScore: 3, practiceScore: 3 },
                  },
                ],
              },
              // Khoa has auto-mode #tab-10: checkpointScore=2.5, practiceScore=0 (while #tab-3 is now GRADED 80/100!)
              {
                student: { id: "crm_khoa", fullName: "Nguyễn Trung Khoa" },
                status: "ATTENDED",
                commentByAreas: [
                  {
                    type: "CHECKPOINT",
                    checkpoint: { checkpointScore: 2.5, practiceScore: 0 },
                  },
                ],
              },
              // Thiên has auto-mode #tab-10: checkpointScore=4.5, practiceScore=0 (while #tab-3 is SUBMITTED_UNGRADED with attachments)
              {
                student: { id: "crm_thien", fullName: "Trần Hoàng Thiên" },
                status: "ATTENDED",
                commentByAreas: [
                  {
                    type: "CHECKPOINT",
                    checkpoint: { checkpointScore: 4.5, practiceScore: 0 },
                  },
                ],
              },
            ],
          },
        ],
      },
      submissionGqlData: {
        students: csaStudents.map((s) => ({
          id: s.crm,
          studentUid: s.uid,
          displayName: s.fullName,
        })),
        lessons: [
          { id: "6abc8813a481fe8e33addd5a", name: "Bài kiểm tra định kỳ lần 1 - CP1", type: "CHECKPOINT", displayOrder: 5 },
        ],
        submissions: [
          // Thiên: Quiz 90, Practice SUBMITTED with file
          { lessonId: "6abc8813a481fe8e33addd5a", studentUid: "uid_thien", category: "QUIZ", status: "SUBMITTED", submittedCount: 1, score: 90 },
          { lessonId: "6abc8813a481fe8e33addd5a", studentUid: "uid_thien", category: "PRACTICE_TASK1", status: "SUBMITTED", submittedCount: 1, submittedAt: "2026-11-22", content: { attachments: ["thien.ipynb"] } },
          // Khoa: Quiz 50, Practice GRADED 80/100 (beats stale slot practiceScore=0!)
          { lessonId: "6abc8813a481fe8e33addd5a", studentUid: "uid_khoa", category: "QUIZ", status: "SUBMITTED", submittedCount: 1, score: 50 },
          { lessonId: "6abc8813a481fe8e33addd5a", studentUid: "uid_khoa", category: "PRACTICE_TASK1", status: "MARKED", submittedCount: 1, score: 80, submittedAt: "2026-11-22", content: { attachments: ["khoa.ipynb"] } },
          // Khang: Quiz 0, empty SUBMITTED
          { lessonId: "6abc8813a481fe8e33addd5a", studentUid: "uid_khang", category: "QUIZ", status: "SUBMITTED", submittedCount: 1, score: 0 },
          { lessonId: "6abc8813a481fe8e33addd5a", studentUid: "uid_khang", category: "PRACTICE_TASK1", status: "SUBMITTED", submittedCount: 1, content: { attachments: [] } },
        ],
      },
      existingStudents: studentRepo.findByClass(csaClass, false),
    });

    const byName = new Map(mockGqlSnap.students.map((s) => [s.fullName, s.stageScores]));
    assert.equal(byName.get("Đặng Trọng Khang")?.cp1Theory, 3);
    assert.equal(byName.get("Đặng Trọng Khang")?.cp1Practice, 3);
    assert.equal(byName.get("Nguyễn Trung Khoa")?.cp1Theory, 2.5);
    assert.equal(byName.get("Nguyễn Trung Khoa")?.cp1Practice, 4, "Khoa chấm 80/100 ở #tab-3 phải đè practiceScore=0 tạm trên #tab-10");
    assert.equal(byName.get("Trần Hoàng Thiên")?.cp1Theory, 4.5);
    assert.equal(byName.get("Trần Hoàng Thiên")?.cp1Practice, null, "Thiên chờ chấm #tab-3 không bị gán nhầm 0.0");
    assert.equal(byName.get("Trần Vĩnh Triều")?.cp1Theory, 4, "Điểm sửa tay ở Bot UI phải chảy sang Phiếu điểm khi LMS trống");
    assert.equal(byName.get("Trần Vĩnh Triều")?.cp1Practice, 3.5);

    // Reset Triều back to empty LMS for clean E2E state
    sessionFeedbackRepo.upsert({
      classId: csaClass,
      sessionId: `${csaClass}_SESS_05`,
      studentId: "STU_VT-CSA04-HB_TRAN_VINH_TRIEU",
      attendanceStatus: "PRESENT",
      status: "DRAFT",
      checkpointDataJson: JSON.stringify({
        cpStage: 1,
        isRobotics: false,
        theoryScore: null,
        practiceScore: null,
        userEditedTheory: false,
        userEditedPractice: false,
      }),
    });
    console.log("  -> PASS V386-03.");

    // =========================================================================
    // [V386-04] ClassSyncer Edge Cases: Manual Lock, 4.0->0.0 Downgrade, #tab-3 Preservation
    // =========================================================================
    console.log("\n[V386-04] Kiểm tra ClassSyncer.syncLmsSlotCompletionToSqlite khóa sửa tay & hạ 4.0 -> 0.0...");
    const robTestClass = "VT-ROB-ARMI13";
    const robSess = `${robTestClass}_SESS_04`;
    studentRepo.upsert({ studentId: "ST_ROB_1", classId: robTestClass, fullName: "Bé Robot Một", isActive: 1 });
    studentRepo.upsert({ studentId: "ST_LOCK_1", classId: robTestClass, fullName: "Bé Khóa Tay", isActive: 1 });
    classSessionRepo.upsert({
      classId: robTestClass,
      className: robTestClass,
      sessionId: robSess,
      sessionNumber: 4,
      topic: "CP1 Robotics",
      date: "14/11/2026",
    });

    // 4a. Robotics student had LT=4.0 from #tab-10, approved, now LMS lowered to 0.0
    const robOrigComp = {
      knowledgeSelfStudy: 4, knowledgeInClass: 4, skillCommunication: 4,
      skillComputerUse: 4, skillProblemSolving: 4, skillCreativity: 4,
      skillComputational: 4, attitudeHomework: 4, attitudeInClass: 4,
    };
    const robOrigText = "📊 **Kết quả Checkpoint 1:** Lý thuyết **4.0/5.0** | Thực hành **4.0/5.0** | Điểm năng lực **4.00/5.0**\n- **Điểm mạnh của học viên:** Tốt.\n\n- **Điểm cần cải thiện:** Ôn.\n\n- **Lời khuyên:** Luyện.";
    sessionFeedbackRepo.upsert({
      classId: robTestClass,
      sessionId: robSess,
      studentId: "ST_ROB_1",
      attendanceStatus: "PRESENT",
      finalText: robOrigText,
      contentHash: sha256(robOrigText),
      status: "APPROVED",
      checkpointDataJson: JSON.stringify({
        cpStage: 1,
        isRobotics: true,
        theoryScore: 4,
        practiceScore: 4,
        slotTheoryScore: 4,
        slotPracticeScore: 4,
        competencyScores: robOrigComp,
        competencyAverage: 4,
        approvedSnapshotHash: extractCheckpointCoreSnapshotHash(
          JSON.stringify({ cpStage: 1, theoryScore: 4, practiceScore: 4, competencyScores: robOrigComp })
        ),
      }),
    });

    // 4b. Student with manual UI override (userEditedTheory=true, theoryScore=4.5) must NOT be overwritten by LMS 0.0
    sessionFeedbackRepo.upsert({
      classId: robTestClass,
      sessionId: robSess,
      studentId: "ST_LOCK_1",
      attendanceStatus: "PRESENT",
      finalText: "Nhận xét dài hợp lệ của Bé Khóa Tay để test giữ nguyên khóa tay.",
      status: "DRAFT",
      checkpointDataJson: JSON.stringify({
        cpStage: 1,
        isRobotics: true,
        theoryScore: 4.5,
        practiceScore: 3.5,
        slotTheoryScore: 0,
        slotPracticeScore: 3.5,
        userEditedTheory: true,
        userEditedPractice: false,
        competencyScores: robOrigComp,
        competencyAverage: 4,
      }),
    });

    ClassSyncer.syncLmsSlotCompletionToSqlite({
      db: getDb(),
      classId: robTestClass,
      students: [
        studentRepo.findOne("ST_ROB_1", robTestClass)!,
        studentRepo.findOne("ST_LOCK_1", robTestClass)!,
      ],
      slots: [
        {
          index: 3,
          studentAttendance: [
            {
              student: { id: "ST_ROB_1", fullName: "Bé Robot Một" },
              status: "ATTENDED",
              comment: robOrigText,
              commentByAreas: [
                { type: "CHECKPOINT", checkpoint: { checkpointScore: 0, practiceScore: 4 } },
              ],
            },
            {
              student: { id: "ST_LOCK_1", fullName: "Bé Khóa Tay" },
              status: "ATTENDED",
              comment: "",
              commentByAreas: [
                { type: "CHECKPOINT", checkpoint: { checkpointScore: 0, practiceScore: 3.5 } },
              ],
            },
          ],
        },
      ],
      preferLmsVerified: false,
    });

    const robAfter = sessionFeedbackRepo.findOne(robTestClass, robSess, "ST_ROB_1");
    const robAfterCp = parseCheckpointDataJson(robAfter?.checkpointDataJson);
    assert.equal(robAfterCp?.theoryScore, 0, "Giáo viên hạ điểm trên #tab-10 từ 4.0 xuống 0.0 phải được cập nhật!");
    assert.equal(robAfter?.status, "DRAFT", "Đổi điểm LMS phải hạ status APPROVED về DRAFT");
    assert.ok(robAfter?.finalText?.includes("Lý thuyết **0.0/5.0**"));

    const lockAfter = sessionFeedbackRepo.findOne(robTestClass, robSess, "ST_LOCK_1");
    const lockAfterCp = parseCheckpointDataJson(lockAfter?.checkpointDataJson);
    assert.equal(lockAfterCp?.theoryScore, 4.5, "userEditedTheory=true phải khóa bảo vệ 4.5 trước #tab-10 0.0");
    assert.equal(lockAfterCp?.userEditedTheory, true);
    assert.equal(lockAfterCp?.slotTheoryScore, 0);
    console.log("  -> PASS V386-04.");

    // =========================================================================
    // [V386-06a] Hồi quy F01A, F01B, F02 & Seed dữ liệu F03, F04 trước khi mở :3095
    // =========================================================================
    console.log("\n[V386-06a] Kiểm tra hồi quy F01A, F01B, F02 trong SQLite cô lập...");
    const f01TextWait =
      "📊 **Kết quả Checkpoint 1:** Lý thuyết **2.5/5.0** | Thực hành **Chưa nhập** | Điểm năng lực **4.00/5.0**\n- **Điểm mạnh của học viên:** Tốt.\n\n- **Điểm cần cải thiện:** Cần ôn.\n\n- **Lời khuyên:** Cố gắng.";
    studentRepo.upsert({ studentId: "ST_F01_WAIT", classId: csaClass, fullName: "Học Viên Chờ Chấm F01", isActive: 1 });
    sessionFeedbackRepo.upsert({
      classId: csaClass,
      sessionId: `${csaClass}_SESS_05`,
      studentId: "ST_F01_WAIT",
      attendanceStatus: "PRESENT",
      finalText: f01TextWait,
      contentHash: sha256(f01TextWait),
      status: "APPROVED",
      checkpointDataJson: JSON.stringify({
        cpStage: 1,
        isRobotics: false,
        theoryScore: 2.5,
        practiceScore: null,
        slotTheoryScore: 2.5,
        slotPracticeScore: 0,
        hasUngradedPractice: true,
        competencyScores: robOrigComp,
        competencyAverage: 4,
        approvedSnapshotHash: extractCheckpointCoreSnapshotHash(
          JSON.stringify({ cpStage: 1, theoryScore: 2.5, practiceScore: null, competencyScores: robOrigComp })
        ),
      }),
    });

    // F01A: No-op re-sync (#tab-10 = 2.5 / 0) must keep APPROVED & practiceScore=null
    ClassSyncer.syncLmsSlotCompletionToSqlite({
      db: getDb(),
      classId: csaClass,
      students: [studentRepo.findOne("ST_F01_WAIT", csaClass)!].filter(Boolean),
      slots: [
        {
          index: 4,
          studentAttendance: [
            {
              student: { id: "ST_F01_WAIT", fullName: "Học Viên Chờ Chấm F01" },
              status: "ATTENDED",
              comment: f01TextWait,
              commentByAreas: [
                { type: "CHECKPOINT", checkpoint: { checkpointScore: 2.5, practiceScore: 0 } },
              ],
            },
          ],
        },
      ],
      preferLmsVerified: false,
    });
    const f01aRow = sessionFeedbackRepo.findOne(csaClass, `${csaClass}_SESS_05`, "ST_F01_WAIT")!;
    const f01aCp = parseCheckpointDataJson(f01aRow.checkpointDataJson)!;
    assert.equal(f01aRow.status, "APPROVED", "F01A: No-op re-sync trên HV chờ chấm không được hạ APPROVED -> DRAFT");
    assert.equal(f01aCp.practiceScore, null, "F01A: Không được ghi đè practiceScore: null -> 0");
    assert.equal(f01aCp.hasUngradedPractice, true, "F01A: Giữ nguyên cờ chờ chấm");
    assert.ok(f01aRow.finalText?.includes("Thực hành **Chưa nhập**"), "F01A: Giữ nguyên Thực hành Chưa nhập");

    // F01B: Grading 4.0 clears hasUngradedPractice both in DB and mergeCheckpointStudentData
    ClassSyncer.syncLmsSlotCompletionToSqlite({
      db: getDb(),
      classId: csaClass,
      students: [studentRepo.findOne("ST_F01_WAIT", csaClass)!].filter(Boolean),
      slots: [
        {
          index: 4,
          studentAttendance: [
            {
              student: { id: "ST_F01_WAIT", fullName: "Học Viên Chờ Chấm F01" },
              status: "ATTENDED",
              comment: f01TextWait,
              commentByAreas: [
                { type: "CHECKPOINT", checkpoint: { checkpointScore: 2.5, practiceScore: 4 } },
              ],
            },
          ],
        },
      ],
      preferLmsVerified: false,
    });
    const f01bRow = sessionFeedbackRepo.findOne(csaClass, `${csaClass}_SESS_05`, "ST_F01_WAIT")!;
    const f01bCp = parseCheckpointDataJson(f01bRow.checkpointDataJson)!;
    assert.equal(f01bCp.practiceScore, 4, "F01B: Chấm 4.0 trên #tab-10 phải lưu practiceScore=4");
    assert.equal(f01bCp.hasUngradedPractice, false, "F01B: Đã có điểm TH thì hasUngradedPractice phải về false");
    const f01bMerged = mergeCheckpointStudentData(f01bCp, {
      ...f01bCp,
      practiceScore: null,
      hasUngradedPractice: true,
    });
    assert.equal(f01bMerged?.practiceScore, 4);
    assert.equal(f01bMerged?.hasUngradedPractice, false, "F01B: mergeCheckpointStudentData không được giữ kẹt hasUngradedPractice=true khi đã có điểm");

    // F02: Coding class without CHECKPOINT column in score_matrix_cache must NOT read circular class_report_cards
    const jsbClass = "VT-JSB16-F2";
    const jsbSess = `${jsbClass}_SESS_05`;
    studentRepo.upsert({ studentId: "ST_JSB_1", classId: jsbClass, fullName: "Học Viên Hạ 0", isActive: 1 });
    studentRepo.upsert({ studentId: "ST_JSB_2", classId: jsbClass, fullName: "Học Viên Reset LMS", isActive: 1 });
    classSessionRepo.upsert({
      classId: jsbClass,
      className: jsbClass,
      sessionId: jsbSess,
      sessionNumber: 5,
      topic: "CP1 JSB",
      date: "14/11/2026",
    });
    scoreMatrixRepo.save(jsbClass, {
      success: true,
      classId: jsbClass,
      classCode: jsbClass,
      columns: [{ colIndex: 0, columnId: "HW1", title: "HW1", sessionNumber: 1, lessonType: "REVIEW_AND_PRACTICE" }],
      rows: [
        {
          studentId: "ST_JSB_1",
          studentUid: "uid_jsb_1",
          fullName: "Học Viên Hạ 0",
          isActive: true,
          cells: { HW1: { columnId: "HW1", sessionNumber: 1, status: "GRADED", score: 80, quizScore: 90, maxScore: 100, rawText: "80/100" } },
          averageScore: 80,
          gradedCount: 1,
          submittedUngradedCount: 0,
          notSubmittedCount: 0,
          redoCount: 0,
        },
        {
          studentId: "ST_JSB_2",
          studentUid: "uid_jsb_2",
          fullName: "Học Viên Reset LMS",
          isActive: true,
          cells: { HW1: { columnId: "HW1", sessionNumber: 1, status: "GRADED", score: 80, quizScore: 90, maxScore: 100, rawText: "80/100" } },
          averageScore: 80,
          gradedCount: 1,
          submittedUngradedCount: 0,
          notSubmittedCount: 0,
          redoCount: 0,
        },
      ],
      summary: { totalStudents: 2, totalColumns: 1, gradedCells: 2, submittedUngradedCells: 0, notSubmittedCells: 0, redoCells: 0, zeroScoreCells: 0 },
      scrapedAt: new Date().toISOString(),
    } as any);
    reportCardRepo.saveLmsSnapshot(jsbClass, {
      classId: jsbClass,
      classCode: jsbClass,
      isRobotics: false,
      btvnSessions: [],
      students: [
        {
          studentId: "ST_JSB_1",
          fullName: "Học Viên Hạ 0",
          isActive: true,
          btvnScores: {},
          stageScores: {
            cp1Theory: 4,
            cp1Practice: 4,
            cp1Competency: null,
            cp2Theory: null,
            cp2Practice: null,
            cp2Competency: null,
            finalProduct: null,
            finalCompetency: null,
          },
        },
        {
          studentId: "ST_JSB_2",
          fullName: "Học Viên Reset LMS",
          isActive: true,
          btvnScores: {},
          stageScores: {
            cp1Theory: 2.5,
            cp1Practice: 4.5,
            cp1Competency: null,
            cp2Theory: null,
            cp2Practice: null,
            cp2Competency: null,
            finalProduct: null,
            finalCompetency: null,
          },
        },
      ],
      scrapedAt: new Date().toISOString(),
    });
    assert.equal(
      extractCheckpointSubmissionScoresForClass(jsbClass, 1, false).size,
      0,
      "F02: Lớp không có cột CHECKPOINT trong #tab-3 không được đọc ngược class_report_cards"
    );
    sessionFeedbackRepo.upsert({
      classId: jsbClass,
      sessionId: jsbSess,
      studentId: "ST_JSB_1",
      attendanceStatus: "PRESENT",
      status: "DRAFT",
      checkpointDataJson: JSON.stringify({
        cpStage: 1,
        isRobotics: false,
        theoryScore: 0,
        practiceScore: 4,
        slotTheoryScore: 0,
        slotPracticeScore: 4,
      }),
    });
    sessionFeedbackRepo.upsert({
      classId: jsbClass,
      sessionId: jsbSess,
      studentId: "ST_JSB_2",
      attendanceStatus: "PRESENT",
      status: "DRAFT",
      checkpointDataJson: JSON.stringify({
        cpStage: 1,
        isRobotics: false,
        theoryScore: 2.5,
        practiceScore: null,
        slotTheoryScore: 2.5,
        slotPracticeScore: null,
        userEditedPractice: false,
      }),
    });
    const jsbComputed = computeCheckpointDataForSession({
      classId: jsbClass,
      sessionId: jsbSess,
      sessionNumber: 5,
      forceRecalculate: true,
      persist: true,
    });
    assert.equal(jsbComputed.byStudent["ST_JSB_1"]?.theoryScore, 0, "F02: Hạ #tab-10 4.0->0.0 không bị hồi sinh thành 4.0");
    assert.equal(jsbComputed.byStudent["ST_JSB_2"]?.practiceScore, null, "F02: Reset ↺ LMS về null không bị hồi sinh thành 4.5");

    // Seed F03 (VT-CSA04-F3): DRAFT had practiceScore=null; #tab-3 updated to 80/100 (4.0)
    const f03Class = "VT-CSA04-F3";
    const f03Sess = `${f03Class}_SESS_05`;
    studentRepo.upsert({ studentId: "ST_KHOA_F3", classId: f03Class, fullName: "Nguyễn Trung Khoa F3", isActive: 1 });
    studentRepo.upsert({ studentId: "ST_STALE_F3", classId: f03Class, fullName: "Học Viên Stale F3", isActive: 1 });
    classSessionRepo.upsert({
      classId: f03Class,
      className: f03Class,
      sessionId: f03Sess,
      sessionNumber: 5,
      topic: "CP1 F3",
      date: "14/11/2026",
    });
    const f03OrigText =
      "📊 **Kết quả Checkpoint 1:** Lý thuyết **2.5/5.0** | Thực hành **Chưa nhập** | Điểm năng lực **4.00/5.0**\n- **Điểm mạnh của học viên:** Tốt.\n\n- **Điểm cần cải thiện:** Cần ôn.\n\n- **Lời khuyên:** Luyện.";
    for (const sid of ["ST_KHOA_F3", "ST_STALE_F3"]) {
      sessionFeedbackRepo.upsert({
        classId: f03Class,
        sessionId: f03Sess,
        studentId: sid,
        attendanceStatus: "PRESENT",
        finalText: f03OrigText,
        status: "DRAFT",
        versionMetaJson: JSON.stringify({ rowVer: 1, fields: {} }),
        checkpointDataJson: JSON.stringify({
          cpStage: 1,
          isRobotics: false,
          theoryScore: 2.5,
          practiceScore: null,
          slotTheoryScore: 2.5,
          slotPracticeScore: 0,
          hasUngradedPractice: true,
          competencyScores: robOrigComp,
          competencyAverage: 4,
        }),
      });
    }
    scoreMatrixRepo.save(f03Class, {
      success: true,
      classId: f03Class,
      classCode: f03Class,
      columns: [
        {
          colIndex: 0,
          columnId: "cp1_col_f3",
          lessonId: "cp1_col_f3",
          title: "Bài kiểm tra định kỳ lần 1 - CP1",
          sessionNumber: 1,
          lessonType: "CHECKPOINT",
        },
      ],
      rows: [
        {
          studentId: "ST_KHOA_F3",
          studentUid: "uid_khoa_f3",
          fullName: "Nguyễn Trung Khoa F3",
          isActive: true,
          cells: {
            cp1_col_f3: {
              columnId: "cp1_col_f3",
              sessionNumber: 1,
              status: "GRADED",
              score: 80,
              quizScore: 50,
              maxScore: 100,
              attachments: ["khoa.ipynb"],
              submittedAt: "2026-11-22",
              rawText: "80/100",
            },
          },
          averageScore: 80,
          gradedCount: 1,
          submittedUngradedCount: 0,
          notSubmittedCount: 0,
          redoCount: 0,
        },
        {
          studentId: "ST_STALE_F3",
          studentUid: "uid_stale_f3",
          fullName: "Học Viên Stale F3",
          isActive: true,
          cells: {
            cp1_col_f3: {
              columnId: "cp1_col_f3",
              sessionNumber: 1,
              status: "GRADED",
              score: 80,
              quizScore: 50,
              maxScore: 100,
              attachments: ["stale.ipynb"],
              submittedAt: "2026-11-22",
              rawText: "80/100",
            },
          },
          averageScore: 80,
          gradedCount: 1,
          submittedUngradedCount: 0,
          notSubmittedCount: 0,
          redoCount: 0,
        },
      ],
      summary: { totalStudents: 2, totalColumns: 1, gradedCells: 2, submittedUngradedCells: 0, notSubmittedCells: 0, redoCells: 0, zeroScoreCells: 0 },
      scrapedAt: new Date().toISOString(),
    } as any);

    // Seed F04 (VT-CSA04-F4): APPROVED report card with cp1Practice=null
    const f04Class = "VT-CSA04-F4";
    const f04Sess = `${f04Class}_SESS_05`;
    studentRepo.upsert({ studentId: "ST_KHOA_F4", classId: f04Class, fullName: "Nguyễn Trung Khoa F4", isActive: 1 });
    classSessionRepo.upsert({
      classId: f04Class,
      className: f04Class,
      sessionId: f04Sess,
      sessionNumber: 5,
      topic: "CP1 F4",
      date: "14/11/2026",
    });
    sessionFeedbackRepo.upsert({
      classId: f04Class,
      sessionId: f04Sess,
      studentId: "ST_KHOA_F4",
      attendanceStatus: "PRESENT",
      finalText: f03OrigText,
      status: "DRAFT",
      checkpointDataJson: JSON.stringify({
        cpStage: 1,
        isRobotics: false,
        theoryScore: 2.5,
        practiceScore: null,
        slotTheoryScore: 2.5,
        slotPracticeScore: null,
        competencyScores: robOrigComp,
        competencyAverage: 4,
      }),
    });
    const rcF4Init = reportCardRepo.saveLmsSnapshot(f04Class, {
      classId: f04Class,
      classCode: f04Class,
      isRobotics: false,
      btvnSessions: [],
      students: [
        {
          studentId: "ST_KHOA_F4",
          fullName: "Nguyễn Trung Khoa F4",
          isActive: true,
          btvnScores: {},
          stageScores: {
            cp1Theory: 2.5,
            cp1Practice: null,
            cp1Competency: 4,
            cp2Theory: null,
            cp2Practice: null,
            cp2Competency: null,
            finalProduct: null,
            finalCompetency: null,
          },
        },
      ],
      scrapedAt: "2026-11-23T01:00:00.000Z",
    });
    const rcF4Approve = reportCardRepo.approveReportCard(f04Class, rcF4Init.draftVersion);
    assert.equal(rcF4Approve.success, true);

    // Also test direct DB upsert drift reconciliation on a separate APPROVED report card class VT-CSA04-F4B
    const f04DirectClass = "VT-CSA04-F4B";
    const f04DirectSess = `${f04DirectClass}_SESS_05`;
    studentRepo.upsert({ studentId: "ST_KHOA_F4B", classId: f04DirectClass, fullName: "Nguyễn Trung Khoa F4B", isActive: 1 });
    classSessionRepo.upsert({
      classId: f04DirectClass,
      className: f04DirectClass,
      sessionId: f04DirectSess,
      sessionNumber: 5,
      topic: "CP1 F4B",
      date: "14/11/2026",
    });
    const rcF4BInit = reportCardRepo.saveLmsSnapshot(f04DirectClass, {
      classId: f04DirectClass,
      classCode: f04DirectClass,
      isRobotics: false,
      btvnSessions: [],
      students: [
        {
          studentId: "ST_KHOA_F4B",
          fullName: "Nguyễn Trung Khoa F4B",
          isActive: true,
          btvnScores: {},
          stageScores: {
            cp1Theory: 2.5,
            cp1Practice: null,
            cp1Competency: 4,
            cp2Theory: null,
            cp2Practice: null,
            cp2Competency: null,
            finalProduct: null,
            finalCompetency: null,
          },
        },
      ],
      scrapedAt: "2026-11-23T01:00:00.000Z",
    });
    assert.equal(reportCardRepo.approveReportCard(f04DirectClass, rcF4BInit.draftVersion).success, true);
    sessionFeedbackRepo.upsert({
      classId: f04DirectClass,
      sessionId: f04DirectSess,
      studentId: "ST_KHOA_F4B",
      attendanceStatus: "PRESENT",
      status: "DRAFT",
      checkpointDataJson: JSON.stringify({
        cpStage: 1,
        isRobotics: false,
        theoryScore: 2.5,
        practiceScore: 3.5,
        userEditedPractice: true,
      }),
    });
    console.log("  -> PASS V386-06a.");

    // =========================================================================
    // [V386-07a] Hồi quy Round 2 (R2-F02 legacy undefined slotPractice & seed VT-CSA04-R2)
    // =========================================================================
    console.log("\n[V386-07a] Kiểm tra hồi quy R2-F02 (legacy Coding slotPracticeScore=undefined 4.0->0.0) & seed R2-F01...");
    const legClass = "VT-LEG-R2";
    const legSess = `${legClass}_SESS_05`;
    studentRepo.upsert({ studentId: "ST_LEG_1", classId: legClass, fullName: "Học Viên Legacy Cũ", isActive: 1 });
    classSessionRepo.upsert({
      classId: legClass,
      className: legClass,
      sessionId: legSess,
      sessionNumber: 5,
      topic: "CP1 Legacy",
      date: "14/11/2026",
    });
    const legOrigText =
      "📊 **Kết quả Checkpoint 1:** Lý thuyết **4.0/5.0** | Thực hành **4.0/5.0** | Điểm năng lực **4.00/5.0**\n- **Điểm mạnh của học viên:** Tốt.\n\n- **Điểm cần cải thiện:** Cần ôn.\n\n- **Lời khuyên:** Luyện.";
    sessionFeedbackRepo.upsert({
      classId: legClass,
      sessionId: legSess,
      studentId: "ST_LEG_1",
      attendanceStatus: "PRESENT",
      finalText: legOrigText,
      contentHash: sha256(legOrigText),
      status: "APPROVED",
      checkpointDataJson: JSON.stringify({
        cpStage: 1,
        isRobotics: false,
        theoryScore: 4,
        practiceScore: 4,
        // Notice: slotPracticeScore & slotTheoryScore are intentionally omitted (pre-v3.8.6 legacy record!)
        competencyScores: robOrigComp,
        competencyAverage: 4,
        approvedSnapshotHash: extractCheckpointCoreSnapshotHash(
          JSON.stringify({ cpStage: 1, theoryScore: 4, practiceScore: 4, competencyScores: robOrigComp })
        ),
      }),
    });
    ClassSyncer.syncLmsSlotCompletionToSqlite({
      db: getDb(),
      classId: legClass,
      students: [studentRepo.findOne("ST_LEG_1", legClass)!].filter(Boolean),
      slots: [
        {
          index: 4,
          studentAttendance: [
            {
              student: { id: "ST_LEG_1", fullName: "Học Viên Legacy Cũ" },
              status: "ATTENDED",
              comment: legOrigText,
              commentByAreas: [
                { type: "CHECKPOINT", checkpoint: { checkpointScore: 4, practiceScore: 0 } },
              ],
            },
          ],
        },
      ],
      preferLmsVerified: false,
    });
    const legAfter = sessionFeedbackRepo.findOne(legClass, legSess, "ST_LEG_1")!;
    const legAfterCp = parseCheckpointDataJson(legAfter.checkpointDataJson)!;
    assert.equal(legAfter.status, "DRAFT", "R2-F02: Legacy Coding 4.0->0.0 phải hạ APPROVED -> DRAFT");
    assert.equal(legAfterCp.practiceScore, 0, "R2-F02: Legacy Coding không được kẹt 4.0 khi #tab-10 hạ xuống 0.0");
    assert.equal(legAfterCp.slotPracticeScore, 0);
    assert.ok(legAfter.finalText?.includes("Thực hành **0.0/5.0**"));

    // Seed VT-CSA04-R2 for R2-F01 HTTP verification (APPROVED report card with 4.0/4.5 & 3.5/3.75)
    const r2Class = "VT-CSA04-R2";
    const r2Sess = `${r2Class}_SESS_05`;
    studentRepo.upsert({ studentId: "ST_R2_A", classId: r2Class, fullName: "Học Viên R2 A", isActive: 1 });
    studentRepo.upsert({ studentId: "ST_R2_B", classId: r2Class, fullName: "Học Viên R2 B", isActive: 1 });
    classSessionRepo.upsert({
      classId: r2Class,
      className: r2Class,
      sessionId: r2Sess,
      sessionNumber: 5,
      topic: "CP1 R2",
      date: "14/11/2026",
    });
    // Only ST_R2_B has session_feedbacks (1dp 3.8); ST_R2_A has NO session_feedbacks yet!
    sessionFeedbackRepo.upsert({
      classId: r2Class,
      sessionId: r2Sess,
      studentId: "ST_R2_B",
      attendanceStatus: "PRESENT",
      finalText: legOrigText,
      status: "DRAFT",
      checkpointDataJson: JSON.stringify({
        cpStage: 1,
        isRobotics: false,
        theoryScore: 3.5,
        practiceScore: 3.8,
        slotTheoryScore: 0,
        slotPracticeScore: 0,
        competencyScores: robOrigComp,
        competencyAverage: 4,
      }),
    });
    scoreMatrixRepo.save(r2Class, {
      success: true,
      classId: r2Class,
      classCode: r2Class,
      columns: [
        {
          colIndex: 0,
          columnId: "cp1_col_r2",
          lessonId: "cp1_col_r2",
          title: "Bài kiểm tra định kỳ lần 1 - CP1",
          sessionNumber: 1,
          lessonType: "CHECKPOINT",
        },
      ],
      rows: [
        {
          studentId: "ST_R2_B",
          studentUid: "uid_r2_b",
          fullName: "Học Viên R2 B",
          isActive: true,
          cells: {
            cp1_col_r2: {
              columnId: "cp1_col_r2",
              sessionNumber: 1,
              status: "GRADED",
              score: 75, // 75/100 -> 3.75 exact 2dp!
              quizScore: 70, // 70/100 -> 3.5
              maxScore: 100,
              attachments: ["r2b.ipynb"],
              submittedAt: "2026-11-22",
              rawText: "75/100",
            },
          },
          averageScore: 75,
          gradedCount: 1,
          submittedUngradedCount: 0,
          notSubmittedCount: 0,
          redoCount: 0,
        },
      ],
      summary: { totalStudents: 1, totalColumns: 1, gradedCells: 1, submittedUngradedCells: 0, notSubmittedCells: 0, redoCells: 0, zeroScoreCells: 0 },
      scrapedAt: new Date().toISOString(),
    } as any);
    const r2RcInit = reportCardRepo.saveLmsSnapshot(r2Class, {
      classId: r2Class,
      classCode: r2Class,
      isRobotics: false,
      btvnSessions: [],
      students: [
        {
          studentId: "ST_R2_A",
          fullName: "Học Viên R2 A",
          isActive: true,
          btvnScores: {},
          stageScores: {
            cp1Theory: 4,
            cp1Practice: 4.5,
            cp1Competency: 4,
            cp2Theory: null,
            cp2Practice: null,
            cp2Competency: null,
            finalProduct: null,
            finalCompetency: null,
          },
        },
        {
          studentId: "ST_R2_B",
          fullName: "Học Viên R2 B",
          isActive: true,
          btvnScores: {},
          stageScores: {
            cp1Theory: 3.5,
            cp1Practice: 3.75,
            cp1Competency: 4,
            cp2Theory: null,
            cp2Practice: null,
            cp2Competency: null,
            finalProduct: null,
            finalCompetency: null,
          },
        },
      ],
      scrapedAt: "2026-11-23T01:00:00.000Z",
    });
    assert.equal(reportCardRepo.approveReportCard(r2Class, r2RcInit.draftVersion).success, true);
    console.log("  -> PASS V386-07a.");

    // =========================================================================
    // [V386-05] Live Headless Chromium E2E (:3095) Light & Dark + Manual LT/TH UI
    // =========================================================================
    console.log("\n[V386-05] Khởi chạy Next.js E2E (:3095) kiểm thử UI Sửa tay LT/TH, Reset LMS & Light/Dark...");
    saveRunningClasses([
      { classCode: csaClass, courseName: "CSA04", status: "Running", startDate: "01/11/2026", endDate: "01/02/2027" },
    ]);
    closeDb();

    fs.rmSync(e2eDistAbs, { recursive: true, force: true });
    fs.mkdirSync(e2eDistAbs, { recursive: true });
    const rootTsconfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tsconfig.json"), "utf8"));
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
      `${baseUrl}/api/session-comments/list?classId=${csaClass}&sessionId=${csaClass}_SESS_05`,
      60000
    );

    // API Guard checks on save-draft (boolean & >100 theoryScore -> 400; explicit null -> 200)
    const badDraftBool = await fetch(`${baseUrl}/api/session-comments/save-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: csaClass,
        sessionId: `${csaClass}_SESS_05`,
        studentId: "STU_VT-CSA04-HB_NGUYEN_TRUNG_KHOA",
        checkpointData: { cpStage: 1, theoryScore: true },
      }),
    });
    assert.equal(badDraftBool.status, 400, "save-draft phải chặn theoryScore boolean với HTTP 400");

    const badDraftRange = await fetch(`${baseUrl}/api/session-comments/save-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: csaClass,
        sessionId: `${csaClass}_SESS_05`,
        studentId: "STU_VT-CSA04-HB_NGUYEN_TRUNG_KHOA",
        checkpointData: { cpStage: 1, practiceScore: 120 },
      }),
    });
    assert.equal(badDraftRange.status, 400, "save-draft phải chặn practiceScore > 100 với HTTP 400");

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript("globalThis.__name = globalThis.__name || ((x) => x);");
    const page = await context.newPage();

    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (err: Error) => pageErrors.push(err.message));
    page.on("console", (msg: any) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto(`${baseUrl}/session-comments?classId=${csaClass}&sessionNumber=5`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(`[data-testid="cp-score-badge-STU_VT-CSA04-HB_TRAN_HOANG_THIEN"]`, {
      timeout: 45000,
    });

    const brandTitle = await page.textContent("header .mindx-brand-text");
    assert.ok(
      /MindX Bot v3\.(?:8\.(?:[6-9]|\d{2,})|[9]\.\d+|\d{2,}\.\d+)/.test(String(brandTitle || "")),
      `TopNavbar phải hiển thị MindX Bot >= v3.8.6 (actual=${brandTitle})`
    );

    const thienBadge = await page.textContent(`[data-testid="cp-score-badge-STU_VT-CSA04-HB_TRAN_HOANG_THIEN"]`);
    const khangBadge = await page.textContent(`[data-testid="cp-score-badge-STU_VT-CSA04-HB_DANG_TRONG_KHANG"]`);
    assert.ok(thienBadge?.includes("LT: 4.5") && thienBadge?.includes("TH: —"), `Thiên badge: ${thienBadge}`);
    assert.ok(khangBadge?.includes("LT: 3.0") && khangBadge?.includes("TH: 3.0"), `Khang badge: ${khangBadge}`);

    const warnBanner = await page.textContent(`[data-testid="checkpoint-ungraded-practice-warning"]`);
    assert.ok(
      warnBanner?.includes("Nguyễn Trung Khoa") &&
        warnBanner?.includes("Trần Hoàng Thiên") &&
        !warnBanner?.includes("Đặng Trọng Khang"),
      `Banner chờ chấm phải nêu đúng Khoa + Thiên (actual=${warnBanner})`
    );

    // Open Khoa's 9-[ĐNL] modal, verify waiting-th-badge & edit manual-th-input to 3.5
    await page.click(`[data-testid="edit-dnl-btn-STU_VT-CSA04-HB_NGUYEN_TRUNG_KHOA"]`);
    await page.waitForSelector(`[data-testid="checkpoint-dnl-modal"]`, { timeout: 10000 });
    await page.waitForSelector(`[data-testid="waiting-th-badge"]`, { timeout: 5000 });

    // Verify .space-y-2 invariant + Light & Dark contrast on manual-th-input
    const lightInputColors = await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
      document.documentElement.setAttribute("data-theme", "light");
      const inp = document.querySelector('[data-testid="manual-th-input"]') as HTMLElement | null;
      if (!inp) return null;
      const st = getComputedStyle(inp);
      return { bg: st.backgroundColor, color: st.color };
    });
    assert.ok(lightInputColors && lightInputColors.bg !== lightInputColors.color, "Light input contrast");

    const darkInputColors = await page.evaluate(() => {
      document.documentElement.classList.add("dark");
      document.documentElement.setAttribute("data-theme", "dark");
      const inp = document.querySelector('[data-testid="manual-th-input"]') as HTMLElement | null;
      if (!inp) return null;
      const st = getComputedStyle(inp);
      return { bg: st.backgroundColor, color: st.color };
    });
    assert.ok(darkInputColors && darkInputColors.bg !== darkInputColors.color, "Dark input contrast");

    const firstRowCritText = await page
      .locator('[data-testid="checkpoint-dnl-modal"] .space-y-2 > div')
      .first()
      .textContent();
    assert.ok(
      firstRowCritText?.includes("[ĐNL]"),
      `Phần tử .space-y-2 > div đầu tiên phải luôn là tiêu chí #1 [ĐNL] (actual=${firstRowCritText})`
    );

    await page.fill(`[data-testid="manual-th-input"]`, "3.5");
    await page.press(`[data-testid="manual-th-input"]`, "Enter");
    await page.waitForSelector(`[data-testid="manual-th-badge"]`, { timeout: 15000 });
    await page.waitForSelector(`[data-testid="reset-manual-th-btn"]`, { timeout: 10000 });

    const khoaBadgeAfterManual = await page.textContent(
      `[data-testid="cp-score-badge-STU_VT-CSA04-HB_NGUYEN_TRUNG_KHOA"]`
    );
    assert.ok(
      khoaBadgeAfterManual?.includes("LT: 2.5") &&
        khoaBadgeAfterManual?.includes("TH: 3.5") &&
        khoaBadgeAfterManual?.includes("✎"),
      `Badge của Khoa sau sửa tay phải hiện TH: 3.5 & ✎ (actual=${khoaBadgeAfterManual})`
    );

    // Reload page completely & verify 3.5 + ✎ Sửa tay persists across reload and flows to Report Card!
    await page.click('[data-testid="checkpoint-dnl-modal"] button:has-text("Đóng")');
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(`[data-testid="cp-score-badge-STU_VT-CSA04-HB_NGUYEN_TRUNG_KHOA"]`, {
      timeout: 30000,
    });
    const khoaBadgeReloaded = await page.textContent(
      `[data-testid="cp-score-badge-STU_VT-CSA04-HB_NGUYEN_TRUNG_KHOA"]`
    );
    assert.ok(khoaBadgeReloaded?.includes("TH: 3.5") && khoaBadgeReloaded?.includes("✎"));

    // Reset TH manual override back to LMS -> restores TH: — and waiting-th-badge
    await page.click(`[data-testid="edit-dnl-btn-STU_VT-CSA04-HB_NGUYEN_TRUNG_KHOA"]`);
    await page.waitForSelector(`[data-testid="reset-manual-th-btn"]`, { timeout: 10000 });
    await page.click(`[data-testid="reset-manual-th-btn"]`);
    await page.waitForSelector(`[data-testid="waiting-th-badge"]`, { timeout: 15000 });

    const khoaBadgeReset = await page.textContent(
      `[data-testid="cp-score-badge-STU_VT-CSA04-HB_NGUYEN_TRUNG_KHOA"]`
    );
    assert.ok(
      khoaBadgeReset?.includes("TH: —") && !khoaBadgeReset?.includes("✎"),
      `Sau reset ↺ LMS phải trả lại TH: — (actual=${khoaBadgeReset})`
    );

    assert.equal(pageErrors.length, 0, `0 pageerror allowed: ${pageErrors.join("; ")}`);
    assert.equal(consoleErrors.length, 0, `0 console.error allowed: ${consoleErrors.join("; ")}`);
    console.log("  -> PASS V386-05.");

    // =========================================================================
    // [V386-06b] Hồi quy HTTP APIs F03, F04, F06 trên Next Server cô lập (:3095)
    // =========================================================================
    console.log("\n[V386-06b] Kiểm tra hồi quy HTTP F03 (Duyệt sau #tab-3), F04 (Chảy sang Phiếu điểm) & F06 (boolean approve)...");

    // F03: Load list (persist:false merges practiceScore=4.0), approve succeeds 200; stale 4.5 still 409!
    const f03ListRes = await fetch(`${baseUrl}/api/session-comments/list?classId=${f03Class}&sessionId=${f03Sess}`);
    assert.equal(f03ListRes.status, 200);
    const f03ListJson = await f03ListRes.json();
    const khoaF3Fb = f03ListJson.data.feedbacks.find((f: any) => f.studentId === "ST_KHOA_F3");
    const khoaF3Computed = f03ListJson.data.checkpointByStudent["ST_KHOA_F3"];
    assert.equal(khoaF3Computed?.practiceScore, 4, "F03: list trả practiceScore=4.0 từ #tab-3");
    const khoaF3Merged = mergeCheckpointStudentData(
      parseCheckpointDataJson(khoaF3Fb.checkpointDataJson),
      khoaF3Computed
    )!;
    const f03HeaderUpdated = formatCheckpointScoreHeaderLine({
      cpStage: 1,
      theoryScore: khoaF3Merged.theoryScore,
      practiceScore: khoaF3Merged.practiceScore,
      competencyAverage: khoaF3Merged.competencyAverage ?? null,
    });
    const f03ApprovedText = String(khoaF3Fb.finalText).replace(
      /^📊[^\n]*/,
      f03HeaderUpdated
    );
    const f03RowVer = JSON.parse(khoaF3Fb.versionMetaJson || '{"rowVer":1}').rowVer;

    const f03ApproveOkRes = await fetch(`${baseUrl}/api/session-comments/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: f03Class,
        sessionId: f03Sess,
        studentId: "ST_KHOA_F3",
        approvedText: f03ApprovedText,
        expectedRowVer: f03RowVer,
        checkpointData: khoaF3Merged,
      }),
    });
    const f03ApproveOkBody = await f03ApproveOkRes.json();
    assert.equal(
      f03ApproveOkRes.status,
      200,
      `F03: Duyệt nhận xét khi #tab-3 vừa cập nhật điểm phải trả 200 (actual=${JSON.stringify(f03ApproveOkBody)})`
    );
    assert.equal(f03ApproveOkBody.success, true);

    // Negative check: stale practiceScore=4.5 (not matching live 4.0) MUST still return 409!
    const staleF3Fb = f03ListJson.data.feedbacks.find((f: any) => f.studentId === "ST_STALE_F3");
    const f03ApproveStaleRes = await fetch(`${baseUrl}/api/session-comments/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: f03Class,
        sessionId: f03Sess,
        studentId: "ST_STALE_F3",
        approvedText: staleF3Fb.finalText,
        expectedRowVer: 1,
        checkpointData: { ...khoaF3Merged, practiceScore: 4.5 },
      }),
    });
    assert.equal(f03ApproveStaleRes.status, 409, "F03: Dữ liệu lệch (4.5 !== 4.0) vẫn phải bị chặn 409 Conflict");

    // F04: Manual TH=3.5 via save-draft flows immediately to GET /api/report-card & demotes APPROVED; reset restores null
    const f04DraftRes = await fetch(`${baseUrl}/api/session-comments/save-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: f04Class,
        sessionId: f04Sess,
        studentId: "ST_KHOA_F4",
        checkpointData: {
          cpStage: 1,
          theoryScore: 2.5,
          practiceScore: 3.5,
          userEditedPractice: true,
        },
      }),
    });
    assert.equal(f04DraftRes.status, 200);

    const rcAfterManualRes = await fetch(`${baseUrl}/api/report-card?classId=${f04Class}`);
    assert.equal(rcAfterManualRes.status, 200);
    const rcAfterManualJson = await rcAfterManualRes.json();
    assert.equal(
      rcAfterManualJson.snapshot?.students?.[0]?.stageScores?.cp1Practice,
      3.5,
      "F04: Điểm TH=3.5 sửa tay phải chảy ngay sang GET /api/report-card snapshot"
    );
    assert.equal(
      rcAfterManualJson.reportCard?.students?.[0]?.cp1?.practice?.value,
      3.5,
      "F04: Điểm TH=3.5 phải hiện ngay trên Phiếu điểm tổng kết"
    );
    assert.equal(
      rcAfterManualJson.record?.status,
      "WAITING_APPROVAL",
      "F04: Sửa điểm tay ở trang Nhận xét phải hạ phiếu điểm đã APPROVED -> WAITING_APPROVAL"
    );
    assert.equal(
      rcAfterManualJson.staleness?.hasNewerManualCheckpoint,
      false,
      "F04: Khi Phiếu điểm đã nhận đúng 3.5 thì không báo stale giả"
    );

    // Reset manual TH via save-draft + checkpoint-sync -> restores null in GET /api/report-card
    const f04ResetDraftRes = await fetch(`${baseUrl}/api/session-comments/save-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: f04Class,
        sessionId: f04Sess,
        studentId: "ST_KHOA_F4",
        checkpointData: {
          cpStage: 1,
          theoryScore: 2.5,
          practiceScore: null,
          userEditedPractice: false,
        },
      }),
    });
    assert.equal(f04ResetDraftRes.status, 200);
    const f04SyncRes = await fetch(`${baseUrl}/api/session-comments/checkpoint-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classCode: f04Class,
        sessionId: f04Sess,
        syncFromLms: false,
        forceRecalculate: false,
      }),
    });
    assert.equal(f04SyncRes.status, 200);
    const rcAfterResetRes = await fetch(`${baseUrl}/api/report-card?classId=${f04Class}`);
    const rcAfterResetJson = await rcAfterResetRes.json();
    assert.equal(
      rcAfterResetJson.snapshot?.students?.[0]?.stageScores?.cp1Practice,
      null,
      "F04: Reset ↺ LMS phải khôi phục cp1Practice về null trên Phiếu điểm"
    );

    // Direct DB upsert on VT-CSA04-F4B (without save-draft) must also flow to GET /api/report-card & demote APPROVED -> WAITING_APPROVAL
    const rcF4BRes = await fetch(`${baseUrl}/api/report-card?classId=VT-CSA04-F4B`);
    assert.equal(rcF4BRes.status, 200);
    const rcF4BJson = await rcF4BRes.json();
    assert.equal(rcF4BJson.snapshot?.students?.[0]?.stageScores?.cp1Practice, 3.5);
    assert.equal(rcF4BJson.reportCard?.students?.[0]?.cp1?.practice?.value, 3.5);
    assert.equal(
      rcF4BJson.record?.status,
      "WAITING_APPROVAL",
      "F04: Direct DB upsert sửa tay cũng phải hạ Phiếu điểm đã APPROVED -> WAITING_APPROVAL"
    );

    // F06: approve rejects boolean theoryScore with HTTP 400
    const badApproveBoolRes = await fetch(`${baseUrl}/api/session-comments/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: f03Class,
        sessionId: f03Sess,
        studentId: "ST_STALE_F3",
        approvedText: staleF3Fb.finalText,
        checkpointData: { cpStage: 1, theoryScore: true },
      }),
    });
    assert.equal(badApproveBoolRes.status, 400, "F06: approve phải chặn theoryScore boolean với HTTP 400");

    console.log("  -> PASS V386-06b.");

    // =========================================================================
    // [V386-07b] Hồi quy HTTP R2-F01 (R2-NEW-01A/B/C: bảo toàn 3.75, ST_A & APPROVED)
    // =========================================================================
    console.log("\n[V386-07b] Kiểm tra hồi quy R2-NEW-01A/B/C (tính lại [ĐNL] & bấm sao [ĐNL] không phá Phiếu điểm 2dp/APPROVED)...");
    const r2SyncRes = await fetch(`${baseUrl}/api/session-comments/checkpoint-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classCode: "VT-CSA04-R2",
        sessionId: "VT-CSA04-R2_SESS_05",
        syncFromLms: false,
        forceRecalculate: true,
      }),
    });
    assert.equal(r2SyncRes.status, 200);
    const rcAfterR2SyncRes = await fetch(`${baseUrl}/api/report-card?classId=VT-CSA04-R2`);
    const rcAfterR2Sync = await rcAfterR2SyncRes.json();
    assert.equal(rcAfterR2Sync.record?.status, "APPROVED", "R2-NEW-01A/B: checkpoint-sync(false) không được hạ APPROVED của Phiếu điểm");
    const r2StuAAfterSync = rcAfterR2Sync.snapshot?.students?.find((s: any) => s.studentId === "ST_R2_A");
    const r2StuBAfterSync = rcAfterR2Sync.snapshot?.students?.find((s: any) => s.studentId === "ST_R2_B");
    assert.equal(r2StuAAfterSync?.stageScores?.cp1Theory, 4, "R2-NEW-01A: Không được xóa cp1Theory của HV chưa đồng bộ");
    assert.equal(r2StuAAfterSync?.stageScores?.cp1Practice, 4.5, "R2-NEW-01A: Không được xóa cp1Practice của HV chưa đồng bộ");
    assert.equal(r2StuBAfterSync?.stageScores?.cp1Practice, 3.75, "R2-NEW-01B: Không được ghi đè 3.75 -> 3.8");

    // R2-NEW-01C: Clicking 1 [ĐNL] star in save-draft MUST NOT touch class_report_cards
    const r2DnlClickRes = await fetch(`${baseUrl}/api/session-comments/save-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: "VT-CSA04-R2",
        sessionId: "VT-CSA04-R2_SESS_05",
        studentId: "ST_R2_B",
        checkpointData: {
          cpStage: 1,
          theoryScore: 3.5,
          practiceScore: 3.8,
          slotTheoryScore: 0,
          slotPracticeScore: 0,
          userEditedTheory: false,
          userEditedPractice: false,
          userEditedCompetency: true,
          competencyScores: { ...robOrigComp, skillCreativity: 5 },
          competencyAverage: 4.11,
        },
      }),
    });
    assert.equal(r2DnlClickRes.status, 200);
    const rcAfterDnlClickRes = await fetch(`${baseUrl}/api/report-card?classId=VT-CSA04-R2`);
    const rcAfterDnlClick = await rcAfterDnlClickRes.json();
    assert.equal(rcAfterDnlClick.record?.status, "APPROVED", "R2-NEW-01C: Chỉ bấm sao [ĐNL] không được hạ APPROVED Phiếu điểm");
    const r2StuBAfterDnl = rcAfterDnlClick.snapshot?.students?.find((s: any) => s.studentId === "ST_R2_B");
    assert.equal(r2StuBAfterDnl?.stageScores?.cp1Practice, 3.75, "R2-NEW-01C: Chỉ bấm sao [ĐNL] phải giữ nguyên 3.75");

    // Surgical manual edit TH=4.2 -> updates ONLY ST_R2_B to 4.2, leaves ST_R2_A 4.0/4.5 intact, then ↺ LMS restores 3.75!
    const r2EditRes = await fetch(`${baseUrl}/api/session-comments/save-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: "VT-CSA04-R2",
        sessionId: "VT-CSA04-R2_SESS_05",
        studentId: "ST_R2_B",
        checkpointData: {
          cpStage: 1,
          theoryScore: 3.5,
          practiceScore: 4.2,
          userEditedPractice: true,
        },
      }),
    });
    assert.equal(r2EditRes.status, 200);
    const rcAfterR2Edit = await (await fetch(`${baseUrl}/api/report-card?classId=VT-CSA04-R2`)).json();
    assert.equal(rcAfterR2Edit.record?.status, "WAITING_APPROVAL");
    assert.equal(rcAfterR2Edit.snapshot?.students?.find((s: any) => s.studentId === "ST_R2_B")?.stageScores?.cp1Practice, 4.2);
    assert.equal(rcAfterR2Edit.snapshot?.students?.find((s: any) => s.studentId === "ST_R2_A")?.stageScores?.cp1Practice, 4.5);

    const r2ResetRes = await fetch(`${baseUrl}/api/session-comments/save-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: "VT-CSA04-R2",
        sessionId: "VT-CSA04-R2_SESS_05",
        studentId: "ST_R2_B",
        checkpointData: {
          cpStage: 1,
          theoryScore: 3.5,
          practiceScore: 0,
          userEditedPractice: false,
        },
      }),
    });
    assert.equal(r2ResetRes.status, 200);
    const rcAfterR2Reset = await (await fetch(`${baseUrl}/api/report-card?classId=VT-CSA04-R2`)).json();
    assert.equal(
      rcAfterR2Reset.snapshot?.students?.find((s: any) => s.studentId === "ST_R2_B")?.stageScores?.cp1Practice,
      3.75,
      "R2-F01: Reset ↺ LMS phải khôi phục chuẩn 2dp 3.75 (từ 75/100 ở #tab-3) chứ không bị 3.8 hay 0"
    );

    console.log("  -> PASS V386-07b.");
    console.log("\n✅ TOÀN BỘ 7 NHÓM KIỂM THỬ v3.8.6 (V386-01..V386-07) ĐỀU PASS 100%!");
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    killProcessTree(nextServer);
    try {
      closeDb();
    } catch {}
    await sleep(300);
    fs.rmSync(e2eDistAbs, { recursive: true, force: true });
    fs.rmSync(e2eTsconfigAbs, { force: true });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    if (!hadNextEnv && fs.existsSync(nextEnvPath)) {
      fs.unlinkSync(nextEnvPath);
    } else if (hadNextEnv && origNextEnvBytes) {
      const curBytes = fs.existsSync(nextEnvPath) ? fs.readFileSync(nextEnvPath) : null;
      if (!curBytes || !curBytes.equals(origNextEnvBytes)) {
        fs.writeFileSync(nextEnvPath, origNextEnvBytes);
      }
    }
  }
}

main().catch((err) => {
  console.error("❌ TEST v3.8.6 FAILED:", err);
  process.exit(1);
});
