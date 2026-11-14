import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import * as esbuild from "esbuild";
import { chromium } from "playwright";

const ROOT = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-admin-v350-test-"));
const tempConfigDir = path.join(tempDir, "config");
const tempRoleDir = path.join(tempDir, "role-state");
fs.mkdirSync(tempConfigDir, { recursive: true });
fs.mkdirSync(tempRoleDir, { recursive: true });

process.env.MINDX_DB_PATH = path.join(tempDir, "mindx_admin_test.db");
process.env.MINDX_CONFIG_DIR = tempConfigDir;
process.env.MINDX_RUNNING_CLASSES_PATH = path.join(tempDir, "running_classes.json");
process.env.MINDX_LMS_CLASS_IDS_PATH = path.join(tempConfigDir, "lms_class_ids.json");
process.env.MINDX_ROLE_STATE_DIR = tempRoleDir;
process.env.ALLOWED_LOCAL_DIRS = tempDir;

// Deterministic dummy credentials for unit tests (never real secrets)
process.env.ADMIN_LMS_USERNAME = "tuanpa_test@mindx.net.vn";
process.env.ADMIN_LMS_PASSWORD = "DummyAdminSecret_NoLeak_987";
process.env.ADMIN_TEACHING_USERNAME = "quangda_test";
process.env.ADMIN_TEACHING_PASSWORD = "DummyTeachingSecret_NoLeak_654";
process.env.ADMIN_CENTER_CODE = "205ALHP";
process.env.TEACHING_USERNAME = "quangda_test";
process.env.TEACHING_PASSWORD = "DummyTeachingSecret_NoLeak_654";
process.env.LMS_USERNAME = "teacher_test@mindx.edu.vn";
process.env.LMS_PASSWORD = "DummyTeacherLmsSecret_321";
process.env.GEMINI_API_KEY = "AIzaDummyKeyDoNotLeak123456";

function createTsconfigAliasPlugin(): esbuild.Plugin {
  return {
    name: "tsconfig-path-alias",
    setup(build) {
      build.onResolve({ filter: /^@\// }, (args) => {
        const subPath = args.path.slice(2);
        const targetBase = path.join(ROOT, "src", subPath);
        for (const ext of ["", ".tsx", ".ts", ".jsx", ".js", "/index.ts", "/index.tsx"]) {
          const candidate = targetBase + ext;
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return { path: candidate };
          }
        }
        return { path: targetBase };
      });
    },
  };
}

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(ent.name)) {
      out.push(full);
    }
  }
  return out;
}

function makeCodingClassByIdGql(params: {
  lmsClassId: string;
  classCode: string;
  courseName: string;
  startDate: string;
  endDate: string;
  mainTeacher: string;
  students: Array<{ id: string; fullName: string }>;
  currentSessionNumber: number;
  attendancePresentIndices?: number[];
  missingCommentStudentIds?: string[];
  btvnUngradedForStudentId?: string;
  spckMissingUploadStudentId?: string;
  spckMissingCommentStudentId?: string;
  spckMissingMediaStudentId?: string;
  s14FinalEvalMissingStudentId?: string;
}) {
  const presentSet = new Set(params.attendancePresentIndices || [0, 1]);
  const slots: any[] = [];
  const totalSlots = Math.max(14, params.currentSessionNumber);
  for (let i = 0; i < totalSlots; i++) {
    const sn = i + 1;
    const occurred = sn <= params.currentSessionNumber;
    const slotDate = new Date(Date.UTC(2026, 9, 1 + i * 7, 10, 0, 0)).toISOString();
    const studentAttendance = params.students.map((stu, stuIdx) => {
      if (!occurred) {
        return {
          student: { id: stu.id, fullName: stu.fullName },
          status: "",
          comment: "",
          point: null,
          evaluation: null,
        };
      }
      const isPresent = presentSet.has(stuIdx);
      const isMissingComment =
        sn === params.currentSessionNumber &&
        (params.missingCommentStudentIds || []).includes(stu.id);
      const missingS14 =
        sn === 14 && params.s14FinalEvalMissingStudentId === stu.id;

      const commentText =
        sn === 14
          ? missingS14
            ? "Tổng kết ngắn"
            : "- **Học được:** Con làm game rất sáng tạo trong khóa.\n- **Điểm cần cải thiện:** Cần rèn thêm thói quen test kỹ.\n- **Gợi ý định hướng:** Tiếp tục khóa nâng cao tại MindX."
          : isMissingComment
          ? ""
          : "- **Điểm mạnh:** Con hiểu bài nhanh.\n- **Điểm cần cải thiện:** Chú ý biến.\n- **Lời khuyên:** Luyện tập thêm.";

      const criteriaEval =
        sn === 14 && !missingS14
          ? {
              criteria: Array.from({ length: 9 }, (_, ci) => ({
                code: `DNL_${ci + 1}`,
                level: 4,
              })),
            }
          : null;

      const commentByAreas: any[] = [];
      if (sn === 5 || sn === 9) {
        commentByAreas.push(
          { type: "RATE", grade: 4 },
          {
            type: "CHECKPOINT",
            checkpoint: { checkpointScore: 4, practiceScore: 4 },
          }
        );
      } else if (sn === 14 && !missingS14) {
        for (let ci = 0; ci < 9; ci++) {
          commentByAreas.push({ type: "RATE", grade: 4 });
        }
        commentByAreas.push(
          { type: "DEMO", grade: 4.5 },
          { type: "CONTENT", content: commentText }
        );
      }

      return {
        student: { id: stu.id, fullName: stu.fullName },
        status: isPresent ? "ATTENDED" : "ABSENT",
        comment: isPresent || sn === 14 ? commentText : "",
        commentByAreas,
        point: sn === 14 && !missingS14 ? 4.5 : sn === 5 || sn === 9 ? 4 : null,
        evaluation: criteriaEval,
      };
    });

    slots.push({
      _id: `slot_${params.classCode}_${sn}`,
      index: i,
      date: slotDate,
      startTime: slotDate,
      summary: occurred ? `<p>Nội dung buổi ${sn} & BTVN</p>` : "",
      studentAttendance,
    });
  }

  // Submissions GQL for Coding BTVN (mirrors live FindStudentSubmissionByClass: students + studentUid + submissions)
  const lessons = [1, 2, 3].map((sn) => ({
    id: `lesson_${params.classCode}_${sn}`,
    name: `Buổi ${sn}: Thực hành ${sn}`,
    displayOrder: sn,
    type: "REVIEW_AND_PRACTICE",
  }));

  const gqlStudents = params.students.map((s, idx) => ({
    id: s.id,
    studentUid: `uid_${s.id}_${idx}`,
    displayName: s.fullName,
  }));

  const submissions: any[] = [];
  for (const l of lessons) {
    for (let sIdx = 0; sIdx < params.students.length; sIdx++) {
      const stu = params.students[sIdx];
      const studentUid = `uid_${stu.id}_${sIdx}`;
      const isUngraded =
        l.displayOrder === 3 && params.btvnUngradedForStudentId === stu.id;
      const missedAll3 = stu.fullName.includes("Quốc Bảo");
      if (missedAll3) continue;
      submissions.push({
        id: `sub_${l.id}_${stu.id}`,
        lessonId: l.id,
        studentUid,
        category: "PRACTICE_TASK",
        status: isUngraded ? "SUBMITTED" : "MARKED",
        score: isUngraded ? null : 85,
        totalScore: 100,
        submittedCount: 1,
        submittedAt: "2026-10-15T12:00:00.000Z",
      });
    }
  }

  // Student works for SPCK sessions 12..14
  const studentWorks: any[] = [];
  if (params.currentSessionNumber >= 12) {
    for (const sn of [12, 13, 14]) {
      if (sn > params.currentSessionNumber) break;
      const slotId = `slot_${params.classCode}_${sn}`;
      for (let idx = 0; idx < params.students.length; idx++) {
        const stu = params.students[idx];
        // On B12/B13, absent student is exempt; test uses spckMissingUploadStudentId on present student
        if (sn === 12 && params.spckMissingUploadStudentId === stu.id) continue;
        if (sn === 12 && !presentSet.has(idx)) continue;

        const missingMedia =
          sn === 12 && params.spckMissingMediaStudentId === stu.id;
        const missingComment =
          sn === 12 && params.spckMissingCommentStudentId === stu.id;

        studentWorks.push({
          id: `work_${params.classCode}_${sn}_${stu.id}`,
          classSessionId: slotId,
          classSessionNumber: sn,
          studentId: stu.id,
          isDeleted: false,
          latestData: {
            title: `SPCK ${stu.fullName}`,
            comment: missingComment ? "" : "Sản phẩm sáng tạo, hoàn thiện tốt!",
            thumbnail: missingMedia ? "" : "https://example.mindx/thumb.png",
            screenshots: missingMedia ? [] : ["https://example.mindx/s1.png"],
            attachments: [],
          },
        });
      }
    }
  }

  return {
    classByIdData: {
      id: params.lmsClassId,
      name: params.classCode,
      status: "Running",
      startDate: params.startDate,
      endDate: params.endDate,
      course: { name: params.courseName },
      teachers: [
        { teacher: { fullName: params.mainTeacher }, role: { name: "Teacher" } },
      ],
      students: params.students.map((s) => ({
        student: { id: s.id, fullName: s.fullName },
        activeInClass: true,
      })),
      slots,
    },
    submissionGqlData: {
      lessons,
      students: gqlStudents,
      submissions,
    },
    studentWorks,
  };
}

