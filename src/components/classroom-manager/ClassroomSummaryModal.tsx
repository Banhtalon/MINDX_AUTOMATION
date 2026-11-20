"use client";

import React from "react";
import {
  CLASSROOM_ISSUE_ITEMS,
  CLASSROOM_PRAISE_ITEMS,
  buildClassroomToCommentMapping,
  computeClassroomSessionSummary,
  sumCountsRecord,
  type ClassroomStudentState,
} from "@/lib/classroom/classroom-manager-helpers";

interface ClassroomSummaryModalProps {
  open: boolean;
  classId: string;
  sessionNumber: number;
  students: ClassroomStudentState[];
  onClose: () => void;
  onOpenAccumulation: () => void;
  onApplyToComments: () => void;
  isApplying: boolean;
}

export function ClassroomSummaryModal({
  open,
  classId,
  sessionNumber,
  students,
  onClose,
  onOpenAccumulation,
  onApplyToComments,
  isApplying,
}: ClassroomSummaryModalProps) {
  if (!open) return null;

  const summary = computeClassroomSessionSummary(students);

  return (
    <div
      data-testid="cm-summary-modal"
      className="cm-modal-backdrop fixed inset-0 z-50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
    >
      <div className="cm-shell-card w-full max-w-[1320px] max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="cm-th-base px-5 py-3 flex items-center justify-between">
          <h2 className="text-base sm:text-lg font-black">
            📊 TỔNG HỢP CUỐI BUỔI {sessionNumber} · LỚP {classId}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="cm-act-idle px-3 py-1 rounded-lg text-xs font-bold cursor-pointer"
          >
            ✕ Đóng
          </button>
        </div>

        {/* 4 Equal Stat Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 px-5 py-3 border-b-2 border-slate-200 dark:border-slate-700">
          <div className="cm-att-present rounded-xl px-3.5 py-2.5 flex items-center justify-between text-xs font-extrabold">
            <span>✅ Có mặt đúng giờ</span>
            <span>{summary.presentOnTimeCount} bạn</span>
          </div>
          <div className="cm-att-late rounded-xl px-3.5 py-2.5 flex items-center justify-between text-xs font-extrabold">
            <span>⏰ Đi muộn</span>
            <span className="truncate ml-2">
              {summary.lateCount > 0
                ? `${summary.lateCount} (${summary.lateNames.join(", ")})`
                : "0"}
            </span>
          </div>
          <div className="cm-stat-pill rounded-xl px-3.5 py-2.5 flex items-center justify-between text-xs font-extrabold">
            <span>✕ Vắng mặt</span>
            <span className="truncate ml-2">
              {summary.absentCount > 0
                ? `${summary.absentCount} (${summary.absentNames.join(", ")})`
                : "0"}
            </span>
          </div>
          <div className="cm-stat-err rounded-xl px-3.5 py-2.5 flex items-center justify-between text-xs font-extrabold">
            <span>📕 Chưa làm BTVN</span>
            <span className="truncate ml-2">
              {summary.missingHomeworkCount > 0
                ? `${summary.missingHomeworkCount} (${summary.missingHomeworkNames.join(", ")})`
                : "0"}
            </span>
          </div>
        </div>

        {/* 5-Column Summary Table */}
        <div className="flex-1 overflow-auto">
          <table className="cm-table w-full border-collapse table-fixed min-w-[1060px]">
            <colgroup>
              <col style={{ width: "17%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "17%" }} />
              <col style={{ width: "30%" }} />
              <col style={{ width: "26%" }} />
            </colgroup>
            <thead>
              <tr>
                <th className="cm-th-base px-3 py-2.5 text-[11px] font-extrabold uppercase text-left">
                  Học viên
                </th>
                <th className="cm-th-base cm-wall-right px-2 py-2.5 text-[11px] font-extrabold uppercase text-center">
                  Điểm danh
                </th>
                <th className="cm-th-score cm-wall-right px-2 py-2.5 text-[11px] font-extrabold uppercase text-left">
                  Kết quả
                </th>
                <th className="cm-th-base cm-wall-right px-3 py-2.5 text-[11px] font-extrabold uppercase text-left">
                  Ghi nhận trong giờ
                </th>
                <th className="cm-th-tags px-3 py-2.5 text-[11px] font-extrabold uppercase text-left">
                  Điền sẵn sang Nhận xét (Ghi chú GV &amp; Thẻ)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {students.map((stu, idx) => {
                const isAbsent = stu.attendanceStatus === "ABSENT";
                const isLate = stu.attendanceStatus === "LATE";
                const totalIssues = sumCountsRecord(stu.issueCounts);
                const effectiveStars = isAbsent ? 0 : stu.stars;
                const effectiveMedals = isAbsent ? 0 : stu.medals;
                const effectiveIssues = isAbsent ? 0 : totalIssues;
                const mapped = buildClassroomToCommentMapping({
                  classCode: classId,
                  sessionNumber,
                  studentRow: stu,
                });

                const praiseChips = CLASSROOM_PRAISE_ITEMS.filter((item) => {
                  if (item.key === "huy_hieu") return effectiveMedals > 0;
                  return (stu.praiseCounts?.[item.key] || 0) > 0;
                }).map((item) => ({
                  key: item.key,
                  label:
                    item.key === "huy_hieu"
                      ? "🏅 Top 3 xuất sắc"
                      : `${item.icon} ${item.label} ×${stu.praiseCounts?.[item.key]}`,
                }));

                const issueChips = CLASSROOM_ISSUE_ITEMS.filter(
                  (item) => (stu.issueCounts?.[item.key] || 0) > 0
                ).map((item) => ({
                  key: item.key,
                  label: `${item.icon} ${item.label} ×${stu.issueCounts?.[item.key]}`,
                  isLate: item.key === "di_muon",
                }));

                return (
                  <tr key={stu.studentId} className={isAbsent ? "cm-row-absent" : ""}>
                    <td className="cm-td-base px-3 py-3 align-middle">
                      <div className={`flex items-center gap-2 ${isAbsent ? "opacity-50" : ""}`}>
                        <span className="cm-idx-badge w-6 h-6 rounded-md text-[11px] font-extrabold flex items-center justify-center shrink-0">
                          {String(idx + 1).padStart(2, "0")}
                        </span>
                        <span className="text-xs sm:text-sm font-extrabold truncate">
                          {stu.fullName}
                        </span>
                      </div>
                    </td>

                    <td className="cm-td-base cm-wall-right px-2 py-3 align-middle text-center">
                      <span
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold whitespace-nowrap ${
                          isAbsent
                            ? "cm-att-absent"
                            : isLate
                            ? "cm-att-late"
                            : "cm-att-present"
                        }`}
                      >
                        {isAbsent ? "✕ Vắng" : isLate ? "⏰ Đi muộn" : "✓ Có mặt"}
                      </span>
                    </td>

                    <td className="cm-td-score cm-wall-right px-2 py-3 align-middle">
                      <div className={`grid grid-cols-3 gap-1.5 ${isAbsent ? "opacity-45" : ""}`}>
                        <span
                          className={`h-7 rounded-md text-xs font-extrabold flex items-center justify-center ${
                            effectiveStars > 0 ? "cm-slot-star" : "cm-slot-muted"
                          }`}
                        >
                          ⭐ {effectiveStars}
                        </span>
                        <span
                          className={`h-7 rounded-md text-xs font-extrabold flex items-center justify-center ${
                            effectiveMedals > 0 ? "cm-slot-medal-active" : "cm-slot-muted"
                          }`}
                        >
                          🏅 {effectiveMedals}
                        </span>
                        <span
                          className={`h-7 rounded-md text-xs font-extrabold flex items-center justify-center ${
                            effectiveIssues > 0 ? "cm-slot-err-active" : "cm-slot-muted"
                          }`}
                        >
                          ⚠️ {effectiveIssues}
                        </span>
                      </div>
                    </td>

                    <td className="cm-td-base cm-wall-right px-3 py-3 align-middle">
                      {isAbsent ? (
                        <span className="cm-slot-muted px-2.5 py-1 rounded-md text-xs font-semibold">
                          Nghỉ buổi {sessionNumber}
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {praiseChips.map((p) => (
                            <span
                              key={p.key}
                              className="cm-act-praise-hit px-2 py-0.5 rounded-md text-[11px] font-bold"
                            >
                              {p.label}
                            </span>
                          ))}
                          {issueChips.map((i) => (
                            <span
                              key={i.key}
                              className={`${
                                i.isLate ? "cm-act-late-hit" : "cm-act-issue-hit"
                              } px-2 py-0.5 rounded-md text-[11px] font-bold`}
                            >
                              {i.label}
                            </span>
                          ))}
                          {issueChips.length === 0 && (
                            <span className="cm-att-present px-2 py-0.5 rounded-md text-[11px] font-bold">
                              ✓ Không có lỗi
                            </span>
                          )}
                        </div>
                      )}
                    </td>

                    <td className="cm-td-tags px-3 py-3 align-middle space-y-1.5">
                      {isAbsent ? (
                        <span className="cm-slot-muted px-2.5 py-1 rounded-md text-xs font-semibold inline-block">
                          Tự đánh dấu Vắng mặt
                        </span>
                      ) : (
                        <>
                          <div className="flex flex-wrap gap-1">
                            {mapped.quickTags.map((tag) => (
                              <span
                                key={tag}
                                className="cm-act-praise-hit px-2 py-0.5 rounded text-[10.5px] font-bold"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                          <p className="text-[11px] leading-snug opacity-85 whitespace-pre-line">
                            {mapped.teacherNote}
                          </p>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="cm-th-base px-5 py-3 flex flex-wrap items-center justify-between gap-3 border-t-2 border-slate-200 dark:border-slate-700 border-b-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="cm-act-idle px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer"
            >
              🔙 Quay lại bảng giờ học
            </button>
            <button
              type="button"
              onClick={onOpenAccumulation}
              className="cm-act-idle px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer"
            >
              📈 Tích lũy 14 buổi
            </button>
          </div>

          <button
            type="button"
            data-testid="cm-apply-to-comments-btn"
            disabled={isApplying}
            onClick={onApplyToComments}
            className="mindx-dark-btn px-5 py-2 rounded-xl text-xs sm:text-sm font-extrabold bg-emerald-700 hover:bg-emerald-600 text-white shadow-sm disabled:opacity-50 cursor-pointer"
          >
            {isApplying
              ? "Đang áp dụng dữ liệu..."
              : sessionNumber >= 14
              ? "➡️ Áp dụng & Chuyển sang Tổng kết Buổi 14"
              : "➡️ Áp dụng & Chuyển sang Nhận xét từng bạn"}
          </button>
        </div>
      </div>
    </div>
  );
}
