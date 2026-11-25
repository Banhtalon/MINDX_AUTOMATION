/**
 * MINDX AUTOMATION BOT - AI DEMO SHEET PRE-GRADER & BGK Q&A GENERATOR (v3.5.1)
 * Uses gemini-3.5-flash-lite with strict PII anonymization (`STUDENT_01`, ...) and
 * read-only path allowlist validation to:
 *   1. Inspect each student's SPCK source code, UI files, Scratch/GameMaker assets, slides & screenshots.
 *   2. Pre-grade ONLY observable product/code criteria in Column D ("Tốt" | "Hoàn thành" | "Chưa đạt"),
 *      strictly keeping live-judge presentation/Q&A criteria (Group 3, BGK interaction) and missing
 *      Slide/Video items at the template default "Tốt" ("Giám khảo tự chấm trực tiếp").
 *   3. Generate concise Column G evidence notes and 2–3 practical, project-specific BGK Q&A questions.
 */

import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { anonymizeSpckText, deAnonymizeSpckText } from "../ai/pii-anonymizer";
import { spckUploadRepo, studentRepo } from "../db/sqlite";
import { parseSubmissionFile } from "../file-parsers";
import {
  parseSharedStringsXml,
  parseWorksheetCells,
} from "../local-files/spck-demo-score-reader";
import { assertPathAllowed } from "../security/path-allowlist";
import { detectSpckCourseProfile } from "../spck/spck-quick-tags";
import {
  normalizeVietnameseName,
  stripVietnameseDiacritics,
} from "../utils/vietnamese-match";
import {
  callGeminiWithRetry,
  getGeminiModel,
  sleepAbortable,
  summarizeSafeGeminiErrorForLog,
  type GeminiRetryOptions,
} from "./client";
import {
  buildMultimodalImageParts,
  buildPreliminaryProjectSummary,
} from "./spck-comment";

export type DemoCriterionGradeValue = "Tốt" | "Hoàn thành" | "Chưa đạt";

export type DemoCriterionScorability =
  | "AI_PRODUCT_SCORABLE"
  | "CONDITIONAL_SLIDE"
  | "CONDITIONAL_VIDEO_OR_LINK"
  | "LIVE_JUDGE_ONLY";

export interface DemoRubricCriterionRow {
  rowNumber: number;
  categoryIndex: number;
  categoryLabel: string;
  content: string;
  maxPoints: number;
  defaultRating: DemoCriterionGradeValue;
  scorability: DemoCriterionScorability;
}

export interface DemoLoFormulaCell {
  ref: string;
  startRow: number;
  endRow: number;
}

export interface DemoTemplateRubricStructure {
  headerRow: number;
  totalScoreCellRef: string;
  summaryCellRef: string;
  nhanXetRow: number;
  categorySpans: Array<[number, number]>;
  criteriaRows: DemoRubricCriterionRow[];
  loFormulaCells: DemoLoFormulaCell[];
}

export interface StudentDemoAiCriterionAnnotation {
  rowNumber: number;
  rating: DemoCriterionGradeValue;
  isAiScored: boolean;
  columnGNote: string;
}

export interface StudentDemoAiPreScoreResult {
  studentId: string;
  skippedReason?: string;
  criteriaByRow: Record<number, StudentDemoAiCriterionAnnotation>;
  bgkQuestions: string[];
}

export interface DemoSheetAiSkipReasons {
  noEvidenceCount: number;
  parseErrorCount: number;
  aiErrorCount: number;
}

export type DemoSheetAiScorerOverride = (input: {
  classId: string;
  anonymousToken: string;
  courseProfile: string;
  promptText: string;
  imagePartsCount: number;
  scorableCriteria: DemoRubricCriterionRow[];
}) => Promise<{
  criteria: Array<{
    rowNumber: number;
    rating: DemoCriterionGradeValue;
    evidenceNote: string;
  }>;
  bgkQuestions: string[];
}>;

const IGNORED_PROJECT_DIRS = new Set([
  "__pycache__",
  "node_modules",
  ".git",
  ".venv",
  "venv",
  "dist",
  "build",
  "_spck_prev_backup",
  "_spck_temp",
  "_synth_assets",
]);

const PROJECT_CODE_AND_DOC_EXTS = new Set([
  ".py",
  ".ui",
  ".qss",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".ipynb",
  ".sql",
  ".sb3",
  ".yyz",
  ".yyp",
  ".gml",
  ".yy",
  ".json",
  ".pptx",
  ".ppt",
  ".pdf",
]);

const PROJECT_IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const PROJECT_VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi"]);

/**
 * Classifies whether a Demo rubric row can be pre-graded by AI from static code/assets,
 * requires slides/links to exist first, or must remain strictly for live Demo judges.
 */
