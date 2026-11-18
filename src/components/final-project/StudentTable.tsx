"use client";

import React, { useMemo } from "react";
import { StudentRow } from "./StudentRow";
import {
  formatAwardBadgeMeta,
  resolveStudentAwardLabel,
  SpckWorkflowController,
} from "./useSpckWorkflow";

export interface StudentTableProps {
  workflow: SpckWorkflowController;
}

export function StudentTable({ workflow }: StudentTableProps) {
  const {
    rows,
    students,
    session14Evals,
    session14AwardMap,
    skippedUnreadyByStudent,
    isSpckExemptClass,
    effectiveSelectedStudentIds,
    assignableStudentIds,
    isAnyOperationBusy,
    setSelectedStudentIds,
    confirmedReadyStudentIds,
    unsubmittedForActiveSessionStudentIds,
    selectedSessionNumber,
  } = workflow;

  const assignedIdSet = useMemo(
    () => new Set(rows.map((r) => r.assignedStudentId).filter(Boolean)),
    [rows]
  );

  const missingFolderRosterStudents = useMemo(() => {
    if (isSpckExemptClass) return [];
    return (students || []).filter(
      (stu) =>
        stu &&
        stu.isActive !== 0 &&
        Boolean(stu.studentId) &&
        !assignedIdSet.has(stu.studentId)
    );
  }, [students, assignedIdSet, isSpckExemptClass]);

  const evalByStudent = useMemo(
    () => new Map((session14Evals || []).map((ev) => [ev.studentId, ev])),
    [session14Evals]
  );

  // Trường hợp chưa có thư mục SPCK nhưng đang ở Buổi 14 đã có session14Evals (VD: lớp PTB/CSB miễn SPCK)
  if (
    rows.length === 0 &&
    selectedSessionNumber === 14 &&
    session14Evals.length > 0
  ) {
    return (
      <div className="space-y-2">
        {session14Evals.map((ev) => {
          const awardLabel = resolveStudentAwardLabel(ev, session14AwardMap);
          const awardBadge = formatAwardBadgeMeta(awardLabel);
          const skippedMsg = skippedUnreadyByStudent[ev.studentId];
          const hasLetter = Boolean(
            ev.learnedFromMindx?.trim() &&
              ev.suggestionsFromMindx?.trim() &&
              ev.futureDirection?.trim()
          );
          return (
            <div
              key={ev.studentId}
              className={`p-3 rounded-xl flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 text-xs ${
                skippedMsg || ev.status === "FAILED"
                  ? "spck-clean-row-error"
                  : "spck-clean-row"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-white text-sm">
                  {ev.fullName || ev.studentId}
                </span>
                {awardBadge && (
                  <span
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
                  <span className="spck-pill-primary px-2 py-0.5 rounded font-semibold text-[11px]">
                    📊 BGK: {ev.demoTotalScore}/5.0
                  </span>
                )}
                <span className="spck-pill-neutral px-2 py-0.5 rounded font-semibold text-[11px]">
                  🎯 ĐNL TB B5+9: {ev.competencyTotalScore}/5.0
                </span>
                {skippedMsg && (
                  <span className="spck-pill-error px-2 py-0.5 rounded font-bold text-[11px]">
                    🚨 {skippedMsg}
                  </span>
                )}
              </div>

              <div className="flex-1 lg:max-w-xl spck-clean-comment-preview px-2.5 py-1.5 rounded-md">
                <div className="line-clamp-2 leading-snug">
                  {hasLetter ? (
                    <span>💬 {ev.learnedFromMindx}</span>
                  ) : (
                    <span className="italic text-slate-400">
                      Chưa soạn Thư tổng kết 3 phần — bấm &ldquo;2. AI Soạn nhận xét&rdquo;
                    </span>
                  )}
                </div>
              </div>

              <span
                className={`px-2.5 py-1 rounded-md font-bold text-[11px] shrink-0 ${
                  ev.status === "VERIFIED"
                    ? "spck-pill-success"
                    : ev.status === "FAILED"
                    ? "spck-pill-error"
                    : hasLetter
                    ? "spck-pill-primary"
                    : "spck-pill-warning"
                }`}
              >
                {ev.status === "VERIFIED"
                  ? "✓ Đã lưu LMS Cột 2"
                  : ev.status === "FAILED"
                  ? "Lỗi Cột 2"
                  : hasLetter
                  ? "Sẵn sàng nộp"
                  : "Chờ AI soạn"}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="spck-clean-subbar p-6 rounded-xl text-center text-slate-400 text-sm">
        Chưa có dữ liệu bài làm SPCK. Hãy chọn Lớp học, chọn Buổi nộp và bấm{" "}
        <strong className="text-white">&ldquo;1. Đồng bộ bài làm&rdquo;</strong>{" "}
        ở thanh hành động phía trên.
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {/* Selection Filters */}
      <div className="spck-clean-subbar flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            Đang chọn:{" "}
            <strong className="text-emerald-500">
              {effectiveSelectedStudentIds.length}
            </strong>
            /{assignableStudentIds.length} học viên có thư mục
          </span>
          {missingFolderRosterStudents.length > 0 && (
            <span className="px-2 py-0.5 rounded bg-rose-950/80 border border-rose-500/60 text-rose-200 font-bold text-[11px]">
              🚨 {missingFolderRosterStudents.length} HV chưa có thư mục bài làm (không chặn nộp cả lớp)
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={isAnyOperationBusy}
            onClick={() =>
              setSelectedStudentIds(unsubmittedForActiveSessionStudentIds)
            }
            className="spck-pill-neutral px-2.5 py-1 rounded-md font-medium cursor-pointer disabled:opacity-50"
          >
            Chọn bài chưa nộp Buổi {selectedSessionNumber} (
            {unsubmittedForActiveSessionStudentIds.length})
          </button>
          <button
            type="button"
            disabled={isAnyOperationBusy}
            onClick={() => setSelectedStudentIds(confirmedReadyStudentIds)}
            className="spck-pill-neutral px-2.5 py-1 rounded-md font-medium cursor-pointer disabled:opacity-50"
          >
            Chọn bài đủ điều kiện ({confirmedReadyStudentIds.length})
          </button>
          <button
            type="button"
            disabled={isAnyOperationBusy}
            onClick={() => setSelectedStudentIds(assignableStudentIds)}
            className="spck-pill-neutral px-2.5 py-1 rounded-md font-medium cursor-pointer disabled:opacity-50"
          >
            Chọn tất cả ({assignableStudentIds.length})
          </button>
          <button
            type="button"
            disabled={isAnyOperationBusy}
            onClick={() => setSelectedStudentIds([])}
            className="spck-pill-neutral px-2.5 py-1 rounded-md cursor-pointer disabled:opacity-50"
          >
            Bỏ chọn
          </button>
        </div>
      </div>

      {/* Compact Student Rows with Expandable "Chi tiết" */}
      <div className="space-y-2">
        {rows.map((row, idx) => {
          const rowKey = row.folderPath || row.assignedStudentId || String(idx);
          return (
            <StudentRow
              key={rowKey}
              row={row}
              idx={idx}
              workflow={workflow}
            />
          );
        })}
      </div>

      {/* Dòng cảnh báo đỏ rõ ràng cho các bạn vắng / thiếu thư mục bài làm (chờ nộp bù sau) */}
      {missingFolderRosterStudents.length > 0 && (
        <div
          data-testid="spck-missing-roster-alert"
          className="rounded-xl border border-rose-500/60 bg-rose-950/30 p-3 space-y-2"
        >
          <div className="text-xs font-bold text-rose-200">
            🚨 Học viên chưa có thư mục bài làm SPCK ({missingFolderRosterStudents.length} bạn — hệ thống vẫn cho nộp trước các bạn đủ điều kiện, các bạn dưới đây chờ nộp bù sau):
          </div>
          <div className="flex flex-wrap gap-2">
            {missingFolderRosterStudents.map((stu) => {
              const isAbs =
                String(stu.attendanceStatus || "").trim().toUpperCase() ===
                "ABSENT";
              const ev14 =
                selectedSessionNumber === 14
                  ? evalByStudent.get(stu.studentId)
                  : undefined;
              const awardLbl = ev14
                ? resolveStudentAwardLabel(ev14, session14AwardMap)
                : "";
              const awardMeta = formatAwardBadgeMeta(awardLbl);
              return (
                <div
                  key={stu.studentId}
                  className="inline-flex flex-wrap items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-950/90 border border-rose-500/50 text-xs"
                >
                  <span className="font-bold text-white">{stu.fullName}</span>
                  <span className="px-1.5 py-0.5 rounded bg-rose-900/70 text-rose-200 text-[10px] font-bold">
                    {isAbs ? "Vắng mặt • Thiếu bài" : "Thiếu bài • Nộp bù sau"}
                  </span>
                  {ev14 && (
                    <>
                      {awardMeta && (
                        <span className="text-[10px] text-amber-200 font-bold">
                          {awardMeta.icon} {awardMeta.shortText}
                        </span>
                      )}
                      <span className="text-[10px] text-slate-300">
                        BGK: {ev14.demoTotalScore}/5.0 • ĐNL:{" "}
                        {ev14.competencyTotalScore}/5.0
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
