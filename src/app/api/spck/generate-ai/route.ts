import { NextResponse } from "next/server";
import {
  assertClassHasSpckSession,
  formatSpckSessionTitle,
  getSession14DemoLimitsForClass,
  isDefaultSpckProductTitle,
  parseSession14DemoScores,
  session14EvalRepo,
  spckSessionRepo,
  spckUploadRepo,
  studentRepo,
} from "@/lib/db/sqlite";
import {
  SpckCommentGenerator,
  type SpckStudentCommentInput,
} from "@/lib/gemini/spck-comment";
import {
  buildAutoSuggestedSpckBaseTitle,
  inspectStudentProjectCodeSignals,
} from "@/lib/local-files/spck-scanner";
import { validateLocalRequest } from "@/lib/security/local-guard";
import {
  isPresentationQuickTag,
  suggestSession14PresentationTagFromDemoScore,
  suggestSpckQuickTagsFromProject,
} from "@/lib/spck/spck-quick-tags";
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
    const demoLimits =
      stageInfo.sessionNumber === 14 ? getSession14DemoLimitsForClass(classId) : undefined;

    const inputs: SpckStudentCommentInput[] = [];
    for (let idx = 0; idx < rawStudents.length; idx++) {
      const s = rawStudents[idx];
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

      let sessDraft = spckSessionRepo.getOrInitSessionDraft(
        classId,
        studentId,
        stageInfo.sessionNumber,
        dbStu.fullName
      );
      const dbSpck = spckUploadRepo.findOne(classId, studentId);
      const effectiveFolderPath = String(
        s?.localFolderPath || sessDraft.localFolderPath || dbSpck?.localFolderPath || ""
      ).trim();

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

      // 1. Auto-upgrade default "SPCK <Tên>" title using real topic extracted from HTML/GameMaker/Python/Scratch
      let resolvedProjectTitle = String(
        s?.projectTitle || sessDraft.projectTitle || dbSpck?.projectTitle || `SPCK ${dbStu.fullName}`
      ).trim();
      let didMutateUnapprovedDraft = false;

      if (effectiveFolderPath && isDefaultSpckProductTitle(resolvedProjectTitle, dbStu.fullName)) {
        try {
          const suggestedBase = buildAutoSuggestedSpckBaseTitle(effectiveFolderPath, dbStu.fullName);
          if (suggestedBase && !isDefaultSpckProductTitle(suggestedBase, dbStu.fullName)) {
            const upgradedSessionTitle = formatSpckSessionTitle(
              suggestedBase,
              stageInfo.sessionNumber,
              dbStu.fullName
            );
            resolvedProjectTitle = upgradedSessionTitle;
            if (
              !sessDraft.lastVerifiedAt &&
              sessDraft.draftStatus !== "APPROVED" &&
              sessDraft.draftStatus !== "VERIFIED" &&
              sessDraft.draftStatus !== "SAVING"
            ) {
              const savedTitleRes = spckSessionRepo.saveSessionDraft({
                classId,
                studentId,
                sessionNumber: stageInfo.sessionNumber,
                projectTitle: upgradedSessionTitle,
                updateSharedPool:
                  !dbSpck?.projectTitle ||
                  isDefaultSpckProductTitle(dbSpck.projectTitle, dbStu.fullName),
              });
              sessDraft = savedTitleRes.record;
              didMutateUnapprovedDraft = true;
            }
          }
        } catch {
          // Keep existing fallback title if folder cannot be read
        }
      }

      const dbQuickTags: string[] = (() => {
        try {
          const parsed = sessDraft.quickTagsJson ? JSON.parse(sessDraft.quickTagsJson) : [];
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })();
      let resolvedQuickTags: string[] =
        Array.isArray(s?.quickTags) && s.quickTags.length > 0
          ? s.quickTags.map((t: unknown) => String(t || "").trim()).filter(Boolean)
          : dbQuickTags;
      const resolvedTeacherNote =
        String(s?.teacherNote || "").trim() || String(sessDraft.teacherNote || "").trim();

      // 2. Auto-suggest Quick Tags:
      // - In Session 14 when BGK Demo score exists (`demoTotalScore > 0`), ensure both presentation tag (from `communication` score)
      //   and verified product observation tags are populated so 1 click generates the 2-part Session 14 comment.
      // - When `body.autoSuggestQuickTags === true`, also auto-suggest verified code tags on Sessions 12/13/14 if empty.
      const s14Eval =
        stageInfo.sessionNumber === 14
          ? session14EvalRepo.findOne(classId, studentId)
          : undefined;
      const hasS14DemoScore = Boolean(s14Eval && Number(s14Eval.demoTotalScore) > 0);
      const parsedS14Demo =
        hasS14DemoScore && s14Eval
          ? parseSession14DemoScores(s14Eval.demoScoresJson, classId)
          : undefined;
      const shouldAutoSuggestTags =
        (stageInfo.sessionNumber === 14 && hasS14DemoScore) ||
        (body?.autoSuggestQuickTags === true && resolvedQuickTags.length === 0);

      if (shouldAutoSuggestTags) {
        let nextTags = [...resolvedQuickTags];
        if (stageInfo.sessionNumber === 14 && hasS14DemoScore && demoLimits && parsedS14Demo) {
          const hasPresTag = nextTags.some((t) => isPresentationQuickTag(t));
          if (!hasPresTag) {
            const presTag = suggestSession14PresentationTagFromDemoScore(
              Number(parsedS14Demo.communication || 0),
              demoLimits.communication
            );
            if (presTag) {
              nextTags = [presTag, ...nextTags];
            }
          }
        }

        const hasProductTag = nextTags.some((t) => !isPresentationQuickTag(t));
        if (!hasProductTag && effectiveFolderPath) {
          try {
            const signals = inspectStudentProjectCodeSignals(
              effectiveFolderPath,
              Array.isArray(attachments) ? attachments : []
            );
            const codeSuggested = suggestSpckQuickTagsFromProject({
              classId,
              sessionNumber: stageInfo.sessionNumber,
              screenshotCount: Array.isArray(screenshots) ? screenshots.length : 0,
              attachmentCount: Array.isArray(attachments) ? attachments.length : 0,
              youtubeCount: Array.isArray(youtubeUrls) ? youtubeUrls.length : 0,
              ...signals,
              demoCommunicationScore: parsedS14Demo
                ? Number(parsedS14Demo.communication || 0)
                : undefined,
              demoCommunicationMax: demoLimits?.communication,
              includeSession14ProductEvidence: stageInfo.sessionNumber === 14 && hasS14DemoScore,
            });
            for (const tag of codeSuggested) {
              if (!nextTags.includes(tag) && nextTags.length < 4) {
                nextTags.push(tag);
              }
            }
          } catch {
            // Keep existing tags if code inspection fails
          }
        }

        if (nextTags.length > resolvedQuickTags.length) {
          resolvedQuickTags = nextTags;
          if (
            !sessDraft.lastVerifiedAt &&
            sessDraft.draftStatus !== "APPROVED" &&
            sessDraft.draftStatus !== "VERIFIED" &&
            sessDraft.draftStatus !== "SAVING"
          ) {
            const savedTagsRes = spckSessionRepo.saveSessionDraft({
              classId,
              studentId,
              sessionNumber: stageInfo.sessionNumber,
              quickTagsJson: JSON.stringify(resolvedQuickTags),
              updateSharedPool: false,
            });
            sessDraft = savedTagsRes.record;
            didMutateUnapprovedDraft = true;
          }
        }
      }

      const callerExpectedVersion =
        typeof s?.expectedVersion === "number" && Number.isFinite(s.expectedVersion)
          ? s.expectedVersion
          : undefined;
      // If we just upgraded title/tags on an unapproved draft AND caller's expectedVersion matched prior version,
      // align expectedVersion with the updated draftVersion so SpckCommentGenerator doesn't trigger a false self-conflict!
      const effectiveExpectedVersion =
        didMutateUnapprovedDraft && callerExpectedVersion !== undefined
          ? sessDraft.draftVersion
          : callerExpectedVersion;

      const resolvedIncludePresentation =
        typeof s?.includePresentation === "boolean"
          ? s.includePresentation
          : stageInfo.sessionNumber === 14 &&
            (hasS14DemoScore || resolvedQuickTags.some((t) => isPresentationQuickTag(t)))
          ? true
          : undefined;

      inputs.push({
        studentId,
        fullName: dbStu.fullName,
        projectTitle: resolvedProjectTitle,
        localFolderPath: effectiveFolderPath,
        thumbnailPath: s?.thumbnailPath || sessDraft.thumbnailPath || dbSpck?.thumbnailPath || "",
        screenshots,
        attachments,
        youtubeUrls,
        relatedLinks,
        quickTags: resolvedQuickTags,
        teacherNote: resolvedTeacherNote,
        includePresentation: resolvedIncludePresentation,
        expectedVersion: effectiveExpectedVersion,
        priorSession12Summary:
          typeof s?.priorSession12Summary === "string"
            ? s.priorSession12Summary
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
