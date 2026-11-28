"use client";

import React from "react";
import { Monitor, BarChart3, Dices } from "lucide-react";
import { ClassPicker, type ClassPickerOption } from "@/components/class-picker";
import { isRoboticsClassCodePure } from "@/lib/checkpoint/competency-specs";

export interface ClassroomSessionOption {
  sessionNumber: number;
  sessionId: string;
  topic: string;
  date?: string;
}

interface ClassroomToolbarProps {
  classes: ClassPickerOption[];
  classId: string;
  onClassChange: (code: string) => void;
  onRefreshClasses: () => Promise<void>;
  isRefreshingClasses: boolean;
  sessions: ClassroomSessionOption[];
  sessionNumber: number;
  onSessionChange: (num: number) => void;
  presentAndLateCount: number;
  totalStudents: number;
  totalStars: number;
  totalMedals: number;
  totalIssues: number;
  isProjectorMode: boolean;
  onToggleProjector: () => void;
  onOpenRandomPicker: () => void;
  onOpenSummary: () => void;
  onSyncBtvn?: (forceLiveScrape?: boolean) => void;
  isSyncingBtvn?: boolean;
  saveIndicator: "idle" | "saving" | "saved" | "error";
}

export function ClassroomToolbar({
  classes,
  classId,
  onClassChange,
  onRefreshClasses,
  isRefreshingClasses,
  sessions,
  sessionNumber,
  onSessionChange,
  presentAndLateCount,
  totalStudents,
  totalStars,
  totalMedals,
  totalIssues,
  isProjectorMode,
  onToggleProjector,
  onOpenRandomPicker,
  onOpenSummary,
  onSyncBtvn,
  isSyncingBtvn = false,
  saveIndicator,
}: ClassroomToolbarProps) {
  const showSyncBtvnBtn =
    Boolean(onSyncBtvn) &&
    Boolean(classId) &&
    !isRoboticsClassCodePure(classId) &&
    sessionNumber >= 2;
  return (
    <div className="cm-shell-card px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <ClassPicker
          scope="running"
          variant="hero"
          autoRestore={false}
          value={classId}
          classes={classes}
          onChange={onClassChange}
          onRefresh={onRefreshClasses}
          isRefreshing={isRefreshingClasses}
          showRefreshButton={true}
        />

        <select
          aria-label="Chọn buổi học"
          data-testid="cm-session-select"
          value={sessionNumber}
          onChange={(e) => onSessionChange(Number(e.target.value))}
          className="cm-select px-2.5 py-1.5 pr-7 text-xs sm:text-sm font-bold max-w-[320px] truncate cursor-pointer focus:outline-none"
        >
          {(sessions.length > 0
            ? sessions
            : Array.from({ length: 14 }, (_, idx) => ({
                sessionNumber: idx + 1,
                sessionId: "",
                topic: `Buổi học ${idx + 1}`,
              }))
          ).map((s) => (
            <option key={s.sessionNumber} value={s.sessionNumber}>
              {`Buổi ${s.sessionNumber} — ${s.topic}`}
            </option>
          ))}
        </select>

        <div className="flex flex-wrap items-center gap-1.5">
          <span
            data-testid="cm-kpi-attendance"
            className="cm-stat-pill px-2.5 py-1 rounded-lg text-xs font-extrabold whitespace-nowrap"
          >
            👥 Sĩ số: {presentAndLateCount}/{totalStudents}
          </span>
          <span
            data-testid="cm-kpi-stars"
            className="cm-stat-star px-2.5 py-1 rounded-lg text-xs font-extrabold whitespace-nowrap"
          >
            ⭐ Sao: {totalStars}
          </span>
          <span
            data-testid="cm-kpi-medals"
            className="cm-stat-medal px-2.5 py-1 rounded-lg text-xs font-extrabold whitespace-nowrap"
          >
            🏅 Top 3: {totalMedals}/3
          </span>
          <span
            data-testid="cm-kpi-issues"
            className="cm-stat-err px-2.5 py-1 rounded-lg text-xs font-extrabold whitespace-nowrap"
          >
            ⚠️ Lỗi: {totalIssues}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {saveIndicator === "saving" && (
          <span className="text-[11px] font-semibold text-sky-700 dark:text-sky-300">
            Đang lưu...
          </span>
        )}
        {saveIndicator === "saved" && (
          <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
            ✓ Đã lưu
          </span>
        )}
        {saveIndicator === "error" && (
          <span className="text-[11px] font-semibold text-rose-700 dark:text-rose-300">
            ⚠ Lỗi lưu
          </span>
        )}

        <button
          type="button"
          data-testid="cm-random-picker-btn"
          onClick={onOpenRandomPicker}
          disabled={presentAndLateCount === 0}
          className="neo-btn-neutral px-3 py-1.5 rounded-lg text-xs sm:text-sm font-extrabold disabled:opacity-45 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
        >
          <Dices className="w-4 h-4" />
          <span>Gọi tên</span>
        </button>

        {showSyncBtvnBtn && (
          <button
            type="button"
            data-testid="cm-sync-btvn-btn"
            onClick={(e) => onSyncBtvn?.(e.shiftKey)}
            disabled={isSyncingBtvn}
            title="Quét danh sách học viên chưa nộp BTVN buổi trước từ LMS (Giữ Shift + Bấm để quét mới trực tiếp từ LMS)"
            className="neo-btn-purple px-3 py-1.5 rounded-lg text-xs sm:text-sm font-black disabled:opacity-45 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap mindx-dark-keep"
          >
            <span>{isSyncingBtvn ? "⏳ Đang quét..." : "📥 Quét Chưa BTVN"}</span>
          </button>
        )}

        <button
          type="button"
          data-testid="cm-projector-toggle-btn"
          onClick={onToggleProjector}
          className="neo-btn-blue px-3 py-1.5 rounded-lg text-xs sm:text-sm font-black inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap mindx-dark-keep"
        >
          <Monitor className="w-4 h-4" />
          <span>{isProjectorMode ? "Thoát chiếu" : "Chiếu lớp học"}</span>
        </button>

        <button
          type="button"
          data-testid="cm-open-summary-btn"
          onClick={onOpenSummary}
          className="neo-btn-yellow px-3 py-1.5 rounded-lg text-xs sm:text-sm font-black inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
        >
          <BarChart3 className="w-4 h-4" />
          <span>Tổng hợp buổi</span>
        </button>
      </div>
    </div>
  );
}
