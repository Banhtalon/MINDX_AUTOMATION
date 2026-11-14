/**
 * MINDX AUTOMATION BOT — v3.4.8 / v3.4.9 REGRESSION & E2E SUITE
 * Verifies the 3-layer fix for false `page.waitForResponse: Timeout ... exceeded` errors
 * during Session Comment submission (live reproduction: `VT-ROB-ARMI13` Session 3 `Nguyễn Chấn Lâm`)
 * and v3.4.9 fast sequential save + 1-shot batch `GetClassById` verification:
 *
 * - SCT-01: Active MUI CircularProgress spinner grace window recovers slow (> first timeout) Save mutation
 *           with 0 extra Save clicks and full DOM Read-after-Write -> VERIFIED.
 * - SCT-02: Post-Batch Server Reconciliation (Pass 2B) recovers a student whose Save mutation landed on LMS
 *           after waitForResponse timed out, requiring BOTH fresh HTTP 200 `GetClassById` server payload AND
 *           full View-Mode DOM Read-after-Write (0 extra Save clicks) -> 2/2 VERIFIED & Dashboard `allDone=true`.
 * - SCT-03: Optimistic local DOM cache WITHOUT server `GetClassById` persistence MUST remain FAILED.
 * - SCT-04: Stale/partial server comment in `GetClassById` that mismatches `approvedText` MUST remain FAILED.
 * - SCT-05: Concurrent teacher edit to `DRAFT` before Pass 2B MUST preserve `DRAFT` (CAS lock).
 * - SCT-06: Duplicate student names without explicit CRM `studentId` MUST NOT cross-reconcile in Pass 2B.
 * - SCT-07: `ClassSyncer.syncLmsSlotCompletionToSqlite` (`preferLmsVerified: false`, used by `🔄 Đồng bộ buổi học`)
 *           heals exact-matching `FAILED` timeout records to `VERIFIED` (`errorMessage = null`) while preserving
 *           mismatched `FAILED` rows and unsubmitted teacher `DRAFT` edits.
 * - SCT-08A: Fast sequential 10-student batch (`VT-C4K-PTI12`) -> 10 Save clicks, 10 modal opens (no per-student
 *            re-open), 1 In-Drawer Refresh `GetClassById`, 10/10 VERIFIED.
 * - SCT-08B: Batch verification mismatch fail-closed (`STU_MM_03` server comment altered) -> 2 VERIFIED, 1 FAILED.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LIVE_DB_PATH = path.resolve("data/mindx_bot.db");
const LIVE_RUNNING_CLASSES_PATH = path.resolve("data/running_classes.json");

function fileSha256IfExists(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const baselineDbSha = fileSha256IfExists(LIVE_DB_PATH);
const baselineRunningSha = fileSha256IfExists(LIVE_RUNNING_CLASSES_PATH);

const isolatedTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-v348-sct-"));
process.env.MINDX_DB_PATH = path.join(isolatedTempDir, "mindx_test_v348.db");
process.env.MINDX_RUNNING_CLASSES_PATH = path.join(isolatedTempDir, "running_classes_v348.json");

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

async function main() {
  console.log("=== BẮT ĐẦU KIỂM THỬ SỬA LỖI TIMEOUT LƯU NHẬN XÉT LMS (v3.4.8: SCT-01 .. SCT-07) ===");

  const { chromium } = await import("playwright");
  const {
    classSessionRepo,
    closeDb,
    getDb,
    sessionFeedbackRepo,
    studentRepo,
  } = await import("../src/lib/db/sqlite");
  const { saveRunningClasses } = await import("../src/lib/db/json-config");
  const { authService } = await import("../src/lib/playwright/auth");
  const { BrowserManager } = await import("../src/lib/playwright/browser-manager");
  const { LmsHelpers } = await import("../src/lib/playwright/lms-helpers");
  const { CommentSaver } = await import("../src/lib/playwright/save-comments");
  const { ClassSyncer } = await import("../src/lib/playwright/sync-class");
  const { getDashboardTodayTodoCards } = await import("../src/lib/dashboard/today-tasks");

  const browser = await chromium.launch({ headless: true });
  const bm = BrowserManager.getInstance();
  const origGetPage = bm.getPage.bind(bm);
  const origEnsureAuth = authService.ensureAuthenticated.bind(authService);
  const origOpenDrawer = LmsHelpers.openClassDrawer.bind(LmsHelpers);
  const origSwitchTab = LmsHelpers.switchDrawerTab.bind(LmsHelpers);

  const sampleChanLamComment = [
    "- **Điểm mạnh của học viên:** Con đã hoàn thành rất chỉn chu nhiệm vụ trong buổi học khi thực hiện tốt việc **lắp ráp mô hình có sử dụng cảm biến mắt và LED Bumper**. Các bộ phận kết cấu được con gắn kết rất vững chãi, đồng thời thái độ làm việc nhóm của con vô cùng tích cực, biết **hợp tác nhóm tốt** và hỗ trợ bạn chung đội.",
    "- **Điểm cần cải thiện:** Tuy độ hoàn thiện chung khá tốt, nhưng con đôi khi vẫn hơi nhanh ở những đoạn tinh chỉnh các góc lắp cảm biến, khiến mô hình đôi khi cần được nắn chỉnh lại cho cân đối.",
    "- **Lời khuyên:** Thầy khuyến khích con rèn thêm thói quen **kiểm tra độ cân bằng của cảm biến** trước khi chạy thử để robot hoạt động ổn định hơn, ba mẹ cùng động viên con phát huy nhé!",
  ].join("\n");

  const sampleQuocVietComment = [
    "- **Điểm mạnh của học viên:** Con nắm bắt nhanh nguyên lý hoạt động của **cảm biến mắt** và chủ động hoàn thiện phần kết nối dây gọn gàng trên robot.",
    "- **Điểm cần cải thiện:** Khi thử nghiệm tốc độ di chuyển, con cần quan sát kỹ hơn khoảng cách phản hồi của cảm biến.",
    "- **Lời khuyên:** Ở buổi tới con hãy thử ghi lại **mốc khoảng cách nhận diện tốt nhất** của robot để lập trình chính xác hơn nhé!",
  ].join("\n");

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Override long Playwright response timeouts so tests execute in < 5 seconds while preserving exact semantics:
    // - 16000ms primary Save wait -> 350ms
    // - 5000ms active spinner grace wait -> 900ms
    // - 15000ms fresh GetClassById wait -> 600ms
    const origWaitForResponse = page.waitForResponse.bind(page);
    (page as any).waitForResponse = (predicate: any, options?: any) => {
      const rawTimeout = options?.timeout;
      let mappedTimeout = rawTimeout;
      if (typeof rawTimeout === "number") {
        if (rawTimeout >= 16000) mappedTimeout = 350;
        else if (rawTimeout >= 14000) mappedTimeout = 600;
        else if (rawTimeout >= 4500 && rawTimeout <= 5500) mappedTimeout = 900;
      }
      return origWaitForResponse(
        predicate,
        mappedTimeout !== rawTimeout ? { ...options, timeout: mappedTimeout } : options
      );
    };

    type ServerScenarioMode =
      | "spinner-grace-recovers"
      | "late-commit-reconciled"
      | "optimistic-only-no-server"
      | "server-partial-mismatch"
      | "concurrent-draft-edit"
      | "duplicate-name-ambiguous"
      | "fast-batch-10"
      | "batch-server-mismatch";

    let currentMode: ServerScenarioMode = "spinner-grace-recovers";
    let activeClassCode = "VT-ROB-ARMI13";
    let serverSavedCommentsByStudent: Record<string, string> = {};
    let getClassByIdCallCount = 0;
    let updateSlotCommentCallCount = 0;

    await page.route("https://lms.mindx.edu.vn/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html><body></body></html>",
      });
    });

    await page.route("https://lms-api.mindx.edu.vn/**", async (route) => {
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

      const postData = route.request().postData() || "";
      let parsed: any = {};
      try {
        parsed = JSON.parse(postData);
      } catch {}

      const op = String(parsed?.operationName || "");

      if (op === "GetClassById") {
        getClassByIdCallCount++;
        const roster = studentRepo.findByClass(activeClassCode, false);
        const studentAttendance = roster.map((st) => {
          const savedHtml = serverSavedCommentsByStudent[st.studentId] || "";
          const omitCrmId = currentMode === "duplicate-name-ambiguous";
          return {
            status: "ATTENDED",
            student: {
              ...(omitCrmId ? {} : { id: st.studentId }),
              fullName: st.fullName,
            },
            comment: savedHtml,
            commentByAreas: savedHtml
              ? [{ type: "CONTENT", content: savedHtml }]
              : [],
          };
        });

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({
            data: {
              classesById: {
                id: "66f000000000000000000013",
                name: activeClassCode,
                slots: [
                  { index: 0, studentAttendance: [] },
                  { index: 1, studentAttendance: [] },
                  { index: 2, studentAttendance },
                ],
              },
            },
          }),
        });
        return;
      }

      if (op === "UpdateSlotComment") {
        updateSlotCommentCallCount++;
        const stuId = String(parsed?.variables?.studentId || "");
        const html = String(parsed?.variables?.comment || "");

        if (currentMode === "spinner-grace-recovers") {
          // Exceeds 350ms primary timeout, completes at 550ms inside 900ms spinner grace window!
          await new Promise((r) => setTimeout(r, 550));
          serverSavedCommentsByStudent[stuId] = html;
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ data: { updateSlotComment: { ok: true } } }),
          });
          return;
        }

        if (
          currentMode === "late-commit-reconciled" ||
          currentMode === "concurrent-draft-edit" ||
          currentMode === "duplicate-name-ambiguous"
        ) {
          if (stuId.includes("CHAN_LAM") || stuId.includes("DUP_A")) {
            // Exceeds primary wait (no spinner shown or exceeds both waits), commits on server 500ms later!
            setTimeout(() => {
              serverSavedCommentsByStudent[stuId] = html;
            }, 480);
            // Never fulfill before waitForResponse times out at 350ms; fulfill at 1500ms after Pass 1 moved on
            await new Promise((r) => setTimeout(r, 950));
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              headers: { "Access-Control-Allow-Origin": "*" },
              body: JSON.stringify({ data: { updateSlotComment: { ok: true } } }),
            });
            return;
          }
          // Other students succeed immediately
          serverSavedCommentsByStudent[stuId] = html;
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ data: { updateSlotComment: { ok: true } } }),
          });
          return;
        }

        if (currentMode === "fast-batch-10") {
          serverSavedCommentsByStudent[stuId] = html;
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ data: { updateSlotComment: { ok: true } } }),
          });
          return;
        }

        if (currentMode === "batch-server-mismatch") {
          if (stuId.includes("MISMATCH") || stuId.endsWith("_03")) {
            serverSavedCommentsByStudent[stuId] = "<p>NOI DUNG BI CAT BOT TREN SERVER</p>";
          } else {
            serverSavedCommentsByStudent[stuId] = html;
          }
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ data: { updateSlotComment: { ok: true } } }),
          });
          return;
        }

        if (currentMode === "optimistic-only-no-server") {
          await route.abort("timedout");
          return;
        }

        if (currentMode === "server-partial-mismatch") {
          if (stuId.includes("CHAN_LAM")) {
            setTimeout(() => {
              serverSavedCommentsByStudent[stuId] = "<p>Nhận xét cũ bị cắt ngắn không khớp</p>";
            }, 480);
            await new Promise((r) => setTimeout(r, 950));
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              headers: { "Access-Control-Allow-Origin": "*" },
              body: JSON.stringify({ data: { updateSlotComment: { ok: true } } }),
            });
            return;
          }
          serverSavedCommentsByStudent[stuId] = html;
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ data: { updateSlotComment: { ok: true } } }),
          });
          return;
        }
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ data: { ok: true } }),
      });
    });

    const mountLmsCommentsDom = async (opts: {
      classCode: string;
      students: Array<{ studentId: string; fullName: string; omitRowAttr?: boolean }>;
      keepSpinnerDuringSaveFor?: string;
      optimisticDomWithoutServer?: boolean;
      triggerDraftEditAfterTimeoutFor?: string;
      sessionIdForDraftEdit?: string;
      enableDrawerRefreshBtn?: boolean;
    }) => {
      await page.goto("https://lms.mindx.edu.vn/admin/classes");
      const rowsHtml = opts.students
        .map(
          (st) => `
            <tr ${st.omitRowAttr ? "" : `data-student-id="${st.studentId}"`}>
              <td>${st.fullName}</td>
              <td><button type="button" class="open-comment-btn" data-stu="${st.studentId}">Nhận xét học sinh</button></td>
            </tr>`
        )
        .join("\n");

      await page.setContent(`
        <html>
          <body>
            <div class="MuiBackdrop-root" id="drawer-backdrop"></div>
            <div aria-labelledby="class-detail" class="MuiDrawer-paperAnchorRight" id="class-drawer">
              <h2>${opts.classCode}</h2>
              <div id="class-comments-slot-carousel-0" class="slot-item inactive"><div class="info-container">#1</div></div>
              <div id="class-comments-slot-carousel-1" class="slot-item inactive"><div class="info-container">#2</div></div>
              <div id="class-comments-slot-carousel-2" class="slot-item active"><div class="info-container">#3 14/11</div></div>
              <div class="comment-list-table">
                <table>
                  <thead><tr><th>student</th><th>Comment</th></tr></thead>
                  <tbody>${rowsHtml}</tbody>
                </table>
              </div>
            </div>
            <div id="modal-root"></div>
          </body>
        </html>
      `);

      if (opts.triggerDraftEditAfterTimeoutFor && opts.sessionIdForDraftEdit) {
        const hookName = `__editDraft_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        await page.exposeFunction(hookName, () => {
          getDb()
            .prepare(
              `UPDATE session_feedbacks
               SET status = 'DRAFT', finalText = 'Giáo viên vừa sửa lại bản nháp mới', contentHash = ''
               WHERE classId = ? AND sessionId = ? AND studentId = ?`
            )
            .run(
              opts.classCode,
              opts.sessionIdForDraftEdit!,
              opts.triggerDraftEditAfterTimeoutFor!
            );
        });
        await page.evaluate((fn) => {
          (window as any).__triggerDraftHook = () => (window as any)[fn]();
        }, hookName);
      }

      await page.evaluate(
        (cfg) => {
          (window as any).saveClicksByStu = {};
          (window as any).modalOpensByStu = {};
          (window as any).domCommentsByStu = {};

          const drawerEl = document.getElementById("class-drawer");
          if (drawerEl && cfg.enableDrawerRefreshBtn && !document.getElementById("drawer-refresh-btn")) {
            const refreshBtn = document.createElement("button");
            refreshBtn.type = "button";
            refreshBtn.id = "drawer-refresh-btn";
            refreshBtn.setAttribute("aria-label", "refresh");
            refreshBtn.innerHTML = '<svg data-testid="RefreshIcon"></svg>';
            refreshBtn.onclick = async () => {
              const resp = await fetch("https://lms-api.mindx.edu.vn/graphql", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  operationName: "GetClassById",
                  variables: { id: "66f000000000000000000013" },
                }),
              });
              const payload = await resp.json().catch(() => null);
              const atts = payload?.data?.classesById?.slots?.[2]?.studentAttendance || [];
              for (const att of atts) {
                const stuId = att?.student?.id;
                if (stuId && att?.comment) {
                  (window as any).domCommentsByStu[stuId] = att.comment;
                }
              }
            };
            drawerEl.prepend(refreshBtn);
          }

          [0, 1, 2].forEach((idx) => {
            const el = document.getElementById("class-comments-slot-carousel-" + idx);
            const info = el ? (el.querySelector(".info-container") as HTMLElement | null) : null;
            if (el && info) {
              info.onclick = () => {
                if (el.classList.contains("active")) {
                  el.classList.remove("active");
                  el.classList.add("inactive");
                } else {
                  [0, 1, 2].forEach((j) => {
                    const other = document.getElementById("class-comments-slot-carousel-" + j);
                    if (other) {
                      other.classList.remove("active");
                      other.classList.add("inactive");
                    }
                  });
                  el.classList.remove("inactive");
                  el.classList.add("active");
                }
              };
            }
          });

          document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
              const modalRoot = document.getElementById("modal-root")!;
              if (modalRoot.innerHTML.trim() !== "") {
                modalRoot.innerHTML = "";
              } else {
                const dr = document.getElementById("class-drawer");
                if (dr) dr.style.display = "none";
              }
            }
          });

          const backdrop = document.getElementById("drawer-backdrop");
          if (backdrop) {
            backdrop.onclick = () => {
              const dr = document.getElementById("class-drawer");
              if (dr) dr.style.display = "none";
            };
          }

          document.querySelectorAll(".open-comment-btn").forEach((btnEl) => {
            (btnEl as HTMLButtonElement).onclick = () => {
              const stuId = btnEl.getAttribute("data-stu") || "";
              (window as any).modalOpensByStu[stuId] =
                ((window as any).modalOpensByStu[stuId] || 0) + 1;
              const modalRoot = document.getElementById("modal-root")!;
              const existingHtml = (window as any).domCommentsByStu[stuId];
              if (existingHtml) {
                modalRoot.innerHTML =
                  '<div role="dialog" class="MuiDialog-paper">' +
                  "<table><tbody><tr><td>- Đánh giá chung: " +
                  existingHtml +
                  "</td></tr></tbody></table></div>";
                return;
              }

              modalRoot.innerHTML =
                '<div role="dialog" class="MuiDialog-paper">' +
                '<div class="ql-editor" contenteditable="true" id="ed-box"></div>' +
                '<div id="save-action-slot"><button type="button" id="save-comment-btn">Save</button></div>' +
                "</div>";

              const saveBtn = document.getElementById("save-comment-btn")!;
              saveBtn.onclick = () => {
                (window as any).saveClicksByStu[stuId] =
                  ((window as any).saveClicksByStu[stuId] || 0) + 1;
                const html = document.getElementById("ed-box")?.innerHTML || "";

                if (cfg.optimisticDomWithoutServer) {
                  (window as any).domCommentsByStu[stuId] = html;
                }

                if (cfg.keepSpinnerDuringSaveFor === stuId) {
                  document.getElementById("save-action-slot")!.innerHTML =
                    '<span role="progressbar" class="MuiCircularProgress-root">Loading...</span>';
                } else {
                  modalRoot.innerHTML = "";
                }

                fetch("https://lms-api.mindx.edu.vn/graphql", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    operationName: "UpdateSlotComment",
                    variables: {
                      classId: cfg.classCode,
                      studentId: stuId,
                      slotNumber: 3,
                      comment: html,
                    },
                  }),
                })
                  .then((r) => r.json())
                  .then(() => {
                    if (!cfg.optimisticDomWithoutServer) {
                      (window as any).domCommentsByStu[stuId] = html;
                    }
                    const currentModal = document.getElementById("modal-root");
                    if (currentModal && cfg.keepSpinnerDuringSaveFor === stuId) {
                      currentModal.innerHTML = "";
                    }
                  })
                  .catch(() => {});

                if (
                  cfg.triggerDraftEditAfterTimeoutFor &&
                  stuId !== cfg.triggerDraftEditAfterTimeoutFor
                ) {
                  if (typeof (window as any).__triggerDraftHook === "function") {
                    (window as any).__triggerDraftHook();
                  }
                }
              };
            };
          });
        },
        opts
      );
    };

    bm.getPage = async () => page;
    authService.ensureAuthenticated = async () => {};
    LmsHelpers.switchDrawerTab = async () => {};
    LmsHelpers.openClassDrawer = async (_p: any, code: string) => {
      // Simulate real MindX LMS Drawer reopen: show drawer and fire fresh GetClassById -> sync server comments into DOM!
      await page.evaluate(async (clsCode) => {
        const dr = document.getElementById("class-drawer");
        const alreadyVisible = dr && dr.style.display !== "none";
        if (dr) dr.style.display = "block";
        if (!alreadyVisible) {
          const resp = await fetch("https://lms-api.mindx.edu.vn/graphql", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              operationName: "GetClassById",
              variables: { id: "66f000000000000000000013", classCode: clsCode },
            }),
          });
          const json = await resp.json();
          const attList = json?.data?.classesById?.slots?.[2]?.studentAttendance || [];
          for (const att of attList) {
            const sid = att?.student?.id;
            if (sid && typeof att.comment === "string" && att.comment) {
              (window as any).domCommentsByStu[sid] = att.comment;
            }
          }
        }
      }, code);
    };

    const seedClassSession = (cls: string, students: Array<{ id: string; name: string; text: string }>) => {
      const db = getDb();
      db.prepare(`DELETE FROM session_feedbacks WHERE classId = ?`).run(cls);
      db.prepare(`DELETE FROM classes_sessions WHERE classId = ?`).run(cls);
      db.prepare(`DELETE FROM students WHERE classId = ?`).run(cls);

      const sessId = `${cls}_SESS_03`;
      classSessionRepo.upsert({
        classId: cls,
        className: cls,
        sessionId: sessId,
        sessionNumber: 3,
        date: "14/11/2026",
        topic: "Buổi 3: Cảm biến mắt & LED Bumper",
      });

      for (const s of students) {
        studentRepo.upsert({
          studentId: s.id,
          classId: cls,
          fullName: s.name,
          isActive: 1,
        });
        sessionFeedbackRepo.upsert({
          classId: cls,
          sessionId: sessId,
          studentId: s.id,
          attendanceStatus: "PRESENT",
          finalText: s.text,
          contentHash: sha256(s.text),
          status: "APPROVED",
        });
      }
      return sessId;
    };

    // =========================================================================
    // SCT-01: Active MUI CircularProgress Spinner Grace Window Recovery
    // =========================================================================
    console.log("\n[SCT-01] Kiểm thử tự động gia hạn chờ khi biểu tượng xoay Save trên LMS vẫn đang chạy (0 click lặp)...");
    activeClassCode = "VT-ROB-ARMI13";
    currentMode = "spinner-grace-recovers";
    serverSavedCommentsByStudent = {};
    updateSlotCommentCallCount = 0;

    const sct01Stu = "STU_VT-ROB-ARMI13_NGUYEN_CHAN_LAM";
    const sct01Sess = seedClassSession(activeClassCode, [
      { id: sct01Stu, name: "Nguyễn Chấn Lâm", text: sampleChanLamComment },
    ]);

    await mountLmsCommentsDom({
      classCode: activeClassCode,
      students: [{ studentId: sct01Stu, fullName: "Nguyễn Chấn Lâm" }],
      keepSpinnerDuringSaveFor: sct01Stu,
    });

    const res01 = await CommentSaver.saveComments({
      classId: activeClassCode,
      classCode: activeClassCode,
      sessionId: sct01Sess,
    });

    const clicks01 = await page.evaluate(() => (window as any).saveClicksByStu);
    const db01 = sessionFeedbackRepo.findOne(activeClassCode, sct01Sess, sct01Stu);
    assert.equal(clicks01[sct01Stu], 1, "SCT-01: Tuyệt đối chỉ bấm nút Save đúng 1 lần");
    assert.equal(updateSlotCommentCallCount, 1);
    assert.equal(res01.verifiedCount, 1);
    assert.equal(res01.failedCount, 0);
    assert.equal(db01?.status, "VERIFIED");
    assert.equal(db01?.errorMessage ?? null, null);
    console.log("  -> PASS SCT-01.");

    // =========================================================================
    // SCT-02: Post-Batch Server GetClassById + DOM Read-after-Write Reconciliation
    // =========================================================================
    console.log("\n[SCT-02] Kiểm thử Pass 2B đối chiếu GetClassById + DOM Read-after-Write khi LMS lưu trễ sau timeout...");
    activeClassCode = "VT-ROB-ARMI13";
    currentMode = "late-commit-reconciled";
    serverSavedCommentsByStudent = {};
    getClassByIdCallCount = 0;

    const stuViet = "STU_VT-ROB-ARMI13_DOAN_QUOC_VIET";
    const sct02Sess = seedClassSession(activeClassCode, [
      { id: sct01Stu, name: "Nguyễn Chấn Lâm", text: sampleChanLamComment },
      { id: stuViet, name: "Đoàn Quốc Việt", text: sampleQuocVietComment },
    ]);
    saveRunningClasses([
      {
        classCode: activeClassCode,
        courseName: "Robotics ARMI",
        status: "Running",
      },
    ]);

    await mountLmsCommentsDom({
      classCode: activeClassCode,
      students: [
        { studentId: sct01Stu, fullName: "Nguyễn Chấn Lâm" },
        { studentId: stuViet, fullName: "Đoàn Quốc Việt" },
      ],
    });

    const res02 = await CommentSaver.saveComments({
      classId: activeClassCode,
      classCode: activeClassCode,
      sessionId: sct02Sess,
    });

    const clicks02 = await page.evaluate(() => (window as any).saveClicksByStu);
    const db02Lam = sessionFeedbackRepo.findOne(activeClassCode, sct02Sess, sct01Stu);
    const db02Viet = sessionFeedbackRepo.findOne(activeClassCode, sct02Sess, stuViet);
    assert.equal(clicks02[sct01Stu], 1, "SCT-02: Nguyễn Chấn Lâm chỉ bấm Save đúng 1 lần (Pass 2B không bấm Save lại)");
    assert.equal(clicks02[stuViet], 1);
    assert.ok(getClassByIdCallCount >= 1, "SCT-02: Pass 2B phải gọi GetClassById tươi từ máy chủ LMS");
    assert.equal(res02.verifiedCount, 2, "SCT-02: Cả 2/2 học viên đều phải đạt VERIFIED ngay trong cùng lượt");
    assert.equal(res02.failedCount, 0);
    assert.equal(db02Lam?.status, "VERIFIED");
    assert.equal(db02Lam?.errorMessage ?? null, null);
    assert.equal(db02Viet?.status, "VERIFIED");

    const todoCards02 = getDashboardTodayTodoCards({ limit: 10 });
    const armiCard02 = todoCards02.find((c) => c.classId === activeClassCode);
    assert.ok(armiCard02, "SCT-02: Phải tìm thấy thẻ Dashboard của VT-ROB-ARMI13");
    assert.equal(armiCard02!.allDone, true, "SCT-02: Trang chủ Dashboard phải chuyển VT-ROB-ARMI13 sang Đã xong (allDone=true)");
    console.log("  -> PASS SCT-02.");

    // =========================================================================
    // SCT-03: Optimistic Local DOM Cache WITHOUT Server GetClassById Persistence -> MUST Stay FAILED
    // =========================================================================
    console.log("\n[SCT-03] Kiểm thử chặn cache cục bộ trên DOM khi GetClassById máy chủ không có nhận xét...");
    activeClassCode = "TEST_SCT03_OPT";
    currentMode = "optimistic-only-no-server";
    serverSavedCommentsByStudent = {};

    const sct03Stu = "STU_SCT03_CHAN_LAM";
    const sct03Sess = seedClassSession(activeClassCode, [
      { id: sct03Stu, name: "Nguyễn Chấn Lâm", text: sampleChanLamComment },
    ]);

    await mountLmsCommentsDom({
      classCode: activeClassCode,
      students: [{ studentId: sct03Stu, fullName: "Nguyễn Chấn Lâm" }],
      optimisticDomWithoutServer: true,
    });

    const res03 = await CommentSaver.saveComments({
      classId: activeClassCode,
      classCode: activeClassCode,
      sessionId: sct03Sess,
    });

    const clicks03 = await page.evaluate(() => (window as any).saveClicksByStu);
    const db03 = sessionFeedbackRepo.findOne(activeClassCode, sct03Sess, sct03Stu);
    assert.equal(clicks03[sct03Stu], 1);
    assert.equal(res03.verifiedCount, 0, "SCT-03: Tuyệt đối không đánh dấu VERIFIED khi máy chủ GetClassById chưa lưu");
    assert.equal(res03.failedCount, 1);
    assert.equal(db03?.status, "FAILED");
    console.log("  -> PASS SCT-03.");

    // =========================================================================
    // SCT-04: Server GetClassById Has Partial/Stale Mismatched Comment -> MUST Stay FAILED
    // =========================================================================
    console.log("\n[SCT-04] Kiểm thử chặn đối chiếu khi nội dung trên GetClassById bị lệch với bản đã duyệt...");
    activeClassCode = "TEST_SCT04_MISMATCH";
    currentMode = "server-partial-mismatch";
    serverSavedCommentsByStudent = {};

    const sct04Stu = "STU_SCT04_CHAN_LAM";
    const sct04Sess = seedClassSession(activeClassCode, [
      { id: sct04Stu, name: "Nguyễn Chấn Lâm", text: sampleChanLamComment },
      { id: "STU_SCT04_VIET", name: "Đoàn Quốc Việt", text: sampleQuocVietComment },
    ]);

    await mountLmsCommentsDom({
      classCode: activeClassCode,
      students: [
        { studentId: sct04Stu, fullName: "Nguyễn Chấn Lâm" },
        { studentId: "STU_SCT04_VIET", fullName: "Đoàn Quốc Việt" },
      ],
    });

    const res04 = await CommentSaver.saveComments({
      classId: activeClassCode,
      classCode: activeClassCode,
      sessionId: sct04Sess,
    });

    const db04 = sessionFeedbackRepo.findOne(activeClassCode, sct04Sess, sct04Stu);
    assert.equal(res04.verifiedCount, 1);
    assert.equal(res04.failedCount, 1);
    assert.equal(db04?.status, "FAILED", "SCT-04: Nội dung máy chủ không khớp 100% phải giữ nguyên FAILED");
    console.log("  -> PASS SCT-04.");

    // =========================================================================
    // SCT-05: Concurrent Teacher Edit to DRAFT Before Pass 2B -> MUST Preserve DRAFT
    // =========================================================================
    console.log("\n[SCT-05] Kiểm thử bảo toàn DRAFT nếu giáo viên sửa nhận xét trước khi Pass 2B đối chiếu...");
    activeClassCode = "TEST_SCT05_CAS";
    currentMode = "concurrent-draft-edit";
    serverSavedCommentsByStudent = {};

    const sct05Stu = "STU_SCT05_CHAN_LAM";
    const sct05Sess = seedClassSession(activeClassCode, [
      { id: sct05Stu, name: "Nguyễn Chấn Lâm", text: sampleChanLamComment },
      { id: "STU_SCT05_VIET", name: "Đoàn Quốc Việt", text: sampleQuocVietComment },
    ]);

    await mountLmsCommentsDom({
      classCode: activeClassCode,
      students: [
        { studentId: sct05Stu, fullName: "Nguyễn Chấn Lâm" },
        { studentId: "STU_SCT05_VIET", fullName: "Đoàn Quốc Việt" },
      ],
      triggerDraftEditAfterTimeoutFor: sct05Stu,
      sessionIdForDraftEdit: sct05Sess,
    });

    const res05 = await CommentSaver.saveComments({
      classId: activeClassCode,
      classCode: activeClassCode,
      sessionId: sct05Sess,
    });

    const db05 = sessionFeedbackRepo.findOne(activeClassCode, sct05Sess, sct05Stu);
    assert.equal(res05.verifiedCount, 1);
    assert.equal(res05.failedCount, 1);
    assert.equal(db05?.status, "DRAFT", "SCT-05: Không được ghi đè bản nháp DRAFT mới của giáo viên thành VERIFIED");
    assert.equal(db05?.finalText, "Giáo viên vừa sửa lại bản nháp mới");
    console.log("  -> PASS SCT-05.");

    // =========================================================================
    // SCT-06: Duplicate Student Names Without CRM ID -> MUST Refuse Ambiguous Reconciliation
    // =========================================================================
    console.log("\n[SCT-06] Kiểm thử chặn đối chiếu nhầm khi lớp có 2 học viên trùng tên thiếu CRM ID...");
    activeClassCode = "TEST_SCT06_DUP";
    currentMode = "duplicate-name-ambiguous";
    serverSavedCommentsByStudent = {};

    const dupA = "STU_SCT06_DUP_A";
    const dupB = "STU_SCT06_DUP_B";
    const sct06Sess = seedClassSession(activeClassCode, [
      { id: dupA, name: "Nguyễn Bảo An", text: sampleChanLamComment },
      { id: dupB, name: "Nguyễn Bảo An", text: sampleQuocVietComment },
    ]);

    await mountLmsCommentsDom({
      classCode: activeClassCode,
      students: [
        { studentId: dupA, fullName: "Nguyễn Bảo An" },
        { studentId: dupB, fullName: "Nguyễn Bảo An" },
      ],
    });

    const res06 = await CommentSaver.saveComments({
      classId: activeClassCode,
      classCode: activeClassCode,
      sessionId: sct06Sess,
    });

    const db06A = sessionFeedbackRepo.findOne(activeClassCode, sct06Sess, dupA);
    assert.equal(db06A?.status, "FAILED", "SCT-06: Học viên trùng tên thiếu CRM ID không được tự gán VERIFIED");
    assert.equal(res06.verifiedCount, 1);
    assert.equal(res06.failedCount, 1);
    console.log("  -> PASS SCT-06.");

    // =========================================================================
    // SCT-07: ClassSyncer.syncLmsSlotCompletionToSqlite (`preferLmsVerified: false`)
    // =========================================================================
    console.log("\n[SCT-07] Kiểm thử tự động xóa lỗi FAILED giả khi bấm '🔄 Đồng bộ buổi học' mà vẫn giữ nguyên DRAFT đang sửa...");
    const syncCls = "TEST_SCT07_SYNC";
    const syncSess = `${syncCls}_SESS_03`;
    const db = getDb();
    db.prepare(`DELETE FROM session_feedbacks WHERE classId = ?`).run(syncCls);
    db.prepare(`DELETE FROM students WHERE classId = ?`).run(syncCls);

    const stuExactFailed = {
      studentId: "STU_SYNC_EXACT_FAILED",
      classId: syncCls,
      fullName: "Nguyễn Chấn Lâm",
      isActive: 1,
    };
    const stuMismatchFailed = {
      studentId: "STU_SYNC_MISMATCH_FAILED",
      classId: syncCls,
      fullName: "Lê Xuân Phúc",
      isActive: 1,
    };
    const stuEditedDraft = {
      studentId: "STU_SYNC_EDITED_DRAFT",
      classId: syncCls,
      fullName: "Trần Phúc An",
      isActive: 1,
    };

    for (const st of [stuExactFailed, stuMismatchFailed, stuEditedDraft]) {
      studentRepo.upsert(st);
    }

    // Student A: FAILED due to waitForResponse timeout, but exact same comment (with **bold**) is already saved on LMS!
    sessionFeedbackRepo.upsert({
      classId: syncCls,
      sessionId: syncSess,
      studentId: stuExactFailed.studentId,
      attendanceStatus: "PRESENT",
      finalText: sampleChanLamComment,
      contentHash: sha256(sampleChanLamComment),
      status: "FAILED",
      errorMessage: 'page.waitForResponse: Timeout 15000ms exceeded while waiting for event "response"',
    });

    // Student B: FAILED with a new comment, while LMS still holds an older different comment
    sessionFeedbackRepo.upsert({
      classId: syncCls,
      sessionId: syncSess,
      studentId: stuMismatchFailed.studentId,
      attendanceStatus: "PRESENT",
      finalText: sampleQuocVietComment,
      contentHash: sha256(sampleQuocVietComment),
      status: "FAILED",
      errorMessage: "HTTP 500 Internal Server Error",
    });

    // Student C: DRAFT actively edited by teacher, different from LMS
    const teacherNewDraft = "- **Điểm mạnh của học viên:** Bản nháp mới giáo viên đang gõ dở.";
    sessionFeedbackRepo.upsert({
      classId: syncCls,
      sessionId: syncSess,
      studentId: stuEditedDraft.studentId,
      attendanceStatus: "PRESENT",
      finalText: teacherNewDraft,
      contentHash: "",
      status: "DRAFT",
    });

    const chanLamHtmlOnLms = sampleChanLamComment
      .split("\n")
      .map((line) => `<p>${line.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")}</p>`)
      .join("");

    ClassSyncer.syncLmsSlotCompletionToSqlite({
      db,
      classId: syncCls,
      students: [stuExactFailed, stuMismatchFailed, stuEditedDraft],
      preferLmsVerified: false,
      slots: [
        { index: 0, studentAttendance: [] },
        { index: 1, studentAttendance: [] },
        {
          index: 2,
          studentAttendance: [
            {
              status: "ATTENDED",
              student: { id: stuExactFailed.studentId, fullName: stuExactFailed.fullName },
              commentByAreas: [{ type: "CONTENT", content: chanLamHtmlOnLms }],
            },
            {
              status: "ATTENDED",
              student: { id: stuMismatchFailed.studentId, fullName: stuMismatchFailed.fullName },
              commentByAreas: [{ type: "CONTENT", content: "<p>Nhận xét cũ khác hoàn toàn</p>" }],
            },
            {
              status: "ATTENDED",
              student: { id: stuEditedDraft.studentId, fullName: stuEditedDraft.fullName },
              commentByAreas: [{ type: "CONTENT", content: "<p>Nhận xét cũ trên LMS</p>" }],
            },
          ],
        },
      ],
    });

    const afterA = sessionFeedbackRepo.findOne(syncCls, syncSess, stuExactFailed.studentId);
    const afterB = sessionFeedbackRepo.findOne(syncCls, syncSess, stuMismatchFailed.studentId);
    const afterC = sessionFeedbackRepo.findOne(syncCls, syncSess, stuEditedDraft.studentId);

    assert.equal(afterA?.status, "VERIFIED", "SCT-07A: FAILED khớp 100% với LMS phải tự chuyển sang VERIFIED");
    assert.equal(afterA?.errorMessage ?? null, null, "SCT-07A: Phải xóa sạch thông báo lỗi cũ trên UI");
    assert.equal(afterA?.finalText, sampleChanLamComment, "SCT-07A: Giữ nguyên định dạng **in đậm** gốc của giáo viên");

    assert.equal(afterB?.status, "FAILED", "SCT-07B: FAILED khác nội dung với LMS không được tự chuyển sang VERIFIED");
    assert.equal(afterB?.errorMessage, "HTTP 500 Internal Server Error");

    assert.equal(afterC?.status, "DRAFT", "SCT-07C: DRAFT đang sửa tay phải được giữ nguyên khi preferLmsVerified=false");
    assert.equal(afterC?.finalText, teacherNewDraft);
    console.log("  -> PASS SCT-07.");

    // =========================================================================
    // SCT-08A: Fast Sequential + 1-Shot Batch Verify (10 học viên = 10 lần mở modal + 1 GetClassById)
    // =========================================================================
    console.log("\n[SCT-08A] Kiểm thử lưu nối tiếp 10 học viên & đối chiếu gộp 1 lần cuối lớp (10 lần mở modal, 1 GetClassById)...");
    currentMode = "fast-batch-10";
    activeClassCode = "VT-C4K-PTI12";
    serverSavedCommentsByStudent = {};
    getClassByIdCallCount = 0;
    updateSlotCommentCallCount = 0;

    const batch10Students = Array.from({ length: 10 }, (_, idx) => {
      const num = String(idx + 1).padStart(2, "0");
      return {
        id: `STU_VT-C4K-PTI12_${num}`,
        name: `Học Viên Kiểm Thử ${num}`,
        text: `- **Điểm mạnh của học viên:** Trong buổi học hôm nay, con Học Viên ${num} hoàn thành tốt bài thực hành số ${num} và nắm chắc cấu trúc lặp.\n- **Điểm cần cải thiện:** Con cần kiểm tra kỹ hơn điều kiện dừng khi viết hàm để tránh sai sót nhỏ.\n- **Lời khuyên:** Thầy khuyến khích con tiếp tục duy trì tinh thần học tập tích cực và hoàn thành đầy đủ bài tập về nhà buổi ${num} nhé.`,
      };
    });

    const sct08ASess = seedClassSession(activeClassCode, batch10Students);
    await mountLmsCommentsDom({
      classCode: activeClassCode,
      students: batch10Students.map((s) => ({ studentId: s.id, fullName: s.name })),
      enableDrawerRefreshBtn: true,
    });

    const res08A = await CommentSaver.saveComments({
      classId: activeClassCode,
      classCode: activeClassCode,
      sessionId: sct08ASess,
    });

    const clicks08A = await page.evaluate(() => (window as any).saveClicksByStu);
    const modalOpens08A = await page.evaluate(() => (window as any).modalOpensByStu);
    assert.equal(res08A.verifiedCount, 10, "SCT-08A: Cả 10/10 học viên phải đạt VERIFIED");
    assert.equal(res08A.failedCount, 0, "SCT-08A: Không có học viên thất bại");
    assert.equal(updateSlotCommentCallCount, 10, "SCT-08A: Phải gọi API Save đúng 10 lần");
    assert.equal(getClassByIdCallCount, 1, "SCT-08A: Chỉ gọi GetClassById đối chiếu gộp đúng 1 lần cuối lớp");
    for (const st of batch10Students) {
      assert.equal(clicks08A[st.id], 1, `SCT-08A: ${st.id} chỉ bấm Save 1 lần`);
      assert.equal(modalOpens08A[st.id], 1, `SCT-08A: ${st.id} chỉ mở modal đúng 1 lần (không mở lại lần 2)`);
      const rowDb = sessionFeedbackRepo.findOne(activeClassCode, sct08ASess, st.id);
      assert.equal(rowDb?.status, "VERIFIED", `SCT-08A: ${st.id} trong SQLite phải là VERIFIED`);
      assert.equal(rowDb?.errorMessage ?? null, null);
    }
    console.log("  -> PASS SCT-08A.");

    // =========================================================================
    // SCT-08B: Batch Verification Mismatch Fail-Closed (2 VERIFIED, 1 FAILED khi server lưu sai)
    // =========================================================================
    console.log("\n[SCT-08B] Kiểm thử Fail-Closed khi đối chiếu gộp 1 lần phát hiện 1 học viên lệch nội dung trên LMS...");
    currentMode = "batch-server-mismatch";
    activeClassCode = "VT-C4K-PTI12_MM";
    serverSavedCommentsByStudent = {};
    getClassByIdCallCount = 0;
    updateSlotCommentCallCount = 0;

    const batchMismatchStudents = [
      {
        id: "STU_MM_01",
        name: "Nguyễn Minh Anh",
        text: "- **Điểm mạnh của học viên:** Con nắm bài rất nhanh và chủ động xây dựng hàm xử lý.\n- **Điểm cần cải thiện:** Chú ý đặt tên biến rõ ràng hơn.\n- **Lời khuyên:** Tiếp tục phát huy ba mẹ nhé.",
      },
      {
        id: "STU_MM_02",
        name: "Trần Gia Bảo",
        text: "- **Điểm mạnh của học viên:** Con hoàn thành đủ bài thực hành và tích cực giơ tay phát biểu.\n- **Điểm cần cải thiện:** Cần rèn thêm tốc độ gõ phím khi code.\n- **Lời khuyên:** Thầy tin con sẽ tiến bộ nhanh ở buổi sau.",
      },
      {
        id: "STU_MM_03",
        name: "Lê Hoàng Nam",
        text: "- **Điểm mạnh của học viên:** Con hiểu được ý tưởng thuật toán cơ bản của buổi học.\n- **Điểm cần cải thiện:** Con cần hoàn thiện nốt phần xử lý điều kiện biên.\n- **Lời khuyên:** Con cố gắng làm thêm bài tập thực hành ở nhà nhé.",
      },
    ];

    const sct08BSess = seedClassSession(activeClassCode, batchMismatchStudents);
    await mountLmsCommentsDom({
      classCode: activeClassCode,
      students: batchMismatchStudents.map((s) => ({ studentId: s.id, fullName: s.name })),
      enableDrawerRefreshBtn: true,
    });

    const res08B = await CommentSaver.saveComments({
      classId: activeClassCode,
      classCode: activeClassCode,
      sessionId: sct08BSess,
    });

    assert.equal(getClassByIdCallCount, 1, "SCT-08B: Gọi GetClassById đối chiếu gộp đúng 1 lần");
    assert.equal(res08B.verifiedCount, 2, "SCT-08B: 2 học viên khớp phải đạt VERIFIED");
    assert.equal(res08B.failedCount, 1, "SCT-08B: 1 học viên lệch nội dung trên server phải fail-closed");
    assert.equal(
      sessionFeedbackRepo.findOne(activeClassCode, sct08BSess, "STU_MM_01")?.status,
      "VERIFIED"
    );
    assert.equal(
      sessionFeedbackRepo.findOne(activeClassCode, sct08BSess, "STU_MM_02")?.status,
      "VERIFIED"
    );
    assert.equal(
      sessionFeedbackRepo.findOne(activeClassCode, sct08BSess, "STU_MM_03")?.status,
      "FAILED",
      "SCT-08B: Học viên lệch nội dung trên LMS bắt buộc giữ trạng thái FAILED"
    );
    console.log("  -> PASS SCT-08B.");

    await context.close();
  } finally {
    bm.getPage = origGetPage;
    authService.ensureAuthenticated = origEnsureAuth;
    LmsHelpers.openClassDrawer = origOpenDrawer;
    LmsHelpers.switchDrawerTab = origSwitchTab;
    await browser.close().catch(() => {});
    closeDb();
    try {
      fs.rmSync(isolatedTempDir, { recursive: true, force: true });
    } catch {}
  }

  // Verify 100% zero mutation of live SQLite & running_classes.json
  assert.equal(
    fileSha256IfExists(LIVE_DB_PATH),
    baselineDbSha,
    "Bảo toàn SHA-256 tuyệt đối cho data/mindx_bot.db"
  );
  assert.equal(
    fileSha256IfExists(LIVE_RUNNING_CLASSES_PATH),
    baselineRunningSha,
    "Bảo toàn SHA-256 tuyệt đối cho data/running_classes.json"
  );

  console.log("\n✅ HOÀN TẤT 9/9 KỊCH BẢN KIỂM THỬ v3.4.8 + v3.4.9 (SCT-01 -> SCT-08B) & BẢO TOÀN 100% SHA-256 DỮ LIỆU THẬT!");
}

main().catch((err) => {
  console.error("❌ LỖI KIỂM THỬ v3.4.8/v3.4.9:", err);
  process.exit(1);
});
