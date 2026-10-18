import Link from "next/link";
import { getSafePublicConfig } from "@/lib/config";
import { getCoursesSyllabus, getGradingRubrics, getQuickTags, getZaloTemplates } from "@/lib/db/json-config";
import { getDb } from "@/lib/db/sqlite";

export default function DashboardPage() {
  const publicConfig = getSafePublicConfig();
  const courses = getCoursesSyllabus();
  const rubrics = getGradingRubrics();
  const tags = getQuickTags();
  const templates = getZaloTemplates();

  // Test SQLite connection
  let dbStatus = "Hoạt động";
  try {
    getDb();
  } catch (err) {
    dbStatus = `Lỗi: ${err instanceof Error ? err.message : String(err)}`;
  }

  return (
    <div className="space-y-8">
      {/* Welcome Banner */}
      <div className="p-6 rounded-xl bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 border border-slate-800 shadow-xl">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              Bảng Điều Khiển Tự Động Hóa MindX
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Hệ thống trợ lý tối ưu quy trình sau buổi học, tự động chấm bài và upload sản phẩm cuối khóa.
            </p>
          </div>
          <div className="flex items-center space-x-2 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 rounded-full text-emerald-400 text-xs font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Hệ thống Cục bộ Sẵn sàng</span>
          </div>
        </div>
      </div>

      {/* System Status Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-lg bg-slate-900 border border-slate-800">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">Cơ sở dữ liệu SQLite</div>
          <div className="mt-2 text-lg font-bold text-white flex items-center justify-between">
            <span>mindx_bot.db</span>
            <span className="text-xs font-normal text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">
              {dbStatus}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500">WAL Mode • Lưu vết Task & Nháp</div>
        </div>

        <div className="p-4 rounded-lg bg-slate-900 border border-slate-800">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">Trí tuệ nhân tạo AI</div>
          <div className="mt-2 text-lg font-bold text-white flex items-center justify-between">
            <span>{publicConfig.geminiModel}</span>
            <span className={`text-xs font-normal px-2 py-0.5 rounded border ${
              publicConfig.hasGeminiKey
                ? "text-emerald-400 bg-emerald-950/60 border-emerald-800"
                : "text-amber-400 bg-amber-950/60 border-amber-800"
            }`}>
              {publicConfig.hasGeminiKey ? "Đã có API Key" : "Chưa có Key"}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500">Structured Outputs & Evidence</div>
        </div>

        <div className="p-4 rounded-lg bg-slate-900 border border-slate-800">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">Kho Giáo Trình & Barem</div>
          <div className="mt-2 text-lg font-bold text-white">
            {courses.length} Khóa học • {rubrics.length} Barem
          </div>
          <div className="mt-1 text-xs text-slate-500">PTA, PTB, JSB, SB, GB, ROB, CSI</div>
        </div>

        <div className="p-4 rounded-lg bg-slate-900 border border-slate-800">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">Tài khoản & Trình duyệt</div>
          <div className="mt-2 text-lg font-bold text-white truncate">
            {publicConfig.usernameMasked || "Chưa cấu hình .env.local"}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {publicConfig.headlessMode ? "Headless Mode" : "Hiển thị giao diện Chrome"}
          </div>
        </div>
      </div>

      {/* 4 Core Workspaces Grid */}
      <div>
        <h2 className="text-lg font-bold text-slate-200 mb-4">Các Không Gian Làm Việc Chính (4 Workspaces)</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Workspace 1 */}
          <Link
            href="/session-comments"
            className="group block p-6 rounded-xl bg-slate-900 border border-slate-800 hover:border-orange-500/50 hover:bg-slate-850 transition-all shadow-lg"
          >
            <div className="flex items-center justify-between">
              <span className="text-2xl">📝</span>
              <span className="text-xs font-semibold text-orange-400 bg-orange-950/40 border border-orange-800 px-2 py-0.5 rounded">
                Giai đoạn 3
              </span>
            </div>
            <h3 className="mt-4 text-lg font-bold text-white group-hover:text-orange-400 transition-colors">
              Màn hình 1: Nhận xét Buổi học & Thông báo Zalo
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              Đồng bộ lịch dạy Teaching, cào học viên LMS, đánh giá bằng Quick Tags 1 chạm, AI soạn nhận xét 3 phần và lưu đối chiếu LMS + copy Zalo.
            </p>
          </Link>

          {/* Workspace 2 */}
          <Link
            href="/homework-grader"
            className="group block p-6 rounded-xl bg-slate-900 border border-slate-800 hover:border-cyan-500/50 hover:bg-slate-850 transition-all shadow-lg"
          >
            <div className="flex items-center justify-between">
              <span className="text-2xl">📊</span>
              <span className="text-xs font-semibold text-cyan-400 bg-cyan-950/40 border border-cyan-800 px-2 py-0.5 rounded">
                Giai đoạn 4 & 5
              </span>
            </div>
            <h3 className="mt-4 text-lg font-bold text-white group-hover:text-cyan-400 transition-colors">
              Màn hình 2: Bảng điểm Báo cáo & Tự chấm Bài tập
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              Quét toàn bộ điểm lớp xuất Excel/Google Sheets; tải bài tập kèm ID, đọc mã nguồn đa môn (Python, Web, Game, Scratch), AI đề xuất điểm kèm bằng chứng và lưu LMS.
            </p>
          </Link>

          {/* Workspace 3 */}
          <Link
            href="/final-project"
            className="group block p-6 rounded-xl bg-slate-900 border border-slate-800 hover:border-emerald-500/50 hover:bg-slate-850 transition-all shadow-lg"
          >
            <div className="flex items-center justify-between">
              <span className="text-2xl">🚀</span>
              <span className="text-xs font-semibold text-emerald-400 bg-emerald-950/40 border border-emerald-800 px-2 py-0.5 rounded">
                Giai đoạn 6
              </span>
            </div>
            <h3 className="mt-4 text-lg font-bold text-white group-hover:text-emerald-400 transition-colors">
              Màn hình 3: Tự động Upload Sản phẩm Cuối khóa (SPCK)
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              Quét thư mục dự án trên ổ cứng, bảng ghép nối studentId an toàn, kiểm tra chống trùng, upload toàn bộ ảnh thumbnail, file, link và nhận xét cuối khóa lên LMS.
            </p>
          </Link>

          {/* Workspace 4 */}
          <Link
            href="/syllabus-config"
            className="group block p-6 rounded-xl bg-slate-900 border border-slate-800 hover:border-purple-500/50 hover:bg-slate-850 transition-all shadow-lg"
          >
            <div className="flex items-center justify-between">
              <span className="text-2xl">⚙️</span>
              <span className="text-xs font-semibold text-purple-400 bg-purple-950/40 border border-purple-800 px-2 py-0.5 rounded">
                Giai đoạn 7
              </span>
            </div>
            <h3 className="mt-4 text-lg font-bold text-white group-hover:text-purple-400 transition-colors">
              Màn hình 4: Quản lý Giáo trình, Barem & Mẫu Zalo
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              Tùy chỉnh trực tiếp nội dung từng buổi học, cấu hình câu hỏi và barem điểm chấm bài, tinh chỉnh bộ thẻ Quick Tags và mẫu gửi thông báo Zalo.
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}
