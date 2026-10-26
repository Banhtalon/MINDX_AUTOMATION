import type { Locator } from "playwright";
import { BrowserManager } from "./browser-manager";
import { authService } from "./auth";
import { LmsHelpers } from "./lms-helpers";
import { SELECTORS } from "./selectors";
import { createNetworkInterceptor } from "./network-interceptor";
import {
  studentRepo,
  jobLogRepo,
  scoreMatrixRepo,
  getDb,
  type StudentRecord,
} from "../db/sqlite";

export type ScoreCellStatus =
  | "GRADED"
  | "SUBMITTED_UNGRADED"
  | "NOT_SUBMITTED"
  | "REDO_REQUESTED";

export interface ScoreColumnInfo {
  colIndex: number;
  columnId: string;
  lessonId?: string;
  title: string;
  sessionNumber: number;
  lessonType?: string;
}

export interface StudentScoreCell {
  columnId: string;
  lessonId?: string;
  sessionNumber: number;
  status: ScoreCellStatus;
  score: number | null; // Practice / main score (strictly preserves 0 when 0/100)
  quizScore?: number | null; // Optional Quiz score on Denise/LMS
  maxScore: number;
  submissionId?: string | null;
  attachments?: string[];
  teacherNote?: string;
  submittedAt?: string;
  gradedCountText?: string; // e.g., "1/1" or "0/1"
  rawText: string;
}

export interface StudentScoreRow {
  studentId: string;
  studentUid?: string;
  fullName: string;
  isActive: boolean;
  cells: Record<string, StudentScoreCell>;
  averageScore: number | null;
  averageQuizScore?: number | null;
  gradedCount: number;
  submittedUngradedCount: number;
  notSubmittedCount: number;
  redoCount: number;
}

export interface ClassScoreMatrixResult {
  success: boolean;
  classId: string;
  classCode: string;
  lmsClassId?: string;
  columns: ScoreColumnInfo[];
  rows: StudentScoreRow[];
  summary: {
    totalStudents: number;
    totalColumns: number;
    gradedCells: number;
    submittedUngradedCells: number;
    notSubmittedCells: number;
    redoCells: number;
    zeroScoreCells: number;
  };
  scrapedAt: string;
  error?: string;
}

