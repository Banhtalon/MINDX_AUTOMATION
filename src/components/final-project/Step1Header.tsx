"use client";

import React from "react";
import { FolderOpen, FolderSearch, Loader2, Video } from "lucide-react";
import { ClassPicker } from "@/components/class-picker";
import { getStageMeta, SpckWorkflowController } from "./useSpckWorkflow";

export interface Step1HeaderProps {
  workflow: SpckWorkflowController;
}

export function Step1Header({ workflow }: Step1HeaderProps) {
  const {
    totalStepsCount,
    selectedClassId,
    classes,
    handleClassChange,
    handleScanTeacherClasses,
    scanningTeacherClasses,
    isAnyOperationBusy,
    selectedSessionNumber,
    handleSessionChange,
    folderPathInput,
    setFolderPathInput,
    handleBrowseFolder,
    browsingFolder,
    handleScanFolder,
    handleInitStudentFolders,
    scanning,
    autoRunToolsAfterScan,
    handleToggleAutoRunToolsAfterScan,
    autoPrepStepProgress,
    isRoboticsClass,
    showYoutubeImport,
    setShowYoutubeImport,
    youtubeImportInput,
    setYoutubeImportInput,
    handleImportYoutubeProducts,
    importingYoutube,
    youtubeImportReport,
  } = workflow;

  return (
    <div className="spck-clean-card rounded-2xl overflow-hidden">
      <div className="spck-clean-header-bar px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center space-x-2">
          <span className="spck-pill-primary px-2.5 py-0.5 rounded-full text-xs font-bold">
            Bước 1 / {totalStepsCount}
          </span>
          <h2 className="text-sm sm:text-base font-extrabold text-white">
            Chọn Lớp, Buổi &amp; Thư Mục Bài Làm
          </h2>
        </div>
        <span className="text-[11px] text-slate-400">
          Giai đoạn hiện tại:{" "}
          <strong className="text-slate-200">
            Buổi {selectedSessionNumber} ({getStageMeta(selectedSessionNumber).stageTitle})
          </strong>
        </span>
      </div>

      <div className="p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 items-start">
          {/* 1A. Chọn Lớp */}
          <div className="md:col-span-4">
            <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
              1A. Lớp học (Buổi ≥ 12)
            </label>
            <ClassPicker
              scope="spck"
              variant="card"
              autoRestore={false}
              value={selectedClassId}
              classes={classes}
              onChange={(code) => {
                void handleClassChange(code);
              }}
              onRefresh={handleScanTeacherClasses}
              isRefreshing={scanningTeacherClasses}
              disabled={isAnyOperationBusy}
              allowManualInput={false}
              showRefreshButton={false}
              placeholderOption="-- Chọn lớp đủ điều kiện (Buổi ≥ 12) --"
            />
          </div>

          {/* 1B. Chọn Buổi nộp */}
          <div className="md:col-span-3">
            <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
              1B. Buổi nộp LMS ({getStageMeta(selectedSessionNumber).stageShort})
            </label>
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-lg bg-slate-950 border border-slate-700">
              {([12, 13, 14] as const).map((sessNum) => {
                const isSelected = selectedSessionNumber === sessNum;
                const stageMeta = getStageMeta(sessNum);
                return (
                  <button
                    key={sessNum}
                    type="button"
                    disabled={isAnyOperationBusy}
                    onClick={() => handleSessionChange(sessNum)}
                    className={`py-1.5 px-2 rounded-md text-xs font-bold transition-all cursor-pointer disabled:opacity-50 ${
                      isSelected
                        ? "spck-btn-primary"
                        : "text-slate-300 hover:bg-slate-800 hover:text-white"
                    }`}
                  >
                    Buổi {sessNum} ({stageMeta.stageShort})
                  </button>
                );
              })}
            </div>
          </div>

          {/* 1C. Chọn Thư mục & Quét */}
          <div className="md:col-span-5">
            <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
              1C. Thư mục SPCK trên máy tính
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={folderPathInput}
                onChange={(e) => setFolderPathInput(e.target.value)}
                disabled={isAnyOperationBusy}
                placeholder="VD: D:\SPCK_MindX\VT-C4K-PTA12"
                className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:border-blue-500 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={handleBrowseFolder}
                disabled={isAnyOperationBusy}
                title="Mở cửa sổ chọn thư mục trên máy tính"
                className="spck-pill-neutral shrink-0 flex items-center space-x-1.5 px-3 py-2 rounded-lg disabled:opacity-50 font-medium text-xs transition-colors cursor-pointer"
              >
                {browsingFolder ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FolderOpen className="w-4 h-4" />
                )}
                <span>Chọn...</span>
              </button>
              <button
                type="button"
                onClick={() => handleScanFolder()}
                disabled={isAnyOperationBusy || !selectedClassId}
                className="spck-btn-primary shrink-0 flex items-center space-x-1.5 px-3.5 py-2 rounded-lg disabled:opacity-50 font-bold text-xs transition-colors cursor-pointer"
              >
                {scanning ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FolderSearch className="w-4 h-4" />
                )}
                <span>Quét &amp; Khớp HV</span>
              </button>
            </div>
          </div>
        </div>

        {/* Thanh tùy chọn phụ Bước 1 (Gom gọn màu trung tính) */}
        <div className="spck-clean-subbar px-3 py-2 rounded-lg flex flex-wrap items-center justify-between gap-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="s5b-init-student-folders-btn"
              onClick={() => handleInitStudentFolders()}
              disabled={isAnyOperationBusy || !selectedClassId || !folderPathInput.trim()}
              title="Tự động tạo sẵn thư mục con theo tên từng học viên trong lớp để thả ảnh mô hình / tệp sản phẩm vào"
              className="spck-pill-neutral shrink-0 inline-flex items-center space-x-1 px-2.5 py-1 rounded-md disabled:opacity-50 font-semibold text-xs transition-colors cursor-pointer"
            >
              <span>📁 Tạo thư mục HV</span>
            </button>

            <label className="inline-flex items-center space-x-1.5 text-xs text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                data-testid="s5b-auto-run-tools-checkbox"
                checked={autoRunToolsAfterScan}
                disabled={isAnyOperationBusy}
                onChange={(e) =>
                  handleToggleAutoRunToolsAfterScan(e.target.checked)
                }
                className="rounded border-slate-600 cursor-pointer"
              />
              <span>
                ⚡ Tự chạy công cụ chuẩn bị sau khi Quét (Chụp ảnh / Up Web / Up Drive)
              </span>
            </label>

            {autoPrepStepProgress && (
              <span
                data-testid="s5b-auto-prep-progress"
                className="spck-pill-warning px-2.5 py-0.5 rounded-full text-[11px] font-semibold animate-pulse"
              >
                {autoPrepStepProgress}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowYoutubeImport((v) => !v)}
            className="spck-pill-neutral inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer"
          >
            <Video className="w-3.5 h-3.5" />
            <span>
              {showYoutubeImport || isRoboticsClass
                ? "🎬 Ẩn nhập Playlist YouTube ▴"
                : "🎬 Nhập Playlist YouTube (Robotics / Video) ▾"}
            </span>
          </button>
        </div>

        {/* 1D. Khung nhập Playlist YouTube (Chỉ mở khi bấm hoặc lớp Robotics) */}
        {(showYoutubeImport || isRoboticsClass) && (
          <div className="spck-clean-subbar rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-200">
              <span className="flex items-center gap-1.5">
                <Video className="w-4 h-4 text-slate-400" />
                <span>
                  1D. Nhập link Playlist YouTube của lớp → tự gắn link &amp; trích 2 ảnh thuyết trình cho từng học viên
                </span>
              </span>
            </div>
            <textarea
              value={youtubeImportInput}
              onChange={(e) => setYoutubeImportInput(e.target.value)}
              disabled={isAnyOperationBusy}
              rows={3}
              placeholder={
                "Dán 1 link Playlist của lớp, ví dụ:\nhttps://m.youtube.com/playlist?list=PL...\nHoặc mỗi dòng 1 học viên: Minh Khang - https://youtu.be/..."
              }
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-blue-500 disabled:opacity-60"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-slate-400">
                Bot tự nhận diện tên học viên trong tiêu đề video, gắn link YouTube và lấy <strong>2 ảnh thuyết trình</strong> cho <strong>Buổi {selectedSessionNumber}</strong>.
              </p>
              <button
                type="button"
                onClick={() => handleImportYoutubeProducts()}
                disabled={isAnyOperationBusy || !selectedClassId || !youtubeImportInput.trim()}
                className="spck-btn-primary shrink-0 flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg disabled:opacity-50 font-semibold text-xs transition-colors cursor-pointer"
              >
                {importingYoutube ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Video className="w-4 h-4" />
                )}
                <span>Nhập YouTube &amp; Lấy 2 Ảnh</span>
              </button>
            </div>

            {youtubeImportReport && (
              <div className="rounded-lg border border-slate-700 bg-slate-950/70 p-2 space-y-1.5">
                {youtubeImportReport.playlists.map((pl, idx) => (
                  <p key={idx} className="text-[11px] text-slate-300">
                    Playlist <strong className="text-white">{pl.playlistTitle || "(không tên)"}</strong>:{" "}
                    {pl.error ? (
                      <span className="text-rose-300">{pl.error}</span>
                    ) : (
                      <span>{pl.videoCount} video</span>
                    )}
                  </p>
                ))}
                <div className="max-h-56 overflow-y-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-slate-400 text-left">
                        <th className="py-1 pr-2">Tiêu đề video</th>
                        <th className="py-1 pr-2">Học viên</th>
                        <th className="py-1 pr-2">Kết quả</th>
                      </tr>
                    </thead>
                    <tbody>
                      {youtubeImportReport.results.map((r) => (
                        <tr key={r.videoId} className="border-t border-slate-800 align-top">
                          <td className="py-1 pr-2 text-slate-200">
                            <a href={r.url} target="_blank" rel="noreferrer" className="underline hover:text-blue-300">
                              {r.videoTitle || r.videoId}
                            </a>
                          </td>
                          <td className="py-1 pr-2 text-slate-200">{r.fullName || "—"}</td>
                          <td className="py-1 pr-2">
                            {r.applied ? (
                              <span className="text-emerald-300">
                                ✓ Đã gắn link + {r.frames.length} ảnh
                                {r.thumbnailIsOwnerPhoto ? " (giữ ảnh đại diện Owner)" : " (ảnh đại diện: Logo MindX)"}
                                {r.message ? <span className="block text-amber-300">{r.message}</span> : null}
                              </span>
                            ) : (
                              <span className="text-amber-300">{r.message || "Chưa khớp học viên"}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {youtubeImportReport.studentsWithoutVideo.length > 0 && (
                  <p className="text-[11px] text-amber-300">
                    Học viên chưa có video:{" "}
                    {youtubeImportReport.studentsWithoutVideo.map((s) => s.fullName).join(", ")}
                  </p>
                )}
                {youtubeImportReport.invalidLines.length > 0 && (
                  <p className="text-[11px] text-slate-400">
                    Dòng không nhận ra link YouTube: {youtubeImportReport.invalidLines.join(" | ")}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
