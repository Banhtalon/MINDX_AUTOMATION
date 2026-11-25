/**
 * KIỂM THỬ TỰ ĐỘNG PHẦN 1 (`v3.8.9`) — ADMIN CENTER (`205ALHP` OPTION B & ĐỒNG BỘ CHỈ SỐ THỰC TẾ)
 *
 * Chạy 100% cô lập trong `os.tmpdir()` — KHÔNG chạm `data/` thật.
 *
 * Các ca kiểm thử:
 * - [AC389-01] Option B: Ẩn hoàn toàn lớp chưa khai giảng / PENDING (`GI38`, `JSA16`, `JSI13-HB`, `PREB20`, `SEMIB08`)
 *              cả ở Discovery, Single-Class Scan pruning (xóa record cũ) và buildAdminOverviewResponse
 * - [AC389-02] Không cộng trước lịch cuối tuần từ Teaching -> không hiện cảnh báo sớm Buổi 14 (DEMO) cho lớp Buổi 13
 *              (`GA39`, `PTI11`, `SI25`, `KIND-ROB4B04`) hay Buổi 9 (CP2) cho lớp Buổi 8 (`GA40`, `JSB17`),
 *              trong khi giữ nguyên cảnh báo đúng cho lớp thực sự đang ở Buổi 9 (`JSI12-HB`)
 * - [AC389-03] Không cộng sớm slot cùng ngày chưa tới giờ học (`18:00 - 20:00` khi mới `12:30` giờ VN) — `hasLmsSlotTimePassed`
 * - [AC389-04] Khớp đúng mốc BTVN (`sessionNumber <= currentSessionNumber - 1`, Buổi 1 -> 0 bài, Buổi 9 -> Buổi 1..8)
 * - [AC389-05] Khôi phục `mainTeacher` & `assistantTeacher` trên lớp `FINISHED` (`GA38`, `GB42-HB`, `PTA13`, `KIND-ROB4I01`, `ROB-ARMB19`)
 *              từ `slots[].teachers` / `slots[].teacherAttendance` khi root `Class.teachers` rỗng
 * - [AC389-06] Tab 3 `session14FinalEval` đếm `mindx3PartCommentCount` từ `studentLetters` (`findStudentLettersPagination`)
 *              và nhận diện điểm Demo Robotics `Demo2024 | ROB` (`demoQuestions` sum)
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-admin-v389-"));
const configDir = path.join(tmpRoot, "config");
const tokenDir = path.join(tmpRoot, "tokens");
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(tokenDir, { recursive: true });

(process.env as Record<string, string | undefined>).NODE_ENV = "test";
process.env.MINDX_DB_PATH = path.join(tempDir(), "mindx_bot.db");
process.env.MINDX_CONFIG_DIR = configDir;
process.env.MINDX_RUNNING_CLASSES_PATH = path.join(tmpRoot, "running_classes.json");
process.env.MINDX_LMS_CLASS_IDS_PATH = path.join(configDir, "lms_class_ids.json");
process.env.MINDX_ROLE_STATE_DIR = path.join(tmpRoot, "role-state");
process.env.MINDX_LMS_TOKEN_DIR = tokenDir;
process.env.ALLOWED_LOCAL_DIRS = tmpRoot;
process.env.MINDX_LMS_API_READ = "true";
process.env.ADMIN_CENTER_CODE = "205ALHP";
process.env.ADMIN_LMS_USERNAME = "admin.test@mindx.com.vn";
process.env.ADMIN_LMS_PASSWORD = "AdminDummySecret#389";
process.env.LMS_USERNAME = "teacher.test@mindx.net.vn";
process.env.LMS_PASSWORD = "TeacherDummySecret#389";
process.env.ADMIN_TEACHING_USERNAME = "teaching.admin";
process.env.ADMIN_TEACHING_PASSWORD = "TeachingDummySecret#389";
process.env.TEACHING_USERNAME = "teaching.admin";
process.env.TEACHING_PASSWORD = "TeachingDummySecret#389";

function tempDir() {
  return tmpRoot;
}

function makeJwt(email: string): string {
  const h = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
  const p = Buffer.from(
    JSON.stringify({ email, exp: Math.floor(Date.now() / 1000) + 7200, user_id: "uid_admin" })
  ).toString("base64url");
  return `${h}.${p}.${crypto.randomBytes(8).toString("base64url")}`;
}

async function main() {
  console.log("=== TEST ADMIN CENTER v3.8.9 (OPTION B & DATA CONSISTENCY) ===");

  // Seed admin & teacher Firebase tokens so pure-Node HTTP never launches Chromium
  for (const [role, file, email, uname] of [
    ["ADMIN", "lms_token_admin.json", "admin.test@mindx.com.vn", "admin.test@mindx.com.vn"],
    ["TEACHER", "lms_token_teacher.json", "teacher.test@mindx.net.vn", "teacher.test@mindx.net.vn"],
  ] as const) {
    fs.writeFileSync(
      path.join(tokenDir, file),
      JSON.stringify({
        role,
        username: uname,
        email,
        userId: `uid_${role.toLowerCase()}`,
        firebaseApiKey: "AIzaDummyApiKey389",
        idToken: makeJwt(email),
        refreshToken: `refresh_${role.toLowerCase()}`,
        expiresAtMs: Date.now() + 3600_000,
        updatedAt: new Date().toISOString(),
      }),
      "utf8"
    );
  }

  const adminScannerMod = await import("../src/lib/admin-center/admin-lms-scanner");
  const lmsHttpMod = await import("../src/lib/lms/lms-http-client");
  const sqliteMod = await import("../src/lib/db/sqlite");

  const {
    hasLmsSlotTimePassed,
    isAdminUnstartedOrPendingClass,
    scanAdminCenterClasses,
    buildAdminOverviewResponse,
  } = adminScannerMod;
  const { setLmsHttpTransportForTest } = lmsHttpMod;
  const { adminCenterRepo } = sqliteMod;

  try {
    // -----------------------------------------------------------------------
    // [AC389-03] Exact timestamp boundary (no +6h future leak)
    // -----------------------------------------------------------------------
    console.log("\n[AC389-03] Kiểm tra mốc giờ slot trong cùng ngày (`hasLmsSlotTimePassed`)...");
    {
      // 2026-11-22 12:30 Asia/Ho_Chi_Minh = 05:30 UTC
      const noonVnMs = Date.parse("2026-11-22T12:30:00+07:00");
      const slotEvening = {
        date: "2026-11-22",
        startTime: "18:00",
        endTime: "20:00",
      };
      assert.strictEqual(
        hasLmsSlotTimePassed(slotEvening, noonVnMs),
        false,
        "Lúc 12:30 chiều, slot học 18:00 tối cùng ngày KHÔNG được coi là đã học!"
      );

      // 2026-11-22 18:10 Asia/Ho_Chi_Minh -> slot has started
      assert.strictEqual(
        hasLmsSlotTimePassed({ date: "2026-11-22T17:00:00.000Z", fallbackTimeSlot: undefined }, Date.parse("2026-11-22T12:30:00+07:00"), "18:00-20:00"),
        false,
        "Date-only midnight UTC (2026-11-22T17:00:00.000Z) + fallbackTimeSlot 18:00-20:00 tại 12:30 không được báo đã học!"
      );
      assert.strictEqual(
        hasLmsSlotTimePassed({ date: "2026-11-22", startTime: "2026-11-21T17:00:00.000Z" }, noonVnMs, "18:00-20:00"),
        false,
        "F06: VN midnight ISO UTC (2026-11-21T17:00:00.000Z) với fallback 18:00-20:00 tại 12:30 phải trả về false!"
      );
      assert.strictEqual(
        hasLmsSlotTimePassed({ date: "2026-11-22", startTime: "2026-11-22T00:00:00+07:00" }, noonVnMs, "18:00-20:00"),
        false,
        "F06: VN midnight ISO +07:00 tại 12:30 phải trả về false!"
      );
      assert.strictEqual(
        hasLmsSlotTimePassed({ date: "2026-11-22", startTime: "2026-11-22T18:00:00" }, noonVnMs),
        false,
        "F06: Naive ISO 2026-11-22T18:00:00 không múi giờ tại 12:30 VN phải trả về false!"
      );
      assert.strictEqual(
        hasLmsSlotTimePassed({ date: "2026-11-22", startTime: "", endTime: "20:00" }, Date.parse("2026-11-22T19:00:00+07:00"), "18:00-20:00"),
        true,
        "F06: Empty startTime + endTime=20:00 + fallback 18:00-20:00 lúc 19:00 trong giờ phải trả về true!"
      );
      const startedEveningMs = Date.parse("2026-11-22T18:10:00+07:00");
      assert.strictEqual(
        hasLmsSlotTimePassed(slotEvening, startedEveningMs),
        true,
        "Lúc 18:10 tối, slot 18:00 đã bắt đầu nên phải tính là đã diễn ra."
      );

      // ISO timestamp with UTC offset
      const isoEvening = {
        date: "2026-11-22T11:00:00.000Z", // 18:00 +07:00
        startTime: "2026-11-22T11:00:00.000Z",
        endTime: "2026-11-22T13:00:00.000Z",
      };
      assert.strictEqual(hasLmsSlotTimePassed(isoEvening, noonVnMs), false);
      assert.strictEqual(hasLmsSlotTimePassed(isoEvening, startedEveningMs), true);

      // Bare date fallback -> end of VN day (23:59:59.999+07:00)
      const bareDate = { date: "2026-11-22" };
      assert.strictEqual(
        hasLmsSlotTimePassed(bareDate, Date.parse("2026-11-22T22:00:00+07:00")),
        false
      );
      assert.strictEqual(
        hasLmsSlotTimePassed(bareDate, Date.parse("2026-11-23T00:01:00+07:00")),
        true
      );
    }
    console.log("  -> PASS AC389-03.");

    // -----------------------------------------------------------------------
    // [AC389-01] isAdminUnstartedOrPendingClass Option B predicates
    // -----------------------------------------------------------------------
    console.log("\n[AC389-01] Kiểm tra bộ lọc Option B ẩn lớp PENDING / 0 buổi đã học...");
    {
      assert.strictEqual(
        isAdminUnstartedOrPendingClass({
          status: "PENDING",
          currentSessionNumber: 0,
        }),
        true
      );
      assert.strictEqual(
        isAdminUnstartedOrPendingClass({
          status: "RUNNING",
          currentSessionNumber: 0,
          hasSlots: true,
        }),
        true,
        "Lớp RUNNING nhưng 0 buổi đã học phải bị ẩn theo Option B"
      );
      assert.strictEqual(
        isAdminUnstartedOrPendingClass({
          status: "FINISHED",
          currentSessionNumber: 14,
          hasSlots: true,
        }),
        false,
        "Lớp FINISHED phải luôn giữ lại"
      );
      assert.strictEqual(
        isAdminUnstartedOrPendingClass({
          status: "RUNNING",
          currentSessionNumber: 13,
          hasSlots: true,
        }),
        false
      );
    }

    // -----------------------------------------------------------------------
    // Build comprehensive mock Campus 205ALHP datasets covering AC389-01..06
    // -----------------------------------------------------------------------
    function buildSlots(params: {
      total?: number;
      occurredCount: number;
      isRobotics?: boolean;
      slotTeachers?: Array<{ roleName: string; fullName: string; username: string }>;
      studentIds: Array<{ id: string; fullName: string }>;
      withS14DemoQuestions?: boolean;
      missingCp2Score?: boolean;
      useShortS14Comment?: boolean;
    }) {
      const total = params.total ?? 14;
      const slots: any[] = [];
      const basePastUtc = Date.now() - params.occurredCount * 7 * 86_400_000 - 3 * 86_400_000;
      for (let i = 0; i < total; i++) {
        const sn = i + 1;
        const occurred = sn <= params.occurredCount;
        const tsMs = occurred
          ? basePastUtc + i * 7 * 86_400_000
          : Date.now() + (sn - params.occurredCount) * 7 * 86_400_000;
        const dateIso = new Date(tsMs).toISOString();

        const teacherAttendance =
          occurred && params.slotTeachers
            ? params.slotTeachers.map((t) => ({
                status: "ATTENDED",
                teacher: { id: `t_${t.username}`, fullName: t.fullName, username: t.username },
              }))
            : [];
        const teachers =
          params.slotTeachers?.map((t) => ({
            isActive: true,
            role: { name: t.roleName, shortName: t.roleName },
            teacher: { id: `t_${t.username}`, fullName: t.fullName, username: t.username },
          })) || [];

        const studentAttendance = params.studentIds.map((stu, stuIdx) => {
          if (!occurred) {
            return {
              _id: `sa_${sn}_${stu.id}`,
              student: { id: stu.id, fullName: stu.fullName },
              status: "",
              comment: "",
              sendCommentStatus: "",
              commentByAreas: [],
            };
          }
          const isCp1 = !params.isRobotics && sn === 5;
          const isCp2 = !params.isRobotics && sn === 9;
          const isS14 = sn === 14;
          const missingCp2ForFirst = params.missingCp2Score && isCp2 && stuIdx === 0;
          const commentByAreas: any[] = [];
          if (isCp1) {
            commentByAreas.push(
              { type: "RATE", grade: 4 },
              {
                type: "CHECKPOINT",
                checkpoint: {
                  checkpointScore: 4,
                  practiceScore: 4,
                },
              }
            );
          }
          if (isCp2) {
            commentByAreas.push(
              { type: "RATE", grade: 4 },
              {
                type: "CHECKPOINT",
                checkpoint: {
                  checkpointScore: missingCp2ForFirst ? null : 4,
                  practiceScore: missingCp2ForFirst ? null : 4.5,
                },
              }
            );
          }
          if (isS14 && params.withS14DemoQuestions) {
            commentByAreas.push({
              type: "DEMO",
              grade: 0, // MindX LMS sometimes stores 0 on area grade while sum lives in demoQuestions!
              content: "",
              commentAreaId: params.isRobotics
                ? "66c810fc6ae1a9fab63875fd"
                : "665e88ae181e0e47f6c65642",
              courseProcessDemoId: "cp_demo_01",
              demoQuestions: [
                { courseProcessDemoDetailId: "d1", title: "Algo", score: 1.0, maxScore: 1.25 },
                { courseProcessDemoDetailId: "d2", title: "Crea", score: 0.75, maxScore: 0.75 },
                { courseProcessDemoDetailId: "d3", title: "Comm", score: 1.0, maxScore: 1.0 },
                { courseProcessDemoDetailId: "d4", title: "Comp", score: 0.5, maxScore: 0.5 },
                { courseProcessDemoDetailId: "d5", title: "Prob", score: 1.0, maxScore: 1.5 },
              ],
            });
          }

          return {
            _id: `sa_${sn}_${stu.id}`,
            student: { id: stu.id, fullName: stu.fullName },
            status: "ATTENDED",
            comment: isS14 && params.useShortS14Comment
              ? "Đã đánh giá xong"
              : "- **Điểm mạnh của học viên:** Học tập tốt.\n- **Điểm cần cải thiện:** Rèn luyện thêm.\n- **Lời khuyên:** Cố gắng phát huy.",
            sendCommentStatus: "SENT",
            commentByAreas,
          };
        });

        slots.push({
          _id: `slot_${sn}`,
          index: i,
          date: dateIso,
          startTime: "18:00",
          endTime: "20:00",
          summary: occurred ? `<p>Tổng kết buổi ${sn}</p>` : "",
          homework: occurred ? `<p>BTVN buổi ${sn}</p>` : "",
          teachers,
          teacherAttendance,
          studentAttendance,
        });
      }
      return slots;
    }

    const mockClasses = new Map<string, any>();

    // PENDING classes (Option B must hide!)
    for (const [id, code, course] of [
      ["lms_gi38", "VT-C4K-GI38", "C4K GI"],
      ["lms_preb20", "VT-ROB-PREB20", "RBT PREB"],
    ] as const) {
      mockClasses.set(id, {
        id,
        name: code,
        status: "PENDING",
        startDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        endDate: new Date(Date.now() + 100 * 86_400_000).toISOString(),
        centre: { id: "644346f794300678908f79bc", shortName: "205ALHP", code: "205ALHP" },
        course: { id: `c_${id}`, name: course },
        teachers: [],
        students: [{ activeInClass: true, student: { id: `${id}_s1`, fullName: "Nguyễn An" } }],
        slots: buildSlots({ occurredCount: 0, studentIds: [{ id: `${id}_s1`, fullName: "Nguyễn An" }] }),
      });
    }

    // RUNNING class at Session 13 whose upcoming weekend Teaching event is Buổi 14 (DEMO) -> MUST stay at Session 13 with NO Buổi 14 DEMO alert!
    mockClasses.set("lms_ga39", {
      id: "lms_ga39",
      name: "VT-C4K-GA39",
      status: "RUNNING",
      startDate: new Date(Date.now() - 90 * 86_400_000).toISOString(),
      endDate: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      centre: { id: "644346f794300678908f79bc", shortName: "205ALHP", code: "205ALHP" },
      course: { id: "c_ga", name: "Game Adventure" },
      teachers: [{ role: { name: "Teacher" }, teacher: { fullName: "GV Trang", username: "trangdtt1" } }],
      students: [{ activeInClass: true, student: { id: "ga39_s1", fullName: "Trần Bảo" } }],
      slots: buildSlots({
        occurredCount: 13,
        studentIds: [{ id: "ga39_s1", fullName: "Trần Bảo" }],
      }),
    });

    // RUNNING class at Session 8 whose upcoming weekend Teaching event is Buổi 9 (CP2) -> MUST stay at Session 8 with NO CP2 alert!
    mockClasses.set("lms_jsb17", {
      id: "lms_jsb17",
      name: "VT-JSB17",
      status: "RUNNING",
      startDate: new Date(Date.now() - 55 * 86_400_000).toISOString(),
      endDate: new Date(Date.now() + 45 * 86_400_000).toISOString(),
      centre: { id: "644346f794300678908f79bc", shortName: "205ALHP", code: "205ALHP" },
      course: { id: "c_jsb", name: "JS Basic" },
      teachers: [{ role: { name: "Teacher" }, teacher: { fullName: "GV Ngọc", username: "ngocttk" } }],
      students: [{ activeInClass: true, student: { id: "jsb17_s1", fullName: "Lê Minh" } }],
      slots: buildSlots({
        occurredCount: 8,
        studentIds: [{ id: "jsb17_s1", fullName: "Lê Minh" }],
      }),
    });

    // RUNNING class genuinely at Session 9 with 1 student missing CP2 score -> MUST keep Buổi 9 (CP2) alert, AND BTVN eligible must be sessions 1..8 only!
    mockClasses.set("lms_jsi12", {
      id: "lms_jsi12",
      name: "VT-JSI12-HB",
      status: "RUNNING",
      startDate: new Date(Date.now() - 65 * 86_400_000).toISOString(),
      endDate: new Date(Date.now() + 35 * 86_400_000).toISOString(),
      centre: { id: "644346f794300678908f79bc", shortName: "205ALHP", code: "205ALHP" },
      course: { id: "c_jsi", name: "JS Intensive" },
      teachers: [{ role: { name: "Teacher" }, teacher: { fullName: "GV Mơ", username: "monv1" } }],
      students: [
        { activeInClass: true, student: { id: "jsi_s1", fullName: "Cao Minh Trí" } },
        { activeInClass: true, student: { id: "jsi_s2", fullName: "Nguyễn Phong" } },
      ],
      slots: buildSlots({
        occurredCount: 9,
        studentIds: [
          { id: "jsi_s1", fullName: "Cao Minh Trí" },
          { id: "jsi_s2", fullName: "Nguyễn Phong" },
        ],
        missingCp2Score: true,
      }),
    });

    // FINISHED Robotics class with empty root `teachers: []`, teacher info in `slots[].teachers` / `teacherAttendance`,
    // Robotics `Demo2024 | ROB` demoQuestions (`4.25`), and 3-part MindX letter stored in `studentLetters`!
    mockClasses.set("lms_armb19", {
      id: "lms_armb19",
      name: "VT-ROB-ARMB19",
      status: "FINISHED",
      startDate: new Date(Date.now() - 120 * 86_400_000).toISOString(),
      endDate: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      centre: { id: "644346f794300678908f79bc", shortName: "205ALHP", code: "205ALHP" },
      course: { id: "c_armb", name: "Robotics ARM Basic" },
      teachers: [], // intentionally empty on FINISHED class!
      students: [{ activeInClass: true, student: { id: "rob_s1", fullName: "Phạm Tuấn Kiệt" } }],
      slots: buildSlots({
        occurredCount: 14,
        isRobotics: true,
        slotTeachers: [
          { roleName: "Teacher", fullName: "GV Dương", username: "duonglt1" },
          { roleName: "TA", fullName: "Trợ giảng An", username: "annt1" },
        ],
        studentIds: [{ id: "rob_s1", fullName: "Phạm Tuấn Kiệt" }],
        withS14DemoQuestions: true,
        useShortS14Comment: true,
      }),
    });

    // Pre-seed a stale row for VT-C4K-GI38 in SQLite so we verify Option B prunes it!
    adminCenterRepo.upsertClass({
      classCode: "VT-C4K-GI38",
      centerCode: "205ALHP",
      lmsClassId: "lms_gi38",
      courseName: "C4K GI",
      blockType: "CODING",
      isMakeupClass: 0,
      status: "PENDING",
      startDate: "",
      endDate: "",
      currentSessionNumber: 1,
      currentSessionDate: "",
      timeSlot: "",
      mainTeacher: "",
      assistantTeacher: "",
      specialEvent: "",
      activeStudentCount: 1,
      teachingStudentCount: 1,
      weeklyOpsJson: "{}",
      btvnSummaryJson: "{}",
      spckAuditJson: "{}",
      spckTasksJson: "{}",
      earlyWarningsJson: "[]",
      lmsReportCardSnapshotJson: "{}",
      btvnSyncStatus: "IDLE",
      btvnSyncedAt: null,
      btvnLastError: null,
      spckTasksSyncStatus: "IDLE",
      spckTasksSyncedAt: null,
      spckTasksLastError: null,
      lastScannedAt: null,
      lastError: null,
    });

    // DI Teaching mock pages returning upcoming weekend weekly items for GA39 (B14 DEMO), JSB17 (B9 CP2) & GI38 (KHAI_GIANG)
    const mockWeeklyIndexHtml = `
      <div class="regular-class" data-class-code="VT-C4K-GA39" data-instructor="trangdtt1" data-session-number="14" data-special-event="DEMO" data-time="16:00-18:00">VT-C4K-GA39 Buổi 14</div>
      <div class="regular-class" data-class-code="VT-JSB17" data-instructor="ngocttk" data-session-number="9" data-special-event="CP2" data-time="08:00-10:00">VT-JSB17 Buổi 9</div>
      <div class="regular-class" data-class-code="VT-C4K-GI38" data-instructor="GV An" data-session-number="1" data-special-event="KHAI_GIANG" data-time="18:00-20:00">VT-C4K-GI38 Buổi 1</div>
    `;
    const teachingDeps = {
      httpClient: {
        getHtmlPage: async (rel: string) => {
          if (rel.includes("index.php")) return mockWeeklyIndexHtml;
          if (rel.includes("check_nhanxet.php")) {
            return "<table><thead><tr><th>STT</th></tr></thead><tbody></tbody></table>";
          }
          if (rel.includes("hocbu.php")) {
            return "<table><thead><tr><th>STT</th></tr></thead><tbody></tbody></table>";
          }
          return "";
        },
      },
      reportCardTransport: {
        getStudents: async () => [],
        getExercises: async () => [],
        getScores: async () => [],
      },
      projectTransport: {
        getProject: async () => null,
        getTasks: async () => [],
        getTaskProgress: async () => ({}),
      },
    };

    // Mock MindX LMS GraphQL transport
    setLmsHttpTransportForTest(async ({ body }) => {
      const parsed = JSON.parse(String(body || "{}"));
      const op = String(parsed.operationName || "");
      const vars = parsed.variables || {};

      if (op === "LmsGetClasses" || op === "LmsGetClassesMinimal") {
        const statuses: string[] = vars?.payload?.status_in || [];
        const all = Array.from(mockClasses.values()).filter(
          (c) => statuses.length === 0 || statuses.includes(c.status)
        );
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(
            JSON.stringify({
              data: { classes: { data: all, pagination: { total: all.length } } },
            })
          ),
        };
      }

      if (op === "classesMissAttendOrComment" || op === "classesMissAttendOrCommentMinimal") {
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(JSON.stringify({ data: { classesMissAttendOrComment: { data: [] } } })),
        };
      }

      if (op === "GetClassById" || op === "GetClassByIdSafe" || op === "GetClassByIdMinimal") {
        const cls = mockClasses.get(String(vars.id || ""));
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(JSON.stringify({ data: { classesById: cls || null } })),
        };
      }

      if (op === "FindAllStudentWorks" || op === "AdminFindWorks" || op === "AdminFindWorksMinimal") {
        const cid = String(vars.classId || "");
        if (cid === "lms_armb19") {
          return {
            status: 200,
            headers: { "content-type": "application/json" },
            body: Buffer.from(
              JSON.stringify({
                data: {
                  findAllStudentWorks: {
                    data: [
                      {
                        id: "w_rob_14",
                        status: "SUBMITTED",
                        studentId: "rob_s1",
                        classSessionId: "slot_14",
                        classSessionNumber: 14,
                        classId: cid,
                        isDeleted: false,
                        latestData: {
                          title: "Robot Rescue",
                          comment: "Rất tốt",
                          thumbnail: "https://resources.mindx.edu.vn/t.png",
                          imageUrl: [],
                          attachmentUrls: ["https://resources.mindx.edu.vn/code.iqblocks"],
                          videoUrls: [],
                        },
                      },
                    ],
                  },
                },
              })
            ),
          };
        }
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(JSON.stringify({ data: { findAllStudentWorks: { data: [] } } })),
        };
      }

      if (op === "FindStudentSubmissionByClass") {
        const cid = String(vars?.payload?.classId || "");
        if (cid === "lms_jsi12") {
          // Lessons 1..8 done, Lesson 9 NOT submitted yet (because Session 9 is current session, only 1..8 count!)
          const lessons = Array.from({ length: 14 }, (_, idx) => ({
            id: `les_${idx + 1}`,
            name: `Session ${idx + 1} Homework`,
            type: "HOMEWORK",
            isActive: true,
            displayOrder: idx + 1,
          }));
          const submissions = Array.from({ length: 8 }, (_, idx) => ({
            id: `sub_${idx + 1}`,
            lessonId: `les_${idx + 1}`,
            studentUid: "jsi_s1",
            category: "PRACTICE",
            status: "MARKED",
            score: 100,
            submittedAt: new Date().toISOString(),
            content: { attachments: ["a.js"] },
          })).concat(
            Array.from({ length: 8 }, (_, idx) => ({
              id: `sub_s2_${idx + 1}`,
              lessonId: `les_${idx + 1}`,
              studentUid: "jsi_s2",
              category: "PRACTICE",
              status: "MARKED",
              score: 95,
              submittedAt: new Date().toISOString(),
              content: { attachments: ["b.js"] },
            }))
          );
          return {
            status: 200,
            headers: { "content-type": "application/json" },
            body: Buffer.from(
              JSON.stringify({
                data: {
                  findStudentSubmissionByClass: {
                    lessons,
                    students: [
                      { id: "jsi_s1", studentUid: "jsi_s1", displayName: "Cao Minh Trí", lessonIds: lessons.map((l) => l.id) },
                      { id: "jsi_s2", studentUid: "jsi_s2", displayName: "Nguyễn Phong", lessonIds: lessons.map((l) => l.id) },
                    ],
                    submissions,
                  },
                },
              })
            ),
          };
        }
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(
            JSON.stringify({
              data: { findStudentSubmissionByClass: { lessons: [], students: [], submissions: [] } },
            })
          ),
        };
      }

      if (op === "FindStudentLettersByClass") {
        const cid = String(vars.classId || "");
        if (cid === "lms_armb19") {
          return {
            status: 200,
            headers: { "content-type": "application/json" },
            body: Buffer.from(
              JSON.stringify({
                data: {
                  findStudentLettersPagination: {
                    data: [
                      {
                        id: "ltr_rob_1",
                        studentId: "rob_s1",
                        status: "APPROVED",
                        content:
                          "<p><strong>1. Learned From MindX:</strong> Học viên hoàn thành tốt sản phẩm Robotics và nắm chắc tư duy thuật toán.</p><p><strong>2. Suggestions From MindX:</strong> Cần cải thiện sự tự tin và tốc độ thuyết trình trước hội đồng.</p><p><strong>3. Future Direction:</strong> Định hướng tiếp tục theo học khóa Robotics ARM nâng cao tại MindX.</p>",
                        approvedContent: "",
                        macros: [
                          { key: "@learnedFromMindx", value: "Học viên hoàn thành tốt sản phẩm Robotics." },
                          { key: "@suggestionsFromMindx", value: "Cần cải thiện thuyết trình trước lớp." },
                          { key: "@futureDirection", value: "Tiếp tục khóa ARM nâng cao." },
                        ],
                      },
                    ],
                  },
                },
              })
            ),
          };
        }
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(
            JSON.stringify({ data: { findStudentLettersPagination: { data: [] } } })
          ),
        };
      }

      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({ data: {} })),
      };
    });

    // Run full scan using Node LMS API + DI teachingDeps
    console.log("\n[AC389-01/02/04/05/06] Chạy Scan toàn bộ lớp mô phỏng Campus 205ALHP...");
    const scanOut = await scanAdminCenterClasses({
      scope: "ALL",
      includeMakeup: true,
      teachingDeps: teachingDeps as any,
    });
    assert.strictEqual(scanOut.success, true);

    const overview = buildAdminOverviewResponse({ includeMakeup: true });
    const rowByCode = new Map(overview.classes.map((c: any) => [c.classCode, c]));

    // AC389-01: Pre-seeded PENDING row GI38 (even when present on Teaching index.php!) & PREB20 must NOT exist in SQLite or overview!
    assert.strictEqual(rowByCode.has("VT-C4K-GI38"), false, "VT-C4K-GI38 phải bị xóa khỏi Overview!");
    assert.strictEqual(rowByCode.has("VT-ROB-PREB20"), false, "VT-ROB-PREB20 phải bị ẩn khỏi Overview!");
    assert.strictEqual(
      adminCenterRepo.listClasses({ centerCode: "205ALHP", includeMakeup: true }).some((c) => c.classCode === "VT-C4K-GI38"),
      false,
      "Option B phải prune bản ghi PENDING VT-C4K-GI38 cũ trong SQLite!"
    );

    // AC389-02: Session 13 (GA39) & Session 8 (JSB17) must NOT advance or emit premature Buổi 14/9 alerts!
    const ga39 = rowByCode.get("VT-C4K-GA39")!;
    assert.ok(ga39, "VT-C4K-GA39 phải có mặt");
    assert.strictEqual(
      ga39.currentSessionNumber,
      13,
      `VT-C4K-GA39 phải giữ Buổi 13 (không bị Teaching Buổi 14 cuối tuần kéo lên 14), thực tế=${ga39.currentSessionNumber}`
    );
    assert.ok(
      ga39.weeklyOps?.checkpointAlert?.sessionNumber === 9 ||
        !ga39.weeklyOps?.checkpointAlert,
      `VT-C4K-GA39 ở Buổi 13 KHÔNG được hiện cảnh báo sớm Buổi 14 (DEMO), thực tế=${JSON.stringify(ga39.weeklyOps?.checkpointAlert)}`
    );
    assert.strictEqual(
      ga39.weeklyOps?.checkpointAlert,
      null,
      `VT-C4K-GA39 đã có đủ điểm CP2 thì không được có cảnh báo nào, thực tế=${JSON.stringify(ga39.weeklyOps?.checkpointAlert)}`
    );

    const jsb17 = rowByCode.get("VT-JSB17")!;
    assert.ok(jsb17, "VT-JSB17 phải có mặt");
    assert.strictEqual(jsb17.currentSessionNumber, 8, "VT-JSB17 phải giữ Buổi 8");
    assert.strictEqual(
      jsb17.weeklyOps?.checkpointAlert,
      null,
      `VT-JSB17 ở Buổi 8 KHÔNG được hiện cảnh báo sớm Buổi 9 (CP2), thực tế=${JSON.stringify(jsb17.weeklyOps?.checkpointAlert)}`
    );

    // AC389-02 + AC389-04: JSI12-HB genuinely at Session 9 MUST have CP2 alert AND BTVN capped at Session 8 (`<= currentSessionNumber - 1`)
    const jsi12 = rowByCode.get("VT-JSI12-HB")!;
    assert.ok(jsi12, "VT-JSI12-HB phải có mặt");
    assert.strictEqual(jsi12.currentSessionNumber, 9);
    assert.ok(
      jsi12.weeklyOps?.checkpointAlert?.sessionNumber === 9 &&
        String(jsi12.weeklyOps?.checkpointAlert?.message || "").includes("Buổi 9"),
      `VT-JSI12-HB thực sự ở Buổi 9 và thiếu điểm CP2 bắt buộc phải giữ cảnh báo Buổi 9 (CP2), thực tế=${JSON.stringify(jsi12.weeklyOps?.checkpointAlert)}`
    );
    assert.strictEqual(
      jsi12.btvnSummary?.latestHomeworkSessionNumber,
      8,
      `BTVN của lớp Buổi 9 chỉ được tính tới Buổi 8, thực tế=${jsi12.btvnSummary?.latestHomeworkSessionNumber}`
    );
    assert.strictEqual(
      jsi12.btvnSummary?.notSubmittedCellsCount,
      0,
      `Buổi 9 chưa hết hạn không được tính là Chưa nộp BTVN (notSubmittedCellsCount phải = 0), thực tế=${jsi12.btvnSummary?.notSubmittedCellsCount}`
    );

    // AC389-05 + AC389-06: FINISHED Robotics VT-ROB-ARMB19 recovers GV/TA, counts studentLetters, and scores Demo2024 | ROB
    const armb19 = rowByCode.get("VT-ROB-ARMB19")!;
    assert.ok(armb19, "VT-ROB-ARMB19 phải có mặt");
    assert.ok(
      /GV Dương|duonglt1/i.test(armb19.mainTeacher),
      `Lớp FINISHED phải khôi phục GV chính từ slots, thực tế='${armb19.mainTeacher}'`
    );
    assert.ok(
      /Trợ giảng An|annt1/i.test(armb19.assistantTeacher),
      `Lớp FINISHED phải khôi phục Trợ giảng từ slots, thực tế='${armb19.assistantTeacher}'`
    );
    assert.strictEqual(
      armb19.spckAudit?.session14FinalEval?.mindx3PartCommentCount,
      1,
      `Tab 3 phải đếm đúng thư 3 phần từ studentLetters (mong đợi 1, thực tế=${armb19.spckAudit?.session14FinalEval?.mindx3PartCommentCount})`
    );
    assert.strictEqual(
      armb19.spckAudit?.session14FinalEval?.demoScoredCount,
      1,
      `Tab 3 phải nhận diện điểm Demo Robotics từ demoQuestions (mong đợi 1, thực tế=${armb19.spckAudit?.session14FinalEval?.demoScoredCount})`
    );

    // F05 + F07 Regression checks via computeAdminClassAudits & Single-Class Scan
    const { computeAdminClassAudits } = adminScannerMod as any;
    const baseSlotsS1 = [
      {
        _id: "s1_slot",
        index: 0,
        date: "2026-11-20",
        startTime: "18:00",
        endTime: "20:00",
        summary: "Buổi 1",
        studentAttendance: [
          { _id: "sa1", status: "ATTENDED", comment: "Con tập trung tốt", student: { id: "u1", fullName: "Lê Minh An" } },
          { _id: "sa2", status: "ATTENDED", comment: "Con làm bài nhanh", student: { id: "u2", fullName: "Trần Gia Bảo" } },
        ],
      },
    ];
    const lessons9 = Array.from({ length: 9 }, (_, i) => ({
      id: `l_${i + 1}`,
      sessionNumber: i + 1,
      name: `Buổi ${i + 1}`,
      subjectId: "subj_jsa",
    }));
    const audS1 = computeAdminClassAudits({
      centerCode: "205ALHP",
      rawClassMeta: { classCode: "VT-JSA99", lmsClassId: "lms_jsa99", status: "RUNNING", courseName: "JSA" },
      classByIdData: {
        id: "lms_jsa99",
        name: "VT-JSA99",
        status: "RUNNING",
        teachers: [
          { isActive: false, role: { name: "Teacher" }, teacher: { fullName: "GV Cũ Đã Nghỉ" } },
          { isActive: true, role: { name: "Teaching Staff" }, teacher: { fullName: "GV Chính Thật" } },
        ],
        students: [
          { activeInClass: true, student: { id: "u1", fullName: "Lê Minh An" } },
          { activeInClass: true, student: { id: "u2", fullName: "Trần Gia Bảo" } },
        ],
        slots: baseSlotsS1,
      },
      submissionGqlData: {
        lessons: lessons9.slice(0, 1),
        students: [
          { id: "u1", studentUid: "u1", displayName: "Lê Minh An", lessonIds: ["l_1"] },
          { id: "u2", studentUid: "u2", displayName: "Trần Gia Bảo", lessonIds: ["l_1"] },
        ],
        submissions: [],
      },
      studentWorks: [],
    });
    assert.strictEqual(audS1.mainTeacher, "GV Chính Thật", "F07: Phải ưu tiên GV isActive !== false và không nhầm 'Teaching Staff' thành TA!");
    assert.strictEqual(audS1.assistantTeacher, "", "F07: Role 'Teaching Staff' không chứa chữ 'ta' đứng riêng -> không gán nhầm làm TA!");
    const btvnS1 = JSON.parse(audS1.btvnSummaryJson);
    assert.strictEqual(btvnS1.latestHomeworkSessionNumber, 0, "F05: Lớp Buổi 1 (chưa có buổi đến hạn) latestHomeworkSessionNumber phải = 0!");
    assert.strictEqual(btvnS1.lowSubmissionWarning, false, "F05: Lớp Buổi 1 không được bật lowSubmissionWarning!");

    const earlySubmissions = [];
    for (let sIdx = 0; sIdx < 8; sIdx++) {
      earlySubmissions.push(
        { id: `e1_${sIdx}`, lessonId: `l_${sIdx + 1}`, studentUid: "u1", category: "PRACTICE", status: "MARKED", score: 100 },
        { id: `e2_${sIdx}`, lessonId: `l_${sIdx + 1}`, studentUid: "u2", category: "PRACTICE", status: "MARKED", score: 100 }
      );
    }
    earlySubmissions.push({ id: "e_early_9", lessonId: "l_9", studentUid: "u1", category: "PRACTICE", status: "SUBMITTED" });
    const audS9Early = computeAdminClassAudits({
      centerCode: "205ALHP",
      rawClassMeta: { classCode: "VT-JSA98", lmsClassId: "lms_jsa98", status: "RUNNING", courseName: "JSA" },
      classByIdData: {
        id: "lms_jsa98",
        name: "VT-JSA98",
        status: "RUNNING",
        students: [
          { activeInClass: true, student: { id: "u1", fullName: "Lê Minh An" } },
          { activeInClass: true, student: { id: "u2", fullName: "Trần Gia Bảo" } },
        ],
        slots: Array.from({ length: 9 }, (_, i) => ({
          _id: `s9_${i + 1}`,
          index: i,
          date: "2026-11-10",
          startTime: "18:00",
          summary: `B${i + 1}`,
          studentAttendance: [{ _id: `sa_${i}`, status: "ATTENDED", comment: "Tốt", student: { id: "u1", fullName: "Lê Minh An" } }],
        })),
      },
      submissionGqlData: {
        lessons: lessons9,
        students: [
          { id: "u1", studentUid: "u1", displayName: "Lê Minh An", lessonIds: lessons9.map((l) => l.id) },
          { id: "u2", studentUid: "u2", displayName: "Trần Gia Bảo", lessonIds: lessons9.map((l) => l.id) },
        ],
        submissions: earlySubmissions,
      },
      studentWorks: [],
    });
    const btvnS9Early = JSON.parse(audS9Early.btvnSummaryJson);
    assert.strictEqual(btvnS9Early.latestHomeworkSessionNumber, 8, "F05: Học sinh nộp sớm BTVN Buổi 9 không được làm nhảy latestHomeworkSessionNumber lên 9!");
    assert.strictEqual(btvnS9Early.lowSubmissionWarning, false, "F05: Lớp 100% BTVN 1..8 không được báo lowSubmissionWarning!");

    // Single-Class Scan pruning check (F07): seed PENDING GI38 then single-scan it -> must delete it from DB
    adminCenterRepo.upsertClass({
      classCode: "VT-C4K-GI38",
      centerCode: "205ALHP",
      lmsClassId: "lms_gi38",
      courseName: "C4K GI",
      blockType: "CODING",
      isMakeupClass: 0,
      status: "RUNNING",
      startDate: "",
      endDate: "",
      currentSessionNumber: 1,
      currentSessionDate: "",
      timeSlot: "",
      mainTeacher: "Cũ",
      assistantTeacher: "",
      specialEvent: "",
      activeStudentCount: 1,
      teachingStudentCount: 1,
      weeklyOpsJson: "{}",
      btvnSummaryJson: "{}",
      spckAuditJson: "{}",
      spckTasksJson: "{}",
      earlyWarningsJson: "[]",
      lmsReportCardSnapshotJson: "{}",
      btvnSyncStatus: "IDLE",
      btvnSyncedAt: null,
      btvnLastError: null,
      spckTasksSyncStatus: "IDLE",
      spckTasksSyncedAt: null,
      spckTasksLastError: null,
      lastScannedAt: "2026-11-22T00:00:00.000Z",
      lastError: null,
    });
    await scanAdminCenterClasses({
      scope: "SINGLE_CLASS",
      classCode: "VT-C4K-GI38",
      includeMakeup: true,
      teachingDeps: teachingDeps as any,
    });
    assert.strictEqual(
      Boolean(adminCenterRepo.findClass("VT-C4K-GI38")),
      false,
      "F07: Quét đơn lẻ lớp PENDING VT-C4K-GI38 cũng phải tự xóa bản ghi PENDING cũ khỏi SQLite!"
    );

    console.log("  -> PASS ALL ADMIN CENTER v3.8.9 CHECKS [AC389-01..06]!");
  } finally {
    setLmsHttpTransportForTest(null);
    try {
      sqliteMod.getDb?.().close?.();
    } catch {}
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {}
  }
}

main().catch((err) => {
  console.error("TEST ADMIN CENTER V3.8.9 FAILED:", err);
  process.exit(1);
});
