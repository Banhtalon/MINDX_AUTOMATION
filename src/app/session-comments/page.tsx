"use client";

import React, { useState, useEffect, useRef } from "react";
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
} from "lucide-react";
import { ClassPicker } from "@/components/class-picker";
import {
  formatShortZaloName as sharedFormatShortZaloName,
  addDaysToDdMmYyyy as sharedAddDaysToDdMmYyyy,
  buildAutoZaloBroadcastText as sharedBuildAutoZaloBroadcastText,
} from "@/lib/zalo/zalo-summary";
import {
  resolveCheckpointSessionsForClass as sharedResolveCheckpointSessionsForClass,
  isCheckpointSession as sharedIsCheckpointSession,
} from "@/lib/quick-tags";

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
  status?: "INSUFFICIENT_INFO" | "DRAFT" | "APPROVED" | "SAVING" | "VERIFIED" | "FAILED";
  verifiedAt?: string | null;
  errorMessage?: string | null;
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

function detectTrackByClassCode(code: string): "coding" | "robotics" {
  return /(?:rob|pre[bai]|arm[bai]|semi[bai]|vex)/i.test(String(code || "").trim())
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

    if (/xuất sắc|giỏi|vận dụng.*sáng tạo|sáng tạo|🌟|💡|lvl_.*xuat_sac|tier_1/i.test(lower)) {
      hasExcellent = true;
      positiveCount++;
      continue;
    }
    if (
      /mất tập trung|xao nhãng|nói chuyện riêng|làm việc riêng|cần tập trung hơn|👀|tier_3/i.test(
        lower
      )
    ) {
      hasDistracted = true;
      continue;
    }
    if (/thao tác.*chậm|cú pháp còn chậm|lúng túng|hay nhầm lệnh|⌨️|🔌|🐛/i.test(lower)) {
      hasImprove = true;
      continue;
    }
    if (
      /tiếp thu chậm|lắp ráp còn chậm|nhầm chốt|cần kèm|trung bình|chưa kịp|🐢|🔩|🛠️|lvl_.*can_kem|tier_4|tier_5/i.test(
        lower
      )
    ) {
      hasSlow = true;
      continue;
    }
    if (
      /tiếp thu tốt|làm bài tập đầy đủ|lắp ráp.*lập trình tốt|hăng hái|phối hợp nhóm|giữ kit tốt|đạt yêu cầu|khá|tốt|tích cực|hiểu bài nhanh|👍|✅|📝|🙋|🤖|🤝|lvl_.*dat|tier_2/i.test(
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
  courseName?: string;
  center?: string;
  status?: string;
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

export default function SessionCommentsPage() {
  const initialSavedClass = (() => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
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
  const [isAnalyzingBtvnImage, setIsAnalyzingBtvnImage] = useState(false);
  const [isZaloManuallyEdited, setIsZaloManuallyEdited] = useState(false);
  const [copiedZalo, setCopiedZalo] = useState(false);
  const [copiedStudentId, setCopiedStudentId] = useState<string | null>(null);
  const btvnImageInputRef = useRef<HTMLInputElement | null>(null);

  // Status & loading states
  const [isSyncing, setIsSyncing] = useState(false);
  const [isFetchingClasses, setIsFetchingClasses] = useState(false);
  const [isManualClassInput, setIsManualClassInput] = useState(false);
  const [runningClasses, setRunningClasses] = useState<RunningClassOption[]>([]);
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [isSavingLms, setIsSavingLms] = useState(false);
  const [savingStudentId, setSavingStudentId] = useState<string | null>(null);
  const [pendingUnknownConfirmCount, setPendingUnknownConfirmCount] = useState(0);
  const [statusMessage, setStatusMessage] = useState<{
    type: "info" | "success" | "error";
    text: string;
  } | null>(null);

  const DRAFT_SAVE_DEBOUNCE_MS = 600;
  const latestLoadRequestIdRef = useRef(0);
  const latestAiRequestIdRef = useRef(0);
  const activeClassIdRef = useRef(initialSavedClass);
  const activeSessionIdRef = useRef("");
  const loadedScopeKeyRef = useRef("");
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

  // Restore last selected class from URL query (?classId= / ?classCode=) or browser localStorage on initial mount
  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        const urlParams = new URLSearchParams(window.location?.search || "");
        const urlClass = String(
          urlParams.get("classId") || urlParams.get("classCode") || ""
        )
          .trim()
          .toUpperCase();
        const savedClass =
          urlClass ||
          String(window.localStorage?.getItem("mindx_last_class_code") || "")
            .trim()
            .toUpperCase();
        if (savedClass && savedClass !== classId) {
          setClassCode(savedClass);
          setClassId(savedClass);
          setQuickTagTrack(detectTrackByClassCode(savedClass));
        }
      }
    } catch {}
  }, []);

  // Reset manual Zalo edit flag and fetch initial data when class/session changes
  useEffect(() => {
    let normClass = classId.trim().toUpperCase();
    const normSess = selectedSessionId.trim();
    if (!normClass && normSess.includes("_SESS_")) {
      const derivedFromSess = normSess.replace(/_SESS_\d+$/i, "").trim().toUpperCase();
      if (derivedFromSess) {
        normClass = derivedFromSess;
        setClassCode(derivedFromSess);
        setClassId(derivedFromSess);
      }
    }
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
    setIsZaloManuallyEdited(false);
    if (scopeChanged) {
      clearAllDebouncedTimers();
      unsavedDraftPatchRef.current = {};
      activeSavePromisesByStudentRef.current = {};
      studentFieldEditVersionRef.current = {};
      studentFieldConfirmedVersionRef.current = {};
      setPendingUnknownConfirmCount(0);
      setZaloBtvnPart2Text("");
      latestAiRequestIdRef.current++;
      setIsGeneratingAi(false);
      studentEditVersionRef.current = {};
      studentAttendanceVersionRef.current = {};
      studentServerMetaRef.current = {};
      pendingSavePromisesRef.current = {};
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
        if (Array.isArray(json.data.runningClasses) && json.data.runningClasses.length > 0) {
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
              (!fb || (!fb.finalText && (!fb.status || fb.status === "DRAFT"))) &&
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
              finalText: fb?.finalText || "",
              contentHash: fb?.contentHash || "",
              status: fb?.status || "DRAFT",
              verifiedAt: fb?.verifiedAt,
              errorMessage: fb?.errorMessage,
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
        const fetched: RunningClassOption[] = data.classes.map((c: any) => ({
          classCode: String(c.classCode || c.classId || "").trim().toUpperCase(),
          courseName: c.courseName || c.className || "",
          center: c.center || "",
          status: c.status || "Running",
        }));
        setRunningClasses(fetched);
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
        const targetSessId =
          data.latestActiveSessionId ||
          (data.sessions && data.sessions.length > 0 ? findLatestActiveSessionId(data.sessions) : "");

        setRunningClasses((prev) => {
          if (prev.some((c) => c.classCode === syncedClassId)) return prev;
          return [...prev, { classCode: syncedClassId, status: "Running" }];
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

  const buildAutoZaloBroadcastText = (part2Override?: string) => {
    const activePart2 = part2Override !== undefined ? part2Override : zaloBtvnPart2Text;
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
      });
    }
    const sess = sessions.find((s) => s.sessionId === selectedSessionId);
    const sessionNum = sess?.sessionNumber || 1;
    const sessionDate = sess?.date || sess?.sessionDate || "chưa xác nhận ngày học";
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
    const part1 = `@All Kính gửi quý phụ huynh học viên
Em xin phép tổng kết sau buổi học số ${sessionNum}${sessionDate ? ` – ${sessionDate}` : ""}
Mã lớp: ${upperCode}

- Lớp sĩ số ${attendanceStr}
- Các con nhớ bài tốt, tự giác trong quá trình học và năng nổ phát biểu, xây dựng bài trong buổi học.

📘 NỘI DUNG BUỔI HỌC:
BÀI ${sessionNum}: ${cleanTopicUpper}
${keyKnowledgeText}

📍 NHỮNG ĐIỂM CẦN LƯU Ý:
${keyNotesText}

📌 NỘI DUNG BUỔI HỌC KẾ TIẾP:
Thời gian: ${nextTimeLine}
Nội dung bài học: BUỔI ${nextSessionNum}: ${nextTopic}

📝 NHIỆM VỤ KHI VỀ NHÀ:
Làm bài tập về nhà trên Denise bao gồm:
${homeworkDetails}
⏰ Hạn nộp: ${deadlineLine}`;
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

  // Update Zalo broadcast template preview only when teacher has not manually edited it
  useEffect(() => {
    if (isZaloManuallyEdited) return;
    setZaloBroadcastText(buildAutoZaloBroadcastText());
  }, [
    isZaloManuallyEdited,
    classCode,
    selectedSessionId,
    sessions,
    students,
    currentTopic,
    currentKeyKnowledge,
    currentHomeworkBrief,
    syllabusList,
    zaloBtvnPart2Text,
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

    // Ensure local React state reflects the demoted DRAFT status and patched fields
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
          status: wasApprovedOrVerified ? "DRAFT" : patch.status ? safeDraftStatus : s.status,
          contentHash: wasApprovedOrVerified ? undefined : s.contentHash,
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
        ? "🤖 Lắp ráp & Lập trình tốt"
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
        s.status === "DRAFT" &&
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
          const sortedSyllabusForCheckpoint = [...syllabusList].sort(
            (a, b) => (b.courseCode?.length || 0) - (a.courseCode?.length || 0)
          );
          const matchedCourseForCheckpoint = sortedSyllabusForCheckpoint.find((c) =>
            upperCodeForCheckpoint.includes(String(c.courseCode || "").toUpperCase())
          );
          const validCourseCheckpointNums = Array.isArray(
            matchedCourseForCheckpoint?.checkpointSessions
          )
            ? matchedCourseForCheckpoint.checkpointSessions
                .map((n) => Number(n))
                .filter((n) => Number.isInteger(n) && n >= 1 && n <= 13)
            : [];
          return validCourseCheckpointNums.length > 0
            ? validCourseCheckpointNums
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
        const lmsFailedCount = Number(batchRes.failedCount || 0);
        const totalErrors = lmsFailedCount + Number(summaryContext?.approveFailedCount || 0);
        const skippedCount = Number(summaryContext?.skippedInsufficientCount || 0);

        if (verifiedCount > 0 && totalErrors === 0) {
          setStatusMessage({
            type: "success",
            text:
              summaryContext !== undefined
                ? `Đã lưu ${verifiedCount} / Bỏ qua ${skippedCount} (thiếu thông tin) / Lỗi 0 (Buổi ${activeSessionNumber}): ${verifiedCount}/${batchRes.totalCandidates} học viên đã lưu LMS ✓!`
                : `Đã lưu & đối chiếu (Buổi ${activeSessionNumber}): ${verifiedCount}/${batchRes.totalCandidates} học viên đã lưu LMS ✓!`,
          });
        } else {
          const firstError =
            batchRes.results?.find((r: any) => r.error)?.error ||
            "Không tìm thấy nhận xét đã duyệt hoặc lỗi đối chiếu trên LMS";
          setStatusMessage({
            type: "error",
            text:
              summaryContext !== undefined
                ? `Đã lưu ${verifiedCount} / Bỏ qua ${skippedCount} (thiếu thông tin) / Lỗi ${totalErrors} (Buổi ${activeSessionNumber}): ${firstError}`
                : `Lưu LMS (Buổi ${activeSessionNumber}) không đạt (${verifiedCount}/${batchRes.totalCandidates} đã lưu): ${firstError}`,
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

      const totalApproveErrors = batchApproval.failCount + preExistingFailedCount;

      if (readyForLmsCount === 0) {
        setStatusMessage({
          type: "error",
          text: `Đã lưu 0 / Bỏ qua ${skippedInsufficientCount} (thiếu thông tin) / Lỗi ${totalApproveErrors}: Chưa có học viên nào đủ điều kiện duyệt & đẩy LMS.`,
        });
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
      {/* 1. Hero Header & Class Selector */}
      <div className="mindx-hero p-5 sm:p-6 rounded-2xl transition-all">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <span className="p-2.5 rounded-xl bg-white/15 text-white text-2xl shadow-sm">📝</span>
              <div>
                <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
                  Nhận xét Buổi học &amp; Thông báo Zalo
                </h1>
              </div>
            </div>
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:bg-slate-700 text-white text-xs sm:text-sm font-semibold transition shadow-md cursor-pointer"
              title="Đồng bộ danh sách buổi học & học viên của lớp đang chọn từ LMS"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isSyncing || isFetchingClasses ? "animate-spin" : ""}`}
              />
              {isFetchingClasses
                ? "Đang quét lớp..."
                : isSyncing
                ? "Đang đồng bộ..."
                : "🔄 Đồng bộ buổi học"}
            </button>
          </div>
        </div>
      </div>

      {/* 2. Session & Syllabus Selection Card */}
      <div className="mindx-card p-5 rounded-2xl">
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
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
              Chọn Buổi học
            </label>
            <select
              value={selectedSessionId}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
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
                        {dStr ? ` (${dStr})` : ""}: {s.topic.slice(0, 35)}
                      </option>
                    );
                  })
              ) : (
                <option value="">(Chưa đồng bộ buổi học từ LMS)</option>
              )}
            </select>
            <div className="mt-2 flex items-center justify-end text-[11px] text-slate-400 px-1">
              <a
                href="/final-project"
                className="font-semibold text-blue-600 dark:text-indigo-400 hover:underline underline-offset-2"
              >
                Mở trang SPCK →
              </a>
            </div>
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
              Chủ đề &amp; Kiến thức trọng tâm (Từ Giáo trình)
            </label>
            <input
              type="text"
              value={currentTopic}
              onChange={(e) => setCurrentTopic(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              placeholder="Chủ đề buổi học hôm nay..."
            />
            {currentKeyKnowledge.length > 0 && (
              <div className="mindx-warm-box mt-2.5 p-3 rounded-lg text-xs space-y-1">
                <div className="font-bold">Nội dung buổi học:</div>
                <ul className="list-disc list-inside space-y-0.5">
                  {currentKeyKnowledge.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
                {currentHomeworkBrief && (
                  <div className="pt-1">
                    <span className="font-bold">Tóm tắt BTVN:</span> {currentHomeworkBrief}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Checkpoint Session Reminder Banner (3.3) */}
        {isCurrentSessionCheckpoint && (
          <div className="mindx-warm-box mt-4 p-3 rounded-xl text-xs flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-base">📌</span>
              <span>
                <strong>Buổi Kiểm tra Định kỳ (Checkpoint — Buổi {activeSessionNumber}):</strong> Bot{" "}
                <strong>chỉ điền ô Nhận xét chung</strong> — thầy tự tích Điểm Năng lực [ĐNL] &amp; Điểm kiểm tra trên LMS.
              </span>
            </div>
            <span className="mindx-badge-amber shrink-0 px-2.5 py-0.5 rounded-full font-semibold text-[11px]">
              Chỉ điền Nhận xét
            </span>
          </div>
        )}
      </div>

      {/* 3. Action Toolbar */}
      <div className="mindx-card flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 font-medium">
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
          <button
            type="button"
            onClick={() => handleConfirmAllPresent(true)}
            disabled={students.length === 0}
            className="mindx-dark-btn flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition shadow-sm cursor-pointer"
            title="Điểm danh cả lớp Có mặt (giữ nguyên thẻ đã nhớ từ buổi trước, hoặc gắn thẻ Tiếp thu tốt cho bạn chưa có thẻ)"
          >
            <UserCheck className="w-4 h-4 text-emerald-400" />
            ⚡ Điểm danh cả lớp Có mặt
          </button>

          <button
            onClick={() => handleGenerateAi()}
            disabled={isGeneratingAi || students.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-semibold shadow-md transition cursor-pointer"
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
                  s.status !== "VERIFIED"
              ).length === 0
            }
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold shadow-md transition cursor-pointer"
          >
            <Send className={`w-4 h-4 ${isSavingLms ? "animate-spin" : ""}`} />
            {isSavingLms
              ? `Đang Duyệt & Ghi LMS (Buổi ${activeSessionNumber})...`
              : `✅ Duyệt & Đẩy LMS (Buổi ${activeSessionNumber})`}
          </button>
        </div>
      </div>

      {/* 4. Student Comments Table */}
      <div className="mindx-card rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="mindx-thead text-xs uppercase font-bold border-b border-slate-800">
              <tr>
                <th className="px-4 py-3.5 w-44">Học viên &amp; Điểm danh</th>
                <th className="px-4 py-3.5 w-80">
                  <div className="flex items-center justify-between gap-1">
                    <span>Quick Tags 1-Chạm</span>
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
                    <span>Nhận xét 3 phần (Sửa trực tiếp)</span>
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
                          rows={2}
                          value={student.teacherNote || ""}
                          onChange={(e) =>
                            handleNoteChange(student.studentId, e.target.value, { debounceMs: 600 })
                          }
                          onBlur={() => {
                            void flushPendingDraftSave(student.studentId);
                          }}
                          placeholder="Ghi chú thêm cho học sinh..."
                          className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-blue-500 resize-none"
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
                                    🎯 {levelInfo.label}
                                  </span>
                                  {student.inheritedFromSession && (
                                    <span
                                      className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30"
                                      title={`Đã tự động nhớ bộ thẻ từ Buổi ${student.inheritedFromSession}. Thầy chỉ cần bấm đổi thẻ nếu buổi hôm nay bạn học khác đi.`}
                                    >
                                      ↺ Nhớ từ Buổi {student.inheritedFromSession}
                                    </span>
                                  )}
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
                                  rows={5}
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
                                  placeholder={`- **Điểm mạnh của học viên:** ...\n\n- **Điểm cần cải thiện:** ...\n\n- **Lời khuyên:** ...`}
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
                            Thầy hãy tích Điểm Năng lực trên LMS rồi bấm Đẩy lại
                          </p>
                        )}

                        <div className="flex flex-col gap-1 items-end">
                          {student.status !== "VERIFIED" && (
                            <button
                              onClick={() => handleApproveAndSaveSingle(student.studentId)}
                              disabled={
                                isSavingThis ||
                                !isPresent ||
                                !student.finalText ||
                                student.status === "INSUFFICIENT_INFO"
                              }
                              className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold transition flex items-center gap-1 cursor-pointer"
                            >
                              {isSavingThis ? (
                                <RefreshCw className="w-3 h-3 animate-spin" />
                              ) : (
                                <Send className="w-3 h-3" />
                              )}
                              {student.status === "FAILED"
                                ? "Thử lại"
                                : student.status === "APPROVED"
                                ? `Đẩy lại (Buổi ${activeSessionNumber})`
                                : "Duyệt & Lưu riêng"}
                            </button>
                          )}

                          <button
                            onClick={() => copyToClipboard(student.finalText || "", student.studentId)}
                            disabled={!student.finalText}
                            className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition cursor-pointer"
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

      {/* 5. Zalo Broadcast Preview Box (3.8: compact overflow menu for secondary actions) */}
      <div className="mindx-card p-6 rounded-2xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-500 text-xl">📱</span>
            <div>
              <h2 className="text-base font-bold text-white">Thông báo chung gửi Nhóm Zalo</h2>
              <p className="text-xs text-slate-400">
                Chuẩn quy tắc 6 mục ngắn gọn (tịnh tiến +7 ngày) • Chỉ thêm Phần 2 nhắc BTVN khi tải ảnh BTVN
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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
              onClick={() => btvnImageInputRef.current?.click()}
              disabled={isAnalyzingBtvnImage}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-semibold shadow-sm transition cursor-pointer"
              title="Tải ảnh chụp danh sách nộp BTVN (Denise/LMS) để AI lọc các bạn 'Not submitted' (Tên đệm + Tên) và tự động nối Phần 2 vào cuối tin nhắn Zalo"
            >
              {isAnalyzingBtvnImage ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <span>📸</span>
              )}
              {isAnalyzingBtvnImage
                ? "Đang đọc ảnh BTVN..."
                : "Tải ảnh BTVN"}
            </button>

            {(zaloBtvnPart2Text || isZaloManuallyEdited) && (
              <details className="relative">
                <summary
                  className="list-none px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-bold cursor-pointer select-none"
                  title="Tùy chọn khôi phục mẫu Zalo"
                >
                  ⋯
                </summary>
                <div className="absolute right-0 mt-1.5 w-48 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-1.5 z-20 space-y-1">
                  {zaloBtvnPart2Text && (
                    <button
                      type="button"
                      onClick={() => {
                        setZaloBtvnPart2Text("");
                        setIsZaloManuallyEdited(false);
                        setZaloBroadcastText(buildAutoZaloBroadcastText(""));
                      }}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-rose-500/15 text-rose-300 text-xs font-medium transition cursor-pointer"
                    >
                      ✕ Bỏ Phần 2 BTVN
                    </button>
                  )}
                  {isZaloManuallyEdited && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsZaloManuallyEdited(false);
                        setZaloBroadcastText(buildAutoZaloBroadcastText());
                      }}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-200 text-xs font-medium transition cursor-pointer"
                    >
                      ↺ Khôi phục mẫu tự động
                    </button>
                  )}
                </div>
              </details>
            )}

            <button
              onClick={() => copyToClipboard(zaloBroadcastText)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition shadow-md cursor-pointer"
            >
              {copiedZalo ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copiedZalo ? "Đã sao chép tin nhắn Zalo!" : "Copy Thông báo Zalo"}
            </button>
          </div>
        </div>

        <div className="relative">
          <textarea
            rows={14}
            value={zaloBroadcastText}
            onChange={(e) => {
              setIsZaloManuallyEdited(true);
              setZaloBroadcastText(e.target.value);
            }}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 font-sans text-sm text-slate-200 focus:outline-none focus:border-emerald-500 leading-relaxed resize-y"
          />
        </div>
      </div>
    </div>
  );
}
