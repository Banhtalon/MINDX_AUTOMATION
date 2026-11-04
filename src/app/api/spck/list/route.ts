import { NextResponse } from "next/server";
import { getQuickTags, getRunningClasses } from "@/lib/db/json-config";
import { taskQueue } from "@/lib/queue/task-queue";
import { ensureQueueNotStopped } from "@/lib/teaching/teaching-http-client";
import {
  getDb,
  getSpckStageInfo,
  isDefaultSpckProductTitle,
  isValidSpckSessionSlot,
  spckSessionRepo,
  spckUploadRepo,
  studentRepo,
  validateSpckTitleLength,
  type SpckSessionSlotNumber,
} from "@/lib/db/sqlite";
import {
  classifySpckRelatedLink,
  inspectSpckThumbnail,
} from "@/lib/local-files/spck-scanner";
import { resolveValidAppShotResources } from "@/lib/local-files/spck-app-screenshotter";
import {
  getDemoSheetTitleForClass,
  getSavedCourseTemplatePath,
  resolveSession14DemoDate,
} from "@/lib/playwright/spck-demo-sheet";
import {
  CODING_SPCK_COURSE_FOLDER_MAP,
  detectCoursePrefixFromClassId,
} from "@/lib/playwright/spck-drive-uploader";
import {
  ClassSyncer,
  FINISHED_CLASS_GRACE_DAYS,
  isFinishedClassWithinGraceWindow,
  resolveClassSession14DateInfo,
} from "@/lib/playwright/sync-class";
import { validateLocalRequest } from "@/lib/security/local-guard";
import {
  isSyntheticClassCode,
  listStudents,
  queryClassDirectory,
} from "@/lib/classes/class-directory";

function getClassDemoSheetMeta(classId: string) {
  if (!classId) return null;
  const coursePrefix = detectCoursePrefixFromClassId(classId);
  const sheetTitle = getDemoSheetTitleForClass(classId);
  const { demoDate, evalDate } = resolveSession14DemoDate(classId);
  const hasCourseDemoTemplate = Boolean(getSavedCourseTemplatePath(classId));
  const hasCourseDriveFolder = Boolean(
    coursePrefix && CODING_SPCK_COURSE_FOLDER_MAP[coursePrefix]
  );
  let latestDemoSheetUrl = "";
  try {
    const row = getDb()
      .prepare(
        `SELECT message FROM job_logs WHERE classId = ? AND jobType = 'SPCK_DEMO_SHEET' AND level = 'SUCCESS' ORDER BY id DESC LIMIT 1`
      )
      .get(classId) as { message?: string } | undefined;
    const match = row?.message?.match(
      /https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9_-]+\/[^\s]*/
    );
    if (match) {
      latestDemoSheetUrl = match[0];
    }
  } catch {
    // ignore
  }
  return {
    coursePrefix,
    sheetTitle,
    demoDate,
    evalDate,
    latestDemoSheetUrl,
    spckExempt: false,
    hasCourseDemoTemplate,
    hasCourseDriveFolder,
  };
}

