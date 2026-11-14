import { NextResponse } from "next/server";
import {
  parseJsonPlainObjectBody,
  validateLocalRequest,
} from "@/lib/security/local-guard";
import { redactSecrets, sanitizeErrorMessage } from "@/lib/security/secret-redactor";
import { buildAdminOverviewResponse } from "@/lib/admin-center/admin-lms-scanner";
import {
  provisionAdminBatchSpckTasksOnTeaching,
  provisionAdminSpckTasksOnTeaching,
} from "@/lib/admin-center/admin-teaching-actions";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = validateLocalRequest(req);
  if (denied) return denied;

  try {
    const parsedBody = await parseJsonPlainObjectBody(req);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.body;

    const rawMode =
      typeof body.mode === "string" ? body.mode.trim().toUpperCase() : "";
    if (!rawMode) {
      return NextResponse.json(
        {
          success: false,
          error: "Thiếu chế độ tạo nhiệm vụ (`mode` phải là SINGLE hoặc BATCH_GT9).",
        },
        { status: 400 }
      );
    }
    const syncProgressBySession = body.syncProgressBySession === true;
    const cleanupExtraTasks = body.cleanupExtraTasks === true;
    const includeMakeup = body.includeMakeup !== false;
    const centerCode = body.centerCode ? String(body.centerCode) : undefined;

    if (rawMode === "SINGLE") {
      if (typeof body.classCode !== "string" || !body.classCode.trim()) {
        return NextResponse.json(
          { success: false, error: "Thiếu mã lớp (`classCode`) để tạo nhiệm vụ SPCK." },
          { status: 400 }
        );
      }
      const res = await provisionAdminSpckTasksOnTeaching(
        body.classCode,
        {
          syncProgressBySession,
          cleanupExtraTasks,
        }
      );
      const overview = buildAdminOverviewResponse({ centerCode, includeMakeup });
      const safeRes = res.error ? { ...res, error: redactSecrets(res.error) } : res;
      return NextResponse.json({ ...safeRes, overview }, { status: res.statusCode });
    }

    if (rawMode === "BATCH_GT9") {
      if (
        body &&
        "classCodes" in body &&
        body.classCodes !== undefined &&
        (!Array.isArray(body.classCodes) || body.classCodes.length === 0)
      ) {
        return NextResponse.json(
          {
            success: false,
            error: "Danh sách mã lớp classCodes không hợp lệ hoặc rỗng.",
          },
          { status: 400 }
        );
      }
      const classCodes = Array.isArray(body?.classCodes)
        ? body.classCodes.map((c: unknown) => String(c ?? ""))
        : undefined;
      const res = await provisionAdminBatchSpckTasksOnTeaching(classCodes, {
        syncProgressBySession,
        cleanupExtraTasks,
      });
      const overview = buildAdminOverviewResponse({ centerCode, includeMakeup });
      const safeRes = res.error ? { ...res, error: redactSecrets(res.error) } : res;
      return NextResponse.json({ ...safeRes, overview }, { status: res.statusCode });
    }

    return NextResponse.json(
      { success: false, error: redactSecrets(`Chế độ tạo nhiệm vụ không hợp lệ: "${body?.mode}".`) },
      { status: 400 }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: sanitizeErrorMessage(err),
      },
      { status: 500 }
    );
  }
}
