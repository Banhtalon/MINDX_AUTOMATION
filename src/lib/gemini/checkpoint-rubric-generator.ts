/**
 * MINDX AUTOMATION BOT - CHECKPOINT RUBRIC AI GENERATOR (100-POINT SCALE)
 * Generates or updates a deterministic 100-point `GradingRubric` (integer `maxPoints` summing strictly to 100)
 * from teacher-provided assignment prompt text, prompt screenshot(s), and optional reference dataset preview.
 * Zero student PII is ever passed to this generator.
 */

import { getGeminiModel } from "./client";
import type { GradingCriterion, GradingRubric } from "../types";

export interface GenerateCheckpointRubricInput {
  courseCode: string;
  sessionNumber: number;
  promptText?: string;
  imageParts?: Array<{ inlineData: { mimeType: string; data: string } }>;
  datasetPreviewText?: string;
  datasetFileName?: string;
}

/**
 * Normalizes raw criterion `maxPoints` into positive integers whose sum equals `100` exactly.
 */
export function normalizeCriteriaMaxPointsTo100(
  rawCriteria: Array<{
    criterionId?: string;
    name?: string;
    maxPoints?: number;
    description?: string;
    expectedSnippetOrConcept?: string;
  }>
): GradingCriterion[] {
  const cleaned = rawCriteria
    .map((c, idx) => ({
      criterionId: `CRIT_${String(idx + 1).padStart(2, "0")}`,
      name: String(c?.name || `Tiêu chí ${idx + 1}`).trim(),
      rawWeight:
        typeof c?.maxPoints === "number" && Number.isFinite(c.maxPoints) && c.maxPoints > 0
          ? c.maxPoints
          : 25,
      description: String(c?.description || "").trim() || "Hoàn thành đúng yêu cầu của tiêu chí.",
      expectedSnippetOrConcept: String(c?.expectedSnippetOrConcept || "").trim(),
    }))
    .filter((c) => c.name.length > 0)
    .slice(0, 8);

  if (cleaned.length === 0) {
    throw new Error("Barem phải có ít nhất 1 tiêu chí hợp lệ.");
  }

  const weightSum = cleaned.reduce((s, c) => s + c.rawWeight, 0) || 100;
  const exactQuotas = cleaned.map((c) => (c.rawWeight / weightSum) * 100);
  const intPoints = exactQuotas.map((q) => Math.max(1, Math.floor(q)));
  let diff = 100 - intPoints.reduce((s, p) => s + p, 0);

  const remainders = exactQuotas
    .map((q, idx) => ({ idx, rem: q - intPoints[idx] }))
    .sort((a, b) => b.rem - a.rem || a.idx - b.idx);

  let rIdx = 0;
  while (diff > 0) {
    intPoints[remainders[rIdx % remainders.length].idx] += 1;
    diff -= 1;
    rIdx += 1;
  }
  while (diff < 0) {
    const candidateIdx = intPoints.findIndex((p) => p > 1);
    if (candidateIdx === -1) break;
    intPoints[candidateIdx] -= 1;
    diff += 1;
  }

  return cleaned.map((c, idx) => ({
    criterionId: c.criterionId,
    name: c.name,
    maxPoints: intPoints[idx],
    description: c.description,
    expectedSnippetOrConcept: c.expectedSnippetOrConcept,
  }));
}

