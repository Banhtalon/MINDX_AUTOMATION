"use client";

import React from "react";
import { getStageMeta, SpckWorkflowController } from "./useSpckWorkflow";

export interface SnapshotModalProps {
  workflow: SpckWorkflowController;
}

export function SnapshotModal({ workflow }: SnapshotModalProps) {
  const { snapshotModalData, setSnapshotModalData } = workflow;

  if (!snapshotModalData) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="space-y-0.5">
            <h2 className="text-sm font-bold text-white">
              Bằng Chứng Bản Đã Nộp — Buổi {snapshotModalData.sessionNumber} (
              {getStageMeta(snapshotModalData.sessionNumber).stageShort})
            </h2>
            <p className="text-xs text-slate-400">
              Học viên:{" "}
              <strong className="text-emerald-300">
                {snapshotModalData.studentName}
              </strong>{" "}
              ({snapshotModalData.studentId})
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSnapshotModalData(null)}
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
          >
            Đóng
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
            <div className="font-semibold text-white">
              Trạng thái hiển thị:{" "}
              <span className="text-emerald-300">
                {snapshotModalData.slot.label}
              </span>
            </div>
            <div className="text-slate-400">{snapshotModalData.slot.detail}</div>
          </div>

          {snapshotModalData.slot.state === "CORRUPTED" && (
            <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-700/60 text-rose-200 space-y-1">
              <div className="font-bold">⚠️ Lịch sử lỗi dữ liệu</div>
              <div>
                {snapshotModalData.slot.corruptedReason ||
                  "Dữ liệu lịch sử nộp bài của học viên này không đọc được JSON hợp lệ. Hệ thống không tự coi là chưa nộp để bảo toàn dấu vết."}
              </div>
            </div>
          )}

          {snapshotModalData.slot.state === "UNKNOWN_LEGACY" &&
            !snapshotModalData.slot.snapshot && (
              <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-700/60 text-amber-200 space-y-1">
                <div className="font-bold">ℹ️ Lịch sử cũ (Chưa rõ buổi)</div>
                <div>
                  Bản ghi này được đối chiếu thành công ở phiên bản cũ khi hệ thống chưa tách riêng buổi 12 / 13 / 14. Hệ thống giữ nguyên dấu vết lịch sử và không tự gán bừa vào buổi cụ thể.
                </div>
              </div>
            )}

          {snapshotModalData.slot.snapshot ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
                  <span className="text-slate-400">Thời điểm xác nhận LMS:</span>
                  <div className="font-semibold text-emerald-300 mt-0.5">
                    {snapshotModalData.slot.verifiedAt ||
                      snapshotModalData.slot.snapshot.capturedAt ||
                      "Đã xác nhận"}
                  </div>
                </div>
                <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
                  <span className="text-slate-400">
                    Mã kiểm tra nội dung (Hash):
                  </span>
                  <div className="font-mono text-slate-300 mt-0.5 truncate">
                    {snapshotModalData.slot.snapshot.contentHash || "N/A"}
                  </div>
                </div>
              </div>

              {(snapshotModalData.slot.driftedFiles || []).length > 0 && (
                <div className="p-2.5 rounded bg-amber-950/40 border border-amber-700/60 text-amber-200">
                  ⚠️ Một số tệp trên ổ cứng đã thay đổi hoặc di chuyển sau thời điểm nộp ({(snapshotModalData.slot.driftedFiles || []).join("; ")}). Nội dung chữ đã gửi bên dưới vẫn được lưu nguyên vẹn.
                </div>
              )}

              <div className="p-3 rounded bg-slate-950 border border-slate-800 space-y-2">
                <div>
                  <span className="text-slate-400 font-semibold">
                    1. Tiêu đề đã nộp:
                  </span>
                  <div className="text-white font-semibold mt-0.5">
                    {snapshotModalData.slot.snapshot.projectTitle}
                  </div>
                </div>

                <div>
                  <span className="text-slate-400 font-semibold">
                    7. Bình luận giáo viên đã nộp:
                  </span>
                  <div className="text-slate-200 whitespace-pre-wrap mt-1 p-2.5 rounded bg-slate-900 border border-slate-800 leading-relaxed">
                    {snapshotModalData.slot.snapshot.teacherComment}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-1">
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">
                    <div className="text-slate-400">3. Thumbnail đã nộp</div>
                    <div className="text-white font-medium truncate mt-0.5">
                      {snapshotModalData.slot.snapshot.thumbnailPath
                        ? snapshotModalData.slot.snapshot.thumbnailPath
                            .split(/[\\/]/)
                            .pop()
                        : "Không có"}
                    </div>
                  </div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">
                    <div className="text-slate-400">4. Ảnh bổ sung</div>
                    <div className="text-white font-medium mt-0.5">
                      {(snapshotModalData.slot.snapshot.screenshots || []).length} ảnh
                    </div>
                  </div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">
                    <div className="text-slate-400">5. Tệp đính kèm</div>
                    <div className="text-white font-medium mt-0.5">
                      {(snapshotModalData.slot.snapshot.attachments || []).length} tệp
                    </div>
                  </div>
                </div>

                {(snapshotModalData.slot.snapshot.youtubeUrls || []).length > 0 && (
                  <div>
                    <span className="text-slate-400 font-semibold">
                      2. YouTube URLs đã nộp:
                    </span>
                    <ul className="mt-0.5 space-y-0.5 font-mono text-rose-300">
                      {snapshotModalData.slot.snapshot.youtubeUrls.map((u, i) => (
                        <li key={i} className="truncate">
                          • {u}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {(snapshotModalData.slot.snapshot.relatedLinks || []).length > 0 && (
                  <div>
                    <span className="text-slate-400 font-semibold">
                      6. Đường dẫn liên quan đã nộp:
                    </span>
                    <ul className="mt-0.5 space-y-0.5 font-mono text-sky-300">
                      {snapshotModalData.slot.snapshot.relatedLinks.map((l, i) => (
                        <li key={i} className="truncate">
                          • {l.name}: {l.url}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="px-5 py-3 bg-slate-950 border-t border-slate-800 flex justify-end">
          <button
            type="button"
            onClick={() => setSnapshotModalData(null)}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
