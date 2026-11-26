import Link from "next/link";
import { getSafePublicConfig } from "@/lib/config";
import {
  getDashboardTodayTodoCards,
  type ClassTodayTodoCard,
} from "@/lib/dashboard/today-tasks";
import { DashboardTodayTasksPanel } from "@/components/dashboard-today-tasks-panel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function DashboardPage() {
  getSafePublicConfig();

  let todayTodoCards: ClassTodayTodoCard[] = [];

  try {
    todayTodoCards = getDashboardTodayTodoCards({ limit: 24 });
  } catch {
    // ignore DB errors on cold start
  }

  const pendingCommentClasses = todayTodoCards.filter((c) =>
    c.steps.some((s) => !s.isDone && s.href.startsWith("/session-comments"))
  ).length;
  const pendingReportCardClasses = todayTodoCards.filter((c) =>
    c.steps.some((s) => !s.isDone && s.href.startsWith("/homework-grader"))
  ).length;
  const pendingSpckClasses = todayTodoCards.filter((c) =>
    c.steps.some((s) => !s.isDone && s.href.startsWith("/final-project"))
  ).length;

  return (
    <div className="flex-1 flex flex-col justify-between gap-4 py-1">
      {/* 1. Neo-Brutalism "Việc cần làm hôm nay" + Weekly Scan + Collapsible Groups */}
      <DashboardTodayTasksPanel initialCards={todayTodoCards} />

      {/* 1b. Quick Shortcut to Live Classroom Manager (v3.6.7) */}
      <Link
        href="/classroom-manager"
        className="neo-ws-card neo-ws-indigo rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3">
          <span className="neo-ws-badge-indigo px-2.5 py-1 rounded-lg text-xs font-black shrink-0 mindx-dark-keep">
            ⭐ Trong giờ học
          </span>
          <span className="neo-title-text text-xs sm:text-sm font-extrabold">
            Quản lý Giờ học: Điểm danh, cộng Sao/Huy hiệu, chiếu bảng thi đua &amp; đẩy sang Nhận xét
          </span>
        </div>
        <span className="neo-btn-yellow px-3.5 py-1 rounded-lg text-xs font-black inline-flex items-center gap-1 shrink-0">
          <span>Mở Quản lý Giờ học</span>
          <span>&rarr;</span>
        </span>
      </Link>

      {/* 2. 4 Core Workspaces Grid (Neo-Brutalism Tinted Cards + Yellow CTA Buttons) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {/* Workspace 1 */}
        <Link
          href="/session-comments"
          className="neo-ws-card neo-ws-amber rounded-xl p-3.5 flex flex-col justify-between gap-2.5"
        >
          <div className="space-y-1">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="neo-ws-num-amber w-7 h-7 rounded-lg flex items-center justify-center text-sm font-black shrink-0">
                  1
                </span>
                <h3 className="neo-title-text text-sm sm:text-base font-black leading-snug">
                  1. Nhận xét Buổi học &amp; Zalo
                </h3>
              </div>
              <span className="neo-ws-badge-amber px-2.5 py-0.5 rounded-full text-[11px] font-extrabold shrink-0 mindx-dark-keep">
                {pendingCommentClasses > 0
                  ? `Cần làm: ${pendingCommentClasses} lớp`
                  : "Buổi 1–13 & CP"}
              </span>
            </div>
            <p className="neo-subtitle-text text-xs font-medium pl-9">
              Tích thẻ nhanh, AI soạn nhận xét 3 mục &amp; thông báo Zalo.
            </p>
          </div>
          <div className="flex items-center justify-end">
            <span className="neo-btn-yellow px-3.5 py-1 rounded-lg text-xs font-black inline-flex items-center gap-1">
              <span>Mở công cụ</span>
              <span>&rarr;</span>
            </span>
          </div>
        </Link>

        {/* Workspace 2 */}
        <Link
          href="/homework-grader"
          className="neo-ws-card neo-ws-blue rounded-xl p-3.5 flex flex-col justify-between gap-2.5"
        >
          <div className="space-y-1">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="neo-ws-num-blue w-7 h-7 rounded-lg flex items-center justify-center text-sm font-black shrink-0">
                  2
                </span>
                <h3 className="neo-title-text text-sm sm:text-base font-black leading-snug">
                  2. Phiếu Điểm &amp; BTVN
                </h3>
              </div>
              <span className="neo-ws-badge-blue px-2.5 py-0.5 rounded-full text-[11px] font-extrabold shrink-0 mindx-dark-keep">
                {pendingReportCardClasses > 0
                  ? `Cần đồng bộ: ${pendingReportCardClasses} lớp`
                  : "Phiếu điểm Teaching"}
              </span>
            </div>
            <p className="neo-subtitle-text text-xs font-medium pl-9">
              Tổng hợp BTVN, Checkpoint, [ĐNL], xuất ảnh &amp; đẩy Teaching.
            </p>
          </div>
          <div className="flex items-center justify-end">
            <span className="neo-btn-yellow px-3.5 py-1 rounded-lg text-xs font-black inline-flex items-center gap-1">
              <span>Mở công cụ</span>
              <span>&rarr;</span>
            </span>
          </div>
        </Link>

        {/* Workspace 3 */}
        <Link
          href="/final-project"
          className="neo-ws-card neo-ws-emerald rounded-xl p-3.5 flex flex-col justify-between gap-2.5"
        >
          <div className="space-y-1">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="neo-ws-num-emerald w-7 h-7 rounded-lg flex items-center justify-center text-sm font-black shrink-0">
                  3
                </span>
                <h3 className="neo-title-text text-sm sm:text-base font-black leading-snug">
                  3. Sản phẩm Cuối khóa (SPCK)
                </h3>
              </div>
              <span className="neo-ws-badge-emerald px-2.5 py-0.5 rounded-full text-[11px] font-extrabold shrink-0 mindx-dark-keep">
                {pendingSpckClasses > 0
                  ? `Buổi 12–14: ${pendingSpckClasses} lớp`
                  : "Buổi 12, 13 & 14"}
              </span>
            </div>
            <p className="neo-subtitle-text text-xs font-medium pl-9">
              Quét dự án, ảnh bìa, nộp SPCK B12–14 &amp; Thư tổng kết.
            </p>
          </div>
          <div className="flex items-center justify-end">
            <span className="neo-btn-yellow px-3.5 py-1 rounded-lg text-xs font-black inline-flex items-center gap-1">
              <span>Mở công cụ</span>
              <span>&rarr;</span>
            </span>
          </div>
        </Link>

        {/* Workspace 4 */}
        <Link
          href="/syllabus-config"
          className="neo-ws-card neo-ws-purple rounded-xl p-3.5 flex flex-col justify-between gap-2.5"
        >
          <div className="space-y-1">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="neo-ws-num-purple w-7 h-7 rounded-lg flex items-center justify-center text-sm font-black shrink-0">
                  4
                </span>
                <h3 className="neo-title-text text-sm sm:text-base font-black leading-snug">
                  4. Giáo trình &amp; Thẻ Nhận xét
                </h3>
              </div>
              <span className="neo-ws-badge-purple px-2.5 py-0.5 rounded-full text-[11px] font-extrabold shrink-0 mindx-dark-keep">
                Cấu hình
              </span>
            </div>
            <p className="neo-subtitle-text text-xs font-medium pl-9">
              Chỉnh bài học từng buổi, mốc Checkpoint &amp; 3 bộ thẻ nhanh.
            </p>
          </div>
          <div className="flex items-center justify-end">
            <span className="neo-btn-yellow px-3.5 py-1 rounded-lg text-xs font-black inline-flex items-center gap-1">
              <span>Mở cấu hình</span>
              <span>&rarr;</span>
            </span>
          </div>
        </Link>
      </div>
    </div>
  );
}
