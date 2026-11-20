"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  refreshClassesFromLms,
  readSavedClassCode,
  writeSavedClassCode,
  type ClassPickerOption,
} from "@/components/class-picker";
import {
  ClassroomProjectorBoard,
  ClassroomSummaryModal,
  ClassroomTeacherTable,
  ClassroomToolbar,
  CourseAccumulationModal,
  RandomStudentModal,
  type ClassroomSessionOption,
} from "@/components/classroom-manager";
import {
  applyAttendanceToggle,
  applyIssueAction,
  applyManualStarDelta,
  applyPraiseAction,
  computeClassroomSessionSummary,
  type ClassroomCourseAccumulationRow,
  type ClassroomIssueKey,
  type ClassroomPraiseKey,
  type ClassroomStudentState,
} from "@/lib/classroom/classroom-manager-helpers";

export default function ClassroomManagerPage() {
  const router = useRouter();

  const [classes, setClasses] = useState<ClassPickerOption[]>([]);
  const [classId, setClassId] = useState("");
  const [sessionNumber, setSessionNumber] = useState(1);
  const [sessions, setSessions] = useState<ClassroomSessionOption[]>([]);
  const [students, setStudents] = useState<ClassroomStudentState[]>([]);
  const [courseAccumulation, setCourseAccumulation] = useState<ClassroomCourseAccumulationRow[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshingClasses, setIsRefreshingClasses] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [saveIndicator, setSaveIndicator] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const [isProjectorMode, setIsProjectorMode] = useState(false);
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [isAccumulationOpen, setIsAccumulationOpen] = useState(false);
  const [isRandomOpen, setIsRandomOpen] = useState(false);
  const [pickedStudentId, setPickedStudentId] = useState<string | null>(null);

  const studentsRef = useRef<ClassroomStudentState[]>([]);
  const activeScopeRef = useRef<{ classId: string; sessionNumber: number }>({
    classId: "",
    sessionNumber: 1,
  });
  const loadSeqRef = useRef(0);
  const localEditSeqRef = useRef(0);
  const dirtySeqByStudentRef = useRef<Map<string, number>>(new Map());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightSaveRef = useRef<Promise<boolean> | null>(null);
  const recentlyPickedIdsRef = useRef<Set<string>>(new Set());

  const applyServerState = useCallback(
    (data: any, options?: { preserveDirtyLocal?: boolean }) => {
      if (!data) return;
      const nextClasses = Array.isArray(data.runningClasses) ? data.runningClasses : [];
      const nextClassId = String(data.classId || "").trim().toUpperCase();
      const nextSessionNumber = Number(data.sessionNumber || 1);
      const nextSessions = Array.isArray(data.sessions) ? data.sessions : [];
      const nextAcc = Array.isArray(data.courseAccumulation) ? data.courseAccumulation : [];
      const incomingStudents = Array.isArray(data.students)
        ? (data.students as ClassroomStudentState[])
        : [];

      setClasses(nextClasses);
      setClassId(nextClassId);
      setSessionNumber(nextSessionNumber);
      setSessions(nextSessions);
      setCourseAccumulation(nextAcc);
      activeScopeRef.current = { classId: nextClassId, sessionNumber: nextSessionNumber };
      if (nextClassId) {
        writeSavedClassCode(nextClassId);
      }

      if (options?.preserveDirtyLocal && dirtySeqByStudentRef.current.size > 0) {
        const localById = new Map(studentsRef.current.map((s) => [s.studentId, s]));
        const merged = incomingStudents.map((srv) => {
          if (dirtySeqByStudentRef.current.has(srv.studentId)) {
            return localById.get(srv.studentId) || srv;
          }
          return srv;
        });
        studentsRef.current = merged;
        setStudents(merged);
      } else {
        studentsRef.current = incomingStudents;
        setStudents(incomingStudents);
      }
    },
    []
  );

  const fetchState = useCallback(
    async (targetClassId?: string, targetSessionNumber?: number) => {
      const reqId = ++loadSeqRef.current;
      setIsLoading(true);
      setErrorBanner(null);
      try {
        const qs = new URLSearchParams();
        if (targetClassId) qs.set("classId", targetClassId);
        if (targetSessionNumber) qs.set("sessionNumber", String(targetSessionNumber));
        const res = await fetch(`/api/classroom-manager/state?${qs.toString()}`);
        const json = await res.json();
        if (reqId !== loadSeqRef.current) return;
        if (!res.ok || !json?.success) {
          setErrorBanner(json?.error || "Không thể tải dữ liệu lớp học.");
          return;
        }
        applyServerState(json.data);
      } catch (err: unknown) {
        if (reqId !== loadSeqRef.current) return;
        setErrorBanner(err instanceof Error ? err.message : "Lỗi kết nối máy chủ.");
      } finally {
        if (reqId === loadSeqRef.current) {
          setIsLoading(false);
        }
      }
    },
    [applyServerState]
  );

  const flushPendingSaves = useCallback(async (): Promise<boolean> => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    while (inFlightSaveRef.current) {
      await inFlightSaveRef.current;
    }
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const scope = activeScopeRef.current;
    if (!scope.classId || dirtySeqByStudentRef.current.size === 0) {
      return true;
    }

    const sentSeqByStudent = new Map(dirtySeqByStudentRef.current);
    const idsToSave = Array.from(sentSeqByStudent.keys());
    const currentById = new Map(studentsRef.current.map((s) => [s.studentId, s]));
    const items = idsToSave
      .map((id) => currentById.get(id))
      .filter((s): s is ClassroomStudentState => Boolean(s))
      .map((s) => ({
        studentId: s.studentId,
        attendanceStatus: s.attendanceStatus,
        stars: s.stars,
        medals: s.medals,
        praiseCounts: s.praiseCounts,
        issueCounts: s.issueCounts,
        teacherQuickNote: s.teacherQuickNote,
        expectedRowVer: typeof s.rowVer === "number" ? s.rowVer : 0,
      }));

    if (items.length === 0) {
      for (const sid of sentSeqByStudent.keys()) {
        dirtySeqByStudentRef.current.delete(sid);
      }
      return true;
    }

    setSaveIndicator("saving");
    const savePromise = (async (): Promise<boolean> => {
      try {
        const res = await fetch("/api/classroom-manager/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            classId: scope.classId,
            sessionNumber: scope.sessionNumber,
            items,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          setSaveIndicator("error");
          setErrorBanner(json?.error || "Không thể lưu thay đổi.");
          return false;
        }

        const resultMap = new Map<
          string,
          { studentId: string; staleIgnored?: boolean; rowVer?: number }
        >();
        for (const r of json.results || []) {
          if (r?.studentId) {
            resultMap.set(r.studentId, r);
          }
        }

        let hasStale = false;
        for (const [sid, sentSeq] of sentSeqByStudent.entries()) {
          const r = resultMap.get(sid);
          if (r?.staleIgnored) {
            hasStale = true;
            dirtySeqByStudentRef.current.delete(sid);
          } else if (dirtySeqByStudentRef.current.get(sid) === sentSeq) {
            dirtySeqByStudentRef.current.delete(sid);
          }
        }

        if (
          activeScopeRef.current.classId === scope.classId &&
          activeScopeRef.current.sessionNumber === scope.sessionNumber
        ) {
          const serverStudents = Array.isArray(json.data?.students)
            ? (json.data.students as ClassroomStudentState[])
            : [];
          const serverById = new Map(serverStudents.map((st) => [st.studentId, st]));

          if (dirtySeqByStudentRef.current.size === 0) {
            applyServerState(json.data);
          } else {
            const nextStudents = studentsRef.current.map((s) => {
              const resEntry = resultMap.get(s.studentId);
              if (resEntry?.staleIgnored) {
                return serverById.get(s.studentId) || s;
              }
              if (dirtySeqByStudentRef.current.has(s.studentId)) {
                if (resEntry && !resEntry.staleIgnored && typeof resEntry.rowVer === "number") {
                  return { ...s, rowVer: resEntry.rowVer };
                }
                return s;
              }
              return serverById.get(s.studentId) || s;
            });
            studentsRef.current = nextStudents;
            setStudents(nextStudents);
            if (Array.isArray(json.data?.courseAccumulation)) {
              setCourseAccumulation(json.data.courseAccumulation);
            }
            // Schedule follow-up flush for newly edited rows
            saveTimerRef.current = setTimeout(() => {
              void flushPendingSaves();
            }, 300);
          }
        }

        if (hasStale) {
          setSaveIndicator("error");
          setErrorBanner(
            "Dữ liệu vừa được cập nhật mới hơn từ tab khác; hệ thống đã đồng bộ lại bản mới nhất."
          );
          return false;
        }

        setSaveIndicator("saved");
        return true;
      } catch {
        setSaveIndicator("error");
        return false;
      }
    })();

    inFlightSaveRef.current = savePromise;
    try {
      return await savePromise;
    } finally {
      if (inFlightSaveRef.current === savePromise) {
        inFlightSaveRef.current = null;
      }
    }
  }, [applyServerState]);

  // Initial mount from URL params or localStorage
  useEffect(() => {
    let initialClass = "";
    let initialSession: number | undefined = undefined;
    try {
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        const urlClass = String(
          params.get("classId") || params.get("classCode") || ""
        )
          .trim()
          .toUpperCase();
        const urlSess = Number(params.get("sessionNumber") || 0);
        initialClass = urlClass || readSavedClassCode();
        if (Number.isInteger(urlSess) && urlSess >= 1 && urlSess <= 14) {
          initialSession = urlSess;
        }
      }
    } catch {}
    void fetchState(initialClass || undefined, initialSession);

    return () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [fetchState]);

  const mutateStudent = useCallback(
    (studentId: string, updater: (prev: ClassroomStudentState) => ClassroomStudentState) => {
      let didChange = false;
      const nextList = studentsRef.current.map((stu) => {
        if (stu.studentId !== studentId) return stu;
        const updated = updater(stu);
        if (updated === stu) return stu;
        didChange = true;
        const prevEffStars = stu.attendanceStatus === "ABSENT" ? 0 : stu.stars;
        const nextEffStars = updated.attendanceStatus === "ABSENT" ? 0 : updated.stars;
        const prevEffMedals = stu.attendanceStatus === "ABSENT" ? 0 : stu.medals;
        const nextEffMedals = updated.attendanceStatus === "ABSENT" ? 0 : updated.medals;
        const starDelta = nextEffStars - prevEffStars;
        const medalDelta = nextEffMedals - prevEffMedals;
        return {
          ...updated,
          courseTotalStars: Math.max(0, (stu.courseTotalStars ?? prevEffStars) + starDelta),
          courseTotalMedals: Math.max(0, (stu.courseTotalMedals ?? prevEffMedals) + medalDelta),
        };
      });

      if (!didChange) return;

      localEditSeqRef.current += 1;
      dirtySeqByStudentRef.current.set(studentId, localEditSeqRef.current);
      setSaveIndicator("idle");
      studentsRef.current = nextList;
      setStudents(nextList);

      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        void flushPendingSaves();
      }, 350);
    },
    [flushPendingSaves]
  );

  const handleClassChange = async (nextCode: string) => {
    const cleanCode = String(nextCode || "").trim().toUpperCase();
    if (!cleanCode || cleanCode === classId) return;
    await flushPendingSaves();
    dirtySeqByStudentRef.current.clear();
    recentlyPickedIdsRef.current.clear();
    await fetchState(cleanCode, undefined);
  };

  const handleSessionChange = async (nextSessionNum: number) => {
    if (!Number.isInteger(nextSessionNum) || nextSessionNum < 1 || nextSessionNum > 14) return;
    if (nextSessionNum === sessionNumber) return;
    await flushPendingSaves();
    dirtySeqByStudentRef.current.clear();
    recentlyPickedIdsRef.current.clear();
    await fetchState(classId || undefined, nextSessionNum);
  };

  const handleRefreshClasses = async () => {
    setIsRefreshingClasses(true);
    setErrorBanner(null);
    try {
      await flushPendingSaves();
      const res = await refreshClassesFromLms({ scope: "running" });
      if (!res.success) {
        setErrorBanner(res.error || "Không thể đồng bộ danh sách lớp từ LMS.");
        return;
      }
      await fetchState(classId || undefined, sessionNumber);
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : "Lỗi làm mới danh sách lớp.");
    } finally {
      setIsRefreshingClasses(false);
    }
  };

  const handleApplyToComments = async () => {
    if (!classId || studentsRef.current.length === 0) return;
    setIsApplying(true);
    setErrorBanner(null);
    try {
      const flushedOk = await flushPendingSaves();
      if (!flushedOk) {
        return;
      }
      const payloadItems = studentsRef.current.map((s) => ({
        studentId: s.studentId,
        attendanceStatus: s.attendanceStatus,
        stars: s.stars,
        medals: s.medals,
        praiseCounts: s.praiseCounts,
        issueCounts: s.issueCounts,
        teacherQuickNote: s.teacherQuickNote,
        expectedRowVer: typeof s.rowVer === "number" ? s.rowVer : 0,
      }));

      const res = await fetch("/api/classroom-manager/apply-to-comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId,
          sessionNumber,
          items: payloadItems,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setErrorBanner(json?.error || "Không thể chuyển dữ liệu sang trang Nhận xét.");
        return;
      }
      dirtySeqByStudentRef.current.clear();
      setIsSummaryOpen(false);
      router.push(json.targetUrl || `/session-comments?classCode=${encodeURIComponent(classId)}`);
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : "Lỗi kết nối khi chuyển trang.");
    } finally {
      setIsApplying(false);
    }
  };

  const spinRandomStudent = () => {
    const eligible = studentsRef.current.filter((s) => s.attendanceStatus !== "ABSENT");
    if (eligible.length === 0) {
      setPickedStudentId(null);
      setIsRandomOpen(true);
      return;
    }
    let pool = eligible.filter((s) => !recentlyPickedIdsRef.current.has(s.studentId));
    if (pool.length === 0) {
      recentlyPickedIdsRef.current.clear();
      pool = eligible;
    }
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    recentlyPickedIdsRef.current.add(chosen.studentId);
    setPickedStudentId(chosen.studentId);
    setIsRandomOpen(true);
  };

  const summary = computeClassroomSessionSummary(students);
  const pickedStudent = students.find((s) => s.studentId === pickedStudentId) || null;

  return (
    <div className="space-y-3 py-1">
      {!isProjectorMode && (
        <ClassroomToolbar
          classes={classes}
          classId={classId}
          onClassChange={(code) => void handleClassChange(code)}
          onRefreshClasses={handleRefreshClasses}
          isRefreshingClasses={isRefreshingClasses}
          sessions={sessions}
          sessionNumber={sessionNumber}
          onSessionChange={(num) => void handleSessionChange(num)}
          presentAndLateCount={summary.presentOnTimeCount + summary.lateCount}
          totalStudents={summary.totalStudents}
          totalStars={summary.totalStars}
          totalMedals={summary.totalMedals}
          totalIssues={summary.totalIssues}
          isProjectorMode={isProjectorMode}
          onToggleProjector={() => setIsProjectorMode(true)}
          onOpenRandomPicker={spinRandomStudent}
          onOpenSummary={() => setIsSummaryOpen(true)}
          saveIndicator={saveIndicator}
        />
      )}

      {errorBanner && (
        <div
          role="alert"
          className="cm-stat-err rounded-xl px-4 py-2.5 text-xs sm:text-sm font-bold flex items-center justify-between"
        >
          <span>{isProjectorMode ? "🔔" : "⚠️"} {errorBanner}</span>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="px-2 py-0.5 rounded text-xs font-extrabold cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {isLoading && students.length === 0 ? (
        <div className="cm-shell-card px-6 py-12 text-center text-sm font-semibold opacity-75">
          Đang tải danh sách học viên &amp; nhật ký giờ học...
        </div>
      ) : isProjectorMode ? (
        <ClassroomProjectorBoard
          classId={classId}
          sessionNumber={sessionNumber}
          students={students}
          onQuickStar={(id) => mutateStudent(id, (s) => applyPraiseAction(s, "phat_bieu", 1))}
          onQuickMedal={(id) => mutateStudent(id, (s) => applyPraiseAction(s, "huy_hieu", 1))}
          onOpenRandomPicker={spinRandomStudent}
          onExitProjector={() => setIsProjectorMode(false)}
        />
      ) : (
        <ClassroomTeacherTable
          students={students}
          onToggleAttendance={(id) => mutateStudent(id, (s) => applyAttendanceToggle(s))}
          onManualStarDelta={(id, delta) =>
            mutateStudent(id, (s) => applyManualStarDelta(s, delta))
          }
          onPraise={(id, key: ClassroomPraiseKey, delta) =>
            mutateStudent(id, (s) => applyPraiseAction(s, key, delta))
          }
          onIssue={(id, key: ClassroomIssueKey, delta) =>
            mutateStudent(id, (s) => applyIssueAction(s, key, delta))
          }
          onSaveQuickNote={(id, note) =>
            mutateStudent(id, (s) => ({ ...s, teacherQuickNote: note }))
          }
          onOpenAccumulation={() => setIsAccumulationOpen(true)}
          onApplyToComments={() => void handleApplyToComments()}
          isApplying={isApplying}
        />
      )}

      <ClassroomSummaryModal
        open={isSummaryOpen}
        classId={classId}
        sessionNumber={sessionNumber}
        students={students}
        onClose={() => setIsSummaryOpen(false)}
        onOpenAccumulation={() => {
          setIsSummaryOpen(false);
          setIsAccumulationOpen(true);
        }}
        onApplyToComments={() => void handleApplyToComments()}
        isApplying={isApplying}
      />

      <CourseAccumulationModal
        open={isAccumulationOpen}
        classId={classId}
        rows={courseAccumulation}
        onClose={() => setIsAccumulationOpen(false)}
      />

      <RandomStudentModal
        open={isRandomOpen}
        pickedStudent={pickedStudent}
        onSpinAgain={spinRandomStudent}
        onRewardStar={(id) => mutateStudent(id, (s) => applyPraiseAction(s, "phat_bieu", 1))}
        onClose={() => setIsRandomOpen(false)}
      />
    </div>
  );
}
