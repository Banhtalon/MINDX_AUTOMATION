/**
 * KIỂM THỬ TỰ ĐỘNG v3.6.5:
 * - V365-01: Bỏ sạch chữ hệ thống "AI gợi ý" / "của AI" khỏi Cột G (tiêu đề, dòng chấm nháp & fallback)
 *            nhưng bảo toàn nguyên vẹn từ "AI" trong đề tài sản phẩm của học viên.
 * - V365-02: Tô màu vàng (#FFE599 / FFFFE599) CHỈ trong bảng điểm B..E ở các dòng Giám khảo chấm
 *            trên toàn bộ 14 mẫu khóa học (CSA, CSI, GA, GB, GI, JSA, JSB, JSI, PSI, PTA, PTI, SA, SB, SI);
 *            tuyệt đối KHÔNG tô A, F, G, tiêu đề trên, Nhận xét/BGK1/BGK2/LO dưới hay sheet "Phân bổ điểm".
 * - V365-03: Bảo toàn 100% viền, căn lề/wrapText, định dạng số thập phân, công thức <f t="shared">,
 *            dropdown, chèn bù ô thưa thiếu <c>, nhánh synthetic fallback & đọc điểm ngược Buổi 14.
 *
 * Chạy 100% cô lập trong `os.tmpdir()` — không chạm dữ liệu thật.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";

interface ParsedXfInfo {
  attrs: string;
  inner: string;
  numFmtId: string;
  fontId: string;
  fillId: number;
  borderId: string;
  applyFill: string;
}

function parseStylesXmlInfo(stylesXml: string): {
  fills: string[];
  cellXfs: ParsedXfInfo[];
} {
  const fillsMatch = stylesXml.match(/<fills\b[^>]*>([\s\S]*?)<\/fills>/i);
  const fills = fillsMatch
    ? fillsMatch[1].match(/<fill\b(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/fill>)/gi) || []
    : [];

  const cellXfsMatch = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/i);
  const cellXfsInner = cellXfsMatch ? cellXfsMatch[1] : "";
  const cellXfs: ParsedXfInfo[] = [];
  const xfRegex = /<xf\b([^>]*?)(?:\/>|>([\s\S]*?)<\/xf>)/gi;
  let m: RegExpExecArray | null;
  while ((m = xfRegex.exec(cellXfsInner)) !== null) {
    const attrs = m[1] || "";
    const inner = (m[2] || "").trim();
    cellXfs.push({
      attrs,
      inner,
      numFmtId: attrs.match(/\bnumFmtId="([^"]+)"/i)?.[1] || "0",
      fontId: attrs.match(/\bfontId="([^"]+)"/i)?.[1] || "0",
      fillId: parseInt(attrs.match(/\bfillId="(\d+)"/i)?.[1] || "0", 10),
      borderId: attrs.match(/\bborderId="([^"]+)"/i)?.[1] || "0",
      applyFill: attrs.match(/\bapplyFill="([^"]+)"/i)?.[1] || "",
    });
  }
  return { fills, cellXfs };
}

function extractSheetCellStyleMap(sheetXml: string): Map<string, number> {
  const map = new Map<string, number>();
  const sheetData = sheetXml.match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/i)?.[1] || "";
  const cellOpenRegex = /<c(\s[^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = cellOpenRegex.exec(sheetData)) !== null) {
    const attrs = m[1];
    const ref = attrs.match(/\br="([A-Z]+\d+)"/i)?.[1]?.toUpperCase();
    if (!ref) continue;
    const sId = parseInt(attrs.match(/\bs="(\d+)"/i)?.[1] || "0", 10);
    map.set(ref, sId);
  }
  return map;
}

function getFillArgbForStyle(
  styleInfo: { fills: string[]; cellXfs: ParsedXfInfo[] },
  styleId: number
): string | null {
  const xf = styleInfo.cellXfs[styleId];
  if (!xf) return null;
  if (xf.applyFill !== "1") return null;
  const fillXml = styleInfo.fills[xf.fillId] || "";
  return fillXml.match(/<fgColor\b[^>]*?\brgb="([^"]+)"/i)?.[1]?.toUpperCase() || null;
}

function assertStrictlyBoundedYellowCells(params: {
  templateStylesXml: string;
  templateSheet1Xml: string;
  builtZip: AdmZip;
  studentTabIndex: number;
  judgeRowNumbers: Set<number>;
  allCriteriaRows: number[];
  yellowArgb: string;
  label: string;
}) {
  const {
    templateStylesXml,
    templateSheet1Xml,
    builtZip,
    studentTabIndex,
    judgeRowNumbers,
    allCriteriaRows,
    yellowArgb,
    label,
  } = params;

  const builtStylesXml = builtZip.getEntry("xl/styles.xml")!.getData().toString("utf8");
  const builtStyleInfo = parseStylesXmlInfo(builtStylesXml);
  const origStyleInfo = parseStylesXmlInfo(templateStylesXml);
  const origCellStyles = extractSheetCellStyleMap(templateSheet1Xml);

  const builtSheetXml = builtZip
    .getEntry(`xl/worksheets/sheet${studentTabIndex}.xml`)!
    .getData()
    .toString("utf8");
  const builtCellStyles = extractSheetCellStyleMap(builtSheetXml);

  const criteriaSet = new Set(allCriteriaRows);

  for (const [ref, styleId] of builtCellStyles.entries()) {
    const m = ref.match(/^([A-Z]+)(\d+)$/);
    if (!m) continue;
    const col = m[1];
    const rowNum = parseInt(m[2], 10);
    const argb = getFillArgbForStyle(builtStyleInfo, styleId);
    const isYellow = argb === yellowArgb;
    const inScoringColumns = col === "B" || col === "C" || col === "D" || col === "E";
    const expectedYellow = inScoringColumns && judgeRowNumbers.has(rowNum);

    if (expectedYellow) {
      assert.strictEqual(
        isYellow,
        true,
        `[${label}] Ô ${ref} thuộc phần GK chấm phải được tô màu vàng ${yellowArgb}, thực tế style=${styleId}, argb=${argb}`
      );
      const origSid = origCellStyles.get(ref);
      if (origSid !== undefined) {
        const origXf = origStyleInfo.cellXfs[origSid];
        const newXf = builtStyleInfo.cellXfs[styleId];
        assert.ok(origXf && newXf, `[${label}] Thiếu <xf> cho ô ${ref}`);
        assert.strictEqual(
          newXf.numFmtId,
          origXf.numFmtId,
          `[${label}] Ô ${ref} bị mất numFmtId gốc (${origXf.numFmtId} -> ${newXf.numFmtId})`
        );
        assert.strictEqual(
          newXf.fontId,
          origXf.fontId,
          `[${label}] Ô ${ref} bị đổi fontId gốc (${origXf.fontId} -> ${newXf.fontId})`
        );
        assert.strictEqual(
          newXf.borderId,
          origXf.borderId,
          `[${label}] Ô ${ref} bị đổi borderId gốc (${origXf.borderId} -> ${newXf.borderId})`
        );
        assert.strictEqual(
          newXf.inner,
          origXf.inner,
          `[${label}] Ô ${ref} bị mất alignment/wrapText gốc`
        );
      }
    } else {
      assert.strictEqual(
        isYellow,
        false,
        `[${label}] Ô ${ref} nằm ngoài phần GK chấm (criteria=${criteriaSet.has(rowNum)}, col=${col}) NHƯNG bị tô vàng nhầm!`
      );
    }
  }
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-demo-yellow-v365-"));
  const originalConfigDir = process.env.MINDX_CONFIG_DIR;

  process.env.MINDX_DB_PATH = path.join(tempDir, "test_v365.db");
  process.env.MINDX_RUNNING_CLASSES_PATH = path.join(tempDir, "running_classes.json");
  process.env.MINDX_ALLOWED_EXTRA_PATHS = tempDir;

  const { getDb, studentRepo, spckUploadRepo } = await import("../src/lib/db/sqlite");
  const {
    extractDemoTemplateRubricStructure,
    generateDemoSheetAiPreScoresForClass,
    stripLeadingAiSuggestionLabel,
  } = await import("../src/lib/gemini/spck-demo-sheet-scorer");
  const {
    JUDGE_SCORING_YELLOW_FILL_ARGB,
    buildDemoScoringWorkbookBuffer,
    getDemoSheetTitleForClass,
    getSavedCourseTemplatePath,
    injectYellowHighlightStylesIntoStylesXml,
  } = await import("../src/lib/playwright/spck-demo-sheet");
  const { parseSharedStringsXml, parseWorksheetCells, extractDemoScoresFromWorksheet } =
    await import("../src/lib/local-files/spck-demo-score-reader");

  try {
    console.log("🚀 BẮT ĐẦU KIỂM THỬ v3.6.5 TRONG:", tempDir);

    // =========================================================================
    // V365-01: Xóa sạch nhãn "AI gợi ý" / "của AI" khỏi Cột G nhưng giữ từ "AI" của đề tài HS
    // =========================================================================
    console.log("\n[V365-01] Kiểm tra sạch nhãn 'AI gợi ý' / 'của AI' ở Cột G...");

    // 0) Direct label-stripper & student-project preservation checks (V365-F02 + V365-F03)
    const stripCases: Array<[string, string]> = [
      ["[AI gợi ý: Tốt]: Hàm run() hoạt động đúng.", "Hàm run() hoạt động đúng."],
      ["[AI gợi ý: Tốt] - Hàm run() hoạt động đúng.", "Hàm run() hoạt động đúng."],
      ["[Gợi ý của AI] Hàm run() chạy ổn định.", "Hàm run() chạy ổn định."],
      [
        "[Gợi ý nhanh của AI: Hoàn thành] Giao diện app.py cần căn lề thêm.",
        "Giao diện app.py cần căn lề thêm.",
      ],
      ["(Gợi ý của AI: Tốt) Code tổ chức tốt.", "Code tổ chức tốt."],
      ["(AI gợi ý: Tốt) Xử lý gói cước $100.", "Xử lý gói cước $100."],
      ["Theo AI: Logic kiểm tra biên tốt.", "Logic kiểm tra biên tốt."],
      ["AI gợi ý: Tốt - Code rõ ràng.", "Code rõ ràng."],
      ["AI gợi ý Tốt: Hàm clean.", "Hàm clean."],
      ["AI gợi ý Tốt", ""],
      // Student project sentences that start with AI/Hệ thống MUST remain 100% intact!
      [
        "AI gợi ý tốt cho người dùng khi chọn món ăn.",
        "AI gợi ý tốt cho người dùng khi chọn món ăn.",
      ],
      [
        "AI đánh giá tốt câu trả lời người dùng.",
        "AI đánh giá tốt câu trả lời người dùng.",
      ],
      [
        "Hệ thống gợi ý tốt các bộ phim phù hợp.",
        "Hệ thống gợi ý tốt các bộ phim phù hợp.",
      ],
      [
        "AI gợi ý món ăn theo sở thích hoạt động tốt trong app.py.",
        "AI gợi ý món ăn theo sở thích hoạt động tốt trong app.py.",
      ],
      [
        "Hệ thống gợi ý sách theo thể loại chạy mượt trong main.py.",
        "Hệ thống gợi ý sách theo thể loại chạy mượt trong main.py.",
      ],
      [
        "AI đánh giá bài luận tiếng Anh chính xác trong eval.py.",
        "AI đánh giá bài luận tiếng Anh chính xác trong eval.py.",
      ],
      [
        "AI chatbot tư vấn tuyển sinh hoạt động ổn.",
        "AI chatbot tư vấn tuyển sinh hoạt động ổn.",
      ],
    ];
    for (const [input, expected] of stripCases) {
      assert.strictEqual(
        stripLeadingAiSuggestionLabel(input),
        expected,
        `stripLeadingAiSuggestionLabel sai với "${input}"`
      );
    }

    const classIdCsi = "VT-CSI02";
    const csiDir = path.join(tempDir, "VT-CSI02");
    const s1Dir = path.join(csiDir, "Nguyễn Ngọc Minh");
    const s2Dir = path.join(csiDir, "Trần Nhật Quang");
    const s4Dir = path.join(csiDir, "Phạm Gia Hưng (Lỗi AI)");
    fs.mkdirSync(s1Dir, { recursive: true });
    fs.mkdirSync(s2Dir, { recursive: true });
    fs.mkdirSync(s4Dir, { recursive: true });

    fs.writeFileSync(
      path.join(s1Dir, "app.py"),
      "def ask_bot(prompt):\n    # AI chatbot tư vấn tuyển sinh\n    return prompt\n",
      "utf8"
    );
    fs.writeFileSync(path.join(s1Dir, "slides.pdf"), "%PDF-1.4 demo", "utf8");
    fs.writeFileSync(path.join(s2Dir, "broken.ipynb"), "{invalid-json", "utf8");
    fs.writeFileSync(path.join(s4Dir, "main.py"), "print('AI LLM Assistant')\n", "utf8");

    const db = getDb();
    db.prepare(
      `INSERT INTO classes_sessions (sessionId, classId, className, sessionNumber, date) VALUES (?, ?, ?, 14, '2026-11-22')`
    ).run(`${classIdCsi}_SESS_14`, classIdCsi, classIdCsi);

    const tabs = [
      { studentId: "STU_1", fullName: "Nguyễn Ngọc Minh", tabName: "Nguyễn Ngọc Minh" },
      { studentId: "STU_2", fullName: "Trần Nhật Quang", tabName: "Trần Nhật Quang" },
      { studentId: "STU_3", fullName: "Lê Bảo An (Vắng bài)", tabName: "Lê Bảo An (Vắng bài)" },
      { studentId: "STU_4", fullName: "Phạm Gia Hưng (Lỗi AI)", tabName: "Phạm Gia Hưng (Lỗi AI)" },
    ];
    for (const s of tabs) {
      studentRepo.upsert({
        studentId: s.studentId,
        classId: classIdCsi,
        fullName: s.fullName,
        isActive: 1,
      });
    }
    spckUploadRepo.upsert({
      classId: classIdCsi,
      studentId: "STU_1",
      isConfirmedByTeacher: 1,
      localFolderPath: s1Dir,
      projectTitle: "UniBot AI LLM",
      attachmentsJson: JSON.stringify([path.join(s1Dir, "app.py"), path.join(s1Dir, "slides.pdf")]),
      screenshotsJson: "[]",
      youtubeUrlsJson: "[]",
      relatedLinksJson: JSON.stringify([{ name: "Web", url: "https://unibot.github.io" }]),
      status: "DRAFT",
    });
    spckUploadRepo.upsert({
      classId: classIdCsi,
      studentId: "STU_4",
      isConfirmedByTeacher: 1,
      localFolderPath: s4Dir,
      projectTitle: "LLM Assistant",
      attachmentsJson: JSON.stringify([path.join(s4Dir, "main.py")]),
      screenshotsJson: "[]",
      youtubeUrlsJson: "[]",
      relatedLinksJson: "[]",
      status: "DRAFT",
    });

    const csiTplPath = getSavedCourseTemplatePath(classIdCsi)!;
    const csiTplBuf = fs.readFileSync(csiTplPath);
    const csiStruct = extractDemoTemplateRubricStructure(csiTplBuf);

    const aiRes = await generateDemoSheetAiPreScoresForClass({
      classId: classIdCsi,
      studentTabs: tabs,
      templateBuffer: csiTplBuf,
      localClassFolderPath: csiDir,
      _testRetryOptions: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 2, interStudentDelayMs: 0 },
      _testAiScorerOverride: async ({ anonymousToken, scorableCriteria }) => {
        if (anonymousToken === "STUDENT_04") {
          throw new Error("[503] Service Unavailable");
        }
        return {
          criteria: scorableCriteria.map((c, idx) => ({
            rowNumber: c.rowNumber,
            rating: idx === 1 ? "Hoàn thành" : "Tốt",
            evidenceNote:
              idx === 0
                ? "[AI gợi ý: Tốt] Ứng dụng AI LLM kết hợp Context Injection xử lý hàm ask_bot()."
                : idx === 1
                ? "AI gợi ý - Hoàn thành: Tích hợp AI chatbot nhưng chưa tối ưu bộ nhớ đệm."
                : idx === 2
                ? "Gợi ý của AI: Bố cục app.py mạch lạc."
                : idx === 3
                ? ""
                : idx === 4
                ? "(AI gợi ý: Tốt) Xử lý gói cước $100 và nhóm regex $1 chính xác."
                : "Hàm ask_bot() và file slides.pdf đầy đủ.",
          })),
          bgkQuestions: [
            "[AI gợi ý] Hỏi: Hàm ask_bot() xử lý câu hỏi ngoài phạm vi thế nào? -> Gợi ý đáp án mong đợi: Kiểm tra fallback prompt.",
            "Gợi ý của AI: Hỏi: Nếu API LLM chậm 5s thì giao diện báo ra sao? -> Gợi ý đáp án mong đợi: Hiện trạng thái đang xử lý.",
            "Hỏi: Chuỗi regex $& và $' xử lý thế nào? -> Gợi ý đáp án mong đợi: Escape an toàn.",
          ],
        };
      },
    });

    assert.strictEqual(aiRes.preScoredCount, 1);
    assert.strictEqual(aiRes.skippedCount, 3);
    assert.strictEqual(aiRes.skipReasons.parseErrorCount, 1);
    assert.strictEqual(aiRes.skipReasons.noEvidenceCount, 1);
    assert.strictEqual(aiRes.skipReasons.aiErrorCount, 1);

    const csiWb = buildDemoScoringWorkbookBuffer({
      classId: classIdCsi,
      sheetTitle: getDemoSheetTitleForClass(classIdCsi),
      demoDate: "2026-11-22",
      evalDate: "2026-11-22",
      studentTabs: tabs,
      templateBuffer: csiTplBuf,
      aiTabAnnotations: aiRes.byTabName,
    });

    const csiBuiltZip = new AdmZip(csiWb);
    const csiSst = csiBuiltZip.getEntry("xl/sharedStrings.xml")
      ? parseSharedStringsXml(csiBuiltZip.getEntry("xl/sharedStrings.xml")!.getData().toString("utf8"))
      : [];

    for (let tIdx = 0; tIdx < tabs.length; tIdx++) {
      const sheetXml = csiBuiltZip
        .getEntry(`xl/worksheets/sheet${tIdx + 1}.xml`)!
        .getData()
        .toString("utf8");
      const textMap = parseWorksheetCells(sheetXml, csiSst);
      const colGHeader = textMap.get(`G${csiStruct.headerRow}`)?.stringValue || "";
      assert.strictEqual(
        colGHeader,
        "Ghi chú đối chiếu & Câu hỏi BGK",
        `Tab ${tIdx + 1} sai tiêu đề Cột G: ${colGHeader}`
      );
      for (const [ref, cell] of textMap.entries()) {
        if (!ref.startsWith("G")) continue;
        const val = cell?.stringValue || "";
        assert.ok(
          !/\[AI gợi ý:|AI gợi ý|Gợi ý của AI|Gợi ý nhanh của AI|Không thể gọi AI|AI đối chiếu/i.test(
            val
          ),
          `Tab ${tIdx + 1} ô ${ref} vẫn chứa cụm từ AI hệ thống: ${val}`
        );
      }
      if (tIdx === 0) {
        const aiRows = csiStruct.criteriaRows.filter(
          (r) => aiRes.byTabName[tabs[0].tabName].criteriaByRow[r.rowNumber]?.isAiScored
        );
        assert.ok(aiRows.length >= 5);
        assert.strictEqual(
          textMap.get(`G${aiRows[0].rowNumber}`)?.stringValue,
          "Ứng dụng AI LLM kết hợp Context Injection xử lý hàm ask_bot()."
        );
        assert.strictEqual(
          textMap.get(`G${aiRows[1].rowNumber}`)?.stringValue,
          "Tích hợp AI chatbot nhưng chưa tối ưu bộ nhớ đệm."
        );
        assert.strictEqual(
          textMap.get(`G${aiRows[2].rowNumber}`)?.stringValue,
          "Bố cục app.py mạch lạc."
        );
        assert.strictEqual(
          textMap.get(`G${aiRows[3].rowNumber}`)?.stringValue,
          "Đã đối chiếu mã nguồn/tư liệu dự án."
        );
        assert.strictEqual(
          textMap.get(`G${aiRows[4].rowNumber}`)?.stringValue,
          "Xử lý gói cước $100 và nhóm regex $1 chính xác."
        );
      }
    }

    // Check PSI.xlsx (template missing <row r="34"> for 3rd BGK question) with $& / $' / $` in Column G (V365-F01)
    const psiTplBuf = fs.readFileSync(getSavedCourseTemplatePath("VT-PSI01")!);
    const psiStruct = extractDemoTemplateRubricStructure(psiTplBuf);
    const psiCriteriaByRow: Record<
      number,
      { rowNumber: number; rating: "Tốt" | "Hoàn thành" | "Chưa đạt"; isAiScored: boolean; columnGNote: string }
    > = {};
    psiStruct.criteriaRows.forEach((r, idx) => {
      psiCriteriaByRow[r.rowNumber] = {
        rowNumber: r.rowNumber,
        rating: "Tốt",
        isAiScored: idx === 0,
        columnGNote:
          idx === 0
            ? "Regex dùng $& và $' và $` và $$ để format giá $100."
            : "[GK chấm trực tiếp khi con thuyết trình & trả lời vấn đáp]",
      };
    });
    const psiWb = buildDemoScoringWorkbookBuffer({
      classId: "VT-PSI01",
      sheetTitle: "PSI Check",
      demoDate: "2026-11-22",
      evalDate: "2026-11-22",
      studentTabs: [{ studentId: "P1", fullName: "Phạm Minh Tuấn", tabName: "Phạm Minh Tuấn" }],
      templateBuffer: psiTplBuf,
      aiTabAnnotations: {
        "Phạm Minh Tuấn": {
          studentId: "P1",
          criteriaByRow: psiCriteriaByRow,
          bgkQuestions: [
            "Hỏi: Câu 1?",
            "Hỏi: Câu 2?",
            "Hỏi: Câu 3 nằm ở dòng 34 chưa tồn tại sẵn?",
          ],
        },
      },
    });
    const psiBuiltXml = new AdmZip(psiWb)
      .getEntry("xl/worksheets/sheet1.xml")!
      .getData()
      .toString("utf8");
    const sheetDataOpenTags = psiBuiltXml.match(/<sheetData\b/gi) || [];
    assert.strictEqual(
      sheetDataOpenTags.length,
      1,
      `PSI sheetData bị nhân bản (${sheetDataOpenTags.length} thẻ) do ký tự $& / $'!`
    );
    assert.ok(psiBuiltXml.includes(`<row r="${psiStruct.nhanXetRow + 3}">`));
    console.log("  -> PASS [V365-01].");

    // =========================================================================
    // V365-02: Tô vàng CHỈ vùng B..E các dòng GK chấm trên 24/24 mẫu khóa học (14 Coding + 10 Robotics)
    // =========================================================================
    console.log("\n[V365-02] Kiểm tra tô vàng đúng vùng B..E trên toàn bộ 24/24 mẫu khóa học...");
    const tplDir = path.resolve(process.cwd(), "data/config/demo-sheet-templates");
    const tplFiles = fs
      .readdirSync(tplDir)
      .filter((f) => f.endsWith(".xlsx"))
      .sort();
    assert.strictEqual(tplFiles.length, 24, `Kỳ vọng 24 file mẫu (14 Coding + 10 Robotics), thấy ${tplFiles.length}`);

    for (const fileName of tplFiles) {
      const course = fileName.replace(/\.xlsx$/i, "");
      const tplBuf = fs.readFileSync(path.join(tplDir, fileName));
      const tplZip = new AdmZip(tplBuf);
      const tplStylesXml = tplZip.getEntry("xl/styles.xml")!.getData().toString("utf8");
      const tplSheet1Xml = tplZip.getEntry("xl/worksheets/sheet1.xml")!.getData().toString("utf8");
      const struct = extractDemoTemplateRubricStructure(tplBuf);

      // Tạo 2 kịch bản tab trong cùng 1 workbook:
      // Tab 1: Có AI chấm nháp các dòng sản phẩm + giữ dòng vấn đáp & dòng thiếu Slide/Video cho GK chấm
      // Tab 2: Không có dữ liệu chấm nháp (fallback toàn bảng do GK chấm)
      const criteriaByRowTab1: Record<
        number,
        { rowNumber: number; rating: "Tốt" | "Hoàn thành" | "Chưa đạt"; isAiScored: boolean; columnGNote: string }
      > = {};
      const expectedJudgeRowsTab1 = new Set<number>();

      struct.criteriaRows.forEach((r, idx) => {
        const isJudge =
          r.scorability === "LIVE_JUDGE_ONLY" ||
          r.scorability === "CONDITIONAL_SLIDE" ||
          (r.scorability === "CONDITIONAL_VIDEO_OR_LINK" && idx % 2 === 1);
        if (isJudge) {
          expectedJudgeRowsTab1.add(r.rowNumber);
          criteriaByRowTab1[r.rowNumber] = {
            rowNumber: r.rowNumber,
            rating: "Tốt",
            isAiScored: false,
            columnGNote: "[GK chấm trực tiếp khi con thuyết trình & trả lời vấn đáp]",
          };
        } else {
          criteriaByRowTab1[r.rowNumber] = {
            rowNumber: r.rowNumber,
            rating: "Tốt",
            isAiScored: true,
            columnGNote: "Đối chiếu cấu trúc sản phẩm hợp lệ.",
          };
        }
      });

      const criteriaByRowTab2: Record<
        number,
        { rowNumber: number; rating: "Tốt" | "Hoàn thành" | "Chưa đạt"; isAiScored: boolean; columnGNote: string }
      > = {};
      const allRowNums = new Set(struct.criteriaRows.map((r) => r.rowNumber));
      for (const r of struct.criteriaRows) {
        criteriaByRowTab2[r.rowNumber] = {
          rowNumber: r.rowNumber,
          rating: "Tốt",
          isAiScored: false,
          columnGNote: "[GK chấm trực tiếp]",
        };
      }

      const wbPartial = buildDemoScoringWorkbookBuffer({
        classId: `VT-${course}01`,
        sheetTitle: `Bảng chấm điểm ${course}`,
        demoDate: "2026-11-22",
        evalDate: "2026-11-22",
        studentTabs: [
          { studentId: "S1", fullName: "Học Viên 1", tabName: "Học Viên 1" },
          { studentId: "S2", fullName: "Học Viên 2", tabName: "Học Viên 2" },
        ],
        templateBuffer: tplBuf,
        aiTabAnnotations: {
          "Học Viên 1": { studentId: "S1", criteriaByRow: criteriaByRowTab1, bgkQuestions: ["Hỏi: Demo?"] },
          "Học Viên 2": { studentId: "S2", skippedReason: "NO_PROJECT_EVIDENCE", criteriaByRow: criteriaByRowTab2, bgkQuestions: [] },
        },
      });

      const zipPartial = new AdmZip(wbPartial);
      assertStrictlyBoundedYellowCells({
        templateStylesXml: tplStylesXml,
        templateSheet1Xml: tplSheet1Xml,
        builtZip: zipPartial,
        studentTabIndex: 1,
        judgeRowNumbers: expectedJudgeRowsTab1,
        allCriteriaRows: struct.criteriaRows.map((r) => r.rowNumber),
        yellowArgb: JUDGE_SCORING_YELLOW_FILL_ARGB,
        label: `${course}-Tab1`,
      });
      assertStrictlyBoundedYellowCells({
        templateStylesXml: tplStylesXml,
        templateSheet1Xml: tplSheet1Xml,
        builtZip: zipPartial,
        studentTabIndex: 2,
        judgeRowNumbers: allRowNums,
        allCriteriaRows: struct.criteriaRows.map((r) => r.rowNumber),
        yellowArgb: JUDGE_SCORING_YELLOW_FILL_ARGB,
        label: `${course}-Tab2-Fallback`,
      });

      // Verify extra sheet ("Phân bổ điểm", sheet3.xml if exists) has 0 yellow cells
      const extraEntry = zipPartial.getEntry("xl/worksheets/sheet3.xml");
      if (extraEntry) {
        const extraStyles = parseStylesXmlInfo(
          zipPartial.getEntry("xl/styles.xml")!.getData().toString("utf8")
        );
        const extraCells = extractSheetCellStyleMap(extraEntry.getData().toString("utf8"));
        for (const [ref, sid] of extraCells.entries()) {
          assert.notStrictEqual(
            getFillArgbForStyle(extraStyles, sid),
            JUDGE_SCORING_YELLOW_FILL_ARGB,
            `[${course}] Sheet phụ (sheet3) bị dính màu vàng tại ${ref}`
          );
        }
      }

      // Also check mode enableAiPreScore = false (no aiTabAnnotations passed)
      const wbNoAi = buildDemoScoringWorkbookBuffer({
        classId: `VT-${course}01`,
        sheetTitle: `Bảng chấm điểm ${course}`,
        demoDate: "2026-11-22",
        evalDate: "2026-11-22",
        studentTabs: [{ studentId: "S1", fullName: "Học Viên 1", tabName: "Học Viên 1" }],
        templateBuffer: tplBuf,
      });
      assertStrictlyBoundedYellowCells({
        templateStylesXml: tplStylesXml,
        templateSheet1Xml: tplSheet1Xml,
        builtZip: new AdmZip(wbNoAi),
        studentTabIndex: 1,
        judgeRowNumbers: allRowNums,
        allCriteriaRows: struct.criteriaRows.map((r) => r.rowNumber),
        yellowArgb: JUDGE_SCORING_YELLOW_FILL_ARGB,
        label: `${course}-NoAI`,
      });
    }
    console.log(`  -> PASS [V365-02] (24/24 mẫu khóa học sạch 100%).`);

    // =========================================================================
    // V365-03: Công thức <f>, dropdown, ô thưa khuyết <c>, nhánh synthetic & đọc điểm ngược
    // =========================================================================
    console.log("\n[V365-03] Kiểm tra công thức, dropdown, ô thưa, synthetic fallback & đọc điểm ngược...");
    // 1) Shared formula, dropdown & round-trip on CSI built workbook (sheet1)
    const csiSheet1Xml = csiBuiltZip.getEntry("xl/worksheets/sheet1.xml")!.getData().toString("utf8");
    for (const row of csiStruct.criteriaRows) {
      const eCell = csiSheet1Xml.match(
        new RegExp(`<c\\b[^>]*?\\br="E${row.rowNumber}"[^>]*?>([\\s\\S]*?)<\\/c>`, "i")
      );
      assert.ok(eCell && /<f\b/i.test(eCell[0]), `Mất thẻ công thức <f> tại E${row.rowNumber}`);
    }
    const dvBlock = csiSheet1Xml.match(/<dataValidations\b[\s\S]*?<\/dataValidations>/i)?.[0] || "";
    assert.ok(
      /sqref="D9:D26"[\s\S]*?<formula1>"Chưa đạt,Hoàn thành,Tốt"<\/formula1>/i.test(dvBlock),
      "Mất dropdown dataValidation ở cột D (sqref=D9:D26)"
    );

    const parsedCells = parseWorksheetCells(csiSheet1Xml, csiSst);
    const extracted = extractDemoScoresFromWorksheet(parsedCells, classIdCsi, csiSheet1Xml);
    const expectedS1Total = csiStruct.criteriaRows.reduce((acc, r) => {
      const rating = aiRes.byTabName[tabs[0].tabName].criteriaByRow[r.rowNumber].rating;
      const mult = rating === "Tốt" ? 1 : rating === "Hoàn thành" ? 0.5 : 0;
      return acc + r.maxPoints * mult;
    }, 0);
    assert.ok(
      Math.abs(extracted.demoTotalScore - expectedS1Total) < 0.01,
      `Tổng điểm đọc ngược không khớp: ${extracted.demoTotalScore} != ${expectedS1Total}`
    );
    assert.ok(
      !/Context Injection|ask_bot|UniBot|GK chấm trực tiếp/i.test(extracted.judgeNote),
      `Cột G bị rò vào judgeNote: ${extracted.judgeNote}`
    );

    // 2) Sparse custom template row missing D23 & E23 in CSI.xlsx
    const sparseZip = new AdmZip(csiTplBuf);
    let sparseSheet1 = sparseZip.getEntry("xl/worksheets/sheet1.xml")!.getData().toString("utf8");
    sparseSheet1 = sparseSheet1.replace(
      /<c\b[^>]*?\br="(?:D|E)23"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/gi,
      ""
    );
    sparseZip.updateFile("xl/worksheets/sheet1.xml", Buffer.from(sparseSheet1, "utf8"));
    const sparseBuilt = buildDemoScoringWorkbookBuffer({
      classId: classIdCsi,
      sheetTitle: "Sparse Check",
      demoDate: "2026-11-22",
      evalDate: "2026-11-22",
      studentTabs: [{ studentId: "SP1", fullName: "Học Viên Thưa", tabName: "Học Viên Thưa" }],
      templateBuffer: sparseZip.toBuffer(),
    });
    const sparseBuiltZip = new AdmZip(sparseBuilt);
    const sparseStyles = parseStylesXmlInfo(
      sparseBuiltZip.getEntry("xl/styles.xml")!.getData().toString("utf8")
    );
    const sparseBuiltXml = sparseBuiltZip
      .getEntry("xl/worksheets/sheet1.xml")!
      .getData()
      .toString("utf8");
    const sparseStyleMap = extractSheetCellStyleMap(sparseBuiltXml);
    for (const col of ["B", "C", "D", "E"]) {
      const sid = sparseStyleMap.get(`${col}23`);
      assert.ok(sid !== undefined, `Thiếu ô bù ${col}23 trên dòng thưa`);
      assert.strictEqual(
        getFillArgbForStyle(sparseStyles, sid!),
        JUDGE_SCORING_YELLOW_FILL_ARGB,
        `Ô bù ${col}23 chưa có màu vàng`
      );
    }
    const row23Inner =
      sparseBuiltXml.match(/<row\b[^>]*?\br="23"[^>]*?>([\s\S]*?)<\/row>/i)?.[1] || "";
    const row23Order = Array.from(row23Inner.matchAll(/<c\b[^>]*?\br="([A-Z]+)23"/gi)).map(
      (m) => m[1]
    );
    assert.deepStrictEqual(row23Order.slice(0, 6), ["A", "B", "C", "D", "E", "F"]);

    // 3) True Synthetic fallback (_forceSyntheticFallbackForTest: true, both without & with aiTabAnnotations -> V365-F04)
    for (const withDummyAiAnn of [false, true]) {
      const dummyCriteriaByRow: Record<
        number,
        { rowNumber: number; rating: "Tốt"; isAiScored: boolean; columnGNote: string }
      > = {};
      for (let r = 8; r <= 27; r++) {
        dummyCriteriaByRow[r] = {
          rowNumber: r,
          rating: "Tốt",
          isAiScored: r <= 12,
          columnGNote: "Không nhúng vào synthetic sheet",
        };
      }
      const synthWb = buildDemoScoringWorkbookBuffer({
        classId: "VT-PTA99",
        sheetTitle: "Synthetic PTA Fallback",
        demoDate: "2026-11-22",
        evalDate: "2026-11-22",
        studentTabs: [{ studentId: "SY1", fullName: "Học Viên Fallback", tabName: "Học Viên Fallback" }],
        templateBuffer: null,
        _forceSyntheticFallbackForTest: true,
        aiTabAnnotations: withDummyAiAnn
          ? {
              "Học Viên Fallback": {
                studentId: "SY1",
                criteriaByRow: dummyCriteriaByRow,
                bgkQuestions: [],
              },
            }
          : undefined,
      });
      const synthZip = new AdmZip(synthWb);
      const synthStyles = parseStylesXmlInfo(
        synthZip.getEntry("xl/styles.xml")!.getData().toString("utf8")
      );
      // buildStylesXml starts with 10 <xf> entries; rows 8..27 use style 7 (col B) & 8 (cols C..E) + default 0 => 13 entries
      assert.strictEqual(
        synthStyles.cellXfs.length,
        13,
        `Synthetic fallback (aiAnn=${withDummyAiAnn}) phải dùng buildStylesXml (13 cellXfs), thực tế=${synthStyles.cellXfs.length}`
      );
      const synthSheetXml = synthZip.getEntry("xl/worksheets/sheet1.xml")!.getData().toString("utf8");
      const synthCellStyles = extractSheetCellStyleMap(synthSheetXml);
      for (const [ref, sid] of synthCellStyles.entries()) {
        const m = ref.match(/^([A-Z]+)(\d+)$/);
        if (!m) continue;
        const col = m[1];
        const r = parseInt(m[2], 10);
        const isYellow = getFillArgbForStyle(synthStyles, sid) === JUDGE_SCORING_YELLOW_FILL_ARGB;
        const expectYellow = ["B", "C", "D", "E"].includes(col) && r >= 8 && r <= 27;
        assert.strictEqual(
          isYellow,
          expectYellow,
          `[Synthetic Fallback aiAnn=${withDummyAiAnn}] Ô ${ref} expectedYellow=${expectYellow}, got ${isYellow}`
        );
      }
    }

    // 4) Empty <fills count="0"/> & <cellXfs count="0"/> ECMA-376 padding check (V365-F05)
    const minimalStylesXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts>` +
      `<fills count="0"/>` +
      `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
      `<cellXfs count="0"/>` +
      `</styleSheet>`;
    const minInjected = injectYellowHighlightStylesIntoStylesXml(minimalStylesXml, [0]);
    assert.ok(
      minInjected.yellowFillId >= 2,
      `ECMA-376 fillId=0,1 phải được đệm trước màu vàng, got yellowFillId=${minInjected.yellowFillId}`
    );
    assert.strictEqual(minInjected.styleMap.get(0), 1, "cellXfs[0] mặc định phải sạch (không vàng)");
    const minParsed = parseStylesXmlInfo(minInjected.updatedStylesXml);
    assert.strictEqual(minParsed.fills.length, 3);
    assert.ok(minParsed.fills[0].includes('patternType="none"'));
    assert.ok(minParsed.fills[1].includes('patternType="gray125"'));
    assert.strictEqual(getFillArgbForStyle(minParsed, 0), null);
    assert.strictEqual(getFillArgbForStyle(minParsed, 1), JUDGE_SCORING_YELLOW_FILL_ARGB);

    console.log("  -> PASS [V365-03].");
    console.log("\n✅ HOÀN TẤT TOÀN BỘ 3/3 NHÓM KIỂM THỬ v3.6.5!");
  } finally {
    if (originalConfigDir === undefined) {
      delete process.env.MINDX_CONFIG_DIR;
    } else {
      process.env.MINDX_CONFIG_DIR = originalConfigDir;
    }
    try {
      getDb().close();
    } catch {
      // ignore
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("❌ TEST FAILED:", err);
  process.exitCode = 1;
});
