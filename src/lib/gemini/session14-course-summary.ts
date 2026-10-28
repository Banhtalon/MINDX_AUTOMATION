/**
 * MINDX AUTOMATION BOT - SESSION 14 COURSE FINAL EVALUATION GENERATOR (v2.9.0)
 * Generates the 3-part "Thư từ MindX" (Nhận xét học sinh - Buổi 14 Tổng kết cuối khóa):
 * 1. Learned From Mindx (Opening greeting -> Về kiến thức chuyên môn -> Kết quả đánh giá [Điểm Demo + Điểm Năng lực] -> Về kỹ năng mềm -> Nhận xét cá nhân + Lời chúc MindX)
 * 2. Suggestions From Mindx (2-3 sentences of actionable advice)
 * 3. Future Direction (3-4 sentences on subject potential & readiness for the next advanced course)
 *
 * Follows the exact real MindX teacher style (Mccully Mac Dallas sample),
 * with strict PII anonymization (`STUDENT_FULL_XX`, `STUDENT_SHORT_XX`) and TypeScript-injected scores.
 */

import {
  calculateCompetencyAverageScore,
  calculateDemoTotalScore, isRoboticsClassCode,
  parseSession14CompetencyScores,
  parseSession14DemoScores,
  session14EvalRepo,
  sessionFeedbackRepo,
  spckSessionRepo,
  studentRepo,
  type SpckSession14CompetencyScores,
  type SpckSession14DemoScores,
  type SpckSession14EvaluationRecord,
} from "../db/sqlite";
import { detectCoursePrefixFromClassId } from "../playwright/spck-drive-uploader";
import { getGeminiModel } from "./client";
import { formatSpckStudentCallName } from "./spck-comment";

export interface Session14EvalStudentInput {
  studentId: string;
  fullName: string;
  expectedVersion?: number;
  competencyScores?: Partial<SpckSession14CompetencyScores>;
  demoScores?: Partial<SpckSession14DemoScores>;
  quickTags?: string[];
  teacherNote?: string;
}

export interface Session14EvalAiResultItem {
  studentId: string;
  fullName: string;
  status: "SUCCESS" | "INSUFFICIENT_INFO" | "CONFLICT" | "ERROR";
  learnedFromMindx: string;
  suggestionsFromMindx: string;
  futureDirection: string;
  demoTotalScore: number;
  competencyTotalScore: number;
  anonymizedFullToken: string;
  anonymizedShortToken: string;
  outboundPromptSample?: string;
  preservedExisting?: boolean;
  draftVersion?: number;
  errorMessage?: string;
  record?: SpckSession14EvaluationRecord;
}

const COURSE_PROGRESSION_MAP: Record<
  string,
  { currentCourseLabel: string; nextCourseLabel: string; domainKeywords: string }
> = {
  JSB: {
    currentCourseLabel: "Lập trình Web cơ bản (Web Developer - Basic / JSB)",
    nextCourseLabel: "khóa học Lập trình Web nâng cao (JSA)",
    domainKeywords: "HTML, CSS, Flexbox và JavaScript cơ bản",
  },
  JSA: {
    currentCourseLabel: "Lập trình Web nâng cao (Web Developer - Advanced / JSA)",
    nextCourseLabel: "khóa học Lập trình Web chuyên sâu (JSI)",
    domainKeywords: "JavaScript nâng cao, xử lý dữ liệu API và xây dựng ứng dụng Web tương tác",
  },
  JSI: {
    currentCourseLabel: "Lập trình Web chuyên sâu (Web Developer - Intensive / JSI)",
    nextCourseLabel: "các khóa học phát triển phần mềm và dự án công nghệ chuyên sâu tiếp theo",
    domainKeywords: "kiến trúc ứng dụng Web toàn diện, cơ sở dữ liệu và triển khai sản phẩm thực tế",
  },
  PTB: {
    currentCourseLabel: "Lập trình Ứng dụng cơ bản (App Producer - Basic / PTB)",
    nextCourseLabel: "khóa học Lập trình Ứng dụng nâng cao (PTA)",
    domainKeywords: "ngôn ngữ Python và xây dựng giao diện ứng dụng",
  },
  PTA: {
    currentCourseLabel: "Lập trình Ứng dụng nâng cao (App Producer - Advanced / PTA)",
    nextCourseLabel: "khóa học Lập trình Ứng dụng chuyên sâu (PTI)",
    domainKeywords: "lập trình hướng đối tượng Python, giao diện PyQt6 và xử lý sự kiện",
  },
  PTI: {
    currentCourseLabel: "Lập trình Ứng dụng chuyên sâu (App Producer - Intensive / PTI)",
    nextCourseLabel: "các khóa học Khoa học Máy tính hoặc Phát triển Web nâng cao tiếp theo",
    domainKeywords: "kiến trúc ứng dụng Python hoàn chỉnh và quản lý dữ liệu",
  },
  SB: {
    currentCourseLabel: "Lập trình Sáng tạo cơ bản (Scratch Creator - Basic / SB)",
    nextCourseLabel: "khóa học Lập trình Sáng tạo nâng cao (SA)",
    domainKeywords: "tư duy khối lệnh, kịch bản nhân vật và sự kiện tương tác",
  },
  SA: {
    currentCourseLabel: "Lập trình Sáng tạo nâng cao (Scratch Creator - Advanced / SA)",
    nextCourseLabel: "khóa học Lập trình Sáng tạo chuyên sâu (SI)",
    domainKeywords: "biến số, điều kiện, vòng lặp và thiết kế trò chơi đa màn",
  },
  SI: {
    currentCourseLabel: "Lập trình Sáng tạo chuyên sâu (Scratch Creator - Intensive / SI)",
    nextCourseLabel: "lộ trình Lập trình Game (Game Maker) hoặc Khoa học Máy tính tiếp theo",
    domainKeywords: "thuật toán điều khiển nhân vật và hoàn thiện sản phẩm sáng tạo",
  },
  GB: {
    currentCourseLabel: "Lập trình Game cơ bản (Game Maker - Basic / GB)",
    nextCourseLabel: "khóa học Lập trình Game nâng cao (GA)",
    domainKeywords: "thiết kế nhân vật, cảnh chơi (room), va chạm và sự kiện trong Game",
  },
  GA: {
    currentCourseLabel: "Lập trình Game nâng cao (Game Maker - Advanced / GA)",
    nextCourseLabel: "khóa học Lập trình Game chuyên sâu (GI)",
    domainKeywords: "logic điều khiển nâng cao, hệ thống điểm số và kịch bản màn chơi",
  },
  GI: {
    currentCourseLabel: "Lập trình Game chuyên sâu (Game Maker - Intensive / GI)",
    nextCourseLabel: "lộ trình Lập trình Ứng dụng Python (PTB) hoặc Web (JSB) tiếp theo",
    domainKeywords: "xây dựng cơ chế gameplay hoàn chỉnh và tối ưu trải nghiệm người chơi",
  },
  CSB: {
    currentCourseLabel: "Khoa học Máy tính cơ bản (Computer Scientist - Basic / CSB)",
    nextCourseLabel: "khóa học Khoa học Máy tính nâng cao (CSA)",
    domainKeywords: "tư duy thuật toán, cấu trúc điều khiển và lập trình Python",
  },
  CSA: {
    currentCourseLabel: "Khoa học Máy tính nâng cao (Computer Scientist - Advanced / CSA)",
    nextCourseLabel: "khóa học Khoa học Máy tính chuyên sâu (CSI)",
    domainKeywords: "cấu trúc dữ liệu, lập trình hướng đối tượng và giải quyết bài toán",
  },
  CSI: {
    currentCourseLabel: "Khoa học Máy tính chuyên sâu (Computer Scientist - Intensive / CSI)",
    nextCourseLabel: "các khóa học Công nghệ và Dự án phần mềm nâng cao tiếp theo",
    domainKeywords: "thuật toán nâng cao, xử lý dữ liệu và phát triển dự án hoàn chỉnh",
  },
};

