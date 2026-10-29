import { NextRequest, NextResponse } from "next/server";
import { parseStrictPositiveIntInput } from "@/lib/playwright/teaching-project-service";
import { TeachingReportCardSyncService } from "@/lib/playwright/teaching-report-card-sync";
import { validateLocalRequest } from "@/lib/security/local-guard";

export async function POST(request: NextRequest) {
  const guardError = validateLocalRequest(request);
  if (guardError) return guardError;

  let body: Record<string, any>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json(
        {
          success: false,
          error: "Dữ liệu gửi lên phải là một đối tượng JSON hợp lệ.",
        },
        { status: 400 }
      );
    }
    body = parsed as Record<string, any>;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Cú pháp JSON trong yêu cầu không hợp lệ.",
      },
      { status: 400 }
    );
  }

  try {
    const rawClassId =
      body?.classId !== undefined && body?.classId !== null
        ? String(body.classId).trim().toUpperCase()
        : "";
    const rawClassCode =
      body?.classCode !== undefined && body?.classCode !== null
        ? String(body.classCode).trim().toUpperCase()
        : "";

    if (rawClassId && rawClassCode && rawClassId !== rawClassCode) {
      return NextResponse.json(
        {
          success: false,
          error: `Mã lớp classId (${rawClassId}) và classCode (${rawClassCode}) không đồng nhất.`,
        },
        { status: 400 }
      );
    }

    const classId = rawClassId || rawClassCode;
    if (!classId) {
      return NextResponse.json(
        { success: false, error: "Thiếu mã lớp (classId / classCode)." },
        { status: 400 }
      );
    }

    const expectedVersion = parseStrictPositiveIntInput(body?.expectedVersion);
    if (expectedVersion === null) {
      return NextResponse.json(
        {
          success: false,
          error: "Thiếu phiên bản bản nháp hợp lệ (expectedVersion).",
        },
        { status: 400 }
      );
    }

    const syncRes = await TeachingReportCardSyncService.syncReportCardToTeaching(
      classId,
      {
        classCode: rawClassCode || classId,
        expectedVersion,
      }
    );

    if (!syncRes.success) {
      const status =
        syncRes.statusCode || (syncRes.conflict ? 409 : 400);
      return NextResponse.json(
        {
          success: false,
          conflict: syncRes.conflict,
          currentVersion: syncRes.currentVersion,
          classId: syncRes.classId,
          classCode: syncRes.classCode,
          error: syncRes.error,
          record: syncRes.record,
          reportCard: syncRes.reportCard,
        },
        { status }
      );
    }

    return NextResponse.json({
      success: true,
      classId: syncRes.classId,
      classCode: syncRes.classCode,
      syncedScoreCount: syncRes.syncedScoreCount,
      declaredExerciseCount: syncRes.declaredExerciseCount,
      record: syncRes.record,
      reportCard: syncRes.reportCard,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
