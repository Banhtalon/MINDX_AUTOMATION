import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { assertPathAllowed } from "@/lib/security/path-allowlist";
import {
  doesClassCodeMatchCourseCode,
  getGradingRubrics,
  saveGradingRubrics,
  type GradingRubric,
} from "@/lib/db/json-config";
import {
  generateCheckpointRubricWithAi,
} from "@/lib/gemini/checkpoint-rubric-generator";
import {
  isValidSafeRubricId,
  resolveRubricDatasetFiles,
} from "@/lib/file-parsers/python-notebook-verifier";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_B64_CHARS = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 1024;
const MAX_DATASET_BYTES = 5 * 1024 * 1024;
const MAX_DATASET_B64_CHARS = Math.ceil((MAX_DATASET_BYTES * 4) / 3) + 1024;

export function extractCourseCodeFromClassCode(classCode: string): string {
  const upper = String(classCode || "").trim().toUpperCase();
  const known = [
    "SEMIA",
    "SEMIB",
    "SEMII",
    "ARMI",
    "ARMA",
    "ARMB",
    "PTB",
    "PTA",
    "PTI",
    "CSB",
    "CSA",
    "CSI",
    "JSB",
    "JSA",
    "JSI",
    "GMB",
    "GMA",
    "GMI",
    "GB",
    "GA",
    "GI",
    "SB",
    "SA",
    "SI",
  ];
  for (const code of known) {
    if (doesClassCodeMatchCourseCode(upper, code)) {
      return code;
    }
  }
  const segs = upper.split(/[^A-Z0-9]+/).filter(Boolean);
  const candidate =
    segs.find((s) => !/^VT$|^HN$|^HCM$|^C4K$|^ROB$|^HB$/i.test(s)) || segs[0] || "CODING";
  const cleaned = (candidate.replace(/\d+$/, "") || candidate).replace(/[^A-Z0-9]/g, "");
  return cleaned || "CODING";
}

function getCheckpointDatasetDir(rubricId: string): string {
  if (!isValidSafeRubricId(rubricId)) {
    throw new Error(`Mã Barem (rubricId='${rubricId}') không hợp lệ.`);
  }
  const safeId = String(rubricId).trim();
  const configRoot = process.env.MINDX_CONFIG_DIR?.trim()
    ? path.resolve(process.cwd(), process.env.MINDX_CONFIG_DIR.trim())
    : path.resolve(process.cwd(), "data", "config");
  const datasetsBase = path.resolve(configRoot, "checkpoint-datasets");
  const candidateDir = path.resolve(datasetsBase, safeId);
  if (!candidateDir.toLowerCase().startsWith((datasetsBase + path.sep).toLowerCase())) {
    throw new Error(`[Security Exception] Đường dẫn dataset '${rubricId}' không hợp lệ.`);
  }
  return assertPathAllowed(candidateDir);
}

