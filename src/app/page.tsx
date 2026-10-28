import Link from "next/link";
import { getSafePublicConfig } from "@/lib/config";
import { getCoursesSyllabus, getGradingRubrics } from "@/lib/db/json-config";
import { getDb } from "@/lib/db/sqlite";

export default function DashboardPage() {
  const publicConfig = getSafePublicConfig();
  const courses = getCoursesSyllabus();
  const rubrics = getGradingRubrics();

  let dbReady = true;
  try {
    getDb();
  } catch {
    dbReady = false;
  }

  const isSystemReady = dbReady && publicConfig.hasGeminiKey;

  return (
    <div className="space-y-6">
      {/* Hero Banner */}
      <div className="mindx-hero p-6 rounded-2xl transition-all">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Trợ Lý Giảng Dạy MindX (v3.0)
            </h1>
            <p className="mindx-hero-sub mt-1.5 text-sm">
              Nhận xét buổi học &amp; tổng kết Zalo, chấm bài tập tự động, nộp sản phẩm cuối khóa (SPCK) và quản lý giáo trình.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Workspace 1 */}
        <Link
          href="/session-comments"
          className="mindx-card-amber group block p-6 rounded-xl hover:-translate-y-0.5 transition-all"
        >
          <div className="flex items-center justify-between">
            <span className="text-2xl drop-shadow-sm">📝</span>
            <span className="mindx-badge-amber text-xs px-3 py-0.5 rounded-full">
              Buổi 1 – 13 &amp; Checkpoint
            </span>
          </div>
          <h3 className="mt-4 text-lg font-bold group-hover:text-amber-500 transition-colors">
            1. Nhận xét Buổi học &amp; Thông báo Zalo
          </h3>
          <p className="mt-2 text-sm text-slate-400 leading-relaxed">
            Đồng bộ lớp đang dạy, tích nhanh thẻ Lập trình / Robotics trên 1 hàng gọn, AI soạn nhận xét 3 mục chuẩn (hỗ trợ buổi Checkpoint) và soạn tin nhắn tổng kết Zalo.
          </p>
        </Link>

        {/* Workspace 2 */}
        <Link
          href="/homework-grader"
          className="mindx-card-blue group block p-6 rounded-xl hover:-translate-y-0.5 transition-all"
        >
          <div className="flex items-center justify-between">
            <span className="text-2xl drop-shadow-sm">📊</span>
            <span className="mindx-badge-blue text-xs px-3 py-0.5 rounded-full">
              Bảng điểm &amp; BTVN
            </span>
          </div>
          <h3 className="mt-4 text-lg font-bold group-hover:text-sky-500 transition-colors">
            2. Bảng điểm Báo cáo &amp; Tự chấm Bài tập
          </h3>
          <p className="mt-2 text-sm text-slate-400 leading-relaxed">
            Quét bảng điểm toàn khóa xuất Excel / Google Sheets; tải bài tập về máy, chấm điểm tự động theo Barem kèm bằng chứng và đẩy kết quả lên LMS.
          </p>
        </Link>

        {/* Workspace 3 */}
        <Link
          href="/final-project"
          className="mindx-card-emerald group block p-6 rounded-xl hover:-translate-y-0.5 transition-all"
        >
          <div className="flex items-center justify-between">
            <span className="text-2xl drop-shadow-sm">🚀</span>
            <span className="mindx-badge-emerald text-xs px-3 py-0.5 rounded-full">
              Buổi 12, 13 &amp; 14
            </span>
          </div>
          <h3 className="mt-4 text-lg font-bold group-hover:text-emerald-500 transition-colors">
            3. Nộp Sản phẩm Cuối khóa (SPCK) &amp; Tổng kết Buổi 14
          </h3>
          <p className="mt-2 text-sm text-slate-400 leading-relaxed">
            Quét thư mục dự án hoặc Playlist YouTube (Robotics), chuẩn bị ảnh bìa &amp; đường dẫn sản phẩm, nộp SPCK các buổi 12–14 và đẩy Thư tổng kết cuối khóa Buổi 14.
          </p>
        </Link>

        {/* Workspace 4 */}
        <Link
          href="/syllabus-config"
          className="mindx-card-purple group block p-6 rounded-xl hover:-translate-y-0.5 transition-all"
        >
          <div className="flex items-center justify-between">
            <span className="text-2xl drop-shadow-sm">⚙️</span>
            <span className="mindx-badge-purple text-xs px-3 py-0.5 rounded-full">
              Cấu hình
            </span>
          </div>
          <h3 className="mt-4 text-lg font-bold group-hover:text-purple-500 transition-colors">
            4. Quản lý Giáo trình, Barem &amp; Thẻ Nhận xét
          </h3>
          <p className="mt-2 text-sm text-slate-400 leading-relaxed">
            Tùy chỉnh nội dung từng buổi học, đánh dấu buổi Kiểm tra (Checkpoint), cấu hình barem chấm điểm và quản lý 3 bộ thẻ nhận xét nhanh (Lập trình, Robotics, Buổi 14).
          </p>
        </Link>
      </div>
    </div>
  );
}
