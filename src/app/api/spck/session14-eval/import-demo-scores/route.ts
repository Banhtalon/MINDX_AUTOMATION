import { NextResponse } from "next/server";
import { buildEnrichedSession14EvalList } from "@/lib/db/sqlite";
import {
  getEffectiveClassSession14Summary,
  importClassDemoScores,
} from "@/lib/local-files/spck-demo-score-reader";
import { validateLocalRequest } from "@/lib/security/local-guard";

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const classId = String(body?.classId || "").trim().toUpperCase();
    const sourcePathOrUrl = String(body?.sourcePathOrUrl || "").trim();
    const onlyMissingStudents = Boolean(body?.onlyMissingStudents);

    if (!classId) {
      return NextResponse.json(
        { success: false, error: "Thiếu mã lớp (classId) để đọc điểm Demo." },
        { status: 400 }
      );
    }

    const importResult = await importClassDemoScores(
      classId,
      sourcePathOrUrl || undefined,
      {
        onlyMissingStudents,
        checkpointSlots: Array.isArray(body?.checkpointSlots)
          ? body.checkpointSlots
          : undefined,
        cp1Slot: body?.cp1Slot,
        cp2Slot: body?.cp2Slot,
        classByIdGql: body?.classByIdGql,
        skipLiveLmsCheckpointFetch: Boolean(body?.skipLiveLmsCheckpointFetch),
        forceLiveLmsCheckpointFetch: Boolean(body?.forceLiveLmsCheckpointFetch),
      }
    );
    const records = buildEnrichedSession14EvalList(classId);
    const { classSummary, rankings } = getEffectiveClassSession14Summary(classId);

    return NextResponse.json({
      success: true,
      importResult,
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
      { status: 400 }
    );
  }
}