function getCourseProgressionInfo(classId: string) {
  const prefix = detectCoursePrefixFromClassId(classId);
  if (prefix && COURSE_PROGRESSION_MAP[prefix]) {
    return COURSE_PROGRESSION_MAP[prefix];
  }
  return {
    currentCourseLabel: `khóa học Lập trình & Công nghệ (${classId})`,
    nextCourseLabel: "khóa học nâng cao tiếp theo tại MindX",
    domainKeywords: "kiến thức lập trình, tư duy thuật toán và xây dựng sản phẩm thực tế",
  };
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripVietnameseAccents(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFC");
}

function replaceWholeNamePhrase(text: string, phrase: string, token: string): string {
  const trimmed = phrase.trim().replace(/\s+/g, " ");
  if (trimmed.length < 1) return text;
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])${escapeRegExp(trimmed)}(?![\\p{L}\\p{N}_])`,
    "giu"
  );
  return text.replace(pattern, token);
}

export function anonymizeSession14Text(
  rawText: string,
  fullName: string,
  callName: string,
  fullToken: string,
  shortToken: string,
  peerNames: string[] = []
): string {
  if (!rawText) return "";
  let result = rawText.normalize("NFC");

  const cleanFull = String(fullName || "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ");
  const cleanCall = (
    String(callName || "").normalize("NFC").trim() || formatSpckStudentCallName(cleanFull)
  ).replace(/\s+/g, " ");
  const fullWords = cleanFull.split(" ").filter(Boolean);
  const singleGiven = fullWords.length > 0 ? fullWords[fullWords.length - 1] : "";

  type ReplacementCandidate = {
    phrase: string;
    token: string;
    wordCount: number;
    priority: number;
  };
  const candidates: ReplacementCandidate[] = [];
  const seen = new Set<string>();

  const addCandidate = (phrase: string, token: string, priority: number) => {
    const trimmed = String(phrase || "")
      .normalize("NFC")
      .trim()
      .replace(/\s+/g, " ");
    if (!trimmed) return;
    const dedupeKey = trimmed.toLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    const wordCount = trimmed.split(" ").filter(Boolean).length;
    candidates.push({ phrase: trimmed, token, wordCount, priority });
  };

  if (cleanFull) {
    addCandidate(cleanFull, fullToken, 100);
    const asciiFull = stripVietnameseAccents(cleanFull);
    if (asciiFull.toLowerCase() !== cleanFull.toLowerCase()) {
      addCandidate(asciiFull, fullToken, 99);
    }
  }

  for (const peer of peerNames) {
    const cleanPeer = String(peer || "")
      .normalize("NFC")
      .trim()
      .replace(/\s+/g, " ");
    if (!cleanPeer || cleanPeer.toLowerCase() === cleanFull.toLowerCase()) continue;
    addCandidate(cleanPeer, "PEER_STUDENT", 95);
    const asciiPeer = stripVietnameseAccents(cleanPeer);
    if (asciiPeer.toLowerCase() !== cleanPeer.toLowerCase()) {
      addCandidate(asciiPeer, "PEER_STUDENT", 94);
    }
  }

  if (cleanCall && cleanCall.toLowerCase() !== cleanFull.toLowerCase()) {
    addCandidate(cleanCall, shortToken, 80);
    const asciiCall = stripVietnameseAccents(cleanCall);
    if (asciiCall.toLowerCase() !== cleanCall.toLowerCase()) {
      addCandidate(asciiCall, shortToken, 79);
    }
  }

  for (const peer of peerNames) {
    const cleanPeer = String(peer || "")
      .normalize("NFC")
      .trim()
      .replace(/\s+/g, " ");
    if (!cleanPeer || cleanPeer.toLowerCase() === cleanFull.toLowerCase()) continue;
    const peerCall = formatSpckStudentCallName(cleanPeer);
    const peerWords = cleanPeer.split(" ").filter(Boolean);
    const peerPrefix2 = peerWords.length >= 3 ? peerWords.slice(0, 2).join(" ") : "";

    if (peerCall && peerCall.toLowerCase() !== cleanCall.toLowerCase()) {
      addCandidate(peerCall, "PEER_STUDENT", 75);
      const asciiPeerCall = stripVietnameseAccents(peerCall);
      if (asciiPeerCall.toLowerCase() !== peerCall.toLowerCase()) {
        addCandidate(asciiPeerCall, "PEER_STUDENT", 74);
      }
    }
    if (peerPrefix2 && peerPrefix2.toLowerCase() !== cleanCall.toLowerCase()) {
      addCandidate(peerPrefix2, "PEER_STUDENT", 73);
      const asciiPrefix2 = stripVietnameseAccents(peerPrefix2);
      if (asciiPrefix2.toLowerCase() !== peerPrefix2.toLowerCase()) {
        addCandidate(asciiPrefix2, "PEER_STUDENT", 72);
      }
    }
  }

  if (
    singleGiven.length >= 1 &&
    singleGiven.toLowerCase() !== cleanFull.toLowerCase() &&
    singleGiven.toLowerCase() !== cleanCall.toLowerCase()
  ) {
    addCandidate(singleGiven, shortToken, 50);
    const asciiGiven = stripVietnameseAccents(singleGiven);
    if (asciiGiven.toLowerCase() !== singleGiven.toLowerCase()) {
      addCandidate(asciiGiven, shortToken, 49);
    }
  }

  for (const peer of peerNames) {
    const cleanPeer = String(peer || "")
      .normalize("NFC")
      .trim()
      .replace(/\s+/g, " ");
    if (!cleanPeer || cleanPeer.toLowerCase() === cleanFull.toLowerCase()) continue;
    const peerWords = cleanPeer.split(" ").filter(Boolean);
    const peerGiven = peerWords.length > 0 ? peerWords[peerWords.length - 1] : "";
    if (peerGiven.length >= 1 && peerGiven.toLowerCase() !== singleGiven.toLowerCase()) {
      addCandidate(peerGiven, "PEER_STUDENT", 45);
      const asciiPeerGiven = stripVietnameseAccents(peerGiven);
      if (asciiPeerGiven.toLowerCase() !== peerGiven.toLowerCase()) {
        addCandidate(asciiPeerGiven, "PEER_STUDENT", 44);
      }
    }
  }

  candidates.sort((a, b) => {
    if (b.wordCount !== a.wordCount) return b.wordCount - a.wordCount;
    if (b.phrase.length !== a.phrase.length) return b.phrase.length - a.phrase.length;
    return b.priority - a.priority;
  });

  for (const c of candidates) {
    result = replaceWholeNamePhrase(result, c.phrase, c.token);
  }

  return result;
}

export function deAnonymizeSession14Text(
  text: string,
  fullToken: string,
  shortToken: string,
  fullName: string,
  callName: string
): string {
  if (!text) return "";
  return text
    .replace(new RegExp(escapeRegExp(fullToken), "gi"), fullName)
    .replace(new RegExp(escapeRegExp(shortToken), "gi"), callName);
}

function formatScoreDisplay(score: number): string {
  const rounded = Math.round((Number(score) || 0) * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

const COMPOUND_AFTER_THAY_CO_REGEX =
  /^\s+(?:lập|đọng|đặc|tích|giản|ơn|đơn|gái|dâu|tiên|bé|chủ|nhân|vụ|tế|thuốc|bói|tu|chùa|đồ|cúng|lang|pháp|địa|công)\b/iu;

/**
 * Replaces teacher self-references ("thầy/cô", "thầy cô", "thầy", "cô") with "giáo viên" / "Giáo viên".
 */
export function normalizeTeacherSelfReferenceToGiaoVien(rawText: string): string {
  if (!rawText) return "";
  let text = rawText
    .replace(/\bthầy\s*\/\s*cô\b/giu, (m) =>
      m[0] === m[0].toUpperCase() ? "Giáo viên" : "giáo viên"
    )
    .replace(/\bthầy\s+cô\b/giu, (m) =>
      m[0] === m[0].toUpperCase() ? "Giáo viên" : "giáo viên"
    );

  text = text.replace(
    /(?<![\p{L}\p{N}_])(Thầy|thầy|Cô|cô)(?![\p{L}\p{N}_])/gu,
    (match, _word, offset, fullStr) => {
      const after = String(fullStr).slice(Number(offset) + match.length);
      if (COMPOUND_AFTER_THAY_CO_REGEX.test(after)) {
        return match;
      }
      const before = String(fullStr).slice(0, Number(offset));
      const isSentenceStart =
        before.trim().length === 0 || /[.!?:\n]\s*$/u.test(before);
      const isCapitalized = match[0] === match[0].toUpperCase();
      return isSentenceStart && isCapitalized ? "Giáo viên" : "giáo viên";
    }
  );

  return text;
}

/**
 * Strips any accidental opening greeting ("Kính gửi Quý Phụ huynh...", "MindX xin gửi đến...")
 * or closing MindX wish ("MindX ghi nhận sự nỗ lực... Chúc em tiếp tục...") from generated paragraphs.
 */
export function stripRedundantLetterHeaderAndFooter(rawText: string): string {
  if (!rawText) return "";
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((line) => {
      if (!line) return false;
      if (/^kính\s+gửi\s+quý\s+phụ\s+huynh/iu.test(line)) return false;
      if (/^mindx\s+xin\s+gửi\s+đến\s+quý\s+phụ\s+huynh/iu.test(line)) return false;
      if (/^mindx\s+ghi\s+nhận\s+sự\s+nỗ\s+lực/iu.test(line)) return false;
      return true;
    });
  return lines
    .join("\n")
    .replace(
      /\s*MindX\s+ghi\s+nhận\s+sự\s+nỗ\s+lực[^]*?khám\s+phá\s+công\s+nghệ\s+trong\s+tương\s+lai\.?\s*$/iu,
      ""
    )
    .trim();
}

/**
 * When a student's in-class attitude rating (`attitudeInClass`) is high (4 or 5) and no distraction tag/note was given,
 * rewrites any generic AI claim about losing focus / needing to maintain concentration in class into technical coding advice.
 */
export function sanitizeFocusClaimsWhenAttitudeHigh(
  rawText: string,
  allowFocusCritique: boolean
): string {
  if (!rawText || allowFocusCritique) return rawText;
  return rawText
    .replace(
      /đôi\s+lúc\s+vẫn\s+cần\s+chú\s+ý\s+hơn\s+để\s+duy\s+trì\s+sự\s+tập\s+trung\s+xuyên\s+suốt\s+buổi\s+học(?:\s+và\s+hạn\s+chế\s+việc\s+phân\s+tâm)?/giu,
      "cần rèn luyện thêm thói quen tự kiểm tra kỹ logic mã nguồn và xử lý các trường hợp ngoại lệ khi thực hành"
    )
    .replace(
      /cần\s+chú\s+ý\s+hơn\s+để\s+duy\s+trì\s+sự\s+tập\s+trung(?:\s+xuyên\s+suốt\s+buổi\s+học)?(?:\s+và\s+hạn\s+chế\s+việc\s+phân\s+tâm)?/giu,
      "cần chú ý kiểm thử kỹ hơn các chức năng và tối ưu cấu trúc mã nguồn trong quá trình thực hành"
    )
    .replace(
      /chú\s+ý\s+tập\s+trung\s+hơn\s+trong\s+giờ\s+học\s+và\s+/giu,
      "chú ý kiểm tra kỹ logic chương trình và "
    )
    .replace(
      /chú\s+ý\s+tập\s+trung\s+hơn\s+trong\s+giờ\s+học/giu,
      "chú ý rà soát kỹ logic mã nguồn khi thực hành"
    )
    .replace(
      /rèn\s+luyện\s+thêm\s+sự\s+tập\s+trung\s+và\s+tính\s+cẩn\s+thận/giu,
      "rèn luyện thêm tư duy tối ưu mã nguồn và tính cẩn thận"
    )
    .replace(
      /rèn\s+luyện\s+sự\s+tập\s+trung\s*,\s*tính\s+cẩn\s+thận/giu,
      "rèn luyện tư duy thiết kế chương trình, tính cẩn thận"
    )
    .replace(
      /rèn\s+luyện\s+(?:thêm\s+)?sự\s+tập\s+trung/giu,
      "rèn luyện kỹ năng tự kiểm thử chương trình"
    )
    .replace(
      /duy\s+trì\s+sự\s+tập\s+trung(?:\s+xuyên\s+suốt\s+buổi\s+học)?/giu,
      "chủ động kiểm tra kỹ từng bước xử lý trong code"
    )
    .replace(/\s+và\s+hạn\s+chế\s+việc\s+phân\s+tâm/giu, "");
}

/**
 * Strips any project name / student name appended after "dự án cuối khóa" / "dự án sản phẩm cuối khóa"
 * so the course summary always reads cleanly as "Đối với dự án cuối khóa, [Tên] đã..."
 */
export function sanitizeRedundantProjectNameInCourseSummary(
  rawText: string,
  fullName?: string,
  callName?: string
): string {
  let out = String(rawText || "")
    .replace(
      /\b(dự\s+án\s+(?:sản\s+phẩm\s+)?cuối\s+khóa|sản\s+phẩm\s+cuối\s+khóa)\s+(?:mang\s+tên|có\s+tên(?:\s+gọi)?(?:\s+là)?|với\s+tên(?:\s+gọi)?|với\s+đề\s+tài|với\s+chủ\s+đề|đề\s+tài)\s+[^,.!?;:\n]+(?=\s*[,.:;])/giu,
      "$1"
    )
    .replace(
      /\b(dự\s+án\s+(?:sản\s+phẩm\s+)?cuối\s+khóa|sản\s+phẩm\s+cuối\s+khóa)\s*["“'‘][^"”'’\n]+["”'’]/giu,
      "$1"
    )
    .replace(
      /\b(dự\s+án\s+(?:sản\s+phẩm\s+)?cuối\s+khóa|sản\s+phẩm\s+cuối\s+khóa)\s*\([^)\n]+\)/giu,
      "$1"
    )
    .replace(
      /\b(dự\s+án\s+(?:sản\s+phẩm\s+)?cuối\s+khóa|sản\s+phẩm\s+cuối\s+khóa)\s+SPCK\s+[^,.!?;:\n]+(?=\s*[,.:;])/giu,
      "$1"
    );

  const candidates = [fullName, callName]
    .map((n) => String(n || "").trim())
    .filter((n) => n.length >= 2)
    .sort((a, b) => b.length - a.length);

  for (const name of candidates) {
    const escaped = escapeRegExp(name);
    out = out.replace(
      new RegExp(
        `\\b(dự\\s+án\\s+(?:sản\\s+phẩm\\s+)?cuối\\s+khóa|sản\\s+phẩm\\s+cuối\\s+khóa)\\s+(?:mang\\s+tên\\s+)?${escaped}(?=\\s*[,.:;])`,
        "giu"
      ),
      "$1"
    );
  }

  return out;
}

/**
 * Summarizes Sessions 1..13 feedback for a student to ground the Session 14 course evaluation.
 */
function buildCourseHistoryDigest(
  classId: string,
  studentId: string,
  fullName: string,
  callName: string,
  fullToken: string,
  shortToken: string,
  peerNames: string[],
  allowFocusCritique = true
): { hasHistory: boolean; digest: string } {
  const feedbacks = sessionFeedbackRepo
    .findByClass(classId)
    .filter((f) => f.studentId === studentId && !String(f.sessionId || "").endsWith("_SESS_14"));

  if (feedbacks.length === 0) {
    return {
      hasHistory: false,
      digest: "(Chưa có bản ghi nhận xét các buổi 1–13 trong hệ thống)",
    };
  }

  const presentCount = feedbacks.filter((f) => f.attendanceStatus === "PRESENT").length;
  const snippets: string[] = [];

  for (const f of feedbacks.slice(-6)) {
    let tags: string[] = [];
    try {
      tags = JSON.parse(f.quickTagsJson || "[]");
    } catch {
      tags = [];
    }
    const filteredTags = allowFocusCritique
      ? tags
      : tags.filter(
          (t) =>
            !/mat tap trung|chua tap trung|phan tam|xao nhang|lam viec rieng/i.test(
              stripVietnameseAccents(String(t || ""))
            )
        );
    const rawImprovements = allowFocusCritique
      ? f.improvements || ""
      : sanitizeFocusClaimsWhenAttitudeHigh(f.improvements || "", false);
    const piece = [
      filteredTags.slice(0, 3).join(", "),
      f.teacherNote || "",
      f.strengths || "",
      rawImprovements,
    ]
      .map((s) => String(s || "").trim())
      .filter(Boolean)
      .join(" - ")
      .slice(0, 180);
    if (piece) {
      snippets.push(
        anonymizeSession14Text(piece, fullName, callName, fullToken, shortToken, peerNames)
      );
    }
  }

  if (snippets.length === 0) {
    return {
      hasHistory: false,
      digest: `Chuyên cần ghi nhận ${presentCount}/${feedbacks.length} buổi (chưa có dữ liệu nhận xét chi tiết từng buổi).`,
    };
  }

  return {
    hasHistory: true,
    digest: `Chuyên cần ghi nhận ${presentCount}/${feedbacks.length} buổi. Điểm nhấn quá trình học: ${snippets.join(" | ")}`,
  };
}

/**
 * Assembles the exact "Learned From Mindx" letter structure with deterministic TypeScript-injected scores.
 * Omits the outer "Kính gửi Quý Phụ huynh..." header and "MindX ghi nhận sự nỗ lực..." footer
 * per teacher requirement.
 */
export function assembleLearnedFromMindxLetter(params: {
  fullName: string;
  callName: string;
  knowledgeParagraph1: string;
  knowledgeParagraph2: string;
  knowledgeParagraph3: string;
  demoTotalScore: number;
  competencyTotalScore: number;
  softSkillsParagraph1: string;
  softSkillsParagraph2: string;
  personalParagraph1: string;
  personalParagraph2: string;
}): string {
  const demoStr = formatScoreDisplay(params.demoTotalScore);
  const compStr = formatScoreDisplay(params.competencyTotalScore);

  return [
    `Về kiến thức chuyên môn:`,
    stripRedundantLetterHeaderAndFooter(params.knowledgeParagraph1),
    stripRedundantLetterHeaderAndFooter(params.knowledgeParagraph2),
    stripRedundantLetterHeaderAndFooter(params.knowledgeParagraph3),
    `Kết quả đánh giá:`,
    `Điểm Demo: ${demoStr} điểm`,
    `Điểm Năng lực: ${compStr} điểm`,
    `Về kỹ năng mềm (giao tiếp, hợp tác, thuyết trình):`,
    stripRedundantLetterHeaderAndFooter(params.softSkillsParagraph1),
    stripRedundantLetterHeaderAndFooter(params.softSkillsParagraph2),
    `Nhận xét cá nhân:`,
    stripRedundantLetterHeaderAndFooter(params.personalParagraph1),
    stripRedundantLetterHeaderAndFooter(params.personalParagraph2),
  ]
    .filter(Boolean)
    .join("\n");
}

export class Session14CourseSummaryGenerator {
  static async generateBatch(
    classId: string,
    students: Session14EvalStudentInput[]
  ): Promise<Session14EvalAiResultItem[]> {
    const normalizedClassId = String(classId || "").trim().toUpperCase();
    const classRoster = studentRepo.findByClass(normalizedClassId, false);
    const peerNames = classRoster.map((s) => s.fullName);
    const courseProg = getCourseProgressionInfo(normalizedClassId);

    const results: Session14EvalAiResultItem[] = [];

    for (let i = 0; i < students.length; i++) {
      const item = students[i];
      const fullToken = `STUDENT_FULL_${String(i + 1).padStart(2, "0")}`;
      const shortToken = `STUDENT_SHORT_${String(i + 1).padStart(2, "0")}`;
      const callName = formatSpckStudentCallName(item.fullName);

      const evalRow = session14EvalRepo.getOrInit(normalizedClassId, item.studentId);
      const initialVersion =
        item.expectedVersion !== undefined && Number.isFinite(item.expectedVersion)
          ? Number(item.expectedVersion)
          : evalRow.draftVersion;

      if (evalRow.draftVersion !== initialVersion) {
        results.push({
          studentId: item.studentId,
          fullName: item.fullName,
          status: "CONFLICT",
          learnedFromMindx: evalRow.learnedFromMindx || "",
          suggestionsFromMindx: evalRow.suggestionsFromMindx || "",
          futureDirection: evalRow.futureDirection || "",
          demoTotalScore: evalRow.demoTotalScore,
          competencyTotalScore: evalRow.competencyTotalScore,
          anonymizedFullToken: fullToken,
          anonymizedShortToken: shortToken,
          preservedExisting: true,
          draftVersion: evalRow.draftVersion,
          errorMessage: `Phiên bản đánh giá của học viên ${item.studentId} đã thay đổi trước khi gọi AI (expected=${initialVersion}, current=${evalRow.draftVersion}). Giữ nguyên bản hiện tại.`,
          record: evalRow,
        });
        continue;
      }

      const s14SpckRow = spckSessionRepo.findOne(normalizedClassId, item.studentId, 14);

      const compScores = parseSession14CompetencyScores(
        item.competencyScores || evalRow.competencyJson
      );
      const compTotal = calculateCompetencyAverageScore(compScores);

      const demoScores = parseSession14DemoScores(item.demoScores || evalRow.demoScoresJson, normalizedClassId);
      const demoTotal = calculateDemoTotalScore(demoScores);

      let storedTags: string[] = [];
      try {
        storedTags = JSON.parse(evalRow.quickTagsJson || s14SpckRow?.quickTagsJson || "[]");
      } catch {
        storedTags = [];
      }

      const quickTags = (
        item.quickTags && item.quickTags.length > 0 ? item.quickTags : storedTags
      )
        .map((t) => String(t || "").trim())
        .filter(Boolean);

      const teacherNote = String(
        item.teacherNote ?? evalRow.teacherNote ?? s14SpckRow?.teacherNote ?? ""
      ).trim();

      const spckComment = String(s14SpckRow?.teacherComment || "").trim();
      const judgeNote = String(evalRow.demoJudgeNote || "").trim();

      const hasExplicitDistractionInput =
        /mat tap trung|chua tap trung|phan tam|lam viec rieng|xao nhang|noi chuyen rieng/i.test(
          stripVietnameseAccents([quickTags.join(" "), teacherNote, judgeNote].join(" "))
        );
      const allowFocusCritique =
        Number(compScores.attitudeInClass) <= 3 || hasExplicitDistractionInput;

      const history = buildCourseHistoryDigest(
        normalizedClassId,
        item.studentId,
        item.fullName,
        callName,
        fullToken,
        shortToken,
        peerNames,
        allowFocusCritique
      );

      // Guardrail: If there are NO quickTags, NO teacherNote, NO SPCK comment, NO judgeNote, and NO history -> INSUFFICIENT_INFO
      if (
        quickTags.length === 0 &&
        teacherNote.length === 0 &&
        spckComment.length === 0 &&
        judgeNote.length === 0 &&
        !history.hasHistory
      ) {
        results.push({
          studentId: item.studentId,
          fullName: item.fullName,
          status: "INSUFFICIENT_INFO",
          learnedFromMindx: evalRow.learnedFromMindx || "",
          suggestionsFromMindx: evalRow.suggestionsFromMindx || "",
          futureDirection: evalRow.futureDirection || "",
          demoTotalScore: demoTotal,
          competencyTotalScore: compTotal,
          anonymizedFullToken: fullToken,
          anonymizedShortToken: shortToken,
          preservedExisting: Boolean(
            evalRow.learnedFromMindx || evalRow.suggestionsFromMindx || evalRow.futureDirection
          ),
          draftVersion: evalRow.draftVersion,
          errorMessage:
            "Chưa đủ thông tin (INSUFFICIENT_INFO): Không có Quick Tags, ghi chú giáo viên hoặc dữ liệu quá trình học. Nội dung hiện có được giữ nguyên.",
          record: evalRow,
        });
        continue;
      }

      const anonTags = quickTags.map((t) =>
        anonymizeSession14Text(t, item.fullName, callName, fullToken, shortToken, peerNames)
      );
      const anonNote = anonymizeSession14Text(
        teacherNote,
        item.fullName,
        callName,
        fullToken,
        shortToken,
        peerNames
      );
      const anonSpckComment = anonymizeSession14Text(
        spckComment,
        item.fullName,
        callName,
        fullToken,
        shortToken,
        peerNames
      );
      const anonJudgeNote = anonymizeSession14Text(
        judgeNote,
        item.fullName,
        callName,
        fullToken,
        shortToken,
        peerNames
      );

      const attitudeFocusRule = allowFocusCritique
        ? `- Lưu ý thái độ học tập (${compScores.attitudeInClass}/5): học viên đôi lúc còn phân tâm hoặc cần duy trì sự tập trung tốt hơn, hãy nhắc nhở nhẹ nhàng, mang tính xây dựng sư phạm.`
        : `- QUY TẮC BẮT BUỘC VỀ THÁI ĐỘ HỌC TẬP (${compScores.attitudeInClass}/5 điểm - Tốt/Xuất sắc): Học viên có thái độ học tập trên lớp rất nghiêm túc (${compScores.attitudeInClass}/5 điểm). TUYỆT ĐỐI KHÔNG ĐƯỢC viết học viên "mất tập trung", "chưa tập trung", "cần duy trì sự tập trung", "hạn chế việc phân tâm" hay "chú ý tập trung hơn trong giờ học" ở bất kỳ đoạn nào. Phần điểm cần lưu ý và lời khuyên chỉ được góp ý về khía cạnh chuyên môn lập trình (ví dụ: rèn luyện thói quen kiểm thử kỹ các trường hợp ngoại lệ, tối ưu cấu trúc mã nguồn gọn gàng hơn, chủ động tự viết và kiểm tra kỹ từng đoạn lệnh hoặc mở rộng thêm tính năng nâng cao).`;

      const kp2Spec = allowFocusCritique
        ? `Đoạn 2 (2 câu) của mục 'Về kiến thức chuyên môn': Nêu điểm cần lưu ý trong quá trình học của ${shortToken} (ví dụ: đôi lúc cần chú ý duy trì sự tập trung xuyên suốt buổi học và cẩn thận, chủ động tự viết code hơn trong quá trình thực hành để kiến thức được củng cố vững chắc).`
        : `Đoạn 2 (2 câu) của mục 'Về kiến thức chuyên môn': Nêu định hướng hoàn thiện chuyên môn cho ${shortToken} trong quá trình thực hành (ví dụ: cần rèn luyện thêm thói quen tự kiểm tra kỹ logic mã nguồn, xử lý các trường hợp ngoại lệ và chủ động tự tay tối ưu từng đoạn lệnh để kiến thức được củng cố vững chắc hơn — tuyệt đối không nói học viên mất tập trung hay phân tâm).`;

      const pp2Spec = allowFocusCritique
        ? `Đoạn 2 (2-3 câu) của mục 'Nhận xét cá nhân': Trong thời gian tới, giáo viên khuyến khích ${shortToken} duy trì tinh thần học hỏi, phát huy khả năng tư duy, đồng thời rèn luyện thêm sự tập trung và tính cẩn thận khi lập trình để phát triển tốt hơn trong các khóa học tiếp theo.`
        : `Đoạn 2 (2-3 câu) của mục 'Nhận xét cá nhân': Trong thời gian tới, giáo viên khuyến khích ${shortToken} duy trì tinh thần học hỏi, phát huy khả năng tư duy, đồng thời rèn luyện thêm tư duy tối ưu mã nguồn và tính cẩn thận khi kiểm thử chương trình để phát triển tốt hơn trong các khóa học tiếp theo.`;

      const suggestionsSpec = allowFocusCritique
        ? `2-3 câu hoàn chỉnh cho ô 'Suggestions From Mindx': Trong thời gian tới, giáo viên khuyến khích ${shortToken} duy trì những điểm mạnh hiện có, đồng thời chú ý tập trung hơn trong giờ học và rèn luyện sự cẩn thận khi thực hành để việc tiếp thu kiến thức đạt hiệu quả cao hơn và phát triển tốt hơn ở các khóa học tiếp theo.`
        : `2-3 câu hoàn chỉnh cho ô 'Suggestions From Mindx': Trong thời gian tới, giáo viên khuyến khích ${shortToken} duy trì những điểm mạnh hiện có, đồng thời chú ý kiểm thử kỹ các chức năng, rèn luyện sự cẩn thận khi tổ chức mã nguồn và chủ động mở rộng thêm tính năng để phát triển tốt hơn ở các khóa học tiếp theo.`;

      const futureSpec = allowFocusCritique
        ? `3-4 câu hoàn chỉnh cho ô 'Future Direction': Đánh giá tiềm năng tốt của ${shortToken} với môn học qua khả năng tiếp thu và hoàn thiện sản phẩm cuối khóa. Giáo viên khuyến khích ${shortToken} tiếp tục theo học ${courseProg.nextCourseLabel} để mở rộng kiến thức chuyên môn, phát triển tư duy lập trình và rèn luyện kỹ năng xây dựng những sản phẩm có độ phức tạp cao hơn. Bên cạnh đó, em nên tiếp tục rèn luyện sự tập trung, tính cẩn thận khi làm bài và kỹ năng trình bày để chuẩn bị tốt hơn cho các dự án lớn ở những cấp độ học tiếp theo.`
        : `3-4 câu hoàn chỉnh cho ô 'Future Direction': Đánh giá tiềm năng tốt của ${shortToken} với môn học qua khả năng tiếp thu và hoàn thiện sản phẩm cuối khóa. Giáo viên khuyến khích ${shortToken} tiếp tục theo học ${courseProg.nextCourseLabel} để mở rộng kiến thức chuyên môn, phát triển tư duy lập trình và rèn luyện kỹ năng xây dựng những sản phẩm có độ phức tạp cao hơn. Bên cạnh đó, em nên tiếp tục rèn luyện tư duy thiết kế chương trình, tính cẩn thận khi kiểm thử code và kỹ năng trình bày để chuẩn bị tốt hơn cho các dự án lớn ở những cấp độ học tiếp theo.`;

      const prompt = `Bạn là giáo viên lập trình và công nghệ tại MindX. Hãy viết **Nhận xét tổng kết cuối khóa (Buổi 14 - Thư từ MindX)** cho học viên có tên gọi ngắn là "${shortToken}" (họ tên đầy đủ: "${fullToken}") tại lớp ${normalizedClassId} (${courseProg.currentCourseLabel}).

