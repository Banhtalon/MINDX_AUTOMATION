/**
 * MINDX AUTOMATION BOT - TEACHING REPORT CARD CALCULATOR (v3.3.0)
 * Pure mathematical & data-transformation engine matching 100% of
 * https://teachingmindx.top/diem-tong-ket.php formulas, rounding order,
 * A/B/C/D ranking rules, BTVN filtering, and Chart.js dataset generation.
 */

export interface ReportCardBtvnSessionMeta {
  sessionNumber: number;
  title: string;
  lessonId?: string;
  hasTheory: boolean;
  hasPractice: boolean;
  practiceTaskCount: number;
  maxTheoryScore: number;
  maxPracticeScore: number;
}

export interface StudentBtvnSessionRaw {
  sessionNumber: number;
  theoryRaw: number | null;
  theoryMax: number;
  theoryNote?: string;
  practiceRaw: number | null;
  practiceMax: number;
  practiceTask1Raw?: number | null;
  practiceTask2Raw?: number | null;
  practiceNote?: string;
}

export interface StudentStageRawScores {
  cp1Theory: number | null;
  cp1Practice: number | null;
  cp1Competency: number | null;
  cp1Note?: string;
  cp2Theory: number | null;
  cp2Practice: number | null;
  cp2Competency: number | null;
  cp2Note?: string;
  finalProduct: number | null;
  finalCompetency: number | null;
  finalNote?: string;
}

export interface StudentReportCardSnapshotItem {
  studentId: string;
  studentUid?: string;
  fullName: string;
  isActive: boolean;
  btvnScores: Record<number, StudentBtvnSessionRaw>;
  stageScores: StudentStageRawScores;
}

export interface ClassReportCardLmsSnapshot {
  classId: string;
  classCode: string;
  lmsClassId?: string;
  isRobotics: boolean;
  btvnSessions: ReportCardBtvnSessionMeta[];
  students: StudentReportCardSnapshotItem[];
  scrapedAt: string;
}

/**
 * Manual override entry stored per student and field key.
 * Field keys:
 * - `btvn_<sessionNumber>_theory` (stored as scale-5 normalized score 0..5, or rawScore with maxScore)
 * - `btvn_<sessionNumber>_practice` (stored as scale-5 normalized score 0..5, or rawScore with maxScore)
 * - `cp1_theory` | `cp1_practice` | `cp1_nang_luc` (scale 5: 0..5)
 * - `cp2_theory` | `cp2_practice` | `cp2_nang_luc` (scale 5: 0..5)
 * - `final_practice` | `final_nang_luc` (scale 5: 0..5)
 */
export interface ManualScoreOverrideEntry {
  studentId: string;
  fieldKey: string;
  normScore: number | null;
  rawScore?: number | null;
  maxScore?: number;
  note?: string;
  updatedAt: string;
}

export type ManualScoreOverrideMap = Record<string, ManualScoreOverrideEntry>;

export interface ComputedBtvnCell {
  sessionNumber: number;
  theoryRaw: number | null;
  theoryMax: number;
  theoryNorm: number | null;
  isTheoryLow: boolean;
  isTheoryOverridden: boolean;
  lmsTheoryNorm: number | null;
  lmsTheoryRaw: number | null;
  theoryNote: string;

  practiceRaw: number | null;
  practiceMax: number;
  practiceNorm: number | null;
  isPracticeLow: boolean;
  isPracticeOverridden: boolean;
  lmsPracticeNorm: number | null;
  lmsPracticeRaw: number | null;
  practiceTask1Raw: number | null;
  practiceTask2Raw: number | null;
  practiceNote: string;
}

export interface ComputedStageField {
  value: number | null;
  lmsValue: number | null;
  isOverridden: boolean;
  note: string;
}

export interface ComputedStudentReportCardRow {
  index: number;
  studentId: string;
  studentUid?: string;
  fullName: string;
  isActive: boolean;

  // Khối 1: BTVN
  btvnCells: Record<number, ComputedBtvnCell>;
  submittedCount: number;
  totalAssignedItems: number;
  btvnAvgNorm: number | null;
  btvnAvgRaw: number | null;
  isBtvnAvgLow: boolean;

