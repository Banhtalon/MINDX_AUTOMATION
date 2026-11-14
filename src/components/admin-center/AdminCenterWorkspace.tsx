"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Filter,
  Loader2,
  PauseCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  Zap,
} from "lucide-react";
import type {
  AdminCenterOverviewResponse,
  AdminScanProgressState,
} from "@/lib/admin-center/admin-types";
import { AdminTabsContent } from "./AdminTabsContent";
import {
  filterAdminClasses,
  type AdminBlockFilter,
  type AdminMilestoneFilter,
  type AdminTabKey,
} from "./admin-ui-helpers";

const TAB_ITEMS: Array<{ key: AdminTabKey; label: string }> = [
  { key: "weekly", label: "1. Vận hành tuần" },
  { key: "btvn", label: "2. BTVN Coding & Đẩy Teaching" },
  { key: "spck", label: "3. Giám sát SPCK (B12–14)" },
  { key: "gt9", label: "4. Lớp > B9 & Tạo Nhiệm vụ SPCK" },
  { key: "instructors", label: "5. Giảng viên, Zalo & Cảnh báo" },
];

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Parses JSON strictly into a plain object and requires both HTTP 2xx and `success === true`
 * so malformed JSON or HTTP 200 `{}` is never misinterpreted as a completed action.
 */
async function readJsonObjectResponse<
  T extends Record<string, any> = Record<string, any>
>(
  res: Response
): Promise<{
  ok: boolean;
  json: Partial<T> & {
    success?: boolean;
    error?: string;
    message?: string;
  };
  invalidJson: boolean;
}> {
  let raw: unknown;
  let invalidJson = false;
  try {
    raw = await res.json();
  } catch {
    invalidJson = true;
  }
  const parsedObj = isPlainObject(raw) ? raw : {};
  if (!isPlainObject(raw)) {
    invalidJson = true;
  }
  return {
    ok: res.ok && !invalidJson && parsedObj.success === true,
    json: parsedObj as Partial<T> & {
      success?: boolean;
      error?: string;
      message?: string;
    },
    invalidJson,
  };
}

function summarizeBatchItemIssues(results: unknown): string {
  if (!Array.isArray(results) || results.length === 0) return "";
  const issues = results
    .filter(
      (item: any) =>
        item &&
        (item.success === false ||
          (typeof item.status === "string" && item.status !== "VERIFIED"))
    )
    .slice(0, 3)
    .map((item: any) => {
      const code = String(item.classCode || "?").trim();
      const detail = String(item.error || item.status || "Lỗi").trim();
      return `${code}: ${detail}`;
    });
  return issues.length > 0 ? ` (${issues.join("; ")})` : "";
}

