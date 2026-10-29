"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  computeClassReportCard,
  formatScore2,
  normalizeScoreToScale5,
  round2,
  type ClassReportCardLmsSnapshot,
  type ComputedClassReportCard,
  type ComputedStudentReportCardRow,
  type ManualScoreOverrideMap,
} from "@/lib/report-card/report-card-calculator";

export interface ReportCardDbRecordClient {
  classId: string;
  classCode: string;
  isRobotics: number;
  lmsSnapshotJson: string;
  manualOverridesJson: string;
  approvedSnapshotJson: string;
  status:
    | "DRAFT"
    | "WAITING_APPROVAL"
    | "APPROVED"
    | "SAVING"
    | "SYNCING"
    | "VERIFIED"
    | "FAILED";
  contentHash: string;
  draftVersion: number;
  lastSyncedAt: string | null;
  errorMessage: string | null;
  updatedAt: string;
}

export interface RunningClassOption {
  classCode: string;
  courseName?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}

export interface TeachingReportCardViewProps {
  classId: string;
  classCode: string;
  onSelectClass?: (nextClassCode: string) => void;
  scrapeTrigger?: string;
  onRequestScrapeLms?: () => Promise<{ success?: boolean; error?: string } | boolean | void> | void;
  isScrapingExternal?: boolean;
}

type ScaleDisplayMode = "scale5" | "raw";
type StageFilterMode = "all" | "cp1" | "cp2" | "cp1_cp2";
type SortField =
  | "default"
  | "fullName"
  | "btvnAvg"
  | "cp1Total"
  | "cp2Total"
  | "finalTotal"
  | "tbck"
  | "rank";
type SortDirection = "asc" | "desc";
type ChartStageKey = "cp1" | "cp2" | "final";

interface OverrideModalState {
  classId?: string;
  openedDraftVersion?: number | null;
  studentId: string;
  studentName: string;
  fieldKey: string;
  fieldLabel: string;
  isBtvnField: boolean;
  maxRawScore: number;
  currentNorm: number | null;
  currentRaw: number | null;
  lmsNorm: number | null;
  lmsRaw: number | null;
  isOverridden: boolean;
  note: string;
}

export function sanitizeReportCardTsvCell(value: string | number | null | undefined): string {
  const clean = String(value ?? "")
    .replace(/[\t\r\n]+/g, " ")
    .trim();
  if (/^[=+\-@]/.test(clean)) {
    return `'${clean}`;
  }
  return clean;
}

function getRankBadgeClass(rankCode: string): string {
  switch (rankCode) {
    case "A":
      return "bg-emerald-700 text-white border-emerald-500 mindx-dark-keep";
    case "B":
      return "bg-sky-700 text-white border-sky-500 mindx-dark-keep";
    case "C":
      return "bg-amber-700 text-white border-amber-500 mindx-dark-keep";
    case "D":
      return "bg-rose-700 text-white border-rose-500 mindx-dark-keep";
    default:
      return "bg-slate-700 text-white border-slate-500 mindx-dark-keep";
  }
}

function getStatusBadgeInfo(status?: string): { label: string; className: string } {
  switch (status) {
    case "VERIFIED":
      return {
        label: "ĐÃ ĐỒNG BỘ TEACHING (VERIFIED)",
        className: "bg-emerald-700 text-white border-emerald-500 mindx-dark-keep",
      };
    case "APPROVED":
      return {
        label: "ĐÃ DUYỆT (SẴN SÀNG ĐỒNG BỘ)",
        className: "bg-indigo-700 text-white border-indigo-500 mindx-dark-keep",
      };
    case "SAVING":
    case "SYNCING":
      return {
        label: "ĐANG ĐỒNG BỘ TEACHING...",
        className: "bg-sky-700 text-white border-sky-500 mindx-dark-keep",
      };
    case "FAILED":
      return {
        label: "ĐỒNG BỘ LỖI (CẦN KIỂM TRA)",
        className: "bg-rose-700 text-white border-rose-500 mindx-dark-keep",
      };
    case "WAITING_APPROVAL":
      return {
        label: "CHỜ DUYỆT LẠI",
        className: "bg-amber-700 text-white border-amber-500 mindx-dark-keep",
      };
    case "DRAFT":
    default:
      return {
        label: "BẢN NHÁP (CHƯA DUYỆT)",
        className: "bg-slate-700 text-white border-slate-500 mindx-dark-keep",
      };
  }
}

