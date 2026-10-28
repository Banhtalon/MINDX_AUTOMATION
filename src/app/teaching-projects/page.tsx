"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Loader2,
  RefreshCw,
  Rocket,
  Save,
  Sparkles,
  Users,
} from "lucide-react";

interface RunningClassOption {
  classCode: string;
  courseName?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}

interface TeachingStudentItem {
  id: number;
  studentName: string;
  classCode: string;
  status?: string;
}

interface TeachingProjectTaskItem {
  slotIndex: number;
  taskId?: number | null;
  taskName: string;
  description: string;
  weightPercent: number;
  deadline: string;
  assignedStudentIds: number[];
}

interface TeachingFinalProjectRecordUI {
  classId: string;
  teachingProjectId: number | null;
  projectName: string;
  startDate: string;
  endDate: string;
  description: string;
  tasksJson: string;
  studentsJson: string;
  progressJson: string;
  draftVersion: number;
  status: "DRAFT" | "WAITING_APPROVAL" | "APPROVED" | "SAVING" | "VERIFIED" | "FAILED";
  contentHash: string;
  verifiedAt: string | null;
  verifiedSnapshotJson: string | null;
  errorMessage: string | null;
  updatedAt: string;
}

function computeCountdownBadge(endDate: string): {
  label: string;
  tone: "emerald" | "amber" | "slate";
} {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(endDate || "").trim())) {
    return { label: "Chưa có ngày kết thúc", tone: "slate" };
  }
  const [y, m, d] = endDate.split("-").map(Number);
  const targetUtc = Date.UTC(y, m - 1, d);
  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((targetUtc - todayUtc) / (1000 * 60 * 60 * 24));
  if (diffDays > 7) {
    return { label: `⏳ Còn ${diffDays} ngày đến hạn kết khóa`, tone: "emerald" };
  }
  if (diffDays >= 0) {
    return {
      label: diffDays === 0 ? "⏰ Hôm nay là hạn kết khóa" : `⏰ Còn ${diffDays} ngày đến hạn`,
      tone: "amber",
    };
  }
  return { label: `✅ Đã qua ngày kết khóa (${Math.abs(diffDays)} ngày)`, tone: "slate" };
}

function getShortProjectName(classCode: string): string {
  const clean = String(classCode || "").trim().toUpperCase();
  if (!clean) return "SPCK -";
  const parts = clean.split("-").filter(Boolean);
  const shortPart = parts.length >= 2 ? parts[parts.length - 1] : clean;
  return `SPCK - ${shortPart}`;
}

function getFullProjectName(classCode: string): string {
  const clean = String(classCode || "").trim().toUpperCase();
  return clean ? `SPCK - ${clean}` : "SPCK -";
}

