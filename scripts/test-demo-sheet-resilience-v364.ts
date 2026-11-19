/**
 * KIỂM THỬ CÔ LẬP v3.6.4 — CHỐNG HỤT AI KHI GOOGLE 503/429 & CHỐNG LỖI MỞ LẠNH GOOGLE TRANG TÍNH
 * Chạy 100% trong `os.tmpdir()`, bảo toàn tuyệt đối SHA-256 của dữ liệu thật.
 *
 * - V364-01: Phân loại lỗi tạm thời (503/429/502/504/network) vs lỗi vĩnh viễn (400/403/SyntaxError/Stop Bot),
 *            `callGeminiWithRetry`, bảo toàn `getGeminiModel().model` & `__rawGenerateContent`.
 * - V364-02: Mô phỏng lớp VT-CSI02 (4 HV) bị Google Gemini 503 nghẽn mạng đúng 2 bạn (Kim Đắc Trường, Đặng Quang Thảo)
 *            -> tự đợi & thử lại chấm đủ 4/4 bạn, bảo toàn 100% ẩn danh PII, + fallback an toàn khi hỏng đủ 4 lần.
 * - V364-03: Luồng chính Google Drive + Google Trang tính mở lạnh (rớt click đầu "+ Mới -> Google Trang tính",
 *            nút `[role="alertdialog"] [role="button"]` "Tạo và chia sẻ", rớt click đầu `#docs-file-menu`) -> thành công ngay lượt 1.
 * - V364-04: Luồng dự phòng "Lưu dưới dạng Google Trang tính":
 *            (A) Rớt 2 click đầu `#docs-file-menu` + hiện trễ menuitem -> tự phục hồi & dọn tệp tạm thành công, 0 unhandledRejection.
 *            (B) Menu "Lưu dưới dạng Google Trang tính" không tồn tại -> reject sạch & 0 unhandledRejection sau khi thoát.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { chromium } from "playwright";

const ROOT = process.cwd();

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-v364-resilience-"));
  const tempConfigDir = path.join(tempRoot, "config");
  const tempSpckRoot = path.join(tempRoot, "spck_root");
  const tempRoleDir = path.join(tempRoot, "role-state");

  fs.mkdirSync(path.join(tempConfigDir, "demo-sheet-templates"), { recursive: true });
  fs.mkdirSync(tempSpckRoot, { recursive: true });
  fs.mkdirSync(tempRoleDir, { recursive: true });

  const liveTemplatesDir = path.join(ROOT, "data", "config", "demo-sheet-templates");
  for (const file of fs.readdirSync(liveTemplatesDir)) {
    if (file.toLowerCase().endsWith(".xlsx")) {
      fs.copyFileSync(
        path.join(liveTemplatesDir, file),
        path.join(tempConfigDir, "demo-sheet-templates", file)
      );
    }
  }
  for (const cfgFile of ["default-demo-sheet-template.xlsx", "default-spck-thumbnail.png"]) {
    const srcPath = path.join(ROOT, "data", "config", cfgFile);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, path.join(tempConfigDir, cfgFile));
    }
  }

  process.env.MINDX_DB_PATH = path.join(tempRoot, "test_v364.db");
  process.env.MINDX_CONFIG_DIR = tempConfigDir;
  process.env.MINDX_RUNNING_CLASSES_PATH = path.join(tempRoot, "running_classes.json");
  process.env.MINDX_LMS_CLASS_IDS_PATH = path.join(tempConfigDir, "lms_class_ids.json");
  process.env.MINDX_ROLE_STATE_DIR = tempRoleDir;
  process.env.ALLOWED_LOCAL_DIRS = tempRoot;
  process.env.MINDX_ALLOW_LOCAL_SHEET_ORIGIN_FOR_TEST = "1";
  process.env.MINDX_DISABLE_BROWSER_EXPORT_FALLBACK = "1";
  process.env.GEMINI_API_KEY = "AIzaDummyTestKeyV364_NeverLive";

  const { getDb, studentRepo, spckUploadRepo } = await import("../src/lib/db/sqlite");
  const {
    MAX_GEMINI_RETRIES_CAP,
    callGeminiWithRetry,
    getGeminiClient,
    getGeminiModel,
    isTransientGeminiError,
  } = await import("../src/lib/gemini/client");
  const { generateDemoSheetAiPreScoresForClass, sanitizeRelatedLinkUrlForPrompt } = await import(
    "../src/lib/gemini/spck-demo-sheet-scorer"
  );
  const { parseSharedStringsXml } = await import(
    "../src/lib/local-files/spck-demo-score-reader"
  );
  const {
    buildDemoScoringWorkbookBuffer,
    createAndUploadClassDemoSheetToDrive,
    getDemoSheetTitleForClass,
    getSavedCourseTemplatePath,
  } = await import("../src/lib/playwright/spck-demo-sheet");
  const {
    CODING_SPCK_COURSE_FOLDER_MAP,
    DEFAULT_SPCK_DRIVE_FOLDER_URL,
  } = await import("../src/lib/playwright/spck-drive-uploader");

  const unhandledRejections: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandledRejections.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);

  let server: http.Server | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let context: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>["newContext"]>> | null = null;

  try {
    // =========================================================================
    // [V364-01] Error classification, callGeminiWithRetry & getGeminiModel
    // =========================================================================
    console.log("[V364-01] Kiểm tra phân loại lỗi 503/429, thử lại backoff & getGeminiModel...");
    assert.equal(
      isTransientGeminiError(
        new Error(
          "[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent: [503 ] This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later."
        )
      ),
      true
    );
    assert.equal(
      isTransientGeminiError(new Error("[429 ] Too Many Requests: rate limit exceeded")),
      true
    );
    assert.equal(isTransientGeminiError({ status: 502, message: "Bad Gateway" }), true);
    assert.equal(isTransientGeminiError(new Error("HTTP 504 DEADLINE_EXCEEDED")), true);
    assert.equal(isTransientGeminiError(new Error("TypeError: fetch failed")), true);

    assert.equal(isTransientGeminiError({ status: 400, message: "Bad Request" }), false);
    assert.equal(isTransientGeminiError(new Error("[403 ] API key not valid")), false);
    assert.equal(isTransientGeminiError(new SyntaxError("Unexpected token")), false);
    assert.equal(
      isTransientGeminiError(
        new Error("Đã dừng tác vụ gọi AI theo lệnh Dừng khẩn cấp (Stop Bot).")
      ),
      false
    );

    let transientAttempts = 0;
    const recoveredVal = await callGeminiWithRetry(
      async () => {
        transientAttempts += 1;
        if (transientAttempts <= 2) {
          throw new Error(
            "[503 ] This model is currently experiencing high demand. Spikes in demand are usually temporary."
          );
        }
        return "RECOVERED_OK";
      },
      { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 30, label: "v364-test-recover" }
    );
    assert.equal(recoveredVal, "RECOVERED_OK");
    assert.equal(transientAttempts, 3);

    let permAttempts = 0;
    await assert.rejects(
      () =>
        callGeminiWithRetry(
          async () => {
            permAttempts += 1;
            const e: any = new Error("API key not valid");
            e.status = 403;
            throw e;
          },
          { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 30 }
        ),
      /API key not valid/i
    );
    assert.equal(permAttempts, 1, "Lỗi vĩnh viễn 403 không được thử lại!");

    (process as any).__mindxQueueStopped = true;
    try {
      await assert.rejects(
        () =>
          callGeminiWithRetry(
            async () => {
              throw new Error("[503 ] overloaded");
            },
            { maxRetries: 3, baseDelayMs: 50, maxDelayMs: 100 }
          ),
        /Dừng khẩn cấp|Stop Bot/i
      );
    } finally {
      delete (process as any).__mindxQueueStopped;
    }

    const expectedSlug = (process.env.GEMINI_MODEL || "gemini-3.5-flash-lite").replace(
      /^models\//,
      ""
    );
    const modelObj = getGeminiModel(undefined, 0.2, "Bạn là trợ lý BGK") as any;
    assert.equal(modelObj.model, `models/${expectedSlug}`);
    assert.equal(typeof modelObj.__rawGenerateContent, "function");
    assert.equal(Object.keys(modelObj).includes("__rawGenerateContent"), false);
    console.log("  -> PASS [V364-01].");

    // =========================================================================
    // [V364-02] VT-CSI02 (4 HV) AI 503 recovery & full fallback isolation
    // =========================================================================
    console.log("[V364-02] Kiểm tra chấm nháp 4/4 HV lớp VT-CSI02 khi 2 bạn gặp lỗi Google 503...");
    const classId = "VT-CSI02";
    const db = getDb();
    db.prepare(
      `INSERT INTO classes_sessions (sessionId, classId, className, sessionNumber, date) VALUES (?, ?, ?, 14, '2026-11-22')`
    ).run(`${classId}_SESS_14`, classId, classId);

    const csiStudents = [
      { studentId: "STU_VT-CSI02_BUI_NGUYEN_NHAT_QUAN", fullName: "Bùi Nguyễn Nhật Quân" },
      { studentId: "STU_VT-CSI02_DANG_QUANG_THAO", fullName: "Đặng Quang Thảo" },
      { studentId: "STU_VT-CSI02_TRAN_MINH_KHANG", fullName: "Trần Minh Khang" },
      { studentId: "STU_VT-CSI02_KIM_DAC_TRUONG", fullName: "Kim Đắc Trường" },
    ];
    const csiClassDir = path.join(tempSpckRoot, "CSI02");
    fs.mkdirSync(csiClassDir, { recursive: true });

    for (const stu of csiStudents) {
      studentRepo.upsert({
        studentId: stu.studentId,
        classId,
        fullName: stu.fullName,
        isActive: 1,
      });
      const stuDir = path.join(csiClassDir, stu.fullName);
      fs.mkdirSync(stuDir, { recursive: true });
      fs.writeFileSync(
        path.join(stuDir, "main.py"),
        `# SPCK Project by student\nclass AppController:\n    def run(self):\n        print("Running project logic")\n`,
        "utf8"
      );
      spckUploadRepo.upsert({
        classId,
        studentId: stu.studentId,
        isConfirmedByTeacher: 1,
        projectTitle: `Hệ thống quản lý thông minh`,
        localFolderPath: stuDir,
        attachmentsJson: JSON.stringify([path.join(stuDir, "main.py")]),
        screenshotsJson: "[]",
        youtubeUrlsJson: "[]",
        relatedLinksJson: "[]",
        status: "VERIFIED",
      });
    }

    const csiTplPath = getSavedCourseTemplatePath(classId);
    assert.ok(csiTplPath && fs.existsSync(csiTplPath), "CSI.xlsx template must exist in test config");
    const csiTplBuf = fs.readFileSync(csiTplPath);

    const studentTabs = csiStudents.map((s) => ({
      studentId: s.studentId,
      fullName: s.fullName,
      tabName: s.fullName,
    }));

    const callCountsByToken = new Map<string, number>();
    const spikeTokens = new Set(["STUDENT_02", "STUDENT_04"]); // Thảo & Trường

    const aiRecovered = await generateDemoSheetAiPreScoresForClass({
      classId,
      studentTabs,
      templateBuffer: csiTplBuf,
      localClassFolderPath: csiClassDir,
      _testRetryOptions: {
        maxRetries: 3,
        baseDelayMs: 10,
        maxDelayMs: 30,
        interStudentDelayMs: 5,
      },
      _testAiScorerOverride: async ({ anonymousToken, promptText, scorableCriteria }) => {
        // Verify zero PII leaks in prompts sent to AI
        for (const s of csiStudents) {
          assert.equal(
            promptText.includes(s.fullName),
            false,
            `PII leak detected for '${s.fullName}' in ${anonymousToken} prompt!`
          );
        }
        const n = (callCountsByToken.get(anonymousToken) || 0) + 1;
        callCountsByToken.set(anonymousToken, n);
        if (spikeTokens.has(anonymousToken) && n <= 2) {
          throw new Error(
            "[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent: [503 ] This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later."
          );
        }
        return {
          criteria: scorableCriteria.map((c, idx) => ({
            rowNumber: c.rowNumber,
            rating: idx % 2 === 0 ? "Tốt" : "Hoàn thành",
            evidenceNote: `Hàm AppController.run() trong ${anonymousToken} xử lý luồng rõ ràng.`,
          })),
          bgkQuestions: [
            `Hỏi: Khi chạy hàm AppController.run() của ${anonymousToken}, con xử lý ngoại lệ thế nào? -> Gợi ý đáp án mong đợi: Kiểm tra đầu vào rỗng và thông báo trạng thái rõ ràng.`,
          ],
        };
      },
    });

    assert.equal(aiRecovered.preScoredCount, 4, "Phải tự thử lại và chấm đủ 4/4 học viên sau lỗi 503!");
    assert.equal(aiRecovered.skippedCount, 0);
    assert.equal(callCountsByToken.get("STUDENT_02"), 3);
    assert.equal(callCountsByToken.get("STUDENT_04"), 3);

    const csiWb = buildDemoScoringWorkbookBuffer({
      classId,
      sheetTitle: getDemoSheetTitleForClass(classId),
      demoDate: "2026-11-22",
      evalDate: "2026-11-22",
      studentTabs,
      templateBuffer: csiTplBuf,
      aiTabAnnotations: aiRecovered.byTabName,
    });
    const wbZip = new AdmZip(csiWb);
    const sst = wbZip.getEntry("xl/sharedStrings.xml")
      ? parseSharedStringsXml(wbZip.getEntry("xl/sharedStrings.xml")!.getData().toString("utf8"))
      : [];

    for (let sIdx = 1; sIdx <= 4; sIdx++) {
      const sheetXml = wbZip.getEntry(`xl/worksheets/sheet${sIdx}.xml`)!.getData().toString("utf8");
      const allColGMatches = Array.from(sheetXml.matchAll(/<c\b[^>]*\br="G\d+"[^>]*>([\s\S]*?)<\/c>/gi));
      const joinedG = allColGMatches
        .map((m) => {
          const body = m[1];
          const tMatch = body.match(/<t[^>]*>([\s\S]*?)<\/t>/i);
          if (tMatch) return tMatch[1];
          const vMatch = body.match(/<v>([^<]*)<\/v>/i);
          const idx = Number(vMatch?.[1] ?? -1);
          return idx >= 0 && idx < sst.length ? sst[idx] : vMatch?.[1] || "";
        })
        .join(" ");
      assert.ok(joinedG.includes("[AI gợi ý:"), `Tab ${sIdx} thiếu [AI gợi ý:] ở Cột G`);
      assert.ok(joinedG.includes("Hỏi:"), `Tab ${sIdx} thiếu câu hỏi BGK ở Cột G`);
    }

    // Also verify graceful fallback if 1 student permanently fails all 4 attempts with 503
    const aiPartial = await generateDemoSheetAiPreScoresForClass({
      classId,
      studentTabs,
      templateBuffer: csiTplBuf,
      localClassFolderPath: csiClassDir,
      _testRetryOptions: {
        maxRetries: 3,
        baseDelayMs: 5,
        maxDelayMs: 10,
        interStudentDelayMs: 2,
      },
      _testAiScorerOverride: async ({ anonymousToken, scorableCriteria }) => {
        if (anonymousToken === "STUDENT_04") {
          throw new Error("[503 ] This model is currently experiencing high demand.");
        }
        return {
          criteria: scorableCriteria.map((c) => ({
            rowNumber: c.rowNumber,
            rating: "Tốt",
            evidenceNote: "Hợp lệ.",
          })),
          bgkQuestions: ["Hỏi: Luồng chính? -> Gợi ý đáp án mong đợi: AppController.run()."],
        };
      },
    });
    assert.equal(aiPartial.preScoredCount, 3);
    assert.equal(aiPartial.skippedCount, 1);
    const fallbackTab = aiPartial.byTabName["Kim Đắc Trường"];
    assert.ok(fallbackTab);
    for (const ann of Object.values(fallbackTab.criteriaByRow)) {
      assert.equal(ann.rating, "Tốt");
    }
    console.log("  -> PASS [V364-02].");

    // =========================================================================
    // [V364-03] & [V364-04] Cold-start Google Drive/Sheets UI Resilience
    // =========================================================================
    interface MockItem {
      id: string;
      parentId: string;
      name: string;
      isFolder: boolean;
      mimeType: string;
      tabs: string[];
      workbookBuffer?: Buffer;
      trashed?: boolean;
    }

    const items = new Map<string, MockItem>();
    let seq = 1;
    const nextId = (p: string) => `${p}_1234567890123456_${seq++}`;

    const behavior = {
      disablePicker: false,
      dropFirstNewSheetsClick: false,
      requireAlertRoleButtonSharedConfirm: false,
      dropFileMenuClicksBeforeOpen: 0,
      delaySaveAsMenuItemMs: 0,
      hideSaveAsItem: false,
    };

    const extractTabs = (buf: Buffer): string[] => {
      const wb = new AdmZip(buf).readAsText("xl/workbook.xml");
      return Array.from(wb.matchAll(/<sheet\b[^>]*?\bname="([^"]+)"/gi)).map((m) => m[1]);
    };

    let baseUrl = "";
    server = http.createServer((req, res) => {
      const u = new URL(req.url || "/", "http://127.0.0.1");

      if (req.method === "POST" && u.pathname === "/api/create-sheet") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const { parentId } = JSON.parse(body);
          const id = nextId("GSHEET");
          items.set(id, {
            id,
            parentId,
            name: "Bảng tính không có tiêu đề",
            isFolder: false,
            mimeType: "application/vnd.google-apps.spreadsheet",
            tabs: ["Trang tính1"],
          });
          res.end(JSON.stringify({ id, editUrl: `${baseUrl}/spreadsheets/d/${id}/edit` }));
        });
        return;
      }

      if (req.method === "POST" && u.pathname === "/api/upload-file") {
        const parentId = u.searchParams.get("parentId") || "";
        const fileName = u.searchParams.get("fileName") || "temp.xlsx";
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          const buf = Buffer.concat(chunks);
          const id = nextId("XLSX");
          items.set(id, {
            id,
            parentId,
            name: fileName,
            isFolder: false,
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            tabs: extractTabs(buf),
            workbookBuffer: buf,
          });
          res.end(JSON.stringify({ id }));
        });
        return;
      }

      if (req.method === "POST" && u.pathname === "/api/import-replace") {
        const sheetId = u.searchParams.get("sheetId") || "";
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          const buf = Buffer.concat(chunks);
          const it = items.get(sheetId);
          if (it) {
            it.tabs = extractTabs(buf);
            it.workbookBuffer = buf;
          }
          res.end(JSON.stringify({ tabs: it?.tabs || [] }));
        });
        return;
      }

      if (req.method === "POST" && u.pathname === "/api/save-as-gsheet") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const { sourceId } = JSON.parse(body);
          const src = items.get(sourceId);
          const id = nextId("CONVERTED");
          items.set(id, {
            id,
            parentId: src?.parentId || "",
            name: (src?.name || "Sheet").replace(/\.xlsx$/i, ""),
            isFolder: false,
            mimeType: "application/vnd.google-apps.spreadsheet",
            tabs: src?.tabs ? [...src.tabs] : ["Trang tính1"],
            workbookBuffer: src?.workbookBuffer,
          });
          res.end(JSON.stringify({ editUrl: `${baseUrl}/spreadsheets/d/${id}/edit` }));
        });
        return;
      }

      if (req.method === "POST" && u.pathname === "/api/rename") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const { sheetId, title } = JSON.parse(body);
          const it = items.get(sheetId);
          if (it) it.name = title;
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }

      if (req.method === "POST" && u.pathname === "/api/trash") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const { id } = JSON.parse(body);
          const it = items.get(id);
          if (it) it.trashed = true;
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }

      if (req.method === "GET" && u.pathname === "/picker-frame") {
        if (behavior.disablePicker) {
          res.writeHead(500).end("Picker disabled");
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html><html><body>
          <div role="tab" id="tab-upload">Tải lên</div>
          <input type="file" id="picker-file" />
          <script>
            document.getElementById('picker-file').addEventListener('change', async (e) => {
              const f = e.target.files[0];
              if (!f) return;
              const buf = await f.arrayBuffer();
              window.parent.postMessage({ type: 'UPLOADED', bytes: Array.from(new Uint8Array(buf)) }, '*');
            });
          </script>
        </body></html>`);
        return;
      }

      const editMatch = u.pathname.match(/^\/spreadsheets\/d\/([^/]+)\/edit$/);
      if (req.method === "GET" && editMatch) {
        const sheetId = editMatch[1];
        const it = items.get(sheetId);
        if (!it) {
          res.writeHead(404).end();
          return;
        }
        const isXlsx = it.mimeType !== "application/vnd.google-apps.spreadsheet";
        const dropBefore = behavior.dropFileMenuClicksBeforeOpen;
        const saveAsDelay = behavior.delaySaveAsMenuItemMs;
        const hideSaveAs = behavior.hideSaveAsItem;
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html><html><body>
          <div id="docs-title-widget"><input class="docs-title-input" value="${it.name}" /></div>
          <span id="docs-save-indicator-badge" aria-label="Đã lưu vào Drive">Đã lưu vào Drive</span>
          <div id="docs-file-menu">Tệp</div>
          <div id="file-menu" style="display:none;">
            <div class="goog-menuitem" role="menuitem" id="mi-copy">Tạo bản sao</div>
            <div class="goog-menuitem" role="menuitem" id="mi-import">Nhập</div>
            ${
              isXlsx && !hideSaveAs
                ? `<div class="goog-menuitem" role="menuitem" id="mi-save-gs" style="${
                    saveAsDelay > 0 ? "display:none;" : ""
                  }">Lưu dưới dạng Google Trang tính</div>`
                : ""
            }
          </div>
          <div id="picker-host"></div>
          <div id="import-dlg" role="dialog" style="display:none;">
            <div>Vị trí nhập</div>
            <select><option value="new">Tạo mới</option><option value="replace">Thay thế bảng tính</option></select>
            <button type="button" name="import-data" id="btn-import">Nhập dữ liệu</button>
          </div>
          <div id="tabs">${it.tabs.map((t) => `<span class="docs-sheet-tab-name">${t}</span>`).join("")}</div>
          <script>
            const sheetId = ${JSON.stringify(sheetId)};
            const dropBefore = ${JSON.stringify(dropBefore)};
            const saveAsDelay = ${JSON.stringify(saveAsDelay)};
            let fileClicks = 0;
            let uploaded = null;
            const titleEl = document.querySelector('.docs-title-input');
            titleEl.addEventListener('keydown', async (e) => {
              if (e.key === 'Enter') {
                await fetch('/api/rename', { method: 'POST', body: JSON.stringify({ sheetId, title: titleEl.value }) });
              }
            });
            document.getElementById('docs-file-menu').addEventListener('click', () => {
              fileClicks++;
              if (fileClicks <= dropBefore) {
                return; // Simulates cold-start JS hydration swallowing first clicks
              }
              document.getElementById('file-menu').style.display = 'block';
              const saveGs = document.getElementById('mi-save-gs');
              if (saveGs && saveAsDelay > 0) {
                setTimeout(() => { saveGs.style.display = 'block'; }, saveAsDelay);
              }
            });
            document.getElementById('mi-import').onclick = () => {
              document.getElementById('file-menu').style.display = 'none';
              document.getElementById('picker-host').innerHTML = '<iframe src="/picker-frame"></iframe>';
            };
            const saveGsBtn = document.getElementById('mi-save-gs');
            if (saveGsBtn) {
              saveGsBtn.onclick = async () => {
                const r = await fetch('/api/save-as-gsheet', { method: 'POST', body: JSON.stringify({ sourceId: sheetId }) });
                const d = await r.json();
                window.open(d.editUrl, '_blank');
              };
            }
            window.addEventListener('message', (ev) => {
              if (ev.data?.type === 'UPLOADED') {
                uploaded = new Uint8Array(ev.data.bytes);
                document.getElementById('import-dlg').style.display = 'block';
              }
            });
            document.getElementById('btn-import').onclick = async () => {
              const r = await fetch('/api/import-replace?sheetId=' + sheetId, { method: 'POST', body: uploaded });
              const d = await r.json();
              document.getElementById('import-dlg').style.display = 'none';
              document.getElementById('tabs').innerHTML = d.tabs.map(t => '<span class="docs-sheet-tab-name">' + t + '</span>').join('');
            };
          </script>
        </body></html>`);
        return;
      }

      const folderMatch = u.pathname.match(/^\/drive\/folders\/([^/]+)$/);
      if (req.method === "GET" && folderMatch) {
        const folderId = folderMatch[1];
        const children = Array.from(items.values()).filter(
          (i) => i.parentId === folderId && !i.trashed
        );
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html><html><body>
          <button guidedhelpid="new_menu_button" aria-label="Mới" id="btn-new">+ Mới</button>
          <div id="new-menu" role="menu" style="display:none;">
            <div role="menuitem" id="mi-folder">Thư mục mới</div>
            <div role="menuitem" id="mi-upload">Tải tệp lên</div>
            <div role="menuitem" id="mi-gs" style="width:200px;height:28px;">Google Trang tính</div>
          </div>
          <input type="file" id="hidden-file" style="display:none;" />
          <div id="dlg-shared" role="${
            behavior.requireAlertRoleButtonSharedConfirm ? "alertdialog" : "dialog"
          }" style="display:none;">
            ${
              behavior.requireAlertRoleButtonSharedConfirm
                ? `<div role="button" tabindex="0" id="btn-shared">Tạo và chia sẻ</div>`
                : `<button type="button" id="btn-shared">Tạo và chia sẻ</button>`
            }
          </div>
          <div id="ctx-menu" role="menu" style="display:none;"><div role="menuitem" id="mi-trash">Chuyển vào thùng rác</div></div>
          <main role="main">
            ${children
              .map((c) => {
                const t = c.isFolder
                  ? "folder"
                  : c.mimeType === "application/vnd.google-apps.spreadsheet"
                  ? "spreadsheet"
                  : "file";
                return `<div data-target="doc" data-id="${c.id}" data-type="${t}" data-mime-type="${c.mimeType}"><div data-id="${c.id}">${c.name}</div></div>`;
              })
              .join("")}
          </main>
          <script>
            const folderId = ${JSON.stringify(folderId)};
            const dropFirstNewSheet = ${JSON.stringify(behavior.dropFirstNewSheetsClick)};
            let newSheetClicks = 0;
            let ctxId = '';
            document.getElementById('btn-new').onclick = () => {
              document.getElementById('new-menu').style.display = 'block';
            };
            document.getElementById('mi-upload').onclick = () => document.getElementById('hidden-file').click();
            document.getElementById('hidden-file').onchange = async (e) => {
              const f = e.target.files[0];
              await fetch('/api/upload-file?parentId=' + folderId + '&fileName=' + encodeURIComponent(f.name), { method: 'POST', body: new Uint8Array(await f.arrayBuffer()) });
              location.reload();
            };
            document.getElementById('mi-gs').onclick = () => {
              newSheetClicks++;
              document.getElementById('new-menu').style.display = 'none';
              if (dropFirstNewSheet && newSheetClicks === 1) {
                return; // First click swallowed by cold Drive UI
              }
              document.getElementById('dlg-shared').style.display = 'block';
            };
            document.getElementById('btn-shared').onclick = async () => {
              document.getElementById('dlg-shared').style.display = 'none';
              const r = await fetch('/api/create-sheet', { method: 'POST', body: JSON.stringify({ parentId: folderId }) });
              window.open((await r.json()).editUrl, '_blank');
            };
            document.querySelectorAll('[data-target="doc"]').forEach((el) => {
              el.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                ctxId = el.getAttribute('data-id');
                document.getElementById('ctx-menu').style.display = 'block';
              });
            });
            document.getElementById('mi-trash').onclick = async () => {
              await fetch('/api/trash', { method: 'POST', body: JSON.stringify({ id: ctxId }) });
              location.reload();
            };
          </script>
        </body></html>`);
        return;
      }

      res.writeHead(404).end();
    });

    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    const page = await context.newPage();

    const csiCourseFolderId = CODING_SPCK_COURSE_FOLDER_MAP.CSI;
    const csiClassFolderId = nextId("CLASSFOLDER");
    items.set(csiClassFolderId, {
      id: csiClassFolderId,
      parentId: csiCourseFolderId,
      name: classId,
      isFolder: true,
      mimeType: "application/vnd.google-apps.folder",
      tabs: [],
    });

    console.log(
      "[V364-03] Luồng chính mở lạnh (rớt click đầu 'Google Trang tính', alertdialog role='button', rớt click đầu `#docs-file-menu`)..."
    );
    behavior.disablePicker = false;
    behavior.dropFirstNewSheetsClick = true;
    behavior.requireAlertRoleButtonSharedConfirm = true;
    behavior.dropFileMenuClicksBeforeOpen = 1;
    behavior.delaySaveAsMenuItemMs = 0;
    behavior.hideSaveAsItem = false;

    const primaryRes = await createAndUploadClassDemoSheetToDrive({
      classId,
      driveFolderUrl: DEFAULT_SPCK_DRIVE_FOLDER_URL,
      localClassFolderPath: csiClassDir,
      _testRetryOptions: {
        maxRetries: 3,
        baseDelayMs: 5,
        maxDelayMs: 15,
        interStudentDelayMs: 2,
      },
      _testAiScorerOverride: async ({ anonymousToken, scorableCriteria }) => ({
        criteria: scorableCriteria.map((c) => ({
          rowNumber: c.rowNumber,
          rating: "Tốt",
          evidenceNote: `${anonymousToken} đạt chuẩn.`,
        })),
        bgkQuestions: [`Hỏi: Luồng chạy của ${anonymousToken}? -> Gợi ý đáp án mong đợi: AppController.run().`],
      }),
      _testHarness: { page, driveBaseUrl: baseUrl, sheetsBaseUrl: baseUrl },
    });

    assert.equal(primaryRes.isNativeGoogleSheet, true);
    assert.equal(primaryRes.aiPreScoredCount, 4);
    assert.deepEqual(
      [...primaryRes.studentTabNames].sort((a, b) => a.localeCompare(b, "vi")),
      csiStudents.map((s) => s.fullName).sort((a, b) => a.localeCompare(b, "vi"))
    );
    assert.equal(unhandledRejections.length, 0);
    console.log("  -> PASS [V364-03].");

    console.log(
      "[V364-04A] Luồng dự phòng mở lạnh: rớt 2 click đầu `#docs-file-menu` & mục 'Lưu dưới dạng' hiện trễ..."
    );
    behavior.disablePicker = true;
    behavior.dropFirstNewSheetsClick = false;
    behavior.requireAlertRoleButtonSharedConfirm = false;
    behavior.dropFileMenuClicksBeforeOpen = 2;
    behavior.delaySaveAsMenuItemMs = 450;
    behavior.hideSaveAsItem = false;

    const fallbackRes = await createAndUploadClassDemoSheetToDrive({
      classId,
      driveFolderUrl: DEFAULT_SPCK_DRIVE_FOLDER_URL,
      localClassFolderPath: csiClassDir,
      enableAiPreScore: false,
      _testHarness: { page, driveBaseUrl: baseUrl, sheetsBaseUrl: baseUrl },
    });

    assert.equal(fallbackRes.isNativeGoogleSheet, true);
    assert.notEqual(fallbackRes.driveFileId, primaryRes.driveFileId);
    assert.equal(items.get(primaryRes.driveFileId!)?.trashed, true);
    assert.equal(unhandledRejections.length, 0);
    console.log("  -> PASS [V364-04A].");

    console.log(
      "[V364-04B] Thất bại khi menu 'Lưu dưới dạng Google Trang tính' không tồn tại -> reject sạch, 0 unhandledRejection..."
    );
    behavior.disablePicker = true;
    behavior.dropFileMenuClicksBeforeOpen = 0;
    behavior.delaySaveAsMenuItemMs = 0;
    behavior.hideSaveAsItem = true;

    await assert.rejects(
      () =>
        createAndUploadClassDemoSheetToDrive({
          classId,
          driveFolderUrl: DEFAULT_SPCK_DRIVE_FOLDER_URL,
          localClassFolderPath: csiClassDir,
          enableAiPreScore: false,
          _testHarness: {
            page,
            driveBaseUrl: baseUrl,
            sheetsBaseUrl: baseUrl,
            fileMenuTimeoutMs: 1200,
          },
        }),
      /Lưu dưới dạng Google Trang tính/i
    );

    // Wait past timer tick to confirm NO dangling waitForEvent unhandledRejection fires
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(
      unhandledRejections.length,
      0,
      `Phát hiện unhandledRejection rò rỉ: ${unhandledRejections.map(String).join("; ")}`
    );
    assert.equal(
      items.get(fallbackRes.driveFileId!)?.trashed,
      undefined,
      "Bảng điểm cũ phải được giữ nguyên khi lượt làm mới thất bại!"
    );
    console.log("  -> PASS [V364-04B].");

    // =========================================================================
    // [V364-05] Codex Round 1 Remediation: URL PII, Zero-PII Logs, In-Flight
    // Abort, 401 No Repair Retry, Network Codes, Infinite Retry Cap, Hint Timing
    // =========================================================================
    console.log(
      "[V364-05] Kiểm tra đối kháng: URL PII, Zero-PII logs, Stop Bot giữa chừng, 401/JSON-repair, mạng & Retry Hint..."
    );

    // 5a. Network error codes, Error.cause recursion & AggregateError traversal
    assert.equal(isTransientGeminiError({ code: "ECONNREFUSED" }), true);
    assert.equal(isTransientGeminiError({ code: "ENOTFOUND" }), true);
    assert.equal(isTransientGeminiError({ code: "EHOSTUNREACH" }), true);
    assert.equal(
      isTransientGeminiError(new Error("connect failed", { cause: { code: "ECONNREFUSED" } } as any)),
      true
    );
    assert.equal(
      isTransientGeminiError(
        new AggregateError(
          [Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })],
          ""
        )
      ),
      true
    );

    // 5b. maxRetries: Infinity must be capped cleanly
    let infAttempts = 0;
    await assert.rejects(
      () =>
        callGeminiWithRetry(
          async () => {
            infAttempts += 1;
            throw { status: 503, message: "overloaded" };
          },
          { maxRetries: Infinity, baseDelayMs: 2, maxDelayMs: 4 }
        ),
      (err: any) => err?.status === 503 && /overloaded/i.test(String(err?.message || ""))
    );
    assert.equal(infAttempts, 1 + MAX_GEMINI_RETRIES_CAP);

    // 5c. Honor server retry hints up to maxRetryHintMs without shortening down to maxDelayMs;
    // reject immediately if server asks longer than maxRetryHintMs
    let hintAttempts = 0;
    const hintStart = Date.now();
    const hintResult = await callGeminiWithRetry(
      async () => {
        hintAttempts += 1;
        if (hintAttempts === 1) {
          throw new Error("[429 ] Too Many Requests. Please retry in 0.05s");
        }
        return "HINT_OK";
      },
      { baseDelayMs: 5, maxDelayMs: 10, maxRetryHintMs: 80 }
    );
    const hintElapsed = Date.now() - hintStart;
    assert.equal(hintResult, "HINT_OK");
    assert.ok(
      hintElapsed >= 40,
      `Retry hint 0.05s bị rút ngắn sai (${hintElapsed}ms < 40ms)!`
    );

    let oversizeHintAttempts = 0;
    await assert.rejects(
      () =>
        callGeminiWithRetry(
          async () => {
            oversizeHintAttempts += 1;
            throw new Error("[429 ] Please retry in 5s");
          },
          { baseDelayMs: 5, maxDelayMs: 10, maxRetryHintMs: 80 }
        ),
      /retry in 5s/i
    );
    assert.equal(oversizeHintAttempts, 1);

    // 5d. In-flight Stop Bot abort immediately aborts pending call
    let abortFlag = false;
    const abortStart = Date.now();
    setTimeout(() => {
      abortFlag = true;
    }, 25);
    await assert.rejects(
      () =>
        callGeminiWithRetry(
          async () => {
            await new Promise((r) => setTimeout(r, 350));
            return "LATE_SHOULD_NOT_WIN";
          },
          { shouldAbort: () => abortFlag, maxRetries: 1, baseDelayMs: 5 }
        ),
      /Dừng khẩn cấp|Stop Bot/i
    );
    const abortElapsed = Date.now() - abortStart;
    assert.ok(
      abortElapsed < 150,
      `Stop Bot không cắt ngang cuộc gọi AI đang chờ (${abortElapsed}ms >= 150ms)!`
    );

    // 5e. URL PII scrubbing (including unselected + inactive DB classmates + malformed URL creds) & Zero-PII logs
    studentRepo.upsert({
      studentId: "STU_VT-CSI02_PHAM_GIA_HUY",
      classId,
      fullName: "Phạm Gia Huy",
      isActive: 0,
    });
    const scrubbedMalformed = sanitizeRelatedLinkUrlForPrompt(
      "http://kimdactruong:SuperSecretPass99@localhost:badport/app",
      "Kim Đắc Trường",
      "STUDENT_01",
      ["Phạm Gia Huy"]
    );
    assert.equal(/SuperSecretPass99|kimdactruong/i.test(scrubbedMalformed), false);

    const truongStu = csiStudents[3];
    spckUploadRepo.upsert({
      classId,
      studentId: truongStu.studentId,
      isConfirmedByTeacher: 1,
      projectTitle: "App Demo PII",
      localFolderPath: path.join(csiClassDir, truongStu.fullName),
      attachmentsJson: JSON.stringify([path.join(csiClassDir, truongStu.fullName, "main.py")]),
      screenshotsJson: "[]",
      youtubeUrlsJson: "[]",
      relatedLinksJson: JSON.stringify([
        { name: "GitHub Pages", url: "https://banhtalon.github.io/kim-dac-truong/app" },
        {
          name: "Slide",
          url: "https://example.com/%C4%90%E1%BA%B7ng%20Quang%20Th%E1%BA%A3o/slide?peer=bui-nguyen-nhat-quan&inactive=pham-gia-huy",
        },
        { name: "Vercel", url: "https://spck-kimdactruong99.vercel.app/" },
      ]),
      status: "VERIFIED",
    });

    const capturedPromptTexts: string[] = [];
    const capturedWarns: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      capturedWarns.push(args.map((a) => String(a)).join(" "));
    };
    try {
      const piiCheckRes = await generateDemoSheetAiPreScoresForClass({
        classId,
        studentTabs: [studentTabs[3]], // 1-student subset: peers (active & inactive) MUST still be scrubbed from DB roster
        templateBuffer: csiTplBuf,
        localClassFolderPath: csiClassDir,
        _testRetryOptions: { maxRetries: 1, baseDelayMs: 5, maxDelayMs: 10, interStudentDelayMs: 0 },
        _testAiScorerOverride: async ({ promptText }) => {
          capturedPromptTexts.push(promptText);
          throw new Error("[503 ] experiencing high demand PII_CANARY_SECRET_999");
        },
      });
      assert.equal(piiCheckRes.skipReasons.aiErrorCount, 1);
    } finally {
      console.warn = origWarn;
    }

    assert.equal(capturedPromptTexts.length, 2, "Phải gọi ban đầu + thử lại 1 lần với 503!");
    const linksMatch = capturedPromptTexts[0].match(
      /CÁC ĐƯỜNG DẪN LIÊN QUAN:\n([\s\S]*?)(?:\n\n|$)/
    );
    assert.ok(linksMatch && linksMatch[1], "Phải tìm thấy mục CÁC ĐƯỜNG DẪN LIÊN QUAN trong prompt");
    const linksText = linksMatch[1];
    assert.ok(linksText.includes("STUDENT_01"), "Tên học viên mục tiêu trong URL phải chuyển thành STUDENT_01");
    assert.ok(linksText.includes("STUDENT_PEER"), "Tên bạn cùng lớp/đã nghỉ trong URL phải chuyển thành STUDENT_PEER");
    for (const leakedFragment of [
      "kim",
      "dac",
      "đắc",
      "truong",
      "trường",
      "quang",
      "thao",
      "thảo",
      "bui",
      "nhat",
      "quan",
      "quân",
      "pham",
      "phạm",
      "gia",
      "huy",
    ]) {
      assert.equal(
        new RegExp(leakedFragment, "iu").test(linksText),
        false,
        `Rò rỉ PII '${leakedFragment}' qua URL trong prompt:\n${linksText}`
      );
    }

    const joinedWarns = capturedWarns.join("\n");
    assert.ok(joinedWarns.includes("HTTP 503 (high_demand)"), `Thiếu log tóm tắt HTTP 503 an toàn:\n${joinedWarns}`);
    assert.equal(/KIM_DAC_TRUONG|PII_CANARY_SECRET_999/i.test(joinedWarns), false, `Log rò rỉ PII/canary:\n${joinedWarns}`);

    // 5f. Live scorer: permanent 401 makes strictly 1 API call; malformed JSON triggers 1 repair call
    const genClient = getGeminiClient();
    const origGetGenerativeModel = genClient.getGenerativeModel.bind(genClient);
    let liveGenCalls = 0;
    let stubMode: "401" | "bad_json_then_ok" = "401";

    (genClient as any).getGenerativeModel = () => ({
      model: "models/gemini-3.5-flash-lite",
      generateContent: async () => {
        liveGenCalls += 1;
        if (stubMode === "401") {
          const err: any = new Error("Unauthorized");
          err.status = 401;
          throw err;
        }
        if (liveGenCalls === 1) {
          return { response: { text: () => "{ broken json without closing" } };
        }
        return {
          response: {
            text: () =>
              JSON.stringify({
                criteria: [{ rowNumber: 8, rating: "Tốt", evidenceNote: "OK sau sửa JSON." }],
                bgkQuestions: ["Hỏi: Demo? -> Gợi ý đáp án mong đợi: Chạy tốt."],
              }),
          },
        };
      },
    });

    try {
      const origWarnMute = console.warn;
      console.warn = () => {};
      try {
        liveGenCalls = 0;
        stubMode = "401";
        const res401 = await generateDemoSheetAiPreScoresForClass({
          classId,
          studentTabs: [studentTabs[3]],
          templateBuffer: csiTplBuf,
          localClassFolderPath: csiClassDir,
          _testRetryOptions: { interStudentDelayMs: 0 },
        });
        assert.equal(liveGenCalls, 1, "Lỗi HTTP 401 vĩnh viễn KHÔNG được gọi lại lần 2!");
        assert.equal(res401.skipReasons.aiErrorCount, 1);

        liveGenCalls = 0;
        stubMode = "bad_json_then_ok";
        const resRepair = await generateDemoSheetAiPreScoresForClass({
          classId,
          studentTabs: [studentTabs[3]],
          templateBuffer: csiTplBuf,
          localClassFolderPath: csiClassDir,
          _testRetryOptions: { interStudentDelayMs: 0 },
        });
        assert.equal(liveGenCalls, 2, "JSON hỏng phải gọi sửa 1 lần ở temperature=0.1!");
        assert.equal(resRepair.preScoredCount, 1);
      } finally {
        console.warn = origWarnMute;
      }
    } finally {
      (genClient as any).getGenerativeModel = origGetGenerativeModel;
    }

    await new Promise((r) => setTimeout(r, 400));
    assert.equal(unhandledRejections.length, 0);
    console.log("  -> PASS [V364-05].");
    console.log("\n🎉 TẤT CẢ KIỂM THỬ v3.6.4 (V364-01 -> V364-05) ĐỀU PASS 100%!");
  } finally {
    process.off("unhandledRejection", onUnhandled);
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    try {
      getDb().close();
    } catch {
      // ignore
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("❌ V364 TEST FAILED:", err);
  process.exitCode = 1;
});
