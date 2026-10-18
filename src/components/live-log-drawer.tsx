"use client";

import { useEffect, useState } from "react";
import type { JobLogRecord } from "@/lib/db/sqlite";
import type { QueueStatus } from "@/lib/queue/task-queue";

export function LiveLogDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const [logs, setLogs] = useState<JobLogRecord[]>([]);
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [isStopping, setIsStopping] = useState(false);

  useEffect(() => {
    const eventSource = new EventSource("/api/queue/stream");

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "LOG") {
          setLogs((prev) => [...prev.slice(-99), payload.data]);
        } else if (payload.type === "STATUS") {
          setStatus(payload.data);
        }
      } catch {
        // Parse error ignored
      }
    };

    return () => {
      eventSource.close();
    };
  }, []);

  const handleStopBot = async () => {
    setIsStopping(true);
    try {
      await fetch("/api/queue/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
    } catch (err) {
      console.error("Failed to stop bot:", err);
    } finally {
      setIsStopping(false);
    }
  };

  const handleResumeBot = async () => {
    try {
      await fetch("/api/queue/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume" }),
      });
    } catch (err) {
      console.error("Failed to resume bot:", err);
    }
  };

  const isRunning = status?.isRunning ?? false;
  const isStopped = status?.isStopped ?? false;

  return (
    <>
      {/* Floating Bottom Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-slate-900/95 border-t border-slate-800 px-4 py-2.5 backdrop-blur flex items-center justify-between shadow-2xl">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center space-x-2 text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 transition-colors"
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
                ? "Hàng đợi đang TẠM DỪNG"
                : "Hàng đợi Sẵn sàng"}
            </span>
            <span className="text-slate-400 font-mono text-[11px]">
              ({status?.pendingCount ?? 0} chờ)
            </span>
          </button>

          {status?.currentTask && (
            <span className="text-xs text-amber-300 truncate max-w-md hidden sm:inline">
              ⚡ {status.currentTask.description}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {isStopped ? (
            <button
              onClick={handleResumeBot}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
            >
              ▶️ Tiếp tục chạy
            </button>
          ) : (
            <button
              onClick={handleStopBot}
              disabled={isStopping}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition-colors disabled:opacity-50"
            >
              🛑 Dừng khẩn cấp (Stop Bot)
            </button>
          )}

          <button
            onClick={() => setIsOpen(!isOpen)}
            className="text-xs px-2.5 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            title="Đóng / Mở Log Drawer"
          >
            {isOpen ? "▼ Ẩn Nhật ký" : "▲ Xem Nhật ký"}
          </button>
        </div>
      </div>

      {/* Slide-up Drawer */}
      {isOpen && (
        <div className="fixed bottom-12 left-0 right-0 z-40 bg-slate-950/98 border-t border-slate-800 p-4 max-h-80 flex flex-col shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Nhật Ký Tác Vụ Playwright Thời Gian Thực (Live Logs)
            </span>
            <button
              onClick={() => setLogs([])}
              className="text-[11px] text-slate-500 hover:text-slate-300"
            >
              Xóa màn hình
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1 font-mono text-xs pr-1">
            {logs.length === 0 ? (
              <div className="text-slate-600 py-4 text-center italic">
                Chưa có nhật ký hoạt động nào. Khi bot bắt đầu thực thi tác vụ, tiến trình sẽ hiển thị tại đây.
              </div>
            ) : (
              logs.map((log, idx) => (
                <div
                  key={idx}
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
                  <span className="font-semibold text-[10px] px-1 rounded bg-slate-800 text-slate-400">
                    {log.jobType}
                  </span>
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