export class ScoreScraper {
  /**
   * Scrapes the entire Homework / Submission score matrix for a class on MindX LMS (#tab-3).
   * Captures the exact FindStudentSubmissionByClass GraphQL payload + DOM verification,
   * strictly distinguishing GRADED (including 0/100), SUBMITTED_UNGRADED, NOT_SUBMITTED, and REDO_REQUESTED.
   */
  public static async scrapeClassScores(rawClassCode: string): Promise<ClassScoreMatrixResult> {
    const classCode = rawClassCode.trim().toUpperCase();
    const classId = classCode;
    const jobId = `scrape_scores_${classCode}_${Date.now()}`;

    jobLogRepo.add({
      jobId,
      jobType: "SCRAPE_SCORES",
      classId,
      level: "INFO",
      message: `Bắt đầu cào bảng điểm toàn khóa cho lớp ${classCode} từ LMS...`,
    });

    const browserManager = BrowserManager.getInstance();
    const page = await browserManager.getPage();
    const interceptor = createNetworkInterceptor(page);

    try {
      // 1. Ensure authenticated on MindX LMS
      await authService.ensureAuthenticated("LMS");

      // 2. Open target class Drawer
      await LmsHelpers.openClassDrawer(page, classCode);

      const drawer = page
        .locator('div[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight')
        .first();
      const drawerText = await drawer.innerText().catch(() => "");
      const escapedCode = classCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const drawerCodeRegex = new RegExp(`(^|[^a-zA-Z0-9_-])${escapedCode}([^a-zA-Z0-9_-]|$)`, "i");
      const isDrawerDomVerified = Boolean(drawerText && drawerCodeRegex.test(drawerText));

      // 3. Intercept FindStudentSubmissionByClass GraphQL response when switching to Submission (#tab-3)
      jobLogRepo.add({
        jobId,
        jobType: "SCRAPE_SCORES",
        classId,
        level: "INFO",
        message: `Đang mở tab Chấm bài / Submission (#tab-3) của lớp ${classCode} và thu thập dữ liệu điểm...`,
      });

      let submissionGqlData: any = null;
      let lmsClassId: string | undefined;
      let gqlInterceptError: string | null = null;

      const onResponse = async (res: any) => {
        if (res.url().includes("mindx.edu.vn") && res.request().method() === "POST") {
          try {
            const reqBody = res.request().postDataJSON();
            if (reqBody?.operationName === "FindStudentSubmissionByClass") {
              const status = typeof res.status === "function" ? res.status() : 200;
              if (status !== 200 && status !== 201) {
                gqlInterceptError = `API FindStudentSubmissionByClass trả về mã lỗi HTTP ${status}`;
                return;
              }

              const reqClassId = String(reqBody?.variables?.payload?.classId || "").trim();
              const resJson = await res.json();
              if (resJson && Array.isArray(resJson.errors) && resJson.errors.length > 0) {
                gqlInterceptError = `GraphQL FindStudentSubmissionByClass trả về lỗi: ${resJson.errors[0]?.message || "Unknown error"}`;
                return;
              }

              const gqlPayload = resJson?.data?.findStudentSubmissionByClass;
              const payloadClassCode = String(
                gqlPayload?.classCode ||
                  gqlPayload?.class?.code ||
                  gqlPayload?.class?.name ||
                  ""
              )
                .trim()
                .toUpperCase();

              const isClassVerified =
                reqClassId.toUpperCase() === classCode ||
                (Boolean(payloadClassCode) && payloadClassCode === classCode) ||
                (isDrawerDomVerified && !payloadClassCode && /^[a-f0-9]{24}$/i.test(reqClassId));

              if (
                !reqClassId ||
                !isClassVerified ||
                (payloadClassCode && payloadClassCode !== classCode)
              ) {
                gqlInterceptError = `Dữ liệu FindStudentSubmissionByClass trả về thuộc lớp khác hoặc chưa xác thực định danh lớp ('${reqClassId}' !== '${classCode}')`;
                return;
              }

              if (gqlPayload) {
                lmsClassId = reqClassId || undefined;
                submissionGqlData = gqlPayload;
                gqlInterceptError = null;
              }
            }
          } catch {}
        }
      };

      page.on("response", onResponse);

      try {
        const tab3 = drawer
          .locator('#tab-3, [role="tab"]:has-text("Submission"), [role="tab"]:has-text("Chấm bài")')
          .first();

        // If tab-3 is already selected, switch briefly to tab-0 and back so FindStudentSubmissionByClass fires fresh
        const isAlreadySelected =
          (await tab3.getAttribute("aria-selected").catch(() => "false")) === "true";

        if (isAlreadySelected) {
          const tab0 = drawer.locator("#tab-0").first();
          if ((await tab0.count().catch(() => 0)) > 0) {
            await tab0.click({ force: true }).catch(() => {});
            await page.waitForTimeout(500);
          }
        }

        if ((await tab3.count().catch(() => 0)) > 0) {
          await tab3.scrollIntoViewIfNeeded().catch(() => {});
          await tab3.click({ force: true });
        } else {
          await LmsHelpers.switchDrawerTab(page, SELECTORS.tabs.grading);
        }

        // Wait up to 6s for FindStudentSubmissionByClass response
        for (let tick = 0; tick < 20 && !submissionGqlData && !gqlInterceptError; tick++) {
          await page.waitForTimeout(300);
        }
      } finally {
        page.off("response", onResponse);
      }

      if (gqlInterceptError && !submissionGqlData) {
        throw new Error(gqlInterceptError);
      }

      await interceptor.dismissForbiddenToast();

      // Load existing students from SQLite for safe ID resolution
      const existingStudents = studentRepo.findByClass(classId, false) || [];
      const normalizeName = (s: string) =>
        s
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/đ/g, "d")
          .replace(/Đ/g, "D")
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .replace(/\s+/g, " ")
          .trim();

      const studentByIdMap = new Map<string, StudentRecord>();
      const studentByNameMap = new Map<string, StudentRecord>();
      const existingNameCounts = new Map<string, number>();

      for (const st of existingStudents) {
        studentByIdMap.set(st.studentId, st);
        const norm = normalizeName(st.fullName);
        existingNameCounts.set(norm, (existingNameCounts.get(norm) || 0) + 1);
        studentByNameMap.set(norm, st);
      }

      let columns: ScoreColumnInfo[] = [];
      let rows: StudentScoreRow[] = [];

      if (
        submissionGqlData &&
        Array.isArray(submissionGqlData.lessons) &&
        submissionGqlData.lessons.length > 0 &&
        Array.isArray(submissionGqlData.students) &&
        submissionGqlData.students.length > 0
      ) {
        // Parse directly from verified FindStudentSubmissionByClass GraphQL payload
        const sortedLessons = [...submissionGqlData.lessons].sort(
          (a: any, b: any) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)
        );

        columns = sortedLessons.map((lesson: any, idx: number) => {
          const rawTitle = String(lesson.name || `Buổi ${idx + 1}`).trim();
          const numMatch =
            rawTitle.match(/(?:homework|bài|buổi|session|slot|lần)\s*(\d+)/i) ||
            rawTitle.match(/(\d+)/);
          const sessionNumber = numMatch ? parseInt(numMatch[1], 10) : idx + 1;
          return {
            colIndex: idx,
            columnId: String(lesson.id),
            lessonId: String(lesson.id),
            title: rawTitle,
            sessionNumber,
            lessonType: lesson.type || "REVIEW_AND_PRACTICE",
          };
        });

        if (!Array.isArray(submissionGqlData.submissions)) {
          throw new Error(
            `Dữ liệu GraphQL FindStudentSubmissionByClass thiếu danh sách bài nộp hợp lệ (submissions không phải mảng).`
          );
        }
        const allSubmissions: any[] = submissionGqlData.submissions;
        const gqlStudents: any[] = [...submissionGqlData.students];

        const expectedGqlTotal = Number(
          submissionGqlData.total ??
            submissionGqlData.totalStudents ??
            submissionGqlData.pagination?.total ??
            0
        );
        if (expectedGqlTotal > 0 && gqlStudents.length !== expectedGqlTotal) {
          throw new Error(
            `Dữ liệu GraphQL FindStudentSubmissionByClass chưa đầy đủ (${gqlStudents.length}/${expectedGqlTotal} học viên).`
          );
        }

        // Real MindX LMS FindStudentSubmissionByClass API only returns active students;
        // when the open Drawer DOM is verified for this class and all active students are present,
        // include synced inactive students (isActive === 0) so the full class roster is preserved in reports.
        const expectedActiveCount = existingStudents.filter((s) => s.isActive === 1).length;
        if (
          isDrawerDomVerified &&
          expectedActiveCount > 0 &&
          gqlStudents.length >= expectedActiveCount &&
          gqlStudents.length < existingStudents.length
        ) {
          const presentNormNames = new Set(
            gqlStudents.map((gs: any) => normalizeName(String(gs.displayName || "")))
          );
          const presentIds = new Set(
            gqlStudents
              .map((gs: any) => String(gs.studentUid || gs.id || "").trim())
              .filter(Boolean)
          );
          for (const st of existingStudents) {
            if (
              st.isActive === 0 &&
              !presentIds.has(st.studentId) &&
              !presentNormNames.has(normalizeName(st.fullName))
            ) {
              gqlStudents.push({
                studentUid: st.studentId,
                displayName: st.fullName,
              });
            }
          }
        }

        const expectedRosterCount = existingStudents.length;
        if (expectedRosterCount > 0 && gqlStudents.length < expectedRosterCount) {
          throw new Error(
            `Dữ liệu GraphQL trả về số học viên (${gqlStudents.length}) ít hơn danh sách học viên đã đồng bộ của lớp (${expectedRosterCount}).`
          );
        }

        // Count duplicate names inside the GraphQL student list to prevent merging two students with the same name
        const gqlNameCounts = new Map<string, number>();
        for (const gqlSt of gqlStudents) {
          const norm = normalizeName(String(gqlSt.displayName || ""));
          gqlNameCounts.set(norm, (gqlNameCounts.get(norm) || 0) + 1);
        }

        const usedStudentIds = new Set<string>();

        rows = gqlStudents.map((gqlSt: any, sIdx: number) => {
          const displayName = String(gqlSt.displayName || `Học viên ${sIdx + 1}`).trim();
          const studentUid = String(gqlSt.studentUid || gqlSt.id || "").trim();
          const normName = normalizeName(displayName);

          // 1. Prefer exact ID match
          let matchedStudent = studentUid ? studentByIdMap.get(studentUid) : undefined;

          // 2. Only match by exact normalized fullName if the name is strictly unique in BOTH GraphQL and SQLite (never substring match)
          if (
            !matchedStudent &&
            gqlNameCounts.get(normName) === 1 &&
            existingNameCounts.get(normName) === 1
          ) {
            const candidate = studentByNameMap.get(normName);
            if (candidate && !usedStudentIds.has(candidate.studentId)) {
              matchedStudent = candidate;
            }
          }

          if (existingStudents.length > 0 && !matchedStudent) {
            throw new Error(
              `Dữ liệu bảng điểm không khớp hoặc mơ hồ với danh sách lớp '${classCode}': Không thể ánh xạ duy nhất học viên '${displayName}' (${studentUid || "không rõ mã"}) với danh sách lớp đã đồng bộ.`
            );
          }

          if (!matchedStudent && !studentUid && (gqlNameCounts.get(normName) || 0) > 1) {
            throw new Error(
              `Xung đột định danh học viên: Có nhiều học viên trùng tên '${displayName}' nhưng thiếu mã định danh (studentUid) trên LMS.`
            );
          }

          const normSlug = normName.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
          const studentId =
            matchedStudent?.studentId ||
            studentUid ||
            (normSlug ? `STU_${classId}_${normSlug.toUpperCase()}` : `STU_${classId}_${sIdx + 1}`);

          if (usedStudentIds.has(studentId)) {
            throw new Error(
              `Xung đột định danh học viên: Mã '${studentId}' bị trùng lặp cho học viên '${displayName}'.`
            );
          }
          usedStudentIds.add(studentId);

          const isActive = matchedStudent ? Boolean(matchedStudent.isActive) : true;

          const cells: Record<string, StudentScoreCell> = {};
          let gradedSum = 0;
          let gradedCount = 0;
          let quizSum = 0;
          let quizCount = 0;
          let submittedUngradedCount = 0;
          let notSubmittedCount = 0;
          let redoCount = 0;

          for (const col of columns) {
            const stuLessonSubs = allSubmissions.filter(
              (sub) =>
                String(sub.studentUid) === studentUid &&
                String(sub.lessonId) === col.columnId
            );

            const practiceSub = stuLessonSubs.find(
              (sub) =>
                sub.category === "PRACTICE_TASK1" ||
                sub.type === "UPLOAD_FILE" ||
                sub.type === "SCRATCH" ||
                sub.submissionType === "PRACTICE"
            );
            const quizSub = stuLessonSubs.find(
              (sub) =>
                sub.category === "QUIZ" ||
                sub.type === "QUIZ" ||
                sub.submissionType === "QUIZ"
            );

            if (quizSub) {
              const qStatus = String(quizSub.status || "").toUpperCase();
              if (
                qStatus === "MARKED" &&
                (typeof quizSub.score !== "number" || Number.isNaN(quizSub.score))
              ) {
                throw new Error(
                  `Dữ liệu điểm Quiz không hợp lệ trên LMS: Bài Quiz của '${displayName}' (${col.title}) có trạng thái MARKED nhưng thiếu điểm số hợp lệ (score=${quizSub.score}).`
                );
              }
            }

            const quizScoreVal =
              quizSub &&
              (quizSub.status === "MARKED" || (quizSub.status === "SUBMITTED" && (quizSub.submittedCount ?? 0) > 0)) &&
              typeof quizSub.score === "number" &&
              !Number.isNaN(quizSub.score)
                ? quizSub.score
                : null;

            if (typeof quizScoreVal === "number") {
              quizSum += quizScoreVal;
              quizCount++;
            }

            let status: ScoreCellStatus = "NOT_SUBMITTED";
            let score: number | null = null;
            let gradedCountText: string | undefined;
            let rawText = "Chưa nộp";

            if (practiceSub) {
              const pStatus = String(practiceSub.status || "").toUpperCase();
              const hasAttachments =
                Array.isArray(practiceSub.content?.attachments) &&
                practiceSub.content.attachments.length > 0;
              const isSubmitted =
                (practiceSub.submittedCount ?? 0) > 0 ||
                Boolean(practiceSub.submittedAt) ||
                hasAttachments;

              if (pStatus === "MARKED") {
                if (typeof practiceSub.score !== "number" || Number.isNaN(practiceSub.score)) {
                  throw new Error(
                    `Dữ liệu điểm không hợp lệ trên LMS: Bài nộp của '${displayName}' (${col.title}) có trạng thái MARKED nhưng thiếu điểm số hợp lệ (score=${practiceSub.score}).`
                  );
                }
                status = "GRADED";
                score = practiceSub.score;
                gradedCountText = "1/1";
                rawText = `Đã chấm (${score}/100)`;
              } else if (pStatus === "REDO") {
                status = "REDO_REQUESTED";
                score = typeof practiceSub.score === "number" ? practiceSub.score : null;
                gradedCountText = "0/1";
                rawText = "Yêu cầu làm lại";
              } else if (pStatus === "SUBMITTED" || (pStatus === "IN_PROGRESS" && isSubmitted)) {
                status = "SUBMITTED_UNGRADED";
                score = null;
                gradedCountText = "0/1";
                rawText = "Chưa chấm (0/1)";
              } else {
                status = "NOT_SUBMITTED";
                score = null;
                rawText = "Chưa nộp";
              }
            }
            // Note: Quiz score is strictly kept in quizScore (never copied into practice `score` or practice `averageScore`)

            const cell: StudentScoreCell = {
              columnId: col.columnId,
              lessonId: col.lessonId,
              sessionNumber: col.sessionNumber,
              status,
              score,
              quizScore: quizScoreVal,
              maxScore: 100,
              submissionId: practiceSub?.id ? String(practiceSub.id) : null,
              attachments: Array.isArray(practiceSub?.content?.attachments)
                ? practiceSub.content.attachments
                : [],
              teacherNote: practiceSub?.note || "",
              submittedAt: practiceSub?.submittedAt || "",
              gradedCountText,
              rawText,
            };

            cells[col.columnId] = cell;

            if (status === "GRADED" && typeof score === "number") {
              gradedSum += score;
              gradedCount++;
            } else if (status === "SUBMITTED_UNGRADED") {
              submittedUngradedCount++;
            } else if (status === "REDO_REQUESTED") {
              redoCount++;
            } else {
              notSubmittedCount++;
            }
          }

          const averageScore =
            gradedCount > 0 ? Math.round((gradedSum / gradedCount) * 10) / 10 : null;
          const averageQuizScore =
            quizCount > 0 ? Math.round((quizSum / quizCount) * 10) / 10 : null;

          return {
            studentId,
            studentUid,
            fullName: matchedStudent?.fullName || displayName,
            isActive,
            cells,
            averageScore,
            averageQuizScore,
            gradedCount,
            submittedUngradedCount,
            notSubmittedCount,
            redoCount,
          };
        });
      } else {
        // Fallback: Scrape from DOM grid inside #tabpanel-3 if GraphQL payload was not captured
        const panel3 = drawer.locator("#tabpanel-3").first();
        const context: Locator = (await panel3.isVisible().catch(() => false)) ? panel3 : drawer;
        const domResult = await this.scrapeFromDomGrid(
          context,
          classId,
          studentByNameMap,
          existingNameCounts,
          normalizeName,
          existingStudents.length
        );
        columns = domResult.columns;
        rows = domResult.rows;
      }

