import { taskQueue } from "@/lib/queue/task-queue";
import type { JobLogRecord } from "@/lib/db/sqlite";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial status
      const initialStatus = `data: ${JSON.stringify({ type: "STATUS", data: taskQueue.getStatus() })}\n\n`;
      controller.enqueue(encoder.encode(initialStatus));

      const unsubscribeLogs = taskQueue.subscribeLogs((log: JobLogRecord) => {
        try {
          const message = `data: ${JSON.stringify({ type: "LOG", data: log })}\n\n`;
          controller.enqueue(encoder.encode(message));
        } catch {
          // Stream might be closed by client
        }
      });

      const unsubscribeStatus = taskQueue.subscribeStatus((status) => {
        try {
          const message = `data: ${JSON.stringify({ type: "STATUS", data: status })}\n\n`;
          controller.enqueue(encoder.encode(message));
        } catch {
          // Stream might be closed by client
        }
      });

      return () => {
        unsubscribeLogs();
        unsubscribeStatus();
      };
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
