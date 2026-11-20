"use client";

import React from "react";
import { Monitor, BarChart3, Dices } from "lucide-react";
import { ClassPicker, type ClassPickerOption } from "@/components/class-picker";

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
  saveIndicator,
}: ClassroomToolbarProps) {
  return (
    <div className="cm-shell-card px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <ClassPicker
          scope="running"
          variant="card"
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
          className="cm-select px-2.5 py-1.5 text-xs sm:text-sm font-bold max-w-[270px] truncate cursor-pointer focus:outline-none"
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

        <div className="hidden md:block w-[2px] h-7 bg-slate-300 dark:bg-slate-700 mx-0.5" />

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

      <div className="flex flex-wrap items-center gap-2 md:pl-3 md:border-l-2 md:border-slate-200 dark:md:border-slate-700">
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
          className="px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold bg-blue-50 hover:bg-blue-100 border border-blue-300 text-blue-800 dark:bg-blue-900/30 dark:border-blue-500/50 dark:text-blue-200 disabled:opacity-45 inline-flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap"
        >
          <Dices className="w-4 h-4" />
          <span>Gọi tên</span>
        </button>

        <button
          type="button"
          data-testid="cm-projector-toggle-btn"
          onClick={onToggleProjector}
          className="mindx-dark-btn px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm inline-flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap"
        >
          <Monitor className="w-4 h-4" />
          <span>{isProjectorMode ? "Thoát chiếu" : "Chiếu lớp học"}</span>
        </button>

        <button
          type="button"
          data-testid="cm-open-summary-btn"
          onClick={onOpenSummary}
          className="mindx-dark-btn px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold bg-orange-700 hover:bg-orange-600 text-white shadow-sm inline-flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap"
        >
          <BarChart3 className="w-4 h-4" />
          <span>Tổng hợp buổi</span>
        </button>
      </div>
    </div>
  );
}
