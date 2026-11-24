import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { BrowserManager } from "./browser-manager";
import { authService } from "./auth";
import { LmsHelpers } from "./lms-helpers";
import { SELECTORS } from "./selectors";
import { createNetworkInterceptor } from "./network-interceptor";
import { ScoreScraper, type ClassScoreMatrixResult, type StudentScoreCell } from "./scrape-scores";
import {
  homeworkSubmissionRepo,
  scoreMatrixRepo,
  studentRepo,
  jobLogRepo,
  calculateSha256,
  isRoboticsClassCode,
} from "../db/sqlite";
import { assertPathAllowed } from "../security/path-allowlist";
import { parseSubmissionFile, type ParsedSubmissionContent } from "../file-parsers";
import { config } from "../config";
import {
  NATIVE_GLOBAL_FETCH,
  fetchMindxResourceBuffer,
  fetchMindxResourceJson,
  isLmsApiReadEnabled,
  isQueueStoppedError,
  lmsHttpClient,
} from "../lms/lms-http-client";
import { resolveKnownLmsClassId } from "../lms/lms-class-id-store";
import { isValidLmsClassObjectId } from "../lms/lms-class-url";
import {
  classifySubmissionAttachments,
  resolveTargetMatrixColumn,
  stripMindxUploadTimestampPrefix,
} from "../checkpoint/checkpoint-column-resolver";

const MAX_SINGLE_ATTACHMENT_DOWNLOAD_BYTES = 25 * 1024 * 1024; // 25 MB safety cap

export interface DownloadSubmissionsOptions {
  classId: string;
  classCode: string;
  sessionId: string;
  lessonId?: string;
  sessionNumber?: number;
  studentId?: string; // Optional: download for a single student
  forceScrapeMatrix?: boolean;
}

export interface DownloadedSubmissionItem {
  submissionId: string;
  studentId: string;
  fullName: string;
  lessonId: string;
  sessionId: string;
  originalFileName: string;
  localFilePath: string;
  fileHash: string;
  parseStatus: "PARSED" | "PARSE_ERROR";
  parseErrorReason: string | null;
  parsedContent?: ParsedSubmissionContent;
  success: boolean;
  error?: string;
}

export interface DownloadSubmissionsBatchResult {
  success: boolean;
  classId: string;
  classCode: string;
  sessionId: string;
  lessonId: string;
  totalCandidates: number;
  downloadedCount: number;
  parsedCount: number;
  parseErrorCount: number;
  failedCount: number;
  items: DownloadedSubmissionItem[];
  error?: string;
}

/**
 * Sanitizes a path segment (classId, lessonId, submissionId, fileName) to prevent
 * directory traversal (`..`, `/`, `\`) when building `./temp_submissions/...`.
 */
export function sanitizePathSegment(raw: string, fallback = "unknown"): string {
  const base = path.basename(String(raw || "").trim());
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "");
  return cleaned || fallback;
}

/**
 * Builds the canonical allowlisted local file path for a downloaded homework submission:
 * `./temp_submissions/{classId}/{lessonId}/{submissionId}_{fileName}`
 */
export function buildSubmissionFilePath(params: {
  classId: string;
  lessonId: string;
  submissionId: string;
  fileName: string;
}): string {
  const safeClass = sanitizePathSegment(params.classId.toUpperCase(), "CLASS");
  const safeLesson = sanitizePathSegment(params.lessonId, "LESSON");
  const safeSubId = sanitizePathSegment(params.submissionId, "SUB");
  const safeFile = sanitizePathSegment(params.fileName, "submission.bin");

  const tempRoot = path.join(process.cwd(), "temp_submissions");
  assertPathAllowed(tempRoot);
  const lessonDir = assertPathAllowed(
    path.join(/*turbopackIgnore: true*/ tempRoot, safeClass, safeLesson)
  );
  const fullPath = assertPathAllowed(
    path.join(/*turbopackIgnore: true*/ lessonDir, `${safeSubId}_${safeFile}`)
  );
  return fullPath;
}

/**
 * Builds the allowlisted companion directory where multi-file submissions store their clean extracted files
 * (e.g. `main.ipynb` alongside `car-sales-data.csv` for isolated Python execution verification).
 */
export function buildSubmissionExtractedDir(params: {
  classId: string;
  lessonId: string;
  submissionId: string;
}): string {
  const safeClass = sanitizePathSegment(params.classId.toUpperCase(), "CLASS");
  const safeLesson = sanitizePathSegment(params.lessonId, "LESSON");
  const safeSubId = sanitizePathSegment(params.submissionId, "SUB");

  const tempRoot = path.join(process.cwd(), "temp_submissions");
  assertPathAllowed(tempRoot);
  const extractedDir = assertPathAllowed(
    path.join(/*turbopackIgnore: true*/ tempRoot, safeClass, safeLesson, `${safeSubId}_files`)
  );
  return extractedDir;
}

/**
 * Builds a deterministic ZIP buffer from downloaded files (fixed epoch date + sorted order)
 * so identical student files always yield the exact same SHA-256 `fileHash`.
 */
export function buildDeterministicSubmissionZipBuffer(
  files: Array<{ entryName: string; buffer: Buffer }>
): Buffer {
  const zip = new AdmZip();
  const fixedDate = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
  const sorted = [...files].sort((a, b) => a.entryName.localeCompare(b.entryName));
  for (const item of sorted) {
    zip.addFile(item.entryName, item.buffer);
    const entry = zip.getEntry(item.entryName);
    if (entry && entry.header) {
      entry.header.time = fixedDate;
    }
  }
  return zip.toBuffer();
}

