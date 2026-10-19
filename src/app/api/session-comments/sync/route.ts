import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { taskQueue } from "@/lib/queue/task-queue";
import { ClassSyncer } from "@/lib/playwright/sync-class";

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const { classCode } = body;

    if (!classCode || typeof classCode !== "string") {
      return NextResponse.json(
        { success: false, error: "Mã lớp (classCode) không hợp lệ." },
        { status: 400 }
      );
    }

    const trimmedCode = classCode.trim();
    const result = await taskQueue.enqueue({
      id: `sync_${trimmedCode}_${Date.now()}`,
      jobType: "SYNC_CLASS",
      description: `Đồng bộ lớp học ${trimmedCode} từ LMS`,
      classId: trimmedCode,
      execute: async () => {
        return ClassSyncer.syncClass(trimmedCode);
      },
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
