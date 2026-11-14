import type {
  AdminClassRowDto,
  AdminEarlyWarningItem,
} from "@/lib/admin-center/admin-types";

export type AdminTabKey = "weekly" | "btvn" | "spck" | "gt9" | "instructors";
export type AdminBlockFilter = "ALL" | "CODING" | "ROBOTICS";
export type AdminMilestoneFilter = "ALL" | "GT9" | "SPCK_STAGE";

export interface AdminFilterState {
  blockFilter: AdminBlockFilter;
  instructorFilter: string;
  onlyIssues: boolean;
  milestoneFilter: AdminMilestoneFilter;
  searchQuery: string;
}

export function hasWeeklyOpsIssue(cls: AdminClassRowDto): boolean {
  const w = cls.weeklyOps;
  return (
    w.attendanceStatus === "NOT_MARKED" ||
    w.attendanceStatus === "PARTIAL" ||
    (w.evaluatedSessionNumber > 0 && !w.hasSummaryAndHomework) ||
    w.missingCommentStudentNames.length > 0 ||
    w.isZaloLateOrMissing ||
    w.isLmsLateOrMissing ||
    Boolean(w.checkpointAlert)
  );
}

export function hasCodingBtvnIssue(cls: AdminClassRowDto): boolean {
  if (cls.blockType !== "CODING" || !cls.btvnSummary.applicable) return false;
  return (
    cls.btvnSummary.ungradedCellsCount > 0 ||
    cls.btvnSummary.lowSubmissionWarning ||
    cls.btvnSummary.isOutOfSyncWithTeaching ||
    cls.btvnSyncStatus === "FAILED"
  );
}

export function hasSpckAuditIssue(cls: AdminClassRowDto): boolean {
  if (!cls.spckAudit.applicable) return false;
  return (
    cls.spckAudit.totalMissingUploads > 0 ||
    cls.spckAudit.totalMissingMediaOrLinks > 0 ||
    cls.spckAudit.totalMissingTeacherComments > 0 ||
    cls.spckAudit.session14FinalEval.missingEvalStudents.length > 0
  );
}

export function hasGt9TaskIssue(cls: AdminClassRowDto): boolean {
  return cls.spckTasks.eligibleGt9 && cls.spckTasks.taskStatus !== "READY";
}

export function hasAnyClassIssue(
  cls: AdminClassRowDto,
  activeTab?: AdminTabKey
): boolean {
  if (activeTab === "weekly") return hasWeeklyOpsIssue(cls);
  if (activeTab === "btvn") return hasCodingBtvnIssue(cls);
  if (activeTab === "spck") return hasSpckAuditIssue(cls);
  if (activeTab === "gt9") return hasGt9TaskIssue(cls);
  return (
    hasWeeklyOpsIssue(cls) ||
    hasCodingBtvnIssue(cls) ||
    hasSpckAuditIssue(cls) ||
    hasGt9TaskIssue(cls) ||
    cls.earlyWarnings.length > 0
  );
}

export function filterAdminClasses(
  classes: AdminClassRowDto[],
  filters: AdminFilterState,
  activeTab?: AdminTabKey
): AdminClassRowDto[] {
  const q = filters.searchQuery.trim().toLowerCase();
  const instFilter = filters.instructorFilter.trim().toLowerCase();

  return classes.filter((cls) => {
    if (filters.blockFilter !== "ALL" && cls.blockType !== filters.blockFilter) {
      return false;
    }
    if (instFilter) {
      const mainLower = (cls.mainTeacher || "").trim().toLowerCase();
      const taLower = (cls.assistantTeacher || "").trim().toLowerCase();
      if (mainLower !== instFilter && taLower !== instFilter) {
        return false;
      }
    }
    if (filters.milestoneFilter === "GT9" && !cls.spckTasks.eligibleGt9) {
      return false;
    }
    if (filters.milestoneFilter === "SPCK_STAGE" && !cls.spckAudit.applicable) {
      return false;
    }
    if (filters.onlyIssues && !hasAnyClassIssue(cls, activeTab)) {
      return false;
    }
    if (q) {
      const haystack = [
        cls.classCode,
        cls.courseName,
        cls.mainTeacher,
        cls.assistantTeacher,
        cls.timeSlot,
        cls.specialEvent,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export interface FlattenedAdminWarning extends AdminEarlyWarningItem {
  classCode: string;
  mainTeacher: string;
}

export function flattenEarlyWarnings(
  classes: AdminClassRowDto[]
): FlattenedAdminWarning[] {
  const out: FlattenedAdminWarning[] = [];
  for (const cls of classes) {
    for (const w of cls.earlyWarnings) {
      out.push({
        ...w,
        classCode: cls.classCode,
        mainTeacher: cls.mainTeacher || "Chưa rõ GV",
      });
    }
  }
  return out;
}
