/**
 * MINDX AUTOMATION BOT - SESSION 14 DEMO SCORE & COMPETENCY READER (v2.9.0)
 * Reads graded "Bảng chấm điểm buổi Demo" (.xlsx local file or Google Sheet URL),
 * matches each worksheet tab / cell B2 ("Họ và tên Học viên:") to the class roster,
 * extracts the 5 Demo Score criteria (max 5.0 points total) + Judge comments (BGK1/BGK2),
 * and suggests the 9 [ĐNL] Competency ratings (scale 1..5, average rounded to 2 decimals).
 */

import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import {
  calculateCompetencyAverageScore,
  calculateDemoTotalScore,
  isRoboticsClassCode,
  parseSession14CompetencyScores,
  parseSession14DemoScores,
  SESSION14_DEMO_LIMITS,
  SESSION14_DEMO_LIMITS_ROBOTICS,
  session14EvalRepo,
  sessionFeedbackRepo,
  spckSessionRepo,
  spckUploadRepo,
  studentRepo,
  type SpckSession14CompetencyScores,
  type SpckSession14DemoScores,
  type SpckSession14EvaluationRecord,
} from "../db/sqlite";
import { extractGoogleSheetId, getDemoSheetTitleForClass } from "../playwright/spck-demo-sheet";
import { assertPathAllowed } from "../security/path-allowlist";

export interface StudentDemoScoreExtract {
  studentId: string;
  fullName: string;
  matchedTabName: string;
  demoScores: SpckSession14DemoScores;
  demoTotalScore: number;
  judgeNote: string;
  competencyScores: SpckSession14CompetencyScores;
  competencyTotalScore: number;
  updatedRecord: SpckSession14EvaluationRecord;
}

export interface ImportDemoScoresResult {
  classId: string;
  sourceUsed: string;
  matchedCount: number;
  unmatchedTabs: string[];
  students: StudentDemoScoreExtract[];
}

function decodeXmlEntities(raw: string): string {
  return String(raw || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function normalizeVietnameseName(raw: string): string {
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface ParsedCell {
  ref: string;
  type: string;
  formula?: string;
  rawValue: string;
  stringValue: string;
  numericValue: number | null;
}

function parseSharedStringsXml(xml: string): string[] {
  const strings: string[] = [];
  if (!xml) return strings;
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
  let match: RegExpExecArray | null;
  while ((match = siRegex.exec(xml)) !== null) {
    const inner = match[1];
    const parts: string[] = [];
    const tRegex = /<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/gi;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRegex.exec(inner)) !== null) {
      parts.push(decodeXmlEntities(tMatch[1]));
    }
    strings.push(parts.join(""));
  }
  return strings;
}

function parseWorksheetCells(xml: string, sharedStrings: string[]): Map<string, ParsedCell> {
  const cells = new Map<string, ParsedCell>();
  const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi;
  let match: RegExpExecArray | null;

  while ((match = cellRegex.exec(xml)) !== null) {
    const attrs = match[1] || "";
    const inner = match[2] || "";
    const rMatch = attrs.match(/\br="([A-Z]+\d+)"/i);
    if (!rMatch) continue;
    const ref = rMatch[1].toUpperCase();
    const tMatch = attrs.match(/\bt="([^"]+)"/i);
    const cellType = tMatch ? tMatch[1] : "n";

    const fMatch = inner.match(/<f(?:\s+[^>]*)?>([\s\S]*?)<\/f>/i);
    const formula = fMatch ? decodeXmlEntities(fMatch[1]).trim() : undefined;

    let rawValue = "";
    let stringValue = "";
    let numericValue: number | null = null;

    if (cellType === "inlineStr") {
      const tParts: string[] = [];
      const tRegex = /<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/gi;
      let tm: RegExpExecArray | null;
      while ((tm = tRegex.exec(inner)) !== null) {
        tParts.push(decodeXmlEntities(tm[1]));
      }
      stringValue = tParts.join("").trim();
      rawValue = stringValue;
      const numCandidate = Number(stringValue.replace(",", "."));
      if (stringValue !== "" && Number.isFinite(numCandidate)) {
        numericValue = numCandidate;
      }
    } else {
      const vMatch = inner.match(/<v(?:\s+[^>]*)?>([\s\S]*?)<\/v>/i);
      rawValue = vMatch ? decodeXmlEntities(vMatch[1]).trim() : "";
      if (cellType === "s") {
        const idx = parseInt(rawValue, 10);
        stringValue =
          Number.isFinite(idx) && idx >= 0 && idx < sharedStrings.length
            ? sharedStrings[idx].trim()
            : rawValue;
        const numCandidate = Number(stringValue.replace(",", "."));
        if (stringValue !== "" && Number.isFinite(numCandidate)) {
          numericValue = numCandidate;
        }
      } else {
        stringValue = rawValue;
        const numCandidate = Number(rawValue.replace(",", "."));
        if (rawValue !== "" && Number.isFinite(numCandidate)) {
          numericValue = numCandidate;
        }
      }
    }

    cells.set(ref, {
      ref,
      type: cellType,
      formula,
      rawValue,
      stringValue,
      numericValue,
    });
  }

  return cells;
}

