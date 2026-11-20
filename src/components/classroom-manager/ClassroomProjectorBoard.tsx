"use client";

import React from "react";
import { Dices, X } from "lucide-react";
import {
  rankStudentsForProjector,
  type ClassroomStudentState,
} from "@/lib/classroom/classroom-manager-helpers";

interface ClassroomProjectorBoardProps {
  classId: string;
  sessionNumber: number;
  students: ClassroomStudentState[];
  onQuickStar: (studentId: string) => void;
  onQuickMedal: (studentId: string) => void;
  onOpenRandomPicker: () => void;
  onExitProjector: () => void;
}

export function ClassroomProjectorBoard({
  classId,
  sessionNumber,
  students,
  onQuickStar,
  onQuickMedal,
  onOpenRandomPicker,
  onExitProjector,
}: ClassroomProjectorBoardProps) {
  const rankedRows = rankStudentsForProjector(students);
  const totalTodayStars = rankedRows.reduce((acc, r) => acc + r.stars, 0);
  const totalTodayMedals = rankedRows.reduce((acc, r) => acc + r.medals, 0);

  return (
    <div
      data-testid="cm-projector-board"
      className="cm-projector-shell mindx-dark-keep p-4 sm:p-6 space-y-4"
    >
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-400/25">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xl sm:text-2xl font-black tracking-tight text-white">
            🏆 BẢNG THI ĐUA SAO · {classId} (BUỔI {sessionNumber})
          </span>
          <div className="flex items-center gap-2 pl-3 border-l border-slate-400/30">
            <span className="px-3 py-1 rounded-lg text-xs sm:text-sm font-extrabold bg-amber-500/20 border border-amber-400/50 text-amber-200">
              ⭐ Hôm nay: {totalTodayStars} sao
            </span>
            <span className="px-3 py-1 rounded-lg text-xs sm:text-sm font-extrabold bg-sky-500/20 border border-sky-400/50 text-sky-200">
              🏅 Huy hiệu: {totalTodayMedals}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onOpenRandomPicker}
            className="mindx-dark-btn px-3.5 py-2 rounded-xl text-xs sm:text-sm font-extrabold bg-blue-600 hover:bg-blue-500 text-white inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Dices className="w-4 h-4" />
            <span>Quay gọi tên</span>
          </button>
          <button
            type="button"
            data-testid="cm-exit-projector-btn"
            onClick={onExitProjector}
            className="mindx-dark-btn px-3.5 py-2 rounded-xl text-xs sm:text-sm font-extrabold bg-slate-700/80 hover:bg-slate-600 border border-slate-400/40 text-white inline-flex items-center gap-1.5 cursor-pointer"
          >
            <X className="w-4 h-4" />
            <span>Thoát chiếu</span>
          </button>
        </div>
      </div>

      {/* Horizontal Column Headers */}
      <div className="overflow-x-auto">
        <div className="min-w-[1020px] space-y-2.5">
          <div className="grid grid-cols-[84px_1.15fr_2.2fr_0.9fr_0.85fr_1fr] items-center px-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-300">
            <div className="text-center">Hạng</div>
            <div className="px-2">Học viên</div>
            <div className="px-2">Sao hôm nay (Xếp hàng ngang)</div>
            <div className="text-center">Huy hiệu</div>
            <div className="text-center">Tích lũy khóa</div>
            <div className="text-center">Khen nhanh</div>
          </div>

          {rankedRows.map((row) => {
            const isTop1 = row.rank === 1;
            const isTop2 = row.rank === 2;
            const isTop3 = row.rank === 3;
            const rowCls = row.isAbsent
              ? "cm-projector-row opacity-55 border-dashed"
              : isTop1
              ? "cm-projector-row-top1"
              : isTop2
              ? "cm-projector-row cm-projector-row-top2"
              : isTop3
              ? "cm-projector-row cm-projector-row-top3"
              : "cm-projector-row";

            const filledStarsToDraw = Math.min(row.stars, 8);
            const extraStars = Math.max(0, row.stars - 8);
            const ghostStars = Math.max(0, 5 - filledStarsToDraw);

            return (
              <div
                key={row.studentId}
                data-testid={`cm-projector-row-${row.studentId}`}
                className={`grid grid-cols-[84px_1.15fr_2.2fr_0.9fr_0.85fr_1fr] items-center rounded-xl min-h-[76px] ${rowCls}`}
              >
                {/* Rank */}
                <div className="flex items-center justify-center h-full border-r border-slate-400/20 px-2">
                  <span
                    className={`px-3 py-2 rounded-lg text-sm font-black whitespace-nowrap ${
                      row.isAbsent
                        ? "bg-rose-500/20 text-rose-200 border border-rose-400/40"
                        : isTop1
                        ? "bg-amber-400 text-slate-950"
                        : isTop2
                        ? "bg-slate-200 text-slate-950"
                        : isTop3
                        ? "bg-orange-200 text-orange-950"
                        : "bg-blue-500/20 text-blue-200 border border-blue-400/40"
                    }`}
                  >
                    {row.isAbsent
                      ? "Vắng"
                      : isTop1
                      ? "👑 #1"
                      : isTop2
                      ? "🥈 #2"
                      : isTop3
                      ? "🥉 #3"
                      : `#${row.rank}`}
                  </span>
                </div>

                {/* Name */}
                <div className="flex items-center h-full border-r border-slate-400/20 px-3.5">
                  <span className="text-base sm:text-lg font-black text-white truncate">
                    {row.fullName}
                  </span>
                </div>

                {/* Horizontal Stars Track */}
                <div className="flex items-center h-full border-r border-slate-400/20 px-3">
                  <div className="cm-projector-track w-full flex items-center justify-between gap-2 border border-amber-400/35 rounded-lg px-3 py-2">
                    {row.isAbsent ? (
                      <span className="text-sm font-semibold text-slate-300">
                        Nghỉ buổi {sessionNumber}
                      </span>
                    ) : (
                      <div className="flex items-center gap-1.5 text-lg sm:text-xl leading-none">
                        {Array.from({ length: filledStarsToDraw }, (_, i) => (
                          <span key={`s-${i}`}>⭐</span>
                        ))}
                        {Array.from({ length: ghostStars }, (_, i) => (
                          <span key={`g-${i}`} className="opacity-20 grayscale">
                            ⭐
                          </span>
                        ))}
                        {extraStars > 0 && (
                          <span className="text-xs font-extrabold text-amber-300 ml-1">
                            +{extraStars}
                          </span>
                        )}
                      </div>
                    )}
                    <span className="px-2.5 py-1 rounded-md text-xs font-black bg-amber-400/20 border border-amber-300/45 text-amber-200 whitespace-nowrap">
                      {row.stars} sao
                    </span>
                  </div>
                </div>

                {/* Horizontal Medals Box */}
                <div className="flex items-center justify-center h-full border-r border-slate-400/20 px-2.5">
                  <div
                    className={`cm-projector-track w-full h-11 rounded-lg px-3 flex items-center justify-between border ${
                      row.medals > 0 ? "border-amber-400/45" : "border-slate-500/35"
                    }`}
                  >
                    <span className={row.medals > 0 ? "text-lg" : "text-lg opacity-30"}>🏅</span>
                    <span
                      className={`text-xs font-extrabold ${
                        row.medals > 0 ? "text-amber-200" : "text-slate-400"
                      }`}
                    >
                      {row.medals > 0 ? `× ${row.medals}` : "0"}
                    </span>
                  </div>
                </div>

                {/* Course Total */}
                <div className="flex items-center justify-center h-full border-r border-slate-400/20 px-2.5">
                  <div className="w-full h-11 rounded-lg bg-sky-500/15 border border-sky-400/40 flex items-center justify-center text-xs sm:text-sm font-black text-sky-200 whitespace-nowrap">
                    🌟 {row.courseTotalStars} ⭐
                  </div>
                </div>

                {/* Quick Praise */}
                <div className="flex items-center justify-center h-full px-2.5">
                  <div className="w-full grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      disabled={row.isAbsent}
                      onClick={() => onQuickStar(row.studentId)}
                      className="mindx-dark-btn h-10 rounded-lg bg-emerald-600/35 hover:bg-emerald-500/50 border border-emerald-400/55 text-emerald-100 text-xs font-extrabold disabled:opacity-35 cursor-pointer"
                    >
                      +1 ⭐
                    </button>
                    <button
                      type="button"
                      disabled={row.isAbsent}
                      onClick={() => onQuickMedal(row.studentId)}
                      className="mindx-dark-btn h-10 rounded-lg bg-amber-600/35 hover:bg-amber-500/50 border border-amber-400/55 text-amber-100 text-xs font-extrabold disabled:opacity-35 cursor-pointer"
                    >
                      +🏅
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