      // Strict Completeness Check: Never report success or overwrite cache with an empty or partial roster matrix
      if (columns.length === 0 || rows.length === 0) {
        throw new Error(
          `Không thu thập được dữ liệu bảng điểm hợp lệ cho lớp ${classCode} (${rows.length} học viên, ${columns.length} cột bài tập). Đã giữ nguyên cache cũ.`
        );
      }

      if (existingStudents.length > 0) {
        const mappedIds = new Set(rows.map((r) => r.studentId));
        const missingStudents = existingStudents.filter((s) => !mappedIds.has(s.studentId));
        if (rows.length < existingStudents.length || missingStudents.length > 0) {
          throw new Error(
            `Bảng điểm thu thập cho lớp ${classCode} thiếu học viên so với danh sách lớp đã đồng bộ (${rows.length}/${existingStudents.length} học viên). Đã giữ nguyên cache cũ.`
          );
        }
      }

      // Compute summary metrics
      let gradedCells = 0;
      let submittedUngradedCells = 0;
      let notSubmittedCells = 0;
      let redoCells = 0;
      let zeroScoreCells = 0;

      for (const r of rows) {
        for (const cell of Object.values(r.cells)) {
          if (cell.status === "GRADED") {
            gradedCells++;
            if (cell.score === 0) zeroScoreCells++;
          } else if (cell.status === "SUBMITTED_UNGRADED") {
            submittedUngradedCells++;
          } else if (cell.status === "REDO_REQUESTED") {
            redoCells++;
          } else {
            notSubmittedCells++;
          }
        }
      }

