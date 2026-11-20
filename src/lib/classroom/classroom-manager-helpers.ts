import { detectTrackByClassCode } from "@/lib/quick-tags";

export const MAX_CLASS_MEDALS = 3;

export type ClassroomPraiseKey = "phat_bieu" | "lam_tot" | "huy_hieu";
export type ClassroomStoredPraiseKey = ClassroomPraiseKey | "huy_hieu_off";
export type ClassroomIssueKey =
  | "di_muon"
  | "noi_chuyen"
  | "khong_chu_y"
  | "viec_rieng"
  | "roi_cho"
  | "chua_btvn";

export type ClassroomAttendanceStatus = "PRESENT" | "LATE" | "ABSENT";

export interface ClassroomPraiseItemDef {
  key: ClassroomPraiseKey;
  label: string;
  icon: string;
  starDelta: number;
  medalDelta: number;
  summaryPhrase: string;
}

export interface ClassroomIssueItemDef {
  key: ClassroomIssueKey;
  label: string;
  icon: string;
  summaryPhrase: string;
  singleOccurrenceOmitsCount?: boolean;
}

export const CLASSROOM_PRAISE_ITEMS: readonly ClassroomPraiseItemDef[] = [
  {
    key: "phat_bieu",
    label: "Phát biểu",
    icon: "🙋",
    starDelta: 1,
    medalDelta: 0,
    summaryPhrase: "phát biểu xây dựng bài",
  },
  {
    key: "lam_tot",
    label: "Làm tốt",
    icon: "⚡",
    starDelta: 1,
    medalDelta: 0,
    summaryPhrase: "hoàn thành tốt bài thực hành",
  },
  {
    key: "huy_hieu",
    label: "Top 3",
    icon: "🏅",
    starDelta: 0,
    medalDelta: 1,
    summaryPhrase: "nhận Huy hiệu Top 3 học viên xuất sắc nhất lớp",
  },
] as const;

export const CLASSROOM_ISSUE_ITEMS: readonly ClassroomIssueItemDef[] = [
  {
    key: "di_muon",
    label: "Đi muộn",
    icon: "⏰",
    summaryPhrase: "đi học muộn",
    singleOccurrenceOmitsCount: true,
  },
  {
    key: "noi_chuyen",
    label: "Nói chuyện",
    icon: "💬",
    summaryPhrase: "nói chuyện riêng",
  },
  {
    key: "khong_chu_y",
    label: "Không chú ý",
    icon: "👀",
    summaryPhrase: "mất tập trung khi nghe giảng",
  },
  {
    key: "viec_rieng",
    label: "Việc riêng",
    icon: "🎮",
    summaryPhrase: "làm việc riêng trong giờ",
  },
  {
    key: "roi_cho",
    label: "Rời chỗ",
    icon: "🚶",
    summaryPhrase: "tự ý rời khỏi chỗ ngồi",
  },
  {
    key: "chua_btvn",
    label: "Chưa BTVN",
    icon: "📕",
    summaryPhrase: "chưa hoàn thành BTVN trước buổi học",
    singleOccurrenceOmitsCount: true,
  },
] as const;

const ISSUE_DISPLAY_ORDER: readonly ClassroomIssueKey[] = [
  "di_muon",
  "chua_btvn",
  "noi_chuyen",
  "khong_chu_y",
  "viec_rieng",
  "roi_cho",
];

const PRAISE_MAP = new Map<ClassroomPraiseKey, ClassroomPraiseItemDef>(
  CLASSROOM_PRAISE_ITEMS.map((item) => [item.key, item])
);
const ISSUE_MAP = new Map<ClassroomIssueKey, ClassroomIssueItemDef>(
  CLASSROOM_ISSUE_ITEMS.map((item) => [item.key, item])
);

export interface ClassroomStudentState {
  studentId: string;
  fullName: string;
  attendanceStatus: ClassroomAttendanceStatus;
  stars: number;
  medals: number;
  praiseCounts: Partial<Record<ClassroomStoredPraiseKey, number>>;
  issueCounts: Partial<Record<ClassroomIssueKey, number>>;
  teacherQuickNote: string;
  courseTotalStars?: number;
  courseTotalMedals?: number;
  rowVer?: number;
  appliedToCommentAt?: string | null;
}

export interface ClassroomProjectorRow {
  studentId: string;
  fullName: string;
  rank: number | null;
  isAbsent: boolean;
  stars: number;
  medals: number;
  courseTotalStars: number;
  courseTotalMedals: number;
}

