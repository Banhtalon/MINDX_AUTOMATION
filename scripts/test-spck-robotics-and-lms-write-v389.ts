/**
 * KIỂM THỬ TỰ ĐỘNG PHẦN 2 (`v3.8.9`) — ROBOTICS SPCK 3 BUỔI (1A) & PURE-NODE LMS WRITE API OVERWRITE (2A)
 *
 * Chạy 100% cô lập trong `os.tmpdir()` với mock HTTP server `/api/v1/resources` + `/graphql` trên `127.0.0.1:0`
 * — KHÔNG chạm dữ liệu thật trong `data/` hay gọi mạng MindX thật.
 *
 * Các nhóm kiểm thử:
 * - [ROB389-01] Scanner Robotics (`VT-ROB-ARMA13`): tách riêng ảnh chân dung làm `Thumbnail *`, chấp nhận 0 ảnh chụp Robot
 *               (`screenshots = []`) cho cả Buổi 12/13/14 không cảnh báo, nhận file gốc `.iqblocks/.goblocks/.vexblocks/.v5blocks/.v5python/.ino/.c/.cpp/.h`
 *               không đóng gói thừa `_robotics_package.zip`, vẫn gói `.ev3/.llsp3`, bỏ qua auto-screenshotter app Coding.
 * - [ROB389-02] `resolveRoboticsAwardRankGrade` (`1/2/3/5/0`), `formatRoboticsAwardRankingHtmlForLms` (giữ bản tự viết hoặc tự sinh 3 gạch),
 *               tương thích ngược `computeSession14EvalHash` khi `awardRankGrade` rỗng, và lưu/lọc qua `session14EvalRepo`.
 * - [API389-03] `uploadFileToMindxResources` (multipart `"files"` + SHA-256 `lmsResourceCacheRepo` `0` hit lần 2 + `assertPathAllowed`).
 * - [API389-04] `upsertClassSpckViaApi` qua 3 buổi (Buổi 12 Create -> Buổi 13 Create -> Buổi 12 Overwrite Item 01 không truyền `classSessionNumber` trong inner payload
 *               + dọn Item 02 trùng trên Buổi 12 mà không đụng Buổi 13 -> chạy lại giống hệt fast-skip `0` mutation -> `clearSessionSpck` chỉ xóa Buổi 12)
 *               + bắt lỗi Read-after-Write tamper (`FAILED`).
 * - [API389-05] `uploadSession14EvalViaApi` cho cả Robotics (`ARMA13` ID thứ 9 tuỳ biến + `Demo2024 | ROB` + mục `665e8440181e0e47f6c654c1` số `0..5` + HTML + `studentLetters`)
 *               lẫn Coding, và khóa bảo vệ `studentLetters.status === "APPROVED"` (giữ nguyên thư, vẫn xác minh bảng ĐNL/Demo).
 * - [API389-06] Công tắc `MINDX_LMS_API_WRITE=false` & Fallback tự động sang Playwright khi `/api/v1/resources` lỗi HTTP 502,
 *               cấm fallback khi lỗi vượt trần điểm / vi phạm `assertPathAllowed`.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-v389-rob-api-"));
const configDir = path.join(tmpRoot, "config");
const tokenDir = path.join(tmpRoot, "tokens");
const spckRoot = path.join(tmpRoot, "spck_projects");
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(tokenDir, { recursive: true });
fs.mkdirSync(spckRoot, { recursive: true });

(process.env as Record<string, string | undefined>).NODE_ENV = "test";
process.env.MINDX_DB_PATH = path.join(tmpRoot, "mindx_v389_test.db");
process.env.MINDX_CONFIG_DIR = configDir;
process.env.MINDX_RUNNING_CLASSES_PATH = path.join(tmpRoot, "running_classes.json");
process.env.MINDX_LMS_CLASS_IDS_PATH = path.join(configDir, "lms_class_ids.json");
process.env.MINDX_ROLE_STATE_DIR = path.join(tmpRoot, "role-state");
process.env.MINDX_LMS_TOKEN_DIR = tokenDir;
process.env.ALLOWED_LOCAL_DIRS = `${tmpRoot};${path.join(process.cwd(), "data")}`;
process.env.MINDX_ALLOW_TEST_HOSTS = "1";
process.env.LMS_USERNAME = "teacher.rob@mindx.net.vn";
process.env.LMS_PASSWORD = "DummyRobPassword#389";
process.env.TEACHING_USERNAME = "teacher.rob";
process.env.TEACHING_PASSWORD = "DummyRobPassword#389";

const MINIMAL_1X1_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function makeJwt(email: string): string {
  const h = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
  const p = Buffer.from(
    JSON.stringify({ email, exp: Math.floor(Date.now() / 1000) + 7200, user_id: "uid_t" })
  ).toString("base64url");
  return `${h}.${p}.${crypto.randomBytes(8).toString("base64url")}`;
}

function readRequestBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function main() {
  console.log("=== TEST PART 2 v3.8.9 (ROBOTICS SPCK 1A + LMS WRITE API 2A) ===");

  fs.writeFileSync(
    path.join(tokenDir, "lms_token_teacher.json"),
    JSON.stringify({
      role: "TEACHER",
      username: "teacher.rob@mindx.net.vn",
      email: "teacher.rob@mindx.net.vn",
      userId: "uid_t",
      firebaseApiKey: "AIzaDummy389",
      idToken: makeJwt("teacher.rob@mindx.net.vn"),
      refreshToken: "refresh_t",
      expiresAtMs: Date.now() + 3600_000,
      updatedAt: new Date().toISOString(),
    }),
    "utf8"
  );

  // Mock LMS GraphQL + MindX Resource CDN Server on 127.0.0.1:0
  let resourceUploadCalls = 0;
  let forceResourceUploadErrorStatus = 0;
  let forceCreateWorkErrorStatus = 0;
  let tamperNextStudentWorkRead = false;
  let createWorkCalls = 0;
  let updateWorkCalls = 0;
  let deleteWorkCalls = 0;
  let updateSlotCommentCalls = 0;
  let lastUpdateSlotCommentPayload: any = null;
  let createLetterCalls = 0;
  let updateLetterCalls = 0;
  let lastUpdateWorkPayload: any = null;

  const studentWorksDb: any[] = [];
  const lettersDb = new Map<string, any>();
  const mockClassesDb = new Map<string, any>();

  function seedMockClass(params: {
    lmsClassId: string;
    classCode: string;
    isRobotics: boolean;
    custom9thRateId?: string;
    students: Array<{ id: string; fullName: string }>;
  }) {
    const slots: any[] = [];
    for (let sn = 1; sn <= 14; sn++) {
      slots.push({
        _id: `${params.lmsClassId}_slot_${sn}`,
        index: sn - 1,
        summary: "",
        homework: `<p>Homework Buổi ${sn}</p>`,
        studentAttendance: params.students.map((stu) => ({
          _id: `${params.lmsClassId}_sa_${sn}_${stu.id}`,
          status: "ATTENDED",
          comment: "",
          student: { id: stu.id, fullName: stu.fullName },
          commentByAreas: [],
        })),
      });
    }

    const rateAreas = [
      { id: "665e7d33181e0e47f6c63768", name: "[ĐNL] Kiến thức học viên tự học", type: "RATE" },
      { id: "668d69d8e71f90e7630ce16c", name: "[ĐNL] Kiến thức học viên đã được học tại lớp", type: "RATE" },
      { id: "668e2e7de71f90e7630d4316", name: "[ĐNL] Kỹ năng giao tiếp, hợp tác", type: "RATE" },
      { id: "668e5146e71f90e7630da552", name: "[ROB-ĐNL] Kỹ năng sử dụng máy tính", type: "RATE" },
      { id: "668e5005e71f90e7630da316", name: "[ROB-ĐNL] Kỹ năng giải quyết vấn đề", type: "RATE" },
      { id: "668e50ade71f90e7630da4b2", name: "[ROB-ĐNL] Tư duy sáng tạo mô hình", type: "RATE" },
      { id: "668e49ebe71f90e7630d9433", name: "Tư duy máy tính, tư duy thuật toán.ROB.ĐNL2024", type: "RATE" },
      { id: "668e2f5be71f90e7630d44c1", name: "[ĐNL] Thái độ luyện tập về nhà", type: "RATE" },
      {
        id: params.custom9thRateId || "668e2eaee71f90e7630d434f",
        name: "[ĐNL] Thái độ học tập trên lớp",
        type: "RATE",
      },
    ];
    if (params.isRobotics) {
      rateAreas.push({
        id: "665e8440181e0e47f6c654c1",
        name: "Xếp hạng học viên trên lớp",
        type: "CONTENT",
      });
    }

    mockClassesDb.set(params.lmsClassId, {
      id: params.lmsClassId,
      name: params.classCode,
      status: "RUNNING",
      course: { id: `c_${params.classCode}`, name: params.isRobotics ? "ARM A" : "CSI", shortName: params.classCode },
      centre: { id: "644346f794300678908f79bc" },
      courseProcesses: [
        {
          id: `cp_${params.classCode}`,
          name: params.isRobotics ? "ARM A Process" : "CSI Process",
          finalSession: {
            demoScore: {
              id: `demo_${params.classCode}`,
              commentAreas: [
                {
                  id: params.isRobotics ? "66c810fc6ae1a9fab63875fd" : "665e88ae181e0e47f6c65642",
                  name: params.isRobotics ? "Demo2024 | ROB" : "Demo2024 | CODING",
                  demoDetails: params.isRobotics
                    ? [
                        { id: "rb_1", title: "Tư duy máy tính, tư duy thuật toán", score: 1.25 },
                        { id: "rb_2", title: "Tư duy sáng tạo", score: 0.75 },
                        { id: "rb_3", title: "Kỹ năng giao tiếp, hợp tác", score: 1.0 },
                        { id: "rb_4", title: "Kỹ năng sử dụng máy tính", score: 0.5 },
                        { id: "rb_5", title: "Kỹ năng giải quyết vấn đề", score: 1.5 },
                      ]
                    : [
                        { id: "cd_1", title: "Tư duy máy tính, tư duy thuật toán", score: 2.0 },
                        { id: "cd_2", title: "Tư duy sáng tạo", score: 0.5 },
                        { id: "cd_3", title: "Kỹ năng giao tiếp, hợp tác", score: 0.5 },
                        { id: "cd_4", title: "Giải quyết vấn đề", score: 1.0 },
                        { id: "cd_5", title: "Kỹ năng sử dụng máy tính", score: 1.0 },
                      ],
                },
              ],
            },
            finalEvaluations: [
              {
                id: `fe_${params.classCode}`,
                title: "Final Evaluation",
                commentAreas: rateAreas,
              },
            ],
          },
        },
      ],
      students: params.students.map((s) => ({ activeInClass: true, student: s })),
      slots,
    });
  }

  seedMockClass({
    lmsClassId: "68a10000000000000000aa13",
    classCode: "VT-ROB-ARMA13",
    isRobotics: true,
    custom9thRateId: "66cbdc2ba0e600ba2dc0493c",
    students: [
      { id: "68a100000000000000000001", fullName: "Nguyễn Bảo Nam" },
      { id: "68a100000000000000000002", fullName: "Trần Gia Huy" },
    ],
  });

  const server = http.createServer(async (req, res) => {
    const rawBody = await readRequestBody(req);

    if (req.url === "/api/v1/resources" && req.method === "POST") {
      resourceUploadCalls++;
      if (forceResourceUploadErrorStatus > 0) {
        res.writeHead(forceResourceUploadErrorStatus, { "content-type": "application/json" });
        res.end(JSON.stringify({ message: "Forced upstream upload outage" }));
        return;
      }
      const bodyStr = rawBody.toString("latin1");
      assert.ok(bodyStr.includes('name="files"'), 'Multipart payload must use field name="files"');
      const m = bodyStr.match(/filename="([^"]+)"/);
      const fname = m ? m[1] : `f_${resourceUploadCalls}.bin`;
      const hash = crypto.createHash("sha256").update(rawBody).digest("hex").slice(0, 8);
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ link: `/uploads/${hash}_${fname}` }));
      return;
    }

    if (req.url === "/graphql" && req.method === "POST") {
      const parsed = JSON.parse(rawBody.toString("utf8") || "{}");
      const op = String(parsed.operationName || "");
      const vars = parsed.variables || {};

      if (op === "GetClassWriteContext" || op === "GetClassById") {
        const cls = mockClassesDb.get(String(vars.id || ""));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: { classesById: cls || null } }));
        return;
      }

      if (op === "FindAllStudentWorks") {
        const cid = String(vars.classId || "");
        let list = studentWorksDb.filter((w) => w.classId === cid && !w.isDeleted);
        if (tamperNextStudentWorkRead) {
          tamperNextStudentWorkRead = false;
          list = list.map((w) => ({
            ...w,
            latestData: { ...w.latestData, title: "TAMPERED TITLE ON SERVER" },
          }));
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: { findAllStudentWorks: { data: list } } }));
        return;
      }

      if (op === "CreateStudentWork") {
        createWorkCalls++;
        if (forceCreateWorkErrorStatus > 0) {
          res.writeHead(forceCreateWorkErrorStatus, { "content-type": "application/json" });
          res.end(JSON.stringify({ message: "Forced CreateStudentWork 502" }));
          return;
        }
        const p = vars.payload;
        const created = {
          id: `work_${studentWorksDb.length + 1}`,
          status: "SUBMITTED",
          studentId: p.studentId,
          classSessionId: p.classSessionId,
          classSessionNumber: p.classSessionNumber,
          classId: p.classId,
          version: 1,
          displayOrder: p.displayOrder ?? 0,
          isDeleted: false,
          latestData: String(p.latestData?.title || "").includes("Xe Tamper")
            ? { ...p.latestData, title: "TAMPERED TITLE ON SERVER" }
            : p.latestData,
        };
        studentWorksDb.push(created);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: { studentWorks: { create: created } } }));
        return;
      }

      if (op === "UpdateStudentWork") {
        updateWorkCalls++;
        lastUpdateWorkPayload = vars.payload;
        const target = studentWorksDb.find((w) => w.id === vars.payload?.id);
        assert.ok(target, `StudentWork ${vars.payload?.id} must exist for UpdateStudentWork`);
        assert.strictEqual(
          Object.prototype.hasOwnProperty.call(vars.payload?.payload || {}, "classSessionNumber"),
          false,
          "UpdateStudentWorkCommand.payload MUST omit classSessionNumber per MindX Z1 schema!"
        );
        target.latestData = vars.payload.payload.latestData;
        target.displayOrder = vars.payload.payload.displayOrder ?? 0;
        target.version = (target.version || 1) + 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: { studentWorks: { update: target } } }));
        return;
      }

      if (op === "DeleteStudentWork") {
        deleteWorkCalls++;
        const target = studentWorksDb.find((w) => w.id === vars.payload?.id);
        if (target) {
          target.isDeleted = true;
          target.status = "DELETED";
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: { studentWorks: { del: { id: vars.payload?.id } } } }));
        return;
      }

      if (op === "UpdateSlotComment") {
        updateSlotCommentCalls++;
        const p = vars.payload;
        lastUpdateSlotCommentPayload = p;
        const cls = mockClassesDb.get(String(p.classId || ""));
        const slot = cls?.slots?.find((s: any) => s._id === p.slotId);
        if (slot) {
          if (p.summary !== undefined) slot.summary = p.summary;
          if (p.homework !== undefined) slot.homework = p.homework;
          if (p.studentComment) {
            const stuAtt = slot.studentAttendance.find(
              (a: any) => a._id === p.studentComment.studentAttendanceId
            );
            if (stuAtt) {
              stuAtt.comment = p.studentComment.content;
              stuAtt.commentByAreas = p.studentComment.byAreas;
            }
          }
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: { classes: { updateSlotComment: cls } } }));
        return;
      }

      if (op === "GetEmailTemplates") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            data: {
              emailTemplates: {
                data: [
                  {
                    id: "tpl_student_letter_01",
                    systemCode: "STUDENT_LETTER",
                    name: "Student Letter",
                    content:
                      "<p>Gửi {{student_name}} ({{class_name}})</p><div>{{learned_from_mindx}}</div><div>{{suggestions_from_mindx}}</div><div>{{future_direction}}</div>",
                    isActive: true,
                  },
                ],
              },
            },
          })
        );
        return;
      }

      if (op === "FindOneByCriteria") {
        const key = `${vars.payload?.classId_equals}:${vars.payload?.studentId_equals}`;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: { findOneByCriteria: lettersDb.get(key) || null } }));
        return;
      }

      if (op === "CreateStudentLetters") {
        createLetterCalls++;
        const p = vars.payload;
        const key = `${p.classId}:${p.studentId}`;
        const rec = {
          id: `ltr_${createLetterCalls}`,
          studentId: p.studentId,
          classId: p.classId,
          status: "DRAFT",
          content: p.content,
          approvedContent: "",
          emailTemplateId: p.emailTemplateId,
          sourceContent: p.sourceContent,
          macros: p.macros,
        };
        lettersDb.set(key, rec);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: { studentLetters: { create: rec } } }));
        return;
      }

      if (op === "UpdateStudentLetters") {
        updateLetterCalls++;
        const p = vars.payload;
        for (const [k, v] of lettersDb.entries()) {
          if (v.id === p.id) {
            v.content = p.content;
            v.macros = p.macros;
            v.sourceContent = p.sourceContent;
            lettersDb.set(k, v);
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ data: { studentLetters: { update: v } } }));
            return;
          }
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ errors: [{ message: "Letter not found" }] }));
        return;
      }
    }

    res.writeHead(404);
    res.end("Not found");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  process.env.MINDX_LMS_RESOURCE_UPLOAD_URL = `${baseUrl}/api/v1/resources`;
  process.env.MINDX_LMS_API_URL = `${baseUrl}/graphql`;

  try {
    const sqliteMod = await import("../src/lib/db/sqlite");
    const scannerMod = await import("../src/lib/local-files/spck-scanner");
    const writeMod = await import("../src/lib/lms/lms-write-client");
    const spckUpMod = await import("../src/lib/playwright/spck-uploader");
    const s14UpMod = await import("../src/lib/playwright/session14-eval-uploader");
    const lmsClassStore = await import("../src/lib/lms/lms-class-id-store");

    const {
      classSessionRepo,
      computeSession14EvalHash,
      computeSpckContentHash,
      formatRoboticsAwardRankingHtmlForLms,
      lmsResourceCacheRepo,
      resolveRoboticsAwardRankGrade,
      session14EvalRepo,
      spckSessionRepo,
      spckUploadRepo,
      studentRepo,
    } = sqliteMod;
    const { scanStudentSpckFolderAsync } = scannerMod;
    const { isLmsApiWriteEnabled, isRecoverableLmsApiWriteError, uploadFileToMindxResources } = writeMod;
    const { SpckUploader } = spckUpMod;
    const { Session14EvalUploader } = s14UpMod;

    // Seed class & sessions 12..14
    const cls = "VT-ROB-ARMA13";
    fs.writeFileSync(
      process.env.MINDX_LMS_CLASS_IDS_PATH!,
      JSON.stringify(
        {
          [cls]: "68a10000000000000000aa13",
          "VT-CSI99": "68a20000000000000000cc99",
          "VT-C4K-PTB99": "68a30000000000000000bb99",
        },
        null,
        2
      ),
      "utf8"
    );
    for (const sn of [12, 13, 14]) {
      classSessionRepo.upsert({
        classId: cls,
        className: cls,
        sessionId: `${cls}_${sn}`,
        sessionNumber: sn,
        date: "2026-11-25",
      });
    }
    const stu1 = { classId: cls, studentId: "68a100000000000000000001", fullName: "Nguyễn Bảo Nam", isActive: 1 };
    const stu2 = { classId: cls, studentId: "68a100000000000000000002", fullName: "Trần Gia Huy", isActive: 1 };
    studentRepo.upsert(stu1);
    studentRepo.upsert(stu2);

    // -----------------------------------------------------------------------
    // [ROB389-01] Robotics Scanner (`1A`): portrait thumb separation, 0 photos valid, native files
    // -----------------------------------------------------------------------
    console.log("\n[ROB389-01] Kiểm tra scanner Robotics (tách chân dung Thumbnail, 0 ảnh Robot hợp lệ, file gốc .iqblocks/.v5python/.ino)...");
    const namDir = path.join(spckRoot, cls, "Nguyễn Bảo Nam");
    const ownerUploadsDir = path.join(namDir, "_spck_owner_uploads");
    fs.mkdirSync(ownerUploadsDir, { recursive: true });
    const portraitPath = path.join(ownerUploadsDir, "chan_dung_nam.png");
    fs.writeFileSync(portraitPath, MINIMAL_1X1_PNG);
    const iqFile = path.join(namDir, "XeTuHanh.iqblocks");
    const v5PyFile = path.join(namDir, "arm_controller.v5python");
    const inoFile = path.join(namDir, "sensor_read.ino");
    const ev3File = path.join(namDir, "legacy_bot.ev3");
    fs.writeFileSync(iqFile, '{"blocks":true}', "utf8");
    fs.writeFileSync(v5PyFile, "import vex\nprint('ok')\n", "utf8");
    fs.writeFileSync(inoFile, "void setup() {}\nvoid loop() {}\n", "utf8");
    const ev3Zip = new AdmZip();
    ev3Zip.addFile("Project.lvprojx", Buffer.from("<Project/>", "utf8"));
    fs.writeFileSync(ev3File, ev3Zip.toBuffer());

    for (const sn of [12, 13, 14] as const) {
      const scanned = await scanStudentSpckFolderAsync(namDir, "Nguyễn Bảo Nam", {
        classId: cls,
        isRobotics: true,
        allowStreamlitAutoRender: true,
      });
      assert.strictEqual(path.resolve(scanned.thumbnailPath), path.resolve(portraitPath), "Thumbnail phải là ảnh chân dung!");
      assert.deepStrictEqual(scanned.screenshots, [], `Buổi ${sn} Robotics không có ảnh Robot thì screenshots phải là [] (không nhét chân dung vào!)`);
      assert.strictEqual(
        scanned.warnings.some((w) => /ảnh|screenshot|thumbnail/i.test(w)),
        false,
        `Buổi ${sn} Robotics 0 ảnh Robot KHÔNG được cảnh báo thiếu ảnh!`
      );
      const attBases = scanned.attachments.map((p) => path.basename(p));
      assert.ok(attBases.includes("XeTuHanh.iqblocks"), ".iqblocks phải giữ nguyên không bọc _robotics_package.zip");
      assert.ok(attBases.includes("arm_controller.v5python"), ".v5python phải giữ nguyên");
      assert.ok(attBases.includes("sensor_read.ino"), ".ino phải giữ nguyên");
      assert.ok(
        attBases.some((b) => b.endsWith("_robotics_package.zip")),
        ".ev3 không hỗ trợ trực tiếp vẫn phải đóng gói vào _robotics_package.zip"
      );
    }
    // Sub-case 1d (F04): `_spck_owner_uploads/owner_*.png` teacher-uploaded robot gallery photos must stay in gallery and NOT steal Thumbnail *
    const ownerGalleryRobDir = path.join(spckRoot, "VT-ROB-ARMA13", "OwnerGalleryOnly");
    const ownerGalleryUploadsDir = path.join(ownerGalleryRobDir, "_spck_owner_uploads");
    fs.mkdirSync(ownerGalleryUploadsDir, { recursive: true });
    fs.copyFileSync(
      path.join(process.cwd(), "data", "config", "default-spck-thumbnail.png"),
      path.join(ownerGalleryUploadsDir, "owner_17325_0_robot_car.png")
    );
    const pkgOwnerGallery = await scanStudentSpckFolderAsync(ownerGalleryRobDir, "Phạm Minh Đức", {
      classId: "VT-ROB-ARMA13",
      isRobotics: true,
    });
    assert.ok(
      pkgOwnerGallery.thumbnailPath.endsWith("default-spck-thumbnail.png"),
      `F04: owner_* gallery photo KHÔNG được chiếm mất Thumbnail * (phải fallback Logo MindX)! Thực tế=${pkgOwnerGallery.thumbnailPath}`
    );
    assert.ok(
      pkgOwnerGallery.screenshots.some((p) => path.basename(p) === "owner_17325_0_robot_car.png"),
      `F04: owner_* robot photo trong _spck_owner_uploads phải được giữ lại trong screenshots gallery!`
    );

    console.log("  -> PASS ROB389-01.");

    // -----------------------------------------------------------------------
    // [ROB389-02] Numeric 0..5 Rank Grade, 3-bullet HTML helper & hash compatibility
    // -----------------------------------------------------------------------
    console.log("\n[ROB389-02] Kiểm tra resolveRoboticsAwardRankGrade (0..5), HTML 3 gạch & hash tương thích ngược...");
    assert.strictEqual(resolveRoboticsAwardRankGrade({ awardRank: 1, demoTotalScore: 4.5 }), 1);
    assert.strictEqual(resolveRoboticsAwardRankGrade({ awardRank: 2, demoTotalScore: 4.0 }), 2);
    assert.strictEqual(resolveRoboticsAwardRankGrade({ awardRank: 3, demoTotalScore: 3.5 }), 3);
    assert.strictEqual(resolveRoboticsAwardRankGrade({ awardRank: 4, demoTotalScore: 3.0 }), 5);
    assert.strictEqual(resolveRoboticsAwardRankGrade({ isAbsent: true, demoTotalScore: 0 }), 0);
    assert.strictEqual(
      resolveRoboticsAwardRankGrade({ manualGrade: 2, awardRank: 1, demoTotalScore: 4.5 }),
      2,
      "Chỉnh tay manualGrade=2 phải ưu tiên cao nhất!"
    );

    const autoHtml = formatRoboticsAwardRankingHtmlForLms({
      awardRanking: "Giải Nhất (4.25/5.0 điểm)",
      demoScores: { algorithm: 1.25, creativity: 0.75, communication: 1.0, computerSkills: 0.5, problemSolving: 0.75 },
      demoTotalScore: 4.25,
      demoJudgeNote: "Cơ cấu tay kẹp chắc chắn",
    });
    assert.ok(autoHtml.includes("Điểm mạnh của học viên:"));
    assert.ok(autoHtml.includes("Điểm cần cải thiện:"));
    assert.ok(autoHtml.includes("Lời khuyên:"));

    // Backward hash invariant when awardRankGrade is null vs undefined
    const hUndefined = computeSession14EvalHash({
      classId: "VT-CSI02",
      studentId: "S1",
      learnedFromMindx: "- **Điểm Demo:** 4 điểm\n- **Điểm Năng lực:** 4 điểm\nTot",
      suggestionsFromMindx: "Can ren",
      futureDirection: "Tiep tuc",
      awardRanking: "",
      awardRankGrade: undefined,
    });
    const hNull = computeSession14EvalHash({
      classId: "VT-CSI02",
      studentId: "S1",
      learnedFromMindx: "- **Điểm Demo:** 4 điểm\n- **Điểm Năng lực:** 4 điểm\nTot",
      suggestionsFromMindx: "Can ren",
      futureDirection: "Tiep tuc",
      awardRanking: "",
      awardRankGrade: null,
    });
    assert.strictEqual(hUndefined, hNull, "awardRankGrade=null phải cho cùng SHA-256 với undefined!");
    console.log("  -> PASS ROB389-02.");

    // -----------------------------------------------------------------------
    // [API389-03] uploadFileToMindxResources + SHA-256 cache + Path Allowlist
    // -----------------------------------------------------------------------
    console.log("\n[API389-03] Kiểm tra Upload CDN Resources, SHA-256 Cache 0-hit lần 2 & chặn Path Allowlist...");
    const up1 = await uploadFileToMindxResources(iqFile);
    assert.strictEqual(up1.fromCache, false);
    assert.ok(up1.url.startsWith(`${baseUrl}/uploads/`));
    const callsAfterFirst = resourceUploadCalls;
    const up2 = await uploadFileToMindxResources(iqFile);
    assert.strictEqual(up2.fromCache, true);
    assert.strictEqual(up2.url, up1.url);
    assert.strictEqual(resourceUploadCalls, callsAfterFirst, "Lần upload thứ 2 cùng SHA-256 bắt buộc phải đánh cache (0 HTTP call)!");

    const outsideSecretFile = path.join(os.tmpdir(), `outside_secret_${Date.now()}.txt`);
    fs.writeFileSync(outsideSecretFile, "secret", "utf8");
    try {
      await assert.rejects(
        () => uploadFileToMindxResources(outsideSecretFile),
        /allowlist|Không được phép/i
      );
    } finally {
      fs.unlinkSync(outsideSecretFile);
    }
    console.log("  -> PASS API389-03.");

    // -----------------------------------------------------------------------
    // [API389-04] 3-Session Isolation, Overwrite Item 01, Prune Duplicate Item 02, Fast-skip, Clear & Tamper Fail-closed
    // -----------------------------------------------------------------------
    console.log("\n[API389-04] Kiểm tra API Write SPCK đa buổi (Create, Overwrite Item 01, Dọn Item 02, Fast-skip, Clear & Tamper Check)...");
    process.env.MINDX_LMS_API_WRITE = "true";

    const approveStudentSession = (sn: 12 | 13, title: string, comment: string) => {
      const formattedTitle = `${title} (Buổi ${sn})`;
      const baseRec = {
        classId: cls,
        studentId: stu1.studentId,
        localFolderPath: namDir,
        matchScore: 1.0,
        isConfirmedByTeacher: 1,
        projectTitle: formattedTitle,
        baseProjectTitle: title,
        thumbnailPath: portraitPath,
        screenshotsJson: "[]",
        attachmentsJson: JSON.stringify([iqFile, v5PyFile]),
        youtubeUrlsJson: "[]",
        relatedLinksJson: "[]",
        teacherComment: comment,
        contentHash: "",
        status: "APPROVED" as const,
        approvedSessionNumber: sn,
      };
      const hash = computeSpckContentHash({
        ...baseRec,
        screenshotsJson: "[]",
        attachmentsJson: JSON.stringify([iqFile, v5PyFile]),
        youtubeUrlsJson: "[]",
        relatedLinksJson: "[]",
      });
      spckUploadRepo.upsert({ ...baseRec, contentHash: hash });
      spckSessionRepo.saveSessionDraft({
        classId: cls,
        studentId: stu1.studentId,
        sessionNumber: sn,
        localFolderPath: namDir,
        isConfirmedByTeacher: 1,
        projectTitle: formattedTitle,
        thumbnailPath: portraitPath,
        screenshotsJson: "[]",
        attachmentsJson: JSON.stringify([iqFile, v5PyFile]),
        youtubeUrlsJson: "[]",
        relatedLinksJson: "[]",
        teacherComment: comment,
        draftStatus: "APPROVED",
      });
      const apRes = spckSessionRepo.approveSessionDraft(cls, stu1.studentId, sn);
      assert.strictEqual(apRes.success, true, apRes.reason || "approveSessionDraft must succeed");
    };

    // 1) Session 12 -> CreateStudentWork
    approveStudentSession(12, "Xe Tự Hành V1", "- **Điểm mạnh:** Lắp ráp tốt Buổi 12.\n- **Điểm cần cải thiện:** Test thêm.\n- **Lời khuyên:** Cố gắng.");
    const s12CreateRes = await SpckUploader.uploadApprovedSpck({ classId: cls, sessionNumber: 12 });
    assert.strictEqual(s12CreateRes.verifiedCount, 1);
    assert.strictEqual(s12CreateRes.results[0].clickedAddSpckButton, true);
    assert.strictEqual(createWorkCalls, 1);

    // 2) Session 13 -> CreateStudentWork (separate slot!)
    approveStudentSession(13, "Xe Tự Hành V2", "- **Điểm mạnh:** Hoàn thiện Buổi 13.\n- **Điểm cần cải thiện:** Thuyết trình to.\n- **Lời khuyên:** Giỏi.");
    const s13CreateRes = await SpckUploader.uploadApprovedSpck({ classId: cls, sessionNumber: 13 });
    assert.strictEqual(s13CreateRes.verifiedCount, 1);
    assert.strictEqual(createWorkCalls, 2);

    // Inject stray duplicate Item 02 on Session 12 ONLY
    studentWorksDb.push({
      id: "work_dup_s12",
      status: "SUBMITTED",
      studentId: stu1.studentId,
      classSessionId: "68a10000000000000000aa13_slot_12",
      classSessionNumber: 12,
      classId: "68a10000000000000000aa13",
      displayOrder: 1,
      isDeleted: false,
      latestData: { title: "Duplicate Card 02", comment: "dup", thumbnail: "", videoUrls: [], imageUrl: [], attachmentUrls: [], relatedUrls: [] },
    });

    // 3) Re-approve & overwrite Session 12 -> MUST call UpdateStudentWork on Item 01 + DeleteStudentWork on duplicate Item 02, WITHOUT touching Session 13!
    approveStudentSession(12, "Xe Tự Hành V1 Sửa", "- **Điểm mạnh:** Đã cập nhật Buổi 12.\n- **Điểm cần cải thiện:** Đọc kỹ đề.\n- **Lời khuyên:** Tốt.");
    const s12UpdRes = await SpckUploader.uploadApprovedSpck({ classId: cls, sessionNumber: 12 });
    assert.strictEqual(s12UpdRes.verifiedCount, 1);
    assert.strictEqual(s12UpdRes.results[0].reusedExistingItem01, true);
    assert.strictEqual(updateWorkCalls, 1);
    assert.strictEqual(deleteWorkCalls, 1);
    assert.ok(lastUpdateWorkPayload?.id === "work_1", "Phải ghi đè đúng lên Item 01!");
    assert.strictEqual(
      studentWorksDb.some((w) => w.classSessionId === "68a10000000000000000aa13_slot_13" && !w.isDeleted && w.latestData.title.includes("Xe Tự Hành V2")),
      true,
      "Ghi đè Buổi 12 tuyệt đối không được chạm vào Buổi 13!"
    );

    // 4) Re-upload identical Session 12 -> fast-skip (`updateWorkCalls` stays 1!)
    approveStudentSession(12, "Xe Tự Hành V1 Sửa", "- **Điểm mạnh:** Đã cập nhật Buổi 12.\n- **Điểm cần cải thiện:** Đọc kỹ đề.\n- **Lời khuyên:** Tốt.");
    const s12FastRes = await SpckUploader.uploadApprovedSpck({ classId: cls, sessionNumber: 12 });
    assert.strictEqual(s12FastRes.verifiedCount, 1);
    assert.strictEqual(updateWorkCalls, 1, "Nội dung y hệt phải fast-skip 0 mutation!");

    // 5) Clear Session 12 only -> Session 13 must remain!
    await SpckUploader.clearSessionSpck({ classId: cls, sessionNumber: 12, studentIds: [stu1.studentId] });
    assert.strictEqual(
      studentWorksDb.filter((w) => w.classSessionId === "68a10000000000000000aa13_slot_12" && !w.isDeleted).length,
      0,
      "Buổi 12 phải bị xóa sạch!"
    );
    assert.strictEqual(
      studentWorksDb.filter((w) => w.classSessionId === "68a10000000000000000aa13_slot_13" && !w.isDeleted).length,
      1,
      "Xóa Buổi 12 KHÔNG được xóa Buổi 13!"
    );

    // 6) Read-after-Write tamper failure -> MUST mark FAILED (never VERIFIED)
    approveStudentSession(12, "Xe Tamper", "- **Điểm mạnh:** Tốt.\n- **Điểm cần cải thiện:** Cố thêm.\n- **Lời khuyên:** Tiếp tục.");
    tamperNextStudentWorkRead = true;
    const tamperRes = await SpckUploader.uploadApprovedSpck({ classId: cls, sessionNumber: 12 });
    assert.strictEqual(tamperRes.verifiedCount, 0);
    assert.strictEqual(tamperRes.failedCount, 1);
    assert.strictEqual(tamperRes.results[0].status, "FAILED");
    console.log("  -> PASS API389-04.");

    // -----------------------------------------------------------------------
    // [API389-05] Session 14 Eval Robotics (`ARMA13` dynamic 9th ID, `665e8440181e0e47f6c654c1`, APPROVED letter guard)
    // -----------------------------------------------------------------------
    console.log("\n[API389-05] Kiểm tra uploadSession14EvalViaApi Robotics (ID ĐNL #9 tuỳ biến, Xếp hạng số 0..5 + HTML, và khóa StudentLetter APPROVED)...");
    session14EvalRepo.saveDraft({
      classId: cls,
      studentId: stu1.studentId,
      competencyScores: {
        knowledgeInClass: 5,
        knowledgeSelfStudy: 5,
        skillCommunication: 4,
        skillComputerUse: 5,
        skillProblemSolving: 4,
        skillCreativity: 5,
        skillComputational: 5,
        attitudeHomework: 4,
        attitudeInClass: 5,
      },
      demoScores: {
        algorithm: 1.25,
        creativity: 0.75,
        communication: 1.0,
        computerSkills: 0.5,
        problemSolving: 1.25,
      },
      learnedFromMindx: "- **Điểm Demo:** 4.75 điểm\n- **Điểm Năng lực:** 4.67 điểm\nCon hoàn thành tốt.",
      suggestionsFromMindx: "Con cần luyện thêm thuyết trình.",
      futureDirection: "Tiếp tục Robotics ARM.",
      awardRanking: "Giải Nhất (4.75/5.0 điểm)",
      awardRankGrade: 1,
    });
    assert.strictEqual(session14EvalRepo.approveDraft(cls, stu1.studentId).success, true);

    // Pre-lock stu2 letter as APPROVED on LMS server to test guard!
    session14EvalRepo.saveDraft({
      classId: cls,
      studentId: stu2.studentId,
      demoScores: { algorithm: 1.0, creativity: 0.5, communication: 0.75, computerSkills: 0.5, problemSolving: 1.0 },
      learnedFromMindx: "- **Điểm Demo:** 3.75 điểm\n- **Điểm Năng lực:** 4 điểm\nCon chăm chỉ.",
      suggestionsFromMindx: "Rèn thêm thuật toán.",
      futureDirection: "Lên lớp tiếp theo.",
      awardRanking: "Giải Nhì (3.75/5.0 điểm)",
      awardRankGrade: 2,
    });
    assert.strictEqual(session14EvalRepo.approveDraft(cls, stu2.studentId).success, true);
    lettersDb.set(`68a10000000000000000aa13:${stu2.studentId}`, {
      id: "ltr_locked_s2",
      studentId: stu2.studentId,
      classId: "68a10000000000000000aa13",
      status: "APPROVED",
      content: "<p>Thư quản lý đã duyệt khóa</p>",
      approvedContent: "<p>Thư quản lý đã duyệt khóa</p>",
      emailTemplateId: "tpl_student_letter_01",
      sourceContent: "",
      macros: [],
    });

    const s14Res: any = await Session14EvalUploader.uploadApprovedEvaluations({
      classId: cls,
      classSummaryHtml: "<p>Tổng kết Buổi 14 lớp Robotics ARMA13 xuất sắc</p>",
      uploadClassSummary: true,
    });
    assert.strictEqual(s14Res.classSummaryVerified, true, "Summary Buổi 14 phải VERIFIED");
    assert.strictEqual(s14Res.verifiedCount, 2, `Cả 2 học viên phải VERIFIED, thực tế=${s14Res.verifiedCount}`);
    assert.strictEqual(createLetterCalls, 1, "Chỉ tạo studentLetter cho stu1 (stu2 bị khóa APPROVED không được ghi đè!)");
    assert.strictEqual(updateLetterCalls, 0, "stu2 có studentLetter APPROVED nên cấm gọi UpdateStudentLetters!");
    assert.ok(
      Array.isArray(s14Res.warnings) && s14Res.warnings.some((w: string) => w.includes("APPROVED")),
      "Phải ghi nhận cảnh báo không ghi đè thư APPROVED của quản lý!"
    );

    const verifiedSlot14 = mockClassesDb.get("68a10000000000000000aa13")!.slots[13];
    const stu1Att = verifiedSlot14.studentAttendance.find((a: any) => a.student.id === stu1.studentId);
    const custom9Area = stu1Att.commentByAreas.find((a: any) => a.commentAreaId === "66cbdc2ba0e600ba2dc0493c");
    assert.ok(custom9Area && custom9Area.grade === 5, "Phải điền đúng điểm attitudeInClass=5 vào ID thứ 9 tuỳ biến của ARMA13!");
    const awardArea = stu1Att.commentByAreas.find((a: any) => a.commentAreaId === "665e8440181e0e47f6c654c1");
    assert.ok(awardArea && awardArea.grade === 1, "Mục Xếp hạng Robotics phải mang grade=1 (Giải Nhất)!");
    assert.ok(String(awardArea.content || "").includes("Điểm mạnh của học viên:"));
    assert.ok(verifiedSlot14.homework.includes("Homework Buổi 14"), "Không được làm mất trường homework khi cập nhật Summary!");
    console.log("  -> PASS API389-05.");

    // -----------------------------------------------------------------------
    // [API389-06] Kill-switch MINDX_LMS_API_WRITE=false & Fallback Playwright vs Fail-closed
    // -----------------------------------------------------------------------
    console.log("\n[API389-06] Kiểm tra công tắc MINDX_LMS_API_WRITE=false & Fallback sang Playwright khi API upload lỗi 502...");
    process.env.MINDX_LMS_API_WRITE = "false";
    assert.strictEqual(isLmsApiWriteEnabled(), false, "MINDX_LMS_API_WRITE=false phải tắt API Write!");
    assert.strictEqual(isLmsApiWriteEnabled({ forcePlaywright: true }), false);

    assert.strictEqual(
      isRecoverableLmsApiWriteError(new Error("Score Cap: vượt quá trần tối đa")),
      false,
      "Lỗi vượt trần điểm cấm fallback im lặng sang Playwright!"
    );
    assert.strictEqual(
      isRecoverableLmsApiWriteError(new Error("Upstream HTTP 502 Bad Gateway")),
      true,
      "Lỗi HTTP 502 hạ tầng phải cho phép fallback sang Playwright!"
    );

    process.env.MINDX_LMS_API_WRITE = "true";
    // Test automatic fallback to Playwright when /api/v1/resources throws HTTP 502 BEFORE any mutation!
    const fallbackImgPath = path.join(ownerUploadsDir, "fallback_test.png");
    fs.copyFileSync(
      path.join(process.cwd(), "data", "config", "default-spck-thumbnail.png"),
      fallbackImgPath
    );
    const fallbackHash = computeSpckContentHash({
      classId: cls,
      studentId: stu2.studentId,
      localFolderPath: path.join(spckRoot, cls, "Trần Gia Huy"),
      projectTitle: "Robot Fallback (Buổi 12)",
      thumbnailPath: fallbackImgPath,
      screenshotsJson: "[]",
      attachmentsJson: "[]",
      youtubeUrlsJson: "[]",
      relatedLinksJson: "[]",
      teacherComment: "Tốt",
    });
    fs.mkdirSync(path.join(spckRoot, cls, "Trần Gia Huy"), { recursive: true });
    spckUploadRepo.upsert({
      classId: cls,
      studentId: stu2.studentId,
      localFolderPath: path.join(spckRoot, cls, "Trần Gia Huy"),
      matchScore: 1,
      isConfirmedByTeacher: 1,
      projectTitle: "Robot Fallback (Buổi 12)",
      baseProjectTitle: "Robot Fallback",
      thumbnailPath: fallbackImgPath,
      screenshotsJson: "[]",
      attachmentsJson: "[]",
      youtubeUrlsJson: "[]",
      relatedLinksJson: "[]",
      teacherComment: "Tốt",
      contentHash: fallbackHash,
      status: "APPROVED",
      approvedSessionNumber: 12,
    });
    spckSessionRepo.saveSessionDraft({
      classId: cls,
      studentId: stu2.studentId,
      sessionNumber: 12,
      localFolderPath: path.join(spckRoot, cls, "Trần Gia Huy"),
      isConfirmedByTeacher: 1,
      projectTitle: "Robot Fallback (Buổi 12)",
      thumbnailPath: fallbackImgPath,
      screenshotsJson: "[]",
      attachmentsJson: "[]",
      youtubeUrlsJson: "[]",
      relatedLinksJson: "[]",
      teacherComment: "Tốt",
      draftStatus: "APPROVED",
    });
    assert.strictEqual(spckSessionRepo.approveSessionDraft(cls, stu2.studentId, 12).success, true);

    forceResourceUploadErrorStatus = 502;
    const fakeCustomPageForFallback: any = {};

    const fbRes = await SpckUploader.uploadApprovedSpck({
      classId: cls,
      sessionNumber: 12,
      studentIds: [stu2.studentId],
      customPage: fakeCustomPageForFallback,
      skipNavigation: true,
      preferApiWrite: true,
    });
    forceResourceUploadErrorStatus = 0;
    const fallbackLogs = sqliteMod
      .getDb()
      .prepare(`SELECT message FROM job_logs WHERE classId = ? AND message LIKE '%Fallback Playwright%'`)
      .all(cls) as Array<{ message: string }>;
    assert.ok(
      fallbackLogs.length >= 1,
      "Bắt buộc phải ghi log WARN '[LMS API Write -> Fallback Playwright]' khi API lỗi 502!"
    );
    assert.strictEqual(
      typeof fakeCustomPageForFallback.waitForResponse === "function",
      true,
      "Khi upload API gặp HTTP 502 trước lúc lưu, bắt buộc phải đi qua nhánh Playwright fallback!"
    );
    assert.strictEqual(
      fbRes.verifiedCount,
      1,
      `Nhánh Playwright fallback (synthetic stub) phải hoàn tất xác minh cho stu2, thực tế=${JSON.stringify(fbRes.results)}`
    );

    // [API389-07] F02 (Coding CONTENT guard & PTB/CSB exempt), F03 (502 CreateStudentWork -> Playwright fallback), F08 ($& in StudentLetter)
    // 1) F03: Force HTTP 502 on CreateStudentWork (not just resource CDN) -> must STILL trigger Playwright fallback!
    const fallback502WorkFolder = path.join(spckRoot, cls, "Tran_502_Work");
    fs.mkdirSync(fallback502WorkFolder, { recursive: true });
    spckUploadRepo.upsert({
      classId: cls,
      studentId: stu2.studentId,
      localFolderPath: fallback502WorkFolder,
      matchScore: 1,
      isConfirmedByTeacher: 1,
      projectTitle: "Robot Retry 502 (Buổi 13)",
      baseProjectTitle: "Robot Retry 502",
      thumbnailPath: fallbackImgPath,
      screenshotsJson: "[]",
      attachmentsJson: "[]",
      youtubeUrlsJson: "[]",
      relatedLinksJson: "[]",
      teacherComment: "Tốt",
      contentHash: "",
      status: "APPROVED",
      approvedSessionNumber: 13,
    });
    spckSessionRepo.saveSessionDraft({
      classId: cls,
      studentId: stu2.studentId,
      sessionNumber: 13,
      localFolderPath: fallback502WorkFolder,
      isConfirmedByTeacher: 1,
      projectTitle: "Robot Retry 502 (Buổi 13)",
      thumbnailPath: fallbackImgPath,
      screenshotsJson: "[]",
      attachmentsJson: "[]",
      youtubeUrlsJson: "[]",
      relatedLinksJson: "[]",
      teacherComment: "Tốt",
      draftStatus: "WAITING_APPROVAL",
    });
    assert.strictEqual(spckSessionRepo.approveSessionDraft(cls, stu2.studentId, 13).success, true);

    forceCreateWorkErrorStatus = 502;
    const fakePageCreate502: any = {};
    const fbWork502Res = await SpckUploader.uploadApprovedSpck({
      classId: cls,
      sessionNumber: 13,
      studentIds: [stu2.studentId],
      customPage: fakePageCreate502,
      skipNavigation: true,
      preferApiWrite: true,
    });
    forceCreateWorkErrorStatus = 0;
    assert.strictEqual(
      typeof fakePageCreate502.waitForResponse === "function",
      true,
      "F03: Lỗi HTTP 502 ngay ở CreateStudentWork đầu tiên phải kích hoạt Playwright fallback!"
    );
    assert.strictEqual(fbWork502Res.verifiedCount, 1);

    // 2) F02 + F08: Coding class CSI99 (no Robotics wording in CONTENT + preserve "$&" / "$$50" in StudentLetter) & SPCK-exempt PTB99
    const csiCls = "VT-CSI99";
    const csiLmsId = "68a20000000000000000cc99";
    seedMockClass({
      lmsClassId: csiLmsId,
      classCode: csiCls,
      isRobotics: false,
      students: [{ id: "68a20000000000000000c001", fullName: "Lê Quang Vinh" }],
    });
    const csiDoc = mockClassesDb.get(csiLmsId)!;
    // Add an unrelated Coding CONTENT area on LMS to ensure API write does NOT pollute it with Robotics criteria/1.25!
    csiDoc.courseProcesses[0].finalSession.finalEvaluations[0].commentAreas.push({
      id: "66000000000000000000c999",
      name: "Ghi chú thêm Coding",
      type: "CONTENT",
    });
    sqliteMod.studentRepo.upsert({
      classId: csiCls,
      studentId: "68a20000000000000000c001",
      fullName: "Lê Quang Vinh",
      isActive: 1,
    });
    session14EvalRepo.saveDraft({
      classId: csiCls,
      studentId: "68a20000000000000000c001",
      demoScores: { algorithm: 1.5, creativity: 0.5, communication: 0.5, computerSkills: 0.75, problemSolving: 0.75 },
      learnedFromMindx: "- **Điểm Demo:** 4.0 điểm\n- **Điểm Năng lực:** 4.0 điểm\nCon xử lý chuỗi $& và $$50 chính xác.",
      suggestionsFromMindx: "Tiếp tục rèn luyện.",
      futureDirection: "Phát triển sản phẩm Web/AI.",
    });
    assert.strictEqual(session14EvalRepo.approveDraft(csiCls, "68a20000000000000000c001").success, true);

    lastUpdateSlotCommentPayload = null;
    const csiEvalOut: any = await Session14EvalUploader.uploadApprovedEvaluations({
      classId: csiCls,
      studentIds: ["68a20000000000000000c001"],
      uploadClassSummary: false,
    });
    assert.strictEqual(csiEvalOut.verifiedCount, 1);
    const csiContentSent = (lastUpdateSlotCommentPayload?.studentComment?.byAreas || []).find(
      (a: any) => String(a?.type || "").toUpperCase() === "CONTENT"
    );
    assert.strictEqual(csiContentSent, undefined, "F02: Lớp Coding KHÔNG được tự ghi Robotics wording/maxes vào vùng CONTENT!");
    const vCsiLetter = lettersDb.get(`${csiLmsId}:68a20000000000000000c001`);
    assert.ok(
      vCsiLetter && vCsiLetter.content.includes("$&amp;") && vCsiLetter.content.includes("$$50"),
      `F08: '$&' và '$$50' trong StudentLetter phải giữ nguyên vẹn không bị String.replace corrupt! content=${vCsiLetter?.content}`
    );

    const ptbCls = "VT-C4K-PTB99";
    const ptbLmsId = "68a30000000000000000bb99";
    seedMockClass({
      lmsClassId: ptbLmsId,
      classCode: ptbCls,
      isRobotics: false,
      students: [{ id: "68a30000000000000000b001", fullName: "Ngô Minh Khôi" }],
    });
    mockClassesDb.get(ptbLmsId)!.courseProcesses[0].finalSession.demoScore = null;
    sqliteMod.studentRepo.upsert({
      classId: ptbCls,
      studentId: "68a30000000000000000b001",
      fullName: "Ngô Minh Khôi",
      isActive: 1,
    });
    session14EvalRepo.saveDraft({
      classId: ptbCls,
      studentId: "68a30000000000000000b001",
      demoScores: { algorithm: 0, creativity: 0, communication: 0, computerSkills: 0, problemSolving: 0 },
      learnedFromMindx: "- **Điểm Demo:** 0 điểm\n- **Điểm Năng lực:** 4 điểm\nCon hoàn thành tốt khóa Python Basic.",
      suggestionsFromMindx: "Giữ vững tinh thần.",
      futureDirection: "Tiếp tục PTA.",
    });
    assert.strictEqual(session14EvalRepo.approveDraft(ptbCls, "68a30000000000000000b001").success, true);
    const ptbOut: any = await Session14EvalUploader.uploadApprovedEvaluations({
      classId: ptbCls,
      studentIds: ["68a30000000000000000b001"],
      uploadClassSummary: false,
    });
    assert.strictEqual(ptbOut.verifiedCount, 1, "F02: Lớp miễn SPCK (PTB/CSB) không có vùng DEMO phải VERIFIED thành công qua API Write!");

    console.log("  -> PASS API389-06 & API389-07!");
    console.log("\nALL PART 2 v3.8.9 ROBOTICS SPCK & LMS WRITE API TESTS PASSED!");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      const sMod = await import("../src/lib/db/sqlite");
      sMod.getDb?.().close?.();
    } catch {}
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {}
  }
}

main().catch((err) => {
  console.error("TEST PART 2 V3.8.9 FAILED:", err);
  process.exit(1);
});
