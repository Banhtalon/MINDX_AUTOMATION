"use client";

import React, { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

export const LAST_SELECTED_CLASS_STORAGE_KEY = "mindx_last_class_code";

export type ClassPickerScope = "running" | "spck" | "all";

export interface ClassPickerOption {
  classId?: string;
  classCode?: string;
  className?: string;
  courseName?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  session14Date?: string;
  currentSessionNumber?: number;
  maxSessionNumber?: number;
}

export function normalizeClassOption(
  raw: string | ClassPickerOption
): ClassPickerOption & { code: string } {
  if (typeof raw === "string") {
    const code = raw.trim().toUpperCase();
    return {
      code,
      classId: code,
      classCode: code,
      className: code,
    };
  }
  const code = String(raw?.classCode || raw?.classId || "")
    .trim()
    .toUpperCase();
  return {
    ...raw,
    code,
    classId: code,
    classCode: code,
    className: raw?.className || raw?.courseName || code,
  };
}

export function readSavedClassCode(): string {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return String(
        window.localStorage.getItem(LAST_SELECTED_CLASS_STORAGE_KEY) || ""
      )
        .trim()
        .toUpperCase();
    }
  } catch {
    // Ignore storage read errors in restricted environments
  }
  return "";
}

export function writeSavedClassCode(classCode: string): void {
  const normalized = String(classCode || "").trim().toUpperCase();
  if (!normalized) return;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(LAST_SELECTED_CLASS_STORAGE_KEY, normalized);
    }
  } catch {
    // Ignore storage write errors
  }
}

export function resolvePreferredClassCode(
  classes: Array<string | ClassPickerOption>,
  explicitClassCode?: string,
  fallbackClassCode?: string
): string {
  const normalizedList = (classes || [])
    .map(normalizeClassOption)
    .filter((c) => Boolean(c.code));

  const explicit = String(explicitClassCode || "").trim().toUpperCase();
  if (explicit && normalizedList.some((c) => c.code === explicit)) {
    return explicit;
  }

  const saved = readSavedClassCode();
  if (saved && normalizedList.some((c) => c.code === saved)) {
    return saved;
  }

  const fallback = String(fallbackClassCode || "").trim().toUpperCase();
  if (fallback && normalizedList.some((c) => c.code === fallback)) {
    return fallback;
  }

  if (normalizedList.length > 0) {
    return normalizedList[0].code;
  }

  return explicit || saved || fallback || "";
}

export async function refreshClassesFromLms(options?: {
  scope?: ClassPickerScope;
  classCode?: string;
  forceResyncAll?: boolean;
}): Promise<{
  success: boolean;
  classes: ClassPickerOption[];
  runningClasses: ClassPickerOption[];
  spckClasses: ClassPickerOption[];
  allClasses: ClassPickerOption[];
  syncedClassCode?: string | null;
  syncedClassCodes?: string[];
  error?: string;
}> {
  const scope = options?.scope ?? "running";
  const classCode = String(options?.classCode || "").trim().toUpperCase();
  const res = await fetch("/api/classes/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scope,
      ...(classCode ? { classCode } : {}),
      ...(options?.forceResyncAll ? { forceResyncAll: true } : {}),
    }),
  });
  const data = await res.json();
  return {
    success: Boolean(data?.success),
    classes: Array.isArray(data?.classes) ? data.classes : [],
    runningClasses: Array.isArray(data?.runningClasses)
      ? data.runningClasses
      : [],
    spckClasses: Array.isArray(data?.spckClasses) ? data.spckClasses : [],
    allClasses: Array.isArray(data?.allClasses) ? data.allClasses : [],
    syncedClassCode: data?.syncedClassCode ?? null,
    syncedClassCodes: Array.isArray(data?.syncedClassCodes)
      ? data.syncedClassCodes
      : [],
    error: data?.error,
  };
}

export interface ClassPickerProps {
  scope?: ClassPickerScope;
  value: string;
  classes: Array<string | ClassPickerOption>;
  onChange: (classCode: string) => void;
  onRefresh?: () => void | Promise<void>;
  onClassesRefreshed?: (
    classes: ClassPickerOption[],
    rawResponse: Awaited<ReturnType<typeof refreshClassesFromLms>>
  ) => void;
  onRefreshError?: (errorMessage: string) => void;
  autoRestore?: boolean;
  isRefreshing?: boolean;
  disabled?: boolean;
  allowManualInput?: boolean;
  refreshLabel?: string;
  refreshingLabel?: string;
  placeholderOption?: string;
  lastSyncedAt?: string | null;
  variant?: "hero" | "card";
  showRefreshButton?: boolean;
  className?: string;
}

