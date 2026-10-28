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
  type HomeworkSubmissionRecord,
} from "../db/sqlite";

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

      // Determine column index from cached score matrix if available (strictly enforcing session <-> lesson mapping)
      let colIndex = Math.max(0, sessionNumber - 1);
      let hasVerifiedLessonMapping = !options.lessonId;
      if (typeof scoreMatrixRepo?.findByClass === "function") {
        const cached = scoreMatrixRepo.findByClass(classId);
        const cols = cached?.matrix?.columns;
        if (Array.isArray(cols) && cols.length > 0) {
          let matchedCol = cols.find((c: any) => Number(c.sessionNumber) === sessionNumber);
          if (options.lessonId) {
            const byLesson = cols.find(
              (c: any) => c.columnId === options.lessonId || c.lessonId === options.lessonId
            );
            if (!byLesson) {
              throw new Error(
                `[HomeworkGradeWorker] Không tìm thấy cột bài tập lessonId='${options.lessonId}' trong lớp ${classCode}.`
              );
            }
            if (Number(byLesson.sessionNumber) !== sessionNumber) {
              throw new Error(
                `[Integrity Violation] lessonId '${options.lessonId}' thuộc Buổi ${byLesson.sessionNumber}, không khớp với session '${sessionId}' (Buổi ${sessionNumber}).`
              );
            }
            matchedCol = byLesson;
            hasVerifiedLessonMapping = true;
          }
          if (matchedCol && typeof matchedCol.colIndex === "number") {
            colIndex = matchedCol.colIndex;
          }
        }
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

          // Ensure no leftover dialog or toast is open before locating student row & target cell on LMS #tabpanel-3
          await LmsHelpers.ensureCleanDialogAndToast(page, interceptor);

          const drawer = page
            .locator('div[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight')
            .first();
          const panel3 = drawer.locator("#tabpanel-3").first();
          const context = (await panel3.isVisible().catch(() => false)) ? panel3 : drawer;

          const escapedStuId = stuId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const escapedSubId = subId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const exactIdRegex = new RegExp(`(^|[^a-zA-Z0-9_-])${escapedStuId}([^a-zA-Z0-9_-]|$)`, "i");
          const exactSubIdRegex = new RegExp(`(^|[^a-zA-Z0-9_-])${escapedSubId}([^a-zA-Z0-9_-]|$)`, "i");

          const findTargetCellLocator = async () => {
            const rowItems = context.locator(
              'div:has(> div > svg[data-testid="ExpandMoreIcon"]), table tbody tr'
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
