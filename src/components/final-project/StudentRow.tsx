"use client";

import React, { useEffect, useMemo, useState } from "react";
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
  formatAwardBadgeMeta,
  formatUiSessionTitle,
  getRowReadinessSummary,
  getSessionSlotDisplay,
  getStageMeta,
  resolveStudentAwardLabel,
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
    handleSyncDriveThumbnails,
    syncingDriveThumbnails,
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
    isSpckExemptClass,
    activeDemoScoreItems,
    handleSaveSession14EvalDraft,
    handleGenerateSession14EvalAi,
    handleApproveAndUploadSession14Eval,
    refreshingStudentId,
    restoringBackupStudentId,
    handleRefreshSingleStudentAllInOne,
    handleRestorePortalBackup,
    session14AwardMap,
    skippedUnreadyByStudent,
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
  const assignedStudentMeta = row.assignedStudentId
    ? students.find((s) => s.studentId === row.assignedStudentId)
    : undefined;
  const isAbsentStudent =
    String(assignedStudentMeta?.attendanceStatus || "")
      .trim()
      .toUpperCase() === "ABSENT";
  const skippedUnreadyReason = row.assignedStudentId
    ? skippedUnreadyByStudent[row.assignedStudentId]
    : undefined;
  const awardLabel = studentEval14
    ? resolveStudentAwardLabel(studentEval14, session14AwardMap)
    : "";
  const awardBadge = formatAwardBadgeMeta(awardLabel);
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
  const hasDriveResource =
    /drive\.google\.com/i.test(row.relatedLinksText || "") ||
    readiness.hasSourceStorageLink;
  const hasWebLiveResource =
    /github\.io|vercel\.app|netlify\.app|replit|scratch\.mit\.edu|Link Web Chạy Thử/i.test(
      row.relatedLinksText || ""
    ) ||
    (isWebClassOrProduct && readiness.hasDirectUseLink);
  const hasSlideResource = Boolean(readiness.hasSlideResource);
  const hasMissingS14DemoScore =
    selectedSessionNumber === 14 &&
    !isSpckExemptClass &&
    Boolean(studentEval14) &&
    !(Number(studentEval14?.demoTotalScore || 0) > 0);
  const hasRowSubmissionError =
    activeSlot.tone === "rose" ||
    Boolean(row.errorMessage) ||
    (selectedSessionNumber === 14 && studentEval14?.status === "FAILED");
  const hasValidThumbnail = Boolean((row.thumbnailPath || "").trim());
  const hasRowResource = Boolean(
    hasValidThumbnail ||
      row.attachments.length > 0 ||
      row.screenshots.length > 0 ||
      hasDriveResource ||
      hasWebLiveResource ||
      hasSlideResource ||
      readiness.hasYoutubeLink
  );
  const hasRedMissingAlert =
    Boolean(skippedUnreadyReason) ||
    (isAbsentStudent && !hasRowResource) ||
    (!readiness.ready && activeSlot.state !== "VERIFIED_CURRENT") ||
    hasMissingS14DemoScore;

  const duplicateNameSet = useMemo(() => {
    const counts = new Map<string, number>();
    for (const stu of students || []) {
      const k = String(stu.fullName || "").trim().toLowerCase();
      if (k) counts.set(k, (counts.get(k) || 0) + 1);
    }
    const dupes = new Set<string>();
    for (const [k, cnt] of counts.entries()) {
      if (cnt > 1) dupes.add(k);
    }
    return dupes;
  }, [students]);

  const thumbInsp = row.thumbnailInspection;
  const [thumbLoadFailed, setThumbLoadFailed] = useState(false);

  useEffect(() => {
    setThumbLoadFailed(false);
  }, [row.thumbnailPath, thumbInsp?.previewDataUrl, row.draftVersion]);

  const thumbPreviewUrl =
    thumbInsp?.previewDataUrl ||
    (hasValidThumbnail && row.thumbnailPath
      ? `/api/spck/thumbnail?path=${encodeURIComponent(
          row.thumbnailPath
        )}&v=${encodeURIComponent(
          String(
            `${thumbInsp?.width || 0}x${thumbInsp?.height || 0}_${row.draftVersion || 0}`
          )
        )}`
      : "");

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
    const compactLabel =
      slot.state === "VERIFIED_CURRENT"
        ? "Đã nộp ✓"
        : slot.state === "VERIFIED_DRAFT_CHANGED" ||
          slot.state === "VERIFIED_FILE_DRIFT"
        ? "Đã nộp ✓*"
        : slot.state === "ABSENT_EXEMPT"
        ? "Vắng (Miễn)"
        : slot.state === "FAILED"
        ? "Lỗi nộp"
        : slot.label.replace(/\s*\(.*?\)\s*/g, "").trim() || slot.label;

    return (
      <div
        key={sessNum}
        data-testid={`spck-slot-pill-${sessNum}`}
        title={slot.detail}
        className={`w-[88px] sm:w-[96px] shrink-0 px-2 py-1.5 rounded-lg text-[11px] leading-tight transition-all ${toneClass} ${
          isTarget
            ? "ring-2 ring-blue-500 font-semibold shadow-xs"
            : "opacity-85 hover:opacity-100"
        }`}
      >
        <div className="font-extrabold flex items-center justify-between gap-1 whitespace-nowrap">
          <span>B.{sessNum}</span>
          {isTarget && (
            <span
              title="Buổi đang chọn"
              className="w-2 h-2 rounded-full bg-blue-600 shrink-0"
            />
          )}
        </div>
        <div className="mt-0.5 font-semibold truncate">{compactLabel}</div>
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
            className="mt-0.5 block text-left text-[10px] underline hover:opacity-80 cursor-pointer whitespace-nowrap truncate w-full"
          >
            Xem bản đã nộp
          </button>
        )}
      </div>
    );
  };

  const rowContainerClass =
    hasRowSubmissionError || Boolean(skippedUnreadyReason)
      ? "spck-clean-row-error"
      : !readiness.ready && !row.isConfirmedByTeacher
      ? "spck-clean-row-warning"
      : "spck-clean-row";

  const isMindxDefaultThumb =
    Boolean(thumbInsp?.isDefaultMindxLogo) ||
    /default-spck-thumbnail/i.test(row.thumbnailPath || "");
  const isShotThumb =
    Boolean(thumbInsp?.isAppGeneratedShot) ||
    /_spck_app_shots/i.test(row.thumbnailPath || "");
  const isOwnerThumb =
    Boolean(thumbInsp?.isOwnerUploaded) ||
    /_spck_owner_uploads/i.test(row.thumbnailPath || "");
  const isDriveOwnerThumb = /thumb_gdrive_/i.test(row.thumbnailPath || "");
  const thumbPreviewFitClass =
    isOwnerThumb && thumbInsp && !thumbInsp.is16By9
      ? "w-full h-full object-contain bg-slate-950"
      : "w-full h-full object-cover";

  const commentPreviewText =
    row.teacherComment?.trim() ||
    (selectedSessionNumber === 14 && studentEval14?.learnedFromMindx?.trim()
      ? `[Thư B14] ${studentEval14.learnedFromMindx.trim()}`
      : "");

  return (
    <div className={`rounded-xl overflow-hidden ${rowContainerClass}`}>
      {/* Compact Summary Row — Bố cục 3 vùng cân đối, không bao giờ ép hẹp ô B.12/B.13/B.14 */}
      <div className="p-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        {/* Vùng 1 (Trái): Checkbox + Ảnh bìa thật 16:9 + Học viên + Tên đề tài + Nhãn tài nguyên */}
        <div className="lg:w-[345px] xl:w-[375px] shrink-0 flex items-start gap-2.5 min-w-0">
          <input
            type="checkbox"
            checked={isSelected}
            disabled={!row.assignedStudentId || isAnyOperationBusy}
            onChange={() => toggleSelectStudent(row.assignedStudentId)}
            className="mt-2.5 rounded border-slate-500 cursor-pointer shrink-0"
            title="Chọn học viên này để nộp theo danh sách đã chọn"
          />

          {/* Ảnh bìa thật 16:9 (80x45px) */}
          <div
            onClick={() => toggleExpandRow(rowKey)}
            title={readiness.thumbBadgeLabel}
            className={`relative w-20 h-[45px] rounded-lg border overflow-hidden shrink-0 flex flex-col items-center justify-center text-[9px] font-bold leading-none select-none cursor-pointer ${
              !hasValidThumbnail
                ? "spck-pill-error"
                : "spck-pill-neutral"
            }`}
          >
            {thumbPreviewUrl && !thumbLoadFailed ? (
              <>
                <img
                  src={thumbPreviewUrl}
                  alt={row.projectTitle || "Thumbnail"}
                  loading="lazy"
                  onError={() => setThumbLoadFailed(true)}
                  className={thumbPreviewFitClass}
                />
                <span className="mindx-dark-keep absolute bottom-0 right-0 px-1 py-0.5 bg-slate-950/80 text-white text-[8px] font-bold rounded-tl">
                  {isDriveOwnerThumb
                    ? "Drive"
                    : isOwnerThumb
                    ? "Demo"
                    : isShotThumb
                    ? "16:9"
                    : isMindxDefaultThumb
                    ? "MindX"
                    : "SP"}
                </span>
              </>
            ) : !hasValidThumbnail ? (
              <>
                <span>⚠️</span>
                <span className="mt-0.5">Thiếu</span>
              </>
            ) : isOwnerThumb ? (
              <>
                <span>📸</span>
                <span className="mt-0.5">
                  {isDriveOwnerThumb ? "Drive" : "Demo"}
                </span>
              </>
            ) : isShotThumb ? (
              <>
                <span>🖥️</span>
                <span className="mt-0.5">16:9</span>
              </>
            ) : isMindxDefaultThumb ? (
              <>
                <span>🎯</span>
                <span className="mt-0.5">MindX</span>
              </>
            ) : (
              <>
                <span>🖼️</span>
                <span className="mt-0.5">Ảnh SP</span>
              </>
            )}
          </div>

          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-1.5 min-w-0">
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
                className="min-w-0 flex-1 max-w-[175px] px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-white text-xs font-bold focus:outline-none focus:border-blue-500"
              >
                <option value="">-- Ghép học viên --</option>
                {students.map((stu) => {
                  const isDupeName = duplicateNameSet.has(
                    String(stu.fullName || "").trim().toLowerCase()
                  );
                  return (
                    <option key={stu.studentId} value={stu.studentId}>
                      {isDupeName
                        ? `${stu.fullName} (${stu.studentId.slice(-6)})`
                        : stu.fullName}
                    </option>
                  );
                })}
              </select>

              <label className="inline-flex items-center space-x-1 text-[11px] text-slate-300 cursor-pointer select-none shrink-0">
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
                  className="rounded border-slate-500"
                />
                <span className="font-medium">Đúng HV</span>
              </label>

              {!row.isConfirmedByTeacher && row.matchScore === 1.0 && (
                <button
                  type="button"
                  disabled={!row.assignedStudentId || isAnyOperationBusy}
                  onClick={() => {
                    const overrides: Partial<ScannedFolderUIItem> = {
                      isConfirmedByTeacher: true,
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
                  className="spck-pill-warning px-2 py-0.5 rounded text-[10px] font-bold transition-colors cursor-pointer disabled:opacity-50"
                >
                  📥 Xác nhận HV
                </button>
              )}
            </div>

            {/* Tên đề tài cụ thể hiển thị nổi bật */}
            <div
              data-testid="spck-row-project-title"
              title={row.projectTitle || row.folderName}
              className="text-xs font-bold text-slate-100 truncate"
            >
              📌 {row.projectTitle || row.folderName}
            </div>

            {/* Nhãn tài nguyên rõ ràng: Drive ✓ • Web ✓ • Slide ✓ */}
            <div className="flex flex-wrap items-center gap-1 text-[10px]">
              {hasDriveResource && (
                <span className="px-1.5 py-0.5 rounded bg-emerald-950/70 border border-emerald-600/50 text-emerald-300 font-bold">
                  Drive ✓
                </span>
              )}
              {hasWebLiveResource && (
                <span className="px-1.5 py-0.5 rounded bg-sky-950/70 border border-sky-600/50 text-sky-300 font-bold">
                  Web ✓
                </span>
              )}
              {hasSlideResource && (
                <span className="px-1.5 py-0.5 rounded bg-indigo-950/70 border border-indigo-600/50 text-indigo-300 font-bold">
                  Slide ✓
                </span>
              )}
              {readiness.hasYoutubeLink && (
                <span className="px-1.5 py-0.5 rounded bg-rose-950/60 border border-rose-600/40 text-rose-200 font-bold">
                  YouTube ✓
                </span>
              )}
              <span className="text-slate-400">
                {row.screenshots.length} ảnh • {row.attachments.length} file
              </span>
            </div>
          </div>
        </div>

        {/* Vùng 2 (Giữa - Co giãn linh hoạt): Trạng thái đủ điều kiện + Nhãn Buổi 14 + 2 dòng nhận xét sạch */}
        <div className="flex-1 min-w-0 space-y-1.5 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            {hasRedMissingAlert ? (
              <span
                data-testid="spck-row-missing-alert"
                className="spck-pill-error px-2 py-0.5 rounded font-bold text-[11px]"
              >
                🚨{" "}
                {skippedUnreadyReason ||
                  (isAbsentStudent && !hasRowResource
                    ? "Vắng mặt / Chưa có bài"
                    : !readiness.ready
                    ? `Thiếu: ${readiness.missingItems.join(", ")}`
                    : "Thiếu Điểm Demo BGK")}
              </span>
            ) : (
              <span className="spck-pill-success px-2 py-0.5 rounded font-semibold text-[11px]">
                ✓ Đủ điều kiện nộp
              </span>
            )}

            {/* Ở Buổi 14: Hiện Danh hiệu Giải Nhất/Nhì/Ba (🥇/🥈/🥉) + Điểm BGK + Điểm ĐNL TB B5+9 */}
            {selectedSessionNumber === 14 && studentEval14 && (
              <>
                {awardBadge && (
                  <span
                    data-testid="s14-row-award-badge"
                    className={`px-2 py-0.5 rounded font-extrabold text-[10px] ${
                      awardBadge.tone === "gold"
                        ? "spck-award-gold"
                        : awardBadge.tone === "silver"
                        ? "spck-award-silver"
                        : awardBadge.tone === "bronze"
                        ? "spck-award-bronze"
                        : "spck-award-indigo"
                    }`}
                  >
                    {awardBadge.icon} {awardBadge.shortText}
                  </span>
                )}

                {!isSpckExemptClass && (
                  <button
                    type="button"
                    data-testid="s14-row-bgk-badge"
                    onClick={() => {
                      setRowActiveTab(row.assignedStudentId, "eval14");
                      if (!isExpanded) {
                        setExpandedRowKeys((prev) => ({
                          ...prev,
                          [rowKey]: true,
                        }));
                      }
                    }}
                    className={`px-2 py-0.5 rounded font-bold text-[10px] cursor-pointer ${
                      Number(studentEval14.demoTotalScore) > 0
                        ? "spck-pill-primary"
                        : "spck-pill-error"
                    }`}
                    title="Bấm để xem/sửa Điểm BGK & Thư 3 phần (Cột 2)"
                  >
                    📊 BGK: {studentEval14.demoTotalScore}/5.0
                  </button>
                )}

                <button
                  type="button"
                  data-testid="s14-row-dnl-badge"
                  onClick={() => {
                    setRowActiveTab(row.assignedStudentId, "eval14");
                    if (!isExpanded) {
                      setExpandedRowKeys((prev) => ({
                        ...prev,
                        [rowKey]: true,
                      }));
                    }
                  }}
                  className="spck-pill-neutral px-2 py-0.5 rounded font-semibold text-[10px] cursor-pointer"
                  title="Điểm Năng lực [ĐNL] trung bình cộng từ Buổi 5 + Buổi 9"
                >
                  🎯 ĐNL TB B5+9: {studentEval14.competencyTotalScore}/5.0
                </button>

                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    studentEval14.status === "VERIFIED"
                      ? "spck-pill-success"
                      : studentEval14.status === "FAILED"
                      ? "spck-pill-error"
                      : "spck-pill-neutral"
                  }`}
                >
                  {studentEval14.status === "VERIFIED"
                    ? "Cột 2 ✓"
                    : studentEval14.status === "FAILED"
                    ? "Lỗi Cột 2"
                    : studentEval14.learnedFromMindx
                    ? "Thư B14 ✓"
                    : "Chưa Thư B14"}
                </span>
              </>
            )}

            {row.hasNewerSharedResources && (
              <span
                title="Kho tài nguyên chung vừa có ảnh hoặc đường dẫn mới."
                className="spck-pill-primary px-2 py-0.5 rounded font-semibold text-[10px]"
              >
                🔄 Tài nguyên mới
              </span>
            )}
          </div>

          {/* 2 dòng xem trước nhận xét — tách padding ra thẻ ngoài để line-clamp-2 không bao giờ cắt lửng dòng 3 */}
          <div
            onClick={() => toggleExpandRow(rowKey)}
            title={
              commentPreviewText
                ? `${commentPreviewText} (Bấm để mở Chi tiết chỉnh sửa)`
                : "Bấm để mở khung chỉnh sửa chi tiết nhận xét"
            }
            className="spck-clean-comment-preview px-2.5 py-1.5 rounded-md text-xs cursor-pointer"
          >
            <div className="line-clamp-2 leading-snug whitespace-pre-line">
              {commentPreviewText ? (
                <span>💬 {commentPreviewText}</span>
              ) : (
                <span className="italic text-slate-400">
                  Chưa có nhận xét Buổi {selectedSessionNumber} — bấm &ldquo;2. AI Soạn nhận xét&rdquo; hoặc mở &ldquo;Chi tiết ▾&rdquo;
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Vùng 3 (Phải - Cố định kích thước): 3 ô B.12 / B.13 / B.14 rộng rãi + nút Chi tiết ▾ */}
        <div className="shrink-0 flex flex-wrap sm:flex-nowrap items-center justify-between lg:justify-end gap-2">
          <div className="grid grid-cols-3 gap-1.5 shrink-0">
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
                className="spck-pill-error px-2.5 py-1.5 rounded-lg disabled:opacity-40 text-xs font-bold cursor-pointer whitespace-nowrap"
              >
                🔄 Thử lại
              </button>
            )}

            <button
              type="button"
              onClick={() => toggleExpandRow(rowKey)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
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
                <div className="spck-clean-subbar inline-flex items-center rounded-lg p-1 gap-1">
                  <button
                    type="button"
                    data-testid={`s14-row-tab-spck-${row.assignedStudentId || idx}`}
                    onClick={() =>
                      setRowActiveTab(row.assignedStudentId, "spck")
                    }
                    className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                      activeTab === "spck"
                        ? "spck-btn-primary"
                        : "spck-pill-neutral hover:opacity-90"
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
                        : "spck-pill-neutral hover:opacity-90"
                    }`}
                  >
                    🏅 Tab 2: Điểm Demo, ĐNL &amp; Thư 3 phần (Cột 2)
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {row.assignedStudentId && row.folderPath && !isSpckExemptClass && (
                <button
                  type="button"
                  onClick={() =>
                    handleRefreshSingleStudentAllInOne(row.assignedStudentId)
                  }
                  disabled={isAnyOperationBusy || isDupeStudent}
                  title="Xóa cũ – Thêm mới trọn gói cho học viên này (Chụp lại hình 16:9 • Đẩy GitHub Live • Đóng gói .zip lên Drive)"
                  className="spck-pill-neutral px-2.5 py-1 rounded-md disabled:opacity-40 text-xs font-semibold cursor-pointer"
                >
                  {refreshingStudentId === row.assignedStudentId
                    ? "⏳ Đang làm mới..."
                    : "🔄 Làm mới trọn gói"}
                </button>
              )}

              {row.assignedStudentId && row.hasPortalBackup && (
                <button
                  type="button"
                  onClick={() =>
                    handleRestorePortalBackup(row.assignedStudentId)
                  }
                  disabled={isAnyOperationBusy}
                  title="Khôi phục lại bản nộp trước đó từ kho dự phòng trên máy thầy"
                  className="spck-pill-warning px-2.5 py-1 rounded-md disabled:opacity-40 text-xs font-semibold cursor-pointer"
                >
                  {restoringBackupStudentId === row.assignedStudentId
                    ? "⏳ Đang khôi phục..."
                    : "⏪ Khôi phục bản trước"}
                </button>
              )}

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

              {Boolean(rowToolErrors.thumb_drive) && (
                <button
                  type="button"
                  onClick={() =>
                    row.assignedStudentId &&
                    handleSyncDriveThumbnails([row.assignedStudentId], {
                      forceRedownload: true,
                    })
                  }
                  disabled={isAnyOperationBusy || !row.assignedStudentId}
                  className="spck-pill-warning px-2.5 py-1 rounded disabled:opacity-40 text-xs font-semibold cursor-pointer"
                >
                  {syncingDriveThumbnails
                    ? "Đang tải Ảnh Drive..."
                    : "🔄 Thử lại Ảnh bìa Drive"}
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
                      `${selectedClassId}::S${selectedSessionNumber}::${row.folderPath || row.assignedStudentId}`
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

                <div className="flex items-center gap-2.5">
                  {thumbPreviewUrl && !thumbLoadFailed && (
                    <div className="w-28 h-16 rounded-lg border border-slate-700 overflow-hidden shrink-0 bg-slate-900">
                      <img
                        src={thumbPreviewUrl}
                        alt={row.projectTitle || "Thumbnail preview"}
                        onError={() => setThumbLoadFailed(true)}
                        className={thumbPreviewFitClass}
                      />
                    </div>
                  )}
                  <div className="flex-1 min-w-0 grid grid-cols-3 gap-2 text-[11px]">
                    <div className="p-1.5 rounded bg-slate-900 border border-slate-800">
                      <div className="text-slate-400">Ảnh bìa *</div>
                      <div
                        className="font-semibold text-white truncate"
                        title={readiness.thumbBadgeLabel}
                      >
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
                      `${selectedClassId}::S${selectedSessionNumber}::${row.folderPath || row.assignedStudentId}`
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
                      `${selectedClassId}::S${selectedSessionNumber}::${row.folderPath || row.assignedStudentId}`
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
                      `${selectedClassId}::S${selectedSessionNumber}::${row.folderPath || row.assignedStudentId}`
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
                  rows={9}
                  value={row.teacherComment}
                  onChange={(e) => {
                    const val = e.target.value;
                    bumpRowDraftSeq(
                      `${selectedClassId}::S${selectedSessionNumber}::${row.folderPath || row.assignedStudentId}`
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
                      <div className="space-y-2 rounded-lg border border-rose-500/30 bg-rose-950/20 p-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label className="font-semibold text-rose-300">
                            Phần 4: Xếp hạng học viên trên lớp (Robotics Buổi 14 — Số 0..5 & Nhận xét Demo)
                          </label>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-slate-300">Số thứ hạng LMS (0..5):</span>
                            <select
                              data-testid="s14-robotics-rank-grade"
                              value={
                                studentEval14.awardRankGrade !== undefined &&
                                studentEval14.awardRankGrade !== null
                                  ? String(studentEval14.awardRankGrade)
                                  : ""
                              }
                              onChange={(e) => {
                                const raw = e.target.value;
                                const nextGrade = raw === "" ? null : Number(raw);
                                setSession14Evals((prev) =>
                                  prev.map((it) =>
                                    it.studentId === studentEval14.studentId
                                      ? {
                                          ...it,
                                          awardRankGrade: nextGrade,
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
                                handleSaveSession14EvalDraft(
                                  studentEval14.studentId,
                                  {
                                    awardRankGrade: nextGrade,
                                  }
                                );
                              }}
                              className="px-2 py-1 rounded bg-slate-950 border border-slate-700 text-white text-xs"
                            >
                              <option value="">
                                Tự động ({studentEval14.effectiveAwardRankGrade ?? 5})
                              </option>
                              <option value="1">1 — Giải Nhất</option>
                              <option value="2">2 — Giải Nhì</option>
                              <option value="3">3 — Giải Ba</option>
                              <option value="5">5 — Hoàn thành / Khuyến khích</option>
                              <option value="0">0 — Vắng mặt</option>
                            </select>
                          </div>
                        </div>
                        <textarea
                          rows={3}
                          data-testid="s14-robotics-award-text"
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
                          placeholder="VD: Giải Nhất (4.25/5.0 điểm) hoặc nhập đầy đủ 3 gạch đầu dòng Điểm mạnh / Điểm cần cải thiện / Lời khuyên..."
                          className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-white text-xs leading-relaxed"
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
