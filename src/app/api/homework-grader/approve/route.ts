import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import {
  homeworkSubmissionRepo,
  computeHomeworkContentHash,
  type HomeworkSubmissionRecord,
} from "@/lib/db/sqlite";
import {
  auditCriterionGrades,
  calculateTotalScoreFromCriteria,
} from "@/lib/gemini/score-auditor";
import { sanitizeFeedbackHtml } from "@/lib/gemini/homework-grader";

function buildLockedRubric(existingCriteria: any[], fallbackRubric?: any) {
  const sourceCriteria =
    Array.isArray(fallbackRubric?.criteria) && fallbackRubric.criteria.length > 0
      ? fallbackRubric.criteria
      : Array.isArray(existingCriteria) && existingCriteria.length > 0
      ? existingCriteria
      : [];
  const criteria = sourceCriteria.map((c: any) => ({
    criterionId: String(c?.criterionId || "").trim(),
    name: String(c?.criterionName || c?.name || c?.criterionId || "").trim(),
    maxPoints: Number(c?.maxPoints),
    description: String(c?.description || ""),
    expectedSnippetOrConcept: String(c?.expectedSnippetOrConcept || ""),
  }));
  const maxSum = criteria.reduce(
    (sum: number, c: any) => sum + (Number.isFinite(c.maxPoints) ? c.maxPoints : 0),
    0
  );
  return {
    criteria,
    maxTotalScore: maxSum > 0 ? maxSum : Number(fallbackRubric?.maxTotalScore || 100),
  };
}

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const classId = String(body.classId || "").trim().toUpperCase();
    const sessionId = String(body.sessionId || "").trim();
    const submissionId = body.submissionId ? String(body.submissionId).trim() : "";
    const approveAllInSession = Boolean(body.approveAll);

    if (!classId || !sessionId) {
      return NextResponse.json(
        { success: false, error: "Thiếu classId hoặc sessionId." },
        { status: 400 }
      );
    }

    // Mode 1: Approve all eligible WAITING_APPROVAL submissions in the session
    if (approveAllInSession && !submissionId) {
      const records = homeworkSubmissionRepo.findBySession(classId, sessionId);
      const approvedIds: string[] = [];
      const skippedIds: Array<{ submissionId: string; reason: string }> = [];

      for (const rec of records) {
        if (
          rec.parseStatus === "PARSE_ERROR" ||
          rec.parseStatus !== "PARSED" ||
          !String(rec.fileHash || "").trim()
        ) {
          skippedIds.push({
            submissionId: rec.submissionId,
            reason:
              "Bài nộp chưa tải/chưa phân tích thành công hoặc đang ở trạng thái PARSE_ERROR, không thể duyệt.",
          });
          continue;
        }
        if (rec.status === "APPROVED" || rec.status === "VERIFIED") {
          approvedIds.push(rec.submissionId);
          continue;
        }

        const recGradedFileHash = (rec as any)._gradedFileHash ?? rec.fileHash ?? "";
        if (recGradedFileHash !== (rec.fileHash ?? "")) {
          skippedIds.push({
            submissionId: rec.submissionId,
            reason:
              "[Stale Conflict] File bài nộp đã thay đổi sang phiên bản mới nhưng chưa được chấm/xem lại.",
          });
          continue;
        }

        let recCriteria: any[] = [];
        try {
          recCriteria = JSON.parse(rec.criteriaGradesJson || "[]");
        } catch {
          recCriteria = [];
        }
        const lockedRubric = buildLockedRubric(recCriteria, body.rubric);
        const auditRes = auditCriterionGrades(recCriteria, lockedRubric);
        if (!auditRes.valid) {
          skippedIds.push({
            submissionId: rec.submissionId,
            reason: auditRes.errors.join(" | "),
          });
          continue;
        }

        const reviewedList = Array.isArray(body.reviewedSubmissions)
          ? body.reviewedSubmissions
          : null;
        const rev = reviewedList
          ? reviewedList.find(
              (x: any) => String(x?.submissionId || "").trim() === rec.submissionId
            )
          : null;
        if (!rev) {
          skippedIds.push({
            submissionId: rec.submissionId,
            reason:
              "[Stale Conflict] Thiếu thông tin phiên bản bài nộp đã xem trên giao diện (reviewedSubmissions).",
          });
          continue;
        }
        if (
          typeof rev.fileHash !== "string" ||
          !rev.fileHash.trim() ||
          rev.fileHash.trim() !== String(rec.fileHash || "").trim()
        ) {
          skippedIds.push({
            submissionId: rec.submissionId,
            reason:
              "[Stale Conflict] Phiên bản file bài nộp (fileHash) đã thay đổi so với bản hiển thị trên giao diện.",
          });
          continue;
        }
        if (
          typeof rev.feedbackHtml !== "string" ||
          sanitizeFeedbackHtml(rev.feedbackHtml) !==
            sanitizeFeedbackHtml(rec.feedbackHtml || "")
        ) {
          skippedIds.push({
            submissionId: rec.submissionId,
            reason:
              "[Stale Conflict] Nội dung nhận xét (feedbackHtml) thiếu hoặc đã thay đổi so với bản hiển thị trên giao diện.",
          });
          continue;
        }
        if (
          typeof rev.decision !== "string" ||
          (rev.decision !== "GRADE" && rev.decision !== "REDO") ||
          rev.decision !== (rec.decision || "GRADE")
        ) {
          skippedIds.push({
            submissionId: rec.submissionId,
            reason:
              "[Stale Conflict] Quyết định chấm (GRADE/REDO) thiếu hoặc đã thay đổi so với bản hiển thị trên giao diện.",
          });
          continue;
        }
        if (
          !Object.prototype.hasOwnProperty.call(rev, "teacherOverrideScore") ||
          (rev.teacherOverrideScore !== null &&
            (typeof rev.teacherOverrideScore !== "number" ||
              !Number.isFinite(rev.teacherOverrideScore))) ||
          (rev.teacherOverrideScore ?? null) !== (rec.teacherOverrideScore ?? null)
        ) {
          skippedIds.push({
            submissionId: rec.submissionId,
            reason:
              "[Stale Conflict] Điểm chỉnh sửa (teacherOverrideScore) thiếu hoặc đã thay đổi so với bản hiển thị trên giao diện.",
          });
          continue;
        }
        if (!Array.isArray(rev.criteriaGrades)) {
          skippedIds.push({
            submissionId: rec.submissionId,
            reason:
              "[Stale Conflict] Thiếu danh sách điểm tiêu chí (criteriaGrades) đã xem trên giao diện.",
          });
          continue;
        }
        const revAudit = auditCriterionGrades(rev.criteriaGrades, lockedRubric);
        if (
          !revAudit.valid ||
          JSON.stringify(revAudit.auditedCriteria) !==
            JSON.stringify(auditRes.auditedCriteria)
        ) {
          skippedIds.push({
            submissionId: rec.submissionId,
            reason:
              "[Stale Conflict] Điểm tiêu chí (criteriaGrades) đã thay đổi so với bản hiển thị trên giao diện.",
          });
          continue;
        }

        const cleanFeedback = sanitizeFeedbackHtml(rec.feedbackHtml || "");
        if (!cleanFeedback) {
          skippedIds.push({
            submissionId: rec.submissionId,
            reason: "Thiếu nội dung nhận xét (feedbackHtml trống).",
          });
          continue;
        }

        const effectiveScore =
          typeof rec.teacherOverrideScore === "number" &&
          Number.isFinite(rec.teacherOverrideScore)
            ? rec.teacherOverrideScore
            : auditRes.calculatedScore;

        if (!Number.isFinite(effectiveScore) || effectiveScore < 0 || effectiveScore > 100) {
          skippedIds.push({
            submissionId: rec.submissionId,
            reason: `Điểm số không hợp lệ (${effectiveScore}).`,
          });
          continue;
        }

        const updated: HomeworkSubmissionRecord = {
          ...rec,
          criteriaGradesJson: JSON.stringify(auditRes.auditedCriteria),
          calculatedScore: auditRes.calculatedScore,
          feedbackHtml: cleanFeedback,
          status: "APPROVED",
          verifiedAt: null,
          errorMessage: null,
        };
        updated.contentHash = computeHomeworkContentHash(updated);
        homeworkSubmissionRepo.upsert(updated);
        approvedIds.push(rec.submissionId);
      }

      return NextResponse.json({
        success: true,
        data: {
          approvedCount: approvedIds.length,
          approvedIds,
          skippedIds,
        },
      });
    }

    // Mode 2: Approve a single submission
    if (!submissionId) {
      return NextResponse.json(
        { success: false, error: "Thiếu submissionId cần duyệt." },
        { status: 400 }
      );
    }

    const existing = homeworkSubmissionRepo.findBySubmissionId(submissionId);
    if (!existing) {
      return NextResponse.json(
        {
          success: false,
          error: `Không tìm thấy bài nộp submissionId '${submissionId}' trong cơ sở dữ liệu.`,
        },
        { status: 404 }
      );
    }

    if (existing.classId !== classId || existing.sessionId !== sessionId) {
      return NextResponse.json(
        {
          success: false,
          error: `[Integrity Violation] submissionId '${submissionId}' không thuộc (${classId}, ${sessionId}).`,
        },
        { status: 400 }
      );
    }

    if (
      body.studentId &&
      String(body.studentId).trim() !== existing.studentId
    ) {
      return NextResponse.json(
        {
          success: false,
          error: `[Integrity Violation] submissionId '${submissionId}' thuộc học viên '${existing.studentId}', không phải '${body.studentId}'.`,
        },
        { status: 400 }
      );
    }

    if (existing.parseStatus === "PARSE_ERROR") {
      return NextResponse.json(
        {
          success: false,
          error:
            "Bài nộp đang bị lỗi đọc file (PARSE_ERROR). Cấm tự động duyệt chấm điểm 0 hoặc yêu cầu làm lại khi chưa đọc được file.",
        },
        { status: 400 }
      );
    }

    if (existing.parseStatus !== "PARSED" || !String(existing.fileHash || "").trim()) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Bài nộp chưa được tải hoặc chưa có bằng chứng đọc file hợp lệ (thiếu fileHash / parseStatus !== PARSED), không thể duyệt.",
        },
        { status: 400 }
      );
    }

    let existingCriteria: any[] = [];
    try {
      existingCriteria = JSON.parse(existing.criteriaGradesJson || "[]");
    } catch {
      existingCriteria = [];
    }

    const lockedRubric = buildLockedRubric(existingCriteria, body.rubric);
    const candidateCriteria = Array.isArray(body.criteriaGrades)
      ? body.criteriaGrades
      : existingCriteria;

    const auditResult = auditCriterionGrades(candidateCriteria, lockedRubric);
    if (!auditResult.valid) {
      return NextResponse.json(
        {
          success: false,
          error: auditResult.errors.join(" | "),
        },
        { status: 400 }
      );
    }

    // Stale approval & version check: reject if request payload diverges from latest saved draft in SQLite
    const existingGradedFileHash =
      (existing as any)._gradedFileHash ?? existing.fileHash ?? "";
    if (existingGradedFileHash !== (existing.fileHash ?? "")) {
      return NextResponse.json(
        {
          success: false,
          error:
            "[Stale Conflict] File bài nộp đã thay đổi sang phiên bản mới nhưng chưa được chấm hoặc giáo viên chưa xem lại.",
        },
        { status: 409 }
      );
    }

    if (typeof body.fileHash !== "string" || !body.fileHash.trim()) {
      return NextResponse.json(
        {
          success: false,
          error:
            "[Stale Conflict] Thiếu mã phiên bản file (fileHash) đã xem trong yêu cầu duyệt.",
        },
        { status: 409 }
      );
    }

    if (
      typeof body.fileHash === "string" &&
      body.fileHash.trim() !== String(existing.fileHash || "").trim()
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "[Stale Conflict] Phiên bản file bài nộp (fileHash) trong yêu cầu duyệt đã cũ so với file hiện tại trong DB. Vui lòng kiểm tra lại bài nộp trước khi duyệt.",
        },
        { status: 409 }
      );
    }

    const existingCleanFeedback = sanitizeFeedbackHtml(existing.feedbackHtml || "");
    if (
      typeof body.feedbackHtml !== "string" ||
      sanitizeFeedbackHtml(body.feedbackHtml) !== existingCleanFeedback
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "[Stale Conflict] Nội dung nhận xét trong yêu cầu duyệt thiếu hoặc đã cũ so với bản mới nhất trong DB. Vui lòng kiểm tra lại trước khi duyệt.",
        },
        { status: 409 }
      );
    }

    if (!Array.isArray(body.criteriaGrades)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "[Stale Conflict] Thiếu danh sách điểm tiêu chí (criteriaGrades) đã xem trong yêu cầu duyệt.",
        },
        { status: 409 }
      );
    }
    const existingAudit = auditCriterionGrades(existingCriteria, lockedRubric);
    if (
      existingAudit.valid &&
      JSON.stringify(auditResult.auditedCriteria) !==
        JSON.stringify(existingAudit.auditedCriteria)
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "[Stale Conflict] Điểm tiêu chí trong yêu cầu duyệt đã cũ so với bản mới nhất trong DB. Vui lòng kiểm tra lại trước khi duyệt.",
        },
        { status: 409 }
      );
    }

    if (
      !Object.prototype.hasOwnProperty.call(body, "teacherOverrideScore") ||
      (body.teacherOverrideScore !== null &&
        (typeof body.teacherOverrideScore !== "number" ||
          !Number.isFinite(body.teacherOverrideScore))) ||
      (body.teacherOverrideScore ?? null) !== (existing.teacherOverrideScore ?? null)
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "[Stale Conflict] Điểm chỉnh sửa trong yêu cầu duyệt thiếu hoặc không khớp với bản mới nhất trong DB.",
        },
        { status: 409 }
      );
    }

    if (
      typeof body.decision !== "string" ||
      (body.decision !== "GRADE" && body.decision !== "REDO") ||
      body.decision !== (existing.decision || "GRADE")
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "[Stale Conflict] Quyết định chấm (GRADE/REDO) trong yêu cầu duyệt thiếu hoặc không khớp với bản mới nhất trong DB.",
        },
        { status: 409 }
      );
    }

    const criteriaGradesJson = JSON.stringify(auditResult.auditedCriteria);
    const calculatedScore = calculateTotalScoreFromCriteria(auditResult.auditedCriteria);
    const teacherOverrideScore = existing.teacherOverrideScore ?? null;

    const effectiveScore =
      typeof teacherOverrideScore === "number" && Number.isFinite(teacherOverrideScore)
        ? teacherOverrideScore
        : calculatedScore;

    if (!Number.isFinite(effectiveScore) || effectiveScore < 0 || effectiveScore > 100) {
      return NextResponse.json(
        { success: false, error: `Tổng điểm duyệt (${effectiveScore}) phải nằm trong [0, 100].` },
        { status: 400 }
      );
    }

    const decision: "GRADE" | "REDO" =
      existing.decision === "REDO" ? "REDO" : "GRADE";
    const feedbackHtml = existingCleanFeedback;

    if (!feedbackHtml) {
      return NextResponse.json(
        {
          success: false,
          error: "Không thể duyệt bài chấm khi nội dung Nhận xét (feedbackHtml) đang trống.",
        },
        { status: 400 }
      );
    }

    const recordToApprove: HomeworkSubmissionRecord = {
      ...existing,
      criteriaGradesJson,
      calculatedScore,
      teacherOverrideScore,
      decision,
      feedbackHtml,
      status: "APPROVED",
      verifiedAt: null,
      errorMessage: null,
    };
    recordToApprove.contentHash = computeHomeworkContentHash(recordToApprove);

    homeworkSubmissionRepo.upsert(recordToApprove);
    const saved = homeworkSubmissionRepo.findBySubmissionId(submissionId);

    return NextResponse.json({
      success: true,
      data: saved,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