  // Khối 2: CP1, CP2, Final DEMO, TBCK, Xếp loại, Hạng
  cp1: {
    theory: ComputedStageField;
    practice: ComputedStageField;
    competency: ComputedStageField;
    avgLtTh: number | null;
    total: number | null;
    chartAvg: number | null;
  };
  cp2: {
    theory: ComputedStageField;
    practice: ComputedStageField;
    competency: ComputedStageField;
    avgLtTh: number | null;
    total: number | null;
    chartAvg: number | null;
  };
  final: {
    product: ComputedStageField;
    competency: ComputedStageField;
    total: number | null;
    chartAvg: number | null;
  };
  avgCp1Cp2: number | null;
  tbck: number | null;
  isTbckLow: boolean;
  xepLoai: "Xuất sắc" | "Tốt" | "Đạt" | "Chưa đạt" | "";
  hang: "Hạng A" | "Hạng B" | "Hạng C" | "Hạng D" | "";
  rankCode: "A" | "B" | "C" | "D" | "";
  rowRankClass: "rank-a" | "rank-b" | "rank-c" | "rank-d" | "";
  hasMissingOrZeroComponent: boolean;
}

export interface ReportCardChartSeries {
  labels: string[];
  cp1: {
    lt: Array<number | null>;
    th: Array<number | null>;
    nl: Array<number | null>;
    avg: Array<number | null>;
  };
  cp2: {
    lt: Array<number | null>;
    th: Array<number | null>;
    nl: Array<number | null>;
    avg: Array<number | null>;
  };
  final: {
    sp: Array<number | null>;
    nl: Array<number | null>;
    avg: Array<number | null>;
  };
}

export interface ComputedClassReportCard {
  classId: string;
  classCode: string;
  isRobotics: boolean;
  showBtvnBlock: boolean;
  btvnSessions: ReportCardBtvnSessionMeta[];
  activeBtvnSessionNumbers: number[];
  students: ComputedStudentReportCardRow[];
  chartData: ReportCardChartSeries;
  scrapedAt: string;
}

/**
 * Standard base-10 half-up rounding to 2 decimal places, matching PHP `round($val, 2)`.
 * Uses base-10 exponent shifting after cleaning IEEE-754 representation noise at 1e-10
 * so values like `4.015` and `(80.30 / 100) * 5` deterministically round to `4.02`.
 */
export function round2(val: number): number {
  if (typeof val !== "number" || !Number.isFinite(val) || val === 0) return 0;
  const sign = val < 0 ? -1 : 1;
  const absClean = Number(Math.abs(val).toFixed(10));
  const rounded = Number(`${Math.round(Number(`${absClean}e2`))}e-2`);
  return sign * (rounded === 0 ? 0 : rounded);
}

/**
 * Formats a number to 2 decimal places (`4.00`, `3.75`) or returns `-` if null/undefined.
 */
export function formatScore2(val: number | null | undefined, emptyPlaceholder = "-"): string {
  if (val === null || val === undefined || !Number.isFinite(val)) {
    return emptyPlaceholder;
  }
  return val.toFixed(2);
}

/**
 * Normalizes a raw score (`0..maxScore`) to the Teaching 5-point scale (`0..5`).
 */
export function normalizeScoreToScale5(
  rawScore: number | null | undefined,
  maxScore = 100
): number | null {
  if (rawScore === null || rawScore === undefined || typeof rawScore !== "number" || !Number.isFinite(rawScore)) {
    return null;
  }
  const safeMax = typeof maxScore === "number" && Number.isFinite(maxScore) && maxScore > 0 ? maxScore : 100;
  const clampedRaw = Math.max(0, Math.min(safeMax, rawScore));
  return round2((clampedRaw / safeMax) * 5);
}

/**
 * Builds the canonical override key `${studentId}::${fieldKey}`.
 */
export function makeOverrideKey(studentId: string, fieldKey: string): string {
  return `${String(studentId || "").trim()}::${String(fieldKey || "").trim()}`;
}

/**
 * Validates a manual override field key.
 */
