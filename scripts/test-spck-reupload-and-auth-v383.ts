/**
 * MINDX AUTOMATION BOT - ISOLATED REGRESSION SUITE FOR v3.8.3
 * 100% isolated in `os.tmpdir()` (zero mutations to live `data/mindx_bot.db` or `./playwright-auth`):
 * - V383-01: Teaching login selector (`SELECTORS.auth.teaching.emailInput`) fills `"Tên đăng nhập"`.
 * - V383-02: Real MindX LMS Modal reused-card cleanup: clears 10 existing attachment tiles
 *            (without `MuiTypography-caption` / `resources.mindx.edu.vn` links) & old screenshots,
 *            preserves card-level delete button & Thumbnail, uploads fresh files, reaches VERIFIED.
 * - V383-03: `expandDetailBtn` is clicked at most once (`expandClicks === 1`) AND `uploadToDropzoneAndWait`
 *            timeout produces descriptive error (label, filename, modal DOM counts) + screenshot
 *            in `MINDX_DEBUG_SCREENSHOT_DIR`.
 * - V383-04: `LmsHelpers.openClassDrawer` recovers once from a late SSO redirect (`_retriedAfterLogin`)
 *            and throws a clear `[LMS Error]` instead of infinite looping if auth remains at login.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const ROOT = process.cwd();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-v383-test-"));
const tempConfigDir = path.join(tempRoot, "config");
const tempSpckRoot = path.join(tempRoot, "spck_root");
const tempShotDir = path.join(tempRoot, "debug_shots");
const tempRoleDir = path.join(tempRoot, "role-state");

fs.mkdirSync(path.join(tempConfigDir, "demo-sheet-templates"), { recursive: true });
fs.mkdirSync(tempSpckRoot, { recursive: true });
fs.mkdirSync(tempShotDir, { recursive: true });
fs.mkdirSync(tempRoleDir, { recursive: true });

const defaultLogoSrc = path.join(ROOT, "data", "config", "default-spck-thumbnail.png");
if (fs.existsSync(defaultLogoSrc)) {
  fs.copyFileSync(defaultLogoSrc, path.join(tempConfigDir, "default-spck-thumbnail.png"));
}

process.env.MINDX_DB_PATH = path.join(tempRoot, "mindx_v383_test.db");
process.env.MINDX_CONFIG_DIR = tempConfigDir;
process.env.MINDX_RUNNING_CLASSES_PATH = path.join(tempRoot, "running_classes.json");
process.env.MINDX_LMS_CLASS_IDS_PATH = path.join(tempConfigDir, "lms_class_ids.json");
process.env.MINDX_ROLE_STATE_DIR = tempRoleDir;
process.env.MINDX_DEBUG_SCREENSHOT_DIR = tempShotDir;
process.env.ALLOWED_LOCAL_DIRS = tempRoot;
process.env.MINDX_ALLOWED_EXTRA_PATHS = tempRoot;
process.env.GEMINI_API_KEY = "AIzaDummyTestKeyV383_NeverLive";

fs.writeFileSync(
  process.env.MINDX_RUNNING_CLASSES_PATH,
  JSON.stringify([{ classCode: "VT-CSI99", status: "Running" }], null, 2)
);
fs.writeFileSync(
  process.env.MINDX_LMS_CLASS_IDS_PATH,
  JSON.stringify({ "VT-CSI99": "644346f794300678908f9999" }, null, 2)
);

const MINIMAL_PNG_BUF = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

function buildRealStyleLmsModalHtml(classCode: string): string {
  const tenOldCards = Array.from({ length: 10 }, (_, idx) => {
    const n = idx + 1;
    const fname = n === 1 ? "Sản phẩm học viên 01 - Truong.pptx" : `old_att_${n}.py`;
    return `
      <div class="lms-file-card" data-old-att="${n}">
        <button type="button" class="btn-dl-att" aria-label="Download" onclick="window.__attDownloadClicks += 1">
          <svg data-testid="DownloadIcon" width="14" height="14"></svg>
        </button>
        <button type="button" class="trash-att" aria-label="delete-file-${n}">
          <svg data-testid="DeleteOutlineIcon" width="14" height="14"></svg>
        </button>
        <img class="att-icon" src="/resources.mindx.edu.vn/doc-icon.png" width="20" height="20" />
        <a href="https://storage.mindx.example/stale/old_${n}.py">${fname}</a>
      </div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Mock MindX LMS SPCK Modal</title></head>
<body>
  <div class="MuiDrawer-paper MuiDrawer-paperAnchorRight" aria-labelledby="class-detail">
    <h2>${classCode}</h2>
    <div role="tablist"><button role="tab" aria-selected="true">Nhận xét</button></div>
    <div id="class-comments-slot-carousel-13" class="active"><div class="info-container">Buổi 14</div></div>
    <div class="comment-list-table">
      <table><tbody>
        <tr>
          <td><span class="name-display">Kim Đắc Trường</span></td>
          <td><button type="button" id="btn-open-spck">Sản phẩm của học sinh</button></td>
        </tr>
      </tbody></table>
    </div>
  </div>

  <div class="MuiDialog-root" id="spck-dialog-root" style="display:none;">
    <div class="MuiDialog-paper" role="dialog" style="padding:16px;">
      <div class="MuiDialogTitle-root">
        <img id="dialog-avatar" src="/resources.mindx.edu.vn/student-avatar.png" width="32" height="32" />
        <h2 class="MuiTypography-h6">Kim Đắc Trường</h2>
      </div>
      <div class="spck-card-wrapper">
        <div class="card-header">
          <span>Sản phẩm Học Viên 01</span>
          <span class="MuiTypography-caption">Cập nhật lúc 14:30</span>
          <button type="button" id="btn-delete-card" aria-label="Xóa sản phẩm">
            <svg data-testid="DeleteOutlineIcon" width="16" height="16"></svg>
          </button>
          <button type="button" id="btn-expand-detail">Xem chi tiết trang</button>
        </div>

        <div class="form-body">
          <div class="row-title">
            <label>Tiêu đề *</label>
            <input id="title" name="title" value="LDBot Cũ" />
          </div>

          <div class="row-youtube">
            <label>Youtube Video (Youtube URL)</label>
            <div id="yt-list">
              <div class="yt-row" id="yt-row-caption">
                <a href="https://www.youtube.com/watch?v=abc">https://www.youtube.com/watch?v=abc</a>
                <span class="MuiTypography-caption">Video Demo SPCK</span>
                <button type="button" class="trash-yt" aria-label="delete" onclick="window.__ytDeleted = true; this.parentElement.remove()">✕</button>
              </div>
            </div>
            <div class="MuiFormControl-root"><input id="inputYoutube" placeholder="Nhập đường dẫn youtube tại đây" /></div>
            <button type="button" id="btn-add-yt">+ Thêm</button>
          </div>

          <div class="row-thumb" id="thumb-box">
            <label>Ảnh thumbnail *</label>
            <img id="modal-thumb" src="/resources.mindx.edu.vn/old-thumb.png" width="160" height="90" />
            <button type="button" id="btn-change-thumb">Thay ảnh</button>
            <input type="file" id="thumb-input" accept="image/png, image/jpeg" style="display:none;" />
          </div>

          <div class="row-gallery">
            <div class="left-col"><label>Tải hình ảnh lên</label><span>Tối đa 10 ảnh</span></div>
            <div class="right-col">
              <div id="gallery-list">
                <div class="shot-tile">
                  <img src="/resources.mindx.edu.vn/old-shot-1.png" width="120" height="68" />
                  <button type="button" class="btn-prev-shot" title="Xem trước" onclick="window.__shotPreviewClicks += 1">
                    <svg data-testid="VisibilityIcon" width="14" height="14"></svg>
                  </button>
                  <button type="button" class="trash-shot"><svg data-testid="DeleteOutlineIcon"></svg></button>
                </div>
                <div class="shot-tile">
                  <img src="/resources.mindx.edu.vn/old-shot-2.png" width="120" height="68" />
                  <button type="button" class="btn-prev-shot" title="Xem trước" onclick="window.__shotPreviewClicks += 1">
                    <svg data-testid="VisibilityIcon" width="14" height="14"></svg>
                  </button>
                  <button type="button" class="trash-shot"><svg data-testid="DeleteOutlineIcon"></svg></button>
                </div>
              </div>
              <div class="dropzone-img">
                <input type="file" id="gallery-input" accept="image/jpeg, image/png, image/jpg, image/tiff" multiple style="display:none;" />
                <span>Thêm ảnh</span>
              </div>
            </div>
          </div>

          <div class="row-attachments">
            <div class="left-col"><label>Tài liệu đính kèm *</label><span>Tối đa 10 files</span></div>
            <div class="right-col" id="att-right-col">
              <div id="att-list">
                ${tenOldCards}
              </div>
              <div class="dropzone-att" id="att-dropzone">
                <button type="button" class="btn-plus-att" onclick="window.__dropzoneBtnClicks += 1">+ Thêm files</button>
              </div>
            </div>
          </div>

          <div class="row-rel">
            <label>Đường dẫn liên quan</label>
            <input id="inputRelativeUrlName" placeholder="Đặt tên đường dẫn" />
            <input id="inputRelativeUrl" placeholder="Nhập đường dẫn" />
            <button type="button" id="btn-add-rel">+ Thêm</button>
            <div id="rel-list"></div>
          </div>

          <textarea id="comment" name="comment">Nhận xét cũ</textarea>
          <button type="submit" id="btn-save">Save</button>
        </div>
      </div>
    </div>
  </div>

  <script>
    window.__cardDeleted = false;
    window.__ytDeleted = false;
    window.__expandClicks = 0;
    window.__attDownloadClicks = 0;
    window.__shotPreviewClicks = 0;
    window.__dropzoneBtnClicks = 0;

    function mountAttInputIfUnderLimit() {
      const dz = document.getElementById('att-dropzone');
      const count = document.querySelectorAll('#att-list .lms-file-card').length;
      const existing = document.getElementById('att-input');
      if (count >= 10) {
        if (existing) existing.remove();
        return;
      }
      if (!existing && dz) {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.id = 'att-input';
        inp.accept = '.py,.zip,.pdf,.pptx,.docx';
        inp.multiple = true;
        inp.style.display = 'none';
        inp.onchange = async (e) => {
          for (const f of Array.from(e.target.files || [])) {
            if (document.querySelectorAll('#att-list .lms-file-card').length >= 10) return;
            if (window.__stallAttUpload) return;
            const fd = new FormData();
            fd.append('file', f);
            const r = await fetch('/resources.mindx.edu.vn/upload?name=' + encodeURIComponent(f.name), { method: 'POST', body: fd });
            const d = await r.json();
            const card = document.createElement('div');
            card.className = 'lms-file-card';
            card.innerHTML = '<button type="button" class="trash-att"><svg data-testid="DeleteOutlineIcon"></svg></button><a href="' + d.url + '">' + f.name + '</a>';
            card.querySelector('.trash-att').onclick = () => { card.remove(); mountAttInputIfUnderLimit(); };
            document.getElementById('att-list').appendChild(card);
            mountAttInputIfUnderLimit();
          }
        };
        dz.appendChild(inp);
      }
    }
    mountAttInputIfUnderLimit();

    document.getElementById('btn-open-spck').onclick = () => {
      document.getElementById('spck-dialog-root').style.display = 'block';
    };
    document.getElementById('btn-delete-card').onclick = () => {
      window.__cardDeleted = true;
    };
    document.getElementById('btn-expand-detail').onclick = () => {
      window.__expandClicks += 1;
    };
    document.querySelectorAll('.trash-shot').forEach((btn) => {
      btn.onclick = () => btn.closest('.shot-tile').remove();
    });
    document.querySelectorAll('.trash-att').forEach((btn) => {
      btn.onclick = () => {
        btn.closest('.lms-file-card').remove();
        mountAttInputIfUnderLimit();
      };
    });
    document.getElementById('thumb-input').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const fd = new FormData();
      fd.append('file', f);
      const r = await fetch('/resources.mindx.edu.vn/upload?name=' + encodeURIComponent(f.name), { method: 'POST', body: fd });
      const d = await r.json();
      document.getElementById('modal-thumb').src = d.url;
    };
    document.getElementById('gallery-input').onchange = async (e) => {
      for (const f of Array.from(e.target.files || [])) {
        if (document.querySelectorAll('#gallery-list .shot-tile').length >= 10) return;
        const fd = new FormData();
        fd.append('file', f);
        const r = await fetch('/resources.mindx.edu.vn/upload?name=' + encodeURIComponent(f.name), { method: 'POST', body: fd });
        const d = await r.json();
        const tile = document.createElement('div');
        tile.className = 'shot-tile';
        tile.innerHTML = '<img src="' + d.url + '" width="120" height="68" /><button type="button" class="trash-shot"><svg data-testid="DeleteOutlineIcon"></svg></button>';
        tile.querySelector('.trash-shot').onclick = () => tile.remove();
        document.getElementById('gallery-list').appendChild(tile);
      }
    };
    document.getElementById('btn-add-rel').onclick = () => {
      const name = document.getElementById('inputRelativeUrlName').value;
      const url = document.getElementById('inputRelativeUrl').value;
      const row = document.createElement('div');
      row.className = 'rel-row';
      row.innerHTML = '<a href="' + url + '">' + name + '</a><button type="button" class="btn-del-rel">✕</button>';
      row.querySelector('.btn-del-rel').onclick = () => row.remove();
      document.getElementById('rel-list').appendChild(row);
    };
    document.getElementById('btn-save').onclick = async () => {
      const title = document.getElementById('title').value;
      const comment = document.getElementById('comment').value;
      const thumbUrl = document.getElementById('modal-thumb').getAttribute('src');
      const screenshots = Array.from(document.querySelectorAll('#gallery-list img')).map((img) => ({
        url: img.getAttribute('src'),
      }));
      const attachments = Array.from(document.querySelectorAll('#att-list .lms-file-card a')).map((a) => ({
        name: a.textContent,
        url: a.getAttribute('href'),
      }));
      const relativeUrls = Array.from(document.querySelectorAll('#rel-list a')).map((a) => ({
        name: a.textContent,
        url: a.getAttribute('href'),
      }));
      await fetch('/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operationName: 'UpdateStudentWork',
          variables: { title, comment, thumbUrl, screenshots, attachments, relativeUrls },
        }),
      });
    };
  </script>
</body>
</html>`;
}

async function runTests() {
  const { SELECTORS } = await import("../src/lib/playwright/selectors");
  const {
    classSessionRepo,
    closeDb,
    spckSessionRepo,
    spckUploadRepo,
    studentRepo,
    computeSpckContentHash,
  } = await import("../src/lib/db/sqlite");
  const { SpckUploader } = await import("../src/lib/playwright/spck-uploader");
  const { LmsHelpers } = await import("../src/lib/playwright/lms-helpers");
  const { authService } = await import("../src/lib/playwright/auth");

  let browser: Browser | null = null;
  let mockServer: http.Server | null = null;
  const origEnsureAuth = authService.ensureAuthenticated.bind(authService);

  try {
    browser = await chromium.launch({ headless: true });

    // =========================================================================
    // [V383-01] Teaching login selector ("Tên đăng nhập") + F05 header/decoy guard
    // =========================================================================
    console.log("[V383-01] Checking Teaching login input selector...");
    const authCtx = await browser.newContext();
    const authPage = await authCtx.newPage();
    await authPage.setContent(`
      <!DOCTYPE html><html><body>
        <header><form><input type="text" id="hdr-search" placeholder="Tìm nhanh" /></form></header>
        <h3>Đăng nhập - Teaching Vũng Tàu</h3>
        <input type="text" id="hidden-decoy" name="username" style="display:none;" />
        <form>
          <input type="text" id="real-user" name="username" placeholder="Tên đăng nhập" />
          <input type="password" placeholder="Mật khẩu" />
          <label><input type="checkbox" checked /> Ghi nhớ đăng nhập</label>
          <button type="submit">Đăng nhập</button>
        </form>
      </body></html>
    `);
    const userLoc = authPage.locator(SELECTORS.auth.teaching.emailInput).first();
    await userLoc.waitFor({ state: "visible", timeout: 3000 });
    assert.strictEqual(await userLoc.getAttribute("id"), "real-user");
    await userLoc.fill("quangda");
    assert.strictEqual(await authPage.locator("#real-user").inputValue(), "quangda");
    assert.strictEqual(await authPage.locator("#hdr-search").inputValue(), "");
    await authPage.locator(SELECTORS.auth.teaching.passwordInput).first().fill("secret-pass");
    assert.strictEqual(
      await authPage.locator(SELECTORS.auth.teaching.submitButton).first().isVisible(),
      true
    );
    await authCtx.close();
    console.log("  -> PASS [V383-01].");

    // =========================================================================
    // [V383-02] & [V383-03] Real LMS 10-attachment cleanup + card-delete guard + single expand + diagnostics
    // =========================================================================
    console.log("[V383-02] Testing real LMS 10-attachment cleanup & Card-Delete safety...");
    const classId = "VT-CSI99";
    const studentId = "STU_VT-CSI99_TRUONG";
    const stuDir = path.join(tempSpckRoot, "Kim Đắc Trường");
    const shotsDir = path.join(stuDir, "_spck_app_shots");
    fs.mkdirSync(shotsDir, { recursive: true });
    const thumbFile = path.join(shotsDir, "owner_photo_test.png");
    const shotFile = path.join(shotsDir, "app_01_index_test.png");
    const zipFile = path.join(stuDir, "kim_dac_truong_web_package.zip");
    const pyFile = path.join(stuDir, "app.py");
    fs.writeFileSync(thumbFile, MINIMAL_PNG_BUF);
    fs.writeFileSync(shotFile, MINIMAL_PNG_BUF);
    fs.writeFileSync(zipFile, Buffer.from("PK\x05\x06" + "\x00".repeat(18)));
    fs.writeFileSync(pyFile, 'print("hello LDBot")\n');

    classSessionRepo.upsert({
      classId,
      className: classId,
      sessionId: `${classId}_SESS_14`,
      sessionNumber: 14,
      topic: "Demo Day",
      date: "2026-11-22",
    });
    studentRepo.upsert({
      studentId,
      classId,
      fullName: "Kim Đắc Trường",
      isActive: 1,
    });

    const projectTitle = "LDBot — Buổi 14 (GĐ2)";
    const teacherComment =
      "Kim Đắc Trường — Dự án: LDBot.\nNhận xét hoàn chỉnh kiểm thử v3.8.3.\n\n[ĐIỂM NỔI BẬT]\n+ Tốt";
    const shotsJson = JSON.stringify([shotFile]);
    const attsJson = JSON.stringify([zipFile, pyFile]);
    const linksJson = JSON.stringify([
      { name: "Link Web Chạy Thử", url: "https://example.github.io/ldbot/" },
    ]);
    spckUploadRepo.upsert({
      classId,
      studentId,
      localFolderPath: stuDir,
      matchScore: 1,
      isConfirmedByTeacher: 1,
      projectTitle,
      thumbnailPath: thumbFile,
      screenshotsJson: shotsJson,
      attachmentsJson: attsJson,
      youtubeUrlsJson: "[]",
      relatedLinksJson: linksJson,
      teacherComment,
      contentHash: computeSpckContentHash({
        classId,
        studentId,
        localFolderPath: stuDir,
        isConfirmedByTeacher: 1,
        projectTitle,
        thumbnailPath: thumbFile,
        screenshotsJson: shotsJson,
        attachmentsJson: attsJson,
        youtubeUrlsJson: "[]",
        relatedLinksJson: linksJson,
        teacherComment,
      }),
      status: "APPROVED",
    });
    const draft = spckSessionRepo.getOrInitSessionDraft(classId, studentId, 14, "Kim Đắc Trường");
    const savedDraft = spckSessionRepo.saveSessionDraft({
      classId,
      studentId,
      sessionNumber: 14,
      localFolderPath: stuDir,
      isConfirmedByTeacher: 1,
      projectTitle,
      thumbnailPath: thumbFile,
      screenshotsJson: shotsJson,
      attachmentsJson: attsJson,
      youtubeUrlsJson: "[]",
      relatedLinksJson: linksJson,
      teacherComment,
      expectedVersion: draft.draftVersion,
    });
    const approvedDraft = spckSessionRepo.approveSessionDraft(
      classId,
      studentId,
      14,
      savedDraft.record.draftVersion
    );
    assert.strictEqual(approvedDraft.success, true, approvedDraft.reason || "approveSessionDraft failed");
    const contentHash = approvedDraft.record.approvedContentHash;

    let lastGraphqlVars: any = null;
    mockServer = http.createServer((req, res) => {
      const u = new URL(req.url || "/", "http://127.0.0.1");
      if (u.pathname === "/mock-lms-v383") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(buildRealStyleLmsModalHtml(classId));
        return;
      }
      if (u.pathname.startsWith("/resources.mindx.edu.vn/")) {
        if (req.method === "POST") {
          const chunks: Buffer[] = [];
          req.on("data", (c) => chunks.push(c));
          req.on("end", () => {
            const name = u.searchParams.get("name") || `asset_${Date.now()}.bin`;
            const hostHdr = req.headers.host || "127.0.0.1";
            res.writeHead(200, { "content-type": "application/json" });
            res.end(
              JSON.stringify({
                url: `http://${hostHdr}/resources.mindx.edu.vn/uploaded_${encodeURIComponent(name)}`,
              })
            );
          });
          return;
        }
        res.writeHead(200, { "content-type": "image/png" });
        res.end(MINIMAL_PNG_BUF);
        return;
      }
      if (req.method === "POST" && u.pathname === "/graphql") {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          const parsed = JSON.parse(raw);
          const vars = parsed.variables || {};
          lastGraphqlVars = vars;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              data: {
                studentWorks: {
                  update: {
                    id: "LMS_WORK_V383_14",
                    latestData: {
                      title: vars.title,
                      comment: vars.comment,
                      thumbnail: { url: vars.thumbUrl },
                      screenshots: vars.screenshots,
                      attachments: vars.attachments,
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

    await new Promise<void>((resolve) => mockServer!.listen(0, "127.0.0.1", () => resolve()));
    const port = (mockServer.address() as any).port;

    const lmsCtx = await browser.newContext();
    const lmsPage = await lmsCtx.newPage();
    await lmsPage.goto(`http://127.0.0.1:${port}/mock-lms-v383`, { waitUntil: "domcontentloaded" });

    const rec = spckUploadRepo.findOne(classId, studentId)!;
    const modalRes = await (SpckUploader as any).uploadSingleStudentViaRealLmsModal({
      page: lmsPage,
      interceptor: { dismissForbiddenToast: async () => {} },
      normalizedClassId: classId,
      targetSessionNumber: 14,
      record: { ...rec, contentHash },
      fullName: "Kim Đắc Trường",
      studentsInClass: [{ studentId, fullName: "Kim Đắc Trường" }],
      expectedHash: contentHash,
      screenshots: [shotFile],
      attachments: [zipFile, pyFile],
      youtubeUrls: ["https://www.youtube.com/watch?v=abc"],
      relatedLinks: [{ name: "Link Web Chạy Thử", url: "https://example.github.io/ldbot/" }],
    });

    assert.strictEqual(modalRes.reusedExistingItem01, true);
    assert.strictEqual(modalRes.screenshotsUploadedCount, 1);
    assert.strictEqual(modalRes.attachmentsUploadedCount, 2);

    const flags = await lmsPage.evaluate(() => ({
      cardDeleted: (window as any).__cardDeleted,
      ytDeleted: (window as any).__ytDeleted,
      attDownloadClicks: (window as any).__attDownloadClicks,
      shotPreviewClicks: (window as any).__shotPreviewClicks,
      dropzoneBtnClicks: (window as any).__dropzoneBtnClicks,
      expandClicks: (window as any).__expandClicks,
      thumbSrc: document.getElementById("modal-thumb")?.getAttribute("src") || "",
      avatarPresent: Boolean(document.getElementById("dialog-avatar")),
      ytCount: document.querySelectorAll("#yt-list .yt-row").length,
      shotCount: document.querySelectorAll("#gallery-list .shot-tile").length,
      oldShotRemaining: document.querySelectorAll('#gallery-list img[src*="old-shot"]').length,
      attNames: Array.from(document.querySelectorAll("#att-list .lms-file-card a")).map((a) =>
        (a.textContent || "").trim()
      ),
    }));

    assert.strictEqual(flags.cardDeleted, false, "Card-level trash button must NEVER be clicked!");
    assert.strictEqual(flags.ytDeleted, false, "Preserved YouTube caption row must NEVER be deleted!");
    assert.strictEqual(flags.attDownloadClicks, 0, "Download button must NEVER be clicked!");
    assert.strictEqual(flags.shotPreviewClicks, 0, "Preview button must NEVER be clicked!");
    assert.strictEqual(flags.dropzoneBtnClicks, 0, "+ Thêm files button must NEVER be clicked!");
    assert.strictEqual(flags.ytCount, 1);
    assert.strictEqual(flags.avatarPresent, true);
    assert.strictEqual(
      flags.expandClicks,
      1,
      `expandDetailBtn must be clicked once, got ${flags.expandClicks}`
    );
    assert.ok(flags.thumbSrc.includes("owner_photo_test.png"), `Unexpected thumbSrc: ${flags.thumbSrc}`);
    assert.strictEqual(flags.shotCount, 1);
    assert.strictEqual(flags.oldShotRemaining, 0);
    assert.deepStrictEqual(flags.attNames, ["kim_dac_truong_web_package.zip", "app.py"]);
    assert.strictEqual(lastGraphqlVars?.attachments?.length, 2);
    console.log("  -> PASS [V383-02] (10 old tiles cleared with F01-F04 guards, 2 fresh files VERIFIED).");

    // =========================================================================
    // [V383-03] Enriched uploadToDropzoneAndWait timeout diagnostics + screenshot path
    // =========================================================================
    console.log("[V383-03] Testing uploadToDropzoneAndWait diagnostic timeout error + screenshot...");
    await lmsPage.goto(`http://127.0.0.1:${port}/mock-lms-v383`, { waitUntil: "domcontentloaded" });
    await lmsPage.evaluate(() => {
      (window as any).__stallAttUpload = true;
    });

    // Fast-fail wrapper ONLY on waitForResponse for resources.mindx.edu.vn POST after DOM runs
    const origWaitForResponse = lmsPage.waitForResponse.bind(lmsPage);
    let stalledAttempts = 0;
    const wrappedPage: Page = new Proxy(lmsPage, {
      get(target, prop) {
        if (prop === "waitForResponse") {
          return (pred: any, opts?: any) => {
            const predSrc = typeof pred === "function" ? pred.toString() : "";
            if (predSrc.includes("resources.mindx.edu.vn")) {
              stalledAttempts += 1;
              if (stalledAttempts >= 2) {
                // Keep first upload (Thumbnail + Shot) only stalling on attachment after 3 successful POSTs
              }
            }
            return origWaitForResponse(pred, { ...(opts || {}), timeout: stalledAttempts > 2 ? 250 : opts?.timeout });
          };
        }
        const val = (target as any)[prop];
        return typeof val === "function" ? val.bind(target) : val;
      },
    });

    let dropErrMsg = "";
    try {
      await (SpckUploader as any).uploadSingleStudentViaRealLmsModal({
        page: wrappedPage,
        interceptor: { dismissForbiddenToast: async () => {} },
        normalizedClassId: classId,
        targetSessionNumber: 14,
        record: { ...rec, contentHash },
        fullName: "Kim Đắc Trường",
        studentsInClass: [{ studentId, fullName: "Kim Đắc Trường" }],
        expectedHash: contentHash,
        screenshots: [shotFile],
        attachments: [zipFile, pyFile],
        youtubeUrls: [],
        relatedLinks: [],
      });
    } catch (err) {
      dropErrMsg = err instanceof Error ? err.message : String(err);
    }
    assert.ok(
      dropErrMsg.includes("Tải Tài liệu đính kèm ('kim_dac_truong_web_package.zip')"),
      `Expected enriched filename & label in error, got: ${dropErrMsg}`
    );
    assert.match(dropErrMsg, /imgs=\d+, attLinks=\d+, captions=\d+, fileInputs=\d+/);
    assert.ok(
      fs.existsSync(path.join(tempShotDir, "debug_spck_dropzone_timeout.png")),
      "Expected debug_spck_dropzone_timeout.png in MINDX_DEBUG_SCREENSHOT_DIR"
    );
    await lmsCtx.close();
    console.log("  -> PASS [V383-03].");

    // =========================================================================
    // [V383-04] LmsHelpers.openClassDrawer direct L1253 & L1375 recovery, bounded retry, listener cleanup & non-login timeout
    // =========================================================================
    console.log("[V383-04] Testing LmsHelpers.openClassDrawer direct L1253/L1375 SSO recovery & F06...");
    const drawerCtx = await browser.newContext();
    const drawerPage = await drawerCtx.newPage();

    let ssoPhase: "recover_after_first_login" | "always_login" = "recover_after_first_login";
    let isLoggedIn = false;
    let ensureAuthCalls = 0;
    let routeTableEmpty = false;
    let routeDrawerMissing = false;

    await drawerCtx.route("**/*", async (route) => {
      const reqUrl = route.request().url();
      if (reqUrl.startsWith("https://base.mindx.edu.vn/login")) {
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: `<!DOCTYPE html><html><body>
            <h3>Đăng nhập</h3>
            <input name="username" value="quangda@mindx.net.vn" />
            <input type="password" value="secret" />
            <button>Đăng nhập</button>
          </body></html>`,
        });
        return;
      }
      if (reqUrl.startsWith("https://lms.mindx.edu.vn/admin/classes")) {
        if (!isLoggedIn) {
          await route.fulfill({
            status: 302,
            headers: { location: "https://base.mindx.edu.vn/login?callbackUrl=https://lms.mindx.edu.vn/admin/classes" },
          });
          return;
        }
        const rowsHtml = routeTableEmpty
          ? ""
          : `<tr><td>${classId}</td><td>Computer Scientist Intensive</td></tr><tr><td>VT-NOCACHE99</td><td>CSI NoCache</td></tr>`;
        const clickHandler = routeDrawerMissing
          ? ""
          : `document.querySelectorAll('tr').forEach((tr) => {
               tr.onclick = () => {
                 const h2 = document.querySelector('.MuiDrawer-paperAnchorRight h2');
                 if (h2) h2.textContent = tr.querySelector('td')?.textContent || '${classId}';
                 document.querySelector('.MuiDrawer-paperAnchorRight').style.display = 'block';
               };
             });`;
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: `<!DOCTYPE html><html><body>
            <input placeholder="Tìm kiếm" />
            <table><tbody>${rowsHtml}</tbody></table>
            <div class="MuiDrawer-paper MuiDrawer-paperAnchorRight" aria-labelledby="class-detail" style="display:none;">
              <h2>${classId}</h2>
              <div>Computer Scientist Intensive</div>
            </div>
            <script>${clickHandler}</script>
          </body></html>`,
        });
        return;
      }
      await route.abort();
    });

    (authService as any).ensureAuthenticated = async () => {
      ensureAuthCalls += 1;
      if (ssoPhase === "recover_after_first_login") {
        isLoggedIn = true;
      }
    };

    // Case A: Direct hit on L1253 (unknown classId not in lms_class_ids, late SSO redirect during search) -> recover once cleanly
    ssoPhase = "recover_after_first_login";
    isLoggedIn = true;
    ensureAuthCalls = 0;
    routeTableEmpty = false;
    routeDrawerMissing = false;
    await drawerPage.goto("https://lms.mindx.edu.vn/admin/classes", { waitUntil: "domcontentloaded" });
    await drawerPage.evaluate(() => {
      document.body.innerHTML = `
        <input placeholder="Tìm kiếm" oninput="if(this.value){window.location.href='https://base.mindx.edu.vn/login?from=l1253'}" />
        <table><tbody></tbody></table>
      `;
    });
    isLoggedIn = false;
    await LmsHelpers.openClassDrawer(drawerPage, "VT-NOCACHE99");
    assert.strictEqual(ensureAuthCalls, 1, `L1253 should trigger ensureAuthenticated once, got ${ensureAuthCalls}`);
    assert.strictEqual(await drawerPage.locator(".MuiDrawer-paperAnchorRight h2").innerText(), "VT-NOCACHE99");
    assert.strictEqual((drawerPage as any).listenerCount("request"), 0, "No leaked request listeners after L1253 recovery");

    // Case B: Direct hit on L1375 (row exists past Stage A/B, late SSO redirect triggers during Stage C right before L1372 drawer waitFor)
    ssoPhase = "recover_after_first_login";
    isLoggedIn = true;
    ensureAuthCalls = 0;
    routeTableEmpty = false;
    routeDrawerMissing = false;
    await drawerPage.goto("https://lms.mindx.edu.vn/admin/classes", { waitUntil: "domcontentloaded" });
    await drawerPage.evaluate(() => {
      document.body.innerHTML = `
        <input placeholder="Tìm kiếm" oninput="if(this.value){setTimeout(()=>{window.location.href='https://base.mindx.edu.vn/login?from=l1375';}, 150);}" />
        <table><tbody><tr><td>VT-NOCACHE99</td><td>CSI</td></tr></tbody></table>
      `;
    });
    isLoggedIn = false;
    await LmsHelpers.openClassDrawer(drawerPage, "VT-NOCACHE99");
    assert.strictEqual(ensureAuthCalls, 1, `L1375 should trigger ensureAuthenticated once, got ${ensureAuthCalls}`);
    assert.strictEqual(await drawerPage.locator(".MuiDrawer-paperAnchorRight h2").innerText(), "VT-NOCACHE99");
    assert.strictEqual((drawerPage as any).listenerCount("request"), 0, "No leaked request listeners after L1375 recovery");

    // Case C: Already-exhausted retry guard (`_retriedAfterLogin: true`) at L1375 -> throws [LMS Error] without infinite loop
    ssoPhase = "always_login";
    isLoggedIn = false;
    ensureAuthCalls = 0;
    await drawerPage.route("https://lms.mindx.edu.vn/admin/classes*", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: `<!DOCTYPE html><html><body>
          <input placeholder="Tìm kiếm" oninput="if(this.value){window.location.href='https://base.mindx.edu.vn/login?from=stuck1375'}" />
          <table><tbody><tr><td>VT-NOCACHE99</td><td>CSI</td></tr></tbody></table>
        </body></html>`,
      });
    });
    await drawerPage.goto("https://lms.mindx.edu.vn/admin/classes", { waitUntil: "domcontentloaded" });
    await drawerPage.unroute("https://lms.mindx.edu.vn/admin/classes*");
    let loginStillStuckMsg = "";
    try {
      await LmsHelpers.openClassDrawer(drawerPage, "VT-NOCACHE99", { _retriedAfterLogin: true });
    } catch (err) {
      loginStillStuckMsg = err instanceof Error ? err.message : String(err);
    }
    assert.match(loginStillStuckMsg, /\[LMS Error\] Trình duyệt đang ở màn hình Đăng nhập LMS/);
    assert.strictEqual(ensureAuthCalls, 0, `Expected 0 ensureAuthenticated retries when _retriedAfterLogin=true at L1375, got ${ensureAuthCalls}`);
    assert.strictEqual((drawerPage as any).listenerCount("request"), 0);

    // Case D: Non-login drawer timeout must save debug_drawer_timeout.png in MINDX_DEBUG_SCREENSHOT_DIR
    isLoggedIn = true;
    routeDrawerMissing = true;
    await drawerPage.goto("https://lms.mindx.edu.vn/admin/classes", { waitUntil: "domcontentloaded" });
    let nonLoginTimeoutMsg = "";
    try {
      await LmsHelpers.openClassDrawer(drawerPage, classId);
    } catch (err) {
      nonLoginTimeoutMsg = err instanceof Error ? err.message : String(err);
    }
    assert.match(nonLoginTimeoutMsg, /Timeout khi chờ Drawer chi tiết lớp 'VT-CSI99'/);
    assert.ok(
      fs.existsSync(path.join(tempShotDir, "debug_drawer_timeout.png")),
      "Expected debug_drawer_timeout.png in MINDX_DEBUG_SCREENSHOT_DIR"
    );
    assert.strictEqual((drawerPage as any).listenerCount("request"), 0);

    await drawerCtx.close();
    console.log("  -> PASS [V383-04].");

    console.log("\nALL [V383-01..V383-04] TESTS PASSED 100%!");
  } finally {
    (authService as any).ensureAuthenticated = origEnsureAuth;
    if (mockServer) {
      await new Promise<void>((r) => mockServer!.close(() => r()));
    }
    if (browser) {
      await browser.close();
    }
    closeDb();
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  }
}

runTests().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
