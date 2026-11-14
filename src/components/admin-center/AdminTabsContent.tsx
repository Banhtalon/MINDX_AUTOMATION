"use client";

import React, { useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  Rocket,
  Sparkles,
  Users,
} from "lucide-react";
import type {
  AdminClassRowDto,
  AdminInstructorSummaryDto,
} from "@/lib/admin-center/admin-types";
import {
  flattenEarlyWarnings,
  type AdminTabKey,
} from "./admin-ui-helpers";

interface AdminTabsContentProps {
  activeTab: AdminTabKey;
  classes: AdminClassRowDto[];
  instructors: AdminInstructorSummaryDto[];
  campusZaloSummaryText: string;
  syncProgressBySession: boolean;
  onToggleSyncProgressBySession: (next: boolean) => void;
  busyClassCode: string | null;
  isBatchActionRunning: boolean;
  onRescanSingleClass: (classCode: string) => void;
  onSyncSingleBtvn: (classCode: string) => void;
  onSyncBatchBtvn: (classCodes: string[]) => void;
  onProvisionSingleSpckTasks: (classCode: string) => void;
  onProvisionBatchSpckTasks: (classCodes: string[]) => void;
  onCopyText: (label: string, text: string) => void;
  copiedKey: string | null;
}

function renderAttendanceBadge(cls: AdminClassRowDto) {
  const w = cls.weeklyOps;
  if (w.attendanceStatus === "COMPLETED") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40">
        <CheckCircle2 className="w-3.5 h-3.5" /> Đủ ({w.presentCount} có mặt,{" "}
        {w.absentCount} nghỉ)
      </span>
    );
  }
  if (w.attendanceStatus === "PARTIAL") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/40">
        <AlertTriangle className="w-3.5 h-3.5" /> Thiếu {w.unmarkedCount} HV
      </span>
    );
  }
  if (w.attendanceStatus === "NOT_MARKED") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/40">
        Chưa điểm danh
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-500/10 text-slate-600 dark:text-slate-300 border border-slate-400/30">
      Chưa đến buổi
    </span>
  );
}

function renderBtvnSyncBadge(cls: AdminClassRowDto) {
  if (cls.btvnSyncStatus === "VERIFIED" && !cls.btvnSummary.isOutOfSyncWithTeaching) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40">
        Đã đồng bộ ({cls.btvnSummary.teachingScoredCellsCount} ô)
      </span>
    );
  }
  if (cls.btvnSyncStatus === "SYNCING") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/40">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang đẩy...
      </span>
    );
  }
  if (cls.btvnSummary.isOutOfSyncWithTeaching || cls.btvnSyncStatus === "OUT_OF_SYNC") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/40">
        Cần đẩy sang Teaching
      </span>
    );
  }
  if (cls.btvnSyncStatus === "NEEDS_ATTENTION") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/40">
        Chưa có điểm để đẩy
      </span>
    );
  }
  if (cls.btvnSyncStatus === "FAILED") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/40">
        Lỗi đồng bộ
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-500/10 text-slate-600 dark:text-slate-300 border border-slate-400/30">
      Chưa đẩy
    </span>
  );
}

function renderTaskStatusBadge(cls: AdminClassRowDto) {
  const st = cls.spckTasks.taskStatus;
  if (st === "READY") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40">
        Đủ 5/5 (100%)
      </span>
    );
  }
  if (st === "MISSING_PROJECT") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/40">
        Chưa có dự án SPCK
      </span>
    );
  }
  if (st === "INCOMPLETE_TASKS") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/40">
        Thiếu việc ({cls.spckTasks.taskCount}/5 • {cls.spckTasks.totalWeightPercent}%)
      </span>
    );
  }
  if (st === "NEEDS_STUDENT_ASSIGN") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/40">
        Thiếu gán HV ({cls.spckTasks.assignedStudentCount}/{cls.teachingStudentCount})
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-500/10 text-slate-600 dark:text-slate-300 border border-slate-400/30">
      Chưa đến B10
    </span>
  );
}