export class SubmissionDownloader {
  /**
   * Downloads valid homework or Checkpoint (CP1/CP2) submissions for a selected lesson/session on MindX LMS,
   * supports multi-file attachments via MindX LMS `get-presigned-url`, detects dataset-only upload mistakes,
   * locks `submissionId -> studentId -> localFilePath -> fileHash` into SQLite immediately,
   * and parses the downloaded file(s) via Multi-Subject File Parser Engine.
   */
  public static async downloadLessonSubmissions(
    options: DownloadSubmissionsOptions
  ): Promise<DownloadSubmissionsBatchResult> {
    const classId = String(options.classId || "").trim().toUpperCase();
    const classCode = String(options.classCode || "").trim().toUpperCase();
    const sessionId = String(options.sessionId || "").trim();
    const jobId = `download_subs_${classCode}_${sessionId}_${Date.now()}`;

    if (!classId || !classCode || classId !== classCode) {
      throw new Error(
        `[SubmissionDownloader] Mã định danh lớp không khớp (classId='${classId}' !== classCode='${classCode}'). Đã chặn thao tác.`
      );
    }

    const escapedClassId = classId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const exactSessionRegex = new RegExp(`^${escapedClassId}_SESS_(\\d+)$`, "i");
    const sessionMatch = sessionId.match(exactSessionRegex);
    if (!sessionMatch) {
      throw new Error(
        `[SubmissionDownloader] Mã buổi học '${sessionId}' không thuộc đúng lớp '${classId}' (Yêu cầu ${classId}_SESS_XX).`
      );
    }

    const parsedSessionNumber = parseInt(sessionMatch[1], 10);
    if (
      typeof options.sessionNumber === "number" &&
      options.sessionNumber !== parsedSessionNumber
    ) {
      throw new Error(
        `[SubmissionDownloader] Mâu thuẫn số buổi học: sessionId='${sessionId}' là Buổi ${parsedSessionNumber}, nhưng sessionNumber=${options.sessionNumber}.`
      );
    }
    const derivedSessionNumber = parsedSessionNumber;

    if (typeof isRoboticsClassCode === "function" && isRoboticsClassCode(classCode)) {
      const robMsg = `Lớp Robotics '${classCode}' kiểm tra trên giấy (giáo viên tự nhập điểm), không có bài nộp trực tuyến trên LMS.`;
      return {
        success: false,
        classId,
        classCode,
        sessionId,
        lessonId: options.lessonId || "",
        totalCandidates: 0,
        downloadedCount: 0,
        parsedCount: 0,
        parseErrorCount: 0,
        failedCount: 0,
        items: [],
        error: robMsg,
      };
    }

    jobLogRepo.add({
      jobId,
      jobType: "DOWNLOAD_SUBMISSIONS",
      classId,
      sessionId,
      level: "INFO",
      message: `Bắt đầu lọc và tải bài nộp cho lớp ${classCode} (${sessionId}, Buổi ${derivedSessionNumber})...`,
    });

    try {
      // 1. Obtain fresh score matrix from LMS before filtering candidates so newly submitted work is always discovered
      let matrix: ClassScoreMatrixResult | null = null;
      if (
        options.forceScrapeMatrix !== false &&
        typeof ScoreScraper?.scrapeClassScores === "function"
      ) {
        try {
          matrix = await ScoreScraper.scrapeClassScores(classCode);
        } catch (scrapeErr: any) {
          const msg = scrapeErr instanceof Error ? scrapeErr.message : String(scrapeErr);
          if (isQueueStoppedError(scrapeErr)) {
            throw scrapeErr;
          }
          if (!/Must use synthetic cache/i.test(msg)) {
            throw scrapeErr;
          }
        }
      }

      if (!matrix && typeof scoreMatrixRepo?.findByClass === "function") {
        const cached = scoreMatrixRepo.findByClass(classId);
        if (cached && cached.matrix && cached.matrix.rows?.length > 0) {
          matrix = cached.matrix as ClassScoreMatrixResult;
        }
      }

      if (
        !matrix &&
        options.forceScrapeMatrix === false &&
        isLmsApiReadEnabled() &&
        !isRoboticsClassCode(classCode)
      ) {
        try {
          const known = resolveKnownLmsClassId(classCode);
          if (known.lmsClassId && isValidLmsClassObjectId(known.lmsClassId)) {
            const subRes = await lmsHttpClient.findStudentSubmissionByClass(
              "TEACHER",
              known.lmsClassId
            );
            const gqlPayload = subRes.submissionGqlData;
            if (gqlPayload) {
              const subClassCode = String(
                gqlPayload?.classCode || gqlPayload?.class?.code || gqlPayload?.class?.name || ""
              )
                .trim()
                .toUpperCase();
              const subClassId = String(
                gqlPayload?.classId || gqlPayload?.class?.id || ""
              ).trim();
              if (
                (subClassCode && subClassCode !== classCode) ||
                (subClassId &&
                  subClassId !== known.lmsClassId &&
                  subClassId.toUpperCase() !== classCode)
              ) {
                throw new Error(
                  `[Integrity Violation] FindStudentSubmissionByClass trả về dữ liệu thuộc lớp khác ('${
                    subClassId || subClassCode
                  }' !== '${known.lmsClassId}').`
                );
              }
              if (Array.isArray(gqlPayload?.submissions)) {
                const mismatchSub = gqlPayload.submissions.find((s: any) => {
                  const cid = String(s?.classId || "").trim();
                  return Boolean(cid) && cid !== known.lmsClassId && cid.toUpperCase() !== classCode;
                });
                if (mismatchSub) {
                  throw new Error(
                    `[Integrity Violation] Phát hiện bài nộp thuộc lớp khác ('${mismatchSub.classId}' !== '${known.lmsClassId}').`
                  );
                }
              }
              if (typeof (ScoreScraper as any)?.buildQuickMatrixFromSubmissionGql === "function") {
                matrix = await (ScoreScraper as any).buildQuickMatrixFromSubmissionGql({
                  classId,
                  classCode,
                  lmsClassId: known.lmsClassId,
                  submissionGqlData: gqlPayload,
                });
              }
            }
          }
        } catch (quickErr: any) {
          if (
            isQueueStoppedError(quickErr) ||
            (quickErr instanceof Error && quickErr.message.includes("Integrity Violation"))
          ) {
            throw quickErr;
          }
        }
      }

      if (!matrix || !matrix.success || !Array.isArray(matrix.columns) || matrix.columns.length === 0) {
        throw new Error(
          matrix?.error || `Không tìm thấy dữ liệu cột bài tập trên LMS cho lớp ${classCode}.`
        );
      }

      // 2. Match target lesson column (handles both regular Homework and Coding Checkpoint CP1=Buổi 5 / CP2=Buổi 9)
      const resolvedCol = resolveTargetMatrixColumn(
        matrix.columns,
        classCode,
        derivedSessionNumber,
        options.lessonId
      );
      if (resolvedCol.mismatchError) {
        throw new Error(resolvedCol.mismatchError);
      }
      const targetColumn = resolvedCol.column;

      if (!targetColumn) {
        throw new Error(
          `Không tìm thấy cột bài tập/Checkpoint tương ứng với Buổi ${derivedSessionNumber} (${options.lessonId || sessionId}) trong lớp ${classCode}.`
        );
      }

      const lessonId = String(targetColumn.lessonId || targetColumn.columnId);

      // 3. Filter all valid submissions in the lesson (skipping NOT_SUBMITTED / absent students)
      const candidates: Array<{
        studentId: string;
        fullName: string;
        cell: StudentScoreCell;
        submissionId: string;
        attachments: string[];
        primaryFileName: string;
        displayOriginalFileName: string;
        isDatasetOnlyMistake: boolean;
      }> = [];

      const dbRoster =
        typeof studentRepo?.findByClass === "function"
          ? studentRepo.findByClass(classId, false) || []
          : [];
      const dbRosterIds = new Set(dbRoster.map((s) => s.studentId));

      for (const row of matrix.rows) {
        if (options.studentId && row.studentId !== options.studentId) {
          continue;
        }

        // Verify student belongs to this class roster if roster is synced
        if (dbRosterIds.size > 0 && !dbRosterIds.has(row.studentId)) {
          throw new Error(
            `[Integrity Violation] Học viên '${row.fullName}' (${row.studentId}) trong bảng điểm không thuộc danh sách lớp '${classId}'.`
          );
        }

        const cell = row.cells?.[targetColumn.columnId];
        if (!cell || cell.status === "NOT_SUBMITTED" || !cell.submissionId) {
          continue;
        }

        const submissionId = String(cell.submissionId).trim();

        // F11: In batch mode (no explicit studentId), preserve submissions already graded on LMS
        // when no unverified local draft exists, so manual LMS grades are never overwritten.
        if (!options.studentId && cell.status === "GRADED") {
          const existingLocal = homeworkSubmissionRepo.findBySubmissionId(submissionId);
          if (!existingLocal || existingLocal.status === "VERIFIED") {
            continue;
          }
        }
        const classified = classifySubmissionAttachments(cell.attachments);
        const primaryRawName = classified.primaryFileName
          ? stripMindxUploadTimestampPrefix(classified.primaryFileName)
          : `${submissionId}.txt`;
        const cleanDisplayList = classified.cleanAttachments.map((a) =>
          stripMindxUploadTimestampPrefix(a)
        );
        const displayOriginalFileName =
          cleanDisplayList.length > 1
            ? cleanDisplayList.join(", ")
            : cleanDisplayList[0] || primaryRawName;

        candidates.push({
          studentId: row.studentId,
          fullName: row.fullName,
          cell,
          submissionId,
          attachments: classified.cleanAttachments,
          primaryFileName: primaryRawName,
          displayOriginalFileName,
          isDatasetOnlyMistake: classified.isDatasetOnlyMistake,
        });
      }

      if (candidates.length === 0) {
        jobLogRepo.add({
          jobId,
          jobType: "DOWNLOAD_SUBMISSIONS",
          classId,
          sessionId,
          level: "WARN",
          message: `Không có học viên nào nộp bài hợp lệ trong ${targetColumn.title} (${lessonId}).`,
        });

        return {
          success: true,
          classId,
          classCode,
          sessionId,
          lessonId,
          totalCandidates: 0,
          downloadedCount: 0,
          parsedCount: 0,
          parseErrorCount: 0,
          failedCount: 0,
          items: [],
        };
      }

      let page: any = null;
      let interceptor: any = null;
      const ensureBrowserReady = async () => {
        if (!page) {
          const browserManager = BrowserManager.getInstance();
          page = await browserManager.getPage();
          interceptor = createNetworkInterceptor(page);
          await authService.ensureAuthenticated("LMS");
        }
        return { page, interceptor };
      };

      const items: DownloadedSubmissionItem[] = [];
      let downloadedCount = 0;
      let parsedCount = 0;
      let parseErrorCount = 0;
      let failedCount = 0;
      let openedDrawerForFallback = false;

      for (const cand of candidates) {
        const isMultiAttachment = cand.attachments.length > 1;
        const targetBundleName = isMultiAttachment
          ? `${sanitizePathSegment(path.parse(cand.primaryFileName).name, "submission")}_bundle.zip`
          : cand.primaryFileName;

        const localFilePath = buildSubmissionFilePath({
          classId,
          lessonId,
          submissionId: cand.submissionId,
          fileName: targetBundleName,
        });
        const companionDir = buildSubmissionExtractedDir({
          classId,
          lessonId,
          submissionId: cand.submissionId,
        });

        try {
          // Verify pre-existing submission ownership in SQLite before touching files
          const existingSub = homeworkSubmissionRepo.findBySubmissionId(cand.submissionId);
          if (
            existingSub &&
            (existingSub.studentId !== cand.studentId ||
              existingSub.classId !== classId ||
              existingSub.sessionId !== sessionId)
          ) {
            throw new Error(
              `[Integrity Violation] submissionId '${cand.submissionId}' đã thuộc về (${existingSub.classId}, ${existingSub.sessionId}, ${existingSub.studentId}), không thể gán cho '${cand.studentId}'.`
            );
          }

          const targetDir = assertPathAllowed(path.dirname(localFilePath));
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }

          let fileReady = false;
          if (cand.attachments.length === 0) {
            // Submitted status without file attachments -> flag PARSE_ERROR so teacher inspects manually
            const emptyReason = `[MISSING_CODE_FILE] Học viên bấm nộp bài trên LMS nhưng không có tệp đính kèm nào (${cand.submissionId}). Vui lòng kiểm tra thủ công.`;
            homeworkSubmissionRepo.upsert({
              classId,
              sessionId,
              studentId: cand.studentId,
              submissionId: cand.submissionId,
              originalFileName: "",
              localFilePath: "",
              fileHash: existingSub?.fileHash || "",
              parseStatus: "PARSE_ERROR",
              parseErrorReason: emptyReason,
              criteriaGradesJson: "[]",
              calculatedScore: 0,
              teacherOverrideScore: null,
              decision: "GRADE",
              feedbackHtml: "",
              contentHash: "",
              status: "PENDING",
              verifiedAt: null,
              errorMessage: emptyReason,
            });
            parseErrorCount++;
            items.push({
              submissionId: cand.submissionId,
              studentId: cand.studentId,
              fullName: cand.fullName,
              lessonId,
              sessionId,
              originalFileName: "",
              localFilePath: "",
              fileHash: existingSub?.fileHash || "",
              parseStatus: "PARSE_ERROR",
              parseErrorReason: emptyReason,
              success: true,
            });
            continue;
          }

          // Download all attachments for this submission via MindX LMS Presigned URL API (or fallback modal)
          const downloadedBuffers: Array<{ entryName: string; buffer: Buffer }> = [];
          const usedEntryNames = new Set<string>();

          for (let aIdx = 0; aIdx < cand.attachments.length; aIdx++) {
            const attRef = cand.attachments[aIdx];
            const cleanBase = sanitizePathSegment(
              stripMindxUploadTimestampPrefix(attRef),
              `file_${aIdx + 1}`
            );
            let entryName = cleanBase;
            if (usedEntryNames.has(entryName.toLowerCase())) {
              const parsedExt = path.parse(cleanBase);
              entryName = `${parsedExt.name}_${aIdx + 1}${parsedExt.ext}`;
            }
            usedEntryNames.add(entryName.toLowerCase());

            let buf = await this.downloadViaPresignedUrl(page, attRef);
            if (!buf) {
              const ready = await ensureBrowserReady();
              buf = await this.downloadViaPresignedUrl(ready.page, attRef);
            }
            if (!buf) {
              const ready = await ensureBrowserReady();
              if (!openedDrawerForFallback) {
                await LmsHelpers.openClassDrawer(ready.page, classCode);
                await LmsHelpers.switchDrawerTab(ready.page, SELECTORS.tabs.grading);
                await ready.interceptor.dismissForbiddenToast();
                openedDrawerForFallback = true;
              }
              const tmpSinglePath = buildSubmissionFilePath({
                classId,
                lessonId,
                submissionId: cand.submissionId,
                fileName: entryName,
              });
              const okFallback = await this.downloadSingleAttachmentFromLms(
                ready.page,
                ready.interceptor,
                {
                  studentId: cand.studentId,
                  fullName: cand.fullName,
                  submissionId: cand.submissionId,
                  attachmentRef: attRef,
                  fileName: path.basename(attRef),
                },
                targetColumn.colIndex,
                tmpSinglePath
              );
              if (okFallback && fs.existsSync(tmpSinglePath)) {
                buf = fs.readFileSync(assertPathAllowed(tmpSinglePath));
                if (isMultiAttachment && tmpSinglePath !== localFilePath) {
                  try {
                    fs.unlinkSync(assertPathAllowed(tmpSinglePath));
                  } catch {}
                }
              }
            }

            if (!buf || buf.length === 0) {
              throw new Error(
                `Không thể tải tệp bài nộp '${path.basename(attRef)}' của học viên '${cand.fullName}' (${cand.submissionId}) từ LMS.`
              );
            }
            downloadedBuffers.push({ entryName, buffer: buf });
          }

          // Write companion extracted files so Python sandbox verifier can run .ipynb alongside .csv
          fs.mkdirSync(companionDir, { recursive: true });
          for (const existingEntry of fs.readdirSync(companionDir)) {
            const p = assertPathAllowed(path.join(companionDir, existingEntry));
            if (fs.statSync(p).isFile()) {
              fs.unlinkSync(p);
            }
          }
          for (const item of downloadedBuffers) {
            const dest = assertPathAllowed(path.join(companionDir, item.entryName));
            fs.writeFileSync(dest, item.buffer);
          }

          if (isMultiAttachment) {
            const zipBuf = buildDeterministicSubmissionZipBuffer(downloadedBuffers);
            fs.writeFileSync(assertPathAllowed(localFilePath), zipBuf);
            fileReady = true;
          } else {
            fs.writeFileSync(assertPathAllowed(localFilePath), downloadedBuffers[0].buffer);
            fileReady = true;
          }

          if (!fileReady || !fs.existsSync(localFilePath)) {
            throw new Error(
              `Không thể lưu tệp bài nộp '${cand.displayOriginalFileName}' của học viên '${cand.fullName}'.`
            );
          }

          const safeFilePath = assertPathAllowed(localFilePath);
          const fileBuf = fs.readFileSync(safeFilePath);
          const fileHash = calculateSha256(fileBuf);

          // Detect dataset-only upload mistake BEFORE marking PARSED (including single .zip containing only .csv/.tsv)
          let isZipDatasetOnly = false;
          if (
            !cand.isDatasetOnlyMistake &&
            !isMultiAttachment &&
            path.extname(safeFilePath).toLowerCase() === ".zip"
          ) {
            try {
              const zInspect = new AdmZip(fileBuf);
              const zEntries = zInspect
                .getEntries()
                .filter((e) => !e.isDirectory && !/(?:^|\/)__MACOSX\//i.test(e.entryName))
                .map((e) => path.basename(e.entryName));
              if (zEntries.length > 0 && classifySubmissionAttachments(zEntries).isDatasetOnlyMistake) {
                isZipDatasetOnly = true;
              }
            } catch {}
          }

          let parsedContent: ParsedSubmissionContent;
          if (cand.isDatasetOnlyMistake || isZipDatasetOnly) {
            const wrongFileReason = `[MISSING_CODE_FILE] Học viên chỉ nộp tệp dữ liệu ('${cand.displayOriginalFileName}'), không tìm thấy tệp bài làm/mã nguồn (.ipynb, .py...). Vui lòng kiểm tra lại với học viên trước khi chấm điểm.`;
            parsedContent = {
              parseStatus: "PARSE_ERROR",
              subjectType: "TEXT",
              fileName: path.basename(safeFilePath),
              extension: path.extname(safeFilePath).toLowerCase(),
              fileHash,
              byteSize: fileBuf.length,
              extractedText: "",
              inlineDataParts: [],
              metadata: { missingCodeFile: true, uploadedFiles: cand.displayOriginalFileName },
              parseErrorReason: wrongFileReason,
            };
          } else {
            parsedContent = parseSubmissionFile(safeFilePath);
          }

          // Preserve existing grading state if already APPROVED or VERIFIED with identical fileHash
          const preserveApproved =
            existingSub &&
            (existingSub.status === "APPROVED" || existingSub.status === "VERIFIED") &&
            existingSub.fileHash === fileHash &&
            parsedContent.parseStatus === "PARSED";

          homeworkSubmissionRepo.upsert({
            classId,
            sessionId,
            studentId: cand.studentId,
            submissionId: cand.submissionId,
            originalFileName: cand.displayOriginalFileName,
            localFilePath: safeFilePath,
            fileHash,
            parseStatus: parsedContent.parseStatus,
            parseErrorReason: parsedContent.parseErrorReason,
            criteriaGradesJson: preserveApproved
              ? existingSub.criteriaGradesJson
              : existingSub?.fileHash === fileHash
              ? existingSub?.criteriaGradesJson || "[]"
              : "[]",
            calculatedScore: preserveApproved
              ? existingSub.calculatedScore
              : existingSub?.fileHash === fileHash
              ? existingSub?.calculatedScore ?? 0
              : 0,
            teacherOverrideScore: preserveApproved
              ? existingSub.teacherOverrideScore
              : existingSub?.fileHash === fileHash
              ? existingSub?.teacherOverrideScore ?? null
              : null,
            decision: preserveApproved
              ? existingSub.decision
              : existingSub?.decision || "GRADE",
            feedbackHtml: preserveApproved
              ? existingSub.feedbackHtml
              : existingSub?.fileHash === fileHash
              ? existingSub?.feedbackHtml || ""
              : "",
            contentHash: preserveApproved ? existingSub.contentHash : "",
            status:
              parsedContent.parseStatus === "PARSE_ERROR"
                ? "PENDING"
                : preserveApproved
                ? existingSub.status
                : existingSub?.status === "WAITING_APPROVAL" && existingSub.fileHash === fileHash
                ? "WAITING_APPROVAL"
                : "PENDING",
            verifiedAt: preserveApproved ? existingSub.verifiedAt : null,
            errorMessage: parsedContent.parseErrorReason,
          });

          downloadedCount++;
          if (parsedContent.parseStatus === "PARSED") {
            parsedCount++;
          } else {
            parseErrorCount++;
          }

          jobLogRepo.add({
            jobId,
            jobType: "DOWNLOAD_SUBMISSIONS",
            classId,
            sessionId,
            studentId: cand.studentId,
            submissionId: cand.submissionId,
            level: parsedContent.parseStatus === "PARSED" ? "SUCCESS" : "WARN",
            message: `Đã khóa & tải bài của ${cand.fullName} (submissionId=${cand.submissionId}, files=${cand.displayOriginalFileName}, hash=${fileHash.slice(
              0,
              12
            )}..., parse=${parsedContent.parseStatus}).`,
          });

          items.push({
            submissionId: cand.submissionId,
            studentId: cand.studentId,
            fullName: cand.fullName,
            lessonId,
            sessionId,
            originalFileName: cand.displayOriginalFileName,
            localFilePath: safeFilePath,
            fileHash,
            parseStatus: parsedContent.parseStatus,
            parseErrorReason: parsedContent.parseErrorReason,
            parsedContent,
            success: true,
          });
        } catch (itemErr: any) {
          if (isQueueStoppedError(itemErr)) {
            throw itemErr;
          }
          failedCount++;
          const msg = itemErr instanceof Error ? itemErr.message : String(itemErr);
          jobLogRepo.add({
            jobId,
            jobType: "DOWNLOAD_SUBMISSIONS",
            classId,
            sessionId,
            studentId: cand.studentId,
            submissionId: cand.submissionId,
            level: "ERROR",
            message: `Lỗi tải bài của ${cand.fullName} (${cand.submissionId}): ${msg}`,
          });

          items.push({
            submissionId: cand.submissionId,
            studentId: cand.studentId,
            fullName: cand.fullName,
            lessonId,
            sessionId,
            originalFileName: cand.displayOriginalFileName,
            localFilePath,
            fileHash: "",
            parseStatus: "PARSE_ERROR",
            parseErrorReason: msg,
            success: false,
            error: msg,
          });
        }
      }

      return {
        success: failedCount === 0,
        classId,
        classCode,
        sessionId,
        lessonId,
        totalCandidates: candidates.length,
        downloadedCount,
        parsedCount,
        parseErrorCount,
        failedCount,
        items,
      };
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      jobLogRepo.add({
        jobId,
        jobType: "DOWNLOAD_SUBMISSIONS",
        classId,
        sessionId,
        level: "ERROR",
        message: `Thất bại khi tải bài nộp lớp ${classCode}: ${errMsg}`,
      });
      return {
        success: false,
        classId,
        classCode,
        sessionId,
        lessonId: options.lessonId || "",
        totalCandidates: 0,
        downloadedCount: 0,
        parsedCount: 0,
        parseErrorCount: 0,
        failedCount: 0,
        items: [],
        error: errMsg,
      };
    }
  }

