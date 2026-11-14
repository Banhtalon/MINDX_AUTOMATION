import { NextResponse } from "next/server";
import {
  parseJsonPlainObjectBody,
  validateLocalRequest,
} from "@/lib/security/local-guard";
import { redactSecrets, sanitizeErrorMessage } from "@/lib/security/secret-redactor";
import {
  getAdminScanProgressState,
  requestStopAdminScanAfterCurrent,
  scanAdminCenterClasses,
  type AdminScanScope,
} from "@/lib/admin-center/admin-lms-scanner";
import { isValidLmsClassCode } from "@/lib/lms/lms-class-url";

export const dynamic = "force-dynamic";

const ALLOWED_SCOPES = new Set<AdminScanScope>([
  "ALL",
  "CODING_ONLY",
  "SINGLE_CLASS",
  "TEACHING_ONLY",
]);

export async function POST(req: Request) {
  const denied = validateLocalRequest(req);
  if (denied) return denied;

  try {
    const parsedBody = await parseJsonPlainObjectBody(req);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.body;

    if (body.action === "STOP_AFTER_CURRENT") {
      const progress = requestStopAdminScanAfterCurrent();
      return NextResponse.json({
        success: true,
        progress,
        scanProgress: progress,
      });
    }

    const rawScope = (
      typeof body.scope === "string" ? body.scope.trim().toUpperCase() : ""
    ) as AdminScanScope;
    if (!rawScope || !ALLOWED_SCOPES.has(rawScope)) {
      return NextResponse.json(
        {
          success: false,
          error: redactSecrets(`Chế độ quét không hợp lệ: "${String(body.scope ?? "")}".`),
        },
        { status: 400 }
      );
    }

    const classCode = body?.classCode
      ? String(body.classCode).trim().toUpperCase()
      : undefined;
    if (rawScope === "SINGLE_CLASS" && (!classCode || !isValidLmsClassCode(classCode))) {
      return NextResponse.json(
        {
          success: false,
          error: redactSecrets(`Mã lớp không hợp lệ để quét đơn lớp: "${body?.classCode || ""}".`),
        },
        { status: 400 }
      );
    }

    if (getAdminScanProgressState().isRunning) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Đang có tiến trình quét Cơ sở Admin khác đang chạy. Vui lòng chờ hoàn tất hoặc bấm Dừng.",
          scanProgress: getAdminScanProgressState(),
        },
        { status: 409 }
      );
    }

    const includeMakeup = body?.includeMakeup !== false;
    const centerCode = body?.centerCode ? String(body.centerCode) : undefined;

    const result = await scanAdminCenterClasses({
      scope: rawScope,
      classCode,
      centerCode,
      includeMakeup,
    });

    const safeResult = result && typeof result === "object"
      ? {
          ...result,
          ...(result.error ? { error: redactSecrets(result.error) } : {}),
          ...(Array.isArray(result.failedClasses)
            ? {
                failedClasses: result.failedClasses.map((f: any) => ({
                  ...f,
                  error: redactSecrets(f?.error || ""),
                })),
              }
            : {}),
        }
      : result;
    return NextResponse.json(safeResult);
  } catch (err: any) {
    const msg = sanitizeErrorMessage(err);
    const status = msg.includes("đang chạy")
      ? 409
      : msg.includes("không hợp lệ")
      ? 400
      : 500;
    return NextResponse.json(
      {
        success: false,
        error: msg,
      },
      { status }
    );
  }
}
