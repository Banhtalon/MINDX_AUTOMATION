import type { Metadata } from "next";
import { LiveLogDrawer } from "@/components/live-log-drawer";
import { TopNavbar } from "@/components/top-navbar";
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
    <html lang="vi" data-theme="light" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("mindx_ui_theme");if(t==="dark"||t==="light"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}`,
          }}
        />
      </head>
      <body className="mindx-body min-h-screen flex flex-col pb-12 transition-colors duration-200">
        {/* Top Navbar */}
        <TopNavbar />

        {/* Main Content Area */}
        <main className="mindx-main flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 mb-4">
          {children}
        </main>

        {/* Live Status & Automation Log Drawer */}
        <LiveLogDrawer />

        {/* Footer */}
        <footer className="mindx-footer py-3 text-center text-xs mb-6">
          MindX Automation Bot • Local-Only Application • SQLite & Playwright Engine
        </footer>
      </body>
    </html>
  );
}
