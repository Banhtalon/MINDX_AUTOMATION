/**
 * KIỂM THỬ TỰ ĐỘNG v3.8.2 — SỬA THANG ĐIỂM DEMO CSI, DỒN ĐIỂM BẢNG CŨ & CHỐT CHẶN TRƯỚC KHI LƯU LMS
 * - [CSI-01]: Xác minh 14/14 template barem Demo khớp 100% nhãn mục vs tổng trọng số Cột C (= 5.0),
 *             và CSI.xlsx chuẩn mới có C9:C12 = [0.5, 0.5, 0.5, 0.5] (2.0), C13:C16 = [0.125 x 4] (0.5),
 *             giữ nguyên công thức <f> và dropdown D9:D26.
 * - [CSI-02]: Xác minh getSession14DemoLimitsForClass & getDemoScoreItemsForClassUi cho CSI (2.0 / 0.5 / 1.0 / 1.0 / 0.5)
 *             và giữ nguyên thang điểm các khóa khác (CSA, PTA, JSB, GA, SB, Robotics).
 * - [CSI-03]: Xác minh cơ chế dồn điểm bảng cũ CSI (Cách 1) trên parseSession14DemoScores,
 *             extractDemoScoresFromWorksheet và session14EvalRepo.approveDraft (đủ 4 HV VT-CSI02 + bất biến
 *             lũy đẳng + đối kháng chặn số vượt khung + từ chối bảng CSI mới khi > 0.5).
 * - [CSI-04]: Xác minh Headless Chromium Session14EvalUploader:
 *             Case A: Ô LMS có max="0.5", điểm duyệt 1.0 -> dừng TRƯỚC khi bấm Save (saveClickCount === 0), đóng modal sạch.
 *             Case B: Ô LMS không có attr max nhưng React onInput/onChange/onBlur ép 1.0 -> 0.5 -> dừng TRƯỚC Save (saveClickCount === 0).
 *             Case C: Bộ điểm VT-CSI02 đã dồn (1.5, 0.5, 1, 1, 0.5) khớp trần LMS (2, 0.5, 1, 1, 0.5) -> Save=1, Read-after-Write -> VERIFIED.
 *
 * Chạy 100% cô lập trong `os.tmpdir()` — không chạm dữ liệu thật `data/` hay `./playwright-auth`.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { chromium } from "playwright";

function makeLegacyCsiSheetXml(opts: {
  studentName: string;
  eAlgo: number[];
  eCrea: number[];
  eComm: number[];
  eProb: number[];
  eComp: number[];
  cAlgo?: number[];
  cCrea?: number[];
  b32?: number;
  b34?: number;
  noFormulaB?: boolean;
}): string {
  const cA = opts.cAlgo ?? [0.5, 0.25, 0.25, 0.5];
  const cC = opts.cCrea ?? [0.25, 0.25, 0.25, 0.25];
  const rows: string[] = [];

  rows.push(`<row r="2"><c r="A2" t="inlineStr"><is><t>Họ và tên Học viên:</t></is></c><c r="B2" t="inlineStr"><is><t>${opts.studentName}</t></is></c></row>`);

  const pushCatRows = (startR: number, cWeights: number[], eVals: number[]) => {
    for (let i = 0; i < eVals.length; i++) {
      const r = startR + i;
      const cw = cWeights[i] ?? 0.25;
      rows.push(`<row r="${r}"><c r="C${r}"><v>${cw}</v></c><c r="E${r}"><v>${eVals[i]}</v></c></row>`);
    }
  };

  pushCatRows(9, cA, opts.eAlgo);
  pushCatRows(13, cC, opts.eCrea);
  pushCatRows(17, [0.25, 0.25, 0.25, 0.25], opts.eComm);
  pushCatRows(21, [0.25, 0.25, 0.25, 0.25], opts.eProb);
  pushCatRows(25, [0.25, 0.25], opts.eComp);

  if (opts.noFormulaB) {
    const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
    rows.push(`<row r="32"><c r="A32" t="inlineStr"><is><t>Tư duy máy tính, tư duy thuật toán</t></is></c><c r="B32"><v>${opts.b32 ?? sum(opts.eAlgo)}</v></c></row>`);
    rows.push(`<row r="33"><c r="A33" t="inlineStr"><is><t>Kỹ năng sử dụng máy tính</t></is></c><c r="B33"><v>${sum(opts.eComp)}</v></c></row>`);
    rows.push(`<row r="34"><c r="A34" t="inlineStr"><is><t>Tư duy sáng tạo</t></is></c><c r="B34"><v>${opts.b34 ?? sum(opts.eCrea)}</v></c></row>`);
    rows.push(`<row r="35"><c r="A35" t="inlineStr"><is><t>Giải quyết vấn đề</t></is></c><c r="B35"><v>${sum(opts.eProb)}</v></c></row>`);
    rows.push(`<row r="36"><c r="A36" t="inlineStr"><is><t>Kỹ năng giao tiếp, hợp tác</t></is></c><c r="B36"><v>${sum(opts.eComm)}</v></c></row>`);
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${rows.join("\n    ")}
  </sheetData>
  <mergeCells count="5">
    <mergeCell ref="A9:A12"/>
    <mergeCell ref="A13:A16"/>
    <mergeCell ref="A17:A20"/>
    <mergeCell ref="A21:A24"/>
    <mergeCell ref="A25:A26"/>
  </mergeCells>
</worksheet>`;
}

async function runTests() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-csi-v382-"));
  process.env.MINDX_DB_PATH = path.join(tempDir, "test_csi_v382.db");
  process.env.MINDX_RUNNING_CLASSES_PATH = path.join(tempDir, "running_classes.json");
  process.env.ALLOWED_LOCAL_DIRS = tempDir;
  process.env.MINDX_ALLOWED_EXTRA_PATHS = tempDir;

  const {
    getDb,
    getSession14DemoLimitsForClass,
    isCsiClassCode,
    parseSession14DemoScores,
    calculateDemoTotalScore,
    session14EvalRepo,
    studentRepo,
    computeSession14EvalHash,
    verifySession14EvalIntegrity,
  } = await import("../src/lib/db/sqlite");

  const { getDemoScoreItemsForClassUi } = await import("../src/lib/spck/spck-ui-helpers");
  const {
    parseSharedStringsXml,
    parseWorksheetCells,
    extractDemoScoresFromWorksheet,
  } = await import("../src/lib/local-files/spck-demo-score-reader");
  const {
    buildDemoScoringWorkbookBuffer,
    getDemoSheetTitleForClass,
  } = await import("../src/lib/playwright/spck-demo-sheet");
  const { extractDemoTemplateRubricStructure } = await import("../src/lib/gemini/spck-demo-sheet-scorer");
  const { LmsHelpers } = await import("../src/lib/playwright/lms-helpers");
  const { Session14EvalUploader } = await import("../src/lib/playwright/session14-eval-uploader");

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  const origCleanToast = LmsHelpers.ensureCleanDialogAndToast;
  const origEnsureSlot = LmsHelpers.ensureCommentsSlotReady;

  try {
    // =========================================================================
    // [CSI-01]: Verify all 14 templates + CSI.xlsx weights & XML integrity
    // =========================================================================
    console.log("\n[CSI-01] Kiểm tra 14/14 file mẫu bảng điểm và cấu trúc CSI.xlsx...");
    const tplDir = path.resolve(process.cwd(), "data", "config", "demo-sheet-templates");
    const tplFiles = fs.readdirSync(tplDir).filter((f) => f.endsWith(".xlsx")).sort();
    assert.strictEqual(tplFiles.length, 14, `Phải có đủ 14 mẫu khóa học, tìm thấy ${tplFiles.length}`);

    for (const file of tplFiles) {
      const zip = new AdmZip(path.join(tplDir, file));
      const ssXml = zip.getEntry("xl/sharedStrings.xml")?.getData().toString("utf8") || "";
      const ss = parseSharedStringsXml(ssXml);
      const sheetXml = zip.getEntry("xl/worksheets/sheet1.xml")?.getData().toString("utf8") || "";
      const cells = parseWorksheetCells(sheetXml, ss);

      const merges: Array<[number, number]> = [];
      const mRe = /<mergeCell\b[^>]*?\bref="A(\d+):A(\d+)"/gi;
      let m: RegExpExecArray | null;
      while ((m = mRe.exec(sheetXml)) !== null) {
        const r1 = Number(m[1]);
        const r2 = Number(m[2]);
        if (r1 >= 8) merges.push([r1, r2]);
      }
      merges.sort((a, b) => a[0] - b[0]);
      assert.strictEqual(merges.length, 5, `${file}: phải có đúng 5 nhóm tiêu chí gộp cột A`);

      let grandSum = 0;
      for (const [r1, r2] of merges) {
        const label = (cells.get(`A${r1}`)?.stringValue || "").replace(/\s+/g, " ").trim();
        const lm = label.match(/\(([\d.,]+)\s*điểm\)/i);
        const labelMax = lm ? Number(lm[1].replace(",", ".")) : Number.NaN;
        let colCSum = 0;
        for (let r = r1; r <= r2; r++) {
          const val = cells.get(`C${r}`)?.numericValue;
          if (val !== null && val !== undefined) colCSum += val;
        }
        colCSum = Math.round(colCSum * 1000) / 1000;
        grandSum += colCSum;
        assert.ok(
          Number.isFinite(labelMax) && Math.abs(labelMax - colCSum) < 1e-6,
          `${file} [A${r1}:A${r2}]: nhãn "${label}" (${labelMax}) khác tổng C (${colCSum})`
        );
      }
      assert.ok(Math.abs(grandSum - 5.0) < 1e-6, `${file}: tổng điểm mẫu phải bằng 5.0, nhận ${grandSum}`);
    }

    // Specific CSI.xlsx checks
    const csiZip = new AdmZip(path.join(tplDir, "CSI.xlsx"));
    const csiXml = csiZip.getEntry("xl/worksheets/sheet1.xml")!.getData().toString("utf8");
    const csiSs = parseSharedStringsXml(csiZip.getEntry("xl/sharedStrings.xml")!.getData().toString("utf8"));
    const csiCells = parseWorksheetCells(csiXml, csiSs);
    assert.deepEqual(
      [9, 10, 11, 12].map((r) => csiCells.get(`C${r}`)?.numericValue),
      [0.5, 0.5, 0.5, 0.5],
      "CSI.xlsx C9:C12 phải là [0.5, 0.5, 0.5, 0.5] (= 2.0)"
    );
    assert.deepEqual(
      [13, 14, 15, 16].map((r) => csiCells.get(`C${r}`)?.numericValue),
      [0.125, 0.125, 0.125, 0.125],
      "CSI.xlsx C13:C16 phải là [0.125, 0.125, 0.125, 0.125] (= 0.5)"
    );
    assert.ok(/<f t="shared" ref="E10:E19" si="0">/.test(csiXml), "Mất công thức shared E10:E19 trong CSI.xlsx");
    assert.ok(/<f t="shared" ref="E14:E17" si="1">/.test(csiXml), "Mất công thức shared E14:E17 trong CSI.xlsx");
    assert.ok(/sqref="D9:D26"/.test(csiXml), "Mất dropdown D9:D26 trong CSI.xlsx");
    console.log("  -> PASS [CSI-01].");

    // =========================================================================
    // [CSI-02]: Verify CSI limits & UI items + non-CSI untouched
    // =========================================================================
    console.log("\n[CSI-02] Kiểm tra trần điểm CSI (backend + UI) và các khóa khác...");
    assert.strictEqual(isCsiClassCode("VT-CSI02"), true);
    assert.strictEqual(isCsiClassCode("HCM-C4K-CSI10"), true);
    assert.strictEqual(isCsiClassCode("VT-CSA04-HB"), false);
    assert.strictEqual(isCsiClassCode("VT-ROB-ARMI13"), false);

    const expectedCsiLimits = {
      algorithm: 2.0,
      creativity: 0.5,
      communication: 1.0,
      problemSolving: 1.0,
      computerSkills: 0.5,
    };
    assert.deepEqual(getSession14DemoLimitsForClass("VT-CSI02"), expectedCsiLimits);
    const uiCsiItems = getDemoScoreItemsForClassUi("VT-CSI02", false);
    assert.deepEqual(
      Object.fromEntries(uiCsiItems.map((it) => [it.key, it.max])),
      expectedCsiLimits
    );
    // Verify non-CSI limits stay unchanged
    assert.deepEqual(getSession14DemoLimitsForClass("VT-CSA04-HB"), {
      algorithm: 2.0,
      creativity: 0.5,
      communication: 1.0,
      problemSolving: 0.75,
      computerSkills: 0.75,
    });
    assert.deepEqual(getSession14DemoLimitsForClass("VT-JSB16"), {
      algorithm: 1.5,
      creativity: 1.0,
      communication: 0.5,
      problemSolving: 1.0,
      computerSkills: 1.0,
    });
    assert.deepEqual(getSession14DemoLimitsForClass("VT-C4K-PTA13"), {
      algorithm: 1.5,
      creativity: 1.0,
      communication: 0.5,
      problemSolving: 1.0,
      computerSkills: 1.0,
    });
    console.log("  -> PASS [CSI-02].");

    // =========================================================================
    // [CSI-03]: Legacy CSI rebalancing + idempotency + adversarial + approveDraft
    // =========================================================================
    console.log("\n[CSI-03] Kiểm tra dồn điểm bảng cũ CSI (Cách 1), bất biến & chặn vượt trần...");
    const legacyStudents = [
      {
        name: "Bùi Nguyễn Nhật Quân",
        legacy: { algorithm: 1, creativity: 1, communication: 1, problemSolving: 1, computerSkills: 0.5 },
        expected: { algorithm: 1.5, creativity: 0.5, communication: 1, problemSolving: 1, computerSkills: 0.5 },
        total: 4.5,
        rawTotal3dp: 4.5,
        eAlgo: [0.5, 0.25, 0.25, 0],
        eCrea: [0.25, 0.25, 0.25, 0.25],
        eComm: [0.25, 0.25, 0.25, 0.25],
        eProb: [0.25, 0.25, 0.25, 0.25],
        eComp: [0.25, 0.25],
      },
      {
        name: "Kim Đắc Trường",
        legacy: { algorithm: 1, creativity: 1, communication: 0.88, problemSolving: 1, computerSkills: 0.5 },
        expected: { algorithm: 1.5, creativity: 0.5, communication: 0.88, problemSolving: 1, computerSkills: 0.5 },
        total: 4.38,
        rawTotal3dp: 4.375,
        eAlgo: [0.5, 0.25, 0.25, 0],
        eCrea: [0.25, 0.25, 0.25, 0.25],
        eComm: [0.25, 0.25, 0.25, 0.125],
        eProb: [0.25, 0.25, 0.25, 0.25],
        eComp: [0.25, 0.25],
      },
      {
        name: "Trần Minh Khang",
        legacy: { algorithm: 1, creativity: 1, communication: 0.88, problemSolving: 0.88, computerSkills: 0.5 },
        expected: { algorithm: 1.5, creativity: 0.5, communication: 0.88, problemSolving: 0.88, computerSkills: 0.5 },
        total: 4.26,
        rawTotal3dp: 4.25,
        eAlgo: [0.5, 0.25, 0.25, 0],
        eCrea: [0.25, 0.25, 0.25, 0.25],
        eComm: [0.25, 0.25, 0.25, 0.125],
        eProb: [0.25, 0.25, 0.25, 0.125],
        eComp: [0.25, 0.25],
      },
      {
        name: "Đặng Quang Thảo",
        legacy: { algorithm: 0.75, creativity: 0.88, communication: 0.75, problemSolving: 1, computerSkills: 0.5 },
        expected: { algorithm: 1.13, creativity: 0.5, communication: 0.75, problemSolving: 1, computerSkills: 0.5 },
        total: 3.88,
        rawTotal3dp: 3.875,
        eAlgo: [0.5, 0.25, 0, 0],
        eCrea: [0.25, 0.25, 0.25, 0.125],
        eComm: [0.25, 0.25, 0.25, 0],
        eProb: [0.25, 0.25, 0.25, 0.25],
        eComp: [0.25, 0.25],
      },
    ];

    for (const item of legacyStudents) {
      const parsed = parseSession14DemoScores(item.legacy, "VT-CSI02");
      assert.deepEqual(parsed, item.expected, `Dồn điểm JSON sai cho ${item.name}`);
      assert.strictEqual(calculateDemoTotalScore(parsed), item.total);
      // Idempotency: re-parsing normalized object produces identical values
      assert.deepEqual(parseSession14DemoScores(parsed, "VT-CSI02"), item.expected);

      // Legacy worksheet extraction test (preserves 3dp raw total AND rebalances 2dp)
      const legXml = makeLegacyCsiSheetXml({
        studentName: item.name,
        eAlgo: item.eAlgo,
        eCrea: item.eCrea,
        eComm: item.eComm,
        eProb: item.eProb,
        eComp: item.eComp,
      });
      const legCells = parseWorksheetCells(legXml, []);
      const extracted = extractDemoScoresFromWorksheet(legCells, "VT-CSI02", legXml);
      assert.strictEqual(extracted.hasCompleteScores, true, `Phải đọc đủ 5 tiêu chí legacy cho ${item.name}`);
      assert.deepEqual(extracted.demoScores, item.expected, `Dồn điểm XLSX sai cho ${item.name}`);
      assert.strictEqual(extracted.demoTotalScore, item.total);
      assert.strictEqual(extracted.demoRawTotalScore, item.rawTotal3dp);
    }

    // Perfect 5.0 legacy CSI
    assert.deepEqual(
      parseSession14DemoScores(
        { algorithm: 1.5, creativity: 1.0, communication: 1.0, problemSolving: 1.0, computerSkills: 0.5 },
        "VT-CSI02"
      ),
      { algorithm: 2.0, creativity: 0.5, communication: 1.0, problemSolving: 1.0, computerSkills: 0.5 }
    );

    // Adversarial checks
    assert.deepEqual(
      parseSession14DemoScores(
        { algorithm: 0, creativity: 99, communication: 0, problemSolving: 0, computerSkills: 0 },
        "VT-CSI02"
      ),
      { algorithm: 0, creativity: 0.5, communication: 0, problemSolving: 0, computerSkills: 0 },
      "creativity=99 ngoài biên (<=1.0) KHÔNG được phép cộng dồn sang algorithm"
    );
    assert.deepEqual(
      parseSession14DemoScores(
        { algorithm: 1.75, creativity: 0.75, communication: 0, problemSolving: 0, computerSkills: 0 },
        "VT-CSI02"
      ),
      { algorithm: 1.75, creativity: 0.5, communication: 0, problemSolving: 0, computerSkills: 0 },
      "algorithm=1.75 (>1.5, chuẩn mới) KHÔNG được cộng dồn từ creativity"
    );

    // Fixed new CSI sheet with B34 = 0.8 (> 0.5) must be rejected
    const badNewCsiXml = makeLegacyCsiSheetXml({
      studentName: "Test New CSI",
      cAlgo: [0.5, 0.5, 0.5, 0.5],
      cCrea: [0.125, 0.125, 0.125, 0.125],
      eAlgo: [0.5, 0.5, 0.5, 0],
      eCrea: [0.125, 0.125, 0.125, 0.125],
      eComm: [0.25, 0.25, 0.25, 0.25],
      eProb: [0.25, 0.25, 0.25, 0.25],
      eComp: [0.25, 0.25],
      b32: 1.5,
      b34: 0.8,
      noFormulaB: true,
    });
    const badExtracted = extractDemoScoresFromWorksheet(parseWorksheetCells(badNewCsiXml, []), "VT-CSI02", badNewCsiXml);
    assert.strictEqual(
      badExtracted.hasCompleteScores,
      false,
      "Bảng CSI chuẩn mới (trọng số C13:C16 = 0.5) có ô B34 = 0.8 phải bị từ chối!"
    );

    // Simulate legacy FAILED DB record for VT-CSI02 -> approveDraft auto-rebalances & keeps 4.5
    const db = getDb();
    const stuQuanId = "STU_VT-CSI02_BUI_NGUYEN_NHAT_QUAN";
    studentRepo.upsert({
      studentId: stuQuanId,
      classId: "VT-CSI02",
      fullName: "Bùi Nguyễn Nhật Quân",
      isActive: 1,
    });
    session14EvalRepo.saveDraft({
      classId: "VT-CSI02",
      studentId: stuQuanId,
      competencyScores: {
        knowledgeInClass: 4,
        knowledgeSelfStudy: 4,
        skillCommunication: 5,
        skillComputerUse: 4,
        skillProblemSolving: 4,
        skillCreativity: 4,
        skillComputational: 3,
        attitudeHomework: 3,
        attitudeInClass: 3,
      },
      learnedFromMindx: "Nhận xét\nĐiểm Demo: 4.5 điểm\nĐiểm Năng lực: 3.78 điểm",
      suggestionsFromMindx: "Tiếp tục phát huy.",
      futureDirection: "Tiếp tục các dự án AI chuyên sâu.",
    });
    // Force legacy JSON & FAILED status directly into isolated test DB like pre-v3.8.2 data
    db.prepare(
      `UPDATE spck_session14_evaluations
       SET demoScoresJson = ?, demoTotalScore = 4.5,
           learnedFromMindx = ?,
           status = 'FAILED', errorMessage = 'old mismatch'
       WHERE classId = 'VT-CSI02' AND studentId = ?`
    ).run(
      JSON.stringify(legacyStudents[0].legacy),
      "Nhận xét\nĐiểm Demo: 4.5 điểm\nĐiểm Năng lực: 3.78 điểm",
      stuQuanId
    );

    const beforeApp = session14EvalRepo.findOne("VT-CSI02", stuQuanId)!;
    const appRes = session14EvalRepo.approveDraft("VT-CSI02", stuQuanId, beforeApp.draftVersion);
    assert.strictEqual(appRes.success, true, `approveDraft thất bại: ${appRes.error}`);
    assert.strictEqual(appRes.record.status, "APPROVED");
    assert.strictEqual(appRes.record.demoTotalScore, 4.5);
    assert.deepEqual(JSON.parse(appRes.record.demoScoresJson), legacyStudents[0].expected);
    assert.strictEqual(verifySession14EvalIntegrity(appRes.record), true);
    assert.strictEqual(appRes.record.contentHash, computeSession14EvalHash(appRes.record));

    // [F02 Regression]: Legacy CSI record with 3dp demoRawTotalScore=4.375 must NOT be corrupted to 4.38
    // on unrelated saveDraft({ teacherNote }) or flushing unchanged rebalanced demoScores
    const stuTruongId = "STU_VT-CSI02_KIM_DAC_TRUONG";
    studentRepo.upsert({
      studentId: stuTruongId,
      classId: "VT-CSI02",
      fullName: "Kim Đắc Trường",
      isActive: 1,
    });
    session14EvalRepo.saveDraft({
      classId: "VT-CSI02",
      studentId: stuTruongId,
      learnedFromMindx: "Nhận xét\nĐiểm Demo: 4.38 điểm\nĐiểm Năng lực: 4 điểm",
      suggestionsFromMindx: "Tốt",
      futureDirection: "Tiếp tục",
    });
    db.prepare(
      `UPDATE spck_session14_evaluations
       SET demoScoresJson = ?, demoTotalScore = 4.38, demoRawTotalScore = 4.375,
           learnedFromMindx = ?, status = 'FAILED'
       WHERE classId = 'VT-CSI02' AND studentId = ?`
    ).run(
      JSON.stringify(legacyStudents[1].legacy),
      "Nhận xét\nĐiểm Demo: 4.38 điểm\nĐiểm Năng lực: 4 điểm",
      stuTruongId
    );
    const saveNoteRes = session14EvalRepo.saveDraft({
      classId: "VT-CSI02",
      studentId: stuTruongId,
      teacherNote: "Cập nhật ghi chú giáo viên",
    });
    assert.strictEqual(saveNoteRes.record.demoRawTotalScore, 4.375, "F02: saveDraft(teacherNote) làm hỏng demoRawTotalScore 3dp!");
    assert.deepEqual(JSON.parse(saveNoteRes.record.demoScoresJson), legacyStudents[1].expected);
    const saveSameDemoRes = session14EvalRepo.saveDraft({
      classId: "VT-CSI02",
      studentId: stuTruongId,
      demoScores: legacyStudents[1].expected,
    });
    assert.strictEqual(saveSameDemoRes.record.demoRawTotalScore, 4.375, "F02: saveDraft(unchanged rebalanced demoScores) làm hỏng demoRawTotalScore 3dp!");

    // [F03 Regression]: Fixed CSI.xlsx 0.125 * 0.5 = 0.0625 must NOT round per row to 0.063
    const newCsi4HtXml = makeLegacyCsiSheetXml({
      studentName: "Test 4x Hoan Thanh",
      cAlgo: [0.5, 0.5, 0.5, 0.5],
      cCrea: [0.125, 0.125, 0.125, 0.125],
      eAlgo: [0.5, 0.5, 0.5, 0.5],
      eCrea: [0.0625, 0.0625, 0.0625, 0.0625],
      eComm: [0.25, 0.25, 0.25, 0.25],
      eProb: [0.25, 0.25, 0.25, 0.25],
      eComp: [0.25, 0.25],
    }).replace(/<c r="E1[3-6]"><v>0\.0625<\/v><\/c>/g, (m, offset, str) => m)
      .replace(/<row r="(1[3-6])"><c r="C\1"><v>0\.125<\/v><\/c><c r="E\1"><v>0\.0625<\/v><\/c><\/row>/g,
        '<row r="$1"><c r="C$1"><v>0.125</v></c><c r="D$1" t="inlineStr"><is><t>Hoàn thành</t></is></c><c r="E$1"><v>0.0625</v></c></row>');
    const ext4Ht = extractDemoScoresFromWorksheet(parseWorksheetCells(newCsi4HtXml, []), "VT-CSI02", newCsi4HtXml);
    assert.strictEqual(ext4Ht.demoRawTotalScore, 4.75, `F03: 4x Hoàn thành trên 0.125 phải cho 4.750, nhận ${ext4Ht.demoRawTotalScore}`);

    // Tie check: (2x Tốt + 2x HT = 4.875) === (3x Tốt + 1x CĐ = 4.875)
    const tieAXml = makeLegacyCsiSheetXml({
      studentName: "Tie A",
      cAlgo: [0.5, 0.5, 0.5, 0.5],
      cCrea: [0.125, 0.125, 0.125, 0.125],
      eAlgo: [0.5, 0.5, 0.5, 0.5],
      eCrea: [0.125, 0.125, 0.0625, 0.0625],
      eComm: [0.25, 0.25, 0.25, 0.25],
      eProb: [0.25, 0.25, 0.25, 0.25],
      eComp: [0.25, 0.25],
    }).replace(/<row r="(1[34])"><c r="C\1"><v>0\.125<\/v><\/c><c r="E\1"><v>0\.125<\/v><\/c><\/row>/g,
      '<row r="$1"><c r="C$1"><v>0.125</v></c><c r="D$1" t="inlineStr"><is><t>Tốt</t></is></c></row>')
      .replace(/<row r="(1[56])"><c r="C\1"><v>0\.125<\/v><\/c><c r="E\1"><v>0\.0625<\/v><\/c><\/row>/g,
        '<row r="$1"><c r="C$1"><v>0.125</v></c><c r="D$1" t="inlineStr"><is><t>Hoàn thành</t></is></c></row>');
    const tieBXml = makeLegacyCsiSheetXml({
      studentName: "Tie B",
      cAlgo: [0.5, 0.5, 0.5, 0.5],
      cCrea: [0.125, 0.125, 0.125, 0.125],
      eAlgo: [0.5, 0.5, 0.5, 0.5],
      eCrea: [0.125, 0.125, 0.125, 0],
      eComm: [0.25, 0.25, 0.25, 0.25],
      eProb: [0.25, 0.25, 0.25, 0.25],
      eComp: [0.25, 0.25],
    });
    const extTieA = extractDemoScoresFromWorksheet(parseWorksheetCells(tieAXml, []), "VT-CSI02", tieAXml);
    const extTieB = extractDemoScoresFromWorksheet(parseWorksheetCells(tieBXml, []), "VT-CSI02", tieBXml);
    assert.strictEqual(extTieA.demoRawTotalScore, 4.875);
    assert.strictEqual(extTieB.demoRawTotalScore, 4.875);

    // Check buildDemoScoringWorkbookBuffer cached total F9 for 3x HT + 1x T on CSI.xlsx = 4.313 (not 4.314)
    const csiBuf = fs.readFileSync(path.join(tplDir, "CSI.xlsx"));
    const csiStruct = extractDemoTemplateRubricStructure(csiBuf);
    const criteriaByRow3Ht: Record<number, { rowNumber: number; rating: "Tốt" | "Hoàn thành" | "Chưa đạt"; isAiScored: boolean; columnGNote: string }> = {};
    for (const r of csiStruct.criteriaRows) {
      const isHt = r.rowNumber >= 13 && r.rowNumber <= 15;
      criteriaByRow3Ht[r.rowNumber] = {
        rowNumber: r.rowNumber,
        rating: isHt ? "Hoàn thành" : "Tốt",
        isAiScored: true,
        columnGNote: "OK",
      };
    }
    const built3Ht = buildDemoScoringWorkbookBuffer({
      classId: "VT-CSI02",
      sheetTitle: getDemoSheetTitleForClass("VT-CSI02"),
      demoDate: "2026-11-22",
      evalDate: "2026-11-22",
      studentTabs: [{ studentId: "S_3HT", fullName: "Test 3HT", tabName: "Test 3HT" }],
      templateBuffer: csiBuf,
      aiTabAnnotations: {
        "Test 3HT": { studentId: "S_3HT", criteriaByRow: criteriaByRow3Ht, bgkQuestions: [] },
      },
    });
    const built3HtZip = new AdmZip(built3Ht);
    const built3HtXml = built3HtZip.getEntry("xl/worksheets/sheet1.xml")!.getData().toString("utf8");
    const built3HtSs = parseSharedStringsXml(built3HtZip.getEntry("xl/sharedStrings.xml")!.getData().toString("utf8"));
    const built3HtCells = parseWorksheetCells(built3HtXml, built3HtSs);
    assert.strictEqual(built3HtCells.get("E13")?.numericValue, 0.0625, `F03: E13 cached value phải là 0.0625`);
    assert.strictEqual(built3HtCells.get("F9")?.numericValue, 4.813, `F03: F9 cached value phải là 4.813 (5 - 3*0.0625 = 4.8125 -> 4.813), nhận ${built3HtCells.get("F9")?.numericValue}`);
    console.log("  -> PASS [CSI-03].");

    // =========================================================================
    // [CSI-04]: Headless Chromium Pre-Save LMS Guard & Read-after-Write Verify
    // =========================================================================
    console.log("\n[CSI-04] Kiểm tra chốt chặn trước khi bấm Lưu LMS & Read-after-Write trên Chromium...");
    browser = await chromium.launch({ headless: true });
    (LmsHelpers as any).ensureCleanDialogAndToast = async () => {};
    (LmsHelpers as any).ensureCommentsSlotReady = async () => {};

    const buildMockDialogHtml = (stuId: string, stuName: string, mode: "MAX_ATTR" | "REACT_CLAMP" | "CSI_OK") => {
      const radiosHtml = Array.from({ length: 9 })
        .map((_, g) =>
          Array.from({ length: 5 })
            .map((__, r) => `<input type="radio" name="comp_${g}" value="${r + 1}" />`)
            .join("")
        )
        .join("<br/>");
      const inputsHtml =
        mode === "MAX_ATTR"
          ? `
            <input type="number" disabled value="0" />
            <input type="number" max="1.5" value="0" />
            <input type="number" max="0.5" value="0" />
            <input type="number" max="0.5" value="0" />
            <input type="number" max="1" value="0" />
            <input type="number" max="1" value="0" />
          `
          : mode === "REACT_CLAMP"
          ? `
            <input type="number" disabled value="0" />
            <input type="number" id="d0" value="0" />
            <input type="number" id="d1" value="0" />
            <input type="number" id="d2" value="0" />
            <input type="number" id="d3" value="0" />
            <input type="number" id="d4" value="0" />
          `
          : `
            <input type="number" disabled value="0" />
            <input type="number" max="2" value="0" />
            <input type="number" max="0.5" value="0" />
            <input type="number" max="1" value="0" />
            <input type="number" max="1" value="0" />
            <input type="number" max="0.5" value="0" />
          `;

      return `
        <html>
          <body>
            <div class="MuiDrawer-root">
              <table><tbody>
                <tr data-student-id="${stuId}">
                  <td>${stuName}</td>
                  <td><button id="open" type="button">Nhận xét học sinh</button></td>
                </tr>
              </tbody></table>
            </div>
            <div role="dialog" style="display:none;">
              <div>${radiosHtml}</div>
              <div>${inputsHtml}</div>
              <div>
                <div class="ql-editor" contenteditable="true"></div>
                <div class="ql-editor" contenteditable="true"></div>
                <div class="ql-editor" contenteditable="true"></div>
              </div>
              <button id="save" type="button">Save</button>
              <button id="close" type="button" aria-label="close">Cancel</button>
            </div>
          </body>
        </html>
      `;
    };

    // Case A: <input type="number" max="0.5"> while approved score is 1.0 (JSB student) -> abort BEFORE Save
    {
      const jsbCls = "VT-JSB99";
      const jsbStuId = "STU_JSB99_TEST";
      studentRepo.upsert({ studentId: jsbStuId, classId: jsbCls, fullName: "Nguyễn Test JSB", isActive: 1 });
      session14EvalRepo.saveDraft({
        classId: jsbCls,
        studentId: jsbStuId,
        demoScores: { algorithm: 1.5, creativity: 1.0, communication: 0.5, problemSolving: 1.0, computerSkills: 1.0 },
        learnedFromMindx: "Thư JSB\nĐiểm Demo: 5 điểm\nĐiểm Năng lực: 4 điểm",
        suggestionsFromMindx: "Tốt",
        futureDirection: "Tiếp tục JSA",
      });
      const rec = session14EvalRepo.findOne(jsbCls, jsbStuId)!;
      assert.strictEqual(session14EvalRepo.approveDraft(jsbCls, jsbStuId, rec.draftVersion).success, true);

      const pageA = await browser.newPage();
      await pageA.setContent(buildMockDialogHtml(jsbStuId, "Nguyễn Test JSB", "MAX_ATTR"));
      await pageA.evaluate(() => {
        (window as any).__saveClicks = 0;
        const d = document.querySelector('[role="dialog"]') as HTMLElement;
        document.getElementById("open")!.onclick = () => { d.style.display = "block"; };
        document.getElementById("close")!.onclick = () => { d.style.display = "none"; };
        document.getElementById("save")!.onclick = () => { (window as any).__saveClicks++; };
      });

      const resA = await Session14EvalUploader.uploadApprovedEvaluations({
        classId: jsbCls,
        studentIds: [jsbStuId],
        customPage: pageA,
        skipNavigation: false,
      });
      const saveClicksA = await pageA.evaluate(() => (window as any).__saveClicks);
      const dialogVisibleA = await pageA.locator('[role="dialog"]').isVisible();
      await pageA.close();

      assert.strictEqual(saveClicksA, 0, "Case A: KHÔNG được phép bấm Save khi vượt max attribute!");
      assert.strictEqual(dialogVisibleA, false, "Case A: Phải đóng modal sạch sau khi dừng!");
      assert.strictEqual(resA.failedCount, 1);
      assert.ok(
        /Tư duy sáng tạo.*vượt quá trần tối đa trên MindX LMS \(0\.5\)/i.test(resA.results[0].errorMessage || ""),
        `Case A thông báo lỗi chưa rõ: ${resA.results[0].errorMessage}`
      );
    }

    // Case B: React-style silent clamping without max attribute -> abort BEFORE Save
    {
      const jsbCls = "VT-JSB99";
      const jsbStuId = "STU_JSB99_CLAMP";
      studentRepo.upsert({ studentId: jsbStuId, classId: jsbCls, fullName: "Lê Test Clamp", isActive: 1 });
      session14EvalRepo.saveDraft({
        classId: jsbCls,
        studentId: jsbStuId,
        demoScores: { algorithm: 1.5, creativity: 1.0, communication: 0.5, problemSolving: 1.0, computerSkills: 1.0 },
        learnedFromMindx: "Thư JSB\nĐiểm Demo: 5 điểm\nĐiểm Năng lực: 4 điểm",
        suggestionsFromMindx: "Tốt",
        futureDirection: "Tiếp tục JSA",
      });
      const rec = session14EvalRepo.findOne(jsbCls, jsbStuId)!;
      assert.strictEqual(session14EvalRepo.approveDraft(jsbCls, jsbStuId, rec.draftVersion).success, true);

      const pageB = await browser.newPage();
      await pageB.setContent(buildMockDialogHtml(jsbStuId, "Lê Test Clamp", "REACT_CLAMP"));
      await pageB.evaluate(`(() => {
        window.__saveClicks = 0;
        const d = document.querySelector('[role="dialog"]');
        document.getElementById("open").onclick = () => { d.style.display = "block"; };
        document.getElementById("close").onclick = () => { d.style.display = "none"; };
        document.getElementById("save").onclick = () => { window.__saveClicks++; };
        const d1 = document.getElementById("d1");
        d1.addEventListener("input", () => { if (Number(d1.value) > 0.5) d1.value = "0.5"; });
        d1.addEventListener("change", () => { if (Number(d1.value) > 0.5) d1.value = "0.5"; });
        d1.addEventListener("blur", () => { if (Number(d1.value) > 0.5) d1.value = "0.5"; });
      })()`);

      const resB = await Session14EvalUploader.uploadApprovedEvaluations({
        classId: jsbCls,
        studentIds: [jsbStuId],
        customPage: pageB,
        skipNavigation: false,
      });
      const saveClicksB = await pageB.evaluate(() => (window as any).__saveClicks);
      const dialogVisibleB = await pageB.locator('[role="dialog"]').isVisible();
      await pageB.close();

      assert.strictEqual(saveClicksB, 0, "Case B: KHÔNG được bấm Save khi LMS âm thầm ép giảm điểm!");
      assert.strictEqual(dialogVisibleB, false, "Case B: Phải đóng modal sạch sau khi dừng!");
      assert.strictEqual(resB.failedCount, 1);
      assert.ok(
        /Tư duy sáng tạo.*tự điều chỉnh thành 0\.5/i.test(resB.results[0].errorMessage || ""),
        `Case B thông báo lỗi chưa rõ: ${resB.results[0].errorMessage}`
      );
    }

    // Case B2 [F01 + F04]: Delegated #root focusout clamping (React onBlur) + nested .MuiAlert-root Close button trap
    {
      const jsbCls = "VT-JSB99";
      const jsbStuId = "STU_JSB99_FOCUSOUT";
      studentRepo.upsert({ studentId: jsbStuId, classId: jsbCls, fullName: "Phạm Test Focusout", isActive: 1 });
      session14EvalRepo.saveDraft({
        classId: jsbCls,
        studentId: jsbStuId,
        demoScores: { algorithm: 1.5, creativity: 1.0, communication: 0.5, problemSolving: 1.0, computerSkills: 1.0 },
        learnedFromMindx: "Thư JSB\nĐiểm Demo: 5 điểm\nĐiểm Năng lực: 4 điểm",
        suggestionsFromMindx: "Tốt",
        futureDirection: "Tiếp tục JSA",
      });
      const rec = session14EvalRepo.findOne(jsbCls, jsbStuId)!;
      assert.strictEqual(session14EvalRepo.approveDraft(jsbCls, jsbStuId, rec.draftVersion).success, true);

      const pageB2 = await browser.newPage();
      const radiosHtml = Array.from({ length: 9 })
        .map((_, g) =>
          Array.from({ length: 5 })
            .map((__, r) => `<input type="radio" name="comp_${g}" value="${r + 1}" />`)
            .join("")
        )
        .join("<br/>");
      await pageB2.setContent(`
        <html><body>
          <div id="root">
            <div class="MuiDrawer-root"><table><tbody>
              <tr data-student-id="${jsbStuId}"><td>Phạm Test Focusout</td><td><button id="open" type="button">Nhận xét học sinh</button></td></tr>
            </tbody></table></div>
            <div role="dialog" style="display:none;">
              <div class="MuiAlert-root"><button id="alert-close" type="button" aria-label="Close">x</button></div>
              <div>${radiosHtml}</div>
              <div>
                <input type="number" disabled value="0" />
                <input type="number" id="d0" value="0" />
                <input type="number" id="d1" value="0" />
                <input type="number" id="d2" value="0" />
                <input type="number" id="d3" value="0" />
                <input type="number" id="d4" value="0" />
              </div>
              <div>
                <div class="ql-editor" contenteditable="true"></div>
                <div class="ql-editor" contenteditable="true"></div>
                <div class="ql-editor" contenteditable="true"></div>
              </div>
              <button id="save" type="button">Save</button>
            </div>
          </div>
        </body></html>
      `);
      await pageB2.evaluate(`(() => {
        window.__saveClicks = 0;
        const root = document.getElementById("root");
        const d = document.querySelector('[role="dialog"]');
        document.getElementById("open").onclick = () => { d.style.display = "block"; };
        document.getElementById("save").onclick = () => { window.__saveClicks++; };
        document.getElementById("alert-close").onclick = (e) => { e.currentTarget.parentElement.style.display = "none"; };
        document.addEventListener("keydown", (e) => { if (e.key === "Escape") d.style.display = "none"; });
        root.addEventListener("focusout", (e) => {
          if (e.target && e.target.id === "d1" && Number(e.target.value) > 0.5) {
            e.target.value = "0.5";
          }
        });
      })()`);

      const resB2 = await Session14EvalUploader.uploadApprovedEvaluations({
        classId: jsbCls,
        studentIds: [jsbStuId],
        customPage: pageB2,
        skipNavigation: false,
      });
      const saveClicksB2 = await pageB2.evaluate(() => (window as any).__saveClicks);
      const dialogVisibleB2 = await pageB2.locator('[role="dialog"]').isVisible();
      await pageB2.close();

      assert.strictEqual(saveClicksB2, 0, "F01: KHÔNG được bấm Save khi React focusout onBlur ép điểm!");
      assert.strictEqual(dialogVisibleB2, false, "F04: Dialog có MuiAlert Close button bẫy vẫn phải đóng hoàn toàn qua Escape!");
      assert.strictEqual(resB2.failedCount, 1);
      assert.ok(
        /Tư duy sáng tạo.*tự điều chỉnh thành 0\.5/i.test(resB2.results[0].errorMessage || ""),
        `Case B2 thông báo lỗi chưa rõ: ${resB2.results[0].errorMessage}`
      );
    }

    // Case C: Valid rebalanced VT-CSI02 (1.5, 0.5, 1, 1, 0.5) on CSI LMS modal -> Save=1 + VERIFIED
    {
      const pageC = await browser.newPage();
      let serverPersistedEval: any = null;
      await pageC.route("**/*", async (route) => {
        const req = route.request();
        let reqBody: any = null;
        try {
          reqBody = JSON.parse(req.postData() || "{}");
        } catch {}
        if (reqBody?.operationName === "UpdateStudentEvaluation" && reqBody?.variables?.input) {
          serverPersistedEval = {
            id: "EVAL_CSI_1",
            studentId: reqBody.variables.studentId,
            classId: reqBody.variables.classId,
            slotNumber: reqBody.variables.slotNumber,
            ...reqBody.variables.input,
          };
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ data: { updateStudentEvaluation: { id: "EVAL_CSI_1" } } }),
          });
          return;
        }
        if (reqBody?.operationName === "GetStudentEvaluation" && serverPersistedEval) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ data: { studentEvaluation: serverPersistedEval } }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ data: { updateStudentEvaluation: { id: "EVAL_CSI_1" } } }),
        });
      });

      await pageC.setContent(buildMockDialogHtml(stuQuanId, "Bùi Nguyễn Nhật Quân", "CSI_OK"));
      await pageC.evaluate(
        ({ sid, cid }) => {
          (window as any).__saveClicks = 0;
          let openCount = 0;
          const d = document.querySelector('[role="dialog"]') as HTMLElement;
          document.getElementById("open")!.onclick = () => {
            openCount++;
            d.style.display = "block";
            if (openCount > 1) {
              fetch("https://lms-api.mindx.edu.vn/graphql", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  operationName: "GetStudentEvaluation",
                  variables: { studentId: sid, classId: cid, slotNumber: 14 },
                }),
              })
                .then((r) => r.json())
                .then((json) => {
                  const ev = json?.data?.studentEvaluation;
                  if (!ev) return;
                  document.querySelectorAll(".ql-editor").forEach((el, i) => {
                    el.textContent = ev.texts[i];
                  });
                  document.querySelectorAll('input[type="number"]').forEach((el, i) => {
                    if (i > 0) (el as HTMLInputElement).value = ev.nums[i - 1];
                  });
                  document.querySelectorAll('input[type="radio"]').forEach((el, i) => {
                    (el as HTMLInputElement).checked =
                      Number((el as HTMLInputElement).value) === ev.ratings[Math.floor(i / 5)];
                  });
                })
                .catch(() => {});
            }
          };
          document.getElementById("close")!.onclick = () => {
            d.style.display = "none";
          };
          document.getElementById("save")!.onclick = () => {
            (window as any).__saveClicks++;
            const texts = Array.from(document.querySelectorAll(".ql-editor")).map(
              (el) => (el as HTMLElement).innerText
            );
            const nums = Array.from(document.querySelectorAll('input[type="number"]'))
              .slice(1)
              .map((el) => (el as HTMLInputElement).value);
            const ratings = Array.from({ length: 9 }, (_, g) =>
              Number((document.querySelector(`input[name=comp_${g}]:checked`) as HTMLInputElement)?.value)
            );
            fetch("https://lms-api.mindx.edu.vn/graphql", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                operationName: "UpdateStudentEvaluation",
                variables: {
                  studentId: sid,
                  classId: cid,
                  slotNumber: 14,
                  input: {
                    learnedFromMindx: texts[0],
                    suggestionsFromMindx: texts[1],
                    futureDirection: texts[2],
                    texts,
                    nums,
                    ratings,
                  },
                },
              }),
            }).catch(() => {});
          };
        },
        { sid: stuQuanId, cid: "VT-CSI02" }
      );

      const resC = await Session14EvalUploader.uploadApprovedEvaluations({
        classId: "VT-CSI02",
        studentIds: [stuQuanId],
        customPage: pageC,
        skipNavigation: false,
      });
      const saveClicksC = await pageC.evaluate(() => (window as any).__saveClicks);
      await pageC.close();

      assert.strictEqual(saveClicksC, 1, "Case C: Phải bấm Save đúng 1 lần!");
      assert.strictEqual(resC.verifiedCount, 1, `Case C thất bại: ${resC.results[0]?.errorMessage}`);
      assert.strictEqual(resC.failedCount, 0);
      assert.deepEqual(serverPersistedEval.nums, ["1.5", "0.5", "1", "1", "0.5"]);
      assert.strictEqual(session14EvalRepo.findOne("VT-CSI02", stuQuanId)?.status, "VERIFIED");
    }
    console.log("  -> PASS [CSI-04].");

    console.log("\n✅ TẤT CẢ KIỂM THỬ [CSI-01..CSI-04] ĐỀU PASS 100%!");
  } finally {
    (LmsHelpers as any).ensureCleanDialogAndToast = origCleanToast;
    (LmsHelpers as any).ensureCommentsSlotReady = origEnsureSlot;
    if (browser) {
      await browser.close().catch(() => {});
    }
    try {
      const { closeDb } = await import("../src/lib/db/sqlite");
      closeDb?.();
    } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

runTests().catch((err) => {
  console.error("❌ TEST FAILED:", err);
  process.exit(1);
});
