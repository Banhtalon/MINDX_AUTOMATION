"use client";

import React, { useState } from "react";
import {
  CLASSROOM_ISSUE_ITEMS,
  CLASSROOM_PRAISE_ITEMS,
  sumCountsRecord,
  type ClassroomIssueKey,
  type ClassroomPraiseKey,
  type ClassroomStudentState,
} from "@/lib/classroom/classroom-manager-helpers";

interface ClassroomTeacherTableProps {
  students: ClassroomStudentState[];
  onToggleAttendance: (studentId: string) => void;
  onManualStarDelta: (studentId: string, delta: 1 | -1) => void;
  onPraise: (studentId: string, key: ClassroomPraiseKey, delta: 1 | -1) => void;
  onIssue: (studentId: string, key: ClassroomIssueKey, delta: 1 | -1) => void;
  onSaveQuickNote: (studentId: string, note: string) => void;
  onOpenAccumulation: () => void;
  onApplyToComments: () => void;
  isApplying: boolean;
}

export function ClassroomTeacherTable({
  students,
  onToggleAttendance,
  onManualStarDelta,
  onPraise,
  onIssue,
  onSaveQuickNote,
  onOpenAccumulation,
  onApplyToComments,
  isApplying,
}: ClassroomTeacherTableProps) {
  const [editingNoteStudent, setEditingNoteStudent] = useState<ClassroomStudentState | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const openNoteModal = (student: ClassroomStudentState) => {
    setEditingNoteStudent(student);
    setNoteDraft(student.teacherQuickNote || "");
  };

  const commitNoteModal = () => {
    if (editingNoteStudent) {
      onSaveQuickNote(editingNoteStudent.studentId, noteDraft.trim());
    }
    setEditingNoteStudent(null);
  };

  return (
    <>
      <div className="cm-shell-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="cm-table w-full border-collapse table-fixed min-w-[1140px]">
            <colgroup>
              <col style={{ width: "14.5%" }} />
              <col style={{ width: "8.5%" }} />
              <col style={{ width: "17%" }} />
              <col style={{ width: "23.5%" }} />
              <col style={{ width: "31.5%" }} />
              <col style={{ width: "5%" }} />
            </colgroup>
            <thead>
              <tr>
                <th className="cm-th-base px-2.5 py-2.5 text-[11px] font-extrabold uppercase tracking-wider text-left whitespace-nowrap">
                  Học viên
                </th>
                <th className="cm-th-base cm-wall-right px-2 py-2.5 text-[11px] font-extrabold uppercase tracking-wider text-center whitespace-nowrap">
                  Điểm danh
                </th>
                <th className="cm-th-score cm-wall-right px-2 py-2.5 text-[11px] font-extrabold uppercase tracking-wider text-left whitespace-nowrap">
                  Tổng hợp điểm
                </th>
                <th className="cm-th-praise cm-wall-right px-2 py-2.5 text-[11px] font-extrabold uppercase tracking-wider text-left whitespace-nowrap">
                  Khu Khen thưởng (+Sao)
                </th>
                <th className="cm-th-issue cm-wall-right px-2 py-2.5 text-[11px] font-extrabold uppercase tracking-wider text-left whitespace-nowrap">
                  Khu Nhắc lỗi (Chỉ đếm ⚠️)
                </th>
                <th className="cm-th-base px-1 py-2.5 text-[11px] font-extrabold uppercase tracking-wider text-center whitespace-nowrap">
                  Ghi chú
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {students.length > 0 ? (
                students.map((stu, idx) => {
                  const isAbsent = stu.attendanceStatus === "ABSENT";
                  const isLate = stu.attendanceStatus === "LATE";
                  const totalIssues = sumCountsRecord(stu.issueCounts);
                  const effectiveStars = isAbsent ? 0 : stu.stars;
                  const effectiveMedals = isAbsent ? 0 : stu.medals;
                  const effectiveIssues = isAbsent ? 0 : totalIssues;
                  const rowClass = isAbsent
                    ? "cm-row-absent"
                    : isLate
                    ? "cm-row-late"
                    : "";
                  const hasQuickNote = Boolean(stu.teacherQuickNote && stu.teacherQuickNote.trim());

                  return (
                    <tr
                      key={stu.studentId}
                      data-testid={`cm-student-row-${stu.studentId}`}
                      className={rowClass}
                    >
                      {/* Col 1: Student */}
                      <td className="cm-td-base px-2.5 py-3 align-middle">
                        <div className={`flex items-center gap-2 ${isAbsent ? "opacity-45" : ""}`}>
                          <span
                            className={`w-6 h-6 rounded-md text-[11px] font-extrabold flex items-center justify-center shrink-0 ${
                              isLate ? "cm-idx-late" : "cm-idx-badge"
                            }`}
                          >
                            {String(idx + 1).padStart(2, "0")}
                          </span>
                          <span
                            className="text-[13px] font-extrabold truncate"
                            title={stu.fullName}
                          >
                            {stu.fullName}
                          </span>
                        </div>
                      </td>

                      {/* Col 2: Attendance */}
                      <td className="cm-td-base cm-wall-right px-1.5 py-3 align-middle text-center">
                        <button
                          type="button"
                          data-testid={`cm-att-btn-${stu.studentId}`}
                          onClick={() => onToggleAttendance(stu.studentId)}
                          title="Bấm để đổi nhanh: Có mặt → Đi muộn → Vắng"
                          className={`w-[86px] h-7 mx-auto rounded-lg text-[11px] font-extrabold inline-flex items-center justify-center gap-1 cursor-pointer transition whitespace-nowrap ${
                            isAbsent
                              ? "cm-att-absent"
                              : isLate
                              ? "cm-att-late"
                              : "cm-att-present"
                          }`}
                        >
                          {isAbsent ? "✕ Vắng" : isLate ? "⏰ Đi muộn" : "✓ Có mặt"}
                        </button>
                      </td>

                      {/* Col 3: Fixed 3-Slot Score Grid */}
                      <td className="cm-td-score cm-wall-right px-2 py-3 align-middle">
                        <div
                          className={`grid grid-cols-[minmax(76px,1.5fr)_minmax(46px,1fr)_minmax(46px,1fr)] gap-1.5 items-center ${
                            isAbsent ? "opacity-45" : ""
                          }`}
                        >
                          <div
                            data-testid={`cm-star-box-${stu.studentId}`}
                            className={`h-8 rounded-lg px-1 flex items-center justify-between text-xs font-extrabold whitespace-nowrap ${
                              isAbsent ? "cm-slot-star-zero" : "cm-slot-star"
                            }`}
                          >
                            <button
                              type="button"
                              aria-label={`Trừ 1 sao của ${stu.fullName}`}
                              data-testid={`cm-star-minus-${stu.studentId}`}
                              disabled={isAbsent || effectiveStars <= 0}
                              onClick={() => onManualStarDelta(stu.studentId, -1)}
                              className="cm-adj-btn w-[18px] h-[18px] rounded text-[11px] font-extrabold flex items-center justify-center disabled:opacity-40 cursor-pointer"
                            >
                              −
                            </button>
                            <span>⭐ {effectiveStars}</span>
                            <button
                              type="button"
                              aria-label={`Cộng 1 sao cho ${stu.fullName}`}
                              data-testid={`cm-star-plus-${stu.studentId}`}
                              disabled={isAbsent}
                              onClick={() => onManualStarDelta(stu.studentId, 1)}
                              className="cm-adj-btn w-[18px] h-[18px] rounded text-[11px] font-extrabold flex items-center justify-center disabled:opacity-40 cursor-pointer"
                            >
                              +
                            </button>
                          </div>

                          <div
                            data-testid={`cm-medal-box-${stu.studentId}`}
                            className={`h-8 rounded-lg text-xs font-extrabold flex items-center justify-center gap-1 whitespace-nowrap ${
                              effectiveMedals > 0 ? "cm-slot-medal-active" : "cm-slot-muted"
                            }`}
                          >
                            <span>🏅</span>
                            <span>{effectiveMedals}</span>
                          </div>

                          <div
                            data-testid={`cm-issue-box-${stu.studentId}`}
                            className={`h-8 rounded-lg text-xs font-extrabold flex items-center justify-center gap-1 whitespace-nowrap ${
                              effectiveIssues > 0 ? "cm-slot-err-active" : "cm-slot-muted"
                            }`}
                          >
                            <span>⚠️</span>
                            <span>{effectiveIssues}</span>
                          </div>
                        </div>
                      </td>

                      {/* Col 4: Fixed 3-Slot Praise Grid */}
                      <td className="cm-td-praise cm-wall-right px-1.5 py-3 align-middle">
                        <div
                          className={`grid grid-cols-3 gap-1 ${isAbsent ? "opacity-45" : ""}`}
                        >
                          {CLASSROOM_PRAISE_ITEMS.map((item) => {
                            const count = isAbsent ? 0 : stu.praiseCounts?.[item.key] || 0;
                            const activeCls =
                              item.key === "huy_hieu"
                                ? "cm-act-medal-hit"
                                : "cm-act-praise-hit";
                            return (
                              <button
                                key={item.key}
                                type="button"
                                disabled={isAbsent}
                                data-testid={`cm-praise-${item.key}-${stu.studentId}`}
                                title="Bấm +1 | Chuột phải hoặc Shift+Click để -1"
                                onClick={(e) =>
                                  onPraise(stu.studentId, item.key, e.shiftKey ? -1 : 1)
                                }
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  onPraise(stu.studentId, item.key, -1);
                                }}
                                className={`relative h-8 rounded-lg px-1 text-[11px] font-bold flex items-center justify-center gap-0.5 whitespace-nowrap cursor-pointer disabled:cursor-not-allowed transition ${
                                  count > 0 ? activeCls : "cm-act-idle"
                                }`}
                              >
                                <span>{item.icon}</span>
                                <span className="truncate">{item.label}</span>
                                {count > 0 && (
                                  <span
                                    className={`cm-corner-badge ${
                                      item.key === "huy_hieu"
                                        ? "bg-amber-700"
                                        : "bg-emerald-700"
                                    }`}
                                  >
                                    {count}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </td>

                      {/* Col 5: Fixed 6-Slot Issue Grid (2x3 on standard screens, 1x6 on ultrawide >=1680px) */}
                      <td className="cm-td-issue cm-wall-right px-1.5 py-3 align-middle">
                        <div
                          className={`grid grid-cols-3 min-[1680px]:grid-cols-6 gap-1.5 ${
                            isAbsent ? "opacity-45" : ""
                          }`}
                        >
                          {CLASSROOM_ISSUE_ITEMS.map((item) => {
                            const count = isAbsent ? 0 : stu.issueCounts?.[item.key] || 0;
                            const hitCls =
                              item.key === "di_muon" ? "cm-act-late-hit" : "cm-act-issue-hit";
                            return (
                              <button
                                key={item.key}
                                type="button"
                                disabled={isAbsent}
                                data-testid={`cm-issue-${item.key}-${stu.studentId}`}
                                title="Bấm +1 lỗi (giữ nguyên Sao) | Chuột phải hoặc Shift+Click để -1"
                                onClick={(e) =>
                                  onIssue(stu.studentId, item.key, e.shiftKey ? -1 : 1)
                                }
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  onIssue(stu.studentId, item.key, -1);
                                }}
                                className={`relative h-8 rounded-lg px-1 text-[10.5px] font-semibold flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer disabled:cursor-not-allowed transition ${
                                  count > 0 ? hitCls : "cm-act-idle"
                                }`}
                              >
                                <span>{item.icon}</span>
                                <span className="truncate">{item.label}</span>
                                {count > 0 && (
                                  <span
                                    className={`cm-corner-badge ${
                                      item.key === "di_muon" ? "bg-orange-700" : "bg-rose-700"
                                    }`}
                                  >
                                    {count}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </td>

                      {/* Col 6: Quick Note */}
                      <td className="cm-td-base px-1 py-3 align-middle text-center">
                        <button
                          type="button"
                          data-testid={`cm-note-btn-${stu.studentId}`}
                          disabled={isAbsent}
                          title={
                            hasQuickNote
                              ? `Ghi chú: ${stu.teacherQuickNote}`
                              : "Thêm ghi chú nhanh"
                          }
                          onClick={() => openNoteModal(stu)}
                          className={`w-8 h-8 mx-auto rounded-lg inline-flex items-center justify-center text-sm cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed transition ${
                            hasQuickNote ? "cm-note-filled" : "cm-act-idle"
                          }`}
                        >
                          ✏️
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                    Chưa có học viên nào cho lớp này. Vui lòng chọn lớp khác hoặc bấm nút làm mới danh sách từ LMS ở trên.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom Legend & CTA Strip */}
      <div className="cm-shell-card px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4 text-xs font-semibold">
          <span>🟨 Khu Điểm: Giữ nguyên Sao khi ghi lỗi</span>
          <span>🟩 Khu Khen: Cộng Sao / Huy hiệu</span>
          <span>🟥 Khu Lỗi: Chỉ đếm số lần ⚠️ (Chuột phải để -1)</span>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            data-testid="cm-open-accumulation-btn"
            onClick={onOpenAccumulation}
            className="cm-act-idle px-3.5 py-2 rounded-lg text-xs sm:text-sm font-bold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <span>📈 Tích lũy 14 buổi</span>
          </button>
          <button
            type="button"
            data-testid="cm-direct-apply-btn"
            disabled={isApplying || students.length === 0}
            onClick={onApplyToComments}
            className="mindx-dark-btn px-4 py-2 rounded-lg text-xs sm:text-sm font-extrabold bg-emerald-700 hover:bg-emerald-600 text-white shadow-sm disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <span>{isApplying ? "Đang chuyển..." : "➡️ Chuyển sang Nhận xét từng bạn"}</span>
          </button>
        </div>
      </div>

      {/* Quick Note Modal */}
      {editingNoteStudent && (
        <div className="cm-modal-backdrop fixed inset-0 z-50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="cm-shell-card w-full max-w-md p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold">
                ✏️ Ghi chú nhanh — {editingNoteStudent.fullName}
              </h3>
              <button
                type="button"
                onClick={() => setEditingNoteStudent(null)}
                className="cm-act-idle px-2.5 py-1 rounded-md text-xs font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
            <p className="text-xs opacity-80">
              Nội dung này sẽ được gộp thẳng vào ô &ldquo;Ghi chú của GV&rdquo; khi chuyển sang trang Nhận xét buổi học.
            </p>
            <textarea
              rows={3}
              data-testid="cm-note-modal-textarea"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="Ví dụ: Thiết kế thêm tính năng mới, hay hỏi bạn kế bên..."
              className="cm-select w-full p-2.5 text-sm focus:outline-none resize-none"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingNoteStudent(null)}
                className="cm-act-idle px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                data-testid="cm-note-modal-save-btn"
                onClick={commitNoteModal}
                className="mindx-dark-btn px-4 py-1.5 rounded-lg text-xs font-extrabold bg-blue-600 hover:bg-blue-500 text-white cursor-pointer"
              >
                Lưu ghi chú
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