function sumCellRange(
  cells: Map<string, ParsedCell>,
  col: string,
  startRow: number,
  endRow: number
): { hasAnyNumeric: boolean; isCompleteRange: boolean; sum: number } {
  const totalRows = Math.max(0, endRow - startRow + 1);
  let numericCount = 0;
  let hasInvalidCell = false;
  let sum = 0;
  for (let r = startRow; r <= endRow; r++) {
    const c = cells.get(`${col}${r}`);
    if (c && c.numericValue !== null && Number.isFinite(c.numericValue)) {
      if (c.numericValue < 0 || c.numericValue > 1.5) {
        hasInvalidCell = true;
      }
      numericCount++;
      sum += c.numericValue;
    }
  }
  return {
    hasAnyNumeric: numericCount > 0,
    isCompleteRange: !hasInvalidCell && totalRows > 0 && numericCount === totalRows,
    sum: Math.round(sum * 1000) / 1000,
  };
}

function extractDemoScoresFromWorksheet(
  cells: Map<string, ParsedCell>,
  classId?: string
): {
  studentNameInCellB2: string;
  demoScores: SpckSession14DemoScores;
  demoTotalScore: number;
  judgeNote: string;
  hasCompleteScores: boolean;
  scoredCriteriaCount: number;
} {
  const b2 = cells.get("B2")?.stringValue || "";
  const limits = isRoboticsClassCode(classId)
    ? SESSION14_DEMO_LIMITS_ROBOTICS
    : SESSION14_DEMO_LIMITS;

  // Check if E8:E27 have numeric values
  const eAlgo = sumCellRange(cells, "E", 8, 13);
  const eCreative = sumCellRange(cells, "E", 14, 17);
  const eComm = sumCellRange(cells, "E", 18, 19);
  const eProb = sumCellRange(cells, "E", 20, 22);
  const eComp = sumCellRange(cells, "E", 23, 27);

  // Also check LOs summary rows (rows 32..36: A32..A36 labels, B32..B36 values)
  const b32 = cells.get("B32");
  const b33 = cells.get("B33");
  const b34 = cells.get("B34");
  const b35 = cells.get("B35");
  const b36 = cells.get("B36");

  const isWithinMax = (val: number | null | undefined, maxAllowed: number): val is number =>
    typeof val === "number" && Number.isFinite(val) && val >= 0 && val <= maxAllowed + 1e-6;

  const resolveScore = (
    summaryCell: ParsedCell | undefined,
    rangeSum: { hasAnyNumeric: boolean; isCompleteRange: boolean; sum: number },
    maxAllowed: number
  ): { hasScore: boolean; isValid: boolean; value: number } => {
    // If summaryCell has no formula and a direct numeric value was typed in B32..B36, prefer it;
    // If summaryCell has a formula (e.g. SUM(E8:E13)), prefer the live sum of E cells when present so edits to E8:E27 without Excel recalculation are reflected accurately.
    if (summaryCell && !summaryCell.formula && summaryCell.numericValue !== null) {
      if (!isWithinMax(summaryCell.numericValue, maxAllowed)) {
        return { hasScore: false, isValid: false, value: 0 };
      }
      return { hasScore: true, isValid: true, value: summaryCell.numericValue };
    }
    if (rangeSum.hasAnyNumeric) {
      if (!rangeSum.isCompleteRange || !isWithinMax(rangeSum.sum, maxAllowed)) {
        return { hasScore: false, isValid: false, value: 0 };
      }
      return { hasScore: true, isValid: true, value: rangeSum.sum };
    }
    if (summaryCell && summaryCell.numericValue !== null) {
      if (!isWithinMax(summaryCell.numericValue, maxAllowed)) {
        return { hasScore: false, isValid: false, value: 0 };
      }
      return { hasScore: true, isValid: true, value: summaryCell.numericValue };
    }
    return { hasScore: false, isValid: true, value: 0 };
  };

  const resAlgo = resolveScore(b32, eAlgo, limits.algorithm);
  const resComp = resolveScore(b33, eComp, limits.computerSkills);
  const resCreative = resolveScore(b34, eCreative, limits.creativity);
  const resProb = resolveScore(b35, eProb, limits.problemSolving);
  const resComm = resolveScore(b36, eComm, limits.communication);

  const hasCriterionScore = {
    algorithm: resAlgo.hasScore,
    computerSkills: resComp.hasScore,
    creativity: resCreative.hasScore,
    problemSolving: resProb.hasScore,
    communication: resComm.hasScore,
  };

  const criterionValid = {
    algorithm: resAlgo.isValid,
    computerSkills: resComp.isValid,
    creativity: resCreative.isValid,
    problemSolving: resProb.isValid,
    communication: resComm.isValid,
  };

  const rawDemo: Partial<SpckSession14DemoScores> = {
    algorithm: resAlgo.value,
    computerSkills: resComp.value,
    creativity: resCreative.value,
    problemSolving: resProb.value,
    communication: resComm.value,
  };

  // Also scan rows 31..40 by label in column A in case a custom course template reordered LOs rows
  for (let r = 31; r <= 40; r++) {
    const label = normalizeVietnameseName(cells.get(`A${r}`)?.stringValue || "");
    const bCell = cells.get(`B${r}`);
    if (!label || !bCell || bCell.numericValue === null) continue;
    if (!bCell.formula) {
      if (label.includes("thuat toan") || label.includes("tu duy may tinh")) {
        if (isWithinMax(bCell.numericValue, limits.algorithm)) {
          rawDemo.algorithm = bCell.numericValue;
          hasCriterionScore.algorithm = true;
          criterionValid.algorithm = true;
        } else {
          hasCriterionScore.algorithm = false;
          criterionValid.algorithm = false;
        }
      } else if (label.includes("su dung may tinh")) {
        if (isWithinMax(bCell.numericValue, limits.computerSkills)) {
          rawDemo.computerSkills = bCell.numericValue;
          hasCriterionScore.computerSkills = true;
          criterionValid.computerSkills = true;
        } else {
          hasCriterionScore.computerSkills = false;
          criterionValid.computerSkills = false;
        }
      } else if (label.includes("sang tao")) {
        if (isWithinMax(bCell.numericValue, limits.creativity)) {
          rawDemo.creativity = bCell.numericValue;
          hasCriterionScore.creativity = true;
          criterionValid.creativity = true;
        } else {
          hasCriterionScore.creativity = false;
          criterionValid.creativity = false;
        }
      } else if (label.includes("giai quyet van de")) {
        if (isWithinMax(bCell.numericValue, limits.problemSolving)) {
          rawDemo.problemSolving = bCell.numericValue;
          hasCriterionScore.problemSolving = true;
          criterionValid.problemSolving = true;
        } else {
          hasCriterionScore.problemSolving = false;
          criterionValid.problemSolving = false;
        }
      } else if (label.includes("giao tiep") || label.includes("hop tac")) {
        if (isWithinMax(bCell.numericValue, limits.communication)) {
          rawDemo.communication = bCell.numericValue;
          hasCriterionScore.communication = true;
          criterionValid.communication = true;
        } else {
          hasCriterionScore.communication = false;
          criterionValid.communication = false;
        }
      }
    }
  }

  const scoredCriteriaCount = (
    Object.keys(hasCriterionScore) as Array<keyof typeof hasCriterionScore>
  ).filter((k) => hasCriterionScore[k] && criterionValid[k]).length;
  const hasCompleteScores =
    scoredCriteriaCount === 5 && Object.values(criterionValid).every(Boolean);

  const demoScores = parseSession14DemoScores(rawDemo, classId);
  const demoTotalScore = calculateDemoTotalScore(demoScores);

  const bgkNotes: string[] = [];
  for (const ref of ["B30", "C30", "D30"]) {
    const val = (cells.get(ref)?.stringValue || "").trim();
    if (val && !/^BGK\s*\d*$/i.test(val)) {
      bgkNotes.push(val);
    }
  }

  return {
    studentNameInCellB2: b2.trim(),
    demoScores,
    demoTotalScore,
    judgeNote: bgkNotes.join(" | "),
    hasCompleteScores,
    scoredCriteriaCount,
  };
}