PHONG CÁCH MẪU CHUẨN GIÁO VIÊN MINDX (BẮT BUỘC HỌC THEO 100% VỀ GIỌNG VĂN & CẤU TRÚC):
- Xưng hô chuẩn mực: Xưng là **"giáo viên"** (ví dụ: "giáo viên đánh giá cao...", "giáo viên nhận thấy...", "giáo viên ghi nhận...", "giáo viên khuyến khích..."), gọi học viên bằng tên gọi ngắn **"${shortToken}"** kết hợp đại từ **"em"** (nhất quán dùng "em", không dùng "con"). **TUYỆT ĐỐI KHÔNG xưng là "thầy", "cô" hay "thầy/cô".**
- TUYỆT ĐỐI KHÔNG viết lời chào mở đầu ("Kính gửi Quý Phụ huynh...", "MindX xin gửi đến...") và KHÔNG viết đoạn chúc cuối thư ("MindX ghi nhận sự nỗ lực...").
- Khi nhắc đến sản phẩm cuối khóa, chỉ ghi gọn là **"Đối với dự án cuối khóa,"** hoặc **"Ở dự án cuối khóa,"** — TUYỆT ĐỐI KHÔNG tự đặt tên dự án hoặc ghi "mang tên ...".
- Tuyệt đối KHÔNG tự ghi điểm số vào các đoạn văn (hệ thống TypeScript sẽ tự chèn mục "Kết quả đánh giá: Điểm Demo / Điểm Năng lực").
${attitudeFocusRule}

