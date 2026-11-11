"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  Loader2,
  Plus,
  Save,
  Tags,
  Trash2,
} from "lucide-react";

interface CourseSessionItem {
  sessionNumber: number;
  topic: string;
  keyKnowledge: string[];
  homeworkBrief: string;
}

interface CourseSyllabusItem {
  courseCode: string;
  courseName: string;
  description: string;
  checkpointSessions?: number[];
  sessions: CourseSessionItem[];
}

interface QuickTagItem {
  id: string;
  label: string;
  sentiment: "positive" | "constructive" | "neutral";
  role?: string;
  hint: string;
}

interface QuickTagCategoryItem {
  category: string;
  categoryName: string;
  track?: string;
  tags: QuickTagItem[];
}

export default function SyllabusConfigPage() {
  const [activeTab, setActiveTab] = useState<"courses" | "quickTags">("courses");

  const [courses, rawSetCourses] = useState<CourseSyllabusItem[]>([]);
  const [selectedCourseIdx, setSelectedCourseIdx] = useState<number>(0);

  const [quickTags, rawSetQuickTags] = useState<QuickTagCategoryItem[]>([]);

  const editVersionRef = React.useRef({
    courses: 0,
    quickTags: 0,
  });

  const serverRevisionRef = React.useRef<{
    courses: string;
    quickTags: string;
  }>({
    courses: "",
    quickTags: "",
  });

  const setCourses = useCallback((updater: React.SetStateAction<CourseSyllabusItem[]>) => {
    editVersionRef.current.courses += 1;
    rawSetCourses(updater);
  }, []);

  const setQuickTags = useCallback((updater: React.SetStateAction<QuickTagCategoryItem[]>) => {
    editVersionRef.current.quickTags += 1;
    rawSetQuickTags(updater);
  }, []);

  const [loading, setLoading] = useState<boolean>(true);
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [banner, setBanner] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const loadAllConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/config");
      const data = await res.json();
      if (!res.ok || !data.success) {
        setBanner({
          type: "error",
          text: data.error || "Không thể tải dữ liệu cấu hình hệ thống.",
        });
        return;
      }
      rawSetCourses(data.courses || []);
      rawSetQuickTags(data.quickTags || []);
      if (data.revisions && typeof data.revisions === "object") {
        if (typeof data.revisions.courses === "string") {
          serverRevisionRef.current.courses = data.revisions.courses;
        }
        if (typeof data.revisions.quickTags === "string") {
          serverRevisionRef.current.quickTags = data.revisions.quickTags;
        }
      }
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAllConfigs();
  }, [loadAllConfigs]);

  const handleSaveSection = async (section: "courses" | "quickTags") => {
    setSavingSection(section);
    setBanner(null);
    const versionAtSubmit = editVersionRef.current[section];
    try {
      const payload: Record<string, unknown> = { section };
      if (serverRevisionRef.current[section]) {
        payload.expectedRevision = serverRevisionRef.current[section];
      }
      if (section === "courses") payload.courses = courses;
      if (section === "quickTags") payload.quickTags = quickTags;

      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setBanner({
          type: "error",
          text: data.error || "Không thể lưu cấu hình.",
        });
        return false;
      }

      if (typeof data.revision === "string" && data.revision) {
        serverRevisionRef.current[section] = data.revision;
      } else if (data.revisions && typeof data.revisions[section] === "string") {
        serverRevisionRef.current[section] = data.revisions[section];
      }

      if (data.courses && editVersionRef.current.courses === versionAtSubmit) {
        rawSetCourses(data.courses);
      }
      if (data.quickTags && editVersionRef.current.quickTags === versionAtSubmit) {
        rawSetQuickTags(data.quickTags);
      }

      setBanner({
        type: "success",
        text: data.message || "Đã lưu cấu hình thành công!",
      });
      return true;
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
      return false;
    } finally {
      setSavingSection(null);
    }
  };

  const activeCourse = courses[selectedCourseIdx] || null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="p-6 rounded-2xl mindx-hero flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 shadow-md">
        <div className="flex items-start space-x-3">
          <div className="p-3 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-300 shrink-0">
            <BookOpen className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">
              Cài đặt Giáo trình &amp; Bộ Thẻ Nhận Xét Nhanh
            </h1>
            <p className="text-sm text-blue-100 mt-1">
              Quản lý nội dung từng buổi học, cấu hình Buổi Kiểm tra (Checkpoint) và Bộ thẻ nhận xét nhanh 1 chạm theo từng hướng học (Lập trình, Robotics, Buổi 14).
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("courses")}
            className={`flex items-center space-x-1.5 px-4 py-2.5 rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-sm ${
              activeTab === "courses"
                ? "bg-amber-600 text-white mindx-dark-btn mindx-dark-keep"
                : "bg-white/95 text-slate-900 hover:bg-white dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 border border-slate-300/60 dark:border-slate-700"
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>Giáo trình ({courses.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("quickTags")}
            className={`flex items-center space-x-1.5 px-4 py-2.5 rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-sm ${
              activeTab === "quickTags"
                ? "bg-amber-600 text-white mindx-dark-btn mindx-dark-keep"
                : "bg-white/95 text-slate-900 hover:bg-white dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 border border-slate-300/60 dark:border-slate-700"
            }`}
          >
            <Tags className="w-4 h-4" />
            <span>Quick Tags ({quickTags.length})</span>
          </button>
        </div>
      </div>

      {/* Status Banner */}
      {banner && (
        <div
          className={`p-4 rounded-xl border text-sm flex items-center justify-between ${
            banner.type === "success"
              ? "bg-emerald-950/60 border-emerald-800 text-emerald-200"
              : "bg-rose-950/60 border-rose-800 text-rose-200"
          }`}
        >
          <div className="flex items-center space-x-2">
            {banner.type === "success" && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            <span>{banner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-xs underline ml-4 cursor-pointer"
          >
            Đóng
          </button>
        </div>
      )}

      {loading ? (
        <div className="p-12 rounded-2xl mindx-card flex items-center justify-center space-x-3 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin text-orange-400" />
          <span>Đang tải dữ liệu cấu hình...</span>
        </div>
      ) : (
        <>
          {/* ========================================================= */}
          {/* TAB 1: QUẢN LÝ GIÁO TRÌNH KHÓA HỌC (COURSES SYLLABUS)      */}
          {/* ========================================================= */}
          {activeTab === "courses" && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Sidebar: Course List */}
              <div className="lg:col-span-4 p-5 rounded-2xl mindx-card space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-300">
                    Danh sách Khóa học ({courses.length})
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      const nextCode = `COURSE_${courses.length + 1}`;
                      const nextCourse: CourseSyllabusItem = {
                        courseCode: nextCode,
                        courseName: `Khóa học mới (${nextCode})`,
                        description: "Mô tả tóm tắt nội dung khóa học",
                        checkpointSessions: [5, 9],
                        sessions: [
                          {
                            sessionNumber: 1,
                            topic: "Buổi 1: Làm quen & Kiến thức nền tảng",
                            keyKnowledge: ["Khái niệm cơ bản", "Thực hành bài mẫu"],
                            homeworkBrief: "Hoàn thành bài tập buổi 1 trên LMS",
                          },
                        ],
                      };
                      setCourses((prev) => [...prev, nextCourse]);
                      setSelectedCourseIdx(courses.length);
                    }}
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-sm cursor-pointer mindx-dark-btn"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Thêm khóa</span>
                  </button>
                </div>

                <div className="space-y-2.5 max-h-[580px] overflow-y-auto pr-1">
                  {courses.map((course, idx) => (
                    <div
                      key={idx}
                      onClick={() => setSelectedCourseIdx(idx)}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer border-l-4 ${
                        selectedCourseIdx === idx
                          ? "bg-amber-950/30 border-amber-500/70 border-l-amber-600 shadow-sm"
                          : "bg-slate-950 border-slate-800 hover:border-slate-700 border-l-rose-500"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-extrabold text-orange-400 text-sm">
                          {course.courseCode}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {course.checkpointSessions && course.checkpointSessions.length > 0 && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold mindx-badge-amber">
                              ⚡ CP: {course.checkpointSessions.join(", ")}
                            </span>
                          )}
                          <span className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-700 text-xs font-semibold text-slate-400">
                            {course.sessions.length} buổi
                          </span>
                        </div>
                      </div>
                      <div className="text-xs font-semibold text-slate-200 mt-1.5 truncate">
                        {course.courseName}
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => handleSaveSection("courses")}
                  disabled={savingSection === "courses"}
                  className="w-full flex items-center justify-center space-x-2 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold shadow-sm cursor-pointer mindx-dark-btn"
                >
                  {savingSection === "courses" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  <span>Lưu Toàn Bộ Giáo Trình Xuống Hệ Thống</span>
                </button>
              </div>

              {/* Right Detail Editor: Course Metadata & Sessions */}
              <div className="lg:col-span-8 p-6 rounded-2xl mindx-card space-y-5">
                {!activeCourse ? (
                  <div className="text-center text-slate-400 py-12 text-sm">
                    Hãy chọn một khóa học bên trái hoặc bấm &ldquo;Thêm khóa&rdquo;.
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                      <h3 className="text-base font-extrabold text-white">
                        Chi tiết Khóa học:{" "}
                        <span className="text-orange-400">{activeCourse.courseCode}</span>
                      </h3>
                      <button
                        type="button"
                        onClick={() => {
                          setCourses((prev) => prev.filter((_, i) => i !== selectedCourseIdx));
                          setSelectedCourseIdx(0);
                        }}
                        className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs shadow-sm cursor-pointer mindx-dark-btn"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Xóa khóa này</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 mb-1">
                          Mã khóa (VD: PTA, PTB, JSB, ROB...)
                        </label>
                        <input
                          type="text"
                          value={activeCourse.courseCode}
                          onChange={(e) => {
                            const val = e.target.value.toUpperCase();
                            setCourses((prev) =>
                              prev.map((c, i) =>
                                i === selectedCourseIdx ? { ...c, courseCode: val } : c
                              )
                            );
                          }}
                          className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs font-bold"
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-xs font-semibold text-slate-400 mb-1">
                          Tên khóa học
                        </label>
                        <input
                          type="text"
                          value={activeCourse.courseName}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCourses((prev) =>
                              prev.map((c, i) =>
                                i === selectedCourseIdx ? { ...c, courseName: val } : c
                              )
                            );
                          }}
                          className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs font-medium"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1">
                        Mô tả khóa học
                      </label>
                      <input
                        type="text"
                        value={activeCourse.description}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCourses((prev) =>
                            prev.map((c, i) =>
                              i === selectedCourseIdx ? { ...c, description: val } : c
                            )
                          );
                        }}
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs"
                      />
                    </div>

                    {/* Checkpoint Sessions Selector */}
                    <div className="p-4 rounded-xl mindx-warm-box space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-extrabold text-amber-300">
                            🎯 Cấu hình Buổi Kiểm tra / Checkpoint (từ Buổi 1 đến Buổi 13)
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            Ở các buổi này, Bot chỉ điền ô &ldquo;Đánh giá chung *&rdquo;, việc tích
                            Điểm Năng lực [ĐNL] &amp; Điểm kiểm tra do giáo viên tự thực hiện trên LMS.
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setCourses((prev) =>
                                prev.map((c, i) =>
                                  i === selectedCourseIdx
                                    ? { ...c, checkpointSessions: [5, 9] }
                                    : c
                                )
                              );
                            }}
                            className="px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-bold cursor-pointer shadow-sm mindx-dark-btn"
                          >
                            Mẫu Lập trình (5, 9)
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCourses((prev) =>
                                prev.map((c, i) =>
                                  i === selectedCourseIdx
                                    ? { ...c, checkpointSessions: [4, 8] }
                                    : c
                                )
                              );
                            }}
                            className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-bold cursor-pointer shadow-sm mindx-dark-btn"
                          >
                            Mẫu Robotics (4, 8)
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {Array.from({ length: 13 }, (_, idx) => idx + 1).map((sessNum) => {
                          const isChecked = (activeCourse.checkpointSessions || []).includes(
                            sessNum
                          );
                          return (
                            <button
                              key={sessNum}
                              type="button"
                              onClick={() => {
                                setCourses((prev) =>
                                  prev.map((c, i) => {
                                    if (i !== selectedCourseIdx) return c;
                                    const current = new Set(c.checkpointSessions || []);
                                    if (current.has(sessNum)) {
                                      current.delete(sessNum);
                                    } else {
                                      current.add(sessNum);
                                    }
                                    return {
                                      ...c,
                                      checkpointSessions: Array.from(current).sort(
                                        (a, b) => a - b
                                      ),
                                    };
                                  })
                                );
                              }}
                              className={`px-3 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                                isChecked
                                  ? "bg-amber-600 border-amber-700 text-white shadow-sm mindx-dark-btn"
                                  : "bg-slate-900 border-slate-800 text-slate-400 hover:border-amber-400"
                              }`}
                            >
                              {isChecked ? `⚡ Buổi ${sessNum}` : `Buổi ${sessNum}`}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Sessions List */}
                    <div className="space-y-3 pt-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold uppercase tracking-wider text-slate-300">
                          Danh sách Buổi học ({activeCourse.sessions.length} buổi linh hoạt)
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const nextNum =
                              activeCourse.sessions.length > 0
                                ? Math.max(...activeCourse.sessions.map((s) => s.sessionNumber)) + 1
                                : 1;
                            const newSession: CourseSessionItem = {
                              sessionNumber: nextNum,
                              topic: `Chủ đề buổi ${nextNum}`,
                              keyKnowledge: ["Kiến thức trọng tâm 1"],
                              homeworkBrief: `Bài tập về nhà buổi ${nextNum}`,
                            };
                            setCourses((prev) =>
                              prev.map((c, i) =>
                                i === selectedCourseIdx
                                  ? { ...c, sessions: [...c.sessions, newSession] }
                                  : c
                              )
                            );
                          }}
                          className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-sm cursor-pointer mindx-dark-btn"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Thêm buổi học</span>
                        </button>
                      </div>

                      <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                        {activeCourse.sessions.map((sess, sIdx) => (
                          <div
                            key={sIdx}
                            className="p-4 rounded-xl bg-slate-950 border border-slate-800 border-l-4 border-l-amber-500 space-y-3"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center space-x-2 flex-1">
                                <span className="text-xs font-semibold text-slate-400">Buổi số:</span>
                                <input
                                  type="number"
                                  min={1}
                                  value={sess.sessionNumber}
                                  onChange={(e) => {
                                    const num = Math.max(1, Number(e.target.value) || 1);
                                    setCourses((prev) =>
                                      prev.map((c, i) =>
                                        i === selectedCourseIdx
                                          ? {
                                              ...c,
                                              sessions: c.sessions.map((s, j) =>
                                                j === sIdx ? { ...s, sessionNumber: num } : s
                                              ),
                                            }
                                          : c
                                      )
                                    );
                                  }}
                                  className="w-16 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-orange-400 font-bold text-xs"
                                />
                                {(activeCourse.checkpointSessions || []).includes(
                                  sess.sessionNumber
                                ) && (
                                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold mindx-badge-amber shrink-0">
                                    ⚡ Checkpoint
                                  </span>
                                )}
                                <input
                                  type="text"
                                  value={sess.topic}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setCourses((prev) =>
                                      prev.map((c, i) =>
                                        i === selectedCourseIdx
                                          ? {
                                              ...c,
                                              sessions: c.sessions.map((s, j) =>
                                                j === sIdx ? { ...s, topic: val } : s
                                              ),
                                            }
                                          : c
                                      )
                                    );
                                  }}
                                  placeholder="Chủ đề bài học..."
                                  className="flex-1 px-2.5 py-1 rounded bg-slate-900 border border-slate-700 text-white text-xs font-medium"
                                />
                              </div>

                              <button
                                type="button"
                                onClick={() => {
                                  setCourses((prev) =>
                                    prev.map((c, i) =>
                                      i === selectedCourseIdx
                                        ? {
                                            ...c,
                                            sessions: c.sessions.filter((_, j) => j !== sIdx),
                                          }
                                        : c
                                    )
                                  );
                                }}
                                className="text-xs font-semibold text-rose-500 hover:text-rose-400 px-2 py-1 cursor-pointer"
                              >
                                Xóa buổi
                              </button>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                                  Kiến thức trọng tâm (phân cách bằng dấu phẩy)
                                </label>
                                <input
                                  type="text"
                                  value={sess.keyKnowledge.join(", ")}
                                  onChange={(e) => {
                                    const items = e.target.value
                                      .split(",")
                                      .map((k) => k.trim())
                                      .filter(Boolean);
                                    setCourses((prev) =>
                                      prev.map((c, i) =>
                                        i === selectedCourseIdx
                                          ? {
                                              ...c,
                                              sessions: c.sessions.map((s, j) =>
                                                j === sIdx ? { ...s, keyKnowledge: items } : s
                                              ),
                                            }
                                          : c
                                      )
                                    );
                                  }}
                                  className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-200 text-xs"
                                />
                              </div>

                              <div>
                                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                                  Tóm tắt bài tập về nhà
                                </label>
                                <input
                                  type="text"
                                  value={sess.homeworkBrief}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setCourses((prev) =>
                                      prev.map((c, i) =>
                                        i === selectedCourseIdx
                                          ? {
                                              ...c,
                                              sessions: c.sessions.map((s, j) =>
                                                j === sIdx ? { ...s, homeworkBrief: val } : s
                                              ),
                                            }
                                          : c
                                      )
                                    );
                                  }}
                                  className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-200 text-xs"
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Full-Width Bottom Save Bar */}
                    <div className="pt-3 border-t border-slate-800">
                      <button
                        type="button"
                        onClick={() => handleSaveSection("courses")}
                        disabled={savingSection === "courses"}
                        className="w-full flex items-center justify-center space-x-2 px-5 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold shadow-md cursor-pointer mindx-dark-btn"
                      >
                        {savingSection === "courses" ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4" />
                        )}
                        <span>Lưu Toàn Bộ Giáo Trình Xuống Hệ Thống</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* TAB 2: QUẢN LÝ BỘ THẺ NHẬN XÉT NHANH (QUICK TAGS)          */}
          {/* ========================================================= */}
          {activeTab === "quickTags" && (
            <div className="p-6 rounded-2xl mindx-card space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
                <div>
                  <h2 className="text-base font-bold text-white">
                    Bộ Thẻ Đánh Giá Nhanh 1 Chạm (Quick Tags)
                  </h2>
                  <p className="text-xs text-slate-400">
                    Giáo viên bấm chọn nhanh sau mỗi buổi học để AI tổng hợp nhận xét đúng thực tế.
                  </p>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => {
                      setQuickTags((prev) => [
                        ...prev,
                        {
                          category: `coding_custom_${prev.length + 1}`,
                          categoryName: `Nhóm đánh giá mới ${prev.length + 1}`,
                          track: "coding",
                          tags: [
                            {
                              id: `tag_new_${Date.now()}`,
                              label: "Chủ động phát biểu xây dựng bài",
                              sentiment: "positive",
                              role: "positive",
                              hint: "Khen ngợi tinh thần tích cực trong giờ học",
                            },
                          ],
                        },
                      ]);
                    }}
                    className="flex items-center space-x-1 px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Thêm nhóm thẻ</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSaveSection("quickTags")}
                    disabled={savingSection === "quickTags"}
                    className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
                  >
                    {savingSection === "quickTags" ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    <span>Lưu Bộ Thẻ Quick Tags</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="px-2.5 py-1 rounded-full bg-cyan-950/60 border border-cyan-700/60 text-cyan-200 font-semibold">
                  💻 Hướng Lập trình (Buổi 1–13): Chỉ hiện ở Màn hình 1 cho lớp Lập trình
                </span>
                <span className="px-2.5 py-1 rounded-full bg-orange-950/60 border border-orange-700/60 text-orange-200 font-semibold">
                  🤖 Hướng Robotics (Buổi 1–13): Chỉ hiện ở Màn hình 1 cho lớp Robotics
                </span>
                <span className="px-2.5 py-1 rounded-full bg-purple-950/60 border border-purple-700/60 text-purple-200 font-semibold">
                  🎓 Buổi 14 — Sản phẩm cuối khóa (SPCK): Chỉ hiện ở Màn hình 3 (Buổi 14)
                </span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {quickTags.map((cat, catIdx) => {
                  const catKey = String(cat.category || "").toLowerCase();
                  const catName = String(cat.categoryName || "").toLowerCase();
                  const rawTrack = String(cat.track || "").toLowerCase();
                  const currentTrack: "common" | "coding" | "robotics" | "session14" =
                    rawTrack === "session14" ||
                    rawTrack === "robotics" ||
                    rawTrack === "coding" ||
                    rawTrack === "common"
                      ? rawTrack
                      : catKey.startsWith("spck_") || catKey.includes("session14")
                      ? "session14"
                      : catKey.includes("robot") ||
                        catKey.startsWith("rob_") ||
                        /robot|lắp ráp|cơ khí|cảm biến|🤖/i.test(catName)
                      ? "robotics"
                      : catKey === "execution" ||
                        catKey.includes("coding") ||
                        catKey.startsWith("exec_") ||
                        /lập trình|code|cú pháp|💻/i.test(catName)
                      ? "coding"
                      : "common";

                  return (
                    <div
                      key={catIdx}
                      className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <input
                          type="text"
                          value={cat.categoryName}
                          onChange={(e) => {
                            const val = e.target.value;
                            setQuickTags((prev) =>
                              prev.map((c, i) =>
                                i === catIdx ? { ...c, categoryName: val } : c
                              )
                            );
                          }}
                          className="flex-1 min-w-[180px] px-2.5 py-1 rounded bg-slate-900 border border-slate-700 text-purple-300 font-bold text-xs"
                        />
                        <select
                          value={currentTrack}
                          onChange={(e) => {
                            const nextTrack = e.target.value as
                              | "common"
                              | "coding"
                              | "robotics"
                              | "session14";
                            setQuickTags((prev) =>
                              prev.map((c, i) => {
                                if (i !== catIdx) return c;
                                const isCoreCategory =
                                  c.category === "regular_coding" ||
                                  c.category === "regular_robotics" ||
                                  c.category === "spck_session14_presentation" ||
                                  c.category === "spck_session14_product";
                                if (isCoreCategory) {
                                  return { ...c, track: nextTrack };
                                }
                                const rawBase =
                                  c.category
                                    .replace(/^(robotics_|coding_|common_|spck_)/i, "")
                                    .trim() || `group_${i + 1}`;
                                const nextCat =
                                  nextTrack === "session14"
                                    ? `spck_${rawBase}`
                                    : nextTrack === "robotics"
                                    ? rawBase === "robotics"
                                      ? "robotics"
                                      : `robotics_${rawBase}`
                                    : nextTrack === "coding"
                                    ? rawBase === "execution"
                                      ? "execution"
                                      : `coding_${rawBase}`
                                    : rawBase;
                                return { ...c, category: nextCat, track: nextTrack };
                              })
                            );
                          }}
                          className={`px-2 py-1 rounded border text-[11px] font-semibold cursor-pointer ${
                            currentTrack === "session14"
                              ? "bg-purple-950/50 border-purple-600/60 text-purple-300"
                              : currentTrack === "robotics"
                              ? "bg-orange-950/50 border-orange-600/60 text-orange-300"
                              : currentTrack === "coding"
                              ? "bg-cyan-950/50 border-cyan-600/60 text-cyan-300"
                              : "bg-slate-900 border-slate-700 text-slate-300"
                          }`}
                          title="Chọn hướng lớp học sẽ hiển thị nhóm thẻ này"
                        >
                          <option value="coding">💻 Hướng Lập trình (Buổi 1–13)</option>
                          <option value="robotics">🤖 Hướng Robotics (Buổi 1–13)</option>
                          <option value="session14">🎓 Buổi 14 — SPCK</option>
                          <option value="common">🌐 Dùng chung (Buổi 1–13)</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            setQuickTags((prev) => [
                              ...prev.map((c, i) =>
                                i === catIdx
                                  ? {
                                      ...c,
                                      tags: [
                                        ...c.tags,
                                        {
                                          id: `tag_${catIdx}_${Date.now()}`,
                                          label: "Thẻ nhận xét mới",
                                          sentiment: "positive" as const,
                                          role: "positive",
                                          hint: "",
                                        },
                                      ],
                                    }
                                  : c
                              ),
                            ]);
                          }}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-purple-300 cursor-pointer"
                        >
                          + Thêm thẻ
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setQuickTags((prev) => prev.filter((_, i) => i !== catIdx))
                          }
                          className="text-xs text-rose-400 hover:text-rose-300 px-1.5 cursor-pointer"
                        >
                          Xóa nhóm
                        </button>
                      </div>

                      <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                        {cat.tags.map((tag, tIdx) => (
                          <div
                            key={tIdx}
                            className="flex flex-col gap-1.5 p-2 rounded bg-slate-900 border border-slate-800"
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={tag.label}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setQuickTags((prev) =>
                                    prev.map((c, i) =>
                                      i === catIdx
                                        ? {
                                            ...c,
                                            tags: c.tags.map((t, j) =>
                                              j === tIdx ? { ...t, label: val } : t
                                            ),
                                          }
                                        : c
                                    )
                                  );
                                }}
                                placeholder="Nhãn hiển thị trên nút bấm..."
                                className="flex-1 px-2 py-1 rounded bg-slate-950 border border-slate-700 text-white text-xs font-medium"
                              />
                              <select
                                value={tag.sentiment}
                                onChange={(e) => {
                                  const sent = e.target.value as QuickTagItem["sentiment"];
                                  setQuickTags((prev) =>
                                    prev.map((c, i) =>
                                      i === catIdx
                                        ? {
                                            ...c,
                                            tags: c.tags.map((t, j) =>
                                              j === tIdx ? { ...t, sentiment: sent } : t
                                            ),
                                          }
                                        : c
                                    )
                                  );
                                }}
                                className="px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs text-slate-300"
                              >
                                <option value="positive">Tích cực</option>
                                <option value="constructive">Cần cải thiện</option>
                                <option value="neutral">Trung lập</option>
                              </select>
                              <select
                                value={tag.role || "positive"}
                                onChange={(e) => {
                                  const nextRole = e.target.value;
                                  setQuickTags((prev) =>
                                    prev.map((c, i) =>
                                      i === catIdx
                                        ? {
                                            ...c,
                                            tags: c.tags.map((t, j) =>
                                              j === tIdx ? { ...t, role: nextRole } : t
                                            ),
                                          }
                                        : c
                                    )
                                  );
                                }}
                                title="Vai trò phân loại cấp độ học sinh (5 cấp độ)"
                                className="px-2 py-1 rounded bg-slate-950 border border-slate-700 text-[11px] text-purple-300"
                              >
                                <option value="excellent">Vận dụng / Giỏi (excellent)</option>
                                <option value="good">Tiếp thu tốt (good)</option>
                                <option value="positive">Thái độ tốt (positive)</option>
                                <option value="slow">Tiếp thu chậm (slow)</option>
                                <option value="distracted">Mất tập trung (distracted)</option>
                                <option value="improve">Cần rèn luyện (improve)</option>
                              </select>
                              <button
                                type="button"
                                onClick={() => {
                                  setQuickTags((prev) =>
                                    prev.map((c, i) =>
                                      i === catIdx
                                        ? {
                                            ...c,
                                            tags: c.tags.filter((_, j) => j !== tIdx),
                                          }
                                        : c
                                    )
                                  );
                                }}
                                className="text-xs text-rose-400 hover:text-rose-300 px-1 cursor-pointer"
                              >
                                ✕
                              </button>
                            </div>
                            <input
                              type="text"
                              value={tag.hint || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                setQuickTags((prev) =>
                                  prev.map((c, i) =>
                                    i === catIdx
                                      ? {
                                          ...c,
                                          tags: c.tags.map((t, j) =>
                                            j === tIdx ? { ...t, hint: val } : t
                                          ),
                                        }
                                      : c
                                  )
                                );
                              }}
                              placeholder="Gợi ý chi tiết cho AI khi giáo viên chọn thẻ này..."
                              className="w-full px-2 py-1 rounded bg-slate-950/60 border border-slate-800 text-slate-400 text-[11px]"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
