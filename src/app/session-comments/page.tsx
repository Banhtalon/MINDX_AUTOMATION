"use client";

import React, { useState, useEffect, useRef, useTransition } from "react";
import {
  RefreshCw,
  Sparkles,
  CheckCircle,
  Copy,
  Send,
  AlertCircle,
  Clock,
  Check,
  ChevronDown,
  BookOpen,
  MessageSquare,
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
}

function classifyQuickTagTrack(tag: QuickTagItem): "common" | "coding" | "robotics" {
  const cat = String(tag.category || "").toLowerCase();
  const catName = String(tag.categoryName || "").toLowerCase();
  const id = String(tag.id || "").toLowerCase();
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
    cat.startsWith("exec_") ||
    id.startsWith("exec_") ||
    /lập trình|code|cú pháp|💻/i.test(catName)
  ) {
    return "coding";
  }
  return "common";
}

function detectTrackByClassCode(code: string): "coding" | "robotics" {
  return /rob/i.test(String(code || "")) ? "robotics" : "coding";
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

function resolveStudentSkillLevelLabel(tags?: string[]): {
  levelCode: 1 | 2 | 3 | 4 | 5 | 0;
  label: string;
  badgeClass: string;
} {
  if (!tags || tags.length === 0) {
    return {
      levelCode: 0,
      label: "Chưa chọn Tag cấp độ",
      badgeClass: "bg-slate-800 text-slate-400 border-slate-700",
    };
  }
  const joined = tags.join(" ").toLowerCase();
  const isDistracted = /mất tập trung|xao nhãng|nói chuyện riêng|làm việc riêng/.test(joined);
  const isExcellent = /xuất sắc|giỏi|sáng tạo|🌟/.test(joined);
  const isNeedSupport = /cần kèm|trung bình|chưa kịp|🛠️/.test(joined);
  const isGood = /đạt yêu cầu|khá|tốt|👍/.test(joined);

  if (isExcellent && !isDistracted) {
    return {
      levelCode: 1,
      label: "Cấp độ 1 - Giỏi",
      badgeClass: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    };
  }
  if (isExcellent && isDistracted) {
    return {
      levelCode: 3,
      label: "Cấp độ 3 - Khá nhưng mất tập trung",
      badgeClass: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    };
  }
  if (isNeedSupport && isDistracted) {
    return {
      levelCode: 5,
      label: "Cấp độ 5 - Trung bình, mất tập trung",
      badgeClass: "bg-rose-500/20 text-rose-300 border-rose-500/40",
    };
  }
  if (isNeedSupport) {
    return {
      levelCode: 4,
      label: "Cấp độ 4 - Trung bình",
      badgeClass: "bg-orange-500/20 text-orange-300 border-orange-500/40",
    };
  }
  if (isDistracted && !isGood) {
    return {
      levelCode: 5,
      label: "Cấp độ 5 - Trung bình, mất tập trung",
      badgeClass: "bg-rose-500/20 text-rose-300 border-rose-500/40",
    };
  }
  if (isDistracted) {
    return {
      levelCode: 3,
      label: "Cấp độ 3 - Khá nhưng mất tập trung",
      badgeClass: "bg-amber-500/20 text-amber-300 border-amber-500/40",
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
  sessions: SyllabusSession[];
}

interface RunningClassOption {
  classCode: string;
  courseName?: string;
  center?: string;
  status?: string;
}

function findLatestActiveSessionId(sessionList: SessionItem[]): string {
  if (!sessionList || sessionList.length === 0) return "";
  const now = new Date();
  now.setHours(23, 59, 59, 999);

  let latestByDate = "";
  for (const s of sessionList) {
    const rawDate = s.date || s.sessionDate || "";
    const m = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
      if (d.getTime() <= now.getTime()) {
        latestByDate = s.sessionId;
      }
    }
  }
  return latestByDate || sessionList[0].sessionId;
}

export default function SessionCommentsPage() {
  const [classCode, setClassCode] = useState("VT-C4K-GA38");
  const [classId, setClassId] = useState("VT-C4K-GA38");
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
  const [quickTagTrack, setQuickTagTrack] = useState<"coding" | "robotics" | "all">("coding");
  const [syllabusList, setSyllabusList] = useState<SyllabusCourse[]>([]);

  // Selected topic details
  const [currentTopic, setCurrentTopic] = useState("");
  const [currentKeyKnowledge, setCurrentKeyKnowledge] = useState<string[]>([]);
  const [currentHomeworkBrief, setCurrentHomeworkBrief] = useState("");

  // Zalo Broadcast
  const [zaloTemplateId, setZaloTemplateId] = useState("general_session_summary");
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
  const [runningClasses, setRunningClasses] = useState<RunningClassOption[]>([
    { classCode: "VT-C4K-GA38", status: "Running" },
  ]);
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [isSavingLms, setIsSavingLms] = useState(false);
  const [savingStudentId, setSavingStudentId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{
    type: "info" | "success" | "error";
    text: string;
  } | null>(null);

  const latestLoadRequestIdRef = useRef(0);
  const latestAiRequestIdRef = useRef(0);
  const activeClassIdRef = useRef("VT-C4K-GA38");
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

  // Reset manual Zalo edit flag and fetch initial data when class/session changes
  useEffect(() => {
    const normClass = classId.trim().toUpperCase();
    const normSess = selectedSessionId.trim();
    const classChanged = activeClassIdRef.current !== normClass;
    const scopeChanged =
      classChanged || activeSessionIdRef.current !== normSess;
    activeClassIdRef.current = normClass;
    activeSessionIdRef.current = normSess;
    if (classChanged) {
      setQuickTagTrack(detectTrackByClassCode(normClass));
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
    if (!normalizedClassId) return;
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
          json.data.classId &&
          String(json.data.classId).trim().toUpperCase() !== normalizedClassId
        ) {
          return;
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

        let effectiveSessionId = normalizedSessionId;
        if (json.data.sessions && json.data.sessions.length > 0) {
          const sessionList: SessionItem[] = json.data.sessions;
          setSessions(sessionList);

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
              (!st.classId || String(st.classId).trim().toUpperCase() === normalizedClassId)
          );
          const feedbacks = json.data.feedbacks || [];
          const feedbackMap = new Map<string, any>(feedbacks.map((f: any) => [f.studentId, f]));

          const nextServerMeta: Record<
            string,
            { rowVer: number; fields: Record<string, { ver: number; cid: string; rev: number }> }
          > = {};

          const merged: StudentItem[] = activeRawStudents.map((st: any) => {
            const fb = feedbackMap.get(st.studentId);
            if (fb?.versionMetaJson) {
              try {
                const parsed = JSON.parse(fb.versionMetaJson);
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
            return {
              ...st,
              classId: normalizedClassId,
              sessionId: effectiveSessionId,
              isActive: true,
              attendanceStatus: fb?.attendanceStatus || "UNKNOWN",
              quickTags: tags,
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

          loadedScopeKeyRef.current = `${normalizedClassId}::${effectiveSessionId}`;
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
  const handleFetchRunningClasses = async () => {
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
          text: `Đã lấy thành công ${fetched.length} lớp đang học (Running) từ LMS vào ô Mã lớp! Chỉ cần chọn lớp trong danh sách.`,
        });
      } else {
        setStatusMessage({
          type: "error",
          text: `Không lấy được danh sách lớp đang học: ${
            data.error || "Chưa tìm thấy lớp nào có trạng thái Running trên LMS."
          }`,
        });
      }
    } catch (err: any) {
      setStatusMessage({
        type: "error",
        text: `Lỗi kết nối khi lấy danh sách lớp: ${err.message}`,
      });
    } finally {
      setIsFetchingClasses(false);
    }
  };

  const handleSelectRunningClass = async (rawCode: string) => {
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

  // Sync class from LMS via Playwright
  const handleSyncFromLms = async (overrideClassCode?: string) => {
    const rawTarget = typeof overrideClassCode === "string" ? overrideClassCode : classCode;
    const normalizedCode = rawTarget.trim().toUpperCase();
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
    saveDraftToServer(studentId, { teacherNote: note, status: nextDraftStatus }, preEditSnapshot);
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
      { attendanceStatus: nextAttStatus, status: nextDraftStatus },
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

  const handleConfirmAllPresent = async () => {
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

    const initialAttendanceVersions = new Map<string, number>(
      activeStudents.map((s) => [s.studentId, studentAttendanceVersionRef.current[s.studentId] || 0])
    );

    let successCount = 0;
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
      const expectedVersion = editSequenceRef.current + 1;
      const ok = await saveDraftToServer(s.studentId, {
        attendanceStatus: "PRESENT",
        status: "DRAFT",
      });
      if (ok) {
        successCount++;
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
        text: `Đã xác nhận điểm danh 'Có mặt' cho toàn bộ ${successCount} học viên đang học.`,
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
              return {
                ...s,
                attendanceStatus: fb.attendanceStatus || "UNKNOWN",
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
            text: `Đã lưu & đối chiếu (Buổi ${activeSessionNumber}): ${batchRes.verifiedCount}/${batchRes.totalCandidates} học viên đạt VERIFIED!`,
          });
        } else {
          const firstError =
            batchRes.results?.find((r: any) => r.error)?.error ||
            "Không tìm thấy nhận xét đã duyệt hoặc lỗi đối chiếu trên LMS";
          setStatusMessage({
            type: "error",
            text: `Lưu LMS (Buổi ${activeSessionNumber}) không đạt (${batchRes.verifiedCount}/${batchRes.totalCandidates} VERIFIED): ${firstError}`,
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
      {/* 1. Header & Class Selector */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <span className="p-2 rounded-xl bg-blue-500/10 text-blue-400 text-2xl">📝</span>
              <div>
                <h1 className="text-xl font-bold text-white tracking-wide">
                  Nhận xét Buổi học & Thông báo Zalo (Giai đoạn 3)
                </h1>
                <p className="text-xs text-slate-400">
                  Lọc danh sách học viên theo ID • Quick Tags 1 chạm • AI 3 phần không bịa • Đối chiếu VERIFIED
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center bg-slate-800 rounded-lg px-3 py-1.5 border border-slate-700">
              <span className="text-xs font-semibold text-slate-400 mr-2">Mã lớp:</span>
              {!isManualClassInput && runningClasses.length > 0 ? (
                <select
                  value={classCode}
                  onChange={(e) => {
                    handleSelectRunningClass(e.target.value);
                  }}
                  className="bg-slate-800 text-sm font-bold text-white focus:outline-none min-w-[180px] max-w-[300px] cursor-pointer"
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
                </select>
              ) : (
                <input
                  type="text"
                  value={classCode}
                  onChange={(e) => setClassCode(e.target.value.toUpperCase())}
                  className="bg-transparent text-sm font-bold text-white focus:outline-none w-36 uppercase"
                  placeholder="VD: VT-C4K-GA38"
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
                className="ml-2 text-xs text-slate-400 hover:text-white px-1.5 py-0.5 rounded bg-slate-700/60 hover:bg-slate-700 transition cursor-pointer"
              >
                {isManualClassInput ? "📋 Chọn lớp" : "✏️"}
              </button>
            </div>

            <button
              type="button"
              onClick={handleFetchRunningClasses}
              disabled={isFetchingClasses || isSyncing}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white text-sm font-medium transition shadow-md shadow-emerald-600/20 cursor-pointer"
              title="Tự động vào LMS quét toàn bộ các lớp đang học (Status: Running) đưa vào ô Mã lớp"
            >
              <RefreshCw className={`w-4 h-4 ${isFetchingClasses ? "animate-spin" : ""}`} />
              {isFetchingClasses ? "Đang lấy danh sách lớp..." : "📥 Lấy lớp đang học"}
            </button>

            <button
              type="button"
              onClick={() => handleSyncFromLms()}
              disabled={isSyncing || isFetchingClasses}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white text-sm font-medium transition shadow-md shadow-blue-600/20 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? "animate-spin" : ""}`} />
              {isSyncing ? "Đang đồng bộ..." : "Đồng bộ từ LMS"}
            </button>
          </div>
        </div>

        {/* Status notification toast */}
        {statusMessage && (
          <div
            className={`mt-4 p-3 rounded-lg flex items-center justify-between text-sm ${
              statusMessage.type === "success"
                ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                : statusMessage.type === "error"
                ? "bg-rose-500/10 border border-rose-500/20 text-rose-400"
                : "bg-blue-500/10 border border-blue-500/20 text-blue-400"
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

        {/* 2. Session & Syllabus Selection */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6 pt-6 border-t border-slate-800">
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              Chọn Buổi học
            </label>
            <select
              value={selectedSessionId}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              {sessions.length > 0 ? (
                sessions.map((s) => {
                  const dStr = s.date || s.sessionDate;
                  return (
                    <option key={s.sessionId} value={s.sessionId}>
                      Buổi {s.sessionNumber}{dStr ? ` (${dStr})` : ""}: {s.topic.slice(0, 35)}
                    </option>
                  );
                })
              ) : (
                <option value="">(Chưa đồng bộ buổi học từ LMS)</option>
              )}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              Chủ đề & Kiến thức trọng tâm (Từ Giáo trình)
            </label>
            <input
              type="text"
              value={currentTopic}
              onChange={(e) => setCurrentTopic(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              placeholder="Chủ đề buổi học hôm nay..."
            />
            {currentKeyKnowledge.length > 0 && (
              <div className="mt-2 p-2.5 rounded-lg bg-slate-800/60 border border-slate-700/70 text-xs text-slate-300 space-y-1">
                <div className="font-semibold text-blue-400">Nội dung buổi học:</div>
                <ul className="list-disc list-inside space-y-0.5">
                  {currentKeyKnowledge.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
                {currentHomeworkBrief && (
                  <div className="pt-1 text-slate-400">
                    <span className="font-semibold text-amber-400">Tóm tắt BTVN:</span>{" "}
                    {currentHomeworkBrief}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-slate-900 border border-slate-800">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-slate-400 font-medium">
            Đang học: <strong className="text-white">{students.length}</strong> học viên |
            Có mặt:{" "}
            <strong className="text-emerald-400">
              {
                students.filter(
                  (s) => s.attendanceStatus === "PRESENT" || s.attendanceStatus === "LATE"
                ).length
              }
            </strong>{" "}
            | Chưa điểm danh:{" "}
            <strong className="text-amber-400">
              {
                students.filter(
                  (s) => !s.attendanceStatus || s.attendanceStatus === "UNKNOWN"
                ).length
              }
            </strong>{" "}
            | Đã duyệt:{" "}
            <strong className="text-indigo-400">
              {students.filter((s) => s.status === "APPROVED" || s.status === "VERIFIED").length}
            </strong>
          </span>

          {/* Quick Tag Track Switcher (Lập trình vs Robotics) */}
          <div className="flex items-center gap-1 bg-slate-950/90 border border-slate-800 rounded-lg p-1">
            <span className="text-[11px] font-semibold text-slate-400 px-2">
              Bộ Quick Tags:
            </span>
            <button
              type="button"
              onClick={() => setQuickTagTrack("coding")}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                quickTagTrack === "coding"
                  ? "bg-cyan-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
              title="Hiển thị nhóm Chung + nhóm Kỹ năng Thao tác & Lập trình"
            >
              💻 Lập trình
            </button>
            <button
              type="button"
              onClick={() => setQuickTagTrack("robotics")}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                quickTagTrack === "robotics"
                  ? "bg-orange-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
              title="Hiển thị nhóm Chung + nhóm Kỹ năng Lắp ráp & Robotics"
            >
              🤖 Robotics
            </button>
            <button
              type="button"
              onClick={() => setQuickTagTrack("all")}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                quickTagTrack === "all"
                  ? "bg-purple-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
              title="Hiển thị toàn bộ thẻ của cả 2 hướng"
            >
              📋 Tất cả
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleConfirmAllPresent}
            disabled={students.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-emerald-500/30 text-xs font-semibold transition cursor-pointer"
          >
            <UserCheck className="w-4 h-4" />
            Xác nhận cả lớp Có mặt
          </button>

          <button
            type="button"
            onClick={async () => {
              const presentStudents = studentsRef.current.filter(
                (s) =>
                  s.isActive !== false &&
                  (s.attendanceStatus === "PRESENT" || s.attendanceStatus === "LATE") &&
                  !(s.quickTags || []).some((t) => isQuickTagLevel(t, quickTags))
              );
              if (presentStudents.length === 0) {
                setStatusMessage({
                  type: "info",
                  text: "Tất cả học viên có mặt đã có thẻ Mức đánh giá (hoặc chưa điểm danh Có mặt).",
                });
                return;
              }
              let count = 0;
              for (const s of presentStudents) {
                await toggleQuickTag(s.studentId, "👍 Đạt yêu cầu");
                count++;
              }
              setStatusMessage({
                type: "success",
                text: `Đã gắn nhanh mức "👍 Đạt yêu cầu" cho ${count} học viên có mặt! Bạn chỉ cần chỉnh lại vài bạn nổi bật hoặc cần kèm thêm.`,
              });
            }}
            disabled={students.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30 text-xs font-semibold transition cursor-pointer"
            title="Gắn nhanh mức '👍 Đạt yêu cầu' cho tất cả học viên có mặt chưa chọn mức, giúp tiết kiệm 80% thao tác"
          >
            <span>👍 Mặc định &ldquo;Đạt yêu cầu&rdquo; cả lớp</span>
          </button>

          <button
            onClick={handleGenerateAi}
            disabled={isGeneratingAi || students.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white text-sm font-semibold shadow-lg shadow-purple-600/20 transition"
          >
            <Sparkles className={`w-4 h-4 ${isGeneratingAi ? "animate-spin" : ""}`} />
            {isGeneratingAi ? "AI Đang Soạn..." : "AI Soạn Nhận Xét Hàng Loạt"}
          </button>

          <button
            onClick={handleApproveAll}
            disabled={students.length === 0}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-750 text-indigo-400 border border-indigo-500/30 text-sm font-medium transition"
          >
            <Check className="w-4 h-4" />
            Duyệt Tất Cả Bản Nháp
          </button>

          <button
            onClick={() => handleSaveToLms()}
            disabled={isSavingLms || students.filter((s) => s.status === "APPROVED").length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold shadow-lg shadow-emerald-600/20 transition"
          >
            <Send className={`w-4 h-4 ${isSavingLms ? "animate-spin" : ""}`} />
            {isSavingLms ? `Đang Ghi LMS (Buổi ${activeSessionNumber})...` : `Đẩy Cả Lớp Vào LMS (Buổi ${activeSessionNumber})`}
          </button>
        </div>
      </div>

      {/* 4. Student Comments Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950 text-xs uppercase font-semibold text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-4 py-3.5 w-12 text-center">STT</th>
                <th className="px-4 py-3.5 w-48">Học viên & Điểm danh</th>
                <th className="px-4 py-3.5 w-80">
                  <div className="flex items-center justify-between gap-1">
                    <span>Quick Tags 1-Chạm</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-bold normal-case ${
                        quickTagTrack === "robotics"
                          ? "bg-orange-500/20 text-orange-300 border border-orange-500/30"
                          : quickTagTrack === "coding"
                          ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                          : "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                      }`}
                    >
                      {quickTagTrack === "robotics"
                        ? "🤖 Hướng Robot"
                        : quickTagTrack === "coding"
                        ? "💻 Hướng Lập trình"
                        : "📋 Cả 2 hướng"}
                    </span>
                  </div>
                </th>
                <th className="px-4 py-3.5 w-52">Ghi chú riêng của GV</th>
                <th className="px-4 py-3.5 min-w-[320px]">Nhận xét 3 phần (Sửa trực tiếp)</th>
                <th className="px-4 py-3.5 w-44 text-right">Trạng thái & Lưu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {students.length > 0 ? (
                students.map((student, idx) => {
                  const attStatus = student.attendanceStatus || "UNKNOWN";
                  const isPresent = attStatus === "PRESENT" || attStatus === "LATE";
                  const isAbsent = attStatus === "ABSENT";
                  const isSavingThis = savingStudentId === student.studentId;

                  return (
                    <tr
                      key={student.studentId}
                      className={`hover:bg-slate-850/60 transition ${
                        student.status === "VERIFIED"
                          ? "bg-emerald-950/10"
                          : student.status === "APPROVED"
                          ? "bg-indigo-950/10"
                          : ""
                      }`}
                    >
                      {/* STT */}
                      <td className="px-4 py-4 text-center font-mono text-xs text-slate-500">
                        {String(idx + 1).padStart(2, "0")}
                      </td>

                      {/* Name & Attendance */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white">{student.fullName}</span>
                          {!student.isActive && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
                              Nghỉ/Bảo lưu
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-mono text-slate-400 mt-0.5">
                          {student.studentId}
                        </div>
                        <div className="mt-2 flex items-center gap-1.5">
                          <button
                            onClick={() => handleAttendanceChange(student.studentId)}
                            className={`px-2 py-0.5 rounded text-[11px] font-semibold transition ${
                              isPresent
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                : isAbsent
                                ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                                : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                            }`}
                          >
                            {isPresent
                              ? "✓ Có mặt"
                              : isAbsent
                              ? "✕ Nghỉ học"
                              : "? Chưa điểm danh"}
                          </button>
                        </div>
                      </td>

                      {/* Quick Tags */}
                      <td className="px-4 py-4">
                        {(() => {
                          // Filter tags by selected track (coding vs robotics), deduplicating identical labels across tracks
                          const rawVisible = quickTags.filter((tag) => {
                            if (quickTagTrack === "all") return true;
                            const tagTrack = classifyQuickTagTrack(tag);
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
                          // Ensure any already-selected tag on this student remains visible
                          for (const selLabel of student.quickTags || []) {
                            if (!seenLabels.has(selLabel)) {
                              const found = quickTags.find((q) => q.label === selLabel);
                              seenLabels.add(selLabel);
                              visibleTags.push(
                                found || { id: `sel_${selLabel}`, label: selLabel, sentiment: "neutral" }
                              );
                            }
                          }

                          const levelTags = visibleTags.filter((tag) =>
                            isQuickTagLevel(tag, quickTags)
                          );
                          const modifierTags = visibleTags.filter(
                            (tag) => !isQuickTagLevel(tag, quickTags)
                          );

                          const renderTagButton = (
                            tag: QuickTagItem,
                            tagIdx: number,
                            isLevelBtn: boolean
                          ) => {
                            const isSelected = student.quickTags?.includes(tag.label);
                            const isConstructive = tag.sentiment === "constructive";

                            let unselectedClass = isLevelBtn
                              ? "bg-slate-900 text-slate-200 border-slate-700 hover:border-blue-400 font-medium"
                              : "bg-slate-800/80 text-slate-400 border-slate-700/80 hover:border-slate-500 hover:text-slate-200";

                            const selectedClass = isConstructive
                              ? "bg-amber-600/35 text-amber-200 border-amber-400 font-bold shadow-sm"
                              : isLevelBtn
                              ? "bg-emerald-600/35 text-emerald-200 border-emerald-400 font-bold shadow-sm ring-1 ring-emerald-500/40"
                              : "bg-blue-600/35 text-blue-200 border-blue-400 font-semibold shadow-sm";

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
                          };

                          if (levelTags.length === 0) {
                            return (
                              <div className="flex flex-wrap gap-1.5">
                                {visibleTags.map((tag, tagIdx) =>
                                  renderTagButton(tag, tagIdx, false)
                                )}
                              </div>
                            );
                          }

                          return (
                            <div className="space-y-2">
                              <div>
                                <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/90 mb-1">
                                  1. Chọn 1 mức tổng quát:
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {levelTags.map((tag, tagIdx) =>
                                    renderTagButton(tag, tagIdx, true)
                                  )}
                                </div>
                              </div>

                              {modifierTags.length > 0 && (
                                <div className="pt-1.5 border-t border-slate-800/80">
                                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                                    2. Cộng thêm điểm nhấn / lưu ý (nếu có):
                                  </div>
                                  <div className="flex flex-wrap gap-1.5">
                                    {modifierTags.map((tag, tagIdx) =>
                                      renderTagButton(tag, tagIdx + 100, false)
                                    )}
                                  </div>
                                </div>
                              )}
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
                          placeholder="Ghi chú nhanh cho học sinh..."
                          className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-blue-500 resize-none"
                        />
                      </td>

                      {/* Unified 3-Part Comment Editor (1 Box per skill nhan-xet-hoc-sinh) */}
                      <td className="px-4 py-4 space-y-2">
                        {(() => {
                          const levelInfo = resolveStudentSkillLevelLabel(student.quickTags);
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
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${levelInfo.badgeClass}`}
                                  title="Tự động phân loại vào 1 trong 5 cấp độ chuẩn của skill nhan-xet-hoc-sinh dựa trên Quick Tags đã tích chọn"
                                >
                                  🎯 {levelInfo.label}
                                </span>
                                <span className="text-[10px] text-slate-500">
                                  Chuẩn 3 mục: Điểm mạnh • Cần cải thiện • Lời khuyên
                                </span>
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
                                  rows={7}
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

                      {/* Status & Actions */}
                      <td className="px-4 py-4 text-right space-y-2">
                        {/* Status Badge */}
                        <div>
                          {student.status === "VERIFIED" ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                              <ShieldCheck className="w-3.5 h-3.5" /> VERIFIED
                            </span>
                          ) : student.status === "APPROVED" ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                              <Check className="w-3.5 h-3.5" /> Đã duyệt
                            </span>
                          ) : student.status === "SAVING" ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-300 animate-pulse">
                              Đang lưu...
                            </span>
                          ) : student.status === "FAILED" ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                              Thất bại
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700">
                              Bản nháp
                            </span>
                          )}
                        </div>

                        {/* Action buttons */}
                        <div className="flex flex-col gap-1 items-end">
                          {student.status !== "APPROVED" && student.status !== "VERIFIED" ? (
                            <button
                              onClick={() => handleApprove(student.studentId)}
                              disabled={!student.finalText || student.status === "INSUFFICIENT_INFO"}
                              className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold transition"
                            >
                              Duyệt (Khóa Hash)
                            </button>
                          ) : (
                              <button
                                onClick={() => handleSaveToLms(student.studentId)}
                                disabled={isSavingThis}
                                className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold transition flex items-center gap-1"
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
                            className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition"
                          >
                            {copiedStudentId === student.studentId ? (
                              <Check className="w-3 h-3 text-emerald-400" />
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
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    Chưa có dữ liệu học viên. Vui lòng bấm <strong>"Đồng bộ từ LMS"</strong> ở trên.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. Zalo Broadcast Preview Box */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 text-xl">📱</span>
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
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 disabled:opacity-50 text-amber-300 border border-amber-500/30 text-xs font-semibold transition cursor-pointer"
              title="Tải ảnh chụp danh sách nộp BTVN (Denise/LMS) để AI lọc các bạn 'Not submitted' (Tên đệm + Tên) và tự động nối Phần 2 vào cuối tin nhắn Zalo"
            >
              {isAnalyzingBtvnImage ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <span>📸</span>
              )}
              {isAnalyzingBtvnImage
                ? "Đang đọc ảnh BTVN..."
                : "Tải ảnh BTVN (Thêm Phần 2)"}
            </button>

            {zaloBtvnPart2Text && (
              <button
                type="button"
                onClick={() => {
                  setZaloBtvnPart2Text("");
                  setIsZaloManuallyEdited(false);
                  setZaloBroadcastText(buildAutoZaloBroadcastText(""));
                }}
                className="px-2.5 py-2 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs font-medium transition cursor-pointer"
                title="Xóa Phần 2 (nhắc nhở BTVN) khỏi tin nhắn Zalo"
              >
                ✕ Bỏ Phần 2 BTVN
              </button>
            )}

            {isZaloManuallyEdited && (
              <button
                onClick={() => {
                  setIsZaloManuallyEdited(false);
                  setZaloBroadcastText(buildAutoZaloBroadcastText());
                }}
                className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-medium transition"
              >
                Khôi phục mẫu tự động
              </button>
            )}
            <button
              onClick={() => copyToClipboard(zaloBroadcastText)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition shadow-md shadow-emerald-600/20"
            >
              {copiedZalo ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copiedZalo ? "Đã sao chép tin nhắn Zalo!" : "Copy Thông báo Zalo"}
            </button>
          </div>
        </div>

        <div className="relative">
          <textarea
            rows={16}
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