export function AdminCenterWorkspace() {
  const [overview, setOverview] = useState<AdminCenterOverviewResponse | null>(
    null
  );
  const [loadingInitial, setLoadingInitial] = useState<boolean>(true);
  const [includeMakeup, setIncludeMakeup] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<AdminTabKey>("weekly");

  const [blockFilter, setBlockFilter] = useState<AdminBlockFilter>("ALL");
  const [instructorFilter, setInstructorFilter] = useState<string>("");
  const [onlyIssues, setOnlyIssues] = useState<boolean>(false);
  const [milestoneFilter, setMilestoneFilter] =
    useState<AdminMilestoneFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [syncProgressBySession, setSyncProgressBySession] =
    useState<boolean>(true);
  const [isScanTriggerInFlight, setIsScanTriggerInFlight] =
    useState<boolean>(false);
  const [isBatchActionRunning, setIsBatchActionRunning] =
    useState<boolean>(false);
  const [busyClassCode, setBusyClassCode] = useState<string | null>(null);

  const [statusBanner, setStatusBanner] = useState<{
    tone: "info" | "success" | "error";
    text: string;
  } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const fetchOverview = useCallback(async (showMakeup: boolean) => {
    try {
      const qs = `includeMakeup=${showMakeup ? "true" : "false"}`;
      const res = await fetch(`/api/admin-center/overview?${qs}`, {
        cache: "no-store",
      });
      const { ok, json, invalidJson } =
        await readJsonObjectResponse<AdminCenterOverviewResponse>(res);
      if (!isMountedRef.current) return;
      if (!ok) {
        setStatusBanner({
          tone: "error",
          text:
            json.error ||
            (invalidJson
              ? `Phản hồi dữ liệu Admin Center không hợp lệ (HTTP ${res.status}).`
              : `Không tải được dữ liệu Khu vực Admin (HTTP ${res.status}).`),
        });
        return;
      }
      setOverview(json as AdminCenterOverviewResponse);
    } catch (err: any) {
      if (!isMountedRef.current) return;
      setStatusBanner({
        tone: "error",
        text: err instanceof Error ? err.message : "Lỗi kết nối máy chủ nội bộ.",
      });
    } finally {
      if (isMountedRef.current) {
        setLoadingInitial(false);
      }
    }
  }, []);

  // Load once on mount, and re-fetch strictly when user toggles includeMakeup
  useEffect(() => {
    void fetchOverview(includeMakeup);
  }, [includeMakeup, fetchOverview]);

  const isBackendScanRunning = Boolean(overview?.scanProgress?.isRunning);
  const isScanning = isScanTriggerInFlight || isBackendScanRunning;

  // Strictly NO polling timer while idle; poll 2s ONLY when scan is active
  useEffect(() => {
    if (!isScanning) return;
    const id = window.setInterval(() => {
      void fetchOverview(includeMakeup);
    }, 2000);
    return () => window.clearInterval(id);
  }, [isScanning, includeMakeup, fetchOverview]);

  const handleTriggerScan = async (
    scope: "ALL" | "CODING_ONLY" | "TEACHING_ONLY" | "SINGLE_CLASS",
    classCode?: string
  ) => {
    setStatusBanner({
      tone: "info",
      text:
        scope === "SINGLE_CLASS" && classCode
          ? `Đang quét lại lớp ${classCode}...`
          : scope === "TEACHING_ONLY"
          ? "Đang làm mới lịch tuần & check nhận xét từ Teaching..."
          : scope === "CODING_ONLY"
          ? "Đang quét các lớp Coding của cơ sở..."
          : "Đang quét toàn bộ lớp cơ sở từ LMS Admin & Teaching...",
    });

    if (scope === "SINGLE_CLASS" && classCode) {
      setBusyClassCode(classCode);
    } else {
      setIsScanTriggerInFlight(true);
    }

    try {
      const res = await fetch("/api/admin-center/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope,
          ...(classCode ? { classCode } : {}),
          includeMakeup,
        }),
      });
      const { ok, json, invalidJson } = await readJsonObjectResponse(res);
      if (isPlainObject(json.overview)) {
        setOverview(json.overview as AdminCenterOverviewResponse);
      }
      if (!ok) {
        setStatusBanner({
          tone: "error",
          text:
            json.error ||
            (json.status === "PARTIAL"
              ? `Quét cơ sở chỉ hoàn tất một phần (${json.scannedCount ?? 0} lớp); một số dữ liệu gặp lỗi.`
              : invalidJson
              ? `Phản hồi quét cơ sở không hợp lệ (HTTP ${res.status}).`
              : `Quét cơ sở gặp lỗi (HTTP ${res.status}).`),
        });
      } else {
        const failCount = Array.isArray(json.failedClasses)
          ? json.failedClasses.length
          : 0;
        setStatusBanner({
          tone: failCount > 0 ? "info" : "success",
          text:
            json.status === "STOPPED"
              ? `Đã dừng an toàn sau ${json.scannedCount ?? 0} lớp.`
              : `Hoàn tất quét ${json.scannedCount ?? 0} lớp${
                  failCount > 0 ? ` (${failCount} lớp cần kiểm tra lại)` : ""
                }.`,
        });
      }
    } catch (err: any) {
      setStatusBanner({
        tone: "error",
        text: err instanceof Error ? err.message : "Lỗi gọi API quét cơ sở.",
      });
    } finally {
      setIsScanTriggerInFlight(false);
      setBusyClassCode(null);
      await fetchOverview(includeMakeup);
    }
  };

  const handleStopAfterCurrent = async () => {
    try {
      const res = await fetch("/api/admin-center/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "STOP_AFTER_CURRENT" }),
      });
      const { ok, json, invalidJson } = await readJsonObjectResponse(res);
      if (!ok) {
        setStatusBanner({
          tone: "error",
          text:
            json.error ||
            (invalidJson
              ? `Phản hồi lệnh dừng không hợp lệ (HTTP ${res.status}).`
              : `Không gửi được lệnh dừng (HTTP ${res.status}).`),
        });
        return;
      }
      if (isPlainObject(json.scanProgress) && overview) {
        setOverview({
          ...overview,
          scanProgress: json.scanProgress as AdminScanProgressState,
        });
      }
      setStatusBanner({
        tone: "info",
        text: "Đã gửi yêu cầu Dừng sau khi xong lớp hiện tại.",
      });
    } catch (err: any) {
      setStatusBanner({
        tone: "error",
        text: err instanceof Error ? err.message : "Không gửi được lệnh dừng.",
      });
    }
  };

  const handleEmergencyStop = async () => {
    try {
      const res = await fetch("/api/queue/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      const { ok, json, invalidJson } = await readJsonObjectResponse(res);
      if (!ok) {
        setStatusBanner({
          tone: "error",
          text: `Không thể dừng khẩn cấp hàng đợi: ${
            json.error ||
            (invalidJson
              ? `Phản hồi máy chủ không hợp lệ (HTTP ${res.status})`
              : `HTTP ${res.status}`)
          }`,
        });
        return;
      }
      setStatusBanner({
        tone: "error",
        text: "Đã kích hoạt Dừng khẩn cấp hàng đợi.",
      });
      await fetchOverview(includeMakeup);
    } catch (err: any) {
      setStatusBanner({
        tone: "error",
        text: err instanceof Error ? err.message : "Không thể dừng hàng đợi.",
      });
    }
  };

  const handleSyncSingleBtvn = async (classCode: string) => {
    setBusyClassCode(classCode);
    setStatusBanner({
      tone: "info",
      text: `Đang quét lại BTVN LMS và đẩy sang Teaching cho lớp ${classCode}...`,
    });
    try {
      const res = await fetch("/api/admin-center/sync-btvn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "SINGLE",
          classCode,
          refreshFromLms: true,
          includeMakeup,
        }),
      });
      const { ok, json, invalidJson } = await readJsonObjectResponse(res);
      if (isPlainObject(json.overview)) {
        setOverview(json.overview as AdminCenterOverviewResponse);
      }
      setStatusBanner({
        tone: ok ? "success" : "error",
        text: ok
          ? `Đã đồng bộ BTVN ${classCode} sang Teaching (${json.pushedScoresCount ?? 0} ô điểm, ${json.matchedCount ?? 0} HV).`
          : json.error ||
            (invalidJson
              ? `Phản hồi đồng bộ BTVN ${classCode} không hợp lệ (HTTP ${res.status}).`
              : `Đồng bộ BTVN ${classCode} chưa hoàn tất (HTTP ${res.status}).`),
      });
    } catch (err: any) {
      setStatusBanner({
        tone: "error",
        text: err instanceof Error ? err.message : "Lỗi đồng bộ BTVN.",
      });
    } finally {
      setBusyClassCode(null);
    }
  };

  const handleSyncBatchBtvn = async (classCodes: string[]) => {
    if (classCodes.length === 0) {
      setStatusBanner({
        tone: "info",
        text: "Không có lớp Coding đủ điều kiện để đồng bộ BTVN.",
      });
      return;
    }
    setIsBatchActionRunning(true);
    setStatusBanner({
      tone: "info",
      text: `Đang quét và đẩy điểm BTVN sang Teaching cho ${classCodes.length} lớp Coding...`,
    });
    try {
      const res = await fetch("/api/admin-center/sync-btvn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "BATCH_CODING",
          classCodes,
          refreshFromLms: true,
          includeMakeup,
        }),
      });
      const { ok, json, invalidJson } = await readJsonObjectResponse(res);
      if (isPlainObject(json.overview)) {
        setOverview(json.overview as AdminCenterOverviewResponse);
      }
      const detailSuffix = summarizeBatchItemIssues(json.results);
      if (!ok || (json.failedCount ?? 0) > 0) {
        setStatusBanner({
          tone: "error",
          text: `Đẩy hàng loạt BTVN không hoàn tất: ${
            json.error ||
            (invalidJson
              ? `Phản hồi máy chủ không hợp lệ (HTTP ${res.status})`
              : `${json.verifiedCount ?? 0}/${
                  json.totalTargets ?? classCodes.length
                } lớp đạt, ${json.failedCount ?? 0} lớp lỗi (HTTP ${res.status})`)
          }${detailSuffix}`,
        });
        return;
      }
      setStatusBanner({
        tone: (json.needsAttentionCount ?? 0) > 0 ? "info" : "success",
        text: `Hoàn tất đẩy BTVN Coding: ${json.verifiedCount ?? 0}/${
          json.totalTargets ?? classCodes.length
        } lớp VERIFIED${
          json.needsAttentionCount
            ? `, ${json.needsAttentionCount} lớp cần lưu ý`
            : ""
        }${detailSuffix}.`,
      });
    } catch (err: any) {
      setStatusBanner({
        tone: "error",
        text: err instanceof Error ? err.message : "Lỗi đẩy hàng loạt BTVN.",
      });
    } finally {
      setIsBatchActionRunning(false);
    }
  };

  const handleProvisionSingleSpckTasks = async (classCode: string) => {
    setBusyClassCode(classCode);
    setStatusBanner({
      tone: "info",
      text: `Đang tạo / chuẩn hóa Dự án & 5 nhiệm vụ SPCK trên Teaching cho ${classCode}...`,
    });
    try {
      const res = await fetch("/api/admin-center/provision-spck-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "SINGLE",
          classCode,
          syncProgressBySession,
          includeMakeup,
        }),
      });
      const { ok, json, invalidJson } = await readJsonObjectResponse(res);
      if (isPlainObject(json.overview)) {
        setOverview(json.overview as AdminCenterOverviewResponse);
      }
      setStatusBanner({
        tone: ok ? "success" : "error",
        text: ok
          ? `Đã tạo đủ 5 nhiệm vụ SPCK (100%) cho lớp ${classCode} (${json.assignedStudentCount ?? 0} HV).`
          : json.error ||
            (invalidJson
              ? `Phản hồi tạo nhiệm vụ SPCK cho ${classCode} không hợp lệ (HTTP ${res.status}).`
              : `Không thể tạo nhiệm vụ SPCK cho ${classCode} (HTTP ${res.status}).`),
      });
    } catch (err: any) {
      setStatusBanner({
        tone: "error",
        text: err instanceof Error ? err.message : "Lỗi tạo nhiệm vụ SPCK.",
      });
    } finally {
      setBusyClassCode(null);
    }
  };

  const handleProvisionBatchSpckTasks = async (classCodes: string[]) => {
    if (classCodes.length === 0) {
      setStatusBanner({
        tone: "info",
        text: "Không có lớp (> Buổi 9) nào cần tạo nhiệm vụ SPCK.",
      });
      return;
    }
    setIsBatchActionRunning(true);
    setStatusBanner({
      tone: "info",
      text: `Đang tạo Dự án & 5 nhiệm vụ SPCK cho ${classCodes.length} lớp (> Buổi 9)...`,
    });
    try {
      const res = await fetch("/api/admin-center/provision-spck-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "BATCH_GT9",
          classCodes,
          syncProgressBySession,
          includeMakeup,
        }),
      });
      const { ok, json, invalidJson } = await readJsonObjectResponse(res);
      if (isPlainObject(json.overview)) {
        setOverview(json.overview as AdminCenterOverviewResponse);
      }
      const detailSuffix = summarizeBatchItemIssues(json.results);
      if (
        !ok ||
        (json.failedCount ?? 0) > 0 ||
        (json.needsAttentionCount ?? 0) > 0
      ) {
        setStatusBanner({
          tone: "error",
          text: `Tạo hàng loạt 5 nhiệm vụ SPCK không hoàn tất: ${
            json.error ||
            (invalidJson
              ? `Phản hồi máy chủ không hợp lệ (HTTP ${res.status})`
              : `${json.verifiedCount ?? 0}/${
                  json.totalTargets ?? classCodes.length
                } lớp đạt, ${json.needsAttentionCount ?? 0} lớp cần xử lý, ${
                  json.failedCount ?? 0
                } lớp lỗi (HTTP ${res.status})`)
          }${detailSuffix}`,
        });
        return;
      }
      setStatusBanner({
        tone: "success",
        text: `Hoàn tất tạo 5 nhiệm vụ SPCK: ${json.verifiedCount ?? 0}/${
          json.totalTargets ?? classCodes.length
        } lớp đạt chuẩn.`,
      });
    } catch (err: any) {
      setStatusBanner({
        tone: "error",
        text: err instanceof Error ? err.message : "Lỗi tạo hàng loạt SPCK.",
      });
    } finally {
      setIsBatchActionRunning(false);
    }
  };

  const handleCopyText = async (key: string, text: string) => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const el = document.createElement("textarea");
        el.value = text;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      setCopiedKey(key);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        setCopiedKey(null);
      }, 2200);
    } catch {
      setStatusBanner({
        tone: "error",
        text: "Trình duyệt không cho phép copy tự động; vui lòng thử lại.",
      });
    }
  };

  const allClasses = useMemo(() => overview?.classes || [], [overview]);
  const instructorOptions = useMemo(() => {
    const names = new Set<string>();
    for (const c of allClasses) {
      if (c.mainTeacher) names.add(c.mainTeacher);
      if (c.assistantTeacher) names.add(c.assistantTeacher);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, "vi"));
  }, [allClasses]);

  const filteredClasses = useMemo(
    () =>
      filterAdminClasses(
        allClasses,
        {
          blockFilter,
          instructorFilter,
          onlyIssues,
          milestoneFilter,
          searchQuery,
        },
        activeTab
      ),
    [
      allClasses,
      blockFilter,
      instructorFilter,
      onlyIssues,
      milestoneFilter,
      searchQuery,
      activeTab,
    ]
  );

  const scanProgress = overview?.scanProgress;
  const kpis = overview?.kpis;
  const pct =
    scanProgress && scanProgress.totalClasses > 0
      ? Math.round(
          (scanProgress.scannedClasses / scanProgress.totalClasses) * 100
        )
      : 0;

  return (
    <div className="space-y-4 py-1">
      {/* Header Control Banner */}
      <div className="mindx-card rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg sm:text-xl font-black flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-amber-500" />
                Khu vực Quản lý Cơ sở Admin — {overview?.centerCode || "205ALHP"}
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/40">
                205A Lê Hồng Phong, Vũng Tàu
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)]">
              <span>
                LMS Admin:{" "}
                <strong
                  className={
                    overview?.hasAdminLmsAuth
                      ? "text-emerald-700 dark:text-emerald-300"
                      : "text-rose-700 dark:text-rose-300"
                  }
                >
                  {overview?.hasAdminLmsAuth
                    ? overview.adminLmsUsernameMasked || "Đã cấu hình"
                    : "Chưa cấu hình ADMIN_LMS_*"}
                </strong>
              </span>
              <span>
                Teaching:{" "}
                <strong>
                  {overview?.adminTeachingUsernameMasked || "quangda"}
                </strong>
              </span>
              {overview?.latestScanRun && (
                <span>
                  Lần quét gần nhất:{" "}
                  <strong>
                    {overview.latestScanRun.finishedAt
                      ? overview.latestScanRun.finishedAt
                          .slice(0, 16)
                          .replace("T", " ")
                      : overview.latestScanRun.status}
                  </strong>{" "}
                  ({overview.latestScanRun.scannedClasses}/
                  {overview.latestScanRun.totalClasses} lớp)
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isScanning || isBatchActionRunning}
              onClick={() => handleTriggerScan("ALL")}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-black bg-amber-500 hover:bg-amber-600 text-slate-950 shadow disabled:opacity-50"
            >
              {isScanning ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              🔄 Quét toàn cơ sở
            </button>
            <button
              type="button"
              disabled={isScanning || isBatchActionRunning}
              onClick={() => handleTriggerScan("CODING_ONLY")}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-[var(--border-card)] bg-[var(--surface-subtle)] hover:opacity-85 disabled:opacity-50"
            >
              💻 Quét riêng Coding
            </button>
            <button
              type="button"
              disabled={isScanning || isBatchActionRunning}
              onClick={() => handleTriggerScan("TEACHING_ONLY")}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-[var(--border-card)] bg-[var(--surface-card)] hover:bg-[var(--surface-subtle)] disabled:opacity-50"
            >
              <Zap className="w-3.5 h-3.5 text-sky-500" />⚡ Làm mới Teaching
              nhanh
            </button>
          </div>
        </div>

        {/* Active Scan Progress Bar */}
        {isScanning && (
          <div className="p-3 rounded-xl bg-[var(--surface-subtle)] border border-amber-500/40 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="font-bold flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                <span>
                  Đang quét cơ sở:{" "}
                  {scanProgress?.scannedClasses ?? 0}/
                  {scanProgress?.totalClasses || "?"} lớp
                  {scanProgress?.currentClassCode
                    ? ` — Đang xử lý: ${scanProgress.currentClassCode}`
                    : ""}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleStopAfterCurrent}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-500/20 text-amber-800 dark:text-amber-200 border border-amber-500/40"
                >
                  <PauseCircle className="w-3.5 h-3.5" /> Dừng sau lớp này
                </button>
                <button
                  type="button"
                  onClick={handleEmergencyStop}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-600 text-white"
                >
                  <Square className="w-3.5 h-3.5" /> Dừng khẩn cấp
                </button>
              </div>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
              <div
                className="h-full bg-amber-500 transition-all duration-300"
                style={{ width: `${Math.max(4, pct)}%` }}
              />
            </div>
          </div>
        )}

        {/* Status feedback banner */}
        {statusBanner && (
          <div
            className={`px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 border ${
              statusBanner.tone === "success"
                ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-800 dark:text-emerald-200"
                : statusBanner.tone === "error"
                ? "bg-rose-500/15 border-rose-500/40 text-rose-800 dark:text-rose-200"
                : "bg-sky-500/15 border-sky-500/40 text-sky-800 dark:text-sky-200"
            }`}
          >
            {statusBanner.tone === "success" ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span>{statusBanner.text}</span>
          </div>
        )}
      </div>

      {/* 6 Clickable KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <button
          type="button"
          onClick={() => {
            setActiveTab("weekly");
            setOnlyIssues(false);
            setMilestoneFilter("ALL");
          }}
          className="mindx-card mindx-card-blue rounded-xl p-3 text-left transition-transform hover:-translate-y-0.5"
        >
          <div className="text-[11px] font-bold text-[var(--text-secondary)]">
            Tổng lớp cơ sở
          </div>
          <div className="text-xl font-black mt-0.5">
            {kpis?.totalClasses ?? 0}
          </div>
          <div className="text-[11px] text-[var(--text-secondary)]">
            {kpis?.codingClasses ?? 0} Coding • {kpis?.roboticsClasses ?? 0} Rob
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab("weekly");
            setOnlyIssues(true);
            setMilestoneFilter("ALL");
          }}
          className="mindx-card mindx-card-amber rounded-xl p-3 text-left transition-transform hover:-translate-y-0.5"
        >
          <div className="text-[11px] font-bold text-[var(--text-secondary)]">
            Vận hành tuần (Thiếu/Trễ)
          </div>
          <div className="text-xl font-black mt-0.5 text-amber-600 dark:text-amber-300">
            {kpis?.weeklyOpsIssuesCount ?? 0}
          </div>
          <div className="text-[11px] text-[var(--text-secondary)]">
            Điểm danh, NX, 48h, CP
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab("btvn");
            setBlockFilter("CODING");
            setOnlyIssues(true);
            setMilestoneFilter("ALL");
          }}
          className="mindx-card mindx-card-red rounded-xl p-3 text-left transition-transform hover:-translate-y-0.5"
        >
          <div className="text-[11px] font-bold text-[var(--text-secondary)]">
            BTVN Coding chờ chấm / Lệch
          </div>
          <div className="text-xl font-black mt-0.5 text-rose-600 dark:text-rose-300">
            {kpis?.codingBtvnIssuesCount ?? 0}
          </div>
          <div className="text-[11px] text-[var(--text-secondary)]">
            {kpis?.codingUngradedSubmissionsTotal ?? 0} bài chờ chấm
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab("spck");
            setOnlyIssues(true);
            setMilestoneFilter("ALL");
          }}
          className="mindx-card mindx-card-amber rounded-xl p-3 text-left transition-transform hover:-translate-y-0.5"
        >
          <div className="text-[11px] font-bold text-[var(--text-secondary)]">
            Thiếu SPCK / NX (B12–14)
          </div>
          <div className="text-xl font-black mt-0.5 text-amber-600 dark:text-amber-300">
            {kpis?.spckAuditIssuesCount ?? 0}
          </div>
          <div className="text-[11px] text-[var(--text-secondary)]">
            Bấm xem lớp thiếu HV
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab("gt9");
            setOnlyIssues(true);
            setMilestoneFilter("ALL");
          }}
          className="mindx-card mindx-card-purple rounded-xl p-3 text-left transition-transform hover:-translate-y-0.5"
        >
          <div className="text-[11px] font-bold text-[var(--text-secondary)]">
            &gt; B9 thiếu 5 NV SPCK
          </div>
          <div className="text-xl font-black mt-0.5 text-purple-600 dark:text-purple-300">
            {kpis?.gt9MissingTasksCount ?? 0} / {kpis?.gt9ClassesTotal ?? 0}
          </div>
          <div className="text-[11px] text-[var(--text-secondary)]">
            Tạo tự động trên Teaching
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab("instructors");
            setOnlyIssues(false);
            setMilestoneFilter("ALL");
          }}
          className="mindx-card mindx-card-emerald rounded-xl p-3 text-left transition-transform hover:-translate-y-0.5"
        >
          <div className="text-[11px] font-bold text-[var(--text-secondary)]">
            Cảnh báo sớm &amp; Nợ bù
          </div>
          <div className="text-xl font-black mt-0.5">
            {kpis?.earlyWarningsTotal ?? 0}
          </div>
          <div className="text-[11px] text-[var(--text-secondary)]">
            {kpis?.rosterMismatchClassesCount ?? 0} lệch HV •{" "}
            {kpis?.makeupDebtClassesCount ?? 0} học bù
          </div>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="mindx-card rounded-xl p-3 flex flex-wrap items-center gap-2.5 text-xs">
        <div className="inline-flex items-center gap-1 font-bold text-[var(--text-secondary)]">
          <Filter className="w-3.5 h-3.5" /> Bộ lọc:
        </div>

        <select
          aria-label="Lọc theo khối"
          value={blockFilter}
          onChange={(e) => setBlockFilter(e.target.value as AdminBlockFilter)}
          className="px-2.5 py-1.5 rounded-lg border border-[var(--border-card)] bg-[var(--surface-card)] font-semibold"
        >
          <option value="ALL">Tất cả khối</option>
          <option value="CODING">Chỉ Coding</option>
          <option value="ROBOTICS">Chỉ Robotics</option>
        </select>

        <select
          aria-label="Lọc theo giảng viên"
          value={instructorFilter}
          onChange={(e) => setInstructorFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg border border-[var(--border-card)] bg-[var(--surface-card)] font-semibold"
        >
          <option value="">Tất cả Giảng viên</option>
          {instructorOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        <select
          aria-label="Lọc theo mốc buổi"
          value={milestoneFilter}
          onChange={(e) =>
            setMilestoneFilter(e.target.value as AdminMilestoneFilter)
          }
          className="px-2.5 py-1.5 rounded-lg border border-[var(--border-card)] bg-[var(--surface-card)] font-semibold"
        >
          <option value="ALL">Mọi giai đoạn</option>
          <option value="GT9">Chỉ lớp &gt; Buổi 9</option>
          <option value="SPCK_STAGE">Chỉ lớp SPCK (B12–14)</option>
        </select>

        <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border-card)] bg-[var(--surface-subtle)] cursor-pointer font-semibold">
          <input
            type="checkbox"
            checked={onlyIssues}
            onChange={(e) => setOnlyIssues(e.target.checked)}
          />
          <span>Chỉ lớp cần xử lý</span>
        </label>

        <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border-card)] bg-[var(--surface-subtle)] cursor-pointer font-semibold">
          <input
            type="checkbox"
            checked={includeMakeup}
            onChange={(e) => setIncludeMakeup(e.target.checked)}
          />
          <span>Hiện lớp học bù (-HB)</span>
        </label>

        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm mã lớp, GV, ca học..."
            className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-[var(--border-card)] bg-[var(--surface-card)]"
          />
        </div>
      </div>

      {/* 5 Tabs Navigation */}
      <div className="flex flex-wrap gap-1.5 border-b border-[var(--border-card)] pb-2">
        {TAB_ITEMS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all border ${
                isActive
                  ? "bg-amber-500 text-slate-950 border-amber-600 shadow-sm"
                  : "bg-[var(--surface-card)] text-[var(--text-primary)] border-[var(--border-card)] hover:bg-[var(--surface-subtle)]"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Main Tab Body */}
      {loadingInitial && !overview ? (
        <div className="mindx-card rounded-xl p-10 flex items-center justify-center gap-2 text-sm text-[var(--text-secondary)]">
          <Loader2 className="w-5 h-5 animate-spin text-amber-500" />
          <span>Đang tải dữ liệu cơ sở 205ALHP...</span>
        </div>
      ) : (
        <AdminTabsContent
          activeTab={activeTab}
          classes={filteredClasses}
          instructors={overview?.instructors || []}
          campusZaloSummaryText={overview?.campusZaloSummaryText || ""}
          syncProgressBySession={syncProgressBySession}
          onToggleSyncProgressBySession={setSyncProgressBySession}
          busyClassCode={busyClassCode}
          isBatchActionRunning={isBatchActionRunning}
          onRescanSingleClass={(code) => handleTriggerScan("SINGLE_CLASS", code)}
          onSyncSingleBtvn={handleSyncSingleBtvn}
          onSyncBatchBtvn={handleSyncBatchBtvn}
          onProvisionSingleSpckTasks={handleProvisionSingleSpckTasks}
          onProvisionBatchSpckTasks={handleProvisionBatchSpckTasks}
          onCopyText={handleCopyText}
          copiedKey={copiedKey}
        />
      )}
    </div>
  );
}
