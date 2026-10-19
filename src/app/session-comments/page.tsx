"use client";

import React, { useState, useEffect, useTransition } from "react";
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
  sessionDate?: string;
}

interface StudentItem {
  studentId: string;
  classId: string;
  fullName: string;
  isActive: boolean;
  attendanceStatus?: "PRESENT" | "ABSENT" | "LATE";
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

export default function SessionCommentsPage() {
  const [classCode, setClassCode] = useState("VT-C4K-GI34");
  const [classId, setClassId] = useState("VT-C4K-GI34");
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [quickTags, setQuickTags] = useState<QuickTagItem[]>([]);
  const [syllabusList, setSyllabusList] = useState<SyllabusCourse[]>([]);

  // Selected topic details
  const [currentTopic, setCurrentTopic] = useState("");
  const [currentKeyKnowledge, setCurrentKeyKnowledge] = useState<string[]>([]);
  const [currentHomeworkBrief, setCurrentHomeworkBrief] = useState("");

  // Zalo Broadcast
  const [zaloTemplateId, setZaloTemplateId] = useState("general_session_summary");
  const [zaloBroadcastText, setZaloBroadcastText] = useState("");
  const [copiedZalo, setCopiedZalo] = useState(false);
  const [copiedStudentId, setCopiedStudentId] = useState<string | null>(null);

  // Status & loading states
  const [isSyncing, setIsSyncing] = useState(false);
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [isSavingLms, setIsSavingLms] = useState(false);
  const [savingStudentId, setSavingStudentId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{
    type: "info" | "success" | "error";
    text: string;
  } | null>(null);

  // Fetch initial data or list when class/session changes
  useEffect(() => {
    loadClassData(classId, selectedSessionId);
  }, [classId, selectedSessionId]);

  const loadClassData = async (targetClassId: string, targetSessionId: string) => {
    try {
      const res = await fetch(
        `/api/session-comments/list?classId=${encodeURIComponent(targetClassId)}&sessionId=${encodeURIComponent(targetSessionId)}`
      );
      const json = await res.json();
      if (json.success && json.data) {
        if (json.data.quickTags) setQuickTags(json.data.quickTags);
        if (json.data.syllabusList) setSyllabusList(json.data.syllabusList);

        if (json.data.sessions && json.data.sessions.length > 0) {
          setSessions(json.data.sessions);
          if (!targetSessionId) {
            setSelectedSessionId(json.data.sessions[0].sessionId);
          }
        }

        if (json.data.students) {
          // Merge with existing feedbacks in SQLite
          const feedbacks = json.data.feedbacks || [];
          const feedbackMap = new Map<string, any>(feedbacks.map((f: any) => [f.studentId, f]));

          const merged: StudentItem[] = json.data.students.map((st: any) => {
            const fb = feedbackMap.get(st.studentId);
            let tags: string[] = [];
            if (fb?.quickTagsJson) {
              try {
                tags = JSON.parse(fb.quickTagsJson);
              } catch {}
            }
            return {
              ...st,
              attendanceStatus: fb?.attendanceStatus || "PRESENT",
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

          setStudents(merged);
        }
      }
    } catch (err) {
      console.error("Lỗi tải dữ liệu:", err);
    }
  };

  // Sync class from LMS via Playwright
  const handleSyncFromLms = async () => {
    if (!classCode.trim()) return;
    setIsSyncing(true);
    setStatusMessage({ type: "info", text: `Đang kết nối tới LMS để đồng bộ lớp ${classCode}...` });

    try {
      const res = await fetch("/api/session-comments/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classCode: classCode.trim() }),
      });
      const data = await res.json();

      if (data.success) {
        setClassId(data.classId || classCode);
        setStatusMessage({
          type: "success",
          text: `Đồng bộ thành công! Tìm thấy ${data.sessionsCount} buổi học và ${data.studentsCount} học viên.`,
        });
        await loadClassData(data.classId || classCode, selectedSessionId);
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

    // Match by prefix (e.g. GI from VT-C4K-GI34)
    const upperCode = classCode.toUpperCase();
    let matchedCourse = syllabusList.find((c) => upperCode.includes(c.courseCode));
    if (!matchedCourse && syllabusList.length > 0) {
      matchedCourse = syllabusList[0];
    }

    if (matchedCourse) {
      const lesson = matchedCourse.sessions.find((s) => s.sessionNumber === sessionNum);
      if (lesson) {
        setCurrentTopic(lesson.topic);
        setCurrentKeyKnowledge(lesson.keyKnowledge);
        setCurrentHomeworkBrief(lesson.homeworkBrief);
      } else {
        setCurrentTopic(sess?.topic || `Buổi ${sessionNum}`);
      }
    } else {
      setCurrentTopic(sess?.topic || `Buổi ${sessionNum}`);
    }
  }, [selectedSessionId, sessions, classCode, syllabusList]);

  // Update Zalo broadcast template preview
  useEffect(() => {
    const sess = sessions.find((s) => s.sessionId === selectedSessionId);
    const sessionNum = sess?.sessionNumber || 1;

    const keyPoints =
      currentKeyKnowledge.length > 0
        ? currentKeyKnowledge.map((k) => `• ${k}`).join("\n")
        : `• ${currentTopic}`;

    const text = `📢 [THÔNG BÁO TỔNG KẾT BUỔI HỌC - ${classCode}]
Chào quý Phụ huynh và các em học sinh lớp ${classCode},

Thầy/Cô xin gửi thông tin tóm tắt Buổi ${sessionNum}:
🎯 Chủ đề bài học: ${currentTopic}
📚 Kiến thức trọng tâm:
${keyPoints}

📝 Dặn dò bài tập về nhà:
${currentHomeworkBrief || "Hoàn thành bài tập trên LMS trước buổi học tiếp theo."}

Quý Phụ huynh vui lòng xem nhận xét chi tiết của từng học sinh đã được cập nhật trên MindX LMS.
Cảm ơn quý Phụ huynh đã luôn đồng hành cùng các con!`;

    setZaloBroadcastText(text);
  }, [classCode, selectedSessionId, sessions, currentTopic, currentKeyKnowledge, currentHomeworkBrief]);

  // Handle Quick Tag Toggle
  const toggleQuickTag = async (studentId: string, tagLabel: string) => {
    setStudents((prev) =>
      prev.map((s) => {
        if (s.studentId !== studentId) return s;
        const tags = s.quickTags || [];
        const newTags = tags.includes(tagLabel)
          ? tags.filter((t) => t !== tagLabel)
          : [...tags, tagLabel];

        // Save draft to server
        saveDraftToServer(s.studentId, { quickTags: newTags });
        return { ...s, quickTags: newTags };
      })
    );
  };

  // Handle Note Change with instant auto-save
  const handleNoteChange = (studentId: string, note: string) => {
    setStudents((prev) =>
      prev.map((s) => {
        if (s.studentId !== studentId) return s;
        return { ...s, teacherNote: note };
      })
    );
    saveDraftToServer(studentId, { teacherNote: note });
  };

  // Handle text edit
  const handleTextEdit = (
    studentId: string,
    field: "strengths" | "improvements" | "actionPlan" | "finalText",
    value: string
  ) => {
    setStudents((prev) =>
      prev.map((s) => {
        if (s.studentId !== studentId) return s;
        const updated = { ...s, [field]: value };
        if (field !== "finalText") {
          updated.finalText = `Em ${s.fullName} ${updated.strengths || ""} ${updated.improvements || ""} ${updated.actionPlan || ""}`.trim();
        }
        // Iron Rule 4: If previously approved, editing will demote to DRAFT
        if (s.status === "APPROVED" || s.status === "VERIFIED") {
          updated.status = "DRAFT";
        }
        saveDraftToServer(studentId, updated);
        return updated;
      })
    );
  };

  const saveDraftToServer = async (targetStudentId: string, patch: Partial<StudentItem>) => {
    const student = students.find((s) => s.studentId === targetStudentId);
    if (!student) return;

    try {
      await fetch("/api/session-comments/save-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId,
          sessionId: selectedSessionId,
          studentId: targetStudentId,
          attendanceStatus: patch.attendanceStatus || student.attendanceStatus || "PRESENT",
          quickTags: patch.quickTags !== undefined ? patch.quickTags : student.quickTags,
          teacherNote: patch.teacherNote !== undefined ? patch.teacherNote : student.teacherNote,
          strengths: patch.strengths !== undefined ? patch.strengths : student.strengths,
          improvements: patch.improvements !== undefined ? patch.improvements : student.improvements,
          actionPlan: patch.actionPlan !== undefined ? patch.actionPlan : student.actionPlan,
          finalText: patch.finalText !== undefined ? patch.finalText : student.finalText,
          status: patch.status || student.status || "DRAFT",
        }),
      });
    } catch (err) {
      console.error("Lỗi lưu nháp:", err);
    }
  };

  // AI Generate Batch Comments
  const handleGenerateAi = async () => {
    setIsGeneratingAi(true);
    setStatusMessage({
      type: "info",
      text: "Đang gọi Gemini 3.5 Flash Lite soạn nhận xét 3 phần (đã ẩn danh học viên)...",
    });

    const sess = sessions.find((s) => s.sessionId === selectedSessionId);
    const sessionNumber = sess?.sessionNumber || 1;

    try {
      const res = await fetch("/api/session-comments/generate-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session: {
            classId,
            classCode,
            sessionId: selectedSessionId,
            sessionNumber,
            topic: currentTopic,
            keyKnowledge: currentKeyKnowledge,
          },
          students: students.map((s) => ({
            studentId: s.studentId,
            fullName: s.fullName,
            attendanceStatus: s.attendanceStatus || "PRESENT",
            quickTags: s.quickTags || [],
            teacherNote: s.teacherNote || "",
          })),
        }),
      });

      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        const resultMap = new Map(data.data.map((r: any) => [r.studentId, r]));

