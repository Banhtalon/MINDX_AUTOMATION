"use client";

import React, { useState, useEffect } from "react";
import {
  Bot,
  Download,
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  Clock,
  Code2,
  Send,
  ShieldCheck,
  Sparkles,
  FileWarning,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  RefreshCw,
} from "lucide-react";

export interface CriterionGradeItem {
  criterionId: string;
  criterionName: string;
  earnedPoints: number;
  maxPoints: number;
  evidenceSnippet: string;
  deductionReason: string;
}

export interface GradingCriterion {
  criterionId: string;
  name: string;
  maxPoints: number;
  description: string;
  expectedSnippetOrConcept: string;
}

export interface GradingRubric {
  rubricId: string;
  courseCode: string;
  sessionNumber: number;
  assignmentTitle: string;
  assignmentPrompt: string;
  maxTotalScore: number;
  criteria: GradingCriterion[];
}

export interface SubmissionRowItem {
  submissionId: string;
  classId: string;
  sessionId: string;
  studentId: string;
  fullName: string;
  isActive?: boolean;
  originalFileName?: string;
  localFilePath?: string;
  fileHash?: string;
  parseStatus: "PENDING" | "PARSED" | "PARSE_ERROR";
  parseErrorReason?: string | null;
  criteriaGrades: CriterionGradeItem[];
  calculatedScore: number;
  teacherOverrideScore?: number | null;
  decision: "GRADE" | "REDO";
  feedbackHtml: string;
  contentHash?: string;
  status:
    | "PENDING"
    | "ANALYZING"
    | "WAITING_APPROVAL"
    | "APPROVED"
    | "SAVING"
    | "VERIFIED"
    | "FAILED";
  verifiedAt?: string | null;
  errorMessage?: string | null;
  codePreview?: string;
  subjectType?: string;
}

interface HomeworkAutoGraderTabProps {
  classId: string;
  classCode: string;
  columns: Array<{
    colIndex: number;
    columnId: string;
    lessonId?: string;
    title: string;
    sessionNumber: number;
  }>;
  initialRubrics: GradingRubric[];
  onRefreshMatrix?: () => void;
}

let latestLoadRequestSeq = 0;
let activeScopeKey = "";
const latestDraftSaveSeqBySub: Record<string, number> = {};
const unsavedFlagBySub: Record<string, boolean> = {};
const localDraftSnapshotBySub: Record<string, SubmissionRowItem> = {};

