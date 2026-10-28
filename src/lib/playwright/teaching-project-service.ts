import { config } from "../config";
import {
  buildDefaultTeachingProjectName,
  computeTeachingProjectHash,
  isValidIsoDateYmd,
  jobLogRepo,
  normalizeAssignedStudentIds,
  normalizeDateToIsoYmd,
  normalizeTeachingProjectTasks,
  teachingProjectRepo,
  type TeachingFinalProjectRecord,
  type TeachingProjectTaskItem,
  type TeachingStudentItem,
} from "../db/sqlite";
import {
  findMatchedCourseSyllabus,
  mergeExistingTeachingTasksWithStandardFive,
} from "../gemini/teaching-project-generator";
import { taskQueue } from "../queue/task-queue";
import { resolveClassDateRangeInfo } from "./sync-class";

export interface RemoteTeachingProject {
  id: number;
  class_code: string;
  project_name: string;
  start_date: string;
  end_date: string;
  description?: string;
}

export interface RemoteTeachingStudent {
  id: number;
  student_name: string;
  class_code: string;
  status: string;
}

export interface RemoteTeachingTask {
  id: number;
  project_id: number;
  task_name: string;
  description?: string;
  weight_percent: number;
  deadline?: string;
  assigned_students?: string | number[];
  status?: string;
}

export type RemoteTeachingProgressMap = Record<
  string,
  { progress_percent: number | string } | number
>;

export interface TeachingHttpTransport {
  getProject(classCode: string): Promise<RemoteTeachingProject | null>;
  getStudents(classCode: string): Promise<RemoteTeachingStudent[]>;
  getTasks(projectId: number): Promise<RemoteTeachingTask[]>;
  getTaskProgress(projectId: number): Promise<Record<string, number>>;
  createProject(payload: {
    classCode: string;
    projectName: string;
    startDate: string;
    endDate: string;
    description: string;
  }): Promise<{ success: boolean; message?: string; id?: number }>;
  saveTask(payload: {
    projectId: number;
    taskId?: number | null;
    taskName: string;
    weightPercent: number;
    deadline: string;
    description: string;
    assignedStudentIds: number[];
  }): Promise<{ success: boolean; message?: string; id?: number }>;
  deleteTask(taskId: number): Promise<{ success: boolean; message?: string }>;
  updateTaskProgress(payload: {
    taskId: number;
    studentId: number;
    progressPercent: number;
  }): Promise<{ success: boolean; message?: string }>;
}

function resolveTeachingBaseOrigin(): string {
  const raw = String(config.teachingUrl || "").trim();
  try {
    if (raw) {
      const parsed = new URL(raw);
      if (parsed.hostname.includes("teachingmindx.top")) {
        return parsed.origin;
      }
    }
  } catch {
    // ignore
  }
  return "https://teachingmindx.top";
}

export function parseStrictTeachingProgressInput(raw: unknown): number | null {
  if (raw === null || raw === undefined || typeof raw === "boolean") {
    return null;
  }
  if (typeof raw === "string") {
    if (raw.trim() === "") return null;
  } else if (typeof raw !== "number") {
    return null;
  }
  const pct = Number(raw);
  if (!Number.isFinite(pct) || !Number.isInteger(pct) || pct < 0 || pct > 100) {
    return null;
  }
  return pct;
}

export function parseStrictPositiveIntInput(raw: unknown): number | null {
  if (raw === null || raw === undefined || typeof raw === "boolean") {
    return null;
  }
  if (typeof raw === "string") {
    if (raw.trim() === "") return null;
  } else if (typeof raw !== "number") {
    return null;
  }
  const num = Number(raw);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num <= 0) {
    return null;
  }
  return num;
}

export function parseRemoteTeachingProgressPayload(data: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  if (!data || Array.isArray(data) || typeof data !== "object") {
    return result;
  }
  for (const [key, val] of Object.entries(data)) {
    let raw: unknown = val;
    if (val && typeof val === "object") {
      if (!("progress_percent" in val)) continue;
      raw = (val as any).progress_percent;
    }
    const pct = parseStrictTeachingProgressInput(raw);
    if (pct === null) continue;
    result[key] = pct;
  }
  return result;
}

export class LiveTeachingHttpTransport implements TeachingHttpTransport {
  private cookieHeader: string = "";
  private baseOrigin: string;

  constructor(baseOrigin?: string) {
    this.baseOrigin = (baseOrigin || resolveTeachingBaseOrigin()).replace(/\/+$/, "");
  }

  private async ensureLoggedIn(): Promise<void> {
    if (this.cookieHeader) return;

    const username = config.teachingUsername;
    const password = config.teachingPassword;
    if (!username || !password) {
      throw new Error(
        "Chưa cấu hình tài khoản hoặc mật khẩu TEACHING trong file .env.local."
      );
    }

    const loginUrl = `${this.baseOrigin}/login.php`;
    const r1 = await fetch(loginUrl, { redirect: "manual" });
    const cookies1 =
      typeof (r1.headers as any).getSetCookie === "function"
        ? ((r1.headers as any).getSetCookie() as string[])
        : [r1.headers.get("set-cookie") || ""];
    const initialCookie = cookies1
      .map((c) => c.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");

    const body = new URLSearchParams({
      username,
      password,
      remember: "on",
      redirect: "/hocsinh.php",
    });

    const r2 = await fetch(loginUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(initialCookie ? { Cookie: initialCookie } : {}),
      },
      body: body.toString(),
      redirect: "manual",
    });

