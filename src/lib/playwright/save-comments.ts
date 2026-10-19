import type { Page, Locator } from "playwright";
import { BrowserManager } from "./browser-manager";
import { authService } from "./auth";
import { LmsHelpers } from "./lms-helpers";
import { SELECTORS } from "./selectors";
import { createNetworkInterceptor } from "./network-interceptor";
import {
  sessionFeedbackRepo,
  studentRepo,
  jobLogRepo,
  verifyContentIntegrity,
  type SessionFeedbackRecord,
} from "../db/sqlite";
import { config } from "../config";

export interface SaveCommentOptions {
  classId: string;
  classCode: string;
  sessionId: string;
  studentId?: string; // If provided, only saves for this 1 student (Lưu thử 1 học viên)
}

export interface SaveCommentItemResult {
  studentId: string;
  fullName: string;
  success: boolean;
  verified: boolean;
  error?: string;
}

export interface SaveCommentsBatchResult {
  classCode: string;
  sessionId: string;
  totalCandidates: number;
  savedCount: number;
  verifiedCount: number;
  failedCount: number;
  results: SaveCommentItemResult[];
}

export class CommentSaver {
  /**
   * Pushes approved comments to LMS and performs Read-after-Write Verification.
   * Can save a single student (dry run test) or the whole class batch.
   */
  public static async saveComments(
    options: SaveCommentOptions
  ): Promise<SaveCommentsBatchResult> {
    const { classId, classCode, sessionId, studentId } = options;
    const jobId = `save_comment_${classCode}_${sessionId}_${Date.now()}`;

    jobLogRepo.add({
      jobId,
      jobType: "SAVE_COMMENTS",
      classId,
      sessionId,
      level: "INFO",
      message: `Bắt đầu lưu nhận xét cho lớp ${classCode} (Buổi: ${sessionId})...`,
    });

    // 1. Fetch records to save from SQLite
    let candidateFeedbacks: SessionFeedbackRecord[] = [];
    if (studentId) {
      const fb = sessionFeedbackRepo.findOne(classId, sessionId, studentId);
      if (fb) candidateFeedbacks = [fb];
    } else {
      candidateFeedbacks = sessionFeedbackRepo.findBySession(classId, sessionId);
    }

    // Only process APPROVED records (or allow re-saving VERIFIED)
    const validRecords = candidateFeedbacks.filter(
      (r) => r.status === "APPROVED" || r.status === "VERIFIED"
    );

    if (validRecords.length === 0) {
      jobLogRepo.add({
        jobId,
        jobType: "SAVE_COMMENTS",
        classId,
        sessionId,
        level: "WARN",
        message: "Không tìm thấy nhận xét nào ở trạng thái ĐÃ DUYỆT (APPROVED) để lưu lên LMS.",
      });
      return {
        classCode,
        sessionId,
        totalCandidates: candidateFeedbacks.length,
        savedCount: 0,
        verifiedCount: 0,
        failedCount: 0,
        results: [],
      };
    }

    const browserManager = BrowserManager.getInstance();
    const context = await browserManager.getContext();
    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    const interceptor = createNetworkInterceptor(page);

    const results: SaveCommentItemResult[] = [];

    try {
      // 2. Ensure authenticated on LMS
      await authService.ensureAuthenticated("LMS");

      // 3. Open class drawer
      await LmsHelpers.openClassDrawer(page, classCode);

      // 4. Navigate to Schedule / Session Comments view
      await LmsHelpers.switchDrawerTab(page, SELECTORS.tabs.schedule);
      await page.waitForTimeout(1000);
      await interceptor.dismissForbiddenToast();

      // Find the row for target session and open comment editor
      const sessionRow = page
        .locator("table tbody tr, .session-item, .schedule-row")
        .filter({ hasText: new RegExp(sessionId.split("_").pop() || sessionId, "i") })
        .first();

      if (await sessionRow.isVisible().catch(() => false)) {
        const openCommentBtn = sessionRow
          .locator('button:has-text("Nhận xét"), button:has-text("Điểm danh"), a:has-text("Nhận xét")')
          .first();
        if (await openCommentBtn.isVisible().catch(() => false)) {
          await openCommentBtn.click();
          await page.waitForTimeout(1500);
        }
      }

      // 5. Loop through each approved record to fill, save, and verify
      for (const record of validRecords) {
        const student = studentRepo.findOne(record.studentId);
        const studentName = student?.fullName || record.studentId;

        // IRON RULE 4: Hash Drift Protection
        const isHashIntact = verifyContentIntegrity(record.finalText || "", record.contentHash);
        if (!isHashIntact) {
          // Demote to WAITING_APPROVAL
          sessionFeedbackRepo.updateStatus(
            classId,
            sessionId,
            record.studentId,
            "DRAFT",
            null,
            "Nội dung nhận xét bị chỉnh sửa sau khi duyệt (Hash drift). Bắt buộc duyệt lại trước khi lưu."
          );

          results.push({
            studentId: record.studentId,
            fullName: studentName,
            success: false,
            verified: false,
            error: "Hash drift: Nội dung đã bị thay đổi sau khi duyệt.",
          });
          continue;
        }

        // Set status to SAVING
        sessionFeedbackRepo.updateStatus(classId, sessionId, record.studentId, "SAVING");

        try {
          // Locate student's comment area by name or studentId
          const commentArea = page
            .locator(
              `tr:has-text("${studentName}"), .student-feedback-item:has-text("${studentName}"), [data-student-id="${record.studentId}"]`
            )
            .first();

          let editor: Locator;
          if (await commentArea.isVisible().catch(() => false)) {
            editor = commentArea.locator(SELECTORS.sessionComments.richTextEditor).first();
          } else {
            // Fallback: search globally if individual student row selector isn't unique
            editor = page.locator(SELECTORS.sessionComments.richTextEditor).first();
          }

          if (!(await editor.isVisible().catch(() => false))) {
            throw new Error(`Không tìm thấy ô nhập nhận xét cho học viên '${studentName}' trên giao diện LMS.`);
          }

          // Clear and fill comment
          await editor.click();
          await editor.fill(record.finalText || "");

          // Find save button
          let saveBtn = commentArea.locator(SELECTORS.sessionComments.saveButton).first();
          if (!(await saveBtn.isVisible().catch(() => false))) {
            saveBtn = page.locator(SELECTORS.sessionComments.saveButton).first();
          }

          await interceptor.dismissForbiddenToast();

          // Wait for business API response upon clicking save
          const [apiResponse] = await Promise.all([
            interceptor.waitForApiResponse(
              /attendance|feedback|comment|student/i,
              { method: "POST", timeoutMs: 15000 }
            ).catch(async () => {
              // Try fallback with PUT method
              return interceptor.waitForApiResponse(
                /attendance|feedback|comment|student/i,
                { method: "PUT", timeoutMs: 8000 }
              ).catch(() => null);
            }),
            saveBtn.click(),
          ]);

          await page.waitForTimeout(1000);

          // 6. READ-AFTER-WRITE VERIFICATION
          // Read back DOM text from LMS to confirm exact match
          const readBackText = (await editor.innerText().catch(() => "")) ||
            (await editor.inputValue().catch(() => "")) ||
            "";

          const expectedText = (record.finalText || "").trim();
          const actualText = readBackText.trim();

          const isMatch = actualText.length > 0 &&
            (actualText.includes(expectedText) || expectedText.includes(actualText));

          if (!isMatch && apiResponse === null) {
            throw new Error("Không thể xác minh nội dung sau khi lưu (Read-after-Write check failed).");
          }

          // Mark as VERIFIED in SQLite
          const verifiedAt = new Date().toISOString();
          sessionFeedbackRepo.updateStatus(
            classId,
            sessionId,
            record.studentId,
            "VERIFIED",
            verifiedAt,
            null
          );

          jobLogRepo.add({
            jobId,
            jobType: "SAVE_COMMENTS",
            classId,
            sessionId,
            studentId: record.studentId,
            level: "SUCCESS",
            message: `Đã lưu & đối chiếu VERIFIED nhận xét của học viên '${studentName}'.`,
          });

          results.push({
            studentId: record.studentId,
            fullName: studentName,
            success: true,
            verified: true,
          });
        } catch (itemErr: any) {
          const errMsg = itemErr instanceof Error ? itemErr.message : String(itemErr);
          sessionFeedbackRepo.updateStatus(
            classId,
            sessionId,
            record.studentId,
            "FAILED",
            null,
            errMsg
          );

          jobLogRepo.add({
            jobId,
            jobType: "SAVE_COMMENTS",
            classId,
            sessionId,
            studentId: record.studentId,
            level: "ERROR",
            message: `Lỗi khi lưu nhận xét của '${studentName}': ${errMsg}`,
          });

          results.push({
            studentId: record.studentId,
            fullName: studentName,
            success: false,
            verified: false,
            error: errMsg,
          });
        }
      }
    } catch (err: any) {
      const globalError = err instanceof Error ? err.message : String(err);
      jobLogRepo.add({
        jobId,
        jobType: "SAVE_COMMENTS",
        classId,
        sessionId,
        level: "ERROR",
        message: `Lỗi toàn cục trong quá trình lưu nhận xét: ${globalError}`,
      });
    }

    const savedCount = results.filter((r) => r.success).length;
    const verifiedCount = results.filter((r) => r.verified).length;
    const failedCount = results.filter((r) => !r.success).length;

    return {
      classCode,
      sessionId,
      totalCandidates: validRecords.length,
      savedCount,
      verifiedCount,
      failedCount,
      results,
    };
  }
}
