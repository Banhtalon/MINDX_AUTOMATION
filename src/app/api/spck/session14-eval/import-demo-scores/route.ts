import { NextResponse } from "next/server";
import { importClassDemoScores } from "@/lib/local-files/spck-demo-score-reader";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { buildEnrichedSession14EvalList } from "../route";

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const classId = String(body?.classId || "").trim().toUpperCase();
    const sourcePathOrUrl = String(body?.sourcePathOrUrl || "").trim();

    if (!classId) {
      return NextResponse.json(
        { success: false, error: "Thiếu mã lớp (classId) để đọc điểm Demo." },
        { status: 400 }
      );
    }

    const importResult = await importClassDemoScores(classId, sourcePathOrUrl || undefined);
    const records = buildEnrichedSession14EvalList(classId);

    return NextResponse.json({
      success: true,
      importResult,
      records,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 400 }
    );
  }
}
