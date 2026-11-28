/**
 * KIỂM THỬ TOÀN DIỆN CHẶNG 2 (GÓI C) — STREAMLINE CHẤM BÀI, PHIẾU ĐIỂM & DOCX
 *
 * Bao phủ đầy đủ S2-01 .. S2-05 + Kiểm tra hợp đồng UI & SSR/localStorage Hydration:
 * - [S2-01] `syncVerifiedCheckpointToReportCardSnapshot` + `overlayManualCheckpointFeedbacksOntoSnapshot`
 *           (Coding B5/B9, VEX B4/B8, LEGO B5/B9 -> cập nhật cp1Competency/cp2Competency,
 *            computeReportCardStaleness -> isStale:false, giữ nguyên APPROVED khi không đổi,
 *            end-to-end từ uploadSessionCommentsViaApi & CommentSaver.saveComments).
 * - [S2-02] Chấm riêng 1 học viên (`POST /api/homework-grader/download-and-grade` với `studentId`)
 *           chỉ tải/chấm đúng học viên đó, giữ nguyên APPROVED/VERIFIED của các bạn khác.
 * - [S2-03] Bộ đọc `.docx` an toàn (`parseDocxBufferSafely` + `parseSubmissionBuffer`/`parseSubmissionFile`)
 *           trích xuất sạch header/body/footer/entities và chặn zip-slip/bomb/rỗng chữ/hỏng.
 * - [S2-04] `POST /api/homework-grader/open-local-file` chặn non-localhost (403), ngoài `temp_submissions/` (403),
 *           path traversal / symlink-junction escape (403), trả `dryRun: true` khi `MINDX_OPEN_FILE_DRY_RUN=1`.
 * - [S2-05] `approveAll: true` vẫn từ chối `PARSE_ERROR`; duyệt đơn lẻ `manualTeacherGradeOnParseError: true`
 *           + điểm nguyên `0..100` + nhận xét `>= 10` ký tự chuyển `APPROVED` thành công (chặn thiếu điểm/lẻ/ngắn/REDO);
 *           `HomeworkGradeWorker` cho phép đẩy bản đã duyệt tay hợp lệ (vẫn chặn `PARSE_ERROR` chưa duyệt tay).
 * - [S2-UI] Hợp đồng UI (`checkpoint-grader-panel.tsx`, `homework-grader/page.tsx`, `teaching-report-card-view.tsx`)
 *           + Live Headless Chromium SSR hydration (`0` lỗi hydration/console/pageerror), `localStorage` persistence
 *           (`mindx_hw_ui_prefs_v1`), nút `📸 Ảnh BTVN` khi đóng `<details>`, và luồng nút Gói C.
 *
 * Chạy 100% cô lập trong `os.tmpdir()` (và dọn sạch tiền tố `TEST_S2_` trong `temp_submissions/`).
 */

import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { chromium } from "playwright";
import type { CompetencyScores } from "../src/lib/checkpoint/competency-specs";

