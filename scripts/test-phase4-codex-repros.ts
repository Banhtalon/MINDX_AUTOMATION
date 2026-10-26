import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import Database from "better-sqlite3";
import * as XLSX from "xlsx";
import { ScoreScraper } from "../src/lib/playwright/scrape-scores";
import { GET as exportGET } from "../src/app/api/homework-grader/export/route";
import { ZaloBroadcastGenerator } from "../src/lib/zalo/broadcast-generator";
import { CommentGenerator } from "../src/lib/gemini/comment-generator";
import { getQuickTags } from "../src/lib/db/json-config";
import { assertPathAllowed } from "../src/lib/security/path-allowlist";

function transpileForVm(filePath: string): string {
  const tsCode = fs.readFileSync(filePath, "utf8");
  const stripped = stripTypeScriptTypes(tsCode);
  return stripped
    .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/\bexport\s+/g, "");
}

const exportHelpersCtx = vm.createContext({ XLSX, NextResponse: Response, URL, console });
vm.runInContext(
  transpileForVm("src/app/api/homework-grader/export/route.ts") +
    "\nglobalThis.out = { formatCellForExport, sanitizeSpreadsheetCell };",
  exportHelpersCtx
);
const { formatCellForExport, sanitizeSpreadsheetCell } = exportHelpersCtx.out as {
  formatCellForExport: (cell?: any, mode?: "both" | "practice" | "quiz") => string | number;
  sanitizeSpreadsheetCell: (value: string | number) => string | number;
};

