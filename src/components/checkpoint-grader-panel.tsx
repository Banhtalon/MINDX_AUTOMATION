"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  Sparkles,
  Download,
  CheckCircle2,
  Send,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  FileCode2,
  Save,
  Plus,
  Trash2,
  RefreshCw,
  Upload,
  Loader2,
  MessageSquareShare,
  ShieldAlert,
  UserX,
} from "lucide-react";
import { isRoboticsClassCodePure } from "@/lib/checkpoint/checkpoint-competency";

interface RubricCriterion {
  criterionId: string;
  name: string;
  maxPoints: number;
  description: string;
  expectedSnippetOrConcept: string;
}

interface GradingRubricDto {
  rubricId: string;
  courseCode: string;
  sessionNumber: number;
  assignmentTitle: string;
  assignmentPrompt: string;
  maxTotalScore: number;
  criteria: RubricCriterion[];
}

interface CriterionGradeDto {
  criterionId: string;
  criterionName?: string;
  earnedPoints: number;
  maxPoints?: number;
  evidenceSnippet: string;
  deductionReason: string;
}

interface SubmissionItemDto {
  classId: string;
  sessionId: string;
  studentId: string;
  submissionId: string;
  fullName: string;
  isActive: boolean;
  originalFileName: string;
  localFilePath: string;
  fileHash: string;
  parseStatus: "PENDING" | "PARSED" | "PARSE_ERROR";
  parseErrorReason: string | null;
  criteriaGrades: CriterionGradeDto[];
  calculatedScore: number;
  teacherOverrideScore: number | null;
  decision: "GRADE" | "REDO";
  feedbackHtml: string;
  contentHash: string;
  status: "PENDING" | "WAITING_APPROVAL" | "APPROVED" | "SAVING" | "VERIFIED" | "FAILED";
  errorMessage: string | null;
  quizScore: number | null;
  lmsCellStatus: string | null;
  codePreview?: string;
  subjectType?: string;
}

interface AbsentStudentDto {
  studentId: string;
  fullName: string;
  isActive: boolean;
  quizScore: number | null;
}

interface ColumnInfoDto {
  columnId: string;
  lessonId: string;
  title: string;
  isCheckpoint: boolean;
}

interface CheckpointGraderPanelProps {
  classId: string;
  classCode: string;
  onGradesSaved?: () => void;
}

function htmlToEditableText(html?: string | null): string {
  if (!html) return "";
  return String(html)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<\s*li\b[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function editableTextToSafeHtml(text: string): string {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return "";
  const escape = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  return lines.map((line) => `<p>${escape(line)}</p>`).join("");
}

function parseCriteriaGradesSafe(
  rawJson?: string | null,
  fallback: CriterionGradeDto[] = []
): CriterionGradeDto[] {
  if (!rawJson) return fallback;
  try {
    const parsed = JSON.parse(rawJson);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`Không thể đọc tệp '${file.name}'.`));
    reader.readAsDataURL(file);
  });
}

