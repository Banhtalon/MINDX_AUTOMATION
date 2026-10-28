/**
 * MINDX AUTOMATION BOT - v2.8.0 LMS RELIABILITY & SELF-HEALING TEST SUITE
 * Verifies:
 * - T280-01: LmsHelpers.ensureCommentsSlotReady (active no-click, inactive reactivation, unrecoverable slot throws F02)
 *            & LmsHelpers.ensureCleanDialogAndToast (hidden first dialog + visible second dialog F03, Drawer vs Dialog backdrop isolation F03).
 * - T280-02: CommentSaver fillSlotSection("Summary" | "Homework") ignores [role="tablist"]/[role="tab"] and triggers ClickAwayListener via table header without clicking slotItem.
 * - T280-03: CommentSaver mid-batch slot drop between Student 1 and Student 2 + Auto-Retry Pass 2 recovers transient pre-save UI error (verifiedCount=2, failedCount=0).
 * - T280-04: CommentSaver strict negative retry & verification boundaries (post-save network abort F01, optimistic cache F01, wrong/unrecoverable slot F02, Hash drift, ABSENT, inactive roster, duplicate student name, Read-after-Write mismatch, IN_FLIGHT_DRIFT).
 * - T280-05: SpckUploader (pre-save modal retry vs post-save timeout non-retry F01), HomeworkGradeWorker (dangling dialog cleanup + modal self-heal), and ClassSyncService (active slot preservation).
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import {
  calculateSha256,
  classSessionRepo,
  computeHomeworkContentHash,
  getDb,
  homeworkSubmissionRepo,
  sessionFeedbackRepo,
  spckSessionRepo,
  spckUploadRepo,
  studentRepo,
} from "../src/lib/db/sqlite";
import { authService, isLoginHostOrPath, parseUrlParts } from "../src/lib/playwright/auth";
import { BrowserManager } from "../src/lib/playwright/browser-manager";
import { HomeworkGradeWorker } from "../src/lib/playwright/grade-worker";
import { LmsHelpers } from "../src/lib/playwright/lms-helpers";
import { createNetworkInterceptor } from "../src/lib/playwright/network-interceptor";
import { CommentSaver } from "../src/lib/playwright/save-comments";
import { SpckUploader } from "../src/lib/playwright/spck-uploader";
import {
  ClassSyncer,
  FINISHED_CLASS_GRACE_DAYS,
  isFinishedClassWithinGraceWindow,
  parseClassDateToEndOfDayMs,
} from "../src/lib/playwright/sync-class";

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

async function runReliabilityTestsV280() {
  console.log("=== BẮT ĐẦU KIỂM THỬ ĐỘ TIN CẬY & TỰ PHỤC HỒI LMS (v2.8.0: T280-01 .. T280-05) ===");

  const testClassId = "TEST_V280_CLS";
  const testSessionId = "TEST_V280_CLS_SESS_01";
  const browser = await chromium.launch({ headless: true });

  const bm = BrowserManager.getInstance();
  const origGetPage = bm.getPage.bind(bm);
  const origEnsureAuth = authService.ensureAuthenticated.bind(authService);
  const origOpenDrawer = LmsHelpers.openClassDrawer.bind(LmsHelpers);
  const origSwitchTab = LmsHelpers.switchDrawerTab.bind(LmsHelpers);
  const origEnsureClean = LmsHelpers.ensureCleanDialogAndToast.bind(LmsHelpers);

  const cleanupClassDb = (cls: string) => {
    const db = getDb();
    db.prepare(`DELETE FROM session_feedbacks WHERE classId = ?`).run(cls);
    db.prepare(`DELETE FROM homework_submissions WHERE classId = ?`).run(cls);
    db.prepare(`DELETE FROM spck_session_submissions WHERE classId = ?`).run(cls);
    db.prepare(`DELETE FROM spck_uploads WHERE classId = ?`).run(cls);
    db.prepare(`DELETE FROM classes_sessions WHERE classId = ?`).run(cls);
    db.prepare(`DELETE FROM students WHERE classId = ?`).run(cls);
  };

  try {
    cleanupClassDb(testClassId);
    classSessionRepo.upsert({
      classId: testClassId,
      className: testClassId,
      sessionId: testSessionId,
      sessionNumber: 1,
      date: "2026-10-26",
      topic: "Buổi 1",
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    const origWaitForResponse = page.waitForResponse.bind(page);
    (page as any).waitForResponse = (predicate: any, options?: any) =>
      origWaitForResponse(
        predicate,
        options?.timeout && options.timeout >= 15000 ? { ...options, timeout: 1000 } : options
      );

    let graphqlMode: "normal" | "abort-first" | "abort-all" = "normal";
    let graphqlRequests = 0;
    let confirmedApiResponses = 0;

    await page.route("https://lms.mindx.edu.vn/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html><body></body></html>",
      });
    });

    const defaultThumbPath = path.resolve("data/config/default-spck-thumbnail.png");
    await page.route("**/default-spck-thumbnail.png*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: fs.readFileSync(defaultThumbPath),
      });
    });

    await page.route("**/graphql**", async (route) => {
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
      graphqlRequests++;
      if (graphqlMode === "abort-all" || (graphqlMode === "abort-first" && graphqlRequests === 1)) {
        await route.abort("failed");
        return;
      }
      confirmedApiResponses++;
      const postData = route.request().postData() || "";
      if (postData.includes("UpdateStudentWork") || postData.includes("CreateStudentWork")) {
        let parsedVars: any = {};
        try {
          parsedVars = JSON.parse(postData).variables || {};
        } catch {}
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({
            data: {
              studentWorks: {
                update: {
                  latestData: {
                    title: parsedVars.title || "SPCK App — Buổi 12 (GĐ1)",
                    comment: parsedVars.comment || "Con hoàn thành bài.",
                    thumbnail: {
                      name: path.basename(defaultThumbPath),
                      byteSha256: calculateSha256(fs.readFileSync(defaultThumbPath)),
                    },
                  },
                },
              },
            },
          }),
        });
        return;
      }
      if (postData.includes("GradeSubmission")) {
        let parsedVars: any = {};
        try {
          parsedVars = JSON.parse(postData).variables || {};
        } catch {}
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({
            data: {
              gradeSubmission: {
                submissionId: parsedVars.submissionId,
                studentId: parsedVars.studentId,
                classId: parsedVars.classId,
                sessionId: parsedVars.sessionId,
                score: parsedVars.score,
                decision: parsedVars.decision,
                feedback: parsedVars.feedback,
              },
            },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ data: { updateClassSlot: { id: "slot-1" } } }),
      });
    });

    await page.goto("https://lms.mindx.edu.vn/classes");

    // =========================================================================
    // T280-01: ensureCommentsSlotReady & ensureCleanDialogAndToast (including F02 & F03)
    // =========================================================================
    console.log("\n[T280-01] Kiểm thử LmsHelpers.ensureCommentsSlotReady & ensureCleanDialogAndToast (kèm F02 & F03)...");
    await page.setContent(`
      <html>
        <body>
          <div aria-labelledby="class-detail" class="MuiDrawer-paperAnchorRight">
            <div id="class-comments-slot-carousel-0" class="slot-item active">
              <div class="info-container">#1 26/10/2026</div>
              <span class="MuiCheckbox-root"><input type="checkbox" /></span>
            </div>
            <div class="comment-list-table">
              <table>
                <thead><tr><th>No</th><th>student</th><th>Attendance</th><th>Comment</th></tr></thead>
                <tbody><tr><td>1</td><td><span class="name-display">Nguyễn Văn A</span></td><td></td><td></td></tr></tbody>
              </table>
            </div>
          </div>
          <div id="dangling-modal" class="MuiDialog-root" style="display:none;">
            <div role="dialog">Modal bị kẹt</div>
          </div>
          <script>
            (() => {
              window.slotRootClicks = 0;
              window.infoContainerClicks = 0;
              window.ignoreSlotClicks = false;
              const slot0 = document.getElementById('class-comments-slot-carousel-0');
              const info0 = slot0.querySelector('.info-container');
              const tableWrap = document.querySelector('.comment-list-table');
              slot0.addEventListener('click', () => { window.slotRootClicks++; });
              info0.addEventListener('click', (e) => {
                e.stopPropagation();
                window.infoContainerClicks++;
                if (window.ignoreSlotClicks) return;
                if (slot0.classList.contains('active')) {
                  slot0.classList.remove('active');
                  slot0.classList.add('inactive');
                  tableWrap.style.display = 'none';
                } else {
                  slot0.classList.remove('inactive');
                  slot0.classList.add('active');
                  tableWrap.style.display = 'block';
                }
              });
              document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                  window.escapePressedCount = (window.escapePressedCount || 0) + 1;
                  const dm = document.getElementById('dangling-modal');
                  if (dm) dm.style.display = 'none';
                }
              });
            })();
          </script>
        </body>
      </html>
    `);

    const interceptor = createNetworkInterceptor(page);

    // 1a. Slot is ALREADY .active -> ensureCommentsSlotReady MUST NOT click it
    await LmsHelpers.ensureCommentsSlotReady(page, testClassId, 1, {
      reopenDrawerIfClosed: false,
      waitForTableMs: 2000,
    });
    const clicksWhenActive = await page.evaluate(() => ({
      slotRootClicks: (window as any).slotRootClicks,
      infoContainerClicks: (window as any).infoContainerClicks,
      isActive: document
        .getElementById("class-comments-slot-carousel-0")
        ?.classList.contains("active"),
    }));
    assert.equal(clicksWhenActive.infoContainerClicks, 0);
    assert.equal(clicksWhenActive.slotRootClicks, 0);
    assert.equal(clicksWhenActive.isActive, true);

    // 1b. Slot drops to .inactive -> ensureCommentsSlotReady MUST click .info-container to re-activate
    await page.evaluate(() => {
      const slot0 = document.getElementById("class-comments-slot-carousel-0")!;
      slot0.classList.remove("active");
      slot0.classList.add("inactive");
      (document.querySelector(".comment-list-table") as HTMLElement).style.display = "none";
    });
    await LmsHelpers.ensureCommentsSlotReady(page, testClassId, 1, {
      reopenDrawerIfClosed: false,
      waitForTableMs: 2000,
    });
    const afterReactivate = await page.evaluate(() => ({
      infoContainerClicks: (window as any).infoContainerClicks,
      isActive: document
        .getElementById("class-comments-slot-carousel-0")
        ?.classList.contains("active"),
    }));
    assert.equal(afterReactivate.infoContainerClicks, 1);
    assert.equal(afterReactivate.isActive, true);

    // 1c (F02). Unrecoverable inactive slot -> ensureCommentsSlotReady MUST throw an explicit Error
    await page.evaluate(() => {
      (window as any).ignoreSlotClicks = true;
      const slot0 = document.getElementById("class-comments-slot-carousel-0")!;
      slot0.classList.remove("active");
      slot0.classList.add("inactive");
    });
    let unrecoverableThrew = false;
    try {
      await LmsHelpers.ensureCommentsSlotReady(page, testClassId, 1, {
        reopenDrawerIfClosed: false,
        waitForTableMs: 1000,
      });
    } catch (err: any) {
      unrecoverableThrew = String(err?.message || err).includes("Không thể kích hoạt Buổi học số 1");
    }
    assert.equal(
      unrecoverableThrew,
      true,
      "T280-01 (F02): ensureCommentsSlotReady phải ném lỗi khi không thể bật lại slot .active"
    );

    // 1d. Hidden first [role="dialog"] + visible second [role="dialog"] (F03)
    await page.setContent(`
      <div role="dialog" style="display:none">hidden old dialog</div>
      <div role="dialog" id="visible-second-dialog">visible second dialog</div>
      <script>
        (() => {
          window.escapes = 0;
          document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
              window.escapes++;
              const v = document.getElementById('visible-second-dialog');
              if (v) v.remove();
            }
          });
        })();
      </script>
    `);
    await LmsHelpers.ensureCleanDialogAndToast(page, interceptor);
    const hiddenFirstStats = await page.evaluate(() => ({
      escapes: (window as any).escapes || 0,
      visibleLeft: document.querySelectorAll('#visible-second-dialog').length,
    }));
    assert.equal(
      hiddenFirstStats.escapes,
      1,
      "T280-01 (F03): Phải phát hiện dialog thứ 2 đang hiển thị dù dialog thứ 1 bị ẩn"
    );
    assert.equal(hiddenFirstStats.visibleLeft, 0);

    // 1e. Persistent dialog ignoring Escape: must click Dialog backdrop, NEVER Drawer backdrop (F03)
    await page.setContent(`
      <div class="MuiDrawer-root">
        <div class="MuiBackdrop-root" id="drawer-backdrop" style="width:100px;height:100px">drawer backdrop</div>
        <div aria-labelledby="class-detail">Class Drawer</div>
      </div>
      <div class="MuiDialog-root">
        <div class="MuiBackdrop-root" id="modal-backdrop" style="width:100px;height:100px">modal backdrop</div>
        <div role="dialog">persistent dialog</div>
      </div>
      <script>
        (() => {
          window.wrongBackdropClicks = 0;
          document.getElementById('drawer-backdrop').onclick = () => {
            window.wrongBackdropClicks++;
            document.querySelector('.MuiDrawer-root').style.display = 'none';
          };
          document.getElementById('modal-backdrop').onclick = () => {
            document.querySelector('.MuiDialog-root').remove();
          };
        })();
      </script>
    `);
    await LmsHelpers.ensureCleanDialogAndToast(page, interceptor);
    const backdropIsolation = await page.evaluate(() => ({
      wrongBackdropClicks: (window as any).wrongBackdropClicks || 0,
      drawerVisible: (document.querySelector(".MuiDrawer-root") as HTMLElement)?.style.display !== "none",
      dialogStillVisible: Boolean(document.querySelector('[role="dialog"]')),
    }));
    assert.equal(
      backdropIsolation.wrongBackdropClicks,
      0,
      "T280-01 (F03): Tuyệt đối không được bấm nhầm vào .MuiBackdrop-root của Drawer"
    );
    assert.equal(backdropIsolation.drawerVisible, true);
    assert.equal(backdropIsolation.dialogStillVisible, false);

    // 1f (R2-02). Unclosable dialog (ignores Escape AND backdrop click): ensureCleanDialogAndToast MUST throw
    await page.setContent(`
      <div class="MuiDrawer-root">
        <div class="MuiBackdrop-root" id="drawer-backdrop" style="width:100px;height:100px"></div>
      </div>
      <div class="MuiDialog-root">
        <div class="MuiBackdrop-root" id="dialog-backdrop" style="width:100px;height:100px"></div>
        <div role="dialog">Cannot close yet</div>
      </div>
      <script>
        (() => {
          window.drawerClicks = 0;
          window.dialogClicks = 0;
          document.getElementById('drawer-backdrop').onclick = () => window.drawerClicks++;
          document.getElementById('dialog-backdrop').onclick = () => window.dialogClicks++;
        })();
      </script>
    `);
    let unclosableThrew = false;
    try {
      await LmsHelpers.ensureCleanDialogAndToast(page, interceptor);
    } catch (err: any) {
      unclosableThrew = String(err?.message || err).includes("Không thể đóng hộp thoại");
    }
    const unclosableStats = await page.evaluate(() => ({
      drawerClicks: (window as any).drawerClicks || 0,
      dialogClicks: (window as any).dialogClicks || 0,
    }));
    assert.equal(
      unclosableThrew,
      true,
      "T280-01f (R2-02): ensureCleanDialogAndToast phải ném lỗi khi không thể đóng [role='dialog'] đang hiển thị"
    );
    assert.equal(unclosableStats.drawerClicks, 0);
    assert.equal(unclosableStats.dialogClicks, 1);
    console.log("  -> PASS T280-01.");

    // =========================================================================
    // T280-02 & T280-03: CommentSaver (Tablist Isolation + Mid-Batch Slot Drop Between Student 1 & 2 + Auto-Retry Pass 2)
    // =========================================================================
    console.log(
      "\n[T280-02 & T280-03] Kiểm thử CommentSaver: cách ly Tablist Homework, tự phục hồi slot rơi .inactive giữa Học viên 1 & 2, và Auto-Retry Pass 2..."
    );

    studentRepo.upsert({
      studentId: "STU_V280_01",
      classId: testClassId,
      fullName: "Lê Minh Khôi",
      isActive: 1,
    });
    studentRepo.upsert({
      studentId: "STU_V280_02",
      classId: testClassId,
      fullName: "Phạm Gia Hân",
      isActive: 1,
    });

    const comment1 =
      "- **Điểm mạnh của học viên:** Con hiểu bài nhanh.\n- **Điểm cần cải thiện:** Rèn thêm tốc độ.\n- **Lời khuyên:** Con làm BTVN nhé.";
    const comment2 =
      "- **Điểm mạnh của học viên:** Con chăm chú nghe giảng.\n- **Điểm cần cải thiện:** Chú ý cú pháp.\n- **Lời khuyên:** Con ôn lại bài nhé.";

    sessionFeedbackRepo.upsert({
      classId: testClassId,
      sessionId: testSessionId,
      studentId: "STU_V280_01",
      attendanceStatus: "PRESENT",
      quickTagsJson: '["tier_1_gioi"]',
      teacherNote: "",
      finalText: comment1,
      status: "APPROVED",
      contentHash: sha256(comment1),
    });
    sessionFeedbackRepo.upsert({
      classId: testClassId,
      sessionId: testSessionId,
      studentId: "STU_V280_02",
      attendanceStatus: "PRESENT",
      quickTagsJson: '["tier_2_kha"]',
      teacherNote: "",
      finalText: comment2,
      status: "APPROVED",
      contentHash: sha256(comment2),
    });

    await page.goto("https://lms.mindx.edu.vn/classes");
    await page.setContent(`
      <html>
        <body>
          <div aria-labelledby="class-detail" class="MuiDrawer-paperAnchorRight">
            <div>
              <div>
                <div role="tablist">
                  <button role="tab" id="drawer-tab-homework"><span>Homework</span></button>
                  <button role="tab" id="tabs-10" aria-selected="true"><span>Comments</span></button>
                </div>
              </div>
            </div>

            <div id="class-comments-slot-carousel-0" class="slot-item active">
              <div class="info-container">#1 26/10/2026</div>
            </div>
            <div id="class-comments-slot-carousel-1" class="slot-item inactive">
              <div class="info-container">#2 02/11/2026</div>
            </div>

            <div id="slot-content-area">
              <div class="slot-section-card" id="summary-card">
                <div><div><div><span>Summary</span></div></div></div>
                <div class="section-body">
                  <div><div id="summary-display" style="min-height:24px; cursor:pointer;">Click to edit summary</div></div>
                </div>
              </div>

              <div class="slot-section-card" id="homework-card">
                <div><div><div><span>Homework</span></div></div></div>
                <div class="section-body">
                  <div><div id="homework-display" style="min-height:24px; cursor:pointer;">Click to edit homework</div></div>
                </div>
              </div>

              <div class="comment-list-table">
                <table>
                  <thead>
                    <tr><th>No</th><th>student</th><th>Attendance</th><th>Comment</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    <tr data-row-stu="STU_V280_01">
                      <td>1</td>
                      <td>Lê Minh Khôi</td>
                      <td><label><span><input type="checkbox" checked /></span><span>Attended</span></label></td>
                      <td><div class="comment-preview" data-stu="STU_V280_01"></div></td>
                      <td><button type="button" class="open-comment-btn" data-stu="STU_V280_01">Nhận xét học sinh</button></td>
                    </tr>
                    <tr data-row-stu="STU_V280_02">
                      <td>2</td>
                      <td>Phạm Gia Hân</td>
                      <td><label><span><input type="checkbox" checked /></span><span>Attended</span></label></td>
                      <td><div class="comment-preview" data-stu="STU_V280_02"></div></td>
                      <td><button type="button" class="open-comment-btn" data-stu="STU_V280_02">Nhận xét học sinh</button></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div id="comment-modal-root"></div>

          <script>
            (() => {
              window.tabHomeworkClicks = 0;
              window.slotToggleOffCount = 0;
              window.slotReactivateCount = 0;
              window.stu1ModalOpens = 0;
              window.actualSavedSlots = [];
              window.savedCommentsByStu = {};

              document.getElementById('drawer-tab-homework').addEventListener('click', () => {
                window.tabHomeworkClicks++;
              });

              const slot0 = document.getElementById('class-comments-slot-carousel-0');
              const info0 = slot0.querySelector('.info-container');
              const contentArea = document.getElementById('slot-content-area');

              info0.addEventListener('click', (e) => {
                e.stopPropagation();
                if (slot0.classList.contains('active')) {
                  slot0.classList.remove('active');
                  slot0.classList.add('inactive');
                  contentArea.style.display = 'none';
                  window.slotToggleOffCount++;
                } else {
                  slot0.classList.remove('inactive');
                  slot0.classList.add('active');
                  contentArea.style.display = 'block';
                  window.slotReactivateCount++;
                }
              });

              function setupSectionEditor(cardId, displayId, fieldName) {
                const card = document.getElementById(cardId);
                const sectionBody = card.querySelector('.section-body');
                const display = document.getElementById(displayId);
                display.addEventListener('click', (e) => {
                  e.stopPropagation();
                  if (sectionBody.querySelector('.ql-editor')) return;
                  const ed = document.createElement('div');
                  ed.className = 'ql-editor';
                  ed.setAttribute('contenteditable', 'true');
                  ed.textContent = display.dataset.savedText || '';
                  sectionBody.appendChild(ed);
                  ed.focus();

                  const onDocClickAway = (evt) => {
                    if (!card.contains(evt.target)) {
                      document.removeEventListener('mousedown', onDocClickAway);
                      const val = (ed.innerText || ed.textContent || '').trim();
                      display.dataset.savedText = val;
                      display.textContent = val;
                      ed.remove();
                      fetch('https://lms-api.mindx.edu.vn/graphql', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ operationName: 'UpdateSlotComment', field: fieldName, value: val }),
                      });
                    }
                  };
                  setTimeout(() => document.addEventListener('mousedown', onDocClickAway), 0);
                });
              }
              setupSectionEditor('summary-card', 'summary-display', 'Summary');
              setupSectionEditor('homework-card', 'homework-display', 'Homework');

              document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                  document.getElementById('comment-modal-root').innerHTML = '';
                }
              });

              document.querySelectorAll('.open-comment-btn').forEach((btn) => {
                btn.addEventListener('click', () => {
                  const stuId = btn.getAttribute('data-stu');
                  const modalRoot = document.getElementById('comment-modal-root');

                  if (window.savedCommentsByStu[stuId]) {
                    modalRoot.innerHTML =
                      '<div role="dialog" class="MuiDialog-paper">' +
                      '<table><tbody><tr><td>- Đánh giá chung: ' + window.savedCommentsByStu[stuId] + '</td></tr></tbody></table>' +
                      '</div>';
                    return;
                  }

                  let includeSaveBtn = true;
                  if (stuId === 'STU_V280_01') {
                    window.stu1ModalOpens++;
                    if (window.stu1ModalOpens === 1) {
                      // Glitch on Pass 1: Save button fails to mount AND slot0 drops to .inactive right after Student 1 fails (between Student 1 and Student 2)!
                      includeSaveBtn = false;
                      setTimeout(() => {
                        slot0.classList.remove('active');
                        slot0.classList.add('inactive');
                        contentArea.style.display = 'none';
                      }, 50);
                    }
                  }

                  modalRoot.innerHTML =
                    '<div role="dialog" class="MuiDialog-paper">' +
                    '<div class="ql-editor" contenteditable="true" id="modal-comment-ed"></div>' +
                    (includeSaveBtn ? '<button type="button" id="modal-save-btn">Save</button>' : '') +
                    '</div>';
                  const saveBtn = document.getElementById('modal-save-btn');
                  if (saveBtn) {
                    saveBtn.addEventListener('click', () => {
                      const ed = document.getElementById('modal-comment-ed');
                      const newHtml = (ed.innerHTML || '').trim();
                      const activeSlot = slot0.classList.contains('active') ? 1 : 2;
                      window.actualSavedSlots.push(activeSlot);
                      window.savedCommentsByStu[stuId] = newHtml;
                      modalRoot.innerHTML = '';
                      fetch('https://lms-api.mindx.edu.vn/graphql', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          operationName: 'UpdateSlotComment',
                          variables: {
                            classId: '${testClassId}',
                            studentId: stuId,
                            slotNumber: activeSlot,
                            comment: newHtml,
                          },
                        }),
                      });
                    });
                  }
                });
              });
            })();
          </script>
        </body>
      </html>
    `);

    bm.getPage = async () => page;
    authService.ensureAuthenticated = async () => {};
    LmsHelpers.openClassDrawer = async () => {};
    LmsHelpers.switchDrawerTab = async () => {};

    const saveRes = await CommentSaver.saveComments({
      classId: testClassId,
      classCode: testClassId,
      sessionId: testSessionId,
      topic: "Làm quen với Scratch",
      keyKnowledge: ["Khối lệnh chuyển động"],
      homeworkBrief: "Làm 10 câu trắc nghiệm trên LMS",
    });

    const uiMetrics = await page.evaluate(() => ({
      tabHomeworkClicks: (window as any).tabHomeworkClicks,
      slotToggleOffCount: (window as any).slotToggleOffCount,
      slotReactivateCount: (window as any).slotReactivateCount,
      stu1ModalOpens: (window as any).stu1ModalOpens,
      actualSavedSlots: (window as any).actualSavedSlots,
      summarySaved: document.getElementById("summary-display")?.textContent,
      homeworkSaved: document.getElementById("homework-display")?.textContent,
    }));

    assert.equal(uiMetrics.tabHomeworkClicks, 0);
    assert.equal(uiMetrics.slotToggleOffCount, 0);
    assert.ok(
      uiMetrics.slotReactivateCount >= 1,
      "T280-03: Phải tự động bật lại slot 1 bị rơi .inactive giữa Học viên 1 và Học viên 2"
    );
    assert.deepEqual(
      uiMetrics.actualSavedSlots,
      [1, 1],
      "T280-03: Mọi lượt lưu phải diễn ra trên đúng Buổi 1 (slot 1 .active)"
    );
    assert.ok(uiMetrics.summarySaved?.includes("LÀM QUEN VỚI SCRATCH"));
    assert.equal(uiMetrics.homeworkSaved, "Làm 10 câu trắc nghiệm trên LMS");
    assert.equal(saveRes.verifiedCount, 2);
    assert.equal(saveRes.failedCount, 0);
    assert.equal(uiMetrics.stu1ModalOpens, 2);
    console.log("  -> PASS T280-02 & T280-03.");

    // =========================================================================
    // T280-04: Strict Negative Retry & Verification Boundaries (F01, F02, F04)
    // =========================================================================
    console.log(
      "\n[T280-04] Kiểm thử ranh giới KHÔNG retry sau khi bấm Save (F01), chống lưu nhầm buổi (F02) & 6 Guardrail dữ liệu (F04)..."
    );

    const runSingleStudentBoundaryCase = async (
      caseMode:
        | "postsave-timeout"
        | "optimistic-cache"
        | "wrong-slot"
        | "missing-slot"
        | "raw-mismatch"
        | "in-flight-drift"
    ) => {
      const cls = `TEST_V280_${caseMode.replace(/-/g, "_").toUpperCase()}`;
      const sid = `${cls}_SESS_01`;
      const stu = "STU_BOUNDARY_01";
      cleanupClassDb(cls);

      classSessionRepo.upsert({
        classId: cls,
        className: cls,
        sessionId: sid,
        sessionNumber: 1,
        date: "2026-10-26",
        topic: "Buổi 1",
      });
      studentRepo.upsert({
        classId: cls,
        studentId: stu,
        fullName: "Trần Bảo Ngọc",
        isActive: 1,
      });
      sessionFeedbackRepo.upsert({
        classId: cls,
        sessionId: sid,
        studentId: stu,
        attendanceStatus: "PRESENT",
        finalText: comment1,
        status: "APPROVED",
        contentHash: sha256(comment1),
      });

      graphqlRequests = 0;
      confirmedApiResponses = 0;
      graphqlMode =
        caseMode === "postsave-timeout" || caseMode === "optimistic-cache"
          ? "abort-first"
          : "normal";

      await page.goto("https://lms.mindx.edu.vn/classes");
      await page.setContent(`
        <div aria-labelledby="class-detail" class="MuiDrawer-paperAnchorRight">
          <div id="class-comments-slot-carousel-0" class="active"><div class="info-container">Slot 1</div></div>
          <div id="class-comments-slot-carousel-1" class="inactive"><div class="info-container">Slot 2</div></div>
          <div class="comment-list-table">
            <table>
              <thead><tr><th>student</th></tr></thead>
              <tbody>
                <tr data-student-id="${stu}">
                  <td>Trần Bảo Ngọc</td>
                  <td><button id="open-btn">Nhận xét học sinh</button></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div id="modal-root"></div>
      `);

      await page.evaluate(
        ({ cls, stu, caseMode }) => {
          (window as any).saves = 0;
          (window as any).opens = 0;
          (window as any).cached = "";
          (window as any).actualSavedSlots = [];
          document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
              document.getElementById("modal-root")!.innerHTML = "";
            }
          });
          document.getElementById("open-btn")!.onclick = () => {
            (window as any).opens++;
            if (caseMode === "missing-slot") {
              document.getElementById("class-comments-slot-carousel-0")?.remove();
              document.getElementById("class-comments-slot-carousel-1")!.className = "active";
            }
            const root = document.getElementById("modal-root")!;
            if ((window as any).cached) {
              root.innerHTML =
                '<div role="dialog"><table><tbody><tr><td>- Đánh giá chung: ' +
                (window as any).cached +
                "</td></tr></tbody></table></div>";
              return;
            }
            root.innerHTML =
              '<div role="dialog"><div class="ql-editor" contenteditable="true"></div><button id="save-btn">Save</button></div>';
            document.getElementById("save-btn")!.onclick = () => {
              (window as any).saves++;
              const html = document.querySelector(".ql-editor")!.innerHTML;
              const slot = document
                .getElementById("class-comments-slot-carousel-0")
                ?.classList.contains("active")
                ? 1
                : 2;
              (window as any).actualSavedSlots.push(slot);
              if (caseMode === "raw-mismatch") {
                (window as any).cached = "Nội dung bị lệch trên DOM";
              } else if (caseMode !== "postsave-timeout" || (window as any).saves > 1) {
                (window as any).cached = html;
              }
              root.innerHTML = "";
              fetch("https://lms-api.mindx.edu.vn/graphql", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  operationName: "UpdateSlotComment",
                  variables: {
                    classId: cls,
                    studentId: stu,
                    slotId:
                      slot === 1 ? "111111111111111111111111" : "222222222222222222222222",
                    comment: html,
                  },
                }),
              }).catch(() => {});
            };
          };
        },
        { cls, stu, caseMode }
      );

      let injected = false;
      LmsHelpers.ensureCleanDialogAndToast = async (...args) => {
        await origEnsureClean(...args);
        if (!injected && caseMode === "wrong-slot") {
          injected = true;
          await page.evaluate(() => {
            document.getElementById("class-comments-slot-carousel-0")!.className = "inactive";
            document.getElementById("class-comments-slot-carousel-1")!.className = "active";
          });
        }
      };

      if (caseMode === "in-flight-drift") {
        // Demote record in SQLite to DRAFT as soon as the comment modal opens (before Save is clicked)
        await page.exposeFunction("__triggerInFlightDrift_" + cls, () => {
          getDb()
            .prepare(
              `UPDATE session_feedbacks SET status = 'DRAFT', finalText = 'Edited during modal open' WHERE classId = ? AND sessionId = ? AND studentId = ?`
            )
            .run(cls, sid, stu);
        });
        await page.evaluate((fnName) => {
          const origClick = document.getElementById("open-btn")!.onclick as any;
          document.getElementById("open-btn")!.onclick = (ev) => {
            origClick(ev);
            (window as any)[fnName]();
          };
        }, "__triggerInFlightDrift_" + cls);
      }

      try {
        const batch = await CommentSaver.saveComments({
          classId: cls,
          classCode: cls,
          sessionId: sid,
        });
        const metrics = await page.evaluate(() => ({
          saves: (window as any).saves as number,
          opens: (window as any).opens as number,
          actualSavedSlots: (window as any).actualSavedSlots as number[],
        }));
        const dbRec = sessionFeedbackRepo.findOne(cls, sid, stu);
        return { batch, metrics, confirmedApiResponses, dbStatus: dbRec?.status };
      } finally {
        LmsHelpers.ensureCleanDialogAndToast = origEnsureClean;
        graphqlMode = "normal";
        cleanupClassDb(cls);
      }
    };

    // 4a. Post-save network failure MUST NOT trigger Pass 2 retry (F01)
    const postSaveTimeoutRes = await runSingleStudentBoundaryCase("postsave-timeout");
    assert.equal(
      postSaveTimeoutRes.metrics.saves,
      1,
      "T280-04a (F01): Khi Save đã được bấm nhưng mạng đứt, tuyệt đối KHÔNG chạy Pass 2 bấm Save lần 2"
    );
    assert.equal(postSaveTimeoutRes.batch.verifiedCount, 0);
    assert.equal(postSaveTimeoutRes.batch.failedCount, 1);
    assert.equal(postSaveTimeoutRes.dbStatus, "FAILED");

    // 4b. Optimistic local cache after aborted Save MUST NOT be marked VERIFIED without HTTP 200/201 API response (F01)
    const optimisticCacheRes = await runSingleStudentBoundaryCase("optimistic-cache");
    assert.equal(optimisticCacheRes.metrics.saves, 1);
    assert.equal(optimisticCacheRes.confirmedApiResponses, 0);
    assert.equal(
      optimisticCacheRes.batch.verifiedCount,
      0,
      "T280-04b (F01): Cache cục bộ trên DOM khi API mạng thất bại tuyệt đối không được đánh dấu VERIFIED"
    );
    assert.equal(optimisticCacheRes.batch.failedCount, 1);

    // 4c. Wrong-slot / unrecoverable slot mid-run MUST abort before clicking Save (F02)
    const wrongSlotRes = await runSingleStudentBoundaryCase("wrong-slot");
    assert.equal(
      wrongSlotRes.metrics.saves,
      0,
      "T280-04c (F02): Khi slot đích không còn .active và không bật lại được, phải dừng ngay trước khi bấm Save"
    );
    assert.deepEqual(wrongSlotRes.metrics.actualSavedSlots, []);
    assert.equal(wrongSlotRes.batch.verifiedCount, 0);
    assert.equal(wrongSlotRes.batch.failedCount, 1);

    // 4c2 (R2-01). Missing/removed target slot while modal is open MUST abort before clicking Save
    const missingSlotRes = await runSingleStudentBoundaryCase("missing-slot");
    assert.equal(
      missingSlotRes.metrics.saves,
      0,
      "T280-04c2 (R2-01): Khi slot đích bị gỡ khỏi DOM trong lúc mở modal, tuyệt đối không được bấm Save"
    );
    assert.deepEqual(missingSlotRes.metrics.actualSavedSlots, []);
    assert.equal(missingSlotRes.batch.verifiedCount, 0);
    assert.equal(missingSlotRes.batch.failedCount, 1);

    // 4d. Read-after-Write mismatch MUST NOT trigger Pass 2 retry
    const rawMismatchRes = await runSingleStudentBoundaryCase("raw-mismatch");
    assert.equal(
      rawMismatchRes.metrics.saves,
      1,
      "T280-04d: Lỗi Read-after-Write sau khi đã bấm Save tuyệt đối không chạy lại ở Pass 2"
    );
    assert.equal(rawMismatchRes.batch.verifiedCount, 0);
    assert.equal(rawMismatchRes.batch.failedCount, 1);

    // 4e. IN_FLIGHT_DRIFT MUST abort before Save and MUST NOT trigger Pass 2 retry
    const inFlightDriftRes = await runSingleStudentBoundaryCase("in-flight-drift");
    assert.equal(inFlightDriftRes.metrics.saves, 0);
    assert.equal(
      inFlightDriftRes.metrics.opens,
      1,
      "T280-04e: IN_FLIGHT_DRIFT tuyệt đối không được thử lại ở Pass 2"
    );
    assert.equal(inFlightDriftRes.batch.verifiedCount, 0);
    assert.equal(inFlightDriftRes.dbStatus, "DRAFT");

    // 4f. Pre-save guardrails: Hash drift, ABSENT, Inactive roster (isActive=0), Duplicate student name -> 0 modal opens & no retry
    studentRepo.upsert({
      studentId: "STU_V280_03_INACTIVE",
      classId: testClassId,
      fullName: "Hoàng Văn Nam",
      isActive: 0,
    });
    studentRepo.upsert({
      studentId: "STU_V280_04_DUP_A",
      classId: testClassId,
      fullName: "Nguyễn Trùng Tên",
      isActive: 1,
    });
    studentRepo.upsert({
      studentId: "STU_V280_05_DUP_B",
      classId: testClassId,
      fullName: "Nguyễn Trùng Tên",
      isActive: 1,
    });

    const db = getDb();
    db.prepare(
      `UPDATE session_feedbacks SET status = 'APPROVED', finalText = ?, contentHash = ? WHERE classId = ? AND sessionId = ? AND studentId = 'STU_V280_01'`
    ).run(comment1 + " (đã sửa sau khi duyệt)", sha256(comment1), testClassId, testSessionId);

    db.prepare(
      `UPDATE session_feedbacks SET status = 'APPROVED', attendanceStatus = 'ABSENT', finalText = ?, contentHash = ? WHERE classId = ? AND sessionId = ? AND studentId = 'STU_V280_02'`
    ).run(comment2, sha256(comment2), testClassId, testSessionId);

    sessionFeedbackRepo.upsert({
      classId: testClassId,
      sessionId: testSessionId,
      studentId: "STU_V280_03_INACTIVE",
      attendanceStatus: "PRESENT",
      finalText: comment1,
      status: "APPROVED",
      contentHash: sha256(comment1),
    });
    sessionFeedbackRepo.upsert({
      classId: testClassId,
      sessionId: testSessionId,
      studentId: "STU_V280_04_DUP_A",
      attendanceStatus: "PRESENT",
      finalText: comment1,
      status: "APPROVED",
      contentHash: sha256(comment1),
    });

    await page.setContent(`
      <div aria-labelledby="class-detail" class="MuiDrawer-paperAnchorRight">
        <div id="class-comments-slot-carousel-0" class="active"><div class="info-container">Slot 1</div></div>
        <div class="comment-list-table">
          <table>
            <thead><tr><th>student</th></tr></thead>
            <tbody>
              <tr><td>Nguyễn Trùng Tên</td><td><button class="open-btn">Nhận xét học sinh</button></td></tr>
              <tr><td>Nguyễn Trùng Tên</td><td><button class="open-btn">Nhận xét học sinh</button></td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <script>
        window.guardrailModalOpens = 0;
        document.querySelectorAll('.open-btn').forEach((b) => {
          b.onclick = () => { window.guardrailModalOpens++; };
        });
      </script>
    `);

    const guardrailRes = await CommentSaver.saveComments({
      classId: testClassId,
      classCode: testClassId,
      sessionId: testSessionId,
    });

    assert.equal(guardrailRes.verifiedCount, 0);
    assert.equal(guardrailRes.failedCount, 4);
    assert.equal(await page.evaluate(() => (window as any).guardrailModalOpens || 0), 0);
    assert.ok(
      guardrailRes.results.find((r) => r.studentId === "STU_V280_01")?.error?.includes("Hash drift")
    );
    assert.ok(
      guardrailRes.results.find((r) => r.studentId === "STU_V280_02")?.error?.includes("ABSENT")
    );
    assert.ok(
      guardrailRes.results
        .find((r) => r.studentId === "STU_V280_03_INACTIVE")
        ?.error?.includes("không còn thuộc danh sách active")
    );
    assert.ok(
      guardrailRes.results
        .find((r) => r.studentId === "STU_V280_04_DUP_A")
        ?.error?.includes("trùng tên")
    );
    console.log("  -> PASS T280-04.");

    // =========================================================================
    // T280-05: SpckUploader (Pre-Save Retry vs Post-Save Non-Retry F01), HomeworkGradeWorker & ClassSyncService
    // =========================================================================
    console.log(
      "\n[T280-05] Kiểm thử SpckUploader (Pre-Save Retry vs Post-Save Non-Retry F01), HomeworkGradeWorker & ClassSyncService..."
    );

    const runSpckModalCase = async (
      mode: "pre-save-retry" | "post-save-abort" | "missing-slot"
    ) => {
      const cls = `TEST_V280_SPCK_${
        mode === "pre-save-retry" ? "PRE" : mode === "post-save-abort" ? "POST" : "MISSING"
      }`;
      const stu = "STU_SPCK_01";
      const stuName = "Đặng Quốc Khánh";
      const folder = path.resolve("temp_submissions/v280-spck-test");
      fs.mkdirSync(folder, { recursive: true });
      cleanupClassDb(cls);

      classSessionRepo.upsert({
        classId: cls,
        className: cls,
        sessionId: `${cls}_SESS_12`,
        sessionNumber: 12,
        date: "2026-10-26",
        topic: "SPCK",
      });
      studentRepo.upsert({
        classId: cls,
        studentId: stu,
        fullName: stuName,
        isActive: 1,
      });
      spckUploadRepo.upsert({
        classId: cls,
        studentId: stu,
        localFolderPath: folder,
        matchScore: 1,
        isConfirmedByTeacher: 1,
        projectTitle: "SPCK App",
        thumbnailPath: defaultThumbPath,
        screenshotsJson: "[]",
        attachmentsJson: "[]",
        youtubeUrlsJson: "[]",
        relatedLinksJson: "[]",
        teacherComment: "Con hoàn thành bài.",
        contentHash: "",
        status: "WAITING_APPROVAL",
      });
      spckSessionRepo.saveSessionDraft({
        classId: cls,
        studentId: stu,
        sessionNumber: 12,
        localFolderPath: folder,
        isConfirmedByTeacher: 1,
        projectTitle: "SPCK App — Buổi 12 (GĐ1)",
        thumbnailPath: defaultThumbPath,
        teacherComment: "Con hoàn thành bài.",
      });
      spckSessionRepo.approveSessionDraft(cls, stu, 12);

      graphqlRequests = 0;
      confirmedApiResponses = 0;
      graphqlMode = mode === "post-save-abort" ? "abort-first" : "normal";

      await page.goto("https://lms.mindx.edu.vn/classes");
      await page.setContent(`
        <div aria-labelledby="class-detail" class="MuiDrawer-paperAnchorRight">
          <div id="class-comments-slot-carousel-11" class="active"><div class="info-container">Slot 12</div></div>
          <div class="comment-list-table">
            <table>
              <thead><tr><th>student</th></tr></thead>
              <tbody>
                <tr>
                  <td><span class="name-display">${stuName}</span></td>
                  <td><button id="open-spck-btn">Sản phẩm của học sinh</button></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div id="modal-root"></div>
      `);

      await page.evaluate(
        ({ stuName, mode }) => {
          (window as any).spckOpens = 0;
          (window as any).spckSaves = 0;
          document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
              document.getElementById("modal-root")!.innerHTML = "";
            }
          });
          document.getElementById("open-spck-btn")!.onclick = () => {
            (window as any).spckOpens++;
            if (mode === "missing-slot") {
              document.getElementById("class-comments-slot-carousel-11")?.remove();
              if (!document.getElementById("class-comments-slot-carousel-12")) {
                document
                  .querySelector('[aria-labelledby="class-detail"]')!
                  .insertAdjacentHTML(
                    "afterbegin",
                    '<div id="class-comments-slot-carousel-12" class="active">Slot 13</div>'
                  );
              }
            }
            // In pre-save-retry mode, the FIRST click fails to mount the "+ Thêm sản phẩm học viên" button & form!
            if (mode === "pre-save-retry" && (window as any).spckOpens === 1) {
              document.getElementById("modal-root")!.innerHTML =
                `<div class="MuiDialog-root"><div role="dialog" class="MuiDialog-paper"><h2>${stuName}</h2></div></div>`;
              return;
            }
            document.getElementById("modal-root")!.innerHTML =
              `<div class="MuiDialog-root"><div role="dialog" class="MuiDialog-paper">` +
              `<h2>${stuName}</h2>` +
              `<input id="title" value="SPCK App — Buổi 12 (GĐ1)" />` +
              `<textarea id="comment">Con hoàn thành bài.</textarea>` +
              `<input type="file" accept="image/png" />` +
              `<img src="https://resources.mindx.edu.vn/default-spck-thumbnail.png" />` +
              `<button type="submit" id="save-spck-btn">Save</button>` +
              `</div></div>`;
            document.getElementById("save-spck-btn")!.onclick = () => {
              (window as any).spckSaves++;
              fetch("https://lms-api.mindx.edu.vn/graphql", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  operationName: "UpdateStudentWork",
                  variables: {
                    title: (document.getElementById("title") as HTMLInputElement).value,
                    comment: (document.getElementById("comment") as HTMLTextAreaElement).value,
                  },
                }),
              }).catch(() => {});
            };
          };
        },
        { stuName, mode }
      );

      try {
        const res = await (SpckUploader as any).runUploadInternal({
          classId: cls,
          sessionNumber: 12,
          studentIds: [stu],
          customPage: page,
        });
        const metrics = await page.evaluate(() => ({
          spckOpens: (window as any).spckOpens as number,
          spckSaves: (window as any).spckSaves as number,
        }));
        return { res, metrics };
      } finally {
        graphqlMode = "normal";
        cleanupClassDb(cls);
      }
    };

    // 5a. SpckUploader pre-save modal failure -> Auto-Retry Pass 2 succeeds
    const spckPreRes = await runSpckModalCase("pre-save-retry");
    assert.equal(spckPreRes.res.verifiedCount, 1);
    assert.equal(spckPreRes.res.failedCount, 0);
    assert.equal(spckPreRes.metrics.spckSaves, 1);
    assert.ok(spckPreRes.metrics.spckOpens >= 2);

    // 5b. SpckUploader post-save timeout -> MUST NOT run Auto-Retry Pass 2 (F01)
    const spckPostRes = await runSpckModalCase("post-save-abort");
    assert.equal(
      spckPostRes.metrics.spckSaves,
      1,
      "T280-05b (F01): SpckUploader sau khi bấm Save bị timeout tuyệt đối không được chạy Pass 2 bấm Save lần 2"
    );
    assert.equal(spckPostRes.res.verifiedCount, 0);
    assert.equal(spckPostRes.res.failedCount, 1);

    // 5b2 (R2-01). SpckUploader missing/removed target slot -> MUST abort before clicking Save
    const spckMissingSlotRes = await runSpckModalCase("missing-slot");
    assert.equal(
      spckMissingSlotRes.metrics.spckSaves,
      0,
      "T280-05b2 (R2-01): SpckUploader khi ô buổi học đích biến mất khỏi DOM tuyệt đối không được bấm Save"
    );
    assert.equal(spckMissingSlotRes.res.verifiedCount, 0);
    assert.equal(spckMissingSlotRes.res.failedCount, 1);

    // 5c. HomeworkGradeWorker: pre-student dangling dialog cleanup + modal open self-heal
    const hwClassId = "TEST_V280_HW_CLS";
    const hwSessionId = "TEST_V280_HW_CLS_SESS_01";
    const hwStuId = "STU_HW_01";
    const hwSubId = "SUB_HW_01";
    cleanupClassDb(hwClassId);

    studentRepo.upsert({
      classId: hwClassId,
      studentId: hwStuId,
      fullName: "Vũ Hoàng Quân",
      isActive: 1,
    });
    const hwDraft = {
      classId: hwClassId,
      sessionId: hwSessionId,
      studentId: hwStuId,
      submissionId: hwSubId,
      originalFileName: "main.py",
      localFilePath: "",
      fileHash: "hw-file-hash-280",
      parseStatus: "PARSED" as const,
      parseErrorReason: null,
      criteriaGradesJson: "[]",
      calculatedScore: 95,
      teacherOverrideScore: null,
      decision: "GRADE" as const,
      feedbackHtml: "<p>Bài làm rất tốt</p>",
      contentHash: "",
      status: "APPROVED" as const,
      verifiedAt: null,
      errorMessage: null,
    };
    hwDraft.contentHash = computeHomeworkContentHash({
      classId: hwDraft.classId,
      sessionId: hwDraft.sessionId,
      studentId: hwDraft.studentId,
      submissionId: hwDraft.submissionId,
      fileHash: hwDraft.fileHash,
      decision: hwDraft.decision,
      calculatedScore: 95,
      teacherOverrideScore: null,
      criteriaGradesJson: hwDraft.criteriaGradesJson,
      feedbackHtml: hwDraft.feedbackHtml,
    });
    homeworkSubmissionRepo.upsert(hwDraft);

    await page.setContent(`
      <div aria-labelledby="class-detail" class="MuiDrawer-paperAnchorRight">
        <div id="tabpanel-3">
          <table>
            <tbody>
              <tr>
                <td>Vũ Hoàng Quân (${hwStuId})</td>
                <td id="hw-cell-0">Chưa chấm</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div id="dangling-hw-dialog" role="dialog">Stale Dialog Before Grading</div>
      <div id="hw-modal-root"></div>
      <script>
        (() => {
          window.hwCellClicks = 0;
          window.hwSavedScore = null;
          window.hwSavedFeedback = '';
          document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
              const d = document.getElementById('dangling-hw-dialog');
              if (d) d.remove();
              document.getElementById('hw-modal-root').innerHTML = '';
            }
          });
          document.getElementById('hw-cell-0').onclick = () => {
            window.hwCellClicks++;
            // First click is swallowed to test HomeworkGradeWorker self-healing modal open!
            if (window.hwCellClicks === 1) return;
            const fb = window.hwSavedFeedback || 'Bài làm rất tốt';
            const sc = window.hwSavedScore !== null ? window.hwSavedScore : 95;
            document.getElementById('hw-modal-root').innerHTML =
              '<div role="dialog" class="grade-modal">' +
              '<div>Học viên: Vũ Hoàng Quân (${hwStuId}) - Mã bài nộp: ${hwSubId}</div>' +
              '<label><span>Chấm điểm</span><input type="radio" name="dec" checked /></label>' +
              '<input type="number" id="hw-score-input" value="' + sc + '" />' +
              '<div class="ql-editor" contenteditable="true" id="hw-fb-editor">' + fb + '</div>' +
              '<button type="button" id="hw-save-btn">Lưu</button>' +
              '</div>';
            document.getElementById('hw-save-btn').onclick = () => {
              const scoreVal = Number(document.getElementById('hw-score-input').value);
              const fbVal = (document.getElementById('hw-fb-editor').textContent || '').trim();
              window.hwSavedScore = scoreVal;
              window.hwSavedFeedback = fbVal;
              document.getElementById('hw-cell-0').textContent = scoreVal + '/100';
              document.getElementById('hw-modal-root').innerHTML = '';
              fetch('https://lms-api.mindx.edu.vn/graphql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  operationName: 'GradeSubmission',
                  query: 'mutation GradeSubmission($submissionId: ID!, $studentId: ID!, $classId: ID!, $sessionId: ID!, $score: Float!, $decision: String!, $feedback: String!) { gradeSubmission(submissionId: $submissionId, studentId: $studentId, classId: $classId, sessionId: $sessionId, score: $score, decision: $decision, feedback: $feedback) { submissionId studentId classId sessionId score decision feedback } }',
                  variables: {
                    submissionId: '${hwSubId}',
                    studentId: '${hwStuId}',
                    classId: '${hwClassId}',
                    sessionId: '${hwSessionId}',
                    score: scoreVal,
                    decision: 'GRADE',
                    feedback: fbVal,
                  },
                }),
              });
            };
          };
        })();
      </script>
    `);

    const hwRes = await HomeworkGradeWorker.saveApprovedGrades({
      classId: hwClassId,
      classCode: hwClassId,
      sessionId: hwSessionId,
      submissionId: hwSubId,
    });
    assert.equal(hwRes.verifiedCount, 1);
    assert.equal(hwRes.failedCount, 0);
    cleanupClassDb(hwClassId);

    // 5d. ClassSyncService.scrapeSessions: never clicks an already-.active latest slot
    await page.setContent(`
      <div aria-labelledby="class-detail" class="MuiDrawer-paperAnchorRight">
        <div id="class-comments-slot-carousel-0" class="slot-item inactive">
          <div class="info-container">#1 19/10/2026</div>
        </div>
        <div id="class-comments-slot-carousel-1" class="slot-item active">
          <div class="info-container">#2 26/10/2026</div>
        </div>
      </div>
      <script>
        window.syncSlotToggleOffCount = 0;
        const slot1 = document.getElementById('class-comments-slot-carousel-1');
        slot1.addEventListener('click', () => {
          if (slot1.classList.contains('active')) {
            slot1.classList.remove('active');
            slot1.classList.add('inactive');
            window.syncSlotToggleOffCount++;
          }
        });
      </script>
    `);
    const scraped = await (ClassSyncer as any).scrapeSessions(
      page,
      testClassId,
      testClassId
    );
    assert.equal(scraped.sessions.length, 2);
    assert.equal(scraped.latestActiveSessionId, `${testClassId}_SESS_02`);
    assert.equal(
      await page.evaluate(() => (window as any).syncSlotToggleOffCount || 0),
      0,
      "T280-05d: scrapeSessions không được bấm vào slot mới nhất khi slot đó đã có class .active"
    );

    // 5e. Auth SSO URL parsing: ?callbackUrl=https://lms.mindx.edu.vn/admin/dashboard must NEVER be treated as authenticated on lms.mindx.edu.vn
    assert.equal(
      isLoginHostOrPath(
        "https://base.mindx.edu.vn/login?callbackUrl=https://lms.mindx.edu.vn/admin/dashboard",
        "lms.mindx.edu.vn"
      ),
      true,
      "T280-05e: URL SSO base.mindx.edu.vn/login?callbackUrl=.../admin/dashboard phải được nhận diện là màn hình đăng nhập"
    );
    assert.equal(
      isLoginHostOrPath(
        "https://id.mindx.edu.vn/auth?redirect_uri=https://lms.mindx.edu.vn/admin/classes",
        "lms.mindx.edu.vn"
      ),
      true,
      "T280-05e: URL SSO id.mindx.edu.vn/auth?redirect_uri=.../admin/classes phải được nhận diện là màn hình đăng nhập"
    );
    assert.equal(
      isLoginHostOrPath("https://lms.mindx.edu.vn/admin/classes", "lms.mindx.edu.vn"),
      false,
      "T280-05e: URL lms.mindx.edu.vn/admin/classes thật không phải màn hình đăng nhập"
    );
    assert.deepEqual(
      parseUrlParts(
        "https://base.mindx.edu.vn/login?callbackUrl=https://lms.mindx.edu.vn/admin/dashboard"
      ),
      { hostname: "base.mindx.edu.vn", pathname: "/login" }
    );

    // 5f. Finished class 15-day post-Buổi-14 window check
    const refNowMs = parseClassDateToEndOfDayMs("27/10/2026")!;
    assert.equal(
      isFinishedClassWithinGraceWindow(
        "TEST_FINISHED_RECENT",
        "24/10/2026",
        FINISHED_CLASS_GRACE_DAYS,
        refNowMs
      ).withinWindow,
      true,
      "T280-05f: Lớp Finished sau Buổi 14 khoảng 3 ngày (24/10 -> 27/10) phải được giữ lại để nộp/sửa SPCK"
    );
    assert.equal(
      isFinishedClassWithinGraceWindow(
        "TEST_FINISHED_BOUNDARY",
        "12/10/2026",
        FINISHED_CLASS_GRACE_DAYS,
        refNowMs
      ).withinWindow,
      true,
      "T280-05f: Lớp Finished đúng 15 ngày sau Buổi 14 (12/10 -> 27/10) vẫn nằm trong hạn 15 ngày"
    );
    assert.equal(
      isFinishedClassWithinGraceWindow(
        "TEST_FINISHED_EXPIRED",
        "11/10/2026",
        FINISHED_CLASS_GRACE_DAYS,
        refNowMs
      ).withinWindow,
      false,
      "T280-05f: Lớp Finished quá 15 ngày sau Buổi 14 (11/10 -> 27/10 = 16 ngày) phải tự động loại bỏ"
    );
    console.log("  -> PASS T280-05.");

    await context.close();
    console.log("\n🎉 TẤT CẢ 5 BÀI KIỂM THỬ ĐỘ TIN CẬY LMS (v2.8.0: T280-01 .. T280-05) ĐỀU PASS 100%!");
  } finally {
    bm.getPage = origGetPage;
    authService.ensureAuthenticated = origEnsureAuth;
    LmsHelpers.openClassDrawer = origOpenDrawer;
    LmsHelpers.switchDrawerTab = origSwitchTab;
    LmsHelpers.ensureCleanDialogAndToast = origEnsureClean;
    cleanupClassDb(testClassId);
    await browser.close();
  }
}

runReliabilityTestsV280().catch((err) => {
  console.error("❌ Kiểm thử v2.8.0 thất bại:", err);
  process.exit(1);
});