export interface ClassroomCourseAccumulationRow {
  studentId: string;
  fullName: string;
  totalStars: number;
  totalMedals: number;
  attendedSessions: number;
  lateSessions: number;
  absentSessions: number;
  rankLabel: "Xuất sắc 🌟" | "Tích cực 👍" | "Cần cố gắng 💪";
}

export interface ClassroomMappedComment {
  attendanceStatus: "PRESENT" | "LATE" | "ABSENT";
  quickTags: string[];
  teacherNote: string;
}

export interface ClassroomSessionSummary {
  totalStudents: number;
  presentOnTimeCount: number;
  lateCount: number;
  absentCount: number;
  missingHomeworkCount: number;
  totalStars: number;
  totalMedals: number;
  totalIssues: number;
  lateNames: string[];
  absentNames: string[];
  missingHomeworkNames: string[];
}

function clampCount(val: unknown, min = 0, max = 99): number {
  const n = Math.floor(Number(val));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export function parseClassroomCountsRecord<K extends string>(
  raw: unknown,
  allowedKeys: readonly K[]
): Partial<Record<K, number>> {
  const allowedSet = new Set<string>(allowedKeys);
  const out: Partial<Record<K, number>> = {};
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return out;
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return out;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (!allowedSet.has(k)) continue;
    const count = clampCount(v, 0, 99);
    if (count > 0) {
      out[k as K] = count;
    }
  }
  return out;
}

export function sumCountsRecord(counts?: Record<string, number | undefined> | null): number {
  if (!counts) return 0;
  let total = 0;
  for (const val of Object.values(counts)) {
    const n = Number(val || 0);
    if (Number.isFinite(n) && n > 0) total += Math.floor(n);
  }
  return total;
}

export function formatShortClassroomName(fullName: string): string {
  const words = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.length >= 3 ? words.slice(1).join(" ") : words.join(" ");
}

/**
 * Applies a praise action (+1 / -1) to a student's session state without mutating input.
 * Updates `praiseCounts[key]` and adjusts `stars` / `medals` strictly by actual delta.
 */
export function applyPraiseAction(
  state: ClassroomStudentState,
  key: ClassroomPraiseKey,
  delta: 1 | -1 = 1
): ClassroomStudentState {
  if (state.attendanceStatus === "ABSENT") return state;
  const def = PRAISE_MAP.get(key);
  if (!def) return state;

  if (key === "huy_hieu") {
    const nextPraiseCounts = { ...state.praiseCounts };
    if (delta === 1) {
      if (Math.max(0, Math.floor(state.stars || 0)) < 1) {
        return state;
      }
      delete nextPraiseCounts.huy_hieu_off;
      nextPraiseCounts.huy_hieu = 1;
      return {
        ...state,
        praiseCounts: nextPraiseCounts,
        medals: 1,
      };
    }
    delete nextPraiseCounts.huy_hieu;
    if (Math.max(0, Math.floor(state.stars || 0)) >= 1) {
      nextPraiseCounts.huy_hieu_off = 1;
    } else {
      delete nextPraiseCounts.huy_hieu_off;
    }
    return {
      ...state,
      praiseCounts: nextPraiseCounts,
      medals: 0,
    };
  }

  const currentCount = clampCount(state.praiseCounts?.[key] ?? 0, 0, 99);
  const nextCount = clampCount(currentCount + delta, 0, 99);
  const actualDelta = nextCount - currentCount;
  if (actualDelta === 0) return state;

  const nextPraiseCounts = { ...state.praiseCounts };
  if (nextCount > 0) {
    nextPraiseCounts[key] = nextCount;
  } else {
    delete nextPraiseCounts[key];
  }

  return {
    ...state,
    praiseCounts: nextPraiseCounts,
    stars: Math.max(0, Math.min(999, Math.floor(state.stars || 0) + def.starDelta * actualDelta)),
  };
}

/**
 * Applies a classroom issue counter (+1 / -1) without deducting stars or medals.
 * Synchronizes `di_muon` bidirectionally with `attendanceStatus` ("LATE" <-> "PRESENT").
 */
export function applyIssueAction(
  state: ClassroomStudentState,
  key: ClassroomIssueKey,
  delta: 1 | -1 = 1
): ClassroomStudentState {
  if (state.attendanceStatus === "ABSENT") return state;
  if (!ISSUE_MAP.has(key)) return state;

  const currentCount = clampCount(state.issueCounts?.[key] ?? 0, 0, 99);
  const nextCount = clampCount(currentCount + delta, 0, 99);
  const actualDelta = nextCount - currentCount;
  if (actualDelta === 0) return state;

  const nextIssueCounts = { ...state.issueCounts };
  if (nextCount > 0) {
    nextIssueCounts[key] = nextCount;
  } else {
    delete nextIssueCounts[key];
  }

  let nextAttendance = state.attendanceStatus;
  if (key === "di_muon") {
    if (nextCount >= 1 && state.attendanceStatus === "PRESENT") {
      nextAttendance = "LATE";
    } else if (nextCount === 0 && state.attendanceStatus === "LATE") {
      nextAttendance = "PRESENT";
    }
  }

  return {
    ...state,
    attendanceStatus: nextAttendance,
    issueCounts: nextIssueCounts,
    // Iron rule: stars & medals remain strictly unchanged on violation logging
    stars: Math.max(0, Math.floor(state.stars || 0)),
    medals: Math.max(0, Math.floor(state.medals || 0)),
  };
}

