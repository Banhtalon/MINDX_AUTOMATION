"use client";

import React, { useEffect, useState } from "react";
import type { DemoDayStudentItem } from "@/lib/demo-day/demo-day-helpers";

interface DemoStageViewProps {
  students: DemoDayStudentItem[];
  currentStudentId: string;
  activeProcessCount: number;
  launchingAction: string | null;
  onSelectStudent: (studentId: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onOpenSlide: (student: DemoDayStudentItem) => void;
  onRunProduct: (student: DemoDayStudentItem) => void;
  onStopApps: () => void;
}

export function DemoStageView({
  students,
  currentStudentId,
  activeProcessCount,
  launchingAction,
  onSelectStudent,
  onPrev,
  onNext,
  onOpenSlide,
  onRunProduct,
  onStopApps,
}: DemoStageViewProps) {
  const [failedThumbKeys, setFailedThumbKeys] = useState<Record<string, boolean>>({});

  const activeIdx = Math.max(
    0,
    students.findIndex((s) => s.studentId === currentStudentId)
  );
  const currentStudent = students[activeIdx] || null;

  useEffect(() => {
    setFailedThumbKeys((prev) => (Object.keys(prev).length > 100 ? {} : prev));
  }, [students]);

  if (!currentStudent) {
    return (
      <div className="dd-shell-card rounded-2xl p-8 text-center space-y-2">
        <div className="text-lg font-bold dd-title">Chưa có danh sách học viên</div>
        <div className="text-sm dd-muted">
          Hãy chọn lớp có học viên hoặc đồng bộ lớp từ MindX LMS.
        </div>
      </div>
    );
  }

  const thumbKey = `${currentStudent.studentId}|${currentStudent.thumbnailUrl}`;
  const isThumbBroken = Boolean(failedThumbKeys[thumbKey]);
  const hasSlide = currentStudent.slide.kind !== "MISSING";
  const hasProduct = currentStudent.product.kind !== "MISSING";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
      {/* Left Stage Card */}
      <div className="lg:col-span-8 dd-shell-card rounded-2xl p-5 flex flex-col justify-between space-y-4">
        <div className="space-y-3">
          {/* Top strip: Turn + optional Stop Running App */}
          <div className="flex items-center justify-between gap-2">
            <span
              data-testid="dd-stage-turn-badge"
              className="dd-pill-primary px-3 py-1 rounded-lg text-xs sm:text-sm font-extrabold"
            >
              Lượt {activeIdx + 1} / {students.length}
            </span>

            {activeProcessCount > 0 && (
              <button
                type="button"
                data-testid="dd-stop-app-btn"
                onClick={onStopApps}
                className="dd-pill-error px-3 py-1 rounded-lg text-xs font-bold hover:opacity-90 cursor-pointer"
              >
                ⏹ Đóng app
              </button>
            )}
          </div>

          {/* Student Name & 1-Line Project Title */}
          <div className="space-y-1">
            <h1
              data-testid="dd-stage-student-name"
              className="text-2xl sm:text-3xl font-extrabold tracking-tight dd-title"
            >
              {currentStudent.fullName}
            </h1>
            <p
              data-testid="dd-stage-project-title"
              className="text-sm sm:text-base font-semibold dd-muted truncate"
            >
              {currentStudent.projectTitle}
            </p>
          </div>

          {/* Real 16:9 Project Thumbnail */}
          <div className="w-full max-w-[480px] mx-auto aspect-video rounded-xl overflow-hidden dd-subtle-box flex items-center justify-center">
            {!isThumbBroken && currentStudent.thumbnailUrl ? (
              <img
                data-testid="dd-stage-thumbnail-img"
                src={currentStudent.thumbnailUrl}
                alt={currentStudent.projectTitle}
                className="w-full h-full object-cover"
                onError={() =>
                  setFailedThumbKeys((prev) => ({ ...prev, [thumbKey]: true }))
                }
              />
            ) : (
              <span className="text-sm font-bold dd-muted">
                {currentStudent.trackBadge}
              </span>
            )}
          </div>
        </div>

        {/* 2 Big Clean Stage Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            data-testid="dd-open-slide-btn"
            disabled={!hasSlide || launchingAction === "SLIDE"}
            onClick={() => onOpenSlide(currentStudent)}
            className="dd-btn-slide py-4 px-5 rounded-xl text-base sm:text-lg font-extrabold text-center cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
          >
            {launchingAction === "SLIDE" ? "⏳ Đang mở..." : "🎨 Mở Slide"}
          </button>

          <button
            type="button"
            data-testid="dd-run-product-btn"
            disabled={!hasProduct || launchingAction === "PRODUCT"}
            onClick={() => onRunProduct(currentStudent)}
            className="dd-btn-product py-4 px-5 rounded-xl text-base sm:text-lg font-extrabold text-center cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
          >
            {launchingAction === "PRODUCT" ? "⏳ Đang mở..." : "🚀 Mở Sản Phẩm"}
          </button>
        </div>

        {/* Bottom Prev / Next */}
        <div className="flex items-center justify-between gap-3 pt-3 border-t dd-divider">
          <button
            type="button"
            data-testid="dd-prev-btn"
            disabled={activeIdx <= 0}
            onClick={onPrev}
            className="dd-btn-slide px-4 py-2 rounded-xl text-sm font-bold cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
          >
            ⬅️ Trước
          </button>

          <button
            type="button"
            data-testid="dd-next-btn"
            onClick={onNext}
            className="dd-pill-success px-5 py-2 rounded-xl text-sm font-extrabold hover:opacity-90 cursor-pointer"
          >
            Tiếp theo ➡️
          </button>
        </div>
      </div>

      {/* Right Queue Panel */}
      <div className="lg:col-span-4 dd-shell-card rounded-2xl p-4 flex flex-col space-y-3">
        <div className="text-sm font-extrabold uppercase tracking-wide dd-title">
          Thứ tự
        </div>

        <div className="space-y-2 flex-1 overflow-y-auto pr-0.5">
          {students.map((stu, idx) => {
            const isCurrent = stu.studentId === currentStudent.studentId;
            return (
              <button
                key={stu.studentId}
                type="button"
                data-testid={`dd-queue-item-${stu.studentId}`}
                onClick={() => onSelectStudent(stu.studentId)}
                className={`w-full text-left px-3 py-2.5 rounded-xl flex items-center justify-between gap-2 cursor-pointer ${
                  isCurrent ? "dd-queue-active font-extrabold" : "dd-queue-idle font-semibold"
                }`}
              >
                <span
                  className={`text-sm truncate ${
                    stu.excluded ? "line-through opacity-60" : ""
                  }`}
                >
                  {idx + 1}. {stu.fullName}
                </span>

                {stu.completed && (
                  <span
                    data-testid={`dd-queue-done-${stu.studentId}`}
                    className="dd-pill-success shrink-0 px-1.5 py-0.5 rounded text-xs font-extrabold"
                  >
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