/**
 * Suggests the 9 [ĐNL] Competency ratings (1..5) for a student based on:
 * - Their Demo Scores (5 criteria out of 5.0)
 * - Their historical session feedbacks (Sessions 1..13)
 * - Selected Quick Tags & Teacher Note
 */
export function suggestCompetencyScoresForStudent(params: {
  classId: string;
  studentId: string;
  demoScores: SpckSession14DemoScores;
  quickTags?: string[];
  teacherNote?: string;
}): {
  competencyScores: SpckSession14CompetencyScores;
  competencyTotalScore: number;
} {
  const { classId, studentId, demoScores } = params;
  const allTagsText = normalizeVietnameseName(
    [...(params.quickTags || []), params.teacherNote || ""].join(" | ")
  );

  // Convert a ratio (0..1) into a 1..5 MindX competency rating (typically 3..5 for completed projects)
  const ratioToRating = (earned: number, max: number, defaultRating = 4): number => {
    if (!Number.isFinite(earned) || earned < 0 || max <= 0) return defaultRating;
    if (earned === 0) return 2;
    const ratio = earned / max;
    if (ratio >= 0.95) return 5;
    if (ratio >= 0.7) return 4;
    if (ratio >= 0.45) return 3;
    return 2;
  };

  // Inspect historical session feedbacks (Sessions 1..13) for self-study, homework, and in-class focus
  const historyRows = sessionFeedbackRepo
    .findByClass(classId)
    .filter((f) => f.studentId === studentId);

  let distractedCount = 0;
  let selfStudyPositive = false;
  let homeworkWeak = false;

  for (const row of historyRows) {
    const combined = normalizeVietnameseName(
      `${row.quickTagsJson || ""} ${row.teacherNote || ""} ${row.improvements || ""}`
    );
    if (
      combined.includes("mat tap trung") ||
      combined.includes("lam viec rieng") ||
      combined.includes("xao nhang")
    ) {
      distractedCount++;
    }
    if (
      combined.includes("tu giac") ||
      combined.includes("chu dong tim hieu") ||
      combined.includes("khong phu thuoc vao ai")
    ) {
      selfStudyPositive = true;
    }
    if (combined.includes("chua hoan thanh btvn") || combined.includes("quen lam bai tap")) {
      homeworkWeak = true;
    }
  }

  if (
    allTagsText.includes("tu giac tim hieu") ||
    allTagsText.includes("khong phu thuoc ai") ||
    allTagsText.includes("khong phu thuoc vao ai")
  ) {
    selfStudyPositive = true;
  }
  const reliesOnAi =
    allTagsText.includes("phu thuoc kha nhieu vao ai") ||
    allTagsText.includes("phu thuoc ai") ||
    allTagsText.includes("chua hieu sau phan cot loi");

  const limits = isRoboticsClassCode(classId)
    ? SESSION14_DEMO_LIMITS_ROBOTICS
    : SESSION14_DEMO_LIMITS;
  const knowledgeInClass = ratioToRating(demoScores.algorithm, limits.algorithm, 4);
  const knowledgeSelfStudy = reliesOnAi
    ? 3
    : selfStudyPositive
    ? 5
    : ratioToRating(demoScores.algorithm, limits.algorithm, 4);
  const skillCommunication = ratioToRating(demoScores.communication, limits.communication, 4);
  const skillComputerUse = ratioToRating(demoScores.computerSkills, limits.computerSkills, 4);
  const skillProblemSolving = ratioToRating(demoScores.problemSolving, limits.problemSolving, 4);
  const skillCreativity = ratioToRating(demoScores.creativity, limits.creativity, 4);
  const skillComputational = ratioToRating(demoScores.algorithm, limits.algorithm, 4);
  const attitudeHomework = homeworkWeak ? 3 : selfStudyPositive ? 4 : 4;
  const attitudeInClass = distractedCount >= 3 ? 3 : 4;

  const competencyScores = parseSession14CompetencyScores({
    knowledgeInClass,
    knowledgeSelfStudy,
    skillCommunication,
    skillComputerUse,
    skillProblemSolving,
    skillCreativity,
    skillComputational,
    attitudeHomework,
    attitudeInClass,
  });

  return {
    competencyScores,
    competencyTotalScore: calculateCompetencyAverageScore(competencyScores),
  };
}

