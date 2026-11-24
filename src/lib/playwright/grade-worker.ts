import { BrowserManager } from "./browser-manager";
import { authService } from "./auth";
import { LmsHelpers } from "./lms-helpers";
import { SELECTORS } from "./selectors";
import { createNetworkInterceptor } from "./network-interceptor";
import {
  homeworkSubmissionRepo,
  studentRepo,
  scoreMatrixRepo,
  jobLogRepo,
  verifyHomeworkContentIntegrity,
  isRoboticsClassCode,
  type HomeworkSubmissionRecord,
} from "../db/sqlite";
import { getLmsClassIdsMap } from "../db/json-config";
import { normalizeVietnameseName } from "../utils/vietnamese-match";
import {
  getCheckpointStageFromSessionNumber,
  isDedicatedCheckpointColumn,
  resolveTargetMatrixColumn,
  stripMindxUploadTimestampPrefix,
} from "../checkpoint/checkpoint-column-resolver";

export interface GradeWorkerOptions {
  classId: string;
  classCode: string;
  sessionId: string;
  lessonId?: string;
  submissionId?: string; // Optional: save only 1 specific submission
}

export interface GradeWorkerItemResult {
  submissionId: string;
  studentId: string;
  fullName: string;
  decision: "GRADE" | "REDO";
  effectiveScore: number;
  success: boolean;
  verified: boolean;
  error?: string;
}

export interface GradeWorkerBatchResult {
  classId: string;
  classCode: string;
  sessionId: string;
  totalCandidates: number;
  savedCount: number;
  verifiedCount: number;
  failedCount: number;
  results: GradeWorkerItemResult[];
}

