import EventEmitter from "node:events";
import { jobLogRepo, type JobLogRecord } from "../db/sqlite";

export type TaskJobType =
  | "AUTH_CHECK"
  | "AUTH_LOGIN"
  | "SYNC_CLASS"
  | "SAVE_COMMENTS"
  | "SCRAPE_SCORES"
  | "GRADE_HOMEWORK"
  | "UPLOAD_SPCK"
  | "CUSTOM";

export interface TaskDefinition<T = unknown> {
  id: string;
  jobType: TaskJobType;
  description: string;
  classId?: string;
  sessionId?: string;
  studentId?: string;
  submissionId?: string;
  execute: () => Promise<T>;
}

interface InternalQueuedTask extends TaskDefinition {
  reject: (err: Error) => void;
}

export interface QueuedTaskItem {
  id: string;
  jobType: TaskJobType;
  description: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  classId?: string;
  sessionId?: string;
  studentId?: string;
  submissionId?: string;
  createdAt: string;
}

export interface QueueStatus {
  isRunning: boolean;
  isStopped: boolean;
  currentTask: QueuedTaskItem | null;
  pendingCount: number;
  completedCount: number;
  failedCount: number;
  tasks: QueuedTaskItem[];
}

export class SequentialTaskQueue {
  private static instance: SequentialTaskQueue | null = null;
  private queue: InternalQueuedTask[] = [];
  private taskHistory: QueuedTaskItem[] = [];
  private isProcessing = false;
  private isStopped = false;
  private currentRunningTask: QueuedTaskItem | null = null;
  private emitter = new EventEmitter();

  private completedCount = 0;
  private failedCount = 0;

  private constructor() {
    this.emitter.setMaxListeners(50);
  }

  public static getInstance(): SequentialTaskQueue {
    if (!SequentialTaskQueue.instance) {
      SequentialTaskQueue.instance = new SequentialTaskQueue();
    }
    return SequentialTaskQueue.instance;
  }

  /**
   * Enqueues a single-threaded task and returns a Promise resolving to its result.
   */
  public enqueue<T>(task: TaskDefinition<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.isStopped) {
        reject(
          new Error(
            "QUEUE_STOPPED: Hàng đợi đang ở trạng thái Dừng khẩn cấp. Vui lòng nhấn 'Tiếp tục chạy' trước khi thêm tác vụ mới."
          )
        );
        return;
      }

      const historyItem: QueuedTaskItem = {
        id: task.id,
        jobType: task.jobType,
        description: task.description,
        status: "PENDING",
        classId: task.classId,
        sessionId: task.sessionId,
        studentId: task.studentId,
        submissionId: task.submissionId,
        createdAt: new Date().toISOString(),
      };
      this.taskHistory.push(historyItem);

      this.log({
        jobId: task.id,
        jobType: task.jobType,
        classId: task.classId,
        sessionId: task.sessionId,
        studentId: task.studentId,
        submissionId: task.submissionId,
        level: "INFO",
        message: `Đã xếp hàng tác vụ: ${task.description}`,
      });

      const wrappedTask: InternalQueuedTask = {
        ...task,
        reject,
        execute: async () => {
          try {
            historyItem.status = "RUNNING";
            this.currentRunningTask = historyItem;
            this.emitStatus();

            const result = await task.execute();

            historyItem.status = "COMPLETED";
            this.completedCount++;
            resolve(result);
            return result;
          } catch (error) {
            historyItem.status = "FAILED";
            this.failedCount++;
            reject(error);
            throw error;
          } finally {
            this.currentRunningTask = null;
            this.emitStatus();
          }
        },
      };

