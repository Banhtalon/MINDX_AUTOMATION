/**
 * MINDX AUTOMATION BOT — v3.6.9 REGRESSION SUITE (Isolated in os.tmpdir())
 * Verifies 3-layer protection against stuck `SAVING` ("Đang lưu...") rows:
 * - [SSR-01]: `CommentSaver.saveComments` rolls back orphaned `SAVING` records -> `FAILED`
 *             when a mid-batch global/browser-closed crash interrupts verification,
 *             while preserving concurrent `DRAFT` edits and resetting running flag.
 * - [SSR-02]: `GET /api/session-comments/list` preserves `SAVING` while task is active,
 *             and auto-heals orphaned `SAVING` -> `FAILED` when no save task is running.
 * - [SSR-03]: `ClassSyncer.syncLmsSlotCompletionToSqlite` promotes matching orphaned `SAVING`
 *             records to `VERIFIED` and clears unverified `SAVING` rows -> `FAILED`.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const isolatedTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-v369-ssr-"));
process.env.MINDX_DB_PATH = path.join(isolatedTempDir, "mindx_test_v369.db");
process.env.MINDX_RUNNING_CLASSES_PATH = path.join(
  isolatedTempDir,
  "running_classes_v369.json"
);

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

async function main() {
  console.log("=== BẮT ĐẦU KIỂM THỬ SỬA LỖI KẸT 'Đang lưu...' (v3.6.9: SSR-01 .. SSR-03) ===");

  const { chromium } = await import("playwright");
  const {
    classSessionRepo,
    closeDb,
    getDb,
    sessionFeedbackRepo,
    studentRepo,
  } = await import("../src/lib/db/sqlite");
  const { BrowserManager } = await import("../src/lib/playwright/browser-manager");
  const { authService } = await import("../src/lib/playwright/auth");
  const { LmsHelpers } = await import("../src/lib/playwright/lms-helpers");
  const { CommentSaver } = await import("../src/lib/playwright/save-comments");
  const { ClassSyncer } = await import("../src/lib/playwright/sync-class");
  const {
    isSaveCommentsSessionRunning,
    markSaveCommentsSessionRunning,
  } = await import("../src/lib/queue/task-queue");
  const { GET: listSessionCommentsGet } = await import(
    "../src/app/api/session-comments/list/route"
  );

  const browser = await chromium.launch({ headless: true });
  const bm = BrowserManager.getInstance();
  const origGetPage = bm.getPage.bind(bm);
  const origEnsureAuth = authService.ensureAuthenticated.bind(authService);
  const origOpenDrawer = LmsHelpers.openClassDrawer.bind(LmsHelpers);
  const origSwitchTab = LmsHelpers.switchDrawerTab.bind(LmsHelpers);
  const origEnsureClean = LmsHelpers.ensureCleanDialogAndToast.bind(LmsHelpers);

  const classId = "VT-C4K-PTI12";
  const sessionId = `${classId}_SESS_03`;
  const commentA =
    "- **Điểm mạnh của học viên:** Con hoàn thành tốt bài thực hành trên lớp.\n\n- **Điểm cần cải thiện:** Cần rà soát lại lỗi chính tả biến.\n\n- **Lời khuyên:** Tiếp tục phát huy.";
  const commentB =
    "- **Điểm mạnh của học viên:** Con nắm vững kiến thức bài học.\n\n- **Điểm cần cải thiện:** Thao tác chạy thử còn hơi vội.\n\n- **Lời khuyên:** Luyện tập thêm ở nhà.";

  try {
    studentRepo.upsert({
      studentId: "STU_SSR_01",
      classId,
      fullName: "Nguyễn Văn An",
      isActive: 1,
    });
    studentRepo.upsert({
      studentId: "STU_SSR_02",
      classId,
      fullName: "Trần Bảo Bình",
      isActive: 1,
    });
    studentRepo.upsert({
      studentId: "STU_SSR_03",
      classId,
      fullName: "Lê Minh Châu",
      isActive: 1,
    });
    classSessionRepo.upsert({
      classId,
      className: classId,
      sessionId,
      sessionNumber: 3,
      date: "20/11/2026",
      topic: "Ôn tập về danh sách (List)",
    });

    // =========================================================================
    // [SSR-01] Global/browser-close interruption inside CommentSaver rolls back SAVING -> FAILED
    // =========================================================================
    console.log("[SSR-01] Kiểm tra rollback SAVING -> FAILED khi đóng trình duyệt giữa chừng...");
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.setContent(`
      <html>
        <body>
          <div aria-labelledby="class-detail">
            <div id="class-comments-slot-carousel-2" class="active">Slot 3</div>
            <div class="MuiCollapse-root">
              <div class="MuiCollapse-entered">
                <p>Summary</p><button type="button">Edit</button>
                <p>Homework</p><button type="button">Edit</button>
                <button type="button">Refresh</button>
                <table>
                  <tbody>
                    <tr data-student-id="STU_SSR_01">
                      <td>Nguyễn Văn An</td>
                      <td></td>
                      <td><span>Attended</span></td>
                      <td></td>
                      <td><button type="button" class="edit-btn">Edit</button></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </body>
      </html>
    `);

    const hashA = sha256(commentA);
    const hashB = sha256(commentB);

    sessionFeedbackRepo.upsert({
      classId,
      sessionId,
      studentId: "STU_SSR_01",
      attendanceStatus: "PRESENT",
      quickTagsJson: "[]",
      teacherNote: "",
      strengths: "",
      improvements: "",
      actionPlan: "",
      finalText: commentA,
      contentHash: hashA,
      status: "APPROVED",
    });
    // Student 2 is already SAVING in DB and gets concurrently edited to DRAFT mid-flight
    sessionFeedbackRepo.upsert({
      classId,
      sessionId,
      studentId: "STU_SSR_02",
      attendanceStatus: "PRESENT",
      quickTagsJson: "[]",
      teacherNote: "",
      strengths: "",
      improvements: "",
      actionPlan: "",
      finalText: commentB,
      contentHash: hashB,
      status: "SAVING",
    });

    (bm as any).getPage = async () => page;
    (authService as any).ensureAuthenticated = async () => {};
    (LmsHelpers as any).openClassDrawer = async () => {};
    (LmsHelpers as any).switchDrawerTab = async () => {
      // Simulate STU_SSR_01 transitioning into SAVING and STU_SSR_02 concurrently edited to DRAFT right before browser closes
      sessionFeedbackRepo.updateStatus(
        classId,
        sessionId,
        "STU_SSR_01",
        "SAVING",
        null,
        null,
        hashA
      );
      sessionFeedbackRepo.upsert({
        classId,
        sessionId,
        studentId: "STU_SSR_02",
        attendanceStatus: "PRESENT",
        quickTagsJson: "[]",
        teacherNote: "",
        strengths: "",
        improvements: "",
        actionPlan: "",
        finalText: `${commentB} (GV mới sửa)`,
        contentHash: "",
        status: "DRAFT",
      });
      assert.equal(
        isSaveCommentsSessionRunning(classId, sessionId),
        true,
        "[SSR-01] Active marker must be true during saveComments execution"
      );
      throw new Error("page.waitForTimeout: Target page, context or browser has been closed");
    };
    (LmsHelpers as any).ensureCleanDialogAndToast = async () => {};

    let threwExpectedError = false;
    try {
      await CommentSaver.saveComments({
        classId,
        classCode: classId,
        sessionId,
      });
    } catch (err: any) {
      threwExpectedError = String(err?.message || "").includes("Target page, context or browser has been closed");
    }
    assert.equal(threwExpectedError, true, "[SSR-01] saveComments should rethrow crash error");
    assert.equal(
      isSaveCommentsSessionRunning(classId, sessionId),
      false,
      "[SSR-01] Active marker must reset to false in finally"
    );

    const fb1AfterCrash = sessionFeedbackRepo.findOne(classId, sessionId, "STU_SSR_01");
    assert.equal(fb1AfterCrash?.status, "FAILED", "[SSR-01] SAVING row must roll back to FAILED on global crash");
    assert.ok(
      String(fb1AfterCrash?.errorMessage || "").includes("gián đoạn"),
      "[SSR-01] Rolled-back row should have clear interrupted error message"
    );
    const fb2AfterCrash = sessionFeedbackRepo.findOne(classId, sessionId, "STU_SSR_02");
    assert.equal(
      fb2AfterCrash?.status,
      "DRAFT",
      "[SSR-01] Concurrently edited DRAFT row must stay DRAFT"
    );
    await context.close();

    // =========================================================================
    // [SSR-02] GET /api/session-comments/list auto-heals orphaned SAVING rows ONLY when idle
    // =========================================================================
    console.log("[SSR-02] Kiểm tra API GET /api/session-comments/list tự gỡ SAVING bị treo...");
    sessionFeedbackRepo.updateStatus(
      classId,
      sessionId,
      "STU_SSR_01",
      "SAVING",
      null,
      null,
      hashA
    );

    const req = new Request(
      `http://127.0.0.1:3000/api/session-comments/list?classId=${classId}&sessionId=${sessionId}`,
      {
        method: "GET",
        headers: { host: "127.0.0.1:3000" },
      }
    );

    markSaveCommentsSessionRunning(classId, sessionId, true);
    const activeRes = await listSessionCommentsGet(req);
    assert.equal(activeRes.status, 200);
    const activeJson: any = await activeRes.json();
    const stu1Active = activeJson.data.feedbacks.find((f: any) => f.studentId === "STU_SSR_01");
    assert.equal(stu1Active?.status, "SAVING", "[SSR-02] While running=true, status must remain SAVING");
    markSaveCommentsSessionRunning(classId, sessionId, false);

    const idleRes = await listSessionCommentsGet(req);
    assert.equal(idleRes.status, 200);
    const idleJson: any = await idleRes.json();
    const stu1Idle = idleJson.data.feedbacks.find((f: any) => f.studentId === "STU_SSR_01");
    assert.equal(stu1Idle?.status, "FAILED", "[SSR-02] When idle, orphaned SAVING must auto-heal to FAILED in API response");
    assert.equal(
      sessionFeedbackRepo.findOne(classId, sessionId, "STU_SSR_01")?.status,
      "FAILED",
      "[SSR-02] Orphaned SAVING must auto-heal in SQLite"
    );

    // =========================================================================
    // [SSR-03] ClassSyncer.syncLmsSlotCompletionToSqlite upgrades matched SAVING -> VERIFIED
    //          and clears unverified orphaned SAVING -> FAILED
    // =========================================================================
    console.log("[SSR-03] Kiểm tra Đồng bộ LMS đối chiếu SAVING khớp -> VERIFIED và xóa SAVING treo...");
    const commentC =
      "- **Điểm mạnh của học viên:** Con hoàn thành tốt bài thực hành.\n\n- **Điểm cần cải thiện:** Chủ động giơ tay phát biểu nhiều hơn.\n\n- **Lời khuyên:** Tiếp tục cố gắng.";
    const hashC = sha256(commentC);

    sessionFeedbackRepo.updateStatus(
      classId,
      sessionId,
      "STU_SSR_01",
      "SAVING",
      null,
      null,
      hashA
    );
    sessionFeedbackRepo.upsert({
      classId,
      sessionId,
      studentId: "STU_SSR_03",
      attendanceStatus: "PRESENT",
      quickTagsJson: "[]",
      teacherNote: "",
      strengths: "",
      improvements: "",
      actionPlan: "",
      finalText: commentC,
      contentHash: hashC,
      status: "SAVING",
    });

    const db = getDb();
    const allStudents = studentRepo.findByClass(classId, false);
    ClassSyncer.syncLmsSlotCompletionToSqlite({
      db,
      classId,
      students: allStudents,
      preferLmsVerified: false,
      slots: [
        {
          index: 2, // Session 3
          studentAttendance: [
            {
              status: "ATTENDED",
              student: { id: "STU_SSR_01", fullName: "Nguyễn Văn An" },
              comment: commentA,
              commentByAreas: [{ type: "CONTENT", content: commentA }],
            },
            {
              status: "ATTENDED",
              student: { id: "STU_SSR_03", fullName: "Lê Minh Châu" },
              comment: "",
              commentByAreas: [],
            },
          ],
        },
      ],
    });

    const s1Synced = sessionFeedbackRepo.findOne(classId, sessionId, "STU_SSR_01");
    const s3Synced = sessionFeedbackRepo.findOne(classId, sessionId, "STU_SSR_03");
    assert.equal(s1Synced?.status, "VERIFIED", "[SSR-03] Matched LMS comment must upgrade SAVING -> VERIFIED");
    assert.equal(s1Synced?.errorMessage ?? null, null, "[SSR-03] VERIFIED record must clear errorMessage");
    assert.equal(s3Synced?.status, "FAILED", "[SSR-03] Unsaved orphaned SAVING row must clear to FAILED");

    console.log("✅ TẤT CẢ KIỂM THỬ PHỤC HỒI KẸT 'Đang lưu...' [SSR-01..SSR-03] ĐỀU PASS 100%!");
  } finally {
    markSaveCommentsSessionRunning(classId, sessionId, false);
    (bm as any).getPage = origGetPage;
    (authService as any).ensureAuthenticated = origEnsureAuth;
    (LmsHelpers as any).openClassDrawer = origOpenDrawer;
    (LmsHelpers as any).switchDrawerTab = origSwitchTab;
    (LmsHelpers as any).ensureCleanDialogAndToast = origEnsureClean;
    await browser.close().catch(() => {});
    try {
      closeDb();
    } catch {}
    fs.rmSync(isolatedTempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("❌ TEST FAILED:", err);
  process.exit(1);
});
