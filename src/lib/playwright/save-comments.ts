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
import { getCoursesSyllabus } from "../db/json-config";
import { config } from "../config";

export interface SaveCommentOptions {
  classId: string;
  classCode: string;
  sessionId: string;
  studentId?: string; // If provided, only saves for this 1 student (Lưu thử 1 học viên)
  topic?: string;
  keyKnowledge?: string[];
  homeworkBrief?: string;
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
    const classId = (options.classId || "").trim().toUpperCase();
    const classCode = (options.classCode || "").trim().toUpperCase();
    const sessionId = (options.sessionId || "").trim();
    const { studentId } = options;
    const jobId = `save_comment_${classCode}_${sessionId}_${Date.now()}`;

    // Strict Guardrail 1: classId and classCode must be identical and non-empty
    if (!classId || !classCode || classId !== classCode) {
      const mismatchClassMsg = `Mã định danh lớp (classId='${classId}') không đồng nhất với mã lớp mở LMS (classCode='${classCode}')! Đã chặn thao tác để tránh ghi nhầm lớp.`;
      jobLogRepo.add({
        jobId,
        jobType: "SAVE_COMMENTS",
        classId,
        sessionId,
        level: "ERROR",
        message: mismatchClassMsg,
      });
      throw new Error(mismatchClassMsg);
    }

    // Strict Guardrail 2: sessionId must belong strictly to this exact classId (no prefix collision like CLASS_A vs CLASS_A1)
    const escapedClassId = classId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const exactSessionRegex = new RegExp(`^${escapedClassId}_SESS_(\\d+)$`, "i");
    const sessionMatch = sessionId.match(exactSessionRegex);
    if (!sessionMatch) {
      const mismatchMsg = `Mã buổi học (${sessionId}) không thuộc đúng lớp ${classCode} (Yêu cầu định dạng ${classId}_SESS_XX)! Đã chặn thao tác để tránh ghi nhầm buổi học.`;
      jobLogRepo.add({
        jobId,
        jobType: "SAVE_COMMENTS",
        classId,
        sessionId,
        level: "ERROR",
        message: mismatchMsg,
      });
      throw new Error(mismatchMsg);
    }

    if (parseInt(sessionMatch[1], 10) === 14) {
      const s14BlockMsg = `Buổi 14 (${sessionId}) là buổi Tổng kết cuối khóa (gồm Điểm Năng lực, Điểm Demo và Thư từ MindX 3 phần), không sử dụng luồng nhận xét buổi học thường kỳ. Vui lòng thực hiện tại Màn hình 3 — Sản phẩm cuối khóa (Tab SPCK — Buổi 14).`;
      jobLogRepo.add({
        jobId,
        jobType: "SAVE_COMMENTS",
        classId,
        sessionId,
        level: "ERROR",
        message: s14BlockMsg,
      });
      throw new Error(s14BlockMsg);
    }

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

