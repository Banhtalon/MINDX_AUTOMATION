import { detectTrackByClassCode } from "@/lib/quick-tags";

export type ClassroomPraiseKey = "phat_bieu" | "lam_tot" | "huy_hieu";
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
    label: "Huy hiệu",
    icon: "🏅",
    starDelta: 0,
    medalDelta: 1,
    summaryPhrase: "nhận huy hiệu tuyên dương",
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
  praiseCounts: Partial<Record<ClassroomPraiseKey, number>>;
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
    medals: Math.max(
      0,
      Math.min(999, Math.floor(state.medals || 0) + def.medalDelta * actualDelta)
    ),
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
 * Toggles or sets attendance status and keeps `di_muon` counter synchronized.
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

  return {
    ...state,
    attendanceStatus: nextStatus,
    issueCounts: nextIssueCounts,
  };
}

/**
 * Ranks students for the horizontal classroom projector mode.
 * Explicitly excludes all violation counts, late tags, and teacher private notes.
 */
export function rankStudentsForProjector(
  rows: ClassroomStudentState[]
): ClassroomProjectorRow[] {
  const sorted = [...rows].sort((a, b) => {
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
 */
export function computeCourseAccumulationSummary(
  students: Array<{ studentId: string; fullName: string }>,
  allLogs: Array<{
    studentId: string;
    sessionNumber: number;
    attendanceStatus: string;
    stars: number;
    medals: number;
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

  for (const log of allLogs || []) {
    const sid = String(log.studentId || "").trim();
    const sessNum = Math.floor(Number(log.sessionNumber || 0));
    if (!sid || sessNum < 1 || sessNum > 14) continue;
    let acc = byStudent.get(sid);
    if (!acc) {
      acc = {
        totalStars: 0,
        totalMedals: 0,
        attendedSet: new Set(),
        lateSet: new Set(),
        absentSet: new Set(),
      };
      byStudent.set(sid, acc);
    }
    const status = String(log.attendanceStatus || "PRESENT").trim().toUpperCase();
    if (status === "ABSENT") {
      acc.absentSet.add(sessNum);
      continue;
    }
    acc.attendedSet.add(sessNum);
    if (status === "LATE") acc.lateSet.add(sessNum);
    acc.totalStars += Math.max(0, Math.floor(Number(log.stars || 0)));
    acc.totalMedals += Math.max(0, Math.floor(Number(log.medals || 0)));
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

  for (const row of rows) {
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
    totalStudents: rows.length,
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

/**
 * Maps in-class behavior logs into `/session-comments` attendance, Quick Tags (Coding / Robotics),
 * and a clear, natural `teacherNote` string for the teacher's comment box.
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
    if (medals >= 1 || stars >= 5) {
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
    if (medals >= 1 || stars >= 5) {
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

  const rewardSummaryParts: string[] = [];
  if (stars > 0) rewardSummaryParts.push(`${stars} sao`);
  if (medals > 0) rewardSummaryParts.push(`${medals} huy hiệu`);

  const noteSegments: string[] = [];
  if (praiseParts.length > 0) {
    const rewardSuffix =
      rewardSummaryParts.length > 0 ? ` — đạt ${rewardSummaryParts.join(", ")}` : "";
    noteSegments.push(`Trong giờ: ${praiseParts.join(", ")}${rewardSuffix}.`);
  } else if (rewardSummaryParts.length > 0) {
    noteSegments.push(`Đạt ${rewardSummaryParts.join(", ")} thưởng trong giờ.`);
  }

  const issueParts: string[] = [];
  for (const def of CLASSROOM_ISSUE_ITEMS) {
    const cnt =
      def.key === "di_muon"
        ? diMuonCount
        : clampCount(studentRow.issueCounts?.[def.key] ?? 0, 0, 99);
    if (cnt <= 0) continue;
    if (def.singleOccurrenceOmitsCount && cnt === 1) {
      issueParts.push(def.summaryPhrase);
    } else {
      issueParts.push(`${def.summaryPhrase} (${cnt} lần)`);
    }
  }
  if (issueParts.length > 0) {
    noteSegments.push(`Cần lưu ý: ${issueParts.join(", ")}.`);
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
    teacherNote: noteSegments.join(" "),
  };
}
