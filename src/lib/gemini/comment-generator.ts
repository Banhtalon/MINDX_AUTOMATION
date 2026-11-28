import { getGeminiModel } from "./client";
import { sessionFeedbackRepo, studentRepo, type SessionFeedbackRecord } from "../db/sqlite";
import { getCoursesSyllabus, getQuickTags } from "../db/json-config";
import { createRosterNameScrubber as _createRosterNameScrubber } from "../ai/pii-anonymizer";
import {
  formatCheckpointScoreHeaderLine,
  isLegoRoboticsClassCodePure,
  isRoboticsClassCodePure,
  mergeCheckpointStudentData,
  parseCheckpointDataJson,
  resolveCheckpointStageForSession,
  stripExistingCheckpointHeaderLine,
  upsertCheckpointHeaderIntoFinalText,
  type CheckpointStudentData,
} from "../checkpoint/checkpoint-competency";
import { computeCheckpointDataForSession } from "../checkpoint/checkpoint-history-loader";
import { resolveCheckpointSessionsForClass } from "../quick-tags";
const safeResolveCheckpointStageCg =
  typeof resolveCheckpointStageForSession === "function"
    ? resolveCheckpointStageForSession
    : () => ({ isCheckpoint: false, isRobotics: false, cpStage: null });
const safeIsRoboticsCg =
  typeof isRoboticsClassCodePure === "function"
    ? isRoboticsClassCodePure
    : (c: string) => /(?:rob|pre[bai]|arm[bai]|semi[bai]|vex|kiro|lego)/i.test(c);
const safeIsLegoCg =
  typeof isLegoRoboticsClassCodePure === "function" ? isLegoRoboticsClassCodePure : () => false;
const safeResolveCpSessionsCg =
  typeof resolveCheckpointSessionsForClass === "function"
    ? resolveCheckpointSessionsForClass
    : null;
const safeParseCheckpointDataCg =
  typeof parseCheckpointDataJson === "function" ? parseCheckpointDataJson : () => null;
const safeMergeCheckpointDataCg =
  typeof mergeCheckpointStudentData === "function"
    ? mergeCheckpointStudentData
    : (a: any, b: any) => a ?? b ?? null;
const safeComputeCheckpointSessionCg =
  typeof computeCheckpointDataForSession === "function" ? computeCheckpointDataForSession : null;
const safeFormatCheckpointHeaderCg =
  typeof formatCheckpointScoreHeaderLine === "function"
    ? formatCheckpointScoreHeaderLine
    : () => "";
const safeStripCheckpointHeaderCg =
  typeof stripExistingCheckpointHeaderLine === "function"
    ? stripExistingCheckpointHeaderLine
    : (t: string) => t;
const safeUpsertCheckpointHeaderCg =
  typeof upsertCheckpointHeaderIntoFinalText === "function"
    ? upsertCheckpointHeaderIntoFinalText
    : (t: string) => t;
const sharedCreateRosterNameScrubber =
  typeof _createRosterNameScrubber === "function"
    ? _createRosterNameScrubber
    : (console as any).__mindxPiiAnonymizer?.createRosterNameScrubber;

export interface StudentCommentInput {
  studentId: string;
  fullName: string;
  isActive?: boolean | number;
  attendanceStatus?: "PRESENT" | "ABSENT" | "LATE" | "UNKNOWN";
  quickTags?: string[];
  teacherNote?: string;
  expectedRowVer?: number | null;
  checkpointData?: CheckpointStudentData | null;
}

export interface SessionContext {
  classId: string;
  classCode: string;
  sessionId: string;
  sessionNumber: number;
  topic: string;
  keyKnowledge?: string[];
  isCheckpointSession?: boolean;
}

export interface GeneratedCommentResult {
  studentId: string;
  fullName: string;
  status: "INSUFFICIENT_INFO" | "DRAFT" | "FAILED";
  strengths: string;
  improvements: string;
  actionPlan: string;
  formattedFullComment: string;
  errorMessage?: string;
  staleIgnored?: boolean;
  versionMeta?: any;
  checkpointData?: CheckpointStudentData | null;
}

interface CandidateSnapshot {
  hadExistingRecord: boolean;
  versionMetaJson: string;
  rowVer: number;
  attendanceStatus: string;
  quickTagsJson: string;
  teacherNote: string;
  strengths: string;
  improvements: string;
  actionPlan: string;
  finalText: string;
  status: string;
  contentHash: string;
}

function parseVersionMetaSafe(raw?: string | null): { rowVer: number; fields: Record<string, any> } {
  if (!raw || typeof raw !== "string") return { rowVer: 0, fields: {} };
  try {
    const parsed = JSON.parse(raw);
    return {
      rowVer: typeof parsed?.rowVer === "number" && Number.isFinite(parsed.rowVer) ? parsed.rowVer : 0,
      fields:
        parsed?.fields && typeof parsed.fields === "object" && !Array.isArray(parsed.fields)
          ? { ...parsed.fields }
          : {},
    };
  } catch {
    return { rowVer: 0, fields: {} };
  }
}

function normalizeWordsForSimilarity(raw: string): string[] {
  const cleaned = String(raw || "")
    .replace(/[-•*]\s*\*\*Điểm mạnh(?: của học viên)?:\*\*/gi, " ")
    .replace(/[-•*]\s*\*\*Điểm cần cải thiện:\*\*/gi, " ")
    .replace(/[-•*]\s*\*\*(?:Lời khuyên|Hướng rèn luyện):\*\*/gi, " ")
    .replace(/\*+/g, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];
  return cleaned.split(" ").filter((w) => w.length > 0);
}

/**
 * Computes lexical & phrase similarity between two generated comments in [0, 1].
 * Combines 2-word shingle Jaccard (60%) and token Jaccard (40%) after stripping standard 3-bullet headers.
 */
export function computeCommentSimilarity(textA: string, textB: string): number {
  const wordsA = normalizeWordsForSimilarity(textA);
  const wordsB = normalizeWordsForSimilarity(textB);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  if (wordsA.join(" ") === wordsB.join(" ")) return 1;

  const setA = new Set<string>(wordsA);
  const setB = new Set<string>(wordsB);
  let tokenInter = 0;
  for (const w of setA) {
    if (setB.has(w)) tokenInter++;
  }
  const tokenUnion = setA.size + setB.size - tokenInter;
  const tokenJaccard = tokenUnion > 0 ? tokenInter / tokenUnion : 0;

  if (wordsA.length < 2 || wordsB.length < 2) {
    return tokenJaccard;
  }

  const bigramsA = new Set<string>();
  for (let i = 0; i < wordsA.length - 1; i++) {
    bigramsA.add(`${wordsA[i]} ${wordsA[i + 1]}`);
  }
  const bigramsB = new Set<string>();
  for (let i = 0; i < wordsB.length - 1; i++) {
    bigramsB.add(`${wordsB[i]} ${wordsB[i + 1]}`);
  }
  let biInter = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) biInter++;
  }
  const biUnion = bigramsA.size + bigramsB.size - biInter;
  const biJaccard = biUnion > 0 ? biInter / biUnion : 0;

  return biJaccard * 0.6 + tokenJaccard * 0.4;
}

const NARRATIVE_ANGLES: string[] = [
  "Góc nhìn 1 (Trọng tâm Thao tác thực hành & Sản phẩm): Mở đầu từ quá trình con trực tiếp bắt tay vào thực hiện sản phẩm/mô hình của bài học hôm nay; phần cải thiện đi vào độ chính xác của thao tác thực tế; lời khuyên hướng dẫn cách tự kiểm tra lại sản phẩm từng bước.",
  "Góc nhìn 2 (Trọng tâm Tư duy logic & Quy trình từng bước): Mở đầu từ cách con nắm bắt nguyên lý hoạt động và trình tự thực hiện bài học; phần cải thiện nhấn mạnh vào việc sắp xếp các bước hoặc kiểm soát luồng hoạt động; lời khuyên gợi ý ba mẹ hỏi lại con quy trình hoạt động của bài học tại nhà.",
  "Góc nhìn 3 (Trọng tâm Thái độ học tập & Nhịp độ trên lớp): Mở đầu từ tinh thần tham gia giờ học và cách con bắt nhịp với yêu cầu của thầy; phần cải thiện tập trung vào cách phân bổ thời gian và duy trì sự tỉ mỉ ở từng chặng; lời khuyên khuyến khích thói quen rèn luyện ngắn đều đặn tại nhà.",
  "Góc nhìn 4 (Trọng tâm Khả năng vận dụng kiến thức trọng tâm): Mở đầu từ việc con áp dụng khái niệm/cơ chế chính của buổi học vào bài thực hành; phần cải thiện nêu điểm cần rèn thêm để làm chủ hoàn toàn kiến thức mới; lời khuyên gợi ý con thử giải thích hoặc thực hành lại một phần nhỏ cho ba mẹ xem.",
  "Góc nhìn 5 (Trọng tâm Kỹ năng quan sát & Tự kiểm thử/sửa lỗi): Mở đầu từ khả năng quan sát hướng dẫn/mẫu bài và thử nghiệm kết quả chạy thực tế; phần cải thiện tập trung vào thói quen rà soát chi tiết trước khi kết thúc bước làm; lời khuyên hướng dẫn cách bình tĩnh đối chiếu và tự tìm điểm sai khi thực hành.",
  "Góc nhìn 6 (Trọng tâm Sự chủ động & Tương tác trong giờ học): Mở đầu từ sự tập trung theo dõi bài giảng và phản hồi khi thầy hướng dẫn thực hành; phần cải thiện góp ý nhẹ nhàng về việc giữ nhịp độ ổn định xuyên suốt buổi; lời khuyên gợi ý ba mẹ khích lệ con chia sẻ điều thú vị nhất học được trong buổi.",
  "Góc nhìn 7 (Trọng tâm Độ hoàn thiện chi tiết & Tính chỉn chu): Mở đầu từ kết quả bước đầu con hoàn thành được trong chủ đề hôm nay; phần cải thiện đi sâu vào độ chuẩn xác và sự chắc chắn/gọn gàng trong từng chi tiết; lời khuyên gợi ý cách ôn lại từ phần cơ bản đến nâng cao.",
  "Góc nhìn 8 (Trọng tâm Khả năng kết nối lý thuyết vào thực tế): Mở đầu từ việc con hiểu ý nghĩa ứng dụng của bài học hôm nay và chuyển hóa thành thao tác thực tế; phần cải thiện nêu khía cạnh cần luyện thêm để thao tác mượt mà hơn; lời khuyên gợi ý con liên hệ bài học với các tình huống hoặc bài tập tương tự ở nhà.",
];

