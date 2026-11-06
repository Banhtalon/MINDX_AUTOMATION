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
      slot.tone === "emerald" || slot.tone === "teal"
        ? "spck-pill-success"
        : slot.tone === "rose"
        ? "spck-pill-error"
        : slot.tone === "amber"
        ? "spck-pill-warning"
        : "spck-pill-neutral";
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
        className={`px-2 py-1 rounded-md text-[11px] leading-tight transition-all ${toneClass} ${
          isTarget
            ? "ring-2 ring-blue-500/70 font-semibold"
            : "opacity-75 hover:opacity-100"
        }`}
      >
        <div className="font-bold flex items-center justify-between gap-1">
          <span>B.{sessNum}</span>
          {isTarget && (
            <span className="text-[9px] uppercase px-1 rounded bg-blue-600/20 text-blue-300">
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
            className="mt-0.5 inline-flex items-center text-[10px] underline hover:opacity-80 cursor-pointer"
          >
            Xem bản đã nộp
          </button>
        )}
      </div>
    );
  };

  const rowContainerClass = hasRowSubmissionError
    ? "spck-clean-row-error"
    : !readiness.ready && !row.isConfirmedByTeacher
    ? "spck-clean-row-warning"
    : "spck-clean-row";

  return (
    <div className={`rounded-xl overflow-hidden ${rowContainerClass}`}>
      {/* Compact Summary Row */}
      <div className="p-3 grid grid-cols-1 lg:grid-cols-12 gap-3 items-center">
        {/* Col 1-4: Checkbox + Student Mapping + Single-line Neutral Resource Metadata */}
        <div className="lg:col-span-4 flex items-start space-x-2.5">
          <input
            type="checkbox"
            checked={isSelected}
            disabled={!row.assignedStudentId || isAnyOperationBusy}
            onChange={() => toggleSelectStudent(row.assignedStudentId)}
            className="mt-1.5 rounded border-slate-600 cursor-pointer"
            title="Chọn học viên này để nộp theo danh sách đã chọn"
          />
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
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
                className="px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-white text-xs font-semibold focus:outline-none focus:border-blue-500 max-w-[230px]"
              >
                <option value="">-- Ghép học viên --</option>
                {students.map((stu) => (
                  <option key={stu.studentId} value={stu.studentId}>
                    {stu.fullName} ({stu.studentId})
                  </option>
                ))}
              </select>

              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  row.matchScore === 1.0
                    ? "spck-pill-success"
                    : "spck-pill-warning"
                }`}
              >
                {row.matchScore === 1.0
                  ? "✓ Khớp 100%"
                  : `Khớp ${Math.round(row.matchScore * 100)}%`}
              </span>

              <label className="inline-flex items-center space-x-1 text-[11px] text-slate-300 cursor-pointer select-none">
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

            {/* Consolidated 1-Line Neutral Resource Summary (Replaces 6-7 competing neon badges) */}
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-400">
              <span className="font-mono text-slate-300 truncate max-w-[160px]" title={row.folderName}>
                📁 {row.folderName}
              </span>
              <span>•</span>
              <span title={readiness.thumbBadgeLabel}>
                🖼️ {readiness.thumbBadgeLabel}
              </span>
              <span>• {row.screenshots.length}/10 ảnh</span>
              <span>• {row.attachments.length}/10 file</span>
              {readiness.hasDirectUseLink && <span>• Mở dùng SP ✓</span>}
              {readiness.hasSourceStorageLink && <span>• Kho file/code ✓</span>}
              {readiness.hasYoutubeLink && <span>• YouTube ✓</span>}
            </div>
          </div>
        </div>

        {/* Col 5-8: Readiness Badge + Direct Teacher Comment Preview (Key UX Upgrade) */}
        <div className="lg:col-span-4 min-w-0 space-y-1.5 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`px-2 py-0.5 rounded font-semibold text-[11px] ${
                readiness.ready ? "spck-pill-success" : "spck-pill-warning"
              }`}
            >
              {readiness.ready
                ? "✓ Đủ điều kiện nộp (*)"
                : `Thiếu/Lỗi: ${readiness.missingItems.join(", ")}`}
            </span>

            {row.hasNewerSharedResources && (
              <span
                title="Kho tài nguyên chung vừa có ảnh hoặc đường dẫn mới. Bấm 'Chi tiết ▾' để đồng bộ vào bản nháp buổi này."
                className="spck-pill-primary px-2 py-0.5 rounded font-semibold text-[10px]"
              >
                🔄 Có tài nguyên mới
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
                className="spck-pill-primary px-2 py-0.5 rounded font-semibold text-[10px] cursor-pointer"
              >
                🏅 Demo: {studentEval14.demoTotalScore}/5.0 • ĐNL:{" "}
                {studentEval14.competencyTotalScore}/5.0 •{" "}
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

          {/* Direct 2-Line Teacher Comment Preview */}
          <div
            onClick={() => toggleExpandRow(rowKey)}
            title={
              row.teacherComment?.trim()
                ? `${row.teacherComment} (Bấm để mở Chi tiết chỉnh sửa)`
                : "Bấm để mở khung chỉnh sửa chi tiết nhận xét"
            }
            className="spck-clean-comment-preview px-2.5 py-1.5 rounded-md text-xs leading-snug line-clamp-2 cursor-pointer"
          >
            {row.teacherComment?.trim() ? (
              <span>💬 {row.teacherComment}</span>
            ) : (
              <span className="italic text-slate-400">
                Chưa có nhận xét Buổi {selectedSessionNumber} — bấm &ldquo;AI Soạn&rdquo; hoặc mở &ldquo;Chi tiết ▾&rdquo;
              </span>
            )}
          </div>
        </div>

        {/* Col 9-12: Session Statuses (12, 13, 14) + Error Retry + Expand Toggle */}
        <div className="lg:col-span-4 flex flex-wrap sm:flex-nowrap items-center justify-between lg:justify-end gap-2">
          <div className="grid grid-cols-3 gap-1.5 flex-1">
            {renderSlotPill(12, slot12)}
            {renderSlotPill(13, slot13)}
            {renderSlotPill(14, slot14)}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
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
                className="spck-pill-error px-2.5 py-1.5 rounded-lg disabled:opacity-40 text-xs font-bold cursor-pointer"
              >
                🔄 Thử lại B.{selectedSessionNumber}
              </button>
            )}

            <button
              type="button"
              onClick={() => toggleExpandRow(rowKey)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                isExpanded ? "spck-pill-primary" : "spck-pill-neutral"
              }`}
            >
              {isExpanded ? "Thu gọn ▴" : "Chi tiết ▾"}
            </button>
          </div>
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
          <div className="mx-3 mb-2.5 p-2 rounded-lg bg-amber-950/40 border border-amber-700/60 text-amber-200 text-xs space-y-1">
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
        <div className="p-4 border-t border-slate-800 bg-slate-900/70 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800 text-xs">
            <div className="flex flex-wrap items-center gap-2 text-slate-200">
              <span className="font-bold">
                Chỉnh sửa chi tiết Buổi {selectedSessionNumber} (
                {getStageMeta(selectedSessionNumber).stageTitle})
              </span>
              {selectedSessionNumber === 14 && (
                <div className="inline-flex items-center rounded-lg bg-slate-950 p-1 border border-slate-700 gap-1">
                  <button
                    type="button"
                    data-testid={`s14-row-tab-spck-${row.assignedStudentId || idx}`}
                    onClick={() =>
                      setRowActiveTab(row.assignedStudentId, "spck")
                    }
                    className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                      activeTab === "spck"
                        ? "spck-btn-primary"
                        : "text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    📦 Tab 1: Sản phẩm SPCK (Cột 3)
                  </button>
                  <button
                    type="button"
                    data-testid={`s14-row-tab-eval14-${row.assignedStudentId || idx}`}
                    onClick={() =>
                      setRowActiveTab(row.assignedStudentId, "eval14")
                    }
                    className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                      activeTab === "eval14"
                        ? "spck-btn-primary"
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
                  className="spck-btn-primary px-2.5 py-1 rounded text-xs font-semibold cursor-pointer"
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
                  className="spck-pill-warning px-2.5 py-1 rounded disabled:opacity-40 text-xs font-semibold cursor-pointer"
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
                  className="spck-pill-warning px-2.5 py-1 rounded disabled:opacity-40 text-xs font-semibold cursor-pointer"
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
                  className="spck-pill-warning px-2.5 py-1 rounded disabled:opacity-40 text-xs font-semibold cursor-pointer"
                >
                  {deployingWeb ? "Đang Up Web..." : "🔄 Thử lại Up Web Live"}
                </button>
              )}
            </div>
          </div>

          {activeTab === "spck" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Left Column: 1. Title, 2. Thumbnail & Attachments, 3. YouTube, 4. Related Links */}
            <div className="lg:col-span-5 space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                  <span className="font-semibold text-white">
                    1. Tiêu đề dự án * (Tối đa 100 ký tự)
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
                    Tiêu đề đang vượt quá 100 ký tự ({row.projectTitle.length}/100). Vui lòng rút gọn trước khi duyệt.
                  </p>
                )}
              </div>

              {/* 2. Ảnh bìa & Tài liệu đính kèm */}
              <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800 space-y-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-white">
                    2. Ảnh bìa (Thumbnail *) &amp; Tài liệu
                  </span>
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
                        className="spck-pill-warning inline-flex items-center space-x-1 px-2 py-0.5 rounded disabled:opacity-40 font-semibold cursor-pointer"
                      >
                        <ImageIcon className="w-3 h-3" />
                        <span>🔄 Thử lại Chụp App &amp; AI Chọn Thumb</span>
                      </button>
                    )}

                    <label className="spck-pill-neutral inline-flex items-center space-x-1 px-2 py-0.5 rounded font-semibold cursor-pointer">
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

                    <label className="spck-pill-neutral inline-flex items-center space-x-1 px-2 py-0.5 rounded font-semibold cursor-pointer">
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
                </div>

                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <div className="p-1.5 rounded bg-slate-900 border border-slate-800">
                    <div className="text-slate-400">Ảnh bìa *</div>
                    <div className="font-semibold text-white truncate">
                      {readiness.thumbBadgeLabel}
                    </div>
                  </div>
                  <div className="p-1.5 rounded bg-slate-900 border border-slate-800">
                    <div className="text-slate-400">Ảnh bổ sung</div>
                    <div className="font-semibold text-white">
                      {row.screenshots.length}/10 ảnh
                    </div>
                  </div>
                  <div className="p-1.5 rounded bg-slate-900 border border-slate-800">
                    <div className="text-slate-400">Đính kèm</div>
                    <div className="font-semibold text-white">
                      {row.attachments.length}/10 files
                    </div>
                  </div>
                </div>

                {row.screenshots.length > 0 && (
                  <div className="text-[11px] text-slate-400 truncate" title={row.screenshots.map((p) => p.split(/[\\/]/).pop()).join(", ")}>
                    <span className="text-slate-300 font-semibold">
                      Hình bổ sung ({row.screenshots.length}):
                    </span>{" "}
                    {row.screenshots
                      .map((p) => p.split(/[\\/]/).pop())
                      .join(", ")}
                  </div>
                )}
              </div>

              {/* 3. YouTube URLs */}
              <div>
                <label className="flex items-center space-x-1 text-xs text-slate-300 font-semibold mb-1">
                  <Video className="w-3.5 h-3.5 text-slate-400" />
                  <span>3. YouTube Video URLs (Tùy chọn, tối đa 5 link)</span>
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

              {/* 4. Related Links */}
              <div>
                <label className="flex items-center space-x-1 text-xs text-slate-300 font-semibold mb-1">
                  <Link2 className="w-3.5 h-3.5 text-slate-400" />
                  <span>
                    4. Đường dẫn liên quan (Tối đa 5: <code>Tên | https://...</code>)
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
                        className="spck-pill-neutral px-2 py-0.5 rounded"
                      >
                        {lnk.categoryLabel}: {lnk.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: 5. Quick Tags & 6. Teacher Comment */}
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
                          <span className="font-semibold text-white">
                            5. Thẻ đánh giá nhanh (Quick Tags)
                          </span>
                          <span className="spck-pill-neutral px-2 py-0.5 rounded-full text-[10px] font-semibold">
                            🏷️ {tagBundle.profile.trackBadgeLabel} • Buổi {selectedSessionNumber}
                          </span>
                        </div>
                        <label className="inline-flex items-center space-x-1.5 text-slate-300 cursor-pointer">
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
                        {visibleGroups.map((group, gIdx) => {
                          const headerColor =
                            group.tone === "emerald"
                              ? "text-emerald-300"
                              : group.tone === "amber"
                              ? "text-amber-300"
                              : "text-blue-300";
                          const activeBtnClass =
                            group.tone === "emerald"
                              ? "spck-pill-success"
                              : group.tone === "amber"
                              ? "spck-pill-warning"
                              : "spck-pill-primary";

                          return (
                            <div
                              key={group.id}
                              data-testid={
                                gIdx === 0
                                  ? "s5b-quick-tags-group-1-row1"
                                  : gIdx === 1
                                  ? "s5b-quick-tags-group-2-row2"
                                  : `s5b-quick-tags-group-${gIdx + 1}`
                              }
                              className="space-y-1"
                            >
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
                                  className="spck-pill-primary px-2 py-1 rounded text-xs transition-colors cursor-pointer"
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
                <label className="block text-xs text-slate-300 font-semibold mb-1">
                  Ghi chú riêng cho AI — Buổi {selectedSessionNumber} (Tùy chọn)
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
                    6. Bình luận của giáo viên * — Buổi {selectedSessionNumber} (
                    {getStageMeta(selectedSessionNumber).stageTitle})
                  </span>
                  {row.verifiedAt && (
                    <span className="text-emerald-400 flex items-center space-x-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Đã đối chiếu LMS: {row.verifiedAt}</span>
                    </span>
                  )}
                </div>
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