export default function CheckpointGraderPanel({
  classId,
  classCode,
  onGradesSaved,
}: CheckpointGraderPanelProps) {
  const normalizedClass = String(classCode || classId || "").trim().toUpperCase();
  const isRobotics = isRoboticsClassCodePure(normalizedClass);

  const [isOpen, setIsOpen] = useState(false);
  const [stage, setStage] = useState<1 | 2>(1);
  const sessionNumber = stage === 1 ? 5 : 9;
  const sessionId = `${normalizedClass}_SESS_0${sessionNumber}`;

  // Rubric state
  const [showRubricEditor, setShowRubricEditor] = useState(false);
  const [rubric, setRubric] = useState<GradingRubricDto | null>(null);
  const [courseCode, setCourseCode] = useState("");
  const [datasetFiles, setDatasetFiles] = useState<string[]>([]);
  const [rubricTitle, setRubricTitle] = useState("");
  const [rubricPrompt, setRubricPrompt] = useState("");
  const [rubricCriteria, setRubricCriteria] = useState<RubricCriterion[]>([]);
  const [promptImages, setPromptImages] = useState<Array<{ name: string; dataUrl: string }>>([]);
  const [pendingDatasetFile, setPendingDatasetFile] = useState<{
    fileName: string;
    base64Data: string;
  } | null>(null);

  // Submissions state
  const [columnInfo, setColumnInfo] = useState<ColumnInfoDto | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionItemDto[]>([]);
  const [absentStudents, setAbsentStudents] = useState<AbsentStudentDto[]>([]);
  const [expandedSubIds, setExpandedSubIds] = useState<Record<string, boolean>>({});
  const [noteEdits, setNoteEdits] = useState<Record<string, string>>({});
  const [overrideEdits, setOverrideEdits] = useState<Record<string, string>>({});
  const [dirtySubIds, setDirtySubIds] = useState<Record<string, boolean>>({});

  // Busy & Banner state
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isGeneratingRubric, setIsGeneratingRubric] = useState(false);
  const [isSavingRubric, setIsSavingRubric] = useState(false);
  const [isDownloadingAndGrading, setIsDownloadingAndGrading] = useState(false);
  const [isApprovingAll, setIsApprovingAll] = useState(false);
  const [isSavingLms, setIsSavingLms] = useState(false);
  const [busySubId, setBusySubId] = useState<string | null>(null);
  const [singleGradingSubId, setSingleGradingSubId] = useState<string | null>(null);
  const [openingFileSubId, setOpeningFileSubId] = useState<string | null>(null);
  const [approvingManualSubId, setApprovingManualSubId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  const activeScopeRef = useRef("");
  const loadSeqRef = useRef(0);
  const draftSeqRef = useRef(1);
  const pendingDraftPromisesRef = useRef<Record<string, Promise<SubmissionItemDto | null>>>({});
  const suppressBlurSaveRef = useRef<Record<string, boolean>>({});

  const currentScopeKey = `${normalizedClass}::${stage}`;
  activeScopeRef.current = currentScopeKey;

  const syncRubricToEditor = (r: GradingRubricDto | null, fallbackStage: 1 | 2) => {
    if (r) {
      setRubric(r);
      setRubricTitle(r.assignmentTitle || "");
      setRubricPrompt(r.assignmentPrompt || "");
      setRubricCriteria(
        Array.isArray(r.criteria)
          ? r.criteria.map((c) => ({ ...c, maxPoints: Math.round(Number(c.maxPoints) || 0) }))
          : []
      );
      setShowRubricEditor(false);
    } else {
      setRubric(null);
      setRubricTitle(
        `Bài kiểm tra định kỳ lần ${fallbackStage} (Checkpoint ${fallbackStage})`
      );
      setRubricPrompt("");
      setRubricCriteria([
        {
          criterionId: "CRIT_01",
          name: "Đọc & làm sạch dữ liệu / Khởi tạo đúng yêu cầu",
          maxPoints: 25,
          description: "Đọc dữ liệu đầu vào và tiền xử lý hợp lý trước khi giải quyết bài toán.",
          expectedSnippetOrConcept: "",
        },
        {
          criterionId: "CRIT_02",
          name: "Yêu cầu thực hành số 1",
          maxPoints: 25,
          description: "Giải quyết đúng logic và kết quả câu 1.",
          expectedSnippetOrConcept: "",
        },
        {
          criterionId: "CRIT_03",
          name: "Yêu cầu thực hành số 2",
          maxPoints: 25,
          description: "Giải quyết đúng logic và kết quả câu 2.",
          expectedSnippetOrConcept: "",
        },
        {
          criterionId: "CRIT_04",
          name: "Yêu cầu thực hành số 3 & Trình bày kết quả",
          maxPoints: 25,
          description: "Giải quyết đúng câu 3 và in/hiển thị rõ kết quả.",
          expectedSnippetOrConcept: "",
        },
      ]);
      setShowRubricEditor(true);
    }
  };

  const loadPanelData = async (targetClass: string, targetStage: 1 | 2) => {
    if (!targetClass || isRoboticsClassCodePure(targetClass)) return;
    const targetSessNum = targetStage === 1 ? 5 : 9;
    const targetSessId = `${targetClass}_SESS_0${targetSessNum}`;
    const expectedScope = `${targetClass}::${targetStage}`;
    const mySeq = ++loadSeqRef.current;

    setIsLoadingData(true);
    try {
      const [rubricRes, subRes] = await Promise.all([
        fetch(
          `/api/homework-grader/rubric-ai?classCode=${encodeURIComponent(
            targetClass
          )}&sessionNumber=${targetSessNum}`
        ),
        fetch(
          `/api/homework-grader/submissions?classId=${encodeURIComponent(
            targetClass
          )}&sessionId=${encodeURIComponent(targetSessId)}`
        ),
      ]);

      const [rubricJson, subJson] = await Promise.all([
        rubricRes.json().catch(() => null),
        subRes.json().catch(() => null),
      ]);

      if (activeScopeRef.current !== expectedScope || loadSeqRef.current !== mySeq) {
        return;
      }

      if (rubricJson?.success && rubricJson.data) {
        setCourseCode(rubricJson.data.courseCode || "");
        setDatasetFiles(
          Array.isArray(rubricJson.data.datasetFiles) ? rubricJson.data.datasetFiles : []
        );
        syncRubricToEditor(rubricJson.data.rubric || null, targetStage);
      }

      if (subJson?.success && subJson.data) {
        const rows: SubmissionItemDto[] = Array.isArray(subJson.data.submissions)
          ? subJson.data.submissions
          : [];
        setSubmissions(rows);
        setAbsentStudents(
          Array.isArray(subJson.data.absentOrUnsubmittedStudents)
            ? subJson.data.absentOrUnsubmittedStudents
            : []
        );
        setColumnInfo(subJson.data.columnInfo || null);

        const nextNotes: Record<string, string> = {};
        const nextOverrides: Record<string, string> = {};
        for (const r of rows) {
          nextNotes[r.submissionId] = htmlToEditableText(r.feedbackHtml);
          nextOverrides[r.submissionId] =
            typeof r.teacherOverrideScore === "number" && Number.isFinite(r.teacherOverrideScore)
              ? String(Math.round(r.teacherOverrideScore))
              : "";
        }
        setNoteEdits(nextNotes);
        setOverrideEdits(nextOverrides);
        setDirtySubIds({});
      } else if (subJson?.error) {
        setBanner({ type: "error", text: subJson.error });
      }
    } catch (err: any) {
      if (activeScopeRef.current === expectedScope) {
        setBanner({
          type: "error",
          text: err instanceof Error ? err.message : "Lỗi tải dữ liệu chấm Checkpoint.",
        });
      }
    } finally {
      if (activeScopeRef.current === expectedScope && loadSeqRef.current === mySeq) {
        setIsLoadingData(false);
      }
    }
  };

  useEffect(() => {
    setBanner(null);
    setSubmissions([]);
    setAbsentStudents([]);
    setColumnInfo(null);
    setPromptImages([]);
    setPendingDatasetFile(null);
    setExpandedSubIds({});
    setDirtySubIds({});
    pendingDraftPromisesRef.current = {};
    suppressBlurSaveRef.current = {};
    setIsLoadingData(false);
    setIsGeneratingRubric(false);
    setIsSavingRubric(false);
    setIsDownloadingAndGrading(false);
    setIsApprovingAll(false);
    setIsSavingLms(false);
    setBusySubId(null);
    setSingleGradingSubId(null);
    setOpeningFileSubId(null);
    setApprovingManualSubId(null);
    if (isOpen && normalizedClass && !isRobotics) {
      void loadPanelData(normalizedClass, stage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, normalizedClass, stage, isRobotics]);

  const criteriaPointsSum = rubricCriteria.reduce(
    (sum, c) => sum + (Number.isFinite(Number(c.maxPoints)) ? Math.round(Number(c.maxPoints)) : 0),
    0
  );

  const handlePromptImagesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, 3);
    e.target.value = "";
    if (files.length === 0) return;
    try {
      const converted = await Promise.all(
        files.map(async (f) => ({
          name: f.name,
          dataUrl: await readFileAsDataUrl(f),
        }))
      );
      setPromptImages((prev) => [...prev, ...converted].slice(0, 3));
    } catch (err: any) {
      setBanner({ type: "error", text: err?.message || "Lỗi đọc ảnh đề bài." });
    }
  };

  const handleDatasetFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setPendingDatasetFile({
        fileName: file.name,
        base64Data: dataUrl,
      });
    } catch (err: any) {
      setBanner({ type: "error", text: err?.message || "Lỗi đọc tệp dataset mẫu." });
    }
  };

  const handleGenerateAiRubric = async () => {
    if (!rubricPrompt.trim() && promptImages.length === 0) {
      setBanner({
        type: "error",
        text: "Vui lòng nhập nội dung đề bài hoặc tải lên ít nhất 1 ảnh chụp đề bài để AI tạo Barem.",
      });
      return;
    }
    const scopeAtStart = currentScopeKey;
    setIsGeneratingRubric(true);
    setBanner({ type: "info", text: "Đang phân tích đề bài và tạo Barem 100 điểm chuẩn..." });
    try {
      const res = await fetch("/api/homework-grader/rubric-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "ai",
          classCode: normalizedClass,
          sessionNumber,
          assignmentTitle: rubricTitle,
          assignmentPrompt: rubricPrompt,
          images: promptImages.map((img) => img.dataUrl),
          datasetFile: pendingDatasetFile || undefined,
        }),
      });
      const json = await res.json();
      if (activeScopeRef.current !== scopeAtStart) return;
      if (!res.ok || !json?.success) {
        setBanner({ type: "error", text: json?.error || "AI tạo Barem thất bại." });
        return;
      }
      const saved: GradingRubricDto = json.data.rubric;
      setRubric(saved);
      setRubricTitle(saved.assignmentTitle);
      setRubricPrompt(saved.assignmentPrompt);
      setRubricCriteria(saved.criteria);
      setDatasetFiles(json.data.datasetFiles || []);
      setPendingDatasetFile(null);
      setBanner({
        type: "success",
        text: `Đã tạo và lưu Barem '${saved.rubricId}' (tổng 100 điểm, ${saved.criteria.length} tiêu chí).`,
      });
    } catch (err: any) {
      if (activeScopeRef.current === scopeAtStart) {
        setBanner({ type: "error", text: err?.message || "Lỗi kết nối khi tạo Barem AI." });
      }
    } finally {
      if (activeScopeRef.current === scopeAtStart) {
        setIsGeneratingRubric(false);
      }
    }
  };

  const handleSaveManualRubric = async () => {
    if (criteriaPointsSum !== 100) {
      setBanner({
        type: "error",
        text: `Tổng điểm các tiêu chí hiện tại là ${criteriaPointsSum}/100đ. Vui lòng điều chỉnh đúng bằng 100 điểm nguyên.`,
      });
      return;
    }
    const scopeAtStart = currentScopeKey;
    setIsSavingRubric(true);
    try {
      const res = await fetch("/api/homework-grader/rubric-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "save",
          classCode: normalizedClass,
          sessionNumber,
          rubricId: rubric?.rubricId,
          assignmentTitle: rubricTitle,
          assignmentPrompt: rubricPrompt,
          criteria: rubricCriteria.map((c, idx) => ({
            ...c,
            criterionId: c.criterionId || `CRIT_${String(idx + 1).padStart(2, "0")}`,
            maxPoints: Math.round(Number(c.maxPoints) || 0),
          })),
          datasetFile: pendingDatasetFile || undefined,
        }),
      });
      const json = await res.json();
      if (activeScopeRef.current !== scopeAtStart) return;
      if (!res.ok || !json?.success) {
        setBanner({ type: "error", text: json?.error || "Lưu Barem thất bại." });
        return;
      }
      const saved: GradingRubricDto = json.data.rubric;
      setRubric(saved);
      setDatasetFiles(json.data.datasetFiles || []);
      setPendingDatasetFile(null);
      setShowRubricEditor(false);
      setBanner({
        type: "success",
        text: `Đã lưu Barem chấm điểm '${saved.rubricId}' (100/100 điểm).`,
      });
    } catch (err: any) {
      if (activeScopeRef.current === scopeAtStart) {
        setBanner({ type: "error", text: err?.message || "Lỗi lưu Barem." });
      }
    } finally {
      if (activeScopeRef.current === scopeAtStart) {
        setIsSavingRubric(false);
      }
    }
  };

  const saveDraftForSubmission = async (
    sub: SubmissionItemDto,
    nextOverrideRaw?: string,
    nextNotePlain?: string,
    nextCriteria?: CriterionGradeDto[]
  ): Promise<SubmissionItemDto | null> => {
    const existingPending = pendingDraftPromisesRef.current[sub.submissionId];
    const runSave = async (): Promise<SubmissionItemDto | null> => {
      if (existingPending) {
        await existingPending.catch(() => null);
      }
      const scopeAtStart = currentScopeKey;
      const overrideStr =
        nextOverrideRaw !== undefined
          ? nextOverrideRaw.trim()
          : (overrideEdits[sub.submissionId] ?? "").trim();
      let parsedOverride: number | null = null;
      if (overrideStr !== "") {
        const n = Number(overrideStr);
        if (!Number.isFinite(n) || n < 0 || n > 100 || !Number.isInteger(n)) {
          setBanner({
            type: "error",
            text: `Điểm chốt của '${sub.fullName}' bắt buộc là số nguyên từ 0 đến 100.`,
          });
          return null;
        }
        parsedOverride = n;
      }

      const noteText =
        nextNotePlain !== undefined
          ? nextNotePlain
          : noteEdits[sub.submissionId] ?? htmlToEditableText(sub.feedbackHtml);
      const nextHtml =
        noteText.trim() === htmlToEditableText(sub.feedbackHtml).trim() && sub.feedbackHtml
          ? sub.feedbackHtml
          : editableTextToSafeHtml(noteText);

      const seq = ++draftSeqRef.current;
      const res = await fetch("/api/homework-grader/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: normalizedClass,
          sessionId,
          studentId: sub.studentId,
          submissionId: sub.submissionId,
          originalFileName: sub.originalFileName,
          criteriaGrades: nextCriteria ?? sub.criteriaGrades,
          rubric: rubric || undefined,
          teacherOverrideScore: parsedOverride,
          decision: "GRADE",
          feedbackHtml: nextHtml,
          draftSeq: seq,
        }),
      });
      const json = await res.json().catch(() => null);
      if (activeScopeRef.current !== scopeAtStart) return null;
      if (!res.ok || !json?.success) {
        if (json?.staleIgnored) {
          return sub;
        }
        setBanner({
          type: "error",
          text: json?.error || `Không thể lưu nháp bài của '${sub.fullName}'.`,
        });
        return null;
      }

      const updatedDb = json.data;
      let parsedCriteria: CriterionGradeDto[] = sub.criteriaGrades;
      try {
        parsedCriteria = JSON.parse(updatedDb.criteriaGradesJson || "[]");
      } catch {}

      const merged: SubmissionItemDto = {
        ...sub,
        ...updatedDb,
        criteriaGrades: parsedCriteria,
      };

      setSubmissions((prev) =>
        prev.map((item) => (item.submissionId === sub.submissionId ? merged : item))
      );
      setDirtySubIds((prev) => {
        const next = { ...prev };
        delete next[sub.submissionId];
        return next;
      });
      return merged;
    };

    const p = runSave();
    pendingDraftPromisesRef.current[sub.submissionId] = p;
    try {
      return await p;
    } finally {
      if (pendingDraftPromisesRef.current[sub.submissionId] === p) {
        delete pendingDraftPromisesRef.current[sub.submissionId];
      }
    }
  };

  const handleDownloadAndGradeAi = async () => {
    if (!rubric) {
      setShowRubricEditor(true);
      setBanner({
        type: "error",
        text: "Chưa có Barem 100 điểm cho buổi Checkpoint này. Vui lòng tạo hoặc lưu Barem trước khi chấm.",
      });
      return;
    }
    const scopeAtStart = currentScopeKey;
    setIsDownloadingAndGrading(true);
    setBanner({
      type: "info",
      text: `Đang tải toàn bộ bài nộp Checkpoint ${stage} lớp ${normalizedClass}, chạy kiểm chứng Sandbox và chấm nháp AI...`,
    });
    try {
      const res = await fetch("/api/homework-grader/download-and-grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: normalizedClass,
          classCode: normalizedClass,
          sessionId,
          lessonId: columnInfo?.lessonId || undefined,
          rubricId: rubric.rubricId,
          rubric,
        }),
      });
      const json = await res.json().catch(() => null);
      if (activeScopeRef.current !== scopeAtStart) return;
      if (!res.ok || !json?.success) {
        setBanner({
          type: "error",
          text: json?.error || "Tải bài & chấm nháp AI thất bại.",
        });
        await loadPanelData(normalizedClass, stage);
        return;
      }

      await loadPanelData(normalizedClass, stage);
      const gradedList: any[] = Array.isArray(json.data?.gradeResults) ? json.data.gradeResults : [];
      const okCount = gradedList.filter((g) => g.status === "WAITING_APPROVAL" || g.status === "APPROVED" || g.status === "VERIFIED").length;
      const parseErrCount = gradedList.filter((g) => g.parseStatus === "PARSE_ERROR").length;
      setBanner({
        type: "success",
        text: `Đã tải & chấm nháp xong ${okCount} bài hợp lệ${
          parseErrCount > 0 ? ` (${parseErrCount} bài cảnh báo thiếu file code cần kiểm tra tay)` : ""
        }. Giáo viên kiểm tra và bấm Duyệt!`,
      });
    } catch (err: any) {
      if (activeScopeRef.current === scopeAtStart) {
        setBanner({ type: "error", text: err?.message || "Lỗi tải bài & chấm AI." });
      }
    } finally {
      if (activeScopeRef.current === scopeAtStart) {
        setIsDownloadingAndGrading(false);
      }
    }
  };

  const handleApproveSingle = async (sub: SubmissionItemDto) => {
    const scopeAtStart = currentScopeKey;
    setBusySubId(sub.submissionId);
    try {
      let latest = sub;
      if (dirtySubIds[sub.submissionId]) {
        const flushed = await saveDraftForSubmission(sub);
        if (!flushed) return;
        latest = flushed;
      }
      const res = await fetch("/api/homework-grader/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: normalizedClass,
          sessionId,
          studentId: latest.studentId,
          submissionId: latest.submissionId,
          fileHash: latest.fileHash,
          feedbackHtml: latest.feedbackHtml,
          decision: "GRADE",
          teacherOverrideScore: latest.teacherOverrideScore ?? null,
          criteriaGrades: latest.criteriaGrades,
          rubric: rubric || undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (activeScopeRef.current !== scopeAtStart) return;
      if (!res.ok || !json?.success) {
        setBanner({
          type: "error",
          text: json?.error || `Duyệt bài của '${latest.fullName}' thất bại.`,
        });
        return;
      }
      const updatedData = json.data || {};
      const parsedCriteria = parseCriteriaGradesSafe(
        updatedData.criteriaGradesJson,
        latest.criteriaGrades
      );
      setSubmissions((prev) =>
        prev.map((item) =>
          item.submissionId === latest.submissionId
            ? { ...item, ...updatedData, criteriaGrades: parsedCriteria }
            : item
        )
      );
      setBanner({
        type: "success",
        text: `Đã duyệt điểm Checkpoint cho học viên ${latest.fullName}.`,
      });
    } finally {
      if (activeScopeRef.current === scopeAtStart) {
        setBusySubId(null);
      }
    }
  };

  const handleGradeSingle = async (sub: SubmissionItemDto) => {
    if (!rubric) {
      setShowRubricEditor(true);
      setBanner({
        type: "error",
        text: "Chưa có Barem 100 điểm cho buổi Checkpoint này. Vui lòng tạo hoặc lưu Barem trước khi chấm.",
      });
      return;
    }
    const scopeAtStart = currentScopeKey;
    setSingleGradingSubId(sub.submissionId);
    setBusySubId(sub.submissionId);
    setBanner({
      type: "info",
      text: `Đang tải bài mới nhất và chấm nháp AI riêng cho học viên ${sub.fullName}...`,
    });
    try {
      const res = await fetch("/api/homework-grader/download-and-grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: normalizedClass,
          classCode: normalizedClass,
          sessionId,
          lessonId: columnInfo?.lessonId || undefined,
          studentId: sub.studentId,
          rubricId: rubric.rubricId,
          rubric,
        }),
      });
      const json = await res.json().catch(() => null);
      if (activeScopeRef.current !== scopeAtStart) return;
      if (!res.ok || !json?.success) {
        setBanner({
          type: "error",
          text: json?.error || `Tải & chấm riêng cho '${sub.fullName}' thất bại.`,
        });
        return;
      }

      // Refresh ONLY this student's row from SQLite without affecting other students
      const subRes = await fetch(
        `/api/homework-grader/submissions?classId=${encodeURIComponent(
          normalizedClass
        )}&sessionId=${encodeURIComponent(sessionId)}`
      );
      const subJson = await subRes.json().catch(() => null);
      if (activeScopeRef.current !== scopeAtStart) return;

      if (subJson?.success && subJson.data) {
        const rows: SubmissionItemDto[] = Array.isArray(subJson.data.submissions)
          ? subJson.data.submissions
          : [];
        const refreshedRow =
          rows.find((r) => r.submissionId === sub.submissionId) ||
          rows.find((r) => r.studentId === sub.studentId);
        if (refreshedRow) {
          setSubmissions((prev) =>
            prev.map((item) =>
              item.submissionId === sub.submissionId || item.studentId === sub.studentId
                ? refreshedRow
                : item
            )
          );
          setNoteEdits((prev) => ({
            ...prev,
            [refreshedRow.submissionId]: htmlToEditableText(refreshedRow.feedbackHtml),
          }));
          setOverrideEdits((prev) => ({
            ...prev,
            [refreshedRow.submissionId]:
              typeof refreshedRow.teacherOverrideScore === "number" &&
              Number.isFinite(refreshedRow.teacherOverrideScore)
                ? String(Math.round(refreshedRow.teacherOverrideScore))
                : "",
          }));
          setDirtySubIds((prev) => {
            const next = { ...prev };
            delete next[sub.submissionId];
            delete next[refreshedRow.submissionId];
            return next;
          });
        }
        if (!columnInfo && subJson.data.columnInfo) {
          setColumnInfo(subJson.data.columnInfo);
        }
      }

      const gradedList: any[] = Array.isArray(json.data?.gradeResults)
        ? json.data.gradeResults
        : [];
      const singleResult =
        gradedList.find((g) => g.studentId === sub.studentId) || gradedList[0] || null;
      if (singleResult?.staleIgnored) {
        setBanner({
          type: "info",
          text:
            singleResult.errorMessage ||
            `Bài nộp của ${sub.fullName} đã được duyệt trước đó (giữ nguyên).`,
        });
      } else if (singleResult?.parseStatus === "PARSE_ERROR") {
        setBanner({
          type: "error",
          text: `${sub.fullName}: File bài nộp chưa đọc được tự động (PARSE_ERROR). Mở chi tiết dòng để xem file gốc hoặc chấm tay.`,
        });
      } else if (singleResult?.status === "FAILED") {
        setBanner({
          type: "error",
          text: singleResult.errorMessage || `Chấm riêng cho ${sub.fullName} thất bại.`,
        });
      } else if (!singleResult) {
        setBanner({
          type: "info",
          text: `Đã cập nhật trạng thái bài nộp của ${sub.fullName}.`,
        });
      } else {
        setBanner({
          type: "success",
          text: `Đã tải & chấm nháp AI cho ${sub.fullName} (${Math.round(
            singleResult.calculatedScore || 0
          )}/100đ). Kiểm tra và bấm Duyệt!`,
        });
      }
    } catch (err: any) {
      if (activeScopeRef.current === scopeAtStart) {
        setBanner({
          type: "error",
          text: err?.message || `Lỗi kết nối khi chấm riêng cho ${sub.fullName}.`,
        });
      }
    } finally {
      if (activeScopeRef.current === scopeAtStart) {
        setSingleGradingSubId(null);
        setBusySubId(null);
      }
    }
  };

  const handleOpenRawFile = async (sub: SubmissionItemDto) => {
    if (!sub.localFilePath) {
      setBanner({
        type: "error",
        text: `Bài nộp của '${sub.fullName}' chưa có tệp trên máy. Bấm "⚡ Chấm riêng" để tải file gốc về trước.`,
      });
      return;
    }
    const scopeAtStart = currentScopeKey;
    setOpeningFileSubId(sub.submissionId);
    setBusySubId(sub.submissionId);
    try {
      const res = await fetch("/api/homework-grader/open-local-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: normalizedClass,
          classCode: normalizedClass,
          sessionId,
          submissionId: sub.submissionId,
          studentId: sub.studentId,
        }),
      });
      const json = await res.json().catch(() => null);
      if (activeScopeRef.current !== scopeAtStart) return;
      if (!res.ok || !json?.success) {
        setBanner({
          type: "error",
          text: json?.error || `Không thể mở file gốc của '${sub.fullName}'.`,
        });
        return;
      }
      setBanner({
        type: "success",
        text: `Đã mở vị trí file gốc của ${sub.fullName} (${sub.originalFileName || sub.submissionId}).`,
      });
    } catch (err: any) {
      if (activeScopeRef.current === scopeAtStart) {
        setBanner({
          type: "error",
          text: err?.message || `Lỗi kết nối khi mở file gốc của ${sub.fullName}.`,
        });
      }
    } finally {
      if (activeScopeRef.current === scopeAtStart) {
        setOpeningFileSubId(null);
        setBusySubId(null);
      }
    }
  };

  const handleApproveManualParseError = async (sub: SubmissionItemDto) => {
    const rawScoreStr = (overrideEdits[sub.submissionId] ?? "").trim();
    const parsedScore = Number(rawScoreStr);
    if (
      rawScoreStr === "" ||
      !Number.isFinite(parsedScore) ||
      !Number.isInteger(parsedScore) ||
      parsedScore < 0 ||
      parsedScore > 100
    ) {
      setBanner({
        type: "error",
        text: `Điểm chấm tay của '${sub.fullName}' bắt buộc là số nguyên từ 0 đến 100.`,
      });
      return;
    }

    const plainNote = (noteEdits[sub.submissionId] ?? "").replace(/\s+/g, " ").trim();
    if (plainNote.length < 10) {
      setBanner({
        type: "error",
        text: `Nhận xét chấm tay cho '${sub.fullName}' phải có ít nhất 10 ký tự thực tế (hiện tại ${plainNote.length} ký tự).`,
      });
      return;
    }

    const feedbackHtml = editableTextToSafeHtml(noteEdits[sub.submissionId] ?? "");
    const scopeAtStart = currentScopeKey;
    setApprovingManualSubId(sub.submissionId);
    setBusySubId(sub.submissionId);
    try {
      const res = await fetch("/api/homework-grader/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: normalizedClass,
          sessionId,
          submissionId: sub.submissionId,
          studentId: sub.studentId,
          manualTeacherGradeOnParseError: true,
          teacherOverrideScore: parsedScore,
          feedbackHtml,
          decision: "GRADE",
        }),
      });
      const json = await res.json().catch(() => null);
      if (activeScopeRef.current !== scopeAtStart) return;
      if (!res.ok || !json?.success) {
        const baseErr = json?.error || `Duyệt chấm tay cho '${sub.fullName}' thất bại.`;
        setBanner({
          type: "error",
          text:
            res.status === 404
              ? `${baseErr} Bấm "⚡ Chấm riêng" để đồng bộ bài nộp này về máy trước khi chấm tay.`
              : baseErr,
        });
        return;
      }

      const updatedData = json.data || {};
      const parsedCriteria = parseCriteriaGradesSafe(
        updatedData.criteriaGradesJson,
        sub.criteriaGrades
      );
      setSubmissions((prev) =>
        prev.map((item) =>
          item.submissionId === sub.submissionId
            ? { ...item, ...updatedData, criteriaGrades: parsedCriteria }
            : item
        )
      );
      setNoteEdits((prev) => ({
        ...prev,
        [sub.submissionId]: htmlToEditableText(updatedData.feedbackHtml ?? feedbackHtml),
      }));
      setOverrideEdits((prev) => ({
        ...prev,
        [sub.submissionId]: String(parsedScore),
      }));
      setDirtySubIds((prev) => {
        const next = { ...prev };
        delete next[sub.submissionId];
        return next;
      });
      setBanner({
        type: "success",
        text: `Đã duyệt chấm tay cho ${sub.fullName} (${parsedScore}/100đ). Bấm "Lưu LMS" để đẩy điểm lên MindX LMS!`,
      });
    } catch (err: any) {
      if (activeScopeRef.current === scopeAtStart) {
        setBanner({
          type: "error",
          text: err?.message || `Lỗi kết nối khi duyệt chấm tay cho ${sub.fullName}.`,
        });
      }
    } finally {
      if (activeScopeRef.current === scopeAtStart) {
        setApprovingManualSubId(null);
        setBusySubId(null);
      }
    }
  };

  const handleApproveAllEligible = async () => {
    const scopeAtStart = currentScopeKey;
    setIsApprovingAll(true);
    try {
      // Flush any dirty drafts first so reviewed snapshot matches SQLite 100%
      const nextMap = new Map(submissions.map((s) => [s.submissionId, s]));
      for (const s of submissions) {
        if (dirtySubIds[s.submissionId] && s.parseStatus === "PARSED") {
          const flushed = await saveDraftForSubmission(s);
          if (!flushed) return;
          nextMap.set(s.submissionId, flushed);
        }
      }

      const eligibleReviewed = Array.from(nextMap.values())
        .filter(
          (s) =>
            s.parseStatus === "PARSED" &&
            Boolean(s.fileHash) &&
            s.status !== "APPROVED" &&
            s.status !== "VERIFIED"
        )
        .map((s) => ({
          submissionId: s.submissionId,
          fileHash: s.fileHash,
          feedbackHtml: s.feedbackHtml,
          decision: "GRADE",
          teacherOverrideScore: s.teacherOverrideScore ?? null,
          criteriaGrades: s.criteriaGrades,
        }));

      const res = await fetch("/api/homework-grader/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: normalizedClass,
          sessionId,
          approveAll: true,
          rubric: rubric || undefined,
          reviewedSubmissions: eligibleReviewed,
        }),
      });
      const json = await res.json().catch(() => null);
      if (activeScopeRef.current !== scopeAtStart) return;
      if (!res.ok || !json?.success) {
        setBanner({ type: "error", text: json?.error || "Duyệt hàng loạt thất bại." });
        return;
      }
      await loadPanelData(normalizedClass, stage);
      const approvedCount = Number(json.data?.approvedCount || 0);
      const skippedCount = Array.isArray(json.data?.skippedIds) ? json.data.skippedIds.length : 0;
      setBanner({
        type: "success",
        text: `Đã duyệt ${approvedCount} bài hợp lệ${
          skippedCount > 0 ? ` (bỏ qua ${skippedCount} bài lỗi/chưa đủ điều kiện)` : ""
        }. Sẵn sàng đẩy điểm lên LMS!`,
      });
    } finally {
      if (activeScopeRef.current === scopeAtStart) {
        setIsApprovingAll(false);
      }
    }
  };

  const handleSaveToLms = async (singleSubmissionId?: string) => {
    const scopeAtStart = currentScopeKey;
    if (singleSubmissionId) {
      setBusySubId(singleSubmissionId);
    } else {
      setIsSavingLms(true);
    }
    setBanner({
      type: "info",
      text: "Đang mở Tab Chấm bài (#tab-3) trên LMS, điền điểm số nguyên + nhận xét và đối chiếu Read-after-Write...",
    });
    try {
      const res = await fetch("/api/homework-grader/save-lms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: normalizedClass,
          classCode: normalizedClass,
          sessionId,
          lessonId: columnInfo?.lessonId || undefined,
          submissionId: singleSubmissionId,
        }),
      });
      const json = await res.json().catch(() => null);
      if (activeScopeRef.current !== scopeAtStart) return;
      await loadPanelData(normalizedClass, stage);
      onGradesSaved?.();
      if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
        window.dispatchEvent(
          new CustomEvent("mindx:report-card-refresh", { detail: { classId: normalizedClass } })
        );
      }

      const data = json?.data;
      if (!res.ok || !json?.success) {
        const firstErr =
          data?.results?.find((r: any) => !r.success)?.error ||
          json?.error ||
          "Một số bài chưa lưu được lên LMS.";
        setBanner({
          type: "error",
          text: `Đã xác thực VERIFIED ${data?.verifiedCount || 0}/${
            data?.totalCandidates || 0
          } bài. Chi tiết: ${firstErr}`,
        });
        return;
      }
      setBanner({
        type: "success",
        text: `Đã đẩy và xác thực Read-after-Write thành công ${
          data?.verifiedCount || 0
        } bài Checkpoint lên MindX LMS! Điểm Lý thuyết & Thực hành đã tự động cập nhật sang Nhận xét Buổi ${sessionNumber}.`,
      });
    } catch (err: any) {
      if (activeScopeRef.current === scopeAtStart) {
        setBanner({ type: "error", text: err?.message || "Lỗi kết nối khi đẩy điểm lên LMS." });
      }
    } finally {
      if (activeScopeRef.current === scopeAtStart) {
        setBusySubId(null);
        setIsSavingLms(false);
      }
    }
  };

  const anyBusy =
    isLoadingData ||
    isGeneratingRubric ||
    isSavingRubric ||
    isDownloadingAndGrading ||
    isApprovingAll ||
    isSavingLms ||
    Boolean(busySubId) ||
    Boolean(singleGradingSubId) ||
    Boolean(openingFileSubId) ||
    Boolean(approvingManualSubId);

  const parseErrorCount = submissions.filter((s) => s.parseStatus === "PARSE_ERROR").length;
  const approvedCount = submissions.filter((s) => s.status === "APPROVED").length;
  const retryableFailedCount = submissions.filter(
    (s) => s.status === "FAILED" && Boolean(s.contentHash)
  ).length;
  const pushableLmsCount = approvedCount + retryableFailedCount;
  const verifiedCount = submissions.filter((s) => s.status === "VERIFIED").length;
  const waitingCount = submissions.filter(
    (s) => s.parseStatus === "PARSED" && s.status === "WAITING_APPROVAL"
  ).length;

  return (
    <div
      data-testid="checkpoint-grader-panel"
      className="mindx-card mindx-card-purple rounded-2xl overflow-hidden shadow-xl"
    >
      {/* Collapsible Header */}
      <button
        type="button"
        data-testid="toggle-checkpoint-grader-btn"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full px-4 sm:px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 text-left hover:bg-slate-500/10 transition cursor-pointer"
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="neo-ws-badge-purple px-2.5 py-1 rounded-lg text-xs font-black mindx-dark-keep">
            🎯 CHẤM CHECKPOINT AI
          </span>
          <span className="neo-title-text text-sm font-black">
            Chấm Thực hành Checkpoint (Thang 100 • CP1 B5 &amp; CP2 B9)
          </span>
          {!isRobotics && rubric && (
            <span className="px-2 py-0.5 rounded-full text-[11px] mindx-badge-emerald">
              Barem: {rubric.rubricId} (100đ)
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs font-bold opacity-80">
          <span>{isOpen ? "Thu gọn" : "Mở khung chấm"}</span>
          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-slate-300 dark:border-slate-700/80 p-5 space-y-4">
          {isRobotics ? (
            <div className="p-4 rounded-xl mindx-warm-box flex items-start gap-3 text-xs leading-relaxed">
              <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-sm">
                  Lớp Robotics ({normalizedClass}) kiểm tra trực tiếp trên giấy (Buổi 4 &amp; Buổi 8)
                </p>
                <p className="mt-1">
                  Các lớp Robotics không nộp bài thực hành trên Tab Chấm bài (#tab-3) của LMS. Giáo
                  viên nhập điểm Lý thuyết &amp; Thực hành trực tiếp trên LMS, sau đó sang mục{" "}
                  <Link
                    href={`/session-comments?classId=${encodeURIComponent(normalizedClass)}`}
                    className="underline font-bold"
                  >
                    Nhận xét buổi học
                  </Link>{" "}
                  để Bot tự tính 9 ô Điểm Năng lực `[ĐNL]` và viết nhận xét.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Stage Selector + Rubric Toggle + Shortcut to Session Comments */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-testid="cp-stage-1-btn"
                    disabled={anyBusy}
                    onClick={() => setStage(1)}
                    className={`px-3.5 py-2 rounded-xl text-xs cursor-pointer ${
                      stage === 1
                        ? "neo-tab-active"
                        : "neo-tab-idle"
                    }`}
                  >
                    Checkpoint 1 (Buổi 5)
                  </button>
                  <button
                    type="button"
                    data-testid="cp-stage-2-btn"
                    disabled={anyBusy}
                    onClick={() => setStage(2)}
                    className={`px-3.5 py-2 rounded-xl text-xs cursor-pointer ${
                      stage === 2
                        ? "neo-tab-active"
                        : "neo-tab-idle"
                    }`}
                  >
                    Checkpoint 2 (Buổi 9)
                  </button>

                  {columnInfo && (
                    <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-200/80 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300">
                      Cột LMS: <strong>{columnInfo.title}</strong>
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-testid="toggle-rubric-editor-btn"
                    onClick={() => setShowRubricEditor((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-purple-500/40 bg-purple-500/10 text-purple-800 dark:text-purple-200 hover:bg-purple-500/20 transition cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>
                      {rubric
                        ? `${showRubricEditor ? "Ẩn" : "Xem / Sửa"} Barem 100đ (${rubric.criteria.length} tiêu chí${
                            datasetFiles.length > 0 ? ` • ${datasetFiles.join(", ")}` : ""
                          })`
                        : "Thiết lập Đề bài & Barem 100đ bằng AI"}
                    </span>
                  </button>

                  <Link
                    href={`/session-comments?classId=${encodeURIComponent(normalizedClass)}`}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-200 hover:bg-sky-500/20 transition"
                    title="Sau khi đẩy điểm Checkpoint lên LMS, điểm LT/TH tự đồng bộ sang Nhận xét Buổi 5/9"
                  >
                    <MessageSquareShare className="w-3.5 h-3.5" />
                    <span>Sang Nhận xét Buổi {sessionNumber}</span>
                  </Link>
                </div>
              </div>

              {/* Banner */}
              {banner && (
                <div
                  data-testid="checkpoint-grader-banner"
                  className={`p-3 rounded-xl text-xs font-semibold flex items-start justify-between gap-2 border ${
                    banner.type === "success"
                      ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-900 dark:text-emerald-200"
                      : banner.type === "error"
                      ? "bg-rose-500/15 border-rose-500/40 text-rose-900 dark:text-rose-200"
                      : "bg-sky-500/15 border-sky-500/40 text-sky-900 dark:text-sky-200"
                  }`}
                >
                  <span>{banner.text}</span>
                  <button
                    type="button"
                    onClick={() => setBanner(null)}
                    className="opacity-70 hover:opacity-100 px-1 cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Collapsible Rubric & Dataset Editor */}
              {showRubricEditor && (
                <div
                  data-testid="checkpoint-rubric-editor"
                  className="p-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100/90 dark:bg-slate-900/70 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-extrabold uppercase tracking-wide text-purple-800 dark:text-purple-300">
                      📋 Đề bài &amp; Barem Chấm Điểm Chuẩn 100 Điểm ({courseCode || normalizedClass}{" "}
                      • Buổi {sessionNumber})
                    </div>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                        criteriaPointsSum === 100
                          ? "mindx-badge-emerald"
                          : "mindx-badge-amber"
                      }`}
                    >
                      Tổng điểm tiêu chí: {criteriaPointsSum}/100đ
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold mb-1">Tiêu đề bài kiểm tra</label>
                      <input
                        type="text"
                        value={rubricTitle}
                        onChange={(e) => setRubricTitle(e.target.value)}
                        placeholder="VD: Bài kiểm tra định kỳ lần 1 (CP1)"
                        className="w-full px-3 py-2 rounded-lg text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 cursor-pointer hover:border-purple-500">
                        <Upload className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                        <span>Ảnh chụp đề bài ({promptImages.length}/3)</span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          multiple
                          onChange={handlePromptImagesChange}
                          className="hidden"
                        />
                      </label>

                      <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 cursor-pointer hover:border-emerald-500">
                        <FileCode2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        <span>
                          {pendingDatasetFile
                            ? `Dataset mới: ${pendingDatasetFile.fileName}`
                            : datasetFiles.length > 0
                            ? `Dataset mẫu: ${datasetFiles.join(", ")}`
                            : "Đính kèm Dataset mẫu (.csv)"}
                        </span>
                        <input
                          type="file"
                          accept=".csv,.tsv,.json,.txt"
                          onChange={handleDatasetFileChange}
                          className="hidden"
                        />
                      </label>

                      <button
                        type="button"
                        disabled={anyBusy}
                        onClick={handleGenerateAiRubric}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-extrabold bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white cursor-pointer mindx-dark-keep"
                      >
                        {isGeneratingRubric ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="w-3.5 h-3.5" />
                        )}
                        <span>AI Tạo Barem 100đ</span>
                      </button>
                    </div>
                  </div>

                  {promptImages.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      {promptImages.map((img, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-500/15 border border-purple-500/30 font-semibold"
                        >
                          <span>🖼️ {img.name}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setPromptImages((prev) => prev.filter((_, idx) => idx !== i))
                            }
                            className="opacity-75 hover:opacity-100 cursor-pointer"
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  <div>
                    <label className="block text-[11px] font-bold mb-1">
                      Đề bài &amp; hướng dẫn chấm
                    </label>
                    <textarea
                      rows={3}
                      value={rubricPrompt}
                      onChange={(e) => setRubricPrompt(e.target.value)}
                      placeholder="Dán câu hỏi đề bài Checkpoint, tên file dữ liệu hoặc bấm AI Tạo Barem từ ảnh chụp đề..."
                      className="w-full px-3 py-2 rounded-lg text-xs border-2 border-[#0f172a] dark:border-slate-600 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                    />
                  </div>

                  {/* Criteria rows */}
                  <div className="space-y-2">
                    {rubricCriteria.map((crit, idx) => (
                      <div
                        key={crit.criterionId || idx}
                        className="p-2.5 rounded-lg border border-slate-300 dark:border-slate-700/80 bg-white dark:bg-slate-950/80 grid grid-cols-1 md:grid-cols-12 gap-2 items-start"
                      >
                        <div className="md:col-span-4">
                          <label className="block text-[10px] font-bold opacity-75">
                            Tiêu chí #{idx + 1}
                          </label>
                          <input
                            type="text"
                            value={crit.name}
                            onChange={(e) =>
                              setRubricCriteria((prev) =>
                                prev.map((c, i) => (i === idx ? { ...c, name: e.target.value } : c))
                              )
                            }
                            className="w-full px-2.5 py-1.5 rounded text-xs border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-[10px] font-bold opacity-75">
                            Điểm tối đa (nguyên)
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={100}
                            step={1}
                            value={crit.maxPoints}
                            onChange={(e) =>
                              setRubricCriteria((prev) =>
                                prev.map((c, i) =>
                                  i === idx
                                    ? { ...c, maxPoints: Math.round(Number(e.target.value) || 0) }
                                    : c
                                )
                              )
                            }
                            className="w-full px-2.5 py-1.5 rounded text-xs font-bold border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                          />
                        </div>
                        <div className="md:col-span-5">
                          <label className="block text-[10px] font-bold opacity-75">
                            Mô tả &amp; Đáp án / Code đối chiếu
                          </label>
                          <input
                            type="text"
                            value={crit.description}
                            onChange={(e) =>
                              setRubricCriteria((prev) =>
                                prev.map((c, i) =>
                                  i === idx ? { ...c, description: e.target.value } : c
                                )
                              )
                            }
                            className="w-full px-2.5 py-1.5 rounded text-xs border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                          />
                        </div>
                        <div className="md:col-span-1 flex justify-end pt-4">
                          <button
                            type="button"
                            disabled={rubricCriteria.length <= 1}
                            onClick={() =>
                              setRubricCriteria((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="p-1.5 rounded text-rose-600 dark:text-rose-400 hover:bg-rose-500/15 disabled:opacity-30 cursor-pointer"
                            title="Xóa tiêu chí"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      disabled={anyBusy || rubricCriteria.length >= 8}
                      onClick={() =>
                        setRubricCriteria((prev) =>
                          prev.length >= 8
                            ? prev
                            : [
                                ...prev,
                                {
                                  criterionId: `CRIT_${String(prev.length + 1).padStart(2, "0")}`,
                                  name: `Tiêu chí ${prev.length + 1}`,
                                  maxPoints: 10,
                                  description: "",
                                  expectedSnippetOrConcept: "",
                                },
                              ]
                        )
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold border border-slate-300 dark:border-slate-700 hover:bg-slate-200/60 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Thêm tiêu chí ({rubricCriteria.length}/8)</span>
                    </button>

                    <button
                      type="button"
                      data-testid="save-manual-rubric-btn"
                      disabled={anyBusy}
                      onClick={handleSaveManualRubric}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-extrabold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white cursor-pointer mindx-dark-keep"
                    >
                      {isSavingRubric ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Save className="w-3.5 h-3.5" />
                      )}
                      <span>Lưu Barem 100đ</span>
                    </button>
                  </div>
                </div>
              )}

              {/* 3-Touch Action Bar */}
              <div className="p-3.5 rounded-xl border border-slate-300 dark:border-slate-700/80 bg-slate-100/80 dark:bg-slate-900/60 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                  <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700">
                    Đã nộp: <strong>{submissions.length}</strong>
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700">
                    Nghỉ / Chưa làm: <strong>{absentStudents.length}</strong>
                  </span>
                  {parseErrorCount > 0 && (
                    <span className="px-2.5 py-1 rounded-lg mindx-badge-amber">
                      Cảnh báo file: {parseErrorCount}
                    </span>
                  )}
                  <span className="px-2.5 py-1 rounded-lg mindx-badge-blue">
                    Chờ duyệt: {waitingCount} • Đã duyệt: {approvedCount}
                  </span>
                  <span className="px-2.5 py-1 rounded-lg mindx-badge-emerald">
                    Đã lưu LMS: {verifiedCount}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={anyBusy}
                    onClick={() => void loadPanelData(normalizedClass, stage)}
                    className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl text-xs font-bold border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:opacity-90 disabled:opacity-50 cursor-pointer"
                    title="Làm mới trạng thái bài nộp"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingData ? "animate-spin" : ""}`} />
                  </button>

                  <button
                    type="button"
                    data-testid="cp-download-grade-btn"
                    disabled={anyBusy}
                    onClick={handleDownloadAndGradeAi}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-extrabold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white shadow cursor-pointer mindx-dark-keep"
                  >
                    {isDownloadingAndGrading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    <span>1. Tải bài &amp; Chấm nháp AI</span>
                  </button>

                  <button
                    type="button"
                    data-testid="cp-approve-all-btn"
                    disabled={anyBusy || submissions.length === 0}
                    onMouseDown={() => {
                      suppressBlurSaveRef.current.__ALL__ = true;
                      setTimeout(() => {
                        delete suppressBlurSaveRef.current.__ALL__;
                      }, 600);
                    }}
                    onClick={handleApproveAllEligible}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-extrabold bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 shadow cursor-pointer"
                  >
                    {isApprovingAll ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    )}
                    <span>2. Duyệt tất cả hợp lệ</span>
                  </button>

                  <button
                    type="button"
                    data-testid="cp-save-lms-btn"
                    disabled={anyBusy || pushableLmsCount === 0}
                    onClick={() => void handleSaveToLms()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-extrabold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white shadow cursor-pointer mindx-dark-keep"
                  >
                    {isSavingLms ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                    <span>3. Đẩy điểm lên LMS ({pushableLmsCount})</span>
                  </button>
                </div>
              </div>

              {/* Roster Grading Table */}
              <div className="rounded-xl overflow-hidden border border-slate-300 dark:border-slate-700/80">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="mindx-thead text-[11px] uppercase font-bold">
                      <tr>
                        <th className="px-3 py-2.5 w-44">Học viên</th>
                        <th className="px-2.5 py-2.5 w-24 text-center">Quiz (LT)</th>
                        <th className="px-3 py-2.5 min-w-[180px]">Tệp bài nộp thực hành</th>
                        <th className="px-2.5 py-2.5 w-36 text-center">Điểm TH (0-100)</th>
                        <th className="px-3 py-2.5 min-w-[240px]">Nhận xét lưu LMS</th>
                        <th className="px-2.5 py-2.5 w-32 text-center">Trạng thái</th>
                        <th className="px-3 py-2.5 min-w-[180px] text-right">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {submissions.map((sub) => {
                        const isExpanded = Boolean(expandedSubIds[sub.submissionId]);
                        const isParseErr = sub.parseStatus === "PARSE_ERROR";
                        const isManualParseErrApproved =
                          isParseErr &&
                          (sub.status === "APPROVED" ||
                            sub.status === "VERIFIED" ||
                            (sub.status === "FAILED" && Boolean(sub.contentHash)));
                        const canPushToLms =
                          sub.status === "APPROVED" ||
                          (sub.status === "FAILED" && Boolean(sub.contentHash));
                        const canGradeSingle = !(
                          isParseErr &&
                          (sub.status === "APPROVED" || sub.status === "VERIFIED")
                        );
                        const isRowBusy = busySubId === sub.submissionId;
                        const isRowSingleGrading = singleGradingSubId === sub.submissionId;
                        const isRowOpeningFile = openingFileSubId === sub.submissionId;
                        const isRowApprovingManual = approvingManualSubId === sub.submissionId;
                        const effectiveScore =
                          typeof sub.teacherOverrideScore === "number" &&
                          Number.isFinite(sub.teacherOverrideScore)
                            ? Math.round(sub.teacherOverrideScore)
                            : Math.round(sub.calculatedScore || 0);

                        return (
                          <React.Fragment key={sub.submissionId}>
                            <tr className="bg-white/90 dark:bg-slate-900/80 hover:bg-slate-100/90 dark:hover:bg-slate-800/60 transition">
                              <td className="px-3 py-2.5 font-bold text-slate-900 dark:text-white">
                                <div>{sub.fullName}</div>
                                <div className="text-[10px] font-mono opacity-60 truncate max-w-[165px]">
                                  {sub.submissionId}
                                </div>
                              </td>
                              <td className="px-2.5 py-2.5 text-center font-bold text-sky-700 dark:text-sky-300">
                                {typeof sub.quizScore === "number" ? `${sub.quizScore}/100` : "—"}
                              </td>
                              <td className="px-3 py-2.5">
                                <div className="font-mono text-[11px] break-all">
                                  {sub.originalFileName || "(Chưa tải tệp)"}
                                </div>
                                {isParseErr ? (
                                  <button
                                    type="button"
                                    data-testid={`cp-expand-row-btn-${sub.studentId}`}
                                    onClick={() =>
                                      setExpandedSubIds((prev) => ({
                                        ...prev,
                                        [sub.submissionId]: !prev[sub.submissionId],
                                      }))
                                    }
                                    className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 dark:text-amber-300 hover:underline cursor-pointer"
                                  >
                                    {isExpanded ? (
                                      <ChevronDown className="w-3 h-3" />
                                    ) : (
                                      <ChevronRight className="w-3 h-3" />
                                    )}
                                    <span>
                                      {isExpanded ? "Thu gọn xử lý" : "Mở xem & Chấm tay"}
                                    </span>
                                  </button>
                                ) : (
                                  (sub.criteriaGrades.length > 0 || sub.codePreview) && (
                                    <button
                                      type="button"
                                      data-testid={`cp-expand-row-btn-${sub.studentId}`}
                                      onClick={() =>
                                        setExpandedSubIds((prev) => ({
                                          ...prev,
                                          [sub.submissionId]: !prev[sub.submissionId],
                                        }))
                                      }
                                      className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-purple-700 dark:text-purple-300 hover:underline cursor-pointer"
                                    >
                                      {isExpanded ? (
                                        <ChevronDown className="w-3 h-3" />
                                      ) : (
                                        <ChevronRight className="w-3 h-3" />
                                      )}
                                      <span>
                                        {isExpanded ? "Ẩn chi tiết tiêu chí & code" : "Xem tiêu chí & code"}
                                      </span>
                                    </button>
                                  )
                                )}
                              </td>
                              <td className="px-2.5 py-2.5 text-center">
                                {isManualParseErrApproved ? (
                                  <div className="flex flex-col items-center gap-1">
                                    <span className="text-sm font-extrabold text-emerald-700 dark:text-emerald-300">
                                      {effectiveScore}/100
                                    </span>
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold mindx-badge-amber">
                                      Chấm tay
                                    </span>
                                  </div>
                                ) : isParseErr ? (
                                  <span className="px-2 py-0.5 rounded text-[11px] font-bold mindx-badge-amber">
                                    Khóa an toàn
                                  </span>
                                ) : (
                                  <div className="flex flex-col items-center gap-1">
                                    <span className="text-sm font-extrabold text-emerald-700 dark:text-emerald-300">
                                      {effectiveScore}/100
                                    </span>
                                    <input
                                      type="number"
                                      min={0}
                                      max={100}
                                      step={1}
                                      placeholder={`AI: ${Math.round(sub.calculatedScore || 0)}`}
                                      value={overrideEdits[sub.submissionId] ?? ""}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setOverrideEdits((prev) => ({
                                          ...prev,
                                          [sub.submissionId]: val,
                                        }));
                                        setDirtySubIds((prev) => ({
                                          ...prev,
                                          [sub.submissionId]: true,
                                        }));
                                      }}
                                      onBlur={() => {
                                        if (
                                          dirtySubIds[sub.submissionId] &&
                                          sub.parseStatus === "PARSED" &&
                                          !suppressBlurSaveRef.current[sub.submissionId] &&
                                          !suppressBlurSaveRef.current.__ALL__
                                        ) {
                                          void saveDraftForSubmission(sub);
                                        }
                                      }}
                                      className="w-24 px-2 py-1 rounded text-center text-xs font-bold border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                                      title="Nhập số nguyên 0..100 nếu muốn chốt điểm khác AI (để trống = lấy tổng điểm tiêu chí)"
                                    />
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2.5">
                                {isManualParseErrApproved ? (
                                  <div className="p-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-[11px] text-slate-900 dark:text-slate-100 whitespace-pre-wrap break-words">
                                    {htmlToEditableText(sub.feedbackHtml)}
                                  </div>
                                ) : isParseErr ? (
                                  <div className="p-2 rounded-lg mindx-warm-box text-[11px] flex items-start gap-1.5">
                                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                                    <span>
                                      {sub.parseErrorReason ||
                                        "Lỗi đọc tệp bài nộp — hệ thống không tự chấm 0đ."}
                                    </span>
                                  </div>
                                ) : (
                                  <textarea
                                    rows={2}
                                    value={noteEdits[sub.submissionId] ?? ""}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setNoteEdits((prev) => ({
                                        ...prev,
                                        [sub.submissionId]: val,
                                      }));
                                      setDirtySubIds((prev) => ({
                                        ...prev,
                                        [sub.submissionId]: true,
                                      }));
                                    }}
                                    onBlur={() => {
                                      if (
                                        dirtySubIds[sub.submissionId] &&
                                        sub.parseStatus === "PARSED" &&
                                        !suppressBlurSaveRef.current[sub.submissionId] &&
                                        !suppressBlurSaveRef.current.__ALL__
                                      ) {
                                        void saveDraftForSubmission(sub);
                                      }
                                    }}
                                    placeholder="Nhận xét bài làm Checkpoint..."
                                    className="w-full px-2.5 py-1.5 rounded-lg text-xs border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                                  />
                                )}
                              </td>
                              <td className="px-2.5 py-2.5 text-center">
                                <div className="flex flex-col items-center gap-1">
                                  {sub.status === "VERIFIED" ? (
                                    <span className="px-2 py-0.5 rounded-full text-[11px] mindx-badge-emerald">
                                      ✓ Đã lưu LMS
                                    </span>
                                  ) : sub.status === "APPROVED" ? (
                                    <span className="px-2 py-0.5 rounded-full text-[11px] mindx-badge-blue">
                                      Đã duyệt
                                    </span>
                                  ) : sub.status === "WAITING_APPROVAL" ? (
                                    <span className="px-2 py-0.5 rounded-full text-[11px] mindx-badge-purple">
                                      Chờ duyệt
                                    </span>
                                  ) : sub.status === "FAILED" ? (
                                    <span
                                      className="px-2 py-0.5 rounded-full text-[11px] bg-rose-600 text-white font-bold mindx-dark-keep"
                                      title={sub.errorMessage || ""}
                                    >
                                      Lỗi lưu
                                    </span>
                                  ) : !isParseErr ? (
                                    <span className="px-2 py-0.5 rounded-full text-[11px] bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold">
                                      Chưa chấm
                                    </span>
                                  ) : null}

                                  {isParseErr && (
                                    <span className="px-2 py-0.5 rounded-full text-[11px] mindx-badge-amber">
                                      PARSE_ERROR
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                                  {canGradeSingle && (
                                    <button
                                      type="button"
                                      data-testid={`cp-grade-single-btn-${sub.studentId}`}
                                      disabled={anyBusy}
                                      onClick={() => void handleGradeSingle(sub)}
                                      className="neo-btn-blue px-2.5 py-1 rounded-lg text-[11px] font-bold disabled:opacity-40 cursor-pointer whitespace-nowrap mindx-dark-keep"
                                      title="Tải bài mới nhất từ LMS và chấm nháp AI riêng cho học viên này"
                                    >
                                      {isRowSingleGrading ? "Đang chấm..." : "⚡ Chấm riêng"}
                                    </button>
                                  )}
                                  {!isParseErr && sub.parseStatus === "PARSED" && (
                                    <button
                                      type="button"
                                      disabled={anyBusy}
                                      onMouseDown={() => {
                                        suppressBlurSaveRef.current[sub.submissionId] = true;
                                        setTimeout(() => {
                                          delete suppressBlurSaveRef.current[sub.submissionId];
                                        }, 600);
                                      }}
                                      onClick={() => void handleApproveSingle(sub)}
                                      className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 cursor-pointer"
                                    >
                                      {isRowBusy && !isRowSingleGrading ? "..." : "Duyệt"}
                                    </button>
                                  )}
                                  {canPushToLms && (
                                    <button
                                      type="button"
                                      data-testid={`cp-save-single-lms-btn-${sub.studentId}`}
                                      disabled={anyBusy}
                                      onClick={() => void handleSaveToLms(sub.submissionId)}
                                      className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white cursor-pointer mindx-dark-keep whitespace-nowrap"
                                    >
                                      {sub.status === "FAILED" ? "Thử lại LMS" : "Lưu LMS"}
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>

                            {/* Expanded PARSE_ERROR Inspection & Manual Grading */}
                            {isExpanded && isParseErr && (
                              <tr className="bg-slate-100/95 dark:bg-slate-950/90">
                                <td colSpan={7} className="p-4 space-y-3">
                                  <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl mindx-warm-box text-xs">
                                    <div className="flex items-start gap-2 min-w-0 flex-1">
                                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                                      <span className="font-semibold break-words">
                                        {sub.parseErrorReason ||
                                          "Lỗi đọc tệp bài nộp — không thể phân tích tự động."}
                                      </span>
                                    </div>
                                    <button
                                      type="button"
                                      data-testid={`cp-open-raw-file-btn-${sub.studentId}`}
                                      disabled={anyBusy || !sub.localFilePath}
                                      onClick={() => void handleOpenRawFile(sub)}
                                      className="neo-btn-neutral px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-45 cursor-pointer shrink-0 whitespace-nowrap"
                                      title={
                                        sub.localFilePath
                                          ? "Mở thư mục chứa tệp bài nộp gốc trên máy để xem trực tiếp"
                                          : "Chưa có tệp trên máy — bấm ⚡ Chấm riêng để tải về trước"
                                      }
                                    >
                                      {isRowOpeningFile ? "Đang mở..." : "📂 Xem file gốc"}
                                    </button>
                                  </div>

                                  <div className="neo-section-card p-3.5 rounded-xl space-y-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="text-xs font-black">✍️ Chấm tay</span>
                                      {isManualParseErrApproved && (
                                        <span className="px-2 py-0.5 rounded-full text-[11px] mindx-badge-emerald">
                                          ✓ Đã duyệt chấm tay ({effectiveScore}/100đ)
                                        </span>
                                      )}
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
                                      <div className="md:col-span-3">
                                        <label
                                          htmlFor={`cp-manual-score-${sub.studentId}`}
                                          className="block text-[11px] font-bold mb-1"
                                        >
                                          Điểm nguyên (0–100)
                                        </label>
                                        <input
                                          id={`cp-manual-score-${sub.studentId}`}
                                          type="number"
                                          min={0}
                                          max={100}
                                          step={1}
                                          data-testid={`cp-manual-score-input-${sub.studentId}`}
                                          value={overrideEdits[sub.submissionId] ?? ""}
                                          onChange={(e) => {
                                            const val = e.target.value;
                                            setOverrideEdits((prev) => ({
                                              ...prev,
                                              [sub.submissionId]: val,
                                            }));
                                          }}
                                          placeholder="0 - 100"
                                          className="w-full px-2.5 py-2 rounded-lg text-xs font-bold border-2 border-[#0f172a] dark:border-slate-500 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                                        />
                                      </div>

                                      <div className="md:col-span-7">
                                        <label
                                          htmlFor={`cp-manual-feedback-${sub.studentId}`}
                                          className="block text-[11px] font-bold mb-1"
                                        >
                                          Nhận xét giáo viên (&ge; 10 ký tự)
                                        </label>
                                        <textarea
                                          id={`cp-manual-feedback-${sub.studentId}`}
                                          rows={2}
                                          data-testid={`cp-manual-feedback-input-${sub.studentId}`}
                                          value={noteEdits[sub.submissionId] ?? ""}
                                          onChange={(e) => {
                                            const val = e.target.value;
                                            setNoteEdits((prev) => ({
                                              ...prev,
                                              [sub.submissionId]: val,
                                            }));
                                          }}
                                          placeholder="Nhập nhận xét sau khi xem bài làm gốc (tối thiểu 10 ký tự)..."
                                          className="w-full px-3 py-2 rounded-lg text-xs border-2 border-[#0f172a] dark:border-slate-500 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                                        />
                                      </div>

                                      <div className="md:col-span-2 flex md:justify-end md:pt-5">
                                        <button
                                          type="button"
                                          data-testid={`cp-approve-manual-parse-err-btn-${sub.studentId}`}
                                          disabled={anyBusy}
                                          onClick={() => void handleApproveManualParseError(sub)}
                                          className="neo-btn-yellow w-full md:w-auto px-3 py-2 rounded-xl text-xs font-black disabled:opacity-45 cursor-pointer whitespace-nowrap"
                                        >
                                          {isRowApprovingManual ? "Đang duyệt..." : "Duyệt chấm tay"}
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}

                            {/* Expanded Criteria & Code Preview */}
                            {isExpanded && !isParseErr && (
                              <tr className="bg-slate-100/95 dark:bg-slate-950/90">
                                <td colSpan={7} className="p-4 space-y-3">
                                  {sub.criteriaGrades.length > 0 && (
                                    <div className="space-y-1.5">
                                      <div className="text-[11px] font-extrabold uppercase text-purple-800 dark:text-purple-300">
                                        Chi tiết điểm từng tiêu chí (Tự động cộng tổng bằng TypeScript)
                                      </div>
                                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                        {sub.criteriaGrades.map((cg, cIdx) => (
                                          <div
                                            key={cg.criterionId || cIdx}
                                            className="p-2.5 rounded-lg border border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1"
                                          >
                                            <div className="flex items-center justify-between gap-2">
                                              <span className="font-bold text-xs">
                                                {cg.criterionName || cg.criterionId}
                                              </span>
                                              <span className="font-extrabold text-emerald-700 dark:text-emerald-300">
                                                {cg.earnedPoints}/{cg.maxPoints ?? "?"}đ
                                              </span>
                                            </div>
                                            {cg.evidenceSnippet && (
                                              <div className="text-[11px] font-mono bg-slate-100 dark:bg-slate-950 px-2 py-1 rounded break-words">
                                                Bằng chứng: {cg.evidenceSnippet}
                                              </div>
                                            )}
                                            {cg.deductionReason && (
                                              <div className="text-[11px] opacity-85">
                                                Nhận xét: {cg.deductionReason}
                                              </div>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {sub.codePreview && (
                                    <div>
                                      <div className="text-[11px] font-extrabold uppercase mb-1 opacity-80">
                                        Trích xuất bài nộp ({sub.subjectType || "CODE"}):
                                      </div>
                                      <pre className="max-h-64 overflow-auto p-3 rounded-xl bg-slate-950 text-slate-100 text-[11px] font-mono whitespace-pre-wrap break-words border border-slate-800">
                                        {sub.codePreview}
                                      </pre>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}

                      {/* Absent / Unsubmitted Students */}
                      {absentStudents.map((st) => (
                        <tr
                          key={`absent_${st.studentId}`}
                          className="bg-slate-100/60 dark:bg-slate-900/40 opacity-75"
                        >
                          <td className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">
                            {st.fullName}
                          </td>
                          <td className="px-2.5 py-2 text-center font-semibold text-sky-700 dark:text-sky-400">
                            {typeof st.quizScore === "number" ? `${st.quizScore}/100` : "Chưa làm"}
                          </td>
                          <td colSpan={3} className="px-3 py-2 text-slate-600 dark:text-slate-400 italic">
                            <span className="inline-flex items-center gap-1.5">
                              <UserX className="w-3.5 h-3.5 shrink-0" />
                              <span>
                                Nghỉ / Chưa nộp bài thực hành Checkpoint — Hệ thống tự động bỏ qua
                                (không chấm 0đ)
                              </span>
                            </span>
                          </td>
                          <td className="px-2.5 py-2 text-center">
                            <span className="px-2 py-0.5 rounded-full text-[11px] bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-semibold">
                              Bỏ qua
                            </span>
                          </td>
                          <td className="px-3 py-2" />
                        </tr>
                      ))}

                      {submissions.length === 0 && absentStudents.length === 0 && !isLoadingData && (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center opacity-75">
                            Chưa có dữ liệu bài nộp cho <strong>{normalizedClass}</strong> (Buổi{" "}
                            {sessionNumber}). Bấm{" "}
                            <strong>&quot;1. Tải bài &amp; Chấm nháp AI&quot;</strong> để Bot tải bài từ
                            LMS và chấm tự động!
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