      this.queue.push(wrappedTask);
      this.emitStatus();
      this.processNext();
    });
  }

  /**
   * Sequential execution loop. Guarantees that at any given moment,
   * exactly 1 task operates on the browser.
   */
  private async processNext(): Promise<void> {
    if (this.isProcessing || this.isStopped) {
      return;
    }

    if (this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const nextTask = this.queue.shift();

    if (nextTask) {
      try {
        await nextTask.execute();
      } catch (err) {
        this.log({
          jobId: nextTask.id,
          jobType: nextTask.jobType,
          classId: nextTask.classId,
          sessionId: nextTask.sessionId,
          studentId: nextTask.studentId,
          submissionId: nextTask.submissionId,
          level: "ERROR",
          message: `Lỗi thực thi tác vụ: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    this.isProcessing = false;

    // Continue to next task in queue unless stopped
    if (!this.isStopped && this.queue.length > 0) {
      this.processNext();
    }
  }

  /**
   * Emergency stop: halts processing immediately, drains pending queue,
   * and rejects all pending promises without leaving hanging promises.
   */
  public stopQueue(): void {
    this.isStopped = true;
    const cancelError = new Error(
      "TASK_CANCELLED: Hàng đợi đã bị tạm dừng bởi giáo viên (Stop Bot)."
    );

    const pendingTasks = [...this.queue];
    this.queue = [];

    for (const item of pendingTasks) {
      const hist = this.taskHistory.find((h) => h.id === item.id);
      if (hist && hist.status === "PENDING") {
        hist.status = "CANCELLED";
      }
      try {
        item.reject(cancelError);
      } catch {
        // Ignore already rejected
      }
    }

    this.log({
      jobId: "SYSTEM",
      jobType: "CUSTOM",
      level: "WARN",
      message: `🚨 Đã kích hoạt lệnh DỪNG KHẨN CẤP (Stop Bot). Đã hủy ${pendingTasks.length} tác vụ đang chờ.`,
    });

    this.emitStatus();
  }

  /**
   * Resumes queue execution if previously stopped.
   */
  public resumeQueue(): void {
    if (this.isStopped) {
      this.isStopped = false;
      this.log({
        jobId: "SYSTEM",
        jobType: "CUSTOM",
        level: "INFO",
        message: "Hàng đợi đã được mở khóa tiếp tục chạy.",
      });
      this.emitStatus();
      this.processNext();
    }
  }

  /**
   * Clears all pending tasks in the queue and rejects their promises.
   */
  public clearQueue(): void {
    const cancelError = new Error("TASK_CANCELLED: Hàng đợi đã bị xóa bởi người dùng.");
    const pendingTasks = [...this.queue];
    this.queue = [];

    for (const item of pendingTasks) {
      const hist = this.taskHistory.find((h) => h.id === item.id);
      if (hist && hist.status === "PENDING") {
        hist.status = "CANCELLED";
      }
      try {
        item.reject(cancelError);
      } catch {
        // Ignore
      }
    }
    this.emitStatus();
  }

  /**
   * Emits and persists logs into SQLite and SSE listeners.
   */
  public log(entry: Omit<JobLogRecord, "id" | "timestamp">): void {
    try {
      jobLogRepo.add(entry);
    } catch (err) {
      console.error("[SequentialTaskQueue] Failed to save log to SQLite:", err);
    }

    const logRecord: JobLogRecord = {
      ...entry,
      timestamp: new Date().toISOString(),
    };
    this.emitter.emit("log", logRecord);
  }

  /**
   * Subscribes to realtime logs (e.g. for Server-Sent Events).
   */
  public subscribeLogs(listener: (log: JobLogRecord) => void): () => void {
    this.emitter.on("log", listener);
    return () => this.emitter.off("log", listener);
  }

  /**
   * Subscribes to queue state changes.
   */
  public subscribeStatus(listener: (status: QueueStatus) => void): () => void {
    this.emitter.on("status", listener);
    return () => this.emitter.off("status", listener);
  }

  private emitStatus(): void {
    this.emitter.emit("status", this.getStatus());
  }

  public getStatus(): QueueStatus {
    return {
      isRunning: this.isProcessing,
      isStopped: this.isStopped,
      currentTask: this.currentRunningTask,
      pendingCount: this.queue.length,
      completedCount: this.completedCount,
      failedCount: this.failedCount,
      tasks: this.taskHistory.slice(-50), // Last 50 items
    };
  }
}

export const taskQueue = SequentialTaskQueue.getInstance();
