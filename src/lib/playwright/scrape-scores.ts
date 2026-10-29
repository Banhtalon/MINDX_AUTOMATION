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
  session14EvalRepo,
  reportCardRepo,
  isRoboticsClassCode,
  getDb,
  type StudentRecord,
  type SpckSession14EvaluationRecord,
} from "../db/sqlite";
import {
  round2,
  normalizeScoreToScale5,
  computeCheckpointStage,
  computeFinalStage,
  type ClassReportCardLmsSnapshot,
  type ReportCardBtvnSessionMeta,
  type StudentBtvnSessionRaw,
  type StudentReportCardSnapshotItem,
  type StudentStageRawScores,
} from "../report-card/report-card-calculator";

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
  practiceTask1Score?: number | null;
  practiceTask2Score?: number | null;
  quizScore?: number | null; // Optional Quiz score on Denise/LMS
  maxScore: number;
  submissionId?: string | null;
  attachments?: string[];
  teacherNote?: string;
  submittedAt?: string;
  gradedCountText?: string; // e.g., "1/1", "1/2", "2/2" or "0/1"
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
  reportCardSnapshot?: ClassReportCardLmsSnapshot;
  scrapedAt: string;
  error?: string;
}

export interface ExtractReportCardSnapshotParams {
  classId: string;
  classCode: string;
  lmsClassId?: string;
  isRobotics?: boolean;
  submissionGqlData?: any;
  classByIdGqlData?: any;
  existingStudents?: StudentRecord[];
  session14Evals?: SpckSession14EvaluationRecord[];
  fallbackMatrix?: {
    columns: ScoreColumnInfo[];
    rows: StudentScoreRow[];
  };
  includeCheckpointSessionBtvn?: boolean;
  scrapedAt?: string;
}

function safeRound2Val(val: number): number {
  if (typeof round2 === "function") {
    return round2(val);
  }
  if (typeof val !== "number" || !Number.isFinite(val) || val === 0) return 0;
  const sign = val < 0 ? -1 : 1;
  const absClean = Number(Math.abs(val).toFixed(10));
  const rounded = Number(`${Math.round(Number(`${absClean}e2`))}e-2`);
  return sign * (rounded === 0 ? 0 : rounded);
}

function safeNormToScale5(rawScore: number | null | undefined, maxScore = 100): number | null {
  if (typeof normalizeScoreToScale5 === "function") {
    return normalizeScoreToScale5(rawScore, maxScore);
  }
  if (
    rawScore === null ||
    rawScore === undefined ||
    typeof rawScore !== "number" ||
    !Number.isFinite(rawScore)
  ) {
    return null;
  }
  const safeMax =
    typeof maxScore === "number" && Number.isFinite(maxScore) && maxScore > 0 ? maxScore : 100;
  const clamped = Math.max(0, Math.min(safeMax, rawScore));
  return safeRound2Val((clamped / safeMax) * 5);
}

function safeCheckIsRobotics(classCode: string): boolean {
  if (typeof isRoboticsClassCode === "function") {
    return isRoboticsClassCode(classCode);
  }
  const upper = String(classCode || "").trim().toUpperCase();
  return /\bROB(?:OTICS)?\b|(?:-|_)ROB|[A-Z]*ROB\d/i.test(upper);
}