export function HomeworkAutoGraderTab({
  classId,
  classCode,
  columns,
  initialRubrics,
  onRefreshMatrix,
}: HomeworkAutoGraderTabProps) {
  const normClass = classId.trim().toUpperCase();

  // Session & Lesson selection
  const [selectedSessionNumber, setSelectedSessionNumber] = useState<number>(1);
  const selectedColumn =
    columns.find((c) => c.sessionNumber === selectedSessionNumber) ||
    columns[selectedSessionNumber - 1] ||
    columns[0];
  const sessionId = `${normClass}_SESS_${String(selectedSessionNumber).padStart(2, "0")}`;
  const lessonId = selectedColumn?.lessonId || selectedColumn?.columnId || "";
  const currentScopeKey = `${normClass}::${sessionId}::${lessonId}`;
  activeScopeKey = currentScopeKey;

  // Rubrics state
  const [rubrics, setRubrics] = useState<GradingRubric[]>(initialRubrics || []);
  const [selectedRubricId, setSelectedRubricId] = useState<string>("");
  const [activeRubric, setActiveRubric] = useState<GradingRubric>({
    rubricId: "CUSTOM_RUBRIC",
    courseCode: "CUSTOM",
    sessionNumber: 1,
    assignmentTitle: "Bài tập thực hành buổi học",
    assignmentPrompt: "Hoàn thành đúng yêu cầu kỹ thuật của bài tập về nhà trong buổi học.",
    maxTotalScore: 100,
    criteria: [
      {
        criterionId: "CRIT_01",
        name: "Hoàn thành chức năng / giao diện chính",
        maxPoints: 40,
        description: "Xây dựng đầy đủ các thành phần/hàm/đối tượng theo yêu cầu đề bài.",
        expectedSnippetOrConcept: "Hàm, lớp, Object hoặc bố cục chính",
      },
      {
        criterionId: "CRIT_02",
        name: "Logic thuật toán & Xử lý sự kiện",
        maxPoints: 40,
        description: "Logic xử lý đúng, không phát sinh lỗi cú pháp hoặc lỗi thực thi.",
        expectedSnippetOrConcept: "Điều kiện, vòng lặp, sự kiện tương tác",
      },
      {
        criterionId: "CRIT_03",
        name: "Quy chuẩn mã nguồn & Trình bày",
        maxPoints: 20,
        description: "Đặt tên biến/tài nguyên rõ nghĩa, cấu trúc bài nộp gọn gàng.",
        expectedSnippetOrConcept: "Clean code, đặt tên chuẩn",
      },
    ],
  });
  const [showRubricEditor, setShowRubricEditor] = useState(false);

  // Submissions state
  const [submissions, setSubmissions] = useState<SubmissionRowItem[]>([]);
  const [unsavedSubIds, setUnsavedSubIds] = useState<Record<string, boolean>>({});
  const [expandedSubId, setExpandedSubId] = useState<string | null>(null);
  const [inspectCodeSub, setInspectCodeSub] = useState<SubmissionRowItem | null>(null);

  // Loading flags
  const [isLoadingSubs, setIsLoadingSubs] = useState(false);
  const [isDownloadingAndGrading, setIsDownloadingAndGrading] = useState(false);
  const [isSavingLms, setIsSavingLms] = useState(false);
  const [banner, setBanner] = useState<{
    type: "info" | "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (initialRubrics && initialRubrics.length > 0) {
      setRubrics(initialRubrics);
      const matched =
        initialRubrics.find(
          (r) =>
            normClass.includes(r.courseCode.toUpperCase()) &&
            r.sessionNumber === selectedSessionNumber
        ) ||
        initialRubrics.find((r) => normClass.includes(r.courseCode.toUpperCase())) ||
        initialRubrics[0];

      if (matched) {
        setSelectedRubricId(matched.rubricId);
        setActiveRubric(structuredClone(matched));
      }
    }
  }, [initialRubrics, normClass, selectedSessionNumber]);

  useEffect(() => {
    for (const k of Object.keys(unsavedFlagBySub)) {
      delete unsavedFlagBySub[k];
    }
    for (const k of Object.keys(localDraftSnapshotBySub)) {
      delete localDraftSnapshotBySub[k];
    }
    setUnsavedSubIds((prev) => (Object.keys(prev).length === 0 ? prev : {}));
    setSubmissions((prev) => (prev.length === 0 ? prev : []));
    loadSessionSubmissions(currentScopeKey);
  }, [normClass, sessionId, lessonId]);

  const loadSessionSubmissions = async (targetScopeKey?: string | unknown) => {
    if (!normClass || !sessionId) return;
    const scopeToMatch =
      typeof targetScopeKey === "string" && targetScopeKey ? targetScopeKey : currentScopeKey;
    if (scopeToMatch !== activeScopeKey) {
      return;
    }
    const reqSeq = ++latestLoadRequestSeq;
    const expectedClassId = normClass;
    const expectedSessionId = sessionId;
    setIsLoadingSubs(true);
    try {
      const res = await fetch(
        `/api/homework-grader/submissions?classId=${encodeURIComponent(
          expectedClassId
        )}&sessionId=${encodeURIComponent(expectedSessionId)}&lessonId=${encodeURIComponent(lessonId)}`
      );
      const json = await res.json();
      if (reqSeq !== latestLoadRequestSeq || activeScopeKey !== scopeToMatch) {
        return;
      }
      if (json.success && Array.isArray(json.data?.submissions)) {
        const scopedSubs = json.data.submissions.filter(
          (s: any) =>
            (!s.classId || String(s.classId).trim().toUpperCase() === expectedClassId) &&
            (!s.sessionId || String(s.sessionId).trim() === expectedSessionId)
        );
        const prevMap = new Map<string, SubmissionRowItem>();
        for (const item of submissions) {
          prevMap.set(item.submissionId, item);
        }
        for (const [subId, snap] of Object.entries(localDraftSnapshotBySub)) {
          prevMap.set(subId, snap);
        }
        const retainedUnsavedIds: Record<string, boolean> = {};
        const mergedSubs: SubmissionRowItem[] = scopedSubs.map((s: SubmissionRowItem) => {
          const serverDraftSeq =
            typeof (s as any).draftSeq === "number" ? (s as any).draftSeq : 0;
          const localDraftSeq = latestDraftSaveSeqBySub[s.submissionId] || 0;
          if (serverDraftSeq > localDraftSeq) {
            latestDraftSaveSeqBySub[s.submissionId] = serverDraftSeq;
          }
          const hasPendingLocalDraft =
            Boolean(unsavedFlagBySub[s.submissionId]) && serverDraftSeq < localDraftSeq;
          const localItem = prevMap.get(s.submissionId);
          const hasChangedFileHash = Boolean(
            localItem && s.fileHash && localItem.fileHash && s.fileHash !== localItem.fileHash
          );
          if (!hasPendingLocalDraft || !localItem || hasChangedFileHash) {
            delete unsavedFlagBySub[s.submissionId];
            localDraftSnapshotBySub[s.submissionId] = s;
            return s;
          }
          retainedUnsavedIds[s.submissionId] = true;
          const mergedItem: SubmissionRowItem = {
            ...s,
            criteriaGrades: localItem.criteriaGrades,
            calculatedScore: localItem.calculatedScore,
            teacherOverrideScore: localItem.teacherOverrideScore,
            decision: localItem.decision,
            feedbackHtml: localItem.feedbackHtml,
            status: "WAITING_APPROVAL",
            contentHash: "",
          };
          localDraftSnapshotBySub[s.submissionId] = mergedItem;
          return mergedItem;
        });
        for (const k of Object.keys(unsavedFlagBySub)) {
          if (!retainedUnsavedIds[k]) {
            delete unsavedFlagBySub[k];
          }
        }
        if (
          (!initialRubrics || initialRubrics.length === 0) &&
          activeRubric.rubricId === "CUSTOM_RUBRIC" &&
          scopedSubs.length > 0 &&
          Array.isArray(scopedSubs[0]?.criteriaGrades) &&
          scopedSubs[0].criteriaGrades.length > 0
        ) {
          const derivedCriteria = scopedSubs[0].criteriaGrades.map((c: any) => ({
            criterionId: String(c?.criterionId || "").trim(),
            name: String(c?.criterionName || c?.name || c?.criterionId || "").trim(),
            maxPoints: Number(c?.maxPoints || 0),
            description: String(c?.description || ""),
            expectedSnippetOrConcept: String(c?.expectedSnippetOrConcept || ""),
          }));
          const derivedMax = derivedCriteria.reduce(
            (sum: number, c: any) => sum + (Number.isFinite(c.maxPoints) ? c.maxPoints : 0),
            0
          );
          if (derivedMax > 0) {
            setActiveRubric((prev) =>
              prev.rubricId === "CUSTOM_RUBRIC"
                ? {
                    ...prev,
                    maxTotalScore: derivedMax,
                    criteria: derivedCriteria,
                  }
                : prev
            );
          }
        }
        setUnsavedSubIds(retainedUnsavedIds);
        setSubmissions(mergedSubs);
      }
    } catch (err: any) {
      if (reqSeq === latestLoadRequestSeq && activeScopeKey === scopeToMatch) {
        console.error("Lỗi tải danh sách bài nộp:", err);
      }
    } finally {
      if (reqSeq === latestLoadRequestSeq && activeScopeKey === scopeToMatch) {
        setIsLoadingSubs(false);
      }
    }
  };

  const handleSelectRubricPreset = (rubricId: string) => {
    setSelectedRubricId(rubricId);
    const found = rubrics.find((r) => r.rubricId === rubricId);
    if (found) {
      setActiveRubric(structuredClone(found));
    }
  };

  const handleDownloadAndAiGrade = async (opts?: { skipDownload?: boolean; skipAi?: boolean }) => {
    const scopeAtStart = currentScopeKey;
    setIsDownloadingAndGrading(true);
    setBanner({
      type: "info",
      text: opts?.skipAi
        ? `Đang tải file bài nộp Buổi ${selectedSessionNumber} về máy & phân tích cấu trúc...`
        : opts?.skipDownload
        ? `Đang chạy AI chấm điểm theo Barem cho các file đã tải của Buổi ${selectedSessionNumber}...`
        : `Đang tải file bài nộp từ LMS, khóa cứng (submissionId → studentId → fileHash) và gọi AI chấm theo Barem...`,
    });

    try {
      const res = await fetch("/api/homework-grader/download-and-grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: normClass,
          classCode: normClass,
          sessionId,
          lessonId,
          rubric: activeRubric,
          skipDownload: opts?.skipDownload,
          skipAi: opts?.skipAi,
        }),
      });
      const json = await res.json();
      if (activeScopeKey !== scopeAtStart) {
        return;
      }
      if (json.success) {
        await loadSessionSubmissions(scopeAtStart);
        if (activeScopeKey !== scopeAtStart) {
          return;
        }
        const dl = json.data?.downloadResult;
        const gr = json.data?.gradeResults || [];
        const gradedOk = gr.filter((x: any) => x.status === "WAITING_APPROVAL").length;
        const parseErrs = gr.filter((x: any) => x.parseStatus === "PARSE_ERROR").length;

        setBanner({
          type: "success",
          text: opts?.skipAi
            ? `Đã tải ${dl?.downloadedCount ?? 0}/${dl?.totalCandidates ?? 0} bài nộp (${dl?.parsedCount ?? 0} đọc thành công, ${dl?.parseErrorCount ?? 0} lỗi PARSE_ERROR).`
            : `Hoàn tất! Đã phân tích & đề xuất điểm cho ${gradedOk} bài nộp${
                parseErrs > 0
                  ? ` (${parseErrs} bài bị PARSE_ERROR được giữ nguyên để GV kiểm tra thủ công)`
                  : ""
              }.`,
        });
      } else {
        setBanner({
          type: "error",
          text: `Thất bại: ${json.error || "Không thể tải và chấm bài tự động."}`,
        });
      }
    } catch (err: any) {
      if (activeScopeKey === scopeAtStart) {
        setBanner({
          type: "error",
          text: `Lỗi kết nối API: ${err.message}`,
        });
      }
    } finally {
      setIsDownloadingAndGrading(false);
    }
  };

  const handleCriterionPointsChange = async (
    sub: SubmissionRowItem,
    criterionId: string,
    newPointsRaw: string
  ) => {
    const updatedCriteria = sub.criteriaGrades.map((c) => {
      if (c.criterionId !== criterionId) return c;
      const num = Number(newPointsRaw);
      const clamped = Number.isFinite(num)
        ? Math.max(0, Math.min(c.maxPoints, Math.round(num * 100) / 100))
        : 0;
      return {
        ...c,
        earnedPoints: clamped,
        evidenceSnippet: c.evidenceSnippet || "Giáo viên kiểm tra thủ công.",
        deductionReason:
          clamped < c.maxPoints
            ? c.deductionReason || "Giáo viên điều chỉnh điểm tiêu chí."
            : c.deductionReason || "Đạt tối đa tiêu chí.",
      };
    });

    const newCalculatedScore = Math.round(
      updatedCriteria.reduce((acc, item) => acc + Number(item.earnedPoints || 0), 0) * 100
    ) / 100;

    const nextCriterionItem: SubmissionRowItem = {
      ...(localDraftSnapshotBySub[sub.submissionId] || sub),
      criteriaGrades: updatedCriteria,
      calculatedScore: newCalculatedScore,
      status: "WAITING_APPROVAL",
      contentHash: "",
    };
    localDraftSnapshotBySub[sub.submissionId] = nextCriterionItem;

    setSubmissions((prev) =>
      prev.map((item) =>
        item.submissionId === sub.submissionId
          ? {
              ...item,
              criteriaGrades: updatedCriteria,
              calculatedScore: newCalculatedScore,
              status: "WAITING_APPROVAL",
              contentHash: "",
            }
          : item
      )
    );
    const baseSeq = Math.max(
      latestDraftSaveSeqBySub[sub.submissionId] || 0,
      typeof (sub as any).draftSeq === "number" ? (sub as any).draftSeq : 0
    );
    const saveSeq = baseSeq + 1;
    latestDraftSaveSeqBySub[sub.submissionId] = saveSeq;
    unsavedFlagBySub[sub.submissionId] = true;
    setUnsavedSubIds((prev) => ({ ...prev, [sub.submissionId]: true }));

    try {
      const res = await fetch("/api/homework-grader/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: normClass,
          sessionId,
          studentId: sub.studentId,
          submissionId: sub.submissionId,
          draftSeq: saveSeq,
          rubric: activeRubric,
          criteriaGrades: updatedCriteria,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (latestDraftSaveSeqBySub[sub.submissionId] !== saveSeq) {
        return false;
      }
      if (!res.ok || !json.success) {
        setBanner({
          type: "error",
          text: `Lỗi lưu nháp điểm tiêu chí của ${sub.fullName}: ${
            json.error || `HTTP ${res.status}`
          }`,
        });
        return false;
      }
      delete unsavedFlagBySub[sub.submissionId];
      setUnsavedSubIds((prev) => {
        if (!prev[sub.submissionId]) return prev;
        const next = { ...prev };
        delete next[sub.submissionId];
        return next;
      });
      return true;
    } catch (err: any) {
      if (latestDraftSaveSeqBySub[sub.submissionId] === saveSeq) {
        setBanner({
          type: "error",
          text: `Lỗi kết nối khi lưu nháp bài của ${sub.fullName}: ${err.message}`,
        });
      }
      return false;
    }
  };

  const handleFieldUpdate = async (
    sub: SubmissionRowItem,
    patch: {
      decision?: "GRADE" | "REDO";
      teacherOverrideScore?: number | null;
      feedbackHtml?: string;
    }
  ) => {
    const nextFieldItem: SubmissionRowItem = {
      ...(localDraftSnapshotBySub[sub.submissionId] || sub),
      ...patch,
      status: "WAITING_APPROVAL",
      contentHash: "",
    };
    localDraftSnapshotBySub[sub.submissionId] = nextFieldItem;

    setSubmissions((prev) =>
      prev.map((item) =>
        item.submissionId === sub.submissionId
          ? {
              ...item,
              ...patch,
              status: "WAITING_APPROVAL",
              contentHash: "",
            }
          : item
      )
    );
    const baseSeq = Math.max(
      latestDraftSaveSeqBySub[sub.submissionId] || 0,
      typeof (sub as any).draftSeq === "number" ? (sub as any).draftSeq : 0
    );
    const saveSeq = baseSeq + 1;
    latestDraftSaveSeqBySub[sub.submissionId] = saveSeq;
    unsavedFlagBySub[sub.submissionId] = true;
    setUnsavedSubIds((prev) => ({ ...prev, [sub.submissionId]: true }));

    try {
      const res = await fetch("/api/homework-grader/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: normClass,
          sessionId,
          studentId: sub.studentId,
          submissionId: sub.submissionId,
          draftSeq: saveSeq,
          ...patch,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (latestDraftSaveSeqBySub[sub.submissionId] !== saveSeq) {
        return false;
      }
      if (!res.ok || !json.success) {
        setBanner({
          type: "error",
          text: `Lỗi lưu nháp bài của ${sub.fullName}: ${json.error || `HTTP ${res.status}`}`,
        });
        return false;
      }
      delete unsavedFlagBySub[sub.submissionId];
      setUnsavedSubIds((prev) => {
        if (!prev[sub.submissionId]) return prev;
        const next = { ...prev };
        delete next[sub.submissionId];
        return next;
      });
      return true;
    } catch (err: any) {
      if (latestDraftSaveSeqBySub[sub.submissionId] === saveSeq) {
        setBanner({
          type: "error",
          text: `Lỗi kết nối khi lưu nháp bài của ${sub.fullName}: ${err.message}`,
        });
      }
      return false;
    }
  };

  const handleApproveSubmission = async (sub: SubmissionRowItem): Promise<boolean> => {
    if (unsavedSubIds[sub.submissionId] || unsavedFlagBySub[sub.submissionId]) {
      setBanner({
        type: "error",
        text: `Bài của ${sub.fullName} có thay đổi nháp chưa lưu thành công. Vui lòng lưu nháp trước khi duyệt.`,
      });
      return false;
    }
    try {
      const res = await fetch("/api/homework-grader/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: normClass,
          sessionId,
          studentId: sub.studentId,
          submissionId: sub.submissionId,
          fileHash: sub.fileHash,
          rubric: activeRubric,
          criteriaGrades: sub.criteriaGrades || [],
          teacherOverrideScore: sub.teacherOverrideScore ?? null,
          decision: sub.decision || "GRADE",
          feedbackHtml: sub.feedbackHtml || "",
        }),
      });
      const json = await res.json();
      if (json.success && json.data) {
        setSubmissions((prev) =>
          prev.map((item) =>
            item.submissionId === sub.submissionId
              ? {
                  ...item,
                  status: json.data.status,
                  contentHash: json.data.contentHash,
                  calculatedScore: json.data.calculatedScore,
                }
              : item
          )
        );
        setBanner({
          type: "success",
          text: `Đã duyệt & khóa SHA-256 contentHash cho bài nộp của ${sub.fullName}.`,
        });
        return true;
      } else {
        setBanner({
          type: "error",
          text: `Không thể duyệt bài của ${sub.fullName}: ${json.error}`,
        });
        return false;
      }
    } catch (err: any) {
      setBanner({
        type: "error",
        text: `Lỗi khi duyệt bài: ${err.message}`,
      });
      return false;
    }
  };

  const handleApproveAll = async (): Promise<boolean> => {
    if (
      Object.keys(unsavedSubIds).some((id) => unsavedSubIds[id]) ||
      Object.keys(unsavedFlagBySub).some((id) => unsavedFlagBySub[id])
    ) {
      setBanner({
        type: "error",
        text: "Có bài nộp đang có thay đổi nháp chưa lưu thành công. Vui lòng lưu nháp trước khi duyệt hàng loạt.",
      });
      return false;
    }
    const scopeAtStart = currentScopeKey;
    try {
      const res = await fetch("/api/homework-grader/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: normClass,
          sessionId,
          approveAll: true,
          rubric: activeRubric,
          reviewedSubmissions: submissions.map((s) => ({
            submissionId: s.submissionId,
            fileHash: s.fileHash || "",
            feedbackHtml: s.feedbackHtml || "",
            criteriaGrades: s.criteriaGrades || [],
            decision: s.decision || "GRADE",
            teacherOverrideScore: s.teacherOverrideScore ?? null,
          })),
        }),
      });
      const json = await res.json();
      if (activeScopeKey !== scopeAtStart) {
        return false;
      }
      if (json.success) {
        await loadSessionSubmissions(scopeAtStart);
        if (activeScopeKey !== scopeAtStart) {
          return false;
        }
        const count = json.data?.approvedCount ?? 0;
        const skipped = json.data?.skippedIds?.length ?? 0;
        setBanner({
          type: "success",
          text: `Đã duyệt hàng loạt ${count} bài nộp hợp lệ${
            skipped > 0 ? ` (Bỏ qua ${skipped} bài chưa đủ điều kiện / PARSE_ERROR)` : ""
          }.`,
        });
        return count > 0;
      } else {
        setBanner({
          type: "error",
          text: `Lỗi duyệt hàng loạt: ${json.error}`,
        });
        return false;
      }
    } catch (err: any) {
      if (activeScopeKey === scopeAtStart) {
        setBanner({
          type: "error",
          text: `Lỗi kết nối khi duyệt hàng loạt: ${err.message}`,
        });
      }
      return false;
    }
  };

  const handleSaveToLms = async (singleSub?: SubmissionRowItem) => {
    const scopeAtStart = currentScopeKey;
    if (singleSub) {
      if (singleSub.status !== "APPROVED" && singleSub.status !== "VERIFIED") {
        const ok = await handleApproveSubmission(singleSub);
        if (!ok) return;
      }
    } else {
      const hasApproved = submissions.some((s) => s.status === "APPROVED");
      if (!hasApproved) {
        const ok = await handleApproveAll();
        if (!ok) return;
      }
    }

    setIsSavingLms(true);
    setBanner({
      type: "info",
      text: singleSub
        ? `Đang mở Modal LMS để điền điểm & nhận xét cho ${singleSub.fullName} + đối chiếu Read-after-Write...`
        : `Đang tự động lưu toàn bộ bài đã duyệt của Buổi ${selectedSessionNumber} lên LMS & đối chiếu Read-after-Write...`,
    });

    try {
      const res = await fetch("/api/homework-grader/save-lms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: normClass,
          classCode: normClass,
          sessionId,
          lessonId,
          submissionId: singleSub?.submissionId,
        }),
      });
      const json = await res.json();
      if (activeScopeKey !== scopeAtStart) {
        return;
      }
      await loadSessionSubmissions(scopeAtStart);
      if (activeScopeKey !== scopeAtStart) {
        return;
      }
      onRefreshMatrix?.();

      if (json.success && json.data) {
        setBanner({
          type: "success",
          text: `Đã lưu & đối chiếu VERIFIED ${json.data.verifiedCount}/${json.data.totalCandidates} bài nộp trên LMS thành công!`,
        });
      } else {
        const errDetail =
          json.error ||
          json.data?.results?.find((r: any) => !r.verified)?.error ||
          "Một số bài chưa thể xác minh trên LMS.";
        setBanner({
          type: "error",
          text: `Lưu điểm LMS chưa hoàn tất: ${errDetail}`,
        });
      }
    } catch (err: any) {
      setBanner({
        type: "error",
        text: `Lỗi khi lưu điểm lên LMS: ${err.message}`,
      });
    } finally {
      setIsSavingLms(false);
    }
  };

  const renderStatusBadge = (sub: SubmissionRowItem) => {
    if (sub.parseStatus === "PARSE_ERROR") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
          <FileWarning className="w-3.5 h-3.5" /> PARSE_ERROR (Kiểm tra thủ công)
        </span>
      );
    }
    switch (sub.status) {
      case "VERIFIED":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
            <ShieldCheck className="w-3.5 h-3.5" /> VERIFIED (Đã khớp LMS)
          </span>
        );
      case "APPROVED":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40">
            <CheckCircle className="w-3.5 h-3.5" /> ĐÃ DUYỆT (Khóa Hash)
          </span>
        );
      case "WAITING_APPROVAL":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40">
            <Clock className="w-3.5 h-3.5" /> Chờ GV duyệt
          </span>
        );
      case "FAILED":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/40">
            <AlertCircle className="w-3.5 h-3.5" /> Lỗi xử lý
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs bg-slate-800 text-slate-400 border border-slate-700">
            Chưa chấm AI
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Control Panel: Session Selection + Rubric Selector + Action Buttons */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Session / Lesson Selector */}
            <div className="flex items-center gap-2 bg-slate-950 px-3.5 py-2 rounded-xl border border-slate-800">
              <span className="text-xs font-semibold text-slate-400">Buổi học / Cột bài tập:</span>
              <select
                value={selectedSessionNumber}
                onChange={(e) => setSelectedSessionNumber(Number(e.target.value))}
                className="bg-transparent text-sm font-bold text-emerald-400 focus:outline-none"
              >
                {columns.length > 0 ? (
                  columns.map((col) => (
                    <option
                      key={col.columnId}
                      value={col.sessionNumber}
                      className="bg-slate-900 text-white"
                    >
                      Buổi {col.sessionNumber}: {col.title}
                    </option>
                  ))
                ) : (
                  Array.from({ length: 14 }, (_, i) => i + 1).map((num) => (
                    <option key={num} value={num} className="bg-slate-900 text-white">
                      Buổi {num} ({normClass}_SESS_{String(num).padStart(2, "0")})
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Rubric Preset Selector */}
            <div className="flex items-center gap-2 bg-slate-950 px-3.5 py-2 rounded-xl border border-slate-800">
              <span className="text-xs font-semibold text-slate-400">Mẫu Barem:</span>
              <select
                value={selectedRubricId}
                onChange={(e) => handleSelectRubricPreset(e.target.value)}
                className="bg-transparent text-sm font-semibold text-sky-400 focus:outline-none max-w-[260px]"
              >
                {rubrics.map((r) => (
                  <option key={r.rubricId} value={r.rubricId} className="bg-slate-900 text-white">
                    [{r.courseCode} - B{r.sessionNumber}] {r.assignmentTitle}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowRubricEditor((prev) => !prev)}
                className="ml-2 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 font-medium transition flex items-center gap-1"
              >
                {showRubricEditor ? (
                  <>
                    <ChevronUp className="w-3.5 h-3.5" /> Thu gọn Barem
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3.5 h-3.5" /> Xem / Sửa Barem ({activeRubric.criteria.length} tiêu chí)
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Primary Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => handleDownloadAndAiGrade({ skipAi: true })}
              disabled={isDownloadingAndGrading || isSavingLms}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 text-xs font-semibold transition"
            >
              <Download className="w-4 h-4 text-sky-400" />
              Chỉ Tải & Đọc File
            </button>

            <button
              type="button"
              onClick={() => handleDownloadAndAiGrade()}
              disabled={isDownloadingAndGrading || isSavingLms}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold transition shadow-lg shadow-indigo-600/25"
            >
              <Sparkles className={`w-4 h-4 ${isDownloadingAndGrading ? "animate-spin" : ""}`} />
              {isDownloadingAndGrading
                ? "Đang Tải bài & Chấm AI..."
                : "Tải bài & AI Đề Xuất Điểm"}
            </button>

            <button
              type="button"
              onClick={handleApproveAll}
              disabled={isDownloadingAndGrading || isSavingLms || submissions.length === 0}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 disabled:opacity-40 text-blue-300 border border-blue-500/30 text-xs font-semibold transition"
            >
              <CheckCircle className="w-4 h-4" />
              Duyệt Tất Cả
            </button>

            <button
              type="button"
              onClick={() => handleSaveToLms()}
              disabled={isDownloadingAndGrading || isSavingLms || submissions.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold transition shadow-lg shadow-emerald-600/25"
            >
              <Send className={`w-4 h-4 ${isSavingLms ? "animate-pulse" : ""}`} />
              {isSavingLms ? "Đang lưu & đối chiếu LMS..." : "Duyệt & Lưu điểm lên LMS"}
            </button>
          </div>
        </div>

        {/* Expandable Rubric & Question Editor */}
        {showRubricEditor && (
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1">
                  Tiêu đề bài tập:
                </label>
                <input
                  type="text"
                  value={activeRubric.assignmentTitle}
                  onChange={(e) =>
                    setActiveRubric((prev) => ({ ...prev, assignmentTitle: e.target.value }))
                  }
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1">
                  Đề bài & Phạm vi kiến thức đã học:
                </label>
                <input
                  type="text"
                  value={activeRubric.assignmentPrompt}
                  onChange={(e) =>
                    setActiveRubric((prev) => ({ ...prev, assignmentPrompt: e.target.value }))
                  }
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 uppercase">
                  Chi tiết các tiêu chí Barem (Tổng:{" "}
                  {activeRubric.criteria.reduce((s, c) => s + Number(c.maxPoints || 0), 0)} điểm)
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setActiveRubric((prev) => {
                      const usedIds = new Set(prev.criteria.map((c) => c.criterionId));
                      let nextNum = prev.criteria.length + 1;
                      let nextId = `CRIT_${String(nextNum).padStart(2, "0")}`;
                      while (usedIds.has(nextId)) {
                        nextNum++;
                        nextId = `CRIT_${String(nextNum).padStart(2, "0")}`;
                      }
                      return {
                        ...prev,
                        criteria: [
                          ...prev.criteria,
                          {
                            criterionId: nextId,
                            name: `Tiêu chí ${nextNum}`,
                            maxPoints: 20,
                            description: "Mô tả yêu cầu kỹ thuật...",
                            expectedSnippetOrConcept: "Từ khóa / khối lệnh mong đợi",
                          },
                        ],
                      };
                    })
                  }
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-emerald-400 font-semibold"
                >
                  <Plus className="w-3.5 h-3.5" /> Thêm tiêu chí
                </button>
              </div>

              {activeRubric.criteria.map((crit, idx) => (
                <div
                  key={crit.criterionId}
                  className="grid grid-cols-12 gap-2 items-center bg-slate-900 p-2.5 rounded-lg border border-slate-800 text-xs"
                >
                  <div className="col-span-1 font-mono text-slate-400">{crit.criterionId}</div>
                  <div className="col-span-3">
                    <input
                      type="text"
                      value={crit.name}
                      onChange={(e) => {
                        const val = e.target.value;
                        setActiveRubric((prev) => ({
                          ...prev,
                          criteria: prev.criteria.map((c, i) =>
                            i === idx ? { ...c, name: val } : c
                          ),
                        }));
                      }}
                      className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-white"
                      placeholder="Tên tiêu chí"
                    />
                  </div>
                  <div className="col-span-2 flex items-center gap-1">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={crit.maxPoints}
                      onChange={(e) => {
                        const val = Number(e.target.value) || 0;
                        setActiveRubric((prev) => ({
                          ...prev,
                          criteria: prev.criteria.map((c, i) =>
                            i === idx ? { ...c, maxPoints: val } : c
                          ),
                        }));
                      }}
                      className="w-16 px-2 py-1 rounded bg-slate-950 border border-slate-700 text-emerald-400 font-bold text-center"
                    />
                    <span className="text-slate-400">điểm</span>
                  </div>
                  <div className="col-span-5">
                    <input
                      type="text"
                      value={crit.description}
                      onChange={(e) => {
                        const val = e.target.value;
                        setActiveRubric((prev) => ({
                          ...prev,
                          criteria: prev.criteria.map((c, i) =>
                            i === idx ? { ...c, description: val } : c
                          ),
                        }));
                      }}
                      className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-slate-200"
                      placeholder="Mô tả chi tiết tiêu chí"
                    />
                  </div>
                  <div className="col-span-1 text-right">
                    {activeRubric.criteria.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setActiveRubric((prev) => ({
                            ...prev,
                            criteria: prev.criteria.filter((_, i) => i !== idx),
                          }))
                        }
                        className="p-1 text-rose-400 hover:bg-rose-500/10 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Status Banner */}
        {banner && (
          <div
            className={`p-3 rounded-xl flex items-center justify-between text-xs font-medium ${
              banner.type === "success"
                ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
                : banner.type === "error"
                ? "bg-rose-500/10 border border-rose-500/30 text-rose-300"
                : "bg-indigo-500/10 border border-indigo-500/30 text-indigo-300"
            }`}
          >
            <div className="flex items-center gap-2">
              {banner.type === "success" ? (
                <CheckCircle className="w-4 h-4 shrink-0" />
              ) : banner.type === "error" ? (
                <AlertCircle className="w-4 h-4 shrink-0" />
              ) : (
                <Bot className="w-4 h-4 shrink-0 animate-bounce" />
              )}
              <span>{banner.text}</span>
            </div>
            <button onClick={() => setBanner(null)} className="opacity-70 hover:opacity-100">
              ✕
            </button>
          </div>
        )}
      </div>

      {/* 2. Submissions Grading List */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="px-6 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              Danh sách Bài nộp trong {selectedColumn?.title || `Buổi ${selectedSessionNumber}`} (
              {submissions.length} bài nộp)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Khóa cứng định danh <code className="text-emerald-400">submissionId → studentId → localFilePath → fileHash</code> • Tổng điểm tự cộng bằng TypeScript ScoreAuditor
            </p>
          </div>
          <button
            type="button"
            onClick={loadSessionSubmissions}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingSubs ? "animate-spin" : ""}`} />
            Làm mới
          </button>
        </div>

        {submissions.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-sm">
            Chưa có bài nộp nào được tải hoặc ghi nhận cho{" "}
            <strong>{selectedColumn?.title || `Buổi ${selectedSessionNumber}`}</strong>. Hãy bấm{" "}
            <strong>&quot;Tải bài &amp; AI Đề Xuất Điểm&quot;</strong> để tải bài từ LMS.
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {submissions.map((sub, idx) => {
              const effectiveScore =
                typeof sub.teacherOverrideScore === "number"
                  ? sub.teacherOverrideScore
                  : sub.calculatedScore;
              const isExpanded = expandedSubId === sub.submissionId;

              return (
                <div key={sub.submissionId} className="p-5 space-y-4 hover:bg-slate-900/60">
                  {/* Top Row: Student Info + File Lock + Score + Decision + Actions */}
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="px-2 py-0.5 rounded bg-slate-800 font-mono text-xs text-slate-400">
                          #{String(idx + 1).padStart(2, "0")}
                        </span>
                        <span className="text-base font-bold text-white">{sub.fullName}</span>
                        <span className="text-xs font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                          HV: {sub.studentId}
                        </span>
                        <span className="text-xs font-mono text-indigo-300 bg-indigo-950/40 px-2 py-0.5 rounded border border-indigo-500/30">
                          subId: {sub.submissionId}
                        </span>
                        {renderStatusBadge(sub)}
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                        <span>
                          File nộp:{" "}
                          <strong className="text-slate-200 font-mono">
                            {sub.originalFileName || "(Chưa tải về máy)"}
                          </strong>
                        </span>
                        {sub.fileHash && (
                          <span className="font-mono text-[11px] text-emerald-400">
                            SHA-256: {sub.fileHash.slice(0, 16)}...
                          </span>
                        )}
                        {sub.codePreview && (
                          <button
                            type="button"
                            onClick={() => setInspectCodeSub(sub)}
                            className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 font-semibold underline"
                          >
                            <Code2 className="w-3.5 h-3.5" /> Xem Code / Cấu trúc dự án ({sub.subjectType})
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Right Controls: Decision + Total Score + Approve / Save */}
                    <div className="flex flex-wrap items-center gap-3">
                      {/* Decision Radio Toggle */}
                      <div className="flex items-center rounded-xl bg-slate-950 p-1 border border-slate-800 text-xs">
                        <button
                          type="button"
                          disabled={sub.parseStatus === "PARSE_ERROR"}
                          onClick={() => handleFieldUpdate(sub, { decision: "GRADE" })}
                          className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                            sub.decision === "GRADE"
                              ? "bg-emerald-600 text-white"
                              : "text-slate-400 hover:text-white"
                          }`}
                        >
                          Chấm điểm
                        </button>
                        <button
                          type="button"
                          disabled={sub.parseStatus === "PARSE_ERROR"}
                          onClick={() => handleFieldUpdate(sub, { decision: "REDO" })}
                          className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                            sub.decision === "REDO"
                              ? "bg-purple-600 text-white"
                              : "text-slate-400 hover:text-white"
                          }`}
                        >
                          Yêu cầu làm lại
                        </button>
                      </div>

                      {/* Calculated Score + Optional Override */}
                      <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800">
                        <div>
                          <div className="text-[10px] text-slate-400 uppercase">Tổng điểm TS</div>
                          <div className="text-sm font-bold text-emerald-400">
                            {sub.calculatedScore}/100
                          </div>
                        </div>
                        <div className="border-l border-slate-800 pl-2">
                          <div className="text-[10px] text-slate-400 uppercase">GV Gán điểm</div>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            disabled={sub.parseStatus === "PARSE_ERROR"}
                            value={
                              sub.teacherOverrideScore !== null &&
                              sub.teacherOverrideScore !== undefined
                                ? sub.teacherOverrideScore
                                : ""
                            }
                            placeholder={String(sub.calculatedScore)}
                            onChange={(e) => {
                              const raw = e.target.value;
                              handleFieldUpdate(sub, {
                                teacherOverrideScore: raw === "" ? null : Number(raw),
                              });
                            }}
                            className="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-xs font-bold text-white text-center"
                          />
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          setExpandedSubId(isExpanded ? null : sub.submissionId)
                        }
                        className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition"
                      >
                        {isExpanded ? "Ẩn Barem" : `Chi tiết (${sub.criteriaGrades.length} tiêu chí)`}
                      </button>

                      <button
                        type="button"
                        disabled={sub.parseStatus === "PARSE_ERROR"}
                        onClick={() => handleApproveSubmission(sub)}
                        className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-xs font-bold text-white transition"
                      >
                        Duyệt ({effectiveScore}đ)
                      </button>

                      <button
                        type="button"
                        disabled={sub.parseStatus === "PARSE_ERROR" || isSavingLms}
                        onClick={() => handleSaveToLms(sub)}
                        className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-bold text-white transition"
                      >
                        Lưu LMS
                      </button>
                    </div>
                  </div>

                  {/* PARSE_ERROR Guardrail Warning */}
                  {sub.parseStatus === "PARSE_ERROR" && (
                    <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/40 text-xs text-rose-200 flex items-start gap-2.5">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold text-rose-300">
                          Cảnh báo An toàn (PARSE_ERROR): Không thể đọc tự động file bài nộp này!
                        </div>
                        <div className="mt-0.5">
                          Lý do: {sub.parseErrorReason || "File hỏng hoặc định dạng không hỗ trợ."}
                        </div>
                        <div className="mt-1 text-rose-300/80 italic">
                          Hệ thống đã khóa tự động chấm 0 điểm và khóa tự động tích &quot;Yêu cầu làm lại&quot; theo quy tắc an toàn sư phạm. Giáo viên vui lòng kiểm tra trực tiếp trên LMS.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Criterion Breakdown Table */}
                  {(isExpanded || sub.criteriaGrades.length > 0) &&
                    sub.parseStatus !== "PARSE_ERROR" && (
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pt-2">
                        {/* Left 7 cols: Criteria Table */}
                        <div className="lg:col-span-7 bg-slate-950 rounded-xl border border-slate-800 overflow-hidden">
                          <table className="w-full text-left text-xs text-slate-300">
                            <thead className="bg-slate-900/90 text-[11px] uppercase text-slate-400 border-b border-slate-800">
                              <tr>
                                <th className="px-3 py-2">Tiêu chí Barem</th>
                                <th className="px-2 py-2 w-24 text-center">Điểm thành phần</th>
                                <th className="px-3 py-2">Bằng chứng Code & Lý do</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/70">
                              {sub.criteriaGrades.length > 0 ? (
                                sub.criteriaGrades.map((cg) => (
                                  <tr key={cg.criterionId}>
                                    <td className="px-3 py-2.5 align-top">
                                      <div className="font-semibold text-white">
                                        {cg.criterionName}
                                      </div>
                                      <div className="text-[10px] font-mono text-slate-500">
                                        {cg.criterionId}
                                      </div>
                                    </td>
                                    <td className="px-2 py-2.5 align-top text-center">
                                      <div className="inline-flex items-center gap-1">
                                        <input
                                          type="number"
                                          min={0}
                                          max={cg.maxPoints}
                                          value={cg.earnedPoints}
                                          onChange={(e) =>
                                            handleCriterionPointsChange(
                                              sub,
                                              cg.criterionId,
                                              e.target.value
                                            )
                                          }
                                          className="w-12 px-1.5 py-1 rounded bg-slate-900 border border-slate-700 text-center font-bold text-emerald-400"
                                        />
                                        <span className="text-slate-500 font-semibold">
                                          /{cg.maxPoints}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="px-3 py-2.5 align-top space-y-1">
                                      <div className="font-mono text-[11px] text-sky-300 bg-slate-900 px-2 py-1 rounded border border-slate-800 break-all">
                                        📌 Bằng chứng: {cg.evidenceSnippet}
                                      </div>
                                      <div className="text-slate-300">
                                        💡 {cg.deductionReason}
                                      </div>
                                    </td>
                                  </tr>
                                ))
                              ) : (
                                <tr>
                                  <td
                                    colSpan={3}
                                    className="px-3 py-4 text-center text-slate-500"
                                  >
                                    Chưa có điểm thành phần AI. Hãy bấm &quot;Tải bài &amp; AI Đề Xuất Điểm&quot;.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>

                        {/* Right 5 cols: Editable Rich Text Feedback */}
                        <div className="lg:col-span-5 flex flex-col bg-slate-950 rounded-xl border border-slate-800 p-3.5 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-300 uppercase">
                              Nhận xét bài tập (Điền vào Modal LMS):
                            </span>
                            {sub.contentHash && (
                              <span className="text-[10px] font-mono text-blue-400">
                                Hash: {sub.contentHash.slice(0, 10)}...
                              </span>
                            )}
                          </div>
                          <textarea
                            rows={5}
                            value={sub.feedbackHtml}
                            onChange={(e) =>
                              handleFieldUpdate(sub, { feedbackHtml: e.target.value })
                            }
                            placeholder="Nhận xét chi tiết ưu điểm, lỗi cần sửa và gợi ý cho học viên..."
                            className="w-full flex-1 p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 resize-y"
                          />
                        </div>
                      </div>
                    )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Code / Project Structure Modal */}
      {inspectCodeSub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-4xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="px-6 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">
                  Mã nguồn / Cấu trúc bài nộp: {inspectCodeSub.fullName} (
                  {inspectCodeSub.originalFileName})
                </h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  submissionId: {inspectCodeSub.submissionId} • Môn: {inspectCodeSub.subjectType} •
                  SHA-256: {inspectCodeSub.fileHash}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectCodeSub(null)}
                className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-white"
              >
                Đóng ✕
              </button>
            </div>
            <div className="p-5 overflow-y-auto font-mono text-xs text-slate-200 whitespace-pre-wrap bg-slate-950 leading-relaxed">
              {inspectCodeSub.codePreview || "(Không có nội dung văn bản trích xuất)"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