async function main() {
  const { getSafePublicConfig } = await import("../src/lib/config");
  const {
    closeDb,
    adminCenterRepo,
    reportCardRepo,
    classSessionRepo,
    jobLogRepo,
    getDb,
    normalizeDateToIsoYmd,
  } = await import("../src/lib/db/sqlite");
  const {
    isMindxAuthDomain,
    filterMindxCookiesForBackup,
    AuthService,
    authService,
  } = await import("../src/lib/playwright/auth");
  const { browserManager } = await import("../src/lib/playwright/browser-manager");
  const { LmsHelpers } = await import("../src/lib/playwright/lms-helpers");
  const { redactSecrets } = await import("../src/lib/security/secret-redactor");
  const { taskQueue } = await import("../src/lib/queue/task-queue");
  const { mapSessionToTeachingProgressMilestone } = await import(
    "../src/lib/teaching/session-progress-mapper"
  );
  const { getStandardFiveTasksForClass } = await import(
    "../src/lib/gemini/teaching-project-generator"
  );
  const {
    parseTeachingWeeklyScheduleHtml,
    parseTeachingCheckNhanXetHtml,
    parseTeachingHocBuHtml,
    parseTeachingHocBuDatatableJson,
    fetchAdminTeachingOverviewPages,
  } = await import("../src/lib/admin-center/admin-teaching-scraper");
  const {
    mapSessionToCompletedTaskMilestoneCount,
    mapSessionToTargetProgressPercent,
    computeAdminClassAudits,
    evaluateTeachingSpckTasksCompliance,
    fetchSingleLmsClassGqlInAdminSession,
    scanAdminCenterClasses,
    buildAdminOverviewResponse,
    getAdminScanProgressState,
    resetAdminScanProgressForTest,
    assertMatchingLmsClassPayload,
  } = await import("../src/lib/admin-center/admin-lms-scanner");
  const {
    syncAdminClassBtvnToTeaching,
    syncAdminBatchBtvnToTeaching,
    provisionAdminSpckTasksOnTeaching,
    provisionAdminBatchSpckTasksOnTeaching,
  } = await import("../src/lib/admin-center/admin-teaching-actions");
  const { GET: overviewGET } = await import(
    "../src/app/api/admin-center/overview/route"
  );
  const { POST: scanPOST } = await import(
    "../src/app/api/admin-center/scan/route"
  );
  const { POST: syncBtvnPOST } = await import(
    "../src/app/api/admin-center/sync-btvn/route"
  );
  const { POST: provisionSpckPOST } = await import(
    "../src/app/api/admin-center/provision-spck-tasks/route"
  );

  // Hard guard: offline unit tests must NEVER launch or touch live ./playwright-auth Chromium
  (browserManager as any).getPage = async () => {
    throw new Error("[Test Isolation Guard] Live browserManager.getPage() blocked in offline test");
  };
  (browserManager as any).getContext = async () => {
    throw new Error("[Test Isolation Guard] Live browserManager.getContext() blocked in offline test");
  };

  try {
    // =========================================================================
    // [AC-01] Secret Redaction & Milestone Parity
    // =========================================================================
    const safeCfgJson = JSON.stringify(getSafePublicConfig());
    const overviewInitJson = JSON.stringify(buildAdminOverviewResponse());
    for (const secretVal of [
      process.env.ADMIN_LMS_PASSWORD!,
      process.env.ADMIN_TEACHING_PASSWORD!,
      process.env.LMS_PASSWORD!,
      process.env.GEMINI_API_KEY!,
    ]) {
      assert(!safeCfgJson.includes(secretVal), `[AC-01] Secret leaked in getSafePublicConfig`);
      assert(!overviewInitJson.includes(secretVal), `[AC-01] Secret leaked in buildAdminOverviewResponse`);
    }
    const safeCfg = getSafePublicConfig();
    assert.equal(safeCfg.adminCenterCode, "205ALHP");
    assert.equal(safeCfg.hasAdminLmsAuth, true);
    assert(safeCfg.adminLmsUsernameMasked.includes("***"), "Expected masked Admin LMS username");

    for (const sn of [0, 9, 10, 11, 12, 13, 14, 15]) {
      const m = mapSessionToTeachingProgressMilestone(sn);
      assert.equal(mapSessionToCompletedTaskMilestoneCount(sn), m.milestoneTaskCount);
      assert.equal(mapSessionToTargetProgressPercent(sn), m.targetPercent);
    }
    console.log("PASS [AC-01] Secret redaction & session milestone parity");

    // =========================================================================
    // [AC-02] Role-aware LMS Session Switcher & Unconditional Teacher Restore
    // =========================================================================
    assert.equal(isMindxAuthDomain(".lms.mindx.edu.vn"), true);
    assert.equal(isMindxAuthDomain("base.mindx.edu.vn"), true);
    assert.equal(isMindxAuthDomain(".google.com"), false);

    const mixedCookies = [
      { name: "accessToken", value: "t_jwt", domain: ".lms.mindx.edu.vn", path: "/" },
      { name: "SID", value: "g_drive_keep", domain: ".google.com", path: "/" },
    ];
    const filteredMindx = filterMindxCookiesForBackup(mixedCookies as any);
    assert.equal(filteredMindx.length, 1);
    assert.equal(filteredMindx[0].name, "accessToken");

    const authSvc = new AuthService();
    let restoreCalls = 0;
    let lastRestoredRole = "";
    let activeIdentity = "teacher_test@mindx.edu.vn";
    const fakeAdapter = {
      getCredentials: (role: "TEACHER" | "ADMIN") =>
        role === "ADMIN"
          ? { username: "tuanpa_test@mindx.net.vn", password: "pw" }
          : { username: "teacher_test@mindx.edu.vn", password: "pw" },
      captureCurrentSnapshot: async () => ({
        role: "TEACHER" as const,
        username: "teacher_test@mindx.edu.vn",
        cookies: filteredMindx as any,
        localStorage: { mindx_user: "teacher_test@mindx.edu.vn" },
        savedAt: new Date().toISOString(),
      }),
      restoreSnapshot: async (snap: any) => {
        restoreCalls++;
        lastRestoredRole = snap.username;
        activeIdentity = snap.username;
      },
      ensureRoleAuthenticated: async () => {
        activeIdentity = "tuanpa_test@mindx.net.vn";
        return {
          page: {} as any,
          detectedIdentity: activeIdentity,
        };
      },
      verifyActiveIdentity: async () => activeIdentity,
    };

    const resNormal = await authSvc.withAdminLmsSession(async () => "OK_ADMIN", {
      roleAdapter: fakeAdapter,
    });
    assert.equal(resNormal, "OK_ADMIN");
    assert.equal(restoreCalls, 1);
    assert.equal(lastRestoredRole, "teacher_test@mindx.edu.vn");

    await assert.rejects(
      authSvc.withAdminLmsSession(
        async () => {
          throw new Error("Simulated GQL timeout");
        },
        { roleAdapter: fakeAdapter }
      ),
      /Simulated GQL timeout/
    );
    assert.equal(restoreCalls, 2, "Must restore Teacher session even on error");

    try {
      await assert.rejects(
        authSvc.withAdminLmsSession(
          async () => {
            taskQueue.stopQueue();
            const { ensureQueueNotStopped } = await import(
              "../src/lib/teaching/teaching-http-client"
            );
            ensureQueueNotStopped();
            return "NEVER";
          },
          { roleAdapter: fakeAdapter }
        ),
        /QUEUE_STOPPED/
      );
      assert.equal(restoreCalls, 3, "Must restore Teacher session even on QUEUE_STOPPED");
    } finally {
      taskQueue.resumeQueue();
    }
    console.log("PASS [AC-02] Role-aware MindX cookie isolation & unconditional Teacher restore");

    // =========================================================================
    // [AC-03] & [AC-04] DB/JSON Isolation, HTML Parsers & Audit Across Tabs 1-5
    // =========================================================================
    const teacherSeedClasses = [{ classCode: "VT-TEACHER01", courseName: "Scratch" }];
    fs.writeFileSync(
      process.env.MINDX_RUNNING_CLASSES_PATH!,
      JSON.stringify(teacherSeedClasses, null, 2),
      "utf8"
    );
    const db = getDb();
    classSessionRepo.upsert({
      classId: "VT-TEACHER01",
      className: "VT-TEACHER01",
      sessionId: "1",
      sessionNumber: 1,
      topic: "Buổi 1",
      date: "2026-10-01",
    });
    reportCardRepo.getOrInit("VT-TEACHER01");

    const sampleIndexHtml = `
      <div class="regular-class" data-class-code="205ALHP-CODING12" data-instructor="Nguyễn Minh An" data-ta="Trần Bảo" data-session-number="12" data-special-event="CHECKPOINT" data-time="08:00-10:00">205ALHP-CODING12 Buổi 12</div>
      <div class="regular-class" data-class-code="205ALHP-ROB04" data-block="ROBOTICS" data-instructor="Lê Thị Cúc" data-session-number="4" data-special-event="CP1" data-time="14:00-16:00">205ALHP-ROB04 Buổi 4</div>
    `;
    const sampleCheckHtml = `
      <table><thead><tr><th>STT</th><th>Mã lớp</th><th>Buổi</th><th>Ngày học</th><th>Giảng viên chính</th><th>Trợ giảng</th><th>Khối</th><th>Deadline Zalo</th><th>NX Zalo</th><th>Deadline LMS</th><th>NX LMS</th><th>Mô tả vấn đề</th><th>Ghi chú</th><th>Tình trạng đánh giá</th></tr></thead>
      <tbody>
        <tr><td>1</td><td>205ALHP-CODING12</td><td>12</td><td>17/12/2026</td><td>Nguyễn Minh An</td><td>Trần Bảo</td><td>Coding</td><td>18/12/2026</td><td>Quá hạn</td><td>18/12/2026</td><td>Đúng hạn</td><td>Thiếu NX 1 HV</td><td></td><td>Chưa đủ</td></tr>
        <tr><td>2</td><td>205ALHP-ROB04</td><td>4</td><td>22/10/2026</td><td>Lê Thị Cúc</td><td></td><td>Robotics</td><td>23/10/2026</td><td>Đúng hạn</td><td>23/10/2026</td><td>Đúng hạn</td><td></td><td></td><td>Đủ</td></tr>
      </tbody></table>
    `;
    const sampleHocBuHtml = `
      <table><thead><tr><th>STT</th><th>Mã lớp</th><th>Học viên</th><th>Buổi</th><th>Giảng viên</th><th>Trạng thái</th></tr></thead>
      <tbody>
        <tr><td>1</td><td>205ALHP-CODING12</td><td>Lê Quốc Bảo</td><td>Buổi 11</td><td>Nguyễn Minh An</td><td>Chưa học bù</td></tr>
      </tbody></table>
    `;

    assert.equal(parseTeachingWeeklyScheduleHtml(sampleIndexHtml).length, 2);
    assert.equal(parseTeachingCheckNhanXetHtml(sampleCheckHtml).length, 2);
    assert.equal(parseTeachingHocBuHtml(sampleHocBuHtml).length, 1);

    // Regression check for real Teaching check_nhanxet.php checkbox & data-deadline HTML format
    const realCheckboxHtml = `
      <table><thead><tr><th>STT</th><th>Mã lớp</th><th>Buổi</th><th>Ngày học</th><th>Giảng viên chính</th><th>Trợ giảng</th><th>Khối</th><th>Deadline Zalo</th><th>NX Zalo</th><th>Deadline LMS</th><th>NX LMS</th><th>Mô tả vấn đề (TE/TF/QC)</th><th>Ghi chú Giảng viên</th><th>Tình trạng đánh giá</th><th>Thao tác</th></tr></thead>
      <tbody>
        <tr>
          <td>1</td><td>VT-CSI02</td><td>8</td><td>12/11/2026</td><td>Nguyễn Văn A</td><td>Trần Thị B</td><td>Coding</td>
          <td><div class="fw-semibold">20:00 13/11/2026</div><span class="countdown" data-deadline="1700000000"></span></td>
          <td><input type="checkbox" class="zalo-checkbox form-check-input" data-type="zalo" checked ></td>
          <td><div class="fw-semibold">20:00 13/11/2026</div><span class="countdown" data-deadline="1700000000"></span></td>
          <td><input type="checkbox" class="lms-checkbox form-check-input" data-type="lms" ></td>
          <td><span class="text-muted fst-italic">+ Ghi chú QC</span></td>
          <td><span class="text-muted fst-italic">+ GV nhập giải trình</span></td>
          <td><span class="status-badge">Đã hoàn tất nhận xét Zalo, chưa nhận xét LMS</span></td>
          <td></td>
        </tr>
        <tr>
          <td>2</td><td>VT-JSB17</td><td>3</td><td>14/11/2026</td><td>Lê Văn C</td><td></td><td>Coding</td>
          <td><div class="fw-semibold">20:00 15/11/2026</div><span class="countdown" data-deadline="1900000000"></span></td>
          <td><input type="checkbox" class="zalo-checkbox form-check-input" data-type="zalo" ></td>
          <td><div class="fw-semibold">20:00 15/11/2026</div><span class="countdown" data-deadline="1900000000"></span></td>
          <td><input type="checkbox" class="lms-checkbox form-check-input" data-type="lms" checked="checked" ></td>
          <td>Thiếu chi tiết buổi 3</td><td></td>
          <td><span class="status-badge">Chưa hoàn tất Zalo</span></td>
          <td></td>
        </tr>
      </tbody></table>
    `;
    const parsedRealCheck = parseTeachingCheckNhanXetHtml(realCheckboxHtml, 1750000000 * 1000);
    assert.equal(parsedRealCheck.length, 2);
    assert.equal(parsedRealCheck[0].zaloStatus, "Đã hoàn thành");
    assert.equal(parsedRealCheck[0].lmsStatus, "Chưa hoàn thành (Quá hạn)");
    assert.equal(parsedRealCheck[0].issueDescription, "");
    assert.equal(parsedRealCheck[0].teacherNote, "");
    assert.equal(parsedRealCheck[1].zaloStatus, "Chưa hoàn thành");
    assert.equal(parsedRealCheck[1].lmsStatus, "Đã hoàn thành");
    assert.equal(parsedRealCheck[1].issueDescription, "Thiếu chi tiết buổi 3");

    // Regression checks for HH:MM:SS schedule timeSlot, <script> template stripping in hocbu.php, and ?datatable=hocbu JSON
    const scheduleSecondsHtml = `
      <div class='regular-class' data-block='Coding' data-instructor='quangda' data-session-number='13'>
        <div class='class-code'><b>VT-CSI02</b></div>
        <div>🕒 08:00:00 - 10:00:00</div>
      </div>
    `;
    const parsedSecSched = parseTeachingWeeklyScheduleHtml(scheduleSecondsHtml);
    assert.equal(parsedSecSched.length, 1);
    assert.equal(parsedSecSched[0].timeSlot, "08:00 - 10:00");

    const hocBuScriptNoiseHtml = `
      <table><thead><tr><th>STT</th><th>Mã lớp</th><th>Học viên</th><th>Buổi</th><th>Giảng viên</th><th>Trạng thái</th></tr></thead><tbody></tbody></table>
      <script>const tpl = \`<tr><td>1</td><td>\${stSummary}</td><td>\${sessSummary}</td><td>\${detailsHtml}</td><td>gv</td><td>ok</td></tr>\`;</script>
    `;
    assert.equal(parseTeachingHocBuHtml(hocBuScriptNoiseHtml).length, 0);

    const hocBuDatatablePayload = JSON.stringify({
      draw: 1,
      recordsTotal: 4,
      recordsFiltered: 4,
      data: [
        {
          class_code: "VT-JSA15",
          student_name: "HV Một",
          session_number: 1,
          instructor_name: "Nguyễn Văn A",
          status: "PH đã đồng ý lịch, đang chờ học",
          attendance_status: "Chưa điểm danh",
        },
        {
          class_code: "VT-CSI02",
          student_name: "HV Hai",
          session_number: 5,
          instructor: "quangda",
          status: "Lịch mới tạo",
          attendance_status: "Chưa điểm danh",
        },
        {
          class_code: "VT-JSB17",
          student_name: "HV Ba",
          session_number: 2,
          instructor_name: "Lê Văn C",
          status: "Đã học xong",
          attendance_status: "Có mặt",
        },
        {
          class_code: "VT-ROB-ARMI13",
          student_name: "HV Bốn",
          session_number: 3,
          instructor_name: "Trần D",
          status: "Hủy lịch",
          attendance_status: "Chưa điểm danh",
        },
      ],
    });
    const parsedHocBuJson = parseTeachingHocBuDatatableJson(hocBuDatatablePayload);
    assert.equal(parsedHocBuJson.length, 2);
    assert.equal(parsedHocBuJson[0].classCode, "VT-JSA15");
    assert.equal(parsedHocBuJson[0].sessionLabel, "Buổi 1");
    assert.equal(parsedHocBuJson[1].classCode, "VT-CSI02");
    assert.equal(parsedHocBuJson[1].teacher, "quangda");

    const studentsCoding = [
      { id: "stu1", fullName: "Phạm Gia Huy" },
      { id: "stu2", fullName: "Lê Quốc Bảo" },
      { id: "stu3", fullName: "Trần Minh Thư" },
    ];
    // Absent index 2 on B12 -> exempt from B12 SPCK upload; stu1 ungraded BTVN & missing media/comment; stu2 missed all 3 BTVN & consecutive absences; Teacher missing on Teaching for stu3 -> ROSTER_MISMATCH
    const codingGql = makeCodingClassByIdGql({
      lmsClassId: "lms_c12",
      classCode: "205ALHP-CODING12",
      courseName: "GameMaker Basic",
      startDate: "2026-08-01",
      endDate: "2026-11-20",
      mainTeacher: "Nguyễn Minh An",
      students: studentsCoding,
      currentSessionNumber: 12,
      attendancePresentIndices: [0], // stu2 & stu3 absent in B11/B12 -> 2 consecutive absences
      missingCommentStudentIds: ["stu1"],
      btvnUngradedForStudentId: "stu1",
      spckMissingCommentStudentId: "stu1",
      spckMissingMediaStudentId: "stu1",
    });

    const robGql = makeCodingClassByIdGql({
      lmsClassId: "lms_r04",
      classCode: "205ALHP-ROB04",
      courseName: "Robotics Explorer",
      startDate: "2026-09-10",
      endDate: "2026-12-15",
      mainTeacher: "Lê Thị Cúc",
      students: [{ id: "rob1", fullName: "Võ Tuấn Kiệt" }],
      currentSessionNumber: 4,
      attendancePresentIndices: [0],
    });

    const makeupGql = makeCodingClassByIdGql({
      lmsClassId: "lms_hb",
      classCode: "205ALHP-CODING12-HB",
      courseName: "GameMaker Basic",
      startDate: "2026-08-01",
      endDate: "2026-11-20",
      mainTeacher: "Nguyễn Minh An",
      students: [{ id: "stu2", fullName: "Lê Quốc Bảo" }],
      currentSessionNumber: 12,
      attendancePresentIndices: [0],
    });

    const lmsBundleOverride = {
      discoveredClasses: [
        {
          classCode: "205ALHP-CODING12",
          lmsClassId: "lms_c12",
          courseName: "GameMaker Basic",
          status: "Running",
          startDate: "2026-08-01",
          endDate: "2026-11-20",
          mainTeacher: "Nguyễn Minh An",
          assistantTeacher: "Trần Bảo",
        },
        {
          classCode: "205ALHP-ROB04",
          lmsClassId: "lms_r04",
          courseName: "Robotics Explorer",
          status: "Running",
          startDate: "2026-09-10",
          endDate: "2026-12-15",
          mainTeacher: "Lê Thị Cúc",
          assistantTeacher: "",
        },
        {
          classCode: "205ALHP-CODING12-HB",
          lmsClassId: "lms_hb",
          courseName: "GameMaker Basic",
          status: "Running",
          startDate: "2026-08-01",
          endDate: "2026-11-20",
          mainTeacher: "Nguyễn Minh An",
          assistantTeacher: "",
        },
      ],
      perClass: new Map([
        ["205ALHP-CODING12", codingGql],
        ["205ALHP-ROB04", robGql],
        ["205ALHP-CODING12-HB", makeupGql],
      ]),
      stoppedEarly: false,
    };

    const teachingDeps = {
      httpClient: {
        getHtmlPage: async (rel: string) => {
          if (rel.includes("index.php")) return sampleIndexHtml;
          if (rel.includes("check_nhanxet.php")) return sampleCheckHtml;
          if (rel.includes("hocbu.php")) return sampleHocBuHtml;
          return "";
        },
      },
      reportCardTransport: {
        getStudents: async (classCode: string) =>
          classCode === "205ALHP-CODING12"
            ? [
                { id: 101, student_name: "Phạm Gia Huy", class_code: classCode, status: "Đang học" },
                { id: 102, student_name: "Lê Quốc Bảo", class_code: classCode, status: "Đang học" },
              ]
            : [{ id: 201, student_name: "Võ Tuấn Kiệt", class_code: classCode, status: "Đang học" }],
        getExercises: async () => [],
        getScores: async () => [],
      },
      projectTransport: {
        getProject: async () => null,
        getTasks: async () => [],
        getTaskProgress: async () => ({}),
      },
    };

    const scanRes = await scanAdminCenterClasses({
      scope: "ALL",
      includeMakeup: true,
      lmsBundleOverride,
      teachingDeps: teachingDeps as any,
    });
    assert.equal(scanRes.success, true);
    assert.equal(scanRes.scannedCount, 3);

    // Check teacher isolation untouched!
    assert.equal(
      fs.readFileSync(process.env.MINDX_RUNNING_CLASSES_PATH!, "utf8"),
      JSON.stringify(teacherSeedClasses, null, 2),
      "[AC-03] running_classes.json must stay untouched"
    );
    const teacherSessions = classSessionRepo.findByClass("VT-TEACHER01");
    assert.equal(teacherSessions.length, 1);
    assert.equal(reportCardRepo.findOne("VT-TEACHER01")?.classCode, "VT-TEACHER01");

    const ovExcludeHb = buildAdminOverviewResponse({ includeMakeup: false });
    assert.equal(ovExcludeHb.classes.length, 2);
    const ovIncludeHb = buildAdminOverviewResponse({ includeMakeup: true });
    assert.equal(ovIncludeHb.classes.length, 3);

    const codingRow = ovExcludeHb.classes.find((c) => c.classCode === "205ALHP-CODING12")!;
    assert.equal(codingRow.weeklyOps.isZaloLateOrMissing, true);
    assert.deepEqual(codingRow.weeklyOps.missingCommentStudentNames, ["Phạm Gia Huy"]);
    assert.equal(codingRow.btvnSummary.applicable, true);
    assert.equal(codingRow.btvnSummary.ungradedCellsCount, 1);
    assert.deepEqual(codingRow.btvnSummary.ungradedSessions, [3]);
    assert.equal(codingRow.btvnSummary.isOutOfSyncWithTeaching, true);
    assert.equal(codingRow.spckAudit.applicable, true);
    assert.equal(codingRow.spckAudit.totalMissingUploads, 0);
    assert.equal(codingRow.spckAudit.slots["12"].missingUploadStudents.length, 0);
    // Notice on B12 presentIndices = [0] (only Phạm Gia Huy is present on B12 -> requiredCount = 1!)
    assert.equal(codingRow.spckAudit.slots["12"].requiredCount, 1);
    assert.deepEqual(codingRow.spckAudit.slots["12"].missingTeacherCommentStudents, [
      "Phạm Gia Huy",
    ]);
    assert.deepEqual(codingRow.spckAudit.slots["12"].missingImageOrLinkStudents, [
      "Phạm Gia Huy",
    ]);
    assert.equal(codingRow.spckTasks.eligibleGt9, true);
    assert.equal(codingRow.spckTasks.taskStatus, "MISSING_PROJECT");
    assert(codingRow.earlyWarnings.some((w) => w.type === "CONSECUTIVE_ABSENCE"));
    assert(codingRow.earlyWarnings.some((w) => w.type === "CONSECUTIVE_MISSING_BTVN"));
    assert(codingRow.earlyWarnings.some((w) => w.type === "ROSTER_MISMATCH"));
    assert(codingRow.earlyWarnings.some((w) => w.type === "MAKEUP_DEBT"));
    assert(ovExcludeHb.campusZaloSummaryText.includes("205ALHP-CODING12"));

    const robRow = ovExcludeHb.classes.find((c) => c.classCode === "205ALHP-ROB04")!;
    assert.equal(robRow.btvnSummary.applicable, false);

    // Regression check: StudentWorkData attachmentUrls / videoUrls / relatedUrls count as valid SPCK media/links
    const mediaVariantAudit = computeAdminClassAudits({
      centerCode: "205ALHP",
      rawClassMeta: {
        classCode: "205ALHP-MEDIA12",
        lmsClassId: "lms_media12",
        status: "RUNNING",
        startDate: "2026-08-01",
        endDate: "2026-11-20",
      },
      classByIdData: {
        id: "lms_media12",
        name: "205ALHP-MEDIA12",
        status: "RUNNING",
        course: { name: "GameMaker" },
        students: [
          { activeInClass: true, student: { id: "m1", fullName: "HV Một" } },
          { activeInClass: true, student: { id: "m2", fullName: "HV Hai" } },
          { activeInClass: true, student: { id: "m3", fullName: "HV Ba" } },
        ],
        slots: Array.from({ length: 14 }, (_unused, idx) => ({
          _id: `mslot_${idx + 1}`,
          summary: `B${idx + 1}`,
          homework: "HW",
          date: idx < 12 ? "2026-10-10" : "2099-12-30",
          studentAttendance: [
            { student: { id: "m1", fullName: "HV Một" }, status: "ATTEND", comment: "Tốt" },
            { student: { id: "m2", fullName: "HV Hai" }, status: "ATTEND", comment: "Tốt" },
            { student: { id: "m3", fullName: "HV Ba" }, status: "ATTEND", comment: "Tốt" },
          ],
        })),
      },
      submissionGqlData: null,
      studentWorks: [
        {
          id: "w_m1",
          studentId: "m1",
          classSessionNumber: 12,
          latestData: { comment: "OK", attachmentUrls: ["https://cdn.mindx/a.png"] },
        },
        {
          id: "w_m2",
          studentId: "m2",
          classSessionNumber: 12,
          latestData: { comment: "OK", videoUrls: ["https://cdn.mindx/v.mp4"] },
        },
        {
          id: "w_m3",
          studentId: "m3",
          classSessionNumber: 12,
          latestData: { comment: "OK", relatedUrls: ["https://scratch.mit.edu/projects/1"] },
        },
      ],
      teachingScheduleEntry: null,
      teachingCheckRows: [],
      teachingDetail: null,
      teachingMakeupRows: [],
    });
    const mediaSpck = JSON.parse(mediaVariantAudit.spckAuditJson);
    assert.equal(mediaSpck.slots["12"].missingImageOrLinkStudents.length, 0);

    console.log("PASS [AC-03/04] DB/JSON isolation, Teaching scrapers & Audits Tabs 1-5");

    // =========================================================================
    // [AC-05] Coding BTVN Sync (Robotics 400 Guard + Teaching Read-after-Write)
    // =========================================================================
    let remoteWritesCalled = 0;
    const fakeRcTransport = {
      getStudents: async () => [
        { id: 101, student_name: "Phạm Gia Huy", class_code: "205ALHP-CODING12", status: "Đang học" },
        { id: 102, student_name: "Lê Quốc Bảo", class_code: "205ALHP-CODING12", status: "Đang học" },
        // Trần Minh Thư intentionally absent on Teaching -> tests allowPartialStudentMatch
      ],
      getExercises: async () => remoteExercises,
      getScores: async () => remoteScores,
      addMultiExercise: async (p: any) => {
        remoteWritesCalled++;
        for (const sn of p.sessions) {
          for (const f of p.exerciseForms) {
            const id = remoteExercises.length + 10;
            remoteExercises.push({
              id,
              session_number: sn,
              exercise_type: p.exerciseType,
              exercise_form: f,
              exercise_title: `${p.exerciseType} ${sn}`,
              max_score: 100,
              max_score_nang_luc: 5,
            });
          }
        }
        return { success: true };
      },
      saveScores: async (scores: any[]) => {
        remoteWritesCalled++;
        for (const s of scores) {
          const idx = remoteScores.findIndex(
            (r) =>
              r.student_id === s.student_id &&
              r.session_number === s.session_number &&
              r.exercise_type === s.exercise_type &&
              r.exercise_form === s.exercise_form
          );
          const normScore =
            s.max_score > 0
              ? Math.round(((s.raw_score / s.max_score) * 5) * 100) / 100
              : s.raw_score;
          if (idx >= 0) {
            remoteScores[idx].raw_score = s.raw_score;
            remoteScores[idx].normalized_score = normScore;
            remoteScores[idx].max_score = s.max_score;
            remoteScores[idx].note = s.note;
          } else {
            remoteScores.push({
              student_id: s.student_id,
              class_code: s.class_code,
              session_number: s.session_number,
              exercise_type: s.exercise_type,
              exercise_form: s.exercise_form,
              raw_score: s.raw_score,
              normalized_score: normScore,
              max_score: s.max_score,
              note: s.note,
            });
          }
        }
        return { success: true };
      },
    };
    const remoteExercises: any[] = [
      // Pre-existing manual CP1 slot on Teaching must NOT cause skipNullSlotVerification errors
      { id: 901, session_number: 5, exercise_type: "cp1", exercise_form: "theory", exercise_title: "CP1 LT", max_score: 5, max_score_nang_luc: 5 },
    ];
    const remoteScores: any[] = [
      {
        student_id: 101,
        class_code: "205ALHP-CODING12",
        session_number: 5,
        exercise_type: "cp1",
        exercise_form: "theory",
        raw_score: 4.5,
        normalized_score: 4.5,
        max_score: 5,
      },
    ];

    const robBlocked = await syncAdminClassBtvnToTeaching("205ALHP-ROB04", {
      transport: fakeRcTransport as any,
    });
    assert.equal(robBlocked.success, false);
    assert.equal(robBlocked.statusCode, 400);
    assert.equal(remoteWritesCalled, 0, "Robotics must reject before any remote Teaching write");

    const codingSyncRes = await syncAdminClassBtvnToTeaching("205ALHP-CODING12", {
      transport: fakeRcTransport as any,
    });
    assert.equal(codingSyncRes.success, true, `Unexpected BTVN sync error: ${codingSyncRes.error}`);
    assert.equal(codingSyncRes.status, "VERIFIED");
    assert.equal(codingSyncRes.matchedCount, 2);
    assert.deepEqual(codingSyncRes.unmatchedStudentNames, ["Trần Minh Thư"]);
    assert(remoteExercises.every((e) => e.exercise_type !== "cp2" && e.exercise_type !== "final"), "btvnOnly must not declare CP2/Final");
    const afterSyncRow = adminCenterRepo.findClass("205ALHP-CODING12")!;
    assert.equal(afterSyncRow.btvnSyncStatus, "VERIFIED");
    assert.equal(JSON.parse(afterSyncRow.btvnSummaryJson).isOutOfSyncWithTeaching, false);
    // Manual override table on Teacher must remain empty
    assert.equal(reportCardRepo.findOne("205ALHP-CODING12"), undefined);
    console.log("PASS [AC-05] Coding BTVN sync Read-after-Write + Robotics guard");

    // =========================================================================
    // [AC-06] > Session 9 SPCK 5-Task Provisioning + Non-Downgrading Progress
    // =========================================================================
    let fakePrj: any = null;
    const fakeTasks: any[] = [
      // Pre-existing custom teacher task should be preserved when cleanupExtraTasks is omitted
      {
        id: 888,
        task_name: "Ghi chú thêm của thầy",
        description: "Extra custom task",
        weight_percent: 0,
        deadline: "2026-11-20",
        assigned_students: [101],
      },
    ];
    const fakeProgress: Record<string, number> = {};
    let nextTaskId = 500;

    const fakeProjectTransport = {
      getProject: async () => fakePrj,
      getStudents: async () => [
        { id: 101, student_name: "Phạm Gia Huy", class_code: "205ALHP-CODING12", status: "Đang học" },
        { id: 102, student_name: "Lê Quốc Bảo", class_code: "205ALHP-CODING12", status: "Nghỉ học" },
      ],
      getTasks: async () => fakeTasks,
      getTaskProgress: async () => ({ ...fakeProgress }),
      createProject: async (p: any) => {
        fakePrj = {
          id: 777,
          class_code: p.classCode,
          project_name: p.projectName,
          start_date: p.startDate,
          end_date: p.endDate,
          description: p.description,
        };
        return { success: true, id: 777 };
      },
      saveTask: async (p: any) => {
        if (p.taskId) {
          const t = fakeTasks.find((x) => Number(x.id) === Number(p.taskId));
          if (t) {
            t.task_name = p.taskName;
            t.description = p.description;
            t.weight_percent = p.weightPercent;
            t.deadline = p.deadline;
            t.assigned_students = p.assignedStudentIds;
          }
          return { success: true, id: p.taskId };
        }
        const id = nextTaskId++;
        fakeTasks.push({
          id,
          task_name: p.taskName,
          description: p.description,
          weight_percent: p.weightPercent,
          deadline: p.deadline,
          assigned_students: p.assignedStudentIds,
        });
        return { success: true, id };
      },
      deleteTask: async () => ({ success: true }),
      updateTaskProgress: async (p: any) => {
        fakeProgress[`${p.taskId}_${p.studentId}`] = p.progressPercent;
        return { success: true };
      },
    };

    const provRes = await provisionAdminSpckTasksOnTeaching("205ALHP-CODING12", {
      syncProgressBySession: true,
      transport: fakeProjectTransport as any,
    });
    assert.equal(provRes.success, true, `Unexpected SPCK provision error: ${provRes.error}`);
    assert.equal(provRes.status, "VERIFIED");
    assert.equal(provRes.projectId, 777);
    assert.equal(provRes.totalWeightPercent, 100);
    assert.equal(provRes.taskCount, 5, "1 partial task completed up to 5 standard 20% tasks = 100%");
    assert.equal(provRes.syncedProgressTasksCount, 3, "Buổi 12 maps to 3/5 (60%)");
    assert.equal(fakeTasks.some((t) => t.id === 888), true, "Must preserve pre-existing partial task id");

    // Pre-seed student 101 task #4 (index 3) to 100% AND append a 6th custom 0%-weight task;
    // rerun with syncProgressBySession: true and cleanupExtraTasks omitted -> MUST preserve 6th task & NEVER downgrade!
    const task4 = fakeTasks.find((t) => String(t.task_name).startsWith("4."));
    assert(task4, "Expected standard task 4");
    fakeProgress[`${task4.id}_101`] = 100;
    fakeTasks.push({
      id: 999,
      task_name: "Nhiệm vụ mở rộng của GV",
      description: "Extra 6th task",
      weight_percent: 0,
      deadline: "2026-11-20",
      assigned_students: [101],
    });
    const provRes2 = await provisionAdminSpckTasksOnTeaching("205ALHP-CODING12", {
      syncProgressBySession: true,
      transport: fakeProjectTransport as any,
    });
    assert.equal(provRes2.success, true);
    assert.equal(provRes2.taskCount, 6, "6th extra custom task must be preserved when cleanupExtraTasks is omitted");
    assert.equal(fakeTasks.some((t) => t.id === 999), true, "Extra 6th task id=999 must stay untouched");
    assert.equal(fakeProgress[`${task4.id}_101`], 100, "Must never downgrade existing >=100% progress");
    console.log("PASS [AC-06] > Session 9 SPCK provisioning + non-downgrading Math.max progress");

    // =========================================================================
    // [AC-07] Local-only 403 Guard + Single BrowserContext Static Invariant
    // =========================================================================
    const remoteHeaders = {
      host: "evil.example.com",
      "x-forwarded-for": "203.0.113.10",
    };
    const rOverview = await overviewGET(
      new Request("http://evil.example.com/api/admin-center/overview", { headers: remoteHeaders })
    );
    assert.equal(rOverview.status, 403);
    const rScan = await scanPOST(
      new Request("http://evil.example.com/api/admin-center/scan", {
        method: "POST",
        headers: remoteHeaders,
        body: "{}",
      })
    );
    assert.equal(rScan.status, 403);
    const rSync = await syncBtvnPOST(
      new Request("http://evil.example.com/api/admin-center/sync-btvn", {
        method: "POST",
        headers: remoteHeaders,
        body: "{}",
      })
    );
    assert.equal(rSync.status, 403);
    const rProv = await provisionSpckPOST(
      new Request("http://evil.example.com/api/admin-center/provision-spck-tasks", {
        method: "POST",
        headers: remoteHeaders,
        body: "{}",
      })
    );
    assert.equal(rProv.status, 403);

    // Local valid GET smoke check
    const rLocalOk = await overviewGET(
      new Request("http://127.0.0.1:3000/api/admin-center/overview?includeMakeup=false", {
        headers: { host: "127.0.0.1:3000" },
      })
    );
    assert.equal(rLocalOk.status, 200);
    const rLocalJson: any = await rLocalOk.json();
    assert.equal(rLocalJson.success, true);
    assert.equal(rLocalJson.classes.length, 2);

    // Verify SINGLE BrowserContext & NO server imports in client components
    const srcFiles = collectSourceFiles(path.join(ROOT, "src"));
    const launchContextFiles = srcFiles.filter((f) =>
      fs.readFileSync(f, "utf8").includes("launchPersistentContext")
    );
    assert.deepEqual(
      launchContextFiles.map((f) => path.relative(ROOT, f).replace(/\\/g, "/")),
      ["src/lib/playwright/browser-manager.ts"],
      "launchPersistentContext must appear ONLY in browser-manager.ts"
    );
    const uiFiles = collectSourceFiles(path.join(ROOT, "src/components/admin-center")).concat(
      collectSourceFiles(path.join(ROOT, "src/app/admin-center"))
    );
    for (const f of uiFiles) {
      const code = fs.readFileSync(f, "utf8");
      assert(!code.includes("db/sqlite"), `${f} must not import db/sqlite`);
      assert(!code.includes("lib/config"), `${f} must not import lib/config`);
      assert(!code.includes("playwright/auth"), `${f} must not import playwright/auth`);
    }
    console.log("PASS [AC-07] 403 local-only guard, single BrowserContext & client isolation");

    // =========================================================================
    // [AC-08] Headless Chromium UI Smoke + Strict Zero-Idle-Polling Check
    // =========================================================================
    const uiEntry = path.join(tempDir, "admin-ui-entry.tsx");
    const uiBundle = path.join(tempDir, "admin-ui-bundle.js");
    const pagePath = path.join(ROOT, "src/app/admin-center/page.tsx");
    fs.writeFileSync(
      uiEntry,
      `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import AdminCenterPage from ${JSON.stringify(pagePath)};
        createRoot(document.getElementById("root")!).render(<AdminCenterPage />);
      `,
      "utf8"
    );
    await esbuild.build({
      entryPoints: [uiEntry],
      bundle: true,
      outfile: uiBundle,
      format: "iife",
      platform: "browser",
      target: ["es2020"],
      jsx: "automatic",
      absWorkingDir: ROOT,
      nodePaths: [path.join(ROOT, "node_modules")],
      plugins: [createTsconfigAliasPlugin()],
      define: { "process.env.NODE_ENV": '"production"' },
    });
    const bundleJs = fs.readFileSync(uiBundle, "utf8");

    let overviewGetCount = 0;
    let mockIsRunning = false;
    let mockFailureMode:
      | "HTTP_500"
      | "HTTP_200_EMPTY"
      | "HTTP_200_INVALID_JSON" = "HTTP_500";
    const baseMockOverview = buildAdminOverviewResponse({ includeMakeup: false });
    const mockOverview = {
      ...baseMockOverview,
      classes: baseMockOverview.classes.map((c) =>
        c.classCode === "205ALHP-CODING12"
          ? {
              ...c,
              spckTasks: {
                ...c.spckTasks,
                eligibleGt9: true,
                taskStatus: "MISSING_PROJECT" as const,
              },
            }
          : c
      ),
    };
    const server = http.createServer((req, res) => {
      const url = req.url || "/";
      if (url === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<!DOCTYPE html><html lang="vi" data-theme="light"><body><div id="root"></div><script>${bundleJs}</script></body></html>`
        );
        return;
      }
      if (url.startsWith("/api/admin-center/overview")) {
        overviewGetCount++;
        const payload = {
          ...mockOverview,
          scanProgress: {
            ...mockOverview.scanProgress,
            isRunning: mockIsRunning,
            scannedClasses: mockIsRunning ? 1 : 2,
            totalClasses: 2,
            currentClassCode: mockIsRunning ? "205ALHP-CODING12" : null,
          },
        };
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(payload));
        return;
      }
      const writeFailResponse = (http500Body: Record<string, any>) => {
        if (mockFailureMode === "HTTP_200_EMPTY") {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end("{}");
          return;
        }
        if (mockFailureMode === "HTTP_200_INVALID_JSON") {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end("{");
          return;
        }
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(http500Body));
      };
      if (url.startsWith("/api/admin-center/scan")) {
        writeFailResponse({
          success: false,
          error: "Stop after current failed HTTP 500",
        });
        return;
      }
      if (url.startsWith("/api/queue/control")) {
        writeFailResponse({
          success: false,
          error: "Queue emergency stop internal failure",
        });
        return;
      }
      if (url.startsWith("/api/admin-center/sync-btvn")) {
        writeFailResponse({
          success: false,
          error: "Teaching BTVN batch failed HTTP 500",
          failedCount: 1,
          results: [
            {
              classCode: "205ALHP-CODING12",
              status: "FAILED",
              error: "Teaching BTVN batch failed HTTP 500",
            },
          ],
        });
        return;
      }
      if (url.startsWith("/api/admin-center/provision-spck-tasks")) {
        writeFailResponse({
          success: false,
          error: "Teaching SPCK batch failed HTTP 500",
          failedCount: 1,
          results: [
            {
              classCode: "205ALHP-CODING12",
              status: "FAILED",
              error: "Teaching SPCK batch failed HTTP 500",
            },
          ],
        });
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ success: true }));
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as any).port;
    const browser = await chromium.launch({ headless: true });

    try {
      const ctx = await browser.newContext();
      await ctx.grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: `http://127.0.0.1:${port}`,
      });
      const page = await ctx.newPage();

      // 1. Idle load -> wait 4.5s -> MUST stay at EXACTLY 1 GET
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("text=205ALHP-CODING12", { timeout: 10000 });
      assert.equal(overviewGetCount, 1, "Initial idle mount should issue 1 GET");
      await page.waitForTimeout(4500);
      assert.equal(
        overviewGetCount,
        1,
        `Idle wait fired ${overviewGetCount - 1} unexpected polling requests`
      );

      // 2. Click KPI card "Thiếu SPCK / NX (B12–14)" -> switches to Tab 3 & expands missing list
      await page.getByRole("button", { name: /Thiếu SPCK/i }).click();
      await page.getByRole("button", { name: /Xem danh sách thiếu/i }).click();
      await page.waitForSelector("text=Phạm Gia Huy", { timeout: 5000 });

      // 3. Switch to Tab 5 & click Copy nhắc việc Zalo
      await page.getByRole("button", { name: /5\. Giảng viên/i }).click();
      await page.getByRole("button", { name: /Copy nhắc việc Zalo/i }).first().click();
      await page.waitForSelector("text=Đã copy!", { timeout: 5000 });

      // 4. Reload while server says isRunning = true -> test ADV-15 emergency stop HTTP 500 -> flip false -> stop polling
      overviewGetCount = 0;
      mockIsRunning = true;
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector("text=Đang quét cơ sở", { timeout: 5000 });
      await page.waitForTimeout(2600);
      assert(overviewGetCount >= 2, `Expected active scan polling >= 2, got ${overviewGetCount}`);

      // [ADV-15] Stop-after-current & Emergency stop HTTP 500 must NOT show false success
      await page.getByRole("button", { name: /Dừng sau lớp này/i }).click();
      await page.waitForSelector("text=Stop after current failed HTTP 500", { timeout: 5000 });
      assert.equal(
        await page.locator("text=Đã gửi yêu cầu Dừng sau khi xong lớp hiện tại.").count(),
        0,
        "[ADV-15 / R3-01] UI must never claim Stop-after-current succeeded on HTTP 500"
      );

      await page.getByRole("button", { name: /Dừng khẩn cấp/i }).click();
      await page.waitForSelector("text=Không thể dừng khẩn cấp", { timeout: 5000 });
      await page.waitForSelector("text=Queue emergency stop internal failure", { timeout: 5000 });
      assert.equal(
        await page.locator("text=Đã kích hoạt Dừng khẩn cấp hàng đợi.").count(),
        0,
        "[ADV-15] UI must never claim emergency stop succeeded on HTTP 500"
      );

      mockIsRunning = false;
      await page.waitForTimeout(2600);
      const countAfterStop = overviewGetCount;
      await page.waitForTimeout(4500);
      assert.equal(
        overviewGetCount,
        countAfterStop,
        "Polling must stop immediately once scanProgress.isRunning transitions to false"
      );

      // [ADV-16] Batch BTVN HTTP 500 must NOT claim "Hoàn tất..."
      await page.getByRole("button", { name: /2\. BTVN Coding/i }).click();
      await page.getByRole("button", { name: /Quét điểm BTVN & Đẩy sang Teaching/i }).click();
      await page.waitForSelector("text=Teaching BTVN batch failed HTTP 500", { timeout: 5000 });
      assert.equal(
        await page.locator("text=Hoàn tất đẩy BTVN Coding").count(),
        0,
        "[ADV-16] UI must never claim BTVN batch completed on HTTP 500"
      );

      // [ADV-17] Batch SPCK HTTP 500 must NOT claim "Hoàn tất..."
      await page.getByRole("button", { name: /4\. Lớp > B9/i }).click();
      await page.getByRole("button", { name: /Tạo 5 nhiệm vụ SPCK cho tất cả lớp còn thiếu/i }).click();
      await page.waitForSelector("text=Teaching SPCK batch failed HTTP 500", { timeout: 5000 });
      assert.equal(
        await page.locator("text=Hoàn tất tạo 5 nhiệm vụ SPCK").count(),
        0,
        "[ADV-17] UI must never claim SPCK batch completed on HTTP 500"
      );

      // [R3-01 / #15] HTTP 200 `{}` and malformed JSON `{` must show errors and NEVER claim success/stopped
      for (const failMode of ["HTTP_200_EMPTY", "HTTP_200_INVALID_JSON"] as const) {
        mockFailureMode = failMode;
        mockIsRunning = true;
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForSelector("text=Đang quét cơ sở", { timeout: 5000 });

        await page.getByRole("button", { name: /Dừng sau lớp này/i }).click();
        await page.waitForSelector(
          failMode === "HTTP_200_EMPTY"
            ? "text=Không gửi được lệnh dừng"
            : "text=Phản hồi lệnh dừng không hợp lệ",
          { timeout: 5000 }
        );
        assert.equal(
          await page.locator("text=Đã gửi yêu cầu Dừng sau khi xong lớp hiện tại.").count(),
          0,
          `[R3-01] Stop-after-current (${failMode}) must not report success`
        );

        await page.getByRole("button", { name: /Dừng khẩn cấp/i }).click();
        await page.waitForSelector("text=Không thể dừng khẩn cấp", { timeout: 5000 });
        assert.equal(
          await page.locator("text=Đã kích hoạt Dừng khẩn cấp hàng đợi.").count(),
          0,
          `[R3-01] Emergency stop (${failMode}) must not report stopped`
        );

        mockIsRunning = false;
        await page.getByRole("button", { name: /2\. BTVN Coding/i }).click();
        await page.getByRole("button", { name: /Quét điểm BTVN & Đẩy sang Teaching/i }).click();
        await page.waitForSelector("text=Đẩy hàng loạt BTVN không hoàn tất", { timeout: 5000 });
        assert.equal(
          await page.locator("text=Hoàn tất đẩy BTVN Coding").count(),
          0,
          `[R3-01] Batch BTVN (${failMode}) must not claim completed`
        );

        await page.getByRole("button", { name: /4\. Lớp > B9/i }).click();
        await page.getByRole("button", { name: /Tạo 5 nhiệm vụ SPCK cho tất cả lớp còn thiếu/i }).click();
        await page.waitForSelector("text=Tạo hàng loạt 5 nhiệm vụ SPCK không hoàn tất", { timeout: 5000 });
        assert.equal(
          await page.locator("text=Hoàn tất tạo 5 nhiệm vụ SPCK").count(),
          0,
          `[R3-01] Batch SPCK (${failMode}) must not claim completed`
        );
      }

      await ctx.close();
    } finally {
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    console.log("PASS [AC-08] Headless UI smoke, error banners (ADV-15..17) & zero idle polling");

    // =========================================================================
    // [AC-09] Codex Adversarial Regression Suite (ADV-01..ADV-14, ADV-18..ADV-20)
    // =========================================================================

    // [ADV-01] & [ADV-02] Fail closed on unrecognizable Admin or failed Teacher restore
    await assert.rejects(
      authSvc.withAdminLmsSession(async () => "SHOULD_NOT_RUN", {
        roleAdapter: {
          ...fakeAdapter,
          ensureRoleAuthenticated: async () => ({ page: {} as any, detectedIdentity: "" }),
          verifyActiveIdentity: async () => "",
        },
      }),
      /Auth Role Mismatch/
    );
    await assert.rejects(
      authSvc.withAdminLmsSession(async () => "ADMIN_DONE", {
        roleAdapter: {
          ...fakeAdapter,
          restoreSnapshot: async () => {
            throw new Error("Cookie jar locked");
          },
        },
      }),
      /Auth Restore Error/
    );
    await assert.rejects(
      authSvc.withAdminLmsSession(async () => "ADMIN_DONE", {
        roleAdapter: {
          ...fakeAdapter,
          verifyActiveIdentity: async (expected: string) =>
            expected === "teacher_test@mindx.edu.vn"
              ? "wrong_user@mindx.net.vn"
              : "tuanpa_test@mindx.net.vn",
        },
      }),
      /Auth Restore Error|Auth Role Mismatch/
    );

    // [ADV-03] Stop queue before scan must unlock progressState.isRunning on failure
    taskQueue.stopQueue();
    try {
      await assert.rejects(
        scanAdminCenterClasses({
          scope: "ALL",
          includeMakeup: false,
          lmsBundleOverride,
          teachingDeps: teachingDeps as any,
        }),
        /QUEUE_STOPPED/
      );
      assert.equal(
        getAdminScanProgressState().isRunning,
        false,
        "[ADV-03] progressState.isRunning must reset to false even if taskQueue.enqueue rejects before execute()"
      );
    } finally {
      taskQueue.resumeQueue();
    }
    const afterResumeScan = await scanAdminCenterClasses({
      scope: "SINGLE_CLASS",
      classCode: "205ALHP-CODING12",
      lmsBundleOverride,
      teachingDeps: teachingDeps as any,
    });
    assert.equal(afterResumeScan.success, true, "[ADV-03] Scan must recover cleanly after resumeQueue()");

    // [ADV-04] Teaching endpoint error must preserve cached activeStudentCount & return PARTIAL/false
    const beforeAdv04 = adminCenterRepo.findClass("205ALHP-CODING12")!;
    assert.equal(beforeAdv04.activeStudentCount, 3);
    const partialRes = await scanAdminCenterClasses({
      scope: "ALL",
      includeMakeup: true,
      lmsBundleOverride: {
        ...lmsBundleOverride,
        perClass: new Map([
          ["205ALHP-CODING12", { classByIdData: null, submissionGqlData: null, studentWorks: [], error: "GQL 502 error" } as any],
          ["205ALHP-ROB04", robGql as any],
          ["205ALHP-CODING12-HB", makeupGql as any],
        ]),
      },
      teachingDeps: {
        ...teachingDeps,
        reportCardTransport: {
          ...teachingDeps.reportCardTransport,
          getStudents: async (code: string) => {
            if (code === "205ALHP-CODING12") {
              throw new Error(`Students endpoint 502 with token ${process.env.ADMIN_TEACHING_PASSWORD}`);
            }
            return [{ id: 201, student_name: "Võ Tuấn Kiệt", class_code: code, status: "Đang học" }];
          },
        },
      } as any,
    });
    assert.equal(partialRes.success, false, "[ADV-04] Scan with endpoint failure must not return success=true");
    assert.equal(partialRes.status, "PARTIAL", "[ADV-04] Partial scan failure must report PARTIAL");
    const afterAdv04 = adminCenterRepo.findClass("205ALHP-CODING12")!;
    assert.equal(afterAdv04.activeStudentCount, 3, "[ADV-04] Failed scan must preserve cached student count");
    assert(!JSON.stringify(partialRes).includes(process.env.ADMIN_TEACHING_PASSWORD!), "[ADV-07] Scan errors must be redacted");

    // [ADV-05] Extra weighted task (120% weight) returns NEEDS_ATTENTION/INCOMPLETE (never VERIFIED), and partial student assignment fails Read-after-Write
    const weightedExtraTasks: any[] = [
      ...fakeTasks.filter((t) => Number(t.id) !== 999),
      {
        id: 995,
        task_name: "Nhiệm vụ thêm 20%",
        description: "Weighted extra task",
        weight_percent: 20,
        deadline: "2026-11-20",
        assigned_students: [101],
      },
    ];
    const extraWeightTransport = {
      ...fakeProjectTransport,
      getTasks: async () => weightedExtraTasks,
      saveTask: async (p: any) => {
        if (p.taskId) {
          const t = weightedExtraTasks.find((x) => Number(x.id) === Number(p.taskId));
          if (t) {
            t.task_name = p.taskName;
            t.description = p.description;
            t.weight_percent = p.weightPercent;
            t.deadline = p.deadline;
            t.assigned_students = p.assignedStudentIds;
          }
          return { success: true, id: p.taskId };
        }
        return { success: true, id: 996 };
      },
    };
    const adv05Weight = await provisionAdminSpckTasksOnTeaching("205ALHP-CODING12", {
      syncProgressBySession: false,
      transport: extraWeightTransport as any,
    });
    assert.equal(adv05Weight.success, false, "[ADV-05] 120% total weight must NOT return success=true");
    assert.equal(adv05Weight.statusCode, 409);
    assert.equal(adv05Weight.status, "NEEDS_ATTENTION");
    assert.equal(adv05Weight.totalWeightPercent, 120);
    assert.equal(weightedExtraTasks.some((t) => t.id === 995), true, "[ADV-05] Extra task must stay untouched");
    assert.equal(adminCenterRepo.findClass("205ALHP-CODING12")!.spckTasksSyncStatus, "INCOMPLETE");

    const brokenAssignTransport = {
      ...fakeProjectTransport,
      getStudents: async () => [
        { id: 101, student_name: "Phạm Gia Huy", class_code: "205ALHP-CODING12", status: "Đang học" },
        { id: 103, student_name: "Nguyễn Bảo Ngọc", class_code: "205ALHP-CODING12", status: "Đang học" },
      ],
      getTasks: async () =>
        fakeTasks.filter((t) => Number(t.id) !== 999).map((t) => ({ ...t, assigned_students: [101] })),
    };
    const adv05Assign = await provisionAdminSpckTasksOnTeaching("205ALHP-CODING12", {
      syncProgressBySession: false,
      transport: brokenAssignTransport as any,
    });
    assert.equal(adv05Assign.success, false, "[ADV-05] Missing active student after save must fail Read-after-Write");
    assert.equal(adv05Assign.status, "FAILED");
    assert(String(adv05Assign.error || "").includes("Read-after-Write Error"));

    // [ADV-06] Malformed/empty explicit classCodes must return 400 and NEVER expand to all classes
    let adv06Writes = 0;
    const countingTransport = {
      ...fakeProjectTransport,
      createProject: async () => {
        adv06Writes++;
        return { success: true, id: 1 };
      },
      saveTask: async () => {
        adv06Writes++;
        return { success: true, id: 1 };
      },
    };
    const adv06BatchSpck = await provisionAdminBatchSpckTasksOnTeaching(["!!!"], {
      transport: countingTransport as any,
    });
    assert.equal(adv06BatchSpck.success, false);
    assert.equal(adv06BatchSpck.statusCode, 400);
    const adv06BatchBtvn = await syncAdminBatchBtvnToTeaching(["!!!"], {
      transport: fakeRcTransport as any,
    });
    assert.equal(adv06BatchBtvn.success, false);
    assert.equal(adv06BatchBtvn.statusCode, 400);
    const adv06RouteEmpty = await provisionSpckPOST(
      new Request("http://127.0.0.1:3000/api/admin-center/provision-spck-tasks", {
        method: "POST",
        headers: { host: "127.0.0.1:3000", "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "BATCH_GT9", classCodes: [] }),
      })
    );
    assert.equal(adv06RouteEmpty.status, 400);
    const adv06RouteBad = await syncBtvnPOST(
      new Request("http://127.0.0.1:3000/api/admin-center/sync-btvn", {
        method: "POST",
        headers: { host: "127.0.0.1:3000", "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "BATCH_CODING", classCodes: ["!!!"] }),
      })
    );
    assert.equal(adv06RouteBad.status, 400);
    assert.equal(adv06Writes, 0, "[ADV-06] Invalid batch classCodes must perform 0 remote writes");

    // [ADV-07] & [ADV-18] Secret redaction across routes, DB error state, encoded passwords & tokens
    const encodedAdminPwd = encodeURIComponent(process.env.ADMIN_LMS_PASSWORD!);
    const secretLeakAttempt = await scanPOST(
      new Request("http://127.0.0.1:3000/api/admin-center/scan", {
        method: "POST",
        headers: { host: "127.0.0.1:3000", "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "SINGLE_CLASS",
          classCode: `${process.env.ADMIN_LMS_PASSWORD}!!!`,
        }),
      })
    );
    const secretLeakJson = JSON.stringify(await secretLeakAttempt.json());
    assert(!secretLeakJson.includes(process.env.ADMIN_LMS_PASSWORD!), "[ADV-07] Route error leaked password");
    const redactedSample = redactSecrets(
      `Fail url=https://x/?password=${encodedAdminPwd} raw=${process.env.TEACHING_PASSWORD} Authorization: Bearer super_secret_bearer_token_abc`
    );
    assert(!redactedSample.includes(process.env.TEACHING_PASSWORD!));
    assert(!redactedSample.includes(encodedAdminPwd));
    assert(!redactedSample.includes("super_secret_bearer_token_abc"));
    assert(redactedSample.includes("[REDACTED]"));
    const failingBtvnSecret = await syncAdminClassBtvnToTeaching("205ALHP-CODING12", {
      transport: {
        ...fakeRcTransport,
        getStudents: async () => {
          throw new Error(`Teaching rejected ${process.env.ADMIN_TEACHING_PASSWORD} Authorization: Bearer tok_xyz`);
        },
      } as any,
    });
    assert.equal(failingBtvnSecret.success, false);
    assert(!String(failingBtvnSecret.error || "").includes(process.env.ADMIN_TEACHING_PASSWORD!));
    assert(!String(failingBtvnSecret.error || "").includes("tok_xyz"));
    const recentLogs = JSON.stringify(jobLogRepo.getRecentLogs(10));
    assert(!recentLogs.includes(process.env.ADMIN_TEACHING_PASSWORD!), "[ADV-18] job_logs leaked secret");

    // [ADV-08] & [ADV-14] hocbu.php HTML status filter + DataTables multi-page (>200 rows) pagination
    const adv08Html = `
      <table><thead><tr><th>STT</th><th>Mã lớp</th><th>Học viên</th><th>Buổi</th><th>Giảng viên</th><th>Trạng thái</th></tr></thead>
      <tbody>
        <tr><td>1</td><td>205ALHP-CODING12</td><td>HV Hoàn Thành</td><td>Buổi 2</td><td>GV A</td><td>Đã học xong</td></tr>
        <tr><td>2</td><td>205ALHP-CODING12</td><td>HV Hoàn Tất</td><td>Buổi 3</td><td>GV A</td><td>Hoàn thành</td></tr>
        <tr><td>3</td><td>205ALHP-CODING12</td><td>HV Còn Nợ</td><td>Buổi 4</td><td>GV A</td><td>Chờ học</td></tr>
      </tbody></table>
    `;
    const adv08Parsed = parseTeachingHocBuHtml(adv08Html);
    assert.equal(adv08Parsed.length, 1);
    assert.equal(adv08Parsed[0].studentName, "HV Còn Nợ");

    const adv14Overview = await fetchAdminTeachingOverviewPages({
      httpClient: {
        getHtmlPage: async (rel: string) => {
          if (rel.includes("index.php")) return "";
          if (rel.includes("check_nhanxet.php")) return "";
          if (rel.includes("start=0&length=200")) {
            return JSON.stringify({
              recordsTotal: 201,
              recordsFiltered: 201,
              data: Array.from({ length: 200 }, (_u, idx) => ({
                class_code: "205ALHP-CODING12",
                student_name: `HV ${idx + 1}`,
                session_number: 1,
                instructor_name: "GV A",
                status: "Lịch mới tạo",
                attendance_status: "Chưa điểm danh",
              })),
            });
          }
          if (rel.includes("start=200&length=200")) {
            return JSON.stringify({
              recordsTotal: 201,
              recordsFiltered: 201,
              data: [
                {
                  class_code: "205ALHP-CODING12",
                  student_name: "HV 201",
                  session_number: 2,
                  instructor_name: "GV A",
                  status: "Lịch mới tạo",
                  attendance_status: "Chưa điểm danh",
                },
              ],
            });
          }
          return "";
        },
      } as any,
    });
    assert.equal(adv14Overview.makeupRows.length, 201, "[ADV-14] DataTables pagination must fetch >200 rows");

    // [ADV-09] One graded + one ungraded submission in same session must count ungraded >= 1
    const adv09Gql = makeCodingClassByIdGql({
      lmsClassId: "lms_adv09",
      classCode: "205ALHP-ADV09",
      courseName: "GameMaker Basic",
      startDate: "2026-08-01",
      endDate: "2026-11-20",
      mainTeacher: "GV Test",
      students: [
        { id: "a1", fullName: "Học Viên Đã Chấm" },
        { id: "a2", fullName: "Học Viên Chờ Chấm" },
      ],
      currentSessionNumber: 3,
      btvnUngradedForStudentId: "a2",
    });
    const adv09Audit = computeAdminClassAudits({
      centerCode: "205ALHP",
      rawClassMeta: { classCode: "205ALHP-ADV09", lmsClassId: "lms_adv09", status: "Running" },
      classByIdData: adv09Gql.classByIdData,
      submissionGqlData: adv09Gql.submissionGqlData,
      studentWorks: [],
      teachingDetail: null,
    });
    const adv09Btvn = JSON.parse(adv09Audit.btvnSummaryJson);
    assert(adv09Btvn.ungradedCellsCount >= 1, "[ADV-09] Graded peer must never hide ungraded submission");
    assert(adv09Btvn.ungradedSessions.includes(3));

    // [ADV-10] check_nhanxet.php row for Buổi 11 must NOT bleed onto Buổi 12
    const adv10Audit = computeAdminClassAudits({
      centerCode: "205ALHP",
      rawClassMeta: { classCode: "205ALHP-ADV10", lmsClassId: "lms_adv10", status: "Running" },
      classByIdData: makeCodingClassByIdGql({
        lmsClassId: "lms_adv10",
        classCode: "205ALHP-ADV10",
        courseName: "GameMaker Basic",
        startDate: "2026-08-01",
        endDate: "2026-11-20",
        mainTeacher: "GV Test",
        students: [{ id: "x1", fullName: "Nguyễn An" }],
        currentSessionNumber: 12,
      }).classByIdData,
      submissionGqlData: null,
      studentWorks: [],
      teachingCheckRows: [
        {
          classCode: "205ALHP-ADV10",
          sessionNumber: 11,
          sessionDate: "10/12/2026",
          mainTeacher: "GV Test",
          assistantTeacher: "",
          block: "Coding",
          zaloDeadline: "",
          zaloStatus: "Đã hoàn thành",
          lmsDeadline: "",
          lmsStatus: "Đã hoàn thành",
          issueDescription: "",
          teacherNote: "",
          evalStatus: "Đủ",
        },
      ],
      teachingDetail: null,
    });
    const adv10Weekly = JSON.parse(adv10Audit.weeklyOpsJson);
    assert.equal(adv10Weekly.zaloStatus, "Chưa xác minh", "[ADV-10] Stale Buổi 11 check must not bleed to Buổi 12");
    assert.equal(adv10Weekly.isZaloLateOrMissing, false);

    // [ADV-11] Session 14 missing 9 ĐNL competency criteria and 2-part comment must flag missingEvalStudents
    const adv11Gql = makeCodingClassByIdGql({
      lmsClassId: "lms_adv11",
      classCode: "205ALHP-ADV11",
      courseName: "GameMaker Basic",
      startDate: "2026-08-01",
      endDate: "2026-11-20",
      mainTeacher: "GV Test",
      students: [{ id: "s14", fullName: "Học Viên Thiếu ĐNL" }],
      currentSessionNumber: 14,
      attendancePresentIndices: [0],
    });
    // Replace B14 attendance with Demo score present, 0 competency criteria, and only 2 sections in comment
    const b14Att = adv11Gql.classByIdData.slots[13].studentAttendance[0];
    b14Att.evaluation = null;
    b14Att.commentByAreas = [
      { type: "DEMO", grade: 4.5 },
      { type: "CONTENT", content: "- **Học được:** Làm tốt.\n- **Điểm cần cải thiện:** Cần luyện thêm." },
    ];
    b14Att.comment = "- **Học được:** Làm tốt.\n- **Điểm cần cải thiện:** Cần luyện thêm.";
    const adv11Audit = computeAdminClassAudits({
      centerCode: "205ALHP",
      rawClassMeta: { classCode: "205ALHP-ADV11", lmsClassId: "lms_adv11", status: "Running" },
      classByIdData: adv11Gql.classByIdData,
      submissionGqlData: adv11Gql.submissionGqlData,
      studentWorks: adv11Gql.studentWorks,
      teachingDetail: null,
    });
    const adv11Spck = JSON.parse(adv11Audit.spckAuditJson);
    assert(
      adv11Spck.session14FinalEval.missingEvalStudents.includes("Học Viên Thiếu ĐNL"),
      "[ADV-11] S14 student missing 9 ĐNL & 3rd MindX section must be flagged"
    );

    // [ADV-12] Incomplete paginated discovery (HTTP 503 on page 2) must NOT prune existing classes
    adminCenterRepo.upsertClass({
      ...afterAdv04,
      classCode: "205ALHP-KEEP99",
      lmsClassId: "lms_keep99",
    });
    const adv12Scan = await scanAdminCenterClasses({
      scope: "ALL",
      includeMakeup: false,
      lmsBundleOverride: {
        discoveredClasses: [lmsBundleOverride.discoveredClasses[0]],
        perClass: new Map([["205ALHP-CODING12", codingGql as any]]),
        stoppedEarly: false,
        discoveryComplete: false,
        discoveryError: "HTTP 503 on page 2",
      },
      teachingDeps: teachingDeps as any,
    });
    assert.equal(adv12Scan.success, false);
    assert.equal(adv12Scan.status, "PARTIAL");
    assert(adminCenterRepo.findClass("205ALHP-KEEP99"), "[ADV-12] Incomplete discovery must NEVER prune cached classes");

    // [ADV-13] Mismatched classByIdData belonging to Class B must be rejected when scanning Class A
    assert.throws(
      () =>
        assertMatchingLmsClassPayload(
          { id: "lms_b", name: "205ALHP-CLASSB" },
          "205ALHP-CLASSA",
          "lms_a"
        ),
      /Class Mismatch/
    );

    // [ADV-19] Valid scale conversion (LMS 80/100 -> Teaching 4/5) must NOT trigger OUT_OF_SYNC
    const adv19Gql = makeCodingClassByIdGql({
      lmsClassId: "lms_adv19",
      classCode: "205ALHP-ADV19",
      courseName: "GameMaker Basic",
      startDate: "2026-08-01",
      endDate: "2026-11-20",
      mainTeacher: "GV Test",
      students: [{ id: "stu1", fullName: "Phạm Gia Huy" }],
      currentSessionNumber: 3,
    });
    // Force score 80/100 on all 3 sessions for stu1
    for (const sub of adv19Gql.submissionGqlData.submissions) {
      sub.score = 80;
      sub.totalScore = 100;
    }
    const adv19Audit = computeAdminClassAudits({
      centerCode: "205ALHP",
      rawClassMeta: { classCode: "205ALHP-ADV19", lmsClassId: "lms_adv19", status: "Running" },
      classByIdData: adv19Gql.classByIdData,
      submissionGqlData: adv19Gql.submissionGqlData,
      studentWorks: [],
      teachingDetail: {
        classCode: "205ALHP-ADV19",
        students: [{ id: 101, student_name: "Phạm Gia Huy", class_code: "205ALHP-ADV19", status: "Đang học" }],
        exercises: [
          { id: 1, session_number: 1, exercise_type: "btvn", exercise_form: "practice", exercise_title: "B1", max_score: 5 },
          { id: 2, session_number: 2, exercise_type: "btvn", exercise_form: "practice", exercise_title: "B2", max_score: 5 },
          { id: 3, session_number: 3, exercise_type: "btvn", exercise_form: "practice", exercise_title: "B3", max_score: 5 },
        ],
        scores: [
          { student_id: 101, class_code: "205ALHP-ADV19", session_number: 1, exercise_type: "btvn", exercise_form: "practice", raw_score: 4, normalized_score: 4, max_score: 5 },
          { student_id: 101, class_code: "205ALHP-ADV19", session_number: 2, exercise_type: "btvn", exercise_form: "practice", raw_score: 4, normalized_score: 4, max_score: 5 },
          { student_id: 101, class_code: "205ALHP-ADV19", session_number: 3, exercise_type: "btvn", exercise_form: "practice", raw_score: 4, normalized_score: 4, max_score: 5 },
        ],
        project: null,
        tasks: [],
        taskProgress: {},
      },
    });
    assert.equal(
      JSON.parse(adv19Audit.btvnSummaryJson).isOutOfSyncWithTeaching,
      false,
      "[ADV-19] Equivalent 80/100 == 4/5 score must not be reported as OUT_OF_SYNC"
    );

    // [ADV-20] Single-class SPCK provisioning before Buổi 10 (> Buổi 9) must reject HTTP 400 with 0 writes
    adminCenterRepo.upsertClass({
      ...afterAdv04,
      classCode: "205ALHP-ADV20",
      lmsClassId: "lms_adv20",
      currentSessionNumber: 1,
      status: "Running",
    });
    let adv20Writes = 0;
    const adv20Res = await provisionAdminSpckTasksOnTeaching("205ALHP-ADV20", {
      transport: {
        ...fakeProjectTransport,
        createProject: async () => {
          adv20Writes++;
          return { success: true, id: 1 };
        },
        saveTask: async () => {
          adv20Writes++;
          return { success: true, id: 1 };
        },
      } as any,
    });
    assert.equal(adv20Res.success, false);
    assert.equal(adv20Res.statusCode, 400);
    assert.equal(adv20Writes, 0, "[ADV-20] Session 1 class must fail > Buổi 9 guard with 0 Teaching writes");

    console.log("PASS [AC-09] All 20 Codex Adversarial Scenarios (ADV-01..ADV-20)");

    // =========================================================================
    // [AC-10] Codex Round 2 Regression Suite (R2-01..R2-07)
    // =========================================================================
    // [R2-01] Malformed, empty, non-object JSON or missing explicit mode/scope MUST return HTTP 400 and perform 0 writes
    const { LiveTeachingReportCardHttpTransport } = await import(
      "../src/lib/playwright/teaching-report-card-sync"
    );
    const { LiveTeachingHttpTransport } = await import(
      "../src/lib/playwright/teaching-project-service"
    );
    const origRcSave = LiveTeachingReportCardHttpTransport.prototype.saveScores;
    const origRcAddEx = LiveTeachingReportCardHttpTransport.prototype.addMultiExercise;
    const origPrjSaveTask = LiveTeachingHttpTransport.prototype.saveTask;
    const origPrjCreate = LiveTeachingHttpTransport.prototype.createProject;
    let r201Writes = 0;
    LiveTeachingReportCardHttpTransport.prototype.saveScores = async () => {
      r201Writes++;
      return { success: true };
    };
    LiveTeachingReportCardHttpTransport.prototype.addMultiExercise = async () => {
      r201Writes++;
      return { success: true };
    };
    LiveTeachingHttpTransport.prototype.saveTask = async () => {
      r201Writes++;
      return { success: true };
    };
    LiveTeachingHttpTransport.prototype.createProject = async () => {
      r201Writes++;
      return { success: true };
    };
    try {
      const r201Headers = { host: "127.0.0.1:3000", "Content-Type": "application/json" };
      for (const badBody of ["{", "", "   ", "[]", "null", '"bad"', "123", "{}"]) {
        const resSync = await syncBtvnPOST(
          new Request("http://127.0.0.1:3000/api/admin-center/sync-btvn", {
            method: "POST",
            headers: r201Headers,
            body: badBody,
          })
        );
        assert.equal(resSync.status, 400, `[R2-01] sync-btvn rejected body=${badBody}`);
        assert.equal((await resSync.json()).success, false);

        const resProv = await provisionSpckPOST(
          new Request("http://127.0.0.1:3000/api/admin-center/provision-spck-tasks", {
            method: "POST",
            headers: r201Headers,
            body: badBody,
          })
        );
        assert.equal(resProv.status, 400, `[R2-01] provision-spck-tasks rejected body=${badBody}`);
        assert.equal((await resProv.json()).success, false);

        const resScan = await scanPOST(
          new Request("http://127.0.0.1:3000/api/admin-center/scan", {
            method: "POST",
            headers: r201Headers,
            body: badBody,
          })
        );
        assert.equal(resScan.status, 400, `[R2-01] scan rejected body=${badBody}`);
        assert.equal((await resScan.json()).success, false);
      }
      assert.equal(r201Writes, 0, "[R2-01] Rejected malformed/missing-mode requests must cause 0 remote writes");
    } finally {
      LiveTeachingReportCardHttpTransport.prototype.saveScores = origRcSave;
      LiveTeachingReportCardHttpTransport.prototype.addMultiExercise = origRcAddEx;
      LiveTeachingHttpTransport.prototype.saveTask = origPrjSaveTask;
      LiveTeachingHttpTransport.prototype.createProject = origPrjCreate;
    }

    // [R2-02] createScanRun failure (e.g. SQLITE_BUSY) MUST reset progressState.isRunning so retry succeeds
    resetAdminScanProgressForTest();
    const origCreateScanRun = adminCenterRepo.createScanRun;
    (adminCenterRepo as any).createScanRun = () => {
      throw new Error("SQLITE_BUSY: database is locked");
    };
    try {
      await assert.rejects(
        scanAdminCenterClasses({
          scope: "TEACHING_ONLY",
          teachingDeps: teachingDeps as any,
        }),
        /SQLITE_BUSY/
      );
      assert.equal(
        getAdminScanProgressState().isRunning,
        false,
        "[R2-02] isRunning must reset to false even when createScanRun throws"
      );
    } finally {
      adminCenterRepo.createScanRun = origCreateScanRun;
    }
    const r202Retry = await scanAdminCenterClasses({
      scope: "TEACHING_ONLY",
      teachingDeps: teachingDeps as any,
    });
    assert.equal(r202Retry.success, true, "[R2-02] Subsequent scan must succeed without restart after createScanRun error");

    // [R2-03] HTTP 503 on LMS GraphQL (classById or submissions/studentWorks) rejects single fetch, sets PARTIAL, and preserves cached metrics
    const r203Gql = makeCodingClassByIdGql({
      lmsClassId: "lms_r203",
      classCode: "205ALHP-R203",
      courseName: "GameMaker Basic",
      startDate: "2026-08-01",
      endDate: "2026-11-20",
      mainTeacher: "Nguyễn Minh An",
      students: [
        { id: "r1", fullName: "Phạm Gia Huy" },
        { id: "r2", fullName: "Lê Quốc Bảo" },
      ],
      currentSessionNumber: 12,
      attendancePresentIndices: [0, 1],
    });
    const origWithAdminSession = authService.withAdminLmsSession;
    const origOpenDrawer = LmsHelpers.openClassDrawer;
    const origSwitchTab = LmsHelpers.switchDrawerTab;
    let r203FetchMode: "all-good" | "side-503" | "class-503" = "all-good";
    const mockVmPage: any = {
      on: () => {},
      off: () => {},
      goto: async () => {},
      reload: async () => {},
      waitForTimeout: async () => {},
      locator: () => ({ first: () => ({ isVisible: async () => false }) }),
      evaluate: async (fn: any, args: any) => {
        if (typeof fn === "string") return;
        const mockFetch = async (_url: string, opts: any) => {
          const parsed = JSON.parse(opts?.body || "{}");
          const q = String(parsed?.query || "");
          const mkResp = (bodyObj: any, statusCode: number) => ({
            ok: statusCode >= 200 && statusCode < 300,
            status: statusCode,
            json: async () => bodyObj,
          });
          if (/findStudentSubmissionByClass|studentSubmissions/.test(q)) {
            return r203FetchMode === "all-good"
              ? mkResp({ data: { findStudentSubmissionByClass: r203Gql.submissionGqlData } }, 200)
              : mkResp({ errors: [{ message: "submissions 503" }] }, 503);
          }
          if (/findAllStudentWorks/.test(q)) {
            return r203FetchMode === "all-good"
              ? mkResp({ data: { findAllStudentWorks: { data: r203Gql.studentWorks } } }, 200)
              : mkResp({ errors: [{ message: "works 503" }] }, 503);
          }
          if (/classesById|query GetClassById/.test(q)) {
            return mkResp(
              { data: { classesById: r203Gql.classByIdData } },
              r203FetchMode === "class-503" ? 503 : 200
            );
          }
          return mkResp(
            {
              data: {
                classes: {
                  data: [
                    {
                      id: r203Gql.classByIdData.id,
                      name: r203Gql.classByIdData.name,
                      status: "Running",
                      startDate: "2026-08-01",
                      endDate: "2026-11-20",
                      course: { name: "GameMaker Basic" },
                      teachers: [],
                    },
                  ],
                  pagination: { total: 1 },
                },
              },
            },
            200
          );
        };
        return vm.runInNewContext(`(${fn.toString()})(args)`, {
          args,
          fetch: mockFetch,
          __name: (v: any) => v,
          Date,
          Set,
          Map,
          JSON,
          Array,
          Object,
          String,
          Number,
          Boolean,
          Error,
          Promise,
        });
      },
    };
    const r203TeachingDeps = {
      ...teachingDeps,
      reportCardTransport: {
        ...teachingDeps.reportCardTransport,
        getStudents: async () => [
          { id: 101, student_name: "Phạm Gia Huy", class_code: "205ALHP-R203", status: "Đang học" },
          { id: 102, student_name: "Lê Quốc Bảo", class_code: "205ALHP-R203", status: "Đang học" },
        ],
      },
    };
    try {
      LmsHelpers.openClassDrawer = async () => {};
      LmsHelpers.switchDrawerTab = async () => {};
      authService.withAdminLmsSession = async (fn: any) => fn(mockVmPage);

      const singleOk = await fetchSingleLmsClassGqlInAdminSession(mockVmPage, "205ALHP-R203");
      assert.equal(singleOk.studentWorks.length, r203Gql.studentWorks.length);

      r203FetchMode = "side-503";
      await assert.rejects(
        fetchSingleLmsClassGqlInAdminSession(mockVmPage, "205ALHP-R203"),
        /503|submissions|SPCK/i
      );
      r203FetchMode = "class-503";
      await assert.rejects(
        fetchSingleLmsClassGqlInAdminSession(mockVmPage, "205ALHP-R203"),
        /503|HTTP/i
      );

      // Seed cached healthy metrics first, then re-scan with side endpoints returning HTTP 503
      r203FetchMode = "all-good";
      resetAdminScanProgressForTest();
      const baselineScan = await scanAdminCenterClasses({
        scope: "SINGLE_CLASS",
        classCode: "205ALHP-R203",
        includeMakeup: false,
        teachingDeps: r203TeachingDeps as any,
      });
      assert.equal(baselineScan.success, true);
      const cachedR203 = adminCenterRepo.findClass("205ALHP-R203")!;
      const cachedBtvn = JSON.parse(cachedR203.btvnSummaryJson);
      const cachedSpck = JSON.parse(cachedR203.spckAuditJson);
      assert(cachedBtvn.gradedCellsCount > 0, "[R2-03] Expected positive cached graded BTVN count");
      assert.equal(cachedSpck.totalMissingUploads, 0);

      r203FetchMode = "side-503";
      resetAdminScanProgressForTest();
      const partialLmsScan = await scanAdminCenterClasses({
        scope: "SINGLE_CLASS",
        classCode: "205ALHP-R203",
        includeMakeup: false,
        teachingDeps: r203TeachingDeps as any,
      });
      assert.equal(partialLmsScan.success, false, "[R2-03] Side 503 must not report success=true");
      assert.equal(partialLmsScan.status, "PARTIAL", "[R2-03] Side 503 must report PARTIAL");
      const afterSide503 = adminCenterRepo.findClass("205ALHP-R203")!;
      assert.equal(
        JSON.parse(afterSide503.btvnSummaryJson).gradedCellsCount,
        cachedBtvn.gradedCellsCount,
        "[R2-03] Cached BTVN graded count must be preserved when LMS submissions query fails"
      );
      assert.equal(
        JSON.parse(afterSide503.spckAuditJson).totalMissingUploads,
        cachedSpck.totalMissingUploads,
        "[R2-03] Cached SPCK uploads must be preserved when LMS findAllStudentWorks fails"
      );
    } finally {
      authService.withAdminLmsSession = origWithAdminSession;
      LmsHelpers.openClassDrawer = origOpenDrawer;
      LmsHelpers.switchDrawerTab = origSwitchTab;
    }

    // [R2-04] Non-standard 5 tasks (e.g. [100,0,0,0,0] or arbitrary names) MUST fail compliance and be fixed by AUTO batch
    const arbitrary100Tasks = Array.from({ length: 5 }, (_, idx) => ({
      id: 9000 + idx,
      project_id: 505,
      task_name: `Custom ${idx}`,
      description: `Mô tả ${idx}`,
      weight_percent: idx === 0 ? 100 : 0,
      deadline: "2026-11-20",
      assigned_students: [101, 102],
    }));
    const r204Audit = computeAdminClassAudits({
      centerCode: "205ALHP",
      rawClassMeta: {
        classCode: "205ALHP-R204",
        lmsClassId: "lms_r204",
        courseName: "GameMaker Basic",
        status: "Running",
        startDate: "2026-08-01",
        endDate: "2026-11-20",
      },
      classByIdData: { ...r203Gql.classByIdData, id: "lms_r204", name: "205ALHP-R204" },
      submissionGqlData: r203Gql.submissionGqlData,
      studentWorks: r203Gql.studentWorks,
      teachingDetail: {
        classCode: "205ALHP-R204",
        students: [
          { id: 101, student_name: "Phạm Gia Huy", class_code: "205ALHP-R204", status: "Đang học" },
          { id: 102, student_name: "Lê Quốc Bảo", class_code: "205ALHP-R204", status: "Đang học" },
        ],
        exercises: [],
        scores: [],
        project: { id: 505, class_code: "205ALHP-R204", project_name: "SPCK - R204", start_date: "2026-08-01", end_date: "2026-11-20" },
        tasks: arbitrary100Tasks,
        taskProgress: {},
      },
    });
    assert.equal(JSON.parse(r204Audit.spckTasksJson).taskStatus, "INCOMPLETE_TASKS");
    assert.equal(r204Audit.spckTasksSyncStatus, "INCOMPLETE");
    assert.equal(
      evaluateTeachingSpckTasksCompliance({
        classCode: "205ALHP-R204",
        courseName: "GameMaker Basic",
        endDate: "2026-11-20",
        eligibleGt9: true,
        project: { id: 505 },
        tasks: arbitrary100Tasks.map((t) => ({ ...t, weight_percent: 20 })),
        activeStudentIds: [101, 102],
      }).taskStatus,
      "INCOMPLETE_TASKS",
      "[R2-04] Arbitrary non-standard task names must still report INCOMPLETE_TASKS"
    );
    adminCenterRepo.upsertClass(r204Audit);
    const r204RemoteTasks = [...arbitrary100Tasks];
    const r204BatchAuto = await provisionAdminBatchSpckTasksOnTeaching(undefined, {
      transport: {
        getProject: async () => ({ id: 505, class_code: "205ALHP-R204", project_name: "SPCK - R204", start_date: "2026-08-01", end_date: "2026-11-20" }),
        getStudents: async () => [
          { id: 101, student_name: "Phạm Gia Huy", class_code: "205ALHP-R204", status: "Đang học" },
          { id: 102, student_name: "Lê Quốc Bảo", class_code: "205ALHP-R204", status: "Đang học" },
        ],
        getTasks: async () => r204RemoteTasks,
        getTaskProgress: async () => ({}),
        createProject: async () => ({ success: true, id: 505 }),
        saveTask: async (p: any) => {
          const existingIdx = r204RemoteTasks.findIndex((x) => Number(x.id) === Number(p.taskId));
          if (existingIdx >= 0) {
            r204RemoteTasks[existingIdx] = {
              ...r204RemoteTasks[existingIdx],
              task_name: p.taskName,
              description: p.description,
              weight_percent: p.weightPercent,
              deadline: p.deadline,
              assigned_students: p.assignedStudentIds,
            };
          }
          return { success: true, id: p.taskId || 9999 };
        },
        deleteTask: async () => ({ success: true }),
        updateTaskProgress: async () => ({ success: true }),
      } as any,
    });
    assert(
      r204BatchAuto.results.some((r) => r.classCode === "205ALHP-R204" && r.status === "VERIFIED"),
      "[R2-04] AUTO batch must select non-standard 5 tasks and upgrade to standard VERIFIED"
    );

    // [R2-05] LMS > 0 students vs Teaching = 0 students (when students fetch succeeded) MUST emit ROSTER_MISMATCH
    const r205Mismatch = computeAdminClassAudits({
      centerCode: "205ALHP",
      rawClassMeta: { classCode: "205ALHP-R205", lmsClassId: "lms_r205", status: "Running" },
      classByIdData: { ...r203Gql.classByIdData, id: "lms_r205", name: "205ALHP-R205" },
      submissionGqlData: r203Gql.submissionGqlData,
      studentWorks: [],
      teachingDetail: {
        classCode: "205ALHP-R205",
        students: [],
        exercises: [],
        scores: [],
        project: null,
        tasks: [],
        taskProgress: {},
        hasFetchError: false,
      },
    });
    assert(
      JSON.parse(r205Mismatch.earlyWarningsJson).some((w: any) => w.type === "ROSTER_MISMATCH"),
      "[R2-05] LMS=2 vs Teaching=0 with healthy students endpoint must emit ROSTER_MISMATCH"
    );
    const r205ErrSkipped = computeAdminClassAudits({
      centerCode: "205ALHP",
      rawClassMeta: { classCode: "205ALHP-R205", lmsClassId: "lms_r205", status: "Running" },
      classByIdData: { ...r203Gql.classByIdData, id: "lms_r205", name: "205ALHP-R205" },
      submissionGqlData: r203Gql.submissionGqlData,
      studentWorks: [],
      teachingDetail: {
        classCode: "205ALHP-R205",
        students: [],
        exercises: [],
        scores: [],
        project: null,
        tasks: [],
        taskProgress: {},
        hasFetchError: true,
        failedEndpoints: ["students"],
      },
    });
    assert.equal(
      JSON.parse(r205ErrSkipped.earlyWarningsJson).some((w: any) => w.type === "ROSTER_MISMATCH"),
      false,
      "[R2-05] Failed students endpoint must NOT false-trigger ROSTER_MISMATCH"
    );

    // [R2-06] Empty hocbu.php page before recordsFiltered MUST warn and fail clean COMPLETED
    const truncatedDeps = {
      ...teachingDeps,
      httpClient: {
        getHtmlPage: async (rel: string) => {
          if (rel.includes("hocbu.php")) {
            if (rel.includes("start=0&")) {
              return JSON.stringify({
                recordsFiltered: 250,
                data: [
                  {
                    class_code: "205ALHP-CODING12",
                    student_name: "Phạm Gia Huy",
                    session_number: 1,
                    status: "Chờ học",
                  },
                ],
              });
            }
            return JSON.stringify({ recordsFiltered: 250, data: [] });
          }
          if (rel.includes("index.php")) return sampleIndexHtml;
          if (rel.includes("check_nhanxet.php")) return sampleCheckHtml;
          return "";
        },
      },
    };
    const truncatedOv = await fetchAdminTeachingOverviewPages(truncatedDeps as any);
    assert(
      truncatedOv.fetchWarnings.some((w) => w.includes("1/250")),
      "[R2-06] Early empty page in /hocbu.php must emit incomplete pagination warning"
    );
    resetAdminScanProgressForTest();
    const truncatedScan = await scanAdminCenterClasses({
      scope: "TEACHING_ONLY",
      teachingDeps: truncatedDeps as any,
    });
    assert.equal(truncatedScan.success, false, "[R2-06] Truncated hocbu scan must not return success=true");

    // [R2-07] ISO timestamp normalization (Asia/Ho_Chi_Minh UTC+7) must reject wrong/blank-date check_nhanxet.php rows and match UTC+7 rollover
    assert.equal(normalizeDateToIsoYmd("2026-12-17T10:00:00.000Z"), "2026-12-17");
    assert.equal(normalizeDateToIsoYmd("2026-12-16T17:00:00.000Z"), "2026-12-17");
    for (const wrongDateStr of ["1999-01-01", "2026-12-10", ""]) {
      const wrongDateAudit = computeAdminClassAudits({
        centerCode: "205ALHP",
        rawClassMeta: { classCode: "205ALHP-R203", lmsClassId: "lms_r203", status: "Running" },
        classByIdData: r203Gql.classByIdData,
        submissionGqlData: r203Gql.submissionGqlData,
        studentWorks: r203Gql.studentWorks,
        teachingCheckRows: [
          {
            classCode: "205ALHP-R203",
            sessionNumber: 12,
            sessionDate: wrongDateStr,
            mainTeacher: "Nguyễn Minh An",
            assistantTeacher: "",
            block: "Coding",
            zaloDeadline: "17/12/2026",
            zaloStatus: "Đã hoàn thành",
            lmsDeadline: "18/12/2026",
            lmsStatus: "Đã hoàn thành",
            issueDescription: "",
            teacherNote: "",
            evalStatus: "Đủ",
          },
        ],
      });
      const wrongDateWeekly = JSON.parse(wrongDateAudit.weeklyOpsJson);
      assert.equal(wrongDateWeekly.evaluatedSessionDate, "2026-12-17");
      assert.equal(
        wrongDateWeekly.zaloStatus,
        "Chưa xác minh",
        `[R2-07] ISO timestamp slot 2026-12-17T10:00:00.000Z must NOT match check_nhanxet row from "${wrongDateStr}"`
      );
      assert.equal(wrongDateWeekly.lmsCheckStatus, "Chưa xác minh");
    }

    const utcPlus7RolloverClassById = structuredClone(r203Gql.classByIdData);
    utcPlus7RolloverClassById.slots[11].date = "2026-12-16T17:00:00.000Z";
    utcPlus7RolloverClassById.slots[11].startTime = "2026-12-16T17:00:00.000Z";
    const vnRolloverAudit = computeAdminClassAudits({
      centerCode: "205ALHP",
      rawClassMeta: { classCode: "205ALHP-R203", lmsClassId: "lms_r203", status: "Running" },
      classByIdData: utcPlus7RolloverClassById,
      submissionGqlData: r203Gql.submissionGqlData,
      studentWorks: r203Gql.studentWorks,
      teachingCheckRows: [
        {
          classCode: "205ALHP-R203",
          sessionNumber: 12,
          sessionDate: "17/12/2026",
          mainTeacher: "Nguyễn Minh An",
          assistantTeacher: "",
          block: "Coding",
          zaloDeadline: "17/12/2026",
          zaloStatus: "Đã hoàn thành",
          lmsDeadline: "18/12/2026",
          lmsStatus: "Đã hoàn thành",
          issueDescription: "",
          teacherNote: "",
          evalStatus: "Đủ",
        },
      ],
    });
    const vnRolloverWeekly = JSON.parse(vnRolloverAudit.weeklyOpsJson);
    assert.equal(vnRolloverWeekly.evaluatedSessionDate, "2026-12-17");
    assert.equal(vnRolloverWeekly.zaloStatus, "Đã hoàn thành");
    assert.equal(vnRolloverWeekly.lmsCheckStatus, "Đã hoàn thành");

    console.log("PASS [AC-10] All 7 Codex Round 2 Scenarios (R2-01..R2-07)");

    // =========================================================================
    // [AC-11] Codex Round 3 Closure (#8 Fractional Weight, R3-02 RunId, R3-01 UI verified above)
    // =========================================================================
    const stdFive20 = getStandardFiveTasksForClass(
      "205ALHP-R204",
      "2026-11-20",
      [101, 102],
      "GameMaker Basic"
    ).map((t, idx) => ({
      id: 9500 + idx,
      project_id: 505,
      task_name: t.taskName,
      description: t.description,
      weight_percent: 20,
      deadline: t.deadline,
      assigned_students: t.assignedStudentIds,
    }));
    const extraFractionalTask = {
      id: 9599,
      project_id: 505,
      task_name: "Ghi chú thêm của GV",
      description: "Phụ",
      weight_percent: 0.1,
      deadline: "2026-11-20",
      assigned_students: [101, 102],
    };
    const r3Tasks1001 = [...stdFive20, extraFractionalTask];
    const eval1001 = evaluateTeachingSpckTasksCompliance({
      classCode: "205ALHP-R204",
      courseName: "GameMaker Basic",
      endDate: "2026-11-20",
      eligibleGt9: true,
      project: { id: 505 },
      tasks: r3Tasks1001,
      activeStudentIds: [101, 102],
    });
    assert.equal(
      eval1001.taskStatus,
      "INCOMPLETE_TASKS",
      "[#8] 100.1% weight (5x20% + 0.1% extra) must fail compliance as INCOMPLETE_TASKS"
    );

    let r3DeletedIds: number[] = [];
    const r3ExtraWeightTransport = {
      getProject: async () => ({
        id: 505,
        class_code: "205ALHP-R204",
        project_name: "SPCK - R204",
        start_date: "2026-08-01",
        end_date: "2026-11-20",
      }),
      getStudents: async () => [
        { id: 101, student_name: "Phạm Gia Huy", class_code: "205ALHP-R204", status: "Đang học" },
        { id: 102, student_name: "Lê Quốc Bảo", class_code: "205ALHP-R204", status: "Đang học" },
      ],
      getTasks: async () => r3Tasks1001,
      getTaskProgress: async () => ({}),
      createProject: async () => ({ success: true, id: 505 }),
      saveTask: async (p: any) => ({ success: true, id: p.taskId || 9590 }),
      deleteTask: async (id: number) => {
        r3DeletedIds.push(id);
        return { success: true };
      },
      updateTaskProgress: async () => ({ success: true }),
    } as any;

    const provision1001 = await provisionAdminSpckTasksOnTeaching("205ALHP-R204", {
      syncProgressBySession: false,
      transport: r3ExtraWeightTransport,
    });
    assert.equal(provision1001.success, false, "[#8] Provision with 100.1% must fail");
    assert.equal(provision1001.statusCode, 409, "[#8] Expected HTTP 409 NEEDS_ATTENTION");
    assert.equal(provision1001.status, "NEEDS_ATTENTION");
    assert.equal(adminCenterRepo.findClass("205ALHP-R204")?.spckTasksSyncStatus, "INCOMPLETE");
    assert.equal(r3DeletedIds.length, 0, "[#8] Extra task must be preserved untouched");

    // Near-threshold boundary: [20, 20, 20, 20, 20, 6e-7, 6e-7] => raw total delta 1.2e-6 > 1e-6 MUST fail
    const nearThresholdTasks = [
      ...stdFive20,
      {
        id: 9597,
        project_id: 505,
        task_name: "Phụ trợ sát ngưỡng A",
        description: "Phụ A",
        weight_percent: 6e-7,
        deadline: "2026-11-20",
        assigned_students: [101, 102],
      },
      {
        id: 9598,
        project_id: 505,
        task_name: "Phụ trợ sát ngưỡng B",
        description: "Phụ B",
        weight_percent: 6e-7,
        deadline: "2026-11-20",
        assigned_students: [101, 102],
      },
    ];
    const evalNearThreshold = evaluateTeachingSpckTasksCompliance({
      classCode: "205ALHP-R204",
      courseName: "GameMaker Basic",
      endDate: "2026-11-20",
      eligibleGt9: true,
      project: { id: 505 },
      tasks: nearThresholdTasks,
      activeStudentIds: [101, 102],
    });
    assert.equal(
      evalNearThreshold.taskStatus,
      "INCOMPLETE_TASKS",
      "[#8] Unrounded sum delta 1.2e-6 (> 1e-6) must fail compliance as INCOMPLETE_TASKS"
    );
    r3DeletedIds = [];
    const provisionNearThreshold = await provisionAdminSpckTasksOnTeaching("205ALHP-R204", {
      syncProgressBySession: false,
      transport: {
        ...r3ExtraWeightTransport,
        getTasks: async () => nearThresholdTasks,
      },
    });
    assert.equal(provisionNearThreshold.success, false, "[#8] Near-threshold sum > 1e-6 must fail");
    assert.equal(provisionNearThreshold.statusCode, 409);
    assert.equal(provisionNearThreshold.status, "NEEDS_ATTENTION");
    assert.equal(adminCenterRepo.findClass("205ALHP-R204")?.spckTasksSyncStatus, "INCOMPLETE");
    assert.equal(r3DeletedIds.length, 0, "[#8] Near-threshold extra tasks must be preserved");

    // Flip extra task weight to 0% -> must pass as READY & VERIFIED
    extraFractionalTask.weight_percent = 0;
    const eval100Exact = evaluateTeachingSpckTasksCompliance({
      classCode: "205ALHP-R204",
      courseName: "GameMaker Basic",
      endDate: "2026-11-20",
      eligibleGt9: true,
      project: { id: 505 },
      tasks: r3Tasks1001,
      activeStudentIds: [101, 102],
    });
    assert.equal(eval100Exact.taskStatus, "READY", "[#8] 5x20% + 0% extra must pass as READY");
    const provision100Exact = await provisionAdminSpckTasksOnTeaching("205ALHP-R204", {
      syncProgressBySession: false,
      transport: r3ExtraWeightTransport,
    });
    assert.equal(provision100Exact.success, true);
    assert.equal(provision100Exact.statusCode, 200);
    assert.equal(provision100Exact.status, "VERIFIED");

    // [R3-02] Same-millisecond sequential scans must generate unique runIds without UNIQUE constraint error
    const origDateNow = Date.now;
    try {
      const fixedNow = 1794680000000;
      Date.now = () => fixedNow;
      resetAdminScanProgressForTest();
      const stoppedSameMs = await scanAdminCenterClasses({
        scope: "TEACHING_ONLY",
        teachingDeps: {
          ...teachingDeps,
          httpClient: {
            getHtmlPage: async (rel: string) => {
              taskQueue.stopQueue();
              return teachingDeps.httpClient.getHtmlPage(rel);
            },
          },
        } as any,
      });
      assert.equal(stoppedSameMs.status, "STOPPED");

      taskQueue.resumeQueue();
      resetAdminScanProgressForTest();
      const resumedSameMs = await scanAdminCenterClasses({
        scope: "TEACHING_ONLY",
        teachingDeps: teachingDeps as any,
      });
      assert.equal(resumedSameMs.success, true, "[R3-02] Resumed scan in same millisecond must succeed");
      assert.notEqual(
        resumedSameMs.runId,
        stoppedSameMs.runId,
        "[R3-02] Same-ms scans must generate distinct runIds"
      );
    } finally {
      Date.now = origDateNow;
      taskQueue.resumeQueue();
      resetAdminScanProgressForTest();
    }

    console.log("PASS [AC-11] Codex Round 3 Closure (#8 Fractional Weight, R3-01 Strict JSON UI, R3-02 Unique RunId)");
    console.log("ALL ADMIN CENTER V3.5.0 TESTS PASSED");
  } finally {
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