  private static isAllowedDownloadUrl(rawUrl: string): boolean {
    try {
      const u = new URL(rawUrl);
      if (u.protocol !== "https:") return false;
      const h = u.hostname.toLowerCase();
      if (
        h === "localhost" ||
        h === "127.0.0.1" ||
        h === "0.0.0.0" ||
        h === "::1" ||
        h.startsWith("[") ||
        /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(h)
      ) {
        return false;
      }
      if (h.endsWith(".mindx.local")) {
        return process.env.MINDX_ALLOW_TEST_HOSTS === "1";
      }
      return (
        h === "mindx.edu.vn" ||
        h.endsWith(".mindx.edu.vn") ||
        h.endsWith(".amazonaws.com") ||
        h.endsWith(".cloudflarestorage.com") ||
        h.endsWith(".googleapis.com") ||
        h.endsWith(".digitaloceanspaces.com")
      );
    } catch {
      return false;
    }
  }

  private static async readFetchBodyWithSizeCap(
    resp: Response,
    maxBytes: number,
    label: string
  ): Promise<Buffer> {
    const declaredLen = Number(resp.headers.get("content-length") || 0);
    if (declaredLen > maxBytes) {
      throw new Error(
        `Tệp '${label}' vượt quá dung lượng cho phép (${Math.round(
          declaredLen / (1024 * 1024)
        )}MB > 25MB).`
      );
    }
    const reader = resp.body?.getReader();
    if (!reader) {
      const arr = await resp.arrayBuffer();
      if (arr.byteLength > maxBytes) {
        throw new Error(`Tệp '${label}' vượt quá dung lượng tối đa 25MB.`);
      }
      return Buffer.from(arr);
    }
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel().catch(() => {});
            throw new Error(`Tệp '${label}' vượt quá dung lượng tối đa 25MB.`);
          }
          chunks.push(Buffer.from(value));
        }
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks, total);
  }

  private static async fetchAllowedWithManualRedirects(
    initialUrl: string,
    label: string
  ): Promise<Buffer | null> {
    let currentUrl = initialUrl;
    for (let hop = 0; hop <= 3; hop++) {
      if (!this.isAllowedDownloadUrl(currentUrl)) {
        return null;
      }
      const resp = await globalThis.fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
      });
      if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers.get("location");
        if (!loc || hop === 3) return null;
        currentUrl = new URL(loc, currentUrl).toString();
        continue;
      }
      if (!resp.ok) return null;
      const buf = await this.readFetchBodyWithSizeCap(
        resp,
        MAX_SINGLE_ATTACHMENT_DOWNLOAD_BYTES,
        label
      );
      return buf.length > 0 ? buf : null;
    }
    return null;
  }

  private static async requestCtxGetAllowedWithManualRedirects(
    requestCtx: any,
    initialUrl: string,
    label: string
  ): Promise<Buffer | null> {
    let currentUrl = initialUrl;
    for (let hop = 0; hop <= 3; hop++) {
      if (!this.isAllowedDownloadUrl(currentUrl)) {
        return null;
      }
      const fileResp = await requestCtx.get(currentUrl, {
        timeout: 20000,
        maxRedirects: 0,
      });
      if (!fileResp) return null;
      const status = typeof fileResp.status === "function" ? fileResp.status() : 200;
      const headers = typeof fileResp.headers === "function" ? fileResp.headers() : {};
      if (status >= 300 && status < 400) {
        const loc = headers?.location || headers?.Location;
        if (!loc || hop === 3) return null;
        currentUrl = new URL(String(loc), currentUrl).toString();
        continue;
      }
      if (typeof fileResp.ok === "function" && !fileResp.ok()) {
        return null;
      }
      const declaredLen = Number(headers?.["content-length"] || 0);
      if (declaredLen > MAX_SINGLE_ATTACHMENT_DOWNLOAD_BYTES) {
        throw new Error(
          `Tệp '${label}' vượt quá dung lượng cho phép (${Math.round(
            declaredLen / (1024 * 1024)
          )}MB > 25MB).`
        );
      }
      const bodyBuf: Buffer = await fileResp.body();
      if (!bodyBuf || bodyBuf.length === 0) return null;
      if (bodyBuf.length > MAX_SINGLE_ATTACHMENT_DOWNLOAD_BYTES) {
        throw new Error(`Tệp '${label}' vượt quá dung lượng tối đa 25MB.`);
      }
      return bodyBuf;
    }
    return null;
  }

  /**
   * Resolves MindX LMS attachment key via `https://resources.mindx.edu.vn/api/v1/get-presigned-url?key=...`
   * and downloads the verified file buffer directly with size cap & HTTPS host allowlist protection.
   */
  private static async downloadViaPresignedUrl(
    page: any,
    attachmentRef: string
  ): Promise<Buffer | null> {
    const cleanRef = String(attachmentRef || "").trim();
    if (!cleanRef || cleanRef.includes("..") || cleanRef.includes("./") || cleanRef.includes(".\\")) {
      return null;
    }
    const label = path.basename(cleanRef);

    // Fast path: direct HTTPS fetch (no browser lock required)
    if (!page && (typeof globalThis.fetch !== "function" || globalThis.fetch === NATIVE_GLOBAL_FETCH)) {
      try {
        let downloadUrl = "";
        if (/^https:\/\//i.test(cleanRef)) {
          if (this.isAllowedDownloadUrl(cleanRef)) downloadUrl = cleanRef;
        } else {
          const cleanKey = cleanRef.replace(/^\/+/, "");
          const presignEndpoint = `https://resources.mindx.edu.vn/api/v1/get-presigned-url?key=${encodeURIComponent(
            cleanKey
          )}`;
          const presignRes = await fetchMindxResourceJson<{ url?: string }>(presignEndpoint, {
            timeoutMs: 12000,
            isAllowedUrl: (candidate) => this.isAllowedDownloadUrl(candidate),
          });
          if (
            presignRes.status >= 200 &&
            presignRes.status < 300 &&
            presignRes.data &&
            typeof presignRes.data.url === "string" &&
            this.isAllowedDownloadUrl(presignRes.data.url)
          ) {
            downloadUrl = presignRes.data.url;
          }
        }
        if (downloadUrl) {
          return await fetchMindxResourceBuffer(downloadUrl, {
            label,
            maxBytes: MAX_SINGLE_ATTACHMENT_DOWNLOAD_BYTES,
            maxRedirects: 3,
            timeoutMs: 20000,
            isAllowedUrl: (candidate) => this.isAllowedDownloadUrl(candidate),
          });
        }
      } catch (err: any) {
        if (
          isQueueStoppedError(err) ||
          (err instanceof Error && err.message.includes("25MB"))
        ) {
          throw err;
        }
      }
      return null;
    }

    if (typeof globalThis.fetch === "function" && !page) {
      try {
        let downloadUrl = "";
        if (/^https:\/\//i.test(cleanRef)) {
          if (this.isAllowedDownloadUrl(cleanRef)) downloadUrl = cleanRef;
        } else {
          const cleanKey = cleanRef.replace(/^\/+/, "");
          const presignEndpoint = `https://resources.mindx.edu.vn/api/v1/get-presigned-url?key=${encodeURIComponent(
            cleanKey
          )}`;
          const presignResp = await globalThis.fetch(presignEndpoint, {
            method: "GET",
            headers: { Accept: "application/json", "Cache-Control": "no-cache" },
            redirect: "error",
            signal: AbortSignal.timeout(12000),
          });
          if (presignResp.ok) {
            const json: any = await presignResp.json().catch(() => null);
            if (json && typeof json.url === "string" && this.isAllowedDownloadUrl(json.url)) {
              downloadUrl = json.url;
            }
          }
        }
        if (downloadUrl) {
          return await this.fetchAllowedWithManualRedirects(downloadUrl, label);
        }
      } catch (err: any) {
        if (err instanceof Error && err.message.includes("25MB")) {
          throw err;
        }
      }
      return null;
    }

    const requestCtx =
      (typeof page?.context === "function" && page.context()?.request) || page?.request;
    if (!requestCtx || typeof requestCtx.get !== "function") {
      return null;
    }

    try {
      let downloadUrl = "";
      if (/^https:\/\//i.test(cleanRef)) {
        if (this.isAllowedDownloadUrl(cleanRef)) downloadUrl = cleanRef;
      } else {
        const cleanKey = cleanRef.replace(/^\/+/, "");
        const presignEndpoint = `https://resources.mindx.edu.vn/api/v1/get-presigned-url?key=${encodeURIComponent(
          cleanKey
        )}`;
        const presignResp = await requestCtx.get(presignEndpoint, {
          timeout: 12000,
          maxRedirects: 0,
          headers: { Accept: "application/json", "Cache-Control": "no-cache" },
        });
        if (presignResp && typeof presignResp.ok === "function" && presignResp.ok()) {
          const json = await presignResp.json().catch(() => null);
          if (json && typeof json.url === "string" && this.isAllowedDownloadUrl(json.url)) {
            downloadUrl = json.url;
          }
        }
      }

      if (!downloadUrl) {
        return null;
      }

      return await this.requestCtxGetAllowedWithManualRedirects(requestCtx, downloadUrl, label);
    } catch (err: any) {
      if (err instanceof Error && err.message.includes("25MB")) {
        throw err;
      }
      return null;
    }
  }

  /**
   * Fallback: Opens the student's submission modal on LMS or resolves candidate attachment URLs
   * to download the file into `localFilePath`.
   */
  private static async downloadSingleAttachmentFromLms(
    page: any,
    interceptor: any,
    cand: {
      studentId: string;
      fullName: string;
      submissionId: string;
      attachmentRef: string;
      fileName: string;
    },
    colIndex: number,
    localFilePath: string
  ): Promise<boolean> {
    const safeTarget = assertPathAllowed(localFilePath);

    const drawer = page
      .locator('div[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight')
      .first();
    const panel3 = drawer.locator("#tabpanel-3").first();
    const context = (await panel3.isVisible().catch(() => false)) ? panel3 : drawer;

    const escapedStuId = cand.studentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedSubId = cand.submissionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const exactStuIdRegex = new RegExp(`(?<![\\p{L}\\p{N}_-])${escapedStuId}(?![\\p{L}\\p{N}_-])`, "iu");
    const exactSubIdRegex = new RegExp(`(?<![\\p{L}\\p{N}_-])${escapedSubId}(?![\\p{L}\\p{N}_-])`, "iu");

    const rowItems = context.locator(
      'div:has(> div > svg[data-testid="ExpandMoreIcon"]), div:has(> div > svg[data-testid="ExpandLessIcon"]), table tbody tr'
    );
    const rowCount = await rowItems.count().catch(() => 0);

    let openedModal = false;
    let downloadUrlFromDom = "";

    for (let r = 0; r < rowCount; r++) {
      const item = rowItems.nth(r);
      const rowContainer = (await item.locator("..").locator("..").count().catch(() => 0)) > 0
        ? item.locator("..").locator("..")
        : item;
      const rowText = (await rowContainer.innerText().catch(() => "")).trim();
      if (!exactStuIdRegex.test(rowText)) {
        continue;
      }

      const cells = rowContainer.locator("> div, > td");
      const cellCount = await cells.count().catch(() => 0);
      const targetCell =
        colIndex + 1 < cellCount ? cells.nth(colIndex + 1) : cells.last();

      await targetCell.scrollIntoViewIfNeeded().catch(() => {});
      await targetCell.click({ force: true }).catch(() => {});
      await page.waitForTimeout?.(500);

      const modal = page.locator(SELECTORS.grading.modal.container).first();
      if (await modal.isVisible().catch(() => false)) {
        const modalText = (await modal.innerText().catch(() => "")).trim();
        if (
          modalText &&
          exactStuIdRegex.test(modalText) &&
          exactSubIdRegex.test(modalText)
        ) {
          openedModal = true;

          const safeCssFileName = String(cand.fileName || "").replace(/["\\]/g, "\\$&");
          const linkLocator = modal
            .locator(
              `${SELECTORS.grading.modal.submissionFileLink}, a[href*="uploads"], a[href*="${safeCssFileName}"]`
            )
            .first();
          if ((await linkLocator.count().catch(() => 0)) > 0) {
            downloadUrlFromDom =
              (await linkLocator.getAttribute("href").catch(() => "")) || "";
          }

          const downloadBtn = modal
            .locator(
              `${SELECTORS.grading.modal.downloadButton}, ${SELECTORS.grading.modal.submissionFileLink}, button:has(svg[data-testid*="Download" i]), a[download]`
            )
            .first();

          if (
            (await downloadBtn.count().catch(() => 0)) > 0 &&
            typeof page.waitForEvent === "function"
          ) {
            try {
              const [download] = await Promise.all([
                page.waitForEvent("download", { timeout: 6000 }),
                downloadBtn.click({ force: true }),
              ]);
              if (download && typeof download.saveAs === "function") {
                await download.saveAs(safeTarget);
                await page.keyboard?.press?.("Escape").catch(() => {});
                if (fs.existsSync(safeTarget)) {
                  const sz = fs.statSync(safeTarget).size;
                  if (sz > MAX_SINGLE_ATTACHMENT_DOWNLOAD_BYTES) {
                    try {
                      fs.unlinkSync(safeTarget);
                    } catch {}
                    throw new Error(`Tệp '${cand.fileName}' vượt quá dung lượng tối đa 25MB.`);
                  }
                  if (sz > 0) return true;
                }
              }
            } catch {
              // Fall through to direct authenticated fetch
            }
          }
        } else {
          await page.keyboard?.press?.("Escape").catch(() => {});
          return false;
        }
        await page.keyboard?.press?.("Escape").catch(() => {});
      }
      break;
    }

    if (!openedModal) {
      return false;
    }

    const candidateUrls: string[] = [];
    if (downloadUrlFromDom) {
      candidateUrls.push(downloadUrlFromDom);
    }
    if (cand.attachmentRef) {
      if (/^https?:\/\//i.test(cand.attachmentRef)) {
        candidateUrls.push(cand.attachmentRef);
      } else {
        const cleanRel = cand.attachmentRef.replace(/^\/+/, "");
        const baseOrigin = new URL(config.lmsUrl || "https://lms.mindx.edu.vn").origin;
        candidateUrls.push(
          `https://lms-api.mindx.edu.vn/${cleanRel}`,
          `${baseOrigin}/${cleanRel}`,
          `https://static.mindx.edu.vn/${cleanRel}`
        );
      }
    }

    if (page.request && typeof page.request.get === "function") {
      for (const url of candidateUrls) {
        if (!this.isAllowedDownloadUrl(url)) continue;
        try {
          const bodyBuf = await this.requestCtxGetAllowedWithManualRedirects(
            page.request,
            url,
            cand.fileName
          );
          if (bodyBuf && bodyBuf.length > 0) {
            fs.writeFileSync(safeTarget, bodyBuf);
            return true;
          }
        } catch (err: any) {
          if (err instanceof Error && err.message.includes("25MB")) {
            throw err;
          }
        }
      }
    }

    await interceptor?.dismissForbiddenToast?.();
    return false;
  }
}
