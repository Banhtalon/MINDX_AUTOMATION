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
      {/* Compact Welcome & Single Status Line */}
      <div className="p-6 rounded-xl bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 border border-slate-800 shadow-xl">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              Trợ Lý Giảng Dạy MindX (v3.0)
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Nhận xét buổi học &amp; tổng kết Zalo, chấm bài tập tự động, nộp sản phẩm cuối khóa (SPCK) và quản lý giáo trình.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-full text-xs font-semibold border ${
                isSystemReady
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                  : "bg-amber-500/10 border-amber-500/30 text-amber-300"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isSystemReady ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
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
      <div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Workspace 1 */}
          <Link
            href="/session-comments"
            className="group block p-6 rounded-xl bg-slate-900 border border-slate-800 hover:border-orange-500/50 hover:bg-slate-850 transition-all shadow-lg"
          >
            <div className="flex items-center justify-between">
              <span className="text-2xl">📝</span>
              <span className="text-xs font-semibold text-orange-300 bg-orange-950/40 border border-orange-800/60 px-2.5 py-0.5 rounded-full">
                Buổi 1 – 13 &amp; Checkpoint
              </span>
            </div>
            <h3 className="mt-4 text-lg font-bold text-white group-hover:text-orange-400 transition-colors">
              1. Nhận xét Buổi học &amp; Thông báo Zalo
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              Đồng bộ lớp đang dạy, tích nhanh thẻ Lập trình / Robotics trên 1 hàng gọn, AI soạn nhận xét 3 mục chuẩn (hỗ trợ buổi Checkpoint) và soạn tin nhắn tổng kết Zalo.
            </p>
          </Link>

          {/* Workspace 2 */}
          <Link
            href="/homework-grader"
            className="group block p-6 rounded-xl bg-slate-900 border border-slate-800 hover:border-cyan-500/50 hover:bg-slate-850 transition-all shadow-lg"
          >
            <div className="flex items-center justify-between">
              <span className="text-2xl">📊</span>
              <span className="text-xs font-semibold text-cyan-300 bg-cyan-950/40 border border-cyan-800/60 px-2.5 py-0.5 rounded-full">
                Bảng điểm &amp; BTVN
              </span>
            </div>
            <h3 className="mt-4 text-lg font-bold text-white group-hover:text-cyan-400 transition-colors">
              2. Bảng điểm Báo cáo &amp; Tự chấm Bài tập
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              Quét bảng điểm toàn khóa xuất Excel / Google Sheets; tải bài tập về máy, chấm điểm tự động theo Barem kèm bằng chứng và đẩy kết quả lên LMS.
            </p>
          </Link>

          {/* Workspace 3 */}
          <Link
            href="/final-project"
            className="group block p-6 rounded-xl bg-slate-900 border border-slate-800 hover:border-emerald-500/50 hover:bg-slate-850 transition-all shadow-lg"
          >
            <div className="flex items-center justify-between">
              <span className="text-2xl">🚀</span>
              <span className="text-xs font-semibold text-emerald-300 bg-emerald-950/40 border border-emerald-800/60 px-2.5 py-0.5 rounded-full">
                Buổi 12, 13 &amp; 14
              </span>
            </div>
            <h3 className="mt-4 text-lg font-bold text-white group-hover:text-emerald-400 transition-colors">
              3. Nộp Sản phẩm Cuối khóa (SPCK) &amp; Tổng kết Buổi 14
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              Quét thư mục dự án hoặc Playlist YouTube (Robotics), chuẩn bị ảnh bìa &amp; đường dẫn sản phẩm, nộp SPCK các buổi 12–14 và đẩy Thư tổng kết cuối khóa Buổi 14.
            </p>
          </Link>

          {/* Workspace 4 */}
          <Link
            href="/syllabus-config"
            className="group block p-6 rounded-xl bg-slate-900 border border-slate-800 hover:border-purple-500/50 hover:bg-slate-850 transition-all shadow-lg"
          >
            <div className="flex items-center justify-between">
              <span className="text-2xl">⚙️</span>
              <span className="text-xs font-semibold text-purple-300 bg-purple-950/40 border border-purple-800/60 px-2.5 py-0.5 rounded-full">
                Cấu hình
              </span>
            </div>
            <h3 className="mt-4 text-lg font-bold text-white group-hover:text-purple-400 transition-colors">
              4. Quản lý Giáo trình, Barem &amp; Thẻ Nhận xét
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              Tùy chỉnh nội dung từng buổi học, đánh dấu buổi Kiểm tra (Checkpoint), cấu hình barem chấm điểm và quản lý 3 bộ thẻ nhận xét nhanh (Lập trình, Robotics, Buổi 14).
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}