export function buildEnrichedClassSpckRecords(
  classId: string,
  sessionNumber: SpckSessionSlotNumber = 12
) {
  if (!classId) return [];
  const rawRecords = spckUploadRepo.findByClass(classId);
  const students = listStudents(classId, { activeOnly: false });
  const studentMap = new Map(students.map((s) => [s.studentId, s]));

  return rawRecords.map((rec) => {
    const stu = studentMap.get(rec.studentId);
    const sessRow = spckSessionRepo.getOrInitSessionDraft(
      classId,
      rec.studentId,
      sessionNumber,
      stu?.fullName
    );
    const sessionHistory = spckSessionRepo.buildStudentSessionHistorySummary(
      classId,
      rec.studentId
    );
    let activeThumb = sessRow.thumbnailPath || rec.thumbnailPath || "";
    const activeTitle = sessRow.projectTitle || rec.projectTitle || "";
    const activeComment = sessRow.teacherComment ?? "";
    let activeScreensJson = sessRow.screenshotsJson || rec.screenshotsJson || "[]";
    const activeAttachJson = sessRow.attachmentsJson || rec.attachmentsJson || "[]";
    const activeYtJson = sessRow.youtubeUrlsJson || rec.youtubeUrlsJson || "[]";
    const activeLinksJson = sessRow.relatedLinksJson || rec.relatedLinksJson || "[]";

    if (
      sessRow.draftStatus !== "APPROVED" &&
      sessRow.draftStatus !== "VERIFIED" &&
      !sessRow.lastVerifiedAt
    ) {
      let parsedActiveScreens: string[] = [];
      try {
        const p = JSON.parse(activeScreensJson);
        if (Array.isArray(p)) parsedActiveScreens = p;
      } catch {}
      const healedRes = resolveValidAppShotResources({
        localFolderPath: sessRow.localFolderPath || rec.localFolderPath,
        thumbnailPath: activeThumb,
        screenshots: parsedActiveScreens,
      });
      if (healedRes.healed) {
        activeThumb = healedRes.thumbnailPath;
        activeScreensJson = JSON.stringify(healedRes.screenshots);
        try {
          const db = getDb();
          db.prepare(
            `UPDATE spck_session_submissions
             SET thumbnailPath = ?, screenshotsJson = ?
             WHERE classId = ? AND studentId = ? AND sessionNumber = ?`
          ).run(
            activeThumb,
            activeScreensJson,
            classId,
            rec.studentId,
            sessionNumber
          );
          if (rec.status !== "APPROVED" && rec.status !== "VERIFIED") {
            db.prepare(
              `UPDATE spck_uploads
               SET thumbnailPath = ?, screenshotsJson = ?
               WHERE classId = ? AND studentId = ?`
            ).run(activeThumb, activeScreensJson, classId, rec.studentId);
          }
        } catch {}
      }
    }

    let classifiedLinks: Array<{
      name: string;
      url: string;
      category: string;
      categoryLabel: string;
    }> = [];
    try {
      const parsed = JSON.parse(activeLinksJson);
      if (Array.isArray(parsed)) {
        classifiedLinks = parsed
          .filter((l) => l && l.url)
          .map((l) => {
            const cls = classifySpckRelatedLink(l);
            return {
              name: String(l.name || l.url),
              url: String(l.url),
              category: cls.category,
              categoryLabel: cls.categoryLabel,
            };
          });
      }
    } catch {}

    const titleCheck = validateSpckTitleLength(activeTitle, sessionNumber);
    const isDefaultTitle = isDefaultSpckProductTitle(activeTitle, stu?.fullName);
    const thumbInspection = inspectSpckThumbnail(activeThumb);

    return {
      ...rec,
      sessionNumber,
      projectTitle: activeTitle,
      thumbnailPath: activeThumb,
      screenshotsJson: activeScreensJson,
      attachmentsJson: activeAttachJson,
      youtubeUrlsJson: activeYtJson,
      relatedLinksJson: JSON.stringify(classifiedLinks),
      teacherComment: activeComment,
      teacherNote: sessRow.teacherNote || "",
      quickTagsJson: sessRow.quickTagsJson || "[]",
      draftVersion: sessRow.draftVersion,
      status: sessRow.draftStatus,
      contentHash: sessRow.approvedContentHash || (rec.approvedSessionNumber === sessionNumber ? rec.contentHash : "") || "",
      hasNewerSharedResources: spckSessionRepo.hasNewerSharedResources(rec, sessRow),
      thumbnailInspection: thumbInspection,
      classifiedRelatedLinks: classifiedLinks,
      titleValidation: {
        ...titleCheck,
        isDefaultProductTitle: isDefaultTitle,
      },
      sessionHistory,
    };
  });
}