      const result: ClassScoreMatrixResult = {
        success: true,
        classId,
        classCode,
        lmsClassId,
        columns,
        rows,
        summary: {
          totalStudents: rows.length,
          totalColumns: columns.length,
          gradedCells,
          submittedUngradedCells,
          notSubmittedCells,
          redoCells,
          zeroScoreCells,
        },
        scrapedAt: new Date().toISOString(),
      };

      // Cache in SQLite via scoreMatrixRepo (with fallback if mocked in unit test)
      if (scoreMatrixRepo && typeof scoreMatrixRepo.save === "function") {
        scoreMatrixRepo.save(classId, result);
      } else {
        const db = getDb();
        db.prepare(`
          INSERT INTO score_matrix_cache (classId, matrixJson, updatedAt)
          VALUES (?, ?, datetime('now', 'localtime'))
          ON CONFLICT(classId) DO UPDATE SET
            matrixJson = excluded.matrixJson,
            updatedAt = datetime('now', 'localtime')
        `).run(classId, JSON.stringify(result));
      }

      jobLogRepo.add({
        jobId,
        jobType: "SCRAPE_SCORES",
        classId,
        level: "SUCCESS",
        message: `Đã cào thành công bảng điểm lớp ${classCode}: ${rows.length} học viên x ${columns.length} cột bài tập (${gradedCells} đã chấm, ${submittedUngradedCells} chờ chấm, ${redoCells} làm lại, ${notSubmittedCells} chưa nộp).`,
      });

