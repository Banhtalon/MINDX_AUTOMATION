"use client";

import React from "react";
import { Loader2, RefreshCw, UploadCloud } from "lucide-react";
import { SpckWorkflowController } from "./useSpckWorkflow";

export interface SubmitBarProps {
  workflow: SpckWorkflowController;
}

export function SubmitBar({ workflow }: SubmitBarProps) {
  const {
    totalStepsCount,
    lastSubmissionSummary,
    handleApproveAndUpload,
    isAnyOperationBusy,
    uploading,
    effectiveSelectedStudentIds,
    selectedSessionNumber,
    selectedClassId,
    setLastSubmissionSummary,
  } = workflow;

  return (
    <div className="mindx-card-emerald p-5 rounded-xl space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mindx-badge-emerald px-2.5 py-0.5 rounded-full text-xs font-bold">
            Bước 3 / {totalStepsCount}
          </span>
          <h2 className="text-sm font-bold text-white">
            Nộp Các Bài Đã Chọn &amp; Đối Chiếu Kết Quả LMS
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {lastSubmissionSummary &&
            lastSubmissionSummary.retryStudentIds.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  handleApproveAndUpload(
                    lastSubmissionSummary.retryStudentIds,
                    true,
                    lastSubmissionSummary.sessionNumber
                  )
                }
                disabled={isAnyOperationBusy}
                className="flex items-center space-x-1.5 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-bold transition-colors cursor-pointer"
              >
                <RefreshCw
                  className={`w-4 h-4 ${uploading ? "animate-spin" : ""}`}
                />
                <span>
                  Thử lại {lastSubmissionSummary.retryStudentIds.length} bài chưa nộp — Buổi{" "}
                  {lastSubmissionSummary.sessionNumber}
                </span>
              </button>
            )}

          <button
            type="button"
            onClick={() =>
              handleApproveAndUpload(
                effectiveSelectedStudentIds,
                true,
                selectedSessionNumber
              )
            }
            disabled={
              isAnyOperationBusy ||
              !selectedClassId ||
              effectiveSelectedStudentIds.length === 0
            }
            className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold shadow-lg shadow-emerald-950/50 transition-colors cursor-pointer"
          >
            {uploading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <UploadCloud className="w-4 h-4" />
            )}
            <span>
              Nộp {effectiveSelectedStudentIds.length} bài — Buổi {selectedSessionNumber}
            </span>
          </button>
        </div>
      </div>

      {/* Detailed Batch Submission Result Card */}
      {lastSubmissionSummary && (
        <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
            <div className="font-bold text-white flex flex-wrap items-center gap-2">
              <span>
                📊 Kết quả đợt nộp Buổi {lastSubmissionSummary.sessionNumber} (Lúc{" "}
                {lastSubmissionSummary.completedAt}):
              </span>
              <span
                className={`px-2 py-0.5 rounded ${
                  lastSubmissionSummary.verifiedItems.length ===
                    lastSubmissionSummary.totalSelected &&
                  lastSubmissionSummary.failedItems.length === 0 &&
                  lastSubmissionSummary.skippedItems.length === 0
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-600"
                    : "bg-amber-500/20 text-amber-300 border border-amber-600"
                }`}
              >
                Đã nộp {lastSubmissionSummary.verifiedItems.length}/
                {lastSubmissionSummary.totalSelected} —{" "}
                {Math.max(
                  0,
                  lastSubmissionSummary.totalSelected -
                    lastSubmissionSummary.verifiedItems.length
                )}{" "}
                bài chưa nộp
              </span>
            </div>
            <button
              type="button"
              onClick={() => setLastSubmissionSummary(null)}
              className="text-slate-400 hover:text-slate-200 underline cursor-pointer"
            >
              Ẩn bảng kết quả
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Verified List */}
            <div className="p-3 rounded-lg bg-emerald-950/25 border border-emerald-800/60 space-y-1.5">
              <div className="font-bold text-emerald-300">
                ✅ Thành công ({lastSubmissionSummary.verifiedItems.length}/
                {lastSubmissionSummary.totalSelected})
              </div>
              {lastSubmissionSummary.verifiedItems.length === 0 ? (
                <div className="text-slate-500">Chưa có bài nào hoàn tất trong đợt này.</div>
              ) : (
                <ul className="space-y-1 text-emerald-200">
                  {lastSubmissionSummary.verifiedItems.map((item) => (
                    <li key={item.studentId}>
                      • {item.studentName} ({item.studentId})
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Skipped List */}
            <div className="p-3 rounded-lg bg-amber-950/25 border border-amber-800/60 space-y-1.5">
              <div className="font-bold text-amber-300">
                ⚠️ Bị bỏ qua ({lastSubmissionSummary.skippedItems.length})
              </div>
              {lastSubmissionSummary.skippedItems.length === 0 ? (
                <div className="text-slate-500">Không có bài nào bị bỏ qua.</div>
              ) : (
                <ul className="space-y-1 text-amber-200">
                  {lastSubmissionSummary.skippedItems.map((item) => (
                    <li key={item.studentId}>
                      • <strong>{item.studentName}:</strong> {item.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Failed List */}
            <div className="p-3 rounded-lg bg-rose-950/25 border border-rose-800/60 space-y-1.5">
              <div className="font-bold text-rose-300">
                ❌ Lỗi khi nộp ({lastSubmissionSummary.failedItems.length})
              </div>
              {lastSubmissionSummary.failedItems.length === 0 ? (
                <div className="text-slate-500">Không có bài nào gặp lỗi.</div>
              ) : (
                <ul className="space-y-1 text-rose-200">
                  {lastSubmissionSummary.failedItems.map((item) => (
                    <li key={item.studentId}>
                      • <strong>{item.studentName}:</strong> {item.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