export default function TeachingProjectsPage() {
  const [classes, setClasses] = useState<RunningClassOption[]>([]);
  const [selectedClassCode, setSelectedClassCode] = useState<string>("");
  const [customClassInput, setCustomClassInput] = useState<string>("");
  const [loadedClassCode, setLoadedClassCode] = useState<string>("");

  const [projectName, setProjectName] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [remoteProjectId, setRemoteProjectId] = useState<number | null>(null);
  const [students, setStudents] = useState<TeachingStudentItem[]>([]);
  const [assignedStudentIds, setAssignedStudentIds] = useState<number[]>([]);
  const [tasks, setTasks] = useState<TeachingProjectTaskItem[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});

  const [status, setStatus] = useState<TeachingFinalProjectRecordUI["status"]>("DRAFT");
  const [draftVersion, setDraftVersion] = useState<number>(1);
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasUnsavedLocalEdits, setHasUnsavedLocalEdits] = useState<boolean>(false);

  const [courseName, setCourseName] = useState<string>("");
  const [dateSourceLabel, setDateSourceLabel] = useState<string>("");
  const [teacherHint, setTeacherHint] = useState<string>("");

  const [isLoadingClass, setIsLoadingClass] = useState<boolean>(false);
  const [isFetchingLmsDates, setIsFetchingLmsDates] = useState<boolean>(false);
  const [isGeneratingAi, setIsGeneratingAi] = useState<boolean>(false);
  const [isSavingDraft, setIsSavingDraft] = useState<boolean>(false);
  const [isSyncingTeaching, setIsSyncingTeaching] = useState<boolean>(false);
  const [isUpdatingProgress, setIsUpdatingProgress] = useState<boolean>(false);

  const [banner, setBanner] = useState<{
    type: "success" | "warning" | "error" | "info";
    text: string;
  } | null>(null);

  const activeLoadSeqRef = useRef<number>(0);
  const loadedClassCodeRef = useRef<string>("");

  const applyRecordAndTasksState = useCallback(
    (
      rec: TeachingFinalProjectRecordUI,
      explicitTasks?: TeachingProjectTaskItem[],
      explicitStudents?: TeachingStudentItem[],
      explicitProgress?: Record<string, number>
    ) => {
      const recClass = String(rec.classId || "").trim().toUpperCase();
      if (recClass) {
        loadedClassCodeRef.current = recClass;
        setLoadedClassCode(recClass);
      }
      setProjectName(rec.projectName || getShortProjectName(rec.classId));
      setStartDate(rec.startDate || "");
      setEndDate(rec.endDate || "");
      setDescription(rec.description || "");
      setRemoteProjectId(rec.teachingProjectId ?? null);

      let parsedStudents: TeachingStudentItem[] = [];
      if (Array.isArray(explicitStudents)) {
        parsedStudents = explicitStudents;
      } else {
        try {
          parsedStudents = JSON.parse(rec.studentsJson || "[]");
        } catch {
          parsedStudents = [];
        }
      }
      setStudents(parsedStudents);

      let parsedTasks: TeachingProjectTaskItem[] = [];
      if (Array.isArray(explicitTasks)) {
        parsedTasks = explicitTasks;
      } else {
        try {
          parsedTasks = JSON.parse(rec.tasksJson || "[]");
        } catch {
          parsedTasks = [];
        }
      }
      setTasks(parsedTasks);

      // Preserve explicit empty assignedStudentIds if user deselected all students
      const hasExplicitTaskAssignees =
        parsedTasks.length > 0 && Array.isArray(parsedTasks[0]?.assignedStudentIds);
      const firstTaskAssigned = hasExplicitTaskAssignees
        ? parsedTasks[0].assignedStudentIds
        : parsedStudents.map((s) => s.id);
      setAssignedStudentIds(firstTaskAssigned);

      let parsedProgress: Record<string, number> = {};
      if (explicitProgress && typeof explicitProgress === "object") {
        parsedProgress = explicitProgress;
      } else {
        try {
          parsedProgress = JSON.parse(rec.progressJson || "{}");
        } catch {
          parsedProgress = {};
        }
      }
      setProgressMap(parsedProgress);

      setStatus(rec.status || "DRAFT");
      setDraftVersion(rec.draftVersion || 1);
      setVerifiedAt(rec.verifiedAt || null);
      setErrorMessage(rec.errorMessage || null);
      setHasUnsavedLocalEdits(false);
    },
    []
  );

  const markLocalEdit = useCallback(() => {
    setHasUnsavedLocalEdits(true);
    setStatus((prev) =>
      prev === "VERIFIED" || prev === "APPROVED" ? "WAITING_APPROVAL" : prev
    );
  }, []);

  const loadClassProjectData = useCallback(
    async (rawCode: string, forceRefresh = false) => {
      const cleanCode = String(rawCode || "").trim().toUpperCase();
      if (!cleanCode) return;

      const reqSeq = ++activeLoadSeqRef.current;
      loadedClassCodeRef.current = "";
      setLoadedClassCode("");
      setIsLoadingClass(true);
      setBanner(null);

      try {
        try {
          window.localStorage.setItem("mindx_last_class_code", cleanCode);
        } catch {
          // ignore storage errors
        }

        const res = await fetch(
          `/api/teaching-projects?classCode=${encodeURIComponent(cleanCode)}&force=${
            forceRefresh ? "1" : "0"
          }`
        );
        const data = await res.json();
        if (reqSeq !== activeLoadSeqRef.current) return;

        if (!res.ok || (!data.success && !data.record)) {
          throw new Error(data.error || "Không thể tải dữ liệu dự án từ Teaching.");
        }

        if (Array.isArray(data.classes) && data.classes.length > 0) {
          setClasses(data.classes);
        }
        setCourseName(data.courseName || "");
        if (data.dateSource) {
          setDateSourceLabel(
            data.dateSource === "TEACHING"
              ? "Từ dự án Teaching"
              : data.dateSource === "LMS_CACHE"
              ? "Từ bảng Classes LMS"
              : data.dateSource === "SQLITE_EXACT"
              ? "Từ lịch 14 buổi LMS"
              : data.dateSource === "SQLITE_ESTIMATED"
              ? "Ước tính từ lịch học LMS"
              : ""
          );
        } else {
          setDateSourceLabel("");
        }

        if (data.record) {
          applyRecordAndTasksState(
            data.record,
            data.tasks,
            data.students,
            data.progress
          );
        }

        if (data.error) {
          setBanner({
            type: "warning",
            text: `Đang hiển thị bản lưu cục bộ (chưa kết nối được Teaching: ${data.error})`,
          });
        } else if (data.hasRemoteProject) {
          setBanner({
            type: "info",
            text: `Đã tải dữ liệu dự án lớp ${cleanCode} (ID dự án #${
              data.record?.teachingProjectId || "?"
            }, ${data.remoteTaskCount || 0} công việc hiện có trên Teaching${
              data.wasAutoCompletedToFive
                ? " — đã gợi ý đủ 5 phần công việc chuẩn, chờ duyệt"
                : ""
            }).`,
          });
        } else {
          setBanner({
            type: "info",
            text: `Lớp ${cleanCode} chưa có Dự án cuối khóa trên Teaching. Hệ thống đã điền sẵn tên dự án, ngày bắt đầu/kết thúc LMS và bộ 5 công việc chuẩn.`,
          });
        }
      } catch (err: unknown) {
        if (reqSeq !== activeLoadSeqRef.current) return;
        const message = err instanceof Error ? err.message : String(err);
        setBanner({ type: "error", text: message });
      } finally {
        if (reqSeq === activeLoadSeqRef.current) {
          setIsLoadingClass(false);
        }
      }
    },
    [applyRecordAndTasksState]
  );

  // Initial load of class list — F04: use forceRefresh=false to preserve any saved local draft
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/teaching-projects");
        const data = await res.json();
        if (!mounted || !data.success) return;

        const list: RunningClassOption[] = Array.isArray(data.classes) ? data.classes : [];
        setClasses(list);

        let initialCode = "";
        try {
          initialCode =
            window.localStorage.getItem("mindx_last_class_code")?.trim().toUpperCase() || "";
        } catch {
          initialCode = "";
        }
        if (!initialCode && list.length > 0) {
          initialCode = list[0].classCode;
        }
        if (initialCode) {
          setSelectedClassCode(initialCode);
          setCustomClassInput(initialCode);
          loadClassProjectData(initialCode, false);
        }
      } catch {
        // ignore initial fetch error
      }
    })();
    return () => {
      mounted = false;
    };
  }, [loadClassProjectData]);

  // F04: Switching class from dropdown uses forceRefresh=false so saved drafts are preserved
  const handleSelectClassChange = (code: string) => {
    const clean = code.trim().toUpperCase();
    setSelectedClassCode(clean);
    setCustomClassInput(clean);
    if (clean) {
      loadClassProjectData(clean, false);
    }
  };

  // Explicit button to load/refresh from Teaching
  const handleLoadManualClass = (forceRefresh = false) => {
    const clean = customClassInput.trim().toUpperCase();
    if (!clean) {
      setBanner({ type: "warning", text: "Vui lòng nhập hoặc chọn mã lớp (VD: VT-C4K-GA38)." });
      return;
    }
    setSelectedClassCode(clean);
    loadClassProjectData(clean, forceRefresh);
  };

  const activeClassCode = (selectedClassCode || customClassInput).trim().toUpperCase();
  const isClassReady =
    Boolean(activeClassCode) &&
    loadedClassCode === activeClassCode &&
    !isLoadingClass;
  const isAnyMutationBusy =
    isLoadingClass ||
    isFetchingLmsDates ||
    isGeneratingAi ||
    isSavingDraft ||
    isSyncingTeaching ||
    isUpdatingProgress;

  const handleFetchDatesFromLms = async () => {
    const reqClass = loadedClassCodeRef.current;
    const reqSeq = activeLoadSeqRef.current;
    const reqVersion = draftVersion;
    if (!reqClass || reqClass !== activeClassCode || isLoadingClass) return;

    setIsFetchingLmsDates(true);
    setBanner(null);
    try {
      const res = await fetch("/api/teaching-projects/fetch-lms-dates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classCode: reqClass,
          expectedVersion: reqVersion,
        }),
      });
      const data = await res.json();
      if (activeLoadSeqRef.current !== reqSeq || loadedClassCodeRef.current !== reqClass) {
        return;
      }

      if (!res.ok || !data.success || data.source !== "LMS_LIVE") {
        throw new Error(data.error || "Không thể lấy ngày bắt đầu/kết thúc trực tiếp từ LMS.");
      }

      if (data.record && String(data.record.classId || "").toUpperCase() === reqClass) {
        applyRecordAndTasksState(data.record);
      }
      setDateSourceLabel("Quét trực tiếp từ bảng Classes LMS");
      setBanner({
        type: "success",
        text: `Đã lấy ngày chuẩn trực tiếp từ LMS cho lớp ${reqClass}: Bắt đầu ${
          data.startDateIso
        } — Kết thúc ${data.endDateIso} (đã đồng bộ Deadline 5 công việc).`,
      });
    } catch (err: unknown) {
      if (activeLoadSeqRef.current !== reqSeq || loadedClassCodeRef.current !== reqClass) {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setBanner({ type: "error", text: message });
    } finally {
      if (activeLoadSeqRef.current === reqSeq) {
        setIsFetchingLmsDates(false);
      }
    }
  };

  const handleGenerateTasks = async (mode: "ai" | "template") => {
    const reqClass = loadedClassCodeRef.current;
    const reqSeq = activeLoadSeqRef.current;
    const reqVersion = draftVersion;
    if (!reqClass || reqClass !== activeClassCode || isLoadingClass) return;

    setIsGeneratingAi(true);
    setBanner(null);
    try {
      const res = await fetch("/api/teaching-projects/generate-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classCode: reqClass,
          mode,
          expectedVersion: reqVersion,
          endDate,
          courseName,
          assignedStudentIds,
          existingTasks: tasks,
          teacherHint,
        }),
      });
      const data = await res.json();
      if (activeLoadSeqRef.current !== reqSeq || loadedClassCodeRef.current !== reqClass) {
        return;
      }

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Không thể tạo bộ 5 công việc.");
      }
      if (data.record && String(data.record.classId || "").toUpperCase() === reqClass) {
        applyRecordAndTasksState(data.record, data.tasks);
      } else if (Array.isArray(data.tasks)) {
        setTasks(data.tasks);
      }
      setBanner({
        type: "success",
        text: data.usedAi
          ? `✨ AI đã soạn xong bộ 5 phần công việc (20% × 5 = 100%) bám sát giáo trình ${
              courseName || reqClass
            }.`
          : `📋 Đã áp dụng bộ 5 phần công việc chuẩn (${
              courseName || "MindX"
            }) với tổng tỷ trọng 100%.`,
      });
    } catch (err: unknown) {
      if (activeLoadSeqRef.current !== reqSeq || loadedClassCodeRef.current !== reqClass) {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setBanner({ type: "error", text: message });
    } finally {
      if (activeLoadSeqRef.current === reqSeq) {
        setIsGeneratingAi(false);
      }
    }
  };

  const handleSyncAllDeadlinesToEndDate = () => {
    if (!isClassReady) return;
    if (!endDate) {
      setBanner({
        type: "warning",
        text: "Vui lòng chọn Ngày kết thúc khóa học trước khi đồng bộ Deadline.",
      });
      return;
    }
    markLocalEdit();
    setTasks((prev) =>
      prev.map((task) => ({
        ...task,
        deadline: endDate,
      }))
    );
    setBanner({
      type: "info",
      text: `Đã gán Deadline của cả 5 phần công việc = ${endDate} (Ngày kết thúc khóa học).`,
    });
  };

  const handleToggleStudent = (studentId: number) => {
    if (!isClassReady) return;
    markLocalEdit();
    setAssignedStudentIds((prev) => {
      const exists = prev.includes(studentId);
      const next = exists ? prev.filter((id) => id !== studentId) : [...prev, studentId];
      setTasks((currTasks) =>
        currTasks.map((t) => ({
          ...t,
          assignedStudentIds: next,
        }))
      );
      return next;
    });
  };

  const handleToggleAllStudents = () => {
    if (!isClassReady) return;
    markLocalEdit();
    const allIds = students.map((s) => s.id);
    const isAllSelected =
      allIds.length > 0 && allIds.every((id) => assignedStudentIds.includes(id));
    const next = isAllSelected ? [] : allIds;
    setAssignedStudentIds(next);
    setTasks((currTasks) =>
      currTasks.map((t) => ({
        ...t,
        assignedStudentIds: next,
      }))
    );
  };

  const handleTaskFieldChange = (
    slotIndex: number,
    field: "taskName" | "description" | "weightPercent" | "deadline",
    value: string | number
  ) => {
    if (!isClassReady) return;
    markLocalEdit();
    setTasks((prev) =>
      prev.map((t) => {
        if (t.slotIndex !== slotIndex) return t;
        if (field === "weightPercent") {
          return { ...t, weightPercent: Number(value) || 0 };
        }
        return { ...t, [field]: String(value) };
      })
    );
  };

  const handleSaveDraftOrApprove = async (approve: boolean) => {
    const reqClass = loadedClassCodeRef.current;
    const reqSeq = activeLoadSeqRef.current;
    const reqVersion = draftVersion;
    if (!reqClass || reqClass !== activeClassCode || isLoadingClass) return;

    setIsSavingDraft(true);
    setBanner(null);
    try {
      const res = await fetch("/api/teaching-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classCode: reqClass,
          action: approve ? "approve_and_save" : "save_draft",
          expectedVersion: reqVersion,
          projectName,
          startDate,
          endDate,
          description,
          tasks: tasks.map((t) => ({
            ...t,
            assignedStudentIds,
          })),
        }),
      });
      const data = await res.json();
      if (activeLoadSeqRef.current !== reqSeq || loadedClassCodeRef.current !== reqClass) {
        return;
      }

      if (data.record && String(data.record.classId || "").toUpperCase() === reqClass) {
        applyRecordAndTasksState(data.record, data.tasks);
      }
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Không thể lưu bản nháp dự án.");
      }

      setBanner({
        type: "success",
        text: approve
          ? "✅ Đã duyệt cấu hình Dự án & 5 Công việc (chốt mã kiểm tra SHA-256)."
          : "💾 Đã lưu bản nháp cấu hình dự án vào bộ nhớ cục bộ.",
      });
    } catch (err: unknown) {
      if (activeLoadSeqRef.current !== reqSeq || loadedClassCodeRef.current !== reqClass) {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setBanner({ type: "error", text: message });
    } finally {
      if (activeLoadSeqRef.current === reqSeq) {
        setIsSavingDraft(false);
      }
    }
  };

  const handleApproveAndSyncToTeaching = async () => {
    const reqClass = loadedClassCodeRef.current;
    const reqSeq = activeLoadSeqRef.current;
    const reqVersion = draftVersion;
    if (!reqClass || reqClass !== activeClassCode || isLoadingClass) return;

    setIsSyncingTeaching(true);
    setBanner(null);
    try {
      const res = await fetch("/api/teaching-projects/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classCode: reqClass,
          expectedVersion: reqVersion,
          projectName,
          startDate,
          endDate,
          description,
          tasks: tasks.map((t) => ({
            ...t,
            assignedStudentIds,
          })),
          cleanupExtraTasks: true,
        }),
      });
      const data = await res.json();
      if (activeLoadSeqRef.current !== reqSeq || loadedClassCodeRef.current !== reqClass) {
        return;
      }

      if (data.record && String(data.record.classId || "").toUpperCase() === reqClass) {
        applyRecordAndTasksState(data.record, data.tasks);
      }
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Đồng bộ lên Teaching thất bại.");
      }

      setBanner({
        type: "success",
        text: `🎉 Đã tạo/cập nhật Dự án "${
          data.record?.projectName || projectName
        }" và đủ 5 Phần công việc lên Teaching thành công (Đã đối chiếu Read-after-Write VERIFIED)!`,
      });
    } catch (err: unknown) {
      if (activeLoadSeqRef.current !== reqSeq || loadedClassCodeRef.current !== reqClass) {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setBanner({ type: "error", text: message });
    } finally {
      if (activeLoadSeqRef.current === reqSeq) {
        setIsSyncingTeaching(false);
      }
    }
  };

  const handleBulkMilestoneUpdate = async (completedTaskCount: number) => {
    const reqClass = loadedClassCodeRef.current;
    const reqSeq = activeLoadSeqRef.current;
    if (!reqClass || reqClass !== activeClassCode || isLoadingClass) return;

    setIsUpdatingProgress(true);
    setBanner(null);
    try {
      const res = await fetch("/api/teaching-projects/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classCode: reqClass,
          milestoneTaskCount: completedTaskCount,
          resetOthers: true,
        }),
      });
      const data = await res.json();
      if (activeLoadSeqRef.current !== reqSeq || loadedClassCodeRef.current !== reqClass) {
        return;
      }

      if (data.progress) {
        setProgressMap(data.progress);
      }
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Không thể cập nhật tiến độ hàng loạt trên Teaching.");
      }
      setBanner({
        type: "success",
        text: `⚡ Đã cập nhật tiến độ cả lớp trên Teaching: Hoàn thành ${completedTaskCount}/5 phần công việc (${
          completedTaskCount * 20
        }%) — đã kiểm tra Read-after-Write (${data.updatedCount || 0} ô).`,
      });
    } catch (err: unknown) {
      if (activeLoadSeqRef.current !== reqSeq || loadedClassCodeRef.current !== reqClass) {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setBanner({ type: "error", text: message });
    } finally {
      if (activeLoadSeqRef.current === reqSeq) {
        setIsUpdatingProgress(false);
      }
    }
  };

  const handleUpdateSingleTaskAllStudents = async (remoteTaskId: number, percent: number) => {
    const reqClass = loadedClassCodeRef.current;
    const reqSeq = activeLoadSeqRef.current;
    if (!reqClass || reqClass !== activeClassCode || !remoteTaskId || isLoadingClass) return;

    const targetStudents =
      assignedStudentIds.length > 0 ? assignedStudentIds : students.map((s) => s.id);
    if (targetStudents.length === 0) return;

    setIsUpdatingProgress(true);
    setBanner(null);
    try {
      const updates = targetStudents.map((studentId) => ({
        taskId: remoteTaskId,
        studentId,
        progressPercent: percent,
      }));
      const res = await fetch("/api/teaching-projects/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classCode: reqClass, updates }),
      });
      const data = await res.json();
      if (activeLoadSeqRef.current !== reqSeq || loadedClassCodeRef.current !== reqClass) {
        return;
      }

      if (data.progress) {
        setProgressMap(data.progress);
      }
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Không thể cập nhật tiến độ công việc.");
      }
      setBanner({
        type: "success",
        text: `✅ Đã cập nhật công việc #${remoteTaskId} đạt ${percent}% cho ${targetStudents.length} học sinh trên Teaching.`,
      });
    } catch (err: unknown) {
      if (activeLoadSeqRef.current !== reqSeq || loadedClassCodeRef.current !== reqClass) {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setBanner({ type: "error", text: message });
    } finally {
      if (activeLoadSeqRef.current === reqSeq) {
        setIsUpdatingProgress(false);
      }
    }
  };

  const handleUpdateSingleCellProgress = async (
    remoteTaskId: number,
    studentId: number,
    percent: number
  ) => {
    const reqClass = loadedClassCodeRef.current;
    const reqSeq = activeLoadSeqRef.current;
    if (!reqClass || reqClass !== activeClassCode || !remoteTaskId || !studentId || isLoadingClass) {
      return;
    }

    const key = `${remoteTaskId}_${studentId}`;
    setProgressMap((prev) => ({ ...prev, [key]: percent }));

    setIsUpdatingProgress(true);
    try {
      const res = await fetch("/api/teaching-projects/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classCode: reqClass,
          updates: [{ taskId: remoteTaskId, studentId, progressPercent: percent }],
        }),
      });
      const data = await res.json();
      if (activeLoadSeqRef.current !== reqSeq || loadedClassCodeRef.current !== reqClass) {
        return;
      }

      if (data.progress) {
        setProgressMap(data.progress);
      }
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Lỗi cập nhật tiến độ học sinh.");
      }
    } catch (err: unknown) {
      if (activeLoadSeqRef.current !== reqSeq || loadedClassCodeRef.current !== reqClass) {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setBanner({ type: "error", text: message });
    } finally {
      if (activeLoadSeqRef.current === reqSeq) {
        setIsUpdatingProgress(false);
      }
    }
  };

  const totalWeightPercent = useMemo(
    () => tasks.reduce((sum, item) => sum + (Number(item.weightPercent) || 0), 0),
    [tasks]
  );

  const allTasksHaveRemoteIds = useMemo(
    () =>
      tasks.length === 5 &&
      tasks.every((t) => Number.isInteger(t.taskId) && Number(t.taskId) > 0),
    [tasks]
  );

  const countdown = useMemo(() => computeCountdownBadge(endDate), [endDate]);

  const studentOverallProgressList = useMemo(() => {
    return students.map((stu) => {
      let weightedDone = 0;
      let completedTasks = 0;
      for (const task of tasks) {
        const tid = task.taskId;
        const pct = tid ? Number(progressMap[`${tid}_${stu.id}`] ?? 0) : 0;
        weightedDone += (pct * (Number(task.weightPercent) || 20)) / 100;
        if (pct >= 100) completedTasks += 1;
      }
      const overall = Math.round(weightedDone);
      return {
        ...stu,
        overallPercent: overall,
        completedTasks,
        isAssigned: assignedStudentIds.includes(stu.id),
      };
    });
  }, [students, tasks, progressMap, assignedStudentIds]);

  const shortNameOption = getShortProjectName(activeClassCode);
  const fullNameOption = getFullProjectName(activeClassCode);

  return (
    <div className="space-y-5 pb-10">
      {/* Hero Header */}
      <div className="mindx-hero px-5 py-4 rounded-2xl transition-all">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white">
                🎯 Dự Án Cuối Khóa &amp; Báo Cáo Tiến Độ Teaching
              </h1>
              {status === "VERIFIED" && !hasUnsavedLocalEdits ? (
                <span className="mindx-dark-keep px-3 py-0.5 rounded-full text-xs font-bold bg-emerald-700 text-white border border-emerald-400/50">
                  ✓ ĐÃ ĐỒNG BỘ TEACHING (VERIFIED)
                </span>
              ) : status === "APPROVED" && !hasUnsavedLocalEdits ? (
                <span className="mindx-dark-keep px-3 py-0.5 rounded-full text-xs font-bold bg-indigo-700 text-white border border-indigo-400/50">
                  ✓ ĐÃ DUYỆT (CHỜ ĐẨY TEACHING)
                </span>
              ) : status === "FAILED" ? (
                <span className="mindx-dark-keep px-3 py-0.5 rounded-full text-xs font-bold bg-rose-700 text-white border border-rose-400/50">
                  ⚠ LỖI ĐỒNG BỘ TEACHING
                </span>
              ) : (
                <span className="mindx-dark-keep px-3 py-0.5 rounded-full text-xs font-bold bg-slate-700 text-white border border-slate-500/60">
                  📝 BẢN NHÁP / CHỜ DUYỆT
                </span>
              )}
            </div>
            <p className="mindx-hero-sub mt-1 text-xs sm:text-sm">
              Tự động lấy ngày bắt đầu &amp; kết thúc khóa học từ LMS, dùng AI soạn đủ 5 phần công việc (20% &times; 5 = 100%, Deadline = Ngày kết khóa) và cập nhật tiến độ học sinh lên{" "}
              <code className="px-1.5 py-0.5 rounded bg-black/25 text-white font-mono text-xs">
                teachingmindx.top/hocsinh.php
              </code>
              .
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activeClassCode && (
              <a
                href={`https://teachingmindx.top/duan_tiendo_hocsinh.php?class_code=${encodeURIComponent(
                  activeClassCode
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mindx-dark-keep px-3.5 py-1.5 rounded-xl text-xs font-bold bg-blue-700 hover:bg-blue-800 text-white border border-blue-400/50 flex items-center gap-1.5 transition"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Xem trang Báo cáo Phụ huynh</span>
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Status Banner */}
      {banner && (
        <div
          className={`px-4 py-3 rounded-xl border text-xs sm:text-sm font-medium flex items-start justify-between gap-3 ${
            banner.type === "success"
              ? "mindx-card-emerald"
              : banner.type === "error"
              ? "bg-rose-800 border-rose-500 text-white mindx-dark-keep"
              : banner.type === "warning"
              ? "mindx-card-amber"
              : "mindx-card-blue"
          }`}
        >
          <div className="flex items-start gap-2">
            {banner.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            )}
            <span>{banner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-xs underline opacity-80 hover:opacity-100 shrink-0 cursor-pointer"
          >
            Đóng
          </button>
        </div>
      )}

      {/* KHUNG 1: Chọn lớp & Thông tin Dự án Cuối khóa */}
      <section className="mindx-card mindx-card-blue p-4 sm:p-5 rounded-2xl space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-700/50 pb-3">
          <div>
            <h2 className="text-base sm:text-lg font-bold flex items-center gap-2">
              <span>1. Chọn Lớp &amp; Thông Tin Dự Án Cuối Khóa</span>
              {remoteProjectId ? (
                <span className="mindx-dark-keep bg-emerald-700 text-white text-xs font-bold px-2.5 py-0.5 rounded-full">
                  Đã có trên Teaching (#{remoteProjectId})
                </span>
              ) : (
                <span className="mindx-dark-keep bg-amber-800 text-white text-xs font-bold px-2.5 py-0.5 rounded-full">
                  Chưa tạo trên Teaching
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Tên dự án tự tạo theo mã lớp; ngày bắt đầu &amp; kết thúc tự động lấy từ lịch học 14 buổi hoặc bảng Classes bên LMS.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`mindx-dark-keep px-3 py-1 rounded-full text-xs font-bold ${
                countdown.tone === "emerald"
                  ? "bg-emerald-700 text-white"
                  : countdown.tone === "amber"
                  ? "bg-amber-800 text-white"
                  : "bg-slate-700 text-white"
              }`}
            >
              {countdown.label}
            </span>
            {dateSourceLabel && (
              <span className="mindx-dark-keep bg-blue-700 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                📅 {dateSourceLabel}
              </span>
            )}
          </div>
        </div>

        {/* Row 1: Class Selector + Action Buttons */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
          <div className="lg:col-span-4">
            <label className="block text-xs font-bold mb-1">
              Chọn từ danh sách lớp đã đồng bộ LMS:
            </label>
            <select
              value={selectedClassCode}
              disabled={isAnyMutationBusy}
              onChange={(e) => handleSelectClassChange(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-600/80 bg-slate-900/90 text-white text-sm font-semibold disabled:opacity-60"
            >
              <option value="">-- Chọn mã lớp --</option>
              {classes.map((cls) => (
                <option key={cls.classCode} value={cls.classCode}>
                  {cls.classCode}{" "}
                  {cls.startDate && cls.endDate
                    ? `(${cls.startDate} → ${cls.endDate})`
                    : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-4">
            <label className="block text-xs font-bold mb-1">
              Hoặc nhập mã lớp trực tiếp (như ô lọc trang Teaching):
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customClassInput}
                disabled={isAnyMutationBusy}
                onChange={(e) => setCustomClassInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleLoadManualClass(false);
                }}
                placeholder="VD: VT-C4K-GA38"
                className="w-full px-3 py-2 rounded-xl border border-slate-600/80 bg-slate-900/90 text-white text-sm font-mono font-bold disabled:opacity-60"
              />
            </div>
          </div>

          <div className="lg:col-span-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleLoadManualClass(true)}
              disabled={isAnyMutationBusy}
              className="mindx-dark-keep px-3.5 py-2 rounded-xl text-xs font-bold bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white flex items-center gap-1.5 cursor-pointer transition"
            >
              {isLoadingClass ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              <span>Đọc mới từ Teaching</span>
            </button>

            <button
              type="button"
              onClick={handleFetchDatesFromLms}
              disabled={!isClassReady || isAnyMutationBusy}
              className="mindx-dark-keep px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white flex items-center gap-1.5 cursor-pointer transition"
            >
              {isFetchingLmsDates ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Calendar className="w-4 h-4" />
              )}
              <span>Lấy ngày chuẩn từ LMS</span>
            </button>
          </div>
        </div>

        {/* Row 2: Project Form Fields (Image 2 equivalent) */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-2">
          <div className="md:col-span-5">
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold">Tên dự án *:</label>
              {isClassReady && (
                <div className="flex items-center gap-1.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => {
                      markLocalEdit();
                      setProjectName(shortNameOption);
                    }}
                    className="mindx-dark-keep px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-800 mindx-dark-btn text-white border border-slate-500 cursor-pointer"
                  >
                    {shortNameOption}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      markLocalEdit();
                      setProjectName(fullNameOption);
                    }}
                    className="mindx-dark-keep px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-800 mindx-dark-btn text-white border border-slate-500 cursor-pointer"
                  >
                    {fullNameOption}
                  </button>
                </div>
              )}
            </div>
            <input
              type="text"
              value={projectName}
              disabled={!isClassReady}
              onChange={(e) => {
                markLocalEdit();
                setProjectName(e.target.value);
              }}
              placeholder="VD: SPCK - GA38"
              className="w-full px-3 py-2 rounded-xl border border-slate-600/80 bg-slate-900/90 text-white text-sm font-bold disabled:opacity-60"
            />
          </div>

          <div className="md:col-span-3">
            <label className="block text-xs font-bold mb-1">
              Ngày bắt đầu * (Buổi 1 LMS):
            </label>
            <input
              type="date"
              value={startDate}
              disabled={!isClassReady}
              onChange={(e) => {
                markLocalEdit();
                setStartDate(e.target.value);
              }}
              className="w-full px-3 py-2 rounded-xl border border-slate-600/80 bg-slate-900/90 text-white text-sm font-semibold disabled:opacity-60"
            />
          </div>

          <div className="md:col-span-4">
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold">
                Ngày kết thúc * (Buổi 14 LMS):
              </label>
              <button
                type="button"
                disabled={!isClassReady}
                onClick={handleSyncAllDeadlinesToEndDate}
                className="text-[11px] font-bold underline text-sky-400 hover:text-sky-300 disabled:opacity-50 cursor-pointer"
              >
                Gán cho 5 Deadline
              </button>
            </div>
            <input
              type="date"
              value={endDate}
              disabled={!isClassReady}
              onChange={(e) => {
                const val = e.target.value;
                markLocalEdit();
                setEndDate(val);
                if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
                  setTasks((prev) =>
                    prev.map((t) => ({
                      ...t,
                      deadline: val,
                    }))
                  );
                }
              }}
              className="w-full px-3 py-2 rounded-xl border border-slate-600/80 bg-slate-900/90 text-white text-sm font-semibold disabled:opacity-60"
            />
          </div>

          <div className="md:col-span-12">
            <label className="block text-xs font-bold mb-1">
              Mô tả dự án (tùy chọn):
            </label>
            <input
              type="text"
              value={description}
              disabled={!isClassReady}
              onChange={(e) => {
                markLocalEdit();
                setDescription(e.target.value);
              }}
              placeholder="Mô tả ngắn gọn về mục tiêu sản phẩm cuối khóa của lớp..."
              className="w-full px-3 py-2 rounded-xl border border-slate-600/80 bg-slate-900/90 text-white text-sm disabled:opacity-60"
            />
          </div>
        </div>
      </section>

      {/* KHUNG 2: Danh sách Học sinh & Bộ 5 Phần Công Việc (20% × 5 = 100%) */}
      <section className="mindx-card mindx-card-emerald p-4 sm:p-5 rounded-2xl space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-700/50 pb-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base sm:text-lg font-bold">
                2. Bộ 5 Phần Công Việc Chuẩn (Timeline Làm Sản Phẩm Cuối Khóa)
              </h2>
              {courseName && (
                <span className="mindx-dark-keep bg-indigo-700 text-white text-xs font-bold px-2.5 py-0.5 rounded-full">
                  📚 {courseName}
                </span>
              )}
              <span
                className={`mindx-dark-keep text-xs font-bold px-2.5 py-0.5 rounded-full ${
                  Math.abs(totalWeightPercent - 100) <= 0.01 && tasks.length === 5
                    ? "bg-emerald-700 text-white"
                    : "bg-rose-700 text-white"
                }`}
              >
                Tổng tỷ trọng: {totalWeightPercent}% ({tasks.length}/5 công việc)
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Theo quy tắc chuẩn: mỗi lớp có đúng 5 phần công việc (mỗi phần 20%), có tiêu đề chung và mô tả chi tiết, Deadline = Ngày kết khóa ({endDate || "chưa chọn"}).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleGenerateTasks("template")}
              disabled={!isClassReady || isAnyMutationBusy}
              className="mindx-dark-keep px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-700 hover:bg-slate-800 mindx-dark-btn disabled:opacity-60 text-white flex items-center gap-1.5 cursor-pointer transition"
            >
              <ClipboardList className="w-3.5 h-3.5" />
              <span>Dùng mẫu chuẩn của môn</span>
            </button>

            <button
              type="button"
              onClick={() => handleGenerateTasks("ai")}
              disabled={!isClassReady || isAnyMutationBusy}
              className="mindx-dark-keep px-3.5 py-1.5 rounded-xl text-xs font-bold bg-indigo-700 hover:bg-indigo-800 disabled:opacity-60 text-white flex items-center gap-1.5 cursor-pointer transition"
            >
              {isGeneratingAi ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>AI Soạn 5 Công việc theo Giáo trình</span>
            </button>
          </div>
        </div>

        {/* Optional AI Hint Input */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <span className="text-xs font-bold shrink-0">
            Gợi ý chủ đề thêm cho AI (tùy chọn):
          </span>
          <input
            type="text"
            value={teacherHint}
            disabled={!isClassReady}
            onChange={(e) => setTeacherHint(e.target.value)}
            placeholder="VD: Làm game bắn thiên thạch / Website bán hàng / Robot xe tự hành tránh vật cản..."
            className="flex-1 px-3 py-1.5 rounded-xl border border-slate-600/80 bg-slate-900/90 text-white text-xs disabled:opacity-60"
          />
        </div>

        {/* Assigned Students Selection Box (Image 4 equivalent) */}
        <div className="p-3.5 rounded-xl border border-slate-700/70 bg-slate-900/60 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold">
              <Users className="w-4 h-4 text-emerald-400" />
              <span>
                Giao cho học sinh ({assignedStudentIds.length}/{students.length} học sinh đang chọn):
              </span>
            </div>
            {students.length > 0 && (
              <button
                type="button"
                disabled={!isClassReady}
                onClick={handleToggleAllStudents}
                className="mindx-dark-keep px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-700 hover:bg-slate-800 mindx-dark-btn disabled:opacity-60 text-white cursor-pointer"
              >
                {assignedStudentIds.length === students.length
                  ? "Bỏ chọn tất cả"
                  : "✓ Chọn tất cả học sinh"}
              </button>
            )}
          </div>

          {students.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
              {students.map((stu) => {
                const checked = assignedStudentIds.includes(stu.id);
                return (
                  <label
                    key={stu.id}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer transition ${
                      checked
                        ? "border-emerald-500/70 bg-emerald-950/50 text-white"
                        : "border-slate-700/70 bg-slate-900/40 text-slate-400"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!isClassReady}
                      onChange={() => handleToggleStudent(stu.id)}
                      className="rounded accent-emerald-500"
                    />
                    <span className="truncate" title={stu.studentName}>
                      {stu.studentName}
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-400">
              Chưa có danh sách học sinh từ Teaching cho lớp này. Hãy bấm &ldquo;Đọc mới từ Teaching&rdquo; sau khi nhập mã lớp đúng.
            </p>
          )}
        </div>

        {/* 5 Task Cards */}
        <div className="grid grid-cols-1 gap-3">
          {tasks.map((task) => {
            const isDeadlineValid =
              /^\d{4}-\d{2}-\d{2}$/.test(task.deadline) && task.deadline !== "0000-00-00";
            return (
              <div
                key={task.slotIndex}
                className="p-3.5 rounded-xl border border-slate-700/80 bg-slate-900/75 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="mindx-dark-keep px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-emerald-700 text-white">
                      Phần {task.slotIndex}/5
                    </span>
                    {task.taskId ? (
                      <span className="mindx-dark-keep bg-blue-700 text-white text-[11px] font-bold px-2 py-0.5 rounded-full">
                        Teaching Task #{task.taskId}
                      </span>
                    ) : (
                      <span className="mindx-dark-keep bg-amber-800 text-white text-[11px] font-bold px-2 py-0.5 rounded-full">
                        Sẽ thêm mới lên Teaching
                      </span>
                    )}
                    {!isDeadlineValid && (
                      <span className="mindx-dark-keep bg-rose-700 text-white text-[11px] font-bold px-2 py-0.5 rounded-full">
                        ⚠ Thiếu Deadline
                      </span>
                    )}
                  </div>

                  <span className="text-xs text-slate-400">
                    Giao cho:{" "}
                    <strong className="text-white">
                      {assignedStudentIds.length} học sinh
                    </strong>
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5">
                  <div className="md:col-span-7">
                    <label className="block text-[11px] font-bold mb-1">
                      Công việc * (Tiêu đề phần công việc chung):
                    </label>
                    <input
                      type="text"
                      value={task.taskName}
                      disabled={!isClassReady}
                      onChange={(e) =>
                        handleTaskFieldChange(task.slotIndex, "taskName", e.target.value)
                      }
                      placeholder="VD: 1. Lên ý tưởng & thiết kế bố cục sản phẩm"
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-600/80 bg-slate-950/90 text-white text-xs sm:text-sm font-bold disabled:opacity-60"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-[11px] font-bold mb-1">
                      Tỷ trọng (%) *:
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={task.weightPercent}
                      disabled={!isClassReady}
                      onChange={(e) =>
                        handleTaskFieldChange(
                          task.slotIndex,
                          "weightPercent",
                          Number(e.target.value)
                        )
                      }
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-600/80 bg-slate-950/90 text-white text-xs sm:text-sm font-bold text-center disabled:opacity-60"
                    />
                  </div>

                  <div className="md:col-span-3">
                    <label className="block text-[11px] font-bold mb-1">
                      Deadline (Ngày kết khóa):
                    </label>
                    <input
                      type="date"
                      value={isDeadlineValid ? task.deadline : ""}
                      disabled={!isClassReady}
                      onChange={(e) =>
                        handleTaskFieldChange(task.slotIndex, "deadline", e.target.value)
                      }
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-600/80 bg-slate-950/90 text-white text-xs sm:text-sm font-semibold disabled:opacity-60"
                    />
                  </div>

                  <div className="md:col-span-12">
                    <label className="block text-[11px] font-bold mb-1">
                      Mô tả công việc * (Các bước chi tiết học sinh cần hoàn thành):
                    </label>
                    <textarea
                      rows={2}
                      value={task.description}
                      disabled={!isClassReady}
                      onChange={(e) =>
                        handleTaskFieldChange(
                          task.slotIndex,
                          "description",
                          e.target.value
                        )
                      }
                      placeholder="Mô tả cụ thể các hạng mục học sinh cần làm trong giai đoạn này..."
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-600/80 bg-slate-950/90 text-white text-xs leading-relaxed disabled:opacity-60"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Action Bar: Save Draft / Approve & Sync to Teaching */}
        <div className="pt-2 border-t border-slate-700/60 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="text-xs text-slate-400">
            {verifiedAt ? (
              <span>
                Đã xác thực Read-after-Write lần cuối lúc:{" "}
                <strong className="text-white">
                  {new Date(verifiedAt).toLocaleString("vi-VN")}
                </strong>
              </span>
            ) : errorMessage ? (
              <span className="text-rose-400 font-semibold">
                Lỗi gần nhất: {errorMessage}
              </span>
            ) : (
              <span>
                Kiểm tra kỹ Tên dự án, Ngày bắt đầu/kết thúc và 5 phần công việc trước khi bấm Duyệt &amp; Đẩy lên Teaching.
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => handleSaveDraftOrApprove(false)}
              disabled={!isClassReady || isAnyMutationBusy}
              className="mindx-dark-keep px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-700 hover:bg-slate-800 mindx-dark-btn disabled:opacity-60 text-white flex items-center gap-1.5 cursor-pointer transition"
            >
              <Save className="w-4 h-4" />
              <span>Lưu nháp</span>
            </button>

            <button
              type="button"
              onClick={handleApproveAndSyncToTeaching}
              disabled={!isClassReady || isAnyMutationBusy}
              className="mindx-dark-keep px-4 py-2 rounded-xl text-xs sm:text-sm font-extrabold bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white flex items-center gap-2 cursor-pointer shadow-lg transition"
            >
              {isSyncingTeaching ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Rocket className="w-4 h-4" />
              )}
              <span>✅ Duyệt &amp; Đẩy Dự án + 5 Công việc lên Teaching</span>
            </button>
          </div>
        </div>
      </section>

      {/* KHUNG 3: Báo cáo Tiến độ Học sinh & Cập nhật % Hàng loạt (Image 5 equivalent) */}
      <section className="mindx-card mindx-card-amber p-4 sm:p-5 rounded-2xl space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-700/50 pb-3">
          <div>
            <h2 className="text-base sm:text-lg font-bold">
              3. Báo Cáo Tiến Độ Học Sinh &amp; Cập Nhật Nhanh Trên Teaching
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Chấm tiến độ nhanh theo từng mốc buổi học (20% &rarr; 40% &rarr; 60% &rarr; 80% &rarr; 100%) hoặc kéo thanh trượt cho từng học sinh như trên trang Teaching.
            </p>
          </div>

          {!allTasksHaveRemoteIds && (
            <span className="mindx-dark-keep px-3 py-1 rounded-full text-xs font-bold bg-amber-800 text-white">
              ⚠ Hãy bấm &ldquo;Duyệt &amp; Đẩy Dự án + 5 Công việc lên Teaching&rdquo; ở mục 2 trước khi cập nhật % tiến độ
            </span>
          )}
        </div>

        {/* 1-Click Class-Wide Milestone Bar */}
        <div className="p-3.5 rounded-xl border border-slate-700/70 bg-slate-900/65 space-y-2">
          <div className="text-xs font-bold flex items-center justify-between">
            <span>⚡ Cập nhật nhanh tiến độ cho CẢ LỚP theo mốc hoàn thành:</span>
            {isUpdatingProgress && (
              <span className="flex items-center gap-1 text-amber-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Đang đồng bộ lên Teaching...</span>
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!isClassReady || !allTasksHaveRemoteIds || isAnyMutationBusy}
              onClick={() => handleBulkMilestoneUpdate(1)}
              className="mindx-dark-keep px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white cursor-pointer transition"
            >
              Xong Việc 1 (20%)
            </button>
            <button
              type="button"
              disabled={!isClassReady || !allTasksHaveRemoteIds || isAnyMutationBusy}
              onClick={() => handleBulkMilestoneUpdate(2)}
              className="mindx-dark-keep px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white cursor-pointer transition"
            >
              Xong Việc 1–2 (40%)
            </button>
            <button
              type="button"
              disabled={!isClassReady || !allTasksHaveRemoteIds || isAnyMutationBusy}
              onClick={() => handleBulkMilestoneUpdate(3)}
              className="mindx-dark-keep px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-700 hover:bg-indigo-800 disabled:opacity-50 text-white cursor-pointer transition"
            >
              Xong Việc 1–3 (60% • Buổi 12)
            </button>
            <button
              type="button"
              disabled={!isClassReady || !allTasksHaveRemoteIds || isAnyMutationBusy}
              onClick={() => handleBulkMilestoneUpdate(4)}
              className="mindx-dark-keep px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-700 hover:bg-indigo-800 disabled:opacity-50 text-white cursor-pointer transition"
            >
              Xong Việc 1–4 (80% • Buổi 13)
            </button>
            <button
              type="button"
              disabled={!isClassReady || !allTasksHaveRemoteIds || isAnyMutationBusy}
              onClick={() => handleBulkMilestoneUpdate(5)}
              className="mindx-dark-keep px-3.5 py-1.5 rounded-lg text-xs font-extrabold bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white cursor-pointer transition"
            >
              🏆 Hoàn thành 100% cả 5 việc (Buổi 14)
            </button>
            <button
              type="button"
              disabled={!isClassReady || !allTasksHaveRemoteIds || isAnyMutationBusy}
              onClick={() => handleBulkMilestoneUpdate(0)}
              className="mindx-dark-keep px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-700 hover:bg-slate-800 mindx-dark-btn disabled:opacity-50 text-white cursor-pointer transition"
            >
              Đặt lại 0%
            </button>
          </div>
        </div>

        {/* Student Overall Progress Summary Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-700/70">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="mindx-thead">
              <tr>
                <th className="px-3 py-2.5 font-bold">#</th>
                <th className="px-3 py-2.5 font-bold">Học sinh</th>
                <th className="px-3 py-2.5 font-bold">Số việc hoàn thành</th>
                <th className="px-3 py-2.5 font-bold">Tiến độ tổng dự án</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {studentOverallProgressList.length > 0 ? (
                studentOverallProgressList.map((stu, idx) => (
                  <tr key={stu.id} className="hover:bg-slate-800/30">
                    <td className="px-3 py-2 font-mono">{idx + 1}</td>
                    <td className="px-3 py-2 font-bold">{stu.studentName}</td>
                    <td className="px-3 py-2">
                      <span className="mindx-dark-keep bg-blue-700 text-white px-2 py-0.5 rounded-full text-[11px] font-bold">
                        {stu.completedTasks}/5 công việc
                      </span>
                    </td>
                    <td className="px-3 py-2 w-64">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2.5 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 transition-all"
                            style={{ width: `${stu.overallPercent}%` }}
                          />
                        </div>
                        <span className="font-mono font-bold w-10 text-right">
                          {stu.overallPercent}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-slate-400">
                    Chưa có học sinh trong lớp này.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Detailed Per-Task & Per-Student Sliders (Image 5 Table) */}
        {allTasksHaveRemoteIds && students.length > 0 && (
          <div className="space-y-3 pt-2">
            <h3 className="text-sm font-bold">
              Bảng chi tiết từng phần công việc &amp; thanh kéo % từng học sinh:
            </h3>
            <div className="grid grid-cols-1 gap-3">
              {tasks.map((task) => {
                const remoteId = Number(task.taskId);
                return (
                  <div
                    key={task.slotIndex}
                    className="p-3.5 rounded-xl border border-slate-700/80 bg-slate-900/75 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                      <div>
                        <span className="font-bold text-xs sm:text-sm">
                          {task.taskName}
                        </span>
                        <span className="ml-2 text-xs text-slate-400">
                          (Tỷ trọng: {task.weightPercent}% • Hạn: {task.deadline})
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={!isClassReady || isAnyMutationBusy}
                          onClick={() => handleUpdateSingleTaskAllStudents(remoteId, 100)}
                          className="mindx-dark-keep px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white cursor-pointer"
                        >
                          ✓ Cả lớp Xong 100%
                        </button>
                        <button
                          type="button"
                          disabled={!isClassReady || isAnyMutationBusy}
                          onClick={() => handleUpdateSingleTaskAllStudents(remoteId, 0)}
                          className="mindx-dark-keep px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-700 hover:bg-slate-800 mindx-dark-btn disabled:opacity-50 text-white cursor-pointer"
                        >
                          0%
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                      {students.map((stu) => {
                        const cellKey = `${remoteId}_${stu.id}`;
                        const pct = Number(progressMap[cellKey] ?? 0);
                        const isDone = pct >= 100;
                        return (
                          <div
                            key={stu.id}
                            className="p-2.5 rounded-lg border border-slate-700/70 bg-slate-950/60 flex flex-col justify-between gap-1.5"
                          >
                            <div className="flex items-center justify-between gap-1 text-xs">
                              <span className="font-bold truncate" title={stu.studentName}>
                                {stu.studentName}
                              </span>
                              <span
                                className={`font-mono font-bold text-[11px] px-1.5 py-0.5 rounded mindx-dark-keep ${
                                  isDone
                                    ? "bg-emerald-700 text-white"
                                    : pct > 0
                                    ? "bg-blue-700 text-white"
                                    : "bg-slate-700 text-white"
                                }`}
                              >
                                {pct}%
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              <input
                                type="range"
                                min={0}
                                max={100}
                                step={10}
                                value={pct}
                                disabled={!isClassReady || isAnyMutationBusy}
                                onChange={(e) =>
                                  handleUpdateSingleCellProgress(
                                    remoteId,
                                    stu.id,
                                    Number(e.target.value)
                                  )
                                }
                                className="flex-1 accent-emerald-500 cursor-pointer"
                              />
                              <label className="flex items-center gap-1 text-[11px] font-semibold cursor-pointer shrink-0">
                                <input
                                  type="checkbox"
                                  checked={isDone}
                                  disabled={!isClassReady || isAnyMutationBusy}
                                  onChange={(e) =>
                                    handleUpdateSingleCellProgress(
                                      remoteId,
                                      stu.id,
                                      e.target.checked ? 100 : 0
                                    )
                                  }
                                  className="accent-emerald-500"
                                />
                                <span>Xong</span>
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
