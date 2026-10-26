import { taskQueue } from "@/lib/queue/task-queue";
import { jobLogRepo, type JobLogRecord } from "@/lib/db/sqlite";
import { validateLocalRequest } from "@/lib/security/local-guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const securityCheck = validateLocalRequest(req);
  if (securityCheck) return securityCheck;

  const encoder = new TextEncoder();
  let cleanedUp = false;
  let unsubscribeLogs: (() => void) | null = null;
  let unsubscribeStatus: (() => void) | null = null;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      unsubscribeLogs?.();
    } catch {
      // ignore
    }
    try {
      unsubscribeStatus?.();
    } catch {
      // ignore
    }
    unsubscribeLogs = null;
    unsubscribeStatus = null;
    try {
      req.signal?.removeEventListener?.("abort", cleanup);
    } catch {
      // ignore
    }
  };

  const stream = new ReadableStream({
    start(controller) {
      if (req.signal?.aborted) {
        cleanup();
        try {
          controller.close();
        } catch {
          // ignore
        }
        return;
      }

      // Send initial status and recent logs
      const initialStatus = `data: ${JSON.stringify({ type: "STATUS", data: taskQueue.getStatus() })}\n\n`;
      controller.enqueue(encoder.encode(initialStatus));

      try {
        const recentLogs = jobLogRepo.getRecentLogs(50).reverse();
        const recentLogsEvent = `data: ${JSON.stringify({ type: "RECENT_LOGS", data: recentLogs })}\n\n`;
        controller.enqueue(encoder.encode(recentLogsEvent));
      } catch {
        // Ignore if DB not initialized yet
      }

      unsubscribeLogs = taskQueue.subscribeLogs((log: JobLogRecord) => {
        if (cleanedUp) return;
        try {
          const message = `data: ${JSON.stringify({ type: "LOG", data: log })}\n\n`;
          controller.enqueue(encoder.encode(message));
        } catch {
          cleanup();
        }
      });

      unsubscribeStatus = taskQueue.subscribeStatus((status) => {
        if (cleanedUp) return;
        try {
          const message = `data: ${JSON.stringify({ type: "STATUS", data: status })}\n\n`;
          controller.enqueue(encoder.encode(message));
        } catch {
          cleanup();
        }
      });

      req.signal?.addEventListener?.("abort", cleanup, { once: true });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
