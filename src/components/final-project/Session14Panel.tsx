"use client";

import React from "react";
import { Loader2, Sparkles, UploadCloud } from "lucide-react";
import { SpckWorkflowController } from "./useSpckWorkflow";

export interface Session14PanelProps {
  workflow: SpckWorkflowController;
}

export function Session14Panel({ workflow }: Session14PanelProps) {
  const {
    selectedSessionNumber,
    selectedClassId,
    isAnyOperationBusy,
    handleImportDemoScores,
    importingDemoScores,
    handleGenerateSession14EvalAi,
    generatingS14EvalAi,
    handleApproveAndUploadSession14Eval,
    uploadingS14EvalLms,
    demoScoreSourceInput,
    setDemoScoreSourceInput,
    generatedDemoSheetUrl,
    session14Evals,
    rows,
    setExpandedRowKeys,
    setRowActiveTab,
  } = workflow;

  if (selectedSessionNumber !== 14 || !selectedClassId) {
    return null;
  }

  const verifiedCount = session14Evals.filter(
    (ev) => ev.status === "VERIFIED"
  ).length;
  const readyLetterCount = session14Evals.filter(
    (ev) =>
      ev.learnedFromMindx.trim() &&
      ev.suggestionsFromMindx.trim() &&
      ev.futureDirection.trim()
  ).length;

  const handleOpenAllTab2 = () => {
    const nextExpanded: Record<string, boolean> = {};
    rows.forEach((r, idx) => {
      const key = r.folderPath || r.assignedStudentId || String(idx);
      nextExpanded[key] = true;
      if (r.assignedStudentId) {
        setRowActiveTab(r.assignedStudentId, "eval14");
      }
    });
    setExpandedRowKeys((prev) => ({ ...prev, ...nextExpanded }));
  };

  return (
    <div className="mindx-card-purple p-5 rounded-xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mindx-badge-blue px-2.5 py-0.5 rounded-full text-xs font-bold">
            Bước 4 / 4 — Riêng Buổi 14 (Tổng kết cuối khóa)
          </span>
          <h2 className="text-sm font-bold text-white">
            Đánh Giá Tổng Kết Cuối Khóa, Điểm Demo &amp; Thư Từ MindX
          </h2>
          <span className="text-xs text-slate-300">
            • Đã soạn Thư 3 phần:{" "}
            <strong className="text-indigo-300">{readyLetterCount}</strong>/
            {session14Evals.length} • Đã lưu LMS:{" "}
            <strong className="text-emerald-300">{verifiedCount}</strong>/
            {session14Evals.length}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {rows.length > 0 && (
            <button
              type="button"
              onClick={handleOpenAllTab2}
              className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-indigo-500/60 text-indigo-200 text-xs font-bold cursor-pointer"
            >
              🏅 Mở Tab 2 (Điểm Demo &amp; Thư 3 phần) trên danh sách học viên
            </button>
          )}

          <button
            type="button"
            disabled={isAnyOperationBusy}
            onClick={() => handleGenerateSession14EvalAi()}
            className="px-3.5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-bold flex items-center space-x-1.5 shadow-sm cursor-pointer"
          >
            {generatingS14EvalAi ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            <span>✨ AI Soạn Thư Tổng Kết 3 Phần (Cả lớp)</span>
          </button>

          <button
            type="button"
            disabled={isAnyOperationBusy}
            onClick={() => handleApproveAndUploadSession14Eval()}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold flex items-center space-x-1.5 shadow-sm cursor-pointer"
          >
            {uploadingS14EvalLms ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <UploadCloud className="w-3.5 h-3.5" />
            )}
            <span>🚀 Duyệt &amp; Đẩy Đánh Giá Buổi 14 Lên LMS</span>
          </button>
        </div>
      </div>

      {/* Thanh đọc Điểm Demo từ file chấm điểm BGK (Tự động đọc khi mở Buổi 14 + cho phép dán đường dẫn/link tùy chọn) */}
      <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 flex flex-wrap items-center gap-2.5">
        <span className="text-xs font-semibold text-indigo-300 shrink-0">
          📊 File chấm điểm BGK (.xlsx hoặc Link Google Sheet):
        </span>
        <input
          type="text"
          value={demoScoreSourceInput}
          onChange={(e) => setDemoScoreSourceInput(e.target.value)}
          disabled={isAnyOperationBusy}
          placeholder={
            generatedDemoSheetUrl ||
            "Để trống để tự tìm file 'Bảng chấm điểm buổi Demo.xlsx' trong thư mục lớp, hoặc dán đường dẫn/link Google Sheet..."
          }
          className="flex-1 min-w-[260px] px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs font-mono disabled:opacity-60"
        />
        <button
          type="button"
          disabled={isAnyOperationBusy}
          onClick={() => handleImportDemoScores()}
          className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
        >
          {importingDemoScores
            ? "Đang đọc điểm..."
            : "📥 Đọc Điểm Demo từ File Chấm Điểm"}
        </button>
      </div>
    </div>
  );
}