    // Process APPROVED or VERIFIED records, or FAILED/SAVING records for retry (hash integrity will be checked next)
    const validRecords = candidateFeedbacks.filter(
      (r) =>
        r.status === "APPROVED" ||
        r.status === "VERIFIED" ||
        ((r.status === "FAILED" || r.status === "SAVING") && r.contentHash)
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
    const page = await browserManager.getPage();
    const interceptor = createNetworkInterceptor(page);

    const results: SaveCommentItemResult[] = [];

    try {
      // 2. Ensure authenticated on LMS
      await authService.ensureAuthenticated("LMS");

      // 3. Open class drawer
      await LmsHelpers.openClassDrawer(page, classCode);

      // 4. Navigate to Comments tab in drawer
      await LmsHelpers.switchDrawerTab(page, SELECTORS.tabs.comments);
      await page.waitForTimeout(1200);
      await interceptor.dismissForbiddenToast();

      const drawer = page
        .locator('div[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight')
        .first();

      // 5. Select target slot in carousel and STRICTLY verify it becomes .active
      // e.g. "VT-C4K-GA38_SESS_10" -> slotNumber = 10 -> slotIndex = 9
      const slotMatch = sessionId.match(/(\d+)(?!.*\d)/);
      const slotNumber = slotMatch ? parseInt(slotMatch[1], 10) : 1;
      const slotIndex = Math.max(0, slotNumber - 1);

      const slotItem = drawer
        .locator(`[id="class-comments-slot-carousel-${slotIndex}"]`)
        .first();

      await slotItem.waitFor({ state: "attached", timeout: 10000 });

      const slotClassAttr = (await slotItem.getAttribute("class").catch(() => "")) || "";
      if (slotClassAttr.includes("disabled")) {
        throw new Error(
          `Buổi học số ${slotNumber} (#${slotNumber}) đang bị khóa (disabled) trên LMS, chưa thể nhập nhận xét.`
        );
      }

      let isSlotActive = await slotItem
        .evaluate((el) => el.classList.contains("active"))
        .catch(() => false);

      if (!isSlotActive) {
        const infoContainer = slotItem.locator(".info-container").first();
        for (let attempt = 1; attempt <= 3 && !isSlotActive; attempt++) {
          await slotItem.scrollIntoViewIfNeeded().catch(() => {});
          await page.waitForTimeout(200);

          if (await infoContainer.isVisible().catch(() => false)) {
            await infoContainer.click({ force: true });
          } else {
            await slotItem.click({ force: true });
          }

          await page.waitForTimeout(1200);
          isSlotActive = await slotItem
            .evaluate((el) => el.classList.contains("active"))
            .catch(() => false);
        }
      }

      if (!isSlotActive) {
        throw new Error(
          `Không thể kích hoạt Buổi học số ${slotNumber} (#${slotNumber}) trên LMS (slot chưa chuyển sang trạng thái active). Đã hủy thao tác để tránh ghi nhầm sang buổi học khác!`
        );
      }

      jobLogRepo.add({
        jobId,
        jobType: "SAVE_COMMENTS",
        classId,
        sessionId,
        level: "INFO",
        message: `Đã chọn và xác nhận kích hoạt đúng Buổi #${slotNumber} (slotIndex=${slotIndex}) trên LMS.`,
      });

      // Wait for student table to be loaded
      const studentTable = drawer.locator('.comment-list-table table, table').first();
      await studentTable.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(500);

      // 5.5. Automatically fill Slot Summary (Title + Key Knowledge) and Slot Homework (Homework Brief)
      try {
        let resolvedTopic = (options.topic || "").trim();
        let resolvedKeyKnowledge = Array.isArray(options.keyKnowledge)
          ? options.keyKnowledge.map((k) => String(k || "").trim()).filter(Boolean)
          : [];
        let resolvedHomeworkBrief = (options.homeworkBrief || "").trim();

        if (
          (!resolvedTopic || resolvedKeyKnowledge.length === 0 || !resolvedHomeworkBrief) &&
          typeof getCoursesSyllabus === "function"
        ) {
          const syllabusList = getCoursesSyllabus() || [];
          const matchedCourse = syllabusList.find((c) =>
            classCode.toUpperCase().includes(String(c.courseCode || "").toUpperCase())
          );
          const matchedSess = matchedCourse?.sessions?.find((s) => s.sessionNumber === slotNumber);
          if (matchedSess) {
            if (!resolvedTopic && matchedSess.topic) {
              resolvedTopic = String(matchedSess.topic).trim();
            }
            if (resolvedKeyKnowledge.length === 0 && Array.isArray(matchedSess.keyKnowledge)) {
              resolvedKeyKnowledge = matchedSess.keyKnowledge
                .map((k) => String(k || "").trim())
                .filter(Boolean);
            }
            const sessHw = (matchedSess as any).homeworkBrief || (matchedSess as any).homeworkSummary;
            if (!resolvedHomeworkBrief && sessHw) {
              resolvedHomeworkBrief = String(sessHw).trim();
            }
          }
        }

        const summaryLines: string[] = [];
        if (resolvedTopic) {
          const formattedTitle = /^(?:BÀI|BUỔI)\s+\d+/i.test(resolvedTopic)
            ? resolvedTopic.toUpperCase()
            : `BÀI ${slotNumber}: ${resolvedTopic.toUpperCase()}`;
          summaryLines.push(formattedTitle);
        }
        for (const kItem of resolvedKeyKnowledge) {
          summaryLines.push(kItem);
        }

        const homeworkLines: string[] = resolvedHomeworkBrief ? [resolvedHomeworkBrief] : [];

        const fillSlotSection = async (sectionLabel: "Summary" | "Homework", targetLines: string[]) => {
          if (targetLines.length === 0) return;
          // Exclude any container that wraps the Drawer's top [role="tablist"] (which also has a "Homework" tab)
          const sectionCard = drawer
            .locator(
              `div:has(> div > div > div > span:text-is("${sectionLabel}")):not(:has([role="tablist"])):not(:has([role="tab"]))`
            )
            .first();
          const hasSection = await sectionCard.isVisible().catch(() => false);
          if (!hasSection) return;
          const isTabHeaderMatch = await sectionCard
            .evaluate((el) =>
              Boolean(
                el.closest('[role="tablist"]') ||
                  el.querySelector('[role="tablist"], [role="tab"]')
              )
            )
            .catch(() => false);
          if (isTabHeaderMatch) return;

          const expandMoreIcon = sectionCard.locator('[data-testid="ExpandMoreIcon"]').first();
          if (await expandMoreIcon.isVisible().catch(() => false)) {
            await expandMoreIcon.click({ force: true }).catch(() => {});
            await page.waitForTimeout(400);
          }

          const sectionBody = sectionCard.locator("> div").nth(1);
          if (!(await sectionBody.isVisible().catch(() => false))) return;

          const existingBodyText = (await sectionBody.innerText().catch(() => ""))
            .replace(/\s+/g, " ")
            .trim();
          const expectedBodyText = targetLines.join(" ").replace(/\s+/g, " ").trim();

          if (existingBodyText === expectedBodyText) {
            return;
          }

          const clickableArea = sectionBody.locator("> div > div").first();
          await clickableArea.scrollIntoViewIfNeeded().catch(() => {});
          await clickableArea.click({ force: true });
          await page.waitForTimeout(450);

          const inlineEditor = sectionBody.locator('.ql-editor[contenteditable="true"]').first();
          if (!(await inlineEditor.isVisible().catch(() => false))) {
            await clickableArea.click({ force: true }).catch(() => {});
            await page.waitForTimeout(450);
          }
          if (await inlineEditor.isVisible().catch(() => false)) {
            await inlineEditor.click({ force: true }).catch(() => {});
            await inlineEditor.evaluate((el, linesToFill: string[]) => {
              if (
                typeof document !== "undefined" &&
                typeof (el as HTMLElement).replaceChildren === "function"
              ) {
                (el as HTMLElement).replaceChildren();
                for (const lineStr of linesToFill) {
                  const pEl = document.createElement("p");
                  pEl.appendChild(document.createTextNode(lineStr));
                  el.appendChild(pEl);
                }
              } else {
                el.textContent = linesToFill.join("\n");
              }
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
              if (typeof (el as HTMLElement).blur === "function") {
                (el as HTMLElement).blur();
              }
            }, targetLines);

            // Trigger ClickAwayListener & auto-save (UpdateSlotComment) by clicking the student table header
            // outside the section card — NEVER click slotItem while it is already .active, because clicking an
            // active slot on MindX LMS toggles it back to .inactive and hides the entire student table!
            const slotSaveResPromise = page
              .waitForResponse(
                (res) => {
                  const url = res.url().toLowerCase();
                  if (!url.includes("graphql") && !url.includes("lms-api.mindx.edu.vn")) {
                    return false;
                  }
                  const postData = res.request().postData() || "";
                  return /UpdateSlotComment|updateSlot/i.test(postData);
                },
                { timeout: 6000 }
              )
              .catch(() => null);

            const outsideHeader = drawer.locator('th:has-text("student"), th:has-text("Comment")').first();
            if (await outsideHeader.isVisible().catch(() => false)) {
              await outsideHeader.click({ force: true, timeout: 2500 }).catch(() => {});
            }
            await page.waitForTimeout(250);
            if (await inlineEditor.isVisible().catch(() => false)) {
              await page
                .evaluate(() => {
                  const target =
                    document.querySelector('.comment-list-table th') ||
                    document.querySelector('[aria-labelledby="class-detail"]') ||
                    document.body;
                  if (target) {
                    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
                    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
                    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
                  }
                })
                .catch(() => {});
            }
            const slotSaveRes = await slotSaveResPromise;
            await page.waitForTimeout(600);

            const afterBodyText = (await sectionBody.innerText().catch(() => ""))
              .replace(/\s+/g, " ")
              .trim();
            const apiOk = !slotSaveRes || (slotSaveRes.status() >= 200 && slotSaveRes.status() < 300);
            const domVerified = afterBodyText === expectedBodyText;

            if (apiOk && domVerified) {
              jobLogRepo.add({
                jobId,
                jobType: "SAVE_COMMENTS",
                classId,
                sessionId,
                level: "SUCCESS",
                message: `Đã tự động điền và xác minh mục ${sectionLabel} cho Buổi #${slotNumber} trên LMS.`,
              });
            } else {
              jobLogRepo.add({
                jobId,
                jobType: "SAVE_COMMENTS",
                classId,
                sessionId,
                level: "WARN",
                message: `Chưa thể xác minh mục ${sectionLabel} cho Buổi #${slotNumber} sau khi lưu trên LMS.`,
              });
            }
          }
        };

        await fillSlotSection("Summary", summaryLines);
        await fillSlotSection("Homework", homeworkLines);
      } catch (slotMetaErr) {
        jobLogRepo.add({
          jobId,
          jobType: "SAVE_COMMENTS",
          classId,
          sessionId,
          level: "WARN",
          message: `Không thể tự động điền Summary/Homework cho buổi học: ${
            slotMetaErr instanceof Error ? slotMetaErr.message : String(slotMetaErr)
          }`,
        });
      }

      // Ensure the target slot is still .active after Summary/Homework auto-save before reading student rows (must throw if slot is missing or cannot be re-activated)
      const slotCountAfterMeta =
        typeof (slotItem as any).count === "function"
          ? await (slotItem as any).count().catch(() => 0)
          : 1;
      const stillActiveAfterMeta =
        slotCountAfterMeta > 0 &&
        (await slotItem.evaluate((el) => el.classList.contains("active")).catch(() => false));
      if (!stillActiveAfterMeta) {
        await LmsHelpers.ensureCommentsSlotReady(page, classCode, slotNumber, {
          reopenDrawerIfClosed: false,
          waitForTableMs: 5000,
        });
      }
      await studentTable.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});