/**
 * Adjusts stars manually (+1 / -1) while respecting ABSENT lock and non-negative floor.
 */
export function applyManualStarDelta(
  state: ClassroomStudentState,
  delta: 1 | -1
): ClassroomStudentState {
  if (state.attendanceStatus === "ABSENT") return state;
  const nextStars = Math.max(0, Math.min(999, Math.floor(state.stars || 0) + delta));
  if (nextStars === state.stars) return state;
  return {
    ...state,
    stars: nextStars,
  };
}

/**
 * Toggles or sets attendance status and keeps `di_muon` and medal eligibility synchronized.
 */
export function applyAttendanceToggle(
  state: ClassroomStudentState,
  explicitNext?: ClassroomAttendanceStatus
): ClassroomStudentState {
  const cycleOrder: ClassroomAttendanceStatus[] = ["PRESENT", "LATE", "ABSENT"];
  const currentIdx = cycleOrder.indexOf(state.attendanceStatus);
  const nextStatus =
    explicitNext ?? cycleOrder[(currentIdx >= 0 ? currentIdx + 1 : 0) % cycleOrder.length];

  const nextIssueCounts = { ...state.issueCounts };
  if (nextStatus === "LATE") {
    if (clampCount(nextIssueCounts.di_muon ?? 0, 0, 99) === 0) {
      nextIssueCounts.di_muon = 1;
    }
  } else if (nextStatus === "PRESENT") {
    delete nextIssueCounts.di_muon;
  }

  let nextPraiseCounts = state.praiseCounts;
  let nextMedals = Math.min(1, Math.max(0, Math.floor(state.medals || 0)));
  if (nextStatus === "ABSENT") {
    nextMedals = 0;
    if (state.praiseCounts?.huy_hieu !== undefined || state.praiseCounts?.huy_hieu_off !== undefined) {
      nextPraiseCounts = { ...state.praiseCounts };
      delete nextPraiseCounts.huy_hieu;
      delete nextPraiseCounts.huy_hieu_off;
    }
  }

  return {
    ...state,
    attendanceStatus: nextStatus,
    medals: nextMedals,
    praiseCounts: nextPraiseCounts,
    issueCounts: nextIssueCounts,
  };
}

function compareTop3MedalPriority(a: ClassroomStudentState, b: ClassroomStudentState): number {
  const aStars = Math.max(0, Math.floor(a.stars || 0));
  const bStars = Math.max(0, Math.floor(b.stars || 0));
  if (bStars !== aStars) return bStars - aStars;

  const aIssues = sumCountsRecord(a.issueCounts);
  const bIssues = sumCountsRecord(b.issueCounts);
  if (aIssues !== bIssues) return aIssues - bIssues;

  const aCourse = Math.max(0, Math.floor(a.courseTotalStars ?? aStars));
  const bCourse = Math.max(0, Math.floor(b.courseTotalStars ?? bStars));
  if (bCourse !== aCourse) return bCourse - aCourse;

  const byName = String(a.fullName || "").localeCompare(String(b.fullName || ""), "vi");
  if (byName !== 0) return byName;
  return String(a.studentId || "").localeCompare(String(b.studentId || ""));
}

/**
 * Reconciles class-wide Top 3 medals per Session using rule A2:
 * - Max 3 winners/session, each getting 0 or 1 medal; ABSENT always gets 0.
 * - Manually pinned (`huy_hieu >= 1` without `huy_hieu_off`) take priority up to MAX_CLASS_MEDALS.
 * - Remaining slots auto-award present/late students with `stars >= 1` and no `huy_hieu_off`,
 *   ranked by Stars DESC -> Issues ASC -> CourseStars DESC -> Name ASC.
 */