        setStudents((prev) =>
          prev.map((s) => {
            const resItem = resultMap.get(s.studentId) as any;
            if (!resItem) return s;
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

        const draftedCount = data.data.filter((r: any) => r.status === "DRAFT").length;
        const insufficientCount = data.data.filter((r: any) => r.status === "INSUFFICIENT_INFO").length;

        setStatusMessage({
          type: "success",
          text: `Đã soạn xong nhận xét cho ${draftedCount} học sinh. (${insufficientCount} học sinh chưa có tags/ghi chú -> giữ Chưa đủ thông tin).`,
        });
      } else {
        setStatusMessage({
          type: "error",
          text: `Lỗi AI Generator: ${data.error || "Không thể sinh nhận xét"}`,
        });
      }
    } catch (err: any) {
      setStatusMessage({ type: "error", text: `Lỗi gọi API: ${err.message}` });
    } finally {
      setIsGeneratingAi(false);
    }
  };

  // Approve a single comment
  const handleApprove = async (studentId: string) => {
    const student = students.find((s) => s.studentId === studentId);
    if (!student || !student.finalText) return;

    try {
      const res = await fetch("/api/session-comments/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId,
          sessionId: selectedSessionId,
          studentId,
          approvedText: student.finalText,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setStudents((prev) =>
          prev.map((s) =>
            s.studentId === studentId
              ? { ...s, status: "APPROVED", contentHash: data.contentHash }
              : s
          )
        );
      }
    } catch (err) {
      console.error("Lỗi duyệt nhận xét:", err);
    }
  };

