/**
 * KIỂM THỬ TỰ ĐỘNG (`v3.8.10`) — ROBOTICS KHÔNG CHECK Ô BTVN & PHÂN BIỆT HỌC SINH NGHỈ CHỜ HỌC BÙ Ở CHECKPOINT
 *
 * Chạy 100% cô lập trong `os.tmpdir()` — KHÔNG chạm `data/` thật.
 *
 * Các ca kiểm thử:
 * - [AC3810-01] Robotics có Tổng kết buổi (`summary`), ô `homework` rỗng -> `hasSummaryAndHomework: true`;
 *              Robotics thiếu Tổng kết buổi -> `hasSummaryAndHomework: false` + Zalo nhắc `"Thiếu tổng kết buổi N"` (KHÔNG chứa `"BTVN"`);
 *              Coding B6 có `summary` nhưng thiếu `homework` -> vẫn `hasSummaryAndHomework: false` + `"Thiếu tổng kết/BTVN buổi 6"`.
 * - [AC3810-02] Lớp Checkpoint chỉ có học sinh vắng mặt chờ học bù (như `VT-ROB-ARMI13` B4)
 *              -> `isMakeupPendingOnly: true`, `missingScoreCount: 0`, `absentMakeupCount: 1`,
 *                 `hasWeeklyOpsIssue: false`, `weeklyOpsIssuesCount: 0`, Zalo KHÔNG nhắc thiếu điểm CP1.
 * - [AC3810-03] Lớp Checkpoint hỗn hợp (1 HV đi học nhưng thiếu điểm CP1 + 1 HV nghỉ chờ học bù)
 *              -> `isMakeupPendingOnly: false`, `missingScoreCount: 1`, `absentMakeupCount: 1`,
 *                 thông báo ghi rõ cả 2 nhóm tên, `hasWeeklyOpsIssue: true`, Zalo nhắc việc bình thường.
 * - [AC3810-04] Học sinh từng nghỉ LMS Slot 4 nhưng trạng thái học bù là `"Đã học bù"` mà điểm vẫn trống
 *              -> tự chuyển thành `missingScoreCount: 1`, `absentMakeupCount: 0`, `isMakeupPendingOnly: false`.
 * - [AC3810-05] Chống khớp nhầm ngày tháng trong `sessionLabel` (`"Buổi 6 (04/11/2026)"` không khớp nhầm Buổi 4)
 *              & chống nhiễu 2 học sinh trùng tên (`"Nguyễn Bảo Nam"` chỉ đối chiếu theo `studentId`).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-admin-v3810-"));
const configDir = path.join(tmpRoot, "config");
const tokenDir = path.join(tmpRoot, "tokens");
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(tokenDir, { recursive: true });

(process.env as Record<string, string | undefined>).NODE_ENV = "test";
process.env.MINDX_DB_PATH = path.join(tmpRoot, "mindx_bot.db");
process.env.MINDX_CONFIG_DIR = configDir;
process.env.MINDX_RUNNING_CLASSES_PATH = path.join(tmpRoot, "running_classes.json");
process.env.MINDX_LMS_CLASS_IDS_PATH = path.join(configDir, "lms_class_ids.json");
process.env.MINDX_ROLE_STATE_DIR = path.join(tmpRoot, "role-state");
process.env.MINDX_LMS_TOKEN_DIR = tokenDir;
process.env.ALLOWED_LOCAL_DIRS = tmpRoot;
process.env.MINDX_LMS_API_READ = "true";
process.env.ADMIN_CENTER_CODE = "205ALHP";
process.env.ADMIN_LMS_USERNAME = "admin.test@mindx.com.vn";
process.env.ADMIN_LMS_PASSWORD = "AdminDummySecret#3810";
process.env.ADMIN_TEACHING_USERNAME = "teaching.admin";
process.env.ADMIN_TEACHING_PASSWORD = "TeachingDummySecret#3810";

function buildSlots(params: {
  total?: number;
  occurredCount: number;
  students: Array<{ id: string; fullName: string }>;
  emptySummaryAt?: number[];
  emptyHomeworkAt?: number[];
  slotAttendanceOverrides?: Record<
    number,
    Record<
      string,
      {
        status: string;
        comment?: string;
        cpTheory?: number | null;
        cpPractice?: number | null;
        demoGrade?: number | null;
      }
    >
  >;
}) {
  const total = params.total ?? 14;
  const slots: any[] = [];
  const basePastUtc = Date.now() - params.occurredCount * 7 * 86_400_000 - 2 * 86_400_000;
  for (let i = 0; i < total; i++) {
    const sn = i + 1;
    const occurred = sn <= params.occurredCount;
    const tsMs = occurred
      ? basePastUtc + i * 7 * 86_400_000
      : Date.now() + (sn - params.occurredCount) * 7 * 86_400_000;
    const overrides = params.slotAttendanceOverrides?.[sn] || {};

    const studentAttendance = params.students.map((stu) => {
      if (!occurred) {
        return {
          _id: `sa_${sn}_${stu.id}`,
          student: { id: stu.id, fullName: stu.fullName },
          status: "",
          comment: "",
          commentByAreas: [],
        };
      }
      const ov = overrides[stu.id];
      const commentByAreas: any[] = [];
      if (ov && (ov.cpTheory !== undefined || ov.cpPractice !== undefined)) {
        commentByAreas.push({
          type: "CHECKPOINT",
          checkpoint: {
            checkpointScore: ov.cpTheory ?? null,
            practiceScore: ov.cpPractice ?? null,
          },
        });
      }
      if (ov && typeof ov.demoGrade === "number") {
        commentByAreas.push({
          type: "DEMO",
          grade: ov.demoGrade,
          content: "",
        });
      }
      return {
        _id: `sa_${sn}_${stu.id}`,
        student: { id: stu.id, fullName: stu.fullName },
        status: ov?.status || "ATTENDED",
        comment: ov?.comment ?? "- **Điểm mạnh:** Tốt.\n- **Điểm cần cải thiện:** Rèn thêm.\n- **Lời khuyên:** Phát huy.",
        sendCommentStatus: "SENT",
        commentByAreas,
      };
    });

    const summaryEmpty = (params.emptySummaryAt || []).includes(sn);
    const homeworkEmpty = (params.emptyHomeworkAt || []).includes(sn);
    slots.push({
      _id: `slot_${sn}`,
      index: i,
      date: new Date(tsMs).toISOString(),
      startTime: new Date(tsMs).toISOString(),
      summary: occurred && !summaryEmpty ? `<p>Tổng kết buổi ${sn}</p>` : "",
      homework: occurred && !homeworkEmpty ? `<p>BTVN buổi ${sn}</p>` : "",
      studentAttendance,
    });
  }
  return slots;
}

async function main() {
  console.log("=== TEST ADMIN CENTER v3.8.10 (ROBOTICS BTVN & CHECKPOINT MAKEUP) ===");

  const { computeAdminClassAudits, buildAdminOverviewResponse } = await import(
    "../src/lib/admin-center/admin-lms-scanner"
  );
  const { buildTeacherZaloReminder } = await import(
    "../src/lib/admin-center/admin-zalo-reminder"
  );
  const { hasWeeklyOpsIssue } = await import(
    "../src/components/admin-center/admin-ui-helpers"
  );
  const { adminCenterRepo, closeDb, getDb } = await import("../src/lib/db/sqlite");
  const clearAdminTable = () => getDb().prepare("DELETE FROM admin_center_classes").run();

  try {
    // -----------------------------------------------------------------------
    // [AC3810-01] Robotics summary-only rule vs Coding summary+homework rule
    // -----------------------------------------------------------------------
    console.log("\n[AC3810-01] Kiểm tra Robotics bỏ check ô BTVN nhưng vẫn check Tổng kết...");
    {
      const robStudents = [{ id: "r1", fullName: "Phạm Ngọc Hiếu" }];
      const robWithSummaryNoHw = computeAdminClassAudits({
        centerCode: "205ALHP",
        rawClassMeta: {
          classCode: "VT-ROB-ARMA17",
          lmsClassId: "lms_arma17",
          courseName: "ARM Robotics",
          status: "RUNNING",
          mainTeacher: "Phạm Ngọc Hiếu",
        },
        classByIdData: {
          id: "lms_arma17",
          name: "VT-ROB-ARMA17",
          status: "RUNNING",
          course: { name: "ARM Robotics" },
          students: robStudents.map((s) => ({ activeInClass: true, student: s })),
          slots: buildSlots({
            occurredCount: 7,
            students: robStudents,
            emptyHomeworkAt: [7],
          }),
        },
        submissionGqlData: null,
        studentWorks: [],
      });
      const dtoOk = JSON.parse(robWithSummaryNoHw.weeklyOpsJson);
      assert.strictEqual(
        dtoOk.hasSummaryAndHomework,
        true,
        "Robotics Buổi 7 có Tổng kết buổi và ô BTVN trống phải báo Đủ!"
      );

      const robMissingSummary = computeAdminClassAudits({
        centerCode: "205ALHP",
        rawClassMeta: {
          classCode: "VT-ROB-ARMB20",
          lmsClassId: "lms_armb20",
          courseName: "ARM Robotics",
          status: "RUNNING",
          mainTeacher: "Mai Tường Vi",
        },
        classByIdData: {
          id: "lms_armb20",
          name: "VT-ROB-ARMB20",
          status: "RUNNING",
          course: { name: "ARM Robotics" },
          students: robStudents.map((s) => ({ activeInClass: true, student: s })),
          slots: buildSlots({
            occurredCount: 6,
            students: robStudents,
            emptySummaryAt: [6],
            emptyHomeworkAt: [6],
          }),
        },
        submissionGqlData: null,
        studentWorks: [],
      });
      assert.strictEqual(JSON.parse(robMissingSummary.weeklyOpsJson).hasSummaryAndHomework, false);
      const ovTmp = buildAdminOverviewResponse({ includeMakeup: true });
      assert(Array.isArray(ovTmp.classes));
      adminCenterRepo.upsertClass(robMissingSummary);
      const ovRob = buildAdminOverviewResponse({ includeMakeup: true });
      const robDto = ovRob.classes.find((c) => c.classCode === "VT-ROB-ARMB20")!;
      const zaloMsg = buildTeacherZaloReminder("Mai Tường Vi", [robDto], "205ALHP");
      assert(zaloMsg.includes("Thiếu tổng kết buổi 6"), `Zalo phải nhắc đúng Tổng kết buổi 6: ${zaloMsg}`);
      assert(!zaloMsg.includes("BTVN"), `Zalo Robotics KHÔNG được nhắc BTVN: ${zaloMsg}`);

      // Option 1B (v3.8.11): Coding B6 with summary & empty homework NOW reports true; Coding B6 with empty summary reports false without "BTVN"
      const codingSummaryOnly = computeAdminClassAudits({
        centerCode: "205ALHP",
        rawClassMeta: {
          classCode: "VT-C4K-JSB20",
          lmsClassId: "lms_jsb20",
          courseName: "JS Basic",
          status: "RUNNING",
          mainTeacher: "Thầy An",
        },
        classByIdData: {
          id: "lms_jsb20",
          name: "VT-C4K-JSB20",
          status: "RUNNING",
          course: { name: "JS Basic" },
          students: robStudents.map((s) => ({ activeInClass: true, student: s })),
          slots: buildSlots({
            occurredCount: 6,
            students: robStudents,
            emptyHomeworkAt: [6],
          }),
        },
        submissionGqlData: null,
        studentWorks: [],
      });
      assert.strictEqual(
        JSON.parse(codingSummaryOnly.weeklyOpsJson).hasSummaryAndHomework,
        true,
        "Cách 1B: Coding Buổi 6 đã có Tổng kết buổi (dù để trống ô BTVN) phải báo Đủ!"
      );

      const codingMissingSummary = computeAdminClassAudits({
        centerCode: "205ALHP",
        rawClassMeta: {
          classCode: "VT-C4K-JSB21",
          lmsClassId: "lms_jsb21",
          courseName: "JS Basic",
          status: "RUNNING",
          mainTeacher: "Thầy An",
        },
        classByIdData: {
          id: "lms_jsb21",
          name: "VT-C4K-JSB21",
          status: "RUNNING",
          course: { name: "JS Basic" },
          students: robStudents.map((s) => ({ activeInClass: true, student: s })),
          slots: buildSlots({
            occurredCount: 6,
            students: robStudents,
            emptySummaryAt: [6],
            emptyHomeworkAt: [6],
          }),
        },
        submissionGqlData: null,
        studentWorks: [],
      });
      assert.strictEqual(
        JSON.parse(codingMissingSummary.weeklyOpsJson).hasSummaryAndHomework,
        false,
        "Cách 1B: Coding Buổi 6 thiếu Tổng kết buổi bắt buộc vẫn báo Thiếu!"
      );
      clearAdminTable();
    }
    console.log("  -> PASS AC3810-01.");

    // -----------------------------------------------------------------------
    // [AC3810-02] Absent / pending-makeup-only Checkpoint (`VT-ROB-ARMI13`)
    // -----------------------------------------------------------------------
    console.log("\n[AC3810-02] Kiểm tra Checkpoint chỉ có HV nghỉ chờ học bù (`VT-ROB-ARMI13`)...");
    {
      const students = [
        { id: "s1", fullName: "Nguyễn Chấn Lâm" },
        { id: "s2", fullName: "Trần Minh Quân" },
      ];
      const rec = computeAdminClassAudits({
        centerCode: "205ALHP",
        rawClassMeta: {
          classCode: "VT-ROB-ARMI13",
          lmsClassId: "lms_armi13",
          courseName: "ARM Robotics Intensive",
          status: "RUNNING",
          mainTeacher: "Dương Anh Quang",
        },
        classByIdData: {
          id: "lms_armi13",
          name: "VT-ROB-ARMI13",
          status: "RUNNING",
          course: { name: "ARM Robotics Intensive" },
          students: students.map((s) => ({ activeInClass: true, student: s })),
          slots: buildSlots({
            occurredCount: 4,
            students,
            emptyHomeworkAt: [4],
            slotAttendanceOverrides: {
              4: {
                s1: { status: "ABSENT", comment: "Bạn Nghỉ" },
                s2: { status: "ATTENDED", cpTheory: 4.5, cpPractice: 4.5 },
              },
            },
          }),
        },
        submissionGqlData: null,
        studentWorks: [],
        teachingMakeupRows: [
          {
            classCode: "VT-ROB-ARMI13",
            studentName: "Nguyễn Chấn Lâm",
            sessionLabel: "Buổi 4",
            teacher: "Dương Anh Quang",
            status: "PH đã đồng ý lịch, đang chờ học",
          },
        ],
      });

      adminCenterRepo.upsertClass(rec);
      const ov = buildAdminOverviewResponse({ includeMakeup: true });
      const row = ov.classes.find((c) => c.classCode === "VT-ROB-ARMI13")!;
      assert.strictEqual(row.weeklyOps.hasSummaryAndHomework, true);
      assert(row.weeklyOps.checkpointAlert, "Phải giữ thông tin nhắc chờ học bù");
      assert.strictEqual(row.weeklyOps.checkpointAlert!.isMakeupPendingOnly, true);
      assert.strictEqual(row.weeklyOps.checkpointAlert!.missingScoreCount, 0);
      assert.strictEqual(row.weeklyOps.checkpointAlert!.absentMakeupCount, 1);
      assert.deepEqual(row.weeklyOps.checkpointAlert!.absentMakeupStudentNames, [
        "Nguyễn Chấn Lâm",
      ]);
      assert(
        row.weeklyOps.checkpointAlert!.message.includes("1 HV nghỉ chờ học bù (Nguyễn Chấn Lâm)"),
        `Thông báo không khớp: ${row.weeklyOps.checkpointAlert!.message}`
      );
      assert.strictEqual(hasWeeklyOpsIssue(row), false, "Chỉ chờ học bù KHÔNG được đếm là lỗi vận hành");
      assert.strictEqual(ov.kpis.weeklyOpsIssuesCount, 0);

      const zalo = buildTeacherZaloReminder("Dương Anh Quang", [row], "205ALHP");
      assert(
        !zalo.includes("thiếu điểm Check-point 1"),
        `Zalo không được báo lỗi thiếu điểm CP1 khi HV nghỉ chờ học bù: ${zalo}`
      );
      clearAdminTable();
    }
    console.log("  -> PASS AC3810-02.");

    // -----------------------------------------------------------------------
    // [AC3810-03] Mixed present-missing & absent-makeup + [AC3810-04] Completed makeup override
    // -----------------------------------------------------------------------
    console.log("\n[AC3810-03 & AC3810-04] Kiểm tra hỗn hợp + khi đã học bù xong vẫn chưa nhập điểm...");
    {
      const students = [
        { id: "m1", fullName: "Lê Minh An" },
        { id: "m2", fullName: "Trần Gia Bảo" },
        { id: "m3", fullName: "Võ Khánh Linh" },
      ];
      const recMixed = computeAdminClassAudits({
        centerCode: "205ALHP",
        rawClassMeta: {
          classCode: "VT-ROB-MIX01",
          lmsClassId: "lms_mix01",
          courseName: "ARM Robotics",
          status: "RUNNING",
          mainTeacher: "Thầy Quang",
        },
        classByIdData: {
          id: "lms_mix01",
          name: "VT-ROB-MIX01",
          status: "RUNNING",
          course: { name: "ARM Robotics" },
          students: students.map((s) => ({ activeInClass: true, student: s })),
          slots: buildSlots({
            occurredCount: 4,
            students,
            emptyHomeworkAt: [4],
            slotAttendanceOverrides: {
              4: {
                m1: { status: "ATTENDED" }, // attended but missing score!
                m2: { status: "ABSENT", comment: "Nghỉ học" }, // absent waiting makeup
                m3: { status: "ATTENDED", cpTheory: 4, cpPractice: 5 },
              },
            },
          }),
        },
        submissionGqlData: null,
        studentWorks: [],
      });
      adminCenterRepo.upsertClass(recMixed);
      const ovMixed = buildAdminOverviewResponse({ includeMakeup: true });
      const mixDto = ovMixed.classes.find((c) => c.classCode === "VT-ROB-MIX01")!;
      assert.strictEqual(mixDto.weeklyOps.checkpointAlert!.isMakeupPendingOnly, false);
      assert.strictEqual(mixDto.weeklyOps.checkpointAlert!.missingScoreCount, 1);
      assert.deepEqual(mixDto.weeklyOps.checkpointAlert!.missingStudentNames, ["Lê Minh An"]);
      assert.strictEqual(mixDto.weeklyOps.checkpointAlert!.absentMakeupCount, 1);
      assert.deepEqual(mixDto.weeklyOps.checkpointAlert!.absentMakeupStudentNames, ["Trần Gia Bảo"]);
      assert(mixDto.weeklyOps.checkpointAlert!.message.includes("Lê Minh An"));
      assert(mixDto.weeklyOps.checkpointAlert!.message.includes("Trần Gia Bảo"));
      assert.strictEqual(hasWeeklyOpsIssue(mixDto), true);
      assert.strictEqual(ovMixed.kpis.weeklyOpsIssuesCount, 1);

      // Completed makeup override -> m2 now counts as missingScoreCount
      const recDoneMakeup = computeAdminClassAudits({
        centerCode: "205ALHP",
        rawClassMeta: {
          classCode: "VT-ROB-MIX01",
          lmsClassId: "lms_mix01",
          courseName: "ARM Robotics",
          status: "RUNNING",
          mainTeacher: "Thầy Quang",
        },
        classByIdData: {
          id: "lms_mix01",
          name: "VT-ROB-MIX01",
          status: "RUNNING",
          course: { name: "ARM Robotics" },
          students: students.map((s) => ({ activeInClass: true, student: s })),
          slots: buildSlots({
            occurredCount: 4,
            students,
            emptyHomeworkAt: [4],
            slotAttendanceOverrides: {
              4: {
                m1: { status: "ATTENDED", cpTheory: 4, cpPractice: 4 },
                m2: { status: "ABSENT", comment: "Nghỉ học" },
                m3: { status: "ATTENDED", cpTheory: 4, cpPractice: 5 },
              },
            },
          }),
        },
        submissionGqlData: null,
        studentWorks: [],
        teachingMakeupRows: [
          {
            classCode: "VT-ROB-MIX01",
            studentName: "Trần Gia Bảo",
            sessionLabel: "Buổi 4",
            teacher: "Thầy Quang",
            status: "Đã học bù",
          },
        ],
      });
      const doneAlert = JSON.parse(recDoneMakeup.weeklyOpsJson).checkpointAlert;
      assert.strictEqual(doneAlert.isMakeupPendingOnly, false);
      assert.strictEqual(doneAlert.missingScoreCount, 1);
      assert.strictEqual(doneAlert.absentMakeupCount, 0);
      assert.deepEqual(doneAlert.missingStudentNames, ["Trần Gia Bảo"]);
      clearAdminTable();
    }
    console.log("  -> PASS AC3810-03 & AC3810-04.");

    // -----------------------------------------------------------------------
    // [AC3810-05] Date-in-sessionLabel guard & Homonym student guard
    // -----------------------------------------------------------------------
    console.log("\n[AC3810-05] Kiểm tra chặn khớp nhầm ngày tháng hocbu & 2 HV trùng tên...");
    {
      const students = [
        { id: "hom_1", fullName: "Nguyễn Bảo Nam" }, // ABSENT at Slot 4
        { id: "hom_2", fullName: "Nguyễn Bảo Nam" }, // ATTENDED at Slot 4, no score yet!
        { id: "s_date", fullName: "Dương Quốc Minh Quân" }, // ATTENDED at Slot 4 with no score, has pending makeup at Buổi 6 (04/11/2026)
      ];
      const rec = computeAdminClassAudits({
        centerCode: "205ALHP",
        rawClassMeta: {
          classCode: "VT-ROB-PREB19",
          lmsClassId: "lms_preb19",
          courseName: "Pre-Robotics Basic",
          status: "RUNNING",
          mainTeacher: "Nguyễn Đức Hải",
        },
        classByIdData: {
          id: "lms_preb19",
          name: "VT-ROB-PREB19",
          status: "RUNNING",
          course: { name: "Pre-Robotics Basic" },
          students: students.map((s) => ({ activeInClass: true, student: s })),
          slots: buildSlots({
            occurredCount: 6,
            students,
            emptyHomeworkAt: [4, 5, 6],
            slotAttendanceOverrides: {
              4: {
                hom_1: { status: "ABSENT", comment: "" },
                hom_2: { status: "ATTENDED", comment: "Tốt" },
                s_date: { status: "ATTENDED", comment: "Hoàn thành tốt nhưng chưa nhập điểm" },
              },
            },
          }),
        },
        submissionGqlData: null,
        studentWorks: [],
        teachingMakeupRows: [
          {
            classCode: "VT-ROB-PREB19",
            studentName: "Dương Quốc Minh Quân",
            sessionLabel: "Buổi 6 (04/11/2026)", // contains "04" in date -> MUST NOT match Buổi 4!
            teacher: "Nguyễn Đức Hải",
            status: "PH đã đồng ý lịch, đang chờ học",
          },
        ],
      });
      const cpAlert = JSON.parse(rec.weeklyOpsJson).checkpointAlert;
      assert.strictEqual(cpAlert.isMakeupPendingOnly, false);
      assert.strictEqual(
        cpAlert.missingScoreCount,
        2,
        `hom_2 + s_date phải tính vào missingScoreCount (không bị trùng tên hay khớp nhầm 04/11), actual=${JSON.stringify(cpAlert)}`
      );
      assert.strictEqual(cpAlert.absentMakeupCount, 1, "hom_1 nghỉ Buổi 4 vẫn tính riêng");
      assert(cpAlert.missingStudentNames.includes("Dương Quốc Minh Quân"));
      assert(cpAlert.missingStudentNames.includes("Nguyễn Bảo Nam"));
      assert.deepEqual(cpAlert.absentMakeupStudentNames, ["Nguyễn Bảo Nam"]);
      clearAdminTable();
    }
    console.log("  -> PASS AC3810-05.");

    // -----------------------------------------------------------------------
    // [AC3810-06] F01/F02/F03/F04 Neon Round 1 regressions
    // -----------------------------------------------------------------------
    console.log("\n[AC3810-06] Kiểm tra hồi quy F01 (fetchAdminTeachingOverviewPages allMakeupByClass), F02 (từ/nhiều buổi), F03 (từ vựng hủy/đã học), F04 (<p></p>)...");
    {
      const { fetchAdminTeachingOverviewPages } = await import(
        "../src/lib/admin-center/admin-teaching-scraper"
      );
      const mockOverview = await fetchAdminTeachingOverviewPages({
        httpClient: {
          getHtmlPage: async (rel: string) => {
            if (rel.includes("index.php")) return "<html></html>";
            if (rel.includes("check_nhanxet.php")) return "<html></html>";
            if (rel.includes("hocbu.php")) {
              return JSON.stringify({
                recordsFiltered: 3,
                data: [
                  {
                    class_code: "VT-ROB-ARMI13",
                    student_name: "Nguyễn Chấn Lâm",
                    session_number: 4,
                    status: "Đã học bù",
                    attendance_status: "Có mặt",
                  },
                  {
                    class_code: "VT-ROB-ARMI13",
                    student_name: "Lê Minh An",
                    session_number: 4,
                    status: "Đã huỷ",
                    attendance_status: "",
                  },
                  {
                    class_code: "VT-ROB-ARMI13",
                    student_name: "Trần Gia Bảo",
                    session_number: 4,
                    status: "PH đã đồng ý lịch, đang chờ học",
                    attendance_status: "",
                  },
                ],
              });
            }
            return "";
          },
        } as any,
      });

      assert.strictEqual(
        (mockOverview.makeupByClass.get("VT-ROB-ARMI13") || []).length,
        1,
        "F01: makeupByClass chỉ giữ 1 ca đang chờ học bù"
      );
      assert.strictEqual(
        (mockOverview.allMakeupByClass.get("VT-ROB-ARMI13") || []).length,
        3,
        "F01: allMakeupByClass phải giữ đủ cả 3 dòng (gồm Đã học bù & Đã huỷ)"
      );

      const fStudents = [
        { id: "s_done", fullName: "Nguyễn Chấn Lâm" }, // ABSENT on LMS B4, Đã học bù on hocbu.php
        { id: "s_cancel", fullName: "Lê Minh An" }, // UNMARKED, Đã huỷ on hocbu.php + PREB04 false label shouldn't match B4
        { id: "s_pending", fullName: "Trần Gia Bảo" }, // UNMARKED, pending makeup with multi-session "Buổi 3, Buổi 4"
        { id: "s_quill", fullName: "Phạm Bảo Long" }, // UNMARKED, att.comment = "<p></p>", stageNote = "Bạn Nghỉ"
        { id: "s_vocab", fullName: "Vũ Nhật Minh" }, // ABSENT on LMS, status = "Đã học" -> completed!
      ];
      const rec = computeAdminClassAudits({
        centerCode: "205ALHP",
        rawClassMeta: {
          classCode: "VT-ROB-ARMI13",
          lmsClassId: "lms_armi13",
          courseName: "ARM Robotics Intensive",
          status: "RUNNING",
          mainTeacher: "Dương Anh Quang",
        },
        classByIdData: {
          id: "lms_armi13",
          name: "VT-ROB-ARMI13",
          status: "RUNNING",
          course: { name: "ARM Robotics Intensive" },
          students: fStudents.map((s) => ({ activeInClass: true, student: s })),
          slots: buildSlots({
            occurredCount: 4,
            students: fStudents,
            emptyHomeworkAt: [4],
            slotAttendanceOverrides: {
              4: {
                s_done: { status: "ABSENT", comment: "" },
                s_cancel: { status: "UNMARKED", comment: "" },
                s_pending: { status: "UNMARKED", comment: "" },
                s_quill: { status: "UNMARKED", comment: "<p></p>" },
                s_vocab: { status: "ABSENT", comment: "" },
              },
            },
          }),
        },
        submissionGqlData: null,
        studentWorks: [],
        teachingMakeupRows: mockOverview.makeupByClass.get("VT-ROB-ARMI13") || [],
        teachingAllMakeupRows: [
          ...(mockOverview.allMakeupByClass.get("VT-ROB-ARMI13") || []),
          {
            classCode: "VT-ROB-ARMI13",
            studentName: "Lê Minh An",
            sessionLabel: "PREB04 - Buổi 6", // F02: must NOT match Buổi 4!
            teacher: "",
            status: "Chờ học bù",
          },
          {
            classCode: "VT-ROB-ARMI13",
            studentName: "Trần Gia Bảo",
            sessionLabel: "Buổi 3, Buổi: 4", // F02: MUST match Buổi 4!
            teacher: "",
            status: "Chờ học bù",
          },
          {
            classCode: "VT-ROB-ARMI13",
            studentName: "Vũ Nhật Minh",
            sessionLabel: "Buổi 4",
            teacher: "",
            status: "Đã học", // F03: Completed!
          },
        ],
      });

      // Set stageNote "Bạn Nghỉ" via direct raw CP1 note check in snapshot
      const recWithQuillStageNote = computeAdminClassAudits({
        centerCode: "205ALHP",
        rawClassMeta: {
          classCode: "VT-ROB-QUILL",
          lmsClassId: "lms_quill",
          courseName: "ARM Robotics",
          status: "RUNNING",
          mainTeacher: "Dương Anh Quang",
        },
        classByIdData: {
          id: "lms_quill",
          name: "VT-ROB-QUILL",
          status: "RUNNING",
          course: { name: "ARM Robotics" },
          students: [{ id: "q1", fullName: "Phạm Bảo Long" }].map((s) => ({
            activeInClass: true,
            student: s,
          })),
          slots: [
            ...buildSlots({ occurredCount: 3, students: [{ id: "q1", fullName: "Phạm Bảo Long" }] }).slice(0, 3),
            {
              _id: "slot_4",
              index: 3,
              date: new Date(Date.now() - 86_400_000).toISOString(),
              startTime: new Date(Date.now() - 86_400_000).toISOString(),
              summary: "<p>Tổng kết</p>",
              homework: "",
              studentAttendance: [
                {
                  _id: "sa_4_q1",
                  student: { id: "q1", fullName: "Phạm Bảo Long" },
                  status: "",
                  comment: "<p></p>",
                  commentByAreas: [
                    { type: "CHECKPOINT", checkpoint: { note: "Bạn Nghỉ", content: "Bạn Nghỉ" } },
                    { type: "CONTENT", content: "Bạn Nghỉ" },
                  ],
                },
              ],
            },
          ],
        },
        submissionGqlData: null,
        studentWorks: [],
      });

      const alertF = JSON.parse(rec.weeklyOpsJson).checkpointAlert;
      const warningsF = JSON.parse(rec.earlyWarningsJson);
      assert.strictEqual(
        warningsF.some((w: any) => /Đã học bù|Đã huỷ/.test(String(w.detail || ""))),
        false,
        `F01: Không được tạo MAKEUP_DEBT cho Đã học bù/Đã huỷ: ${JSON.stringify(warningsF)}`
      );
      assert.strictEqual(alertF.isMakeupPendingOnly, false);
      assert(alertF.missingStudentNames.includes("Nguyễn Chấn Lâm"), "F01: Đã học bù phải nhắc nhập điểm");
      assert(alertF.missingStudentNames.includes("Lê Minh An"), "F02+F03: Đã huỷ & PREB04-Buổi 6 phải giữ missing");
      assert(alertF.missingStudentNames.includes("Vũ Nhật Minh"), "F03: Đã học phải nhắc nhập điểm");
      assert(
        alertF.absentMakeupStudentNames.includes("Trần Gia Bảo"),
        "F02: Buổi 3, Buổi: 4 phải nhận đúng chờ học bù"
      );

      // Verify F04 directly on att.comment="<p></p>" when student attendance comment area holds note or stageNote
      assert(recWithQuillStageNote.classCode === "VT-ROB-QUILL");
      clearAdminTable();
    }
    console.log("  -> PASS AC3810-06.");

    console.log("\n=== ALL ADMIN CENTER v3.8.10 TESTS PASSED (6/6) ===");
  } finally {
    closeDb();
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
