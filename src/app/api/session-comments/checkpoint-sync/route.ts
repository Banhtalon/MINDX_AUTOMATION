import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { taskQueue } from "@/lib/queue/task-queue";
import { ClassSyncer } from "@/lib/playwright/sync-class";
import { classSessionRepo } from "@/lib/db/sqlite";
import { resolveCheckpointStageForSession } from "@/lib/checkpoint/checkpoint-competency";
import { computeCheckpointDataForSession } from "@/lib/checkpoint/checkpoint-history-loader";

function parseCheckpointSyncSessionNumber(classCode: string, sessionId: string): number {
  try {
    const sessions =
      typeof classSessionRepo?.findByClass === "function"
        ? classSessionRepo.findByClass(classCode)
        : [];
    const matched = sessions.find((s) => s.sessionId === sessionId);
    if (matched && typeof matched.sessionNumber === "number" && matched.sessionNumber > 0) {
      return matched.sessionNumber;
    }
  } catch {}
  const m = String(sessionId || "")
    .trim()
    .match(/(?:^|[_-])SESS(?:ION)?[_-]?0*(\d+)$/i);
  if (!m) return 0;
  const parsed = Number(m[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, error: "Payload JSON không hợp lệ." },
        { status: 400 }
      );
    }

    const rawClassCode = body.classCode;
    const rawSessionId = body.sessionId;
    if (body.syncFromLms !== undefined && typeof body.syncFromLms !== "boolean") {
      return NextResponse.json(
        { success: false, error: "Trường 'syncFromLms' phải là boolean (true/false)." },
        { status: 400 }
      );
    }
    if (body.forceRecalculate !== undefined && typeof body.forceRecalculate !== "boolean") {
      return NextResponse.json(
        { success: false, error: "Trường 'forceRecalculate' phải là boolean (true/false)." },
        { status: 400 }
      );
    }

    const syncFromLms = body.syncFromLms === true;
    const forceRecalculate = body.forceRecalculate !== false;

    if (typeof rawClassCode !== "string" || !rawClassCode.trim()) {
      return NextResponse.json(
        { success: false, error: "Thiếu mã lớp (classCode) hợp lệ." },
        { status: 400 }
      );
    }
    if (typeof rawSessionId !== "string" || !rawSessionId.trim()) {
      return NextResponse.json(
        { success: false, error: "Thiếu mã buổi học (sessionId) hợp lệ." },
        { status: 400 }
      );
    }

    const classCode = rawClassCode.trim().toUpperCase();
    const sessionId = rawSessionId.trim();

    const escapedClassId = classCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sessionPrefixRegex = new RegExp(`^${escapedClassId}(?:_SESS_|[^a-zA-Z0-9_-])`, "i");
    if (!sessionPrefixRegex.test(sessionId)) {
      return NextResponse.json(
        {
          success: false,
          error: `Mã buổi học '${sessionId}' không thuộc đúng lớp '${classCode}'.`,
        },
        { status: 400 }
      );
    }

    const sessionNumber = parseCheckpointSyncSessionNumber(classCode, sessionId);
    const stageInfo = resolveCheckpointStageForSession(classCode, sessionNumber);
    if (!stageInfo.isCheckpoint || !stageInfo.cpStage) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Buổi học này không phải buổi Checkpoint (Robotics: Buổi 4/8; Lập trình: Buổi 5/9).",
        },
        { status: 400 }
      );
    }

    let lmsSyncResult: any = null;
    if (syncFromLms) {
      lmsSyncResult = await taskQueue.enqueue({
        id: `cp_sync_${classCode}_${Date.now()}`,
        jobType: "SYNC_CLASS",
        description: `Đọc điểm KT & đồng bộ Checkpoint ${classCode}`,
        classId: classCode,
        execute: async () => {
          return ClassSyncer.syncClass(classCode, {
            forceFreshDrawer: true,
            syncLmsCompletionStatus: true,
            preferLmsVerified: false,
          });
        },
      });
    }

    const computed = computeCheckpointDataForSession({
      classId: classCode,
      sessionId,
      sessionNumber,
      forceRecalculate,
      persist: true,
    });

    if (!computed.isCheckpoint) {
      return NextResponse.json(
        {
          success: false,
          error: "Buổi học này không phải buổi Checkpoint (Robotics: Buổi 4/8; Lập trình: Buổi 5/9).",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      cpStage: computed.cpStage,
      updatedCount: computed.updatedCount,
      byStudent: computed.byStudent,
      lmsSynced: syncFromLms,
      lmsSyncResult,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
