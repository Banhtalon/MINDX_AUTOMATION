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

      {/* 2. 4 Core Workspaces Grid (Neo-Brutalism Tinted Cards + Yellow CTA Buttons) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {/* Workspace 1 */}
        <Link
          href="/session-comments"
          className="neo-ws-card neo-ws-amber rounded-xl p-3.5 flex flex-col justify-between gap-2.5"
        >
          <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="neo-ws-num-amber w-7 h-7 rounded-lg flex items-center justify-center text-sm font-black shrink-0">
                  1
                </span>
                <h3 className="text-sm sm:text-base font-black text-[#0f172a] leading-snug">
                  1. Nhận xét Buổi học &amp; Thông báo Zalo
                </h3>
              </div>
              <span className="neo-ws-badge-amber px-2.5 py-0.5 rounded-full text-[11px] font-extrabold shrink-0 mindx-dark-keep">
                {pendingCommentClasses > 0
                  ? `Cần làm: ${pendingCommentClasses} lớp`
                  : "Buổi 1 – 13 & Checkpoint"}
              </span>
            </div>
            <p className="text-xs font-medium text-slate-700 leading-relaxed pl-9">
              Đồng bộ lớp đang dạy, tích nhanh thẻ Lập trình / Robotics trên 1 hàng gọn, AI soạn nhận xét 3 mục chuẩn và tin nhắn tổng kết Zalo.
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
          <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="neo-ws-num-blue w-7 h-7 rounded-lg flex items-center justify-center text-sm font-black shrink-0">
                  2
                </span>
                <h3 className="text-sm sm:text-base font-black text-[#0f172a] leading-snug">
                  2. Phiếu Điểm Tổng Kết (Chuẩn Teaching) &amp; Bảng Điểm BTVN
                </h3>
              </div>
              <span className="neo-ws-badge-blue px-2.5 py-0.5 rounded-full text-[11px] font-extrabold shrink-0 mindx-dark-keep">
                {pendingReportCardClasses > 0
                  ? `Cần đồng bộ: ${pendingReportCardClasses} lớp`
                  : "Phiếu điểm Teaching & BTVN"}
              </span>
            </div>
            <p className="text-xs font-medium text-slate-700 leading-relaxed pl-9">
              Tự động tổng hợp điểm BTVN (Lập trình), Check-point 1 &amp; 2, Điểm Năng lực [ĐNL] và Cuối khóa DEMO từ LMS; xuất ảnh gửi Zalo và đồng bộ lên Teaching.
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
          <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="neo-ws-num-emerald w-7 h-7 rounded-lg flex items-center justify-center text-sm font-black shrink-0">
                  3
                </span>
                <h3 className="text-sm sm:text-base font-black text-[#0f172a] leading-snug">
                  3. Nộp Sản phẩm Cuối khóa (SPCK) &amp; Tổng kết Buổi 14
                </h3>
              </div>
              <span className="neo-ws-badge-emerald px-2.5 py-0.5 rounded-full text-[11px] font-extrabold shrink-0 mindx-dark-keep">
                {pendingSpckClasses > 0
                  ? `Buổi 12–14: ${pendingSpckClasses} lớp`
                  : "Buổi 12, 13 & 14"}
              </span>
            </div>
            <p className="text-xs font-medium text-slate-700 leading-relaxed pl-9">
              Quét thư mục dự án hoặc Playlist YouTube (Robotics), chuẩn bị ảnh bìa &amp; đường dẫn sản phẩm, nộp SPCK các buổi 12–14 và đẩy Thư tổng kết cuối khóa Buổi 14.
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
          <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="neo-ws-num-purple w-7 h-7 rounded-lg flex items-center justify-center text-sm font-black shrink-0">
                  4
                </span>
                <h3 className="text-sm sm:text-base font-black text-[#0f172a] leading-snug">
                  4. Quản lý Giáo trình &amp; Bộ Thẻ Nhận xét Nhanh
                </h3>
              </div>
              <span className="neo-ws-badge-purple px-2.5 py-0.5 rounded-full text-[11px] font-extrabold shrink-0 mindx-dark-keep">
                Cấu hình
              </span>
            </div>
            <p className="text-xs font-medium text-slate-700 leading-relaxed pl-9">
              Tùy chỉnh nội dung từng buổi học, đánh dấu buổi Kiểm tra (Checkpoint) và quản lý 3 bộ thẻ nhận xét nhanh (Lập trình, Robotics, Buổi 14).
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
