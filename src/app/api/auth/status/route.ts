import { NextResponse } from "next/server";
import { taskQueue } from "@/lib/queue/task-queue";
import { authService } from "@/lib/playwright/auth";
import { getSafePublicConfig } from "@/lib/config";

export async function GET() {
  try {
    const config = getSafePublicConfig();

    const [teachingStatus, lmsStatus] = await Promise.all([
      taskQueue.enqueue({
        id: `AUTH_STATUS_TEACHING_${Date.now()}`,
        jobType: "AUTH_CHECK",
        description: "Kiểm tra phiên đăng nhập Teaching",
        execute: () => authService.checkAuthStatus("TEACHING"),
      }),
      taskQueue.enqueue({
        id: `AUTH_STATUS_LMS_${Date.now()}`,
        jobType: "AUTH_CHECK",
        description: "Kiểm tra phiên đăng nhập LMS",
        execute: () => authService.checkAuthStatus("LMS"),
      }),
    ]);

    return NextResponse.json({
      success: true,
      config,
      teaching: {
        isAuthenticated: teachingStatus.isAuthenticated,
        url: teachingStatus.currentUrl,
        usernameMasked: config.teachingUsernameMasked,
      },
      lms: {
        isAuthenticated: lmsStatus.isAuthenticated,
        url: lmsStatus.currentUrl,
        usernameMasked: config.lmsUsernameMasked,
      },
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