export function reconcileTop3ClassMedals(
  rows: ClassroomStudentState[]
): ClassroomStudentState[] {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const manualPinned = rows
    .filter(
      (r) =>
        r.attendanceStatus !== "ABSENT" &&
        Math.floor(r.stars || 0) >= 1 &&
        clampCount(r.praiseCounts?.huy_hieu ?? 0, 0, 99) >= 1 &&
        clampCount(r.praiseCounts?.huy_hieu_off ?? 0, 0, 99) === 0
    )
    .sort(compareTop3MedalPriority)
    .slice(0, MAX_CLASS_MEDALS);

  const winnerIds = new Set<string>(manualPinned.map((r) => r.studentId));
  const remainingSlots = MAX_CLASS_MEDALS - winnerIds.size;

  if (remainingSlots > 0) {
    const autoCandidates = rows
      .filter(
        (r) =>
          r.attendanceStatus !== "ABSENT" &&
          !winnerIds.has(r.studentId) &&
          clampCount(r.praiseCounts?.huy_hieu_off ?? 0, 0, 99) === 0 &&
          Math.floor(r.stars || 0) >= 1
      )
      .sort(compareTop3MedalPriority)
      .slice(0, remainingSlots);

    for (const c of autoCandidates) {
      winnerIds.add(c.studentId);
    }
  }

  return rows.map((r) => {
    const isAbsent = r.attendanceStatus === "ABSENT";
    const nextMedals = !isAbsent && winnerIds.has(r.studentId) ? 1 : 0;
    const curMedals = Math.floor(r.medals || 0);
    const curPinned = clampCount(r.praiseCounts?.huy_hieu ?? 0, 0, 99);
    const hasOff = clampCount(r.praiseCounts?.huy_hieu_off ?? 0, 0, 99) >= 1;

    let nextPraiseCounts = r.praiseCounts;
    let praiseChanged = false;

    if (isAbsent) {
      if (r.praiseCounts?.huy_hieu !== undefined || r.praiseCounts?.huy_hieu_off !== undefined) {
        nextPraiseCounts = { ...r.praiseCounts };
        delete nextPraiseCounts.huy_hieu;
        delete nextPraiseCounts.huy_hieu_off;
        praiseChanged = true;
      }
    } else if (curPinned > 1 || (curPinned >= 1 && (!winnerIds.has(r.studentId) || hasOff))) {
      nextPraiseCounts = { ...r.praiseCounts };
      if (winnerIds.has(r.studentId) && !hasOff) {
        nextPraiseCounts.huy_hieu = 1;
      } else {
        delete nextPraiseCounts.huy_hieu;
      }
      praiseChanged = true;
    }

    if (curMedals === nextMedals && !praiseChanged) {
      return r;
    }

    return {
      ...r,
      medals: nextMedals,
      praiseCounts: nextPraiseCounts,
    };
  });
}

/**
 * Toggles or removes a student's Top 3 medal while respecting the class-wide 3-medal cap.
 */
export function toggleStudentTop3Medal(
  rows: ClassroomStudentState[],
  studentId: string,
  mode: "toggle" | "remove" = "toggle"
): { rows: ClassroomStudentState[]; changed: boolean; limitReachedError?: string } {
  const reconciled = reconcileTop3ClassMedals(rows);
  const target = reconciled.find((r) => r.studentId === studentId);
  if (!target || target.attendanceStatus === "ABSENT") {
    return { rows: reconciled, changed: false };
  }

  if (target.medals > 0 || mode === "remove") {
    if (target.medals === 0) {
      return { rows: reconciled, changed: false };
    }
    const drafted = reconciled.map((r) => {
      if (r.studentId !== studentId) return r;
      const nextPraise = { ...r.praiseCounts };
      delete nextPraise.huy_hieu;
      if (Math.floor(r.stars || 0) >= 1) {
        nextPraise.huy_hieu_off = 1;
      } else {
        delete nextPraise.huy_hieu_off;
      }
      return {
        ...r,
        medals: 0,
        praiseCounts: nextPraise,
      };
    });
    return { rows: reconcileTop3ClassMedals(drafted), changed: true };
  }

  // Attempting to award/pin a medal onto a student who currently has medals === 0
  if (Math.floor(target.stars || 0) < 1) {
    return {
      rows: reconciled,
      changed: false,
      limitReachedError:
        "Học viên cần đạt tối thiểu 1 ⭐ trong buổi học mới đủ điều kiện nhận Huy hiệu Top 3.",
    };
  }

  const activeManualPins = reconciled.filter(
    (r) =>
      r.studentId !== studentId &&
      r.attendanceStatus !== "ABSENT" &&
      Math.floor(r.stars || 0) >= 1 &&
      clampCount(r.praiseCounts?.huy_hieu ?? 0, 0, 99) >= 1 &&
      clampCount(r.praiseCounts?.huy_hieu_off ?? 0, 0, 99) === 0
  );
  if (activeManualPins.length >= MAX_CLASS_MEDALS) {
    return {
      rows: reconciled,
      changed: false,
      limitReachedError:
        "Mỗi buổi chỉ trao tối đa 3 Huy hiệu cho 3 bạn xuất sắc nhất lớp. Vui lòng gỡ 1 bạn trước khi đổi.",
    };
  }

  const clearedOffRows = reconciled.map((r) => {
    if (r.studentId !== studentId) return r;
    const nextPraise = { ...r.praiseCounts };
    delete nextPraise.huy_hieu_off;
    return { ...r, praiseCounts: nextPraise };
  });

  const autoTest = reconcileTop3ClassMedals(clearedOffRows);
  const autoTarget = autoTest.find((r) => r.studentId === studentId);
  if (autoTarget && autoTarget.medals >= 1) {
    return { rows: autoTest, changed: true };
  }

  const pinnedRows = clearedOffRows.map((r) => {
    if (r.studentId !== studentId) return r;
    return {
      ...r,
      praiseCounts: {
        ...r.praiseCounts,
        huy_hieu: 1,
      },
    };
  });
  return { rows: reconcileTop3ClassMedals(pinnedRows), changed: true };
}