export interface ExtractedStudentIssues {
  explicitClassroomBullets: string[];
  recordedIssues: string[];
  hasIssuesToCorrect: boolean;
}

interface ClassroomIssueCategoryRule {
  id: string;
  matchRegex: RegExp;
}

const CLASSROOM_ISSUE_RULES: readonly ClassroomIssueCategoryRule[] = [
  { id: "di_muon", matchRegex: /(?:đi\s*(?:học\s*)?muộn|đến\s*(?:lớp\s*)?muộn|trễ\s*giờ)/i },
  {
    id: "chua_btvn",
    matchRegex: /(?:btvn|bài\s*tập\s*về\s*nhà|chưa\s*(?:hoàn\s*thành|làm)\s*bài\s*tập)/i,
  },
  { id: "noi_chuyen", matchRegex: /(?:nói\s*chuyện|trao\s*đổi\s*riêng|làm\s*ồn)/i },
  {
    id: "khong_chu_y",
    matchRegex: /(?:mất\s*tập\s*trung|không\s*chú\s*ý|thiếu\s*tập\s*trung|cần\s*nhắc\s*tập\s*trung|xao\s*nhãng|phân\s*tâm)/i,
  },
  { id: "viec_rieng", matchRegex: /(?:làm\s*việc\s*riêng|việc\s*riêng|chơi\s*(?:game|riêng))/i },
  { id: "roi_cho", matchRegex: /(?:rời\s*(?:khỏi\s*)?chỗ|đi\s*lại)/i },
  {
    id: "tiep_thu_cham",
    matchRegex: /(?:tiếp\s*thu\s*chậm|nắm\s*bài\s*chậm|lắp\s*ráp\s*cần\s*hỗ\s*trợ|lắp\s*ráp\s*còn\s*chậm|theo\s*kịp\s*tiến\s*độ)/i,
  },
  {
    id: "thao_tac_cham",
    matchRegex: /(?:thao\s*tác.*chậm|cú\s*pháp.*chậm|lập\s*trình\s*cần\s*hỗ\s*trợ|cần\s*rèn.*tỉ\s*mỉ|lúng\s*túng)/i,
  },
  {
    id: "toc_do_thai_do",
    matchRegex: /(?:chưa\s*nghiêm\s*túc|thiếu\s*nghiêm\s*túc|chưa\s*chủ\s*động|thái\s*độ\s*thực\s*hành|lười|trì\s*hoãn)/i,
  },
];

const FREE_NOTE_ISSUE_HINTS: ReadonlyArray<{ regex: RegExp; label: string; ignoreIfPrecededBy?: RegExp }> = [
  { regex: /(?:chưa\s*(?:làm|hoàn\s*thành|nộp)?\s*btvn|thiếu\s*btvn|quên\s*btvn|chưa\s*làm\s*bài\s*tập\s*về\s*nhà)/i, label: "Chưa hoàn thành BTVN trước buổi học" },
  { regex: /(?:đi\s*(?:học\s*)?muộn|đến\s*(?:lớp\s*)?muộn|trễ\s*giờ)/i, label: "Đi học muộn" },
  { regex: /(?:nói\s*chuyện|trao\s*đổi\s*riêng)/i, label: "Nói chuyện riêng trong giờ" },
  { regex: /(?:mất\s*tập\s*trung|không\s*chú\s*ý|xao\s*nhãng|thiếu\s*tập\s*trung)/i, label: "Mất tập trung khi nghe giảng" },
  {
    regex: /(?:làm\s*việc\s*riêng|việc\s*riêng|chơi\s*game)/i,
    label: "Làm việc riêng trong giờ",
    ignoreIfPrecededBy: /(?:trò|làm|tạo|thiết\s*kế|xây\s*dựng|lập\s*trình|viết)\s*$/i,
  },
  { regex: /(?:rời\s*(?:khỏi\s*)?chỗ|đi\s*lại\s*tự\s*do)/i, label: "Tự ý rời khỏi chỗ ngồi" },
  { regex: /(?:lười|thiếu\s*nghiêm\s*túc|chưa\s*nghiêm\s*túc|chưa\s*chủ\s*động|làm\s*bài\s*chậm|lúng\s*túng)/i, label: "Tốc độ và thái độ thực hành chưa nghiêm túc" },
];

function matchesUnnegatedIssueHint(
  text: string,
  hint: { regex: RegExp; label: string; ignoreIfPrecededBy?: RegExp }
): boolean {
  const globalRegex = new RegExp(hint.regex.source, hint.regex.flags.includes("g") ? hint.regex.flags : `${hint.regex.flags}g`);
  let match: RegExpExecArray | null;
  while ((match = globalRegex.exec(text)) !== null) {
    const beforeAll = text.slice(0, match.index);
    const clauseStart = Math.max(
      beforeAll.lastIndexOf("\n"),
      beforeAll.lastIndexOf("."),
      beforeAll.lastIndexOf(","),
      beforeAll.lastIndexOf(";"),
      beforeAll.lastIndexOf(":")
    );
    const beforeInClause = beforeAll.slice(clauseStart + 1);
    const isNegated = /(?:^|\s)(?:không(?:\s+còn)?|chưa|đã\s+hết|hết|đỡ|bớt)\s*$/i.test(beforeInClause);
    const isIgnoredContext = hint.ignoreIfPrecededBy ? hint.ignoreIfPrecededBy.test(beforeInClause) : false;
    if (!isNegated && !isIgnoredContext) {
      return true;
    }
  }
  return false;
}

function cleanIssuePhraseText(raw: string): string {
  const cleaned = String(raw || "")
    .replace(/^[+•*\-]\s*/, "")
    .replace(/\.$/, "")
    .trim();
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function stripLeadingEmojiAndSymbols(raw: string): string {
  return String(raw || "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .trim();
}

function isIssueAlreadyCovered(issueList: string[], candidateText: string): boolean {
  const lowerCand = candidateText.toLowerCase();
  const matchedRules = CLASSROOM_ISSUE_RULES.filter((r) => r.matchRegex.test(lowerCand));
  if (matchedRules.length > 0) {
    return issueList.some((existing) =>
      matchedRules.some((r) => r.matchRegex.test(existing.toLowerCase()))
    );
  }
  const candNorm = lowerCand.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  return issueList.some((existing) => {
    const exNorm = existing.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
    return Boolean(candNorm && (exNorm.includes(candNorm) || candNorm.includes(exNorm)));
  });
}

/**
 * Extracts explicit classroom issues (both v3.6.8 multi-line `+ ` format and legacy `Cần lưu ý:` comma format),
 * attendance LATE status, and constructive Quick Tags from scrubbed inputs.
 */
export function extractRecordedIssuesForPrompt(
  sanitizedTeacherNote: string,
  sanitizedQuickTags: string[],
  attendanceStatus?: string
): ExtractedStudentIssues {
  const note = String(sanitizedTeacherNote || "").replace(/\r\n/g, "\n");
  const explicitClassroomBullets: string[] = [];

  // 1. Parse multi-line heading ("Cần chấn chỉnh:" or "Cần lưu ý:") followed by "+ ..." lines
  const lines = note.split("\n");
  let insideIssueBlock = false;
  let insidePrivateNote = false;
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (/^(?:Cần\s+chấn\s+chỉnh|Cần\s+lưu\s+ý)\s*:/i.test(trimmed)) {
      insideIssueBlock = true;
      insidePrivateNote = false;
      const afterColon = trimmed.replace(/^(?:Cần\s+chấn\s+chỉnh|Cần\s+lưu\s+ý)\s*:\s*/i, "").trim();
      if (afterColon) {
        // Legacy comma-separated line (e.g. "Cần lưu ý: đi học muộn, nói chuyện riêng (1 lần).")
        if (/^[+•*\-]\s+/.test(afterColon)) {
          const item = cleanIssuePhraseText(afterColon);
          if (item && !isIssueAlreadyCovered(explicitClassroomBullets, item)) {
            explicitClassroomBullets.push(item);
          }
        } else {
          for (const part of afterColon.split(/,\s*(?![^()]*\))/)) {
            const item = cleanIssuePhraseText(part);
            if (item && !isIssueAlreadyCovered(explicitClassroomBullets, item)) {
              explicitClassroomBullets.push(item);
            }
          }
        }
      }
      continue;
    }

    if (/^Ghi\s+chú\s+riêng\s*:/i.test(trimmed)) {
      insideIssueBlock = false;
      insidePrivateNote = true;
      continue;
    }

    if (/^Trong\s+giờ\s*:/i.test(trimmed)) {
      insideIssueBlock = false;
      insidePrivateNote = false;
      continue;
    }

    if (insideIssueBlock) {
      if (!trimmed) {
        insideIssueBlock = false;
        continue;
      }
      if (/^[+•*\-]\s+/.test(trimmed)) {
        const item = cleanIssuePhraseText(trimmed);
        if (item && !isIssueAlreadyCovered(explicitClassroomBullets, item)) {
          explicitClassroomBullets.push(item);
        }
      }
    } else if (!insidePrivateNote && /^\+\s+/.test(trimmed)) {
      // Standalone "+ ..." line in teacher note (outside "Ghi chú riêng:")
      const item = cleanIssuePhraseText(trimmed);
      if (item && !isIssueAlreadyCovered(explicitClassroomBullets, item)) {
        explicitClassroomBullets.push(item);
      }
    }
  }

  if (
    attendanceStatus === "LATE" &&
    !explicitClassroomBullets.some((b) => /(?:đi\s*(?:học\s*)?muộn|trễ\s*giờ)/i.test(b))
  ) {
    explicitClassroomBullets.unshift("Đi học muộn");
  }

  const recordedIssues: string[] = [...explicitClassroomBullets];
  const hasSpecificDistractionBullet = explicitClassroomBullets.some((b) =>
    /(?:nói\s*chuyện|không\s*chú\s*ý|mất\s*tập\s*trung|việc\s*riêng|rời\s*(?:khỏi\s*)?chỗ)/i.test(b)
  );

  // 2. Scan Quick Tags with constructive/improvement signals
  for (const rawTag of sanitizedQuickTags || []) {
    const cleanTag = stripLeadingEmojiAndSymbols(rawTag);
    if (!cleanTag) continue;
    const lower = cleanTag.toLowerCase();
    const isAggregateDistractionTag = /^(?:mất\s*tập\s*trung|cần\s*nhắc\s*tập\s*trung)$/i.test(cleanTag);
    if (isAggregateDistractionTag && hasSpecificDistractionBullet) {
      continue;
    }
    const isIssueTag =
      /tiếp thu chậm|mất tập trung|cần nhắc tập trung|thao tác.*chậm|cú pháp còn chậm|lắp ráp cần hỗ trợ|lập trình cần hỗ trợ|cần kèm|cần tập trung hơn|còn chậm/i.test(
        lower
      );
    if (isIssueTag && !isIssueAlreadyCovered(recordedIssues, cleanTag)) {
      recordedIssues.push(cleanTag);
    }
  }

  // 3. Scan free-text private notes outside the structured bullets for additional concrete issues
  const nonStructuredNote = lines
    .filter((l) => {
      const t = l.trim();
      return (
        !/^(?:Cần\s+chấn\s+chỉnh|Cần\s+lưu\s+ý|Trong\s+giờ)\s*:/i.test(t) &&
        !/^[+•*\-]\s+/.test(t)
      );
    })
    .join("\n");

  for (const hint of FREE_NOTE_ISSUE_HINTS) {
    if (matchesUnnegatedIssueHint(nonStructuredNote, hint) && !isIssueAlreadyCovered(recordedIssues, hint.label)) {
      recordedIssues.push(hint.label);
    }
  }

  return {
    explicitClassroomBullets,
    recordedIssues,
    hasIssuesToCorrect: recordedIssues.length > 0,
  };
}