export function classifyDemoCriterion(
  content: string,
  categoryIndex: number
): DemoCriterionScorability {
  if (categoryIndex === 2) {
    // Group 3: Kỹ năng giao tiếp & hợp tác -> 100% live judge assessment
    return "LIVE_JUDGE_ONLY";
  }

  const trimmed = String(content || "").trim();
  if (
    /thuyết\s*trình|trình\s*bày\s*(?:tự\s*tin|dự\s*án|rõ\s*ràng|mạch\s*lạc|trôi\s*chảy|tính\s*ứng\s*dụng)|trả\s*lời\s*(?:được\s*)?(?:các\s*)?(?:câu\s*hỏi|vấn\s*đề)|giám\s*khảo|BGK\s*(?:đặt\s*ra|nhận\s*xét|góp\s*ý)|nhận\s*(?:chia\s*sẻ\s*(?:và\s*)?)?góp\s*ý|tương\s*tác\s*với|lắng\s*nghe|tác\s*phong|ánh\s*mắt|giọng\s*nói|phản\s*biện|giao\s*tiếp\s*với|khán\s*giả\s*yêu\s*thích|phụ\s*huynh\s*bình\s*chọn|bình\s*chọn\s*của\s*khán\s*giả/i.test(
      trimmed
    )
  ) {
    return "LIVE_JUDGE_ONLY";
  }

  if (/bài\s*trình\s*chiếu|\bslide\b|powerpoint|\bcanva\b/i.test(trimmed)) {
    return "CONDITIONAL_SLIDE";
  }

  if (
    /video\s*demo|đường\s*dẫn\s*trải\s*nghiệm|deploy|github|xuất\s*bản/i.test(trimmed)
  ) {
    return "CONDITIONAL_VIDEO_OR_LINK";
  }

  return "AI_PRODUCT_SCORABLE";
}

/**
 * Parses category merges, header/summary cells, criteria rows, and bottom "Nhận xét" row
 * from any MindX Demo `.xlsx` template buffer.
 */
export function extractDemoTemplateRubricStructure(
  templateBuffer: Buffer
): DemoTemplateRubricStructure {
  const zip = new AdmZip(templateBuffer);
  const sheetEntry =
    zip.getEntry("xl/worksheets/sheet1.xml") ||
    zip.getEntries().find((e) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(e.entryName));
  if (!sheetEntry) {
    throw new Error("Tệp mẫu bảng chấm điểm Demo không chứa worksheet hợp lệ.");
  }

  const sheetXml = sheetEntry.getData().toString("utf8");
  const ssEntry = zip.getEntry("xl/sharedStrings.xml");
  const sharedStrings = ssEntry ? parseSharedStringsXml(ssEntry.getData().toString("utf8")) : [];
  const cells = parseWorksheetCells(sheetXml, sharedStrings);

  // Extract the 5 category spans from `<mergeCell ref="A...:A..."/>` starting at row >= 8
  const categorySpans: Array<[number, number]> = [];
  const mergeRegex = /<mergeCell\b[^>]*?\bref="A(\d+):A(\d+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = mergeRegex.exec(sheetXml)) !== null) {
    const startRow = parseInt(m[1], 10);
    const endRow = parseInt(m[2], 10);
    if (Number.isFinite(startRow) && Number.isFinite(endRow) && startRow >= 8 && endRow >= startRow) {
      categorySpans.push([startRow, endRow]);
    }
  }
  categorySpans.sort((a, b) => a[0] - b[0]);

  let headerRow = 6;
  for (const r of [6, 7]) {
    const aText = String(cells.get(`A${r}`)?.stringValue || "");
    if (/tiêu\s*chí/i.test(aText)) {
      headerRow = r;
      break;
    }
  }

  let totalScoreCellRef = "F8";
  for (const ref of ["F8", "F9"]) {
    const f = cells.get(ref)?.formula || "";
    if (/SUM\(/i.test(f)) {
      totalScoreCellRef = ref;
      break;
    }
  }

  let summaryCellRef = "B5";
  for (const ref of ["B5", "B6"]) {
    const f = cells.get(ref)?.formula || "";
    if (/\/\s*5/.test(f) || /ROUND\(/i.test(f)) {
      summaryCellRef = ref;
      break;
    }
  }

  const criteriaRows: DemoRubricCriterionRow[] = [];
  const spansToScan =
    categorySpans.length >= 5
      ? categorySpans.slice(0, 5)
      : ([
          [8, 13],
          [14, 17],
          [18, 19],
          [20, 22],
          [23, 27],
        ] as Array<[number, number]>);

  spansToScan.forEach(([startRow, endRow], catIdx) => {
    const catLabel = String(cells.get(`A${startRow}`)?.stringValue || `Nhóm ${catIdx + 1}`)
      .replace(/\s+/g, " ")
      .trim();
    for (let r = startRow; r <= endRow; r++) {
      const content = String(cells.get(`B${r}`)?.stringValue || "").trim();
      const maxPts = cells.get(`C${r}`)?.numericValue;
      if (!content || maxPts === null || maxPts === undefined || !Number.isFinite(maxPts) || maxPts <= 0) {
        continue;
      }
      if (/^(?:Nhận\s*xét|BGK\s*\d*|Tổng\s*Điểm)$/i.test(content)) continue;

      const dRaw = String(cells.get(`D${r}`)?.stringValue || "").trim();
      const defaultRating: DemoCriterionGradeValue =
        dRaw === "Hoàn thành" || dRaw === "Chưa đạt" ? dRaw : "Tốt";

      criteriaRows.push({
        rowNumber: r,
        categoryIndex: catIdx,
        categoryLabel: catLabel,
        content,
        maxPoints: maxPts,
        defaultRating,
        scorability: classifyDemoCriterion(content, catIdx),
      });
    }
  });

  const maxCritRow =
    criteriaRows.length > 0
      ? criteriaRows.reduce((mx, row) => Math.max(mx, row.rowNumber), 0)
      : 27;
  let nhanXetRow = maxCritRow + 1;
  for (let r = maxCritRow + 1; r <= maxCritRow + 5; r++) {
    const aText = String(cells.get(`A${r}`)?.stringValue || "").trim();
    const bText = String(cells.get(`B${r}`)?.stringValue || "").trim();
    if (/nhận\s*xét/i.test(aText) || /nhận\s*xét/i.test(bText)) {
      nhanXetRow = r;
      break;
    }
  }

  const loFormulaCells: DemoLoFormulaCell[] = [];
  for (let r = Math.max(27, maxCritRow + 1); r <= 42; r++) {
    for (const colLetter of ["B", "A"]) {
      const ref = `${colLetter}${r}`;
      const f = cells.get(ref)?.formula || "";
      const sumMatch = f.match(/SUM\(\s*E(\d+)\s*:\s*E(\d+)\s*\)/i);
      if (sumMatch) {
        loFormulaCells.push({
          ref,
          startRow: parseInt(sumMatch[1], 10),
          endRow: parseInt(sumMatch[2], 10),
        });
      }
    }
  }

  return {
    headerRow,
    totalScoreCellRef,
    summaryCellRef,
    nhanXetRow,
    categorySpans: spansToScan,
    criteriaRows,
    loFormulaCells,
  };
}

function walkStudentFilesSafe(
  rootDir: string,
  maxDepth = 3
): {
  codeAndDocFiles: string[];
  imageFiles: string[];
  videoFiles: string[];
} {
  const safeRoot = assertPathAllowed(path.resolve(rootDir));
  const codeAndDocFiles: string[] = [];
  const imageFiles: string[] = [];
  const videoFiles: string[] = [];

  const visit = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_PROJECT_DIRS.has(entry.name.toLowerCase())) continue;
        visit(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (PROJECT_CODE_AND_DOC_EXTS.has(ext)) {
          codeAndDocFiles.push(fullPath);
        } else if (
          PROJECT_IMAGE_EXTS.has(ext) &&
          !/default-spck-thumbnail\.png$/i.test(entry.name)
        ) {
          imageFiles.push(fullPath);
        } else if (PROJECT_VIDEO_EXTS.has(ext)) {
          videoFiles.push(fullPath);
        }
      }
    }
  };

  visit(safeRoot, 0);
  return { codeAndDocFiles, imageFiles, videoFiles };
}

