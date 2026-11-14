import type {
  AdminClassRowDto,
  AdminInstructorSummaryDto,
} from "./admin-types";

function formatMissingItemsForClass(cls: AdminClassRowDto): string[] {
  const items: string[] = [];
  const sn = cls.weeklyOps.evaluatedSessionNumber || cls.currentSessionNumber;

  if (cls.weeklyOps.attendanceStatus === "NOT_MARKED") {
    items.push(`Chưa điểm danh Buổi ${sn}`);
  } else if (cls.weeklyOps.attendanceStatus === "PARTIAL") {
    items.push(`Còn ${cls.weeklyOps.unmarkedCount} HV chưa điểm danh Buổi ${sn}`);
  }

  if (cls.weeklyOps.evaluatedSessionNumber > 0 && !cls.weeklyOps.hasSummaryAndHomework) {
    items.push(`Thiếu tổng kết/BTVN buổi ${sn}`);
  }

  if (cls.weeklyOps.missingCommentStudentNames.length > 0) {
    items.push(
      `Thiếu nhận xét LMS ${cls.weeklyOps.missingCommentStudentNames.length} HV đi học Buổi ${sn}`
    );
  }

  if (cls.weeklyOps.isZaloLateOrMissing) {
    items.push(`Zalo NX: ${cls.weeklyOps.zaloStatus || "Chưa đạt/Muộn"}`);
  }
  if (cls.weeklyOps.isLmsLateOrMissing) {
    items.push(`LMS NX: ${cls.weeklyOps.lmsCheckStatus || "Chưa đạt/Muộn"}`);
  }

  if (cls.weeklyOps.checkpointAlert) {
    items.push(cls.weeklyOps.checkpointAlert.message);
  }

  if (cls.blockType === "CODING" && cls.btvnSummary.applicable) {
    if (cls.btvnSummary.ungradedCellsCount > 0) {
      items.push(
        `Còn ${cls.btvnSummary.ungradedCellsCount} bài BTVN chờ chấm (Buổi ${cls.btvnSummary.ungradedSessions.join(", ") || "?"})`
      );
    }
    if (cls.btvnSummary.lowSubmissionWarning) {
      items.push(
        `Tỉ lệ nộp BTVN thấp (${cls.btvnSummary.submissionRatePercent}%)`
      );
    }
  }

  if (cls.spckAudit.applicable) {
    if (cls.spckAudit.totalMissingUploads > 0) {
      items.push(
        `SPCK còn thiếu ${cls.spckAudit.totalMissingUploads} lượt nộp (B12–14)`
      );
    }
    if (cls.spckAudit.totalMissingTeacherComments > 0) {
      items.push(
        `Thiếu ${cls.spckAudit.totalMissingTeacherComments} nhận xét SPCK của GV`
      );
    }
  }

  if (
    cls.spckTasks.eligibleGt9 &&
    cls.spckTasks.taskStatus !== "READY" &&
    cls.spckTasks.taskStatus !== "NOT_ELIGIBLE"
  ) {
    const label =
      cls.spckTasks.taskStatus === "MISSING_PROJECT"
        ? "Chưa tạo Dự án SPCK trên Teaching"
        : `Mới có ${cls.spckTasks.taskCount}/5 nhiệm vụ SPCK trên Teaching`;
    items.push(label);
  }

  const makeupDebts = cls.earlyWarnings.filter((w) => w.type === "MAKEUP_DEBT");
  if (makeupDebts.length > 0) {
    items.push(`Có ${makeupDebts.length} ca học bù cần xử lý`);
  }

  return items;
}

export function buildTeacherZaloReminder(
  instructorName: string,
  classes: AdminClassRowDto[],
  centerCode: string = "205ALHP"
): string {
  const cleanName = instructorName.trim() || "Thầy/Cô";
  const actionLines: string[] = [];

  for (const cls of classes) {
    const items = formatMissingItemsForClass(cls);
    if (items.length === 0) continue;
    const sn = cls.currentSessionNumber > 0 ? ` (Buổi ${cls.currentSessionNumber})` : "";
    actionLines.push(`• ${cls.classCode}${sn}: ${items.join("; ")}.`);
  }

  if (actionLines.length === 0) {
    return `✅ [${centerCode}] Thầy/Cô ${cleanName} đã hoàn thành đầy đủ các đầu việc vận hành tuần hiện tại.`;
  }

  return [
    `📢 [NHẮC VIỆC VẬN HÀNH — CƠ SỞ ${centerCode}]`,
    `Gửi thầy/cô ${cleanName}, cơ sở nhờ thầy/cô rà soát và bổ sung các hạng mục còn thiếu dưới đây:`,
    ...actionLines,
    `👉 Cập nhật trên LMS: https://lms.mindx.edu.vn/admin/classes`,
    `👉 Cập nhật trên Teaching: https://teachingmindx.top/`,
    `Cảm ơn thầy/cô nhiều ạ!`,
  ].join("\n");
}