  // Approve all valid drafts
  const handleApproveAll = async () => {
    for (const s of students) {
      if (s.status === "DRAFT" && s.finalText && s.finalText.trim().length > 0) {
        await handleApprove(s.studentId);
      }
    }
    setStatusMessage({
      type: "success",
      text: "Đã duyệt và băm mã SHA-256 cho toàn bộ nhận xét hợp lệ!",
    });
  };

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
        ? `Đang lưu thử 1 học sinh lên LMS và đối chiếu Read-after-Write...`
        : `Đang đẩy toàn bộ nhận xét đã duyệt lên LMS và đối chiếu Read-after-Write...`,
    });

    try {
      const res = await fetch("/api/session-comments/save-lms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId,
          classCode,
          sessionId: selectedSessionId,
          studentId: targetStudentId,
        }),
      });
      const data = await res.json();

      if (data.success && data.data) {
        const batchRes = data.data;
        setStatusMessage({
          type: "success",
          text: `Đã lưu & đối chiếu: ${batchRes.verifiedCount}/${batchRes.totalCandidates} học viên đạt VERIFIED!`,
        });
        await loadClassData(classId, selectedSessionId);
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
    navigator.clipboard.writeText(text);
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

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center bg-slate-800 rounded-lg px-3 py-1.5 border border-slate-700">
              <span className="text-xs font-semibold text-slate-400 mr-2">Mã lớp:</span>
              <input
                type="text"
                value={classCode}
                onChange={(e) => setClassCode(e.target.value)}
                className="bg-transparent text-sm font-bold text-white focus:outline-none w-36 uppercase"
                placeholder="VD: VT-C4K-GI34"
              />
            </div>

            <button
              onClick={handleSyncFromLms}
              disabled={isSyncing}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white text-sm font-medium transition shadow-md shadow-blue-600/20"
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
                sessions.map((s) => (
                  <option key={s.sessionId} value={s.sessionId}>
                    Buổi {s.sessionNumber}: {s.topic.slice(0, 35)}
                  </option>
                ))
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
          </div>
        </div>
      </div>

      {/* 3. Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-slate-900 border border-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 font-medium">
            Tổng số: <strong className="text-white">{students.length}</strong> học viên |
            Có mặt:{" "}
            <strong className="text-emerald-400">
              {students.filter((s) => s.attendanceStatus !== "ABSENT").length}
            </strong>{" "}
            | Đã duyệt:{" "}
            <strong className="text-indigo-400">
              {students.filter((s) => s.status === "APPROVED" || s.status === "VERIFIED").length}
            </strong>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
            {isSavingLms ? "Đang Ghi LMS..." : "Đẩy Cả Lớp Vào LMS (Read-after-Write)"}
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
                <th className="px-4 py-3.5 w-72">Quick Tags 1-Chạm</th>
                <th className="px-4 py-3.5 w-52">Ghi chú riêng của GV</th>
                <th className="px-4 py-3.5 min-w-[320px]">Nhận xét 3 phần (Sửa trực tiếp)</th>
                <th className="px-4 py-3.5 w-44 text-right">Trạng thái & Lưu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {students.length > 0 ? (
                students.map((student, idx) => {
                  const isPresent = student.attendanceStatus !== "ABSENT";
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
                            onClick={() => {
                              const newStatus = isPresent ? "ABSENT" : "PRESENT";
                              setStudents((prev) =>
                                prev.map((s) =>
                                  s.studentId === student.studentId
                                    ? { ...s, attendanceStatus: newStatus }
                                    : s
                                )
                              );
                              saveDraftToServer(student.studentId, {
                                attendanceStatus: newStatus,
                              });
                            }}
                            className={`px-2 py-0.5 rounded text-[11px] font-semibold transition ${
                              isPresent
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                            }`}
                          >
                            {isPresent ? "✓ Có mặt" : "✕ Nghỉ học"}
                          </button>
                        </div>
                      </td>

                      {/* Quick Tags */}
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-1.5">
                          {quickTags.map((tag, tagIdx) => {
                            const isSelected = student.quickTags?.includes(tag.label);
                            return (
                              <button
                                key={tag.id || `tag-${tagIdx}`}
                                onClick={() => toggleQuickTag(student.studentId, tag.label)}
                                className={`px-2 py-1 rounded text-xs transition border ${
                                  isSelected
                                    ? "bg-blue-600/30 text-blue-300 border-blue-500 font-semibold"
                                    : "bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-600"
                                }`}
                              >
                                {tag.label}
                              </button>
                            );
                          })}
                        </div>
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

                      {/* 3-Part Comment Editor */}
                      <td className="px-4 py-4 space-y-2">
                        {student.status === "INSUFFICIENT_INFO" ? (
                          <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            <span>Chưa đủ thông tin (Cần chọn Quick Tag hoặc nhập ghi chú).</span>
                          </div>
                        ) : (
                          <>
                            <div className="space-y-1">
                              <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">
                                Điểm mạnh:
                              </span>
                              <input
                                type="text"
                                value={student.strengths || ""}
                                onChange={(e) =>
                                  handleTextEdit(student.studentId, "strengths", e.target.value)
                                }
                                placeholder="Điểm mạnh trong buổi học..."
                                className="w-full bg-slate-800/80 border border-slate-700/80 rounded px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                              />
                            </div>

                            <div className="space-y-1">
                              <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">
                                Cần cải thiện:
                              </span>
                              <input
                                type="text"
                                value={student.improvements || ""}
                                onChange={(e) =>
                                  handleTextEdit(student.studentId, "improvements", e.target.value)
                                }
                                placeholder="Điểm cần cải thiện..."
                                className="w-full bg-slate-800/80 border border-slate-700/80 rounded px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                              />
                            </div>

                            <div className="space-y-1">
                              <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider">
                                Hướng rèn luyện:
                              </span>
                              <input
                                type="text"
                                value={student.actionPlan || ""}
                                onChange={(e) =>
                                  handleTextEdit(student.studentId, "actionPlan", e.target.value)
                                }
                                placeholder="Bài tập dặn dò thêm..."
                                className="w-full bg-slate-800/80 border border-slate-700/80 rounded px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                              />
                            </div>
                          </>
                        )}
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
                              Lưu thử vào LMS
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 text-xl">📱</span>
            <div>
              <h2 className="text-base font-bold text-white">Thông báo chung gửi Nhóm Zalo</h2>
              <p className="text-xs text-slate-400">
                Tự động tạo từ nội dung buổi học và dặn dò bài tập
              </p>
            </div>
          </div>

          <button
            onClick={() => copyToClipboard(zaloBroadcastText)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition shadow-md shadow-emerald-600/20"
          >
            {copiedZalo ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copiedZalo ? "Đã sao chép tin nhắn Zalo!" : "Copy Thông báo Zalo"}
          </button>
        </div>

        <div className="relative">
          <textarea
            rows={8}
            value={zaloBroadcastText}
            onChange={(e) => setZaloBroadcastText(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 font-sans text-sm text-slate-200 focus:outline-none focus:border-emerald-500 leading-relaxed resize-y"
          />
        </div>
      </div>
    </div>
  );
}