const pageRaw = fs.readFileSync("src/app/homework-grader/page.tsx", "utf8");
const pageHelperPrefix = pageRaw.slice(0, pageRaw.indexOf("export default function"));
const pageHelpersCtx = vm.createContext({ console });
vm.runInContext(
  stripTypeScriptTypes(
    pageHelperPrefix
      .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
      .replace(/\bexport\s+/g, "")
  ) + "\nglobalThis.out = { sanitizeTsvCell, htmlToPlainText };",
  pageHelpersCtx
);
const { sanitizeTsvCell, htmlToPlainText } = pageHelpersCtx.out as {
  sanitizeTsvCell: (value: string | number) => string;
  htmlToPlainText: (rawHtml?: string) => string;
};
async function runTests() {
  console.log("=== [SELF-TEST] KIỂM TRA TRIỆT ĐỂ 14 MỤC CODEX REVIEW (PHASE 3 & PHASE 4) ===");

  // ---------------------------------------------------------------------------
  // 1. Finding #8: ScoreScraper.parseScoreCell edge cases
  // ---------------------------------------------------------------------------
  console.log("1. Testing Finding #8: ScoreScraper.parseScoreCell edge cases...");
  const c0 = ScoreScraper.parseScoreCell("0/100", "HW_1", 1);
  assert.equal(c0.status, "GRADED");
  assert.equal(c0.score, 0);

  const cParen0 = ScoreScraper.parseScoreCell("Đã chấm (0/100)", "HW_1", 1);
  assert.equal(cParen0.status, "GRADED");
  assert.equal(cParen0.score, 0);

  const cUngradedWithZero = ScoreScraper.parseScoreCell("Chưa chấm (0/1) 0/100", "HW_1", 1);
  assert.equal(cUngradedWithZero.status, "SUBMITTED_UNGRADED");
  assert.equal(cUngradedWithZero.score, null);

  assert.throws(
    () => ScoreScraper.parseScoreCell("Đã chấm (1/1)", "HW_1", 1),
    /thiếu điểm số cụ thể|không hợp lệ/i,
    "Đã chấm (1/1) thiếu điểm phải báo lỗi thay vì tự gán 100 điểm"
  );
  console.log("   [PASS] Finding #8 parseScoreCell");

  // ---------------------------------------------------------------------------
  // 2. Findings #3, #7, #8, #11: ScoreScraper.scrapeClassScores reproduction cases
  // ---------------------------------------------------------------------------
  console.log("2. Testing Findings #3, #7, #8, #11: ScoreScraper.scrapeClassScores...");
  const scrapeJs = transpileForVm("src/lib/playwright/scrape-scores.ts");

  function runScrapeScenario(opts: {
    gqlStatus?: number;
    gqlPayload?: any;
    reqClassId?: string;
    existingStudents?: any[];
    noGql?: boolean;
  }) {
    const savedCache: any[] = [];
    const emptyLoc: any = {
      first: () => emptyLoc,
      count: async () => 0,
      isVisible: async () => false,
      getAttribute: async () => "false",
      scrollIntoViewIfNeeded: async () => {},
      click: async () => {},
      locator: () => emptyLoc,
      nth: () => emptyLoc,
      innerText: async () => "",
    };
    const page: any = {
      locator: () => emptyLoc,
      on(ev: string, fn: any) {
        if (ev === "response") this._fn = fn;
      },
      off() {},
      async waitForTimeout() {
        if (!opts.noGql && this._fn && !this._called) {
          this._called = true;
          await this._fn({
            url: () => "https://lms-api.mindx.edu.vn/",
            status: () => opts.gqlStatus ?? 200,
            request: () => ({
              method: () => "POST",
              postDataJSON: () => ({
                operationName: "FindStudentSubmissionByClass",
                variables: { payload: { classId: opts.reqClassId ?? "LMS_CLASS_1" } },
              }),
            }),
            json: async () => ({
              data: { findStudentSubmissionByClass: opts.gqlPayload },
            }),
          });
        }
      },
    };
    const sandbox: any = {
      console,
      Date,
      Math,
      Map,
      Set,
      JSON,
      RegExp,
      Error,
      Array,
      Object,
      Number,
      String,
      Boolean,
      parseInt,
      parseFloat,
      isNaN,
      authService: { ensureAuthenticated: async () => {} },
      BrowserManager: {
        getPage: async () => page,
        getInstance: () => ({ getPage: async () => page }),
      },
      createNetworkInterceptor: () => ({
        dismissForbiddenToast: async () => {},
      }),
      NetworkInterceptor: class {
        async dismissForbiddenToast() {}
      },
      LmsHelpers: {
        ensureLoggedIn: async () => {},
        openClassDrawer: async () => ({ drawerLocator: emptyLoc }),
        switchDrawerTab: async () => {},
      },
      SELECTORS: { tabs: { grading: ["Chấm bài"] } },
      getDb: () => ({
        exec() {},
        prepare: () => ({
          run: (...a: any[]) => savedCache.push(a),
        }),
      }),
      studentRepo: {
        findByClass: () =>
          opts.existingStudents ?? [
            { studentId: "S1", classId: "CLASS_A", fullName: "Nguyễn An", isActive: 1 },
            { studentId: "S2", classId: "CLASS_A", fullName: "Nguyễn An", isActive: 1 },
          ],
        upsert() {},
      },
      scoreMatrixRepo: {
        save: (cid: string, m: any) => savedCache.push([cid, m]),
      },
      jobLogRepo: { add() {} },
    };
    vm.createContext(sandbox);
    vm.runInContext(scrapeJs + "\n;globalThis.ScoreScraper = ScoreScraper;", sandbox);
    return sandbox.ScoreScraper.scrapeClassScores("CLASS_A").then((res: any) => ({
      res,
      savedCache,
    }));
  }

  // 2a. Duplicate student names + Quiz-only lesson (Quiz must NOT pollute averageScore)
  const dupRes = await runScrapeScenario({
    reqClassId: "66f123456789abcdef012345",
    gqlPayload: {
      classCode: "CLASS_A",
      lessons: [{ id: "L1", name: "Buổi 1", displayOrder: 1, type: "QUIZ" }],
      students: [
        { id: "S1", studentUid: "S1", displayName: "Nguyen An", status: "ACTIVE" },
        { id: "S2", studentUid: "S2", displayName: "Nguyen An", status: "ACTIVE" },
      ],
      submissions: [
        { id: "SUB1", studentUid: "S1", lessonId: "L1", submissionType: "QUIZ", status: "MARKED", score: 90 },
        { id: "SUB2", studentUid: "S2", lessonId: "L1", submissionType: "QUIZ", status: "MARKED", score: 40 },
      ],
    },
  });
  assert.equal(dupRes.res.success, true, `dupRes failed with: ${dupRes.res.error}`);
  assert.notEqual(
    dupRes.res.rows[0].studentId,
    dupRes.res.rows[1].studentId,
    "Học viên trùng tên phải giữ studentId riêng biệt"
  );
  assert.equal(
    dupRes.res.rows[0].averageScore,
    null,
    "Buổi chỉ có Quiz 90 không được làm trung bình thực hành thành 90"
  );
  assert.equal(dupRes.res.rows[0].averageQuizScore, 90);

  // 2b. MARKED with score: null must fail (not invent 0)
  const markedNullRes = await runScrapeScenario({
    reqClassId: "CLASS_A",
    gqlPayload: {
      lessons: [{ id: "L1", name: "Buổi 1", displayOrder: 1 }],
      students: [
        { id: "S1", studentUid: "S1", displayName: "Nguyễn An", status: "ACTIVE" },
        { id: "S2", studentUid: "S2", displayName: "Nguyễn Bình", status: "ACTIVE" },
      ],
      submissions: [
        { id: "SUB1", studentUid: "S1", lessonId: "L1", submissionType: "PRACTICE", status: "MARKED", score: null },
      ],
    },
  });
  assert.equal(markedNullRes.res.success, false, "MARKED với score: null phải báo lỗi");
  assert.equal(markedNullRes.savedCache.length, 0, "Không được ghi đè cache khi lỗi");

  // 2c. HTTP 500 or wrong classId must fail and not overwrite cache
  const wrongClassRes = await runScrapeScenario({
    gqlStatus: 500,
    reqClassId: "OTHER_CLASS",
    gqlPayload: {
      lessons: [{ id: "L1", name: "Buổi 1", displayOrder: 1 }],
      students: [{ id: "S1", studentUid: "S1", displayName: "Nguyễn An", status: "ACTIVE" }],
      submissions: [],
    },
  });
  assert.equal(wrongClassRes.res.success, false);
  assert.equal(wrongClassRes.savedCache.length, 0);

  // 2d. Empty GraphQL + Empty DOM must fail and not overwrite cache
  const emptyRes = await runScrapeScenario({ noGql: true });
  assert.equal(emptyRes.res.success, false);
  assert.equal(emptyRes.savedCache.length, 0);
  console.log("   [PASS] Findings #3, #7, #8, #11 scrapeClassScores");

  // ---------------------------------------------------------------------------
  // 3. Findings #1, #2, #3, #5, #6: CommentSaver.saveComments reproduction cases
  // ---------------------------------------------------------------------------
  console.log("3. Testing Findings #1, #2, #3, #5, #6: CommentSaver.saveComments...");
  const saveJs = transpileForVm("src/lib/playwright/save-comments.ts");

  async function runSaveScenario(opts: {
    apiOk: boolean;
    readbackText: string;
    raceEditToDraft?: boolean;
    classId?: string;
    classCode?: string;
    sessionId?: string;
    graphqlError?: boolean;
  }) {
    let currentRecord: any = {
      studentId: "S1",
      classId: opts.classId ?? "CLASS_A",
      sessionId: opts.sessionId ?? "CLASS_A_SESS_01",
      finalText: "FIRST_30_CHARS_SAME_1234567890 EXPECTED TAIL",
      contentHash: "HASH_APPROVED",
      status: "APPROVED",
    };
    const statuses: any[] = [];
    const loc = (): any => ({
      first() {
        return this;
      },
      locator() {
        return loc();
      },
      filter() {
        return this;
      },
      count: async () => 1,
      waitFor: async () => {},
      scrollIntoViewIfNeeded: async () => {},
      isVisible: async () => true,
      isEnabled: async () => true,
      getAttribute: async () => "slot-item active",
      click: async () => {},
      evaluate: async (_fn: any, arg: any) => {
        if (arg !== undefined && opts.raceEditToDraft) {
          currentRecord = {
            ...currentRecord,
            finalText: "EDITED BY TEACHER DURING SAVE",
            contentHash: "HASH_DRAFT",
            status: "DRAFT",
          };
        }
        return true;
      },
      innerText: async () => opts.readbackText,
      textContent: async () => opts.readbackText,
      inputValue: async () => opts.readbackText,
    });
    const page: any = {
      waitForTimeout: async () => {},
      keyboard: { press: async () => {}, insertText: async () => {} },
      screenshot: async () => {},
      locator: () => loc(),
    };
    const sandbox: any = {
      console,
      Date,
      Math,
      Map,
      Set,
      JSON,
      RegExp,
      Error,
      Array,
      Object,
      Number,
      String,
      Boolean,
      parseInt,
      authService: { ensureAuthenticated: async () => {} },
      BrowserManager: {
        getPage: async () => page,
        getInstance: () => ({ getPage: async () => page }),
      },
      createNetworkInterceptor: () => ({
        dismissForbiddenToast: async () => {},
        waitForApiResponse: async () => {
          if (!opts.apiOk) throw new Error("HTTP 500");
          if (opts.graphqlError) throw new Error("[GraphQL API Error] Forbidden");
          return { status: () => 200 };
        },
      }),
      LmsHelpers: {
        ensureLoggedIn: async () => {},
        openClassDrawer: async () => ({ drawerLocator: loc() }),
        switchDrawerTab: async () => {},
        clickAndVerify: async () => {},
      },
      SELECTORS: {
        tabs: { comments: ["Comments"] },
        comments: {
          commentInput: ".ql-editor",
          saveButton: 'button:has-text("Save")',
        },
      },
      verifyContentIntegrity: (text: string, hash: string) =>
        text === "FIRST_30_CHARS_SAME_1234567890 EXPECTED TAIL" && hash === "HASH_APPROVED",
      sessionFeedbackRepo: {
        findBySession: () => [{ ...currentRecord }],
        findOne: () => ({ ...currentRecord }),
        updateStatus: (...a: any[]) => {
          statuses.push(a);
          currentRecord.status = a[3];
        },
      },
      studentRepo: {
        findByClass: () => [{ studentId: "S1", classId: "CLASS_A", fullName: "Nguyễn An", isActive: 1 }],
        findOne: () => ({ studentId: "S1", classId: "CLASS_A", fullName: "Nguyễn An", isActive: 1 }),
      },
      classSessionRepo: {
        findByClass: () => [{ classId: "CLASS_A", sessionId: "CLASS_A_SESS_01", sessionNumber: 1 }],
      },
      jobLogRepo: { add() {} },
    };
    vm.createContext(sandbox);
    vm.runInContext(saveJs + "\n;globalThis.CommentSaver = CommentSaver;", sandbox);
    const out = await sandbox.CommentSaver.saveComments({
      classId: opts.classId ?? "CLASS_A",
      classCode: opts.classCode ?? "CLASS_A",
      sessionId: opts.sessionId ?? "CLASS_A_SESS_01",
    });
    return { out, statuses, currentRecord };
  }

  // 3a. API ok but DOM readback mismatches after 30 chars -> MUST NOT verify
  const r3a = await runSaveScenario({
    apiOk: true,
    readbackText: "FIRST_30_CHARS_SAME_1234567890 WRONG TAIL",
  });
  assert.equal(r3a.out.verifiedCount, 0);
  assert.notEqual(r3a.currentRecord.status, "VERIFIED");

  // 3b. API fails even though DOM readback matches -> MUST NOT verify
  const r3b = await runSaveScenario({
    apiOk: false,
    readbackText: "FIRST_30_CHARS_SAME_1234567890 EXPECTED TAIL",
  });
  assert.equal(r3b.out.verifiedCount, 0);
  assert.notEqual(r3b.currentRecord.status, "VERIFIED");

  // 3c. Mismatched classId vs classCode -> MUST fail immediately
  await assert.rejects(
    () =>
      runSaveScenario({
        apiOk: true,
        readbackText: "FIRST_30_CHARS_SAME_1234567890 EXPECTED TAIL",
        classId: "CLASS_A",
        classCode: "CLASS_B",
      }),
    /không đồng nhất với mã lớp/i
  );

  // 3d. Concurrent teacher edit to DRAFT during save -> MUST NOT overwrite DRAFT to VERIFIED
  const r3d = await runSaveScenario({
    apiOk: true,
    readbackText: "FIRST_30_CHARS_SAME_1234567890 EXPECTED TAIL",
    raceEditToDraft: true,
  });
  assert.equal(r3d.out.verifiedCount, 0);
  assert.equal(r3d.currentRecord.status, "DRAFT");

  // 3e. Both API ok AND full text matches AND no concurrent edit -> VERIFIED
  const r3e = await runSaveScenario({
    apiOk: true,
    readbackText: "FIRST_30_CHARS_SAME_1234567890 EXPECTED TAIL",
  });
  assert.equal(r3e.out.verifiedCount, 1);
  assert.equal(r3e.currentRecord.status, "VERIFIED");
  console.log("   [PASS] Findings #1, #2, #3, #5, #6 CommentSaver.saveComments");

  // ---------------------------------------------------------------------------
  // 4. Findings #3, #4, #12: ClassSyncer.syncClass & scrapeStudents pagination
  // ---------------------------------------------------------------------------
  console.log("4. Testing Findings #3, #4, #12: ClassSyncer.syncClass & pagination...");
  const syncJs = transpileForVm("src/lib/playwright/sync-class.ts");

  const sqlCalls: string[] = [];
  let studentPage = 1;
  const syncEmptyLoc: any = {
    first: () => syncEmptyLoc,
    count: async () => 0,
    isVisible: async () => false,
    isEnabled: async () => false,
    getAttribute: async () => null,
    click: async () => {},
    innerText: async () => "",
    locator: () => syncEmptyLoc,
    nth: () => syncEmptyLoc,
  };
  const syncSandbox: any = {
    console,
    Date,
    Math,
    Map,
    Set,
    JSON,
    RegExp,
    Error,
    Array,
    Object,
    Number,
    String,
    Boolean,
    parseInt,
    authService: { ensureAuthenticated: async () => {} },
    BrowserManager: {
      getPage: async () => ({
        waitForTimeout: async () => {},
        locator: () => syncEmptyLoc,
      }),
      getInstance: () => ({
        getContext: async () => ({}),
        getPage: async () => ({
          waitForTimeout: async () => {},
          locator: () => syncEmptyLoc,
        }),
      }),
    },
    createNetworkInterceptor: () => ({
      dismissForbiddenToast: async () => {},
    }),
    NetworkInterceptor: class {
      async dismissForbiddenToast() {}
    },
    LmsHelpers: {
      ensureLoggedIn: async () => {},
      openClassDrawer: async () => ({ drawerLocator: syncEmptyLoc }),
      switchDrawerTab: async () => {},
    },
    SELECTORS: {
      tabs: { schedule: ["Lịch học"], students: ["Học viên"] },
      students: { paginationNext: "button.next" },
    },
    getDb: () => ({
      prepare: (sql: string) => ({
        run: () => sqlCalls.push(sql),
      }),
      transaction: (fn: any) => fn,
    }),
    classSessionRepo: { upsert() {} },
    studentRepo: { upsert() {} },
    jobLogRepo: { add() {} },
  };
  vm.createContext(syncSandbox);
  vm.runInContext(syncJs + "\n;globalThis.ClassSyncer = ClassSyncer;", syncSandbox);

  // 4a. Empty DOM must fail without deleting existing SQLite data and without inventing 14 fake sessions
  const emptySyncRes = await syncSandbox.ClassSyncer.syncClass("CLASS_A");
  assert.equal(emptySyncRes.success, false, "Đồng bộ rỗng phải báo lỗi");
  assert.equal(
    sqlCalls.some((s) => /DELETE/i.test(s)),
    false,
    "Không được xóa dữ liệu cũ khi đồng bộ thất bại"
  );

  // 4b. 100 rows on page 1 + 1 row on page 2 must produce 101 unique studentIds
  const pagedPage: any = {
    waitForTimeout: async () => {},
    locator: (sel: string) => {
      const s = String(sel || "");
      if (s.includes("tbody tr")) {
        return {
          count: async () => (studentPage === 1 ? 100 : 1),
          nth: (i: number) => ({
            innerText: async () => `Học viên trang ${studentPage} dòng ${i + 1}`,
            getAttribute: async () => null,
            locator: () => ({
              count: async () => 0,
              first: () => ({
                count: async () => 0,
                isVisible: async () => false,
                isChecked: async () => true,
                getAttribute: async () => "true",
              }),
            }),
          }),
        };
      }
      if (s.includes("next page") || s.includes("ant-pagination-next")) {
        return {
          first: () => ({
            count: async () => 1,
            isVisible: async () => studentPage === 1,
            isEnabled: async () => studentPage === 1,
            getAttribute: async (attr: string) => (attr === "aria-disabled" ? (studentPage === 1 ? "false" : "true") : ""),
            click: async () => {
              studentPage = 2;
            },
          }),
        };
      }
      return syncEmptyLoc;
    },
  };
  const scrapedStudents = await syncSandbox.ClassSyncer.scrapeStudents(
    pagedPage,
    "CLASS_A"
  );
  const uniqueIds = new Set(scrapedStudents.map((s: any) => s.studentId));
  assert.equal(scrapedStudents.length, 101);
  assert.equal(uniqueIds.size, 101, "100 dòng trang 1 + 1 dòng trang 2 phải có 101 studentId duy nhất");
  console.log("   [PASS] Findings #3, #4, #12 ClassSyncer");

  // ---------------------------------------------------------------------------
  // 5. Findings #9, #11: Export & TSV sanitization + Quiz column consistency
  // ---------------------------------------------------------------------------
  console.log("5. Testing Findings #9, #11: Export & TSV formula/delimiter sanitization...");
  assert.equal(sanitizeSpreadsheetCell("=1+1"), "'=1+1");
  assert.equal(sanitizeSpreadsheetCell("  +SUM(A1:A2)"), "'  +SUM(A1:A2)");
  assert.equal(sanitizeTsvCell("Nguyễn \"An\",\nBình\tC"), 'Nguyễn "An", Bình C');
  assert.equal(sanitizeTsvCell("=CMD|' /C calc'!A0"), "'=CMD|' /C calc'!A0");

  // Format cell consistency across GRADED, SUBMITTED_UNGRADED, NOT_SUBMITTED, REDO_REQUESTED with Quiz score
  const ungradedWithQuiz: any = {
    columnId: "C1",
    sessionNumber: 1,
    status: "SUBMITTED_UNGRADED",
    score: null,
    quizScore: 85,
    maxScore: 100,
    rawText: "Chưa chấm",
  };
  assert.equal(formatCellForExport(ungradedWithQuiz, "both"), "Chưa chấm (Quiz: 85)");
  assert.equal(formatCellForExport(ungradedWithQuiz, "practice"), "Chưa chấm");
  assert.equal(formatCellForExport(ungradedWithQuiz, "quiz"), 85);

  const plainNote = htmlToPlainText('<p>Giỏi lắm<br><img src=x onerror="alert(1)"></p><p>Cố gắng nhé</p>');
  assert.equal(plainNote.includes("<img"), false, "Không được giữ thẻ HTML thô gây XSS");
  assert.equal(plainNote.includes("Giỏi lắm"), true);
  console.log("   [PASS] Findings #6, #9, #11 Export/TSV/HTML sanitization");

  // ---------------------------------------------------------------------------
  // 6. Findings #12, #13, #14: ZaloBroadcastGenerator, CommentGenerator, Path Allowlist
  // ---------------------------------------------------------------------------
  console.log("6. Testing Findings #12, #13, #14: Zalo, CommentGenerator & Path Allowlist...");
  const pythonZalo = ZaloBroadcastGenerator.generate({
    classCode: "VT-C4K-PTA13",
    sessionNumber: 2,
  });
  assert.equal(
    /GML|GameMaker|Room/i.test(pythonZalo.renderedText),
    false,
    "Lớp Python (PTA) không được xuất hiện nội dung GML/GameMaker/Room"
  );
  assert.equal(
    /18h00-20h00 Chủ nhật/i.test(pythonZalo.renderedText),
    false,
    "Không được mặc định cứng lịch Chủ nhật khi chưa biết lịch học"
  );

  // CommentGenerator must skip ABSENT, UNKNOWN, and inactive students
  const commentRes = await CommentGenerator.generateBatchComments(
    {
      classId: "VT-C4K-PTA13",
      classCode: "VT-C4K-PTA13",
      sessionId: "VT-C4K-PTA13_SESS_02",
      sessionNumber: 2,
      topic: "Biến và Kiểu dữ liệu",
    },
    [
      {
        studentId: "STU_ABSENT",
        fullName: "Học sinh Vắng",
        isActive: true,
        attendanceStatus: "ABSENT",
        quickTags: ["Tập trung tốt"],
      },
      {
        studentId: "STU_INACTIVE",
        fullName: "Học sinh Bảo lưu",
        isActive: false,
        attendanceStatus: "PRESENT",
        quickTags: ["Tập trung tốt"],
      },
      {
        studentId: "STU_UNKNOWN",
        fullName: "Học sinh Chưa điểm danh",
        isActive: true,
        attendanceStatus: "UNKNOWN",
        quickTags: ["Tập trung tốt"],
      },
    ]
  );
  assert.equal(
    commentRes.length,
    0,
    "Học viên vắng, bảo lưu hoặc chưa điểm danh không được đưa vào nhận xét hàng loạt"
  );

  // Path allowlist check via json-config
  const tags = getQuickTags();
  assert.equal(Array.isArray(tags) && tags.length > 0, true);
  assert.throws(
    () => assertPathAllowed("C:\\Windows\\System32\\drivers\\etc\\hosts"),
    /Security Exception|Access denied/i
  );
  console.log("   [PASS] Findings #12, #13, #14");

  // ---------------------------------------------------------------------------
  // 7. Round 2 (A01–A14) & Round 3 (R3-01–R3-07) & Finding #10 Regressions
  // ---------------------------------------------------------------------------
  console.log("7. Testing Round 2 (A01–A14), Round 3 (R3-01–R3-07) & Finding #10...");

  // A01 & R3-01: Readback with extra trailing text (same line, newline, or tab) must NOT verify
  for (const extraSuffix of [
    " EXTRA UNAPPROVED CONTENT",
    "\nEXTRA UNAPPROVED LINE",
    "\tEXTRA UNAPPROVED TAB",
  ]) {
    const rA01 = await runSaveScenario({
      apiOk: true,
      readbackText: `FIRST_30_CHARS_SAME_1234567890 EXPECTED TAIL${extraSuffix}`,
    });
    assert.equal(
      rA01.out.verifiedCount,
      0,
      `A01/R3-01: Readback có thêm nội dung lạ (${JSON.stringify(extraSuffix)}) phải từ chối VERIFIED`
    );
  }

  // A02: Student name prefix ("Nguyễn An" vs "Nguyễn An Bình") must NOT match prefix row
  {
    let selectedRowText = "";
    const targetSt = { studentId: "S1", classId: "CLASS_A", fullName: "Nguyễn An", isActive: 1 };
    const rosterSt = [targetSt, { studentId: "S2", classId: "CLASS_A", fullName: "Nguyễn An Bình", isActive: 1 }];
    let recA02: any = {
      classId: "CLASS_A",
      sessionId: "CLASS_A_SESS_01",
      studentId: "S1",
      finalText: "FIRST_30_CHARS_SAME_1234567890 EXPECTED TAIL",
      contentHash: "H",
      status: "APPROVED",
    };
    const locA02 = (): any => ({
      first() {
        return this;
      },
      locator: () => locA02(),
      filter({ hasText }: any) {
        selectedRowText =
          ["Nguyễn An Bình\nNhận xét", "Nguyễn An\nNhận xét"].find((t) => hasText.test(t)) || "";
        return this;
      },
      waitFor: async () => {},
      scrollIntoViewIfNeeded: async () => {},
      isVisible: async () => true,
      getAttribute: async () => "active",
      click: async () => {},
      evaluate: async () => true,
      innerText: async () => recA02.finalText,
    });
    const pageA02: any = {
      locator: locA02,
      waitForTimeout: async () => {},
      keyboard: { press: async () => {} },
      screenshot: async () => {},
    };
    const sbA02: any = {
      console,
      Date,
      Math,
      Map,
      Set,
      JSON,
      RegExp,
      Error,
      Array,
      Object,
      Number,
      String,
      Boolean,
      parseInt,
      BrowserManager: { getInstance: () => ({ getPage: async () => pageA02 }) },
      authService: { ensureAuthenticated: async () => {} },
      LmsHelpers: { openClassDrawer: async () => {}, switchDrawerTab: async () => {} },
      SELECTORS: { tabs: { comments: "" } },
      jobLogRepo: { add() {} },
      verifyContentIntegrity: () => true,
      createNetworkInterceptor: () => ({
        dismissForbiddenToast: async () => {},
        waitForApiResponse: async () => ({ status: () => 200 }),
      }),
      studentRepo: { findOne: () => targetSt, findByClass: () => rosterSt },
      sessionFeedbackRepo: {
        findBySession: () => [{ ...recA02 }],
        findOne: () => ({ ...recA02 }),
        updateStatus: (...a: any[]) => {
          recA02.status = a[3];
        },
      },
    };
    vm.createContext(sbA02);
    vm.runInContext(saveJs + "\n;globalThis.CommentSaver = CommentSaver;", sbA02);
    const outA02 = await sbA02.CommentSaver.saveComments({
      classId: "CLASS_A",
      classCode: "CLASS_A",
      sessionId: "CLASS_A_SESS_01",
    });
    assert.equal(selectedRowText, "Nguyễn An\nNhận xét", "A02: Phải chọn đúng dòng 'Nguyễn An', không khớp tiền tố 'Nguyễn An Bình'");
    assert.equal(outA02.verifiedCount, 1);
  }

  // A03: Unbound 24-hex Mongo classId without verified classCode must fail
  const rA03 = await runScrapeScenario({
    reqClassId: "aaaaaaaaaaaaaaaaaaaaaaaa",
    gqlPayload: {
      lessons: [{ id: "L1", name: "Buổi 1", displayOrder: 1 }],
      students: [
        { studentUid: "S1", displayName: "Nguyễn An" },
        { studentUid: "S2", displayName: "Nguyễn Bình" },
      ],
      submissions: [
        { id: "P1", studentUid: "S1", lessonId: "L1", submissionType: "PRACTICE", status: "MARKED", score: 80 },
      ],
    },
  });
  assert.equal(rA03.res.success, false, "A03: Unbound Mongo classId phải bị từ chối");
  assert.equal(rA03.savedCache.length, 0);

  // A04: Missing submissions array in GraphQL payload must fail without overwriting cache
  const rA04 = await runScrapeScenario({
    reqClassId: "CLASS_A",
    gqlPayload: {
      lessons: [{ id: "L1", name: "Buổi 1", displayOrder: 1 }],
      students: [
        { studentUid: "S1", displayName: "Nguyễn An" },
        { studentUid: "S2", displayName: "Nguyễn Bình" },
      ],
    },
  });
  assert.equal(rA04.res.success, false, "A04: Thiếu mảng submissions phải báo lỗi");
  assert.equal(rA04.savedCache.length, 0);

  // A05 & R3-03: Same student count with wrong roster OR ambiguous duplicate names with unknown IDs must fail
  const rA05 = await runScrapeScenario({
    reqClassId: "CLASS_A",
    gqlPayload: {
      lessons: [{ id: "L1", name: "Buổi 1", displayOrder: 1 }],
      students: [
        { studentUid: "X1", displayName: "Other One" },
        { studentUid: "X2", displayName: "Other Two" },
      ],
      submissions: [],
    },
  });
  assert.equal(rA05.res.success, false, "A05: Danh sách học viên khác lớp phải báo lỗi");
  assert.equal(rA05.savedCache.length, 0);

  const rR303 = await runScrapeScenario({
    reqClassId: "CLASS_A",
    gqlPayload: {
      lessons: [{ id: "L1", name: "Buổi 1", displayOrder: 1 }],
      students: [
        { studentUid: "X1", displayName: "Nguyễn An" },
        { studentUid: "X2", displayName: "Nguyễn An" },
      ],
      submissions: [],
    },
  });
  assert.equal(
    rR303.res.success,
    false,
    "R3-03: Trùng tên trong lớp nhưng studentUid lạ (X1, X2) phải bị từ chối vì ánh xạ mơ hồ"
  );
  assert.equal(rR303.savedCache.length, 0);

  // A06 & R3-04: scoreMatrixRepo.save must reject invalid cell status, GRADED with null/NaN/500, or mismatched columnId
  {
    const memDb = new Database(":memory:");
    const sqliteJs = transpileForVm("src/lib/db/sqlite.ts");
    const sqlSb: any = {
      console,
      Date,
      Math,
      Map,
      Set,
      JSON,
      RegExp,
      Error,
      Array,
      Object,
      Number,
      String,
      Boolean,
      process,
      Database: function () {
        return memDb;
      },
      crypto,
      path,
      fs: { existsSync: () => true },
      assertPathAllowed: (p: string) => p,
    };
    vm.createContext(sqlSb);
    vm.runInContext(
      sqliteJs + "\n;globalThis.sqlExports = { getDb, studentRepo, scoreMatrixRepo };",
      sqlSb
    );
    sqlSb.sqlExports.getDb();

    // A06: Missing cells or success: false
    assert.throws(() =>
      sqlSb.sqlExports.scoreMatrixRepo.save("A", {
        classId: "A",
        success: false,
        columns: [{ columnId: "L1" }],
        rows: [{ studentId: "S1", cells: {} }],
      })
    );

    // R3-04: Invalid status BOGUS, GRADED with null/NaN/500, mismatched columnId
    for (const badCell of [
      { columnId: "L1", status: "BOGUS", score: null },
      { columnId: "L1", status: "GRADED", score: null },
      { columnId: "L1", status: "GRADED", score: NaN },
      { columnId: "L1", status: "GRADED", score: 500, maxScore: 100 },
      { columnId: "WRONG_COL", status: "GRADED", score: 80, maxScore: 100 },
      { columnId: "L1", status: "NOT_SUBMITTED", score: 50 },
    ]) {
      assert.throws(
        () =>
          sqlSb.sqlExports.scoreMatrixRepo.save("A", {
            classId: "A",
            success: true,
            columns: [{ columnId: "L1" }],
            rows: [{ studentId: "S1", cells: { L1: badCell } }],
          }),
        /scoreMatrixRepo/i,
        `R3-04: Phải từ chối ô điểm không hợp lệ: ${JSON.stringify(badCell)}`
      );
    }

    // R3-05: studentRepo.findOne without classId must return undefined (never global lookup)
    sqlSb.sqlExports.studentRepo.upsert({
      studentId: "S1",
      classId: "CLASS_OTHER",
      fullName: "Học sinh lớp khác",
      isActive: 1,
    });
    assert.equal(
      sqlSb.sqlExports.studentRepo.findOne("S1", ""),
      undefined,
      "R3-05: findOne thiếu classId không được trả học viên lớp khác"
    );
    assert.equal(sqlSb.sqlExports.studentRepo.findOne("S1", undefined), undefined);
    memDb.close();
  }

  // A07: save-draft without attendanceStatus must default to UNKNOWN (not PRESENT) and preserve existing finalText
  {
    let savedDraft: any = null;
    const saveDraftJs = transpileForVm("src/app/api/session-comments/save-draft/route.ts");
    const sdSb: any = {
      console,
      Request,
      Response,
      NextResponse: { json: (x: any, opts?: any) => Response.json(x, opts) },
      validateLocalRequest: () => null,
      studentRepo: {
        findOne: (sid: string, cid?: string) =>
          sid === "S1" && cid === "A"
            ? { studentId: "S1", classId: "A", fullName: "Nguyễn An", isActive: 1 }
            : undefined,
      },
      sessionFeedbackRepo: {
        findOne: () => ({
          classId: "A",
          sessionId: "A_SESS_01",
          studentId: "S1",
          attendanceStatus: "UNKNOWN",
          finalText: "EXISTING_DRAFT_TEXT",
        }),
        upsert: (x: any) => {
          savedDraft = x;
        },
      },
    };
    vm.createContext(sdSb);
    vm.runInContext(saveDraftJs + "\n;globalThis.POST = POST;", sdSb);
    const resA07 = await sdSb.POST(
      new Request("http://127.0.0.1:3000/api/session-comments/save-draft", {
        method: "POST",
        body: JSON.stringify({
          classId: "A",
          sessionId: "A_SESS_01",
          studentId: "S1",
          teacherNote: "Note only",
        }),
      })
    );
    assert.equal(resA07.status, 200);
    assert.equal(savedDraft.attendanceStatus, "UNKNOWN", "A07: Không được tự gán PRESENT khi lưu nháp");
    assert.equal(
      savedDraft.finalText,
      "EXISTING_DRAFT_TEXT",
      "R3-06: Lưu nháp chỉ sửa ghi chú phải giữ nguyên finalText đang có"
    );
  }

  // R6-01: save-draft and approve routes must enforce student membership, active status, and PRESENT/LATE attendance on approve (with real in-memory SQLite)
  {
    const memDb = new Database(":memory:");
    const sqliteJs = transpileForVm("src/lib/db/sqlite.ts");
    const localGuardJs = transpileForVm("src/lib/security/local-guard.ts");
    const saveDraftJs = transpileForVm("src/app/api/session-comments/save-draft/route.ts");
    const approveJs = transpileForVm("src/app/api/session-comments/approve/route.ts");

    const r601Sb: any = {
      console,
      Date,
      Math,
      Map,
      Set,
      JSON,
      RegExp,
      Error,
      Array,
      Object,
      Number,
      String,
      Boolean,
      process,
      URL,
      Request,
      Response,
      NextResponse: { json: (x: any, opts?: any) => Response.json(x, opts) },
      Database: function () {
        return memDb;
      },
      crypto,
      path,
      fs: { existsSync: () => true },
      assertPathAllowed: (p: string) => p,
    };
    vm.createContext(r601Sb);
    vm.runInContext(
      sqliteJs +
        "\n" +
        localGuardJs +
        "\n;Object.assign(globalThis, { getDb, studentRepo, sessionFeedbackRepo, calculateSha256, validateLocalRequest });" +
        "\n;globalThis.sqlExports = { getDb, studentRepo, sessionFeedbackRepo };" +
        "\n;(function(){\n" +
        saveDraftJs +
        "\n;globalThis.saveDraftPOST = POST;\n})();" +
        "\n;(function(){\n" +
        approveJs +
        "\n;globalThis.approvePOST = POST;\n})();",
      r601Sb
    );
    r601Sb.sqlExports.getDb();

    const sdRouteSb = r601Sb;
    const appRouteSb = r601Sb;

    // Seed students in in-memory SQLite
    r601Sb.sqlExports.studentRepo.upsert({
      studentId: "S_ACTIVE",
      classId: "CLASS_A",
      fullName: "Học viên đang học",
      isActive: 1,
    });
    r601Sb.sqlExports.studentRepo.upsert({
      studentId: "S_INACTIVE",
      classId: "CLASS_A",
      fullName: "Học viên đã nghỉ",
      isActive: 0,
    });
    r601Sb.sqlExports.studentRepo.upsert({
      studentId: "S_OTHER_CLASS",
      classId: "CLASS_B",
      fullName: "Học viên lớp B",
      isActive: 1,
    });

    const callSaveDraft = (body: any) =>
      sdRouteSb.saveDraftPOST(
        new Request("http://127.0.0.1:3000/api/session-comments/save-draft", {
          method: "POST",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      );
    const callApprove = (body: any) =>
      appRouteSb.approvePOST(
        new Request("http://127.0.0.1:3000/api/session-comments/approve", {
          method: "POST",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      );

    // 1. Valid active student with PRESENT attendance -> save-draft 200, approve 200 (APPROVED)
    const sdValid = await callSaveDraft({
      classId: "CLASS_A",
      sessionId: "CLASS_A_SESS_01",
      studentId: "S_ACTIVE",
      attendanceStatus: "PRESENT",
      finalText: "Nhận xét hợp lệ",
    });
    assert.equal(sdValid.status, 200, "R6-01: Học viên hợp lệ có mặt phải được lưu nháp");
    const appValid = await callApprove({
      classId: "CLASS_A",
      sessionId: "CLASS_A_SESS_01",
      studentId: "S_ACTIVE",
      approvedText: "Nhận xét hợp lệ đã duyệt",
    });
    assert.equal(appValid.status, 200, "R6-01: Học viên hợp lệ có mặt phải được duyệt");
    assert.equal(
      r601Sb.sqlExports.sessionFeedbackRepo.findOne("CLASS_A", "CLASS_A_SESS_01", "S_ACTIVE")?.status,
      "APPROVED"
    );

    // 2. Student belonging to another class -> both save-draft and approve must reject (400) with 0 DB records
    const sdWrongClass = await callSaveDraft({
      classId: "CLASS_A",
      sessionId: "CLASS_A_SESS_01",
      studentId: "S_OTHER_CLASS",
      attendanceStatus: "PRESENT",
      finalText: "Nháp sai lớp",
    });
    assert.equal(sdWrongClass.status, 400, "R6-01: Học viên lớp khác không được lưu nháp");
    const appWrongClass = await callApprove({
      classId: "CLASS_A",
      sessionId: "CLASS_A_SESS_01",
      studentId: "S_OTHER_CLASS",
      approvedText: "Duyệt sai lớp",
    });
    assert.equal(appWrongClass.status, 400, "R6-01: Học viên lớp khác không được duyệt");
    assert.equal(
      r601Sb.sqlExports.sessionFeedbackRepo.findOne("CLASS_A", "CLASS_A_SESS_01", "S_OTHER_CLASS"),
      undefined
    );

    // 3. Inactive student (isActive = 0) -> both save-draft and approve must reject (400) with 0 DB records
    const sdInactive = await callSaveDraft({
      classId: "CLASS_A",
      sessionId: "CLASS_A_SESS_01",
      studentId: "S_INACTIVE",
      attendanceStatus: "PRESENT",
      finalText: "Nháp học viên đã nghỉ",
    });
    assert.equal(sdInactive.status, 400, "R6-01: Học viên đã nghỉ không được lưu nháp");
    const appInactive = await callApprove({
      classId: "CLASS_A",
      sessionId: "CLASS_A_SESS_01",
      studentId: "S_INACTIVE",
      approvedText: "Duyệt học viên đã nghỉ",
    });
    assert.equal(appInactive.status, 400, "R6-01: Học viên đã nghỉ không được duyệt");
    assert.equal(
      r601Sb.sqlExports.sessionFeedbackRepo.findOne("CLASS_A", "CLASS_A_SESS_01", "S_INACTIVE"),
      undefined
    );

    // 4. Non-existent student -> both save-draft and approve must reject (400) with 0 DB records
    const sdGhost = await callSaveDraft({
      classId: "CLASS_A",
      sessionId: "CLASS_A_SESS_01",
      studentId: "S_NON_EXISTENT",
      attendanceStatus: "PRESENT",
      finalText: "Nháp học viên ma",
    });
    assert.equal(sdGhost.status, 400, "R6-01: Mã học viên không tồn tại không được lưu nháp");
    const appGhost = await callApprove({
      classId: "CLASS_A",
      sessionId: "CLASS_A_SESS_01",
      studentId: "S_NON_EXISTENT",
      approvedText: "Duyệt học viên ma",
    });
    assert.equal(appGhost.status, 400, "R6-01: Mã học viên không tồn tại không được duyệt");
    assert.equal(
      r601Sb.sqlExports.sessionFeedbackRepo.findOne("CLASS_A", "CLASS_A_SESS_01", "S_NON_EXISTENT"),
      undefined
    );

    // 5. Active student with UNKNOWN / ABSENT / EXCUSED attendance -> save-draft allowed (200), approve rejected (400)
    for (const att of ["UNKNOWN", "ABSENT", "EXCUSED"]) {
      const sdUnconfirmed = await callSaveDraft({
        classId: "CLASS_A",
        sessionId: "CLASS_A_SESS_02",
        studentId: "S_ACTIVE",
        attendanceStatus: att,
        finalText: `Nháp với điểm danh ${att}`,
      });
      assert.equal(sdUnconfirmed.status, 200, `R6-01: Lưu nháp vẫn cho phép khi điểm danh là ${att}`);
      const appUnconfirmed = await callApprove({
        classId: "CLASS_A",
        sessionId: "CLASS_A_SESS_02",
        studentId: "S_ACTIVE",
        approvedText: `Thử duyệt khi điểm danh là ${att}`,
      });
      assert.equal(
        appUnconfirmed.status,
        400,
        `R6-01: Không được phép duyệt nhận xét khi điểm danh là ${att}`
      );
      assert.equal(
        r601Sb.sqlExports.sessionFeedbackRepo.findOne("CLASS_A", "CLASS_A_SESS_02", "S_ACTIVE")?.status,
        "DRAFT",
        `R6-01: Trạng thái trong SQLite phải giữ nguyên DRAFT khi từ chối duyệt (${att})`
      );
    }

    memDb.close();
  }

  // A08, A13, R3-05, R3-07: CommentGenerator & generate-ai route guardrails
  {
    const cgJs = transpileForVm("src/lib/gemini/comment-generator.ts");
    let aiCallCount = 0;
    let lastPromptSent = "";
    const cgSaved: any[] = [];
    const cgSb: any = {
      console,
      Date,
      Math,
      Map,
      Set,
      JSON,
      RegExp,
      Error,
      Array,
      Object,
      Number,
      String,
      Boolean,
      studentRepo: {
        findOne: (sid: string, cid?: string) =>
          sid === "S1" && cid === "CLASS_A"
            ? { studentId: "S1", classId: "CLASS_A", fullName: "Nguyễn Văn An", isActive: 1 }
            : undefined,
        findByClass: () => [
          { studentId: "S1", classId: "CLASS_A", fullName: "Nguyễn Văn An", isActive: 1 },
          { studentId: "S2", classId: "CLASS_A", fullName: "Trần Thị Bình", isActive: 1 },
        ],
      },
      sessionFeedbackRepo: { upsert: (r: any) => cgSaved.push(r) },
      getGeminiModel: () => ({
        generateContent: async (promptText: string) => {
          aiCallCount++;
          lastPromptSent = promptText;
          return { response: { text: () => '{"feedbacks":[]}' } };
        },
      }),
    };
    vm.createContext(cgSb);
    vm.runInContext(cgJs + "\n;globalThis.CommentGenerator = CommentGenerator;", cgSb);

    // A08: Non-member must be rejected with 0 AI calls and 0 SQLite writes
    const outA08 = await cgSb.CommentGenerator.generateBatchComments(
      { classId: "CLASS_A", classCode: "CLASS_A", sessionId: "CLASS_A_SESS_01", sessionNumber: 1, topic: "T" },
      [{ studentId: "NOT_IN_CLASS", fullName: "Stranger", attendanceStatus: "PRESENT", quickTags: ["Tag"] }]
    );
    assert.equal(outA08.length, 0);
    assert.equal(aiCallCount, 0);
    assert.equal(cgSaved.length, 0);

    // R3-05: Missing classId must throw with 0 AI calls and 0 SQLite writes
    await assert.rejects(
      () =>
        cgSb.CommentGenerator.generateBatchComments(
          { classId: "", classCode: "", sessionId: "CLASS_A_SESS_01", sessionNumber: 1, topic: "T" },
          [{ studentId: "S1", fullName: "Nguyễn Văn An", attendanceStatus: "PRESENT", quickTags: ["Tag"] }]
        ),
      /Thiếu classId/i
    );
    assert.equal(aiCallCount, 0);

    // A13 & R3-07: Empty AI response marks FAILED (0 SQLite writes) AND teacherNote has real names scrubbed
    const outA13 = await cgSb.CommentGenerator.generateBatchComments(
      { classId: "CLASS_A", classCode: "CLASS_A", sessionId: "CLASS_A_SESS_01", sessionNumber: 1, topic: "T" },
      [
        {
          studentId: "S1",
          fullName: "Nguyễn Văn An",
          isActive: true,
          attendanceStatus: "PRESENT",
          quickTags: ["An làm bài tốt"],
          teacherNote: "Nguyễn Văn An và bạn Trần Thị Bình phối hợp tốt, Văn An rất chăm chỉ.",
        },
      ]
    );
    assert.equal(outA13.length, 1);
    assert.equal(outA13[0].status, "FAILED", "A13: AI trả rỗng phải báo FAILED, không tự bịa nhận xét");
    assert.equal(cgSaved.length, 0, "A13: AI lỗi không được ghi đè nháp SQLite");
    assert.equal(
      /Nguyễn Văn An|Văn An|Trần Thị Bình|Thị Bình/i.test(lastPromptSent),
      false,
      "R3-07: Tên thật của học viên trong teacherNote/quickTags phải được ẩn danh trước khi gửi AI"
    );
    assert.equal(lastPromptSent.includes("STUDENT_01"), true);
  }

  // A09 & R3-02: NetworkInterceptor & CommentSaver requestPredicate strict binding
  {
    const niJs = transpileForVm("src/lib/playwright/network-interceptor.ts");
    const niSb: any = {
      console,
      Date,
      RegExp,
      Error,
      JSON,
      SELECTORS: {},
    };
    vm.createContext(niSb);
    vm.runInContext(niJs + "\n;globalThis.NetworkInterceptor = NetworkInterceptor;", niSb);

    const wrongOpResp = {
      url: () => "https://lms-api.mindx.edu.vn/graphql",
      status: () => 200,
      request: () => ({
        method: () => "POST",
        postData: () =>
          JSON.stringify({
            operationName: "UnrelatedQuery",
            variables: { text: "SaveSlotComment" },
          }),
      }),
      json: async () => ({ data: { ok: true } }),
    };
    let matchedA09 = false;
    const interceptorA09 = new niSb.NetworkInterceptor({
      waitForResponse: async (pred: any) => {
        matchedA09 = pred(wrongOpResp);
        if (!matchedA09) throw new Error("Rejected by predicate");
        return wrongOpResp;
      },
    });
    await assert.rejects(() =>
      interceptorA09.waitForApiResponse(/lms-api\.mindx\.edu\.vn/i, {
        method: "POST",
        operationName: /^(UpdateSlotComment|CreateSlotComment|SaveSlotComment)$/i,
      })
    );
    assert.equal(matchedA09, false, "A09: Không được khớp operationName nằm trong variables");

    // R3-02: Capture requestPredicate passed by CommentSaver and verify empty/wrong-session payloads are rejected
    let capturedPredicate: ((body: string) => boolean) | null = null;
    const locR302 = (): any => ({
      first() {
        return this;
      },
      locator: () => locR302(),
      filter() {
        return this;
      },
      waitFor: async () => {},
      scrollIntoViewIfNeeded: async () => {},
      isVisible: async () => true,
      getAttribute: async () => "active",
      click: async () => {},
      evaluate: async () => true,
      innerText: async () => "FIRST_30_CHARS_SAME_1234567890 EXPECTED TAIL",
    });
    const sbR302: any = {
      console,
      Date,
      Math,
      Map,
      Set,
      JSON,
      RegExp,
      Error,
      Array,
      Object,
      Number,
      String,
      Boolean,
      parseInt,
      BrowserManager: {
        getInstance: () => ({
          getPage: async () => ({
            locator: locR302,
            waitForTimeout: async () => {},
            keyboard: { press: async () => {} },
            screenshot: async () => {},
          }),
        }),
      },
      authService: { ensureAuthenticated: async () => {} },
      LmsHelpers: { openClassDrawer: async () => {}, switchDrawerTab: async () => {} },
      SELECTORS: { tabs: { comments: "" } },
      jobLogRepo: { add() {} },
      verifyContentIntegrity: () => true,
      createNetworkInterceptor: () => ({
        dismissForbiddenToast: async () => {},
        waitForApiResponse: async (_url: any, opts: any) => {
          capturedPredicate = opts.requestPredicate;
          return { status: () => 200 };
        },
      }),
      studentRepo: {
        findOne: () => ({ studentId: "S1", classId: "CLASS_A", fullName: "Nguyễn An", isActive: 1 }),
        findByClass: () => [{ studentId: "S1", classId: "CLASS_A", fullName: "Nguyễn An", isActive: 1 }],
      },
      sessionFeedbackRepo: {
        findBySession: () => [
          {
            classId: "CLASS_A",
            sessionId: "CLASS_A_SESS_01",
            studentId: "S1",
            finalText: "FIRST_30_CHARS_SAME_1234567890 EXPECTED TAIL",
            contentHash: "H",
            status: "APPROVED",
          },
        ],
        findOne: () => ({
          classId: "CLASS_A",
          sessionId: "CLASS_A_SESS_01",
          studentId: "S1",
          finalText: "FIRST_30_CHARS_SAME_1234567890 EXPECTED TAIL",
          contentHash: "H",
          status: "APPROVED",
        }),
        updateStatus: () => {},
      },
    };
    vm.createContext(sbR302);
    vm.runInContext(saveJs + "\n;globalThis.CommentSaver = CommentSaver;", sbR302);
    await sbR302.CommentSaver.saveComments({
      classId: "CLASS_A",
      classCode: "CLASS_A",
      sessionId: "CLASS_A_SESS_01",
    });
    assert.equal(typeof capturedPredicate, "function");
    assert.equal(
      capturedPredicate!(JSON.stringify({ operationName: "SaveSlotComment", variables: {} })),
      false,
      "R3-02: Payload variables rỗng phải bị từ chối"
    );
    assert.equal(
      capturedPredicate!(
        JSON.stringify({
          operationName: "SaveSlotComment",
          variables: { sessionId: "CLASS_A_SESS_99", studentId: "S1" },
        })
      ),
      false,
      "R3-02: Payload sai buổi học (_SESS_99) phải bị từ chối"
    );
    assert.equal(
      capturedPredicate!(
        JSON.stringify({
          operationName: "SaveSlotComment",
          variables: { classCode: "CLASS_A", sessionId: "CLASS_A_SESS_01", studentId: "S1" },
        })
      ),
      true,
      "R3-02: Payload khớp đúng lớp, buổi và học viên phải được chấp nhận"
    );
  }

  // A10, Finding #10 & R3-06: Live execution of UI hooks (HomeworkGraderPage & SessionCommentsPage)
  {
    function createComponentHarness(file: string, name: string, exposed: string, fetchImpl: any) {
      let source = fs.readFileSync(file, "utf8");
      const marker = '\n  return (\n    <div className="space-y-6">';
      source =
        source.slice(0, source.indexOf(marker)) + `\n globalThis.api = {${exposed}}; return null; }`;
      const badgeStart = source.indexOf("  const renderCellBadge = ");
      if (badgeStart >= 0) {
        source = source.slice(0, badgeStart) + source.slice(source.indexOf("\n globalThis.api ="));
      }
      const stripped = stripTypeScriptTypes(
        source
          .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
          .replace(/\bexport\s+default\s+/g, "")
          .replace(/\bexport\s+/g, "")
      );
      const slots: any[] = [];
      const effectSlots: any[] = [];
      let cursor = 0;
      let dirty = true;
      let pending: any[] = [];
      const depsChanged = (a: any, b: any) =>
        !a || !b || a.length !== b.length || a.some((x: any, i: number) => !Object.is(x, b[i]));
      const context: any = {
        console,
        fetch: fetchImpl,
        setTimeout,
        clearTimeout,
        Date,
        Math,
        Map,
        Set,
        JSON,
        RegExp,
        Error,
        Array,
        Object,
        Number,
        String,
        Boolean,
        encodeURIComponent,
        useState(initial: any) {
          const i = cursor++;
          if (!(i in slots)) slots[i] = initial;
          return [
            slots[i],
            (value: any) => {
              const n = typeof value === "function" ? value(slots[i]) : value;
              if (!Object.is(slots[i], n)) {
                slots[i] = n;
                dirty = true;
              }
            },
          ];
        },
        useRef(initial: any) {
          const i = cursor++;
          if (!(i in slots)) slots[i] = { current: initial };
          return slots[i];
        },
        useEffect(fn: any, deps: any) {
          const i = cursor++;
          if (depsChanged(effectSlots[i], deps)) {
            effectSlots[i] = deps;
            pending.push(fn);
          }
        },
      };
      vm.createContext(context);
      vm.runInContext(stripped + `\nglobalThis.render = ${name};`, context);
      const flush = async () => {
        for (let tick = 0; tick < 12; tick++) {
          await new Promise((r) => setImmediate(r));
          if (dirty) {
            dirty = false;
            cursor = 0;
            context.render();
            const list = pending;
            pending = [];
            list.forEach((fn) => fn());
          }
        }
      };
      return { context, flush };
    }

    const deferred = () => {
      let resolve!: (val: any) => void;
      const promise = new Promise((r) => {
        resolve = r;
      });
      return { promise, resolve };
    };

    // Execute A10 / Finding #10 on HomeworkGraderPage
    const postDef = deferred();
    const cacheBDef = deferred();
    const hwH = createComponentHarness(
      "src/app/homework-grader/page.tsx",
      "HomeworkGraderPage",
      "classId,classCode,matrix,isScraping,isLoadingCache,setClassCode,handleScrapeScores,isMatrixMatchedWithSelection",
      (url: string, opts?: any) =>
        opts?.method === "POST"
          ? postDef.promise
          : String(url).includes("CLASS_B")
            ? cacheBDef.promise
            : Promise.resolve({ json: async () => ({ success: true, data: { matrix: null } }) })
    );
    await hwH.flush();
    hwH.context.api.setClassCode("CLASS_B");
    await hwH.flush();
    const scrapePromise = hwH.context.api.handleScrapeScores();
    await hwH.flush();
    cacheBDef.resolve({ json: async () => ({ success: true, data: { matrix: null } }) });
    await hwH.flush();
    postDef.resolve({
      json: async () => ({
        success: true,
        classId: "CLASS_B",
        rows: [{ studentId: "B" }],
        columns: [],
        summary: { totalStudents: 1 },
      }),
    });
    await scrapePromise;
    await hwH.flush();
    assert.equal(hwH.context.api.classId, "CLASS_B");
    assert.equal(hwH.context.api.isScraping, false, "A10: isScraping phải được tắt sau khi cào xong");
    assert.equal(hwH.context.api.matrix?.classId, "CLASS_B", "A10: matrix phải nhận dữ liệu vừa cào");
    assert.equal(hwH.context.api.isMatrixMatchedWithSelection, true);

    // Execute R3-06 on SessionCommentsPage: FAILED AI result must NOT wipe existing draft
    const savedDraftPayloads: any[] = [];
    const scH = createComponentHarness(
      "src/app/session-comments/page.tsx",
      "SessionCommentsPage",
      "students,setStudents,setSessions,setSelectedSessionId,handleGenerateAi,saveDraftToServer",
      async (url: string, opts?: any) => {
        if (String(url).includes("/api/session-comments/generate-ai")) {
          return {
            json: async () => ({
              success: true,
              data: [
                {
                  studentId: "S1",
                  fullName: "Nguyễn An",
                  status: "FAILED",
                  strengths: "",
                  improvements: "",
                  actionPlan: "",
                  formattedFullComment: "",
                  errorMessage: "AI timeout",
                },
              ],
            }),
          };
        }
        if (String(url).includes("/api/session-comments/save-draft")) {
          savedDraftPayloads.push(JSON.parse(opts.body));
          return { json: async () => ({ success: true }) };
        }
        return { json: async () => ({ success: true, data: {} }) };
      }
    );
    await scH.flush();
    scH.context.api.setSessions([{ sessionId: "VT-C4K-GA38_SESS_01", sessionNumber: 1, topic: "T" }]);
    scH.context.api.setSelectedSessionId("VT-C4K-GA38_SESS_01");
    scH.context.api.setStudents([
      {
        studentId: "S1",
        fullName: "Nguyễn An",
        isActive: true,
        attendanceStatus: "PRESENT",
        quickTags: ["Tập trung tốt"],
        teacherNote: "Ghi chú cũ",
        strengths: "Điểm mạnh cũ",
        improvements: "Cải thiện cũ",
        actionPlan: "Kế hoạch cũ",
        finalText: "BẢN NHÁP HIỆN CÓ TRƯỚC KHI AI LỖI",
        status: "DRAFT",
      },
    ]);
    await scH.flush();
    await scH.context.api.handleGenerateAi();
    await scH.flush();
    assert.equal(
      scH.context.api.students[0].finalText,
      "BẢN NHÁP HIỆN CÓ TRƯỚC KHI AI LỖI",
      "R3-06: Khi AI trả về FAILED, giao diện phải giữ nguyên bản nháp hiện có"
    );
    await scH.context.api.saveDraftToServer("S1", {
      teacherNote: "Ghi chú mới sau khi AI lỗi",
    });
    assert.equal(
      savedDraftPayloads.at(-1)?.finalText,
      "BẢN NHÁP HIỆN CÓ TRƯỚC KHI AI LỖI",
      "R3-06: Sửa ghi chú sau khi AI lỗi không được gửi finalText rỗng về save-draft"
    );

    // R4-01: Out-of-order list response in SessionCommentsPage must NOT show Class A students on Class B screen
    const listADef = deferred();
    const listBDef = deferred();
    const r401DraftPayloads: any[] = [];
    const scR401 = createComponentHarness(
      "src/app/session-comments/page.tsx",
      "SessionCommentsPage",
      "classId,students,setClassId,setSelectedSessionId,handleNoteChange",
      (url: string, opts?: any) => {
        if (String(url).includes("/api/session-comments/save-draft")) {
          r401DraftPayloads.push(JSON.parse(opts.body));
          return Promise.resolve({ json: async () => ({ success: true }) });
        }
        if (String(url).includes("classId=CLASS_B")) {
          return listBDef.promise;
        }
        return listADef.promise;
      }
    );
    await scR401.flush();
    scR401.context.api.setClassId("CLASS_B");
    scR401.context.api.setSelectedSessionId("CLASS_B_SESS_01");
    await scR401.flush();
    // Class B resolves first
    listBDef.resolve({
      json: async () => ({
        success: true,
        data: {
          sessions: [{ sessionId: "CLASS_B_SESS_01", sessionNumber: 1, topic: "B" }],
          students: [{ studentId: "B1", classId: "CLASS_B", fullName: "Student B", isActive: 1 }],
          feedbacks: [],
        },
      }),
    });
    await scR401.flush();
    // Stale Class A resolves later
    listADef.resolve({
      json: async () => ({
        success: true,
        data: {
          sessions: [{ sessionId: "VT-C4K-GA38_SESS_01", sessionNumber: 1, topic: "A" }],
          students: [{ studentId: "A1", classId: "VT-C4K-GA38", fullName: "Student A", isActive: 1 }],
          feedbacks: [],
        },
      }),
    });
    await scR401.flush();
    assert.equal(scR401.context.api.students.length, 1);
    assert.equal(
      scR401.context.api.students[0].studentId,
      "B1",
      "R4-01: Phản hồi cũ của lớp A không được ghi đè danh sách học viên lớp B"
    );
    scR401.context.api.handleNoteChange("A1", "Ghi chú nhầm lớp");
    await scR401.flush();
    assert.equal(
      r401DraftPayloads.length,
      0,
      "R4-01: Không được phép gửi save-draft cho học viên A1 dưới mã CLASS_B"
    );

    // R4-03: Failed scrape while initial cache load is in flight must clear BOTH isScraping and isLoadingCache
    const slowCacheDef = deferred();
    const failPostDef = deferred();
    const hwR403 = createComponentHarness(
      "src/app/homework-grader/page.tsx",
      "HomeworkGraderPage",
      "isScraping,isLoadingCache,handleScrapeScores",
      (_url: string, opts?: any) => (opts?.method === "POST" ? failPostDef.promise : slowCacheDef.promise)
    );
    await hwR403.flush();
    const failScrapeP = hwR403.context.api.handleScrapeScores();
    await hwR403.flush();
    failPostDef.resolve({
      json: async () => {
        throw new Error("Network connection failed");
      },
    });
    slowCacheDef.resolve({ json: async () => ({ success: true, data: { matrix: null } }) });
    await failScrapeP;
    await hwR403.flush();
    assert.equal(hwR403.context.api.isScraping, false, "R4-03: isScraping phải về false khi cào lỗi");
    assert.equal(
      hwR403.context.api.isLoadingCache,
      false,
      "R4-03: isLoadingCache phải về false khi yêu cầu tải cũ bị hủy bởi lệnh cào"
    );
  }

  // A11: ClassSyncer.scrapeStudents deterministic order-independent IDs
  {
    let domNames = ["An", "Bình"];
    const emptyLocA11: any = {
      first() {
        return this;
      },
      count: async () => 0,
      isVisible: async () => false,
    };
    const ctxA11: any = {
      first() {
        return this;
      },
      isVisible: async () => true,
      locator(sel: string) {
        if (sel === "table tbody tr") {
          return {
            count: async () => domNames.length,
            nth: (i: number) => ({
              innerText: async () => domNames[i],
              getAttribute: async () => null,
              locator: () => emptyLocA11,
            }),
          };
        }
        return emptyLocA11;
      },
    };
    const pageA11: any = { locator: () => ctxA11, waitForTimeout: async () => {} };
    const firstRun = await syncSandbox.ClassSyncer.scrapeStudents(pageA11, "CLASS_A");
    domNames = ["Bình", "An"];
    const secondRun = await syncSandbox.ClassSyncer.scrapeStudents(pageA11, "CLASS_A");
    const anFirst = firstRun.find((s: any) => s.fullName === "An");
    const anSecond = secondRun.find((s: any) => s.fullName === "An");
    assert.equal(
      anFirst.studentId,
      anSecond.studentId,
      "A11: Đổi thứ tự dòng trên DOM vẫn phải giữ nguyên studentId cho cùng học viên"
    );
  }

  // A12: Quiz-only cell in parseScoreCell + DOM pagination duplicate detection
  const quizOnlyCell = ScoreScraper.parseScoreCell("Quiz: 90/100", "HW_01_C1", 1);
  assert.equal(quizOnlyCell.status, "NOT_SUBMITTED");
  assert.equal(quizOnlyCell.score, null);
  assert.equal(quizOnlyCell.quizScore, 90);

  // A14: MARKED Quiz with score: null must fail
  const rA14 = await runScrapeScenario({
    reqClassId: "CLASS_A",
    gqlPayload: {
      lessons: [{ id: "L1", name: "Buổi 1", displayOrder: 1 }],
      students: [
        { studentUid: "S1", displayName: "Nguyễn An" },
        { studentUid: "S2", displayName: "Nguyễn Bình" },
      ],
      submissions: [
        { id: "Q1", studentUid: "S1", lessonId: "L1", submissionType: "QUIZ", status: "MARKED", score: null },
      ],
    },
  });
  assert.equal(rA14.res.success, false, "A14: Quiz MARKED với score: null phải báo lỗi");
  assert.equal(rA14.savedCache.length, 0);

  // R4-02: Conflicting or comment-only identifiers in save-comments requestPredicate must be rejected
  {
    for (const badVars of [
      { classCode: "CLASS_A", classId: "OTHER", studentId: "S1" },
      { sessionId: "CLASS_A_SESS_01", slotId: "CLASS_A_SESS_99", studentId: "S1" },
      { slotNumber: 1, sessionNumber: 99, studentId: "S1" },
      { studentId: "S1", studentUid: "X1", classCode: "CLASS_A" },
      {
        studentId: "S1",
        comment: "FIRST_30_CHARS_SAME_1234567890 EXPECTED TAIL",
        content: "MISMATCHED CONTENT",
      },
      { comment: "FIRST_30_CHARS_SAME_1234567890 EXPECTED TAIL" },
    ]) {
      let predMatched = true;
      const locR402 = (): any => ({
        first() {
          return this;
        },
        locator: () => locR402(),
        filter() {
          return this;
        },
        waitFor: async () => {},
        scrollIntoViewIfNeeded: async () => {},
        isVisible: async () => true,
        getAttribute: async () => "active",
        click: async () => {},
        evaluate: async () => true,
        innerText: async () => "FIRST_30_CHARS_SAME_1234567890 EXPECTED TAIL",
      });
      const sbR402: any = {
        console,
        Date,
        Math,
        Map,
        Set,
        JSON,
        RegExp,
        Error,
        Array,
        Object,
        Number,
        String,
        Boolean,
        parseInt,
        BrowserManager: {
          getInstance: () => ({
            getPage: async () => ({
              locator: locR402,
              waitForTimeout: async () => {},
              keyboard: { press: async () => {} },
              screenshot: async () => {},
            }),
          }),
        },
        authService: { ensureAuthenticated: async () => {} },
        LmsHelpers: { openClassDrawer: async () => {}, switchDrawerTab: async () => {} },
        SELECTORS: { tabs: { comments: "" } },
        jobLogRepo: { add() {} },
        verifyContentIntegrity: () => true,
        createNetworkInterceptor: () => ({
          dismissForbiddenToast: async () => {},
          waitForApiResponse: async (_url: any, opts: any) => {
            predMatched = opts.requestPredicate(
              JSON.stringify({ operationName: "SaveSlotComment", variables: badVars })
            );
            if (!predMatched) throw new Error("Rejected by requestPredicate");
            return { status: () => 200 };
          },
        }),
        studentRepo: {
          findOne: () => ({ studentId: "S1", classId: "CLASS_A", fullName: "Nguyễn An", isActive: 1 }),
          findByClass: () => [{ studentId: "S1", classId: "CLASS_A", fullName: "Nguyễn An", isActive: 1 }],
        },
        sessionFeedbackRepo: {
          findBySession: () => [
            {
              classId: "CLASS_A",
              sessionId: "CLASS_A_SESS_01",
              studentId: "S1",
              finalText: "FIRST_30_CHARS_SAME_1234567890 EXPECTED TAIL",
              contentHash: "H",
              status: "APPROVED",
            },
          ],
          findOne: () => ({
            classId: "CLASS_A",
            sessionId: "CLASS_A_SESS_01",
            studentId: "S1",
            finalText: "FIRST_30_CHARS_SAME_1234567890 EXPECTED TAIL",
            contentHash: "H",
            status: "APPROVED",
          }),
          updateStatus: () => {},
        },
      };
      vm.createContext(sbR402);
      vm.runInContext(saveJs + "\n;globalThis.CommentSaver = CommentSaver;", sbR402);
      const outR402 = await sbR402.CommentSaver.saveComments({
        classId: "CLASS_A",
        classCode: "CLASS_A",
        sessionId: "CLASS_A_SESS_01",
      });
      assert.equal(predMatched, false, `R4-02: Phải từ chối variables mâu thuẫn: ${JSON.stringify(badVars)}`);
      assert.equal(outR402.verifiedCount, 0);
    }
  }

  // R4-04: scoreMatrixRepo.save must reject cells missing columnId, maxScore, or score
  {
    const memDb = new Database(":memory:");
    const sqliteJs = transpileForVm("src/lib/db/sqlite.ts");
    const sqlSb: any = {
      console,
      Date,
      Math,
      Map,
      Set,
      JSON,
      RegExp,
      Error,
      Array,
      Object,
      Number,
      String,
      Boolean,
      process,
      Database: function () {
        return memDb;
      },
      crypto,
      path,
      fs: { existsSync: () => true },
      assertPathAllowed: (p: string) => p,
    };
    vm.createContext(sqlSb);
    vm.runInContext(sqliteJs + "\n;globalThis.scoreMatrixRepo = scoreMatrixRepo; getDb();", sqlSb);

    for (const incompleteCell of [
      { status: "NOT_SUBMITTED", score: null, maxScore: 100 }, // missing columnId
      { columnId: "L1", status: "NOT_SUBMITTED", score: null }, // missing maxScore
      { columnId: "L1", status: "NOT_SUBMITTED", maxScore: 100 }, // missing score
    ]) {
      assert.throws(
        () =>
          sqlSb.scoreMatrixRepo.save("A", {
            classId: "A",
            success: true,
            columns: [{ columnId: "L1" }],
            rows: [{ studentId: "S1", cells: { L1: incompleteCell } }],
          }),
        /scoreMatrixRepo/i,
        `R4-04: Phải từ chối ô điểm thiếu trường bắt buộc: ${JSON.stringify(incompleteCell)}`
      );
    }
    memDb.close();
  }

  // R4-05: Direct CommentGenerator.generateBatchComments with mismatched sessionId prefix must throw with 0 AI calls & 0 writes
  {
    const cgJs = transpileForVm("src/lib/gemini/comment-generator.ts");
    let aiCalls = 0;
    let writes = 0;
    const cgSb: any = {
      console,
      Date,
      Math,
      Map,
      Set,
      JSON,
      RegExp,
      Error,
      Array,
      Object,
      Number,
      String,
      Boolean,
      studentRepo: {
        findOne: () => ({ studentId: "S1", classId: "CLASS_A", fullName: "An", isActive: 1 }),
        findByClass: () => [],
      },
      sessionFeedbackRepo: { upsert: () => writes++ },
      getGeminiModel: () => ({
        generateContent: async () => {
          aiCalls++;
          return { response: { text: () => '{"feedbacks":[]}' } };
        },
      }),
    };
    vm.createContext(cgSb);
    vm.runInContext(cgJs + "\n;globalThis.CommentGenerator = CommentGenerator;", cgSb);
    await assert.rejects(
      () =>
        cgSb.CommentGenerator.generateBatchComments(
          { classId: "CLASS_A", classCode: "CLASS_A", sessionId: "OTHER_SESS_01", sessionNumber: 1, topic: "T" },
          [{ studentId: "S1", fullName: "An", attendanceStatus: "PRESENT", quickTags: ["Tag"] }]
        ),
      /không thuộc đúng lớp/i
    );
    assert.equal(aiCalls, 0, "R4-05: Buổi khác lớp phải chặn với 0 lần gọi AI");
    assert.equal(writes, 0, "R4-05: Buổi khác lớp phải chặn với 0 lần ghi SQLite");
  }

  // R4-06: scrapeFromDomGrid exceeding 50 pages with next page still enabled must throw
  {
    let curPage = 1;
    const emptyLoc: any = {
      first() {
        return this;
      },
      count: async () => 0,
      isVisible: async () => false,
    };
    const textLoc = (txt: string) => ({ innerText: async () => txt });
    const ctx51: any = {
      evaluate: async () => {},
      locator(sel: string) {
        if (sel === 'div:has(> div:has-text("Homework")) > div') {
          return { count: async () => 2, nth: () => textLoc("Homework 1") };
        }
        if (sel === 'div:has(> div > svg[data-testid="ExpandMoreIcon"])') {
          return {
            count: async () => 1,
            nth: () => ({
              locator: () => ({
                locator: () => ({
                  locator: () => ({
                    count: async () => 2,
                    nth: (c: number) => textLoc(c === 0 ? `Student_${curPage}` : "80/100"),
                  }),
                }),
              }),
            }),
          };
        }
        if (sel.includes("next page")) {
          return {
            first() {
              return this;
            },
            count: async () => 1,
            isVisible: async () => true,
            isEnabled: async () => curPage <= 51,
            getAttribute: async () => "false",
            click: async () => {
              curPage++;
            },
          };
        }
        return emptyLoc;
      },
    };
    await assert.rejects(
      () =>
        (ScoreScraper as any).scrapeFromDomGrid(
          ctx51,
          "CLASS_A",
          new Map(),
          new Map(),
          (s: string) => s.toLowerCase(),
          0
        ),
      /vượt quá giới hạn an toàn/i,
      "R4-06: Vượt quá 50 trang mà vẫn còn trang tiếp theo phải báo lỗi"
    );
  }

  /*
   * Explicit Round 2 Mapping Table (R2-01..R2-11 <-> A01..A14):
   * - R2-01 (P1): Read-after-Write exact equality (no extra content allowed) -> Tested in A01 & R3-01
   * - R2-02 (P1): NetworkInterceptor & requestPredicate strict operation/ID binding -> Tested in A09, R3-02, R4-02, R5-03
   * - R2-03 (P1): Short name must not match longer student name row -> Tested in A02
   * - R2-04 (P1): Student ID stability across sync runs when DOM order changes -> Tested in A11
   * - R2-05 (P1): Unbound 24-hex Mongo classId & wrong class roster rejected -> Tested in A03, A05, R3-03
   * - R2-06 (P1): Missing submissions array & invalid scoreMatrixRepo cells rejected -> Tested in A04, A06, R3-04, R4-04
   * - R2-07 (P1): DOM score pagination duplicate/stale page & 50-page limit -> Tested in A12 & R4-06
   * - R2-08 (P2): Changing class & scraping must not leave isScraping/isLoadingCache stuck -> Tested in A10, R4-03, R5-04
   * - R2-09 (P2): Backend save-draft/approve/generate-ai attendance & class membership -> Tested in A07, A08, R3-05, R4-05
   * - R2-10 (P2): DOM Quiz vs Practice separation & MARKED Quiz with null score rejected -> Tested in A12 & A14
   * - R2-11 (P2): Incomplete/empty AI output marks FAILED without inventing comments -> Tested in A13 & R3-06
   */

  // R5-01, R5-02, R5-04: UI hooks regression tests for Round 5 findings
  {
    function createRound5Harness(file: string, name: string, exposed: string, fetchImpl: any) {
      let source = fs.readFileSync(file, "utf8");
      const marker = '\n  return (\n    <div className="space-y-6">';
      source =
        source.slice(0, source.indexOf(marker)) + `\n globalThis.api = {${exposed}}; return null; }`;
      const badgeStart = source.indexOf("  const renderCellBadge = ");
      if (badgeStart >= 0) {
        source = source.slice(0, badgeStart) + source.slice(source.indexOf("\n globalThis.api ="));
      }
      const stripped = stripTypeScriptTypes(
        source
          .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
          .replace(/\bexport\s+default\s+/g, "")
          .replace(/\bexport\s+/g, "")
      );
      const slots: any[] = [];
      const effectSlots: any[] = [];
      let cursor = 0;
      let dirty = true;
      let pending: any[] = [];
      const depsChanged = (a: any, b: any) =>
        !a || !b || a.length !== b.length || a.some((x: any, i: number) => !Object.is(x, b[i]));
      const context: any = {
        console,
        fetch: fetchImpl,
        setTimeout,
        clearTimeout,
        Date,
        Math,
        Map,
        Set,
        JSON,
        RegExp,
        Error,
        Array,
        Object,
        Number,
        String,
        Boolean,
        encodeURIComponent,
        useState(initial: any) {
          const i = cursor++;
          if (!(i in slots)) slots[i] = initial;
          return [
            slots[i],
            (value: any) => {
              const n = typeof value === "function" ? value(slots[i]) : value;
              if (!Object.is(slots[i], n)) {
                slots[i] = n;
                dirty = true;
              }
            },
          ];
        },
        useRef(initial: any) {
          const i = cursor++;
          if (!(i in slots)) slots[i] = { current: initial };
          return slots[i];
        },
        useEffect(fn: any, deps: any) {
          const i = cursor++;
          if (depsChanged(effectSlots[i], deps)) {
            effectSlots[i] = deps;
            pending.push(fn);
          }
        },
      };
      vm.createContext(context);
      vm.runInContext(stripped + `\nglobalThis.render = ${name};`, context);
      const flush = async () => {
        for (let tick = 0; tick < 12; tick++) {
          await new Promise((r) => setImmediate(r));
          if (dirty) {
            dirty = false;
            cursor = 0;
            context.render();
            const list = pending;
            pending = [];
            list.forEach((fn) => fn());
          }
        }
      };
      return { context, flush };
    }

    const deferred = () => {
      let resolve!: (val: any) => void;
      const promise = new Promise((r) => {
        resolve = r;
      });
      return { promise, resolve };
    };

    // R5-01: Switching sessions within the same class must immediately clear old session rows and block saving/approving Session 1's comment under Session 2
    const sess2LoadDef = deferred();
    const r501Calls: { url: string; body: any }[] = [];
    const scR501 = createRound5Harness(
      "src/app/session-comments/page.tsx",
      "SessionCommentsPage",
      "students,selectedSessionId,setSelectedSessionId,handleNoteChange,handleApprove",
      (url: string, opts?: any) => {
        if (String(url).includes("/api/session-comments/save-draft") || String(url).includes("/api/session-comments/approve")) {
          r501Calls.push({ url: String(url), body: JSON.parse(opts.body) });
          return Promise.resolve({
            json: async () => ({ success: true, data: { contentHash: "HASH_S1", status: "APPROVED" } }),
          });
        }
        if (String(url).includes("sessionId=VT-C4K-GA38_SESS_02")) {
          return sess2LoadDef.promise;
        }
        return Promise.resolve({
          json: async () => ({
            success: true,
            data: {
              sessions: [
                { sessionId: "VT-C4K-GA38_SESS_01", sessionNumber: 1, topic: "Buổi 1" },
                { sessionId: "VT-C4K-GA38_SESS_02", sessionNumber: 2, topic: "Buổi 2" },
              ],
              students: [{ studentId: "S1", classId: "VT-C4K-GA38", fullName: "Nguyễn An", isActive: 1 }],
              feedbacks: [
                {
                  studentId: "S1",
                  sessionId: "VT-C4K-GA38_SESS_01",
                  attendanceStatus: "PRESENT",
                  finalText: "COMMENT FOR SESSION 1",
                  status: "DRAFT",
                },
              ],
            },
          }),
        });
      }
    );
    await scR501.flush();
    assert.equal(scR501.context.api.students.length, 1);
    assert.equal(scR501.context.api.students[0].finalText, "COMMENT FOR SESSION 1");
    // Switch to Session 2 while Session 2 list request stays pending
    scR501.context.api.setSelectedSessionId("VT-C4K-GA38_SESS_02");
    await scR501.flush();
    assert.equal(
      scR501.context.api.students.length,
      0,
      "R5-01: Đổi buổi học phải xóa ngay danh sách nhận xét của buổi cũ trong lúc chờ tải buổi mới"
    );
    scR501.context.api.handleNoteChange("S1", "Note while loading session 2");
    await scR501.context.api.handleApprove("S1");
    await scR501.flush();
    assert.equal(
      r501Calls.length,
      0,
      "R5-01: Không được phép gửi save-draft hoặc approve nhận xét buổi 1 cho buổi 2 khi buổi 2 chưa tải xong"
    );

    // R5-02: Slow approve response for OLD text must NOT mark concurrently edited NEW text as APPROVED
    const approveDef = deferred();
    const scR502 = createRound5Harness(
      "src/app/session-comments/page.tsx",
      "SessionCommentsPage",
      "students,handleTextEdit,handleApprove",
      (url: string) => {
        if (String(url).includes("/api/session-comments/approve")) {
          return approveDef.promise;
        }
        if (String(url).includes("/api/session-comments/save-draft")) {
          return Promise.resolve({ json: async () => ({ success: true }) });
        }
        return Promise.resolve({
          json: async () => ({
            success: true,
            data: {
              sessions: [{ sessionId: "VT-C4K-GA38_SESS_01", sessionNumber: 1, topic: "Buổi 1" }],
              students: [{ studentId: "S1", classId: "VT-C4K-GA38", fullName: "Nguyễn An", isActive: 1 }],
              feedbacks: [
                {
                  studentId: "S1",
                  sessionId: "VT-C4K-GA38_SESS_01",
                  attendanceStatus: "PRESENT",
                  finalText: "OLD APPROVED TEXT",
                  status: "DRAFT",
                },
              ],
            },
          }),
        });
      }
    );
    await scR502.flush();
    const approvePromise = scR502.context.api.handleApprove("S1");
    await scR502.flush();
    // Teacher edits the text while approve is in flight
    scR502.context.api.handleTextEdit("S1", "finalText", "NEW EDITED TEXT");
    await scR502.flush();
    // Slow approve response for OLD text arrives
    approveDef.resolve({
      json: async () => ({
        success: true,
        data: { contentHash: "HASH_OF_OLD", status: "APPROVED" },
      }),
    });
    await approvePromise;
    await scR502.flush();
    assert.equal(scR502.context.api.students[0].finalText, "NEW EDITED TEXT");
    assert.equal(
      scR502.context.api.students[0].status,
      "DRAFT",
      "R5-02: Phản hồi duyệt chậm của nội dung cũ không được đổi nội dung vừa sửa sang APPROVED"
    );

    // R5-04: Changing class and having POST scrape fail immediately must NOT trigger a second GET or leave isLoadingCache=true
    const getCacheDefs: { url: string; def: ReturnType<typeof deferred> }[] = [];
    const hwR504 = createRound5Harness(
      "src/app/homework-grader/page.tsx",
      "HomeworkGraderPage",
      "classId,isScraping,isLoadingCache,setClassCode,handleScrapeScores",
      (url: string, opts?: any) => {
        if (opts?.method === "POST") {
          return Promise.resolve({
            json: async () => {
              throw new Error("Immediate POST failure");
            },
          });
        }
        const d = deferred();
        getCacheDefs.push({ url: String(url), def: d });
        return d.promise;
      }
    );
    await hwR504.flush();
    assert.equal(getCacheDefs.length, 1, "Chỉ có 1 GET ban đầu khi mở trang");
    hwR504.context.api.setClassCode("CLASS_B");
    await hwR504.flush();
    await hwR504.context.api.handleScrapeScores();
    await hwR504.flush();
    assert.equal(
      getCacheDefs.length,
      1,
      "R5-04: Khi đổi lớp do bấm cào và POST lỗi ngay, useEffect([classId]) không được phát thêm GET thứ 2"
    );
    assert.equal(hwR504.context.api.isScraping, false, "R5-04: isScraping phải là false");
    assert.equal(hwR504.context.api.isLoadingCache, false, "R5-04: isLoadingCache phải là false");

    // R7-01: All 9 combinations (DRAFT / APPROVED / VERIFIED x edit note / toggle tag / change attendance)
    // connected end-to-end: SessionCommentsPage UI -> save-draft API & list API -> real in-memory SQLite -> reload
    {
      const memDb7 = new Database(":memory:");
      const sqliteJs7 = transpileForVm("src/lib/db/sqlite.ts");
      const localGuardJs7 = transpileForVm("src/lib/security/local-guard.ts");
      const saveDraftJs7 = transpileForVm("src/app/api/session-comments/save-draft/route.ts");
      const listJs7 = transpileForVm("src/app/api/session-comments/list/route.ts");

      const backendSb7: any = {
        console,
        Date,
        Math,
        Map,
        Set,
        JSON,
        RegExp,
        Error,
        Array,
        Object,
        Number,
        String,
        Boolean,
        process,
        URL,
        Request,
        Response,
        NextResponse: { json: (x: any, opts?: any) => Response.json(x, opts) },
        Database: function () {
          return memDb7;
        },
        crypto,
        path,
        fs: { existsSync: () => true },
        assertPathAllowed: (p: string) => p,
        getQuickTags: () => [{ category: "Cat", tags: [{ id: "T1", label: "Chăm chỉ" }] }],
        getCoursesSyllabus: () => [],
        getZaloTemplates: () => [],
      };
      vm.createContext(backendSb7);
      vm.runInContext(
        sqliteJs7 +
          "\n" +
          localGuardJs7 +
          "\n;Object.assign(globalThis, { getDb, classSessionRepo, studentRepo, sessionFeedbackRepo, calculateSha256, validateLocalRequest });" +
          "\n;(function(){\n" +
          saveDraftJs7 +
          "\n;globalThis.saveDraftPOST = POST;\n})();" +
          "\n;(function(){\n" +
          listJs7 +
          "\n;globalThis.listGET = GET;\n})();",
        backendSb7
      );
      backendSb7.getDb();
      backendSb7.classSessionRepo.upsert({
        classId: "VT-C4K-GA38",
        className: "VT-C4K-GA38",
        courseCode: "GA",
        sessionId: "VT-C4K-GA38_SESS_01",
        sessionNumber: 1,
        topic: "Buổi 1",
      });
      backendSb7.studentRepo.upsert({
        studentId: "S1",
        classId: "VT-C4K-GA38",
        fullName: "Nguyễn An",
        isActive: 1,
      });

      const lastSaveDraftStatuses: number[] = [];
      const uiR701 = createRound5Harness(
        "src/app/session-comments/page.tsx",
        "SessionCommentsPage",
        "students,loadClassData,toggleQuickTag,handleNoteChange,handleAttendanceChange,saveDraftToServer,statusMessage",
        async (url: string, opts?: any) => {
          const fullUrl = String(url).startsWith("http")
            ? String(url)
            : `http://127.0.0.1:3000${url}`;
          if (fullUrl.includes("/api/session-comments/save-draft")) {
            const resp: Response = await backendSb7.saveDraftPOST(
              new Request(fullUrl, {
                method: "POST",
                headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
                body: opts?.body,
              })
            );
            lastSaveDraftStatuses.push(resp.status);
            return resp;
          }
          if (fullUrl.includes("/api/session-comments/list")) {
            return backendSb7.listGET(
              new Request(fullUrl, {
                method: "GET",
                headers: { host: "127.0.0.1:3000" },
              })
            );
          }
          return Response.json({ success: true, data: {} });
        }
      );
      await uiR701.flush();

      for (const initialStatus of ["DRAFT", "APPROVED", "VERIFIED"] as const) {
        for (const editAction of ["NOTE", "TAG", "ATTENDANCE"] as const) {
          // Seed initial record in SQLite
          backendSb7.sessionFeedbackRepo.upsert({
            classId: "VT-C4K-GA38",
            sessionId: "VT-C4K-GA38_SESS_01",
            studentId: "S1",
            attendanceStatus: "PRESENT",
            quickTagsJson: "[]",
            teacherNote: "Ghi chú gốc",
            finalText: "Nhận xét đã duyệt",
            contentHash: initialStatus === "DRAFT" ? "" : backendSb7.calculateSha256("Nhận xét đã duyệt"),
            status: initialStatus,
            verifiedAt: initialStatus === "VERIFIED" ? "2026-10-20 09:00:00" : null,
          });

          // Load into UI
          await uiR701.context.api.loadClassData("VT-C4K-GA38", "VT-C4K-GA38_SESS_01");
          await uiR701.flush();
          assert.equal(uiR701.context.api.students[0].status, initialStatus);

          lastSaveDraftStatuses.length = 0;

          // Perform the edit on UI
          if (editAction === "NOTE") {
            uiR701.context.api.handleNoteChange("S1", `Ghi chú mới sau ${initialStatus}`);
          } else if (editAction === "TAG") {
            await uiR701.context.api.toggleQuickTag("S1", "Chăm chỉ");
          } else {
            uiR701.context.api.handleAttendanceChange("S1", "ABSENT");
          }
          await uiR701.flush();

          assert.equal(
            lastSaveDraftStatuses.at(-1),
            200,
            `R7-01 (${initialStatus} + ${editAction}): save-draft phải trả HTTP 200`
          );
          assert.equal(
            uiR701.context.api.students[0].status,
            "DRAFT",
            `R7-01 (${initialStatus} + ${editAction}): Trạng thái trên giao diện phải hạ về DRAFT`
          );

          // Reload from SQLite via list API and verify edit persisted
          await uiR701.context.api.loadClassData("VT-C4K-GA38", "VT-C4K-GA38_SESS_01");
          await uiR701.flush();
          const reloaded = uiR701.context.api.students[0];
          assert.equal(
            reloaded.status,
            "DRAFT",
            `R7-01 (${initialStatus} + ${editAction}): Sau khi tải lại trang, trạng thái phải là DRAFT`
          );
          if (editAction === "NOTE") {
            assert.equal(reloaded.teacherNote, `Ghi chú mới sau ${initialStatus}`);
          } else if (editAction === "TAG") {
            assert.deepEqual(reloaded.quickTags, ["Chăm chỉ"]);
          } else {
            assert.equal(reloaded.attendanceStatus, "ABSENT");
          }
        }
      }

      // R8-01: handleConfirmAllPresent must NOT report success when any student fails to save (HTTP 400/500, network error, or deactivated student in SQLite), and must restore/reconcile failed rows
      backendSb7.studentRepo.upsert({
        studentId: "S1",
        classId: "VT-C4K-GA38",
        fullName: "Nguyễn An",
        isActive: 1,
      });
      backendSb7.studentRepo.upsert({
        studentId: "S2",
        classId: "VT-C4K-GA38",
        fullName: "Trần Bình",
        isActive: 1,
      });
      backendSb7.sessionFeedbackRepo.upsert({
        classId: "VT-C4K-GA38",
        sessionId: "VT-C4K-GA38_SESS_01",
        studentId: "S1",
        attendanceStatus: "ABSENT",
        finalText: "Nháp S1",
        status: "DRAFT",
      });
      backendSb7.sessionFeedbackRepo.upsert({
        classId: "VT-C4K-GA38",
        sessionId: "VT-C4K-GA38_SESS_01",
        studentId: "S2",
        attendanceStatus: "ABSENT",
        finalText: "Nháp S2",
        status: "DRAFT",
      });

      const uiR801 = createRound5Harness(
        "src/app/session-comments/page.tsx",
        "SessionCommentsPage",
        "students,loadClassData,handleConfirmAllPresent,statusMessage",
        async (url: string, opts?: any) => {
          const fullUrl = String(url).startsWith("http")
            ? String(url)
            : `http://127.0.0.1:3000${url}`;
          if (fullUrl.includes("/api/session-comments/save-draft")) {
            return backendSb7.saveDraftPOST(
              new Request(fullUrl, {
                method: "POST",
                headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
                body: opts?.body,
              })
            );
          }
          if (fullUrl.includes("/api/session-comments/list")) {
            return backendSb7.listGET(
              new Request(fullUrl, {
                method: "GET",
                headers: { host: "127.0.0.1:3000" },
              })
            );
          }
          return Response.json({ success: true, data: {} });
        }
      );
      await uiR801.flush();
      await uiR801.context.api.loadClassData("VT-C4K-GA38", "VT-C4K-GA38_SESS_01");
      await uiR801.flush();

      // Mark S1 as inactive in SQLite right before teacher clicks "Confirm All Present"
      backendSb7.studentRepo.upsert({
        studentId: "S1",
        classId: "VT-C4K-GA38",
        fullName: "Nguyễn An",
        isActive: 0,
      });

      await uiR801.context.api.handleConfirmAllPresent();
      await uiR801.flush();

      assert.equal(
        uiR801.context.api.statusMessage?.type,
        "error",
        "R8-01: Khi có học viên lưu thất bại trong xác nhận hàng loạt, statusMessage phải là error"
      );
      const s1After = uiR801.context.api.students.find((s: any) => s.studentId === "S1");
      const s2After = uiR801.context.api.students.find((s: any) => s.studentId === "S2");
      assert.equal(
        s1After?.attendanceStatus,
        "ABSENT",
        "R8-01: Học viên S1 lưu thất bại phải được khôi phục về ABSENT đúng với SQLite"
      );
      assert.equal(
        s2After?.attendanceStatus,
        "PRESENT",
        "R8-01: Học viên S2 lưu thành công phải giữ trạng thái PRESENT"
      );
      assert.equal(
        backendSb7.sessionFeedbackRepo.findOne("VT-C4K-GA38", "VT-C4K-GA38_SESS_01", "S1")?.attendanceStatus,
        "ABSENT"
      );
      assert.equal(
        backendSb7.sessionFeedbackRepo.findOne("VT-C4K-GA38", "VT-C4K-GA38_SESS_01", "S2")?.attendanceStatus,
        "PRESENT"
      );

      // R9-01A: Delayed failed save must preserve newer successful edit and not overwrite SQLite on subsequent edit
      backendSb7.studentRepo.upsert({
        studentId: "S1",
        classId: "VT-C4K-GA38",
        fullName: "Nguyễn An",
        isActive: 1,
      });
      backendSb7.sessionFeedbackRepo.upsert({
        classId: "VT-C4K-GA38",
        sessionId: "VT-C4K-GA38_SESS_01",
        studentId: "S1",
        attendanceStatus: "PRESENT",
        teacherNote: "old note",
        finalText: "approved text",
        status: "DRAFT",
      });
      const slowFirstSave = deferred();
      let savePostCount = 0;
      const uiR901A = createRound5Harness(
        "src/app/session-comments/page.tsx",
        "SessionCommentsPage",
        "students,handleNoteChange,handleAttendanceChange,statusMessage",
        async (url: string, opts?: any) => {
          const fullUrl = String(url).startsWith("http")
            ? String(url)
            : `http://127.0.0.1:3000${url}`;
          if (fullUrl.includes("/api/session-comments/list")) {
            return backendSb7.listGET(
              new Request(fullUrl, {
                method: "GET",
                headers: { host: "127.0.0.1:3000" },
              })
            );
          }
          if (fullUrl.includes("/api/session-comments/save-draft")) {
            savePostCount++;
            if (savePostCount === 1) return slowFirstSave.promise;
            return backendSb7.saveDraftPOST(
              new Request(fullUrl, {
                method: "POST",
                headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
                body: opts?.body,
              })
            );
          }
          return Response.json({ success: true, data: {} });
        }
      );
      await uiR901A.flush();
      uiR901A.context.api.handleNoteChange("S1", "first edit - pending");
      await uiR901A.flush();
      uiR901A.context.api.handleNoteChange("S1", "second edit - saved");
      await uiR901A.flush();
      assert.equal(
        backendSb7.sessionFeedbackRepo.findOne("VT-C4K-GA38", "VT-C4K-GA38_SESS_01", "S1")?.teacherNote,
        "second edit - saved"
      );
      slowFirstSave.resolve(
        Response.json({ success: false, error: "old request failed" }, { status: 500 })
      );
      await uiR901A.flush();
      assert.equal(
        uiR901A.context.api.students.find((s: any) => s.studentId === "S1")?.teacherNote,
        "second edit - saved",
        "R9-01A: Phản hồi lỗi của lần lưu cũ không được ghi đè ghi chú mới đã lưu"
      );
      uiR901A.context.api.handleAttendanceChange("S1", "LATE");
      await uiR901A.flush();
      assert.equal(
        backendSb7.sessionFeedbackRepo.findOne("VT-C4K-GA38", "VT-C4K-GA38_SESS_01", "S1")?.teacherNote,
        "second edit - saved",
        "R9-01A: Thao tác đổi điểm danh tiếp theo không được ghi lại ghi chú cũ vào SQLite"
      );

      // R9-01B: Delayed failed save from old class must not replace new class row
      backendSb7.classSessionRepo.upsert({
        classId: "CLASS_B",
        className: "CLASS_B",
        courseCode: "GA",
        sessionId: "CLASS_B_SESS_01",
        sessionNumber: 1,
        topic: "Buổi 1 B",
      });
      backendSb7.studentRepo.upsert({
        studentId: "S1",
        classId: "CLASS_B",
        fullName: "Student in B",
        isActive: 1,
      });
      backendSb7.sessionFeedbackRepo.upsert({
        classId: "CLASS_B",
        sessionId: "CLASS_B_SESS_01",
        studentId: "S1",
        attendanceStatus: "PRESENT",
        teacherNote: "B note",
        finalText: "B text",
        status: "DRAFT",
      });
      const slowClassASave = deferred();
      const uiR901B = createRound5Harness(
        "src/app/session-comments/page.tsx",
        "SessionCommentsPage",
        "students,loadClassData,handleNoteChange,setClassId,setSelectedSessionId,statusMessage",
        async (url: string) => {
          const fullUrl = String(url).startsWith("http")
            ? String(url)
            : `http://127.0.0.1:3000${url}`;
          if (fullUrl.includes("/api/session-comments/list")) {
            return backendSb7.listGET(
              new Request(fullUrl, {
                method: "GET",
                headers: { host: "127.0.0.1:3000" },
              })
            );
          }
          return slowClassASave.promise;
        }
      );
      await uiR901B.flush();
      await uiR901B.context.api.loadClassData("VT-C4K-GA38", "VT-C4K-GA38_SESS_01");
      await uiR901B.flush();
      uiR901B.context.api.handleNoteChange("S1", "A pending edit");
      await uiR901B.flush();
      uiR901B.context.api.setClassId("CLASS_B");
      uiR901B.context.api.setSelectedSessionId("CLASS_B_SESS_01");
      await uiR901B.flush();
      await uiR901B.context.api.loadClassData("CLASS_B", "CLASS_B_SESS_01");
      await uiR901B.flush();
      assert.equal(uiR901B.context.api.students.find((s: any) => s.studentId === "S1")?.classId, "CLASS_B");
      assert.equal(uiR901B.context.api.students.find((s: any) => s.studentId === "S1")?.teacherNote, "B note");
      slowClassASave.resolve(
        Response.json({ success: false, error: "A request failed" }, { status: 500 })
      );
      await uiR901B.flush();
      const rowAfterClassAFail = uiR901B.context.api.students.find((s: any) => s.studentId === "S1");
      assert.equal(
        rowAfterClassAFail?.classId,
        "CLASS_B",
        "R9-01B: Phản hồi lỗi của lớp cũ không được thay dòng của lớp mới"
      );
      assert.equal(
        rowAfterClassAFail?.teacherNote,
        "B note",
        "R9-01B: Ghi chú của lớp B phải được giữ nguyên"
      );

      // R10-01: Bulk attendance stale failure (both HTTP 500 and network error) while newer note edit is pending must NOT overwrite the newer note during reconciliation or subsequent edits
      for (const failMode of ["http", "network"] as const) {
        backendSb7.sessionFeedbackRepo.upsert({
          classId: "VT-C4K-GA38",
          sessionId: "VT-C4K-GA38_SESS_01",
          studentId: "S1",
          attendanceStatus: "ABSENT",
          teacherNote: "old note",
          finalText: "approved text",
          status: "DRAFT",
        });
        // Keep only S1 active in VT-C4K-GA38 for this test
        backendSb7.studentRepo.upsert({
          studentId: "S2",
          classId: "VT-C4K-GA38",
          fullName: "Trần Bình",
          isActive: 0,
        });

        let oldResolve!: (val: any) => void;
        let oldReject!: (err: any) => void;
        let newResolve!: (val?: any) => void;
        const oldSaveP = new Promise((r, j) => {
          oldResolve = r;
          oldReject = j;
        });
        const newSaveP = new Promise((r) => {
          newResolve = r;
        });
        let postSeq = 0;

        const uiR1001 = createRound5Harness(
          "src/app/session-comments/page.tsx",
          "SessionCommentsPage",
          "students,handleConfirmAllPresent,handleNoteChange,handleAttendanceChange,statusMessage",
          async (url: string, opts?: any) => {
            const fullUrl = String(url).startsWith("http")
              ? String(url)
              : `http://127.0.0.1:3000${url}`;
            if (fullUrl.includes("/api/session-comments/list")) {
              return backendSb7.listGET(
                new Request(fullUrl, {
                  method: "GET",
                  headers: { host: "127.0.0.1:3000" },
                })
              );
            }
            if (fullUrl.includes("/api/session-comments/save-draft")) {
              postSeq++;
              if (postSeq === 1) return oldSaveP;
              if (postSeq === 2) {
                await newSaveP;
              }
              return backendSb7.saveDraftPOST(
                new Request(fullUrl, {
                  method: "POST",
                  headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
                  body: opts?.body,
                })
              );
            }
            return Response.json({ success: true, data: {} });
          }
        );
        await uiR1001.flush();
        const bulkP = uiR1001.context.api.handleConfirmAllPresent();
        await uiR1001.flush();
        uiR1001.context.api.handleNoteChange("S1", "NEW NOTE MUST SURVIVE");
        await uiR1001.flush();
        assert.equal(uiR1001.context.api.students[0].teacherNote, "NEW NOTE MUST SURVIVE");

        if (failMode === "http") {
          oldResolve(Response.json({ success: false, error: "old bulk failed" }, { status: 500 }));
        } else {
          oldReject(new Error("old bulk network failure"));
        }
        await bulkP;
        await uiR1001.flush();
        assert.equal(
          uiR1001.context.api.students[0].teacherNote,
          "NEW NOTE MUST SURVIVE",
          `R10-01 (${failMode}): Đối soát hàng loạt không được ghi đè ghi chú mới đang chờ lưu`
        );

        newResolve();
        await uiR1001.flush();
        assert.equal(
          uiR1001.context.api.students[0].teacherNote,
          "NEW NOTE MUST SURVIVE",
          `R10-01 (${failMode}): Sau khi lưu ghi chú mới xong, giao diện phải giữ ghi chú mới`
        );
        assert.equal(
          backendSb7.sessionFeedbackRepo.findOne("VT-C4K-GA38", "VT-C4K-GA38_SESS_01", "S1")?.teacherNote,
          "NEW NOTE MUST SURVIVE",
          `R10-01 (${failMode}): SQLite phải lưu ghi chú mới`
        );

        uiR1001.context.api.handleAttendanceChange("S1", "LATE");
        await uiR1001.flush();
        assert.equal(
          backendSb7.sessionFeedbackRepo.findOne("VT-C4K-GA38", "VT-C4K-GA38_SESS_01", "S1")?.teacherNote,
          "NEW NOTE MUST SURVIVE",
          `R10-01 (${failMode}): Đổi điểm danh tiếp theo phải giữ nguyên ghi chú mới trong SQLite`
        );
      }

      // R11-01: Queued bulk attendance save for later student (S2) must preserve edits made while earlier student (S1) is still awaiting
      for (const r11Mode of [
        "control",
        "first-success",
        "first-http-error",
        "first-network-error",
      ] as const) {
        backendSb7.studentRepo.upsert({
          studentId: "S1",
          classId: "VT-C4K-GA38",
          fullName: "Student S1",
          isActive: 1,
        });
        backendSb7.studentRepo.upsert({
          studentId: "S2",
          classId: "VT-C4K-GA38",
          fullName: "Student S2",
          isActive: 1,
        });
        backendSb7.sessionFeedbackRepo.upsert({
          classId: "VT-C4K-GA38",
          sessionId: "VT-C4K-GA38_SESS_01",
          studentId: "S1",
          attendanceStatus: "ABSENT",
          teacherNote: "old S1 note",
          quickTagsJson: "[]",
          finalText: "S1 text",
          status: "DRAFT",
        });
        backendSb7.sessionFeedbackRepo.upsert({
          classId: "VT-C4K-GA38",
          sessionId: "VT-C4K-GA38_SESS_01",
          studentId: "S2",
          attendanceStatus: "ABSENT",
          teacherNote: "old S2 note",
          quickTagsJson: "[]",
          finalText: "S2 text",
          status: "DRAFT",
        });

        let releaseFirst!: () => void;
        const waitFirst = new Promise<void>((r) => {
          releaseFirst = r;
        });

        const uiR1101 = createRound5Harness(
          "src/app/session-comments/page.tsx",
          "SessionCommentsPage",
          "students,handleConfirmAllPresent,handleNoteChange,handleAttendanceChange,statusMessage,loadClassData",
          async (url: string, opts?: any) => {
            const fullUrl = String(url).startsWith("http")
              ? String(url)
              : `http://127.0.0.1:3000${url}`;
            if (fullUrl.includes("/api/session-comments/list")) {
              return backendSb7.listGET(
                new Request(fullUrl, {
                  method: "GET",
                  headers: { host: "127.0.0.1:3000" },
                })
              );
            }
            if (fullUrl.includes("/api/session-comments/save-draft")) {
              const body = JSON.parse(opts.body);
              if (body.studentId === "S1") {
                await waitFirst;
                if (r11Mode === "first-http-error") {
                  return Response.json(
                    { success: false, error: "first student failed" },
                    { status: 500 }
                  );
                }
                if (r11Mode === "first-network-error") {
                  throw new Error("first student network failure");
                }
              }
              return backendSb7.saveDraftPOST(
                new Request(fullUrl, {
                  method: "POST",
                  headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
                  body: opts.body,
                })
              );
            }
            return Response.json({ success: true, data: {} });
          }
        );

        await uiR1101.flush();
        assert.equal(uiR1101.context.api.students.length, 2);

        const bulkPromise = uiR1101.context.api.handleConfirmAllPresent();
        await uiR1101.flush();

        if (r11Mode !== "control") {
          uiR1101.context.api.handleNoteChange("S2", "NEW S2 NOTE MUST SURVIVE");
          await uiR1101.flush();
          assert.equal(
            backendSb7.sessionFeedbackRepo.findOne("VT-C4K-GA38", "VT-C4K-GA38_SESS_01", "S2")
              ?.teacherNote,
            "NEW S2 NOTE MUST SURVIVE"
          );
        }

        releaseFirst();
        await bulkPromise;
        await uiR1101.flush();

        const expectedNote =
          r11Mode === "control" ? "old S2 note" : "NEW S2 NOTE MUST SURVIVE";
        const storedNote = backendSb7.sessionFeedbackRepo.findOne(
          "VT-C4K-GA38",
          "VT-C4K-GA38_SESS_01",
          "S2"
        )?.teacherNote;
        const visibleNote = uiR1101.context.api.students.find(
          (s: any) => s.studentId === "S2"
        )?.teacherNote;
        await uiR1101.context.api.loadClassData("VT-C4K-GA38", "VT-C4K-GA38_SESS_01");
        await uiR1101.flush();
        const reloadedNote = uiR1101.context.api.students.find(
          (s: any) => s.studentId === "S2"
        )?.teacherNote;

        assert.equal(
          storedNote,
          expectedNote,
          `R11-01 (${r11Mode}): SQLite phải giữ nguyên ghi chú mới của S2`
        );
        assert.equal(
          visibleNote,
          expectedNote,
          `R11-01 (${r11Mode}): Giao diện phải giữ nguyên ghi chú mới của S2`
        );
        assert.equal(
          reloadedNote,
          expectedNote,
          `R11-01 (${r11Mode}): Sau khi tải lại dữ liệu, S2 vẫn phải giữ ghi chú mới`
        );
      }

      // R12-01: Earlier successful save-draft request arriving out of order must NOT overwrite newer successful edit in SQLite or after reload
      {
        backendSb7.studentRepo.upsert({
          studentId: "S1",
          classId: "VT-C4K-GA38",
          fullName: "Student S1",
          isActive: 1,
        });
        backendSb7.sessionFeedbackRepo.upsert({
          classId: "VT-C4K-GA38",
          sessionId: "VT-C4K-GA38_SESS_01",
          studentId: "S1",
          attendanceStatus: "ABSENT",
          teacherNote: "old S1 note",
          quickTagsJson: "[]",
          finalText: "S1 text",
          status: "DRAFT",
        });

        let releaseOlder!: () => void;
        const waitOlder = new Promise<void>((r) => {
          releaseOlder = r;
        });
        const observedStatuses: number[] = [];

        const uiR1201 = createRound5Harness(
          "src/app/session-comments/page.tsx",
          "SessionCommentsPage",
          "students,handleNoteChange,loadClassData",
          async (url: string, opts?: any) => {
            const fullUrl = String(url).startsWith("http")
              ? String(url)
              : `http://127.0.0.1:3000${url}`;
            if (fullUrl.includes("/api/session-comments/list")) {
              return backendSb7.listGET(
                new Request(fullUrl, {
                  method: "GET",
                  headers: { host: "127.0.0.1:3000" },
                })
              );
            }
            if (fullUrl.includes("/api/session-comments/save-draft")) {
              const body = JSON.parse(opts.body);
              if (body.teacherNote === "older edit") {
                await waitOlder;
              }
              const resp: Response = await backendSb7.saveDraftPOST(
                new Request(fullUrl, {
                  method: "POST",
                  headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
                  body: opts.body,
                })
              );
              observedStatuses.push(resp.status);
              return resp;
            }
            return Response.json({ success: true, data: {} });
          }
        );

        await uiR1201.flush();
        uiR1201.context.api.handleNoteChange("S1", "older edit");
        await uiR1201.flush();
        uiR1201.context.api.handleNoteChange("S1", "LATEST EDIT");
        await uiR1201.flush();
        assert.equal(
          backendSb7.sessionFeedbackRepo.findOne("VT-C4K-GA38", "VT-C4K-GA38_SESS_01", "S1")
            ?.teacherNote,
          "LATEST EDIT",
          "R12-01: Yêu cầu sửa mới phải được lưu vào SQLite trước"
        );

        releaseOlder();
        await uiR1201.flush();

        assert.deepEqual(observedStatuses, [200, 200], "R12-01: Cả hai yêu cầu lưu đều trả HTTP 200");
        assert.equal(
          backendSb7.sessionFeedbackRepo.findOne("VT-C4K-GA38", "VT-C4K-GA38_SESS_01", "S1")
            ?.teacherNote,
          "LATEST EDIT",
          "R12-01: Yêu cầu lưu cũ hoàn tất muộn không được ghi đè bản sửa mới hơn trong SQLite"
        );
        await uiR1201.context.api.loadClassData("VT-C4K-GA38", "VT-C4K-GA38_SESS_01");
        await uiR1201.flush();
        assert.equal(
          uiR1201.context.api.students.find((s: any) => s.studentId === "S1")?.teacherNote,
          "LATEST EDIT",
          "R12-01: Sau khi tải lại dữ liệu, giao diện phải giữ nguyên bản sửa mới nhất"
        );
      }

      // ============================================================================
      // ROUND 15 REGRESSION SUITE (R15-01 -> R15-07)
      // ============================================================================
      {
        const cidR15 = "VT-C4K-GA38";
        const sidR15 = `${cidR15}_SESS_01`;
        const approveJs7 = transpileForVm("src/app/api/session-comments/approve/route.ts");
        const makeLocator = (extra: any = {}): any => ({
          first() {
            return this;
          },
          nth: () => makeLocator(),
          locator: () => makeLocator(),
          filter() {
            return this;
          },
          count: async () => 0,
          isVisible: async () => false,
          isEnabled: async () => false,
          getAttribute: async () => null,
          innerText: async () => "",
          textContent: async () => "",
          click: async () => {},
          waitFor: async () => {},
          scrollIntoViewIfNeeded: async () => {},
          evaluate: async () => true,
          ...extra,
        });

        const createRealSqliteBackendSandbox = () => {
          const memDb = new Database(":memory:");
          const sb: any = {
            console,
            Date,
            Math,
            Map,
            Set,
            JSON,
            RegExp,
            Error,
            Array,
            Object,
            Number,
            String,
            Boolean,
            process,
            URL,
            Request,
            Response,
            NextResponse: { json: (x: any, opts?: any) => Response.json(x, opts) },
            Database: function () {
              return memDb;
            },
            crypto,
            path,
            fs: { existsSync: () => true },
            assertPathAllowed: (p: string) => p,
            getQuickTags: () => [{ category: "Cat", tags: [{ id: "T1", label: "Chăm chỉ" }] }],
            getCoursesSyllabus: () => [],
            getZaloTemplates: () => [],
          };
          vm.createContext(sb);
          vm.runInContext(
            sqliteJs7 +
              "\n" +
              localGuardJs7 +
              "\n;Object.assign(globalThis, { getDb, classSessionRepo, studentRepo, sessionFeedbackRepo, calculateSha256, validateLocalRequest });" +
              "\n;(function(){\n" +
              saveDraftJs7 +
              "\n;globalThis.saveDraftPOST = POST;\n})();" +
              "\n;(function(){\n" +
              approveJs7 +
              "\n;globalThis.approvePOST = POST;\n})();" +
              "\n;(function(){\n" +
              listJs7 +
              "\n;globalThis.listGET = GET;\n})();",
            sb
          );
          sb.getDb();
          sb.classSessionRepo.upsert({
            classId: cidR15,
            className: cidR15,
            courseCode: "GA",
            sessionId: sidR15,
            sessionNumber: 1,
            topic: "Buổi 1",
          });
          sb.db = memDb;
          return sb;
        };

        // R15-01: Approve awaits in-flight save-draft & conditional SQLite CAS prevents stale approve overwrite
        {
          const backendR1501 = createRealSqliteBackendSandbox();
          try {
            backendR1501.studentRepo.upsert({
              classId: cidR15,
              studentId: "S1",
              fullName: "Audit S1",
              isActive: 1,
            });
            backendR1501.sessionFeedbackRepo.upsert({
              classId: cidR15,
              sessionId: sidR15,
              studentId: "S1",
              attendanceStatus: "PRESENT",
              teacherNote: "init",
              finalText: "old final",
              status: "DRAFT",
            });

            const slowSave = deferred();
            const uiR1501 = createRound5Harness(
              "src/app/session-comments/page.tsx",
              "SessionCommentsPage",
              "students,loadClassData,handleApprove,handleTextEdit",
              async (url: string, opts?: any) => {
                const fullUrl = String(url).startsWith("http")
                  ? String(url)
                  : `http://127.0.0.1:3000${url}`;
                if (fullUrl.includes("/api/session-comments/list")) {
                  return backendR1501.listGET(
                    new Request(fullUrl, { headers: { host: "127.0.0.1:3000" } })
                  );
                }
                if (fullUrl.includes("/api/session-comments/save-draft")) {
                  await slowSave.promise;
                  return backendR1501.saveDraftPOST(
                    new Request(fullUrl, {
                      method: "POST",
                      headers: {
                        host: "127.0.0.1:3000",
                        "content-type": "application/json",
                        ...(opts?.headers || {}),
                      },
                      body: opts?.body,
                    })
                  );
                }
                if (fullUrl.includes("/api/session-comments/approve")) {
                  return backendR1501.approvePOST(
                    new Request(fullUrl, {
                      method: "POST",
                      headers: {
                        host: "127.0.0.1:3000",
                        "content-type": "application/json",
                        ...(opts?.headers || {}),
                      },
                      body: opts?.body,
                    })
                  );
                }
                return Response.json({ success: true, data: {} });
              }
            );

            await uiR1501.flush();
            await uiR1501.context.api.loadClassData(cidR15, sidR15);
            await uiR1501.flush();

            uiR1501.context.api.handleTextEdit("S1", "finalText", "LATEST TEACHER TEXT");
            await uiR1501.flush();

            const approvePromise = uiR1501.context.api.handleApprove("S1");
            slowSave.resolve(undefined);
            await approvePromise;
            await uiR1501.flush();

            const rowAfter = backendR1501.sessionFeedbackRepo.findOne(cidR15, sidR15, "S1");
            assert.equal(
              rowAfter?.finalText,
              "LATEST TEACHER TEXT",
              "R15-01: Approve không được ghi đè mất nội dung chỉnh sửa đang lưu dở"
            );
            assert.equal(rowAfter?.status, "APPROVED");
          } finally {
            backendR1501.db.close();
          }
        }

        // R15-02 & R15-07: CommentGenerator snapshot concurrency guard & topic/keyKnowledge name redaction
        {
          const backendR1502 = createRealSqliteBackendSandbox();
          try {
            backendR1502.studentRepo.upsert({
              classId: cidR15,
              studentId: "S1",
              fullName: "Audit S1",
              isActive: 1,
            });
            backendR1502.studentRepo.upsert({
              classId: cidR15,
              studentId: "S2",
              fullName: "Audit S2",
              isActive: 1,
            });
            backendR1502.sessionFeedbackRepo.upsert({
              classId: cidR15,
              sessionId: sidR15,
              studentId: "S1",
              attendanceStatus: "PRESENT",
              teacherNote: "old S1",
              finalText: "old final",
              status: "DRAFT",
            });
            backendR1502.sessionFeedbackRepo.upsert({
              classId: cidR15,
              sessionId: sidR15,
              studentId: "S2",
              attendanceStatus: "PRESENT",
              teacherNote: "old S2",
              finalText: "old final S2",
              status: "DRAFT",
            });

            const slowModel = deferred();
            let capturedPrompt = "";
            const commentGenJs = transpileForVm("src/lib/gemini/comment-generator.ts");
            const sbGen: any = {
              console,
              JSON,
              Set,
              Map,
              Array,
              Object,
              String,
              Number,
              Boolean,
              RegExp,
              Error,
              Promise,
              sessionFeedbackRepo: backendR1502.sessionFeedbackRepo,
              studentRepo: backendR1502.studentRepo,
              getGeminiModel: () => ({
                generateContent: async (p: string) => {
                  capturedPrompt = p;
                  await slowModel.promise;
                  return {
                    response: {
                      text: () =>
                        JSON.stringify({
                          feedbacks: [
                            {
                              anonymousId: "STUDENT_01",
                              strengths: "good",
                              improvements: "more",
                              actionPlan: "practice",
                              formattedFullComment: "AI COMMENT FOR STUDENT_01",
                            },
                            {
                              anonymousId: "STUDENT_02",
                              strengths: "good",
                              improvements: "more",
                              actionPlan: "practice",
                              formattedFullComment: "AI COMMENT FOR STUDENT_02",
                            },
                          ],
                        }),
                    },
                  };
                },
              }),
            };
            vm.createContext(sbGen);
            vm.runInContext(
              commentGenJs + "\n;globalThis.CommentGenerator = CommentGenerator;",
              sbGen
            );

            const aiPromise = sbGen.CommentGenerator.generateBatchComments(
              {
                classId: cidR15,
                sessionId: sidR15,
                sessionNumber: 1,
                sessionDate: "2026-04-12",
                topic: "Dự án của Audit S1",
                keyKnowledge: ["Audit S1 thuyết trình"],
              },
              [
                {
                  studentId: "S1",
                  fullName: "Audit S1",
                  attendanceStatus: "PRESENT",
                  quickTags: ["Audit S1 focused"],
                  teacherNote: "Audit S1 worked well",
                },
                {
                  studentId: "S2",
                  fullName: "Audit S2",
                  attendanceStatus: "PRESENT",
                  quickTags: ["tag"],
                  teacherNote: "old S2",
                },
              ]
            );

            await new Promise((r) => setImmediate(r));
            assert.equal(
              capturedPrompt.includes("Audit S1"),
              false,
              "R15-07: Prompt gửi lên Gemini tuyệt đối không được chứa tên thật học viên trong topic hoặc keyKnowledge"
            );

            // Concurrent edit to S1 while AI is in-flight
            await backendR1502.saveDraftPOST(
              new Request(
                `http://127.0.0.1:3000/api/session-comments/save-draft?cid=page_r1502&rev=1&f=teacherNote`,
                {
                  method: "POST",
                  headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
                  body: JSON.stringify({
                    classId: cidR15,
                    sessionId: sidR15,
                    studentId: "S1",
                    teacherNote: "LATEST TEACHER NOTE",
                  }),
                }
              )
            );

            slowModel.resolve(undefined);
            await aiPromise;

            const s1Row = backendR1502.sessionFeedbackRepo.findOne(cidR15, sidR15, "S1");
            const s2Row = backendR1502.sessionFeedbackRepo.findOne(cidR15, sidR15, "S2");
            assert.equal(
              s1Row?.teacherNote,
              "LATEST TEACHER NOTE",
              "R15-02: AI hoàn tất muộn không được ghi đè mất ghi chú mới của giáo viên"
            );
            assert.equal(
              s2Row?.finalText,
              "AI COMMENT FOR Audit S2",
              "R15-02: Học viên không bị chỉnh sửa trong lúc AI chạy vẫn nhận kết quả AI bình thường"
            );
          } finally {
            backendR1502.db.close();
          }
        }

        // R15-03: Persistent SQLite versionMetaJson protects against stale saves across page reloads & route re-instantiation
        {
          const backendR1503 = createRealSqliteBackendSandbox();
          try {
            backendR1503.studentRepo.upsert({
              classId: cidR15,
              studentId: "S1",
              fullName: "Audit S1",
              isActive: 1,
            });
            backendR1503.sessionFeedbackRepo.upsert({
              classId: cidR15,
              sessionId: sidR15,
              studentId: "S1",
              attendanceStatus: "PRESENT",
              teacherNote: "init",
              finalText: "init final",
              status: "DRAFT",
            });

            const slowOldPageSave = deferred();
            const makePage = (slowFirstSave: boolean) =>
              createRound5Harness(
                "src/app/session-comments/page.tsx",
                "SessionCommentsPage",
                "students,loadClassData,handleNoteChange",
                async (url: string, opts?: any) => {
                  const fullUrl = String(url).startsWith("http")
                    ? String(url)
                    : `http://127.0.0.1:3000${url}`;
                  if (fullUrl.includes("/api/session-comments/list")) {
                    return backendR1503.listGET(
                      new Request(fullUrl, { headers: { host: "127.0.0.1:3000" } })
                    );
                  }
                  if (fullUrl.includes("/api/session-comments/save-draft")) {
                    if (slowFirstSave) {
                      await slowOldPageSave.promise;
                    }
                    return backendR1503.saveDraftPOST(
                      new Request(fullUrl, {
                        method: "POST",
                        headers: {
                          host: "127.0.0.1:3000",
                          "content-type": "application/json",
                          ...(opts?.headers || {}),
                        },
                        body: opts?.body,
                      })
                    );
                  }
                  return Response.json({ success: true, data: {} });
                }
              );

            const page1 = makePage(true);
            await page1.flush();
            await page1.context.api.loadClassData(cidR15, sidR15);
            await page1.flush();
            page1.context.api.handleNoteChange("S1", "OLDER PAGE EDIT");
            await page1.flush();

            const page2 = makePage(false);
            await page2.flush();
            await page2.context.api.loadClassData(cidR15, sidR15);
            await page2.flush();
            page2.context.api.handleNoteChange("S1", "LATEST NEW PAGE EDIT");
            await page2.flush();

            slowOldPageSave.resolve(undefined);
            await page1.flush();
            await page2.flush();

            assert.equal(
              backendR1503.sessionFeedbackRepo.findOne(cidR15, sidR15, "S1")?.teacherNote,
              "LATEST NEW PAGE EDIT",
              "R15-03: Yêu cầu lưu cũ từ phiên trang trước không được ghi đè bản lưu mới hơn trong SQLite"
            );
          } finally {
            backendR1503.db.close();
          }
        }

        // R15-04: CommentSaver re-verifies active roster & attendance eligibility before saving to LMS
        {
          const backendR1504 = createRealSqliteBackendSandbox();
          try {
            backendR1504.studentRepo.upsert({
              classId: cidR15,
              studentId: "S1",
              fullName: "Audit S1",
              isActive: 1,
            });
            backendR1504.sessionFeedbackRepo.upsert({
              classId: cidR15,
              sessionId: sidR15,
              studentId: "S1",
              attendanceStatus: "PRESENT",
              finalText: "Approved text",
              contentHash: backendR1504.calculateSha256("Approved text"),
              status: "APPROVED",
            });
            // Simulate roster sync marking S1 inactive after approval
            backendR1504.studentRepo.upsert({
              classId: cidR15,
              studentId: "S1",
              fullName: "Audit S1",
              isActive: 0,
            });

            const sbSaveR1504: any = {
              console,
              Date,
              Error,
              RegExp,
              Set,
              Map,
              Array,
              Object,
              String,
              Number,
              Boolean,
              parseInt,
              BrowserManager: {
                getInstance: () => ({
                  getPage: async () => ({
                    locator: () => makeLocator({ count: async () => 1 }),
                    waitForTimeout: async () => {},
                    keyboard: { press: async () => {} },
                    screenshot: async () => {},
                  }),
                }),
              },
              authService: { ensureAuthenticated: async () => {} },
              LmsHelpers: { openClassDrawer: async () => {}, switchDrawerTab: async () => {} },
              SELECTORS: { tabs: { comments: "" } },
              jobLogRepo: { add() {} },
              verifyContentIntegrity: (txt: string, hash: string) =>
                backendR1504.calculateSha256(txt) === hash,
              createNetworkInterceptor: () => ({
                dismissForbiddenToast: async () => {},
                waitForApiResponse: async () => ({ status: () => 200 }),
              }),
              studentRepo: backendR1504.studentRepo,
              sessionFeedbackRepo: backendR1504.sessionFeedbackRepo,
            };
            vm.createContext(sbSaveR1504);
            vm.runInContext(saveJs + "\n;globalThis.CommentSaver = CommentSaver;", sbSaveR1504);

            const outR1504 = await sbSaveR1504.CommentSaver.saveComments({
              classId: cidR15,
              classCode: cidR15,
              sessionId: sidR15,
            });
            assert.equal(
              outR1504.verifiedCount,
              0,
              "R15-04: Không được lưu LMS cho học viên đã nghỉ học"
            );
            assert.equal(
              backendR1504.sessionFeedbackRepo.findOne(cidR15, sidR15, "S1")?.status,
              "DRAFT",
              "R15-04: Học viên đã nghỉ học hoặc vắng mặt phải được hạ trạng thái về DRAFT"
            );
          } finally {
            backendR1504.db.close();
          }
        }

        // R15-05: ScoreScraper.scrapeFromDomGrid waits for asynchronous pagination transition
        {
          const scrapeScoresJs = transpileForVm("src/lib/playwright/scrape-scores.ts");
          const sbScrape: any = {
            console,
            Date,
            Error,
            RegExp,
            Set,
            Map,
            Array,
            Object,
            String,
            Number,
            Boolean,
            Math,
            Promise,
            parseInt,
            parseFloat,
            isNaN: Number.isNaN,
            setTimeout,
            clearTimeout,
          };
          vm.createContext(sbScrape);
          vm.runInContext(
            scrapeScoresJs + "\n;globalThis.ScoreScraper = ScoreScraper;",
            sbScrape
          );

          let pageIdx = 0;
          let timer: any;
          const emptyLoc = makeLocator();
          const headersLoc = makeLocator({
            count: async () => 2,
            nth: (i: number) =>
              makeLocator({ innerText: async () => (i ? "Homework 1" : "Name") }),
          });
          const cellsLoc = () =>
            makeLocator({
              count: async () => 2,
              nth: (i: number) =>
                makeLocator({ innerText: async () => (i ? "0/100" : `Audit page ${pageIdx}`) }),
            });
          const rowsLoc = makeLocator({
            count: async () => 1,
            nth: () =>
              makeLocator({
                locator: () =>
                  makeLocator({
                    locator: () => makeLocator({ locator: cellsLoc }),
                  }),
              }),
          });
          const nextLoc = makeLocator({
            count: async () => 1,
            isVisible: async () => true,
            isEnabled: async () => pageIdx === 0,
            click: async () => {
              timer = setTimeout(() => {
                pageIdx = 1;
              }, 100);
            },
          });
          const gridLoc = makeLocator({
            locator: (sel: string) =>
              sel.includes("Homework")
                ? headersLoc
                : sel.includes("ExpandMoreIcon")
                ? rowsLoc
                : sel.includes("next page")
                ? nextLoc
                : emptyLoc,
          });

          try {
            const resR1505 = await sbScrape.ScoreScraper.scrapeFromDomGrid(
              gridLoc,
              cidR15,
              new Map(),
              new Map(),
              (s: string) => s.toLowerCase()
            );
            assert.equal(
              resR1505.rows.length,
              2,
              "R15-05: scrapeFromDomGrid phải chờ phân trang DOM render xong và thu thập đủ 2 trang"
            );
          } finally {
            clearTimeout(timer);
          }
        }

        // R15-06: /api/queue/stream cleans up logs & status subscriptions on abort / cancel
        {
          const logsSet = new Set<any>();
          const statusSet = new Set<any>();
          const streamRouteJs = transpileForVm("src/app/api/queue/stream/route.ts");
          const sbStream: any = {
            console,
            JSON,
            TextEncoder,
            ReadableStream,
            Response,
            validateLocalRequest: () => null,
            taskQueue: {
              getStatus: () => ({}),
              subscribeLogs: (fn: any) => {
                logsSet.add(fn);
                return () => logsSet.delete(fn);
              },
              subscribeStatus: (fn: any) => {
                statusSet.add(fn);
                return () => statusSet.delete(fn);
              },
            },
          };
          vm.createContext(sbStream);
          vm.runInContext(streamRouteJs + "\n;globalThis.GET = GET;", sbStream);

          for (let i = 0; i < 3; i++) {
            const abortCtrl = new AbortController();
            const res = await sbStream.GET(
              new Request("http://127.0.0.1:3000/api/queue/stream", {
                headers: { host: "127.0.0.1:3000" },
                signal: abortCtrl.signal,
              })
            );
            assert.equal(res.status, 200);
            abortCtrl.abort();
            await res.body.cancel();
          }
          assert.equal(
            logsSet.size,
            0,
            "R15-06: Không được rò rỉ listener subscribeLogs sau khi đóng SSE"
          );
          assert.equal(
            statusSet.size,
            0,
            "R15-06: Không được rò rỉ listener subscribeStatus sau khi đóng SSE"
          );
        }

        // ====================================================================
        // ROUND 16 REGRESSION SUITE (R16-01 -> R16-05)
        // ====================================================================
        {
          // R16-01 & R16-02: Slow DOM pagination (650ms) and empty loading placeholder with full scrapeClassScores worker
          const runR16DomScrape = async (
            delayMs: number,
            emptyWhileLoading: boolean,
            fullWorker: boolean
          ) => {
            const scrapeScoresJs = transpileForVm("src/lib/playwright/scrape-scores.ts");
            let pageIdx = 0;
            let loading = false;
            let timer: any;
            const emptyLoc = makeLocator();
            const headersLoc = makeLocator({
              count: async () => 2,
              nth: (i: number) =>
                makeLocator({ innerText: async () => (i ? "Homework 1" : "Name") }),
            });
            const cellsLoc = () =>
              makeLocator({
                count: async () => 2,
                nth: (i: number) =>
                  makeLocator({ innerText: async () => (i ? "0/100" : `Audit page ${pageIdx}`) }),
              });
            const rowsLoc = makeLocator({
              count: async () => (loading && emptyWhileLoading ? 0 : 1),
              nth: () =>
                makeLocator({
                  locator: () =>
                    makeLocator({
                      locator: () => makeLocator({ locator: cellsLoc }),
                    }),
                }),
            });
            const nextLoc = makeLocator({
              count: async () => 1,
              isVisible: async () => true,
              isEnabled: async () => pageIdx === 0 && !loading,
              click: async () => {
                loading = true;
                timer = setTimeout(() => {
                  pageIdx = 1;
                  loading = false;
                }, delayMs);
              },
            });
            const gridLoc = makeLocator({
              locator: (sel: string) =>
                sel.includes("Homework")
                  ? headersLoc
                  : sel.includes("ExpandMoreIcon")
                  ? rowsLoc
                  : sel.includes("next page")
                  ? nextLoc
                  : emptyLoc,
            });

            try {
              if (!fullWorker) {
                const sbScrape: any = {
                  console,
                  Date,
                  Error,
                  RegExp,
                  Set,
                  Map,
                  Array,
                  Object,
                  String,
                  Number,
                  Boolean,
                  Math,
                  Promise,
                  parseInt,
                  parseFloat,
                  isNaN: Number.isNaN,
                  setTimeout,
                  clearTimeout,
                };
                vm.createContext(sbScrape);
                vm.runInContext(
                  scrapeScoresJs + "\n;globalThis.ScoreScraper = ScoreScraper;",
                  sbScrape
                );
                const res = await sbScrape.ScoreScraper.scrapeFromDomGrid(
                  gridLoc,
                  cidR15,
                  new Map(),
                  new Map(),
                  (s: string) => s.toLowerCase()
                );
                return { rows: res.rows.length };
              }

              const backendCache = createRealSqliteBackendSandbox();
              try {
                backendCache.studentRepo.upsert({
                  classId: cidR15,
                  studentId: "S1",
                  fullName: "Audit page 0",
                  isActive: 1,
                });
                backendCache.studentRepo.upsert({
                  classId: cidR15,
                  studentId: "S2",
                  fullName: "Audit page 1",
                  isActive: 0,
                });
                const pageMock = {
                  locator: () => gridLoc,
                  on() {},
                  off() {},
                  waitForTimeout: async () => {},
                };
                const sbWorker: any = {
                  console,
                  Date,
                  Error,
                  RegExp,
                  Set,
                  Map,
                  Array,
                  Object,
                  String,
                  Number,
                  Boolean,
                  Math,
                  Promise,
                  parseInt,
                  parseFloat,
                  isNaN: Number.isNaN,
                  setTimeout,
                  clearTimeout,
                  BrowserManager: { getInstance: () => ({ getPage: async () => pageMock }) },
                  authService: { ensureAuthenticated: async () => {} },
                  LmsHelpers: { openClassDrawer: async () => {}, switchDrawerTab: async () => {} },
                  SELECTORS: { tabs: { grading: [] } },
                  studentRepo: backendCache.studentRepo,
                  scoreMatrixRepo: { save() {} },
                  jobLogRepo: { add() {} },
                  createNetworkInterceptor: () => ({ dismissForbiddenToast: async () => {} }),
                };
                vm.createContext(sbWorker);
                vm.runInContext(
                  scrapeScoresJs + "\n;globalThis.ScoreScraper = ScoreScraper;",
                  sbWorker
                );
                const out = await sbWorker.ScoreScraper.scrapeClassScores(cidR15);
                return { success: out.success, rows: out.rows.length };
              } finally {
                backendCache.db.close();
              }
            } finally {
              clearTimeout(timer);
            }
          };

          const r1601 = await runR16DomScrape(650, false, false);
          assert.equal(r1601.rows, 2, "R16-01: Phân trang trễ 650ms vẫn phải thu thập đủ 2 trang");

          const r1602 = await runR16DomScrape(100, true, true);
          assert.equal(
            r1602.rows,
            2,
            "R16-02: Màn hình trống tạm thời khi tải trang tiếp theo không được hiểu nhầm là hết dữ liệu"
          );

          // R16-03: Stale INSUFFICIENT_INFO request must preserve newer approved draft
          {
            const backendR1603 = createRealSqliteBackendSandbox();
            try {
              backendR1603.studentRepo.upsert({
                classId: cidR15,
                studentId: "S1",
                fullName: "Audit S1",
                isActive: 1,
              });
              backendR1603.sessionFeedbackRepo.upsert({
                classId: cidR15,
                sessionId: sidR15,
                studentId: "S1",
                attendanceStatus: "PRESENT",
                teacherNote: "",
                finalText: "",
                status: "DRAFT",
              });
              const oldVer = JSON.parse(
                backendR1603.sessionFeedbackRepo.findOne(cidR15, sidR15, "S1")?.versionMetaJson ||
                  "{}"
              ).rowVer;

              await backendR1603.saveDraftPOST(
                new Request(
                  `http://127.0.0.1:3000/api/session-comments/save-draft?cid=newpage&rev=2&f=teacherNote,finalText&fbase=teacherNote:0,finalText:0`,
                  {
                    method: "POST",
                    headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
                    body: JSON.stringify({
                      classId: cidR15,
                      sessionId: sidR15,
                      studentId: "S1",
                      teacherNote: "LATEST TEACHER NOTE",
                      finalText: "LATEST APPROVED TEXT",
                    }),
                  }
                )
              );
              const curVer = JSON.parse(
                backendR1603.sessionFeedbackRepo.findOne(cidR15, sidR15, "S1")?.versionMetaJson ||
                  "{}"
              ).rowVer;
              const appRes = await backendR1603.approvePOST(
                new Request("http://127.0.0.1:3000/api/session-comments/approve", {
                  method: "POST",
                  headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
                  body: JSON.stringify({
                    classId: cidR15,
                    sessionId: sidR15,
                    studentId: "S1",
                    approvedText: "LATEST APPROVED TEXT",
                    expectedRowVer: curVer,
                  }),
                })
              );
              assert.equal(appRes.status, 200);

              let aiCalls = 0;
              const commentGenJs = transpileForVm("src/lib/gemini/comment-generator.ts");
              const sbGen1603: any = {
                console,
                JSON,
                Set,
                Map,
                Array,
                Object,
                String,
                Number,
                Boolean,
                RegExp,
                Error,
                Promise,
                sessionFeedbackRepo: backendR1603.sessionFeedbackRepo,
                studentRepo: backendR1603.studentRepo,
                getGeminiModel: () => ({
                  generateContent: async () => {
                    aiCalls++;
                    return { response: { text: () => JSON.stringify({ feedbacks: [] }) } };
                  },
                }),
              };
              vm.createContext(sbGen1603);
              vm.runInContext(
                commentGenJs + "\n;globalThis.CommentGenerator = CommentGenerator;",
                sbGen1603
              );

              await sbGen1603.CommentGenerator.generateBatchComments(
                {
                  classId: cidR15,
                  classCode: cidR15,
                  sessionId: sidR15,
                  sessionNumber: 1,
                  topic: "Synthetic",
                },
                [
                  {
                    studentId: "S1",
                    fullName: "Audit S1",
                    attendanceStatus: "PRESENT",
                    quickTags: [],
                    teacherNote: "",
                    expectedRowVer: oldVer,
                  },
                ]
              );

              const afterRow = backendR1603.sessionFeedbackRepo.findOne(cidR15, sidR15, "S1");
              assert.equal(aiCalls, 0);
              assert.equal(
                afterRow?.finalText,
                "LATEST APPROVED TEXT",
                "R16-03: Nhánh thiếu thông tin của yêu cầu cũ không được xóa mất bản đã duyệt mới hơn"
              );
              assert.equal(afterRow?.status, "APPROVED");
            } finally {
              backendR1603.db.close();
            }
          }

          // R16-04: Ignored edit in an already open second tab must display a conflict error banner
          {
            const backendR1604 = createRealSqliteBackendSandbox();
            try {
              backendR1604.studentRepo.upsert({
                classId: cidR15,
                studentId: "S1",
                fullName: "Audit S1",
                isActive: 1,
              });
              backendR1604.sessionFeedbackRepo.upsert({
                classId: cidR15,
                sessionId: sidR15,
                studentId: "S1",
                attendanceStatus: "PRESENT",
                teacherNote: "init",
                finalText: "init final",
                status: "DRAFT",
              });

              const makeTab = () =>
                createRound5Harness(
                  "src/app/session-comments/page.tsx",
                  "SessionCommentsPage",
                  "students,loadClassData,handleNoteChange,statusMessage",
                  async (url: string, opts?: any) => {
                    const fullUrl = String(url).startsWith("http")
                      ? String(url)
                      : `http://127.0.0.1:3000${url}`;
                    if (fullUrl.includes("/api/session-comments/list")) {
                      return backendR1604.listGET(
                        new Request(fullUrl, { headers: { host: "127.0.0.1:3000" } })
                      );
                    }
                    if (fullUrl.includes("/api/session-comments/save-draft")) {
                      return backendR1604.saveDraftPOST(
                        new Request(fullUrl, {
                          method: "POST",
                          headers: {
                            host: "127.0.0.1:3000",
                            "content-type": "application/json",
                            ...(opts?.headers || {}),
                          },
                          body: opts?.body,
                        })
                      );
                    }
                    return Response.json({ success: true, data: {} });
                  }
                );

              const tab1 = makeTab();
              const tab2 = makeTab();
              for (const t of [tab1, tab2]) {
                await t.flush();
                await t.context.api.loadClassData(cidR15, sidR15);
                await t.flush();
              }

              tab1.context.api.handleNoteChange("S1", "FIRST PAGE SAVED");
              await tab1.flush();

              tab2.context.api.handleNoteChange("S1", "SECOND PAGE FIRST EDIT");
              await tab2.flush();

              assert.equal(
                backendR1604.sessionFeedbackRepo.findOne(cidR15, sidR15, "S1")?.teacherNote,
                "FIRST PAGE SAVED"
              );
              assert.equal(
                tab2.context.api.statusMessage?.type,
                "error",
                "R16-04: Khi chỉnh sửa ở tab thứ 2 bị từ chối do xung đột phiên bản, UI phải hiển thị cảnh báo lỗi rõ ràng"
              );
            } finally {
              backendR1604.db.close();
            }
          }

          // R16-05: Eligibility change during editor fill (before Save click) must prevent clicking Save on LMS
          {
            const backendR1605 = createRealSqliteBackendSandbox();
            try {
              backendR1605.studentRepo.upsert({
                classId: cidR15,
                studentId: "S1",
                fullName: "Audit S1",
                isActive: 1,
              });
              backendR1605.sessionFeedbackRepo.upsert({
                classId: cidR15,
                sessionId: sidR15,
                studentId: "S1",
                attendanceStatus: "PRESENT",
                finalText: "old final",
                contentHash: backendR1605.calculateSha256("old final"),
                status: "APPROVED",
              });

              let saveClicks = 0;
              let readback = "old final";
              const loc1605 = (selector = ""): any =>
                makeLocator({
                  count: async () => 1,
                  isVisible: async () => true,
                  isEnabled: async () => true,
                  getAttribute: async () =>
                    selector.includes("data-student-id") ? "S1" : "active",
                  innerText: async () => readback,
                  locator: (s: string) => loc1605(s),
                  click: async () => {
                    if (selector.includes('has-text("Save")')) {
                      saveClicks++;
                    }
                  },
                  evaluate: async (_fn: any, val: any) => {
                    if (val !== undefined) {
                      readback = val;
                      await backendR1605.saveDraftPOST(
                        new Request("http://127.0.0.1:3000/api/session-comments/save-draft", {
                          method: "POST",
                          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
                          body: JSON.stringify({
                            classId: cidR15,
                            sessionId: sidR15,
                            studentId: "S1",
                            attendanceStatus: "ABSENT",
                          }),
                        })
                      );
                    }
                    return true;
                  },
                });

              const sbSave1605: any = {
                console,
                Date,
                Error,
                RegExp,
                Set,
                Map,
                Array,
                Object,
                String,
                Number,
                Boolean,
                parseInt,
                BrowserManager: {
                  getInstance: () => ({
                    getPage: async () => ({
                      locator: (s: string) => loc1605(s),
                      waitForTimeout: async () => {},
                      keyboard: { press: async () => {} },
                      screenshot: async () => {},
                    }),
                  }),
                },
                authService: { ensureAuthenticated: async () => {} },
                LmsHelpers: { openClassDrawer: async () => {}, switchDrawerTab: async () => {} },
                SELECTORS: { tabs: { comments: [] } },
                jobLogRepo: { add() {} },
                verifyContentIntegrity: (txt: string, hash: string) =>
                  backendR1605.calculateSha256(txt) === hash,
                createNetworkInterceptor: () => ({
                  dismissForbiddenToast: async () => {},
                  waitForApiResponse: async () => ({
                    status: () => 200,
                    json: async () => ({ data: {} }),
                  }),
                }),
                studentRepo: backendR1605.studentRepo,
                sessionFeedbackRepo: backendR1605.sessionFeedbackRepo,
              };
              vm.createContext(sbSave1605);
              vm.runInContext(
                saveJs + "\n;globalThis.CommentSaver = CommentSaver;",
                sbSave1605
              );

              const out1605 = await sbSave1605.CommentSaver.saveComments({
                classId: cidR15,
                classCode: cidR15,
                sessionId: sidR15,
              });
              assert.equal(
                saveClicks,
                0,
                "R16-05: Không được bấm nút Save LMS nếu học viên đã chuyển sang ABSENT ngay trước khi bấm Save"
              );
              assert.equal(out1605.verifiedCount, 0);
              assert.equal(
                backendR1605.sessionFeedbackRepo.findOne(cidR15, sidR15, "S1")?.status,
                "DRAFT"
              );
            } finally {
              backendR1605.db.close();
            }
          }

          // R17-01 & R17-02: Approved/Verified rows protected before every AI branch; insufficient-info response preserves existing draft
          {
            const commentGenJs = transpileForVm("src/lib/gemini/comment-generator.ts");
            for (const status1701 of ["APPROVED", "VERIFIED"] as const) {
              for (const withTags of [false, true]) {
                const backendR1701 = createRealSqliteBackendSandbox();
                try {
                  backendR1701.studentRepo.upsert({
                    classId: cidR15,
                    studentId: "S1",
                    fullName: "Audit S1",
                    isActive: 1,
                  });
                  backendR1701.sessionFeedbackRepo.upsert({
                    classId: cidR15,
                    sessionId: sidR15,
                    studentId: "S1",
                    attendanceStatus: "PRESENT",
                    strengths: "APPROVED STRENGTH",
                    improvements: "APPROVED IMPROVEMENT",
                    actionPlan: "APPROVED PLAN",
                    finalText: "APPROVED TEACHER TEXT",
                    contentHash: backendR1701.calculateSha256("APPROVED TEACHER TEXT"),
                    status: status1701,
                    verifiedAt: "2026-10-20T00:00:00Z",
                  });
                  const beforeSnap = JSON.stringify(
                    backendR1701.sessionFeedbackRepo.findOne(cidR15, sidR15, "S1")
                  );
                  const curVer = JSON.parse(
                    backendR1701.sessionFeedbackRepo.findOne(cidR15, sidR15, "S1")
                      ?.versionMetaJson || "{}"
                  ).rowVer;
                  let aiCalls = 0;
                  const sbGen1701: any = {
                    console,
                    JSON,
                    Set,
                    Map,
                    Array,
                    Object,
                    String,
                    Number,
                    Boolean,
                    RegExp,
                    Error,
                    Promise,
                    sessionFeedbackRepo: backendR1701.sessionFeedbackRepo,
                    studentRepo: backendR1701.studentRepo,
                    getGeminiModel: () => ({
                      generateContent: async () => {
                        aiCalls++;
                        return {
                          response: {
                            text: () =>
                              JSON.stringify({
                                feedbacks: [
                                  {
                                    anonymousId: "STUDENT_01",
                                    strengths: "AI S",
                                    improvements: "AI I",
                                    actionPlan: "AI A",
                                    formattedFullComment: "AI RESULT",
                                  },
                                ],
                              }),
                          },
                        };
                      },
                    }),
                  };
                  vm.createContext(sbGen1701);
                  vm.runInContext(
                    commentGenJs + "\n;globalThis.CommentGenerator = CommentGenerator;",
                    sbGen1701
                  );
                  const res1701 = await sbGen1701.CommentGenerator.generateBatchComments(
                    {
                      classId: cidR15,
                      classCode: cidR15,
                      sessionId: sidR15,
                      sessionNumber: 1,
                      topic: "Synthetic",
                    },
                    [
                      {
                        studentId: "S1",
                        fullName: "Audit S1",
                        attendanceStatus: "PRESENT",
                        quickTags: withTags ? ["focused"] : [],
                        teacherNote: "",
                        expectedRowVer: curVer,
                      },
                    ]
                  );
                  const afterSnap = JSON.stringify(
                    backendR1701.sessionFeedbackRepo.findOne(cidR15, sidR15, "S1")
                  );
                  assert.equal(
                    aiCalls,
                    0,
                    `R17-01 (${status1701}, tags=${withTags}): Không được gọi AI cho bản ghi đã duyệt`
                  );
                  assert.equal(res1701[0]?.staleIgnored, true);
                  assert.equal(
                    afterSnap,
                    beforeSnap,
                    `R17-01 (${status1701}, tags=${withTags}): Bản ghi đã duyệt phải giữ nguyên tuyệt đối`
                  );
                } finally {
                  backendR1701.db.close();
                }
              }
            }

            // R17-02: No-information branch preserves existing draft in both response and UI state
            const backendR1702 = createRealSqliteBackendSandbox();
            try {
              backendR1702.studentRepo.upsert({
                classId: cidR15,
                studentId: "S1",
                fullName: "Audit S1",
                isActive: 1,
              });
              backendR1702.sessionFeedbackRepo.upsert({
                classId: cidR15,
                sessionId: sidR15,
                studentId: "S1",
                attendanceStatus: "PRESENT",
                quickTagsJson: "[]",
                teacherNote: "",
                strengths: "OLD STRENGTH",
                improvements: "OLD IMPROVEMENT",
                actionPlan: "OLD PLAN",
                finalText: "TEACHER DRAFT TO PRESERVE",
                status: "DRAFT",
              });
              let aiCalls1702 = 0;
              const sbGen1702: any = {
                console,
                JSON,
                Set,
                Map,
                Array,
                Object,
                String,
                Number,
                Boolean,
                RegExp,
                Error,
                Promise,
                sessionFeedbackRepo: backendR1702.sessionFeedbackRepo,
                studentRepo: backendR1702.studentRepo,
                getGeminiModel: () => ({
                  generateContent: async () => {
                    aiCalls1702++;
                    return { response: { text: () => JSON.stringify({ feedbacks: [] }) } };
                  },
                }),
              };
              vm.createContext(sbGen1702);
              vm.runInContext(
                commentGenJs + "\n;globalThis.CommentGenerator = CommentGenerator;",
                sbGen1702
              );

              const ui1702 = createRound5Harness(
                "src/app/session-comments/page.tsx",
                "SessionCommentsPage",
                "students,loadClassData,handleGenerateAi,statusMessage",
                async (url: string, opts?: any) => {
                  const fullUrl = String(url).startsWith("http")
                    ? String(url)
                    : `http://127.0.0.1:3000${url}`;
                  if (fullUrl.includes("/api/session-comments/generate-ai")) {
                    const body = JSON.parse(opts.body);
                    const genData = await sbGen1702.CommentGenerator.generateBatchComments(
                      body.session,
                      body.students
                    );
                    return Response.json({ success: true, data: genData });
                  }
                  if (fullUrl.includes("/api/session-comments/list")) {
                    return backendR1702.listGET(
                      new Request(fullUrl, { headers: { host: "127.0.0.1:3000" } })
                    );
                  }
                  if (fullUrl.includes("/api/session-comments/save-draft")) {
                    return backendR1702.saveDraftPOST(
                      new Request(fullUrl, {
                        method: "POST",
                        headers: {
                          host: "127.0.0.1:3000",
                          "content-type": "application/json",
                          ...(opts?.headers || {}),
                        },
                        body: opts?.body,
                      })
                    );
                  }
                  return Response.json({ success: true, data: {} });
                }
              );
              await ui1702.flush();
              await ui1702.context.api.loadClassData(cidR15, sidR15);
              await ui1702.flush();
              await ui1702.context.api.handleGenerateAi();
              await ui1702.flush();

              const row1702 = backendR1702.sessionFeedbackRepo.findOne(cidR15, sidR15, "S1");
              const st1702 = ui1702.context.api.students[0];
              assert.equal(aiCalls1702, 0);
              assert.equal(row1702?.finalText, "TEACHER DRAFT TO PRESERVE");
              assert.equal(
                st1702?.finalText,
                "TEACHER DRAFT TO PRESERVE",
                "R17-02: UI và phản hồi API phải giữ nguyên finalText đã có khi thiếu dữ kiện"
              );
              assert.equal(st1702?.strengths, "OLD STRENGTH");
              assert.equal(st1702?.improvements, "OLD IMPROVEMENT");
              assert.equal(st1702?.actionPlan, "OLD PLAN");
            } finally {
              backendR1702.db.close();
            }
          }

          // R17-03: Partial GraphQL response missing inactive student must fail and preserve complete SQLite cache
          {
            for (const isComplete of [true, false]) {
              const backendR1703 = createRealSqliteBackendSandbox();
              try {
                const roster1703 = [
                  { studentId: "S1", fullName: "Audit S1", isActive: 1 },
                  { studentId: "S2", fullName: "Audit S2", isActive: 0 },
                ];
                for (const st of roster1703) {
                  backendR1703.studentRepo.upsert({ ...st, classId: cidR15 });
                }
                const savedCache = {
                  success: true,
                  classId: cidR15,
                  columns: [{ columnId: "OLD" }],
                  rows: roster1703.map((st) => ({
                    ...st,
                    cells: {
                      OLD: { columnId: "OLD", status: "GRADED", score: 80, maxScore: 100 },
                    },
                  })),
                };
                backendR1703.db
                  .prepare(
                    "INSERT OR REPLACE INTO score_matrix_cache (classId, matrixJson) VALUES (?, ?)"
                  )
                  .run(cidR15, JSON.stringify(savedCache));
                const cacheBefore = backendR1703.db
                  .prepare("SELECT matrixJson FROM score_matrix_cache WHERE classId = ?")
                  .get(cidR15) as any;

                let responseListener1703: any = null;
                let emitted1703 = false;
                let writes1703 = 0;
                const emptyLoc1703 = (): any => ({
                  first() {
                    return this;
                  },
                  nth: () => emptyLoc1703(),
                  locator: () => emptyLoc1703(),
                  filter() {
                    return this;
                  },
                  count: async () => 0,
                  isVisible: async () => false,
                  isEnabled: async () => false,
                  getAttribute: async () => null,
                  innerText: async () => "",
                  click: async () => {},
                  waitFor: async () => {},
                  scrollIntoViewIfNeeded: async () => {},
                });
                const page1703: any = {
                  locator: () => emptyLoc1703(),
                  on: (_e: string, fn: any) => {
                    responseListener1703 = fn;
                  },
                  off: () => {},
                  waitForTimeout: async () => {
                    if (emitted1703 || !responseListener1703) return;
                    emitted1703 = true;
                    await responseListener1703({
                      url: () => "https://lms-api.mindx.edu.vn/",
                      status: () => 200,
                      request: () => ({
                        method: () => "POST",
                        postDataJSON: () => ({
                          operationName: "FindStudentSubmissionByClass",
                          variables: { payload: { classId: cidR15 } },
                        }),
                      }),
                      json: async () => ({
                        data: {
                          findStudentSubmissionByClass: {
                            classCode: cidR15,
                            lessons: [{ id: "L1", name: "Homework 1", displayOrder: 1 }],
                            students: (isComplete ? roster1703 : roster1703.slice(0, 1)).map(
                              (st) => ({
                                studentUid: st.studentId,
                                displayName: st.fullName,
                              })
                            ),
                            submissions: [],
                          },
                        },
                      }),
                    });
                  },
                };
                const sbScrape1703: any = {
                  console,
                  Date,
                  Math,
                  Map,
                  Set,
                  JSON,
                  RegExp,
                  Error,
                  Array,
                  Object,
                  Number,
                  String,
                  Boolean,
                  parseInt,
                  Promise,
                  setTimeout,
                  clearTimeout,
                  BrowserManager: { getInstance: () => ({ getPage: async () => page1703 }) },
                  authService: { ensureAuthenticated: async () => {} },
                  LmsHelpers: { openClassDrawer: async () => {}, switchDrawerTab: async () => {} },
                  SELECTORS: { tabs: { grading: [] } },
                  studentRepo: backendR1703.studentRepo,
                  scoreMatrixRepo: {
                    save: (id: string, val: any) => {
                      writes1703++;
                      backendR1703.db
                        .prepare(
                          "INSERT OR REPLACE INTO score_matrix_cache (classId, matrixJson) VALUES (?, ?)"
                        )
                        .run(id, JSON.stringify(val));
                    },
                  },
                  jobLogRepo: { add: () => {} },
                  createNetworkInterceptor: () => ({ dismissForbiddenToast: async () => {} }),
                };
                vm.createContext(sbScrape1703);
                vm.runInContext(
                  scrapeJs + "\n;globalThis.ScoreScraper = ScoreScraper;",
                  sbScrape1703
                );
                const out1703 = await sbScrape1703.ScoreScraper.scrapeClassScores(cidR15);
                const cacheAfter = backendR1703.db
                  .prepare("SELECT matrixJson FROM score_matrix_cache WHERE classId = ?")
                  .get(cidR15) as any;

                if (isComplete) {
                  assert.equal(out1703.success, true);
                  assert.equal(out1703.rows.length, 2);
                  assert.equal(writes1703, 1);
                } else {
                  assert.equal(
                    out1703.success,
                    false,
                    "R17-03: Phản hồi GraphQL thiếu học viên inactive phải thất bại"
                  );
                  assert.equal(writes1703, 0);
                  assert.equal(
                    cacheAfter?.matrixJson,
                    cacheBefore?.matrixJson,
                    "R17-03: Cache bảng điểm SQLite phải được bảo toàn nguyên vẹn khi GraphQL thiếu học viên"
                  );
                }
              } finally {
                backendR1703.db.close();
              }
            }
          }

          // R17-04: Quick-tag conflict must display the actual stored quickTags for comparison
          {
            const backendR1704 = createRealSqliteBackendSandbox();
            try {
              backendR1704.studentRepo.upsert({
                classId: cidR15,
                studentId: "S1",
                fullName: "Audit S1",
                isActive: 1,
              });
              backendR1704.sessionFeedbackRepo.upsert({
                classId: cidR15,
                sessionId: sidR15,
                studentId: "S1",
                attendanceStatus: "PRESENT",
                status: "DRAFT",
              });

              const makeTab1704 = () =>
                createRound5Harness(
                  "src/app/session-comments/page.tsx",
                  "SessionCommentsPage",
                  "students,loadClassData,toggleQuickTag,statusMessage",
                  async (url: string, opts?: any) => {
                    const fullUrl = String(url).startsWith("http")
                      ? String(url)
                      : `http://127.0.0.1:3000${url}`;
                    if (fullUrl.includes("/api/session-comments/list")) {
                      return backendR1704.listGET(
                        new Request(fullUrl, { headers: { host: "127.0.0.1:3000" } })
                      );
                    }
                    if (fullUrl.includes("/api/session-comments/save-draft")) {
                      return backendR1704.saveDraftPOST(
                        new Request(fullUrl, {
                          method: "POST",
                          headers: {
                            host: "127.0.0.1:3000",
                            "content-type": "application/json",
                            ...(opts?.headers || {}),
                          },
                          body: opts?.body,
                        })
                      );
                    }
                    return Response.json({ success: true, data: {} });
                  }
                );
              const tabA = makeTab1704();
              const tabB = makeTab1704();
              for (const t of [tabA, tabB]) {
                await t.flush();
                await t.context.api.loadClassData(cidR15, sidR15);
                await t.flush();
              }

              tabA.context.api.toggleQuickTag("S1", "SAVED_TAG_A");
              await tabA.flush();
              tabB.context.api.toggleQuickTag("S1", "UNSAVED_TAG_B");
              await tabB.flush();

              const msg1704 = tabB.context.api.statusMessage;
              assert.equal(msg1704?.type, "error");
              assert.equal(
                String(msg1704?.text || "").includes("SAVED_TAG_A"),
                true,
                "R17-04: Cảnh báo xung đột Quick Tags phải hiển thị đúng thẻ đã lưu ('SAVED_TAG_A')"
              );
              assert.equal(
                JSON.stringify(tabB.context.api.students[0]?.quickTags),
                JSON.stringify(["UNSAVED_TAG_B"])
              );
              assert.equal(
                backendR1704.sessionFeedbackRepo.findOne(cidR15, sidR15, "S1")?.quickTagsJson,
                JSON.stringify(["SAVED_TAG_A"])
              );
            } finally {
              backendR1704.db.close();
            }
          }
        }
      }

      memDb7.close();
    }
  }

  // R5-03: All 14 watched fields across variables, payload, and input with null value must be rejected by requestPredicate
  {
    let capturedPredR503: ((body: string) => boolean) | null = null;
    const locR503 = (): any => ({
      first() {
        return this;
      },
      locator: () => locR503(),
      filter() {
        return this;
      },
      waitFor: async () => {},
      scrollIntoViewIfNeeded: async () => {},
      isVisible: async () => true,
      getAttribute: async () => "active",
      click: async () => {},
      evaluate: async () => true,
      innerText: async () => "FIRST_30_CHARS_SAME_1234567890 EXPECTED TAIL",
    });
    const sbR503: any = {
      console,
      Date,
      Math,
      Map,
      Set,
      JSON,
      RegExp,
      Error,
      Array,
      Object,
      Number,
      String,
      Boolean,
      parseInt,
      BrowserManager: {
        getInstance: () => ({
          getPage: async () => ({
            locator: locR503,
            waitForTimeout: async () => {},
            keyboard: { press: async () => {} },
            screenshot: async () => {},
          }),
        }),
      },
      authService: { ensureAuthenticated: async () => {} },
      LmsHelpers: { openClassDrawer: async () => {}, switchDrawerTab: async () => {} },
      SELECTORS: { tabs: { comments: "" } },
      jobLogRepo: { add() {} },
      verifyContentIntegrity: () => true,
      createNetworkInterceptor: () => ({
        dismissForbiddenToast: async () => {},
        waitForApiResponse: async (_url: any, opts: any) => {
          capturedPredR503 = opts.requestPredicate;
          return { status: () => 200 };
        },
      }),
      studentRepo: {
        findOne: () => ({ studentId: "S1", classId: "CLASS_A", fullName: "Nguyễn An", isActive: 1 }),
        findByClass: () => [{ studentId: "S1", classId: "CLASS_A", fullName: "Nguyễn An", isActive: 1 }],
      },
      sessionFeedbackRepo: {
        findBySession: () => [
          {
            classId: "CLASS_A",
            sessionId: "CLASS_A_SESS_01",
            studentId: "S1",
            finalText: "FIRST_30_CHARS_SAME_1234567890 EXPECTED TAIL",
            contentHash: "H",
            status: "APPROVED",
          },
        ],
        findOne: () => ({
          classId: "CLASS_A",
          sessionId: "CLASS_A_SESS_01",
          studentId: "S1",
          finalText: "FIRST_30_CHARS_SAME_1234567890 EXPECTED TAIL",
          contentHash: "H",
          status: "APPROVED",
        }),
        updateStatus: () => {},
      },
    };
    vm.createContext(sbR503);
    vm.runInContext(saveJs + "\n;globalThis.CommentSaver = CommentSaver;", sbR503);
    await sbR503.CommentSaver.saveComments({
      classId: "CLASS_A",
      classCode: "CLASS_A",
      sessionId: "CLASS_A_SESS_01",
    });
    assert.equal(typeof capturedPredR503, "function");

    const watchedFields = [
      "classCode",
      "className",
      "classId",
      "sessionId",
      "slotId",
      "slotNumber",
      "sessionNumber",
      "slotIndex",
      "studentId",
      "studentUid",
      "userId",
      "comment",
      "content",
      "note",
      "feedback",
    ];
    for (const field of watchedFields) {
      const baseStudentId = field === "studentId" ? { studentUid: "S1" } : { studentId: "S1" };
      for (const container of ["variables", "payload", "input"] as const) {
        const varsObj: any =
          container === "variables"
            ? { ...baseStudentId, [field]: null }
            : { ...baseStudentId, [container]: { [field]: null } };
        assert.equal(
          capturedPredR503!(JSON.stringify({ operationName: "SaveSlotComment", variables: varsObj })),
          false,
          `R5-03: Trường ${container}.${field} = null phải bị từ chối`
        );
      }
    }
  }

  console.log("   [PASS] Round 2 (R2-01–R2-11 / A01–A14), Round 3 (R3-01–R3-07), Round 4 (R4-01–R4-06), Round 5 (R5-01–R5-04), Round 6 (R6-01), Round 7 (R7-01), Round 8 (R8-01), Round 9 (R9-01), Round 10 (R10-01), Round 11 (R11-01), Round 12 (R12-01), Round 15 (R15-01–R15-07), Round 16 (R16-01–R16-05), Round 17 (R17-01–R17-04) & Finding #10");
  console.log("\n✅ TẤT CẢ CÁC MỤC KIỂM TRA (ROUND 1 -> ROUND 17) ĐỀU ĐẠT 100%!");
}

runTests().catch((err) => {
  console.error("❌ TEST FAILED:", err);
  process.exit(1);
});
