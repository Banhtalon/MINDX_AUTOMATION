import { NextRequest, NextResponse } from "next/server";
import {
  discoverRunningClassesForBatchSync,
  isBatchReportCardSyncRunning,
  runBatchReportCardSync,
  syncSingleClassReportCardFlow,
} from "@/lib/report-card/report-card-batch-sync";
import { validateLocalRequest } from "@/lib/security/local-guard";

export async function GET(request: NextRequest) {
  const guardError = validateLocalRequest(request);
  if (guardError) return guardError;

  return NextResponse.json({
    success: true,
    isRunning: isBatchReportCardSyncRunning(),
  });
}

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
    const action = typeof body.action === "string" ? body.action.trim() : "";

    if (action === "discover_classes") {
      const result = await discoverRunningClassesForBatchSync({
        refreshFromLms: body.refreshFromLms !== false,
      });
      return NextResponse.json(result, { status: result.statusCode });
    }

    if (action === "sync_single_class") {
      if (typeof body.classCode !== "string" || !body.classCode.trim()) {
        return NextResponse.json(
          {
            success: false,
            error: "Thiếu mã lớp hợp lệ (classCode).",
          },
          { status: 400 }
        );
      }

      const result = await syncSingleClassReportCardFlow(body.classCode, {
        forceSyncUnchanged: Boolean(body.forceSyncUnchanged),
      });
      return NextResponse.json(result, { status: result.statusCode });
    }

    if (action === "sync_all") {
      if (body.classCodes !== undefined) {
        if (
          !Array.isArray(body.classCodes) ||
          body.classCodes.some(
            (c: unknown) => typeof c !== "string" || !c.trim()
          )
        ) {
          return NextResponse.json(
            {
              success: false,
              error: "Danh sách mã lớp (classCodes) không hợp lệ.",
            },
            { status: 400 }
          );
        }
      }

      const result = await runBatchReportCardSync({
        classCodes: Array.isArray(body.classCodes)
          ? (body.classCodes as string[])
          : undefined,
        refreshFromLms: body.refreshFromLms !== false,
        forceSyncUnchanged: Boolean(body.forceSyncUnchanged),
      });
      return NextResponse.json(result, { status: result.statusCode });
    }

    return NextResponse.json(
      {
        success: false,
        error:
          "Hành động không hợp lệ. Chỉ hỗ trợ: 'discover_classes', 'sync_single_class', 'sync_all'.",
      },
      { status: 400 }
    );
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