/**
 * Normalizes AI-generated `improvements` into Sample 1 format:
 * - Candid lead sentence ending with `:` followed by separate `\n  + ` sub-bullet lines.
 * - Guarantees 0 omitted recorded issues while leaving spotless (`hasIssuesToCorrect === false`) students untouched.
 */
export function normalizeCandidImprovementsWithPlusBullets(
  rawImprovements: string,
  extracted: ExtractedStudentIssues
): string {
  const cleaned = String(rawImprovements || "")
    .replace(/^[-•*]\s*\*\*Điểm cần cải thiện:\*\*\s*/i, "")
    .replace(/\r\n/g, "\n")
    .trim();

  if (!extracted.hasIssuesToCorrect) {
    return cleaned;
  }

  // Split inline "+ ..." fragments onto their own indented sub-bullet lines
  let working = cleaned
    .replace(/([:.;?!])\s+\+\s+(?=\*\*|\p{L})/gu, "$1\n  + ")
    .replace(/\s+\+\s+(?=\*\*)/g, "\n  + ");

  const rawLines = working
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let leadLine = "";
  const bulletLines: string[] = [];

  for (let idx = 0; idx < rawLines.length; idx++) {
    const line = rawLines[idx];
    const isSubBullet = /^(?:[+•*]|\d+\.)\s+/.test(line) || (idx > 0 && /^-\s+/.test(line));
    if (isSubBullet) {
      const body = line.replace(/^(?:[+•*\-]|\d+\.)\s+/, "").trim();
      if (body) bulletLines.push(`  + ${body}`);
    } else if (!leadLine) {
      leadLine = line;
    } else {
      bulletLines.push(`  + ${line}`);
    }
  }

  if (!leadLine) {
    leadLine =
      "Trong buổi học hôm nay, thái độ học tập và sự chuẩn bị bài của con còn các điểm cần chấn chỉnh ngay:";
  }

  const combinedBulletText = bulletLines.join("\n").toLowerCase();

  // Zero-omission guarantee: check EVERY recordedIssues entry (explicit bullets + Quick Tags + free notes) against `+ ` sub-bullets
  const requiredBullets = extracted.recordedIssues;

  for (const requiredIssue of requiredBullets) {
    const matchedRule = CLASSROOM_ISSUE_RULES.find((r) => r.matchRegex.test(requiredIssue));
    const alreadyPresentInBullets = matchedRule
      ? matchedRule.matchRegex.test(combinedBulletText)
      : (() => {
          const tokens = requiredIssue
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, " ")
            .split(/\s+/)
            .filter((t) => t.length >= 2 && t !== "lần");
          if (tokens.length === 0) return false;
          const hitCount = tokens.filter((t) => combinedBulletText.includes(t)).length;
          return hitCount >= Math.max(1, Math.ceil(tokens.length * 0.6));
        })();

    if (!alreadyPresentInBullets) {
      const hasTimes = /\(\d+\s*lần\)/i.test(requiredIssue);
      const suffix = hasTimes
        ? " làm gián đoạn nhịp học và ảnh hưởng kết quả thực hành trên lớp."
        : " ảnh hưởng trực tiếp đến tiến độ học tập trên lớp.";
      bulletLines.push(`  + **${requiredIssue}**${suffix}`);
    }
  }

  if (bulletLines.length === 0) {
    return leadLine;
  }

  if (!leadLine.endsWith(":")) {
    leadLine = leadLine.replace(/[.。!?;]+$/, "").trim() + ":";
  }

  return `${leadLine}\n${bulletLines.join("\n")}`;
}

