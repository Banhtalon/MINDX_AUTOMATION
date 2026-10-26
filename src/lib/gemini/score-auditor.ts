import type { GradingRubric, GradingCriterion } from "../db/json-config";

export interface CriterionGradeItem {
  criterionId: string;
  criterionName: string;
  earnedPoints: number;
  maxPoints: number;
  evidenceSnippet: string;
  deductionReason: string;
}

export interface ScoreAuditResult {
  valid: boolean;
  auditedCriteria: CriterionGradeItem[];
  calculatedScore: number;
  maxTotalScore: number;
  errors: string[];
}

/**
 * Deterministically sums `earnedPoints` across all criterion items in TypeScript.
 * Strictly ignores any total score field produced by an LLM.
 */
export function calculateTotalScoreFromCriteria(
  criteriaGrades: ReadonlyArray<{ earnedPoints: number }>
): number {
  if (!Array.isArray(criteriaGrades) || criteriaGrades.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const item of criteriaGrades) {
    const pts = Number(item?.earnedPoints);
    if (!Number.isFinite(pts)) {
      throw new Error(`[ScoreAuditor] earnedPoints không hợp lệ: ${String(item?.earnedPoints)}`);
    }
    sum += pts;
  }
  return Math.round(sum * 100) / 100;
}

/**
 * Validates per-criterion grades against the authoritative `GradingRubric`:
 * 1. Verifies every rubric criterion is evaluated exactly once.
 * 2. Enforces `0 <= earnedPoints <= criterion.maxPoints` against the rubric's authoritative `maxPoints`.
 * 3. Requires non-empty `evidenceSnippet` for every criterion, and non-empty `deductionReason` whenever `earnedPoints < maxPoints`.
 * 4. Computes `calculatedScore = sum(earnedPoints)` purely in TypeScript (never trusting LLM's total).
 */