export function AdminTabsContent({
  activeTab,
  classes,
  instructors,
  campusZaloSummaryText,
  syncProgressBySession,
  onToggleSyncProgressBySession,
  busyClassCode,
  isBatchActionRunning,
  onRescanSingleClass,
  onSyncSingleBtvn,
  onSyncBatchBtvn,
  onProvisionSingleSpckTasks,
  onProvisionBatchSpckTasks,
  onCopyText,
  copiedKey,
}: AdminTabsContentProps) {
  const [expandedSpckClasses, setExpandedSpckClasses] = useState<
    Record<string, boolean>
  >({});

  const toggleSpckExpand = (code: string) => {
    setExpandedSpckClasses((prev) => ({ ...prev, [code]: !prev[code] }));
  };

  if (activeTab === "weekly") {
    return (
      <div className="space-y-3">
        {classes.length === 0 ? (
          <div className="mindx-card rounded-xl p-8 text-center text-sm text-[var(--text-secondary)]">
            Không có lớp nào khớp bộ lọc hiện tại. Bấm{" "}
            <strong>Quét toàn cơ sở</strong> để tải dữ liệu mới nhất từ LMS và
            Teaching.
          </div>
        ) : (
          <div className="overflow-x-auto mindx-card rounded-xl">
            <table className="w-full text-left text-xs sm:text-sm border-collapse">
              <thead>
                <tr className="border-b border-[var(--border-card)] bg-[var(--surface-subtle)]">
                  <th className="p-3 font-bold">Lớp &amp; GV</th>
                  <th className="p-3 font-bold">Buổi &amp; Ca học</th>
                  <th className="p-3 font-bold">Điểm danh</th>
                  <th className="p-3 font-bold">Tổng kết &amp; NX HV</th>
                  <th className="p-3 font-bold">Check 48h (Zalo / LMS)</th>
                  <th className="p-3 font-bold">Mốc &amp; Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-card)]">
                {classes.map((cls) => {
                  const isBusy = busyClassCode === cls.classCode;
                  const sn = cls.weeklyOps.evaluatedSessionNumber || cls.currentSessionNumber;
                  return (
                    <tr
                      key={cls.classCode}
                      className="hover:bg-[var(--surface-subtle)]/60 transition-colors align-top"
                    >
                      <td className="p-3 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-black text-sm">
                            {cls.classCode}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              cls.blockType === "ROBOTICS"
                                ? "bg-purple-500/15 text-purple-700 dark:text-purple-300"
                                : "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                            }`}
                          >
                            {cls.blockType}
                          </span>
                          {cls.isMakeupClass && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-500/15 text-slate-700 dark:text-slate-300">
                              -HB
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[var(--text-secondary)]">
                          GV: <strong>{cls.mainTeacher || "Chưa gán"}</strong>
                          {cls.assistantTeacher
                            ? ` • TA: ${cls.assistantTeacher}`
                            : ""}
                        </div>
                        <div className="text-[11px] text-[var(--text-secondary)]">
                          Sĩ số: LMS {cls.activeStudentCount} / Teaching{" "}
                          {cls.teachingStudentCount}
                        </div>
                      </td>

                      <td className="p-3 space-y-1">
                        <div className="font-bold">
                          Buổi {sn > 0 ? sn : "?"}
                        </div>
                        <div className="text-xs text-[var(--text-secondary)]">
                          {cls.weeklyOps.evaluatedSessionDate ||
                            cls.currentSessionDate ||
                            "-"}
                        </div>
                        {cls.timeSlot && (
                          <div className="text-[11px] text-[var(--text-secondary)]">
                            {cls.timeSlot}
                          </div>
                        )}
                      </td>

                      <td className="p-3 space-y-1">
                        {renderAttendanceBadge(cls)}
                      </td>

                      <td className="p-3 space-y-1">
                        <div>
                          {cls.weeklyOps.hasSummaryAndHomework ? (
                            <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                              ✓ Đủ Tổng kết/BTVN
                            </span>
                          ) : cls.weeklyOps.evaluatedSessionNumber > 0 ? (
                            <span className="text-xs font-bold text-rose-700 dark:text-rose-300">
                              ✗ Thiếu Tổng kết/BTVN
                            </span>
                          ) : (
                            <span className="text-xs text-[var(--text-secondary)]">
                              Chưa kiểm tra
                            </span>
                          )}
                        </div>
                        {cls.weeklyOps.presentCount > 0 && (
                          <div className="text-xs">
                            NX học viên:{" "}
                            <strong
                              className={
                                cls.weeklyOps.missingCommentStudentNames.length > 0
                                  ? "text-rose-700 dark:text-rose-300"
                                  : "text-emerald-700 dark:text-emerald-300"
                              }
                            >
                              {cls.weeklyOps.commentedPresentCount}/
                              {cls.weeklyOps.presentCount} HV
                            </strong>
                          </div>
                        )}
                        {cls.weeklyOps.missingCommentStudentNames.length > 0 && (
                          <div className="text-[11px] text-rose-700 dark:text-rose-300">
                            Thiếu: {cls.weeklyOps.missingCommentStudentNames.join(", ")}
                          </div>
                        )}
                      </td>

                      <td className="p-3 space-y-1 text-xs">
                        <div>
                          Zalo:{" "}
                          <strong
                            className={
                              cls.weeklyOps.isZaloLateOrMissing
                                ? "text-rose-700 dark:text-rose-300"
                                : "text-emerald-700 dark:text-emerald-300"
                            }
                          >
                            {cls.weeklyOps.zaloStatus || "Chưa có dòng check"}
                          </strong>
                          {cls.weeklyOps.zaloDeadline && (
                            <span className="text-[11px] text-[var(--text-secondary)]">
                              {" "}
                              ({cls.weeklyOps.zaloDeadline})
                            </span>
                          )}
                        </div>
                        <div>
                          LMS:{" "}
                          <strong
                            className={
                              cls.weeklyOps.isLmsLateOrMissing
                                ? "text-rose-700 dark:text-rose-300"
                                : "text-emerald-700 dark:text-emerald-300"
                            }
                          >
                            {cls.weeklyOps.lmsCheckStatus || "Chưa có dòng check"}
                          </strong>
                        </div>
                        {cls.weeklyOps.checkIssueNote && (
                          <div className="text-[11px] text-amber-700 dark:text-amber-300">
                            {cls.weeklyOps.checkIssueNote}
                          </div>
                        )}
                      </td>

                      <td className="p-3 space-y-2">
                        {cls.weeklyOps.checkpointAlert && (
                          <div className="px-2 py-1 rounded bg-amber-500/15 border border-amber-500/40 text-amber-800 dark:text-amber-200 text-xs font-semibold">
                            {cls.weeklyOps.checkpointAlert.message}
                          </div>
                        )}
                        {cls.specialEvent && !cls.weeklyOps.checkpointAlert && (
                          <div className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                            Sự kiện tuần: {cls.specialEvent}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-1.5">
                          <a
                            href={cls.lmsCommentsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border border-[var(--border-card)] bg-[var(--surface-subtle)] hover:opacity-85"
                          >
                            Mở LMS <ExternalLink className="w-3 h-3" />
                          </a>
                          <button
                            type="button"
                            disabled={isBusy || isBatchActionRunning}
                            onClick={() => onRescanSingleClass(cls.classCode)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border border-[var(--border-card)] bg-[var(--surface-card)] hover:bg-[var(--surface-subtle)] disabled:opacity-50"
                          >
                            {isBusy ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <RefreshCw className="w-3 h-3" />
                            )}
                            Quét lại lớp
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  if (activeTab === "btvn") {
    const codingClasses = classes.filter((c) => c.blockType === "CODING");
    const batchTargets = codingClasses
      .filter((c) => !c.isMakeupClass)
      .map((c) => c.classCode);

    return (
      <div className="space-y-3">
        <div className="mindx-card mindx-card-blue rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="font-bold text-sm">
              Đồng bộ BTVN khối Coding sang Teaching (Thang 5 tự động)
            </div>
            <div className="text-xs text-[var(--text-secondary)]">
              Chỉ quét và đẩy các lớp Coding đang hiển thị ({codingClasses.length}{" "}
              lớp). Hệ thống tự kiểm tra lại Teaching sau khi lưu để xác nhận đã
              vào điểm thật.
            </div>
          </div>
          <button
            type="button"
            disabled={isBatchActionRunning || batchTargets.length === 0}
            onClick={() => onSyncBatchBtvn(batchTargets)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-black bg-sky-600 hover:bg-sky-700 text-white shadow disabled:opacity-50"
          >
            {isBatchActionRunning ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Rocket className="w-4 h-4" />
            )}
            ⚡ Quét điểm BTVN &amp; Đẩy sang Teaching ({batchTargets.length} lớp)
          </button>
        </div>

        {codingClasses.length === 0 ? (
          <div className="mindx-card rounded-xl p-8 text-center text-sm text-[var(--text-secondary)]">
            Không có lớp Coding nào khớp bộ lọc hiện tại.
          </div>
        ) : (
          <div className="overflow-x-auto mindx-card rounded-xl">
            <table className="w-full text-left text-xs sm:text-sm border-collapse">
              <thead>
                <tr className="border-b border-[var(--border-card)] bg-[var(--surface-subtle)]">
                  <th className="p-3 font-bold">Lớp Coding &amp; GV</th>
                  <th className="p-3 font-bold">Tỷ lệ nộp BTVN gần nhất</th>
                  <th className="p-3 font-bold">Bài HV nộp GV chưa chấm</th>
                  <th className="p-3 font-bold">Trạng thái Teaching</th>
                  <th className="p-3 font-bold">Hành động &amp; Link nhanh</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-card)]">
                {codingClasses.map((cls) => {
                  const isBusy = busyClassCode === cls.classCode;
                  const b = cls.btvnSummary;
                  return (
                    <tr
                      key={cls.classCode}
                      className="hover:bg-[var(--surface-subtle)]/60 align-top"
                    >
                      <td className="p-3 space-y-1">
                        <div className="font-black text-sm">{cls.classCode}</div>
                        <div className="text-xs text-[var(--text-secondary)]">
                          Buổi {cls.currentSessionNumber || "?"} • GV:{" "}
                          <strong>{cls.mainTeacher || "Chưa gán"}</strong>
                        </div>
                      </td>

                      <td className="p-3 space-y-1">
                        {b.applicable ? (
                          <>
                            <div className="flex items-center gap-2">
                              <span
                                className={`font-black text-sm ${
                                  b.lowSubmissionWarning
                                    ? "text-rose-700 dark:text-rose-300"
                                    : "text-emerald-700 dark:text-emerald-300"
                                }`}
                              >
                                {b.submissionRatePercent}%
                              </span>
                              <span className="text-xs text-[var(--text-secondary)]">
                                ({b.submittedCount}/{b.expectedCount} HV • Buổi{" "}
                                {b.latestHomeworkSessionNumber || "?"})
                              </span>
                            </div>
                            {b.lowSubmissionWarning && (
                              <span className="inline-block px-2 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-300 text-[11px] font-bold">
                                Cảnh báo nộp thấp (&lt; 50%)
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-[var(--text-secondary)]">
                            Chưa có dữ liệu BTVN
                          </span>
                        )}
                      </td>

                      <td className="p-3 space-y-1">
                        {b.ungradedCellsCount > 0 ? (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/40">
                              Còn {b.ungradedCellsCount} bài chờ chấm
                            </span>
                            <div className="text-[11px] text-[var(--text-secondary)]">
                              Buổi: {b.ungradedSessions.join(", ")}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                            ✓ Không tồn bài chờ chấm
                          </span>
                        )}
                        <div className="text-[11px] text-[var(--text-secondary)]">
                          Đã chấm: {b.gradedCellsCount} • Làm lại: {b.redoCellsCount}
                        </div>
                      </td>

                      <td className="p-3 space-y-1">
                        {renderBtvnSyncBadge(cls)}
                        {cls.btvnSyncedAt && (
                          <div className="text-[11px] text-[var(--text-secondary)]">
                            Lúc: {cls.btvnSyncedAt.slice(0, 16).replace("T", " ")}
                          </div>
                        )}
                        {cls.btvnLastError && (
                          <div className="text-[11px] text-amber-700 dark:text-amber-300 max-w-xs">
                            {cls.btvnLastError}
                          </div>
                        )}
                      </td>

                      <td className="p-3">
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            disabled={isBusy || isBatchActionRunning}
                            onClick={() => onSyncSingleBtvn(cls.classCode)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 disabled:opacity-50"
                          >
                            {isBusy ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Rocket className="w-3.5 h-3.5" />
                            )}
                            ⚡ Đẩy điểm Teaching
                          </button>
                          <a
                            href={cls.teachingScoreBoardUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold border border-[var(--border-card)] bg-[var(--surface-subtle)] hover:opacity-85"
                          >
                            🌐 Điểm Teaching <ExternalLink className="w-3 h-3" />
                          </a>
                          <a
                            href={cls.teachingStudentsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold border border-[var(--border-card)] bg-[var(--surface-card)] hover:bg-[var(--surface-subtle)]"
                          >
                            👥 DS Học sinh <ExternalLink className="w-3 h-3" />
                          </a>
                          <a
                            href={cls.lmsHomeworkUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold border border-[var(--border-card)] bg-[var(--surface-card)] hover:bg-[var(--surface-subtle)]"
                          >
                            📝 Mở LMS <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  if (activeTab === "spck") {
    const spckClasses = classes.filter((c) => c.spckAudit.applicable);
    return (
      <div className="space-y-3">
        {spckClasses.length === 0 ? (
          <div className="mindx-card rounded-xl p-8 text-center text-sm text-[var(--text-secondary)]">
            Hiện chưa có lớp nào ở giai đoạn Buổi 12–14 hoặc vừa kết thúc trong
            bộ lọc này.
          </div>
        ) : (
          <div className="space-y-2.5">
            {spckClasses.map((cls) => {
              const s = cls.spckAudit;
              const isExpanded = Boolean(expandedSpckClasses[cls.classCode]);
              const hasGap =
                s.totalMissingUploads > 0 ||
                s.totalMissingMediaOrLinks > 0 ||
                s.totalMissingTeacherComments > 0 ||
                s.session14FinalEval.missingEvalStudents.length > 0;
              return (
                <div
                  key={cls.classCode}
                  className={`mindx-card rounded-xl p-4 space-y-3 ${
                    hasGap ? "mindx-card-amber" : "mindx-card-emerald"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-black text-base">
                          {cls.classCode}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded bg-[var(--surface-subtle)] border border-[var(--border-card)] font-semibold">
                          Buổi {cls.currentSessionNumber || "?"} • {cls.status}
                        </span>
                        <span className="text-xs text-[var(--text-secondary)]">
                          GV: <strong>{cls.mainTeacher || "Chưa rõ"}</strong>
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {(["12", "13", "14"] as const).map((sn) => {
                          const slot = s.slots[sn];
                          if (!slot.sessionOccurred) return null;
                          return (
                            <span
                              key={sn}
                              className="px-2 py-0.5 rounded bg-[var(--surface-subtle)] border border-[var(--border-card)]"
                            >
                              B{sn}: Nộp{" "}
                              <strong>
                                {slot.uploadedCount}/{slot.requiredCount}
                              </strong>{" "}
                              • NX GV:{" "}
                              <strong>
                                {slot.commentedCount}/{slot.uploadedCount}
                              </strong>
                            </span>
                          );
                        })}
                        {s.session14FinalEval.applicable && (
                          <span className="px-2 py-0.5 rounded bg-[var(--surface-subtle)] border border-[var(--border-card)]">
                            B14 Đánh giá: Demo{" "}
                            <strong>
                              {s.session14FinalEval.demoScoredCount}/
                              {s.session14FinalEval.requiredCount}
                            </strong>{" "}
                            • 9 ĐNL{" "}
                            <strong>
                              {s.session14FinalEval.competencyCompleteCount}/
                              {s.session14FinalEval.requiredCount}
                            </strong>{" "}
                            • Thư 3 phần{" "}
                            <strong>
                              {s.session14FinalEval.mindx3PartCommentCount}/
                              {s.session14FinalEval.requiredCount}
                            </strong>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleSpckExpand(cls.classCode)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold border border-[var(--border-card)] bg-[var(--surface-card)] hover:bg-[var(--surface-subtle)]"
                      >
                        <Users className="w-3.5 h-3.5" />
                        {isExpanded
                          ? "Thu gọn chi tiết HV"
                          : hasGap
                          ? `Xem danh sách thiếu (${s.totalMissingUploads} nộp / ${s.totalMissingTeacherComments} NX)`
                          : "Xem chi tiết đủ 100%"}
                        {isExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <a
                        href={cls.lmsCommentsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold border border-[var(--border-card)] bg-[var(--surface-subtle)] hover:opacity-85"
                      >
                        Mở SPCK LMS <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-[var(--border-card)] pt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                      {(["12", "13", "14"] as const).map((sn) => {
                        const slot = s.slots[sn];
                        return (
                          <div
                            key={sn}
                            className="p-2.5 rounded-lg bg-[var(--surface-subtle)] border border-[var(--border-card)] space-y-1.5"
                          >
                            <div className="font-bold">
                              Buổi {sn}{" "}
                              {slot.sessionOccurred
                                ? `(${slot.uploadedCount}/${slot.requiredCount})`
                                : "(Chưa học)"}
                            </div>
                            {slot.sessionOccurred && (
                              <>
                                <div>
                                  <span className="text-[var(--text-secondary)]">
                                    Thiếu nộp:
                                  </span>{" "}
                                  <strong className="text-rose-700 dark:text-rose-300">
                                    {slot.missingUploadStudents.length > 0
                                      ? slot.missingUploadStudents.join(", ")
                                      : "Đủ"}
                                  </strong>
                                </div>
                                <div>
                                  <span className="text-[var(--text-secondary)]">
                                    Thiếu ảnh/link:
                                  </span>{" "}
                                  <strong className="text-amber-700 dark:text-amber-300">
                                    {slot.missingImageOrLinkStudents.length > 0
                                      ? slot.missingImageOrLinkStudents.join(", ")
                                      : "Đủ"}
                                  </strong>
                                </div>
                                <div>
                                  <span className="text-[var(--text-secondary)]">
                                    Thiếu nhận xét GV:
                                  </span>{" "}
                                  <strong className="text-rose-700 dark:text-rose-300">
                                    {slot.missingTeacherCommentStudents.length > 0
                                      ? slot.missingTeacherCommentStudents.join(", ")
                                      : "Đủ"}
                                  </strong>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                      {s.session14FinalEval.applicable && (
                        <div className="md:col-span-3 p-2.5 rounded-lg bg-[var(--surface-subtle)] border border-[var(--border-card)]">
                          <span className="font-bold">
                            Thiếu phiếu đánh giá cuối khóa Buổi 14:
                          </span>{" "}
                          <strong className="text-rose-700 dark:text-rose-300">
                            {s.session14FinalEval.missingEvalStudents.length > 0
                              ? s.session14FinalEval.missingEvalStudents.join(", ")
                              : "Đã đủ 100% (Demo + 9 ĐNL + Thư 3 phần)"}
                          </strong>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (activeTab === "gt9") {
    const gt9Classes = classes.filter(
      (c) => c.spckTasks.eligibleGt9 || c.spckTasks.hasProject
    );
    const missingGt9Codes = gt9Classes
      .filter((c) => c.spckTasks.eligibleGt9 && c.spckTasks.taskStatus !== "READY")
      .map((c) => c.classCode);

    return (
      <div className="space-y-3">
        <div className="mindx-card mindx-card-purple rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="font-bold text-sm">
              Lớp &gt; Buổi 9 (Buổi 10–14) &amp; Tự động Tạo 5 Nhiệm vụ SPCK (20% × 5)
            </div>
            <label className="inline-flex items-center gap-2 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={syncProgressBySession}
                onChange={(e) => onToggleSyncProgressBySession(e.target.checked)}
                className="rounded border-slate-400"
              />
              <span>
                📈 Cập nhật luôn % tiến độ theo buổi hiện tại (B10: 0% • B11:
                20% • B12: 60% • B13: 80% • B14: 100%, không bao giờ hạ % đã có)
              </span>
            </label>
          </div>
          <button
            type="button"
            disabled={isBatchActionRunning || missingGt9Codes.length === 0}
            onClick={() => onProvisionBatchSpckTasks(missingGt9Codes)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-black bg-purple-600 hover:bg-purple-700 text-white shadow disabled:opacity-50"
          >
            {isBatchActionRunning ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            ✨ Tạo 5 nhiệm vụ SPCK cho tất cả lớp còn thiếu ({missingGt9Codes.length})
          </button>
        </div>

        {gt9Classes.length === 0 ? (
          <div className="mindx-card rounded-xl p-8 text-center text-sm text-[var(--text-secondary)]">
            Không có lớp &gt; Buổi 9 nào trong bộ lọc hiện tại.
          </div>
        ) : (
          <div className="overflow-x-auto mindx-card rounded-xl">
            <table className="w-full text-left text-xs sm:text-sm border-collapse">
              <thead>
                <tr className="border-b border-[var(--border-card)] bg-[var(--surface-subtle)]">
                  <th className="p-3 font-bold">Lớp &amp; Thời gian LMS</th>
                  <th className="p-3 font-bold">Dự án trên Teaching</th>
                  <th className="p-3 font-bold">5 Phần nhiệm vụ</th>
                  <th className="p-3 font-bold">Tiến độ HV</th>
                  <th className="p-3 font-bold">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-card)]">
                {gt9Classes.map((cls) => {
                  const isBusy = busyClassCode === cls.classCode;
                  const t = cls.spckTasks;
                  return (
                    <tr
                      key={cls.classCode}
                      className="hover:bg-[var(--surface-subtle)]/60 align-top"
                    >
                      <td className="p-3 space-y-1">
                        <div className="font-black text-sm">{cls.classCode}</div>
                        <div className="text-xs text-[var(--text-secondary)]">
                          Buổi {cls.currentSessionNumber || "?"} • GV:{" "}
                          <strong>{cls.mainTeacher || "Chưa gán"}</strong>
                        </div>
                        <div className="text-[11px] text-[var(--text-secondary)]">
                          {t.startDate || cls.startDate || "?"} &rarr;{" "}
                          {t.endDate || cls.endDate || "?"}
                        </div>
                      </td>

                      <td className="p-3 space-y-1 text-xs">
                        {t.hasProject ? (
                          <div>
                            <div className="font-bold text-emerald-700 dark:text-emerald-300">
                              ✓ {t.projectName || `SPCK - ${cls.classCode}`}
                            </div>
                            <div className="text-[11px] text-[var(--text-secondary)]">
                              ID #{t.projectId}
                            </div>
                          </div>
                        ) : (
                          <span className="font-bold text-rose-700 dark:text-rose-300">
                            Chưa tạo dự án
                          </span>
                        )}
                      </td>

                      <td className="p-3 space-y-1">
                        {renderTaskStatusBadge(cls)}
                        {cls.spckTasksLastError && (
                          <div className="text-[11px] text-rose-700 dark:text-rose-300 max-w-xs">
                            {cls.spckTasksLastError}
                          </div>
                        )}
                      </td>

                      <td className="p-3 space-y-1 text-xs">
                        <div>
                          Hiện tại: <strong>{t.averageProgressPercent}%</strong>{" "}
                          / Mục tiêu B{cls.currentSessionNumber}:{" "}
                          <strong>{t.targetProgressPercent}%</strong>
                        </div>
                        <div className="w-28 h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                          <div
                            className="h-full bg-emerald-500"
                            style={{
                              width: `${Math.min(100, Math.max(0, t.averageProgressPercent))}%`,
                            }}
                          />
                        </div>
                      </td>

                      <td className="p-3">
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            disabled={isBusy || isBatchActionRunning}
                            onClick={() => onProvisionSingleSpckTasks(cls.classCode)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50"
                          >
                            {isBusy ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Sparkles className="w-3.5 h-3.5" />
                            )}
                            ✨ Tạo / Bổ sung 5 nhiệm vụ
                          </button>
                          <a
                            href={cls.teachingProgressUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold border border-[var(--border-card)] bg-[var(--surface-subtle)] hover:opacity-85"
                          >
                            🌐 Mở Dự án Teaching{" "}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // Tab 5: Instructors + Zalo 1-click Copy + Early Warnings
  const warnings = flattenEarlyWarnings(classes);
  return (
    <div className="space-y-4">
      <div className="mindx-card mindx-card-emerald rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="font-bold text-sm">
            Tin nhắn tổng hợp nhắc việc toàn cơ sở (Zalo Group Giảng viên)
          </div>
          <div className="text-xs text-[var(--text-secondary)]">
            Soạn sẵn đầy đủ đầu việc còn thiếu của tất cả giảng viên để dán vào
            nhóm Zalo cơ sở chỉ bằng 1 chạm.
          </div>
        </div>
        <button
          type="button"
          onClick={() => onCopyText("CAMPUS", campusZaloSummaryText)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-black bg-emerald-600 hover:bg-emerald-700 text-white shadow"
        >
          {copiedKey === "CAMPUS" ? (
            <>
              <Check className="w-4 h-4" /> Đã copy tổng hợp cơ sở!
            </>
          ) : (
            <>
              <Copy className="w-4 h-4" /> 📋 Copy tổng hợp toàn cơ sở
            </>
          )}
        </button>
      </div>

      <div className="mindx-card rounded-xl overflow-x-auto">
        <table className="w-full text-left text-xs sm:text-sm border-collapse">
          <thead>
            <tr className="border-b border-[var(--border-card)] bg-[var(--surface-subtle)]">
              <th className="p-3 font-bold">Giảng viên</th>
              <th className="p-3 font-bold">Số lớp</th>
              <th className="p-3 font-bold">Thiếu vận hành tuần</th>
              <th className="p-3 font-bold">BTVN chờ chấm</th>
              <th className="p-3 font-bold">Thiếu NX SPCK</th>
              <th className="p-3 font-bold">Thiếu NV &gt; B9</th>
              <th className="p-3 font-bold">Nhắc việc Zalo 1-chạm</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-card)]">
            {instructors.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="p-6 text-center text-sm text-[var(--text-secondary)]"
                >
                  Chưa có dữ liệu tổng hợp theo giảng viên.
                </td>
              </tr>
            ) : (
              instructors.map((inst) => {
                const key = `INST_${inst.instructorName}`;
                const isCopied = copiedKey === key;
                return (
                  <tr
                    key={inst.instructorName}
                    className="hover:bg-[var(--surface-subtle)]/60 align-top"
                  >
                    <td className="p-3">
                      <div className="font-bold">{inst.instructorName}</div>
                      <div className="text-[11px] text-[var(--text-secondary)]">
                        {inst.classCodes.join(", ")}
                      </div>
                    </td>
                    <td className="p-3 font-semibold">{inst.totalClasses}</td>
                    <td className="p-3">
                      <strong
                        className={
                          inst.missingWeeklyOpsClasses > 0
                            ? "text-rose-700 dark:text-rose-300"
                            : "text-emerald-700 dark:text-emerald-300"
                        }
                      >
                        {inst.missingWeeklyOpsClasses}
                      </strong>
                    </td>
                    <td className="p-3">
                      <strong
                        className={
                          inst.ungradedBtvnTotal > 0
                            ? "text-amber-700 dark:text-amber-300"
                            : "text-emerald-700 dark:text-emerald-300"
                        }
                      >
                        {inst.ungradedBtvnTotal}
                      </strong>
                    </td>
                    <td className="p-3">
                      <strong
                        className={
                          inst.missingSpckCommentsTotal > 0
                            ? "text-rose-700 dark:text-rose-300"
                            : "text-emerald-700 dark:text-emerald-300"
                        }
                      >
                        {inst.missingSpckCommentsTotal}
                      </strong>
                    </td>
                    <td className="p-3">
                      <strong
                        className={
                          inst.missingSpckTasksClasses > 0
                            ? "text-purple-700 dark:text-purple-300"
                            : "text-emerald-700 dark:text-emerald-300"
                        }
                      >
                        {inst.missingSpckTasksClasses}
                      </strong>
                    </td>
                    <td className="p-3 space-y-2">
                      <button
                        type="button"
                        onClick={() => onCopyText(key, inst.zaloReminderText)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        {isCopied ? (
                          <>
                            <Check className="w-3.5 h-3.5" /> Đã copy!
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" /> 📋 Copy nhắc việc Zalo
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mindx-card mindx-card-red rounded-xl p-4 space-y-3">
        <div className="font-bold text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
          Cảnh báo sớm Học viên &amp; Dữ liệu lệch ({warnings.length})
        </div>
        {warnings.length === 0 ? (
          <div className="text-xs text-[var(--text-secondary)]">
            Không phát hiện học viên nghỉ liên tiếp, bỏ BTVN 3 buổi, điểm CP thấp
            (&lt; 2.5), lệch sĩ số hay nợ học bù trong bộ lọc này.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {warnings.map((w, idx) => (
              <div
                key={`${w.classCode}_${w.type}_${w.studentName || idx}`}
                className="p-3 rounded-lg bg-[var(--surface-subtle)] border border-[var(--border-card)] text-xs space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-black">
                    {w.classCode}
                    {w.studentName ? ` • ${w.studentName}` : ""}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      w.severity === "HIGH"
                        ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                        : "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                    }`}
                  >
                    {w.type}
                  </span>
                </div>
                <div className="text-[var(--text-secondary)]">
                  GV: {w.mainTeacher} — {w.detail}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