    const cookies2 =
      typeof (r2.headers as any).getSetCookie === "function"
        ? ((r2.headers as any).getSetCookie() as string[])
        : [r2.headers.get("set-cookie") || ""];

    const cookieMap = new Map<string, string>();
    for (const rawCookie of [...cookies1, ...cookies2]) {
      const pair = rawCookie.split(";")[0].trim();
      if (!pair) continue;
      const eqIdx = pair.indexOf("=");
      if (eqIdx > 0) {
        cookieMap.set(pair.slice(0, eqIdx).trim(), pair.slice(eqIdx + 1).trim());
      }
    }

    this.cookieHeader = Array.from(cookieMap.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");

    if (!this.cookieHeader) {
      throw new Error(
        "Không nhận được phiên đăng nhập (Cookie) từ hệ thống Teaching."
      );
    }
  }

  private async getJson<T>(query: string): Promise<T> {
    await this.ensureLoggedIn();
    const url = `${this.baseOrigin}/hocsinh.php${query.startsWith("?") ? query : `?${query}`}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Cookie: this.cookieHeader,
        Accept: "application/json, text/plain, */*",
      },
      redirect: "manual",
    });

    if (res.status === 301 || res.status === 302) {
      // Session expired, retry login once
      this.cookieHeader = "";
      await this.ensureLoggedIn();
      const retryRes = await fetch(url, {
        method: "GET",
        headers: {
          Cookie: this.cookieHeader,
          Accept: "application/json, text/plain, */*",
        },
      });
      if (!retryRes.ok) {
        throw new Error(`HTTP ${retryRes.status} khi đọc dữ liệu từ Teaching (${query}).`);
      }
      return (await retryRes.json()) as T;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} khi đọc dữ liệu từ Teaching (${query}).`);
    }
    return (await res.json()) as T;
  }

  private async postForm<T>(formParams: URLSearchParams): Promise<T> {
    await this.ensureLoggedIn();
    const url = `${this.baseOrigin}/hocsinh.php`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Cookie: this.cookieHeader,
        Accept: "application/json, text/plain, */*",
      },
      body: formParams.toString(),
      redirect: "manual",
    });

    if (res.status === 301 || res.status === 302) {
      this.cookieHeader = "";
      await this.ensureLoggedIn();
      const retryRes = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Cookie: this.cookieHeader,
          Accept: "application/json, text/plain, */*",
        },
        body: formParams.toString(),
      });
      if (!retryRes.ok) {
        throw new Error(`HTTP ${retryRes.status} khi gửi dữ liệu lên Teaching.`);
      }
      return (await retryRes.json()) as T;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} khi gửi dữ liệu lên Teaching.`);
    }
    return (await res.json()) as T;
  }

  public async getProject(classCode: string): Promise<RemoteTeachingProject | null> {
    const data = await this.getJson<any>(
      `?get_duan_project=1&class_code=${encodeURIComponent(classCode)}`
    );
    if (!data || typeof data !== "object" || !data.id) {
      return null;
    }
    return {
      id: Number(data.id),
      class_code: String(data.class_code || classCode),
      project_name: String(data.project_name || ""),
      start_date: String(data.start_date || ""),
      end_date: String(data.end_date || ""),
      description: String(data.description || ""),
    };
  }

  public async getStudents(classCode: string): Promise<RemoteTeachingStudent[]> {
    const data = await this.getJson<any>(
      `?get_students_of_class=1&class_code=${encodeURIComponent(classCode)}`
    );
    if (!Array.isArray(data)) return [];
    return data
      .map((s) => ({
        id: Number(s.id),
        student_name: String(s.student_name || "").trim(),
        class_code: String(s.class_code || classCode).trim(),
        status: String(s.status || "đang học").trim(),
      }))
      .filter((s) => Number.isInteger(s.id) && s.id > 0 && s.student_name.length > 0);
  }

  public async getTasks(projectId: number): Promise<RemoteTeachingTask[]> {
    const data = await this.getJson<any>(
      `?get_duan_tasks=1&project_id=${encodeURIComponent(String(projectId))}`
    );
    if (!Array.isArray(data)) return [];
    return data
      .map((t) => ({
        id: Number(t.id),
        project_id: Number(t.project_id || projectId),
        task_name: String(t.task_name || "").trim(),
        description: String(t.description || ""),
        weight_percent: Number(t.weight_percent ?? 20),
        deadline: String(t.deadline || ""),
        assigned_students: t.assigned_students,
        status: String(t.status || "doing"),
      }))
      .filter((t) => Number.isInteger(t.id) && t.id > 0);
  }

  public async getTaskProgress(projectId: number): Promise<Record<string, number>> {
    const data = await this.getJson<RemoteTeachingProgressMap | unknown[]>(
      `?get_duan_task_progress=1&project_id=${encodeURIComponent(String(projectId))}`
    );
    return parseRemoteTeachingProgressPayload(data);
  }

  public async createProject(payload: {
    classCode: string;
    projectName: string;
    startDate: string;
    endDate: string;
    description: string;
  }): Promise<{ success: boolean; message?: string; id?: number }> {
    const params = new URLSearchParams();
    params.set("action", "create_project");
    params.set("class_code", payload.classCode);
    params.set("project_name", payload.projectName);
    params.set("start_date", payload.startDate);
    params.set("end_date", payload.endDate);
    params.set("description", payload.description || "");
    return await this.postForm<{ success: boolean; message?: string; id?: number }>(params);
  }

  public async saveTask(payload: {
    projectId: number;
    taskId?: number | null;
    taskName: string;
    weightPercent: number;
    deadline: string;
    description: string;
    assignedStudentIds: number[];
  }): Promise<{ success: boolean; message?: string; id?: number }> {
    const params = new URLSearchParams();
    params.set("action", "save_task");
    params.set("project_id", String(payload.projectId));
    params.set("task_id", payload.taskId ? String(payload.taskId) : "");
    params.set("task_name", payload.taskName);
    params.set("weight_percent", String(payload.weightPercent));
    params.set("deadline", payload.deadline);
    params.set("description", payload.description || "");
    for (const sid of payload.assignedStudentIds) {
      params.append("assigned_students[]", String(sid));
    }
    return await this.postForm<{ success: boolean; message?: string; id?: number }>(params);
  }

  public async deleteTask(taskId: number): Promise<{ success: boolean; message?: string }> {
    const params = new URLSearchParams();
    params.set("action", "delete_task");
    params.set("task_id", String(taskId));
    return await this.postForm<{ success: boolean; message?: string }>(params);
  }

  public async updateTaskProgress(payload: {
    taskId: number;
    studentId: number;
    progressPercent: number;
  }): Promise<{ success: boolean; message?: string }> {
    const params = new URLSearchParams();
    params.set("action", "update_task_progress");
    params.set("task_id", String(payload.taskId));
    params.set("student_id", String(payload.studentId));
    params.set("progress_percent", String(payload.progressPercent));
    return await this.postForm<{ success: boolean; message?: string }>(params);
  }
}

export interface LoadTeachingProjectResult {
  success: boolean;
  classCode: string;
  courseName: string;
  hasRemoteProject: boolean;
  remoteTaskCount: number;
  wasAutoCompletedToFive: boolean;
  extraRemoteTaskIds: number[];
  dateSource: string;
  record: TeachingFinalProjectRecord;
  tasks: TeachingProjectTaskItem[];
  students: TeachingStudentItem[];
  progress: Record<string, number>;
  error?: string;
}

export class TeachingProjectService {
  /**
   * Loads the class's Final Project state from Teaching (`hocsinh.php`),
   * merges with LMS/SQLite dates (`startDate`, `endDate`) and the 5-task standard template,
   * and returns the synchronized record.
   */
  public static async loadClassProject(
    rawClassCode: string,
    options?: {
      forceRefreshFromTeaching?: boolean;
      transport?: TeachingHttpTransport;
    }
  ): Promise<LoadTeachingProjectResult> {
    const classCode = String(rawClassCode || "").trim().toUpperCase();
    const transport = options?.transport || new LiveTeachingHttpTransport();
    const dateInfo = resolveClassDateRangeInfo(classCode);
    const syllabus = findMatchedCourseSyllabus(classCode, dateInfo.courseName);
    const courseName = dateInfo.courseName || syllabus?.courseName || "";

    let remoteProject: RemoteTeachingProject | null = null;
    let remoteStudentsRaw: RemoteTeachingStudent[] = [];
    let remoteTasksRaw: RemoteTeachingTask[] = [];
    let remoteProgress: Record<string, number> = {};
    let remoteFetchError: string | undefined;

    try {
      const [prj, stus] = await Promise.all([
        transport.getProject(classCode),
        transport.getStudents(classCode),
      ]);
      remoteProject = prj;
      remoteStudentsRaw = stus;

      if (prj && prj.id) {
        const [tasks, prog] = await Promise.all([
          transport.getTasks(prj.id),
          transport.getTaskProgress(prj.id),
        ]);
        remoteTasksRaw = tasks;
        remoteProgress = prog;
      }
    } catch (err: any) {
      remoteFetchError = err instanceof Error ? err.message : String(err);
    }

    const mappedStudents: TeachingStudentItem[] = remoteStudentsRaw.map((s) => ({
      id: s.id,
      studentName: s.student_name,
      classCode: s.class_code || classCode,
      status: s.status || "đang học",
    }));

    const activeStudentIds = mappedStudents
      .filter((s) => !s.status || /đang học|active/i.test(s.status))
      .map((s) => s.id);
    const allStudentIds =
      activeStudentIds.length > 0
        ? activeStudentIds
        : mappedStudents.map((s) => s.id);

    const existingLocal = teachingProjectRepo.findOne(classCode);

    // F04 Guard: If remote fetch failed and we already have a local record, NEVER overwrite or discard the local draft
    if (remoteFetchError && existingLocal) {
      let existingStudents: TeachingStudentItem[] = [];
      try {
        existingStudents = JSON.parse(existingLocal.studentsJson || "[]");
      } catch {
        existingStudents = [];
      }
      let existingProgress: Record<string, number> = {};
      try {
        existingProgress = JSON.parse(existingLocal.progressJson || "{}");
      } catch {
        existingProgress = {};
      }
      const existingTasks = normalizeTeachingProjectTasks(existingLocal.tasksJson);
      return {
        success: true,
        classCode,
        courseName,
        hasRemoteProject: Boolean(existingLocal.teachingProjectId),
        remoteTaskCount: existingTasks.filter((t) => Boolean(t.taskId)).length,
        wasAutoCompletedToFive: false,
        extraRemoteTaskIds: [],
        dateSource: dateInfo.source,
        record: existingLocal,
        tasks: existingTasks,
        students: existingStudents,
        progress: existingProgress,
        error: remoteFetchError,
      };
    }

    const remoteStartIso = normalizeDateToIsoYmd(remoteProject?.start_date);
    const remoteEndIso = normalizeDateToIsoYmd(remoteProject?.end_date);

    const startDate =
      remoteStartIso ||
      dateInfo.startDateIso ||
      normalizeDateToIsoYmd(existingLocal?.startDate) ||
      "";
    const endDate =
      remoteEndIso ||
      dateInfo.endDateIso ||
      normalizeDateToIsoYmd(existingLocal?.endDate) ||
      "";

    const projectName =
      remoteProject?.project_name?.trim() ||
      existingLocal?.projectName?.trim() ||
      buildDefaultTeachingProjectName(classCode);

    // F01 Guard: If remoteProject exists on Teaching, preserve its exact description (even if empty string)
    // so local description matches remoteProject unless edited by teacher.
    const description =
      remoteProject && remoteProject.id
        ? String(remoteProject.description ?? "").trim()
        : existingLocal?.description !== undefined
        ? existingLocal.description.trim()
        : syllabus?.description || "";

    const mergedTaskResult = mergeExistingTeachingTasksWithStandardFive({
      classCode,
      courseName,
      endDate,
      allStudentIds,
      existingRemoteTasks: remoteTasksRaw,
    });

    const finalStudents: TeachingStudentItem[] =
      mappedStudents.length > 0
        ? mappedStudents
        : (() => {
            try {
              return JSON.parse(existingLocal?.studentsJson || "[]");
            } catch {
              return [];
            }
          })();

    const finalProgress: Record<string, number> =
      Object.keys(remoteProgress).length > 0
        ? remoteProgress
        : (() => {
            try {
              return JSON.parse(existingLocal?.progressJson || "{}");
            } catch {
              return {};
            }
          })();

    let record: TeachingFinalProjectRecord;
    if (!existingLocal) {
      // F02 Guard: Never auto-approve or auto-mark VERIFIED during loadClassProject.
      // Imported/repaired data always starts as DRAFT until reviewed & approved by the teacher.
      record = teachingProjectRepo.getOrInit(classCode, {
        teachingProjectId: remoteProject?.id ?? null,
        projectName,
        startDate,
        endDate,
        description,
        tasks: mergedTaskResult.tasks,
        students: finalStudents,
        progress: finalProgress,
      });
    } else if (options?.forceRefreshFromTeaching && !remoteFetchError) {
      const saved = teachingProjectRepo.saveDraft({
        classId: classCode,
        teachingProjectId: remoteProject?.id ?? existingLocal.teachingProjectId ?? null,
        projectName,
        startDate,
        endDate,
        description,
        tasks: mergedTaskResult.tasks,
        students: finalStudents,
        progress: finalProgress,
      });
      record = saved.record;
    } else {
      // F04 Guard: Preserve saved local draft text, tasks, status, and draftVersion; only sync remote metadata
      record = teachingProjectRepo.syncRemoteMetadata({
        classId: classCode,
        teachingProjectId: remoteProject?.id ?? existingLocal.teachingProjectId ?? null,
        students: finalStudents,
        progress: finalProgress,
      });
    }

    return {
      success: !remoteFetchError || Boolean(existingLocal),
      classCode,
      courseName,
      hasRemoteProject: Boolean(remoteProject?.id ?? record.teachingProjectId),
      remoteTaskCount: remoteTasksRaw.length,
      wasAutoCompletedToFive: mergedTaskResult.wasAutoCompleted,
      extraRemoteTaskIds: mergedTaskResult.extraRemoteTaskIds,
      dateSource: remoteStartIso && remoteEndIso ? "TEACHING" : dateInfo.source,
      record,
      tasks: normalizeTeachingProjectTasks(record.tasksJson),
      students: finalStudents,
      progress: finalProgress,
      ...(remoteFetchError ? { error: remoteFetchError } : {}),
    };
  }

  /**
   * Pushes the Approved Project & 5 Tasks to `teachingmindx.top/hocsinh.php`
   * via `SequentialTaskQueue` and performs strict Read-after-Write Verification.
   */
  public static async syncProjectAndTasksToTeaching(
    rawClassCode: string,
    options?: {
      cleanupExtraTasks?: boolean;
      transport?: TeachingHttpTransport;
    }
  ): Promise<{
    success: boolean;
    classCode: string;
    teachingProjectId?: number;
    record: TeachingFinalProjectRecord;
    verifiedTasks?: TeachingProjectTaskItem[];
    error?: string;
  }> {
    const classCode = String(rawClassCode || "").trim().toUpperCase();
    const cleanupExtraTasks = options?.cleanupExtraTasks !== false;
    const transport = options?.transport || new LiveTeachingHttpTransport();

    const current = teachingProjectRepo.getOrInit(classCode);
    if (current.status !== "APPROVED" && current.status !== "VERIFIED") {
      return {
        success: false,
        classCode,
        record: current,
        error: `Dự án lớp ${classCode} chưa ở trạng thái Đã duyệt (hiện tại: ${current.status}). Vui lòng bấm Duyệt trước khi đẩy lên Teaching.`,
      };
    }

    const expectedHash = current.contentHash;
    const liveHash = computeTeachingProjectHash({
      classId: classCode,
      projectName: current.projectName,
      startDate: current.startDate,
      endDate: current.endDate,
      description: current.description,
      tasks: current.tasksJson,
    });

    if (!expectedHash || liveHash !== expectedHash) {
      const demoted = teachingProjectRepo.demoteToWaitingApproval(
        classCode,
        "Nội dung dự án đã bị chỉnh sửa sau khi duyệt. Vui lòng bấm Duyệt lại."
      );
      return {
        success: false,
        classCode,
        record: demoted,
        error: "Nội dung dự án đã bị chỉnh sửa sau khi duyệt. Vui lòng bấm Duyệt lại.",
      };
    }

    const taskId = `teaching_sync_${classCode}_${Date.now()}`;
    return await taskQueue.enqueue({
      id: taskId,
      jobType: "CUSTOM",
      classId: classCode,
      description: `Đẩy Dự án cuối khóa & 5 phần công việc lớp ${classCode} lên Teaching`,
      execute: async () => {
        try {
          if ((process as any).__mindxQueueStopped) {
            throw new Error("Tác vụ đã bị dừng khẩn cấp (Stop Bot).");
          }

          const savingRecord = teachingProjectRepo.markSaving(classCode, expectedHash);
          const approvedTasks = normalizeTeachingProjectTasks(
            savingRecord.tasksJson,
            savingRecord.endDate
          );

          if (approvedTasks.length !== 5) {
            throw new Error(
              `Số lượng công việc không hợp lệ (${approvedTasks.length}/5).`
            );
          }

          // 1. Check or Create Project on Teaching
          let remoteProject = await transport.getProject(classCode);
          let createdNewProject = false;

          if (!remoteProject || !remoteProject.id) {
            jobLogRepo.add({
              jobId: taskId,
              jobType: "CUSTOM",
              classId: classCode,
              level: "INFO",
              message: `Lớp ${classCode} chưa có dự án trên Teaching -> Đang tạo dự án "${savingRecord.projectName}" (${savingRecord.startDate} -> ${savingRecord.endDate})...`,
            });

            const createRes = await transport.createProject({
              classCode,
              projectName: savingRecord.projectName,
              startDate: savingRecord.startDate,
              endDate: savingRecord.endDate,
              description: savingRecord.description,
            });

            if (!createRes || !createRes.success) {
              throw new Error(
                createRes?.message ||
                  `Không thể tạo dự án cuối khóa cho lớp ${classCode} trên Teaching.`
              );
            }

            createdNewProject = true;
            remoteProject = await transport.getProject(classCode);
            if (!remoteProject || !remoteProject.id) {
              throw new Error(
                `Đã gọi create_project cho lớp ${classCode} nhưng không tìm thấy project_id khi đọc lại từ Teaching.`
              );
            }
          }

          const projectId = Number(remoteProject.id);

          // 2. Fetch existing remote tasks so we update in-place instead of duplicating
          const existingRemoteTasks = await transport.getTasks(projectId);
          const usedRemoteIds = new Set<number>();

          for (let i = 0; i < 5; i++) {
            if ((process as any).__mindxQueueStopped) {
              throw new Error("Tác vụ đã bị dừng khẩn cấp (Stop Bot).");
            }

            const t = approvedTasks[i];
            let targetTaskId: number | null = null;

            if (
              t.taskId &&
              existingRemoteTasks.some((rt) => Number(rt.id) === Number(t.taskId)) &&
              !usedRemoteIds.has(Number(t.taskId))
            ) {
              targetTaskId = Number(t.taskId);
            } else if (
              existingRemoteTasks[i] &&
              !usedRemoteIds.has(Number(existingRemoteTasks[i].id))
            ) {
              targetTaskId = Number(existingRemoteTasks[i].id);
            }

            if (targetTaskId !== null) {
              usedRemoteIds.add(targetTaskId);
            }

            jobLogRepo.add({
              jobId: taskId,
              jobType: "CUSTOM",
              classId: classCode,
              level: "INFO",
              message: `Đang ${targetTaskId ? `cập nhật (ID=${targetTaskId})` : "thêm mới"} Công việc ${i + 1}/5: "${t.taskName}" (${t.weightPercent}%, hạn ${t.deadline})...`,
            });

            const saveRes = await transport.saveTask({
              projectId,
              taskId: targetTaskId,
              taskName: t.taskName,
              weightPercent: t.weightPercent,
              deadline: t.deadline,
              description: t.description,
              assignedStudentIds: t.assignedStudentIds,
            });

            if (!saveRes || !saveRes.success) {
              throw new Error(
                saveRes?.message ||
                  `Lỗi khi lưu Công việc ${i + 1}/5 ("${t.taskName}") lên Teaching.`
              );
            }
          }

          // 3. Optionally clean up any leftover extra tasks beyond the 5 standard tasks
          if (cleanupExtraTasks && existingRemoteTasks.length > 5) {
            for (const rt of existingRemoteTasks) {
              const rid = Number(rt.id);
              if (!usedRemoteIds.has(rid)) {
                await transport.deleteTask(rid);
              }
            }
          }

          // 4. Read-after-Write Verification
          jobLogRepo.add({
            jobId: taskId,
            jobType: "CUSTOM",
            classId: classCode,
            level: "INFO",
            message: `Đang thực hiện Read-after-Write Verification đối chiếu Dự án & 5 Công việc trên Teaching...`,
          });

          const [verifiedPrj, verifiedRemoteTasks] = await Promise.all([
            transport.getProject(classCode),
            transport.getTasks(projectId),
          ]);

          if (!verifiedPrj || Number(verifiedPrj.id) !== projectId) {
            throw new Error(
              `[Read-after-Write Error] Không tìm thấy dự án ID=${projectId} trên Teaching khi đọc lại đối chiếu.`
            );
          }

          // F01 Guard: Always verify ALL 4 project fields (project_name, start_date, end_date, description)
          // against the approved record, whether the project was newly created or pre-existing on Teaching.
          const remoteProjectName = String(verifiedPrj.project_name || "").trim();
          const remoteStartIso = normalizeDateToIsoYmd(verifiedPrj.start_date);
          const remoteEndIso = normalizeDateToIsoYmd(verifiedPrj.end_date);
          const remoteProjDesc = String(verifiedPrj.description || "")
            .replace(/\r\n/g, "\n")
            .trim();
          const expectedProjDesc = String(savingRecord.description || "")
            .replace(/\r\n/g, "\n")
            .trim();

          if (remoteProjectName !== savingRecord.projectName.trim()) {
            throw new Error(
              `[Read-after-Write Error] Tên dự án trên Teaching ("${remoteProjectName}") không khớp với bản đã duyệt ("${savingRecord.projectName}").`
            );
          }
          if (remoteStartIso !== savingRecord.startDate) {
            throw new Error(
              `[Read-after-Write Error] Ngày bắt đầu trên Teaching ("${verifiedPrj.start_date}") không khớp với bản đã duyệt ("${savingRecord.startDate}").`
            );
          }
          if (remoteEndIso !== savingRecord.endDate) {
            throw new Error(
              `[Read-after-Write Error] Ngày kết thúc trên Teaching ("${verifiedPrj.end_date}") không khớp với bản đã duyệt ("${savingRecord.endDate}").`
            );
          }
          if (remoteProjDesc !== expectedProjDesc) {
            throw new Error(
              `[Read-after-Write Error] Mô tả dự án trên Teaching ("${remoteProjDesc}") không khớp với bản đã duyệt ("${expectedProjDesc}").`
            );
          }

          if (cleanupExtraTasks && verifiedRemoteTasks.length !== 5) {
            throw new Error(
              `[Read-after-Write Error] Số lượng công việc trên Teaching sau khi lưu là ${verifiedRemoteTasks.length} (yêu cầu đúng 5 công việc).`
            );
          } else if (verifiedRemoteTasks.length < 5) {
            throw new Error(
              `[Read-after-Write Error] Teaching chỉ trả về ${verifiedRemoteTasks.length}/5 công việc sau khi lưu.`
            );
          }

          const verifiedTaskItems: TeachingProjectTaskItem[] = [];
          const claimedVerifyIds = new Set<number>();

          for (let i = 0; i < 5; i++) {
            const expectedTask = approvedTasks[i];
            const expectedStudents = normalizeAssignedStudentIds(
              expectedTask.assignedStudentIds
            );

            // Match by position first, or by task_name if order shifted
            let matchedRemote = verifiedRemoteTasks[i];
            if (
              !matchedRemote ||
              claimedVerifyIds.has(Number(matchedRemote.id)) ||
              matchedRemote.task_name.trim() !== expectedTask.taskName.trim()
            ) {
              const found = verifiedRemoteTasks.find(
                (rt) =>
                  !claimedVerifyIds.has(Number(rt.id)) &&
                  rt.task_name.trim() === expectedTask.taskName.trim()
              );
              if (found) matchedRemote = found;
            }

            if (!matchedRemote) {
              throw new Error(
                `[Read-after-Write Error] Không tìm thấy Công việc ${i + 1} ("${expectedTask.taskName}") trên Teaching.`
              );
            }

            claimedVerifyIds.add(Number(matchedRemote.id));

            if (matchedRemote.task_name.trim() !== expectedTask.taskName.trim()) {
              throw new Error(
                `[Read-after-Write Error] Tên Công việc ${i + 1} trên Teaching ("${matchedRemote.task_name}") không khớp với bản đã duyệt ("${expectedTask.taskName}").`
              );
            }

            const remoteDesc = String(matchedRemote.description || "")
              .replace(/\r\n/g, "\n")
              .trim();
            const expectedDesc = String(expectedTask.description || "")
              .replace(/\r\n/g, "\n")
              .trim();
            if (remoteDesc !== expectedDesc) {
              throw new Error(
                `[Read-after-Write Error] Mô tả của Công việc ${i + 1} ("${expectedTask.taskName}") trên Teaching không khớp với bản đã duyệt.`
              );
            }

            if (Number(matchedRemote.weight_percent) !== Number(expectedTask.weightPercent)) {
              throw new Error(
                `[Read-after-Write Error] Tỷ trọng của Công việc ${i + 1} trên Teaching (${matchedRemote.weight_percent}%) không khớp (${expectedTask.weightPercent}%).`
              );
            }

            const remoteDeadline = normalizeDateToIsoYmd(matchedRemote.deadline);
            if (!remoteDeadline || remoteDeadline !== expectedTask.deadline) {
              throw new Error(
                `[Read-after-Write Error] Hạn nộp (Deadline) của Công việc ${i + 1} trên Teaching ("${matchedRemote.deadline}") không khớp với bản đã duyệt ("${expectedTask.deadline}").`
              );
            }

            const remoteStudents = normalizeAssignedStudentIds(
              matchedRemote.assigned_students
            );
            if (JSON.stringify(remoteStudents) !== JSON.stringify(expectedStudents)) {
              throw new Error(
                `[Read-after-Write Error] Danh sách học sinh được giao ở Công việc ${i + 1} trên Teaching (${remoteStudents.length} HS) không khớp với bản đã duyệt (${expectedStudents.length} HS).`
              );
            }

            verifiedTaskItems.push({
              slotIndex: i + 1,
              taskId: Number(matchedRemote.id),
              taskName: matchedRemote.task_name.trim(),
              description: remoteDesc,
              weightPercent: Number(matchedRemote.weight_percent),
              deadline: remoteDeadline,
              assignedStudentIds: remoteStudents,
            });
          }

          const verifiedRecord = teachingProjectRepo.markVerified(
            classCode,
            expectedHash,
            {
              teachingProjectId: projectId,
              verifiedProject: {
                projectName: remoteProjectName,
                startDate: remoteStartIso,
                endDate: remoteEndIso,
                description: remoteProjDesc,
              },
              verifiedTasks: verifiedTaskItems,
              verifiedSnapshot: {
                verifiedPrj,
                verifiedRemoteTasks,
                verifiedAt: new Date().toISOString(),
              },
            }
          );

          jobLogRepo.add({
            jobId: taskId,
            jobType: "CUSTOM",
            classId: classCode,
            level: "SUCCESS",
            message: `✅ VERIFIED: Đã đẩy và đối chiếu thành công Dự án "${savingRecord.projectName}" (ID=${projectId}) cùng đủ 5 phần công việc (100%) lên Teaching!`,
          });

          return {
            success: true,
            classCode,
            teachingProjectId: projectId,
            record: verifiedRecord,
            verifiedTasks: verifiedTaskItems,
          };
        } catch (err: any) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const failedRecord = teachingProjectRepo.markFailed(classCode, errMsg);
          jobLogRepo.add({
            jobId: taskId,
            jobType: "CUSTOM",
            classId: classCode,
            level: "ERROR",
            message: `❌ Lỗi đẩy Dự án lớp ${classCode} lên Teaching: ${errMsg}`,
          });
          return {
            success: false,
            classCode,
            record: failedRecord,
            error: errMsg,
          };
        }
      },
    });
  }

  /**
   * Updates task completion progress (%) for one or multiple students/tasks on Teaching
   * via `SequentialTaskQueue` with Read-after-Write Verification.
   */
  public static async updateTaskProgressOnTeaching(
    rawClassCode: string,
    updates: Array<{
      taskId: number;
      studentId: number;
      progressPercent: number;
    }>,
    options?: {
      transport?: TeachingHttpTransport;
    }
  ): Promise<{
    success: boolean;
    classCode: string;
    updatedCount: number;
    progress: Record<string, number>;
    error?: string;
  }> {
    const classCode = String(rawClassCode || "").trim().toUpperCase();
    const transport = options?.transport || new LiveTeachingHttpTransport();

    if (!Array.isArray(updates) || updates.length === 0) {
      return {
        success: false,
        classCode,
        updatedCount: 0,
        progress: {},
        error: "Danh sách cập nhật tiến độ trống.",
      };
    }

    const sanitizedUpdates: Array<{
      taskId: number;
      studentId: number;
      progressPercent: number;
    }> = [];

    for (let idx = 0; idx < updates.length; idx++) {
      const rawItem = updates[idx] as any;
      const taskId = parseStrictPositiveIntInput(rawItem?.taskId);
      const studentId = parseStrictPositiveIntInput(rawItem?.studentId);
      const progressPercent = parseStrictTeachingProgressInput(rawItem?.progressPercent);

      if (taskId === null || studentId === null || progressPercent === null) {
        return {
          success: false,
          classCode,
          updatedCount: 0,
          progress: {},
          error: `Dữ liệu cập nhật tiến độ tại mục #${idx + 1} không hợp lệ: taskId, studentId phải là số nguyên dương và progressPercent phải là số nguyên từ 0 đến 100.`,
        };
      }

      sanitizedUpdates.push({
        taskId,
        studentId,
        progressPercent,
      });
    }

    const jobId = `teaching_prog_${classCode}_${Date.now()}`;
    return await taskQueue.enqueue({
      id: jobId,
      jobType: "CUSTOM",
      classId: classCode,
      description: `Cập nhật tiến độ ${sanitizedUpdates.length} mục dự án lớp ${classCode} trên Teaching`,
      execute: async () => {
        try {
          const current = teachingProjectRepo.getOrInit(classCode);
          let projectId = current.teachingProjectId
            ? Number(current.teachingProjectId)
            : null;

          if (!projectId) {
            const remotePrj = await transport.getProject(classCode);
            if (!remotePrj || !remotePrj.id) {
              throw new Error(
                `Không tìm thấy dự án của lớp ${classCode} trên Teaching để cập nhật tiến độ.`
              );
            }
            projectId = Number(remotePrj.id);
          }

          // F05 Guard: Require APPROVED/VERIFIED local record and validate every taskId & studentId against BOTH SQLite approved tasks and remote Teaching tasks BEFORE writing
          if (current.status !== "APPROVED" && current.status !== "VERIFIED") {
            throw new Error(
              `[Cross-Class Guard Error] Dự án của lớp ${classCode} chưa ở trạng thái APPROVED/VERIFIED (hiện tại: ${current.status}). Vui lòng duyệt và đồng bộ 5 công việc trước khi ghi tiến độ.`
            );
          }

          const approvedTaskMap = new Map<number, TeachingProjectTaskItem>();
          try {
            const parsedLocalTasks = JSON.parse(
              current.tasksJson || "[]"
            ) as TeachingProjectTaskItem[];
            for (const lt of parsedLocalTasks) {
              const tid = Number(lt?.taskId);
              if (Number.isInteger(tid) && tid > 0) {
                approvedTaskMap.set(tid, lt);
              }
            }
          } catch {
            // ignore
          }

          const [remoteTasks, remoteStudents] = await Promise.all([
            transport.getTasks(projectId),
            transport.getStudents(classCode),
          ]);
          const remoteTaskMap = new Map<number, RemoteTeachingTask>();
          for (const rt of remoteTasks) {
            if (Number(rt.project_id) === projectId) {
              remoteTaskMap.set(Number(rt.id), rt);
            }
          }

          const validStudentIds = new Set<number>();
          for (const rs of remoteStudents) {
            if (
              !rs.class_code ||
              String(rs.class_code).trim().toUpperCase() === classCode
            ) {
              validStudentIds.add(Number(rs.id));
            }
          }
          if (validStudentIds.size === 0) {
            try {
              const localStus = JSON.parse(current.studentsJson || "[]") as TeachingStudentItem[];
              for (const ls of localStus) {
                if (
                  !ls.classCode ||
                  String(ls.classCode).trim().toUpperCase() === classCode
                ) {
                  validStudentIds.add(Number(ls.id));
                }
              }
            } catch {
              // ignore
            }
          }

          for (const item of sanitizedUpdates) {
            const approvedTask = approvedTaskMap.get(item.taskId);
            if (!approvedTask) {
              throw new Error(
                `[Cross-Class Guard Error] Công việc ID=${item.taskId} không nằm trong danh sách 5 công việc đã duyệt của lớp ${classCode}. Đã chặn cập nhật tiến độ.`
              );
            }
            const matchedTask = remoteTaskMap.get(item.taskId);
            if (!matchedTask) {
              throw new Error(
                `[Cross-Class Guard Error] Công việc ID=${item.taskId} không thuộc dự án ID=${projectId} của lớp ${classCode}. Đã chặn cập nhật tiến độ.`
              );
            }
            if (!validStudentIds.has(item.studentId)) {
              throw new Error(
                `[Cross-Class Guard Error] Học sinh ID=${item.studentId} không thuộc danh sách lớp ${classCode}. Đã chặn cập nhật tiến độ.`
              );
            }
            const approvedAssignees = normalizeAssignedStudentIds(
              approvedTask.assignedStudentIds
            );
            const taskAssignees = normalizeAssignedStudentIds(
              matchedTask.assigned_students
            );
            if (approvedAssignees.length === 0 || taskAssignees.length === 0) {
              throw new Error(
                `[Cross-Class Guard Error] Công việc ID=${item.taskId} (lớp ${classCode}) có danh sách học sinh được phân công rỗng. Đã chặn cập nhật tiến độ.`
              );
            }
            if (
              !approvedAssignees.includes(item.studentId) ||
              !taskAssignees.includes(item.studentId)
            ) {
              throw new Error(
                `[Cross-Class Guard Error] Học sinh ID=${item.studentId} không nằm trong danh sách được giao của công việc ID=${item.taskId} (lớp ${classCode}).`
              );
            }
          }

          for (const item of sanitizedUpdates) {
            if ((process as any).__mindxQueueStopped) {
              throw new Error("Tác vụ đã bị dừng khẩn cấp (Stop Bot).");
            }
            const res = await transport.updateTaskProgress({
              taskId: item.taskId,
              studentId: item.studentId,
              progressPercent: item.progressPercent,
            });
            if (!res || !res.success) {
              throw new Error(
                res?.message ||
                  `Lỗi cập nhật tiến độ task=${item.taskId}, student=${item.studentId}.`
              );
            }
          }

          // F09 Guard: Read-after-Write Verification on task progress must require explicit key presence and valid integer 0..100
          const rawVerifiedProgress = await transport.getTaskProgress(projectId);
          const verifiedProgress = parseRemoteTeachingProgressPayload(rawVerifiedProgress);
          for (const item of sanitizedUpdates) {
            const key = `${item.taskId}_${item.studentId}`;
            if (
              !Object.prototype.hasOwnProperty.call(verifiedProgress, key) ||
              !Number.isFinite(Number(verifiedProgress[key]))
            ) {
              throw new Error(
                `[Read-after-Write Error] Không tìm thấy dữ liệu tiến độ của học sinh ID=${item.studentId} ở công việc ID=${item.taskId} khi đọc lại từ Teaching.`
              );
            }
            const actual = Number(verifiedProgress[key]);
            if (actual !== Number(item.progressPercent)) {
              throw new Error(
                `[Read-after-Write Error] Tiến độ của học sinh ID=${item.studentId} ở công việc ID=${item.taskId} trên Teaching là ${actual}% (không khớp mức đã lưu ${item.progressPercent}%).`
              );
            }
          }

          teachingProjectRepo.updateProgressSnapshot(classCode, verifiedProgress);

          jobLogRepo.add({
            jobId,
            jobType: "CUSTOM",
            classId: classCode,
            level: "SUCCESS",
            message: `✅ VERIFIED: Đã cập nhật và đối chiếu tiến độ ${sanitizedUpdates.length} mục dự án lớp ${classCode} trên Teaching.`,
          });

          return {
            success: true,
            classCode,
            updatedCount: sanitizedUpdates.length,
            progress: verifiedProgress,
          };
        } catch (err: any) {
          const errMsg = err instanceof Error ? err.message : String(err);
          jobLogRepo.add({
            jobId,
            jobType: "CUSTOM",
            classId: classCode,
            level: "ERROR",
            message: `❌ Lỗi cập nhật tiến độ dự án lớp ${classCode}: ${errMsg}`,
          });
          let fallbackProg: Record<string, number> = {};
          try {
            const rec = teachingProjectRepo.findOne(classCode);
            fallbackProg = JSON.parse(rec?.progressJson || "{}");
          } catch {
            fallbackProg = {};
          }
          return {
            success: false,
            classCode,
            updatedCount: 0,
            progress: fallbackProg,
            error: errMsg,
          };
        }
      },
    });
  }
}