/**
 * Ranks students for the horizontal classroom projector mode.
 * Explicitly excludes all violation counts, late tags, and teacher private notes.
 */
export function rankStudentsForProjector(
  rows: ClassroomStudentState[]
): ClassroomProjectorRow[] {
  const reconciled = reconcileTop3ClassMedals(rows);
  const sorted = [...reconciled].sort((a, b) => {
    const aAbs = a.attendanceStatus === "ABSENT" ? 1 : 0;
    const bAbs = b.attendanceStatus === "ABSENT" ? 1 : 0;
    if (aAbs !== bAbs) return aAbs - bAbs;

    const aStars = Math.max(0, Math.floor(a.stars || 0));
    const bStars = Math.max(0, Math.floor(b.stars || 0));
    if (bStars !== aStars) return bStars - aStars;

    const aMedals = Math.max(0, Math.floor(a.medals || 0));
    const bMedals = Math.max(0, Math.floor(b.medals || 0));
    if (bMedals !== aMedals) return bMedals - aMedals;

    const aCourse = Math.max(0, Math.floor(a.courseTotalStars ?? aStars));
    const bCourse = Math.max(0, Math.floor(b.courseTotalStars ?? bStars));
    if (bCourse !== aCourse) return bCourse - aCourse;

    const aCourseMedals = Math.max(0, Math.floor(a.courseTotalMedals ?? aMedals));
    const bCourseMedals = Math.max(0, Math.floor(b.courseTotalMedals ?? bMedals));
    if (bCourseMedals !== aCourseMedals) return bCourseMedals - aCourseMedals;

    const byName = String(a.fullName || "").localeCompare(String(b.fullName || ""), "vi");
    if (byName !== 0) return byName;
    return String(a.studentId || "").localeCompare(String(b.studentId || ""));
  });

  let activeRank = 0;
  return sorted.map((row) => {
    const isAbsent = row.attendanceStatus === "ABSENT";
    if (!isAbsent) activeRank += 1;
    return {
      studentId: row.studentId,
      fullName: row.fullName,
      rank: isAbsent ? null : activeRank,
      isAbsent,
      stars: isAbsent ? 0 : Math.max(0, Math.floor(row.stars || 0)),
      medals: isAbsent ? 0 : Math.max(0, Math.floor(row.medals || 0)),
      courseTotalStars: Math.max(
        0,
        Math.floor(row.courseTotalStars ?? (isAbsent ? 0 : row.stars) ?? 0)
      ),
      courseTotalMedals: Math.max(
        0,
        Math.floor(row.courseTotalMedals ?? (isAbsent ? 0 : row.medals) ?? 0)
      ),
    };
  });
}

/**
 * Computes 14-session course accumulation totals and encouragement tiers per student.
 * Reconciles each session's Top 3 A2 medals before summing course totals.
 */