function resolveStudentLocalFolder(params: {
  studentId: string;
  fullName: string;
  dbFolderPath?: string | null;
  localClassFolderPath?: string;
}): string | null {
  const dbFolder = String(params.dbFolderPath || "").trim();
  if (dbFolder) {
    try {
      const safe = assertPathAllowed(path.resolve(dbFolder));
      if (fs.existsSync(safe) && fs.statSync(safe).isDirectory()) {
        return safe;
      }
    } catch {
      // Fall through to class folder match
    }
  }

  const classRootRaw = String(params.localClassFolderPath || "").trim();
  if (!classRootRaw) return null;
  try {
    const safeRoot = assertPathAllowed(path.resolve(classRootRaw));
    if (!fs.existsSync(safeRoot) || !fs.statSync(safeRoot).isDirectory()) {
      return null;
    }
    const targetNorm = normalizeVietnameseName(params.fullName);
    if (!targetNorm) return null;
    const targetTokens = targetNorm.split(/\s+/).filter(Boolean);

    const subdirs = fs
      .readdirSync(safeRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith(".") && !d.name.startsWith("_"));

    let bestPath: string | null = null;
    let bestScore = 0;

    for (const sub of subdirs) {
      const dirNorm = normalizeVietnameseName(sub.name);
      if (!dirNorm) continue;
      if (dirNorm === targetNorm) {
        return assertPathAllowed(path.join(safeRoot, sub.name));
      }
      const matchedTokens = targetTokens.filter((t) => dirNorm.includes(t));
      const score = matchedTokens.length / Math.max(targetTokens.length, 1);
      if (score > bestScore && score >= 0.6) {
        bestScore = score;
        bestPath = assertPathAllowed(path.join(safeRoot, sub.name));
      }
    }
    return bestPath;
  } catch {
    return null;
  }
}

