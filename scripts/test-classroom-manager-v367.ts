/**
 * KIỂM THỬ TOÀN DIỆN v3.6.7 — TRANG QUẢN LÝ GIỜ HỌC (/classroom-manager)
 *
 * Bao phủ:
 * - [CM-01] Local-Only Guard (403 cho IP lạ / cross-site / bad Origin) & Input Validation (400)
 * - [CM-02] Giữ nguyên Sao/Huy hiệu khi đếm 6 lỗi ⚠️, đồng bộ 2 chiều Đi muộn, khóa Vắng mặt, chống ghi đè expectedRowVer
 * - [CM-03] Bảng Chiếu lớp học hàng ngang (Vắng xuống cuối, ẩn 100% lỗi/ghi chú) & Tích lũy 14 buổi
 * - [CM-04] Áp dụng sang Nhận xét (Coding & Robotics), câu mặc định cho bạn ngoan 0 lỗi, bảo vệ VERIFIED/SAVING,
 *           hạ APPROVED -> DRAFT + tăng field ver, và luồng Buổi 14 sang /final-project
 * - [CM-05] E2E trình duyệt Chromium thật (127.0.0.1:3097, Sáng & Tối, 1280x800 & 1440x900)
 *           kiểm tra contrast WCAG AA, 0 console/page error, 0 rò rỉ trên Chiếu lớp học, và chuyển sang /session-comments
 *
 * Chạy 100% cô lập trong `os.tmpdir()` — KHÔNG bao giờ chạm dữ liệu thật trong `data/`.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import type { ClassroomStudentState } from "../src/lib/classroom/classroom-manager-helpers";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttpReady(url: string, timeoutMs = 45000): Promise<void> {
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
  throw new Error(`Hết thời gian chờ máy chủ kiểm thử tại ${url}: ${lastErr}`);
}

function killProcessTree(proc: ChildProcess | null) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/F", "/T", "/PID", String(proc.pid)], {
        stdio: "ignore",
      });
    } else {
      proc.kill("SIGKILL");
    }
  } catch {}
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-cm-v367-"));
  const tmpConfigDir = path.join(tmpRoot, "config");
  const tmpDbPath = path.join(tmpRoot, "test_cm_v367.db");
  const tmpRunningClassesPath = path.join(tmpRoot, "running_classes.json");
  fs.mkdirSync(tmpConfigDir, { recursive: true });

  // Copy syllabus & quick_tags configs into temp dir
  const realConfigDir = path.join(process.cwd(), "data", "config");
  for (const cfgFile of ["courses_syllabus.json", "quick_tags.json"]) {
    const srcPath = path.join(realConfigDir, cfgFile);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, path.join(tmpConfigDir, cfgFile));
    }
  }

  // Isolate BEFORE importing server/DB modules
  process.env.ALLOWED_LOCAL_DIRS = tmpRoot;
  process.env.MINDX_ALLOWED_EXTRA_PATHS = tmpRoot;
  process.env.MINDX_DB_PATH = tmpDbPath;
  process.env.MINDX_CONFIG_DIR = tmpConfigDir;
  process.env.MINDX_RUNNING_CLASSES_PATH = tmpRunningClassesPath;

  const {
    calculateSha256,
    classSessionRepo,
    classroomSessionLogRepo,
    closeDb,
    session14EvalRepo,
    sessionFeedbackRepo,
    studentRepo,
  } = await import("../src/lib/db/sqlite");
  const { saveRunningClasses } = await import("../src/lib/db/json-config");
  const {
    applyAttendanceToggle,
    applyIssueAction,
    applyManualStarDelta,
    applyPraiseAction,
    buildClassroomToCommentMapping,
    computeClassroomSessionSummary,
    computeCourseAccumulationSummary,
    rankStudentsForProjector,
  } = await import("../src/lib/classroom/classroom-manager-helpers");
  const { GET: stateGET } = await import("../src/app/api/classroom-manager/state/route");
  const { POST: savePOST } = await import("../src/app/api/classroom-manager/save/route");
  const { POST: applyPOST } = await import(
    "../src/app/api/classroom-manager/apply-to-comments/route"
  );

  let nextServer: ChildProcess | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  const serverLogs: string[] = [];
  const nextEnvPath = path.join(process.cwd(), "next-env.d.ts");
  const origNextEnvDts = fs.existsSync(nextEnvPath) ? fs.readFileSync(nextEnvPath) : null;
  const testPort = 3097;
  const e2eDistRel = `.next/e2e-test-${testPort}`;
  const e2eDistAbs = path.join(process.cwd(), e2eDistRel);
  const e2eTsconfigRel = `.next/e2e-tsconfig-${testPort}.json`;
  const e2eTsconfigAbs = path.join(process.cwd(), e2eTsconfigRel);

  try {
    console.log("🚀 BẮT ĐẦU KIỂM THỬ v3.6.7 (Khu vực cô lập):", tmpRoot);

    const codingClassId = "VT-C4K-PTA99";
    const roboticsClassId = "VT-ROB-ARMI99";

    saveRunningClasses([
      {
        classCode: codingClassId,
        courseName: "Coding for Kids — PTA",
        status: "Running",
      },
      {
        classCode: roboticsClassId,
        courseName: "Robotics ARM Intensive",
        status: "Running",
      },
    ]);

    const codingStudents = [
      { studentId: "STU_PTA_01", fullName: "Nguyễn Minh Anh" },
      { studentId: "STU_PTA_02", fullName: "Trần Gia Bảo" },
      { studentId: "STU_PTA_03", fullName: "Lê Hoàng Nam" },
      { studentId: "STU_PTA_04", fullName: "Phạm Khánh Vy" },
    ];
    for (const s of codingStudents) {
      studentRepo.upsert({
        studentId: s.studentId,
        classId: codingClassId,
        fullName: s.fullName,
        isActive: 1,
      });
    }

    const roboticsStudents = [
      { studentId: "STU_ROB_01", fullName: "Đặng Quốc Khánh" },
      { studentId: "STU_ROB_02", fullName: "Vũ Bảo Ngọc" },
    ];
    for (const s of roboticsStudents) {
      studentRepo.upsert({
        studentId: s.studentId,
        classId: roboticsClassId,
        fullName: s.fullName,
        isActive: 1,
      });
    }

    classSessionRepo.upsert({
      classId: codingClassId,
      className: codingClassId,
      sessionId: `${codingClassId}_SESS_5`,
      sessionNumber: 5,
      topic: "Kiểm tra giữa khóa & Thực hành vòng lặp",
      date: "2026-11-20",
    });
    classSessionRepo.upsert({
      classId: codingClassId,
      className: codingClassId,
      sessionId: `${codingClassId}_SESS_14`,
      sessionNumber: 14,
      topic: "Thuyết trình Sản phẩm cuối khóa",
      date: "2026-12-25",
    });
    classSessionRepo.upsert({
      classId: roboticsClassId,
      className: roboticsClassId,
      sessionId: `${roboticsClassId}_SESS_4`,
      sessionNumber: 4,
      topic: "Cảm biến siêu âm & Tránh vật cản",
      date: "2026-11-20",
    });

    // =========================================================================
    // [CM-01] Local-Only Security (403) & Validation (400)
    // =========================================================================
    console.log("\n[CM-01] Kiểm tra hàng rào bảo mật Local-Only (403) & Validate đầu vào (400)...");
    const localHeaders = { host: "127.0.0.1:3000", "Content-Type": "application/json" };

    // Remote url.hostname / Host / cross-site / bad Origin -> 403 on all 3 routes
    const badHeadersList: Record<string, string>[] = [
      { host: "evil.example:3000", "Content-Type": "application/json" },
      { host: "127.0.0.1:3000", "sec-fetch-site": "cross-site", "Content-Type": "application/json" },
      {
        host: "127.0.0.1:3000",
        origin: "https://evil.example",
        "Content-Type": "application/json",
      },
    ];
    for (const h of badHeadersList) {
      const rGet = await stateGET(
        new Request(`http://127.0.0.1:3000/api/classroom-manager/state?classId=${codingClassId}`, {
          headers: h,
        })
      );
      assert.equal(rGet.status, 403, "[CM-01] stateGET phải trả 403 cho request ngoài cục bộ");

      const rSave = await savePOST(
        new Request("http://127.0.0.1:3000/api/classroom-manager/save", {
          method: "POST",
          headers: h,
          body: JSON.stringify({ classId: codingClassId, sessionNumber: 5, items: [] }),
        })
      );
      assert.equal(rSave.status, 403, "[CM-01] savePOST phải trả 403 cho request ngoài cục bộ");

      const rApply = await applyPOST(
        new Request("http://127.0.0.1:3000/api/classroom-manager/apply-to-comments", {
          method: "POST",
          headers: h,
          body: JSON.stringify({ classId: codingClassId, sessionNumber: 5 }),
        })
      );
      assert.equal(rApply.status, 403, "[CM-01] applyPOST phải trả 403 cho request ngoài cục bộ");
    }

    const rRemoteUrl = await stateGET(
      new Request(`http://192.168.1.50:3000/api/classroom-manager/state?classId=${codingClassId}`, {
        headers: { host: "127.0.0.1:3000" },
      })
    );
    assert.equal(rRemoteUrl.status, 403, "[CM-01] URL hostname ngoài 127.0.0.1/localhost phải trả 403");

    // Input validation -> 400
    for (const badJson of ["{", "[]", "null", "123"]) {
      const r = await savePOST(
        new Request("http://127.0.0.1:3000/api/classroom-manager/save", {
          method: "POST",
          headers: localHeaders,
          body: badJson,
        })
      );
      assert.equal(r.status, 400, `[CM-01] savePOST phải chặn JSON không hợp lệ: ${badJson}`);
    }

    for (const badSess of [0, 15, -1, 1.5]) {
      const r = await savePOST(
        new Request("http://127.0.0.1:3000/api/classroom-manager/save", {
          method: "POST",
          headers: localHeaders,
          body: JSON.stringify({
            classId: codingClassId,
            sessionNumber: badSess,
            items: [{ studentId: "STU_PTA_01", attendanceStatus: "PRESENT", stars: 1, medals: 0 }],
          }),
        })
      );
      assert.equal(r.status, 400, `[CM-01] sessionNumber=${badSess} phải trả 400`);
    }

    // Cross-class studentId rejected with 400
    const rCrossStudent = await savePOST(
      new Request("http://127.0.0.1:3000/api/classroom-manager/save", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({
          classId: codingClassId,
          sessionNumber: 5,
          items: [{ studentId: "STU_ROB_01", attendanceStatus: "PRESENT", stars: 1, medals: 0 }],
        }),
      })
    );
    assert.equal(rCrossStudent.status, 400, "[CM-01] Học viên của lớp khác phải trả 400");

    // Duplicate studentId rejected with 400
    const rDupStudent = await savePOST(
      new Request("http://127.0.0.1:3000/api/classroom-manager/save", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({
          classId: codingClassId,
          sessionNumber: 5,
          items: [
            { studentId: "STU_PTA_01", attendanceStatus: "PRESENT", stars: 1, medals: 0 },
            { studentId: "STU_PTA_01", attendanceStatus: "PRESENT", stars: 2, medals: 0 },
          ],
        }),
      })
    );
    assert.equal(rDupStudent.status, 400, "[CM-01] Trùng lặp studentId phải trả 400");

    // Negative / non-integer / > 999 stars & bad expectedRowVer rejected with 400
    for (const badStars of [-1, 1.5, 1000, "5"]) {
      const rBadStars = await savePOST(
        new Request("http://127.0.0.1:3000/api/classroom-manager/save", {
          method: "POST",
          headers: localHeaders,
          body: JSON.stringify({
            classId: codingClassId,
            sessionNumber: 5,
            items: [{ studentId: "STU_PTA_01", attendanceStatus: "PRESENT", stars: badStars, medals: 0 }],
          }),
        })
      );
      assert.equal(rBadStars.status, 400, `[CM-01] stars=${String(badStars)} phải trả 400`);
    }

    for (const badRowVer of ["not-a-number", "", -5, 1.5]) {
      const rBadVer = await savePOST(
        new Request("http://127.0.0.1:3000/api/classroom-manager/save", {
          method: "POST",
          headers: localHeaders,
          body: JSON.stringify({
            classId: codingClassId,
            sessionNumber: 5,
            items: [
              {
                studentId: "STU_PTA_01",
                attendanceStatus: "PRESENT",
                stars: 1,
                medals: 0,
                expectedRowVer: badRowVer,
              },
            ],
          }),
        })
      );
      assert.equal(rBadVer.status, 400, `[CM-01] expectedRowVer=${String(badRowVer)} phải trả 400`);
    }

    // =========================================================================
    // [CM-02] Star Preservation, Bidirectional Late Sync, ABSENT lock & rowVer
    // =========================================================================
    console.log("\n[CM-02] Kiểm tra quy tắc giữ nguyên Sao khi ghi lỗi, đồng bộ Đi muộn & rowVer...");
    let s1: ClassroomStudentState = {
      studentId: "STU_PTA_01",
      fullName: "Nguyễn Minh Anh",
      attendanceStatus: "PRESENT",
      stars: 0,
      medals: 0,
      praiseCounts: {},
      issueCounts: {},
      teacherQuickNote: "",
    };

    s1 = applyPraiseAction(s1, "phat_bieu", 1);
    s1 = applyPraiseAction(s1, "phat_bieu", 1);
    s1 = applyPraiseAction(s1, "lam_tot", 1);
    s1 = applyPraiseAction(s1, "huy_hieu", 1);
    assert.equal(s1.stars, 3, "[CM-02] 2 Phát biểu + 1 Làm tốt = 3 Sao");
    assert.equal(s1.medals, 1, "[CM-02] 1 Huy hiệu = 1 Huy hiệu");

    // Record ALL 6 violation buttons multiple times -> MUST NEVER deduct stars or medals!
    for (const errKey of [
      "di_muon",
      "noi_chuyen",
      "khong_chu_y",
      "viec_rieng",
      "roi_cho",
      "chua_btvn",
    ] as const) {
      s1 = applyIssueAction(s1, errKey, 1);
      s1 = applyIssueAction(s1, errKey, 1);
    }
    assert.equal(s1.stars, 3, "[CM-02] Quy tắc thép: Ghi đủ 6 loại lỗi KHÔNG ĐƯỢC trừ Sao");
    assert.equal(s1.medals, 1, "[CM-02] Quy tắc thép: Ghi lỗi KHÔNG ĐƯỢC trừ Huy hiệu");
    assert.equal(s1.attendanceStatus, "LATE", "[CM-02] Bấm Đi muộn tự chuyển trạng thái sang LATE");

    // Decrement di_muon back to 0 -> flips LATE -> PRESENT, then floor at 0
    s1 = applyIssueAction(s1, "di_muon", -1);
    assert.equal(s1.attendanceStatus, "LATE");
    s1 = applyIssueAction(s1, "di_muon", -1);
    assert.equal(s1.attendanceStatus, "PRESENT", "[CM-02] Giảm Đi muộn về 0 tự chuyển về PRESENT");
    const afterFloor = applyIssueAction(s1, "di_muon", -1);
    assert.equal(afterFloor.issueCounts.di_muon ?? 0, 0, "[CM-02] Đếm lỗi dừng ở sàn 0");

    // Attendance cycle: PRESENT -> LATE -> ABSENT -> PRESENT
    s1 = applyAttendanceToggle(s1, "LATE");
    assert.equal(s1.issueCounts.di_muon, 1, "[CM-02] Đổi sang LATE tự gắn di_muon = 1");
    s1 = applyAttendanceToggle(s1, "PRESENT");
    assert.equal(s1.issueCounts.di_muon ?? 0, 0, "[CM-02] Đổi về PRESENT tự xóa di_muon");

    const absRow = applyAttendanceToggle(s1, "ABSENT");
    assert.equal(applyPraiseAction(absRow, "phat_bieu", 1), absRow, "[CM-02] ABSENT khóa nút khen");
    assert.equal(applyIssueAction(absRow, "noi_chuyen", 1), absRow, "[CM-02] ABSENT khóa nút lỗi");
    assert.equal(applyManualStarDelta(absRow, 1), absRow, "[CM-02] ABSENT khóa nút +- sao");

    // Test expectedRowVer optimistic guard in SQLite repo
    const saveBatch1 = classroomSessionLogRepo.upsertBatch([
      {
        classId: codingClassId,
        sessionNumber: 5,
        sessionId: `${codingClassId}_SESS_5`,
        studentId: "STU_PTA_01",
        attendanceStatus: "PRESENT",
        stars: 4,
        medals: 1,
        praiseCountsJson: JSON.stringify({ phat_bieu: 3, lam_tot: 1, huy_hieu: 1 }),
        issueCountsJson: JSON.stringify({ noi_chuyen: 1 }),
        teacherQuickNote: "Tư duy logic tốt",
      },
    ]);
    assert.equal(saveBatch1[0].staleIgnored, false);
    const v1 = Number(saveBatch1[0].record.rowVer || 1);

    const saveBatch2 = classroomSessionLogRepo.upsertBatch([
      {
        classId: codingClassId,
        sessionNumber: 5,
        sessionId: `${codingClassId}_SESS_5`,
        studentId: "STU_PTA_01",
        attendanceStatus: "PRESENT",
        stars: 6,
        medals: 2,
        expectedRowVer: v1,
      },
    ]);
    assert.equal(saveBatch2[0].staleIgnored, false);
    assert.equal(saveBatch2[0].record.stars, 6);
    assert.ok(Number(saveBatch2[0].record.rowVer || 0) > v1);

    const staleBatch = classroomSessionLogRepo.upsertBatch([
      {
        classId: codingClassId,
        sessionNumber: 5,
        sessionId: `${codingClassId}_SESS_5`,
        studentId: "STU_PTA_01",
        attendanceStatus: "PRESENT",
        stars: 1,
        expectedRowVer: v1, // Stale!
      },
    ]);
    assert.equal(staleBatch[0].staleIgnored, true, "[CM-02] Bản lưu cũ hơn phải bị từ chối ghi đè");
    assert.equal(
      classroomSessionLogRepo.findOne(codingClassId, 5, "STU_PTA_01")?.stars,
      6,
      "[CM-02] Giá trị mới hơn trong SQLite phải được giữ nguyên"
    );

    // First-write expectedRowVer=0 conflict simulation across two tabs via savePOST
    const tabASaveRes = await savePOST(
      new Request("http://127.0.0.1:3000/api/classroom-manager/save", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({
          classId: codingClassId,
          sessionNumber: 7,
          items: [
            {
              studentId: "STU_PTA_03",
              attendanceStatus: "PRESENT",
              stars: 5,
              medals: 1,
              expectedRowVer: 0,
            },
          ],
        }),
      })
    );
    assert.equal(tabASaveRes.status, 200);
    const tabAJson = await tabASaveRes.json();
    assert.equal(tabAJson.staleIgnoredCount, 0);

    const tabBSaveRes = await savePOST(
      new Request("http://127.0.0.1:3000/api/classroom-manager/save", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({
          classId: codingClassId,
          sessionNumber: 7,
          items: [
            {
              studentId: "STU_PTA_03",
              attendanceStatus: "PRESENT",
              stars: 1,
              medals: 0,
              expectedRowVer: 0,
            },
          ],
        }),
      })
    );
    assert.equal(tabBSaveRes.status, 200);
    const tabBJson = await tabBSaveRes.json();
    assert.equal(tabBJson.staleIgnoredCount, 1, "[CM-02] Tab B gửi expectedRowVer=0 phải bị chặn khi Tab A đã lưu rowVer=1");
    assert.equal(
      classroomSessionLogRepo.findOne(codingClassId, 7, "STU_PTA_03")?.stars,
      5,
      "[CM-02] Giá trị 5 sao của Tab A phải được bảo toàn trước expectedRowVer=0 từ Tab B"
    );

    // =========================================================================
    // [CM-03] Horizontal Projector Ranking & 14-Session Accumulation
    // =========================================================================
    console.log("\n[CM-03] Kiểm tra xếp hạng Chiếu lớp học hàng ngang & Tích lũy 14 buổi...");
    const projectorInput: ClassroomStudentState[] = [
      {
        studentId: "A1",
        fullName: "Nguyễn Văn A",
        attendanceStatus: "ABSENT",
        stars: 9, // Had stars earlier before being marked absent
        medals: 2,
        praiseCounts: { phat_bieu: 9 },
        issueCounts: { noi_chuyen: 3 },
        teacherQuickNote: "Bí mật GV",
        courseTotalStars: 15,
        courseTotalMedals: 3,
      },
      {
        studentId: "B1",
        fullName: "Trần Thị B",
        attendanceStatus: "LATE",
        stars: 5,
        medals: 1,
        praiseCounts: { phat_bieu: 3, lam_tot: 2, huy_hieu: 1 },
        issueCounts: { di_muon: 1, noi_chuyen: 2 },
        teacherQuickNote: "Nhắc tập trung",
        courseTotalStars: 12,
        courseTotalMedals: 1,
      },
      {
        studentId: "C1",
        fullName: "Lê Minh C",
        attendanceStatus: "PRESENT",
        stars: 5,
        medals: 2,
        praiseCounts: { phat_bieu: 3, lam_tot: 2, huy_hieu: 2 },
        issueCounts: {},
        teacherQuickNote: "",
        courseTotalStars: 22,
        courseTotalMedals: 4,
      },
    ];

    const ranked = rankStudentsForProjector(projectorInput);
    assert.equal(ranked[0].studentId, "C1", "[CM-03] Bằng sao thì hơn huy hiệu xếp trước (#1)");
    assert.equal(ranked[0].rank, 1);
    assert.equal(ranked[1].studentId, "B1", "[CM-03] Học viên có mặt/muộn đứng trên vắng (#2)");
    assert.equal(ranked[1].rank, 2);
    assert.equal(ranked[2].studentId, "A1", "[CM-03] Học viên Vắng mặt luôn xếp cuối");
    assert.equal(ranked[2].rank, null);
    assert.equal(ranked[2].stars, 0, "[CM-03] Vắng mặt hiển thị 0 sao trên bảng chiếu");
    const absentNoCourseTotal = rankStudentsForProjector([
      {
        studentId: "ABS_NO_TOTAL",
        fullName: "Học sinh Vắng",
        attendanceStatus: "ABSENT",
        stars: 9,
        medals: 2,
        praiseCounts: {},
        issueCounts: {},
        teacherQuickNote: "",
      },
    ]);
    assert.equal(
      absentNoCourseTotal[0].courseTotalStars,
      0,
      "[CM-03] Vắng mặt không truyền courseTotalStars không được fallback về row.stars"
    );
    for (const r of ranked) {
      assert.equal("issueCounts" in r, false, "[CM-03] Dữ liệu chiếu KHÔNG chứa issueCounts");
      assert.equal("teacherQuickNote" in r, false, "[CM-03] Dữ liệu chiếu KHÔNG chứa ghi chú riêng GV");
    }

    const acc = computeCourseAccumulationSummary(
      [
        { studentId: "S1", fullName: "Học sinh Một" },
        { studentId: "S2", fullName: "Học sinh Hai" },
        { studentId: "S3", fullName: "Học sinh Ba" },
      ],
      [
        { studentId: "S1", sessionNumber: 1, attendanceStatus: "PRESENT", stars: 10, medals: 2 },
        { studentId: "S1", sessionNumber: 2, attendanceStatus: "LATE", stars: 12, medals: 1 },
        { studentId: "S1", sessionNumber: 3, attendanceStatus: "ABSENT", stars: 50, medals: 5 }, // ABSENT ignored
        { studentId: "S2", sessionNumber: 1, attendanceStatus: "PRESENT", stars: 11, medals: 0 },
        { studentId: "S3", sessionNumber: 1, attendanceStatus: "PRESENT", stars: 4, medals: 0 },
      ]
    );
    const accMap = new Map(acc.map((r) => [r.studentId, r]));
    assert.equal(accMap.get("S1")?.totalStars, 22);
    assert.equal(accMap.get("S1")?.attendedSessions, 2);
    assert.equal(accMap.get("S1")?.lateSessions, 1);
    assert.equal(accMap.get("S1")?.absentSessions, 1);
    assert.equal(accMap.get("S1")?.rankLabel, "Xuất sắc 🌟");
    assert.equal(accMap.get("S2")?.rankLabel, "Tích cực 👍");
    assert.equal(accMap.get("S3")?.rankLabel, "Cần cố gắng 💪");

    // =========================================================================
    // [CM-04] Apply-to-Comments: Coding/Robotics, VERIFIED Protection & Session 14
    // =========================================================================
    console.log("\n[CM-04] Kiểm tra đẩy dữ liệu sang Nhận xét, bảo vệ VERIFIED & Buổi 14...");
    // Robotics spotless student check
    const roboticsSpotlessMap = buildClassroomToCommentMapping({
      classCode: roboticsClassId,
      sessionNumber: 4,
      studentRow: {
        studentId: "STU_ROB_01",
        fullName: "Đặng Quốc Khánh",
        attendanceStatus: "PRESENT",
        stars: 0,
        medals: 0,
        praiseCounts: {},
        issueCounts: {},
        teacherQuickNote: "",
      },
    });
    assert.ok(
      roboticsSpotlessMap.quickTags.includes("🔧 Lắp ráp đúng mẫu"),
      "[CM-04] Lớp Robotics phải dùng Quick Tag hệ Robotics"
    );
    assert.ok(
      roboticsSpotlessMap.teacherNote.includes("Tham gia buổi học đầy đủ"),
      "[CM-04] Bạn ngoan 0 sao 0 lỗi phải có câu mặc định tích cực để AI không báo thiếu thông tin"
    );

    // Seed STU_PTA_02 = VERIFIED (MUST NOT BE TOUCHED)
    const verifiedHash = calculateSha256("- **Điểm mạnh của học viên:** Đã khóa VERIFIED LMS.");
    sessionFeedbackRepo.upsert({
      classId: codingClassId,
      sessionId: `${codingClassId}_SESS_5`,
      studentId: "STU_PTA_02",
      attendanceStatus: "PRESENT",
      quickTagsJson: JSON.stringify(["✅ Tiếp thu tốt"]),
      teacherNote: "Nội dung GV đã lưu LMS trước đó",
      finalText: "- **Điểm mạnh của học viên:** Đã khóa VERIFIED LMS.",
      contentHash: verifiedHash,
      status: "VERIFIED",
      verifiedAt: "2026-11-20T10:00:00Z",
    });

    // Seed STU_PTA_03 = APPROVED -> MUST demote to DRAFT with contentHash="" while preserving finalText
    const approvedHash = calculateSha256("- **Điểm mạnh của học viên:** Bản đã duyệt trước khi cập nhật.");
    sessionFeedbackRepo.upsert({
      classId: codingClassId,
      sessionId: `${codingClassId}_SESS_5`,
      studentId: "STU_PTA_03",
      attendanceStatus: "PRESENT",
      quickTagsJson: JSON.stringify(["✅ Tiếp thu tốt"]),
      teacherNote: "Nháp cũ",
      finalText: "- **Điểm mạnh của học viên:** Bản đã duyệt trước khi cập nhật.",
      contentHash: approvedHash,
      status: "APPROVED",
    });

    const applyRes = await applyPOST(
      new Request("http://127.0.0.1:3000/api/classroom-manager/apply-to-comments", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({
          classId: codingClassId,
          sessionNumber: 5,
          items: [
            {
              studentId: "STU_PTA_01",
              attendanceStatus: "LATE",
              stars: 5,
              medals: 1,
              praiseCounts: { phat_bieu: 3, lam_tot: 2, huy_hieu: 1 },
              issueCounts: { di_muon: 1, noi_chuyen: 2 },
              teacherQuickNote: "Cài đặt xong menu chính",
            },
            {
              studentId: "STU_PTA_02",
              attendanceStatus: "PRESENT",
              stars: 1,
              medals: 0,
              praiseCounts: { phat_bieu: 1 },
              issueCounts: {},
              teacherQuickNote: "Không được đè VERIFIED",
            },
            {
              studentId: "STU_PTA_03",
              attendanceStatus: "PRESENT",
              stars: 0,
              medals: 0,
              praiseCounts: {},
              issueCounts: { khong_chu_y: 1 },
              teacherQuickNote: "Cần nhắc nhìn màn hình chung",
            },
            {
              studentId: "STU_PTA_04",
              attendanceStatus: "ABSENT",
              stars: 0,
              medals: 0,
              praiseCounts: {},
              issueCounts: {},
              teacherQuickNote: "",
            },
          ],
        }),
      })
    );
    assert.equal(applyRes.status, 200);
    const applyJson = await applyRes.json();
    assert.equal(applyJson.success, true);
    assert.equal(applyJson.skippedVerifiedCount, 1, "[CM-04] Phải giữ nguyên đúng 1 học viên VERIFIED");
    assert.equal(applyJson.appliedCount, 3, "[CM-04] Áp dụng 3 học viên còn lại");
    assert.ok(
      String(applyJson.targetUrl).startsWith(`/session-comments?classId=${codingClassId}&sessionNumber=5&fromClassroom=1`)
    );

    const fb1 = sessionFeedbackRepo.findOne(codingClassId, `${codingClassId}_SESS_5`, "STU_PTA_01");
    assert.equal(fb1?.attendanceStatus, "LATE");
    assert.ok(fb1?.teacherNote?.includes("Trong giờ: phát biểu xây dựng bài (3 lần)"));
    assert.ok(fb1?.teacherNote?.includes("+ Đi học muộn"));
    assert.ok(fb1?.teacherNote?.includes("+ Nói chuyện riêng (2 lần)"));
    assert.ok(fb1?.teacherNote?.includes("Cài đặt xong menu chính"));
    const meta1 = JSON.parse(fb1?.versionMetaJson || "{}");
    assert.ok((meta1?.fields?.quickTags?.ver || 0) >= 1, "[CM-04] versionMetaJson.fields.quickTags.ver phải được tăng để chống nhớ nhầm từ buổi trước");

    const fb2 = sessionFeedbackRepo.findOne(codingClassId, `${codingClassId}_SESS_5`, "STU_PTA_02");
    assert.equal(fb2?.status, "VERIFIED", "[CM-04] Học viên VERIFIED giữ nguyên trạng thái");
    assert.equal(fb2?.teacherNote, "Nội dung GV đã lưu LMS trước đó", "[CM-04] Học viên VERIFIED giữ nguyên teacherNote");

    const fb3 = sessionFeedbackRepo.findOne(codingClassId, `${codingClassId}_SESS_5`, "STU_PTA_03");
    assert.equal(fb3?.status, "DRAFT", "[CM-04] Học viên APPROVED phải hạ về DRAFT");
    assert.equal(fb3?.contentHash, "", "[CM-04] Học viên APPROVED phải xóa hash cũ");
    assert.ok(fb3?.finalText?.includes("Bản đã duyệt trước khi cập nhật"), "[CM-04] Bảo toàn finalText đã soạn");

    // Session 14 apply idempotency + preserve manual notes before AND after [Giờ học B14] + keep quickTagsJson clean
    session14EvalRepo.saveDraft({
      classId: codingClassId,
      studentId: "STU_PTA_01",
      teacherNote: "Thuyết trình rõ ràng phần demo.",
    });
    const apply14First = await applyPOST(
      new Request("http://127.0.0.1:3000/api/classroom-manager/apply-to-comments", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({
          classId: codingClassId,
          sessionNumber: 14,
          items: [
            {
              studentId: "STU_PTA_01",
              attendanceStatus: "PRESENT",
              stars: 6,
              medals: 1,
              praiseCounts: { phat_bieu: 4, lam_tot: 2, huy_hieu: 1 },
              issueCounts: {},
              teacherQuickNote: "Trả lời phản biện tốt",
            },
          ],
        }),
      })
    );
    const apply14Json = await apply14First.json();
    assert.ok(String(apply14Json.targetUrl).startsWith(`/final-project?classId=${codingClassId}&sessionNumber=14&fromClassroom=1`));

    // Teacher adds a follow-up line AFTER [Giờ học B14] before re-applying
    const midEval14 = session14EvalRepo.findOne(codingClassId, "STU_PTA_01");
    session14EvalRepo.saveDraft({
      classId: codingClassId,
      studentId: "STU_PTA_01",
      teacherNote: `${midEval14?.teacherNote || ""}\nBổ sung nhận xét thêm từ GV sau dòng tổng kết.`,
    });

    // Call again to prove only [Giờ học B14] line is replaced and post-tag notes are preserved
    await applyPOST(
      new Request("http://127.0.0.1:3000/api/classroom-manager/apply-to-comments", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({
          classId: codingClassId,
          sessionNumber: 14,
          items: [
            {
              studentId: "STU_PTA_01",
              attendanceStatus: "PRESENT",
              stars: 7,
              medals: 1,
              praiseCounts: { phat_bieu: 5, lam_tot: 2, huy_hieu: 1 },
              issueCounts: {},
              teacherQuickNote: "Trả lời phản biện tốt",
            },
          ],
        }),
      })
    );
    const eval14 = session14EvalRepo.findOne(codingClassId, "STU_PTA_01");
    assert.equal(
      (eval14?.teacherNote || "").split("[Giờ học B14]").length - 1,
      1,
      "[CM-04] Buổi 14 áp dụng lại KHÔNG được nhân đôi đoạn [Giờ học B14]"
    );
    assert.ok(eval14?.teacherNote?.includes("7 sao"), "[CM-04] Đoạn [Giờ học B14] phải cập nhật 7 sao mới");
    assert.ok(
      eval14?.teacherNote?.includes("Thuyết trình rõ ràng phần demo.") &&
        eval14?.teacherNote?.includes("Bổ sung nhận xét thêm từ GV sau dòng tổng kết."),
      "[CM-04] Buổi 14 áp dụng lại phải giữ nguyên ghi chú cả trước lẫn sau [Giờ học B14]"
    );
    assert.equal(
      eval14?.quickTagsJson,
      "[]",
      "[CM-04] Buổi 14 không được ghi đè quickTags buổi thường vào spck_session14_evaluations"
    );

    // Seed clean session 6 for clean E2E verification
    classSessionRepo.upsert({
      classId: codingClassId,
      className: codingClassId,
      sessionId: `${codingClassId}_SESS_6`,
      sessionNumber: 6,
      topic: "Lập trình sự kiện & Giao diện nâng cao",
      date: "2026-11-27",
    });
    // Make Session 6 the latest running session so page loads directly on it or use URL params
    closeDb();

    // =========================================================================
    // [CM-05] Live Headless Chromium E2E (127.0.0.1:3097, Light & Dark)
    // =========================================================================
    console.log("\n[CM-05] Khởi chạy máy chủ thử nghiệm Next.js & trình duyệt Chromium thật...");
    fs.rmSync(e2eDistAbs, { recursive: true, force: true });
    fs.mkdirSync(e2eDistAbs, { recursive: true });
    const rootTsconfig = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "tsconfig.json"), "utf8")
    );
    rootTsconfig.compilerOptions = {
      ...(rootTsconfig.compilerOptions || {}),
      paths: { "@/*": ["../src/*"] },
    };
    fs.writeFileSync(e2eTsconfigAbs, JSON.stringify(rootTsconfig, null, 2), "utf8");

    const baseUrl = `http://127.0.0.1:${testPort}`;
    nextServer = spawn(
      process.execPath,
      ["./node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(testPort)],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          MINDX_NEXT_DIST_DIR: e2eDistRel,
          MINDX_NEXT_TSCONFIG_PATH: e2eTsconfigRel,
          ALLOWED_LOCAL_DIRS: tmpRoot,
          MINDX_ALLOWED_EXTRA_PATHS: tmpRoot,
          MINDX_DB_PATH: tmpDbPath,
          MINDX_CONFIG_DIR: tmpConfigDir,
          MINDX_RUNNING_CLASSES_PATH: tmpRunningClassesPath,
          NEXT_TELEMETRY_DISABLED: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    nextServer.stdout?.on("data", (d) => serverLogs.push(String(d)));
    nextServer.stderr?.on("data", (d) => serverLogs.push(String(d)));

    await waitForHttpReady(`${baseUrl}/api/classroom-manager/state?classId=${codingClassId}&sessionNumber=6`, 60000);

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript("globalThis.__name = globalThis.__name || ((x) => x);");
    const page = await context.newPage();

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });

    const assertWcagContrastOnUi = async (themeLabel: string) => {
      const failures = await page.evaluate(() => {
        const colorCanvas = document.createElement("canvas");
        colorCanvas.width = 1;
        colorCanvas.height = 1;
        const colorCtx = colorCanvas.getContext("2d", { willReadFrequently: true });

        const parseRgba = (str: string) => {
          if (!str || str === "transparent") return null;
          const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
          if (m) {
            return {
              r: Number(m[1]),
              g: Number(m[2]),
              b: Number(m[3]),
              a: m[4] !== undefined ? Number(m[4]) : 1,
            };
          }
          if (!colorCtx) return null;
          colorCtx.clearRect(0, 0, 1, 1);
          colorCtx.fillStyle = str;
          colorCtx.fillRect(0, 0, 1, 1);
          const data = colorCtx.getImageData(0, 0, 1, 1).data;
          return {
            r: data[0],
            g: data[1],
            b: data[2],
            a: data[3] / 255,
          };
        };
        const compositeOver = (
          fg: { r: number; g: number; b: number; a: number },
          bg: { r: number; g: number; b: number }
        ) => ({
          r: fg.r * fg.a + bg.r * (1 - fg.a),
          g: fg.g * fg.a + bg.g * (1 - fg.a),
          b: fg.b * fg.a + bg.b * (1 - fg.a),
        });
        const relLum = (c: { r: number; g: number; b: number }) => {
          const lin = [c.r, c.g, c.b].map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
        };
        const getEffectiveBg = (el: Element | null) => {
          const layers: Array<{ r: number; g: number; b: number; a: number }> = [];
          let cur: Element | null = el;
          while (cur) {
            const bg = parseRgba(getComputedStyle(cur).backgroundColor);
            if (bg && bg.a > 0) layers.push(bg);
            cur = cur.parentElement;
          }
          let acc = { r: 255, g: 255, b: 255 };
          for (let i = layers.length - 1; i >= 0; i--) {
            acc = compositeOver(layers[i], acc);
          }
          return acc;
        };

        const selectors = [
          "th",
          "[data-testid='cm-kpi-stars']",
          "[data-testid='cm-kpi-issues']",
          "[data-testid='cm-projector-toggle-btn']",
          "[data-testid='cm-open-summary-btn']",
          "[data-testid='cm-direct-apply-btn']",
          "[data-testid^='cm-att-btn-']",
          "[data-testid^='cm-praise-phat_bieu-']",
          "[data-testid^='cm-issue-noi_chuyen-']",
        ];
        const bad: string[] = [];
        for (const sel of selectors) {
          const els = Array.from(document.querySelectorAll(sel));
          for (const el of els.slice(0, 3)) {
            const cs = getComputedStyle(el);
            if (cs.visibility === "hidden" || cs.display === "none") continue;
            const fgRaw = parseRgba(cs.color);
            if (!fgRaw) continue;
            const bg = getEffectiveBg(el);
            const fg = fgRaw.a < 1 ? compositeOver(fgRaw, bg) : fgRaw;
            const l1 = relLum(fg);
            const l2 = relLum(bg);
            const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
            if (ratio < 4.5) {
              bad.push(`${sel} ("${(el.textContent || "").trim().slice(0, 30)}"): ${ratio.toFixed(2)}`);
            }
          }
        }
        return bad;
      });
      assert.deepEqual(
        failures,
        [],
        `[CM-05] Độ tương phản WCAG AA phải >= 4.5 (${themeLabel}): ${failures.join("; ")}`
      );
    };

    // Load /classroom-manager on Session 6
    await page.goto(`${baseUrl}/classroom-manager?classId=${codingClassId}&sessionNumber=6`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(`[data-testid="cm-student-row-STU_PTA_01"]`, {
      timeout: 60000,
    });

    const assertLayoutNoWrapOrTruncate = async (vpLabel: string) => {
      const layoutIssues = await page.evaluate(() => {
        const problems: string[] = [];
        const navHeader = document.querySelector("header.mindx-navbar") as HTMLElement | null;
        if (navHeader) {
          const links = Array.from(navHeader.querySelectorAll("nav a"));
          for (const a of links) {
            const rect = a.getBoundingClientRect();
            if (rect.height > 60) {
              problems.push(`TopNavbar link wrapped (${Math.round(rect.height)}px): ${a.textContent?.trim()}`);
            }
          }
        }
        const labelSpans = Array.from(
          document.querySelectorAll(
            '[data-testid^="cm-praise-"] span.truncate, [data-testid^="cm-issue-"] span.truncate'
          )
        );
        for (const sp of labelSpans.slice(0, 12)) {
          const el = sp as HTMLElement;
          if (el.scrollWidth > el.clientWidth + 1) {
            problems.push(`Button text truncated (${el.scrollWidth} > ${el.clientWidth}): ${el.textContent?.trim()}`);
          }
        }
        return problems;
      });
      assert.deepEqual(
        layoutIssues,
        [],
        `[CM-05] Không được vỡ TopNavbar hay cắt cụt nhãn nút (${vpLabel}): ${layoutIssues.join("; ")}`
      );
    };

    // Light Mode Section Header Colors & Layout check at 1280x800, 1366x768, 1440x900
    const lightHeaderColors = await page.evaluate(() => {
      const ths = Array.from(document.querySelectorAll("table.cm-table thead th"));
      return ths.map((th) => getComputedStyle(th).backgroundColor);
    });
    assert.equal(lightHeaderColors.length, 6);
    assert.ok(
      new Set(lightHeaderColors).size >= 4,
      `[CM-05] Light Mode phải giữ nguyên 4 vùng màu tiêu đề bảng (thay vì đồng loạt #172554): ${JSON.stringify(
        lightHeaderColors
      )}`
    );

    await assertWcagContrastOnUi("1280x800 Light");
    await assertLayoutNoWrapOrTruncate("1280x800");
    await page.setViewportSize({ width: 1366, height: 768 });
    await assertLayoutNoWrapOrTruncate("1366x768");
    await page.setViewportSize({ width: 1280, height: 800 });

    for (const s of codingStudents) {
      await page.waitForSelector(`[data-testid="cm-star-box-${s.studentId}"]`);
      await page.waitForSelector(`[data-testid="cm-medal-box-${s.studentId}"]`);
      await page.waitForSelector(`[data-testid="cm-issue-box-${s.studentId}"]`);
      await page.waitForSelector(`[data-testid="cm-praise-phat_bieu-${s.studentId}"]`);
      await page.waitForSelector(`[data-testid="cm-issue-chua_btvn-${s.studentId}"]`);
      await page.waitForSelector(`[data-testid="cm-note-btn-${s.studentId}"]`);
    }

    // Interact on UI: Student 1 gets +2 Phát biểu (auto-wins Top 3 medal under A2), test toggle OFF/ON Top 3, +2 Nói chuyện, right-click -1 Nói chuyện, quick note
    await page.click(`[data-testid="cm-praise-phat_bieu-STU_PTA_01"]`);
    await page.click(`[data-testid="cm-praise-phat_bieu-STU_PTA_01"]`);
    assert.ok(
      (await page.textContent(`[data-testid="cm-medal-box-STU_PTA_01"]`))?.includes("1"),
      "[CM-05] Bạn >= 1 sao đứng đầu lớp tự động nhận Huy hiệu Top 3 (Cách A2)"
    );
    await page.click(`[data-testid="cm-praise-huy_hieu-STU_PTA_01"]`);
    assert.ok(
      (await page.textContent(`[data-testid="cm-medal-box-STU_PTA_01"]`))?.includes("0"),
      "[CM-05] Bấm nút Top 3 lần 1 gỡ Huy hiệu"
    );
    await page.click(`[data-testid="cm-praise-huy_hieu-STU_PTA_01"]`);
    await page.click(`[data-testid="cm-issue-noi_chuyen-STU_PTA_01"]`);
    await page.click(`[data-testid="cm-issue-noi_chuyen-STU_PTA_01"]`);
    await page.click(`[data-testid="cm-issue-noi_chuyen-STU_PTA_01"]`, { button: "right" });

    assert.ok(
      (await page.textContent(`[data-testid="cm-star-box-STU_PTA_01"]`))?.includes("⭐ 2"),
      "[CM-05] Đếm lỗi không được trừ Sao trên UI"
    );
    assert.ok(
      (await page.textContent(`[data-testid="cm-medal-box-STU_PTA_01"]`))?.includes("1"),
      "[CM-05] Bấm bật lại Top 3 Huy hiệu phải là 1"
    );
    assert.ok(
      (await page.textContent(`[data-testid="cm-issue-box-STU_PTA_01"]`))?.includes("1"),
      "[CM-05] Chuột phải giảm lỗi Nói chuyện từ 2 xuống 1"
    );

    // Add teacher quick note via modal
    await page.click(`[data-testid="cm-note-btn-STU_PTA_01"]`);
    await page.fill(`[data-testid="cm-note-modal-textarea"]`, "Lập trình thêm hiệu ứng nút bấm đẹp");
    await page.click(`[data-testid="cm-note-modal-save-btn"]`);

    // Student 2 clicked Đi muộn (+1)
    await page.click(`[data-testid="cm-issue-di_muon-STU_PTA_02"]`);
    assert.ok(
      (await page.textContent(`[data-testid="cm-att-btn-STU_PTA_02"]`))?.includes("Đi muộn"),
      "[CM-05] Bấm Đi muộn tự đổi nút Điểm danh sang Đi muộn"
    );

    // Wait auto-save
    await page.waitForFunction(() => document.body.innerText.includes("✓ Đã lưu"), {
      timeout: 6000,
    });

    // Switch viewport to 1440x900 & Dark mode toggle check
    await page.setViewportSize({ width: 1440, height: 900 });
    await assertLayoutNoWrapOrTruncate("1440x900 Light");
    await page.click(`button.mindx-theme-toggle`);
    await page.waitForFunction(
      () => document.documentElement.getAttribute("data-theme") === "dark"
    );
    await assertWcagContrastOnUi("1440x900 Dark");

    // Toggle back to light mode and verify Random Student Modal backdrop + Accumulation Modal
    await page.click(`button.mindx-theme-toggle`);
    await page.click(`[data-testid="cm-random-picker-btn"]`);
    await page.waitForSelector(`[data-testid="cm-random-modal"]`);
    const modalBg = await page.evaluate(() => {
      const m = document.querySelector(`[data-testid="cm-random-modal"]`);
      return m ? getComputedStyle(m).backgroundColor : "";
    });
    assert.notEqual(
      modalBg,
      "rgb(255, 255, 255)",
      "[CM-05] Nền mờ modal ở Light Mode không được biến thành trắng đục"
    );
    await page.click(`[data-testid="cm-random-modal"] button:has-text("✕")`);

    await page.click(`[data-testid="cm-open-accumulation-btn"]`);
    await page.waitForSelector(`[data-testid="cm-accumulation-modal"]`);
    await page.click(`[data-testid="cm-accumulation-modal"] button:has-text("✕ Đóng")`);

    // Helper: audit Projector Mode contrast across every interactive/visible text element
    const assertProjectorWcag = async (modeLabel: string) => {
      const projFailures = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const toRgba = (str: string) => {
          if (!str || str === "transparent") return null;
          const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
          if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
          if (!ctx) return null;
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = str;
          ctx.fillRect(0, 0, 1, 1);
          const d = ctx.getImageData(0, 0, 1, 1).data;
          return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
        };
        const over = (fg: any, bg: any) => ({
          r: fg.r * fg.a + bg.r * (1 - fg.a),
          g: fg.g * fg.a + bg.g * (1 - fg.a),
          b: fg.b * fg.a + bg.b * (1 - fg.a),
        });
        const lum = (c: any) => {
          const lin = [c.r, c.g, c.b].map((v: number) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
        };
        const bgOf = (el: Element | null) => {
          const layers: any[] = [];
          let cur: Element | null = el;
          while (cur) {
            const bg = toRgba(getComputedStyle(cur).backgroundColor);
            if (bg && bg.a > 0) layers.push(bg);
            cur = cur.parentElement;
          }
          let acc = { r: 15, g: 23, b: 42 };
          for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i], acc);
          return acc;
        };

        const targets = Array.from(
          document.querySelectorAll(
            '[data-testid="cm-projector-board"] span, [data-testid="cm-projector-board"] button, [data-testid="cm-projector-board"] div.text-center'
          )
        );
        const bad: string[] = [];
        for (const el of targets) {
          if (el.closest(".opacity-55") || el.classList.contains("opacity-20")) continue;
          const txt = (el.textContent || "").trim();
          if (!txt || /^⭐+$/.test(txt) || txt === "🏅") continue;
          const cs = getComputedStyle(el);
          const fgRaw = toRgba(cs.color);
          if (!fgRaw) continue;
          const bg = bgOf(el);
          const fg = fgRaw.a < 1 ? over(fgRaw, bg) : fgRaw;
          const l1 = lum(fg);
          const l2 = lum(bg);
          const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          if (ratio < 4.5) {
            bad.push(`"${txt.slice(0, 30)}": ${ratio.toFixed(2)} (fg=${cs.color})`);
          }
        }
        return bad;
      });
      assert.deepEqual(
        projFailures,
        [],
        `[CM-05] Projector Board WCAG AA phải >= 4.5 (${modeLabel}): ${projFailures.join("; ")}`
      );
    };

    // Enter Projector Mode in Light Mode first, verify contrast + horizontal + 0 leak, then test Dark Mode too!
    await page.click(`[data-testid="cm-projector-toggle-btn"]`);
    await page.waitForSelector(`[data-testid="cm-projector-board"]`);
    await assertProjectorWcag("Projector Light Mode");
    await page.click(`button.mindx-theme-toggle`);
    await page.waitForFunction(
      () => document.documentElement.getAttribute("data-theme") === "dark"
    );
    await assertProjectorWcag("Projector Dark Mode");
    await page.click(`button.mindx-theme-toggle`);

    const projectorAudit = await page.evaluate(() => {
      const board = document.querySelector(`[data-testid="cm-projector-board"]`) as HTMLElement | null;
      const rows = Array.from(document.querySelectorAll(`[data-testid^="cm-projector-row-"]`));
      const row1Rect = rows[0]?.getBoundingClientRect();
      const row2Rect = rows[1]?.getBoundingClientRect();
      return {
        text: board?.innerText || "",
        rowCount: rows.length,
        stackedVerticallyInOrder:
          Boolean(row1Rect && row2Rect) &&
          row1Rect!.top < row2Rect!.top &&
          row1Rect!.width > 700,
        firstRowId: rows[0]?.getAttribute("data-testid") || "",
      };
    });
    assert.equal(projectorAudit.rowCount, 4);
    assert.equal(
      projectorAudit.stackedVerticallyInOrder,
      true,
      "[CM-05] Chế độ chiếu lớp học phải xếp hàng ngang rộng theo hạng từ trên xuống"
    );
    assert.equal(
      projectorAudit.firstRowId,
      "cm-projector-row-STU_PTA_01",
      "[CM-05] Bạn nhiều sao nhất (STU_PTA_01) phải đứng hàng #1"
    );
    for (const forbidden of [
      "⚠️",
      "Nói chuyện",
      "Không chú ý",
      "Việc riêng",
      "Rời chỗ",
      "Chưa BTVN",
      "Đi muộn",
      "Lập trình thêm hiệu ứng nút bấm đẹp",
    ]) {
      assert.equal(
        projectorAudit.text.includes(forbidden),
        false,
        `[CM-05] Chế độ chiếu lớp học TUYỆT ĐỐI KHÔNG được lộ: "${forbidden}"`
      );
    }

    await page.click(`[data-testid="cm-exit-projector-btn"]`);
    await page.waitForSelector(`[data-testid="cm-open-summary-btn"]`);

    // Open Summary Modal -> Apply & Navigate to /session-comments
    await page.click(`[data-testid="cm-open-summary-btn"]`);
    await page.waitForSelector(`[data-testid="cm-summary-modal"]`);
    await page.click(`[data-testid="cm-apply-to-comments-btn"]`);

    await page.waitForURL((u) => u.pathname === "/session-comments", { timeout: 60000 });
    await page.waitForFunction(
      () =>
        document.body.innerText.includes("Đã nạp tự động Điểm danh, Thẻ đánh giá nhanh") &&
        document.body.innerText.includes("Nguyễn Minh Anh"),
      { timeout: 60000 }
    );

    const commentPageAudit = await page.evaluate(() => {
      const notes = Array.from(document.querySelectorAll("textarea"))
        .map((t) => (t as HTMLTextAreaElement).value)
        .filter(Boolean);
      const selectedTags = Array.from(document.querySelectorAll("button"))
        .filter(
          (b) =>
            (b.className.includes("bg-emerald-600") || b.className.includes("bg-amber-600")) &&
            b.className.includes("font-bold")
        )
        .map((b) => (b.textContent || "").trim());
      return { notes, selectedTags };
    });
    assert.ok(
      commentPageAudit.notes.some(
        (v) =>
          v.includes("phát biểu xây dựng bài (2 lần)") &&
          v.includes("+ Nói chuyện riêng (1 lần)") &&
          v.includes("Lập trình thêm hiệu ứng nút bấm đẹp")
      ),
      `[CM-05] Ô Ghi chú của GV trên /session-comments phải có sẵn nội dung từ Quản lý Giờ học (nhận được: ${JSON.stringify(
        commentPageAudit.notes
      )})`
    );
    assert.ok(
      commentPageAudit.selectedTags.some((t) => t.includes("Hăng hái phát biểu")) &&
        commentPageAudit.selectedTags.some((t) => t.includes("Mất tập trung")),
      `[CM-05] Quick Tags trên /session-comments phải tự động tích sẵn (nhận được: ${JSON.stringify(
        commentPageAudit.selectedTags
      )})`
    );

    assert.deepEqual(
      consoleErrors,
      [],
      `[CM-05] Không được có console.error trên trình duyệt: ${consoleErrors.join(" | ")}`
    );
    assert.deepEqual(
      pageErrors,
      [],
      `[CM-05] Không được có pageerror trên trình duyệt: ${pageErrors.join(" | ")}`
    );

    console.log("\n✅ TẤT CẢ KIỂM THỬ v3.6.7 [CM-01..CM-05] ĐỀU ĐẠT 100%!");
  } catch (err) {
    if (serverLogs && serverLogs.length > 0) {
      console.error("\n--- NEXT DEV SERVER LOGS (LAST 25 LINES) ---");
      console.error(serverLogs.join("").split(/\r?\n/).slice(-25).join("\n"));
    }
    throw err;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    killProcessTree(nextServer);
    closeDb();
    try {
      if (origNextEnvDts !== null) {
        fs.writeFileSync(nextEnvPath, origNextEnvDts);
      }
      fs.rmSync(e2eDistAbs, { recursive: true, force: true });
      fs.rmSync(e2eTsconfigAbs, { force: true });
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error("❌ KIỂM THỬ v3.6.7 THẤT BẠI:", err);
  process.exit(1);
});
