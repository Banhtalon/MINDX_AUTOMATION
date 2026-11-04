import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { taskQueue } from "@/lib/queue/task-queue";
import { ensureQueueNotStopped } from "@/lib/teaching/teaching-http-client";
import {
  ClassSyncer,
  FINISHED_CLASS_GRACE_DAYS,
  isFinishedClassWithinGraceWindow,
} from "@/lib/playwright/sync-class";
import { TeachingProjectService } from "@/lib/playwright/teaching-project-service";
import {
  isSyntheticClassCode,
  listClasses,
} from "@/lib/classes/class-directory";
import { getDashboardTodayTodoCards } from "@/lib/dashboard/today-tasks";

export async function GET(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const cards = getDashboardTodayTodoCards({ limit: 12 });
    return NextResponse.json({
      success: true,
      cards,
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

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const outcome = await taskQueue.enqueue({
      id: `scan_weekly_tasks_${Date.now()}`,
      jobType: "SYNC_CLASS",
      description: "Quét công việc tuần này từ LMS & Teaching cho các lớp đang dạy",
      execute: async () => {
        ensureQueueNotStopped();
        const fetchRes = await ClassSyncer.fetchRunningClasses({
          persistToConfig: true,
        });
        ensureQueueNotStopped();

        if (!fetchRes.success) {
          return {
            ok: false as const,
            error:
              fetchRes.error ||
              "Không thể lấy danh sách lớp đang dạy từ MindX LMS.",
            syncedClassCodes: [] as string[],
            failedClasses: [] as Array<{ classCode: string; error: string }>,
          };
        }

        const candidateCodes: string[] = [];
        const seen = new Set<string>();
        const rawList =
          Array.isArray(fetchRes.classes) && fetchRes.classes.length > 0
            ? fetchRes.classes
            : listClasses({ scope: "running" });

        for (const item of rawList) {
          const code = String(item?.classCode || "").trim().toUpperCase();
          if (!code || seen.has(code) || isSyntheticClassCode(code)) continue;
          if (item.status === "Finished") {
            const grace = isFinishedClassWithinGraceWindow(
              code,
              item.endDate,
              FINISHED_CLASS_GRACE_DAYS
            );
            if (
              grace.isKnownDate &&
              !grace.withinWindow &&
              (grace.daysSinceSession14 ?? -1) > 0
            ) {
              continue;
            }
          }
          seen.add(code);
          candidateCodes.push(code);
        }

        const syncedClassCodes: string[] = [];
        const failedClasses: Array<{ classCode: string; error: string }> = [];

        for (const code of candidateCodes) {
          ensureQueueNotStopped();
          const syncRes = await ClassSyncer.syncClass(code, {
            forceFreshDrawer: true,
            syncLmsCompletionStatus: true,
            preferLmsVerified: true,
          });
          ensureQueueNotStopped();

          if (syncRes.success) {
            syncedClassCodes.push(code);
            const matchSess = String(syncRes.latestActiveSessionId || "").match(
              /(\d+)$/
            );
            const activeSessNum = matchSess ? parseInt(matchSess[1], 10) : 0;
            if (activeSessNum >= 11) {
              await TeachingProjectService.loadClassProject(code, {
                forceRefreshFromTeaching: true,
              }).catch(() => null);
            }
          } else {
            failedClasses.push({
              classCode: code,
              error:
                syncRes.error || `Không thể đồng bộ dữ liệu lớp ${code} từ LMS.`,
            });
          }
        }

        return {
          ok: true as const,
          syncedClassCodes,
          failedClasses,
        };
      },
    });

    const cards = getDashboardTodayTodoCards({ limit: 12 });

    if (!outcome.ok) {
      return NextResponse.json(
        {
          success: false,
          error: outcome.error,
          cards,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      syncedCount: outcome.syncedClassCodes.length,
      syncedClassCodes: outcome.syncedClassCodes,
      failedClasses: outcome.failedClasses,
      cards,
      scannedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        cards: getDashboardTodayTodoCards({ limit: 12 }),
      },
      { status: 500 }
    );
  }
}