export function isValidOverrideFieldKey(fieldKey: string): boolean {
  const key = String(fieldKey || "").trim();
  if (
    key === "cp1_theory" ||
    key === "cp1_practice" ||
    key === "cp1_nang_luc" ||
    key === "cp2_theory" ||
    key === "cp2_practice" ||
    key === "cp2_nang_luc" ||
    key === "final_practice" ||
    key === "final_nang_luc"
  ) {
    return true;
  }
  const btvnMatch = key.match(/^btvn_(\d+)_(theory|practice)$/);
  if (btvnMatch) {
    const sessNum = parseInt(btvnMatch[1], 10);
    return Number.isInteger(sessNum) && sessNum >= 1 && sessNum <= 20;
  }
  return false;
}

/**
 * Computes Checkpoint 1 or Checkpoint 2 stage summary:
 * - `avgLtTh`: average of Theory (`lt`) and Practice (`th`) if both exist; otherwise whichever exists.
 * - `total`: `round2(0.4 * avgLtTh + 0.6 * nl)` (missing part treated as 0 if at least one score exists in the stage).
 * - `chartAvg`: simple arithmetic mean of available bars `round2(sum(lt, th, nl) / count)` matching Chart.js on Teaching.
 */
export function computeCheckpointStage(
  lt: number | null,
  th: number | null,
  nl: number | null
): {
  avgLtTh: number | null;
  total: number | null;
  chartAvg: number | null;
} {
  const hasLt = typeof lt === "number" && Number.isFinite(lt);
  const hasTh = typeof th === "number" && Number.isFinite(th);
  const hasNl = typeof nl === "number" && Number.isFinite(nl);

  if (!hasLt && !hasTh && !hasNl) {
    return { avgLtTh: null, total: null, chartAvg: null };
  }

  let avgLtTh: number | null = null;
  if (hasLt && hasTh) {
    avgLtTh = (lt! + th!) / 2;
  } else if (hasLt) {
    avgLtTh = lt!;
  } else if (hasTh) {
    avgLtTh = th!;
  }

  const partLtTh = avgLtTh !== null ? 0.4 * avgLtTh : 0;
  const partNl = hasNl ? 0.6 * nl! : 0;
  const total = round2(partLtTh + partNl);

  const avail = [hasLt ? lt! : null, hasTh ? th! : null, hasNl ? nl! : null].filter(
    (v): v is number => v !== null
  );
  const chartAvg = avail.length > 0 ? round2(avail.reduce((s, v) => s + v, 0) / avail.length) : null;

  return {
    avgLtTh: avgLtTh !== null ? round2(avgLtTh) : null,
    total,
    chartAvg,
  };
}

/**
 * Computes Final (DEMO) stage summary:
 * - `total`: `round2(0.6 * sp + 0.4 * nl)`
 * - `chartAvg`: simple arithmetic mean `round2(sum(sp, nl) / count)` matching Chart.js on Teaching.
 */
export function computeFinalStage(
  sp: number | null,
  nl: number | null
): {
  total: number | null;
  chartAvg: number | null;
} {
  const hasSp = typeof sp === "number" && Number.isFinite(sp);
  const hasNl = typeof nl === "number" && Number.isFinite(nl);

  if (!hasSp && !hasNl) {
    return { total: null, chartAvg: null };
  }

  const partSp = hasSp ? 0.6 * sp! : 0;
  const partNl = hasNl ? 0.4 * nl! : 0;
  const total = round2(partSp + partNl);

  const avail = [hasSp ? sp! : null, hasNl ? nl! : null].filter((v): v is number => v !== null);
  const chartAvg = avail.length > 0 ? round2(avail.reduce((s, v) => s + v, 0) / avail.length) : null;

  return { total, chartAvg };
}

/**
 * Computes `TBCK`, `Xếp loại`, `Hạng` (`A/B/C/D`), and row CSS class (`rank-a..d`)
 * using the already-rounded `totalCP1`, `totalCP2`, `totalFinal` values (matching Teaching PHP logic).
 */