      // Helper to fetch the freshest feedback record from DB (supports both findOne and findBySession mocks)
      const getLatestFeedbackRecord = (targetStudentId: string): SessionFeedbackRecord | undefined => {
        if (typeof sessionFeedbackRepo.findOne === "function") {
          return sessionFeedbackRepo.findOne(classId, sessionId, targetStudentId);
        }
        if (typeof sessionFeedbackRepo.findBySession === "function") {
          const allInSess = sessionFeedbackRepo.findBySession(classId, sessionId) || [];
          return allInSess.find((r) => r.studentId === targetStudentId);
        }
        return undefined;
      };

      const classRoster =
        typeof studentRepo.findByClass === "function"
          ? studentRepo.findByClass(classId, false) || []
          : [];

      const preSaveRetryEligibleIds = new Set<string>();

      const isRetryablePreSaveUiError = (msg?: string): boolean => {
        if (!msg) return false;
        if (
          msg.includes("Hash drift") ||
          msg.includes("IN_FLIGHT_DRIFT") ||
          msg.includes("Read-after-Write check failed") ||
          msg.includes("không còn thuộc danh sách active") ||
          msg.includes("trạng thái điểm danh") ||
          msg.includes("trùng tên") ||
          msg.includes("Không thể kích hoạt Buổi học") ||
          msg.includes("không còn ở trạng thái .active") ||
          msg.includes("không còn tồn tại") ||
          msg.includes("Không tìm thấy ô Buổi học") ||
          msg.includes("đang bị khóa (disabled)") ||
          msg.includes("Không thể đóng hộp thoại")
        ) {
          return false;
        }
        return (
          /số dòng khớp\s*=\s*0/i.test(msg) ||
          /role=["']dialog["']/i.test(msg) ||
          /Timeout.*exceeded/i.test(msg) ||
          msg.includes("Không tìm thấy ô soạn thảo") ||
          msg.includes("Không tìm thấy nút 'Save'")
        );
      };

      // 6. Process a single student record (used for both Pass 1 and Auto-Retry Pass 2)
      const processSingleStudentRecord = async (
        record: SessionFeedbackRecord,
        isRetryPass = false
      ): Promise<SaveCommentItemResult> => {
        const student =
          typeof studentRepo.findOne === "function"
            ? studentRepo.findOne(record.studentId, classId)
            : undefined;
        const studentName = student?.fullName || record.studentId;

        // Re-check latest state in DB before starting browser interaction
        const preSaveRecord = getLatestFeedbackRecord(record.studentId) || record;
        const approvedText = preSaveRecord.finalText || "";
        const approvedHash = preSaveRecord.contentHash || "";

        // R15-04: Re-verify active roster membership and attendance eligibility before saving
        const hasStudentRepoCheck = typeof studentRepo.findOne === "function";
        const isRosterEligible =
          !hasStudentRepoCheck ||
          (Boolean(student) &&
            (!student?.classId || student.classId === classId) &&
            student?.isActive === 1);
        const currentAttendance = preSaveRecord.attendanceStatus;
        const isAttendanceEligible =
          currentAttendance === undefined ||
          currentAttendance === null ||
          currentAttendance === "PRESENT" ||
          currentAttendance === "LATE";

        if (!isRosterEligible || !isAttendanceEligible) {
          const eligibilityReason = !isRosterEligible
            ? `Học viên '${studentName}' không còn thuộc danh sách active của lớp ${classId}.`
            : `Học viên '${studentName}' đang có trạng thái điểm danh '${currentAttendance}' (không đủ điều kiện lưu nhận xét LMS).`;

          if (preSaveRecord.status !== "DRAFT") {
            sessionFeedbackRepo.updateStatus(
              classId,
              sessionId,
              record.studentId,
              "DRAFT",
              null,
              eligibilityReason,
              approvedHash
            );
          }

          return {
            studentId: record.studentId,
            fullName: studentName,
            success: false,
            verified: false,
            error: eligibilityReason,
          };
        }

        // IRON RULE 4: Hash Drift Protection
        const isHashIntact =
          (preSaveRecord.status === "APPROVED" ||
            preSaveRecord.status === "VERIFIED" ||
            ((preSaveRecord.status === "FAILED" || preSaveRecord.status === "SAVING") &&
              Boolean(approvedHash))) &&
          verifyContentIntegrity(approvedText, approvedHash);

        if (!isHashIntact) {
          // Demote to DRAFT only if not already edited into a new DRAFT
          if (preSaveRecord.status !== "DRAFT") {
            sessionFeedbackRepo.updateStatus(
              classId,
              sessionId,
              record.studentId,
              "DRAFT",
              null,
              "Nội dung nhận xét bị chỉnh sửa sau khi duyệt (Hash drift). Bắt buộc duyệt lại trước khi lưu.",
              approvedHash
            );
          }

          return {
            studentId: record.studentId,
            fullName: studentName,
            success: false,
            verified: false,
            error: "Hash drift: Nội dung đã bị thay đổi sau khi duyệt.",
          };
        }

        // Set status to SAVING locked by approvedHash
        sessionFeedbackRepo.updateStatus(
          classId,
          sessionId,
          record.studentId,
          "SAVING",
          null,
          null,
          approvedHash
        );

        let saveMutationDispatched = false;

        try {
          const escapedStudentId = record.studentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const escapedName = studentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

          // Self-Healing UI before each student: close any dangling modal/toast and re-activate slot if it is not .active
          await LmsHelpers.ensureCleanDialogAndToast(page, interceptor);
          const currentSlotCount =
            typeof (slotItem as any).count === "function"
              ? await (slotItem as any).count().catch(() => 0)
              : 1;
          const isSlotCurrentlyActive =
            currentSlotCount > 0 &&
            (await slotItem.evaluate((el) => el.classList.contains("active")).catch(() => false));
          if (!isSlotCurrentlyActive || isRetryPass) {
            await LmsHelpers.ensureCommentsSlotReady(page, classCode, slotNumber, {
              reopenDrawerIfClosed: isRetryPass,
              waitForTableMs: 5000,
            });
          }

          const allRows = drawer.locator('.comment-list-table table tbody tr, table tbody tr, tr');

          // 1. Try locating row by explicit studentId attribute first (check count() first to avoid 30s timeout when attribute doesn't exist in DOM)
          const idAttrRow = drawer
            .locator(
              `tr[data-student-id="${record.studentId}"], tr[data-id="${record.studentId}"], [data-student-id="${record.studentId}"]`
            )
            .first();
          const idAttrRowCount =
            typeof (idAttrRow as any).count === "function"
              ? await (idAttrRow as any).count().catch(() => 0)
              : 1;
          const explicitAttrVal =
            idAttrRowCount > 0
              ? (await idAttrRow.getAttribute("data-student-id", { timeout: 500 } as any).catch(() => null)) ||
                (await idAttrRow.getAttribute("data-id", { timeout: 500 } as any).catch(() => null))
              : null;
          const hasExplicitIdRow = explicitAttrVal === record.studentId;

          // Guard against duplicate student names in the same class roster when row has no explicit studentId attribute
          if (!hasExplicitIdRow && classRoster.length > 1) {
            const normTarget = studentName.trim().toLowerCase();
            const sameNameCount = classRoster.filter(
              (s) => (s.fullName || "").trim().toLowerCase() === normTarget
            ).length;
            if (sameNameCount > 1) {
              throw new Error(
                `Phát hiện ${sameNameCount} học viên trùng tên '${studentName}' trong lớp ${classCode} và DOM không có thuộc tính studentId riêng. Đã dừng tự động điền để tránh ghi nhầm học viên.`
              );
            }
          }

          // 2. Locate student row: require full-line name match (terminated by newline/tab/pipe/EOF, NEVER horizontal space that could prefix-match a longer name like "Nguyễn An Bình")
          const exactNameLineRegex = new RegExp(
            `(?:^|[\\r\\n\\t|]|\\b${escapedStudentId}[ \\t]+)${escapedName}(?:$|[\\r\\n\\t|])`,
            "i"
          );
          const filteredRows = allRows.filter({ hasText: exactNameLineRegex });
          let matchedRowCount =
            typeof (filteredRows as any).count === "function"
              ? await (filteredRows as any).count().catch(() => 1)
              : 1;

          let fallbackMatchedRow: any = null;
          const scanBodyRowsByLine = async () => {
            const bodyRows = drawer.locator('.comment-list-table table tbody tr, table tbody tr');
            const totalBodyRows =
              typeof (bodyRows as any).count === "function"
                ? await (bodyRows as any).count().catch(() => 0)
                : 0;
            const matchedIndices: number[] = [];
            for (let rIdx = 0; rIdx < totalBodyRows; rIdx++) {
              const candidateRow = bodyRows.nth(rIdx);
              const rawRowText = (await candidateRow.innerText().catch(() => "")).normalize("NFC");
              const cleanedMultiline = rawRowText
                .split(/[\r\n\t|]+/)
                .map((line: string) => line.replace(/\s+/g, " ").trim())
                .filter(Boolean)
                .join("\n");
              if (exactNameLineRegex.test(cleanedMultiline)) {
                matchedIndices.push(rIdx);
              }
            }
            matchedRowCount = matchedIndices.length;
            if (matchedRowCount === 1) {
              fallbackMatchedRow = bodyRows.nth(matchedIndices[0]);
            }
          };

          if (!hasExplicitIdRow && matchedRowCount === 0) {
            await scanBodyRowsByLine();
          }

          // Self-healing fallback: if 0 rows matched on first check, re-verify slot active state once and re-scan
          if (!hasExplicitIdRow && matchedRowCount === 0) {
            await LmsHelpers.ensureCommentsSlotReady(page, classCode, slotNumber, {
              reopenDrawerIfClosed: true,
              waitForTableMs: 3000,
            });
            await scanBodyRowsByLine();
          }

          if (!hasExplicitIdRow && matchedRowCount !== 1) {
            throw new Error(
              `Không xác định được duy nhất 1 dòng cho học viên '${studentName}' (${record.studentId}) trên bảng nhận xét (số dòng khớp=${matchedRowCount}).`
            );
          }

          const studentRow = hasExplicitIdRow
            ? idAttrRow
            : fallbackMatchedRow || filteredRows.first();

          await studentRow.scrollIntoViewIfNeeded().catch(() => {});
          await page.waitForTimeout(300);

          const openCommentBtn = studentRow
            .locator('button:has-text("Nhận xét học sinh"), button:has-text("Nhận xét")')
            .first();

          // Wait for comment dialog to appear (with resilient retry if backdrop/toast/re-render swallows first click)
          const dialog = page.locator('[role="dialog"]').first();
          let openDialogErr: unknown = null;
          for (let openAttempt = 1; openAttempt <= 3; openAttempt++) {
            try {
              if (openAttempt > 1) {
                await interceptor.dismissForbiddenToast();
                await page.waitForTimeout(500);
              }
              await openCommentBtn.scrollIntoViewIfNeeded().catch(() => {});
              await page.waitForTimeout(200);
              await openCommentBtn.waitFor({ state: "visible", timeout: 8000 });
              await openCommentBtn.click({ force: true });
              await dialog.waitFor({ state: "visible", timeout: 5000 });
              openDialogErr = null;
              break;
            } catch (err) {
              openDialogErr = err;
              if (openAttempt >= 2) {
                await openCommentBtn
                  .evaluate((el: any) => {
                    if (el && typeof (el as HTMLElement).click === "function") {
                      (el as HTMLElement).click();
                    }
                  })
                  .catch(() => {});
                try {
                  await dialog.waitFor({ state: "visible", timeout: 4000 });
                  openDialogErr = null;
                  break;
                } catch (evalErr) {
                  openDialogErr = evalErr;
                }
              }
            }
          }
          if (openDialogErr) {
            throw openDialogErr;
          }
          await page.waitForTimeout(600);

          const commentText = approvedText.replace(
            /^\s*\*\*[^*\n]+\*\*\s*\r?\n+(?=\s*[-•*]\s*\*\*Điểm mạnh)/i,
            ""
          );
          const normalizedExpectedRaw = commentText.replace(/\s+/g, " ").trim();
          const normalizedExpectedPlain = commentText
            .replace(/\*\*([^*\n]+)\*\*/g, "$1")
            .replace(/\s+/g, " ")
            .trim();

          // Locate Quill rich text editor
          const editor = dialog
            .locator('.ql-editor[contenteditable="true"], .ck-content, [contenteditable="true"], textarea')
            .first();

          let isEditorVisible = await editor.isVisible().catch(() => false);
          let alreadySavedAndVerifiedInViewMode = false;
          let wasSwitchedFromViewMode = false;

          if (!isEditorVisible) {
            // Case A: Comment already saved (dialog opens in view mode showing existing comment in table row)
            const savedRow = dialog.locator('table tbody tr').first();
            if (await savedRow.isVisible().catch(() => false)) {
              const existingCandidates: string[] = [];
              const existingCell2 = dialog.locator("table tbody tr td:nth-child(2)").first();
              if (await existingCell2.isVisible().catch(() => false)) {
                const raw2 = await existingCell2.innerText().catch(() => "");
                if (raw2) existingCandidates.push(raw2);
              }
              if (existingCandidates.length === 0) {
                const existingCell1 = dialog.locator("table tbody tr td").first();
                if (await existingCell1.isVisible().catch(() => false)) {
                  const raw1 = await existingCell1.innerText().catch(() => "");
                  if (raw1) existingCandidates.push(raw1);
                }
              }
              const normExisting = existingCandidates
                .map((c) =>
                  c
                    .replace(/\s+/g, " ")
                    .trim()
                    .replace(/^-\s*(?:Đánh giá chung|General assessment|Nhận xét chung)\s*:\s*/i, "")
                    .trim()
                )
                .filter(Boolean);

              if (
                preSaveRecord.status === "VERIFIED" &&
                !isRetryPass &&
                normalizedExpectedPlain.length > 0 &&
                normExisting.length > 0 &&
                normExisting.every(
                  (actual) =>
                    actual === normalizedExpectedPlain || actual === normalizedExpectedRaw
                )
              ) {
                alreadySavedAndVerifiedInViewMode = true;
              } else {
                await savedRow.hover().catch(() => {});
                await page.waitForTimeout(300);

                const editBtn = dialog
                  .locator('button:has([data-testid="EditIcon"]), [aria-label="Edit"] button, button:has-text("Edit")')
                  .first();

                if (await editBtn.isVisible().catch(() => false)) {
                  await editBtn.click({ force: true });
                } else {
                  await savedRow.click({ force: true });
                }
                wasSwitchedFromViewMode = true;
                await page.waitForTimeout(800);
              }
            }

            // Case B: In by-areas mode (new comment)
            if (!alreadySavedAndVerifiedInViewMode) {
              isEditorVisible = await editor.isVisible().catch(() => false);
              if (!isEditorVisible) {
                const switchRoot = dialog.locator('.MuiSwitch-root, span:has(.MuiSwitch-input), [aria-label*="switch to manual mode" i]').first();
                if (await switchRoot.isVisible().catch(() => false)) {
                  await switchRoot.click({ force: true });
                  await page.waitForTimeout(800);

                  const confirmYes = page.locator('button:has-text("Yes"), button:has-text("Đồng ý")').first();
                  if (await confirmYes.isVisible().catch(() => false)) {
                    await confirmYes.click({ force: true });
                    await page.waitForTimeout(1200);
                  }
                }
              }
            }
          }

          if (alreadySavedAndVerifiedInViewMode) {
            await page.keyboard.press("Escape");
            await dialog.waitFor({ state: "hidden", timeout: 4000 }).catch(async () => {
              const backdrop = page.locator('.MuiBackdrop-root, [role="presentation"] > div').first();
              if (await backdrop.isVisible().catch(() => false)) {
                await backdrop.click({ force: true, position: { x: 20, y: 20 } }).catch(() => {});
              }
            });
            await page.waitForTimeout(600);
          } else {
          try {
            await editor.waitFor({ state: "visible", timeout: 8000 });
          } catch {
            await page.screenshot({ path: "data/debug_editor_not_found.png" }).catch(() => {});
            throw new Error(`Không tìm thấy ô soạn thảo nhận xét cho học viên '${studentName}'. (Ảnh: data/debug_editor_not_found.png)`);
          }

          // Fill comment into editor safely via DOM TextNodes + <strong> elements for **bold** (immune to HTML/XSS injection)
          await editor.click();
          await editor.evaluate((el, text) => {
            const rawText = String(text || "");
            if (typeof document !== "undefined" && typeof (el as HTMLElement).replaceChildren === "function") {
              (el as HTMLElement).replaceChildren();
              const lines = rawText
                .split(/\r?\n/)
                .map((l: string) => l.trim())
                .filter((l: string) => l.length > 0);
              const blocks = lines.length > 0 ? lines : [rawText];
              for (const line of blocks) {
                const pEl = document.createElement("p");
                const parts = line.split(/(\*\*[^*\n]+\*\*)/g);
                for (const part of parts) {
                  if (!part) continue;
                  if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
                    const strongEl = document.createElement("strong");
                    strongEl.appendChild(document.createTextNode(part.slice(2, -2)));
                    pEl.appendChild(strongEl);
                  } else {
                    pEl.appendChild(document.createTextNode(part));
                  }
                }
                el.appendChild(pEl);
              }
            } else {
              el.textContent = rawText.replace(/\*\*([^*\n]+)\*\*/g, "$1");
            }
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }, commentText);

          if (wasSwitchedFromViewMode && typeof page.keyboard?.insertText === "function") {
            await page.keyboard.press("End").catch(() => {});
            await page.keyboard.insertText(" ").catch(() => {});
            await page.keyboard.press("Backspace").catch(() => {});
          }

          await page.waitForTimeout(600);

          // Find save button
          const saveBtn = dialog.locator('button:has-text("Save"), button:has-text("Lưu")').first();
          if (!(await saveBtn.isVisible().catch(() => false))) {
            throw new Error(`Không tìm thấy nút 'Save' trong modal nhận xét của học viên '${studentName}'.`);
          }

          await interceptor.dismissForbiddenToast();

          // R16-05: Re-verify active roster, attendance eligibility, and CAS hash/content/status immediately before clicking Save
          const preClickRecord = getLatestFeedbackRecord(record.studentId);
          const preClickStudent = hasStudentRepoCheck
            ? studentRepo.findOne(record.studentId, classId)
            : student;
          const preClickRosterEligible =
            !hasStudentRepoCheck ||
            (Boolean(preClickStudent) &&
              (!preClickStudent?.classId || preClickStudent.classId === classId) &&
              preClickStudent?.isActive === 1);
          const preClickAttendance = preClickRecord?.attendanceStatus;
          const preClickAttendanceEligible =
            preClickAttendance === undefined ||
            preClickAttendance === null ||
            preClickAttendance === "PRESENT" ||
            preClickAttendance === "LATE";

          if (!preClickRosterEligible || !preClickAttendanceEligible) {
            if (preClickRecord && preClickRecord.status !== "DRAFT") {
              sessionFeedbackRepo.updateStatus(
                classId,
                sessionId,
                record.studentId,
                "DRAFT",
                null,
                "Học viên đã ngừng hoạt động hoặc chuyển sang vắng mặt trước khi bấm Save LMS.",
                approvedHash
              );
            }
            throw new Error(
              "IN_FLIGHT_DRIFT: Học viên đã ngừng hoạt động hoặc chuyển sang vắng mặt trước khi bấm Save LMS. Đã chặn gửi LMS và hạ về DRAFT."
            );
          }

          if (
            preClickRecord &&
            (preClickRecord.contentHash !== approvedHash ||
              (preClickRecord.finalText || "") !== approvedText ||
              preClickRecord.status === "DRAFT")
          ) {
            throw new Error(
              "IN_FLIGHT_DRIFT: Nhận xét đã bị chỉnh sửa hoặc hạ về bản nháp trước khi bấm Save LMS. Đã chặn gửi LMS."
            );
          }

          const preClickSlotCount =
            typeof (slotItem as any).count === "function"
              ? await (slotItem as any).count().catch(() => 0)
              : 1;
          const preClickSlotActive =
            preClickSlotCount > 0 &&
            (await slotItem.evaluate((el) => el.classList.contains("active")).catch(() => false));
          if (!preClickSlotActive) {
            throw new Error(
              `Buổi học số ${slotNumber} (#class-comments-slot-carousel-${slotIndex}) không còn tồn tại hoặc không còn ở trạng thái .active ngay trước khi bấm Save cho học viên '${studentName}'. Đã chặn thao tác để tránh lưu nhầm buổi học!`
            );
          }

          // Mark that Save mutation is being dispatched — never auto-retry in Pass 2 after this point
          saveMutationDispatched = true;

          // Wait strictly for the business API mutation response upon clicking save (no unrelated fallback)
          const [apiResponse] = await Promise.all([
            interceptor.waitForApiResponse(
              /lms-api\.mindx\.edu\.vn/i,
              {
                method: "POST",
                timeoutMs: 15000,
                operationName: /^(UpdateSlotComment|CreateSlotComment|SaveSlotComment|CommentMakeup)$/i,
                requestPredicate: (postData: string) => {
                  if (!postData) return false;
                  try {
                    const parsed = JSON.parse(postData);
                    const op = String(parsed?.operationName || "").trim();
                    if (!/^(UpdateSlotComment|CreateSlotComment|SaveSlotComment|CommentMakeup)$/i.test(op)) {
                      return false;
                    }
                    const rawVars = parsed?.variables;
                    if (!rawVars || typeof rawVars !== "object" || Array.isArray(rawVars)) {
                      return false;
                    }
                    if (
                      Object.prototype.hasOwnProperty.call(rawVars, "payload") &&
                      (!rawVars.payload || typeof rawVars.payload !== "object" || Array.isArray(rawVars.payload))
                    ) {
                      return false;
                    }
                    if (
                      Object.prototype.hasOwnProperty.call(rawVars, "input") &&
                      (!rawVars.input || typeof rawVars.input !== "object" || Array.isArray(rawVars.input))
                    ) {
                      return false;
                    }

                    const scopes = [
                      rawVars,
                      rawVars.payload,
                      rawVars.input,
                    ].filter((o) => o && typeof o === "object" && !Array.isArray(o));

                    let hasClassIdentifier = false;
                    let hasSessionIdentifier = false;
                    let hasStudentIdentifier = false;
                    const expectedCommentRawNorm = commentText.replace(/\s+/g, " ").trim();
                    const expectedCommentPlainNorm = commentText
                      .replace(/\*\*([^*\n]+)\*\*/g, "$1")
                      .replace(/\s+/g, " ")
                      .trim();
                    const normalizeCommentPayloadText = (rawStr: string) =>
                      rawStr
                        .replace(/<\/?(?:p|div|br|li|ul|ol)\s*\/?>/gi, " ")
                        .replace(/<\/?(?:strong|b|em|i|u|span)\b[^>]*>/gi, "")
                        .replace(/&nbsp;/gi, " ")
                        .replace(/&amp;/gi, "&")
                        .replace(/&lt;/gi, "<")
                        .replace(/&gt;/gi, ">")
                        .replace(/&quot;/gi, '"')
                        .replace(/&#39;|&apos;/gi, "'")
                        .replace(/\s+/g, " ")
                        .trim()
                        .replace(/^-\s*(?:Đánh giá chung|General assessment|Nhận xét chung)\s*:\s*/i, "")
                        .trim();
                    const isMongoObjectId = (v: string) => /^[a-f0-9]{24}$/i.test(v);

                    const studentCommentObj =
                      rawVars.payload?.studentComment || rawVars.input?.studentComment;
                    if (studentCommentObj && typeof studentCommentObj === "object") {
                      if (typeof studentCommentObj.studentId === "string" && studentCommentObj.studentId.trim()) {
                        hasStudentIdentifier = true;
                      }
                      if (typeof studentCommentObj.content === "string") {
                        const cleanedHtmlContent = normalizeCommentPayloadText(studentCommentObj.content);
                        if (
                          !cleanedHtmlContent ||
                          (cleanedHtmlContent !== expectedCommentRawNorm &&
                            cleanedHtmlContent !== expectedCommentPlainNorm)
                        ) {
                          return false;
                        }
                      }
                    }

                    for (const scope of scopes) {
                      for (const k of ["classCode", "classId", "className"]) {
                        if (Object.prototype.hasOwnProperty.call(scope, k)) {
                          const raw = scope[k];
                          if (typeof raw !== "string") return false;
                          const val = raw.trim().toUpperCase();
                          const isRealLmsClassId =
                            k === "classId" &&
                            isMongoObjectId(val) &&
                            !Object.prototype.hasOwnProperty.call(scope, "classCode");
                          if (!val || (!isRealLmsClassId && val !== classCode && val !== classId)) {
                            return false;
                          }
                          hasClassIdentifier = true;
                        }
                      }

                      for (const k of ["sessionId", "slotId"]) {
                        if (Object.prototype.hasOwnProperty.call(scope, k)) {
                          const raw = scope[k];
                          if (typeof raw !== "string") return false;
                          const val = raw.trim().toUpperCase();
                          const isRealLmsSlotId = k === "slotId" && isMongoObjectId(val);
                          if (!val || (!isRealLmsSlotId && val !== sessionId.toUpperCase())) {
                            return false;
                          }
                          hasSessionIdentifier = true;
                        }
                      }

                      for (const k of ["slotNumber", "sessionNumber"]) {
                        if (Object.prototype.hasOwnProperty.call(scope, k)) {
                          const raw = scope[k];
                          if (typeof raw !== "number" && typeof raw !== "string") return false;
                          const rawVal = String(raw).trim();
                          const num = Number(rawVal);
                          if (!rawVal || !Number.isFinite(num) || num !== slotNumber) {
                            return false;
                          }
                          hasSessionIdentifier = true;
                        }
                      }

                      if (Object.prototype.hasOwnProperty.call(scope, "slotIndex")) {
                        const raw = scope.slotIndex;
                        if (typeof raw !== "number" && typeof raw !== "string") return false;
                        const rawVal = String(raw).trim();
                        const idx = Number(rawVal);
                        if (!rawVal || !Number.isFinite(idx) || idx + 1 !== slotNumber) {
                          return false;
                        }
                        hasSessionIdentifier = true;
                      }

                      for (const k of ["studentId", "studentUid", "userId"]) {
                        if (Object.prototype.hasOwnProperty.call(scope, k)) {
                          const raw = scope[k];
                          if (typeof raw !== "string") return false;
                          const val = raw.trim();
                          const isRealLmsStudentId =
                            (k === "studentId" || k === "studentUid") && isMongoObjectId(val);
                          if (!val || (!isRealLmsStudentId && val !== record.studentId)) {
                            return false;
                          }
                          hasStudentIdentifier = true;
                        }
                      }

                      for (const k of ["comment", "content", "note", "feedback"]) {
                        if (Object.prototype.hasOwnProperty.call(scope, k)) {
                          const raw = scope[k];
                          if (typeof raw !== "string") return false;
                          const val = normalizeCommentPayloadText(raw);
                          if (
                            !val ||
                            (val !== expectedCommentRawNorm && val !== expectedCommentPlainNorm)
                          ) {
                            return false;
                          }
                        }
                      }
                    }

                    // Must carry at least one concrete target entity identifier (never accept comment-only or empty payload)
                    if (!hasClassIdentifier && !hasSessionIdentifier && !hasStudentIdentifier) {
                      return false;
                    }
                    return true;
                  } catch {
                    return false;
                  }
                },
              }
            ),
            saveBtn.click({ force: true }),
          ]);

          // Check HTTP status AND ensure no GraphQL errors inside HTTP 200 payload
          let apiSuccess = Boolean(
            apiResponse && (apiResponse.status() === 200 || apiResponse.status() === 201)
          );
          if (apiSuccess && typeof (apiResponse as any).json === "function") {
            const respBody = await (apiResponse as any).json().catch(() => null);
            if (respBody && Array.isArray(respBody.errors) && respBody.errors.length > 0) {
              apiSuccess = false;
            }
          }

          await page.waitForTimeout(1000);

          // 7. READ-AFTER-WRITE VERIFICATION (Iron Rule 3)
          // Re-open the comment modal, read back the rendered comment from the LMS DOM,
          // and strictly verify the ENTIRE normalized content equals approvedText (exact equality, never substring/includes or partial line split).
          await dialog.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
          await interceptor.dismissForbiddenToast();
          await page.waitForTimeout(500);

          const resolveVerifyOpenBtn = async () => {
            if (fallbackMatchedRow !== null) {
              const postSaveRows = drawer.locator('.comment-list-table table tbody tr, table tbody tr');
              const postSaveCount =
                typeof (postSaveRows as any).count === "function"
                  ? await (postSaveRows as any).count().catch(() => 0)
                  : 0;
              for (let rIdx = 0; rIdx < postSaveCount; rIdx++) {
                const candidateRow = postSaveRows.nth(rIdx);
                const rawRowText = (await candidateRow.innerText().catch(() => "")).normalize("NFC");
                const cleanedMultiline = rawRowText
                  .split(/[\r\n\t|]+/)
                  .map((line: string) => line.replace(/\s+/g, " ").trim())
                  .filter(Boolean)
                  .join("\n");
                if (exactNameLineRegex.test(cleanedMultiline)) {
                  return candidateRow
                    .locator('button:has-text("Nhận xét học sinh"), button:has-text("Nhận xét")')
                    .first();
                }
              }
            }
            return openCommentBtn;
          };

          let verifyDialogErr: unknown = null;
          for (let verifyAttempt = 1; verifyAttempt <= 3; verifyAttempt++) {
            try {
              if (verifyAttempt > 1) {
                await interceptor.dismissForbiddenToast();
                await page.waitForTimeout(600);
              }
              const verifyOpenBtn = await resolveVerifyOpenBtn();
              await verifyOpenBtn.scrollIntoViewIfNeeded().catch(() => {});
              await page.waitForTimeout(250);
              await verifyOpenBtn.click({ force: true });
              await dialog.waitFor({ state: "visible", timeout: 5000 });
              verifyDialogErr = null;
              break;
            } catch (err) {
              verifyDialogErr = err;
              if (verifyAttempt >= 2) {
                const fallbackBtn = await resolveVerifyOpenBtn();
                await fallbackBtn
                  .evaluate((el: any) => {
                    if (el && typeof (el as HTMLElement).click === "function") {
                      (el as HTMLElement).click();
                    }
                  })
                  .catch(() => {});
                try {
                  await dialog.waitFor({ state: "visible", timeout: 4000 });
                  verifyDialogErr = null;
                  break;
                } catch (evalErr) {
                  verifyDialogErr = evalErr;
                }
              }
            }
          }
          if (verifyDialogErr) {
            throw verifyDialogErr;
          }
          await page.waitForTimeout(600);

          const candidates: string[] = [];
          const editorLoc = dialog
            .locator('.ql-editor[contenteditable="true"], .comment-content')
            .first();
          if (await editorLoc.isVisible().catch(() => false)) {
            const editorReadback = await editorLoc.innerText().catch(() => "");
            if (editorReadback) candidates.push(editorReadback);
          }

          const cell2Loc = dialog.locator("table tbody tr td:nth-child(2)").first();
          if (await cell2Loc.isVisible().catch(() => false)) {
            const cellReadback = await cell2Loc.innerText().catch(() => "");
            if (cellReadback) candidates.push(cellReadback);
          }

          // Real MindX LMS view-mode modal renders a single-column table (`table tbody tr td`) prefixed with "- Đánh giá chung: "
          if (candidates.length === 0) {
            const cell1Loc = dialog.locator("table tbody tr td").first();
            if (await cell1Loc.isVisible().catch(() => false)) {
              const rawCell1 = await cell1Loc.innerText().catch(() => "");
              const strippedCell1 = rawCell1
                .replace(/^-\s*(?:Đánh giá chung|General assessment|Nhận xét chung)\s*:\s*/i, "")
                .trim();
              if (strippedCell1) candidates.push(strippedCell1);
            }
          }

          const normalizedCandidates = candidates
            .map((c) =>
              c
                .replace(/\s+/g, " ")
                .trim()
                .replace(/^-\s*(?:Đánh giá chung|General assessment|Nhận xét chung)\s*:\s*/i, "")
                .trim()
            )
            .filter(Boolean);

          const isMatch =
            normalizedExpectedPlain.length > 0 &&
            normalizedCandidates.length > 0 &&
            normalizedCandidates.every(
              (actual) =>
                actual === normalizedExpectedPlain || actual === normalizedExpectedRaw
            );

          // Close modal by pressing Escape
          await page.keyboard.press("Escape");
          await dialog.waitFor({ state: "hidden", timeout: 4000 }).catch(async () => {
            const backdrop = page.locator('.MuiBackdrop-root, [role="presentation"] > div').first();
            if (await backdrop.isVisible().catch(() => false)) {
              await backdrop.click({ force: true, position: { x: 20, y: 20 } }).catch(() => {});
            }
          });
          await page.waitForTimeout(600);

          // BOTH business API response AND full DOM readback must succeed
          if (!apiSuccess || !isMatch) {
            throw new Error(
              `Không thể xác minh nội dung sau khi lưu (Read-after-Write check failed: apiSuccess=${apiSuccess}, isContentMatch=${isMatch}).`
            );
          }
          }

          // Re-verify in-flight CAS hash lock and roster/attendance eligibility before marking VERIFIED
          const postSaveRecord = getLatestFeedbackRecord(record.studentId);
          const postSaveStudent = hasStudentRepoCheck
            ? studentRepo.findOne(record.studentId, classId)
            : student;
          const postRosterEligible =
            !hasStudentRepoCheck ||
            (Boolean(postSaveStudent) &&
              (!postSaveStudent?.classId || postSaveStudent.classId === classId) &&
              postSaveStudent?.isActive === 1);
          const postAttendance = postSaveRecord?.attendanceStatus;
          const postAttendanceEligible =
            postAttendance === undefined ||
            postAttendance === null ||
            postAttendance === "PRESENT" ||
            postAttendance === "LATE";

          if (!postRosterEligible || !postAttendanceEligible) {
            if (postSaveRecord && postSaveRecord.status !== "DRAFT") {
              sessionFeedbackRepo.updateStatus(
                classId,
                sessionId,
                record.studentId,
                "DRAFT",
                null,
                "Học viên đã ngừng hoạt động hoặc chuyển sang vắng mặt trong lúc đang lưu.",
                approvedHash
              );
            }
            throw new Error(
              "IN_FLIGHT_DRIFT: Học viên đã ngừng hoạt động hoặc chuyển sang vắng mặt trong lúc đang lưu. Hạ trạng thái về DRAFT."
            );
          }

          if (
            postSaveRecord &&
            (postSaveRecord.contentHash !== approvedHash ||
              (postSaveRecord.finalText || "") !== approvedText ||
              postSaveRecord.status === "DRAFT")
          ) {
            throw new Error(
              "IN_FLIGHT_DRIFT: Nhận xét đã bị giáo viên chỉnh sửa thành bản nháp mới trong lúc đang lưu. Giữ nguyên trạng thái DRAFT."
            );
          }

          // Mark as VERIFIED in SQLite locked by approvedHash
          const verifiedAt = new Date().toISOString();
          sessionFeedbackRepo.updateStatus(
            classId,
            sessionId,
            record.studentId,
            "VERIFIED",
            verifiedAt,
            null,
            approvedHash
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

          return {
            studentId: record.studentId,
            fullName: studentName,
            success: true,
            verified: true,
          };
        } catch (itemErr: any) {
          await page.screenshot({ path: "data/debug_save_comment_error.png" }).catch(() => {});
          // Only press Escape if a comment modal dialog is actually open (pressing Escape when no modal is open closes the MUI Class Drawer!)
          await LmsHelpers.ensureCleanDialogAndToast(page, interceptor).catch(() => {});
          const errMsg = itemErr instanceof Error ? itemErr.message : String(itemErr);

          // Only mark FAILED if the record was NOT concurrently edited into a new DRAFT while saving
          const latestOnError = getLatestFeedbackRecord(record.studentId);
          const wasEditedDuringSave =
            latestOnError &&
            (latestOnError.contentHash !== approvedHash ||
              (latestOnError.finalText || "") !== approvedText ||
              latestOnError.status === "DRAFT");

          if (!wasEditedDuringSave) {
            sessionFeedbackRepo.updateStatus(
              classId,
              sessionId,
              record.studentId,
              "FAILED",
              null,
              errMsg,
              approvedHash
            );
          }

          jobLogRepo.add({
            jobId,
            jobType: "SAVE_COMMENTS",
            classId,
            sessionId,
            studentId: record.studentId,
            level: isRetryPass ? "ERROR" : "WARN",
            message: `Lỗi khi lưu nhận xét của '${studentName}'${isRetryPass ? " (Lượt 2)" : ""}: ${errMsg}`,
          });

          if (!isRetryPass && !saveMutationDispatched && isRetryablePreSaveUiError(errMsg)) {
            preSaveRetryEligibleIds.add(record.studentId);
          } else {
            preSaveRetryEligibleIds.delete(record.studentId);
          }

          return {
            studentId: record.studentId,
            fullName: studentName,
            success: false,
            verified: false,
            error: errMsg,
          };
        }
      };

      // Pass 1: Run through all candidate records
      for (const record of validRecords) {
        const itemRes = await processSingleStudentRecord(record, false);
        results.push(itemRes);
      }

      // Pass 2 (Auto-Retry): Automatically retry ONLY records that failed before Save was clicked
      const retryCandidates = validRecords.filter((rec) => {
        const resItem = results.find((r) => r.studentId === rec.studentId);
        return (
          resItem &&
          !resItem.success &&
          preSaveRetryEligibleIds.has(rec.studentId) &&
          isRetryablePreSaveUiError(resItem.error)
        );
      });

      if (retryCandidates.length > 0) {
        jobLogRepo.add({
          jobId,
          jobType: "SAVE_COMMENTS",
          classId,
          sessionId,
          level: "INFO",
          message: `Đang tự động chạy vét lại (Lượt 2) cho ${retryCandidates.length} học viên bị nghẽn giao diện ở lượt đầu...`,
        });
        await LmsHelpers.ensureCleanDialogAndToast(page, interceptor);
        await LmsHelpers.ensureCommentsSlotReady(page, classCode, slotNumber, {
          reopenDrawerIfClosed: true,
          waitForTableMs: 5000,
        });
        for (const rec of retryCandidates) {
          const retryRes = await processSingleStudentRecord(rec, true);
          const idx = results.findIndex((r) => r.studentId === rec.studentId);
          if (idx >= 0) {
            results[idx] = retryRes;
          }
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
      throw new Error(globalError);
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
