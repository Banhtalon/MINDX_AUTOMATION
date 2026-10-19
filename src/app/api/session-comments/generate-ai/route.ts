import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { CommentGenerator } from "@/lib/gemini/comment-generator";

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const { session, students } = body;

    if (!session || !students || !Array.isArray(students)) {
      return NextResponse.json(
        { success: false, error: "Dữ liệu buổi học hoặc danh sách học viên không hợp lệ." },
        { status: 400 }
      );
    }

    const results = await CommentGenerator.generateBatchComments(session, students);

    return NextResponse.json({
      success: true,
      data: results,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
