/**
 * KIỂM THỬ TỰ ĐỘNG (`v3.8.11`) — CÁCH 1B (BTVN OPTIONAL CHO MỌI LỚP) & CÁCH 2A+M1 (QUY TẮC RIÊNG DÒNG LEGO ROB4/ROB6)
 *
 * Chạy 100% cô lập trong `os.tmpdir()` — KHÔNG chạm `data/` thật.
 *
 * Các ca kiểm thử:
 * - [V3811-01] Cách 1B: Ô `homework` trên LMS là optional cho cả Coding (`GA39`, `PTI11`, `JSA14`, `JSI12-HB`) lẫn Robotics —
 *              chỉ cần có Tổng kết buổi (`summary`/`note`) là `hasSummaryAndHomework: true`; thiếu Tổng kết -> `false`
 *              + Zalo nhắc `"Thiếu tổng kết buổi N"` (KHÔNG chứa `"BTVN"`).
 * - [V3811-02] Nhận diện chính xác `isLegoRoboticsClassCode` (`VT-KIND-ROB4I01`, `VT-KIND-ROB4B04`, `VT-KIND-ROB4A03`,
 *              `VT-KIND-ROB6B01`, `ROB4I` -> true; `205ALHP-ROB04`, `VT-ROB-PREB19`, `VT-ROB-ARMA17`, `VT-ROB01` -> false).
 * - [V3811-03] LEGO Checkpoint M1 tại Buổi 5 & Buổi 9 (không chấm điểm số):
 *              `VT-KIND-ROB4I02` ở Buổi 8 (Buổi 5 đủ 7 sao `RATE`) -> `checkpointAlert: null`;
 *              `VT-KIND-ROB4B04` ở Buổi 13 (Buổi 9 đủ 6/6 hoặc 7/7 sao `RATE`) -> `checkpointAlert: null`;
 *              LEGO ở Buổi 5 có 1 HV đi học chưa tích đủ sao + 1 HV nghỉ chờ học bù -> nhắc đúng `"chưa tích sao năng lực Check-point 1"` & tên HV.
 * - [V3811-04] LEGO Tab 3 & Tab 4 (2A):
 *              - `VT-KIND-ROB4A03` B11 & `VT-KIND-ROB4B04` B12 -> `spckTasks.eligibleGt9: false` (miễn Tab 4 Teaching);
 *              - LEGO ở Buổi 12 -> `spckAudit.applicable: false` (miễn Buổi 12);
 *              - `VT-KIND-ROB4I01` B14 `FINISHED` (chỉ có 5 ảnh ở B13, 0 ảnh B14, 0 file code, Demo `1.0x5=5.0`, 7 ô `RATE`, 5 thư) ->
 *                `isLegoCluster1314: true`, `totalMissingUploads: 0`, `requiredCompetencyCount: 7`, `competencyCompleteCount: 5`, `missingEvalStudents: []`.
 * - [V3811-05] LEGO `/final-project` readiness (ảnh-only hợp lệ, thư mục rỗng hoàn toàn chặn) + `uploadSession14EvalViaApi`
 *              với 5 tiêu chí Demo `1.0x5` (nhãn `"Kỹ năng sử dụng công nghệ"`) & đúng 7 ô `[ĐNL]` LEGO.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-v3811-"));
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
process.env.MINDX_ALLOWED_EXTRA_PATHS = tmpRoot;
process.env.MINDX_ALLOW_TEST_HOSTS = "1";
process.env.MINDX_LMS_API_READ = "true";
process.env.MINDX_LMS_API_WRITE = "true";
process.env.ADMIN_CENTER_CODE = "205ALHP";
process.env.ADMIN_LMS_USERNAME = "admin.test@mindx.com.vn";
process.env.ADMIN_LMS_PASSWORD = "AdminDummySecret#3811";
process.env.LMS_USERNAME = "teacher.test@mindx.net.vn";
process.env.LMS_PASSWORD = "TeacherDummySecret#3811";
process.env.ADMIN_TEACHING_USERNAME = "teaching.admin";
process.env.ADMIN_TEACHING_PASSWORD = "TeachingDummySecret#3811";

function makeJwt(email: string): string {
  const h = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
  const p = Buffer.from(
    JSON.stringify({ email, exp: Math.floor(Date.now() / 1000) + 7200, user_id: "uid_3811" })
  ).toString("base64url");
  return `${h}.${p}.${crypto.randomBytes(8).toString("base64url")}`;
}

async function main() {
  console.log("=== TEST MINDX BOT v3.8.11 (OPTION 1B + LEGO ROB4 RULES) ===");

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
        firebaseApiKey: "AIzaDummyApiKey3811",
        idToken: makeJwt(email),
        refreshToken: `refresh_${role.toLowerCase()}`,
        expiresAtMs: Date.now() + 3600_000,
        updatedAt: new Date().toISOString(),
      }),
      "utf8"
    );
  }

  const {
    closeDb,
    getDb,
    calculateCompetencyAverageScore,
    formatRoboticsAwardRankingHtmlForLms,
    getSession14DemoLimitsForClass,
    isLegoRoboticsClassCode,
    isRoboticsClassCode,
    parseSession14DemoScores,
    session14EvalRepo,
    studentRepo,
    adminCenterRepo,
    spckUploadRepo,
  } = await import("../src/lib/db/sqlite");
  const { LEGO_COMPETENCY_AREA_SPECS } = await import("../src/lib/checkpoint/competency-specs");
  const {
    computeAdminClassAudits,
    buildAdminOverviewResponse,
    evaluateTeachingSpckTasksCompliance,
  } = await import("../src/lib/admin-center/admin-lms-scanner");
  const {
    provisionAdminBatchSpckTasksOnTeaching,
    provisionAdminSpckTasksOnTeaching,
  } = await import("../src/lib/admin-center/admin-teaching-actions");
  const { buildTeacherZaloReminder } = await import("../src/lib/admin-center/admin-zalo-reminder");
  const {
    getCompetencyItemsForClassUi,
    getDemoScoreItemsForClassUi,
    getRowReadinessSummary,
    isLegoRoboticsClassUi,
  } = await import("../src/lib/spck/spck-ui-helpers");
  const { uploadSession14EvalViaApi } = await import(
    "../src/lib/lms/lms-write-client"
  );
  const { ScoreScraper } = await import("../src/lib/playwright/scrape-scores");
  const { computeSession14CompetencyFromCheckpoints: extractStudentCheckpointCompetency } =
    await import("../src/lib/local-files/spck-demo-score-reader");

  const clearAdmin = () => getDb().prepare("DELETE FROM admin_center_classes").run();
  const basePast = Date.now() - 14 * 7 * 86_400_000;

  try {
    // -----------------------------------------------------------------------
    // [V3811-01] Option 1B: LMS Homework Box is Optional for BOTH Coding & Robotics
    // -----------------------------------------------------------------------
    console.log("\n[V3811-01] Kiểm tra Cách 1B: BTVN trên LMS là optional cho Coding & Robotics...");
    {
      const stus = [{ id: "c1", fullName: "Lê Minh Khoa" }];
      const buildCodingSlots = (sn: number, emptySummary: boolean) =>
        Array.from({ length: 14 }, (_, idx) => {
          const cur = idx + 1;
          const occ = cur <= sn;
          return {
            _id: `sl_${cur}`,
            index: idx,
            date: new Date(occ ? basePast + idx * 7 * 86_400_000 : Date.now() + (cur - sn) * 7 * 86_400_000).toISOString(),
            startTime: new Date(occ ? basePast + idx * 7 * 86_400_000 : Date.now() + (cur - sn) * 7 * 86_400_000).toISOString(),
            summary: occ && !(cur === sn && emptySummary) ? `<p>Tổng kết buổi ${cur}</p>` : "",
            homework: "",
            studentAttendance: stus.map((s) => ({
              _id: `sa_${cur}_${s.id}`,
              student: s,
              status: occ ? "ATTENDED" : "",
              comment: occ ? "Tốt" : "",
              commentByAreas: [],
            })),
          };
        });

      for (const [code, sn] of [
        ["VT-C4K-GA39", 13],
        ["VT-C4K-PTI11", 13],
        ["VT-JSA14", 12],
        ["VT-JSI12-HB", 9],
      ] as const) {
        const rec = computeAdminClassAudits({
          centerCode: "205ALHP",
          rawClassMeta: { classCode: code, lmsClassId: `id_${code}`, courseName: "Coding", status: "RUNNING" },
          classByIdData: {
            id: `id_${code}`,
            name: code,
            status: "RUNNING",
            course: { name: "Coding" },
            students: stus.map((s) => ({ activeInClass: true, student: s })),
            slots: buildCodingSlots(sn, false),
          },
          submissionGqlData: null,
          studentWorks: [],
        });
        assert.strictEqual(
          JSON.parse(rec.weeklyOpsJson).hasSummaryAndHomework,
          true,
          `${code} B${sn} đã có Tổng kết buổi (trống BTVN) phải báo Đủ!`
        );
      }

      const recMissingSum = computeAdminClassAudits({
        centerCode: "205ALHP",
        rawClassMeta: { classCode: "VT-C4K-GB43", lmsClassId: "id_gb43", courseName: "GameMaker", status: "RUNNING", mainTeacher: "Cô Như" },
        classByIdData: {
          id: "id_gb43",
          name: "VT-C4K-GB43",
          status: "RUNNING",
          course: { name: "GameMaker" },
          students: stus.map((s) => ({ activeInClass: true, student: s })),
          slots: buildCodingSlots(11, true),
        },
        submissionGqlData: null,
        studentWorks: [],
      });
      assert.strictEqual(JSON.parse(recMissingSum.weeklyOpsJson).hasSummaryAndHomework, false);
      adminCenterRepo.upsertClass(recMissingSum);
      const ov = buildAdminOverviewResponse({ includeMakeup: true });
      const row = ov.classes.find((c) => c.classCode === "VT-C4K-GB43")!;
      const zalo = buildTeacherZaloReminder("Cô Như", [row], "205ALHP");
      assert(zalo.includes("Thiếu tổng kết buổi 11"), `Zalo phải nhắc đúng: ${zalo}`);
      assert(!zalo.includes("BTVN"), `Zalo không nhắc chữ BTVN: ${zalo}`);
      clearAdmin();
    }
    console.log("  -> PASS V3811-01.");

    // -----------------------------------------------------------------------
    // [V3811-02] LEGO vs VEX Robotics class code detection precision
    // -----------------------------------------------------------------------
    console.log("\n[V3811-02] Kiểm tra nhận diện chính xác lớp LEGO ROB4/ROB6 vs VEX...");
    {
      for (const code of [
        "VT-KIND-ROB4I01",
        "VT-KIND-ROB4I02",
        "VT-KIND-ROB4B04",
        "VT-KIND-ROB4A03",
        "VT-KIND-ROB6B01",
        "VT-ROB4I",
        "ROB4B",
      ]) {
        assert.strictEqual(isLegoRoboticsClassCode(code), true, `${code} phải là LEGO`);
        assert.strictEqual(isLegoRoboticsClassUi(code), true, `${code} UI phải là LEGO`);
        assert.strictEqual(isRoboticsClassCode(code), true, `${code} vẫn thuộc khối Robotics`);
      }
      for (const nonLego of [
        "205ALHP-ROB04",
        "VT-ROB01",
        "VT-ROB-PREB19",
        "VT-ROB-ARMA17",
        "VT-ROB-SEMIA05",
        "VT-C4K-GA39",
      ]) {
        assert.strictEqual(isLegoRoboticsClassCode(nonLego), false, `${nonLego} KHÔNG được nhận nhầm là LEGO`);
        assert.strictEqual(isLegoRoboticsClassUi(nonLego), false, `${nonLego} UI KHÔNG phải LEGO`);
      }
      assert.strictEqual(
        isLegoRoboticsClassCode("VT-KIND-26", "Robotics 4+ Basic"),
        true,
        "CourseName 'Robotics 4+ Basic' phải nhận là LEGO"
      );
      assert.deepEqual(getSession14DemoLimitsForClass("VT-KIND-ROB4I01"), {
        algorithm: 1,
        creativity: 1,
        communication: 1,
        computerSkills: 1,
        problemSolving: 1,
      });
      assert.deepEqual(
        getDemoScoreItemsForClassUi("VT-KIND-ROB4I01").map((i) => [i.key, i.max, i.label]),
        [
          ["algorithm", 1, "Tư duy máy tính, tư duy thuật toán"],
          ["creativity", 1, "Tư duy sáng tạo mô hình"],
          ["communication", 1, "Kỹ năng giao tiếp, hợp tác"],
          ["problemSolving", 1, "Kỹ năng giải quyết vấn đề"],
          ["computerSkills", 1, "Kỹ năng sử dụng công nghệ"],
        ]
      );
    }
    console.log("  -> PASS V3811-02.");

    // -----------------------------------------------------------------------
    // [V3811-03] LEGO Checkpoint M1 at Sessions 5 & 9 (7 Competency Rates, No Scores)
    // -----------------------------------------------------------------------
    console.log("\n[V3811-03] Kiểm tra Checkpoint LEGO M1 tại Buổi 5 & Buổi 9...");
    {
      const lego7Rates = LEGO_COMPETENCY_AREA_SPECS.map((s) => ({
        type: "RATE",
        grade: 4,
        commentAreaId: s.commentAreaId,
        courseProcessFinalEvaluationTitle: s.finalEvalTitle,
      }));
      const lego6Rates = lego7Rates.slice(0, 6);

      const makeLegoSlots = (occurredSn: number, opts?: { b5RatesMap?: Record<string, any[]>; b5StatusMap?: Record<string, string>; b9RatesMap?: Record<string, any[]>; b13Works?: boolean; b14Full?: boolean }, stus = [{ id: "l1", fullName: "Phạm Đức Lộc" }, { id: "l2", fullName: "Nguyễn Quang Huy" }]) =>
        Array.from({ length: 14 }, (_, idx) => {
          const sn = idx + 1;
          const occ = sn <= occurredSn;
          const ts = new Date(occ ? basePast + idx * 7 * 86_400_000 : Date.now() + (sn - occurredSn) * 7 * 86_400_000).toISOString();
          return {
            _id: `lslot_${sn}`,
            index: idx,
            date: ts,
            startTime: ts,
            summary: occ ? `<p>Tổng kết buổi ${sn}</p>` : "",
            homework: "",
            studentAttendance: stus.map((s) => {
              let commentByAreas: any[] = [];
              let status = occ ? "ATTENDED" : "";
              let comment = occ ? "Tốt" : "";
              if (occ && sn === 5) {
                status = opts?.b5StatusMap?.[s.id] || "ATTENDED";
                commentByAreas = opts?.b5RatesMap?.[s.id] ?? lego7Rates;
                if (status === "ABSENT") {
                  commentByAreas = [];
                  comment = "Bạn Nghỉ";
                }
              } else if (occ && sn === 9) {
                commentByAreas = opts?.b9RatesMap?.[s.id] ?? lego6Rates;
              } else if (occ && sn === 14 && opts?.b14Full) {
                commentByAreas = [
                  {
                    type: "DEMO",
                    grade: 0,
                    commentAreaId: "683e8936dd5f276209a4af26",
                    courseProcessDemoId: "demo_lego",
                    demoQuestions: [
                      { title: "Tư duy máy tính, tư duy thuật toán", score: 1, maxScore: 1 },
                      { title: "Tư duy sáng tạo mô hình", score: 1, maxScore: 1 },
                      { title: "Kỹ năng giao tiếp, hợp tác", score: 1, maxScore: 1 },
                      { title: "Kỹ năng giải quyết vấn đề", score: 1, maxScore: 1 },
                      { title: "Kỹ năng sử dụng công nghệ", score: 1, maxScore: 1 },
                    ],
                  },
                  ...lego7Rates.map((r) => ({ ...r, grade: 5 })),
                  { type: "CONTENT", grade: 5, commentAreaId: "67b54307f79c7bc326e017ff", content: "<p>Tuyệt vời</p>" },
                ];
              }
              return { _id: `lsa_${sn}_${s.id}`, student: s, status, comment, commentByAreas };
            }),
          };
        });

      // 3a) VT-KIND-ROB4I02 at B8 -> CP1 is B5 (already ticked 7/7) -> NO CP1/CP2 alert!
      const rob4i02 = computeAdminClassAudits({
        centerCode: "205ALHP",
        rawClassMeta: { classCode: "VT-KIND-ROB4I02", lmsClassId: "lms_r4i02", courseName: "Robotics 4+ Intensive", status: "RUNNING" },
        classByIdData: {
          id: "lms_r4i02",
          name: "VT-KIND-ROB4I02",
          status: "RUNNING",
          course: { name: "Robotics 4+ Intensive" },
          students: [{ activeInClass: true, student: { id: "l1", fullName: "Phạm Đức Lộc" } }, { activeInClass: true, student: { id: "l2", fullName: "Nguyễn Quang Huy" } }],
          slots: makeLegoSlots(8),
        },
        submissionGqlData: null,
        studentWorks: [],
      });
      assert.strictEqual(JSON.parse(rob4i02.weeklyOpsJson).checkpointAlert, null, "ROB4I02 B8 đã tích sao B5 -> KHÔNG được cảnh báo CP2 ở B8!");

      // 3b) VT-KIND-ROB4B04 at B13 -> CP2 is B9 (all ticked 6/6 template) -> NO CP2 alert!
      const rob4b04 = computeAdminClassAudits({
        centerCode: "205ALHP",
        rawClassMeta: { classCode: "VT-KIND-ROB4B04", lmsClassId: "lms_r4b04", courseName: "Robotics 4+ Basic", status: "RUNNING" },
        classByIdData: {
          id: "lms_r4b04",
          name: "VT-KIND-ROB4B04",
          status: "RUNNING",
          course: { name: "Robotics 4+ Basic" },
          students: [{ activeInClass: true, student: { id: "l1", fullName: "Phạm Đức Lộc" } }, { activeInClass: true, student: { id: "l2", fullName: "Nguyễn Quang Huy" } }],
          slots: makeLegoSlots(13),
        },
        submissionGqlData: null,
        studentWorks: [],
      });
      assert.strictEqual(JSON.parse(rob4b04.weeklyOpsJson).checkpointAlert, null, "ROB4B04 B13 đã tích đủ sao B9 -> KHÔNG được cảnh báo CP2!");
      assert.strictEqual(JSON.parse(rob4b04.spckTasksJson).eligibleGt9, false, "LEGO > B9 miễn Tab 4 Teaching!");

      // 3c) M1 missing stars at B5: l1 ATTENDED unticked, l2 ABSENT waiting makeup
      const rob4MissingCp1 = computeAdminClassAudits({
        centerCode: "205ALHP",
        rawClassMeta: { classCode: "VT-KIND-ROB4T01", lmsClassId: "lms_r4t01", courseName: "Robotics 4+ Basic", status: "RUNNING" },
        classByIdData: {
          id: "lms_r4t01",
          name: "VT-KIND-ROB4T01",
          status: "RUNNING",
          course: { name: "Robotics 4+ Basic" },
          students: [{ activeInClass: true, student: { id: "l1", fullName: "Phạm Đức Lộc" } }, { activeInClass: true, student: { id: "l2", fullName: "Nguyễn Quang Huy" } }],
          slots: makeLegoSlots(5, {
            b5RatesMap: { l1: [] },
            b5StatusMap: { l2: "ABSENT" },
          }),
        },
        submissionGqlData: null,
        studentWorks: [],
      });
      const cp1Alert = JSON.parse(rob4MissingCp1.weeklyOpsJson).checkpointAlert;
      assert.strictEqual(cp1Alert.sessionNumber, 5);
      assert.strictEqual(cp1Alert.missingScoreCount, 1);
      assert.deepEqual(cp1Alert.missingStudentNames, ["Phạm Đức Lộc"]);
      assert.strictEqual(cp1Alert.absentMakeupCount, 1);
      assert.deepEqual(cp1Alert.absentMakeupStudentNames, ["Nguyễn Quang Huy"]);
      assert(cp1Alert.message.includes("chưa tích sao năng lực Check-point 1"), `Message M1: ${cp1Alert.message}`);

      // Verify Checkpoint Competency Reader uses B5 & B9 for LEGO
      const cpComp = extractStudentCheckpointCompetency({
        classId: "VT-KIND-ROB4I02",
        studentId: "l1",
        fullName: "Phạm Đức Lộc",
        slots: makeLegoSlots(9),
      });
      assert.strictEqual(cpComp.cp1SlotNumber, 5);
      assert.strictEqual(cpComp.cp2SlotNumber, 9);
      assert.strictEqual(cpComp.matchedFromCheckpoints, true);
    }
    console.log("  -> PASS V3811-03.");

    // -----------------------------------------------------------------------
    // [V3811-04] LEGO Tab 3 (Exempt B12 + Cluster B13-14 photo-only + 7 ĐNL B14) & Tab 4 Exempt
    // -----------------------------------------------------------------------
    console.log("\n[V3811-04] Kiểm tra LEGO Tab 3 (miễn B12, cụm B13-14 chỉ cần ảnh, 7 ĐNL) & Tab 4 miễn...");
    {
      const lego7Rates = LEGO_COMPETENCY_AREA_SPECS.map((s) => ({
        type: "RATE",
        grade: 5,
        commentAreaId: s.commentAreaId,
        courseProcessFinalEvaluationTitle: s.finalEvalTitle,
      }));
      const stus = [
        { id: "r1", fullName: "Mai Nhật Minh" },
        { id: "r2", fullName: "Phạm Hà Minh Duyên" },
      ];

      // 4a) LEGO at Session 12 -> spckAudit.applicable === false AND spckTasks.eligibleGt9 === false
      const rob4B12 = computeAdminClassAudits({
        centerCode: "205ALHP",
        rawClassMeta: { classCode: "VT-KIND-ROB4A03", lmsClassId: "lms_r4a03", courseName: "Robotics 4+ Advanced", status: "RUNNING" },
        classByIdData: {
          id: "lms_r4a03",
          name: "VT-KIND-ROB4A03",
          status: "RUNNING",
          course: { name: "Robotics 4+ Advanced" },
          students: stus.map((s) => ({ activeInClass: true, student: s })),
          slots: Array.from({ length: 14 }, (_, idx) => ({
            _id: `sl_${idx + 1}`,
            index: idx,
            date: new Date(idx < 12 ? basePast + idx * 7 * 86_400_000 : Date.now() + 7 * 86_400_000).toISOString(),
            startTime: new Date(idx < 12 ? basePast + idx * 7 * 86_400_000 : Date.now() + 7 * 86_400_000).toISOString(),
            summary: idx < 12 ? `<p>B${idx + 1}</p>` : "",
            studentAttendance: stus.map((s) => ({ student: s, status: idx < 12 ? "ATTENDED" : "", commentByAreas: [] })),
          })),
        },
        submissionGqlData: null,
        studentWorks: [],
      });
      assert.strictEqual(JSON.parse(rob4B12.spckAuditJson).applicable, false, "LEGO Buổi 12 được miễn Tab 3!");
      assert.strictEqual(JSON.parse(rob4B12.spckTasksJson).eligibleGt9, false, "LEGO B12 được miễn Tab 4 Teaching!");

      // 4b) LEGO B14 FINISHED (`VT-KIND-ROB4I01` pattern): B13 has photo-only works (0 B14 works, 0 attachments), Demo 5x1.0, 7 RATEs, letters -> 100% PASS!
      const rob4I01 = computeAdminClassAudits({
        centerCode: "205ALHP",
        rawClassMeta: { classCode: "VT-KIND-ROB4I01", lmsClassId: "lms_r4i01", courseName: "Robotics 4+ Intensive", status: "FINISHED" },
        classByIdData: {
          id: "lms_r4i01",
          name: "VT-KIND-ROB4I01",
          status: "FINISHED",
          endDate: "2026-11-13",
          course: { name: "Robotics 4+ Intensive" },
          students: stus.map((s) => ({ activeInClass: true, student: s })),
          slots: Array.from({ length: 14 }, (_, idx) => ({
            _id: `slot_${idx + 1}`,
            index: idx,
            date: new Date(basePast + idx * 7 * 86_400_000).toISOString(),
            startTime: new Date(basePast + idx * 7 * 86_400_000).toISOString(),
            summary: `<p>B${idx + 1}</p>`,
            studentAttendance: stus.map((s) => ({
              student: s,
              status: "ATTENDED",
              comment: "Tốt",
              commentByAreas:
                idx + 1 === 14
                  ? [
                      {
                        type: "DEMO",
                        grade: 0,
                        commentAreaId: "683e8936dd5f276209a4af26",
                        demoQuestions: [
                          { title: "Tư duy máy tính, tư duy thuật toán", score: 1, maxScore: 1 },
                          { title: "Tư duy sáng tạo mô hình", score: 1, maxScore: 1 },
                          { title: "Kỹ năng giao tiếp, hợp tác", score: 1, maxScore: 1 },
                          { title: "Kỹ năng giải quyết vấn đề", score: 1, maxScore: 1 },
                          { title: "Kỹ năng sử dụng công nghệ", score: 1, maxScore: 1 },
                        ],
                      },
                      ...lego7Rates,
                    ]
                  : idx + 1 === 5 || idx + 1 === 9
                  ? lego7Rates
                  : [],
            })),
          })),
        },
        submissionGqlData: null,
        studentWorks: stus.map((s) => ({
          id: `w_${s.id}`,
          studentId: s.id,
          classSessionId: "slot_13",
          classSessionNumber: 13,
          latestData: {
            title: "Siêu xe LEGO",
            comment: "Con lắp ráp và thuyết trình tự tin.",
            thumbnail: "https://resources.mindx.edu.vn/uploads/images/photo.jpg",
            attachmentUrls: [],
          },
        })),
        studentLetters: stus.map((s) => ({
          studentId: s.id,
          macros: [
            { key: "@learnedFromMindx", value: "Kiến thức lắp ráp và lập trình khối LEGO." },
            { key: "@suggestionsFromMindx", value: "Rèn thêm kỹ năng thuyết trình tự tin hơn." },
            { key: "@futureDirection", value: "Tiếp tục khóa Robotics 6+ tại MindX." },
          ],
        })),
      });
      const sa = JSON.parse(rob4I01.spckAuditJson);
      assert.strictEqual(sa.applicable, true);
      assert.strictEqual(sa.slots["12"].sessionOccurred, false);
      assert.strictEqual(sa.slots["14"].isLegoCluster1314, true);
      assert.strictEqual(sa.slots["14"].uploadedCount, 2);
      assert.strictEqual(sa.totalMissingUploads, 0);
      assert.strictEqual(sa.totalMissingMediaOrLinks, 0);
      assert.strictEqual(sa.totalMissingTeacherComments, 0);
      assert.strictEqual(sa.session14FinalEval.requiredCompetencyCount, 7);
      assert.strictEqual(sa.session14FinalEval.demoScoredCount, 2);
      assert.strictEqual(sa.session14FinalEval.competencyCompleteCount, 2);
      assert.strictEqual(sa.session14FinalEval.mindx3PartCommentCount, 2);
      assert.deepEqual(sa.session14FinalEval.missingEvalStudents, []);
    }
    console.log("  -> PASS V3811-04.");

    // -----------------------------------------------------------------------
    // [V3811-05] LEGO photo-only UI readiness & pure-Node LMS Write API (5x1.0 + 7 ĐNL)
    // -----------------------------------------------------------------------
    console.log("\n[V3811-05] Kiểm tra điều kiện nộp ảnh-only LEGO & ghi LMS API (5x1.0 + 7 ĐNL)...");
    {
      const baseRow: any = {
        folderName: "Mai Nhật Minh",
        folderPath: path.join(tmpRoot, "Mai Nhat Minh"),
        assignedStudentId: "stu_lego_1",
        isConfirmedByTeacher: true,
        projectTitle: "Mô hình chú ong thợ",
        thumbnailPath: path.join(tmpRoot, "thumb.png"),
        screenshots: [],
        attachments: [],
        youtubeUrlsText: "",
        relatedLinksText: "",
        teacherComment: "- **Sản phẩm:** Đẹp",
        status: "APPROVED",
      };
      const readyWithPhoto = getRowReadinessSummary(baseRow, new Set(), "VT-KIND-ROB4I01");
      assert.strictEqual(readyWithPhoto.ready, true, "LEGO có ảnh đại diện + 0 file code phải SẴN SÀNG nộp!");

      const unreadyEmpty = getRowReadinessSummary(
        { ...baseRow, thumbnailPath: path.resolve(process.cwd(), "data", "config", "default-spck-thumbnail.png") },
        new Set(),
        "VT-KIND-ROB4I01"
      );
      assert.strictEqual(unreadyEmpty.ready, false);
      assert(unreadyEmpty.missingItems.some((m) => m.includes("ảnh")));

      // Pure-Node LMS Write API for LEGO session 14
      const classId = "VT-KIND-ROB4I01";
      studentRepo.upsert({ studentId: "stu_lego_1", classId, fullName: "Mai Nhật Minh", isActive: 1 });
      const rebalanced = parseSession14DemoScores(
        { algorithm: 1.25, creativity: 0.75, communication: 1.0, computerSkills: 0.5, problemSolving: 1.5 },
        classId
      );
      assert.deepEqual(rebalanced, { algorithm: 1, creativity: 1, communication: 1, computerSkills: 1, problemSolving: 1 });

      const comp = {
        knowledgeInClass: 5,
        knowledgeSelfStudy: 4,
        skillCommunication: 5,
        skillComputerUse: 4,
        skillProblemSolving: 5,
        skillCreativity: 4,
        skillComputational: 5,
        attitudeHomework: 4,
        attitudeInClass: 5,
      };
      session14EvalRepo.saveDraft({
        classId,
        studentId: "stu_lego_1",
        competencyScores: comp,
        demoScores: rebalanced,
        learnedFromMindx:
          "- **Điểm Demo:** 5.00/5.0\n- **Điểm Năng lực:** 4.71/5.0\nCon học tốt các khối lệnh điều khiển mô hình LEGO.",
        suggestionsFromMindx: "Con luyện thêm cách thuyết trình to rõ ràng hơn.",
        futureDirection: "Tiếp tục khóa Robotics nâng cao tại MindX.",
        awardRanking: "Giải Nhất",
        awardRankGrade: 5,
      });
      const apRes = session14EvalRepo.approveDraft(classId, "stu_lego_1");
      assert.strictEqual(apRes.success, true, apRes.error || "approveDraft must succeed");

      fs.writeFileSync(
        process.env.MINDX_LMS_CLASS_IDS_PATH!,
        JSON.stringify({ [classId]: "lms_rob4_write" }, null, 2),
        "utf8"
      );

      let storedAreas: any[] = [];
      let storedLetter: any = null;
      let capturedAreasCount = 0;

      const buildMockClass = () => {
        const courseProcessObj = {
          id: "cp_rob4",
          finalSession: {
            demoScore: {
              id: "cp_demo_lego",
              commentAreas: [
                {
                  id: "683e8936dd5f276209a4af26",
                  demoDetails: [
                    { id: "q1", title: "Tư duy máy tính, tư duy thuật toán", score: 1 },
                    { id: "q2", title: "Tư duy sáng tạo mô hình", score: 1 },
                    { id: "q3", title: "Kỹ năng giao tiếp, hợp tác", score: 1 },
                    { id: "q4", title: "Kỹ năng giải quyết vấn đề", score: 1 },
                    { id: "q5", title: "Kỹ năng sử dụng công nghệ", score: 1 },
                  ],
                },
              ],
            },
            finalEvaluations: [
              {
                id: "fe_1",
                title: "KIẾN THỨC",
                commentAreas: [{ id: "683e88a68cc94584eaee6aff", name: "Kiến thức", type: "RATE" }],
              },
              {
                id: "fe_2",
                title: "KỸ NĂNG",
                commentAreas: LEGO_COMPETENCY_AREA_SPECS.slice(1, 6).map((s) => ({
                  id: s.commentAreaId,
                  name: s.labelVi,
                  type: "RATE",
                })),
              },
              {
                id: "fe_3",
                title: "THÁI ĐỘ",
                commentAreas: [
                  { id: "683e7e028cc94584eaee56dd", name: "Thái độ", type: "RATE" },
                  { id: "67b54307f79c7bc326e017ff", name: "Đánh giá chung", type: "CONTENT" },
                ],
              },
            ],
          },
        };
        return {
          id: "lms_rob4_write",
          name: classId,
          courseProcesses: [courseProcessObj],
          course: {
            id: "course_rob4",
            name: "Robotics 4+ Intensive",
            courseProcess: courseProcessObj,
          },
          students: [{ activeInClass: true, student: { id: "stu_lego_1", fullName: "Mai Nhật Minh" } }],
          slots: Array.from({ length: 14 }, (_, idx) => ({
            _id: `wsl_${idx + 1}`,
            index: idx,
            studentAttendance:
              idx + 1 === 14
                ? [
                    {
                      _id: "wsa_14_1",
                      status: "ATTENDED",
                      comment: "",
                      student: { id: "stu_lego_1", fullName: "Mai Nhật Minh" },
                      commentByAreas: storedAreas,
                    },
                  ]
                : [],
          })),
        };
      };

      const server = http.createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        const op = String(parsed.operationName || "");
        const vars = parsed.variables || {};
        res.writeHead(200, { "content-type": "application/json" });

        if (op === "GetClassWriteContext" || op === "GetClassById" || op === "GetClassForSpckWrite" || op === "GetClassByIdSafe") {
          res.end(JSON.stringify({ data: { classesById: buildMockClass() } }));
          return;
        }
        if (op === "UpdateSlotComment") {
          const areas = vars?.payload?.studentComment?.byAreas || [];
          storedAreas = areas;
          capturedAreasCount = areas.filter((a: any) => a.type === "RATE").length;
          res.end(JSON.stringify({ data: { classes: { updateSlotComment: buildMockClass() } } }));
          return;
        }
        if (op === "FindOneByCriteria") {
          res.end(JSON.stringify({ data: { findOneByCriteria: storedLetter } }));
          return;
        }
        if (op === "GetEmailTemplates" || op === "EmailTemplatesPagination") {
          const tpls = [
            {
              id: "tpl_1",
              systemCode: "STUDENT_LETTER",
              name: "Student Letter",
              content: "<p>@learnedFromMindx</p><p>@suggestionsFromMindx</p><p>@futureDirection</p>",
              isActive: true,
            },
          ];
          res.end(
            JSON.stringify({
              data: {
                emailTemplates: { data: tpls },
                emailTemplatesPagination: { data: tpls },
              },
            })
          );
          return;
        }
        if (op === "CreateStudentLetters") {
          storedLetter = { id: "let_1", ...vars.payload };
          res.end(JSON.stringify({ data: { studentLetters: { create: storedLetter } } }));
          return;
        }
        if (op === "UpdateStudentLetters") {
          storedLetter = { id: "let_1", ...vars.payload };
          res.end(JSON.stringify({ data: { studentLetters: { update: storedLetter } } }));
          return;
        }
        res.end(JSON.stringify({ errors: [{ message: `Unexpected op ${op}` }] }));
      });

      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const addr = server.address() as { port: number };
      process.env.MINDX_LMS_API_URL = `http://127.0.0.1:${addr.port}/graphql`;

      try {
        const writeRes = await uploadSession14EvalViaApi({
          classId,
          studentIds: ["stu_lego_1"],
          uploadClassSummary: false,
        });
        assert.strictEqual(writeRes.verifiedCount, 1, writeRes.results[0]?.errorMessage || "verifiedCount must be 1");
        assert.strictEqual(capturedAreasCount, 7, "LEGO Buổi 14 phải ghi đúng 7 ô RATE (không phải 9)");
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
    console.log("  -> PASS V3811-05.");

    // -----------------------------------------------------------------------
    // [V3811-06] Adversarial Regression Closure for Audit Findings F01-F10
    // -----------------------------------------------------------------------
    console.log("\n[V3811-06] Kiểm tra hồi quy toàn bộ F01-F10 (ROB40/60, Tab 4, 7-ĐNL TB, B5 CP1, HTML 1/1, Zalo B13-14)...");
    {
      // F05: ROB40..49 / ROB60..69 MUST NOT be classified as LEGO
      for (const nonLego of ["ROB40", "ROB41", "VT-ROB42", "ROB60", "VT-ROB61"]) {
        assert.strictEqual(isLegoRoboticsClassCode(nonLego), false, `${nonLego} không phải LEGO`);
        assert.strictEqual(isLegoRoboticsClassUi(nonLego), false, `${nonLego} UI không phải LEGO`);
      }

      // F04: formatRoboticsAwardRankingHtmlForLms with LEGO classId uses 1/1 caps & công nghệ label
      const legoHtml = formatRoboticsAwardRankingHtmlForLms({
        classId: "VT-KIND-ROB4I01",
        demoScores: { algorithm: 1, creativity: 1, communication: 1, computerSkills: 1, problemSolving: 1 },
        demoTotalScore: 5,
      });
      assert(legoHtml.includes("(1/1)"), "LEGO HTML phải ghi (1/1)");
      assert(!legoHtml.includes("/1.5)") && !legoHtml.includes("/0.75)"), "LEGO HTML không được rò trần VEX 1.5/0.75");
      assert(!legoHtml.includes("chưa đạt tối đa"), "LEGO đạt 5x1.0 không được đẩy sang Điểm cần cải thiện");

      // F08: 7-area competency average ignores unused knowledgeSelfStudy & attitudeHomework + UI 7 items
      assert.strictEqual(getCompetencyItemsForClassUi("VT-KIND-ROB4I01").length, 7);
      assert.strictEqual(
        calculateCompetencyAverageScore(
          {
            knowledgeSelfStudy: 3,
            knowledgeInClass: 5,
            skillCommunication: 5,
            skillComputerUse: 5,
            skillProblemSolving: 5,
            skillCreativity: 5,
            skillComputational: 5,
            attitudeHomework: 3,
            attitudeInClass: 5,
          },
          "VT-KIND-ROB4I01"
        ),
        5.0
      );
      const cp7Res = extractStudentCheckpointCompetency({
        classId: "VT-KIND-ROB4I01",
        cp1CommentByAreas: LEGO_COMPETENCY_AREA_SPECS.map((s) => ({ commentAreaId: s.commentAreaId, grade: 5 })),
        cp2CommentByAreas: LEGO_COMPETENCY_AREA_SPECS.map((s) => ({ commentAreaId: s.commentAreaId, grade: 5 })),
      });
      assert.strictEqual(cp7Res.competencyTotalScore, 5.0);

      // F06: partial 2/7 LEGO stars at B5 MUST trigger checkpointAlert (never false-green)
      clearAdmin();
      const partialSlots = Array.from({ length: 14 }, (_, idx) => {
        const cur = idx + 1;
        const occ = cur <= 8;
        return {
          _id: `p5_${cur}`,
          index: idx,
          date: new Date(occ ? basePast + idx * 7 * 86_400_000 : Date.now() + (cur - 8) * 7 * 86_400_000).toISOString(),
          startTime: new Date(occ ? basePast + idx * 7 * 86_400_000 : Date.now() + (cur - 8) * 7 * 86_400_000).toISOString(),
          summary: occ ? `<p>Tổng kết buổi ${cur}</p>` : "",
          homework: "",
          studentAttendance: [
            {
              status: occ ? "ATTENDED" : null,
              comment: "",
              student: { id: "lego_p1", fullName: "Nguyễn Hải An" },
              commentByAreas:
                cur === 5
                  ? LEGO_COMPETENCY_AREA_SPECS.slice(0, 2).map((s) => ({
                      commentAreaId: s.commentAreaId,
                      type: "RATE",
                      grade: 4,
                    }))
                  : [],
            },
          ],
        };
      });
      const partialAuditRec = computeAdminClassAudits({
        centerCode: "205ALHP",
        rawClassMeta: { classCode: "VT-KIND-ROB4B99", lmsClassId: "lms_r4b99", courseName: "Robotics 4+", status: "RUNNING" },
        classByIdData: {
          id: "lms_r4b99",
          name: "VT-KIND-ROB4B99",
          status: "RUNNING",
          course: { name: "Robotics 4+" },
          students: [{ activeInClass: true, student: { id: "lego_p1", fullName: "Nguyễn Hải An" } }],
          slots: partialSlots,
        },
        submissionGqlData: null,
        studentWorks: [],
      });
      const partialAlert = JSON.parse(partialAuditRec.weeklyOpsJson).checkpointAlert;
      assert(partialAlert, "Tích thưa 2/7 sao B5 LEGO phải cảnh báo thiếu sao CP1");
      assert.strictEqual(partialAlert.missingScoreCount, 1);

      // F09: ScoreScraper LEGO CP1 uses B5 (idx 4), NOT B4 (idx 3) absence note
      const snap = ScoreScraper.extractReportCardSnapshotFromGql({
        classId: "VT-KIND-ROB4B98",
        classCode: "VT-KIND-ROB4B98",
        classByIdGqlData: {
          name: "VT-KIND-ROB4B98",
          course: { name: "Robotics 4+" },
          students: [{ activeInClass: true, student: { id: "s_b4abs", fullName: "Phạm Minh Đức" } }],
          slots: Array.from({ length: 14 }, (_, idx) => ({
            _id: `f09_${idx + 1}`,
            index: idx,
            studentAttendance: [
              {
                status: idx === 3 ? "ABSENT" : "ATTENDED",
                comment: idx === 3 ? "Bạn nghỉ" : "Học tốt",
                student: { id: "s_b4abs", fullName: "Phạm Minh Đức" },
                commentByAreas:
                  idx === 4
                    ? LEGO_COMPETENCY_AREA_SPECS.map((s) => ({
                        commentAreaId: s.commentAreaId,
                        type: "RATE",
                        grade: 5,
                      }))
                    : [],
              },
            ],
          })),
        },
        submissionGqlData: null,
        existingStudents: [],
        session14Evals: [],
      });
      assert.strictEqual(snap.students[0]?.stageScores.cp1Note, "Học tốt", "CP1 LEGO phải đọc ghi chú B5, không rò B4");

      // F02: Tab 4 compliance & actions exempt LEGO completely
      const compRes = evaluateTeachingSpckTasksCompliance({
        classCode: "VT-KIND-ROB4A03",
        courseName: "Robotics 4+",
        eligibleGt9: false,
        project: { id: 999 },
        tasks: [],
        activeStudentIds: [1],
      });
      assert.strictEqual(compRes.taskStatus, "NOT_ELIGIBLE");
      const rob4a03Rec = computeAdminClassAudits({
        centerCode: "205ALHP",
        rawClassMeta: { classCode: "VT-KIND-ROB4A03", lmsClassId: "lms_r4a03", courseName: "Robotics 4+", status: "RUNNING" },
        classByIdData: {
          id: "lms_r4a03",
          name: "VT-KIND-ROB4A03",
          status: "RUNNING",
          course: { name: "Robotics 4+" },
          students: [{ activeInClass: true, student: { id: "st_leg", fullName: "Lê Gia Huy" } }],
          slots: Array.from({ length: 14 }, (_, idx) => ({
            _id: `r4a_${idx + 1}`,
            index: idx,
            date: new Date(idx < 12 ? basePast + idx * 7 * 86_400_000 : Date.now() + (idx - 11) * 7 * 86_400_000).toISOString(),
            startTime: new Date(idx < 12 ? basePast + idx * 7 * 86_400_000 : Date.now() + (idx - 11) * 7 * 86_400_000).toISOString(),
            summary: idx < 12 ? `<p>Tổng kết ${idx + 1}</p>` : "",
            homework: "",
            studentAttendance: idx < 12 ? [{ status: "ATTENDED", comment: "Tốt", student: { id: "st_leg", fullName: "Lê Gia Huy" } }] : [],
          })),
        },
        submissionGqlData: null,
        studentWorks: [],
      });
      adminCenterRepo.upsertClass(rob4a03Rec);
      const singleProv = await provisionAdminSpckTasksOnTeaching("VT-KIND-ROB4A03");
      assert.strictEqual(singleProv.success, false);
      assert.strictEqual(singleProv.statusCode, 400);
      const batchProv = await provisionAdminBatchSpckTasksOnTeaching();
      assert.strictEqual(batchProv.totalTargets, 0, "Batch AUTO Tab 4 không được chọn lớp LEGO");

      // F10: Zalo SPCK message for LEGO prints (B13–14)
      const zaloMsg = buildTeacherZaloReminder(
        "Cô Thảo",
        [
          {
            classCode: "VT-KIND-ROB4I01",
            blockType: "ROBOTICS",
            currentSessionNumber: 14,
            weeklyOps: {
              evaluatedSessionNumber: 14,
              attendanceStatus: "FULL",
              unmarkedCount: 0,
              hasSummaryAndHomework: true,
              missingCommentStudentNames: [],
              isZaloLateOrMissing: false,
              isLmsLateOrMissing: false,
              checkpointAlert: null,
            },
            btvnSummary: { applicable: false },
            earlyWarnings: [],
            spckAudit: {
              applicable: true,
              slots: {
                "12": { sessionNumber: 12, sessionOccurred: false },
                "13": { sessionNumber: 13, sessionOccurred: true, isLegoCluster1314: true },
                "14": { sessionNumber: 14, sessionOccurred: true, isLegoCluster1314: true },
              } as any,
              totalMissingUploads: 2,
              totalMissingMediaOrLinks: 0,
              totalMissingTeacherComments: 0,
              session14FinalEval: { applicable: false, missingEvalStudents: [] } as any,
            } as any,
            spckTasks: { eligibleGt9: false, taskStatus: "NOT_ELIGIBLE" } as any,
          } as any,
        ],
        "205ALHP"
      );
      assert(zaloMsg.includes("(B13–14)") && !zaloMsg.includes("(B12–14)"), `Zalo LEGO phải ghi (B13–14), nhận: ${zaloMsg}`);
    }
    console.log("  -> PASS V3811-06.");

    console.log("\n=== ALL v3.8.11 TESTS PASSED (6/6) ===");
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
