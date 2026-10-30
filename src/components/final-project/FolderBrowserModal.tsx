"use client";

import React from "react";
import { FolderOpen, Loader2 } from "lucide-react";
import { SpckWorkflowController } from "./useSpckWorkflow";

export interface FolderBrowserModalProps {
  workflow: SpckWorkflowController;
}

export function FolderBrowserModal({ workflow }: FolderBrowserModalProps) {
  const {
    folderModalOpen,
    setFolderModalOpen,
    browseDrives,
    loadBrowseDirectory,
    browseCurrentPath,
    setBrowseCurrentPath,
    browseQuickLinks,
    browseParentPath,
    browsingFolder,
    browseFilter,
    setBrowseFilter,
    browseDirectories,
    handleConfirmBrowseSelection,
  } = workflow;

  if (!folderModalOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-3xl rounded-xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <FolderOpen className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold text-white">
              Chọn Thư Mục SPCK Trên Máy Tính
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setFolderModalOpen(false)}
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
          >
            Đóng (Esc)
          </button>
        </div>

        <div className="p-4 space-y-3 border-b border-slate-800 bg-slate-900/90">
          {/* Quick Drives & Shortcuts */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-400 mr-1">
              Ổ đĩa & Truy cập nhanh:
            </span>
            {browseDrives.map((drv) => (
              <button
                key={drv}
                type="button"
                onClick={() => loadBrowseDirectory(drv)}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors cursor-pointer ${
                  browseCurrentPath.toUpperCase().startsWith(drv.toUpperCase())
                    ? "bg-emerald-600/20 border-emerald-500 text-emerald-300"
                    : "bg-slate-950 border-slate-700 text-slate-300 hover:bg-slate-800"
                }`}
              >
                💽 {drv}
              </button>
            ))}
            {browseQuickLinks.map((ql) => (
              <button
                key={ql.path}
                type="button"
                onClick={() => loadBrowseDirectory(ql.path)}
                className="px-2.5 py-1 rounded-md text-xs font-medium bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-300 transition-colors cursor-pointer"
              >
                📁 {ql.label}
              </button>
            ))}
          </div>

          {/* Current Path Bar + Up Button */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!browseParentPath || browsingFolder}
              onClick={() =>
                browseParentPath && loadBrowseDirectory(browseParentPath)
              }
              className="shrink-0 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-slate-700 text-slate-200 text-xs font-medium cursor-pointer"
            >
              ⬆️ Lên 1 cấp
            </button>
            <input
              type="text"
              value={browseCurrentPath}
              onChange={(e) => setBrowseCurrentPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  loadBrowseDirectory(browseCurrentPath);
                }
              }}
              placeholder="Nhập đường dẫn thư mục rồi nhấn Enter..."
              className="flex-1 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-emerald-300 font-mono text-xs focus:outline-none focus:border-emerald-500"
            />
            <button
              type="button"
              disabled={browsingFolder}
              onClick={() => loadBrowseDirectory(browseCurrentPath)}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium cursor-pointer"
            >
              Đến
            </button>
          </div>

          {/* Quick Filter */}
          <div className="flex items-center justify-between gap-2">
            <input
              type="text"
              value={browseFilter}
              onChange={(e) => setBrowseFilter(e.target.value)}
              placeholder="🔍 Lọc nhanh tên thư mục con..."
              className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-xs focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        {/* Subdirectories List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1 bg-slate-950/60 min-h-[260px] max-h-[380px]">
          {browsingFolder ? (
            <div className="py-12 flex items-center justify-center space-x-2 text-slate-400 text-sm">
              <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
              <span>Đang đọc danh sách thư mục...</span>
            </div>
          ) : (
            (() => {
              const filteredDirs = browseDirectories.filter((d) =>
                !browseFilter.trim()
                  ? true
                  : d.name
                      .toLowerCase()
                      .includes(browseFilter.trim().toLowerCase())
              );
              if (filteredDirs.length === 0) {
                return (
                  <div className="py-10 text-center text-slate-500 text-xs">
                    Không có thư mục con nào trong đường dẫn này. Bạn có thể bấm{" "}
                    <strong className="text-emerald-400">
                      &quot;Chọn thư mục đang mở&quot;
                    </strong>{" "}
                    ở bên dưới.
                  </div>
                );
              }
              return filteredDirs.map((dir) => (
                <div
                  key={dir.path}
                  className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-800/80 transition-colors group"
                >
                  <button
                    type="button"
                    onClick={() => loadBrowseDirectory(dir.path)}
                    className="flex-1 flex items-center space-x-2.5 text-left text-sm text-slate-200 group-hover:text-emerald-300 truncate cursor-pointer"
                  >
                    <FolderOpen className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="truncate font-medium">{dir.name}</span>
                  </button>
                  <div className="flex items-center space-x-2 shrink-0 ml-2">
                    <button
                      type="button"
                      onClick={() => loadBrowseDirectory(dir.path)}
                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs cursor-pointer"
                    >
                      Mở ra
                    </button>
                    <button
                      type="button"
                      onClick={() => handleConfirmBrowseSelection(dir.path)}
                      className="px-2.5 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600 border border-emerald-500/40 text-emerald-300 hover:text-white text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Chọn
                    </button>
                  </div>
                </div>
              ));
            })()
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-400 truncate max-w-md">
            Đang mở: <span className="text-emerald-300 font-mono">{browseCurrentPath}</span>
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => setFolderModalOpen(false)}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="button"
              disabled={!browseCurrentPath || browsingFolder}
              onClick={() => handleConfirmBrowseSelection(browseCurrentPath)}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
            >
              ✅ Chọn thư mục đang mở ({browseDirectories.length} thư mục con)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
