"use client";

import React from "react";
import { Loader2, Sparkles, UploadCloud } from "lucide-react";
import { COMPETENCY_ITEMS_UI } from "./types";
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
    expandedS14EvalIds,
    setExpandedS14EvalIds,
    isRoboticsClass,
    activeDemoScoreItems,
    handleSaveSession14EvalDraft,
    setSession14Evals,
  } = workflow;

  if (selectedSessionNumber !== 14 || !selectedClassId) {
    return null;
  }

  return (
    <div className="mindx-card-purple p-5 rounded-xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center space-x-2">
          <span className="mindx-badge-blue px-2.5 py-0.5 rounded-full text-xs font-bold">
            Bước 4 / 4 — Riêng Buổi 14 (Tổng kết cuối khóa)
          </span>
          <h2 className="text-sm font-bold text-white">
            Đánh Giá Tổng Kết Cuối Khóa, Điểm Demo &amp; Thư Từ MindX
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isAnyOperationBusy}
            onClick={handleImportDemoScores}
            className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold flex items-center space-x-1.5 shadow-sm cursor-pointer"
          >
            <span>
              {importingDemoScores
                ? "Đang đọc điểm..."
                : "📥 Đọc Điểm Demo từ File Chấm Điểm"}
            </span>
          </button>

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

      {/* Thanh đọc Điểm Demo từ file chấm điểm BGK */}
      {false && (
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
            onClick={handleImportDemoScores}
            className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
          >
            {importingDemoScores
              ? "Đang đọc điểm..."
              : "📥 Đọc Điểm Demo từ File Chấm Điểm"}
          </button>
        </div>
      )}

      {/* Danh sách đánh giá Buổi 14 của từng học viên */}
      <div className="space-y-2.5">
        {session14Evals.map((ev) => {
          const isExpanded = Boolean(expandedS14EvalIds[ev.studentId]);
          return (
            <div
              key={ev.studentId}
              className="rounded-xl bg-slate-950 border border-slate-800 border-l-4 border-l-slate-800 dark:border-l-indigo-500 shadow-sm overflow-hidden"
            >
              <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 bg-slate-900/60">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-sm font-bold text-white">{ev.fullName}</span>
                  <span className="px-2.5 py-0.5 rounded-full bg-indigo-950 border border-indigo-700/60 text-indigo-300 text-[11px] font-semibold">
                    Điểm Demo: {ev.demoTotalScore} / 5.0
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full bg-cyan-950 border border-cyan-700/60 text-cyan-300 text-[11px] font-semibold">
                    Điểm Năng lực [ĐNL]: {ev.competencyTotalScore} / 5.0
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                      ev.status === "VERIFIED"
                        ? "bg-emerald-950 border border-emerald-600/60 text-emerald-300"
                        : ev.status === "APPROVED"
                        ? "bg-teal-950 border border-teal-600/60 text-teal-300"
                        : ev.status === "FAILED"
                        ? "bg-rose-950 border border-rose-600/60 text-rose-300"
                        : "bg-slate-800 text-slate-300"
                    }`}
                  >
                    {ev.status === "VERIFIED"
                      ? "Đã lưu LMS ✓"
                      : ev.status === "APPROVED"
                      ? "Đã duyệt"
                      : ev.status === "FAILED"
                      ? "Lỗi lưu"
                      : ev.learnedFromMindx
                      ? "Chờ duyệt"
                      : "Chưa soạn"}
                  </span>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    disabled={isAnyOperationBusy}
                    onClick={() => handleGenerateSession14EvalAi([ev.studentId])}
                    className="mindx-dark-btn px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    ✨ AI Soạn riêng
                  </button>
                  <button
                    type="button"
                    disabled={isAnyOperationBusy}
                    onClick={() =>
                      handleApproveAndUploadSession14Eval([ev.studentId])
                    }
                    className="mindx-dark-btn px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    🚀 Đẩy lên LMS
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedS14EvalIds((prev) => ({
                        ...prev,
                        [ev.studentId]: !prev[ev.studentId],
                      }))
                    }
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
                  >
                    {isExpanded ? "Thu gọn ▲" : "Chi tiết Điểm & Thư 3 phần ▼"}
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="p-4 space-y-4 border-t border-slate-800 text-xs">
                  {/* 5 Tiêu chí Điểm Demo */}
                  <div>
                    <div className="font-semibold text-indigo-300 mb-2">
                      1. Điểm Demo ({isRoboticsClass ? "Thang Robotics" : "Thang Lập trình"} — Tổng: {ev.demoTotalScore} / 5.0 điểm)
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                      {activeDemoScoreItems.map((item) => (
                        <div
                          key={item.key}
                          className="p-2 rounded bg-slate-900 border border-slate-800 space-y-1"
                        >
                          <label className="block text-[11px] text-slate-400">
                            {item.label} (tối đa {item.max})
                          </label>
                          <input
                            type="number"
                            step="0.05"
                            min={0}
                            max={item.max}
                            value={ev.demoScores[item.key]}
                            onChange={(e) => {
                              const val = Number(e.target.value) || 0;
                              const nextDemo = {
                                ...ev.demoScores,
                                [item.key]: Math.min(
                                  item.max,
                                  Math.max(0, val)
                                ),
                              };
                              handleSaveSession14EvalDraft(ev.studentId, {
                                demoScores: nextDemo,
                              });
                            }}
                            className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-white text-xs font-mono"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 9 Tiêu chí Điểm Năng Lực [ĐNL] */}
                  <div>
                    <div className="font-semibold text-cyan-300 mb-2">
                      2. Điểm Năng Lực [ĐNL] (9 tiêu chí thang 1..5 — Trung bình: {ev.competencyTotalScore} / 5.0)
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      {COMPETENCY_ITEMS_UI.map((item) => (
                        <div
                          key={item.key}
                          className="p-2 rounded bg-slate-900 border border-slate-800 flex items-center justify-between gap-2"
                        >
                          <span className="text-[11px] text-slate-300">
                            {item.label}
                          </span>
                          <select
                            value={ev.competencyScores[item.key]}
                            onChange={(e) => {
                              const nextComp = {
                                ...ev.competencyScores,
                                [item.key]: Number(e.target.value) || 4,
                              };
                              handleSaveSession14EvalDraft(ev.studentId, {
                                competencyScores: nextComp,
                              });
                            }}
                            className="px-2 py-1 rounded bg-slate-950 border border-slate-700 text-cyan-300 text-xs font-bold"
                          >
                            {[1, 2, 3, 4, 5].map((score) => (
                              <option key={score} value={score}>
                                {score} điểm
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 3 Ô Thư từ MindX (+ Ô 4 Xếp hạng giải cho lớp Robotics) */}
                  <div className="space-y-3">
                    <div>
                      <label className="block font-semibold text-emerald-300 mb-1">
                        Phần 1: Learned From Mindx (Thư tổng kết khóa học &amp; Kết quả đánh giá)
                      </label>
                      <textarea
                        rows={10}
                        value={ev.learnedFromMindx}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSession14Evals((prev) =>
                            prev.map((it) =>
                              it.studentId === ev.studentId
                                ? { ...it, learnedFromMindx: val }
                                : it
                            )
                          );
                        }}
                        onBlur={() =>
                          handleSaveSession14EvalDraft(ev.studentId, {
                            learnedFromMindx: ev.learnedFromMindx,
                          })
                        }
                        className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-white text-xs leading-relaxed"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block font-semibold text-amber-300 mb-1">
                          Phần 2: Suggestions From Mindx (Lời khuyên cải thiện)
                        </label>
                        <textarea
                          rows={4}
                          value={ev.suggestionsFromMindx}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSession14Evals((prev) =>
                              prev.map((it) =>
                                it.studentId === ev.studentId
                                  ? { ...it, suggestionsFromMindx: val }
                                  : it
                              )
                            );
                          }}
                          onBlur={() =>
                            handleSaveSession14EvalDraft(ev.studentId, {
                              suggestionsFromMindx: ev.suggestionsFromMindx,
                            })
                          }
                          className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-white text-xs leading-relaxed"
                        />
                      </div>

                      <div>
                        <label className="block font-semibold text-sky-300 mb-1">
                          Phần 3: Future Direction (Định hướng khóa học tiếp theo)
                        </label>
                        <textarea
                          rows={4}
                          value={ev.futureDirection}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSession14Evals((prev) =>
                              prev.map((it) =>
                                it.studentId === ev.studentId
                                  ? { ...it, futureDirection: val }
                                  : it
                              )
                            );
                          }}
                          onBlur={() =>
                            handleSaveSession14EvalDraft(ev.studentId, {
                              futureDirection: ev.futureDirection,
                            })
                          }
                          className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-white text-xs leading-relaxed"
                        />
                      </div>
                    </div>

                    {isRoboticsClass && (
                      <div>
                        <label className="block font-semibold text-rose-300 mb-1">
                          Phần 4: Xếp hạng giải của học viên (Riêng lớp Robotics — Cột 2 LMS Buổi 14, Tùy chọn)
                        </label>
                        <input
                          type="text"
                          value={ev.awardRanking || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSession14Evals((prev) =>
                              prev.map((it) =>
                                it.studentId === ev.studentId
                                  ? { ...it, awardRanking: val }
                                  : it
                              )
                            );
                          }}
                          onBlur={() =>
                            handleSaveSession14EvalDraft(ev.studentId, {
                              awardRanking: ev.awardRanking || "",
                            })
                          }
                          placeholder="VD: Giải Nhất / Giải Sáng Tạo / Giải Thuyết Trình Ấn Tượng (Để trống nếu không điền)"
                          className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-white text-xs"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
