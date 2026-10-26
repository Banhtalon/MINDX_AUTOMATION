import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { taskQueue } from "@/lib/queue/task-queue";
import {
  SubmissionDownloader,
  type DownloadSubmissionsBatchResult,
} from "@/lib/playwright/download-submissions";
import {
  HomeworkAiGrader,
  type HomeworkGradeCandidateInput,
  type HomeworkGradeItemResult,
} from "@/lib/gemini/homework-grader";
import {
  homeworkSubmissionRepo,
  studentRepo,
  classSessionRepo,
} from "@/lib/db/sqlite";
import {
  getGradingRubrics,
  findLessonInSyllabus,
  type GradingRubric,
} from "@/lib/db/json-config";

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const classId = String(body.classId || "").trim().toUpperCase();
    const classCode = String(body.classCode || classId).trim().toUpperCase();
    const sessionId = String(body.sessionId || "").trim();
    const lessonId = body.lessonId ? String(body.lessonId).trim() : undefined;
    const studentId = body.studentId ? String(body.studentId).trim() : undefined;
    const skipDownload = Boolean(body.skipDownload);
    const skipAi = Boolean(body.skipAi);

    if (!classId || !sessionId || classId !== classCode) {
      return NextResponse.json(
        {
          success: false,
          error: "Thiếu hoặc không khớp mã lớp (classId/classCode) và mã buổi học (sessionId).",
        },
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

    // 1. Download & Parse submissions via SequentialTaskQueue unless skipDownload is requested
    let downloadResult: DownloadSubmissionsBatchResult | null = null;
    if (!skipDownload) {
      downloadResult = await taskQueue.enqueue({
        id: `download_subs_${classCode}_${sessionId}_${Date.now()}`,
        jobType: "GRADE_HOMEWORK",
        description: `Tải file bài nộp lớp ${classCode} (${sessionId}) từ LMS`,
        classId,
        sessionId,
        execute: async () => {
          return SubmissionDownloader.downloadLessonSubmissions({
            classId,
            classCode,
            sessionId,
            lessonId,
            sessionNumber,
            studentId,
          });
        },
      });

      if (!downloadResult || !downloadResult.success) {
        return NextResponse.json(
          {
            success: false,
            error:
              downloadResult?.error ||
              `Tải bài nộp thất bại (${downloadResult?.failedCount || 0} bài lỗi). Đã dừng chấm AI để tránh chấm nhầm dữ liệu cũ.`,
            data: {
              downloadResult,
              gradeResults: [],
            },
          },
          { status: 502 }
        );
      }
    }

    // 2. If skipAi is true, return after download & parse
    if (skipAi) {
      return NextResponse.json({
        success: true,
        data: {
          downloadResult,
          gradeResults: [],
        },
      });
    }

    // 3. Resolve GradingRubric
    let rubric: GradingRubric | undefined = body.rubric;
    if (!rubric || !Array.isArray(rubric.criteria) || rubric.criteria.length === 0) {
      const allRubrics = getGradingRubrics();
      if (body.rubricId) {
        rubric = allRubrics.find((r) => r.rubricId === body.rubricId);
      }
      if (!rubric) {
        rubric =
          allRubrics.find(
            (r) =>
              classCode.includes(r.courseCode.toUpperCase()) &&
              r.sessionNumber === sessionNumber
          ) ||
          allRubrics.find((r) => classCode.includes(r.courseCode.toUpperCase())) ||
          allRubrics[0];
      }
    }

    if (!rubric || !Array.isArray(rubric.criteria) || rubric.criteria.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Chưa chọn hoặc chưa cấu hình Barem chấm điểm (Rubric) cho buổi học này.",
        },
        { status: 400 }
      );
    }

    const hasNumericCriteriaMax = rubric.criteria.some(
      (c: any) => typeof c?.maxPoints === "number" && Number.isFinite(c.maxPoints)
    );
    const hasNumericTotalMax =
      typeof rubric.maxTotalScore === "number" && Number.isFinite(rubric.maxTotalScore);
    if (hasNumericCriteriaMax || hasNumericTotalMax) {
      const criteriaSum =
        Math.round(
          rubric.criteria.reduce(
            (sum: number, c: any) =>
              sum + (typeof c?.maxPoints === "number" && Number.isFinite(c.maxPoints) ? c.maxPoints : 0),
            0
          ) * 100
        ) / 100;
      const declaredMax = hasNumericTotalMax ? Number(rubric.maxTotalScore) : criteriaSum;
      if (
        (hasNumericCriteriaMax && Math.abs(criteriaSum - 100) > 0.01) ||
        Math.abs(declaredMax - 100) > 0.01
      ) {
        return NextResponse.json(
          {
            success: false,
            error: `Barem chấm điểm '${rubric.rubricId || ""}' có thang điểm ${criteriaSum || declaredMax}/100, không khớp thang điểm 100 chuẩn của LMS. Vui lòng cập nhật barem về thang 100 trước khi chấm.`,
          },
          { status: 400 }
        );
      }
    }

    const isQueueStopped = () =>
      Boolean(
        taskQueue &&
          typeof (taskQueue as any).getStatus === "function" &&
          (taskQueue as any).getStatus()?.isStopped
      );

    if (isQueueStopped()) {
      return NextResponse.json(
        {
          success: false,
          stopped: true,
          error: "TASK_CANCELLED: Hàng đợi đang ở trạng thái Dừng khẩn cấp (Stop Bot).",
          data: {
            downloadResult,
            gradeResults: [],
            rubricUsed: rubric,
          },
        },
        { status: 409 }
      );
    }

    // 4. Build candidate list from SQLite homework_submissions for (classId, sessionId)
    const dbRecords = homeworkSubmissionRepo.findBySession(classId, sessionId);
    const dbStudents = studentRepo.findByClass(classId, false);
    const studentMap = new Map(dbStudents.map((s) => [s.studentId, s]));

    const downloadedSubIds =
      !skipDownload && downloadResult
        ? new Set(
            (downloadResult.items || [])
              .filter((item) => item.success && item.submissionId)
              .map((item) => item.submissionId)
          )
        : null;

    const targetRecords = dbRecords.filter((r) => {
      if (studentId && r.studentId !== studentId) return false;
      if (downloadedSubIds && !downloadedSubIds.has(r.submissionId)) return false;
      return true;
    });

    const candidates: HomeworkGradeCandidateInput[] = targetRecords.map((rec) => {
      const st = studentMap.get(rec.studentId);
      return {
        classId,
        classCode,
        sessionId,
        studentId: rec.studentId,
        fullName: st?.fullName || rec.studentId,
        submissionId: rec.submissionId,
        originalFileName: rec.originalFileName,
        localFilePath: rec.localFilePath,
      };
    });

    const syllabusLesson = findLessonInSyllabus(classCode, sessionNumber);
    const dbSessions = classSessionRepo.findByClass(classId);
    const matchedDbSession = dbSessions.find((s) => s.sessionId === sessionId);

    const gradeResults: HomeworkGradeItemResult[] =
      candidates.length > 0
        ? await HomeworkAiGrader.gradeBatchSubmissions(candidates, rubric, {
            sessionTopic:
              matchedDbSession?.topic || syllabusLesson?.topic || rubric.assignmentTitle,
            learnedConcepts: syllabusLesson?.keyKnowledge,
            shouldStop: isQueueStopped,
          })
        : [];

    if (isQueueStopped()) {
      return NextResponse.json(
        {
          success: false,
          stopped: true,
          error:
            "TASK_CANCELLED: Đã dừng lượt chấm bài AI theo lệnh Dừng khẩn cấp (Stop Bot).",
          data: {
            downloadResult,
            gradeResults,
            rubricUsed: rubric,
          },
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        downloadResult,
        gradeResults,
        rubricUsed: rubric,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
