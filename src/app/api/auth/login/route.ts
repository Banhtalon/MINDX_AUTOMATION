import { NextResponse } from "next/server";
import { taskQueue } from "@/lib/queue/task-queue";
import { authService } from "@/lib/playwright/auth";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const system = (body.system || "LMS").toUpperCase() as "TEACHING" | "LMS";

    if (system !== "TEACHING" && system !== "LMS") {
      return NextResponse.json(
        { success: false, error: "Hệ thống chỉ định không hợp lệ. Phải là TEACHING hoặc LMS." },
        { status: 400 }
      );
    }

    const result = await taskQueue.enqueue({
      id: `AUTH_LOGIN_${system}_${Date.now()}`,
      jobType: "AUTH_LOGIN",
      description: `Đăng nhập tự động hệ thống ${system}`,
      execute: () => authService.login(system),
    });

    return NextResponse.json({
      success: result.success,
      message: result.message,
      system,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