export function auditCriterionGrades(
  rawGrades: unknown,
  rubric: Pick<GradingRubric, "criteria" | "maxTotalScore">
): ScoreAuditResult {
  const errors: string[] = [];

  if (!rubric || !Array.isArray(rubric.criteria) || rubric.criteria.length === 0) {
    return {
      valid: false,
      auditedCriteria: [],
      calculatedScore: 0,
      maxTotalScore: 0,
      errors: ["[ScoreAuditor] Barem chấm điểm (rubric.criteria) trống hoặc không hợp lệ."],
    };
  }

  if (!Array.isArray(rawGrades)) {
    return {
      valid: false,
      auditedCriteria: [],
      calculatedScore: 0,
      maxTotalScore: rubric.maxTotalScore || 100,
      errors: ["[ScoreAuditor] Danh sách điểm tiêu chí trả về không phải là mảng."],
    };
  }

  const rubricMap = new Map<string, GradingCriterion>();
  let rubricMaxSum = 0;
  for (const crit of rubric.criteria) {
    const cid = String(crit?.criterionId || "").trim();
    if (!cid) {
      errors.push("[ScoreAuditor] Tiêu chí trong barem thiếu criterionId.");
      continue;
    }
    if (rubricMap.has(cid)) {
      errors.push(`[ScoreAuditor] Barem chấm điểm chứa mã tiêu chí bị trùng lặp: '${cid}'.`);
      continue;
    }
    const maxPts = Number(crit?.maxPoints);
    if (typeof crit?.maxPoints !== "number" || !Number.isFinite(maxPts) || maxPts <= 0 || maxPts > 100) {
      errors.push(
        `[ScoreAuditor] Tiêu chí '${cid}' trong barem có maxPoints không hợp lệ (${String(crit?.maxPoints)}).`
      );
      continue;
    }
    rubricMap.set(cid, crit);
    rubricMaxSum += maxPts;
  }

  const maxTotalScore =
    typeof rubric.maxTotalScore === "number" && Number.isFinite(rubric.maxTotalScore) && rubric.maxTotalScore > 0
      ? rubric.maxTotalScore
      : rubricMaxSum;

  if (
    typeof rubric.maxTotalScore === "number" &&
    Number.isFinite(rubric.maxTotalScore) &&
    rubric.maxTotalScore > 0 &&
    Math.abs(rubricMaxSum - rubric.maxTotalScore) > 0.01
  ) {
    errors.push(
      `[ScoreAuditor] Tổng điểm tối đa của các tiêu chí (${rubricMaxSum}) không khớp với thang điểm barem (${rubric.maxTotalScore}).`
    );
  }

  if (Math.abs(rubricMaxSum - 100) > 0.01 || Math.abs(maxTotalScore - 100) > 0.01) {
    errors.push(
      `[ScoreAuditor] Barem chấm điểm phải có tổng điểm tối đa đúng bằng 100 theo thang điểm LMS (hiện tại tổng tiêu chí = ${rubricMaxSum}, maxTotalScore = ${maxTotalScore}). Nếu đang dùng barem cũ thang 10, vui lòng quy đổi sang thang 100.`
    );
  }

  if (errors.length > 0) {
    return {
      valid: false,
      auditedCriteria: [],
      calculatedScore: 0,
      maxTotalScore,
      errors,
    };
  }

  const seenIds = new Set<string>();
  const rawById = new Map<string, any>();

  for (const item of rawGrades) {
    const cid = String((item as any)?.criterionId || "").trim();
    if (!cid) {
      errors.push("[ScoreAuditor] Phát hiện mục chấm điểm thiếu criterionId.");
      continue;
    }
    if (seenIds.has(cid)) {
      errors.push(`[ScoreAuditor] Tiêu chí '${cid}' bị lặp lại nhiều lần trong kết quả chấm.`);
      continue;
    }
    if (!rubricMap.has(cid)) {
      errors.push(`[ScoreAuditor] Tiêu chí '${cid}' không tồn tại trong barem đã chọn.`);
      continue;
    }
    seenIds.add(cid);
    rawById.set(cid, item);
  }

  const auditedCriteria: CriterionGradeItem[] = [];

  for (const crit of rubric.criteria) {
    const cid = String(crit.criterionId || "").trim();
    const rawItem = rawById.get(cid);
    if (!rawItem) {
      errors.push(
        `[ScoreAuditor] Thiếu kết quả chấm cho tiêu chí bắt buộc '${cid}' (${crit.name}).`
      );
      continue;
    }

    const authoritativeMax = Number(crit.maxPoints);
    const earned = Number(rawItem.earnedPoints);

    if (typeof rawItem.earnedPoints !== "number" || !Number.isFinite(earned)) {
      errors.push(
        `[ScoreAuditor] Điểm đạt được của tiêu chí '${cid}' không phải là số hợp lệ (${String(
          rawItem.earnedPoints
        )}).`
      );
      continue;
    }

    if (earned < 0 || earned > authoritativeMax) {
      errors.push(
        `[ScoreAuditor] Điểm tiêu chí '${cid}' (${earned}) nằm ngoài khoảng cho phép [0, ${authoritativeMax}].`
      );
      continue;
    }

    const evidenceSnippet = String(rawItem.evidenceSnippet ?? "").trim();
    const deductionReason = String(rawItem.deductionReason ?? "").trim();

    if (!evidenceSnippet) {
      errors.push(
        `[ScoreAuditor] Tiêu chí '${cid}' (${crit.name}) thiếu bằng chứng trích dẫn code (evidenceSnippet).`
      );
    }

    if (earned < authoritativeMax && !deductionReason) {
      errors.push(
        `[ScoreAuditor] Tiêu chí '${cid}' (${crit.name}) bị trừ điểm (${earned}/${authoritativeMax}) nhưng thiếu lý do trừ điểm (deductionReason).`
      );
    }

    auditedCriteria.push({
      criterionId: cid,
      criterionName: crit.name,
      earnedPoints: Math.round(earned * 100) / 100,
      maxPoints: authoritativeMax,
      evidenceSnippet,
      deductionReason: earned === authoritativeMax ? deductionReason || "Đạt tối đa tiêu chí." : deductionReason,
    });
  }

  if (errors.length > 0) {
    return {
      valid: false,
      auditedCriteria,
      calculatedScore: 0,
      maxTotalScore,
      errors,
    };
  }

  const calculatedScore = calculateTotalScoreFromCriteria(auditedCriteria);

  if (calculatedScore < 0 || calculatedScore > maxTotalScore) {
    return {
      valid: false,
      auditedCriteria,
      calculatedScore: 0,
      maxTotalScore,
      errors: [
        `[ScoreAuditor] Tổng điểm tính toán (${calculatedScore}) vượt ngoài thang điểm [0, ${maxTotalScore}].`,
      ],
    };
  }

  return {
    valid: true,
    auditedCriteria,
    calculatedScore,
    maxTotalScore,
    errors: [],
  };
}
