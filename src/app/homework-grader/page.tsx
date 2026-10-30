"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  FileSpreadsheet,
  Copy,
  Check,
  CheckCircle,
  AlertCircle,
  Clock,
  RotateCcw,
  FileCode,
  Eye,
  X,
  Table2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import TeachingReportCardView from "@/components/teaching-report-card-view";
import { ClassPicker } from "@/components/class-picker";
import {
  formatCellForExport as _sharedFormatCellForExport,
  type ScoreExportMode,
} from "@/lib/report-card/export-cell-formatter";

const formatCellForExport: (
  cell?: StudentScoreCell | null,
  mode?: ScoreExportMode
) => string | number =
  typeof _sharedFormatCellForExport === "function"
    ? _sharedFormatCellForExport
    : (globalThis as any).__mindxExportHelpers?.formatCellForExport ||
      (typeof console !== "undefined" ? (console as any).__mindxExportHelpers?.formatCellForExport : undefined) ||
      (typeof URL !== "undefined" ? (URL as any).__mindxExportHelpers?.formatCellForExport : undefined);

type ScoreCellStatus =
  | "GRADED"
  | "SUBMITTED_UNGRADED"
  | "NOT_SUBMITTED"
  | "REDO_REQUESTED";

interface ScoreColumnInfo {
  colIndex: number;
  columnId: string;
  lessonId?: string;
  title: string;
  sessionNumber: number;
  lessonType?: string;
}

interface StudentScoreCell {
  columnId: string;
  lessonId?: string;
  sessionNumber: number;
  status: ScoreCellStatus;
  score: number | null;
  quizScore?: number | null;
  maxScore: number;
  submissionId?: string | null;
  attachments?: string[];
  teacherNote?: string;
  submittedAt?: string;
  gradedCountText?: string;
  rawText: string;
}

interface StudentScoreRow {
  studentId: string;
  studentUid?: string;
  fullName: string;
  isActive: boolean;
  cells: Record<string, StudentScoreCell>;
  averageScore: number | null;
  averageQuizScore?: number | null;
  gradedCount: number;
  submittedUngradedCount: number;
  notSubmittedCount: number;
  redoCount: number;
}

interface ClassScoreMatrixResult {
  success: boolean;
  classId: string;
  classCode: string;
  lmsClassId?: string;
  columns: ScoreColumnInfo[];
  rows: StudentScoreRow[];
  summary: {
    totalStudents: number;
    totalColumns: number;
    gradedCells: number;
    submittedUngradedCells: number;
    notSubmittedCells: number;
    redoCells: number;
    zeroScoreCells: number;
  };
  scrapedAt: string;
}

function sanitizeTsvCell(value: string | number): string {
  const cleaned = String(value ?? "").replace(/[\r\n\t]+/g, " ").trim();
  if (/^[=+\-@]/.test(cleaned)) {
    return `'${cleaned}`;
  }
  return cleaned;
}

