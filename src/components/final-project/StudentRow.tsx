"use client";

import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Image as ImageIcon,
  Link2,
  Paperclip,
  Video,
} from "lucide-react";
import {
  COMPETENCY_ITEMS_UI,
  ScannedFolderUIItem,
} from "./types";
import {
  getSpckQuickTagGroups,
  isPresentationQuickTag,
} from "@/lib/spck/spck-quick-tags";
import {
  formatUiSessionTitle,
  getRowReadinessSummary,
  getSessionSlotDisplay,
  getStageMeta,
  SpckWorkflowController,
} from "./useSpckWorkflow";

export interface StudentRowProps {
  row: ScannedFolderUIItem;
  idx: number;
  workflow: SpckWorkflowController;
}

export function StudentRow({ row, idx, workflow }: StudentRowProps) {
  const {
    expandedRowKeys,
    setExpandedRowKeys,
    effectiveSelectedStudentIds,
    duplicateStudentIds,
    selectedSessionNumber,
    students,
    setSnapshotModalData,
    isAnyOperationBusy,
    toggleSelectStudent,
    setRows,
    persistRowDraft,
    handleApproveAndUpload,
    toggleExpandRow,
    handleSyncLatestResources,
    handleGenerateAiComments,
    handleUploadToGoogleDrive,
    uploadingDrive,
    isWebClassOrProduct,
    handleDeployWebToGithubPages,
    deployingWeb,
    selectedClassId,
    bumpRowDraftSeq,
    handleCaptureAppScreenshots,
    handleOwnerUploadImage,
    session14TagLabels,
    toolErrorsByStudent,
    expandedRowTabByStudent,
    setRowActiveTab,
    session14Evals,
    setSession14Evals,
    isRoboticsClass,
    activeDemoScoreItems,
    handleSaveSession14EvalDraft,
    handleGenerateSession14EvalAi,
    handleApproveAndUploadSession14Eval,
  } = workflow;

  const rowKey = row.folderPath || row.assignedStudentId || String(idx);
  const isExpanded = Boolean(expandedRowKeys[rowKey]);
  const activeTab: "spck" | "eval14" =
    selectedSessionNumber === 14
      ? expandedRowTabByStudent[row.assignedStudentId] || "spck"
      : "spck";
  const studentEval14 =
    selectedSessionNumber === 14 && row.assignedStudentId
      ? session14Evals.find((ev) => ev.studentId === row.assignedStudentId)
      : undefined;
  const rowToolErrors = row.assignedStudentId
    ? toolErrorsByStudent[row.assignedStudentId] || {}
    : {};
  const isSelected =
    Boolean(row.assignedStudentId) &&
    effectiveSelectedStudentIds.includes(row.assignedStudentId);
  const isDupeStudent =
    Boolean(row.assignedStudentId) &&
    duplicateStudentIds.has(row.assignedStudentId);
  const readiness = getRowReadinessSummary(row, duplicateStudentIds);
  const slot12 = getSessionSlotDisplay(row, 12);
  const slot13 = getSessionSlotDisplay(row, 13);
  const slot14 = getSessionSlotDisplay(row, 14);
  const activeSlot = getSessionSlotDisplay(row, selectedSessionNumber);
  const hasRowSubmissionError =
    activeSlot.tone === "rose" ||
    Boolean(row.errorMessage) ||
    (selectedSessionNumber === 14 && studentEval14?.status === "FAILED");

  const renderSlotPill = (
    sessNum: 12 | 13 | 14,
    slot: ReturnType<typeof getSessionSlotDisplay>
  ) => {
    const isTarget = selectedSessionNumber === sessNum;
    const toneClass =
      slot.tone === "emerald"
        ? "bg-emerald-950/80 border-emerald-600/70 text-emerald-300"
        : slot.tone === "teal"
        ? "bg-teal-950/80 border-teal-500/70 text-teal-200"
        : slot.tone === "rose"
        ? "bg-rose-950/80 border-rose-600/70 text-rose-300"
        : slot.tone === "amber"
        ? "bg-amber-950/80 border-amber-600/70 text-amber-300"
        : "bg-slate-950 border-slate-800 text-slate-400";
    const canViewSnapshot =
      slot.hasVerifiedEvidence ||
      slot.state === "UNKNOWN_LEGACY" ||
      slot.state === "CORRUPTED";
    const stuName =
      students.find((s) => s.studentId === row.assignedStudentId)?.fullName ||
      row.folderName ||
      row.assignedStudentId;
    return (
      <div
        key={sessNum}
        title={slot.detail}
        className={`px-2 py-1 rounded-md border text-[11px] leading-tight ${toneClass} ${
          isTarget ? "ring-1 ring-emerald-400/60" : ""
        }`}
      >
        <div className="font-bold flex items-center justify-between gap-1">
          <span>B.{sessNum}</span>
          {isTarget && (
            <span className="text-[9px] uppercase px-1 rounded bg-emerald-500/20 text-emerald-300">
              Đang chọn
            </span>
          )}
        </div>
        <div className="mt-0.5 font-medium truncate">{slot.label}</div>
        {canViewSnapshot && (
          <button
            type="button"
            onClick={() =>
              setSnapshotModalData({
                studentId: row.assignedStudentId,
                studentName: stuName,
                sessionNumber: sessNum,
                slot,
              })
            }
            className="mt-1 inline-flex items-center text-[10px] underline text-sky-300 hover:text-sky-200 cursor-pointer"
          >
            Xem bản đã nộp
          </button>
        )}
      </div>
    );
  };

  return (
    <div
      className={`rounded-xl border transition-all ${
        !readiness.ready && !row.isConfirmedByTeacher
          ? "bg-amber-950/15 border-amber-600/50"
          : readiness.ready
          ? "bg-slate-950/90 border-slate-800"
          : "bg-slate-950/60 border-slate-800/80"
      }`}
    >
      {/* Compact Summary Row */}
      <div className="p-3.5 grid grid-cols-1 lg:grid-cols-12 gap-3 items-center">
        {/* Col 1-4: Checkbox + Folder & Student Mapping */}
        <div className="lg:col-span-4 flex items-start space-x-2.5">
          <input
            type="checkbox"
            checked={isSelected}
            disabled={!row.assignedStudentId || isAnyOperationBusy}
            onChange={() => toggleSelectStudent(row.assignedStudentId)}
            className="mt-1 rounded border-slate-600 cursor-pointer"
            title="Chọn học viên này để nộp theo danh sách đã chọn"
          />
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-xs font-mono truncate max-w-[200px]">
                📁 {row.folderName}
              </span>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  row.matchScore === 1.0
                    ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                    : "bg-amber-950 text-amber-300 border border-amber-700"
                }`}
              >
                Khớp {Math.round(row.matchScore * 100)}%
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={row.assignedStudentId}
                disabled={isAnyOperationBusy}
                onChange={(e) => {
                  const newStuId = e.target.value;
                  const stu = students.find((s) => s.studentId === newStuId);
                  const updatedTitle = stu
                    ? formatUiSessionTitle(
                        `SPCK ${stu.fullName}`,
                        selectedSessionNumber,
                        stu.fullName
                      )
                    : row.projectTitle;
                  const overrides: Partial<ScannedFolderUIItem> = {
                    assignedStudentId: newStuId,
                    isConfirmedByTeacher: Boolean(newStuId),
                    projectTitle: updatedTitle,
                    isDirty: true,
                    status: "WAITING_APPROVAL",
                    contentHash: "",
                  };
                  setRows((prev) =>
                    prev.map((r, i) => (i === idx ? { ...r, ...overrides } : r))
                  );
                  persistRowDraft(row, overrides);
                }}
                className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-white text-xs focus:outline-none focus:border-emerald-500 max-w-full"
              >
                <option value="">-- Ghép học viên --</option>
                {students.map((stu) => (
                  <option key={stu.studentId} value={stu.studentId}>
                    {stu.fullName} ({stu.studentId})
                  </option>
                ))}
              </select>

              <label className="inline-flex items-center space-x-1 text-[11px] text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={row.isConfirmedByTeacher}
                  disabled={!row.assignedStudentId || isAnyOperationBusy}
                  onChange={(e) => {
                    const confirmed = e.target.checked;
                    const overrides: Partial<ScannedFolderUIItem> = {
                      isConfirmedByTeacher: confirmed,
                      isDirty: true,
                      status: "WAITING_APPROVAL",
                      contentHash: "",
                    };
                    setRows((prev) =>
                      prev.map((r, i) =>
                        i === idx ? { ...r, ...overrides } : r
                      )
                    );
                    persistRowDraft(row, overrides);
                  }}
                  className="rounded border-slate-600"
                />
                <span>Đúng HV</span>
              </label>
            </div>
          </div>
        </div>

        {/* Col 5-6: Thumbnail, Reusable Links & Readiness Status */}
        <div className="lg:col-span-3 space-y-1 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`px-2 py-0.5 rounded font-semibold text-[11px] ${
                readiness.ready
                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-600/50"
                  : "bg-amber-500/15 text-amber-300 border border-amber-600/50"
              }`}
            >
              {readiness.ready
                ? "Đủ điều kiện nộp (*)"
                : `Thiếu/Lỗi: ${readiness.missingItems.join(", ")}`}
            </span>
            {row.hasNewerSharedResources && (
              <span
                title="Kho tài nguyên chung vừa có ảnh hoặc đường dẫn mới. Bấm 'Chi tiết ▾' để đồng bộ vào bản nháp buổi này."
                className="px-2 py-0.5 rounded bg-sky-950/80 border border-sky-500/50 text-sky-300 font-semibold text-[10px]"
              >
                🔄 Có tài nguyên mới
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
            <span
              title={readiness.thumbBadgeLabel}
              className={
                readiness.isDefaultThumb
                  ? "text-amber-300"
                  : readiness.thumbAspect === "16:9"
                  ? "text-emerald-300"
                  : "text-slate-300"
              }
            >
              🖼️ {readiness.thumbBadgeLabel}
            </span>
            <span>• {row.screenshots.length}/10 ảnh</span>
            <span>• {row.attachments.length}/10 file</span>
            {readiness.hasDirectUseLink && (
              <span className="px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-700/60">
                Mở dùng SP ✓
              </span>
            )}
            {readiness.hasSourceStorageLink && (
              <span className="px-1.5 py-0.2 rounded bg-sky-950 text-sky-300 border border-sky-700/60">
                Kho file/code ✓
              </span>
            )}
            {readiness.hasYoutubeLink && (
              <span className="px-1.5 py-0.2 rounded bg-rose-950 text-rose-300 border border-rose-700/60">
                YouTube ✓
              </span>
            )}
            {selectedSessionNumber === 14 && studentEval14 && (
              <button
                type="button"
                onClick={() => {
                  setRowActiveTab(row.assignedStudentId, "eval14");
                  if (!isExpanded) {
                    setExpandedRowKeys((prev) => ({
                      ...prev,
                      [rowKey]: true,
                    }));
                  }
                }}
                title="Bấm để mở Tab 2: Điểm Demo, ĐNL & Thư 3 phần (Cột 2)"
                className="px-2 py-0.5 rounded bg-indigo-950/90 hover:bg-indigo-900 border border-indigo-600/60 text-indigo-200 font-semibold text-[10px] cursor-pointer"
              >
                🏅 Demo: {studentEval14.demoTotalScore}/5.0 • ĐNL: {studentEval14.competencyTotalScore}/5.0 •{" "}
                {studentEval14.status === "VERIFIED"
                  ? "Đã lưu Cột 2 ✓"
                  : studentEval14.status === "APPROVED"
                  ? "Đã duyệt Cột 2"
                  : studentEval14.status === "FAILED"
                  ? "Lỗi Cột 2"
                  : studentEval14.learnedFromMindx
                  ? "Chờ duyệt Cột 2"
                  : "Chưa soạn Thư"}
              </button>
            )}
          </div>
        </div>

        {/* Col 7-9: Separate Per-Session Status Columns (12, 13, 14) */}
        <div className="lg:col-span-3 grid grid-cols-3 gap-1.5">
          {renderSlotPill(12, slot12)}
          {renderSlotPill(13, slot13)}
          {renderSlotPill(14, slot14)}
        </div>

        {/* Col 10-12: Error Retry Button (only on error) + "Chi tiết" Toggle */}
        <div className="lg:col-span-2 flex items-center justify-end gap-1.5">
          {hasRowSubmissionError && (
            <button
              type="button"
              onClick={() =>
                row.assignedStudentId &&
                handleApproveAndUpload(
                  [row.assignedStudentId],
                  true,
                  selectedSessionNumber
                )
              }
              disabled={
                isAnyOperationBusy || !row.assignedStudentId || isDupeStudent
              }
              title={`Thử lại nộp học viên này cho Buổi ${selectedSessionNumber}`}
              className="px-2.5 py-1.5 rounded-lg bg-rose-600/90 hover:bg-rose-500 disabled:opacity-40 text-white text-xs font-semibold cursor-pointer"
            >
              🔄 Thử lại B.{selectedSessionNumber}
            </button>
          )}

          <button
            type="button"
            onClick={() => toggleExpandRow(rowKey)}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer transition-colors ${
              isExpanded
                ? "bg-slate-800 border-emerald-500/60 text-emerald-300"
                : "bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-200"
            }`}
          >
            {isExpanded ? "Thu gọn ▴" : "Chi tiết ▾"}
          </button>
        </div>
      </div>

      {/* Inline Warnings / Error Alerts (Always visible when present) */}
      {(() => {
        const visibleWarnings = row.warningReasons.filter(
          (w) =>
            !(row.isConfirmedByTeacher && w.includes("Độ khớp tên đạt"))
        );
        if (
          visibleWarnings.length === 0 &&
          !isDupeStudent &&
          !row.errorMessage
        ) {
          return null;
        }
        return (
          <div className="mx-3.5 mb-3 p-2.5 rounded-lg bg-amber-950/40 border border-amber-700/60 text-amber-200 text-xs space-y-1">
            {isDupeStudent && (
              <div className="flex items-center space-x-1.5 font-semibold text-rose-300">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  Cảnh báo trùng studentId: Học viên này đang được gán cho
                  nhiều thư mục khác nhau!
                </span>
              </div>
            )}
            {visibleWarnings.map((w, wIdx) => (
              <div key={wIdx} className="flex items-center space-x-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                <span>{w}</span>
              </div>
            ))}
            {row.errorMessage && (
              <div className="text-rose-300 font-medium">
                Lỗi gần nhất: {row.errorMessage}
              </div>
            )}
          </div>
        );
      })()}

      {/* Expandable Full Editor ("Chi tiết") */}
      {isExpanded && (
        <div className="p-4 border-t border-slate-800 bg-slate-900/70 space-y-4 rounded-b-xl">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800 text-xs">
            <div className="flex flex-wrap items-center gap-2 text-slate-300">
              <span className="font-bold">
                Chỉnh sửa chi tiết Buổi {selectedSessionNumber} (
                {getStageMeta(selectedSessionNumber).stageTitle}):
              </span>
              <span className="font-mono text-slate-400">
                {row.status} • v{row.draftVersion || 1}
                {row.contentHash ? ` • #${row.contentHash.slice(0, 8)}` : ""}
              </span>
              {selectedSessionNumber === 14 && (
                <div className="inline-flex items-center rounded-lg bg-slate-950 p-1 border border-slate-700 gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      setRowActiveTab(row.assignedStudentId, "spck")
                    }
                    className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                      activeTab === "spck"
                        ? "bg-emerald-600 text-white"
                        : "text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    📦 Tab 1: Sản phẩm SPCK (Cột 3)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setRowActiveTab(row.assignedStudentId, "eval14")
                    }
                    className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                      activeTab === "eval14"
                        ? "bg-indigo-600 text-white"
                        : "text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    🏅 Tab 2: Điểm Demo, ĐNL &amp; Thư 3 phần (Cột 2)
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {row.hasNewerSharedResources && (
                <button
                  type="button"
                  onClick={() => handleSyncLatestResources(row)}
                  disabled={isAnyOperationBusy}
                  className="px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold cursor-pointer"
                >
                  🔄 Dùng tài nguyên mới nhất
                </button>
              )}

              {(Boolean(rowToolErrors.ai) ||
                row.status === "INSUFFICIENT_INFO" ||
                row.status === "FAILED") && (
                <button
                  type="button"
                  onClick={() => handleGenerateAiComments([row.folderPath])}
                  disabled={isAnyOperationBusy || !row.assignedStudentId}
                  className="px-2.5 py-1 rounded bg-purple-600/85 hover:bg-purple-500 disabled:opacity-40 text-white text-xs font-medium cursor-pointer"
                >
                  🔄 Thử lại AI Nhận xét (B.{selectedSessionNumber})
                </button>
              )}

              {Boolean(rowToolErrors.drive) && (
                <button
                  type="button"
                  onClick={() =>
                    row.assignedStudentId &&
                    handleUploadToGoogleDrive([row.assignedStudentId])
                  }
                  disabled={
                    isAnyOperationBusy ||
                    !row.assignedStudentId ||
                    !row.folderPath
                  }
                  className="px-2.5 py-1 rounded bg-sky-600/85 hover:bg-sky-500 disabled:opacity-40 text-white text-xs font-medium cursor-pointer"
                >
                  {uploadingDrive
                    ? "Đang Up Drive..."
                    : "🔄 Thử lại Up Drive & Gắn Link"}
                </button>
              )}

              {isWebClassOrProduct && Boolean(rowToolErrors.web) && (
                <button
                  type="button"
                  onClick={() =>
                    row.assignedStudentId &&
                    handleDeployWebToGithubPages([row.assignedStudentId])
                  }
                  disabled={
                    isAnyOperationBusy ||
                    !row.assignedStudentId ||
                    !row.folderPath
                  }
                  className="px-2.5 py-1 rounded bg-indigo-600/85 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium cursor-pointer"
                >
                  {deployingWeb ? "Đang Up Web..." : "🔄 Thử lại Up Web Live"}
                </button>
              )}
            </div>
          </div>

          {activeTab === "spck" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Left Column: Title, Files Summary & Links */}
            <div className="lg:col-span-5 space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                  <span className="font-semibold text-white">
                    1. Tiêu đề dự án * (Tự gắn nhãn buổi, tối đa 100 ký tự)
                  </span>
                  <span
                    className={
                      row.projectTitle.length > 100
                        ? "text-rose-400 font-bold"
                        : "text-slate-400"
                    }
                  >
                    {row.projectTitle.length}/100
                  </span>
                </div>
                <input
                  type="text"
                  value={row.projectTitle}
                  onChange={(e) => {
                    const val = e.target.value;
                    bumpRowDraftSeq(
                      `${selectedClassId}::${row.folderPath || row.assignedStudentId}`
                    );
                    setRows((prev) =>
                      prev.map((r, i) =>
                        i === idx
                          ? {
                              ...r,
                              projectTitle: val,
                              isDirty: true,
                              status: "WAITING_APPROVAL",
                              contentHash: "",
                            }
                          : r
                      )
                    );
                  }}
                  onBlur={(e) => {
                    const stu = students.find(
                      (s) => s.studentId === row.assignedStudentId
                    );
                    const formatted = formatUiSessionTitle(
                      e.target.value,
                      selectedSessionNumber,
                      stu?.fullName
                    );
                    const overrides =
                      formatted !== row.projectTitle
                        ? { projectTitle: formatted }
                        : undefined;
                    if (overrides) {
                      setRows((prev) =>
                        prev.map((r, i) =>
                          i === idx ? { ...r, ...overrides } : r
                        )
                      );
                    }
                    persistRowDraft(row, overrides);
                  }}
                  className={`w-full px-3 py-1.5 rounded bg-slate-950 border text-white text-xs ${
                    row.projectTitle.length > 100
                      ? "border-rose-500"
                      : "border-slate-700"
                  }`}
                />
                {row.projectTitle.length > 100 && (
                  <p className="mt-1 text-[11px] text-rose-400 font-medium">
                    Tiêu đề đang vượt quá 100 ký tự ({row.projectTitle.length}/100). Vui lòng rút gọn tên sản phẩm trước khi duyệt.
                  </p>
                )}
                {readiness.isDefaultTitle && (
                  <p className="mt-1 text-[11px] text-amber-300/90">
                    💡 Đang dùng tên mặc định (SPCK + tên học viên). Giáo viên có thể nhập tên sản phẩm cụ thể hơn (vẫn cho phép duyệt nộp).
                  </p>
                )}
              </div>

              {/* Resource Counters */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="p-2 rounded bg-slate-950 border border-slate-800">
                  <div className="text-slate-400 flex items-center space-x-1">
                    <ImageIcon className="w-3.5 h-3.5 text-emerald-400" />
                    <span>3. Thumbnail *</span>
                  </div>
                  <div className="mt-1 font-semibold text-white truncate">
                    {readiness.thumbBadgeLabel}
                  </div>
                </div>

                <div className="p-2 rounded bg-slate-950 border border-slate-800">
                  <div className="text-slate-400 flex items-center space-x-1">
                    <ImageIcon className="w-3.5 h-3.5 text-cyan-400" />
                    <span>4. Ảnh bổ sung</span>
                  </div>
                  <div className="mt-1 font-semibold text-white">
                    {row.screenshots.length}/10 ảnh
                  </div>
                </div>

                <div className="p-2 rounded bg-slate-950 border border-slate-800">
                  <div className="text-slate-400 flex items-center space-x-1">
                    <Paperclip className="w-3.5 h-3.5 text-orange-400" />
                    <span>5. Đính kèm</span>
                  </div>
                  <div className="mt-1 font-semibold text-white">
                    {row.attachments.length}/10 files
                  </div>
                </div>
              </div>

              {/* App Screenshot Capture & Owner Image Upload Controls */}
              <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800 space-y-2 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  {Boolean(rowToolErrors.screenshot) && (
                    <button
                      type="button"
                      onClick={() =>
                        row.assignedStudentId &&
                        handleCaptureAppScreenshots([row.assignedStudentId])
                      }
                      disabled={
                        isAnyOperationBusy ||
                        !row.assignedStudentId ||
                        !row.folderPath
                      }
                      className="inline-flex items-center space-x-1 px-2.5 py-1 rounded bg-teal-600/85 hover:bg-teal-500 disabled:opacity-40 text-white font-semibold cursor-pointer"
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                      <span>🔄 Thử lại Chụp App &amp; AI Chọn Thumb</span>
                    </button>
                  )}

                  <label className="inline-flex items-center space-x-1 px-2.5 py-1 rounded bg-amber-600/80 hover:bg-amber-500 text-white font-semibold cursor-pointer">
                    <span>+ Owner Up Thumbnail</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        handleOwnerUploadImage(
                          row.assignedStudentId,
                          "thumbnail",
                          e.target.files
                        );
                        e.target.value = "";
                      }}
                    />
                  </label>

                  <label className="inline-flex items-center space-x-1 px-2.5 py-1 rounded bg-cyan-700/80 hover:bg-cyan-600 text-white font-semibold cursor-pointer">
                    <span>+ Owner Up Ô Dưới</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        handleOwnerUploadImage(
                          row.assignedStudentId,
                          "gallery",
                          e.target.files
                        );
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>

                <div className="text-[11px] text-slate-400">
                  Ưu tiên Thumbnail tỉ lệ <strong>16:9</strong> thể hiện rõ sản phẩm (Logo MindX chỉ dùng dự phòng khi chưa có ảnh). Ô 4 dùng cho ảnh chi tiết sản phẩm, thuyết trình hoặc hoạt động.
                </div>

                {row.screenshots.length > 0 && (
                  <div className="text-[11px] text-slate-400 leading-relaxed">
                    <span className="text-cyan-300 font-semibold">
                      Hình ở ô dưới ({row.screenshots.length}):
                    </span>{" "}
                    {row.screenshots
                      .map((p) => p.split(/[\\/]/).pop())
                      .join(", ")}
                  </div>
                )}
              </div>

              {/* YouTube URLs */}
              <div>
                <label className="flex items-center space-x-1 text-xs text-slate-400 mb-1">
                  <Video className="w-3.5 h-3.5 text-rose-400" />
                  <span>2. YouTube Video URLs (Tùy chọn, tối đa 5 link)</span>
                </label>
                <textarea
                  rows={2}
                  value={row.youtubeUrlsText}
                  onChange={(e) => {
                    const val = e.target.value;
                    bumpRowDraftSeq(
                      `${selectedClassId}::${row.folderPath || row.assignedStudentId}`
                    );
                    setRows((prev) =>
                      prev.map((r, i) =>
                        i === idx
                          ? {
                              ...r,
                              youtubeUrlsText: val,
                              isDirty: true,
                              status: "WAITING_APPROVAL",
                              contentHash: "",
                            }
                          : r
                      )
                    );
                  }}
                  onBlur={() => persistRowDraft(row)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-white text-xs font-mono"
                />
              </div>

              {/* Related Links */}
              <div>
                <label className="flex items-center space-x-1 text-xs text-slate-400 mb-1">
                  <Link2 className="w-3.5 h-3.5 text-cyan-400" />
                  <span>
                    6. Đường dẫn liên quan (Tùy chọn, tối đa 5:{" "}
                    <code>Tên | https://...</code>)
                  </span>
                </label>
                <textarea
                  rows={2}
                  value={row.relatedLinksText}
                  onChange={(e) => {
                    const val = e.target.value;
                    bumpRowDraftSeq(
                      `${selectedClassId}::${row.folderPath || row.assignedStudentId}`
                    );
                    setRows((prev) =>
                      prev.map((r, i) =>
                        i === idx
                          ? {
                              ...r,
                              relatedLinksText: val,
                              isDirty: true,
                              status: "WAITING_APPROVAL",
                              contentHash: "",
                            }
                          : r
                      )
                    );
                  }}
                  onBlur={() => persistRowDraft(row)}
                  placeholder="Web chạy thử | https://... hoặc Kho file Drive | https://..."
                  className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-white text-xs font-mono"
                />
                {readiness.classifiedLinks.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                    {readiness.classifiedLinks.map((lnk, lIdx) => (
                      <span
                        key={lIdx}
                        className={`px-2 py-0.5 rounded border ${
                          lnk.category === "DIRECT_PRODUCT_USE"
                            ? "bg-indigo-950/80 border-indigo-600/60 text-indigo-200"
                            : lnk.category === "SOURCE_OR_FILE_STORAGE"
                            ? "bg-sky-950/80 border-sky-600/60 text-sky-200"
                            : "bg-slate-950 border-slate-700 text-slate-300"
                        }`}
                      >
                        {lnk.categoryLabel}: {lnk.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Quick Tags, Presentation Guardrail & Teacher Comment */}
            <div className="lg:col-span-7 space-y-3">
              <div>
                {(() => {
                  const activeClassObj = workflow.classes.find(
                    (c) => c.classId === selectedClassId
                  );
                  const rowExts = (row.attachments || [])
                    .map((p) => {
                      const m = String(p || "").match(/\.[a-z0-9]+$/i);
                      return m ? m[0].toLowerCase() : "";
                    })
                    .filter(Boolean);
                  const tagBundle = getSpckQuickTagGroups({
                    classId: selectedClassId,
                    courseName: activeClassObj?.className,
                    sessionNumber: selectedSessionNumber,
                    customSession14Tags: session14TagLabels,
                    fileExtensions: rowExts,
                  });
                  const visibleGroups =
                    selectedSessionNumber !== 14 &&
                    row.includePresentation &&
                    tagBundle.optionalPresentationGroup
                      ? [...tagBundle.groups, tagBundle.optionalPresentationGroup]
                      : tagBundle.groups;
                  const visibleGroupTags = visibleGroups.flatMap((g) => g.tags);
                  const extraSelectedTags = row.quickTags.filter(
                    (t) => !visibleGroupTags.includes(t)
                  );

                  const handleToggleQuickTag = (tag: string) => {
                    const active = row.quickTags.includes(tag);
                    const nextTags = active
                      ? row.quickTags.filter((t) => t !== tag)
                      : [...row.quickTags, tag];
                    const nextIncludePresentation =
                      !active && isPresentationQuickTag(tag)
                        ? true
                        : row.includePresentation;
                    const overrides = {
                      quickTags: nextTags,
                      includePresentation: nextIncludePresentation,
                      isDirty: true,
                    };
                    setRows((prev) =>
                      prev.map((r, i) => (i === idx ? { ...r, ...overrides } : r))
                    );
                    persistRowDraft(row, overrides);
                  };

                  return (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 mb-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-slate-200">
                            Thẻ đánh giá nhanh (Quick Tags — hỗ trợ AI soạn bình luận)
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-indigo-950/80 border border-indigo-700/60 text-indigo-300 text-[10px] font-semibold">
                            🏷️ {tagBundle.profile.trackBadgeLabel} • Buổi {selectedSessionNumber}
                          </span>
                        </div>
                        <label className="inline-flex items-center space-x-1.5 text-emerald-400 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={row.includePresentation}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setRows((prev) =>
                                prev.map((r, i) =>
                                  i === idx
                                    ? { ...r, includePresentation: checked }
                                    : r
                                )
                              );
                            }}
                            className="rounded border-slate-600"
                          />
                          <span>Có đánh giá kỹ năng thuyết trình</span>
                        </label>
                      </div>

                      <div className="space-y-2 rounded-lg bg-slate-950/60 border border-slate-800/80 p-2.5">
                        {visibleGroups.map((group) => {
                          const headerColor =
                            group.tone === "emerald"
                              ? "text-emerald-300"
                              : group.tone === "amber"
                              ? "text-amber-300"
                              : group.tone === "violet"
                              ? "text-violet-300"
                              : "text-indigo-300";
                          const activeBtnClass =
                            group.tone === "emerald"
                              ? "bg-emerald-600/30 border border-emerald-500 text-emerald-100"
                              : group.tone === "amber"
                              ? "bg-amber-600/30 border border-amber-500 text-amber-100"
                              : group.tone === "violet"
                              ? "bg-purple-600/30 border border-purple-500 text-purple-100"
                              : "bg-indigo-600/30 border border-indigo-500 text-indigo-100";

                          return (
                            <div key={group.id} className="space-y-1">
                              <div className={`text-[11px] font-semibold ${headerColor}`}>
                                {group.title}
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {group.tags.map((tag) => {
                                  const active = row.quickTags.includes(tag);
                                  return (
                                    <button
                                      key={tag}
                                      type="button"
                                      onClick={() => handleToggleQuickTag(tag)}
                                      className={`px-2 py-1 rounded text-xs transition-colors cursor-pointer text-left ${
                                        active
                                          ? activeBtnClass
                                          : "bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200"
                                      }`}
                                    >
                                      {tag}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}

                        {extraSelectedTags.length > 0 && (
                          <div className="space-y-1 pt-1 border-t border-slate-800/70">
                            <div className="text-[11px] font-semibold text-slate-400">
                              📌 Thẻ đã chọn trước đó
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {extraSelectedTags.map((tag) => (
                                <button
                                  key={tag}
                                  type="button"
                                  onClick={() => handleToggleQuickTag(tag)}
                                  className="px-2 py-1 rounded text-xs transition-colors cursor-pointer bg-purple-600/30 border border-purple-500 text-purple-200"
                                >
                                  {tag}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Ghi chú riêng của Giáo viên cho AI — Buổi {selectedSessionNumber} (Tùy chọn)
                </label>
                <input
                  type="text"
                  value={row.teacherNote}
                  onChange={(e) => {
                    const val = e.target.value;
                    bumpRowDraftSeq(
                      `${selectedClassId}::${row.folderPath || row.assignedStudentId}`
                    );
                    setRows((prev) =>
                      prev.map((r, i) =>
                        i === idx
                          ? { ...r, teacherNote: val, isDirty: true }
                          : r
                      )
                    );
                  }}
                  onBlur={() => persistRowDraft(row)}
                  placeholder={getStageMeta(selectedSessionNumber).noteHint}
                  className="w-full px-3 py-1.5 rounded bg-slate-950 border border-slate-700 text-white text-xs"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                  <span className="font-semibold text-white">
                    7. Bình luận của giáo viên * — Buổi {selectedSessionNumber} (
                    {getStageMeta(selectedSessionNumber).stageTitle})
                  </span>
                  {row.verifiedAt && (
                    <span className="text-emerald-400 flex items-center space-x-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Đã đối chiếu LMS gần nhất: {row.verifiedAt}</span>
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mb-1.5">
                  📌 Yêu cầu giai đoạn: {getStageMeta(selectedSessionNumber).commentHint}
                </p>
                <textarea
                  rows={4}
                  value={row.teacherComment}
                  onChange={(e) => {
                    const val = e.target.value;
                    bumpRowDraftSeq(
                      `${selectedClassId}::${row.folderPath || row.assignedStudentId}`
                    );
                    setRows((prev) =>
                      prev.map((r, i) =>
                        i === idx
                          ? {
                              ...r,
                              teacherComment: val,
                              isDirty: true,
                              status: "WAITING_APPROVAL",
                              contentHash: "",
                            }
                          : r
                      )
                    );
                  }}
                  onBlur={() => persistRowDraft(row)}
                  placeholder={getStageMeta(selectedSessionNumber).commentHint}
                  className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-white text-xs leading-relaxed"
                />
              </div>
            </div>
          </div>
          )}

          {selectedSessionNumber === 14 && activeTab === "eval14" && (
            <div className="space-y-4 text-xs">
              {!studentEval14 ? (
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-slate-400">
                  Đang nạp dữ liệu Điểm Demo, Điểm Năng lực [ĐNL] &amp; Thư 3 phần Buổi 14 cho học viên này...
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-slate-950 border border-indigo-800/50">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-indigo-300">
                        🏅 Đánh giá Cột 2 Buổi 14 ({studentEval14.fullName}):
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full bg-indigo-950 border border-indigo-700/60 text-indigo-300 text-[11px] font-semibold">
                        Điểm Demo: {studentEval14.demoTotalScore} / 5.0
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full bg-cyan-950 border border-cyan-700/60 text-cyan-300 text-[11px] font-semibold">
                        Điểm Năng lực [ĐNL]: {studentEval14.competencyTotalScore} / 5.0
                      </span>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                          studentEval14.status === "VERIFIED"
                            ? "bg-emerald-950 border border-emerald-600/60 text-emerald-300"
                            : studentEval14.status === "APPROVED"
                            ? "bg-teal-950 border border-teal-600/60 text-teal-300"
                            : studentEval14.status === "FAILED"
                            ? "bg-rose-950 border border-rose-600/60 text-rose-300"
                            : "bg-slate-800 text-slate-300"
                        }`}
                      >
                        {studentEval14.status === "VERIFIED"
                          ? "Đã lưu LMS ✓"
                          : studentEval14.status === "APPROVED"
                          ? "Đã duyệt"
                          : studentEval14.status === "FAILED"
                          ? "Lỗi lưu"
                          : studentEval14.learnedFromMindx
                          ? "Chờ duyệt"
                          : "Chưa soạn"}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {(Boolean(rowToolErrors.s14_ai) ||
                        studentEval14.status === "INSUFFICIENT_INFO" ||
                        studentEval14.status === "FAILED") && (
                        <button
                          type="button"
                          disabled={isAnyOperationBusy}
                          onClick={() =>
                            handleGenerateSession14EvalAi([studentEval14.studentId])
                          }
                          className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                        >
                          🔄 Thử lại AI Thư 3 phần
                        </button>
                      )}
                      {studentEval14.status === "FAILED" && (
                        <button
                          type="button"
                          disabled={isAnyOperationBusy}
                          onClick={() =>
                            handleApproveAndUploadSession14Eval([
                              studentEval14.studentId,
                            ])
                          }
                          className="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                        >
                          🔄 Thử lại Đẩy Đánh giá B.14
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 5 Tiêu chí Điểm Demo */}
                  <div>
                    <div className="font-semibold text-indigo-300 mb-2">
                      1. Điểm Demo ({isRoboticsClass ? "Thang Robotics" : "Thang Lập trình"} — Tổng: {studentEval14.demoTotalScore} / 5.0 điểm)
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                      {activeDemoScoreItems.map((item) => (
                        <div
                          key={item.key}
                          className="p-2 rounded bg-slate-950 border border-slate-800 space-y-1"
                        >
                          <label className="block text-[11px] text-slate-400">
                            {item.label} (tối đa {item.max})
                          </label>
                          <input
                            type="number"
                            step="0.05"
                            min={0}
                            max={item.max}
                            value={studentEval14.demoScores[item.key]}
                            onChange={(e) => {
                              const val = Number(e.target.value) || 0;
                              const nextDemo = {
                                ...studentEval14.demoScores,
                                [item.key]: Math.min(
                                  item.max,
                                  Math.max(0, val)
                                ),
                              };
                              handleSaveSession14EvalDraft(
                                studentEval14.studentId,
                                {
                                  demoScores: nextDemo,
                                }
                              );
                            }}
                            className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-white text-xs font-mono"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 9 Tiêu chí Điểm Năng Lực [ĐNL] */}
                  <div>
                    <div className="font-semibold text-cyan-300 mb-2">
                      2. Điểm Năng Lực [ĐNL] (9 tiêu chí thang 1..5 — Trung bình: {studentEval14.competencyTotalScore} / 5.0)
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      {COMPETENCY_ITEMS_UI.map((item) => (
                        <div
                          key={item.key}
                          className="p-2 rounded bg-slate-950 border border-slate-800 flex items-center justify-between gap-2"
                        >
                          <span className="text-[11px] text-slate-300">
                            {item.label}
                          </span>
                          <select
                            value={studentEval14.competencyScores[item.key]}
                            onChange={(e) => {
                              const nextComp = {
                                ...studentEval14.competencyScores,
                                [item.key]: Number(e.target.value) || 4,
                              };
                              handleSaveSession14EvalDraft(
                                studentEval14.studentId,
                                {
                                  competencyScores: nextComp,
                                }
                              );
                            }}
                            className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-cyan-300 text-xs font-bold"
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
                        rows={8}
                        value={studentEval14.learnedFromMindx}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSession14Evals((prev) =>
                            prev.map((it) =>
                              it.studentId === studentEval14.studentId
                                ? {
                                    ...it,
                                    learnedFromMindx: val,
                                    status:
                                      it.status === "VERIFIED" ||
                                      it.status === "APPROVED"
                                        ? "WAITING_APPROVAL"
                                        : it.status,
                                    contentHash: "",
                                  }
                                : it
                            )
                          );
                        }}
                        onBlur={() =>
                          handleSaveSession14EvalDraft(studentEval14.studentId, {
                            learnedFromMindx: studentEval14.learnedFromMindx,
                          })
                        }
                        className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-white text-xs leading-relaxed"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block font-semibold text-amber-300 mb-1">
                          Phần 2: Suggestions From Mindx (Lời khuyên cải thiện)
                        </label>
                        <textarea
                          rows={4}
                          value={studentEval14.suggestionsFromMindx}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSession14Evals((prev) =>
                              prev.map((it) =>
                                it.studentId === studentEval14.studentId
                                  ? {
                                      ...it,
                                      suggestionsFromMindx: val,
                                      status:
                                        it.status === "VERIFIED" ||
                                        it.status === "APPROVED"
                                          ? "WAITING_APPROVAL"
                                          : it.status,
                                      contentHash: "",
                                    }
                                  : it
                              )
                            );
                          }}
                          onBlur={() =>
                            handleSaveSession14EvalDraft(
                              studentEval14.studentId,
                              {
                                suggestionsFromMindx:
                                  studentEval14.suggestionsFromMindx,
                              }
                            )
                          }
                          className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-white text-xs leading-relaxed"
                        />
                      </div>

                      <div>
                        <label className="block font-semibold text-sky-300 mb-1">
                          Phần 3: Future Direction (Định hướng khóa học tiếp theo)
                        </label>
                        <textarea
                          rows={4}
                          value={studentEval14.futureDirection}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSession14Evals((prev) =>
                              prev.map((it) =>
                                it.studentId === studentEval14.studentId
                                  ? {
                                      ...it,
                                      futureDirection: val,
                                      status:
                                        it.status === "VERIFIED" ||
                                        it.status === "APPROVED"
                                          ? "WAITING_APPROVAL"
                                          : it.status,
                                      contentHash: "",
                                    }
                                  : it
                              )
                            );
                          }}
                          onBlur={() =>
                            handleSaveSession14EvalDraft(
                              studentEval14.studentId,
                              {
                                futureDirection: studentEval14.futureDirection,
                              }
                            )
                          }
                          className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-white text-xs leading-relaxed"
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
                          value={studentEval14.awardRanking || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSession14Evals((prev) =>
                              prev.map((it) =>
                                it.studentId === studentEval14.studentId
                                  ? {
                                      ...it,
                                      awardRanking: val,
                                      status:
                                        it.status === "VERIFIED" ||
                                        it.status === "APPROVED"
                                          ? "WAITING_APPROVAL"
                                          : it.status,
                                      contentHash: "",
                                    }
                                  : it
                              )
                            );
                          }}
                          onBlur={() =>
                            handleSaveSession14EvalDraft(
                              studentEval14.studentId,
                              {
                                awardRanking: studentEval14.awardRanking || "",
                              }
                            )
                          }
                          placeholder="VD: Giải Nhất / Giải Sáng Tạo / Giải Thuyết Trình Ấn Tượng (Để trống nếu không điền)"
                          className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-white text-xs"
                        />
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
