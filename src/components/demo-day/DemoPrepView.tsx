"use client";

import React, { useState } from "react";
import type { DemoDayStudentItem } from "@/lib/demo-day/demo-day-helpers";

interface DemoPrepViewProps {
  students: DemoDayStudentItem[];
  demoSheetUrl: string;
  hasAnyGameMakerProject: boolean;
  busy: boolean;
  preppingGm: boolean;
  onMoveOrder: (index: number, delta: -1 | 1) => void;
  onToggleExcluded: (studentId: string, nextExcluded: boolean) => void;
  onSaveSlideUrl: (studentId: string, slideUrl: string) => void;
  onChangeEntry: (studentId: string, entryValue: string) => void;
  onTestRun: (student: DemoDayStudentItem) => void;
  onPrepGameMakerAll: () => void;
  onRefresh: () => void;
}

export function DemoPrepView({
  students,
  demoSheetUrl,
  hasAnyGameMakerProject,
  busy,
  preppingGm,
  onMoveOrder,
  onToggleExcluded,
  onSaveSlideUrl,
  onChangeEntry,
  onTestRun,
  onPrepGameMakerAll,
  onRefresh,
}: DemoPrepViewProps) {
  const [slideDrafts, setSlideDrafts] = useState<Record<string, string>>({});
  const [editingSlideIds, setEditingSlideIds] = useState<Record<string, boolean>>({});

  const presentStudents = students.filter((s) => !s.excluded);
  const readyCount = presentStudents.filter(
    (s) => s.slide.kind !== "MISSING" && s.product.kind !== "MISSING"
  ).length;

  const commitSlideSave = (studentId: string) => {
    const val = String(slideDrafts[studentId] || "").trim();
    onSaveSlideUrl(studentId, val);
    setEditingSlideIds((prev) => {
      const next = { ...prev };
      delete next[studentId];
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {/* Top Strip */}
      <div className="dd-shell-card rounded-2xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
        <span
          data-testid="dd-prep-ready-count"
          className={`text-sm font-extrabold ${
            presentStudents.length > 0 && readyCount === presentStudents.length
              ? "dd-pill-success px-2.5 py-1 rounded-lg"
              : "dd-pill-warning px-2.5 py-1 rounded-lg"
          }`}
        >
          Đủ bài: {readyCount}/{presentStudents.length}
        </span>

        <div className="flex flex-wrap items-center gap-2">
          {demoSheetUrl && (
            <a
              href={demoSheetUrl}
              target="_blank"
              rel="noreferrer"
              data-testid="dd-judge-sheet-link"
              className="dd-btn-slide px-3 py-1.5 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center gap-1 cursor-pointer"
            >
              <span>📊 Bảng điểm ↗</span>
            </a>
          )}

          {hasAnyGameMakerProject && (
            <button
              type="button"
              data-testid="dd-prep-gm-btn"
              disabled={busy || preppingGm}
              onClick={onPrepGameMakerAll}
              className="dd-btn-slide px-3 py-1.5 rounded-xl text-xs sm:text-sm font-bold cursor-pointer disabled:opacity-50"
            >
              {preppingGm ? "⏳ Đang giải nén..." : "⚡ Giải nén GM"}
            </button>
          )}

          <button
            type="button"
            data-testid="dd-refresh-btn"
            disabled={busy}
            onClick={onRefresh}
            className="dd-btn-slide px-3 py-1.5 rounded-xl text-xs sm:text-sm font-bold cursor-pointer disabled:opacity-50"
          >
            🔄 Làm mới
          </button>
        </div>
      </div>

      {/* Student Prep Rows */}
      <div className="space-y-2">
        {students.map((stu, idx) => {
          const isEditingSlide =
            stu.slide.kind === "MISSING" || Boolean(editingSlideIds[stu.studentId]);

          return (
            <div
              key={stu.studentId}
              data-testid={`dd-prep-row-${stu.studentId}`}
              className={`dd-shell-card rounded-xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5 ${
                stu.excluded ? "opacity-65" : ""
              }`}
            >
              {/* Order arrows + Presence */}
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="w-6 text-center text-xs font-extrabold dd-muted">
                  #{idx + 1}
                </span>
                <button
                  type="button"
                  data-testid={`dd-move-up-${stu.studentId}`}
                  disabled={busy || idx === 0}
                  onClick={() => onMoveOrder(idx, -1)}
                  className="dd-btn-slide px-2 py-1 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                >
                  ↑
                </button>
                <button
                  type="button"
                  data-testid={`dd-move-down-${stu.studentId}`}
                  disabled={busy || idx === students.length - 1}
                  onClick={() => onMoveOrder(idx, 1)}
                  className="dd-btn-slide px-2 py-1 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                >
                  ↓
                </button>
                <button
                  type="button"
                  data-testid={`dd-toggle-excluded-${stu.studentId}`}
                  disabled={busy}
                  onClick={() => onToggleExcluded(stu.studentId, !stu.excluded)}
                  className={`px-2 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                    stu.excluded ? "dd-pill-error" : "dd-pill-success"
                  }`}
                >
                  {stu.excluded ? "Vắng" : "Có mặt"}
                </button>
              </div>

              {/* Mini 16:9 Thumbnail + Name */}
              <div className="flex items-center gap-2.5 min-w-[180px] flex-1">
                <div className="w-14 aspect-video rounded-md overflow-hidden dd-subtle-box shrink-0">
                  {stu.thumbnailUrl && (
                    <img
                      src={stu.thumbnailUrl}
                      alt={stu.fullName}
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
                <div className="min-w-0">
                  <div
                    data-testid={`dd-prep-name-${stu.studentId}`}
                    className="text-sm font-extrabold dd-title truncate"
                  >
                    {stu.fullName}
                  </div>
                  <div className="text-xs dd-muted truncate">{stu.projectTitle}</div>
                </div>
              </div>

              {/* Slide status or Canva Link Input */}
              <div className="shrink-0">
                {!isEditingSlide ? (
                  <div className="flex items-center gap-1">
                    <span
                      data-testid={`dd-slide-badge-${stu.studentId}`}
                      className="dd-pill-success px-2.5 py-1 rounded-lg text-xs font-bold inline-flex items-center gap-1"
                    >
                      ✅ Slide
                    </span>
                    <button
                      type="button"
                      data-testid={`dd-edit-slide-${stu.studentId}`}
                      onClick={() => {
                        setSlideDrafts((prev) => ({
                          ...prev,
                          [stu.studentId]: stu.slide.url || "",
                        }));
                        setEditingSlideIds((prev) => ({
                          ...prev,
                          [stu.studentId]: true,
                        }));
                      }}
                      className="dd-btn-slide px-2 py-1 rounded-lg text-xs font-bold cursor-pointer"
                    >
                      ✎
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <input
                      type="url"
                      data-testid={`dd-slide-input-${stu.studentId}`}
                      value={slideDrafts[stu.studentId] ?? ""}
                      onChange={(e) =>
                        setSlideDrafts((prev) => ({
                          ...prev,
                          [stu.studentId]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitSlideSave(stu.studentId);
                        }
                      }}
                      placeholder="Link Canva..."
                      className="dd-input w-36 px-2.5 py-1 rounded-lg text-xs focus:outline-none"
                    />
                    <button
                      type="button"
                      data-testid={`dd-save-slide-${stu.studentId}`}
                      disabled={busy}
                      onClick={() => commitSlideSave(stu.studentId)}
                      className="dd-btn-product px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      Lưu
                    </button>
                    {stu.slide.kind !== "MISSING" && (
                      <button
                        type="button"
                        onClick={() =>
                          setEditingSlideIds((prev) => {
                            const next = { ...prev };
                            delete next[stu.studentId];
                            return next;
                          })
                        }
                        className="dd-btn-slide px-2 py-1 rounded-lg text-xs font-bold cursor-pointer"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Entry Selector + Test Run */}
              <div className="flex items-center gap-1.5 shrink-0">
                <select
                  data-testid={`dd-entry-select-${stu.studentId}`}
                  disabled={busy || stu.entryOptions.length === 0}
                  value={stu.selectedEntryValue}
                  onChange={(e) => onChangeEntry(stu.studentId, e.target.value)}
                  className="dd-input max-w-[190px] px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  {stu.entryOptions.length === 0 ? (
                    <option value="">Chưa có file</option>
                  ) : (
                    stu.entryOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))
                  )}
                </select>

                <button
                  type="button"
                  data-testid={`dd-test-run-${stu.studentId}`}
                  disabled={busy || stu.product.kind === "MISSING"}
                  onClick={() => onTestRun(stu)}
                  className="dd-btn-slide px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  ▶️ Thử
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
