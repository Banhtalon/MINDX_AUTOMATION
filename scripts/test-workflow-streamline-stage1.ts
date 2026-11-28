/**
 * KIỂM THỬ TOÀN DIỆN CHẶNG 1 — STREAMLINE QUY TRÌNH DẠY HỌC & GHI NHẬN XÉT API
 *
 * Bao phủ đầy đủ S1-01 .. S1-05 & các ca hồi quy Round 2 (F01 .. F11):
 * - [S1-01] `lookupPreviousSessionUnsubmittedBtvn` + `btvn-from-lms` + `sync-btvn` + F06/F07
 * - [S1-02] `ClassSyncer.syncLmsSlotCompletionToSqlite` + F04 (bảo vệ APPROVED/VERIFIED Checkpoint)
 * - [S1-03] `filterInheritableQuickTags` + `list` route + F08 (loại trừ VERIFIED/SAVING khỏi pendingLogs)
 * - [S1-04] LEGO [5,9] 7 sao / 7 vs VEX [4,8] 9 sao / 9 + F05 (Zalo Checkpoint LEGO) + F11 (save-draft/approve/CommentGenerator/zalo-summary)
 * - [S1-05] `uploadSessionCommentsViaApi` & `CommentSaver.saveComments` + F01/F02/F03 + F09/F10
 *
 * Chạy 100% cô lập trong `os.tmpdir()` — KHÔNG chạm `data/` thật.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import type { CompetencyScores } from "../src/lib/checkpoint/competency-specs";

const REAL_DATA_FILES = [
  path.resolve(process.cwd(), "data", "mindx_bot.db"),
  path.resolve(process.cwd(), "data", "running_classes.json"),
  path.resolve(process.cwd(), "data", "config", "lms_class_ids.json"),
  path.resolve(process.cwd(), "data", "config", "courses_syllabus.json"),
  path.resolve(process.cwd(), "data", "config", "quick_tags.json"),
];

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function sha256Text(text: string): string {
  return crypto.createHash("sha256").update(String(text || "").trim(), "utf8").digest("hex");
}

function makeFakeJwt(email: string): string {
  const h = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
  const p = Buffer.from(
    JSON.stringify({
      email,
      exp: Math.floor(Date.now() / 1000) + 7200,
      user_id: "uid_stage1_test",
    })
  ).toString("base64url");
  return `${h}.${p}.${crypto.randomBytes(8).toString("base64url")}`;
}

async function main() {
  const baselineHashes = REAL_DATA_FILES.map((fp) => ({
    path: fp,
    sha256: sha256File(fp),
  }));

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-stage1-"));
  const tmpConfigDir = path.join(tmpRoot, "config");
  const tmpTokenDir = path.join(tmpRoot, "tokens");
  const tmpRoleStateDir = path.join(tmpRoot, "role-state");
  const tmpDbPath = path.join(tmpRoot, "mindx_stage1.db");
  const tmpRunningClassesPath = path.join(tmpRoot, "running_classes.json");
  const tmpLmsClassIdsPath = path.join(tmpConfigDir, "lms_class_ids.json");
  fs.mkdirSync(tmpConfigDir, { recursive: true });
  fs.mkdirSync(tmpTokenDir, { recursive: true });
  fs.mkdirSync(tmpRoleStateDir, { recursive: true });

  const realConfigDir = path.join(process.cwd(), "data", "config");
  for (const cfgFile of ["courses_syllabus.json", "quick_tags.json"]) {
    const srcPath = path.join(realConfigDir, cfgFile);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, path.join(tmpConfigDir, cfgFile));
    }
  }

  fs.writeFileSync(
    path.join(tmpTokenDir, "lms_token_teacher.json"),
    JSON.stringify({
      role: "TEACHER",
      username: "teacher.stage1@mindx.net.vn",
      email: "teacher.stage1@mindx.net.vn",
      userId: "uid_teacher_stage1",
      firebaseApiKey: "AIzaDummyApiKeyStage1",
      idToken: makeFakeJwt("teacher.stage1@mindx.net.vn"),
      refreshToken: "refresh_teacher_stage1",
      expiresAtMs: Date.now() + 3600_000,
      updatedAt: new Date().toISOString(),
    }),
    "utf8"
  );

  (process.env as Record<string, string | undefined>).NODE_ENV = "test";
  process.env.MINDX_DB_PATH = tmpDbPath;
  process.env.MINDX_CONFIG_DIR = tmpConfigDir;
  process.env.MINDX_RUNNING_CLASSES_PATH = tmpRunningClassesPath;
  process.env.MINDX_LMS_CLASS_IDS_PATH = tmpLmsClassIdsPath;
  process.env.MINDX_ROLE_STATE_DIR = tmpRoleStateDir;
  process.env.MINDX_LMS_TOKEN_DIR = tmpTokenDir;
  process.env.ALLOWED_LOCAL_DIRS = tmpRoot;
  process.env.MINDX_ALLOWED_EXTRA_PATHS = tmpRoot;
  process.env.MINDX_ALLOW_TEST_HOSTS = "1";
  process.env.MINDX_LMS_API_READ = "true";
  process.env.MINDX_LMS_API_WRITE = "true";
  process.env.LMS_USERNAME = "teacher.stage1@mindx.net.vn";
  process.env.LMS_PASSWORD = "TeacherDummySecret#Stage1";
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "TEST_STAGE1_DUMMY_KEY";

  const {
    calculateSha256,
    classSessionRepo,
    classroomSessionLogRepo,
    closeDb,
    extractCheckpointCoreSnapshotHash,
    getDb,
    homeworkSubmissionRepo,
    reportCardRepo,
    scoreMatrixRepo,
    sessionFeedbackRepo,
    studentRepo,
  } = await import("../src/lib/db/sqlite");
  const { getCoursesSyllabus, getQuickTags, saveRunningClasses } = await import(
    "../src/lib/db/json-config"
  );
  const { BtvnLookupError, lookupPreviousSessionUnsubmittedBtvn } = await import(
    "../src/lib/homework/lms-btvn-lookup"
  );
  const { POST: btvnFromLmsPOST } = await import(
    "../src/app/api/session-comments/btvn-from-lms/route"
  );
  const { POST: cmSyncBtvnPOST } = await import(
    "../src/app/api/classroom-manager/sync-btvn/route"
  );
  const { POST: cmSavePOST } = await import("../src/app/api/classroom-manager/save/route");
  const { POST: cmApplyPOST } = await import(
    "../src/app/api/classroom-manager/apply-to-comments/route"
  );
  const { GET: sessionCommentsListGET } = await import(
    "../src/app/api/session-comments/list/route"
  );
  const { ClassSyncer } = await import("../src/lib/playwright/sync-class");
  const {
    filterInheritableQuickTags,
    getDefaultCheckpointSessions,
    resolveCheckpointSessionsForClass,
  } = await import("../src/lib/quick-tags/index");
  const {
    COMPETENCY_AREA_SPECS,
    LEGO_COMPETENCY_AREA_SPECS,
    calculateCompetencyAverageForClassPure,
    getCompetencyKeysForClassPure,
    getCompetencySpecsForClassPure,
    isLegoRoboticsClassCodePure,
    isRoboticsClassCodePure,
  } = await import("../src/lib/checkpoint/competency-specs");
  const {
    buildCheckpointZaloSummaryBlock,
    formatCheckpointScoreHeaderLine,
    parseCheckpointDataJson,
    resolveCheckpointStageForSession,
  } = await import("../src/lib/checkpoint/checkpoint-competency");
  const { buildAutoZaloBroadcastText, isRoboticsClassForZalo } = await import(
    "../src/lib/zalo/zalo-summary"
  );
  const { POST: sessionSaveDraftPOST } = await import(
    "../src/app/api/session-comments/save-draft/route"
  );
  const { POST: sessionApprovePOST } = await import(
    "../src/app/api/session-comments/approve/route"
  );
  const { CommentGenerator } = await import("../src/lib/gemini/comment-generator");
  const { ScoreScraper } = await import("../src/lib/playwright/scrape-scores");
  const { LmsWriteStrictError, uploadSessionCommentsViaApi } = await import(
    "../src/lib/lms/lms-write-client"
  );
  const { setLmsHttpTransportForTest } = await import("../src/lib/lms/lms-http-client");
  const { CommentSaver } = await import("../src/lib/playwright/save-comments");
  const { BrowserManager } = await import("../src/lib/playwright/browser-manager");
  const { authService } = await import("../src/lib/playwright/auth");
  const { LmsHelpers } = await import("../src/lib/playwright/lms-helpers");

  const bm = BrowserManager.getInstance();
  const origGetPage = bm.getPage.bind(bm);
  const origEnsureAuth = authService.ensureAuthenticated.bind(authService);
  const origOpenDrawer = LmsHelpers.openClassDrawer.bind(LmsHelpers);
  const origSwitchTab = LmsHelpers.switchDrawerTab.bind(LmsHelpers);
  const origScrapeClassScores = ScoreScraper.scrapeClassScores.bind(ScoreScraper);
  const origGlobalFetch = globalThis.fetch;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

  try {
    console.log("=== BẮT ĐẦU KIỂM THỬ CHẶNG 1 (S1-01 .. S1-05) TRONG TEMP ===");

    // =========================================================================
    // [S1-01] lookupPreviousSessionUnsubmittedBtvn + BTVN API routes
    // =========================================================================
    console.log("\n[S1-01] Kiểm tra tra cứu BTVN buổi trước từ LMS & 2 API routes...");
    const codingId = "VT-C4K-PTA13";
    saveRunningClasses([
      {
        classCode: codingId,
        courseName: "PTA13",
        status: "Running",
        startDate: "10/10/2026",
        endDate: "10/01/2027",
      },
      {
        classCode: "VT-C4K-GA39",
        courseName: "GA39",
        status: "Running",
        startDate: "10/10/2026",
        endDate: "10/01/2027",
      },
      {
        classCode: "VT-KIND-ROB4I01",
        courseName: "Robotics 4+ Intensive",
        status: "Running",
        startDate: "10/10/2026",
        endDate: "10/01/2027",
      },
    ]);

    for (let s = 1; s <= 13; s++) {
      classSessionRepo.upsert({
        classId: codingId,
        className: codingId,
        sessionId: `${codingId}_SESS_${String(s).padStart(2, "0")}`,
        sessionNumber: s,
        topic: s === 5 ? "Checkpoint 1" : `Bài ${s}`,
        date: `10/11/2026`,
      });
    }

    const s1Students = [
      { id: "ST_01", name: "Nguyễn Thành Phong", active: 1 },
      { id: "ST_02", name: "Trần Minh Khôi", active: 1 },
      { id: "ST_03", name: "Lê Hoàng Bách", active: 1 },
      { id: "ST_04", name: "Phạm Bảo Ngọc", active: 1 },
      { id: "ST_INACT", name: "Đoàn Văn Nghỉ", active: 0 },
    ];
    for (const st of s1Students) {
      studentRepo.upsert({
        studentId: st.id,
        classId: codingId,
        fullName: st.name,
        isActive: st.active,
      });
    }

    scoreMatrixRepo.save(codingId, {
      success: true,
      classId: codingId,
      columns: [
        {
          colIndex: 0,
          columnId: "COL_HW1",
          lessonId: "COL_HW1",
          title: "Homework 1",
          sessionNumber: 1,
          lessonType: "REVIEW_AND_PRACTICE",
        },
        {
          colIndex: 1,
          columnId: "COL_CP4_MIS",
          lessonId: "COL_CP4_MIS",
          title: "Bài kiểm tra định kỳ lần 1 - CP1",
          sessionNumber: 4,
          lessonType: "CHECKPOINT",
        },
        {
          colIndex: 2,
          columnId: "COL_CP1",
          lessonId: "COL_CP1",
          title: "Kiểm tra định kỳ lần 1 - CP1",
          sessionNumber: 5,
          lessonType: "CHECKPOINT",
        },
        {
          colIndex: 3,
          columnId: "COL_HW5",
          lessonId: "COL_HW5",
          title: "Homework 5 - Ôn tập Checkpoint 1",
          sessionNumber: 5,
          lessonType: "REVIEW_AND_PRACTICE",
        },
      ],
      rows: [
        {
          studentId: "ST_01",
          fullName: "Nguyễn Thành Phong",
          isActive: true,
          cells: {
            COL_HW1: {
              columnId: "COL_HW1",
              sessionNumber: 1,
              status: "NOT_SUBMITTED",
              score: null,
              maxScore: 100,
            },
            COL_CP4_MIS: {
              columnId: "COL_CP4_MIS",
              sessionNumber: 4,
              status: "NOT_SUBMITTED",
              score: null,
              maxScore: 100,
            },
            COL_CP1: {
              columnId: "COL_CP1",
              sessionNumber: 5,
              status: "NOT_SUBMITTED",
              score: null,
              maxScore: 100,
            },
            COL_HW5: {
              columnId: "COL_HW5",
              sessionNumber: 5,
              status: "GRADED",
              score: 90,
              maxScore: 100,
            },
          },
        },
        {
          studentId: "ST_02",
          fullName: "Trần Minh Khôi",
          isActive: true,
          cells: {
            COL_HW1: {
              columnId: "COL_HW1",
              sessionNumber: 1,
              status: "REDO_REQUESTED",
              score: null,
              maxScore: 100,
            },
            COL_CP4_MIS: {
              columnId: "COL_CP4_MIS",
              sessionNumber: 4,
              status: "NOT_SUBMITTED",
              score: null,
              maxScore: 100,
            },
            COL_CP1: {
              columnId: "COL_CP1",
              sessionNumber: 5,
              status: "NOT_SUBMITTED",
              score: null,
              maxScore: 100,
            },
            COL_HW5: {
              columnId: "COL_HW5",
              sessionNumber: 5,
              status: "NOT_SUBMITTED",
              score: null,
              maxScore: 100,
            },
          },
        },
        {
          studentId: "ST_03",
          fullName: "Lê Hoàng Bách",
          isActive: true,
          cells: {
            COL_HW1: {
              columnId: "COL_HW1",
              sessionNumber: 1,
              status: "SUBMITTED_UNGRADED",
              score: null,
              maxScore: 100,
            },
            COL_CP4_MIS: {
              columnId: "COL_CP4_MIS",
              sessionNumber: 4,
              status: "GRADED",
              score: 80,
              maxScore: 100,
            },
            COL_CP1: {
              columnId: "COL_CP1",
              sessionNumber: 5,
              status: "GRADED",
              score: 80,
              maxScore: 100,
            },
            COL_HW5: {
              columnId: "COL_HW5",
              sessionNumber: 5,
              status: "SUBMITTED_UNGRADED",
              score: null,
              maxScore: 100,
            },
          },
        },
        {
          studentId: "ST_04",
          fullName: "Phạm Bảo Ngọc",
          isActive: true,
          cells: {
            COL_HW1: {
              columnId: "COL_HW1",
              sessionNumber: 1,
              status: "GRADED",
              score: 85,
              maxScore: 100,
            },
            COL_CP4_MIS: {
              columnId: "COL_CP4_MIS",
              sessionNumber: 4,
              status: "GRADED",
              score: 95,
              maxScore: 100,
            },
            COL_CP1: {
              columnId: "COL_CP1",
              sessionNumber: 5,
              status: "GRADED",
              score: 95,
              maxScore: 100,
            },
            COL_HW5: {
              columnId: "COL_HW5",
              sessionNumber: 5,
              status: "GRADED",
              score: 100,
              maxScore: 100,
            },
          },
        },
        {
          studentId: "ST_INACT",
          fullName: "Đoàn Văn Nghỉ",
          isActive: false,
          cells: {
            COL_HW1: {
              columnId: "COL_HW1",
              sessionNumber: 1,
              status: "NOT_SUBMITTED",
              score: null,
              maxScore: 100,
            },
            COL_CP4_MIS: {
              columnId: "COL_CP4_MIS",
              sessionNumber: 4,
              status: "NOT_SUBMITTED",
              score: null,
              maxScore: 100,
            },
            COL_CP1: {
              columnId: "COL_CP1",
              sessionNumber: 5,
              status: "NOT_SUBMITTED",
              score: null,
              maxScore: 100,
            },
            COL_HW5: {
              columnId: "COL_HW5",
              sessionNumber: 5,
              status: "NOT_SUBMITTED",
              score: null,
              maxScore: 100,
            },
          },
        },
      ],
    });

    // S1-01a: Coding sessionNumber=2 -> checks targetHomeworkSession=1
    const btvnS2 = await lookupPreviousSessionUnsubmittedBtvn({
      classId: codingId,
      sessionNumber: 2,
    });
    assert.equal(btvnS2.targetHomeworkSession, 1);
    assert.equal(btvnS2.source, "SCORE_MATRIX_CACHE");
    assert.equal(btvnS2.totalActiveStudents, 4, "Không được tính học viên isActive=0");
    assert.deepEqual(btvnS2.unsubmittedStudentIds, ["ST_01", "ST_02"]);
    assert.deepEqual(btvnS2.unsubmittedShortNames, ["Thành Phong", "Minh Khôi"]);
    assert.ok(btvnS2.part2Text.includes("📊 TÌNH TRẠNG BÀI TẬP VỀ NHÀ:"));
    assert.ok(btvnS2.part2Text.includes("Thành Phong, Minh Khôi"));
    assert.equal(btvnS2.part2Text.includes("Văn Nghỉ"), false);

    // S1-01b: Coding sessionNumber=6 -> skips COL_CP1 (CHECKPOINT), uses COL_HW5 ("Homework 5 - Ôn tập Checkpoint 1")
    const btvnS6 = await lookupPreviousSessionUnsubmittedBtvn({
      classId: codingId,
      sessionNumber: 6,
    });
    assert.equal(btvnS6.targetHomeworkSession, 5);
    assert.equal(btvnS6.columnId, "COL_HW5");
    assert.deepEqual(
      btvnS6.unsubmittedStudentIds,
      ["ST_02"],
      "Phải bỏ qua COL_CP1 (ST_01 chưa làm CP1 nhưng đã nộp COL_HW5)"
    );

    // S1-01c: Session 5 -> target=4 ONLY has CHECKPOINT in cache -> MUST trigger live scrape first before MISSING_BTVN_COLUMN
    let scrapeS1cCalls = 0;
    (ScoreScraper as any).scrapeClassScores = async () => {
      scrapeS1cCalls++;
      return {
        success: true,
        classId: codingId,
        columns: [
          { colIndex: 0, columnId: "COL_HW1", lessonId: "COL_HW1", title: "Homework 1", sessionNumber: 1, lessonType: "REVIEW_AND_PRACTICE" },
          { colIndex: 1, columnId: "COL_CP4_MIS", lessonId: "COL_CP4_MIS", title: "Bài kiểm tra định kỳ lần 1 - CP1", sessionNumber: 4, lessonType: "CHECKPOINT" },
        ],
        rows: scoreMatrixRepo.findByClass(codingId)!.matrix.rows,
      };
    };
    await assert.rejects(
      () => lookupPreviousSessionUnsubmittedBtvn({ classId: codingId, sessionNumber: 5 }),
      (err: unknown) => err instanceof BtvnLookupError && err.code === "MISSING_BTVN_COLUMN"
    );
    assert.equal(scrapeS1cCalls, 1, "Thiếu cột BTVN mục tiêu trong cache bắt buộc phải gọi live scrape trước");

    // F06: Stale cache has only HW1/HW5 (missing HW3); sessionNumber=4 MUST call live scrape returning HW3 instead of throwing MISSING_BTVN_COLUMN
    let scrapeF06Calls = 0;
    (ScoreScraper as any).scrapeClassScores = async () => {
      scrapeF06Calls++;
      return {
        success: true,
        classId: codingId,
        columns: [
          { colIndex: 0, columnId: "COL_HW3", lessonId: "COL_HW3", title: "Homework 3", sessionNumber: 3, lessonType: "REVIEW_AND_PRACTICE" },
        ],
        rows: [
          { studentId: "ST_01", fullName: "Nguyễn Thành Phong", isActive: true, cells: { COL_HW3: { columnId: "COL_HW3", sessionNumber: 3, status: "GRADED", score: 90, maxScore: 100 } } },
          { studentId: "ST_02", fullName: "Trần Minh Khôi", isActive: true, cells: { COL_HW3: { columnId: "COL_HW3", sessionNumber: 3, status: "NOT_SUBMITTED", score: null, maxScore: 100 } } },
          { studentId: "ST_03", fullName: "Lê Hoàng Bách", isActive: true, cells: { COL_HW3: { columnId: "COL_HW3", sessionNumber: 3, status: "GRADED", score: 100, maxScore: 100 } } },
          { studentId: "ST_04", fullName: "Phạm Bảo Ngọc", isActive: true, cells: { COL_HW3: { columnId: "COL_HW3", sessionNumber: 3, status: "SUBMITTED_UNGRADED", score: null, maxScore: 100 } } },
        ],
      };
    };
    const f06Res = await lookupPreviousSessionUnsubmittedBtvn({ classId: codingId, sessionNumber: 4 });
    assert.equal(scrapeF06Calls, 1, "F06: Cache thiếu HW3 phải gọi live scrape");
    assert.equal(f06Res.source, "LIVE_SCRAPE");
    assert.equal(f06Res.targetHomeworkSession, 3);
    assert.deepEqual(f06Res.unsubmittedStudentIds, ["ST_02"]);

    // S1-01d: Robotics / LEGO & Session 1 MUST be blocked
    await assert.rejects(
      () => lookupPreviousSessionUnsubmittedBtvn({ classId: "VT-ROB-ARMA13", sessionNumber: 3 }),
      (err: unknown) => err instanceof BtvnLookupError && err.code === "ROBOTICS_NOT_SUPPORTED"
    );
    await assert.rejects(
      () => lookupPreviousSessionUnsubmittedBtvn({ classId: "VT-KIND-ROB4I01", sessionNumber: 3 }),
      (err: unknown) => err instanceof BtvnLookupError && err.code === "ROBOTICS_NOT_SUPPORTED"
    );
    await assert.rejects(
      () => lookupPreviousSessionUnsubmittedBtvn({ classId: codingId, sessionNumber: 1 }),
      (err: unknown) =>
        err instanceof BtvnLookupError &&
        (err.code === "SESSION_TOO_LOW" || err.code === "INVALID_SESSION_NUMBER")
    );

    // S1-01e + F07: Missing score_matrix_cache with reportCardRepo snapshot present -> MUST prefer live scrape first (SUBMITTED_UNGRADED not blamed), and fall back to REPORT_CARD_SNAPSHOT ONLY when live scrape fails offline
    const ga39 = "VT-C4K-GA39";
    studentRepo.upsert({ studentId: "GA_01", classId: ga39, fullName: "Lê Minh An", isActive: 1 });
    studentRepo.upsert({ studentId: "GA_02", classId: ga39, fullName: "Vũ Gia Huy", isActive: 1 });
    reportCardRepo.saveLmsSnapshot(ga39, {
      classId: ga39,
      classCode: ga39,
      isRobotics: false,
      btvnSessions: [
        {
          sessionNumber: 1,
          title: "Homework 1",
          lessonId: "GA_L1",
          hasTheory: true,
          hasPractice: true,
          practiceTaskCount: 1,
          maxTheoryScore: 10,
          maxPracticeScore: 100,
        },
      ],
      students: [
        {
          studentId: "GA_01",
          fullName: "Lê Minh An",
          isActive: true,
          btvnScores: {
            1: {
              sessionNumber: 1,
              theoryRaw: 9,
              theoryMax: 10,
              practiceRaw: null,
              practiceMax: 100,
            },
          },
          stageScores: {
            cp1Theory: null,
            cp1Practice: null,
            cp1Competency: null,
            cp2Theory: null,
            cp2Practice: null,
            cp2Competency: null,
            finalProduct: null,
            finalCompetency: null,
          },
        },
        {
          studentId: "GA_02",
          fullName: "Vũ Gia Huy",
          isActive: true,
          btvnScores: {
            1: {
              sessionNumber: 1,
              theoryRaw: 10,
              theoryMax: 10,
              practiceRaw: 95,
              practiceMax: 100,
            },
          },
          stageScores: {
            cp1Theory: null,
            cp1Practice: null,
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
    // F07 online: GA_01 submitted ungraded (NOT blamed), GA_02 not submitted
    (ScoreScraper as any).scrapeClassScores = async () => ({
      success: true,
      classId: ga39,
      columns: [
        { colIndex: 0, columnId: "GA_COL1", lessonId: "GA_COL1", title: "Homework 1", sessionNumber: 1, lessonType: "REVIEW_AND_PRACTICE" },
      ],
      rows: [
        { studentId: "GA_01", fullName: "Lê Minh An", isActive: true, cells: { GA_COL1: { columnId: "GA_COL1", sessionNumber: 1, status: "SUBMITTED_UNGRADED", score: null, maxScore: 100 } } },
        { studentId: "GA_02", fullName: "Vũ Gia Huy", isActive: true, cells: { GA_COL1: { columnId: "GA_COL1", sessionNumber: 1, status: "NOT_SUBMITTED", score: null, maxScore: 100 } } },
      ],
    });
    const f07Live = await lookupPreviousSessionUnsubmittedBtvn({ classId: ga39, sessionNumber: 2 });
    assert.equal(f07Live.source, "LIVE_SCRAPE", "F07: Thiếu score_matrix_cache phải ưu tiên live scrape trước snapshot");
    assert.deepEqual(f07Live.unsubmittedStudentIds, ["GA_02"], "F07: Học sinh SUBMITTED_UNGRADED không bị đổ oan chưa nộp");
    assert.equal(f07Live.part2Text.includes("Minh An"), false);

    // Offline fallback when live scrape throws
    (ScoreScraper as any).scrapeClassScores = async () => {
      throw new Error("NETWORK_OFFLINE_STAGE1_TEST");
    };
    const gaRes = await lookupPreviousSessionUnsubmittedBtvn({ classId: ga39, sessionNumber: 2 });
    assert.equal(gaRes.source, "REPORT_CARD_SNAPSHOT");
    assert.deepEqual(gaRes.unsubmittedStudentIds, ["GA_01"]);
    await assert.rejects(
      () => lookupPreviousSessionUnsubmittedBtvn({ classId: ga39, sessionNumber: 2, forceLiveScrape: true }),
      (err: unknown) => err instanceof BtvnLookupError && err.code === "SCRAPE_FAILED",
      "forceLiveScrape=true khi offline không được fallback sang REPORT_CARD_SNAPSHOT"
    );

    // R2-F02: Offline REPORT_CARD_SNAPSHOT merge MUST read zero-padded `_SESS_01`..`_SESS_09` from homework_submissions
    homeworkSubmissionRepo.upsert({
      classId: ga39,
      sessionId: `${ga39}_SESS_01`,
      studentId: "GA_01",
      submissionId: "SUB_GA01_S01",
      parseStatus: "PARSED",
      calculatedScore: 95,
      decision: "GRADE",
      status: "APPROVED",
    });
    const r2f02Res = await lookupPreviousSessionUnsubmittedBtvn({ classId: ga39, sessionNumber: 2 });
    assert.equal(r2f02Res.source, "REPORT_CARD_SNAPSHOT");
    assert.deepEqual(
      r2f02Res.unsubmittedStudentIds,
      [],
      "R2-F02: Học sinh đã có bài trong homework_submissions (_SESS_01) không được báo nhầm chưa nộp BTVN"
    );
    (ScoreScraper as any).scrapeClassScores = origScrapeClassScores;

    // S1-01f: forceLiveScrape=true via mocked lmsHttpClient transport
    const gaLmsId = "683e88a68cc94584eaee6b01";
    fs.writeFileSync(tmpLmsClassIdsPath, JSON.stringify({ [ga39]: gaLmsId }, null, 2), "utf8");
    setLmsHttpTransportForTest(async ({ body }) => {
      const parsed = JSON.parse(String(body || "{}"));
      const op = String(parsed?.operationName || "");
      if (op.includes("GetClassById")) {
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(
            JSON.stringify({
              data: {
                classesById: {
                  id: gaLmsId,
                  name: ga39,
                  course: { id: "c_ga", name: "GA39" },
                  students: [
                    { activeInClass: true, student: { id: "GA_01", fullName: "Lê Minh An" } },
                    { activeInClass: true, student: { id: "GA_02", fullName: "Vũ Gia Huy" } },
                  ],
                  slots: [{ _id: "gs1", index: 0, studentAttendance: [] }],
                },
              },
            }),
            "utf8"
          ),
        };
      }
      if (op.includes("FindStudentSubmissionByClass")) {
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(
            JSON.stringify({
              data: {
                findStudentSubmissionByClass: {
                  lessons: [
                    {
                      id: "GA_LIVE_L1",
                      name: "Homework 1",
                      type: "REVIEW_AND_PRACTICE",
                      isActive: true,
                      displayOrder: 1,
                    },
                  ],
                  students: [
                    { id: "GA_01", studentUid: "GA_01", displayName: "Lê Minh An", lessonIds: ["GA_LIVE_L1"] },
                    { id: "GA_02", studentUid: "GA_02", displayName: "Vũ Gia Huy", lessonIds: ["GA_LIVE_L1"] },
                  ],
                  submissions: [
                    {
                      id: "sub_ga2",
                      type: "UPLOAD_FILE",
                      category: "PRACTICE_TASK1",
                      score: 100,
                      status: "MARKED",
                      submittedCount: 1,
                      classId: gaLmsId,
                      lessonId: "GA_LIVE_L1",
                      studentUid: "GA_02",
                      content: { attachments: ["main.gmz"] },
                    },
                  ],
                },
              },
            }),
            "utf8"
          ),
        };
      }
      return {
        status: 404,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({ errors: [{ message: `Unexpected ${op}` }] }), "utf8"),
      };
    });
    try {
      const liveBtvn = await lookupPreviousSessionUnsubmittedBtvn({
        classId: ga39,
        sessionNumber: 2,
        forceLiveScrape: true,
      });
      assert.equal(liveBtvn.source, "LIVE_SCRAPE");
      assert.deepEqual(liveBtvn.unsubmittedStudentIds, ["GA_01"]);
    } finally {
      setLmsHttpTransportForTest(null);
    }

    // S1-01g: Route handlers `/api/session-comments/btvn-from-lms` & `/api/classroom-manager/sync-btvn`
    for (const handler of [btvnFromLmsPOST, cmSyncBtvnPOST]) {
      const nonLocalRes = await handler(
        new Request("http://evil.example.com/api/test", {
          method: "POST",
          headers: { host: "evil.example.com", "content-type": "application/json" },
          body: JSON.stringify({ classId: codingId, sessionNumber: 2 }),
        })
      );
      assert.equal(nonLocalRes.status, 403, "Bắt buộc chặn non-local request với HTTP 403");

      const robRes = await handler(
        new Request("http://127.0.0.1:3000/api/test", {
          method: "POST",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
          body: JSON.stringify({ classId: "VT-ROB-ARMA13", sessionNumber: 2 }),
        })
      );
      assert.equal(robRes.status, 400);

      const b1Res = await handler(
        new Request("http://127.0.0.1:3000/api/test", {
          method: "POST",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
          body: JSON.stringify({ classId: codingId, sessionNumber: 1 }),
        })
      );
      assert.equal(b1Res.status, 400);

      const okRes = await handler(
        new Request("http://127.0.0.1:3000/api/test", {
          method: "POST",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
          body: JSON.stringify({ classId: codingId, sessionNumber: 2 }),
        })
      );
      assert.equal(okRes.status, 200);
      const okJson = await okRes.json();
      assert.equal(okJson.success, true);
      assert.equal(okJson.data.targetHomeworkSession, 1);
      assert.deepEqual(okJson.data.unsubmittedStudentIds, ["ST_01", "ST_02"]);
      assert.deepEqual(okJson.data.unsubmittedShortNames, ["Thành Phong", "Minh Khôi"]);
      assert.ok(String(okJson.data.part2Text || "").includes("Thành Phong, Minh Khôi"));
    }

    // S1-01h: Verify Classroom Manager state application preserves stars/medals & skips ABSENT
    const syncResJson = await (
      await cmSyncBtvnPOST(
        new Request("http://127.0.0.1:3000/api/classroom-manager/sync-btvn", {
          method: "POST",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
          body: JSON.stringify({ classId: codingId, sessionNumber: 2 }),
        })
      )
    ).json();
    const unsubSet = new Set<string>(syncResJson.data.unsubmittedStudentIds);
    const cmItems = [
      {
        studentId: "ST_01",
        attendanceStatus: "PRESENT",
        stars: 3,
        medals: 1,
        praiseCounts: { phat_bieu: 2 },
        issueCounts: { chua_btvn: 0, noi_chuyen: 1 },
      },
      {
        studentId: "ST_02",
        attendanceStatus: "ABSENT",
        stars: 0,
        medals: 0,
        praiseCounts: {},
        issueCounts: { chua_btvn: 0 },
      },
      {
        studentId: "ST_03",
        attendanceStatus: "PRESENT",
        stars: 2,
        medals: 0,
        praiseCounts: {},
        issueCounts: { chua_btvn: 0 },
      },
    ].map((st) =>
      unsubSet.has(st.studentId) && st.attendanceStatus !== "ABSENT"
        ? {
            ...st,
            issueCounts: {
              ...st.issueCounts,
              chua_btvn: Math.max(1, st.issueCounts.chua_btvn || 0),
            },
          }
        : st
    );
    const cmSaveRes = await cmSavePOST(
      new Request("http://127.0.0.1:3000/api/classroom-manager/save", {
        method: "POST",
        headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
        body: JSON.stringify({ classId: codingId, sessionNumber: 2, items: cmItems }),
      })
    );
    assert.equal(cmSaveRes.status, 200);
    const logSt1 = classroomSessionLogRepo.findOne(codingId, 2, "ST_01")!;
    const logSt2 = classroomSessionLogRepo.findOne(codingId, 2, "ST_02")!;
    assert.equal(logSt1.stars, 3);
    assert.equal(logSt1.medals, 1);
    assert.equal(JSON.parse(logSt1.issueCountsJson).chua_btvn, 1);
    assert.equal(JSON.parse(logSt1.issueCountsJson).noi_chuyen, 1);
    assert.equal(JSON.parse(logSt2.issueCountsJson).chua_btvn ?? 0, 0, "ABSENT không bị gắn lỗi chưa BTVN");
    console.log("  -> PASS S1-01.");

    // =========================================================================
    // [S1-02] ClassSyncer.syncLmsSlotCompletionToSqlite attendance preservation
    // =========================================================================
    console.log("\n[S1-02] Kiểm tra đồng bộ điểm danh PRESENT/LATE/ABSENT, khóa tay & giữ APPROVED/VERIFIED...");
    const syncClass = "VT-C4K-SYNC1";
    const syncSess3 = `${syncClass}_SESS_03`;
    const syncSess5 = `${syncClass}_SESS_05`;
    const syncStudents = [
      { studentId: "S2_NEW_P", fullName: "Nguyễn An", isActive: 1, classId: syncClass },
      { studentId: "S2_NEW_L", fullName: "Trần Bình", isActive: 1, classId: syncClass },
      { studentId: "S2_NEW_A", fullName: "Lê Chi", isActive: 1, classId: syncClass },
      { studentId: "S2_NEW_U", fullName: "Phạm Dũng", isActive: 1, classId: syncClass },
      { studentId: "S2_LOCKED", fullName: "Hoàng Khóa", isActive: 1, classId: syncClass },
      { studentId: "S2_APPR", fullName: "Vũ Duyệt", isActive: 1, classId: syncClass },
      { studentId: "S2_VERIF", fullName: "Đặng Xác Thực", isActive: 1, classId: syncClass },
    ];
    for (const st of syncStudents) {
      studentRepo.upsert(st);
    }

    const sampleValidComment =
      "- **Điểm mạnh của học viên:** Con hoàn thành tốt bài học.\n- **Điểm cần cải thiện:** Cần rà soát biến.\n- **Lời khuyên:** Tiếp tục phát huy.";
    const sampleHash = sha256Text(sampleValidComment);

    // Seed pre-existing rows for SESS_03 & SESS_05
    for (const sessId of [syncSess3, syncSess5]) {
      sessionFeedbackRepo.upsert({
        classId: syncClass,
        sessionId: sessId,
        studentId: "S2_LOCKED",
        attendanceStatus: "LATE",
        status: "DRAFT",
        versionMetaJson: JSON.stringify({
          rowVer: 3,
          fields: { attendanceStatus: { ver: 2, cid: "tab1", rev: 2 } },
        }),
      });
      sessionFeedbackRepo.upsert({
        classId: syncClass,
        sessionId: sessId,
        studentId: "S2_APPR",
        attendanceStatus: "PRESENT",
        finalText: sampleValidComment,
        contentHash: sampleHash,
        status: "APPROVED",
      });
      sessionFeedbackRepo.upsert({
        classId: syncClass,
        sessionId: sessId,
        studentId: "S2_VERIF",
        attendanceStatus: "PRESENT",
        finalText: sampleValidComment,
        contentHash: sampleHash,
        status: "VERIFIED",
        verifiedAt: "2026-11-20T10:00:00.000Z",
      });
    }

    const syncAttEntries = [
      { student: { id: "S2_NEW_P", fullName: "Nguyễn An" }, status: "ATTENDED", comment: "", commentByAreas: [] },
      { student: { id: "S2_NEW_L", fullName: "Trần Bình" }, status: "LATE", comment: "", commentByAreas: [] },
      { student: { id: "S2_NEW_A", fullName: "Lê Chi" }, status: "ABSENT", comment: "", commentByAreas: [] },
      { student: { id: "S2_NEW_U", fullName: "Phạm Dũng" }, status: "", comment: "", commentByAreas: [] },
      { student: { id: "S2_LOCKED", fullName: "Hoàng Khóa" }, status: "ATTENDED", comment: "", commentByAreas: [] },
      { student: { id: "S2_APPR", fullName: "Vũ Duyệt" }, status: "ABSENT", comment: "", commentByAreas: [] },
      { student: { id: "S2_VERIF", fullName: "Đặng Xác Thực" }, status: "ABSENT", comment: "", commentByAreas: [] },
    ];

    ClassSyncer.syncLmsSlotCompletionToSqlite({
      db: getDb(),
      classId: syncClass,
      students: studentRepo.findByClass(syncClass, true),
      slots: [
        { index: 0, studentAttendance: [] },
        { index: 1, studentAttendance: [] },
        { index: 2, studentAttendance: syncAttEntries },
        { index: 3, studentAttendance: [] },
        { index: 4, studentAttendance: syncAttEntries },
      ],
      preferLmsVerified: true,
    });

    for (const sessId of [syncSess3, syncSess5]) {
      assert.equal(sessionFeedbackRepo.findOne(syncClass, sessId, "S2_NEW_P")?.attendanceStatus, "PRESENT");
      assert.equal(sessionFeedbackRepo.findOne(syncClass, sessId, "S2_NEW_L")?.attendanceStatus, "LATE");
      assert.equal(sessionFeedbackRepo.findOne(syncClass, sessId, "S2_NEW_A")?.attendanceStatus, "ABSENT");
      assert.equal(sessionFeedbackRepo.findOne(syncClass, sessId, "S2_NEW_U"), undefined);
      assert.equal(
        sessionFeedbackRepo.findOne(syncClass, sessId, "S2_LOCKED")?.attendanceStatus,
        "LATE",
        `${sessId}: Khóa tay attendanceStatus phải được bảo vệ`
      );
      const apprRow = sessionFeedbackRepo.findOne(syncClass, sessId, "S2_APPR")!;
      assert.equal(apprRow.status, "APPROVED", `${sessId}: Không được hạ APPROVED`);
      assert.equal(apprRow.attendanceStatus, "PRESENT", `${sessId}: Không được ghi đè điểm danh APPROVED`);
      const verifRow = sessionFeedbackRepo.findOne(syncClass, sessId, "S2_VERIF")!;
      assert.equal(verifRow.status, "VERIFIED", `${sessId}: Không được hạ VERIFIED`);
      assert.equal(verifRow.attendanceStatus, "PRESENT", `${sessId}: Không được ghi đè điểm danh VERIFIED`);
    }

    // Also test unlocked DRAFT row updates attendanceStatus from PRESENT -> LATE when lmsComment === ""
    ClassSyncer.syncLmsSlotCompletionToSqlite({
      db: getDb(),
      classId: syncClass,
      students: studentRepo.findByClass(syncClass, true),
      slots: [
        { index: 0, studentAttendance: [] },
        { index: 1, studentAttendance: [] },
        {
          index: 2,
          studentAttendance: [
            { student: { id: "S2_NEW_P", fullName: "Nguyễn An" }, status: "LATE", comment: "", commentByAreas: [] },
          ],
        },
      ],
      preferLmsVerified: true,
    });
    assert.equal(
      sessionFeedbackRepo.findOne(syncClass, syncSess3, "S2_NEW_P")?.attendanceStatus,
      "LATE",
      "DRAFT chưa khóa tay phải cập nhật attendanceStatus khi LMS đổi PRESENT -> LATE"
    );

    // F04: Checkpoint APPROVED/VERIFIED rows with non-empty checkpointDataJson MUST keep local attendanceStatus even when LMS sends ABSENT + ""
    studentRepo.upsert({ studentId: "S2_CP_APPR", classId: syncClass, fullName: "Lê Minh Checkpoint", isActive: 1 });
    studentRepo.upsert({ studentId: "S2_CP_VERIF", classId: syncClass, fullName: "Ngô Anh Checkpoint", isActive: 1 });
    const syncCpBase = {
      cpStage: 1,
      isRobotics: false,
      theoryScore: 4.5,
      practiceScore: 4.5,
    };
    const syncCpPayload = JSON.stringify({
      ...syncCpBase,
      approvedSnapshotHash: extractCheckpointCoreSnapshotHash(JSON.stringify(syncCpBase)),
    });
    sessionFeedbackRepo.upsert({
      classId: syncClass,
      sessionId: syncSess5,
      studentId: "S2_CP_APPR",
      attendanceStatus: "PRESENT",
      finalText: sampleValidComment,
      contentHash: sampleHash,
      status: "APPROVED",
      checkpointDataJson: syncCpPayload,
    });
    sessionFeedbackRepo.upsert({
      classId: syncClass,
      sessionId: syncSess5,
      studentId: "S2_CP_VERIF",
      attendanceStatus: "PRESENT",
      finalText: sampleValidComment,
      contentHash: sampleHash,
      status: "VERIFIED",
      verifiedAt: "2026-11-20T10:00:00.000Z",
      checkpointDataJson: syncCpPayload,
    });
    ClassSyncer.syncLmsSlotCompletionToSqlite({
      db: getDb(),
      classId: syncClass,
      students: studentRepo.findByClass(syncClass, true),
      slots: [
        { index: 0, studentAttendance: [] },
        { index: 1, studentAttendance: [] },
        { index: 2, studentAttendance: [] },
        { index: 3, studentAttendance: [] },
        {
          index: 4,
          studentAttendance: [
            { student: { id: "S2_CP_APPR", fullName: "Lê Minh Checkpoint" }, status: "ABSENT", comment: "", commentByAreas: [] },
            { student: { id: "S2_CP_VERIF", fullName: "Ngô Anh Checkpoint" }, status: "ABSENT", comment: "", commentByAreas: [] },
          ],
        },
      ],
      preferLmsVerified: true,
    });
    assert.equal(
      sessionFeedbackRepo.findOne(syncClass, syncSess5, "S2_CP_APPR")?.attendanceStatus,
      "PRESENT",
      "F04: Checkpoint APPROVED không được bị LMS ghi đè attendanceStatus -> ABSENT"
    );
    assert.equal(
      sessionFeedbackRepo.findOne(syncClass, syncSess5, "S2_CP_VERIF")?.attendanceStatus,
      "PRESENT",
      "F04: Checkpoint VERIFIED không được bị LMS ghi đè attendanceStatus -> ABSENT"
    );
    assert.equal(sessionFeedbackRepo.findOne(syncClass, syncSess5, "S2_CP_VERIF")?.status, "VERIFIED");
    console.log("  -> PASS S1-02.");

    // =========================================================================
    // [S1-03] filterInheritableQuickTags + list route inheritance & pending logs
    // =========================================================================
    console.log("\n[S1-03] Kiểm tra lọc kế thừa Quick Tags & pendingClassroomLogsCount...");
    const categories = getQuickTags();
    const codingFiltered = filterInheritableQuickTags(
      [
        "💡 Vận dụng & Sáng tạo tốt",
        "✅ Tiếp thu tốt",
        "🙋 Hăng hái phát biểu",
        "🐢 Tiếp thu chậm",
        "👀 Mất tập trung",
        "⌨️ Thao tác / Cú pháp còn chậm",
        "📊 Slide đẹp, bố cục rõ ràng, dễ nhìn",
      ],
      categories
    );
    assert.deepEqual(codingFiltered, [
      "💡 Vận dụng & Sáng tạo tốt",
      "✅ Tiếp thu tốt",
      "🙋 Hăng hái phát biểu",
      "🐢 Tiếp thu chậm",
    ]);

    const roboticsFiltered = filterInheritableQuickTags(
      [
        "🧠 Chủ động thử & sửa lỗi",
        "🔧 Lắp ráp đúng mẫu",
        "🤝 Hợp tác nhóm tốt",
        "🔩 Lắp ráp cần hỗ trợ",
        "🧩 Lập trình cần hỗ trợ",
        "👀 Cần nhắc tập trung",
      ],
      categories
    );
    assert.deepEqual(roboticsFiltered, [
      "🧠 Chủ động thử & sửa lỗi",
      "🔧 Lắp ráp đúng mẫu",
      "🤝 Hợp tác nhóm tốt",
      "🔩 Lắp ráp cần hỗ trợ",
    ]);

    // Fallback without categories also drops distracted/improve
    assert.deepEqual(
      filterInheritableQuickTags(["✅ Tiếp thu tốt", "👀 Mất tập trung", "⌨️ Thao tác / Cú pháp còn chậm"]),
      ["✅ Tiếp thu tốt"]
    );

    // List route integration: previousQuickTagsByStudent + pendingClassroomLogsCount
    sessionFeedbackRepo.upsert({
      classId: codingId,
      sessionId: `${codingId}_SESS_01`,
      studentId: "ST_01",
      attendanceStatus: "PRESENT",
      quickTagsJson: JSON.stringify([
        "✅ Tiếp thu tốt",
        "👀 Mất tập trung",
        "⌨️ Thao tác / Cú pháp còn chậm",
      ]),
      status: "VERIFIED",
      finalText: sampleValidComment,
      contentHash: sampleHash,
    });
    sessionFeedbackRepo.upsert({
      classId: codingId,
      sessionId: `${codingId}_SESS_01`,
      studentId: "ST_03",
      attendanceStatus: "PRESENT",
      quickTagsJson: JSON.stringify(["👀 Mất tập trung"]),
      status: "DRAFT",
    });

    const listResBeforeApply = await sessionCommentsListGET(
      new Request(
        `http://127.0.0.1:3000/api/session-comments/list?classId=${codingId}&sessionId=${codingId}_SESS_02`,
        { method: "GET", headers: { host: "127.0.0.1:3000" } }
      )
    );
    assert.equal(listResBeforeApply.status, 200);
    const listBeforeJson = await listResBeforeApply.json();
    assert.deepEqual(listBeforeJson.data.previousQuickTagsByStudent["ST_01"], {
      tags: ["✅ Tiếp thu tốt"],
      fromSessionNumber: 1,
    });
    assert.equal(
      listBeforeJson.data.previousQuickTagsByStudent["ST_03"],
      undefined,
      "Học viên chỉ có thẻ lỗi tuần trước không được kế thừa"
    );
    assert.ok(
      listBeforeJson.data.pendingClassroomLogsCount >= 1,
      `Phải báo có log Giờ học chưa nạp (actual=${listBeforeJson.data.pendingClassroomLogsCount})`
    );

    const applyRes = await cmApplyPOST(
      new Request("http://127.0.0.1:3000/api/classroom-manager/apply-to-comments", {
        method: "POST",
        headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
        body: JSON.stringify({ classId: codingId, sessionNumber: 2 }),
      })
    );
    assert.equal(applyRes.status, 200);
    const listAfterApplyJson = await (
      await sessionCommentsListGET(
        new Request(
          `http://127.0.0.1:3000/api/session-comments/list?classId=${codingId}&sessionId=${codingId}_SESS_02`,
          { method: "GET", headers: { host: "127.0.0.1:3000" } }
        )
      )
    ).json();
    assert.equal(
      listAfterApplyJson.data.pendingClassroomLogsCount,
      0,
      "Sau khi Nạp Giờ học xong, pendingClassroomLogsCount phải về 0"
    );

    // F08: pendingClassroomLogsCount MUST exclude students whose session_feedbacks is VERIFIED (prevents infinite apply banner loop)
    classroomSessionLogRepo.upsertBatch([
      {
        classId: codingId,
        sessionNumber: 8,
        studentId: "ST_01",
        attendanceStatus: "PRESENT",
        stars: 4,
        medals: 1,
        praiseCountsJson: JSON.stringify({ phat_bieu: 1 }),
        issueCountsJson: JSON.stringify({}),
      },
      {
        classId: codingId,
        sessionNumber: 8,
        studentId: "ST_02",
        attendanceStatus: "PRESENT",
        stars: 2,
        medals: 0,
        praiseCountsJson: JSON.stringify({}),
        issueCountsJson: JSON.stringify({}),
      },
    ]);
    sessionFeedbackRepo.upsert({
      classId: codingId,
      sessionId: `${codingId}_SESS_08`,
      studentId: "ST_01",
      attendanceStatus: "PRESENT",
      finalText: sampleValidComment,
      contentHash: sampleHash,
      status: "VERIFIED",
      verifiedAt: "2026-11-27T08:00:00.000Z",
    });
    sessionFeedbackRepo.upsert({
      classId: codingId,
      sessionId: `${codingId}_SESS_08`,
      studentId: "ST_02",
      attendanceStatus: "PRESENT",
      finalText: "",
      status: "DRAFT",
    });
    const listF08BeforeApply = await (
      await sessionCommentsListGET(
        new Request(
          `http://127.0.0.1:3000/api/session-comments/list?classId=${codingId}&sessionId=${codingId}_SESS_08`,
          { method: "GET", headers: { host: "127.0.0.1:3000" } }
        )
      )
    ).json();
    assert.equal(
      listF08BeforeApply.data.pendingClassroomLogsCount,
      1,
      "F08: Chỉ đếm ST_02 (DRAFT), bỏ qua ST_01 (VERIFIED)"
    );
    const f08ApplyRes = await cmApplyPOST(
      new Request("http://127.0.0.1:3000/api/classroom-manager/apply-to-comments", {
        method: "POST",
        headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
        body: JSON.stringify({ classId: codingId, sessionNumber: 8 }),
      })
    );
    assert.equal(f08ApplyRes.status, 200);
    const listF08Json = await (
      await sessionCommentsListGET(
        new Request(
          `http://127.0.0.1:3000/api/session-comments/list?classId=${codingId}&sessionId=${codingId}_SESS_08`,
          { method: "GET", headers: { host: "127.0.0.1:3000" } }
        )
      )
    ).json();
    assert.equal(
      listF08Json.data.pendingClassroomLogsCount,
      0,
      "F08: Sau Nạp Giờ học, học viên VERIFIED không gây vòng lặp pendingClassroomLogsCount = 1"
    );
    console.log("  -> PASS S1-03.");

    // =========================================================================
    // [S1-04] LEGO vs VEX Checkpoint & 7 vs 9 Competency Rules
    // =========================================================================
    console.log("\n[S1-04] Kiểm tra định danh LEGO [5,9] 7 sao / 7 vs VEX [4,8] 9 sao / 9...");
    const syllabus = getCoursesSyllabus();
    const legoCodes = ["VT-ROB4B01", "VT-ROB6A02", "VT-KIND-ROB4I01", "VT-KIRO03", "ROB4", "ROB6", "KIND-ROB4", "KIRO"];
    const vexCodes = ["VT-ROB40", "205ALHP-ROB04", "VT-ROB-PREB19", "VT-ROB-ARMA13", "VT-ROB-SEMIA05"];

    const sample9Scores: CompetencyScores = {
      knowledgeSelfStudy: 1, // ignored for LEGO
      knowledgeInClass: 5,
      skillCommunication: 5,
      skillComputerUse: 5,
      skillProblemSolving: 5,
      skillCreativity: 5,
      skillComputational: 5,
      attitudeHomework: 1, // ignored for LEGO
      attitudeInClass: 5,
    };

    for (const code of legoCodes) {
      assert.equal(isLegoRoboticsClassCodePure(code), true, `${code} phải là LEGO`);
      assert.equal(isRoboticsClassCodePure(code), true, `${code} thuộc khối Robotics`);
      assert.deepEqual(getDefaultCheckpointSessions(code), [5, 9], `${code} default CP phải là [5,9]`);
      assert.deepEqual(resolveCheckpointSessionsForClass(code, syllabus), [5, 9], `${code} syllabus CP phải là [5,9]`);
      const st5 = resolveCheckpointStageForSession(code, 5);
      assert.equal(st5.isCheckpoint, true);
      assert.equal(st5.isRobotics, true);
      assert.equal(st5.isLego, true);
      assert.equal(st5.cpStage, 1);
      const st9 = resolveCheckpointStageForSession(code, 9);
      assert.equal(st9.isCheckpoint, true);
      assert.equal(st9.isLego, true);
      assert.equal(st9.cpStage, 2);
      assert.equal(resolveCheckpointStageForSession(code, 4).isCheckpoint, false);
      assert.equal(getCompetencySpecsForClassPure(code).length, 7);
      assert.equal(getCompetencyKeysForClassPure(code).length, 7);
      assert.equal(calculateCompetencyAverageForClassPure(sample9Scores, code), 5.0);
    }

    const legoHeader = formatCheckpointScoreHeaderLine({
      cpStage: 1,
      theoryScore: null,
      practiceScore: null,
      competencyAverage: 4.71,
      isLego: true,
    });
    assert.equal(legoHeader, "📊 **Kết quả Checkpoint 1:** Điểm năng lực **4.71/5.0**");

    for (const code of vexCodes) {
      assert.equal(isLegoRoboticsClassCodePure(code), false, `${code} KHÔNG được nhận nhầm là LEGO`);
      assert.equal(isRoboticsClassCodePure(code), true, `${code} phải là Robotics`);
      assert.deepEqual(getDefaultCheckpointSessions(code), [4, 8], `${code} default CP phải là [4,8]`);
      assert.deepEqual(resolveCheckpointSessionsForClass(code, syllabus), [4, 8], `${code} syllabus CP phải là [4,8]`);
      const st4 = resolveCheckpointStageForSession(code, 4);
      assert.equal(st4.isCheckpoint, true);
      assert.equal(Boolean(st4.isLego), false);
      assert.equal(st4.cpStage, 1);
      assert.equal(resolveCheckpointStageForSession(code, 8).cpStage, 2);
      assert.equal(getCompetencySpecsForClassPure(code).length, 9);
      assert.equal(getCompetencyKeysForClassPure(code).length, 9);
      // Sum of sample9Scores = 5*7 + 1*2 = 37; 37/9 = 4.11
      assert.equal(calculateCompetencyAverageForClassPure(sample9Scores, code), 4.11);
    }

    // F05: LEGO Zalo Checkpoint summary praises standout by short name via [ĐNL], reveals no numeric scores & omits theory mention
    const legoZaloBlock = buildCheckpointZaloSummaryBlock({
      cpStage: 1,
      isRobotics: true,
      isLego: true,
      students: [
        {
          fullName: "Mai Nhật Minh",
          isActive: true,
          attendanceStatus: "PRESENT",
          checkpointData: {
            cpStage: 1,
            isRobotics: true,
            isLego: true,
            theoryScore: null,
            practiceScore: null,
            competencyScores: sample9Scores,
            competencyAverage: 4.86,
            processSummary: {
              stageStartSession: 1,
              stageEndSession: 4,
              priorSessionsObserved: 4,
              presentCount: 4,
              lateCount: 0,
              absentCount: 0,
              totalStars: 6,
              totalMedals: 1,
              totalIssues: 0,
              issueBreakdown: {},
              topStrengthTags: [],
              topImprovementTags: [],
              homeworkSummary: null,
              previousCheckpoint: null,
            },
          },
        },
        {
          fullName: "Trần Tuấn Kiệt",
          isActive: true,
          attendanceStatus: "PRESENT",
          checkpointData: {
            cpStage: 1,
            isRobotics: true,
            isLego: true,
            theoryScore: null,
            practiceScore: null,
            competencyScores: sample9Scores,
            competencyAverage: 3.1,
          },
        },
      ],
    });
    assert.ok(legoZaloBlock.includes("Nhật Minh"), "F05: LEGO Zalo tổng kết phải tuyên dương bạn nổi bật");
    assert.equal(legoZaloBlock.includes("4.86"), false, "F05: Tuyệt đối không lộ điểm số");
    assert.equal(/kiến thức lý thuyết/i.test(legoZaloBlock), false, "F05: LEGO không nhắc kiểm tra lý thuyết");

    // F11: KIRO / LEGO Zalo detection & full broadcast + LEGO save-draft (/7) + approve (no 409) + CommentGenerator
    assert.equal(isRoboticsClassForZalo("VT-KIRO03"), true, "F11: VT-KIRO03 là lớp Robotics Zalo");
    assert.equal(isRoboticsClassForZalo("VT-KIND-ROB4I01"), true, "F11: VT-KIND-ROB4I01 là lớp Robotics Zalo");
    assert.equal(isRoboticsClassForZalo("LEGO-ROB4A"), true, "F11: LEGO-ROB4A là lớp Robotics Zalo");
    const kiroZaloFull = buildAutoZaloBroadcastText({
      classCode: "VT-KIRO03",
      sessionNumber: 5,
      sessionDate: "10/11/2026",
      currentTopic: "Checkpoint 1",
      currentKeyKnowledge: ["Ôn tập cảm biến và lắp ráp mô hình LEGO"],
      students: [
        {
          fullName: "Mai Nhật Minh",
          isActive: true,
          attendanceStatus: "PRESENT",
          checkpointData: {
            cpStage: 1,
            isRobotics: true,
            isLego: true,
            theoryScore: null,
            practiceScore: null,
            competencyScores: sample9Scores,
            competencyAverage: 4.86,
          },
        },
      ],
    });
    assert.ok(kiroZaloFull.includes("📢 TỔNG KẾT BUỔI HỌC SỐ 05 – VT-KIRO03"), "F11: KIRO dùng mẫu Zalo Robotics");
    assert.ok(kiroZaloFull.includes("🎯 ĐÁNH GIÁ QUÁ TRÌNH & TỔNG KẾT CHECKPOINT 1:"));
    assert.ok(kiroZaloFull.includes("Nhật Minh"));
    assert.equal(/kiến thức lý thuyết/i.test(kiroZaloFull), false);

    // F11 save-draft + approve on LEGO VT-KIND-ROB4I01 Buổi 5
    const f11LegoClass = "VT-KIND-ROB4I01";
    const f11LegoSess5 = `${f11LegoClass}_SESS_05`;
    studentRepo.upsert({ studentId: "LG_F11", classId: f11LegoClass, fullName: "Đinh Gia Bảo", isActive: 1 });
    const f11SaveDraftRes = await sessionSaveDraftPOST(
      new Request("http://127.0.0.1:3000/api/session-comments/save-draft", {
        method: "POST",
        headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
        body: JSON.stringify({
          classId: f11LegoClass,
          sessionId: f11LegoSess5,
          studentId: "LG_F11",
          attendanceStatus: "PRESENT",
          finalText:
            "📊 **Kết quả Checkpoint 1:** Điểm năng lực **5.00/5.0**\n- **Điểm mạnh của học viên:** Con lắp ráp mô hình LEGO chuẩn xác.\n- **Điểm cần cải thiện:** Rèn gọn bàn linh kiện.\n- **Lời khuyên:** Tiếp tục phát huy nhé.",
          checkpointData: {
            cpStage: 1,
            theoryScore: null,
            practiceScore: null,
            competencyScores: sample9Scores, // 7 LEGO keys=5, ignored knowledgeSelfStudy/attitudeHomework=1
          },
        }),
      })
    );
    assert.equal(f11SaveDraftRes.status, 200);
    const savedF11Draft = sessionFeedbackRepo.findOne(f11LegoClass, f11LegoSess5, "LG_F11")!;
    const savedF11Cp = parseCheckpointDataJson(savedF11Draft.checkpointDataJson)!;
    assert.equal(savedF11Cp.isLego, true, "F11: save-draft phải giữ isLego=true");
    assert.equal(savedF11Cp.competencyAverage, 5, "F11: save-draft LEGO bắt buộc chia 7 (5.0), không chia 9 (4.11)");

    const f11ApproveRes = await sessionApprovePOST(
      new Request("http://127.0.0.1:3000/api/session-comments/approve", {
        method: "POST",
        headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
        body: JSON.stringify({
          classId: f11LegoClass,
          sessionId: f11LegoSess5,
          studentId: "LG_F11",
          approvedText: savedF11Draft.finalText,
          checkpointData: savedF11Cp,
        }),
      })
    );
    assert.equal(f11ApproveRes.status, 200, "F11: approve LEGO B5 phải thành công (không lỗi 409 FINAL_TEXT_DRIFT)");
    const approvedF11 = sessionFeedbackRepo.findOne(f11LegoClass, f11LegoSess5, "LG_F11")!;
    assert.ok(
      approvedF11.finalText?.startsWith("📊 **Kết quả Checkpoint 1:** Điểm năng lực **5.00/5.0**"),
      `F11: approve LEGO header sai: ${approvedF11.finalText}`
    );

    // F11 CommentGenerator LEGO B5 (without explicit isCheckpointSession -> resolves [5,9] & LEGO header)
    const cgPromptBodies: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("generativelanguage.googleapis.com")) {
        cgPromptBodies.push(String(init?.body || ""));
        const payload = {
          feedbacks: [
            {
              anonymousId: "STUDENT_01",
              strengths: "Con lắp ráp mô hình LEGO vững và hợp tác nhóm tốt.",
              improvements: "Con cần chú ý sắp xếp gọn các mảnh ghép sau khi thử nghiệm.",
              actionPlan: "Ba mẹ khích lệ con tiếp tục sáng tạo ở chặng tiếp theo.",
              formattedFullComment:
                "- **Điểm mạnh của học viên:** Con lắp ráp mô hình LEGO vững và hợp tác nhóm tốt.\n\n- **Điểm cần cải thiện:** Con cần chú ý sắp xếp gọn các mảnh ghép sau khi thử nghiệm.\n\n- **Lời khuyên:** Ba mẹ khích lệ con tiếp tục sáng tạo ở chặng tiếp theo.",
            },
          ],
        };
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: { parts: [{ text: JSON.stringify(payload) }], role: "model" },
                finishReason: "STOP",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return origGlobalFetch(input as any, init);
    }) as typeof globalThis.fetch;
    try {
      studentRepo.upsert({ studentId: "LG_CG1", classId: f11LegoClass, fullName: "Phạm Bảo Châu", isActive: 1 });
      const cgRes = await CommentGenerator.generateBatchComments(
        {
          classId: f11LegoClass,
          classCode: f11LegoClass,
          sessionId: f11LegoSess5,
          sessionNumber: 5,
          topic: "Checkpoint 1 LEGO",
        },
        [
          {
            studentId: "LG_CG1",
            fullName: "Phạm Bảo Châu",
            attendanceStatus: "PRESENT",
            quickTags: ["🔧 Lắp ráp đúng mẫu"],
            checkpointData: {
              cpStage: 1,
              isRobotics: true,
              isLego: true,
              theoryScore: null,
              practiceScore: null,
              competencyScores: sample9Scores,
              competencyAverage: 5,
            },
          },
        ]
      );
      assert.equal(cgRes.length, 1);
      assert.ok(
        cgRes[0].formattedFullComment.startsWith("📊 **Kết quả Checkpoint 1:** Điểm năng lực **5.00/5.0**"),
        `F11 CommentGenerator LEGO header sai: ${cgRes[0].formattedFullComment}`
      );
      assert.equal(cgRes[0].formattedFullComment.includes("Chưa nhập"), false);
      assert.ok(cgPromptBodies.some((b) => /Robotics/i.test(b)), "F11 CommentGenerator phải nhận diện đúng Robotics");
    } finally {
      globalThis.fetch = origGlobalFetch;
    }
    console.log("  -> PASS S1-04.");

    // =========================================================================
    // [S1-05] uploadSessionCommentsViaApi (127.0.0.1 mock GQL) & Playwright fallback
    // =========================================================================
    console.log("\n[S1-05] Kiểm tra uploadSessionCommentsViaApi (thường + CP 9 sao + LEGO 7 sao + skip VERIFIED + fallback)...");

    interface MockServerState {
      classes: Record<string, any>;
      updateCalls: Array<{ classId: string; sessionNumber: number; studentId: string; byAreas: any[]; content: string }>;
      summaryUpdateCalls: number;
      corruptStudentId?: string;
      failAllRequests?: boolean;
      failStudentMutation?: boolean;
      failGetClassById?: boolean;
      failGetClassByIdSafe?: boolean;
      stripCheckpointInWriteContext?: boolean;
      truncateSafeCheckpointQuestions?: boolean;
    }

    const mockState: MockServerState = {
      classes: {},
      updateCalls: [],
      summaryUpdateCalls: 0,
    };

    const gqlServer = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      if (mockState.failAllRequests) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ errors: [{ message: "Service Unavailable" }] }));
        return;
      }
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const op = String(parsed.operationName || "");
      const vars = parsed.variables || {};

      if (op === "GetClassById" && mockState.failGetClassById) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ errors: [{ message: "GetClassById simulated failure" }] }));
        return;
      }
      if (op === "GetClassByIdSafe" && mockState.failGetClassByIdSafe) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ errors: [{ message: "GetClassByIdSafe simulated failure" }] }));
        return;
      }

      if (op === "GetClassWriteContext" || op === "GetClassByIdSafe" || op === "GetClassById") {
        const rawCls = mockState.classes[String(vars.id || "")];
        const cls =
          rawCls && op === "GetClassWriteContext" && mockState.stripCheckpointInWriteContext
            ? {
                ...rawCls,
                slots: (rawCls.slots || []).map((slot: any) => ({
                  ...slot,
                  studentAttendance: (slot.studentAttendance || []).map((att: any) => ({
                    ...att,
                    commentByAreas: (att.commentByAreas || []).map((a: any) =>
                      String(a?.type || "").toUpperCase() === "CHECKPOINT"
                        ? { commentAreaId: a.commentAreaId, type: "CHECKPOINT", grade: a.grade, content: a.content }
                        : a
                    ),
                  })),
                })),
              }
            : rawCls && op === "GetClassByIdSafe" && mockState.truncateSafeCheckpointQuestions
              ? {
                  ...rawCls,
                  slots: (rawCls.slots || []).map((slot: any) => ({
                    ...slot,
                    studentAttendance: (slot.studentAttendance || []).map((att: any) => ({
                      ...att,
                      commentByAreas: (att.commentByAreas || []).map((a: any) =>
                        String(a?.type || "").toUpperCase() === "CHECKPOINT" && a?.checkpoint
                          ? {
                              ...a,
                              checkpoint: {
                                checkpointScore: a.checkpoint.checkpointScore,
                                practiceScore: a.checkpoint.practiceScore,
                                checkpointQuestions: Array.isArray(a.checkpoint.checkpointQuestions)
                                  ? a.checkpoint.checkpointQuestions.map((q: any) => ({ result: q?.result }))
                                  : [],
                              },
                            }
                          : a
                      ),
                    })),
                  })),
                }
              : rawCls;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: { classesById: cls || null } }));
        return;
      }
      if (op === "UpdateSlotComment") {
        const payload = vars.payload || {};
        const cls = mockState.classes[String(payload.classId || "")];
        const sc = payload.studentComment;
        if (sc && mockState.failStudentMutation) {
          res.writeHead(503, { "content-type": "application/json" });
          res.end(JSON.stringify({ errors: [{ message: "Student mutation 503" }] }));
          return;
        }
        const targetSlot = cls
          ? (cls.slots || []).find((s: any) => String(s._id) === String(payload.slotId))
          : null;
        if (targetSlot && !sc && (payload.summary !== undefined || payload.homework !== undefined)) {
          mockState.summaryUpdateCalls++;
          if (payload.summary !== undefined) targetSlot.summary = String(payload.summary);
          if (payload.homework !== undefined) targetSlot.homework = String(payload.homework);
        }
        if (cls && sc) {
          mockState.updateCalls.push({
            classId: String(payload.classId),
            sessionNumber: Number(payload.sessionNumber),
            studentId: String(sc.studentId),
            byAreas: Array.isArray(sc.byAreas) ? sc.byAreas : [],
            content: String(sc.content || ""),
          });
          const att = (targetSlot?.studentAttendance || []).find(
            (a: any) => String(a._id) === String(sc.studentAttendanceId)
          );
          if (att) {
            if (mockState.corruptStudentId && sc.studentId === mockState.corruptStudentId) {
              att.comment = "<p>Nội dung bị cắt ngắn sai lệch</p>";
              att.commentByAreas = (sc.byAreas || []).map((b: any) =>
                b.type === "CONTENT" ? { ...b, content: "<p>Nội dung bị cắt ngắn sai lệch</p>" } : b
              );
            } else {
              att.comment = String(sc.content || "");
              att.commentByAreas = Array.isArray(sc.byAreas) ? sc.byAreas : [];
            }
          }
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: { classes: { updateSlotComment: cls || { id: payload.classId } } } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ errors: [{ message: `Unexpected op ${op}` }] }));
    });

    await new Promise<void>((resolve) => gqlServer.listen(0, "127.0.0.1", resolve));
    const gqlPort = (gqlServer.address() as { port: number }).port;
    const gqlEndpoint = `http://127.0.0.1:${gqlPort}/graphql`;

    try {
      // S1-05a: Regular session (`VT-C4K-PTA13`, B2) + skip VERIFIED
      const regText1 =
        "- **Điểm mạnh của học viên:** Con hoàn thành bài thực hành Buổi 2 đúng yêu cầu.\n- **Điểm cần cải thiện:** Cần kiểm tra lại tên hàm.\n- **Lời khuyên:** Thầy khuyên con làm đủ BTVN nhé.";
      const regHash1 = calculateSha256(regText1);
      const regText2 =
        "- **Điểm mạnh của học viên:** Con chủ động thử nghiệm và sáng tạo thêm tính năng.\n- **Điểm cần cải thiện:** Cú pháp còn vài lỗi nhỏ.\n- **Lời khuyên:** Tiếp tục phát huy nhé.";
      const regHash2 = calculateSha256(regText2);

      const ptaLmsId = "lms_pta13_stage1";
      mockState.classes[ptaLmsId] = {
        id: ptaLmsId,
        name: codingId,
        centre: { id: "ctr_1" },
        students: [
          { activeInClass: true, student: { id: "ST_01", fullName: "Nguyễn Thành Phong" } },
          { activeInClass: true, student: { id: "ST_02", fullName: "Trần Minh Khôi" } },
        ],
        slots: Array.from({ length: 13 }, (_, idx) => ({
          _id: `pta_slot_${idx + 1}`,
          index: idx,
          summary: "",
          homework: "",
          studentAttendance:
            idx + 1 === 2
              ? [
                  {
                    _id: "att_pta_2_1",
                    status: "ATTENDED",
                    comment: "",
                    student: { id: "ST_01", fullName: "Nguyễn Thành Phong" },
                    commentByAreas: [{ commentAreaId: "reg_content_1", type: "CONTENT", grade: 0, content: "" }],
                  },
                  {
                    _id: "att_pta_2_2",
                    status: "ATTENDED",
                    comment: `<p>${regText2}</p>`,
                    student: { id: "ST_02", fullName: "Trần Minh Khôi" },
                    commentByAreas: [{ commentAreaId: "reg_content_1", type: "CONTENT", grade: 0, content: `<p>${regText2}</p>` }],
                  },
                ]
              : idx + 1 === 3
                ? [
                    {
                      _id: "att_pta_3_1",
                      status: "ATTENDED",
                      comment: "",
                      student: { id: "ST_01", fullName: "Nguyễn Thành Phong" },
                      commentByAreas: [],
                    },
                  ]
                : [],
        })),
      };

      sessionFeedbackRepo.upsert({
        classId: codingId,
        sessionId: `${codingId}_SESS_02`,
        studentId: "ST_01",
        attendanceStatus: "PRESENT",
        finalText: regText1,
        contentHash: regHash1,
        status: "APPROVED",
      });
      sessionFeedbackRepo.upsert({
        classId: codingId,
        sessionId: `${codingId}_SESS_02`,
        studentId: "ST_02",
        attendanceStatus: "PRESENT",
        finalText: regText2,
        contentHash: regHash2,
        status: "VERIFIED",
        verifiedAt: "2026-11-27T08:00:00.000Z",
      });

      mockState.updateCalls = [];
      const regApiRes = await uploadSessionCommentsViaApi({
        classId: codingId,
        classCode: codingId,
        sessionId: `${codingId}_SESS_02`,
        lmsClassIdOverride: ptaLmsId,
        graphqlEndpoint: gqlEndpoint,
        preferApiWrite: true,
      });
      assert.equal(regApiRes.verifiedCount, 1);
      assert.equal(regApiRes.skippedVerifiedCount, 1, "Bắt buộc skip ST_02 đang VERIFIED hợp lệ");
      assert.equal(mockState.updateCalls.length, 1);
      assert.equal(mockState.updateCalls[0].studentId, "ST_01");
      assert.equal(sessionFeedbackRepo.findOne(codingId, `${codingId}_SESS_02`, "ST_01")?.status, "VERIFIED");

      // S1-05a2: Read-after-Write mismatch fails closed
      sessionFeedbackRepo.upsert({
        classId: codingId,
        sessionId: `${codingId}_SESS_02`,
        studentId: "ST_01",
        attendanceStatus: "PRESENT",
        finalText: regText1,
        contentHash: regHash1,
        status: "APPROVED",
      });
      mockState.corruptStudentId = "ST_01";
      const mismatchRes = await uploadSessionCommentsViaApi({
        classId: codingId,
        classCode: codingId,
        sessionId: `${codingId}_SESS_02`,
        studentId: "ST_01",
        lmsClassIdOverride: ptaLmsId,
        graphqlEndpoint: gqlEndpoint,
        preferApiWrite: true,
      });
      mockState.corruptStudentId = undefined;
      assert.equal(mismatchRes.verifiedCount, 0);
      assert.equal(mismatchRes.failedCount, 1);
      assert.equal(sessionFeedbackRepo.findOne(codingId, `${codingId}_SESS_02`, "ST_01")?.status, "FAILED");

      // S1-05b: Coding Checkpoint B5 (9 sao) preserving NUMBER LT/TH, CHECKPOINT & competency-note CONTENT + skip VERIFIED
      const cpClass = "VT-C4K-CSA04";
      const cpLmsId = "lms_csa04_stage1";
      studentRepo.upsert({ studentId: "CP_ST1", classId: cpClass, fullName: "Nguyễn Hải Đăng", isActive: 1 });
      studentRepo.upsert({ studentId: "CP_ST2", classId: cpClass, fullName: "Lê Bảo Trâm", isActive: 1 });

      const cp9Desired: CompetencyScores = {
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
      const cp1Base = {
        cpStage: 1 as const,
        isRobotics: false,
        theoryScore: 4.5,
        practiceScore: 5.0,
        competencyScores: cp9Desired,
        competencyAverage: calculateCompetencyAverageForClassPure(cp9Desired, cpClass),
      };
      const cp1SnapHash = extractCheckpointCoreSnapshotHash(JSON.stringify(cp1Base));
      const cp1Text =
        "📊 **Kết quả Checkpoint 1:** Lý thuyết **4.5/5.0** | Thực hành **5.0/5.0** | Điểm năng lực **4.56/5.0**\n- **Điểm mạnh của học viên:** Con hoàn thành xuất sắc phần thực hành Checkpoint 1.\n- **Điểm cần cải thiện:** Cần chú ý thêm tối ưu hóa mã nguồn.\n- **Lời khuyên:** Ba mẹ động viên con duy trì phong độ tốt ở chặng 2.";
      const cp1Hash = calculateSha256(cp1Text);

      sessionFeedbackRepo.upsert({
        classId: cpClass,
        sessionId: `${cpClass}_SESS_05`,
        studentId: "CP_ST1",
        attendanceStatus: "PRESENT",
        finalText: cp1Text,
        contentHash: cp1Hash,
        status: "APPROVED",
        checkpointDataJson: JSON.stringify({ ...cp1Base, approvedSnapshotHash: cp1SnapHash }),
      });
      sessionFeedbackRepo.upsert({
        classId: cpClass,
        sessionId: `${cpClass}_SESS_05`,
        studentId: "CP_ST2",
        attendanceStatus: "PRESENT",
        finalText: cp1Text,
        contentHash: cp1Hash,
        status: "VERIFIED",
        verifiedAt: "2026-11-27T08:00:00.000Z",
        checkpointDataJson: JSON.stringify({
          ...cp1Base,
          lmsCompetencyScores: cp9Desired,
          approvedSnapshotHash: cp1SnapHash,
        }),
      });

      mockState.classes[cpLmsId] = {
        id: cpLmsId,
        name: cpClass,
        centre: { id: "ctr_cp" },
        course: { id: "c_csa", name: "CSA04" },
        courseProcesses: [
          {
            id: "cp_proc_csa",
            checkpointEvaluations: [
              {
                id: "ce_1",
                title: "Đánh giá năng lực",
                commentAreas: [
                  ...COMPETENCY_AREA_SPECS.map((s) => ({ id: s.commentAreaId, name: s.labelVi, type: "RATE" })),
                  { id: "area_comp_note", name: "Nhận xét năng lực kiến thức", type: "CONTENT" },
                  { id: "area_general", name: "Đánh giá chung", type: "CONTENT" },
                ],
              },
            ],
          },
        ],
        students: [
          { activeInClass: true, student: { id: "CP_ST1", fullName: "Nguyễn Hải Đăng" } },
          { activeInClass: true, student: { id: "CP_ST2", fullName: "Lê Bảo Trâm" } },
        ],
        slots: Array.from({ length: 14 }, (_, idx) => ({
          _id: `csa_slot_${idx + 1}`,
          index: idx,
          studentAttendance:
            idx + 1 === 5
              ? [
                  {
                    _id: "att_cp_1",
                    status: "ATTENDED",
                    comment: ".",
                    student: { id: "CP_ST1", fullName: "Nguyễn Hải Đăng" },
                    commentByAreas: [
                      { commentAreaId: "num_lt", type: "NUMBER", grade: 4.5, content: "" },
                      { commentAreaId: "num_th", type: "NUMBER", grade: 5.0, content: "" },
                      {
                        commentAreaId: "cp_obj",
                        type: "CHECKPOINT",
                        checkpoint: {
                          checkpointScore: 4.5,
                          practiceScore: 5.0,
                          checkpointQuestions: [{ id: "q1", title: "Câu 1", result: true, score: 1 }],
                        },
                      },
                      {
                        commentAreaId: "area_comp_note",
                        type: "CONTENT",
                        grade: 0,
                        content: "<p>Ghi chú năng lực kiến thức cũ cần giữ nguyên</p>",
                      },
                      { commentAreaId: "survey_rate", type: "RATE", grade: 3, content: "" },
                      { commentAreaId: "area_general", type: "CONTENT", grade: 0, content: "<p>.</p>" },
                    ],
                  },
                  {
                    _id: "att_cp_2",
                    status: "ATTENDED",
                    comment: `<p>${cp1Text}</p>`,
                    student: { id: "CP_ST2", fullName: "Lê Bảo Trâm" },
                    commentByAreas: [],
                  },
                ]
              : [],
        })),
      };

      mockState.updateCalls = [];
      const cpCodingRes = await uploadSessionCommentsViaApi({
        classId: cpClass,
        classCode: cpClass,
        sessionId: `${cpClass}_SESS_05`,
        lmsClassIdOverride: cpLmsId,
        graphqlEndpoint: gqlEndpoint,
        preferApiWrite: true,
      });
      assert.equal(cpCodingRes.verifiedCount, 1);
      assert.equal(cpCodingRes.skippedVerifiedCount, 1);
      assert.equal(mockState.updateCalls.length, 1);
      const cpSentAreas = mockState.updateCalls[0].byAreas;
      assert.equal(cpSentAreas.find((a) => a.commentAreaId === "num_lt")?.grade, 4.5, "Phải giữ nguyên NUMBER LT");
      assert.equal(cpSentAreas.find((a) => a.commentAreaId === "num_th")?.grade, 5.0, "Phải giữ nguyên NUMBER TH");
      assert.equal(
        cpSentAreas.find((a) => a.commentAreaId === "cp_obj")?.checkpoint?.checkpointScore,
        4.5,
        "Phải giữ nguyên CHECKPOINT object"
      );
      assert.equal(
        cpSentAreas.find((a) => a.commentAreaId === "area_comp_note")?.content,
        "<p>Ghi chú năng lực kiến thức cũ cần giữ nguyên</p>",
        "Phải giữ nguyên CONTENT nhận xét năng lực cũ"
      );
      assert.equal(cpSentAreas.find((a) => a.commentAreaId === "survey_rate")?.grade, 3, "Giữ nguyên survey RATE ngoài ĐNL");
      const sentDnlRates = cpSentAreas.filter(
        (a) => a.type === "RATE" && a.commentAreaId !== "survey_rate"
      );
      assert.equal(sentDnlRates.length, 9, "Coding Checkpoint phải ghi đúng 9 RATE [ĐNL]");
      const st1AfterCp = sessionFeedbackRepo.findOne(cpClass, `${cpClass}_SESS_05`, "CP_ST1")!;
      assert.equal(st1AfterCp.status, "VERIFIED");
      assert.deepEqual(parseCheckpointDataJson(st1AfterCp.checkpointDataJson)?.lmsCompetencyScores, cp9Desired);

      // S1-05c: LEGO Checkpoint B5 (`VT-KIND-ROB4I01`, 7 sao)
      const legoClass = "VT-KIND-ROB4I01";
      const legoLmsId = "lms_rob4_stage1";
      studentRepo.upsert({ studentId: "LG_ST1", classId: legoClass, fullName: "Mai Nhật Minh", isActive: 1 });
      const legoRatings: CompetencyScores = {
        knowledgeSelfStudy: 4,
        knowledgeInClass: 5,
        skillCommunication: 4,
        skillComputerUse: 5,
        skillProblemSolving: 5,
        skillCreativity: 4,
        skillComputational: 5,
        attitudeHomework: 4,
        attitudeInClass: 5,
      };
      const legoCpBase = {
        cpStage: 1 as const,
        isRobotics: true,
        isLego: true,
        theoryScore: null,
        practiceScore: null,
        competencyScores: legoRatings,
        competencyAverage: calculateCompetencyAverageForClassPure(legoRatings, legoClass),
      };
      const legoSnapHash = extractCheckpointCoreSnapshotHash(JSON.stringify(legoCpBase));
      const legoText =
        "📊 **Kết quả Checkpoint 1:** Điểm năng lực **4.71/5.0**\n- **Điểm mạnh của học viên:** Con lắp ráp và điều khiển mô hình LEGO rất vững.\n- **Điểm cần cải thiện:** Chú ý giữ linh kiện gọn hơn.\n- **Lời khuyên:** Ba mẹ khích lệ con nhé.";
      sessionFeedbackRepo.upsert({
        classId: legoClass,
        sessionId: `${legoClass}_SESS_05`,
        studentId: "LG_ST1",
        attendanceStatus: "PRESENT",
        finalText: legoText,
        contentHash: calculateSha256(legoText),
        status: "APPROVED",
        checkpointDataJson: JSON.stringify({ ...legoCpBase, approvedSnapshotHash: legoSnapHash }),
      });

      mockState.classes[legoLmsId] = {
        id: legoLmsId,
        name: legoClass,
        centre: { id: "ctr_lego" },
        course: { id: "c_rob4", name: "Robotics 4+ Intensive" },
        courseProcesses: [
          {
            id: "cp_proc_lego",
            checkpointEvaluations: [
              {
                id: "lego_ce_1",
                title: "Đánh giá LEGO",
                commentAreas: [
                  ...LEGO_COMPETENCY_AREA_SPECS.map((s) => ({
                    id: s.commentAreaId,
                    name: s.labelVi,
                    type: "RATE",
                  })),
                  { id: "67b54307f79c7bc326e017ff", name: "Đánh giá chung", type: "CONTENT" },
                ],
              },
            ],
          },
        ],
        students: [{ activeInClass: true, student: { id: "LG_ST1", fullName: "Mai Nhật Minh" } }],
        slots: Array.from({ length: 14 }, (_, idx) => ({
          _id: `lego_slot_${idx + 1}`,
          index: idx,
          studentAttendance:
            idx + 1 === 5
              ? [
                  {
                    _id: "att_lego_1",
                    status: "ATTENDED",
                    comment: "",
                    student: { id: "LG_ST1", fullName: "Mai Nhật Minh" },
                    commentByAreas: [
                      ...LEGO_COMPETENCY_AREA_SPECS.map((s) => ({
                        commentAreaId: s.commentAreaId,
                        type: "RATE",
                        grade: 0,
                        content: "",
                      })),
                      { commentAreaId: "67b54307f79c7bc326e017ff", type: "CONTENT", grade: 0, content: "" },
                    ],
                  },
                ]
              : [],
        })),
      };

      mockState.updateCalls = [];
      const legoApiRes = await uploadSessionCommentsViaApi({
        classId: legoClass,
        classCode: legoClass,
        sessionId: `${legoClass}_SESS_05`,
        lmsClassIdOverride: legoLmsId,
        graphqlEndpoint: gqlEndpoint,
        preferApiWrite: true,
      });
      assert.equal(legoApiRes.verifiedCount, 1);
      assert.equal(mockState.updateCalls.length, 1);
      const legoRatesSent = mockState.updateCalls[0].byAreas.filter((a) => a.type === "RATE");
      assert.equal(legoRatesSent.length, 7, "LEGO Checkpoint B5 bắt buộc chỉ ghi đúng 7 RATE (không phải 9)");
      for (const spec of LEGO_COMPETENCY_AREA_SPECS) {
        assert.equal(
          legoRatesSent.find((a) => a.commentAreaId === spec.commentAreaId)?.grade,
          legoRatings[spec.key],
          `LEGO RATE '${spec.key}' phải khớp giá trị đã duyệt`
        );
      }
      assert.equal(
        sessionFeedbackRepo.findOne(legoClass, `${legoClass}_SESS_05`, "LG_ST1")?.status,
        "VERIFIED"
      );

      // F01a & F01b: CHECKPOINT area enrichment (stripped from GetClassWriteContext) & fail-closed when GetClassById fails
      const f01Class = "VT-C4K-F01CP";
      const f01LmsId = "lms_f01_stage1";
      studentRepo.upsert({ studentId: "F01_ST1", classId: f01Class, fullName: "Lê Gia Hân", isActive: 1 });
      const f01CpBase = {
        cpStage: 1 as const,
        isRobotics: false,
        theoryScore: 4.0,
        practiceScore: 4.5,
        competencyScores: cp9Desired,
        competencyAverage: calculateCompetencyAverageForClassPure(cp9Desired, f01Class),
      };
      const f01CpText =
        "📊 **Kết quả Checkpoint 1:** Lý thuyết **4.0/5.0** | Thực hành **4.5/5.0** | Điểm năng lực **4.56/5.0**\n- **Điểm mạnh của học viên:** Con hoàn thành tốt bài thực hành Checkpoint 1.\n- **Điểm cần cải thiện:** Rèn thêm kiểm tra biên.\n- **Lời khuyên:** Duy trì thói quen tốt ở chặng 2.";
      sessionFeedbackRepo.upsert({
        classId: f01Class,
        sessionId: `${f01Class}_SESS_05`,
        studentId: "F01_ST1",
        attendanceStatus: "PRESENT",
        finalText: f01CpText,
        contentHash: calculateSha256(f01CpText),
        status: "APPROVED",
        checkpointDataJson: JSON.stringify({
          ...f01CpBase,
          approvedSnapshotHash: extractCheckpointCoreSnapshotHash(JSON.stringify(f01CpBase)),
        }),
      });
      const makeF01ClassDoc = (extraContentArea?: any) => ({
        id: f01LmsId,
        name: f01Class,
        centre: { id: "ctr_f01" },
        course: { id: "c_f01", name: "C4K" },
        courseProcesses: [],
        students: [{ activeInClass: true, student: { id: "F01_ST1", fullName: "Lê Gia Hân" } }],
        slots: Array.from({ length: 14 }, (_, idx) => ({
          _id: `f01_slot_${idx + 1}`,
          index: idx,
          studentAttendance:
            idx + 1 === 5
              ? [
                  {
                    _id: "att_f01_1",
                    status: "ATTENDED",
                    comment: "<p>Old general comment</p>",
                    student: { id: "F01_ST1", fullName: "Lê Gia Hân" },
                    commentByAreas: [
                      ...COMPETENCY_AREA_SPECS.map((s) => ({
                        commentAreaId: s.commentAreaId,
                        type: "RATE",
                        grade: 0,
                        content: "",
                      })),
                      {
                        commentAreaId: "f01_cp_area",
                        type: "CHECKPOINT",
                        checkpoint: {
                          checkpointScore: 4.0,
                          practiceScore: 4.5,
                          checkpointQuestions: [{ id: "q_f01", title: "Bài 1", result: true, score: 1 }],
                        },
                      },
                      extraContentArea || {
                        commentAreaId: "67b54307f79c7bc326e01888",
                        type: "CONTENT",
                        courseProcessCheckpointEvaluationTitle: "Đánh giá năng lực",
                        grade: 0,
                        content: "<p>Old general comment</p>",
                      },
                    ],
                  },
                ]
              : [],
        })),
      });

      // F01b: When GetClassById & GetClassByIdSafe BOTH fail while GetClassWriteContext strips CHECKPOINT -> fail-closed BEFORE calling UpdateSlotComment!
      mockState.classes[f01LmsId] = makeF01ClassDoc();
      mockState.stripCheckpointInWriteContext = true;
      mockState.failGetClassById = true;
      mockState.failGetClassByIdSafe = true;
      mockState.updateCalls = [];
      await assert.rejects(
        () =>
          uploadSessionCommentsViaApi({
            classId: f01Class,
            classCode: f01Class,
            sessionId: `${f01Class}_SESS_05`,
            lmsClassIdOverride: f01LmsId,
            graphqlEndpoint: gqlEndpoint,
            preferApiWrite: true,
          }),
        /CHECKPOINT_DETAIL_MISSING/i,
        "F01b: Thiếu object .checkpoint sau GetClassById bắt buộc phải fail-closed"
      );
      assert.equal(mockState.updateCalls.length, 0, "F01b: Tuyệt đối KHÔNG gọi UpdateSlotComment khi mất .checkpoint");

      // R2-F01: GetClassById errors & GetClassByIdSafe returns truncated checkpointQuestions ([{ result }]) missing id/title/score -> MUST fail-closed BEFORE UpdateSlotComment!
      mockState.failGetClassById = true;
      mockState.failGetClassByIdSafe = false;
      mockState.truncateSafeCheckpointQuestions = true;
      mockState.updateCalls = [];
      await assert.rejects(
        () =>
          uploadSessionCommentsViaApi({
            classId: f01Class,
            classCode: f01Class,
            sessionId: `${f01Class}_SESS_05`,
            lmsClassIdOverride: f01LmsId,
            graphqlEndpoint: gqlEndpoint,
            preferApiWrite: true,
          }),
        /CHECKPOINT_DETAIL_MISSING/i,
        "R2-F01: checkpointQuestions từ GetClassByIdSafe bị thiếu id/title/score bắt buộc phải fail-closed"
      );
      assert.equal(mockState.updateCalls.length, 0, "R2-F01: Tuyệt đối KHÔNG gọi UpdateSlotComment khi checkpointQuestions bị cụt trường");
      mockState.truncateSafeCheckpointQuestions = false;

      // F01a + F03a: When GetClassById succeeds, CHECKPOINT payload is enriched & preserved, AND 24-hex CONTENT matching old att.comment updates cleanly
      mockState.failGetClassById = false;
      mockState.failGetClassByIdSafe = false;
      mockState.updateCalls = [];
      const f01aRes = await uploadSessionCommentsViaApi({
        classId: f01Class,
        classCode: f01Class,
        sessionId: `${f01Class}_SESS_05`,
        lmsClassIdOverride: f01LmsId,
        graphqlEndpoint: gqlEndpoint,
        preferApiWrite: true,
      });
      assert.equal(f01aRes.verifiedCount, 1);
      assert.equal(mockState.updateCalls.length, 1);
      const f01SentAreas = mockState.updateCalls[0].byAreas;
      assert.equal(
        f01SentAreas.find((a) => a.commentAreaId === "f01_cp_area")?.checkpoint?.checkpointScore,
        4.0,
        "F01a: UpdateSlotComment phải giữ nguyên object .checkpoint từ GetClassById"
      );
      const updated24HexArea = f01SentAreas.find((a) => a.commentAreaId === "67b54307f79c7bc326e01888");
      assert.ok(
        String(updated24HexArea?.content || "").includes("Điểm mạnh của học viên"),
        "F03a: Vùng 24-hex CONTENT khớp att.comment cũ phải được cập nhật nội dung mới"
      );
      assert.equal(sessionFeedbackRepo.findOne(f01Class, `${f01Class}_SESS_05`, "F01_ST1")?.status, "VERIFIED");

      // F03b: Ambiguous 24-hex CONTENT area (does NOT match att.comment and no "Đánh giá chung" title) -> MUST fail-closed pre-mutation
      sessionFeedbackRepo.upsert({
        classId: f01Class,
        sessionId: `${f01Class}_SESS_05`,
        studentId: "F01_ST1",
        attendanceStatus: "PRESENT",
        finalText: f01CpText,
        contentHash: calculateSha256(f01CpText),
        status: "APPROVED",
        checkpointDataJson: JSON.stringify({
          ...f01CpBase,
          approvedSnapshotHash: extractCheckpointCoreSnapshotHash(JSON.stringify(f01CpBase)),
        }),
      });
      mockState.classes[f01LmsId] = makeF01ClassDoc({
        commentAreaId: "67b54307f79c7bc326e01999",
        type: "CONTENT",
        courseProcessCheckpointEvaluationTitle: "Đánh giá năng lực",
        grade: 0,
        content: "<p>Khác hoàn toàn att.comment nên mơ hồ</p>",
      });
      mockState.updateCalls = [];
      await assert.rejects(
        () =>
          uploadSessionCommentsViaApi({
            classId: f01Class,
            classCode: f01Class,
            sessionId: `${f01Class}_SESS_05`,
            lmsClassIdOverride: f01LmsId,
            graphqlEndpoint: gqlEndpoint,
            preferApiWrite: true,
          }),
        /AMBIGUOUS_CHECKPOINT_CONTENT_AREA/i,
        "F03b: Vùng CONTENT Checkpoint mơ hồ phải ném AMBIGUOUS_CHECKPOINT_CONTENT_AREA pre-mutation"
      );
      assert.equal(mockState.updateCalls.length, 0, "F03b: Không được gọi UpdateSlotComment khi CONTENT Checkpoint mơ hồ");
      mockState.stripCheckpointInWriteContext = false;

      // F09 check: Re-uploading already-VERIFIED students returns skippedVerifiedCount > 0 and verifiedCount === 0
      const f09SkipRes = await uploadSessionCommentsViaApi({
        classId: legoClass,
        classCode: legoClass,
        sessionId: `${legoClass}_SESS_05`,
        lmsClassIdOverride: legoLmsId,
        graphqlEndpoint: gqlEndpoint,
        preferApiWrite: true,
      });
      assert.equal(f09SkipRes.verifiedCount, 0);
      assert.equal(f09SkipRes.skippedVerifiedCount, 1);

      // S1-05d: Session 14 & LmsWriteStrictError MUST NOT trigger Playwright fallback
      let playwrightOpenedOnStrict = false;
      bm.getPage = async () => {
        playwrightOpenedOnStrict = true;
        throw new Error("Playwright should not open on strict error");
      };
      await assert.rejects(
        () =>
          CommentSaver.saveComments({
            classId: codingId,
            classCode: codingId,
            sessionId: `${codingId}_SESS_14`,
            preferApiWrite: true,
            graphqlEndpoint: gqlEndpoint,
          }),
        /Buổi 14/i
      );
      assert.equal(playwrightOpenedOnStrict, false);

      await assert.rejects(
        () =>
          uploadSessionCommentsViaApi({
            classId: codingId,
            classCode: codingId,
            sessionId: `${codingId}_SESS_14`,
            preferApiWrite: true,
            graphqlEndpoint: gqlEndpoint,
          }),
        (err: unknown) => err instanceof LmsWriteStrictError
      );

      // S1-05e: Pre-mutation transport error (HTTP 503) MUST fall back cleanly to Playwright!
      const fbText3 =
        "- **Điểm mạnh của học viên:** Con làm tốt bài tập Buổi 3.\n- **Điểm cần cải thiện:** Cần kiểm tra điều kiện dừng.\n- **Lời khuyên:** Giữ vững phong độ nhé.";
      sessionFeedbackRepo.upsert({
        classId: codingId,
        sessionId: `${codingId}_SESS_03`,
        studentId: "ST_01",
        attendanceStatus: "PRESENT",
        finalText: fbText3,
        contentHash: calculateSha256(fbText3),
        status: "APPROVED",
      });

      browser = await chromium.launch({ headless: true });
      const pwContext = await browser.newContext();
      const pwPage = await pwContext.newPage();
      let pwServerSaved = "";
      await pwPage.route("https://lms.mindx.edu.vn/**", async (route) => {
        await route.fulfill({ status: 200, contentType: "text/html", body: "<html><body></body></html>" });
      });
      await pwPage.route("https://lms-api.mindx.edu.vn/**", async (route) => {
        if (route.request().method() === "OPTIONS") {
          await route.fulfill({
            status: 204,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "POST, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type, Authorization",
            },
          });
          return;
        }
        const body = JSON.parse(route.request().postData() || "{}");
        if (body.operationName === "UpdateSlotComment") {
          pwServerSaved = String(body?.variables?.comment || "");
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ data: { updateSlotComment: { ok: true } } }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({
            data: {
              classesById: {
                id: ptaLmsId,
                name: codingId,
                slots: [
                  { index: 0, studentAttendance: [] },
                  { index: 1, studentAttendance: [] },
                  {
                    index: 2,
                    studentAttendance: [
                      {
                        status: "ATTENDED",
                        student: { id: "ST_01", fullName: "Nguyễn Thành Phong" },
                        comment: pwServerSaved,
                        commentByAreas: pwServerSaved ? [{ type: "CONTENT", content: pwServerSaved }] : [],
                      },
                    ],
                  },
                ],
              },
            },
          }),
        });
      });
      await pwPage.goto("https://lms.mindx.edu.vn/admin/classes");
      await pwPage.setContent(`
        <html><body>
          <div aria-labelledby="class-detail" class="MuiDrawer-paperAnchorRight" id="class-drawer">
            <div id="class-comments-slot-carousel-2" class="slot-item active"><div class="info-container">#3</div></div>
            <div class="comment-list-table"><table><tbody>
              <tr data-student-id="ST_01">
                <td>Nguyễn Thành Phong</td>
                <td><button type="button" class="open-comment-btn" data-stu="ST_01">Nhận xét học sinh</button></td>
              </tr>
            </tbody></table></div>
          </div>
          <div id="modal-root"></div>
        </body></html>
      `);
      await pwPage.evaluate(() => {
        (window as any).savedDomHtml = "";
        document.querySelector(".open-comment-btn")?.addEventListener("click", () => {
          const modalRoot = document.getElementById("modal-root")!;
          if ((window as any).savedDomHtml) {
            modalRoot.innerHTML = `<div role="dialog"><table><tbody><tr><td>- Đánh giá chung: ${(window as any).savedDomHtml}</td></tr></tbody></table></div>`;
            return;
          }
          modalRoot.innerHTML = `<div role="dialog"><div class="ql-editor" contenteditable="true" id="ed"></div><button type="button" id="save-btn">Save</button></div>`;
          document.getElementById("save-btn")?.addEventListener("click", () => {
            const html = document.getElementById("ed")?.innerHTML || "";
            (window as any).savedDomHtml = html;
            modalRoot.innerHTML = "";
            fetch("https://lms-api.mindx.edu.vn/graphql", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                operationName: "UpdateSlotComment",
                variables: { classId: "VT-C4K-PTA13", studentId: "ST_01", slotNumber: 3, comment: html },
              }),
            });
          });
        });
      });

      let playwrightFallbackEntered = false;
      bm.getPage = async () => {
        playwrightFallbackEntered = true;
        return pwPage;
      };
      authService.ensureAuthenticated = async () => {};
      LmsHelpers.openClassDrawer = async () => {};
      LmsHelpers.switchDrawerTab = async () => {};

      mockState.failAllRequests = true;
      const fallbackRes = await CommentSaver.saveComments({
        classId: codingId,
        classCode: codingId,
        sessionId: `${codingId}_SESS_03`,
        studentId: "ST_01",
        lmsClassIdOverride: ptaLmsId,
        graphqlEndpoint: gqlEndpoint,
        preferApiWrite: true,
      });
      mockState.failAllRequests = false;
      assert.equal(playwrightFallbackEntered, true, "Lỗi HTTP 503 trước mutation đầu phải tự lùi sang Playwright");
      assert.equal(fallbackRes.verifiedCount, 1);
      assert.equal(sessionFeedbackRepo.findOne(codingId, `${codingId}_SESS_03`, "ST_01")?.status, "VERIFIED");

      // F02: Summary/Homework update succeeding BEFORE student #1 mutation MUST NOT block Playwright fallback when student #1 hits 503
      sessionFeedbackRepo.upsert({
        classId: codingId,
        sessionId: `${codingId}_SESS_03`,
        studentId: "ST_01",
        attendanceStatus: "PRESENT",
        finalText: fbText3,
        contentHash: calculateSha256(fbText3),
        status: "APPROVED",
      });
      mockState.classes[ptaLmsId].slots[2].summary = "";
      mockState.classes[ptaLmsId].slots[2].homework = "";
      playwrightFallbackEntered = false;
      pwServerSaved = "";
      await pwPage.evaluate(() => {
        (window as any).savedDomHtml = "";
        const modalRoot = document.getElementById("modal-root");
        if (modalRoot) modalRoot.innerHTML = "";
      });
      mockState.summaryUpdateCalls = 0;
      mockState.failStudentMutation = true;
      const f02Res = await CommentSaver.saveComments({
        classId: codingId,
        classCode: codingId,
        sessionId: `${codingId}_SESS_03`,
        studentId: "ST_01",
        lmsClassIdOverride: ptaLmsId,
        graphqlEndpoint: gqlEndpoint,
        preferApiWrite: true,
        topic: "Lặp vòng For nâng cao",
        keyKnowledge: ["Hiểu biến đếm và bước nhảy"],
        homeworkBrief: "Hoàn thành 2 bài tập vòng lặp",
      });
      mockState.failStudentMutation = false;
      assert.equal(mockState.summaryUpdateCalls, 1, "F02: Nhánh Summary/Homework phải chạy trước trên API");
      assert.equal(playwrightFallbackEntered, true, "F02: Summary/Homework đã mutate không được chặn Playwright fallback khi HV #1 lỗi 503");
      assert.equal(f02Res.verifiedCount, 1);
      assert.equal(sessionFeedbackRepo.findOne(codingId, `${codingId}_SESS_03`, "ST_01")?.status, "VERIFIED");

      // F09 & F10 UI contract checks in src/app/session-comments/page.tsx
      const pageTsxSrc = fs.readFileSync(
        path.resolve(process.cwd(), "src", "app", "session-comments", "page.tsx"),
        "utf8"
      );
      assert.ok(
        pageTsxSrc.includes("verifiedCount === 0 && skippedVerifiedCount > 0 && totalErrors === 0") &&
          pageTsxSrc.includes('type: "info"'),
        "F09: page.tsx phải báo banner info khi toàn bộ HV đều đã VERIFIED được bỏ qua"
      );
      const aiSingleMatch = pageTsxSrc.match(/data-testid=\{`ai-single-btn-[\s\S]{0,1400}<\/button>/);
      assert.ok(aiSingleMatch, "F10: Phải tìm thấy nút ai-single-btn trong page.tsx");
      assert.equal(aiSingleMatch![0].includes("<Sparkles"), false, "F10: Nút AI riêng không được trùng icon <Sparkles />");
      assert.ok(aiSingleMatch![0].includes("✨ AI riêng"), "F10: Nút AI riêng phải giữ nhãn '✨ AI riêng'");
      assert.ok(
        pageTsxSrc.includes('data-testid="fetch-btvn-lms-btn"') &&
          pageTsxSrc.includes("handleFetchBtvnFromLms(e.shiftKey)"),
        "F10: Nút fetch-btvn-lms-btn phải hỗ trợ Shift+Click -> forceLiveScrape"
      );

      await pwContext.close();
      console.log("  -> PASS S1-05.");
    } finally {
      await new Promise<void>((resolve) => gqlServer.close(() => resolve()));
    }

    console.log("\n=== TẤT CẢ KIỂM THỬ CHẶNG 1 (S1-01 .. S1-05 & F01 .. F11) ĐỀU PASS 100%! ===");
  } finally {
    setLmsHttpTransportForTest(null);
    ScoreScraper.scrapeClassScores = origScrapeClassScores;
    globalThis.fetch = origGlobalFetch;
    bm.getPage = origGetPage;
    authService.ensureAuthenticated = origEnsureAuth;
    LmsHelpers.openClassDrawer = origOpenDrawer;
    LmsHelpers.switchDrawerTab = origSwitchTab;
    if (browser) await browser.close().catch(() => {});
    closeDb();
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
    for (const item of baselineHashes) {
      assert.equal(
        sha256File(item.path),
        item.sha256,
        `SHA-256 tệp dữ liệu thật bị thay đổi ngoài ý muốn: ${item.path}`
      );
    }
  }
}

main().catch((err) => {
  console.error("❌ TEST CHẶNG 1 THẤT BẠI:", err);
  process.exit(1);
});
