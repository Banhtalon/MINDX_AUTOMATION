import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { NextResponse } from "next/server";

const nodeRequire = createRequire(import.meta.url);
const acorn = nodeRequire("next/dist/compiled/acorn") as {
  tokenizer: (
    input: string,
    options?: { ecmaVersion?: number | "latest"; sourceType?: "module" | "script" }
  ) => Iterable<{
    type: { label: string };
    value?: unknown;
    start: number;
    end: number;
  }>;
};
import {
  assertClassHasSpckSession,
  canonicalizeSpckFolderPath,
  formatSpckSessionTitle,
  normalizeSpckFolderKey,
  spckSessionRepo,
  spckUploadRepo,
  stripSpckSessionSuffix,
  studentRepo,
  validateSpckTitleLength,
  type SpckSessionNumber,
} from "@/lib/db/sqlite";
import {
  DEFAULT_SPCK_THUMBNAIL_PATH,
  MAX_SPCK_SCREENSHOTS,
  resolveTargetSpckClassFolder,
  scanClassSpckDirectory,
  validateSpckResourceLimits,
} from "@/lib/local-files/spck-scanner";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { suggestSpckQuickTagsFromProject } from "@/lib/spck/spck-quick-tags";
import { stripVietnameseDiacritics } from "@/lib/utils/vietnamese-match";
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

    const scanResult = scanClassSpckDirectory(classId, safeFolderPath, students);
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

      const existingYt = sameFolder
        ? parseSafeArray<string>(existing?.youtubeUrlsJson)
        : [];
      const scannedYt =
        item.packageData.allYoutubeUrls || item.packageData.youtubeUrls || [];
      const mergedYoutubeUrls = Array.from(new Set([...existingYt, ...scannedYt]));

      const ytFrameRe = /[\\/]_spck_youtube_frames[\\/]/i;
      const isBotGeneratedShot = (p: string) =>
        /[\\/](?:_spck_app_shots|_spck_youtube_frames)[\\/]/i.test(p);
      const scannedScreenshots =
        item.packageData.allScreenshots || item.packageData.screenshots || [];
      const scannedScreenSet = new Set(scannedScreenshots);
      const isPreservedExistingShot = (p: string) =>
        /[\\/](?:_spck_app_shots|_spck_youtube_frames|_spck_owner_uploads)[\\/]/i.test(p) ||
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
      const hasExistingCapturedShots =
        sameFolder &&
        Boolean(existing?.thumbnailPath) &&
        /[\\/](?:_spck_app_shots|_spck_owner_uploads)[\\/]/i.test(
          existing?.thumbnailPath || ""
        );
      // Keep the existing gallery when it holds captured App/Web shots or Robotics YouTube frames
      const existingScreenshots =
        hasExistingCapturedShots || existingHasYoutubeFrames ? existingScreensRaw : [];

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
        hasExistingCapturedShots &&
        existing?.thumbnailPath &&
        fs.existsSync(existing.thumbnailPath)
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

      // If any session draft is still an untouched auto-init DRAFT (no teacher comment/note and not approved/verified),
      // or if an unapproved/unverified session draft references a deleted/missing thumbnail, screenshot, or attachment on disk,
      // or if the UI explicitly requested syncing the active unverified session (`syncActiveSession: true`),
      // sync the newly scanned shared resources into it immediately so re-scanning a folder across Sessions 12 -> 13 -> 14 updates the UI right away.
      for (const slotNum of [12, 13, 14] as const) {
        const existingSess = spckSessionRepo.findOne(classId, suggestedId, slotNum);
        if (
          !existingSess ||
          existingSess.lastVerifiedAt ||
          existingSess.draftStatus === "APPROVED" ||
          existingSess.draftStatus === "VERIFIED"
        ) {
          continue;
        }
        const isUntouchedDraft =
          existingSess.draftStatus === "DRAFT" &&
          !existingSess.teacherComment?.trim() &&
          !existingSess.teacherNote?.trim();
        const isRequestedActiveSessionSync =
          body?.syncActiveSession === true &&
          activeSessionNumber !== undefined &&
          slotNum === activeSessionNumber;
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
          item.match.suggestedStudentName || item.folderName
        );
        const currentTags = parseSafeArray<string>(sessDraft.quickTagsJson);
        if (
          currentTags.length === 0 &&
          !sessDraft.lastVerifiedAt &&
          sessDraft.draftStatus !== "APPROVED" &&
          sessDraft.draftStatus !== "VERIFIED"
        ) {
          const inspectedSourcePaths: string[] = [...finalAttachments];
          if (
            canonicalItemFolder &&
            finalAttachments.some((p) =>
              /_(?:web_package\.zip|app_package\.zip|gamemaker\.yyz)$/i.test(p)
            )
          ) {
            const walkFolderSources = (curDir: string, depth: number) => {
              if (depth > 3 || inspectedSourcePaths.length >= 80) return;
              let dirEntries: fs.Dirent[] = [];
              try {
                dirEntries = fs.readdirSync(curDir, { withFileTypes: true });
              } catch {
                return;
              }
              for (const de of dirEntries) {
                if (inspectedSourcePaths.length >= 80) break;
                if (de.name.startsWith(".")) continue;
                const lowerDe = de.name.toLowerCase();
                if (
                  lowerDe.startsWith("_spck_") ||
                  lowerDe === "node_modules" ||
                  lowerDe === "__pycache__" ||
                  lowerDe === "venv" ||
                  lowerDe === ".venv" ||
                  lowerDe.endsWith("_web_package.zip") ||
                  lowerDe.endsWith("_app_package.zip") ||
                  lowerDe.endsWith("_robotics_package.zip") ||
                  lowerDe.endsWith("_gamemaker.yyz")
                ) {
                  continue;
                }
                const fullDe = path.join(curDir, de.name);
                try {
                  const st = fs.lstatSync(fullDe);
                  if (st.isSymbolicLink()) continue;
                  if (st.isDirectory()) {
                    walkFolderSources(fullDe, depth + 1);
                  } else if (
                    st.isFile() &&
                    /\.(?:html?|css|m?js|py|ui|qss|ipynb|gml|yy|yyp|csv)$/i.test(lowerDe)
                  ) {
                    inspectedSourcePaths.push(fullDe);
                  }
                } catch {}
              }
            };
            walkFolderSources(canonicalItemFolder, 0);
          }
          const fileExts = Array.from(
            new Set(
              inspectedSourcePaths.map((p) => path.extname(p).toLowerCase()).filter(Boolean)
            )
          );
          let hasFlexOrGridCss = false;
          let hasNavLinks = false;
          let hasEventBinding = false;
          let hasDomUpdate = false;
          let hasFirebaseCode = false;
          const hasRoboticsCode = finalAttachments.some((p) =>
            p.toLowerCase().endsWith("_robotics_package.zip")
          );
          const stripCssCommentsAndStrings = (cssCode: string) =>
            cssCode
              .replace(
                /\/\*[\s\S]*?\*\/|("(?:\\[\s\S]|[^"\\\r\n])*"|'(?:\\[\s\S]|[^'\\\r\n])*')/g,
                (match, strLiteral) => (strLiteral ? '""' : " ")
              );

          const analyzeJsCodeSyntax = (
            code: string,
            sourceType: "script" | "module" = "script"
          ): { executableJs: string; importSpecifiers: string[]; lexComplete: boolean } => {
            const importSpecifiers: string[] = [];
            let out = "";
            let prevEnd = 0;
            let prevTok: { label: string; value?: unknown } | null = null;
            let prevPrevTok: { label: string; value?: unknown } | null = null;
            let prevPrevPrevTok: { label: string; value?: unknown } | null = null;
            let inImportOrExportStmt = false;
            let braceDepthInImport = 0;

            try {
              for (const tok of acorn.tokenizer(code, {
                ecmaVersion: "latest",
                sourceType,
              })) {
                if (tok.start > prevEnd) {
                  out += code.slice(prevEnd, tok.start).includes("\n") ? "\n" : " ";
                }
                const label = tok.type.label;
                if (
                  (label === "import" || label === "export") &&
                  prevTok?.label !== "."
                ) {
                  inImportOrExportStmt = true;
                  braceDepthInImport = 0;
                } else if (inImportOrExportStmt) {
                  if (label === "{") {
                    braceDepthInImport++;
                    if (braceDepthInImport > 1) inImportOrExportStmt = false;
                  } else if (label === "}") {
                    braceDepthInImport = Math.max(0, braceDepthInImport - 1);
                  } else if (braceDepthInImport === 0) {
                    const isValidHeaderToken =
                      label === "*" || label === "," || label === "name";
                    if (!isValidHeaderToken && label !== "string") {
                      inImportOrExportStmt = false;
                    }
                  }
                }

                if (label === "string") {
                  const isStaticImport =
                    (prevTok?.label === "import" && prevPrevTok?.label !== ".") ||
                    (inImportOrExportStmt &&
                      braceDepthInImport === 0 &&
                      prevTok?.label === "name" &&
                      prevTok?.value === "from");
                  const isDynamicImportOrRequire =
                    prevTok?.label === "(" &&
                    prevPrevPrevTok?.label !== "." &&
                    prevPrevPrevTok?.label !== "function" &&
                    (prevPrevTok?.label === "import" ||
                      (prevPrevTok?.label === "name" && prevPrevTok?.value === "require"));
                  if (
                    (isStaticImport || isDynamicImportOrRequire) &&
                    typeof tok.value === "string" &&
                    tok.value
                  ) {
                    importSpecifiers.push(tok.value);
                  }
                  if (braceDepthInImport === 0) {
                    inImportOrExportStmt = false;
                  }
                  out += '""';
                } else if (label === "template") {
                  // Non-executable raw text inside template literal -> omit
                } else if (label === "regexp") {
                  out += "/_/";
                } else if (label === "eof") {
                  return { executableJs: out, importSpecifiers, lexComplete: true };
                } else {
                  out += code.slice(tok.start, tok.end);
                }

                prevEnd = tok.end;
                prevPrevPrevTok = prevPrevTok;
                prevPrevTok = prevTok;
                prevTok = { label, value: tok.value };
              }
              return { executableJs: out, importSpecifiers, lexComplete: true };
            } catch {
              return { executableJs: out, importSpecifiers, lexComplete: false };
            }
          };

          const inspectJsSyntax = (
            jsSource: string,
            sourceType: "script" | "module" = "script"
          ) => {
            const { executableJs: syntaxOnly, importSpecifiers } = analyzeJsCodeSyntax(
              jsSource,
              sourceType
            );
            if (/\baddEventListener\s*\(|\bon(?:click|submit|change|input)\s*=/i.test(syntaxOnly)) {
              hasEventBinding = true;
            }
            if (
              /\.(?:textContent|innerHTML|innerText)\s*=|\b(?:createElement|appendChild|removeChild|replaceChildren)\s*\(/i.test(
                syntaxOnly
              )
            ) {
              hasDomUpdate = true;
            }
            if (
              importSpecifiers.some((spec) => /(?:firebase|firestore)/i.test(spec)) ||
              /\b(?:initializeApp|getFirestore|getAuth|getDatabase|signInWithEmailAndPassword|createUserWithEmailAndPassword|signInWithPopup|onAuthStateChanged|collection|addDoc|getDocs|getDoc|setDoc|updateDoc|deleteDoc|onSnapshot)\s*\(|\bfirebase\s*\.\s*(?:initializeApp|auth|firestore|database)\s*\(/.test(
                syntaxOnly
              )
            ) {
              hasFirebaseCode = true;
            }
          };

          for (const attPath of inspectedSourcePaths) {
            const lowerAtt = attPath.toLowerCase();
            if (lowerAtt.endsWith(".html") || lowerAtt.endsWith(".htm")) {
              try {
                const rawHtml = fs
                  .readFileSync(attPath, "utf-8")
                  .slice(0, 100000)
                  .replace(/<!--[\s\S]*?-->/g, " ");
                const htmlInlineStyles: string[] = [];
                const htmlInlineScripts: Array<{
                  body: string;
                  sourceType: "script" | "module";
                }> = [];
                const htmlMarkupParts: string[] = [];
                let lastHtmlIdx = 0;

                for (const blockMatch of rawHtml.matchAll(
                  /<script\b([^>]*)>([\s\S]*?)<\/script>|<style\b([^>]*)>([\s\S]*?)<\/style>/gi
                )) {
                  const matchStart = blockMatch.index ?? 0;
                  if (matchStart > lastHtmlIdx) {
                    htmlMarkupParts.push(rawHtml.slice(lastHtmlIdx, matchStart));
                  }
                  lastHtmlIdx = matchStart + blockMatch[0].length;
                  if (blockMatch[1] !== undefined || blockMatch[2] !== undefined) {
                    const scriptAttrs = blockMatch[1] || "";
                    const scriptBody = blockMatch[2] || "";
                    const isModuleScript = /\btype\s*=\s*(?:["']\s*module\s*["']|module\b)/i.test(
                      scriptAttrs
                    );
                    if (/\bsrc\s*=\s*["'][^"']*(?:firebase|firestore)[^"']*["']/i.test(scriptAttrs)) {
                      hasFirebaseCode = true;
                    }
                    if (scriptBody.trim()) {
                      htmlInlineScripts.push({
                        body: scriptBody,
                        sourceType: isModuleScript ? "module" : "script",
                      });
                    }
                  } else {
                    const styleBody = blockMatch[4] || "";
                    if (styleBody.trim()) {
                      htmlInlineStyles.push(styleBody);
                    }
                  }
                }
                if (lastHtmlIdx < rawHtml.length) {
                  htmlMarkupParts.push(rawHtml.slice(lastHtmlIdx));
                }
                const markupOnly = htmlMarkupParts.join(" ");

                for (const styleBlock of htmlInlineStyles) {
                  const cleanStyle = stripCssCommentsAndStrings(styleBlock);
                  if (/display\s*:\s*(?:inline-)?(?:flex|grid)/i.test(cleanStyle)) {
                    hasFlexOrGridCss = true;
                  }
                }
                if (
                  /<[a-z0-9]+\b[^>]*\bstyle\s*=\s*["'][^"']*display\s*:\s*(?:inline-)?(?:flex|grid)[^"']*["']/i.test(
                    markupOnly
                  ) ||
                  /<[a-z0-9]+\b[^>]*\bclass\s*=\s*["'][^"']*\bd-(?:inline-)?(?:flex|grid)\b[^"']*["']/i.test(
                    markupOnly
                  )
                ) {
                  hasFlexOrGridCss = true;
                }
                if (/<nav\b[^>]*>(?:(?!<\/nav>)[\s\S])*?<a\b/i.test(markupOnly)) {
                  hasNavLinks = true;
                }
                if (/<[a-z0-9]+\b[^>]*\bon(?:click|submit|change|input)\s*=/i.test(markupOnly)) {
                  hasEventBinding = true;
                }
                for (const inlineScript of htmlInlineScripts) {
                  inspectJsSyntax(inlineScript.body, inlineScript.sourceType);
                }
              } catch {}
            } else if (lowerAtt.endsWith(".css")) {
              try {
                const rawCss = stripCssCommentsAndStrings(
                  fs.readFileSync(attPath, "utf-8").slice(0, 100000)
                );
                if (/display\s*:\s*(?:inline-)?(?:flex|grid)/i.test(rawCss)) {
                  hasFlexOrGridCss = true;
                }
              } catch {}
            } else if (lowerAtt.endsWith(".js") || lowerAtt.endsWith(".mjs")) {
              try {
                inspectJsSyntax(
                  fs.readFileSync(attPath, "utf-8").slice(0, 100000),
                  lowerAtt.endsWith(".mjs") ? "module" : "script"
                );
              } catch {}
            }
          }
          const hasJsInteraction = hasEventBinding && hasDomUpdate;
          const suggestedTags = suggestSpckQuickTagsFromProject({
            classId,
            sessionNumber: activeSessionNumber,
            fileExtensions: fileExts,
            screenshotCount: finalScreenshots.length,
            attachmentCount: finalAttachments.length,
            youtubeCount: mergedYoutubeUrls.length,
            slideCount: fileExts.filter((ext) => ext === ".pptx" || ext === ".pdf").length,
            hasFlexOrGridCss,
            hasNavLinks,
            hasEventBinding,
            hasDomUpdate,
            hasJsInteraction,
            hasFirebaseCode,
            hasRoboticsCode,
          });
          if (suggestedTags.length > 0) {
            spckSessionRepo.saveSessionDraft({
              classId,
              studentId: suggestedId,
              sessionNumber: activeSessionNumber,
              quickTagsJson: JSON.stringify(suggestedTags),
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
