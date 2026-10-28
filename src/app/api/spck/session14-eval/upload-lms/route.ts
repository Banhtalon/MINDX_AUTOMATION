import { NextResponse } from "next/server";
import { Session14EvalUploader } from "@/lib/playwright/session14-eval-uploader";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { buildEnrichedSession14EvalList } from "../route";

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const classId = String(body?.classId || "").trim().toUpperCase();
    const studentIds: string[] = Array.isArray(body?.studentIds)
      ? body.studentIds.map((s: unknown) => String(s || "").trim()).filter(Boolean)
      : [];

    if (!classId) {
      return NextResponse.json(
        { success: false, error: "Thiếu mã lớp (classId) khi đẩy đánh giá Buổi 14 lên LMS." },
        { status: 400 }
      );
    }

    const uploadResult = await Session14EvalUploader.uploadApprovedEvaluations({
      classId,
      studentIds: studentIds.length > 0 ? studentIds : undefined,
    });

    const records = buildEnrichedSession14EvalList(classId);

    return NextResponse.json({
      success: uploadResult.failedCount === 0 && uploadResult.demotedCount === 0,
      uploadResult,
      records,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
