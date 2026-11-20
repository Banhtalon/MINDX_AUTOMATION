/**
 * KIỂM THỬ TOÀN DIỆN v3.6.8 — HUY HIỆU TOP 3 XUẤT SẮC (CÁCH A2), LỖI XUỐNG DÒNG `+ ` & VĂN PHONG AI MẪU 1 THẲNG THẮN
 *
 * Bao phủ:
 * - [V368-01] Quy tắc Top 3 Huy hiệu Cách A2: tự động Top 3 (stars >= 1), ưu tiên ít lỗi khi bằng Sao,
 *             gỡ tay nhường suất, ghim tay tối đa 3 bạn & báo lỗi bạn thứ 4, bền vững qua save/reload/tích lũy 14 buổi.
 * - [V368-02] Xuống dòng `+ ` trong buildClassroomToCommentMapping & Buổi 14 flattened summary (Hoàng Minh Nhật, Hà Nhật Minh, Phương Anh).
 * - [V368-03] CommentGenerator Mẫu 1: tách lỗi cũ & mới, ẩn danh PII 100%, chuẩn hóa inline `+ ` xuống dòng,
 *             chốt chặn 0 bỏ sót lỗi (kể cả khi AI bỏ quên Làm việc riêng / Nói chuyện), và khớp Quill DOM Read-after-Write 100%.
 * - [V368-04] E2E Headless Chromium thật (127.0.0.1:3098): Top 3 auto/toggle/cap banner, Chiếu lớp học `Xuất sắc: X/3`,
 *             Summary Modal `whitespace-pre-line`, và nạp multi-line sang /session-comments.
 *
 * Chạy 100% cô lập trong `os.tmpdir()` — KHÔNG chạm dữ liệu thật trong `data/`.
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

async function waitForHttpReady(url: string, timeoutMs = 60000): Promise<void> {
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
      spawnSync("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { stdio: "ignore" });
    } else {
      proc.kill("SIGKILL");
    }
  } catch {}
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-v368-"));
  const tmpConfigDir = path.join(tmpRoot, "config");
  const tmpDbPath = path.join(tmpRoot, "test_v368.db");
  const tmpRunningClassesPath = path.join(tmpRoot, "running_classes.json");
  fs.mkdirSync(tmpConfigDir, { recursive: true });

  const realConfigDir = path.join(process.cwd(), "data", "config");
  for (const cfgFile of ["courses_syllabus.json", "quick_tags.json"]) {
    const srcPath = path.join(realConfigDir, cfgFile);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, path.join(tmpConfigDir, cfgFile));
    }
  }

  process.env.ALLOWED_LOCAL_DIRS = tmpRoot;
  process.env.MINDX_ALLOWED_EXTRA_PATHS = tmpRoot;
  process.env.MINDX_DB_PATH = tmpDbPath;
  process.env.MINDX_CONFIG_DIR = tmpConfigDir;
  process.env.MINDX_RUNNING_CLASSES_PATH = tmpRunningClassesPath;
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "TEST_V368_DUMMY_KEY";

  const {
    classSessionRepo,
    closeDb,
    session14EvalRepo,
    sessionFeedbackRepo,
    studentRepo,
  } = await import("../src/lib/db/sqlite");
  const { saveRunningClasses } = await import("../src/lib/db/json-config");
  const {
    buildClassroomToCommentMapping,
    computeCourseAccumulationSummary,
    reconcileTop3ClassMedals,
    toggleStudentTop3Medal,
  } = await import("../src/lib/classroom/classroom-manager-helpers");
  const {
    CommentGenerator,
    extractRecordedIssuesForPrompt,
    normalizeCandidImprovementsWithPlusBullets,
  } = await import("../src/lib/gemini/comment-generator");
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
  const testPort = 3098;
  const e2eDistRel = `.next/e2e-test-${testPort}`;
  const e2eDistAbs = path.join(process.cwd(), e2eDistRel);
  const e2eTsconfigRel = `.next/e2e-tsconfig-${testPort}.json`;
  const e2eTsconfigAbs = path.join(process.cwd(), e2eTsconfigRel);

  try {
    console.log("🚀 BẮT ĐẦU KIỂM THỬ v3.6.8 (Khu vực cô lập):", tmpRoot);

    const classId = "VT-C4K-PTI98";
    const sessionNum = 3;
    const sessionId = `${classId}_SESS_${sessionNum}`;

    saveRunningClasses([
      {
        classCode: classId,
        courseName: "App Producer Intensive (Test)",
        status: "Running",
      },
    ]);

    const ptiRoster = [
      { studentId: "STU_PA", fullName: "Nguyễn Trần Phương Anh" },
      { studentId: "STU_HNM", fullName: "Hà Nhật Minh" },
      { studentId: "STU_HMN", fullName: "Hoàng Minh Nhật" },
      { studentId: "STU_DGA", fullName: "Đinh Gia An" },
      { studentId: "STU_TGK", fullName: "Trịnh Gia Khang" },
      { studentId: "STU_ABS", fullName: "Võ Trí Dũng" },
    ];
    for (const s of ptiRoster) {
      studentRepo.upsert({
        studentId: s.studentId,
        classId,
        fullName: s.fullName,
        isActive: 1,
      });
    }

    classSessionRepo.upsert({
      classId,
      className: classId,
      sessionId,
      sessionNumber: sessionNum,
      topic: "Danh sách đối tượng trong Python",
      date: "2026-11-20",
    });

    // =========================================================================
    // [V368-01] Top 3 Medals (Rule A2): Auto, Tie-break, Manual Remove/Pin & Cap
    // =========================================================================
    console.log("\n[V368-01] Kiểm tra quy tắc Top 3 Huy hiệu (Cách A2)...");
    const seedRoster: ClassroomStudentState[] = [
      {
        studentId: "STU_PA",
        fullName: "Nguyễn Trần Phương Anh",
        attendanceStatus: "PRESENT",
        stars: 9,
        medals: 0,
        praiseCounts: { phat_bieu: 7, lam_tot: 2 },
        issueCounts: { chua_btvn: 1, noi_chuyen: 1 },
        teacherQuickNote: "",
      },
      {
        studentId: "STU_HNM",
        fullName: "Hà Nhật Minh",
        attendanceStatus: "PRESENT",
        stars: 5,
        medals: 0,
        praiseCounts: { phat_bieu: 3, lam_tot: 2 },
        issueCounts: { khong_chu_y: 2, viec_rieng: 1, chua_btvn: 1 }, // 4 issues
        teacherQuickNote: "",
      },
      {
        studentId: "STU_DGA",
        fullName: "Đinh Gia An",
        attendanceStatus: "PRESENT",
        stars: 5,
        medals: 0,
        praiseCounts: { phat_bieu: 5 },
        issueCounts: {}, // 0 issues -> beats HNM when tied at 5 stars!
        teacherQuickNote: "",
      },
      {
        studentId: "STU_TGK",
        fullName: "Trịnh Gia Khang",
        attendanceStatus: "PRESENT",
        stars: 3,
        medals: 0,
        praiseCounts: { phat_bieu: 3 },
        issueCounts: {},
        teacherQuickNote: "",
      },
      {
        studentId: "STU_HMN",
        fullName: "Hoàng Minh Nhật",
        attendanceStatus: "LATE",
        stars: 0,
        medals: 0,
        praiseCounts: {},
        issueCounts: {
          di_muon: 1,
          noi_chuyen: 1,
          khong_chu_y: 1,
          viec_rieng: 1,
          roi_cho: 1,
          chua_btvn: 1,
        },
        teacherQuickNote: "",
      },
      {
        studentId: "STU_ABS",
        fullName: "Võ Trí Dũng",
        attendanceStatus: "ABSENT",
        stars: 12,
        medals: 1,
        praiseCounts: { huy_hieu: 1 },
        issueCounts: {},
        teacherQuickNote: "",
      },
    ];

    const autoReconciled = reconcileTop3ClassMedals(seedRoster);
    const medalById = (rows: ClassroomStudentState[]) =>
      new Map(rows.map((r) => [r.studentId, r.medals]));
    const m1 = medalById(autoReconciled);
    assert.equal(m1.get("STU_PA"), 1, "[V368-01] Phương Anh (9 sao) #1 -> Top 3");
    assert.equal(m1.get("STU_DGA"), 1, "[V368-01] Gia An (5 sao, 0 lỗi) #2 -> Top 3");
    assert.equal(m1.get("STU_HNM"), 1, "[V368-01] Hà Nhật Minh (5 sao, 4 lỗi) #3 -> Top 3");
    assert.equal(m1.get("STU_TGK"), 0, "[V368-01] Gia Khang (3 sao) #4 -> ngoài Top 3");
    assert.equal(m1.get("STU_HMN"), 0, "[V368-01] Hoàng Minh Nhật (0 sao) -> 0 huy hiệu");
    assert.equal(m1.get("STU_ABS"), 0, "[V368-01] Vắng mặt luôn 0 huy hiệu");
    assert.equal(
      autoReconciled.reduce((acc, r) => acc + r.medals, 0),
      3,
      "[V368-01] Tổng Huy hiệu cả lớp đúng 3"
    );

    // Zero stars case: students with 0 stars NEVER auto-receive medals even if < 3 winners
    const allZero = reconcileTop3ClassMedals(
      seedRoster.slice(4, 5) // HMN only (0 stars)
    );
    assert.equal(allZero[0].medals, 0, "[V368-01] Không tự động trao Huy hiệu cho bạn 0 sao");

    // Toggle OFF Hà Nhật Minh (5 stars, 4 issues) -> S4 (Gia Khang, 3 stars) inherits 3rd medal!
    const toggledOffHnm = toggleStudentTop3Medal(autoReconciled, "STU_HNM", "toggle");
    assert.equal(toggledOffHnm.changed, true);
    const m2 = medalById(toggledOffHnm.rows);
    assert.equal(m2.get("STU_HNM"), 0, "[V368-01] Sau khi gỡ, Hà Nhật Minh mất Huy hiệu");
    assert.equal(m2.get("STU_TGK"), 1, "[V368-01] Sau khi gỡ Hà Nhật Minh, suất thứ 3 tự nhường cho Gia Khang (3 sao)");
    assert.equal(
      toggledOffHnm.rows.find((r) => r.studentId === "STU_HNM")?.praiseCounts.huy_hieu_off,
      1,
      "[V368-01] Cờ huy_hieu_off được đặt để giữ bền"
    );

    // Zero-star student CANNOT be manually pinned to Top 3
    const zeroStarPin = toggleStudentTop3Medal(autoReconciled, "STU_HMN", "toggle");
    assert.equal(zeroStarPin.changed, false, "[V368-01] Học viên 0 sao không được nhận Huy hiệu kể cả bấm tay");
    assert.ok(
      zeroStarPin.limitReachedError?.includes("tối thiểu 1"),
      "[V368-01] Phải thông báo cần tối thiểu 1 sao mới nhận Huy hiệu Top 3"
    );

    // Pin 3 eligible (>=1 star) manual winners -> trying to pin a 4th MUST fail with limitReachedError
    const eligibleRoster = autoReconciled.map((r) =>
      r.studentId === "STU_HMN" ? { ...r, stars: 1 } : r
    );
    let pinnedRows = eligibleRoster;
    for (const pid of ["STU_PA", "STU_DGA", "STU_TGK"]) {
      pinnedRows = pinnedRows.map((r) =>
        r.studentId === pid ? { ...r, praiseCounts: { ...r.praiseCounts, huy_hieu: 1 } } : r
      );
    }
    const overPinAttempt = toggleStudentTop3Medal(pinnedRows, "STU_HMN", "toggle");
    assert.equal(overPinAttempt.changed, false, "[V368-01] Đã ghim đủ 3 bạn -> chặn ghim bạn thứ 4");
    assert.ok(
      overPinAttempt.limitReachedError?.includes("tối đa 3 Huy hiệu"),
      "[V368-01] Báo rõ lý do giới hạn tối đa 3 Huy hiệu"
    );

    // Course accumulation summary reconciles legacy/unreconciled session medals cleanly
    const accRows = computeCourseAccumulationSummary(
      ptiRoster,
      autoReconciled.map((r) => ({
        studentId: r.studentId,
        sessionNumber: sessionNum,
        attendanceStatus: r.attendanceStatus,
        stars: r.stars,
        medals: r.medals,
        praiseCountsJson: JSON.stringify(r.praiseCounts),
        issueCountsJson: JSON.stringify(r.issueCounts),
      }))
    );
    assert.equal(accRows.find((r) => r.studentId === "STU_PA")?.totalMedals, 1);
    assert.equal(accRows.find((r) => r.studentId === "STU_ABS")?.totalMedals, 0);

    // Persist through savePOST & verify stateGET persists huy_hieu_off + Top 3 A2
    const localHeaders = { host: "127.0.0.1:3000", "Content-Type": "application/json" };
    const saveRes = await savePOST(
      new Request("http://127.0.0.1:3000/api/classroom-manager/save", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({
          classId,
          sessionNumber: sessionNum,
          items: toggledOffHnm.rows.map((r) => ({
            studentId: r.studentId,
            attendanceStatus: r.attendanceStatus,
            stars: r.stars,
            medals: r.medals,
            praiseCounts: r.praiseCounts,
            issueCounts: r.issueCounts,
            teacherQuickNote: r.teacherQuickNote,
            expectedRowVer: 0,
          })),
        }),
      })
    );
    assert.equal(saveRes.status, 200);
    const saveJson = await saveRes.json();
    const stateRes = await stateGET(
      new Request(
        `http://127.0.0.1:3000/api/classroom-manager/state?classId=${classId}&sessionNumber=${sessionNum}`,
        { headers: localHeaders }
      )
    );
    const stateJson = await stateRes.json();
    const reloadedById = new Map<string, ClassroomStudentState>(
      (stateJson.data.students as ClassroomStudentState[]).map((s) => [s.studentId, s])
    );
    assert.equal(reloadedById.get("STU_HNM")?.medals, 0, "[V368-01] Reload vẫn giữ nguyên đã gỡ Hà Nhật Minh");
    assert.equal(reloadedById.get("STU_TGK")?.medals, 1, "[V368-01] Reload vẫn giữ Gia Khang trong Top 3");
    assert.equal(saveJson.data.students.reduce((a: number, b: any) => a + b.medals, 0), 3);

    // =========================================================================
    // [V368-02] `+ ` Multi-line Issues Mapping & Session 14 Normalization
    // =========================================================================
    console.log("\n[V368-02] Kiểm tra mapping ghi chú `+ ` từng dòng & Buổi 14...");
    const mapPa = buildClassroomToCommentMapping({
      classCode: classId,
      sessionNumber: sessionNum,
      studentRow: autoReconciled.find((r) => r.studentId === "STU_PA")!,
    });
    assert.ok(
      mapPa.teacherNote.includes("nhận Huy hiệu Top 3 học viên xuất sắc nhất lớp"),
      `[V368-02] Phương Anh phải có danh hiệu Top 3: ${mapPa.teacherNote}`
    );
    assert.ok(
      mapPa.teacherNote.includes(
        "Cần chấn chỉnh:\n+ Chưa hoàn thành BTVN trước buổi học\n+ Nói chuyện riêng (1 lần)"
      ),
      `[V368-02] Phương Anh phải xuống dòng + cho lỗi: ${mapPa.teacherNote}`
    );

    const mapHmn = buildClassroomToCommentMapping({
      classCode: classId,
      sessionNumber: sessionNum,
      studentRow: autoReconciled.find((r) => r.studentId === "STU_HMN")!,
    });
    assert.ok(
      mapHmn.teacherNote.includes(
        "Cần chấn chỉnh:\n+ Đi học muộn\n+ Chưa hoàn thành BTVN trước buổi học\n+ Nói chuyện riêng (1 lần)\n+ Mất tập trung khi nghe giảng (1 lần)\n+ Làm việc riêng trong giờ (1 lần)\n+ Tự ý rời khỏi chỗ ngồi (1 lần)"
      ),
      `[V368-02] Hoàng Minh Nhật phải liệt kê đủ 6 dòng + theo thứ tự chuẩn:\n${mapHmn.teacherNote}`
    );

    const applyRes = await applyPOST(
      new Request("http://127.0.0.1:3000/api/classroom-manager/apply-to-comments", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({ classId, sessionNumber: sessionNum }),
      })
    );
    assert.equal(applyRes.status, 200);
    const fbHmnDb = sessionFeedbackRepo.findOne(classId, sessionId, "STU_HMN");
    assert.ok(fbHmnDb?.teacherNote?.includes("\n+ Làm việc riêng trong giờ (1 lần)"));

    // Session 14: flattens "+ " bullets cleanly to single line
    session14EvalRepo.saveDraft({ classId, studentId: "STU_PA", teacherNote: "Slide rõ nét." });
    await applyPOST(
      new Request("http://127.0.0.1:3000/api/classroom-manager/apply-to-comments", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({
          classId,
          sessionNumber: 14,
          items: [
            {
              studentId: "STU_PA",
              attendanceStatus: "PRESENT",
              stars: 9,
              medals: 1,
              praiseCounts: { phat_bieu: 7, lam_tot: 2 },
              issueCounts: { chua_btvn: 1, noi_chuyen: 1 },
              teacherQuickNote: "",
            },
          ],
        }),
      })
    );
    const eval14Pa = session14EvalRepo.findOne(classId, "STU_PA");
    assert.ok(
      eval14Pa?.teacherNote?.includes("[Giờ học B14]") &&
        eval14Pa?.teacherNote?.includes("Chưa hoàn thành BTVN trước buổi học; Nói chuyện riêng (1 lần)"),
      `[V368-02] Buổi 14 phải gộp thành 1 dòng gọn không còn dấu \\n+: ${eval14Pa?.teacherNote}`
    );

    // =========================================================================
    // [V368-03] AI Sample 1 Prompt, 0-Omission Guard & Quill DOM Consistency
    // =========================================================================
    console.log("\n[V368-03] Kiểm tra CommentGenerator Mẫu 1, 0 bỏ sót lỗi & Quill DOM...");
    const mapHnm = buildClassroomToCommentMapping({
      classCode: classId,
      sessionNumber: sessionNum,
      studentRow: reloadedById.get("STU_HNM")!,
    });
    const legacyHmnNote =
      "Cần lưu ý: đi học muộn, nói chuyện riêng (1 lần), mất tập trung khi nghe giảng (1 lần), làm việc riêng trong giờ (1 lần), tự ý rời khỏi chỗ ngồi (1 lần), chưa hoàn thành BTVN trước buổi học.";
    const extractedLegacy = extractRecordedIssuesForPrompt(legacyHmnNote, ["👀 Mất tập trung"], "LATE");
    assert.equal(
      extractedLegacy.explicitClassroomBullets.length,
      6,
      "[V368-03] Phải đọc đủ cả 6 lỗi từ định dạng Cần lưu ý cũ trong DB"
    );

    const extractedHnm = extractRecordedIssuesForPrompt(mapHnm.teacherNote, mapHnm.quickTags, "PRESENT");
    assert.equal(extractedHnm.explicitClassroomBullets.length, 3);
    assert.equal(extractedHnm.hasIssuesToCorrect, true);

    const extractedSpotless = extractRecordedIssuesForPrompt(
      "Tham gia buổi học đầy đủ, tập trung nghe giảng và thực hành nghiêm túc trên lớp.",
      ["✅ Tiếp thu tốt", "📝 Làm bài tập đầy đủ"],
      "PRESENT"
    );
    assert.equal(extractedSpotless.hasIssuesToCorrect, false);

    // Test inline split & missing-error repair directly
    const inlineAi = normalizeCandidImprovementsWithPlusBullets(
      "Bên cạnh khả năng tiếp thu tốt, con vẫn cần chấn chỉnh: + **Chưa hoàn thành BTVN** trước buổi học. + **Mất tập trung khi nghe giảng (2 lần)** lúc thầy giảng.",
      extractedHnm // Has 3 issues: chua_btvn, khong_chu_y(2), viec_rieng(1)!
    );
    assert.ok(inlineAi.includes("\n  + **Chưa hoàn thành BTVN**"), "[V368-03] Tách inline + thành xuống dòng");
    assert.ok(
      inlineAi.includes("Mất tập trung khi nghe giảng (2 lần)"),
      "[V368-03] Giữ đúng ý mất tập trung (2 lần)"
    );
    assert.ok(
      inlineAi.includes("\n  + **Làm việc riêng trong giờ (1 lần)**"),
      "[V368-03] AI bỏ sót Làm việc riêng -> chốt chặn tự bổ sung đủ 100%"
    );

    // Mixed Finding 3 check: explicit note ("Đi học muộn") + Quick Tag ("👀 Mất tập trung") where AI wrote only Đi học muộn bullet
    const mixedExtracted = extractRecordedIssuesForPrompt(
      "Cần chấn chỉnh:\n+ Đi học muộn",
      ["👀 Mất tập trung"],
      "LATE"
    );
    assert.equal(mixedExtracted.recordedIssues.length, 2);
    const mixedFixed = normalizeCandidImprovementsWithPlusBullets(
      "Con cần rút kinh nghiệm buổi sau:\n  + **Đi học muộn** nên bắt nhịp chậm.",
      mixedExtracted
    );
    assert.ok(
      mixedFixed.includes("Đi học muộn") && mixedFixed.includes("\n  + **Mất tập trung**"),
      `[V368-03] Mixed note + Quick Tag không được bỏ sót thẻ Mất tập trung:\n${mixedFixed}`
    );

    // End-to-end CommentGenerator with mocked Gemini fetch verifying PII + Mẫu 1 post-guard
    let capturedPrompt = "";
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: any, init?: any) => {
      const bodyStr = typeof init?.body === "string" ? init.body : "";
      capturedPrompt = bodyStr;
      const payload = {
        feedbacks: [
          {
            anonymousId: "STUDENT_01",
            strengths:
              "Khi có thầy kèm sát, con vẫn thực hiện được thao tác tạo danh sách **List trong Python**.",
            improvements:
              "Hôm nay ý thức kỷ luật và sự chuẩn bị bài của con chưa tốt, thầy xin phản ánh thẳng thắn để gia đình nắm rõ:\n  + **Đi học muộn** nên bỏ lỡ phần ôn bài đầu giờ.\n  + **Chưa hoàn thành BTVN** trước buổi học.\n  + **Nói chuyện riêng (1 lần)** và **mất tập trung (1 lần)** khi thầy giảng.\n  + **Làm việc riêng (1 lần)** trong giờ.\n  + **Tự ý rời khỏi chỗ ngồi (1 lần)** khi cả lớp thực hành.",
            actionPlan:
              "Nhờ ba mẹ nhắc con **đi học đúng giờ**, chấn chỉnh tác phong và **làm đầy đủ BTVN** trước buổi tới.",
            formattedFullComment: "PLACEHOLDER_WILL_SYNC",
          },
          {
            anonymousId: "STUDENT_02",
            strengths:
              "Con tư duy nhanh, **phát biểu 3 lần** và làm tốt thực hành **danh sách Python** (đạt **5 sao**).",
            improvements:
              "Dù học nhanh nhưng ý thức tự giác của con chưa tốt: + **Chưa hoàn thành BTVN** trước buổi học. + **Mất tập trung khi nghe giảng (2 lần)**.", // Purposely omitted Làm việc riêng + inline "+"!
            actionPlan:
              "Ba mẹ đôn đốc con **hoàn thành đủ BTVN** và nhắc con **giữ tập trung, không làm việc riêng**.",
            formattedFullComment: "PLACEHOLDER_WILL_SYNC",
          },
          {
            anonymousId: "STUDENT_03",
            strengths:
              "Con học tập tập trung, nắm vững kiến thức **Danh sách đối tượng trong Python**.",
            improvements:
              "Con có thể thử sức thêm các bài tập mở rộng để tăng tốc độ viết code.",
            actionPlan:
              "Ba mẹ khuyến khích con **tự luyện thêm các ví dụ về List** tại nhà.",
            formattedFullComment:
              "- **Điểm mạnh của học viên:** Con học tập tập trung, nắm vững kiến thức **Danh sách đối tượng trong Python**.\n\n- **Điểm cần cải thiện:** Con có thể thử sức thêm các bài tập mở rộng để tăng tốc độ viết code.\n\n- **Lời khuyên:** Ba mẹ khuyến khích con **tự luyện thêm các ví dụ về List** tại nhà.",
          },
        ],
      };
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as any;

    let aiOut: any[] = [];
    try {
      aiOut = await CommentGenerator.generateBatchComments(
        {
          classId,
          classCode: classId,
          sessionId,
          sessionNumber: sessionNum,
          topic: "Danh sách đối tượng trong Python",
          keyKnowledge: ["Ôn tập List", "Duyệt phần tử"],
        },
        [
          {
            studentId: "STU_HMN",
            fullName: "Hoàng Minh Nhật",
            isActive: true,
            attendanceStatus: "LATE",
            quickTags: mapHmn.quickTags,
            teacherNote: mapHmn.teacherNote,
          },
          {
            studentId: "STU_HNM",
            fullName: "Hà Nhật Minh",
            isActive: true,
            attendanceStatus: "PRESENT",
            quickTags: mapHnm.quickTags,
            teacherNote: mapHnm.teacherNote,
          },
          {
            studentId: "STU_DGA",
            fullName: "Đinh Gia An",
            isActive: true,
            attendanceStatus: "PRESENT",
            quickTags: ["✅ Tiếp thu tốt", "📝 Làm bài tập đầy đủ"],
            teacherNote: "Tham gia buổi học đầy đủ, tập trung nghe giảng và thực hành nghiêm túc trên lớp.",
          },
        ]
      );
    } finally {
      globalThis.fetch = origFetch;
    }

    // Check PII anonymization
    for (const realName of ["Hoàng Minh Nhật", "Hà Nhật Minh", "Đinh Gia An"]) {
      assert.equal(
        capturedPrompt.includes(realName),
        false,
        `[V368-03] TUYỆT ĐỐI không được rò rỉ tên thật "${realName}" lên Gemini`
      );
    }
    assert.ok(capturedPrompt.includes("recordedIssues"), "[V368-03] Prompt phải truyền recordedIssues");
    assert.ok(capturedPrompt.includes("Văn phong Mẫu 1"), "[V368-03] Prompt phải dùng Mẫu 1");

    const hmnOut = aiOut.find((r) => r.studentId === "STU_HMN")!;
    const hnmOut = aiOut.find((r) => r.studentId === "STU_HNM")!;
    const dgaOut = aiOut.find((r) => r.studentId === "STU_DGA")!;

    assert.ok(
      hnmOut.formattedFullComment.includes("\n  + **Chưa hoàn thành BTVN**") &&
        hnmOut.formattedFullComment.includes("\n  + **Làm việc riêng trong giờ (1 lần)**"),
      `[V368-03] Hà Nhật Minh phải tách dòng + và tự bổ sung Làm việc riêng:\n${hnmOut.formattedFullComment}`
    );
    assert.equal(
      dgaOut.formattedFullComment.includes("\n  + "),
      false,
      "[V368-03] Bạn ngoan 0 lỗi không được tự bịa dòng + vi phạm"
    );

    // Verify Quill Read-after-Write DOM normalization equivalence on multi-line Sample 1 comment
    const linesForQuill = hmnOut.formattedFullComment
      .split(/\r?\n/)
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 0);
    assert.ok(linesForQuill.length >= 8, "[V368-03] Comment 6 lỗi của HMN phải tách >= 8 đoạn <p> riêng trong Quill");
    const simulatedQuillInnerText = linesForQuill
      .map((l: string) => l.replace(/\*\*([^*\n]+)\*\*/g, "$1"))
      .join("\n");
    const expectedPlainNorm = hmnOut.formattedFullComment
      .replace(/\*\*([^*\n]+)\*\*/g, "$1")
      .normalize("NFC")
      .replace(/\s+/g, " ")
      .trim();
    const domCandidateNorm = simulatedQuillInnerText.normalize("NFC").replace(/\s+/g, " ").trim();
    assert.equal(
      domCandidateNorm,
      expectedPlainNorm,
      "[V368-03] Văn bản đọc lại từ Quill LMS phải khớp 100% với bản nhiều dòng `+ `!"
    );

    // =========================================================================
    // [V368-04] Live Headless Chromium E2E on port 3098
    // =========================================================================
    console.log("\n[V368-04] Khởi chạy trình duyệt thật kiểm tra Top 3 A2, Projector & Summary Modal...");
    closeDb();

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

    await waitForHttpReady(
      `${baseUrl}/api/classroom-manager/state?classId=${classId}&sessionNumber=${sessionNum}`,
      60000
    );

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await context.addInitScript("globalThis.__name = globalThis.__name || ((x) => x);");
    const page = await context.newPage();

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto(
      `${baseUrl}/classroom-manager?classId=${classId}&sessionNumber=${sessionNum}`,
      { waitUntil: "domcontentloaded", timeout: 60000 }
    );
    await page.waitForSelector(`[data-testid="cm-student-row-STU_PA"]`, { timeout: 60000 });

    const kpiMedalsText = await page.textContent(`[data-testid="cm-kpi-medals"]`);
    assert.ok(
      kpiMedalsText?.includes("3/3"),
      `[V368-04] KPI Huy hiệu phải hiển thị dạng Top 3: X/3 (thực tế: ${kpiMedalsText})`
    );
    assert.ok(
      (await page.textContent(`[data-testid="cm-medal-box-STU_TGK"]`))?.includes("1"),
      "[V368-04] Sau khi gỡ HNM, Gia Khang đang nhận huy hiệu 1 trên UI"
    );

    // Clicking Top 3 on 0-star student (STU_HMN) MUST warn needing >= 1 star
    await page.click(`[data-testid="cm-praise-huy_hieu-STU_HMN"]`);
    await page.waitForSelector(`[role="alert"]`, { timeout: 5000 });
    const zeroPinText = await page.textContent(`[role="alert"]`);
    assert.ok(
      zeroPinText?.includes("tối thiểu 1"),
      `[V368-04] Phải nhắc cần tối thiểu 1 sao khi trao Top 3 cho bạn 0 sao: ${zeroPinText}`
    );
    await page.click(`[role="alert"] button`);

    // Give STU_HMN +1 star, then pin 3 students sequentially and verify clicking 4th shows cap alert!
    await page.click(`[data-testid="cm-praise-phat_bieu-STU_HMN"]`);
    await page.click(`[data-testid="cm-praise-huy_hieu-STU_HMN"]`); // Pin #1: Hoàng Minh Nhật (evicts STU_TGK)
    await page.click(`[data-testid="cm-praise-huy_hieu-STU_TGK"]`); // Pin #2: Gia Khang (evicts STU_DGA)
    await page.click(`[data-testid="cm-praise-huy_hieu-STU_DGA"]`); // Pin #3: Gia An (evicts STU_PA)
    await page.click(`[data-testid="cm-praise-huy_hieu-STU_PA"]`); // 4th pin attempt -> MUST show cap alert!
    await page.waitForSelector(`[role="alert"]`, { timeout: 5000 });
    const capAlertText = await page.textContent(`[role="alert"]`);
    assert.ok(
      capAlertText?.includes("tối đa 3 Huy hiệu"),
      `[V368-04] Phải báo lỗi khi ghim bạn thứ 4: ${capAlertText}`
    );
    // Clean up manual pins & revert STU_HMN temporary star, then re-enable STU_HNM
    await page.click(`[role="alert"] button`);
    await page.click(`[data-testid="cm-praise-huy_hieu-STU_HMN"]`); // unpin HMN -> STU_PA auto-restores
    await page.click(`[data-testid="cm-praise-phat_bieu-STU_HMN"]`, { button: "right" }); // revert star -> 0
    await page.click(`[data-testid="cm-praise-huy_hieu-STU_TGK"]`); // off TGK
    await page.click(`[data-testid="cm-praise-huy_hieu-STU_HNM"]`); // HNM back ON -> auto Top 3 (PA, DGA, HNM)!
    assert.ok(
      (await page.textContent(`[data-testid="cm-medal-box-STU_HNM"]`))?.includes("1"),
      "[V368-04] Bấm bật lại Hà Nhật Minh đưa HNM (5 sao) về Top 3"
    );

    // Enter Projector Mode -> verify Top 3 text and zero leaks
    await page.click(`[data-testid="cm-projector-toggle-btn"]`);
    await page.waitForSelector(`[data-testid="cm-projector-board"]`);
    const projText = await page.textContent(`[data-testid="cm-projector-board"]`);
    assert.ok(projText?.includes("Xuất sắc: 3/3") && projText?.includes("Top 3"));
    assert.equal(projText?.includes("Nói chuyện"), false);
    assert.equal(projText?.includes("Làm việc riêng"), false);
    await page.click(`[data-testid="cm-exit-projector-btn"]`);

    // Check Summary Modal shows multi-line "+ " teacherNote
    await page.click(`[data-testid="cm-open-summary-btn"]`);
    await page.waitForSelector(`[data-testid="cm-summary-modal"]`);
    const summaryText = await page.innerText(`[data-testid="cm-summary-modal"]`);
    assert.ok(
      summaryText.includes("+ Đi học muộn") && summaryText.includes("+ Làm việc riêng trong giờ"),
      "[V368-04] Bảng Tổng hợp cuối buổi phải hiển thị đầy đủ từng dòng + lỗi"
    );

    await page.click(`[data-testid="cm-apply-to-comments-btn"]`);
    await page.waitForURL((u) => u.pathname === "/session-comments", { timeout: 60000 });
    await page.waitForFunction(() => document.body.innerText.includes("Hoàng Minh Nhật"), {
      timeout: 60000,
    });

    const loadedNotes = await page.evaluate(() =>
      Array.from(document.querySelectorAll("textarea")).map((t) => (t as HTMLTextAreaElement).value)
    );
    assert.ok(
      loadedNotes.some(
        (v) =>
          v.includes("Cần chấn chỉnh:\n+ Đi học muộn") &&
          v.includes("\n+ Làm việc riêng trong giờ (1 lần)")
      ),
      "[V368-04] /session-comments phải nạp đủ các dòng + xuống dòng sạch trong Ghi chú GV"
    );

    assert.deepEqual(consoleErrors, [], `[V368-04] Không được có console.error: ${consoleErrors.join(" | ")}`);
    assert.deepEqual(pageErrors, [], `[V368-04] Không được có pageerror: ${pageErrors.join(" | ")}`);

    console.log("\n✅ TẤT CẢ KIỂM THỬ v3.6.8 [V368-01..V368-04] ĐỀU PASS 100%!");
  } catch (err) {
    if (serverLogs.length > 0) {
      console.error("\n--- NEXT DEV SERVER LOGS (LAST 25 LINES) ---");
      console.error(serverLogs.join("").split(/\r?\n/).slice(-25).join("\n"));
    }
    throw err;
  } finally {
    if (browser) await browser.close().catch(() => {});
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
  console.error("❌ KIỂM THỬ v3.6.8 THẤT BẠI:", err);
  process.exit(1);
});
