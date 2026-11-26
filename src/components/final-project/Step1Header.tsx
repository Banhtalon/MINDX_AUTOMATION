"use client";

import React from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ExternalLink,
  FolderOpen,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";
import { ClassPicker } from "@/components/class-picker";
import { getStageMeta, SpckWorkflowController } from "./useSpckWorkflow";

export interface Step1HeaderProps {
  workflow: SpckWorkflowController;
}

export function Step1Header({ workflow }: Step1HeaderProps) {
  const {
    selectedClassId,
    classes,
    handleClassChange,
    handleScanTeacherClasses,
    scanningTeacherClasses,
    isAnyOperationBusy,
    selectedSessionNumber,
    handleSessionChange,
    folderPathInput,
    setFolderPathInput,
    showFolderEditor,
    setShowFolderEditor,
    handleBrowseFolder,
    browsingFolder,
    demoScoreSourceInput,
    setDemoScoreSourceInput,
    generatedDemoSheetUrl,
    isSpckExemptClass,
    studentPortalRunning,
    mainSyncRunning,
    scanning,
    generatingAi,
    generatingS14EvalAi,
    mainStep3Running,
    uploading,
    uploadingS14EvalLms,
    session14ComboStatus,
    autoPrepStepProgress,
    rows,
    session14Evals,
    effectiveSelectedStudentIds,
    handleMainStep1Sync,
    handleMainStep2Ai,
    handleMainStep3SubmitAll,
  } = workflow;

  const displayFolder =
    folderPathInput.trim() ||
    (selectedClassId
      ? `D:\\MINDX DATA\\MINDX_SPCK_FINAL\\${selectedClassId}`
      : "Chưa chọn lớp");

  const effectiveDemoUrl = (
    demoScoreSourceInput ||
    generatedDemoSheetUrl ||
    ""
  ).trim();
  const isDemoUrlHttp = /^https?:\/\//i.test(effectiveDemoUrl);

  const isStep1Busy =
    mainSyncRunning || scanning || Boolean(autoPrepStepProgress);
  const isStep2Busy = generatingAi || generatingS14EvalAi;
  const isStep3Busy =
    mainStep3Running ||
    uploading ||
    uploadingS14EvalLms ||
    session14ComboStatus.running;

  const hasDataForStep2 =
    selectedSessionNumber === 14
      ? rows.length > 0 || session14Evals.length > 0 || isSpckExemptClass
      : rows.length > 0;

  const hasDataForStep3 =
    selectedSessionNumber === 14
      ? rows.length > 0 || session14Evals.length > 0
      : rows.length > 0;

  const step1SubLabel = studentPortalRunning
    ? "Đóng Cổng HS → Quét bài & Drive"
    : selectedSessionNumber === 14
    ? isSpckExemptClass
      ? "Nạp [ĐNL] trung bình B5+9"
      : "Quét bài, Drive, BGK & [ĐNL]"
    : "Quét bài, ảnh bìa & Up Drive";

  const step2SubLabel =
    selectedSessionNumber === 14
      ? "Nhận xét + Thư 3 phần + Summary"
      : "Đề tài & nhận xét cả lớp";

  const step3SubLabel =
    selectedSessionNumber === 12
      ? "Đẩy LMS B12 & Teaching 60%"
      : selectedSessionNumber === 13
      ? "Đẩy LMS B13 & Teaching 80%"
      : "Đẩy LMS B14, Teaching 100% & Điểm";

  return (
    <div className="spck-clean-card rounded-2xl overflow-hidden">
      {/* Thanh chọn Lớp + Buổi + Link BGK (khi Buổi 14) siêu gọn */}
      <div className="p-4 space-y-3.5">
        <div
          className={`grid grid-cols-1 gap-3 items-start ${
            selectedSessionNumber === 14
              ? "lg:grid-cols-12"
              : "lg:grid-cols-12"
          }`}
        >
          {/* Chọn Lớp học */}
          <div
            className={
              selectedSessionNumber === 14 ? "lg:col-span-4" : "lg:col-span-6"
            }
          >
            <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wide mb-1.5">
              Lớp học (Buổi ≥ 12)
            </label>
            <ClassPicker
              scope="spck"
              variant="card"
              autoRestore={false}
              value={selectedClassId}
              classes={classes}
              onChange={(code) => {
                void handleClassChange(code);
              }}
              onRefresh={handleScanTeacherClasses}
              isRefreshing={scanningTeacherClasses}
              disabled={isAnyOperationBusy}
              allowManualInput={false}
              showRefreshButton={false}
              placeholderOption="-- Chọn lớp đủ điều kiện (Buổi ≥ 12) --"
            />
          </div>

          {/* Chọn Buổi 12 / 13 / 14 */}
          <div
            className={
              selectedSessionNumber === 14 ? "lg:col-span-3" : "lg:col-span-6"
            }
          >
            <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wide mb-1.5">
              Buổi nộp ({getStageMeta(selectedSessionNumber).stageShort})
            </label>
            <div className="spck-clean-subbar grid grid-cols-3 gap-1.5 p-1 rounded-lg">
              {([12, 13, 14] as const).map((sessNum) => {
                const isSelected = selectedSessionNumber === sessNum;
                return (
                  <button
                    key={sessNum}
                    type="button"
                    disabled={isAnyOperationBusy}
                    onClick={() => handleSessionChange(sessNum)}
                    className={`py-2 px-2 rounded-md text-xs font-bold transition-all cursor-pointer disabled:opacity-50 ${
                      isSelected
                        ? "spck-btn-primary shadow-sm"
                        : "spck-pill-neutral hover:opacity-90"
                    }`}
                  >
                    Buổi {sessNum}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Khi chọn Buổi 14: Hiện ngay cạnh 1 ô Link Bảng chấm điểm Giám khảo */}
          {selectedSessionNumber === 14 && (
            <div className="lg:col-span-5">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label className="block text-[11px] font-bold text-amber-300 uppercase tracking-wide">
                  📊 Link Bảng chấm điểm Giám khảo (Buổi 14)
                </label>
                {generatedDemoSheetUrl &&
                  demoScoreSourceInput.trim() ===
                    generatedDemoSheetUrl.trim() && (
                    <span className="text-[10px] text-emerald-300 font-semibold">
                      ✓ Đã tự điền bảng của lớp
                    </span>
                  )}
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  data-testid="s14-header-demo-sheet-input"
                  value={demoScoreSourceInput}
                  onChange={(e) => setDemoScoreSourceInput(e.target.value)}
                  disabled={isAnyOperationBusy}
                  placeholder={
                    isSpckExemptClass
                      ? "Lớp PTB / CSB được miễn điểm Demo BGK"
                      : "Dán link Google Sheet chấm điểm BGK hoặc đường dẫn .xlsx..."
                  }
                  className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-amber-600/60 text-white text-xs focus:outline-none focus:border-amber-500 disabled:opacity-60"
                />
                {isDemoUrlHttp && (
                  <a
                    href={effectiveDemoUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Mở Bảng chấm điểm Giám khảo trong tab mới"
                    className="spck-pill-neutral shrink-0 inline-flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs font-semibold hover:opacity-90"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Mở</span>
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Nhãn gọn hiển thị thư mục hiện tại + nút nhỏ "📁 Đổi thư mục" */}
        <div className="spck-clean-subbar flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-xs">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="text-slate-400 shrink-0 font-medium">Thư mục bài làm:</span>
            <code
              className="text-slate-200 font-mono text-[11px] font-semibold truncate max-w-[520px]"
              title={displayFolder}
            >
              {displayFolder}
            </code>
            {isSpckExemptClass && (
              <span className="spck-pill-warning px-2 py-0.5 rounded text-[10px] font-semibold">
                Khóa PTB / CSB (Miễn nộp SPCK &amp; Demo)
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Link
              href={
                selectedClassId
                  ? `/demo-day?classId=${encodeURIComponent(selectedClassId)}`
                  : "/demo-day"
              }
              data-testid="spck-open-demo-day-link"
              className="spck-pill-neutral shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold cursor-pointer hover:opacity-90"
            >
              <span>🎤 Thi Demo</span>
            </Link>
            <button
              type="button"
              data-testid="spck-toggle-folder-editor-btn"
              disabled={isAnyOperationBusy}
              onClick={() => setShowFolderEditor((v) => !v)}
              className="spck-pill-neutral shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold cursor-pointer disabled:opacity-50"
            >
              <span>{showFolderEditor ? "Ẩn ô thư mục ▴" : "📁 Đổi thư mục"}</span>
            </button>
          </div>
        </div>

        {/* Ô nhập đường dẫn dài chỉ bung ra khi giáo viên bấm "📁 Đổi thư mục" */}
        {showFolderEditor && (
          <div className="spck-clean-subbar flex items-center gap-2 p-2.5 rounded-lg">
            <input
              type="text"
              value={folderPathInput}
              onChange={(e) => setFolderPathInput(e.target.value)}
              disabled={isAnyOperationBusy}
              placeholder="VD: D:\MINDX DATA\MINDX_SPCK_FINAL\VT-C4K-PTA12"
              className="flex-1 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-blue-500 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={handleBrowseFolder}
              disabled={isAnyOperationBusy}
              title="Mở cửa sổ chọn thư mục trên máy tính"
              className="spck-pill-neutral shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg disabled:opacity-50 font-semibold text-xs cursor-pointer"
            >
              {browsingFolder ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FolderOpen className="w-3.5 h-3.5" />
              )}
              <span>Chọn...</span>
            </button>
          </div>
        )}

        {/* THANH HÀNH ĐỘNG CHÍNH CỐ ĐỊNH 3 NÚT LỚN (1 -> 2 -> 3) DÙNG CHUNG BUỔI 12, 13, 14 */}
        <div className="pt-2 border-t border-slate-800/90 space-y-2.5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* NÚT 1: 1. Đồng bộ bài làm */}
            <button
              type="button"
              data-testid="spck-main-step1-sync"
              onClick={() => void handleMainStep1Sync()}
              disabled={isAnyOperationBusy || !selectedClassId}
              className="spck-step-card-blue group relative flex flex-col items-start justify-between p-3.5 rounded-xl transition-all text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="flex items-center justify-between w-full gap-2">
                <span className="spck-step-title inline-flex items-center gap-2 text-sm font-extrabold">
                  {isStep1Busy ? (
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  ) : (
                    <RefreshCw className="w-4 h-4 shrink-0" />
                  )}
                  <span>1. Đồng bộ bài làm</span>
                </span>
                {studentPortalRunning && (
                  <span className="spck-pill-warning px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0">
                    Tự đóng Cổng
                  </span>
                )}
              </div>
              <span className="spck-step-sub mt-1.5 text-[11px] leading-snug font-medium">
                {step1SubLabel}
              </span>
            </button>

            {/* NÚT 2: 2. AI Soạn nhận xét */}
            <button
              type="button"
              data-testid="spck-main-step2-ai"
              onClick={() => void handleMainStep2Ai()}
              disabled={
                isAnyOperationBusy || !selectedClassId || !hasDataForStep2
              }
              className="spck-step-card-indigo group relative flex flex-col items-start justify-between p-3.5 rounded-xl transition-all text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="flex items-center justify-between w-full gap-2">
                <span className="spck-step-title inline-flex items-center gap-2 text-sm font-extrabold">
                  {isStep2Busy ? (
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  ) : (
                    <Sparkles className="w-4 h-4 shrink-0" />
                  )}
                  <span>2. AI Soạn nhận xét</span>
                </span>
                <span className="spck-pill-primary px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0">
                  Buổi {selectedSessionNumber}
                </span>
              </div>
              <span className="spck-step-sub mt-1.5 text-[11px] leading-snug font-medium">
                {step2SubLabel}
              </span>
            </button>

            {/* NÚT 3: 3. Duyệt & Nộp tất cả */}
            <button
              type="button"
              data-testid="spck-main-step3-submit"
              onClick={() => void handleMainStep3SubmitAll()}
              disabled={
                isAnyOperationBusy || !selectedClassId || !hasDataForStep3
              }
              className="spck-step-card-emerald group relative flex flex-col items-start justify-between p-3.5 rounded-xl transition-all text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="flex items-center justify-between w-full gap-2">
                <span className="spck-step-title inline-flex items-center gap-2 text-sm font-extrabold">
                  {isStep3Busy ? (
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  ) : (
                    <Send className="w-4 h-4 shrink-0" />
                  )}
                  <span>3. Duyệt &amp; Nộp tất cả</span>
                </span>
                {effectiveSelectedStudentIds.length > 0 && (
                  <span className="spck-pill-success inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>{effectiveSelectedStudentIds.length} HV</span>
                  </span>
                )}
              </div>
              <span className="spck-step-sub mt-1.5 text-[11px] leading-snug font-medium">
                {step3SubLabel}
              </span>
            </button>
          </div>

          {autoPrepStepProgress && (
            <div className="spck-pill-warning flex items-center gap-2 px-3 py-1.5 rounded-lg">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span
                data-testid="s5b-auto-prep-progress"
                className="text-xs font-semibold"
              >
                {autoPrepStepProgress}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