DỮ LIỆU ĐẦU VÀO CỦA HỌC VIÊN:
- Mã học viên ẩn danh: ${shortToken} (họ tên đầy đủ: ${fullToken})
- Khóa học hiện tại: ${courseProg.currentCourseLabel} (kiến thức trọng tâm: ${courseProg.domainKeywords})
- Định hướng khóa kế tiếp: ${courseProg.nextCourseLabel}
- Điểm Demo (thang 5.0): ${formatScoreDisplay(demoTotal)}/5.0 (${isRoboticsClassCode(normalizedClassId) ? `Giải quyết vấn đề: ${demoScores.problemSolving}/1.0, Kỹ năng máy tính: ${demoScores.computerSkills}/0.5, Sáng tạo: ${demoScores.creativity}/1.25, Giao tiếp: ${demoScores.communication}/0.75, Thuật toán: ${demoScores.algorithm}/1.0` : `Thuật toán: ${demoScores.algorithm}/1.5, Sáng tạo: ${demoScores.creativity}/1.0, Giao tiếp: ${demoScores.communication}/0.5, Giải quyết vấn đề: ${demoScores.problemSolving}/1.0, Kỹ năng máy tính: ${demoScores.computerSkills}/1.0`})
- Điểm Năng lực [ĐNL] (thang 5.0): ${formatScoreDisplay(compTotal)}/5.0 (Kiến thức trên lớp: ${compScores.knowledgeInClass}/5, Tự học: ${compScores.knowledgeSelfStudy}/5, Giao tiếp & hợp tác: ${compScores.skillCommunication}/5, Sử dụng máy tính: ${compScores.skillComputerUse}/5, Giải quyết vấn đề: ${compScores.skillProblemSolving}/5, Sáng tạo: ${compScores.skillCreativity}/5, Tư duy máy tính: ${compScores.skillComputational}/5, Thái độ BTVN: ${compScores.attitudeHomework}/5, Thái độ học tập trên lớp: ${compScores.attitudeInClass}/5)
- Thẻ đánh giá nhanh (Quick Tags): ${JSON.stringify(anonTags)}
- Ghi chú của giáo viên: ${anonNote || "(Không có ghi chú riêng)"}
- Ghi chú Ban giám khảo Demo: ${anonJudgeNote || "(Không có)"}
- Tóm tắt quá trình học (Buổi 1–13): ${history.digest}
- Nhận xét Sản phẩm cuối khóa & Thuyết trình: ${anonSpckComment || "(Xem thẻ đánh giá và ghi chú)"}