export function computeCourseAccumulationSummary(
  students: Array<{ studentId: string; fullName: string }>,
  allLogs: Array<{
    studentId: string;
    sessionNumber: number;
    attendanceStatus: string;
    stars: number;
    medals: number;
    praiseCountsJson?: string | Partial<Record<ClassroomStoredPraiseKey, number>>;
    issueCountsJson?: string | Partial<Record<ClassroomIssueKey, number>>;
  }>
): ClassroomCourseAccumulationRow[] {
  const byStudent = new Map<
    string,
    {
      totalStars: number;
      totalMedals: number;
      attendedSet: Set<number>;
      lateSet: Set<number>;
      absentSet: Set<number>;
    }
  >();

  const logsBySession = new Map<
    number,
    Map<
      string,
      {
        attendanceStatus: ClassroomAttendanceStatus;
        stars: number;
        medals: number;
        praiseCounts: Partial<Record<ClassroomStoredPraiseKey, number>>;
        issueCounts: Partial<Record<ClassroomIssueKey, number>>;
      }
    >
  >();

  for (const log of allLogs || []) {
    const sid = String(log.studentId || "").trim();
    const sessNum = Math.floor(Number(log.sessionNumber || 0));
    if (!sid || sessNum < 1 || sessNum > 14) continue;
    let sessMap = logsBySession.get(sessNum);
    if (!sessMap) {
      sessMap = new Map();
      logsBySession.set(sessNum, sessMap);
    }
    const rawAtt = String(log.attendanceStatus || "PRESENT").trim().toUpperCase();
    const att: ClassroomAttendanceStatus =
      rawAtt === "ABSENT" || rawAtt === "LATE" ? rawAtt : "PRESENT";
    const praiseKeys: readonly ClassroomStoredPraiseKey[] = [
      "phat_bieu",
      "lam_tot",
      "huy_hieu",
      "huy_hieu_off",
    ];
    const issueKeys = CLASSROOM_ISSUE_ITEMS.map((i) => i.key) as readonly ClassroomIssueKey[];
    sessMap.set(sid, {
      attendanceStatus: att,
      stars: Math.max(0, Math.floor(Number(log.stars || 0))),
      medals: Math.max(0, Math.floor(Number(log.medals || 0))),
      praiseCounts: parseClassroomCountsRecord(log.praiseCountsJson ?? {}, praiseKeys),
      issueCounts: parseClassroomCountsRecord(log.issueCountsJson ?? {}, issueKeys),
    });
  }

  const courseStarsByStudent = new Map<string, number>();
  for (const sessMap of logsBySession.values()) {
    for (const [sid, entry] of sessMap.entries()) {
      if (entry.attendanceStatus === "ABSENT") continue;
      courseStarsByStudent.set(sid, (courseStarsByStudent.get(sid) ?? 0) + entry.stars);
    }
  }

  for (const [sessNum, sessMap] of logsBySession.entries()) {
    const rosterSeed = students.map((st) => {
      const entry = sessMap.get(st.studentId);
      return {
        studentId: st.studentId,
        fullName: st.fullName,
        attendanceStatus: entry?.attendanceStatus ?? ("PRESENT" as ClassroomAttendanceStatus),
        stars: entry?.stars ?? 0,
        medals: entry?.medals ?? 0,
        courseTotalStars: courseStarsByStudent.get(st.studentId) ?? 0,
        praiseCounts: entry?.praiseCounts ?? {},
        issueCounts: entry?.issueCounts ?? {},
        teacherQuickNote: "",
      };
    });
    const extraSids = Array.from(sessMap.keys()).filter(
      (sid) => !students.some((st) => st.studentId === sid)
    );
    for (const extraSid of extraSids) {
      const entry = sessMap.get(extraSid)!;
      rosterSeed.push({
        studentId: extraSid,
        fullName: extraSid,
        attendanceStatus: entry.attendanceStatus,
        stars: entry.stars,
        medals: entry.medals,
        courseTotalStars: courseStarsByStudent.get(extraSid) ?? 0,
        praiseCounts: entry.praiseCounts,
        issueCounts: entry.issueCounts,
        teacherQuickNote: "",
      });
    }

    const reconciled = reconcileTop3ClassMedals(rosterSeed);
    for (const row of reconciled) {
      if (!sessMap.has(row.studentId)) continue;
      let acc = byStudent.get(row.studentId);
      if (!acc) {
        acc = {
          totalStars: 0,
          totalMedals: 0,
          attendedSet: new Set(),
          lateSet: new Set(),
          absentSet: new Set(),
        };
        byStudent.set(row.studentId, acc);
      }
      if (row.attendanceStatus === "ABSENT") {
        acc.absentSet.add(sessNum);
        continue;
      }
      acc.attendedSet.add(sessNum);
      if (row.attendanceStatus === "LATE") acc.lateSet.add(sessNum);
      acc.totalStars += Math.max(0, Math.floor(row.stars || 0));
      acc.totalMedals += Math.max(0, Math.floor(row.medals || 0));
    }
  }

  return students
    .map((st) => {
      const acc = byStudent.get(st.studentId);
      const totalStars = acc?.totalStars ?? 0;
      const totalMedals = acc?.totalMedals ?? 0;
      const rankLabel: ClassroomCourseAccumulationRow["rankLabel"] =
        totalStars >= 20
          ? "Xuất sắc 🌟"
          : totalStars >= 10
          ? "Tích cực 👍"
          : "Cần cố gắng 💪";
      return {
        studentId: st.studentId,
        fullName: st.fullName,
        totalStars,
        totalMedals,
        attendedSessions: acc?.attendedSet.size ?? 0,
        lateSessions: acc?.lateSet.size ?? 0,
        absentSessions: acc?.absentSet.size ?? 0,
        rankLabel,
      };
    })
    .sort((a, b) => {
      if (b.totalStars !== a.totalStars) return b.totalStars - a.totalStars;
      if (b.totalMedals !== a.totalMedals) return b.totalMedals - a.totalMedals;
      return a.fullName.localeCompare(b.fullName, "vi");
    });
}