export function computeOverallSummary(params: {
  totalCP1: number | null;
  totalCP2: number | null;
  totalFinal: number | null;
  cp1Theory: number | null;
  cp1Practice: number | null;
  cp1Competency: number | null;
  cp2Theory: number | null;
  cp2Practice: number | null;
  cp2Competency: number | null;
  finalProduct: number | null;
  finalCompetency: number | null;
}): {
  avgCp1Cp2: number | null;
  tbck: number | null;
  isTbckLow: boolean;
  xepLoai: "Xuất sắc" | "Tốt" | "Đạt" | "Chưa đạt" | "";
  hang: "Hạng A" | "Hạng B" | "Hạng C" | "Hạng D" | "";
  rankCode: "A" | "B" | "C" | "D" | "";
  rowRankClass: "rank-a" | "rank-b" | "rank-c" | "rank-d" | "";
  hasMissingOrZeroComponent: boolean;
} {
  const {
    totalCP1,
    totalCP2,
    totalFinal,
    cp1Theory,
    cp1Practice,
    cp1Competency,
    cp2Theory,
    cp2Practice,
    cp2Competency,
    finalProduct,
    finalCompetency,
  } = params;

  const hasCp1 = typeof totalCP1 === "number" && Number.isFinite(totalCP1);
  const hasCp2 = typeof totalCP2 === "number" && Number.isFinite(totalCP2);
  const hasFinal = typeof totalFinal === "number" && Number.isFinite(totalFinal);

  const allComponents = [
    cp1Theory,
    cp1Practice,
    cp1Competency,
    cp2Theory,
    cp2Practice,
    cp2Competency,
    finalProduct,
    finalCompetency,
  ];
  const hasMissingOrZeroComponent = allComponents.some(
    (v) => v === null || v === undefined || typeof v !== "number" || !Number.isFinite(v) || v <= 0
  );

  // Edge Case 2: Student has no evaluation scores across all 3 stages -> leave TBCK/Rank blank
  if (!hasCp1 && !hasCp2 && !hasFinal) {
    return {
      avgCp1Cp2: null,
      tbck: null,
      isTbckLow: false,
      xepLoai: "",
      hang: "",
      rankCode: "",
      rowRankClass: "",
      hasMissingOrZeroComponent: true,
    };
  }

  let avgCp1Cp2: number | null = null;
  if (hasCp1 && hasCp2) {
    avgCp1Cp2 = (totalCP1! + totalCP2!) / 2;
  } else if (hasCp1) {
    avgCp1Cp2 = totalCP1!;
  } else if (hasCp2) {
    avgCp1Cp2 = totalCP2!;
  }

  // Edge Case 1: TBCK uses the already-rounded stage totals
  const cpPart = avgCp1Cp2 !== null ? 0.4 * avgCp1Cp2 : 0;
  const finalPart = hasFinal ? 0.6 * totalFinal! : 0;
  const tbck = round2(cpPart + finalPart);
  const isTbckLow = tbck < 2.5;

  let xepLoai: "Xuất sắc" | "Tốt" | "Đạt" | "Chưa đạt" = "Chưa đạt";
  let hang: "Hạng A" | "Hạng B" | "Hạng C" | "Hạng D" = "Hạng D";
  let rankCode: "A" | "B" | "C" | "D" = "D";
  let rowRankClass: "rank-a" | "rank-b" | "rank-c" | "rank-d" = "rank-d";

  if (tbck >= 4.5 && !hasMissingOrZeroComponent) {
    xepLoai = "Xuất sắc";
    hang = "Hạng A";
    rankCode = "A";
    rowRankClass = "rank-a";
  } else if (tbck >= 4.0 && !hasMissingOrZeroComponent) {
    xepLoai = "Tốt";
    hang = "Hạng B";
    rankCode = "B";
    rowRankClass = "rank-b";
  } else if (tbck >= 2.5) {
    xepLoai = "Đạt";
    hang = "Hạng C";
    rankCode = "C";
    rowRankClass = "rank-c";
  } else {
    xepLoai = "Chưa đạt";
    hang = "Hạng D";
    rankCode = "D";
    rowRankClass = "rank-d";
  }

  return {
    avgCp1Cp2: avgCp1Cp2 !== null ? round2(avgCp1Cp2) : null,
    tbck,
    isTbckLow,
    xepLoai,
    hang,
    rankCode,
    rowRankClass,
    hasMissingOrZeroComponent,
  };
}

/**
 * Computes the complete Report Card for a class, merging the LMS snapshot with teacher manual overrides.
 */
