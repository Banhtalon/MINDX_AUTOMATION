import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { taskQueue } from "@/lib/queue/task-queue";
import { ClassSyncer } from "@/lib/playwright/sync-class";
import { type RunningClassItem } from "@/lib/db/json-config";
import { listClasses } from "@/lib/classes/class-directory";

function getMergedRunningClasses(): RunningClassItem[] {
  return listClasses({ scope: "running" });
}

export async function GET(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    return NextResponse.json({
      success: true,
      classes: getMergedRunningClasses(),
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
    const result = await taskQueue.enqueue({
      id: `fetch_running_classes_${Date.now()}`,
      jobType: "SYNC_CLASS",
      description: "Lấy danh sách các lớp đang học (Running) từ LMS",
      execute: async () => {
        return ClassSyncer.fetchRunningClasses();
      },
    });

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          classes: getMergedRunningClasses(),
          error: result.error || "Không thể lấy danh sách lớp đang học từ LMS.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      classes: getMergedRunningClasses(),
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        classes: getMergedRunningClasses(),
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