function scrubContiguousNameSlugs(
  rawText: string,
  fullName: string,
  anonymousToken: string,
  peerNames: string[] = []
): string {
  if (!rawText) return "";
  let output = String(rawText).normalize("NFC");

  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cleanTarget = String(fullName || "")
    .normalize("NFC")
    .trim()
    .toLowerCase();

  const entries: Array<{ name: string; token: string }> = [];
  if (cleanTarget) {
    entries.push({ name: fullName, token: anonymousToken });
  }
  const seenPeers = new Set<string>();
  for (const peer of peerNames) {
    const cleanPeer = String(peer || "")
      .normalize("NFC")
      .trim();
    if (!cleanPeer || cleanPeer.toLowerCase() === cleanTarget) continue;
    if (seenPeers.has(cleanPeer.toLowerCase())) continue;
    seenPeers.add(cleanPeer.toLowerCase());
    entries.push({ name: cleanPeer, token: "STUDENT_PEER" });
  }

  const replacements: Array<{ pattern: string; token: string; allowSubstring: boolean }> = [];
  const seenPatterns = new Set<string>();

  const addPhraseVariants = (words: string[], token: string, allowConcatSubstr: boolean) => {
    if (words.length < 2) return;
    for (const sep of ["-", "_", ".", "+", " ", ""]) {
      const joined = words.join(sep).trim();
      if (joined.length < 4) continue;
      const key = `${token}::${joined.toLowerCase()}`;
      if (seenPatterns.has(key)) continue;
      seenPatterns.add(key);
      const allowSubstring =
        sep === "" ? joined.length >= (allowConcatSubstr ? 5 : 6) : joined.length >= 6;
      replacements.push({ pattern: joined, token, allowSubstring });
    }
  };

  for (const entry of entries) {
    const nfcWords = entry.name
      .normalize("NFC")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const asciiWords = stripVietnameseDiacritics(entry.name)
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    for (const words of [nfcWords, asciiWords]) {
      if (words.length >= 2) {
        addPhraseVariants(words, entry.token, true);
        addPhraseVariants(words.slice(-2), entry.token, false);
        addPhraseVariants(words.slice(0, 2), entry.token, false);
        if (words.length >= 3) {
          addPhraseVariants([words[0], words[words.length - 1]], entry.token, false);
        }
      }
    }
  }

  replacements.sort((a, b) => b.pattern.length - a.pattern.length);
  for (const item of replacements) {
    const re = item.allowSubstring
      ? new RegExp(escapeRe(item.pattern), "giu")
      : new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(item.pattern)}(?![\\p{L}\\p{N}])`, "giu");
    output = output.replace(re, item.token);
  }

  output = output
    .replace(new RegExp(`(${escapeRe(anonymousToken)})(?:[-_+\\s]+${escapeRe(anonymousToken)})+`, "g"), anonymousToken)
    .replace(/(STUDENT_PEER)(?:[-_+\s]+STUDENT_PEER)+/g, "STUDENT_PEER");

  return output;
}

/**
 * Redacts student/peer names (including percent-encoded, hyphenated, underscore, and concatenated slugs)
 * and credential components from related link URLs before building any AI prompt.
 */
export function sanitizeRelatedLinkUrlForPrompt(
  rawUrl: string,
  fullName: string,
  anonymousToken: string,
  peerNames: string[] = []
): string {
  let candidate = String(rawUrl || "").trim();
  if (!candidate) return "";

  try {
    const parsed = new URL(candidate);
    if (parsed.username || parsed.password) {
      parsed.username = "";
      parsed.password = "";
      candidate = parsed.toString();
    }
  } catch {
    // Strip embedded credentials even from malformed URLs (e.g. missing TLD or invalid port)
    candidate = candidate.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, "$1");
  }

  for (let pass = 0; pass < 2; pass++) {
    candidate = candidate.replace(/(?:%[0-9A-Fa-f]{2})+/g, (seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg;
      }
    });
  }

  const slugScrubbed = scrubContiguousNameSlugs(
    candidate,
    fullName,
    anonymousToken,
    peerNames
  );
  return anonymizeSpckText(slugScrubbed, fullName, anonymousToken, peerNames);
}

function redactPathStudentName(
  filePath: string,
  fullName: string,
  anonymousToken: string,
  peerNames: string[] = []
): string {
  const slugScrubbed = scrubContiguousNameSlugs(filePath, fullName, anonymousToken, peerNames);
  const normalized = anonymizeSpckText(slugScrubbed, fullName, anonymousToken, peerNames);
  return normalized.length > 160 ? `...${normalized.slice(-150)}` : normalized;
}

function normalizeGeminiRating(raw: unknown): DemoCriterionGradeValue {
  const norm = normalizeVietnameseName(String(raw || ""));
  if (norm === "chua dat") return "Chưa đạt";
  if (norm === "hoan thanh") return "Hoàn thành";
  return "Tốt";
}

export function stripLeadingAiSuggestionLabel(rawNote: string): string {
  // Strip system badge prefixes (`[AI gợi ý: Tốt]`, `(Gợi ý của AI: ...)`, `Theo AI: ...`, `AI gợi ý: ...`)
  // while preserving valid student project descriptions (e.g., "AI gợi ý món ăn...", "AI gợi ý tốt cho người dùng...").
  return String(rawNote || "")
    .replace(
      /^(?:\s*(?:[\[(]\s*(?:Theo\s*AI(?![\p{L}\p{N}_])|(?:AI|Hệ\s*thống)\s*(?:gợi\s*ý|đánh\s*giá|chấm(?:\s*nháp)?|nhận\s*xét)(?![\p{L}\p{N}_])|Gợi\s*ý(?:\s*nhanh)?\s*(?:của|từ)\s*AI(?![\p{L}\p{N}_]))[^\])]*[\])]\s*(?:[:\-–—]\s*|\s+|$)|(?:Theo\s*AI(?![\p{L}\p{N}_])|(?:AI|Hệ\s*thống)\s*(?:gợi\s*ý|đánh\s*giá|chấm(?:\s*nháp)?|nhận\s*xét)(?![\p{L}\p{N}_])|Gợi\s*ý(?:\s*nhanh)?\s*(?:của|từ)\s*AI(?![\p{L}\p{N}_]))(?:\s*[:\-–—]\s*(?:(?:Tốt|Hoàn\s*thành|Chưa\s*đạt)(?![\p{L}\p{N}_])\s*(?:[:\-–—]\s*|\s+|$))?|\s+(?:Tốt|Hoàn\s*thành|Chưa\s*đạt)(?![\p{L}\p{N}_])\s*(?:[:\-–—]\s*|$))))+/iu,
      ""
    )
    .trim();
}

function parseJsonObjectFromModelText(rawText: string): any {
  const cleaned = String(rawText || "").trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : cleaned;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("Phản hồi AI không chứa JSON hợp lệ.");
  }
  const parsed = JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Phản hồi JSON của AI không đúng cấu trúc object.");
  }
  return parsed;
}

function buildDefaultAnnotationsResult(
  studentId: string,
  structure: DemoTemplateRubricStructure,
  skippedReason: string,
  hintText: string
): StudentDemoAiPreScoreResult {
  const criteriaByRow: Record<number, StudentDemoAiCriterionAnnotation> = {};
  for (const row of structure.criteriaRows) {
    criteriaByRow[row.rowNumber] = {
      rowNumber: row.rowNumber,
      rating: row.defaultRating,
      isAiScored: false,
      columnGNote:
        row.scorability === "LIVE_JUDGE_ONLY"
          ? "[GK chấm trực tiếp khi con thuyết trình & trả lời vấn đáp]"
          : `[Mặc định '${row.defaultRating}'] ${hintText}`,
    };
  }
  return {
    studentId,
    skippedReason,
    criteriaByRow,
    bgkQuestions: [],
  };
}

/**
 * Generates AI pre-scores (Column D for observable product criteria ONLY) and practical
 * BGK Q&A suggestions (Column G) for every student tab in a class Demo scoring sheet.
 * Strict guardrails:
 *   - All text/code sent to Gemini is PII-anonymized (`STUDENT_01`, ...).
 *   - `LIVE_JUDGE_ONLY` (Group 3, BGK answers) and missing Slide/Video criteria ALWAYS keep template default `"Tốt"`.
 *   - `PARSE_ERROR` or empty folders NEVER get downgraded to `"Chưa đạt"`; all rows stay `"Tốt"`.
 */
export async function generateDemoSheetAiPreScoresForClass(params: {
  classId: string;
  studentTabs: Array<{ studentId: string; fullName: string; tabName: string }>;
  templateBuffer: Buffer;
  localClassFolderPath?: string;
  _testAiScorerOverride?: DemoSheetAiScorerOverride;
  _testRetryOptions?: GeminiRetryOptions & { interStudentDelayMs?: number };
}): Promise<{
  byTabName: Record<string, StudentDemoAiPreScoreResult>;
  preScoredCount: number;
  skippedCount: number;
  skipReasons: DemoSheetAiSkipReasons;
}> {
  const normalizedClassId = String(params.classId || "").trim().toUpperCase();
  const structure = extractDemoTemplateRubricStructure(params.templateBuffer);
  const courseProfile = detectSpckCourseProfile(normalizedClassId);
  const dbRows = spckUploadRepo.findByClass(normalizedClassId);
  const dbByStudentId = new Map(dbRows.map((r) => [r.studentId, r]));
  const allClassDbStudents = studentRepo.findByClass(normalizedClassId, false);
  const peerNameSet = new Set<string>();
  for (const s of params.studentTabs) {
    if (s.fullName && s.fullName.trim()) peerNameSet.add(s.fullName.trim());
  }
  for (const s of allClassDbStudents) {
    if (s.fullName && s.fullName.trim()) peerNameSet.add(s.fullName.trim());
  }
  const peerNames = Array.from(peerNameSet);

  const checkAborted = () =>
    (process as any)?.__mindxQueueStopped === true ||
    Boolean(params._testRetryOptions?.shouldAbort?.());

  const byTabName: Record<string, StudentDemoAiPreScoreResult> = {};
  let preScoredCount = 0;
  let skippedCount = 0;
  const skipReasons: DemoSheetAiSkipReasons = {
    noEvidenceCount: 0,
    parseErrorCount: 0,
    aiErrorCount: 0,
  };
  let liveGeminiCallCount = 0;

  for (let idx = 0; idx < params.studentTabs.length; idx++) {
    if (checkAborted()) {
      throw new Error(
        "Đã dừng tác vụ tạo Google Trang tính chấm điểm Demo theo lệnh Dừng khẩn cấp (Stop Bot)."
      );
    }
    const stu = params.studentTabs[idx];
    const anonymousToken = `STUDENT_${String(idx + 1).padStart(2, "0")}`;
    const dbRec = dbByStudentId.get(stu.studentId);

    let relatedLinks: Array<{ name: string; url: string }> = [];
    let dbAttachments: string[] = [];
    let dbScreenshots: string[] = [];
    let dbYoutubeUrls: string[] = [];

    if (dbRec) {
      try {
        relatedLinks = JSON.parse(dbRec.relatedLinksJson || "[]");
      } catch {
        relatedLinks = [];
      }
      try {
        dbAttachments = JSON.parse(dbRec.attachmentsJson || "[]");
      } catch {
        dbAttachments = [];
      }
      try {
        dbScreenshots = JSON.parse(dbRec.screenshotsJson || "[]");
      } catch {
        dbScreenshots = [];
      }
      try {
        dbYoutubeUrls = JSON.parse(dbRec.youtubeUrlsJson || "[]");
      } catch {
        dbYoutubeUrls = [];
      }
    }

    const folderPath = resolveStudentLocalFolder({
      studentId: stu.studentId,
      fullName: stu.fullName,
      dbFolderPath: dbRec?.localFolderPath,
      localClassFolderPath: params.localClassFolderPath,
    });

    const folderScan = folderPath
      ? walkStudentFilesSafe(folderPath, 3)
      : { codeAndDocFiles: [], imageFiles: [], videoFiles: [] };

    const allCandidateFiles = Array.from(
      new Set([...folderScan.codeAndDocFiles, ...dbAttachments])
    );
    const hasLinksOrMedia =
      relatedLinks.length > 0 ||
      dbYoutubeUrls.length > 0 ||
      folderScan.videoFiles.length > 0 ||
      folderScan.imageFiles.length > 0 ||
      dbScreenshots.length > 0;

    if (allCandidateFiles.length === 0 && !hasLinksOrMedia) {
      skippedCount += 1;
      skipReasons.noEvidenceCount += 1;
      byTabName[stu.tabName] = buildDefaultAnnotationsResult(
        stu.studentId,
        structure,
        "NO_PROJECT_EVIDENCE",
        "Chưa có thư mục/tệp bài nộp SPCK — GK tự chấm trực tiếp."
      );
      continue;
    }

    // Parse code/project files safely via Path Allowlist
    const parsedOkSnippets: string[] = [];
    let parseSuccessCount = 0;
    let parseErrorCount = 0;
    let hasSlideFileOrLink = relatedLinks.some((l) =>
      /canva\.com|docs\.google\.com\/presentation|slides|powerpoint|\.ppt/i.test(
        `${l.name} ${l.url}`
      )
    );
    let hasVideoOrExperienceLink =
      dbYoutubeUrls.length > 0 ||
      folderScan.videoFiles.length > 0 ||
      relatedLinks.some((l) =>
        /youtu\.?be|github\.io|drive\.google\.com|itch\.io|vercel\.app|netlify\.app|http/i.test(
          l.url
        )
      );

    for (const filePath of allCandidateFiles.slice(0, 14)) {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === ".pptx" || ext === ".ppt" || ext === ".pdf") {
        hasSlideFileOrLink = true;
      }
      if (ext === ".json" && path.basename(filePath).toLowerCase() === "package.json") {
        // lightweight metadata allowed
      }
      if (ext === ".yyp") {
        try {
          const safeYyp = assertPathAllowed(path.resolve(filePath));
          const rawYyp = fs.readFileSync(safeYyp, "utf8").slice(0, 3000);
          if (rawYyp.trim().length > 0) {
            parseSuccessCount += 1;
            const anonName = redactPathStudentName(filePath, stu.fullName, anonymousToken, peerNames);
            parsedOkSnippets.push(
              `[GameMaker Project ${anonName}]\n${anonymizeSpckText(
                rawYyp,
                stu.fullName,
                anonymousToken,
                peerNames
              )}`
            );
          }
        } catch {
          parseErrorCount += 1;
        }
        continue;
      }

      try {
        const parsed = parseSubmissionFile(filePath);
        if (parsed.parseStatus === "PARSE_ERROR") {
          parseErrorCount += 1;
        } else {
          parseSuccessCount += 1;
          const textBody = (parsed.extractedText || "").trim().slice(0, 1400);
          if (textBody) {
            const anonName = redactPathStudentName(filePath, stu.fullName, anonymousToken, peerNames);
            parsedOkSnippets.push(
              `[Tệp ${anonName} (${parsed.subjectType})]\n${anonymizeSpckText(
                textBody,
                stu.fullName,
                anonymousToken,
                peerNames
              )}`
            );
          }
        }
      } catch {
        parseErrorCount += 1;
      }
    }

    // Rule 5 PARSE_ERROR Guard: if project files failed to parse and no valid parsed summary or screenshots exist, keep all default "Tốt"
    const candidateScreenshots = Array.from(
      new Set([...folderScan.imageFiles, ...dbScreenshots])
    ).filter((p) => !/default-spck-thumbnail\.png$/i.test(p));

    if (parseSuccessCount === 0 && parseErrorCount > 0 && candidateScreenshots.length === 0) {
      skippedCount += 1;
      skipReasons.parseErrorCount += 1;
      byTabName[stu.tabName] = buildDefaultAnnotationsResult(
        stu.studentId,
        structure,
        "PARSE_ERROR",
        "PARSE_ERROR: Tệp dự án không đọc được tự động — giữ mặc định 'Tốt' để GK kiểm tra trực tiếp."
      );
      continue;
    }

    const prelim = buildPreliminaryProjectSummary(
      allCandidateFiles,
      stu.fullName,
      anonymousToken,
      peerNames,
      folderPath || undefined,
      {
        youtubeCount: dbYoutubeUrls.length + folderScan.videoFiles.length,
        screenshotCount: candidateScreenshots.length,
      }
    );

    const scorableCriteria: DemoRubricCriterionRow[] = [];
    for (const row of structure.criteriaRows) {
      if (row.scorability === "AI_PRODUCT_SCORABLE") {
        scorableCriteria.push(row);
      } else if (row.scorability === "CONDITIONAL_SLIDE" && hasSlideFileOrLink) {
        scorableCriteria.push(row);
      } else if (
        row.scorability === "CONDITIONAL_VIDEO_OR_LINK" &&
        hasVideoOrExperienceLink
      ) {
        scorableCriteria.push(row);
      }
    }

    const linksSummary = relatedLinks
      .map(
        (l) =>
          `- ${anonymizeSpckText(
            l.name,
            stu.fullName,
            anonymousToken,
            peerNames
          )}: ${sanitizeRelatedLinkUrlForPrompt(
            l.url,
            stu.fullName,
            anonymousToken,
            peerNames
          )}`
      )
      .join("\n");

    const promptSections = [
      `MÃ HỌC VIÊN ẨN DANH: ${anonymousToken}`,
      `MÃ LỚP / CHỦ ĐỀ KHÓA HỌC: ${normalizedClassId} (${courseProfile})`,
      dbRec?.projectTitle
        ? `TÊN DỰ ÁN: ${anonymizeSpckText(
            dbRec.projectTitle,
            stu.fullName,
            anonymousToken,
            peerNames
          )}`
        : "",
      `TRẠNG THÁI TƯ LIỆU: Slide=${hasSlideFileOrLink ? "CÓ" : "CHƯA CÓ"}; Video/Link trải nghiệm=${
        hasVideoOrExperienceLink ? "CÓ" : "CHƯA CÓ"
      }; Ảnh giao diện=${candidateScreenshots.length}`,
      linksSummary ? `CÁC ĐƯỜNG DẪN LIÊN QUAN:\n${linksSummary}` : "",
      `TÓM TẮT CẤU TRÚC DỰ ÁN:\n${prelim.summaryText}`,
      parsedOkSnippets.length > 0
        ? `TRÍCH ĐOẠN MÃ NGUỒN / TÀI NGUYÊN (ĐÃ ẨN DANH):\n${parsedOkSnippets
            .slice(0, 6)
            .join("\n---\n")
            .slice(0, 5200)}`
        : "",
      `DANH SÁCH TIÊU CHÍ SẢN PHẨM CẦN AI ĐÁNH GIÁ NHÁP (${scorableCriteria.length} tiêu chí):`,
      ...scorableCriteria.map(
        (c) => `- Row ${c.rowNumber} [${c.categoryLabel}, Tối đa ${c.maxPoints}đ]: ${c.content}`
      ),
    ]
      .filter(Boolean)
      .join("\n\n");

    const systemInstruction = `Bạn là Trợ lý Ban Giám Khảo (BGK) buổi Demo Sản Phẩm Cuối Khóa tại MindX Technology School.
Nhiệm vụ của bạn gồm 2 việc:
1. Chấm nháp các tiêu chí SẢN PHẨM/MÃ NGUỒN trong danh sách được giao (dựa strictly vào bằng chứng code, asset, giao diện, đường dẫn có thật của học viên ${anonymousToken}):
   - Chỉ chọn đúng 1 trong 3 giá trị: "Tốt", "Hoàn thành", hoặc "Chưa đạt".
   - Nguyên tắc công bằng & thận trọng: chỉ đánh "Chưa đạt" khi có bằng chứng rõ ràng tính năng/file hoàn toàn không tồn tại hoặc hỏng nặng; nếu đã có triển khai nhưng còn đơn giản/thiếu sâu sắc hoặc cần kiểm tra thêm khi chạy thật thì chọn "Hoàn thành"; đạt rõ yêu cầu thì chọn "Tốt".
   - Mỗi tiêu chí viết evidenceNote thật ngắn gọn (1 câu <= 18 từ) chỉ rõ tên hàm/file/nhân vật/màn hình quan sát được (KHÔNG thêm nhãn "[AI gợi ý: ...]" hay "AI gợi ý:" ở đầu câu).
2. Gợi ý 2 đến 3 CÂU HỎI VẤN ĐÁP THỰC TẾ, HAY & ĐÚNG TRỌNG TÂM DỰ ÁN cho Giám khảo hỏi trực tiếp học viên khi con demo:
   - Câu hỏi phải gắn cụ thể với đúng sản phẩm học viên làm (hỏi về cơ chế/luồng chạy, xử lý lỗi thực tế khi gặp tình huống bất ngờ, hoặc hướng nâng cấp tính năng cụ thể — KHÔNG hỏi lý thuyết suông).
   - Mỗi mục ghi theo mẫu: "Hỏi: [Câu hỏi cụ thể gắn tên màn hình/hàm/luật chơi] -> Gợi ý đáp án mong đợi: [1 câu ngắn]" (KHÔNG thêm nhãn "[AI gợi ý]" hay "Gợi ý của AI:" ở đầu câu).
   - TUYỆT ĐỐI không nhắc tên thật học viên (chỉ gọi "con" hoặc "học viên").

TRẢ VỀ DUY NHẤT JSON HỢP LỆ THEO ĐỊNH DẠNG:
{
  "criteria": [
    { "rowNumber": 8, "rating": "Tốt", "evidenceNote": "..." }
  ],
  "bgkQuestions": [
    "Hỏi: ... -> Gợi ý đáp án mong đợi: ...",
    "Hỏi: ... -> Gợi ý đáp án mong đợi: ..."
  ]
}`;

    const imageParts = buildMultimodalImageParts(
      dbRec?.thumbnailPath || undefined,
      candidateScreenshots
    );

    try {
      const interStudentDelayMs =
        params._testRetryOptions?.interStudentDelayMs ??
        (params._testAiScorerOverride ? 0 : 450);
      if (liveGeminiCallCount > 0 && interStudentDelayMs > 0) {
        await sleepAbortable(interStudentDelayMs, params._testRetryOptions?.shouldAbort);
      }
      liveGeminiCallCount += 1;

      const retryConfig: GeminiRetryOptions = {
        maxRetries: 3,
        baseDelayMs: 1600,
        maxDelayMs: 8000,
        ...params._testRetryOptions,
        label: `demo-scorer:${normalizedClassId}/${anonymousToken}`,
      };

      let parsedOutput: {
        criteria: Array<{ rowNumber: number; rating: unknown; evidenceNote?: string }>;
        bgkQuestions: string[];
      };

      if (params._testAiScorerOverride) {
        parsedOutput = await callGeminiWithRetry(
          () =>
            params._testAiScorerOverride!({
              classId: normalizedClassId,
              anonymousToken,
              courseProfile: String(courseProfile),
              promptText: promptSections,
              imagePartsCount: imageParts.length,
              scorableCriteria,
            }),
          retryConfig
        );
      } else {
        const model = getGeminiModel(undefined, 0.2, systemInstruction);
        const rawGen = ((model as any).__rawGenerateContent ||
          model.generateContent.bind(model)) as typeof model.generateContent;
        const userParts: any[] = [{ text: promptSections }, ...imageParts];

        const invokeLiveRawText = async (temperature: number): Promise<string> => {
          const result = await callGeminiWithRetry(
            () =>
              rawGen({
                contents: [{ role: "user", parts: userParts }],
                generationConfig: {
                  temperature,
                  responseMimeType: "application/json",
                },
              }),
            retryConfig
          );
          return result.response.text();
        };

        const firstRawText = await invokeLiveRawText(0.2);
        try {
          parsedOutput = parseJsonObjectFromModelText(firstRawText);
        } catch (jsonErr) {
          if (checkAborted()) {
            throw jsonErr;
          }
          await sleepAbortable(400, params._testRetryOptions?.shouldAbort);
          const repairedRawText = await invokeLiveRawText(0.1);
          parsedOutput = parseJsonObjectFromModelText(repairedRawText);
        }
      }

      const scorableMap = new Map(scorableCriteria.map((c) => [c.rowNumber, c]));
      const aiCriterionMap = new Map<
        number,
        { rating: DemoCriterionGradeValue; evidenceNote: string }
      >();
      for (const item of Array.isArray(parsedOutput?.criteria) ? parsedOutput.criteria : []) {
        const rowNum = Number(item?.rowNumber);
        if (!scorableMap.has(rowNum)) continue;
        const rating = normalizeGeminiRating(item?.rating);
        const noteRaw = deAnonymizeSpckText(
          String(item?.evidenceNote || "").trim(),
          anonymousToken,
          stu.fullName
        ).replace(/\r?\n+/g, " ");
        const cleanNote = stripLeadingAiSuggestionLabel(noteRaw);
        aiCriterionMap.set(rowNum, {
          rating,
          evidenceNote: cleanNote || "Đã đối chiếu mã nguồn/tư liệu dự án.",
        });
      }

      const criteriaByRow: Record<number, StudentDemoAiCriterionAnnotation> = {};
      for (const row of structure.criteriaRows) {
        if (row.scorability === "LIVE_JUDGE_ONLY") {
          criteriaByRow[row.rowNumber] = {
            rowNumber: row.rowNumber,
            rating: "Tốt",
            isAiScored: false,
            columnGNote: "[GK chấm trực tiếp khi con thuyết trình & trả lời vấn đáp]",
          };
          continue;
        }
        if (row.scorability === "CONDITIONAL_SLIDE" && !hasSlideFileOrLink) {
          criteriaByRow[row.rowNumber] = {
            rowNumber: row.rowNumber,
            rating: "Tốt",
            isAiScored: false,
            columnGNote: "[Chưa có Slide trong thư mục - GK chấm trực tiếp]",
          };
          continue;
        }
        if (
          row.scorability === "CONDITIONAL_VIDEO_OR_LINK" &&
          !hasVideoOrExperienceLink
        ) {
          criteriaByRow[row.rowNumber] = {
            rowNumber: row.rowNumber,
            rating: "Tốt",
            isAiScored: false,
            columnGNote: "[Chưa có Video/Link trải nghiệm - GK kiểm tra trực tiếp]",
          };
          continue;
        }

        const aiPick = aiCriterionMap.get(row.rowNumber);
        if (aiPick) {
          criteriaByRow[row.rowNumber] = {
            rowNumber: row.rowNumber,
            rating: aiPick.rating,
            isAiScored: true,
            columnGNote: aiPick.evidenceNote,
          };
        } else {
          criteriaByRow[row.rowNumber] = {
            rowNumber: row.rowNumber,
            rating: row.defaultRating,
            isAiScored: false,
            columnGNote: `[Mặc định '${row.defaultRating}'] GK xem thêm trực tiếp khi demo.`,
          };
        }
      }

      const cleanQuestions = (
        Array.isArray(parsedOutput?.bgkQuestions) ? parsedOutput.bgkQuestions : []
      )
        .map((q) =>
          stripLeadingAiSuggestionLabel(
            deAnonymizeSpckText(String(q || "").trim(), anonymousToken, stu.fullName).replace(
              /\r?\n+/g,
              " "
            )
          )
        )
        .filter(Boolean)
        .slice(0, 3);

      byTabName[stu.tabName] = {
        studentId: stu.studentId,
        criteriaByRow,
        bgkQuestions: cleanQuestions,
      };
      preScoredCount += 1;
    } catch (err) {
      if (
        checkAborted() ||
        /dừng khẩn cấp|đã dừng tác vụ/i.test(err instanceof Error ? err.message : String(err))
      ) {
        throw err;
      }
      console.warn(
        `[spck-demo-sheet-scorer] AI pre-score fallback for ${normalizedClassId}/${anonymousToken}: ${summarizeSafeGeminiErrorForLog(
          err
        )}`
      );
      skippedCount += 1;
      skipReasons.aiErrorCount += 1;
      byTabName[stu.tabName] = buildDefaultAnnotationsResult(
        stu.studentId,
        structure,
        "AI_ERROR",
        "Chưa chấm nháp tự động — giữ mặc định 'Tốt' để GK chấm trực tiếp."
      );
    }
  }

  return { byTabName, preScoredCount, skippedCount, skipReasons };
}
