/**
 * MINDX AUTOMATION BOT - v3.4.0 STAGE S1 VERIFICATION SUITE
 * Verifies S1.1 through S1.7:
 * - [S1.1] POST /api/spck/list enqueues ClassSyncer.fetchRunningClasses & syncClass inside SequentialTaskQueue (jobType: SYNC_CLASS) and honors Stop guard.
 * - [S1.2] POST /api/spck/list never prunes or overwrites running_classes.json when expired Finished classes exist.
 * - [S1.3] Shared TeachingHttpClient (src/lib/teaching/teaching-http-client.ts) powers both LiveTeachingHttpTransport & LiveTeachingReportCardHttpTransport with single shared login, per-class student cache, 301/302 re-login, timeout abort, and Stop abort.
 * - [S1.4] TeachingReportCardSyncService & TeachingProjectService allow direct retry when status === "FAILED" and contentHash matches liveHash, but demote to WAITING_APPROVAL when contentHash drifts; teaching-report-card-view.tsx enables retry button on FAILED with contentHash.
 * - [S1.5] final-project/page.tsx resolves data.selectedSessionNumber ?? data.activeSessionNumber on load and class rescan.
 * - [S1.6] spck-uploader.ts removes hardcoded VT-C4K-PTA12 slot IDs and resolves session slot ID dynamically from classSessionRepo (24-hex) or GraphQL GetClassSlots.
 * - [S1.7] AGENTS.md, GEMINI.md, and PROJECT_STATE.md document the teacher-activated Student Portal exception to 127.0.0.1.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-v340-s1-"));
const tempDbPath = path.join(tempDir, "mindx_s1_test.db");
const tempRunningPath = path.join(tempDir, "running_classes_s1.json");

process.env.MINDX_DB_PATH = tempDbPath;
process.env.MINDX_RUNNING_CLASSES_PATH = tempRunningPath;
process.env.ALLOWED_LOCAL_DIRS = tempDir;

import { POST as spckListPost } from "../src/app/api/spck/list/route";
import { config } from "../src/lib/config";
if (!config.allowedLocalDirs.includes(tempDir)) {
  config.allowedLocalDirs.push(tempDir);
}
if (!config.allowedLocalDirs.includes(os.tmpdir())) {
  config.allowedLocalDirs.push(os.tmpdir());
}
import { getRunningClasses, saveRunningClasses } from "../src/lib/db/json-config";
import {
  classSessionRepo,
  getDb,
  reportCardRepo,
  studentRepo,
  teachingProjectRepo,
} from "../src/lib/db/sqlite";
import { authService } from "../src/lib/playwright/auth";
import { BrowserManager } from "../src/lib/playwright/browser-manager";
import { SpckUploader } from "../src/lib/playwright/spck-uploader";
import { ClassSyncer } from "../src/lib/playwright/sync-class";
import {
  LiveTeachingHttpTransport,
  TeachingProjectService,
} from "../src/lib/playwright/teaching-project-service";
import {
  LiveTeachingReportCardHttpTransport,
  TeachingReportCardSyncService,
  matchReportCardStudentsToTeaching,
} from "../src/lib/playwright/teaching-report-card-sync";
import { taskQueue } from "../src/lib/queue/task-queue";
import {
  TeachingHttpClient,
  clearSharedTeachingSession,
} from "../src/lib/teaching/teaching-http-client";

function makeLocalPostRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Host: "127.0.0.1:3000",
      Origin: "http://127.0.0.1:3000",
    },
    body: JSON.stringify(body),
  });
}

async function runStageS1Tests() {
  console.log("=== BẮT ĐẦU KIỂM THỬ STAGE S1 (v3.4.0: S1.1 -> S1.7) ===");

  const origFetch = globalThis.fetch;
  const origFetchRunning = ClassSyncer.fetchRunningClasses;
  const origSyncClass = ClassSyncer.syncClass;
  const origUser = config.teachingUsername;
  const origPass = config.teachingPassword;

  try {
    // =========================================================================
    // [S1.1 & S1.2] POST /api/spck/list Queue Discipline & Non-Mutation of running_classes.json
    // =========================================================================
    console.log("\n[S1.1 & S1.2] Kiểm tra POST /api/spck/list chạy qua SequentialTaskQueue & bảo toàn running_classes.json...");

    const initialRunningClasses = [
      {
        classCode: "TEST_S1_ACTIVE_12",
        className: "TEST_S1_ACTIVE_12",
        status: "Running" as const,
        startDate: "01/08/2026",
        endDate: "15/11/2026",
      },
      {
        classCode: "TEST_S1_EXPIRED_FIN",
        className: "TEST_S1_EXPIRED_FIN",
        status: "Finished" as const,
        startDate: "01/01/2025",
        endDate: "01/04/2025",
      },
    ];
    saveRunningClasses(initialRunningClasses);
    const runningBeforeRaw = fs.readFileSync(tempRunningPath, "utf8");

    const executionOrder: string[] = [];
    let observedQueueJobType = "";

    const unsubQueue = taskQueue.subscribeStatus((st) => {
      if (st.isRunning && st.currentTask?.jobType === "SYNC_CLASS") {
        observedQueueJobType = "SYNC_CLASS_OBSERVED";
      }
    });

    ClassSyncer.fetchRunningClasses = async () => {
      executionOrder.push("fetchRunningClasses");
      return {
        success: true,
        classes: initialRunningClasses,
      };
    };

    ClassSyncer.syncClass = async (code: string) => {
      executionOrder.push(`syncClass:${code}`);
      classSessionRepo.upsert({
        classId: code,
        className: code,
        sessionId: `${code}_SESS_12`,
        sessionNumber: 12,
        date: code === "TEST_S1_EXPIRED_FIN" ? "2025-03-15" : "2026-10-25",
        topic: "Buổi 12",
      });
      classSessionRepo.upsert({
        classId: code,
        className: code,
        sessionId: `${code}_SESS_14`,
        sessionNumber: 14,
        date: code === "TEST_S1_EXPIRED_FIN" ? "2025-04-01" : "",
        topic: "Buổi 14",
      });
      studentRepo.upsert({
        classId: code,
        studentId: `${code}_STU_01`,
        fullName: "Nguyễn Minh Khôi",
        isActive: 1,
      });
      return {
        success: true,
        classId: code,
        className: code,
        sessionsCount: 14,
        studentsCount: 1,
      } as any;
    };

    // Enqueue a blocker job first to prove POST /api/spck/list waits in SequentialTaskQueue
    const blockerPromise = taskQueue.enqueue({
      id: "s1_blocker_job",
      jobType: "CUSTOM",
      description: "Blocker job before POST /api/spck/list",
      execute: async () => {
        executionOrder.push("blocker:start");
        await new Promise((r) => setTimeout(r, 40));
        executionOrder.push("blocker:end");
      },
    });

    const postPromise = spckListPost(
      makeLocalPostRequest("http://127.0.0.1:3000/api/spck/list", {
        classId: "TEST_S1_ACTIVE_12",
        sessionNumber: 12,
        forceResyncAll: true,
      })
    );

    const [, postRes] = await Promise.all([blockerPromise, postPromise]);
    unsubQueue();

    const postData = await postRes.json();
    assert.equal(postRes.status, 200);
    assert.equal(postData.success, true);
    assert.equal(observedQueueJobType, "SYNC_CLASS_OBSERVED");
    assert.equal(executionOrder[0], "blocker:start");
    assert.equal(executionOrder[1], "blocker:end");
    assert.equal(executionOrder[2], "fetchRunningClasses");
    assert.ok(executionOrder.includes("syncClass:TEST_S1_ACTIVE_12"));

    // Verify running_classes.json was NOT pruned or mutated by POST /api/spck/list
    const runningAfterRaw = fs.readFileSync(tempRunningPath, "utf8");
    assert.equal(
      runningAfterRaw,
      runningBeforeRaw,
      "S1.2: POST /api/spck/list tuyệt đối không được cắt xén hoặc ghi đè running_classes.json"
    );
    assert.equal(getRunningClasses().length, 2);
    console.log("  -> PASS S1.1 & S1.2.");

    // =========================================================================
    // [S1.3] Shared TeachingHttpClient (Single Login, Student Cache, Stop & Timeout Guard)
    // =========================================================================
    console.log("\n[S1.3] Kiểm tra TeachingHttpClient dùng chung phiên đăng nhập, cache học sinh, Stop & Timeout...");
    (config as any).teachingUsername = "teacher_s1";
    (config as any).teachingPassword = "secret_s1";
    clearSharedTeachingSession();

    let loginGetCount = 0;
    let loginPostCount = 0;
    let studentFetchCount = 0;

    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const url = String(typeof input === "string" ? input : input?.url || input);
      const method = String(init?.method || "GET").toUpperCase();
      if (url.endsWith("/login.php")) {
        if (method === "GET") {
          loginGetCount++;
          return new Response("", {
            status: 200,
            headers: { "set-cookie": "PHPSESSID=shared_sess_s1; Path=/" },
          });
        }
        loginPostCount++;
        return new Response("", {
          status: 302,
          headers: { "set-cookie": "PHPSESSID=shared_sess_s1_auth; Path=/" },
        });
      }
      if (url.includes("get_students_of_class=1")) {
        studentFetchCount++;
        return new Response(
          JSON.stringify([
            {
              id: 501,
              student_name: "Nguyễn Minh Khôi",
              class_code: "TEST_S1_ACTIVE_12",
              status: "đang học",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("get_duan_project=1")) {
        return new Response(
          JSON.stringify({
            id: 901,
            class_code: "TEST_S1_ACTIVE_12",
            project_name: "SPCK - TEST_S1_ACTIVE_12",
            start_date: "2026-08-01",
            end_date: "2026-11-15",
            description: "Dự án cuối khóa",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("get_class_exercises=1")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const projectTransport = new LiveTeachingHttpTransport("https://teachingmindx.top");
    const reportCardTransport = new LiveTeachingReportCardHttpTransport("https://teachingmindx.top");

    const stuFromProject = await projectTransport.getStudents("TEST_S1_ACTIVE_12");
    const stuFromReportCard = await reportCardTransport.getStudents("TEST_S1_ACTIVE_12");
    const prjFromProject = await projectTransport.getProject("TEST_S1_ACTIVE_12");
    const exFromReportCard = await reportCardTransport.getExercises("TEST_S1_ACTIVE_12");

    assert.equal(stuFromProject.length, 1);
    assert.equal(stuFromReportCard.length, 1);
    assert.equal(prjFromProject?.id, 901);
    assert.deepEqual(exFromReportCard, []);
    assert.equal(
      loginPostCount,
      1,
      "S1.3: LiveTeachingHttpTransport và LiveTeachingReportCardHttpTransport phải dùng chung đúng 1 lần đăng nhập"
    );
    assert.equal(
      studentFetchCount,
      1,
      "S1.3: get_students_of_class cho cùng mã lớp phải được tái sử dụng từ bộ nhớ đệm"
    );

    // Verify timeout abort in TeachingHttpClient
    globalThis.fetch = (async (_input: any, init?: RequestInit) => {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason || new Error("Aborted"));
        });
      });
    }) as typeof fetch;

    const fastClient = new TeachingHttpClient("https://teachingmindx.top", 35);
    await assert.rejects(
      async () => {
        await fastClient.getJson("?get_duan_project=1&class_code=TEST_TIMEOUT");
      },
      /Quá thời gian chờ/,
      "S1.3: TeachingHttpClient phải tự động hủy kết nối khi quá thời gian chờ"
    );
    console.log("  -> PASS S1.3.");

    // =========================================================================
    // [S1.4] Direct Retry on FAILED When contentHash Matches vs Demotion on Hash Drift
    // =========================================================================
    console.log("\n[S1.4] Kiểm tra cho phép đồng bộ lại từ trạng thái FAILED khi contentHash khớp & chặn khi lệch Hash...");
    const rcClassId = "TEST_S1_RC_RETRY";
    const rcSnapshot: Parameters<typeof reportCardRepo.saveLmsSnapshot>[1] = {
      classId: rcClassId,
      classCode: rcClassId,
      isRobotics: true,
      scrapedAt: "2026-10-29T12:00:00.000Z",
      btvnSessions: [],
      students: [
        {
          studentId: "STU_RC_01",
          fullName: "Lê Hoàng Bách",
          isActive: true,
          btvnScores: {},
          stageScores: {
            cp1Theory: 4,
            cp1Practice: 4.5,
            cp1Competency: 4.5,
            cp2Theory: 4.5,
            cp2Practice: 4.5,
            cp2Competency: 4.5,
            finalProduct: 4.5,
            finalCompetency: 4.5,
          },
        },
      ],
    };

    const savedRc = reportCardRepo.saveLmsSnapshot(rcClassId, rcSnapshot);
    const approvedRc = reportCardRepo.approveReportCard(
      rcClassId,
      savedRc.draftVersion
    );
    assert.equal(approvedRc.record.status, "APPROVED");

    // Simulate a transient network failure that left status = FAILED while preserving contentHash
    const failedRc = reportCardRepo.markTeachingSyncFailed(
      rcClassId,
      "Lỗi mạng tạm thời khi kết nối Teaching"
    );
    assert.equal(failedRc.status, "FAILED");
    assert.ok(failedRc.contentHash, "Bản ghi FAILED phải còn giữ contentHash đã duyệt");

    const remoteExercises: any[] = [];
    const remoteScores: any[] = [];
    let nextExId = 1;
    const mockRcTransport = {
      getStudents: async () => [
        {
          id: 701,
          student_name: "Lê Hoàng Bách",
          class_code: rcClassId,
          status: "đang học",
        },
      ],
      getExercises: async () => [...remoteExercises],
      addMultiExercise: async (payload: any) => {
        for (const sn of payload.sessions) {
          for (const form of payload.exerciseForms) {
            const max =
              form === "nang_luc"
                ? payload.maxScoreNangLuc ?? 5
                : payload.maxScore;
            remoteExercises.push({
              id: nextExId++,
              class_code: payload.classCode,
              session_number: sn,
              exercise_type: payload.exerciseType,
              exercise_form: form,
              exercise_title: payload.exerciseTitle || "",
              max_score: max,
            });
          }
        }
        return { success: true };
      },
      saveScores: async (batch: any[]) => {
        for (const item of batch) {
          const norm = Math.round(((item.raw_score / item.max_score) * 5) * 100) / 100;
          remoteScores.push({
            student_id: item.student_id,
            class_code: item.class_code,
            session_number: item.session_number,
            exercise_type: item.exercise_type,
            exercise_form: item.exercise_form,
            raw_score: item.raw_score,
            normalized_score: norm,
            max_score: item.max_score,
            note: item.note,
          });
        }
        return { success: true };
      },
      getScores: async () => [...remoteScores],
    };

    const retryFromFailedRes = await TeachingReportCardSyncService.syncReportCardToTeaching(
      rcClassId,
      {
        classCode: rcClassId,
        expectedVersion: failedRc.draftVersion,
        transport: mockRcTransport as any,
      }
    );
    assert.equal(
      retryFromFailedRes.success,
      true,
      `S1.4: Đồng bộ lại từ trạng thái FAILED khi contentHash khớp phải thành công (error=${retryFromFailedRes.error})`
    );
    assert.equal(retryFromFailedRes.record?.status, "VERIFIED");

    // Now test FAILED + tampered contentHash -> must reject with HTTP 400 and demote to WAITING_APPROVAL
    reportCardRepo.markTeachingSyncFailed(rcClassId, "Simulated error 2");
    getDb()
      .prepare(`UPDATE class_report_cards SET contentHash = 'tampered_hash_s1' WHERE classId = ?`)
      .run(rcClassId);
    const curTampered = reportCardRepo.findOne(rcClassId)!;
    const tamperedRetryRes = await TeachingReportCardSyncService.syncReportCardToTeaching(
      rcClassId,
      {
        classCode: rcClassId,
        expectedVersion: curTampered.draftVersion,
        transport: mockRcTransport as any,
      }
    );
    assert.equal(tamperedRetryRes.success, false);
    assert.equal(tamperedRetryRes.statusCode, 400);
    assert.equal(tamperedRetryRes.record?.status, "WAITING_APPROVAL");

    // Verify UI button condition in teaching-report-card-view.tsx allows FAILED with contentHash
    const rcViewSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/teaching-report-card-view.tsx"),
      "utf8"
    );
    assert.ok(
      rcViewSource.includes('!(record.status === "FAILED" && Boolean(record.contentHash))'),
      "S1.4: teaching-report-card-view.tsx phải cho phép bấm Đồng bộ lại khi status === FAILED và có contentHash"
    );

    // Also verify TeachingProjectService.syncProjectAndTasksToTeaching allows direct retry from FAILED when contentHash matches
    const tpClassId = "TEST_S1_TP_RETRY";
    const tpInit = teachingProjectRepo.getOrInit(tpClassId, {
      projectName: "Dự án Cuối khóa S1",
      startDate: "2026-08-01",
      endDate: "2026-11-15",
      description: "Mô tả dự án S1",
      students: [{ id: 801, studentName: "Trần Gia Huy", classCode: tpClassId, status: "đang học" }],
      tasks: [1, 2, 3, 4, 5].map((idx) => ({
        slotIndex: idx,
        taskName: `Phần việc ${idx}`,
        description: `Chi tiết phần việc ${idx}`,
        weightPercent: 20,
        deadline: "2026-11-15",
        assignedStudentIds: [801],
      })),
    });
    const tpApproved = teachingProjectRepo.approveDraft(tpClassId, tpInit.draftVersion);
    assert.equal(tpApproved.success, true);
    assert.equal(tpApproved.record.status, "APPROVED");

    const tpFailed = teachingProjectRepo.markFailed(tpClassId, "Lỗi kết nối mạng tạm thời");
    assert.equal(tpFailed.status, "FAILED");
    assert.ok(tpFailed.contentHash);

    const mockTpTasks: any[] = [];
    let nextTpTaskId = 100;
    const mockTpTransport = {
      getProject: async () => ({
        id: 950,
        class_code: tpClassId,
        project_name: "Dự án Cuối khóa S1",
        start_date: "2026-08-01",
        end_date: "2026-11-15",
        description: "Mô tả dự án S1",
      }),
      getStudents: async () => [
        { id: 801, student_name: "Trần Gia Huy", class_code: tpClassId, status: "đang học" },
      ],
      getTasks: async () => [...mockTpTasks],
      getTaskProgress: async () => ({}),
      createProject: async () => ({ success: true, id: 950 }),
      saveTask: async (p: any) => {
        const id = p.taskId || ++nextTpTaskId;
        const row = {
          id,
          project_id: 950,
          task_name: p.taskName,
          description: p.description,
          weight_percent: p.weightPercent,
          deadline: p.deadline,
          assigned_students: p.assignedStudentIds,
          status: "doing",
        };
        const existingIdx = mockTpTasks.findIndex((t) => t.id === id);
        if (existingIdx >= 0) mockTpTasks[existingIdx] = row;
        else mockTpTasks.push(row);
        return { success: true, id };
      },
      deleteTask: async () => ({ success: true }),
      updateTaskProgress: async () => ({ success: true }),
    };

    const tpRetryRes = await TeachingProjectService.syncProjectAndTasksToTeaching(tpClassId, {
      transport: mockTpTransport as any,
    });
    assert.equal(
      tpRetryRes.success,
      true,
      `S1.4: TeachingProjectService.syncProjectAndTasksToTeaching phải cho phép thử lại từ FAILED khi contentHash khớp (error=${tpRetryRes.error})`
    );
    assert.equal(tpRetryRes.record.status, "VERIFIED");
    console.log("  -> PASS S1.4.");

    // =========================================================================
    // [S1.5] final-project/page.tsx selectedSessionNumber Resolution
    // =========================================================================
    console.log("\n[S1.5] Kiểm tra final-project/page.tsx ưu tiên đọc data.selectedSessionNumber...");
    const fpPageSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/final-project/page.tsx"),
      "utf8"
    );
    const occurrences = fpPageSource.split("data.selectedSessionNumber ?? data.activeSessionNumber").length - 1;
    assert.ok(
      occurrences >= 2,
      `S1.5: final-project/page.tsx phải đọc data.selectedSessionNumber ?? data.activeSessionNumber ở cả loadClassData và handleScanTeacherClasses (found=${occurrences})`
    );
    console.log("  -> PASS S1.5.");

    // =========================================================================
    // [S1.6] spck-uploader.ts Dynamic Slot ID Resolution (No Hardcoded VT-C4K-PTA12)
    // =========================================================================
    console.log("\n[S1.6] Kiểm tra spck-uploader.ts đã gỡ bỏ slot ID cứng VT-C4K-PTA12 và lấy động từ DB / GraphQL...");
    const uploaderSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/playwright/spck-uploader.ts"),
      "utf8"
    );
    assert.ok(
      !uploaderSource.includes("6a5dd58c8c3ce9e30a9877ab") &&
        !uploaderSource.includes("6a5dd58c8c3ce9e30a9877ac") &&
        !uploaderSource.includes("6a5dd58c8c3ce9e30a9877ad"),
      "S1.6: spck-uploader.ts không được chứa mã slot ID cứng của lớp VT-C4K-PTA12"
    );

    // Verify dynamic slot ID resolution from classSessionRepo (24-hex LMS slot ID) in clearSessionSpck
    const dynamicClassId = "TEST_S1_DYN_SLOT";
    const dynamicSlot13Id = "6b112233445566778899aabb";
    classSessionRepo.upsert({
      classId: dynamicClassId,
      className: dynamicClassId,
      sessionId: dynamicSlot13Id,
      sessionNumber: 13,
      date: "2026-10-28",
      topic: "Buổi 13",
    });

    let evaluatedTargetSessionId = "";
    const fakeClearPage: any = {
      on: () => {},
      off: () => {},
      url: () => "https://lms.mindx.edu.vn/admin/classes",
      waitForTimeout: async () => {},
      keyboard: { press: async () => {} },
      locator: () => {
        const loc: any = {
          first: () => loc,
          nth: () => loc,
          locator: () => loc,
          waitFor: async () => {},
          evaluate: async () => true,
          evaluateAll: async () => false,
          isVisible: async () => false,
          count: async () => 0,
        };
        return loc;
      },
      evaluate: async (fnOrStr: any, arg?: any) => {
        if (typeof fnOrStr === "string") return;
        if (arg && typeof arg === "object" && "targetSessionId" in arg) {
          evaluatedTargetSessionId = arg.targetSessionId;
          return {
            lmsClassId: "lms_cls_dyn_1",
            className: dynamicClassId,
            targetSession: arg.targetSession,
            effectiveSessionId: arg.targetSessionId,
            foundTotalWorksInClass: 0,
            deletedCount: 0,
            deletedItems: [],
            deleteErrors: [],
            failedDeleteStudentIds: [],
            remainingActiveCount: 0,
            remainingActiveForSession: [],
          };
        }
        return true;
      },
    };

    const clearRes = await SpckUploader.clearSessionSpck({
      classId: dynamicClassId,
      sessionNumber: 13,
      customPage: fakeClearPage,
    });
    assert.equal(clearRes.effectiveSessionId, dynamicSlot13Id);
    assert.equal(
      evaluatedTargetSessionId,
      dynamicSlot13Id,
      "S1.6: clearSessionSpck phải tự động lấy mã slot 24-hex từ classSessionRepo khi chưa bắt được từ request mạng"
    );
    console.log("  -> PASS S1.6.");

    // =========================================================================
    // [S1.7] Documentation of Student Portal Exception in AGENTS.md / GEMINI.md / PROJECT_STATE.md
    // =========================================================================
    console.log("\n[S1.7] Kiểm tra tài liệu hóa ngoại lệ Student Portal trong AGENTS.md, GEMINI.md và PROJECT_STATE.md...");
    for (const docFile of ["AGENTS.md", "GEMINI.md", "PROJECT_STATE.md"]) {
      const content = fs.readFileSync(path.resolve(process.cwd(), docFile), "utf8");
      assert.ok(
        content.includes("student-portal-server.ts") && content.includes("sessionToken"),
        `S1.7: ${docFile} phải ghi rõ ngoại lệ có chủ đích cho student-portal-server.ts kèm khóa bảo vệ sessionToken`
      );
    }
    console.log("  -> PASS S1.7.");

    // =========================================================================
    // [S1-R1 REGRESSIONS] Verify Codex Round 1 Findings S1-01 .. S1-05
    // =========================================================================
    console.log("\n[S1-R1 REGRESSIONS] Kiểm tra đóng toàn bộ 5 phát hiện S1-01..S1-05 từ Codex Round 1...");

    // 1. S1-01 (P10): Calling POST /api/spck/list with the REAL ClassSyncer.fetchRunningClasses
    // must NOT overwrite or prune data/running_classes.json.
    ClassSyncer.fetchRunningClasses = origFetchRunning;
    saveRunningClasses(initialRunningClasses);
    const beforeRealScanRaw = fs.readFileSync(tempRunningPath, "utf8");

    const bm = BrowserManager.getInstance();
    const origGetPage = bm.getPage;
    const origEnsureAuth = authService.ensureAuthenticated;
    const dummyLoc = (): any => {
      const l: any = {
        first: () => l,
        nth: () => l,
        locator: () => l,
        waitFor: async () => {},
        evaluate: async () => true,
        evaluateAll: async () => false,
        isVisible: async () => false,
        isEnabled: async () => false,
        getAttribute: async () => null,
        count: async () => 0,
        click: async () => {},
      };
      return l;
    };
    bm.getPage = async () =>
      ({
        url: () => "https://lms.mindx.edu.vn/admin/classes",
        locator: () => dummyLoc(),
        keyboard: { press: async () => {} },
        waitForTimeout: async () => {},
        evaluate: async () => [
          {
            classCode: "TEST_S1_ACTIVE_12",
            courseName: "Course A",
            center: "Center A",
            status: "Running",
            rowStartDate: "01/08/2026",
            rowEndDate: "15/11/2026",
          },
          {
            classCode: "TEST_S1_EXPIRED_FIN",
            courseName: "Course B",
            center: "Center B",
            status: "Finished",
            rowStartDate: "01/01/2025",
            rowEndDate: "01/04/2025",
          },
        ],
      }) as any;
    authService.ensureAuthenticated = async () => {};
    try {
      const p10Res = await spckListPost(
        makeLocalPostRequest("http://127.0.0.1:3000/api/spck/list", {})
      );
      assert.equal(p10Res.status, 200);
      const afterRealScanRaw = fs.readFileSync(tempRunningPath, "utf8");
      assert.equal(
        afterRealScanRaw,
        beforeRealScanRaw,
        "S1-01 (P10): ClassSyncer.fetchRunningClasses thật khi gọi từ POST /api/spck/list không được ghi đè running_classes.json"
      );
    } finally {
      bm.getPage = origGetPage;
      authService.ensureAuthenticated = origEnsureAuth;
    }

    // 2. S1-02 (P07) & S1-05 (P06): Shared cache must store raw payload (preserving boolean IDs for strict check)
    // and must partition cache by teachingUsername.
    clearSharedTeachingSession();
    (config as any).teachingUsername = "AUDIT_USER_A";
    (config as any).teachingPassword = "PASS";
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const url = String(typeof input === "string" ? input : input?.url || input);
      const method = String(init?.method || "GET").toUpperCase();
      if (url.endsWith("/login.php")) {
        return new Response("", {
          status: method === "POST" ? 302 : 200,
          headers: { "set-cookie": `PHPSESSID=${config.teachingUsername}; Path=/` },
        });
      }
      if (url.includes("get_students_of_class=1")) {
        if (url.includes("CLS_BOOL")) {
          return new Response(
            JSON.stringify([
              {
                id: true,
                student_name: "Lê Hoàng Bách",
                class_code: "CLS_BOOL",
                status: "đang học",
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify([
            {
              id: config.teachingUsername === "AUDIT_USER_A" ? 101 : 202,
              student_name: "Lê Hoàng Bách",
              class_code: "CLS_ACCT",
              status: "đang học",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }) as typeof fetch;

    const projTrans = new LiveTeachingHttpTransport("https://teachingmindx.top");
    const rcTrans = new LiveTeachingReportCardHttpTransport("https://teachingmindx.top");
    // Warm cache via Project transport first (which coerces id: true -> 1 for its own return)
    await projTrans.getStudents("CLS_BOOL");
    // Now Report Card transport reads from warm cache -> must still see raw id: true and reject in matchReportCardStudentsToTeaching!
    const warmedStrictStudents = await rcTrans.getStudents("CLS_BOOL");
    assert.throws(
      () =>
        matchReportCardStudentsToTeaching(
          [
            {
              studentId: "STU_01",
              fullName: "Lê Hoàng Bách",
              isActive: true,
            } as any,
          ],
          warmedStrictStudents,
          "CLS_BOOL",
          true
        ),
      /ID học sinh/,
      "S1-02 (P07): Warm cache sau khi Project đọc trước vẫn phải giữ nguyên kiểm tra chặt ID boolean cho Report Card"
    );

    // S1-05 (P06): Switching teachingUsername must not return cached roster from previous user
    const sharedClient = new TeachingHttpClient("https://teachingmindx.top");
    (config as any).teachingUsername = "AUDIT_USER_A";
    const listUserA = await sharedClient.getStudentsOfClass("CLS_ACCT");
    assert.equal(listUserA[0].id, 101);
    (config as any).teachingUsername = "AUDIT_USER_B";
    const listUserB = await sharedClient.getStudentsOfClass("CLS_ACCT");
    assert.equal(
      listUserB[0].id,
      202,
      "S1-05 (P06): Đổi config.teachingUsername phải tách khóa cache học sinh theo tài khoản"
    );

    // 3. S1-03 (P09 & P15): Stop triggered during empty scan or during last syncClass must NOT return success: true
    saveRunningClasses([]);
    ClassSyncer.fetchRunningClasses = async () => {
      taskQueue.stopQueue();
      return { success: true, classes: [] };
    };
    const p09Res = await spckListPost(
      makeLocalPostRequest("http://127.0.0.1:3000/api/spck/list", {})
    );
    const p09Data = await p09Res.json();
    assert.equal(
      p09Data.success,
      false,
      "S1-03 (P09): Stop trong lúc fetchRunningClasses trả rỗng phải báo lỗi hủy, không được trả success: true"
    );
    taskQueue.resumeQueue();

    saveRunningClasses([{ classCode: "TEST_S1_LAST_STOP", status: "Running" }]);
    ClassSyncer.fetchRunningClasses = async () => ({
      success: true,
      classes: [{ classCode: "TEST_S1_LAST_STOP", status: "Running" }],
    });
    ClassSyncer.syncClass = async () => {
      taskQueue.stopQueue();
      return {
        success: true,
        classId: "TEST_S1_LAST_STOP",
        className: "TEST_S1_LAST_STOP",
        sessionsCount: 0,
        studentsCount: 0,
      } as any;
    };
    const p15Res = await spckListPost(
      makeLocalPostRequest("http://127.0.0.1:3000/api/spck/list", {})
    );
    const p15Data = await p15Res.json();
    assert.equal(
      p15Data.success,
      false,
      "S1-03 (P15): Stop ở syncClass của lớp cuối cùng phải báo lỗi hủy, không được trả success: true"
    );
    taskQueue.resumeQueue();

    // 4. S1-04 (P14): Malformed non-24-hex slot ID returned by GetClassSlots must NOT allow deleting work without sessionNumber
    const badSlotDeleted: string[] = [];
    const badSlotWorks = [
      {
        id: "WORK_BAD_SLOT",
        studentId: "STU_BAD_SLOT",
        classSessionId: "not-a-24-hex-slot",
        classId: "LMS_CLS_BAD",
        isDeleted: false,
        latestData: { title: "Bad slot work" },
      },
    ];
    const fakeGqlFetch = async (_url: any, init: any) => {
      const { query, variables } = JSON.parse(init.body);
      if (query.includes("FindClass")) {
        return new Response(
          JSON.stringify({
            data: { classes: { data: [{ id: "LMS_CLS_BAD", name: "TEST_S1_BAD_SLOT" }] } },
          }),
          { status: 200 }
        );
      }
      if (query.includes("GetClassSlots")) {
        return new Response(
          JSON.stringify({
            data: {
              class: {
                slots: Array.from({ length: 14 }, (_, i) => ({
                  _id: i === 12 ? "not-a-24-hex-slot" : "f".repeat(24),
                })),
              },
            },
          }),
          { status: 200 }
        );
      }
      if (query.includes("DeleteWork")) {
        badSlotDeleted.push(variables.payload.id);
        return new Response(
          JSON.stringify({
            data: { studentWorks: { del: { id: variables.payload.id, isDeleted: true } } },
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({ data: { findAllStudentWorks: { data: badSlotWorks } } }),
        { status: 200 }
      );
    };
    const badSlotPage: any = {
      on: () => {},
      off: () => {},
      url: () => "https://lms.mindx.edu.vn/admin/classes",
      waitForTimeout: async () => {},
      keyboard: { press: async () => {} },
      locator: () => dummyLoc(),
      evaluate: async (fn: any, arg: any) => {
        if (typeof fn === "string") return;
        return vm.runInNewContext(`(${fn.toString()})(arg)`, {
          arg,
          __name: (f: any) => f,
          fetch: fakeGqlFetch,
          console,
          URL,
          URLSearchParams,
          setTimeout,
          clearTimeout,
        });
      },
    };
    await assert.rejects(
      async () => {
        await SpckUploader.clearSessionSpck({
          classId: "TEST_S1_BAD_SLOT",
          sessionNumber: 13,
          customPage: badSlotPage,
        });
      },
      /thiếu định danh buổi học/,
      "S1-04 (P14): Slot ID không đúng chuẩn 24-hex từ GetClassSlots phải chặn xóa bài thiếu classSessionNumber"
    );
    assert.equal(badSlotDeleted.length, 0);
    console.log("  -> PASS S1-R1 REGRESSIONS (S1-01..S1-05).");

    console.log("\n🎉 HOÀN TẤT: TẤT CẢ KIỂM THỬ STAGE S1 (S1.1 -> S1.7 + S1-01..S1-05) ĐỀU PASS 100%!");
  } finally {
    globalThis.fetch = origFetch;
    ClassSyncer.fetchRunningClasses = origFetchRunning;
    ClassSyncer.syncClass = origSyncClass;
    (config as any).teachingUsername = origUser;
    (config as any).teachingPassword = origPass;
    clearSharedTeachingSession();
    try {
      getDb().close();
    } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

runStageS1Tests().catch((err) => {
  console.error("❌ KIỂM THỬ STAGE S1 THẤT BẠI:", err);
  process.exit(1);
});
