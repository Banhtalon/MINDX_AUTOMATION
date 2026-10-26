import fs from "node:fs";
import path from "node:path";
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
} from "../db/sqlite";
import { assertPathAllowed } from "../security/path-allowlist";
import { parseSubmissionFile, type ParsedSubmissionContent } from "../file-parsers";
import { config } from "../config";

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

export class SubmissionDownloader {
  /**
   * Downloads valid homework submissions for a selected lesson/session on MindX LMS,
   * locks `submissionId -> studentId -> localFilePath -> fileHash` into SQLite immediately,
   * and parses the downloaded file via Multi-Subject File Parser Engine.
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

    jobLogRepo.add({
      jobId,
      jobType: "DOWNLOAD_SUBMISSIONS",
      classId,
      sessionId,
      level: "INFO",
      message: `Bắt đầu lọc và tải bài nộp cho lớp ${classCode} (${sessionId}, Buổi ${derivedSessionNumber})...`,
    });

    try {
      // 1. Obtain fresh score matrix from LMS before filtering candidates so newly submitted homework is always discovered
      let matrix: ClassScoreMatrixResult | null = null;
      if (
        options.forceScrapeMatrix !== false &&
        typeof ScoreScraper?.scrapeClassScores === "function"
      ) {
        try {
          matrix = await ScoreScraper.scrapeClassScores(classCode);
        } catch (scrapeErr: any) {
          const msg = scrapeErr instanceof Error ? scrapeErr.message : String(scrapeErr);
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

      if (!matrix || !matrix.success || !Array.isArray(matrix.columns) || matrix.columns.length === 0) {
        throw new Error(
          matrix?.error || `Không tìm thấy dữ liệu cột bài tập trên LMS cho lớp ${classCode}.`
        );
      }

      // 2. Match target lesson column strictly by authoritative sessionNumber and optional lessonId
      let targetColumn = matrix.columns.find(
        (c) => Number(c.sessionNumber) === derivedSessionNumber
      );

      if (options.lessonId) {
        const byLesson = matrix.columns.find(
          (c) => c.columnId === options.lessonId || c.lessonId === options.lessonId
        );
        if (!byLesson) {
          throw new Error(
            `Không tìm thấy cột bài tập có lessonId='${options.lessonId}' trong lớp ${classCode}.`
          );
        }
        if (Number(byLesson.sessionNumber) !== derivedSessionNumber) {
          throw new Error(
            `[Integrity Violation] lessonId '${options.lessonId}' thuộc Buổi ${byLesson.sessionNumber}, không khớp với session '${sessionId}' (Buổi ${derivedSessionNumber}).`
          );
        }
        targetColumn = byLesson;
      }

      if (!targetColumn) {
        throw new Error(
          `Không tìm thấy cột bài tập tương ứng với Buổi ${derivedSessionNumber} (${options.lessonId || sessionId}) trong lớp ${classCode}.`
        );
      }

      const lessonId = String(targetColumn.lessonId || targetColumn.columnId);

      // 3. Filter all valid submissions in the lesson (regardless of session attendance)
      const candidates: Array<{
        studentId: string;
        fullName: string;
        cell: StudentScoreCell;
        submissionId: string;
        attachmentRef: string;
        fileName: string;
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
        const attachmentRef =
          Array.isArray(cell.attachments) && cell.attachments.length > 0
            ? String(cell.attachments[0] || "").trim()
            : "";
        const rawFileName = attachmentRef
          ? attachmentRef.split(/[\\/]/).pop() || `${submissionId}.txt`
          : `${submissionId}.txt`;

        candidates.push({
          studentId: row.studentId,
          fullName: row.fullName,
          cell,
          submissionId,
          attachmentRef,
          fileName: rawFileName,
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

      const browserManager = BrowserManager.getInstance();
      const page = await browserManager.getPage();
      const interceptor = createNetworkInterceptor(page);

      await authService.ensureAuthenticated("LMS");
      await LmsHelpers.openClassDrawer(page, classCode);
      await LmsHelpers.switchDrawerTab(page, SELECTORS.tabs.grading);
      await interceptor.dismissForbiddenToast();

      const items: DownloadedSubmissionItem[] = [];
      let downloadedCount = 0;
      let parsedCount = 0;
      let parseErrorCount = 0;
      let failedCount = 0;

      for (const cand of candidates) {
        const localFilePath = buildSubmissionFilePath({
          classId,
          lessonId,
          submissionId: cand.submissionId,
          fileName: cand.fileName,
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

          // If file already exists on disk and matches existing verified/approved record, reuse or re-verify hash
          let fileDownloaded = false;

          if (
            existingSub &&
            existingSub.localFilePath &&
            path.resolve(existingSub.localFilePath) === path.resolve(localFilePath) &&
            fs.existsSync(assertPathAllowed(existingSub.localFilePath)) &&
            existingSub.fileHash
          ) {
            const existingBuf = fs.readFileSync(assertPathAllowed(existingSub.localFilePath));
            if (calculateSha256(existingBuf) === existingSub.fileHash) {
              fileDownloaded = true;
            }
          }

          if (!fileDownloaded) {
            fileDownloaded = await this.downloadSingleAttachmentFromLms(
              page,
              interceptor,
              cand,
              targetColumn.colIndex,
              localFilePath
            );
          }

          if (!fileDownloaded || !fs.existsSync(localFilePath)) {
            throw new Error(
              `Không thể tải file bài nộp '${cand.fileName}' của học viên '${cand.fullName}' (submissionId: ${cand.submissionId}) từ LMS.`
            );
          }

          // Compute SHA-256 fileHash immediately
          const safeFilePath = assertPathAllowed(localFilePath);
          const fileBuf = fs.readFileSync(safeFilePath);
          const fileHash = calculateSha256(fileBuf);

          // Parse downloaded file via Multi-Subject File Parser Engine
          const parsedContent = parseSubmissionFile(safeFilePath);

          // Preserve existing grading state if already APPROVED or VERIFIED with identical fileHash
          const preserveApproved =
            existingSub &&
            (existingSub.status === "APPROVED" || existingSub.status === "VERIFIED") &&
            existingSub.fileHash === fileHash;

          homeworkSubmissionRepo.upsert({
            classId,
            sessionId,
            studentId: cand.studentId,
            submissionId: cand.submissionId,
            originalFileName: cand.fileName,
            localFilePath: safeFilePath,
            fileHash,
            parseStatus: parsedContent.parseStatus,
            parseErrorReason: parsedContent.parseErrorReason,
            criteriaGradesJson: preserveApproved
              ? existingSub.criteriaGradesJson
              : existingSub?.criteriaGradesJson || "[]",
            calculatedScore: preserveApproved
              ? existingSub.calculatedScore
              : existingSub?.calculatedScore ?? 0,
            teacherOverrideScore: preserveApproved
              ? existingSub.teacherOverrideScore
              : existingSub?.teacherOverrideScore ?? null,
            decision: preserveApproved
              ? existingSub.decision
              : existingSub?.decision || "GRADE",
            feedbackHtml: preserveApproved
              ? existingSub.feedbackHtml
              : existingSub?.feedbackHtml || "",
            contentHash: preserveApproved ? existingSub.contentHash : "",
            status: preserveApproved
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
            message: `Đã khóa & tải bài của ${cand.fullName} (submissionId=${cand.submissionId}, file=${cand.fileName}, hash=${fileHash.slice(
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
            originalFileName: cand.fileName,
            localFilePath: safeFilePath,
            fileHash,
            parseStatus: parsedContent.parseStatus,
            parseErrorReason: parsedContent.parseErrorReason,
            parsedContent,
            success: true,
          });
        } catch (itemErr: any) {
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
            originalFileName: cand.fileName,
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

  /**
   * Opens the student's submission modal on LMS or resolves the authenticated attachment URL
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

    // 1. Try opening the submission modal in #tabpanel-3 and clicking the download icon/link
    const drawer = page
      .locator('div[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight')
      .first();
    const panel3 = drawer.locator("#tabpanel-3").first();
    const context = (await panel3.isVisible().catch(() => false)) ? panel3 : drawer;

    const escapedName = cand.fullName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedStuId = cand.studentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedSubId = cand.submissionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedFile = cand.fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const exactNameLineRegex = new RegExp(`(?<![\\p{L}\\p{N}_-])${escapedName}(?![\\p{L}\\p{N}_-])`, "iu");
    const exactStuIdRegex = new RegExp(`(?<![\\p{L}\\p{N}_-])${escapedStuId}(?![\\p{L}\\p{N}_-])`, "iu");
    const exactSubIdRegex = new RegExp(`(?<![\\p{L}\\p{N}_-])${escapedSubId}(?![\\p{L}\\p{N}_-])`, "iu");
    const exactFileRegex = new RegExp(`(?<![\\p{L}\\p{N}_-])${escapedFile}(?![\\p{L}\\p{N}_-])`, "iu");

    // Find student row in grid or table
    const rowItems = context.locator(
      'div:has(> div > svg[data-testid="ExpandMoreIcon"]), table tbody tr'
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
        // Verify modal strictly proves BOTH target studentId AND target submissionId (name alone is insufficient)
        if (
          modalText &&
          exactStuIdRegex.test(modalText) &&
          exactSubIdRegex.test(modalText)
        ) {
          openedModal = true;

          // Extract href if a link is present inside the modal
          const linkLocator = modal
            .locator(
              `${SELECTORS.grading.modal.submissionFileLink}, a[href*="uploads"], a[href*="${cand.fileName}"]`
            )
            .first();
          if ((await linkLocator.count().catch(() => 0)) > 0) {
            downloadUrlFromDom =
              (await linkLocator.getAttribute("href").catch(() => "")) || "";
          }

          // Try clicking the download button/link while listening for Playwright 'download' event
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
                return true;
              }
            } catch {
              // Fall through to direct authenticated fetch if click didn't trigger download event
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

    // 2. Fallback: Authenticated HTTP GET using attachment URL from modal or GraphQL payload
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
          `https://static.mindx.edu.vn/${cleanRel}`,
          `https://s3.ap-southeast-1.amazonaws.com/mindx-lms/${cleanRel}`
        );
      }
    }

    if (page.request && typeof page.request.get === "function") {
      for (const url of candidateUrls) {
        try {
          const response = await page.request.get(url, { timeout: 8000 });
          if (response && typeof response.ok === "function" && response.ok()) {
            const bodyBuf = await response.body();
            if (bodyBuf && bodyBuf.length > 0) {
              fs.writeFileSync(safeTarget, bodyBuf);
              return true;
            }
          }
        } catch {
          // Try next candidate URL
        }
      }
    }

    await interceptor?.dismissForbiddenToast?.();
    return false;
  }
}
