import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import crypto from "node:crypto";
import { verifyContentIntegrity } from "../src/lib/db/sqlite";

function generateContentHash(text: string): string {
  return crypto.createHash("sha256").update(String(text || "").trim(), "utf8").digest("hex");
}

function transpileForVm(relPath: string): string {
  const fullPath = path.resolve(process.cwd(), relPath);
  const raw = fs.readFileSync(fullPath, "utf8");
  const stripped = stripTypeScriptTypes(raw);
  return (
    stripped
      .replace(/^\s*import\s+[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
      .replace(/\bexport\s+/g, "") + "\nglobalThis.CommentSaver = CommentSaver;"
  );
}

interface CheckpointSimOptions {
  openInViewModeFirst: boolean;
  checkedRadioCount: number;
  graphqlRejectRequired?: boolean;
  graphqlThrowOnWait?: boolean;
}

async function runCheckpointSimulation(opts: CheckpointSimOptions) {
  const code = transpileForVm("src/lib/playwright/save-comments.ts");

  const expectedComment = [
    "- **Điểm mạnh của học viên:** Con nắm vững kiến thức **Vòng lặp & Hàm trong Python**, hoàn thành tốt phần kiểm tra.",
    "",
    "- **Điểm cần cải thiện:** Con cần rèn thêm **thao tác kiểm tra biên** để tránh sót trường hợp.",
    "",
    "- **Lời khuyên:** Ba mẹ nhắc con **ôn lại các bài tập tổng hợp** ở nhà.",
  ].join("\n");
  const expectedPlain = expectedComment.replace(/\*\*([^*\n]+)\*\*/g, "$1");
  const validHash = generateContentHash(expectedComment);

  let currentDbRecord: any = {
    classId: "VT-C4K-PTA12",
    sessionId: "VT-C4K-PTA12_SESS_05",
    studentId: "ST_PHUC_KIEN",
    attendanceStatus: "PRESENT",
    finalText: expectedComment,
    contentHash: validHash,
    status: "APPROVED",
  };

  const statusUpdates: Array<{ status: string; errorMessage: string | null }> = [];
  let openModalClicks = 0;
  let editModeExpanded = !opts.openInViewModeFirst;
  let savedEditorText = "";
  let radioClicks = 0;
  let textareaTouched = 0;
  let switchClicks = 0;
  let saveClicks = 0;

  const checkpointSummaryText =
    "Điểm lý thuyết\n8\nĐiểm thực hành\n9\nĐiểm năng lực\n7.3\nKIẾN THỨC\nKỸ NĂNG\nTHÁI ĐỘ";

  const makeLoc = (selector: string): any => {
    const obj: any = {
      first: () => obj,
      nth: () => obj,
      locator: (sub: string) => makeLoc(`${selector} >> ${sub}`),
      filter: () => obj,
      count: async () => {
        if (selector.includes('input[type="radio"]:checked')) {
          return editModeExpanded ? opts.checkedRadioCount : 0;
        }
        if (selector.includes('input[type="radio"]')) {
          return editModeExpanded ? 46 : 0;
        }
        if (selector.endsWith(">> textarea") || selector === "textarea") {
          return editModeExpanded ? 20 : 0;
        }
        return 1;
      },
      waitFor: async () => {},
      scrollIntoViewIfNeeded: async () => {},
      hover: async () => {},
      isVisible: async () => {
        if (
          selector.includes(".ql-editor") &&
          !selector.includes("textarea")
        ) {
          return editModeExpanded;
        }
        if (selector.includes("table tbody tr")) {
          return !editModeExpanded;
        }
        if (selector.includes("EditIcon") || selector.includes('button:has-text("Edit")')) {
          return !editModeExpanded;
        }
        if (selector.includes("switch to manual mode")) {
          return true;
        }
        return true;
      },
      isEnabled: async () => true,
      getAttribute: async (attr: string) => {
        if (attr === "class") return "slot-item active";
        if (attr === "data-student-id") return "ST_PHUC_KIEN";
        return "";
      },
      click: async () => {
        if (selector.includes('button:has-text("Nhận xét học sinh")')) {
          openModalClicks++;
          if (openModalClicks === 1) {
            editModeExpanded = !opts.openInViewModeFirst;
          } else {
            // Re-opening after Save on a Checkpoint session always starts in View Mode on MindX LMS!
            editModeExpanded = false;
          }
          return;
        }
        if (
          selector.includes("EditIcon") ||
          selector.includes("table tbody tr")
        ) {
          editModeExpanded = true;
          return;
        }
        if (selector.includes('input[type="radio"]')) {
          radioClicks++;
          return;
        }
        if (/\btextarea\b/i.test(selector)) {
          textareaTouched++;
          return;
        }
        if (selector.includes("switch to manual mode")) {
          switchClicks++;
          return;
        }
        if (selector.includes('button:has-text("Save")')) {
          saveClicks++;
          return;
        }
      },
      evaluate: async (_fn: any, arg?: any) => {
        if (selector.includes("class-comments-slot-carousel")) {
          return true;
        }
        if (/\btextarea\b/i.test(selector)) {
          textareaTouched++;
          return;
        }
        if (selector.includes(".ql-editor") && typeof arg === "string") {
          savedEditorText = arg.replace(/\*\*([^*\n]+)\*\*/g, "$1");
          return;
        }
        return true;
      },
      innerText: async () => {
        if (selector.includes(".ql-editor") || selector.includes(".comment-content")) {
          return savedEditorText;
        }
        if (selector.includes("table tbody tr")) {
          return checkpointSummaryText;
        }
        return "ST_PHUC_KIEN\nNguyễn Phúc Kiên\nAttended";
      },
      textContent: async () => savedEditorText,
      inputValue: async () => "",
    };
    return obj;
  };

  const pageMock = {
    locator: (sel: string) => makeLoc(sel),
    waitForTimeout: async () => {},
    keyboard: {
      press: async () => {},
      insertText: async () => {},
    },
    screenshot: async () => {},
  };

  const sandbox: any = {
    module: { exports: {} },
    exports: {},
    console,
    Date,
    Math,
    Promise,
    Set,
    Map,
    RegExp,
    Error,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    parseInt,
    BrowserManager: {
      getInstance: () => ({
        getPage: async () => pageMock,
      }),
    },
    authService: {
      ensureAuthenticated: async () => {},
    },
    LmsHelpers: {
      openClassDrawer: async () => {},
      switchDrawerTab: async () => {},
      ensureCleanDialogAndToast: async () => {},
      ensureCommentsSlotReady: async () => {},
    },
    SELECTORS: {
      tabs: { comments: "Comments" },
    },
    createNetworkInterceptor: () => ({
      dismissForbiddenToast: async () => {},
      waitForApiResponse: async (_urlRe: RegExp, waitOpts: any) => {
        if (opts.checkedRadioCount === 0 && !opts.graphqlRejectRequired && !opts.graphqlThrowOnWait) {
          throw new Error("Timeout 15000ms exceeded waiting for API response");
        }
        const validPayload = JSON.stringify({
          operationName: "UpdateSlotComment",
          variables: {
            payload: {
              classCode: "VT-C4K-PTA12",
              slotNumber: 5,
              studentId: "ST_PHUC_KIEN",
              comment: expectedPlain,
            },
          },
        });
        assert.strictEqual(waitOpts.requestPredicate(validPayload), true);
        if (opts.graphqlThrowOnWait) {
          throw new Error(
            "[NetworkInterceptor] GraphQL Error on https://lms.mindx.edu.vn/graphql: Competency score is required for checkpoint slot"
          );
        }
        return {
          status: () => 200,
          json: async () =>
            opts.graphqlRejectRequired
              ? { errors: [{ message: "Competency score is required for checkpoint slot" }] }
              : { data: { updateSlotComment: { id: "ok" } } },
        };
      },
    }),
    sessionFeedbackRepo: {
      findOne: () => ({ ...currentDbRecord }),
      findBySession: () => [{ ...currentDbRecord }],
      updateStatus: (
        _cid: string,
        _sid: string,
        _stid: string,
        status: string,
        _verifiedAt: string | null,
        errorMessage: string | null
      ) => {
        statusUpdates.push({ status, errorMessage });
        currentDbRecord = { ...currentDbRecord, status, errorMessage };
        return true;
      },
    },
    studentRepo: {
      findOne: () => ({
        studentId: "ST_PHUC_KIEN",
        classId: "VT-C4K-PTA12",
        fullName: "Nguyễn Phúc Kiên",
        isActive: 1,
      }),
      findByClass: () => [
        {
          studentId: "ST_PHUC_KIEN",
          classId: "VT-C4K-PTA12",
          fullName: "Nguyễn Phúc Kiên",
          isActive: 1,
        },
      ],
    },
    jobLogRepo: {
      add: () => {},
    },
    verifyContentIntegrity: (txt: string, h: string) => generateContentHash(txt) === h,
    getCoursesSyllabus: () => [],
    config: {},
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const CommentSaver = sandbox.CommentSaver;
  const batchRes = await CommentSaver.saveComments({
    classId: "VT-C4K-PTA12",
    classCode: "VT-C4K-PTA12",
    sessionId: "VT-C4K-PTA12_SESS_05",
  });

  return {
    batchRes,
    currentDbRecord,
    statusUpdates,
    radioClicks,
    textareaTouched,
    switchClicks,
    saveClicks,
    openModalClicks,
  };
}

async function runAllCheckpointTests() {
  console.log("=== BẮT ĐẦU KIỂM THỬ LƯU NHẬN XÉT BUỔI CHECKPOINT (v3.0.0) ===");

  // CP-01: Checkpoint modal opens in Edit Mode (9 radios already ticked by teacher) -> Bot fills ONLY .ql-editor, expands View Mode on readback, marks VERIFIED
  const res1 = await runCheckpointSimulation({
    openInViewModeFirst: false,
    checkedRadioCount: 9,
  });
  assert.strictEqual(res1.batchRes.verifiedCount, 1, "CP-01: Phải lưu và xác minh VERIFIED thành công");
  assert.strictEqual(res1.currentDbRecord.status, "VERIFIED");
  assert.strictEqual(res1.radioClicks, 0, "CP-01: Tuyệt đối không được click bất kỳ radio năng lực nào");
  assert.strictEqual(res1.textareaTouched, 0, "CP-01: Tuyệt đối không được chạm vào 20 ô textarea năng lực");
  assert.strictEqual(res1.switchClicks, 0, "CP-01: Tuyệt đối không được bấm switch trên modal Checkpoint");

  // CP-02: Checkpoint modal opens in View Mode ("Điểm lý thuyết... Điểm năng lực...") -> Bot expands into Edit Mode both before Save and during Read-after-Write verification
  const res2 = await runCheckpointSimulation({
    openInViewModeFirst: true,
    checkedRadioCount: 9,
  });
  assert.strictEqual(
    res2.batchRes.verifiedCount,
    1,
    "CP-02: Khi modal Checkpoint đã lưu trước đó (mở ở View Mode), Bot phải tự bung Edit Mode để điền và đọc lại .ql-editor thành công"
  );
  assert.strictEqual(res2.currentDbRecord.status, "VERIFIED");
  assert.strictEqual(res2.radioClicks, 0);
  assert.strictEqual(res2.textareaTouched, 0);
  assert.strictEqual(res2.switchClicks, 0);

  // CP-03: Teacher hasn't ticked competency radios yet (0 checked, client validation blocks Save) -> Bot keeps status APPROVED, surfaces friendly message, 0 Pass-2 retries
  const res3 = await runCheckpointSimulation({
    openInViewModeFirst: false,
    checkedRadioCount: 0,
  });
  assert.strictEqual(res3.batchRes.failedCount, 1);
  assert.strictEqual(
    res3.currentDbRecord.status,
    "APPROVED",
    "CP-03: Khi thiếu điểm năng lực trên LMS, phải giữ nguyên trạng thái APPROVED để giáo viên tích xong bấm đẩy lại ngay"
  );
  assert.ok(
    res3.currentDbRecord.errorMessage.includes("Buổi Kiểm tra (Checkpoint)"),
    "CP-03: Thông báo lỗi phải nhắc rõ giáo viên tích Điểm Năng lực trên LMS trước"
  );
  assert.strictEqual(res3.saveClicks, 1, "CP-03: Không được chạy vét lại ở Lượt 2 (Pass 2)");

  // CP-04: GraphQL returns competency required error (both thrown by NetworkInterceptor.waitForApiResponse and in json body) -> same graceful handling
  const res4 = await runCheckpointSimulation({
    openInViewModeFirst: false,
    checkedRadioCount: 3,
    graphqlThrowOnWait: true,
  });
  assert.strictEqual(res4.currentDbRecord.status, "APPROVED");
  assert.ok(res4.currentDbRecord.errorMessage.includes("Buổi Kiểm tra (Checkpoint)"));
  assert.strictEqual(res4.saveClicks, 1);

  const res5 = await runCheckpointSimulation({
    openInViewModeFirst: false,
    checkedRadioCount: 3,
    graphqlRejectRequired: true,
  });
  assert.strictEqual(res5.currentDbRecord.status, "APPROVED");
  assert.ok(res5.currentDbRecord.errorMessage.includes("Buổi Kiểm tra (Checkpoint)"));
  assert.strictEqual(res5.saveClicks, 1);

  console.log("✅ TẤT CẢ KIỂM THỬ BUỔI CHECKPOINT (CP-01..CP-05) ĐỀU PASS 100%!");
}

runAllCheckpointTests().catch((err) => {
  console.error("❌ LỖI KIỂM THỬ CHECKPOINT v3.0.0:", err);
  process.exit(1);
});
