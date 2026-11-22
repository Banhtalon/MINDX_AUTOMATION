/**
 * MINDX AUTOMATION BOT - SESSION 14 DEMO SCORE & COMPETENCY READER (v2.9.0)
 * Reads graded "Bảng chấm điểm buổi Demo" (.xlsx local file or Google Sheet URL),
 * matches each worksheet tab / cell B2 ("Họ và tên Học viên:") to the class roster,
 * extracts the 5 Demo Score criteria (max 5.0 points total) + Judge comments (BGK1/BGK2),
 * and suggests the 9 [ĐNL] Competency ratings (scale 1..5, average rounded to 2 decimals).
 */

import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import {
  calculateCompetencyAverageScore,
  calculateDemoTotalScore,
  computeSession14AwardRankingsPure,
  formatRawDemoScore3dp,
  getDb,
  getSession14DemoLimitsForClass,
  isCsiClassCode,
  isDefaultSpckProductTitle,
  isRoboticsClassCode,
  parseSession14CompetencyScores,
  parseSession14DemoScores,
  SESSION14_COMPETENCY_KEYS,
  type Session14AwardRankItem,
  type Session14ClassSummaryRecord,
  session14ClassSummaryRepo,
  session14EvalRepo,
  sessionFeedbackRepo,
  spckSessionRepo,
  type SpckSession14CompetencyScores,
  type SpckSession14DemoScores,
  type SpckSession14EvaluationRecord,
  spckUploadRepo,
  stripSpckSessionSuffix,
  studentRepo,
} from "../db/sqlite";
import { authService } from "../playwright/auth";
import { browserManager } from "../playwright/browser-manager";
import { LmsHelpers } from "../playwright/lms-helpers";
import { SELECTORS } from "../playwright/selectors";
import {
  exportGoogleSheetBufferViaBrowser,
  extractGoogleSheetId,
  getDemoSheetTitleForClass,
} from "../playwright/spck-demo-sheet";
import { taskQueue } from "../queue/task-queue";
import { assertPathAllowed } from "../security/path-allowlist";
import {
  detectSpckCourseProfile,
  isPresentationQuickTag,
  suggestSession14PresentationTagFromDemoScore,
} from "../spck/spck-quick-tags";
import { normalizeVietnameseName } from "../utils/vietnamese-match";

import {
  COMPETENCY_AREA_SPECS,
  type CompetencyAreaSpec,
} from "../checkpoint/competency-specs";

export {
  formatRawDemoScore3dp,
  type Session14AwardRankItem,
  type Session14ClassSummaryRecord,
};

export const computeClassDemoAwardRankings = computeSession14AwardRankingsPure;

export type Session14CompetencyAreaSpec = CompetencyAreaSpec;

/**
 * Exact 9 `[ĐNL]` Competency Criteria ordered strictly by MindX LMS Modal Cột 2 `DOM[0..8]`.
 */
export const SESSION14_COMPETENCY_AREA_SPECS: readonly Session14CompetencyAreaSpec[] =
  COMPETENCY_AREA_SPECS;

export interface StudentCheckpointCompetencyResult {
  matchedFromCheckpoints: boolean;
  sourceType:
    | "CHECKPOINT_BOTH"
    | "CHECKPOINT_CP1_ONLY"
    | "CHECKPOINT_CP2_ONLY"
    | "NO_CHECKPOINT_DATA";
  cp1SlotNumber: number;
  cp2SlotNumber: number;
  cp1Avg: number | null;
  cp2Avg: number | null;
  targetAvg: number | null;
  competencyScores: SpckSession14CompetencyScores;
  competencyTotalScore: number;
  ratingsInDomOrder: number[];
  perCriterion: Array<{
    domIndex: number;
    key: keyof SpckSession14CompetencyScores;
    commentAreaId: string;
    cp1Grade: number | null;
    cp2Grade: number | null;
    rawAverage: number;
    finalRating: number;
  }>;
}

function matchCommentAreaSpecIndex(rawAreaItem: any): number {
  if (!rawAreaItem || typeof rawAreaItem !== "object") return -1;
  const rawType = String(rawAreaItem.type ?? rawAreaItem.commentArea?.type ?? "")
    .trim()
    .toUpperCase();
  if (rawType && rawType !== "RATE") return -1;

  const rawId = String(
    rawAreaItem.commentAreaId ??
      rawAreaItem.areaId ??
      rawAreaItem.commentArea?.id ??
      rawAreaItem.commentArea?._id ??
      rawAreaItem.id ??
      ""
  )
    .trim()
    .toLowerCase();

  if (rawId) {
    const byId = SESSION14_COMPETENCY_AREA_SPECS.findIndex(
      (spec) =>
        rawId === spec.commentAreaId.toLowerCase() ||
        rawId.endsWith(spec.commentAreaSuffix.toLowerCase())
    );
    if (byId >= 0) return byId;
  }

  const rawLabel = normalizeVietnameseName(
    String(
      rawAreaItem.name ??
        rawAreaItem.title ??
        rawAreaItem.label ??
        rawAreaItem.commentArea?.name ??
        rawAreaItem.commentArea?.title ??
        ""
    )
  );
  if (rawLabel) {
    const byKeyword = SESSION14_COMPETENCY_AREA_SPECS.findIndex((spec) =>
      spec.keywordsNorm.some((kw) => rawLabel.includes(kw))
    );
    if (byKeyword >= 0) return byKeyword;
  }

  return -1;
}

function extractGradesInDomOrder(commentByAreas: unknown): Array<number | null> {
  const grades: Array<number | null> = Array(9).fill(null);
  if (!Array.isArray(commentByAreas)) return grades;

  for (const item of commentByAreas) {
    const specIdx = matchCommentAreaSpecIndex(item);
    if (specIdx < 0 || specIdx >= 9) continue;
    const rawGrade = Number(
      item?.grade ?? item?.score ?? item?.rating ?? item?.value ?? NaN
    );
    if (Number.isFinite(rawGrade) && rawGrade >= 1 && rawGrade <= 5) {
      grades[specIdx] = Math.round(rawGrade);
    }
  }
  return grades;
}

function findStudentAttendanceInSlot(
  slotObj: any,
  studentId?: string,
  fullName?: string
): any | null {
  if (!slotObj || typeof slotObj !== "object") return null;
  const list = Array.isArray(slotObj.studentAttendance)
    ? slotObj.studentAttendance
    : Array.isArray(slotObj.studentAttendances)
    ? slotObj.studentAttendances
    : Array.isArray(slotObj.attendances)
    ? slotObj.attendances
    : Array.isArray(slotObj.studentReviews)
    ? slotObj.studentReviews
    : Array.isArray(slotObj.reviews)
    ? slotObj.reviews
    : Array.isArray(slotObj.students)
    ? slotObj.students
    : [];
  if (list.length === 0) return null;

  const targetSid = String(studentId || "").trim();
  if (targetSid) {
    const byId = list.find((att: any) => {
      const candId = String(
        att?.student?.id ?? att?.student?._id ?? att?.studentId ?? att?.id ?? ""
      ).trim();
      return candId !== "" && candId === targetSid;
    });
    if (byId) return byId;
  }

  const normTargetName = normalizeVietnameseName(fullName || "");
  if (normTargetName) {
    const byName = list.filter((att: any) => {
      const candName = normalizeVietnameseName(
        String(att?.student?.fullName ?? att?.fullName ?? att?.studentName ?? "")
      );
      return candName !== "" && candName === normTargetName;
    });
    if (byName.length === 1) return byName[0];
  }
  return null;
}

function resolveCheckpointSlotFromArray(slots: any[] | undefined, slotNumber1Based: number): any | null {
  if (!Array.isArray(slots) || slots.length === 0) return null;
  const hasAnyExplicitNumber = slots.some(
    (s) =>
      s &&
      typeof s === "object" &&
      (s.slotNumber !== undefined ||
        s.sessionNumber !== undefined ||
        s.index !== undefined ||
        s.slotIdx !== undefined)
  );
  const explicitByNumber = slots.find(
    (s) =>
      s &&
      typeof s === "object" &&
      (Number(s.slotNumber) === slotNumber1Based ||
        Number(s.sessionNumber) === slotNumber1Based ||
        Number(s.index) === slotNumber1Based - 1 ||
        Number(s.slotIdx) === slotNumber1Based - 1)
  );
  if (explicitByNumber) return explicitByNumber;
  if (hasAnyExplicitNumber) return null;
  return slots[slotNumber1Based - 1] ?? null;
}

/**
 * Pure deterministic calculator for Session 14's 9 `[ĐNL]` Competency radio ratings (`1..5`)
 * from Checkpoint 1 & Checkpoint 2 (`B5 & B9` for Coding; `B4 & B8` for Robotics).
 * Handles:
 * - Reordered `commentByAreas` arrays (matched strictly by `commentAreaId` / normalized name to `DOM[0..8]`)
 * - Missing/0/null single `RATE` cells in one checkpoint (inherits exact rating from the other checkpoint)
 * - Student absent from an entire checkpoint (inherits full ratings from the attended checkpoint)
 * - Smart alternating `.5` rounding (`bestK` minimizing `|sum/9 - targetAvg|`, prioritizing improved `CP2 > CP1` criteria)
 */
