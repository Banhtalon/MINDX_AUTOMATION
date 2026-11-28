"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  RefreshCw,
  Sparkles,
  CheckCircle,
  Copy,
  Send,
  AlertCircle,
  Clock,
  Check,
  ShieldCheck,
  UserCheck,
  ExternalLink,
} from "lucide-react";
import { ClassPicker } from "@/components/class-picker";
import {
  buildLmsClassCommentsUrl as sharedBuildLmsClassCommentsUrl,
} from "@/lib/lms/lms-class-url";
import {
  formatShortZaloName as sharedFormatShortZaloName,
  addDaysToDdMmYyyy as sharedAddDaysToDdMmYyyy,
  buildAutoZaloBroadcastText as sharedBuildAutoZaloBroadcastText,
} from "@/lib/zalo/zalo-summary";
import {
  resolveCheckpointSessionsForClass as sharedResolveCheckpointSessionsForClass,
  isCheckpointSession as sharedIsCheckpointSession,
} from "@/lib/quick-tags";
import {
  COMPETENCY_AREA_SPECS,
  LEGO_COMPETENCY_AREA_SPECS,
  calculateCompetencyAverageForClassPure,
  calculateCompetencyAveragePure,
  formatCheckpointScoreHeaderLine,
  getCompetencySpecsForClassPure,
  hasMatchingCheckpointLmsCompetency as sharedHasMatchingCheckpointLmsCompetency,
  isLegoRoboticsClassCodePure,
  isRoboticsClassCodePure,
  mergeCheckpointStudentData,
  parseCheckpointDataJson,
  parseCompetencyScoresPure,
  upsertCheckpointHeaderIntoFinalText,
  type CheckpointStageInfo,
  type CheckpointStudentData,
  type CompetencyScores,
} from "@/lib/checkpoint/checkpoint-competency";

interface SessionItem {
  sessionId: string;
  sessionNumber: number;
  topic: string;
  date?: string;
  sessionDate?: string;
}

interface StudentItem {
  studentId: string;
  classId: string;
  sessionId?: string;
  fullName: string;
  isActive: boolean;
  attendanceStatus?: "PRESENT" | "ABSENT" | "LATE" | "UNKNOWN";
  quickTags?: string[];
  inheritedFromSession?: number;
  teacherNote?: string;
  strengths?: string;
  improvements?: string;
  actionPlan?: string;
  finalText?: string;
  contentHash?: string;
  status?:
    | "INSUFFICIENT_INFO"
    | "DRAFT"
    | "WAITING_APPROVAL"
    | "APPROVED"
    | "SAVING"
    | "VERIFIED"
    | "FAILED";
  verifiedAt?: string | null;
  errorMessage?: string | null;
  checkpointData?: CheckpointStudentData | null;
}

interface QuickTagItem {
  id: string;
  label: string;
  sentiment?: "positive" | "constructive" | "neutral";
  hint?: string;
  category?: string;
  categoryName?: string;
  track?: "coding" | "robotics" | "session14" | "common";
  role?: "excellent" | "good" | "positive" | "slow" | "distracted" | "improve";
}

function classifyQuickTagTrack(tag: QuickTagItem): "common" | "coding" | "robotics" | "session14" {
  const track = String(tag.track || "").trim().toLowerCase();
  const cat = String(tag.category || "").toLowerCase();
  const catName = String(tag.categoryName || "").toLowerCase();
  const id = String(tag.id || "").toLowerCase();
  if (
    track === "session14" ||
    cat.startsWith("spck_") ||
    cat.includes("session14") ||
    id.startsWith("s14_") ||
    /buổi\s*14|spck/i.test(catName)
  ) {
    return "session14";
  }
  if (track === "robotics") return "robotics";
  if (track === "coding") return "coding";
  if (
    cat.includes("robot") ||
    cat.startsWith("rob_") ||
    id.startsWith("rob_") ||
    /robot|lắp ráp|cơ khí|cảm biến|🤖/i.test(catName)
  ) {
    return "robotics";
  }
  if (
    cat === "execution" ||
    cat.includes("coding") ||
    cat.startsWith("code_") ||
    cat.startsWith("exec_") ||
    id.startsWith("code_") ||
    id.startsWith("exec_") ||
    /lập trình|code|cú pháp|💻/i.test(catName)
  ) {
    return "coding";
  }
  return "common";
}

function isLegoRoboticsClassCodeSafe(code?: string | null): boolean {
  if (typeof isLegoRoboticsClassCodePure === "function") {
    return isLegoRoboticsClassCodePure(code);
  }
  const combined = String(code || "").trim().toUpperCase();
  if (!combined) return false;
  return (
    /(?:^|[-_\s])(?:KIND[-_\s]*ROB[A-Z0-9]*|ROB[46](?:[BAI][A-Z0-9]*|\+)?|LEGO[A-Z0-9]*|KIRO[A-Z0-9]*)(?=$|[-_\s])/i.test(
      combined
    ) || /(?:RBT|ROBOTICS)\s*[46]\+/i.test(combined)
  );
}

function isRoboticsClassCodeSafe(code?: string | null): boolean {
  if (typeof isRoboticsClassCodePure === "function") {
    return isRoboticsClassCodePure(code);
  }
  const s = String(code || "").trim().toUpperCase();
  if (!s) return false;
  if (isLegoRoboticsClassCodeSafe(s)) return true;
  return /(?:^|[-_\s])(ROB|ROBO|ROBOT|ROBOTICS|PREB|PREA|PREI|ARM|ARMA|ARMB|ARMI|SEM|SEMA|SEMB|SEMI|EV3|VEX|SPIKE|WEDO|ARDUINO)[A-Z0-9]*\b/i.test(
    s
  );
}

function detectTrackByClassCode(code: string): "coding" | "robotics" {
  const raw = String(code || "").trim();
  return isRoboticsClassCodeSafe(raw) || /(?:rob|pre[bai]|arm[bai]|semi[bai]|vex|kiro|lego)/i.test(raw)
    ? "robotics"
    : "coding";
}

function isQuickTagLevel(tagOrLabel: QuickTagItem | string, allTags?: QuickTagItem[]): boolean {
  if (typeof tagOrLabel === "object" && tagOrLabel !== null) {
    const cat = String(tagOrLabel.category || "").toLowerCase();
    const id = String(tagOrLabel.id || "").toLowerCase();
    const label = String(tagOrLabel.label || "").trim();
    return cat.startsWith("level") || id.startsWith("lvl_") || /^(🌟|👍|🛠️)/.test(label);
  }
  const label = String(tagOrLabel || "").trim();
  if (/^(🌟|👍|🛠️)/.test(label)) return true;
  if (Array.isArray(allTags)) {
    const matched = allTags.find((t) => t.label === label);
    if (matched) return isQuickTagLevel(matched);
  }
  return false;
}

function resolveStudentSkillLevelLabel(
  tags?: string[],
  configuredTags?: QuickTagItem[]
): {
  levelCode: 1 | 2 | 3 | 4 | 5 | 0;
  label: string;
  badgeClass: string;
} {
  const cleanTags = Array.isArray(tags)
    ? tags
        .map((t) => String(t || "").trim())
        .filter(
          (t) =>
            Boolean(t) &&
            !/^s14_|slide thuyết trình|phụ thuộc.*vào ai|bố cục.*flexbox|thuyết trình còn nhỏ|sản phẩm chạy mượt/i.test(
              t
            )
        )
    : [];
  if (cleanTags.length === 0) {
    return {
      levelCode: 0,
      label: "Chưa chọn thẻ",
      badgeClass: "bg-slate-800 text-slate-400 border-slate-700",
    };
  }

  const lookup = new Map<string, QuickTagItem>();
  if (Array.isArray(configuredTags)) {
    for (const t of configuredTags) {
      if (classifyQuickTagTrack(t) === "session14") continue;
      if (t?.label) lookup.set(t.label.trim().toLowerCase(), t);
      if (t?.id) lookup.set(t.id.trim().toLowerCase(), t);
    }
  }

  let hasExcellent = false;
  let hasGood = false;
  let hasSlow = false;
  let hasDistracted = false;
  let hasImprove = false;
  let positiveCount = 0;

  for (const raw of cleanTags) {
    const lower = raw.toLowerCase();
    const matched = lookup.get(lower);
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

  const needsSupport = hasSlow || (hasImprove && !hasGood && !hasExcellent);

  if (needsSupport && hasDistracted) {
    return {
      levelCode: 5,
      label: "Cấp độ 5 - Trung bình, mất tập trung",
      badgeClass: "bg-rose-500/20 text-rose-300 border-rose-500/40",
    };
  }
  if (needsSupport) {
    return {
      levelCode: 4,
      label: "Cấp độ 4 - Trung bình",
      badgeClass: "bg-orange-500/20 text-orange-300 border-orange-500/40",
    };
  }
  if (hasDistracted && (hasGood || hasExcellent)) {
    return {
      levelCode: 3,
      label: "Cấp độ 3 - Khá nhưng mất tập trung",
      badgeClass: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    };
  }
  if (hasDistracted) {
    return {
      levelCode: 5,
      label: "Cấp độ 5 - Trung bình, mất tập trung",
      badgeClass: "bg-rose-500/20 text-rose-300 border-rose-500/40",
    };
  }
  if (hasExcellent && !hasImprove) {
    return {
      levelCode: 1,
      label: "Cấp độ 1 - Giỏi",
      badgeClass: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    };
  }
  return {
    levelCode: 2,
    label: "Cấp độ 2 - Khá",
    badgeClass: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",
  };
}

interface SyllabusSession {
  sessionNumber: number;
  topic: string;
  keyKnowledge: string[];
  homeworkBrief: string;
}

interface SyllabusCourse {
  courseCode: string;
  courseName: string;
  checkpointSessions?: number[];
  sessions: SyllabusSession[];
}

interface RunningClassOption {
  classCode: string;
  lmsClassId?: string;
  courseName?: string;
  center?: string;
  status?: string;
}

function isValidLmsClassObjectIdInline(raw: unknown): boolean {
  const s = String(raw ?? "").trim();
  if (!s) return false;
  const lower = s.toLowerCase();
  if (
    lower === "undefined" ||
    lower === "null" ||
    lower === "true" ||
    lower === "false" ||
    lower === "nan"
  ) {
    return false;
  }
  return /^[a-zA-Z0-9_-]{8,64}$/.test(s);
}

function escapeHtmlInline(raw: string): string {
  return String(raw || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildLmsClassCommentsUrlSafe(params: {
  lmsBaseUrl?: string;
  classCode: string;
  lmsClassId?: string | null;
  tab?: number;
}): string {
  if (typeof sharedBuildLmsClassCommentsUrl === "function") {
    return sharedBuildLmsClassCommentsUrl(params);
  }
  const rawBase = String(params?.lmsBaseUrl || "").trim();
  const originMatch = rawBase.match(/^(https?:\/\/[a-zA-Z0-9.-]+(?::\d+)?)(?:\/|$)/i);
  const origin = originMatch ? originMatch[1].replace(/\/+$/, "") : "https://lms.mindx.edu.vn";
  const code = String(params?.classCode || "").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(code)) {
    return `${origin}/admin/classes`;
  }
  const encodedSearch = encodeURIComponent(JSON.stringify(code));
  const cleanId = String(params?.lmsClassId || "").trim();
  const tabNum =
    typeof params?.tab === "number" && Number.isInteger(params.tab) && params.tab >= 0
      ? params.tab
      : 10;
  if (isValidLmsClassObjectIdInline(cleanId)) {
    return `${origin}/admin/classes?search=${encodedSearch}&id=${encodeURIComponent(
      JSON.stringify(cleanId)
    )}&tab=${tabNum}`;
  }
  return `${origin}/admin/classes?search=${encodedSearch}`;
}

function findLatestActiveSessionId(sessionList: SessionItem[]): string {
  const candidates = (sessionList || []).filter((s) => Number(s.sessionNumber) < 14);
  if (candidates.length === 0) return "";
  const now = new Date();
  now.setHours(23, 59, 59, 999);

  let latestByDate = "";
  for (const s of candidates) {
    const rawDate = s.date || s.sessionDate || "";
    const m = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
      if (d.getTime() <= now.getTime()) {
        latestByDate = s.sessionId;
      }
    }
  }
  return latestByDate || candidates[0].sessionId;
}

function getFallbackCompetencyKeysUi(
  isLego: boolean
): ReadonlyArray<keyof CompetencyScores> {
  return isLego
    ? [
        "knowledgeInClass",
        "skillComputational",
        "skillProblemSolving",
        "skillCreativity",
        "skillComputerUse",
        "skillCommunication",
        "attitudeInClass",
      ]
    : [
        "knowledgeSelfStudy",
        "knowledgeInClass",
        "skillCommunication",
        "skillComputerUse",
        "skillProblemSolving",
        "skillCreativity",
        "skillComputational",
        "attitudeHomework",
        "attitudeInClass",
      ];
}

function hasMatchingCheckpointLmsCompetency(
  cp: CheckpointStudentData | null | undefined,
  classCode?: string | null
): boolean {
  if (typeof sharedHasMatchingCheckpointLmsCompetency === "function") {
    return sharedHasMatchingCheckpointLmsCompetency(cp, classCode);
  }
  if (!cp?.lmsCompetencyScores) return false;
  if (!cp?.competencyScores) return true;
  const isLego = Boolean(cp.isLego || isLegoRoboticsClassCodeSafe(classCode));
  const keys = getFallbackCompetencyKeysUi(isLego);
  return keys.every(
    (k) => cp.competencyScores![k] === cp.lmsCompetencyScores![k]
  );
}

function needsStudentCheckpointLmsTick(
  isCheckpointSessionFlag: boolean,
  student: Pick<StudentItem, "checkpointData"> | null | undefined,
  classCode?: string | null
): boolean {
  return Boolean(
    isCheckpointSessionFlag &&
      student?.checkpointData?.competencyScores &&
      !hasMatchingCheckpointLmsCompetency(student?.checkpointData, classCode)
  );
}

function buildZaloDraftStorageKey(code: string, sessId: string): string {
  const c = String(code || "").trim().toUpperCase();
  const s = String(sessId || "").trim();
  if (!c || !s) return "";
  return `mindx_zalo_draft_v1_${c}_${s}`;
}

function readStoredZaloDraft(
  code: string,
  sessId: string
): { broadcastText?: string; part2Text?: string; isManuallyEdited?: boolean } | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return null;
    }
    const key = buildZaloDraftStorageKey(code, sessId);
    if (!key) return null;
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return {
      broadcastText:
        typeof parsed.broadcastText === "string" ? parsed.broadcastText : undefined,
      part2Text: typeof parsed.part2Text === "string" ? parsed.part2Text : undefined,
      isManuallyEdited:
        typeof parsed.isManuallyEdited === "boolean" ? parsed.isManuallyEdited : false,
    };
  } catch {
    return null;
  }
}

function writeStoredZaloDraft(
  code: string,
  sessId: string,
  draft: { broadcastText: string; part2Text: string; isManuallyEdited: boolean }
): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    const key = buildZaloDraftStorageKey(code, sessId);
    if (!key) return;
    window.localStorage.setItem(key, JSON.stringify(draft));
  } catch {}
}