function detectAllowedImageMime(buf: Buffer): string | null {
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export async function GET(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const url = new URL(req.url);
    const classCode = (url.searchParams.get("classCode") || "").trim().toUpperCase();
    const sessionNumber = Number(url.searchParams.get("sessionNumber") || 5);
    const courseCode =
      (url.searchParams.get("courseCode") || "").trim().toUpperCase() ||
      extractCourseCodeFromClassCode(classCode);

    const allRubrics = getGradingRubrics();
    const sorted = [...allRubrics].sort(
      (a, b) => (b.courseCode?.length || 0) - (a.courseCode?.length || 0)
    );
    const matched =
      sorted.find(
        (r) =>
          (classCode
            ? doesClassCodeMatchCourseCode(classCode, r.courseCode)
            : r.courseCode === courseCode) && Number(r.sessionNumber) === sessionNumber
      ) || null;

    const datasetFiles = matched
      ? resolveRubricDatasetFiles(matched.rubricId).map((d) => d.fileName)
      : [];

    return NextResponse.json({
      success: true,
      data: {
        courseCode,
        sessionNumber,
        rubric: matched,
        datasetFiles,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const mode = String(body.mode || "generate_ai").trim();
    const classCode = String(body.classCode || "").trim().toUpperCase();
    const sessionNumber = Number(body.sessionNumber || 5);
    if (!Number.isInteger(sessionNumber) || sessionNumber < 1 || sessionNumber > 14) {
      return NextResponse.json(
        { success: false, error: "Số buổi học (sessionNumber) không hợp lệ." },
        { status: 400 }
      );
    }

    const rawCourseCode =
      String(body.courseCode || "").trim().toUpperCase() ||
      extractCourseCodeFromClassCode(classCode);
    const courseCode = rawCourseCode.replace(/[^A-Z0-9_-]/g, "");
    if (!courseCode || courseCode.length > 32) {
      return NextResponse.json(
        { success: false, error: "Mã khóa học (courseCode) không hợp lệ." },
        { status: 400 }
      );
    }

    const rawRubricId = String(body.rubricId || "").trim();
    const rubricId =
      rawRubricId || `${courseCode}_SESSION_${String(sessionNumber).padStart(2, "0")}`;
    if (!isValidSafeRubricId(rubricId)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Mã Barem (rubricId) không hợp lệ (chỉ cho phép chữ cái, chữ số, '_' hoặc '-', độ dài 2..64 ký tự).",
        },
        { status: 400 }
      );
    }

    // Validate optional reference dataset in RAM first (write to disk ONLY after rubric validation/generation succeeds!)
    let datasetPreviewText = "";
    let savedDatasetFileName = "";
    let pendingDatasetWrite: { dsDir: string; safeName: string; buf: Buffer } | null = null;
    if (body.datasetFile && typeof body.datasetFile === "object") {
      const rawName = path.basename(String(body.datasetFile.fileName || "dataset.csv").trim());
      const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "");
      const ext = path.extname(safeName).toLowerCase();
      if (!safeName || ![".csv", ".tsv", ".json", ".txt"].includes(ext)) {
        return NextResponse.json(
          {
            success: false,
            error: "Tệp dữ liệu mẫu chỉ hỗ trợ định dạng .csv, .tsv, .json hoặc .txt.",
          },
          { status: 400 }
        );
      }
      const b64 = String(body.datasetFile.base64Data || "")
        .replace(/^data:[^;]+;base64,/, "")
        .trim();
      if (!b64 || b64.length > MAX_DATASET_B64_CHARS) {
        return NextResponse.json(
          { success: false, error: "Tệp dữ liệu mẫu rỗng hoặc vượt quá giới hạn 5MB." },
          { status: 400 }
        );
      }
      const buf = Buffer.from(b64, "base64");
      if (buf.length === 0 || buf.length > MAX_DATASET_BYTES) {
        return NextResponse.json(
          { success: false, error: "Tệp dữ liệu mẫu rỗng hoặc vượt quá giới hạn 5MB." },
          { status: 400 }
        );
      }
      const dsDir = getCheckpointDatasetDir(rubricId);
      pendingDatasetWrite = { dsDir, safeName, buf };
      savedDatasetFileName = safeName;
      datasetPreviewText = buf.toString("utf8").slice(0, 3000);
    } else {
      const existingDs = resolveRubricDatasetFiles(rubricId);
      if (existingDs.length > 0) {
        savedDatasetFileName = existingDs[0].fileName;
        datasetPreviewText = existingDs[0].buffer.toString("utf8").slice(0, 3000);
      }
    }

    let finalRubric: GradingRubric;

    if (mode === "save_manual" || mode === "save") {
      const rawRubric = body.rubric && typeof body.rubric === "object" ? body.rubric : body;
      const rawCriteria = Array.isArray(rawRubric.criteria) ? rawRubric.criteria : [];
      if (rawCriteria.length < 1 || rawCriteria.length > 8) {
        return NextResponse.json(
          {
            success: false,
            error: "Barem chấm điểm phải có từ 1 đến 8 tiêu chí.",
          },
          { status: 400 }
        );
      }

      const validatedCriteria: GradingRubric["criteria"] = [];
      const seenCriterionIds = new Set<string>();
      let sumPoints = 0;
      for (let i = 0; i < rawCriteria.length; i++) {
        const c = rawCriteria[i];
        const cName = String(c?.name || "").trim();
        const cMax = Number(c?.maxPoints);
        if (!cName) {
          return NextResponse.json(
            { success: false, error: `Tiêu chí #${i + 1} không được để trống tên.` },
            { status: 400 }
          );
        }
        if (!Number.isInteger(cMax) || cMax <= 0 || cMax > 100) {
          return NextResponse.json(
            {
              success: false,
              error: `Điểm tối đa của tiêu chí '${cName}' phải là số nguyên dương (1..100).`,
            },
            { status: 400 }
          );
        }
        const resolvedCritId =
          String(c?.criterionId || "").trim().replace(/[^A-Za-z0-9_-]/g, "") ||
          `CRIT_${String(i + 1).padStart(2, "0")}`;
        if (seenCriterionIds.has(resolvedCritId)) {
          return NextResponse.json(
            {
              success: false,
              error: `Trùng lặp mã tiêu chí '${resolvedCritId}' trong Barem. Mỗi tiêu chí phải có mã riêng biệt.`,
            },
            { status: 400 }
          );
        }
        seenCriterionIds.add(resolvedCritId);
        sumPoints += cMax;
        validatedCriteria.push({
          criterionId: resolvedCritId,
          name: cName,
          maxPoints: cMax,
          description:
            String(c?.description || "").trim() || "Hoàn thành đúng yêu cầu của tiêu chí.",
          expectedSnippetOrConcept: String(c?.expectedSnippetOrConcept || "").trim(),
        });
      }

      if (sumPoints !== 100) {
        return NextResponse.json(
          {
            success: false,
            error: `Tổng điểm các tiêu chí hiện tại là ${sumPoints}/100. Vui lòng điều chỉnh đúng bằng 100 điểm nguyên.`,
          },
          { status: 400 }
        );
      }

      finalRubric = {
        rubricId,
        courseCode,
        sessionNumber,
        assignmentTitle: String(
          rawRubric.assignmentTitle || `Checkpoint (${courseCode} - Buổi ${sessionNumber})`
        ).trim(),
        assignmentPrompt: String(rawRubric.assignmentPrompt || body.promptText || "").trim(),
        maxTotalScore: 100,
        criteria: validatedCriteria,
      };
    } else {
      const imageParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];
      const rawImages = Array.isArray(body.promptImages)
        ? body.promptImages
        : Array.isArray(body.images)
        ? body.images
        : [];
      for (const img of rawImages.slice(0, 3)) {
        const rawStr =
          typeof img === "string" ? img : String(img?.base64Data || img?.dataUrl || "");
        const cleanB64 = rawStr.replace(/^data:[^;]+;base64,/, "").trim();
        if (!cleanB64) continue;
        if (cleanB64.length > MAX_IMAGE_B64_CHARS) {
          return NextResponse.json(
            { success: false, error: "Ảnh đề bài vượt quá dung lượng tối đa 10MB." },
            { status: 400 }
          );
        }
        const imgBuf = Buffer.from(cleanB64, "base64");
        if (imgBuf.length === 0 || imgBuf.length > MAX_IMAGE_BYTES) {
          return NextResponse.json(
            { success: false, error: "Ảnh đề bài rỗng hoặc vượt quá 10MB." },
            { status: 400 }
          );
        }
        const mime = detectAllowedImageMime(imgBuf);
        if (!mime) {
          return NextResponse.json(
            { success: false, error: "Ảnh đề bài phải là PNG, JPG hoặc WEBP hợp lệ." },
            { status: 400 }
          );
        }
        imageParts.push({ inlineData: { mimeType: mime, data: imgBuf.toString("base64") } });
      }

      const promptTextVal = String(body.promptText ?? body.assignmentPrompt ?? "").trim();
      if (!promptTextVal && imageParts.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: "Vui lòng nhập nội dung đề bài hoặc tải lên ít nhất 1 ảnh chụp đề bài.",
          },
          { status: 400 }
        );
      }

      const generated = await generateCheckpointRubricWithAi({
        courseCode,
        sessionNumber,
        promptText: promptTextVal,
        imageParts,
        datasetPreviewText,
        datasetFileName: savedDatasetFileName,
      });
      finalRubric = {
        ...generated,
        rubricId,
        courseCode,
        sessionNumber,
        assignmentTitle:
          String(body.assignmentTitle || "").trim() || generated.assignmentTitle,
      };
    }

    if (pendingDatasetWrite) {
      fs.mkdirSync(pendingDatasetWrite.dsDir, { recursive: true });
      fs.writeFileSync(
        assertPathAllowed(path.join(pendingDatasetWrite.dsDir, pendingDatasetWrite.safeName)),
        pendingDatasetWrite.buf
      );
    }

    const allRubrics = getGradingRubrics();
    const existingIdx = allRubrics.findIndex(
      (r) =>
        r.rubricId === finalRubric.rubricId ||
        (r.courseCode.toUpperCase() === courseCode && Number(r.sessionNumber) === sessionNumber)
    );
    if (existingIdx >= 0) {
      allRubrics[existingIdx] = finalRubric;
    } else {
      allRubrics.push(finalRubric);
    }
    saveGradingRubrics(allRubrics);

    const datasetFiles = resolveRubricDatasetFiles(finalRubric.rubricId).map((d) => d.fileName);

    return NextResponse.json({
      success: true,
      data: {
        rubric: finalRubric,
        datasetFiles,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