export function computeClassroomSessionSummary(
  rows: ClassroomStudentState[]
): ClassroomSessionSummary {
  const reconciled = reconcileTop3ClassMedals(rows);
  let presentOnTimeCount = 0;
  let lateCount = 0;
  let absentCount = 0;
  let missingHomeworkCount = 0;
  let totalStars = 0;
  let totalMedals = 0;
  let totalIssues = 0;
  const lateNames: string[] = [];
  const absentNames: string[] = [];
  const missingHomeworkNames: string[] = [];

  for (const row of reconciled) {
    const shortName = formatShortClassroomName(row.fullName) || row.fullName;
    if (row.attendanceStatus === "ABSENT") {
      absentCount += 1;
      absentNames.push(shortName);
      continue;
    }
    if (row.attendanceStatus === "LATE") {
      lateCount += 1;
      lateNames.push(shortName);
    } else {
      presentOnTimeCount += 1;
    }

    totalStars += Math.max(0, Math.floor(row.stars || 0));
    totalMedals += Math.max(0, Math.floor(row.medals || 0));
    totalIssues += sumCountsRecord(row.issueCounts);

    if (clampCount(row.issueCounts?.chua_btvn ?? 0, 0, 99) > 0) {
      missingHomeworkCount += 1;
      missingHomeworkNames.push(shortName);
    }
  }

  return {
    totalStudents: reconciled.length,
    presentOnTimeCount,
    lateCount,
    absentCount,
    missingHomeworkCount,
    totalStars,
    totalMedals,
    totalIssues,
    lateNames,
    absentNames,
    missingHomeworkNames,
  };
}

