/**
 * MINDX AUTOMATION BOT - SHARED [ĐNL] COMPETENCY SPECIFICATIONS
 * Isomorphic (browser + server safe) single source of truth for the 9 [ĐNL] competency areas
 * ordered by MindX LMS Modal DOM[0..8].
 */

export interface CompetencyScores {
  knowledgeInClass: number;      // [ĐNL] Kiến thức học viên đã được học tại lớp (1..5)
  knowledgeSelfStudy: number;    // [ĐNL] Kiến thức học viên tự học (1..5)
  skillCommunication: number;    // [ĐNL] Kỹ năng giao tiếp, hợp tác (1..5)
  skillComputerUse: number;      // [ĐNL] Kỹ năng sử dụng máy tính (1..5)
  skillProblemSolving: number;   // [ĐNL] Kỹ năng giải quyết vấn đề (1..5)
  skillCreativity: number;       // [ĐNL] Tư duy sáng tạo (1..5)
  skillComputational: number;    // [ĐNL] Tư duy máy tính (1..5)
  attitudeHomework: number;      // [ĐNL] Thái độ luyện tập về nhà (1..5)
  attitudeInClass: number;       // [ĐNL] Thái độ học tập trên lớp (1..5)
}

export interface CompetencyAreaSpec {
  domIndex: number;
  key: keyof CompetencyScores;
  commentAreaId: string;
  commentAreaSuffix: string;
  labelVi: string;
  shortLabelVi: string;
  keywordsNorm: string[];
}

export const COMPETENCY_AREA_SPECS: readonly CompetencyAreaSpec[] = [
  {
    domIndex: 0,
    key: "knowledgeSelfStudy",
    commentAreaId: "665e7d33181e0e47f6c63768",
    commentAreaSuffix: "3768",
    labelVi: "[ĐNL] Kiến thức học viên tự học",
    shortLabelVi: "Kiến thức tự học",
    keywordsNorm: ["tu hoc"],
  },
  {
    domIndex: 1,
    key: "knowledgeInClass",
    commentAreaId: "668d69d8e71f90e7630ce16c",
    commentAreaSuffix: "e16c",
    labelVi: "[ĐNL] Kiến thức học viên đã được học tại lớp",
    shortLabelVi: "Kiến thức tại lớp",
    keywordsNorm: ["da duoc hoc tai lop", "hoc tai lop"],
  },
  {
    domIndex: 2,
    key: "skillCommunication",
    commentAreaId: "668e2e7de71f90e7630d4316",
    commentAreaSuffix: "4316",
    labelVi: "[ĐNL] Kỹ năng giao tiếp, hợp tác",
    shortLabelVi: "Giao tiếp, hợp tác",
    keywordsNorm: ["giao tiep"],
  },
  {
    domIndex: 3,
    key: "skillComputerUse",
    commentAreaId: "668e2ce1e71f90e7630d406f",
    commentAreaSuffix: "406f",
    labelVi: "[ĐNL] Kỹ năng sử dụng máy tính",
    shortLabelVi: "Sử dụng máy tính",
    keywordsNorm: ["su dung may tinh"],
  },
  {
    domIndex: 4,
    key: "skillProblemSolving",
    commentAreaId: "668e0f48e71f90e7630d2db6",
    commentAreaSuffix: "2db6",
    labelVi: "[ĐNL] Kỹ năng giải quyết vấn đề",
    shortLabelVi: "Giải quyết vấn đề",
    keywordsNorm: ["giai quyet van de"],
  },
  {
    domIndex: 5,
    key: "skillCreativity",
    commentAreaId: "668d6a69e71f90e7630ce198",
    commentAreaSuffix: "e198",
    labelVi: "[ĐNL] Tư duy sáng tạo",
    shortLabelVi: "Tư duy sáng tạo",
    keywordsNorm: ["sang tao"],
  },
  {
    domIndex: 6,
    key: "skillComputational",
    commentAreaId: "668d6a25e71f90e7630ce187",
    commentAreaSuffix: "e187",
    labelVi: "[ĐNL] Tư duy máy tính",
    shortLabelVi: "Tư duy máy tính",
    keywordsNorm: ["tu duy may tinh", "tu duy thuat toan"],
  },
  {
    domIndex: 7,
    key: "attitudeHomework",
    commentAreaId: "668e2f5be71f90e7630d44c1",
    commentAreaSuffix: "44c1",
    labelVi: "[ĐNL] Thái độ luyện tập về nhà",
    shortLabelVi: "Thái độ BTVN",
    keywordsNorm: ["luyen tap ve nha", "ve nha"],
  },
  {
    domIndex: 8,
    key: "attitudeInClass",
    commentAreaId: "668e2eaee71f90e7630d434f",
    commentAreaSuffix: "434f",
    labelVi: "[ĐNL] Thái độ học tập trên lớp",
    shortLabelVi: "Thái độ trên lớp",
    keywordsNorm: ["hoc tap tren lop", "tren lop"],
  },
] as const;

export const COMPETENCY_KEYS: Array<keyof CompetencyScores> = COMPETENCY_AREA_SPECS.map(
  (s) => s.key
);

export const DEFAULT_COMPETENCY_SCORES: CompetencyScores = {
  knowledgeInClass: 4,
  knowledgeSelfStudy: 4,
  skillCommunication: 4,
  skillComputerUse: 4,
  skillProblemSolving: 4,
  skillCreativity: 4,
  skillComputational: 4,
  attitudeHomework: 4,
  attitudeInClass: 4,
};

export function clampCompetencyRating(value: unknown, fallback = 4): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(1, Math.min(5, Math.round(num)));
}

export function parseCompetencyScoresPure(raw: unknown): CompetencyScores {
  const obj =
    typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return {};
          }
        })()
      : raw && typeof raw === "object"
        ? (raw as Record<string, unknown>)
        : {};
  const result = { ...DEFAULT_COMPETENCY_SCORES };
  for (const key of COMPETENCY_KEYS) {
    result[key] = clampCompetencyRating((obj as Record<string, unknown>)?.[key], 4);
  }
  return result;
}

export function hasCompleteCompetencyScores(raw: unknown): raw is CompetencyScores {
  if (!raw || typeof raw !== "object") return false;
  const obj = raw as Record<string, unknown>;
  return COMPETENCY_KEYS.every((key) => {
    const val = Number(obj[key]);
    return Number.isInteger(val) && val >= 1 && val <= 5;
  });
}

export function calculateCompetencyAveragePure(scores: CompetencyScores): number {
  let sum = 0;
  for (const key of COMPETENCY_KEYS) {
    sum += clampCompetencyRating(scores[key], 4);
  }
  return Number((sum / COMPETENCY_KEYS.length).toFixed(2));
}

export function isRoboticsClassCodePure(classId?: string | null): boolean {
  const s = String(classId || "").trim().toUpperCase();
  if (!s) return false;
  return /(?:^|[-_\s])(ROB|ROBO|ROBOT|ROBOTICS|PREB|PREA|PREI|ARM|ARMA|ARMB|ARMI|SEM|SEMA|SEMB|SEMI|EV3|VEX|SPIKE|WEDO|ARDUINO)[A-Z0-9]*\b/i.test(
    s
  );
}
