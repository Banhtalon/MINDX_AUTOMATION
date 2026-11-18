"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Send,
  TrendingUp,
} from "lucide-react";
import { getSpckVerifiedTeachingProgressSuggestion } from "@/lib/teaching/session-progress-mapper";
import { getSessionSlotDisplay, SpckWorkflowController } from "./useSpckWorkflow";

export interface SubmitBarProps {
  workflow: SpckWorkflowController;
}

export function SubmitBar({ workflow }: SubmitBarProps) {
  const {
    rows,
    students,
    session14Evals,
    lastSubmissionSummary,
    handleApproveAndUpload,
    handleSubmitSession14Combo,
    handleMainStep3SubmitAll,
    mainStep3Running,
    teachingProgressPushState,
    skippedUnreadyByStudent,
    isSpckExemptClass,
    session14ComboStatus,
    uploadingS14EvalLms,
    isAnyOperationBusy,
    uploading,
    effectiveSelectedStudentIds,
    selectedSessionNumber,
    selectedClassId,
    setLastSubmissionSummary,
  } = workflow;

  const pushReqSeqRef = useRef(0);
  const [teachingPushState, setTeachingPushState] = useState<{
    loading: boolean;
    verifiedPercent: number | null;
    updatedCount: number | null;
    error: string | null;
  }>({
    loading: false,
    verifiedPercent: null,
    updatedCount: null,
    error: null,
  });

  useEffect(() => {
    pushReqSeqRef.current += 1;
    setTeachingPushState({
      loading: false,
      verifiedPercent: null,
      updatedCount: null,
      error: null,
    });
  }, [
    selectedClassId,
    selectedSessionNumber,
    lastSubmissionSummary?.completedAt,
    session14ComboStatus.spckSummary?.completedAt,
    uploading,
    session14ComboStatus.running,
  ]);

  const allRows = rows || [];
  const assignedRows = allRows.filter((r) => Boolean(r.assignedStudentId));

  const isRowVerifiedAndCleanForCurrentSession = (
    r: (typeof allRows)[number]
  ): boolean =>
    Boolean(
      r.assignedStudentId &&
        !r.isDirty &&
        getSessionSlotDisplay(r, selectedSessionNumber).state === "VERIFIED_CURRENT"
    );

  const activeSessionKey = String(selectedSessionNumber) as "12" | "13" | "14";
  const isSessionAbsentExemptEligible =
    selectedSessionNumber === 12 || selectedSessionNumber === 13;

  const isRowAbsentExemptForCurrentSession = (
    r: (typeof allRows)[number]
  ): boolean => {
    if (!isSessionAbsentExemptEligible || !r.assignedStudentId) return false;
    if (r.sessionHistory?.sessions?.[activeSessionKey]?.attendanceStatus === "ABSENT") {
      return true;
    }
    return getSessionSlotDisplay(r, selectedSessionNumber).state === "ABSENT_EXEMPT";
  };

  const absentExemptRowsForCurrentSession = assignedRows.filter(
    isRowAbsentExemptForCurrentSession
  );
  const assignedRowStudentIdSet = new Set(
    assignedRows.map((r) => r.assignedStudentId)
  );
  const absentExemptStudentIdSet = new Set(
    absentExemptRowsForCurrentSession.map((r) => r.assignedStudentId)
  );
  if (isSessionAbsentExemptEligible) {
    for (const s of students || []) {
      if (!s?.studentId || s.isActive === 0) continue;
      const stuAny = s as any;
      if (
        stuAny.sessionAttendance?.[activeSessionKey] === "ABSENT" ||
        stuAny.attendanceStatus === "ABSENT"
      ) {
        absentExemptStudentIdSet.add(s.studentId);
        continue;
      }
      if (!assignedRowStudentIdSet.has(s.studentId)) {
        const attCache: Map<string, any> | undefined = (globalThis as any)
          ?.__mindxSpckAttendanceCache;
        if (attCache instanceof Map) {
          const classKey = `${String(selectedClassId || "").trim().toUpperCase()}::${s.studentId}`;
          const cached = attCache.get(classKey) || attCache.get(`*::${s.studentId}`);
          if (cached?.[activeSessionKey] === "ABSENT") {
            absentExemptStudentIdSet.add(s.studentId);
          }
        }
      }
    }
  }

  const verifiedRowsCountForCurrentSession = assignedRows.filter(
    (r) =>
      !isRowAbsentExemptForCurrentSession(r) &&
      !absentExemptStudentIdSet.has(r.assignedStudentId) &&
      isRowVerifiedAndCleanForCurrentSession(r)
  ).length;

  const unverifiedOrUnassignedRowsCountForCurrentSession = allRows.filter(
    (r) =>
      !isRowVerifiedAndCleanForCurrentSession(r) &&
      !isRowAbsentExemptForCurrentSession(r)
  ).length;

  const isComboForCurrentClass =
    selectedSessionNumber === 14 &&
    session14ComboStatus.currentPhase !== "idle" &&
    (!session14ComboStatus.classId ||
      session14ComboStatus.classId === selectedClassId);

  const isLastSummaryForCurrentClassAndSession = Boolean(
    lastSubmissionSummary &&
      lastSubmissionSummary.sessionNumber === selectedSessionNumber &&
      (!lastSubmissionSummary.classId ||
        lastSubmissionSummary.classId === selectedClassId)
  );

  const activeSummary =
    selectedSessionNumber === 14 &&
    isComboForCurrentClass &&
    session14ComboStatus.spckSummary
      ? session14ComboStatus.spckSummary
      : isLastSummaryForCurrentClassAndSession
      ? lastSubmissionSummary
      : null;

  const summaryRetryCount = activeSummary
    ? activeSummary.retryStudentIds.length
    : 0;

  const verifiedSpckCountForCurrentSession = verifiedRowsCountForCurrentSession;

  const activeRosterStudents = (students || []).filter(
    (s) => s.isActive !== 0
  );
  const presentActiveRosterStudents = activeRosterStudents.filter(
    (s) => !absentExemptStudentIdSet.has(s.studentId)
  );
  const verifiedStudentIdSet = new Set(
    assignedRows
      .filter(isRowVerifiedAndCleanForCurrentSession)
      .map((r) => r.assignedStudentId)
  );
  const missingRosterSpckCount = presentActiveRosterStudents.filter(
    (s) => !verifiedStudentIdSet.has(s.studentId)
  ).length;

  const pendingOrFailedSpckCountForCurrentSession =
    unverifiedOrUnassignedRowsCountForCurrentSession +
    summaryRetryCount +
    missingRosterSpckCount;

  const evalsForCurrentClass = (session14Evals || []).filter(
    (ev) => !ev.classId || ev.classId === selectedClassId
  );

  const evalByStudentId = new Map(
    evalsForCurrentClass
      .filter((ev) => Boolean(ev?.studentId))
      .map((ev) => [ev.studentId, ev] as const)
  );

  const assignedStudentIds = assignedRows.map((r) => r.assignedStudentId);
  const targetCheckStudentIds =
    presentActiveRosterStudents.length > 0
      ? presentActiveRosterStudents.map((s) => s.studentId)
      : assignedStudentIds.filter((sid) => !absentExemptStudentIdSet.has(sid));

  const allAssignedStudentsHaveVerifiedEval =
    targetCheckStudentIds.length > 0 &&
    evalsForCurrentClass.length >= targetCheckStudentIds.length &&
    targetCheckStudentIds.every(
      (sid) => evalByStudentId.get(sid)?.status === "VERIFIED"
    ) &&
    evalsForCurrentClass
      .filter((ev) => !absentExemptStudentIdSet.has(ev.studentId))
      .every((ev) => ev.status === "VERIFIED");

  const comboHasPendingEvalFailures =
    isComboForCurrentClass &&
    (session14ComboStatus.evalRetryStudentIds.length > 0 ||
      (session14ComboStatus.evalFailedCount || 0) > 0);

  const expectedPresentRosterCount =
    activeRosterStudents.length > 0
      ? presentActiveRosterStudents.length
      : Math.max(
          0,
          assignedRows.length - absentExemptRowsForCurrentSession.length
        );

  const rawTeachingSuggestion = getSpckVerifiedTeachingProgressSuggestion({
    sessionNumber: selectedSessionNumber,
    verifiedCount:
      expectedPresentRosterCount === 0 ? 0 : verifiedSpckCountForCurrentSession,
    pendingOrFailedCount: pendingOrFailedSpckCountForCurrentSession,
    totalRosterCount: expectedPresentRosterCount,
  });

  const session14EvalReadyForHandoff =
    !session14ComboStatus.running &&
    !uploading &&
    !uploadingS14EvalLms &&
    allAssignedStudentsHaveVerifiedEval &&
    !comboHasPendingEvalFailures;

  const teachingSuggestion =
    selectedSessionNumber === 14 && !session14EvalReadyForHandoff
      ? {
          ...rawTeachingSuggestion,
          shouldShow: false,
          description: "",
        }
      : rawTeachingSuggestion;

  const showSession14ReportCardHandoff =
    selectedSessionNumber === 14 &&
    session14EvalReadyForHandoff &&
    rawTeachingSuggestion.shouldShow;

  const handleQuickUpdateTeachingProgress = async () => {
    if (
      !selectedClassId ||
      !teachingSuggestion.shouldShow ||
      (selectedSessionNumber === 14 && !session14EvalReadyForHandoff) ||
      teachingPushState.loading
    ) {
      return;
    }
    const reqSeq = ++pushReqSeqRef.current;
    const reqClassId = selectedClassId;
    const reqTargetPercent = teachingSuggestion.targetPercent;
    const reqMilestoneCount = teachingSuggestion.milestoneTaskCount;

    setTeachingPushState({
      loading: true,
      verifiedPercent: null,
      updatedCount: null,
      error: null,
    });
    try {
      const res = await fetch("/api/teaching-projects/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classCode: reqClassId,
          milestoneTaskCount: reqMilestoneCount,
          resetOthers: false,
          allowDecrease: false,
          verifiedSpckCount: verifiedSpckCountForCurrentSession,
          expectedRosterCount:
            expectedPresentRosterCount || verifiedSpckCountForCurrentSession,
        }),
      });
      const data = await res.json();
      if (pushReqSeqRef.current !== reqSeq) {
        return;
      }
      if (!res.ok || !data.success) {
        throw new Error(
          data.error || "Không thể cập nhật tiến độ Teaching tự động."
        );
      }
      setTeachingPushState({
        loading: false,
        verifiedPercent: reqTargetPercent,
        updatedCount: data.updatedCount ?? null,
        error: null,
      });
    } catch (err) {
      if (pushReqSeqRef.current !== reqSeq) {
        return;
      }
      setTeachingPushState({
        loading: false,
        verifiedPercent: null,
        updatedCount: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  useEffect(() => {
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const bar = document.querySelector(".spck-clean-sticky-submit");
      if (!bar || bar.contains(target)) return;
      const elRect = target.getBoundingClientRect();
      const barRect = bar.getBoundingClientRect();
      if (
        elRect.width > 0 &&
        elRect.height > 0 &&
        elRect.bottom > barRect.top - 8 &&
        elRect.top < barRect.bottom + 8
      ) {
        const delta = elRect.bottom - (barRect.top - 24);
        if (delta > 0) {
          window.scrollBy(0, delta);
        }
      }
    };
    document.addEventListener("focusin", handleFocusIn, true);
    return () => {
      document.removeEventListener("focusin", handleFocusIn, true);
    };
  }, []);

  return (
    <div className="spck-clean-sticky-submit sticky bottom-3 z-20 px-4 py-2.5 rounded-xl space-y-2">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="spck-pill-primary px-2.5 py-0.5 rounded-full text-xs font-bold">
            Bước 3 / 3
          </span>
          <h2 className="text-sm font-extrabold text-white">
            Duyệt &amp; Nộp Trọn Gói (MindX LMS + Teaching)
          </h2>
          {assignedRows.length > 0 && (
            <span className="spck-pill-success px-2 py-0.5 rounded-full text-[11px] font-semibold">
              Đã xác minh LMS B.{selectedSessionNumber}:{" "}
              {verifiedSpckCountForCurrentSession}/
              {Math.max(
                0,
                assignedRows.length - absentExemptRowsForCurrentSession.length
              )}{" "}
              HV
              {absentExemptRowsForCurrentSession.length > 0
                ? ` (Miễn nộp ${absentExemptRowsForCurrentSession.length} vắng)`
                : ""}
            </span>
          )}
          {Object.keys(skippedUnreadyByStudent).length > 0 && (
            <span className="spck-pill-error px-2 py-0.5 rounded-full text-[11px] font-bold">
              🚨 {Object.keys(skippedUnreadyByStudent).length} HV chờ nộp bù sau
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {isComboForCurrentClass &&
            session14ComboStatus.spckSummary &&
            session14ComboStatus.spckSummary.retryStudentIds.length > 0 && (
              <button
                type="button"
                data-testid="s14-combo-retry-failed-btn"
                onClick={() =>
                  handleSubmitSession14Combo(
                    session14ComboStatus.spckSummary!.retryStudentIds,
                    "spck_only"
                  )
                }
                disabled={isAnyOperationBusy}
                className="spck-pill-warning flex items-center space-x-1.5 px-3.5 py-2 rounded-xl disabled:opacity-50 text-xs font-bold transition-colors cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${uploading ? "animate-spin" : ""}`}
                />
                <span>
                  🔄 Thử lại riêng phần Sản phẩm (
                  {session14ComboStatus.spckSummary.retryStudentIds.length})
                </span>
              </button>
            )}

          {isComboForCurrentClass &&
            session14ComboStatus.evalRetryStudentIds.length > 0 && (
              <button
                type="button"
                data-testid="s14-combo-retry-failed-btn"
                onClick={() =>
                  handleSubmitSession14Combo(
                    session14ComboStatus.evalRetryStudentIds,
                    "eval_only"
                  )
                }
                disabled={isAnyOperationBusy}
                className="spck-pill-warning flex items-center space-x-1.5 px-3.5 py-2 rounded-xl disabled:opacity-50 text-xs font-bold transition-colors cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${
                    uploadingS14EvalLms ? "animate-spin" : ""
                  }`}
                />
                <span>
                  🔄 Thử lại riêng phần Đánh giá (
                  {session14ComboStatus.evalRetryStudentIds.length})
                </span>
              </button>
            )}

          {selectedSessionNumber !== 14 &&
            lastSubmissionSummary &&
            (!lastSubmissionSummary.classId ||
              lastSubmissionSummary.classId === selectedClassId) &&
            lastSubmissionSummary.retryStudentIds.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  handleApproveAndUpload(
                    lastSubmissionSummary.retryStudentIds,
                    true,
                    lastSubmissionSummary.sessionNumber
                  )
                }
                disabled={isAnyOperationBusy}
                className="spck-pill-warning flex items-center space-x-1.5 px-4 py-2 rounded-xl disabled:opacity-50 text-xs font-bold transition-colors cursor-pointer"
              >
                <RefreshCw
                  className={`w-4 h-4 ${uploading ? "animate-spin" : ""}`}
                />
                <span>
                  Thử lại {lastSubmissionSummary.retryStudentIds.length} bài chưa nộp — Buổi{" "}
                  {lastSubmissionSummary.sessionNumber}
                </span>
              </button>
            )}

          <button
            type="button"
            data-testid="spck-submitbar-step3-submit"
            onClick={() => void handleMainStep3SubmitAll()}
            disabled={
              isAnyOperationBusy ||
              !selectedClassId ||
              (rows.length === 0 &&
                (selectedSessionNumber !== 14 || session14Evals.length === 0))
            }
            className="spck-btn-primary flex items-center space-x-2 px-5 py-2.5 rounded-xl disabled:opacity-50 text-sm font-extrabold transition-colors cursor-pointer shadow"
          >
            {mainStep3Running ||
            uploading ||
            uploadingS14EvalLms ||
            session14ComboStatus.running ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            <span>
              3. Duyệt &amp; Nộp tất cả
              {selectedSessionNumber === 12
                ? ` (${effectiveSelectedStudentIds.length} HV → LMS + Teaching 60%)`
                : selectedSessionNumber === 13
                ? ` (${effectiveSelectedStudentIds.length} HV → LMS + Teaching 80%)`
                : " (Buổi 14 → LMS + Teaching 100% + Phiếu điểm)"}
            </span>
          </button>
        </div>
      </div>

      {/* Kết quả cập nhật Tiến độ Teaching tự động cho Buổi 12 & 13 */}
      {selectedSessionNumber !== 14 &&
        teachingProgressPushState.status !== "IDLE" && (
          <div
            className={`px-3 py-2 rounded-lg border text-xs flex items-center justify-between gap-2 ${
              teachingProgressPushState.status === "SUCCESS"
                ? "bg-emerald-950/40 border-emerald-700/60 text-emerald-200"
                : teachingProgressPushState.status === "RUNNING"
                ? "bg-amber-950/40 border-amber-600/50 text-amber-200"
                : "bg-amber-950/50 border-amber-500/60 text-amber-200"
            }`}
          >
            <span>
              {teachingProgressPushState.status === "SUCCESS"
                ? `✅ Teaching: ${teachingProgressPushState.message}`
                : teachingProgressPushState.status === "RUNNING"
                ? `⏳ ${teachingProgressPushState.message}`
                : `⚠️ ${teachingProgressPushState.message}`}
            </span>
          </div>
        )}

      {/* Bảng 4 bước tiến trình liên hoàn Buổi 14 (SPCK -> Đánh giá + Summary -> Teaching 100% -> Phiếu điểm) */}
      {isComboForCurrentClass && (
        <div className="spck-clean-subbar p-3 rounded-xl grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2.5 text-xs">
          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
            <div className="font-bold text-emerald-300">
              [1/4] Sản phẩm SPCK (Cột 3 LMS)
            </div>
            <div className="text-slate-300 mt-0.5">
              {isSpckExemptClass
                ? "Miễn SPCK (PTB / CSB)"
                : session14ComboStatus.currentPhase === "spck"
                ? "⏳ Đang duyệt & nộp Sản phẩm SPCK..."
                : session14ComboStatus.spckSummary
                ? `✓ Đã xác minh ${session14ComboStatus.spckSummary.verifiedItems.length}/${session14ComboStatus.spckSummary.totalSelected} HV${
                    session14ComboStatus.spckSummary.retryStudentIds.length > 0
                      ? ` (${session14ComboStatus.spckSummary.retryStudentIds.length} lỗi)`
                      : ""
                  }`
                : "Đã bỏ qua / Đã nộp trước đó"}
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
            <div className="font-bold text-blue-300">
              [2/4] Đánh giá + Summary (Cột 2 LMS)
            </div>
            <div className="text-slate-300 mt-0.5">
              {session14ComboStatus.currentPhase === "eval"
                ? "⏳ Đang đẩy Điểm Demo, ĐNL, Summary & Thư 3 phần..."
                : session14ComboStatus.currentPhase === "spck"
                ? "Chờ sau bước 1..."
                : `✓ Đã xác minh ${session14ComboStatus.evalVerifiedCount} HV${
                    session14ComboStatus.classSummaryVerified
                      ? " + Summary ✓"
                      : ""
                  }${
                    session14ComboStatus.evalRetryStudentIds.length > 0
                      ? ` (${session14ComboStatus.evalRetryStudentIds.length} lỗi)`
                      : ""
                  }`}
              {session14ComboStatus.evalErrorMessage && (
                <span className="block text-rose-300 mt-0.5">
                  {session14ComboStatus.evalErrorMessage}
                </span>
              )}
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
            <div className="font-bold text-indigo-300">
              [3/4] Tiến độ dự án Teaching (100%)
            </div>
            <div className="text-slate-300 mt-0.5">
              {session14ComboStatus.currentPhase === "teaching_progress"
                ? "⏳ Đang đẩy tiến độ dự án 100%..."
                : session14ComboStatus.teachingProgressResult
                ? session14ComboStatus.teachingProgressResult.status ===
                  "SUCCESS"
                  ? "✓ Đã cập nhật 100% trên Teaching"
                  : `⚠️ ${session14ComboStatus.teachingProgressResult.message}`
                : session14ComboStatus.running
                ? "Chờ sau bước LMS..."
                : "Chưa chạy"}
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
            <div className="font-bold text-amber-300">
              [4/4] Phiếu điểm cuối khóa Teaching
            </div>
            <div className="text-slate-300 mt-0.5">
              {session14ComboStatus.currentPhase === "report_card"
                ? "⏳ Đang quét điểm LMS & đồng bộ sang Teaching..."
                : session14ComboStatus.reportCardResult
                ? session14ComboStatus.reportCardResult.status === "SUCCESS"
                  ? `✓ Đã đồng bộ ${
                      session14ComboStatus.reportCardResult
                        .matchedStudentCount ?? ""
                    } HV sang Teaching`
                  : `⚠️ ${
                      session14ComboStatus.reportCardResult.warningMessage ||
                      "Cần kiểm tra trên Teaching"
                    }`
                : session14ComboStatus.running
                ? "Chờ sau bước 3..."
                : "Chưa chạy"}
            </div>
          </div>
        </div>
      )}

      {/* Detailed Batch Submission Result Card */}
      {lastSubmissionSummary &&
        (!lastSubmissionSummary.classId ||
          lastSubmissionSummary.classId === selectedClassId) && (
        <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
            <div className="font-bold text-white flex flex-wrap items-center gap-2">
              <span>
                📊 Kết quả đợt nộp Buổi {lastSubmissionSummary.sessionNumber} (Lúc{" "}
                {lastSubmissionSummary.completedAt}):
              </span>
              <span
                className={`px-2 py-0.5 rounded ${
                  lastSubmissionSummary.verifiedItems.length ===
                    lastSubmissionSummary.totalSelected &&
                  lastSubmissionSummary.failedItems.length === 0 &&
                  lastSubmissionSummary.skippedItems.length === 0
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-600"
                    : "bg-amber-500/20 text-amber-300 border border-amber-600"
                }`}
              >
                Đã nộp {lastSubmissionSummary.verifiedItems.length}/
                {lastSubmissionSummary.totalSelected} —{" "}
                {Math.max(
                  0,
                  lastSubmissionSummary.totalSelected -
                    lastSubmissionSummary.verifiedItems.length
                )}{" "}
                bài chưa nộp
              </span>
            </div>
            <button
              type="button"
              onClick={() => setLastSubmissionSummary(null)}
              className="text-slate-400 hover:text-slate-200 underline cursor-pointer"
            >
              Ẩn bảng kết quả
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Verified List */}
            <div className="p-3 rounded-lg bg-emerald-950/25 border border-emerald-800/60 space-y-1.5">
              <div className="font-bold text-emerald-300">
                ✅ Thành công ({lastSubmissionSummary.verifiedItems.length}/
                {lastSubmissionSummary.totalSelected})
              </div>
              {lastSubmissionSummary.verifiedItems.length === 0 ? (
                <div className="text-slate-500">Chưa có bài nào hoàn tất trong đợt này.</div>
              ) : (
                <ul className="space-y-1 text-emerald-200">
                  {lastSubmissionSummary.verifiedItems.map((item) => (
                    <li key={item.studentId}>
                      • {item.studentName} ({item.studentId})
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Skipped List */}
            <div className="p-3 rounded-lg bg-amber-950/25 border border-amber-800/60 space-y-1.5">
              <div className="font-bold text-amber-300">
                ⚠️ Bị bỏ qua ({lastSubmissionSummary.skippedItems.length})
              </div>
              {lastSubmissionSummary.skippedItems.length === 0 ? (
                <div className="text-slate-500">Không có bài nào bị bỏ qua.</div>
              ) : (
                <ul className="space-y-1 text-amber-200">
                  {lastSubmissionSummary.skippedItems.map((item) => (
                    <li key={item.studentId}>
                      • <strong>{item.studentName}:</strong> {item.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Failed List */}
            <div className="p-3 rounded-lg bg-rose-950/25 border border-rose-800/60 space-y-1.5">
              <div className="font-bold text-rose-300">
                ❌ Lỗi khi nộp ({lastSubmissionSummary.failedItems.length})
              </div>
              {lastSubmissionSummary.failedItems.length === 0 ? (
                <div className="text-slate-500">Không có bài nào gặp lỗi.</div>
              ) : (
                <ul className="space-y-1 text-rose-200">
                  {lastSubmissionSummary.failedItems.map((item) => (
                    <li key={item.studentId}>
                      • <strong>{item.studentName}:</strong> {item.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* S6.2 & S6.3: Compact Next-Action Strip after VERIFIED SPCK / Session 14 Submission */}
      {!uploading &&
        !session14ComboStatus.running &&
        (teachingSuggestion.shouldShow || showSession14ReportCardHandoff) && (
          <div
            data-testid="s6-post-spck-suggestion-banner"
            className="spck-handoff-strip px-3 py-2 rounded-lg space-y-2 text-xs"
          >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                <TrendingUp className="w-3.5 h-3.5 shrink-0" />
                <span className="font-bold">
                  Đã xác minh LMS đủ bài — Tiện ích đồng bộ lẻ:
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {teachingSuggestion.shouldShow && (
                  <button
                    type="button"
                    data-testid="s6-push-teaching-progress-btn"
                    onClick={handleQuickUpdateTeachingProgress}
                    disabled={teachingPushState.loading || isAnyOperationBusy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                  >
                    {teachingPushState.loading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <TrendingUp className="w-3.5 h-3.5" />
                    )}
                    <span>{teachingSuggestion.buttonText}</span>
                  </button>
                )}

                {showSession14ReportCardHandoff && (
                  <a
                    data-testid="s6-open-report-card-link"
                    href={`/homework-grader?classId=${encodeURIComponent(
                      selectedClassId
                    )}&autoScan=1`}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold shadow-xs transition-colors"
                  >
                    <span>📋 Mở Phiếu điểm → Quét</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>

            {teachingPushState.verifiedPercent !== null && (
              <div className="spck-pill-success px-2.5 py-1.5 rounded-md font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  ✅ Đã cập nhật tiến độ Teaching lên {teachingPushState.verifiedPercent}% thành công (Đã đối chiếu Read-after-Write
                  {teachingPushState.updatedCount
                    ? ` • ${teachingPushState.updatedCount} ô`
                    : ""}
                  ).
                </span>
              </div>
            )}

            {teachingPushState.error && (
              <div className="spck-pill-error px-2.5 py-1.5 rounded-md flex flex-wrap items-center justify-between gap-2">
                <span>⚠️ {teachingPushState.error}</span>
                <a
                  href={`/teaching-projects?classId=${encodeURIComponent(selectedClassId)}`}
                  className="underline font-bold hover:opacity-80"
                >
                  Mở Màn 5 (Dự án Teaching) &rarr;
                </a>
              </div>
            )}
          </div>
        )}
    </div>
  );
}
