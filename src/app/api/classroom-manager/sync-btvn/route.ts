import { NextResponse } from "next/server";
import { validateLocalRequest, parseJsonPlainObjectBody } from "@/lib/security/local-guard";
import {
  BtvnLookupError,
  lookupPreviousSessionUnsubmittedBtvn,
  parseBtvnLookupRequestBody,
} from "@/lib/homework/lms-btvn-lookup";

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  const parsedBody = await parseJsonPlainObjectBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const params = parseBtvnLookupRequestBody(parsedBody.body);
    const result = await lookupPreviousSessionUnsubmittedBtvn(params);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err: unknown) {
    if (err instanceof BtvnLookupError) {
      return NextResponse.json(
        { success: false, error: err.message, code: err.code },
        { status: err.statusCode }
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Lỗi máy chủ khi quét BTVN từ LMS.",
      },
      { status: 500 }
    );
  }
}