export function computeClassReportCard(
  snapshot: ClassReportCardLmsSnapshot,
  manualOverrides: ManualScoreOverrideMap = {},
  options?: {
    selectedBtvnSessions?: number[];
    includeInactiveStudents?: boolean;
  }
): ComputedClassReportCard {
  const btvnSessions = [...(snapshot.btvnSessions || [])].sort(
    (a, b) => a.sessionNumber - b.sessionNumber
  );
  const showBtvnBlock = !snapshot.isRobotics && btvnSessions.length > 0;

  const activeBtvnSessionNumbers =
    options?.selectedBtvnSessions && options.selectedBtvnSessions.length > 0
      ? btvnSessions
          .map((s) => s.sessionNumber)
          .filter((num) => options.selectedBtvnSessions!.includes(num))
      : btvnSessions.map((s) => s.sessionNumber);

  const activeSessionSet = new Set<number>(activeBtvnSessionNumbers);

  const filteredStudents = (snapshot.students || []).filter((stu) =>
    options?.includeInactiveStudents ? true : stu.isActive !== false
  );

  const computedStudents: ComputedStudentReportCardRow[] = filteredStudents.map((stu, idx) => {
    const btvnCells: Record<number, ComputedBtvnCell> = {};
    let submittedCount = 0;
    let totalAssignedItems = 0;
    let normSum = 0;
    let rawSum = 0;

    for (const sess of btvnSessions) {
      const sNum = sess.sessionNumber;
      const rawEntry = stu.btvnScores?.[sNum];
      const lmsTheoryMax = rawEntry?.theoryMax || sess.maxTheoryScore || 100;
      const lmsPracticeMax = rawEntry?.practiceMax || sess.maxPracticeScore || 100;

      const lmsTheoryRaw =
        rawEntry && typeof rawEntry.theoryRaw === "number" && Number.isFinite(rawEntry.theoryRaw)
          ? round2(rawEntry.theoryRaw)
          : null;
      const lmsTheoryNorm = normalizeScoreToScale5(lmsTheoryRaw, lmsTheoryMax);

      const lmsPracticeRaw =
        rawEntry && typeof rawEntry.practiceRaw === "number" && Number.isFinite(rawEntry.practiceRaw)
          ? round2(rawEntry.practiceRaw)
          : null;
      const lmsPracticeNorm = normalizeScoreToScale5(lmsPracticeRaw, lmsPracticeMax);

      const theoryOverride = manualOverrides[makeOverrideKey(stu.studentId, `btvn_${sNum}_theory`)];
      const practiceOverride = manualOverrides[makeOverrideKey(stu.studentId, `btvn_${sNum}_practice`)];

      let theoryNorm = lmsTheoryNorm;
      let theoryRaw = lmsTheoryRaw;
      let theoryMax = lmsTheoryMax;
      let isTheoryOverridden = false;
      let theoryNote = rawEntry?.theoryNote || "";

      if (theoryOverride !== undefined) {
        isTheoryOverridden = true;
        theoryMax =
          typeof theoryOverride.maxScore === "number" &&
          Number.isFinite(theoryOverride.maxScore) &&
          theoryOverride.maxScore > 0
            ? theoryOverride.maxScore
            : lmsTheoryMax || 100;
        if (theoryOverride.normScore === null) {
          theoryNorm = null;
          theoryRaw = null;
        } else if (typeof theoryOverride.normScore === "number" && Number.isFinite(theoryOverride.normScore)) {
          theoryNorm = round2(Math.max(0, Math.min(5, theoryOverride.normScore)));
          const hasConsistentRaw =
            typeof theoryOverride.rawScore === "number" &&
            Number.isFinite(theoryOverride.rawScore) &&
            theoryOverride.rawScore >= 0 &&
            theoryOverride.rawScore <= theoryMax &&
            normalizeScoreToScale5(theoryOverride.rawScore, theoryMax) === theoryNorm;
          theoryRaw = hasConsistentRaw
            ? round2(theoryOverride.rawScore!)
            : round2((theoryNorm / 5) * theoryMax);
        }
        if (theoryOverride.note !== undefined) {
          theoryNote = theoryOverride.note;
        }
      }

      let practiceNorm = lmsPracticeNorm;
      let practiceRaw = lmsPracticeRaw;
      let practiceMax = lmsPracticeMax;
      let isPracticeOverridden = false;
      let practiceNote = rawEntry?.practiceNote || "";

      if (practiceOverride !== undefined) {
        isPracticeOverridden = true;
        practiceMax =
          typeof practiceOverride.maxScore === "number" &&
          Number.isFinite(practiceOverride.maxScore) &&
          practiceOverride.maxScore > 0
            ? practiceOverride.maxScore
            : lmsPracticeMax || 100;
        if (practiceOverride.normScore === null) {
          practiceNorm = null;
          practiceRaw = null;
        } else if (
          typeof practiceOverride.normScore === "number" &&
          Number.isFinite(practiceOverride.normScore)
        ) {
          practiceNorm = round2(Math.max(0, Math.min(5, practiceOverride.normScore)));
          const hasConsistentRaw =
            typeof practiceOverride.rawScore === "number" &&
            Number.isFinite(practiceOverride.rawScore) &&
            practiceOverride.rawScore >= 0 &&
            practiceOverride.rawScore <= practiceMax &&
            normalizeScoreToScale5(practiceOverride.rawScore, practiceMax) === practiceNorm;
          practiceRaw = hasConsistentRaw
            ? round2(practiceOverride.rawScore!)
            : round2((practiceNorm / 5) * practiceMax);
        }
        if (practiceOverride.note !== undefined) {
          practiceNote = practiceOverride.note;
        }
      }

      const cell: ComputedBtvnCell = {
        sessionNumber: sNum,
        theoryRaw,
        theoryMax,
        theoryNorm,
        isTheoryLow: theoryNorm !== null && theoryNorm < 2.5,
        isTheoryOverridden,
        lmsTheoryNorm,
        lmsTheoryRaw,
        theoryNote,

        practiceRaw,
        practiceMax,
        practiceNorm,
        isPracticeLow: practiceNorm !== null && practiceNorm < 2.5,
        isPracticeOverridden,
        lmsPracticeNorm,
        lmsPracticeRaw,
        practiceTask1Raw:
          rawEntry && typeof rawEntry.practiceTask1Raw === "number"
            ? round2(rawEntry.practiceTask1Raw)
            : null,
        practiceTask2Raw:
          rawEntry && typeof rawEntry.practiceTask2Raw === "number"
            ? round2(rawEntry.practiceTask2Raw)
            : null,
        practiceNote,
      };

      btvnCells[sNum] = cell;

      if (showBtvnBlock && activeSessionSet.has(sNum)) {
        if (sess.hasTheory) {
          totalAssignedItems++;
          if (theoryNorm !== null && theoryRaw !== null) {
            submittedCount++;
            normSum += theoryNorm;
            rawSum += theoryRaw;
          }
        }
        if (sess.hasPractice) {
          totalAssignedItems++;
          if (practiceNorm !== null && practiceRaw !== null) {
            submittedCount++;
            normSum += practiceNorm;
            rawSum += practiceRaw;
          }
        }
      }
    }

    const btvnAvgNorm = submittedCount > 0 ? round2(normSum / submittedCount) : null;
    const btvnAvgRaw = submittedCount > 0 ? round2(rawSum / submittedCount) : null;
    const isBtvnAvgLow = btvnAvgNorm !== null && btvnAvgNorm < 2.5;

    // Helper for stage fields (scale 5: 0..5)
    const resolveStageField = (
      fieldKey: string,
      lmsVal: number | null | undefined,
      defaultNote = ""
    ): ComputedStageField => {
      const cleanLms =
        typeof lmsVal === "number" && Number.isFinite(lmsVal)
          ? round2(Math.max(0, Math.min(5, lmsVal)))
          : null;
      const ov = manualOverrides[makeOverrideKey(stu.studentId, fieldKey)];
      if (ov !== undefined) {
        const cleanOv =
          ov.normScore === null
            ? null
            : typeof ov.normScore === "number" && Number.isFinite(ov.normScore)
            ? round2(Math.max(0, Math.min(5, ov.normScore)))
            : cleanLms;
        return {
          value: cleanOv,
          lmsValue: cleanLms,
          isOverridden: true,
          note: ov.note !== undefined ? ov.note : defaultNote,
        };
      }
      return {
        value: cleanLms,
        lmsValue: cleanLms,
        isOverridden: false,
        note: defaultNote,
      };
    };

    const stg = stu.stageScores || {
      cp1Theory: null,
      cp1Practice: null,
      cp1Competency: null,
      cp2Theory: null,
      cp2Practice: null,
      cp2Competency: null,
      finalProduct: null,
      finalCompetency: null,
    };

    const cp1Theory = resolveStageField("cp1_theory", stg.cp1Theory);
    const cp1Practice = resolveStageField("cp1_practice", stg.cp1Practice);
    const cp1Competency = resolveStageField("cp1_nang_luc", stg.cp1Competency);
    const cp1Calc = computeCheckpointStage(
      cp1Theory.value,
      cp1Practice.value,
      cp1Competency.value
    );

    const cp2Theory = resolveStageField("cp2_theory", stg.cp2Theory);
    const cp2Practice = resolveStageField("cp2_practice", stg.cp2Practice);
    const cp2Competency = resolveStageField("cp2_nang_luc", stg.cp2Competency);
    const cp2Calc = computeCheckpointStage(
      cp2Theory.value,
      cp2Practice.value,
      cp2Competency.value
    );

    const finalProduct = resolveStageField("final_practice", stg.finalProduct);
    const finalCompetency = resolveStageField("final_nang_luc", stg.finalCompetency);
    const finalCalc = computeFinalStage(finalProduct.value, finalCompetency.value);

    const overall = computeOverallSummary({
      totalCP1: cp1Calc.total,
      totalCP2: cp2Calc.total,
      totalFinal: finalCalc.total,
      cp1Theory: cp1Theory.value,
      cp1Practice: cp1Practice.value,
      cp1Competency: cp1Competency.value,
      cp2Theory: cp2Theory.value,
      cp2Practice: cp2Practice.value,
      cp2Competency: cp2Competency.value,
      finalProduct: finalProduct.value,
      finalCompetency: finalCompetency.value,
    });

    return {
      index: idx + 1,
      studentId: stu.studentId,
      studentUid: stu.studentUid,
      fullName: stu.fullName,
      isActive: stu.isActive,
      btvnCells,
      submittedCount,
      totalAssignedItems,
      btvnAvgNorm,
      btvnAvgRaw,
      isBtvnAvgLow,
      cp1: {
        theory: cp1Theory,
        practice: cp1Practice,
        competency: cp1Competency,
        avgLtTh: cp1Calc.avgLtTh,
        total: cp1Calc.total,
        chartAvg: cp1Calc.chartAvg,
      },
      cp2: {
        theory: cp2Theory,
        practice: cp2Practice,
        competency: cp2Competency,
        avgLtTh: cp2Calc.avgLtTh,
        total: cp2Calc.total,
        chartAvg: cp2Calc.chartAvg,
      },
      final: {
        product: finalProduct,
        competency: finalCompetency,
        total: finalCalc.total,
        chartAvg: finalCalc.chartAvg,
      },
      avgCp1Cp2: overall.avgCp1Cp2,
      tbck: overall.tbck,
      isTbckLow: overall.isTbckLow,
      xepLoai: overall.xepLoai,
      hang: overall.hang,
      rankCode: overall.rankCode,
      rowRankClass: overall.rowRankClass,
      hasMissingOrZeroComponent: overall.hasMissingOrZeroComponent,
    };
  });

  const chartData: ReportCardChartSeries = {
    labels: computedStudents.map((s) => s.fullName),
    cp1: {
      lt: computedStudents.map((s) => s.cp1.theory.value),
      th: computedStudents.map((s) => s.cp1.practice.value),
      nl: computedStudents.map((s) => s.cp1.competency.value),
      avg: computedStudents.map((s) => s.cp1.chartAvg),
    },
    cp2: {
      lt: computedStudents.map((s) => s.cp2.theory.value),
      th: computedStudents.map((s) => s.cp2.practice.value),
      nl: computedStudents.map((s) => s.cp2.competency.value),
      avg: computedStudents.map((s) => s.cp2.chartAvg),
    },
    final: {
      sp: computedStudents.map((s) => s.final.product.value),
      nl: computedStudents.map((s) => s.final.competency.value),
      avg: computedStudents.map((s) => s.final.chartAvg),
    },
  };

  return {
    classId: snapshot.classId,
    classCode: snapshot.classCode,
    isRobotics: snapshot.isRobotics,
    showBtvnBlock,
    btvnSessions,
    activeBtvnSessionNumbers,
    students: computedStudents,
    chartData,
    scrapedAt: snapshot.scrapedAt,
  };
}
