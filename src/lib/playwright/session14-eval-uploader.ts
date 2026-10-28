/**
 * MINDX AUTOMATION BOT - SESSION 14 COURSE EVALUATION & DEMO SCORE UPLOADER (v2.9.0)
 * Automates the Buổi 14 "Nhận xét học sinh" modal on MindX LMS:
 * - Selects the 9 [ĐNL] Competency radio buttons (scale 1..5, 45 radios total = 9 groups x 5)
 * - Fills the 5 Demo Score number inputs (Tư duy thuật toán 1.5, Sáng tạo 1.0, Giao tiếp 0.5, Giải quyết vấn đề 1.0, Kỹ năng máy tính 1.0)
 * - Fills the 3 Quill rich-text editors ("Learned From Mindx", "Suggestions From Mindx", "Future Direction")
 * - Clicks Save, verifies GraphQL HTTP 200 response + Read-after-Write DOM verification, and marks VERIFIED in SQLite.
 */

import type { Page } from "playwright";
import {
  computeSession14EvalHash,
  isRoboticsClassCode,
  jobLogRepo,
  parseSession14CompetencyScores,
  parseSession14DemoScores,
  SESSION14_COMPETENCY_KEYS,
  session14EvalRepo,
  type SpckSession14CompetencyScores,
  studentRepo,
  verifySession14EvalIntegrity,
} from "../db/sqlite";
import { taskQueue } from "../queue/task-queue";
import { authService } from "./auth";
import { browserManager } from "./browser-manager";
import { LmsHelpers } from "./lms-helpers";
import { createNetworkInterceptor, type NetworkInterceptor } from "./network-interceptor";

export interface UploadSession14EvalOptions {
  classId: string;
  studentIds?: string[];
  customPage?: Page;
  skipNavigation?: boolean;
}

export interface Session14EvalStudentUploadResult {
  studentId: string;
  fullName: string;
  status: "VERIFIED" | "FAILED" | "DEMOTED_DRIFT" | "SKIPPED";
  errorMessage?: string;
  verifiedAt?: string;
}

export interface UploadSession14EvalSummary {
  classId: string;
  totalRequested: number;
  verifiedCount: number;
  failedCount: number;
  demotedCount: number;
  results: Session14EvalStudentUploadResult[];
}

