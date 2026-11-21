"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  readSavedClassCode,
  writeSavedClassCode,
  type ClassPickerOption,
} from "@/components/class-picker";
import {
  DemoPrepView,
  DemoStageView,
  DemoTopBar,
  type DemoMode,
  type DemoStatusPill,
} from "@/components/demo-day";
import type {
  DemoDayClassStateResponse,
  DemoDayStudentItem,
} from "@/lib/demo-day/demo-day-helpers";

export default function DemoDayPage() {
  const [data, setData] = useState<DemoDayClassStateResponse | null>(null);
  const [mode, setMode] = useState<DemoMode>("stage");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [preppingGm, setPreppingGm] = useState(false);
  const [launchingAction, setLaunchingAction] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [statusPill, setStatusPill] = useState<DemoStatusPill | null>(null);

  const loadSeqRef = useRef(0);
  const pillTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showPill = useCallback(
    (text: string, tone: DemoStatusPill["tone"] = "success") => {
      setStatusPill({ text, tone });
      if (pillTimerRef.current) {
        clearTimeout(pillTimerRef.current);
      }
      pillTimerRef.current = setTimeout(() => {
        setStatusPill(null);
      }, 2800);
    },
    []
  );

  useEffect(() => {
    return () => {
      if (pillTimerRef.current) {
        clearTimeout(pillTimerRef.current);
      }
    };
  }, []);

  const loadState = useCallback(
    async (requestedClassId?: string, allowFallbackToDefault = false) => {
      const reqId = ++loadSeqRef.current;
      setIsLoading(true);
      setErrorBanner(null);
      try {
        const qs = new URLSearchParams();
        if (requestedClassId !== undefined) qs.set("classId", requestedClassId);
        const querySuffix = qs.toString();
        const res = await fetch(
          querySuffix ? `/api/demo-day/state?${querySuffix}` : "/api/demo-day/state"
        );
        const json = await res.json();
        if (reqId !== loadSeqRef.current) return;
        if (
          (res.status === 404 || res.status === 400) &&
          allowFallbackToDefault &&
          requestedClassId !== undefined
        ) {
          void loadState(undefined, false);
          return;
        }
        if (!res.ok || !json?.success || !json?.data) {
          setErrorBanner(json?.error || "Không thể tải dữ liệu lớp Thi Demo.");
          return;
        }
        setData(json.data as DemoDayClassStateResponse);
        if (json.data.classId) {
          writeSavedClassCode(json.data.classId);
        }
      } catch (err: unknown) {
        if (reqId !== loadSeqRef.current) return;
        setErrorBanner(
          err instanceof Error ? err.message : "Lỗi kết nối máy chủ."
        );
      } finally {
        if (reqId === loadSeqRef.current) {
          setIsLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    let hasUrlClassParam = false;
    let urlClass = "";
    try {
      const params = new URLSearchParams(window.location.search);
      hasUrlClassParam = params.has("classId");
      urlClass = String(params.get("classId") || "")
        .trim()
        .toUpperCase();
    } catch {
      hasUrlClassParam = false;
      urlClass = "";
    }
    if (hasUrlClassParam) {
      void loadState(urlClass, false);
      return;
    }
    const savedClass = readSavedClassCode();
    void loadState(savedClass || undefined, Boolean(savedClass));
  }, [loadState]);

  const persistSave = useCallback(
    async (
      payload: Record<string, unknown>,
      successPillText?: string,
      successTone: DemoStatusPill["tone"] = "success"
    ): Promise<boolean> => {
      if (!data?.classId) return false;
      setIsSaving(true);
      setErrorBanner(null);
      try {
        const res = await fetch("/api/demo-day/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            classId: data.classId,
            ...(data.rowVer > 0 ? { expectedRowVer: data.rowVer } : {}),
            ...payload,
          }),
        });
        const json = await res.json();
        if (json?.data) {
          setData(json.data as DemoDayClassStateResponse);
        }
        if (res.status === 409 || json?.staleIgnored) {
          showPill("⚠️ Đã tải lại thứ tự mới", "warning");
          return false;
        }
        if (!res.ok || !json?.success) {
          setErrorBanner(json?.error || "Không lưu được thay đổi.");
          showPill("✕ Lỗi lưu", "error");
          return false;
        }
        if (successPillText) {
          showPill(successPillText, successTone);
        }
        return true;
      } catch (err: unknown) {
        setErrorBanner(
          err instanceof Error ? err.message : "Lỗi kết nối khi lưu."
        );
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [data, showPill]
  );

  const callStopProcesses = useCallback(async () => {
    try {
      const res = await fetch("/api/demo-day/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "STOP_PROCESSES" }),
      });
      const json = await res.json();
      if (res.ok && json?.success) {
        setData((prev) =>
          prev
            ? {
                ...prev,
                activeProcessCount: Number(json.activeProcessCount || 0),
              }
            : prev
        );
      }
    } catch {
      // Ignore background cleanup errors
    }
  }, []);

  const openExternalTab = useCallback((url: string) => {
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      // Ignore popup error in restricted environments
    }
  }, []);

  const handleClassChange = useCallback(
    async (nextClassId: string) => {
      if (!nextClassId) return;
      if ((data?.activeProcessCount || 0) > 0) {
        await callStopProcesses();
      }
      await loadState(nextClassId);
    },
    [callStopProcesses, data?.activeProcessCount, loadState]
  );

  const handleClassesRefreshed = useCallback(
    (nextClasses: ClassPickerOption[]) => {
      setData((prev) =>
        prev
          ? {
              ...prev,
              runningClasses: nextClasses.map((c) => ({
                classId: String(c.classId || c.classCode || ""),
                classCode: String(c.classCode || c.classId || ""),
                className: String(c.className || c.classCode || ""),
                courseName: c.courseName,
                status: c.status,
                currentSessionNumber: c.currentSessionNumber,
                maxSessionNumber: c.maxSessionNumber,
              })),
            }
          : prev
      );
    },
    []
  );

  const handleShuffle = useCallback(async () => {
    if (!data?.classId || data.students.length === 0) return;
    if (data.activeProcessCount > 0) {
      await callStopProcesses();
    }
    await persistSave(
      { shuffleRandom: true },
      "✓ Đã bốc thăm",
      "primary"
    );
  }, [callStopProcesses, data, persistSave]);

  const handleSelectStudent = useCallback(
    async (studentId: string) => {
      if (!data || !studentId || studentId === data.currentStudentId) return;
      if (data.activeProcessCount > 0) {
        await callStopProcesses();
      }
      const idx = data.students.findIndex((s) => s.studentId === studentId);
      await persistSave(
        { currentStudentId: studentId },
        idx >= 0 ? `✓ Lượt ${idx + 1}` : undefined,
        "primary"
      );
    },
    [callStopProcesses, data, persistSave]
  );

  const handlePrev = useCallback(async () => {
    if (!data || data.students.length === 0) return;
    const idx = data.students.findIndex(
      (s) => s.studentId === data.currentStudentId
    );
    if (idx <= 0) return;
    if (data.activeProcessCount > 0) {
      await callStopProcesses();
    }
    const prevStu = data.students[idx - 1];
    await persistSave(
      { currentStudentId: prevStu.studentId },
      `✓ Lượt ${idx}`,
      "primary"
    );
  }, [callStopProcesses, data, persistSave]);

  const handleNext = useCallback(async () => {
    if (!data || data.students.length === 0) return;
    const idx = Math.max(
      0,
      data.students.findIndex((s) => s.studentId === data.currentStudentId)
    );
    const currentStu = data.students[idx];
    if (!currentStu) return;

    if (data.activeProcessCount > 0) {
      await callStopProcesses();
    }

    const nextCompleted = Array.from(
      new Set([...(data.completedStudentIds || []), currentStu.studentId])
    );

    if (idx < data.students.length - 1) {
      const nextStu = data.students[idx + 1];
      await persistSave(
        {
          currentStudentId: nextStu.studentId,
          completedStudentIds: nextCompleted,
        },
        `✓ Lượt ${idx + 2}`,
        "success"
      );
    } else {
      await persistSave(
        {
          completedStudentIds: nextCompleted,
        },
        "✓ Hoàn tất",
        "success"
      );
    }
  }, [callStopProcesses, data, persistSave]);

  const handleOpenSlide = useCallback(
    async (student: DemoDayStudentItem) => {
      if (!data?.classId || student.slide.kind === "MISSING") return;
      setErrorBanner(null);

      if (student.slide.url) {
        openExternalTab(student.slide.url);
        showPill("✓ Đã mở Slide", "success");
        return;
      }

      setLaunchingAction("SLIDE");
      try {
        const res = await fetch("/api/demo-day/launch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "OPEN_SLIDE",
            classId: data.classId,
            studentId: student.studentId,
            relPath: student.slide.relPath,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          setErrorBanner(json?.error || "Không thể mở Slide.");
          showPill("✕ Lỗi mở Slide", "error");
          return;
        }
        if (json.openUrl) {
          openExternalTab(json.openUrl);
        }
        showPill(json.message || "✓ Đã mở Slide", "success");
      } catch (err: unknown) {
        setErrorBanner(
          err instanceof Error ? err.message : "Lỗi kết nối khi mở Slide."
        );
      } finally {
        setLaunchingAction(null);
      }
    },
    [data?.classId, openExternalTab, showPill]
  );

  const handleRunProduct = useCallback(
    async (student: DemoDayStudentItem, isTest = false) => {
      if (!data?.classId || student.product.kind === "MISSING") return;
      setErrorBanner(null);

      const directUrl = student.product.previewUrl || student.product.url;
      if (directUrl) {
        openExternalTab(directUrl);
        showPill(isTest ? "✓ Chạy thử OK" : "✓ Đã mở Sản Phẩm", "primary");
        return;
      }

      setLaunchingAction("PRODUCT");
      try {
        const res = await fetch("/api/demo-day/launch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: isTest ? "TEST_PRODUCT" : "LAUNCH_PRODUCT",
            classId: data.classId,
            studentId: student.studentId,
            relPath: student.product.relPath,
          }),
        });
        const json = await res.json();
        if (typeof json?.activeProcessCount === "number") {
          setData((prev) =>
            prev
              ? { ...prev, activeProcessCount: json.activeProcessCount }
              : prev
          );
        }
        if (!res.ok || !json?.success) {
          setErrorBanner(json?.error || "Không thể chạy sản phẩm.");
          showPill("✕ Lỗi chạy SP", "error");
          return;
        }
        if (json.openUrl) {
          openExternalTab(json.openUrl);
        }
        showPill(
          isTest
            ? "✓ Chạy thử OK"
            : json.message || "✓ Đang mở Sản Phẩm",
          "primary"
        );
      } catch (err: unknown) {
        setErrorBanner(
          err instanceof Error ? err.message : "Lỗi kết nối khi chạy sản phẩm."
        );
      } finally {
        setLaunchingAction(null);
      }
    },
    [data?.classId, openExternalTab, showPill]
  );

  const handleStopApps = useCallback(async () => {
    await callStopProcesses();
    showPill("✓ Đã đóng app", "warning");
  }, [callStopProcesses, showPill]);

  const handleMoveOrder = useCallback(
    async (index: number, delta: -1 | 1) => {
      if (!data) return;
      const target = index + delta;
      if (target < 0 || target >= data.students.length) return;
      const ids = data.students.map((s) => s.studentId);
      const tmp = ids[index];
      ids[index] = ids[target];
      ids[target] = tmp;
      await persistSave({ order: ids }, "✓ Đã đổi thứ tự", "primary");
    },
    [data, persistSave]
  );

  const handleToggleExcluded = useCallback(
    async (studentId: string, nextExcluded: boolean) => {
      await persistSave(
        {
          studentOverride: {
            studentId,
            excluded: nextExcluded,
          },
        },
        nextExcluded ? "✓ Đã đánh dấu vắng" : "✓ Đã bật có mặt",
        "primary"
      );
    },
    [persistSave]
  );

  const handleSaveSlideUrl = useCallback(
    async (studentId: string, slideUrl: string) => {
      if (!slideUrl) {
        showPill("⚠️ Nhập link", "warning");
        return;
      }
      await persistSave(
        {
          studentOverride: {
            studentId,
            slideUrl,
          },
        },
        "✓ Đã lưu Slide",
        "success"
      );
    },
    [persistSave, showPill]
  );

  const handleChangeEntry = useCallback(
    async (studentId: string, entryValue: string) => {
      await persistSave(
        {
          studentOverride: {
            studentId,
            productEntryValue: entryValue,
          },
        },
        "✓ Đã đổi file",
        "primary"
      );
    },
    [persistSave]
  );

  const handlePrepGameMakerAll = useCallback(async () => {
    if (!data?.classId) return;
    setPreppingGm(true);
    setErrorBanner(null);
    try {
      const res = await fetch("/api/demo-day/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "PREP_GAMEMAKER_CLASS",
          classId: data.classId,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setErrorBanner(json?.error || "Không giải nén được dự án GameMaker.");
        showPill("✕ Lỗi giải nén", "error");
        return;
      }
      showPill(json.message || "✓ Đã giải nén GM", "success");
    } catch (err: unknown) {
      setErrorBanner(
        err instanceof Error ? err.message : "Lỗi kết nối khi giải nén GameMaker."
      );
    } finally {
      setPreppingGm(false);
    }
  }, [data?.classId, showPill]);

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 space-y-4">
      <DemoTopBar
        classId={data?.classId || ""}
        classes={data?.runningClasses || []}
        mode={mode}
        statusPill={statusPill}
        busy={isLoading || isSaving || Boolean(launchingAction)}
        hasStudents={Boolean(data && data.students.length > 0)}
        onClassChange={(code) => void handleClassChange(code)}
        onClassesRefreshed={handleClassesRefreshed}
        onModeChange={setMode}
        onShuffle={() => void handleShuffle()}
      />

      {errorBanner && (
        <div
          data-testid="dd-error-banner"
          role="alert"
          className="dd-pill-error rounded-xl px-4 py-2.5 text-sm font-bold flex items-center justify-between gap-3"
        >
          <span>{errorBanner}</span>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="px-2 py-0.5 rounded text-xs font-extrabold cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {isLoading && !data ? (
        <div className="dd-shell-card rounded-2xl p-8 text-center text-sm font-semibold dd-muted">
          ⏳ Đang chuẩn bị dữ liệu Thi Demo...
        </div>
      ) : mode === "stage" ? (
        <DemoStageView
          students={data?.students || []}
          currentStudentId={data?.currentStudentId || ""}
          activeProcessCount={data?.activeProcessCount || 0}
          launchingAction={launchingAction}
          onSelectStudent={(id) => void handleSelectStudent(id)}
          onPrev={() => void handlePrev()}
          onNext={() => void handleNext()}
          onOpenSlide={(stu) => void handleOpenSlide(stu)}
          onRunProduct={(stu) => void handleRunProduct(stu, false)}
          onStopApps={() => void handleStopApps()}
        />
      ) : (
        <DemoPrepView
          students={data?.students || []}
          demoSheetUrl={data?.demoSheetUrl || ""}
          hasAnyGameMakerProject={Boolean(data?.hasAnyGameMakerProject)}
          busy={isLoading || isSaving || Boolean(launchingAction)}
          preppingGm={preppingGm}
          onMoveOrder={(idx, delta) => void handleMoveOrder(idx, delta)}
          onToggleExcluded={(sid, next) => void handleToggleExcluded(sid, next)}
          onSaveSlideUrl={(sid, url) => void handleSaveSlideUrl(sid, url)}
          onChangeEntry={(sid, val) => void handleChangeEntry(sid, val)}
          onTestRun={(stu) => void handleRunProduct(stu, true)}
          onPrepGameMakerAll={() => void handlePrepGameMakerAll()}
          onRefresh={() => void loadState(data?.classId)}
        />
      )}
    </div>
  );
}
