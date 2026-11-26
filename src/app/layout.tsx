import type { Metadata } from "next";
import Script from "next/script";
import { LiveLogDrawer } from "@/components/live-log-drawer";
import { TopNavbar } from "@/components/top-navbar";
import "./globals.css";

export const metadata: Metadata = {
  title: "MindX Automation Bot (v3.9.0)",
  description: "Hệ thống trợ lý tự động hóa toàn diện dành cho Giáo viên tại MindX",
};

const THEME_INIT_SNIPPET = `try{var t=localStorage.getItem("mindx_ui_theme");if(t==="dark"||t==="light"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi" data-theme="light" suppressHydrationWarning>
      <body className="mindx-body min-h-screen flex flex-col transition-colors duration-200">
        <Script id="mindx-theme-init" strategy="afterInteractive">
          {THEME_INIT_SNIPPET}
        </Script>

        {/* Top Navbar */}
        <TopNavbar />

        {/* Main Content Area */}
        <main className="mindx-main flex-1 flex flex-col max-w-[1440px] w-full mx-auto px-4 sm:px-6 lg:px-8 pt-2 pb-14">
          {children}
        </main>

        {/* Live Status & Automation Log Drawer */}
        <LiveLogDrawer />

        {/* Footer */}
        <footer className="mindx-footer py-2 text-center text-xs font-semibold">
          MindX Automation Bot v3.9.0 • Local Workspace (127.0.0.1)
        </footer>
      </body>
    </html>
  );
}