export function computeSession14CompetencyFromCheckpoints(params: {
  classId?: string | null;
  studentId?: string;
  fullName?: string;
  slots?: any[];
  checkpointSlots?: any[];
  cp1Slot?: any;
  cp2Slot?: any;
  cp1CommentByAreas?: any[];
  cp2CommentByAreas?: any[];
}): StudentCheckpointCompetencyResult {
  const isRobotics = isRoboticsClassCode(params.classId);
  const cp1SlotNumber = isRobotics ? 4 : 5;
  const cp2SlotNumber = isRobotics ? 8 : 9;
  const slotArray = params.slots ?? params.checkpointSlots;

  const resolvedCp1Slot =
    params.cp1Slot ?? resolveCheckpointSlotFromArray(slotArray, cp1SlotNumber);
  const resolvedCp2Slot =
    params.cp2Slot ?? resolveCheckpointSlotFromArray(slotArray, cp2SlotNumber);

  let cp1Areas = params.cp1CommentByAreas;
  if (!cp1Areas && resolvedCp1Slot) {
    const att1 = findStudentAttendanceInSlot(
      resolvedCp1Slot,
      params.studentId,
      params.fullName
    );
    const status1 = String(att1?.status ?? att1?.attendanceStatus ?? "").toUpperCase();
    if (att1 && status1 !== "ABSENT" && status1 !== "UNEXCUSED_ABSENT") {
      cp1Areas = att1.commentByAreas;
    } else if (att1 && Array.isArray(att1.commentByAreas)) {
      // Even if status string varies, extractGradesInDomOrder safely ignores empty/0 grades
      cp1Areas = att1.commentByAreas;
    }
  }

  let cp2Areas = params.cp2CommentByAreas;
  if (!cp2Areas && resolvedCp2Slot) {
    const att2 = findStudentAttendanceInSlot(
      resolvedCp2Slot,
      params.studentId,
      params.fullName
    );
    const status2 = String(att2?.status ?? att2?.attendanceStatus ?? "").toUpperCase();
    if (att2 && status2 !== "ABSENT" && status2 !== "UNEXCUSED_ABSENT") {
      cp2Areas = att2.commentByAreas;
    } else if (att2 && Array.isArray(att2.commentByAreas)) {
      cp2Areas = att2.commentByAreas;
    }
  }

  const g1 = extractGradesInDomOrder(cp1Areas);
  const g2 = extractGradesInDomOrder(cp2Areas);

  const valid1 = g1.filter((v): v is number => v !== null);
  const valid2 = g2.filter((v): v is number => v !== null);

  if (valid1.length === 0 && valid2.length === 0) {
    const fallbackScores = parseSession14CompetencyScores(undefined);
    return {
      matchedFromCheckpoints: false,
      sourceType: "NO_CHECKPOINT_DATA",
      cp1SlotNumber,
      cp2SlotNumber,
      cp1Avg: null,
      cp2Avg: null,
      targetAvg: null,
      competencyScores: fallbackScores,
      competencyTotalScore: calculateCompetencyAverageScore(fallbackScores),
      ratingsInDomOrder: SESSION14_COMPETENCY_KEYS.map((k) => fallbackScores[k]),
      perCriterion: SESSION14_COMPETENCY_AREA_SPECS.map((spec) => ({
        domIndex: spec.domIndex,
        key: spec.key,
        commentAreaId: spec.commentAreaId,
        cp1Grade: null,
        cp2Grade: null,
        rawAverage: 4,
        finalRating: 4,
      })),
    };
  }

  const cp1Avg =
    valid1.length > 0
      ? Math.round((valid1.reduce((acc, v) => acc + v, 0) / valid1.length) * 100) / 100
      : null;
  const cp2Avg =
    valid2.length > 0
      ? Math.round((valid2.reduce((acc, v) => acc + v, 0) / valid2.length) * 100) / 100
      : null;
  const targetAvg =
    cp1Avg !== null && cp2Avg !== null
      ? Math.round(((cp1Avg + cp2Avg) / 2) * 1000) / 1000
      : (cp1Avg ?? cp2Avg)!;

  const defaultMissingGrade = Math.min(5, Math.max(1, Math.round(targetAvg)));
  const rawAvgs: number[] = Array(9).fill(defaultMissingGrade);
  const baseRatings: number[] = Array(9).fill(defaultMissingGrade);
  const halfCandidates: Array<{ domIndex: number; delta: number }> = [];

  for (let i = 0; i < 9; i++) {
    const v1 = g1[i];
    const v2 = g2[i];
    let raw: number;
    if (v1 !== null && v2 !== null) {
      raw = (v1 + v2) / 2;
    } else if (v1 !== null) {
      raw = v1;
    } else if (v2 !== null) {
      raw = v2;
    } else {
      raw = defaultMissingGrade;
    }
    rawAvgs[i] = raw;

    const frac = raw - Math.floor(raw);
    if (Math.abs(frac - 0.5) < 1e-6) {
      baseRatings[i] = Math.min(5, Math.max(1, Math.floor(raw)));
      const delta = v1 !== null && v2 !== null ? v2 - v1 : 0;
      halfCandidates.push({ domIndex: i, delta });
    } else {
      baseRatings[i] = Math.min(5, Math.max(1, Math.round(raw)));
    }
  }

  // Prioritize rounding UP criteria where CP2 > CP1 (improved in later checkpoint), then lower domIndex
  halfCandidates.sort((a, b) => {
    if (b.delta !== a.delta) return b.delta - a.delta;
    return a.domIndex - b.domIndex;
  });

  const baseSum = baseRatings.reduce((acc, v) => acc + v, 0);
  const halfUpMidpoint = Math.ceil(halfCandidates.length / 2);
  let bestK = 0;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (let k = 0; k <= halfCandidates.length; k++) {
    const candidateAvg = (baseSum + k) / 9;
    const diff = Math.abs(candidateAvg - targetAvg);
    if (diff < bestDiff - 1e-9) {
      bestDiff = diff;
      bestK = k;
    } else if (Math.abs(diff - bestDiff) <= 1e-9) {
      if (Math.abs(k - halfUpMidpoint) < Math.abs(bestK - halfUpMidpoint)) {
        bestK = k;
      }
    }
  }

  const finalRatings = [...baseRatings];
  for (let idx = 0; idx < bestK; idx++) {
    const targetDomIdx = halfCandidates[idx].domIndex;
    finalRatings[targetDomIdx] = Math.min(5, finalRatings[targetDomIdx] + 1);
  }

  const scoreObj: Partial<SpckSession14CompetencyScores> = {};
  for (let i = 0; i < 9; i++) {
    const spec = SESSION14_COMPETENCY_AREA_SPECS[i];
    scoreObj[spec.key] = finalRatings[i];
  }
  const competencyScores = parseSession14CompetencyScores(scoreObj);
  const competencyTotalScore = calculateCompetencyAverageScore(competencyScores);

  const sourceType: StudentCheckpointCompetencyResult["sourceType"] =
    valid1.length > 0 && valid2.length > 0
      ? "CHECKPOINT_BOTH"
      : valid1.length > 0
      ? "CHECKPOINT_CP1_ONLY"
      : "CHECKPOINT_CP2_ONLY";

  return {
    matchedFromCheckpoints: true,
    sourceType,
    cp1SlotNumber,
    cp2SlotNumber,
    cp1Avg,
    cp2Avg,
    targetAvg,
    competencyScores,
    competencyTotalScore,
    ratingsInDomOrder: SESSION14_COMPETENCY_AREA_SPECS.map((s) => competencyScores[s.key]),
    perCriterion: SESSION14_COMPETENCY_AREA_SPECS.map((spec, i) => ({
      domIndex: spec.domIndex,
      key: spec.key,
      commentAreaId: spec.commentAreaId,
      cp1Grade: g1[i],
      cp2Grade: g2[i],
      rawAverage: rawAvgs[i],
      finalRating: competencyScores[spec.key],
    })),
  };
}