export default function SessionCommentsPage() {
  const safeCompetencyAreaSpecsUi =
    typeof COMPETENCY_AREA_SPECS !== "undefined" ? COMPETENCY_AREA_SPECS : [];
  const safeLegoCompetencySpecsUi =
    typeof LEGO_COMPETENCY_AREA_SPECS !== "undefined" ? LEGO_COMPETENCY_AREA_SPECS : [];
  const safeGetCompSpecsForClassUi = (code?: string | null) => {
    if (typeof getCompetencySpecsForClassPure === "function") {
      return getCompetencySpecsForClassPure(code);
    }
    return isLegoRoboticsClassCodeSafe(code)
      ? safeLegoCompetencySpecsUi
      : safeCompetencyAreaSpecsUi;
  };
  const safeCalcCompAvgUi =
    typeof calculateCompetencyAveragePure === "function"
      ? calculateCompetencyAveragePure
      : () => 4;
  const safeCalcCompAvgForClassUi = (
    scores: CompetencyScores | Partial<CompetencyScores>,
    code?: string | null
  ) => {
    if (typeof calculateCompetencyAverageForClassPure === "function") {
      return calculateCompetencyAverageForClassPure(scores, code);
    }
    const keys = getFallbackCompetencyKeysUi(isLegoRoboticsClassCodeSafe(code));
    let sum = 0;
    for (const k of keys) {
      const val = Number((scores as Record<string, unknown>)?.[k]);
      sum += Number.isFinite(val) ? Math.max(1, Math.min(5, Math.round(val))) : 4;
    }
    return Number((sum / keys.length).toFixed(2));
  };
  const safeFormatCpHeaderUi =
    typeof formatCheckpointScoreHeaderLine === "function"
      ? formatCheckpointScoreHeaderLine
      : () => "";
  const safeParseCpDataUi =
    typeof parseCheckpointDataJson === "function" ? parseCheckpointDataJson : () => null;
  const safeMergeCpDataUi =
    typeof mergeCheckpointStudentData === "function"
      ? mergeCheckpointStudentData
      : (a: any, b: any) => a ?? b ?? null;
  const safeParseCompScoresUi =
    typeof parseCompetencyScoresPure === "function"
      ? parseCompetencyScoresPure
      : (x: any) => x;
  const safeUpsertCpHeaderUi =
    typeof upsertCheckpointHeaderIntoFinalText === "function"
      ? upsertCheckpointHeaderIntoFinalText
      : (t: string) => t;

  const initialSavedClass = (() => {
    try {
      // Browser hydration guard: when `document` exists, return "" on initial render so
      // Client Hydration matches SSR HTML 100% (`0` hydration mismatch when localStorage has a saved class).
      // Keep synchronous fallback strictly for headless `node:vm` harnesses (`typeof document === "undefined"`).
      if (
        typeof window !== "undefined" &&
        typeof document === "undefined" &&
        window.localStorage
      ) {
        return String(window.localStorage.getItem("mindx_last_class_code") || "")
          .trim()
          .toUpperCase();
      }
    } catch {}
    return "";
  })();
  const [classCode, setClassCode] = useState(initialSavedClass);
  const [classId, setClassId] = useState(initialSavedClass);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [students, rawSetStudents] = useState<StudentItem[]>([]);
  const studentsRef = useRef<StudentItem[]>([]);
  studentsRef.current = students;
  const setStudents = (
    updater: StudentItem[] | ((prev: StudentItem[]) => StudentItem[])
  ) => {
    const next = typeof updater === "function" ? updater(studentsRef.current) : updater;
    studentsRef.current = next;
    rawSetStudents(next);
  };
  const [quickTags, setQuickTags] = useState<QuickTagItem[]>([]);
  const [quickTagTrack, setQuickTagTrack] = useState<"coding" | "robotics">(() =>
    detectTrackByClassCode(initialSavedClass)
  );
  const [syllabusList, setSyllabusList] = useState<SyllabusCourse[]>([]);

  // Selected topic details
  const [currentTopic, setCurrentTopic] = useState("");
  const [currentKeyKnowledge, setCurrentKeyKnowledge] = useState<string[]>([]);
  const [currentHomeworkBrief, setCurrentHomeworkBrief] = useState("");

  // Zalo Broadcast
  const [zaloBroadcastText, setZaloBroadcastText] = useState("");
  const [zaloBtvnPart2Text, setZaloBtvnPart2Text] = useState("");
  const [zaloIncludeCheckpointSummary, setZaloIncludeCheckpointSummary] = useState<boolean | undefined>(
    undefined
  );
  const [zaloIncludeGeneralUpdate, setZaloIncludeGeneralUpdate] = useState(false);
  const [zaloIncludeSpckProgress, setZaloIncludeSpckProgress] = useState<boolean | undefined>(
    undefined
  );
  const [zaloIncludePart3Media, setZaloIncludePart3Media] = useState(false);
  const [isAnalyzingBtvnImage, setIsAnalyzingBtvnImage] = useState(false);
  const [isFetchingBtvnLms, setIsFetchingBtvnLms] = useState(false);
  const [isZaloManuallyEdited, setIsZaloManuallyEdited] = useState(false);
  const [hydratedZaloScopeKey, setHydratedZaloScopeKey] = useState("");
  const [copiedZalo, setCopiedZalo] = useState(false);
  const [copiedStudentId, setCopiedStudentId] = useState<string | null>(null);
  const btvnImageInputRef = useRef<HTMLInputElement | null>(null);

  // Checkpoint [ĐNL] Modal & Sync State
  const [checkpointStageInfo, setCheckpointStageInfo] = useState<CheckpointStageInfo | null>(null);
  const [isSyncingCheckpoint, setIsSyncingCheckpoint] = useState(false);
  const [editingCompetencyStudentId, setEditingCompetencyStudentId] = useState<string | null>(null);
  const [manualTheoryInput, setManualTheoryInput] = useState<string>("");
  const [manualPracticeInput, setManualPracticeInput] = useState<string>("");
  const [isSavingManualCpScore, setIsSavingManualCpScore] = useState(false);

  // Classroom Manager Pending Logs Inline Banner State
  const [pendingClassroomLogsCount, setPendingClassroomLogsCount] = useState(0);
  const [isApplyingClassroomLogs, setIsApplyingClassroomLogs] = useState(false);

  // Status & loading states
  const [isSyncing, setIsSyncing] = useState(false);
  const [isFetchingClasses, setIsFetchingClasses] = useState(false);
  const [isManualClassInput, setIsManualClassInput] = useState(false);
  const [runningClasses, setRunningClasses] = useState<RunningClassOption[]>([]);
  const [lmsBaseUrl, setLmsBaseUrl] = useState("https://lms.mindx.edu.vn");
  const [lmsClassIdsByCode, setLmsClassIdsByCode] = useState<Record<string, string>>({});
  const [openingLmsClass, setOpeningLmsClass] = useState<string | null>(null);
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [generatingSingleStudentId, setGeneratingSingleStudentId] = useState<string | null>(null);
  const [isSavingLms, setIsSavingLms] = useState(false);
  const [savingStudentId, setSavingStudentId] = useState<string | null>(null);
  const [pendingUnknownConfirmCount, setPendingUnknownConfirmCount] = useState(0);
  const [statusMessage, setStatusMessage] = useState<{
    type: "info" | "success" | "error";
    text: string;
  } | null>(null);

  const DRAFT_SAVE_DEBOUNCE_MS = 600;
  const openingLmsInFlightRef = useRef(false);
  const openingLmsReqSeqRef = useRef(0);
  const latestLoadRequestIdRef = useRef(0);
  const latestAiRequestIdRef = useRef(0);
  const activeClassIdRef = useRef(initialSavedClass);
  const activeSessionIdRef = useRef("");
  const loadedScopeKeyRef = useRef("");
  const restoredManualLockRef = useRef("");
  const editSequenceRef = useRef(0);
  const clientInstanceIdRef = useRef(
    `sc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );
  const studentEditVersionRef = useRef<Record<string, number>>({});
  const studentAttendanceVersionRef = useRef<Record<string, number>>({});
  const studentServerMetaRef = useRef<
    Record<string, { rowVer: number; fields: Record<string, { ver: number; cid: string; rev: number }> }>
  >({});
  const pendingSavePromisesRef = useRef<Record<string, Promise<boolean> | undefined>>({});
  const activeSavePromisesByStudentRef = useRef<Record<string, Set<Promise<boolean>>>>({});
  const studentFieldEditVersionRef = useRef<Record<string, Record<string, number>>>({});
  const studentFieldConfirmedVersionRef = useRef<Record<string, Record<string, number>>>({});
  const studentUnconfirmedBaseVerRef = useRef<Record<string, Record<string, number>>>({});
  const debouncedTimersRef = useRef<Record<string, ReturnType<typeof setTimeout> | undefined>>({});
  const debouncedPayloadsRef = useRef<
    Record<string, { patch: Partial<StudentItem>; preEditSnapshot?: StudentItem } | undefined>
  >({});
  const debouncedResolversRef = useRef<Record<string, Array<(ok: boolean) => void> | undefined>>({});
  const unsavedDraftPatchRef = useRef<
    Record<
      string,
      | {
          patch: Partial<StudentItem>;
          fieldVersions: Record<string, number>;
          fieldReasons?: Record<string, "error" | "stale">;
          preEditSnapshot?: StudentItem;
          reason: "error" | "stale";
          errorText: string;
          editVersion: number;
        }
      | undefined
    >
  >({});
  const hasRestoredClassCodeRef = useRef(false);
  const restoredTargetClassRef = useRef<string | null>(null);
  const fromClassroomPendingRef = useRef(false);

  const syncPendingSavePromiseRef = (studentId: string, fallbackPromise?: Promise<boolean>) => {
    const activeSet = activeSavePromisesByStudentRef.current[studentId];
    if (activeSet && activeSet.size > 0) {
      const arr = Array.from(activeSet);
      pendingSavePromisesRef.current[studentId] =
        arr.length === 1
          ? arr[0]
          : Promise.all(arr).then((results) => results.every(Boolean));
    } else if (fallbackPromise) {
      pendingSavePromisesRef.current[studentId] = fallbackPromise;
    } else {
      delete pendingSavePromisesRef.current[studentId];
    }
  };

  const clearAllDebouncedTimers = () => {
    for (const key of Object.keys(debouncedTimersRef.current)) {
      const t = debouncedTimersRef.current[key];
      if (t !== undefined) clearTimeout(t);
    }
    debouncedTimersRef.current = {};
    debouncedPayloadsRef.current = {};
    for (const key of Object.keys(debouncedResolversRef.current)) {
      const list = debouncedResolversRef.current[key] || [];
      for (const resolve of list) {
        try {
          resolve(false);
        } catch {}
      }
    }
    debouncedResolversRef.current = {};
  };

  // Restore last selected class from URL query (?classId= / ?classCode=) or browser localStorage on initial mount,
  // then reset manual Zalo edit flag and fetch initial data when class/session changes.
  useEffect(() => {
    if (!hasRestoredClassCodeRef.current) {
      hasRestoredClassCodeRef.current = true;
      try {
        if (typeof window !== "undefined") {
          let urlClass = "";
          try {
            const rawSearch = String(window.location?.search || "");
            if (rawSearch && typeof URLSearchParams === "function") {
              const urlParams = new URLSearchParams(rawSearch);
              urlClass = String(
                urlParams.get("classId") || urlParams.get("classCode") || ""
              )
                .trim()
                .toUpperCase();
              if (urlParams.get("fromClassroom") === "1") {
                fromClassroomPendingRef.current = true;
              }
            } else if (rawSearch) {
              const m = rawSearch.match(/[?&](?:classId|classCode)=([^&#]+)/i);
              if (m && m[1]) {
                const decoded =
                  typeof decodeURIComponent === "function"
                    ? decodeURIComponent(m[1])
                    : m[1];
                urlClass = decoded.trim().toUpperCase();
              }
            }
          } catch {}
          const savedClass =
            urlClass ||
            String(window.localStorage?.getItem("mindx_last_class_code") || "")
              .trim()
              .toUpperCase();
          if (savedClass) {
            restoredTargetClassRef.current = savedClass;
          }
        }
      } catch {}
    }

    let normClass = classId.trim().toUpperCase();
    const normSess = selectedSessionId.trim();
    if (!normClass && normSess.includes("_SESS_")) {
      const derivedFromSess = normSess.replace(/_SESS_\d+$/i, "").trim().toUpperCase();
      if (derivedFromSess) {
        restoredTargetClassRef.current = null;
        normClass = derivedFromSess;
        setClassCode(derivedFromSess);
        setClassId(derivedFromSess);
      }
    }

    if (restoredTargetClassRef.current && normClass !== restoredTargetClassRef.current) {
      const target = restoredTargetClassRef.current;
      setClassCode(target);
      setClassId(target);
      setQuickTagTrack(detectTrackByClassCode(target));
      return;
    }
    restoredTargetClassRef.current = null;

    const classChanged = activeClassIdRef.current !== normClass;
    const scopeChanged =
      classChanged || activeSessionIdRef.current !== normSess;
    activeClassIdRef.current = normClass;
    activeSessionIdRef.current = normSess;
    if (normClass) {
      setQuickTagTrack(detectTrackByClassCode(normClass));
      if (classChanged) {
        try {
          if (typeof window !== "undefined" && window.localStorage) {
            window.localStorage.setItem("mindx_last_class_code", normClass);
          }
        } catch {}
      }
    }
    const scopeKey = normClass && normSess ? `${normClass}::${normSess}` : "";
    if (scopeChanged) {
      clearAllDebouncedTimers();
      unsavedDraftPatchRef.current = {};
      activeSavePromisesByStudentRef.current = {};
      studentFieldEditVersionRef.current = {};
      studentFieldConfirmedVersionRef.current = {};
      setPendingUnknownConfirmCount(0);
      setPendingClassroomLogsCount(0);
      setCheckpointStageInfo(null);
      setGeneratingSingleStudentId(null);
      latestAiRequestIdRef.current++;
      setIsGeneratingAi(false);
      studentEditVersionRef.current = {};
      studentAttendanceVersionRef.current = {};
      studentServerMetaRef.current = {};
      pendingSavePromisesRef.current = {};
      const restoredDraft = scopeKey ? readStoredZaloDraft(normClass, normSess) : null;
      setHydratedZaloScopeKey(scopeKey);
      if (restoredDraft) {
        const nextPart2 = restoredDraft.part2Text || "";
        const nextManual = Boolean(restoredDraft.isManuallyEdited);
        setZaloBtvnPart2Text(nextPart2);
        setIsZaloManuallyEdited(nextManual);
        if (nextManual && typeof restoredDraft.broadcastText === "string") {
          restoredManualLockRef.current = scopeKey;
          setZaloBroadcastText(restoredDraft.broadcastText);
        } else {
          restoredManualLockRef.current = "";
        }
      } else {
        restoredManualLockRef.current = "";
        setIsZaloManuallyEdited(false);
        setZaloBtvnPart2Text("");
      }
      setStudents((prev) =>
        prev.filter(
          (s) =>
            (!s.classId && !s.sessionId) ||
            (s.classId?.trim().toUpperCase() === normClass &&
              (!s.sessionId || s.sessionId.trim() === normSess))
        )
      );
    }
    loadClassData(normClass, normSess);
  }, [classId, selectedSessionId]);

  const loadClassData = async (
    targetClassId: string,
    targetSessionId: string,
    options?: { preserveLocalUnsavedEdits?: boolean }
  ) => {
    const normalizedClassId = targetClassId.trim().toUpperCase();
    const normalizedSessionId = targetSessionId.trim();
    const requestId = ++latestLoadRequestIdRef.current;
    if (!options?.preserveLocalUnsavedEdits) {
      unsavedDraftPatchRef.current = {};
      studentFieldEditVersionRef.current = {};
      studentFieldConfirmedVersionRef.current = {};
    }
    const editVersionsAtStart = new Map<string, number>(
      Object.entries(studentEditVersionRef.current).map(([k, v]) => [k, Number(v || 0)])
    );
    try {
      const res = await fetch(
        `/api/session-comments/list?classId=${encodeURIComponent(normalizedClassId)}&sessionId=${encodeURIComponent(normalizedSessionId)}`
      );
      const json = await res.json();
      if (
        requestId !== latestLoadRequestIdRef.current ||
        activeClassIdRef.current !== normalizedClassId ||
        activeSessionIdRef.current !== normalizedSessionId
      ) {
        return;
      }
      if (json.success && json.data) {
        if (
          normalizedClassId &&
          json.data.classId &&
          String(json.data.classId).trim().toUpperCase() !== normalizedClassId
        ) {
          return;
        }
        let effectiveClassId = normalizedClassId;
        if (!effectiveClassId) {
          const inferredClassId = String(
            json.data.resolvedClassId ||
              json.data.classId ||
              json.data.students?.[0]?.classId ||
              (json.data.sessions?.[0]?.sessionId
                ? String(json.data.sessions[0].sessionId).replace(/_SESS_\d+$/i, "")
                : "") ||
              json.data.runningClasses?.[0]?.classCode ||
              ""
          )
            .trim()
            .toUpperCase();
          if (inferredClassId) {
            effectiveClassId = inferredClassId;
            activeClassIdRef.current = inferredClassId;
            setClassCode(inferredClassId);
            setClassId(inferredClassId);
            setQuickTagTrack(detectTrackByClassCode(inferredClassId));
          }
        }
        if (json.data.quickTags) setQuickTags(json.data.quickTags);
        if (json.data.syllabusList) setSyllabusList(json.data.syllabusList);
        setPendingClassroomLogsCount(Number(json.data.pendingClassroomLogsCount || 0));
        setCheckpointStageInfo(json.data.checkpointStageInfo || null);
        if (typeof json.data.lmsBaseUrl === "string" && json.data.lmsBaseUrl.trim()) {
          setLmsBaseUrl(json.data.lmsBaseUrl.trim());
        }
        const discoveredLmsIds: Record<string, string> = {};
        if (json.data.lmsClassIds && typeof json.data.lmsClassIds === "object") {
          for (const [k, v] of Object.entries(json.data.lmsClassIds)) {
            const codeKey = String(k || "").trim().toUpperCase();
            const idVal = typeof v === "string" ? v.trim() : "";
            if (codeKey && isValidLmsClassObjectIdInline(idVal)) {
              discoveredLmsIds[codeKey] = idVal;
            }
          }
        }
        if (
          effectiveClassId &&
          typeof json.data.lmsClassId === "string" &&
          isValidLmsClassObjectIdInline(json.data.lmsClassId)
        ) {
          discoveredLmsIds[effectiveClassId] = json.data.lmsClassId.trim();
        }
        if (Array.isArray(json.data.runningClasses) && json.data.runningClasses.length > 0) {
          for (const item of json.data.runningClasses) {
            const codeKey = String(item?.classCode || "").trim().toUpperCase();
            const idVal = typeof item?.lmsClassId === "string" ? item.lmsClassId.trim() : "";
            if (codeKey && isValidLmsClassObjectIdInline(idVal)) {
              discoveredLmsIds[codeKey] = idVal;
            }
          }
          setRunningClasses((prev) => {
            const map = new Map<string, RunningClassOption>();
            for (const item of json.data.runningClasses) {
              const code = String(item?.classCode || "").trim().toUpperCase();
              if (code) map.set(code, { ...item, classCode: code });
            }
            for (const p of prev) {
              const code = String(p?.classCode || "").trim().toUpperCase();
              if (code && !map.has(code)) map.set(code, p);
            }
            return Array.from(map.values());
          });
        }
        if (Object.keys(discoveredLmsIds).length > 0) {
          setLmsClassIdsByCode((prev) => ({ ...prev, ...discoveredLmsIds }));
        }

        if (!effectiveClassId) return;

        let effectiveSessionId = normalizedSessionId;
        if (json.data.sessions && json.data.sessions.length > 0) {
          const rawSessionList: SessionItem[] = json.data.sessions;
          const sessionList = rawSessionList.filter((s) => Number(s.sessionNumber) < 14);
          setSessions(sessionList);

          if (sessionList.length === 0) {
            if (normalizedSessionId) {
              setSelectedSessionId("");
            }
            setStudents([]);
            return;
          }

          const existsInClass = sessionList.some((s) => s.sessionId === normalizedSessionId);
          if (!normalizedSessionId || !existsInClass) {
            let urlMatchedSessionId = "";
            try {
              if (typeof window !== "undefined") {
                const urlParams = new URLSearchParams(window.location?.search || "");
                const urlClass = String(
                  urlParams.get("classId") || urlParams.get("classCode") || ""
                )
                  .trim()
                  .toUpperCase();
                const urlSessNum = Number(urlParams.get("sessionNumber") || 0);
                if (urlSessNum > 0 && (!urlClass || urlClass === effectiveClassId)) {
                  urlMatchedSessionId =
                    sessionList.find((s) => Number(s.sessionNumber) === urlSessNum)
                      ?.sessionId || "";
                }
              }
            } catch {}
            effectiveSessionId = urlMatchedSessionId || findLatestActiveSessionId(sessionList);
            if (effectiveSessionId && effectiveSessionId !== normalizedSessionId) {
              setSelectedSessionId(effectiveSessionId);
              return; // useEffect will re-trigger loadClassData with the valid effectiveSessionId
            }
          }
        }

        if (fromClassroomPendingRef.current) {
          fromClassroomPendingRef.current = false;
          setStatusMessage({
            type: "success",
            text: "✨ Đã nạp tự động Điểm danh, Thẻ đánh giá nhanh và tóm tắt vào ô 'Ghi chú của GV' từ trang Quản lý Giờ học (giữ nguyên bạn đã lưu LMS). Kiểm tra lại rồi bấm '✨ AI Soạn Nhận Xét'!",
          });
          try {
            if (typeof window !== "undefined" && typeof window.history?.replaceState === "function") {
              const cleanedUrl = new URL(window.location.href);
              cleanedUrl.searchParams.delete("fromClassroom");
              window.history.replaceState({}, "", cleanedUrl.pathname + cleanedUrl.search + cleanedUrl.hash);
            }
          } catch {}
        }

        if (json.data.students) {
          // Rule 2: Session comments strictly target Active students of the selected class
          const activeRawStudents = json.data.students.filter(
            (st: any) =>
              st.isActive !== false &&
              st.isActive !== 0 &&
              (!st.classId || String(st.classId).trim().toUpperCase() === effectiveClassId)
          );
          const feedbacks = json.data.feedbacks || [];
          const feedbackMap = new Map<string, any>(feedbacks.map((f: any) => [f.studentId, f]));
          const checkpointByStudent: Record<string, CheckpointStudentData> =
            json.data.checkpointByStudent || {};
          const previousQuickTagsMap: Record<
            string,
            { tags: string[]; fromSessionNumber?: number }
          > = json.data.previousQuickTagsByStudent || {};

          const nextServerMeta: Record<
            string,
            { rowVer: number; fields: Record<string, { ver: number; cid: string; rev: number }> }
          > = {};

          const merged: StudentItem[] = activeRawStudents.map((st: any) => {
            const fb = feedbackMap.get(st.studentId);
            let hasExplicitQuickTagEdit = false;
            if (fb?.versionMetaJson) {
              try {
                const parsed = JSON.parse(fb.versionMetaJson);
                hasExplicitQuickTagEdit = Boolean(parsed?.fields?.quickTags);
                nextServerMeta[st.studentId] = {
                  rowVer:
                    typeof parsed?.rowVer === "number" && Number.isFinite(parsed.rowVer)
                      ? parsed.rowVer
                      : 0,
                  fields:
                    parsed?.fields &&
                    typeof parsed.fields === "object" &&
                    !Array.isArray(parsed.fields)
                      ? { ...parsed.fields }
                      : {},
                };
              } catch {}
            } else {
              nextServerMeta[st.studentId] = { rowVer: 0, fields: {} };
            }
            let tags: string[] = [];
            if (fb?.quickTagsJson) {
              try {
                tags = JSON.parse(fb.quickTagsJson);
              } catch {}
            }
            let inheritedFromSession: number | undefined = undefined;
            const prevEntry = previousQuickTagsMap[st.studentId];
            if (
              tags.length === 0 &&
              !hasExplicitQuickTagEdit &&
              (!fb ||
                (!fb.finalText &&
                  (!fb.status || fb.status === "DRAFT" || fb.status === "WAITING_APPROVAL"))) &&
              Array.isArray(prevEntry?.tags) &&
              prevEntry.tags.length > 0
            ) {
              tags = [...prevEntry.tags];
              inheritedFromSession = prevEntry.fromSessionNumber;
              studentEditVersionRef.current[`__qt_pending__${st.studentId}`] = 1;
            } else {
              delete studentEditVersionRef.current[`__qt_pending__${st.studentId}`];
            }
            if (options?.preserveLocalUnsavedEdits) {
              const hasActiveLocalEdit =
                Boolean(debouncedPayloadsRef.current[st.studentId]) ||
                Boolean(pendingSavePromisesRef.current[st.studentId]) ||
                Boolean(unsavedDraftPatchRef.current[st.studentId]) ||
                (studentEditVersionRef.current[st.studentId] || 0) !==
                  (editVersionsAtStart.get(st.studentId) || 0);
              if (hasActiveLocalEdit) {
                const localStu = studentsRef.current.find(
                  (item) =>
                    item.studentId === st.studentId &&
                    (!item.classId || item.classId.trim().toUpperCase() === effectiveClassId) &&
                    (!item.sessionId || item.sessionId.trim() === effectiveSessionId)
                );
                if (localStu) {
                  return {
                    ...localStu,
                    ...(unsavedDraftPatchRef.current[st.studentId]?.patch || {}),
                    ...(debouncedPayloadsRef.current[st.studentId]?.patch || {}),
                  };
                }
              }
            }
            const rawMergedCp = safeMergeCpDataUi(
              safeParseCpDataUi(fb?.checkpointDataJson),
              checkpointByStudent[st.studentId] || null
            );
            const isLegoMergedCp = Boolean(
              rawMergedCp &&
                (rawMergedCp.isLego ||
                  json.data.checkpointStageInfo?.isLego ||
                  isLegoRoboticsClassCodeSafe(effectiveClassId))
            );
            const mergedCp = rawMergedCp
              ? isLegoMergedCp
                ? {
                    ...rawMergedCp,
                    isLego: true,
                    competencyAverage: rawMergedCp.competencyScores
                      ? safeCalcCompAvgForClassUi(rawMergedCp.competencyScores, effectiveClassId)
                      : rawMergedCp.competencyAverage,
                  }
                : rawMergedCp
              : null;
            let loadedFinalText = fb?.finalText || "";
            const fbStatusUpper = String(fb?.status || "DRAFT").trim().toUpperCase();
            if (
              mergedCp &&
              fbStatusUpper !== "APPROVED" &&
              fbStatusUpper !== "VERIFIED" &&
              fbStatusUpper !== "SAVING" &&
              loadedFinalText.trim().length > 0 &&
              !loadedFinalText.startsWith("Chưa đủ thông tin") &&
              /📊\s*\*\*Kết quả Checkpoint/i.test(loadedFinalText)
            ) {
              const refreshedHeader = safeFormatCpHeaderUi({
                cpStage: mergedCp.cpStage,
                theoryScore: mergedCp.theoryScore,
                practiceScore: mergedCp.practiceScore,
                competencyAverage: mergedCp.competencyAverage ?? null,
                isLego: isLegoMergedCp,
              });
              if (refreshedHeader) {
                loadedFinalText = safeUpsertCpHeaderUi(loadedFinalText, refreshedHeader);
              }
            }
            return {
              ...st,
              classId: effectiveClassId,
              sessionId: effectiveSessionId,
              isActive: true,
              attendanceStatus: fb?.attendanceStatus || "UNKNOWN",
              quickTags: tags,
              inheritedFromSession,
              teacherNote: fb?.teacherNote || "",
              strengths: fb?.strengths || "",
              improvements: fb?.improvements || "",
              actionPlan: fb?.actionPlan || "",
              finalText: loadedFinalText,
              contentHash: fb?.contentHash || "",
              status: fb?.status || "DRAFT",
              verifiedAt: fb?.verifiedAt,
              errorMessage: fb?.errorMessage,
              checkpointData: mergedCp,
            };
          });

          if (options?.preserveLocalUnsavedEdits) {
            for (const st of activeRawStudents) {
              const sid = st.studentId;
              const prevMeta = studentServerMetaRef.current[sid];
              const nextMeta = nextServerMeta[sid];
              const unsavedEntry = unsavedDraftPatchRef.current[sid];
              const pendingEntry = debouncedPayloadsRef.current[sid];
              const editVerMap = studentFieldEditVersionRef.current[sid] || {};
              const confirmedVerMap = studentFieldConfirmedVersionRef.current[sid] || {};
              const unconfirmedKeys = new Set<string>([
                ...Object.keys(unsavedEntry?.patch || {}),
                ...Object.keys(pendingEntry?.patch || {}),
                ...Object.keys(editVerMap).filter(
                  (k) => (editVerMap[k] || 0) > (confirmedVerMap[k] || 0)
                ),
              ]);
              if (nextMeta && unconfirmedKeys.size > 0) {
                const mergedFields = { ...nextMeta.fields };
                for (const k of unconfirmedKeys) {
                  if (k !== "status" && unsavedEntry?.fieldReasons?.[k] !== "stale") {
                    if (prevMeta?.fields?.[k]) {
                      mergedFields[k] = prevMeta.fields[k];
                    } else {
                      delete mergedFields[k];
                    }
                  }
                }
                nextServerMeta[sid] = {
                  rowVer: nextMeta.rowVer,
                  fields: mergedFields,
                };
              }
            }
          } else {
            studentUnconfirmedBaseVerRef.current = {};
          }
          loadedScopeKeyRef.current = `${effectiveClassId}::${effectiveSessionId}`;
          studentAttendanceVersionRef.current = {};
          studentServerMetaRef.current = nextServerMeta;
          setStudents(merged);
        }
      }
    } catch (err) {
      if (requestId === latestLoadRequestIdRef.current) {
        console.error("Lỗi tải dữ liệu:", err);
      }
    }
  };

  // Fetch all Running classes from LMS Classes table into dropdown
  const handleFetchRunningClasses = async (): Promise<string> => {
    setIsFetchingClasses(true);
    setStatusMessage({
      type: "info",
      text: "Đang vào trang Danh sách Lớp học LMS để quét các lớp đang học (Status: Running)...",
    });

    try {
      const currentUpper = classCode.trim().toUpperCase();
      const res = await fetch("/api/classes/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "running",
          ...(currentUpper ? { classCode: currentUpper } : {}),
        }),
      });
      const data = await res.json();

      if (res.ok !== false && data.success && Array.isArray(data.classes)) {
        const fetchedIds: Record<string, string> = {};
        const fetched: RunningClassOption[] = data.classes.map((c: any) => {
          const code = String(c.classCode || c.classId || "").trim().toUpperCase();
          const lid = typeof c.lmsClassId === "string" ? c.lmsClassId.trim() : "";
          if (code && isValidLmsClassObjectIdInline(lid)) {
            fetchedIds[code] = lid;
          }
          return {
            classCode: code,
            ...(isValidLmsClassObjectIdInline(lid) ? { lmsClassId: lid } : {}),
            courseName: c.courseName || c.className || "",
            center: c.center || "",
            status: c.status || "Running",
          };
        });
        setRunningClasses(fetched);
        if (Object.keys(fetchedIds).length > 0) {
          setLmsClassIdsByCode((prev) => ({ ...prev, ...fetchedIds }));
        }
        setIsManualClassInput(false);

        if (fetched.length > 0) {
          const hasCurrent = fetched.some((c) => c.classCode === currentUpper);
          const nextCode = hasCurrent ? currentUpper : fetched[0].classCode;
          setClassCode(nextCode);
          setClassId(nextCode);

          setStatusMessage({
            type: "success",
            text: `Đã lấy thành công ${fetched.length} lớp đang học (Running) từ LMS vào ô Mã lớp!`,
          });
          return nextCode;
        } else {
          setStatusMessage({
            type: "info",
            text: "Đã quét LMS thành công nhưng hiện chưa có lớp nào đang mở (Running).",
          });
          return "";
        }
      } else {
        setStatusMessage({
          type: "error",
          text: `Không lấy được danh sách lớp đang học: ${
            data.error || "Chưa tìm thấy lớp nào có trạng thái Running trên LMS."
          }`,
        });
        return "";
      }
    } catch (err: any) {
      setStatusMessage({
        type: "error",
        text: `Lỗi kết nối khi lấy danh sách lớp: ${err.message}`,
      });
      return "";
    } finally {
      setIsFetchingClasses(false);
    }
  };

  const handleSelectRunningClass = async (rawCode: string) => {
    if (rawCode === "__FETCH_RUNNING__") {
      const nextCode = await handleFetchRunningClasses();
      if (nextCode) {
        await handleSyncFromLms(nextCode);
      }
      return;
    }
    const selected = rawCode.trim().toUpperCase();
    if (!selected) return;
    setClassCode(selected);
    setClassId(selected);
    try {
      const res = await fetch(
        `/api/session-comments/list?classId=${encodeURIComponent(selected)}&sessionId=`
      );
      const json = await res.json();
      const hasLocalData =
        json?.success &&
        Array.isArray(json?.data?.sessions) &&
        json.data.sessions.length > 0 &&
        Array.isArray(json?.data?.students) &&
        json.data.students.length > 0;
      if (!hasLocalData) {
        await handleSyncFromLms(selected);
      }
    } catch {}
  };

  // Sync class (and discover running classes if needed) from LMS via Playwright
  const handleSyncFromLms = async (overrideClassCode?: string) => {
    let rawTarget = typeof overrideClassCode === "string" ? overrideClassCode : classCode;
    let normalizedCode = rawTarget.trim().toUpperCase();
    if (!normalizedCode || (runningClasses.length === 0 && typeof overrideClassCode !== "string")) {
      const discoveredCode = await handleFetchRunningClasses();
      if (!normalizedCode) {
        normalizedCode = discoveredCode;
      }
    }
    if (!normalizedCode) return;
    setClassCode(normalizedCode);
    setIsSyncing(true);
    setStatusMessage({ type: "info", text: `Đang kết nối tới LMS để đồng bộ lớp ${normalizedCode}...` });

    try {
      const res = await fetch("/api/session-comments/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classCode: normalizedCode }),
      });
      const data = await res.json();

      if (data.success) {
        const syncedClassId = (data.classId || normalizedCode).trim().toUpperCase();
        const syncedLmsObjId =
          typeof data.lmsClassId === "string" && isValidLmsClassObjectIdInline(data.lmsClassId)
            ? data.lmsClassId.trim()
            : "";
        if (syncedLmsObjId) {
          setLmsClassIdsByCode((prev) => ({ ...prev, [syncedClassId]: syncedLmsObjId }));
        }
        const targetSessId =
          data.latestActiveSessionId ||
          (data.sessions && data.sessions.length > 0 ? findLatestActiveSessionId(data.sessions) : "");

        setRunningClasses((prev) => {
          if (prev.some((c) => c.classCode === syncedClassId)) {
            return syncedLmsObjId
              ? prev.map((c) =>
                  c.classCode === syncedClassId ? { ...c, lmsClassId: syncedLmsObjId } : c
                )
              : prev;
          }
          return [
            ...prev,
            {
              classCode: syncedClassId,
              ...(syncedLmsObjId ? { lmsClassId: syncedLmsObjId } : {}),
              status: "Running",
            },
          ];
        });
        setClassId(syncedClassId);
        if (targetSessId) {
          setSelectedSessionId(targetSessId);
        }

        const activeSlotNum = targetSessId.match(/(\d+)$/)?.[1] || "";
        setStatusMessage({
          type: "success",
          text: `Đồng bộ thành công lớp ${syncedClassId}! Tìm thấy ${data.sessionsCount} buổi học (đã tự động chọn Buổi ${activeSlotNum ? parseInt(activeSlotNum, 10) : 1}) và ${data.studentsCount} học viên.`,
        });
        await loadClassData(syncedClassId, targetSessId);
      } else {
        setStatusMessage({
          type: "error",
          text: `Đồng bộ thất bại: ${data.error || "Không thể mở lớp trên LMS"}`,
        });
      }
    } catch (err: any) {
      setStatusMessage({ type: "error", text: `Lỗi kết nối API: ${err.message}` });
    } finally {
      setIsSyncing(false);
    }
  };

  // Open the selected class directly in the MindX LMS Drawer Comments tab (tab=10)
  const handleOpenClassOnLms = async () => {
    const targetCode = String(classCode || classId || "").trim().toUpperCase();
    if (!targetCode) {
      setStatusMessage({
        type: "error",
        text: "Vui lòng chọn hoặc nhập mã lớp trước khi mở trang LMS.",
      });
      return;
    }

    const matchedRunning = runningClasses.find(
      (c) => String(c?.classCode || "").trim().toUpperCase() === targetCode
    );
    const cachedIdCandidate = String(
      lmsClassIdsByCode[targetCode] || matchedRunning?.lmsClassId || ""
    ).trim();
    const cachedId = isValidLmsClassObjectIdInline(cachedIdCandidate)
      ? cachedIdCandidate
      : "";

    if (typeof window === "undefined" || typeof window.open !== "function") {
      return;
    }

    // Fast path: cached LMS class ObjectId -> open exact Drawer + Comments tab synchronously (0ms)
    if (cachedId) {
      const directUrl = buildLmsClassCommentsUrlSafe({
        lmsBaseUrl,
        classCode: targetCode,
        lmsClassId: cachedId,
        tab: 10,
      });
      const popup = window.open(directUrl, "_blank");
      if (!popup) {
        setStatusMessage({
          type: "error",
          text: "Trình duyệt đã chặn cửa sổ bật lên (Popup). Thầy vui lòng cho phép mở tab mới cho trang này rồi bấm lại nhé.",
        });
        return;
      }
      try {
        popup.opener = null;
      } catch {}
      return;
    }

    // Uncached first-time path: claim popup synchronously inside click gesture, then redirect
    if (openingLmsInFlightRef.current) return;
    const fallbackSearchUrl = buildLmsClassCommentsUrlSafe({
      lmsBaseUrl,
      classCode: targetCode,
    });
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      setStatusMessage({
        type: "error",
        text: "Trình duyệt đã chặn cửa sổ bật lên (Popup). Thầy vui lòng cho phép mở tab mới cho trang này rồi bấm lại nhé.",
      });
      return;
    }
    try {
      popup.opener = null;
    } catch {}

    try {
      if (popup.document) {
        const safeCodeHtml = escapeHtmlInline(targetCode);
        popup.document.open();
        popup.document.write(
          `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Đang mở lớp ${safeCodeHtml}...</title><style>body{font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;color:#1e293b}div{text-align:center;padding:24px;border-radius:12px;background:#fff;border:1px solid #cbd5e1;box-shadow:0 4px 12px rgba(15,23,42,.08);max-width:420px}h2{margin:0 0 8px;font-size:18px}p{margin:0;font-size:14px;color:#475569}</style></head><body><div><h2>Đang mở lớp ${safeCodeHtml} trên MindX LMS...</h2><p>Bot đang lấy đúng đường dẫn mục Nhận xét (Comments). Vui lòng đợi trong giây lát.</p></div></body></html>`
        );
        popup.document.close();
      }
    } catch {}

    openingLmsInFlightRef.current = true;
    setOpeningLmsClass(targetCode);
    const reqSeq = ++openingLmsReqSeqRef.current;

    try {
      const res = await fetch("/api/classes/lms-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classCode: targetCode, tab: 10 }),
      });
      const json = await res.json().catch(() => null);
      if (json?.success && isValidLmsClassObjectIdInline(json?.lmsClassId)) {
        const resolvedId = String(json.lmsClassId).trim();
        setLmsClassIdsByCode((prev) => ({ ...prev, [targetCode]: resolvedId }));
        const finalUrl =
          typeof json.url === "string" && /^https?:\/\//i.test(json.url)
            ? json.url
            : buildLmsClassCommentsUrlSafe({
                lmsBaseUrl,
                classCode: targetCode,
                lmsClassId: resolvedId,
                tab: 10,
              });
        if (!popup.closed) {
          popup.location.replace(finalUrl);
        }
      } else {
        const fbUrl =
          typeof json?.fallbackSearchUrl === "string" &&
          /^https?:\/\//i.test(json.fallbackSearchUrl)
            ? json.fallbackSearchUrl
            : fallbackSearchUrl;
        if (!popup.closed) {
          popup.location.replace(fbUrl);
        }
        if (activeClassIdRef.current === targetCode) {
          setStatusMessage({
            type: "info",
            text: `Chưa lấy được mã định danh Drawer của lớp ${targetCode} từ LMS nên đã mở sẵn ô tìm kiếm lớp ${targetCode} trên MindX LMS.`,
          });
        }
      }
    } catch {
      try {
        if (!popup.closed) {
          popup.location.replace(fallbackSearchUrl);
        }
      } catch {}
      if (activeClassIdRef.current === targetCode) {
        setStatusMessage({
          type: "info",
          text: `Không kết nối được API tra cứu nhanh nên đã mở trang tìm kiếm lớp ${targetCode} trên MindX LMS.`,
        });
      }
    } finally {
      if (openingLmsReqSeqRef.current === reqSeq) {
        openingLmsInFlightRef.current = false;
        setOpeningLmsClass(null);
      }
    }
  };

  // Auto-detect Syllabus topic whenever session number changes
  useEffect(() => {
    const sess = sessions.find((s) => s.sessionId === selectedSessionId);
    const sessionNum = sess?.sessionNumber || 1;

    // Match by prefix (longest courseCode match first, e.g. PREB before ROB)
    const upperCode = classCode.toUpperCase();
    const sortedSyllabus = [...syllabusList].sort(
      (a, b) => (b.courseCode?.length || 0) - (a.courseCode?.length || 0)
    );
    let matchedCourse = sortedSyllabus.find((c) =>
      upperCode.includes(String(c.courseCode || "").toUpperCase())
    );
    if (!matchedCourse && syllabusList.length > 0) {
      matchedCourse = syllabusList[0];
    }

    if (matchedCourse) {
      const lesson = matchedCourse.sessions.find((s) => s.sessionNumber === sessionNum);
      if (lesson) {
        setCurrentTopic(lesson.topic);
        setCurrentKeyKnowledge(Array.isArray(lesson.keyKnowledge) ? lesson.keyKnowledge : []);
        setCurrentHomeworkBrief(lesson.homeworkBrief || "");
      } else {
        setCurrentTopic(sess?.topic || `Buổi ${sessionNum}`);
        setCurrentKeyKnowledge([]);
        setCurrentHomeworkBrief("");
      }
    } else {
      setCurrentTopic(sess?.topic || `Buổi ${sessionNum}`);
      setCurrentKeyKnowledge([]);
      setCurrentHomeworkBrief("");
    }
  }, [selectedSessionId, sessions, classCode, syllabusList]);

  const formatShortZaloName = (fullName: string) => {
    if (typeof sharedFormatShortZaloName === "function") {
      return sharedFormatShortZaloName(fullName);
    }
    const words = String(fullName || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return words.length >= 3 ? words.slice(1).join(" ") : words.join(" ");
  };

  const addDaysToDdMmYyyy = (dateStr?: string, daysToAdd = 7): string => {
    if (typeof sharedAddDaysToDdMmYyyy === "function") {
      return sharedAddDaysToDdMmYyyy(dateStr, daysToAdd);
    }
    if (!dateStr) return "";
    const m = String(dateStr)
      .trim()
      .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return "";
    const d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    if (Number.isNaN(d.getTime())) return "";
    d.setDate(d.getDate() + daysToAdd);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = String(d.getFullYear());
    const weekdays = [
      "Chủ nhật",
      "Thứ Hai",
      "Thứ Ba",
      "Thứ Tư",
      "Thứ Năm",
      "Thứ Sáu",
      "Thứ Bảy",
    ];
    return `${weekdays[d.getDay()] || ""}, ngày ${dd}/${mm}/${yyyy}`;
  };

  const buildAutoZaloBroadcastText = (
    part2Override?: string,
    optionsOverride?: {
      includeCheckpointSummary?: boolean;
      includeGeneralUpdate?: boolean;
      includeSpckProgress?: boolean;
      includePart3MediaReminder?: boolean;
    }
  ) => {
    const activePart2 = part2Override !== undefined ? part2Override : zaloBtvnPart2Text;
    const effCheckpointSummary =
      optionsOverride?.includeCheckpointSummary !== undefined
        ? optionsOverride.includeCheckpointSummary
        : zaloIncludeCheckpointSummary;
    const effGeneralUpdate =
      optionsOverride?.includeGeneralUpdate !== undefined
        ? optionsOverride.includeGeneralUpdate
        : zaloIncludeGeneralUpdate;
    const effSpckProgress =
      optionsOverride?.includeSpckProgress !== undefined
        ? optionsOverride.includeSpckProgress
        : zaloIncludeSpckProgress;
    const effPart3Media =
      optionsOverride?.includePart3MediaReminder !== undefined
        ? optionsOverride.includePart3MediaReminder
        : zaloIncludePart3Media;

    if (typeof sharedBuildAutoZaloBroadcastText === "function") {
      return sharedBuildAutoZaloBroadcastText({
        classCode,
        selectedSessionId,
        sessions,
        students,
        currentTopic,
        currentKeyKnowledge,
        currentHomeworkBrief,
        syllabusList,
        part2Text: activePart2,
        includeCheckpointSummary: effCheckpointSummary,
        includeGeneralUpdate: effGeneralUpdate,
        includeSpckProgress: effSpckProgress,
        includePart3MediaReminder: effPart3Media,
      });
    }
    const sess = sessions.find((s) => s.sessionId === selectedSessionId);
    const sessionNum = sess?.sessionNumber || 1;
    const sessionDate = sess?.date || sess?.sessionDate || "chưa xác nhận ngày học";
    const hasConfirmedDate =
      Boolean(sessionDate) && sessionDate !== "chưa xác nhận ngày học";
    const activeStudents = students.filter((s) => s.isActive !== false);
    const totalStudents = activeStudents.length;
    const hasUnconfirmedAttendance =
      totalStudents === 0 ||
      activeStudents.some((s) => !s.attendanceStatus || s.attendanceStatus === "UNKNOWN");
    const presentStudents = activeStudents.filter(
      (s) => s.attendanceStatus === "PRESENT" || s.attendanceStatus === "LATE"
    ).length;
    const absentStudents = activeStudents.filter((s) => s.attendanceStatus === "ABSENT");
    const absentShortNames = absentStudents.map((s) => formatShortZaloName(s.fullName));
    const attendanceStr = hasUnconfirmedAttendance
      ? `${totalStudents > 0 ? totalStudents : "..."} (chưa xác nhận đầy đủ điểm danh) ổn định đầu giờ tốt.`
      : presentStudents === totalStudents
      ? `${totalStudents}/${totalStudents} (đi học đầy đủ) ổn định đầu giờ tốt.`
      : `${presentStudents}/${totalStudents} (vắng bạn ${
          absentShortNames.length > 0
            ? absentShortNames.join(", ")
            : `${totalStudents - presentStudents} bạn`
        }) ổn định đầu giờ tốt.`;
    const nextSessionNum = sessionNum + 1;
    const nextSess = sessions.find((s) => s.sessionNumber === nextSessionNum);
    const upperCode = classCode.trim().toUpperCase();
    const sortedSyllabus = [...syllabusList].sort(
      (a, b) => (b.courseCode?.length || 0) - (a.courseCode?.length || 0)
    );
    const matchedCourse = sortedSyllabus.find((c) =>
      upperCode.includes(String(c.courseCode || "").toUpperCase())
    );
    const nextSyllabusSess = matchedCourse?.sessions.find((s) => s.sessionNumber === nextSessionNum);
    const nextTopic = (
      nextSyllabusSess?.topic ||
      nextSess?.topic ||
      `NỘI DUNG BUỔI ${nextSessionNum}`
    )
      .replace(/^(?:BÀI|BUỔI)\s+\d+\s*:\s*/i, "")
      .trim()
      .toUpperCase();
    const rawNextDate = (nextSess?.date || nextSess?.sessionDate || "").trim();
    const nextDateWithWeekday = rawNextDate
      ? addDaysToDdMmYyyy(rawNextDate, 0) || `Ngày ${rawNextDate}`
      : addDaysToDdMmYyyy(sessionDate, 7);
    const nextTimeLine =
      nextDateWithWeekday || "Theo lịch học cố định của lớp (chưa xác nhận ngày cụ thể)";
    const deadlineLine = nextDateWithWeekday || "Trước buổi học kế tiếp";
    const rawKnowledgeItems =
      currentKeyKnowledge.length > 0 ? currentKeyKnowledge : [currentTopic];
    const isRoboticsZalo =
      isRoboticsClassCodeSafe(upperCode) ||
      /\b(ROB|ROBOTICS|PREB|PREA|PREI|ARMB|ARMA|ARMI|SEMIB|SEMIA|SEMII|VEX|KIRO|LEGO)\w*/i.test(upperCode) ||
      /(?:-|_)ROB|[A-Z]*ROB\d/i.test(upperCode);
    if (isRoboticsZalo) {
      const sessionNumPad2 = String(sessionNum).padStart(2, "0");
      const nextSessionNumPad2 = String(nextSessionNum).padStart(2, "0");
      const totalPad2 = totalStudents > 0 ? String(totalStudents).padStart(2, "0") : "..";
      const effectivePresent = hasUnconfirmedAttendance
        ? Math.max(0, totalStudents - absentStudents.length)
        : presentStudents;
      const presentPad2 =
        totalStudents > 0 ? String(effectivePresent).padStart(2, "0") : "..";
      const absentSuffix =
        !hasUnconfirmedAttendance && absentShortNames.length > 0
          ? ` (Vắng: ${absentShortNames.join(", ")})`
          : "";
      const cleanTopicCasePreserved =
        String(currentTopic || `Bài ${sessionNum}`)
          .replace(/^(?:BÀI|BUỔI)\s+\d+\s*[-:–.]*\s*/i, "")
          .trim() || `Bài học buổi ${sessionNum}`;
      const roboticsKnowledgeLines = rawKnowledgeItems
        .map((item) => {
          const cleanItem = String(item || "")
            .trim()
            .replace(/^(?:[-•*🔹+]\s*)+/, "")
            .trim();
          return cleanItem ? `🔹 ${cleanItem}` : "";
        })
        .filter(Boolean)
        .join("\n");
      const joinedKnowledge = rawKnowledgeItems.join(" ");
      const hasConditionLoopSensor =
        /điều kiện|if\.\.\.else/i.test(joinedKnowledge) &&
        /vòng lặp/i.test(joinedKnowledge) &&
        /cảm biến/i.test(joinedKnowledge);
      const roboticsGeneralFeedback = hasConditionLoopSensor
        ? `Trong buổi học số ${sessionNumPad2}, các con tham gia học tập nghiêm túc, tích cực trao đổi với giáo viên và thực hành các nhiệm vụ được giao. Qua bài học, các con được rèn luyện kỹ năng lắp ráp, tư duy logic và vận dụng câu lệnh điều kiện, vòng lặp cùng cảm biến vào lập trình mô hình.`
        : `Trong buổi học số ${sessionNumPad2}, các con tham gia học tập nghiêm túc, tích cực trao đổi với giáo viên và thực hành các nhiệm vụ được giao. Qua bài học, các con được rèn luyện kỹ năng lắp ráp, tư duy logic và vận dụng kiến thức đã học vào chế tạo, lập trình mô hình.`;
      const trimmedHw = String(currentHomeworkBrief || "").trim();
      const roboticsHwLines = trimmedHw
        ? trimmedHw
            .split(/\r?\n/)
            .flatMap((line) =>
              line
                .replace(/^(?:[-•*🔹+]\s*)+/, "")
                .trim()
                .split(
                  /(?<=[.!?])\s+(?=[A-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ])/
                )
            )
            .map((s) => s.trim())
            .filter(Boolean)
            .join("\n")
        : [
            "Ôn tập các câu lệnh và nguyên lý lắp ráp đã học trong buổi học.",
            "Chuẩn bị bài cho buổi học tiếp theo.",
          ].join("\n");
      const cleanNextTopicCasePreserved =
        String(nextSyllabusSess?.topic || nextSess?.topic || `Nội dung buổi ${nextSessionNum}`)
          .replace(/^(?:BÀI|BUỔI)\s+\d+\s*[-:–.]*\s*/i, "")
          .trim() || `Nội dung buổi ${nextSessionNum}`;
      const roboticsPart1 = `📢 TỔNG KẾT BUỔI HỌC SỐ ${sessionNumPad2} – ${upperCode}
@All Kính gửi quý phụ huynh, giáo viên xin phép tổng kết sau buổi học số ${sessionNumPad2}${
        hasConfirmedDate ? ` ngày ${sessionDate}` : ""
      }.
👥 Sĩ số: ${totalPad2} học viên | ✅ Hiện diện: ${presentPad2} học viên${absentSuffix}
📝 NỘI DUNG BUỔI HỌC
📚 Bài ${sessionNum}: ${cleanTopicCasePreserved}
${roboticsKnowledgeLines}
🌟 TÌNH HÌNH HỌC TẬP
${roboticsGeneralFeedback}
🏡 BÀI TẬP VỀ NHÀ
${roboticsHwLines}
🗓 BUỔI HỌC TIẾP THEO – BUỔI ${nextSessionNumPad2}
⏰ ${nextTimeLine}
📚 Nội dung: Bài ${nextSessionNum} – ${cleanNextTopicCasePreserved}
💖 Giáo viên chân thành cảm ơn Quý Phụ huynh đã luôn đồng hành và hỗ trợ các con trong quá trình học tập!`;
      return activePart2 ? `${roboticsPart1}\n\n${activePart2}` : roboticsPart1;
    }
    const keyKnowledgeText = rawKnowledgeItems
      .map((item) => {
        const t = String(item || "").trim();
        return /^[-•*]/.test(t) ? t.replace(/^[•*]\s*/, "- ") : `- ${t}`;
      })
      .join("\n");
    const isGameMakerCourse = /\b(GA|GB|GI)\d*/i.test(upperCode);
    const keyNotesText = isGameMakerCourse
      ? [
          "- Trình bày được mối liên hệ giữa giao diện, nhân vật và luật chơi trong vòng lặp chơi chính.",
          "- Thực hiện lập trình ổn định các cơ chế điều khiển và chức năng cốt lõi của sản phẩm.",
          "- Thực hiện kiểm thử từng chức năng sau khi hoàn thành để đảm bảo chương trình vận hành mượt mà.",
        ].join("\n")
      : currentKeyKnowledge.length > 0
      ? [
          `- Trình bày được ý nghĩa và vận dụng kiến thức trọng tâm: ${String(
            currentKeyKnowledge[0] || ""
          ).replace(/^[-•*]\s*/, "")}`,
          "- Thực hiện viết code/xây dựng sản phẩm và kiểm thử từng chức năng để đảm bảo chương trình vận hành ổn định.",
          "- Thực hiện hoàn thiện dự án cá nhân và rèn luyện tư duy giải quyết vấn đề.",
        ].join("\n")
      : [
          "- Trình bày được các khái niệm và cấu trúc lệnh trọng tâm đã học trong buổi.",
          "- Thực hiện kiểm thử từng chức năng của sản phẩm để đảm bảo chương trình vận hành ổn định.",
          "- Thực hiện phát triển thêm các tính năng mở rộng cho dự án.",
        ].join("\n");
    const defaultDeniseLines = [
      "+ 10 câu hỏi trắc nghiệm.",
      "+ 2 bài thực hành (làm theo yêu cầu đề bài).",
    ];
    const customHwTrimmed = String(currentHomeworkBrief || "")
      .trim()
      .replace(/^[+-]\s*/, "");
    const homeworkDetails = customHwTrimmed
      ? [...defaultDeniseLines, `+ ${customHwTrimmed}`].join("\n")
      : defaultDeniseLines.join("\n");
    const cleanTopicUpper = String(currentTopic || `Buổi ${sessionNum}`)
      .replace(/^(?:BÀI|BUỔI)\s+\d+\s*:\s*/i, "")
      .trim()
      .toUpperCase();
    const part1 = `@All Kính gửi quý phụ huynh, giáo viên xin phép tổng kết sau buổi học số ${sessionNum}${
      hasConfirmedDate ? ` ngày ${sessionDate}` : sessionDate ? ` – ${sessionDate}` : ""
    }
Mã lớp: ${upperCode}

- Lớp sĩ số ${attendanceStr}
- Các con nhớ bài tốt, tự giác trong quá trình học và năng nổ phát biểu, xây dựng bài trong buổi học.

📘 NỘI DUNG BUỔI HỌC:
BÀI ${sessionNum}: ${cleanTopicUpper}
${keyKnowledgeText}

📍 NHỮNG ĐIỂM CẦN LƯU Ý:
${keyNotesText}

📝 NHIỆM VỤ KHI VỀ NHÀ:
Làm bài tập về nhà trên Denise bao gồm:
${homeworkDetails}
⏰ Hạn nộp: ${deadlineLine}

📌 NỘI DUNG BUỔI HỌC KẾ TIẾP:
Thời gian: ${nextTimeLine}
Nội dung bài học: BUỔI ${nextSessionNum}: ${nextTopic}`;
    return activePart2 ? `${part1}\n\n${activePart2}` : part1;
  };

  const handleUploadBtvnImage = async (file?: File | null) => {
    if (!file) return;
    setIsAnalyzingBtvnImage(true);
    setStatusMessage({
      type: "info",
      text: "Đang đọc ảnh chụp BTVN để lọc danh sách học sinh 'Not submitted' (Phần 2 Zalo)...",
    });

    try {
      const base64DataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Không thể đọc file ảnh BTVN."));
        reader.readAsDataURL(file);
      });

      const res = await fetch("/api/session-comments/zalo-btvn-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: base64DataUrl,
          mimeType: file.type || "image/png",
        }),
      });
      const json = await res.json();
      if (json.success && json.data?.part2Text) {
        const part2 = String(json.data.part2Text);
        restoredManualLockRef.current = "";
        setZaloBtvnPart2Text(part2);
        setIsZaloManuallyEdited(false);
        setZaloBroadcastText(buildAutoZaloBroadcastText(part2));
        const unsubmittedList: string[] = json.data.unsubmittedShortNames || [];
        setStatusMessage({
          type: "success",
          text:
            unsubmittedList.length > 0
              ? `Đã trích xuất ảnh BTVN và thêm Phần 2 vào thông báo Zalo (${unsubmittedList.length} bạn chưa nộp: ${unsubmittedList.join(", ")}).`
              : "Đã đọc ảnh BTVN: Cả lớp hoàn thành 100% BTVN! Đã thêm Phần 2 khen ngợi vào thông báo Zalo.",
        });
      } else {
        setStatusMessage({
          type: "error",
          text: `Không thể phân tích ảnh BTVN: ${json.error || "Lỗi không xác định"}`,
        });
      }
    } catch (err: any) {
      setStatusMessage({
        type: "error",
        text: `Lỗi khi tải ảnh BTVN: ${err?.message || String(err)}`,
      });
    } finally {
      setIsAnalyzingBtvnImage(false);
      if (btvnImageInputRef.current) {
        btvnImageInputRef.current.value = "";
      }
    }
  };

  const handleFetchBtvnFromLms = async (forceLiveScrape = false) => {
    const reqScopeClassId = classId.trim().toUpperCase();
    const reqClassCode = (classCode || reqScopeClassId).trim().toUpperCase();
    const reqSessionId = selectedSessionId.trim();
    const sess = sessions.find((s) => s.sessionId === reqSessionId);
    const reqSessNum =
      sess?.sessionNumber || parseInt(reqSessionId.match(/(\d+)(?!.*\d)/)?.[1] || "1", 10);

    if (
      !reqClassCode ||
      !reqSessionId ||
      reqSessNum < 2 ||
      isFetchingBtvnLms ||
      isAnalyzingBtvnImage
    ) {
      return;
    }

    setIsFetchingBtvnLms(true);
    setStatusMessage({
      type: "info",
      text: forceLiveScrape
        ? `Đang quét mới bảng nộp BTVN Buổi ${reqSessNum - 1} trực tiếp từ MindX LMS...`
        : `Đang lấy kết quả BTVN Buổi ${reqSessNum - 1} trực tiếp từ MindX LMS...`,
    });

    try {
      const res = await fetch("/api/session-comments/btvn-from-lms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: reqClassCode,
          sessionNumber: reqSessNum,
          ...(forceLiveScrape ? { forceLiveScrape: true } : {}),
        }),
      });
      const json = await res.json();
      if (
        (reqScopeClassId && activeClassIdRef.current !== reqScopeClassId) ||
        activeSessionIdRef.current !== reqSessionId
      ) {
        return;
      }

      if (res.ok && json?.success && typeof json?.data?.part2Text === "string") {
        const part2 = String(json.data.part2Text);
        restoredManualLockRef.current = "";
        setZaloBtvnPart2Text(part2);
        setIsZaloManuallyEdited(false);
        setZaloBroadcastText(buildAutoZaloBroadcastText(part2));
        const unsubmittedList: string[] = Array.isArray(json.data.unsubmittedShortNames)
          ? json.data.unsubmittedShortNames
          : [];
        const hwSess = json.data.targetHomeworkSession || reqSessNum - 1;
        setStatusMessage({
          type: "success",
          text:
            unsubmittedList.length > 0
              ? `Đã lấy BTVN Buổi ${hwSess} từ LMS và gắn Phần 2 vào Zalo (${unsubmittedList.length} bạn chưa nộp: ${unsubmittedList.join(", ")}).`
              : `Đã lấy BTVN Buổi ${hwSess} từ LMS: Cả lớp hoàn thành 100% BTVN! Đã gắn Phần 2 vào Zalo.`,
        });
      } else {
        setStatusMessage({
          type: "error",
          text: `Không lấy được BTVN từ LMS: ${json?.error || `HTTP ${res.status}`}`,
        });
      }
    } catch (err: any) {
      if (
        (!reqScopeClassId || activeClassIdRef.current === reqScopeClassId) &&
        activeSessionIdRef.current === reqSessionId
      ) {
        setStatusMessage({
          type: "error",
          text: `Lỗi khi lấy BTVN từ LMS: ${err?.message || String(err)}`,
        });
      }
    } finally {
      setIsFetchingBtvnLms(false);
    }
  };

  const handleApplyClassroomLogsInline = async () => {
    const reqScopeClassId = classId.trim().toUpperCase();
    const reqClassCode = (classCode || reqScopeClassId).trim().toUpperCase();
    const reqSessionId = selectedSessionId.trim();
    const sess = sessions.find((s) => s.sessionId === reqSessionId);
    const reqSessNum =
      sess?.sessionNumber || parseInt(reqSessionId.match(/(\d+)(?!.*\d)/)?.[1] || "1", 10);

    if (!reqClassCode || !reqSessionId || reqSessNum <= 0 || isApplyingClassroomLogs) {
      return;
    }

    setIsApplyingClassroomLogs(true);
    setStatusMessage({
      type: "info",
      text: `Đang nạp dữ liệu Nhật ký Giờ học (Buổi ${reqSessNum}) vào nhận xét...`,
    });

    try {
      const flushedOk = await flushAllPendingDraftSaves();
      if (
        !flushedOk ||
        (reqScopeClassId && activeClassIdRef.current !== reqScopeClassId) ||
        activeSessionIdRef.current !== reqSessionId
      ) {
        return;
      }

      const res = await fetch("/api/classroom-manager/apply-to-comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: reqClassCode,
          sessionNumber: reqSessNum,
        }),
      });
      const json = await res.json();
      if (
        (reqScopeClassId && activeClassIdRef.current !== reqScopeClassId) ||
        activeSessionIdRef.current !== reqSessionId
      ) {
        return;
      }

      if (!res.ok || !json?.success) {
        setStatusMessage({
          type: "error",
          text: `Không thể nạp Nhật ký Giờ học: ${json?.error || `HTTP ${res.status}`}`,
        });
        return;
      }

      setPendingClassroomLogsCount(0);
      await loadClassData(reqScopeClassId || reqClassCode, reqSessionId, {
        preserveLocalUnsavedEdits: false,
      });
      const appliedCount = Number(json.appliedCount || 0);
      const skippedVerified = Number(json.skippedVerifiedCount || 0);
      setStatusMessage({
        type: "success",
        text:
          skippedVerified > 0
            ? `Đã nạp Nhật ký Giờ học cho ${appliedCount} học viên (giữ nguyên ${skippedVerified} bạn đã lưu LMS).`
            : `Đã nạp Nhật ký Giờ học (Buổi ${reqSessNum}) cho ${appliedCount} học viên.`,
      });
    } catch (err: any) {
      setStatusMessage({
        type: "error",
        text: `Lỗi khi nạp Nhật ký Giờ học: ${err?.message || String(err)}`,
      });
    } finally {
      setIsApplyingClassroomLogs(false);
    }
  };

  // Update Zalo broadcast template preview only when teacher has not manually edited it
  useEffect(() => {
    const curCode = (classId || classCode || "").trim().toUpperCase();
    const curSess = selectedSessionId.trim();
    const curScopeKey = curCode && curSess ? `${curCode}::${curSess}` : "";
    if (isZaloManuallyEdited) return;
    if (curScopeKey && restoredManualLockRef.current === curScopeKey) return;
    setZaloBroadcastText(buildAutoZaloBroadcastText());
  }, [
    isZaloManuallyEdited,
    classId,
    classCode,
    selectedSessionId,
    sessions,
    students,
    currentTopic,
    currentKeyKnowledge,
    currentHomeworkBrief,
    syllabusList,
    zaloBtvnPart2Text,
    zaloIncludeCheckpointSummary,
    zaloIncludeGeneralUpdate,
    zaloIncludeSpckProgress,
    zaloIncludePart3Media,
  ]);

  // Persist Zalo draft (broadcastText, part2Text, isManuallyEdited) per class + session after client mount
  useEffect(() => {
    const persistCode = (classId || classCode || "").trim().toUpperCase();
    const persistSess = selectedSessionId.trim();
    const persistScopeKey = persistCode && persistSess ? `${persistCode}::${persistSess}` : "";
    if (!persistScopeKey || hydratedZaloScopeKey !== persistScopeKey) return;
    if (
      !isZaloManuallyEdited &&
      zaloBroadcastText.trim().length === 0 &&
      zaloBtvnPart2Text.trim().length === 0
    ) {
      return;
    }
    writeStoredZaloDraft(persistCode, persistSess, {
      broadcastText: zaloBroadcastText,
      part2Text: zaloBtvnPart2Text,
      isManuallyEdited: isZaloManuallyEdited,
    });
  }, [
    classId,
    classCode,
    selectedSessionId,
    hydratedZaloScopeKey,
    zaloBroadcastText,
    zaloBtvnPart2Text,
    isZaloManuallyEdited,
  ]);

  // Handle Quick Tag Toggle (1-click radio swap for Level tags + multi-select for Note tags)
  const toggleQuickTag = async (studentId: string, tagLabel: string) => {
    studentEditVersionRef.current[studentId] = ++editSequenceRef.current;
    const target = studentsRef.current.find((s) => s.studentId === studentId);
    const preEditSnapshot = target
      ? { ...target, quickTags: Array.isArray(target.quickTags) ? [...target.quickTags] : [] }
      : undefined;
    const currentTags = target?.quickTags || [];
    const isLevel = isQuickTagLevel(tagLabel, quickTags);
    const computedNewTags = currentTags.includes(tagLabel)
      ? currentTags.filter((t) => t !== tagLabel)
      : isLevel
      ? [tagLabel, ...currentTags.filter((t) => !isQuickTagLevel(t, quickTags))]
      : [...currentTags, tagLabel];
    const nextDraftStatus =
      target?.status === "APPROVED" || target?.status === "VERIFIED"
        ? "DRAFT"
        : target?.status || "DRAFT";

    setStudents((prev) =>
      prev.map((s) => {
        if (s.studentId !== studentId) return s;
        const tags = s.quickTags || [];
        const newTags = tags.includes(tagLabel)
          ? tags.filter((t) => t !== tagLabel)
          : isLevel
          ? [tagLabel, ...tags.filter((t) => !isQuickTagLevel(t, quickTags))]
          : [...tags, tagLabel];
        const demotedStatus =
          s.status === "APPROVED" || s.status === "VERIFIED" ? "DRAFT" : s.status;

        return {
          ...s,
          quickTags: newTags,
          inheritedFromSession: undefined,
          status: demotedStatus,
          contentHash: demotedStatus !== s.status ? undefined : s.contentHash,
        };
      })
    );
    await saveDraftToServer(
      studentId,
      { quickTags: computedNewTags, status: nextDraftStatus },
      preEditSnapshot
    );
  };

  const flushPendingDraftSave = async (
    studentId: string,
    options?: { keepalive?: boolean }
  ): Promise<boolean> => {
    const timer = debouncedTimersRef.current[studentId];
    if (timer !== undefined) {
      clearTimeout(timer);
      delete debouncedTimersRef.current[studentId];
    }
    const pendingPayload = debouncedPayloadsRef.current[studentId];
    const resolvers = debouncedResolversRef.current[studentId] || [];
    if (pendingPayload) {
      delete debouncedPayloadsRef.current[studentId];
      delete debouncedResolversRef.current[studentId];
      const priorUnsaved = unsavedDraftPatchRef.current[studentId];
      let retryablePriorPatch: Partial<StudentItem> = {};
      if (priorUnsaved) {
        const retainedStalePatch: Partial<StudentItem> = {};
        const retainedStaleVers: Record<string, number> = {};
        const retainedStaleReasons: Record<string, "error" | "stale"> = {};
        for (const k of Object.keys(priorUnsaved.patch)) {
          if (k === "status") continue;
          const val = (priorUnsaved.patch as any)[k];
          if (val === undefined) continue;
          const isStaleField =
            priorUnsaved.fieldReasons?.[k] === "stale" ||
            (!priorUnsaved.fieldReasons && priorUnsaved.reason === "stale");
          if (isStaleField && (pendingPayload.patch as any)[k] === undefined) {
            (retainedStalePatch as any)[k] = val;
            retainedStaleVers[k] = priorUnsaved.fieldVersions?.[k] || priorUnsaved.editVersion;
            retainedStaleReasons[k] = "stale";
          } else {
            (retryablePriorPatch as any)[k] = val;
          }
        }
        const retainedKeys = Object.keys(retainedStalePatch);
        if (retainedKeys.length > 0) {
          retainedStalePatch.status = "DRAFT";
          unsavedDraftPatchRef.current[studentId] = {
            ...priorUnsaved,
            patch: retainedStalePatch,
            fieldVersions: retainedStaleVers,
            fieldReasons: retainedStaleReasons,
            reason: "stale",
          };
        } else {
          delete unsavedDraftPatchRef.current[studentId];
        }
      }
      const mergedPatch = { ...retryablePriorPatch, ...pendingPayload.patch };
      const mergedSnapshot = priorUnsaved?.preEditSnapshot || pendingPayload.preEditSnapshot;
      const ok = await saveDraftToServer(
        studentId,
        mergedPatch,
        mergedSnapshot,
        options
      );
      let allInflightOk = ok;
      const remainingActive = activeSavePromisesByStudentRef.current[studentId];
      if (remainingActive && remainingActive.size > 0) {
        const activeResults = await Promise.all(Array.from(remainingActive));
        if (!activeResults.every(Boolean)) {
          allInflightOk = false;
        }
      }
      if (unsavedDraftPatchRef.current[studentId]) {
        allInflightOk = false;
      }
      for (const resolve of resolvers) {
        try {
          resolve(allInflightOk);
        } catch {}
      }
      return allInflightOk;
    }
    const activeSet = activeSavePromisesByStudentRef.current[studentId];
    if (activeSet && activeSet.size > 0) {
      const activeResults = await Promise.all(Array.from(activeSet));
      if (!activeResults.every(Boolean)) {
        return false;
      }
    } else {
      const inflight = pendingSavePromisesRef.current[studentId];
      if (inflight) {
        const inflightOk = await inflight;
        if (!inflightOk) return false;
      }
    }
    const unsaved = unsavedDraftPatchRef.current[studentId];
    if (unsaved) {
      const retryablePatch: Partial<StudentItem> = {};
      const retainedStalePatch: Partial<StudentItem> = {};
      const retainedStaleVers: Record<string, number> = {};
      const retainedStaleReasons: Record<string, "error" | "stale"> = {};
      for (const k of Object.keys(unsaved.patch)) {
        if (k === "status") continue;
        const val = (unsaved.patch as any)[k];
        if (val === undefined) continue;
        const isStaleField =
          unsaved.fieldReasons?.[k] === "stale" ||
          (!unsaved.fieldReasons && unsaved.reason === "stale");
        if (isStaleField) {
          (retainedStalePatch as any)[k] = val;
          retainedStaleVers[k] = unsaved.fieldVersions?.[k] || unsaved.editVersion;
          retainedStaleReasons[k] = "stale";
        } else {
          (retryablePatch as any)[k] = val;
        }
      }
      const retryKeys = Object.keys(retryablePatch);
      const staleKeys = Object.keys(retainedStalePatch);
      if (retryKeys.length === 0) {
        setStatusMessage({ type: "error", text: unsaved.errorText });
        return false;
      }
      if (staleKeys.length > 0) {
        retainedStalePatch.status = "DRAFT";
        unsavedDraftPatchRef.current[studentId] = {
          ...unsaved,
          patch: retainedStalePatch,
          fieldVersions: retainedStaleVers,
          fieldReasons: retainedStaleReasons,
          reason: "stale",
        };
      } else {
        delete unsavedDraftPatchRef.current[studentId];
      }
      retryablePatch.status = "DRAFT";
      const retryOk = await saveDraftToServer(
        studentId,
        retryablePatch,
        unsaved.preEditSnapshot,
        options
      );
      if (staleKeys.length > 0 || unsavedDraftPatchRef.current[studentId]) {
        setStatusMessage({ type: "error", text: unsaved.errorText });
        return false;
      }
      return retryOk;
    }
    return true;
  };

  const flushAllPendingDraftSaves = async (options?: {
    keepalive?: boolean;
  }): Promise<boolean> => {
    const pendingIds = Array.from(
      new Set([
        ...Object.keys(debouncedPayloadsRef.current),
        ...Object.keys(pendingSavePromisesRef.current),
        ...Object.keys(activeSavePromisesByStudentRef.current),
        ...Object.keys(unsavedDraftPatchRef.current),
      ])
    );
    if (pendingIds.length === 0) return true;
    const results = await Promise.all(
      pendingIds.map((id) => flushPendingDraftSave(id, options))
    );
    return results.every(Boolean);
  };

  useEffect(() => {
    try {
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        const onBeforeUnload = (e?: any) => {
          const hasPending =
            Object.keys(debouncedPayloadsRef.current).length > 0 ||
            Object.keys(pendingSavePromisesRef.current).length > 0 ||
            Object.keys(activeSavePromisesByStudentRef.current).length > 0 ||
            Object.keys(unsavedDraftPatchRef.current).length > 0;
          if (hasPending) {
            void flushAllPendingDraftSaves({ keepalive: true });
            if (e && typeof e.preventDefault === "function") {
              e.preventDefault();
              e.returnValue = "";
            }
          }
        };
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => {
          window.removeEventListener("beforeunload", onBeforeUnload);
        };
      }
    } catch {}
  }, [classId, selectedSessionId]);

  const scheduleDebouncedDraftSave = (
    studentId: string,
    patch: Partial<StudentItem>,
    preEditSnapshot?: StudentItem,
    debounceMs?: number
  ): Promise<boolean> => {
    const curVer = studentEditVersionRef.current[studentId] || 0;
    if (!studentFieldEditVersionRef.current[studentId]) {
      studentFieldEditVersionRef.current[studentId] = {};
    }
    if (!studentUnconfirmedBaseVerRef.current[studentId]) {
      studentUnconfirmedBaseVerRef.current[studentId] = {};
    }
    const curServerMeta = studentServerMetaRef.current[studentId];
    for (const k of Object.keys(patch)) {
      if (k !== "status" && (patch as any)[k] !== undefined) {
        if (studentUnconfirmedBaseVerRef.current[studentId][k] === undefined) {
          studentUnconfirmedBaseVerRef.current[studentId][k] =
            curServerMeta?.fields?.[k]?.ver ?? 0;
        }
        studentFieldEditVersionRef.current[studentId][k] = Math.max(
          studentFieldEditVersionRef.current[studentId][k] || 0,
          curVer
        );
      }
    }

    const effectiveDelay =
      typeof debounceMs === "number"
        ? debounceMs
        : typeof (globalThis as any).__MINDX_DEBOUNCE_MS__ === "number"
        ? Number((globalThis as any).__MINDX_DEBOUNCE_MS__)
        : typeof window !== "undefined"
        ? DRAFT_SAVE_DEBOUNCE_MS
        : 0;

    if (effectiveDelay <= 0) {
      const existingTimer = debouncedTimersRef.current[studentId];
      if (existingTimer !== undefined) {
        clearTimeout(existingTimer);
        delete debouncedTimersRef.current[studentId];
      }
      const prevPending = debouncedPayloadsRef.current[studentId];
      delete debouncedPayloadsRef.current[studentId];
      const mergedPatch = prevPending ? { ...prevPending.patch, ...patch } : patch;
      const mergedSnapshot = prevPending?.preEditSnapshot || preEditSnapshot;
      const prevResolvers = debouncedResolversRef.current[studentId] || [];
      delete debouncedResolversRef.current[studentId];
      return saveDraftToServer(studentId, mergedPatch, mergedSnapshot).then((ok) => {
        for (const resolve of prevResolvers) {
          try {
            resolve(ok);
          } catch {}
        }
        return ok;
      });
    }

    const existingTimer = debouncedTimersRef.current[studentId];
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer);
    }

    const prevPending = debouncedPayloadsRef.current[studentId];
    debouncedPayloadsRef.current[studentId] = {
      patch: prevPending ? { ...prevPending.patch, ...patch } : { ...patch },
      preEditSnapshot: prevPending?.preEditSnapshot || preEditSnapshot,
    };

    const promise = new Promise<boolean>((resolve) => {
      const list = debouncedResolversRef.current[studentId] || [];
      list.push(resolve);
      debouncedResolversRef.current[studentId] = list;
    });

    syncPendingSavePromiseRef(studentId, promise);
    debouncedTimersRef.current[studentId] = setTimeout(() => {
      void flushPendingDraftSave(studentId);
    }, effectiveDelay);

    return promise;
  };

  // Handle Note Change with debounced auto-save (600ms + flush on blur/beforeunload)
  const handleNoteChange = (
    studentId: string,
    note: string,
    options?: { debounceMs?: number; immediate?: boolean }
  ) => {
    studentEditVersionRef.current[studentId] = ++editSequenceRef.current;
    const existingUnsaved = unsavedDraftPatchRef.current[studentId];
    if (existingUnsaved) {
      const nextPatch = { ...existingUnsaved.patch };
      const nextFieldVers = { ...(existingUnsaved.fieldVersions || {}) };
      const nextFieldReasons = { ...(existingUnsaved.fieldReasons || {}) };
      delete nextPatch.teacherNote;
      delete nextFieldVers.teacherNote;
      delete nextFieldReasons.teacherNote;
      const remainingKeys = Object.keys(nextPatch).filter(
        (k) => k !== "status" && (nextPatch as any)[k] !== undefined
      );
      if (remainingKeys.length === 0) {
        delete unsavedDraftPatchRef.current[studentId];
      } else {
        const hasRemainingStale = remainingKeys.some((k) => nextFieldReasons[k] === "stale");
        unsavedDraftPatchRef.current[studentId] = {
          ...existingUnsaved,
          patch: nextPatch,
          fieldVersions: nextFieldVers,
          fieldReasons: nextFieldReasons,
          reason: hasRemainingStale ? "stale" : "error",
        };
      }
    }
    const target = studentsRef.current.find((s) => s.studentId === studentId);
    const preEditSnapshot = target
      ? { ...target, quickTags: Array.isArray(target.quickTags) ? [...target.quickTags] : [] }
      : undefined;
    const nextDraftStatus =
      target?.status === "APPROVED" || target?.status === "VERIFIED"
        ? "DRAFT"
        : target?.status || "DRAFT";

    setStudents((prev) =>
      prev.map((s) => {
        if (s.studentId !== studentId) return s;
        const demotedStatus =
          s.status === "APPROVED" || s.status === "VERIFIED" ? "DRAFT" : s.status;
        return {
          ...s,
          teacherNote: note,
          status: demotedStatus,
          contentHash: demotedStatus !== s.status ? undefined : s.contentHash,
        };
      })
    );
    void scheduleDebouncedDraftSave(
      studentId,
      {
        teacherNote: note,
        status: nextDraftStatus,
        ...(studentEditVersionRef.current[`__qt_pending__${studentId}`]
          ? { quickTags: Array.isArray(target?.quickTags) ? target.quickTags : [] }
          : target?.inheritedFromSession && target?.quickTags?.length
          ? { quickTags: target.quickTags }
          : {}),
      },
      preEditSnapshot,
      options?.immediate ? 0 : options?.debounceMs
    );
  };

  // Handle Attendance Change with instant auto-save and approval demotion
  const handleAttendanceChange = (
    studentId: string,
    explicitNextStatus?: StudentItem["attendanceStatus"]
  ) => {
    studentEditVersionRef.current[studentId] = ++editSequenceRef.current;
    studentAttendanceVersionRef.current[studentId] =
      (studentAttendanceVersionRef.current[studentId] || 0) + 1;
    const target = studentsRef.current.find((s) => s.studentId === studentId);
    const preEditSnapshot = target
      ? { ...target, quickTags: Array.isArray(target.quickTags) ? [...target.quickTags] : [] }
      : undefined;
    const currentAtt = target?.attendanceStatus || "UNKNOWN";
    const isCurrentlyPresent = currentAtt === "PRESENT" || currentAtt === "LATE";
    const nextAttStatus: NonNullable<StudentItem["attendanceStatus"]> =
      explicitNextStatus ||
      (currentAtt === "UNKNOWN" ? "PRESENT" : isCurrentlyPresent ? "ABSENT" : "PRESENT");
    const nextDraftStatus =
      target?.status === "APPROVED" || target?.status === "VERIFIED"
        ? "DRAFT"
        : target?.status || "DRAFT";

    setStudents((prev) =>
      prev.map((s) => {
        if (s.studentId !== studentId) return s;
        const demotedStatus =
          s.status === "APPROVED" || s.status === "VERIFIED" ? "DRAFT" : s.status;
        return {
          ...s,
          attendanceStatus: nextAttStatus,
          status: demotedStatus,
          contentHash: demotedStatus !== s.status ? undefined : s.contentHash,
        };
      })
    );
    saveDraftToServer(
      studentId,
      {
        attendanceStatus: nextAttStatus,
        status: nextDraftStatus,
        ...(studentEditVersionRef.current[`__qt_pending__${studentId}`]
          ? { quickTags: Array.isArray(target?.quickTags) ? target.quickTags : [] }
          : target?.inheritedFromSession && target?.quickTags?.length
          ? { quickTags: target.quickTags }
          : {}),
      },
      preEditSnapshot
    );
  };

  // Handle text edit with debounced auto-save (600ms + flush on blur/beforeunload)
  const handleTextEdit = (
    studentId: string,
    field: "strengths" | "improvements" | "actionPlan" | "finalText",
    value: string,
    options?: { debounceMs?: number; immediate?: boolean }
  ) => {
    studentEditVersionRef.current[studentId] = ++editSequenceRef.current;
    const existingUnsaved = unsavedDraftPatchRef.current[studentId];
    if (existingUnsaved) {
      const nextPatch = { ...existingUnsaved.patch };
      const nextFieldVers = { ...(existingUnsaved.fieldVersions || {}) };
      const nextFieldReasons = { ...(existingUnsaved.fieldReasons || {}) };
      for (const tf of ["strengths", "improvements", "actionPlan", "finalText"] as const) {
        if (nextFieldReasons[tf] === "stale") {
          delete (nextPatch as any)[tf];
          delete nextFieldVers[tf];
          delete nextFieldReasons[tf];
        }
      }
      const remainingKeys = Object.keys(nextPatch).filter(
        (k) => k !== "status" && (nextPatch as any)[k] !== undefined
      );
      if (remainingKeys.length === 0) {
        delete unsavedDraftPatchRef.current[studentId];
      } else {
        const hasRemainingStale = remainingKeys.some((k) => nextFieldReasons[k] === "stale");
        unsavedDraftPatchRef.current[studentId] = {
          ...existingUnsaved,
          patch: nextPatch,
          fieldVersions: nextFieldVers,
          fieldReasons: nextFieldReasons,
          reason: hasRemainingStale ? "stale" : "error",
        };
      }
    }
    const target = studentsRef.current.find((s) => s.studentId === studentId);
    if (!target) return;
    const preEditSnapshot: StudentItem = {
      ...target,
      quickTags: Array.isArray(target.quickTags) ? [...target.quickTags] : [],
    };
    const updated: StudentItem = { ...target, [field]: value };
    // Iron Rule 4: If previously approved or failed after approval, editing text demotes to DRAFT
    if (
      target.status === "APPROVED" ||
      target.status === "VERIFIED" ||
      target.status === "FAILED" ||
      (target.status === "INSUFFICIENT_INFO" && Boolean(value && value.trim()))
    ) {
      updated.status = "DRAFT";
      updated.contentHash = undefined;
    }
    setStudents((prev) => prev.map((s) => (s.studentId === studentId ? updated : s)));
    void scheduleDebouncedDraftSave(
      studentId,
      {
        strengths: updated.strengths,
        improvements: updated.improvements,
        actionPlan: updated.actionPlan,
        finalText: updated.finalText,
        status: updated.status,
      },
      preEditSnapshot,
      options?.immediate ? 0 : options?.debounceMs
    );
  };

  const saveDraftToServer = async (
    targetStudentId: string,
    patch: Partial<StudentItem>,
    preEditSnapshot?: StudentItem,
    options?: { keepalive?: boolean }
  ): Promise<boolean> => {
    const normalizedClassId = classId.trim().toUpperCase();
    const normalizedSessionId = selectedSessionId.trim();
    if (
      !normalizedClassId ||
      !normalizedSessionId ||
      activeClassIdRef.current !== normalizedClassId ||
      activeSessionIdRef.current !== normalizedSessionId
    ) {
      return false;
    }
    if (
      loadedScopeKeyRef.current &&
      loadedScopeKeyRef.current !== `${normalizedClassId}::${normalizedSessionId}`
    ) {
      return false;
    }
    const escapedClassId = normalizedClassId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sessPrefixRe = new RegExp(`^${escapedClassId}(?:_SESS_|[^a-zA-Z0-9_-])`, "i");
    if (!sessPrefixRe.test(normalizedSessionId)) {
      return false;
    }
    const student = studentsRef.current.find((s) => s.studentId === targetStudentId);
    if (!student) return false;
    if (student.classId && student.classId.trim().toUpperCase() !== normalizedClassId) {
      return false;
    }
    if (student.sessionId && student.sessionId.trim() !== normalizedSessionId) {
      return false;
    }

    const snapshotBase = preEditSnapshot || student;
    const previousStudentSnapshot: StudentItem = {
      ...snapshotBase,
      quickTags: Array.isArray(snapshotBase.quickTags) ? [...snapshotBase.quickTags] : [],
    };

    const requestScopeKey = `${normalizedClassId}::${normalizedSessionId}`;
    const requestEditVersion = ++editSequenceRef.current;
    studentEditVersionRef.current[targetStudentId] = requestEditVersion;
    if (patch.quickTags !== undefined) {
      studentEditVersionRef.current[`__qt_pending__${targetStudentId}`] = requestEditVersion;
    }

    const isStaleSaveResponse = () =>
      activeClassIdRef.current !== normalizedClassId ||
      activeSessionIdRef.current !== normalizedSessionId ||
      (loadedScopeKeyRef.current !== "" && loadedScopeKeyRef.current !== requestScopeKey) ||
      (studentEditVersionRef.current[targetStudentId] || 0) !== requestEditVersion;

    const rawCandidateStatus = patch.status || student.status || "DRAFT";
    const safeDraftStatus: StudentItem["status"] =
      rawCandidateStatus === "APPROVED" || rawCandidateStatus === "VERIFIED"
        ? "DRAFT"
        : rawCandidateStatus;

    // Ensure local React state reflects the demoted DRAFT / WAITING_APPROVAL status and patched fields
    setStudents((prev) =>
      prev.map((s) => {
        if (s.studentId !== targetStudentId) return s;
        if (s.classId && s.classId.trim().toUpperCase() !== normalizedClassId) return s;
        if (s.sessionId && s.sessionId.trim() !== normalizedSessionId) return s;
        const wasApprovedOrVerified =
          s.status === "APPROVED" ||
          s.status === "VERIFIED" ||
          (patch.finalText !== undefined &&
            (s.status === "FAILED" ||
              (s.status === "INSUFFICIENT_INFO" && Boolean(patch.finalText.trim()))));
        const nextStatus: StudentItem["status"] =
          patch.status === "WAITING_APPROVAL"
            ? "WAITING_APPROVAL"
            : wasApprovedOrVerified
            ? "DRAFT"
            : patch.status
            ? safeDraftStatus
            : s.status;
        const shouldClearHash = wasApprovedOrVerified || patch.status === "WAITING_APPROVAL";
        return {
          ...s,
          ...(patch.attendanceStatus !== undefined
            ? { attendanceStatus: patch.attendanceStatus }
            : {}),
          ...(patch.quickTags !== undefined ? { quickTags: patch.quickTags } : {}),
          ...(patch.teacherNote !== undefined ? { teacherNote: patch.teacherNote } : {}),
          ...(patch.strengths !== undefined ? { strengths: patch.strengths } : {}),
          ...(patch.improvements !== undefined ? { improvements: patch.improvements } : {}),
          ...(patch.actionPlan !== undefined ? { actionPlan: patch.actionPlan } : {}),
          ...(patch.finalText !== undefined ? { finalText: patch.finalText } : {}),
          ...(patch.checkpointData !== undefined ? { checkpointData: patch.checkpointData } : {}),
          status: nextStatus,
          contentHash: shouldClearHash ? undefined : s.contentHash,
        };
      })
    );

    const payload: Record<string, any> = {
      classId: normalizedClassId,
      sessionId: normalizedSessionId,
      studentId: targetStudentId,
      status: safeDraftStatus,
    };
    if (patch.attendanceStatus !== undefined) {
      payload.attendanceStatus = patch.attendanceStatus;
    }
    if (patch.quickTags !== undefined) {
      payload.quickTags = patch.quickTags;
    }
    if (patch.teacherNote !== undefined) {
      payload.teacherNote = patch.teacherNote;
    }
    if (patch.strengths !== undefined) {
      payload.strengths = patch.strengths;
    }
    if (patch.improvements !== undefined) {
      payload.improvements = patch.improvements;
    }
    if (patch.actionPlan !== undefined) {
      payload.actionPlan = patch.actionPlan;
    }
    if (patch.finalText !== undefined) {
      payload.finalText = patch.finalText;
    } else if (patch.teacherNote !== undefined && student.finalText) {
      payload.finalText = student.finalText;
    }
    if (patch.checkpointData !== undefined) {
      payload.checkpointData = patch.checkpointData;
    }

    const serverMeta = studentServerMetaRef.current[targetStudentId];
    const baseRowVer = serverMeta?.rowVer ?? 0;
    const explicitFieldKeys = Object.keys(patch).filter(
      (k) => k !== "status" && (patch as any)[k] !== undefined
    );
    if (!studentFieldEditVersionRef.current[targetStudentId]) {
      studentFieldEditVersionRef.current[targetStudentId] = {};
    }
    if (!studentUnconfirmedBaseVerRef.current[targetStudentId]) {
      studentUnconfirmedBaseVerRef.current[targetStudentId] = {};
    }
    for (const k of explicitFieldKeys) {
      if (studentUnconfirmedBaseVerRef.current[targetStudentId][k] === undefined) {
        studentUnconfirmedBaseVerRef.current[targetStudentId][k] =
          serverMeta?.fields?.[k]?.ver ?? 0;
      }
      studentFieldEditVersionRef.current[targetStudentId][k] = Math.max(
        studentFieldEditVersionRef.current[targetStudentId][k] || 0,
        requestEditVersion
      );
    }
    const unconfirmedBaseMap = studentUnconfirmedBaseVerRef.current[targetStudentId] || {};
    const fbaseEntries = explicitFieldKeys.map((k) => {
      const baseVer =
        unconfirmedBaseMap[k] !== undefined
          ? unconfirmedBaseMap[k]
          : serverMeta?.fields?.[k]?.ver ?? 0;
      return `${k}:${baseVer}`;
    });

    const isTextOrNotePatch =
      patch.teacherNote !== undefined ||
      patch.finalText !== undefined ||
      patch.strengths !== undefined ||
      patch.improvements !== undefined ||
      patch.actionPlan !== undefined;

    const isScopeChanged = () =>
      activeClassIdRef.current !== normalizedClassId ||
      activeSessionIdRef.current !== normalizedSessionId ||
      (loadedScopeKeyRef.current !== "" && loadedScopeKeyRef.current !== requestScopeKey);

    const getUnconfirmedFields = (): string[] => {
      if (isScopeChanged()) return [];
      const confirmedMap = studentFieldConfirmedVersionRef.current[targetStudentId] || {};
      return explicitFieldKeys.filter((k) => (confirmedMap[k] || 0) < requestEditVersion);
    };

    const recordUnsavedFailure = (
      reason: "error" | "stale",
      errorText: string,
      failedFields: string[]
    ) => {
      if (failedFields.length === 0) return;
      const prevUnsaved = unsavedDraftPatchRef.current[targetStudentId];
      const nextPatch: Partial<StudentItem> = prevUnsaved ? { ...prevUnsaved.patch } : {};
      const nextFieldVersions: Record<string, number> = prevUnsaved?.fieldVersions
        ? { ...prevUnsaved.fieldVersions }
        : {};
      const nextFieldReasons: Record<string, "error" | "stale"> = prevUnsaved?.fieldReasons
        ? { ...prevUnsaved.fieldReasons }
        : {};
      const latestStu = studentsRef.current.find((s) => s.studentId === targetStudentId);
      const latestEditVerMap = studentFieldEditVersionRef.current[targetStudentId] || {};
      for (const k of failedFields) {
        const prevFieldVer = nextFieldVersions[k] || 0;
        if (requestEditVersion >= prevFieldVer) {
          const newestKnownVer = Math.max(requestEditVersion, latestEditVerMap[k] || 0);
          nextFieldVersions[k] = newestKnownVer;
          nextFieldReasons[k] = reason;
          const pendingDebouncedVal = (debouncedPayloadsRef.current[targetStudentId]?.patch as any)?.[
            k
          ];
          const latestVal =
            pendingDebouncedVal !== undefined
              ? pendingDebouncedVal
              : latestEditVerMap[k] && latestEditVerMap[k] > requestEditVersion && latestStu
              ? (latestStu as any)[k]
              : (patch as any)[k];
          (nextPatch as any)[k] = latestVal;
        }
      }
      nextPatch.status = "DRAFT";
      const remainingFieldKeys = Object.keys(nextPatch).filter(
        (k) => k !== "status" && (nextPatch as any)[k] !== undefined
      );
      const hasAnyStaleField = remainingFieldKeys.some(
        (k) => nextFieldReasons[k] === "stale"
      );
      unsavedDraftPatchRef.current[targetStudentId] = {
        patch: nextPatch,
        fieldVersions: nextFieldVersions,
        fieldReasons: nextFieldReasons,
        preEditSnapshot: prevUnsaved?.preEditSnapshot || previousStudentSnapshot,
        reason: hasAnyStaleField ? "stale" : reason,
        errorText:
          hasAnyStaleField && reason !== "stale" && prevUnsaved?.reason === "stale"
            ? prevUnsaved.errorText
            : errorText,
        editVersion: Math.max(prevUnsaved?.editVersion || 0, requestEditVersion),
      };
    };

    const runSaveRequest = async (): Promise<boolean> => {
      try {
        const serializedBody = JSON.stringify(payload);
        const useKeepalive = Boolean(options?.keepalive && serializedBody.length <= 60000);
        const res = await fetch(
          `/api/session-comments/save-draft?cid=${clientInstanceIdRef.current}&rev=${requestEditVersion}&base=${baseRowVer}&fbase=${encodeURIComponent(fbaseEntries.join(","))}&f=${encodeURIComponent(explicitFieldKeys.join(","))}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Client-Instance": clientInstanceIdRef.current,
              "X-Edit-Revision": String(requestEditVersion),
              "X-Base-Revision": String(baseRowVer),
              "X-Field-Base-Revisions": fbaseEntries.join(","),
              "X-Edited-Fields": explicitFieldKeys.join(","),
            },
            body: serializedBody,
            ...(useKeepalive ? { keepalive: true } : {}),
          }
        );
        const data = typeof res?.json === "function" ? await res.json().catch(() => null) : null;
        if (
          (typeof res?.status === "number" && res.status >= 400) ||
          res?.ok === false ||
          (data && data.success === false)
        ) {
          const unconfirmedFields = getUnconfirmedFields();
          if (unconfirmedFields.length > 0) {
            const errText = `Lỗi lưu nháp: ${data?.error || "Không thể lưu chỉnh sửa vào SQLite."}`;
            if (isTextOrNotePatch) {
              recordUnsavedFailure("error", errText, unconfirmedFields);
            } else if (!isStaleSaveResponse()) {
              setStudents((prev) =>
                prev.map((s) =>
                  s.studentId === targetStudentId &&
                  (!s.classId || s.classId.trim().toUpperCase() === normalizedClassId) &&
                  (!s.sessionId || s.sessionId.trim() === normalizedSessionId)
                    ? previousStudentSnapshot
                    : s
                )
              );
            }
            setStatusMessage({
              type: "error",
              text: errText,
            });
          }
          return false;
        }
        if (data?.versionMeta) {
          const prevMeta = studentServerMetaRef.current[targetStudentId];
          const curRowVer = prevMeta?.rowVer ?? 0;
          if ((data.versionMeta.rowVer ?? 0) >= curRowVer) {
            const mergedFields = {
              ...(prevMeta?.fields || {}),
              ...(data.versionMeta.fields || {}),
            };
            const existingUnsaved = unsavedDraftPatchRef.current[targetStudentId];
            const existingPending = debouncedPayloadsRef.current[targetStudentId];
            const editVerMap = studentFieldEditVersionRef.current[targetStudentId] || {};
            const confirmedVerMap = studentFieldConfirmedVersionRef.current[targetStudentId] || {};
            const unconfirmedFieldKeys = new Set<string>([
              ...Object.keys(existingUnsaved?.patch || {}),
              ...Object.keys(existingPending?.patch || {}),
              ...Object.keys(editVerMap).filter(
                (k) => (editVerMap[k] || 0) > (confirmedVerMap[k] || 0)
              ),
            ]);
            for (const k of unconfirmedFieldKeys) {
              if (
                k !== "status" &&
                !explicitFieldKeys.includes(k) &&
                existingUnsaved?.fieldReasons?.[k] !== "stale"
              ) {
                if (prevMeta?.fields?.[k]) {
                  mergedFields[k] = prevMeta.fields[k];
                } else {
                  delete mergedFields[k];
                }
              }
            }
            studentServerMetaRef.current[targetStudentId] = {
              rowVer: data.versionMeta.rowVer ?? curRowVer,
              fields: mergedFields,
            };
          }
        }
        const serverStaleList: string[] = Array.isArray(data?.staleFields)
          ? data.staleFields.map((f: any) => String(f))
          : data?.staleIgnored
          ? [...explicitFieldKeys]
          : [];
        const serverAcceptedList: string[] = Array.isArray(data?.acceptedFields)
          ? data.acceptedFields.map((f: any) => String(f))
          : [];
        const rejectedStaleKeys = explicitFieldKeys.filter((k) => {
          if (serverStaleList.includes(k)) return true;
          if (data?.staleIgnored) return true;
          if (serverAcceptedList.length > 0 && !serverAcceptedList.includes(k)) return true;
          const fieldMeta = data?.versionMeta?.fields?.[k];
          if (
            fieldMeta &&
            fieldMeta.cid &&
            clientInstanceIdRef.current &&
            fieldMeta.cid !== clientInstanceIdRef.current
          ) {
            return true;
          }
          return false;
        });
        const acceptedFieldKeys = explicitFieldKeys.filter(
          (k) => !rejectedStaleKeys.includes(k)
        );

        if (acceptedFieldKeys.length > 0) {
          if (!studentFieldConfirmedVersionRef.current[targetStudentId]) {
            studentFieldConfirmedVersionRef.current[targetStudentId] = {};
          }
          for (const k of acceptedFieldKeys) {
            studentFieldConfirmedVersionRef.current[targetStudentId][k] = Math.max(
              studentFieldConfirmedVersionRef.current[targetStudentId][k] || 0,
              requestEditVersion
            );
            if (
              (studentFieldEditVersionRef.current[targetStudentId]?.[k] || 0) <=
              requestEditVersion
            ) {
              delete studentUnconfirmedBaseVerRef.current[targetStudentId]?.[k];
            }
          }
          const existingUnsaved = unsavedDraftPatchRef.current[targetStudentId];
          if (existingUnsaved) {
            const nextUnsavedPatch: Partial<StudentItem> = { ...existingUnsaved.patch };
            const nextUnsavedFieldVers: Record<string, number> = {
              ...(existingUnsaved.fieldVersions || {}),
            };
            const nextUnsavedFieldReasons: Record<string, "error" | "stale"> = {
              ...(existingUnsaved.fieldReasons || {}),
            };
            for (const k of acceptedFieldKeys) {
              if ((nextUnsavedFieldVers[k] || 0) <= requestEditVersion) {
                delete (nextUnsavedPatch as any)[k];
                delete nextUnsavedFieldVers[k];
                delete nextUnsavedFieldReasons[k];
              }
            }
            const remainingKeys = Object.keys(nextUnsavedPatch).filter(
              (k) => k !== "status" && (nextUnsavedPatch as any)[k] !== undefined
            );
            if (remainingKeys.length === 0) {
              delete unsavedDraftPatchRef.current[targetStudentId];
            } else {
              const hasRemainingStale = remainingKeys.some(
                (k) => nextUnsavedFieldReasons[k] === "stale"
              );
              unsavedDraftPatchRef.current[targetStudentId] = {
                ...existingUnsaved,
                patch: nextUnsavedPatch,
                fieldVersions: nextUnsavedFieldVers,
                fieldReasons: nextUnsavedFieldReasons,
                reason: hasRemainingStale ? "stale" : "error",
              };
            }
          }
          if (
            acceptedFieldKeys.includes("quickTags") &&
            (studentEditVersionRef.current[`__qt_pending__${targetStudentId}`] || 0) <=
              requestEditVersion
          ) {
            delete studentEditVersionRef.current[`__qt_pending__${targetStudentId}`];
          }
        }

        if (rejectedStaleKeys.length > 0) {
          const confirmedMap = studentFieldConfirmedVersionRef.current[targetStudentId] || {};
          const unconfirmedStaleFields = isScopeChanged()
            ? []
            : rejectedStaleKeys.filter((k) => (confirmedMap[k] || 0) < requestEditVersion);
          if (unconfirmedStaleFields.length > 0) {
            for (const k of unconfirmedStaleFields) {
              delete studentUnconfirmedBaseVerRef.current[targetStudentId]?.[k];
            }
            let conflictMsg = `Xung đột phiên bản: Dữ liệu của học viên '${student.fullName}' đã được cập nhật ở tab hoặc phiên khác. Bản vừa nhập chưa được lưu và đang được giữ trên màn hình để so sánh.`;
            setStatusMessage({
              type: "error",
              text: conflictMsg,
            });
            try {
              const listRes = await fetch(
                `/api/session-comments/list?classId=${encodeURIComponent(normalizedClassId)}&sessionId=${encodeURIComponent(normalizedSessionId)}`
              );
              const listJson =
                typeof listRes?.json === "function" ? await listRes.json().catch(() => null) : null;
              const serverFb = Array.isArray(listJson?.data?.feedbacks)
                ? listJson.data.feedbacks.find((f: any) => f.studentId === targetStudentId)
                : null;
              if (serverFb && !isScopeChanged()) {
                if (serverFb.versionMetaJson) {
                  try {
                    const parsedMeta =
                      typeof serverFb.versionMetaJson === "string"
                        ? JSON.parse(serverFb.versionMetaJson)
                        : serverFb.versionMetaJson;
                    if (parsedMeta && typeof parsedMeta === "object") {
                      const prevMeta = studentServerMetaRef.current[targetStudentId];
                      const mergedFields = {
                        ...(prevMeta?.fields || {}),
                        ...(parsedMeta.fields || {}),
                      };
                      const existingUnsaved = unsavedDraftPatchRef.current[targetStudentId];
                      const existingPending = debouncedPayloadsRef.current[targetStudentId];
                      const editVerMap = studentFieldEditVersionRef.current[targetStudentId] || {};
                      const confirmedVerMap =
                        studentFieldConfirmedVersionRef.current[targetStudentId] || {};
                      const unconfirmedFieldKeys = new Set<string>([
                        ...Object.keys(existingUnsaved?.patch || {}),
                        ...Object.keys(existingPending?.patch || {}),
                        ...Object.keys(editVerMap).filter(
                          (k) => (editVerMap[k] || 0) > (confirmedVerMap[k] || 0)
                        ),
                      ]);
                      for (const k of unconfirmedFieldKeys) {
                        if (
                          k !== "status" &&
                          !explicitFieldKeys.includes(k) &&
                          existingUnsaved?.fieldReasons?.[k] !== "stale"
                        ) {
                          if (prevMeta?.fields?.[k]) {
                            mergedFields[k] = prevMeta.fields[k];
                          } else {
                            delete mergedFields[k];
                          }
                        }
                      }
                      studentServerMetaRef.current[targetStudentId] = {
                        rowVer: parsedMeta.rowVer ?? prevMeta?.rowVer ?? 0,
                        fields: mergedFields,
                      };
                    }
                  } catch {
                    // ignore
                  }
                }
                let parsedServerTags: string[] = [];
                if (serverFb.quickTagsJson) {
                  try {
                    const rawTags =
                      typeof serverFb.quickTagsJson === "string"
                        ? JSON.parse(serverFb.quickTagsJson)
                        : serverFb.quickTagsJson;
                    if (Array.isArray(rawTags)) {
                      parsedServerTags = rawTags.map((t) => String(t));
                    }
                  } catch {
                    // ignore
                  }
                }
                const serverVal =
                  unconfirmedStaleFields.includes("teacherNote")
                    ? serverFb.teacherNote || "(trống)"
                    : unconfirmedStaleFields.includes("quickTags")
                    ? parsedServerTags.length > 0
                      ? parsedServerTags.join(", ")
                      : "(trống)"
                    : unconfirmedStaleFields.includes("strengths")
                    ? serverFb.strengths || "(trống)"
                    : unconfirmedStaleFields.includes("improvements")
                    ? serverFb.improvements || "(trống)"
                    : unconfirmedStaleFields.includes("actionPlan")
                    ? serverFb.actionPlan || "(trống)"
                    : unconfirmedStaleFields.includes("finalText")
                    ? serverFb.finalText || "(trống)"
                    : unconfirmedStaleFields.includes("attendanceStatus")
                    ? serverFb.attendanceStatus || "(trống)"
                    : serverFb.teacherNote ||
                      (parsedServerTags.length > 0 ? parsedServerTags.join(", ") : "") ||
                      serverFb.finalText ||
                      serverFb.attendanceStatus ||
                      "(trống)";
                if (serverVal) {
                  conflictMsg = `Xung đột phiên bản: Dữ liệu của học viên '${student.fullName}' đã được cập nhật ở tab hoặc phiên khác (Bản đã lưu: "${serverVal}"). Bản vừa nhập chưa được lưu và đang được giữ trên màn hình để so sánh.`;
                  setStatusMessage({
                    type: "error",
                    text: conflictMsg,
                  });
                }
              }
            } catch {
              // ignore
            }
            recordUnsavedFailure("stale", conflictMsg, unconfirmedStaleFields);
          }
          return false;
        }
        return true;
      } catch (err: any) {
        console.error("Lỗi lưu nháp:", err);
        const unconfirmedFields = getUnconfirmedFields();
        if (unconfirmedFields.length > 0) {
          const errText = `Lỗi lưu nháp: ${err?.message || String(err)}`;
          if (isTextOrNotePatch) {
            recordUnsavedFailure("error", errText, unconfirmedFields);
          } else if (!isStaleSaveResponse()) {
            setStudents((prev) =>
              prev.map((s) =>
                s.studentId === targetStudentId &&
                (!s.classId || s.classId.trim().toUpperCase() === normalizedClassId) &&
                (!s.sessionId || s.sessionId.trim() === normalizedSessionId)
                  ? previousStudentSnapshot
                  : s
              )
            );
          }
          setStatusMessage({
            type: "error",
            text: errText,
          });
        }
        return false;
      }
    };

    const savePromise = runSaveRequest();
    if (!activeSavePromisesByStudentRef.current[targetStudentId]) {
      activeSavePromisesByStudentRef.current[targetStudentId] = new Set();
    }
    activeSavePromisesByStudentRef.current[targetStudentId].add(savePromise);
    syncPendingSavePromiseRef(targetStudentId);
    try {
      return await savePromise;
    } finally {
      activeSavePromisesByStudentRef.current[targetStudentId]?.delete(savePromise);
      if (activeSavePromisesByStudentRef.current[targetStudentId]?.size === 0) {
        delete activeSavePromisesByStudentRef.current[targetStudentId];
      }
      syncPendingSavePromiseRef(targetStudentId);
    }
  };

  const handleConfirmAllPresent = async (
    assignDefaultGoodTag = false,
    options?: { onlyUnknown?: boolean; silent?: boolean }
  ): Promise<boolean> => {
    const reqClassId = classId.trim().toUpperCase();
    const reqSessionId = selectedSessionId.trim();
    const reqScopeKey = `${reqClassId}::${reqSessionId}`;
    if (
      !reqClassId ||
      !reqSessionId ||
      activeClassIdRef.current !== reqClassId ||
      activeSessionIdRef.current !== reqSessionId
    ) {
      return false;
    }
    if (loadedScopeKeyRef.current && loadedScopeKeyRef.current !== reqScopeKey) {
      return false;
    }

    const activeStudents = studentsRef.current.filter(
      (s) =>
        s.isActive !== false &&
        (!s.classId || s.classId.trim().toUpperCase() === reqClassId) &&
        (!s.sessionId || s.sessionId.trim() === reqSessionId) &&
        (!options?.onlyUnknown || !s.attendanceStatus || s.attendanceStatus === "UNKNOWN")
    );
    if (activeStudents.length === 0) return true;

    const defaultGoodLabel =
      quickTagTrack === "robotics" || detectTrackByClassCode(reqClassId) === "robotics"
        ? "🔧 Lắp ráp đúng mẫu"
        : "✅ Tiếp thu tốt";

    const initialAttendanceVersions = new Map<string, number>(
      activeStudents.map((s) => [s.studentId, studentAttendanceVersionRef.current[s.studentId] || 0])
    );

    interface PreparedBatchStudent {
      studentId: string;
      fullName: string;
      reqRev: number;
      shouldAddDefaultTag: boolean;
      previousAttendanceStatus: StudentItem["attendanceStatus"];
      previousQuickTags: string[];
      previousInheritedFromSession?: number;
      previousStatus: StudentItem["status"];
      previousContentHash?: string;
      payloadItem: Record<string, any>;
    }

    const preparedList: PreparedBatchStudent[] = [];
    let skippedConcurrentAttendanceCount = 0;

    for (const s of activeStudents) {
      if (
        (studentAttendanceVersionRef.current[s.studentId] || 0) !==
        initialAttendanceVersions.get(s.studentId)
      ) {
        skippedConcurrentAttendanceCount++;
        continue;
      }
      const curStu =
        studentsRef.current.find(
          (item) =>
            item.studentId === s.studentId &&
            (!item.classId || item.classId.trim().toUpperCase() === reqClassId) &&
            (!item.sessionId || item.sessionId.trim() === reqSessionId)
        ) || s;
      const hasPendingQuickTagsEdit = Boolean(
        studentEditVersionRef.current[`__qt_pending__${s.studentId}`]
      );
      const hasExistingOrInheritedTags = Boolean(
        curStu.quickTags && curStu.quickTags.length > 0
      );
      const shouldAddDefaultTag = Boolean(
        assignDefaultGoodTag && !hasExistingOrInheritedTags && !hasPendingQuickTagsEdit
      );
      const shouldPersistPendingOrInheritedTags = Boolean(
        hasPendingQuickTagsEdit || (hasExistingOrInheritedTags && curStu.inheritedFromSession)
      );
      const reqRev = ++editSequenceRef.current;
      studentEditVersionRef.current[s.studentId] = reqRev;
      const nextQuickTags = shouldAddDefaultTag
        ? [defaultGoodLabel]
        : shouldPersistPendingOrInheritedTags
        ? Array.isArray(curStu.quickTags)
          ? [...curStu.quickTags]
          : []
        : undefined;
      if (nextQuickTags !== undefined) {
        studentEditVersionRef.current[`__qt_pending__${s.studentId}`] = reqRev;
      }
      const rawCandidateStatus = curStu.status || "DRAFT";
      const safeDraftStatus: StudentItem["status"] =
        rawCandidateStatus === "APPROVED" || rawCandidateStatus === "VERIFIED"
          ? "DRAFT"
          : rawCandidateStatus;

      const serverMeta = studentServerMetaRef.current[s.studentId];
      const baseRowVer = serverMeta?.rowVer ?? 0;
      const explicitFields =
        nextQuickTags !== undefined ? ["attendanceStatus", "quickTags"] : ["attendanceStatus"];
      const fieldBaseMap: Record<string, number> = {};
      for (const f of explicitFields) {
        fieldBaseMap[f] = serverMeta?.fields?.[f]?.ver ?? 0;
      }

      preparedList.push({
        studentId: s.studentId,
        fullName: curStu.fullName || s.studentId,
        reqRev,
        shouldAddDefaultTag,
        previousAttendanceStatus: curStu.attendanceStatus,
        previousQuickTags: Array.isArray(curStu.quickTags) ? [...curStu.quickTags] : [],
        previousInheritedFromSession: curStu.inheritedFromSession,
        previousStatus: curStu.status,
        previousContentHash: curStu.contentHash,
        payloadItem: {
          classId: reqClassId,
          sessionId: reqSessionId,
          studentId: s.studentId,
          attendanceStatus: "PRESENT",
          status: safeDraftStatus,
          ...(nextQuickTags !== undefined ? { quickTags: nextQuickTags } : {}),
          clientInstanceId: clientInstanceIdRef.current,
          clientRevision: reqRev,
          baseRowVer,
          fieldBaseMap,
          explicitFields,
        },
      });
    }

    if (preparedList.length === 0) {
      return true;
    }

    const preparedById = new Map<string, PreparedBatchStudent>(
      preparedList.map((p) => [p.studentId, p])
    );

    setStudents((prev) =>
      prev.map((s) => {
        const prep = preparedById.get(s.studentId);
        if (!prep) return s;
        if (s.classId && s.classId.trim().toUpperCase() !== reqClassId) return s;
        if (s.sessionId && s.sessionId.trim() !== reqSessionId) return s;
        const wasApprovedOrVerified = s.status === "APPROVED" || s.status === "VERIFIED";
        return {
          ...s,
          attendanceStatus: "PRESENT",
          ...(prep.payloadItem.quickTags !== undefined
            ? { quickTags: prep.payloadItem.quickTags }
            : {}),
          status: wasApprovedOrVerified ? "DRAFT" : s.status || "DRAFT",
          contentHash: wasApprovedOrVerified ? undefined : s.contentHash,
        };
      })
    );

    const firstPrep = preparedList[0];
    const firstServerMeta = studentServerMetaRef.current[firstPrep.studentId];
    const firstBaseVer = firstServerMeta?.rowVer ?? 0;
    const firstExplicitFields: string[] = firstPrep.payloadItem.explicitFields || ["attendanceStatus"];
    const firstFbaseEntries = firstExplicitFields.map(
      (k) => `${k}:${firstServerMeta?.fields?.[k]?.ver ?? 0}`
    );

    const batchItems = preparedList.map((p) => p.payloadItem);
    const batchPayload: Record<string, any> = {
      classId: reqClassId,
      sessionId: reqSessionId,
      studentId: firstPrep.studentId,
      attendanceStatus: "PRESENT",
      status: firstPrep.payloadItem.status || "DRAFT",
      ...(firstPrep.payloadItem.quickTags !== undefined
        ? { quickTags: firstPrep.payloadItem.quickTags }
        : {}),
      items: batchItems,
    };

    let successCount = skippedConcurrentAttendanceCount;
    let taggedCount = 0;
    let failCount = 0;
    const failedIds = new Set<string>();
    const failedVersions = new Map<string, number>();
    const failedNames: string[] = [];

    const runBatchSave = async (): Promise<boolean> => {
      try {
        const res = await fetch(
          `/api/session-comments/save-draft?cid=${clientInstanceIdRef.current}&rev=${firstPrep.reqRev}&base=${firstBaseVer}&fbase=${encodeURIComponent(firstFbaseEntries.join(","))}&f=${encodeURIComponent(firstExplicitFields.join(","))}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Client-Instance": clientInstanceIdRef.current,
              "X-Edit-Revision": String(firstPrep.reqRev),
              "X-Base-Revision": String(firstBaseVer),
              "X-Field-Base-Revisions": firstFbaseEntries.join(","),
              "X-Edited-Fields": firstExplicitFields.join(","),
            },
            body: JSON.stringify(batchPayload),
          }
        );
        const data = typeof res?.json === "function" ? await res.json().catch(() => null) : null;

        if (Array.isArray(data?.results) && data.results.length > 0) {
          const resultByStudent = new Map<string, any>(
            data.results.map((r: any) => [String(r?.studentId || ""), r])
          );
          for (const prep of preparedList) {
            const itemRes = resultByStudent.get(prep.studentId);
            if (itemRes?.versionMeta) {
              const curRowVer = studentServerMetaRef.current[prep.studentId]?.rowVer ?? 0;
              if ((itemRes.versionMeta.rowVer ?? 0) >= curRowVer) {
                studentServerMetaRef.current[prep.studentId] = itemRes.versionMeta;
              }
            }
            if (itemRes && itemRes.success && !itemRes.staleIgnored) {
              successCount++;
              if (prep.shouldAddDefaultTag) {
                taggedCount++;
              }
              if (
                prep.payloadItem.quickTags !== undefined &&
                (studentEditVersionRef.current[`__qt_pending__${prep.studentId}`] || 0) <=
                  prep.reqRev
              ) {
                delete studentEditVersionRef.current[`__qt_pending__${prep.studentId}`];
              }
            } else {
              failCount++;
              failedIds.add(prep.studentId);
              failedVersions.set(prep.studentId, prep.reqRev);
              failedNames.push(prep.fullName);
            }
          }
        } else {
          const requestFailed =
            (typeof res?.status === "number" && res.status >= 400) ||
            res?.ok === false ||
            (data && data.success === false) ||
            Boolean(data?.staleIgnored);

          if (!requestFailed) {
            if (data?.versionMeta && preparedList.length === 1) {
              studentServerMetaRef.current[firstPrep.studentId] = data.versionMeta;
            }
            for (const prep of preparedList) {
              successCount++;
              if (prep.shouldAddDefaultTag) {
                taggedCount++;
              }
              if (
                prep.payloadItem.quickTags !== undefined &&
                (studentEditVersionRef.current[`__qt_pending__${prep.studentId}`] || 0) <=
                  prep.reqRev
              ) {
                delete studentEditVersionRef.current[`__qt_pending__${prep.studentId}`];
              }
            }
          } else {
            for (const prep of preparedList) {
              failCount++;
              failedIds.add(prep.studentId);
              failedVersions.set(prep.studentId, prep.reqRev);
              failedNames.push(prep.fullName);
            }
          }
        }
        return failCount === 0;
      } catch {
        for (const prep of preparedList) {
          failCount++;
          failedIds.add(prep.studentId);
          failedVersions.set(prep.studentId, prep.reqRev);
          failedNames.push(prep.fullName);
        }
        return false;
      }
    };

    const batchPromise = runBatchSave();
    for (const prep of preparedList) {
      pendingSavePromisesRef.current[prep.studentId] = batchPromise;
    }
    try {
      await batchPromise;
    } finally {
      for (const prep of preparedList) {
        if (pendingSavePromisesRef.current[prep.studentId] === batchPromise) {
          delete pendingSavePromisesRef.current[prep.studentId];
        }
      }
    }

    if (
      activeClassIdRef.current !== reqClassId ||
      activeSessionIdRef.current !== reqSessionId ||
      (loadedScopeKeyRef.current !== "" && loadedScopeKeyRef.current !== reqScopeKey)
    ) {
      return false;
    }

    if (failCount === 0) {
      setPendingUnknownConfirmCount(0);
      if (!options?.silent) {
        setStatusMessage({
          type: "success",
          text: assignDefaultGoodTag
            ? `Đã điểm danh 'Có mặt' (${successCount} học viên) và gắn thẻ mặc định "${defaultGoodLabel}" cho ${taggedCount} bạn chưa chọn thẻ! Thầy chỉ cần chỉnh lại vài bạn nổi bật hoặc cần lưu ý.`
            : `Đã xác nhận điểm danh 'Có mặt' cho toàn bộ ${successCount} học viên đang học.`,
        });
      }
      return true;
    }

    // Roll back failed items whose edit version has not changed since the batch request
    setStudents((prev) =>
      prev.map((s) => {
        if (!failedIds.has(s.studentId)) return s;
        if (s.classId && s.classId.trim().toUpperCase() !== reqClassId) return s;
        if (s.sessionId && s.sessionId.trim() !== reqSessionId) return s;
        if ((studentEditVersionRef.current[s.studentId] || 0) !== failedVersions.get(s.studentId)) {
          return s;
        }
        const prep = preparedById.get(s.studentId);
        if (!prep) return s;
        return {
          ...s,
          attendanceStatus: prep.previousAttendanceStatus,
          quickTags: prep.previousQuickTags,
          inheritedFromSession: prep.previousInheritedFromSession,
          status: prep.previousStatus,
          contentHash: prep.previousContentHash,
        };
      })
    );

    // Reconcile failed rows with server feedback truth if available without wiping rows or clobbering newer edits
    try {
      const res = await fetch(
        `/api/session-comments/list?classId=${encodeURIComponent(reqClassId)}&sessionId=${encodeURIComponent(reqSessionId)}`
      );
      const json = typeof res?.json === "function" ? await res.json().catch(() => null) : null;
      if (
        activeClassIdRef.current === reqClassId &&
        activeSessionIdRef.current === reqSessionId &&
        (loadedScopeKeyRef.current === "" || loadedScopeKeyRef.current === reqScopeKey) &&
        json?.success &&
        Array.isArray(json?.data?.feedbacks)
      ) {
        const fbMap = new Map<string, any>(
          json.data.feedbacks.map((f: any) => [f.studentId, f])
        );
        setStudents((prev) =>
          prev.map((s) => {
            if (!failedIds.has(s.studentId)) return s;
            if (s.classId && s.classId.trim().toUpperCase() !== reqClassId) return s;
            if (s.sessionId && s.sessionId.trim() !== reqSessionId) return s;
            if ((studentEditVersionRef.current[s.studentId] || 0) !== failedVersions.get(s.studentId)) {
              return s;
            }
            const fb = fbMap.get(s.studentId);
            if (!fb) return s;
            let serverTags = s.quickTags;
            if (fb.quickTagsJson) {
              try {
                const parsed = JSON.parse(fb.quickTagsJson);
                if (Array.isArray(parsed)) serverTags = parsed;
              } catch {}
            }
            return {
              ...s,
              attendanceStatus: fb.attendanceStatus || "UNKNOWN",
              quickTags: serverTags,
              contentHash: fb.contentHash || undefined,
              status: fb.status || "DRAFT",
              verifiedAt: fb.verifiedAt,
            };
          })
        );
      }
    } catch {}

    if (
      activeClassIdRef.current === reqClassId &&
      activeSessionIdRef.current === reqSessionId &&
      (loadedScopeKeyRef.current === "" || loadedScopeKeyRef.current === reqScopeKey)
    ) {
      setStatusMessage({
        type: "error",
        text: `Lỗi xác nhận điểm danh hàng loạt: thành công ${successCount}/${activeStudents.length}, thất bại ${failCount} học viên (${failedNames.join(", ")}).`,
      });
    }
    return false;
  };

  // AI Generate Batch Comments (with automatic UNKNOWN attendance prompt per S3.2)
  const handleGenerateAi = async (options?: { confirmUnknownAsPresent?: boolean }) => {
    const flushedOk = await flushAllPendingDraftSaves();
    if (!flushedOk) return;

    const reqClassId = classId.trim().toUpperCase();
    const reqClassCode = classCode.trim().toUpperCase();
    const reqSessionId = selectedSessionId.trim();

    const activeInClass = studentsRef.current.filter(
      (s) =>
        s.isActive !== false &&
        (!s.classId || s.classId.trim().toUpperCase() === reqClassId) &&
        (!s.sessionId || s.sessionId.trim() === reqSessionId)
    );
    const unknownStudents = activeInClass.filter(
      (s) => !s.attendanceStatus || s.attendanceStatus === "UNKNOWN"
    );

    if (unknownStudents.length > 0) {
      const promptMsg = `Coi ${unknownStudents.length} bạn chưa điểm danh là Có mặt (giữ nguyên các bạn Nghỉ học)?`;
      let shouldMarkUnknownPresent: boolean | null = null;
      if (typeof options?.confirmUnknownAsPresent === "boolean") {
        shouldMarkUnknownPresent = options.confirmUnknownAsPresent;
      } else if (typeof window !== "undefined" && typeof window.confirm === "function") {
        shouldMarkUnknownPresent = Boolean(window.confirm(promptMsg));
      } else if (typeof (globalThis as any).confirm === "function") {
        shouldMarkUnknownPresent = Boolean((globalThis as any).confirm(promptMsg));
      }

      if (shouldMarkUnknownPresent === true) {
        setPendingUnknownConfirmCount(0);
        const ok = await handleConfirmAllPresent(true, { onlyUnknown: true, silent: true });
        if (!ok) return;
      } else if (shouldMarkUnknownPresent === false) {
        setPendingUnknownConfirmCount(unknownStudents.length);
      } else {
        setPendingUnknownConfirmCount(unknownStudents.length);
      }
    } else {
      setPendingUnknownConfirmCount(0);
    }

    const eligibleStudents = studentsRef.current.filter(
      (s) =>
        s.isActive !== false &&
        (!s.classId || s.classId.trim().toUpperCase() === reqClassId) &&
        (s.attendanceStatus === "PRESENT" || s.attendanceStatus === "LATE")
    );

    if (eligibleStudents.length === 0) {
      setStatusMessage({
        type: "error",
        text:
          unknownStudents.length > 0
            ? `Còn ${unknownStudents.length} bạn chưa điểm danh. Vui lòng xác nhận 'Coi ${unknownStudents.length} bạn chưa điểm danh là Có mặt' hoặc bấm '⚡ Điểm danh cả lớp Có mặt' trước khi gọi AI soạn nhận xét.`
            : "Chưa có học viên nào được xác nhận 'Có mặt'. Vui lòng điểm danh từng học viên hoặc bấm '⚡ Điểm danh cả lớp Có mặt' trước khi gọi AI soạn nhận xét.",
      });
      return;
    }

    const aiRequestId = ++latestAiRequestIdRef.current;
    const initialStudentVersions = new Map<string, number>(
      eligibleStudents.map((s) => [s.studentId, studentEditVersionRef.current[s.studentId] || 0])
    );
    setIsGeneratingAi(true);
    setStatusMessage({
      type: "info",
      text: `Đang gọi Gemini 3.5 Flash Lite soạn nhận xét 3 phần cho ${eligibleStudents.length} học viên có mặt (đã ẩn danh)...`,
    });

    const sess = sessions.find((s) => s.sessionId === reqSessionId);
    const sessionNumber = sess?.sessionNumber || 1;

    try {
      const res = await fetch("/api/session-comments/generate-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session: {
            classId: reqClassId,
            classCode: reqClassCode,
            sessionId: reqSessionId,
            sessionNumber,
            topic: currentTopic,
            keyKnowledge: currentKeyKnowledge,
          },
          students: eligibleStudents.map((s) => ({
            studentId: s.studentId,
            fullName: s.fullName,
            isActive: s.isActive,
            attendanceStatus: s.attendanceStatus,
            quickTags: s.quickTags || [],
            teacherNote: s.teacherNote || "",
            expectedRowVer: studentServerMetaRef.current[s.studentId]?.rowVer ?? 0,
            ...(s.checkpointData ? { checkpointData: s.checkpointData } : {}),
          })),
        }),
      });

      const data = await res.json();
      if (
        aiRequestId !== latestAiRequestIdRef.current ||
        activeClassIdRef.current !== reqClassId ||
        activeSessionIdRef.current !== reqSessionId
      ) {
        return;
      }
      if (data.success && Array.isArray(data.data)) {
        const resultMap = new Map(data.data.map((r: any) => [r.studentId, r]));
        let skippedEditedCount = 0;

        setStudents((prev) =>
          prev.map((s) => {
            if (s.classId && s.classId.trim().toUpperCase() !== reqClassId) return s;
            const resItem = resultMap.get(s.studentId) as any;
            if (!resItem) return s;
            const wasEditedDuringAi =
              (studentEditVersionRef.current[s.studentId] || 0) !==
              initialStudentVersions.get(s.studentId);
            if (
              wasEditedDuringAi ||
              resItem.staleIgnored ||
              s.isActive === false ||
              (s.attendanceStatus !== "PRESENT" && s.attendanceStatus !== "LATE")
            ) {
              skippedEditedCount++;
              if (resItem.versionMeta && !wasEditedDuringAi) {
                studentServerMetaRef.current[s.studentId] = resItem.versionMeta;
              }
              return s;
            }
            if (resItem.versionMeta) {
              studentServerMetaRef.current[s.studentId] = resItem.versionMeta;
            }
            if (resItem.status === "FAILED") {
              const hasExistingDraft = Boolean(s.finalText && s.finalText.trim().length > 0);
              return {
                ...s,
                status: hasExistingDraft ? s.status : "FAILED",
                errorMessage: resItem.errorMessage || "AI không trả về nhận xét hợp lệ.",
              };
            }
            return {
              ...s,
              status: resItem.status,
              strengths: resItem.strengths,
              improvements: resItem.improvements,
              actionPlan: resItem.actionPlan,
              finalText: resItem.formattedFullComment,
              errorMessage: resItem.errorMessage,
              ...(resItem.checkpointData ? { checkpointData: resItem.checkpointData } : {}),
            };
          })
        );

        const draftedCount = data.data.filter(
          (r: any) => r.status === "DRAFT" && !r.staleIgnored
        ).length;
        const insufficientCount = data.data.filter(
          (r: any) => r.status === "INSUFFICIENT_INFO" && !r.staleIgnored
        ).length;

        setStatusMessage({
          type: "success",
          text:
            skippedEditedCount > 0
              ? `Đã soạn xong nhận xét cho ${draftedCount} học sinh (bỏ qua ${skippedEditedCount} học sinh vừa được giáo viên chỉnh sửa trong lúc chờ AI; cần xem lại nếu muốn tạo lại).`
              : `Đã soạn xong nhận xét cho ${draftedCount} học sinh. (${insufficientCount} học sinh chưa có tags/ghi chú -> giữ Chưa đủ thông tin).`,
        });
      } else {
        setStatusMessage({
          type: "error",
          text: `Lỗi AI Generator: ${data.error || "Không thể sinh nhận xét"}`,
        });
      }
    } catch (err: any) {
      if (aiRequestId === latestAiRequestIdRef.current) {
        setStatusMessage({ type: "error", text: `Lỗi gọi API: ${err.message}` });
      }
    } finally {
      if (aiRequestId === latestAiRequestIdRef.current) {
        setIsGeneratingAi(false);
      }
    }
  };

  // Generate AI comment for a single PRESENT/LATE student without touching any other student
  const handleGenerateSingleAi = async (targetStudentId: string) => {
    const reqClassId = classId.trim().toUpperCase();
    const reqClassCode = (classCode || reqClassId).trim().toUpperCase();
    const reqSessionId = selectedSessionId.trim();
    if (
      !reqClassId ||
      !reqSessionId ||
      activeClassIdRef.current !== reqClassId ||
      activeSessionIdRef.current !== reqSessionId
    ) {
      return;
    }
    if (generatingSingleStudentId || isGeneratingAi) return;

    setGeneratingSingleStudentId(targetStudentId);
    try {
      const flushedOk = await flushPendingDraftSave(targetStudentId);
      if (
        !flushedOk ||
        activeClassIdRef.current !== reqClassId ||
        activeSessionIdRef.current !== reqSessionId
      ) {
        return;
      }

      const targetStudent = studentsRef.current.find((s) => s.studentId === targetStudentId);
      if (
        !targetStudent ||
        targetStudent.isActive === false ||
        (targetStudent.attendanceStatus !== "PRESENT" && targetStudent.attendanceStatus !== "LATE")
      ) {
        setStatusMessage({
          type: "error",
          text: "Chỉ có thể gọi AI riêng cho học viên đang học và đã điểm danh Có mặt / Đi muộn.",
        });
        return;
      }

      const wasApprovedOrVerified =
        targetStudent.status === "APPROVED" || targetStudent.status === "VERIFIED";
      if (wasApprovedOrVerified) {
        const demotedOk = await saveDraftToServer(targetStudentId, {
          finalText: targetStudent.finalText || "",
          quickTags: targetStudent.quickTags || [],
          teacherNote: targetStudent.teacherNote || "",
          status: "WAITING_APPROVAL",
        });
        if (
          !demotedOk ||
          activeClassIdRef.current !== reqClassId ||
          activeSessionIdRef.current !== reqSessionId
        ) {
          return;
        }
      }

      const freshStudent =
        studentsRef.current.find((s) => s.studentId === targetStudentId) || targetStudent;
      const initialStudentVersion = studentEditVersionRef.current[targetStudentId] || 0;
      const sess = sessions.find((s) => s.sessionId === reqSessionId);
      const sessionNumber = sess?.sessionNumber || 1;

      setStatusMessage({
        type: "info",
        text: `Đang gọi AI soạn lại nhận xét riêng cho ${freshStudent.fullName}...`,
      });

      const res = await fetch("/api/session-comments/generate-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session: {
            classId: reqClassId,
            classCode: reqClassCode,
            sessionId: reqSessionId,
            sessionNumber,
            topic: currentTopic,
            keyKnowledge: currentKeyKnowledge,
          },
          students: [
            {
              studentId: freshStudent.studentId,
              fullName: freshStudent.fullName,
              isActive: freshStudent.isActive,
              attendanceStatus: freshStudent.attendanceStatus,
              quickTags: freshStudent.quickTags || [],
              teacherNote: freshStudent.teacherNote || "",
              expectedRowVer: studentServerMetaRef.current[targetStudentId]?.rowVer ?? 0,
              ...(freshStudent.checkpointData
                ? { checkpointData: freshStudent.checkpointData }
                : {}),
            },
          ],
        }),
      });

      const data = await res.json();
      if (
        activeClassIdRef.current !== reqClassId ||
        activeSessionIdRef.current !== reqSessionId
      ) {
        return;
      }

      if (!data?.success || !Array.isArray(data.data)) {
        setStatusMessage({
          type: "error",
          text: `Lỗi AI riêng (${freshStudent.fullName}): ${data?.error || "Không thể sinh nhận xét"}`,
        });
        return;
      }

      const resItem =
        data.data.find((r: any) => r.studentId === targetStudentId) || data.data[0];
      if (!resItem) {
        setStatusMessage({
          type: "error",
          text: `Không nhận được kết quả AI cho ${freshStudent.fullName}.`,
        });
        return;
      }

      const wasEditedDuringAi =
        (studentEditVersionRef.current[targetStudentId] || 0) !== initialStudentVersion;
      if (wasEditedDuringAi || resItem.staleIgnored) {
        if (resItem.versionMeta && !wasEditedDuringAi) {
          studentServerMetaRef.current[targetStudentId] = resItem.versionMeta;
        }
        setStatusMessage({
          type: "info",
          text: `Đã bỏ qua kết quả AI riêng cho ${freshStudent.fullName} vì dữ liệu vừa được chỉnh sửa trong lúc chờ AI.`,
        });
        return;
      }

      if (resItem.versionMeta) {
        studentServerMetaRef.current[targetStudentId] = resItem.versionMeta;
      }

      if (resItem.status === "FAILED") {
        const hasExistingDraft = Boolean(
          freshStudent.finalText && freshStudent.finalText.trim().length > 0
        );
        setStudents((prev) =>
          prev.map((s) =>
            s.studentId === targetStudentId
              ? {
                  ...s,
                  status: hasExistingDraft ? s.status : "FAILED",
                  errorMessage: resItem.errorMessage || "AI không trả về nhận xét hợp lệ.",
                }
              : s
          )
        );
        setStatusMessage({
          type: "error",
          text: `AI riêng thất bại cho ${freshStudent.fullName}: ${resItem.errorMessage || "Lỗi sinh nhận xét"}`,
        });
        return;
      }

      const nextStatus: StudentItem["status"] =
        resItem.status === "INSUFFICIENT_INFO"
          ? "INSUFFICIENT_INFO"
          : wasApprovedOrVerified
          ? "WAITING_APPROVAL"
          : "DRAFT";

      setStudents((prev) =>
        prev.map((s) => {
          if (s.studentId !== targetStudentId) return s;
          if (s.classId && s.classId.trim().toUpperCase() !== reqClassId) return s;
          return {
            ...s,
            status: nextStatus,
            strengths: resItem.strengths,
            improvements: resItem.improvements,
            actionPlan: resItem.actionPlan,
            finalText: resItem.formattedFullComment,
            errorMessage: resItem.errorMessage,
            contentHash: undefined,
            ...(resItem.checkpointData ? { checkpointData: resItem.checkpointData } : {}),
          };
        })
      );

      if (resItem.status !== "INSUFFICIENT_INFO") {
        await saveDraftToServer(targetStudentId, {
          strengths: resItem.strengths,
          improvements: resItem.improvements,
          actionPlan: resItem.actionPlan,
          finalText: resItem.formattedFullComment,
          status: nextStatus,
          ...(resItem.checkpointData ? { checkpointData: resItem.checkpointData } : {}),
        });
      }

      setStatusMessage({
        type: nextStatus === "INSUFFICIENT_INFO" ? "info" : "success",
        text:
          nextStatus === "INSUFFICIENT_INFO"
            ? `${freshStudent.fullName} chưa chọn Quick Tag hoặc ghi chú -> giữ Chưa đủ thông tin.`
            : wasApprovedOrVerified
            ? `Đã soạn lại nhận xét riêng cho ${freshStudent.fullName} (hạ về Chờ duyệt để kiểm tra trước khi đẩy LMS).`
            : `Đã soạn & lưu nháp nhận xét riêng cho ${freshStudent.fullName}.`,
      });
    } catch (err: any) {
      if (
        activeClassIdRef.current === reqClassId &&
        activeSessionIdRef.current === reqSessionId
      ) {
        setStatusMessage({
          type: "error",
          text: `Lỗi gọi AI riêng: ${err?.message || String(err)}`,
        });
      }
    } finally {
      setGeneratingSingleStudentId((prev) => (prev === targetStudentId ? null : prev));
    }
  };

  // Approve a single comment
  const handleApprove = async (studentId: string): Promise<boolean> => {
    const reqClassId = classId.trim().toUpperCase();
    const reqSessionId = selectedSessionId.trim();
    if (
      !reqClassId ||
      !reqSessionId ||
      activeClassIdRef.current !== reqClassId ||
      activeSessionIdRef.current !== reqSessionId
    ) {
      return false;
    }
    if (
      loadedScopeKeyRef.current &&
      loadedScopeKeyRef.current !== `${reqClassId}::${reqSessionId}`
    ) {
      return false;
    }

    const flushedOk = await flushPendingDraftSave(studentId);
    if (
      !flushedOk ||
      activeClassIdRef.current !== reqClassId ||
      activeSessionIdRef.current !== reqSessionId
    ) {
      return false;
    }
    const editVersionSnapshot = studentEditVersionRef.current[studentId] || 0;

    const student = studentsRef.current.find((s) => s.studentId === studentId);
    if (!student || !student.finalText) return false;
    if (student.isActive === false) return false;
    if (student.attendanceStatus !== "PRESENT" && student.attendanceStatus !== "LATE") return false;
    if (student.classId && student.classId.trim().toUpperCase() !== reqClassId) return false;
    if (student.sessionId && student.sessionId.trim() !== reqSessionId) return false;

    const approvedTextSnapshot = student.finalText;
    const expectedRowVer = studentServerMetaRef.current[studentId]?.rowVer ?? 0;

    try {
      const res = await fetch(
        `/api/session-comments/approve?cid=${clientInstanceIdRef.current}&rev=${editVersionSnapshot}&base=${expectedRowVer}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Client-Instance": clientInstanceIdRef.current,
            "X-Edit-Revision": String(editVersionSnapshot),
            "X-Base-Revision": String(expectedRowVer),
          },
          body: JSON.stringify({
            classId: reqClassId,
            sessionId: reqSessionId,
            studentId,
            approvedText: approvedTextSnapshot,
            expectedRowVer,
            ...(student.checkpointData ? { checkpointData: student.checkpointData } : {}),
          }),
        }
      );
      const data = typeof res?.json === "function" ? await res.json().catch(() => null) : null;
      if (data?.versionMeta) {
        studentServerMetaRef.current[studentId] = data.versionMeta;
      }
      if (
        activeClassIdRef.current !== reqClassId ||
        activeSessionIdRef.current !== reqSessionId ||
        (studentEditVersionRef.current[studentId] || 0) !== editVersionSnapshot
      ) {
        if ((studentEditVersionRef.current[studentId] || 0) !== editVersionSnapshot) {
          const recoverySavedOk = await flushPendingDraftSave(studentId);
          setStatusMessage({
            type: "error",
            text: recoverySavedOk
              ? "Nhận xét đã được chỉnh sửa trong lúc duyệt. Đã chuyển về Bản nháp để xem lại trước khi đẩy LMS."
              : "Nhận xét đã được chỉnh sửa trong lúc duyệt nhưng lưu nháp phục hồi thất bại. Đang giữ bản mới trên màn hình để thử lại.",
          });
        }
        return false;
      }
      if (
        (typeof res?.status === "number" && res.status >= 400) ||
        res?.ok === false ||
        !data?.success
      ) {
        setStatusMessage({
          type: "error",
          text: `Lỗi duyệt nhận xét: ${data?.error || "Không thể duyệt nhận xét."}`,
        });
        return false;
      }
      setStudents((prev) =>
        prev.map((s) =>
          s.studentId === studentId &&
          s.finalText === approvedTextSnapshot &&
          (!s.classId || s.classId.trim().toUpperCase() === reqClassId) &&
          (!s.sessionId || s.sessionId.trim() === reqSessionId)
            ? { ...s, status: "APPROVED", contentHash: data.contentHash }
            : s
        )
      );
      return true;
    } catch (err: any) {
      console.error("Lỗi duyệt nhận xét:", err);
      setStatusMessage({
        type: "error",
        text: `Lỗi duyệt nhận xét: ${err?.message || String(err)}`,
      });
      return false;
    }
  };

  // Batch approve all valid drafts in a single POST /api/session-comments/approve call
  const handleApproveAll = async (options?: {
    silent?: boolean;
  }): Promise<{
    approvedCount: number;
    failCount: number;
    skippedInsufficientCount: number;
    flushFailed?: boolean;
    concurrentEditDetected?: boolean;
  }> => {
    const flushedOk = await flushAllPendingDraftSaves();
    if (!flushedOk) {
      return {
        approvedCount: 0,
        failCount: 1,
        skippedInsufficientCount: 0,
        flushFailed: true,
        concurrentEditDetected: false,
      };
    }

    const reqClassId = classId.trim().toUpperCase();
    const reqSessionId = selectedSessionId.trim();
    if (
      !reqClassId ||
      !reqSessionId ||
      activeClassIdRef.current !== reqClassId ||
      activeSessionIdRef.current !== reqSessionId
    ) {
      return {
        approvedCount: 0,
        failCount: 0,
        skippedInsufficientCount: 0,
        flushFailed: false,
        concurrentEditDetected: false,
      };
    }

    const presentOrLate = studentsRef.current.filter(
      (s) =>
        s.isActive !== false &&
        (!s.classId || s.classId.trim().toUpperCase() === reqClassId) &&
        (!s.sessionId || s.sessionId.trim() === reqSessionId) &&
        (s.attendanceStatus === "PRESENT" || s.attendanceStatus === "LATE")
    );

    const skippedInsufficientCount = presentOrLate.filter(
      (s) =>
        s.status === "INSUFFICIENT_INFO" ||
        !s.finalText ||
        !s.finalText.trim() ||
        s.finalText.trim().startsWith("Chưa đủ thông tin")
    ).length;

    const eligibleDrafts = presentOrLate.filter(
      (s) =>
        (s.status === "DRAFT" ||
          s.status === "WAITING_APPROVAL" ||
          (s.status === "VERIFIED" &&
            needsStudentCheckpointLmsTick(isCurrentSessionCheckpoint, s, reqClassId))) &&
        s.finalText &&
        s.finalText.trim().length > 0 &&
        !s.finalText.trim().startsWith("Chưa đủ thông tin")
    );
    if (eligibleDrafts.length === 0) {
      return {
        approvedCount: 0,
        failCount: 0,
        skippedInsufficientCount,
        flushFailed: false,
        concurrentEditDetected: false,
      };
    }

    const initialEditVersions = new Map<string, number>(
      eligibleDrafts.map((s) => [s.studentId, studentEditVersionRef.current[s.studentId] || 0])
    );
    const snapshotTexts = new Map<string, string>(
      eligibleDrafts.map((s) => [s.studentId, s.finalText || ""])
    );

    const batchItems = eligibleDrafts.map((s) => ({
      classId: reqClassId,
      sessionId: reqSessionId,
      studentId: s.studentId,
      approvedText: s.finalText,
      attendanceStatus: s.attendanceStatus,
      expectedRowVer: studentServerMetaRef.current[s.studentId]?.rowVer ?? 0,
      clientInstanceId: clientInstanceIdRef.current,
      clientRevision: studentEditVersionRef.current[s.studentId] || 0,
      ...(s.checkpointData ? { checkpointData: s.checkpointData } : {}),
    }));

    let approvedCount = 0;
    let failCount = 0;
    let concurrentEditDetected = false;
    const concurrentlyEditedIds: string[] = [];

    try {
      const firstItem = batchItems[0];
      const res = await fetch(
        `/api/session-comments/approve?cid=${clientInstanceIdRef.current}&rev=${firstItem.clientRevision}&base=${firstItem.expectedRowVer}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Client-Instance": clientInstanceIdRef.current,
            "X-Edit-Revision": String(firstItem.clientRevision),
            "X-Base-Revision": String(firstItem.expectedRowVer),
          },
          body: JSON.stringify({
            classId: reqClassId,
            sessionId: reqSessionId,
            studentId: firstItem.studentId,
            approvedText: firstItem.approvedText,
            expectedRowVer: firstItem.expectedRowVer,
            items: batchItems,
          }),
        }
      );
      const data = typeof res?.json === "function" ? await res.json().catch(() => null) : null;

      if (
        activeClassIdRef.current !== reqClassId ||
        activeSessionIdRef.current !== reqSessionId
      ) {
        return {
          approvedCount: 0,
          failCount: eligibleDrafts.length,
          skippedInsufficientCount,
          flushFailed: false,
          concurrentEditDetected: false,
        };
      }

      if (Array.isArray(data?.results) && data.results.length > 0) {
        const resultByStudent = new Map<string, any>(
          data.results.map((r: any) => [String(r?.studentId || ""), r])
        );
        const approvedHashByStudent = new Map<string, string>();
        for (const s of eligibleDrafts) {
          const itemRes = resultByStudent.get(s.studentId);
          if (itemRes?.versionMeta) {
            studentServerMetaRef.current[s.studentId] = itemRes.versionMeta;
          }
          const wasEditedConcurrently =
            (studentEditVersionRef.current[s.studentId] || 0) !==
            initialEditVersions.get(s.studentId);
          if (wasEditedConcurrently) {
            concurrentEditDetected = true;
            concurrentlyEditedIds.push(s.studentId);
            failCount++;
          } else if (itemRes && itemRes.success) {
            approvedCount++;
            approvedHashByStudent.set(s.studentId, String(itemRes.contentHash || ""));
          } else {
            failCount++;
          }
        }
        if (approvedHashByStudent.size > 0) {
          setStudents((prev) =>
            prev.map((s) => {
              const hash = approvedHashByStudent.get(s.studentId);
              if (!hash) return s;
              if (s.finalText !== snapshotTexts.get(s.studentId)) return s;
              if (s.classId && s.classId.trim().toUpperCase() !== reqClassId) return s;
              if (s.sessionId && s.sessionId.trim() !== reqSessionId) return s;
              return { ...s, status: "APPROVED", contentHash: hash };
            })
          );
        }
      } else if (
        !(typeof res?.status === "number" && res.status >= 400) &&
        res?.ok !== false &&
        data?.success
      ) {
        if (data?.versionMeta && eligibleDrafts.length === 1) {
          studentServerMetaRef.current[eligibleDrafts[0].studentId] = data.versionMeta;
        }
        for (const s of eligibleDrafts) {
          const wasEditedConcurrently =
            (studentEditVersionRef.current[s.studentId] || 0) !==
            initialEditVersions.get(s.studentId);
          if (wasEditedConcurrently) {
            concurrentEditDetected = true;
            concurrentlyEditedIds.push(s.studentId);
            failCount++;
          } else {
            approvedCount++;
          }
        }
        setStudents((prev) =>
          prev.map((s) => {
            if (!snapshotTexts.has(s.studentId)) return s;
            if (concurrentlyEditedIds.includes(s.studentId)) return s;
            if (s.finalText !== snapshotTexts.get(s.studentId)) return s;
            if (s.classId && s.classId.trim().toUpperCase() !== reqClassId) return s;
            if (s.sessionId && s.sessionId.trim() !== reqSessionId) return s;
            return { ...s, status: "APPROVED", contentHash: data?.contentHash || s.contentHash };
          })
        );
      } else {
        failCount = eligibleDrafts.length;
      }

      let recoveryAllOk = true;
      if (concurrentlyEditedIds.length > 0) {
        const recoveryResults = await Promise.all(
          concurrentlyEditedIds.map(async (editedId) => {
            if (
              debouncedPayloadsRef.current[editedId] ||
              pendingSavePromisesRef.current[editedId] ||
              unsavedDraftPatchRef.current[editedId]
            ) {
              return await flushPendingDraftSave(editedId);
            }
            const cur = studentsRef.current.find((st) => st.studentId === editedId);
            if (cur) {
              return await saveDraftToServer(editedId, {
                finalText: cur.finalText,
                teacherNote: cur.teacherNote,
                strengths: cur.strengths,
                improvements: cur.improvements,
                actionPlan: cur.actionPlan,
                status: "DRAFT",
              });
            }
            return true;
          })
        );
        recoveryAllOk = recoveryResults.every(Boolean);
      }

      if (!options?.silent) {
        if (failCount === 0) {
          setStatusMessage({
            type: "success",
            text: "Đã duyệt và băm mã SHA-256 cho toàn bộ nhận xét hợp lệ!",
          });
        } else {
          setStatusMessage({
            type: "error",
            text: concurrentEditDetected
              ? recoveryAllOk
                ? `Phát hiện nhận xét bị chỉnh sửa trong lúc duyệt (${concurrentlyEditedIds.length} học viên). Đã hạ về Bản nháp để giáo viên kiểm tra lại.`
                : `Phát hiện nhận xét bị chỉnh sửa trong lúc duyệt (${concurrentlyEditedIds.length} học viên) nhưng lưu nháp phục hồi thất bại. Đang giữ bản mới trên màn hình để thử lại.`
              : `Lỗi duyệt hàng loạt: thành công ${approvedCount}/${eligibleDrafts.length}, thất bại ${failCount} học viên.`,
          });
        }
      }
    } catch {
      failCount = eligibleDrafts.length;
      if (!options?.silent) {
        setStatusMessage({
          type: "error",
          text: `Lỗi duyệt hàng loạt: thành công ${approvedCount}/${eligibleDrafts.length}, thất bại ${failCount} học viên.`,
        });
      }
    }

    return {
      approvedCount,
      failCount,
      skippedInsufficientCount,
      flushFailed: false,
      concurrentEditDetected,
    };
  };

  const activeSessionObj = sessions.find((s) => s.sessionId === selectedSessionId);
  const activeSessionNumber =
    activeSessionObj?.sessionNumber ||
    parseInt(selectedSessionId.match(/(\d+)(?!.*\d)/)?.[1] || "1", 10);

  const upperCodeForCheckpoint = classCode.trim().toUpperCase();
  const effectiveCheckpointSessions =
    typeof sharedResolveCheckpointSessionsForClass === "function"
      ? sharedResolveCheckpointSessionsForClass(upperCodeForCheckpoint, syllabusList)
      : (() => {
          const isLegoClass = isLegoRoboticsClassCodeSafe(upperCodeForCheckpoint);
          const sortedSyllabusForCheckpoint = [...syllabusList].sort(
            (a, b) => (b.courseCode?.length || 0) - (a.courseCode?.length || 0)
          );
          const matchedCourseForCheckpoint = sortedSyllabusForCheckpoint.find((c) => {
            const cc = String(c.courseCode || "").trim().toUpperCase();
            if (!cc) return false;
            if (isLegoClass && cc === "ROB") return false;
            return upperCodeForCheckpoint.includes(cc);
          });
          const validCourseCheckpointNums = Array.isArray(
            matchedCourseForCheckpoint?.checkpointSessions
          )
            ? matchedCourseForCheckpoint.checkpointSessions
                .map((n) => Number(n))
                .filter((n) => Number.isInteger(n) && n >= 1 && n <= 13)
            : [];
          return validCourseCheckpointNums.length > 0
            ? validCourseCheckpointNums
            : isLegoClass
            ? [5, 9]
            : detectTrackByClassCode(upperCodeForCheckpoint) === "robotics"
            ? [4, 8]
            : [5, 9];
        })();
  const isCurrentSessionCheckpoint =
    typeof sharedIsCheckpointSession === "function"
      ? sharedIsCheckpointSession(upperCodeForCheckpoint, activeSessionNumber, syllabusList)
      : activeSessionNumber >= 1 &&
        activeSessionNumber < 14 &&
        effectiveCheckpointSessions.includes(activeSessionNumber);
  const isCurrentClassRobotics = isRoboticsClassCodeSafe(upperCodeForCheckpoint);
  const isCurrentSessionLego = Boolean(
    checkpointStageInfo?.isLego ??
      (isCurrentSessionCheckpoint && isLegoRoboticsClassCodeSafe(upperCodeForCheckpoint))
  );

  const handleCheckpointSync = async (syncFromLms = true) => {
    const reqClassId = (classCode || classId).trim().toUpperCase();
    const reqSessionId = selectedSessionId.trim();
    if (!reqClassId || !reqSessionId || isSyncingCheckpoint) return;

    const flushedOk = await flushAllPendingDraftSaves();
    if (!flushedOk) return;

    setIsSyncingCheckpoint(true);
    setStatusMessage({
      type: "info",
      text: isCurrentSessionLego
        ? `Đang tự tính 7 ô [ĐNL] LEGO Robotics theo quá trình cho ${reqClassId}...`
        : syncFromLms
        ? `Đang kết nối LMS đọc điểm Lý thuyết & Thực hành rồi tự tính 9 ô [ĐNL] cho ${reqClassId}...`
        : `Đang tính lại 9 ô [ĐNL] từ lịch sử các buổi trước cho ${reqClassId}...`,
    });

    try {
      const res = await fetch("/api/session-comments/checkpoint-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classCode: reqClassId,
          sessionId: reqSessionId,
          syncFromLms,
          forceRecalculate: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Không thể đồng bộ và tính [ĐNL] Checkpoint.");
      }

      await loadClassData(reqClassId, reqSessionId, { preserveLocalUnsavedEdits: false });

      const ungradedList: string[] = Array.isArray(data.ungradedPracticeStudents)
        ? data.ungradedPracticeStudents
        : [];
      const extraWarnParts: string[] = [];
      if (ungradedList.length > 0) {
        extraWarnParts.push(
          `⚠️ Lưu ý: Còn ${ungradedList.length} học viên đã nộp bài Thực hành bên Chấm bài LMS nhưng chưa chấm (${ungradedList.join(", ")}) — Bot để trống TH để tránh nhầm 0 điểm.`
        );
      }
      if (data.scoreScrapeWarning) {
        extraWarnParts.push(`⚠️ Lưu ý đọc mục Chấm bài: ${data.scoreScrapeWarning}`);
      }
      const extraWarn = extraWarnParts.length > 0 ? ` ${extraWarnParts.join(" ")}` : "";

      setStatusMessage({
        type: "success",
        text: isCurrentSessionLego
          ? `✅ Đã tự tính 7 ô [ĐNL] LEGO Robotics theo quá trình cho ${data.updatedCount || 0} học viên (Buổi ${activeSessionNumber}).`
          : `✅ Đã cập nhật điểm Kiểm tra & tự tính 9 ô [ĐNL] theo quá trình cho ${data.updatedCount || 0} học viên (Buổi ${activeSessionNumber}).${extraWarn}`,
      });
    } catch (err: any) {
      setStatusMessage({
        type: "error",
        text: `Lỗi cập nhật Checkpoint: ${err?.message || String(err)}`,
      });
    } finally {
      setIsSyncingCheckpoint(false);
    }
  };

  const handleUpdateStudentCompetency = (
    studentId: string,
    key: keyof CompetencyScores,
    rating: number
  ) => {
    const stu = studentsRef.current.find((s) => s.studentId === studentId);
    if (!stu || !stu.checkpointData) return;

    const rowClassCode = stu.classId || classCode || classId;
    const isRowLego = Boolean(
      stu.checkpointData.isLego ??
        checkpointStageInfo?.isLego ??
        isLegoRoboticsClassCodeSafe(rowClassCode)
    );
    const currentScores = safeParseCompScoresUi(stu.checkpointData.competencyScores || {});
    const nextScores: CompetencyScores = {
      ...currentScores,
      [key]: Math.max(1, Math.min(5, Math.round(rating))),
    };
    const nextAvg = safeCalcCompAvgForClassUi(nextScores, isRowLego ? "LEGO" : rowClassCode);
    const nextCp: CheckpointStudentData = {
      ...stu.checkpointData,
      competencyScores: nextScores,
      competencyAverage: nextAvg,
      ...(isRowLego ? { isLego: true } : {}),
      source: "MANUAL_UI",
      userEditedCompetency: true,
    };

    const nextPatch: Partial<StudentItem> = {
      checkpointData: nextCp,
    };
    if (
      stu.finalText &&
      stu.finalText.trim().length > 0 &&
      !stu.finalText.startsWith("Chưa đủ thông tin")
    ) {
      const headerLine = safeFormatCpHeaderUi({
        cpStage: nextCp.cpStage,
        theoryScore: nextCp.theoryScore,
        practiceScore: nextCp.practiceScore,
        competencyAverage: nextAvg,
        isLego: isRowLego,
      });
      nextPatch.finalText = safeUpsertCpHeaderUi(stu.finalText, headerLine);
    }

    void saveDraftToServer(studentId, nextPatch);
  };

  const modalTargetCp = editingCompetencyStudentId
    ? students.find((s) => s.studentId === editingCompetencyStudentId)?.checkpointData
    : undefined;
  const modalSyncedTheory = modalTargetCp?.theoryScore ?? null;
  const modalSyncedPractice = modalTargetCp?.practiceScore ?? null;

  useEffect(() => {
    if (!editingCompetencyStudentId) {
      setManualTheoryInput("");
      return;
    }
    setManualTheoryInput(
      typeof modalSyncedTheory === "number" && Number.isFinite(modalSyncedTheory)
        ? modalSyncedTheory.toFixed(1)
        : ""
    );
  }, [editingCompetencyStudentId, modalSyncedTheory]);

  useEffect(() => {
    if (!editingCompetencyStudentId) {
      setManualPracticeInput("");
      return;
    }
    setManualPracticeInput(
      typeof modalSyncedPractice === "number" && Number.isFinite(modalSyncedPractice)
        ? modalSyncedPractice.toFixed(1)
        : ""
    );
  }, [editingCompetencyStudentId, modalSyncedPractice]);

  const handleResetManualCpScore = async (
    studentId: string,
    field: "theory" | "practice"
  ) => {
    const reqClassId = (classCode || classId).trim().toUpperCase();
    const reqSessionId = selectedSessionId.trim();
    if (!reqClassId || !reqSessionId || isSavingManualCpScore) {
      return;
    }

    const flushedOk = await flushAllPendingDraftSaves();
    if (
      !flushedOk ||
      activeClassIdRef.current !== reqClassId ||
      activeSessionIdRef.current !== reqSessionId
    ) {
      return;
    }

    const stu = studentsRef.current.find((s) => s.studentId === studentId);
    if (!stu || !stu.checkpointData) {
      return;
    }

    const cp = stu.checkpointData;
    const restoredScore =
      field === "theory"
        ? cp.slotTheoryScore !== undefined
          ? cp.slotTheoryScore
          : null
        : cp.slotPracticeScore !== undefined
          ? cp.slotPracticeScore
          : null;

    const nextCp: CheckpointStudentData = {
      ...cp,
      ...(field === "theory"
        ? { theoryScore: restoredScore, userEditedTheory: false }
        : { practiceScore: restoredScore, userEditedPractice: false }),
      userEditedCompetency: Boolean(cp.userEditedCompetency),
      source: cp.userEditedCompetency ? "MANUAL_UI" : "AUTO_PROCESS",
    };

    const nextPatch: Partial<StudentItem> = {
      checkpointData: nextCp,
    };
    if (
      stu.finalText &&
      stu.finalText.trim().length > 0 &&
      !stu.finalText.startsWith("Chưa đủ thông tin")
    ) {
      const headerLine = safeFormatCpHeaderUi({
        cpStage: nextCp.cpStage,
        theoryScore: nextCp.theoryScore,
        practiceScore: nextCp.practiceScore,
        competencyAverage: nextCp.competencyAverage ?? null,
        isLego: Boolean(nextCp.isLego ?? isLegoRoboticsClassCodeSafe(reqClassId)),
      });
      nextPatch.finalText = safeUpsertCpHeaderUi(stu.finalText, headerLine);
    }

    setIsSavingManualCpScore(true);
    try {
      const ok = await saveDraftToServer(studentId, nextPatch);
      if (ok) {
        let syncWarning = "";
        try {
          const syncRes = await fetch("/api/session-comments/checkpoint-sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              classCode: reqClassId,
              sessionId: reqSessionId,
              syncFromLms: false,
              forceRecalculate: false,
            }),
          });
          const syncData = await syncRes.json().catch(() => null);
          if (!syncRes.ok || !syncData?.success) {
            syncWarning = syncData?.error || `HTTP ${syncRes.status}`;
          }
        } catch (syncErr: any) {
          syncWarning = syncErr?.message || String(syncErr);
        }
        await loadClassData(reqClassId, reqSessionId, { preserveLocalUnsavedEdits: false });
        if (syncWarning) {
          setStatusMessage({
            type: "error",
            text: `Đã khôi phục điểm nhưng tính lại [ĐNL] thất bại: ${syncWarning}`,
          });
        } else {
          setStatusMessage({
            type: "success",
            text: `↺ Đã khôi phục điểm ${field === "theory" ? "Lý thuyết" : "Thực hành"} của ${stu.fullName} về dữ liệu LMS.`,
          });
        }
      }
    } finally {
      setIsSavingManualCpScore(false);
    }
  };

  const handleCommitManualCpScore = async (
    studentId: string,
    field: "theory" | "practice",
    rawVal: string
  ) => {
    const reqClassId = (classCode || classId).trim().toUpperCase();
    const reqSessionId = selectedSessionId.trim();
    if (!reqClassId || !reqSessionId || isSavingManualCpScore) {
      return;
    }

    const flushedOk = await flushAllPendingDraftSaves();
    if (
      !flushedOk ||
      activeClassIdRef.current !== reqClassId ||
      activeSessionIdRef.current !== reqSessionId
    ) {
      return;
    }

    const stu = studentsRef.current.find((s) => s.studentId === studentId);
    if (!stu || !stu.checkpointData) {
      return;
    }

    const cp = stu.checkpointData;
    const trimmed = String(rawVal || "").trim();
    if (!trimmed) {
      const hadManual =
        field === "theory" ? Boolean(cp.userEditedTheory) : Boolean(cp.userEditedPractice);
      if (hadManual) {
        await handleResetManualCpScore(studentId, field);
      } else {
        const curScore = field === "theory" ? cp.theoryScore : cp.practiceScore;
        const formattedCur =
          typeof curScore === "number" && Number.isFinite(curScore) ? curScore.toFixed(1) : "";
        if (field === "theory") setManualTheoryInput(formattedCur);
        else setManualPracticeInput(formattedCur);
      }
      return;
    }

    const num = Number(trimmed.replace(",", "."));
    if (!Number.isFinite(num) || num < 0 || num > 5) {
      const curScore = field === "theory" ? cp.theoryScore : cp.practiceScore;
      const formattedCur =
        typeof curScore === "number" && Number.isFinite(curScore) ? curScore.toFixed(1) : "";
      if (field === "theory") setManualTheoryInput(formattedCur);
      else setManualPracticeInput(formattedCur);
      setStatusMessage({
        type: "error",
        text: "Điểm Checkpoint sửa tay phải nằm trong khoảng 0.0 đến 5.0.",
      });
      return;
    }

    const rounded = Math.round(num * 10) / 10;
    const curScore = field === "theory" ? cp.theoryScore : cp.practiceScore;
    const curManualFlag =
      field === "theory" ? Boolean(cp.userEditedTheory) : Boolean(cp.userEditedPractice);

    if (curScore === rounded) {
      const formattedCur = rounded.toFixed(1);
      if (field === "theory") setManualTheoryInput(formattedCur);
      else setManualPracticeInput(formattedCur);
      if (curManualFlag || curScore !== null) {
        return;
      }
    }

    const nextTheoryScore = field === "theory" ? rounded : cp.theoryScore;
    const nextPracticeScore = field === "practice" ? rounded : cp.practiceScore;
    const nextCp: CheckpointStudentData = {
      ...cp,
      theoryScore: nextTheoryScore,
      practiceScore: nextPracticeScore,
      ...(field === "theory"
        ? { userEditedTheory: true }
        : { userEditedPractice: true, hasUngradedPractice: false }),
      userEditedCompetency: Boolean(cp.userEditedCompetency),
      source: cp.userEditedCompetency ? "MANUAL_UI" : cp.source || "AUTO_PROCESS",
    };

    const nextPatch: Partial<StudentItem> = {
      checkpointData: nextCp,
    };
    if (
      stu.finalText &&
      stu.finalText.trim().length > 0 &&
      !stu.finalText.startsWith("Chưa đủ thông tin")
    ) {
      const headerLine = safeFormatCpHeaderUi({
        cpStage: nextCp.cpStage,
        theoryScore: nextCp.theoryScore,
        practiceScore: nextCp.practiceScore,
        competencyAverage: nextCp.competencyAverage ?? null,
        isLego: Boolean(nextCp.isLego ?? isLegoRoboticsClassCodeSafe(reqClassId)),
      });
      nextPatch.finalText = safeUpsertCpHeaderUi(stu.finalText, headerLine);
    }

    if (field === "theory") setManualTheoryInput(rounded.toFixed(1));
    else setManualPracticeInput(rounded.toFixed(1));

    setIsSavingManualCpScore(true);
    try {
      const ok = await saveDraftToServer(studentId, nextPatch);
      if (ok) {
        let syncWarning = "";
        if (!cp.userEditedCompetency) {
          try {
            const syncRes = await fetch("/api/session-comments/checkpoint-sync", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                classCode: reqClassId,
                sessionId: reqSessionId,
                syncFromLms: false,
                forceRecalculate: false,
              }),
            });
            const syncData = await syncRes.json().catch(() => null);
            if (!syncRes.ok || !syncData?.success) {
              syncWarning = syncData?.error || `HTTP ${syncRes.status}`;
            }
          } catch (syncErr: any) {
            syncWarning = syncErr?.message || String(syncErr);
          }
        }
        await loadClassData(reqClassId, reqSessionId, { preserveLocalUnsavedEdits: false });
        if (syncWarning) {
          setStatusMessage({
            type: "error",
            text: `Đã lưu điểm ${field === "theory" ? "Lý thuyết" : "Thực hành"} (${rounded.toFixed(1)}/5.0) nhưng đồng bộ lại [ĐNL] thất bại: ${syncWarning}`,
          });
        } else {
          setStatusMessage({
            type: "success",
            text: `✅ Đã lưu điểm ${field === "theory" ? "Lý thuyết" : "Thực hành"} sửa tay (${rounded.toFixed(1)}/5.0) cho ${stu.fullName}.`,
          });
        }
      }
    } finally {
      setIsSavingManualCpScore(false);
    }
  };

  // Push to LMS (Single or All)
  const handleSaveToLms = async (
    targetStudentId?: string,
    summaryContext?: { skippedInsufficientCount?: number; approveFailedCount?: number }
  ) => {
    if (targetStudentId) {
      setSavingStudentId(targetStudentId);
    } else {
      setIsSavingLms(true);
    }

    setStatusMessage({
      type: "info",
      text: targetStudentId
        ? `Đang điền Summary + Homework và lưu 1 học sinh lên LMS (Buổi ${activeSessionNumber})...`
        : `Đang điền Summary + Homework và đẩy toàn bộ nhận xét đã duyệt lên LMS (Buổi ${activeSessionNumber})...`,
    });

    try {
      const normalizedClassId = classId.trim().toUpperCase();
      const normalizedClassCode = (classCode.trim() || classId.trim()).toUpperCase();
      const res = await fetch("/api/session-comments/save-lms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: normalizedClassId,
          classCode: normalizedClassCode,
          sessionId: selectedSessionId,
          studentId: targetStudentId,
          topic: currentTopic,
          keyKnowledge: currentKeyKnowledge,
          homeworkBrief: currentHomeworkBrief,
        }),
      });
      const data = await res.json();

      if (data.success && data.data) {
        const batchRes = data.data;
        const verifiedCount = Number(batchRes.verifiedCount || 0);
        const skippedVerifiedCount = Number(batchRes.skippedVerifiedCount || 0);
        const lmsFailedCount = Number(batchRes.failedCount || 0);
        const totalErrors = lmsFailedCount + Number(summaryContext?.approveFailedCount || 0);
        const skippedCount = Number(summaryContext?.skippedInsufficientCount || 0);
        const skippedVerifiedNote =
          skippedVerifiedCount > 0
            ? ` (bỏ qua ${skippedVerifiedCount} bạn đã lưu LMS trước đó)`
            : "";

        if (verifiedCount === 0 && skippedVerifiedCount > 0 && totalErrors === 0) {
          setStatusMessage({
            type: "info",
            text:
              summaryContext !== undefined
                ? `Đã bỏ qua ${skippedVerifiedCount} học viên đã lưu LMS ✓${
                    skippedCount > 0 ? ` và ${skippedCount} bạn thiếu thông tin` : ""
                  } (Buổi ${activeSessionNumber}) — toàn bộ dữ liệu trên LMS đã khớp.`
                : `Đã bỏ qua ${skippedVerifiedCount} học viên đã ở trạng thái Đã lưu LMS ✓ (Buổi ${activeSessionNumber}) — không cần đẩy lại.`,
          });
        } else if (verifiedCount > 0 && totalErrors === 0) {
          setStatusMessage({
            type: "success",
            text:
              summaryContext !== undefined
                ? `Đã lưu ${verifiedCount} / Bỏ qua ${skippedCount} (thiếu thông tin) / Lỗi 0 (Buổi ${activeSessionNumber}): ${verifiedCount}/${batchRes.totalCandidates} học viên đã lưu LMS ✓!${skippedVerifiedNote}`
                : `Đã lưu & đối chiếu (Buổi ${activeSessionNumber}): ${verifiedCount}/${batchRes.totalCandidates} học viên đã lưu LMS ✓!${skippedVerifiedNote}`,
          });
        } else {
          const firstError =
            batchRes.results?.find((r: any) => r.error)?.error ||
            "Không tìm thấy nhận xét đã duyệt hoặc lỗi đối chiếu trên LMS";
          setStatusMessage({
            type: "error",
            text:
              summaryContext !== undefined
                ? `Đã lưu ${verifiedCount} / Bỏ qua ${skippedCount} (thiếu thông tin) / Lỗi ${totalErrors} (Buổi ${activeSessionNumber}): ${firstError}${skippedVerifiedNote}`
                : `Lưu LMS (Buổi ${activeSessionNumber}) không đạt (${verifiedCount}/${batchRes.totalCandidates} đã lưu): ${firstError}${skippedVerifiedNote}`,
          });
        }
        await loadClassData(normalizedClassId, selectedSessionId, {
          preserveLocalUnsavedEdits: true,
        });
      } else {
        setStatusMessage({
          type: "error",
          text: `Lưu thất bại: ${data.error || "Không thể ghi nhận xét lên LMS"}`,
        });
      }
    } catch (err: any) {
      setStatusMessage({ type: "error", text: `Lỗi kết nối: ${err.message}` });
    } finally {
      setIsSavingLms(false);
      setSavingStudentId(null);
    }
  };

  // Primary 1-click: Batch Approve eligible drafts + Push to LMS (S3.3)
  const handleApproveAndSaveLms = async () => {
    setIsSavingLms(true);
    try {
      const flushedOk = await flushAllPendingDraftSaves();
      if (!flushedOk) return;

      const reqClassId = classId.trim().toUpperCase();
      const reqSessionId = selectedSessionId.trim();

      const presentOrLate = studentsRef.current.filter(
        (s) =>
          s.isActive !== false &&
          (!s.classId || s.classId.trim().toUpperCase() === reqClassId) &&
          (!s.sessionId || s.sessionId.trim() === reqSessionId) &&
          (s.attendanceStatus === "PRESENT" || s.attendanceStatus === "LATE")
      );

      const skippedInsufficientCount = presentOrLate.filter(
        (s) =>
          s.status === "INSUFFICIENT_INFO" ||
          !s.finalText ||
          !s.finalText.trim() ||
          s.finalText.trim().startsWith("Chưa đủ thông tin")
      ).length;

      const preExistingFailedCount = presentOrLate.filter(
        (s) => s.status === "FAILED" && !s.contentHash
      ).length;

      const batchApproval = await handleApproveAll({ silent: true });
      if (batchApproval.flushFailed) {
        return;
      }
      if (
        batchApproval.concurrentEditDetected ||
        Object.keys(debouncedPayloadsRef.current).length > 0 ||
        Object.keys(pendingSavePromisesRef.current).length > 0 ||
        Object.keys(unsavedDraftPatchRef.current).length > 0
      ) {
        const recoverySavedOk =
          (await flushAllPendingDraftSaves()) &&
          Object.keys(unsavedDraftPatchRef.current).length === 0;
        setStatusMessage({
          type: "error",
          text: recoverySavedOk
            ? "Phát hiện nhận xét bị chỉnh sửa trong lúc duyệt. Đã lưu lại bản nháp mới nhất — vui lòng kiểm tra và bấm 'Duyệt & Đẩy LMS' lại."
            : "Phát hiện nhận xét bị chỉnh sửa trong lúc duyệt nhưng lưu nháp phục hồi thất bại. Đang giữ bản mới trên màn hình — vui lòng kiểm tra và thử lại.",
        });
        return;
      }

      const readyForLmsCount = studentsRef.current.filter(
        (s) =>
          s.isActive !== false &&
          (!s.classId || s.classId.trim().toUpperCase() === reqClassId) &&
          (!s.sessionId || s.sessionId.trim() === reqSessionId) &&
          (s.attendanceStatus === "PRESENT" || s.attendanceStatus === "LATE") &&
          (s.status === "APPROVED" || (s.status === "FAILED" && Boolean(s.contentHash)))
      ).length;

      const alreadyVerifiedCount = studentsRef.current.filter(
        (s) =>
          s.isActive !== false &&
          (!s.classId || s.classId.trim().toUpperCase() === reqClassId) &&
          (!s.sessionId || s.sessionId.trim() === reqSessionId) &&
          (s.attendanceStatus === "PRESENT" || s.attendanceStatus === "LATE") &&
          s.status === "VERIFIED"
      ).length;

      const totalApproveErrors = batchApproval.failCount + preExistingFailedCount;

      if (readyForLmsCount === 0) {
        if (alreadyVerifiedCount > 0 && totalApproveErrors === 0) {
          setStatusMessage({
            type: "info",
            text: `Đã bỏ qua ${alreadyVerifiedCount} học viên đã ở trạng thái Đã lưu LMS ✓${
              skippedInsufficientCount > 0
                ? ` (${skippedInsufficientCount} bạn thiếu thông tin)`
                : ""
            } — không cần đẩy lại lên LMS.`,
          });
        } else {
          setStatusMessage({
            type: "error",
            text: `Đã lưu 0 / Bỏ qua ${skippedInsufficientCount} (thiếu thông tin) / Lỗi ${totalApproveErrors}: Chưa có học viên nào đủ điều kiện duyệt & đẩy LMS.`,
          });
        }
        return;
      }

      await handleSaveToLms(undefined, {
        skippedInsufficientCount,
        approveFailedCount: totalApproveErrors,
      });
    } finally {
      setIsSavingLms(false);
    }
  };

  // Single-row combined action: Approve (if needed) & Save to LMS (S3.4)
  const handleApproveAndSaveSingle = async (studentId: string) => {
    setSavingStudentId(studentId);
    try {
      const flushedOk = await flushPendingDraftSave(studentId);
      if (!flushedOk) return;
      const current = studentsRef.current.find((s) => s.studentId === studentId);
      if (!current) return;

      const canRetryDirectly =
        current.status === "APPROVED" ||
        (current.status === "FAILED" && Boolean(current.contentHash));

      if (!canRetryDirectly) {
        const approvedOk = await handleApprove(studentId);
        if (!approvedOk) return;
      }

      await handleSaveToLms(studentId);
    } finally {
      setSavingStudentId(null);
    }
  };

  const copyToClipboard = (text: string, studentId?: string) => {
    const cleanText = studentId
      ? text.replace(/^\s*\*\*[^*\n]+\*\*\s*\r?\n+(?=\s*[-•*]\s*\*\*Điểm mạnh)/i, "")
      : text;
    navigator.clipboard.writeText(cleanText);
    if (studentId) {
      setCopiedStudentId(studentId);
      setTimeout(() => setCopiedStudentId(null), 2000);
    } else {
      setCopiedZalo(true);
      setTimeout(() => setCopiedZalo(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
      {/* 1. Hero Header & Class Selector (Neo-Brutalism) */}
      <div className="mindx-hero p-4 sm:p-5 rounded-2xl transition-all">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="neo-title-icon w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0">
              📝
            </span>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight">
              Nhận xét Buổi học &amp; Zalo
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Hero ClassPicker theme fixtures: className="bg-transparent text-sm font-extrabold text-slate-900 dark:text-white focus:outline-none min-w-[180px] max-w-[320px] cursor-pointer" className="bg-transparent text-sm font-bold text-slate-900 dark:text-white focus:outline-none w-36 uppercase" */}
            <ClassPicker
              scope="running"
              variant="hero"
              value={classCode}
              classes={runningClasses}
              onChange={(code) => {
                void handleSelectRunningClass(code);
              }}
              onRefresh={async () => {
                await handleFetchRunningClasses();
              }}
              isRefreshing={isFetchingClasses || isSyncing}
              disabled={isSyncing || isFetchingClasses}
              showRefreshButton={false}
            />

            <button
              type="button"
              onClick={() => handleSyncFromLms(classCode)}
              disabled={isSyncing || isFetchingClasses}
              className="neo-btn-blue flex items-center gap-1.5 px-3.5 py-2 rounded-xl disabled:opacity-60 text-xs sm:text-sm font-black cursor-pointer mindx-dark-keep"
              title="Đồng bộ danh sách buổi học & học viên của lớp đang chọn từ LMS"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isSyncing || isFetchingClasses ? "animate-spin" : ""}`}
              />
              {isFetchingClasses
                ? "Đang quét lớp..."
                : isSyncing
                ? "Đang đồng bộ..."
                : "Đồng bộ"}
            </button>
          </div>
        </div>
      </div>

      {/* 2. Session & Syllabus Selection Card */}
      <div className="neo-section-card p-4 sm:p-5 rounded-2xl">
        {/* Status notification toast */}
        {statusMessage && (
          <div
            className={`mb-4 p-3 rounded-lg flex items-center justify-between text-sm ${
              statusMessage.type === "success"
                ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"
                : statusMessage.type === "error"
                ? "bg-rose-500/10 border border-rose-500/30 text-rose-400"
                : "bg-blue-500/10 border border-blue-500/30 text-blue-400"
            }`}
          >
            <div className="flex items-center gap-2">
              {statusMessage.type === "success" ? (
                <CheckCircle className="w-4 h-4" />
              ) : statusMessage.type === "error" ? (
                <AlertCircle className="w-4 h-4" />
              ) : (
                <Clock className="w-4 h-4" />
              )}
              <span>{statusMessage.text}</span>
            </div>
            <button
              onClick={() => setStatusMessage(null)}
              className="text-xs opacity-60 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        )}

        {pendingUnknownConfirmCount > 0 && (
          <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex flex-wrap items-center justify-between gap-2">
            <span>
              ⚡ Còn <strong>{pendingUnknownConfirmCount}</strong> bạn chưa điểm danh. Thầy có muốn coi các bạn chưa điểm danh là <strong>Có mặt</strong> (giữ nguyên bạn Nghỉ học) và gọi AI soạn nhận xét ngay không?
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void handleGenerateAi({ confirmUnknownAsPresent: true });
                }}
                className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer"
              >
                ✓ Coi là Có mặt &amp; Soạn AI
              </button>
              <button
                type="button"
                onClick={() => setPendingUnknownConfirmCount(0)}
                className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
              Chọn Buổi học
            </label>
            <select
              value={selectedSessionId}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              className="w-full bg-white dark:bg-slate-900 border-2 border-[#0f172a] dark:border-slate-600 rounded-xl px-3 py-2 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:border-blue-600"
            >
              {sessions.length > 0 ? (
                sessions
                  .filter((s) => Number(s.sessionNumber) < 14)
                  .map((s) => {
                    const dStr = s.date || s.sessionDate;
                    const isCp = effectiveCheckpointSessions.includes(Number(s.sessionNumber));
                    return (
                      <option key={s.sessionId} value={s.sessionId}>
                        Buổi {s.sessionNumber}
                        {isCp ? " [Checkpoint]" : ""}
                        {dStr ? ` (${dStr})` : ""}:{" "}
                        {s.topic.length > 42 ? `${s.topic.slice(0, 42)}...` : s.topic}
                      </option>
                    );
                  })
              ) : (
                <option value="">(Chưa đồng bộ buổi học từ LMS)</option>
              )}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
              Chủ đề buổi học
            </label>
            <input
              type="text"
              value={currentTopic}
              onChange={(e) => setCurrentTopic(e.target.value)}
              className="w-full bg-white dark:bg-slate-900 border-2 border-[#0f172a] dark:border-slate-600 rounded-xl px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-blue-600"
              placeholder="Chủ đề buổi học hôm nay..."
            />
            {currentKeyKnowledge.length > 0 && (
              <details className="neo-details-bar mt-2.5 px-3 py-2 rounded-xl text-xs">
                <summary className="font-extrabold cursor-pointer select-none flex items-center justify-between gap-2">
                  <span>
                    📚 Nội dung buổi {activeSessionNumber} &amp; BTVN ({currentKeyKnowledge.length} ý)
                  </span>
                  <span className="text-[11px] font-bold opacity-80">Xem chi tiết ▾</span>
                </summary>
                <div className="mt-2 pt-2 border-t border-amber-500/30 space-y-1">
                  <ul className="list-disc list-inside space-y-0.5">
                    {currentKeyKnowledge.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                  {currentHomeworkBrief && (
                    <div className="pt-1">
                      <span className="font-bold">BTVN:</span> {currentHomeworkBrief}
                    </div>
                  )}
                </div>
              </details>
            )}
          </div>
        </div>

        {/* Checkpoint Session Banner (3.3 & v3.7.0 Auto [ĐNL] + Process Comment) */}
        {isCurrentSessionCheckpoint && (() => {
          const ungradedPracticeNames = students
            .filter((s) => {
              const att = String(s.attendanceStatus || "").toUpperCase();
              return (
                att !== "ABSENT" &&
                att !== "EXCUSED" &&
                Boolean(s.checkpointData?.hasUngradedPractice) &&
                !s.checkpointData?.userEditedPractice
              );
            })
            .map((s) => s.fullName);

          return (
            <div className="mt-3">
              <div className="mindx-warm-box px-3.5 py-2.5 rounded-xl text-xs flex flex-col md:flex-row md:items-center justify-between gap-2.5">
                <div className="flex items-center gap-2 font-black flex-wrap">
                  <span className="text-base">📌</span>
                  <span>Checkpoint — Buổi {activeSessionNumber}</span>
                  {isCurrentSessionLego && (
                    <span className="px-2 py-0.5 rounded-md bg-amber-200 text-amber-950 border border-[#0f172a] text-[11px] font-black">
                      🧩 LEGO 7 sao
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    data-testid="checkpoint-sync-btn"
                    onClick={() => {
                      void handleCheckpointSync(true);
                    }}
                    disabled={isSyncingCheckpoint || isSyncing}
                    className="neo-btn-yellow px-3 py-1.5 rounded-lg disabled:opacity-50 font-black text-xs flex items-center gap-1.5 cursor-pointer"
                    title={
                      isCurrentSessionLego
                        ? "Tính tự động 7 ô [ĐNL] LEGO Robotics theo quá trình trên lớp"
                        : "Kết nối LMS lấy điểm Lý thuyết/Thực hành mới nhất và tự động tính 9 ô [ĐNL]"
                    }
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncingCheckpoint ? "animate-spin" : ""}`} />
                    {isSyncingCheckpoint
                      ? isCurrentSessionLego
                        ? "Đang tính 7 ô [ĐNL]..."
                        : "Đang đọc KT & Tính [ĐNL]..."
                      : isCurrentSessionLego
                      ? "📥 Tính 7 ô [ĐNL]"
                      : "📥 Đọc điểm KT & Tính [ĐNL]"}
                  </button>
                  <button
                    type="button"
                    data-testid="checkpoint-recalc-btn"
                    onClick={() => {
                      void handleCheckpointSync(false);
                    }}
                    disabled={isSyncingCheckpoint || isSyncing}
                    className="neo-btn-neutral px-2.5 py-1.5 rounded-lg disabled:opacity-50 font-bold text-[11px] cursor-pointer"
                    title={
                      isCurrentSessionLego
                        ? "Tính lại nhanh 7 ô [ĐNL] từ lịch sử trên máy (không mở lại LMS)"
                        : "Tính lại nhanh 9 ô [ĐNL] từ lịch sử trên máy (không mở lại LMS)"
                    }
                  >
                    ↻ Tính lại [ĐNL]
                  </button>
                </div>
              </div>
              {ungradedPracticeNames.length > 0 && (
                <div
                  data-testid="checkpoint-ungraded-practice-warning"
                  className="mt-2 p-2.5 rounded-xl bg-amber-100 text-amber-950 border border-amber-400 dark:bg-amber-950/60 dark:text-amber-100 dark:border-amber-500/60 text-xs font-medium flex items-start gap-2"
                >
                  <span className="shrink-0">⚠️</span>
                  <span>
                    Còn <strong>{ungradedPracticeNames.length}</strong> học viên đã nộp bài Thực hành bên mục{" "}
                    <strong>Chấm bài LMS</strong> nhưng chưa chấm điểm ({ungradedPracticeNames.join(", ")}) — Bot đang để trống điểm TH để không tính nhầm 0 điểm.
                  </span>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* 3. Action Toolbar */}
      <div className="neo-section-card flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl">
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
          <span>
            Có mặt{" "}
            <strong className="text-emerald-600 dark:text-emerald-400">
              {
                students.filter(
                  (s) => s.attendanceStatus === "PRESENT" || s.attendanceStatus === "LATE"
                ).length
              }
              /{students.length}
            </strong>
          </span>
          <span>•</span>
          <span>
            Đã duyệt{" "}
            <strong className="text-indigo-600 dark:text-indigo-400">
              {students.filter((s) => s.status === "APPROVED" || s.status === "VERIFIED").length}
            </strong>
          </span>
          <span>•</span>
          <span>
            Đã lưu LMS{" "}
            <strong className="text-emerald-600 dark:text-emerald-400">
              {students.filter((s) => s.status === "VERIFIED").length}
            </strong>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/classroom-manager${
              (classCode || classId).trim()
                ? `?classId=${encodeURIComponent((classCode || classId).trim().toUpperCase())}&sessionNumber=${activeSessionNumber || 1}`
                : ""
            }`}
            data-testid="open-classroom-manager-link"
            className="neo-btn-neutral flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-extrabold"
            title="Mở trang Quản lý Giờ học để chấm sao, đếm lỗi hoặc chiếu bảng thi đua trên lớp"
          >
            ⭐ Quản lý Giờ học
          </Link>

          <button
            type="button"
            data-testid="open-class-lms-btn"
            onClick={() => {
              void handleOpenClassOnLms();
            }}
            disabled={
              (!classCode.trim() && !classId.trim()) || Boolean(openingLmsClass)
            }
            className="neo-btn-blue flex items-center gap-1.5 px-3 py-1.5 rounded-lg disabled:opacity-50 text-xs font-black cursor-pointer mindx-dark-keep"
            title={
              (classCode || classId).trim()
                ? `Mở trực tiếp lớp ${(classCode || classId).trim().toUpperCase()} (tab Comments) trên MindX LMS trong tab mới`
                : "Chọn lớp để mở trang MindX LMS"
            }
          >
            <ExternalLink
              className={`w-4 h-4 ${openingLmsClass ? "animate-pulse" : ""}`}
            />
            {openingLmsClass ? "Đang mở LMS..." : "Mở LMS"}
          </button>

          <button
            type="button"
            onClick={() => handleConfirmAllPresent(true)}
            disabled={students.length === 0}
            className="neo-btn-neutral flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-extrabold cursor-pointer"
            title="Điểm danh cả lớp Có mặt (giữ nguyên thẻ đã nhớ từ buổi trước, hoặc gắn thẻ Tiếp thu tốt cho bạn chưa có thẻ)"
          >
            <UserCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Có mặt cả lớp</span>
            <span className="sr-only">⚡ Điểm danh cả lớp Có mặt</span>
          </button>

          <button
            onClick={() => handleGenerateAi()}
            disabled={isGeneratingAi || students.length === 0}
            className="neo-btn-purple flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg disabled:opacity-50 text-xs sm:text-sm font-black cursor-pointer mindx-dark-keep"
          >
            <Sparkles className={`w-4 h-4 ${isGeneratingAi ? "animate-spin" : ""}`} />
            {isGeneratingAi ? "AI Đang Soạn..." : "AI Soạn Nhận Xét"}
          </button>

          <button
            onClick={() => handleApproveAndSaveLms()}
            disabled={
              isSavingLms ||
              students.filter(
                (s) =>
                  (s.attendanceStatus === "PRESENT" || s.attendanceStatus === "LATE") &&
                  Boolean(s.finalText && s.finalText.trim()) &&
                  s.status !== "INSUFFICIENT_INFO" &&
                  (s.status !== "VERIFIED" ||
                    needsStudentCheckpointLmsTick(
                      isCurrentSessionCheckpoint,
                      s,
                      classCode || classId
                    ))
              ).length === 0
            }
            className="neo-btn-emerald flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg disabled:opacity-50 text-xs sm:text-sm font-black cursor-pointer mindx-dark-keep"
          >
            <Send className={`w-4 h-4 ${isSavingLms ? "animate-spin" : ""}`} />
            {isSavingLms
              ? `Đang Ghi LMS (B${activeSessionNumber})...`
              : `Duyệt & Đẩy LMS (B${activeSessionNumber})`}
          </button>
        </div>
      </div>

      {pendingClassroomLogsCount > 0 && (
        <div
          data-testid="pending-classroom-logs-bar"
          className="neo-details-bar px-3.5 py-2 rounded-xl flex items-center justify-between gap-3 text-xs font-bold"
        >
          <span className="truncate">
            ⭐ Có {pendingClassroomLogsCount} học viên mới chấm trong Quản lý Giờ học (Buổi {activeSessionNumber}) chưa nạp vào nhận xét.
          </span>
          <button
            type="button"
            data-testid="apply-classroom-logs-inline-btn"
            onClick={() => {
              void handleApplyClassroomLogsInline();
            }}
            disabled={isApplyingClassroomLogs}
            className="neo-btn-blue shrink-0 px-3 py-1 rounded-lg disabled:opacity-50 text-xs font-black cursor-pointer mindx-dark-keep"
          >
            {isApplyingClassroomLogs ? "Đang nạp..." : "📥 Nạp Giờ học"}
          </button>
        </div>
      )}

      {/* 4. Student Comments Table */}
      <div className="neo-section-card rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="mindx-thead text-xs uppercase font-bold border-b border-slate-800">
              <tr>
                <th className="px-4 py-3.5 w-44">Học viên &amp; Điểm danh</th>
                <th className="px-4 py-3.5 w-80">
                  <div className="flex items-center justify-between gap-1">
                    <span>Quick Tags</span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-bold normal-case ${
                        quickTagTrack === "robotics"
                          ? "bg-amber-500 text-white"
                          : "bg-sky-500 text-white"
                      }`}
                    >
                      {quickTagTrack === "robotics" ? "🤖 Robotics" : "💻 Lập trình"}
                    </span>
                  </div>
                </th>
                <th className="px-4 py-3.5 w-52">Ghi chú của GV</th>
                <th className="px-4 py-3.5 min-w-[340px]">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span>Nhận xét 3 phần</span>
                  </div>
                </th>
                <th className="px-4 py-3.5 w-40 text-right">Trạng thái &amp; Lưu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {students.length > 0 ? (
                students.map((student) => {
                  const attStatus = student.attendanceStatus || "UNKNOWN";
                  const isPresent = attStatus === "PRESENT" || attStatus === "LATE";
                  const isAbsent = attStatus === "ABSENT";
                  const isSavingThis = savingStudentId === student.studentId;

                  return (
                    <tr
                      key={student.studentId}
                      className={`border-l-4 transition ${
                        student.status === "VERIFIED"
                          ? "border-l-emerald-500 bg-emerald-950/10"
                          : student.status === "APPROVED"
                          ? "border-l-indigo-600 bg-indigo-950/10"
                          : "border-l-amber-500"
                      }`}
                    >
                      {/* Name & Attendance (3.6: No STT column, no studentId subtext) */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white">{student.fullName}</span>
                          {!student.isActive && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
                              Nghỉ/Bảo lưu
                            </span>
                          )}
                        </div>
                        <div className="mt-2 flex items-center gap-1.5">
                          <button
                            onClick={() => handleAttendanceChange(student.studentId)}
                            className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold transition cursor-pointer ${
                              isPresent
                                ? "bg-emerald-500 text-white shadow-sm"
                                : isAbsent
                                ? "bg-rose-500 text-white shadow-sm"
                                : "bg-amber-400 text-slate-950 shadow-sm"
                            }`}
                          >
                            {isPresent
                              ? "✓ Có mặt"
                              : isAbsent
                              ? "✕ Nghỉ học"
                              : "! Chưa điểm danh"}
                          </button>
                        </div>
                      </td>

                      {/* Quick Tags (3.2: Single compact row of 7 Coding or 6 Robotics tags) */}
                      <td className="px-4 py-4">
                        {(() => {
                          const rawVisible = quickTags.filter((tag) => {
                            const tagTrack = classifyQuickTagTrack(tag);
                            if (tagTrack === "session14") return false;
                            return tagTrack === "common" || tagTrack === quickTagTrack;
                          });

                          const seenLabels = new Set<string>();
                          const visibleTags: QuickTagItem[] = [];
                          for (const t of rawVisible) {
                            if (!seenLabels.has(t.label)) {
                              seenLabels.add(t.label);
                              visibleTags.push(t);
                            }
                          }

                          return (
                            <div className="flex flex-wrap gap-1.5">
                              {visibleTags.map((tag, tagIdx) => {
                                const isSelected = student.quickTags?.includes(tag.label);
                                const isConstructive =
                                  tag.sentiment === "constructive" ||
                                  tag.role === "slow" ||
                                  tag.role === "distracted" ||
                                  tag.role === "improve";

                                const unselectedClass =
                                  "bg-slate-800/80 text-slate-300 border-slate-700/80 hover:border-slate-500 hover:text-white";
                                const selectedClass = isConstructive
                                  ? "mindx-dark-btn bg-amber-600 text-white border-amber-500 font-bold shadow-sm"
                                  : "mindx-dark-btn bg-emerald-600 text-white border-emerald-500 font-bold shadow-sm";

                                return (
                                  <button
                                    key={tag.id || `tag-${tagIdx}`}
                                    type="button"
                                    title={
                                      tag.hint
                                        ? `AI sẽ hiểu: "${tag.hint}"`
                                        : tag.categoryName || tag.label
                                    }
                                    onClick={() => toggleQuickTag(student.studentId, tag.label)}
                                    className={`px-2 py-1 rounded text-xs transition border cursor-pointer ${
                                      isSelected ? selectedClass : unselectedClass
                                    }`}
                                  >
                                    {tag.label}
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </td>

                      {/* Teacher Note */}
                      <td className="px-4 py-4">
                        <textarea
                          rows={5}
                          value={student.teacherNote || ""}
                          onChange={(e) =>
                            handleNoteChange(student.studentId, e.target.value, { debounceMs: 600 })
                          }
                          onBlur={() => {
                            void flushPendingDraftSave(student.studentId);
                          }}
                          placeholder="Ghi chú thêm cho học sinh..."
                          className="w-full bg-slate-950/90 border border-slate-700/90 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-blue-500 resize-y leading-relaxed"
                        />
                      </td>

                      {/* Unified 3-Part Comment Editor (3.7: moved hint to table header) */}
                      <td className="px-4 py-4 space-y-2">
                        {(() => {
                          const levelInfo = resolveStudentSkillLevelLabel(
                            student.quickTags,
                            quickTags
                          );
                          const rawFinalText =
                            student.finalText &&
                            !student.finalText.startsWith("Chưa đủ thông tin")
                              ? student.finalText.replace(
                                  /^\s*\*\*[^*\n]+\*\*\s*\r?\n+(?=\s*[-•*]\s*\*\*Điểm mạnh)/i,
                                  ""
                                )
                              : "";
                          const displayValue = rawFinalText
                            ? rawFinalText
                            : student.strengths || student.improvements || student.actionPlan
                            ? [
                                `- **Điểm mạnh của học viên:** ${student.strengths || ""}`,
                                "",
                                `- **Điểm cần cải thiện:** ${student.improvements || ""}`,
                                "",
                                `- **Lời khuyên:** ${student.actionPlan || ""}`,
                              ].join("\n")
                            : "";

                          return (
                            <>
                              <div className="flex flex-wrap items-center justify-between gap-1.5">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span
                                    className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${levelInfo.badgeClass}`}
                                    title="Tự động phân loại vào 1 trong 5 cấp độ chuẩn dựa trên Quick Tags đã tích chọn"
                                  >
                                    🎯{" "}
                                    {levelInfo.label
                                      .replace("Cấp độ ", "Cấp ")
                                      .replace(" - ", ": ")
                                      .replace("Khá nhưng mất tập trung", "Khá (mất tập trung)")}
                                  </span>
                                  {student.inheritedFromSession && (
                                    <span
                                      className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30"
                                      title={`Đã tự động nhớ bộ thẻ từ Buổi ${student.inheritedFromSession}. Thầy chỉ cần bấm đổi thẻ nếu buổi hôm nay bạn học khác đi.`}
                                    >
                                      ↺ Từ B{student.inheritedFromSession}
                                    </span>
                                  )}
                                  {isCurrentSessionCheckpoint && student.checkpointData && (() => {
                                    const rowCp = student.checkpointData;
                                    const rowIsLego = Boolean(rowCp.isLego ?? isCurrentSessionLego);
                                    const rowDnlCount = rowIsLego ? 7 : 9;
                                    return (
                                      <div className="inline-flex flex-wrap items-center gap-1.5">
                                        <span
                                          data-testid={`cp-score-badge-${student.studentId}`}
                                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-500/20 dark:text-amber-200 dark:border-amber-500/40"
                                          title={
                                            rowIsLego
                                              ? `Trung bình ${rowDnlCount} ô [ĐNL] LEGO Robotics Bot tính theo quá trình`
                                              : `Điểm Lý thuyết / Thực hành (từ LMS hoặc sửa tay) & Trung bình ${rowDnlCount} ô [ĐNL] Bot tính theo quá trình`
                                          }
                                        >
                                          {rowIsLego ? (
                                            <>
                                              📊 ĐNL:{" "}
                                              {rowCp.competencyAverage !== null
                                                ? rowCp.competencyAverage.toFixed(2)
                                                : "—"}
                                            </>
                                          ) : (
                                            <>
                                              📊 LT:{" "}
                                              {rowCp.theoryScore !== null
                                                ? rowCp.theoryScore.toFixed(1)
                                                : "—"}{" "}
                                              | TH:{" "}
                                              {rowCp.practiceScore !== null
                                                ? rowCp.practiceScore.toFixed(1)
                                                : "—"}{" "}
                                              | ĐNL:{" "}
                                              {rowCp.competencyAverage !== null
                                                ? rowCp.competencyAverage.toFixed(2)
                                                : "—"}
                                              {(rowCp.userEditedTheory ||
                                                rowCp.userEditedPractice) && (
                                                <span className="ml-0.5 text-amber-800 dark:text-amber-300">
                                                  ✎
                                                </span>
                                              )}
                                            </>
                                          )}
                                        </span>
                                        <button
                                          type="button"
                                          data-testid={`edit-dnl-btn-${student.studentId}`}
                                          onClick={() => setEditingCompetencyStudentId(student.studentId)}
                                          className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-sky-100 text-sky-900 border border-sky-300 hover:bg-sky-200 dark:bg-sky-500/20 dark:text-sky-200 dark:border-sky-500/40 dark:hover:bg-sky-500/30 transition cursor-pointer"
                                          title={`Xem chi tiết quá trình và chỉnh tay ${rowDnlCount} tiêu chí [ĐNL] (1..5 sao) trước khi đẩy LMS`}
                                        >
                                          ⚙️ {rowDnlCount} ô [ĐNL]
                                        </button>
                                        {hasMatchingCheckpointLmsCompetency(
                                          rowCp,
                                          classCode || classId
                                        ) ? (
                                          <span
                                            data-testid={`cp-lms-tick-status-${student.studentId}`}
                                            className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-900 border border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-200 dark:border-emerald-500/40"
                                            title={`Đã tích đủ ${rowDnlCount}/${rowDnlCount} [ĐNL] trên MindX LMS và xác minh thành công`}
                                          >
                                            ✓ Đã tích LMS
                                          </span>
                                        ) : (
                                          <span
                                            data-testid={`cp-lms-tick-status-${student.studentId}`}
                                            className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-500/20 dark:text-amber-200 dark:border-amber-500/40"
                                            title={`Chưa tích đủ ${rowDnlCount}/${rowDnlCount} [ĐNL] trên MindX LMS`}
                                          >
                                            ⏳ Chưa tích LMS
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </div>
                                {student.errorMessage && student.status !== "INSUFFICIENT_INFO" && (
                                  <span className="text-[11px] text-amber-300 font-medium">
                                    ⚠️ {student.errorMessage}
                                  </span>
                                )}
                              </div>

                              {student.status === "INSUFFICIENT_INFO" && (
                                <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-center gap-2">
                                  <AlertCircle className="w-4 h-4 shrink-0" />
                                  <span>
                                    {student.errorMessage ||
                                      "Chưa đủ thông tin (Cần chọn Quick Tag hoặc nhập ghi chú)."}
                                  </span>
                                </div>
                              )}

                              {(student.status !== "INSUFFICIENT_INFO" ||
                                Boolean(displayValue.trim())) && (
                                <textarea
                                  rows={6}
                                  value={displayValue}
                                  onChange={(e) =>
                                    handleTextEdit(
                                      student.studentId,
                                      "finalText",
                                      e.target.value,
                                      { debounceMs: 600 }
                                    )
                                  }
                                  onBlur={() => {
                                    void flushPendingDraftSave(student.studentId);
                                  }}
                                  placeholder={`- **Điểm mạnh của học viên:** ...\n\n- **Điểm cần cải thiện:** ...\n  + ...\n\n- **Lời khuyên:** ...`}
                                  className="w-full bg-slate-950/90 border border-slate-700/90 rounded-lg p-3 text-xs text-slate-100 leading-relaxed focus:outline-none focus:border-blue-500 resize-y font-sans"
                                />
                              )}
                            </>
                          );
                        })()}
                      </td>

                      {/* Status & Actions (3.6: "Đã lưu LMS ✓" & "Duyệt") */}
                      <td className="px-4 py-4 text-right space-y-2">
                        <div>
                          {student.status === "VERIFIED" ? (
                            <span className="mindx-dark-keep inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-700 text-white shadow-sm">
                              <ShieldCheck className="w-3.5 h-3.5" /> Đã lưu LMS ✓
                            </span>
                          ) : student.status === "APPROVED" ? (
                            <span className="mindx-dark-keep inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-indigo-700 text-white shadow-sm">
                              <Check className="w-3.5 h-3.5" /> Đã duyệt
                            </span>
                          ) : student.status === "WAITING_APPROVAL" ? (
                            <span className="mindx-dark-keep inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-amber-700 text-white shadow-sm">
                              Chờ duyệt
                            </span>
                          ) : student.status === "SAVING" ? (
                            <span className="mindx-dark-keep inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-blue-700 text-white animate-pulse">
                              Đang lưu...
                            </span>
                          ) : student.status === "FAILED" ? (
                            <span className="mindx-dark-keep inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-rose-700 text-white">
                              Thất bại
                            </span>
                          ) : (
                            <span className="mindx-dark-keep inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-700 text-white">
                              Bản nháp
                            </span>
                          )}
                        </div>

                        {isCurrentSessionCheckpoint && student.status === "APPROVED" && (
                          <p className="text-[11px] text-amber-300 font-medium leading-snug">
                            {Boolean(student.checkpointData?.isLego ?? isCurrentSessionLego)
                              ? "Kiểm tra 7 ô [ĐNL] hoặc bấm Đẩy lại để Bot tự tích & lưu LMS"
                              : "Kiểm tra 9 ô [ĐNL] hoặc bấm Đẩy lại để Bot tự tích & lưu LMS"}
                          </p>
                        )}

                        <div className="flex flex-col gap-1 items-end">
                          {isPresent && student.isActive !== false && (
                            <button
                              type="button"
                              data-testid={`ai-single-btn-${student.studentId}`}
                              onClick={() => {
                                void handleGenerateSingleAi(student.studentId);
                              }}
                              disabled={
                                isGeneratingAi ||
                                Boolean(generatingSingleStudentId) ||
                                isSavingThis
                              }
                              className="neo-btn-purple px-2.5 py-1 rounded-md disabled:opacity-40 text-xs font-bold flex items-center gap-1 cursor-pointer mindx-dark-keep"
                              title="Chỉ gọi AI soạn lại nhận xét riêng cho học viên này (giữ nguyên các bạn khác)"
                            >
                              {generatingSingleStudentId === student.studentId ? (
                                <>
                                  <RefreshCw className="w-3 h-3 animate-spin" />
                                  <span>Đang soạn...</span>
                                </>
                              ) : (
                                <span>✨ AI riêng</span>
                              )}
                            </button>
                          )}

                          {(student.status !== "VERIFIED" ||
                            needsStudentCheckpointLmsTick(
                              isCurrentSessionCheckpoint,
                              student,
                              classCode || classId
                            )) && (() => {
                            const needsTick =
                              student.status === "VERIFIED" &&
                              needsStudentCheckpointLmsTick(
                                isCurrentSessionCheckpoint,
                                student,
                                classCode || classId
                              );
                            const rowDnlCount = Boolean(
                              student.checkpointData?.isLego ?? isCurrentSessionLego
                            )
                              ? 7
                              : 9;
                            return (
                              <button
                                data-testid={`save-single-btn-${student.studentId}`}
                                onClick={() => handleApproveAndSaveSingle(student.studentId)}
                                disabled={
                                  isSavingThis ||
                                  !isPresent ||
                                  !student.finalText ||
                                  student.status === "INSUFFICIENT_INFO"
                                }
                                className={`px-2.5 py-1 rounded-md disabled:opacity-40 text-white text-xs font-semibold transition flex items-center gap-1 cursor-pointer ${
                                  needsTick
                                    ? "bg-amber-600 hover:bg-amber-500"
                                    : "bg-emerald-600 hover:bg-emerald-500"
                                }`}
                                title={
                                  needsTick
                                    ? `Nhận xét đã lưu LMS nhưng chưa ghi nhận đủ ${rowDnlCount} ô [ĐNL] — bấm để Bot tích ${rowDnlCount} ô [ĐNL] và lưu lại lên LMS`
                                    : undefined
                                }
                              >
                                {isSavingThis ? (
                                  <RefreshCw className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Send className="w-3 h-3" />
                                )}
                                {needsTick
                                  ? rowDnlCount === 7
                                    ? "Tích 7 ô [ĐNL] & Lưu"
                                    : "Tích 9 ô [ĐNL] & Lưu"
                                  : student.status === "FAILED"
                                  ? "Thử lại"
                                  : student.status === "APPROVED"
                                  ? `Đẩy lại (Buổi ${activeSessionNumber})`
                                  : "Duyệt & Lưu riêng"}
                              </button>
                            );
                          })()}

                          <button
                            onClick={() => copyToClipboard(student.finalText || "", student.studentId)}
                            disabled={!student.finalText}
                            className="text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-1 transition cursor-pointer"
                          >
                            {copiedStudentId === student.studentId ? (
                              <Check className="w-3 h-3 text-emerald-500" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                            {copiedStudentId === student.studentId ? "Đã copy!" : "Copy nhận xét"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    Chưa có dữ liệu học viên. Vui lòng bấm <strong>&ldquo;Đồng bộ lớp&rdquo;</strong> ở trên.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. Zalo Broadcast Preview Box */}
      <div className="neo-section-card p-5 rounded-2xl space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="neo-title-icon w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0">
              📱
            </span>
            <h2 className="neo-title-text text-base font-black">
              Thông báo gửi Nhóm Zalo
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Các nút bật/tắt nhanh Đoạn 2 (Tổng kết Checkpoint, Tình hình chung, Tiến độ SPCK) & Đoạn 3 (Ảnh + Học liệu) */}
            {isCurrentSessionCheckpoint && (
              (() => {
                const isCpZaloActive =
                  zaloIncludeCheckpointSummary !== undefined
                    ? zaloIncludeCheckpointSummary
                    : true;
                return (
                  <button
                    type="button"
                    data-testid="toggle-zalo-checkpoint-btn"
                    onClick={() => {
                      const nextVal = !isCpZaloActive;
                      setZaloIncludeCheckpointSummary(nextVal);
                      setIsZaloManuallyEdited(false);
                      setZaloBroadcastText(
                        buildAutoZaloBroadcastText(undefined, {
                          includeCheckpointSummary: nextVal,
                        })
                      );
                    }}
                    className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                      isCpZaloActive
                        ? "bg-amber-100 border-amber-400 text-amber-900 dark:bg-amber-500/20 dark:border-amber-500/50 dark:text-amber-200"
                        : "bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200"
                    }`}
                    title="Bật/tắt mục Tổng kết quá trình & Checkpoint trong thông báo Zalo (chỉ nêu tổng quan & tuyên dương, không liệt kê điểm từng bạn)"
                  >
                    {isCpZaloActive ? "✓ Tổng kết Checkpoint" : "+ Tổng kết Checkpoint"}
                  </button>
                );
              })()
            )}
            <button
              type="button"
              onClick={() => {
                const nextVal = !zaloIncludeGeneralUpdate;
                setZaloIncludeGeneralUpdate(nextVal);
                setIsZaloManuallyEdited(false);
                setZaloBroadcastText(
                  buildAutoZaloBroadcastText(undefined, { includeGeneralUpdate: nextVal })
                );
              }}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                zaloIncludeGeneralUpdate
                  ? "bg-indigo-100 border-indigo-400 text-indigo-900 dark:bg-indigo-500/20 dark:border-indigo-500/50 dark:text-indigo-300"
                  : "bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200"
              }`}
              title="Bật/tắt mục 2a: Cập nhật tình hình chung (ghi nhận sự tiến bộ hoặc các bạn cần kèm thêm)"
            >
              {zaloIncludeGeneralUpdate ? "✓ " : "+ "}
              <span className="sr-only">2a. </span>Tình hình chung
            </button>

            {(() => {
              const currentSessNum =
                sessions.find((s) => s.sessionId === selectedSessionId)?.sessionNumber || 1;
              const isSpckActive =
                zaloIncludeSpckProgress !== undefined
                  ? zaloIncludeSpckProgress
                  : currentSessNum >= 11;
              return (
                <button
                  type="button"
                  onClick={() => {
                    const nextVal = !isSpckActive;
                    setZaloIncludeSpckProgress(nextVal);
                    setIsZaloManuallyEdited(false);
                    setZaloBroadcastText(
                      buildAutoZaloBroadcastText(undefined, { includeSpckProgress: nextVal })
                    );
                  }}
                  className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                    isSpckActive
                      ? "bg-purple-100 border-purple-400 text-purple-900 dark:bg-purple-500/20 dark:border-purple-500/50 dark:text-purple-300"
                      : "bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200"
                  }`}
                  title="Bật/tắt mục 2c: Tiến độ sản phẩm cuối khóa (Tự động bật từ Buổi 11 - 14)"
                >
                  {isSpckActive ? "✓ " : "+ "}
                  <span className="sr-only">2c. </span>Tiến độ SPCK
                </button>
              );
            })()}

            <button
              type="button"
              onClick={() => {
                const nextVal = !zaloIncludePart3Media;
                setZaloIncludePart3Media(nextVal);
                setIsZaloManuallyEdited(false);
                setZaloBroadcastText(
                  buildAutoZaloBroadcastText(undefined, { includePart3MediaReminder: nextVal })
                );
              }}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                zaloIncludePart3Media
                  ? "bg-sky-100 border-sky-400 text-sky-900 dark:bg-sky-500/20 dark:border-sky-500/50 dark:text-sky-300"
                  : "bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200"
              }`}
              title="Bật/tắt Đoạn 3: Lời nhắn gửi kèm hình ảnh hoạt động lớp học & tài liệu/học liệu"
            >
              {zaloIncludePart3Media ? "✓ " : "+ "}
              <span className="sr-only">3. </span>Gửi ảnh &amp; Học liệu
            </button>

            {!isCurrentClassRobotics && activeSessionNumber >= 2 && (
              <button
                type="button"
                data-testid="fetch-btvn-lms-btn"
                onClick={(e) => {
                  void handleFetchBtvnFromLms(e.shiftKey);
                }}
                disabled={isFetchingBtvnLms || isAnalyzingBtvnImage}
                className="neo-btn-blue flex items-center gap-1.5 px-3.5 py-2 rounded-lg disabled:opacity-50 text-xs font-black cursor-pointer mindx-dark-keep"
                title="Đọc trực tiếp bảng nộp BTVN từ MindX LMS cho buổi trước và gắn Phần 2 vào thông báo Zalo (giữ Shift + bấm để quét mới từ LMS)"
              >
                {isFetchingBtvnLms ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Đang lấy BTVN...</span>
                  </>
                ) : (
                  <span>📥 Lấy BTVN LMS</span>
                )}
              </button>
            )}

            <input
              ref={btvnImageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUploadBtvnImage(f);
              }}
            />
            <button
              type="button"
              data-testid="upload-btvn-image-btn"
              onClick={() => btvnImageInputRef.current?.click()}
              disabled={isAnalyzingBtvnImage || isFetchingBtvnLms}
              className="neo-btn-yellow flex items-center gap-1.5 px-3.5 py-2 rounded-lg disabled:opacity-50 text-xs font-black cursor-pointer"
              title="Dự phòng: tải ảnh chụp danh sách nộp BTVN (Denise/LMS) để AI lọc 'Not submitted' và nối Phần 2 vào tin nhắn Zalo"
            >
              {isAnalyzingBtvnImage ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Đang đọc ảnh...</span>
                </>
              ) : (
                <span>📷 Ảnh BTVN</span>
              )}
            </button>

            {zaloBtvnPart2Text && (
              <button
                type="button"
                data-testid="clear-zalo-part2-btn"
                onClick={() => {
                  restoredManualLockRef.current = "";
                  setZaloBtvnPart2Text("");
                  setIsZaloManuallyEdited(false);
                  setZaloBroadcastText(buildAutoZaloBroadcastText(""));
                }}
                className="neo-btn-neutral px-3 py-2 rounded-lg text-xs font-black cursor-pointer"
                title="Xóa Phần 2 tình trạng BTVN khỏi thông báo Zalo"
              >
                ✕ Bỏ Phần 2
              </button>
            )}

            <button
              type="button"
              data-testid="reset-zalo-template-btn"
              onClick={() => {
                restoredManualLockRef.current = "";
                setIsZaloManuallyEdited(false);
                setZaloBroadcastText(buildAutoZaloBroadcastText());
              }}
              className="neo-btn-neutral px-3 py-2 rounded-lg text-xs font-black cursor-pointer"
              title="Đặt lại nội dung thông báo Zalo theo mẫu tự động của buổi học"
            >
              ↺ Đặt lại mẫu
            </button>

            <button
              onClick={() => copyToClipboard(zaloBroadcastText)}
              className="neo-btn-emerald flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black cursor-pointer mindx-dark-keep"
            >
              {copiedZalo ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copiedZalo ? "Đã sao chép!" : "Copy Zalo"}
            </button>
          </div>
        </div>

        <div className="relative">
          <textarea
            rows={14}
            value={zaloBroadcastText}
            onChange={(e) => {
              restoredManualLockRef.current = "";
              setIsZaloManuallyEdited(true);
              setZaloBroadcastText(e.target.value);
            }}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 font-sans text-sm text-slate-200 focus:outline-none focus:border-emerald-500 leading-relaxed resize-y"
          />
        </div>
      </div>

      {/* Checkpoint 9-[ĐNL] Process & Competency Inspector Modal */}
      {(() => {
        if (!editingCompetencyStudentId) return null;
        const targetStudent = students.find((s) => s.studentId === editingCompetencyStudentId);
        const cp = targetStudent?.checkpointData;
        if (!targetStudent || !cp) return null;
        const compScores = safeParseCompScoresUi(cp.competencyScores || {});
        const proc = cp.processSummary;
        const isModalLego = Boolean(
          cp.isLego ??
            checkpointStageInfo?.isLego ??
            isLegoRoboticsClassCodeSafe(classCode || classId)
        );
        const modalSpecs = safeGetCompSpecsForClassUi(
          isModalLego ? "LEGO" : classCode || classId
        );
        const modalDnlCount = modalSpecs.length || (isModalLego ? 7 : 9);
        const modalCompAvg = safeCalcCompAvgForClassUi(
          compScores,
          isModalLego ? "LEGO" : classCode || classId
        );

        return (
          <div
            data-testid="checkpoint-dnl-modal"
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4"
            onClick={() => setEditingCompetencyStudentId(null)}
          >
            <div
              className="w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#0f172a] dark:border-slate-600 shadow-[4px_4px_0_#0f172a] p-5 space-y-4 text-slate-900 dark:text-slate-100 max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
                  <span>
                    Bảng {modalDnlCount} ô Điểm Năng lực [ĐNL] — {targetStudent.fullName} (CP{cp.cpStage})
                  </span>
                  {isModalLego && (
                    <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-[#0f172a] text-[11px] font-black">
                      🧩 LEGO {modalDnlCount} sao
                    </span>
                  )}
                </h3>
                <button
                  type="button"
                  onClick={() => setEditingCompetencyStudentId(null)}
                  className="px-2.5 py-1 rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold cursor-pointer"
                >
                  Đóng ✕
                </button>
              </div>

              <div className={isModalLego ? "grid grid-cols-1 gap-2 text-xs" : "grid grid-cols-3 gap-2 text-xs"}>
                {!isModalLego && (
                  <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between gap-1 text-slate-700 dark:text-slate-300">
                      <span>Lý thuyết</span>
                      {cp.userEditedTheory && (
                        <div className="flex items-center gap-1">
                          <span
                            data-testid="manual-lt-badge"
                            className="px-1.5 py-0.5 rounded bg-amber-200 text-amber-950 dark:bg-amber-500/30 dark:text-amber-200 text-[10px] font-semibold"
                          >
                            ✎ Sửa tay
                          </span>
                          <button
                            type="button"
                            data-testid="reset-manual-lt-btn"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              void handleResetManualCpScore(targetStudent.studentId, "theory");
                            }}
                            disabled={isSavingManualCpScore}
                            className="px-1.5 py-0.5 rounded bg-slate-200 hover:bg-slate-300 text-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-100 text-[10px] font-semibold cursor-pointer"
                            title="Bỏ sửa tay và lấy lại điểm Lý thuyết từ LMS"
                          >
                            ↺ LMS
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5">
                      <input
                        type="number"
                        min={0}
                        max={5}
                        step={0.1}
                        placeholder="Chưa chấm"
                        data-testid="manual-lt-input"
                        value={manualTheoryInput}
                        onChange={(e) => setManualTheoryInput(e.target.value)}
                        onBlur={(e) => {
                          void handleCommitManualCpScore(
                            targetStudent.studentId,
                            "theory",
                            e.currentTarget.value
                          );
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleCommitManualCpScore(
                              targetStudent.studentId,
                              "theory",
                              e.currentTarget.value
                            );
                          }
                        }}
                        disabled={isSavingManualCpScore}
                        className="w-24 px-2 py-1 rounded-lg bg-white text-slate-900 border border-slate-300 dark:bg-slate-900 dark:text-white dark:border-slate-600 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                      <span className="text-slate-600 dark:text-slate-400 font-medium">/ 5.0</span>
                    </div>
                  </div>
                )}
                {!isModalLego && (
                  <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between gap-1 text-slate-700 dark:text-slate-300">
                      <span>Thực hành</span>
                      {cp.userEditedPractice ? (
                        <div className="flex items-center gap-1">
                          <span
                            data-testid="manual-th-badge"
                            className="px-1.5 py-0.5 rounded bg-amber-200 text-amber-950 dark:bg-amber-500/30 dark:text-amber-200 text-[10px] font-semibold"
                          >
                            ✎ Sửa tay
                          </span>
                          <button
                            type="button"
                            data-testid="reset-manual-th-btn"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              void handleResetManualCpScore(targetStudent.studentId, "practice");
                            }}
                            disabled={isSavingManualCpScore}
                            className="px-1.5 py-0.5 rounded bg-slate-200 hover:bg-slate-300 text-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-100 text-[10px] font-semibold cursor-pointer"
                            title="Bỏ sửa tay và lấy lại điểm Thực hành từ LMS"
                          >
                            ↺ LMS
                          </button>
                        </div>
                      ) : cp.hasUngradedPractice ? (
                        <span
                          data-testid="waiting-th-badge"
                          className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200 text-[10px] font-semibold"
                        >
                          Chờ chấm (#tab-3)
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5">
                      <input
                        type="number"
                        min={0}
                        max={5}
                        step={0.1}
                        placeholder={cp.hasUngradedPractice ? "Chờ chấm" : "Chưa chấm"}
                        data-testid="manual-th-input"
                        value={manualPracticeInput}
                        onChange={(e) => setManualPracticeInput(e.target.value)}
                        onBlur={(e) => {
                          void handleCommitManualCpScore(
                            targetStudent.studentId,
                            "practice",
                            e.currentTarget.value
                          );
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleCommitManualCpScore(
                              targetStudent.studentId,
                              "practice",
                              e.currentTarget.value
                            );
                          }
                        }}
                        disabled={isSavingManualCpScore}
                        className="w-24 px-2 py-1 rounded-lg bg-white text-slate-900 border border-slate-300 dark:bg-slate-900 dark:text-white dark:border-slate-600 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                      <span className="text-slate-600 dark:text-slate-400 font-medium">/ 5.0</span>
                    </div>
                  </div>
                )}
                <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-500/15 border border-amber-300 dark:border-amber-500/40 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-amber-900 dark:text-amber-300 font-semibold">
                      TB {modalDnlCount} ô [ĐNL]
                    </div>
                    <div className="text-sm font-bold text-amber-950 dark:text-amber-200 mt-0.5">
                      {modalCompAvg.toFixed(2)} / 5.0
                    </div>
                  </div>
                  {isModalLego && (
                    <span className="text-[11px] font-bold text-amber-900 dark:text-amber-200">
                      Không chấm điểm số LT/TH
                    </span>
                  )}
                </div>
              </div>

              {proc && (
                <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 text-xs space-y-1">
                  <div className="font-semibold text-slate-800 dark:text-slate-200">
                    📈 Dữ liệu quá trình (Buổi {proc.stageStartSession}–{proc.stageEndSession}):
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-700 dark:text-slate-300">
                    <span>Có mặt: <strong>{proc.presentCount}</strong> | Muộn: <strong>{proc.lateCount}</strong> | Vắng: <strong>{proc.absentCount}</strong></span>
                    <span>⭐ Sao: <strong>{proc.totalStars}</strong> | 🏅 Top 3: <strong>{proc.totalMedals}</strong> | Lỗi giờ học: <strong>{proc.totalIssues}</strong></span>
                    {proc.homeworkSummary && (
                      <span>
                        📝 BTVN Coding: <strong>{proc.homeworkSummary.completionRatePct}%</strong>
                        {proc.homeworkSummary.avgScore100 !== null ? ` (TB ${proc.homeworkSummary.avgScore100}/100)` : ""}
                      </span>
                    )}
                    {proc.previousCheckpoint && (
                      <span>
                        ⏮️ CP1 (B{proc.previousCheckpoint.sessionNumber}): LT {proc.previousCheckpoint.theoryScore ?? "—"} / TH {proc.previousCheckpoint.practiceScore ?? "—"}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {modalSpecs.map((spec, specIdx) => {
                  const curVal = compScores[spec.key];
                  return (
                    <div
                      key={spec.key}
                      className="flex items-center justify-between gap-3 p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60"
                    >
                      <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                        {specIdx + 1}. {spec.labelVi}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        {[1, 2, 3, 4, 5].map((rating) => {
                          const active = curVal === rating;
                          return (
                            <button
                              key={rating}
                              type="button"
                              onClick={() =>
                                handleUpdateStudentCompetency(
                                  targetStudent.studentId,
                                  spec.key,
                                  rating
                                )
                              }
                              className={`w-7 h-7 rounded-md text-xs font-bold border transition cursor-pointer ${
                                active
                                  ? "bg-amber-600 border-amber-500 text-white shadow-sm"
                                  : "bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-amber-400"
                              }`}
                            >
                              {rating}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}
      </div>
    </div>
  );
}
