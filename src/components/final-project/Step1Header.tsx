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
    scanning,
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
    <div className="rounded-2xl overflow-hidden shadow-md">
      <div className="mindx-hero px-5 py-4 flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <span className="mindx-badge-emerald px-2.5 py-0.5 rounded-full text-xs font-bold">
              Bước 1 / {totalStepsCount}
            </span>
            <h2 className="text-base sm:text-lg font-extrabold text-white">
              Chọn Lớp &rarr; Chọn Buổi Nộp (12 / 13 / 14) &rarr; Chọn Thư Mục &amp; Khớp Học Viên
            </h2>
          </div>
          {false && (
            <p className="mindx-hero-sub text-xs">
              Quét thư mục sản phẩm cuối khóa, chuẩn bị ảnh bìa &amp; đường dẫn sản phẩm, nộp SPCK Buổi 12–14 và đẩy Thư tổng kết Buổi 14.
            </p>
          )}
        </div>
      </div>

      <div className="mindx-card p-5 space-y-4 rounded-b-2xl">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
          {/* 1A. Chọn Lớp */}
          <div className="md:col-span-4">
            <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
              1A. Chọn Lớp nộp SPCK (Buổi ≥ 12)
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

          {/* 1B. Chọn Buổi nộp một lần ở đầu trang */}
          <div className="md:col-span-3">
            <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
              1B. Chọn Buổi Nộp LMS ({getStageMeta(selectedSessionNumber).stageTitle})
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
                        ? "bg-emerald-600 text-white shadow"
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
              1C. Thư mục SPCK trên máy tính (Allowlisted)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={folderPathInput}
                onChange={(e) => setFolderPathInput(e.target.value)}
                disabled={isAnyOperationBusy}
                placeholder="VD: D:\SPCK_MindX\VT-C4K-PTA12"
                className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={handleBrowseFolder}
                disabled={isAnyOperationBusy}
                title="Mở cửa sổ chọn thư mục trên máy tính"
                className="shrink-0 flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 disabled:opacity-50 text-slate-100 font-medium text-xs transition-colors cursor-pointer"
              >
                {browsingFolder ? (
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                ) : (
                  <FolderOpen className="w-4 h-4 text-emerald-400" />
                )}
                <span>Chọn...</span>
              </button>
              <button
                type="button"
                onClick={() => handleScanFolder()}
                disabled={isAnyOperationBusy || !selectedClassId}
                className="shrink-0 flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-xs transition-colors cursor-pointer"
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

        {/* 1D. Robotics / sản phẩm chỉ có video YouTube (Mặc định hiển thị cho lớp Robotics, lớp khác ẩn gọn) */}
        {!isRoboticsClass && !showYoutubeImport ? (
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => setShowYoutubeImport(true)}
              className="inline-flex items-center gap-1.5 text-[11px] text-rose-300/80 hover:text-rose-200 underline cursor-pointer"
            >
              <Video className="w-3.5 h-3.5 text-rose-400" />
              <span>Mở công cụ nhập Playlist YouTube (Dành cho lớp Robotics / Video)</span>
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-rose-500/30 bg-rose-950/20">
            <button
              type="button"
              onClick={() => setShowYoutubeImport((v) => !v)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left cursor-pointer"
            >
              <span className="flex items-center gap-2 text-xs font-semibold text-rose-200">
                <Video className="w-4 h-4 text-rose-400" />
                1D. Lớp Robotics (sản phẩm chỉ có video YouTube): Dán link Playlist của lớp → bot tự gắn link &amp; lấy 2 ảnh thuyết trình cho từng học viên
              </span>
              <span className="text-[11px] text-rose-300 shrink-0">
                {showYoutubeImport ? "Thu gọn ▴" : "Mở ▾"}
              </span>
            </button>
            {(showYoutubeImport || isRoboticsClass) && (
              <div className="px-3 pb-3 space-y-2">
                <textarea
                  value={youtubeImportInput}
                  onChange={(e) => setYoutubeImportInput(e.target.value)}
                  disabled={isAnyOperationBusy}
                  rows={4}
                  placeholder={
                    "Dán 1 link Playlist của lớp, ví dụ:\nhttps://m.youtube.com/playlist?list=PL...\nHoặc mỗi dòng 1 học viên: Minh Khang - https://youtu.be/..."
                  }
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-rose-500 disabled:opacity-60"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-slate-400">
                    Bot đọc tên học viên trong tiêu đề từng video (bỏ mã lớp như &ldquo;SB28&rdquo;), gắn đúng link vào ô YouTube URL, lấy{" "}
                    <strong className="text-slate-200">2 ảnh thuyết trình</strong> vào ảnh bổ sung. Ảnh đại diện: ảnh Owner tải lên, nếu không có thì{" "}
                    <strong className="text-slate-200">Logo MindX</strong>. Áp dụng cho{" "}
                    <strong className="text-rose-300">Buổi {selectedSessionNumber}</strong>.
                  </p>
                  <button
                    type="button"
                    onClick={handleImportYoutubeProducts}
                    disabled={isAnyOperationBusy || !selectedClassId || !youtubeImportInput.trim()}
                    className="shrink-0 flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-semibold text-xs transition-colors cursor-pointer"
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
                                <a href={r.url} target="_blank" rel="noreferrer" className="underline hover:text-rose-300">
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
        )}
      </div>
    </div>
  );
}
