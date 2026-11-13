"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Play,
  RefreshCw,
  SkipForward,
  Square,
  StopCircle,
  X,
} from "lucide-react";

type BatchClassRowStatus =
  | "PENDING"
  | "RUNNING"
  | "SYNCED"
  | "SKIPPED_UNCHANGED"
  | "SKIPPED_NO_SCORES"
  | "NEEDS_ATTENTION"
  | "CANCELLED";

interface BatchClassRowState {
  classCode: string;
  courseName?: string;
  status: BatchClassRowStatus;
  syncedScoreCount?: number;
  detail?: string;
}

export interface ReportCardBatchSyncPanelProps {
  triggerSeq: number;
  activeClassCode: string;
  onRunningStateChange: (isRunning: boolean, progressLabel: string) => void;
  onClassesDiscovered: (classCodes: string[]) => void;
  onClassProcessed: (classCode: string, outcome: string) => void;
  onSelectClass: (classCode: string) => void;
}

function getRowStatusUi(status: BatchClassRowStatus): {
  badgeText: string;
  badgeClass: string;
} {
  switch (status) {
    case "RUNNING":
      return {
        badgeText: "Đang xử lý...",
        badgeClass:
          "bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-500/20 dark:text-sky-200 dark:border-sky-500/40",
      };
    case "SYNCED":
      return {
        badgeText: "✅ Đã đồng bộ Teaching",
        badgeClass:
          "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-200 dark:border-emerald-500/40",
      };
    case "SKIPPED_UNCHANGED":
      return {
        badgeText: "⏭️ Điểm không đổi",
        badgeClass:
          "bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-700/60 dark:text-slate-200 dark:border-slate-600",
      };
    case "SKIPPED_NO_SCORES":
      return {
        badgeText: "⏭️ Chưa có điểm",
        badgeClass:
          "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-700/50 dark:text-slate-300 dark:border-slate-600",
      };
    case "NEEDS_ATTENTION":
      return {
        badgeText: "⚠️ Cần kiểm tra",
        badgeClass:
          "bg-amber-100 text-amber-900 border-amber-400 dark:bg-amber-500/20 dark:text-amber-200 dark:border-amber-500/40",
      };
    case "CANCELLED":
      return {
        badgeText: "⏹ Đã dừng",
        badgeClass:
          "bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-500/20 dark:text-rose-200 dark:border-rose-500/40",
      };
    case "PENDING":
    default:
      return {
        badgeText: "Chờ xử lý",
        badgeClass:
          "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800/70 dark:text-slate-400 dark:border-slate-700",
      };
  }
}

