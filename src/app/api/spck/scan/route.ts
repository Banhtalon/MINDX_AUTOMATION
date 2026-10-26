import { NextResponse } from "next/server";
import {
  assertClassHasSpckSession,
  canonicalizeSpckFolderPath,
  formatSpckSessionTitle,
  normalizeSpckFolderKey,
  spckUploadRepo,
  stripSpckSessionSuffix,
  studentRepo,
  validateSpckTitleLength,
  type SpckSessionNumber,
} from "@/lib/db/sqlite";
import {
  DEFAULT_SPCK_THUMBNAIL_PATH,
  MAX_SPCK_SCREENSHOTS,
  scanClassSpckDirectory,
  validateSpckResourceLimits,
} from "@/lib/local-files/spck-scanner";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { buildEnrichedClassSpckRecords } from "../list/route";

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const classId = String(body?.classId || "").trim().toUpperCase();
    const folderPath = String(body?.folderPath || "").trim();
    const rawSessionNum = body?.sessionNumber !== undefined ? Number(body.sessionNumber) : null;
    let activeSessionNumber: SpckSessionNumber | undefined = undefined;
    if (rawSessionNum !== null && rawSessionNum !== 0 && !Number.isNaN(rawSessionNum)) {
      const stageInfo = assertClassHasSpckSession(classId, rawSessionNum);
      activeSessionNumber = stageInfo.sessionNumber;
    }

    if (!classId || !folderPath) {
      return NextResponse.json(
        {
          success: false,
          error: "Vui lòng chọn Lớp học (classId) và nhập đường dẫn thư mục SPCK (folderPath).",
        },
        { status: 400 }
      );
    }

    const safeFolderPath = canonicalizeSpckFolderPath(folderPath);
    const students = studentRepo.findByClass(classId, false);
    if (students.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Chưa có danh sách học viên cho lớp '${classId}' trong SQLite. Vui lòng đồng bộ lớp học trước.`,
        },
        { status: 400 }
      );
    }

    const scanResult = scanClassSpckDirectory(classId, safeFolderPath, students);
    const overLimitErrors: string[] = [];

    // Persist matched records into SQLite; reset teacher confirmation if folder changed or match is ambiguous
    for (const item of scanResult.items) {
      const rawLimitCheck = validateSpckResourceLimits({
        screenshots: item.packageData.allScreenshots || item.packageData.screenshots || [],
        attachments: item.packageData.allAttachments || item.packageData.attachments || [],
        youtubeUrls: item.packageData.allYoutubeUrls || item.packageData.youtubeUrls || [],
        relatedLinks: item.packageData.allRelatedLinks || item.packageData.relatedLinks || [],
      });
      if (!rawLimitCheck.valid) {
        overLimitErrors.push(`[${item.folderName}]: ${rawLimitCheck.reason}`);
        continue;
      }

      const suggestedId = item.match.suggestedStudentId;
      if (!suggestedId) continue;

      // Only auto-persist to spck_uploads if there is no folder collision on this studentId
      if (item.match.hasFolderCollision) continue;

      const canonicalItemFolder = canonicalizeSpckFolderPath(item.folderPath);
      const currentClassRows = spckUploadRepo.findByClass(classId);
      const otherConfirmedOwner = currentClassRows.find(
        (r) =>
          r.studentId !== suggestedId &&
          Number(r.isConfirmedByTeacher) === 1 &&
          normalizeSpckFolderKey(r.localFolderPath) ===
            normalizeSpckFolderKey(canonicalItemFolder)
      );
      if (otherConfirmedOwner) {
        continue;
      }

      const existing = spckUploadRepo.findOne(classId, suggestedId);
      const sameFolder =
        Boolean(existing?.localFolderPath) &&
        normalizeSpckFolderKey(existing?.localFolderPath) ===
          normalizeSpckFolderKey(canonicalItemFolder);

      // Do not overwrite an existing teacher-confirmed binding to a different folder
      if (
        existing &&
        Number(existing.isConfirmedByTeacher) === 1 &&
        Boolean(existing.localFolderPath) &&
        !sameFolder
      ) {
        continue;
      }

      const isConfirmed = item.match.autoConfirmed
        ? 1
        : sameFolder && !item.match.requiresManualConfirmation
        ? existing?.isConfirmedByTeacher ?? 0
        : 0;

      const parseSafeArray = <T>(raw?: string | null): T[] => {
        if (!raw) return [];
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      };

      const existingLinks = sameFolder
        ? parseSafeArray<{ name: string; url: string }>(existing?.relatedLinksJson)
        : [];
      const scannedLinks =
        item.packageData.allRelatedLinks || item.packageData.relatedLinks || [];
      const mergedLinksMap = new Map<string, { name: string; url: string }>();
      for (const l of [...existingLinks, ...scannedLinks]) {
        if (l && l.url && !mergedLinksMap.has(l.url)) {
          mergedLinksMap.set(l.url, l);
        }
      }
      const mergedRelatedLinks = Array.from(mergedLinksMap.values());

      const existingYt = sameFolder
        ? parseSafeArray<string>(existing?.youtubeUrlsJson)
        : [];
      const scannedYt =
        item.packageData.allYoutubeUrls || item.packageData.youtubeUrls || [];
      const mergedYoutubeUrls = Array.from(new Set([...existingYt, ...scannedYt]));

      const ytFrameRe = /[\\/]_spck_youtube_frames[\\/]/i;
      const existingScreensRaw = sameFolder
        ? parseSafeArray<string>(existing?.screenshotsJson)
        : [];
      const existingHasYoutubeFrames = existingScreensRaw.some((p) => ytFrameRe.test(p));
      const hasExistingCapturedShots =
        sameFolder &&
        Boolean(existing?.thumbnailPath) &&
        /[\\/](?:_spck_app_shots|_spck_owner_uploads)[\\/]/i.test(
          existing?.thumbnailPath || ""
        );
      // Keep the existing gallery when it holds captured App/Web shots or Robotics YouTube frames
      const existingScreenshots =
        hasExistingCapturedShots || existingHasYoutubeFrames ? existingScreensRaw : [];

      const scannedScreenshots =
        item.packageData.allScreenshots || item.packageData.screenshots || [];
      let finalScreenshots =
        existingScreenshots.length > 0 ? existingScreenshots : scannedScreenshots;

      // Owner priority rule: an Owner-provided photo (owner upload or unreferenced root photo such as
      // `Demo.png`) always wins the Thumbnail slot over a previously auto-captured App/Web screenshot.
      const scannedThumbIsOwnerPhoto =
        item.packageData.thumbnailSource === "OWNER_UPLOAD" ||
        item.packageData.thumbnailSource === "OWNER_ROOT_PHOTO";
      const existingThumbIsOwnerUpload = /[\\/]_spck_owner_uploads[\\/]/i.test(
        existing?.thumbnailPath || ""
      );
      let resolvedThumbnailPath =
        hasExistingCapturedShots && existing?.thumbnailPath
          ? existing.thumbnailPath
          : item.packageData.thumbnailPath;
      if (
        scannedThumbIsOwnerPhoto &&
        item.packageData.thumbnailPath &&
        !(existingThumbIsOwnerUpload && sameFolder) &&
        resolvedThumbnailPath !== item.packageData.thumbnailPath
      ) {
        const displacedThumb = resolvedThumbnailPath;
        resolvedThumbnailPath = item.packageData.thumbnailPath;
        finalScreenshots = finalScreenshots.filter((p) => p !== resolvedThumbnailPath);
        if (
          displacedThumb &&
          /[\\/]_spck_app_shots[\\/]/i.test(displacedThumb) &&
          !finalScreenshots.includes(displacedThumb) &&
          finalScreenshots.length < MAX_SPCK_SCREENSHOTS
        ) {
          finalScreenshots = [displacedThumb, ...finalScreenshots];
        }
      }
      // V272-F06: a YouTube presentation frame must never be the Thumbnail
      if (ytFrameRe.test(resolvedThumbnailPath || "")) {
        resolvedThumbnailPath = DEFAULT_SPCK_THUMBNAIL_PATH;
      }
      // V272-F05: every Owner photo must appear in the gallery (except the one used as Thumbnail).
      // If this exceeds the LMS limit, validateSpckResourceLimits below reports it (no silent drop).
      const missingOwnerPhotos = (item.packageData.ownerPhotos || []).filter(
        (p) => p !== resolvedThumbnailPath && !finalScreenshots.includes(p)
      );
      if (missingOwnerPhotos.length > 0) {
        finalScreenshots = [...missingOwnerPhotos, ...finalScreenshots];
      }
      const finalAttachments =
        item.packageData.allAttachments || item.packageData.attachments || [];

      const resolvedProjectTitle =
        sameFolder && existing?.projectTitle
          ? existing.projectTitle
          : item.packageData.rawProjectTitle || item.packageData.projectTitle;

      const limitCheck = validateSpckResourceLimits({
        screenshots: finalScreenshots,
        attachments: finalAttachments,
        youtubeUrls: mergedYoutubeUrls,
        relatedLinks: mergedRelatedLinks,
      });
      if (!limitCheck.valid) {
        overLimitErrors.push(
          `[${item.folderName}]: ${limitCheck.reason}`
        );
        continue;
      }

      const checkSessionNum: SpckSessionNumber = activeSessionNumber || 12;
      const formattedTitleCandidate = formatSpckSessionTitle(
        stripSpckSessionSuffix(resolvedProjectTitle),
        checkSessionNum,
        item.match.suggestedStudentName || item.folderName
      );
      const titleCheck = validateSpckTitleLength(
        formattedTitleCandidate,
        checkSessionNum
      );
      if (!titleCheck.valid) {
        overLimitErrors.push(
          `[${item.folderName}]: ${titleCheck.reason}`
        );
        continue;
      }

      spckUploadRepo.upsert({
        classId,
        studentId: suggestedId,
        localFolderPath: canonicalItemFolder,
        matchScore: item.match.matchScore,
        isConfirmedByTeacher: isConfirmed,
        projectTitle: resolvedProjectTitle,
        baseProjectTitle:
          sameFolder && existing?.baseProjectTitle
            ? existing.baseProjectTitle
            : stripSpckSessionSuffix(resolvedProjectTitle),
        thumbnailPath: resolvedThumbnailPath,
        screenshotsJson: JSON.stringify(finalScreenshots),
        attachmentsJson: JSON.stringify(finalAttachments),
        youtubeUrlsJson: JSON.stringify(mergedYoutubeUrls),
        relatedLinksJson: JSON.stringify(mergedRelatedLinks),
        teacherComment: sameFolder ? existing?.teacherComment ?? "" : "",
        contentHash: sameFolder && isConfirmed === 1 ? existing?.contentHash ?? "" : "",
        status: sameFolder && isConfirmed === 1 ? existing?.status || "DRAFT" : "DRAFT",
        verifiedAt: sameFolder && isConfirmed === 1 ? existing?.verifiedAt ?? null : null,
        errorMessage: null,
      });
    }

    const updatedRecords = buildEnrichedClassSpckRecords(classId, activeSessionNumber);

    if (overLimitErrors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: overLimitErrors.join(" | "),
          scanResult,
          records: updatedRecords,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      scanResult,
      records: updatedRecords,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("Security Exception") ? 403 : 400;
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status }
    );
  }
}
