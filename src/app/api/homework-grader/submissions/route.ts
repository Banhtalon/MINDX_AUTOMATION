import fs from "node:fs";
import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import {
  homeworkSubmissionRepo,
  studentRepo,
  scoreMatrixRepo,
  type HomeworkSubmissionRecord,
} from "@/lib/db/sqlite";
import { parseSubmissionFile } from "@/lib/file-parsers";
import {
  auditCriterionGrades,
  calculateTotalScoreFromCriteria,
} from "@/lib/gemini/score-auditor";
import { sanitizeFeedbackHtml } from "@/lib/gemini/homework-grader";
import { assertPathAllowed } from "@/lib/security/path-allowlist";

export async function GET(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const url = new URL(req.url);
    const classId = (url.searchParams.get("classId") || "").trim().toUpperCase();
    const sessionId = (url.searchParams.get("sessionId") || "").trim();
    const lessonIdParam = (url.searchParams.get("lessonId") || "").trim();

    if (!classId || !sessionId) {
      return NextResponse.json(
        { success: false, error: "Thiếu classId hoặc sessionId." },
        { status: 400 }
      );
    }

    const escapedClassId = classId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sessionMatch = sessionId.match(new RegExp(`^${escapedClassId}_SESS_(\\d+)$`, "i"));
    if (!sessionMatch) {
      return NextResponse.json(
        {
          success: false,
          error: `Mã buổi học '${sessionId}' không thuộc lớp '${classId}'.`,
        },
        { status: 400 }
      );
    }
    const sessionNumber = parseInt(sessionMatch[1], 10);

    const dbStudents = studentRepo.findByClass(classId, false);
    const studentMap = new Map(dbStudents.map((s) => [s.studentId, s]));

    const existingRecords = homeworkSubmissionRepo.findBySession(classId, sessionId);
    const bySubId = new Map<string, HomeworkSubmissionRecord>();
    for (const rec of existingRecords) {
      bySubId.set(rec.submissionId, rec);
    }

    // Merge un-downloaded submissions from cached score matrix if present
    const cachedMatrix = scoreMatrixRepo.findByClass(classId)?.matrix;
    if (cachedMatrix && Array.isArray(cachedMatrix.columns) && Array.isArray(cachedMatrix.rows)) {
      let targetCol = cachedMatrix.columns.find(
        (c: any) => Number(c.sessionNumber) === sessionNumber
      );
      if (lessonIdParam) {
        const byLesson = cachedMatrix.columns.find(
          (c: any) => c.columnId === lessonIdParam || c.lessonId === lessonIdParam
        );
        if (!byLesson || Number(byLesson.sessionNumber) !== sessionNumber) {
          return NextResponse.json(
            {
              success: false,
              error: `[Integrity Violation] lessonId '${lessonIdParam}' không thuộc buổi học '${sessionId}' (Buổi ${sessionNumber}).`,
            },
            { status: 400 }
          );
        }
        targetCol = byLesson;
      }

      if (targetCol) {
        for (const row of cachedMatrix.rows) {
          const cell = row.cells?.[targetCol.columnId];
          if (cell && cell.submissionId && cell.status !== "NOT_SUBMITTED") {
            const subId = String(cell.submissionId);
            if (!bySubId.has(subId)) {
              const att =
                Array.isArray(cell.attachments) && cell.attachments.length > 0
                  ? String(cell.attachments[0] || "")
                  : "";
              const fName = att ? att.split(/[\\/]/).pop() || "" : "";
              bySubId.set(subId, {
                classId,
                sessionId,
                studentId: row.studentId,
                submissionId: subId,
                originalFileName: fName,
                localFilePath: "",
                fileHash: "",
                parseStatus: "PENDING",
                parseErrorReason: null,
                criteriaGradesJson: "[]",
                calculatedScore: typeof cell.score === "number" ? cell.score : 0,
                teacherOverrideScore: null,
                decision: cell.status === "REDO_REQUESTED" ? "REDO" : "GRADE",
                feedbackHtml: cell.teacherNote || "",
                contentHash: "",
                status: "PENDING",
                verifiedAt: null,
                errorMessage: null,
              });
            }
          }
        }
      }
    }

    const items = Array.from(bySubId.values()).map((rec) => {
      const st = studentMap.get(rec.studentId);
      let criteriaGrades: any[] = [];
      try {
        criteriaGrades = JSON.parse(rec.criteriaGradesJson || "[]");
      } catch {}

      let codePreview = "";
      let subjectType = "UNKNOWN";
      if (rec.localFilePath) {
        try {
          const safePath = assertPathAllowed(rec.localFilePath);
          if (fs.existsSync(safePath)) {
            const parsed = parseSubmissionFile(safePath);
            subjectType = parsed.subjectType;
            codePreview = parsed.extractedText.slice(0, 12000);
          }
        } catch {}
      }

      return {
        ...rec,
        fullName: st?.fullName || rec.studentId,
        isActive: st ? Boolean(st.isActive) : true,
        criteriaGrades,
        codePreview,
        subjectType,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        classId,
        sessionId,
        sessionNumber,
        submissions: items,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const classId = String(body.classId || "").trim().toUpperCase();
    const sessionId = String(body.sessionId || "").trim();
    const studentId = String(body.studentId || "").trim();
    const submissionId = String(body.submissionId || "").trim();

    if (!classId || !sessionId || !studentId || !submissionId) {
      return NextResponse.json(
        {
          success: false,
          error: "Thiếu bộ định danh bắt buộc (classId, sessionId, studentId, submissionId).",
        },
        { status: 400 }
      );
    }

    if (body.status === "APPROVED" || body.status === "VERIFIED") {
      return NextResponse.json(
        {
          success: false,
          error: "Không thể đặt trạng thái APPROVED/VERIFIED qua API lưu nháp. Vui lòng gọi API /approve.",
        },
        { status: 400 }
      );
    }

    const existing = homeworkSubmissionRepo.findBySubmissionId(submissionId);
    if (existing) {
      if (
        existing.classId !== classId ||
        existing.sessionId !== sessionId ||
        existing.studentId !== studentId
      ) {
        return NextResponse.json(
          {
            success: false,
            error: `[Integrity Violation] submissionId '${submissionId}' không khớp bộ định danh (${classId}, ${sessionId}, ${studentId}).`,
          },
          { status: 400 }
        );
      }
    }

    let criteriaGradesJson = existing?.criteriaGradesJson || "[]";
    let calculatedScore = existing?.calculatedScore ?? 0;

    if (Array.isArray(body.criteriaGrades)) {
      let existingCriteria: any[] = [];
      try {
        existingCriteria = JSON.parse(existing?.criteriaGradesJson || "[]");
      } catch {
        existingCriteria = [];
      }
      const rubricSource =
        Array.isArray(body.rubric?.criteria) && body.rubric.criteria.length > 0
          ? body.rubric.criteria
          : existingCriteria;
      if (rubricSource.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Không thể cập nhật điểm tiêu chí khi bài nộp chưa có Barem khóa trong cơ sở dữ liệu.",
          },
          { status: 400 }
        );
      }
      const lockedCriteria = rubricSource.map((c: any) => ({
        criterionId: String(c?.criterionId || "").trim(),
        name: String(c?.criterionName || c?.name || c?.criterionId || "").trim(),
        maxPoints: Number(c?.maxPoints),
        description: String(c?.description || ""),
        expectedSnippetOrConcept: String(c?.expectedSnippetOrConcept || ""),
      }));
      const maxSum = lockedCriteria.reduce(
        (s: number, c: any) => s + (Number.isFinite(c.maxPoints) ? c.maxPoints : 0),
        0
      );
      const auditRes = auditCriterionGrades(body.criteriaGrades, {
        criteria: lockedCriteria,
        maxTotalScore: maxSum > 0 ? maxSum : 100,
      });
      if (!auditRes.valid) {
        return NextResponse.json(
          { success: false, error: auditRes.errors.join(" | ") },
          { status: 400 }
        );
      }
      criteriaGradesJson = JSON.stringify(auditRes.auditedCriteria);
      calculatedScore = auditRes.calculatedScore;
    } else if (typeof body.calculatedScore === "number" && Number.isFinite(body.calculatedScore)) {
      if (body.calculatedScore < 0 || body.calculatedScore > 100) {
        return NextResponse.json(
          { success: false, error: "Điểm số phải nằm trong khoảng 0 - 100." },
          { status: 400 }
        );
      }
      calculatedScore = body.calculatedScore;
    }

    let teacherOverrideScore: number | null =
      existing?.teacherOverrideScore !== undefined ? existing.teacherOverrideScore : null;
    if ("teacherOverrideScore" in body) {
      if (body.teacherOverrideScore === null || body.teacherOverrideScore === "") {
        teacherOverrideScore = null;
      } else {
        const num = Number(body.teacherOverrideScore);
        if (!Number.isFinite(num) || num < 0 || num > 100) {
          return NextResponse.json(
            { success: false, error: "Điểm chỉnh sửa phải nằm trong khoảng 0 - 100." },
            { status: 400 }
          );
        }
        teacherOverrideScore = Math.round(num * 100) / 100;
      }
    }

    // Per-field sequence check persisted in SQLite metadata (survives route reload & prevents cross-field loss)
    let nextDraftSeq = (existing as any)?._draftSeq ?? 0;
    let fieldSeqMap: Record<string, number> = {};
    try {
      fieldSeqMap = JSON.parse((existing as any)?._fieldSeqJson || "{}");
    } catch {
      fieldSeqMap = {};
    }

    if (typeof body.draftSeq === "number" && Number.isFinite(body.draftSeq)) {
      const touchedFields: string[] = [];
      if (Array.isArray(body.criteriaGrades) || typeof body.calculatedScore === "number") {
        touchedFields.push("criteriaGrades");
      }
      if ("teacherOverrideScore" in body) {
        touchedFields.push("teacherOverrideScore");
      }
      if ("decision" in body) {
        touchedFields.push("decision");
      }
      if (typeof body.feedbackHtml === "string") {
        touchedFields.push("feedbackHtml");
      }
      if (touchedFields.length === 0) {
        touchedFields.push("_default");
      }

      for (const f of touchedFields) {
        const prevFieldSeq = fieldSeqMap[f] ?? 0;
        if (body.draftSeq <= prevFieldSeq) {
          return NextResponse.json(
            {
              success: false,
              staleIgnored: true,
              error:
                "[Stale Conflict] Yêu cầu lưu nháp cũ đến sau bản mới hơn đã bị bỏ qua để tránh ghi đè.",
            },
            { status: 409 }
          );
        }
      }

      for (const f of touchedFields) {
        fieldSeqMap[f] = body.draftSeq;
      }
      nextDraftSeq = Math.max(nextDraftSeq, body.draftSeq);
    }

    const decision: "GRADE" | "REDO" =
      body.decision === "REDO"
        ? "REDO"
        : body.decision === "GRADE"
        ? "GRADE"
        : existing?.decision || "GRADE";

    const feedbackHtml =
      typeof body.feedbackHtml === "string"
        ? sanitizeFeedbackHtml(body.feedbackHtml)
        : existing?.feedbackHtml ?? "";

    const hasVerifiedFile = Boolean(
      existing && existing.parseStatus === "PARSED" && String(existing.fileHash || "").trim()
    );
    const parseStatus =
      existing?.parseStatus === "PARSE_ERROR"
        ? "PARSE_ERROR"
        : hasVerifiedFile
        ? "PARSED"
        : "PENDING";

    const updatedRecord: HomeworkSubmissionRecord = {
      classId,
      sessionId,
      studentId,
      submissionId,
      originalFileName: existing?.originalFileName ?? body.originalFileName ?? "",
      localFilePath: existing?.localFilePath ?? "",
      fileHash: existing?.fileHash ?? "",
      parseStatus,
      parseErrorReason: existing?.parseErrorReason ?? null,
      criteriaGradesJson,
      calculatedScore,
      teacherOverrideScore,
      decision,
      feedbackHtml,
      contentHash: "",
      status: hasVerifiedFile ? "WAITING_APPROVAL" : "PENDING",
      verifiedAt: null,
      errorMessage: null,
    };

    homeworkSubmissionRepo.upsert({
      ...updatedRecord,
      _freshlyReviewed: true,
      _draftSeq: nextDraftSeq,
      _fieldSeqJson: JSON.stringify(fieldSeqMap),
    } as any);
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