function normalizePlainText(raw: string): string {
  return String(raw || "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function verifyServerEvaluationPayload(
  payloadObj: Record<string, unknown>,
  record: {
    learnedFromMindx: string;
    suggestionsFromMindx: string;
    futureDirection: string;
    awardRanking?: string;
  },
  compScores: SpckSession14CompetencyScores,
  demoValuesInDomOrder: number[],
  classId: string,
  studentId: string
): boolean {
  if (
    payloadObj.studentId !== undefined &&
    String(payloadObj.studentId).trim() !== studentId
  ) {
    throw new Error("Đối tượng kết quả GraphQL trả về sai studentId.");
  }
  if (
    payloadObj.classId !== undefined &&
    String(payloadObj.classId).trim().toUpperCase() !== classId.toUpperCase()
  ) {
    throw new Error("Đối tượng kết quả GraphQL trả về sai classId.");
  }
  if (payloadObj.slotNumber !== undefined && Number(payloadObj.slotNumber) !== 14) {
    throw new Error("Đối tượng kết quả GraphQL trả về sai slotNumber.");
  }

  // 1. Check 3 letter parts (learnedFromMindx, suggestionsFromMindx, futureDirection or texts[0..2])
  const letterObj =
    payloadObj.letter && typeof payloadObj.letter === "object" && !Array.isArray(payloadObj.letter)
      ? (payloadObj.letter as Record<string, unknown>)
      : payloadObj;
  const textsArr =
    Array.isArray(payloadObj.texts) &&
    payloadObj.texts.length >= 3 &&
    payloadObj.texts.length <= 4
      ? (payloadObj.texts as unknown[])
      : null;

  const srvLearned =
    typeof letterObj.learnedFromMindx === "string"
      ? letterObj.learnedFromMindx
      : textsArr && typeof textsArr[0] === "string"
      ? textsArr[0]
      : undefined;
  const srvSuggestions =
    typeof letterObj.suggestionsFromMindx === "string"
      ? letterObj.suggestionsFromMindx
      : textsArr && typeof textsArr[1] === "string"
      ? textsArr[1]
      : undefined;
  const srvFuture =
    typeof letterObj.futureDirection === "string"
      ? letterObj.futureDirection
      : textsArr && typeof textsArr[2] === "string"
      ? textsArr[2]
      : undefined;

  if (
    typeof srvLearned === "string" &&
    normalizePlainText(srvLearned) !== normalizePlainText(record.learnedFromMindx)
  ) {
    throw new Error("Nội dung learnedFromMindx từ máy chủ trả về không khớp với bản đã duyệt.");
  }
  if (
    typeof srvSuggestions === "string" &&
    normalizePlainText(srvSuggestions) !== normalizePlainText(record.suggestionsFromMindx)
  ) {
    throw new Error("Nội dung suggestionsFromMindx từ máy chủ trả về không khớp với bản đã duyệt.");
  }
  if (
    typeof srvFuture === "string" &&
    normalizePlainText(srvFuture) !== normalizePlainText(record.futureDirection)
  ) {
    throw new Error("Nội dung futureDirection từ máy chủ trả về không khớp với bản đã duyệt.");
  }

  const isRobotics = isRoboticsClassCode(classId);
  const expectedAward = normalizePlainText(record.awardRanking || "");
  const srvAward =
    typeof letterObj.awardRanking === "string"
      ? letterObj.awardRanking
      : typeof payloadObj.awardRanking === "string"
      ? payloadObj.awardRanking
      : textsArr && typeof textsArr[3] === "string"
      ? textsArr[3]
      : undefined;

  if (typeof srvAward === "string" && normalizePlainText(srvAward) !== expectedAward) {
    throw new Error(
      "Nội dung Xếp hạng giải của học viên (awardRanking) từ máy chủ trả về không khớp với bản đã duyệt."
    );
  }
  const hasAwardWhenRequired =
    (!isRobotics && !expectedAward) || typeof srvAward === "string";

  const hasAllThreeLetters =
    typeof srvLearned === "string" &&
    typeof srvSuggestions === "string" &&
    typeof srvFuture === "string" &&
    hasAwardWhenRequired;

  // 2. Check 9 [ĐNL] competency ratings
  const compContainer =
    payloadObj.competencyScores &&
    typeof payloadObj.competencyScores === "object" &&
    !Array.isArray(payloadObj.competencyScores)
      ? (payloadObj.competencyScores as Record<string, unknown>)
      : payloadObj;
  const ratingsArr = Array.isArray(payloadObj.ratings)
    ? (payloadObj.ratings as unknown[])
    : Array.isArray(payloadObj.competencies)
    ? (payloadObj.competencies as unknown[])
    : null;

  let matchedCompetencyCount = 0;
  for (let groupIdx = 0; groupIdx < SESSION14_COMPETENCY_KEYS.length; groupIdx++) {
    const key = SESSION14_COMPETENCY_KEYS[groupIdx];
    const expectedRating = Math.min(5, Math.max(1, Math.round(Number(compScores[key]) || 4)));
    const rawVal =
      compContainer[key] !== undefined
        ? compContainer[key]
        : ratingsArr && groupIdx < ratingsArr.length
        ? ratingsArr[groupIdx]
        : undefined;
    if (
      rawVal !== undefined &&
      rawVal !== null &&
      typeof rawVal !== "boolean" &&
      String(rawVal).trim() !== ""
    ) {
      const actualRating = Number(rawVal);
      if (
        !Number.isFinite(actualRating) ||
        !Number.isInteger(actualRating) ||
        actualRating < 1 ||
        actualRating > 5 ||
        actualRating !== expectedRating
      ) {
        throw new Error(
          `Điểm Năng lực [ĐNL] mục #${groupIdx + 1} (${key}) từ máy chủ trả về (${rawVal}) không phải số nguyên hợp lệ (1..5) hoặc không khớp với bản đã duyệt (${expectedRating}).`
        );
      }
      matchedCompetencyCount++;
    }
  }
  const hasAllNineCompetencies = matchedCompetencyCount === SESSION14_COMPETENCY_KEYS.length;

  // 3. Check 5 Demo Scores
  const demoKeys = isRobotics
    ? (["creativity", "communication", "problemSolving", "computerSkills", "algorithm"] as const)
    : (["algorithm", "creativity", "communication", "problemSolving", "computerSkills"] as const);
  const demoMaxByIndex = isRobotics
    ? ([1.25, 0.75, 1.0, 0.5, 1.0] as const)
    : ([1.5, 1.0, 0.5, 1.0, 1.0] as const);
  const demoContainer =
    payloadObj.demoScores &&
    typeof payloadObj.demoScores === "object" &&
    !Array.isArray(payloadObj.demoScores)
      ? (payloadObj.demoScores as Record<string, unknown>)
      : payloadObj;
  const numsArr = Array.isArray(payloadObj.nums)
    ? (payloadObj.nums as unknown[])
    : Array.isArray(payloadObj.demoValues)
    ? (payloadObj.demoValues as unknown[])
    : null;

  let matchedDemoCount = 0;
  for (let idx = 0; idx < demoKeys.length; idx++) {
    const dKey = demoKeys[idx];
    const expectedVal = Number(demoValuesInDomOrder[idx]);
    const rawVal =
      demoContainer[dKey] !== undefined
        ? demoContainer[dKey]
        : numsArr && idx < numsArr.length
        ? numsArr[idx]
        : undefined;
    if (
      rawVal !== undefined &&
      rawVal !== null &&
      typeof rawVal !== "boolean" &&
      String(rawVal).trim() !== ""
    ) {
      const actualVal = Number(rawVal);
      if (
        !Number.isFinite(actualVal) ||
        actualVal < 0 ||
        actualVal > demoMaxByIndex[idx] + 1e-6 ||
        Math.abs(actualVal - expectedVal) > 1e-6
      ) {
        throw new Error(
          `Điểm Demo ô #${idx + 1} (${dKey}) từ máy chủ trả về (${rawVal}) không hợp lệ hoặc không khớp với điểm đã duyệt (${expectedVal}).`
        );
      }
      matchedDemoCount++;
    }
  }
  const hasAllFiveDemoScores = matchedDemoCount === demoKeys.length;

  return hasAllThreeLetters && hasAllNineCompetencies && hasAllFiveDemoScores;
}

export class Session14EvalUploader {
  static async uploadApprovedEvaluations(
    options: UploadSession14EvalOptions
  ): Promise<UploadSession14EvalSummary> {
    if (options.customPage) {
      return this.runUploadInternal(options);
    }

    return await taskQueue.enqueue({
      id: `UPLOAD_S14_EVAL_${options.classId}_${Date.now()}`,
      jobType: "UPLOAD_SPCK",
      description: `Đẩy đánh giá tổng kết & Điểm Demo Buổi 14 lớp ${options.classId}`,
      classId: options.classId,
      sessionId: `${options.classId}_SESS_14_EVAL`,
      execute: async () => {
        return await this.runUploadInternal(options);
      },
    });
  }

  static async runUploadInternal(
    options: UploadSession14EvalOptions
  ): Promise<UploadSession14EvalSummary> {
    const normalizedClassId = String(options.classId || "").trim().toUpperCase();
    if (!normalizedClassId) {
      throw new Error("Thiếu mã lớp (classId) khi đẩy đánh giá Buổi 14.");
    }

    const jobId = `job_s14_eval_${Date.now()}`;
    const roster = studentRepo.findByClass(normalizedClassId, false);
    const studentMap = new Map(roster.map((s) => [s.studentId, s]));

    const allEvalRows = session14EvalRepo.findByClass(normalizedClassId);
    const targetRows = options.studentIds && options.studentIds.length > 0
      ? allEvalRows.filter((r) => options.studentIds!.includes(r.studentId))
      : allEvalRows.filter((r) => r.status === "APPROVED");

    const summary: UploadSession14EvalSummary = {
      classId: normalizedClassId,
      totalRequested: targetRows.length,
      verifiedCount: 0,
      failedCount: 0,
      demotedCount: 0,
      results: [],
    };

    if (targetRows.length === 0) {
      return summary;
    }

    const page = options.customPage || (await browserManager.getPage());
    const interceptor = createNetworkInterceptor(page);

    if (!options.skipNavigation && !options.customPage) {
      await authService.ensureAuthenticated("LMS");
      await LmsHelpers.openClassDrawer(page, normalizedClassId);
      await LmsHelpers.switchDrawerTab(page, "Comments");
      await LmsHelpers.ensureCommentsSlotReady(page, normalizedClassId, 14, {
        reopenDrawerIfClosed: true,
        waitForTableMs: 8000,
      });
    }

    for (const row of targetRows) {
      const stu = studentMap.get(row.studentId);
      const fullName = stu?.fullName || row.studentId;

      // Verify status & contentHash integrity before touching browser
      const freshRow = session14EvalRepo.findOne(normalizedClassId, row.studentId);
      if (!freshRow || freshRow.status !== "APPROVED") {
        session14EvalRepo.demoteToWaitingApproval(
          normalizedClassId,
          row.studentId,
          "Chưa được bấm Duyệt (APPROVED) trước khi đẩy lên LMS."
        );
        summary.demotedCount++;
        summary.results.push({
          studentId: row.studentId,
          fullName,
          status: "DEMOTED_DRIFT",
          errorMessage: "Bản ghi chưa ở trạng thái APPROVED. Đã chuyển về WAITING_APPROVAL.",
        });
        continue;
      }

      if (!verifySession14EvalIntegrity(freshRow)) {
        session14EvalRepo.demoteToWaitingApproval(
          normalizedClassId,
          row.studentId,
          "Phát hiện nội dung đánh giá Buổi 14 bị thay đổi sau khi duyệt (Hash Drift)."
        );
        summary.demotedCount++;
        summary.results.push({
          studentId: row.studentId,
          fullName,
          status: "DEMOTED_DRIFT",
          errorMessage: "Nội dung đã thay đổi sau khi duyệt (Hash Drift). Vui lòng duyệt lại.",
        });
        continue;
      }

      const expectedHash = freshRow.contentHash;

      try {
        await this.uploadSingleStudentEvaluation({
          page,
          interceptor,
          classId: normalizedClassId,
          studentId: row.studentId,
          fullName,
          expectedHash,
          skipNavigation: Boolean(options.skipNavigation),
        });

        const verifiedRecord = session14EvalRepo.markVerified(
          normalizedClassId,
          row.studentId,
          expectedHash
        );
        summary.verifiedCount++;
        summary.results.push({
          studentId: row.studentId,
          fullName,
          status: "VERIFIED",
          verifiedAt: verifiedRecord.verifiedAt || new Date().toISOString(),
        });

        jobLogRepo.add({
          jobId,
          jobType: "UPLOAD_SESSION14_EVAL",
          classId: normalizedClassId,
          sessionId: `${normalizedClassId}_SESS_14_EVAL`,
          studentId: row.studentId,
          level: "SUCCESS",
          message: `Đã lưu & xác minh (Read-after-Write) đánh giá tổng kết Buổi 14 cho học viên ${fullName}.`,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        session14EvalRepo.markFailed(normalizedClassId, row.studentId, errMsg);
        summary.failedCount++;
        summary.results.push({
          studentId: row.studentId,
          fullName,
          status: "FAILED",
          errorMessage: errMsg,
        });

        jobLogRepo.add({
          jobId,
          jobType: "UPLOAD_SESSION14_EVAL",
          classId: normalizedClassId,
          sessionId: `${normalizedClassId}_SESS_14_EVAL`,
          studentId: row.studentId,
          level: "ERROR",
          message: `Lỗi đẩy đánh giá Buổi 14 cho học viên ${fullName}: ${errMsg}`,
        });
      }
    }

    return summary;
  }

  private static async fillQuillEditor(editorLoc: any, rawText: string): Promise<void> {
    await editorLoc.click({ force: true }).catch(() => {});
    await editorLoc.evaluate((el: HTMLElement, text: string) => {
      const value = String(text || "");
      if (typeof document !== "undefined" && typeof el.replaceChildren === "function") {
        el.replaceChildren();
        const lines = value
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.length > 0);
        const blocks = lines.length > 0 ? lines : [value];
        for (const line of blocks) {
          const pEl = document.createElement("p");
          pEl.appendChild(document.createTextNode(line.replace(/\*\*([^*\n]+)\*\*/g, "$1")));
          el.appendChild(pEl);
        }
      } else {
        el.textContent = value;
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, rawText);
  }

  private static async uploadSingleStudentEvaluation(params: {
    page: Page;
    interceptor: NetworkInterceptor;
    classId: string;
    studentId: string;
    fullName: string;
    expectedHash: string;
    skipNavigation: boolean;
  }): Promise<void> {
    const { page, interceptor, classId, studentId, fullName, expectedHash, skipNavigation } =
      params;

    const record = session14EvalRepo.findOne(classId, studentId);
    if (!record) {
      throw new Error(`Không tìm thấy bản ghi đánh giá Buổi 14 của ${fullName}.`);
    }

    const compScores = parseSession14CompetencyScores(record.competencyJson);
    const demoScores = parseSession14DemoScores(record.demoScoresJson, classId);
    const isRobotics = isRoboticsClassCode(classId);

    if (!skipNavigation) {
      await LmsHelpers.ensureCleanDialogAndToast(page, interceptor);
      await LmsHelpers.ensureCommentsSlotReady(page, classId, 14, {
        reopenDrawerIfClosed: true,
        waitForTableMs: 5000,
      });
    }

    const drawer = page.locator('.MuiDrawer-root, [role="presentation"], body').first();

    // Locate student row by data-student-id first, then by exact name match
    const idRow = drawer
      .locator(`tr[data-student-id="${studentId}"], [data-student-id="${studentId}"]`)
      .first();
    const hasIdRow = (await idRow.count().catch(() => 0)) > 0;

    let studentRow = idRow;
    if (!hasIdRow) {
      const escapedName = fullName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const nameRegex = new RegExp(`(?:^|[\\r\\n\\t|])${escapedName}(?:$|[\\r\\n\\t|])`, "i");
      const matchedRows = drawer.locator("table tbody tr").filter({ hasText: nameRegex });
      const count = await matchedRows.count().catch(() => 0);
      if (count !== 1) {
        throw new Error(
          `Không xác định được duy nhất 1 dòng cho học viên "${fullName}" (${studentId}) ở Buổi 14 (số dòng khớp=${count}).`
        );
      }
      studentRow = matchedRows.first();
    }

    await studentRow.scrollIntoViewIfNeeded().catch(() => {});
    const openEvalBtn = studentRow
      .locator('button:has-text("Nhận xét học sinh"), button:has-text("Nhận xét")')
      .first();

    const dialog = page.locator('[role="dialog"]').first();
    await openEvalBtn.click({ force: true });
    await dialog.waitFor({ state: "visible", timeout: 6000 });
    await page.waitForTimeout(400);

    // Ensure card inside dialog is expanded if it was previously saved and collapsed
    const ensureDialogExpanded = async () => {
      const radioCount = await dialog.locator('input[type="radio"]').count().catch(() => 0);
      if (radioCount === 0) {
        const expandBtn = dialog
          .locator(
            'button:has-text("+"), button[aria-label*="expand" i], .ant-collapse-header, [class*="collapse"] button'
          )
          .first();
        if ((await expandBtn.count().catch(() => 0)) > 0) {
          await expandBtn.click({ force: true }).catch(() => {});
          await page.waitForTimeout(400);
        }
      }
    };
    await ensureDialogExpanded();

    // 1. Fill 9 [ĐNL] Competency Radio Groups (45 radios = 9 groups x 5 options 1..5)
    const radios = dialog.locator('input[type="radio"]');
    const totalRadios = await radios.count().catch(() => 0);
    if (totalRadios < 45) {
      throw new Error(
        `Modal "Nhận xét học sinh" Buổi 14 của "${fullName}" không đủ 45 nút chọn Điểm Năng lực [ĐNL] (tìm thấy ${totalRadios}).`
      );
    }

    for (let groupIdx = 0; groupIdx < SESSION14_COMPETENCY_KEYS.length; groupIdx++) {
      const key = SESSION14_COMPETENCY_KEYS[groupIdx];
      const rating = Math.min(5, Math.max(1, Math.round(Number(compScores[key]) || 4)));
      const radioIdx = groupIdx * 5 + (rating - 1);
      const targetRadio = radios.nth(radioIdx);
      await targetRadio.scrollIntoViewIfNeeded().catch(() => {});
      await targetRadio.click({ force: true });
    }

    // 2. Fill 5 Demo Score Number Inputs
    const numberInputs = dialog.locator('input[type="number"]');
    const totalNumInputs = await numberInputs.count().catch(() => 0);
    if (totalNumInputs < 5) {
      throw new Error(
        `Modal "Nhận xét học sinh" Buổi 14 của "${fullName}" không đủ 5 ô nhập Điểm Demo (tìm thấy ${totalNumInputs}).`
      );
    }

    // On MindX LMS, numberInputs[0] is disabled (Total Demo Score), and 1..5 are the 5 criteria.
    const firstDisabled = await numberInputs
      .first()
      .evaluate((el: HTMLInputElement) => Boolean(el.disabled))
      .catch(() => totalNumInputs >= 6);
    const offset = firstDisabled && totalNumInputs >= 6 ? 1 : 0;

    const demoValuesInDomOrder: number[] = isRobotics
      ? [
          demoScores.creativity,
          demoScores.communication,
          demoScores.problemSolving,
          demoScores.computerSkills,
          demoScores.algorithm,
        ]
      : [
          demoScores.algorithm,
          demoScores.creativity,
          demoScores.communication,
          demoScores.problemSolving,
          demoScores.computerSkills,
        ];

    for (let idx = 0; idx < 5; idx++) {
      const inputLoc = numberInputs.nth(offset + idx);
      const valStr = String(demoValuesInDomOrder[idx]);
      await inputLoc.scrollIntoViewIfNeeded().catch(() => {});
      await inputLoc.fill(valStr);
      await inputLoc
        .evaluate((el: HTMLInputElement, v: string) => {
          const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            "value"
          )?.set;
          if (nativeSetter) {
            nativeSetter.call(el, v);
          } else {
            el.value = v;
          }
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("blur", { bubbles: true }));
        }, valStr)
        .catch(() => {});
    }

    // 3. Fill 3 Quill Editors ("Learned From Mindx", "Suggestions From Mindx", "Future Direction") + 4th ("Xếp hạng giải") for Robotics
    const quills = dialog.locator(".ql-editor");
    const quillCount = await quills.count().catch(() => 0);
    const cleanAwardRanking = String(record.awardRanking || "").trim();
    const requiresFourthQuill = isRobotics || cleanAwardRanking.length > 0;
    if (quillCount < 3) {
      throw new Error(
        `Modal "Nhận xét học sinh" Buổi 14 của "${fullName}" không đủ 3 ô Thư từ MindX (.ql-editor tìm thấy=${quillCount}).`
      );
    }
    if (requiresFourthQuill && quillCount < 4) {
      throw new Error(
        `Modal "Nhận xét học sinh" Buổi 14 của "${fullName}" thiếu ô thứ 4 "Xếp hạng giải của học viên" (.ql-editor tìm thấy=${quillCount}, yêu cầu >= 4).`
      );
    }

    await this.fillQuillEditor(quills.nth(0), record.learnedFromMindx);
    await this.fillQuillEditor(quills.nth(1), record.suggestionsFromMindx);
    await this.fillQuillEditor(quills.nth(2), record.futureDirection);
    if (quillCount >= 4) {
      await this.fillQuillEditor(quills.nth(3), cleanAwardRanking);
    }

    // Re-check CAS hash and Session 14 active slot immediately before clicking Save (F03)
    const latestBeforeSave = session14EvalRepo.findOne(classId, studentId);
    if (
      !latestBeforeSave ||
      latestBeforeSave.status !== "APPROVED" ||
      computeSession14EvalHash(latestBeforeSave) !== expectedHash
    ) {
      throw new Error(
        `Bản ghi đánh giá Buổi 14 của "${fullName}" đã thay đổi ngay trước khi bấm Save. Đã hủy lưu để bảo vệ dữ liệu.`
      );
    }

    if (!skipNavigation) {
      await LmsHelpers.ensureCommentsSlotReady(page, classId, 14, {
        reopenDrawerIfClosed: false,
        waitForTableMs: 3000,
      });
      const dialogStillOpen = await dialog.isVisible().catch(() => false);
      if (!dialogStillOpen) {
        throw new Error(
          `Hộp thoại đánh giá Buổi 14 của "${fullName}" không còn hiển thị ngay trước khi bấm Save.`
        );
      }
    }

    const saveBtn = dialog.locator('button:has-text("Save"), button:has-text("Lưu")').first();
    if ((await saveBtn.count().catch(() => 0)) === 0) {
      throw new Error(`Không tìm thấy nút "Save" trong modal đánh giá Buổi 14 của "${fullName}".`);
    }

    const saveEvalMutationPattern =
      /^(update|create|save|submit|upsert|edit|set).*(evaluation|eval|slotcomment|studentcomment|comment|feedback)$/i;

    const isMatchingSaveRequest = (res: any): boolean => {
      const url = String(res.url() || "");
      const req = res.request();
      const method = String(req.method() || "").toUpperCase();
      if (method !== "POST") return false;

      try {
        const parsedUrl = new URL(url);
        const host = parsedUrl.hostname.toLowerCase();
        if (host !== "lms-api.mindx.edu.vn" && host !== "lms.mindx.edu.vn") {
          return false;
        }
        if (!parsedUrl.pathname.toLowerCase().includes("/graphql")) {
          return false;
        }
      } catch {
        return false;
      }

      const postData = req.postData() || "";
      if (!postData) return false;
      try {
        const parsedReq = JSON.parse(postData);
        if (!parsedReq || typeof parsedReq !== "object" || Array.isArray(parsedReq)) {
          return false;
        }
        const opName = String(parsedReq?.operationName || "").trim();
        const queryStr = String(parsedReq?.query || "").trim();
        if (/studentwork/i.test(opName) || /studentwork/i.test(queryStr)) {
          return false;
        }
        if (opName && /^(get|list|fetch|find|load|query)/i.test(opName)) {
          return false;
        }
        const matchesOp = opName ? saveEvalMutationPattern.test(opName) : false;
        const matchesQuery = queryStr
          ? /^\s*mutation\b/i.test(queryStr) &&
            /(update|create|save|submit|upsert|edit|set).*(evaluation|eval|slotcomment|studentcomment|comment|feedback)/i.test(
              queryStr
            )
          : false;
        if (queryStr && !matchesQuery) {
          return false;
        }
        if (!matchesOp && !matchesQuery) {
          return false;
        }

        const vars = parsedReq?.variables;
        if (!vars || typeof vars !== "object" || Array.isArray(vars)) {
          return false;
        }
        const reqStudentId = vars.studentId ?? vars.student_id ?? vars?.input?.studentId;
        if (
          reqStudentId === undefined ||
          reqStudentId === null ||
          String(reqStudentId).trim() !== studentId
        ) {
          return false;
        }
        const reqClassId = vars.classId ?? vars.class_id ?? vars?.input?.classId;
        if (
          reqClassId === undefined ||
          reqClassId === null ||
          String(reqClassId).trim().toUpperCase() !== classId.toUpperCase()
        ) {
          return false;
        }
        const reqSlot = vars.slotNumber ?? vars.sessionNumber ?? vars?.input?.slotNumber;
        if (reqSlot === undefined || reqSlot === null || Number(reqSlot) !== 14) {
          return false;
        }
        return true;
      } catch {
        return false;
      }
    };

    const responsePromise = page
      .waitForResponse((res) => isMatchingSaveRequest(res), {
        timeout: skipNavigation ? 500 : 4000,
      })
      .catch(() => null);

    await saveBtn.click({ force: true });
    const apiRes = await responsePromise;
    let savePayloadObj: Record<string, unknown> | null = null;
    let reopenPayloadObj: Record<string, unknown> | null = null;
    let reopenAttempted = false;

    if (apiRes) {
      const status = apiRes.status();
      if (status !== 200 && status !== 201) {
        throw new Error(`LMS API trả về mã HTTP ${status} (yêu cầu 200/201) khi lưu đánh giá Buổi 14.`);
      }
      const bodyJson = await apiRes.json().catch(() => null);
      if (!bodyJson || typeof bodyJson !== "object" || Array.isArray(bodyJson)) {
        throw new Error("Phản hồi từ LMS API khi lưu đánh giá Buổi 14 không phải JSON hợp lệ.");
      }
      if (Array.isArray(bodyJson.errors) && bodyJson.errors.length > 0) {
        throw new Error(
          `LMS GraphQL trả về lỗi khi lưu đánh giá Buổi 14: ${
            bodyJson.errors[0]?.message || "GraphQL Error"
          }`
        );
      }
      const dataObj = bodyJson.data;
      if (!dataObj || typeof dataObj !== "object" || Array.isArray(dataObj)) {
        throw new Error("Phản hồi GraphQL thiếu trường data đối tượng hợp lệ.");
      }
      const matchedEntry = Object.entries(dataObj).find(
        ([k, v]) =>
          saveEvalMutationPattern.test(k) &&
          !/studentwork/i.test(k) &&
          v !== null &&
          typeof v === "object" &&
          !Array.isArray(v) &&
          Object.keys(v as Record<string, unknown>).length > 0
      );
      if (!matchedEntry) {
        throw new Error(
          `Phản hồi GraphQL không chứa đối tượng kết quả lưu đánh giá Buổi 14 hợp lệ cho "${fullName}".`
        );
      }
      const payloadObj = matchedEntry[1] as Record<string, unknown>;
      if (
        payloadObj.studentId !== undefined &&
        String(payloadObj.studentId).trim() !== studentId
      ) {
        throw new Error("Đối tượng kết quả GraphQL trả về sai studentId.");
      }
      if (
        payloadObj.classId !== undefined &&
        String(payloadObj.classId).trim().toUpperCase() !== classId.toUpperCase()
      ) {
        throw new Error("Đối tượng kết quả GraphQL trả về sai classId.");
      }
      if (payloadObj.slotNumber !== undefined && Number(payloadObj.slotNumber) !== 14) {
        throw new Error("Đối tượng kết quả GraphQL trả về sai slotNumber.");
      }
      savePayloadObj = payloadObj;
    } else if (!skipNavigation) {
      throw new Error(
        `Không bắt được phản hồi mạng (HTTP 200/201) từ đúng API lưu đánh giá Buổi 14 cho "${fullName}".`
      );
    }

    await page.waitForTimeout(300);

    // 4. Read-after-Write Verification:
    // Force re-opening the modal via openEvalBtn when !skipNavigation so the page reloads saved state rather than reading unclosed draft inputs.
    if (!skipNavigation) {
      const stillVis = await dialog.isVisible().catch(() => false);
      if (stillVis) {
        const closeBtn = dialog
          .locator(
            'button[aria-label="close" i], button:has-text("Cancel"), button:has-text("Hủy"), button:has-text("Đóng")'
          )
          .first();
        if ((await closeBtn.count().catch(() => 0)) > 0) {
          await closeBtn.click({ force: true }).catch(() => {});
        } else {
          await page.keyboard.press("Escape").catch(() => {});
        }
        await page.waitForTimeout(150);
      }

      // Clear cached DOM inputs inside the dialog before re-opening via openEvalBtn.
      await page
        .evaluate(() => {
          const dlg = document.querySelector('[role="dialog"]');
          if (dlg) {
            dlg.querySelectorAll(".ql-editor").forEach((el) => {
              el.textContent = "";
            });
            dlg.querySelectorAll('input[type="number"]').forEach((el) => {
              (el as HTMLInputElement).value = "";
            });
            dlg.querySelectorAll('input[type="radio"]').forEach((el) => {
              (el as HTMLInputElement).checked = false;
            });
          }
        })
        .catch(() => {});

      const isMatchingReopenRequest = (req: any): boolean => {
        try {
          const rawUrl = String(req.url() || "");
          const parsedUrl = new URL(rawUrl);
          const host = parsedUrl.hostname.toLowerCase();
          if (host !== "lms-api.mindx.edu.vn" && host !== "lms.mindx.edu.vn") {
            return false;
          }
          const method = String(req.method() || "").toUpperCase();
          if (method === "GET") {
            const sp = parsedUrl.searchParams;
            const qStu = sp.get("studentId") ?? sp.get("student_id");
            const qCls = sp.get("classId") ?? sp.get("class_id");
            const qSlot = sp.get("slotNumber") ?? sp.get("sessionNumber") ?? sp.get("slot");
            return (
              String(qStu || "").trim() === studentId &&
              String(qCls || "").trim().toUpperCase() === classId.toUpperCase() &&
              Number(qSlot) === 14
            );
          }
          if (method !== "POST") return false;
          const postData = req.postData() || "";
          if (!postData) return false;
          const parsedReq = JSON.parse(postData);
          const candidates = Array.isArray(parsedReq) ? parsedReq : [parsedReq];
          return candidates.some((item) => {
            if (!item || typeof item !== "object") return false;
            const opName = String(item.operationName || "").trim();
            const queryStr = String(item.query || "").trim();
            if (
              /user|profile|notification|attendance|upload|presign|studentwork/i.test(opName) ||
              /studentwork/i.test(queryStr)
            ) {
              return false;
            }
            const hasEvalHint =
              /evaluation|eval|slotcomment|studentcomment|comment|feedback|summary|mindx/i.test(
                opName
              ) ||
              /evaluation|eval|slotcomment|studentcomment|comment|feedback|summary|mindx/i.test(
                queryStr
              ) ||
              parsedUrl.pathname.toLowerCase().includes("evaluation");
            if (!hasEvalHint) return false;
            const vars = item.variables ?? item;
            if (!vars || typeof vars !== "object") return false;
            const reqStudentId = vars.studentId ?? vars.student_id ?? vars?.input?.studentId;
            const reqClassId = vars.classId ?? vars.class_id ?? vars?.input?.classId;
            const reqSlot =
              vars.slotNumber ??
              vars.sessionNumber ??
              vars.slot ??
              vars?.input?.slotNumber;
            return (
              String(reqStudentId ?? "").trim() === studentId &&
              String(reqClassId ?? "").trim().toUpperCase() === classId.toUpperCase() &&
              Number(reqSlot) === 14
            );
          });
        } catch {
          return false;
        }
      };

      const REOPEN_WINDOW_MS = 6000;
      let matchedReopenRequest: any = null;
      let matchedReopenResponsePromise: Promise<any> | null = null;

      const reopenRequestPromise = page
        .waitForRequest(
          (req) => {
            if (!matchedReopenRequest && isMatchingReopenRequest(req)) {
              matchedReopenRequest = req;
              matchedReopenResponsePromise = page
                .waitForResponse((res) => res.request() === req, {
                  timeout: REOPEN_WINDOW_MS,
                })
                .catch(() => null);
              return true;
            }
            return false;
          },
          {
            timeout: REOPEN_WINDOW_MS,
          }
        )
        .catch(() => null);

      await openEvalBtn.click({ force: true });
      await dialog.waitFor({ state: "visible", timeout: 6000 });
      await page.waitForTimeout(250);

      const reopenReq = (await reopenRequestPromise) ?? matchedReopenRequest;
      reopenAttempted = Boolean(reopenReq);
      if (reopenReq) {
        const reopenResponse: any = matchedReopenResponsePromise
          ? await (matchedReopenResponsePromise as Promise<any>)
          : null;
        if (!reopenResponse) {
          throw new Error(
            `Quá thời gian chờ (${REOPEN_WINDOW_MS}ms) phản hồi tải lại đánh giá Buổi 14 từ máy chủ cho "${fullName}".`
          );
        }
        await page.waitForTimeout(50);
        const reopenStatus = reopenResponse.status();
        if (reopenStatus !== 200 && reopenStatus !== 201) {
          throw new Error(
            `API tải lại đánh giá Buổi 14 khi mở lại trả về HTTP ${reopenStatus} cho "${fullName}".`
          );
        }
        const reopenBody = await reopenResponse.json().catch(() => null);
        if (!reopenBody || typeof reopenBody !== "object" || Array.isArray(reopenBody)) {
          throw new Error(
            `Phản hồi API tải lại đánh giá Buổi 14 không phải JSON hợp lệ cho "${fullName}".`
          );
        }
        if (Array.isArray(reopenBody.errors) && reopenBody.errors.length > 0) {
          throw new Error(
            `GraphQL trả về lỗi khi tải lại đánh giá Buổi 14: ${
              reopenBody.errors[0]?.message || "Unknown GraphQL error"
            }`
          );
        }
        const reopenDataObj = reopenBody.data ?? reopenBody;
        if (!reopenDataObj || typeof reopenDataObj !== "object" || Array.isArray(reopenDataObj)) {
          throw new Error(
            `Phản hồi tải lại đánh giá Buổi 14 thiếu trường data hợp lệ cho "${fullName}".`
          );
        }
        const reopenEntries = Object.entries(reopenDataObj as Record<string, unknown>);
        const matchedReopenEntry = reopenEntries.find(
          ([k, v]) =>
            /evaluation|eval|slotcomment|studentcomment|comment|feedback|summary|mindx/i.test(k) &&
            !/studentwork/i.test(k) &&
            v !== null &&
            typeof v === "object" &&
            !Array.isArray(v) &&
            Object.keys(v as Record<string, unknown>).length > 0
        );
        if (!matchedReopenEntry) {
          throw new Error(
            `Phản hồi tải lại không chứa đối tượng đánh giá Buổi 14 hợp lệ cho "${fullName}".`
          );
        }
        reopenPayloadObj = matchedReopenEntry[1] as Record<string, unknown>;
      }
    } else {
      const isDialogStillVisible = await dialog.isVisible().catch(() => false);
      if (!isDialogStillVisible) {
        await openEvalBtn.click({ force: true });
        await dialog.waitFor({ state: "visible", timeout: 6000 });
        await page.waitForTimeout(250);
      }
    }
    await ensureDialogExpanded();

    // Verify full text of all Quill editors after reopen (F02 + Robotics 4th Quill)
    const minRequiredQuills = requiresFourthQuill ? 4 : 3;
    const reopenQuillCount = await quills.count();
    if (reopenQuillCount < minRequiredQuills) {
      throw new Error(
        `Đối chiếu Read-after-Write thất bại: Sau khi mở lại chỉ tìm thấy ${reopenQuillCount}/${minRequiredQuills} ô soạn thảo (.ql-editor) cho "${fullName}".`
      );
    }

    const readQuillText = async (index: number): Promise<string> => {
      const loc = quills.nth(index);
      const raw = await loc.evaluate(
        (el: HTMLElement) => el.innerText || el.textContent || ""
      );
      return normalizePlainText(raw);
    };

    const readQuill0 = await readQuillText(0);
    const readQuill1 = await readQuillText(1);
    const readQuill2 = await readQuillText(2);

    const expQuill0 = normalizePlainText(record.learnedFromMindx);
    const expQuill1 = normalizePlainText(record.suggestionsFromMindx);
    const expQuill2 = normalizePlainText(record.futureDirection);

    if (readQuill0 !== expQuill0 || readQuill1 !== expQuill1 || readQuill2 !== expQuill2) {
      throw new Error(
        `Đối chiếu Read-after-Write thất bại: Nội dung toàn văn 3 ô Thư từ MindX trên DOM không khớp 100% với bản đã duyệt của "${fullName}".`
      );
    }
    if (requiresFourthQuill || reopenQuillCount >= 4 || quillCount >= 4) {
      if (reopenQuillCount < 4) {
        throw new Error(
          `Đối chiếu Read-after-Write thất bại: Không tìm thấy ô thứ 4 "Xếp hạng giải của học viên" trên DOM khi đọc lại của "${fullName}".`
        );
      }
      const readQuill3 = await readQuillText(3);
      const expQuill3 = normalizePlainText(cleanAwardRanking);
      if (readQuill3 !== expQuill3) {
        throw new Error(
          `Đối chiếu Read-after-Write thất bại: Nội dung ô "Xếp hạng giải của học viên" trên DOM ("${readQuill3}") không khớp với bản đã duyệt ("${expQuill3}") của "${fullName}".`
        );
      }
    }

    // Verify 9 [ĐNL] Competency radio selections
    for (let groupIdx = 0; groupIdx < SESSION14_COMPETENCY_KEYS.length; groupIdx++) {
      const key = SESSION14_COMPETENCY_KEYS[groupIdx];
      const expectedRating = Math.min(5, Math.max(1, Math.round(Number(compScores[key]) || 4)));
      const radioIdx = groupIdx * 5 + (expectedRating - 1);
      const isChecked = await radios
        .nth(radioIdx)
        .isChecked()
        .catch(() => false);
      if (!isChecked) {
        throw new Error(
          `Đối chiếu Read-after-Write thất bại: Điểm Năng lực [ĐNL] mục #${groupIdx + 1} (${key}=${expectedRating}) chưa được chọn trên DOM.`
        );
      }
    }

    // Verify 5 Demo Score inputs
    for (let idx = 0; idx < 5; idx++) {
      const actualVal = Number(
        await numberInputs
          .nth(offset + idx)
          .inputValue()
          .catch(() => "NaN")
      );
      const expectedVal = Number(demoValuesInDomOrder[idx]);
      if (!Number.isFinite(actualVal) || Math.abs(actualVal - expectedVal) > 1e-6) {
        throw new Error(
          `Đối chiếu Read-after-Write thất bại: Điểm Demo ô #${idx + 1} trên DOM (${actualVal}) không khớp với điểm đã duyệt (${expectedVal}).`
        );
      }
    }

    // Verify independent server evaluation payload (3 letter parts, 9 competencies, 5 demo scores) (F01)
    let hasVerifiedServerSource = false;
    if (reopenAttempted) {
      if (
        reopenPayloadObj &&
        verifyServerEvaluationPayload(
          reopenPayloadObj,
          record,
          compScores,
          demoValuesInDomOrder,
          classId,
          studentId
        )
      ) {
        hasVerifiedServerSource = true;
      } else {
        throw new Error(
          `Đối chiếu Read-after-Write thất bại: Phản hồi tải lại đánh giá Buổi 14 từ máy chủ không đầy đủ dữ liệu cho "${fullName}" (${studentId}).`
        );
      }
    } else if (savePayloadObj) {
      if (
        verifyServerEvaluationPayload(
          savePayloadObj,
          record,
          compScores,
          demoValuesInDomOrder,
          classId,
          studentId
        )
      ) {
        hasVerifiedServerSource = true;
      }
    }

    if (!skipNavigation && !hasVerifiedServerSource) {
      throw new Error(
        `Đối chiếu Read-after-Write thất bại: Không có bằng chứng bản đánh giá Buổi 14 đã lưu từ nguồn máy chủ độc lập cho "${fullName}" (${studentId}).`
      );
    }

    // Close dialog cleanly after verification
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(300);
  }
}