export interface SpckClassOption {
  classId: string;
  className: string;
  currentSessionNumber: number;
  maxSessionNumber: number;
  spckSessions: number[];
  status?: string;
  session14Date?: string;
}

function queryEligibleSpckClasses(
  minSessionNumber = 12,
  allowedClassCodes?: Set<string>,
  includeSynthetic = false
): {
  eligibleClasses: SpckClassOption[];
  allClassesMap: Map<string, SpckClassOption>;
} {
  const { classes, allClassesMap } = queryClassDirectory({
    scope: "spck",
    minSessionNumber,
    allowedClassCodes,
    includeSynthetic,
  });
  return { eligibleClasses: classes, allClassesMap };
}

export async function GET(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const url = new URL(req.url);
    const rawClassId = url.searchParams.get("classId") || "";
    const rawSessionParam = url.searchParams.get("sessionNumber");
    const classId = rawClassId.trim().toUpperCase();

    if (
      rawSessionParam !== null &&
      rawSessionParam.trim() !== "" &&
      !isValidSpckSessionSlot(rawSessionParam)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: `Buổi nộp SPCK không hợp lệ (${rawSessionParam}). Chỉ chấp nhận buổi 12, 13 hoặc 14.`,
        },
        { status: 400 }
      );
    }

    const { eligibleClasses } = queryEligibleSpckClasses(
      12,
      undefined,
      Boolean(classId && isSyntheticClassCode(classId))
    );
    const targetClassId = classId || eligibleClasses[0]?.classId || "";
    const matchedClass = eligibleClasses.find((c) => c.classId === targetClassId);

    const activeSessionNumber: SpckSessionSlotNumber =
      rawSessionParam && isValidSpckSessionSlot(rawSessionParam)
        ? (Number(rawSessionParam) as SpckSessionSlotNumber)
        : matchedClass && isValidSpckSessionSlot(matchedClass.currentSessionNumber)
        ? (matchedClass.currentSessionNumber as SpckSessionSlotNumber)
        : 13;

    const stageInfo = getSpckStageInfo(activeSessionNumber);
    const students = targetClassId
      ? listStudents(targetClassId, { activeOnly: false })
      : [];
    const spckRecords = targetClassId
      ? buildEnrichedClassSpckRecords(targetClassId, activeSessionNumber)
      : [];
    const quickTags = getQuickTags();

    return NextResponse.json({
      success: true,
      classes: eligibleClasses,
      selectedClassId: targetClassId,
      selectedSessionNumber: activeSessionNumber,
      stageInfo,
      spckSessions: [12, 13, 14],
      students,
      records: spckRecords,
      quickTags,
      demoSheetMeta: getClassDemoSheetMeta(targetClassId),
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

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json().catch(() => ({}));
    const forceResyncAll = Boolean(body?.forceResyncAll);

    if (
      body?.sessionNumber !== undefined &&
      body?.sessionNumber !== null &&
      body?.sessionNumber !== "" &&
      !isValidSpckSessionSlot(body.sessionNumber)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: `Buổi nộp SPCK không hợp lệ (${String(body.sessionNumber)}). Chỉ chấp nhận buổi 12, 13 hoặc 14.`,
        },
        { status: 400 }
      );
    }

    const { runningList, syncedClassCodes, allowedRunningSet } =
      await taskQueue.enqueue({
        id: `spck_list_sync_${Date.now()}`,
        jobType: "SYNC_CLASS",
        description:
          "Quét và đồng bộ danh sách lớp đủ điều kiện nộp SPCK trên LMS",
        execute: async () => {
          ensureQueueNotStopped();
          const runningRes = await ClassSyncer.fetchRunningClasses({
            persistToConfig: false,
          });
          ensureQueueNotStopped();
          const list =
            runningRes.classes && runningRes.classes.length > 0
              ? runningRes.classes.map((c) => ({ ...c }))
              : getRunningClasses().map((c) => ({ ...c }));

          const { allClassesMap: beforeMap } = queryEligibleSpckClasses(12);
          const syncedCodes: string[] = [];
          const allowedSet = new Set<string>();

          for (const item of list) {
            ensureQueueNotStopped();
            const code = (item.classCode || "").trim().toUpperCase();
            if (!code) continue;
            const existingMeta = beforeMap.get(code);
            const isFinished = item.status === "Finished";

            if (isFinished) {
              const s14InfoBefore = resolveClassSession14DateInfo(
                code,
                item.endDate
              );
              const hasStudents = studentRepo.findByClass(code, false).length > 0;
              const needsFinishedSync =
                !existingMeta ||
                !s14InfoBefore.isExactSession14 ||
                !hasStudents;
              if (needsFinishedSync) {
                ensureQueueNotStopped();
                const syncRes = await ClassSyncer.syncClass(code);
                ensureQueueNotStopped();
                if (syncRes.success) {
                  syncedCodes.push(code);
                }
              }
              const postGrace = isFinishedClassWithinGraceWindow(
                code,
                item.endDate,
                FINISHED_CLASS_GRACE_DAYS
              );
              if (postGrace.withinWindow) {
                allowedSet.add(code);
                item.endDate = postGrace.session14Date || item.endDate;
              }
              continue;
            }

            allowedSet.add(code);
            const needsSync =
              !existingMeta ||
              existingMeta.currentSessionNumber === 0 ||
              existingMeta.currentSessionNumber >= 10 ||
              (forceResyncAll &&
                String(body?.classId || "").trim().toUpperCase() === code);
            if (needsSync) {
              ensureQueueNotStopped();
              const syncRes = await ClassSyncer.syncClass(code);
              ensureQueueNotStopped();
              if (syncRes.success) {
                syncedCodes.push(code);
              }
            }
          }

          ensureQueueNotStopped();
          return {
            runningList: list,
            syncedClassCodes: syncedCodes,
            allowedRunningSet: allowedSet,
          };
        },
      });

    ensureQueueNotStopped();

    const requestedClassId = String(body?.classId || "").trim().toUpperCase();
    const allowSynthetic =
      Boolean(requestedClassId && isSyntheticClassCode(requestedClassId)) ||
      Array.from(allowedRunningSet).some((code) => isSyntheticClassCode(code));
    const { eligibleClasses } = queryEligibleSpckClasses(
      12,
      allowedRunningSet,
      allowSynthetic
    );
    const targetClassId =
      requestedClassId && eligibleClasses.some((c) => c.classId === requestedClassId)
        ? requestedClassId
        : eligibleClasses[0]?.classId || "";

    const matchedClass = eligibleClasses.find((c) => c.classId === targetClassId);
    const activeSessionNumber: SpckSessionSlotNumber =
      body?.sessionNumber && isValidSpckSessionSlot(body.sessionNumber)
        ? (Number(body.sessionNumber) as SpckSessionSlotNumber)
        : matchedClass && isValidSpckSessionSlot(matchedClass.currentSessionNumber)
        ? (matchedClass.currentSessionNumber as SpckSessionSlotNumber)
        : 13;

    const stageInfo = getSpckStageInfo(activeSessionNumber);
    const students = targetClassId
      ? listStudents(targetClassId, { activeOnly: false })
      : [];
    const spckRecords = targetClassId
      ? buildEnrichedClassSpckRecords(targetClassId, activeSessionNumber)
      : [];

    return NextResponse.json({
      success: true,
      totalRunningClasses: runningList.length,
      syncedClassCodes,
      classes: eligibleClasses,
      selectedClassId: targetClassId,
      selectedSessionNumber: activeSessionNumber,
      stageInfo,
      spckSessions: [12, 13, 14],
      students,
      records: spckRecords,
      quickTags: getQuickTags(),
      demoSheetMeta: getClassDemoSheetMeta(targetClassId),
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
