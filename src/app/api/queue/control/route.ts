import { NextResponse } from "next/server";
import { taskQueue } from "@/lib/queue/task-queue";
import { validateLocalRequest } from "@/lib/security/local-guard";

export async function GET(req: Request) {
  const securityCheck = validateLocalRequest(req);
  if (securityCheck) return securityCheck;

  const status = taskQueue.getStatus();
  return NextResponse.json({
    success: true,
    data: status,
  });
}

export async function POST(req: Request) {
  const securityCheck = validateLocalRequest(req);
  if (securityCheck) return securityCheck;

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action as "stop" | "resume" | "clear";

    switch (action) {
      case "stop":
        taskQueue.stopQueue();
        return NextResponse.json({
          success: true,
          message: "Đã kích hoạt dừng khẩn cấp hàng đợi.",
          status: taskQueue.getStatus(),
        });

      case "resume":
        taskQueue.resumeQueue();
        return NextResponse.json({
          success: true,
          message: "Đã tiếp tục chạy hàng đợi.",
          status: taskQueue.getStatus(),
        });

      case "clear":
        taskQueue.clearQueue();
        return NextResponse.json({
          success: true,
          message: "Đã xóa toàn bộ các tác vụ đang chờ trong hàng đợi.",
          status: taskQueue.getStatus(),
        });

      default:
        return NextResponse.json(
          {
            success: false,
            error: "Hành động không hợp lệ. Cho phép: 'stop', 'resume', 'clear'.",
          },
          { status: 400 }
        );
    }
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
