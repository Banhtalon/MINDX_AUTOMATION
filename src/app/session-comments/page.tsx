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
  const [statusMessage, setStatusMessage] = useState<{
    type: "info" | "success" | "error";
    text: string;
  } | null>(null);

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

  // Restore last selected class from browser localStorage on initial mount (safe in SSR & VM sandbox)
  useEffect(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const savedClass = String(window.localStorage.getItem("mindx_last_class_code") || "")
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

  const loadClassData = async (targetClassId: string, targetSessionId: string) => {
    const normalizedClassId = targetClassId.trim().toUpperCase();
    const normalizedSessionId = targetSessionId.trim();
    const requestId = ++latestLoadRequestIdRef.current;
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
            effectiveSessionId = findLatestActiveSessionId(sessionList);
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
      const res = await fetch("/api/session-comments/fetch-classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();

      if (data.success && Array.isArray(data.classes) && data.classes.length > 0) {
        const fetched: RunningClassOption[] = data.classes.map((c: any) => ({
          classCode: String(c.classCode || "").trim().toUpperCase(),
          courseName: c.courseName || "",
          center: c.center || "",
          status: c.status || "Running",
        }));
        setRunningClasses(fetched);
        setIsManualClassInput(false);

        const currentUpper = classCode.trim().toUpperCase();
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
    const words = String(fullName || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return words.length >= 3 ? words.slice(1).join(" ") : words.join(" ");
  };

  const addDaysToDdMmYyyy = (dateStr?: string, daysToAdd = 7): string => {
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

    const nextTimeLine = nextDateWithWeekday
      ? nextDateWithWeekday
      : "Theo lịch học cố định của lớp (chưa xác nhận ngày cụ thể)";
    const deadlineLine = nextDateWithWeekday
      ? nextDateWithWeekday
      : "Trước buổi học kế tiếp";

    // Format key knowledge with '- ' bullets (1 concise sentence per bullet)
    const rawKnowledgeItems =
      currentKeyKnowledge.length > 0 ? currentKeyKnowledge : [currentTopic];
    const keyKnowledgeText = rawKnowledgeItems
      .map((item) => {
        const t = String(item || "").trim();
        return /^[-•*]/.test(t) ? t.replace(/^[•*]\s*/, "- ") : `- ${t}`;
      })
      .join("\n");

    // Course-specific key notes with '- ' bullets
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

    const activePart2 = part2Override !== undefined ? part2Override : zaloBtvnPart2Text;
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

  // Handle Note Change with instant auto-save
  const handleNoteChange = (studentId: string, note: string) => {
    studentEditVersionRef.current[studentId] = ++editSequenceRef.current;
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
    saveDraftToServer(
      studentId,
      {
        teacherNote: note,
        status: nextDraftStatus,
        ...((target?.inheritedFromSession ||
          studentEditVersionRef.current[`__qt_pending__${studentId}`]) &&
        target?.quickTags?.length
          ? { quickTags: target.quickTags }
          : {}),
      },
      preEditSnapshot
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
        ...((target?.inheritedFromSession ||
          studentEditVersionRef.current[`__qt_pending__${studentId}`]) &&
        target?.quickTags?.length
          ? { quickTags: target.quickTags }
          : {}),
      },
      preEditSnapshot
    );
  };

  // Handle text edit
  const handleTextEdit = (
    studentId: string,
    field: "strengths" | "improvements" | "actionPlan" | "finalText",
    value: string
  ) => {
    studentEditVersionRef.current[studentId] = ++editSequenceRef.current;
    const target = studentsRef.current.find((s) => s.studentId === studentId);
    if (!target) return;
    const preEditSnapshot: StudentItem = {
      ...target,
      quickTags: Array.isArray(target.quickTags) ? [...target.quickTags] : [],
    };
    const updated: StudentItem = { ...target, [field]: value };
    if (field !== "finalText") {
      updated.finalText = `Em ${target.fullName} ${updated.strengths || ""} ${updated.improvements || ""} ${updated.actionPlan || ""}`.trim();
    }
    // Iron Rule 4: If previously approved, editing will demote to DRAFT
    if (target.status === "APPROVED" || target.status === "VERIFIED") {
      updated.status = "DRAFT";
      updated.contentHash = undefined;
    }
    setStudents((prev) => prev.map((s) => (s.studentId === studentId ? updated : s)));
    saveDraftToServer(
      studentId,
      {
        strengths: updated.strengths,
        improvements: updated.improvements,
        actionPlan: updated.actionPlan,
        finalText: updated.finalText,
        status: updated.status,
      },
      preEditSnapshot
    );
  };

  const saveDraftToServer = async (
    targetStudentId: string,
    patch: Partial<StudentItem>,
    preEditSnapshot?: StudentItem
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
        const wasApprovedOrVerified = s.status === "APPROVED" || s.status === "VERIFIED";
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
    const fbaseEntries = explicitFieldKeys.map(
      (k) => `${k}:${serverMeta?.fields?.[k]?.ver ?? 0}`
    );

    const runSaveRequest = async (): Promise<boolean> => {
      try {
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
            body: JSON.stringify(payload),
          }
        );
        const data = typeof res?.json === "function" ? await res.json().catch(() => null) : null;
        if (
          (typeof res?.status === "number" && res.status >= 400) ||
          res?.ok === false ||
          (data && data.success === false)
        ) {
          if (!isStaleSaveResponse()) {
            setStudents((prev) =>
              prev.map((s) =>
                s.studentId === targetStudentId &&
                (!s.classId || s.classId.trim().toUpperCase() === normalizedClassId) &&
                (!s.sessionId || s.sessionId.trim() === normalizedSessionId)
                  ? previousStudentSnapshot
                  : s
              )
            );
            setStatusMessage({
              type: "error",
              text: `Lỗi lưu nháp: ${data?.error || "Không thể lưu chỉnh sửa vào SQLite."}`,
            });
          }
          return false;
        }
        if (data?.versionMeta) {
          const curRowVer = studentServerMetaRef.current[targetStudentId]?.rowVer ?? 0;
          if ((data.versionMeta.rowVer ?? 0) >= curRowVer) {
            studentServerMetaRef.current[targetStudentId] = data.versionMeta;
          }
        }
        if (data?.staleIgnored) {
          if (!isStaleSaveResponse()) {
            setStatusMessage({
              type: "error",
              text: `Xung đột phiên bản: Dữ liệu của học viên '${student.fullName}' đã được cập nhật ở tab hoặc phiên khác. Bản vừa nhập chưa được lưu và đang được giữ trên màn hình để so sánh.`,
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
              if (serverFb && !isStaleSaveResponse()) {
                if (serverFb.versionMetaJson) {
                  try {
                    const parsedMeta =
                      typeof serverFb.versionMetaJson === "string"
                        ? JSON.parse(serverFb.versionMetaJson)
                        : serverFb.versionMetaJson;
                    if (parsedMeta && typeof parsedMeta === "object") {
                      studentServerMetaRef.current[targetStudentId] = parsedMeta;
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
                  patch.teacherNote !== undefined
                    ? serverFb.teacherNote || "(trống)"
                    : patch.quickTags !== undefined
                    ? parsedServerTags.length > 0
                      ? parsedServerTags.join(", ")
                      : "(trống)"
                    : patch.strengths !== undefined
                    ? serverFb.strengths || "(trống)"
                    : patch.improvements !== undefined
                    ? serverFb.improvements || "(trống)"
                    : patch.actionPlan !== undefined
                    ? serverFb.actionPlan || "(trống)"
                    : patch.finalText !== undefined
                    ? serverFb.finalText || "(trống)"
                    : patch.attendanceStatus !== undefined
                    ? serverFb.attendanceStatus || "(trống)"
                    : serverFb.teacherNote ||
                      (parsedServerTags.length > 0 ? parsedServerTags.join(", ") : "") ||
                      serverFb.finalText ||
                      serverFb.attendanceStatus ||
                      "(trống)";
                if (serverVal) {
                  setStatusMessage({
                    type: "error",
                    text: `Xung đột phiên bản: Dữ liệu của học viên '${student.fullName}' đã được cập nhật ở tab hoặc phiên khác (Bản đã lưu: "${serverVal}"). Bản vừa nhập chưa được lưu và đang được giữ trên màn hình để so sánh.`,
                  });
                }
              }
            } catch {
              // ignore
            }
          }
          return false;
        }
        if (
          patch.quickTags !== undefined &&
          (studentEditVersionRef.current[`__qt_pending__${targetStudentId}`] || 0) <=
            requestEditVersion
        ) {
          delete studentEditVersionRef.current[`__qt_pending__${targetStudentId}`];
        }
        return true;
      } catch (err: any) {
        console.error("Lỗi lưu nháp:", err);
        if (!isStaleSaveResponse()) {
          setStudents((prev) =>
            prev.map((s) =>
              s.studentId === targetStudentId &&
              (!s.classId || s.classId.trim().toUpperCase() === normalizedClassId) &&
              (!s.sessionId || s.sessionId.trim() === normalizedSessionId)
                ? previousStudentSnapshot
                : s
            )
          );
          setStatusMessage({
            type: "error",
            text: `Lỗi lưu nháp: ${err?.message || String(err)}`,
          });
        }
        return false;
      }
    };

    const savePromise = runSaveRequest();
    pendingSavePromisesRef.current[targetStudentId] = savePromise;
    try {
      return await savePromise;
    } finally {
      if (pendingSavePromisesRef.current[targetStudentId] === savePromise) {
        delete pendingSavePromisesRef.current[targetStudentId];
      }
    }
  };

  const handleConfirmAllPresent = async (assignDefaultGoodTag = false) => {
    const reqClassId = classId.trim().toUpperCase();
    const reqSessionId = selectedSessionId.trim();
    const reqScopeKey = `${reqClassId}::${reqSessionId}`;
    const activeStudents = studentsRef.current.filter(
      (s) =>
        s.isActive !== false &&
        (!s.classId || s.classId.trim().toUpperCase() === reqClassId) &&
        (!s.sessionId || s.sessionId.trim() === reqSessionId)
    );
    if (activeStudents.length === 0) return;

    const defaultGoodLabel =
      quickTagTrack === "robotics" || detectTrackByClassCode(reqClassId) === "robotics"
        ? "🤖 Lắp ráp & Lập trình tốt"
        : "✅ Tiếp thu tốt";

    const initialAttendanceVersions = new Map<string, number>(
      activeStudents.map((s) => [s.studentId, studentAttendanceVersionRef.current[s.studentId] || 0])
    );

    let successCount = 0;
    let taggedCount = 0;
    let failCount = 0;
    const failedIds = new Set<string>();
    const failedVersions = new Map<string, number>();
    const failedNames: string[] = [];

    for (const s of activeStudents) {
      if (
        activeClassIdRef.current !== reqClassId ||
        activeSessionIdRef.current !== reqSessionId ||
        (loadedScopeKeyRef.current !== "" && loadedScopeKeyRef.current !== reqScopeKey)
      ) {
        return;
      }
      if (
        (studentAttendanceVersionRef.current[s.studentId] || 0) !==
        initialAttendanceVersions.get(s.studentId)
      ) {
        successCount++;
        continue;
      }
      const curStu =
        studentsRef.current.find(
          (item) =>
            item.studentId === s.studentId &&
            (!item.classId || item.classId.trim().toUpperCase() === reqClassId) &&
            (!item.sessionId || item.sessionId.trim() === reqSessionId)
        ) || s;
      const hasExistingOrInheritedTags = Boolean(
        curStu.quickTags && curStu.quickTags.length > 0
      );
      const shouldAddDefaultTag = Boolean(
        assignDefaultGoodTag && !hasExistingOrInheritedTags
      );
      const shouldPersistInheritedTags = Boolean(
        hasExistingOrInheritedTags && curStu.inheritedFromSession
      );
      const expectedVersion = editSequenceRef.current + 1;
      const ok = await saveDraftToServer(s.studentId, {
        attendanceStatus: "PRESENT",
        status: "DRAFT",
        ...(shouldAddDefaultTag
          ? { quickTags: [defaultGoodLabel] }
          : shouldPersistInheritedTags
          ? { quickTags: curStu.quickTags }
          : {}),
      });
      if (ok) {
        successCount++;
        if (shouldAddDefaultTag) {
          taggedCount++;
        }
      } else {
        failCount++;
        failedIds.add(s.studentId);
        failedVersions.set(s.studentId, expectedVersion);
        failedNames.push(s.fullName || s.studentId);
      }
    }

    if (
      activeClassIdRef.current !== reqClassId ||
      activeSessionIdRef.current !== reqSessionId ||
      (loadedScopeKeyRef.current !== "" && loadedScopeKeyRef.current !== reqScopeKey)
    ) {
      return;
    }

    if (failCount === 0) {
      setStatusMessage({
        type: "success",
        text: assignDefaultGoodTag
          ? `Đã điểm danh 'Có mặt' cả lớp (${successCount} học viên) và gắn thẻ mặc định "${defaultGoodLabel}" cho ${taggedCount} bạn chưa chọn thẻ! Thầy chỉ cần chỉnh lại vài bạn nổi bật hoặc cần lưu ý.`
          : `Đã xác nhận điểm danh 'Có mặt' cho toàn bộ ${successCount} học viên đang học.`,
      });
    } else {
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
    }
  };

  // AI Generate Batch Comments
  const handleGenerateAi = async () => {
    const reqClassId = classId.trim().toUpperCase();
    const reqClassCode = classCode.trim().toUpperCase();
    const reqSessionId = selectedSessionId.trim();
    const eligibleStudents = studentsRef.current.filter(
      (s) =>
        s.isActive !== false &&
        (!s.classId || s.classId.trim().toUpperCase() === reqClassId) &&
        (s.attendanceStatus === "PRESENT" || s.attendanceStatus === "LATE")
    );

    if (eligibleStudents.length === 0) {
      setStatusMessage({
        type: "error",
        text: "Chưa có học viên nào được xác nhận 'Có mặt'. Vui lòng điểm danh từng học viên hoặc bấm 'Xác nhận cả lớp Có mặt' trước khi gọi AI soạn nhận xét.",
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

    const editVersionSnapshot = studentEditVersionRef.current[studentId] || 0;
    const inflightSave = pendingSavePromisesRef.current[studentId];
    if (inflightSave) {
      const savedOk = await inflightSave;
      if (
        !savedOk ||
        activeClassIdRef.current !== reqClassId ||
        activeSessionIdRef.current !== reqSessionId ||
        (studentEditVersionRef.current[studentId] || 0) !== editVersionSnapshot
      ) {
        return false;
      }
    }

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

  // Approve all valid drafts
  const handleApproveAll = async () => {
    const eligibleDrafts = studentsRef.current.filter(
      (s) =>
        s.status === "DRAFT" &&
        s.isActive !== false &&
        (s.attendanceStatus === "PRESENT" || s.attendanceStatus === "LATE") &&
        s.finalText &&
        s.finalText.trim().length > 0
    );
    if (eligibleDrafts.length === 0) return;

    const initialEditVersions = new Map<string, number>(
      eligibleDrafts.map((s) => [s.studentId, studentEditVersionRef.current[s.studentId] || 0])
    );

    let successCount = 0;
    let failCount = 0;
    for (const s of eligibleDrafts) {
      if (
        (studentEditVersionRef.current[s.studentId] || 0) !== initialEditVersions.get(s.studentId)
      ) {
        continue;
      }
      const ok = await handleApprove(s.studentId);
      if (ok) {
        successCount++;
      } else {
        failCount++;
      }
    }
    if (failCount === 0) {
      setStatusMessage({
        type: "success",
        text: "Đã duyệt và băm mã SHA-256 cho toàn bộ nhận xét hợp lệ!",
      });
    } else {
      setStatusMessage({
        type: "error",
        text: `Lỗi duyệt hàng loạt: thành công ${successCount}/${eligibleDrafts.length}, thất bại ${failCount} học viên.`,
      });
    }
  };

  const activeSessionObj = sessions.find((s) => s.sessionId === selectedSessionId);
  const activeSessionNumber =
    activeSessionObj?.sessionNumber ||
    parseInt(selectedSessionId.match(/(\d+)(?!.*\d)/)?.[1] || "1", 10);

  const upperCodeForCheckpoint = classCode.trim().toUpperCase();
  const sortedSyllabusForCheckpoint = [...syllabusList].sort(
    (a, b) => (b.courseCode?.length || 0) - (a.courseCode?.length || 0)
  );
  const matchedCourseForCheckpoint = sortedSyllabusForCheckpoint.find((c) =>
    upperCodeForCheckpoint.includes(String(c.courseCode || "").toUpperCase())
  );
  const validCourseCheckpointNums = Array.isArray(matchedCourseForCheckpoint?.checkpointSessions)
    ? matchedCourseForCheckpoint.checkpointSessions
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 13)
    : [];
  const effectiveCheckpointSessions =
    validCourseCheckpointNums.length > 0
      ? validCourseCheckpointNums
      : detectTrackByClassCode(upperCodeForCheckpoint) === "robotics"
      ? [4, 8]
      : [5, 9];
  const isCurrentSessionCheckpoint =
    activeSessionNumber >= 1 &&
    activeSessionNumber < 14 &&
    effectiveCheckpointSessions.includes(activeSessionNumber);

  // Push to LMS (Single or All)
  const handleSaveToLms = async (targetStudentId?: string) => {
    if (targetStudentId) {
      setSavingStudentId(targetStudentId);
    } else {
      setIsSavingLms(true);
    }

    setStatusMessage({
      type: "info",
      text: targetStudentId
        ? `Đang điền Summary + Homework và lưu thử 1 học sinh lên LMS (Buổi ${activeSessionNumber})...`
        : `Đang điền Summary + Homework và đẩy toàn bộ nhận xét đã duyệt lên LMS (Buổi ${activeSessionNumber})...`,
    });

    try {
      const normalizedClassId = classId.trim().toUpperCase();
      const normalizedClassCode = classCode.trim().toUpperCase();
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
        if (batchRes.verifiedCount > 0 && batchRes.failedCount === 0) {
          setStatusMessage({
            type: "success",
            text: `Đã lưu & đối chiếu (Buổi ${activeSessionNumber}): ${batchRes.verifiedCount}/${batchRes.totalCandidates} học viên đã lưu LMS ✓!`,
          });
        } else {
          const firstError =
            batchRes.results?.find((r: any) => r.error)?.error ||
            "Không tìm thấy nhận xét đã duyệt hoặc lỗi đối chiếu trên LMS";
          setStatusMessage({
            type: "error",
            text: `Lưu LMS (Buổi ${activeSessionNumber}) không đạt (${batchRes.verifiedCount}/${batchRes.totalCandidates} đã lưu): ${firstError}`,
          });
        }
        await loadClassData(normalizedClassId, selectedSessionId);
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
                <p className="mindx-hero-sub text-xs mt-0.5">
                  Quick Tags 1 chạm gọn theo môn • AI soạn nhận xét 3 phần chuẩn • Lưu &amp; kiểm tra trực tiếp trên LMS
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center bg-white/95 dark:bg-slate-900/90 rounded-lg px-3 py-1.5 border border-white/40 dark:border-slate-700 shadow-sm">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 mr-2">Mã lớp:</span>
              {!isManualClassInput && runningClasses.length > 0 ? (
                <select
                  value={classCode}
                  onChange={(e) => {
                    handleSelectRunningClass(e.target.value);
                  }}
                  className="bg-transparent text-sm font-bold text-slate-900 dark:text-white focus:outline-none min-w-[180px] max-w-[300px] cursor-pointer"
                >
                  {!runningClasses.some((c) => c.classCode === classCode) && classCode && (
                    <option value={classCode} className="bg-slate-900 text-white">
                      🟢 {classCode}
                    </option>
                  )}
                  {runningClasses.map((item) => (
                    <option
                      key={item.classCode}
                      value={item.classCode}
                      className="bg-slate-900 text-white"
                    >
                      🟢 {item.classCode}
                      {item.courseName ? ` — ${item.courseName}` : ""}
                    </option>
                  ))}
                  <option value="__FETCH_RUNNING__" className="bg-slate-950 text-emerald-300">
                    📥 Quét lại danh sách lớp đang học từ LMS...
                  </option>
                </select>
              ) : (
                <input
                  type="text"
                  value={classCode}
                  onChange={(e) => setClassCode(e.target.value.toUpperCase())}
                  className="bg-transparent text-sm font-bold text-slate-900 dark:text-white focus:outline-none w-36 uppercase"
                  placeholder="VD: VT-C4K-PTA12"
                />
              )}
              <button
                type="button"
                onClick={() => setIsManualClassInput((prev) => !prev)}
                title={
                  isManualClassInput
                    ? "Chuyển sang chọn từ danh sách lớp đang học"
                    : "Gõ mã lớp thủ công"
                }
                className="ml-2 text-xs text-slate-600 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 transition cursor-pointer"
              >
                {isManualClassInput ? "📋 Chọn lớp" : "✏️"}
              </button>
            </div>

            <button
              type="button"
              onClick={() => handleSyncFromLms()}
              disabled={isSyncing || isFetchingClasses}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:bg-slate-700 text-white text-sm font-semibold transition shadow-md cursor-pointer"
              title="Quét danh sách lớp đang học (nếu chưa có) và đồng bộ buổi học & học viên của lớp đang chọn từ LMS"
            >
              <RefreshCw
                className={`w-4 h-4 ${isSyncing || isFetchingClasses ? "animate-spin" : ""}`}
              />
              {isFetchingClasses
                ? "Đang quét lớp..."
                : isSyncing
                ? "Đang đồng bộ..."
                : "Đồng bộ lớp"}
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
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 px-1">
              <span>📌 Buổi 14 (Tổng kết cuối khóa &amp; SPCK) chấm riêng:</span>
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
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-slate-400 font-medium">
            Đang học: <strong className="text-white">{students.length}</strong> |
            Có mặt:{" "}
            <strong className="text-emerald-600 dark:text-emerald-400">
              {
                students.filter(
                  (s) => s.attendanceStatus === "PRESENT" || s.attendanceStatus === "LATE"
                ).length
              }
            </strong>{" "}
            | Chưa điểm danh:{" "}
            <strong className="text-amber-600 dark:text-amber-400">
              {
                students.filter(
                  (s) => !s.attendanceStatus || s.attendanceStatus === "UNKNOWN"
                ).length
              }
            </strong>{" "}
            | Đã duyệt:{" "}
            <strong className="text-indigo-600 dark:text-indigo-400">
              {students.filter((s) => s.status === "APPROVED" || s.status === "VERIFIED").length}
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
            onClick={handleGenerateAi}
            disabled={isGeneratingAi || students.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-semibold shadow-md transition cursor-pointer"
          >
            <Sparkles className={`w-4 h-4 ${isGeneratingAi ? "animate-spin" : ""}`} />
            {isGeneratingAi ? "AI Đang Soạn..." : "AI Soạn Nhận Xét"}
          </button>

          <button
            onClick={handleApproveAll}
            disabled={students.length === 0}
            className="mindx-dark-btn flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-950 hover:bg-indigo-900 text-white border border-indigo-800 text-sm font-semibold shadow-sm transition cursor-pointer"
          >
            <Check className="w-4 h-4" />
            Duyệt Tất Cả
          </button>

          <button
            onClick={() => handleSaveToLms()}
            disabled={isSavingLms || students.filter((s) => s.status === "APPROVED").length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold shadow-md transition cursor-pointer"
          >
            <Send className={`w-4 h-4 ${isSavingLms ? "animate-spin" : ""}`} />
            {isSavingLms
              ? `Đang Ghi LMS (Buổi ${activeSessionNumber})...`
              : `Đẩy Cả Lớp Vào LMS (Buổi ${activeSessionNumber})`}
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
                    <span className="text-[10px] font-normal normal-case opacity-80">
                      Chuẩn 3 mục: Điểm mạnh • Cần cải thiện • Lời khuyên
                    </span>
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
                          onChange={(e) => handleNoteChange(student.studentId, e.target.value)}
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
                                    handleTextEdit(student.studentId, "finalText", e.target.value)
                                  }
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

                        <div className="flex flex-col gap-1 items-end">
                          {student.status !== "APPROVED" && student.status !== "VERIFIED" ? (
                            <button
                              onClick={() => handleApprove(student.studentId)}
                              disabled={!student.finalText || student.status === "INSUFFICIENT_INFO"}
                              className="mindx-dark-btn px-3.5 py-1 rounded-md bg-indigo-950 hover:bg-indigo-900 disabled:opacity-40 text-white text-xs font-bold transition cursor-pointer"
                            >
                              Duyệt
                            </button>
                          ) : (
                            <button
                              onClick={() => handleSaveToLms(student.studentId)}
                              disabled={isSavingThis}
                              className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold transition flex items-center gap-1 cursor-pointer"
                            >
                              {isSavingThis ? (
                                <RefreshCw className="w-3 h-3 animate-spin" />
                              ) : (
                                <Send className="w-3 h-3" />
                              )}
                              Lưu thử vào LMS (Buổi {activeSessionNumber})
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