export function buildInstructorSummariesAndCampusText(
  classes: AdminClassRowDto[],
  centerCode: string = "205ALHP"
): {
  instructors: AdminInstructorSummaryDto[];
  campusZaloSummaryText: string;
} {
  const byTeacher = new Map<string, AdminClassRowDto[]>();
  for (const cls of classes) {
    const key = cls.mainTeacher.trim() || "Chưa phân công GV";
    const list = byTeacher.get(key) || [];
    list.push(cls);
    byTeacher.set(key, list);
  }

  const instructors: AdminInstructorSummaryDto[] = [];
  for (const [instructorName, teacherClasses] of byTeacher.entries()) {
    let missingWeeklyOpsClasses = 0;
    let ungradedBtvnTotal = 0;
    let missingSpckCommentsTotal = 0;
    let missingSpckTasksClasses = 0;
    let makeupDebtCount = 0;

    for (const cls of teacherClasses) {
      const hasWeeklyIssue =
        cls.weeklyOps.attendanceStatus === "NOT_MARKED" ||
        cls.weeklyOps.attendanceStatus === "PARTIAL" ||
        (cls.weeklyOps.evaluatedSessionNumber > 0 &&
          !cls.weeklyOps.hasSummaryAndHomework) ||
        cls.weeklyOps.missingCommentStudentNames.length > 0 ||
        cls.weeklyOps.isZaloLateOrMissing ||
        cls.weeklyOps.isLmsLateOrMissing ||
        Boolean(cls.weeklyOps.checkpointAlert);

      if (hasWeeklyIssue) missingWeeklyOpsClasses++;
      if (cls.blockType === "CODING") {
        ungradedBtvnTotal += Number(cls.btvnSummary.ungradedCellsCount || 0);
      }
      missingSpckCommentsTotal += Number(
        cls.spckAudit.totalMissingTeacherComments || 0
      );
      if (
        cls.spckTasks.eligibleGt9 &&
        cls.spckTasks.taskStatus !== "READY" &&
        cls.spckTasks.taskStatus !== "NOT_ELIGIBLE"
      ) {
        missingSpckTasksClasses++;
      }
      makeupDebtCount += cls.earlyWarnings.filter(
        (w) => w.type === "MAKEUP_DEBT"
      ).length;
    }

    instructors.push({
      instructorName,
      totalClasses: teacherClasses.length,
      missingWeeklyOpsClasses,
      ungradedBtvnTotal,
      missingSpckCommentsTotal,
      missingSpckTasksClasses,
      makeupDebtCount,
      zaloReminderText: buildTeacherZaloReminder(
        instructorName,
        teacherClasses,
        centerCode
      ),
      classCodes: teacherClasses.map((c) => c.classCode),
    });
  }

  instructors.sort((a, b) => {
    const scoreA =
      a.missingWeeklyOpsClasses * 10 +
      a.ungradedBtvnTotal +
      a.missingSpckCommentsTotal * 3 +
      a.missingSpckTasksClasses * 5;
    const scoreB =
      b.missingWeeklyOpsClasses * 10 +
      b.ungradedBtvnTotal +
      b.missingSpckCommentsTotal * 3 +
      b.missingSpckTasksClasses * 5;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.instructorName.localeCompare(b.instructorName, "vi");
  });

  const actionSections = instructors
    .map((inst) => {
      const classesForTeacher = byTeacher.get(inst.instructorName) || [];
      const lines = classesForTeacher
        .map((cls) => {
          const items = formatMissingItemsForClass(cls);
          return items.length > 0 ? `  - ${cls.classCode}: ${items.join("; ")}` : "";
        })
        .filter(Boolean);
      if (lines.length === 0) return "";
      return `👨‍🏫 ${inst.instructorName}:\n${lines.join("\n")}`;
    })
    .filter(Boolean);

  const campusZaloSummaryText =
    actionSections.length > 0
      ? [
          `📋 [TỔNG HỢP NHẮC VIỆC VẬN HÀNH TOÀN CƠ SỞ ${centerCode}]`,
          ...actionSections,
          `👉 LMS: https://lms.mindx.edu.vn/admin/classes | Teaching: https://teachingmindx.top/`,
        ].join("\n\n")
      : `✅ [CƠ SỞ ${centerCode}] Toàn bộ các lớp đều đã hoàn thành tốt đầu việc vận hành tuần hiện tại!`;

  return { instructors, campusZaloSummaryText };
}
