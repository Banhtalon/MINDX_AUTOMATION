import { NextResponse } from "next/server";
import {
  assertClassHasSpckSession,
  spckSessionRepo,
  spckUploadRepo,
  studentRepo,
} from "@/lib/db/sqlite";
import {
  SpckCommentGenerator,
  type SpckStudentCommentInput,
} from "@/lib/gemini/spck-comment";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { buildEnrichedClassSpckRecords } from "../list/route";

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const classId = String(body?.classId || "").trim().toUpperCase();
    const rawStudents: any[] = Array.isArray(body?.students) ? body.students : [];

    if (!classId || rawStudents.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Thiếu classId hoặc danh sách học viên (students) để AI soạn nhận xét.",
        },
        { status: 400 }
      );
    }

    let stageInfo;
    try {
      stageInfo = assertClassHasSpckSession(
        classId,
        body?.sessionNumber,
        "API /api/spck/generate-ai"
      );
    } catch (err) {
      return NextResponse.json(
        {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        },
        { status: 400 }
      );
    }

    const classStudents = studentRepo.findByClass(classId, false);
    const studentMap = new Map(classStudents.map((s) => [s.studentId, s]));

    const inputs: SpckStudentCommentInput[] = [];
    for (const s of rawStudents) {
      const studentId = String(s?.studentId || "").trim();
      const dbStu = studentMap.get(studentId);
      if (!dbStu) {
        return NextResponse.json(
          {
            success: false,
            error: `Học viên "${studentId}" không thuộc lớp ${classId}.`,
          },
          { status: 400 }
        );
      }

      const sessDraft = spckSessionRepo.getOrInitSessionDraft(
        classId,
        studentId,
        stageInfo.sessionNumber,
        dbStu.fullName
      );
      const dbSpck = spckUploadRepo.findOne(classId, studentId);
      const screenshots =
        s?.screenshots ||
        (sessDraft.screenshotsJson
          ? JSON.parse(sessDraft.screenshotsJson)
          : dbSpck?.screenshotsJson
          ? JSON.parse(dbSpck.screenshotsJson)
          : []);
      const attachments =
        s?.attachments ||
        (sessDraft.attachmentsJson
          ? JSON.parse(sessDraft.attachmentsJson)
          : dbSpck?.attachmentsJson
          ? JSON.parse(dbSpck.attachmentsJson)
          : []);
      const youtubeUrls =
        s?.youtubeUrls ||
        (sessDraft.youtubeUrlsJson
          ? JSON.parse(sessDraft.youtubeUrlsJson)
          : dbSpck?.youtubeUrlsJson
          ? JSON.parse(dbSpck.youtubeUrlsJson)
          : []);
      const relatedLinks =
        s?.relatedLinks ||
        (sessDraft.relatedLinksJson
          ? JSON.parse(sessDraft.relatedLinksJson)
          : dbSpck?.relatedLinksJson
          ? JSON.parse(dbSpck.relatedLinksJson)
          : []);

      inputs.push({
        studentId,
        fullName: dbStu.fullName,
        projectTitle:
          s?.projectTitle || sessDraft.projectTitle || dbSpck?.projectTitle || `SPCK ${dbStu.fullName}`,
        localFolderPath: s?.localFolderPath || sessDraft.localFolderPath || dbSpck?.localFolderPath || "",
        thumbnailPath: s?.thumbnailPath || sessDraft.thumbnailPath || dbSpck?.thumbnailPath || "",
        screenshots,
        attachments,
        youtubeUrls,
        relatedLinks,
        quickTags: Array.isArray(s?.quickTags) ? s.quickTags : [],
        teacherNote: String(s?.teacherNote || ""),
        includePresentation:
          typeof s?.includePresentation === "boolean" ? s.includePresentation : undefined,
        expectedVersion:
          typeof s?.expectedVersion === "number" && Number.isFinite(s.expectedVersion)
            ? s.expectedVersion
            : undefined,
      });
    }

    const results = await SpckCommentGenerator.generateBatchSpckComments(
      {
        classId,
        sessionNumber: stageInfo.sessionNumber,
        courseName: body?.courseName || classId,
      },
      inputs
    );

    const updatedRecords = buildEnrichedClassSpckRecords(
      classId,
      stageInfo.sessionNumber
    );

    return NextResponse.json({
      success: true,
      sessionNumber: stageInfo.sessionNumber,
      stageNumber: stageInfo.stageNumber,
      stageCode: stageInfo.stageCode,
      stageLabel: stageInfo.stageLabel,
      results,
      records: updatedRecords,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
