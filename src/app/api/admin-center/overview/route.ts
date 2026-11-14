import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { sanitizeErrorMessage } from "@/lib/security/secret-redactor";
import { buildAdminOverviewResponse } from "@/lib/admin-center/admin-lms-scanner";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = validateLocalRequest(req);
  if (denied) return denied;

  try {
    const url = new URL(req.url);
    const includeMakeupParam = url.searchParams.get("includeMakeup");
    const includeMakeup =
      includeMakeupParam === null
        ? true
        : includeMakeupParam !== "false" && includeMakeupParam !== "0";
    const centerCode = url.searchParams.get("centerCode") || undefined;

    const overview = buildAdminOverviewResponse({
      centerCode,
      includeMakeup,
    });
    return NextResponse.json(overview);
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