/**
 * Automatically locates the class's graded Demo Scoring Sheet (.xlsx) on disk if no path/URL was provided.
 */
export function resolveDefaultDemoSheetPathForClass(classId: string): string | null {
  const normalizedClassId = String(classId || "").trim().toUpperCase();
  const candidates: string[] = [];

  // 1. Check class SPCK parent folder from spck_uploads / spck_session_submissions
  const spckRows = spckUploadRepo.findByClass(normalizedClassId);
  for (const r of spckRows) {
    if (r.localFolderPath && r.localFolderPath.trim()) {
      const parentDir = path.dirname(r.localFolderPath);
      candidates.push(parentDir);
    }
  }

  // 2. Check data/demo_sheets
  const dataDemoDir = path.resolve(process.cwd(), "data", "demo_sheets");
  candidates.push(dataDemoDir);

  const expectedTitle = getDemoSheetTitleForClass(normalizedClassId);

  for (const dir of candidates) {
    try {
      const safeDir = assertPathAllowed(dir);
      if (!fs.existsSync(safeDir) || !fs.statSync(safeDir).isDirectory()) continue;
      const files = fs.readdirSync(safeDir);
      // Prefer exact class match or expected title match
      const xlsxFiles = files.filter(
        (f) => f.toLowerCase().endsWith(".xlsx") && !f.startsWith("~$")
      );
      const exactMatch = xlsxFiles.find(
        (f) =>
          f.toUpperCase().includes(normalizedClassId) ||
          normalizeVietnameseName(f).includes(normalizeVietnameseName(expectedTitle)) ||
          normalizeVietnameseName(f).includes("bang cham diem buoi demo")
      );
      if (exactMatch) {
        return assertPathAllowed(path.join(safeDir, exactMatch));
      }
    } catch {
      // Ignore disallowed or missing directories
    }
  }

  return null;
}

