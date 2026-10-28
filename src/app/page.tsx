import Link from "next/link";
import { getSafePublicConfig } from "@/lib/config";
import { getCoursesSyllabus, getGradingRubrics } from "@/lib/db/json-config";
import { getDb } from "@/lib/db/sqlite";

interface RecentClassItem {
  classId: string;
  className: string;
  sessionCount: number;
  studentCount: number;
  updatedAt: string;
}

export default function DashboardPage() {
  const publicConfig = getSafePublicConfig();
  const courses = getCoursesSyllabus();
  const rubrics = getGradingRubrics();

  let dbReady = true;
  let totalClasses = 0;
  let totalStudents = 0;
  let totalComments = 0;
  let verifiedComments = 0;
  let totalSubmissions = 0;
  let recentClasses: RecentClassItem[] = [];

  try {
    const db = getDb();
    totalClasses =
      (
        db
          .prepare(`SELECT COUNT(DISTINCT classId) as cnt FROM classes_sessions`)
          .get() as { cnt?: number } | undefined
      )?.cnt ?? 0;
    totalStudents =
      (
        db
          .prepare(`SELECT COUNT(*) as cnt FROM students WHERE isActive = 1`)
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
    totalSubmissions =
      (
        db
          .prepare(`SELECT COUNT(*) as cnt FROM homework_submissions`)
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
  } catch {
    dbReady = false;
  }

  const isSystemReady = dbReady && publicConfig.hasGeminiKey;

  return (
    <div className="flex-1 flex flex-col justify-between gap-4">
      {/* Hero Banner */}
      <div className="mindx-hero p-5 sm:p-6 rounded-2xl transition-all">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              Trợ Lý Giảng Dạy MindX (v3.0)
            </h1>
            <p className="mindx-hero-sub mt-1.5 text-sm">
              Nhận xét buổi học &amp; tổng kết Zalo, chấm bài tập tự động, nộp sản phẩm cuối khóa (SPCK) và quản lý giáo trình.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="mindx-dark-keep px-3.5 py-1.5 rounded-full text-xs font-semibold bg-white/15 border border-white/25 text-white">
              🏫 {totalClasses} lớp • 👥 {totalStudents} học viên
            </span>
            <div
              className={`flex items-center space-x-2 px-4 py-1.5 rounded-full text-xs font-semibold ${
                isSystemReady
                  ? "mindx-status-pill-ok"
                  : "bg-amber-500/20 border border-amber-400/50 text-amber-200"
              }`}
            >
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  isSystemReady ? "bg-emerald-500 animate-pulse" : "bg-amber-400"
                }`}
              />
              <span>
                {isSystemReady
                  ? `Sẵn sàng (${courses.length} khóa học • ${rubrics.length} barem)`
                  : !publicConfig.hasGeminiKey
                  ? "Thiếu khóa AI (GEMINI_API_KEY)"
                  : "Đang kiểm tra dữ liệu"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 4 Core Workspaces Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
        {/* Workspace 1 */}
        <Link
          href="/session-comments"
          className="mindx-card-amber group flex flex-col justify-between p-5 sm:p-6 rounded-xl hover:-translate-y-0.5 transition-all"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-2xl drop-shadow-sm">📝</span>
              <span className="mindx-badge-amber text-xs px-3 py-0.5 rounded-full">
                Buổi 1 – 13 &amp; Checkpoint
              </span>
            </div>
            <h3 className="mt-3.5 text-lg font-bold group-hover:text-amber-500 transition-colors">
              1. Nhận xét Buổi học &amp; Thông báo Zalo
            </h3>
            <p className="mt-2 text-sm text-slate-400 leading-relaxed">
              Đồng bộ lớp đang dạy, tích nhanh thẻ Lập trình / Robotics trên 1 hàng gọn, AI soạn nhận xét 3 mục chuẩn (hỗ trợ buổi Checkpoint) và soạn tin nhắn tổng kết Zalo.
            </p>
            <div className="mt-3.5 flex flex-wrap gap-1.5 text-[11px] text-slate-300">
              <span className="px-2.5 py-0.5 rounded-md bg-slate-800/80 border border-slate-700/70">
                ⚡ Quick Tags 1 chạm
              </span>
              <span className="px-2.5 py-0.5 rounded-md bg-slate-800/80 border border-slate-700/70">
                🎯 Buổi Kiểm tra (5 &amp; 9 / 4 &amp; 8)
              </span>
              <span className="px-2.5 py-0.5 rounded-md bg-slate-800/80 border border-slate-700/70">
                💬 Thông báo Zalo 2 phần
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-800/70 flex items-center justify-between text-xs">
            <span className="text-slate-400">
              Đã soạn: <strong className="text-white">{totalComments}</strong> nhận xét ({verifiedComments} đã lưu LMS)
            </span>
            <span className="font-bold text-amber-400 group-hover:translate-x-0.5 transition-transform">
              Mở công cụ &rarr;
            </span>
          </div>
        </Link>

        {/* Workspace 2 */}
        <Link
          href="/homework-grader"
          className="mindx-card-blue group flex flex-col justify-between p-5 sm:p-6 rounded-xl hover:-translate-y-0.5 transition-all"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-2xl drop-shadow-sm">📊</span>
              <span className="mindx-badge-blue text-xs px-3 py-0.5 rounded-full">
                Bảng điểm &amp; BTVN
              </span>
            </div>
            <h3 className="mt-3.5 text-lg font-bold group-hover:text-sky-500 transition-colors">
              2. Bảng điểm Báo cáo &amp; Tự chấm Bài tập
            </h3>
            <p className="mt-2 text-sm text-slate-400 leading-relaxed">
              Quét bảng điểm toàn khóa xuất Excel / Google Sheets; tải bài tập về máy, chấm điểm tự động theo Barem kèm bằng chứng và đẩy kết quả lên LMS.
            </p>
            <div className="mt-3.5 flex flex-wrap gap-1.5 text-[11px] text-slate-300">
              <span className="px-2.5 py-0.5 rounded-md bg-slate-800/80 border border-slate-700/70">
                📥 Xuất Excel &amp; Google Sheets
              </span>
              <span className="px-2.5 py-0.5 rounded-md bg-slate-800/80 border border-slate-700/70">
                🤖 Chấm BTVN theo Barem
              </span>
              <span className="px-2.5 py-0.5 rounded-md bg-slate-800/80 border border-slate-700/70">
                🔍 Đính kèm bằng chứng code
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-800/70 flex items-center justify-between text-xs">
            <span className="text-slate-400">
              Bài nộp đã tải: <strong className="text-white">{totalSubmissions}</strong> bài • <strong className="text-white">{rubrics.length}</strong> barem
            </span>
            <span className="font-bold text-sky-400 group-hover:translate-x-0.5 transition-transform">
              Mở công cụ &rarr;
            </span>
          </div>
        </Link>

        {/* Workspace 3 */}
        <Link
          href="/final-project"
          className="mindx-card-emerald group flex flex-col justify-between p-5 sm:p-6 rounded-xl hover:-translate-y-0.5 transition-all"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-2xl drop-shadow-sm">🚀</span>
              <span className="mindx-badge-emerald text-xs px-3 py-0.5 rounded-full">
                Buổi 12, 13 &amp; 14
              </span>
            </div>
            <h3 className="mt-3.5 text-lg font-bold group-hover:text-emerald-500 transition-colors">
              3. Nộp Sản phẩm Cuối khóa (SPCK) &amp; Tổng kết Buổi 14
            </h3>
            <p className="mt-2 text-sm text-slate-400 leading-relaxed">
              Quét thư mục dự án hoặc Playlist YouTube (Robotics), chuẩn bị ảnh bìa &amp; đường dẫn sản phẩm, nộp SPCK các buổi 12–14 và đẩy Thư tổng kết cuối khóa Buổi 14.
            </p>
            <div className="mt-3.5 flex flex-wrap gap-1.5 text-[11px] text-slate-300">
              <span className="px-2.5 py-0.5 rounded-md bg-slate-800/80 border border-slate-700/70">
                📸 Tự chụp giao diện App / Web
              </span>
              <span className="px-2.5 py-0.5 rounded-md bg-slate-800/80 border border-slate-700/70">
                📊 Đọc Điểm Demo từ Excel
              </span>
              <span className="px-2.5 py-0.5 rounded-md bg-slate-800/80 border border-slate-700/70">
                💌 Thư từ MindX 3 phần
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-800/70 flex items-center justify-between text-xs">
            <span className="text-slate-400">
              Hỗ trợ: <strong className="text-white">Buổi 12 (GĐ1) • Buổi 13 (GĐ2) • Buổi 14 (CK)</strong>
            </span>
            <span className="font-bold text-emerald-400 group-hover:translate-x-0.5 transition-transform">
              Mở công cụ &rarr;
            </span>
          </div>
        </Link>

        {/* Workspace 4 */}
        <Link
          href="/syllabus-config"
          className="mindx-card-purple group flex flex-col justify-between p-5 sm:p-6 rounded-xl hover:-translate-y-0.5 transition-all"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-2xl drop-shadow-sm">⚙️</span>
              <span className="mindx-badge-purple text-xs px-3 py-0.5 rounded-full">
                Cấu hình
              </span>
            </div>
            <h3 className="mt-3.5 text-lg font-bold group-hover:text-purple-500 transition-colors">
              4. Quản lý Giáo trình, Barem &amp; Thẻ Nhận xét
            </h3>
            <p className="mt-2 text-sm text-slate-400 leading-relaxed">
              Tùy chỉnh nội dung từng buổi học, đánh dấu buổi Kiểm tra (Checkpoint), cấu hình barem chấm điểm và quản lý 3 bộ thẻ nhận xét nhanh (Lập trình, Robotics, Buổi 14).
            </p>
            <div className="mt-3.5 flex flex-wrap gap-1.5 text-[11px] text-slate-300">
              <span className="px-2.5 py-0.5 rounded-md bg-slate-800/80 border border-slate-700/70">
                📚 {courses.length} Khóa học chuẩn
              </span>
              <span className="px-2.5 py-0.5 rounded-md bg-slate-800/80 border border-slate-700/70">
                📋 {rubrics.length} Barem chấm bài
              </span>
              <span className="px-2.5 py-0.5 rounded-md bg-slate-800/80 border border-slate-700/70">
                🏷️ 3 Bộ thẻ Quick Tags
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-800/70 flex items-center justify-between text-xs">
            <span className="text-slate-400">
              Đang kích hoạt: <strong className="text-white">{courses.length} giáo trình • {rubrics.length} barem</strong>
            </span>
            <span className="font-bold text-purple-400 group-hover:translate-x-0.5 transition-transform">
              Mở cấu hình &rarr;
            </span>
          </div>
        </Link>
      </div>

      {/* Compact Single-Line Recent Classes & System Bar */}
      <div className="mindx-card mindx-card-blue px-5 py-3.5 rounded-xl flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-bold text-white uppercase tracking-wider flex items-center gap-1.5 mr-1">
            <span>🏫 Lớp đồng bộ gần đây ({totalClasses}):</span>
          </span>
          {recentClasses.length > 0 ? (
            recentClasses.map((cls) => (
              <Link
                key={cls.classId}
                href="/session-comments"
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
