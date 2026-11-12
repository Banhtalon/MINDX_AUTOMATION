/**
 * KIỂM THỬ TỰ ĐỘNG TẠO GOOGLE TRANG TÍNH (NATIVE GOOGLE SHEETS) CHẤM ĐIỂM DEMO SPCK
 * Chạy 100% trong môi trường tạm cô lập (`os.tmpdir()`), bảo toàn tuyệt đối SHA-256 dữ liệu thật.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { chromium } from "playwright";

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-native-gsheet-"));
  const localClassSpckDir = path.join(tempDir, "SPCK_CLASS_PTA99");
  fs.mkdirSync(localClassSpckDir, { recursive: true });

  process.env.MINDX_DB_PATH = path.join(tempDir, "test_gsheet.db");
  process.env.MINDX_RUNNING_CLASSES_PATH = path.join(tempDir, "test_classes.json");
  process.env.MINDX_ALLOWED_EXTRA_PATHS = tempDir;
  process.env.MINDX_ALLOW_LOCAL_SHEET_ORIGIN_FOR_TEST = "1";
  process.env.MINDX_DISABLE_BROWSER_EXPORT_FALLBACK = "1";

  const { getDb, studentRepo, session14EvalRepo } = await import("../src/lib/db/sqlite");
  const {
    CODING_SPCK_COURSE_FOLDER_MAP,
    DEFAULT_SPCK_DRIVE_FOLDER_URL,
  } = await import("../src/lib/playwright/spck-drive-uploader");
  const { createAndUploadClassDemoSheetToDrive } = await import(
    "../src/lib/playwright/spck-demo-sheet"
  );
  const { importClassDemoScores } = await import(
    "../src/lib/local-files/spck-demo-score-reader"
  );

  interface MockDriveItem {
    id: string;
    parentId: string;
    name: string;
    isFolder: boolean;
    mimeType: string;
    tabs: string[];
    workbookBuffer?: Buffer;
    trashed?: boolean;
  }

  const items = new Map<string, MockDriveItem>();
  let seq = 1;
  const nextId = (p: string) => `${p}_1234567890123456_${seq++}`;
  const behavior = { disablePicker: false, forceXlsxBadge: false };

  const extractTabs = (buf: Buffer): string[] => {
    const wb = new AdmZip(buf).readAsText("xl/workbook.xml");
    return Array.from(wb.matchAll(/<sheet\b[^>]*?\bname="([^"]+)"/gi)).map((m) => m[1]);
  };

  let baseUrl = "";
  const server = http.createServer((req, res) => {
    const u = new URL(req.url || "/", "http://127.0.0.1");

    if (req.method === "POST" && u.pathname === "/api/create-folder") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const { parentId, name } = JSON.parse(body);
        const id = nextId("FOLDER");
        items.set(id, {
          id,
          parentId,
          name,
          isFolder: true,
          mimeType: "application/vnd.google-apps.folder",
          tabs: [],
        });
        res.end(JSON.stringify({ id }));
      });
      return;
    }

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

    const expMatch = u.pathname.match(/^\/spreadsheets\/d\/([^/]+)\/export$/);
    if (req.method === "GET" && expMatch) {
      const it = items.get(expMatch[1]);
      if (!it?.workbookBuffer) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      res.end(it.workbookBuffer);
      return;
    }

    if (req.method === "GET" && u.pathname === "/picker-frame") {
      if (behavior.disablePicker) {
        res.writeHead(500).end("Picker unavailable");
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
      const isXlsx =
        it.mimeType !== "application/vnd.google-apps.spreadsheet" || behavior.forceXlsxBadge;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html><html><body>
        <div id="docs-title-widget"><input class="docs-title-input" value="${it.name}" /></div>
        <div id="docs-titlebar-badges">${isXlsx ? '<span class="docs-CommonBadge">.XLSX</span>' : ""}</div>
        <span id="docs-save-indicator-badge" aria-label="Đã lưu vào Drive">Đã lưu vào Drive</span>
        <div id="docs-file-menu">Tệp</div>
        <div id="file-menu" style="display:none;">
          <div class="goog-menuitem" role="menuitem" id="mi-import">Nhập</div>
          ${isXlsx ? '<div class="goog-menuitem" role="menuitem" id="mi-save-gs">Lưu dưới dạng Google Trang tính</div>' : ""}
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
          let uploaded = null;
          const titleEl = document.querySelector('.docs-title-input');
          titleEl.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
              await fetch('/api/rename', { method: 'POST', body: JSON.stringify({ sheetId, title: titleEl.value }) });
            }
          });
          document.getElementById('docs-file-menu').onclick = () => {
            document.getElementById('file-menu').style.display = 'block';
          };
          document.getElementById('mi-import').onclick = () => {
            document.getElementById('file-menu').style.display = 'none';
            document.getElementById('picker-host').innerHTML = '<iframe src="/picker-frame"></iframe>';
          };
          const saveGs = document.getElementById('mi-save-gs');
          if (saveGs) {
            saveGs.onclick = async () => {
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
        <div id="dlg-shared" role="dialog" style="display:none;"><button type="button" id="btn-shared">Tạo và chia sẻ</button></div>
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
          let ctxId = '';
          document.getElementById('btn-new').onclick = () => document.getElementById('new-menu').style.display = 'block';
          document.getElementById('mi-upload').onclick = () => document.getElementById('hidden-file').click();
          document.getElementById('hidden-file').onchange = async (e) => {
            const f = e.target.files[0];
            await fetch('/api/upload-file?parentId=' + folderId + '&fileName=' + encodeURIComponent(f.name), { method: 'POST', body: new Uint8Array(await f.arrayBuffer()) });
            location.reload();
          };
          document.getElementById('mi-gs').onclick = () => {
            document.getElementById('new-menu').style.display = 'none';
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

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const classId = "VT-C4K-PTA99";
    const db = getDb();
    db.prepare(
      `INSERT INTO classes_sessions (sessionId, classId, className, sessionNumber, date) VALUES (?, ?, ?, 14, '2026-11-15')`
    ).run(`${classId}_SESS_14`, classId, classId);
    studentRepo.upsert({
      studentId: "STU_01",
      classId,
      fullName: "Nguyễn Văn An",
      isActive: 1,
    });
    studentRepo.upsert({
      studentId: "STU_02",
      classId,
      fullName: "Trần Thị Bình",
      isActive: 1,
    });

    const ptaCourseFolderId = CODING_SPCK_COURSE_FOLDER_MAP.PTA;
    const classFolderId = nextId("CLASSFOLDER");
    items.set(classFolderId, {
      id: classFolderId,
      parentId: ptaCourseFolderId,
      name: classId,
      isFolder: true,
      mimeType: "application/vnd.google-apps.folder",
      tabs: [],
    });

    const legacyXlsxId = nextId("LEGACYXLSX");
    items.set(legacyXlsxId, {
      id: legacyXlsxId,
      parentId: classFolderId,
      name: "Bảng chấm điểm buổi Demo App Producer - Advanced.xlsx",
      isFolder: false,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      tabs: ["Sheet1"],
    });

    console.log("[GS-01] Tạo Google Trang tính gốc & không tạo file Excel cục bộ...");
    const res1 = await createAndUploadClassDemoSheetToDrive({
      classId,
      driveFolderUrl: DEFAULT_SPCK_DRIVE_FOLDER_URL,
      localClassFolderPath: localClassSpckDir,
      _testHarness: { page, driveBaseUrl: baseUrl, sheetsBaseUrl: baseUrl },
    });
    assert.equal(res1.isNativeGoogleSheet, true);
    assert.equal(res1.mimeType, "application/vnd.google-apps.spreadsheet");
    assert.equal(res1.localFilePath, "");
    assert.equal(
      fs.readdirSync(localClassSpckDir).some((f) => /\.xls[xm]?$/i.test(f)),
      false
    );
    assert.equal(items.get(legacyXlsxId)?.trashed, true);
    const active1 = Array.from(items.values()).filter(
      (i) => i.parentId === classFolderId && !i.trashed
    );
    assert.equal(active1.length, 1);
    assert.deepEqual(active1[0].tabs.slice(0, 2), ["Nguyễn Văn An", "Trần Thị Bình"]);
    console.log("  -> PASS [GS-01].");

    console.log("[GS-02] Dự phòng Lưu dưới dạng Google Trang tính khi Picker không mở...");
    behavior.disablePicker = true;
    const res2 = await createAndUploadClassDemoSheetToDrive({
      classId,
      localClassFolderPath: localClassSpckDir,
      _testHarness: { page, driveBaseUrl: baseUrl, sheetsBaseUrl: baseUrl },
    });
    behavior.disablePicker = false;
    assert.equal(res2.isNativeGoogleSheet, true);
    const active2 = Array.from(items.values()).filter(
      (i) => i.parentId === classFolderId && !i.trashed
    );
    assert.equal(active2.length, 1);
    assert.equal(active2[0].id, res2.driveFileId);
    console.log("  -> PASS [GS-02].");

    console.log("[GS-03] Chặn chế độ tương thích .XLSX & giữ nguyên bảng điểm cũ...");
    behavior.forceXlsxBadge = true;
    await assert.rejects(() =>
      createAndUploadClassDemoSheetToDrive({
        classId,
        localClassFolderPath: localClassSpckDir,
        _testHarness: { page, driveBaseUrl: baseUrl, sheetsBaseUrl: baseUrl },
      })
    );
    behavior.forceXlsxBadge = false;
    assert.equal(items.get(res2.driveFileId!)?.trashed, undefined);
    console.log("  -> PASS [GS-03].");

    console.log("[GS-04] Đọc Điểm Demo Buổi 14 ngược lại từ Google Trang tính...");
    const activeSheet = items.get(res2.driveFileId!)!;
    const z = new AdmZip(activeSheet.workbookBuffer!);
    for (const sName of ["xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]) {
      let xml = z.readAsText(sName);
      // Mark "Tốt" across column D rubric rows so full Demo score = 5.0
      xml = xml.replace(
        /<c\b([^>]*?\br="D(\d+)"[^>]*?)(?:\/>|>[\s\S]*?<\/c>)/gi,
        (_m, attrs, rowNum) => {
          const r = Number(rowNum);
          if (r >= 8 && r <= 27) {
            return `<c${attrs} t="inlineStr"><is><t>Tốt</t></is></c>`;
          }
          return _m;
        }
      );
      z.updateFile(sName, Buffer.from(xml, "utf8"));
    }
    activeSheet.workbookBuffer = z.toBuffer();

    const imported = await importClassDemoScores(classId);
    assert.equal(imported.matchedCount, 2);
    assert.equal(session14EvalRepo.findOne(classId, "STU_01")?.demoTotalScore, 5);
    console.log("  -> PASS [GS-04].");

    console.log("\n✅ TẤT CẢ 4/4 KỊCH BẢN GOOGLE TRANG TÍNH GỌN NHẸ ĐỀU ĐẠT 100%!");
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await new Promise<void>((r) => server.close(() => r()));
    try {
      getDb().close();
    } catch {
      // ignore
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("❌ TEST FAILED:", err);
  process.exitCode = 1;
});
