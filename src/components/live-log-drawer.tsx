"use client";

import React, { useEffect, useMemo, useState } from "react";

interface ClientJobLogRecord {
  id?: number;
  jobId: string;
  jobType: string;
  classId?: string | null;
  sessionId?: string | null;
  studentId?: string | null;
  submissionId?: string | null;
  level: "DEBUG" | "INFO" | "WARN" | "ERROR" | "SUCCESS";
  message: string;
  detailsJson?: string | null;
  timestamp?: string;
}

interface ClientQueuedTaskItem {
  id: string;
  jobType: string;
  description: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  classId?: string;
  sessionId?: string;
  studentId?: string;
  submissionId?: string;
  createdAt: string;
}

interface ClientQueueStatus {
  isRunning: boolean;
  isStopped: boolean;
  currentTask: ClientQueuedTaskItem | null;
  pendingCount: number;
  completedCount: number;
  failedCount: number;
  tasks: ClientQueuedTaskItem[];
}

export function LiveLogDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const [logs, setLogs] = useState<ClientJobLogRecord[]>([]);
  const [status, setStatus] = useState<ClientQueueStatus | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [levelFilter, setLevelFilter] = useState<"ALL" | "SUCCESS" | "WARN" | "ERROR">("ALL");

  useEffect(() => {
    const eventSource = new EventSource("/api/queue/stream");

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "RECENT_LOGS" && Array.isArray(payload.data)) {
          setLogs(payload.data.slice(-100));
        } else if (payload.type === "LOG" && payload.data) {
          setLogs((prev) => [...prev.slice(-99), payload.data]);
        } else if (payload.type === "STATUS" && payload.data) {
          setStatus(payload.data);
        }
      } catch {
        // Ignore malformed SSE message
      }
    };

    return () => {
      eventSource.close();
    };
  }, []);

  const handleQueueControl = async (action: "stop" | "resume" | "clear") => {
    if (action === "stop") setIsStopping(true);
    try {
      const res = await fetch("/api/queue/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data?.status) {
        setStatus(data.status);
      }
    } catch (err) {
      console.error(`Failed to execute queue control (${action}):`, err);
    } finally {
      if (action === "stop") setIsStopping(false);
    }
  };

  const isRunning = status?.isRunning ?? false;
  const isStopped = status?.isStopped ?? false;

  const filteredLogs = useMemo(() => {
    if (levelFilter === "ALL") return logs;
    return logs.filter((l) => l.level === levelFilter);
  }, [logs, levelFilter]);

  return (
    <>
      {/* Floating Bottom Status Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-slate-900/95 border-t border-slate-800 px-4 py-2.5 backdrop-blur flex items-center justify-between shadow-2xl">
        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center space-x-2 text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isRunning
                  ? "bg-amber-400 animate-ping"
                  : isStopped
                  ? "bg-rose-500"
                  : "bg-emerald-400"
              }`}
            />
            <span>
              {isRunning
                ? "Bot đang chạy tác vụ..."
                : isStopped
                ? "Hàng đợi đang DỪNG KHẨN CẤP"
                : "Hàng đợi Sẵn sàng"}
            </span>
            <span className="text-slate-400 font-mono text-[11px]">
              ({status?.pendingCount ?? 0} chờ • {status?.completedCount ?? 0} xong)
            </span>
          </button>

          {status?.currentTask && (
            <span className="text-xs text-amber-300 truncate max-w-md hidden sm:inline">
              ⚡ {status.currentTask.description}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {(status?.pendingCount ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => handleQueueControl("clear")}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors cursor-pointer"
            >
              Xóa hàng chờ ({status?.pendingCount})
            </button>
          )}

          {isStopped ? (
            <button
              type="button"
              onClick={() => handleQueueControl("resume")}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors cursor-pointer"
            >
              ▶️ Tiếp tục chạy
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleQueueControl("stop")}
              disabled={isStopping}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition-colors disabled:opacity-50 cursor-pointer"
            >
              🛑 Dừng khẩn cấp (Stop Bot)
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="text-xs px-2.5 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 cursor-pointer"
            title="Đóng / Mở Log Drawer"
          >
            {isOpen ? "▼ Ẩn Nhật ký" : `▲ Xem Nhật ký (${logs.length})`}
          </button>
        </div>
      </div>

      {/* Slide-up Live Log Drawer */}
      {isOpen && (
        <div className="fixed bottom-12 left-0 right-0 z-40 bg-slate-950/98 border-t border-slate-800 p-4 max-h-80 flex flex-col shadow-2xl backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800 mb-2">
            <div className="flex items-center space-x-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Nhật Ký Tự Động Hóa Thời Gian Thực (SSE Live Stream)
              </span>
              <div className="flex items-center space-x-1 text-[11px]">
                {(["ALL", "SUCCESS", "WARN", "ERROR"] as const).map((lv) => (
                  <button
                    key={lv}
                    type="button"
                    onClick={() => setLevelFilter(lv)}
                    className={`px-2 py-0.5 rounded cursor-pointer ${
                      levelFilter === lv
                        ? "bg-slate-700 text-white font-semibold"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {lv === "ALL" ? "Tất cả" : lv}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setLogs([])}
              className="text-[11px] text-slate-500 hover:text-slate-300 cursor-pointer"
            >
              Xóa màn hình nhật ký
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1 font-mono text-xs pr-1">
            {filteredLogs.length === 0 ? (
              <div className="text-slate-600 py-4 text-center italic">
                Chưa có nhật ký hoạt động nào ở bộ lọc này. Khi bot bắt đầu thực thi tác vụ, tiến
                trình sẽ hiển thị trực tiếp tại đây.
              </div>
            ) : (
              filteredLogs.map((log, idx) => (
                <div
                  key={log.id ?? idx}
                  className={`py-0.5 flex items-start space-x-2 ${
                    log.level === "ERROR"
                      ? "text-rose-400"
                      : log.level === "WARN"
                      ? "text-amber-300"
                      : log.level === "SUCCESS"
                      ? "text-emerald-400"
                      : "text-slate-300"
                  }`}
                >
                  <span className="text-slate-500 text-[10px] whitespace-nowrap">
                    [{new Date(log.timestamp || Date.now()).toLocaleTimeString()}]
                  </span>
                  <span className="font-semibold text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300">
                    {log.jobType}
                  </span>
                  {log.classId && (
                    <span className="text-[10px] px-1 rounded bg-slate-900 border border-slate-800 text-cyan-400">
                      {log.classId}
                    </span>
                  )}
                  <span className="flex-1 break-words">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