function escapeHtmlText(raw: string): string {
  return String(raw || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resolveNextCourseWishLabel(classId: string): string {
  const profile = detectSpckCourseProfile(classId);
  switch (profile.coursePrefix) {
    case "SB":
      return "Scratch Advance (SA)";
    case "SA":
      return "Scratch Intensive (SI)";
    case "SI":
      return "GameMaker Basic (GB)";
    case "GB":
      return "GameMaker Advance (GA)";
    case "GA":
      return "GameMaker Intensive (GI)";
    case "GI":
      return "Python Basic (PTB) / Web Developer Basic (JSB)";
    case "PTB":
      return "Python App Advance (PTA)";
    case "PTA":
      return "Python App Intensive (PTI)";
    case "PTI":
      return "Web Developer Basic (JSB) / Computer Science Basic (CSB)";
    case "JSB":
      return "Web Developer Advance (JSA)";
    case "JSA":
      return "Web Developer Intensive (JSI)";
    case "JSI":
      return "các dự án Công nghệ & Khoa học máy tính chuyên sâu tiếp theo";
    case "CSB":
      return "Computer Science Advance (CSA)";
    case "CSA":
      return "Computer Science Intensive (CSI)";
    case "CSI":
      return "các dự án AI & Khoa học dữ liệu chuyên sâu tiếp theo";
    case "PREB":
      return "Robotics VEX GO Advance (PREA)";
    case "PREA":
      return "Robotics VEX GO Intensive (PREI)";
    case "PREI":
      return "Robotics VEX IQ Basic (ARMB)";
    case "ARMB":
      return "Robotics VEX IQ Advance (ARMA)";
    case "ARMA":
      return "Robotics VEX IQ Intensive (ARMI)";
    default:
      return "khóa học nâng cao tiếp theo tại MindX";
  }
}

export function compileSession14SummaryHtml(title: string, bodyText: string): string {
  const cleanTitle = String(title || "").trim();
  const lines = String(bodyText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const htmlParts: string[] = [];
  if (cleanTitle) {
    htmlParts.push(`<p><strong>${escapeHtmlText(cleanTitle)}</strong></p>`);
  }
  for (const lineStr of lines) {
    const esc = escapeHtmlText(lineStr);
    if (lineStr.startsWith("KẾT QUẢ")) {
      htmlParts.push(`<p><strong>${esc}</strong></p>`);
    } else if (
      lineStr.startsWith("🥇") ||
      lineStr.startsWith("🥈") ||
      lineStr.startsWith("🥉") ||
      lineStr.startsWith("👏")
    ) {
      const colonIdx = esc.indexOf(":");
      if (colonIdx > 0) {
        htmlParts.push(
          `<p><strong>${esc.slice(0, colonIdx + 1)}</strong>${esc.slice(colonIdx + 1)}</p>`
        );
      } else {
        htmlParts.push(`<p><strong>${esc}</strong></p>`);
      }
    } else {
      htmlParts.push(`<p>${esc}</p>`);
    }
  }
  return htmlParts.join("");
}

export function buildClassSession14SummaryDraft(
  classId: string,
  customRankings?: Session14AwardRankItem[]
): {
  classId: string;
  title: string;
  bodyText: string;
  summaryHtml: string;
  rankings: Session14AwardRankItem[];
} {
  const normalizedClassId = String(classId || "").trim().toUpperCase();
  const activeStudents = studentRepo
    .findByClass(normalizedClassId, false)
    .filter((s) => Number(s.isActive ?? 1) !== 0);

  const rankings =
    customRankings ??
    computeClassDemoAwardRankings(
      activeStudents.map((stu) => {
        const ev = session14EvalRepo.getOrInit(normalizedClassId, stu.studentId);
        const s14 = spckSessionRepo.findOne(normalizedClassId, stu.studentId, 14);
        const shared = spckUploadRepo.findOne(normalizedClassId, stu.studentId);
        const rawTitle =
          s14?.projectTitle || shared?.baseProjectTitle || shared?.projectTitle || "";
        const projectTitle = !isDefaultSpckProductTitle(rawTitle, stu.fullName)
          ? stripSpckSessionSuffix(rawTitle)
          : "";
        return {
          studentId: stu.studentId,
          fullName: stu.fullName,
          rawTotalScore3dp:
            typeof ev.demoRawTotalScore === "number" && ev.demoRawTotalScore > 0
              ? ev.demoRawTotalScore
              : ev.demoTotalScore,
          demoTotalScore: ev.demoTotalScore,
          projectTitle,
        };
      })
    );

  const scored = rankings.filter((r) => r.awardTier !== "UNSCORED" && r.rawTotalScore3dp > 0);
  const profile = detectSpckCourseProfile(normalizedClassId);
  const maxDemoVal = calculateDemoTotalScore(getSession14DemoLimitsForClass(normalizedClassId));
  const maxDemoStr = maxDemoVal.toFixed(1);

  const title = `BUỔI 14: TỔNG KẾT CUỐI KHÓA & VINH DANH BẢO VỆ DỰ ÁN (DEMO DAY) — LỚP ${normalizedClassId}`;
  const bodyLines: string[] = [];

  if (scored.length > 0) {
    bodyLines.push(
      `Chúc mừng ${scored.length}/${Math.max(activeStudents.length, scored.length)} học viên lớp ${normalizedClassId} (khóa ${profile.trackBadgeLabel}) đã hoàn thành buổi thuyết trình và bảo vệ Sản phẩm cuối khóa (Demo Day) với tinh thần nghiêm túc, tự tin.`
    );
    bodyLines.push("KẾT QUẢ VINH DANH CHÍNH THỨC TỪ BAN GIÁM KHẢO:");

    const formatAwardLine = (
      icon: string,
      tierItems: Session14AwardRankItem[],
      singleLabel: string,
      tiedLabel: string
    ) => {
      if (tierItems.length === 0) return;
      const scoreLabel = `${tierItems[0].rawScoreText}/${maxDemoStr} điểm`;
      if (tierItems.length === 1) {
        const w = tierItems[0];
        const projPart = w.projectTitle ? ` — Đề tài "${w.projectTitle}"` : "";
        bodyLines.push(`${icon} ${singleLabel} (${scoreLabel}): ${w.fullName}${projPart}.`);
      } else {
        const listText = tierItems
          .map((w) => (w.projectTitle ? `${w.fullName} ("${w.projectTitle}")` : w.fullName))
          .join(", ");
        bodyLines.push(`${icon} ${tiedLabel} (${scoreLabel}): ${listText}.`);
      }
    };

    formatAwardLine(
      "🥇",
      scored.filter((r) => r.awardTier === "FIRST"),
      "Giải Nhất",
      "Đồng Giải Nhất"
    );
    formatAwardLine(
      "🥈",
      scored.filter((r) => r.awardTier === "SECOND"),
      "Giải Nhì",
      "Đồng Giải Nhì"
    );
    formatAwardLine(
      "🥉",
      scored.filter((r) => r.awardTier === "THIRD"),
      "Giải Ba",
      "Đồng Giải Ba"
    );

    const completed = scored.filter((r) => r.awardTier === "COMPLETED");
    if (completed.length > 0) {
      const compList = completed
        .map((c) =>
          c.projectTitle
            ? `${c.fullName} (${c.rawScoreText}/${maxDemoStr} — "${c.projectTitle}")`
            : `${c.fullName} (${c.rawScoreText}/${maxDemoStr})`
        )
        .join(", ");
      bodyLines.push(`👏 Ghi nhận hoàn thành dự án cuối khóa: ${compList}.`);
    }
  } else {
    bodyLines.push(
      `Tổng kết cuối khóa & buổi bảo vệ Sản phẩm cuối khóa (Demo Day) lớp ${normalizedClassId} (khóa ${profile.trackBadgeLabel}).`
    );
  }

  bodyLines.push(
    `Trường học Công nghệ MindX chúc các con tiếp tục giữ vững đam mê sáng tạo và chinh phục khóa ${resolveNextCourseWishLabel(normalizedClassId)} sắp tới!`
  );

  const bodyText = bodyLines.join("\n");
  const summaryHtml = compileSession14SummaryHtml(title, bodyText);
  return {
    classId: normalizedClassId,
    title,
    bodyText,
    summaryHtml,
    rankings,
  };
}

export function getEffectiveClassSession14Summary(classId: string): {
  classSummary: Session14ClassSummaryRecord;
  rankings: Session14AwardRankItem[];
} {
  const normalizedClassId = String(classId || "").trim().toUpperCase();
  const generated = buildClassSession14SummaryDraft(normalizedClassId);
  const existing = session14ClassSummaryRepo.findOne(normalizedClassId);
  if (
    existing &&
    existing.isEditedByTeacher === 1 &&
    String(existing.summaryHtml || "").trim().length > 0
  ) {
    return {
      classSummary: existing,
      rankings: generated.rankings,
    };
  }
  const saved = session14ClassSummaryRepo.saveAutoGenerated({
    classId: normalizedClassId,
    title: generated.title,
    bodyText: generated.bodyText,
    summaryHtml: generated.summaryHtml,
  });
  return {
    classSummary: saved,
    rankings: generated.rankings,
  };
}

async function fetchLiveLmsCheckpointSlotsSafe(classId: string): Promise<any[] | null> {
  const normalizedClassId = String(classId || "").trim().toUpperCase();
  if (!normalizedClassId) return null;

  try {
    return await taskQueue.enqueue({
      id: `FETCH_CP_SLOTS_S14_${normalizedClassId}_${Date.now()}`,
      jobType: "SYNC_CLASS",
      description: `Đọc điểm Năng lực [ĐNL] Buổi Kiểm tra trên LMS cho lớp ${normalizedClassId}`,
      classId: normalizedClassId,
      sessionId: `${normalizedClassId}_SESS_14_CP_READ`,
      execute: async () => {
        const page = await browserManager.getPage();
        let capturedSlots: any[] | null = null;

        const onRes = async (res: any) => {
          try {
            const url = String(res.url() || "").toLowerCase();
            if (!url.includes("lms-api.mindx.edu.vn") && !url.includes("graphql")) return;
            if (String(res.request().method() || "").toUpperCase() !== "POST") return;
            const postData = res.request().postData() || "";
            if (!postData) return;
            const json = await res.json().catch(() => null);
            const clsObj =
              json?.data?.classesById ||
              json?.data?.classById ||
              json?.data?.getClassById ||
              json?.data?.class;
            if (clsObj && Array.isArray(clsObj.slots)) {
              const code = String(clsObj.name || clsObj.code || "").trim().toUpperCase();
              if (!code || code === normalizedClassId) {
                capturedSlots = clsObj.slots;
              }
            }
          } catch {
            // ignore non-JSON
          }
        };

        page.on("response", onRes);
        try {
          await authService.ensureAuthenticated("LMS");
          await LmsHelpers.openClassDrawer(page, normalizedClassId, { preferredTab: 10 });
          await LmsHelpers.switchDrawerTab(page, SELECTORS.tabs.comments);
          await page.waitForTimeout(1200);
          if (!capturedSlots) {
            const refreshBtn = page
              .locator(
                'div[aria-labelledby="class-detail"] button:has([data-testid="RefreshIcon"]), .MuiDrawer-paperAnchorRight button:has([data-testid="RefreshIcon"])'
              )
              .first();
            if (await refreshBtn.isVisible().catch(() => false)) {
              await refreshBtn.click({ force: true }).catch(() => {});
              await page.waitForTimeout(2200);
            }
          }
          return capturedSlots;
        } finally {
          page.off("response", onRes);
        }
      },
    });
  } catch {
    return null;
  }
}

export interface StudentDemoScoreExtract {
  studentId: string;
  fullName: string;
  matchedTabName: string;
  demoScores: SpckSession14DemoScores;
  demoTotalScore: number;
  demoRawTotalScore: number;
  rawScoreText: string;
  awardRank: number | null;
  awardTier: Session14AwardRankItem["awardTier"];
  awardLabel: string;
  awardBadge: string;
  judgeNote: string;
  competencyScores: SpckSession14CompetencyScores;
  competencyTotalScore: number;
  competencySource: Record<string, unknown>;
  updatedRecord: SpckSession14EvaluationRecord;
}

export interface ImportDemoScoresResult {
  classId: string;
  sourceUsed: string;
  checkpointSourceUsed: "LMS_CHECKPOINTS" | "CACHED_CHECKPOINTS" | "DEMO_FALLBACK";
  matchedCount: number;
  unmatchedTabs: string[];
  students: StudentDemoScoreExtract[];
  rankings: Session14AwardRankItem[];
  classSummary: Session14ClassSummaryRecord;
}

function decodeXmlEntities(raw: string): string {
  return String(raw || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

interface ParsedCell {
  ref: string;
  type: string;
  formula?: string;
  rawValue: string;
  stringValue: string;
  numericValue: number | null;
}

export function parseSharedStringsXml(xml: string): string[] {
  const strings: string[] = [];
  if (!xml) return strings;
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
  let match: RegExpExecArray | null;
  while ((match = siRegex.exec(xml)) !== null) {
    const inner = match[1];
    const parts: string[] = [];
    const tRegex = /<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/gi;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRegex.exec(inner)) !== null) {
      parts.push(decodeXmlEntities(tMatch[1]));
    }
    strings.push(parts.join(""));
  }
  return strings;
}

export function parseWorksheetCells(xml: string, sharedStrings: string[]): Map<string, ParsedCell> {
  const cells = new Map<string, ParsedCell>();
  const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi;
  let match: RegExpExecArray | null;

  while ((match = cellRegex.exec(xml)) !== null) {
    const attrs = match[1] || "";
    const inner = match[2] || "";
    const rMatch = attrs.match(/\br="([A-Z]+\d+)"/i);
    if (!rMatch) continue;
    const ref = rMatch[1].toUpperCase();
    const tMatch = attrs.match(/\bt="([^"]+)"/i);
    const cellType = tMatch ? tMatch[1] : "n";

    const fMatch = inner.match(/<f(?:\s+[^>]*)?>([\s\S]*?)<\/f>/i);
    const formula = fMatch ? decodeXmlEntities(fMatch[1]).trim() : undefined;

    let rawValue = "";
    let stringValue = "";
    let numericValue: number | null = null;

    if (cellType === "inlineStr") {
      const tParts: string[] = [];
      const tRegex = /<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/gi;
      let tm: RegExpExecArray | null;
      while ((tm = tRegex.exec(inner)) !== null) {
        tParts.push(decodeXmlEntities(tm[1]));
      }
      stringValue = tParts.join("").trim();
      rawValue = stringValue;
      const numCandidate = Number(stringValue.replace(",", "."));
      if (stringValue !== "" && Number.isFinite(numCandidate)) {
        numericValue = numCandidate;
      }
    } else {
      const vMatch = inner.match(/<v(?:\s+[^>]*)?>([\s\S]*?)<\/v>/i);
      rawValue = vMatch ? decodeXmlEntities(vMatch[1]).trim() : "";
      if (cellType === "s") {
        const idx = parseInt(rawValue, 10);
        stringValue =
          Number.isFinite(idx) && idx >= 0 && idx < sharedStrings.length
            ? sharedStrings[idx].trim()
            : rawValue;
        const numCandidate = Number(stringValue.replace(",", "."));
        if (stringValue !== "" && Number.isFinite(numCandidate)) {
          numericValue = numCandidate;
        }
      } else {
        stringValue = rawValue;
        const numCandidate = Number(rawValue.replace(",", "."));
        if (rawValue !== "" && Number.isFinite(numCandidate)) {
          numericValue = numCandidate;
        }
      }
    }

    cells.set(ref, {
      ref,
      type: cellType,
      formula,
      rawValue,
      stringValue,
      numericValue,
    });
  }

  return cells;
}

function parseCategorySpansFromSheetXml(
  sheetXml: string | undefined,
  classId?: string
): Array<[number, number]> {
  if (sheetXml) {
    const spans: Array<[number, number]> = [];
    const mergeRegex = /<mergeCell\b[^>]*?\bref="A(\d+):A(\d+)"/gi;
    let m: RegExpExecArray | null;
    while ((m = mergeRegex.exec(sheetXml)) !== null) {
      const startRow = parseInt(m[1], 10);
      const endRow = parseInt(m[2], 10);
      if (Number.isFinite(startRow) && Number.isFinite(endRow) && startRow >= 8 && endRow >= startRow) {
        spans.push([startRow, endRow]);
      }
    }
    spans.sort((a, b) => a[0] - b[0]);
    if (spans.length >= 5) {
      return spans.slice(0, 5);
    }
  }
  return isRoboticsClassCode(classId)
    ? [
        [8, 13],
        [14, 17],
        [18, 19],
        [20, 22],
        [23, 27],
      ]
    : [
        [8, 13],
        [14, 17],
        [18, 19],
        [20, 22],
        [23, 27],
      ];
}

function sumCellRange(
  cells: Map<string, ParsedCell>,
  col: string,
  startRow: number,
  endRow: number
): { hasAnyNumeric: boolean; isCompleteRange: boolean; sum: number } {
  const totalRows = Math.max(0, endRow - startRow + 1);
  let numericCount = 0;
  let hasInvalidCell = false;
  let sum = 0;
  for (let r = startRow; r <= endRow; r++) {
    const dNorm = normalizeVietnameseName(cells.get(`D${r}`)?.stringValue || "");
    const cWeight = cells.get(`C${r}`)?.numericValue;
    const eCell = cells.get(`${col}${r}`);
    let rowVal: number | null = null;
    if (
      cWeight !== null &&
      cWeight !== undefined &&
      Number.isFinite(cWeight) &&
      cWeight > 0 &&
      (dNorm === "tot" || dNorm === "hoan thanh" || dNorm === "chua dat")
    ) {
      const mult = dNorm === "tot" ? 1 : dNorm === "hoan thanh" ? 0.5 : 0;
      rowVal = cWeight * mult;
    } else if (eCell && eCell.numericValue !== null && Number.isFinite(eCell.numericValue)) {
      rowVal = eCell.numericValue;
    }
    if (rowVal !== null && Number.isFinite(rowVal)) {
      if (rowVal < 0 || rowVal > 1.5) {
        hasInvalidCell = true;
      }
      numericCount++;
      sum += rowVal;
    }
  }
  return {
    hasAnyNumeric: numericCount > 0,
    isCompleteRange: !hasInvalidCell && totalRows > 0 && numericCount === totalRows,
    sum: Math.round(sum * 10000) / 10000,
  };
}

function sumWeightColC(
  cells: Map<string, ParsedCell>,
  startRow: number,
  endRow: number
): number {
  let sum = 0;
  for (let r = startRow; r <= endRow; r++) {
    const val = cells.get(`C${r}`)?.numericValue;
    if (val !== null && val !== undefined && Number.isFinite(val) && val > 0) {
      sum += val;
    }
  }
  return Math.round(sum * 1000) / 1000;
}

export function extractDemoScoresFromWorksheet(
  cells: Map<string, ParsedCell>,
  classId?: string,
  sheetXml?: string
): {
  studentNameInCellB2: string;
  demoScores: SpckSession14DemoScores;
  demoTotalScore: number;
  demoRawTotalScore: number;
  judgeNote: string;
  hasCompleteScores: boolean;
  scoredCriteriaCount: number;
} {
  const b2 = cells.get("B2")?.stringValue || "";
  const limits = getSession14DemoLimitsForClass(classId);
  const categorySpans = parseCategorySpansFromSheetXml(sheetXml, classId);

  const algoWeightSum = sumWeightColC(cells, categorySpans[0][0], categorySpans[0][1]);
  const creaWeightSum = sumWeightColC(cells, categorySpans[1][0], categorySpans[1][1]);
  const isLegacyCsiSplitSheet =
    isCsiClassCode(classId) &&
    Math.abs(algoWeightSum - 1.5) < 0.05 &&
    Math.abs(creaWeightSum - 1.0) < 0.05;
  const algoReadLimit = isLegacyCsiSplitSheet ? 1.5 : limits.algorithm;
  const creaReadLimit = isLegacyCsiSplitSheet ? 1.0 : limits.creativity;

  const eAlgo = sumCellRange(cells, "E", categorySpans[0][0], categorySpans[0][1]);
  const eCreative = sumCellRange(cells, "E", categorySpans[1][0], categorySpans[1][1]);
  const eComm = sumCellRange(cells, "E", categorySpans[2][0], categorySpans[2][1]);
  const eProb = sumCellRange(cells, "E", categorySpans[3][0], categorySpans[3][1]);
  const eComp = sumCellRange(cells, "E", categorySpans[4][0], categorySpans[4][1]);

  const maxCritEndRow = Math.max(...categorySpans.map((s) => s[1]), 27);

  // Also check LOs summary rows (rows 32..36: A32..A36 labels, B32..B36 values)
  const b32 = cells.get("B32");
  const b33 = cells.get("B33");
  const b34 = cells.get("B34");
  const b35 = cells.get("B35");
  const b36 = cells.get("B36");

  const isWithinMax = (val: number | null | undefined, maxAllowed: number): val is number =>
    typeof val === "number" && Number.isFinite(val) && val >= 0 && val <= maxAllowed + 1e-6;

  const resolveScore = (
    summaryCell: ParsedCell | undefined,
    rangeSum: { hasAnyNumeric: boolean; isCompleteRange: boolean; sum: number },
    maxAllowed: number
  ): { hasScore: boolean; isValid: boolean; value: number } => {
    // If summaryCell has no formula and a direct numeric value was typed in B32..B36, prefer it;
    // If summaryCell has a formula (e.g. SUM(E8:E13)), prefer the live sum of E cells when present so edits to E8:E27 without Excel recalculation are reflected accurately.
    if (summaryCell && !summaryCell.formula && summaryCell.numericValue !== null) {
      if (!isWithinMax(summaryCell.numericValue, maxAllowed)) {
        return { hasScore: false, isValid: false, value: 0 };
      }
      return { hasScore: true, isValid: true, value: summaryCell.numericValue };
    }
    if (rangeSum.hasAnyNumeric) {
      if (!rangeSum.isCompleteRange || !isWithinMax(rangeSum.sum, maxAllowed)) {
        return { hasScore: false, isValid: false, value: 0 };
      }
      return { hasScore: true, isValid: true, value: rangeSum.sum };
    }
    if (summaryCell && summaryCell.numericValue !== null) {
      if (!isWithinMax(summaryCell.numericValue, maxAllowed)) {
        return { hasScore: false, isValid: false, value: 0 };
      }
      return { hasScore: true, isValid: true, value: summaryCell.numericValue };
    }
    return { hasScore: false, isValid: true, value: 0 };
  };

  const resAlgo = resolveScore(b32, eAlgo, algoReadLimit);
  const resComp = resolveScore(b33, eComp, limits.computerSkills);
  const resCreative = resolveScore(b34, eCreative, creaReadLimit);
  const resProb = resolveScore(b35, eProb, limits.problemSolving);
  const resComm = resolveScore(b36, eComm, limits.communication);

  const hasCriterionScore = {
    algorithm: resAlgo.hasScore,
    computerSkills: resComp.hasScore,
    creativity: resCreative.hasScore,
    problemSolving: resProb.hasScore,
    communication: resComm.hasScore,
  };

  const criterionValid = {
    algorithm: resAlgo.isValid,
    computerSkills: resComp.isValid,
    creativity: resCreative.isValid,
    problemSolving: resProb.isValid,
    communication: resComm.isValid,
  };

  const rawDemo: Partial<SpckSession14DemoScores> = {
    algorithm: resAlgo.value,
    computerSkills: resComp.value,
    creativity: resCreative.value,
    problemSolving: resProb.value,
    communication: resComm.value,
  };

  // Also scan rows 31..40 by label in column A in case a custom course template reordered LOs rows
  for (let r = 31; r <= 40; r++) {
    const label = normalizeVietnameseName(cells.get(`A${r}`)?.stringValue || "");
    const bCell = cells.get(`B${r}`);
    if (!label || !bCell || bCell.numericValue === null) continue;
    if (!bCell.formula) {
      if (label.includes("thuat toan") || label.includes("tu duy may tinh")) {
        if (isWithinMax(bCell.numericValue, algoReadLimit)) {
          rawDemo.algorithm = bCell.numericValue;
          hasCriterionScore.algorithm = true;
          criterionValid.algorithm = true;
        } else {
          hasCriterionScore.algorithm = false;
          criterionValid.algorithm = false;
        }
      } else if (label.includes("su dung may tinh")) {
        if (isWithinMax(bCell.numericValue, limits.computerSkills)) {
          rawDemo.computerSkills = bCell.numericValue;
          hasCriterionScore.computerSkills = true;
          criterionValid.computerSkills = true;
        } else {
          hasCriterionScore.computerSkills = false;
          criterionValid.computerSkills = false;
        }
      } else if (label.includes("sang tao")) {
        if (isWithinMax(bCell.numericValue, creaReadLimit)) {
          rawDemo.creativity = bCell.numericValue;
          hasCriterionScore.creativity = true;
          criterionValid.creativity = true;
        } else {
          hasCriterionScore.creativity = false;
          criterionValid.creativity = false;
        }
      } else if (label.includes("giai quyet van de")) {
        if (isWithinMax(bCell.numericValue, limits.problemSolving)) {
          rawDemo.problemSolving = bCell.numericValue;
          hasCriterionScore.problemSolving = true;
          criterionValid.problemSolving = true;
        } else {
          hasCriterionScore.problemSolving = false;
          criterionValid.problemSolving = false;
        }
      } else if (label.includes("giao tiep") || label.includes("hop tac")) {
        if (isWithinMax(bCell.numericValue, limits.communication)) {
          rawDemo.communication = bCell.numericValue;
          hasCriterionScore.communication = true;
          criterionValid.communication = true;
        } else {
          hasCriterionScore.communication = false;
          criterionValid.communication = false;
        }
      }
    }
  }

  if (
    isLegacyCsiSplitSheet &&
    hasCriterionScore.creativity &&
    criterionValid.creativity &&
    typeof rawDemo.creativity === "number" &&
    rawDemo.creativity > limits.creativity + 1e-6 &&
    rawDemo.creativity <= 1.0 + 1e-6 &&
    (typeof rawDemo.algorithm !== "number" ||
      !Number.isFinite(rawDemo.algorithm) ||
      rawDemo.algorithm <= 1.5 + 1e-6)
  ) {
    const overflow = Math.round((rawDemo.creativity - limits.creativity) * 1000) / 1000;
    const baseAlgo =
      typeof rawDemo.algorithm === "number" && Number.isFinite(rawDemo.algorithm)
        ? rawDemo.algorithm
        : 0;
    rawDemo.algorithm = Math.min(
      limits.algorithm,
      Math.round((baseAlgo + overflow) * 1000) / 1000
    );
    rawDemo.creativity = limits.creativity;
  }

  const scoredCriteriaCount = (
    Object.keys(hasCriterionScore) as Array<keyof typeof hasCriterionScore>
  ).filter((k) => hasCriterionScore[k] && criterionValid[k]).length;
  const hasCompleteScores =
    scoredCriteriaCount === 5 && Object.values(criterionValid).every(Boolean);

  const clampRaw4dp = (val: number | undefined, max: number): number => {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(Math.min(n, max) * 10000) / 10000;
  };
  const demoRawTotalScore =
    Math.round(
      (clampRaw4dp(rawDemo.algorithm, limits.algorithm) +
        clampRaw4dp(rawDemo.creativity, limits.creativity) +
        clampRaw4dp(rawDemo.communication, limits.communication) +
        clampRaw4dp(rawDemo.problemSolving, limits.problemSolving) +
        clampRaw4dp(rawDemo.computerSkills, limits.computerSkills)) *
        1000
    ) / 1000;

  const demoScores = parseSession14DemoScores(rawDemo, classId);
  const demoTotalScore = calculateDemoTotalScore(demoScores);

  // Scan judge comments in Columns B..F below criteria rows (strictly ignoring Column G AI hints!)
  const bgkNotes: string[] = [];
  const noteStartRow = Math.max(25, maxCritEndRow + 1);
  const noteEndRow = Math.max(33, maxCritEndRow + 5);
  for (let r = noteStartRow; r <= noteEndRow; r++) {
    const aNorm = normalizeVietnameseName(cells.get(`A${r}`)?.stringValue || "");
    if (
      aNorm.includes("thuat toan") ||
      aNorm.includes("su dung may tinh") ||
      aNorm.includes("sang tao") ||
      aNorm.includes("giai quyet van de") ||
      aNorm.includes("giao tiep")
    ) {
      continue;
    }
    const bFormula = cells.get(`B${r}`)?.formula || "";
    if (/SUM\(/i.test(bFormula)) continue;

    for (const colLetter of ["B", "C", "D", "E", "F"]) {
      const val = (cells.get(`${colLetter}${r}`)?.stringValue || "").trim();
      if (!val) continue;
      if (/^(?:Nhận\s*xét|BGK\s*\d*|Tổng\s*Điểm)$/i.test(val)) continue;
      if (!bgkNotes.includes(val)) {
        bgkNotes.push(val);
      }
    }
  }

  return {
    studentNameInCellB2: b2.trim(),
    demoScores,
    demoTotalScore,
    demoRawTotalScore,
    judgeNote: bgkNotes.join(" | "),
    hasCompleteScores,
    scoredCriteriaCount,
  };
}

/**
 * Suggests the 9 [ĐNL] Competency ratings (1..5) for a student based on:
 * - Their Demo Scores (5 criteria out of 5.0)
 * - Their historical session feedbacks (Sessions 1..13)
 * - Selected Quick Tags & Teacher Note
 */
export function suggestCompetencyScoresForStudent(params: {
  classId: string;
  studentId: string;
  demoScores: SpckSession14DemoScores;
  quickTags?: string[];
  teacherNote?: string;
}): {
  competencyScores: SpckSession14CompetencyScores;
  competencyTotalScore: number;
} {
  const { classId, studentId, demoScores } = params;
  const allTagsText = normalizeVietnameseName(
    [...(params.quickTags || []), params.teacherNote || ""].join(" | ")
  );

  // Convert a ratio (0..1) into a 1..5 MindX competency rating (typically 3..5 for completed projects)
  const ratioToRating = (earned: number, max: number, defaultRating = 4): number => {
    if (!Number.isFinite(earned) || earned < 0 || max <= 0) return defaultRating;
    if (earned === 0) return 2;
    const ratio = earned / max;
    if (ratio >= 0.95) return 5;
    if (ratio >= 0.7) return 4;
    if (ratio >= 0.45) return 3;
    return 2;
  };

  // Inspect historical session feedbacks (Sessions 1..13) for self-study, homework, and in-class focus
  const historyRows = sessionFeedbackRepo
    .findByClass(classId)
    .filter((f) => f.studentId === studentId);

  let distractedCount = 0;
  let selfStudyPositive = false;
  let homeworkWeak = false;

  for (const row of historyRows) {
    const combined = normalizeVietnameseName(
      `${row.quickTagsJson || ""} ${row.teacherNote || ""} ${row.improvements || ""}`
    );
    if (
      combined.includes("mat tap trung") ||
      combined.includes("lam viec rieng") ||
      combined.includes("xao nhang")
    ) {
      distractedCount++;
    }
    if (
      combined.includes("tu giac") ||
      combined.includes("chu dong tim hieu") ||
      combined.includes("khong phu thuoc vao ai")
    ) {
      selfStudyPositive = true;
    }
    if (combined.includes("chua hoan thanh btvn") || combined.includes("quen lam bai tap")) {
      homeworkWeak = true;
    }
  }

  if (
    allTagsText.includes("tu giac tim hieu") ||
    allTagsText.includes("khong phu thuoc ai") ||
    allTagsText.includes("khong phu thuoc vao ai")
  ) {
    selfStudyPositive = true;
  }
  const reliesOnAi =
    allTagsText.includes("phu thuoc kha nhieu vao ai") ||
    allTagsText.includes("phu thuoc ai") ||
    allTagsText.includes("chua hieu sau phan cot loi");

  const limits = getSession14DemoLimitsForClass(classId);
  const knowledgeInClass = ratioToRating(demoScores.algorithm, limits.algorithm, 4);
  const knowledgeSelfStudy = reliesOnAi
    ? 3
    : selfStudyPositive
    ? 5
    : ratioToRating(demoScores.algorithm, limits.algorithm, 4);
  const skillCommunication = ratioToRating(demoScores.communication, limits.communication, 4);
  const skillComputerUse = ratioToRating(demoScores.computerSkills, limits.computerSkills, 4);
  const skillProblemSolving = ratioToRating(demoScores.problemSolving, limits.problemSolving, 4);
  const skillCreativity = ratioToRating(demoScores.creativity, limits.creativity, 4);
  const skillComputational = ratioToRating(demoScores.algorithm, limits.algorithm, 4);
  const attitudeHomework = homeworkWeak ? 3 : selfStudyPositive ? 4 : 4;
  const attitudeInClass = distractedCount >= 3 ? 3 : 4;

  const competencyScores = parseSession14CompetencyScores({
    knowledgeInClass,
    knowledgeSelfStudy,
    skillCommunication,
    skillComputerUse,
    skillProblemSolving,
    skillCreativity,
    skillComputational,
    attitudeHomework,
    attitudeInClass,
  });

  return {
    competencyScores,
    competencyTotalScore: calculateCompetencyAverageScore(competencyScores),
  };
}

/**
 * Automatically locates the class's graded Demo Scoring Sheet (.xlsx) on disk if no path/URL was provided.
 */
export function resolveDefaultDemoSheetPathForClass(classId: string): string | null {
  const normalizedClassId = String(classId || "").trim().toUpperCase();
  const candidates: string[] = [];

  // 1. Check class SPCK parent folder from spck_uploads / spck_session_submissions
  const spckRows = spckUploadRepo.findByClass(normalizedClassId);
  for (const r of spckRows) {
    if (r.localFolderPath && r.localFolderPath.trim()) {
      const parentDir = path.dirname(r.localFolderPath);
      candidates.push(parentDir);
    }
  }

  // 2. Check data/demo_sheets
  const dataDemoDir = path.resolve(process.cwd(), "data", "demo_sheets");
  candidates.push(dataDemoDir);

  const expectedTitle = getDemoSheetTitleForClass(normalizedClassId);

  for (const dir of candidates) {
    try {
      const safeDir = assertPathAllowed(dir);
      if (!fs.existsSync(safeDir) || !fs.statSync(safeDir).isDirectory()) continue;
      const files = fs.readdirSync(safeDir);
      // Prefer exact class match or expected title match
      const xlsxFiles = files.filter(
        (f) => f.toLowerCase().endsWith(".xlsx") && !f.startsWith("~$")
      );
      const exactMatch = xlsxFiles.find(
        (f) =>
          f.toUpperCase().includes(normalizedClassId) ||
          normalizeVietnameseName(f).includes(normalizeVietnameseName(expectedTitle)) ||
          normalizeVietnameseName(f).includes("bang cham diem buoi demo")
      );
      if (exactMatch) {
        return assertPathAllowed(path.join(safeDir, exactMatch));
      }
    } catch {
      // Ignore disallowed or missing directories
    }
  }

  return null;
}

/**
 * Resolves the latest Native Google Spreadsheet URL created for `classId` from `job_logs`.
 */
export function resolveDefaultDemoSheetUrlForClass(classId: string): string | null {
  const normalizedClassId = String(classId || "").trim().toUpperCase();
  if (!normalizedClassId) return null;
  try {
    const row = getDb()
      .prepare(
        `SELECT message
         FROM job_logs
         WHERE classId = ? AND jobType = 'SPCK_DEMO_SHEET' AND level = 'SUCCESS'
         ORDER BY id DESC
         LIMIT 1`
      )
      .get(normalizedClassId) as { message?: string } | undefined;
    const match = row?.message?.match(
      /https?:\/\/[^\s]+\/spreadsheets\/d\/[a-zA-Z0-9_-]{15,80}[^\s]*/
    );
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

function resolveGoogleSheetsOrigin(rawUrl?: string): string {
  if (
    process.env.MINDX_ALLOW_LOCAL_SHEET_ORIGIN_FOR_TEST === "1" &&
    rawUrl &&
    /^http:\/\/127\.0\.0\.1:\d+\//i.test(rawUrl)
  ) {
    try {
      return new URL(rawUrl).origin;
    } catch {
      // fall through
    }
  }
  return "https://docs.google.com";
}

async function fetchGoogleSheetAsWorkbookBuffer(
  sheetId: string,
  classId: string,
  rawUrl?: string
): Promise<{ buffer: Buffer; sourceUsed: string } | null> {
  const origin = resolveGoogleSheetsOrigin(rawUrl);
  const exportUrl = `${origin}/spreadsheets/d/${sheetId}/export?format=xlsx`;
  try {
    const resp = await fetch(exportUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (resp.ok) {
      const arrBuf = await resp.arrayBuffer();
      const buf = Buffer.from(arrBuf);
      if (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b) {
        return { buffer: buf, sourceUsed: exportUrl };
      }
    }
  } catch {
    // Fall through to authenticated browser context if available
  }

  if (process.env.MINDX_DISABLE_BROWSER_EXPORT_FALLBACK !== "1") {
    try {
      const browserBuf = await exportGoogleSheetBufferViaBrowser(
        sheetId,
        classId,
        origin
      );
      if (browserBuf && browserBuf.length > 4 && browserBuf[0] === 0x50 && browserBuf[1] === 0x4b) {
        return { buffer: browserBuf, sourceUsed: exportUrl };
      }
    } catch {
      // Ignore fallback errors and surface clear message below
    }
  }

  return null;
}

async function loadXlsxBufferFromSource(
  classId: string,
  sourcePathOrUrl?: string
): Promise<{ buffer: Buffer; sourceUsed: string }> {
  const rawSource = String(sourcePathOrUrl || "").trim();

  // Case 1: Explicit Google Sheets URL
  const explicitSheetId = extractGoogleSheetId(rawSource);
  if (explicitSheetId) {
    const loaded = await fetchGoogleSheetAsWorkbookBuffer(
      explicitSheetId,
      classId,
      rawSource
    );
    if (loaded) return loaded;
    throw new Error(
      `Không thể đọc dữ liệu trực tiếp từ Google Trang tính (${rawSource}). Vui lòng kiểm tra quyền truy cập của tài khoản Google hoặc mở quyền xem đường liên kết.`
    );
  }

  // Case 2: Explicit local file path
  if (rawSource) {
    const safePath = assertPathAllowed(path.resolve(rawSource));
    if (!fs.existsSync(safePath) || !fs.statSync(safePath).isFile()) {
      throw new Error(`Không tìm thấy tệp bảng điểm Demo tại đường dẫn: ${safePath}`);
    }
    return { buffer: fs.readFileSync(safePath), sourceUsed: safePath };
  }

  // Case 3: Auto-discover class's Native Google Sheet URL from job_logs first.
  // CRITICAL (F08): If a Native Google Sheet exists in job_logs for this class, NEVER silently fall back
  // to an older local `.xlsx` file if reading the cloud sheet fails (prevents overwriting fresh scores with stale Excel marks).
  const autoSheetUrl = resolveDefaultDemoSheetUrlForClass(classId);
  const autoSheetId = extractGoogleSheetId(autoSheetUrl || "");
  if (autoSheetId) {
    const loaded = await fetchGoogleSheetAsWorkbookBuffer(
      autoSheetId,
      classId,
      autoSheetUrl || undefined
    );
    if (loaded) return loaded;
    throw new Error(
      `Không thể đọc dữ liệu từ Google Trang tính chấm điểm mới nhất của lớp ${classId} (${autoSheetUrl}). Vui lòng kiểm tra kết nối mạng hoặc quyền truy cập tài khoản Google (hệ thống dừng lại để không nhập nhầm tệp Excel cũ trên máy).`
    );
  }

  // Case 4: Legacy fallback in local folder ONLY when no Native Google Sheet has ever been recorded for this class
  const discovered = resolveDefaultDemoSheetPathForClass(classId);
  if (!discovered) {
    throw new Error(
      `Chưa tìm thấy Google Trang tính chấm điểm buổi Demo cho lớp ${classId}. Vui lòng bấm tạo Bảng chấm điểm Demo trên Google Drive hoặc dán link Google Sheet chấm điểm.`
    );
  }
  return { buffer: fs.readFileSync(discovered), sourceUsed: discovered };
}

export interface ParseDemoWorkbookOptions {
  onlyMissingStudents?: boolean;
  checkpointSlots?: any[];
  cp1Slot?: any;
  cp2Slot?: any;
  classByIdGql?: any;
  skipLiveLmsCheckpointFetch?: boolean;
  forceLiveLmsCheckpointFetch?: boolean;
}

/**
 * Parses a workbook Buffer (.xlsx) and matches worksheets to class students.
 */
export function parseDemoWorkbookBufferForClass(
  classId: string,
  buffer: Buffer,
  sourceUsed: string,
  options?: ParseDemoWorkbookOptions
): ImportDemoScoresResult {
  const normalizedClassId = String(classId || "").trim().toUpperCase();
  const students = studentRepo
    .findByClass(normalizedClassId, false)
    .filter((stu) => Number(stu.isActive ?? 1) !== 0);
  if (students.length === 0) {
    throw new Error(`Lớp ${normalizedClassId} chưa có danh sách học viên đang học trong CSDL.`);
  }

  const zip = new AdmZip(buffer);
  const sharedStringsEntry = zip.getEntry("xl/sharedStrings.xml");
  const sharedStrings = sharedStringsEntry
    ? parseSharedStringsXml(sharedStringsEntry.getData().toString("utf8"))
    : [];

  const workbookEntry = zip.getEntry("xl/workbook.xml");
  if (!workbookEntry) {
    throw new Error("Tệp .xlsx không hợp lệ (thiếu xl/workbook.xml).");
  }
  const workbookXml = workbookEntry.getData().toString("utf8");

  const relsEntry = zip.getEntry("xl/_rels/workbook.xml.rels");
  const relsXml = relsEntry ? relsEntry.getData().toString("utf8") : "";
  const relTargetMap = new Map<string, string>();
  const relRegex = /<Relationship\b[^>]*?\bId="([^"]+)"[^>]*?\bTarget="([^"]+)"/gi;
  let relMatch: RegExpExecArray | null;
  while ((relMatch = relRegex.exec(relsXml)) !== null) {
    relTargetMap.set(relMatch[1], relMatch[2].replace(/^\/+/, ""));
  }

  const sheetEntries: Array<{ tabName: string; entryPath: string }> = [];
  const sheetRegex = /<sheet\b[^>]*?\bname="([^"]+)"[^>]*?\br:id="([^"]+)"/gi;
  let sMatch: RegExpExecArray | null;
  while ((sMatch = sheetRegex.exec(workbookXml)) !== null) {
    const tabName = decodeXmlEntities(sMatch[1]).trim();
    const rId = sMatch[2];
    let target = relTargetMap.get(rId) || "";
    if (target && !target.startsWith("xl/")) {
      target = `xl/${target.replace(/^\.\//, "")}`;
    }
    if (target) {
      sheetEntries.push({ tabName, entryPath: target });
    }
  }

  const unmatchedTabs: string[] = [];
  const extractedStudents: StudentDemoScoreExtract[] = [];

  const isGenericTabOrPlaceholder = (norm: string): boolean => {
    if (!norm) return true;
    return (
      norm === "copy" ||
      /^copy of /.test(norm) ||
      /^sheet\s*\d*$/.test(norm) ||
      /^hv\s*\d*$/.test(norm) ||
      norm === "ten hoc vien" ||
      norm === "ho va ten"
    );
  };

  const findCandidatesByName = (normQuery: string) => {
    if (isGenericTabOrPlaceholder(normQuery)) return [];
    const exactMatches = students.filter(
      (stu) => normalizeVietnameseName(stu.fullName) === normQuery
    );
    if (exactMatches.length > 0) return exactMatches;

    return students.filter((stu) => {
      const normStu = normalizeVietnameseName(stu.fullName);
      if (!normStu) return false;
      const stuWords = normStu.split(" ");
      const queryWords = normQuery.split(" ");
      if (queryWords.length >= 2) {
        return (
          normStu.endsWith(` ${normQuery}`) ||
          normQuery.endsWith(` ${normStu}`) ||
          normStu.includes(normQuery) ||
          normQuery.includes(normStu)
        );
      }
      return stuWords[stuWords.length - 1] === normQuery;
    });
  };

  const stagedByStudentId = new Map<
    string,
    Array<{
      tabName: string;
      student: (typeof students)[number];
      extracted: ReturnType<typeof extractDemoScoresFromWorksheet>;
    }>
  >();

  for (const sheetInfo of sheetEntries) {
    const normTab = normalizeVietnameseName(sheetInfo.tabName);
    if (normTab === "phan bo diem" || normTab === "huong dan" || normTab === "rubric") {
      continue;
    }

    const wsEntry = zip.getEntry(sheetInfo.entryPath);
    if (!wsEntry) continue;
    const wsXml = wsEntry.getData().toString("utf8");
    const cells = parseWorksheetCells(wsXml, sharedStrings);
    const extracted = extractDemoScoresFromWorksheet(cells, normalizedClassId, wsXml);

    const normCellB2 = normalizeVietnameseName(extracted.studentNameInCellB2);
    const b2Candidates = findCandidatesByName(normCellB2);
    const tabCandidates = findCandidatesByName(normTab);

    // Check for conflict when both B2 and tabName specify non-generic student names
    if (b2Candidates.length > 0 && tabCandidates.length > 0) {
      const commonIds = b2Candidates
        .map((s) => s.studentId)
        .filter((id) => tabCandidates.some((t) => t.studentId === id));
      if (commonIds.length !== 1) {
        unmatchedTabs.push(sheetInfo.tabName);
        continue;
      }
    }

    let matchedStudent: (typeof students)[number] | null = null;
    if (b2Candidates.length === 1) {
      matchedStudent = b2Candidates[0];
    } else if (b2Candidates.length === 0 && tabCandidates.length === 1) {
      matchedStudent = tabCandidates[0];
    }

    // Reject unmatched, ambiguous (> 1 candidates), or unscored/incomplete sheets
    if (!matchedStudent || !extracted.hasCompleteScores) {
      unmatchedTabs.push(sheetInfo.tabName);
      continue;
    }

    const list = stagedByStudentId.get(matchedStudent.studentId) || [];
    list.push({
      tabName: sheetInfo.tabName,
      student: matchedStudent,
      extracted,
    });
    stagedByStudentId.set(matchedStudent.studentId, list);
  }

  const resolvedSlots =
    options?.checkpointSlots ??
    (Array.isArray(options?.classByIdGql?.slots) ? options.classByIdGql.slots : undefined);
  const demoLimits = getSession14DemoLimitsForClass(normalizedClassId);
  const isRobotics = isRoboticsClassCode(normalizedClassId);
  let usedLiveCheckpointsCount = 0;
  let usedCachedCheckpointsCount = 0;

  for (const [, entries] of stagedByStudentId.entries()) {
    // Reject duplicate tabs targeting the same studentId so neither overwrites the other
    if (entries.length !== 1) {
      for (const dup of entries) {
        unmatchedTabs.push(dup.tabName);
      }
      continue;
    }

    const { tabName, student: matchedStudent, extracted } = entries[0];
    const s14Draft = spckSessionRepo.findOne(normalizedClassId, matchedStudent.studentId, 14);
    const existingEval = session14EvalRepo.getOrInit(normalizedClassId, matchedStudent.studentId);
    if (options?.onlyMissingStudents && Number(existingEval.demoTotalScore) > 0) {
      continue;
    }
    let quickTags: string[] = [];
    try {
      quickTags = JSON.parse(existingEval.quickTagsJson || s14Draft?.quickTagsJson || "[]");
    } catch {
      quickTags = [];
    }

    // 1. Compute 9 [ĐNL] Competency ratings from Checkpoint 1 & Checkpoint 2 if available
    const cpResult = computeSession14CompetencyFromCheckpoints({
      classId: normalizedClassId,
      studentId: matchedStudent.studentId,
      fullName: matchedStudent.fullName,
      slots: resolvedSlots,
      cp1Slot: options?.cp1Slot,
      cp2Slot: options?.cp2Slot,
    });

    let finalCompScores: SpckSession14CompetencyScores;
    let finalCompTotal: number;
    let competencySourceMeta: Record<string, unknown>;

    let existingCompSrcObj: Record<string, unknown> | null = null;
    if (existingEval.competencySourceJson && existingEval.competencySourceJson !== "{}") {
      try {
        existingCompSrcObj = JSON.parse(existingEval.competencySourceJson);
      } catch {
        existingCompSrcObj = null;
      }
    }

    if (cpResult.matchedFromCheckpoints) {
      usedLiveCheckpointsCount++;
      finalCompScores = cpResult.competencyScores;
      finalCompTotal = cpResult.competencyTotalScore;
      competencySourceMeta = {
        source: cpResult.sourceType,
        cp1SlotNumber: cpResult.cp1SlotNumber,
        cp2SlotNumber: cpResult.cp2SlotNumber,
        cp1Avg: cpResult.cp1Avg,
        cp2Avg: cpResult.cp2Avg,
        targetAvg: cpResult.targetAvg,
      };
    } else if (
      existingCompSrcObj &&
      typeof existingCompSrcObj.source === "string" &&
      existingCompSrcObj.source.startsWith("CHECKPOINT_")
    ) {
      usedCachedCheckpointsCount++;
      finalCompScores = parseSession14CompetencyScores(existingEval.competencyJson);
      finalCompTotal = calculateCompetencyAverageScore(finalCompScores);
      competencySourceMeta = existingCompSrcObj;
    } else {
      const suggestedComp = suggestCompetencyScoresForStudent({
        classId: normalizedClassId,
        studentId: matchedStudent.studentId,
        demoScores: extracted.demoScores,
        quickTags,
        teacherNote: existingEval.teacherNote || s14Draft?.teacherNote || "",
      });
      finalCompScores = suggestedComp.competencyScores;
      finalCompTotal = suggestedComp.competencyTotalScore;
      competencySourceMeta = { source: "FALLBACK_DEMO_HEURISTIC" };
    }

    // 2. Auto-suggest Session 14 presentation Quick Tag from BGK `communication` score onto Session 14 SPCK draft
    const suggestedPresTag = suggestSession14PresentationTagFromDemoScore(
      extracted.demoScores.communication,
      demoLimits.communication
    );
    if (
      suggestedPresTag &&
      s14Draft &&
      s14Draft.draftStatus !== "APPROVED" &&
      s14Draft.draftStatus !== "SAVING" &&
      s14Draft.draftStatus !== "VERIFIED" &&
      !s14Draft.lastVerifiedAt
    ) {
      let s14Tags: string[] = [];
      try {
        const parsed = JSON.parse(s14Draft.quickTagsJson || "[]");
        if (Array.isArray(parsed)) {
          s14Tags = parsed.map((t) => String(t || "").trim()).filter(Boolean);
        }
      } catch {
        s14Tags = [];
      }
      if (!s14Tags.some((t) => isPresentationQuickTag(t))) {
        spckSessionRepo.saveSessionDraft({
          classId: normalizedClassId,
          studentId: matchedStudent.studentId,
          sessionNumber: 14,
          quickTagsJson: JSON.stringify([suggestedPresTag, ...s14Tags]),
          updateSharedPool: false,
        });
      }
    }

    const saved = session14EvalRepo.saveDraft({
      classId: normalizedClassId,
      studentId: matchedStudent.studentId,
      demoScores: extracted.demoScores,
      demoRawTotalScore: extracted.demoRawTotalScore,
      demoSourcePath: sourceUsed,
      demoJudgeNote: extracted.judgeNote,
      competencyScores: finalCompScores,
      competencySource: competencySourceMeta,
    });

    extractedStudents.push({
      studentId: matchedStudent.studentId,
      fullName: matchedStudent.fullName,
      matchedTabName: tabName,
      demoScores: extracted.demoScores,
      demoTotalScore: extracted.demoTotalScore,
      demoRawTotalScore: extracted.demoRawTotalScore,
      rawScoreText: formatRawDemoScore3dp(extracted.demoRawTotalScore),
      awardRank: null,
      awardTier: "UNSCORED",
      awardLabel: "",
      awardBadge: "",
      judgeNote: extracted.judgeNote,
      competencyScores: finalCompScores,
      competencyTotalScore: finalCompTotal,
      competencySource: competencySourceMeta,
      updatedRecord: saved.record,
    });
  }

  // 3. Compute class-wide 3dp Award Rankings & Slot 14 Summary Draft
  const summaryBundle = buildClassSession14SummaryDraft(normalizedClassId);
  const rankMap = new Map(summaryBundle.rankings.map((r) => [r.studentId, r]));
  const maxDemoStr = calculateDemoTotalScore(demoLimits).toFixed(1);

  for (const item of extractedStudents) {
    const rankInfo = rankMap.get(item.studentId);
    if (rankInfo) {
      item.awardRank = rankInfo.awardRank;
      item.awardTier = rankInfo.awardTier;
      item.awardLabel = rankInfo.awardLabel;
      item.awardBadge = rankInfo.awardBadge;
      item.rawScoreText = rankInfo.rawScoreText;

      // Only Robotics classes have the 4th Quill editor (`awardRanking`) on MindX LMS!
      if (isRobotics && rankInfo.awardTier !== "UNSCORED") {
        const autoRoboticsAward = `${rankInfo.awardLabel} (${rankInfo.rawScoreText}/${maxDemoStr} điểm)`;
        const updated = session14EvalRepo.saveDraft({
          classId: normalizedClassId,
          studentId: item.studentId,
          awardRanking: autoRoboticsAward,
        });
        item.updatedRecord = updated.record;
      } else if (!isRobotics && item.updatedRecord.awardRanking) {
        const updated = session14EvalRepo.saveDraft({
          classId: normalizedClassId,
          studentId: item.studentId,
          awardRanking: "",
        });
        item.updatedRecord = updated.record;
      }
    }
  }

  const classSummary = session14ClassSummaryRepo.saveAutoGenerated({
    classId: normalizedClassId,
    title: summaryBundle.title,
    bodyText: summaryBundle.bodyText,
    summaryHtml: summaryBundle.summaryHtml,
  });

  const checkpointSourceUsed: ImportDemoScoresResult["checkpointSourceUsed"] =
    usedLiveCheckpointsCount > 0
      ? "LMS_CHECKPOINTS"
      : usedCachedCheckpointsCount > 0
      ? "CACHED_CHECKPOINTS"
      : "DEMO_FALLBACK";

  return {
    classId: normalizedClassId,
    sourceUsed,
    checkpointSourceUsed,
    matchedCount: extractedStudents.length,
    unmatchedTabs,
    students: extractedStudents,
    rankings: summaryBundle.rankings,
    classSummary,
  };
}

/**
 * High-level entry point to import Demo Scores from a local .xlsx path, Google Sheet URL, or auto-discovered class sheet,
 * automatically reading Checkpoint 1 & Checkpoint 2 `[ĐNL]` ratings from live MindX LMS when online.
 */
export async function importClassDemoScores(
  classId: string,
  sourcePathOrUrl?: string,
  options?: ParseDemoWorkbookOptions
): Promise<ImportDemoScoresResult> {
  const { buffer, sourceUsed } = await loadXlsxBufferFromSource(classId, sourcePathOrUrl);

  let checkpointSlots =
    options?.checkpointSlots ??
    (Array.isArray(options?.classByIdGql?.slots) ? options.classByIdGql.slots : undefined);

  const isIsolatedTestEnv =
    Boolean(process.env.MINDX_DB_PATH?.trim()) ||
    process.env.MINDX_DISABLE_BROWSER_EXPORT_FALLBACK === "1";

  const shouldFetchLiveCheckpoints =
    !checkpointSlots &&
    !options?.cp1Slot &&
    !options?.cp2Slot &&
    !options?.skipLiveLmsCheckpointFetch &&
    (options?.forceLiveLmsCheckpointFetch === true || !isIsolatedTestEnv);

  if (shouldFetchLiveCheckpoints) {
    const liveSlots = await fetchLiveLmsCheckpointSlotsSafe(classId);
    if (Array.isArray(liveSlots) && liveSlots.length > 0) {
      checkpointSlots = liveSlots;
    }
  }

  return parseDemoWorkbookBufferForClass(classId, buffer, sourceUsed, {
    ...options,
    checkpointSlots,
  });
}