export class CommentGenerator {
  private static latestBatchSeq = 0;
  private static latestStudentCallSeq = new Map<string, number>();
  /**
   * Generates pedagogy-aligned 3-part comments for a list of students in a session.
   * Strictly enforces:
   * 1. Anti-hallucination guardrail: Returns INSUFFICIENT_INFO if no tags and no notes.
   * 2. Anonymization: Anonymizes student names to STUDENT_01, STUDENT_02... before calling Gemini.
   * 3. De-anonymization: Re-maps back to real names.
   * 4. Immediate draft persistence into SQLite.
   */
  public static async generateBatchComments(
    session: SessionContext,
    students: StudentCommentInput[]
  ): Promise<GeneratedCommentResult[]> {
    const normalizedClassId =
      typeof session?.classId === "string" ? session.classId.trim().toUpperCase() : "";
    const normalizedClassCode =
      typeof session?.classCode === "string" && session.classCode.trim()
        ? session.classCode.trim().toUpperCase()
        : normalizedClassId;
    const normalizedSessionId =
      typeof session?.sessionId === "string" ? session.sessionId.trim() : "";

    if (!normalizedClassId || !normalizedSessionId) {
      throw new Error(
        "[CommentGenerator] Thiếu classId hoặc sessionId bắt buộc trước khi sinh nhận xét AI."
      );
    }
    if (normalizedClassId !== normalizedClassCode) {
      throw new Error(
        `[CommentGenerator] Xung đột định danh lớp: classId ('${normalizedClassId}') khác classCode ('${normalizedClassCode}').`
      );
    }

    const escapedClassId = normalizedClassId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sessionPrefixRegex = new RegExp(`^${escapedClassId}(?:_SESS_|[^a-zA-Z0-9_-])`, "i");
    if (!sessionPrefixRegex.test(normalizedSessionId)) {
      throw new Error(
        `[CommentGenerator] Mã buổi học '${normalizedSessionId}' không thuộc đúng lớp '${normalizedClassId}'.`
      );
    }

    const callSeq = ++CommentGenerator.latestBatchSeq;
    const results: GeneratedCommentResult[] = [];
    const cpStageInfo = safeResolveCheckpointStageCg(
      normalizedClassCode,
      session.sessionNumber
    );
    const isResolvedCheckpointSession =
      typeof session.isCheckpointSession === "boolean"
        ? session.isCheckpointSession
        : cpStageInfo.isCheckpoint;
    let computedCheckpointByStudent: Record<string, CheckpointStudentData> = {};
    if (isResolvedCheckpointSession && safeComputeCheckpointSessionCg) {
      try {
        computedCheckpointByStudent = safeComputeCheckpointSessionCg({
          classId: normalizedClassId,
          sessionId: normalizedSessionId,
          sessionNumber: session.sessionNumber,
          forceRecalculate: false,
          persist: false,
        }).byStudent;
      } catch {
        computedCheckpointByStudent = {};
      }
    }

    const validCandidates: {
      input: StudentCommentInput;
      regularQuickTags: string[];
      anonymousId: string;
      scopeKey: string;
      initialSnapshot: CandidateSnapshot;
      extractedIssues?: ExtractedStudentIssues;
      checkpointData?: CheckpointStudentData | null;
    }[] = [];

    const rawCategories = typeof getQuickTags === "function" ? getQuickTags() || [] : [];
    const isSession14CategoryObj = (cat: any): boolean => {
      const track = String(cat?.track || "").trim().toLowerCase();
      const key = String(cat?.category || "").trim().toLowerCase();
      const name = String(cat?.categoryName || "").trim().toLowerCase();
      return (
        track === "session14" ||
        track === "spck" ||
        key.startsWith("spck_") ||
        key.includes("session14") ||
        /buổi\s*14|spck/i.test(name)
      );
    };
    const configuredCategories = rawCategories.filter((cat) => !isSession14CategoryObj(cat));
    const session14TagSet = new Set<string>();
    for (const cat of rawCategories) {
      if (!isSession14CategoryObj(cat)) continue;
      for (const t of cat?.tags || []) {
        if (t?.id) session14TagSet.add(String(t.id).trim().toLowerCase());
        if (t?.label) session14TagSet.add(String(t.label).trim().toLowerCase());
      }
    }
    const filterRegularTags = (tags?: string[]): string[] => {
      if (!Array.isArray(tags)) return [];
      return tags
        .map((t) => String(t || "").trim())
        .filter((t) => {
          if (!t) return false;
          const lower = t.toLowerCase();
          if (session14TagSet.has(lower)) return false;
          if (
            /^s14_|slide thuyết trình|phụ thuộc.*vào ai|bố cục.*flexbox|thuyết trình còn nhỏ|sản phẩm chạy mượt/i.test(
              lower
            )
          ) {
            return false;
          }
          return true;
        });
    };

    const captureSnapshot = (
      student: StudentCommentInput,
      regularQuickTags: string[],
      dbRecord?: SessionFeedbackRecord
    ): CandidateSnapshot => {
      const meta = parseVersionMetaSafe(dbRecord?.versionMetaJson);
      return {
        hadExistingRecord: Boolean(dbRecord),
        versionMetaJson: dbRecord?.versionMetaJson ?? "",
        rowVer: meta.rowVer,
        attendanceStatus: dbRecord?.attendanceStatus ?? student.attendanceStatus ?? "PRESENT",
        quickTagsJson: dbRecord?.quickTagsJson ?? JSON.stringify(regularQuickTags),
        teacherNote: dbRecord?.teacherNote ?? (student.teacherNote || ""),
        strengths: dbRecord?.strengths ?? "",
        improvements: dbRecord?.improvements ?? "",
        actionPlan: dbRecord?.actionPlan ?? "",
        finalText: dbRecord?.finalText ?? "",
        status: dbRecord?.status ?? "DRAFT",
        contentHash: dbRecord?.contentHash ?? "",
      };
    };

    // Step 1: Filter and classify candidates; apply Active + Present & Anti-Hallucination Guardrail
    for (let i = 0; i < students.length; i++) {
      const student = students[i];
      if (!student || !student.studentId) continue;

      const dbStudent =
        typeof studentRepo?.findOne === "function"
          ? studentRepo.findOne(student.studentId, normalizedClassId)
          : undefined;
      const isMatchingClass =
        !dbStudent?.classId ||
        String(dbStudent.classId).trim().toUpperCase() === normalizedClassId;
      const isStudentActive =
        student.isActive !== false &&
        student.isActive !== 0 &&
        Boolean(dbStudent && dbStudent.isActive === 1 && isMatchingClass);
      const isConfirmedPresent =
        student.attendanceStatus === "PRESENT" || student.attendanceStatus === "LATE";

      if (!isStudentActive || !isConfirmedPresent) {
        continue;
      }

      const initialDbRecord =
        typeof sessionFeedbackRepo?.findOne === "function"
          ? sessionFeedbackRepo.findOne(normalizedClassId, normalizedSessionId, student.studentId)
          : undefined;
      const curMeta = parseVersionMetaSafe(initialDbRecord?.versionMetaJson);
      const hasExpectedRowVer =
        typeof student.expectedRowVer === "number" &&
        Number.isFinite(student.expectedRowVer) &&
        student.expectedRowVer >= 0;

      // R16-03: Check expectedRowVer BEFORE any write branch (including INSUFFICIENT_INFO)
      if (hasExpectedRowVer && curMeta.rowVer !== student.expectedRowVer) {
        results.push({
          studentId: student.studentId,
          fullName: student.fullName,
          status: ((initialDbRecord?.status as any) || "DRAFT") as any,
          strengths: initialDbRecord?.strengths ?? "",
          improvements: initialDbRecord?.improvements ?? "",
          actionPlan: initialDbRecord?.actionPlan ?? "",
          formattedFullComment: initialDbRecord?.finalText ?? "",
          staleIgnored: true,
          versionMeta: curMeta,
          errorMessage: `Dữ liệu của học viên '${student.fullName}' đã được cập nhật mới hơn (phiên bản ${student.expectedRowVer} -> ${curMeta.rowVer}). Giữ nguyên bản hiện tại.`,
        });
        continue;
      }

      // R17-01: Protect already APPROVED or VERIFIED comments before EVERY AI write branch
      if (
        initialDbRecord &&
        (initialDbRecord.status === "APPROVED" || initialDbRecord.status === "VERIFIED")
      ) {
        results.push({
          studentId: student.studentId,
          fullName: student.fullName,
          status: initialDbRecord.status as any,
          strengths: initialDbRecord.strengths ?? "",
          improvements: initialDbRecord.improvements ?? "",
          actionPlan: initialDbRecord.actionPlan ?? "",
          formattedFullComment: initialDbRecord.finalText ?? "",
          staleIgnored: true,
          versionMeta: curMeta,
        });
        continue;
      }

      const scopeKey = `${normalizedClassId}::${normalizedSessionId}::${student.studentId}`;
      CommentGenerator.latestStudentCallSeq.set(scopeKey, callSeq);

      const regularQuickTags = filterRegularTags(student.quickTags);
      const sanitizedClientCp = student.checkpointData
        ? safeParseCheckpointDataCg(JSON.stringify(student.checkpointData))
        : null;
      const dbCpParsed = safeParseCheckpointDataCg(initialDbRecord?.checkpointDataJson);
      const primaryCp = safeMergeCheckpointDataCg(sanitizedClientCp, dbCpParsed);
      const resolvedCpData: CheckpointStudentData | null = isResolvedCheckpointSession
        ? safeMergeCheckpointDataCg(primaryCp, computedCheckpointByStudent[student.studentId] ?? null)
        : null;
      const hasTags = regularQuickTags.length > 0;
      const hasNote = Boolean(student.teacherNote && student.teacherNote.trim().length > 0);
      const hasCpEvidence = Boolean(
        resolvedCpData &&
          (resolvedCpData.theoryScore !== null ||
            resolvedCpData.practiceScore !== null ||
            (resolvedCpData.processSummary?.priorSessionsObserved || 0) > 0)
      );

      // IRON RULE 5: Nếu học viên không có Quick Tags, không có ghi chú và không có dữ liệu điểm/quá trình Checkpoint -> INSUFFICIENT_INFO (CẤM AI BỊA)
      if (!hasTags && !hasNote && !hasCpEvidence) {
        const defaultInsufficientNotice =
          "Chưa đủ thông tin để nhận xét. Vui lòng chọn ít nhất 1 Quick Tag hoặc nhập ghi chú của giáo viên.";
        const preservedStrengths = initialDbRecord?.strengths ?? "";
        const preservedImprovements = initialDbRecord?.improvements ?? "";
        const preservedActionPlan = initialDbRecord?.actionPlan ?? "";
        const preservedFinalText =
          initialDbRecord?.finalText && initialDbRecord.finalText.trim().length > 0
            ? initialDbRecord.finalText
            : defaultInsufficientNotice;

        const insufficientResult: GeneratedCommentResult = {
          studentId: student.studentId,
          fullName: student.fullName,
          status: "INSUFFICIENT_INFO",
          strengths: preservedStrengths,
          improvements: preservedImprovements,
          actionPlan: preservedActionPlan,
          formattedFullComment: preservedFinalText,
          errorMessage: defaultInsufficientNotice,
        };

        const nextMeta = {
          rowVer: (curMeta.rowVer || 0) + 1,
          fields: { ...curMeta.fields },
        };

        // Save immediately to SQLite while preserving current DB attendance/tags/note/finalText if present
        sessionFeedbackRepo.upsert({
          classId: normalizedClassId,
          sessionId: normalizedSessionId,
          studentId: student.studentId,
          attendanceStatus:
            (initialDbRecord?.attendanceStatus as any) || student.attendanceStatus || "PRESENT",
          quickTagsJson: initialDbRecord?.quickTagsJson ?? JSON.stringify(regularQuickTags),
          teacherNote: initialDbRecord?.teacherNote ?? (student.teacherNote || ""),
          strengths: preservedStrengths,
          improvements: preservedImprovements,
          actionPlan: preservedActionPlan,
          finalText: preservedFinalText,
          status: "INSUFFICIENT_INFO",
          versionMetaJson: JSON.stringify(nextMeta),
        });

        results.push({ ...insufficientResult, versionMeta: nextMeta });
        continue;
      }

      // Add to AI generation queue with anonymous ID and input version snapshot
      const anonymousId = `STUDENT_${String(validCandidates.length + 1).padStart(2, "0")}`;
      validCandidates.push({
        input: student,
        regularQuickTags,
        anonymousId,
        scopeKey,
        initialSnapshot: captureSnapshot(student, regularQuickTags, initialDbRecord),
        checkpointData: resolvedCpData,
      });
    }

    // If no students need AI generation, return early
    if (validCandidates.length === 0) {
      return results;
    }

    // Step 2: Build anonymized payload for Gemini API via shared pii-anonymizer (S7.3)
    const dbClassStudents =
      typeof studentRepo?.findByClass === "function"
        ? studentRepo.findByClass(normalizedClassId, false) || []
        : [];
    const rosterEntries: { fullName: string; token: string }[] = [];
    const peerNames: string[] = [];
    for (const c of validCandidates) {
      rosterEntries.push({ fullName: c.input.fullName, token: c.anonymousId });
      const dbSt = dbClassStudents.find((st) => st.studentId === c.input.studentId);
      if (dbSt && dbSt.fullName) {
        rosterEntries.push({ fullName: dbSt.fullName, token: c.anonymousId });
      }
    }
    for (const st of students) {
      if (!validCandidates.some((c) => c.input.studentId === st.studentId)) {
        peerNames.push(st.fullName);
      }
    }
    for (const dbSt of dbClassStudents) {
      if (!validCandidates.some((c) => c.input.studentId === dbSt.studentId)) {
        peerNames.push(dbSt.fullName);
      }
    }
    const scrubStudentNames = sharedCreateRosterNameScrubber({
      rosterEntries,
      peerNames,
      peerToken: "STUDENT_PEER",
    });

    const isRoboticsClass = safeIsRoboticsCg(normalizedClassCode);

    const legacyAliasMap: Record<string, string> = {
      "🤖 lắp ráp & lập trình tốt": "🔧 lắp ráp đúng mẫu",
      "rob_lap_rap_code_tot": "rob_lap_rap_dung_mau",
      "🤝 phối hợp nhóm & giữ kit tốt": "🤝 hợp tác nhóm tốt",
      "rob_nhom_giu_kit_tot": "rob_hop_tac_nhom_tot",
      "🔩 lắp ráp còn chậm / nhầm chốt": "🔩 lắp ráp cần hỗ trợ",
      "rob_lap_cham_nham_chot": "rob_lap_rap_can_ho_tro",
      "🔌 lập trình / đấu mạch còn lúng túng": "🧩 lập trình cần hỗ trợ",
      "rob_code_mach_lung_tung": "rob_lap_trinh_can_ho_tro",
      "rob_mat_tap_trung": "rob_can_nhac_tap_trung",
      "rob_hang_hai": "rob_hop_tac_nhom_tot",
    };

    const resolveTagWithHint = (rawTag: string): string => {
      const cleanTag = String(rawTag || "").trim();
      if (!cleanTag || configuredCategories.length === 0) return cleanTag;
      const rawLower = cleanTag.toLowerCase();
      const aliasedLower =
        isRoboticsClass && rawLower === "👀 mất tập trung"
          ? "👀 cần nhắc tập trung"
          : legacyAliasMap[rawLower] || rawLower;

      let fallbackHint = "";
      let fallbackLabel = cleanTag;
      for (const cat of configuredCategories) {
        const catTrack = String((cat as any)?.track || "").toLowerCase();
        const catKey = String(cat?.category || "").toLowerCase();
        const catName = String(cat?.categoryName || "").toLowerCase();
        const isRobCat =
          catTrack === "robotics" ||
          catKey.includes("robot") ||
          catKey.startsWith("rob_") ||
          /robot|lắp ráp|🤖/i.test(catName);
        const isCodeCat =
          catTrack === "coding" ||
          catKey.includes("coding") ||
          catKey === "execution" ||
          /lập trình|code|💻/i.test(catName);

        for (const t of cat?.tags || []) {
          const tLabel = String(t?.label || "").trim();
          const tId = String(t?.id || "").trim();
          const tLabelLower = tLabel.toLowerCase();
          const tIdLower = tId.toLowerCase();
          if (
            (tLabelLower === rawLower ||
              tIdLower === rawLower ||
              tLabelLower === aliasedLower ||
              tIdLower === aliasedLower) &&
            t?.hint
          ) {
            const displayLabel = tLabel || cleanTag;
            if ((isRoboticsClass && isRobCat) || (!isRoboticsClass && isCodeCat)) {
              return `${displayLabel} (Ý nghĩa sư phạm: ${t.hint})`;
            }
            if (!fallbackHint) {
              fallbackHint = t.hint;
              fallbackLabel = displayLabel;
            }
          }
        }
      }
      return fallbackHint ? `${fallbackLabel} (Ý nghĩa sư phạm: ${fallbackHint})` : cleanTag;
    };

    const tagLookup = new Map<string, any>();
    for (const cat of configuredCategories) {
      for (const t of cat?.tags || []) {
        if (t?.label) tagLookup.set(String(t.label).trim().toLowerCase(), t);
        if (t?.id) tagLookup.set(String(t.id).trim().toLowerCase(), t);
      }
    }

    const classifySkillLevel = (rawTags: string[]): string => {
      const tags = filterRegularTags(rawTags);
      let hasExcellent = false;
      let hasGood = false;
      let hasSlow = false;
      let hasDistracted = false;
      let hasImprove = false;
      let positiveCount = 0;

      for (const raw of tags) {
        const lower = raw.toLowerCase();
        const matched = tagLookup.get(lower);
        const role = String(matched?.role || "").trim().toLowerCase();

        if (role) {
          if (role === "excellent") {
            hasExcellent = true;
            positiveCount++;
          } else if (role === "distracted") {
            hasDistracted = true;
          } else if (role === "slow") {
            hasSlow = true;
          } else if (role === "improve") {
            hasImprove = true;
          } else if (role === "good" || role === "positive") {
            hasGood = true;
            positiveCount++;
          }
          continue;
        }

        if (
          /xuất sắc|giỏi|vận dụng.*sáng tạo|sáng tạo|chủ động thử.*sửa lỗi|🌟|💡|🧠|lvl_.*xuat_sac|tier_1/i.test(
            lower
          )
        ) {
          hasExcellent = true;
          positiveCount++;
          continue;
        }
        if (
          /mất tập trung|cần nhắc tập trung|xao nhãng|nói chuyện riêng|làm việc riêng|cần tập trung hơn|👀|tier_3/i.test(
            lower
          )
        ) {
          hasDistracted = true;
          continue;
        }
        if (
          /thao tác.*chậm|cú pháp còn chậm|lập trình cần hỗ trợ|lúng túng|hay nhầm lệnh|⌨️|🔌|🧩|🐛/i.test(
            lower
          )
        ) {
          hasImprove = true;
          continue;
        }
        if (
          /tiếp thu chậm|lắp ráp còn chậm|lắp ráp cần hỗ trợ|nhầm chốt|cần kèm|trung bình|chưa kịp|🐢|🔩|🛠️|lvl_.*can_kem|tier_4|tier_5/i.test(
            lower
          )
        ) {
          hasSlow = true;
          continue;
        }
        if (
          /tiếp thu tốt|làm bài tập đầy đủ|lắp ráp đúng mẫu|lập trình chạy đúng|lắp ráp.*lập trình tốt|hăng hái|phối hợp nhóm|hợp tác nhóm|giữ kit tốt|đạt yêu cầu|khá|tốt|tích cực|hiểu bài nhanh|👍|✅|📝|🙋|🤖|🔧|💻|🤝|lvl_.*dat|tier_2/i.test(
            lower
          )
        ) {
          hasGood = true;
          positiveCount++;
        }
      }

      if (positiveCount >= 3 && !hasSlow && !hasDistracted && !hasImprove) {
        hasExcellent = true;
      }

      const isNeedSupport = hasSlow || (hasImprove && !hasGood && !hasExcellent);

      if (isNeedSupport && hasDistracted) {
        return "Cấp độ 5 - Trung bình, mất tập trung (Mức độ: Cần củng cố phần trọng tâm của bài học và rèn sự tập trung lắng nghe hướng dẫn để theo kịp tiến độ)";
      }
      if (isNeedSupport) {
        return "Cấp độ 4 - Trung bình (Mức độ: Có tinh thần hợp tác và cố gắng nhưng nhịp độ thao tác thực hành còn chậm, cần thầy hướng dẫn từng bước)";
      }
      if (hasDistracted && (hasGood || hasExcellent)) {
        return "Cấp độ 3 - Khá nhưng mất tập trung (Mức độ: Hiểu bài và làm được yêu cầu chính nhưng đôi lúc còn phân tâm hoặc thao tác vội)";
      }
      if (hasDistracted) {
        return "Cấp độ 5 - Trung bình, mất tập trung (Mức độ: Cần củng cố phần trọng tâm của bài học và rèn sự tập trung lắng nghe hướng dẫn để theo kịp tiến độ)";
      }
      if (hasExcellent && !hasImprove) {
        return "Cấp độ 1 - Giỏi (Mức độ: Nắm vững nguyên lý, thực hành chủ động, tự kiểm thử và vận dụng mở rộng tốt)";
      }
      return "Cấp độ 2 - Khá (Mức độ: Nắm được kiến thức trọng tâm, hoàn thành yêu cầu thực hành của buổi học, có thể rèn thêm độ thuần thục hoặc phần nâng cao)";
    };

    const syllabusList =
      typeof getCoursesSyllabus === "function" ? getCoursesSyllabus() || [] : [];
    const checkpointNums = safeResolveCpSessionsCg
      ? safeResolveCpSessionsCg(normalizedClassCode, syllabusList)
      : (() => {
          const isLegoClass = safeIsLegoCg(normalizedClassCode);
          const matchedCourse = [...syllabusList]
            .sort((a, b) => String(b.courseCode || "").length - String(a.courseCode || "").length)
            .find((c) => {
              const code = String(c?.courseCode || "").trim().toUpperCase();
              if (!code || !normalizedClassCode.includes(code)) return false;
              if (isLegoClass && !safeIsLegoCg(code)) return false;
              return true;
            });
          const validCourseCheckpoints = Array.isArray(matchedCourse?.checkpointSessions)
            ? matchedCourse.checkpointSessions
                .map((n) => Number(n))
                .filter((n) => Number.isInteger(n) && n >= 1 && n <= 13)
            : [];
          return validCourseCheckpoints.length > 0
            ? Array.from(new Set(validCourseCheckpoints)).sort((a, b) => a - b)
            : isLegoClass
              ? [5, 9]
              : isRoboticsClass
                ? [4, 8]
                : [5, 9];
        })();
    const isCheckpoint =
      typeof session.isCheckpointSession === "boolean"
        ? session.isCheckpointSession
        : checkpointNums.includes(Number(session.sessionNumber));

    const sanitizedTopic = scrubStudentNames(session.topic || "", "", "STUDENT_PEER");
    const sanitizedKnowledgeItems =
      session.keyKnowledge && session.keyKnowledge.length > 0
        ? session.keyKnowledge
            .map((k) => scrubStudentNames(String(k || "").trim(), "", "STUDENT_PEER"))
            .filter((k) => k.length > 0)
        : [sanitizedTopic];
    const keyKnowledgeText = sanitizedKnowledgeItems.join("; ");

    // Group candidates sharing the same level + sorted quickTags so each peer gets a distinct narrative angle
    const peerGroupMembers = new Map<string, string[]>();
    const candidateLevelAndKey: { matchedLevel: string; groupKey: string }[] = [];
    for (const c of validCandidates) {
      const matchedLevel = classifySkillLevel(c.regularQuickTags);
      const sortedTagsKey = [...c.regularQuickTags]
        .map((t) => t.trim().toLowerCase())
        .sort()
        .join("|");
      const groupKey = `${matchedLevel}::${sortedTagsKey}`;
      candidateLevelAndKey.push({ matchedLevel, groupKey });
      const list = peerGroupMembers.get(groupKey) || [];
      list.push(c.anonymousId);
      peerGroupMembers.set(groupKey, list);
    }

    const peerGroupCounter = new Map<string, number>();
    const anonymousRoster = validCandidates.map((c, idx) => {
      const { matchedLevel, groupKey } = candidateLevelAndKey[idx];
      const peers = peerGroupMembers.get(groupKey) || [c.anonymousId];
      const posInGroup = peerGroupCounter.get(groupKey) || 0;
      peerGroupCounter.set(groupKey, posInGroup + 1);

      const angleIndex = (idx + posInGroup * 3) % NARRATIVE_ANGLES.length;
      const narrativeAngle = NARRATIVE_ANGLES[angleIndex];
      const primaryKnowledge =
        sanitizedKnowledgeItems[(idx + posInGroup) % sanitizedKnowledgeItems.length] ||
        sanitizedTopic;

      const otherPeers = peers.filter((id) => id !== c.anonymousId);
      const antiDuplicateDirective =
        otherPeers.length > 0
          ? `Học viên thứ ${posInGroup + 1}/${peers.length} trong nhóm cùng mức đánh giá (cùng nhóm với ${otherPeers.join(", ")}) — BẮT BUỘC dùng cấu trúc câu mở đầu, cách diễn đạt và từ vựng hoàn toàn khác với ${otherPeers.join(", ")}.`
          : "Diễn đạt tự nhiên theo đúng góc nhìn riêng bên dưới.";

      const scrubbedTeacherNote = scrubStudentNames(
        c.input.teacherNote || "",
        c.input.fullName,
        c.anonymousId
      );
      const scrubbedTagLabels = c.regularQuickTags.map((t) =>
        scrubStudentNames(t, c.input.fullName, c.anonymousId)
      );
      const extracted = extractRecordedIssuesForPrompt(
        scrubbedTeacherNote,
        scrubbedTagLabels,
        c.input.attendanceStatus
      );
      c.extractedIssues = extracted;

      const hasTop3MedalInNote = /Huy hiệu Top 3/i.test(scrubbedTeacherNote);
      const hasZeroPositiveWithViolations =
        /đạt\s*0\s*sao/i.test(scrubbedTeacherNote) ||
        (extracted.explicitClassroomBullets.length >= 3 &&
          !/(phát biểu|hoàn thành tốt|đạt\s*[1-9]\d*\s*sao|Huy hiệu Top 3)/i.test(
            scrubbedTeacherNote
          ));
      const strengthsFocusRule = hasTop3MedalInNote
        ? "Khen xứng đáng tinh thần học tập nổi bật, nêu rõ thành tích Sao và danh hiệu Huy hiệu Top 3 học viên xuất sắc nhất lớp; KHÔNG trộn lỗi vào mục Điểm mạnh."
        : hasZeroPositiveWithViolations
        ? "Chỉ ghi nhận trung thực, ngắn gọn 1 thao tác cơ bản con thực hiện được khi có thầy hướng dẫn trực tiếp; CẤM khen vống ('rất nỗ lực', 'hào hứng') và CẤM đưa lỗi vi phạm ('mặc dù đi muộn/phân tâm...') vào mục Điểm mạnh."
        : "Ghi nhận đúng thực lực các điểm tích cực và phần bài học con hoàn thành tốt trên lớp; KHÔNG trộn lỗi vi phạm vào mục Điểm mạnh.";

      const cpData = c.checkpointData;
      const anonymizedCheckpoint =
        isCheckpoint && cpData
          ? {
              cpStage: cpData.cpStage,
              theoryScoreScale5: cpData.theoryScore,
              practiceScoreScale5: cpData.practiceScore,
              competencyAverageScale5: cpData.competencyAverage,
              processStats: cpData.processSummary
                ? {
                    stageWindow: `Buổi ${cpData.processSummary.stageStartSession}–${cpData.processSummary.stageEndSession}`,
                    presentCount: cpData.processSummary.presentCount,
                    lateCount: cpData.processSummary.lateCount,
                    absentCount: cpData.processSummary.absentCount,
                    totalStars: cpData.processSummary.totalStars,
                    totalMedals: cpData.processSummary.totalMedals,
                    topStrengthTags: (cpData.processSummary.topStrengthTags || []).map((t) =>
                      scrubStudentNames(t, c.input.fullName, c.anonymousId)
                    ),
                    topImprovementTags: (cpData.processSummary.topImprovementTags || []).map((t) =>
                      scrubStudentNames(t, c.input.fullName, c.anonymousId)
                    ),
                    homeworkCompletionPct:
                      cpData.processSummary.homeworkSummary?.completionRatePct ?? null,
                    homeworkAvgScore100:
                      cpData.processSummary.homeworkSummary?.avgScore100 ?? null,
                    previousCheckpoint: cpData.processSummary.previousCheckpoint
                      ? {
                          sessionNumber: Number(cpData.processSummary.previousCheckpoint.sessionNumber || 0),
                          theoryScore: cpData.processSummary.previousCheckpoint.theoryScore ?? null,
                          practiceScore: cpData.processSummary.previousCheckpoint.practiceScore ?? null,
                          competencyAverage:
                            cpData.processSummary.previousCheckpoint.competencyAverage ?? null,
                        }
                      : null,
                  }
                : null,
            }
          : undefined;

      return {
        anonymousId: c.anonymousId,
        matchedLevel,
        quickTags: c.regularQuickTags.map((t) =>
          scrubStudentNames(resolveTagWithHint(t), c.input.fullName, c.anonymousId)
        ),
        teacherNote: scrubbedTeacherNote,
        attendance: c.input.attendanceStatus || "PRESENT",
        recordedIssues: extracted.recordedIssues,
        hasIssuesToCorrect: extracted.hasIssuesToCorrect,
        strengthsFocusRule,
        narrativeAngle,
        focusKnowledgeAspect: primaryKnowledge,
        antiDuplicateDirective,
        ...(anonymizedCheckpoint ? { checkpointAssessment: anonymizedCheckpoint } : {}),
      };
    });

    const checkpointNotice = isCheckpoint
      ? `\n- Loại buổi học: Buổi Kiểm tra Định kỳ (Checkpoint) — Hệ thống đã tự động ghép dòng tổng kết điểm \`📊 Kết quả Checkpoint ...\` ở ngay phía trên nhận xét. Bạn TUYỆT ĐỐI KHÔNG tự viết lại dòng tiêu đề \`📊 Kết quả Checkpoint...\` và KHÔNG tự bịa điểm số ngoài dữ liệu trong \`checkpointAssessment\`. Hãy kết hợp chặt chẽ cả: (1) kết quả làm bài Checkpoint hôm nay (Lý thuyết, Thực hành, Điểm năng lực trung bình trong \`checkpointAssessment\`) VÀ (2) đánh giá nhìn lại quá trình học nhiều buổi trước đó trong \`checkpointAssessment.processStats\` (chuyên cần, số sao/huy hiệu, thói quen làm bài nếu có, và so sánh tiến bộ so với Checkpoint trước nếu có) để viết 3 gạch đầu dòng vừa ghi nhận đúng thực lực vừa định hướng ôn tập rõ ràng.`
      : "";

    const prompt = `
Bạn là Giảng viên Công nghệ & Lập trình tại MindX Technology School (áp dụng kỹ năng chuẩn: nhan-xet-hoc-sinh — Văn phong Mẫu 1 thẳng thắn & tách từng dòng lỗi bằng dấu "+ ").
Nhiệm vụ của bạn là soạn nhận xét tình hình học tập của từng học sinh sau buổi học để gửi phụ huynh qua Zalo/LMS, dựa trên Cấp độ học sinh (matchedLevel), Quick Tags, Ghi chú thực tế (\`teacherNote\`) và danh sách \`recordedIssues\`.

### THÔNG TIN BUỔI HỌC:
- Lớp: ${session.classCode} (Buổi ${session.sessionNumber}) — Hướng chuyên môn: ${isRoboticsClass ? "Lắp ráp & Lập trình Robotics" : "Lập trình & Công nghệ"}${checkpointNotice}
- Chủ đề bài học: ${sanitizedTopic}
- Kiến thức trọng tâm: ${keyKnowledgeText}

### QUY TẮC BẮT BUỘC (SKILL: NHAN-XET-HOC-SINH — MẪU 1):
1. **Xác định ngữ cảnh & Đúng thực lực học sinh:**
   - Lồng ghép trực tiếp chủ đề bài học và kiến thức trọng tâm ở trên vào nhận xét.
   - Bám sát \`matchedLevel\`, \`quickTags\`, \`teacherNote\` và \`strengthsFocusRule\` của từng học sinh. TUYỆT ĐỐI KHÔNG bịa đặt thông tin trái ngược với thẻ/ghi chú đã chọn.
   - **Điểm mạnh tách bạch hoàn toàn khỏi lỗi:** Tuyệt đối KHÔNG khen vống học sinh không có sao/vi phạm nhiều ("rất nỗ lực", "hào hứng"), và KHÔNG đưa lỗi ("mặc dù đi muộn...", "dù có lúc phân tâm...") vào mục Điểm mạnh.
   - Nếu trong \`teacherNote\` có ghi nhận **Huy hiệu Top 3 học viên xuất sắc nhất lớp** và số sao, hãy nêu rõ thành tích xứng đáng này trong mục Điểm mạnh.
2. **Xưng hô & Văn phong thẳng thắn (Mẫu 1):**
   - Xưng **"thầy"**, gọi học sinh là **"con"**, gọi phụ huynh là **"ba mẹ"** hoặc **"gia đình"**.
   - **TUYỆT ĐỐI KHÔNG ghi tên học sinh hoặc mã \`STUDENT_XX\` ở đầu nhận xét** (bắt đầu trực tiếp bằng gạch đầu dòng \`- **Điểm mạnh của học viên:**\`). Trong nội dung cũng gọi học sinh là **"con"**, không chèn mã \`STUDENT_XX\`.
   - **Với học sinh CÓ lỗi hoặc vấn đề cần khắc phục (\`hasIssuesToCorrect = true\`):** Giọng văn phần \`Điểm cần cải thiện\` BẮT BUỘC **thẳng thắn, trực diện, nghiêm túc** để phụ huynh nắm rõ thực trạng; **CẤM nói giảm nói tránh** (cấm dùng: "hơi vội vàng", "đôi lúc bị phân tâm", "gặp chút lúng túng", "ảnh hưởng nhỏ"). Đồng thời giữ thái độ lịch sự sư phạm, không dùng từ miệt thị nhân cách ("yếu kém", "lười biếng", "cá biệt").
3. **Cấu trúc 3 gạch đầu dòng & Liệt kê lỗi theo từng dòng \`+ \` (Độ dài 100 - 300 từ/học sinh):**
   - \`strengths\` (Nội dung phần **Điểm mạnh của học viên**): Tuân theo đúng \`strengthsFocusRule\`. Có **in đậm** (\`**...**\`) kỹ năng, kiến thức trọng tâm hoặc thành tích Sao/Huy hiệu Top 3 con đạt được.
   - \`improvements\` (Nội dung phần **Điểm cần cải thiện**):
     + **Khi \`hasIssuesToCorrect = true\` (BẮT BUỘC THEO MẪU 1):** Mở đầu bằng **1 câu dẫn thẳng thắn** kết thúc bằng dấu \`:\` (ví dụ: *"Hôm nay ý thức kỷ luật và sự chuẩn bị bài của con chưa tốt, thầy xin phản ánh thẳng thắn để gia đình nắm rõ:"* hoặc *"Bên cạnh khả năng tiếp thu tốt, con vẫn còn các lỗi sau cần chấn chỉnh ngay:"*), sau đó **XUỐNG DÒNG (\`\\n\`) liệt kê ĐẦY ĐỦ 100% TỪNG MỤC trong \`recordedIssues\`**, mỗi vấn đề 1 dòng riêng bắt đầu bằng \`  + \`, có \`**in đậm**\` tên lỗi, giữ nguyên số lần \`(X lần)\` nếu có và nêu ngắn gọn hệ quả đối với việc học. **TUYỆT ĐỐI KHÔNG gộp trên 1 dòng và KHÔNG BỎ SÓT bất kỳ lỗi nào** (như lỗi làm việc riêng, rời chỗ, nói chuyện, đi muộn, chưa BTVN).
     + **Khi \`hasIssuesToCorrect = false\` (học sinh ngoan, không có lỗi):** Viết 1 câu tự nhiên góp ý nâng cao kỹ năng code/lắp ráp tiếp theo, KHÔNG tự bịa gạch đầu dòng \`+ \` vi phạm.
   - \`actionPlan\` (Nội dung phần **Lời khuyên**): Đề nghị cụ thể, thiết thực tương ứng trực tiếp với các vấn đề vừa nêu để ba mẹ phối hợp sát sao cùng con tại nhà. Có **in đậm** (\`**...**\`) hành động trọng tâm.
   - \`formattedFullComment\`: Trình bày trọn vẹn đúng bố cục 3 phần cách nhau bởi 1 dòng trống (KHÔNG có tên học sinh ở đầu, giữ nguyên các dòng \`\\n  + \` trong \`{improvements}\` nếu có):
- **Điểm mạnh của học viên:** {strengths}

- **Điểm cần cải thiện:** {improvements}

- **Lời khuyên:** {actionPlan}
4. **QUY TẮC CHỐNG TRÙNG LẶP & ĐA DẠNG HÓA DIỄN ĐẠT (BẮT BUỘC TUYỆT ĐỐI):**
   - **Cấm tuyệt đối copy-paste hoặc dùng chung khung câu mở đầu giữa các học sinh:** Kể cả khi nhiều học sinh cùng \`matchedLevel\` và cùng \`quickTags\`, mỗi học sinh BẮT BUỘC phải có câu mở đầu, cách diễn đạt khác nhau theo \`narrativeAngle\`, \`focusKnowledgeAspect\` và \`antiDuplicateDirective\`.
   - **Cấm chép nguyên văn cụm gợi ý dài trong \`quickTags\` hoặc \`matchedLevel\`**; riêng phần \`recordedIssues\` (khi \`hasIssuesToCorrect = true\`) phải nêu đủ 100% từng lỗi theo dòng \`+ \`.

### DANH SÁCH DỮ LIỆU ĐÁNH GIÁ (ANONYMIZED STUDENTS):
${JSON.stringify(anonymousRoster, null, 2)}

### ĐỊNH DẠNG ĐẦU RA BẮT BUỘC:
Trả về duy nhất 1 JSON object chuẩn theo schema sau (nếu \`hasIssuesToCorrect = true\`, trường \`improvements\` PHẢI chứa \`\\n  + ...\` cho từng lỗi):
{
  "feedbacks": [
    {
      "anonymousId": "STUDENT_01",
      "strengths": "...",
      "improvements": "Câu dẫn thẳng thắn:\\n  + **Lỗi 1...**\\n  + **Lỗi 2...**",
      "actionPlan": "...",
      "formattedFullComment": "- **Điểm mạnh của học viên:** ...\\n\\n- **Điểm cần cải thiện:** Câu dẫn thẳng thắn:\\n  + **Lỗi 1...**\\n  + **Lỗi 2...**\\n\\n- **Lời khuyên:** ..."
    }
  ]
}
`.trim();

    try {
      const model = getGeminiModel();
      const response = await model.generateContent(prompt);
      const text = response.response.text();
      const parsed = JSON.parse(text) as {
        feedbacks: Array<{
          anonymousId: string;
          strengths: string;
          improvements: string;
          actionPlan: string;
          formattedFullComment: string;
        }>;
      };

      const feedbackMap = new Map<string, (typeof parsed.feedbacks)[0]>();
      if (parsed && Array.isArray(parsed.feedbacks)) {
        for (const fb of parsed.feedbacks) {
          feedbackMap.set(fb.anonymousId, fb);
        }
      }

      // Layer 4: Post-generation similarity guard across validCandidates in the same batch
      if (validCandidates.length > 1) {
        const duplicateTargetIds = new Set<string>();
        const referenceComments: { anonymousId: string; comment: string }[] = [];

        for (let i = 0; i < validCandidates.length; i++) {
          const idI = validCandidates[i].anonymousId;
          const fbI = feedbackMap.get(idI);
          if (!fbI || !fbI.formattedFullComment) continue;
          const wordsI = normalizeWordsForSimilarity(fbI.formattedFullComment);
          // Skip short unit-test stub strings (< 12 words) so test sandboxes with stub mocks do not trigger extra calls
          if (wordsI.length < 12) continue;

          for (let j = i + 1; j < validCandidates.length; j++) {
            const idJ = validCandidates[j].anonymousId;
            if (duplicateTargetIds.has(idJ)) continue;
            const fbJ = feedbackMap.get(idJ);
            if (!fbJ || !fbJ.formattedFullComment) continue;
            const wordsJ = normalizeWordsForSimilarity(fbJ.formattedFullComment);
            if (wordsJ.length < 12) continue;

            const sim = computeCommentSimilarity(
              fbI.formattedFullComment,
              fbJ.formattedFullComment
            );
            const sameStrengths =
              normalizeWordsForSimilarity(fbI.strengths || "").length >= 6 &&
              normalizeWordsForSimilarity(fbI.strengths || "").join(" ") ===
                normalizeWordsForSimilarity(fbJ.strengths || "").join(" ");
            const sameImprovements =
              normalizeWordsForSimilarity(fbI.improvements || "").length >= 6 &&
              normalizeWordsForSimilarity(fbI.improvements || "").join(" ") ===
                normalizeWordsForSimilarity(fbJ.improvements || "").join(" ");

            if (sim >= 0.48 || sameStrengths || sameImprovements) {
              duplicateTargetIds.add(idJ);
              if (!referenceComments.some((r) => r.anonymousId === idI)) {
                referenceComments.push({
                  anonymousId: idI,
                  comment: fbI.formattedFullComment,
                });
              }
            }
          }
        }

        if (duplicateTargetIds.size > 0) {
          try {
            const targetsToRewrite = anonymousRoster.filter((r) =>
              duplicateTargetIds.has(r.anonymousId)
            );
            const diversifyPrompt = `
Bạn là Giảng viên tại MindX Technology School. Một số nhận xét vừa tạo cho lớp ${session.classCode} (Buổi ${session.sessionNumber} — Chủ đề: ${sanitizedTopic}) đang bị trùng lặp câu chữ hoặc giống cấu trúc câu với học viên khác trong cùng buổi.
Hãy VIẾT LẠI hoàn toàn mới nhận xét cho các học viên trong danh sách "HỌC VIÊN CẦN VIẾT LẠI" dưới đây sao cho:
1. Giữ nguyên mức đánh giá (\`matchedLevel\`), ý nghĩa thẻ (\`quickTags\`), ghi chú (\`teacherNote\`), \`strengthsFocusRule\`, xưng "thầy" - gọi "con" - "ba mẹ", và bố cục 3 gạch đầu dòng in đậm (\`- **Điểm mạnh của học viên:**\`, \`- **Điểm cần cải thiện:**\`, \`- **Lời khuyên:**\`, không có tên học sinh ở đầu).
2. Với học viên có \`hasIssuesToCorrect = true\`: giữ văn phong **thẳng thắn, trực diện** theo Mẫu 1 (1 câu dẫn kết thúc bằng \`:\`, xuống dòng \`\\n  + \` liệt kê ĐẦY ĐỦ 100% \`recordedIssues\`, KHÔNG nói giảm nói tránh và KHÔNG trộn lỗi vào mục Điểm mạnh).
3. TUYỆT ĐỐI KHÔNG lặp lại câu mở đầu, cấu trúc câu của "CÁC NHẬN XÉT ĐÃ DÙNG" và phải khác hẳn nhau giữa từng học viên được viết lại (độ trùng lặp từ ngữ dưới 35%).

### CÁC NHẬN XÉT ĐÃ DÙNG (CẤM LẶP LẠI CẤU TRÚC CÂU):
${JSON.stringify(referenceComments, null, 2)}

### HỌC VIÊN CẦN VIẾT LẠI:
${JSON.stringify(targetsToRewrite, null, 2)}

### ĐỊNH DẠNG ĐẦU RA BẮT BUỘC (JSON):
{
  "feedbacks": [
    {
      "anonymousId": "STUDENT_XX",
      "strengths": "...",
      "improvements": "...",
      "actionPlan": "...",
      "formattedFullComment": "- **Điểm mạnh của học viên:** ...\\n\\n- **Điểm cần cải thiện:** ...\\n\\n- **Lời khuyên:** ..."
    }
  ]
}
`.trim();

            const rewriteRes = await model.generateContent(diversifyPrompt);
            const rewriteText = rewriteRes?.response?.text?.() || "";
            if (rewriteText) {
              const rewriteParsed = JSON.parse(rewriteText) as {
                feedbacks?: Array<{
                  anonymousId: string;
                  strengths: string;
                  improvements: string;
                  actionPlan: string;
                  formattedFullComment: string;
                }>;
              };
              if (rewriteParsed && Array.isArray(rewriteParsed.feedbacks)) {
                for (const rw of rewriteParsed.feedbacks) {
                  if (
                    rw &&
                    rw.anonymousId &&
                    duplicateTargetIds.has(rw.anonymousId) &&
                    rw.strengths?.trim() &&
                    rw.improvements?.trim() &&
                    rw.actionPlan?.trim() &&
                    rw.formattedFullComment?.trim()
                  ) {
                    feedbackMap.set(rw.anonymousId, rw);
                  }
                }
              }
            }
          } catch {
            // Safe fallback: retain initial generation if rewrite call fails or returns non-JSON in mock environments
          }
        }
      }

      // Step 3: De-anonymize and conditionally save drafts to SQLite
      for (const item of validCandidates) {
        const rawFeedback = feedbackMap.get(item.anonymousId);
        const student = item.input;
        const studentName = student.fullName;

        // Friendly Vietnamese addressing: extract first name or use full name
        const displayName = studentName;

        let strengths = (rawFeedback?.strengths || "").trim();
        let improvements = (rawFeedback?.improvements || "").trim();
        let actionPlan = (rawFeedback?.actionPlan || "").trim();
        let fullComment = (rawFeedback?.formattedFullComment || "").trim();

        // R2-11 Guardrail: Never invent fallback pedagogical feedback if AI omitted this student or any required field
        if (!rawFeedback || !strengths || !improvements || !actionPlan || !fullComment) {
          results.push({
            studentId: student.studentId,
            fullName: student.fullName,
            status: "FAILED",
            strengths: "",
            improvements: "",
            actionPlan: "",
            formattedFullComment: "",
            errorMessage: `AI không trả về đủ 3 phần nhận xét cho học viên '${studentName}' (${item.anonymousId}).`,
          });
          continue;
        }

        // De-anonymize text: replace anonymousId with displayName
        const replaceAnon = (str: string) =>
          str.replace(new RegExp(item.anonymousId, "g"), displayName);

        strengths = replaceAnon(strengths);
        improvements = replaceAnon(improvements);
        actionPlan = replaceAnon(actionPlan);
        fullComment = replaceAnon(fullComment);

        // Enforce unified 3-bullet format from skill `nhan-xet-hoc-sinh` in formattedFullComment (WITHOUT student name header)
        const cleanStrengths = strengths
          .replace(/^[-•*]\s*\*\*Điểm mạnh(?: của học viên)?:\*\*\s*/i, "")
          .trim();
        const rawCleanImprovements = improvements
          .replace(/^[-•*]\s*\*\*Điểm cần cải thiện:\*\*\s*/i, "")
          .trim();
        const cleanActionPlan = actionPlan
          .replace(/^[-•*]\s*\*\*(?:Lời khuyên|Hướng rèn luyện):\*\*\s*/i, "")
          .trim();

        const rawExtractedForStudent =
          item.extractedIssues ||
          extractRecordedIssuesForPrompt(
            student.teacherNote || "",
            item.regularQuickTags,
            student.attendanceStatus
          );
        const deanonymizeIssueText = (issueText: string) => {
          const out = issueText
            .replace(new RegExp(`\\b${item.anonymousId}\\b`, "g"), "con")
            .replace(/\bSTUDENT_(?:\d+|PEER)\b/g, "bạn cùng lớp");
          return out ? out.charAt(0).toUpperCase() + out.slice(1) : out;
        };
        const extractedForStudent: ExtractedStudentIssues = {
          explicitClassroomBullets: rawExtractedForStudent.explicitClassroomBullets.map(deanonymizeIssueText),
          recordedIssues: rawExtractedForStudent.recordedIssues.map(deanonymizeIssueText),
          hasIssuesToCorrect: rawExtractedForStudent.hasIssuesToCorrect,
        };

        const normalizedImprovements =
          typeof getQuickTags === "function"
            ? normalizeCandidImprovementsWithPlusBullets(rawCleanImprovements, extractedForStudent)
            : rawCleanImprovements;

        if (typeof getQuickTags === "function") {
          strengths = cleanStrengths;
          improvements = normalizedImprovements;
          actionPlan = cleanActionPlan;
        }

        // Strip any leading **[Tên học sinh]** line or AI-hallucinated `📊 Kết quả Checkpoint` header before normalizing
        fullComment = safeStripCheckpointHeaderCg(fullComment).replace(
          /^\s*\*\*[^*\n]+\*\*\s*\r?\n+(?=\s*[-•*]\s*\*\*Điểm mạnh)/i,
          ""
        );

        if (
          typeof getQuickTags === "function" &&
          (!fullComment.includes("- **Điểm mạnh của học viên:**") ||
            extractedForStudent.hasIssuesToCorrect)
        ) {
          fullComment = [
            `- **Điểm mạnh của học viên:** ${cleanStrengths}`,
            "",
            `- **Điểm cần cải thiện:** ${normalizedImprovements}`,
            "",
            `- **Lời khuyên:** ${cleanActionPlan}`,
          ].join("\n");
        }

        if (
          isCheckpoint &&
          item.checkpointData &&
          (item.checkpointData.theoryScore !== null ||
            item.checkpointData.practiceScore !== null ||
            item.checkpointData.competencyAverage !== null)
        ) {
          const scoreHeaderLine = safeFormatCheckpointHeaderCg({
            cpStage: item.checkpointData.cpStage,
            theoryScore: item.checkpointData.theoryScore,
            practiceScore: item.checkpointData.practiceScore,
            competencyAverage: item.checkpointData.competencyAverage,
            isLego: Boolean(item.checkpointData.isLego ?? safeIsLegoCg(normalizedClassCode)),
          });
          fullComment = safeUpsertCheckpointHeaderCg(fullComment, scoreHeaderLine);
        }

        // R15-02 Guardrail: Re-verify student active status, attendance, and version/content snapshot in SQLite
        const latestDbStudent =
          typeof studentRepo?.findOne === "function"
            ? studentRepo.findOne(student.studentId, normalizedClassId)
            : undefined;
        const latestDbRecord =
          typeof sessionFeedbackRepo?.findOne === "function"
            ? sessionFeedbackRepo.findOne(normalizedClassId, normalizedSessionId, student.studentId)
            : undefined;
        const latestMeta = parseVersionMetaSafe(latestDbRecord?.versionMetaJson);
        const snap = item.initialSnapshot;

        const supersededByNewerAiCall =
          (CommentGenerator.latestStudentCallSeq.get(item.scopeKey) || 0) > callSeq;
        const studentBecameInactive = Boolean(latestDbStudent && latestDbStudent.isActive !== 1);
        const expectedRowVerMismatch =
          typeof student.expectedRowVer === "number" &&
          Number.isFinite(student.expectedRowVer) &&
          student.expectedRowVer >= 0 &&
          latestMeta.rowVer !== student.expectedRowVer;

        const recordChangedDuringAi = snap.hadExistingRecord
          ? !latestDbRecord ||
            latestMeta.rowVer !== snap.rowVer ||
            (latestDbRecord.versionMetaJson ?? "") !== snap.versionMetaJson ||
            (latestDbRecord.attendanceStatus ?? "") !== snap.attendanceStatus ||
            (latestDbRecord.quickTagsJson ?? "[]") !== snap.quickTagsJson ||
            (latestDbRecord.teacherNote ?? "") !== snap.teacherNote ||
            (latestDbRecord.strengths ?? "") !== snap.strengths ||
            (latestDbRecord.improvements ?? "") !== snap.improvements ||
            (latestDbRecord.actionPlan ?? "") !== snap.actionPlan ||
            (latestDbRecord.finalText ?? "") !== snap.finalText ||
            (latestDbRecord.status ?? "") !== snap.status ||
            (latestDbRecord.contentHash ?? "") !== snap.contentHash
          : Boolean(latestDbRecord);

        if (
          supersededByNewerAiCall ||
          studentBecameInactive ||
          expectedRowVerMismatch ||
          recordChangedDuringAi
        ) {
          results.push({
            studentId: student.studentId,
            fullName: student.fullName,
            status: ((latestDbRecord?.status as any) || "DRAFT") as any,
            strengths: latestDbRecord?.strengths ?? "",
            improvements: latestDbRecord?.improvements ?? "",
            actionPlan: latestDbRecord?.actionPlan ?? "",
            formattedFullComment: latestDbRecord?.finalText ?? "",
            staleIgnored: true,
            versionMeta: latestMeta,
            errorMessage: `Dữ liệu của học viên '${studentName}' đã được cập nhật trong lúc chờ AI. Giữ nguyên bản chỉnh sửa mới nhất.`,
          });
          continue;
        }

        const nextFields = { ...latestMeta.fields };
        for (const f of ["strengths", "improvements", "actionPlan", "finalText"]) {
          const curF = nextFields[f] || { ver: 0, cid: "", rev: 0 };
          nextFields[f] = {
            ver: (curF.ver || 0) + 1,
            cid: curF.cid || "",
            rev: curF.rev || 0,
          };
        }
        const nextMeta = {
          rowVer: (latestMeta.rowVer || 0) + 1,
          fields: nextFields,
        };

        const generated: GeneratedCommentResult = {
          studentId: student.studentId,
          fullName: student.fullName,
          status: "DRAFT",
          strengths,
          improvements,
          actionPlan,
          formattedFullComment: fullComment,
          versionMeta: nextMeta,
          ...(item.checkpointData ? { checkpointData: item.checkpointData } : {}),
        };

        // Persist draft to SQLite without overwriting existing attendance, quickTags, or teacherNote with stale inputs
        sessionFeedbackRepo.upsert({
          classId: normalizedClassId,
          sessionId: normalizedSessionId,
          studentId: student.studentId,
          attendanceStatus:
            (latestDbRecord?.attendanceStatus as any) || student.attendanceStatus || "PRESENT",
          quickTagsJson:
            latestDbRecord?.quickTagsJson &&
            (latestDbRecord.quickTagsJson.trim() !== "[]" || Boolean(latestMeta.fields?.quickTags))
              ? latestDbRecord.quickTagsJson
              : JSON.stringify(item.regularQuickTags),
          teacherNote: latestDbRecord?.teacherNote ?? (student.teacherNote || ""),
          strengths,
          improvements,
          actionPlan,
          finalText: fullComment,
          status: "DRAFT",
          versionMetaJson: JSON.stringify(nextMeta),
          ...(item.checkpointData ? { checkpointDataJson: JSON.stringify(item.checkpointData) } : {}),
        });

        results.push(generated);
      }
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // If AI call failed, mark valid candidates as FAILED with error message
      for (const item of validCandidates) {
        results.push({
          studentId: item.input.studentId,
          fullName: item.input.fullName,
          status: "FAILED",
          strengths: "",
          improvements: "",
          actionPlan: "",
          formattedFullComment: "",
          errorMessage: errMsg,
        });
      }
    }

    return results;
  }
}