function normalizeStudentNameKey(s: string): string {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtmlTagsClean(raw?: string | null): string {
  if (!raw) return "";
  return String(raw)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPracticeSubmissionItem(sub: any): boolean {
  if (!sub || typeof sub !== "object") return false;
  const cat = String(sub.category || "").toUpperCase();
  const tp = String(sub.type || "").toUpperCase();
  const subTp = String(sub.submissionType || "").toUpperCase();
  if (cat === "QUIZ" || tp === "QUIZ" || subTp === "QUIZ") return false;
  return (
    cat === "PRACTICE_TASK1" ||
    cat === "PRACTICE_TASK2" ||
    cat.startsWith("PRACTICE") ||
    tp === "UPLOAD_FILE" ||
    tp === "SCRATCH" ||
    subTp === "PRACTICE"
  );
}

function sortPracticeSubmissions(subs: any[]): any[] {
  return [...subs].sort((a, b) => {
    const catA = String(a?.category || "").toUpperCase();
    const catB = String(b?.category || "").toUpperCase();
    const rankA = catA === "PRACTICE_TASK1" ? 1 : catA === "PRACTICE_TASK2" ? 2 : 3;
    const rankB = catB === "PRACTICE_TASK1" ? 1 : catB === "PRACTICE_TASK2" ? 2 : 3;
    if (rankA !== rankB) return rankA - rankB;
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });
}

function normalizeStageScoreToScale5(val: unknown): number | null {
  if (val === null || val === undefined || typeof val === "boolean" || String(val).trim() === "") {
    return null;
  }
  const num = Number(val);
  if (!Number.isFinite(num) || num < 0) return null;
  if (num > 5) {
    return safeNormToScale5(num, 100);
  }
  return safeRound2Val(Math.max(0, Math.min(5, num)));
}

function resolveCheckpointLessonStage(lesson: {
  id: string;
  title: string;
  displayOrder?: number;
}): 1 | 2 | null {
  const titleStr = String(lesson.title || "").trim();
  const idStr = String(lesson.id || "").trim();
  const combined = `${titleStr} ${idStr}`.trim();

  if (
    /(?:checkpoint|check\s*[-_]?\s*point|cp|lần|định\s*kỳ(?:\s*lần)?)\s*[-_#]?\s*0?2\b/i.test(
      combined
    ) ||
    /(?:buổi|bài|session|slot|lesson)\s*0?(?:8|9)\b/i.test(titleStr)
  ) {
    return 2;
  }
  if (
    /(?:checkpoint|check\s*[-_]?\s*point|cp|lần|định\s*kỳ(?:\s*lần)?)\s*[-_#]?\s*0?1\b/i.test(
      combined
    ) ||
    /(?:buổi|bài|session|slot|lesson)\s*0?(?:4|5)\b/i.test(titleStr)
  ) {
    return 1;
  }
  return null;
}

export class ScoreScraper {
  /**
   * Scrapes the entire Homework / Submission score matrix AND the Teaching Report Card snapshot
   * (BTVN, Check-point 1, Check-point 2, Final DEMO) for a class on MindX LMS.
   * - Coding classes: Captures `GetClassById` + `FindStudentSubmissionByClass` (#tab-3), supporting dual practice tasks (`PRACTICE_TASK1` + `PRACTICE_TASK2`).
   * - Robotics classes (`VT-ROB-...`): Automatically skips `#tab-3 Chấm bài` (no BTVN) and extracts CP1 (Buổi 4), CP2 (Buổi 8), and Final DEMO (Buổi 14) from `GetClassById.slots` + `spck_session14_evaluations`.
   */
  public static async scrapeClassScores(rawClassCode: string): Promise<ClassScoreMatrixResult> {
    const classCode = rawClassCode.trim().toUpperCase();
    const classId = classCode;
    const isRobotics = safeCheckIsRobotics(classCode);
    const jobId = `scrape_scores_${classCode}_${Date.now()}`;

    jobLogRepo.add({
      jobId,
      jobType: "SCRAPE_SCORES",
      classId,
      level: "INFO",
      message: isRobotics
        ? `Bắt đầu thu thập điểm tổng kết (CP1 Buổi 4, CP2 Buổi 8, Final Buổi 14) cho lớp Robotics ${classCode} từ LMS...`
        : `Bắt đầu cào bảng điểm toàn khóa (BTVN, CP1, CP2, Final) cho lớp ${classCode} từ LMS...`,
    });

    const browserManager = BrowserManager.getInstance();
    const page = await browserManager.getPage();
    const interceptor = createNetworkInterceptor(page);

    try {
      // 1. Ensure authenticated on MindX LMS
      await authService.ensureAuthenticated("LMS");

      let submissionGqlData: any = null;
      let classByIdGqlData: any = null;
      let lmsClassId: string | undefined;
      let gqlInterceptError: string | null = null;
      let classByIdInterceptError: string | null = null;
      let classByIdResponseSeen = false;
      let isDrawerDomVerified = false;
      let capturePhase: "IDLE" | "DRAWER_OPENING" | "GRADING_TAB" = "IDLE";
      const freshClassByIdRequests = new Set<any>();
      const freshSubmissionRequests = new Set<any>();
      const pendingClassByIdTasks = new Set<Promise<void>>();
      const pendingSubmissionTasks = new Set<Promise<void>>();

      const onRequest = (req: any) => {
        if (capturePhase === "IDLE") return;
        try {
          if (typeof req?.method === "function" && req.method() !== "POST") return;
          const reqBody = req?.postDataJSON?.();
          const opName = reqBody?.operationName;
          if (opName === "GetClassById") {
            freshClassByIdRequests.add(req);
          } else if (opName === "FindStudentSubmissionByClass" && capturePhase === "GRADING_TAB") {
            freshSubmissionRequests.add(req);
          }
        } catch {}
      };

      const onResponse = async (res: any) => {
        if (capturePhase === "IDLE") return;
        if (res.url().includes("mindx.edu.vn") && res.request().method() === "POST") {
          const reqObj = res.request();
          let reqBody: any;
          try {
            reqBody = reqObj.postDataJSON();
          } catch {
            return;
          }
          const opName = reqBody?.operationName;

          if (opName === "GetClassById") {
            if (!freshClassByIdRequests.has(reqObj)) {
              return;
            }
            classByIdResponseSeen = true;
            const task = (async () => {
              try {
                const status = typeof res.status === "function" ? res.status() : 200;
                if (status !== 200 && status !== 201) {
                  classByIdInterceptError = `API GetClassById trả về mã lỗi HTTP ${status}`;
                  return;
                }
                const reqVarId = String(
                  reqBody?.variables?.id || reqBody?.variables?.classId || ""
                ).trim();
                const resJson = await res.json();
                if (resJson && Array.isArray(resJson.errors) && resJson.errors.length > 0) {
                  classByIdInterceptError = `GraphQL GetClassById trả về lỗi: ${
                    resJson.errors[0]?.message || "Unknown error"
                  }`;
                  return;
                }
                const clsPayload =
                  resJson?.data?.classesById ||
                  resJson?.data?.class ||
                  resJson?.data?.getClassById;
                if (!clsPayload || typeof clsPayload !== "object") {
                  classByIdInterceptError =
                    "Phản hồi GetClassById không chứa dữ liệu lớp học hợp lệ.";
                  return;
                }
                const payloadClassId = String(clsPayload.id || "").trim();
                if (reqVarId && payloadClassId && reqVarId !== payloadClassId) {
                  classByIdInterceptError = `Dữ liệu GetClassById có ID phản hồi ('${payloadClassId}') không khớp với ID yêu cầu ('${reqVarId}').`;
                  return;
                }
                const clsPayloadCode = String(
                  clsPayload.name || clsPayload.code || clsPayload.classCode || ""
                )
                  .trim()
                  .toUpperCase();
                const isCodeVerified =
                  clsPayloadCode === classCode ||
                  (!clsPayloadCode &&
                    Boolean(payloadClassId) &&
                    payloadClassId.toUpperCase() === classCode);

                if (!isCodeVerified) {
                  classByIdInterceptError = `Dữ liệu GetClassById trả về thuộc lớp khác hoặc thiếu mã lớp xác thực ('${
                    clsPayloadCode || payloadClassId || "unknown"
                  }' !== '${classCode}')`;
                  return;
                }
                if (lmsClassId && payloadClassId && payloadClassId !== lmsClassId) {
                  classByIdInterceptError = `Xung đột định danh lớp LMS giữa các phản hồi ('${payloadClassId}' !== '${lmsClassId}')`;
                  return;
                }
                classByIdGqlData = clsPayload;
                lmsClassId = payloadClassId || reqVarId || lmsClassId;
                classByIdInterceptError = null;
              } catch (err: any) {
                classByIdInterceptError =
                  err instanceof Error
                    ? err.message
                    : "Lỗi phân tích phản hồi GetClassById từ LMS.";
              }
            })();
            pendingClassByIdTasks.add(task);
            try {
              await task;
            } finally {
              pendingClassByIdTasks.delete(task);
            }
            return;
          }

          if (opName === "FindStudentSubmissionByClass") {
            if (capturePhase !== "GRADING_TAB") return;
            if (!freshSubmissionRequests.has(reqObj)) {
              return;
            }
            const task = (async () => {
              try {
                const status = typeof res.status === "function" ? res.status() : 200;
                if (status !== 200 && status !== 201) {
                  gqlInterceptError = `API FindStudentSubmissionByClass trả về mã lỗi HTTP ${status}`;
                  return;
                }

                const reqClassId = String(reqBody?.variables?.payload?.classId || "").trim();
                const resJson = await res.json();
                if (resJson && Array.isArray(resJson.errors) && resJson.errors.length > 0) {
                  gqlInterceptError = `GraphQL FindStudentSubmissionByClass trả về lỗi: ${
                    resJson.errors[0]?.message || "Unknown error"
                  }`;
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
                const payloadClassId = String(
                  gqlPayload?.classId || gqlPayload?.class?.id || ""
                ).trim();

                // S2-02: If an authoritative lmsClassId was already established by GetClassById,
                // strictly enforce that reqClassId (and payloadClassId if present) matches it!
                const conflictsWithEstablishedLmsId =
                  Boolean(lmsClassId) &&
                  ((Boolean(reqClassId) &&
                    reqClassId !== lmsClassId &&
                    reqClassId.toUpperCase() !== classCode) ||
                    (Boolean(payloadClassId) &&
                      payloadClassId !== lmsClassId &&
                      payloadClassId.toUpperCase() !== classCode));

                const isClassVerified =
                  !conflictsWithEstablishedLmsId &&
                  (lmsClassId
                    ? reqClassId === lmsClassId || reqClassId.toUpperCase() === classCode
                    : reqClassId.toUpperCase() === classCode ||
                      (Boolean(payloadClassCode) && payloadClassCode === classCode));

                if (
                  !reqClassId ||
                  !isClassVerified ||
                  (payloadClassCode && payloadClassCode !== classCode)
                ) {
                  gqlInterceptError = `Dữ liệu FindStudentSubmissionByClass trả về thuộc lớp khác hoặc chưa xác thực định danh lớp ('${reqClassId}' !== '${
                    lmsClassId || classCode
                  }')`;
                  return;
                }

                if (gqlPayload) {
                  lmsClassId = lmsClassId || payloadClassId || reqClassId;
                  submissionGqlData = gqlPayload;
                  gqlInterceptError = null;
                }
              } catch (err: any) {
                gqlInterceptError =
                  err instanceof Error
                    ? err.message
                    : "Lỗi phân tích phản hồi FindStudentSubmissionByClass từ LMS.";
              }
            })();
            pendingSubmissionTasks.add(task);
            try {
              await task;
            } finally {
              pendingSubmissionTasks.delete(task);
            }
          }
        }
      };

      // Attach request & response listeners BEFORE opening class drawer so fresh requests are bound
      page.on("request", onRequest);
      page.on("response", onResponse);

      try {
        // On a real Playwright page, if a class drawer is already open before we start, close it first so openClassDrawer fires GetClassById fresh
        const isRealBrowserPage =
          typeof (page as any).url === "function" &&
          typeof (page as any).keyboard?.press === "function";
        if (isRealBrowserPage) {
          const preExistingDrawer = page
            .locator('div[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight')
            .first();
          if (await preExistingDrawer.isVisible().catch(() => false)) {
            const backBtn = preExistingDrawer.locator('button:has-text("Back")').first();
            if (await backBtn.isVisible().catch(() => false)) {
              await backBtn.click({ force: true }).catch(() => {});
            } else {
              await (page as any).keyboard.press("Escape").catch(() => {});
            }
            await page.waitForTimeout(400);
          }
        }

        // 2. Open target class Drawer
        capturePhase = "DRAWER_OPENING";
        await LmsHelpers.openClassDrawer(page, classCode);

        const drawer = page
          .locator('div[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight')
          .first();
        const drawerText = await drawer.innerText().catch(() => "");
        const escapedCode = classCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const drawerCodeRegex = new RegExp(`(^|[^a-zA-Z0-9_-])${escapedCode}([^a-zA-Z0-9_-]|$)`, "i");
        isDrawerDomVerified = Boolean(drawerText && drawerCodeRegex.test(drawerText));

        if (isRobotics) {
          // Robotics classes do NOT have Homework (#tab-3 Chấm bài); only wait for GetClassById
          jobLogRepo.add({
            jobId,
            jobType: "SCRAPE_SCORES",
            classId,
            level: "INFO",
            message: `Lớp Robotics ${classCode}: Bỏ qua tab Chấm bài (#tab-3), đang thu thập điểm CP1 (Buổi 4), CP2 (Buổi 8), Final (Buổi 14) từ phần Nhận xét...`,
          });
          for (
            let tick = 0;
            tick < 20 &&
            ((!classByIdGqlData && !classByIdInterceptError) ||
              pendingClassByIdTasks.size > 0);
            tick++
          ) {
            await page.waitForTimeout(300);
          }
          if (pendingClassByIdTasks.size > 0) {
            classByIdInterceptError = `Quá thời gian chờ tải dữ liệu GetClassById cho lớp Robotics ${classCode}.`;
          }
        } else {
          // 3. Intercept FindStudentSubmissionByClass GraphQL response when switching to Submission (#tab-3)
          jobLogRepo.add({
            jobId,
            jobType: "SCRAPE_SCORES",
            classId,
            level: "INFO",
            message: `Đang mở tab Chấm bài / Submission (#tab-3) của lớp ${classCode} và thu thập dữ liệu điểm...`,
          });

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

          capturePhase = "GRADING_TAB";
          if ((await tab3.count().catch(() => 0)) > 0) {
            await tab3.scrollIntoViewIfNeeded().catch(() => {});
            await tab3.click({ force: true });
          } else {
            await LmsHelpers.switchDrawerTab(page, SELECTORS.tabs.grading);
          }

          // Wait up to 6s for FindStudentSubmissionByClass AND GetClassById response to finish parsing
          const requireClassByIdForCoding =
            classByIdResponseSeen ||
            (typeof reportCardRepo !== "undefined" && Boolean(reportCardRepo));
          for (
            let tick = 0;
            tick < 20 &&
            ((!submissionGqlData && !gqlInterceptError) ||
              pendingSubmissionTasks.size > 0 ||
              (requireClassByIdForCoding &&
                !classByIdGqlData &&
                !classByIdInterceptError) ||
              pendingClassByIdTasks.size > 0);
            tick++
          ) {
            await page.waitForTimeout(300);
          }
          if (pendingClassByIdTasks.size > 0) {
            classByIdInterceptError = `Quá thời gian chờ tải dữ liệu GetClassById hoàn tất cho lớp ${classCode}.`;
          }
          if (pendingSubmissionTasks.size > 0) {
            gqlInterceptError = `Quá thời gian chờ tải dữ liệu FindStudentSubmissionByClass hoàn tất cho lớp ${classCode}.`;
          }
        }
      } finally {
        page.off("request", onRequest);
        page.off("response", onResponse);
      }

      if (classByIdInterceptError) {
        throw new Error(classByIdInterceptError);
      }
      if (isRobotics && !classByIdGqlData) {
        throw new Error(
          `Không thu thập được dữ liệu GetClassById từ LMS cho lớp Robotics ${classCode}. Đã giữ nguyên dữ liệu cũ.`
        );
      }
      if (
        !isRobotics &&
        !classByIdGqlData &&
        (classByIdResponseSeen ||
          (typeof reportCardRepo !== "undefined" && Boolean(reportCardRepo)))
      ) {
        throw new Error(
          `Không thu thập được dữ liệu GetClassById hoàn chỉnh từ LMS cho lớp ${classCode}. Đã giữ nguyên dữ liệu cũ.`
        );
      }
      if (!isRobotics && gqlInterceptError && !submissionGqlData) {
        throw new Error(gqlInterceptError);
      }

      // Also guard against overwriting an existing report card's CP1/CP2/Final scores when GetClassById was not captured
      if (
        !isRobotics &&
        !classByIdGqlData &&
        typeof reportCardRepo !== "undefined" &&
        reportCardRepo &&
        typeof reportCardRepo.findOne === "function"
      ) {
        const existingRc = reportCardRepo.findOne(classId);
        if (existingRc && existingRc.lmsSnapshotJson) {
          try {
            const parsedPrev = JSON.parse(existingRc.lmsSnapshotJson);
            const hadPriorStageScore =
              Array.isArray(parsedPrev?.students) &&
              parsedPrev.students.some((s: any) => {
                const stg = s?.stageScores;
                return (
                  stg &&
                  (stg.cp1Theory !== null ||
                    stg.cp1Practice !== null ||
                    stg.cp1Competency !== null ||
                    stg.cp2Theory !== null ||
                    stg.cp2Practice !== null ||
                    stg.cp2Competency !== null ||
                    stg.finalProduct !== null ||
                    stg.finalCompetency !== null)
                );
              });
            if (hadPriorStageScore) {
              throw new Error(
                `Không thu thập được dữ liệu GetClassById (CP1/CP2/Final) từ LMS cho lớp ${classCode}. Đã giữ nguyên phiếu điểm hiện có.`
              );
            }
          } catch (e: any) {
            if (e instanceof Error && e.message.includes("GetClassById")) {
              throw e;
            }
          }
        }
      }

      await interceptor.dismissForbiddenToast();

      // Load existing students from SQLite for safe ID resolution
      const existingStudents = studentRepo.findByClass(classId, false) || [];
      const normalizeName = normalizeStudentNameKey;

      const studentByIdMap = new Map<string, StudentRecord>();
      const studentByNameMap = new Map<string, StudentRecord>();
      const existingNameCounts = new Map<string, number>();

      for (const st of existingStudents) {
        studentByIdMap.set(st.studentId, st);
        const norm = normalizeName(st.fullName);
        existingNameCounts.set(norm, (existingNameCounts.get(norm) || 0) + 1);
        studentByNameMap.set(norm, st);
      }

      // Build CRM student map from GetClassById if available
      const crmStudentById = new Map<string, { id: string; fullName: string; activeInClass: boolean }>();
      const crmStudentByNormName = new Map<string, { id: string; fullName: string; activeInClass: boolean }>();
      const crmNameCounts = new Map<string, number>();
      if (classByIdGqlData && Array.isArray(classByIdGqlData.students)) {
        for (const cs of classByIdGqlData.students) {
          const crmId = String(cs?.student?.id || "").trim();
          const crmName = String(cs?.student?.fullName || "").trim();
          const activeInClass = cs?.activeInClass !== false;
          if (crmId && crmName) {
            const norm = normalizeName(crmName);
            const entry = { id: crmId, fullName: crmName, activeInClass };
            crmStudentById.set(crmId, entry);
            crmNameCounts.set(norm, (crmNameCounts.get(norm) || 0) + 1);
            crmStudentByNormName.set(norm, entry);
          }
        }
      }

      let columns: ScoreColumnInfo[] = [];
      let rows: StudentScoreRow[] = [];

      const session14Evals: SpckSession14EvaluationRecord[] =
        typeof session14EvalRepo !== "undefined" &&
        session14EvalRepo &&
        typeof session14EvalRepo.findByClass === "function"
          ? session14EvalRepo.findByClass(classId)
          : [];

      if (isRobotics) {
        const robSnapshot = this.extractReportCardSnapshotFromGql({
          classId,
          classCode,
          lmsClassId,
          isRobotics: true,
          classByIdGqlData,
          existingStudents,
          session14Evals,
        });

        if (robSnapshot.students.length === 0) {
          throw new Error(
            `Không thu thập được danh sách học viên hoặc điểm đánh giá từ LMS cho lớp Robotics ${classCode}.`
          );
        }

        columns = [
          {
            colIndex: 0,
            columnId: "ROB_CP1_S04",
            lessonId: "ROB_CP1_S04",
            title: "Checkpoint 1 (Buổi 4)",
            sessionNumber: 4,
            lessonType: "CHECKPOINT",
          },
          {
            colIndex: 1,
            columnId: "ROB_CP2_S08",
            lessonId: "ROB_CP2_S08",
            title: "Checkpoint 2 (Buổi 8)",
            sessionNumber: 8,
            lessonType: "CHECKPOINT",
          },
          {
            colIndex: 2,
            columnId: "ROB_FINAL_S14",
            lessonId: "ROB_FINAL_S14",
            title: "Tổng kết Cuối khóa (Buổi 14)",
            sessionNumber: 14,
            lessonType: "FINAL_DEMO",
          },
        ];

        rows = robSnapshot.students.map((stu) => {
          const cp1Calc =
            typeof computeCheckpointStage === "function"
              ? computeCheckpointStage(
                  stu.stageScores.cp1Theory,
                  stu.stageScores.cp1Practice,
                  stu.stageScores.cp1Competency
                )
              : { total: stu.stageScores.cp1Practice };
          const cp2Calc =
            typeof computeCheckpointStage === "function"
              ? computeCheckpointStage(
                  stu.stageScores.cp2Theory,
                  stu.stageScores.cp2Practice,
                  stu.stageScores.cp2Competency
                )
              : { total: stu.stageScores.cp2Practice };
          const finalCalc =
            typeof computeFinalStage === "function"
              ? computeFinalStage(stu.stageScores.finalProduct, stu.stageScores.finalCompetency)
              : { total: stu.stageScores.finalProduct };

          const makeStageCell = (
            colId: string,
            sessionNumber: number,
            totalScale5: number | null,
            quizScale5: number | null
          ): StudentScoreCell => {
            const isGraded = typeof totalScale5 === "number" && Number.isFinite(totalScale5);
            const score100 = isGraded ? safeRound2Val(totalScale5 * 20) : null;
            const quiz100 =
              typeof quizScale5 === "number" && Number.isFinite(quizScale5)
                ? safeRound2Val(quizScale5 * 20)
                : null;
            return {
              columnId: colId,
              lessonId: colId,
              sessionNumber,
              status: isGraded ? "GRADED" : "NOT_SUBMITTED",
              score: score100,
              quizScore: quiz100,
              maxScore: 100,
              gradedCountText: isGraded ? "1/1" : undefined,
              rawText: isGraded ? `Đã chấm (${score100}/100)` : "Chưa chấm",
            };
          };

          const cells: Record<string, StudentScoreCell> = {
            ROB_CP1_S04: makeStageCell("ROB_CP1_S04", 4, cp1Calc.total, stu.stageScores.cp1Theory),
            ROB_CP2_S08: makeStageCell("ROB_CP2_S08", 8, cp2Calc.total, stu.stageScores.cp2Theory),
            ROB_FINAL_S14: makeStageCell("ROB_FINAL_S14", 14, finalCalc.total, null),
          };

          let gradedSum = 0;
          let gradedCount = 0;
          let notSubmittedCount = 0;
          for (const c of Object.values(cells)) {
            if (c.status === "GRADED" && typeof c.score === "number") {
              gradedSum += c.score;
              gradedCount++;
            } else {
              notSubmittedCount++;
            }
          }

          return {
            studentId: stu.studentId,
            studentUid: stu.studentUid,
            fullName: stu.fullName,
            isActive: stu.isActive,
            cells,
            averageScore: gradedCount > 0 ? Math.round((gradedSum / gradedCount) * 10) / 10 : null,
            averageQuizScore: null,
            gradedCount,
            submittedUngradedCount: 0,
            notSubmittedCount,
            redoCount: 0,
          };
        });
      } else if (
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

        // S2-06: Reconcile roster across FindStudentSubmissionByClass.students, GetClassById.students (CRM), and SQLite existingStudents.
        // Preserve distinct CRM IDs even when full names coincide!
        const presentIds = new Set<string>();
        const presentCrmIds = new Set<string>();
        const presentNormNamesWithoutCrm = new Set<string>();

        for (const gs of gqlStudents) {
          const sid1 = String(gs.studentUid || "").trim();
          const sid2 = String(gs.id || "").trim();
          const normDisp = normalizeName(String(gs.displayName || ""));
          if (sid1) presentIds.add(sid1);
          if (sid2) {
            presentIds.add(sid2);
            if (crmStudentById.has(sid2)) {
              presentCrmIds.add(sid2);
            }
          }
          if (!sid2 || !crmStudentById.has(sid2)) {
            if (normDisp) presentNormNamesWithoutCrm.add(normDisp);
          }
        }

        // 1) Append active CRM students from GetClassById who have no Denise submission account yet
        if (crmStudentById.size > 0) {
          for (const crmInfo of crmStudentById.values()) {
            const normCrm = normalizeName(crmInfo.fullName);
            const matchedLocal =
              studentByIdMap.get(crmInfo.id) ||
              (existingNameCounts.get(normCrm) === 1 && (crmNameCounts.get(normCrm) || 0) <= 1
                ? studentByNameMap.get(normCrm)
                : undefined);

            if (!crmInfo.activeInClass && !matchedLocal) continue;

            const alreadyByCrmId =
              presentCrmIds.has(crmInfo.id) ||
              presentIds.has(crmInfo.id) ||
              (matchedLocal ? presentIds.has(matchedLocal.studentId) : false);
            const alreadyByUniqueUnbridgedName =
              (crmNameCounts.get(normCrm) || 0) <= 1 &&
              presentNormNamesWithoutCrm.has(normCrm);

            if (!alreadyByCrmId && !alreadyByUniqueUnbridgedName) {
              const uidToUse = matchedLocal?.studentId || crmInfo.id;
              presentCrmIds.add(crmInfo.id);
              presentIds.add(crmInfo.id);
              presentIds.add(uidToUse);
              gqlStudents.push({
                id: crmInfo.id,
                studentUid: uidToUse,
                displayName: matchedLocal?.fullName || crmInfo.fullName,
              });
            }
          }
        }

        // 2) Append synced SQLite students (e.g. inactive students when Drawer DOM or CRM roster is verified)
        const expectedActiveCount = existingStudents.filter((s) => s.isActive === 1).length;
        const hasVerifiedClassRoster = crmStudentById.size > 0;
        if (
          (isDrawerDomVerified || hasVerifiedClassRoster) &&
          expectedActiveCount > 0 &&
          (gqlStudents.length >= expectedActiveCount || hasVerifiedClassRoster) &&
          gqlStudents.length < existingStudents.length
        ) {
          const allPresentNormNames = new Set<string>();
          for (const gs of gqlStudents) {
            const crmId = String(gs.id || "").trim();
            const crmInfo = crmId ? crmStudentById.get(crmId) : undefined;
            allPresentNormNames.add(
              normalizeName(String(crmInfo?.fullName || gs.displayName || ""))
            );
          }

          for (const st of existingStudents) {
            const normSt = normalizeName(st.fullName);
            const isVerifiedInClassById =
              crmStudentById.has(st.studentId) || crmStudentByNormName.has(normSt);
            if (
              (st.isActive === 0 || (hasVerifiedClassRoster && isVerifiedInClassById)) &&
              !presentIds.has(st.studentId) &&
              !(existingNameCounts.get(normSt) === 1 && allPresentNormNames.has(normSt))
            ) {
              const crmInfo =
                crmStudentById.get(st.studentId) ||
                ((crmNameCounts.get(normSt) || 0) <= 1
                  ? crmStudentByNormName.get(normSt)
                  : undefined);
              presentIds.add(st.studentId);
              allPresentNormNames.add(normSt);
              gqlStudents.push({
                id: crmInfo?.id || st.studentId,
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
          const crmId = String(gqlSt.id || "").trim();
          const studentUid = String(gqlSt.studentUid || gqlSt.id || "").trim();
          const normName = normalizeName(displayName);
          const crmStudent = crmId ? crmStudentById.get(crmId) : undefined;
          const normCrmName = crmStudent ? normalizeName(crmStudent.fullName) : "";

          // 1. Prefer exact local ID match
          let matchedStudent =
            (studentUid ? studentByIdMap.get(studentUid) : undefined) ||
            (crmId ? studentByIdMap.get(crmId) : undefined);

          // 2. S2-05: Prefer verified GetClassById CRM student ID -> canonical fullName bridge OVER mutable displayName!
          if (!matchedStudent && crmStudent && normCrmName) {
            if (
              existingNameCounts.get(normCrmName) === 1 &&
              (crmNameCounts.get(normCrmName) || 0) <= 1
            ) {
              const candidate = studentByNameMap.get(normCrmName);
              if (candidate && !usedStudentIds.has(candidate.studentId)) {
                matchedStudent = candidate;
              }
            } else if (
              existingStudents.length > 0 &&
              ((existingNameCounts.get(normCrmName) || 0) > 1 ||
                (crmNameCounts.get(normCrmName) || 0) > 1)
            ) {
              throw new Error(
                `Xung đột định danh học viên: Có nhiều học viên trùng tên '${crmStudent.fullName}' trong danh sách lớp '${classCode}', không thể ánh xạ tự động.`
              );
            }
          }

          // 3. Only fall back to mutable displayName when no CRM identity exists (!crmStudent) and name is strictly unique in BOTH GraphQL and SQLite
          if (
            !matchedStudent &&
            !crmStudent &&
            gqlNameCounts.get(normName) === 1 &&
            existingNameCounts.get(normName) === 1
          ) {
            const candidate = studentByNameMap.get(normName);
            if (candidate && !usedStudentIds.has(candidate.studentId)) {
              matchedStudent = candidate;
            }
          }

          const isVerifiedNewActiveCrmStudent =
            Boolean(crmStudent && crmStudent.activeInClass) &&
            !existingNameCounts.has(normCrmName);

          if (existingStudents.length > 0 && !matchedStudent && !isVerifiedNewActiveCrmStudent) {
            throw new Error(
              `Dữ liệu bảng điểm không khớp hoặc mơ hồ với danh sách lớp '${classCode}': Không thể ánh xạ duy nhất học viên '${displayName}' (${studentUid || "không rõ mã"}) với danh sách lớp đã đồng bộ.`
            );
          }

          if (!matchedStudent && !studentUid && (gqlNameCounts.get(normName) || 0) > 1) {
            throw new Error(
              `Xung đột định danh học viên: Có nhiều học viên trùng tên '${displayName}' nhưng thiếu mã định danh (studentUid) trên LMS.`
            );
          }

          const resolvedFullName = (
            matchedStudent?.fullName ||
            crmStudent?.fullName ||
            displayName
          ).trim();
          const normSlug = normalizeName(resolvedFullName)
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "");
          const studentId =
            matchedStudent?.studentId ||
            studentUid ||
            crmId ||
            (normSlug ? `STU_${classId}_${normSlug.toUpperCase()}` : `STU_${classId}_${sIdx + 1}`);

          if (usedStudentIds.has(studentId)) {
            throw new Error(
              `Xung đột định danh học viên: Mã '${studentId}' bị trùng lặp cho học viên '${displayName}'.`
            );
          }
          usedStudentIds.add(studentId);

          const isActive = matchedStudent
            ? Boolean(matchedStudent.isActive)
            : crmStudent
            ? crmStudent.activeInClass
            : true;

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

            const practiceSubs = sortPracticeSubmissions(
              stuLessonSubs.filter(isPracticeSubmissionItem)
            );
            const practiceSub = practiceSubs[0];
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
              (quizSub.status === "MARKED" ||
                (quizSub.status === "SUBMITTED" && (quizSub.submittedCount ?? 0) > 0)) &&
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
            let practiceTask1Score: number | null | undefined = undefined;
            let practiceTask2Score: number | null | undefined = undefined;
            let gradedCountText: string | undefined;
            let rawText = "Chưa nộp";

            if (practiceSubs.length > 0) {
              const totalTasks = practiceSubs.length;
              const markedPracticeSubs: any[] = [];
              let hasRedo = false;
              let hasSubmittedUngraded = false;

              for (let pIdx = 0; pIdx < practiceSubs.length; pIdx++) {
                const pSub = practiceSubs[pIdx];
                const pStatus = String(pSub.status || "").toUpperCase();
                const hasAttachments =
                  Array.isArray(pSub.content?.attachments) &&
                  pSub.content.attachments.length > 0;
                const isSubmitted =
                  (pSub.submittedCount ?? 0) > 0 ||
                  Boolean(pSub.submittedAt) ||
                  hasAttachments;

                if (pStatus === "MARKED") {
                  if (typeof pSub.score !== "number" || Number.isNaN(pSub.score)) {
                    throw new Error(
                      `Dữ liệu điểm không hợp lệ trên LMS: Bài nộp của '${displayName}' (${col.title}) có trạng thái MARKED nhưng thiếu điểm số hợp lệ (score=${pSub.score}).`
                    );
                  }
                  markedPracticeSubs.push(pSub);
                  const pCat = String(pSub.category || "").toUpperCase();
                  if (pCat === "PRACTICE_TASK2" || (pIdx === 1 && practiceTask2Score === undefined)) {
                    practiceTask2Score = pSub.score;
                  } else if (practiceTask1Score === undefined) {
                    practiceTask1Score = pSub.score;
                  }
                } else if (pStatus === "REDO") {
                  hasRedo = true;
                } else if (pStatus === "SUBMITTED" || (pStatus === "IN_PROGRESS" && isSubmitted)) {
                  hasSubmittedUngraded = true;
                }
              }

              if (markedPracticeSubs.length > 0) {
                status = "GRADED";
                const sumMarked = markedPracticeSubs.reduce(
                  (acc, item) => acc + Number(item.score),
                  0
                );
                score = safeRound2Val(sumMarked / markedPracticeSubs.length);
                gradedCountText = `${markedPracticeSubs.length}/${totalTasks}`;
                rawText = `Đã chấm (${score}/100)`;
              } else if (hasRedo) {
                status = "REDO_REQUESTED";
                score =
                  typeof practiceSub?.score === "number" ? practiceSub.score : null;
                gradedCountText = `0/${totalTasks}`;
                rawText = "Yêu cầu làm lại";
              } else if (hasSubmittedUngraded) {
                status = "SUBMITTED_UNGRADED";
                score = null;
                gradedCountText = `0/${totalTasks}`;
                rawText = `Chưa chấm (0/${totalTasks})`;
              } else {
                status = "NOT_SUBMITTED";
                score = null;
                rawText = "Chưa nộp";
              }
            }
            // Note: Quiz score is strictly kept in quizScore (never copied into practice `score` or practice `averageScore`)

            const mergedAttachments: string[] = [];
            const mergedNotes: string[] = [];
            for (const pSub of practiceSubs) {
              if (Array.isArray(pSub?.content?.attachments)) {
                for (const att of pSub.content.attachments) {
                  if (att && !mergedAttachments.includes(att)) {
                    mergedAttachments.push(att);
                  }
                }
              }
              if (pSub?.note && String(pSub.note).trim()) {
                mergedNotes.push(String(pSub.note).trim());
              }
            }

            const cell: StudentScoreCell = {
              columnId: col.columnId,
              lessonId: col.lessonId,
              sessionNumber: col.sessionNumber,
              status,
              score,
              ...(practiceTask1Score !== undefined ? { practiceTask1Score } : {}),
              ...(practiceTask2Score !== undefined ? { practiceTask2Score } : {}),
              quizScore: quizScoreVal,
              maxScore: 100,
              submissionId: practiceSub?.id ? String(practiceSub.id) : null,
              attachments: mergedAttachments,
              teacherNote: mergedNotes.join("\n"),
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
            fullName: resolvedFullName,
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
        const drawer = page
          .locator('div[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight')
          .first();
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

      const scrapedAt = new Date().toISOString();
      const reportCardSnapshot = this.extractReportCardSnapshotFromGql({
        classId,
        classCode,
        lmsClassId,
        isRobotics,
        submissionGqlData,
        classByIdGqlData,
        existingStudents,
        session14Evals,
        fallbackMatrix: { columns, rows },
        scrapedAt,
      });

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
        reportCardSnapshot,
        scrapedAt,
      };

      // S2-03: Persist both the Teaching Report Card snapshot and Score Matrix cache atomically.
      // Never swallow errors from reportCardRepo.saveLmsSnapshot!
      const persistBoth = () => {
        if (
          typeof reportCardRepo !== "undefined" &&
          reportCardRepo &&
          typeof reportCardRepo.saveLmsSnapshot === "function"
        ) {
          reportCardRepo.saveLmsSnapshot(classId, reportCardSnapshot);
        }

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
      };

      if (typeof getDb === "function") {
        const dbInstance = getDb();
        if (dbInstance && typeof dbInstance.transaction === "function") {
          dbInstance.transaction(persistBoth)();
        } else {
          persistBoth();
        }
      } else {
        persistBoth();
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
   * Deterministically extracts a complete `ClassReportCardLmsSnapshot` from MindX LMS
   * `FindStudentSubmissionByClass` + `GetClassById` GraphQL payloads + SQLite `spck_session14_evaluations`.
   */
  public static extractReportCardSnapshotFromGql(
    params: ExtractReportCardSnapshotParams
  ): ClassReportCardLmsSnapshot {
    const cleanClassId = String(params.classId || params.classCode || "")
      .trim()
      .toUpperCase();
    const cleanClassCode = String(params.classCode || cleanClassId)
      .trim()
      .toUpperCase();
    const isRobotics =
      typeof params.isRobotics === "boolean"
        ? params.isRobotics
        : safeCheckIsRobotics(cleanClassCode);
    const scrapedAt = params.scrapedAt || new Date().toISOString();

    const submissionGql = params.submissionGqlData;
    const classByIdGql = params.classByIdGqlData;
    const existingStudents = Array.isArray(params.existingStudents)
      ? params.existingStudents
      : [];
    const session14Evals = Array.isArray(params.session14Evals)
      ? params.session14Evals
      : [];

    // 1. Build CRM student lookup maps from GetClassById
    const crmById = new Map<string, { id: string; fullName: string; activeInClass: boolean }>();
    const crmByNormName = new Map<string, { id: string; fullName: string; activeInClass: boolean }>();
    const crmNameCounts = new Map<string, number>();

    if (classByIdGql && Array.isArray(classByIdGql.students)) {
      for (const cs of classByIdGql.students) {
        const id = String(cs?.student?.id || "").trim();
        const fullName = String(cs?.student?.fullName || "").trim();
        const activeInClass = cs?.activeInClass !== false;
        if (id && fullName) {
          const norm = normalizeStudentNameKey(fullName);
          crmById.set(id, { id, fullName, activeInClass });
          crmNameCounts.set(norm, (crmNameCounts.get(norm) || 0) + 1);
          crmByNormName.set(norm, { id, fullName, activeInClass });
        }
      }
    }
    if (classByIdGql && Array.isArray(classByIdGql.slots)) {
      for (const slot of classByIdGql.slots) {
        for (const att of slot?.studentAttendance || []) {
          const id = String(att?.student?.id || "").trim();
          const fullName = String(att?.student?.fullName || "").trim();
          if (id && fullName && !crmById.has(id)) {
            const norm = normalizeStudentNameKey(fullName);
            crmById.set(id, { id, fullName, activeInClass: true });
            crmNameCounts.set(norm, (crmNameCounts.get(norm) || 0) + 1);
            if (!crmByNormName.has(norm)) {
              crmByNormName.set(norm, { id, fullName, activeInClass: true });
            }
          }
        }
      }
    }

    // 2. Build existing SQLite student lookup maps
    const existingById = new Map<string, StudentRecord>();
    const existingByNormName = new Map<string, StudentRecord>();
    const existingNameCounts = new Map<string, number>();
    for (const st of existingStudents) {
      existingById.set(st.studentId, st);
      const norm = normalizeStudentNameKey(st.fullName);
      existingNameCounts.set(norm, (existingNameCounts.get(norm) || 0) + 1);
      existingByNormName.set(norm, st);
    }

    // 2b. S2-04: Build lookup maps for fallbackMatrix.rows so DOM BTVN cells attach to ANY candidate source
    const fallbackRowById = new Map<string, StudentScoreRow>();
    const fallbackRowByNormName = new Map<string, StudentScoreRow>();
    const fallbackNameCounts = new Map<string, number>();
    if (params.fallbackMatrix && Array.isArray(params.fallbackMatrix.rows)) {
      for (const r of params.fallbackMatrix.rows) {
        if (r?.studentId) fallbackRowById.set(String(r.studentId).trim(), r);
        if (r?.studentUid) fallbackRowById.set(String(r.studentUid).trim(), r);
        const norm = normalizeStudentNameKey(r?.fullName || "");
        if (norm) {
          fallbackNameCounts.set(norm, (fallbackNameCounts.get(norm) || 0) + 1);
          fallbackRowByNormName.set(norm, r);
        }
      }
    }

    // 3. Separate BTVN lessons vs CHECKPOINT lessons from FindStudentSubmissionByClass
    const btvnSessions: ReportCardBtvnSessionMeta[] = [];
    let cp1FallbackLessonId: string | undefined;
    let cp2FallbackLessonId: string | undefined;
    const allSubmissions: any[] = Array.isArray(submissionGql?.submissions)
      ? submissionGql.submissions
      : [];

    if (!isRobotics) {
      if (Array.isArray(submissionGql?.lessons) && submissionGql.lessons.length > 0) {
        const sortedLessons = [...submissionGql.lessons].sort(
          (a: any, b: any) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)
        );
        const seenSessionNums = new Set<number>();

        for (let idx = 0; idx < sortedLessons.length; idx++) {
          const lesson = sortedLessons[idx];
          const lessonId = String(lesson.id || "").trim();
          const sourceTitle = String(lesson.name || lesson.title || "").trim();
          const rawTitle = sourceTitle || `Buổi ${idx + 1}`;
          const lessonType = String(lesson.type || "").toUpperCase();
          const isCheckpoint =
            lessonType === "CHECKPOINT" ||
            /bài\s*kiểm\s*tra|kiểm\s*tra\s*định\s*kỳ|checkpoint/i.test(sourceTitle);

          if (isCheckpoint) {
            // S2-07: Resolve CP1 vs CP2 explicitly by original source lesson/session identity ONLY (never generated Buổi ${idx + 1})!
            const stage = resolveCheckpointLessonStage({
              id: lessonId,
              title: sourceTitle,
              displayOrder:
                typeof lesson.displayOrder === "number" && Number.isFinite(lesson.displayOrder)
                  ? lesson.displayOrder
                  : undefined,
            });
            if (stage === 1 && !cp1FallbackLessonId) {
              cp1FallbackLessonId = lessonId;
            } else if (stage === 2 && !cp2FallbackLessonId) {
              cp2FallbackLessonId = lessonId;
            }
            continue;
          }

          const numMatch =
            sourceTitle.match(/(?:homework|bài|buổi|session|slot|lần)\s*(\d+)/i) ||
            sourceTitle.match(/(\d+)/);
          const sessionNumber = numMatch ? parseInt(numMatch[1], 10) : idx + 1;

          // S2-09: Always exclude Checkpoint-session homeworks (Buổi 5 & Buổi 9) regardless of payload lesson count
          if (
            !params.includeCheckpointSessionBtvn &&
            (sessionNumber === 5 || sessionNumber === 9)
          ) {
            continue;
          }
          if (seenSessionNums.has(sessionNumber)) continue;
          seenSessionNums.add(sessionNumber);

          const lessonSubs = allSubmissions.filter(
            (s) => String(s?.lessonId || "") === lessonId
          );
          const hasQuizSub = lessonSubs.some(
            (s) =>
              s?.category === "QUIZ" ||
              s?.type === "QUIZ" ||
              s?.submissionType === "QUIZ"
          );
          const practiceSubs = lessonSubs.filter(isPracticeSubmissionItem);
          const hasTask2 = practiceSubs.some(
            (s) => String(s?.category || "").toUpperCase() === "PRACTICE_TASK2"
          );

          btvnSessions.push({
            sessionNumber,
            title: rawTitle,
            lessonId,
            hasTheory: lessonSubs.length > 0 ? hasQuizSub : true,
            hasPractice: lessonSubs.length > 0 ? practiceSubs.length > 0 : true,
            practiceTaskCount: hasTask2 ? 2 : 1,
            maxTheoryScore: 100,
            maxPracticeScore: 100,
          });
        }
      } else if (
        params.fallbackMatrix &&
        Array.isArray(params.fallbackMatrix.columns) &&
        params.fallbackMatrix.columns.length > 0
      ) {
        const seenSessionNums = new Set<number>();
        for (const col of params.fallbackMatrix.columns) {
          const isCheckpoint =
            String(col.lessonType || "").toUpperCase() === "CHECKPOINT" ||
            /bài\s*kiểm\s*tra|kiểm\s*tra\s*định\s*kỳ|checkpoint/i.test(col.title);
          if (isCheckpoint) continue;
          // S2-09: Always exclude Checkpoint-session homeworks (Buổi 5 & Buổi 9) regardless of column count
          if (
            !params.includeCheckpointSessionBtvn &&
            (col.sessionNumber === 5 || col.sessionNumber === 9)
          ) {
            continue;
          }
          if (seenSessionNums.has(col.sessionNumber)) continue;
          seenSessionNums.add(col.sessionNumber);

          btvnSessions.push({
            sessionNumber: col.sessionNumber,
            title: col.title,
            lessonId: col.lessonId || col.columnId,
            hasTheory: true,
            hasPractice: true,
            practiceTaskCount: 1,
            maxTheoryScore: 100,
            maxPracticeScore: 100,
          });
        }
      }
      btvnSessions.sort((a, b) => a.sessionNumber - b.sessionNumber);
    }

    // 4. Helper to extract Checkpoint stage (LT, TH, NL, note) from a GetClassById slot
    const slots: any[] = Array.isArray(classByIdGql?.slots) ? classByIdGql.slots : [];
    const findSlotByZeroIndex = (zeroIdx: number): any => {
      const byIndexField = slots.find((s) => Number(s?.index) === zeroIdx);
      return byIndexField || slots[zeroIdx] || null;
    };

    const cp1Slot = findSlotByZeroIndex(isRobotics ? 3 : 4); // Robotics: Buổi 4 (idx 3), Coding: Buổi 5 (idx 4)
    const cp2Slot = findSlotByZeroIndex(isRobotics ? 7 : 8); // Robotics: Buổi 8 (idx 7), Coding: Buổi 9 (idx 8)
    const finalSlot = findSlotByZeroIndex(13); // Buổi 14 (idx 13)

    const findAttendanceForStudent = (
      slotObj: any,
      idsToMatch: string[],
      normFullName: string
    ): any => {
      const attList: any[] = Array.isArray(slotObj?.studentAttendance)
        ? slotObj.studentAttendance
        : [];
      if (attList.length === 0) return null;

      const cleanIds = idsToMatch.map((x) => String(x || "").trim()).filter(Boolean);
      for (const att of attList) {
        const attStuId = String(att?.student?.id || att?.studentId || "").trim();
        if (attStuId && cleanIds.includes(attStuId)) {
          return att;
        }
      }

      if (normFullName && (crmNameCounts.get(normFullName) || 0) <= 1) {
        const nameMatches = attList.filter(
          (att) => normalizeStudentNameKey(att?.student?.fullName || "") === normFullName
        );
        if (nameMatches.length === 1) {
          return nameMatches[0];
        }
      }
      return null;
    };

    const parseSlotCheckpointScores = (
      att: any
    ): {
      theory: number | null;
      practice: number | null;
      competency: number | null;
      note: string;
    } => {
      if (!att || typeof att !== "object") {
        return { theory: null, practice: null, competency: null, note: "" };
      }
      const areas: any[] = Array.isArray(att.commentByAreas) ? att.commentByAreas : [];
      const rateGrades = areas
        .filter(
          (a) =>
            String(a?.type || "").toUpperCase() === "RATE" &&
            typeof a?.grade === "number" &&
            Number.isFinite(a.grade) &&
            a.grade > 0 &&
            a.grade <= 5
        )
        .map((a) => Number(a.grade));

      const competency =
        rateGrades.length > 0
          ? safeRound2Val(rateGrades.reduce((sum, g) => sum + g, 0) / rateGrades.length)
          : null;

      const cpArea = areas.find(
        (a) => String(a?.type || "").toUpperCase() === "CHECKPOINT" || Boolean(a?.checkpoint)
      );
      let theory: number | null = null;
      let practice: number | null = null;

      if (cpArea?.checkpoint && typeof cpArea.checkpoint === "object") {
        const rawLt = cpArea.checkpoint.checkpointScore;
        const rawTh = cpArea.checkpoint.practiceScore;
        const hasScoredQuestion =
          Array.isArray(cpArea.checkpoint.checkpointQuestions) &&
          cpArea.checkpoint.checkpointQuestions.some((q: any) => q?.result === true);
        const hasTextScore = /Điểm\s*(?:thực\s*hành|trắc\s*nghiệm)/i.test(
          String(cpArea.content || "")
        );
        const isGradedSlot =
          (typeof rawLt === "number" && rawLt > 0) ||
          (typeof rawTh === "number" && rawTh > 0) ||
          competency !== null ||
          hasScoredQuestion ||
          hasTextScore;

        if (isGradedSlot) {
          theory = normalizeStageScoreToScale5(rawLt);
          practice = normalizeStageScoreToScale5(rawTh);
        }
      } else if (cpArea?.content) {
        const thMatch = String(cpArea.content).match(
          /Điểm\s*thực\s*hành\s*:\s*(\d+(?:[.,]\d+)?)/i
        );
        const ltMatch = String(cpArea.content).match(
          /Điểm\s*(?:trắc\s*nghiệm|lý\s*thuyết)\s*:\s*(\d+(?:[.,]\d+)?)/i
        );
        if (thMatch) {
          practice = normalizeStageScoreToScale5(thMatch[1].replace(",", "."));
        }
        if (ltMatch) {
          theory = normalizeStageScoreToScale5(ltMatch[1].replace(",", "."));
        }
      }

      const contentArea = areas.find(
        (a) => String(a?.type || "").toUpperCase() === "CONTENT" && a?.content
      );
      const note = stripHtmlTagsClean(contentArea?.content || att.comment || "");

      return { theory, practice, competency, note };
    };

    const parseFallbackCheckpointFromSubmissions = (
      checkpointLessonId: string | undefined,
      studentUid: string
    ): { theory: number | null; practice: number | null } => {
      if (!checkpointLessonId || !studentUid || allSubmissions.length === 0) {
        return { theory: null, practice: null };
      }
      const subs = allSubmissions.filter(
        (s) =>
          String(s?.lessonId || "") === checkpointLessonId &&
          String(s?.studentUid || "") === studentUid
      );
      if (subs.length === 0) return { theory: null, practice: null };

      const quizSub = subs.find(
        (s) =>
          s?.category === "QUIZ" || s?.type === "QUIZ" || s?.submissionType === "QUIZ"
      );
      let theory: number | null = null;
      if (
        quizSub &&
        (String(quizSub.status || "").toUpperCase() === "MARKED" ||
          (String(quizSub.status || "").toUpperCase() === "SUBMITTED" &&
            (quizSub.submittedCount ?? 0) > 0)) &&
        typeof quizSub.score === "number" &&
        Number.isFinite(quizSub.score)
      ) {
        theory = safeNormToScale5(quizSub.score, 100);
      }

      const markedPractice = subs
        .filter(isPracticeSubmissionItem)
        .filter(
          (s) =>
            String(s?.status || "").toUpperCase() === "MARKED" &&
            typeof s?.score === "number" &&
            Number.isFinite(s.score)
        );
      let practice: number | null = null;
      if (markedPractice.length > 0) {
        const avgRaw =
          markedPractice.reduce((acc, s) => acc + Number(s.score), 0) /
          markedPractice.length;
        practice = safeNormToScale5(avgRaw, 100);
      }

      return { theory, practice };
    };

    const parseSlotFinalDemoScores = (
      att: any
    ): { product: number | null; competency: number | null; note: string } => {
      if (!att || typeof att !== "object") {
        return { product: null, competency: null, note: "" };
      }
      const areas: any[] = Array.isArray(att.commentByAreas) ? att.commentByAreas : [];
      const rateGrades = areas
        .filter(
          (a) =>
            String(a?.type || "").toUpperCase() === "RATE" &&
            typeof a?.grade === "number" &&
            Number.isFinite(a.grade) &&
            a.grade > 0 &&
            a.grade <= 5
        )
        .map((a) => Number(a.grade));
      const competency =
        rateGrades.length > 0
          ? safeRound2Val(rateGrades.reduce((sum, g) => sum + g, 0) / rateGrades.length)
          : null;

      const contentAreas = areas
        .filter((a) => String(a?.type || "").toUpperCase() === "CONTENT" && a?.content)
        .map((a) => stripHtmlTagsClean(a.content))
        .filter(Boolean);
      const note = contentAreas.join(" | ") || stripHtmlTagsClean(att.comment || "");

      const parseExplicitDemoQuestionScore = (q: any): number | null => {
        if (!q || typeof q !== "object") return null;
        const rawVal = q.score ?? q.grade ?? q.point;
        if (
          rawVal === null ||
          rawVal === undefined ||
          typeof rawVal === "boolean" ||
          (typeof rawVal === "string" && rawVal.trim() === "")
        ) {
          return null;
        }
        const num = Number(rawVal);
        return Number.isFinite(num) && num >= 0 ? num : null;
      };

      let product: number | null = null;
      for (const area of areas) {
        if (Array.isArray(area?.demoQuestions) && area.demoQuestions.length > 0) {
          const validDemoScores = area.demoQuestions
            .map(parseExplicitDemoQuestionScore)
            .filter((n: number | null): n is number => n !== null);
          const hasPositive = validDemoScores.some((n: number) => n > 0);
          // S2-08 & R2-01: Distinguish ungraded/blank default fields from completed all-zero DEMO grading using DEMO/competency completion evidence (never general CONTENT notes)
          const isExplicitZeroDemo =
            validDemoScores.length > 0 &&
            validDemoScores.length === area.demoQuestions.length &&
            (competency !== null ||
              area?.isGraded === true ||
              area?.completed === true ||
              String(area?.status || "").toUpperCase() === "GRADED" ||
              String(area?.status || "").toUpperCase() === "MARKED" ||
              String(area?.status || "").toUpperCase() === "COMPLETED" ||
              /Điểm\s*Demo/i.test(String(area?.content || att?.comment || "")) ||
              area.demoQuestions.some(
                (q: any) =>
                  q?.isGraded === true ||
                  q?.result === true ||
                  q?.completed === true ||
                  String(q?.status || "").toUpperCase() === "GRADED" ||
                  String(q?.status || "").toUpperCase() === "MARKED" ||
                  String(q?.status || "").toUpperCase() === "COMPLETED"
              ));

          if (hasPositive || isExplicitZeroDemo) {
            const sumDemo = validDemoScores.reduce((s: number, n: number) => s + n, 0);
            product = normalizeStageScoreToScale5(sumDemo);
            break;
          }
        }
        if (
          String(area?.type || "").toUpperCase() === "DEMO" ||
          Boolean(area?.courseProcessDemoId)
        ) {
          const rawAreaGrade = area?.grade;
          const hasExplicitAreaGrade =
            typeof rawAreaGrade === "number" &&
            Number.isFinite(rawAreaGrade) &&
            (rawAreaGrade > 0 ||
              (rawAreaGrade === 0 &&
                (competency !== null ||
                  area?.isGraded === true ||
                  /Điểm\s*Demo/i.test(String(area?.content || att?.comment || "")))));
          const candidate =
            area?.checkpoint?.practiceScore ??
            area?.checkpoint?.checkpointScore ??
            (hasExplicitAreaGrade ? rawAreaGrade : null);
          const norm = normalizeStageScoreToScale5(candidate);
          if (norm !== null) {
            product = norm;
            break;
          }
        }
      }

      if (product === null) {
        const combinedText = [
          att.comment || "",
          ...areas.map((a) => String(a?.content || "")),
        ].join("\n");
        const demoMatch = combinedText.match(/Điểm\s*Demo\s*:\s*(\d+(?:[.,]\d+)?)/i);
        if (demoMatch) {
          product = normalizeStageScoreToScale5(demoMatch[1].replace(",", "."));
        }
      }

      return { product, competency, note };
    };

    // 5. Build canonical student roster across all sources
    interface CandidateStudentIdentity {
      studentId: string;
      studentUid?: string;
      crmStudentId?: string;
      fullName: string;
      isActive: boolean;
      fallbackRow?: StudentScoreRow;
    }

    const candidates: CandidateStudentIdentity[] = [];
    const seenStudentIds = new Set<string>();
    const seenCrmIds = new Set<string>();
    const seenNormNames = new Set<string>();
    const seenNormNamesWithoutCrm = new Set<string>();

    const resolveFallbackRowForCandidate = (
      cand: CandidateStudentIdentity
    ): StudentScoreRow | undefined => {
      if (cand.fallbackRow) return cand.fallbackRow;
      if (fallbackRowById.size === 0 && fallbackRowByNormName.size === 0) return undefined;
      const byId =
        fallbackRowById.get(cand.studentId) ||
        (cand.crmStudentId ? fallbackRowById.get(cand.crmStudentId) : undefined) ||
        (cand.studentUid ? fallbackRowById.get(cand.studentUid) : undefined);
      if (byId) return byId;
      const norm = normalizeStudentNameKey(cand.fullName);
      if (norm && fallbackNameCounts.get(norm) === 1) {
        return fallbackRowByNormName.get(norm);
      }
      return undefined;
    };

    const registerCandidate = (cand: CandidateStudentIdentity) => {
      const sid = String(cand.studentId || "").trim();
      if (!sid || seenStudentIds.has(sid)) return;
      seenStudentIds.add(sid);
      if (cand.crmStudentId) {
        seenCrmIds.add(cand.crmStudentId);
      }
      const norm = normalizeStudentNameKey(cand.fullName);
      if (norm) {
        seenNormNames.add(norm);
        if (!cand.crmStudentId) {
          seenNormNamesWithoutCrm.add(norm);
        }
      }
      // S2-04: Always attach matching DOM fallbackRow regardless of which branch created the candidate!
      cand.fallbackRow = resolveFallbackRowForCandidate(cand);
      candidates.push(cand);
    };

    if (
      !isRobotics &&
      Array.isArray(submissionGql?.students) &&
      submissionGql.students.length > 0
    ) {
      const gqlList: any[] = submissionGql.students;
      const gqlNameCounts = new Map<string, number>();
      for (const gs of gqlList) {
        const norm = normalizeStudentNameKey(gs?.displayName || "");
        gqlNameCounts.set(norm, (gqlNameCounts.get(norm) || 0) + 1);
      }

      for (let idx = 0; idx < gqlList.length; idx++) {
        const gs = gqlList[idx];
        const crmId = String(gs?.id || "").trim();
        const studentUid = String(gs?.studentUid || gs?.id || "").trim();
        const rawDisplayName = String(gs?.displayName || `Học viên ${idx + 1}`).trim();
        const normDisplay = normalizeStudentNameKey(rawDisplayName);
        const crmInfo = crmId ? crmById.get(crmId) : undefined;
        const normCrm = crmInfo ? normalizeStudentNameKey(crmInfo.fullName) : "";

        // 1. Direct ID match
        let matchedExisting =
          (studentUid ? existingById.get(studentUid) : undefined) ||
          (crmId ? existingById.get(crmId) : undefined);

        // 2. S2-05: Prefer verified CRM ID -> canonical fullName bridge OVER mutable displayName!
        if (!matchedExisting && crmInfo && normCrm) {
          if (
            existingNameCounts.get(normCrm) === 1 &&
            (crmNameCounts.get(normCrm) || 0) <= 1
          ) {
            const candidate = existingByNormName.get(normCrm);
            if (candidate && !seenStudentIds.has(candidate.studentId)) {
              matchedExisting = candidate;
            }
          } else if (
            existingStudents.length > 0 &&
            ((existingNameCounts.get(normCrm) || 0) > 1 ||
              ((crmNameCounts.get(normCrm) || 0) > 1 &&
                (existingNameCounts.get(normCrm) || 0) >= 1))
          ) {
            throw new Error(
              `Xung đột định danh học viên: Có nhiều học viên trùng tên '${crmInfo.fullName}' trong danh sách lớp '${cleanClassCode}', không thể ánh xạ tự động.`
            );
          }
        }

        // 3. Only use mutable displayName when no verified CRM record exists (!crmInfo) and name is strictly unique
        if (
          !matchedExisting &&
          !crmInfo &&
          gqlNameCounts.get(normDisplay) === 1 &&
          existingNameCounts.get(normDisplay) === 1
        ) {
          const candidate = existingByNormName.get(normDisplay);
          if (candidate && !seenStudentIds.has(candidate.studentId)) {
            matchedExisting = candidate;
          }
        }

        const fullName = (
          matchedExisting?.fullName ||
          crmInfo?.fullName ||
          rawDisplayName
        ).trim();
        const normSlug = normalizeStudentNameKey(fullName)
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "");
        const studentId =
          matchedExisting?.studentId ||
          studentUid ||
          crmId ||
          (normSlug ? `STU_${cleanClassId}_${normSlug.toUpperCase()}` : `STU_${cleanClassId}_${idx + 1}`);
        const isActive = matchedExisting
          ? Boolean(matchedExisting.isActive)
          : crmInfo
          ? crmInfo.activeInClass
          : true;

        registerCandidate({
          studentId,
          studentUid: studentUid || undefined,
          crmStudentId: crmId || crmInfo?.id || undefined,
          fullName,
          isActive,
        });
      }

      // S2-06: Append active/synced students present in GetClassById or existingStudents who were absent from submissionGql.students.
      // Never skip a distinct CRM ID merely because another pupil has the same normalized name!
      if (crmById.size > 0) {
        for (const crmInfo of crmById.values()) {
          const normCrm = normalizeStudentNameKey(crmInfo.fullName);
          if (seenCrmIds.has(crmInfo.id) || seenStudentIds.has(crmInfo.id)) continue;
          if (
            (crmNameCounts.get(normCrm) || 0) <= 1 &&
            seenNormNamesWithoutCrm.has(normCrm)
          ) {
            const existingCand = candidates.find(
              (c) => !c.crmStudentId && normalizeStudentNameKey(c.fullName) === normCrm
            );
            if (existingCand) {
              existingCand.crmStudentId = crmInfo.id;
              seenCrmIds.add(crmInfo.id);
            }
            continue;
          }
          const matchedById = existingById.get(crmInfo.id);
          if (
            !matchedById &&
            existingStudents.length > 0 &&
            ((existingNameCounts.get(normCrm) || 0) > 1 ||
              ((crmNameCounts.get(normCrm) || 0) > 1 &&
                (existingNameCounts.get(normCrm) || 0) >= 1))
          ) {
            throw new Error(
              `Xung đột định danh học viên: Có nhiều học viên trùng tên '${crmInfo.fullName}' trong danh sách lớp '${cleanClassCode}', không thể ánh xạ tự động.`
            );
          }
          const matchedExisting =
            matchedById ||
            (existingNameCounts.get(normCrm) === 1 && (crmNameCounts.get(normCrm) || 0) <= 1
              ? existingByNormName.get(normCrm)
              : undefined);
          if (!crmInfo.activeInClass && !matchedExisting) continue;
          const studentId =
            matchedExisting && !seenStudentIds.has(matchedExisting.studentId)
              ? matchedExisting.studentId
              : crmInfo.id;
          const isActive = matchedExisting ? Boolean(matchedExisting.isActive) : crmInfo.activeInClass;
          registerCandidate({
            studentId,
            studentUid: studentId,
            crmStudentId: crmInfo.id,
            fullName: (matchedExisting?.fullName || crmInfo.fullName).trim(),
            isActive,
          });
        }
      }
      for (const st of existingStudents) {
        const normSt = normalizeStudentNameKey(st.fullName);
        if (seenStudentIds.has(st.studentId)) continue;
        if (existingNameCounts.get(normSt) === 1 && seenNormNames.has(normSt)) continue;
        const crmInfo =
          crmById.get(st.studentId) ||
          ((crmNameCounts.get(normSt) || 0) <= 1 ? crmByNormName.get(normSt) : undefined);
        registerCandidate({
          studentId: st.studentId,
          studentUid: st.studentId,
          crmStudentId: crmInfo?.id,
          fullName: st.fullName.trim(),
          isActive: Boolean(st.isActive),
        });
      }
    } else if (crmById.size > 0) {
      // Robotics classes or classes with GetClassById roster
      for (const crmInfo of crmById.values()) {
        const normCrm = normalizeStudentNameKey(crmInfo.fullName);
        const matchedById = existingById.get(crmInfo.id);
        if (
          !matchedById &&
          existingStudents.length > 0 &&
          ((existingNameCounts.get(normCrm) || 0) > 1 ||
            ((crmNameCounts.get(normCrm) || 0) > 1 &&
              (existingNameCounts.get(normCrm) || 0) >= 1))
        ) {
          throw new Error(
            `Xung đột định danh học viên: Có nhiều học viên trùng tên '${crmInfo.fullName}' trong danh sách lớp '${cleanClassCode}', không thể ánh xạ tự động.`
          );
        }
        const matchedExisting =
          matchedById ||
          (existingNameCounts.get(normCrm) === 1 && (crmNameCounts.get(normCrm) || 0) <= 1
            ? existingByNormName.get(normCrm)
            : undefined);
        const studentId =
          matchedExisting && !seenStudentIds.has(matchedExisting.studentId)
            ? matchedExisting.studentId
            : crmInfo.id;
        const isActive = matchedExisting ? Boolean(matchedExisting.isActive) : crmInfo.activeInClass;
        registerCandidate({
          studentId,
          studentUid: studentId,
          crmStudentId: crmInfo.id,
          fullName: (matchedExisting?.fullName || crmInfo.fullName).trim(),
          isActive,
        });
      }
      for (const st of existingStudents) {
        const normSt = normalizeStudentNameKey(st.fullName);
        if (seenStudentIds.has(st.studentId)) continue;
        if (existingNameCounts.get(normSt) === 1 && seenNormNames.has(normSt)) continue;
        registerCandidate({
          studentId: st.studentId,
          studentUid: st.studentId,
          fullName: st.fullName.trim(),
          isActive: Boolean(st.isActive),
        });
      }
    } else if (
      !isRobotics &&
      params.fallbackMatrix &&
      Array.isArray(params.fallbackMatrix.rows) &&
      params.fallbackMatrix.rows.length > 0
    ) {
      for (const row of params.fallbackMatrix.rows) {
        const norm = normalizeStudentNameKey(row.fullName);
        const crmInfo =
          crmById.get(row.studentId) ||
          (row.studentUid ? crmById.get(row.studentUid) : undefined) ||
          (crmNameCounts.get(norm) === 1 ? crmByNormName.get(norm) : undefined);
        registerCandidate({
          studentId: row.studentId,
          studentUid: row.studentUid || row.studentId,
          crmStudentId: crmInfo?.id,
          fullName: row.fullName.trim(),
          isActive: row.isActive,
          fallbackRow: row,
        });
      }
    } else if (!isRobotics && existingStudents.length > 0) {
      // S2-01: Never manufacture a Robotics roster from existingStudents alone when GetClassById failed or is missing!
      for (const st of existingStudents) {
        registerCandidate({
          studentId: st.studentId,
          studentUid: st.studentId,
          fullName: st.fullName.trim(),
          isActive: Boolean(st.isActive),
        });
      }
    }

    // 6. Map Session 14 Evaluations by studentId and normalized slug/name
    const evalByStudentId = new Map<string, SpckSession14EvaluationRecord>();
    const evalByNormName = new Map<string, SpckSession14EvaluationRecord>();
    for (const ev of session14Evals) {
      const sid = String(ev?.studentId || "").trim();
      if (!sid) continue;
      evalByStudentId.set(sid, ev);
      const matchedSt = existingById.get(sid);
      if (matchedSt) {
        evalByNormName.set(normalizeStudentNameKey(matchedSt.fullName), ev);
      }
    }

    const findSession14EvalForStudent = (
      cand: CandidateStudentIdentity
    ): SpckSession14EvaluationRecord | undefined => {
      const direct =
        evalByStudentId.get(cand.studentId) ||
        (cand.crmStudentId ? evalByStudentId.get(cand.crmStudentId) : undefined) ||
        (cand.studentUid ? evalByStudentId.get(cand.studentUid) : undefined);
      if (direct) return direct;

      const normName = normalizeStudentNameKey(cand.fullName);
      if (normName && evalByNormName.has(normName)) {
        return evalByNormName.get(normName);
      }

      const expectedSlugId = `STU_${cleanClassId}_${normName
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toUpperCase()}`;
      return evalByStudentId.get(expectedSlugId);
    };

    // 7. Build each student's snapshot item
    const students: StudentReportCardSnapshotItem[] = candidates.map((cand) => {
      const btvnScores: Record<number, StudentBtvnSessionRaw> = {};

      if (!isRobotics && btvnSessions.length > 0) {
        for (const sess of btvnSessions) {
          const sNum = sess.sessionNumber;
          if (allSubmissions.length > 0 && sess.lessonId && cand.studentUid) {
            const stuSubs = allSubmissions.filter(
              (s) =>
                String(s?.lessonId || "") === sess.lessonId &&
                String(s?.studentUid || "") === cand.studentUid
            );
            const quizSub = stuSubs.find(
              (s) =>
                s?.category === "QUIZ" ||
                s?.type === "QUIZ" ||
                s?.submissionType === "QUIZ"
            );
            const practiceSubs = sortPracticeSubmissions(
              stuSubs.filter(isPracticeSubmissionItem)
            );

            const theoryRaw =
              quizSub &&
              (String(quizSub.status || "").toUpperCase() === "MARKED" ||
                (String(quizSub.status || "").toUpperCase() === "SUBMITTED" &&
                  (quizSub.submittedCount ?? 0) > 0)) &&
              typeof quizSub.score === "number" &&
              Number.isFinite(quizSub.score)
                ? safeRound2Val(quizSub.score)
                : null;

            let practiceTask1Raw: number | null = null;
            let practiceTask2Raw: number | null = null;
            const markedPracticeScores: number[] = [];
            const practiceNotes: string[] = [];

            for (let pIdx = 0; pIdx < practiceSubs.length; pIdx++) {
              const pSub = practiceSubs[pIdx];
              const pStatus = String(pSub?.status || "").toUpperCase();
              const pCat = String(pSub?.category || "").toUpperCase();
              if (
                pStatus === "MARKED" &&
                typeof pSub?.score === "number" &&
                Number.isFinite(pSub.score)
              ) {
                const sc = safeRound2Val(pSub.score);
                markedPracticeScores.push(sc);
                if (pCat === "PRACTICE_TASK2" || (pIdx === 1 && practiceTask2Raw === null)) {
                  practiceTask2Raw = sc;
                } else if (practiceTask1Raw === null) {
                  practiceTask1Raw = sc;
                }
              }
              if (pSub?.note && String(pSub.note).trim()) {
                practiceNotes.push(stripHtmlTagsClean(pSub.note));
              }
            }

            const practiceRaw =
              markedPracticeScores.length > 0
                ? safeRound2Val(
                    markedPracticeScores.reduce((acc, v) => acc + v, 0) /
                      markedPracticeScores.length
                  )
                : null;

            btvnScores[sNum] = {
              sessionNumber: sNum,
              theoryRaw,
              theoryMax: sess.maxTheoryScore || 100,
              theoryNote: stripHtmlTagsClean(quizSub?.note || ""),
              practiceRaw,
              practiceMax: sess.maxPracticeScore || 100,
              practiceTask1Raw,
              practiceTask2Raw,
              practiceNote: practiceNotes.join(" | "),
            };
          } else if (cand.fallbackRow) {
            const cell =
              (sess.lessonId ? cand.fallbackRow.cells[sess.lessonId] : undefined) ||
              Object.values(cand.fallbackRow.cells).find((c) => c.sessionNumber === sNum);
            const theoryRaw =
              cell && typeof cell.quizScore === "number" && Number.isFinite(cell.quizScore)
                ? safeRound2Val(cell.quizScore)
                : null;
            const practiceRaw =
              cell &&
              cell.status === "GRADED" &&
              typeof cell.score === "number" &&
              Number.isFinite(cell.score)
                ? safeRound2Val(cell.score)
                : null;

            btvnScores[sNum] = {
              sessionNumber: sNum,
              theoryRaw,
              theoryMax: cell?.maxScore || 100,
              theoryNote: "",
              practiceRaw,
              practiceMax: cell?.maxScore || 100,
              practiceTask1Raw:
                typeof cell?.practiceTask1Score === "number"
                  ? cell.practiceTask1Score
                  : practiceRaw,
              practiceTask2Raw:
                typeof cell?.practiceTask2Score === "number"
                  ? cell.practiceTask2Score
                  : null,
              practiceNote: stripHtmlTagsClean(cell?.teacherNote || ""),
            };
          }
        }
      }

      // Stage scores: CP1, CP2, Final DEMO
      const idsForSlotLookup = [
        cand.crmStudentId || "",
        cand.studentId || "",
        cand.studentUid || "",
      ].filter(Boolean);
      const normFullName = normalizeStudentNameKey(cand.fullName);

      const cp1Att = findAttendanceForStudent(cp1Slot, idsForSlotLookup, normFullName);
      const cp1SlotParsed = parseSlotCheckpointScores(cp1Att);
      const cp1Fallback =
        !isRobotics && cand.studentUid
          ? parseFallbackCheckpointFromSubmissions(cp1FallbackLessonId, cand.studentUid)
          : { theory: null, practice: null };

      const cp2Att = findAttendanceForStudent(cp2Slot, idsForSlotLookup, normFullName);
      const cp2SlotParsed = parseSlotCheckpointScores(cp2Att);
      const cp2Fallback =
        !isRobotics && cand.studentUid
          ? parseFallbackCheckpointFromSubmissions(cp2FallbackLessonId, cand.studentUid)
          : { theory: null, practice: null };

      const finalAtt = findAttendanceForStudent(finalSlot, idsForSlotLookup, normFullName);
      const finalSlotParsed = parseSlotFinalDemoScores(finalAtt);
      const s14Eval = findSession14EvalForStudent(cand);

      let finalProduct = finalSlotParsed.product;
      let finalCompetency = finalSlotParsed.competency;
      let finalNote = finalSlotParsed.note;

      if (s14Eval) {
        const hasEvaluatedS14 =
          (typeof s14Eval.demoTotalScore === "number" && s14Eval.demoTotalScore > 0) ||
          s14Eval.status === "APPROVED" ||
          s14Eval.status === "VERIFIED" ||
          Boolean(String(s14Eval.learnedFromMindx || "").trim());

        if (
          hasEvaluatedS14 &&
          typeof s14Eval.demoTotalScore === "number" &&
          Number.isFinite(s14Eval.demoTotalScore) &&
          s14Eval.demoTotalScore >= 0
        ) {
          finalProduct = safeRound2Val(Math.max(0, Math.min(5, s14Eval.demoTotalScore)));
        }
        if (
          hasEvaluatedS14 &&
          typeof s14Eval.competencyTotalScore === "number" &&
          Number.isFinite(s14Eval.competencyTotalScore) &&
          s14Eval.competencyTotalScore > 0
        ) {
          finalCompetency = safeRound2Val(
            Math.max(0, Math.min(5, s14Eval.competencyTotalScore))
          );
        }
        if (!finalNote && s14Eval.learnedFromMindx) {
          finalNote = stripHtmlTagsClean(s14Eval.learnedFromMindx);
        }
      }

      const stageScores: StudentStageRawScores = {
        cp1Theory: cp1SlotParsed.theory ?? cp1Fallback.theory,
        cp1Practice: cp1SlotParsed.practice ?? cp1Fallback.practice,
        cp1Competency: cp1SlotParsed.competency,
        cp1Note: cp1SlotParsed.note,
        cp2Theory: cp2SlotParsed.theory ?? cp2Fallback.theory,
        cp2Practice: cp2SlotParsed.practice ?? cp2Fallback.practice,
        cp2Competency: cp2SlotParsed.competency,
        cp2Note: cp2SlotParsed.note,
        finalProduct,
        finalCompetency,
        finalNote,
      };

      return {
        studentId: cand.studentId,
        studentUid: cand.studentUid,
        fullName: cand.fullName,
        isActive: cand.isActive,
        btvnScores,
        stageScores,
      };
    });

    return {
      classId: cleanClassId,
      classCode: cleanClassCode,
      lmsClassId: params.lmsClassId || (classByIdGql?.id ? String(classByIdGql.id).trim() : undefined),
      isRobotics,
      btvnSessions,
      students,
      scrapedAt,
    };
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
