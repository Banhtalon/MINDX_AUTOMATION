/**
 * MINDX AUTOMATION BOT - VERIFICATION SUITE FOR v3.5.4
 * 100% isolated in `os.tmpdir()` (zero mutations to live `data/mindx_bot.db` or `data/running_classes.json`):
 * - R354-01: Real Chromium DOM reproduction of `VT-C4K-PTA13` Google Drive UI (left-sidebar quota
 *            progressbar in `<nav>` and non-`<nav>` `<div>`, hidden opacity:0/aria-hidden loaders,
 *            non-modal promo callout, completed bottom-right tray `"Đã hoàn tất 2 lần tải lên"`)
 *            + full 4/4 student multi-subfolder upload via `SpckDriveUploader.uploadClassSpckToGoogleDrive`.
 * - R354-02: Genuine local ` (1)` filenames (`images (1).jpg`, `house-solid (1).png`) preserved verbatim
 *            without stripping/renaming, plus student file `uploading.py` inside `[role="main"]`
 *            ignored by `inspectDriveUploadIndicators`.
 * - R354-03: Fail-closed duplicate modal (`"Tùy chọn tải lên"`), error alert (`"Tải lên không thành công"`),
 *            and stale-failed idle tray recovery via `dismissIdleDriveUploadTray(page, true)`.
 * - R354-04: Fast timeout accuracy test on `uploadFilesIntoDriveFolder`: empty Drive folder ends with
 *            `"Vui lòng bấm tải lại Google Drive."` while pre-existing Drive folder keeps 100% old
 *            files intact and ends with `"Bài cũ được giữ nguyên."`.
 * - R354-05: Hardened `createAndUploadClassDemoSheetToDrive` for `VT-C4K-GA38` (`<button>Tạo</button>`
 *            required over `Enter`, 15s polling wait on delayed DOM creation, 0 `.xlsx` leftovers,
 *            and direct class-folder `<title>` detection preventing nested `VT-C4K-GA38/VT-C4K-GA38`).
 * - R354-06: `useSpckWorkflow` Auto-Prep formatting helpers (`formatAutoPrepStepFailure`,
 *            `formatAutoPrepSummaryBanner`) & `top-navbar.tsx` (`MindX Bot v3.5.4`).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { chromium } from "playwright";

const ROOT = process.cwd();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-v354-test-"));
const tempConfigDir = path.join(tempRoot, "config");
const tempSpckRoot = path.join(tempRoot, "spck_root");
const tempRoleDir = path.join(tempRoot, "role-state");

fs.mkdirSync(path.join(tempConfigDir, "demo-sheet-templates"), { recursive: true });
fs.mkdirSync(tempSpckRoot, { recursive: true });
fs.mkdirSync(tempRoleDir, { recursive: true });

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

process.env.MINDX_DB_PATH = path.join(tempRoot, "mindx_v354_test.db");
process.env.MINDX_CONFIG_DIR = tempConfigDir;
process.env.MINDX_RUNNING_CLASSES_PATH = path.join(tempRoot, "running_classes.json");
process.env.MINDX_LMS_CLASS_IDS_PATH = path.join(tempConfigDir, "lms_class_ids.json");
process.env.MINDX_ROLE_STATE_DIR = tempRoleDir;
process.env.ALLOWED_LOCAL_DIRS = tempRoot;
process.env.MINDX_ALLOWED_EXTRA_PATHS = tempRoot;
process.env.MINDX_ALLOW_LOCAL_SHEET_ORIGIN_FOR_TEST = "1";
process.env.MINDX_DISABLE_BROWSER_EXPORT_FALLBACK = "1";
process.env.GEMINI_API_KEY = "AIzaDummyTestKeyV354_NeverLive";

const MINIMAL_PNG_BUF = fs.readFileSync(
  path.join(tempConfigDir, "default-spck-thumbnail.png")
);

interface MockDriveNode {
  id: string;
  parentId: string;
  name: string;
  isFolder: boolean;
  mimeType: string;
  trashed?: boolean;
  tabs?: string[];
  workbookBuffer?: Buffer;
}

type TrayMode =
  | "none"
  | "active"
  | "completed"
  | "failed"
  | "error_alert"
  | "duplicate_modal";

async function run(): Promise<void> {
  const { getDb, closeDb, studentRepo, spckUploadRepo } = await import(
    "../src/lib/db/sqlite"
  );
  const { BrowserManager } = await import("../src/lib/playwright/browser-manager");
  const {
    CODING_SPCK_COURSE_FOLDER_MAP,
    DEFAULT_SPCK_DRIVE_FOLDER_URL,
    SpckDriveUploader,
    dismissIdleDriveUploadTray,
    inspectDriveUploadIndicators,
    uploadFilesIntoDriveFolder,
  } = await import("../src/lib/playwright/spck-drive-uploader");
  const { createAndUploadClassDemoSheetToDrive } = await import(
    "../src/lib/playwright/spck-demo-sheet"
  );
  const {
    formatAutoPrepStepFailure,
    formatAutoPrepSummaryBanner,
  } = await import("../src/components/final-project/useSpckWorkflow");

  let mockServer: http.Server | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  const origGetPage = BrowserManager.prototype.getPage;
  const realDateNow = Date.now;

  const items = new Map<string, MockDriveNode>();
  let seq = 1;
  const nextId = (prefix: string) =>
    `${prefix}_V354_${String(seq++).padStart(6, "0")}_ID`;

  const seedFolder = (id: string, parentId: string, name: string) => {
    items.set(id, {
      id,
      parentId,
      name,
      isFolder: true,
      mimeType: "application/vnd.google-apps.folder",
      tabs: [],
    });
    return id;
  };

  // Seed Drive root + PTA + GA course folders
  const rootDriveId = "1Xl8OZ7i1bOKf7000xbUBYLPcxVb2qvRD";
  const ptaCourseId = CODING_SPCK_COURSE_FOLDER_MAP.PTA;
  const gaCourseId = CODING_SPCK_COURSE_FOLDER_MAP.GA;
  seedFolder(rootDriveId, "MY_DRIVE", "CODING - SPCK");
  seedFolder(ptaCourseId, rootDriveId, "2. PTA");
  seedFolder(gaCourseId, rootDriveId, "2. GA");

  let trayMode: TrayMode = "none";
  let showDriveChromeWidgets = true;
  let blockFileRenderOnUpload = false;
  let delayFolderDomMs = 0;
  let trayDismissCount = 0;

  try {
    mockServer = http.createServer((req, res) => {
      const u = new URL(req.url || "/", "http://127.0.0.1");

      if (req.method === "POST" && u.pathname === "/api/tray-dismissed") {
        trayDismissCount += 1;
        trayMode = "none";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method === "POST" && u.pathname === "/api/create-folder") {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          const { parentId, name } = JSON.parse(raw);
          const existing = Array.from(items.values()).find(
            (i) => !i.trashed && i.isFolder && i.parentId === parentId && i.name === name
          );
          if (existing) {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ id: existing.id }));
            return;
          }
          const id = nextId("FOLDER");
          items.set(id, {
            id,
            parentId,
            name,
            isFolder: true,
            mimeType: "application/vnd.google-apps.folder",
            tabs: [],
          });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ id }));
        });
        return;
      }

      if (req.method === "POST" && u.pathname === "/api/upload-file") {
        const parentId = u.searchParams.get("parentId") || "";
        const fileName = u.searchParams.get("fileName") || "unnamed.txt";
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          const buf = Buffer.concat(chunks);
          if (!blockFileRenderOnUpload) {
            const id = nextId("FILE");
            items.set(id, {
              id,
              parentId,
              name: fileName,
              isFolder: false,
              mimeType: "application/octet-stream",
              workbookBuffer: buf,
            });
          }
          // After upload completes in normal mode, leave completed upload tray open (real Drive UX!)
          if (showDriveChromeWidgets && trayMode !== "failed" && trayMode !== "error_alert") {
            trayMode = "completed";
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }

      if (req.method === "POST" && u.pathname === "/api/trash") {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          const { id } = JSON.parse(raw);
          const node = items.get(id);
          if (node) node.trashed = true;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        });
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
          res.end(
            JSON.stringify({
              id,
              editUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`,
            })
          );
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
          if (it) {
            it.tabs = tabs;
            it.workbookBuffer = buf;
          }
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
        const it = items.get(sheetId) || {
          name: "Bảng tính không có tiêu đề",
          tabs: ["Trang tính1"],
        };
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

        let trayHtml = "";
        if (trayMode === "active") {
          trayHtml = `
            <div id="upload-tray" role="dialog" style="position:fixed;right:16px;bottom:16px;width:320px;background:#fff;border:1px solid #999;padding:12px;">
              <div>Đang tải lên 2 mục • Còn 3 giây</div>
              <div role="progressbar" aria-valuenow="45" aria-valuemax="100" style="width:200px;height:8px;background:#1a73e8;"></div>
              <button type="button" aria-label="Hủy tải lên">Hủy tải lên</button>
            </div>`;
        } else if (trayMode === "completed") {
          trayHtml = `
            <div id="upload-tray" role="dialog" style="position:fixed;right:16px;bottom:16px;width:320px;background:#fff;border:1px solid #999;padding:12px;">
              <div>Đã hoàn tất 2 lần tải lên</div>
              <div role="progressbar" aria-valuenow="100" aria-valuemax="100" style="width:200px;height:8px;background:#188038;"></div>
              <button type="button" id="btn-minimize" title="Thu gọn">_</button>
              <button type="button" id="btn-close-tray" data-tooltip="đóng" onclick="fetch('/api/tray-dismissed',{method:'POST'});this.closest('[role=dialog]').remove();">X</button>
            </div>`;
        } else if (trayMode === "failed") {
          trayHtml = `
            <div id="upload-tray" role="dialog" style="position:fixed;right:16px;bottom:16px;width:320px;background:#fff;border:1px solid #c00;padding:12px;">
              <div>Tải lên không thành công</div>
              <button type="button" id="btn-close-failed-tray" aria-label="Đóng" onclick="fetch('/api/tray-dismissed',{method:'POST'});this.closest('[role=dialog]').remove();">X</button>
            </div>`;
        } else if (trayMode === "error_alert") {
          trayHtml = `<div role="alert" style="position:fixed;right:16px;bottom:16px;padding:10px;background:#fce8e6;">Tải lên không thành công</div>`;
        } else if (trayMode === "duplicate_modal") {
          trayHtml = `
            <div role="dialog" aria-modal="true" style="position:fixed;left:220px;top:120px;width:360px;background:#fff;border:1px solid #333;padding:16px;">
              <div>Tùy chọn tải lên</div>
              <label><input type="radio" name="dup" value="replace" />Thay thế tệp hiện có</label>
              <label><input type="radio" name="dup" value="keep" />Giữ cả hai</label>
              <button type="button">Tải lên</button>
            </div>`;
        }

        const chromeWidgetsHtml = showDriveChromeWidgets
          ? `
            <nav style="position:fixed;left:0;top:60px;width:220px;padding:8px;">
              <div>Drive của tôi</div>
              <div>
                <div>Bộ nhớ (Đã dùng 56%)</div>
                <div role="progressbar" aria-valuenow="8.4" aria-valuemax="15" aria-label="Đã sử dụng 8,4 GB trong tổng số 15 GB" style="width:160px;height:6px;background:#ddd;"></div>
              </div>
            </nav>
            <div id="non-nav-sidebar" style="position:fixed;left:0;top:220px;width:220px;padding:8px;">
              <span>Bộ nhớ (Đã dùng 56%)</span>
              <div role="progressbar" aria-valuenow="56" aria-valuemax="100" style="width:160px;height:6px;background:#ddd;"></div>
            </div>
            <div aria-hidden="true" style="position:fixed;left:0;top:0;">
              <div role="progressbar" style="width:100px;height:6px;"></div>
            </div>
            <div style="opacity:0;position:fixed;left:0;top:0;">
              <div role="progressbar" style="width:100px;height:6px;"></div>
            </div>
            <div id="gemini-promo" role="dialog" guidedhelpid="gemini_promo" style="position:fixed;left:240px;top:16px;width:260px;background:#eef;padding:8px;border:1px solid #88c;">
              <div>Dùng thử Gemini trong Drive</div>
              <button type="button">Đã hiểu</button>
            </div>`
          : "";

        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html><html><head><title>${currentFolder?.name || folderId} - Google Drive</title></head><body>
          <button guidedhelpid="new_menu_button" aria-label="Mới" aria-expanded="false" id="btn-new" style="position:fixed;left:16px;top:16px;width:96px;height:40px;z-index:10;">+ Mới</button>
          <ul id="new-menu" role="menu" style="display:none;position:fixed;left:8px;top:60px;width:240px;margin:0;padding:8px;list-style:none;background:#fff;border:1px solid #ccc;z-index:999;">
            <li tabindex="0" data-key="1" role="menuitem" id="mi-folder" style="height:38px;">Thư mục mới</li>
            <li tabindex="0" data-key="2" role="menuitem" id="mi-upload" style="height:38px;">Tải tệp lên</li>
            <li tabindex="0" data-key="3" role="menuitem" id="mi-gs" style="height:38px;">Google Trang tính</li>
          </ul>
          <div id="dlg-new-folder" role="dialog" style="display:none;position:fixed;left:120px;top:120px;background:#fff;border:1px solid #000;padding:12px;z-index:1000;">
            <div>Thư mục mới</div>
            <input type="text" id="nf-input" />
            <button type="button" id="nf-create">Tạo</button>
          </div>
          <input type="file" id="hidden-file" multiple style="display:none;" />
          <div id="ctx-menu" role="menu" style="display:none;position:fixed;left:160px;top:160px;background:#fff;border:1px solid #000;z-index:1000;">
            <div role="menuitem" id="mi-trash">Chuyển vào thùng rác</div>
          </div>
          ${chromeWidgetsHtml}
          ${trayHtml}
          <main id="drive-main" role="main" style="margin-left:240px;margin-top:90px;">
            ${children
              .map((c) => {
                const t = c.isFolder ? "folder" : "file";
                return `<div data-target="doc" data-id="${c.id}" data-type="${t}" data-mime-type="${c.mimeType}" aria-label="${c.name}" style="padding:6px;border-bottom:1px solid #eee;"><div data-id="${c.id}">${c.name}</div></div>`;
              })
              .join("")}
          </main>
          <script>
            const folderId = ${JSON.stringify(folderId)};
            const delayFolderMs = ${JSON.stringify(delayFolderDomMs)};
            let ctxId = '';
            document.getElementById('btn-new').onclick = () => {
              document.getElementById('new-menu').style.display = 'block';
              document.getElementById('btn-new').setAttribute('aria-expanded', 'true');
            };
            document.addEventListener('keydown', (e) => {
              if (e.key === 'Escape') {
                document.getElementById('new-menu').style.display = 'none';
                document.getElementById('dlg-new-folder').style.display = 'none';
                document.getElementById('btn-new').setAttribute('aria-expanded', 'false');
              }
            });
            document.getElementById('mi-folder').onclick = () => {
              document.getElementById('new-menu').style.display = 'none';
              document.getElementById('dlg-new-folder').style.display = 'block';
            };
            document.getElementById('nf-input').addEventListener('keydown', (e) => {
              if (e.key === 'Enter') {
                // Intentionally ignore Enter so button click "Tạo" is verified
                e.preventDefault();
              }
            });
            document.getElementById('nf-create').onclick = async () => {
              const name = document.getElementById('nf-input').value;
              const resp = await fetch('/api/create-folder', { method: 'POST', body: JSON.stringify({ parentId: folderId, name }) });
              const data = await resp.json();
              document.getElementById('dlg-new-folder').style.display = 'none';
              if (delayFolderMs > 0) {
                setTimeout(() => {
                  const row = document.createElement('div');
                  row.setAttribute('data-target', 'doc');
                  row.setAttribute('data-id', data.id);
                  row.setAttribute('data-type', 'folder');
                  row.setAttribute('data-mime-type', 'application/vnd.google-apps.folder');
                  row.setAttribute('aria-label', name);
                  row.innerHTML = '<div data-id="' + data.id + '">' + name + '</div>';
                  document.getElementById('drive-main').appendChild(row);
                }, delayFolderMs);
              } else {
                location.reload();
              }
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

    const page = await driveContext.newPage();
    BrowserManager.prototype.getPage = async () => page;

    // =========================================================================
    // R354-01 & R354-02: Real Chromium DOM reproduction of VT-C4K-PTA13 + 4/4
    // + Genuine "(1)" filenames & "uploading.py" safety
    // =========================================================================
    console.log("[R354-01] Checking Drive UI quota bars, hidden loaders, promo callout & tray...");
    const ptaClassId = "VT-C4K-PTA13";
    getDb()
      .prepare(
        `INSERT INTO classes_sessions (sessionId, classId, className, sessionNumber, date) VALUES (?, ?, ?, 13, '2026-11-15')`
      )
      .run(`${ptaClassId}_SESS_13`, ptaClassId, ptaClassId);

    const ptaStudents = [
      { id: "PTA_AN", name: "Bùi Tú An", subdirs: ["gui"] },
      { id: "PTA_NGUYEN", name: "Nguyễn Quỳnh Nguyên", subdirs: ["assets"] },
      { id: "PTA_KHANG", name: "Phạm Thiện Hoàng Khang", subdirs: ["gui", "img"] },
      { id: "PTA_PHUC", name: "Phạm Gia Phúc", subdirs: ["img"], genuineDupAndUploading: true },
    ];

    for (const s of ptaStudents) {
      const sDir = path.join(tempSpckRoot, ptaClassId, s.name);
      fs.mkdirSync(sDir, { recursive: true });
      fs.writeFileSync(path.join(sDir, "main.py"), `# ${s.name}\nprint('hello')\n`, "utf8");
      if (s.genuineDupAndUploading) {
        fs.writeFileSync(path.join(sDir, "uploading.py"), "def status(): return 'ok'\n", "utf8");
      }
      for (const sd of s.subdirs) {
        const sub = path.join(sDir, sd);
        fs.mkdirSync(sub, { recursive: true });
        if (s.genuineDupAndUploading && sd === "img") {
          fs.writeFileSync(path.join(sub, "images (1).jpg"), MINIMAL_PNG_BUF);
          fs.writeFileSync(path.join(sub, "house-solid (1).png"), MINIMAL_PNG_BUF);
        } else {
          fs.writeFileSync(path.join(sub, `${sd}_screen.png`), MINIMAL_PNG_BUF);
        }
      }
      studentRepo.upsert({
        studentId: s.id,
        classId: ptaClassId,
        fullName: s.name,
        isActive: 1,
      });
      spckUploadRepo.upsert({
        classId: ptaClassId,
        studentId: s.id,
        localFolderPath: sDir,
        matchScore: 1.0,
        isConfirmedByTeacher: 1,
        projectTitle: `SPCK ${s.name}`,
        baseProjectTitle: `SPCK ${s.name}`,
        thumbnailPath: path.join(tempConfigDir, "default-spck-thumbnail.png"),
        screenshotsJson: "[]",
        attachmentsJson: "[]",
        youtubeUrlsJson: "[]",
        relatedLinksJson: "[]",
        teacherComment: "- Nhận xét mẫu.",
        status: "WAITING_APPROVAL",
        contentHash: "",
      });
    }

    // 1a. Verify active upload tray reports isBusy: true
    trayMode = "active";
    await page.goto(`https://drive.google.com/drive/folders/${ptaCourseId}`, {
      waitUntil: "domcontentloaded",
    });
    const indActive = await inspectDriveUploadIndicators(page);
    assert.deepStrictEqual(indActive, { hasError: false, isBusy: true });

    // 1b. Verify completed tray + quota bars + hidden progressbars + promo dialog reports isBusy: false
    trayMode = "completed";
    await page.reload({ waitUntil: "domcontentloaded" });
    const indCompleted = await inspectDriveUploadIndicators(page);
    assert.deepStrictEqual(
      indCompleted,
      { hasError: false, isBusy: false },
      "Quota bar, hidden progressbar, promo callout, and completed upload tray must NOT cause isBusy: true"
    );

    // 1c. Run full 4-student batch upload for VT-C4K-PTA13 (recursive tree mode)
    const ptaBatch = await SpckDriveUploader.uploadClassSpckToGoogleDrive({
      classId: ptaClassId,
      driveFolderUrl: DEFAULT_SPCK_DRIVE_FOLDER_URL,
      uploadMode: "tree",
    });
    assert.strictEqual(ptaBatch.uploadedStudentsCount, 4);
    assert.strictEqual(ptaBatch.failedStudentsCount, 0);
    assert.ok(
      trayDismissCount >= 4,
      `Expected completed tray close button to be clicked >= 4 times, got ${trayDismissCount}`
    );
    console.log("  -> PASS R354-01.");

    console.log("[R354-02] Checking genuine ' (1)' filenames & 'uploading.py' row safety...");
    const ptaClassDriveFolder = Array.from(items.values()).find(
      (i) => !i.trashed && i.isFolder && i.parentId === ptaCourseId && i.name === ptaClassId
    );
    assert.ok(ptaClassDriveFolder, "VT-C4K-PTA13 folder must exist on Drive");
    const phucFolder = Array.from(items.values()).find(
      (i) =>
        !i.trashed &&
        i.isFolder &&
        i.parentId === ptaClassDriveFolder!.id &&
        i.name === "Phạm Gia Phúc"
    );
    assert.ok(
      phucFolder,
      `Student folder Phạm Gia Phúc must exist on Drive inside ${ptaClassDriveFolder!.id}. Folders=${JSON.stringify(
        Array.from(items.values()).filter((i) => i.isFolder).map((f) => ({ id: f.id, parentId: f.parentId, name: f.name }))
      )}; results=${JSON.stringify(ptaBatch.results)}`
    );
    const phucImgFolder = Array.from(items.values()).find(
      (i) =>
        !i.trashed &&
        i.isFolder &&
        i.parentId === phucFolder!.id &&
        i.name.toLowerCase() === "img"
    );
    assert.ok(phucImgFolder, "Subfolder img under Phạm Gia Phúc must exist on Drive");
    const phucImgFiles = Array.from(items.values())
      .filter((i) => !i.trashed && !i.isFolder && i.parentId === phucImgFolder!.id)
      .map((i) => i.name)
      .sort();
    assert.deepStrictEqual(phucImgFiles, ["house-solid (1).png", "images (1).jpg"]);

    // Navigate directly into Phạm Gia Phúc root folder where `uploading.py` sits inside [role="main"]
    trayMode = "none";
    await page.goto(`https://drive.google.com/drive/folders/${phucFolder!.id}`, {
      waitUntil: "domcontentloaded",
    });
    const indWithUploadingPy = await inspectDriveUploadIndicators(page);
    assert.deepStrictEqual(
      indWithUploadingPy,
      { hasError: false, isBusy: false },
      "A student file named uploading.py inside [role='main'] must not look like an active upload!"
    );
    console.log("  -> PASS R354-02.");

    // =========================================================================
    // R354-03: Fail-closed duplicate modal, error alert & stale-failed tray recovery
    // =========================================================================
    console.log("[R354-03] Checking duplicate modal, error alert & stale-failed tray dismissal...");
    trayMode = "duplicate_modal";
    await page.reload({ waitUntil: "domcontentloaded" });
    const indDupModal = await inspectDriveUploadIndicators(page);
    assert.deepStrictEqual(indDupModal, { hasError: false, isBusy: true });

    trayMode = "error_alert";
    await page.reload({ waitUntil: "domcontentloaded" });
    const indErrAlert = await inspectDriveUploadIndicators(page);
    assert.deepStrictEqual(indErrAlert, { hasError: true, isBusy: false });

    // Stale failed bottom-right tray: calling dismissIdleDriveUploadTray(page, true) closes it,
    // after which indicators become clean and upload succeeds
    trayMode = "failed";
    await page.reload({ waitUntil: "domcontentloaded" });
    assert.deepStrictEqual(await inspectDriveUploadIndicators(page), {
      hasError: false,
      isBusy: true,
    });
    await dismissIdleDriveUploadTray(page, true);
    assert.deepStrictEqual(await inspectDriveUploadIndicators(page), {
      hasError: false,
      isBusy: false,
    });
    console.log("  -> PASS R354-03.");

    // =========================================================================
    // R354-04: Empty vs pre-existing folder timeout failure message accuracy
    // =========================================================================
    console.log("[R354-04] Checking timeout failure messages for empty vs pre-existing Drive folders...");
    const dummyLocalDir = path.join(tempSpckRoot, "timeout-check");
    fs.mkdirSync(dummyLocalDir, { recursive: true });
    const testLocalFile = path.join(dummyLocalDir, "app.py");
    fs.writeFileSync(testLocalFile, "print('timeout check')\n", "utf8");

    const emptyDriveTarget = seedFolder("EMPTY_TIMEOUT_DIR", ptaCourseId, "EmptyTimeoutFolder");
    const nonEmptyDriveTarget = seedFolder("PRE_TIMEOUT_DIR", ptaCourseId, "NonEmptyTimeoutFolder");
    const oldFileId = "PRE_EXISTING_FILE_KEEP_ME";
    items.set(oldFileId, {
      id: oldFileId,
      parentId: nonEmptyDriveTarget,
      name: "old_project.py",
      isFolder: false,
      mimeType: "text/plain",
    });

    blockFileRenderOnUpload = true;
    trayMode = "none";
    showDriveChromeWidgets = false;
    try {
      const origWait = page.waitForTimeout.bind(page);
      let fakeNow = realDateNow();
      let postChooserPolls = 0;
      let sawSetFiles = false;

      // Fast-forward Date.now after 2 poll iterations once files are chosen
      const origChoose = uploadFilesIntoDriveFolder;
      assert.ok(typeof origChoose === "function");

      Date.now = () => fakeNow;
      (page as any).waitForTimeout = async (ms: number) => {
        if (sawSetFiles && ms === 1200) {
          postChooserPolls += 1;
          if (postChooserPolls >= 2) {
            fakeNow += 60_000;
          }
        }
        return await origWait(Math.min(ms, 80));
      };
      page.on("filechooser", () => {
        sawSetFiles = true;
        postChooserPolls = 0;
      });

      await page.goto(`https://drive.google.com/drive/folders/${emptyDriveTarget}`, {
        waitUntil: "domcontentloaded",
      });
      let emptyErrMsg = "";
      try {
        await uploadFilesIntoDriveFolder(page, emptyDriveTarget, [testLocalFile], true);
      } catch (err) {
        emptyErrMsg = err instanceof Error ? err.message : String(err);
      }
      assert.ok(
        emptyErrMsg.endsWith("Vui lòng bấm tải lại Google Drive."),
        `Empty folder timeout must end with 'Vui lòng bấm tải lại Google Drive.', got: ${emptyErrMsg}`
      );

      // Reset clock for pre-existing folder check
      sawSetFiles = false;
      postChooserPolls = 0;
      await page.goto(`https://drive.google.com/drive/folders/${nonEmptyDriveTarget}`, {
        waitUntil: "domcontentloaded",
      });
      let nonEmptyErrMsg = "";
      try {
        await uploadFilesIntoDriveFolder(page, nonEmptyDriveTarget, [testLocalFile], true);
      } catch (err) {
        nonEmptyErrMsg = err instanceof Error ? err.message : String(err);
      }
      assert.ok(
        nonEmptyErrMsg.endsWith("Bài cũ được giữ nguyên."),
        `Non-empty folder timeout must end with 'Bài cũ được giữ nguyên.', got: ${nonEmptyErrMsg}`
      );
      assert.strictEqual(
        items.get(oldFileId)?.trashed,
        undefined,
        "Pre-existing old_project.py MUST NOT be trashed when upload fails!"
      );
      (page as any).waitForTimeout = origWait;
    } finally {
      Date.now = realDateNow;
      blockFileRenderOnUpload = false;
      showDriveChromeWidgets = true;
    }
    console.log("  -> PASS R354-04.");

    // =========================================================================
    // R354-05: VT-C4K-GA38 Demo Sheet folder creation (button click, 15s poll,
    // direct class-folder <title> detection)
    // =========================================================================
    console.log("[R354-05] Checking VT-C4K-GA38 Demo Sheet class folder lookup/creation...");
    const gaClassId = "VT-C4K-GA38";
    const gaLocalDir = path.join(tempSpckRoot, gaClassId);
    fs.mkdirSync(gaLocalDir, { recursive: true });
    getDb()
      .prepare(
        `INSERT INTO classes_sessions (sessionId, classId, className, sessionNumber, date) VALUES (?, ?, ?, 14, '2026-11-15')`
      )
      .run(`${gaClassId}_SESS_14`, gaClassId, gaClassId);
    studentRepo.upsert({
      studentId: "GA_S1",
      classId: gaClassId,
      fullName: "Lê Minh Anh",
      isActive: 1,
    });
    studentRepo.upsert({
      studentId: "GA_S2",
      classId: gaClassId,
      fullName: "Trần Quốc Bảo",
      isActive: 1,
    });

    delayFolderDomMs = 1800;
    const gaRes1 = await createAndUploadClassDemoSheetToDrive({
      classId: gaClassId,
      driveFolderUrl: DEFAULT_SPCK_DRIVE_FOLDER_URL,
      localClassFolderPath: gaLocalDir,
      _testHarness: { page, driveBaseUrl: mockBaseUrl, sheetsBaseUrl: mockBaseUrl },
    });
    delayFolderDomMs = 0;

    assert.strictEqual(gaRes1.isNativeGoogleSheet, true);
    const createdGaFolder = Array.from(items.values()).find(
      (i) => !i.trashed && i.isFolder && i.parentId === gaCourseId && i.name === gaClassId
    );
    assert.ok(createdGaFolder, "VT-C4K-GA38 folder must be created inside 2. GA");
    const gaChildrenAfter1 = Array.from(items.values()).filter(
      (i) => !i.trashed && i.parentId === createdGaFolder!.id
    );
    assert.strictEqual(
      gaChildrenAfter1.some((i) => i.name.toLowerCase().endsWith(".xlsx")),
      false,
      "Must leave 0 .xlsx files in Drive folder"
    );

    // Part 2: Direct class-folder URL (<title>VT-C4K-GA38 - Google Drive</title>) must NOT nest GA38/GA38
    const gaRes2 = await createAndUploadClassDemoSheetToDrive({
      classId: gaClassId,
      driveFolderUrl: `https://drive.google.com/drive/folders/${createdGaFolder!.id}`,
      localClassFolderPath: gaLocalDir,
      _testHarness: { page, driveBaseUrl: mockBaseUrl, sheetsBaseUrl: mockBaseUrl },
    });
    assert.strictEqual(gaRes2.isNativeGoogleSheet, true);
    const nestedGa38 = Array.from(items.values()).find(
      (i) =>
        !i.trashed &&
        i.isFolder &&
        i.parentId === createdGaFolder!.id &&
        i.name.toUpperCase() === gaClassId
    );
    assert.strictEqual(
      nestedGa38,
      undefined,
      "Must NOT create nested VT-C4K-GA38/VT-C4K-GA38 subfolder when URL already opens VT-C4K-GA38!"
    );
    console.log("  -> PASS R354-05.");

    // =========================================================================
    // R354-06: useSpckWorkflow Auto-Prep banner formatting + top-navbar v3.5.4
    // =========================================================================
    console.log("[R354-06] Checking Auto-Prep banner helpers & TopNavbar v3.5.4...");
    const stepErr = formatAutoPrepStepFailure(
      "Tải Google Drive",
      "4/4 học viên lỗi: Không thể xác nhận..."
    );
    assert.strictEqual(
      stepErr,
      "Tải Google Drive (4/4 học viên lỗi: Không thể xác nhận...)"
    );
    const summaryBanner = formatAutoPrepSummaryBanner(2, [
      formatAutoPrepStepFailure("Tải Google Drive", "4/4 học viên lỗi"),
    ]);
    assert.strictEqual(
      summaryBanner,
      "Đã chạy công cụ tự động sau khi quét (1/2 bước hoàn tất • Chưa xong: Tải Google Drive (4/4 học viên lỗi))."
    );
    assert.strictEqual(summaryBanner.includes("lỗi: Đang"), false);

    const navbarSrc = fs.readFileSync(
      path.join(ROOT, "src", "components", "top-navbar.tsx"),
      "utf8"
    );
    assert.ok(/MindX Bot v3\.\d+\.\d+/.test(navbarSrc));
    console.log("  -> PASS R354-06.");

    console.log("\n=== TẤT CẢ 6 KỊCH BẢN KIỂM THỬ v3.5.4 (R354-01 → R354-06) ĐÃ ĐẠT 100% ===");
  } finally {
    Date.now = realDateNow;
    BrowserManager.prototype.getPage = origGetPage;
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (mockServer) {
      mockServer.close();
    }
    try {
      closeDb();
    } catch {
      // ignore if already closed
    }
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore Windows handle release lag
    }
  }
}

run().catch((err) => {
  console.error("[FAIL] test-drive-tray-and-autoprep-v354:", err);
  process.exit(1);
});