async function loadXlsxBufferFromSource(
  classId: string,
  sourcePathOrUrl?: string
): Promise<{ buffer: Buffer; sourceUsed: string }> {
  const rawSource = String(sourcePathOrUrl || "").trim();

  // Case 1: Google Sheets URL
  const sheetId = extractGoogleSheetId(rawSource);
  if (sheetId) {
    const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;
    const resp = await fetch(exportUrl, { redirect: "follow" });
    if (resp.ok) {
      const arrBuf = await resp.arrayBuffer();
      const buf = Buffer.from(arrBuf);
      if (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b) {
        return { buffer: buf, sourceUsed: exportUrl };
      }
    }
    throw new Error(
      `Không thể tải trực tiếp file .xlsx từ Google Sheet (${rawSource}). Hãy đảm bảo quyền chia sẻ "Bất kỳ ai có đường liên kết đều có thể xem" hoặc tải về file .xlsx trên máy.`
    );
  }

  // Case 2: Explicit local file path
  if (rawSource) {
    const safePath = assertPathAllowed(path.resolve(rawSource));
    if (!fs.existsSync(safePath) || !fs.statSync(safePath).isFile()) {
      throw new Error(`Không tìm thấy tệp bảng điểm Demo tại đường dẫn: ${safePath}`);
    }
    return { buffer: fs.readFileSync(safePath), sourceUsed: safePath };
  }

  // Case 3: Auto-discover in class SPCK folder or data/demo_sheets
  const discovered = resolveDefaultDemoSheetPathForClass(classId);
  if (!discovered) {
    throw new Error(
      `Chưa tìm thấy file "Bảng chấm điểm buổi Demo (.xlsx)" cho lớp ${classId}. Vui lòng dán đường dẫn file .xlsx hoặc link Google Sheet chấm điểm.`
    );
  }
  return { buffer: fs.readFileSync(discovered), sourceUsed: discovered };
}