Hãy trả về đúng định dạng JSON sau (không kèm markdown fence \`\`\`json):
{
  "knowledgeParagraph1": "Đoạn 1 (3 câu) của mục 'Về kiến thức chuyên môn': Đánh giá khả năng tiếp thu kiến thức trong suốt quá trình học của ${shortToken}, tư duy, ý thức học tập, khả năng ghi nhớ và vận dụng kiến thức (${courseProg.domainKeywords}) vào bài thực hành, tinh thần chủ động tìm hiểu/làm bài tập (xưng 'giáo viên', tuyệt đối không xưng 'thầy'/'cô').",
  "knowledgeParagraph2": "${kp2Spec}",
  "knowledgeParagraph3": "Đoạn 3 (2-3 câu) của mục 'Về kiến thức chuyên môn': Mở đầu bằng 'Đối với dự án cuối khóa,' (TUYỆT ĐỐI KHÔNG ghi tên dự án hay 'mang tên ...'), đánh giá mức độ hoàn thiện sản phẩm và slide thuyết trình của ${shortToken}, sự đầu tư nghiêm túc và khả năng vận dụng kiến thức đã học để hoàn thiện sản phẩm theo yêu cầu.",
  "softSkillsParagraph1": "Đoạn 1 (2 câu) của mục 'Về kỹ năng mềm (giao tiếp, hợp tác, thuyết trình)': Đánh giá thái độ học tập và hợp tác của ${shortToken} với giáo viên, lắng nghe hướng dẫn, chủ động thực hiện các yêu cầu và tinh thần tự thực hành.",
  "softSkillsParagraph2": "Đoạn 2 (3 câu) của mục 'Về kỹ năng mềm': Trong phần thuyết trình cuối khóa, đánh giá sự chuẩn bị slide (thiết kế, bố cục rõ ràng, nội dung đầy đủ, dễ nhìn), cách trình bày làm nổi bật nội dung chính của sản phẩm và lời khuyên để ${shortToken} tiếp tục rèn luyện khả năng diễn đạt, trình bày tự tin hơn.",
  "personalParagraph1": "Đoạn 1 (2-3 câu) của mục 'Nhận xét cá nhân': Tổng kết năng lực nổi bật của ${shortToken} trong suốt khóa học và những điểm mạnh thể hiện rõ qua quá trình thực hiện dự án cuối khóa.",
  "personalParagraph2": "${pp2Spec}",
  "suggestionsFromMindx": "${suggestionsSpec}",
  "futureDirection": "${futureSpec}"
}`;

      const safePrompt = anonymizeSession14Text(
        prompt,
        item.fullName,
        callName,
        fullToken,
        shortToken,
        peerNames
      );

      try {
        const model = getGeminiModel(undefined, 0.75);
        const response = await model.generateContent(safePrompt);
        const rawText = response.response.text();
        const cleanedJson = rawText
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim();
        const parsed = JSON.parse(cleanedJson);

        const cleanField = (val: unknown): string => {
          const deAnon = deAnonymizeSession14Text(
            String(val || "").trim(),
            fullToken,
            shortToken,
            item.fullName,
            callName
          );
          const withGiaoVien = normalizeTeacherSelfReferenceToGiaoVien(deAnon);
          const withFocusRule = sanitizeFocusClaimsWhenAttitudeHigh(
            withGiaoVien,
            allowFocusCritique
          );
          const withoutProjectName = sanitizeRedundantProjectNameInCourseSummary(
            withFocusRule,
            item.fullName,
            callName
          );
          return stripRedundantLetterHeaderAndFooter(withoutProjectName)
            .replace(/\s+/g, " ")
            .trim();
        };

        const knowledgeParagraph1 = cleanField(parsed.knowledgeParagraph1);
        const knowledgeParagraph2 = cleanField(parsed.knowledgeParagraph2);
        const knowledgeParagraph3 = cleanField(parsed.knowledgeParagraph3);
        const softSkillsParagraph1 = cleanField(parsed.softSkillsParagraph1);
        const softSkillsParagraph2 = cleanField(parsed.softSkillsParagraph2);
        const personalParagraph1 = cleanField(parsed.personalParagraph1);
        const personalParagraph2 = cleanField(parsed.personalParagraph2);
        const suggestionsFromMindx = cleanField(parsed.suggestionsFromMindx);
        const futureDirection = cleanField(parsed.futureDirection);

        if (
          !knowledgeParagraph1 ||
          !knowledgeParagraph2 ||
          !knowledgeParagraph3 ||
          !softSkillsParagraph1 ||
          !personalParagraph1 ||
          !suggestionsFromMindx ||
          !futureDirection
        ) {
          throw new Error(
            "Phản hồi JSON từ Gemini thiếu các trường nhận xét tổng kết cuối khóa bắt buộc."
          );
        }

        // Re-check record version & status after awaiting Gemini to prevent overwriting newer edits/approvals (F05)
        const latestRowAfterAi = session14EvalRepo.getOrInit(normalizedClassId, item.studentId);
        if (
          latestRowAfterAi.draftVersion !== initialVersion ||
          latestRowAfterAi.status === "APPROVED" ||
          latestRowAfterAi.status === "VERIFIED"
        ) {
          results.push({
            studentId: item.studentId,
            fullName: item.fullName,
            status: "CONFLICT",
            learnedFromMindx: latestRowAfterAi.learnedFromMindx,
            suggestionsFromMindx: latestRowAfterAi.suggestionsFromMindx,
            futureDirection: latestRowAfterAi.futureDirection,
            demoTotalScore: latestRowAfterAi.demoTotalScore,
            competencyTotalScore: latestRowAfterAi.competencyTotalScore,
            anonymizedFullToken: fullToken,
            anonymizedShortToken: shortToken,
            outboundPromptSample: safePrompt,
            preservedExisting: true,
            draftVersion: latestRowAfterAi.draftVersion,
            errorMessage:
              "Bản đánh giá đã được chỉnh sửa hoặc duyệt trong lúc chờ AI phản hồi. Giữ nguyên bản mới của giáo viên.",
            record: latestRowAfterAi,
          });
          continue;
        }

        const learnedFromMindx = assembleLearnedFromMindxLetter({
          fullName: item.fullName,
          callName,
          knowledgeParagraph1,
          knowledgeParagraph2,
          knowledgeParagraph3,
          demoTotalScore: demoTotal,
          competencyTotalScore: compTotal,
          softSkillsParagraph1,
          softSkillsParagraph2,
          personalParagraph1,
          personalParagraph2,
        });

        const saved = session14EvalRepo.saveDraft({
          classId: normalizedClassId,
          studentId: item.studentId,
          expectedVersion: initialVersion,
          ...(item.competencyScores !== undefined ? { competencyScores: compScores } : {}),
          ...(item.demoScores !== undefined ? { demoScores } : {}),
          learnedFromMindx,
          suggestionsFromMindx,
          futureDirection,
          ...(item.quickTags !== undefined ? { quickTags } : {}),
          ...(item.teacherNote !== undefined ? { teacherNote } : {}),
        });

        if (!saved.success || saved.conflict) {
          results.push({
            studentId: item.studentId,
            fullName: item.fullName,
            status: "CONFLICT",
            learnedFromMindx: saved.record.learnedFromMindx,
            suggestionsFromMindx: saved.record.suggestionsFromMindx,
            futureDirection: saved.record.futureDirection,
            demoTotalScore: saved.record.demoTotalScore,
            competencyTotalScore: saved.record.competencyTotalScore,
            anonymizedFullToken: fullToken,
            anonymizedShortToken: shortToken,
            outboundPromptSample: safePrompt,
            preservedExisting: true,
            draftVersion: saved.record.draftVersion,
            errorMessage:
              "Phát hiện xung đột phiên bản khi lưu kết quả AI. Giữ nguyên bản hiện tại của giáo viên.",
            record: saved.record,
          });
          continue;
        }

        results.push({
          studentId: item.studentId,
          fullName: item.fullName,
          status: "SUCCESS",
          learnedFromMindx: saved.record.learnedFromMindx,
          suggestionsFromMindx: saved.record.suggestionsFromMindx,
          futureDirection: saved.record.futureDirection,
          demoTotalScore: saved.record.demoTotalScore,
          competencyTotalScore: saved.record.competencyTotalScore,
          anonymizedFullToken: fullToken,
          anonymizedShortToken: shortToken,
          outboundPromptSample: safePrompt,
          draftVersion: saved.record.draftVersion,
          record: saved.record,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({
          studentId: item.studentId,
          fullName: item.fullName,
          status: "ERROR",
          learnedFromMindx: evalRow.learnedFromMindx || "",
          suggestionsFromMindx: evalRow.suggestionsFromMindx || "",
          futureDirection: evalRow.futureDirection || "",
          demoTotalScore: demoTotal,
          competencyTotalScore: compTotal,
          anonymizedFullToken: fullToken,
          anonymizedShortToken: shortToken,
          outboundPromptSample: prompt,
          preservedExisting: true,
          draftVersion: evalRow.draftVersion,
          errorMessage: message,
          record: evalRow,
        });
      }
    }

    return results;
  }
}