export function ReportCardBatchSyncPanel({
  triggerSeq,
  activeClassCode,
  onRunningStateChange,
  onClassesDiscovered,
  onClassProcessed,
  onSelectClass,
}: ReportCardBatchSyncPanelProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [phaseText, setPhaseText] = useState("");
  const [items, setItems] = useState<BatchClassRowState[]>([]);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [queueStoppedDetected, setQueueStoppedDetected] = useState(false);
  const [stopAfterCurrentRequested, setStopAfterCurrentRequested] =
    useState(false);

  const lastHandledTriggerRef = useRef(0);
  const runSeqRef = useRef(0);
  const stopAfterCurrentRef = useRef(false);
  const emergencyStopRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const onRunningStateChangeRef = useRef(onRunningStateChange);
  onRunningStateChangeRef.current = onRunningStateChange;
  const onClassesDiscoveredRef = useRef(onClassesDiscovered);
  onClassesDiscoveredRef.current = onClassesDiscovered;
  const onClassProcessedRef = useRef(onClassProcessed);
  onClassProcessedRef.current = onClassProcessed;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  const updateRunningProgress = (running: boolean, label: string) => {
    if (!mountedRef.current) return;
    setIsRunning(running);
    setPhaseText(label);
    onRunningStateChangeRef.current(running, label);
  };

  const executeClassList = async (
    targets: Array<{ classCode: string; courseName?: string }>,
    myRunSeq: number
  ) => {
    const total = targets.length;
    for (let idx = 0; idx < targets.length; idx++) {
      if (!mountedRef.current || myRunSeq !== runSeqRef.current) return;

      if (stopAfterCurrentRef.current || emergencyStopRef.current) {
        setItems((prev) =>
          prev.map((row, rowIdx) =>
            rowIdx >= idx && row.status === "PENDING"
              ? {
                  ...row,
                  status: "CANCELLED",
                  detail: emergencyStopRef.current
                    ? "Đã dừng khẩn cấp theo yêu cầu."
                    : "Đã dừng sau khi xong lớp trước theo yêu cầu.",
                }
              : row
          )
        );
        break;
      }

      const target = targets[idx];
      const progressLabel = `Đang đồng bộ ${idx + 1}/${total}: ${target.classCode}`;
      updateRunningProgress(true, progressLabel);

      setItems((prev) =>
        prev.map((row) =>
          row.classCode === target.classCode
            ? {
                ...row,
                status: "RUNNING",
                detail: "Đang quét điểm từ LMS & đối chiếu lên Teaching...",
              }
            : row
        )
      );

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const res = await fetch("/api/report-card/batch-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "sync_single_class",
            classCode: target.classCode,
          }),
          signal: controller.signal,
        });
        const data = await res.json().catch(() => null);
        if (!mountedRef.current || myRunSeq !== runSeqRef.current) return;

        const outcome = String(data?.outcome || "") as BatchClassRowStatus;
        if (outcome === "CANCELLED" || res.status === 409 && data?.cancelled) {
          setQueueStoppedDetected(true);
          setItems((prev) =>
            prev.map((row, rowIdx) => {
              if (row.classCode === target.classCode) {
                return {
                  ...row,
                  status: "CANCELLED",
                  detail: data?.error || "Đã dừng theo yêu cầu.",
                };
              }
              if (rowIdx > idx && row.status === "PENDING") {
                return {
                  ...row,
                  status: "CANCELLED",
                  detail: "Đã hủy do hàng đợi dừng khẩn cấp.",
                };
              }
              return row;
            })
          );
          break;
        }

        const nextStatus: BatchClassRowStatus =
          outcome === "SYNCED" ||
          outcome === "SKIPPED_UNCHANGED" ||
          outcome === "SKIPPED_NO_SCORES" ||
          outcome === "NEEDS_ATTENTION"
            ? outcome
            : "NEEDS_ATTENTION";

        setItems((prev) =>
          prev.map((row) =>
            row.classCode === target.classCode
              ? {
                  ...row,
                  status: nextStatus,
                  syncedScoreCount: Number(data?.syncedScoreCount || 0),
                  detail:
                    nextStatus === "NEEDS_ATTENTION"
                      ? data?.error || "Cần kiểm tra lại lớp này."
                      : data?.message || "",
                }
              : row
          )
        );

        if (nextStatus === "SYNCED" || nextStatus === "SKIPPED_UNCHANGED") {
          onClassProcessedRef.current(target.classCode, nextStatus);
        }
      } catch (err: any) {
        if (!mountedRef.current || myRunSeq !== runSeqRef.current) return;
        const isAbort =
          err?.name === "AbortError" || emergencyStopRef.current;
        if (isAbort) {
          setItems((prev) =>
            prev.map((row, rowIdx) => {
              if (row.classCode === target.classCode) {
                return {
                  ...row,
                  status: "CANCELLED",
                  detail: "Đã hủy giữa chừng theo lệnh dừng khẩn cấp.",
                };
              }
              if (rowIdx > idx && row.status === "PENDING") {
                return {
                  ...row,
                  status: "CANCELLED",
                  detail: "Đã hủy theo lệnh dừng khẩn cấp.",
                };
              }
              return row;
            })
          );
          break;
        }

        setItems((prev) =>
          prev.map((row) =>
            row.classCode === target.classCode
              ? {
                  ...row,
                  status: "NEEDS_ATTENTION",
                  detail: `Lỗi kết nối máy chủ cục bộ: ${
                    err?.message || String(err)
                  }`,
                }
              : row
          )
        );
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    }
  };

  const startFullBatchRun = async () => {
    const myRunSeq = ++runSeqRef.current;
    stopAfterCurrentRef.current = false;
    emergencyStopRef.current = false;

    setIsVisible(true);
    setBannerError(null);
    setQueueStoppedDetected(false);
    setStopAfterCurrentRequested(false);
    setItems([]);
    updateRunningProgress(true, "Đang quét danh sách lớp đang dạy từ LMS...");

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch("/api/report-card/batch-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "discover_classes",
          refreshFromLms: true,
        }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (!mountedRef.current || myRunSeq !== runSeqRef.current) return;

      if (!res.ok || !data?.success) {
        if (data?.cancelled || res.status === 409) {
          setQueueStoppedDetected(true);
        }
        setBannerError(
          data?.error ||
            "Không thể lấy danh sách lớp đang dạy từ MindX LMS."
        );
        updateRunningProgress(false, "");
        return;
      }

      const discovered: Array<{ classCode: string; courseName?: string }> =
        Array.isArray(data.classes) ? data.classes : [];

      if (discovered.length === 0) {
        setBannerError(
          "Hiện chưa có lớp nào đang mở dạy trên MindX LMS."
        );
        updateRunningProgress(false, "");
        return;
      }

      onClassesDiscoveredRef.current(discovered.map((c) => c.classCode));
      setItems(
        discovered.map((c) => ({
          classCode: c.classCode,
          courseName: c.courseName,
          status: "PENDING",
          detail: "Đang chờ tới lượt...",
        }))
      );

      await executeClassList(discovered, myRunSeq);
      if (mountedRef.current && myRunSeq === runSeqRef.current) {
        updateRunningProgress(false, "Đã hoàn tất lượt quét & đồng bộ.");
      }
    } catch (err: any) {
      if (!mountedRef.current || myRunSeq !== runSeqRef.current) return;
      if (err?.name === "AbortError" || emergencyStopRef.current) {
        setBannerError("Đã dừng tiến trình quét danh sách lớp.");
      } else {
        setBannerError(
          `Lỗi khi quét danh sách lớp: ${err?.message || String(err)}`
        );
      }
      updateRunningProgress(false, "");
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  };

  const handleRetryAttentionClasses = async () => {
    const failedTargets = items
      .filter((row) => row.status === "NEEDS_ATTENTION")
      .map((row) => ({ classCode: row.classCode, courseName: row.courseName }));
    if (failedTargets.length === 0 || isRunning) return;

    const myRunSeq = ++runSeqRef.current;
    stopAfterCurrentRef.current = false;
    emergencyStopRef.current = false;
    setBannerError(null);
    setStopAfterCurrentRequested(false);
    setItems((prev) =>
      prev.map((row) =>
        row.status === "NEEDS_ATTENTION"
          ? { ...row, status: "PENDING", detail: "Đang chờ thử lại..." }
          : row
      )
    );

    await executeClassList(failedTargets, myRunSeq);
    if (mountedRef.current && myRunSeq === runSeqRef.current) {
      updateRunningProgress(false, "Đã hoàn tất thử lại các lớp cần kiểm tra.");
    }
  };

  const handleStopAfterCurrent = () => {
    if (!isRunning) return;
    stopAfterCurrentRef.current = true;
    setStopAfterCurrentRequested(true);
  };

  const handleEmergencyStop = async () => {
    if (!isRunning) return;
    emergencyStopRef.current = true;
    stopAfterCurrentRef.current = true;
    abortControllerRef.current?.abort();
    setQueueStoppedDetected(true);
    updateRunningProgress(false, "Đã kích hoạt dừng khẩn cấp.");
    try {
      await fetch("/api/queue/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
    } catch {
      // ignore control error
    }
  };

  const handleResumeQueue = async () => {
    try {
      const res = await fetch("/api/queue/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume" }),
      });
      if (res.ok) {
        setQueueStoppedDetected(false);
        setBannerError(null);
      }
    } catch {
      // ignore error
    }
  };

  useEffect(() => {
    if (triggerSeq > lastHandledTriggerRef.current) {
      lastHandledTriggerRef.current = triggerSeq;
      void startFullBatchRun();
    }
  }, [triggerSeq]);

  if (!isVisible) {
    return null;
  }

  const syncedCount = items.filter((i) => i.status === "SYNCED").length;
  const skippedCount = items.filter(
    (i) => i.status === "SKIPPED_UNCHANGED" || i.status === "SKIPPED_NO_SCORES"
  ).length;
  const attentionCount = items.filter(
    (i) => i.status === "NEEDS_ATTENTION"
  ).length;
  const doneCount = items.filter(
    (i) => i.status !== "PENDING" && i.status !== "RUNNING"
  ).length;

  return (
    <div
      data-testid="report-card-batch-sync-panel"
      className="mindx-card rounded-2xl p-4 sm:p-5 space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {isRunning ? (
            <Loader2 className="w-5 h-5 text-sky-500 animate-spin shrink-0" />
          ) : attentionCount > 0 ? (
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
          )}
          <div>
            <h2 className="text-sm sm:text-base font-bold">
              Tiến trình Quét &amp; Đồng bộ tất cả lớp đang dạy lên Teaching
            </h2>
            <p className="text-xs opacity-75">
              {phaseText ||
                (items.length > 0
                  ? `Hoàn tất ${doneCount}/${items.length} lớp • Bấm vào tên lớp để xem hoặc sửa thêm điểm.`
                  : "Sẵn sàng đồng bộ tự động từng lớp.")}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isRunning ? (
            <>
              <button
                type="button"
                data-testid="batch-stop-graceful-btn"
                onClick={handleStopAfterCurrent}
                disabled={stopAfterCurrentRequested}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200 disabled:opacity-60 cursor-pointer dark:bg-amber-500/20 dark:text-amber-200 dark:border-amber-500/40"
                title="Chờ đồng bộ xong lớp hiện tại rồi dừng gọn"
              >
                <Square className="w-3.5 h-3.5" />
                {stopAfterCurrentRequested
                  ? "Sẽ dừng sau lớp này..."
                  : "⏹ Dừng sau lớp này"}
              </button>
              <button
                type="button"
                data-testid="batch-stop-emergency-btn"
                onClick={() => void handleEmergencyStop()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-500 cursor-pointer shadow-sm"
                title="Ngắt ngay lập tức"
              >
                <StopCircle className="w-3.5 h-3.5" />
                🚨 Dừng ngay
              </button>
            </>
          ) : (
            <>
              {queueStoppedDetected && (
                <button
                  type="button"
                  data-testid="batch-resume-queue-btn"
                  onClick={() => void handleResumeQueue()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 cursor-pointer shadow-sm"
                >
                  <Play className="w-3.5 h-3.5" />
                  ▶ Mở khóa hàng đợi
                </button>
              )}
              {attentionCount > 0 && (
                <button
                  type="button"
                  data-testid="batch-retry-attention-btn"
                  onClick={() => void handleRetryAttentionClasses()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 text-white hover:bg-amber-500 cursor-pointer shadow-sm"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  🔄 Thử lại các lớp cần kiểm tra ({attentionCount})
                </button>
              )}
              <button
                type="button"
                data-testid="batch-close-panel-btn"
                onClick={() => setIsVisible(false)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                title="Đóng bảng tiến trình"
              >
                <X className="w-3.5 h-3.5" />
                Đóng
              </button>
            </>
          )}
        </div>
      </div>

      {bannerError && (
        <div className="p-3 rounded-xl text-xs font-medium bg-amber-50 text-amber-900 border border-amber-300 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/40 flex items-center justify-between gap-2">
          <span>{bannerError}</span>
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              data-testid="batch-summary-synced"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-semibold bg-emerald-100 text-emerald-900 border border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-500/35"
            >
              ✅ Đã đồng bộ Teaching: {syncedCount} lớp
            </span>
            <span
              data-testid="batch-summary-skipped"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-semibold bg-slate-100 text-slate-800 border border-slate-300 dark:bg-slate-700/60 dark:text-slate-200 dark:border-slate-600"
            >
              <SkipForward className="w-3.5 h-3.5" />
              Không có điểm mới / Chưa có điểm: {skippedCount} lớp
            </span>
            <span
              data-testid="batch-summary-attention"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-semibold bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/35"
            >
              ⚠️ Cần kiểm tra: {attentionCount} lớp
            </span>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-700/70 rounded-xl border border-slate-200 dark:border-slate-700/70 overflow-hidden max-h-72 overflow-y-auto">
            {items.map((item) => {
              const ui = getRowStatusUi(item.status);
              const isSelected =
                activeClassCode.trim().toUpperCase() === item.classCode;
              return (
                <button
                  key={item.classCode}
                  type="button"
                  data-testid={`batch-row-${item.classCode}`}
                  onClick={() => onSelectClass(item.classCode)}
                  className={`w-full px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-left transition cursor-pointer ${
                    isSelected
                      ? "bg-sky-50/90 dark:bg-sky-900/25"
                      : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-xs sm:text-sm">
                        {item.classCode}
                      </span>
                      {item.courseName && (
                        <span className="text-[11px] opacity-70 truncate max-w-[240px]">
                          {item.courseName}
                        </span>
                      )}
                      {isSelected && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-600 text-white">
                          Đang xem
                        </span>
                      )}
                    </div>
                    {item.detail && (
                      <p className="text-[11px] opacity-75 mt-0.5 line-clamp-2">
                        {item.detail}
                      </p>
                    )}
                  </div>

                  <span
                    className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${ui.badgeClass}`}
                  >
                    {item.status === "RUNNING" && (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    )}
                    {ui.badgeText}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