export async function generateCheckpointRubricWithAi(
  input: GenerateCheckpointRubricInput
): Promise<GradingRubric> {
  const courseCode = String(input.courseCode || "").trim().toUpperCase();
  const sessionNumber = Number(input.sessionNumber || 5);
  const rubricId = `${courseCode}_SESSION_${String(sessionNumber).padStart(2, "0")}`;

  const hasText = Boolean(String(input.promptText || "").trim());
  const hasImages = Array.isArray(input.imageParts) && input.imageParts.length > 0;
  if (!hasText && !hasImages) {
    throw new Error("Vui lòng nhập nội dung đề bài hoặc tải lên ít nhất 1 ảnh chụp đề bài.");
  }

  const datasetBlock = input.datasetPreviewText
    ? `\n### DỮ LIỆU MẪU ĐÍNH KÈM (${input.datasetFileName || "dataset.csv"}):\n\`\`\`\n${input.datasetPreviewText.slice(0, 3000)}\n\`\`\`\n*(Hãy tự tính toán chính xác đáp án chuẩn từ dữ liệu mẫu trên và ghi rõ đáp án số học/kết quả mong đợi vào trường description & expectedSnippetOrConcept của từng tiêu chí để chấm chính xác!)*`
    : "";

  const prompt = `
Bạn là Tổ trưởng Chuyên môn Lập trình & Khoa học Dữ liệu tại MindX Technology School.
Hãy đọc kỹ đề bài kiểm tra Checkpoint (khóa "${courseCode}", Buổi ${sessionNumber}) dưới đây và thiết kế Barem chấm điểm chuẩn trên **THANG 100 ĐIỂM** (số nguyên).

### YÊU CẦU THIẾT KẾ BAREM:
1. Trích xuất đầy đủ yêu cầu của đề bài vào "assignmentTitle" và "assignmentPrompt".
2. Chia thành **3 đến 5 tiêu chí** rõ ràng, bám sát từng bước/câu hỏi trong đề bài (ví dụ: Đọc & Làm sạch dữ liệu + Câu 1 + Câu 2 + Câu 3).
3. Tổng "maxPoints" của tất cả tiêu chí PHẢI ĐÚNG BẰNG **100** (mỗi tiêu chí là số nguyên dương, ưu tiên bội số của 5 như 20, 25, 30).
4. Trong "description" và "expectedSnippetOrConcept" của mỗi tiêu chí: nêu rõ yêu cầu kỹ thuật, các cách làm hợp lệ được chấp nhận và đáp án đúng (nếu có dữ liệu mẫu đi kèm).

${hasText ? `### VĂN BẢN ĐỀ BÀI DO GIÁO VIÊN CUNG CẤP:\n${String(input.promptText).trim()}\n` : ""}
${datasetBlock}

### ĐỊNH DẠNG JSON ĐẦU RA BẮT BUỘC:
{
  "assignmentTitle": "Checkpoint ...: ...",
  "assignmentPrompt": "Tóm tắt đầy đủ đề bài và các câu hỏi...",
  "criteria": [
    {
      "criterionId": "CRIT_01",
      "name": "Tên tiêu chí 1",
      "maxPoints": 25,
      "description": "Mô tả chi tiết yêu cầu đạt điểm tối đa và hướng xử lý lỗi...",
      "expectedSnippetOrConcept": "Gợi ý hàm/khái niệm/đáp án mong đợi"
    }
  ]
}
`.trim();

  const model = getGeminiModel(undefined, 0.15);
  const parts: any[] = [prompt];
  if (hasImages && input.imageParts) {
    parts.push(...input.imageParts);
  }

  const resp = await model.generateContent(parts);
  const rawJsonStr = String(resp.response.text() || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(rawJsonStr) as {
    assignmentTitle?: string;
    assignmentPrompt?: string;
    criteria?: Array<{
      criterionId?: string;
      name?: string;
      maxPoints?: number;
      description?: string;
      expectedSnippetOrConcept?: string;
    }>;
  };

  const normalizedCriteria = normalizeCriteriaMaxPointsTo100(parsed?.criteria || []);

  return {
    rubricId,
    courseCode,
    sessionNumber,
    assignmentTitle:
      String(parsed?.assignmentTitle || `Bài kiểm tra Checkpoint (${courseCode} - Buổi ${sessionNumber})`).trim(),
    assignmentPrompt:
      String(parsed?.assignmentPrompt || input.promptText || "Chấm theo barem chi tiết.").trim(),
    maxTotalScore: 100,
    criteria: normalizedCriteria,
  };
}