function stripHtmlToComparableText(raw?: string | null): string {
  if (!raw) return "";
  return String(raw)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtmlEntitiesPlain(raw: string): string {
  return raw
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function normalizeComparableNoteText(raw?: string | null): string {
  if (!raw) return "";
  const decoded = decodeHtmlEntitiesPlain(
    String(raw)
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  );
  return decoded
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function normalizePlainEditorText(raw?: string | null): string {
  if (!raw) return "";
  return String(raw)
    .replace(/\u00A0/g, " ")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

interface SafeNoteRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

function parseFeedbackHtmlToSafeBlocks(rawHtml?: string | null): SafeNoteRun[][] {
  const src = String(rawHtml || "").trim();
  if (!src) return [];
  const blockNormalized = src
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*(p|div|li)\b[^>]*>/gi, "\n")
    .replace(/<\/\s*(p|div|li|ul|ol)\s*>/gi, "\n");
  const rawLines = blockNormalized
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const blocks: SafeNoteRun[][] = [];
  for (const line of rawLines) {
    const runs: SafeNoteRun[] = [];
    let bold = false;
    let italic = false;
    let code = false;
    const tokenRegex = /<(\/?)(strong|b|em|i|code)\b[^>]*>|([^<]+)|<[^>]+>/gi;
    let m: RegExpExecArray | null;
    while ((m = tokenRegex.exec(line)) !== null) {
      if (m[2]) {
        const closing = m[1] === "/";
        const tag = m[2].toLowerCase();
        if (tag === "strong" || tag === "b") bold = !closing;
        else if (tag === "em" || tag === "i") italic = !closing;
        else if (tag === "code") code = !closing;
      } else if (m[3]) {
        const txt = decodeHtmlEntitiesPlain(m[3]).replace(/[ \t]+/g, " ");
        if (txt) {
          runs.push({ text: txt, bold, italic, code });
        }
      }
    }
    const lineJoined = runs
      .map((r) => r.text)
      .join("")
      .trim();
    if (lineJoined.length > 0) {
      blocks.push(runs);
    }
  }
  return blocks;
}

export class HomeworkGradeWorker {
  /**
   * Pushes APPROVED homework grades & feedback to MindX LMS Submission Modal
   * and performs strict Network API + Read-after-Write DOM Verification before marking VERIFIED.
   */
  public static async saveApprovedGrades(
    options: GradeWorkerOptions
  ): Promise<GradeWorkerBatchResult> {
    const classId = String(options.classId || "").trim().toUpperCase();
    const classCode = String(options.classCode || "").trim().toUpperCase();
    const sessionId = String(options.sessionId || "").trim();
    const jobId = `grade_worker_${classCode}_${sessionId}_${Date.now()}`;

    if (!classId || !classCode || classId !== classCode) {
      const msg = `[HomeworkGradeWorker] Mã định danh lớp (classId='${classId}') không khớp với mã lớp LMS (classCode='${classCode}'). Đã chặn thao tác.`;
      jobLogRepo.add({
        jobId,
        jobType: "SAVE_HOMEWORK_GRADES",
        classId,
        sessionId,
        level: "ERROR",
        message: msg,
      });
      throw new Error(msg);
    }

    if (isRoboticsClassCode(classCode)) {
      const msg = `[HomeworkGradeWorker] Lớp Robotics (${classCode}) kiểm tra trên giấy, không đẩy điểm qua Tab Chấm bài (#tab-3) trên LMS.`;
      jobLogRepo.add({
        jobId,
        jobType: "SAVE_HOMEWORK_GRADES",
        classId,
        sessionId,
        level: "ERROR",
        message: msg,
      });
      throw new Error(msg);
    }

    const escapedClassId = classId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const exactSessionRegex = new RegExp(`^${escapedClassId}_SESS_(\\d+)$`, "i");
    const sessionMatch = sessionId.match(exactSessionRegex);
    if (!sessionMatch) {
      const msg = `[HomeworkGradeWorker] Mã buổi học '${sessionId}' không thuộc đúng lớp '${classId}' (Yêu cầu ${classId}_SESS_XX).`;
      jobLogRepo.add({
        jobId,
        jobType: "SAVE_HOMEWORK_GRADES",
        classId,
        sessionId,
        level: "ERROR",
        message: msg,
      });
      throw new Error(msg);
    }

    const sessionNumber = parseInt(sessionMatch[1], 10);

    // 1. Load candidate submissions from SQLite
    let candidates: HomeworkSubmissionRecord[] = [];
    if (options.submissionId) {
      const one = homeworkSubmissionRepo.findBySubmissionId(options.submissionId);
      if (one) {
        if (one.classId !== classId || one.sessionId !== sessionId) {
          throw new Error(
            `[Integrity Violation] submissionId '${options.submissionId}' thuộc (${one.classId}, ${one.sessionId}), không thuộc (${classId}, ${sessionId}).`
          );
        }
        candidates = [one];
      }
    } else {
      candidates = homeworkSubmissionRepo.findBySession(classId, sessionId);
    }

    const actionable = candidates.filter(
      (r) =>
        r.status === "APPROVED" ||
        (r.status === "FAILED" && Boolean(r.contentHash))
    );

    if (actionable.length === 0) {
      jobLogRepo.add({
        jobId,
        jobType: "SAVE_HOMEWORK_GRADES",
        classId,
        sessionId,
        level: "WARN",
        message: "Không có bài nộp nào ở trạng thái ĐÃ DUYỆT (APPROVED) để lưu điểm lên LMS.",
      });
      return {
        classId,
        classCode,
        sessionId,
        totalCandidates: candidates.length,
        savedCount: 0,
        verifiedCount: 0,
        failedCount: 0,
        results: [],
      };
    }

    const browserManager = BrowserManager.getInstance();
    const page = await browserManager.getPage();
    const interceptor = createNetworkInterceptor(page);

    const results: GradeWorkerItemResult[] = [];
    let savedCount = 0;
    let verifiedCount = 0;
    let failedCount = 0;

    try {
      await authService.ensureAuthenticated("LMS");
      await LmsHelpers.openClassDrawer(page, classCode);
      await LmsHelpers.switchDrawerTab(page, SELECTORS.tabs.grading);
      await page.waitForTimeout?.(800);
      await interceptor.dismissForbiddenToast();

      // Determine column index from cached score matrix if available (strictly enforcing session <-> lesson mapping, including CP1/CP2)
      let colIndex = Math.max(0, sessionNumber - 1);
      let hasVerifiedLessonMapping = !options.lessonId;
      let expectedLessonId = options.lessonId ? String(options.lessonId).trim() : "";
      let expectedTotalColumns = 0;
      let expectedLmsClassId = "";
      try {
        expectedLmsClassId = String(getLmsClassIdsMap()?.[classCode] || "").trim();
      } catch {}
      let isCheckpointColumn =
        getCheckpointStageFromSessionNumber(classCode, sessionNumber) !== null;
      const matrixStudentUidById = new Map<string, string>();
      const matrixNormNameCounts = new Map<string, number>();

      if (typeof scoreMatrixRepo?.findByClass === "function") {
        const cached = scoreMatrixRepo.findByClass(classId);
        if (cached?.matrix?.lmsClassId) {
          expectedLmsClassId = String(cached.matrix.lmsClassId).trim() || expectedLmsClassId;
        }
        const rows = cached?.matrix?.rows;
        if (Array.isArray(rows)) {
          for (const r of rows) {
            if (r?.studentId && r?.studentUid) {
              matrixStudentUidById.set(String(r.studentId), String(r.studentUid));
            }
            if (r?.isActive !== false && r?.fullName) {
              const nn = normalizeVietnameseName(String(r.fullName));
              if (nn) matrixNormNameCounts.set(nn, (matrixNormNameCounts.get(nn) || 0) + 1);
            }
          }
        }
        const cols = cached?.matrix?.columns;
        if (Array.isArray(cols) && cols.length > 0) {
          expectedTotalColumns = cols.length;
          const colRes = resolveTargetMatrixColumn(
            cols,
            classCode,
            sessionNumber,
            options.lessonId
          );
          if (colRes.mismatchError) {
            throw new Error(`[Integrity Violation] ${colRes.mismatchError}`);
          }
          if (!colRes.column) {
            throw new Error(
              `[HomeworkGradeWorker] Không tìm thấy cột bài tập của Buổi ${sessionNumber} trên bảng điểm LMS lớp ${classCode}.`
            );
          }
          colIndex = colRes.column.colIndex;
          expectedLessonId = String(colRes.column.lessonId || colRes.column.columnId || "").trim();
          isCheckpointColumn = isDedicatedCheckpointColumn(colRes.column);
          hasVerifiedLessonMapping = true;
        }
      }

      const activeDbStudents =
        typeof studentRepo?.findByClass === "function"
          ? studentRepo.findByClass(classId, true)
          : [];
      const dbNormNameCounts = new Map<string, number>();
      for (const s of activeDbStudents) {
        const nn = normalizeVietnameseName(String(s.fullName || ""));
        if (nn) dbNormNameCounts.set(nn, (dbNormNameCounts.get(nn) || 0) + 1);
      }

      for (const initialRecord of actionable) {
        if ((process as any).__mindxQueueStopped === true) {
          break;
        }
        const subId = initialRecord.submissionId;
        const stuId = initialRecord.studentId;
        const dbStudent =
          typeof studentRepo?.findOne === "function"
            ? studentRepo.findOne(stuId, classId)
            : undefined;
        const fullName = dbStudent?.fullName || stuId;

        // Re-read fresh record from SQLite before starting
        const freshRecord = homeworkSubmissionRepo.findBySubmissionId(subId) || initialRecord;
        const approvedHash = freshRecord.contentHash || "";
        const effectiveScore =
          typeof freshRecord.teacherOverrideScore === "number" &&
          Number.isFinite(freshRecord.teacherOverrideScore)
            ? freshRecord.teacherOverrideScore
            : Number(freshRecord.calculatedScore ?? 0);
        const decision: "GRADE" | "REDO" = freshRecord.decision === "REDO" ? "REDO" : "GRADE";

        try {
          if (options.lessonId && !hasVerifiedLessonMapping) {
            throw new Error(
              `[Integrity Violation] Không có bảng ánh xạ cột bài tập (scoreMatrix) để xác minh lessonId='${options.lessonId}' thuộc buổi '${sessionId}'. Đã chặn thao tác đoán cột.`
            );
          }

          // Guardrail A: Reject PARSE_ERROR submissions
          if (freshRecord.parseStatus === "PARSE_ERROR") {
            throw new Error(
              `Bài nộp '${subId}' đang ở trạng thái PARSE_ERROR, cấm tự động ghi điểm hoặc yêu cầu làm lại lên LMS.`
            );
          }

          // Guardrail B: Verify student belongs to class
          if (
            dbStudent &&
            dbStudent.classId &&
            String(dbStudent.classId).trim().toUpperCase() !== classId
          ) {
            throw new Error(
              `[Integrity Violation] Học viên '${stuId}' không thuộc lớp '${classId}'.`
            );
          }

          // Guardrail C: Verify contentHash integrity before touching browser
          if (!verifyHomeworkContentIntegrity(freshRecord)) {
            homeworkSubmissionRepo.upsert({
              ...freshRecord,
              status: "WAITING_APPROVAL",
              verifiedAt: null,
              errorMessage:
                "Nội dung điểm hoặc nhận xét đã thay đổi sau khi duyệt (Hash Drift). Vui lòng duyệt lại.",
            });
            throw new Error(
              `Nội dung chấm bài '${subId}' của '${fullName}' đã bị chỉnh sửa sau khi duyệt (Hash Drift). Đã hạ về WAITING_APPROVAL.`
            );
          }

          if (!Number.isFinite(effectiveScore) || effectiveScore < 0 || effectiveScore > 100) {
            throw new Error(
              `Điểm số của '${fullName}' (${effectiveScore}) không hợp lệ (ngoài khoảng 0-100).`
            );
          }

          if (isCheckpointColumn && decision === "REDO") {
            throw new Error(
              `Bài kiểm tra Checkpoint của '${fullName}' trên MindX LMS khóa tùy chọn Yêu cầu làm lại (REDO). Chỉ hỗ trợ Chấm điểm (MARK).`
            );
          }

          if (isCheckpointColumn && !Number.isInteger(effectiveScore)) {
            throw new Error(
              `Điểm chấm Checkpoint của '${fullName}' trên MindX LMS bắt buộc là số nguyên 0..100 (hiện tại: ${effectiveScore}).`
            );
          }

          const intScore = Math.round(effectiveScore);

          // Ensure no leftover dialog or toast is open before locating student row & target cell on LMS #tabpanel-3
          await LmsHelpers.ensureCleanDialogAndToast(page, interceptor);

          const drawer = page
            .locator('div[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight')
            .first();
          const panel3 = drawer.locator("#tabpanel-3").first();
          const context = (await panel3.isVisible().catch(() => false)) ? panel3 : drawer;

          const hasLegacyTable =
            (await context.locator("table tbody tr").count().catch(() => 0)) > 0;

          if (!hasLegacyTable) {
            // =========================================================================
            // REAL MINDX LMS #tabpanel-3 DIV GRID + MarkStudentSubmission / RequestRedoSubmission
            // =========================================================================
            if (!Number.isInteger(effectiveScore)) {
              throw new Error(
                `Điểm chấm của '${fullName}' trên MindX LMS (#tabpanel-3) bắt buộc là số nguyên 0..100 (hiện tại: ${effectiveScore}).`
              );
            }
            if (dbStudent && dbStudent.isActive === 0) {
              throw new Error(
                `Học viên '${fullName}' (${stuId}) không còn ở trạng thái active trong lớp ${classCode}.`
              );
            }

            const targetNormName = normalizeVietnameseName(fullName);
            if (!targetNormName) {
              throw new Error(`Tên học viên '${fullName}' (${stuId}) không hợp lệ để đối chiếu trên LMS.`);
            }

            if (
              (dbNormNameCounts.get(targetNormName) || 0) > 1 ||
              (matrixNormNameCounts.get(targetNormName) || 0) > 1
            ) {
              throw new Error(
                `Phát hiện nhiều học viên trùng tên '${fullName}' trong lớp ${classCode}. Đã chặn tự động chấm trên #tabpanel-3 để tránh nhầm người.`
              );
            }

            const tagAndScanLmsRows = async (): Promise<
              Array<{ idx: number; startText: string; cellCount: number }>
            > => {
              return context.evaluate((rootEl: Element) => {
                rootEl
                  .querySelectorAll("[data-mindx-sub-row-idx]")
                  .forEach((el) => el.removeAttribute("data-mindx-sub-row-idx"));
                const expandSel =
                  'svg[data-testid="ExpandMoreIcon"], svg[data-testid="ExpandLessIcon"]';
                const candidates = Array.from(rootEl.querySelectorAll("div"));
                const out: Array<{ idx: number; startText: string; cellCount: number }> = [];
                for (const el of candidates) {
                  if (
                    el.children.length >= 2 &&
                    Boolean(el.children[0].querySelector(expandSel)) &&
                    !el.children[1].querySelector(expandSel)
                  ) {
                    const idx = out.length;
                    el.setAttribute("data-mindx-sub-row-idx", String(idx));
                    out.push({
                      idx,
                      startText: (el.children[0].textContent || "").trim(),
                      cellCount: el.children.length,
                    });
                  }
                }
                return out;
              });
            };

            let scannedRows = await tagAndScanLmsRows().catch(() => []);
            let matchingRows = scannedRows.filter(
              (r) => normalizeVietnameseName(r.startText) === targetNormName
            );
            if (matchingRows.length === 0) {
              await LmsHelpers.ensureCleanDialogAndToast(page, interceptor);
              await LmsHelpers.switchDrawerTab(page, SELECTORS.tabs.grading).catch(() => {});
              await page.waitForTimeout?.(500);
              scannedRows = await tagAndScanLmsRows().catch(() => []);
              matchingRows = scannedRows.filter(
                (r) => normalizeVietnameseName(r.startText) === targetNormName
              );
            }

            if (matchingRows.length === 0) {
              throw new Error(
                `Không tìm thấy dòng của học viên '${fullName}' (${stuId}) trên bảng Chấm bài (#tabpanel-3) lớp ${classCode}.`
              );
            }
            if (matchingRows.length > 1) {
              throw new Error(
                `Phát hiện ${matchingRows.length} dòng trùng tên '${fullName}' trên bảng Chấm bài (#tabpanel-3). Đã chặn thao tác để tránh chấm nhầm!`
              );
            }

            const matchedRow = matchingRows[0];
            if (
              colIndex + 1 >= matchedRow.cellCount ||
              (expectedTotalColumns > 0 && matchedRow.cellCount !== expectedTotalColumns + 1)
            ) {
              throw new Error(
                `Số cột trên DOM #tabpanel-3 (${matchedRow.cellCount - 1} cột bài tập) không khớp với bảng điểm lớp ${classCode} (cần truy cập cột index=${colIndex}, tổng=${expectedTotalColumns}). Vui lòng bấm Quét lại điểm LMS.`
              );
            }

            const lmsCell = context
              .locator(`[data-mindx-sub-row-idx="${matchedRow.idx}"] > div`)
              .nth(colIndex + 1);
            await lmsCell.scrollIntoViewIfNeeded().catch(() => {});

            const preExpandText = (await lmsCell.innerText().catch(() => ""))
              .replace(/\s+/g, " ")
              .trim();
            if (
              /not\s*submit|chưa\s*nộp|student\s*not\s*submitted|học\s*sinh\s*chưa\s*nộp|no\s*practice|không\s*có\s*bài\s*thực\s*hành/i.test(
                preExpandText
              )
            ) {
              throw new Error(
                `Học viên '${fullName}' chưa nộp bài trên LMS ở cột này ('${preExpandText}').`
              );
            }

            const actionBtnSelector = SELECTORS.grading.lmsTabPanel3.cellActionBtn;
            if ((await lmsCell.locator(actionBtnSelector).count().catch(() => 0)) === 0) {
              await lmsCell.click({ force: true });
              await page.waitForTimeout?.(350);
              if ((await lmsCell.locator(actionBtnSelector).count().catch(() => 0)) === 0) {
                await LmsHelpers.ensureCleanDialogAndToast(page, interceptor);
                await lmsCell.scrollIntoViewIfNeeded().catch(() => {});
                await lmsCell.click({ force: true });
                await page.waitForTimeout?.(400);
              }
            }

            const actionBtns = lmsCell.locator(actionBtnSelector);
            const actionBtnCount = await actionBtns.count().catch(() => 0);
            if (actionBtnCount === 0) {
              const curCellTxt = (await lmsCell.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
              throw new Error(
                `Không tìm thấy nút Chấm bài/Chỉnh sửa (Mark/Update) khả dụng cho '${fullName}' (ô hiện tại: '${curCellTxt}').`
              );
            }

            const expectedFileTokens = Array.from(
              new Set(
                String(freshRecord.originalFileName || "")
                  .split(",")
                  .flatMap((f) => {
                    const base = stripMindxUploadTimestampPrefix(f).trim().toLowerCase();
                    if (!base) return [];
                    try {
                      return [base, decodeURIComponent(base)];
                    } catch {
                      return [base];
                    }
                  })
                  .filter(Boolean)
              )
            );

            const dialogMatchesExpectedAttachment = (txt: string): boolean => {
              if (expectedFileTokens.length === 0) return true;
              const lower = txt.toLowerCase();
              let lowerDecoded = lower;
              try {
                lowerDecoded = decodeURIComponent(lower);
              } catch {}
              return expectedFileTokens.some(
                (tok) => lower.includes(tok) || lowerDecoded.includes(tok)
              );
            };

            const lmsDialogSelector = SELECTORS.grading.lmsTabPanel3.dialog;
            let lmsDialog = page.locator(lmsDialogSelector).last();

            const openTaskModalAt = async (btnIndex: number) => {
              const btn = actionBtns.nth(btnIndex);
              await btn.scrollIntoViewIfNeeded().catch(() => {});
              await btn.click({ force: true });
              await page.waitForTimeout?.(350);
              lmsDialog = page.locator(lmsDialogSelector).last();
              try {
                await lmsDialog.waitFor({ state: "visible", timeout: 6000 });
              } catch {
                await LmsHelpers.ensureCleanDialogAndToast(page, interceptor);
                await btn.scrollIntoViewIfNeeded().catch(() => {});
                await btn.click({ force: true });
                await page.waitForTimeout?.(350);
                lmsDialog = page.locator(lmsDialogSelector).last();
                await lmsDialog.waitFor({ state: "visible", timeout: 6000 });
              }
            };

            let selectedBtnIdx = 0;
            await openTaskModalAt(0);
            let lmsDialogText = (await lmsDialog.innerText().catch(() => "")).trim();

            if (
              actionBtnCount > 1 &&
              expectedFileTokens.length > 0 &&
              !dialogMatchesExpectedAttachment(lmsDialogText)
            ) {
              let matchedAlt = false;
              await page.keyboard?.press?.("Escape").catch(() => {});
              await page.waitForTimeout?.(250);
              for (let altIdx = 1; altIdx < actionBtnCount; altIdx++) {
                await openTaskModalAt(altIdx);
                const altText = (await lmsDialog.innerText().catch(() => "")).trim();
                if (dialogMatchesExpectedAttachment(altText)) {
                  selectedBtnIdx = altIdx;
                  lmsDialogText = altText;
                  matchedAlt = true;
                  break;
                }
                await page.keyboard?.press?.("Escape").catch(() => {});
                await page.waitForTimeout?.(250);
              }
              if (!matchedAlt) {
                throw new Error(
                  `Không tìm thấy bài thực hành khớp tệp '${freshRecord.originalFileName}' của '${fullName}' trên LMS (#tabpanel-3). Đã hủy thao tác an toàn.`
                );
              }
            }

            if (
              !lmsDialogText ||
              !lmsDialogText.toUpperCase().includes(classCode) ||
              !normalizeVietnameseName(lmsDialogText).includes(targetNormName)
            ) {
              await page.keyboard?.press?.("Escape").catch(() => {});
              throw new Error(
                `Modal chấm bài trên LMS không khớp định danh lớp '${classCode}' và học viên '${fullName}'. Đã đóng modal để tránh chấm nhầm!`
              );
            }

            if (
              expectedFileTokens.length > 0 &&
              /\bsubmission\b|bài\s*nộp/i.test(lmsDialogText) &&
              !/link\s*submission|link\s*bài\s*tập/i.test(lmsDialogText) &&
              !dialogMatchesExpectedAttachment(lmsDialogText)
            ) {
              await page.keyboard?.press?.("Escape").catch(() => {});
              throw new Error(
                `Tệp đính kèm trên Modal LMS của '${fullName}' không khớp với tệp đã duyệt ('${freshRecord.originalFileName}'). Đã đóng modal an toàn.`
              );
            }

            const plainNote = normalizeComparableNoteText(freshRecord.feedbackHtml);
            const safeNoteBlocks = parseFeedbackHtmlToSafeBlocks(freshRecord.feedbackHtml);
            if (!plainNote || safeNoteBlocks.length === 0) {
              await page.keyboard?.press?.("Escape").catch(() => {});
              throw new Error(
                `Nội dung nhận xét của '${fullName}' (${subId}) đang trống, không thể lưu lên LMS.`
              );
            }

            // 1. Select MARK vs REDO radio
            const lmsRadioSelector =
              decision === "REDO"
                ? SELECTORS.grading.lmsTabPanel3.radioRedo
                : SELECTORS.grading.lmsTabPanel3.radioMark;
            const lmsRadio = lmsDialog.locator(lmsRadioSelector).first();
            if ((await lmsRadio.count().catch(() => 0)) === 0) {
              await page.keyboard?.press?.("Escape").catch(() => {});
              throw new Error(
                `Không tìm thấy tùy chọn '${decision === "REDO" ? "REDO" : "MARK"}' trên Modal LMS cho '${fullName}'.`
              );
            }
            const isRadioDisabled =
              typeof (lmsRadio as any).isDisabled === "function"
                ? await (lmsRadio as any).isDisabled().catch(() => false)
                : false;
            if (isRadioDisabled) {
              await page.keyboard?.press?.("Escape").catch(() => {});
              throw new Error(
                `Tùy chọn '${decision}' đang bị khóa (disabled) trên Modal LMS cho '${fullName}'.`
              );
            }
            await lmsRadio.click({ force: true });

            // 2. Fill integer score (0..100) when decision === "GRADE"
            if (decision === "GRADE") {
              const lmsScoreInput = lmsDialog
                .locator(SELECTORS.grading.lmsTabPanel3.scoreInput)
                .first();
              if ((await lmsScoreInput.count().catch(() => 0)) === 0) {
                await page.keyboard?.press?.("Escape").catch(() => {});
                throw new Error(
                  `Không tìm thấy ô nhập điểm (Input score) trên Modal LMS cho '${fullName}'.`
                );
              }
              await lmsScoreInput.fill(String(intScore));
              await lmsScoreInput.evaluate((el: HTMLInputElement) => {
                el.dispatchEvent(new Event("blur", { bubbles: true }));
              });
              const currentTypedScore = String(
                await lmsScoreInput.inputValue().catch(() => "")
              ).trim();
              if (currentTypedScore !== String(intScore)) {
                await page.keyboard?.press?.("Escape").catch(() => {});
                throw new Error(
                  `Ô điểm trên Modal LMS ('${currentTypedScore}') không nhận đúng giá trị '${intScore}'.`
                );
              }
            }

            // 3. Populate ReactQuill .ql-editor via safe DOM nodes (zero innerHTML XSS sink)
            const lmsQuill = lmsDialog.locator(SELECTORS.grading.lmsTabPanel3.quillEditor).first();
            if ((await lmsQuill.count().catch(() => 0)) === 0) {
              await page.keyboard?.press?.("Escape").catch(() => {});
              throw new Error(
                `Không tìm thấy ô nhận xét (.ql-editor) trên Modal LMS cho '${fullName}'.`
              );
            }
            await lmsQuill.click({ force: true }).catch(() => {});
            await lmsQuill.evaluate((el: HTMLElement, blocks: SafeNoteRun[][]) => {
              el.replaceChildren();
              el.classList.remove("ql-blank");
              for (const runs of blocks) {
                const pEl = document.createElement("p");
                for (const run of runs) {
                  if (!run.text) continue;
                  let node: Node = document.createTextNode(run.text);
                  if (run.code) {
                    const codeEl = document.createElement("code");
                    codeEl.appendChild(node);
                    node = codeEl;
                  }
                  if (run.italic) {
                    const emEl = document.createElement("em");
                    emEl.appendChild(node);
                    node = emEl;
                  }
                  if (run.bold) {
                    const strongEl = document.createElement("strong");
                    strongEl.appendChild(node);
                    node = strongEl;
                  }
                  pEl.appendChild(node);
                }
                el.appendChild(pEl);
              }
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
            }, safeNoteBlocks);

            if (typeof page.keyboard?.insertText === "function") {
              await page.keyboard.press("End").catch(() => {});
              await page.keyboard.insertText(" ").catch(() => {});
              await page.keyboard.press("Backspace").catch(() => {});
            }
            await page.waitForTimeout?.(200);

            const preSaveEditorText = normalizePlainEditorText(
              await lmsQuill.innerText().catch(() => "")
            );
            if (preSaveEditorText !== plainNote) {
              await page.keyboard?.press?.("Escape").catch(() => {});
              throw new Error(
                `Ô nhận xét (.ql-editor) trên Modal LMS của '${fullName}' không khớp nội dung chuẩn bị lưu.`
              );
            }

            // 4. Pre-Save SQLite CAS Integrity Check immediately before clicking Save
            const preClickRecord = homeworkSubmissionRepo.findBySubmissionId(subId);
            if (
              !preClickRecord ||
              (preClickRecord.status !== "APPROVED" && preClickRecord.status !== "FAILED") ||
              !verifyHomeworkContentIntegrity(preClickRecord) ||
              preClickRecord.contentHash !== approvedHash ||
              (preClickRecord.feedbackHtml ?? "") !== (freshRecord.feedbackHtml ?? "") ||
              (preClickRecord.decision || "GRADE") !== decision ||
              (preClickRecord.teacherOverrideScore ?? preClickRecord.calculatedScore ?? 0) !==
                effectiveScore
            ) {
              await page.keyboard?.press?.("Escape").catch(() => {});
              if (preClickRecord && !verifyHomeworkContentIntegrity(preClickRecord)) {
                homeworkSubmissionRepo.upsert({
                  ...preClickRecord,
                  status: "WAITING_APPROVAL",
                  verifiedAt: null,
                });
              }
              throw new Error(
                `Dữ liệu chấm bài '${subId}' đã bị thay đổi ngay trước khi bấm Save trên LMS. Đã hủy thao tác Lưu và hạ về WAITING_APPROVAL.`
              );
            }

            const lmsSaveBtn = lmsDialog.locator(SELECTORS.grading.lmsTabPanel3.saveButton).first();
            if ((await lmsSaveBtn.count().catch(() => 0)) === 0) {
              await page.keyboard?.press?.("Escape").catch(() => {});
              throw new Error(`Không tìm thấy nút Save trên Modal LMS cho '${fullName}'.`);
            }

            const expectedOpName =
              decision === "REDO" ? "RequestRedoSubmission" : "MarkStudentSubmission";
            const expectedRootField =
              decision === "REDO" ? "requestRedoSubmission" : "markStudentSubmission";
            const expectedStudentUid = matrixStudentUidById.get(stuId) || "";

            const lmsRequestPredicate = (postData?: string | null): boolean => {
              if (!postData) return false;
              try {
                const parsed = JSON.parse(postData);
                const opName = String(parsed?.operationName || "").trim();
                const queryStr = String(parsed?.query || "");
                if (
                  opName !== expectedOpName &&
                  !new RegExp(`\\b${expectedRootField}\\b`).test(queryStr)
                ) {
                  return false;
                }
                const payload = parsed?.variables?.payload;
                if (!payload || typeof payload !== "object") return false;
                if (String(payload.id || "").trim() !== subId) return false;
                if (decision === "GRADE") {
                  if (String(payload.score ?? "").trim() !== String(intScore)) {
                    return false;
                  }
                }
                if (normalizeComparableNoteText(String(payload.note || "")) !== plainNote) {
                  return false;
                }
                return true;
              } catch {
                return false;
              }
            };

            const [lmsApiRes] = await Promise.all([
              interceptor.waitForApiResponse("mindx.edu.vn", {
                method: "POST",
                timeoutMs: 15000,
                requestPredicate: lmsRequestPredicate,
              }),
              lmsSaveBtn.click({ force: true }),
            ]);

            const lmsHttpStatus =
              typeof lmsApiRes?.status === "function" ? lmsApiRes.status() : 200;
            if (lmsHttpStatus !== 200 && lmsHttpStatus !== 201) {
              throw new Error(`API ${expectedOpName} trả về HTTP status ${lmsHttpStatus}.`);
            }

            const lmsResJson =
              typeof lmsApiRes?.json === "function"
                ? await lmsApiRes.json().catch(() => ({}))
                : {};
            if (lmsResJson && Array.isArray(lmsResJson.errors) && lmsResJson.errors.length > 0) {
              throw new Error(
                `GraphQL ${expectedOpName} trả về lỗi: ${
                  lmsResJson.errors[0]?.message || "Unknown GraphQL error"
                }`
              );
            }

            const returnedSub =
              lmsResJson?.data?.studentHomework?.[expectedRootField] ??
              lmsResJson?.data?.[expectedRootField];
            if (!returnedSub || typeof returnedSub !== "object") {
              throw new Error(
                `GraphQL ${expectedOpName} thiếu dữ liệu xác nhận tại studentHomework.${expectedRootField}.`
              );
            }
            if (String(returnedSub.id || "").trim() !== subId) {
              throw new Error(
                `GraphQL ${expectedOpName} trả về id '${String(returnedSub.id)}' không khớp với '${subId}'.`
              );
            }
            if (returnedSub.studentUid) {
              const retUid = String(returnedSub.studentUid).trim();
              if (retUid !== stuId && (!expectedStudentUid || retUid !== expectedStudentUid)) {
                throw new Error(
                  `GraphQL ${expectedOpName} trả về studentUid '${retUid}' không khớp học viên '${fullName}'.`
                );
              }
            }
            if (returnedSub.classId && expectedLmsClassId) {
              const retCid = String(returnedSub.classId).trim();
              if (retCid !== expectedLmsClassId && retCid.toUpperCase() !== classId) {
                throw new Error(
                  `GraphQL ${expectedOpName} trả về classId '${retCid}' không khớp lớp '${classCode}'.`
                );
              }
            }
            if (returnedSub.lessonId && expectedLessonId) {
              const retLid = String(returnedSub.lessonId).trim();
              if (retLid !== expectedLessonId) {
                throw new Error(
                  `GraphQL ${expectedOpName} trả về lessonId '${retLid}' không khớp cột '${expectedLessonId}'.`
                );
              }
            }
            if (decision === "GRADE") {
              if (Number(returnedSub.score) !== intScore) {
                throw new Error(
                  `GraphQL ${expectedOpName} trả về score '${String(returnedSub.score)}' không khớp với '${intScore}'.`
                );
              }
              if (String(returnedSub.status || "").trim().toUpperCase() !== "MARKED") {
                throw new Error(
                  `GraphQL ${expectedOpName} trả về status '${String(returnedSub.status)}' (mong đợi MARKED).`
                );
              }
            } else if (String(returnedSub.status || "").trim().toUpperCase() !== "REDO") {
              throw new Error(
                `GraphQL ${expectedOpName} trả về status '${String(returnedSub.status)}' (mong đợi REDO).`
              );
            }
            if (
              typeof returnedSub.note === "string" &&
              normalizeComparableNoteText(returnedSub.note) !== plainNote
            ) {
              throw new Error(
                `GraphQL ${expectedOpName} trả về note không khớp với bản nhận xét đã duyệt.`
              );
            }

            savedCount++;

            // 5. Post-Save SQLite Drift Check
            const postSaveRecord = homeworkSubmissionRepo.findBySubmissionId(subId);
            if (
              !postSaveRecord ||
              !verifyHomeworkContentIntegrity(postSaveRecord) ||
              postSaveRecord.contentHash !== approvedHash ||
              (postSaveRecord.feedbackHtml ?? "") !== (freshRecord.feedbackHtml ?? "") ||
              (postSaveRecord.decision || "GRADE") !== decision ||
              (postSaveRecord.teacherOverrideScore ?? postSaveRecord.calculatedScore ?? 0) !==
                effectiveScore
            ) {
              if (postSaveRecord) {
                homeworkSubmissionRepo.upsert({
                  ...postSaveRecord,
                  status: "WAITING_APPROVAL",
                  verifiedAt: null,
                });
              }
              throw new Error(
                `Nội dung bài chấm '${subId}' bị chỉnh sửa trong lúc đang lưu lên LMS. Không đánh dấu VERIFIED.`
              );
            }

            // 6. Read-after-Write DOM Verification (Expanded Cell + Re-opened Modal)
            await lmsDialog.waitFor({ state: "hidden", timeout: 4000 }).catch(() => {});
            await page.waitForTimeout?.(350);
            await interceptor.dismissForbiddenToast();

            const verifyRows = await tagAndScanLmsRows().catch(() => []);
            const verifyRow = verifyRows.find(
              (r) => normalizeVietnameseName(r.startText) === targetNormName
            );
            if (!verifyRow) {
              throw new Error(
                `Read-after-Write thất bại: Không tìm thấy lại dòng của '${fullName}' trên #tabpanel-3.`
              );
            }
            const verifyCell = context
              .locator(`[data-mindx-sub-row-idx="${verifyRow.idx}"] > div`)
              .nth(colIndex + 1);
            await verifyCell.scrollIntoViewIfNeeded().catch(() => {});

            if ((await verifyCell.locator(actionBtnSelector).count().catch(() => 0)) === 0) {
              await verifyCell.click({ force: true });
              await page.waitForTimeout?.(350);
            }

            const verifyBtns = verifyCell.locator(actionBtnSelector);
            const verifyBtnCount = await verifyBtns.count().catch(() => 0);
            const verifyBtnIdx = selectedBtnIdx < verifyBtnCount ? selectedBtnIdx : 0;

            let verifyItemScope: any = verifyCell;
            if (verifyBtnCount > 1) {
              const targetBtn = verifyBtns.nth(verifyBtnIdx);
              for (const relUp of ["..", "../..", "../../.."]) {
                const anc = targetBtn.locator(relUp);
                if ((await anc.count().catch(() => 0)) === 0) continue;
                const ancBtns = await anc.locator(actionBtnSelector).count().catch(() => 0);
                const ancText = (await anc.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
                if (
                  ancBtns === 1 &&
                  /\d+\s*\/\s*100|--\s*\/\s*100|redo|làm\s*lại/i.test(ancText)
                ) {
                  verifyItemScope = anc;
                  break;
                }
              }
            }

            const verifyCellText = (await verifyItemScope.innerText().catch(() => ""))
              .replace(/\s+/g, " ")
              .trim();
            if (decision === "REDO") {
              if (!/redo\s*requested|đã\s*yêu\s*cầu\s*làm\s*lại|làm\s*lại/i.test(verifyCellText)) {
                throw new Error(
                  `Read-after-Write thất bại cho '${fullName}': Ô bài nộp đọc lại là '${verifyCellText}' (mong đợi Redo Requested).`
                );
              }
            } else {
              const scoreRegex = new RegExp(`(^|[^0-9-])${intScore}\\s*\\/\\s*100([^0-9]|$)`, "i");
              if (
                !scoreRegex.test(verifyCellText) ||
                /--\s*\/\s*100|not\s*submit|chưa\s*nộp/i.test(verifyCellText)
              ) {
                throw new Error(
                  `Read-after-Write thất bại cho '${fullName}': Ô điểm trên #tabpanel-3 đọc lại là '${verifyCellText}', không khớp '${intScore}/100'.`
                );
              }
            }

            // Re-open Update modal to verify persisted radio, score, and ReactQuill note
            await verifyBtns.nth(verifyBtnIdx).click({ force: true });
            await page.waitForTimeout?.(350);
            const readbackModal = page.locator(lmsDialogSelector).last();
            await readbackModal.waitFor({ state: "visible", timeout: 6000 });

            const readbackModalText = (await readbackModal.innerText().catch(() => "")).trim();
            if (
              !readbackModalText.toUpperCase().includes(classCode) ||
              !normalizeVietnameseName(readbackModalText).includes(targetNormName)
            ) {
              await page.keyboard?.press?.("Escape").catch(() => {});
              throw new Error(
                `Read-after-Write thất bại: Modal đọc lại không khớp định danh '${classCode}' / '${fullName}'.`
              );
            }

            const readbackRadio = readbackModal.locator(lmsRadioSelector).first();
            if (typeof (readbackRadio as any).isChecked === "function") {
              const checked = await (readbackRadio as any).isChecked().catch(() => false);
              if (!checked) {
                await page.keyboard?.press?.("Escape").catch(() => {});
                throw new Error(
                  `Read-after-Write thất bại: Trạng thái lựa chọn (${decision}) trên Modal LMS không được lưu.`
                );
              }
            }

            if (decision === "GRADE") {
              const readbackScoreInput = readbackModal
                .locator(SELECTORS.grading.lmsTabPanel3.scoreInput)
                .first();
              const persistedScore = String(
                await readbackScoreInput.inputValue().catch(() => "")
              ).trim();
              if (persistedScore !== String(intScore)) {
                await page.keyboard?.press?.("Escape").catch(() => {});
                throw new Error(
                  `Read-after-Write thất bại: Điểm lưu trên Modal LMS ('${persistedScore}') không khớp '${intScore}'.`
                );
              }
            }

            const readbackQuill = readbackModal
              .locator(SELECTORS.grading.lmsTabPanel3.quillEditor)
              .first();
            const persistedNote = normalizePlainEditorText(
              await readbackQuill.innerText().catch(() => "")
            );
            if (persistedNote !== plainNote) {
              await page.keyboard?.press?.("Escape").catch(() => {});
              throw new Error(
                `Read-after-Write thất bại: Nhận xét lưu trên Modal LMS ('${persistedNote}') không khớp bản đã duyệt.`
              );
            }

            const exitBtn = readbackModal
              .locator(SELECTORS.grading.lmsTabPanel3.exitButton)
              .first();
            if ((await exitBtn.count().catch(() => 0)) > 0) {
              await exitBtn.click({ force: true }).catch(() => {});
            } else {
              await page.keyboard?.press?.("Escape").catch(() => {});
            }
            await page.waitForTimeout?.(200);
            await LmsHelpers.ensureCleanDialogAndToast(page, interceptor);

            // Final Post-Readback Drift & Conditional Verification Check
            const finalRecordLms = homeworkSubmissionRepo.findBySubmissionId(subId);
            if (
              !finalRecordLms ||
              (finalRecordLms.status !== "APPROVED" && finalRecordLms.status !== "FAILED") ||
              !verifyHomeworkContentIntegrity(finalRecordLms) ||
              finalRecordLms.contentHash !== approvedHash
            ) {
              throw new Error(
                `Nội dung bài chấm '${subId}' đã bị chỉnh sửa trong lúc đọc lại DOM (Read-after-Write). Giữ nguyên bản mới để duyệt lại.`
              );
            }

            const verifyUpdateLms = homeworkSubmissionRepo.markVerified(subId, approvedHash);
            if (!verifyUpdateLms || verifyUpdateLms.changes !== 1) {
              throw new Error(
                `Không thể nâng trạng thái VERIFIED cho bài nộp '${subId}' do dữ liệu đã thay đổi.`
              );
            }
            verifiedCount++;

            jobLogRepo.add({
              jobId,
              jobType: "SAVE_HOMEWORK_GRADES",
              classId,
              sessionId,
              studentId: stuId,
              submissionId: subId,
              level: "SUCCESS",
              message: `Đã lưu & đối chiếu VERIFIED điểm của ${fullName} (${
                decision === "REDO" ? "Làm lại" : `${intScore}/100`
              }, submissionId=${subId}).`,
            });

            results.push({
              submissionId: subId,
              studentId: stuId,
              fullName,
              decision,
              effectiveScore: intScore,
              success: true,
              verified: true,
            });
            continue;
          }

          const escapedStuId = stuId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const escapedSubId = subId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const exactIdRegex = new RegExp(`(^|[^a-zA-Z0-9_-])${escapedStuId}([^a-zA-Z0-9_-]|$)`, "i");
          const exactSubIdRegex = new RegExp(`(^|[^a-zA-Z0-9_-])${escapedSubId}([^a-zA-Z0-9_-]|$)`, "i");

          const findTargetCellLocator = async () => {
            const rowItems = context.locator(
              'div:has(> div > svg[data-testid="ExpandMoreIcon"]), div:has(> div > svg[data-testid="ExpandLessIcon"]), table tbody tr'
            );
            const rowCount = await rowItems.count().catch(() => 0);
            for (let r = 0; r < rowCount; r++) {
              const item = rowItems.nth(r);
              const hasDirectTd = (await item.locator("> td").count().catch(() => 0)) > 0;
              const rowContainer = hasDirectTd
                ? item
                : (await item.locator("..").locator("..").count().catch(() => 0)) > 0
                ? item.locator("..").locator("..")
                : item;
              const rowText = (await rowContainer.innerText().catch(() => "")).trim();
              // Strictly require studentId match on the row (never rely on display name alone)
              if (!exactIdRegex.test(rowText)) {
                continue;
              }
              const cells = rowContainer.locator("> div, > td");
              const cellCount = await cells.count().catch(() => 0);
              return colIndex + 1 < cellCount ? cells.nth(colIndex + 1) : cells.last();
            }
            return null;
          };

          let targetCellLocator: any = await findTargetCellLocator();
          if (!targetCellLocator) {
            await LmsHelpers.ensureCleanDialogAndToast(page, interceptor);
            await LmsHelpers.switchDrawerTab(page, SELECTORS.tabs.grading).catch(() => {});
            await page.waitForTimeout?.(400);
            targetCellLocator = await findTargetCellLocator();
          }

          if (!targetCellLocator) {
            throw new Error(
              `Không tìm thấy dòng điểm xác thực của học viên '${fullName}' (${stuId}) trên bảng Chấm bài LMS.`
            );
          }

          await targetCellLocator.scrollIntoViewIfNeeded().catch(() => {});
          await targetCellLocator.click({ force: true });
          await page.waitForTimeout?.(400);

          const modal = page.locator(SELECTORS.grading.modal.container).first();
          try {
            await modal.waitFor({ state: "visible", timeout: 8000 });
          } catch {
            // Self-heal once if the first cell click was swallowed by a toast/scroll animation
            await LmsHelpers.ensureCleanDialogAndToast(page, interceptor);
            await targetCellLocator.scrollIntoViewIfNeeded().catch(() => {});
            await targetCellLocator.click({ force: true });
            await page.waitForTimeout?.(400);
            await modal.waitFor({ state: "visible", timeout: 8000 });
          }

          // Strictly verify modal proves BOTH studentId AND submissionId (reject empty or name-only modal)
          const modalText = (await modal.innerText().catch(() => "")).trim();
          if (
            !modalText ||
            !exactIdRegex.test(modalText) ||
            !exactSubIdRegex.test(modalText)
          ) {
            await page.keyboard?.press?.("Escape").catch(() => {});
            throw new Error(
              `Modal mở ra trên LMS không chứng minh đủ định danh (studentId='${stuId}', submissionId='${subId}'). Đã đóng modal để tránh chấm nhầm người!`
            );
          }

          // Select Radio Button: GRADE ("Chấm điểm") vs REDO ("Yêu cầu học sinh làm lại bài tập")
          const radioSelector =
            decision === "REDO"
              ? SELECTORS.grading.modal.radioRedo
              : SELECTORS.grading.modal.radioGrade;
          const radioLocator = modal.locator(radioSelector).first();
          if ((await radioLocator.count().catch(() => 0)) === 0) {
            await page.keyboard?.press?.("Escape").catch(() => {});
            throw new Error(
              `Không tìm thấy nút chọn trạng thái chấm (${decision}) trên Modal LMS cho bài nộp '${subId}'.`
            );
          }
          await radioLocator.click({ force: true });

          // Fill Score Input when decision === "GRADE"
          if (decision === "GRADE") {
            const scoreInput = modal.locator(SELECTORS.grading.modal.scoreInput).first();
            if ((await scoreInput.count().catch(() => 0)) === 0) {
              await page.keyboard?.press?.("Escape").catch(() => {});
              throw new Error(
                `Không tìm thấy ô nhập điểm (scoreInput) trên Modal LMS cho bài nộp '${subId}'.`
              );
            }
            if (typeof scoreInput.fill === "function") {
              await scoreInput.fill(String(effectiveScore));
            } else {
              await scoreInput.evaluate((el: HTMLInputElement, val: string) => {
                el.value = val;
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
              }, String(effectiveScore));
            }
          }

          // Fill Rich Text Editor safely via textContent (never innerHTML sink)
          const plainFeedback = stripHtmlToComparableText(freshRecord.feedbackHtml);
          const editor = modal.locator(SELECTORS.grading.modal.richTextEditor).first();
          if (!plainFeedback || (await editor.count().catch(() => 0)) === 0) {
            await page.keyboard?.press?.("Escape").catch(() => {});
            throw new Error(
              `Không tìm thấy ô nhập nhận xét (richTextEditor) trên Modal LMS hoặc nội dung nhận xét trống cho bài nộp '${subId}'.`
            );
          }
          await editor.evaluate((el: HTMLElement, textVal: string) => {
            if ("value" in el) {
              (el as unknown as HTMLTextAreaElement).value = textVal;
            } else {
              el.textContent = textVal;
            }
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }, plainFeedback);

          // Pre-Save Re-Verification: Check SQLite immediately before clicking Save
          const preClickRecord = homeworkSubmissionRepo.findBySubmissionId(subId);
          if (
            !preClickRecord ||
            (preClickRecord.status !== "APPROVED" && preClickRecord.status !== "FAILED") ||
            !verifyHomeworkContentIntegrity(preClickRecord) ||
            preClickRecord.contentHash !== approvedHash ||
            (preClickRecord.feedbackHtml ?? "") !== (freshRecord.feedbackHtml ?? "") ||
            (preClickRecord.decision || "GRADE") !== decision ||
            (preClickRecord.teacherOverrideScore ?? preClickRecord.calculatedScore ?? 0) !==
              effectiveScore
          ) {
            await page.keyboard?.press?.("Escape").catch(() => {});
            if (preClickRecord && !verifyHomeworkContentIntegrity(preClickRecord)) {
              homeworkSubmissionRepo.upsert({
                ...preClickRecord,
                status: "WAITING_APPROVAL",
                verifiedAt: null,
              });
            }
            throw new Error(
              `Dữ liệu chấm bài '${subId}' đã bị thay đổi ngay trước khi bấm Lưu trên LMS. Đã hủy thao tác Lưu và hạ về WAITING_APPROVAL.`
            );
          }

          const saveBtn = modal.locator(SELECTORS.grading.modal.saveButton).first();
          if ((await saveBtn.count().catch(() => 0)) === 0) {
            await page.keyboard?.press?.("Escape").catch(() => {});
            throw new Error(`Không tìm thấy nút Lưu (saveButton) trên Modal LMS cho bài nộp '${subId}'.`);
          }

          // Prepare strict Network API predicate for the grading mutation
          let apiPayloadVerified = false;
          let expectedResponseField = "";
          let selectedAlias = "";
          let hasInlineArgs = false;
          const requestPredicate = (postData?: string | null): boolean => {
            if (!postData) return false;
            try {
              const parsed = JSON.parse(postData);
              const opName = String(parsed?.operationName || "").trim();
              const queryStr = String(parsed?.query || "").trim();

              if (!opName || !queryStr) {
                return false;
              }
              if (
                /^(get|list|fetch|find|load|query)/i.test(opName) ||
                /(summary|profile|attachment|detail|lookup|other)/i.test(opName)
              ) {
                return false;
              }
              if (!/(grade|score|submission|homework|evaluate|mark|assess)/i.test(opName)) {
                return false;
              }

              type GqlToken =
                | { kind: "STRING"; value: string }
                | { kind: "NUMBER"; value: number }
                | { kind: "NAME"; value: string }
                | { kind: "SYMBOL"; value: string };

              const lexGql = (q: string): GqlToken[] | null => {
                const tokens: GqlToken[] = [];
                let i = 0;
                while (i < q.length) {
                  if (/[\s,\uFEFF]/.test(q[i])) {
                    i++;
                    continue;
                  }
                  if (q[i] === "#") {
                    while (i < q.length && !/[\r\n]/.test(q[i])) {
                      i++;
                    }
                    continue;
                  }
                  if (q.startsWith('"""', i)) {
                    i += 3;
                    let val = "";
                    let closed = false;
                    while (i < q.length) {
                      if (q.startsWith('\\"""', i)) {
                        val += '"""';
                        i += 4;
                        continue;
                      }
                      if (q.startsWith('"""', i)) {
                        i += 3;
                        closed = true;
                        break;
                      }
                      val += q[i++];
                    }
                    if (!closed) return null;
                    const lines = val.split(/\r\n|[\r\n]/);
                    const indents = lines
                      .slice(1)
                      .filter((s) => /[^ \t]/.test(s))
                      .map((s) => (/^[ \t]*/.exec(s)?.[0] ?? "").length);
                    const commonIndent = indents.length
                      ? Math.min(...indents)
                      : 0;
                    const outLines = lines.map((s, idx) =>
                      idx ? s.slice(commonIndent) : s
                    );
                    while (outLines.length && /^[ \t]*$/.test(outLines[0])) {
                      outLines.shift();
                    }
                    while (
                      outLines.length &&
                      /^[ \t]*$/.test(outLines[outLines.length - 1])
                    ) {
                      outLines.pop();
                    }
                    tokens.push({ kind: "STRING", value: outLines.join("\n") });
                    continue;
                  }
                  if (q[i] === '"') {
                    const start = i++;
                    let closed = false;
                    while (i < q.length) {
                      if (q[i] === "\\") {
                        i += 2;
                        continue;
                      }
                      if (q[i++] === '"') {
                        closed = true;
                        break;
                      }
                    }
                    if (!closed) return null;
                    const rawSlice = q.slice(start, i);
                    let parsedStr: string;
                    try {
                      parsedStr = JSON.parse(rawSlice);
                    } catch {
                      return null;
                    }
                    tokens.push({ kind: "STRING", value: parsedStr });
                    continue;
                  }
                  if (q[i] === "'") {
                    const start = i++;
                    let closed = false;
                    while (i < q.length) {
                      if (q[i] === "\\") {
                        i += 2;
                        continue;
                      }
                      if (q[i++] === "'") {
                        closed = true;
                        break;
                      }
                    }
                    if (!closed) return null;
                    const rawSlice = q
                      .slice(start + 1, i - 1)
                      .replace(/\\(["'\\/bfnrt])/g, "$1");
                    tokens.push({ kind: "STRING", value: rawSlice });
                    continue;
                  }
                  const nameMatch = /^[_A-Za-z][_0-9A-Za-z]*/.exec(q.slice(i));
                  if (nameMatch) {
                    tokens.push({ kind: "NAME", value: nameMatch[0] });
                    i += nameMatch[0].length;
                    continue;
                  }
                  const numMatch =
                    /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
                      q.slice(i)
                    );
                  if (numMatch) {
                    tokens.push({
                      kind: "NUMBER",
                      value: Number(numMatch[0]),
                    });
                    i += numMatch[0].length;
                    continue;
                  }
                  if ("{}():[]!$=@.|&".includes(q[i])) {
                    tokens.push({ kind: "SYMBOL", value: q[i++] });
                    continue;
                  }
                  return null;
                }
                return tokens;
              };

              const tokens = lexGql(queryStr);
              if (!tokens || tokens.length === 0) {
                return false;
              }

              const ops: Array<{
                type: string;
                name: string;
                hasVarDefs: boolean;
                bodyTokens: GqlToken[];
              }> = [];
              const seenOpNames = new Set<string>();
              let ti = 0;
              while (ti < tokens.length) {
                const opTok = tokens[ti];
                if (
                  opTok.kind !== "NAME" ||
                  !/^(mutation|query|subscription)$/i.test(opTok.value)
                ) {
                  return false;
                }
                const opType = opTok.value.toLowerCase();
                ti++;
                let parsedOpName = "";
                if (tokens[ti]?.kind === "NAME") {
                  parsedOpName = String(tokens[ti].value);
                  if (seenOpNames.has(parsedOpName)) {
                    return false;
                  }
                  seenOpNames.add(parsedOpName);
                  ti++;
                }
                let opHasVarDefs = false;
                if (
                  tokens[ti]?.kind === "SYMBOL" &&
                  tokens[ti].value === "("
                ) {
                  opHasVarDefs = true;
                  ti++;
                  let pDepth = 1;
                  while (ti < tokens.length && pDepth > 0) {
                    if (tokens[ti].kind === "SYMBOL") {
                      if (tokens[ti].value === "(") pDepth++;
                      else if (tokens[ti].value === ")") pDepth--;
                    }
                    ti++;
                  }
                  if (pDepth !== 0) return false;
                }
                while (
                  tokens[ti]?.kind === "SYMBOL" &&
                  tokens[ti].value === "@"
                ) {
                  ti++;
                  if (tokens[ti]?.kind !== "NAME") return false;
                  if (/^(skip|include)$/i.test(String(tokens[ti].value))) return false;
                  ti++;
                  if (
                    tokens[ti]?.kind === "SYMBOL" &&
                    tokens[ti].value === "("
                  ) {
                    ti++;
                    let dDepth = 1;
                    while (ti < tokens.length && dDepth > 0) {
                      if (tokens[ti].kind === "SYMBOL") {
                        if (tokens[ti].value === "(") dDepth++;
                        else if (tokens[ti].value === ")") dDepth--;
                      }
                      ti++;
                    }
                    if (dDepth !== 0) return false;
                  }
                }
                if (
                  tokens[ti]?.kind !== "SYMBOL" ||
                  tokens[ti].value !== "{"
                ) {
                  return false;
                }
                ti++;
                const bodyStart = ti;
                let bDepth = 1;
                while (ti < tokens.length && bDepth > 0) {
                  if (tokens[ti].kind === "SYMBOL") {
                    if (tokens[ti].value === "{") bDepth++;
                    else if (tokens[ti].value === "}") bDepth--;
                  }
                  ti++;
                }
                if (bDepth !== 0) return false;
                const bodyEnd = ti - 1;
                ops.push({
                  type: opType,
                  name: parsedOpName,
                  hasVarDefs: opHasVarDefs,
                  bodyTokens: tokens.slice(bodyStart, bodyEnd),
                });
              }

              if (ops.length === 0) {
                return false;
              }
              const matchingOps = opName
                ? ops.filter((o) => o.name === opName)
                : ops;
              const selectedOp =
                matchingOps.length === 1 ? matchingOps[0] : undefined;
              if (!selectedOp || selectedOp.type !== "mutation") {
                return false;
              }
              const bodyTokens = selectedOp.bodyTokens;
              if (bodyTokens.length === 0) {
                return false;
              }
              for (let idx = 0; idx < bodyTokens.length; idx++) {
                if (
                  bodyTokens[idx].kind === "SYMBOL" &&
                  bodyTokens[idx].value === "@" &&
                  bodyTokens[idx + 1]?.kind === "NAME" &&
                  /^(skip|include)$/i.test(String(bodyTokens[idx + 1].value))
                ) {
                  return false;
                }
              }

              let bi = 0;
              if (bodyTokens[bi]?.kind !== "NAME") {
                return false;
              }
              let aliasName = "";
              let rootFieldName = "";
              if (
                bodyTokens[bi + 1]?.kind === "SYMBOL" &&
                bodyTokens[bi + 1].value === ":"
              ) {
                aliasName = String(bodyTokens[bi].value);
                bi += 2;
                if (bodyTokens[bi]?.kind !== "NAME") {
                  return false;
                }
              }
              rootFieldName = String(bodyTokens[bi].value);
              bi++;
              if (
                !rootFieldName ||
                /^__/.test(rootFieldName) ||
                /(attachment|profile|summary|lookup|upload|delete|preview)/i.test(
                  rootFieldName
                ) ||
                !/(grade|score|mark|evaluate)/i.test(rootFieldName)
              ) {
                return false;
              }

              type GqlArgNode =
                | { kind: "VARIABLE"; name: string }
                | { kind: "OBJECT"; fields: Record<string, GqlArgNode> }
                | { kind: "ARRAY"; items: GqlArgNode[] }
                | { kind: "STRING"; value: string }
                | { kind: "NUMBER"; value: number }
                | { kind: "BOOLEAN"; value: boolean }
                | { kind: "NULL"; value: null }
                | { kind: "ENUM"; value: string };

              const parseArgValue = (): GqlArgNode | null => {
                const tok = bodyTokens[bi];
                if (!tok) return null;
                if (tok.kind === "SYMBOL" && tok.value === "$") {
                  bi++;
                  const vTok = bodyTokens[bi];
                  if (!vTok || vTok.kind !== "NAME") return null;
                  bi++;
                  return { kind: "VARIABLE", name: vTok.value };
                }
                if (tok.kind === "SYMBOL" && tok.value === "{") {
                  bi++;
                  const fields: Record<string, GqlArgNode> = {};
                  while (
                    bi < bodyTokens.length &&
                    !(
                      bodyTokens[bi].kind === "SYMBOL" &&
                      bodyTokens[bi].value === "}"
                    )
                  ) {
                    const kTok = bodyTokens[bi];
                    if (!kTok || kTok.kind !== "NAME") return null;
                    bi++;
                    if (
                      bodyTokens[bi]?.kind !== "SYMBOL" ||
                      bodyTokens[bi].value !== ":"
                    ) {
                      return null;
                    }
                    bi++;
                    if (Object.prototype.hasOwnProperty.call(fields, kTok.value)) {
                      return null;
                    }
                    const childVal = parseArgValue();
                    if (!childVal) return null;
                    fields[kTok.value] = childVal;
                  }
                  if (
                    bodyTokens[bi]?.kind !== "SYMBOL" ||
                    bodyTokens[bi].value !== "}"
                  ) {
                    return null;
                  }
                  bi++;
                  return { kind: "OBJECT", fields };
                }
                if (tok.kind === "SYMBOL" && tok.value === "[") {
                  bi++;
                  const items: GqlArgNode[] = [];
                  while (
                    bi < bodyTokens.length &&
                    !(
                      bodyTokens[bi].kind === "SYMBOL" &&
                      bodyTokens[bi].value === "]"
                    )
                  ) {
                    const itemVal = parseArgValue();
                    if (!itemVal) return null;
                    items.push(itemVal);
                  }
                  if (
                    bodyTokens[bi]?.kind !== "SYMBOL" ||
                    bodyTokens[bi].value !== "]"
                  ) {
                    return null;
                  }
                  bi++;
                  return { kind: "ARRAY", items };
                }
                if (tok.kind === "STRING") {
                  bi++;
                  return { kind: "STRING", value: tok.value };
                }
                if (tok.kind === "NUMBER") {
                  bi++;
                  return { kind: "NUMBER", value: tok.value };
                }
                if (tok.kind === "NAME") {
                  bi++;
                  if (tok.value === "true" || tok.value === "false") {
                    return { kind: "BOOLEAN", value: tok.value === "true" };
                  }
                  if (tok.value === "null") {
                    return { kind: "NULL", value: null };
                  }
                  return { kind: "ENUM", value: tok.value };
                }
                return null;
              };

              let parsedInlineArgs: Record<string, GqlArgNode> | null = null;
              if (
                bodyTokens[bi]?.kind === "SYMBOL" &&
                bodyTokens[bi].value === "("
              ) {
                bi++;
                parsedInlineArgs = {};
                while (
                  bi < bodyTokens.length &&
                  !(
                    bodyTokens[bi].kind === "SYMBOL" &&
                    bodyTokens[bi].value === ")"
                  )
                ) {
                  const argKeyTok = bodyTokens[bi];
                  if (!argKeyTok || argKeyTok.kind !== "NAME") return false;
                  bi++;
                  if (
                    bodyTokens[bi]?.kind !== "SYMBOL" ||
                    bodyTokens[bi].value !== ":"
                  ) {
                    return false;
                  }
                  bi++;
                  if (
                    Object.prototype.hasOwnProperty.call(
                      parsedInlineArgs,
                      argKeyTok.value
                    )
                  ) {
                    return false;
                  }
                  const argVal = parseArgValue();
                  if (!argVal) return false;
                  parsedInlineArgs[argKeyTok.value] = argVal;
                }
                if (
                  bodyTokens[bi]?.kind !== "SYMBOL" ||
                  bodyTokens[bi].value !== ")"
                ) {
                  return false;
                }
                bi++;
              }

              while (
                bodyTokens[bi]?.kind === "SYMBOL" &&
                bodyTokens[bi].value === "@"
              ) {
                bi++;
                if (bodyTokens[bi]?.kind !== "NAME") return false;
                bi++;
                if (
                  bodyTokens[bi]?.kind === "SYMBOL" &&
                  bodyTokens[bi].value === "("
                ) {
                  bi++;
                  let dDepth = 1;
                  while (bi < bodyTokens.length && dDepth > 0) {
                    if (bodyTokens[bi].kind === "SYMBOL") {
                      if (bodyTokens[bi].value === "(") dDepth++;
                      else if (bodyTokens[bi].value === ")") dDepth--;
                    }
                    bi++;
                  }
                  if (dDepth !== 0) return false;
                }
              }

              if (
                bodyTokens[bi]?.kind === "SYMBOL" &&
                bodyTokens[bi].value === "{"
              ) {
                bi++;
                let sDepth = 1;
                while (bi < bodyTokens.length && sDepth > 0) {
                  if (bodyTokens[bi].kind === "SYMBOL") {
                    if (bodyTokens[bi].value === "{") sDepth++;
                    else if (bodyTokens[bi].value === "}") sDepth--;
                  }
                  bi++;
                }
                if (sDepth !== 0) return false;
              }

              if (bi !== bodyTokens.length) {
                return false;
              }

              const vars = parsed?.variables || {};
              let matchedSubId = false;
              let matchedStuId = false;
              let matchedDecisionOrScore = false;
              let matchedFeedback = false;

              const isScalarBusinessKey = (k: string): boolean =>
                k === "classId" ||
                k === "classCode" ||
                k === "sessionId" ||
                k === "submissionId" ||
                k === "id" ||
                k === "_id" ||
                k === "studentId" ||
                k === "studentUid" ||
                k === "score" ||
                k === "decision" ||
                k === "status" ||
                k === "feedback" ||
                k === "comment" ||
                k === "teacherNote" ||
                k === "feedbackHtml";

              const validateFieldPair = (argKey: string, resolvedVal: any): boolean => {
                if (argKey === "classId" || argKey === "classCode") {
                  if (
                    typeof resolvedVal !== "string" ||
                    resolvedVal.trim().toUpperCase() !== classId
                  ) {
                    return false;
                  }
                } else if (argKey === "sessionId") {
                  if (
                    typeof resolvedVal !== "string" ||
                    resolvedVal.trim() !== sessionId
                  ) {
                    return false;
                  }
                } else if (
                  argKey === "submissionId" ||
                  argKey === "id" ||
                  argKey === "_id"
                ) {
                  if (
                    typeof resolvedVal !== "string" ||
                    resolvedVal.trim() !== subId
                  ) {
                    return false;
                  }
                  matchedSubId = true;
                } else if (argKey === "studentId" || argKey === "studentUid") {
                  if (
                    typeof resolvedVal !== "string" ||
                    resolvedVal.trim() !== stuId
                  ) {
                    return false;
                  }
                  matchedStuId = true;
                } else if (argKey === "score") {
                  if (decision === "GRADE") {
                    if (
                      typeof resolvedVal !== "number" ||
                      !Number.isFinite(resolvedVal) ||
                      resolvedVal !== effectiveScore
                    ) {
                      return false;
                    }
                    matchedDecisionOrScore = true;
                  } else if (
                    resolvedVal !== null &&
                    resolvedVal !== undefined &&
                    (typeof resolvedVal !== "number" || !Number.isFinite(resolvedVal))
                  ) {
                    return false;
                  }
                } else if (argKey === "decision" || argKey === "status") {
                  if (typeof resolvedVal !== "string") {
                    return false;
                  }
                  const st = resolvedVal.trim().toUpperCase();
                  if (decision === "REDO") {
                    if (st !== "REDO" && st !== "REDO_REQUESTED") {
                      return false;
                    }
                    matchedDecisionOrScore = true;
                  } else if (st === "REDO" || st === "REDO_REQUESTED" || st !== "GRADE") {
                    return false;
                  }
                } else if (
                  argKey === "feedback" ||
                  argKey === "comment" ||
                  argKey === "teacherNote" ||
                  argKey === "feedbackHtml"
                ) {
                  if (
                    typeof resolvedVal !== "string" ||
                    stripHtmlToComparableText(resolvedVal) !== plainFeedback
                  ) {
                    return false;
                  }
                  matchedFeedback = true;
                }
                return true;
              };

              const validateBoundObject = (obj: any): boolean => {
                if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
                  return false;
                }
                for (const [nestedK, nestedV] of Object.entries(obj)) {
                  if (isScalarBusinessKey(nestedK)) {
                    if (!validateFieldPair(nestedK, nestedV)) {
                      return false;
                    }
                  } else if (nestedV && typeof nestedV === "object") {
                    if (Array.isArray(nestedV) || !validateBoundObject(nestedV)) {
                      return false;
                    }
                  } else if (!validateFieldPair(nestedK, nestedV)) {
                    return false;
                  }
                }
                return true;
              };

              const validateArgNode = (
                argKey: string,
                node: GqlArgNode
              ): boolean => {
                if (node.kind === "ARRAY") {
                  return false;
                }
                if (node.kind === "OBJECT") {
                  if (isScalarBusinessKey(argKey)) {
                    return false;
                  }
                  for (const [childKey, childNode] of Object.entries(
                    node.fields
                  )) {
                    if (!validateArgNode(childKey, childNode)) {
                      return false;
                    }
                  }
                  return true;
                }
                if (node.kind === "VARIABLE") {
                  if (!Object.prototype.hasOwnProperty.call(vars, node.name)) {
                    return false;
                  }
                  const resolvedVal = vars[node.name];
                  if (
                    resolvedVal &&
                    typeof resolvedVal === "object" &&
                    !isScalarBusinessKey(argKey)
                  ) {
                    return validateBoundObject(resolvedVal);
                  }
                  return validateFieldPair(argKey, resolvedVal);
                }
                if (node.kind === "ENUM") {
                  if (
                    argKey !== "decision" &&
                    argKey !== "status" &&
                    isScalarBusinessKey(argKey)
                  ) {
                    return false;
                  }
                  return validateFieldPair(argKey, node.value);
                }
                return validateFieldPair(argKey, node.value);
              };

              if (parsedInlineArgs !== null) {
                for (const [argKey, argNode] of Object.entries(
                  parsedInlineArgs
                )) {
                  if (!validateArgNode(argKey, argNode)) {
                    return false;
                  }
                }
              } else {
                if (selectedOp.hasVarDefs) {
                  return false;
                }
                const roots = [vars, vars.payload, vars.input, vars.data].filter(
                  (x) => x && typeof x === "object"
                );
                for (const obj of roots) {
                  if (!validateBoundObject(obj)) {
                    return false;
                  }
                }
              }

              const ok =
                matchedSubId &&
                matchedStuId &&
                matchedDecisionOrScore &&
                matchedFeedback;
              if (ok) {
                apiPayloadVerified = true;
                expectedResponseField = aliasName || rootFieldName;
                selectedAlias = aliasName;
                hasInlineArgs = parsedInlineArgs !== null;
              }
              return ok;
            } catch {
              return false;
            }
          };

          const [apiResponse] = await Promise.all([
            interceptor.waitForApiResponse("mindx.edu.vn", {
              method: "POST",
              timeoutMs: 12000,
              requestPredicate,
            }),
            saveBtn.click({ force: true }),
          ]);

          const httpStatus =
            typeof apiResponse?.status === "function" ? apiResponse.status() : 200;
          if (httpStatus !== 200 && httpStatus !== 201) {
            throw new Error(`API Lưu điểm trả về HTTP status ${httpStatus}.`);
          }

          const resJson =
            typeof apiResponse?.json === "function"
              ? await apiResponse.json().catch(() => ({}))
              : {};
          if (resJson && Array.isArray(resJson.errors) && resJson.errors.length > 0) {
            throw new Error(
              `GraphQL Lưu điểm trả về lỗi: ${resJson.errors[0]?.message || "Unknown GraphQL error"}`
            );
          }
          if (
            !resJson ||
            typeof resJson.data !== "object" ||
            resJson.data === null ||
            Array.isArray(resJson.data)
          ) {
            throw new Error("GraphQL Lưu điểm thiếu trường data hợp lệ.");
          }
          const dataKeys = Object.keys(resJson.data);
          if (dataKeys.length === 0) {
            throw new Error(
              "GraphQL Lưu điểm trả về data rỗng (mutation bị skip hoặc không thực thi)."
            );
          }
          for (const k of dataKeys) {
            if (selectedAlias) {
              if (k !== selectedAlias) {
                throw new Error(
                  `GraphQL Lưu điểm trả về alias không khớp ('${k}' !== '${selectedAlias}').`
                );
              }
            } else if (expectedResponseField) {
              if (k !== expectedResponseField) {
                throw new Error(
                  `GraphQL Lưu điểm trả về trường gốc không khớp ('${k}' !== '${expectedResponseField}').`
                );
              }
            } else if (!/(grade|score|mark|evaluate)/i.test(k)) {
              throw new Error(
                `GraphQL Lưu điểm trả về trường gốc không hợp lệ ('${k}').`
              );
            }

            const val = resJson.data[k];
            const isValidBool = val === true;
            const isValidObj =
              typeof val === "object" && val !== null && !Array.isArray(val);
            if (!isValidBool && !isValidObj) {
              throw new Error(
                `GraphQL Lưu điểm trả về kết quả không hợp lệ tại trường '${k}'.`
              );
            }
            if (isValidObj) {
              if (Object.keys(val).length === 0) {
                throw new Error(
                  `GraphQL Lưu điểm trả về object rỗng tại trường '${k}'.`
                );
              }
              if ("success" in val && val.success !== true) {
                throw new Error(
                  `GraphQL Lưu điểm trả về success=false tại trường '${k}'.`
                );
              }
              if ("ok" in val && val.ok !== true) {
                throw new Error(
                  `GraphQL Lưu điểm trả về ok=false tại trường '${k}'.`
                );
              }
              if ("error" in val && Boolean(val.error)) {
                throw new Error(
                  `GraphQL Lưu điểm trả về error tại trường '${k}'.`
                );
              }
              const hasPositiveConfirmation =
                val.success === true ||
                val.ok === true ||
                "submissionId" in val ||
                "id" in val ||
                "_id" in val ||
                "studentId" in val ||
                "studentUid" in val ||
                "classId" in val ||
                "classCode" in val ||
                "sessionId" in val ||
                "score" in val ||
                "decision" in val ||
                "status" in val ||
                "feedback" in val ||
                "comment" in val ||
                "teacherNote" in val ||
                "feedbackHtml" in val;
              if (!hasPositiveConfirmation) {
                throw new Error(
                  `GraphQL Lưu điểm trả về object thiếu trường xác nhận hợp lệ tại '${k}'.`
                );
              }
              for (const idKey of ["submissionId", "id", "_id"]) {
                if (idKey in val) {
                  const returnedId = val[idKey];
                  if (typeof returnedId !== "string" || returnedId.trim() !== subId) {
                    throw new Error(
                      `GraphQL Lưu điểm trả về ${idKey} '${String(returnedId)}' không khớp với '${subId}'.`
                    );
                  }
                }
              }
              for (const stuKey of ["studentId", "studentUid"]) {
                if (stuKey in val) {
                  const returnedStudentId = val[stuKey];
                  if (
                    typeof returnedStudentId !== "string" ||
                    returnedStudentId.trim() !== stuId
                  ) {
                    throw new Error(
                      `GraphQL Lưu điểm trả về ${stuKey} '${String(returnedStudentId)}' không khớp với '${stuId}'.`
                    );
                  }
                }
              }
              for (const clsKey of ["classId", "classCode"]) {
                if (clsKey in val) {
                  const returnedClassId = val[clsKey];
                  if (
                    typeof returnedClassId !== "string" ||
                    returnedClassId.trim().toUpperCase() !== classId
                  ) {
                    throw new Error(
                      `GraphQL Lưu điểm trả về ${clsKey} '${String(returnedClassId)}' không khớp với '${classId}'.`
                    );
                  }
                }
              }
              if ("sessionId" in val) {
                const returnedSessionId = val.sessionId;
                if (
                  typeof returnedSessionId !== "string" ||
                  returnedSessionId.trim() !== sessionId
                ) {
                  throw new Error(
                    `GraphQL Lưu điểm trả về sessionId '${String(returnedSessionId)}' không khớp với '${sessionId}'.`
                  );
                }
              }
              if ("score" in val) {
                if (decision === "GRADE") {
                  if (
                    typeof val.score !== "number" ||
                    !Number.isFinite(val.score) ||
                    val.score !== effectiveScore
                  ) {
                    throw new Error(
                      `GraphQL Lưu điểm trả về score '${String(val.score)}' không khớp với '${effectiveScore}'.`
                    );
                  }
                } else if (typeof val.score !== "number" || !Number.isFinite(val.score)) {
                  throw new Error(
                    `GraphQL Lưu điểm trả về score không hợp lệ '${String(val.score)}'.`
                  );
                }
              }
              for (const decKey of ["decision", "status"]) {
                if (decKey in val) {
                  const rawDec = val[decKey];
                  if (typeof rawDec !== "string") {
                    throw new Error(
                      `GraphQL Lưu điểm trả về ${decKey} không phải chuỗi hợp lệ.`
                    );
                  }
                  const retDec = rawDec.trim().toUpperCase();
                  if (decision === "REDO") {
                    if (retDec !== "REDO" && retDec !== "REDO_REQUESTED") {
                      throw new Error(
                        `GraphQL Lưu điểm trả về ${decKey} '${retDec}' không khớp với REDO.`
                      );
                    }
                  } else if (retDec !== "GRADE" && retDec !== "GRADED") {
                    throw new Error(
                      `GraphQL Lưu điểm trả về ${decKey} '${retDec}' không khớp với GRADE.`
                    );
                  }
                }
              }
              for (const fbKey of ["feedback", "comment", "teacherNote", "feedbackHtml"]) {
                if (fbKey in val) {
                  const retFb = val[fbKey];
                  if (
                    typeof retFb !== "string" ||
                    stripHtmlToComparableText(retFb) !== plainFeedback
                  ) {
                    throw new Error(
                      `GraphQL Lưu điểm trả về ${fbKey} không khớp với bản đã duyệt.`
                    );
                  }
                }
              }
            }
          }

          savedCount++;

          // Post-Save Drift Check: Ensure record was not edited in SQLite while network call was in flight
          const postSaveRecord = homeworkSubmissionRepo.findBySubmissionId(subId);
          if (
            !postSaveRecord ||
            !verifyHomeworkContentIntegrity(postSaveRecord) ||
            postSaveRecord.contentHash !== approvedHash ||
            (postSaveRecord.feedbackHtml ?? "") !== (freshRecord.feedbackHtml ?? "") ||
            (postSaveRecord.decision || "GRADE") !== decision ||
            (postSaveRecord.teacherOverrideScore ?? postSaveRecord.calculatedScore ?? 0) !==
              effectiveScore
          ) {
            if (postSaveRecord) {
              homeworkSubmissionRepo.upsert({
                ...postSaveRecord,
                status: "WAITING_APPROVAL",
                verifiedAt: null,
              });
            }
            throw new Error(
              `Nội dung bài chấm '${subId}' bị chỉnh sửa trong lúc đang lưu lên LMS. Không đánh dấu VERIFIED.`
            );
          }

          // Read-after-Write DOM Verification on the LMS table cell AND submission modal
          await page.waitForTimeout?.(500);
          const cellReadbackText = (
            await targetCellLocator.innerText().catch(() => "")
          )
            .replace(/\s+/g, " ")
            .trim();

          let isDomVerified = false;
          if (decision === "REDO") {
            isDomVerified = /làm lại|redo/i.test(cellReadbackText);
          } else {
            const expectedScorePattern = new RegExp(
              `(^|[^0-9])${effectiveScore}\\s*\\/\\s*100([^0-9]|$)|(^|[^0-9])${effectiveScore}\\s*đ`,
              "i"
            );
            isDomVerified =
              expectedScorePattern.test(cellReadbackText) &&
              !/chưa chấm|chưa nộp|làm lại/i.test(cellReadbackText);
          }

          if (!isDomVerified) {
            throw new Error(
              `Read-after-Write Verification thất bại cho '${fullName}': Ô điểm trên LMS đọc lại là '${cellReadbackText}', không khớp với kết quả mong đợi (${
                decision === "REDO" ? "Yêu cầu làm lại" : `${effectiveScore}/100`
              }).`
            );
          }

          // Re-open / read back modal to verify identity & feedback persistence
          await targetCellLocator.click({ force: true }).catch(() => {});
          const modalReadbackText = (await modal.innerText().catch(() => "")).trim();
          if (
            !modalReadbackText ||
            !exactIdRegex.test(modalReadbackText) ||
            !exactSubIdRegex.test(modalReadbackText)
          ) {
            await page.keyboard?.press?.("Escape").catch(() => {});
            throw new Error(
              `Read-after-Write Verification thất bại: Modal đọc lại không khớp định danh (${stuId} / ${subId}).`
            );
          }
          const readbackRadioSelector =
            decision === "REDO"
              ? SELECTORS.grading.modal.radioRedo
              : SELECTORS.grading.modal.radioGrade;
          const readbackRadio = modal.locator(readbackRadioSelector).first();
          if (typeof (readbackRadio as any).isChecked === "function") {
            const isRadioChecked = await (readbackRadio as any).isChecked();
            if (!isRadioChecked) {
              await page.keyboard?.press?.("Escape").catch(() => {});
              throw new Error(
                `Read-after-Write Verification thất bại: Trạng thái lựa chọn (${decision}) trên Modal LMS không khớp bản đã duyệt.`
              );
            }
          }

          const readbackEditor = modal.locator(SELECTORS.grading.modal.richTextEditor).first();
          if ((await readbackEditor.count().catch(() => 0)) === 0) {
            await page.keyboard?.press?.("Escape").catch(() => {});
            throw new Error(
              `Read-after-Write Verification thất bại: Không tìm thấy nội dung nhận xét trên Modal LMS.`
            );
          }
          let editorDomText = "";
          try {
            editorDomText = String(await readbackEditor.innerText()).trim();
          } catch (readErr: any) {
            await page.keyboard?.press?.("Escape").catch(() => {});
            throw new Error(
              `Read-after-Write Verification thất bại: Không thể đọc lại nội dung nhận xét trên Modal LMS (${
                readErr instanceof Error ? readErr.message : String(readErr)
              }).`
            );
          }
          if (
            (!editorDomText && apiPayloadVerified) ||
            (editorDomText &&
              stripHtmlToComparableText(editorDomText) !== plainFeedback)
          ) {
            await page.keyboard?.press?.("Escape").catch(() => {});
            throw new Error(
              `Read-after-Write Verification thất bại: Nhận xét trên LMS ('${editorDomText}') không khớp với bản đã duyệt.`
            );
          }
          await page.keyboard?.press?.("Escape").catch(() => {});

          // Final Post-Readback Drift & Conditional Verification Check
          const finalRecord = homeworkSubmissionRepo.findBySubmissionId(subId);
          if (
            !finalRecord ||
            (finalRecord.status !== "APPROVED" && finalRecord.status !== "FAILED") ||
            !verifyHomeworkContentIntegrity(finalRecord) ||
            finalRecord.contentHash !== approvedHash
          ) {
            throw new Error(
              `Nội dung bài chấm '${subId}' đã bị chỉnh sửa trong lúc đọc lại DOM (Read-after-Write). Giữ nguyên bản mới để duyệt lại.`
            );
          }

          const verifyUpdate = homeworkSubmissionRepo.markVerified(subId, approvedHash);
          if (!verifyUpdate || verifyUpdate.changes !== 1) {
            throw new Error(
              `Không thể nâng trạng thái VERIFIED cho bài nộp '${subId}' do dữ liệu đã thay đổi.`
            );
          }
          verifiedCount++;

          jobLogRepo.add({
            jobId,
            jobType: "SAVE_HOMEWORK_GRADES",
            classId,
            sessionId,
            studentId: stuId,
            submissionId: subId,
            level: "SUCCESS",
            message: `Đã lưu & đối chiếu VERIFIED điểm của ${fullName} (${
              decision === "REDO" ? "Làm lại" : `${effectiveScore}/100`
            }, submissionId=${subId}).`,
          });

          results.push({
            submissionId: subId,
            studentId: stuId,
            fullName,
            decision,
            effectiveScore,
            success: true,
            verified: true,
          });
        } catch (itemErr: any) {
          failedCount++;
          const errMsg = itemErr instanceof Error ? itemErr.message : String(itemErr);
          const latestAfterErr = homeworkSubmissionRepo.findBySubmissionId(subId);
          if (
            latestAfterErr &&
            latestAfterErr.status !== "WAITING_APPROVAL" &&
            verifyHomeworkContentIntegrity(latestAfterErr)
          ) {
            homeworkSubmissionRepo.upsert({
              ...latestAfterErr,
              status: "FAILED",
              errorMessage: errMsg,
            });
          }

          jobLogRepo.add({
            jobId,
            jobType: "SAVE_HOMEWORK_GRADES",
            classId,
            sessionId,
            studentId: stuId,
            submissionId: subId,
            level: "ERROR",
            message: `Lỗi lưu điểm của ${fullName} (${subId}): ${errMsg}`,
          });

          results.push({
            submissionId: subId,
            studentId: stuId,
            fullName,
            decision,
            effectiveScore,
            success: false,
            verified: false,
            error: errMsg,
          });
        }
      }

      return {
        classId,
        classCode,
        sessionId,
        totalCandidates: actionable.length,
        savedCount,
        verifiedCount,
        failedCount,
        results,
      };
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      jobLogRepo.add({
        jobId,
        jobType: "SAVE_HOMEWORK_GRADES",
        classId,
        sessionId,
        level: "ERROR",
        message: `Thất bại khi chạy GradeWorker cho lớp ${classCode}: ${errMsg}`,
      });
      throw err;
    }
  }
}
