/**
 * MINDX AUTOMATION BOT - VERIFICATION SUITE FOR v3.5.3
 * 100% isolated in `os.tmpdir()` (zero mutations to live `data/mindx_bot.db` or `data/running_classes.json`):
 * - R353-01: Chromium E2E reproduction of VT-JSB16 `+ Mới` pointer interception (`aria-expanded="true"` +
 *            `<li data-key="1" role="menuitem">` overlapping `button[guidedhelpid="new_menu_button"]`),
 *            verified across both `SpckDriveUploader` and `createAndUploadClassDemoSheetToDrive`.
 * - R353-02: `SpckDriveUploader` clean-before-upload (`purgeAllItemsInsideDriveFolder`), Shared-Folder
 *            trash confirmation dialog, same `studentDriveFolderId` preservation, strict exclusion of
 *            Bot artifacts (`_spck_app_shots`, `_spck_owner_uploads`, `*_web_package.zip`, `app_*.png`,
 *            `links.txt`, `_staging_gsheet_*.xlsx`) while keeping genuine student `.zip` files, and
 *            fail-closed empty-folder protection (0 old Drive items trashed if local folder invalid).
 * - R353-03: Re-scan + Re-capture screenshots + Auto-sync active Session 13 for modified students while
 *            keeping untouched verified students and Session 12 history 100% intact, plus selective
 *            `upload-drive` sync excluding failed students.
 * - R353-04: Chromium E2E LMS Modal re-submission (`SpckUploader.uploadSingleStudentViaRealLmsModal`)
 *            removing stale `relatedLinks` while preserving valid links and verifying `relativeUrls`
 *            in Read-after-Write.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { chromium } from "playwright";

const ROOT = process.cwd();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-v353-test-"));
const tempConfigDir = path.join(tempRoot, "config");
const tempSpckRoot = path.join(tempRoot, "spck_root");
const tempRoleDir = path.join(tempRoot, "role-state");

fs.mkdirSync(path.join(tempConfigDir, "demo-sheet-templates"), { recursive: true });
fs.mkdirSync(tempSpckRoot, { recursive: true });
fs.mkdirSync(tempRoleDir, { recursive: true });

// Copy config templates & default logo read-only into isolated temp config dir
const liveTemplatesDir = path.join(ROOT, "data", "config", "demo-sheet-templates");
if (fs.existsSync(liveTemplatesDir)) {
  for (const file of fs.readdirSync(liveTemplatesDir)) {
    if (file.toLowerCase().endsWith(".xlsx")) {
      fs.copyFileSync(
        path.join(liveTemplatesDir, file),
        path.join(tempConfigDir, "demo-sheet-templates", file)
      );
    }
  }
}
for (const cfgFile of ["default-demo-sheet-template.xlsx", "default-spck-thumbnail.png"]) {
  const srcPath = path.join(ROOT, "data", "config", cfgFile);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, path.join(tempConfigDir, cfgFile));
  }
}

process.env.MINDX_DB_PATH = path.join(tempRoot, "mindx_v353_test.db");
process.env.MINDX_CONFIG_DIR = tempConfigDir;
process.env.MINDX_RUNNING_CLASSES_PATH = path.join(tempRoot, "running_classes.json");
process.env.MINDX_LMS_CLASS_IDS_PATH = path.join(tempConfigDir, "lms_class_ids.json");
process.env.MINDX_ROLE_STATE_DIR = tempRoleDir;
process.env.ALLOWED_LOCAL_DIRS = tempRoot;
process.env.GEMINI_API_KEY = "AIzaDummyTestKeyV353_NeverLive";

const MINIMAL_PNG_BUF = fs.readFileSync(
  path.join(tempConfigDir, "default-spck-thumbnail.png")
);

function makeLocalRequest(url: string, method = "GET", bodyObj?: unknown): Request {
  return new Request(url, {
    method,
    headers: {
      host: "127.0.0.1:3000",
      "content-type": "application/json",
    },
    body: bodyObj !== undefined ? JSON.stringify(bodyObj) : undefined,
  });
}

function createFakeZipBuffer(entryName: string, content: string): Buffer {
  const zip = new AdmZip();
  zip.addFile(entryName, Buffer.from(content, "utf8"));
  return zip.toBuffer();
}

interface MockDriveNode {
  id: string;
  parentId: string;
  name: string;
  isFolder: boolean;
  mimeType: string;
  contentText?: string;
  tabs?: string[];
  trashed?: boolean;
}

async function run() {
  const {
    computeSafeFileByteDigest,
    computeSpckContentHash,
    getDb,
    spckSessionRepo,
    spckUploadRepo,
    studentRepo,
  } = await import("../src/lib/db/sqlite");
  const { BrowserManager } = await import("../src/lib/playwright/browser-manager");
  const {
    CODING_SPCK_COURSE_FOLDER_MAP,
    CODING_SPCK_ROOT_FOLDER_ID,
    SpckDriveUploader,
    isBotOrSystemIgnoredDriveDir,
    isBotOrSystemIgnoredDriveFile,
  } = await import("../src/lib/playwright/spck-drive-uploader");
  const { createAndUploadClassDemoSheetToDrive } = await import(
    "../src/lib/playwright/spck-demo-sheet"
  );
  const { SpckUploader } = await import("../src/lib/playwright/spck-uploader");
  const { captureClassAppScreenshotsAndSelectThumbnails } = await import(
    "../src/lib/local-files/spck-app-screenshotter"
  );
  const { POST: scanPost } = await import("../src/app/api/spck/scan/route");
  const { POST: saveDraftPost } = await import("../src/app/api/spck/save-draft/route");
  const { POST: approvePost } = await import("../src/app/api/spck/approve/route");
  const { POST: uploadDrivePost } = await import("../src/app/api/spck/upload-drive/route");
  const { getGeminiModel } = await import("../src/lib/gemini/client");

  let mockServer: http.Server | null = null;
  let lmsServer: http.Server | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  const origGetPage = BrowserManager.prototype.getPage;

  try {
    // =========================================================================
    // Quick static unit checks for Bot/System Drive Filters
    // =========================================================================
    assert.strictEqual(isBotOrSystemIgnoredDriveDir("_spck_app_shots"), true);
    assert.strictEqual(isBotOrSystemIgnoredDriveDir("_spck_owner_uploads"), true);
    assert.strictEqual(isBotOrSystemIgnoredDriveDir("_spck_youtube_frames"), true);
    assert.strictEqual(isBotOrSystemIgnoredDriveDir("_portal_backups"), true);
    assert.strictEqual(isBotOrSystemIgnoredDriveDir(".spck_portal_temp"), true);
    assert.strictEqual(isBotOrSystemIgnoredDriveDir("node_modules"), true);
    assert.strictEqual(isBotOrSystemIgnoredDriveDir("assets"), false);

    assert.strictEqual(isBotOrSystemIgnoredDriveFile("app_01_index_a1b2c3.png"), true);
    assert.strictEqual(isBotOrSystemIgnoredDriveFile("yt_frame_01_0010.jpg"), true);
    assert.strictEqual(isBotOrSystemIgnoredDriveFile("stu_web_package.zip"), true);
    assert.strictEqual(isBotOrSystemIgnoredDriveFile("stu_app_package.zip"), true);
    assert.strictEqual(isBotOrSystemIgnoredDriveFile("stu_robotics_package.zip"), true);
    assert.strictEqual(isBotOrSystemIgnoredDriveFile("game_gamemaker.yyz"), true);
    assert.strictEqual(isBotOrSystemIgnoredDriveFile("spck_student_01_1234abcd.zip"), true);
    assert.strictEqual(isBotOrSystemIgnoredDriveFile("_staging_gsheet_JSB16.xlsx"), true);
    assert.strictEqual(isBotOrSystemIgnoredDriveFile("default-spck-thumbnail.png"), true);
    assert.strictEqual(isBotOrSystemIgnoredDriveFile("links.txt"), true);
    assert.strictEqual(isBotOrSystemIgnoredDriveFile("desktop.ini"), true);
    assert.strictEqual(isBotOrSystemIgnoredDriveFile("tai_lieu_hoc_sinh.zip"), false);
    assert.strictEqual(isBotOrSystemIgnoredDriveFile("Demo.png"), false);
    assert.strictEqual(isBotOrSystemIgnoredDriveFile("index.html"), false);

    // Check getGeminiModel preserves default model name when given systemInstruction
    const expectedModelSlug = (process.env.GEMINI_MODEL || "gemini-3.5-flash-lite").replace(
      /^models\//,
      ""
    );
    const geminiModelWithSys = getGeminiModel(undefined, 0.2, "Bạn là Trợ lý BGK");
    assert.strictEqual(
      geminiModelWithSys.model,
      `models/${expectedModelSlug}`,
      `getGeminiModel không được nhầm systemInstruction thành tên model! Thực tế: ${geminiModelWithSys.model}`
    );
    assert.ok(!geminiModelWithSys.model.includes("Bạn là Trợ lý"));

    // =========================================================================
    // Seed Isolated VT-JSB16 Class + Students +Folders
    // =========================================================================
    const classId = "VT-JSB16";
    const db = getDb();
    for (const sNum of [12, 13, 14]) {
      db.prepare(
        `INSERT OR REPLACE INTO classes_sessions (sessionId, classId, className, sessionNumber, date) VALUES (?, ?, ?, ?, '2026-11-15')`
      ).run(`${classId}_SESS_${sNum}`, classId, classId, sNum);
    }

    const jsbClassDir = path.join(tempSpckRoot, "JSB16");
    const tuanDir = path.join(jsbClassDir, "Nguyen Minh Tuan");
    const emptyStuDir = path.join(jsbClassDir, "Tran Empty Test");
    const untouchDir = path.join(jsbClassDir, "Le Gia Huy");
    fs.mkdirSync(path.join(tuanDir, "assets"), { recursive: true });
    fs.mkdirSync(path.join(tuanDir, "_spck_app_shots"), { recursive: true });
    fs.mkdirSync(path.join(tuanDir, "_spck_owner_uploads"), { recursive: true });
    fs.mkdirSync(path.join(tuanDir, "_portal_backups"), { recursive: true });
    fs.mkdirSync(path.join(tuanDir, ".git"), { recursive: true });
    fs.mkdirSync(path.join(emptyStuDir, "_spck_app_shots"), { recursive: true });
    fs.mkdirSync(untouchDir, { recursive: true });

    // Tuan's valid files for Session 13
    fs.writeFileSync(
      path.join(tuanDir, "index.html"),
      "<!doctype html><html><body style='background:#0f172a;color:#f8fafc;padding:24px'><h1>JSB16 Tuan v2 Updated</h1><p>Buoi 13 update</p></body></html>",
      "utf-8"
    );
    fs.writeFileSync(
      path.join(tuanDir, "new_feature.js"),
      "console.log('Session 13 feature loaded');\n",
      "utf-8"
    );
    fs.writeFileSync(path.join(tuanDir, "assets", "hero.png"), MINIMAL_PNG_BUF);
    fs.writeFileSync(
      path.join(tuanDir, "tai_lieu_hoc_sinh.zip"),
      createFakeZipBuffer("notes.txt", "Genuine student archive")
    );

    // Tuan's Bot & System artifacts that MUST NEVER be uploaded to Google Drive
    fs.writeFileSync(
      path.join(tuanDir, "_spck_app_shots", "app_01_index_1234ab.png"),
      MINIMAL_PNG_BUF
    );
    fs.writeFileSync(
      path.join(tuanDir, "_spck_owner_uploads", "thumb_999.png"),
      MINIMAL_PNG_BUF
    );
    fs.writeFileSync(path.join(tuanDir, "_portal_backups", "old_backup.html"), "<html></html>");
    fs.writeFileSync(path.join(tuanDir, ".git", "HEAD"), "ref: refs/heads/main\n");
    fs.writeFileSync(
      path.join(tuanDir, "stu_jsb_01_web_package.zip"),
      createFakeZipBuffer("index.html", "bot zip")
    );
    fs.writeFileSync(
      path.join(tuanDir, "spck_nguyen_minh_tuan_abcdef12.zip"),
      createFakeZipBuffer("index.html", "lms bundle")
    );
    fs.writeFileSync(path.join(tuanDir, "app_02_stray_abcdef.png"), MINIMAL_PNG_BUF);
    fs.writeFileSync(path.join(tuanDir, "yt_frame_01_0005.jpg"), MINIMAL_PNG_BUF);
    fs.writeFileSync(path.join(tuanDir, "_staging_gsheet_VT-JSB16.xlsx"), "dummy");
    fs.writeFileSync(path.join(tuanDir, "default-spck-thumbnail.png"), MINIMAL_PNG_BUF);
    fs.writeFileSync(path.join(tuanDir, "links.txt"), "https://example.com\n");
    fs.writeFileSync(path.join(tuanDir, "desktop.ini"), "[.ShellClassInfo]\n");

    // Empty student: ONLY Bot/OS junk, ZERO genuine student files!
    fs.writeFileSync(
      path.join(emptyStuDir, "_spck_app_shots", "app_01_only_112233.png"),
      MINIMAL_PNG_BUF
    );
    fs.writeFileSync(path.join(emptyStuDir, "links.txt"), "https://example.com\n");
    fs.writeFileSync(
      path.join(emptyStuDir, "empty_web_package.zip"),
      createFakeZipBuffer("x.html", "bot")
    );

    // Untouched student
    const huyHtmlV1 =
      "<!doctype html><html><body style='background:#1e293b;color:#e2e8f0;padding:24px'><h1>Huy Portfolio Stable</h1></body></html>";
    fs.writeFileSync(path.join(untouchDir, "index.html"), huyHtmlV1, "utf-8");

    studentRepo.upsert({
      studentId: "JSB_TUAN",
      classId,
      fullName: "Nguyễn Minh Tuấn",
      isActive: 1,
    });
    studentRepo.upsert({
      studentId: "JSB_EMPTY",
      classId,
      fullName: "Trần Empty Test",
      isActive: 1,
    });
    studentRepo.upsert({
      studentId: "JSB_HUY",
      classId,
      fullName: "Lê Gia Huy",
      isActive: 1,
    });

    const jsbCourseFolderId = CODING_SPCK_COURSE_FOLDER_MAP.JSB;
    assert.ok(jsbCourseFolderId, "Missing JSB course folder ID in CODING_SPCK_COURSE_FOLDER_MAP");

    const classDriveFolderId = "DRIVE_CLASS_VT_JSB16_001";
    const tuanDriveFolderId = "DRIVE_STU_TUAN_1234567890";
    const emptyDriveFolderId = "DRIVE_STU_EMPTY_999999999";

    const items = new Map<string, MockDriveNode>();
    let seq = 100;
    const nextId = (prefix: string) => `${prefix}_123456789012_${++seq}`;

    const seedDriveGraph = () => {
      items.clear();
      items.set(jsbCourseFolderId, {
        id: jsbCourseFolderId,
        parentId: CODING_SPCK_ROOT_FOLDER_ID,
        name: "7. JSB",
        isFolder: true,
        mimeType: "application/vnd.google-apps.folder",
      });
      items.set(classDriveFolderId, {
        id: classDriveFolderId,
        parentId: jsbCourseFolderId,
        name: "VT-JSB16",
        isFolder: true,
        mimeType: "application/vnd.google-apps.folder",
      });
      // Tuan already has folder from Session 12 with stale old files & old subfolder!
      items.set(tuanDriveFolderId, {
        id: tuanDriveFolderId,
        parentId: classDriveFolderId,
        name: "Nguyễn Minh Tuấn",
        isFolder: true,
        mimeType: "application/vnd.google-apps.folder",
      });
      items.set("OLD_TUAN_INDEX_1234567890", {
        id: "OLD_TUAN_INDEX_1234567890",
        parentId: tuanDriveFolderId,
        name: "index.html",
        isFolder: false,
        mimeType: "text/html",
        contentText: "v1 old session 12",
      });
      items.set("OLD_TUAN_UNUSED_JS_1234567", {
        id: "OLD_TUAN_UNUSED_JS_1234567",
        parentId: tuanDriveFolderId,
        name: "old_unused.js",
        isFolder: false,
        mimeType: "application/javascript",
      });
      items.set("OLD_TUAN_SUBFOLDER_1234567", {
        id: "OLD_TUAN_SUBFOLDER_1234567",
        parentId: tuanDriveFolderId,
        name: "old_assets",
        isFolder: true,
        mimeType: "application/vnd.google-apps.folder",
      });
      // Empty student already has important Session 12 file on Drive
      items.set(emptyDriveFolderId, {
        id: emptyDriveFolderId,
        parentId: classDriveFolderId,
        name: "Trần Empty Test",
        isFolder: true,
        mimeType: "application/vnd.google-apps.folder",
      });
      items.set("EMPTY_STU_IMPORTANT_S12_ID", {
        id: "EMPTY_STU_IMPORTANT_S12_ID",
        parentId: emptyDriveFolderId,
        name: "important_s12.html",
        isFolder: false,
        mimeType: "text/html",
      });
    };
    seedDriveGraph();

    let stuckNewMenuEnabled = true;
    let newBtnRawClicksBlockedByMenu = 0;
    let sharedTrashModalConfirmClicks = 0;
    const trashedHistory: string[] = [];
    const duplicateConflictsDetected: string[] = [];

    mockServer = http.createServer((req, res) => {
      const u = new URL(req.url || "/", "http://127.0.0.1");

      if (req.method === "POST" && u.pathname === "/api/create-folder") {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          const { parentId, name } = JSON.parse(raw);
          const id = nextId("FOLDER");
          items.set(id, {
            id,
            parentId,
            name,
            isFolder: true,
            mimeType: "application/vnd.google-apps.folder",
          });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ id }));
        });
        return;
      }

      if (req.method === "POST" && u.pathname === "/api/upload-file") {
        const parentId = u.searchParams.get("parentId") || "";
        const fileName = u.searchParams.get("fileName") || "";
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const existingSame = Array.from(items.values()).find(
            (i) => !i.trashed && i.parentId === parentId && i.name.toLowerCase() === fileName.toLowerCase()
          );
          if (existingSame) {
            duplicateConflictsDetected.push(`${parentId}/${fileName}`);
          }
          const id = nextId("FILE");
          items.set(id, {
            id,
            parentId,
            name: existingSame ? `${fileName} (1)` : fileName,
            isFolder: false,
            mimeType: "application/octet-stream",
            contentText: text,
          });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ id }));
        });
        return;
      }

      if (req.method === "POST" && u.pathname === "/api/trash") {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          const { id } = JSON.parse(raw);
          const node = items.get(id);
          if (node) {
            node.trashed = true;
            trashedHistory.push(id);
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }

      if (req.method === "POST" && u.pathname === "/api/trash-confirm-log") {
        sharedTrashModalConfirmClicks += 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method === "POST" && u.pathname === "/api/create-sheet") {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          const { parentId } = JSON.parse(raw);
          const id = nextId("GSHEET");
          items.set(id, {
            id,
            parentId,
            name: "Bảng tính không có tiêu đề",
            isFolder: false,
            mimeType: "application/vnd.google-apps.spreadsheet",
            tabs: ["Trang tính1"],
          });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ id, editUrl: `https://docs.google.com/spreadsheets/d/${id}/edit` }));
        });
        return;
      }

      if (req.method === "POST" && u.pathname === "/api/import-replace") {
        const sheetId = u.searchParams.get("sheetId") || "";
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          const buf = Buffer.concat(chunks);
          const wbXml = new AdmZip(buf).readAsText("xl/workbook.xml");
          const tabs = Array.from(wbXml.matchAll(/<sheet\b[^>]*?\bname="([^"]+)"/gi)).map(
            (m) => m[1]
          );
          const it = items.get(sheetId);
          if (it) it.tabs = tabs;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ tabs }));
        });
        return;
      }

      if (req.method === "POST" && u.pathname === "/api/rename-sheet") {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          const { sheetId, title } = JSON.parse(raw);
          const it = items.get(sheetId);
          if (it) it.name = title;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }

      if (u.pathname === "/picker-frame") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html><html><body>
          <div role="tab" aria-selected="true">Tải lên</div>
          <input type="file" id="picker-file" />
          <script>
            document.getElementById('picker-file').onchange = async (e) => {
              const f = e.target.files[0];
              const bytes = Array.from(new Uint8Array(await f.arrayBuffer()));
              window.parent.postMessage({ type: 'UPLOADED', bytes }, '*');
            };
          </script>
        </body></html>`);
        return;
      }

      const sheetMatch = u.pathname.match(/^\/spreadsheets\/d\/([^/]+)\/edit$/);
      if (req.method === "GET" && sheetMatch) {
        const sheetId = sheetMatch[1];
        const it = items.get(sheetId) || { name: "Bảng tính không có tiêu đề", tabs: ["Trang tính1"] };
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html><html><head><title>${it.name} - Google Trang tính</title></head><body>
          <input class="docs-title-input" value="${it.name}" />
          <button id="docs-file-menu" type="button">Tệp</button>
          <div id="file-menu" role="menu" style="display:none;"><div class="goog-menuitem" role="menuitem" id="mi-import">Nhập</div></div>
          <div id="picker-host"></div>
          <div id="import-dlg" role="dialog" style="display:none;">
            <div>Vị trí nhập</div>
            <select><option value="new">Tạo mới</option><option value="replace">Thay thế bảng tính</option></select>
            <button type="button" name="import-data" id="btn-import">Nhập dữ liệu</button>
          </div>
          <div id="tabs">${(it.tabs || []).map((t) => `<span class="docs-sheet-tab-name">${t}</span>`).join("")}</div>
          <script>
            const sheetId = ${JSON.stringify(sheetId)};
            let uploaded = null;
            const titleEl = document.querySelector('.docs-title-input');
            titleEl.addEventListener('keydown', async (e) => {
              if (e.key === 'Enter') {
                await fetch('/api/rename-sheet', { method: 'POST', body: JSON.stringify({ sheetId, title: titleEl.value }) });
              }
            });
            document.getElementById('docs-file-menu').onclick = () => { document.getElementById('file-menu').style.display = 'block'; };
            document.getElementById('mi-import').onclick = () => {
              document.getElementById('file-menu').style.display = 'none';
              document.getElementById('picker-host').innerHTML = '<iframe src="/picker-frame"></iframe>';
            };
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
        const currentFolder = items.get(folderId);
        const children = Array.from(items.values()).filter(
          (i) => i.parentId === folderId && !i.trashed
        );
        // Simulate exact VT-JSB16 screenshot bug: `aria-expanded="true"` + `<li data-key="1" role="menuitem">`
        // directly covering the `+ Mới` button's bounding box so raw click on `newBtn` fails pointer events!
        const preOpenDisplay = stuckNewMenuEnabled ? "block" : "none";
        const ariaExp = stuckNewMenuEnabled ? "true" : "false";
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html><html><head><title>${currentFolder?.name || folderId} - Google Drive</title></head><body>
          <button guidedhelpid="new_menu_button" aria-label="Mới" aria-expanded="${ariaExp}" id="btn-new" style="position:fixed;left:16px;top:16px;width:96px;height:40px;z-index:10;">+ Mới</button>
          <ul id="new-menu" role="menu" style="display:${preOpenDisplay};position:fixed;left:8px;top:8px;width:280px;margin:0;padding:8px;list-style:none;background:#fff;border:1px solid #ccc;z-index:999;">
            <li tabindex="0" data-key="1" role="menuitem" id="mi-folder" style="height:44px;line-height:44px;">Thư mục mới</li>
            <li tabindex="0" data-key="2" role="menuitem" id="mi-upload" style="height:44px;line-height:44px;">Tải tệp lên</li>
            <li tabindex="0" data-key="3" role="menuitem" id="mi-gs" style="height:44px;line-height:44px;">Google Trang tính</li>
          </ul>
          <div id="dlg-new-folder" role="dialog" style="display:none;position:fixed;left:120px;top:120px;background:#fff;border:1px solid #000;padding:12px;">
            <div>Thư mục mới</div>
            <input type="text" id="nf-input" />
            <button type="button" id="nf-create">Tạo</button>
          </div>
          <input type="file" id="hidden-file" multiple style="display:none;" />
          <div id="ctx-menu" role="menu" style="display:none;position:fixed;left:160px;top:160px;background:#fff;border:1px solid #000;z-index:1000;">
            <div role="menuitem" id="mi-trash">Chuyển vào thùng rác</div>
          </div>
          <div id="dlg-trash-confirm" role="dialog" style="display:none;position:fixed;left:140px;top:140px;background:#fff;border:1px solid #c00;padding:12px;z-index:1100;">
            <div>Thư mục dùng chung: Mục này sẽ bị xóa khỏi thư mục được chia sẻ.</div>
            <button type="button" id="btn-trash-confirm">Chuyển vào thùng rác</button>
          </div>
          <main role="main" style="margin-top:260px;">
            ${children
              .map((c) => {
                const t = c.isFolder ? "folder" : "file";
                return `<div data-target="doc" data-id="${c.id}" data-type="${t}" data-mime-type="${c.mimeType}" style="padding:6px;border-bottom:1px solid #eee;"><div data-id="${c.id}">${c.name}</div></div>`;
              })
              .join("")}
          </main>
          <script>
            const folderId = ${JSON.stringify(folderId)};
            let ctxId = '';
            document.getElementById('btn-new').onclick = () => {
              document.getElementById('new-menu').style.display = 'block';
              document.getElementById('btn-new').setAttribute('aria-expanded', 'true');
            };
            document.addEventListener('keydown', (e) => {
              if (e.key === 'Escape') {
                document.getElementById('new-menu').style.display = 'none';
                document.getElementById('ctx-menu').style.display = 'none';
                document.getElementById('btn-new').setAttribute('aria-expanded', 'false');
              }
            });
            document.getElementById('mi-folder').onclick = () => {
              document.getElementById('new-menu').style.display = 'none';
              document.getElementById('dlg-new-folder').style.display = 'block';
            };
            document.getElementById('nf-create').onclick = async () => {
              const name = document.getElementById('nf-input').value;
              await fetch('/api/create-folder', { method: 'POST', body: JSON.stringify({ parentId: folderId, name }) });
              location.reload();
            };
            document.getElementById('mi-upload').onclick = () => {
              document.getElementById('new-menu').style.display = 'none';
              document.getElementById('hidden-file').click();
            };
            document.getElementById('hidden-file').onchange = async (e) => {
              const list = Array.from(e.target.files || []);
              for (const f of list) {
                const body = new Uint8Array(await f.arrayBuffer());
                await fetch('/api/upload-file?parentId=' + folderId + '&fileName=' + encodeURIComponent(f.name), { method: 'POST', body });
              }
              location.reload();
            };
            document.getElementById('mi-gs').onclick = async () => {
              document.getElementById('new-menu').style.display = 'none';
              const r = await fetch('/api/create-sheet', { method: 'POST', body: JSON.stringify({ parentId: folderId }) });
              window.open((await r.json()).editUrl, '_blank');
            };
            document.querySelectorAll('[data-target="doc"]').forEach((el) => {
              el.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                ctxId = el.getAttribute('data-id');
                document.getElementById('new-menu').style.display = 'none';
                document.getElementById('ctx-menu').style.display = 'block';
              });
            });
            document.getElementById('mi-trash').onclick = () => {
              document.getElementById('ctx-menu').style.display = 'none';
              document.getElementById('dlg-trash-confirm').style.display = 'block';
            };
            document.getElementById('btn-trash-confirm').onclick = async () => {
              await fetch('/api/trash-confirm-log', { method: 'POST' });
              await fetch('/api/trash', { method: 'POST', body: JSON.stringify({ id: ctxId }) });
              location.reload();
            };
          </script>
        </body></html>`);
        return;
      }

      res.writeHead(404).end();
    });

    await new Promise<void>((resolve) => mockServer!.listen(0, "127.0.0.1", () => resolve()));
    const mockPort = (mockServer.address() as any).port;
    const mockBaseUrl = `http://127.0.0.1:${mockPort}`;

    browser = await chromium.launch({ headless: true });
    const driveContext = await browser.newContext();

    // Forward https://drive.google.com/** and https://docs.google.com/** to local mock server
    await driveContext.route(/^https:\/\/(drive|docs)\.google\.com\//i, async (route) => {
      const req = route.request();
      const parsed = new URL(req.url());
      const targetUrl = `${mockBaseUrl}${parsed.pathname}${parsed.search}`;
      const method = req.method();
      const postBuf = req.postDataBuffer();
      const resp = await fetch(targetUrl, {
        method,
        headers: req.headers() as Record<string, string>,
        body:
          method !== "GET" && method !== "HEAD" && postBuf
            ? new Uint8Array(postBuf)
            : undefined,
      });
      const bodyBuf = Buffer.from(await resp.arrayBuffer());
      await route.fulfill({
        status: resp.status,
        headers: Object.fromEntries(resp.headers.entries()),
        body: bodyBuf,
      });
    });

    const drivePage = await driveContext.newPage();
    BrowserManager.prototype.getPage = async () => drivePage;

    // =========================================================================
    // Seed spck_uploads for JSB_TUAN (confirmed) & JSB_EMPTY (confirmed)
    // =========================================================================
    spckUploadRepo.upsert({
      classId,
      studentId: "JSB_TUAN",
      localFolderPath: tuanDir,
      matchScore: 1.0,
      isConfirmedByTeacher: 1,
      projectTitle: "Website Ban Hang JSB16",
      baseProjectTitle: "Website Ban Hang JSB16",
      thumbnailPath: path.join(tempConfigDir, "default-spck-thumbnail.png"),
      screenshotsJson: "[]",
      attachmentsJson: "[]",
      youtubeUrlsJson: "[]",
      relatedLinksJson: JSON.stringify([
        {
          name: "Link Google Drive SPCK (Nguyễn Minh Tuấn)",
          url: `https://drive.google.com/drive/folders/${tuanDriveFolderId}`,
        },
        {
          name: "Link cũ không còn dùng",
          url: "https://old-demo.example.com/v1",
        },
      ]),
      teacherComment: "- Nhận xét nháp.",
      status: "WAITING_APPROVAL",
      contentHash: "",
    });
    spckUploadRepo.upsert({
      classId,
      studentId: "JSB_EMPTY",
      localFolderPath: emptyStuDir,
      matchScore: 1.0,
      isConfirmedByTeacher: 1,
      projectTitle: "Empty Student Project",
      baseProjectTitle: "Empty Student Project",
      thumbnailPath: path.join(tempConfigDir, "default-spck-thumbnail.png"),
      screenshotsJson: "[]",
      attachmentsJson: "[]",
      youtubeUrlsJson: "[]",
      relatedLinksJson: JSON.stringify([
        { name: "Resource mới chưa đồng bộ", url: "https://should-not-sync-on-fail.example.com" },
      ]),
      teacherComment: "",
      status: "DRAFT",
      contentHash: "",
    });
    spckSessionRepo.saveSessionDraft({
      classId,
      studentId: "JSB_TUAN",
      sessionNumber: 13,
      localFolderPath: tuanDir,
      isConfirmedByTeacher: 1,
      projectTitle: "Website Ban Hang JSB16",
      thumbnailPath: path.join(tempConfigDir, "default-spck-thumbnail.png"),
      screenshotsJson: "[]",
      attachmentsJson: "[]",
      youtubeUrlsJson: "[]",
      relatedLinksJson: "[]",
      teacherComment: "- Nhận xét nháp.",
    });
    spckSessionRepo.saveSessionDraft({
      classId,
      studentId: "JSB_EMPTY",
      sessionNumber: 13,
      localFolderPath: emptyStuDir,
      isConfirmedByTeacher: 1,
      projectTitle: "Empty Student Project",
      thumbnailPath: path.join(tempConfigDir, "default-spck-thumbnail.png"),
      screenshotsJson: "[]",
      attachmentsJson: "[]",
      youtubeUrlsJson: "[]",
      relatedLinksJson: JSON.stringify([
        { name: "Link giữ nguyên", url: "https://keep-when-fail.example.com" },
      ]),
      teacherComment: "",
    });

    // =========================================================================
    // R353-01 & R353-02: Chromium E2E `VT-JSB16` stuck `+ Mới` menu + Clean Drive Re-upload
    // =========================================================================
    console.log("1. [R353-01 & R353-02] Kiểm tra VT-JSB16 vượt kẹt menu `+ Mới`, xóa sạch file cũ Drive & lọc tuyệt đối file Bot...");
    const tStart = Date.now();
    const uploadDriveHttpRes = await uploadDrivePost(
      makeLocalRequest("http://127.0.0.1:3000/api/spck/upload-drive", "POST", {
        classId,
        sessionNumber: 13,
        syncActiveSession: true,
        studentIds: ["JSB_TUAN", "JSB_EMPTY"],
        uploadMode: "tree",
      })
    );
    assert.strictEqual(uploadDriveHttpRes.status, 200);
    const uploadDrivePayload = (await uploadDriveHttpRes.json()) as any;
    const driveBatch = uploadDrivePayload.driveResult;
    const elapsedMs = Date.now() - tStart;
    assert.ok(
      elapsedMs < 45_000,
      `Kỳ vọng vượt qua lỗi + Mới nhanh chóng (<45s cho toàn batch 2 HS + cold Chromium), thực tế mất ${elapsedMs}ms`
    );
    assert.strictEqual(newBtnRawClicksBlockedByMenu, 0);

    // Verify selective sync on POST /api/spck/upload-drive: JSB_TUAN synced, JSB_EMPTY NOT synced!
    const tuanS13AfterDrive = spckSessionRepo.findOne(classId, "JSB_TUAN", 13)!;
    const emptyS13AfterDrive = spckSessionRepo.findOne(classId, "JSB_EMPTY", 13)!;
    assert.ok(
      tuanS13AfterDrive.relatedLinksJson.includes(tuanDriveFolderId),
      "HS thành công upload-drive phải được đồng bộ link Drive mới vào Buổi 13"
    );
    assert.ok(
      emptyS13AfterDrive.relatedLinksJson.includes("https://keep-when-fail.example.com") &&
        !emptyS13AfterDrive.relatedLinksJson.includes("should-not-sync-on-fail"),
      "HS thất bại upload-drive (JSB_EMPTY) không được bị đồng bộ đè tài nguyên vào Buổi 13!"
    );

    const tuanRes = driveBatch.results.find((r: any) => r.studentId === "JSB_TUAN")!;
    const emptyRes = driveBatch.results.find((r: any) => r.studentId === "JSB_EMPTY")!;
    assert.strictEqual(
      tuanRes.status,
      "SUCCESS",
      `JSB_TUAN phải tải lên thành công, lỗi nhận được: ${tuanRes.errorMessage}`
    );
    assert.strictEqual(
      tuanRes.driveFolderId,
      tuanDriveFolderId,
      "Phải giữ nguyên ID và Link thư mục Google Drive của học sinh từ Buổi 12!"
    );

    // Assert Shared-Folder trash confirmation dialog was clicked & old items trashed BEFORE upload
    assert.ok(
      sharedTrashModalConfirmClicks >= 3,
      `Phải bấm xác nhận hộp thoại 'Chuyển vào thùng rác?' của Thư mục dùng chung ít nhất 3 lần, thực tế: ${sharedTrashModalConfirmClicks}`
    );
    for (const oldId of [
      "OLD_TUAN_INDEX_1234567890",
      "OLD_TUAN_UNUSED_JS_1234567",
      "OLD_TUAN_SUBFOLDER_1234567",
    ]) {
      assert.strictEqual(
        items.get(oldId)?.trashed,
        true,
        `Mục cũ từ Buổi 12 (${oldId}) bắt buộc phải được chuyển vào Thùng rác trước khi tải bài mới.`
      );
    }
    assert.strictEqual(
      duplicateConflictsDetected.length,
      0,
      `Không được phép phát sinh trùng file hay (1) khi đã dọn sạch trước upload: ${JSON.stringify(duplicateConflictsDetected)}`
    );

    // Verify uploaded children in Tuan's Drive folder & `assets` subfolder
    const liveTuanRootItems = Array.from(items.values()).filter(
      (i) => !i.trashed && i.parentId === tuanDriveFolderId
    );
    const liveTuanRootNames = liveTuanRootItems.map((i) => i.name).sort();
    assert.deepStrictEqual(
      liveTuanRootNames,
      ["assets", "index.html", "new_feature.js", "tai_lieu_hoc_sinh.zip"].sort(),
      `Thư mục gốc trên Drive của Tuấn chỉ được chứa bài làm hợp lệ của HS (kể cả zip thật của HS), không được chứa file Bot/rác: ${JSON.stringify(liveTuanRootNames)}`
    );
    const uploadedIndex = liveTuanRootItems.find((i) => i.name === "index.html");
    assert.ok(
      uploadedIndex?.contentText?.includes("JSB16 Tuan v2 Updated"),
      "File index.html trên Drive phải là phiên bản mới nhất của Buổi 13!"
    );
    const assetsFolder = liveTuanRootItems.find((i) => i.name === "assets" && i.isFolder);
    assert.ok(assetsFolder, "Thư mục con assets phải được tạo lại trên Drive");
    const assetsChildren = Array.from(items.values())
      .filter((i) => !i.trashed && i.parentId === assetsFolder!.id)
      .map((i) => i.name);
    assert.deepStrictEqual(assetsChildren, ["hero.png"]);

    // Verify EMPTY student failed safely BEFORE trashing any existing remote Drive files!
    assert.strictEqual(emptyRes.status, "FAILED");
    assert.strictEqual(
      items.get("EMPTY_STU_IMPORTANT_S12_ID")?.trashed,
      undefined,
      "AN TOÀN TUYỆT ĐỐI: Khi thư mục máy tính của HS rỗng (0 file hợp lệ), KHÔNG ĐƯỢC xóa bài cũ trên Drive!"
    );

    // Also test Demo Sheet with the exact same stuck `+ Mới` (`aria-expanded="true"`) UI
    const demoSheetOut = await createAndUploadClassDemoSheetToDrive({
      classId,
      enableAiPreScore: false,
      _testHarness: {
        page: drivePage,
        driveBaseUrl: mockBaseUrl,
        sheetsBaseUrl: mockBaseUrl,
      },
    });
    assert.ok(
      demoSheetOut.googleSheetUrl?.includes("/spreadsheets/d/GSHEET_"),
      `Expected native Google Sheet URL, got: ${demoSheetOut.googleSheetUrl}`
    );
    console.log("  -> PASS R353-01 & R353-02.");

    // =========================================================================
    // R353-03: Re-Scan + Re-Capture Screenshots + Auto-Sync Session 13
    // =========================================================================
    console.log("2. [R353-03] Kiểm tra quét lại & chụp lại ảnh tự động cập nhật Buổi 13 đã VERIFIED mà không làm hỏng Buổi 12 hoặc bạn không sửa bài...");
    // Clear R353-01/02 bindings so R353-03 binds cleanly to `syncTestClassDir`
    db.prepare(`DELETE FROM spck_session_submissions WHERE classId = ?`).run(classId);
    db.prepare(`DELETE FROM spck_uploads WHERE classId = ?`).run(classId);
    // Reset to a clean deterministic pair of web folders (`JSB_TUAN` & `JSB_HUY`) outside tempSpckRoot
    const syncTestClassDir = path.join(tempRoot, "sync_test_workspace", "JSB16");
    const cleanTuanDir = path.join(syncTestClassDir, "Nguyen Minh Tuan");
    const cleanHuyDir = path.join(syncTestClassDir, "Le Gia Huy");
    fs.mkdirSync(cleanTuanDir, { recursive: true });
    fs.mkdirSync(cleanHuyDir, { recursive: true });
    fs.writeFileSync(
      path.join(cleanTuanDir, "index.html"),
      "<!doctype html><html><body style='background:#111827;color:#fff'><h1>Tuan V1</h1></body></html>",
      "utf-8"
    );
    fs.writeFileSync(path.join(cleanHuyDir, "index.html"), huyHtmlV1, "utf-8");

    // Step A: Initial Scan on Session 12 -> Approve & Mark Verified on Session 12 & 13 for BOTH students
    const initialScanRes = await scanPost(
      makeLocalRequest("http://127.0.0.1:3000/api/spck/scan", "POST", {
        classId,
        sessionNumber: 12,
        folderPath: syncTestClassDir,
        syncActiveSession: true,
      })
    );
    const initialScanBody = await initialScanRes.json();
    assert.strictEqual(
      initialScanRes.status,
      200,
      `scanPost initial failed: ${JSON.stringify(initialScanBody)}`
    );

    // Mark BOTH Tuan and Huy VERIFIED for Session 12 AND Session 13
    for (const sid of ["JSB_TUAN", "JSB_HUY"]) {
      const shared = spckUploadRepo.findOne(classId, sid)!;
      for (const slot of [12, 13] as const) {
        const draft = spckSessionRepo.getOrInitSessionDraft(classId, sid, slot);
        const saved = spckSessionRepo.saveSessionDraft({
          classId,
          studentId: sid,
          sessionNumber: slot,
          localFolderPath: shared.localFolderPath,
          isConfirmedByTeacher: 1,
          projectTitle: slot === 12 ? `SPCK ${sid} - Giai đoạn 1` : `SPCK ${sid} - Giai đoạn 1`,
          thumbnailPath: shared.thumbnailPath,
          screenshotsJson: shared.screenshotsJson,
          attachmentsJson: shared.attachmentsJson,
          youtubeUrlsJson: shared.youtubeUrlsJson,
          relatedLinksJson: shared.relatedLinksJson,
          teacherComment: `- Buổi ${slot} nhận xét chuẩn.`,
        }).record;
        const appRes = spckSessionRepo.approveSessionDraft(
          classId,
          sid,
          slot,
          saved.draftVersion
        );
        assert.strictEqual(appRes.success, true);
        spckSessionRepo.markSessionVerifiedFromUpload(
          classId,
          sid,
          slot,
          {
            ...shared,
            projectTitle: appRes.record.projectTitle,
            teacherComment: appRes.record.teacherComment,
            contentHash: appRes.record.approvedContentHash,
          },
          `2026-11-15T10:0${slot}:00`,
          `LMS_WORK_${sid}_${slot}`
        );
      }
    }

    const tuanS12HashBefore = spckSessionRepo.findOne(classId, "JSB_TUAN", 12)!.lastVerifiedHash;
    assert.strictEqual(spckSessionRepo.findOne(classId, "JSB_TUAN", 13)!.draftStatus, "VERIFIED");
    assert.strictEqual(spckSessionRepo.findOne(classId, "JSB_HUY", 13)!.draftStatus, "VERIFIED");

    // Step B: Now Tuan updates index.html; Huy does NOT touch anything!
    fs.writeFileSync(
      path.join(cleanTuanDir, "index.html"),
      "<!doctype html><html><body style='background:#064e3b;color:#fef08a;padding:40px'><h1>Tuan V2 Session 13 Updated!</h1><button>Play</button></body></html>",
      "utf-8"
    );

    const rescan13Res = await scanPost(
      makeLocalRequest("http://127.0.0.1:3000/api/spck/scan", "POST", {
        classId,
        sessionNumber: 13,
        folderPath: syncTestClassDir,
        syncActiveSession: true,
      })
    );
    const rescan13Body = await rescan13Res.json();
    assert.strictEqual(
      rescan13Res.status,
      200,
      `rescan13Post failed: ${JSON.stringify(rescan13Body)}`
    );

    const tuanS12AfterScan = spckSessionRepo.findOne(classId, "JSB_TUAN", 12)!;
    const tuanS13AfterScan = spckSessionRepo.findOne(classId, "JSB_TUAN", 13)!;
    const huyS12AfterScan = spckSessionRepo.findOne(classId, "JSB_HUY", 12)!;
    const huyS13AfterScan = spckSessionRepo.findOne(classId, "JSB_HUY", 13)!;

    assert.strictEqual(
      tuanS12AfterScan.draftStatus,
      "VERIFIED",
      "Lịch sử Buổi 12 của Tuấn phải giữ nguyên VERIFIED khi quét lại ở Buổi 13!"
    );
    assert.strictEqual(tuanS12AfterScan.lastVerifiedHash, tuanS12HashBefore);
    assert.strictEqual(
      tuanS13AfterScan.draftStatus,
      "WAITING_APPROVAL",
      "Tuấn sửa code -> Buổi 13 tự động cập nhật zip mới và hạ về WAITING_APPROVAL!"
    );
    assert.strictEqual(
      huyS12AfterScan.draftStatus,
      "VERIFIED",
      "Huy không sửa bài -> Buổi 12 giữ nguyên VERIFIED"
    );
    assert.strictEqual(
      huyS13AfterScan.draftStatus,
      "VERIFIED",
      "Huy không sửa bài -> Buổi 13 vẫn phải giữ nguyên VERIFIED (không bị hạ trạng thái oan)!"
    );

    // Step C: Test re-capturing screenshots on Session 13 for BOTH a previously VERIFIED row and WAITING_APPROVAL row!
    // Force Huy S13 to have an initial captured shot first, then verify re-capture on Session 13 updates Tuấn directly.
    await captureClassAppScreenshotsAndSelectThumbnails({
      classId,
      studentIds: ["JSB_TUAN"],
      useAiVision: false,
      sessionNumber: 13,
    });
    const tuanS13AfterCap = spckSessionRepo.findOne(classId, "JSB_TUAN", 13)!;
    assert.ok(
      tuanS13AfterCap.thumbnailPath.includes("_spck_app_shots"),
      `Chụp lại ảnh với sessionNumber=13 phải tự đồng bộ Thumbnail mới vào bản nháp Buổi 13: ${tuanS13AfterCap.thumbnailPath}`
    );

    // Even if Tuấn was VERIFIED again and then HTML changed and teacher clicked `Chụp Giao Diện Web` directly on Session 13:
    const capApp = spckSessionRepo.approveSessionDraft(
      classId,
      "JSB_TUAN",
      13,
      tuanS13AfterCap.draftVersion
    );
    assert.strictEqual(capApp.success, true);
    const sharedTuanNow = spckUploadRepo.findOne(classId, "JSB_TUAN")!;
    spckSessionRepo.markSessionVerifiedFromUpload(
      classId,
      "JSB_TUAN",
      13,
      {
        ...sharedTuanNow,
        projectTitle: capApp.record.projectTitle,
        teacherComment: capApp.record.teacherComment,
        contentHash: capApp.record.approvedContentHash,
      },
      "2026-11-15T11:00:00",
      "LMS_WORK_TUAN_13"
    );
    fs.writeFileSync(
      path.join(cleanTuanDir, "index.html"),
      "<!doctype html><html><body style='background:#7c2d12;color:#ffffff;padding:48px'><h1>Tuan V3 Direct Screenshot Recapture!</h1></body></html>",
      "utf-8"
    );
    await captureClassAppScreenshotsAndSelectThumbnails({
      classId,
      studentIds: ["JSB_TUAN"],
      useAiVision: false,
      sessionNumber: 13,
    });
    const tuanS13AfterDirectRecap = spckSessionRepo.findOne(classId, "JSB_TUAN", 13)!;
    assert.strictEqual(
      tuanS13AfterDirectRecap.draftStatus,
      "WAITING_APPROVAL",
      "Khi đang VERIFIED ở Buổi 13 mà chụp lại được ảnh giao diện mới, Buổi 13 tự đồng bộ ảnh mới & hạ về WAITING_APPROVAL!"
    );
    assert.notStrictEqual(
      tuanS13AfterDirectRecap.thumbnailPath,
      sharedTuanNow.thumbnailPath,
      "Thumbnail trong Buổi 13 phải đổi sang ảnh chụp mới nhất!"
    );
    console.log("  -> PASS R353-03.");

    // =========================================================================
    // R353-04: Chromium Real LMS Modal Stale Related Links Cleanup + Read-after-Write
    // =========================================================================
    console.log("3. [R353-04] Kiểm tra Chromium Modal LMS tự xóa đường dẫn cũ thừa & xác minh relativeUrls sau lưu...");
    const keepDriveUrl = `https://drive.google.com/drive/folders/${tuanDriveFolderId}`;
    const keepYtUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const staleOldUrl = "https://old-demo.example.com/v1";
    const newPagesUrl = "https://mindx.github.io/jsb16/tuan-v2/";

    // Prepare approved Session 13 record for Tuan with [keepDriveUrl, newPagesUrl] + [keepYtUrl] (and NO staleOldUrl!)
    const freshTuanS13 = spckSessionRepo.findOne(classId, "JSB_TUAN", 13)!;
    const savedForLms = spckSessionRepo.saveSessionDraft({
      classId,
      studentId: "JSB_TUAN",
      sessionNumber: 13,
      expectedVersion: freshTuanS13.draftVersion,
      localFolderPath: freshTuanS13.localFolderPath,
      isConfirmedByTeacher: 1,
      projectTitle: "Website Ban Hang JSB16 v2",
      thumbnailPath: freshTuanS13.thumbnailPath,
      screenshotsJson: freshTuanS13.screenshotsJson,
      attachmentsJson: freshTuanS13.attachmentsJson,
      youtubeUrlsJson: JSON.stringify([keepYtUrl]),
      relatedLinksJson: JSON.stringify([
        { name: "Link Google Drive SPCK (Nguyễn Minh Tuấn)", url: keepDriveUrl },
        { name: "Link Web Chạy Thử (Nguyễn Minh Tuấn)", url: newPagesUrl },
      ]),
      teacherComment: "- Buổi 13 đã cập nhật giao diện & link mới.",
    }).record;
    const approvedLms = spckSessionRepo.approveSessionDraft(
      classId,
      "JSB_TUAN",
      13,
      savedForLms.draftVersion
    );
    assert.strictEqual(approvedLms.success, true);

    const newThumbSha = computeSafeFileByteDigest(savedForLms.thumbnailPath);
    const oldModalThumbUrl = "https://resources.mindx.edu.vn/old-thumb-s12.png";
    const uploadedNewThumbUrl = `https://resources.mindx.edu.vn/${path.parse(savedForLms.thumbnailPath).name}-uploaded.png`;
    let lastSavedVars: any = null;

    lmsServer = http.createServer((req, res) => {
      const u = new URL(req.url || "/", "http://127.0.0.1");
      if (u.pathname === "/mock-lms") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html><html><body>
          <div class="MuiDrawer-paper MuiDrawer-paperAnchorRight" aria-labelledby="class-detail">
            <h2>VT-JSB16</h2>
            <div role="tablist">
              <button role="tab" aria-selected="true">Nhận xét</button>
            </div>
            <div id="class-comments-slot-carousel-12" class="active">
              <div class="info-container">Buổi 13</div>
            </div>
            <div class="comment-list-table">
              <table>
                <tbody>
                  <tr>
                    <td><span class="name-display">Nguyễn Minh Tuấn</span></td>
                    <td><button type="button" id="btn-open-spck">Sản phẩm của học sinh</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="MuiDialog-root" id="spck-dialog-root" style="display:none;">
            <div class="MuiDialog-paper" role="dialog" style="padding:16px;border:1px solid #333;">
              <h2 class="MuiTypography-h6">Nguyễn Minh Tuấn</h2>
              <button type="button" id="btn-expand-detail">Xem chi tiết</button>
              <input id="title" name="title" value="Website Ban Hang JSB16 - Giai đoạn 1" />
              <div>
                <img id="modal-thumb" src="${oldModalThumbUrl}" width="160" height="90" />
                <button type="button" id="btn-change-thumb">Thay ảnh</button>
                <input type="file" id="thumb-input" accept="image/*" style="display:none;" />
              </div>
              <div id="yt-list">
                <div class="yt-row">
                  <a href="${keepYtUrl}">Video Demo</a>
                  <button type="button" class="btn-del-yt" aria-label="Xóa">✕</button>
                </div>
              </div>
              <div class="yt-add-wrap">
                <div class="MuiFormControl-root">
                  <input id="inputYoutube" placeholder="Nhập đường dẫn YouTube" />
                </div>
                <button type="button" id="btn-add-yt">+ Thêm</button>
              </div>
              <div class="rel-add-wrap">
                <input id="inputRelativeUrlName" placeholder="Đặt tên đường dẫn" />
                <input id="inputRelativeUrl" placeholder="Nhập đường dẫn" />
                <button type="button" id="btn-add-rel">+ Thêm</button>
              </div>
              <div id="rel-list">
                <div class="rel-row" data-url="${staleOldUrl}">
                  <a href="${staleOldUrl}">Link cũ</a>
                  <button type="button" class="btn-del-rel" aria-label="Xóa">✕</button>
                </div>
                <div class="rel-row" data-url="${keepDriveUrl}">
                  <a href="${keepDriveUrl}">Link Drive</a>
                  <button type="button" class="btn-del-rel" aria-label="Xóa">✕</button>
                </div>
                <div class="rel-row" data-url="${keepDriveUrl}">
                  <a href="${keepDriveUrl}">Link Drive (trùng)</a>
                  <button type="button" class="btn-del-rel" aria-label="Xóa">✕</button>
                </div>
              </div>
              <textarea id="comment" name="comment">Old comment</textarea>
              <button type="submit" id="btn-save">Save</button>
            </div>
          </div>
          <script>
            document.getElementById('btn-open-spck').onclick = () => {
              document.getElementById('spck-dialog-root').style.display = 'block';
            };
            document.addEventListener('keydown', (e) => {
              if (e.key === 'Escape') {
                document.getElementById('spck-dialog-root').style.display = 'none';
              }
            });
            document.getElementById('btn-change-thumb').onclick = () => {
              document.getElementById('thumb-input').click();
            };
            document.getElementById('thumb-input').onchange = async () => {
              const upRes = await fetch('https://resources.mindx.edu.vn/upload', {
                method: 'POST',
                body: 'thumb',
              });
              const upData = await upRes.json();
              document.getElementById('modal-thumb').src = upData.url || ${JSON.stringify(uploadedNewThumbUrl)};
            };
            document.getElementById('btn-add-rel').onclick = () => {
              const name = document.getElementById('inputRelativeUrlName').value;
              const url = document.getElementById('inputRelativeUrl').value;
              const row = document.createElement('div');
              row.className = 'rel-row';
              row.innerHTML = '<a href="' + url + '">' + name + '</a><button type="button" class="btn-del-rel" aria-label="Xóa">✕</button>';
              row.querySelector('.btn-del-rel').onclick = () => row.remove();
              document.getElementById('rel-list').appendChild(row);
            };
            document.querySelectorAll('.btn-del-rel, .btn-del-yt').forEach((btn) => {
              btn.onclick = () => btn.parentElement.remove();
            });
            document.getElementById('btn-save').onclick = async () => {
              const title = document.getElementById('title').value;
              const comment = document.getElementById('comment').value;
              const relativeUrls = Array.from(document.querySelectorAll('#rel-list a')).map((a) => ({
                name: a.textContent,
                url: a.getAttribute('href'),
              }));
              await fetch('/graphql', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  operationName: 'UpdateStudentWork',
                  variables: { title, comment, relativeUrls },
                }),
              });
            };
          </script>
        </body></html>`);
        return;
      }

      if (req.method === "POST" && u.pathname === "/graphql") {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          const parsed = JSON.parse(raw);
          const vars = parsed.variables || {};
          lastSavedVars = vars;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              data: {
                studentWorks: {
                  update: {
                    id: "LMS_WORK_TUAN_13",
                    latestData: {
                      title: vars.title,
                      comment: vars.comment,
                      thumbnail: {
                        url: uploadedNewThumbUrl,
                        byteSha256: newThumbSha,
                      },
                      attachments: [],
                      screenshots: [],
                      relativeUrls: vars.relativeUrls,
                    },
                  },
                },
              },
            })
          );
        });
        return;
      }

      res.writeHead(404).end();
    });

    await new Promise<void>((resolve) => lmsServer!.listen(0, "127.0.0.1", () => resolve()));
    const lmsPort = (lmsServer.address() as any).port;

    const lmsContext = await browser.newContext();
    await lmsContext.route(/^https:\/\/resources\.mindx\.edu\.vn\//i, async (route) => {
      const req = route.request();
      if (req.method().toUpperCase() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ url: uploadedNewThumbUrl }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: MINIMAL_PNG_BUF,
      });
    });

    const lmsPage = await lmsContext.newPage();
    await lmsPage.goto(`http://127.0.0.1:${lmsPort}/mock-lms`, { waitUntil: "domcontentloaded" });

    const baseTuanRec = spckUploadRepo.findOne(classId, "JSB_TUAN")!;
    const modalUploadRes = await (SpckUploader as any).uploadSingleStudentViaRealLmsModal({
      page: lmsPage,
      interceptor: { dismissForbiddenToast: async () => {} },
      normalizedClassId: classId,
      targetSessionNumber: 13,
      record: {
        ...baseTuanRec,
        projectTitle: approvedLms.record.projectTitle,
        thumbnailPath: approvedLms.record.thumbnailPath,
        teacherComment: approvedLms.record.teacherComment,
        contentHash: approvedLms.record.approvedContentHash,
      },
      fullName: "Nguyễn Minh Tuấn",
      studentsInClass: [{ studentId: "JSB_TUAN", fullName: "Nguyễn Minh Tuấn" }],
      expectedHash: approvedLms.record.approvedContentHash,
      screenshots: [],
      attachments: [],
      youtubeUrls: [keepYtUrl],
      relatedLinks: [
        { name: "Link Google Drive SPCK (Nguyễn Minh Tuấn)", url: keepDriveUrl },
        { name: "Link Web Chạy Thử (Nguyễn Minh Tuấn)", url: newPagesUrl },
      ],
    });

    const finalDomUrls = await lmsPage.evaluate(() =>
      Array.from(document.querySelectorAll("#rel-list a")).map((a) =>
        a.getAttribute("href")
      )
    );
    const finalYtUrls = await lmsPage.evaluate(() =>
      Array.from(document.querySelectorAll("#yt-list a")).map((a) =>
        a.getAttribute("href")
      )
    );
    assert.ok(
      !finalDomUrls.includes(staleOldUrl),
      `Link cũ (${staleOldUrl}) bắt buộc phải bị xóa khỏi Modal LMS trước khi lưu! DOM hiện tại: ${JSON.stringify(finalDomUrls)}`
    );
    assert.deepStrictEqual(
      finalDomUrls,
      [keepDriveUrl, newPagesUrl],
      `Danh sách Đường dẫn liên quan trên Modal phải khớp chính xác bản đã duyệt (xóa link cũ & link trùng, giữ 1 link Drive & thêm link Web mới)!`
    );
    assert.deepStrictEqual(
      finalYtUrls,
      [keepYtUrl],
      `Link YouTube trên Modal tuyệt đối không được bị xóa bởi vòng dọn relatedLinks!`
    );
    assert.deepStrictEqual(
      (lastSavedVars?.relativeUrls || []).map((r: any) => r.url),
      [keepDriveUrl, newPagesUrl],
      "Payload GraphQL UpdateStudentWork gửi lên LMS phải chứa đúng [keepDriveUrl, newPagesUrl]"
    );
    assert.strictEqual(modalUploadRes.reusedExistingItem01, true);
    assert.strictEqual(modalUploadRes.relatedLinksAddedCount, 1);
    assert.strictEqual(modalUploadRes.youtubeAddedCount, 0);
    assert.ok(computeSpckContentHash(approvedLms.record).length === 64);
    console.log("  -> PASS R353-04.");

    console.log("\n=== TẤT CẢ 4 KỊCH BẢN KIỂM THỬ v3.5.3 (R353-01 → R353-04) ĐÃ ĐẠT 100% ===");
  } finally {
    BrowserManager.prototype.getPage = origGetPage;
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (mockServer) {
      mockServer.close();
    }
    if (lmsServer) {
      lmsServer.close();
    }
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore Windows SQLite handle close race
    }
  }
}

run().catch((err) => {
  console.error("[FAIL] test-spck-reupload-v353:", err);
  process.exit(1);
});