function appendSentencePeriod(text: string): string {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function capitalizeLeadingChar(text: string): string {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Maps in-class behavior logs into `/session-comments` attendance, Quick Tags (Coding / Robotics),
 * and a structured `teacherNote` string (line-by-line `+ ` issues & Top 3 medal mention).
 */
export function buildClassroomToCommentMapping(params: {
  classCode: string;
  sessionNumber: number;
  studentRow: ClassroomStudentState;
}): ClassroomMappedComment {
  const { classCode, studentRow } = params;
  const customQuickNote = String(studentRow.teacherQuickNote || "").trim();

  if (studentRow.attendanceStatus === "ABSENT") {
    return {
      attendanceStatus: "ABSENT",
      quickTags: [],
      teacherNote: customQuickNote,
    };
  }

  const isRobotics = detectTrackByClassCode(classCode) === "robotics";
  const phatBieu = clampCount(studentRow.praiseCounts?.phat_bieu ?? 0, 0, 99);
  const lamTot = clampCount(studentRow.praiseCounts?.lam_tot ?? 0, 0, 99);
  const stars = Math.max(0, Math.floor(studentRow.stars || 0));
  const medals = Math.max(0, Math.floor(studentRow.medals || 0));

  const diMuonCount =
    studentRow.attendanceStatus === "LATE"
      ? Math.max(1, clampCount(studentRow.issueCounts?.di_muon ?? 0, 0, 99))
      : clampCount(studentRow.issueCounts?.di_muon ?? 0, 0, 99);
  const noiChuyen = clampCount(studentRow.issueCounts?.noi_chuyen ?? 0, 0, 99);
  const khongChuY = clampCount(studentRow.issueCounts?.khong_chu_y ?? 0, 0, 99);
  const viecRieng = clampCount(studentRow.issueCounts?.viec_rieng ?? 0, 0, 99);
  const roiCho = clampCount(studentRow.issueCounts?.roi_cho ?? 0, 0, 99);
  const chuaBtvn = clampCount(studentRow.issueCounts?.chua_btvn ?? 0, 0, 99);

  const totalIssues = diMuonCount + noiChuyen + khongChuY + viecRieng + roiCho + chuaBtvn;
  const hasDistraction = noiChuyen + khongChuY + viecRieng + roiCho > 0;
  const hasMissingHw = chuaBtvn > 0;

  const selectedTags: string[] = [];
  if (isRobotics) {
    if (lamTot >= 1 || stars >= 2 || (totalIssues === 0 && medals === 0)) {
      selectedTags.push("🔧 Lắp ráp đúng mẫu");
    }
    if (lamTot >= 2 || stars >= 4) {
      selectedTags.push("💻 Lập trình chạy đúng");
    }
    if (medals >= 1 || (stars >= 5 && !hasDistraction)) {
      selectedTags.push("🧠 Chủ động thử & sửa lỗi");
    }
    if (phatBieu >= 1) {
      selectedTags.push("🤝 Hợp tác nhóm tốt");
    }
    if (hasDistraction) {
      selectedTags.push("👀 Cần nhắc tập trung");
    }
    if (selectedTags.length === 0) {
      selectedTags.push("🔧 Lắp ráp đúng mẫu");
    }
  } else {
    if (lamTot >= 1 || stars >= 2 || (totalIssues === 0 && medals === 0)) {
      selectedTags.push("✅ Tiếp thu tốt");
    }
    if (!hasMissingHw && (lamTot >= 1 || totalIssues === 0)) {
      selectedTags.push("📝 Làm bài tập đầy đủ");
    }
    if (phatBieu >= 1) {
      selectedTags.push("🙋 Hăng hái phát biểu");
    }
    if (medals >= 1 || (stars >= 5 && !hasDistraction)) {
      selectedTags.push("💡 Vận dụng & Sáng tạo tốt");
    }
    if (hasDistraction) {
      selectedTags.push("👀 Mất tập trung");
    }
    if (selectedTags.length === 0) {
      selectedTags.push("✅ Tiếp thu tốt");
    }
  }

  const praiseParts: string[] = [];
  if (phatBieu > 0) praiseParts.push(`phát biểu xây dựng bài (${phatBieu} lần)`);
  if (lamTot > 0) praiseParts.push(`hoàn thành tốt bài thực hành (${lamTot} lần)`);

  const noteSegments: string[] = [];
  if (praiseParts.length > 0) {
    let rewardSuffix = "";
    if (stars > 0 && medals > 0) {
      rewardSuffix = ` — đạt ${stars} sao (nhận Huy hiệu Top 3 học viên xuất sắc nhất lớp)`;
    } else if (stars > 0) {
      rewardSuffix = ` — đạt ${stars} sao`;
    } else if (medals > 0) {
      rewardSuffix = " — nhận Huy hiệu Top 3 học viên xuất sắc nhất lớp";
    }
    noteSegments.push(`Trong giờ: ${praiseParts.join(", ")}${rewardSuffix}.`);
  } else if (stars > 0 && medals > 0) {
    noteSegments.push(
      `Trong giờ: đạt ${stars} sao (nhận Huy hiệu Top 3 học viên xuất sắc nhất lớp).`
    );
  } else if (stars > 0) {
    noteSegments.push(`Trong giờ: đạt ${stars} sao thưởng tích cực.`);
  } else if (medals > 0) {
    noteSegments.push("Trong giờ: nhận Huy hiệu Top 3 học viên xuất sắc nhất lớp.");
  }

  const issueLines: string[] = [];
  for (const key of ISSUE_DISPLAY_ORDER) {
    const def = ISSUE_MAP.get(key);
    if (!def) continue;
    const cnt =
      key === "di_muon"
        ? diMuonCount
        : clampCount(studentRow.issueCounts?.[key] ?? 0, 0, 99);
    if (cnt <= 0) continue;
    const lineText =
      def.singleOccurrenceOmitsCount && cnt === 1
        ? capitalizeLeadingChar(def.summaryPhrase)
        : `${capitalizeLeadingChar(def.summaryPhrase)} (${cnt} lần)`;
    issueLines.push(`+ ${lineText}`);
  }
  if (issueLines.length > 0) {
    noteSegments.push(`Cần chấn chỉnh:\n${issueLines.join("\n")}`);
  }

  if (noteSegments.length === 0 && !customQuickNote) {
    noteSegments.push(
      "Tham gia buổi học đầy đủ, tập trung nghe giảng và thực hành nghiêm túc trên lớp."
    );
  }

  if (customQuickNote) {
    noteSegments.push(`Ghi chú riêng: ${appendSentencePeriod(customQuickNote)}`);
  }

  return {
    attendanceStatus: studentRow.attendanceStatus === "LATE" ? "LATE" : "PRESENT",
    quickTags: Array.from(new Set(selectedTags)),
    teacherNote: noteSegments.join("\n"),
  };
}