function htmlToPlainText(rawHtml?: string): string {
  if (!rawHtml) return "";
  const withLineBreaks = rawHtml
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, "\n");
  if (typeof window !== "undefined" && typeof window.DOMParser !== "undefined") {
    const doc = new window.DOMParser().parseFromString(withLineBreaks, "text/html");
    return (doc.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
  }
  return withLineBreaks
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export default function HomeworkGraderPage() {
  const [classCode, setClassCode] = useState("VT-C4K-PTA12");
  const [classId, setClassId] = useState("VT-C4K-PTA12");
  const [runningClasses, setRunningClasses] = useState<string[]>([]);
  const [isFetchingClasses, setIsFetchingClasses] = useState(false);
  const [exportFormat, setExportFormat] = useState<"xlsx" | "csv">("xlsx");
  const [showSubmissionDetails, setShowSubmissionDetails] = useState(false);
  const [matrix, setMatrix] = useState<ClassScoreMatrixResult | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"practice" | "both" | "quiz">("both");

  const [isScraping, setIsScraping] = useState(false);
  const [isLoadingCache, setIsLoadingCache] = useState(false);
  const [copiedSheets, setCopiedSheets] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState<{
    studentName: string;
    studentId: string;
    colTitle: string;
    cell: StudentScoreCell;
  } | null>(null);

  const [statusMessage, setStatusMessage] = useState<{
    type: "info" | "success" | "error";
    text: string;
  } | null>(null);

  const latestLoadRequestIdRef = useRef(0);
  const latestScrapeRequestIdRef = useRef(0);
  const scrapingClassRef = useRef<string | null>(null);
  const skipNextEffectLoadForClassRef = useRef<string | null>(null);
  const activeClassIdRef = useRef("VT-C4K-PTA12");
  const hasRestoredClassCodeRef = useRef(false);
  const restoredTargetClassRef = useRef<string | null>(null);
  const autoScanOnMountRef = useRef(false);

  useEffect(() => {
    if (!hasRestoredClassCodeRef.current) {
      hasRestoredClassCodeRef.current = true;
      if (typeof window !== "undefined") {
        try {
          const urlParams = new URLSearchParams(window.location?.search || "");
          const urlClass =
            urlParams.get("classId") || urlParams.get("classCode") || "";
          if (urlParams.get("autoScan") === "1") {
            autoScanOnMountRef.current = true;
          }
          const saved =
            urlClass.trim() ||
            window.localStorage?.getItem("mindx_last_class_code") ||
            "";
          if (saved && saved.trim()) {
            restoredTargetClassRef.current = saved.trim().toUpperCase();
          }
        } catch {}
      }
    }
    const norm = classId.trim().toUpperCase();
    if (restoredTargetClassRef.current && norm !== restoredTargetClassRef.current) {
      const target = restoredTargetClassRef.current;
      setClassCode(target);
      setClassId(target);
      activeClassIdRef.current = target;
      return;
    }
    restoredTargetClassRef.current = null;
    activeClassIdRef.current = norm;
    if (norm && typeof window !== "undefined") {
      try {
        window.localStorage.setItem("mindx_last_class_code", norm);
      } catch {}
    }
    if (scrapingClassRef.current && scrapingClassRef.current !== norm) {
      latestScrapeRequestIdRef.current++;
      scrapingClassRef.current = null;
      setIsScraping(false);
    }
    setMatrix((prev) => (prev && prev.classId?.trim().toUpperCase() === norm ? prev : null));
    setUpdatedAt(null);
    setSelectedDetail(null);
    if (autoScanOnMountRef.current && norm) {
      autoScanOnMountRef.current = false;
      void handleScrapeScores(norm);
      return;
    }
    if (skipNextEffectLoadForClassRef.current === norm) {
      skipNextEffectLoadForClassRef.current = null;
      return;
    }
    skipNextEffectLoadForClassRef.current = null;
    if (scrapingClassRef.current === norm) {
      return;
    }
    loadCachedScores(norm);
  }, [classId]);

  const handleFetchRunningClasses = async () => {
    setIsFetchingClasses(true);
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
      const json = await res.json();
      const rawList = Array.isArray(json.classes)
        ? json.classes
        : Array.isArray(json.data?.classes)
        ? json.data.classes
        : null;
      if (res.ok !== false && json.success && Array.isArray(rawList)) {
        const codes: string[] = rawList
          .map((c: any) => (typeof c === "string" ? c : c?.classCode || c?.classId))
          .filter(Boolean);
        setRunningClasses(codes);
        if (codes.length > 0) {
          if (!codes.includes(classCode)) {
            setClassCode(codes[0]);
            setClassId(codes[0]);
          }
          setStatusMessage({
            type: "success",
            text: `Đã cập nhật danh sách ${codes.length} lớp đang dạy từ LMS.`,
          });
        } else {
          setStatusMessage({
            type: "info",
            text: "Đã quét LMS thành công nhưng hiện chưa có lớp nào đang mở (Running).",
          });
        }
      } else {
        setStatusMessage({
          type: "error",
          text: `Không lấy được danh sách lớp từ LMS: ${
            json?.error || "Chưa thể kết nối LMS."
          }`,
        });
      }
    } catch (err: any) {
      setStatusMessage({
        type: "error",
        text: `Lỗi kết nối khi lấy danh sách lớp: ${err?.message || String(err)}`,
      });
    } finally {
      setIsFetchingClasses(false);
    }
  };

  const loadCachedScores = async (targetClassId: string) => {
    const norm = targetClassId.trim().toUpperCase();
    if (!norm) return;
    const requestId = ++latestLoadRequestIdRef.current;
    setIsLoadingCache(true);

    try {
      const res = await fetch(`/api/homework-grader/scores?classId=${encodeURIComponent(norm)}`);
      const json = await res.json();
      if (
        requestId !== latestLoadRequestIdRef.current ||
        activeClassIdRef.current !== norm ||
        scrapingClassRef.current === norm
      ) {
        return;
      }
      if (json.success && json.data) {
        if (Array.isArray(json.data.runningClasses) && json.data.runningClasses.length > 0) {
          setRunningClasses((prev) =>
            Array.from(new Set([...json.data.runningClasses, ...prev]))
          );
        }
        const fetchedMatrix = json.data.matrix as ClassScoreMatrixResult | null;
        if (
          fetchedMatrix &&
          fetchedMatrix.classId &&
          fetchedMatrix.classId.trim().toUpperCase() !== norm
        ) {
          setMatrix(null);
          setUpdatedAt(null);
          return;
        }
        setMatrix(fetchedMatrix || null);
        setUpdatedAt(json.data.updatedAt || null);
      }
    } catch (err) {
      if (requestId === latestLoadRequestIdRef.current) {
        console.error("Lỗi tải bảng điểm:", err);
      }
    } finally {
      if (requestId === latestLoadRequestIdRef.current) {
        setIsLoadingCache(false);
      }
    }
  };

  const handleScrapeScores = async (
    overrideClassCode?: string
  ): Promise<{
    success: boolean;
    error?: string;
  }> => {
    const norm = String(overrideClassCode || classCode || classId || "")
      .trim()
      .toUpperCase();
    if (!norm) {
      return { success: false, error: "Mã lớp không hợp lệ." };
    }
    const scrapeRequestId = ++latestScrapeRequestIdRef.current;
    latestLoadRequestIdRef.current++;
    setIsLoadingCache(false);
    scrapingClassRef.current = norm;
    if (classId.trim().toUpperCase() !== norm) {
      skipNextEffectLoadForClassRef.current = norm;
    }
    activeClassIdRef.current = norm;
    setClassCode(norm);
    setClassId(norm);
    setMatrix(null);
    setUpdatedAt(null);
    setSelectedDetail(null);
    setIsScraping(true);
    setStatusMessage({
      type: "info",
      text: `Đang kết nối LMS và cào toàn bộ bảng điểm lớp ${norm} (tab Submission)...`,
    });

    try {
      const res = await fetch("/api/homework-grader/scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classCode: norm }),
      });
      const data = await res.json();
      if (
        scrapeRequestId !== latestScrapeRequestIdRef.current ||
        activeClassIdRef.current !== norm
      ) {
        return {
          success: false,
          error: "Yêu cầu quét điểm đã bị hủy do đổi lớp.",
        };
      }
      // Invalidate any concurrent cache GET so it cannot overwrite the fresh scrape result
      latestLoadRequestIdRef.current++;
      setIsLoadingCache(false);

      if (res.ok !== false && data?.success) {
        setMatrix(data);
        setUpdatedAt(new Date().toLocaleString("vi-VN"));
        setStatusMessage({
          type: "success",
          text: `Đã cào thành công bảng điểm lớp ${norm}: ${data.summary?.totalStudents || 0} học viên × ${data.summary?.totalColumns || 0} cột bài tập (${data.summary?.gradedCells || 0} đã chấm, ${data.summary?.submittedUngradedCells || 0} chờ chấm, ${data.summary?.redoCells || 0} yêu cầu làm lại).`,
        });
        return { success: true };
      } else {
        const errText = `Cào bảng điểm thất bại: ${data?.error || "Không thể đọc dữ liệu từ LMS"}`;
        setStatusMessage({
          type: "error",
          text: errText,
        });
        return { success: false, error: errText };
      }
    } catch (err: any) {
      const errText = `Lỗi kết nối API: ${err.message}`;
      if (scrapeRequestId === latestScrapeRequestIdRef.current) {
        setStatusMessage({
          type: "error",
          text: errText,
        });
      }
      return { success: false, error: errText };
    } finally {
      if (scrapeRequestId === latestScrapeRequestIdRef.current) {
        scrapingClassRef.current = null;
        setIsScraping(false);
        setIsLoadingCache(false);
      }
    }
  };

  const isMatrixMatchedWithSelection = Boolean(
    matrix &&
      matrix.rows.length > 0 &&
      !isScraping &&
      !isLoadingCache &&
      matrix.classId?.trim().toUpperCase() === classId.trim().toUpperCase() &&
      classId.trim().toUpperCase() === classCode.trim().toUpperCase()
  );

  const handleExportFile = (format: "xlsx" | "csv") => {
    if (!isMatrixMatchedWithSelection) return;
    const norm = classId.trim().toUpperCase();
    window.open(
      `/api/homework-grader/export?classId=${encodeURIComponent(norm)}&format=${format}&mode=${encodeURIComponent(viewMode)}`,
      "_blank"
    );
  };

  const handleCopyForGoogleSheets = async () => {
    if (!isMatrixMatchedWithSelection || !matrix || !matrix.rows.length) return;
    const cols = matrix.columns || [];

    const headers = [
      "STT",
      "Mã Học Viên (ID)",
      "Họ và Tên",
      "Trạng Thái Học",
      ...cols.map((c) => sanitizeTsvCell(c.title || `Buổi ${c.sessionNumber}`)),
      "Điểm TB Thực hành",
      "Điểm TB Quiz",
      "Đã chấm",
      "Chờ chấm",
      "Chưa nộp",
      "Làm lại",
    ];

    const lines = [headers.join("\t")];
    matrix.rows.forEach((row, idx) => {
      const cellsText = cols.map((col) =>
        sanitizeTsvCell(formatCellForExport(row.cells?.[col.columnId], viewMode))
      );
      const line = [
        String(idx + 1),
        sanitizeTsvCell(row.studentId),
        sanitizeTsvCell(row.fullName),
        row.isActive ? "Đang học" : "Nghỉ/Bảo lưu",
        ...cellsText,
        typeof row.averageScore === "number" ? String(row.averageScore) : "-",
        typeof row.averageQuizScore === "number" ? String(row.averageQuizScore) : "-",
        String(row.gradedCount),
        String(row.submittedUngradedCount),
        String(row.notSubmittedCount),
        String(row.redoCount),
      ];
      lines.push(line.join("\t"));
    });

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopiedSheets(true);
      setTimeout(() => setCopiedSheets(false), 2500);
    } catch (err: any) {
      setStatusMessage({
        type: "error",
        text: `Không thể copy vào Clipboard: ${err?.message || "Trình duyệt từ chối quyền truy cập Clipboard"}`,
      });
    }
  };

  const renderCellBadge = (student: StudentScoreRow, col: ScoreColumnInfo) => {
    const cell = student.cells?.[col.columnId];
    if (!cell) {
      return (
        <span className="px-2 py-0.5 rounded text-[11px] bg-slate-800/70 text-slate-500 border border-slate-700/50">
          Chưa nộp
        </span>
      );
    }

    const hasDetail = Boolean(cell.teacherNote || (cell.attachments && cell.attachments.length > 0));

    let badgeContent: React.ReactNode = null;

    if (viewMode === "quiz") {
      if (typeof cell.quizScore === "number") {
        badgeContent = (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-sky-500/15 text-sky-300 border border-sky-500/30">
            Quiz: {cell.quizScore}/100
          </span>
        );
      } else {
        badgeContent = (
          <span className="px-2 py-0.5 rounded text-[11px] bg-slate-800/70 text-slate-500 border border-slate-700/50">
            Chưa làm
          </span>
        );
      }
    } else if (cell.status === "GRADED") {
      const isZero = cell.score === 0;
      badgeContent = (
        <div className="flex flex-col items-center gap-0.5">
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold border ${
              isZero
                ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                : "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
            }`}
          >
            {typeof cell.score === "number" ? `${cell.score}/100` : "Đã chấm"}
            {hasDetail && <Eye className="w-3 h-3 opacity-70" />}
          </span>
          {viewMode === "both" && typeof cell.quizScore === "number" && (
            <span className="text-[10px] font-medium text-sky-400">
              Quiz: {cell.quizScore}đ
            </span>
          )}
        </div>
      );
    } else if (cell.status === "SUBMITTED_UNGRADED") {
      badgeContent = (
        <div className="flex flex-col items-center gap-0.5">
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
            <Clock className="w-3 h-3" /> Chưa chấm
          </span>
          {viewMode === "both" && typeof cell.quizScore === "number" && (
            <span className="text-[10px] font-medium text-sky-400">
              Quiz: {cell.quizScore}đ
            </span>
          )}
        </div>
      );
    } else if (cell.status === "REDO_REQUESTED") {
      badgeContent = (
        <div className="flex flex-col items-center gap-0.5">
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">
            <RotateCcw className="w-3 h-3" /> Làm lại
          </span>
          {viewMode === "both" && typeof cell.quizScore === "number" && (
            <span className="text-[10px] font-medium text-sky-400">
              Quiz: {cell.quizScore}đ
            </span>
          )}
        </div>
      );
    } else {
      badgeContent = (
        <div className="flex flex-col items-center gap-0.5">
          <span className="px-2 py-0.5 rounded text-[11px] bg-slate-800/70 text-slate-500 border border-slate-700/50">
            Chưa nộp
          </span>
          {viewMode === "both" && typeof cell.quizScore === "number" && (
            <span className="text-[10px] font-medium text-sky-400">
              Quiz: {cell.quizScore}đ
            </span>
          )}
        </div>
      );
    }

    return (
      <button
        type="button"
        onClick={() =>
          setSelectedDetail({
            studentName: student.fullName,
            studentId: student.studentId,
            colTitle: col.title,
            cell,
          })
        }
        className="hover:scale-105 transition transform focus:outline-none"
        title="Bấm để xem chi tiết bài nộp & nhận xét"
      >
        {badgeContent}
      </button>
    );
  };

  return (
    <div className="space-y-6">
      {/* 1. Header & Class Selector */}
      <div className="p-6 rounded-2xl mindx-hero shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="p-2.5 rounded-xl bg-sky-500/20 border border-sky-400/30 text-sky-300 text-2xl">
              📊
            </span>
            <div>
              <h1 className="text-xl font-extrabold tracking-wide">
                Phiếu Điểm Tổng Kết (Chuẩn Teaching) &amp; Bảng Điểm BTVN
              </h1>
              <p className="text-xs text-blue-100 mt-0.5">
                Tự động lấy điểm BTVN, Check-point 1 &amp; 2, Năng lực `[ĐNL]` và Cuối khóa DEMO từ LMS • Đồng bộ 1 chạm lên Teaching
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <ClassPicker
              scope="running"
              variant="hero"
              value={classCode}
              classes={runningClasses}
              onChange={(val) => {
                setRunningClasses((prev) =>
                  prev.includes(val) ? prev : [val, ...prev]
                );
                setClassCode(val);
                setClassId(val);
              }}
              onRefresh={handleFetchRunningClasses}
              isRefreshing={isFetchingClasses}
              disabled={isScraping || isFetchingClasses}
              lastSyncedAt={updatedAt}
              showRefreshButton={false}
            />
          </div>
        </div>

        {/* Status Toast */}
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
                <CheckCircle className="w-4 h-4 shrink-0" />
              ) : statusMessage.type === "error" ? (
                <AlertCircle className="w-4 h-4 shrink-0" />
              ) : (
                <Clock className="w-4 h-4 shrink-0" />
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
      </div>

      {/* Primary View: Phiếu Điểm Tổng Kết (Chuẩn Teaching — BTVN, CP1, CP2 & DEMO) */}
      <TeachingReportCardView
        classId={classId}
        classCode={classCode}
        onSelectClass={(nextCode) => {
          setClassCode(nextCode);
          setClassId(nextCode);
        }}
        scrapeTrigger=""
        onRequestScrapeLms={handleScrapeScores}
        isScrapingExternal={isScraping}
      />

      {/* Collapsible Secondary View: Chi tiết bài nộp BTVN trên LMS (Xuất Excel / Xem Nhận Xét) */}
      <div className="mindx-card rounded-2xl overflow-hidden shadow-xl">
        <button
          type="button"
          onClick={() => setShowSubmissionDetails((prev) => !prev)}
          className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-800/40 transition cursor-pointer"
        >
          <div className="flex items-center gap-2.5">
            <Table2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-xs font-bold text-slate-200">
              📂 Chi tiết bài nộp BTVN trên LMS (Xuất Excel / Xem Nhận Xét)
            </span>
            {matrix && matrix.rows.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[11px] bg-slate-800 border border-slate-700 text-slate-300 font-medium">
                {matrix.rows.length} HV × {matrix.columns.length} cột
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
            <span>{showSubmissionDetails ? "Thu gọn" : "Mở rộng"}</span>
            {showSubmissionDetails ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </div>
        </button>

        {showSubmissionDetails && (
          <div className="border-t border-slate-800 p-4 space-y-4">
            {/* 2. Export & View Mode Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-400 mr-1">Chế độ xem:</span>
                <button
                  onClick={() => setViewMode("both")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    viewMode === "both"
                      ? "bg-blue-600 text-white mindx-dark-btn"
                      : "bg-slate-800 text-slate-400 hover:text-white"
                  }`}
                >
                  Thực hành + Quiz
                </button>
                <button
                  onClick={() => setViewMode("practice")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    viewMode === "practice"
                      ? "bg-blue-600 text-white mindx-dark-btn"
                      : "bg-slate-800 text-slate-400 hover:text-white"
                  }`}
                >
                  Chỉ Thực hành (File nộp)
                </button>
                <button
                  onClick={() => setViewMode("quiz")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    viewMode === "quiz"
                      ? "bg-blue-600 text-white mindx-dark-btn"
                      : "bg-slate-800 text-slate-400 hover:text-white"
                  }`}
                >
                  Chỉ Điểm Quiz
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleCopyForGoogleSheets}
                  disabled={!isMatrixMatchedWithSelection}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-emerald-400 border border-emerald-500/30 text-xs font-semibold transition cursor-pointer"
                >
                  {copiedSheets ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copiedSheets ? "Đã copy chuẩn Google Sheets!" : "Copy Bảng điểm (Chuẩn Google Sheets)"}
                </button>

                <div className="inline-flex items-center rounded-lg overflow-hidden border border-emerald-500/40 bg-slate-950">
                  <select
                    value={exportFormat}
                    onChange={(e) => setExportFormat(e.target.value as "xlsx" | "csv")}
                    disabled={!isMatrixMatchedWithSelection}
                    className="px-2.5 py-2 bg-slate-900 text-xs font-semibold text-slate-200 border-r border-slate-800 focus:outline-none cursor-pointer disabled:opacity-40"
                  >
                    <option value="xlsx">Excel (.XLSX)</option>
                    <option value="csv">CSV (.CSV)</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => handleExportFile(exportFormat)}
                    disabled={!isMatrixMatchedWithSelection}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold transition cursor-pointer mindx-dark-btn"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    <span>Xuất file</span>
                  </button>
                </div>
              </div>
            </div>

            {/* 3. Score Matrix Table */}
            <div className="rounded-xl overflow-hidden border border-slate-800">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-300">
                  <thead className="mindx-thead text-xs uppercase font-bold tracking-wider">
                    <tr>
                      <th className="px-3 py-3.5 w-12 text-center sticky left-0 bg-[#172554] z-10">
                        STT
                      </th>
                      <th className="px-4 py-3.5 min-w-[200px] sticky left-12 bg-[#172554] z-10 border-r border-slate-700/60">
                        Học viên
                      </th>
                      {matrix?.columns?.map((col) => (
                        <th
                          key={col.columnId}
                          className="px-3 py-3.5 min-w-[135px] text-center border-r border-slate-700/60"
                          title={col.title}
                        >
                          <div className="font-bold text-white truncate max-w-[150px] mx-auto">
                            {col.title}
                          </div>
                        </th>
                      ))}
                      <th className="px-3 py-3.5 w-28 text-center bg-[#172554] font-bold text-emerald-300">
                        TB Thực hành
                      </th>
                      <th className="px-3 py-3.5 w-24 text-center bg-[#172554] font-bold text-sky-300">
                        TB Quiz
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {matrix && matrix.rows.length > 0 ? (
                      matrix.rows.map((student, idx) => (
                        <tr key={student.studentId} className="hover:bg-slate-850/60 transition border-l-4 border-l-sky-500">
                          <td className="px-3 py-3.5 text-center font-mono text-xs text-slate-500 sticky left-0 bg-slate-900">
                            {String(idx + 1).padStart(2, "0")}
                          </td>
                          <td className="px-4 py-3.5 sticky left-12 bg-slate-900 border-r border-slate-800">
                            <div className="font-semibold text-white">{student.fullName}</div>
                            <div className="text-[11px] font-mono text-slate-500">
                              {student.studentId}
                            </div>
                          </td>
                          {matrix.columns.map((col) => (
                            <td
                              key={col.columnId}
                              className="px-2 py-3 text-center border-r border-slate-800/40"
                            >
                              {renderCellBadge(student, col)}
                            </td>
                          ))}
                          <td className="px-3 py-3.5 text-center font-bold text-emerald-400 bg-slate-950/30">
                            {typeof student.averageScore === "number"
                              ? `${student.averageScore}`
                              : "-"}
                          </td>
                          <td className="px-3 py-3.5 text-center font-semibold text-sky-400 bg-slate-950/30">
                            {typeof student.averageQuizScore === "number"
                              ? `${student.averageQuizScore}`
                              : "-"}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={(matrix?.columns?.length || 0) + 4}
                          className="px-4 py-10 text-center text-slate-500"
                        >
                          Chưa có dữ liệu bảng điểm cho lớp <strong>{classCode}</strong>. Vui lòng bấm{" "}
                          <strong>&quot;🔄 Quét Điểm BTVN &amp; Checkpoint từ LMS&quot;</strong> ở thanh công cụ phía trên.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 4. Submission Detail Modal */}
      {selectedDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="mindx-card rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-white">
                  Chi tiết Bài nộp: {selectedDetail.studentName}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {selectedDetail.colTitle} • Mã HV: {selectedDetail.studentId}
                </p>
              </div>
              <button
                onClick={() => setSelectedDetail(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block">Điểm Thực hành:</span>
                <strong className="text-base text-emerald-400">
                  {typeof selectedDetail.cell.score === "number"
                    ? `${selectedDetail.cell.score}/100`
                    : selectedDetail.cell.rawText}
                </strong>
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block">Điểm Quiz (Denise):</span>
                <strong className="text-base text-sky-400">
                  {typeof selectedDetail.cell.quizScore === "number"
                    ? `${selectedDetail.cell.quizScore}/100`
                    : "Chưa làm"}
                </strong>
              </div>
            </div>

            {selectedDetail.cell.submissionId && (
              <div className="text-xs text-slate-400 font-mono bg-slate-950 px-3 py-2 rounded-lg border border-slate-800">
                submissionId: <span className="text-slate-200">{selectedDetail.cell.submissionId}</span>
              </div>
            )}

            {selectedDetail.cell.attachments && selectedDetail.cell.attachments.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <FileCode className="w-4 h-4 text-blue-400" /> File bài nộp đính kèm:
                </div>
                <ul className="space-y-1 text-xs font-mono text-blue-300 bg-slate-950 p-3 rounded-xl border border-slate-800">
                  {selectedDetail.cell.attachments.map((att, i) => (
                    <li key={i} className="truncate">
                      • {att.split("/").pop() || att}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-slate-300">Nhận xét của Giáo viên trên LMS:</div>
              {selectedDetail.cell.teacherNote ? (
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 leading-relaxed whitespace-pre-wrap break-words">
                  {htmlToPlainText(selectedDetail.cell.teacherNote)}
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-500 italic">
                  (Chưa có nhận xét văn bản cho bài nộp này)
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
