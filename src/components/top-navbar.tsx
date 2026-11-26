"use client";

import React, { useLayoutEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Tổng quan" },
  { href: "/classroom-manager", label: "⭐ Quản lý Giờ học" },
  { href: "/session-comments", label: "Nhận xét buổi học" },
  { href: "/homework-grader", label: "Phiếu điểm & BTVN" },
  { href: "/final-project", label: "Upload SPCK" },
  { href: "/demo-day", label: "🎤 Thi Demo" },
  { href: "/teaching-projects", label: "Dự án Teaching" },
  { href: "/admin-center", label: "🛡️ Quản lý Cơ sở" },
];

export function TopNavbar() {
  const pathname = usePathname();
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useLayoutEffect(() => {
    try {
      const saved = window.localStorage.getItem("mindx_ui_theme");
      const initial = saved === "dark" || saved === "light" ? saved : "light";
      setTheme(initial);
      document.documentElement.setAttribute("data-theme", initial);
    } catch {
      document.documentElement.setAttribute("data-theme", "light");
    }

    const observer = new MutationObserver(() => {
      const attr = document.documentElement.getAttribute("data-theme");
      if (attr === "dark" || attr === "light") {
        setTheme(attr);
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    try {
      window.localStorage.setItem("mindx_ui_theme", next);
    } catch {
      // ignore storage errors
    }
    document.documentElement.setAttribute("data-theme", next);
  };

  const isSettingsActive = Boolean(pathname?.startsWith("/syllabus-config"));

  return (
    <header className="mindx-navbar sticky top-0 z-50 transition-colors">
      <div className="max-w-[1440px] mx-auto px-3 sm:px-4 2xl:px-6 h-14 flex items-center justify-between gap-2">
        <Link href="/" className="flex items-center space-x-1.5 group shrink-0">
          <span className="text-[14px] 2xl:text-[16px] font-black tracking-tight flex items-center gap-1.5 whitespace-nowrap">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-[#facc15] border-2 border-[#0f172a] shadow-[1.5px_1.5px_0_#0f172a] text-[#0f172a] text-xs">
              ⚡
            </span>
            {/* Version history: upgraded from MindX Bot v3.5.5 -> MindX Bot v3.6.0 -> MindX Bot v3.6.1 -> MindX Bot v3.6.2 -> MindX Bot v3.6.3 -> MindX Bot v3.6.4 -> MindX Bot v3.6.5 -> MindX Bot v3.6.6 -> MindX Bot v3.6.7 -> MindX Bot v3.6.8 -> MindX Bot v3.6.9 -> MindX Bot v3.7.0 -> MindX Bot v3.8.0 -> MindX Bot v3.8.1 -> MindX Bot v3.8.2 -> MindX Bot v3.8.3 -> MindX Bot v3.8.4 -> MindX Bot v3.8.5 -> MindX Bot v3.8.6 -> MindX Bot v3.8.7 -> MindX Bot v3.8.8 -> MindX Bot v3.8.9 -> MindX Bot v3.8.10 -> MindX Bot v3.8.11 -> MindX Bot v3.9.0 */}
            <span className="mindx-brand-text whitespace-nowrap">MindX Bot v3.9.0</span>
          </span>
        </Link>

        <div className="flex items-center space-x-1 2xl:space-x-2 shrink-0">
          <nav className="flex items-center space-x-0.5 xl:space-x-1 2xl:space-x-1.5 text-[11.5px] xl:text-xs 2xl:text-[13px] font-bold">
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : Boolean(pathname?.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`mindx-nav-link px-1.5 xl:px-2 2xl:px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-all ${
                    isActive ? "mindx-nav-link-active" : ""
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-1.5 ml-1 shrink-0">
            <Link
              href="/syllabus-config"
              title="Cài đặt Giáo trình & Bộ Thẻ Nhận Xét Nhanh"
              className={`mindx-theme-toggle px-2 2xl:px-2.5 py-1 rounded-lg text-xs font-extrabold flex items-center gap-1 whitespace-nowrap transition-all cursor-pointer ${
                isSettingsActive ? "mindx-nav-link-active" : ""
              }`}
            >
              <span>⚙</span>
              <span className="hidden 2xl:inline">Cài đặt</span>
            </Link>

            <button
              type="button"
              onClick={toggleTheme}
              title={
                theme === "light"
                  ? "Chuyển sang giao diện Tối (Dark Mode)"
                  : "Chuyển sang giao diện Sáng (Light Mode)"
              }
              className="mindx-theme-toggle px-2 2xl:px-2.5 py-1 rounded-lg text-xs font-extrabold flex items-center gap-1 whitespace-nowrap transition-all cursor-pointer"
            >
              {theme === "light" ? (
                <>
                  <span>☀️</span>
                  <span className="hidden 2xl:inline">Sáng</span>
                </>
              ) : (
                <>
                  <span>🌙</span>
                  <span className="hidden 2xl:inline">Tối</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
