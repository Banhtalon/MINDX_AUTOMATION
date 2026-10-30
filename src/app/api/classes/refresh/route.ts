import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { taskQueue } from "@/lib/queue/task-queue";
import { ensureQueueNotStopped } from "@/lib/teaching/teaching-http-client";
import {
  ClassSyncer,
  FINISHED_CLASS_GRACE_DAYS,
  isFinishedClassWithinGraceWindow,
  resolveClassSession14DateInfo,
} from "@/lib/playwright/sync-class";
import {
  isSyntheticClassCode,
  listClasses,
  listStudents,
  queryClassDirectory,
  type ClassDirectoryScope,
} from "@/lib/classes/class-directory";

function parseScope(rawScope: unknown): ClassDirectoryScope | null {
  if (rawScope === undefined || rawScope === null || String(rawScope).trim() === "") {
    return "running";
  }
  const s = String(rawScope).trim().toLowerCase();
  if (s === "running" || s === "spck" || s === "all") {
    return s;
  }
  return null;
}

export async function GET(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const url = new URL(req.url);
    const scope = parseScope(url.searchParams.get("scope"));
    if (!scope) {
      return NextResponse.json(
        {
          success: false,
          error: "Tham số scope không hợp lệ (chỉ chấp nhận 'running', 'spck' hoặc 'all').",
        },
        { status: 400 }
      );
    }
    const runningClasses = listClasses({ scope: "running" });
    const spckClasses = listClasses({ scope: "spck" });
    const allClasses = listClasses({ scope: "all" });
    const classes =
      scope === "spck"
        ? spckClasses
        : scope === "all"
        ? allClasses
        : runningClasses;

    return NextResponse.json({
      success: true,
      scope,
      classes,
      runningClasses,
      spckClasses,
      allClasses,
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

  let body: Record<string, any> = {};
  try {
    const rawText = await req.text();
    if (rawText.trim().length > 0) {
      const parsed = JSON.parse(rawText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json(
          {
            success: false,
            error: "Dữ liệu yêu cầu (JSON body) phải là một đối tượng hợp lệ.",
          },
          { status: 400 }
        );
      }
      body = parsed;
    }
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Dữ liệu yêu cầu (JSON body) không đúng định dạng JSON.",
      },
      { status: 400 }
    );
  }

  const rawClassCode =
    body.classCode !== undefined && body.classCode !== null
      ? String(body.classCode).trim().toUpperCase()
      : body.classId !== undefined && body.classId !== null
      ? String(body.classId).trim().toUpperCase()
      : "";

  if (
    body.classCode !== undefined &&
    body.classId !== undefined &&
    String(body.classCode).trim() &&
    String(body.classId).trim() &&
    String(body.classCode).trim().toUpperCase() !==
      String(body.classId).trim().toUpperCase()
  ) {
    return NextResponse.json(
      {
        success: false,
        error: "Mã lớp classCode và classId không khớp nhau.",
      },
      { status: 400 }
    );
  }

  const scope = parseScope(body.scope);
  if (!scope) {
    return NextResponse.json(
      {
        success: false,
        error: "Tham số scope không hợp lệ (chỉ chấp nhận 'running', 'spck' hoặc 'all').",
      },
      { status: 400 }
    );
  }
  const syncSpckEligible = Boolean(body.syncSpckEligible || scope === "spck");
  const forceResyncAll = Boolean(body.forceResyncAll);

  try {
    const taskOutcome = await taskQueue.enqueue({
      id: `refresh_classes_${rawClassCode || scope}_${Date.now()}`,
      jobType: "SYNC_CLASS",
      classId: rawClassCode || undefined,
      description: rawClassCode
        ? `Quét danh sách lớp từ LMS và đồng bộ lớp ${rawClassCode}`
        : "Quét danh sách các lớp đang dạy từ LMS",
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
            syncedClass: null as any,
          };
        }

        const syncedClassCodes: string[] = [];
        const failedClasses: Array<{ classCode: string; error: string }> = [];
        let syncedClass: any = null;

        if (rawClassCode) {
          ensureQueueNotStopped();
          const syncRes = await ClassSyncer.syncClass(rawClassCode);
          ensureQueueNotStopped();
          syncedClass = syncRes;
          if (!syncRes.success) {
            return {
              ok: false as const,
              error:
                syncRes.error ||
                `Không thể đồng bộ dữ liệu lớp ${rawClassCode} từ LMS.`,
              syncedClassCodes,
              failedClassCodes: [rawClassCode],
              failedClasses: [
                {
                  classCode: rawClassCode,
                  error:
                    syncRes.error ||
                    `Không thể đồng bộ dữ liệu lớp ${rawClassCode} từ LMS.`,
                },
              ],
              syncedClass,
            };
          }
          syncedClassCodes.push(rawClassCode);
        }

        if (syncSpckEligible && Array.isArray(fetchRes.classes)) {
          const { allClassesMap: beforeMap } = queryClassDirectory({
            scope: "spck",
            minSessionNumber: 12,
            includeSynthetic: Boolean(
              rawClassCode && isSyntheticClassCode(rawClassCode)
            ),
          });

          for (const item of fetchRes.classes) {
            ensureQueueNotStopped();
            const code = String(item?.classCode || "").trim().toUpperCase();
            if (!code || syncedClassCodes.includes(code)) continue;

            const existingMeta = beforeMap.get(code);
            const isFinished = item.status === "Finished";

            if (isFinished) {
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
              const s14InfoBefore = resolveClassSession14DateInfo(
                code,
                item.endDate
              );
              const hasStudents =
                listStudents(code, { activeOnly: false }).length > 0;
              const needsFinishedSync =
                forceResyncAll ||
                !existingMeta ||
                !s14InfoBefore.isExactSession14 ||
                !hasStudents;
              if (needsFinishedSync) {
                ensureQueueNotStopped();
                const res = await ClassSyncer.syncClass(code);
                ensureQueueNotStopped();
                if (res.success) {
                  syncedClassCodes.push(code);
                } else {
                  failedClasses.push({
                    classCode: code,
                    error:
                      res.error || `Không thể đồng bộ lớp ${code} từ LMS.`,
                  });
                }
              }
              continue;
            }

            const needsSync =
              forceResyncAll ||
              !existingMeta ||
              existingMeta.currentSessionNumber === 0 ||
              existingMeta.currentSessionNumber >= 10;
            if (needsSync) {
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
              ensureQueueNotStopped();
              const res = await ClassSyncer.syncClass(code);
              ensureQueueNotStopped();
              if (res.success) {
                syncedClassCodes.push(code);
              } else {
                failedClasses.push({
                  classCode: code,
                  error:
                    res.error || `Không thể đồng bộ lớp ${code} từ LMS.`,
                });
              }
            }
          }
        }

        ensureQueueNotStopped();
        if (failedClasses.length > 0) {
          return {
            ok: false as const,
            error: `Không thể đồng bộ ${failedClasses.length} lớp từ LMS: ${failedClasses
              .map((f) => `${f.classCode} (${f.error})`)
              .join("; ")}`,
            syncedClassCodes,
            failedClassCodes: failedClasses.map((f) => f.classCode),
            failedClasses,
            syncedClass,
          };
        }

        return {
          ok: true as const,
          syncedClassCodes,
          failedClassCodes: [] as string[],
          failedClasses: [] as Array<{ classCode: string; error: string }>,
          syncedClass,
        };
      },
    });

    ensureQueueNotStopped();

    const includeSynthetic = Boolean(
      rawClassCode && isSyntheticClassCode(rawClassCode)
    );
    const runningClasses = listClasses({
      scope: "running",
      includeSynthetic,
    });
    const spckClasses = listClasses({
      scope: "spck",
      includeSynthetic,
    });
    const allClasses = listClasses({
      scope: "all",
      includeSynthetic,
    });
    const classes =
      scope === "spck"
        ? spckClasses
        : scope === "all"
        ? allClasses
        : runningClasses;

    if (!taskOutcome.ok) {
      return NextResponse.json(
        {
          success: false,
          scope,
          classes,
          runningClasses,
          spckClasses,
          allClasses,
          syncedClassCode: rawClassCode || null,
          syncedClass: taskOutcome.syncedClass,
          syncedClassCodes: taskOutcome.syncedClassCodes,
          failedClassCodes: taskOutcome.failedClassCodes || [],
          failedClasses: taskOutcome.failedClasses || [],
          error: taskOutcome.error,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      scope,
      classes,
      runningClasses,
      spckClasses,
      allClasses,
      syncedClassCode: rawClassCode || null,
      syncedClass: taskOutcome.syncedClass,
      syncedClassCodes: taskOutcome.syncedClassCodes,
    });
  } catch (err: any) {
    const runningClasses = listClasses({ scope: "running" });
    const spckClasses = listClasses({ scope: "spck" });
    const allClasses = listClasses({ scope: "all" });
    const classes =
      scope === "spck"
        ? spckClasses
        : scope === "all"
        ? allClasses
        : runningClasses;
    const errMsg = err instanceof Error ? err.message : String(err);
    const isStopped =
      err?.name === "TeachingStopError" ||
      taskQueue.getStatus().isStopped ||
      /dừng khẩn cấp|Emergency Stop|STOPPED/i.test(errMsg);

    return NextResponse.json(
      {
        success: false,
        scope,
        classes,
        runningClasses,
        spckClasses,
        allClasses,
        error: errMsg,
      },
      { status: isStopped ? 499 : 500 }
    );
  }
}
