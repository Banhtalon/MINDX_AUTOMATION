import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import {
  assertClassHasSpckSession,
  canonicalizeSpckFolderPath,
  checkSpckSnapshotFileDrift,
  computeSpckContentHash,
  computeSpckSessionContentHash,
  formatSpckSessionTitle,
  getSession14DemoLimitsForClass,
  isDefaultSpckProductTitle,
  normalizeSpckFolderKey,
  parseSession14DemoScores,
  parseSpckSubmissionSnapshot,
  session14EvalRepo,
  spckSessionRepo,
  spckUploadRepo,
  stripSpckSessionSuffix,
  studentRepo,
  validateSpckTitleLength,
  verifySpckSessionIntegrity,
  type SpckSessionNumber,
} from "@/lib/db/sqlite";
import { isOwnerUploadImageActive } from "@/lib/local-files/spck-app-screenshotter";
import {
  DEFAULT_SPCK_THUMBNAIL_PATH,
  MAX_SPCK_SCREENSHOTS,
  computeStudentFolderContentDigest,
  inspectStudentProjectCodeSignals,
  resolveTargetSpckClassFolder,
  scanClassSpckDirectoryAsync,
  validateSpckResourceLimits,
} from "@/lib/local-files/spck-scanner";
import { validateLocalRequest } from "@/lib/security/local-guard";
import {
  isPresentationQuickTag,
  suggestSpckQuickTagsFromProject,
} from "@/lib/spck/spck-quick-tags";
import { studentPortalManager } from "@/lib/student-portal/student-portal-server";
import { stripVietnameseDiacritics } from "@/lib/utils/vietnamese-match";
import { buildEnrichedClassSpckRecords } from "../list/route";

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const classId = String(body?.classId || "").trim().toUpperCase();
    const folderPath = String(body?.folderPath || "").trim();
    const preferDefaultLogoWhenNoOwnerPhoto = Boolean(
      body?.preferDefaultLogoWhenNoOwnerPhoto
    );
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

    const effectiveFolderPath = resolveTargetSpckClassFolder(classId, folderPath);
    const safeFolderPath = canonicalizeSpckFolderPath(effectiveFolderPath);
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

    let createdFoldersCount = 0;
    if (body?.action === "init_student_folders") {
      if (!fs.existsSync(safeFolderPath)) {
        fs.mkdirSync(safeFolderPath, { recursive: true });
      }
      const existingSubdirs = fs
        .readdirSync(safeFolderPath, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith(".") && !d.name.startsWith("_spck_"))
        .map((d) => stripVietnameseDiacritics(d.name).toLowerCase().replace(/\s+/g, " ").trim());

      for (const stu of students) {
        const cleanDirName = String(stu.fullName || "")
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (!cleanDirName) continue;
        const normStuName = stripVietnameseDiacritics(cleanDirName)
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim();
        const alreadyExists = existingSubdirs.some(
          (sub) => sub === normStuName
        );
        if (!alreadyExists) {
          const targetStuDir = path.join(safeFolderPath, cleanDirName);
          if (!fs.existsSync(targetStuDir)) {
            fs.mkdirSync(targetStuDir, { recursive: true });
            createdFoldersCount++;
            existingSubdirs.push(normStuName);
          }
        }
      }
    }

    const scanResult = await scanClassSpckDirectoryAsync(
      classId,
      safeFolderPath,
      students,
      { preferDefaultLogoWhenNoOwnerPhoto }
    );
    const overLimitErrors: string[] = [];
    let persistedCount = 0;

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
        item.packageData.warnings = [
          ...(item.packageData.warnings || []),
          rawLimitCheck.reason || "Tài nguyên vượt giới hạn LMS.",
        ];
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

      const parseSafeArray = <T>(raw?: string | null): T[] => {
        if (!raw) return [];
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      };

      let existingFolderExistsOnDisk = false;
      if (existing?.localFolderPath) {
        try {
          existingFolderExistsOnDisk =
            fs.existsSync(existing.localFolderPath) &&
            fs.statSync(existing.localFolderPath).isDirectory();
        } catch {
          existingFolderExistsOnDisk = false;
        }
      }

      const existingHasMissingAssetsOnDisk = Boolean(
        existing &&
          ((existing.thumbnailPath && !fs.existsSync(existing.thumbnailPath)) ||
            parseSafeArray<string>(existing.attachmentsJson).some(
              (p) => Boolean(p) && !fs.existsSync(p)
            ) ||
            parseSafeArray<string>(existing.screenshotsJson).some(
              (p) => Boolean(p) && !fs.existsSync(p)
            ))
      );

      const folderDigestInfo = computeStudentFolderContentDigest(canonicalItemFolder);
      let folderContentChanged = false;
      if (folderDigestInfo.digest) {
        if (existingHasMissingAssetsOnDisk && folderDigestInfo.filesCount > 0) {
          folderContentChanged = true;
        } else if (sameFolder && existing?.lastPreppedFolderDigest) {
          folderContentChanged =
            existing.lastPreppedFolderDigest !== folderDigestInfo.digest;
        } else if (!existing || !sameFolder) {
          folderContentChanged = folderDigestInfo.filesCount > 0;
        } else if (existing.status !== "VERIFIED") {
          folderContentChanged = true;
        } else {
          if (
            folderDigestInfo.readableDirectory &&
            folderDigestInfo.filesCount === 0 &&
            (Boolean(existing.attachmentsJson && existing.attachmentsJson !== "[]") ||
              Boolean(existing.screenshotsJson && existing.screenshotsJson !== "[]"))
          ) {
            folderContentChanged = true;
          } else {
            const appShotsDir = path.join(canonicalItemFolder, "_spck_app_shots");
            let latestAppShotMtimeMs = 0;
            try {
              if (fs.existsSync(appShotsDir)) {
                for (const fn of fs.readdirSync(appShotsDir)) {
                  if (fn.startsWith(".")) continue;
                  const st = fs.statSync(path.join(appShotsDir, fn));
                  if (st.isFile() && st.mtimeMs > latestAppShotMtimeMs) {
                    latestAppShotMtimeMs = st.mtimeMs;
                  }
                }
              }
            } catch {}
            if (
              latestAppShotMtimeMs > 0 &&
              folderDigestInfo.latestFileMtimeMs > latestAppShotMtimeMs + 500
            ) {
              folderContentChanged = true;
            }
          }
        }
      }
      (item as any).folderContentDigest = folderDigestInfo.digest;
      (item as any).folderContentChanged = folderContentChanged;
      (item as any).hasHtmlFiles = folderDigestInfo.hasHtmlFiles;

      // Do not overwrite an existing teacher-confirmed binding to a different folder
      // UNLESS the previously bound folder no longer exists on disk (e.g. drive/PC relocation F:\ -> D:\)
      if (
        existing &&
        Number(existing.isConfirmedByTeacher) === 1 &&
        Boolean(existing.localFolderPath) &&
        existingFolderExistsOnDisk &&
        !sameFolder
      ) {
        continue;
      }

      const hasPendingPortalConfirmation = studentPortalManager.hasUnconfirmedSubmission(
        classId,
        suggestedId,
        canonicalItemFolder
      );

      const isRelocatedExistingFolder = Boolean(
        existing?.localFolderPath &&
          !sameFolder &&
          !existingFolderExistsOnDisk &&
          !hasPendingPortalConfirmation &&
          (item.match.autoConfirmed ||
            (!item.match.requiresManualConfirmation &&
              Number(existing.isConfirmedByTeacher) === 1))
      );
      const preserveStudentMetadata = sameFolder || isRelocatedExistingFolder;

      const isConfirmed = hasPendingPortalConfirmation
        ? 0
        : item.match.autoConfirmed
        ? 1
        : preserveStudentMetadata && !item.match.requiresManualConfirmation
        ? existing?.isConfirmedByTeacher ?? 0
        : 0;

      const existingLinks = preserveStudentMetadata
        ? parseSafeArray<{ name: string; url: string; category?: string }>(
            existing?.relatedLinksJson
          )
        : [];
      const scannedLinks =
        item.packageData.allRelatedLinks || item.packageData.relatedLinks || [];
      const mergedLinksMap = new Map<
        string,
        { name: string; url: string; category?: string }
      >();
      for (const l of existingLinks) {
        if (l && l.url) {
          mergedLinksMap.set(l.url, l);
        }
      }
      for (const l of scannedLinks) {
        if (l && l.url) {
          mergedLinksMap.set(l.url, l);
        }
      }
      const mergedRelatedLinks = Array.from(mergedLinksMap.values());

      const existingYt = preserveStudentMetadata
        ? parseSafeArray<string>(existing?.youtubeUrlsJson)
        : [];
      const scannedYt =
        item.packageData.allYoutubeUrls || item.packageData.youtubeUrls || [];
      const mergedYoutubeUrls = Array.from(new Set([...existingYt, ...scannedYt]));

      const ytFrameRe = /[\\/]_spck_youtube_frames[\\/]/i;
      const isBotGeneratedShot = (p: string) =>
        /[\\/](?:_spck_app_shots|_spck_youtube_frames)[\\/]/i.test(p);
      const isActivePreservedOwnerUpload = (p: string) =>
        /[\\/]_spck_owner_uploads[\\/]/i.test(p) && isOwnerUploadImageActive(p);
      const scannedScreenshots =
        item.packageData.allScreenshots || item.packageData.screenshots || [];
      const scannedScreenSet = new Set(scannedScreenshots);
      const isPreservedExistingShot = (p: string) =>
        isBotGeneratedShot(p) ||
        isActivePreservedOwnerUpload(p) ||
        scannedScreenSet.has(p);
      const existingScreensRaw = sameFolder
        ? parseSafeArray<string>(existing?.screenshotsJson).filter((p) => {
            try {
              return Boolean(p) && fs.existsSync(p) && isPreservedExistingShot(p);
            } catch {
              return false;
            }
          })
        : [];
      const existingHasYoutubeFrames = existingScreensRaw.some((p) => ytFrameRe.test(p));
      const existingHasOwnerUploads = existingScreensRaw.some((p) =>
        isActivePreservedOwnerUpload(p)
      );
      const existingThumbExistsOnDisk = Boolean(
        existing?.thumbnailPath && fs.existsSync(existing.thumbnailPath)
      );
      const existingThumbIsAppShot =
        existingThumbExistsOnDisk &&
        /[\\/]_spck_app_shots[\\/]/i.test(existing?.thumbnailPath || "");
      const existingThumbIsActiveOwnerUpload =
        existingThumbExistsOnDisk &&
        isActivePreservedOwnerUpload(existing?.thumbnailPath || "");
      const hasExistingCapturedShots =
        sameFolder &&
        existingThumbExistsOnDisk &&
        (existingThumbIsActiveOwnerUpload ||
          (!preferDefaultLogoWhenNoOwnerPhoto && existingThumbIsAppShot));
      // Keep the existing gallery when it holds captured App/Web shots, active owner uploads, or Robotics YouTube frames
      const existingScreenshots =
        hasExistingCapturedShots ||
        (sameFolder && existingThumbIsAppShot) ||
        existingHasYoutubeFrames ||
        existingHasOwnerUploads
          ? existingScreensRaw
          : [];

      let finalScreenshots =
        scannedScreenshots.length > 0
          ? Array.from(
              new Set([
                ...existingScreenshots.filter((p) =>
                  isActivePreservedOwnerUpload(p) || ytFrameRe.test(p)
                ),
                ...scannedScreenshots,
                ...existingScreenshots,
              ])
            )
          : existingScreenshots;

      // Owner priority rule: an Owner-provided photo (owner upload or unreferenced root photo such as
      // `Demo.png`) always wins the Thumbnail slot over a previously auto-captured App/Web screenshot.
      const scannedThumbIsOwnerPhoto =
        item.packageData.thumbnailSource === "OWNER_UPLOAD" ||
        item.packageData.thumbnailSource === "OWNER_ROOT_PHOTO";
      const existingThumbIsOwnerUpload = existingThumbIsActiveOwnerUpload;
      let resolvedThumbnailPath =
        hasExistingCapturedShots &&
        existing?.thumbnailPath &&
        existingThumbExistsOnDisk
          ? existing.thumbnailPath
          : item.packageData.thumbnailPath;
      if (
        preferDefaultLogoWhenNoOwnerPhoto &&
        sameFolder &&
        existingThumbIsAppShot &&
        !existingThumbIsActiveOwnerUpload &&
        existing?.thumbnailPath &&
        existing.thumbnailPath !== resolvedThumbnailPath &&
        !finalScreenshots.includes(existing.thumbnailPath)
      ) {
        finalScreenshots = [existing.thumbnailPath, ...finalScreenshots];
      }
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
      // If Owner photos alone exceed the LMS limit, validateSpckResourceLimits below reports it (no silent drop);
      // bot-generated shots (`_spck_app_shots` / `_spck_youtube_frames`) only fill remaining slots up to MAX_SPCK_SCREENSHOTS.
      const missingOwnerPhotos = (item.packageData.ownerPhotos || []).filter(
        (p) => p !== resolvedThumbnailPath && !finalScreenshots.includes(p)
      );
      if (missingOwnerPhotos.length > 0) {
        finalScreenshots = [...missingOwnerPhotos, ...finalScreenshots];
      }
      if (finalScreenshots.length > MAX_SPCK_SCREENSHOTS) {
        const nonBot = finalScreenshots.filter((p) => !isBotGeneratedShot(p));
        const botOnly = finalScreenshots.filter((p) => isBotGeneratedShot(p));
        if (botOnly.length > 0) {
          const remainingSlots = Math.max(0, MAX_SPCK_SCREENSHOTS - nonBot.length);
          finalScreenshots = [...nonBot, ...botOnly.slice(0, remainingSlots)];
        }
      }
      const finalAttachments =
        item.packageData.allAttachments || item.packageData.attachments || [];

      const studentDisplayName = item.match.suggestedStudentName || item.folderName;
      const keepExistingCustomTitle =
        preserveStudentMetadata &&
        Boolean(existing?.projectTitle?.trim()) &&
        !isDefaultSpckProductTitle(existing?.projectTitle || "", studentDisplayName);
      const resolvedProjectTitle = keepExistingCustomTitle
        ? existing!.projectTitle
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
        item.packageData.warnings = [
          ...(item.packageData.warnings || []),
          limitCheck.reason || "Tài nguyên vượt giới hạn LMS.",
        ];
        continue;
      }

      const checkSessionNum: SpckSessionNumber = activeSessionNumber || 12;
      const formattedTitleCandidate = formatSpckSessionTitle(
        stripSpckSessionSuffix(resolvedProjectTitle),
        checkSessionNum,
        studentDisplayName
      );
      const titleCheck = validateSpckTitleLength(
        formattedTitleCandidate,
        checkSessionNum
      );
      if (!titleCheck.valid) {
        overLimitErrors.push(
          `[${item.folderName}]: ${titleCheck.reason}`
        );
        item.packageData.warnings = [
          ...(item.packageData.warnings || []),
          titleCheck.reason || "Tên sản phẩm vượt giới hạn LMS.",
        ];
        continue;
      }

      spckUploadRepo.upsert({
        classId,
        studentId: suggestedId,
        localFolderPath: canonicalItemFolder,
        matchScore: item.match.matchScore,
        isConfirmedByTeacher: isConfirmed,
        pendingPortalConfirmation: hasPendingPortalConfirmation ? 1 : 0,
        projectTitle: resolvedProjectTitle,
        baseProjectTitle:
          keepExistingCustomTitle && existing?.baseProjectTitle
            ? existing.baseProjectTitle
            : stripSpckSessionSuffix(resolvedProjectTitle),
        thumbnailPath: resolvedThumbnailPath,
        screenshotsJson: JSON.stringify(finalScreenshots),
        attachmentsJson: JSON.stringify(finalAttachments),
        youtubeUrlsJson: JSON.stringify(mergedYoutubeUrls),
        relatedLinksJson: JSON.stringify(mergedRelatedLinks),
        teacherComment: preserveStudentMetadata ? existing?.teacherComment ?? "" : "",
        contentHash: sameFolder && isConfirmed === 1 ? existing?.contentHash ?? "" : "",
        status: sameFolder && isConfirmed === 1 ? existing?.status || "DRAFT" : "DRAFT",
        verifiedAt: sameFolder && isConfirmed === 1 ? existing?.verifiedAt ?? null : null,
        errorMessage: null,
      });

      // If any session draft is still an untouched auto-init DRAFT (no teacher comment/note and not approved/verified),
      // or if an unapproved/unverified session draft references a deleted/missing thumbnail, screenshot, or attachment on disk,
      // or if the UI explicitly requested syncing the active unverified session (`syncActiveSession: true`),
      // sync the newly scanned shared resources into it immediately so re-scanning a folder across Sessions 12 -> 13 -> 14 updates the UI right away.
      for (const slotNum of [12, 13, 14] as const) {
        const existingSess = spckSessionRepo.findOne(classId, suggestedId, slotNum);
        if (!existingSess) {
          continue;
        }
        const isRequestedActiveSessionSync =
          body?.syncActiveSession === true &&
          activeSessionNumber !== undefined &&
          slotNum === activeSessionNumber;
        if (
          existingSess.lastVerifiedAt ||
          existingSess.draftStatus === "APPROVED" ||
          existingSess.draftStatus === "VERIFIED"
        ) {
          if (isRequestedActiveSessionSync) {
            const latestSharedRow = spckUploadRepo.findOne(classId, suggestedId);
            const hasResourceDiff = spckSessionRepo.hasNewerSharedResources(
              latestSharedRow,
              existingSess
            );
            const integrityOk = existingSess.approvedContentHash
              ? verifySpckSessionIntegrity(existingSess, slotNum)
              : existingSess.lastVerifiedHash
              ? computeSpckSessionContentHash(existingSess, slotNum) ===
                  existingSess.lastVerifiedHash ||
                computeSpckContentHash(existingSess) === existingSess.lastVerifiedHash
              : true;
            const snapshotDrift = checkSpckSnapshotFileDrift(
              parseSpckSubmissionSnapshot(existingSess.lastVerifiedSnapshotJson)
            ).hasFileDrift;
            const isVerifiedSession = Boolean(
              existingSess.lastVerifiedAt || existingSess.draftStatus === "VERIFIED"
            );
            const attachmentsMatch =
              (latestSharedRow?.attachmentsJson || "[]") ===
              (existingSess.attachmentsJson || "[]");
            const youtubeMatch =
              (latestSharedRow?.youtubeUrlsJson || "[]") ===
              (existingSess.youtubeUrlsJson || "[]");
            const linksMatch =
              (latestSharedRow?.relatedLinksJson || "[]") ===
              (existingSess.relatedLinksJson || "[]");
            const onlyAppShotResetToLogo =
              preferDefaultLogoWhenNoOwnerPhoto &&
              !folderContentChanged &&
              /[\\/]_spck_app_shots[\\/]/i.test(existingSess.thumbnailPath || "") &&
              latestSharedRow?.thumbnailPath === DEFAULT_SPCK_THUMBNAIL_PATH &&
              attachmentsMatch &&
              youtubeMatch &&
              linksMatch;
            if (isVerifiedSession && onlyAppShotResetToLogo && integrityOk && !snapshotDrift) {
              continue;
            }
            if (hasResourceDiff || !integrityOk || snapshotDrift) {
              spckSessionRepo.syncLatestSharedResourcesToSessionDraft(
                classId,
                suggestedId,
                slotNum
              );
            }
          }
          continue;
        }
        const isUntouchedDraft =
          existingSess.draftStatus === "DRAFT" &&
          !existingSess.teacherComment?.trim() &&
          !existingSess.teacherNote?.trim();
        const hasMissingThumb =
          Boolean(existingSess.thumbnailPath) && !fs.existsSync(existingSess.thumbnailPath);
        const hasMissingScreens = parseSafeArray<string>(existingSess.screenshotsJson).some(
          (p) => Boolean(p) && !fs.existsSync(p)
        );
        const hasMissingAtts = parseSafeArray<string>(existingSess.attachmentsJson).some(
          (p) => Boolean(p) && !fs.existsSync(p)
        );
        if (
          isUntouchedDraft ||
          isRequestedActiveSessionSync ||
          hasMissingThumb ||
          hasMissingScreens ||
          hasMissingAtts
        ) {
          spckSessionRepo.syncLatestSharedResourcesToSessionDraft(
            classId,
            suggestedId,
            slotNum
          );
        }
      }

      if (body?.autoSuggestQuickTags === true && activeSessionNumber) {
        const sessDraft = spckSessionRepo.getOrInitSessionDraft(
          classId,
          suggestedId,
          activeSessionNumber,
          studentDisplayName
        );
        const currentTags = parseSafeArray<string>(sessDraft.quickTagsJson);
        const onlyHasPresentationTagAtS14 =
          activeSessionNumber === 14 &&
          currentTags.length > 0 &&
          currentTags.every((t) => isPresentationQuickTag(t));
        if (
          (currentTags.length === 0 || onlyHasPresentationTagAtS14) &&
          !sessDraft.lastVerifiedAt &&
          sessDraft.draftStatus !== "APPROVED" &&
          sessDraft.draftStatus !== "VERIFIED"
        ) {
          const signals = inspectStudentProjectCodeSignals(
            canonicalItemFolder,
            finalAttachments
          );
          const s14Eval =
            activeSessionNumber === 14
              ? session14EvalRepo.findOne(classId, suggestedId)
              : undefined;
          const s14Limits =
            activeSessionNumber === 14 ? getSession14DemoLimitsForClass(classId) : undefined;
          const hasS14DemoScore = Boolean(s14Eval && Number(s14Eval.demoTotalScore) > 0);
          const parsedS14Demo =
            hasS14DemoScore && s14Eval
              ? parseSession14DemoScores(s14Eval.demoScoresJson, classId)
              : undefined;
          const suggestedTags = suggestSpckQuickTagsFromProject({
            classId,
            sessionNumber: activeSessionNumber,
            screenshotCount: finalScreenshots.length,
            attachmentCount: finalAttachments.length,
            youtubeCount: mergedYoutubeUrls.length,
            ...signals,
            demoCommunicationScore: parsedS14Demo
              ? Number(parsedS14Demo.communication || 0)
              : undefined,
            demoCommunicationMax: s14Limits?.communication,
            includeSession14ProductEvidence: activeSessionNumber === 14 && hasS14DemoScore,
          });
          const mergedSuggestedTags = Array.from(
            new Set([...currentTags, ...suggestedTags])
          ).slice(0, 4);
          if (mergedSuggestedTags.length > currentTags.length) {
            spckSessionRepo.saveSessionDraft({
              classId,
              studentId: suggestedId,
              sessionNumber: activeSessionNumber,
              quickTagsJson: JSON.stringify(mergedSuggestedTags),
              updateSharedPool: false,
            });
          }
        }
      }

      persistedCount++;
    }

    const updatedRecords = buildEnrichedClassSpckRecords(classId, activeSessionNumber);

    if (overLimitErrors.length > 0 && persistedCount === 0) {
      return NextResponse.json(
        {
          success: false,
          error: overLimitErrors.join(" | "),
          createdFoldersCount,
          scanResult,
          records: updatedRecords,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      resolvedFolderPath: safeFolderPath,
      createdFoldersCount,
      warning: overLimitErrors.length > 0 ? overLimitErrors.join(" | ") : undefined,
      overLimitErrors: overLimitErrors.length > 0 ? overLimitErrors : undefined,
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
