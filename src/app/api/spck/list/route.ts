import { NextResponse } from "next/server";
import { getQuickTags, getRunningClasses, saveRunningClasses } from "@/lib/db/json-config";
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
  const students = studentRepo.findByClass(classId, false);
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
    const activeThumb = sessRow.thumbnailPath || rec.thumbnailPath || "";
    const activeTitle = sessRow.projectTitle || rec.projectTitle || "";
    const activeComment = sessRow.teacherComment ?? "";
    const activeScreensJson = sessRow.screenshotsJson || rec.screenshotsJson || "[]";
    const activeAttachJson = sessRow.attachmentsJson || rec.attachmentsJson || "[]";
    const activeYtJson = sessRow.youtubeUrlsJson || rec.youtubeUrlsJson || "[]";
    const activeLinksJson = sessRow.relatedLinksJson || rec.relatedLinksJson || "[]";

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
  allowedClassCodes?: Set<string>
): {
  eligibleClasses: SpckClassOption[];
  allClassesMap: Map<string, SpckClassOption>;
} {
  const db = getDb();
  const rawRows = db
    .prepare(
      `SELECT
         classId,
         MAX(className) AS className,
         MAX(CASE WHEN TRIM(COALESCE(date, '')) <> '' THEN sessionNumber ELSE 0 END) AS activeSessionNumber,
         MAX(sessionNumber) AS maxSessionNumber
       FROM classes_sessions
       GROUP BY classId
       ORDER BY classId ASC`
    )
    .all() as Array<{
    classId: string;
    className: string;
    activeSessionNumber: number;
    maxSessionNumber: number;
  }>;

  const cachedRunningMap = new Map(
    getRunningClasses().map((c) => [c.classCode.trim().toUpperCase(), c])
  );

  const hasAnySyncedDate = rawRows.some((r) => Number(r.activeSessionNumber) > 0);
  const allClassesMap = new Map<string, SpckClassOption>();
  const eligibleClasses: SpckClassOption[] = [];

  for (const r of rawRows) {
    const upperId = r.classId.trim().toUpperCase();
    const isSyntheticTestClass = /^(TEST|AUDIT|R\d+|CLASS_|SYNTH)/i.test(upperId);
    const cachedItem = cachedRunningMap.get(upperId);
    const isFinishedStatus = cachedItem?.status === "Finished";

    const activeSess = Number(r.activeSessionNumber) || 0;
    const maxSess = Number(r.maxSessionNumber) || 0;
    let currentSessionNumber = hasAnySyncedDate ? activeSess : maxSess;
    if (isFinishedStatus && currentSessionNumber < 14 && maxSess >= 14) {
      currentSessionNumber = 14;
    }

    const graceCheck = isFinishedClassWithinGraceWindow(
      upperId,
      cachedItem?.endDate,
      FINISHED_CLASS_GRACE_DAYS
    );

    const resolvedStatus = isFinishedStatus
      ? "Finished"
      : cachedItem?.status === "Running"
      ? "Running"
      : !isSyntheticTestClass && graceCheck.isKnownDate && (graceCheck.daysSinceSession14 ?? -1) > 0
      ? "Finished"
      : "Running";

    // Real classes that have finished Buổi 14 more than FINISHED_CLASS_GRACE_DAYS (15 days) ago are excluded
    if (
      !isSyntheticTestClass &&
      resolvedStatus === "Finished" &&
      graceCheck.isKnownDate &&
      !graceCheck.withinWindow
    ) {
      continue;
    }

    const item: SpckClassOption = {
      classId: r.classId,
      className: r.className || r.classId,
      currentSessionNumber: resolvedStatus === "Finished" ? Math.max(currentSessionNumber, 14) : currentSessionNumber,
      maxSessionNumber: Math.max(maxSess, 14),
      spckSessions: [12, 13, 14],
      status: resolvedStatus,
      session14Date: graceCheck.session14Date || cachedItem?.endDate || undefined,
    };
    allClassesMap.set(r.classId, item);

    const isAllowed =
      !allowedClassCodes ||
      allowedClassCodes.size === 0 ||
      allowedClassCodes.has(upperId);

    if (item.currentSessionNumber >= minSessionNumber && isAllowed) {
      eligibleClasses.push(item);
    }
  }

  return { eligibleClasses, allClassesMap };
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

    const { eligibleClasses } = queryEligibleSpckClasses(12);
    const targetClassId = classId || eligibleClasses[0]?.classId || "";
    const matchedClass = eligibleClasses.find((c) => c.classId === targetClassId);

    const activeSessionNumber: SpckSessionSlotNumber =
      rawSessionParam && isValidSpckSessionSlot(rawSessionParam)
        ? (Number(rawSessionParam) as SpckSessionSlotNumber)
        : matchedClass && isValidSpckSessionSlot(matchedClass.currentSessionNumber)
        ? (matchedClass.currentSessionNumber as SpckSessionSlotNumber)
        : 13;

    const stageInfo = getSpckStageInfo(activeSessionNumber);
    const students = targetClassId ? studentRepo.findByClass(targetClassId, false) : [];
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

    const runningRes = await ClassSyncer.fetchRunningClasses();
    const runningList =
      runningRes.classes && runningRes.classes.length > 0
        ? runningRes.classes
        : getRunningClasses();

    const { allClassesMap: beforeMap } = queryEligibleSpckClasses(12);
    const syncedClassCodes: string[] = [];
    const allowedRunningSet = new Set<string>();
    const expiredFinishedCodes = new Set<string>();

    for (const item of runningList) {
      const code = (item.classCode || "").trim().toUpperCase();
      if (!code) continue;
      const existingMeta = beforeMap.get(code);
      const isFinished = item.status === "Finished";

      if (isFinished) {
        const s14InfoBefore = resolveClassSession14DateInfo(code, item.endDate);
        const hasStudents = studentRepo.findByClass(code, false).length > 0;
        const needsFinishedSync =
          !existingMeta ||
          !s14InfoBefore.isExactSession14 ||
          !hasStudents;
        if (needsFinishedSync) {
          const syncRes = await ClassSyncer.syncClass(code);
          if (syncRes.success) {
            syncedClassCodes.push(code);
          }
        }
        const postGrace = isFinishedClassWithinGraceWindow(
          code,
          item.endDate,
          FINISHED_CLASS_GRACE_DAYS
        );
        if (postGrace.withinWindow) {
          allowedRunningSet.add(code);
          item.endDate = postGrace.session14Date || item.endDate;
        } else {
          expiredFinishedCodes.add(code);
        }
        continue;
      }

      allowedRunningSet.add(code);
      const needsSync =
        !existingMeta ||
        existingMeta.currentSessionNumber === 0 ||
        existingMeta.currentSessionNumber >= 10 ||
        (forceResyncAll && String(body?.classId || "").trim().toUpperCase() === code);
      if (needsSync) {
        const syncRes = await ClassSyncer.syncClass(code);
        if (syncRes.success) {
          syncedClassCodes.push(code);
        }
      }
    }

    if (expiredFinishedCodes.size > 0) {
      const prunedList = runningList.filter(
        (item) => !expiredFinishedCodes.has((item.classCode || "").trim().toUpperCase())
      );
      if (prunedList.length > 0) {
        saveRunningClasses(prunedList);
      }
    }

    const { eligibleClasses } = queryEligibleSpckClasses(
      12,
      allowedRunningSet
    );
    const requestedClassId = String(body?.classId || "").trim().toUpperCase();
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
    const students = targetClassId ? studentRepo.findByClass(targetClassId, false) : [];
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
