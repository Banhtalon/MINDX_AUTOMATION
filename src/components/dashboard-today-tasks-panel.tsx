"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ClassTodayTodoCard, TodayActionStep } from "@/lib/dashboard/today-tasks";

interface DashboardTodayTasksPanelProps {
  initialCards: ClassTodayTodoCard[];
}

type FilterMode = "all" | "pending" | "done";

function stripCircledNumber(label: string): string {
  return String(label || "")
    .replace(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*/, "")
    .trim();
}

function getPendingSubLabel(card: ClassTodayTodoCard): string {
  if (card.currentSessionNumber >= 14) {
    return "Chưa hoàn thành CK";
  }
  if (card.currentSessionNumber >= 11) {
    return "Cần cập nhật";
  }
  if (card.isCheckpoint) {
    return "Buổi Checkpoint";
  }
  return "Chưa đẩy LMS";
}

function getSessionBadgeClass(card: ClassTodayTodoCard, isDoneRow: boolean): string {
  if (isDoneRow) return "neo-session-green";
  if (card.currentSessionNumber >= 14) return "neo-session-purple";
  if (card.currentSessionNumber >= 11) return "neo-session-green";
  if (card.isCheckpoint) return "neo-session-amber";
  return "neo-session-blue";
}

function getCompactSessionLabel(card: ClassTodayTodoCard): string {
  if (card.isCheckpoint) {
    return `Buổi ${card.currentSessionNumber} • CP`;
  }
  return `Buổi ${card.currentSessionNumber}`;
}

