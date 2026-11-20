"use client";

import React from "react";
import { Dices } from "lucide-react";
import type { ClassroomStudentState } from "@/lib/classroom/classroom-manager-helpers";

interface RandomStudentModalProps {
  open: boolean;
  pickedStudent: ClassroomStudentState | null;
  onSpinAgain: () => void;
  onRewardStar: (studentId: string) => void;
  onClose: () => void;
}

export function RandomStudentModal({
  open,
  pickedStudent,
  onSpinAgain,
  onRewardStar,
  onClose,
}: RandomStudentModalProps) {
  if (!open) return null;

  return (
    <div
      data-testid="cm-random-modal"
      className="cm-modal-backdrop fixed inset-0 z-50 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div className="cm-shell-card w-full max-w-md p-6 text-center space-y-5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-extrabold uppercase tracking-wider opacity-80">
            🎲 Gọi tên phát biểu ngẫu nhiên
          </span>
          <button
            type="button"
            onClick={onClose}
            className="cm-act-idle px-2.5 py-1 rounded-md text-xs font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="cm-slot-star rounded-2xl py-6 px-4 space-y-2">
          <div className="text-xs font-bold uppercase tracking-wider opacity-75">
            Mời bạn trả lời
          </div>
          <div className="text-2xl font-black">
            {pickedStudent ? pickedStudent.fullName : "Không có học viên có mặt"}
          </div>
          {pickedStudent && (
            <div className="text-xs font-bold">
              Hiện có: ⭐ {pickedStudent.stars} · 🏅 {pickedStudent.medals}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onSpinAgain}
            className="mindx-dark-btn py-2.5 px-3 rounded-xl text-sm font-extrabold bg-blue-600 hover:bg-blue-500 text-white inline-flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Dices className="w-4 h-4" />
            <span>Quay bạn khác</span>
          </button>

          <button
            type="button"
            disabled={!pickedStudent}
            onClick={() => {
              if (pickedStudent) {
                onRewardStar(pickedStudent.studentId);
              }
            }}
            className="mindx-dark-btn py-2.5 px-3 rounded-xl text-sm font-extrabold bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-45 cursor-pointer"
          >
            🙋 Phát biểu (+1⭐)
          </button>
        </div>
      </div>
    </div>
  );
}