export function ClassPicker({
  scope = "running",
  value,
  classes,
  onChange,
  onRefresh,
  onClassesRefreshed,
  onRefreshError,
  autoRestore = true,
  isRefreshing = false,
  disabled = false,
  allowManualInput,
  refreshLabel = "🔄 Quét lại từ LMS",
  refreshingLabel = "Đang quét LMS...",
  placeholderOption,
  lastSyncedAt,
  variant = "hero",
  showRefreshButton = true,
  className = "",
}: ClassPickerProps) {
  const [internalRefreshing, setInternalRefreshing] = useState(false);
  const [isManualMode, setIsManualMode] = useState(false);
  const [manualDraft, setManualDraft] = useState(value || "");
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const didTryInitialRestoreRef = useRef(false);

  const normalizedOptions = React.useMemo(() => {
    const seen = new Set<string>();
    const list: Array<ClassPickerOption & { code: string }> = [];
    for (const item of classes || []) {
      const norm = normalizeClassOption(item);
      if (!norm.code || seen.has(norm.code)) continue;
      if (
        scope === "spck" &&
        typeof norm.currentSessionNumber === "number" &&
        norm.currentSessionNumber > 0 &&
        norm.currentSessionNumber < 12
      ) {
        continue;
      }
      seen.add(norm.code);
      list.push(norm);
    }
    return list;
  }, [classes, scope]);

  const currentCode = String(value || "").trim().toUpperCase();
  const canManual = allowManualInput ?? scope !== "spck";
  const effectiveBusy = Boolean(disabled || isRefreshing || internalRefreshing);

  useEffect(() => {
    if (currentCode) {
      setManualDraft(currentCode);
    }
  }, [currentCode]);

  useEffect(() => {
    if (!autoRestore) return;
    if (didTryInitialRestoreRef.current) return;
    if (normalizedOptions.length === 0) return;
    didTryInitialRestoreRef.current = true;
    const saved = readSavedClassCode();
    if (
      saved &&
      saved !== currentCode &&
      normalizedOptions.some((c) => c.code === saved)
    ) {
      onChange(saved);
    }
  }, [autoRestore, normalizedOptions, currentCode, onChange]);

  const handleSelectChange = (rawVal: string) => {
    setRefreshError(null);
    if (rawVal === "__REFRESH_LMS__") {
      if (effectiveBusy) return;
      void handleTriggerRefresh();
      return;
    }
    if (rawVal === "__MANUAL_INPUT__") {
      if (effectiveBusy) return;
      setManualDraft(currentCode);
      setIsManualMode(true);
      return;
    }
    if (internalRefreshing || isRefreshing) return;
    const clean = String(rawVal || "").trim().toUpperCase();
    if (!clean) return;
    writeSavedClassCode(clean);
    onChange(clean);
  };

  const handleCommitManual = () => {
    if (effectiveBusy) return;
    const clean = String(manualDraft || "").trim().toUpperCase();
    setIsManualMode(false);
    setRefreshError(null);
    if (!clean) return;
    writeSavedClassCode(clean);
    onChange(clean);
  };

  const handleTriggerRefresh = async () => {
    if (effectiveBusy) return;
    setRefreshError(null);
    if (onRefresh) {
      await onRefresh();
      return;
    }
    setInternalRefreshing(true);
    try {
      const result = await refreshClassesFromLms({
        scope,
        classCode: currentCode || undefined,
      });
      if (result.success) {
        onClassesRefreshed?.(result.classes, result);
        if (result.classes.length > 0) {
          const preferred = resolvePreferredClassCode(
            result.classes,
            currentCode
          );
          if (preferred && preferred !== currentCode) {
            writeSavedClassCode(preferred);
            onChange(preferred);
          }
        }
      } else {
        const errMsg =
          result.error || "Không thể quét danh sách lớp từ MindX LMS.";
        setRefreshError(errMsg);
        onRefreshError?.(errMsg);
      }
    } catch (err: any) {
      const errMsg =
        err instanceof Error
          ? err.message
          : "Lỗi kết nối khi quét danh sách lớp từ LMS.";
      setRefreshError(errMsg);
      onRefreshError?.(errMsg);
    } finally {
      setInternalRefreshing(false);
    }
  };

  const formatOptionLabel = (opt: ClassPickerOption & { code: string }) => {
    if (scope === "spck") {
      if (opt.status === "Finished") {
        return `${opt.code} — Đã xong Buổi 14${
          opt.session14Date ? ` (${opt.session14Date})` : " (≤ 15 ngày)"
        }`;
      }
      if (opt.currentSessionNumber) {
        return `${opt.code} — Đang ở Buổi ${opt.currentSessionNumber}`;
      }
      return opt.className && opt.className !== opt.code
        ? `${opt.code} (${opt.className})`
        : opt.code;
    }

    if (opt.courseName && opt.courseName !== opt.code) {
      return `🟢 ${opt.code} — ${opt.courseName}`;
    }
    if (opt.startDate && opt.endDate) {
      return `${opt.code} (${opt.startDate} → ${opt.endDate})`;
    }
    return `🟢 ${opt.code}`;
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <div
        className={
          variant === "hero"
            ? "flex items-center bg-white/95 dark:bg-slate-900/90 rounded-xl px-3 py-1.5 border border-white/40 dark:border-slate-700 shadow-sm gap-2"
            : "flex items-center w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 gap-2"
        }
      >
        {variant === "hero" && (
          <span className="text-xs font-bold text-slate-600 dark:text-slate-300 shrink-0">
            Lớp:
          </span>
        )}
        {!isManualMode ? (
          <select
            value={currentCode}
            disabled={effectiveBusy}
            onChange={(e) => handleSelectChange(e.target.value)}
            className={
              variant === "hero"
                ? "bg-transparent text-sm font-extrabold text-slate-900 dark:text-white focus:outline-none min-w-[180px] max-w-[320px] cursor-pointer disabled:opacity-60"
                : "w-full bg-transparent text-sm font-semibold text-white focus:outline-none cursor-pointer disabled:opacity-60"
            }
          >
            {placeholderOption && (
              <option value="" className="bg-slate-900 text-slate-300">
                {placeholderOption}
              </option>
            )}
            {currentCode &&
              !normalizedOptions.some((c) => c.code === currentCode) && (
                <option value={currentCode} className="bg-slate-900 text-white">
                  🟢 {currentCode}
                </option>
              )}
            {normalizedOptions.map((opt) => (
              <option
                key={opt.code}
                value={opt.code}
                className="bg-slate-900 text-white"
              >
                {formatOptionLabel(opt)}
              </option>
            ))}
            <option
              value="__REFRESH_LMS__"
              className="bg-slate-950 text-cyan-300"
            >
              📥 Quét lại danh sách lớp từ LMS...
            </option>
            {canManual && (
              <option
                value="__MANUAL_INPUT__"
                className="bg-slate-950 text-amber-300"
              >
                ✏️ Nhập mã lớp khác...
              </option>
            )}
          </select>
        ) : (
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={manualDraft}
              disabled={effectiveBusy}
              onChange={(e) => setManualDraft(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (effectiveBusy) return;
                if (e.key === "Enter") handleCommitManual();
                if (e.key === "Escape") setIsManualMode(false);
              }}
              placeholder="VD: VT-C4K-PTA12"
              className="bg-transparent text-sm font-bold text-slate-900 dark:text-white focus:outline-none w-36 uppercase disabled:opacity-60"
            />
            <button
              type="button"
              disabled={effectiveBusy}
              onClick={handleCommitManual}
              className="px-2 py-0.5 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
            >
              Chọn
            </button>
          </div>
        )}
        {canManual && (
          <button
            type="button"
            disabled={effectiveBusy}
            onClick={() => {
              if (isManualMode) {
                setIsManualMode(false);
              } else {
                setManualDraft(currentCode);
                setIsManualMode(true);
              }
            }}
            title={
              isManualMode
                ? "Chuyển sang chọn từ danh sách lớp"
                : "Gõ mã lớp thủ công"
            }
            className="text-xs text-slate-600 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 transition cursor-pointer"
          >
            {isManualMode ? "📋" : "✏️"}
          </button>
        )}
      </div>

      {showRefreshButton && (
        <button
          type="button"
          onClick={() => void handleTriggerRefresh()}
          disabled={effectiveBusy}
          title="Quét lại danh sách lớp đang dạy và đồng bộ lớp đang chọn từ LMS"
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:bg-slate-700 disabled:opacity-60 text-white text-xs sm:text-sm font-bold transition shadow-md cursor-pointer"
        >
          <RefreshCw
            className={`w-4 h-4 ${
              isRefreshing || internalRefreshing ? "animate-spin" : ""
            }`}
          />
          <span>
            {isRefreshing || internalRefreshing ? refreshingLabel : refreshLabel}
          </span>
        </button>
      )}

      {lastSyncedAt && (
        <span className="text-[11px] font-medium text-blue-100/90 dark:text-slate-400">
          Đồng bộ: {lastSyncedAt}
        </span>
      )}

      {refreshError && (
        <div
          role="alert"
          className="w-full text-xs font-semibold text-rose-300 bg-rose-950/70 border border-rose-500/40 rounded-lg px-2.5 py-1.5"
        >
          {refreshError}
        </div>
      )}
    </div>
  );
}

export default ClassPicker;