export function DashboardTodayTasksPanel({
  initialCards,
}: DashboardTodayTasksPanelProps) {
  const router = useRouter();
  const [cards, setCards] = useState<ClassTodayTodoCard[]>(initialCards);
  const [isScanning, setIsScanning] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [pendingExpanded, setPendingExpanded] = useState(true);
  // Mặc định thu gọn nhóm "Đã xong" khi còn lớp cần làm, và tự mở khi tất cả lớp đã hoàn thành
  const [doneExpanded, setDoneExpanded] = useState<boolean | null>(null);
  const [scanBanner, setScanBanner] = useState<{
    type: "success" | "error";
    text: string;
    timeText: string;
  } | null>(null);

  useEffect(() => {
    setCards(initialCards);
  }, [initialCards]);

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredCards = useMemo(() => {
    if (!normalizedQuery) return cards;
    return cards.filter(
      (c) =>
        c.classId.toLowerCase().includes(normalizedQuery) ||
        (c.className && c.className.toLowerCase().includes(normalizedQuery)) ||
        `buổi ${c.currentSessionNumber}`.includes(normalizedQuery)
    );
  }, [cards, normalizedQuery]);

  const pendingCards = useMemo(
    () => filteredCards.filter((c) => !c.allDone),
    [filteredCards]
  );
  const doneCards = useMemo(
    () => filteredCards.filter((c) => c.allDone),
    [filteredCards]
  );

  const totalCount = cards.length;
  const totalPendingCount = cards.filter((c) => !c.allDone).length;
  const totalDoneCount = cards.filter((c) => c.allDone).length;

  const handleSelectFilter = (mode: FilterMode) => {
    setFilterMode(mode);
    if (mode === "pending") {
      setPendingExpanded(true);
    } else if (mode === "done") {
      setDoneExpanded(true);
    } else {
      setPendingExpanded(true);
    }
  };

  const handleScanWeeklyTasks = async () => {
    if (isScanning) return;
    setIsScanning(true);
    setScanBanner(null);
    try {
      const res = await fetch("/api/dashboard/scan-weekly-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (Array.isArray(data?.cards)) {
        setCards(data.cards);
      }
      const nowStr = new Date().toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
      });
      if (!res.ok || !data?.success) {
        setScanBanner({
          type: "error",
          text:
            data?.error ||
            "Không thể quét dữ liệu tuần này từ LMS. Vui lòng thử lại.",
          timeText: `Lúc ${nowStr} hôm nay`,
        });
      } else {
        const syncedCount = Number(data?.syncedCount ?? 0);
        const failCount = Array.isArray(data?.failedClasses)
          ? data.failedClasses.length
          : 0;
        setScanBanner({
          type: "success",
          text:
            failCount > 0
              ? `Đồng bộ thành công • ${syncedCount} lớp (${failCount} lớp lỗi kết nối)`
              : `Đồng bộ thành công • ${syncedCount} lớp từ LMS & Teaching`,
          timeText: `Cập nhật lúc ${nowStr} hôm nay`,
        });
        router.refresh();
      }
    } catch (err: any) {
      const nowStr = new Date().toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
      });
      setScanBanner({
        type: "error",
        text:
          err instanceof Error
            ? err.message
            : "Lỗi kết nối khi quét công việc tuần này.",
        timeText: `Lúc ${nowStr} hôm nay`,
      });
    } finally {
      setIsScanning(false);
    }
  };

  const showPendingGroup =
    filterMode === "pending" ||
    (filterMode === "all" && pendingCards.length > 0);
  const showDoneGroup = filterMode === "all" || filterMode === "done";
  const isDoneGroupOpen =
    doneExpanded !== null ? doneExpanded : pendingCards.length === 0;

  return (
    <section className="space-y-2.5">
      {/* 1. Top Header Bar: Title + 3 KPI Boxes + Primary Weekly Scan Button */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-2.5">
        <div className="flex items-center gap-3">
          <div className="neo-title-icon w-11 h-11 rounded-xl flex items-center justify-center shrink-0">
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              viewBox="0 0 24 24"
            >
              <rect x="3" y="4" width="18" height="18" rx="2.5" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
          </div>
          <div>
            <h1 className="neo-title-text text-xl sm:text-2xl font-black tracking-tight leading-none">
              Việc cần làm hôm nay
            </h1>
            <p className="neo-subtitle-text text-xs font-medium mt-1">
              Tổng hợp công việc cho các lớp hiện tại, dựa trên buổi học và trạng thái đã lưu từ LMS &amp; Teaching.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* KPI 1: Tổng số lớp */}
          <div className="neo-kpi-total px-3 py-1.5 rounded-xl flex items-center gap-2.5 min-w-[116px]">
            <div className="w-7 h-7 rounded-lg bg-[#dbeafe] border border-[#1e40af] text-[#1e40af] flex items-center justify-center shrink-0">
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.2}
                viewBox="0 0 24 24"
              >
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
            </div>
            <div className="leading-tight">
              <div className="text-[11px] font-bold text-slate-600">Tổng số lớp</div>
              <div className="text-xl font-black text-[#0f172a] leading-none mt-0.5">
                {totalCount}
              </div>
            </div>
          </div>

          {/* KPI 2: Cần làm (chỉ hiện màu cảnh báo khi có lớp chưa xong) */}
          {totalPendingCount > 0 ? (
            <div className="neo-kpi-pending px-3 py-1.5 rounded-xl flex items-center gap-2.5 min-w-[104px]">
              <div className="w-7 h-7 rounded-full bg-[#ea580c] text-white flex items-center justify-center font-black text-sm shrink-0">
                !
              </div>
              <div className="leading-tight">
                <div className="text-[11px] font-bold text-[#c2410c]">Cần làm</div>
                <div className="text-xl font-black text-[#b91c1c] leading-none mt-0.5">
                  {totalPendingCount}
                </div>
              </div>
            </div>
          ) : (
            <div className="neo-kpi-done px-3 py-1.5 rounded-xl flex items-center gap-2.5 min-w-[104px]">
              <div className="w-7 h-7 rounded-full bg-[#15803d] text-white flex items-center justify-center font-black text-sm shrink-0">
                ✓
              </div>
              <div className="leading-tight">
                <div className="text-[11px] font-bold text-[#15803d]">Cần làm</div>
                <div className="text-xl font-black text-[#14532d] leading-none mt-0.5">
                  0
                </div>
              </div>
            </div>
          )}

          {/* KPI 3: Đã xong */}
          <div className="neo-kpi-done px-3 py-1.5 rounded-xl flex items-center gap-2.5 min-w-[104px]">
            <div className="w-7 h-7 rounded-full bg-[#15803d] text-white flex items-center justify-center font-black text-sm shrink-0">
              ✓
            </div>
            <div className="leading-tight">
              <div className="text-[11px] font-bold text-[#15803d]">Đã xong</div>
              <div className="text-xl font-black text-[#14532d] leading-none mt-0.5">
                {totalDoneCount}
              </div>
            </div>
          </div>

          {/* Primary Action Button: Quét công việc tuần này */}
          <button
            type="button"
            onClick={handleScanWeeklyTasks}
            disabled={isScanning}
            title="Quét lại danh sách lớp đang dạy, buổi học hiện tại và trạng thái nhận xét / tiến độ thực tế trên LMS & Teaching"
            className="neo-btn-blue px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-black flex items-center gap-2 cursor-pointer disabled:opacity-60 mindx-dark-keep"
          >
            <span className={isScanning ? "animate-spin inline-block" : ""}>
              {isScanning ? "⏳" : "🔄"}
            </span>
            <span>
              {isScanning
                ? "Đang quét LMS & Teaching..."
                : "Quét công việc tuần này"}
            </span>
          </button>
        </div>
      </div>

      {/* 2. Sync Status Banner (when triggered) */}
      {scanBanner && (
        <div
          className={`${
            scanBanner.type === "success" ? "neo-banner-success" : "neo-banner-error"
          } px-3.5 py-2 rounded-xl text-xs font-bold flex flex-wrap items-center justify-between gap-2`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-[11px] font-black shrink-0 ${
                scanBanner.type === "success" ? "bg-[#15803d]" : "bg-[#dc2626]"
              }`}
            >
              {scanBanner.type === "success" ? "✓" : "!"}
            </span>
            <span>{scanBanner.text}</span>
          </div>
          <div className="flex items-center gap-3 text-[11px] font-semibold">
            <span>| {scanBanner.timeText}</span>
            <button
              type="button"
              onClick={() => setScanBanner(null)}
              className="underline hover:opacity-80 cursor-pointer font-bold"
            >
              Đóng
            </button>
          </div>
        </div>
      )}

      {/* 3. Search & Filter Row */}
      {cards.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <div className="neo-search-box px-3 py-1.5 rounded-xl flex items-center gap-2 w-full sm:w-64">
              <span className="text-slate-500 text-xs">🔍</span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm lớp... (ví dụ: VT-C4K, JSB...)"
                className="w-full bg-transparent text-xs font-semibold focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="text-xs font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => handleSelectFilter("pending")}
              className={`${
                filterMode === "pending" ? "neo-filter-active" : "neo-filter-inactive"
              } px-3 py-1.5 rounded-xl text-xs font-extrabold cursor-pointer transition`}
            >
              Cần làm ({pendingCards.length})
            </button>

            <button
              type="button"
              onClick={() => handleSelectFilter("done")}
              className={`${
                filterMode === "done" ? "neo-filter-active" : "neo-filter-inactive"
              } px-3 py-1.5 rounded-xl text-xs font-extrabold cursor-pointer transition`}
            >
              Đã xong ({doneCards.length})
            </button>

            {filterMode !== "all" && (
              <button
                type="button"
                onClick={() => handleSelectFilter("all")}
                className="neo-filter-inactive px-3 py-1.5 rounded-xl text-xs font-extrabold cursor-pointer transition"
              >
                Hiện tất cả ({filteredCards.length})
              </button>
            )}
          </div>
        </div>
      )}

      {/* 4. Collapsible Group 1: Danh sách lớp cần làm */}
      {cards.length === 0 ? (
        <div className="neo-group-box p-4 rounded-xl text-xs font-semibold text-slate-700">
          Chưa có lớp đang mở nào được đồng bộ — hãy bấm{" "}
          <span className="font-black text-[#2563eb]">
            🔄 Quét công việc tuần này
          </span>{" "}
          ở góc phải hoặc mở{" "}
          <Link
            href="/session-comments"
            className="font-black text-[#ea580c] underline"
          >
            1. Nhận xét Buổi học
          </Link>{" "}
          để đồng bộ danh sách lớp từ LMS.
        </div>
      ) : (
        <div className="space-y-2.5">
          {showPendingGroup && (
            <div className="neo-group-box rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setPendingExpanded((prev) => !prev)}
                className="neo-group-header-pending w-full px-3.5 py-2 flex items-center justify-between cursor-pointer text-left"
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-[#d97706] text-white flex items-center justify-center font-black text-xs shrink-0">
                    !
                  </span>
                  <span className="text-sm sm:text-base font-black text-[#0f172a]">
                    Danh sách lớp cần làm ({pendingCards.length})
                  </span>
                </div>
                <span className="text-sm font-black text-[#0f172a] px-1">
                  {pendingExpanded ? "▲" : "▼"}
                </span>
              </button>

              {pendingExpanded && (
                <div>
                  {pendingCards.length > 0 ? (
                    pendingCards.map((card, idx) => (
                      <div
                        key={card.classId}
                        className="neo-row px-3.5 py-2 flex flex-col lg:flex-row lg:items-center justify-between gap-2"
                      >
                        <div className="flex flex-wrap items-center gap-2.5">
                          {/* Row index badge */}
                          <span className="neo-idx-pending w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black shrink-0">
                            {idx + 1}
                          </span>

                          {/* Class code & sub-status */}
                          <div className="min-w-[138px]">
                            <Link
                              href={card.primaryHref}
                              className="font-black text-sm sm:text-base text-[#0f172a] hover:text-[#2563eb] transition-colors block leading-tight"
                            >
                              {card.classId}
                            </Link>
                            <span className="text-[11px] font-semibold text-slate-600 block leading-tight">
                              {getPendingSubLabel(card)}
                            </span>
                          </div>

                          <span className="hidden sm:inline-block text-slate-300 font-bold">
                            |
                          </span>

                          {/* Session badge */}
                          <span
                            className={`${getSessionBadgeClass(
                              card,
                              false
                            )} px-2.5 py-0.5 rounded-md text-xs font-extrabold min-w-[68px] text-center`}
                          >
                            {getCompactSessionLabel(card)}
                          </span>

                          <span className="hidden sm:inline-block text-slate-300 font-bold">
                            |
                          </span>

                          {/* Task pills */}
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-semibold text-slate-700 mr-0.5">
                              Công việc cần làm:
                            </span>
                            {card.steps.map((step: TodayActionStep) => {
                              const cleanLabel = stripCircledNumber(step.label);
                              return (
                                <React.Fragment
                                  key={`${card.classId}_step_${step.stepNumber}`}
                                >
                                  <Link
                                    href={step.href}
                                    title={`${cleanLabel} (${step.statusText})`}
                                    className={`${
                                      step.isDone
                                        ? "neo-pill-done"
                                        : "neo-pill-pending"
                                    } px-2.5 py-1 rounded-lg text-xs font-extrabold flex items-center gap-1.5`}
                                  >
                                    <span
                                      className={`w-4 h-4 rounded-full text-white text-[10px] font-black flex items-center justify-center shrink-0 ${
                                        step.isDone
                                          ? "bg-[#15803d]"
                                          : "bg-[#ea580c]"
                                      }`}
                                    >
                                      {step.isDone ? "✓" : "!"}
                                    </span>
                                    <span>{cleanLabel}</span>
                                  </Link>
                                  {card.steps.length === 1 && !step.isDone && (
                                    <span className="neo-pill-substatus px-2.5 py-1 rounded-lg text-xs font-bold">
                                      ({step.statusText})
                                    </span>
                                  )}
                                </React.Fragment>
                              );
                            })}
                          </div>
                        </div>

                        {/* Right Action Button: Xử lý -> */}
                        <div className="flex items-center justify-end shrink-0">
                          <Link
                            href={card.primaryHref}
                            className="neo-btn-blue px-3.5 py-1.5 rounded-lg text-xs font-black flex items-center gap-1.5 mindx-dark-keep"
                          >
                            <span>Xử lý</span>
                            <span>&rarr;</span>
                          </Link>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="neo-row px-4 py-3 text-xs font-bold text-[#15803d]">
                      🎉 Tuyệt vời! Không còn lớp nào tồn đọng công việc cần làm.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 5. Collapsible Group 2: Danh sách lớp đã xong (Collapsed by default for compactness) */}
          {showDoneGroup && (
            <div className="neo-group-box rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() =>
                  setDoneExpanded((prev) =>
                    !(prev !== null ? prev : pendingCards.length === 0)
                  )
                }
                className="neo-group-header-done w-full px-3.5 py-2 flex items-center justify-between cursor-pointer text-left"
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-[#15803d] text-white flex items-center justify-center font-black text-xs shrink-0">
                    ✓
                  </span>
                  <span className="text-sm sm:text-base font-black text-[#0f172a]">
                    Danh sách lớp đã xong ({doneCards.length})
                  </span>
                  {!isDoneGroupOpen && doneCards.length > 0 && (
                    <span className="text-xs font-bold text-[#166534] hidden sm:inline">
                      — Bấm để xem chi tiết {doneCards.length} lớp đã hoàn thành
                    </span>
                  )}
                </div>
                <span className="text-sm font-black text-[#0f172a] px-1">
                  {isDoneGroupOpen ? "▲" : "▼"}
                </span>
              </button>

              {isDoneGroupOpen && (
                <div>
                  {doneCards.length > 0 ? (
                    doneCards.map((card, idx) => (
                      <div
                        key={card.classId}
                        className="neo-row px-3.5 py-2 flex flex-col lg:flex-row lg:items-center justify-between gap-2"
                      >
                        <div className="flex flex-wrap items-center gap-2.5">
                          <span className="neo-idx-done w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black shrink-0">
                            {idx + 1}
                          </span>

                          <div className="min-w-[138px]">
                            <Link
                              href={card.primaryHref}
                              className="font-black text-sm sm:text-base text-[#0f172a] hover:text-[#15803d] transition-colors block"
                            >
                              {card.classId}
                            </Link>
                          </div>

                          <span className="hidden sm:inline-block text-slate-300 font-bold">
                            |
                          </span>

                          <span
                            className={`${getSessionBadgeClass(
                              card,
                              true
                            )} px-2.5 py-0.5 rounded-md text-xs font-extrabold min-w-[68px] text-center`}
                          >
                            {getCompactSessionLabel(card)}
                          </span>

                          <span className="hidden sm:inline-block text-slate-300 font-bold">
                            |
                          </span>

                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-semibold text-slate-700 mr-0.5">
                              Hoàn thành:
                            </span>
                            {card.steps.map((step: TodayActionStep) => {
                              const cleanLabel = stripCircledNumber(step.label);
                              return (
                                <Link
                                  key={`${card.classId}_done_${step.stepNumber}`}
                                  href={step.href}
                                  className="neo-pill-done px-2.5 py-1 rounded-lg text-xs font-extrabold flex items-center gap-1.5"
                                >
                                  <span className="w-4 h-4 rounded-full bg-[#15803d] text-white text-[10px] font-black flex items-center justify-center shrink-0">
                                    ✓
                                  </span>
                                  <span>{cleanLabel}</span>
                                </Link>
                              );
                            })}
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 shrink-0">
                          <span className="neo-pill-done px-2.5 py-1 rounded-lg text-xs font-extrabold flex items-center gap-1">
                            <span className="w-4 h-4 rounded-full bg-[#15803d] text-white text-[10px] font-black flex items-center justify-center">
                              ✓
                            </span>
                            <span>Đã xong</span>
                          </span>
                          <Link
                            href={card.primaryHref}
                            className="neo-btn-neutral px-3 py-1 rounded-lg text-xs font-bold"
                          >
                            Xem chi tiết
                          </Link>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="neo-row px-4 py-3 text-xs font-semibold text-slate-600">
                      Chưa có lớp nào hoàn thành tất cả đầu việc của buổi hiện tại.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
