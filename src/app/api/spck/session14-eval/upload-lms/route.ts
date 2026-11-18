import { NextResponse } from "next/server";
import { buildEnrichedSession14EvalList } from "@/lib/db/sqlite";
import { getEffectiveClassSession14Summary } from "@/lib/local-files/spck-demo-score-reader";
import { Session14EvalUploader } from "@/lib/playwright/session14-eval-uploader";
import { validateLocalRequest } from "@/lib/security/local-guard";

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const classId = String(body?.classId || "").trim().toUpperCase();
    const studentIds: string[] = Array.isArray(body?.studentIds)
      ? body.studentIds.map((s: unknown) => String(s || "").trim()).filter(Boolean)
      : [];
    const classSummaryHtml =
      typeof body?.classSummaryHtml === "string" ? body.classSummaryHtml.trim() : undefined;
    const uploadClassSummary =
      typeof body?.uploadClassSummary === "boolean" ? body.uploadClassSummary : undefined;
    const skipUnapproved = Boolean(body?.skipUnapproved || body?.allowPartial);

    if (!classId) {
      return NextResponse.json(
        { success: false, error: "Thiếu mã lớp (classId) khi đẩy đánh giá Buổi 14 lên LMS." },
        { status: 400 }
      );
    }

    const uploadResult = await Session14EvalUploader.uploadApprovedEvaluations({
      classId,
      studentIds: studentIds.length > 0 ? studentIds : undefined,
      classSummaryHtml,
      uploadClassSummary,
      skipUnapproved,
    });

    const records = buildEnrichedSession14EvalList(classId);
    const { classSummary, rankings } = getEffectiveClassSession14Summary(classId);

    const summaryOk = uploadResult.classSummaryStatus !== "FAILED";
    return NextResponse.json({
      success:
        uploadResult.failedCount === 0 &&
        uploadResult.demotedCount === 0 &&
        summaryOk,
      uploadResult,
      records,
      rankings,
      classSummary,
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