/**
 * Parses a workbook Buffer (.xlsx) and matches worksheets to class students.
 */
export function parseDemoWorkbookBufferForClass(
  classId: string,
  buffer: Buffer,
  sourceUsed: string
): ImportDemoScoresResult {
  const normalizedClassId = String(classId || "").trim().toUpperCase();
  const students = studentRepo.findByClass(normalizedClassId, false);
  if (students.length === 0) {
    throw new Error(`Lớp ${normalizedClassId} chưa có danh sách học viên trong CSDL.`);
  }

  const zip = new AdmZip(buffer);
  const sharedStringsEntry = zip.getEntry("xl/sharedStrings.xml");
  const sharedStrings = sharedStringsEntry
    ? parseSharedStringsXml(sharedStringsEntry.getData().toString("utf8"))
    : [];

  const workbookEntry = zip.getEntry("xl/workbook.xml");
  if (!workbookEntry) {
    throw new Error("Tệp .xlsx không hợp lệ (thiếu xl/workbook.xml).");
  }
  const workbookXml = workbookEntry.getData().toString("utf8");

  const relsEntry = zip.getEntry("xl/_rels/workbook.xml.rels");
  const relsXml = relsEntry ? relsEntry.getData().toString("utf8") : "";
  const relTargetMap = new Map<string, string>();
  const relRegex = /<Relationship\b[^>]*?\bId="([^"]+)"[^>]*?\bTarget="([^"]+)"/gi;
  let relMatch: RegExpExecArray | null;
  while ((relMatch = relRegex.exec(relsXml)) !== null) {
    relTargetMap.set(relMatch[1], relMatch[2].replace(/^\/+/, ""));
  }

  const sheetEntries: Array<{ tabName: string; entryPath: string }> = [];
  const sheetRegex = /<sheet\b[^>]*?\bname="([^"]+)"[^>]*?\br:id="([^"]+)"/gi;
  let sMatch: RegExpExecArray | null;
  while ((sMatch = sheetRegex.exec(workbookXml)) !== null) {
    const tabName = decodeXmlEntities(sMatch[1]).trim();
    const rId = sMatch[2];
    let target = relTargetMap.get(rId) || "";
    if (target && !target.startsWith("xl/")) {
      target = `xl/${target.replace(/^\.\//, "")}`;
    }
    if (target) {
      sheetEntries.push({ tabName, entryPath: target });
    }
  }

  const unmatchedTabs: string[] = [];
  const extractedStudents: StudentDemoScoreExtract[] = [];

  const isGenericTabOrPlaceholder = (norm: string): boolean => {
    if (!norm) return true;
    return (
      norm === "copy" ||
      /^copy of /.test(norm) ||
      /^sheet\s*\d*$/.test(norm) ||
      /^hv\s*\d*$/.test(norm) ||
      norm === "ten hoc vien" ||
      norm === "ho va ten"
    );
  };

  const findCandidatesByName = (normQuery: string) => {
    if (isGenericTabOrPlaceholder(normQuery)) return [];
    const exactMatches = students.filter(
      (stu) => normalizeVietnameseName(stu.fullName) === normQuery
    );
    if (exactMatches.length > 0) return exactMatches;

    return students.filter((stu) => {
      const normStu = normalizeVietnameseName(stu.fullName);
      if (!normStu) return false;
      const stuWords = normStu.split(" ");
      const queryWords = normQuery.split(" ");
      if (queryWords.length >= 2) {
        return (
          normStu.endsWith(` ${normQuery}`) ||
          normQuery.endsWith(` ${normStu}`) ||
          normStu.includes(normQuery) ||
          normQuery.includes(normStu)
        );
      }
      return stuWords[stuWords.length - 1] === normQuery;
    });
  };

  const stagedByStudentId = new Map<
    string,
    Array<{
      tabName: string;
      student: (typeof students)[number];
      extracted: ReturnType<typeof extractDemoScoresFromWorksheet>;
    }>
  >();

  for (const sheetInfo of sheetEntries) {
    const normTab = normalizeVietnameseName(sheetInfo.tabName);
    if (normTab === "phan bo diem" || normTab === "huong dan" || normTab === "rubric") {
      continue;
    }

    const wsEntry = zip.getEntry(sheetInfo.entryPath);
    if (!wsEntry) continue;
    const wsXml = wsEntry.getData().toString("utf8");
    const cells = parseWorksheetCells(wsXml, sharedStrings);
    const extracted = extractDemoScoresFromWorksheet(cells, normalizedClassId);

    const normCellB2 = normalizeVietnameseName(extracted.studentNameInCellB2);
    const b2Candidates = findCandidatesByName(normCellB2);
    const tabCandidates = findCandidatesByName(normTab);

    // Check for conflict when both B2 and tabName specify non-generic student names
    if (b2Candidates.length > 0 && tabCandidates.length > 0) {
      const commonIds = b2Candidates
        .map((s) => s.studentId)
        .filter((id) => tabCandidates.some((t) => t.studentId === id));
      if (commonIds.length !== 1) {
        unmatchedTabs.push(sheetInfo.tabName);
        continue;
      }
    }

    let matchedStudent: (typeof students)[number] | null = null;
    if (b2Candidates.length === 1) {
      matchedStudent = b2Candidates[0];
    } else if (b2Candidates.length === 0 && tabCandidates.length === 1) {
      matchedStudent = tabCandidates[0];
    }

    // Reject unmatched, ambiguous (> 1 candidates), or unscored/incomplete sheets
    if (!matchedStudent || !extracted.hasCompleteScores) {
      unmatchedTabs.push(sheetInfo.tabName);
      continue;
    }

    const list = stagedByStudentId.get(matchedStudent.studentId) || [];
    list.push({
      tabName: sheetInfo.tabName,
      student: matchedStudent,
      extracted,
    });
    stagedByStudentId.set(matchedStudent.studentId, list);
  }

  for (const [, entries] of stagedByStudentId.entries()) {
    // Reject duplicate tabs targeting the same studentId so neither overwrites the other
    if (entries.length !== 1) {
      for (const dup of entries) {
        unmatchedTabs.push(dup.tabName);
      }
      continue;
    }

    const { tabName, student: matchedStudent, extracted } = entries[0];
    const s14Draft = spckSessionRepo.findOne(normalizedClassId, matchedStudent.studentId, 14);
    const existingEval = session14EvalRepo.getOrInit(normalizedClassId, matchedStudent.studentId);
    let quickTags: string[] = [];
    try {
      quickTags = JSON.parse(existingEval.quickTagsJson || s14Draft?.quickTagsJson || "[]");
    } catch {
      quickTags = [];
    }

    const suggestedComp = suggestCompetencyScoresForStudent({
      classId: normalizedClassId,
      studentId: matchedStudent.studentId,
      demoScores: extracted.demoScores,
      quickTags,
      teacherNote: existingEval.teacherNote || s14Draft?.teacherNote || "",
    });

    const saved = session14EvalRepo.saveDraft({
      classId: normalizedClassId,
      studentId: matchedStudent.studentId,
      demoScores: extracted.demoScores,
      demoSourcePath: sourceUsed,
      demoJudgeNote: extracted.judgeNote,
      competencyScores: suggestedComp.competencyScores,
    });

    extractedStudents.push({
      studentId: matchedStudent.studentId,
      fullName: matchedStudent.fullName,
      matchedTabName: tabName,
      demoScores: extracted.demoScores,
      demoTotalScore: extracted.demoTotalScore,
      judgeNote: extracted.judgeNote,
      competencyScores: suggestedComp.competencyScores,
      competencyTotalScore: suggestedComp.competencyTotalScore,
      updatedRecord: saved.record,
    });
  }

  return {
    classId: normalizedClassId,
    sourceUsed,
    matchedCount: extractedStudents.length,
    unmatchedTabs,
    students: extractedStudents,
  };
}

/**
 * High-level entry point to import Demo Scores from a local .xlsx path, Google Sheet URL, or auto-discovered class sheet.
 */
export async function importClassDemoScores(
  classId: string,
  sourcePathOrUrl?: string
): Promise<ImportDemoScoresResult> {
  const { buffer, sourceUsed } = await loadXlsxBufferFromSource(classId, sourcePathOrUrl);
  return parseDemoWorkbookBufferForClass(classId, buffer, sourceUsed);
}
