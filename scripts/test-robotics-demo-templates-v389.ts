/**
 * KIỂM THỬ TỰ ĐỘNG v3.8.9 — BỘ 10 MẪU BẢNG CHẤM ĐIỂM DEMO ROBOTICS & THANG ĐIỂM `Demo2024 | ROB` (5.0)
 *
 * - [ROB-TPL-01]: Xác minh 10/10 file mẫu Robotics (PREB/PREA/PREI, ARMB/ARMA/ARMI, SEMIB/SEMIA/SEMII, ROB)
 *                 tồn tại, getSavedCourseTemplatePath & getDemoSheetTitleForClass ánh xạ đúng cho 11 mã lớp thực tế,
 *                 trọng số Cột C từng nhóm khớp 100% trần Demo2024 | ROB ([1.25, 0.75, 1.0, 0.5, 1.5] = 5.0),
 *                 nội dung từng khóa bám sát giáo trình (khác biệt R8..R14/R18..R19), và dòng R15 (phụ huynh bình chọn)
 *                 được phân loại `LIVE_JUDGE_ONLY` (tô vàng khi xuất Google Sheet).
 * - [ROB-TPL-02]: Sinh workbook nhiều học viên cho `VT-ROB-ARMA13`, `VT-ROB-SEMIA05`, `VT-KIND-ROB4B04` bằng
 *                 `buildDemoScoringWorkbookBuffer`, sửa điểm D8..D23 ("Tốt" / "Hoàn thành" / "Chưa đạt"),
 *                 kiểm tra đọc ngược bằng `parseDemoWorkbookBufferForClass` KHÔNG bị đảo nhóm 4 (`computerSkills=0.5`)
 *                 với nhóm 5 (`problemSolving=1.5`), bỏ qua sạch tab mẫu "Barem" dư nếu còn sót (Nguyễn Văn A),
 *                 và tính đúng xếp hạng Giải Nhất/Nhì/Ba + 4th Quill `awardRanking` (`/5.0 điểm`).
 * - [ROB-TPL-03]: Kiểm tra dồn điểm không mất điểm cho bảng Robotics mẫu cũ (`1.5 / 1.0 / 0.5 / 1.0 / 1.0 = 5.0`),
 *                 kể cả mức 5.0 tuyệt đối và mức lẻ 4.375, tính lũy đẳng (`parse(parse(x)) === parse(x)`),
 *                 và từ chối bảng Robotics chuẩn mới khi vượt khung (ví dụ `algorithm > 1.25` hoặc `computerSkills > 0.5`).
 * - [ROB-TPL-04]: Headless Chromium `Session14EvalUploader` trên modal mô phỏng `Demo2024 | ROB`
 *                 (max `[1.25, 0.75, 1.0, 0.5, 1.5]` + 4 `.ql-editor` gồm `awardRanking`) -> bấm Save đúng 1 lần -> VERIFIED.
 *
 * Chạy 100% cô lập trong `os.tmpdir()` — bảo toàn 100% SHA-256 dữ liệu thật `data/`.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { chromium } from "playwright";

function makeLegacyRoboticsSheetXml(opts: {
  studentName: string;
  eAlgo: number[];
  eCrea: number[];
  eComm: number[];
  eComp: number[];
  eProb: number[];
  cAlgo?: number[];
  cCrea?: number[];
  cComm?: number[];
  cComp?: number[];
  cProb?: number[];
}): string {
  const cA = opts.cAlgo ?? [0.25, 0.25, 0.25, 0.5, 0.25];
  const cCr = opts.cCrea ?? [0.25, 0.25, 0.5];
  const cCm = opts.cComm ?? [0.25, 0.25];
  const cCp = opts.cComp ?? [0.5, 0.5];
  const cP = opts.cProb ?? [0.25, 0.25, 0.25, 0.25];

  const rows: string[] = [];
  rows.push(
    `<row r="2"><c r="A2" t="inlineStr"><is><t>Họ và tên Học viên:</t></is></c><c r="B2" t="inlineStr"><is><t>${opts.studentName}</t></is></c></row>`
  );

  const pushCat = (
    startR: number,
    catTitle: string,
    cWeights: number[],
    eVals: number[]
  ) => {
    for (let i = 0; i < eVals.length; i++) {
      const r = startR + i;
      const aXml = i === 0 ? `<c r="A${r}" t="inlineStr"><is><t>${catTitle}</t></is></c>` : "";
      rows.push(
        `<row r="${r}">${aXml}<c r="C${r}"><v>${cWeights[i]}</v></c><c r="E${r}"><v>${eVals[i]}</v></c></row>`
      );
    }
  };

  pushCat(8, "Tư duy máy tính, tư duy thuật toán", cA, opts.eAlgo);
  pushCat(13, "Tư duy sáng tạo mô hình", cCr, opts.eCrea);
  pushCat(16, "Kỹ năng giao tiếp, hợp tác", cCm, opts.eComm);
  pushCat(18, "Kỹ năng sử dụng máy tính", cCp, opts.eComp);
  pushCat(20, "Kỹ năng giải quyết vấn đề", cP, opts.eProb);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rows.join("")}</sheetData>
  <mergeCells count="5">
    <mergeCell ref="A8:A12"/>
    <mergeCell ref="A13:A15"/>
    <mergeCell ref="A16:A17"/>
    <mergeCell ref="A18:A19"/>
    <mergeCell ref="A20:A23"/>
  </mergeCells>
</worksheet>`;
}

function setStudentRatingsInWorkbookBuffer(
  workbookBuf: Buffer,
  tabName: string,
  ratingByRow: Record<number, "Tốt" | "Hoàn thành" | "Chưa đạt">
): Buffer {
  const zip = new AdmZip(workbookBuf);
  const wbXml = zip.getEntry("xl/workbook.xml")!.getData().toString("utf8");
  const relsXml = zip.getEntry("xl/_rels/workbook.xml.rels")!.getData().toString("utf8");
  const sheetMatch = Array.from(wbXml.matchAll(/<sheet\b[^>]*?\bname="([^"]+)"[^>]*?\br:id="([^"]+)"/gi)).find(
    (m) => m[1] === tabName
  );
  assert.ok(sheetMatch, `Không tìm thấy tab "${tabName}" trong workbook`);
  const relMatch = new RegExp(
    `<Relationship\\b[^>]*?\\bId="${sheetMatch[2]}"[^>]*?\\bTarget="([^"]+)"`,
    "i"
  ).exec(relsXml);
  assert.ok(relMatch?.[1]);
  const entryPath = relMatch[1].startsWith("xl/") ? relMatch[1] : `xl/${relMatch[1].replace(/^\/+/, "")}`;
  let wsXml = zip.getEntry(entryPath)!.getData().toString("utf8");

  for (const [rStr, rating] of Object.entries(ratingByRow)) {
    const r = Number(rStr);
    const cellRe = new RegExp(`<c\\b([^>]*?\\br="D${r}"[^>]*?)>(?:[\\s\\S]*?)<\\/c>`, "i");
    wsXml = wsXml.replace(cellRe, (_m, attrs) => {
      const sMatch = String(attrs).match(/\bs="(\d+)"/);
      const sAttr = sMatch ? ` s="${sMatch[1]}"` : "";
      return `<c r="D${r}"${sAttr} t="inlineStr"><is><t>${rating}</t></is></c>`;
    });
  }
  zip.updateFile(entryPath, Buffer.from(wsXml, "utf8"));
  return zip.toBuffer();
}

async function runTests() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-rob-tpl-v389-"));
  process.env.MINDX_DB_PATH = path.join(tempDir, "test_rob_v389.db");
  process.env.MINDX_RUNNING_CLASSES_PATH = path.join(tempDir, "running_classes.json");
  process.env.ALLOWED_LOCAL_DIRS = tempDir;
  process.env.MINDX_ALLOWED_EXTRA_PATHS = tempDir;

  const {
    closeDb,
    getSession14DemoLimitsForClass,
    isRoboticsClassCode,
    parseSession14DemoScores,
    calculateDemoTotalScore,
    session14EvalRepo,
    spckUploadRepo,
    studentRepo,
  } = await import("../src/lib/db/sqlite");
  const { computeStudentFolderContentDigest } = await import("../src/lib/local-files/spck-scanner");
  const { getDemoScoreItemsForClassUi } = await import("../src/lib/spck/spck-ui-helpers");
  const {
    extractDemoTemplateRubricStructure,
    classifyDemoCriterion,
  } = await import("../src/lib/gemini/spck-demo-sheet-scorer");
  const {
    buildDemoScoringWorkbookBuffer,
    getDemoSheetTitleForClass,
    getSavedCourseTemplatePath,
  } = await import("../src/lib/playwright/spck-demo-sheet");
  const {
    extractDemoScoresFromWorksheet,
    parseDemoWorkbookBufferForClass,
    parseSharedStringsXml,
    parseWorksheetCells,
  } = await import("../src/lib/local-files/spck-demo-score-reader");
  const { LmsHelpers } = await import("../src/lib/playwright/lms-helpers");
  const { Session14EvalUploader } = await import("../src/lib/playwright/session14-eval-uploader");

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  const origCleanToast = LmsHelpers.ensureCleanDialogAndToast;
  const origEnsureSlot = LmsHelpers.ensureCommentsSlotReady;

  try {
    // =========================================================================
    // [ROB-TPL-01]: Verify 10/10 Robotics templates & Demo2024 | ROB limits
    // =========================================================================
    console.log("\n[ROB-TPL-01] Kiểm tra 10/10 mẫu Robotics và cấu trúc tiêu chí...");
    const expectedRobLimits = {
      algorithm: 1.25,
      creativity: 0.75,
      communication: 1.0,
      computerSkills: 0.5,
      problemSolving: 1.5,
    };
    const expectedLegoLimits = {
      algorithm: 1.0,
      creativity: 1.0,
      communication: 1.0,
      computerSkills: 1.0,
      problemSolving: 1.0,
    };
    assert.deepEqual(getSession14DemoLimitsForClass("VT-ROB-ARMA13"), expectedRobLimits);
    assert.deepEqual(getSession14DemoLimitsForClass("VT-KIND-ROB4B04"), expectedLegoLimits);
    const uiItemsAuto = getDemoScoreItemsForClassUi("VT-ROB-ARMA13");
    assert.deepEqual(
      uiItemsAuto.map((it) => [it.key, it.max]),
      [
        ["algorithm", 1.25],
        ["creativity", 0.75],
        ["communication", 1.0],
        ["computerSkills", 0.5],
        ["problemSolving", 1.5],
      ],
      "F06: getDemoScoreItemsForClassUi không truyền tham số thứ 2 vẫn phải tự nhận diện Robotics"
    );

    const classResolutionCases: Array<[string, string]> = [
      ["VT-ROB-PREB20", "PREB"],
      ["VT-ROB-PREA10", "PREA"],
      ["VT-ROB-PREI14", "PREI"],
      ["VT-ROB-ARMB19", "ARMB"],
      ["VT-ROB-ARMA13", "ARMA"],
      ["VT-ROB-ARMI13", "ARMI"],
      ["VT-ROB-SEMIB08", "SEMIB"],
      ["VT-ROB-SEMIA05", "SEMIA"],
      ["VT-ROB-SEMII02", "SEMII"],
      ["VT-KIND-ROB4B04", "ROB"],
      ["VT-KIND-ROB4I01", "ROB"],
    ];

    const distinctAlgorithmSignatures = new Set<string>();

    for (const [clsCode, expectedPrefix] of classResolutionCases) {
      assert.strictEqual(isRoboticsClassCode(clsCode), true);
      const tplPath = getSavedCourseTemplatePath(clsCode);
      assert.ok(tplPath && fs.existsSync(tplPath), `${clsCode}: thiếu mẫu ${expectedPrefix}.xlsx`);
      assert.strictEqual(path.basename(tplPath), `${expectedPrefix}.xlsx`);

      const buf = fs.readFileSync(tplPath);
      const struct = extractDemoTemplateRubricStructure(buf);
      assert.strictEqual(struct.criteriaRows.length, 16, `${expectedPrefix}: phải có đủ 16 dòng tiêu chí`);
      assert.strictEqual(
        struct.nhanXetRow,
        25,
        `${expectedPrefix}: F03 nhanXetRow phải là 25 (không bị ghim 28)`
      );
      assert.deepEqual(struct.categorySpans, [
        [8, 12],
        [13, 15],
        [16, 17],
        [18, 19],
        [20, 23],
      ]);

      const r15 = struct.criteriaRows.find((r) => r.rowNumber === 15);
      assert.ok(r15, `${expectedPrefix}: thiếu dòng R15`);
      assert.strictEqual(
        classifyDemoCriterion(r15.content, r15.categoryIndex),
        "LIVE_JUDGE_ONLY",
        `${expectedPrefix}: R15 (khán giả yêu thích / phụ huynh bình chọn) phải là LIVE_JUDGE_ONLY`
      );

      const zip = new AdmZip(buf);
      const ss = parseSharedStringsXml(zip.getEntry("xl/sharedStrings.xml")!.getData().toString("utf8"));
      const wsXml = zip.getEntry("xl/worksheets/sheet1.xml")!.getData().toString("utf8");
      const cells = parseWorksheetCells(wsXml, ss);

      assert.strictEqual(
        cells.get("A1")?.stringValue,
        getDemoSheetTitleForClass(clsCode),
        `${clsCode}: tiêu đề A1 không khớp COURSE_DEMO_TITLE_MAP`
      );
      assert.strictEqual(
        cells.get("A26")?.stringValue || "",
        "",
        `${expectedPrefix}: F02 ô A26 phải trống (không lặp chữ BGK1 cạnh B26)`
      );

      distinctAlgorithmSignatures.add(
        struct.criteriaRows
          .slice(0, 5)
          .map((r) => r.content)
          .join("|")
      );

      const extracted = extractDemoScoresFromWorksheet(cells, clsCode, wsXml);
      assert.strictEqual(extracted.hasCompleteScores, true);
      assert.deepEqual(
        extracted.demoScores,
        clsCode.includes("KIND-ROB") ? expectedLegoLimits : expectedRobLimits
      );
      assert.strictEqual(extracted.demoTotalScore, 5.0);
    }
    assert.strictEqual(
      distinctAlgorithmSignatures.size,
      10,
      "Toàn bộ 10 khóa Robotics phải có nội dung tiêu chí thuật toán riêng biệt khớp giáo trình"
    );
    console.log("  -> PASS [ROB-TPL-01] (10/10 mẫu Robotics chuẩn 5.0 Demo2024 | ROB).");

    // =========================================================================
    // [ROB-TPL-02]: Build workbook + rate variations + reverse read (no group swap!)
    // =========================================================================
    console.log("\n[ROB-TPL-02] Kiểm tra tạo workbook nhiều HV & đọc ngược không đảo nhóm 4/5...");
    for (const clsId of ["VT-ROB-ARMA13", "VT-ROB-SEMIA05", "VT-KIND-ROB4B04"]) {
      const students = [
        { studentId: `${clsId}_S1`, fullName: "Lê Xuân Phúc" },
        { studentId: `${clsId}_S2`, fullName: "Đoàn Quốc Việt" },
      ];
      for (const s of students) {
        studentRepo.upsert({ ...s, classId: clsId, isActive: 1 });
      }
      const tabs = students.map((s) => ({ ...s, tabName: s.fullName }));

      let wbBuf = buildDemoScoringWorkbookBuffer({
        classId: clsId,
        sheetTitle: getDemoSheetTitleForClass(clsId),
        demoDate: "2026-11-29",
        evalDate: "2026-11-29",
        studentTabs: tabs,
      });

      // S1: R19 (computerSkills, 0.25) = Chưa đạt (0) => computerSkills = 0.25; R22 (problemSolving, 0.5) = Hoàn thành (0.25) => problemSolving = 1.25; total = 4.5
      wbBuf = setStudentRatingsInWorkbookBuffer(wbBuf, "Lê Xuân Phúc", {
        19: "Chưa đạt",
        22: "Hoàn thành",
      });
      // S2: R16 (communication, 0.5) = Hoàn thành (0.25) => comm = 0.75; R13 (creativity, 0.25) = Chưa đạt (0) => crea = 0.5; total = 4.5 -> tie with S1? make R21 = Hoàn thành (-0.125) => 4.375
      wbBuf = setStudentRatingsInWorkbookBuffer(wbBuf, "Đoàn Quốc Việt", {
        13: "Chưa đạt",
        16: "Hoàn thành",
        21: "Hoàn thành",
      });

      // F01 regression: insert judge note directly into B27 ("Con thuyết trình rõ ràng.") on Lê Xuân Phúc
      {
        const noteZip = new AdmZip(wbBuf);
        let noteWs = noteZip.getEntry("xl/worksheets/sheet1.xml")!.getData().toString("utf8");
        noteWs = noteWs.replace(
          /<c\b[^>]*?\br="B27"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/i,
          `<c r="B27" s="15" t="inlineStr"><is><t>Con thuyết trình rõ ràng, tự tin.</t></is></c>`
        );
        noteZip.updateFile("xl/worksheets/sheet1.xml", Buffer.from(noteWs, "utf8"));
        wbBuf = noteZip.toBuffer();
      }

      const parsed = parseDemoWorkbookBufferForClass(clsId, wbBuf, "local_rob_test", {
        skipLiveLmsCheckpointFetch: true,
      });
      assert.strictEqual(parsed.matchedCount, 2, `${clsId}: phải khớp đủ 2 HV`);
      assert.deepEqual(parsed.unmatchedTabs, []);

      // F05 regression: verify no "khóa khóa học" & accurate VEX GO / VEX IQ next-course phrasing
      assert.strictEqual(
        /khóa\s+khóa/i.test(parsed.classSummary.bodyText),
        false,
        `F05: Lời chúc Summary bị lặp "khóa khóa" cho ${clsId}: ${parsed.classSummary.bodyText}`
      );
      if (clsId === "VT-ROB-ARMA13") {
        assert.ok(parsed.classSummary.bodyText.includes("Truy tìm bí ẩn Robot VEX GO Intensive (ARMI)"));
      } else if (clsId === "VT-ROB-SEMIA05") {
        assert.ok(parsed.classSummary.bodyText.includes("Sáng tạo Robot VEX IQ Intensive (SEMII)"));
      }

      const p1 = parsed.students.find((x) => x.fullName === "Lê Xuân Phúc")!;
      assert.ok(
        p1.judgeNote.includes("Con thuyết trình rõ ràng, tự tin."),
        `F01: Phải đọc được nhận xét BGK1 ở B27 cho ${clsId}, nhận="${p1.judgeNote}"`
      );
      assert.deepEqual(
        p1.demoScores,
        clsId.includes("KIND-ROB")
          ? {
              algorithm: 1.0,
              creativity: 1.0,
              communication: 1.0,
              computerSkills: 0.5,
              problemSolving: 1.0,
            }
          : {
              algorithm: 1.25,
              creativity: 0.75,
              communication: 1.0,
              computerSkills: 0.25,
              problemSolving: 1.25,
            }
      );
      assert.strictEqual(p1.demoTotalScore, 4.5);
      assert.strictEqual(p1.updatedRecord.awardRanking, "Giải Nhất (4.50/5.0 điểm)");

      const p2 = parsed.students.find((x) => x.fullName === "Đoàn Quốc Việt")!;
      assert.deepEqual(
        p2.demoScores,
        clsId.includes("KIND-ROB")
          ? {
              algorithm: 1.0,
              creativity: 1.0,
              communication: 0.75,
              computerSkills: 0.63,
              problemSolving: 1.0,
            }
          : {
              algorithm: 1.25,
              creativity: 0.5,
              communication: 0.75,
              computerSkills: 0.5,
              problemSolving: 1.38,
            }
      );
      assert.strictEqual(p2.demoRawTotalScore, 4.375);
      assert.strictEqual(
        p2.updatedRecord.awardRanking,
        "Giải Nhì (4.375/5.0 điểm)"
      );
    }
    console.log("  -> PASS [ROB-TPL-02].");

    // =========================================================================
    // [ROB-TPL-03]: Legacy 2024 Robotics (1.5 / 1.0 / 0.5 / 1.0 / 1.0) rebalancing
    // =========================================================================
    console.log("\n[ROB-TPL-03] Kiểm tra dồn điểm bảng Robotics cũ không mất điểm & chặn vượt trần bảng mới...");
    // Perfect 5.0 legacy Robotics
    const leg5 = parseSession14DemoScores(
      { algorithm: 1.5, creativity: 1.0, communication: 0.5, computerSkills: 1.0, problemSolving: 1.0 },
      "VT-ROB-ARMB19"
    );
    assert.deepEqual(leg5, expectedRobLimits);
    assert.deepEqual(parseSession14DemoScores(leg5, "VT-ROB-ARMB19"), expectedRobLimits);

    // Odd 4.375 legacy Robotics XML sheet
    const legXml = makeLegacyRoboticsSheetXml({
      studentName: "HV Bảng Cũ",
      eAlgo: [0.25, 0.25, 0.25, 0.5, 0.125], // 1.375 (+0.125)
      eCrea: [0.25, 0.25, 0.5], // 1.0 (+0.25)
      eComm: [0.25, 0.25], // 0.5
      eComp: [0.5, 0.25], // 0.75 (+0.25)
      eProb: [0.25, 0.25, 0.25, 0], // 0.75 => total = 4.375, overflow = 0.625 -> prob = 1.375, total = 4.375!
    });
    const legExtracted = extractDemoScoresFromWorksheet(
      parseWorksheetCells(legXml, []),
      "VT-ROB-PREB20",
      legXml
    );
    assert.strictEqual(legExtracted.hasCompleteScores, true);
    assert.strictEqual(legExtracted.demoRawTotalScore, 4.375);
    assert.deepEqual(legExtracted.demoScores, {
      algorithm: 1.25,
      creativity: 0.75,
      communication: 0.5,
      computerSkills: 0.5,
      problemSolving: 1.38,
    });

    // Guard: new Robotics sheet exceeding 0.5 in computerSkills (total col C = 0.5) must be rejected
    const badNewRobXml = fs.readFileSync(getSavedCourseTemplatePath("VT-ROB-ARMI13")!);
    const badZip = new AdmZip(badNewRobXml);
    let badWs = badZip.getEntry("xl/worksheets/sheet1.xml")!.getData().toString("utf8");
    badWs = badWs.replace(
      /<c r="E19"[^>]*>[\s\S]*?<\/c>/i,
      `<c r="E19" s="29"><v>0.75</v></c>`
    );
    badWs = badWs.replace(
      /<c r="D19"[^>]*>[\s\S]*?<\/c>/i,
      `<c r="D19" s="29" t="inlineStr"><is><t></t></is></c>`
    );
    const badExtracted = extractDemoScoresFromWorksheet(
      parseWorksheetCells(badWs, parseSharedStringsXml(badZip.getEntry("xl/sharedStrings.xml")!.getData().toString("utf8"))),
      "VT-ROB-ARMI13",
      badWs
    );
    assert.strictEqual(
      badExtracted.hasCompleteScores,
      false,
      "Bảng Robotics mới có ô E19=0.75 vượt trần nhóm computerSkills=0.5 phải bị từ chối"
    );

    // F04 regression: partial & full UI saveDraft on modern Robotics record must clamp out-of-range cell WITHOUT mutating sibling problemSolving!
    const f04StuId = "STU_ROB_F04";
    studentRepo.upsert({
      studentId: f04StuId,
      classId: "VT-ROB-ARMA13",
      fullName: "Học Viên F04",
      isActive: 1,
    });
    session14EvalRepo.saveDraft({
      classId: "VT-ROB-ARMA13",
      studentId: f04StuId,
      demoScores: {
        algorithm: 1.25,
        creativity: 0.75,
        communication: 0.5,
        computerSkills: 0.25,
        problemSolving: 0.75,
      },
    });
    const f04PartialRes = session14EvalRepo.saveDraft({
      classId: "VT-ROB-ARMA13",
      studentId: f04StuId,
      demoScores: { computerSkills: 1.0 },
    });
    assert.deepEqual(
      JSON.parse(f04PartialRes.record.demoScoresJson),
      {
        algorithm: 1.25,
        creativity: 0.75,
        communication: 0.5,
        computerSkills: 0.5,
        problemSolving: 0.75,
      },
      "F04: Sửa 1 ô computerSkills=1.0 trên bản ghi Robotics mới chỉ được kẹp về 0.5, KHÔNG được tự tăng problemSolving"
    );
    const f04FullUiRes = session14EvalRepo.saveDraft({
      classId: "VT-ROB-ARMA13",
      studentId: f04StuId,
      demoScores: {
        algorithm: 1.25,
        creativity: 0.75,
        communication: 0.5,
        computerSkills: 1.0,
        problemSolving: 0.75,
      },
    });
    assert.strictEqual(
      JSON.parse(f04FullUiRes.record.demoScoresJson).problemSolving,
      0.75,
      "F04: Lưu full 5 khóa từ form UI khi bản ghi hiện tại thuộc chuẩn mới cũng KHÔNG được tự tăng problemSolving"
    );
    console.log("  -> PASS [ROB-TPL-03].");

    // =========================================================================
    // [ROB-TPL-04]: Headless Chromium Session14EvalUploader (Demo2024 | ROB + 4 Quill)
    // =========================================================================
    console.log("\n[ROB-TPL-04] Kiểm tra Session14EvalUploader trên DOM Demo2024 | ROB (5.0 điểm + 4 Quill)...");
    const robCls = "VT-ROB-ARMA13";
    const robStuId = "STU_ROB_ARMA13_01";
    studentRepo.upsert({
      studentId: robStuId,
      classId: robCls,
      fullName: "Lê Xuân Phúc",
      isActive: 1,
    });
    session14EvalRepo.saveDraft({
      classId: robCls,
      studentId: robStuId,
      competencyScores: {
        knowledgeSelfStudy: 4,
        knowledgeInClass: 4,
        skillCommunication: 5,
        skillComputerUse: 4,
        skillProblemSolving: 5,
        skillCreativity: 4,
        skillComputational: 4,
        attitudeHomework: 4,
        attitudeInClass: 5,
      },
      demoScores: {
        algorithm: 1.25,
        creativity: 0.75,
        communication: 1.0,
        computerSkills: 0.25,
        problemSolving: 1.25,
      },
      demoRawTotalScore: 4.5,
      learnedFromMindx: "Thư gửi phụ huynh Robotics.\nĐiểm Demo: 4.5 điểm\nĐiểm Năng lực: 4.33 điểm",
      suggestionsFromMindx: "Con lắp ráp nhanh và lập trình VEX GO tốt.",
      futureDirection: "Tiếp tục phát huy ở khóa Robotics Arm Intensive.",
      awardRanking: "Giải Nhất (4.5/5.0 điểm)",
    });
    const draft = session14EvalRepo.findOne(robCls, robStuId)!;
    const appRes = session14EvalRepo.approveDraft(robCls, robStuId, draft.draftVersion);
    assert.strictEqual(appRes.success, true, `approveDraft lỗi: ${appRes.error}`);

    browser = await chromium.launch({ headless: true });
    (LmsHelpers as any).ensureCleanDialogAndToast = async () => {};
    (LmsHelpers as any).ensureCommentsSlotReady = async () => {};

    const page = await browser.newPage();
    let persistedEval: any = null;
    await page.route("**/*", async (route) => {
      let body: any = null;
      try {
        body = JSON.parse(route.request().postData() || "{}");
      } catch {}
      if (body?.operationName === "UpdateStudentEvaluation" && body?.variables?.input) {
        persistedEval = body.variables.input;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ data: { updateStudentEvaluation: { id: "ROB_EVAL_1" } } }),
        });
        return;
      }
      if (body?.operationName === "GetStudentEvaluation" && persistedEval) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ data: { studentEvaluation: persistedEval } }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ data: { updateStudentEvaluation: { id: "ROB_EVAL_1" } } }),
      });
    });

    const radiosHtml = Array.from({ length: 9 })
      .map((_, g) =>
        Array.from({ length: 5 })
          .map((__, r) => `<input type="radio" name="comp_${g}" value="${r + 1}" />`)
          .join("")
      )
      .join("<br/>");
    await page.setContent(`
      <html><body>
        <div class="MuiDrawer-root"><table><tbody>
          <tr data-student-id="${robStuId}">
            <td>Lê Xuân Phúc</td>
            <td><button id="open" type="button">Nhận xét học sinh</button></td>
          </tr>
        </tbody></table></div>
        <div role="dialog" style="display:none;">
          <div>${radiosHtml}</div>
          <div>
            <input type="number" disabled value="0" />
            <input type="number" max="1.25" value="0" />
            <input type="number" max="0.75" value="0" />
            <input type="number" max="1" value="0" />
            <input type="number" max="0.5" value="0" />
            <input type="number" max="1.5" value="0" />
          </div>
          <div>
            <div class="ql-editor" contenteditable="true"></div>
            <div class="ql-editor" contenteditable="true"></div>
            <div class="ql-editor" contenteditable="true"></div>
            <div class="ql-editor" contenteditable="true"></div>
          </div>
          <button id="save" type="button">Save</button>
          <button id="close" type="button" aria-label="close">Cancel</button>
        </div>
      </body></html>
    `);
    await page.evaluate(
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
                  awardRanking: texts[3],
                  texts,
                  nums,
                  ratings,
                },
              },
            }),
          }).catch(() => {});
        };
      },
      { sid: robStuId, cid: robCls }
    );

    const upRes = await Session14EvalUploader.uploadApprovedEvaluations({
      classId: robCls,
      studentIds: [robStuId],
      customPage: page,
      skipNavigation: false,
    });
    const saveClicks = await page.evaluate(() => (window as any).__saveClicks);
    await page.close();

    assert.strictEqual(saveClicks, 1);
    assert.strictEqual(upRes.verifiedCount, 1, `Upload Robotics thất bại: ${upRes.results[0]?.errorMessage}`);
    assert.deepEqual(persistedEval.nums, ["1.25", "0.75", "1", "0.25", "1.25"]);
    assert.strictEqual(persistedEval.awardRanking, "Giải Nhất (4.5/5.0 điểm)");
    assert.strictEqual(session14EvalRepo.findOne(robCls, robStuId)?.status, "VERIFIED");
    console.log("  -> PASS [ROB-TPL-04].");

    // =========================================================================
    // [ROB-TPL-05]: 10 Thư mục Google Drive ROBOTICS - SPCK, getClassDemoSheetMeta & Mock Native Google Sheet
    // =========================================================================
    console.log("\n[ROB-TPL-05] Kiểm tra định tuyến 10 thư mục Google Drive Robotics & tạo Google Trang tính Demo...");
    const {
      CODING_SPCK_COURSE_FOLDER_MAP,
      CODING_SPCK_ROOT_FOLDER_ID,
      DEFAULT_SPCK_DRIVE_FOLDER_URL,
      ROBOTICS_ARM_GROUP_FOLDER_ID,
      ROBOTICS_PRE_GROUP_FOLDER_ID,
      ROBOTICS_SEMI_GROUP_FOLDER_ID,
      ROBOTICS_SPCK_COURSE_FOLDER_MAP,
      ROBOTICS_SPCK_ROOT_FOLDER_ID,
      UMBRELLA_SPCK_ROOT_FOLDER_ID,
      isBotOrSystemIgnoredDriveFile,
      isSpckRootFolderId,
      resolveCourseSpecificFolderId,
      resolveTargetCourseDriveFolderId,
      SpckDriveUploader,
    } = await import("../src/lib/playwright/spck-drive-uploader");
    const { createAndUploadClassDemoSheetToDrive } = await import(
      "../src/lib/playwright/spck-demo-sheet"
    );
    const { getClassDemoSheetMeta } = await import("../src/app/api/spck/list/route");

    const expectedRoboticsClassMap: Array<[string, string, string]> = [
      ["VT-ROB-PREB20", "PREB", "1Ao85URmrFagoP9rjCkyKzAbNzM3h3BNv"],
      ["VT-ROB-PREA14", "PREA", "1-dctk2OMHrzkDXhMDWlvv-co8CIutGlU"],
      ["VT-ROB-PREI12", "PREI", "15-QrDqH29e2Za_81ectjQtDb8CW6XAkV"],
      ["VT-ROB-ARMB19", "ARMB", "1XSrXqmxnnVAUcEF3LK5LLNZsaFYdwOwO"],
      ["VT-ROB-ARMA18", "ARMA", "1x83vLG3UmpzmE9XZHbs_J-_FqynMBJ4-"],
      ["VT-ROB-ARMI05", "ARMI", "1UPm7QOlW4pMYoKP28fXafyx0RMXBTskC"],
      ["VT-ROB-SEMIB08", "SEMIB", "1Vme3gGCjnewL2Oicco6DxW5iAxxVI4MN"],
      ["VT-ROB-SEMIA05", "SEMIA", "1drLxRbR4FsNdlY_LO4RgKlZwCHVFckFQ"],
      ["VT-ROB-SEMII03", "SEMII", "1WscY0xcX1CIDwS6YSmBB2F7SoKa4-6dy"],
      ["VT-KIND-ROB4B04", "ROB", "1WiM0_kEQ1Lm4rf2vTysb90yQRzWhujs1"],
    ];

    assert.strictEqual(Object.keys(ROBOTICS_SPCK_COURSE_FOLDER_MAP).length, 10);
    for (const rootId of [
      CODING_SPCK_ROOT_FOLDER_ID,
      UMBRELLA_SPCK_ROOT_FOLDER_ID,
      ROBOTICS_SPCK_ROOT_FOLDER_ID,
    ]) {
      assert.strictEqual(isSpckRootFolderId(rootId), true, `Phải nhận diện root ${rootId}`);
    }

    for (const [cid, prefix, expectedId] of expectedRoboticsClassMap) {
      assert.strictEqual(ROBOTICS_SPCK_COURSE_FOLDER_MAP[prefix], expectedId);
      assert.strictEqual(CODING_SPCK_COURSE_FOLDER_MAP[prefix], expectedId);
      assert.strictEqual(resolveCourseSpecificFolderId(cid), expectedId);
      for (const rootId of [
        CODING_SPCK_ROOT_FOLDER_ID,
        UMBRELLA_SPCK_ROOT_FOLDER_ID,
        ROBOTICS_SPCK_ROOT_FOLDER_ID,
      ]) {
        const routed = resolveTargetCourseDriveFolderId(rootId, cid);
        assert.strictEqual(routed.isAutoRoutedRootOrGroup, true);
        assert.strictEqual(routed.courseFolderId, expectedId);
      }
    }

    assert.strictEqual(
      resolveTargetCourseDriveFolderId(ROBOTICS_PRE_GROUP_FOLDER_ID, "VT-ROB-PREA14").courseFolderId,
      ROBOTICS_SPCK_COURSE_FOLDER_MAP.PREA
    );
    assert.strictEqual(
      resolveTargetCourseDriveFolderId(ROBOTICS_ARM_GROUP_FOLDER_ID, "VT-ROB-ARMA18").courseFolderId,
      ROBOTICS_SPCK_COURSE_FOLDER_MAP.ARMA
    );
    assert.strictEqual(
      resolveTargetCourseDriveFolderId(ROBOTICS_SEMI_GROUP_FOLDER_ID, "VT-ROB-SEMII03").courseFolderId,
      ROBOTICS_SPCK_COURSE_FOLDER_MAP.SEMII
    );
    assert.strictEqual(
      resolveTargetCourseDriveFolderId(ROBOTICS_PRE_GROUP_FOLDER_ID, "VT-ROB-ARMA18").courseFolderId,
      null,
      "Không định tuyến chéo lớp ARM vào nhóm PRE"
    );
    assert.strictEqual(
      resolveCourseSpecificFolderId("TEST_ROBO_UNCONFIGURED_01"),
      null,
      "TEST_ROBO_UNCONFIGURED_01 vẫn phải trả null để bảo toàn tương thích ngược"
    );

    const armaMeta = getClassDemoSheetMeta("VT-ROB-ARMA18");
    assert.ok(armaMeta);
    assert.strictEqual(armaMeta.hasCourseDemoTemplate, true);
    assert.strictEqual(armaMeta.hasCourseDriveFolder, true);
    assert.strictEqual(armaMeta.spckExempt, false);

    // PTB/CSB bị chặn ở cả 3 thư mục gốc nhưng cho phép link thư mục riêng
    for (const rootUrl of [
      DEFAULT_SPCK_DRIVE_FOLDER_URL,
      `https://drive.google.com/drive/folders/${UMBRELLA_SPCK_ROOT_FOLDER_ID}`,
      `https://drive.google.com/drive/folders/${ROBOTICS_SPCK_ROOT_FOLDER_ID}`,
    ]) {
      await assert.rejects(
        () =>
          SpckDriveUploader.uploadClassSpckToGoogleDrive({
            classId: "VT-C4K-PTB01",
            driveFolderUrl: rootUrl,
          }),
        /miễn nộp SPCK/
      );
    }
    const customPtbRes = await SpckDriveUploader.uploadClassSpckToGoogleDrive({
      classId: "VT-C4K-PTB01",
      driveFolderUrl: "https://drive.google.com/drive/folders/CUSTOM_PTB_FOLDER_12345",
    });
    assert.strictEqual(customPtbRes.totalRequested, 0);

    // Filter file Robotics vs file bảng điểm tạm (F03: hỗ trợ cả cuối khóa/cuối khoá & tiền tố mã lớp)
    assert.strictEqual(
      isBotOrSystemIgnoredDriveFile("Bảng chấm điểm buổi cuối khóa ARMA13.xlsx"),
      true
    );
    assert.strictEqual(
      isBotOrSystemIgnoredDriveFile("PREA14-Bảng chấm điểm buổi cuối khoá.xlsx"),
      true
    );
    assert.strictEqual(
      isBotOrSystemIgnoredDriveFile("Bảng chấm điểm buổi cuối khoá ARMA13.xlsx"),
      true
    );
    assert.strictEqual(isBotOrSystemIgnoredDriveFile("robot_arm_final.iqblocks"), false);
    assert.strictEqual(isBotOrSystemIgnoredDriveFile("truytim_robot.goblocks"), false);

    // F01: Cross-group mismatch phải bị từ chối kể cả khi 0 bản ghi hoặc forceReupload=false
    await assert.rejects(
      () =>
        SpckDriveUploader.uploadClassSpckToGoogleDrive({
          classId: "VT-ROB-ARMA18",
          driveFolderUrl: `https://drive.google.com/drive/folders/${ROBOTICS_PRE_GROUP_FOLDER_ID}`,
        }),
      /chưa khớp với thư mục khóa học/
    );
    await assert.rejects(
      () =>
        SpckDriveUploader.uploadClassSpckToGoogleDrive({
          classId: "VT-ROB-ARMA18",
          driveFolderUrl: `https://drive.google.com/drive/folders/${ROBOTICS_PRE_GROUP_FOLDER_ID}`,
          forceReupload: true,
        }),
      /chưa khớp với thư mục khóa học/
    );

    // F02: Cross-group mismatch phải bị chặn TRƯỚC khi gọi AI pre-score
    let aiScorerCallsOnMismatch = 0;
    await assert.rejects(
      () =>
        createAndUploadClassDemoSheetToDrive({
          classId: robCls,
          driveFolderUrl: `https://drive.google.com/drive/folders/${ROBOTICS_PRE_GROUP_FOLDER_ID}`,
          enableAiPreScore: true,
          _testAiScorerOverride: async () => {
            aiScorerCallsOnMismatch += 1;
            return {
              criteria: [],
              bgkQuestions: [],
            };
          },
        }),
      /chưa khớp với thư mục khóa học/
    );
    assert.strictEqual(
      aiScorerCallsOnMismatch,
      0,
      "F02: Không được gọi AI chấm nháp khi link nhóm/gốc Google Drive bị lệch khóa"
    );

    // Mock Google Drive & Sheets để xác nhận luồng tạo Native Google Sheet cho VT-ROB-ARMA13
    // khi giữ nguyên DEFAULT_SPCK_DRIVE_FOLDER_URL tự động nhảy đúng vào ROBOTICS_SPCK_COURSE_FOLDER_MAP.ARMA
    const mockDriveItems = new Map<
      string,
      {
        id: string;
        parentId: string;
        name: string;
        isFolder: boolean;
        mimeType: string;
        tabs: string[];
        workbookBuffer?: Buffer;
        trashed?: boolean;
      }
    >();
    let mockSeq = 1;
    const nextMockId = (p: string) => `${p}_1234567890123456_${mockSeq++}`;
    const extractTabsFromBuf = (buf: Buffer): string[] => {
      const wb = new AdmZip(buf).readAsText("xl/workbook.xml");
      return Array.from(wb.matchAll(/<sheet\b[^>]*?\bname="([^"]+)"/gi)).map((m) => m[1]);
    };

    let mockBaseUrl = "";
    const mockDriveServer = http.createServer((req, res) => {
      const u = new URL(req.url || "/", "http://127.0.0.1");

      if (req.method === "POST" && u.pathname === "/api/create-folder") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const { parentId, name } = JSON.parse(body);
          const id = nextMockId("FOLDER");
          mockDriveItems.set(id, {
            id,
            parentId,
            name,
            isFolder: true,
            mimeType: "application/vnd.google-apps.folder",
            tabs: [],
          });
          res.end(JSON.stringify({ id }));
        });
        return;
      }

      if (req.method === "POST" && u.pathname === "/api/create-sheet") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const { parentId } = JSON.parse(body);
          const id = nextMockId("GSHEET");
          mockDriveItems.set(id, {
            id,
            parentId,
            name: "Bảng tính không có tiêu đề",
            isFolder: false,
            mimeType: "application/vnd.google-apps.spreadsheet",
            tabs: ["Trang tính1"],
          });
          res.end(JSON.stringify({ id, editUrl: `${mockBaseUrl}/spreadsheets/d/${id}/edit` }));
        });
        return;
      }

      if (req.method === "POST" && u.pathname === "/api/import-replace") {
        const sheetId = u.searchParams.get("sheetId") || "";
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          const buf = Buffer.concat(chunks);
          const it = mockDriveItems.get(sheetId);
          if (it) {
            it.tabs = extractTabsFromBuf(buf);
            it.workbookBuffer = buf;
          }
          res.end(JSON.stringify({ tabs: it?.tabs || [] }));
        });
        return;
      }

      if (req.method === "POST" && u.pathname === "/api/rename") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const { sheetId, title } = JSON.parse(body);
          const it = mockDriveItems.get(sheetId);
          if (it) it.name = title;
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }

      if (req.method === "POST" && u.pathname === "/api/trash") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const { id } = JSON.parse(body);
          const it = mockDriveItems.get(id);
          if (it) it.trashed = true;
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }

      if (req.method === "GET" && u.pathname === "/picker-frame") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html><html><body>
          <div role="tab" id="tab-upload">Tải lên</div>
          <input type="file" id="picker-file" />
          <script>
            document.getElementById('picker-file').addEventListener('change', async (e) => {
              const f = e.target.files[0];
              if (!f) return;
              const buf = await f.arrayBuffer();
              window.parent.postMessage({ type: 'UPLOADED', bytes: Array.from(new Uint8Array(buf)) }, '*');
            });
          </script>
        </body></html>`);
        return;
      }

      const editMatch = u.pathname.match(/^\/spreadsheets\/d\/([^/]+)\/edit$/);
      if (req.method === "GET" && editMatch) {
        const sheetId = editMatch[1];
        const it = mockDriveItems.get(sheetId);
        if (!it) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html><html><body>
          <div id="docs-title-widget"><input class="docs-title-input" value="${it.name}" /></div>
          <div id="docs-titlebar-badges"></div>
          <span id="docs-save-indicator-badge" aria-label="Đã lưu vào Drive">Đã lưu vào Drive</span>
          <div id="docs-file-menu">Tệp</div>
          <div id="file-menu" style="display:none;"><div class="goog-menuitem" role="menuitem" id="mi-import">Nhập</div></div>
          <div id="picker-host"></div>
          <div id="import-dlg" role="dialog" style="display:none;">
            <div>Vị trí nhập</div>
            <select><option value="new">Tạo mới</option><option value="replace">Thay thế bảng tính</option></select>
            <button type="button" name="import-data" id="btn-import">Nhập dữ liệu</button>
          </div>
          <div id="tabs">${it.tabs.map((t) => `<span class="docs-sheet-tab-name">${t}</span>`).join("")}</div>
          <script>
            const sheetId = ${JSON.stringify(sheetId)};
            let uploaded = null;
            const titleEl = document.querySelector('.docs-title-input');
            titleEl.addEventListener('keydown', async (e) => {
              if (e.key === 'Enter') {
                await fetch('/api/rename', { method: 'POST', body: JSON.stringify({ sheetId, title: titleEl.value }) });
              }
            });
            document.getElementById('docs-file-menu').onclick = () => {
              document.getElementById('file-menu').style.display = 'block';
            };
            document.getElementById('mi-import').onclick = () => {
              document.getElementById('file-menu').style.display = 'none';
              document.getElementById('picker-host').innerHTML = '<iframe src="/picker-frame"></iframe>';
            };
            window.addEventListener('message', (ev) => {
              if (ev.data?.type === 'UPLOADED') {
                uploaded = new Uint8Array(ev.data.bytes);
                document.getElementById('import-dlg').style.display = 'block';
              }
            });
            document.getElementById('btn-import').onclick = async () => {
              const r = await fetch('/api/import-replace?sheetId=' + sheetId, { method: 'POST', body: uploaded });
              const d = await r.json();
              document.getElementById('import-dlg').style.display = 'none';
              document.getElementById('tabs').innerHTML = d.tabs.map(t => '<span class="docs-sheet-tab-name">' + t + '</span>').join('');
            };
          </script>
        </body></html>`);
        return;
      }

      const folderMatch = u.pathname.match(/^\/drive\/folders\/([^/]+)$/);
      if (req.method === "GET" && folderMatch) {
        const folderId = folderMatch[1];
        const children = Array.from(mockDriveItems.values()).filter(
          (i) => i.parentId === folderId && !i.trashed
        );
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html><html><body>
          <button guidedhelpid="new_menu_button" aria-label="Mới" id="btn-new">+ Mới</button>
          <div id="new-menu" role="menu" style="display:none;">
            <div role="menuitem" id="mi-folder">Thư mục mới</div>
            <div role="menuitem" id="mi-gs" style="width:200px;height:28px;">Google Trang tính</div>
          </div>
          <div id="dlg-new-folder" role="dialog" style="display:none;">
            <div>Thư mục mới</div>
            <input type="text" id="inp-folder-name" />
            <button type="button" id="btn-create-folder">Tạo</button>
          </div>
          <div id="dlg-shared" role="dialog" style="display:none;"><button type="button" id="btn-shared">Tạo và chia sẻ</button></div>
          <main role="main">
            ${children
              .map((c) => {
                const t = c.isFolder
                  ? "folder"
                  : c.mimeType === "application/vnd.google-apps.spreadsheet"
                  ? "spreadsheet"
                  : "file";
                return `<div data-target="doc" data-id="${c.id}" data-type="${t}" data-mime-type="${c.mimeType}"><div data-id="${c.id}">${c.name}</div></div>`;
              })
              .join("")}
          </main>
          <script>
            const folderId = ${JSON.stringify(folderId)};
            document.getElementById('btn-new').onclick = () => document.getElementById('new-menu').style.display = 'block';
            document.getElementById('mi-folder').onclick = () => {
              document.getElementById('new-menu').style.display = 'none';
              document.getElementById('dlg-new-folder').style.display = 'block';
            };
            document.getElementById('btn-create-folder').onclick = async () => {
              const name = document.getElementById('inp-folder-name').value;
              await fetch('/api/create-folder', { method: 'POST', body: JSON.stringify({ parentId: folderId, name }) });
              document.getElementById('dlg-new-folder').style.display = 'none';
              location.reload();
            };
            document.getElementById('mi-gs').onclick = () => {
              document.getElementById('new-menu').style.display = 'none';
              document.getElementById('dlg-shared').style.display = 'block';
            };
            document.getElementById('btn-shared').onclick = async () => {
              document.getElementById('dlg-shared').style.display = 'none';
              const r = await fetch('/api/create-sheet', { method: 'POST', body: JSON.stringify({ parentId: folderId }) });
              window.open((await r.json()).editUrl, '_blank');
            };
          </script>
        </body></html>`);
        return;
      }

      res.writeHead(404).end();
    });

    await new Promise<void>((resolve) => mockDriveServer.listen(0, "127.0.0.1", () => resolve()));
    const mockAddr = mockDriveServer.address();
    mockBaseUrl = `http://127.0.0.1:${typeof mockAddr === "object" && mockAddr ? mockAddr.port : 0}`;
    const drivePage = await browser.newPage();
    try {
      const localRobDir = path.join(tempDir, "ROB_ARMA13_LOCAL");
      fs.mkdirSync(localRobDir, { recursive: true });
      const robSheetRes = await createAndUploadClassDemoSheetToDrive({
        classId: robCls,
        driveFolderUrl: DEFAULT_SPCK_DRIVE_FOLDER_URL,
        localClassFolderPath: localRobDir,
        enableAiPreScore: false,
        _testHarness: { page: drivePage, driveBaseUrl: mockBaseUrl, sheetsBaseUrl: mockBaseUrl },
      });
      assert.strictEqual(robSheetRes.isNativeGoogleSheet, true);
      assert.strictEqual(robSheetRes.mimeType, "application/vnd.google-apps.spreadsheet");
      const createdClassFolder = Array.from(mockDriveItems.values()).find(
        (i) =>
          i.isFolder &&
          i.name === robCls &&
          i.parentId === ROBOTICS_SPCK_COURSE_FOLDER_MAP.ARMA
      );
      assert.ok(
        createdClassFolder,
        `Phải tự tạo thư mục ${robCls} trực tiếp trong 2. ARMA (${ROBOTICS_SPCK_COURSE_FOLDER_MAP.ARMA})`
      );
      const createdSheet = mockDriveItems.get(robSheetRes.driveFileId || "");
      assert.ok(createdSheet && createdSheet.parentId === createdClassFolder.id);
      assert.strictEqual(createdSheet.name, "Bảng chấm điểm buổi Demo Truy tìm bí ẩn Robot - Advanced");

      // F01: fast-skip unchanged-digest must ALSO reject when driveFolderUrl mismatches course group
      const f01StuDir = path.join(localRobDir, "F01_Student");
      fs.mkdirSync(f01StuDir, { recursive: true });
      fs.writeFileSync(path.join(f01StuDir, "demo.goblocks"), "goblocks", "utf8");
      const f01Digest = computeStudentFolderContentDigest(f01StuDir).digest;
      spckUploadRepo.upsert({
        classId: robCls,
        studentId: robStuId,
        localFolderPath: f01StuDir,
        matchScore: 1,
        isConfirmedByTeacher: 1,
        status: "DRAFT",
        projectTitle: "SPCK F01",
        thumbnailPath: "",
        screenshotsJson: "[]",
        attachmentsJson: "[]",
        youtubeUrlsJson: "[]",
        relatedLinksJson: JSON.stringify([
          { name: "Drive", url: "https://drive.google.com/drive/folders/EXISTING_DRIVE_ID_12345" },
        ]),
        lastDriveUploadedDigest: f01Digest,
        lastPreppedFolderDigest: f01Digest,
      });
      await assert.rejects(
        () =>
          SpckDriveUploader.uploadClassSpckToGoogleDrive({
            classId: robCls,
            studentIds: [robStuId],
            driveFolderUrl: `https://drive.google.com/drive/folders/${ROBOTICS_PRE_GROUP_FOLDER_ID}`,
          }),
        /chưa khớp với thư mục khóa học/,
        "F01: Không được fast-skip trả về thành công giả khi link Drive lệch nhóm khóa học"
      );

      // F03: Verify listDriveFilesInFolder handles Vietnamese old/new tone ("cuối khóa"/"cuối khoá") with em-dash DOM
      const { listDriveFilesInFolder } = await import("../src/lib/playwright/spck-demo-sheet");
      const probeFolderId = nextMockId("PROBEF03");
      await drivePage.setContent(`
        <html><body><main role="main">
          <div data-target="doc" data-id="GS_OLD_1234567890123456" style="padding:8px;display:flex;gap:12px;"><span>PREA14-Bảng chấm điểm buổi cuối khoá</span><span>tôi</span><span>—</span></div>
          <div data-target="doc" data-id="IQ_FILE_1234567890123456" style="padding:8px;display:flex;gap:12px;"><span>robot_arm.iqblocks</span><span>tôi</span><span>—</span></div>
          <div data-target="doc" data-id="GO_FILE_1234567890123456" style="padding:8px;display:flex;gap:12px;"><span>vex_go.goblocks</span><span>tôi</span><span>—</span></div>
        </main></body></html>
      `);
      const listedF03 = await listDriveFilesInFolder(drivePage, probeFolderId);
      const sheetEntry = listedF03.find((i) => i.id === "GS_OLD_1234567890123456");
      const iqEntry = listedF03.find((i) => i.id === "IQ_FILE_1234567890123456");
      const goEntry = listedF03.find((i) => i.id === "GO_FILE_1234567890123456");
      assert.ok(sheetEntry && sheetEntry.isGoogleSheet && !sheetEntry.isFolder);
      assert.ok(iqEntry && !iqEntry.isFolder);
      assert.ok(goEntry && !goEntry.isFolder);
    } finally {
      await drivePage.close().catch(() => {});
      await new Promise<void>((resolve) => mockDriveServer.close(() => resolve()));
    }
    console.log("  -> PASS [ROB-TPL-05].");

    console.log("\n✅ TOÀN BỘ 5/5 NHÓM KIỂM THỬ ROBOTICS DEMO TEMPLATES & DRIVE MAP v3.8.9 PASS 100%!");
  } finally {
    (LmsHelpers as any).ensureCleanDialogAndToast = origCleanToast;
    (LmsHelpers as any).ensureCommentsSlotReady = origEnsureSlot;
    if (browser) await browser.close().catch(() => {});
    try {
      closeDb?.();
    } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

runTests().catch((err) => {
  console.error("❌ TEST FAILED:", err);
  process.exit(1);
});