export default function TeachingReportCardView({
  classId,
  classCode,
  onSelectClass,
  scrapeTrigger,
  onRequestScrapeLms,
  isScrapingExternal = false,
}: TeachingReportCardViewProps) {
  const effectiveClassId = (classId || classCode || "").trim().toUpperCase();

  const [availableClasses, setAvailableClasses] = useState<RunningClassOption[]>([]);
  const [record, setRecord] = useState<ReportCardDbRecordClient | null>(null);
  const [snapshot, setSnapshot] = useState<ClassReportCardLmsSnapshot | null>(null);
  const [overrides, setOverrides] = useState<ManualScoreOverrideMap>({});
  const [serverReportCard, setServerReportCard] = useState<ComputedClassReportCard | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isScrapingLms, setIsScrapingLms] = useState<boolean>(false);
  const [isApproving, setIsApproving] = useState<boolean>(false);
  const [isSyncingTeaching, setIsSyncingTeaching] = useState<boolean>(false);
  const [isSavingOverride, setIsSavingOverride] = useState<boolean>(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Interactive UI controls matching teachingmindx.top/diem-tong-ket.php
  const [scaleMode, setScaleMode] = useState<ScaleDisplayMode>("scale5");
  const [stageFilter, setStageFilter] = useState<StageFilterMode>("all");
  const [selectedBtvnSessions, setSelectedBtvnSessions] = useState<number[] | null>(null);
  const [showBtvnFilterPopover, setShowBtvnFilterPopover] = useState<boolean>(false);
  const [sortField, setSortField] = useState<SortField>("default");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  // Modals
  const [showFormulaModal, setShowFormulaModal] = useState<boolean>(false);
  const [activeChartModal, setActiveChartModal] = useState<ChartStageKey | null>(null);
  const [chartVisibility, setChartVisibility] = useState<{
    c1: boolean;
    c2: boolean;
    c3: boolean;
    avg: boolean;
  }>({ c1: true, c2: true, c3: true, avg: true });

  const [overrideModal, setOverrideModal] = useState<OverrideModalState | null>(null);
  const [overrideInputMode, setOverrideInputMode] = useState<"scale5" | "raw">("scale5");
  const [overrideInputValue, setOverrideInputValue] = useState<string>("");
  const [overrideInputNote, setOverrideInputNote] = useState<string>("");

  const chartCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const loadReqIdRef = useRef<number>(0);
  const opGenRef = useRef<number>(0);
  const scrapeBusyReqRef = useRef<number>(0);
  const approveBusyReqRef = useRef<number>(0);
  const syncBusyReqRef = useRef<number>(0);
  const overrideBusyReqRef = useRef<number>(0);
  const activeClassIdRef = useRef<string>(effectiveClassId);
  activeClassIdRef.current = effectiveClassId;
  const lastEffectClassIdRef = useRef<string>("");
  const selectedBtvnClassRef = useRef<string>("");
  const latestVersionByClassRef = useRef<Record<string, number>>({});

  const applyApiPayload = useCallback(
    (data: any, expectedClassId: string, _isFromGet = false): boolean => {
      const cleanExpected = (expectedClassId || "").trim().toUpperCase();
      if (!cleanExpected || activeClassIdRef.current !== cleanExpected) {
        return false;
      }

      const payloadClassId = String(
        data?.record?.classId ||
          data?.snapshot?.classId ||
          data?.reportCard?.classId ||
          data?.classId ||
          ""
      )
        .trim()
        .toUpperCase();
      if (payloadClassId && payloadClassId !== cleanExpected) {
        return false;
      }

      const incomingVersion = Number(data?.record?.draftVersion);
      const knownVersion = latestVersionByClassRef.current[cleanExpected] ?? 0;
      if (
        Number.isFinite(incomingVersion) &&
        incomingVersion > 0 &&
        knownVersion > 0 &&
        incomingVersion < knownVersion
      ) {
        return false;
      }

      if (Number.isFinite(incomingVersion) && incomingVersion > 0) {
        latestVersionByClassRef.current[cleanExpected] = Math.max(
          knownVersion,
          incomingVersion
        );
      }

      if (Array.isArray(data?.classes)) {
        setAvailableClasses(data.classes);
      }
      if (data?.record) {
        setRecord(data.record);
      }
      if (data?.snapshot !== undefined) {
        setSnapshot(data.snapshot);
      }
      if (data?.overrides && typeof data.overrides === "object") {
        setOverrides(data.overrides);
      }
      if (data?.reportCard) {
        setServerReportCard(data.reportCard);
        if (Array.isArray(data.reportCard.btvnSessions)) {
          const availableSessionNums = data.reportCard.btvnSessions.map((s: any) =>
            Number(s.sessionNumber)
          );
          if (selectedBtvnClassRef.current !== cleanExpected) {
            selectedBtvnClassRef.current = cleanExpected;
            setSelectedBtvnSessions(availableSessionNums);
          } else {
            setSelectedBtvnSessions((prev) => {
              if (prev === null) return availableSessionNums;
              return prev.filter((n) => availableSessionNums.includes(n));
            });
          }
        }
      }
      return true;
    },
    []
  );

  const loadReportCard = useCallback(
    async (targetClassId: string): Promise<boolean> => {
      const cleanId = (targetClassId || "").trim().toUpperCase();
      if (!cleanId) return false;

      const reqId = ++loadReqIdRef.current;
      const startOpGen = opGenRef.current;
      setIsLoading(true);
      setErrorMsg(null);

      try {
        const res = await fetch(
          `/api/report-card?classId=${encodeURIComponent(cleanId)}`
        );
        const data = await res.json();
        if (
          reqId !== loadReqIdRef.current ||
          startOpGen !== opGenRef.current ||
          activeClassIdRef.current !== cleanId
        ) {
          return false;
        }

        if (res.ok === false || !data?.success) {
          setRecord(null);
          setSnapshot(null);
          setOverrides({});
          setServerReportCard(null);
          setOverrideModal(null);
          setErrorMsg(data?.error || `Không thể tải phiếu điểm lớp ${cleanId}.`);
          return false;
        }

        return applyApiPayload(data, cleanId, true);
      } catch (err: any) {
        if (
          reqId !== loadReqIdRef.current ||
          startOpGen !== opGenRef.current ||
          activeClassIdRef.current !== cleanId
        ) {
          return false;
        }
        setRecord(null);
        setSnapshot(null);
        setOverrides({});
        setServerReportCard(null);
        setOverrideModal(null);
        setErrorMsg(err?.message || "Lỗi kết nối khi tải Phiếu điểm tổng kết.");
        return false;
      } finally {
        if (
          reqId === loadReqIdRef.current &&
          startOpGen === opGenRef.current &&
          activeClassIdRef.current === cleanId
        ) {
          setIsLoading(false);
        }
      }
    },
    [applyApiPayload]
  );

  useEffect(() => {
    const classChanged = lastEffectClassIdRef.current !== effectiveClassId;
    if (classChanged) {
      lastEffectClassIdRef.current = effectiveClassId;
      opGenRef.current += 1;
      loadReqIdRef.current += 1;
      scrapeBusyReqRef.current += 1;
      approveBusyReqRef.current += 1;
      syncBusyReqRef.current += 1;
      overrideBusyReqRef.current += 1;
      selectedBtvnClassRef.current = "";
      delete latestVersionByClassRef.current[effectiveClassId];

      setRecord(null);
      setSnapshot(null);
      setOverrides({});
      setServerReportCard(null);
      setSelectedBtvnSessions(null);
      setShowBtvnFilterPopover(false);
      setOverrideModal(null);
      setErrorMsg(null);
      setToastMsg(null);
      setIsApproving(false);
      setIsSyncingTeaching(false);
      setIsSavingOverride(false);
      setIsScrapingLms(false);
    }

    if (effectiveClassId) {
      void loadReportCard(effectiveClassId);
    }
  }, [effectiveClassId, scrapeTrigger, loadReportCard]);

  // Instant client-side recalculation when teacher filters BTVN sessions.
  // Explicitly distinguishes omitted filter (`null` -> all sessions) from empty array (`[]` -> 0 sessions).
  const computedReportCard = useMemo<ComputedClassReportCard | null>(() => {
    if (
      !effectiveClassId ||
      !record ||
      record.classId?.trim().toUpperCase() !== effectiveClassId
    ) {
      return null;
    }

    if (snapshot && snapshot.classId?.trim().toUpperCase() === effectiveClassId) {
      if (selectedBtvnSessions === null) {
        return computeClassReportCard(snapshot, overrides);
      }

      const availableSet = new Set(
        (snapshot.btvnSessions || []).map((s) => Number(s.sessionNumber))
      );
      const validSelected = selectedBtvnSessions.filter((n) =>
        availableSet.has(Number(n))
      );

      if (validSelected.length === 0) {
        const base = computeClassReportCard(snapshot, overrides);
        return {
          ...base,
          activeBtvnSessionNumbers: [],
          students: base.students.map((stu) => ({
            ...stu,
            submittedCount: 0,
            totalAssignedItems: 0,
            btvnAvgNorm: null,
            btvnAvgRaw: null,
            isBtvnAvgLow: false,
          })),
        };
      }

      return computeClassReportCard(snapshot, overrides, {
        selectedBtvnSessions: validSelected,
      });
    }

    if (
      serverReportCard &&
      serverReportCard.classId?.trim().toUpperCase() === effectiveClassId
    ) {
      return serverReportCard;
    }
    return null;
  }, [effectiveClassId, record, snapshot, overrides, selectedBtvnSessions, serverReportCard]);

  const isClassMatched = Boolean(
    effectiveClassId &&
      record &&
      record.classId?.trim().toUpperCase() === effectiveClassId &&
      snapshot &&
      snapshot.classId?.trim().toUpperCase() === effectiveClassId &&
      computedReportCard &&
      computedReportCard.classId?.trim().toUpperCase() === effectiveClassId
  );

  const sortedStudents = useMemo<ComputedStudentReportCardRow[]>(() => {
    const list = computedReportCard?.students ? [...computedReportCard.students] : [];
    if (sortField === "default") return list;

    const rankOrder: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, "": 0 };
    const dir = sortDirection === "asc" ? 1 : -1;

    list.sort((a, b) => {
      if (sortField === "fullName") {
        return a.fullName.localeCompare(b.fullName, "vi") * dir;
      }
      if (sortField === "rank") {
        const ra = rankOrder[a.rankCode] ?? 0;
        const rb = rankOrder[b.rankCode] ?? 0;
        if (ra !== rb) return (ra - rb) * dir;
        return ((a.tbck ?? -1) - (b.tbck ?? -1)) * dir;
      }

      let va: number | null = null;
      let vb: number | null = null;
      if (sortField === "btvnAvg") {
        va = scaleMode === "raw" ? a.btvnAvgRaw : a.btvnAvgNorm;
        vb = scaleMode === "raw" ? b.btvnAvgRaw : b.btvnAvgNorm;
      } else if (sortField === "cp1Total") {
        va = a.cp1.total;
        vb = b.cp1.total;
      } else if (sortField === "cp2Total") {
        va = a.cp2.total;
        vb = b.cp2.total;
      } else if (sortField === "finalTotal") {
        va = a.final.total;
        vb = b.final.total;
      } else if (sortField === "tbck") {
        va = a.tbck;
        vb = b.tbck;
      }

      const na = va === null || va === undefined ? -999 : va;
      const nb = vb === null || vb === undefined ? -999 : vb;
      if (na !== nb) return (na - nb) * dir;
      return a.index - b.index;
    });

    return list;
  }, [computedReportCard, sortField, sortDirection, scaleMode]);

  const handleSortColumn = (field: SortField) => {
    if (sortField !== field) {
      setSortField(field);
      setSortDirection("desc");
    } else if (sortDirection === "desc") {
      setSortDirection("asc");
    } else {
      setSortField("default");
    }
  };

  const renderSortIndicator = (field: SortField) => {
    if (sortField !== field) return <span className="opacity-40 ml-1">⇅</span>;
    return <span className="ml-1 text-amber-300">{sortDirection === "asc" ? "▲" : "▼"}</span>;
  };

  const handleScrapeFromLms = async () => {
    const targetClassId = activeClassIdRef.current;
    if (!targetClassId) return;

    const myOpGen = ++opGenRef.current;
    const myBusyId = ++scrapeBusyReqRef.current;
    loadReqIdRef.current += 1;
    setIsLoading(false);
    setIsScrapingLms(true);
    setErrorMsg(null);
    setToastMsg(null);

    try {
      if (onRequestScrapeLms) {
        const extResult = await onRequestScrapeLms();
        if (
          activeClassIdRef.current !== targetClassId ||
          myOpGen !== opGenRef.current
        ) {
          return;
        }
        if (
          extResult === false ||
          (extResult &&
            typeof extResult === "object" &&
            extResult.success === false)
        ) {
          setErrorMsg(
            (extResult && typeof extResult === "object" && extResult.error) ||
              `Không thể quét dữ liệu điểm từ LMS cho lớp ${targetClassId}.`
          );
          return;
        }
      } else {
        const res = await fetch("/api/report-card", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "scrape_lms",
            classId: targetClassId,
            classCode: targetClassId,
          }),
        });
        const data = await res.json();
        if (
          activeClassIdRef.current !== targetClassId ||
          myOpGen !== opGenRef.current
        ) {
          return;
        }
        const accepted = applyApiPayload(data, targetClassId, false);
        if (res.ok === false || !data?.success) {
          setErrorMsg(data?.error || "Không thể quét dữ liệu điểm từ LMS.");
          return;
        }
        if (!accepted) {
          return;
        }
      }

      const reloaded = await loadReportCard(targetClassId);
      if (
        !reloaded ||
        activeClassIdRef.current !== targetClassId ||
        myOpGen !== opGenRef.current
      ) {
        return;
      }
      setToastMsg(
        `Đã quét & tính toán Phiếu điểm tổng kết lớp ${targetClassId} từ LMS!`
      );
    } catch (err: any) {
      if (
        activeClassIdRef.current !== targetClassId ||
        myOpGen !== opGenRef.current
      ) {
        return;
      }
      setErrorMsg(err?.message || "Lỗi kết nối khi quét điểm từ LMS.");
    } finally {
      if (
        activeClassIdRef.current === targetClassId &&
        scrapeBusyReqRef.current === myBusyId
      ) {
        setIsScrapingLms(false);
      }
    }
  };

  const handleApproveReportCard = async () => {
    const targetClassId = activeClassIdRef.current;
    if (
      !targetClassId ||
      !isClassMatched ||
      !record ||
      record.classId?.trim().toUpperCase() !== targetClassId
    ) {
      return;
    }

    const expectedVersion = record.draftVersion;
    const myOpGen = ++opGenRef.current;
    const myBusyId = ++approveBusyReqRef.current;
    loadReqIdRef.current += 1;
    setIsLoading(false);
    setIsApproving(true);
    setErrorMsg(null);
    setToastMsg(null);

    try {
      const res = await fetch("/api/report-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          classId: targetClassId,
          classCode: targetClassId,
          expectedVersion,
        }),
      });
      const data = await res.json();
      if (
        activeClassIdRef.current !== targetClassId ||
        myOpGen !== opGenRef.current
      ) {
        return;
      }

      const accepted = applyApiPayload(data, targetClassId, false);

      if (res.ok === false || !data?.success) {
        setErrorMsg(
          data?.error ||
            "Không thể duyệt Phiếu điểm. Dữ liệu đã được làm mới, vui lòng kiểm tra lại."
        );
        return;
      }
      if (!accepted) {
        return;
      }
      setToastMsg(
        `Đã duyệt Phiếu điểm lớp ${targetClassId} (SHA-256: ${String(
          data.record?.contentHash || ""
        ).slice(0, 10)}...). Sẵn sàng đồng bộ lên Teaching!`
      );
    } catch (err: any) {
      if (
        activeClassIdRef.current !== targetClassId ||
        myOpGen !== opGenRef.current
      ) {
        return;
      }
      setErrorMsg(err?.message || "Lỗi kết nối khi duyệt Phiếu điểm.");
    } finally {
      if (
        activeClassIdRef.current === targetClassId &&
        approveBusyReqRef.current === myBusyId
      ) {
        setIsApproving(false);
      }
    }
  };

  const handleSyncToTeaching = async () => {
    const targetClassId = activeClassIdRef.current;
    if (
      !targetClassId ||
      !isClassMatched ||
      !record ||
      record.classId?.trim().toUpperCase() !== targetClassId
    ) {
      return;
    }

    const expectedVersion = record.draftVersion;
    const myOpGen = ++opGenRef.current;
    const myBusyId = ++syncBusyReqRef.current;
    loadReqIdRef.current += 1;
    setIsLoading(false);
    setIsSyncingTeaching(true);
    setErrorMsg(null);
    setToastMsg(null);

    try {
      const res = await fetch("/api/report-card/sync-teaching", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: targetClassId,
          classCode: targetClassId,
          expectedVersion,
        }),
      });
      const data = await res.json();
      if (
        activeClassIdRef.current !== targetClassId ||
        myOpGen !== opGenRef.current
      ) {
        return;
      }

      const accepted = applyApiPayload(data, targetClassId, false);

      if (res.ok === false || !data?.success) {
        setErrorMsg(
          data?.error || "Đồng bộ điểm lên trang Teaching không thành công."
        );
        return;
      }
      if (!accepted) {
        return;
      }
      setToastMsg(
        `Đồng bộ & Xác thực Read-after-Write thành công ${
          data.syncedScoreCount ?? 0
        } đầu điểm lên trang Teaching cho lớp ${targetClassId}!`
      );
    } catch (err: any) {
      if (
        activeClassIdRef.current !== targetClassId ||
        myOpGen !== opGenRef.current
      ) {
        return;
      }
      setErrorMsg(err?.message || "Lỗi kết nối khi đồng bộ điểm lên Teaching.");
    } finally {
      if (
        activeClassIdRef.current === targetClassId &&
        syncBusyReqRef.current === myBusyId
      ) {
        setIsSyncingTeaching(false);
      }
    }
  };

  const openOverrideEditor = (info: OverrideModalState) => {
    const targetClassId = activeClassIdRef.current;
    if (
      !targetClassId ||
      !isClassMatched ||
      isLoading ||
      !record ||
      record.classId?.trim().toUpperCase() !== targetClassId
    ) {
      return;
    }

    const modalWithContext: OverrideModalState = {
      ...info,
      classId: info.classId || targetClassId,
      openedDraftVersion:
        info.openedDraftVersion !== undefined && info.openedDraftVersion !== null
          ? info.openedDraftVersion
          : record.draftVersion,
    };

    setOverrideModal(modalWithContext);
    if (info.isBtvnField && scaleMode === "raw") {
      setOverrideInputMode("raw");
      setOverrideInputValue(
        info.currentRaw !== null && info.currentRaw !== undefined
          ? String(info.currentRaw)
          : ""
      );
    } else {
      setOverrideInputMode("scale5");
      setOverrideInputValue(
        info.currentNorm !== null && info.currentNorm !== undefined
          ? String(info.currentNorm)
          : ""
      );
    }
    setOverrideInputNote(info.note || "");
  };

  const handleSaveManualOverride = async () => {
    const targetClassId = activeClassIdRef.current;
    if (
      !overrideModal ||
      !targetClassId ||
      !isClassMatched ||
      !record ||
      record.classId?.trim().toUpperCase() !== targetClassId
    ) {
      return;
    }

    const modalClassId = (overrideModal.classId || targetClassId)
      .trim()
      .toUpperCase();
    if (modalClassId !== targetClassId) {
      setOverrideModal(null);
      setErrorMsg("Lớp học đã thay đổi. Vui lòng mở lại ô điểm cần chỉnh sửa.");
      return;
    }

    const expectedVersion =
      overrideModal.openedDraftVersion !== undefined &&
      overrideModal.openedDraftVersion !== null
        ? overrideModal.openedDraftVersion
        : record.draftVersion;

    if (record.draftVersion !== expectedVersion) {
      setErrorMsg(
        `Dữ liệu bảng điểm đã thay đổi sang phiên bản mới (v${record.draftVersion} so với v${expectedVersion} lúc mở ô điểm). Vui lòng đóng và mở lại ô điểm để kiểm tra điểm mới nhất trước khi lưu.`
      );
      return;
    }

    const trimmedVal = overrideInputValue.trim();
    const numericVal = trimmedVal === "" ? null : Number(trimmedVal);
    if (numericVal !== null && !Number.isFinite(numericVal)) {
      setErrorMsg("Điểm nhập vào phải là một số hợp lệ.");
      return;
    }

    let normScore: number | null = null;
    let rawScore: number | null | undefined = undefined;
    const maxScore = overrideModal.maxRawScore || 100;

    if (numericVal !== null) {
      if (overrideModal.isBtvnField && overrideInputMode === "raw") {
        if (numericVal < 0 || numericVal > maxScore) {
          setErrorMsg(`Điểm gốc phải nằm trong khoảng 0 đến ${maxScore}.`);
          return;
        }
        rawScore = round2(numericVal);
        normScore = normalizeScoreToScale5(rawScore, maxScore);
      } else {
        if (numericVal < 0 || numericVal > 5) {
          setErrorMsg("Điểm thang 5 phải nằm trong khoảng 0.00 đến 5.00.");
          return;
        }
        normScore = round2(numericVal);
        if (overrideModal.isBtvnField) {
          rawScore = round2((normScore / 5) * maxScore);
        }
      }
    }

    const myOpGen = ++opGenRef.current;
    const myBusyId = ++overrideBusyReqRef.current;
    loadReqIdRef.current += 1;
    setIsLoading(false);
    setIsSavingOverride(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/report-card", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_override",
          classId: targetClassId,
          classCode: targetClassId,
          expectedVersion,
          updates: [
            {
              studentId: overrideModal.studentId,
              fieldKey: overrideModal.fieldKey,
              normScore,
              ...(rawScore !== undefined ? { rawScore, maxScore } : {}),
              note: overrideInputNote.trim(),
            },
          ],
        }),
      });
      const data = await res.json();
      if (
        activeClassIdRef.current !== targetClassId ||
        myOpGen !== opGenRef.current
      ) {
        return;
      }

      const accepted = applyApiPayload(data, targetClassId, false);

      if (res.ok === false || !data?.success) {
        setErrorMsg(data?.error || "Không thể lưu điểm chỉnh sửa thủ công.");
        return;
      }
      if (!accepted) {
        return;
      }

      setOverrideModal(null);
      setToastMsg(
        `Đã cập nhật điểm ${overrideModal.fieldLabel} cho ${overrideModal.studentName}.`
      );
    } catch (err: any) {
      if (
        activeClassIdRef.current !== targetClassId ||
        myOpGen !== opGenRef.current
      ) {
        return;
      }
      setErrorMsg(err?.message || "Lỗi kết nối khi lưu điểm chỉnh sửa.");
    } finally {
      if (
        activeClassIdRef.current === targetClassId &&
        overrideBusyReqRef.current === myBusyId
      ) {
        setIsSavingOverride(false);
      }
    }
  };

  const handleClearSingleOverride = async () => {
    const targetClassId = activeClassIdRef.current;
    if (
      !overrideModal ||
      !targetClassId ||
      !isClassMatched ||
      !record ||
      record.classId?.trim().toUpperCase() !== targetClassId
    ) {
      return;
    }

    const modalClassId = (overrideModal.classId || targetClassId)
      .trim()
      .toUpperCase();
    if (modalClassId !== targetClassId) {
      setOverrideModal(null);
      setErrorMsg("Lớp học đã thay đổi. Vui lòng mở lại ô điểm cần khôi phục.");
      return;
    }

    const expectedVersion =
      overrideModal.openedDraftVersion !== undefined &&
      overrideModal.openedDraftVersion !== null
        ? overrideModal.openedDraftVersion
        : record.draftVersion;

    if (record.draftVersion !== expectedVersion) {
      setErrorMsg(
        `Dữ liệu bảng điểm đã thay đổi sang phiên bản mới (v${record.draftVersion} so với v${expectedVersion} lúc mở ô điểm). Vui lòng đóng và mở lại ô điểm để kiểm tra trước khi khôi phục.`
      );
      return;
    }

    const myOpGen = ++opGenRef.current;
    const myBusyId = ++overrideBusyReqRef.current;
    loadReqIdRef.current += 1;
    setIsLoading(false);
    setIsSavingOverride(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/report-card", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "clear_override",
          classId: targetClassId,
          classCode: targetClassId,
          expectedVersion,
          studentId: overrideModal.studentId,
          fieldKey: overrideModal.fieldKey,
        }),
      });
      const data = await res.json();
      if (
        activeClassIdRef.current !== targetClassId ||
        myOpGen !== opGenRef.current
      ) {
        return;
      }

      const accepted = applyApiPayload(data, targetClassId, false);

      if (res.ok === false || !data?.success) {
        setErrorMsg(data?.error || "Không thể khôi phục điểm gốc LMS.");
        return;
      }
      if (!accepted) {
        return;
      }
      setOverrideModal(null);
      setToastMsg(
        `Đã khôi phục điểm gốc LMS cho ${overrideModal.fieldLabel} (${overrideModal.studentName}).`
      );
    } catch (err: any) {
      if (
        activeClassIdRef.current !== targetClassId ||
        myOpGen !== opGenRef.current
      ) {
        return;
      }
      setErrorMsg(err?.message || "Lỗi kết nối khi khôi phục điểm gốc LMS.");
    } finally {
      if (
        activeClassIdRef.current === targetClassId &&
        overrideBusyReqRef.current === myBusyId
      ) {
        setIsSavingOverride(false);
      }
    }
  };

  const handleResetAllOverrides = async () => {
    const targetClassId = activeClassIdRef.current;
    if (
      !targetClassId ||
      !isClassMatched ||
      !record ||
      record.classId?.trim().toUpperCase() !== targetClassId
    ) {
      return;
    }

    const expectedVersion = record.draftVersion;
    const myOpGen = ++opGenRef.current;
    const myBusyId = ++overrideBusyReqRef.current;
    loadReqIdRef.current += 1;
    setIsLoading(false);
    setIsSavingOverride(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/report-card", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reset_all_overrides",
          classId: targetClassId,
          classCode: targetClassId,
          expectedVersion,
        }),
      });
      const data = await res.json();
      if (
        activeClassIdRef.current !== targetClassId ||
        myOpGen !== opGenRef.current
      ) {
        return;
      }

      const accepted = applyApiPayload(data, targetClassId, false);

      if (res.ok === false || !data?.success) {
        setErrorMsg(data?.error || "Không thể khôi phục toàn bộ điểm LMS.");
        return;
      }
      if (!accepted) {
        return;
      }
      setToastMsg("Đã khôi phục toàn bộ bảng điểm về đúng điểm gốc trên LMS!");
    } catch (err: any) {
      if (
        activeClassIdRef.current !== targetClassId ||
        myOpGen !== opGenRef.current
      ) {
        return;
      }
      setErrorMsg(err?.message || "Lỗi kết nối khi đặt lại điểm LMS.");
    } finally {
      if (
        activeClassIdRef.current === targetClassId &&
        overrideBusyReqRef.current === myBusyId
      ) {
        setIsSavingOverride(false);
      }
    }
  };

  // Copy TSV for Google Sheets
  const handleCopyTsvToSheets = async () => {
    if (!isClassMatched || isLoading || !computedReportCard || sortedStudents.length === 0) {
      return;
    }
    const activeSessions = computedReportCard.btvnSessions.filter((s) =>
      computedReportCard.activeBtvnSessionNumbers.includes(s.sessionNumber)
    );
    const showBtvn = computedReportCard.showBtvnBlock;

    const headers: string[] = ["STT", "Mã HV", "Họ và tên"];
    if (showBtvn) {
      for (const s of activeSessions) {
        headers.push(`B${s.sessionNumber} LT`, `B${s.sessionNumber} TH`);
      }
      headers.push("BTVN Đã làm", "ĐTB BTVN");
    }
    headers.push(
      "CP1 LT",
      "CP1 TH",
      "CP1 NL",
      "CP1 TB LT+TH",
      "CP1 Tổng",
      "CP2 LT",
      "CP2 TH",
      "CP2 NL",
      "CP2 TB LT+TH",
      "CP2 Tổng",
      "DEMO Sản phẩm",
      "DEMO Năng lực",
      "DEMO Tổng",
      "Điểm TBCK",
      "Xếp loại",
      "Hạng"
    );

    const lines: string[] = [headers.map(sanitizeReportCardTsvCell).join("\t")];

    for (const row of sortedStudents) {
      const cols: Array<string | number> = [
        row.index,
        row.studentId,
        row.fullName,
      ];
      if (showBtvn) {
        for (const s of activeSessions) {
          const cell = row.btvnCells[s.sessionNumber];
          const ltVal =
            scaleMode === "raw"
              ? cell?.theoryRaw !== null && cell?.theoryRaw !== undefined
                ? String(cell.theoryRaw)
                : "-"
              : formatScore2(cell?.theoryNorm);
          const thVal =
            scaleMode === "raw"
              ? cell?.practiceRaw !== null && cell?.practiceRaw !== undefined
                ? String(cell.practiceRaw)
                : "-"
              : formatScore2(cell?.practiceNorm);
          cols.push(ltVal, thVal);
        }
        cols.push(
          `${row.submittedCount}/${row.totalAssignedItems}`,
          scaleMode === "raw"
            ? formatScore2(row.btvnAvgRaw)
            : formatScore2(row.btvnAvgNorm)
        );
      }
      cols.push(
        formatScore2(row.cp1.theory.value),
        formatScore2(row.cp1.practice.value),
        formatScore2(row.cp1.competency.value),
        formatScore2(row.cp1.avgLtTh),
        formatScore2(row.cp1.total),
        formatScore2(row.cp2.theory.value),
        formatScore2(row.cp2.practice.value),
        formatScore2(row.cp2.competency.value),
        formatScore2(row.cp2.avgLtTh),
        formatScore2(row.cp2.total),
        formatScore2(row.final.product.value),
        formatScore2(row.final.competency.value),
        formatScore2(row.final.total),
        formatScore2(row.tbck),
        row.xepLoai || "-",
        row.hang || "-"
      );
      lines.push(cols.map(sanitizeReportCardTsvCell).join("\t"));
    }

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setToastMsg(
        "Đã copy toàn bộ Phiếu điểm tổng kết! Mở Google Sheets và nhấn Ctrl+V để dán."
      );
    } catch {
      setErrorMsg("Trình duyệt chặn quyền truy cập Clipboard.");
    }
  };

  // High-DPI Canvas Table-to-PNG Renderer for Zalo ("Copy ảnh BTVN" & "Copy ảnh Tổng kết")
  const handleCopyBlockImageToZalo = async (blockType: "btvn" | "summary") => {
    if (!isClassMatched || isLoading || !computedReportCard || sortedStudents.length === 0) {
      return;
    }

    const canvas = document.createElement("canvas");
    const dpr = 2;

    if (blockType === "btvn") {
      const activeSessions = computedReportCard.btvnSessions.filter((s) =>
        computedReportCard.activeBtvnSessionNumbers.includes(s.sessionNumber)
      );
      const colWidths = [48, 210, ...activeSessions.flatMap(() => [64, 64]), 90, 82];
      const totalWidth = colWidths.reduce((a, b) => a + b, 0) + 32;
      const rowHeight = 34;
      const headerHeight = 112;
      const totalHeight = headerHeight + sortedStudents.length * rowHeight + 24;

      canvas.width = totalWidth * dpr;
      canvas.height = totalHeight * dpr;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);

      // Background
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, totalWidth, totalHeight);

      // Title banner
      ctx.fillStyle = "#172554";
      ctx.fillRect(16, 12, totalWidth - 32, 42);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 15px Segoe UI, Arial, sans-serif";
      ctx.fillText(
        `BẢNG ĐIỂM BÀI TẬP VỀ NHÀ (BTVN) — LỚP ${computedReportCard.classCode} (${
          scaleMode === "raw" ? "THANG 100" : "THANG 5.0"
        })`,
        28,
        38
      );

      // Table Header
      const tableTop = 58;
      ctx.fillStyle = "#1e3a8a";
      ctx.fillRect(16, tableTop, totalWidth - 32, 48);
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 1;

      let cx = 16;
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 12px Segoe UI, Arial, sans-serif";
      ctx.fillText("STT", cx + 10, tableTop + 28);
      cx += colWidths[0];
      ctx.fillText("Họ và tên học viên", cx + 10, tableTop + 28);
      cx += colWidths[1];

      activeSessions.forEach((s, idx) => {
        const w = colWidths[2 + idx * 2] + colWidths[3 + idx * 2];
        ctx.fillText(`Buổi ${s.sessionNumber}`, cx + w / 2 - 22, tableTop + 18);
        ctx.font = "bold 11px Segoe UI, Arial, sans-serif";
        ctx.fillText("LT", cx + 22, tableTop + 38);
        ctx.fillText("TH", cx + colWidths[2 + idx * 2] + 22, tableTop + 38);
        ctx.font = "bold 12px Segoe UI, Arial, sans-serif";
        cx += w;
      });

      ctx.fillText("Đã làm", cx + 16, tableTop + 28);
      cx += colWidths[colWidths.length - 2];
      ctx.fillText("ĐTB", cx + 24, tableTop + 28);

      // Rows
      sortedStudents.forEach((row, rIdx) => {
        const ry = tableTop + 48 + rIdx * rowHeight;
        ctx.fillStyle = rIdx % 2 === 0 ? "#ffffff" : "#f8fafc";
        ctx.fillRect(16, ry, totalWidth - 32, rowHeight);
        ctx.strokeStyle = "#e2e8f0";
        ctx.strokeRect(16, ry, totalWidth - 32, rowHeight);

        let rx = 16;
        ctx.fillStyle = "#0f172a";
        ctx.font = "12px Segoe UI, Arial, sans-serif";
        ctx.fillText(String(row.index), rx + 14, ry + 22);
        rx += colWidths[0];

        ctx.font = "bold 12px Segoe UI, Arial, sans-serif";
        ctx.fillText(row.fullName.slice(0, 26), rx + 8, ry + 22);
        rx += colWidths[1];

        ctx.font = "12px Segoe UI, Arial, sans-serif";
        activeSessions.forEach((s, idx) => {
          const cell = row.btvnCells[s.sessionNumber];
          const wLt = colWidths[2 + idx * 2];
          const wTh = colWidths[3 + idx * 2];

          if (cell?.isTheoryLow) {
            ctx.fillStyle = "#fee2e2";
            ctx.fillRect(rx + 1, ry + 1, wLt - 2, rowHeight - 2);
          }
          ctx.fillStyle = cell?.isTheoryLow ? "#b91c1c" : "#0f172a";
          const ltStr =
            scaleMode === "raw"
              ? cell?.theoryRaw !== null && cell?.theoryRaw !== undefined
                ? String(cell.theoryRaw)
                : "-"
              : formatScore2(cell?.theoryNorm);
          ctx.fillText(ltStr, rx + 14, ry + 22);
          rx += wLt;

          if (cell?.isPracticeLow) {
            ctx.fillStyle = "#fee2e2";
            ctx.fillRect(rx + 1, ry + 1, wTh - 2, rowHeight - 2);
          }
          ctx.fillStyle = cell?.isPracticeLow ? "#b91c1c" : "#0f172a";
          const thStr =
            scaleMode === "raw"
              ? cell?.practiceRaw !== null && cell?.practiceRaw !== undefined
                ? String(cell.practiceRaw)
                : "-"
              : formatScore2(cell?.practiceNorm);
          ctx.fillText(thStr, rx + 14, ry + 22);
          rx += wTh;
        });

        ctx.fillStyle = "#334155";
        ctx.fillText(
          `${row.submittedCount}/${row.totalAssignedItems}`,
          rx + 18,
          ry + 22
        );
        rx += colWidths[colWidths.length - 2];

        ctx.font = "bold 12px Segoe UI, Arial, sans-serif";
        ctx.fillStyle = row.isBtvnAvgLow ? "#b91c1c" : "#0f172a";
        ctx.fillText(
          scaleMode === "raw"
            ? formatScore2(row.btvnAvgRaw)
            : formatScore2(row.btvnAvgNorm),
          rx + 18,
          ry + 22
        );
      });
    } else {
      // Summary Table Image (CP1, CP2, Final DEMO, TBCK, Xếp loại, Hạng)
      const colWidths = [
        44, 200, 56, 56, 56, 62, 62, 56, 56, 56, 62, 62, 62, 56, 62, 72, 92, 82,
      ];
      const totalWidth = colWidths.reduce((a, b) => a + b, 0) + 32;
      const rowHeight = 34;
      const headerHeight = 112;
      const totalHeight = headerHeight + sortedStudents.length * rowHeight + 24;

      canvas.width = totalWidth * dpr;
      canvas.height = totalHeight * dpr;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, totalWidth, totalHeight);

      ctx.fillStyle = "#172554";
      ctx.fillRect(16, 12, totalWidth - 32, 42);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 15px Segoe UI, Arial, sans-serif";
      ctx.fillText(
        `PHIẾU ĐIỂM TỔNG KẾT & XẾP HẠNG CUỐI KHÓA — LỚP ${computedReportCard.classCode}`,
        28,
        38
      );

      const tableTop = 58;
      ctx.fillStyle = "#1e3a8a";
      ctx.fillRect(16, tableTop, totalWidth - 32, 48);

      const subHeaders = [
        "STT",
        "Họ và tên",
        "CP1 LT",
        "CP1 TH",
        "CP1 NL",
        "CP1 TB",
        "CP1 Tổng",
        "CP2 LT",
        "CP2 TH",
        "CP2 NL",
        "CP2 TB",
        "CP2 Tổng",
        "DEMO SP",
        "DEMO NL",
        "DEMO Tổng",
        "TBCK",
        "Xếp loại",
        "Hạng",
      ];
      let cx = 16;
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 11px Segoe UI, Arial, sans-serif";
      subHeaders.forEach((h, idx) => {
        ctx.fillText(h, cx + 6, tableTop + 28);
        cx += colWidths[idx];
      });

      sortedStudents.forEach((row, rIdx) => {
        const ry = tableTop + 48 + rIdx * rowHeight;
        const rankBg =
          row.rankCode === "A"
            ? "#ecfdf5"
            : row.rankCode === "B"
            ? "#f0f9ff"
            : row.rankCode === "C"
            ? "#fffbeb"
            : row.rankCode === "D"
            ? "#fff1f2"
            : "#ffffff";
        ctx.fillStyle = rankBg;
        ctx.fillRect(16, ry, totalWidth - 32, rowHeight);
        ctx.strokeStyle = "#cbd5e1";
        ctx.strokeRect(16, ry, totalWidth - 32, rowHeight);

        const cells = [
          String(row.index),
          row.fullName.slice(0, 25),
          formatScore2(row.cp1.theory.value),
          formatScore2(row.cp1.practice.value),
          formatScore2(row.cp1.competency.value),
          formatScore2(row.cp1.avgLtTh),
          formatScore2(row.cp1.total),
          formatScore2(row.cp2.theory.value),
          formatScore2(row.cp2.practice.value),
          formatScore2(row.cp2.competency.value),
          formatScore2(row.cp2.avgLtTh),
          formatScore2(row.cp2.total),
          formatScore2(row.final.product.value),
          formatScore2(row.final.competency.value),
          formatScore2(row.final.total),
          formatScore2(row.tbck),
          row.xepLoai || "-",
          row.hang || "-",
        ];

        let rx = 16;
        cells.forEach((val, cIdx) => {
          ctx.font =
            cIdx === 1 || cIdx === 6 || cIdx === 11 || cIdx >= 14
              ? "bold 11.5px Segoe UI, Arial, sans-serif"
              : "11.5px Segoe UI, Arial, sans-serif";
          ctx.fillStyle =
            cIdx === 15 && row.isTbckLow
              ? "#b91c1c"
              : cIdx === 17 && row.rankCode === "A"
              ? "#047857"
              : cIdx === 17 && row.rankCode === "D"
              ? "#be123c"
              : "#0f172a";
          ctx.fillText(val, rx + 6, ry + 22);
          rx += colWidths[cIdx];
        });
      });
    }

    try {
      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png")
      );
      if (
        blob &&
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof window !== "undefined" &&
        "ClipboardItem" in window
      ) {
        const ClipboardItemCtor = (window as any).ClipboardItem;
        await navigator.clipboard.write([new ClipboardItemCtor({ "image/png": blob })]);
        setToastMsg(
          blockType === "btvn"
            ? "Đã copy ảnh Bảng điểm BTVN vào Clipboard! Bạn có thể Ctrl+V dán trực tiếp vào Zalo."
            : "Đã copy ảnh Bảng điểm Tổng kết vào Clipboard! Bạn có thể Ctrl+V dán trực tiếp vào Zalo."
        );
        return;
      }
    } catch {
      // Fallback to PNG download if clipboard image write is blocked
    }

    const link = document.createElement("a");
    link.download =
      blockType === "btvn"
        ? `BangDiem_BTVN_${computedReportCard.classCode}.png`
        : `PhieuDiem_TongKet_${computedReportCard.classCode}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    setToastMsg("Đã tải xuống ảnh PNG chất lượng cao để gửi Zalo!");
  };

  // Render Chart.js-style Bar + Line + 2.5 Threshold on <canvas> when Chart Modal is open
  useEffect(() => {
    if (!activeChartModal || !computedReportCard || !chartCanvasRef.current) return;

    const canvas = chartCanvasRef.current;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2;
    const width = 880;
    const height = 430;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    // Clear background
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, width, height);

    const labels = computedReportCard.chartData.labels || [];
    const n = labels.length;
    const padLeft = 56;
    const padRight = 32;
    const padTop = 58;
    const padBottom = 95;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    // Title
    const stageTitle =
      activeChartModal === "cp1"
        ? `BIỂU ĐỒ ĐIỂM CHECK-POINT 1 — LỚP ${computedReportCard.classCode}`
        : activeChartModal === "cp2"
        ? `BIỂU ĐỒ ĐIỂM CHECK-POINT 2 — LỚP ${computedReportCard.classCode}`
        : `BIỂU ĐỒ ĐIỂM CUỐI KHÓA (DEMO) — LỚP ${computedReportCard.classCode}`;

    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 15px Segoe UI, Arial, sans-serif";
    ctx.fillText(stageTitle, padLeft, 32);

    // Y-axis grid (0.0 to 5.0)
    for (let yVal = 0; yVal <= 5; yVal += 1) {
      const y = padTop + plotH - (yVal / 5) * plotH;
      ctx.strokeStyle = "#1e293b";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);
      ctx.stroke();

      ctx.fillStyle = "#94a3b8";
      ctx.font = "11px Segoe UI, Arial, sans-serif";
      ctx.fillText(yVal.toFixed(1), 22, y + 4);
    }

    // 2.5 Pass Threshold dashed line
    const y25 = padTop + plotH - (2.5 / 5) * plotH;
    ctx.save();
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 1.8;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(padLeft, y25);
    ctx.lineTo(padLeft + plotW, y25);
    ctx.stroke();
    ctx.fillStyle = "#fcd34d";
    ctx.font = "bold 11px Segoe UI, Arial, sans-serif";
    ctx.fillText("Mốc Đạt (2.50)", padLeft + plotW - 92, y25 - 6);
    ctx.restore();

    if (n === 0) return;

    const groupW = plotW / n;
    const isFinal = activeChartModal === "final";
    const series1 = isFinal
      ? computedReportCard.chartData.final.sp
      : activeChartModal === "cp1"
      ? computedReportCard.chartData.cp1.lt
      : computedReportCard.chartData.cp2.lt;
    const series2 = isFinal
      ? computedReportCard.chartData.final.nl
      : activeChartModal === "cp1"
      ? computedReportCard.chartData.cp1.th
      : computedReportCard.chartData.cp2.th;
    const series3 = isFinal
      ? []
      : activeChartModal === "cp1"
      ? computedReportCard.chartData.cp1.nl
      : computedReportCard.chartData.cp2.nl;
    const avgSeries = isFinal
      ? computedReportCard.chartData.final.avg
      : activeChartModal === "cp1"
      ? computedReportCard.chartData.cp1.avg
      : computedReportCard.chartData.cp2.avg;

    const barCount = isFinal ? 2 : 3;
    const barW = Math.min(20, (groupW * 0.68) / barCount);

    labels.forEach((label, idx) => {
      const groupCenter = padLeft + idx * groupW + groupW / 2;
      const startX = groupCenter - (barCount * barW) / 2;

      const drawBar = (val: number | null | undefined, slot: number, color: string) => {
        if (val === null || val === undefined || !Number.isFinite(val)) return;
        const clamped = Math.max(0, Math.min(5, val));
        const bh = (clamped / 5) * plotH;
        const bx = startX + slot * barW;
        const by = padTop + plotH - bh;
        ctx.fillStyle = color;
        ctx.fillRect(bx, by, barW - 2, bh);
      };

      if (chartVisibility.c1) drawBar(series1[idx], 0, "#38bdf8");
      if (chartVisibility.c2) drawBar(series2[idx], 1, "#34d399");
      if (!isFinal && chartVisibility.c3) drawBar(series3[idx], 2, "#a78bfa");

      // Rotated student name label
      ctx.save();
      ctx.translate(groupCenter, padTop + plotH + 14);
      ctx.rotate(-Math.PI / 6);
      ctx.fillStyle = "#cbd5e1";
      ctx.font = "11px Segoe UI, Arial, sans-serif";
      const shortName = label.length > 16 ? label.slice(0, 15) + "…" : label;
      ctx.fillText(shortName, -36, 10);
      ctx.restore();
    });

    // Red Average Line (chartAvg)
    if (chartVisibility.avg) {
      ctx.strokeStyle = "#f43f5e";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      let started = false;
      avgSeries.forEach((val, idx) => {
        if (val === null || val === undefined || !Number.isFinite(val)) return;
        const x = padLeft + idx * groupW + groupW / 2;
        const y = padTop + plotH - (Math.max(0, Math.min(5, val)) / 5) * plotH;
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();

      avgSeries.forEach((val, idx) => {
        if (val === null || val === undefined || !Number.isFinite(val)) return;
        const x = padLeft + idx * groupW + groupW / 2;
        const y = padTop + plotH - (Math.max(0, Math.min(5, val)) / 5) * plotH;
        ctx.fillStyle = "#f43f5e";
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fda4af";
        ctx.font = "bold 10px Segoe UI, Arial, sans-serif";
        ctx.fillText(val.toFixed(2), x - 10, y - 8);
      });
    }
  }, [activeChartModal, computedReportCard, chartVisibility]);

  const handleCopyChartImage = async () => {
    if (!chartCanvasRef.current || !computedReportCard) return;
    const canvas = chartCanvasRef.current;
    try {
      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png")
      );
      if (
        blob &&
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof window !== "undefined" &&
        "ClipboardItem" in window
      ) {
        const ClipboardItemCtor = (window as any).ClipboardItem;
        await navigator.clipboard.write([new ClipboardItemCtor({ "image/png": blob })]);
        setToastMsg("Đã copy hình biểu đồ vào Clipboard! Sẵn sàng dán vào Zalo.");
        return;
      }
    } catch {
      // fallback download
    }
    const link = document.createElement("a");
    link.download = `BieuDo_${activeChartModal?.toUpperCase()}_${computedReportCard.classCode}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    setToastMsg("Đã tải xuống ảnh PNG biểu đồ!");
  };

  const statusBadge = getStatusBadgeInfo(isClassMatched ? record?.status : undefined);
  const overrideCount = isClassMatched ? Object.keys(overrides).length : 0;
  const activeSessions = useMemo(() => {
    if (!computedReportCard) return [];
    return computedReportCard.btvnSessions.filter((s) =>
      computedReportCard.activeBtvnSessionNumbers.includes(s.sessionNumber)
    );
  }, [computedReportCard]);

  const showCp1Cols =
    stageFilter === "all" || stageFilter === "cp1" || stageFilter === "cp1_cp2";
  const showCp2Cols =
    stageFilter === "all" || stageFilter === "cp2" || stageFilter === "cp1_cp2";
  const showFinalCols = stageFilter === "all";

  return (
    <div className="space-y-5">
      {/* Header Card: Chuẩn Teaching MindX */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="px-2.5 py-1 rounded-md text-xs font-extrabold uppercase tracking-wider bg-indigo-700 text-white border border-indigo-500 mindx-dark-keep">
                CHUẨN TEACHING MINDX
              </span>
              <span
                className={`px-2.5 py-1 rounded-md text-xs font-bold border ${
                  computedReportCard?.isRobotics
                    ? "bg-amber-700 text-white border-amber-500 mindx-dark-keep"
                    : "bg-sky-700 text-white border-sky-500 mindx-dark-keep"
                }`}
              >
                {computedReportCard?.isRobotics
                  ? "🤖 ROBOTICS (Chỉ CP1 Buổi 4, CP2 Buổi 8 & DEMO Buổi 14 — Không có BTVN)"
                  : "💻 LẬP TRÌNH (7 Buổi BTVN + CP1 Buổi 5, CP2 Buổi 9 & DEMO Buổi 14)"}
              </span>
              <span
                className={`px-2.5 py-1 rounded-md text-xs font-bold border ${statusBadge.className}`}
              >
                {statusBadge.label}
              </span>
              {isClassMatched && record && (
                <span className="text-xs text-slate-400 font-mono">
                  v{record.draftVersion}
                  {record.contentHash ? ` • #${record.contentHash.slice(0, 8)}` : ""}
                </span>
              )}
            </div>

            <h2 className="text-xl font-extrabold text-white tracking-tight">
              PHIẾU ĐIỂM TỔNG KẾT KHÓA HỌC — LỚP{" "}
              <span className="text-indigo-400">{effectiveClassId || "..."}</span>
            </h2>
            <p className="text-xs text-slate-400">
              Tự động tổng hợp điểm BTVN (`#tab-3`), Điểm Kiểm tra CP1/CP2 &amp; Điểm Năng lực `[ĐNL]` (`#tab-10`) cùng Điểm Sản phẩm Cuối khóa Buổi 14 theo đúng công thức của{" "}
              <a
                href={`https://teachingmindx.top/diem-tong-ket.php?from=hocsinh&class_code=${encodeURIComponent(
                  effectiveClassId
                )}`}
                target="_blank"
                rel="noreferrer"
                className="text-sky-400 underline hover:text-sky-300 font-semibold"
              >
                teachingmindx.top/diem-tong-ket.php ↗
              </a>
            </p>
          </div>

          {/* Primary Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleScrapeFromLms}
              disabled={isScrapingLms || isScrapingExternal || !effectiveClassId}
              className="px-3.5 py-2 rounded-lg text-xs font-bold bg-indigo-700 hover:bg-indigo-800 disabled:opacity-50 text-white border border-indigo-500 transition cursor-pointer mindx-dark-keep"
            >
              {isScrapingLms || isScrapingExternal
                ? "⏳ Đang quét LMS..."
                : "🔄 Quét Điểm BTVN & Checkpoint từ LMS"}
            </button>

            <button
              type="button"
              onClick={handleApproveReportCard}
              disabled={
                !isClassMatched ||
                isLoading ||
                isApproving ||
                !computedReportCard ||
                computedReportCard.students.length === 0
              }
              className="px-3.5 py-2 rounded-lg text-xs font-bold bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white border border-amber-500 transition cursor-pointer mindx-dark-keep"
            >
              {isApproving ? "⏳ Đang duyệt..." : "✅ Duyệt Phiếu Điểm (SHA-256)"}
            </button>

            <button
              type="button"
              onClick={handleSyncToTeaching}
              disabled={
                !isClassMatched ||
                isLoading ||
                isSyncingTeaching ||
                !record ||
                (record.status !== "APPROVED" && record.status !== "VERIFIED")
              }
              title={
                !isClassMatched ||
                (record?.status !== "APPROVED" && record?.status !== "VERIFIED")
                  ? "Vui lòng bấm 'Duyệt Phiếu Điểm' trước khi đồng bộ lên trang Teaching"
                  : "Khai báo bài tập & đồng bộ toàn bộ điểm đã duyệt lên teachingmindx.top/hocsinh.php"
              }
              className="px-3.5 py-2 rounded-lg text-xs font-bold bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white border border-emerald-500 transition cursor-pointer mindx-dark-keep"
            >
              {isSyncingTeaching
                ? "⏳ Đang đồng bộ Teaching..."
                : "🚀 Đồng bộ điểm lên Teaching"}
            </button>
          </div>
        </div>

        {/* Quick Class Switcher Pills */}
        {availableClasses.length > 0 && onSelectClass && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-400 mr-1">
              Lớp đang dạy:
            </span>
            {availableClasses.map((cls) => {
              const active = cls.classCode === effectiveClassId;
              return (
                <button
                  key={cls.classCode}
                  type="button"
                  onClick={() => onSelectClass(cls.classCode)}
                  className={`px-2.5 py-1 rounded-md text-xs font-bold border transition cursor-pointer ${
                    active
                      ? "bg-indigo-700 text-white border-indigo-500 mindx-dark-keep"
                      : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"
                  }`}
                >
                  {cls.classCode}
                </button>
              );
            })}
          </div>
        )}

        {/* Interactive Toolbar: Scale toggle, BTVN Session Filter, Stage Filter, Charts, Copy Zalo Images, Formula */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            {/* Scale Mode Toggle */}
            <div className="inline-flex rounded-lg border border-slate-700 overflow-hidden">
              <button
                type="button"
                onClick={() => setScaleMode("scale5")}
                className={`px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                  scaleMode === "scale5"
                    ? "bg-indigo-700 text-white mindx-dark-keep"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                Thang 5.0 (Chuẩn Teaching)
              </button>
              <button
                type="button"
                onClick={() => setScaleMode("raw")}
                className={`px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                  scaleMode === "raw"
                    ? "bg-indigo-700 text-white mindx-dark-keep"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                Điểm gốc LMS (Thang 100)
              </button>
            </div>

            {/* BTVN Session Filter Popover (Coding classes only) */}
            {computedReportCard?.showBtvnBlock && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowBtvnFilterPopover((v) => !v)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
                >
                  🗂️ Lọc buổi BTVN ({activeSessions.length}/
                  {computedReportCard.btvnSessions.length}) ▾
                </button>
                {showBtvnFilterPopover && (
                  <div className="absolute left-0 mt-2 w-64 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-3 z-40 space-y-2">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                      <span className="text-xs font-bold text-white">
                        Chọn buổi tính ĐTB BTVN
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            selectedBtvnClassRef.current = effectiveClassId;
                            setSelectedBtvnSessions(
                              computedReportCard.btvnSessions.map((s) => s.sessionNumber)
                            );
                          }}
                          className="text-[11px] text-sky-400 hover:underline cursor-pointer"
                        >
                          Chọn tất cả
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            selectedBtvnClassRef.current = effectiveClassId;
                            setSelectedBtvnSessions([]);
                          }}
                          className="text-[11px] text-slate-400 hover:underline cursor-pointer"
                        >
                          Bỏ hết
                        </button>
                      </div>
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {computedReportCard.btvnSessions.map((s) => {
                        const checked =
                          computedReportCard.activeBtvnSessionNumbers.includes(
                            s.sessionNumber
                          );
                        return (
                          <label
                            key={s.sessionNumber}
                            className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer py-1 px-1.5 rounded hover:bg-slate-800"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                selectedBtvnClassRef.current = effectiveClassId;
                                const current =
                                  computedReportCard.activeBtvnSessionNumbers;
                                const next = checked
                                  ? current.filter((n) => n !== s.sessionNumber)
                                  : [...current, s.sessionNumber].sort((a, b) => a - b);
                                setSelectedBtvnSessions(next);
                              }}
                            />
                            <span>
                              Buổi {s.sessionNumber}: {s.title}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Stage Filter */}
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value as StageFilterMode)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-200 focus:outline-none"
            >
              <option value="all">Giai đoạn: Tất cả (CP1 + CP2 + DEMO)</option>
              <option value="cp1">Giai đoạn: Chỉ Check-point 1</option>
              <option value="cp2">Giai đoạn: Chỉ Check-point 2</option>
              <option value="cp1_cp2">Giai đoạn: CP1 &amp; CP2</option>
            </select>

            {overrideCount > 0 && (
              <button
                type="button"
                onClick={handleResetAllOverrides}
                disabled={!isClassMatched || isLoading || isSavingOverride}
                className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-rose-800 hover:bg-rose-900 disabled:opacity-50 text-white border border-rose-600 transition cursor-pointer mindx-dark-keep"
              >
                ↩ Khôi phục toàn bộ điểm LMS ({overrideCount} ô đã sửa)
              </button>
            )}
          </div>

          {/* Right Toolbar: Formula, Charts, Copy Image for Zalo, Copy TSV */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowFormulaModal(true)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
            >
              📐 Công thức
            </button>
            <button
              type="button"
              onClick={() => setActiveChartModal("cp1")}
              disabled={!isClassMatched || isLoading}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 transition cursor-pointer"
            >
              📊 Biểu đồ CP1
            </button>
            <button
              type="button"
              onClick={() => setActiveChartModal("cp2")}
              disabled={!isClassMatched || isLoading}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 transition cursor-pointer"
            >
              📊 Biểu đồ CP2
            </button>
            <button
              type="button"
              onClick={() => setActiveChartModal("final")}
              disabled={!isClassMatched || isLoading}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 transition cursor-pointer"
            >
              📊 Biểu đồ DEMO
            </button>

            {computedReportCard?.showBtvnBlock && (
              <button
                type="button"
                onClick={() => handleCopyBlockImageToZalo("btvn")}
                disabled={!isClassMatched || isLoading}
                className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white border border-sky-500 transition cursor-pointer mindx-dark-keep"
              >
                📸 Copy ảnh BTVN
              </button>
            )}

            <button
              type="button"
              onClick={() => handleCopyBlockImageToZalo("summary")}
              disabled={!isClassMatched || isLoading}
              className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white border border-teal-500 transition cursor-pointer mindx-dark-keep"
            >
              📸 Copy ảnh Tổng kết
            </button>

            <button
              type="button"
              onClick={handleCopyTsvToSheets}
              disabled={!isClassMatched || isLoading}
              className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white border border-emerald-500 transition cursor-pointer mindx-dark-keep"
            >
              📋 Copy Google Sheets
            </button>
          </div>
        </div>
      </div>

      {/* Banners */}
      {errorMsg && (
        <div className="bg-rose-950/60 border border-rose-800 text-rose-200 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
          <span>⚠️ {errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-xs underline ml-4 cursor-pointer"
          >
            Đóng
          </button>
        </div>
      )}

      {toastMsg && (
        <div className="bg-emerald-950/60 border border-emerald-800 text-emerald-200 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
          <span>✅ {toastMsg}</span>
          <button
            type="button"
            onClick={() => setToastMsg(null)}
            className="text-xs underline ml-4 cursor-pointer"
          >
            Đóng
          </button>
        </div>
      )}

      {/* Empty or Loading State */}
      {isLoading ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-10 text-center text-slate-400 text-sm">
          ⏳ Đang tải Phiếu điểm tổng kết lớp {effectiveClassId}...
        </div>
      ) : !isClassMatched || !computedReportCard || computedReportCard.students.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-10 text-center space-y-3">
          <div className="text-3xl">📋</div>
          <h3 className="text-base font-bold text-slate-200">
            Chưa có dữ liệu Phiếu điểm tổng kết cho lớp {effectiveClassId}
          </h3>
          <p className="text-xs text-slate-400 max-w-xl mx-auto">
            Hãy bấm nút{" "}
            <strong className="text-indigo-400">
              &ldquo;🔄 Quét Điểm BTVN &amp; Checkpoint từ LMS&rdquo;
            </strong>{" "}
            ở góc trên bên phải để Bot tự động lấy điểm BTVN, điểm Kiểm tra CP1/CP2, điểm Năng lực `[ĐNL]` và điểm Sản phẩm Cuối khóa Buổi 14 từ LMS.
          </p>
        </div>
      ) : (
        <>
          {/* =============================================================== */}
          {/* KHỐI 1: BẢNG ĐIỂM BÀI TẬP VỀ NHÀ (CHỈ HIỆN VỚI LỚP LẬP TRÌNH)   */}
          {/* =============================================================== */}
          {computedReportCard.showBtvnBlock ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
              <div className="px-4 py-3 bg-slate-950/70 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-extrabold uppercase tracking-wider text-white">
                    1. BẢNG ĐIỂM BÀI TẬP VỀ NHÀ (BTVN — {activeSessions.length} BUỔI)
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Click vào bất kỳ ô điểm nào để sửa tay hoặc ghi chú. Các ô điểm quy đổi{" "}
                    <span className="text-rose-400 font-semibold">&lt; 2.50</span> được tô đỏ cảnh báo.
                  </p>
                </div>
                <span className="text-xs text-slate-400">
                  Chế độ hiển thị:{" "}
                  <strong className="text-indigo-400">
                    {scaleMode === "raw" ? "Điểm gốc (Thang 100)" : "Quy đổi Thang 5.0"}
                  </strong>
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead className="mindx-thead bg-slate-950 text-slate-200 uppercase">
                    <tr className="border-b border-slate-800">
                      <th rowSpan={2} className="py-2.5 px-2.5 text-center border-r border-slate-800 w-10">
                        STT
                      </th>
                      <th
                        rowSpan={2}
                        onClick={() => handleSortColumn("fullName")}
                        className="py-2.5 px-3 border-r border-slate-800 min-w-[180px] cursor-pointer select-none"
                      >
                        Họ và tên {renderSortIndicator("fullName")}
                      </th>
                      {activeSessions.map((s) => (
                        <th
                          key={s.sessionNumber}
                          colSpan={2}
                          title={s.title}
                          className="py-2 px-2 text-center border-r border-slate-800"
                        >
                          Buổi {s.sessionNumber}
                        </th>
                      ))}
                      <th rowSpan={2} className="py-2.5 px-2.5 text-center border-r border-slate-800">
                        Đã làm
                      </th>
                      <th
                        rowSpan={2}
                        onClick={() => handleSortColumn("btvnAvg")}
                        className="py-2.5 px-3 text-center cursor-pointer select-none"
                      >
                        ĐTB {renderSortIndicator("btvnAvg")}
                      </th>
                    </tr>
                    <tr className="border-b border-slate-800 text-[10px]">
                      {activeSessions.map((s) => (
                        <React.Fragment key={s.sessionNumber}>
                          <th className="py-1.5 px-2 text-center border-r border-slate-800">
                            Lý thuyết
                          </th>
                          <th className="py-1.5 px-2 text-center border-r border-slate-800">
                            Thực hành
                          </th>
                        </React.Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {sortedStudents.map((row) => (
                      <tr key={row.studentId} className="hover:bg-slate-800/40 transition">
                        <td className="py-2 px-2.5 text-center font-mono text-slate-400 border-r border-slate-800/60">
                          {row.index}
                        </td>
                        <td className="py-2 px-3 font-semibold text-white border-r border-slate-800/60">
                          {row.fullName}
                        </td>
                        {activeSessions.map((s) => {
                          const cell = row.btvnCells[s.sessionNumber];
                          const ltDisplay =
                            scaleMode === "raw"
                              ? cell?.theoryRaw !== null && cell?.theoryRaw !== undefined
                                ? String(cell.theoryRaw)
                                : "-"
                              : formatScore2(cell?.theoryNorm);
                          const thDisplay =
                            scaleMode === "raw"
                              ? cell?.practiceRaw !== null && cell?.practiceRaw !== undefined
                                ? String(cell.practiceRaw)
                                : "-"
                              : formatScore2(cell?.practiceNorm);

                          const practiceTooltip =
                            cell?.practiceTask1Raw !== null || cell?.practiceTask2Raw !== null
                              ? `Thực hành Buổi ${s.sessionNumber}: Bài 1 = ${
                                  cell?.practiceTask1Raw ?? "-"
                                }, Bài 2 = ${cell?.practiceTask2Raw ?? "-"}`
                              : `Thực hành Buổi ${s.sessionNumber}`;

                          return (
                            <React.Fragment key={s.sessionNumber}>
                              {/* Theory Cell */}
                              <td
                                onClick={() =>
                                  openOverrideEditor({
                                    studentId: row.studentId,
                                    studentName: row.fullName,
                                    fieldKey: `btvn_${s.sessionNumber}_theory`,
                                    fieldLabel: `BTVN Buổi ${s.sessionNumber} — Lý thuyết`,
                                    isBtvnField: true,
                                    maxRawScore: cell?.theoryMax || 100,
                                    currentNorm: cell?.theoryNorm ?? null,
                                    currentRaw: cell?.theoryRaw ?? null,
                                    lmsNorm: cell?.lmsTheoryNorm ?? null,
                                    lmsRaw: cell?.lmsTheoryRaw ?? null,
                                    isOverridden: Boolean(cell?.isTheoryOverridden),
                                    note: cell?.theoryNote || "",
                                  })
                                }
                                title={`Click để sửa điểm Lý thuyết Buổi ${s.sessionNumber}${
                                  cell?.theoryNote ? ` (${cell.theoryNote})` : ""
                                }`}
                                className={`py-2 px-2 text-center font-mono border-r border-slate-800/60 cursor-pointer hover:bg-indigo-950/40 ${
                                  cell?.isTheoryLow
                                    ? "bg-rose-950/50 text-rose-300 font-bold"
                                    : "text-slate-200"
                                }`}
                              >
                                {ltDisplay}
                                {cell?.isTheoryOverridden && (
                                  <span className="ml-0.5 text-[10px] text-amber-400">✎</span>
                                )}
                              </td>

                              {/* Practice Cell */}
                              <td
                                onClick={() =>
                                  openOverrideEditor({
                                    studentId: row.studentId,
                                    studentName: row.fullName,
                                    fieldKey: `btvn_${s.sessionNumber}_practice`,
                                    fieldLabel: `BTVN Buổi ${s.sessionNumber} — Thực hành`,
                                    isBtvnField: true,
                                    maxRawScore: cell?.practiceMax || 100,
                                    currentNorm: cell?.practiceNorm ?? null,
                                    currentRaw: cell?.practiceRaw ?? null,
                                    lmsNorm: cell?.lmsPracticeNorm ?? null,
                                    lmsRaw: cell?.lmsPracticeRaw ?? null,
                                    isOverridden: Boolean(cell?.isPracticeOverridden),
                                    note: cell?.practiceNote || "",
                                  })
                                }
                                title={practiceTooltip}
                                className={`py-2 px-2 text-center font-mono border-r border-slate-800/60 cursor-pointer hover:bg-indigo-950/40 ${
                                  cell?.isPracticeLow
                                    ? "bg-rose-950/50 text-rose-300 font-bold"
                                    : "text-slate-200"
                                }`}
                              >
                                {thDisplay}
                                {cell?.isPracticeOverridden && (
                                  <span className="ml-0.5 text-[10px] text-amber-400">✎</span>
                                )}
                              </td>
                            </React.Fragment>
                          );
                        })}
                        <td className="py-2 px-2.5 text-center font-mono text-slate-300 border-r border-slate-800/60">
                          {row.submittedCount}/{row.totalAssignedItems}
                        </td>
                        <td
                          className={`py-2 px-3 text-center font-mono font-bold ${
                            row.isBtvnAvgLow ? "text-rose-400" : "text-emerald-400"
                          }`}
                        >
                          {scaleMode === "raw"
                            ? formatScore2(row.btvnAvgRaw)
                            : formatScore2(row.btvnAvgNorm)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* =============================================================== */}
          {/* KHỐI 2: BẢNG ĐIỂM TỔNG KẾT & XẾP HẠNG (CP1, CP2, DEMO, TBCK)     */}
          {/* =============================================================== */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
            <div className="px-4 py-3 bg-slate-950/70 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-extrabold uppercase tracking-wider text-white">
                  {computedReportCard.showBtvnBlock ? "2." : "1."} BẢNG ĐIỂM TỔNG KẾT &amp; XẾP HẠNG CUỐI KHÓA (CHECK-POINT 1, CHECK-POINT 2 &amp; DEMO)
                </h3>
                <p className="text-[11px] text-slate-400">
                  Điểm Kiểm tra và Điểm Năng lực `[ĐNL]` lấy trực tiếp từ LMS (hoặc bấm vào ô để sửa tay). Khuyết hoặc 0 điểm ở bất kỳ thành phần nào sẽ không xét{" "}
                  <strong className="text-amber-400">Hạng A / B</strong> (tối đa Hạng C nếu TBCK ≥ 2.50, hoặc Hạng D nếu TBCK &lt; 2.50).
                </p>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="px-2 py-0.5 rounded bg-emerald-700 text-white mindx-dark-keep font-bold">
                  Hạng A ≥ 4.50 (Đủ điểm)
                </span>
                <span className="px-2 py-0.5 rounded bg-sky-700 text-white mindx-dark-keep font-bold">
                  Hạng B ≥ 4.00 (Đủ điểm)
                </span>
                <span className="px-2 py-0.5 rounded bg-amber-700 text-white mindx-dark-keep font-bold">
                  Hạng C ≥ 2.50 (Hoặc khuyết/0đ)
                </span>
                <span className="px-2 py-0.5 rounded bg-rose-700 text-white mindx-dark-keep font-bold">
                  Hạng D &lt; 2.50
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="mindx-thead bg-slate-950 text-slate-200 uppercase">
                  <tr className="border-b border-slate-800">
                    <th rowSpan={2} className="py-2.5 px-2.5 text-center border-r border-slate-800 w-10">
                      STT
                    </th>
                    <th
                      rowSpan={2}
                      onClick={() => handleSortColumn("fullName")}
                      className="py-2.5 px-3 border-r border-slate-800 min-w-[180px] cursor-pointer select-none"
                    >
                      Họ và tên {renderSortIndicator("fullName")}
                    </th>
                    {showCp1Cols && (
                      <th colSpan={5} className="py-2 px-2 text-center border-r border-slate-800">
                        Check-point 1 ({computedReportCard.isRobotics ? "Buổi 4" : "Buổi 5"})
                      </th>
                    )}
                    {showCp2Cols && (
                      <th colSpan={5} className="py-2 px-2 text-center border-r border-slate-800">
                        Check-point 2 ({computedReportCard.isRobotics ? "Buổi 8" : "Buổi 9"})
                      </th>
                    )}
                    {showFinalCols && (
                      <th colSpan={3} className="py-2 px-2 text-center border-r border-slate-800">
                        Cuối khóa DEMO (Buổi 14)
                      </th>
                    )}
                    <th
                      rowSpan={2}
                      onClick={() => handleSortColumn("tbck")}
                      className="py-2.5 px-2.5 text-center border-r border-slate-800 cursor-pointer select-none"
                    >
                      Điểm TBCK {renderSortIndicator("tbck")}
                    </th>
                    <th rowSpan={2} className="py-2.5 px-2.5 text-center border-r border-slate-800">
                      Xếp loại
                    </th>
                    <th
                      rowSpan={2}
                      onClick={() => handleSortColumn("rank")}
                      className="py-2.5 px-2.5 text-center cursor-pointer select-none"
                    >
                      Hạng {renderSortIndicator("rank")}
                    </th>
                  </tr>
                  <tr className="border-b border-slate-800 text-[10px]">
                    {showCp1Cols && (
                      <>
                        <th className="py-1.5 px-2 text-center border-r border-slate-800">LT</th>
                        <th className="py-1.5 px-2 text-center border-r border-slate-800">TH</th>
                        <th className="py-1.5 px-2 text-center border-r border-slate-800">NL</th>
                        <th className="py-1.5 px-2 text-center border-r border-slate-800">TB LT+TH</th>
                        <th
                          onClick={() => handleSortColumn("cp1Total")}
                          className="py-1.5 px-2 text-center border-r border-slate-800 cursor-pointer select-none"
                        >
                          Tổng CP1 {renderSortIndicator("cp1Total")}
                        </th>
                      </>
                    )}
                    {showCp2Cols && (
                      <>
                        <th className="py-1.5 px-2 text-center border-r border-slate-800">LT</th>
                        <th className="py-1.5 px-2 text-center border-r border-slate-800">TH</th>
                        <th className="py-1.5 px-2 text-center border-r border-slate-800">NL</th>
                        <th className="py-1.5 px-2 text-center border-r border-slate-800">TB LT+TH</th>
                        <th
                          onClick={() => handleSortColumn("cp2Total")}
                          className="py-1.5 px-2 text-center border-r border-slate-800 cursor-pointer select-none"
                        >
                          Tổng CP2 {renderSortIndicator("cp2Total")}
                        </th>
                      </>
                    )}
                    {showFinalCols && (
                      <>
                        <th className="py-1.5 px-2 text-center border-r border-slate-800">Sản phẩm</th>
                        <th className="py-1.5 px-2 text-center border-r border-slate-800">Năng lực</th>
                        <th
                          onClick={() => handleSortColumn("finalTotal")}
                          className="py-1.5 px-2 text-center border-r border-slate-800 cursor-pointer select-none"
                        >
                          Tổng DEMO {renderSortIndicator("finalTotal")}
                        </th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {sortedStudents.map((row) => {
                    const renderEditableStageCell = (
                      fieldKey: string,
                      fieldLabel: string,
                      fieldObj: {
                        value: number | null;
                        lmsValue: number | null;
                        isOverridden: boolean;
                        note: string;
                      }
                    ) => {
                      const isLow =
                        fieldObj.value !== null &&
                        fieldObj.value !== undefined &&
                        fieldObj.value < 2.5;
                      return (
                        <td
                          onClick={() =>
                            openOverrideEditor({
                              studentId: row.studentId,
                              studentName: row.fullName,
                              fieldKey,
                              fieldLabel,
                              isBtvnField: false,
                              maxRawScore: 5,
                              currentNorm: fieldObj.value,
                              currentRaw: fieldObj.value,
                              lmsNorm: fieldObj.lmsValue,
                              lmsRaw: fieldObj.lmsValue,
                              isOverridden: fieldObj.isOverridden,
                              note: fieldObj.note || "",
                            })
                          }
                          title={`Click để sửa ${fieldLabel}${
                            fieldObj.note ? ` (${fieldObj.note})` : ""
                          }`}
                          className={`py-2 px-2 text-center font-mono border-r border-slate-800/60 cursor-pointer hover:bg-indigo-950/40 ${
                            isLow ? "text-rose-400 font-bold" : "text-slate-200"
                          }`}
                        >
                          {formatScore2(fieldObj.value)}
                          {fieldObj.isOverridden && (
                            <span className="ml-0.5 text-[10px] text-amber-400">✎</span>
                          )}
                        </td>
                      );
                    };

                    return (
                      <tr key={row.studentId} className="hover:bg-slate-800/40 transition">
                        <td className="py-2 px-2.5 text-center font-mono text-slate-400 border-r border-slate-800/60">
                          {row.index}
                        </td>
                        <td className="py-2 px-3 font-semibold text-white border-r border-slate-800/60">
                          {row.fullName}
                        </td>

                        {showCp1Cols && (
                          <>
                            {renderEditableStageCell(
                              "cp1_theory",
                              "Check-point 1 — Lý thuyết",
                              row.cp1.theory
                            )}
                            {renderEditableStageCell(
                              "cp1_practice",
                              "Check-point 1 — Thực hành",
                              row.cp1.practice
                            )}
                            {renderEditableStageCell(
                              "cp1_nang_luc",
                              "Check-point 1 — Điểm Năng lực [ĐNL]",
                              row.cp1.competency
                            )}
                            <td className="py-2 px-2 text-center font-mono text-slate-300 border-r border-slate-800/60">
                              {formatScore2(row.cp1.avgLtTh)}
                            </td>
                            <td className="py-2 px-2 text-center font-mono font-bold text-sky-400 border-r border-slate-800/60">
                              {formatScore2(row.cp1.total)}
                            </td>
                          </>
                        )}

                        {showCp2Cols && (
                          <>
                            {renderEditableStageCell(
                              "cp2_theory",
                              "Check-point 2 — Lý thuyết",
                              row.cp2.theory
                            )}
                            {renderEditableStageCell(
                              "cp2_practice",
                              "Check-point 2 — Thực hành",
                              row.cp2.practice
                            )}
                            {renderEditableStageCell(
                              "cp2_nang_luc",
                              "Check-point 2 — Điểm Năng lực [ĐNL]",
                              row.cp2.competency
                            )}
                            <td className="py-2 px-2 text-center font-mono text-slate-300 border-r border-slate-800/60">
                              {formatScore2(row.cp2.avgLtTh)}
                            </td>
                            <td className="py-2 px-2 text-center font-mono font-bold text-sky-400 border-r border-slate-800/60">
                              {formatScore2(row.cp2.total)}
                            </td>
                          </>
                        )}

                        {showFinalCols && (
                          <>
                            {renderEditableStageCell(
                              "final_practice",
                              "Cuối khóa DEMO — Điểm Sản phẩm",
                              row.final.product
                            )}
                            {renderEditableStageCell(
                              "final_nang_luc",
                              "Cuối khóa DEMO — Điểm Năng lực [ĐNL]",
                              row.final.competency
                            )}
                            <td className="py-2 px-2 text-center font-mono font-bold text-indigo-400 border-r border-slate-800/60">
                              {formatScore2(row.final.total)}
                            </td>
                          </>
                        )}

                        <td
                          className={`py-2 px-2.5 text-center font-mono font-extrabold border-r border-slate-800/60 ${
                            row.isTbckLow ? "text-rose-400" : "text-emerald-400"
                          }`}
                        >
                          {formatScore2(row.tbck)}
                        </td>
                        <td className="py-2 px-2.5 text-center font-semibold text-slate-200 border-r border-slate-800/60">
                          {row.xepLoai || "-"}
                        </td>
                        <td className="py-2 px-2.5 text-center">
                          {row.hang ? (
                            <span
                              title={
                                row.hasMissingOrZeroComponent
                                  ? row.rankCode === "C"
                                    ? "Có thành phần điểm = 0 hoặc khuyết nên không xét Hạng A/B (xếp Hạng C do TBCK ≥ 2.50)"
                                    : "Có thành phần điểm = 0 hoặc khuyết và TBCK < 2.50 (xếp Hạng D)"
                                  : `Điểm TBCK: ${formatScore2(row.tbck)} (${row.hang})`
                              }
                              className={`inline-block px-2.5 py-0.5 rounded-md text-xs font-extrabold border ${getRankBadgeClass(
                                row.rankCode
                              )}`}
                            >
                              {row.hang}
                            </span>
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ================================================================= */}
      {/* MODAL SỬA ĐIỂM THỦ CÔNG (INLINE MANUAL OVERRIDE)                   */}
      {/* ================================================================= */}
      {overrideModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-start justify-between border-b border-slate-800 pb-3">
              <div>
                <h4 className="text-sm font-extrabold text-white">
                  ✎ Chỉnh sửa điểm: {overrideModal.fieldLabel}
                </h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  Học viên: <strong className="text-indigo-400">{overrideModal.studentName}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOverrideModal(null)}
                className="text-slate-400 hover:text-white text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between bg-slate-950/70 p-2.5 rounded-lg border border-slate-800">
                <span className="text-slate-400">Điểm gốc trên LMS:</span>
                <span className="font-mono font-bold text-slate-200">
                  {overrideModal.isBtvnField
                    ? `${overrideModal.lmsRaw ?? "-"} / ${overrideModal.maxRawScore} (Thang 5: ${formatScore2(
                        overrideModal.lmsNorm
                      )})`
                    : `${formatScore2(overrideModal.lmsNorm)} / 5.00`}
                </span>
              </div>

              {overrideModal.isBtvnField && (
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">Nhập theo:</span>
                  <button
                    type="button"
                    onClick={() => {
                      setOverrideInputMode("scale5");
                      setOverrideInputValue(
                        overrideModal.currentNorm !== null
                          ? String(overrideModal.currentNorm)
                          : ""
                      );
                    }}
                    className={`px-2.5 py-1 rounded font-bold cursor-pointer ${
                      overrideInputMode === "scale5"
                        ? "bg-indigo-700 text-white mindx-dark-keep"
                        : "bg-slate-800 text-slate-300"
                    }`}
                  >
                    Thang 5 (0..5)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOverrideInputMode("raw");
                      setOverrideInputValue(
                        overrideModal.currentRaw !== null
                          ? String(overrideModal.currentRaw)
                          : ""
                      );
                    }}
                    className={`px-2.5 py-1 rounded font-bold cursor-pointer ${
                      overrideInputMode === "raw"
                        ? "bg-indigo-700 text-white mindx-dark-keep"
                        : "bg-slate-800 text-slate-300"
                    }`}
                  >
                    Thang {overrideModal.maxRawScore} (Điểm gốc)
                  </button>
                </div>
              )}

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Điểm mới ({overrideInputMode === "raw" && overrideModal.isBtvnField ? `0 - ${overrideModal.maxRawScore}` : "0.00 - 5.00"}):
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={overrideInputValue}
                  onChange={(e) => setOverrideInputValue(e.target.value)}
                  placeholder="Nhập điểm số..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Ghi chú lý do điều chỉnh (tùy chọn):
                </label>
                <input
                  type="text"
                  value={overrideInputNote}
                  onChange={(e) => setOverrideInputNote(e.target.value)}
                  placeholder="VD: Nộp bù bài thực hành qua Zalo..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              {overrideModal.isOverridden ? (
                <button
                  type="button"
                  onClick={handleClearSingleOverride}
                  disabled={isSavingOverride}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-800 hover:bg-rose-900 text-white border border-rose-600 cursor-pointer mindx-dark-keep"
                >
                  ↩ Khôi phục điểm LMS
                </button>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOverrideModal(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={handleSaveManualOverride}
                  disabled={isSavingOverride}
                  className="px-4 py-1.5 rounded-lg text-xs font-bold bg-indigo-700 hover:bg-indigo-800 text-white border border-indigo-500 cursor-pointer mindx-dark-keep"
                >
                  {isSavingOverride ? "Đang lưu..." : "Lưu điểm"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL CÔNG THỨC TÍNH ĐIỂM CHUẨN TEACHING                           */}
      {/* ================================================================= */}
      {showFormulaModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h4 className="text-base font-extrabold text-white">
                📐 Công thức Tính điểm &amp; Xếp hạng Chuẩn Teaching MindX
              </h4>
              <button
                type="button"
                onClick={() => setShowFormulaModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
              <p>
                <strong>1. Quy đổi điểm BTVN sang thang 5:</strong>{" "}
                <code>Điểm_Thang_5 = round((Điểm_LMS / Điểm_Tối_Đa) × 5, 2)</code>. Nếu buổi học có 2 bài Thực hành (`PRACTICE_TASK1` &amp; `PRACTICE_TASK2`), điểm Thực hành tính bằng trung bình cộng các bài đã chấm.
              </p>
              <p>
                <strong>2. Điểm Năng lực `[ĐNL]` (Buổi Checkpoint &amp; Buổi 14):</strong>{" "}
                Trung bình cộng các tiêu chí `[ĐNL]` có tích chọn (<code>&gt; 0</code>) trong phiếu nhận xét LMS: <code>round(sum(ĐNL) / count(ĐNL &gt; 0), 2)</code>.
              </p>
              <p>
                <strong>3. Tổng điểm Check-point 1 &amp; Check-point 2 (40% Kiến thức + 60% Năng lực):</strong>
                <br />
                • Cột hiển thị <code>TB LT+TH = round((LT + TH) / 2, 2)</code> (nếu chỉ có 1 trong 2 điểm LT hoặc TH thì lấy điểm hiện có).
                <br />• <code>Tổng_CP = round(TB_chưa_làm_tròn(LT, TH) × 0.4 + Năng_Lực × 0.6, 2)</code> (nếu thiếu phần nào khi phần kia đã có điểm thì phần thiếu tính là <code>0</code>; nếu cả 3 thành phần đều trống thì để trống <code>-</code>).
              </p>
              <p>
                <strong>4. Tổng điểm Cuối khóa DEMO Buổi 14 (60% Sản phẩm + 40% Năng lực):</strong>
                <br />• <code>Tổng_DEMO = round(Sản_Phẩm × 0.6 + Năng_Lực × 0.4, 2)</code> (nếu thiếu 1 trong 2 phần khi phần kia đã có điểm thì phần thiếu tính là <code>0</code>; nếu cả 2 đều trống thì để trống <code>-</code>).
              </p>
              <p>
                <strong>5. Điểm Trung bình Cuối khóa — TBCK (40% Check-point + 60% DEMO):</strong>
                <br />• <code>Điểm_TBCK = round(TB_chưa_làm_tròn(Tổng_CP1, Tổng_CP2) × 0.4 + Tổng_DEMO × 0.6, 2)</code>.
              </p>
              <p>
                <strong>6. Quy tắc Xếp loại &amp; Hạng A / B / C / D:</strong>
                <br />• <strong>Hạng A (Xuất sắc):</strong> <code>TBCK ≥ 4.50</code> và đầy đủ cả 8 thành phần điểm (<code>&gt; 0</code>, không khuyết).
                <br />• <strong>Hạng B (Tốt):</strong> <code>4.00 ≤ TBCK &lt; 4.50</code> và đầy đủ cả 8 thành phần điểm (<code>&gt; 0</code>, không khuyết).
                <br />• <strong>Hạng C (Đạt):</strong> <code>2.50 ≤ TBCK &lt; 4.00</code>, <strong>HOẶC</strong> <code>TBCK ≥ 4.00</code> nhưng có ít nhất 1 trong 8 thành phần điểm bị khuyết (<code>null</code>) hoặc bằng <code>0</code> (không đủ điều kiện xét Hạng A / B).
                <br />• <strong>Hạng D (Chưa đạt):</strong> <code>TBCK &lt; 2.50</code>.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL BIỂU ĐỒ TRỰC QUAN (CP1 / CP2 / DEMO)                         */}
      {/* ================================================================= */}
      {activeChartModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-4xl w-full p-5 shadow-2xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-3">
                <h4 className="text-base font-extrabold text-white">
                  📊{" "}
                  {activeChartModal === "cp1"
                    ? "Biểu đồ Điểm Check-point 1"
                    : activeChartModal === "cp2"
                    ? "Biểu đồ Điểm Check-point 2"
                    : "Biểu đồ Điểm Cuối khóa (DEMO)"}
                </h4>
                {/* Dataset visibility toggles */}
                <div className="flex items-center gap-2 text-xs">
                  <label className="flex items-center gap-1 text-sky-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={chartVisibility.c1}
                      onChange={(e) =>
                        setChartVisibility((v) => ({ ...v, c1: e.target.checked }))
                      }
                    />
                    <span>{activeChartModal === "final" ? "Sản phẩm" : "Lý thuyết"}</span>
                  </label>
                  <label className="flex items-center gap-1 text-emerald-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={chartVisibility.c2}
                      onChange={(e) =>
                        setChartVisibility((v) => ({ ...v, c2: e.target.checked }))
                      }
                    />
                    <span>{activeChartModal === "final" ? "Năng lực" : "Thực hành"}</span>
                  </label>
                  {activeChartModal !== "final" && (
                    <label className="flex items-center gap-1 text-violet-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={chartVisibility.c3}
                        onChange={(e) =>
                          setChartVisibility((v) => ({ ...v, c3: e.target.checked }))
                        }
                      />
                      <span>Năng lực</span>
                    </label>
                  )}
                  <label className="flex items-center gap-1 text-rose-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={chartVisibility.avg}
                      onChange={(e) =>
                        setChartVisibility((v) => ({ ...v, avg: e.target.checked }))
                      }
                    />
                    <span>Đường TB</span>
                  </label>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyChartImage}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-700 hover:bg-indigo-800 text-white border border-indigo-500 cursor-pointer mindx-dark-keep"
                >
                  📸 Copy hình biểu đồ
                </button>
                <button
                  type="button"
                  onClick={() => setActiveChartModal(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 cursor-pointer"
                >
                  Đóng ✕
                </button>
              </div>
            </div>

            <div className="overflow-x-auto bg-slate-950 rounded-xl p-3 border border-slate-800">
              <canvas
                ref={chartCanvasRef}
                className="w-full max-w-[880px] h-[430px] mx-auto block"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
