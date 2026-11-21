"use client";

import React from "react";
import { ClassPicker, type ClassPickerOption } from "@/components/class-picker";

export type DemoMode = "stage" | "prep";

export interface DemoStatusPill {
  text: string;
  tone: "success" | "primary" | "warning" | "error";
}

interface DemoTopBarProps {
  classId: string;
  classes: ClassPickerOption[];
  mode: DemoMode;
  statusPill: DemoStatusPill | null;
  busy: boolean;
  hasStudents: boolean;
  onClassChange: (nextClassId: string) => void;
  onClassesRefreshed: (nextClasses: ClassPickerOption[]) => void;
  onModeChange: (nextMode: DemoMode) => void;
  onShuffle: () => void;
}

export function DemoTopBar({
  classId,
  classes,
  mode,
  statusPill,
  busy,
  hasStudents,
  onClassChange,
  onClassesRefreshed,
  onModeChange,
  onShuffle,
}: DemoTopBarProps) {
  const pillClass =
    statusPill?.tone === "error"
      ? "dd-pill-error"
      : statusPill?.tone === "warning"
      ? "dd-pill-warning"
      : statusPill?.tone === "primary"
      ? "dd-pill-primary"
      : "dd-pill-success";

  return (
    <div className="dd-shell-card rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <ClassPicker
          scope="spck"
          variant="hero"
          autoRestore={false}
          showRefreshButton={false}
          disabled={busy}
          value={classId}
          classes={classes}
          onChange={onClassChange}
          onClassesRefreshed={(nextList) => onClassesRefreshed(nextList)}
        />

        <div className="dd-subtle-box inline-flex rounded-xl p-1 gap-1">
          <button
            type="button"
            data-testid="dd-tab-stage"
            onClick={() => onModeChange("stage")}
            className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold cursor-pointer whitespace-nowrap ${
              mode === "stage" ? "dd-tab-active" : "dd-tab-idle"
            }`}
          >
            🎤 Sân khấu
          </button>
          <button
            type="button"
            data-testid="dd-tab-prep"
            onClick={() => onModeChange("prep")}
            className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold cursor-pointer whitespace-nowrap ${
              mode === "prep" ? "dd-tab-active" : "dd-tab-idle"
            }`}
          >
            🛠️ Chuẩn bị
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        {statusPill && (
          <span
            data-testid="dd-status-pill"
            className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap ${pillClass}`}
          >
            {statusPill.text}
          </span>
        )}

        <button
          type="button"
          data-testid="dd-shuffle-btn"
          disabled={busy || !hasStudents}
          onClick={onShuffle}
          className="dd-btn-slide px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap"
        >
          <span>🎲</span>
          <span>Bốc thăm</span>
        </button>
      </div>
    </div>
  );
}
