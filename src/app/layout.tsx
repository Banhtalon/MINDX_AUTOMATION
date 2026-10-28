import type { Metadata } from "next";
import Link from "next/link";
import { LiveLogDrawer } from "@/components/live-log-drawer";
import "./globals.css";

export const metadata: Metadata = {
  title: "MindX Automation Bot (v3.0)",
  description: "Hệ thống trợ lý tự động hóa toàn diện dành cho Giáo viên tại MindX",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body className="min-h-screen bg-slate-950 text-slate-100 flex flex-col pb-12">
        {/* Top Navbar */}
        <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <span className="text-xl font-bold bg-gradient-to-r from-orange-400 via-rose-400 to-amber-300 bg-clip-text text-transparent">
                ⚡ MindX Bot v3.0
              </span>
            </div>

            <nav className="flex items-center space-x-1 sm:space-x-3 text-sm">
              <Link
                href="/"
                className="px-3 py-1.5 rounded-md hover:bg-slate-800 hover:text-white text-slate-300 transition-colors"
              >
                Tổng quan
              </Link>
              <Link
                href="/session-comments"
                className="px-3 py-1.5 rounded-md hover:bg-slate-800 hover:text-white text-slate-300 transition-colors"
              >
                Nhận xét buổi học
              </Link>
              <Link
                href="/homework-grader"
                className="px-3 py-1.5 rounded-md hover:bg-slate-800 hover:text-white text-slate-300 transition-colors"
              >
                Chấm bài & Điểm
              </Link>
              <Link
                href="/final-project"
                className="px-3 py-1.5 rounded-md hover:bg-slate-800 hover:text-white text-slate-300 transition-colors"
              >
                Upload SPCK
              </Link>
              <Link
                href="/syllabus-config"
                className="px-3 py-1.5 rounded-md hover:bg-slate-800 hover:text-white text-slate-300 transition-colors"
              >
                Giáo trình & Barem
              </Link>
            </nav>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 mb-6">
          {children}
        </main>

        {/* Live Status & Automation Log Drawer */}
        <LiveLogDrawer />

        {/* Footer */}
        <footer className="border-t border-slate-800 py-3 text-center text-xs text-slate-500 mb-8">
          MindX Automation Bot • Local-Only Application • SQLite & Playwright Engine
        </footer>
      </body>
    </html>
  );
}
