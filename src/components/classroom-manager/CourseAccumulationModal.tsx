"use client";

import React from "react";
import type { ClassroomCourseAccumulationRow } from "@/lib/classroom/classroom-manager-helpers";

interface CourseAccumulationModalProps {
  open: boolean;
  classId: string;
  rows: ClassroomCourseAccumulationRow[];
  onClose: () => void;
}

export function CourseAccumulationModal({
  open,
  classId,
  rows,
  onClose,
}: CourseAccumulationModalProps) {
  if (!open) return null;

  return (
    <div
      data-testid="cm-accumulation-modal"
      className="cm-modal-backdrop fixed inset-0 z-50 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div className="cm-shell-card w-full max-w-3xl max-h-[86vh] flex flex-col overflow-hidden">
        <div className="cm-th-base px-5 py-3 flex items-center justify-between">
          <h2 className="text-base font-black">
            📈 TÍCH LŨY SAO &amp; HUY HIỆU 14 BUỔI · {classId}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="cm-act-idle px-3 py-1 rounded-lg text-xs font-bold cursor-pointer"
          >
            ✕ Đóng
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="cm-table w-full border-collapse">
            <thead>
              <tr>
                <th className="cm-th-base px-4 py-2.5 text-[11px] font-extrabold uppercase text-left">
                  Học viên
                </th>
                <th className="cm-th-score px-3 py-2.5 text-[11px] font-extrabold uppercase text-center">
                  Tổng Sao
                </th>
                <th className="cm-th-score px-3 py-2.5 text-[11px] font-extrabold uppercase text-center">
                  Huy hiệu
                </th>
                <th className="cm-th-base px-3 py-2.5 text-[11px] font-extrabold uppercase text-center">
                  Chuyên cần
                </th>
                <th className="cm-th-praise px-4 py-2.5 text-[11px] font-extrabold uppercase text-center">
                  Xếp hạng khích lệ
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {rows.map((row, idx) => (
                <tr key={row.studentId}>
                  <td className="cm-td-base px-4 py-3 text-sm font-extrabold">
                    <span className="cm-idx-badge inline-flex w-6 h-6 rounded items-center justify-center text-[11px] mr-2">
                      {idx + 1}
                    </span>
                    {row.fullName}
                  </td>
                  <td className="cm-td-score px-3 py-3 text-center">
                    <span className="cm-slot-star px-2.5 py-1 rounded-md text-xs font-extrabold inline-block">
                      ⭐ {row.totalStars}
                    </span>
                  </td>
                  <td className="cm-td-score px-3 py-3 text-center">
                    <span
                      className={`${
                        row.totalMedals > 0 ? "cm-slot-medal-active" : "cm-slot-muted"
                      } px-2.5 py-1 rounded-md text-xs font-extrabold inline-block`}
                    >
                      🏅 {row.totalMedals}
                    </span>
                  </td>
                  <td className="cm-td-base px-3 py-3 text-center text-xs font-bold">
                    {row.attendedSessions} buổi
                    {row.lateSessions > 0 ? ` (${row.lateSessions} muộn)` : ""}
                  </td>
                  <td className="cm-td-praise px-4 py-3 text-center">
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-extrabold ${
                        row.totalStars >= 20
                          ? "cm-slot-star"
                          : row.totalStars >= 10
                          ? "cm-act-praise-hit"
                          : "cm-slot-muted"
                      }`}
                    >
                      {row.rankLabel}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