const REAL_DATA_FILES = [
  path.resolve(process.cwd(), "data", "mindx_bot.db"),
  path.resolve(process.cwd(), "data", "running_classes.json"),
  path.resolve(process.cwd(), "data", "config", "lms_class_ids.json"),
  path.resolve(process.cwd(), "data", "config", "courses_syllabus.json"),
  path.resolve(process.cwd(), "data", "config", "quick_tags.json"),
];

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function makeFakeJwt(email: string): string {
  const h = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
  const p = Buffer.from(
    JSON.stringify({
      email,
      exp: Math.floor(Date.now() / 1000) + 7200,
      user_id: "uid_stage2_test",
    })
  ).toString("base64url");
  return `${h}.${p}.${crypto.randomBytes(8).toString("base64url")}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttpReady(url: string, timeoutMs = 90000): Promise<void> {
  const start = Date.now();
  let lastErr = "";
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastErr = `HTTP ${res.status}`;
    } catch (err: unknown) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await sleep(400);
  }
  throw new Error(`Hết thời gian chờ Next.js server tại ${url}: ${lastErr}`);
}

function killProcessTree(proc: ChildProcess | null) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { stdio: "ignore" });
    } else {
      proc.kill("SIGKILL");
    }
  } catch {}
}

function cleanupTempSubmissionsForPrefix(prefix: string) {
  const base = path.resolve(process.cwd(), "temp_submissions");
  if (!fs.existsSync(base)) return;
  for (const entry of fs.readdirSync(base)) {
    if (entry.toUpperCase().startsWith(prefix.toUpperCase())) {
      try {
        fs.rmSync(path.join(base, entry), { recursive: true, force: true });
      } catch {}
    }
  }
}

async function main() {
  const baselineHashes = REAL_DATA_FILES.map((fp) => ({
    path: fp,
    sha256: sha256File(fp),
  }));

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-stage2-"));
  const tmpConfigDir = path.join(tmpRoot, "config");
  const tmpTokenDir = path.join(tmpRoot, "tokens");
  const tmpRoleStateDir = path.join(tmpRoot, "role-state");
  const tmpDbPath = path.join(tmpRoot, "mindx_stage2.db");
  const tmpRunningClassesPath = path.join(tmpRoot, "running_classes.json");
  const tmpLmsClassIdsPath = path.join(tmpConfigDir, "lms_class_ids.json");
  fs.mkdirSync(tmpConfigDir, { recursive: true });
  fs.mkdirSync(tmpTokenDir, { recursive: true });
  fs.mkdirSync(tmpRoleStateDir, { recursive: true });

  const realConfigDir = path.join(process.cwd(), "data", "config");
  for (const cfgFile of ["courses_syllabus.json", "quick_tags.json", "grading_rubrics.json"]) {
    const srcPath = path.join(realConfigDir, cfgFile);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, path.join(tmpConfigDir, cfgFile));
    }
  }
  const realDatasetDir = path.join(realConfigDir, "checkpoint-datasets", "CSA_SESSION_05");
  if (fs.existsSync(realDatasetDir)) {
    const dstDatasetDir = path.join(tmpConfigDir, "checkpoint-datasets", "CSA_SESSION_05");
    fs.mkdirSync(dstDatasetDir, { recursive: true });
    for (const f of fs.readdirSync(realDatasetDir)) {
      fs.copyFileSync(path.join(realDatasetDir, f), path.join(dstDatasetDir, f));
    }
  }

  fs.writeFileSync(
    path.join(tmpTokenDir, "lms_token_teacher.json"),
    JSON.stringify({
      role: "TEACHER",
      username: "teacher.stage2@mindx.net.vn",
      email: "teacher.stage2@mindx.net.vn",
      userId: "uid_teacher_stage2",
      firebaseApiKey: "AIzaDummyApiKeyStage2",
      idToken: makeFakeJwt("teacher.stage2@mindx.net.vn"),
      refreshToken: "refresh_teacher_stage2",
      expiresAtMs: Date.now() + 3600_000,
      updatedAt: new Date().toISOString(),
    }),
    "utf8"
  );

  (process.env as Record<string, string | undefined>).NODE_ENV = "test";
  process.env.MINDX_DB_PATH = tmpDbPath;
  process.env.MINDX_CONFIG_DIR = tmpConfigDir;
  process.env.MINDX_RUNNING_CLASSES_PATH = tmpRunningClassesPath;
  process.env.MINDX_LMS_CLASS_IDS_PATH = tmpLmsClassIdsPath;
  process.env.MINDX_ROLE_STATE_DIR = tmpRoleStateDir;
  process.env.MINDX_LMS_TOKEN_DIR = tmpTokenDir;
  process.env.ALLOWED_LOCAL_DIRS = tmpRoot;
  process.env.MINDX_ALLOWED_EXTRA_PATHS = tmpRoot;
  process.env.MINDX_ALLOW_TEST_HOSTS = "1";
  process.env.MINDX_OPEN_FILE_DRY_RUN = "1";
  process.env.MINDX_LMS_API_READ = "true";
  process.env.MINDX_LMS_API_WRITE = "true";
  process.env.LMS_USERNAME = "teacher.stage2@mindx.net.vn";
  process.env.LMS_PASSWORD = "TeacherDummySecret#Stage2";
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "TEST_STAGE2_DUMMY_KEY";

  const {
    calculateSha256,
    classSessionRepo,
    closeDb,
    computeHomeworkContentHash,
    homeworkSubmissionRepo,
    isLegoRoboticsClassCode,
    isRoboticsClassCode,
    parseReportCardLmsSnapshot,
    reportCardRepo,
    scoreMatrixRepo,
    sessionFeedbackRepo,
    studentRepo,
    syncVerifiedCheckpointToReportCardSnapshot,
    verifyHomeworkContentIntegrity,
  } = await import("../src/lib/db/sqlite");
  const { saveRunningClasses } = await import("../src/lib/db/json-config");
  const { computeReportCardStaleness } = await import(
    "../src/lib/report-card/report-card-staleness"
  );
  const {
    COMPETENCY_AREA_SPECS,
    LEGO_COMPETENCY_AREA_SPECS,
    calculateCompetencyAverageForClassPure,
  } = await import("../src/lib/checkpoint/competency-specs");
  const { uploadSessionCommentsViaApi } = await import("../src/lib/lms/lms-write-client");
  const { CommentSaver } = await import("../src/lib/playwright/save-comments");
  const { parseDocxBufferSafely } = await import("../src/lib/file-parsers/archive-reader");
  const { parseSubmissionBuffer, parseSubmissionFile } = await import("../src/lib/file-parsers");
  const { POST: openLocalFilePOST } = await import(
    "../src/app/api/homework-grader/open-local-file/route"
  );
  const { POST: downloadAndGradePOST } = await import(
    "../src/app/api/homework-grader/download-and-grade/route"
  );
  const { POST: approveHomeworkPOST } = await import(
    "../src/app/api/homework-grader/approve/route"
  );
  const { HomeworkGradeWorker } = await import("../src/lib/playwright/grade-worker");
  const { BrowserManager } = await import("../src/lib/playwright/browser-manager");
  const { authService } = await import("../src/lib/playwright/auth");
  const { LmsHelpers } = await import("../src/lib/playwright/lms-helpers");

  const bm = BrowserManager.getInstance() as any;
  const origGetPage = bm.getPage.bind(bm);
  const origEnsureAuth = authService.ensureAuthenticated.bind(authService);
  const origOpenDrawer = LmsHelpers.openClassDrawer.bind(LmsHelpers);
  const origSwitchTab = LmsHelpers.switchDrawerTab.bind(LmsHelpers);
  const origGlobalFetch = globalThis.fetch;

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let nextServer: ChildProcess | null = null;
  const e2ePort = 3093;
  const e2eDistRel = `.next/e2e-test-${e2ePort}`;
  const e2eDistAbs = path.join(process.cwd(), e2eDistRel);
  const e2eTsconfigRel = `.next/e2e-tsconfig-${e2ePort}.json`;
  const e2eTsconfigAbs = path.join(process.cwd(), e2eTsconfigRel);
  const nextEnvPath = path.join(process.cwd(), "next-env.d.ts");
  const origNextEnvDts = fs.existsSync(nextEnvPath) ? fs.readFileSync(nextEnvPath) : null;

  try {
    console.log("=== BẮT ĐẦU KIỂM THỬ CHẶNG 2 (S2-01 .. S2-05 & UI HYDRATION) TRONG TEMP ===");

    // =========================================================================
    // [S2-01] Auto-flow Checkpoint [ĐNL] -> class_report_cards (Coding/VEX/LEGO)
    // =========================================================================
    console.log("\n[S2-01] Kiểm tra tự chảy cp1Competency/cp2Competency sang Phiếu điểm & bảo vệ APPROVED...");
    {
      const codingClass = "VT-CSA04-S2";
      const vexClass = "VT-ROB-ARMA13";
      const legoClass = "VT-KIND-ROB4I01";

      assert.equal(isRoboticsClassCode(vexClass), true);
      assert.equal(isLegoRoboticsClassCode(vexClass), false);
      assert.equal(isRoboticsClassCode(legoClass), true);
      assert.equal(isLegoRoboticsClassCode(legoClass), true);

      const mockClasses: Record<string, any> = {};
      const gqlServer = http.createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        const op = String(parsed.operationName || "");
        const vars = parsed.variables || {};
        if (op === "GetClassWriteContext" || op === "GetClassByIdSafe" || op === "GetClassById") {
          const cls = mockClasses[String(vars.id || "")];
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ data: { classesById: cls || null } }));
          return;
        }
        if (op === "UpdateSlotComment") {
          const payload = vars.payload || {};
          const cls = mockClasses[String(payload.classId || "")];
          const sc = payload.studentComment;
          const targetSlot = cls
            ? (cls.slots || []).find((s: any) => String(s._id) === String(payload.slotId))
            : null;
          const att = (targetSlot?.studentAttendance || []).find(
            (a: any) => String(a._id) === String(sc?.studentAttendanceId)
          );
          if (att && sc) {
            att.comment = String(sc.content || "");
            att.commentByAreas = Array.isArray(sc.byAreas) ? sc.byAreas : [];
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ data: { classes: { updateSlotComment: cls || { id: payload.classId } } } }));
          return;
        }
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ errors: [{ message: `Unexpected ${op}` }] }));
      });
      await new Promise<void>((resolve) => gqlServer.listen(0, "127.0.0.1", resolve));
      const gqlEndpoint = `http://127.0.0.1:${(gqlServer.address() as { port: number }).port}/graphql`;

      try {
        const seedCheckpointClass = (params: {
          classId: string;
          lmsId: string;
          studentId: string;
          fullName: string;
          isRobotics: boolean;
          isLego: boolean;
          cp1Sess: number;
          cp2Sess: number;
          compScores: CompetencyScores;
          theory: number | null;
          practice: number | null;
        }) => {
          studentRepo.upsert({
            studentId: params.studentId,
            classId: params.classId,
            fullName: params.fullName,
            isActive: 1,
          });
          for (const sNum of [params.cp1Sess, params.cp2Sess]) {
            classSessionRepo.upsert({
              classId: params.classId,
              className: params.classId,
              sessionId: `${params.classId}_SESS_${String(sNum).padStart(2, "0")}`,
              sessionNumber: sNum,
              topic: `Checkpoint ${sNum}`,
              date: "2026-11-22",
            });
          }
          reportCardRepo.saveLmsSnapshot(params.classId, {
            classId: params.classId,
            classCode: params.classId,
            isRobotics: params.isRobotics,
            scrapedAt: "2026-11-22T01:00:00.000Z",
            btvnSessions: [],
            students: [
              {
                studentId: params.studentId,
                fullName: params.fullName,
                isActive: true,
                btvnScores: {},
                stageScores: {
                  cp1Theory: params.theory,
                  cp1Practice: params.practice,
                  cp1Competency: null,
                  cp2Theory: params.theory,
                  cp2Practice: params.practice,
                  cp2Competency: null,
                  finalProduct: null,
                  finalCompetency: null,
                },
              },
            ],
          });

          const specs = params.isLego ? LEGO_COMPETENCY_AREA_SPECS : COMPETENCY_AREA_SPECS;
          const makeAttsForSession = () => [
            {
              _id: `att_${params.studentId}`,
              status: "ATTENDED",
              comment: ".",
              student: { id: params.studentId, fullName: params.fullName },
              commentByAreas: [
                ...specs.map((s) => ({ commentAreaId: s.commentAreaId, type: "RATE", grade: 0, content: "" })),
                { commentAreaId: `gen_${params.studentId}`, type: "CONTENT", grade: 0, content: "<p>.</p>" },
              ],
            },
          ];

          mockClasses[params.lmsId] = {
            id: params.lmsId,
            name: params.classId,
            centre: { id: "ctr_s2" },
            course: { id: `c_${params.classId}`, name: params.isLego ? "Robotics 4+ Intensive" : params.classId },
            courseProcesses: [
              {
                id: `proc_${params.classId}`,
                checkpointEvaluations: [
                  {
                    id: `ce_${params.classId}`,
                    title: "Đánh giá năng lực",
                    commentAreas: [
                      ...specs.map((s) => ({ id: s.commentAreaId, name: s.labelVi, type: "RATE" })),
                      { id: `gen_${params.studentId}`, name: "Đánh giá chung", type: "CONTENT" },
                    ],
                  },
                ],
              },
            ],
            students: [{ activeInClass: true, student: { id: params.studentId, fullName: params.fullName } }],
            slots: Array.from({ length: 14 }, (_, idx) => ({
              _id: `slot_${params.lmsId}_${idx + 1}`,
              index: idx,
              studentAttendance:
                idx + 1 === params.cp1Sess || idx + 1 === params.cp2Sess ? makeAttsForSession() : [],
            })),
          };
        };

        const cp9ScoresA: CompetencyScores = {
          knowledgeSelfStudy: 5,
          knowledgeInClass: 4,
          skillCommunication: 5,
          skillComputerUse: 4,
          skillProblemSolving: 5,
          skillCreativity: 4,
          skillComputational: 5,
          attitudeHomework: 4,
          attitudeInClass: 5,
        }; // avg / 9 = 4.56
        const cp9ScoresB: CompetencyScores = {
          knowledgeSelfStudy: 4,
          knowledgeInClass: 4,
          skillCommunication: 4,
          skillComputerUse: 5,
          skillProblemSolving: 4,
          skillCreativity: 4,
          skillComputational: 5,
          attitudeHomework: 4,
          attitudeInClass: 4,
        }; // 38/9 = 4.22
        const lego7Scores: CompetencyScores = {
          knowledgeSelfStudy: 1,
          knowledgeInClass: 5,
          skillCommunication: 5,
          skillComputerUse: 4,
          skillProblemSolving: 5,
          skillCreativity: 5,
          skillComputational: 4,
          attitudeHomework: 1,
          attitudeInClass: 5,
        }; // 33/7 = 4.71

        seedCheckpointClass({
          classId: codingClass,
          lmsId: "lms_coding_s2",
          studentId: "S2_COD_1",
          fullName: "Nguyễn Hải Đăng",
          isRobotics: false,
          isLego: false,
          cp1Sess: 5,
          cp2Sess: 9,
          compScores: cp9ScoresA,
          theory: 4.5,
          practice: 4.0,
        });
        seedCheckpointClass({
          classId: vexClass,
          lmsId: "lms_vex_s2",
          studentId: "S2_VEX_1",
          fullName: "Trần Bảo Long",
          isRobotics: true,
          isLego: false,
          cp1Sess: 4,
          cp2Sess: 8,
          compScores: cp9ScoresB,
          theory: 4.0,
          practice: 4.5,
        });
        seedCheckpointClass({
          classId: legoClass,
          lmsId: "lms_lego_s2",
          studentId: "S2_LEGO_1",
          fullName: "Mai Nhật Minh",
          isRobotics: true,
          isLego: true,
          cp1Sess: 5,
          cp2Sess: 9,
          compScores: lego7Scores,
          theory: null,
          practice: null,
        });

        const seedApprovedCpFeedback = (
          classId: string,
          sessNum: number,
          studentId: string,
          cpStage: 1 | 2,
          isRobotics: boolean,
          isLego: boolean,
          theoryScore: number | null,
          practiceScore: number | null,
          competencyScores: CompetencyScores
        ) => {
          const avg = calculateCompetencyAverageForClassPure(competencyScores, classId);
          const text = isLego
            ? `📊 **Kết quả Checkpoint ${cpStage}:** Điểm năng lực **${avg.toFixed(2)}/5.0**\n- **Điểm mạnh của học viên:** Lắp ráp mô hình chuẩn.\n- **Điểm cần cải thiện:** Giữ gọn bàn.\n- **Lời khuyên:** Phát huy.`
            : `📊 **Kết quả Checkpoint ${cpStage}:** Lý thuyết **${(theoryScore ?? 0).toFixed(1)}/5.0** | Thực hành **${(practiceScore ?? 0).toFixed(1)}/5.0** | Điểm năng lực **${avg.toFixed(2)}/5.0**\n- **Điểm mạnh của học viên:** Nắm chắc kiến thức.\n- **Điểm cần cải thiện:** Kiểm tra biên.\n- **Lời khuyên:** Tiếp tục cố gắng.`;
          sessionFeedbackRepo.upsert({
            classId,
            sessionId: `${classId}_SESS_0${sessNum}`,
            studentId,
            attendanceStatus: "PRESENT",
            finalText: text,
            contentHash: calculateSha256(text),
            status: "APPROVED",
            checkpointDataJson: JSON.stringify({
              cpStage,
              isRobotics,
              isLego,
              theoryScore,
              practiceScore,
              competencyScores,
              competencyAverage: avg,
            }),
          });
          return avg;
        };

        // 1) Coding CP1 (B5) via uploadSessionCommentsViaApi & CP2 (B9) via CommentSaver.saveComments
        const codAvg1 = seedApprovedCpFeedback(codingClass, 5, "S2_COD_1", 1, false, false, 4.5, 4.0, cp9ScoresA);
        const codRes1 = await uploadSessionCommentsViaApi({
          classId: codingClass,
          classCode: codingClass,
          sessionId: `${codingClass}_SESS_05`,
          lmsClassIdOverride: "lms_coding_s2",
          graphqlEndpoint: gqlEndpoint,
          preferApiWrite: true,
        });
        assert.equal(codRes1.verifiedCount, 1);

        const codRc1 = reportCardRepo.findOne(codingClass)!;
        const codSnap1 = parseReportCardLmsSnapshot(codRc1.lmsSnapshotJson, codingClass)!;
        assert.equal(codSnap1.students[0].stageScores.cp1Competency, codAvg1);
        assert.equal(
          computeReportCardStaleness(codingClass, codSnap1, { currentSessionNumber: 5 }).isStale,
          false,
          "Coding B5 sau khi đẩy phải đồng bộ cp1Competency và isStale: false"
        );

        // Approve report card and verify idempotent re-sync does NOT demote APPROVED
        const codApp = reportCardRepo.approveReportCard(codingClass, codRc1.draftVersion);
        assert.equal(codApp.success, true);
        const codChanged = syncVerifiedCheckpointToReportCardSnapshot(codingClass);
        assert.equal(codChanged, false, "Điểm không đổi phải trả false và không chạm DB");
        const codRcAfterNoop = reportCardRepo.findOne(codingClass)!;
        assert.equal(codRcAfterNoop.status, "APPROVED");
        assert.equal(codRcAfterNoop.draftVersion, codApp.record.draftVersion);

        // Coding B9 via CommentSaver.saveComments entry point
        const codAvg2 = seedApprovedCpFeedback(codingClass, 9, "S2_COD_1", 2, false, false, 4.5, 4.0, cp9ScoresB);
        const codRes2 = await CommentSaver.saveComments({
          classId: codingClass,
          classCode: codingClass,
          sessionId: `${codingClass}_SESS_09`,
          lmsClassIdOverride: "lms_coding_s2",
          graphqlEndpoint: gqlEndpoint,
          preferApiWrite: true,
        });
        assert.equal(codRes2.verifiedCount, 1);
        const codSnap2 = parseReportCardLmsSnapshot(
          reportCardRepo.findOne(codingClass)!.lmsSnapshotJson,
          codingClass
        )!;
        assert.equal(codSnap2.students[0].stageScores.cp2Competency, codAvg2);
        assert.equal(
          computeReportCardStaleness(codingClass, codSnap2, { currentSessionNumber: 9 }).isStale,
          false
        );

        // 2) VEX B4 & B8
        const vexAvg1 = seedApprovedCpFeedback(vexClass, 4, "S2_VEX_1", 1, true, false, 4.0, 4.5, cp9ScoresB);
        const vexAvg2 = seedApprovedCpFeedback(vexClass, 8, "S2_VEX_1", 2, true, false, 4.0, 4.5, cp9ScoresA);
        const vexRes1 = await uploadSessionCommentsViaApi({
          classId: vexClass,
          classCode: vexClass,
          sessionId: `${vexClass}_SESS_04`,
          lmsClassIdOverride: "lms_vex_s2",
          graphqlEndpoint: gqlEndpoint,
          preferApiWrite: true,
        });
        const vexRes2 = await uploadSessionCommentsViaApi({
          classId: vexClass,
          classCode: vexClass,
          sessionId: `${vexClass}_SESS_08`,
          lmsClassIdOverride: "lms_vex_s2",
          graphqlEndpoint: gqlEndpoint,
          preferApiWrite: true,
        });
        assert.equal(vexRes1.verifiedCount, 1);
        assert.equal(vexRes2.verifiedCount, 1);
        const vexSnap = parseReportCardLmsSnapshot(
          reportCardRepo.findOne(vexClass)!.lmsSnapshotJson,
          vexClass
        )!;
        assert.equal(vexSnap.students[0].stageScores.cp1Competency, vexAvg1);
        assert.equal(vexSnap.students[0].stageScores.cp2Competency, vexAvg2);
        assert.equal(
          computeReportCardStaleness(vexClass, vexSnap, { currentSessionNumber: 8 }).isStale,
          false
        );

        // 3) LEGO B5 & B9 (7 stars / 7, null LT/TH)
        const preLegoSnap = parseReportCardLmsSnapshot(
          reportCardRepo.findOne(legoClass)!.lmsSnapshotJson,
          legoClass
        )!;
        assert.equal(
          computeReportCardStaleness(legoClass, preLegoSnap, { currentSessionNumber: 5 }).missingCp1,
          true,
          "Trước khi đẩy B5 LEGO, cp1Competency=null phải báo missingCp1=true"
        );
        const legoAvg1 = seedApprovedCpFeedback(legoClass, 5, "S2_LEGO_1", 1, true, true, null, null, lego7Scores);
        assert.equal(legoAvg1, 4.71);
        const legoRes1 = await uploadSessionCommentsViaApi({
          classId: legoClass,
          classCode: legoClass,
          sessionId: `${legoClass}_SESS_05`,
          lmsClassIdOverride: "lms_lego_s2",
          graphqlEndpoint: gqlEndpoint,
          preferApiWrite: true,
        });
        assert.equal(legoRes1.verifiedCount, 1);

        const legoRc1 = reportCardRepo.findOne(legoClass)!;
        const legoSnap1 = parseReportCardLmsSnapshot(legoRc1.lmsSnapshotJson, legoClass)!;
        assert.equal(legoSnap1.students[0].stageScores.cp1Competency, 4.71);
        assert.equal(legoSnap1.students[0].stageScores.cp1Theory, null);
        assert.equal(legoSnap1.students[0].stageScores.cp1Practice, null);
        const legoStale1 = computeReportCardStaleness(legoClass, legoSnap1, { currentSessionNumber: 5 });
        assert.equal(legoStale1.missingCp1, false);
        assert.equal(legoStale1.isStale, false);

        const legoApp = reportCardRepo.approveReportCard(legoClass, legoRc1.draftVersion);
        assert.equal(legoApp.success, true);
        assert.equal(syncVerifiedCheckpointToReportCardSnapshot(legoClass), false);
        assert.equal(reportCardRepo.findOne(legoClass)!.status, "APPROVED");

        const legoAvg2 = seedApprovedCpFeedback(legoClass, 9, "S2_LEGO_1", 2, true, true, null, null, lego7Scores);
        const legoRes2 = await uploadSessionCommentsViaApi({
          classId: legoClass,
          classCode: legoClass,
          sessionId: `${legoClass}_SESS_09`,
          lmsClassIdOverride: "lms_lego_s2",
          graphqlEndpoint: gqlEndpoint,
          preferApiWrite: true,
        });
        assert.equal(legoRes2.verifiedCount, 1);
        const legoSnap2 = parseReportCardLmsSnapshot(
          reportCardRepo.findOne(legoClass)!.lmsSnapshotJson,
          legoClass
        )!;
        assert.equal(legoSnap2.students[0].stageScores.cp2Competency, legoAvg2);
        const legoStale2 = computeReportCardStaleness(legoClass, legoSnap2, { currentSessionNumber: 9 });
        assert.equal(legoStale2.missingCp2, false);
        assert.equal(legoStale2.isStale, false);

        // [S2-F02 Regression] Previously VERIFIED student edited back to DRAFT must NOT leak draft competencyAverage over lmsCompetencyScores
        const codApprovePreF02 = reportCardRepo.approveReportCard(
          codingClass,
          reportCardRepo.findOne(codingClass)!.draftVersion
        );
        assert.equal(codApprovePreF02.success, true);
        const codRcPreF02 = reportCardRepo.findOne(codingClass)!;
        const codFbB5 = sessionFeedbackRepo.findOne(
          codingClass,
          `${codingClass}_SESS_05`,
          "S2_COD_1"
        )!;
        assert.ok(codFbB5, "S2-F02: Coding B5 feedback record must exist");
        const parsedFbB5 = JSON.parse(codFbB5.checkpointDataJson || "{}");
        const draftAll5Scores: CompetencyScores = {
          knowledgeSelfStudy: 5,
          knowledgeInClass: 5,
          skillCommunication: 5,
          skillComputerUse: 5,
          skillProblemSolving: 5,
          skillCreativity: 5,
          skillComputational: 5,
          attitudeHomework: 5,
          attitudeInClass: 5,
        };
        sessionFeedbackRepo.upsert({
          ...codFbB5,
          status: "DRAFT",
          checkpointDataJson: JSON.stringify({
            ...parsedFbB5,
            lmsCompetencyScores: parsedFbB5.lmsCompetencyScores || cp9ScoresA,
            competencyScores: draftAll5Scores,
            competencyAverage: 5,
            userEditedCompetency: true,
          }),
        });
        assert.equal(
          syncVerifiedCheckpointToReportCardSnapshot(codingClass),
          false,
          "S2-F02: DRAFT competency edit after VERIFIED must NOT change APPROVED report card"
        );
        const codRcPostF02 = reportCardRepo.findOne(codingClass)!;
        assert.equal(codRcPostF02.status, "APPROVED");
        assert.equal(codRcPostF02.contentHash, codRcPreF02.contentHash);
        const codSnapPostF02 = parseReportCardLmsSnapshot(codRcPostF02.lmsSnapshotJson, codingClass)!;
        assert.equal(
          codSnapPostF02.students[0].stageScores.cp1Competency,
          codAvg1,
          "S2-F02: cp1Competency must preserve verified 4.56 instead of leaking DRAFT 5.00"
        );

        console.log("  -> PASS S2-01.");
      } finally {
        await new Promise<void>((resolve) => gqlServer.close(() => resolve()));
      }
    }

    // =========================================================================
    // [S2-02] Single-student grading (`studentId`) preserves others
    // =========================================================================
    console.log("\n[S2-02] Kiểm tra chấm riêng 1 học viên không đụng chạm bài đã duyệt/đã lưu LMS của bạn khác...");
    {
      const s2Class = "TEST_S2_SINGLE";
      const s2Sess = `${s2Class}_SESS_05`;
      const s2Lesson = "L_CP1_SINGLE";

      studentRepo.upsert({ classId: s2Class, studentId: "STU_A", fullName: "Nguyễn Văn An", isActive: 1 });
      studentRepo.upsert({ classId: s2Class, studentId: "STU_B", fullName: "Trần Thị Bình", isActive: 1 });
      studentRepo.upsert({ classId: s2Class, studentId: "STU_C", fullName: "Lê Hoàng Cường", isActive: 1 });

      const recA: any = {
        classId: s2Class,
        sessionId: s2Sess,
        studentId: "STU_A",
        submissionId: "SUB_S2_A",
        originalFileName: "an.py",
        localFilePath: "",
        fileHash: "hash_a_ok",
        parseStatus: "PARSED",
        parseErrorReason: null,
        criteriaGradesJson: JSON.stringify([
          { criterionId: "C1", criterionName: "C1", earnedPoints: 45, maxPoints: 50, evidenceSnippet: "a", deductionReason: "ok" },
          { criterionId: "C2", criterionName: "C2", earnedPoints: 45, maxPoints: 50, evidenceSnippet: "b", deductionReason: "ok" },
        ]),
        calculatedScore: 90,
        teacherOverrideScore: null,
        decision: "GRADE",
        feedbackHtml: "<p>Bài làm của An đã được duyệt trước đó.</p>",
        contentHash: "",
        status: "APPROVED",
        verifiedAt: null,
        errorMessage: null,
      };
      recA.contentHash = computeHomeworkContentHash(recA);
      homeworkSubmissionRepo.upsert(recA);

      const recB: any = {
        classId: s2Class,
        sessionId: s2Sess,
        studentId: "STU_B",
        submissionId: "SUB_S2_B",
        originalFileName: "binh.py",
        localFilePath: "",
        fileHash: "hash_b_ok",
        parseStatus: "PARSED",
        parseErrorReason: null,
        criteriaGradesJson: JSON.stringify([
          { criterionId: "C1", criterionName: "C1", earnedPoints: 40, maxPoints: 50, evidenceSnippet: "a", deductionReason: "ok" },
          { criterionId: "C2", criterionName: "C2", earnedPoints: 45, maxPoints: 50, evidenceSnippet: "b", deductionReason: "ok" },
        ]),
        calculatedScore: 85,
        teacherOverrideScore: null,
        decision: "GRADE",
        feedbackHtml: "<p>Bài làm của Bình đã lưu LMS.</p>",
        contentHash: "",
        status: "VERIFIED",
        verifiedAt: "2026-11-27T10:00:00.000Z",
        errorMessage: null,
      };
      recB.contentHash = computeHomeworkContentHash(recB);
      homeworkSubmissionRepo.upsert(recB);

      scoreMatrixRepo.save(s2Class, {
        success: true,
        classId: s2Class,
        classCode: s2Class,
        lmsClassId: "683e88a68cc94584eaee6b22",
        scrapedAt: new Date().toISOString(),
        summary: {
          totalStudents: 3,
          totalColumns: 1,
          gradedCells: 0,
          submittedUngradedCells: 3,
          notSubmittedCells: 0,
          redoCells: 0,
          zeroScoreCells: 0,
        },
        columns: [
          {
            colIndex: 0,
            columnId: s2Lesson,
            lessonId: s2Lesson,
            title: "Bài kiểm tra định kỳ lần 1 - CP1",
            sessionNumber: 5,
            lessonType: "CHECKPOINT",
          },
        ],
        rows: [
          {
            studentId: "STU_A",
            studentUid: "UID_A",
            fullName: "Nguyễn Văn An",
            isActive: true,
            averageScore: null,
            gradedCount: 0,
            submittedUngradedCount: 1,
            notSubmittedCount: 0,
            redoCount: 0,
            cells: {
              [s2Lesson]: {
                columnId: s2Lesson,
                lessonId: s2Lesson,
                sessionNumber: 5,
                status: "SUBMITTED_UNGRADED",
                score: null,
                quizScore: 90,
                maxScore: 100,
                submissionId: "SUB_S2_A",
                attachments: ["lms/an.py"],
                rawText: "Submitted(1/1)",
              },
            },
          },
          {
            studentId: "STU_B",
            studentUid: "UID_B",
            fullName: "Trần Thị Bình",
            isActive: true,
            averageScore: null,
            gradedCount: 0,
            submittedUngradedCount: 1,
            notSubmittedCount: 0,
            redoCount: 0,
            cells: {
              [s2Lesson]: {
                columnId: s2Lesson,
                lessonId: s2Lesson,
                sessionNumber: 5,
                status: "SUBMITTED_UNGRADED",
                score: null,
                quizScore: 85,
                maxScore: 100,
                submissionId: "SUB_S2_B",
                attachments: ["lms/binh.py"],
                rawText: "Submitted(1/1)",
              },
            },
          },
          {
            studentId: "STU_C",
            studentUid: "UID_C",
            fullName: "Lê Hoàng Cường",
            isActive: true,
            averageScore: null,
            gradedCount: 0,
            submittedUngradedCount: 1,
            notSubmittedCount: 0,
            redoCount: 0,
            cells: {
              [s2Lesson]: {
                columnId: s2Lesson,
                lessonId: s2Lesson,
                sessionNumber: 5,
                status: "SUBMITTED_UNGRADED",
                score: null,
                quizScore: 80,
                maxScore: 100,
                submissionId: "SUB_S2_C",
                attachments: ["lms/cuong_late.py"],
                rawText: "Submitted(1/1)",
              },
            },
          },
        ],
      });

      let geminiCalls = 0;
      const downloadedUrls: string[] = [];
      globalThis.fetch = (async (input: any) => {
        const u = String(input?.url || input);
        if (u.includes("resources.mindx.edu.vn/api/v1/get-presigned-url")) {
          const key = new URL(u).searchParams.get("key") || "";
          downloadedUrls.push(key);
          return new Response(
            JSON.stringify({
              success: true,
              url: `https://s3-mock.mindx.local/dl/${encodeURIComponent(key)}`,
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (u.startsWith("https://s3-mock.mindx.local/dl/")) {
          return new Response("print('Late CP1 solution by STUDENT_01')\n", { status: 200 });
        }
        if (u.includes("generativelanguage.googleapis.com")) {
          geminiCalls++;
          const aiPayload = {
            criteriaGrades: [
              {
                criterionId: "C1",
                criterionName: "C1",
                earnedPoints: 46,
                maxPoints: 50,
                evidenceSnippet: "print('Late CP1 solution')",
                deductionReason: "Tốt",
              },
              {
                criterionId: "C2",
                criterionName: "C2",
                earnedPoints: 44,
                maxPoints: 50,
                evidenceSnippet: "print()",
                deductionReason: "Khá",
              },
            ],
            decision: "GRADE",
            feedbackHtml: "<p>Bài nộp bù của con đạt yêu cầu tốt.</p>",
          };
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: { parts: [{ text: JSON.stringify(aiPayload) }], role: "model" },
                  finishReason: "STOP",
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return origGlobalFetch(input as any);
      }) as typeof globalThis.fetch;

      const rubricS2 = {
        rubricId: "TEST_S2_CP1",
        courseCode: "CSA",
        sessionNumber: 5,
        assignmentTitle: "CP1 Test",
        assignmentPrompt: "Write python",
        maxTotalScore: 100,
        criteria: [
          { criterionId: "C1", name: "C1", maxPoints: 50, description: "d1", expectedSnippetOrConcept: "print" },
          { criterionId: "C2", name: "C2", maxPoints: 50, description: "d2", expectedSnippetOrConcept: "print" },
        ],
      };

      const { ScoreScraper } = await import("../src/lib/playwright/scrape-scores");
      const origScrapeScores = ScoreScraper.scrapeClassScores.bind(ScoreScraper);
      (ScoreScraper as any).scrapeClassScores = async () => scoreMatrixRepo.findByClass(s2Class)!.matrix;

      try {
        const resSingle = await downloadAndGradePOST(
          new Request("http://127.0.0.1:3000/api/homework-grader/download-and-grade", {
            method: "POST",
            headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
            body: JSON.stringify({
              classId: s2Class,
              classCode: s2Class,
              sessionId: s2Sess,
              lessonId: s2Lesson,
              studentId: "STU_C",
              rubric: rubricS2,
            }),
          })
        );
        assert.equal(resSingle.status, 200);
        const jsonSingle = await resSingle.json();
        assert.equal(jsonSingle.success, true);
        assert.equal(jsonSingle.data.downloadResult.downloadedCount, 1);
        assert.equal(jsonSingle.data.downloadResult.items[0].studentId, "STU_C");
        assert.equal(jsonSingle.data.gradeResults.length, 1);
        assert.equal(jsonSingle.data.gradeResults[0].studentId, "STU_C");
        assert.equal(geminiCalls, 1, "Chỉ gọi AI chấm đúng 1 học viên STU_C");
        assert.deepEqual(downloadedUrls, ["lms/cuong_late.py"]);

        const afterA = homeworkSubmissionRepo.findBySubmissionId("SUB_S2_A")!;
        const afterB = homeworkSubmissionRepo.findBySubmissionId("SUB_S2_B")!;
        const afterC = homeworkSubmissionRepo.findBySubmissionId("SUB_S2_C")!;
        assert.equal(afterA.status, "APPROVED");
        assert.equal(afterA.contentHash, recA.contentHash);
        assert.equal(afterB.status, "VERIFIED");
        assert.equal(afterB.contentHash, recB.contentHash);
        assert.equal(afterC.status, "WAITING_APPROVAL");
        assert.equal(afterC.calculatedScore, 90);
      } finally {
        (ScoreScraper as any).scrapeClassScores = origScrapeScores;
        globalThis.fetch = origGlobalFetch;
      }
      console.log("  -> PASS S2-02.");
    }

    // =========================================================================
    // [S2-03] Safe .docx OOXML Parser & Security Guards
    // =========================================================================
    console.log("\n[S2-03] Kiểm tra bộ đọc .docx (OOXML entities, header/footer, zip-slip, zip-bomb, rỗng chữ)...");
    {
      const validDocxZip = new AdmZip();
      validDocxZip.addFile(
        "word/header1.xml",
        Buffer.from(
          `<w:hdr><w:p><w:r><w:t>Phiếu Bài Tập Python</w:t></w:r></w:p></w:hdr>`,
          "utf8"
        )
      );
      validDocxZip.addFile(
        "word/document.xml",
        Buffer.from(
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
           <w:document><w:body>
             <w:p><w:r><w:t>Câu 1:</w:t><w:tab/><w:t xml:space="preserve">x &lt; 10 &amp; y &gt; 5 &quot;ok&quot; &apos;py&apos; &#65;&#x42;</w:t><w:br/><w:t>Dòng 2</w:t></w:r></w:p>
           </w:body></w:document>`,
          "utf8"
        )
      );
      validDocxZip.addFile(
        "word/footer1.xml",
        Buffer.from(`<w:ftr><w:p><w:r><w:t>Trang 1</w:t></w:r></w:p></w:ftr>`, "utf8")
      );
      const docxBuf = validDocxZip.toBuffer();

      const directDocx = parseDocxBufferSafely(docxBuf, "baitap.docx");
      assert.equal(directDocx.success, true);
      assert.ok(directDocx.extractedText.includes("Phiếu Bài Tập Python"));
      assert.ok(directDocx.extractedText.includes(`Câu 1:\tx < 10 & y > 5 "ok" 'py' AB\nDòng 2`));
      assert.ok(directDocx.extractedText.includes("Trang 1"));

      const idxBufRes = parseSubmissionBuffer(docxBuf, "baitap.docx");
      assert.equal(idxBufRes.parseStatus, "PARSED");
      assert.equal(idxBufRes.subjectType, "DOCUMENT");

      const tmpDocxPath = path.join(tmpRoot, "sample_word.docx");
      fs.writeFileSync(tmpDocxPath, docxBuf);
      const idxFileRes = parseSubmissionFile(tmpDocxPath);
      assert.equal(idxFileRes.parseStatus, "PARSED");
      assert.equal(idxFileRes.subjectType, "DOCUMENT");

      // Zip-slip path traversal
      const evilDocx = new AdmZip();
      evilDocx.addFile("word/document.xml", Buffer.from("<w:document><w:body><w:p><w:r><w:t>ok</w:t></w:r></w:p></w:body></w:document>", "utf8"));
      evilDocx.addFile("sub/../../evil.xml", Buffer.from("<evil/>", "utf8"));
      evilDocx.getEntries()[1].entryName = "../evil.xml";
      const slipRes = parseSubmissionBuffer(evilDocx.toBuffer(), "slip.docx");
      assert.equal(slipRes.parseStatus, "PARSE_ERROR");
      assert.match(slipRes.parseErrorReason || "", /Path Traversal|không an toàn/i);

      // Zip bomb (> 600 entries)
      const bombDocx = new AdmZip();
      bombDocx.addFile("word/document.xml", Buffer.from("<w:document><w:body><w:p><w:r><w:t>ok</w:t></w:r></w:p></w:body></w:document>", "utf8"));
      for (let i = 0; i < 605; i++) {
        bombDocx.addFile(`word/media/f_${i}.txt`, Buffer.from("x", "utf8"));
      }
      const bombRes = parseSubmissionBuffer(bombDocx.toBuffer(), "bomb.docx");
      assert.equal(bombRes.parseStatus, "PARSE_ERROR");
      assert.match(bombRes.parseErrorReason || "", /Zip Bomb/i);

      // Missing word/document.xml
      const noDocXml = new AdmZip();
      noDocXml.addFile("word/styles.xml", Buffer.from("<styles/>", "utf8"));
      assert.equal(parseSubmissionBuffer(noDocXml.toBuffer(), "nodoc.docx").parseStatus, "PARSE_ERROR");

      // Empty text OOXML
      const emptyTextDocx = new AdmZip();
      emptyTextDocx.addFile(
        "word/document.xml",
        Buffer.from(`<w:document><w:body><w:p><w:r><w:t>   </w:t></w:r></w:p></w:body></w:document>`, "utf8")
      );
      const emptyRes = parseSubmissionBuffer(emptyTextDocx.toBuffer(), "empty.docx");
      assert.equal(emptyRes.parseStatus, "PARSE_ERROR");
      assert.match(emptyRes.parseErrorReason || "", /rỗng chữ/i);

      // Corrupted binary magic & legacy .doc
      assert.equal(parseSubmissionBuffer(Buffer.from("not a zip", "utf8"), "corrupt.docx").parseStatus, "PARSE_ERROR");
      assert.equal(parseSubmissionBuffer(Buffer.from("legacy doc", "utf8"), "old.doc").parseStatus, "PARSE_ERROR");

      console.log("  -> PASS S2-03.");
    }

    // =========================================================================
    // [S2-04] POST /api/homework-grader/open-local-file Security & Dry-Run
    // =========================================================================
    console.log("\n[S2-04] Kiểm tra API /api/homework-grader/open-local-file (chặn traversal/symlink/ngoài localhost + dryRun)...");
    {
      const openClass = "TEST_S2_OPEN_CLS";
      const openSess = `${openClass}_SESS_05`;
      const openLesson = "L_OPEN_01";
      const openSubDir = path.resolve(process.cwd(), "temp_submissions", openClass, openLesson);
      fs.mkdirSync(openSubDir, { recursive: true });
      const validFilePath = path.join(openSubDir, "SUB_OPEN_OK_baitap.docx");
      fs.writeFileSync(validFilePath, Buffer.from("PK\x03\x04dummy", "binary"));

      const outsideSecretPath = path.join(tmpRoot, "outside_secret.txt");
      fs.writeFileSync(outsideSecretPath, "secret", "utf8");

      const escapeJunctionDir = path.resolve(process.cwd(), "temp_submissions", openClass, "escape_junction");
      let createdJunction = false;
      try {
        fs.symlinkSync(tmpRoot, escapeJunctionDir, "junction");
        createdJunction = true;
      } catch {
        createdJunction = false;
      }

      const seedOpenSub = (subId: string, localFilePath: string) => {
        homeworkSubmissionRepo.upsert({
          classId: openClass,
          sessionId: openSess,
          studentId: "STU_OPEN_1",
          submissionId: subId,
          originalFileName: path.basename(localFilePath || "none.docx"),
          localFilePath,
          fileHash: "open-hash-1",
          parseStatus: "PARSE_ERROR",
          parseErrorReason: "Lỗi test",
          criteriaGradesJson: "[]",
          calculatedScore: 0,
          teacherOverrideScore: null,
          decision: "GRADE",
          feedbackHtml: "",
          contentHash: "",
          status: "PENDING",
          verifiedAt: null,
          errorMessage: null,
        });
      };

      seedOpenSub("SUB_OPEN_OK", validFilePath);
      seedOpenSub("SUB_OPEN_EMPTY", "");
      seedOpenSub("SUB_OPEN_OUTSIDE", outsideSecretPath);
      seedOpenSub("SUB_OPEN_TRAV", path.join(openSubDir, "..", "..", "..", "AGENTS.md"));
      if (createdJunction) {
        seedOpenSub("SUB_OPEN_JUNC", path.join(escapeJunctionDir, "outside_secret.txt"));
      }

      // 1. Non-local host / cross-site origin -> 403
      const nonLocalRes = await openLocalFilePOST(
        new Request("http://evil.example.com/api/homework-grader/open-local-file", {
          method: "POST",
          headers: { host: "evil.example.com", "content-type": "application/json" },
          body: JSON.stringify({ classId: openClass, sessionId: openSess, submissionId: "SUB_OPEN_OK" }),
        })
      );
      assert.equal(nonLocalRes.status, 403);

      const crossSiteRes = await openLocalFilePOST(
        new Request("http://127.0.0.1:3000/api/homework-grader/open-local-file", {
          method: "POST",
          headers: {
            host: "127.0.0.1:3000",
            origin: "https://evil.example.com",
            "sec-fetch-site": "cross-site",
            "content-type": "application/json",
          },
          body: JSON.stringify({ classId: openClass, sessionId: openSess, submissionId: "SUB_OPEN_OK" }),
        })
      );
      assert.equal(crossSiteRes.status, 403);

      // 2. Invalid payload / missing IDs / unknown submission -> 400 / 404
      const badBodyRes = await openLocalFilePOST(
        new Request("http://127.0.0.1:3000/api/homework-grader/open-local-file", {
          method: "POST",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
          body: JSON.stringify([]),
        })
      );
      assert.equal(badBodyRes.status, 400);

      const notFoundRes = await openLocalFilePOST(
        new Request("http://127.0.0.1:3000/api/homework-grader/open-local-file", {
          method: "POST",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
          body: JSON.stringify({ classId: openClass, sessionId: openSess, submissionId: "SUB_MISSING_999" }),
        })
      );
      assert.equal(notFoundRes.status, 404);

      const mismatchStudentRes = await openLocalFilePOST(
        new Request("http://127.0.0.1:3000/api/homework-grader/open-local-file", {
          method: "POST",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
          body: JSON.stringify({
            classId: openClass,
            sessionId: openSess,
            submissionId: "SUB_OPEN_OK",
            studentId: "OTHER_STU",
          }),
        })
      );
      assert.equal(mismatchStudentRes.status, 400);

      // 3. Empty localFilePath -> 400
      const emptyPathRes = await openLocalFilePOST(
        new Request("http://127.0.0.1:3000/api/homework-grader/open-local-file", {
          method: "POST",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
          body: JSON.stringify({ classId: openClass, sessionId: openSess, submissionId: "SUB_OPEN_EMPTY" }),
        })
      );
      assert.equal(emptyPathRes.status, 400);

      // 4. Outside temp_submissions/ (even inside ALLOWED_LOCAL_DIRS!) -> 403
      const outsideRes = await openLocalFilePOST(
        new Request("http://127.0.0.1:3000/api/homework-grader/open-local-file", {
          method: "POST",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
          body: JSON.stringify({ classId: openClass, sessionId: openSess, submissionId: "SUB_OPEN_OUTSIDE" }),
        })
      );
      assert.equal(outsideRes.status, 403);

      // 5. Path traversal `../../..` -> 403
      const travRes = await openLocalFilePOST(
        new Request("http://127.0.0.1:3000/api/homework-grader/open-local-file", {
          method: "POST",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
          body: JSON.stringify({ classId: openClass, sessionId: openSess, submissionId: "SUB_OPEN_TRAV" }),
        })
      );
      assert.equal(travRes.status, 403);

      // 6. Symlink / Junction escape -> 403
      if (createdJunction) {
        const juncRes = await openLocalFilePOST(
          new Request("http://127.0.0.1:3000/api/homework-grader/open-local-file", {
            method: "POST",
            headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
            body: JSON.stringify({ classId: openClass, sessionId: openSess, submissionId: "SUB_OPEN_JUNC" }),
          })
        );
        assert.equal(juncRes.status, 403, "Junction trỏ ra ngoài temp_submissions/ bắt buộc bị chặn 403");
      }

      // 7. Valid file in dry-run mode -> 200
      const okRes = await openLocalFilePOST(
        new Request("http://127.0.0.1:3000/api/homework-grader/open-local-file", {
          method: "POST",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
          body: JSON.stringify({
            classId: openClass,
            sessionId: openSess,
            submissionId: "SUB_OPEN_OK",
            studentId: "STU_OPEN_1",
          }),
        })
      );
      assert.equal(okRes.status, 200);
      const okJson = await okRes.json();
      assert.equal(okJson.success, true);
      assert.equal(okJson.data.dryRun, true);
      assert.equal(
        okJson.data.resolvedPath.toLowerCase(),
        fs.realpathSync(validFilePath).toLowerCase()
      );
      console.log("  -> PASS S2-04.");
    }

    // =========================================================================
    // [S2-05] Controlled Manual Grading on PARSE_ERROR + GradeWorker Guardrail
    // =========================================================================
    console.log("\n[S2-05] Kiểm tra duyệt tay có kiểm soát cho PARSE_ERROR & GradeWorker #tabpanel-3...");
    {
      const pClass = "TEST_S2_PERR";
      const pSess = `${pClass}_SESS_05`;
      const pLesson = "L_PERR_CP1";

      studentRepo.upsert({ classId: pClass, studentId: "STU_PE_1", fullName: "Phạm Minh Đức", isActive: 1 });
      studentRepo.upsert({ classId: pClass, studentId: "STU_PE_2", fullName: "Hoàng Gia Huy", isActive: 1 });
      studentRepo.upsert({ classId: pClass, studentId: "STU_OK_3", fullName: "Vũ Bảo Trâm", isActive: 1 });

      scoreMatrixRepo.save(pClass, {
        success: true,
        classId: pClass,
        classCode: pClass,
        lmsClassId: "683e88a68cc94584eaee6b55",
        scrapedAt: new Date().toISOString(),
        summary: {
          totalStudents: 3,
          totalColumns: 1,
          gradedCells: 0,
          submittedUngradedCells: 3,
          notSubmittedCells: 0,
          redoCells: 0,
          zeroScoreCells: 0,
        },
        columns: [
          {
            colIndex: 0,
            columnId: pLesson,
            lessonId: pLesson,
            title: "Bài kiểm tra định kỳ lần 1 - CP1",
            sessionNumber: 5,
            lessonType: "CHECKPOINT",
          },
        ],
        rows: [
          {
            studentId: "STU_PE_1",
            studentUid: "UID_PE_1",
            fullName: "Phạm Minh Đức",
            isActive: true,
            averageScore: null,
            gradedCount: 0,
            submittedUngradedCount: 1,
            notSubmittedCount: 0,
            redoCount: 0,
            cells: {
              [pLesson]: {
                columnId: pLesson,
                lessonId: pLesson,
                sessionNumber: 5,
                status: "SUBMITTED_UNGRADED",
                score: null,
                quizScore: 90,
                maxScore: 100,
                submissionId: "SUB_PE_1",
                attachments: ["lms/corrupted.docx"],
                rawText: "Submitted(1/1)",
              },
            },
          },
          {
            studentId: "STU_PE_2",
            studentUid: "UID_PE_2",
            fullName: "Hoàng Gia Huy",
            isActive: true,
            averageScore: null,
            gradedCount: 0,
            submittedUngradedCount: 1,
            notSubmittedCount: 0,
            redoCount: 0,
            cells: {
              [pLesson]: {
                columnId: pLesson,
                lessonId: pLesson,
                sessionNumber: 5,
                status: "SUBMITTED_UNGRADED",
                score: null,
                quizScore: 70,
                maxScore: 100,
                submissionId: "SUB_PE_2",
                attachments: ["lms/car-sales-data.csv"],
                rawText: "Submitted(1/1)",
              },
            },
          },
          {
            studentId: "STU_OK_3",
            studentUid: "UID_OK_3",
            fullName: "Vũ Bảo Trâm",
            isActive: true,
            averageScore: null,
            gradedCount: 0,
            submittedUngradedCount: 1,
            notSubmittedCount: 0,
            redoCount: 0,
            cells: {
              [pLesson]: {
                columnId: pLesson,
                lessonId: pLesson,
                sessionNumber: 5,
                status: "SUBMITTED_UNGRADED",
                score: null,
                quizScore: 95,
                maxScore: 100,
                submissionId: "SUB_OK_3",
                attachments: ["lms/tram.ipynb"],
                rawText: "Submitted(1/1)",
              },
            },
          },
        ],
      });

      homeworkSubmissionRepo.upsert({
        classId: pClass,
        sessionId: pSess,
        studentId: "STU_PE_1",
        submissionId: "SUB_PE_1",
        originalFileName: "corrupted.docx",
        localFilePath: "",
        fileHash: "pe-hash-1",
        parseStatus: "PARSE_ERROR",
        parseErrorReason: "File Word bị hỏng hoặc rỗng chữ",
        criteriaGradesJson: "[]",
        calculatedScore: 0,
        teacherOverrideScore: null,
        decision: "GRADE",
        feedbackHtml: "",
        contentHash: "",
        status: "PENDING",
        verifiedAt: null,
        errorMessage: null,
      });

      // Forged APPROVED PARSE_ERROR without MANUAL_PARSE_ERROR_GRADE marker
      const forgedPe2: any = {
        classId: pClass,
        sessionId: pSess,
        studentId: "STU_PE_2",
        submissionId: "SUB_PE_2",
        originalFileName: "car-sales-data.csv",
        localFilePath: "",
        fileHash: "pe-hash-2",
        parseStatus: "PARSE_ERROR",
        parseErrorReason: "[MISSING_CODE_FILE] Chỉ nộp .csv",
        criteriaGradesJson: "[]",
        calculatedScore: 0,
        teacherOverrideScore: null,
        decision: "GRADE",
        feedbackHtml: "<p>Nhận xét giả mạo chưa qua duyệt tay hợp lệ.</p>",
        contentHash: "",
        status: "APPROVED",
        verifiedAt: null,
        errorMessage: null,
      };
      forgedPe2.contentHash = computeHomeworkContentHash(forgedPe2);
      homeworkSubmissionRepo.upsert(forgedPe2);

      const ok3Crit = [
        {
          criterionId: "C1",
          criterionName: "C1",
          earnedPoints: 90,
          maxPoints: 100,
          evidenceSnippet: "print(df)",
          deductionReason: "Tốt",
        },
      ];
      homeworkSubmissionRepo.upsert({
        classId: pClass,
        sessionId: pSess,
        studentId: "STU_OK_3",
        submissionId: "SUB_OK_3",
        originalFileName: "tram.ipynb",
        localFilePath: "",
        fileHash: "ok3-hash",
        parseStatus: "PARSED",
        parseErrorReason: null,
        criteriaGradesJson: JSON.stringify(ok3Crit),
        calculatedScore: 90,
        teacherOverrideScore: null,
        decision: "GRADE",
        feedbackHtml: "<p>Bài làm tốt lắm con!</p>",
        contentHash: "",
        status: "WAITING_APPROVAL",
        verifiedAt: null,
        errorMessage: null,
      });

      // 1. approveAll MUST still skip PARSE_ERROR and approve PARSED
      const batchRes = await approveHomeworkPOST(
        new Request("http://127.0.0.1:3000/api/homework-grader/approve", {
          method: "POST",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
          body: JSON.stringify({
            classId: pClass,
            sessionId: pSess,
            approveAll: true,
            rubric: { maxTotalScore: 100, criteria: [{ criterionId: "C1", name: "C1", maxPoints: 100 }] },
            reviewedSubmissions: [
              {
                submissionId: "SUB_OK_3",
                fileHash: "ok3-hash",
                feedbackHtml: "<p>Bài làm tốt lắm con!</p>",
                decision: "GRADE",
                teacherOverrideScore: null,
                criteriaGrades: ok3Crit,
              },
            ],
          }),
        })
      );
      assert.equal(batchRes.status, 200);
      const batchJson = await batchRes.json();
      assert.deepEqual(batchJson.data.approvedIds, ["SUB_OK_3"]);
      assert.ok(batchJson.data.skippedIds.some((s: any) => s.submissionId === "SUB_PE_1"));
      assert.equal(homeworkSubmissionRepo.findBySubmissionId("SUB_PE_1")!.status, "PENDING");

      // 2. Single approve WITHOUT manualTeacherGradeOnParseError: true -> 400
      const noFlagRes = await approveHomeworkPOST(
        new Request("http://127.0.0.1:3000/api/homework-grader/approve", {
          method: "POST",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
          body: JSON.stringify({
            classId: pClass,
            sessionId: pSess,
            studentId: "STU_PE_1",
            submissionId: "SUB_PE_1",
            teacherOverrideScore: 80,
            feedbackHtml: "<p>Đã chấm tay bài lỗi</p>",
            decision: "GRADE",
          }),
        })
      );
      assert.equal(noFlagRes.status, 400);

      // 3. Reject invalid manualTeacherGradeOnParseError inputs (REDO, decimal, out-of-range, short feedback, wrong student)
      const invalidManualPayloads = [
        { teacherOverrideScore: 80, feedbackHtml: "<p>Nhận xét đủ dài 10 ký tự.</p>", decision: "REDO" },
        { teacherOverrideScore: 82.5, feedbackHtml: "<p>Nhận xét đủ dài 10 ký tự.</p>", decision: "GRADE" },
        { teacherOverrideScore: 101, feedbackHtml: "<p>Nhận xét đủ dài 10 ký tự.</p>", decision: "GRADE" },
        { teacherOverrideScore: -1, feedbackHtml: "<p>Nhận xét đủ dài 10 ký tự.</p>", decision: "GRADE" },
        { teacherOverrideScore: null, feedbackHtml: "<p>Nhận xét đủ dài 10 ký tự.</p>", decision: "GRADE" },
        { teacherOverrideScore: 82, feedbackHtml: "<p>Ngắn</p>", decision: "GRADE" },
        { teacherOverrideScore: 82, feedbackHtml: "<p>   <b>12345</b>   </p>", decision: "GRADE" },
      ];
      for (const bad of invalidManualPayloads) {
        const badRes = await approveHomeworkPOST(
          new Request("http://127.0.0.1:3000/api/homework-grader/approve", {
            method: "POST",
            headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
            body: JSON.stringify({
              classId: pClass,
              sessionId: pSess,
              studentId: "STU_PE_1",
              submissionId: "SUB_PE_1",
              manualTeacherGradeOnParseError: true,
              ...bad,
            }),
          })
        );
        assert.equal(badRes.status, 400, `Payload sai phải bị từ chối 400: ${JSON.stringify(bad)}`);
      }

      // 4. Valid manual approval on PARSE_ERROR -> 200 APPROVED + audit marker + valid contentHash
      const validManualRes = await approveHomeworkPOST(
        new Request("http://127.0.0.1:3000/api/homework-grader/approve", {
          method: "POST",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
          body: JSON.stringify({
            classId: pClass,
            sessionId: pSess,
            studentId: "STU_PE_1",
            submissionId: "SUB_PE_1",
            manualTeacherGradeOnParseError: true,
            teacherOverrideScore: 82,
            feedbackHtml: "<p>Đã mở xem tệp gốc và chấm tay đầy đủ tiêu chí bài làm.</p>",
            decision: "GRADE",
          }),
        })
      );
      assert.equal(validManualRes.status, 200);
      const validManualJson = await validManualRes.json();
      assert.equal(validManualJson.data.status, "APPROVED");
      assert.equal(validManualJson.data.calculatedScore, 82);
      assert.equal(validManualJson.data.teacherOverrideScore, 82);
      assert.equal(verifyHomeworkContentIntegrity(validManualJson.data), true);
      const savedMarkers = JSON.parse(validManualJson.data.criteriaGradesJson);
      assert.equal(savedMarkers[0].criterionId, "MANUAL_PARSE_ERROR_GRADE");
      assert.equal(savedMarkers[0].earnedPoints, 82);

      // 5. HomeworkGradeWorker on Chromium #tabpanel-3 mock:
      //    - Forged SUB_PE_2 (no MANUAL_PARSE_ERROR_GRADE) MUST be blocked with 0 LMS calls
      //    - Properly manual-approved SUB_PE_1 MUST push 82 & verify VERIFIED!
      browser = await chromium.launch({ headless: true });
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const markPayloads: any[] = [];

      await page.route("https://lms.mindx.edu.vn/**", async (route) => {
        await route.fulfill({ status: 200, contentType: "text/html", body: "<html><body></body></html>" });
      });
      await page.route("https://lms-api.mindx.edu.vn/**", async (route) => {
        const body = route.request().postDataJSON?.() || {};
        if (body.operationName === "MarkStudentSubmission") {
          const p = body.variables?.payload || {};
          markPayloads.push(p);
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                studentHomework: {
                  markStudentSubmission: {
                    id: p.id,
                    score: Number(p.score),
                    note: p.note,
                    status: "MARKED",
                    category: "PRACTICE_TASK1",
                    classId: "683e88a68cc94584eaee6b55",
                    lessonId: pLesson,
                    studentUid: "UID_PE_1",
                  },
                },
              },
            }),
          });
          return;
        }
        await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      });

      bm.getPage = async () => page;
      authService.ensureAuthenticated = async () => true as any;
      LmsHelpers.openClassDrawer = async () => ({} as any);
      LmsHelpers.switchDrawerTab = async () => {};

      try {
        await page.goto("https://lms.mindx.edu.vn/admin/classes");
        await page.setContent(`
          <div aria-labelledby="class-detail" class="MuiDrawer-paperAnchorRight">
            <div id="tabpanel-3">
              <div class="lms-grid-root">
                <div class="lms-student-row">
                  <div class="startCell"><div class="studentStartCell"><div>Phạm Minh Đức</div><svg data-testid="ExpandMoreIcon"></svg><svg data-testid="ExpandLessIcon" class="hidden"></svg></div></div>
                  <div class="submissionCell" id="cell-pe1">Submitted(1/1)</div>
                </div>
              </div>
            </div>
          </div>
          <div id="mui-dialog-host"></div>
          <script>
            (() => {
              window.pe1State = { expanded: false, status: 'SUBMITTED', score: 0, noteHtml: '' };
              function renderCell() {
                const cell = document.getElementById('cell-pe1');
                if (!window.pe1State.expanded) {
                  cell.textContent = window.pe1State.status === 'MARKED' ? 'Marked(1/1)' : 'Submitted(1/1)';
                  return;
                }
                const scoreText = window.pe1State.status === 'MARKED' ? (window.pe1State.score + '/100') : '--/100';
                const btnLabel = window.pe1State.status === 'MARKED' ? 'Update' : 'Mark';
                cell.innerHTML = '<div class="expandCell"><div class="submissionItem"><h6>Practice task (No 1)</h6><h5 class="score">' + scoreText + '</h5><div class="mui-btn-wrapper"><button type="button" id="pe-open-modal">' + btnLabel + '</button></div></div></div>';
                document.getElementById('pe-open-modal').onclick = (ev) => { ev.stopPropagation(); openModal(); };
              }
              function closeModal() { document.getElementById('mui-dialog-host').innerHTML = ''; }
              function openModal() {
                const host = document.getElementById('mui-dialog-host');
                host.innerHTML =
                  '<div class="MuiDialog-root"><div role="dialog" class="MuiDialog-paper">' +
                  '<div>${pClass}-Lesson 5-Phạm Minh Đức-Practice task 1</div>' +
                  '<div>1795323429624-corrupted.docx</div>' +
                  '<div><label><input type="radio" name="act" value="MARK" checked /> Mark Submission</label><label><input type="radio" name="act" value="REDO" disabled /> Request redo submission</label></div>' +
                  '<input type="text" placeholder="Input score" class="MuiOutlinedInput-input" id="lms-score-in" />' +
                  '<div class="ql-container"><div class="ql-editor" contenteditable="true" id="lms-quill"></div></div>' +
                  '<button type="button" id="lms-exit-btn">Exit</button><button type="button" id="lms-save-btn">Save</button>' +
                  '</div></div>';
                const scoreIn = document.getElementById('lms-score-in');
                scoreIn.value = String(window.pe1State.score || 0);
                const quill = document.getElementById('lms-quill');
                quill.innerHTML = window.pe1State.noteHtml || '';
                document.getElementById('lms-exit-btn').onclick = closeModal;
                document.getElementById('lms-save-btn').onclick = async () => {
                  const numScore = Number(scoreIn.value);
                  const noteHtml = quill.innerHTML;
                  const r = await fetch('https://lms-api.mindx.edu.vn/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      operationName: 'MarkStudentSubmission',
                      variables: { payload: { id: 'SUB_PE_1', score: String(numScore), note: noteHtml } }
                    })
                  });
                  if (r.ok) {
                    window.pe1State.status = 'MARKED';
                    window.pe1State.score = numScore;
                    window.pe1State.noteHtml = noteHtml;
                    closeModal();
                    renderCell();
                  }
                };
              }
              document.getElementById('cell-pe1').onclick = () => {
                window.pe1State.expanded = true;
                const moreSvg = document.querySelector('svg[data-testid="ExpandMoreIcon"]');
                if (moreSvg) moreSvg.remove();
                document.querySelector('svg[data-testid="ExpandLessIcon"]')?.classList.remove('hidden');
                renderCell();
              };
            })();
          </script>
        `);

        // Unapproved/forged PARSE_ERROR without MANUAL_PARSE_ERROR_GRADE MUST be rejected
        const forgedWorkerRes = await HomeworkGradeWorker.saveApprovedGrades({
          classId: pClass,
          classCode: pClass,
          sessionId: pSess,
          lessonId: pLesson,
          submissionId: "SUB_PE_2",
        });
        assert.equal(forgedWorkerRes.verifiedCount, 0);
        assert.equal(forgedWorkerRes.failedCount, 1);
        assert.equal(markPayloads.length, 0, "Cấm đẩy PARSE_ERROR chưa chấm tay hợp lệ lên LMS");

        // [S2-F01a Regression] Tampered float teacherOverrideScore on PARSE_ERROR MUST be rejected by integer guardrail
        const floatPe: any = {
          classId: pClass,
          sessionId: pSess,
          studentId: "STU_PE_2",
          submissionId: "SUB_PE_FLOAT",
          originalFileName: "float-tamper.docx",
          localFilePath: "",
          fileHash: "pe-hash-float",
          parseStatus: "PARSE_ERROR",
          parseErrorReason: "Tampered float test",
          criteriaGradesJson: JSON.stringify([
            {
              criterionId: "MANUAL_PARSE_ERROR_GRADE",
              criterionName: "Manual",
              earnedPoints: 82.5,
              maxPoints: 100,
              evidenceSnippet: "tamper",
              deductionReason: "tamper",
            },
          ]),
          calculatedScore: 82.5,
          teacherOverrideScore: 82.5,
          decision: "GRADE",
          feedbackHtml: "<p>Nhận xét giả mạo điểm lẻ 82.5 trên PARSE_ERROR.</p>",
          contentHash: "",
          status: "APPROVED",
          verifiedAt: null,
          errorMessage: null,
        };
        floatPe.contentHash = computeHomeworkContentHash(floatPe);
        homeworkSubmissionRepo.upsert(floatPe);
        const floatWorkerRes = await HomeworkGradeWorker.saveApprovedGrades({
          classId: pClass,
          classCode: pClass,
          sessionId: pSess,
          lessonId: pLesson,
          submissionId: "SUB_PE_FLOAT",
        });
        assert.equal(floatWorkerRes.verifiedCount, 0);
        assert.equal(floatWorkerRes.failedCount, 1);
        assert.equal(markPayloads.length, 0, "S2-F01: Cấm đẩy teacherOverrideScore không phải số nguyên");

        // Properly manual-approved PARSE_ERROR MUST succeed and verify
        const validWorkerRes = await HomeworkGradeWorker.saveApprovedGrades({
          classId: pClass,
          classCode: pClass,
          sessionId: pSess,
          lessonId: pLesson,
          submissionId: "SUB_PE_1",
        });
        assert.equal(validWorkerRes.failedCount, 0, JSON.stringify(validWorkerRes.results));
        assert.equal(validWorkerRes.verifiedCount, 1);
        assert.equal(markPayloads.length, 1);
        assert.equal(markPayloads[0].id, "SUB_PE_1");
        assert.equal(markPayloads[0].score, "82");
        assert.equal(homeworkSubmissionRepo.findBySubmissionId("SUB_PE_1")!.status, "VERIFIED");

        // [S2-F01b Regression] Retrying a FAILED manually-graded PARSE_ERROR with valid contentHash MUST succeed
        const retryApproveRes = await approveHomeworkPOST(
          new Request("http://127.0.0.1:3000/api/homework-grader/approve", {
            method: "POST",
            headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
            body: JSON.stringify({
              classId: pClass,
              sessionId: pSess,
              studentId: "STU_PE_1",
              submissionId: "SUB_PE_1",
              manualTeacherGradeOnParseError: true,
              teacherOverrideScore: 86,
              feedbackHtml: "<p>Cập nhật chấm tay và thử lại sau khi rớt mạng LMS.</p>",
              decision: "GRADE",
            }),
          })
        );
        assert.equal(retryApproveRes.status, 200);
        const approvedForRetry = homeworkSubmissionRepo.findBySubmissionId("SUB_PE_1")!;
        assert.equal(approvedForRetry.status, "APPROVED");
        assert.equal(verifyHomeworkContentIntegrity(approvedForRetry), true);
        homeworkSubmissionRepo.upsert({
          ...approvedForRetry,
          status: "FAILED",
          verifiedAt: null,
          errorMessage: "Simulated transient LMS network failure",
        });
        const retryWorkerRes = await HomeworkGradeWorker.saveApprovedGrades({
          classId: pClass,
          classCode: pClass,
          sessionId: pSess,
          lessonId: pLesson,
          submissionId: "SUB_PE_1",
        });
        assert.equal(retryWorkerRes.failedCount, 0, JSON.stringify(retryWorkerRes.results));
        assert.equal(retryWorkerRes.verifiedCount, 1);
        assert.equal(markPayloads.length, 2);
        assert.equal(markPayloads[1].score, "86");
        assert.equal(homeworkSubmissionRepo.findBySubmissionId("SUB_PE_1")!.status, "VERIFIED");

        await ctx.close();
      } finally {
        bm.getPage = origGetPage;
        authService.ensureAuthenticated = origEnsureAuth;
        LmsHelpers.openClassDrawer = origOpenDrawer;
        LmsHelpers.switchDrawerTab = origSwitchTab;
        await browser.close();
        browser = null;
      }
      console.log("  -> PASS S2-05.");
    }

    // =========================================================================
    // [S2-UI] UI Contracts & Live Next.js SSR Hydration + localStorage E2E
    // =========================================================================
    console.log("\n[S2-UI] Kiểm tra hợp đồng UI & Live Chromium SSR Hydration / localStorage / Gói C...");
    {
      const panelSrc = fs.readFileSync(
        path.resolve(process.cwd(), "src/components/checkpoint-grader-panel.tsx"),
        "utf8"
      );
      const hwPageSrc = fs.readFileSync(
        path.resolve(process.cwd(), "src/app/homework-grader/page.tsx"),
        "utf8"
      );
      const rcViewSrc = fs.readFileSync(
        path.resolve(process.cwd(), "src/components/teaching-report-card-view.tsx"),
        "utf8"
      );

      for (const token of [
        "cp-grade-single-btn-",
        "cp-expand-row-btn-",
        "cp-open-raw-file-btn-",
        "cp-manual-score-input-",
        "cp-manual-feedback-input-",
        "cp-approve-manual-parse-err-btn-",
        "cp-save-single-lms-btn-",
        "manualTeacherGradeOnParseError: true",
      ]) {
        assert.ok(panelSrc.includes(token), `checkpoint-grader-panel.tsx thiếu token '${token}'`);
      }
      for (const token of [
        "mindx_hw_ui_prefs_v1",
        "hw-top-capture-btvn-btn",
        "hw-view-mode-both-btn",
        "hw-view-mode-practice-btn",
        "hw-view-mode-quiz-btn",
      ]) {
        assert.ok(hwPageSrc.includes(token), `homework-grader/page.tsx thiếu token '${token}'`);
      }
      for (const token of [
        "mindx_hw_ui_prefs_v1",
        "rc-scale-scale5-btn",
        "rc-scale-raw-btn",
        "rc-stage-filter-select",
      ]) {
        assert.ok(rcViewSrc.includes(token), `teaching-report-card-view.tsx thiếu token '${token}'`);
      }
      for (const src of [panelSrc, hwPageSrc, rcViewSrc]) {
        assert.equal(src.includes("TEACHING_PASSWORD"), false);
        assert.equal(src.includes("LMS_PASSWORD"), false);
        assert.equal(src.includes("GEMINI_API_KEY"), false);
      }

      // Live Next.js SSR + Chromium hydration + localStorage + Gói C UI interactions
      const uiClass = "TEST_S2_UI";
      const uiSess = `${uiClass}_SESS_05`;
      const uiLesson = "L_UI_CP1";
      saveRunningClasses([
        { classCode: uiClass, courseName: "CSA04 UI", status: "Running", startDate: "2026-10-10", endDate: "2027-01-10" },
      ]);
      studentRepo.upsert({ classId: uiClass, studentId: "STU_UI_1", fullName: "Nguyễn Minh Anh", isActive: 1 });
      studentRepo.upsert({ classId: uiClass, studentId: "STU_UI_2", fullName: "Lê Gia Hân", isActive: 1 });
      scoreMatrixRepo.save(uiClass, {
        success: true,
        classId: uiClass,
        classCode: uiClass,
        lmsClassId: "683e88a68cc94584eaee6b99",
        scrapedAt: "2026-11-27T08:00:00.000Z",
        summary: {
          totalStudents: 2,
          totalColumns: 2,
          gradedCells: 1,
          submittedUngradedCells: 1,
          notSubmittedCells: 0,
          redoCells: 0,
          zeroScoreCells: 0,
        },
        columns: [
          { colIndex: 0, columnId: "L_UI_HW1", lessonId: "L_UI_HW1", title: "Homework 1", sessionNumber: 1, lessonType: "REVIEW_AND_PRACTICE" },
          { colIndex: 1, columnId: uiLesson, lessonId: uiLesson, title: "Checkpoint 1", sessionNumber: 5, lessonType: "CHECKPOINT" },
        ],
        rows: [
          {
            studentId: "STU_UI_1",
            studentUid: "UID_UI_1",
            fullName: "Nguyễn Minh Anh",
            isActive: true,
            averageScore: 90,
            averageQuizScore: 95,
            gradedCount: 1,
            submittedUngradedCount: 1,
            notSubmittedCount: 0,
            redoCount: 0,
            cells: {
              L_UI_HW1: { columnId: "L_UI_HW1", sessionNumber: 1, status: "GRADED", score: 90, quizScore: 95, maxScore: 100, rawText: "90/100" },
              [uiLesson]: { columnId: uiLesson, lessonId: uiLesson, sessionNumber: 5, status: "SUBMITTED_UNGRADED", score: null, quizScore: 90, maxScore: 100, submissionId: "SUB_UI_1", attachments: ["lms/anh.docx"], rawText: "Submitted(1/1)" },
            },
          },
          {
            studentId: "STU_UI_2",
            studentUid: "UID_UI_2",
            fullName: "Lê Gia Hân",
            isActive: true,
            averageScore: 85,
            averageQuizScore: 80,
            gradedCount: 1,
            submittedUngradedCount: 1,
            notSubmittedCount: 0,
            redoCount: 0,
            cells: {
              L_UI_HW1: { columnId: "L_UI_HW1", sessionNumber: 1, status: "GRADED", score: 85, quizScore: 80, maxScore: 100, rawText: "85/100" },
              [uiLesson]: { columnId: uiLesson, lessonId: uiLesson, sessionNumber: 5, status: "SUBMITTED_UNGRADED", score: null, quizScore: 85, maxScore: 100, submissionId: "SUB_UI_2", attachments: ["lms/han.ipynb"], rawText: "Submitted(1/1)" },
            },
          },
        ],
      });

      const uiRawDir = path.resolve(process.cwd(), "temp_submissions", uiClass, uiLesson);
      fs.mkdirSync(uiRawDir, { recursive: true });
      const uiRawPath = path.join(uiRawDir, "SUB_UI_1_anh.docx");
      fs.writeFileSync(uiRawPath, Buffer.from("corrupted docx bytes", "utf8"));

      homeworkSubmissionRepo.upsert({
        classId: uiClass,
        sessionId: uiSess,
        studentId: "STU_UI_1",
        submissionId: "SUB_UI_1",
        originalFileName: "anh.docx",
        localFilePath: uiRawPath,
        fileHash: "ui-hash-1",
        parseStatus: "PARSE_ERROR",
        parseErrorReason: "File Word rỗng chữ hoặc hỏng",
        criteriaGradesJson: "[]",
        calculatedScore: 0,
        teacherOverrideScore: null,
        decision: "GRADE",
        feedbackHtml: "",
        contentHash: "",
        status: "PENDING",
        verifiedAt: null,
        errorMessage: null,
      });
      homeworkSubmissionRepo.upsert({
        classId: uiClass,
        sessionId: uiSess,
        studentId: "STU_UI_2",
        submissionId: "SUB_UI_2",
        originalFileName: "han.ipynb",
        localFilePath: "",
        fileHash: "ui-hash-2",
        parseStatus: "PARSED",
        parseErrorReason: null,
        criteriaGradesJson: JSON.stringify([
          { criterionId: "C1", criterionName: "C1", earnedPoints: 88, maxPoints: 100, evidenceSnippet: "ok", deductionReason: "Tốt" },
        ]),
        calculatedScore: 88,
        teacherOverrideScore: null,
        decision: "GRADE",
        feedbackHtml: "<p>Con làm bài tốt!</p>",
        contentHash: "",
        status: "WAITING_APPROVAL",
        verifiedAt: null,
        errorMessage: null,
      });
      reportCardRepo.saveLmsSnapshot(uiClass, {
        classId: uiClass,
        classCode: uiClass,
        isRobotics: false,
        scrapedAt: "2026-11-27T08:00:00.000Z",
        btvnSessions: [
          { sessionNumber: 1, title: "Homework 1", hasTheory: true, hasPractice: true, practiceTaskCount: 1, maxTheoryScore: 100, maxPracticeScore: 100 },
        ],
        students: [
          {
            studentId: "STU_UI_1",
            fullName: "Nguyễn Minh Anh",
            isActive: true,
            btvnScores: { 1: { sessionNumber: 1, theoryRaw: 95, theoryMax: 100, practiceRaw: 90, practiceMax: 100 } },
            stageScores: { cp1Theory: 4.5, cp1Practice: 4.0, cp1Competency: 4.5, cp2Theory: null, cp2Practice: null, cp2Competency: null, finalProduct: null, finalCompetency: null },
          },
        ],
      });
      closeDb();

      fs.rmSync(e2eDistAbs, { recursive: true, force: true });
      fs.mkdirSync(e2eDistAbs, { recursive: true });
      const rootTsconfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tsconfig.json"), "utf8"));
      rootTsconfig.compilerOptions = { ...(rootTsconfig.compilerOptions || {}), paths: { "@/*": ["../src/*"] } };
      fs.writeFileSync(e2eTsconfigAbs, JSON.stringify(rootTsconfig, null, 2), "utf8");

      const baseUrl = `http://127.0.0.1:${e2ePort}`;
      nextServer = spawn(
        process.execPath,
        ["./node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(e2ePort)],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            MINDX_NEXT_DIST_DIR: e2eDistRel,
            MINDX_NEXT_TSCONFIG_PATH: e2eTsconfigRel,
            MINDX_DB_PATH: tmpDbPath,
            MINDX_CONFIG_DIR: tmpConfigDir,
            MINDX_RUNNING_CLASSES_PATH: tmpRunningClassesPath,
            MINDX_LMS_CLASS_IDS_PATH: tmpLmsClassIdsPath,
            ALLOWED_LOCAL_DIRS: tmpRoot,
            MINDX_ALLOWED_EXTRA_PATHS: tmpRoot,
            MINDX_OPEN_FILE_DRY_RUN: "1",
            NEXT_TELEMETRY_DISABLED: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        }
      );
      await waitForHttpReady(`${baseUrl}/homework-grader?classId=${uiClass}`, 90000);

      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await context.addInitScript("globalThis.__name = globalThis.__name || ((x) => x);");
      await context.addInitScript(() => {
        try {
          localStorage.setItem("mindx_last_class_code", "TEST_S2_UI");
        } catch {}
      });
      const page = await context.newPage();

      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));

      await page.goto(`${baseUrl}/homework-grader?classId=${uiClass}`, {
        waitUntil: "networkidle",
        timeout: 60000,
      });

      // 1. Verify top capture button works even while secondary details are collapsed
      await page.waitForSelector('[data-testid="hw-top-capture-btvn-btn"]', { timeout: 20000 });
      await page.click('[data-testid="hw-top-capture-btvn-btn"]');
      await page.waitForSelector('text=/Đã (chụp|tải xuống ảnh)/i', { timeout: 10000 });

      // 2. Toggle scaleMode & stageFilter & viewMode -> verify localStorage persistence across reload
      await page.click('[data-testid="rc-scale-raw-btn"]');
      await page.selectOption('[data-testid="rc-stage-filter-select"]', "cp1");
      await page.click('button:has-text("Chi tiết bài nộp BTVN trên LMS")');
      await page.waitForSelector('[data-testid="hw-view-mode-practice-btn"]', { timeout: 10000 });
      await page.click('[data-testid="hw-view-mode-practice-btn"]');
      await page.waitForTimeout(300);

      const storedPrefsRaw = await page.evaluate(() => localStorage.getItem("mindx_hw_ui_prefs_v1"));
      const storedPrefs = JSON.parse(storedPrefsRaw || "{}");
      assert.equal(storedPrefs.scaleMode, "raw");
      assert.equal(storedPrefs.stageFilter, "cp1");
      assert.equal(storedPrefs.viewMode, "practice");

      // Reload & confirm SSR hydration produces ZERO errors and prefs survive
      await page.reload({ waitUntil: "networkidle", timeout: 60000 });
      await page.waitForSelector('[data-testid="rc-stage-filter-select"]', { timeout: 20000 });
      const restoredStage = await page.$eval(
        '[data-testid="rc-stage-filter-select"]',
        (el) => (el as HTMLSelectElement).value
      );
      assert.equal(restoredStage, "cp1");

      // 3. Open CheckpointGraderPanel -> inspect PARSE_ERROR -> open-local-file dryRun -> manual approve -> Lưu LMS visible
      await page.click('[data-testid="toggle-checkpoint-grader-btn"]');
      await page.waitForSelector('[data-testid="cp-grade-single-btn-STU_UI_2"]', { timeout: 15000 });
      await page.waitForSelector('[data-testid="cp-expand-row-btn-STU_UI_1"]', { timeout: 15000 });
      await page.click('[data-testid="cp-expand-row-btn-STU_UI_1"]');
      await page.waitForSelector('[data-testid="cp-open-raw-file-btn-STU_UI_1"]', { timeout: 10000 });
      await page.click('[data-testid="cp-open-raw-file-btn-STU_UI_1"]');
      await page.waitForSelector('text=/Đã mở vị trí file gốc/', { timeout: 10000 });

      await page.fill('[data-testid="cp-manual-score-input-STU_UI_1"]', "82");
      await page.fill(
        '[data-testid="cp-manual-feedback-input-STU_UI_1"]',
        "Đã kiểm tra trực tiếp file gốc và chấm điểm 82."
      );
      await page.click('[data-testid="cp-approve-manual-parse-err-btn-STU_UI_1"]');
      await page.waitForSelector('[data-testid="cp-save-single-lms-btn-STU_UI_1"]', { timeout: 10000 });

      assert.deepEqual(consoleErrors, [], `Có lỗi console/hydration: ${consoleErrors.join(" | ")}`);
      assert.deepEqual(pageErrors, [], `Có lỗi pageerror: ${pageErrors.join(" | ")}`);

      await context.close();
      console.log("  -> PASS S2-UI.");
    }

    console.log("\n=== TẤT CẢ KIỂM THỬ CHẶNG 2 (S2-01 .. S2-05 & S2-UI) ĐỀU PASS 100%! ===");
  } finally {
    globalThis.fetch = origGlobalFetch;
    bm.getPage = origGetPage;
    authService.ensureAuthenticated = origEnsureAuth;
    LmsHelpers.openClassDrawer = origOpenDrawer;
    LmsHelpers.switchDrawerTab = origSwitchTab;
    if (browser) await browser.close().catch(() => {});
    killProcessTree(nextServer);
    closeDb();
    cleanupTempSubmissionsForPrefix("TEST_S2_");
    try {
      if (origNextEnvDts !== null) {
        fs.writeFileSync(nextEnvPath, origNextEnvDts);
      }
      fs.rmSync(e2eDistAbs, { recursive: true, force: true });
      fs.rmSync(e2eTsconfigAbs, { force: true });
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
    for (const item of baselineHashes) {
      assert.equal(
        sha256File(item.path),
        item.sha256,
        `SHA-256 tệp dữ liệu thật bị thay đổi trong lúc chạy test Stage 2: ${item.path}`
      );
    }
  }
}

main().catch((err) => {
  console.error("❌ TEST CHẶNG 2 THẤT BẠI:", err);
  process.exit(1);
});
