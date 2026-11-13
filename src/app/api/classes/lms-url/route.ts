import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { taskQueue } from "@/lib/queue/task-queue";
import { ClassSyncer } from "@/lib/playwright/sync-class";
import { config } from "@/lib/config";
import {
  LMS_COMMENTS_TAB_INDEX,
  buildLmsClassCommentsUrl,
  isValidLmsClassCode,
} from "@/lib/lms/lms-class-url";
import { resolveKnownLmsClassId } from "@/lib/lms/lms-class-id-store";

function parseTabParam(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") {
    return LMS_COMMENTS_TAB_INDEX;
  }
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 0 && n <= 30) {
    return n;
  }
  return LMS_COMMENTS_TAB_INDEX;
}

/**
 * Pure read-only lookup for cached MindX LMS class deep-link URL (`tab=10` Comments).
 */
export async function GET(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const reqUrl = new URL(req.url);
    const rawCode =
      reqUrl.searchParams.get("classCode") ||
      reqUrl.searchParams.get("classId") ||
      "";
    const classCode = rawCode.trim().toUpperCase();
    if (!isValidLmsClassCode(classCode)) {
      return NextResponse.json(
        { success: false, error: "Mã lớp (classCode) không hợp lệ." },
        { status: 400 }
      );
    }

    const tab = parseTabParam(reqUrl.searchParams.get("tab"));
    const known = resolveKnownLmsClassId(classCode);
    const fallbackSearchUrl = buildLmsClassCommentsUrl({
      lmsBaseUrl: config.lmsUrl,
      classCode,
    });
    const url = buildLmsClassCommentsUrl({
      lmsBaseUrl: config.lmsUrl,
      classCode,
      lmsClassId: known.lmsClassId,
      tab,
    });

    return NextResponse.json({
      success: true,
      classCode,
      lmsClassId: known.lmsClassId,
      url,
      fallbackSearchUrl,
      resolved: Boolean(known.lmsClassId),
      source: known.source,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

/**
 * Resolves and caches the MindX LMS deep-link URL for a class (`?search="..."&id="..."&tab=10`),
 * returning immediately on cache hit and falling back to Playwright single-flight queue on miss.
 */
export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json().catch(() => ({}));
    const rawCode =
      typeof body?.classCode === "string"
        ? body.classCode
        : typeof body?.classId === "string"
          ? body.classId
          : "";
    const classCode = rawCode.trim().toUpperCase();
    if (!isValidLmsClassCode(classCode)) {
      return NextResponse.json(
        { success: false, error: "Mã lớp (classCode) không hợp lệ." },
        { status: 400 }
      );
    }

    const tab = parseTabParam(body?.tab);
    const forceRefresh = body?.forceRefresh === true;
    const fallbackSearchUrl = buildLmsClassCommentsUrl({
      lmsBaseUrl: config.lmsUrl,
      classCode,
    });

    if (!forceRefresh) {
      const known = resolveKnownLmsClassId(classCode);
      if (known.lmsClassId) {
        return NextResponse.json({
          success: true,
          classCode,
          lmsClassId: known.lmsClassId,
          url: buildLmsClassCommentsUrl({
            lmsBaseUrl: config.lmsUrl,
            classCode,
            lmsClassId: known.lmsClassId,
            tab,
          }),
          fallbackSearchUrl,
          resolved: true,
          source: known.source,
        });
      }
    }

    const resolved = await taskQueue.enqueue({
      id: `resolve_lms_url_${classCode}_${Date.now()}`,
      jobType: "SYNC_CLASS",
      description: `Lấy đường dẫn LMS trực tiếp của lớp ${classCode}`,
      classId: classCode,
      execute: async () => ClassSyncer.resolveLmsClassId(classCode),
    });

    if (resolved?.success && resolved.lmsClassId) {
      return NextResponse.json({
        success: true,
        classCode,
        lmsClassId: resolved.lmsClassId,
        url: buildLmsClassCommentsUrl({
          lmsBaseUrl: config.lmsUrl,
          classCode,
          lmsClassId: resolved.lmsClassId,
          tab,
        }),
        fallbackSearchUrl,
        resolved: true,
        source: resolved.source,
      });
    }

    return NextResponse.json(
      {
        success: false,
        classCode,
        lmsClassId: null,
        url: fallbackSearchUrl,
        fallbackSearchUrl,
        resolved: false,
        error:
          resolved?.error ||
          `Không lấy được đường dẫn chi tiết lớp ${classCode} từ MindX LMS.`,
      },
      { status: 502 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