      return result;
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      jobLogRepo.add({
        jobId,
        jobType: "SCRAPE_SCORES",
        classId,
        level: "ERROR",
        message: `Lỗi khi cào bảng điểm lớp ${classCode}: ${errMsg}`,
      });
      return {
        success: false,
        classId,
        classCode,
        columns: [],
        rows: [],
        summary: {
          totalStudents: 0,
          totalColumns: 0,
          gradedCells: 0,
          submittedUngradedCells: 0,
          notSubmittedCells: 0,
          redoCells: 0,
          zeroScoreCells: 0,
        },
        scrapedAt: new Date().toISOString(),
        error: errMsg,
      };
    }
  }

  /**
   * Fallback DOM scraper for the CSS Grid layout inside #tabpanel-3 on MindX LMS.
   * Supports multi-page traversal when pagination controls are present.
   */
  private static async scrapeFromDomGrid(
    context: Locator,
    classId: string,
    studentByNameMap: Map<string, StudentRecord>,
    existingNameCounts: Map<string, number>,
    normalizeName: (s: string) => string,
    expectedMinActiveStudents = 0
  ): Promise<{ columns: ScoreColumnInfo[]; rows: StudentScoreRow[] }> {
    const columns: ScoreColumnInfo[] = [];
    const rows: StudentScoreRow[] = [];
    const usedStudentIds = new Set<string>();

    // Ensure maximum rows per page is selected if pagination dropdown exists
    const pageSizeSelect = context
      .locator('.MuiTablePagination-select, select[aria-label*="rows per page" i]')
      .first();
    if ((await pageSizeSelect.count().catch(() => 0)) > 0) {
      await pageSizeSelect.click({ force: true }).catch(() => {});
      const opt100 = context.page?.().locator('li[role="option"]:has-text("100"), .ant-select-item-option:has-text("100")').first();
      if (opt100 && (await opt100.count().catch(() => 0)) > 0) {
        await opt100.click({ force: true }).catch(() => {});
      }
    }

    // Read expected total rows from pagination label if present (e.g., "1-7 trong 7" or "1–20 of 25")
    let expectedPaginationTotal = 0;
    const paginationLabel = context
      .locator('.MuiTablePagination-displayedRows, .ant-pagination-total-text')
      .first();
    if ((await paginationLabel.count().catch(() => 0)) > 0) {
      const labelText = (await paginationLabel.innerText().catch(() => "")).trim();
      const totalMatch = labelText.match(/(?:trong|of|\/)\s*(\d+)/i);
      if (totalMatch) {
        expectedPaginationTotal = parseInt(totalMatch[1], 10);
      }
    }

    // Scroll horizontally across the grid container first so all column headers/cells mount in DOM
    await context
      .evaluate?.((el: HTMLElement) => {
        const scrollables = Array.from(el.querySelectorAll<HTMLElement>("*")).filter(
          (node) => node.scrollWidth > node.clientWidth + 20
        );
        for (const sc of scrollables) {
          sc.scrollLeft = sc.scrollWidth;
          sc.scrollLeft = 0;
        }
      })
      .catch(() => {});

    const headerItems = context.locator('div:has(> div:has-text("Homework")) > div');
    const headerCount = await headerItems.count().catch(() => 0);

    for (let c = 1; c < headerCount; c++) {
      const rawTitle = (await headerItems.nth(c).innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      const numMatch = rawTitle.match(/(\d+)/);
      const sessionNumber = numMatch ? parseInt(numMatch[1], 10) : c;
      columns.push({
        colIndex: c,
        columnId: `HW_${String(sessionNumber).padStart(2, "0")}_C${c}`,
        title: rawTitle || `Buổi ${sessionNumber}`,
        sessionNumber,
      });
    }

    let hasNextPage = true;
    let pageNum = 1;
    let globalRowIdx = 0;
    const maxPages = 50;

    while (hasNextPage && pageNum <= maxPages) {
      const rowItems = context.locator('div:has(> div > svg[data-testid="ExpandMoreIcon"])');
      const rowCount = await rowItems.count().catch(() => 0);
      if (pageNum > 1 && rowCount === 0) {
        throw new Error(
          `Phân trang bảng điểm DOM của lớp ${classId} bị trống tại trang ${pageNum} khi chuyển trang, chưa thu thập đủ toàn bộ học viên.`
        );
      }
      let firstRowNameOnPage = "";

      for (let r = 0; r < rowCount; r++) {
        const rowContainer = rowItems.nth(r).locator("..").locator("..");
        const childDivs = rowContainer.locator("> div");
        const divCount = await childDivs.count().catch(() => 0);
        if (divCount === 0) continue;

        if (divCount - 1 < columns.length) {
          throw new Error(
            `Dòng học viên thứ ${globalRowIdx + 1} trên DOM thiếu cột bài tập (${divCount - 1}/${columns.length} cột).`
          );
        }

        globalRowIdx++;
        const fullName =
          (await childDivs.nth(0).innerText().catch(() => "")).trim() ||
          `Học viên ${globalRowIdx}`;
        if (!firstRowNameOnPage) {
          firstRowNameOnPage = fullName;
        }
        const normName = normalizeName(fullName);

        let matchedStudent: StudentRecord | undefined;
        if (existingNameCounts.get(normName) === 1) {
          const candidate = studentByNameMap.get(normName);
          if (candidate && !usedStudentIds.has(candidate.studentId)) {
            matchedStudent = candidate;
          }
        }

        if (existingNameCounts.size > 0 && !matchedStudent) {
          throw new Error(
            `Dữ liệu bảng điểm DOM không khớp hoặc mơ hồ với danh sách lớp '${classId}': Không thể xác thực định danh duy nhất cho học viên '${fullName}'.`
          );
        }

        const normSlug = normName.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
        const fallbackId = normSlug
          ? `STU_${classId}_${normSlug.toUpperCase()}`
          : `STU_${classId}_${globalRowIdx}`;
        const studentId = matchedStudent?.studentId || fallbackId;

        if (usedStudentIds.has(studentId)) {
          throw new Error(
            `Phát hiện dòng học viên trùng lặp hoặc phân trang DOM bị kẹt tại trang ${pageNum} cho học viên '${fullName}' (${studentId}).`
          );
        }
        usedStudentIds.add(studentId);
        const isActive = matchedStudent ? Boolean(matchedStudent.isActive) : true;

        const cells: Record<string, StudentScoreCell> = {};
        let gradedSum = 0;
        let gradedCount = 0;
        let quizSum = 0;
        let quizCount = 0;
        let submittedUngradedCount = 0;
        let notSubmittedCount = 0;
        let redoCount = 0;

        for (const col of columns) {
          if (col.colIndex >= divCount) continue;
          const rawText = (await childDivs.nth(col.colIndex).innerText().catch(() => ""))
            .replace(/\s+/g, " ")
            .trim();
          const parsed = this.parseScoreCell(rawText, col.columnId, col.sessionNumber);
          cells[col.columnId] = parsed;

          if (typeof parsed.quizScore === "number" && !Number.isNaN(parsed.quizScore)) {
            quizSum += parsed.quizScore;
            quizCount++;
          }

          if (parsed.status === "GRADED" && typeof parsed.score === "number") {
            gradedSum += parsed.score;
            gradedCount++;
          } else if (parsed.status === "SUBMITTED_UNGRADED") {
            submittedUngradedCount++;
          } else if (parsed.status === "REDO_REQUESTED") {
            redoCount++;
          } else {
            notSubmittedCount++;
          }
        }

        const averageScore =
          gradedCount > 0 ? Math.round((gradedSum / gradedCount) * 10) / 10 : null;
        const averageQuizScore =
          quizCount > 0 ? Math.round((quizSum / quizCount) * 10) / 10 : null;
        rows.push({
          studentId,
          fullName: matchedStudent?.fullName || fullName,
          isActive,
          cells,
          averageScore,
          averageQuizScore,
          gradedCount,
          submittedUngradedCount,
          notSubmittedCount,
          redoCount,
        });
      }

      const nextBtn = context
        .locator(
          'button[aria-label*="next page" i], .MuiTablePagination-actions button:last-child, .ant-pagination-next:not(.ant-pagination-disabled)'
        )
        .first();
      const hasNext = (await nextBtn.count().catch(() => 0)) > 0;
      const isVisible = hasNext && (await nextBtn.isVisible().catch(() => false));
      const isEnabled = hasNext && (await nextBtn.isEnabled().catch(() => false));
      const isAriaDisabled =
        hasNext &&
        ((await nextBtn.getAttribute("aria-disabled").catch(() => null)) === "true");

      if (isVisible && isEnabled && !isAriaDisabled) {
        await nextBtn.click({ force: true }).catch(() => {});
        if (firstRowNameOnPage) {
          for (let waitStep = 0; waitStep < 100; waitStep++) {
            const nextRowItems = context.locator(
              'div:has(> div > svg[data-testid="ExpandMoreIcon"])'
            );
            const nextCount = await nextRowItems.count().catch(() => 0);
            if (nextCount > 0) {
              const nextFirstDivs = nextRowItems
                .nth(0)
                .locator("..")
                .locator("..")
                .locator("> div");
              const nextFirstName = (
                (await nextFirstDivs.nth(0).innerText().catch(() => "")) || ""
              ).trim();
              if (nextFirstName && nextFirstName !== firstRowNameOnPage) {
                break;
              }
            }
            await new Promise((resolve) => setTimeout(resolve, 15));
          }
        }
        pageNum++;
      } else {
        hasNextPage = false;
      }
    }

    if (hasNextPage) {
      throw new Error(
        `Phân trang bảng điểm DOM của lớp ${classId} vượt quá giới hạn an toàn (${maxPages} trang), chưa thu thập đủ toàn bộ học viên.`
      );
    }

    if (expectedPaginationTotal > 0 && rows.length !== expectedPaginationTotal) {
      throw new Error(
        `Cào bảng điểm DOM chưa đủ tổng số học viên trên phân trang (${rows.length}/${expectedPaginationTotal}).`
      );
    }

    const minExpectedRosterRows = Math.max(expectedMinActiveStudents, studentByNameMap.size);
    if (minExpectedRosterRows > 0 && rows.length < minExpectedRosterRows) {
      throw new Error(
        `Cào bảng điểm DOM trả về ít học viên (${rows.length}) hơn danh sách học viên của lớp (${minExpectedRosterRows}).`
      );
    }

    return { columns, rows };
  }

  /**
   * Parses raw cell text from MindX LMS Submission table into one of 4 strict states:
   * GRADED (including 0/100), SUBMITTED_UNGRADED, NOT_SUBMITTED, REDO_REQUESTED.
   * Strictly separates submission ratio (e.g. (0/1), (1/1)) from score (e.g. 0/100, (0/100)),
   * and throws if a cell is marked GRADED without a valid numeric score.
   */
  public static parseScoreCell(
    rawText: string,
    columnId: string,
    sessionNumber: number
  ): StudentScoreCell {
    const rawClean = rawText.replace(/\s+/g, " ").trim();

    // Extract optional Quiz score (e.g. "Quiz: 90/100" or "(Quiz: 85)") so it never pollutes practice score
    let quizScore: number | null | undefined = undefined;
    const quizRegex = /\(?\bquiz\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(?:100|10))?\s*\)?/i;
    const quizMatch = rawClean.match(quizRegex);
    if (quizMatch) {
      quizScore = parseFloat(quizMatch[1]);
    } else if (/\bquiz\b/i.test(rawClean)) {
      const lowerRaw = rawClean.toLowerCase();
      if (
        lowerRaw.includes("đã chấm") ||
        lowerRaw.includes("marked") ||
        lowerRaw.includes("graded")
      ) {
        throw new Error(
          `Dữ liệu điểm Quiz không hợp lệ: Ô điểm '${rawClean}' có trạng thái Quiz Đã chấm nhưng thiếu điểm số cụ thể.`
        );
      }
    }

    const clean = quizMatch
      ? rawClean.replace(quizRegex, " ").replace(/\s+/g, " ").trim()
      : rawClean;
    const lower = clean.toLowerCase();

    // 1. NOT_SUBMITTED (or Quiz-only cell with no practice submission)
    if (
      !clean ||
      clean === "-" ||
      clean === "--" ||
      clean === "—" ||
      lower.includes("chưa nộp") ||
      lower.includes("not submitted") ||
      lower.includes("no submission") ||
      lower.includes("unsubmitted")
    ) {
      return {
        columnId,
        sessionNumber,
        status: "NOT_SUBMITTED",
        score: null,
        ...(quizScore !== undefined ? { quizScore } : {}),
        maxScore: 100,
        rawText: rawClean || "Chưa nộp",
      };
    }

    // 2. REDO_REQUESTED
    if (
      lower.includes("làm lại") ||
      lower.includes("redo") ||
      lower.includes("not resubmitted") ||
      lower.includes("resubmit")
    ) {
      return {
        columnId,
        sessionNumber,
        status: "REDO_REQUESTED",
        score: null,
        ...(quizScore !== undefined ? { quizScore } : {}),
        maxScore: 100,
        rawText: rawClean,
      };
    }

    // Extract submission count ratio only when denominator is 1..9 (e.g. (0/1), (1/1)), NEVER (0/100)
    const submissionRatioMatch = clean.match(/\((\d+)\s*\/\s*([1-9])\)/);
    const gradedRatioText = submissionRatioMatch
      ? `${submissionRatioMatch[1]}/${submissionRatioMatch[2]}`
      : undefined;
    const textWithoutSubmissionRatio = clean.replace(/\(\d+\s*\/\s*[1-9]\)/g, " ");

    // 3. SUBMITTED_UNGRADED (explicit "chưa chấm" / "ungraded" or submission ratio (0/1) takes priority over any trailing 0/100 text)
    if (
      lower.includes("chưa chấm") ||
      lower.includes("ungraded") ||
      lower.includes("not marked") ||
      lower.includes("unmarked") ||
      (submissionRatioMatch &&
        parseInt(submissionRatioMatch[1], 10) === 0 &&
        parseInt(submissionRatioMatch[2], 10) > 0 &&
        !lower.includes("đã chấm") &&
        !lower.includes("marked") &&
        !lower.includes("graded"))
    ) {
      return {
        columnId,
        sessionNumber,
        status: "SUBMITTED_UNGRADED",
        score: null,
        ...(quizScore !== undefined ? { quizScore } : {}),
        maxScore: 100,
        gradedCountText: gradedRatioText,
        rawText: rawClean,
      };
    }

    // 4. GRADED with explicit score fraction X/100 or (X/100)
    const scoreFractionMatch = textWithoutSubmissionRatio.match(
      /\(?\b(\d+(?:\.\d+)?)\s*\/\s*(100|10)\b\)?/
    );
    if (scoreFractionMatch) {
      return {
        columnId,
        sessionNumber,
        status: "GRADED",
        score: parseFloat(scoreFractionMatch[1]),
        ...(quizScore !== undefined ? { quizScore } : {}),
        maxScore: parseFloat(scoreFractionMatch[2]),
        gradedCountText: gradedRatioText,
        rawText: rawClean,
      };
    }

    // 5. Explicitly says "Đã chấm" / "Marked" / "Graded" or ratio (1/1)
    if (
      lower.includes("đã chấm") ||
      lower.includes("marked") ||
      lower.includes("graded") ||
      (submissionRatioMatch && parseInt(submissionRatioMatch[1], 10) > 0)
    ) {
      const standaloneScore = textWithoutSubmissionRatio.match(/\b(\d{1,3}(?:\.\d+)?)\b/);
      if (!standaloneScore) {
        throw new Error(
          `Dữ liệu điểm không hợp lệ: Ô điểm '${rawClean}' có trạng thái Đã chấm nhưng thiếu điểm số cụ thể.`
        );
      }
      return {
        columnId,
        sessionNumber,
        status: "GRADED",
        score: parseFloat(standaloneScore[1]),
        ...(quizScore !== undefined ? { quizScore } : {}),
        maxScore: 100,
        gradedCountText: gradedRatioText,
        rawText: rawClean,
      };
    }

    return {
      columnId,
      sessionNumber,
      status: "SUBMITTED_UNGRADED",
      score: null,
      ...(quizScore !== undefined ? { quizScore } : {}),
      maxScore: 100,
      rawText: rawClean,
    };
  }
}
