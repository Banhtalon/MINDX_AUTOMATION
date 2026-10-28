"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Tổng quan" },
  { href: "/session-comments", label: "Nhận xét buổi học" },
  { href: "/homework-grader", label: "Chấm bài & Điểm" },
  { href: "/final-project", label: "Upload SPCK" },
  { href: "/syllabus-config", label: "Giáo trình & Barem" },
];

export function TopNavbar() {
  const pathname = usePathname();
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
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

  return (
    <header className="mindx-navbar sticky top-0 z-50 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center space-x-2 group">
          <span className="text-lg sm:text-xl font-bold tracking-tight flex items-center gap-1.5 text-white">
            <span className="text-amber-400">⚡</span>
            <span className="mindx-brand-text">MindX Bot v3.0</span>
          </span>
        </Link>

        <div className="flex items-center space-x-1 sm:space-x-5">
          <nav className="flex items-center space-x-1 sm:space-x-4 text-xs sm:text-sm font-medium">
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : Boolean(pathname?.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`mindx-nav-link px-2.5 py-4 transition-all ${
                    isActive ? "mindx-nav-link-active" : ""
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <button
            type="button"
            onClick={toggleTheme}
            title={
              theme === "light"
                ? "Chuyển sang giao diện Tối (Dark Mode)"
                : "Chuyển sang giao diện Sáng (Light Mode)"
            }
            className="mindx-theme-toggle ml-2 px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
          >
            {theme === "light" ? (
              <>
                <span>☀️</span>
                <span className="hidden md:inline">Sáng</span>
              </>
            ) : (
              <>
                <span>🌙</span>
                <span className="hidden md:inline">Tối</span>
              </>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
