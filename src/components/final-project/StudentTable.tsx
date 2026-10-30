"use client";

import React from "react";
import { StudentRow } from "./StudentRow";
import { SpckWorkflowController } from "./useSpckWorkflow";

export interface StudentTableProps {
  workflow: SpckWorkflowController;
}

export function StudentTable({ workflow }: StudentTableProps) {
  const {
    rows,
    effectiveSelectedStudentIds,
    assignableStudentIds,
    isAnyOperationBusy,
    setSelectedStudentIds,
    confirmedReadyStudentIds,
    unsubmittedForActiveSessionStudentIds,
    selectedSessionNumber,
  } = workflow;

  if (rows.length === 0) {
    return (
      <div className="p-8 rounded-xl bg-slate-950/60 border border-slate-800 text-center text-slate-400 text-sm">
        Chưa có dữ liệu thư mục SPCK. Hãy chọn Lớp học, chọn Buổi nộp và bấm{" "}
        <strong>&ldquo;Quét &amp; Khớp HV&rdquo;</strong> ở Bước 1.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Selection Filters */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-400 font-medium">
            Đang chọn:{" "}
            <strong className="text-emerald-400">
              {effectiveSelectedStudentIds.length}
            </strong>
            /{assignableStudentIds.length} học viên
          </span>
          <button
            type="button"
            disabled={isAnyOperationBusy}
            onClick={() => setSelectedStudentIds(confirmedReadyStudentIds)}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 font-medium cursor-pointer disabled:opacity-50"
          >
            Chọn bài đủ điều kiện ({confirmedReadyStudentIds.length})
          </button>
          <button
            type="button"
            disabled={isAnyOperationBusy}
            onClick={() =>
              setSelectedStudentIds(unsubmittedForActiveSessionStudentIds)
            }
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 font-medium cursor-pointer disabled:opacity-50"
          >
            Chọn bài chưa nộp Buổi {selectedSessionNumber} (
            {unsubmittedForActiveSessionStudentIds.length})
          </button>
          <button
            type="button"
            disabled={isAnyOperationBusy}
            onClick={() => setSelectedStudentIds(assignableStudentIds)}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium cursor-pointer disabled:opacity-50"
          >
            Chọn tất cả ({assignableStudentIds.length})
          </button>
          <button
            type="button"
            disabled={isAnyOperationBusy}
            onClick={() => setSelectedStudentIds([])}
            className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-400 cursor-pointer disabled:opacity-50"
          >
            Bỏ chọn
          </button>
        </div>
      </div>

      {/* Compact Student Rows with Expandable "Chi tiết" */}
      <div className="space-y-2.5">
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
    </div>
  );
}
