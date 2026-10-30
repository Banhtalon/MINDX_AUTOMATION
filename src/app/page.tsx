import Link from "next/link";
import { getSafePublicConfig } from "@/lib/config";
import { getCoursesSyllabus, getGradingRubrics } from "@/lib/db/json-config";
import { getDb } from "@/lib/db/sqlite";
import {
  getDashboardTodayTodoCards,
  type ClassTodayTodoCard,
} from "@/lib/dashboard/today-tasks";

interface RecentClassItem {
  classId: string;
  className: string;
  sessionCount: number;
  studentCount: number;
  updatedAt: string;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function DashboardPage() {
  getSafePublicConfig();
  const courses = getCoursesSyllabus();
  const rubrics = getGradingRubrics();

  let totalClasses = 0;
  let totalComments = 0;
  let verifiedComments = 0;
  let recentClasses: RecentClassItem[] = [];
  let todayTodoCards: ClassTodayTodoCard[] = [];

  try {
    const db = getDb();
    totalClasses =
      (
        db
          .prepare(`SELECT COUNT(DISTINCT classId) as cnt FROM classes_sessions`)
          .get() as { cnt?: number } | undefined
      )?.cnt ?? 0;
    totalComments =
      (
        db
          .prepare(
            `SELECT COUNT(*) as cnt FROM session_feedbacks WHERE trim(finalText) != ''`
          )
          .get() as { cnt?: number } | undefined
      )?.cnt ?? 0;
    verifiedComments =
      (
        db
          .prepare(
            `SELECT COUNT(*) as cnt FROM session_feedbacks WHERE status = 'VERIFIED'`
          )
          .get() as { cnt?: number } | undefined
      )?.cnt ?? 0;

    recentClasses = db
      .prepare(
        `
        SELECT
          cs.classId,
          MAX(cs.className) as className,
          COUNT(DISTINCT cs.sessionId) as sessionCount,
          (SELECT COUNT(*) FROM students s WHERE s.classId = cs.classId AND s.isActive = 1) as studentCount,
          MAX(cs.updatedAt) as updatedAt
        FROM classes_sessions cs
        GROUP BY cs.classId
        ORDER BY MAX(cs.updatedAt) DESC
        LIMIT 5
      `
      )
      .all() as RecentClassItem[];

    todayTodoCards = getDashboardTodayTodoCards({ limit: 8 });
  } catch {
    // ignore DB errors on cold start
  }

  return (
    <div className="flex-1 flex flex-col justify-between gap-3">
      {/* Hero Banner */}
      <div className="mindx-hero px-4 py-3 rounded-2xl transition-all">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-2">
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white">
              Trợ Lý Giảng Dạy MindX (v3.4)
            </h1>
          </div>
        </div>
      </div>

      {/* S6.4: Smart "Việc cần làm hôm nay" Action Cards per Class */}
      <section className="mindx-card mindx-card-emerald p-4 rounded-2xl space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-base">📌</span>
            <h2 className="text-sm sm:text-base font-extrabold text-white">
              Việc cần làm hôm nay
            </h2>
            <span className="text-xs text-slate-400">
              (Tự động gợi ý theo buổi hiện tại &amp; trạng thái đã lưu của từng lớp — bấm để mở đúng màn hình &amp; đúng lớp)
            </span>
          </div>
        </div>

        {todayTodoCards.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {todayTodoCards.map((card) => (
              <div
                key={card.classId}
                className="p-3 rounded-xl bg-slate-900/75 border border-slate-700/80 flex flex-col justify-between gap-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Link
                      href={card.primaryHref}
                      className="font-extrabold text-sm text-white hover:text-emerald-400 transition-colors"
                    >
                      {card.classId}
                    </Link>
                    {card.className && card.className !== card.classId && (
                      <span className="text-xs text-slate-400 truncate max-w-[180px]">
                        ({card.className})
                      </span>
                    )}
                  </div>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                      card.allDone
                        ? "bg-emerald-700 text-white mindx-dark-keep"
                        : card.currentSessionNumber >= 14
                        ? "bg-indigo-700 text-white mindx-dark-keep"
                        : card.isCheckpoint
                        ? "bg-amber-800 text-white mindx-dark-keep"
                        : "bg-slate-700 text-white mindx-dark-keep"
                    }`}
                  >
                    {card.sessionBadgeText}
                  </span>
                </div>

                <div className="text-xs text-slate-300 font-medium">
                  {card.summaryText}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {card.steps.map((step) => (
                    <Link
                      key={`${card.classId}_${step.stepNumber}`}
                      href={step.href}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition flex items-center gap-1 ${
                        step.isDone
                          ? "bg-emerald-950/60 border-emerald-600/60 text-emerald-300 hover:bg-emerald-900/60"
                          : "bg-slate-800/90 border-amber-500/50 text-amber-200 hover:bg-slate-700"
                      }`}
                    >
                      <span>{step.label}</span>
                      <span className="text-[11px] opacity-85">({step.statusText})</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-slate-400">
            Chưa có lớp đang mở nào được đồng bộ — hãy mở{" "}
            <Link
              href="/session-comments"
              className="text-amber-400 font-bold underline"
            >
              1. Nhận xét Buổi học
            </Link>{" "}
            để đồng bộ danh sách lớp từ LMS.
          </div>
        )}
      </section>

      {/* 4 Core Workspaces Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1">
        {/* Workspace 1 */}
        <Link
          href="/session-comments"
          className="mindx-card-amber group flex flex-col justify-between px-4 py-3 rounded-xl hover:-translate-y-0.5 transition-all"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xl drop-shadow-sm">📝</span>
              <span className="mindx-badge-amber text-xs px-3 py-0.5 rounded-full">
                Buổi 1 – 13 &amp; Checkpoint
              </span>
            </div>
            <h3 className="mt-2 text-base font-bold group-hover:text-amber-500 transition-colors">
              1. Nhận xét Buổi học &amp; Thông báo Zalo
            </h3>
            <p className="mt-1 text-xs text-slate-400 leading-snug">
              Đồng bộ lớp đang dạy, tích nhanh thẻ Lập trình / Robotics trên 1 hàng gọn, AI soạn nhận xét 3 mục chuẩn (hỗ trợ buổi Checkpoint) và soạn tin nhắn tổng kết Zalo.
            </p>
          </div>
          <div className="mt-2.5 pt-2 border-t border-slate-800/70 flex items-center justify-end text-xs">
            <span className="font-bold text-amber-400 group-hover:translate-x-0.5 transition-transform">
              Mở công cụ &rarr;
            </span>
          </div>
        </Link>

        {/* Workspace 2 */}
        <Link
          href="/homework-grader"
          className="mindx-card-blue group flex flex-col justify-between px-4 py-3 rounded-xl hover:-translate-y-0.5 transition-all"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xl drop-shadow-sm">📊</span>
              <span className="mindx-badge-blue text-xs px-3 py-0.5 rounded-full">
                Phiếu điểm Teaching &amp; BTVN
              </span>
            </div>
            <h3 className="mt-2 text-base font-bold group-hover:text-sky-500 transition-colors">
              2. Phiếu Điểm Tổng Kết (Chuẩn Teaching) &amp; Bảng Điểm BTVN
            </h3>
            <p className="mt-1 text-xs text-slate-400 leading-snug">
              Tự động tổng hợp điểm BTVN (Lập trình), Check-point 1 &amp; 2, Điểm Năng lực `[ĐNL]` và Cuối khóa DEMO từ LMS; xuất ảnh gửi Zalo và đồng bộ 1 chạm lên Teaching.
            </p>
          </div>
          <div className="mt-2.5 pt-2 border-t border-slate-800/70 flex items-center justify-end text-xs">
            <span className="font-bold text-sky-400 group-hover:translate-x-0.5 transition-transform">
              Mở công cụ &rarr;
            </span>
          </div>
        </Link>

        {/* Workspace 3 */}
        <Link
          href="/final-project"
          className="mindx-card-emerald group flex flex-col justify-between px-4 py-3 rounded-xl hover:-translate-y-0.5 transition-all"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xl drop-shadow-sm">🚀</span>
              <span className="mindx-badge-emerald text-xs px-3 py-0.5 rounded-full">
                Buổi 12, 13 &amp; 14
              </span>
            </div>
            <h3 className="mt-2 text-base font-bold group-hover:text-emerald-500 transition-colors">
              3. Nộp Sản phẩm Cuối khóa (SPCK) &amp; Tổng kết Buổi 14
            </h3>
            <p className="mt-1 text-xs text-slate-400 leading-snug">
              Quét thư mục dự án hoặc Playlist YouTube (Robotics), chuẩn bị ảnh bìa &amp; đường dẫn sản phẩm, nộp SPCK các buổi 12–14 và đẩy Thư tổng kết cuối khóa Buổi 14.
            </p>
          </div>
          <div className="mt-2.5 pt-2 border-t border-slate-800/70 flex items-center justify-end text-xs">
            <span className="font-bold text-emerald-400 group-hover:translate-x-0.5 transition-transform">
              Mở công cụ &rarr;
            </span>
          </div>
        </Link>

        {/* Workspace 4 */}
        <Link
          href="/syllabus-config"
          className="mindx-card-purple group flex flex-col justify-between px-4 py-3 rounded-xl hover:-translate-y-0.5 transition-all"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xl drop-shadow-sm">⚙️</span>
              <span className="mindx-badge-purple text-xs px-3 py-0.5 rounded-full">
                Cấu hình
              </span>
            </div>
            <h3 className="mt-2 text-base font-bold group-hover:text-purple-500 transition-colors">
              4. Quản lý Giáo trình &amp; Bộ Thẻ Nhận xét Nhanh
            </h3>
            <p className="mt-1 text-xs text-slate-400 leading-snug">
              Tùy chỉnh nội dung từng buổi học, đánh dấu buổi Kiểm tra (Checkpoint) và quản lý 3 bộ thẻ nhận xét nhanh (Lập trình, Robotics, Buổi 14).
            </p>
          </div>
          <div className="mt-2.5 pt-2 border-t border-slate-800/70 flex items-center justify-end text-xs">
            <span className="font-bold text-purple-400 group-hover:translate-x-0.5 transition-transform">
              Mở cấu hình &rarr;
            </span>
          </div>
        </Link>
      </div>

      {/* Compact Single-Line Recent Classes & System Bar */}
      <div className="mindx-card mindx-card-blue px-4 py-2 rounded-xl flex flex-col lg:flex-row items-start lg:items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-bold text-white uppercase tracking-wider flex items-center gap-1.5 mr-1">
            <span>🏫 Lớp đồng bộ gần đây ({totalClasses}):</span>
          </span>
          {recentClasses.length > 0 ? (
            recentClasses.map((cls) => (
              <Link
                key={cls.classId}
                href={`/session-comments?classId=${encodeURIComponent(cls.classId)}`}
                title={`${cls.className || cls.classId} (${cls.studentCount} học viên • ${cls.sessionCount} buổi)`}
                className="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/80 text-white font-semibold transition flex items-center gap-1.5"
              >
                <span>{cls.classId}</span>
                <span className="text-[11px] text-slate-400">
                  ({cls.studentCount} HV)
                </span>
              </Link>
            ))
          ) : (
            <span className="text-slate-400">
              Chưa có lớp nào được đồng bộ — hãy mở mục Nhận xét buổi học để đồng bộ lớp từ LMS.
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 shrink-0">
          <span>
            Nhận xét LMS: <strong className="text-white">{verifiedComments}/{totalComments}</strong>
          </span>
          <span>•</span>
          <span>
            Kho chuẩn: <strong className="text-white">{courses.length} khóa • {rubrics.length} barem</strong>
          </span>
        </div>
      </div>
    </div>
  );
}
