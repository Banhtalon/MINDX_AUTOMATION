import { config } from "../config";
import {
  computeReportCardContentHash,
  isRoboticsClassCode,
  jobLogRepo,
  parseManualOverridesMap,
  parseReportCardLmsSnapshot,
  reportCardRepo,
  type ClassReportCardRecord,
} from "../db/sqlite";
import { taskQueue } from "../queue/task-queue";
import {
  computeClassReportCard,
  round2,
  type ComputedClassReportCard,
  type ComputedStudentReportCardRow,
} from "../report-card/report-card-calculator";
import { normalizeVietnameseName } from "../utils/vietnamese-match";
import {
  parseStrictPositiveIntInput,
  type RemoteTeachingStudent,
} from "./teaching-project-service";

export type TeachingExerciseType = "btvn" | "cp1" | "cp2" | "final";
export type TeachingExerciseForm = "theory" | "practice" | "nang_luc";

export interface RemoteTeachingExercise {
  id: number;
  class_code?: string;
  session_number: number;
  exercise_type: TeachingExerciseType | string;
  exercise_form: TeachingExerciseForm | string;
  exercise_title?: string;
  max_score: number;
}

export interface RemoteTeachingScoreRow {
  id?: number;
  student_id: number;
  class_code?: string;
  session_number: number;
  exercise_type: TeachingExerciseType | string;
  exercise_form: TeachingExerciseForm | string;
  raw_score: number | string | null;
  normalized_score?: number | string | null;
  max_score?: number | string | null;
  note?: string | null;
}

export interface AddMultiExercisePayload {
  classCode: string;
  exerciseType: TeachingExerciseType;
  exerciseForms: TeachingExerciseForm[];
  sessions: number[];
  exerciseTitle?: string;
  maxScore: number;
  maxScoreNangLuc?: number;
}

export interface TeachingScoreInputItem {
  student_id: number;
  class_code: string;
  session_number: number;
  exercise_type: TeachingExerciseType;
  exercise_form: TeachingExerciseForm;
  raw_score: number;
  max_score: number;
  note: string;
}

export interface TeachingReportCardHttpTransport {
  getStudents(classCode: string): Promise<RemoteTeachingStudent[]>;
  getExercises(classCode: string): Promise<RemoteTeachingExercise[]>;
  getScores(classCode: string): Promise<RemoteTeachingScoreRow[]>;
  addMultiExercise(
    payload: AddMultiExercisePayload
  ): Promise<{ success: boolean; message?: string }>;
  saveScores(
    scores: TeachingScoreInputItem[]
  ): Promise<{ success: boolean; message?: string }>;
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
    // ignore invalid URL
  }
  return "https://teachingmindx.top";
}

export function parseStrictFiniteScore(raw: unknown): number | null {
  if (raw === null || raw === undefined || typeof raw === "boolean") {
    return null;
  }
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeVietnameseNamePreserveTones(name: string): string {
  if (!name) return "";
  return String(name)
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isRemoteStudentInactive(status: unknown): boolean {
  const raw = String(status || "")
    .normalize("NFC")
    .trim()
    .toLowerCase();
  if (!raw) return false;
  const asciiTokens = normalizeVietnameseName(raw.replace(/[_-]+/g, " "));
  if (
    /\b(nghi|nghi hoc|tam nghi|bao luu|chuyen lop|bo hoc|da nghi|khong hoat dong|ngung hoc|dung hoc|inactive|dropped|quit|pause|paused|hold|withdrawn|disabled|deleted|archive|archived|stop|stopped)\b/i.test(
      asciiTokens
    )
  ) {
    return true;
  }
  return /nghỉ|bảo\s*lưu|inactive|dropped|dừng|chuyển\s*lớp|nghi_hoc|tam_nghi|bao_luu|chuyen_lop|bo_hoc|da_nghi|보류|휴학|퇴원/i.test(
    raw
  );
}

function isLegitimateEmptyScoreField(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "")
  );
}

function ensureQueueNotStopped(): void {
  if ((process as any).__mindxQueueStopped || taskQueue.getStatus().isStopped) {
    throw new Error("QUEUE_STOPPED: Tác vụ đã bị dừng khẩn cấp (Stop Bot).");
  }
}

async function runWithStopGuard<T>(operation: () => Promise<T>): Promise<T> {
  ensureQueueNotStopped();
  let unsubscribe: (() => void) | null = null;
  try {
    let rejectStop!: (err: Error) => void;
    const stopPromise = new Promise<never>((_resolve, reject) => {
      rejectStop = reject;
    });
    unsubscribe = taskQueue.subscribeStatus((st) => {
      if (st.isStopped || (process as any).__mindxQueueStopped) {
        rejectStop(
          new Error("QUEUE_STOPPED: Tác vụ đã bị dừng khẩn cấp (Stop Bot).")
        );
      }
    });
    if ((process as any).__mindxQueueStopped || taskQueue.getStatus().isStopped) {
      rejectStop(
        new Error("QUEUE_STOPPED: Tác vụ đã bị dừng khẩn cấp (Stop Bot).")
      );
    }
    const result = await Promise.race([operation(), stopPromise]);
    ensureQueueNotStopped();
    return result;
  } finally {
    if (unsubscribe) {
      unsubscribe();
    }
  }
}

function studentHasAnyReportCardScore(
  student: ComputedStudentReportCardRow,
  isRobotics: boolean
): boolean {
  if (!isRobotics && student.btvnCells) {
    for (const cell of Object.values(student.btvnCells)) {
      if (!cell) continue;
      if (cell.theoryRaw !== null && Number.isFinite(cell.theoryRaw)) return true;
      if (cell.practiceRaw !== null && Number.isFinite(cell.practiceRaw)) return true;
    }
  }
  const stageVals = [
    student.cp1?.theory?.value,
    student.cp1?.practice?.value,
    student.cp1?.competency?.value,
    student.cp2?.theory?.value,
    student.cp2?.practice?.value,
    student.cp2?.competency?.value,
    student.final?.product?.value,
    student.final?.competency?.value,
  ];
  return stageVals.some((v) => v !== null && v !== undefined && Number.isFinite(v));
}

export interface MatchedTeachingStudent {
  localStudentId: string;
  localFullName: string;
  teachingStudentId: number;
  teachingStudentName: string;
}

/**
 * Matches local Report Card students to remote Teaching students (`hocsinh.php`).
 * - Enforces Cross-Class Guard on `remoteStudents`.
 * - Enforces strict positive integer IDs and rejects duplicate remote IDs.
 * - Normalizes whitespace, casing, and Unicode NFC.
 * - Rejects ambiguous duplicate names so scores are never written to the wrong student.
 * - Requires every active or scored local student to match a remote student.
 */
export function matchReportCardStudentsToTeaching(
  localStudents: ComputedStudentReportCardRow[],
  remoteStudents: RemoteTeachingStudent[],
  rawClassCode: string,
  isRobotics: boolean = isRoboticsClassCode(rawClassCode)
): Map<string, MatchedTeachingStudent> {
  const classCode = String(rawClassCode || "").trim().toUpperCase();
  if (!Array.isArray(remoteStudents) || remoteStudents.length === 0) {
    throw new Error(
      `[Student Match Error] Không tìm thấy danh sách học viên của lớp ${classCode} trên Teaching.`
    );
  }

  const sanitizedRemote: Array<{
    id: number;
    name: string;
    normTone: string;
    normNoTone: string;
    isInactive: boolean;
  }> = [];
  const seenRemoteIds = new Set<number>();

  for (const rs of remoteStudents) {
    if (
      rs?.class_code !== undefined &&
      rs?.class_code !== null &&
      String(rs.class_code).trim() !== "" &&
      String(rs.class_code).trim().toUpperCase() !== classCode
    ) {
      throw new Error(
        `[Cross-Class Guard Error] Học sinh "${rs.student_name}" thuộc lớp "${rs.class_code}" (không khớp lớp mục tiêu "${classCode}").`
      );
    }

    const id = parseStrictPositiveIntInput(rs?.id);
    if (id === null) {
      throw new Error(
        `[Student Match Error] ID học sinh trên Teaching không hợp lệ (${JSON.stringify(rs?.id)}).`
      );
    }
    if (seenRemoteIds.has(id)) {
      throw new Error(
        `[Student Match Error] Danh sách học sinh trên Teaching có ID trùng lặp (#${id}).`
      );
    }
    seenRemoteIds.add(id);

    const name = String(rs?.student_name || "").normalize("NFC").trim();
    const normTone = normalizeVietnameseNamePreserveTones(name);
    const normNoTone = normalizeVietnameseName(name);
    if (!normTone || !normNoTone) {
      throw new Error(
        `[Student Match Error] Học sinh ID=#${id} trên Teaching có họ tên trống hoặc không hợp lệ.`
      );
    }

    sanitizedRemote.push({
      id,
      name,
      normTone,
      normNoTone,
      isInactive: isRemoteStudentInactive(rs?.status),
    });
  }

  const matchedMap = new Map<string, MatchedTeachingStudent>();
  const claimedRemoteIds = new Set<number>();

  // Pre-compute local name counts among active/scored students to detect local duplicate names
  const relevantLocals = localStudents.filter(
    (s) => s.isActive !== false || studentHasAnyReportCardScore(s, isRobotics)
  );

  const localToneCounts = new Map<string, number>();
  const localNoToneCounts = new Map<string, number>();
  for (const stu of relevantLocals) {
    const t = normalizeVietnameseNamePreserveTones(stu.fullName);
    const nt = normalizeVietnameseName(stu.fullName);
    if (t) localToneCounts.set(t, (localToneCounts.get(t) || 0) + 1);
    if (nt) localNoToneCounts.set(nt, (localNoToneCounts.get(nt) || 0) + 1);
  }

  for (const stu of localStudents) {
    const isRequired =
      stu.isActive !== false || studentHasAnyReportCardScore(stu, isRobotics);
    const localTone = normalizeVietnameseNamePreserveTones(stu.fullName);
    const localNoTone = normalizeVietnameseName(stu.fullName);

    if (!localTone || !localNoTone) {
      if (isRequired) {
        throw new Error(
          `[Student Match Error] Học viên "${stu.studentId}" trong phiếu điểm có họ tên trống.`
        );
      }
      continue;
    }

    // Priority 1: Explicit Teaching ID binding ONLY when explicitly prefixed (e.g. "TEACHING_123" or "TID:123")
    // Bare numeric local IDs (e.g. "101") are LMS/CRM student IDs and MUST NOT override name matching or bypass ambiguity guards.
    const explicitIdMatch = /^(?:TEACHING(?:_ID)?|TID)[:_-](\d+)$/i.exec(
      String(stu.studentId || "").trim()
    );
    const candidateExplicitId = explicitIdMatch
      ? Number(explicitIdMatch[1])
      : null;

    if (candidateExplicitId !== null) {
      if (
        !Number.isInteger(candidateExplicitId) ||
        candidateExplicitId <= 0 ||
        claimedRemoteIds.has(candidateExplicitId)
      ) {
        throw new Error(
          `[Student Match Error] Khóa liên kết Teaching "${stu.studentId}" của học viên "${stu.fullName}" không hợp lệ hoặc đã bị trùng lặp.`
        );
      }

      const remoteById = sanitizedRemote.find(
        (r) => r.id === candidateExplicitId
      );
      if (!remoteById) {
        throw new Error(
          `[Student Match Error] Không tìm thấy học sinh ID=#${candidateExplicitId} ("${stu.fullName}") trên Teaching ở lớp ${classCode}.`
        );
      }
      if (remoteById.isInactive) {
        throw new Error(
          `[Student Match Error] Học viên "${stu.fullName}" (ID=#${candidateExplicitId}) trên Teaching đang ở trạng thái nghỉ học / bảo lưu (inactive), không thể tự động ghi điểm.`
        );
      }
      if (remoteById.normTone !== localTone) {
        throw new Error(
          `[Student Match Error] Họ tên học viên "${stu.fullName}" không khớp chính xác dấu tiếng Việt với học sinh ID=#${candidateExplicitId} ("${remoteById.name}") trên Teaching.`
        );
      }

      const activeSameToneCount = sanitizedRemote.filter(
        (r) => !r.isInactive && r.normTone === localTone
      ).length;
      if (
        activeSameToneCount !== 1 ||
        (localToneCounts.get(localTone) || 0) !== 1
      ) {
        throw new Error(
          `[Student Match Error] Có nhiều học sinh trùng tên "${stu.fullName}" trên Teaching ở lớp ${classCode}, không thể tự động ghép điểm an toàn.`
        );
      }

      claimedRemoteIds.add(remoteById.id);
      matchedMap.set(stu.studentId, {
        localStudentId: stu.studentId,
        localFullName: stu.fullName,
        teachingStudentId: remoteById.id,
        teachingStudentName: remoteById.name,
      });
      continue;
    }

    // Priority 2: Exact tone-preserving normalized name match (ACTIVE remote students only)
    if ((localToneCounts.get(localTone) || 0) > 1) {
      throw new Error(
        `[Student Match Error] Có nhiều học viên trùng tên "${stu.fullName}" trong phiếu điểm lớp ${classCode}, không thể tự động ghép điểm an toàn.`
      );
    }

    const toneCandidatesAll = sanitizedRemote.filter(
      (r) => !claimedRemoteIds.has(r.id) && r.normTone === localTone
    );
    const toneCandidatesActive = toneCandidatesAll.filter((r) => !r.isInactive);

    if (toneCandidatesActive.length > 1) {
      throw new Error(
        `[Student Match Error] Có nhiều học sinh trùng tên "${stu.fullName}" trên Teaching ở lớp ${classCode}, không thể tự động ghép điểm an toàn.`
      );
    }

    if (toneCandidatesActive.length === 1) {
      const chosen = toneCandidatesActive[0];
      claimedRemoteIds.add(chosen.id);
      matchedMap.set(stu.studentId, {
        localStudentId: stu.studentId,
        localFullName: stu.fullName,
        teachingStudentId: chosen.id,
        teachingStudentName: chosen.name,
      });
      continue;
    }

    // Priority 3: Tone-insensitive fallback (ONLY among ACTIVE remote students and ONLY if 1-to-1 unambiguous across both local & remote)
    if ((localNoToneCounts.get(localNoTone) || 0) > 1) {
      throw new Error(
        `[Student Match Error] Có nhiều học viên trùng tên không dấu "${stu.fullName}" trong phiếu điểm lớp ${classCode}, không thể tự động ghép điểm an toàn.`
      );
    }

    const noToneCandidatesAll = sanitizedRemote.filter(
      (r) => !claimedRemoteIds.has(r.id) && r.normNoTone === localNoTone
    );
    const noToneCandidatesActive = noToneCandidatesAll.filter(
      (r) => !r.isInactive && (localToneCounts.get(r.normTone) || 0) === 0
    );

    if (noToneCandidatesActive.length > 1) {
      throw new Error(
        `[Student Match Error] Có nhiều học sinh trùng tên không dấu "${stu.fullName}" trên Teaching ở lớp ${classCode}, không thể tự động ghép điểm an toàn.`
      );
    }

    if (noToneCandidatesActive.length === 1) {
      const chosen = noToneCandidatesActive[0];
      claimedRemoteIds.add(chosen.id);
      matchedMap.set(stu.studentId, {
        localStudentId: stu.studentId,
        localFullName: stu.fullName,
        teachingStudentId: chosen.id,
        teachingStudentName: chosen.name,
      });
      continue;
    }

    if (isRequired) {
      if (toneCandidatesAll.length > 0 || noToneCandidatesAll.length > 0) {
        throw new Error(
          `[Student Match Error] Học viên "${stu.fullName}" trên Teaching đang ở trạng thái nghỉ học / bảo lưu (inactive), không thể tự động ghi điểm.`
        );
      }
      throw new Error(
        `[Student Match Error] Không tìm thấy học viên "${stu.fullName}" trong danh sách lớp ${classCode} trên Teaching.`
      );
    }
  }

  return matchedMap;
}

function requireTeachingArrayPayload<T>(
  parsed: unknown,
  endpointName: string
): T[] {
  if (Array.isArray(parsed)) {
    return parsed as T[];
  }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (
      obj.success === false ||
      obj.ok === false ||
      obj.status === "error" ||
      typeof obj.error === "string"
    ) {
      const errMsg =
        typeof obj.message === "string" && obj.message.trim()
          ? obj.message.trim()
          : typeof obj.error === "string" && obj.error.trim()
          ? obj.error.trim()
          : `Teaching từ chối truy cập dữ liệu (${endpointName}).`;
      throw new Error(`[Teaching Protocol Error] ${errMsg}`);
    }
    if (obj.success === true && Array.isArray(obj.data)) {
      return obj.data as T[];
    }
  }
  throw new Error(
    `[Teaching Protocol Error] Phản hồi từ Teaching (${endpointName}) không phải danh sách mảng hợp lệ.`
  );
}

function requireTeachingMutationAck(
  parsed: unknown,
  actionName: string
): { success: boolean; message?: string } {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `[Teaching Protocol Error] Phản hồi từ Teaching (${actionName}) không đúng định dạng JSON object.`
    );
  }
  const obj = parsed as Record<string, unknown>;
  if (
    obj.success === false ||
    obj.ok === false ||
    obj.status === "error" ||
    typeof obj.error === "string"
  ) {
    const msg =
      typeof obj.message === "string" && obj.message.trim()
        ? obj.message.trim()
        : typeof obj.error === "string" && obj.error.trim()
        ? obj.error.trim()
        : `Thao tác ${actionName} trên Teaching thất bại.`;
    return { success: false, message: msg };
  }
  if (obj.success === true) {
    return {
      success: true,
      message: typeof obj.message === "string" ? obj.message : undefined,
    };
  }
  throw new Error(
    `[Teaching Protocol Error] Phản hồi từ Teaching (${actionName}) thiếu xác nhận success=true.`
  );
}

export class LiveTeachingReportCardHttpTransport
  implements TeachingReportCardHttpTransport
{
  private cookieHeader: string = "";
  private baseOrigin: string;
  private requestTimeoutMs: number;

  constructor(baseOrigin?: string, requestTimeoutMs: number = 30000) {
    this.baseOrigin = (baseOrigin || resolveTeachingBaseOrigin()).replace(/\/+$/, "");
    this.requestTimeoutMs = requestTimeoutMs;
  }

  private async fetchWithStopAndTimeout<T = Response>(
    url: string,
    init?: RequestInit,
    consumeResponse?: (res: Response) => Promise<T>
  ): Promise<T> {
    ensureQueueNotStopped();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => void) | null = null;

    try {
      const abortPromise = new Promise<never>((_resolve, reject) => {
        const onAbort = () => {
          const reason = controller.signal.reason;
          reject(
            reason instanceof Error
              ? reason
              : new Error(String(reason || "Yêu cầu mạng Teaching đã bị hủy."))
          );
        };
        if (controller.signal.aborted) {
          onAbort();
          return;
        }
        controller.signal.addEventListener("abort", onAbort, { once: true });
      });

      unsubscribe = taskQueue.subscribeStatus((st) => {
        if (st.isStopped || (process as any).__mindxQueueStopped) {
          controller.abort(
            new Error("QUEUE_STOPPED: Tác vụ đã bị dừng khẩn cấp (Stop Bot).")
          );
        }
      });

      if ((process as any).__mindxQueueStopped || taskQueue.getStatus().isStopped) {
        controller.abort(
          new Error("QUEUE_STOPPED: Tác vụ đã bị dừng khẩn cấp (Stop Bot).")
        );
      }

      timer = setTimeout(() => {
        controller.abort(
          new Error(
            `Quá thời gian chờ (${this.requestTimeoutMs}ms) khi kết nối tới Teaching (${url}).`
          )
        );
      }, this.requestTimeoutMs);

      const operationPromise = (async (): Promise<T> => {
        const res = await fetch(url, {
          ...init,
          signal: controller.signal,
        });
        ensureQueueNotStopped();
        if (consumeResponse) {
          const consumed = await consumeResponse(res);
          ensureQueueNotStopped();
          return consumed;
        }
        return res as unknown as T;
      })();

      return await Promise.race([operationPromise, abortPromise]);
    } finally {
      if (timer) clearTimeout(timer);
      if (unsubscribe) unsubscribe();
    }
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
    const r1 = await this.fetchWithStopAndTimeout(loginUrl, { redirect: "manual" });
    if (r1.status < 200 || r1.status >= 400) {
      throw new Error(
        `HTTP ${r1.status} khi truy cập trang đăng nhập Teaching (${loginUrl}).`
      );
    }
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

    const r2 = await this.fetchWithStopAndTimeout(loginUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(initialCookie ? { Cookie: initialCookie } : {}),
      },
      body: body.toString(),
      redirect: "manual",
    });

    if (r2.status < 200 || r2.status >= 400) {
      throw new Error(
        `HTTP ${r2.status} khi xác thực đăng nhập trên hệ thống Teaching (${loginUrl}).`
      );
    }

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
    const firstAttempt = await this.fetchWithStopAndTimeout<
      { redirected: true } | { redirected: false; data: T }
    >(
      url,
      {
        method: "GET",
        headers: {
          Cookie: this.cookieHeader,
          Accept: "application/json, text/plain, */*",
        },
        redirect: "manual",
      },
      async (res) => {
        if (res.status === 301 || res.status === 302) {
          return { redirected: true };
        }
        if (!res.ok) {
          throw new Error(
            `HTTP ${res.status} khi đọc dữ liệu điểm từ Teaching (${query}).`
          );
        }
        return { redirected: false, data: (await res.json()) as T };
      }
    );

    if (firstAttempt.redirected) {
      this.cookieHeader = "";
      await this.ensureLoggedIn();
      return await this.fetchWithStopAndTimeout<T>(
        url,
        {
          method: "GET",
          headers: {
            Cookie: this.cookieHeader,
            Accept: "application/json, text/plain, */*",
          },
          redirect: "manual",
        },
        async (retryRes) => {
          if (!retryRes.ok) {
            throw new Error(
              `HTTP ${retryRes.status} khi đọc dữ liệu điểm từ Teaching (${query}).`
            );
          }
          return (await retryRes.json()) as T;
        }
      );
    }

    return firstAttempt.data;
  }

  private async postForm<T>(formParams: URLSearchParams): Promise<T> {
    await this.ensureLoggedIn();
    const url = `${this.baseOrigin}/hocsinh.php`;
    const firstAttempt = await this.fetchWithStopAndTimeout<
      { redirected: true } | { redirected: false; data: T }
    >(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Cookie: this.cookieHeader,
          Accept: "application/json, text/plain, */*",
        },
        body: formParams.toString(),
        redirect: "manual",
      },
      async (res) => {
        if (res.status === 301 || res.status === 302) {
          return { redirected: true };
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} khi gửi dữ liệu điểm lên Teaching.`);
        }
        return { redirected: false, data: (await res.json()) as T };
      }
    );

    if (firstAttempt.redirected) {
      this.cookieHeader = "";
      await this.ensureLoggedIn();
      return await this.fetchWithStopAndTimeout<T>(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Cookie: this.cookieHeader,
            Accept: "application/json, text/plain, */*",
          },
          body: formParams.toString(),
          redirect: "manual",
        },
        async (retryRes) => {
          if (!retryRes.ok) {
            throw new Error(
              `HTTP ${retryRes.status} khi gửi dữ liệu điểm lên Teaching.`
            );
          }
          return (await retryRes.json()) as T;
        }
      );
    }

    return firstAttempt.data;
  }

  public async getStudents(classCode: string): Promise<RemoteTeachingStudent[]> {
    const data = await this.getJson<unknown>(
      `?get_students_of_class=1&class_code=${encodeURIComponent(classCode)}`
    );
    return requireTeachingArrayPayload<RemoteTeachingStudent>(
      data,
      "get_students_of_class"
    );
  }

  public async getExercises(classCode: string): Promise<RemoteTeachingExercise[]> {
    const data = await this.getJson<unknown>(
      `?get_class_exercises=1&class_code=${encodeURIComponent(classCode)}`
    );
    return requireTeachingArrayPayload<RemoteTeachingExercise>(
      data,
      "get_class_exercises"
    );
  }

  public async getScores(classCode: string): Promise<RemoteTeachingScoreRow[]> {
    const data = await this.getJson<unknown>(
      `?get_scores=1&class_code=${encodeURIComponent(classCode)}`
    );
    return requireTeachingArrayPayload<RemoteTeachingScoreRow>(data, "get_scores");
  }

  public async addMultiExercise(
    payload: AddMultiExercisePayload
  ): Promise<{ success: boolean; message?: string }> {
    const params = new URLSearchParams();
    params.set("action", "add_multi_exercise");
    params.set("class_code", payload.classCode);
    params.set("exercise_type", payload.exerciseType);
    for (const form of payload.exerciseForms) {
      params.append("exercise_form[]", form);
    }
    for (const sn of payload.sessions) {
      params.append("sessions[]", String(sn));
    }
    params.set("exercise_title", payload.exerciseTitle || "");
    params.set("max_score", String(payload.maxScore));
    params.set("max_score_nang_luc", String(payload.maxScoreNangLuc ?? 5));
    const rawRes = await this.postForm<unknown>(params);
    return requireTeachingMutationAck(rawRes, "add_multi_exercise");
  }

  public async saveScores(
    scores: TeachingScoreInputItem[]
  ): Promise<{ success: boolean; message?: string }> {
    const params = new URLSearchParams();
    params.set("action", "save_scores");
    scores.forEach((item, idx) => {
      params.set(`scores[${idx}][student_id]`, String(item.student_id));
      params.set(`scores[${idx}][class_code]`, item.class_code);
      params.set(`scores[${idx}][session_number]`, String(item.session_number));
      params.set(`scores[${idx}][exercise_type]`, item.exercise_type);
      params.set(`scores[${idx}][exercise_form]`, item.exercise_form);
      params.set(`scores[${idx}][raw_score]`, String(item.raw_score));
      params.set(`scores[${idx}][max_score]`, String(item.max_score));
      params.set(`scores[${idx}][note]`, item.note ?? "");
    });
    const rawRes = await this.postForm<unknown>(params);
    return requireTeachingMutationAck(rawRes, "save_scores");
  }
}

function validateRemoteExerciseList(
  exercises: RemoteTeachingExercise[],
  classCode: string
): Map<string, RemoteTeachingExercise> {
  if (!Array.isArray(exercises)) {
    throw new Error(
      `[Remote Data Error] Danh sách đầu bài trả về từ Teaching không hợp lệ.`
    );
  }
  const map = new Map<string, RemoteTeachingExercise>();
  for (const ex of exercises) {
    if (
      ex?.class_code !== undefined &&
      ex?.class_code !== null &&
      String(ex.class_code).trim() !== "" &&
      String(ex.class_code).trim().toUpperCase() !== classCode
    ) {
      throw new Error(
        `[Cross-Class Guard Error] Đầu bài ID=${ex.id} trên Teaching thuộc lớp "${ex.class_code}" (không khớp lớp mục tiêu "${classCode}").`
      );
    }
    const sn = parseStrictPositiveIntInput(ex?.session_number);
    const exType = String(ex?.exercise_type || "").trim();
    const exForm = String(ex?.exercise_form || "").trim();
    const maxScore = parseStrictFiniteScore(ex?.max_score);
    if (sn === null || !exType || !exForm || maxScore === null || maxScore <= 0) {
      continue;
    }
    const key = `${sn}-${exType}-${exForm}`;
    map.set(key, {
      ...ex,
      session_number: sn,
      exercise_type: exType,
      exercise_form: exForm,
      max_score: maxScore,
    });
  }
  return map;
}

export interface SyncReportCardToTeachingResult {
  success: boolean;
  statusCode?: number;
  conflict?: boolean;
  currentVersion?: number;
  classId: string;
  classCode: string;
  syncedScoreCount: number;
  declaredExerciseCount: number;
  record?: ClassReportCardRecord;
  reportCard?: ComputedClassReportCard;
  error?: string;
}

export class TeachingReportCardSyncService {
  /**
   * Synchronizes an APPROVED/VERIFIED class report card to `teachingmindx.top/hocsinh.php`
   * via `SequentialTaskQueue` with automatic exercise declaration (`add_multi_exercise`),
   * score saving (`save_scores`), and strict Read-after-Write Verification (`get_scores`).
   */
  public static async syncReportCardToTeaching(
    rawClassId: string,
    options?: {
      classCode?: string;
      expectedVersion?: unknown;
      transport?: TeachingReportCardHttpTransport;
    }
  ): Promise<SyncReportCardToTeachingResult> {
    const classId = String(rawClassId || "").trim().toUpperCase();
    const explicitClassCode =
      options?.classCode !== undefined && options?.classCode !== null
        ? String(options.classCode).trim().toUpperCase()
        : classId;

    if (!classId) {
      return {
        success: false,
        statusCode: 400,
        classId: "",
        classCode: "",
        syncedScoreCount: 0,
        declaredExerciseCount: 0,
        error: "Thiếu mã lớp (classId / classCode).",
      };
    }

    if (explicitClassCode && explicitClassCode !== classId) {
      return {
        success: false,
        statusCode: 400,
        classId,
        classCode: explicitClassCode,
        syncedScoreCount: 0,
        declaredExerciseCount: 0,
        error: `Mã lớp classId (${classId}) và classCode (${explicitClassCode}) không đồng nhất.`,
      };
    }

    const parsedExpectedVersion = parseStrictPositiveIntInput(
      options?.expectedVersion
    );
    if (parsedExpectedVersion === null) {
      return {
        success: false,
        statusCode: 400,
        classId,
        classCode: classId,
        syncedScoreCount: 0,
        declaredExerciseCount: 0,
        error:
          "Thiếu hoặc sai định dạng expectedVersion (phải là số nguyên dương).",
      };
    }

    const transport =
      options?.transport || new LiveTeachingReportCardHttpTransport();
    const jobId = `teaching_rc_sync_${classId}_${Date.now()}`;

    return await taskQueue.enqueue({
      id: jobId,
      jobType: "CUSTOM",
      classId,
      description: `Đồng bộ Phiếu Điểm Tổng Kết lớp ${classId} lên Teaching (hocsinh.php)`,
      execute: async (): Promise<SyncReportCardToTeachingResult> => {
        let enteredSaving = false;
        try {
          ensureQueueNotStopped();

          const current = reportCardRepo.findOne(classId);
          if (!current) {
            return {
              success: false,
              statusCode: 404,
              classId,
              classCode: classId,
              syncedScoreCount: 0,
              declaredExerciseCount: 0,
              error: `Chưa có dữ liệu phiếu điểm cho lớp ${classId}.`,
            };
          }

          if (Number(current.draftVersion) !== parsedExpectedVersion) {
            return {
              success: false,
              statusCode: 409,
              conflict: true,
              currentVersion: current.draftVersion,
              classId,
              classCode: classId,
              syncedScoreCount: 0,
              declaredExerciseCount: 0,
              record: current,
              error: `Phiên bản phiếu điểm lớp ${classId} đã thay đổi (v${current.draftVersion} !== v${parsedExpectedVersion}). Vui lòng tải lại trước khi đồng bộ.`,
            };
          }

          const snapshot = parseReportCardLmsSnapshot(
            current.lmsSnapshotJson,
            classId
          );
          const overrides = parseManualOverridesMap(current.manualOverridesJson);
          const liveHash = computeReportCardContentHash(snapshot, overrides);

          // Must be APPROVED or VERIFIED before syncing to Teaching
          if (current.status !== "APPROVED" && current.status !== "VERIFIED") {
            if (current.contentHash && current.contentHash !== liveHash) {
              try {
                reportCardRepo.markSyncingTeaching(classId, liveHash);
              } catch {
                // ignore expected throw after durable repair
              }
            }
            const refreshed = reportCardRepo.findOne(classId) || current;
            return {
              success: false,
              statusCode: 400,
              classId,
              classCode: classId,
              syncedScoreCount: 0,
              declaredExerciseCount: 0,
              record: refreshed,
              error: `Phiếu điểm lớp ${classId} chưa ở trạng thái đã duyệt (trạng thái hiện tại: ${refreshed.status}). Vui lòng bấm Duyệt trước khi đồng bộ lên Teaching.`,
            };
          }

          if (!current.contentHash || current.contentHash !== liveHash) {
            try {
              reportCardRepo.markSyncingTeaching(classId, liveHash);
            } catch {
              // markSyncingTeaching durably downgrades to WAITING_APPROVAL and clears contentHash
            }
            const refreshed = reportCardRepo.findOne(classId) || current;
            return {
              success: false,
              statusCode: 400,
              classId,
              classCode: classId,
              syncedScoreCount: 0,
              declaredExerciseCount: 0,
              record: refreshed,
              error: `Dữ liệu phiếu điểm lớp ${classId} đã thay đổi sau khi duyệt (sai lệch contentHash). Vui lòng kiểm tra và bấm Duyệt lại.`,
            };
          }

          if (!snapshot) {
            return {
              success: false,
              statusCode: 400,
              classId,
              classCode: classId,
              syncedScoreCount: 0,
              declaredExerciseCount: 0,
              record: current,
              error: `Phiếu điểm lớp ${classId} chưa có dữ liệu LMS hợp lệ để đồng bộ.`,
            };
          }

          const computed = computeClassReportCard(snapshot, overrides);
          const isRobotics = Boolean(
            computed.isRobotics || isRoboticsClassCode(classId)
          );

          if (computed.students.length === 0) {
            return {
              success: false,
              statusCode: 400,
              classId,
              classCode: classId,
              syncedScoreCount: 0,
              declaredExerciseCount: 0,
              record: current,
              reportCard: computed,
              error: `Danh sách học viên trong phiếu điểm lớp ${classId} đang trống.`,
            };
          }

          // Atomically transition to SAVING / SYNCING in SQLite (with expectedVersion & liveHash check)
          reportCardRepo.markSyncingTeaching(
            classId,
            liveHash,
            parsedExpectedVersion
          );
          enteredSaving = true;

          jobLogRepo.add({
            jobId,
            jobType: "CUSTOM",
            classId,
            level: "INFO",
            message: `Bắt đầu đồng bộ Phiếu Điểm lớp ${classId} (${isRobotics ? "Robotics" : "Lập trình"}) lên Teaching...`,
          });

          // 1. Fetch remote students & match 1-to-1
          const remoteStudents = await runWithStopGuard(() =>
            transport.getStudents(classId)
          );
          const studentMatches = matchReportCardStudentsToTeaching(
            computed.students,
            remoteStudents,
            classId,
            isRobotics
          );

          ensureQueueNotStopped();

          // 2. Fetch existing exercises & declare any missing ones
          const initialExercises = await runWithStopGuard(() =>
            transport.getExercises(classId)
          );
          let exerciseMap = validateRemoteExerciseList(initialExercises, classId);

          const cp1Session = isRobotics ? 4 : 5;
          const cp2Session = isRobotics ? 8 : 9;
          const finalSession = 14;

          let declaredExerciseCount = 0;

          // 2a. BTVN exercises (ONLY for Coding classes, NEVER for Robotics)
          if (!isRobotics && computed.btvnSessions.length > 0) {
            const missingBtvnSessions: number[] = [];
            for (const sess of computed.btvnSessions) {
              const sn = sess.sessionNumber;
              const hasTheory = exerciseMap.has(`${sn}-btvn-theory`);
              const hasPractice = exerciseMap.has(`${sn}-btvn-practice`);
              if (!hasTheory || !hasPractice) {
                missingBtvnSessions.push(sn);
              }
            }

            if (missingBtvnSessions.length > 0) {
              const addRes = await runWithStopGuard(() =>
                transport.addMultiExercise({
                  classCode: classId,
                  exerciseType: "btvn",
                  exerciseForms: ["theory", "practice"],
                  sessions: missingBtvnSessions,
                  exerciseTitle: "",
                  maxScore: 100,
                  maxScoreNangLuc: 5,
                })
              );
              if (!addRes || !addRes.success) {
                throw new Error(
                  addRes?.message ||
                    `Lỗi khi khai báo đầu bài BTVN (buổi ${missingBtvnSessions.join(", ")}) trên Teaching.`
                );
              }
              declaredExerciseCount += missingBtvnSessions.length * 2;
            }
          }

          // 2b. Check-point 1 (Buổi 5 for Coding, Buổi 4 for Robotics)
          const cp1Forms: TeachingExerciseForm[] = ["theory", "practice", "nang_luc"];
          const isCp1Missing = cp1Forms.some(
            (f) => !exerciseMap.has(`${cp1Session}-cp1-${f}`)
          );
          if (isCp1Missing) {
            const addRes = await runWithStopGuard(() =>
              transport.addMultiExercise({
                classCode: classId,
                exerciseType: "cp1",
                exerciseForms: cp1Forms,
                sessions: [cp1Session],
                exerciseTitle: "",
                maxScore: 5,
                maxScoreNangLuc: 5,
              })
            );
            if (!addRes || !addRes.success) {
              throw new Error(
                addRes?.message ||
                  `Lỗi khi khai báo đầu bài Check-point 1 (Buổi ${cp1Session}) trên Teaching.`
              );
            }
            declaredExerciseCount += cp1Forms.length;
          }

          // 2c. Check-point 2 (Buổi 9 for Coding, Buổi 8 for Robotics)
          const cp2Forms: TeachingExerciseForm[] = ["theory", "practice", "nang_luc"];
          const isCp2Missing = cp2Forms.some(
            (f) => !exerciseMap.has(`${cp2Session}-cp2-${f}`)
          );
          if (isCp2Missing) {
            const addRes = await runWithStopGuard(() =>
              transport.addMultiExercise({
                classCode: classId,
                exerciseType: "cp2",
                exerciseForms: cp2Forms,
                sessions: [cp2Session],
                exerciseTitle: "",
                maxScore: 5,
                maxScoreNangLuc: 5,
              })
            );
            if (!addRes || !addRes.success) {
              throw new Error(
                addRes?.message ||
                  `Lỗi khi khai báo đầu bài Check-point 2 (Buổi ${cp2Session}) trên Teaching.`
              );
            }
            declaredExerciseCount += cp2Forms.length;
          }

          // 2d. Final DEMO (Buổi 14: practice = Sản phẩm, nang_luc = Năng lực)
          const finalForms: TeachingExerciseForm[] = ["practice", "nang_luc"];
          const isFinalMissing = finalForms.some(
            (f) => !exerciseMap.has(`${finalSession}-final-${f}`)
          );
          if (isFinalMissing) {
            const addRes = await runWithStopGuard(() =>
              transport.addMultiExercise({
                classCode: classId,
                exerciseType: "final",
                exerciseForms: finalForms,
                sessions: [finalSession],
                exerciseTitle: "",
                maxScore: 5,
                maxScoreNangLuc: 5,
              })
            );
            if (!addRes || !addRes.success) {
              throw new Error(
                addRes?.message ||
                  `Lỗi khi khai báo đầu bài Final DEMO (Buổi ${finalSession}) trên Teaching.`
              );
            }
            declaredExerciseCount += finalForms.length;
          }

          // Refresh exercise list after declarations and verify all required exercises exist
          if (declaredExerciseCount > 0) {
            const refreshedExercises = await runWithStopGuard(() =>
              transport.getExercises(classId)
            );
            exerciseMap = validateRemoteExerciseList(refreshedExercises, classId);
          }

          const requireExercise = (
            sn: number,
            exType: TeachingExerciseType,
            exForm: TeachingExerciseForm
          ): RemoteTeachingExercise => {
            const key = `${sn}-${exType}-${exForm}`;
            const found = exerciseMap.get(key);
            if (!found) {
              throw new Error(
                `[Exercise Declaration Error] Không tìm thấy đầu bài (${key}) của lớp ${classId} trên Teaching sau khi khai báo.`
              );
            }
            return found;
          };

          if (!isRobotics) {
            for (const sess of computed.btvnSessions) {
              requireExercise(sess.sessionNumber, "btvn", "theory");
              requireExercise(sess.sessionNumber, "btvn", "practice");
            }
          }
          for (const f of cp1Forms) requireExercise(cp1Session, "cp1", f);
          for (const f of cp2Forms) requireExercise(cp2Session, "cp2", f);
          for (const f of finalForms) requireExercise(finalSession, "final", f);

          // 3. Build score items to save & track expected null slots for Read-after-Write
          const scoresToSave: TeachingScoreInputItem[] = [];
          const expectedNullSlotKeys = new Set<string>();

          const pushOrTrackSlot = (
            teachingStudentId: number,
            sn: number,
            exType: TeachingExerciseType,
            exForm: TeachingExerciseForm,
            localVal: number | null | undefined,
            localMax: number,
            noteText: string = ""
          ) => {
            const ex = requireExercise(sn, exType, exForm);
            const remoteMax = Number(ex.max_score) > 0 ? Number(ex.max_score) : localMax;
            const slotKey = `${teachingStudentId}-${sn}-${exType}-${exForm}`;

            if (localVal === null || localVal === undefined || !Number.isFinite(localVal)) {
              expectedNullSlotKeys.add(slotKey);
              return;
            }

            const scaledRaw =
              remoteMax === localMax
                ? round2(localVal)
                : round2((localVal / localMax) * remoteMax);

            if (!Number.isFinite(scaledRaw) || scaledRaw < 0 || scaledRaw > remoteMax) {
              throw new Error(
                `[Score Validation Error] Điểm (${scaledRaw}/${remoteMax}) tại (${slotKey}) nằm ngoài phạm vi hợp lệ.`
              );
            }

            scoresToSave.push({
              student_id: teachingStudentId,
              class_code: classId,
              session_number: sn,
              exercise_type: exType,
              exercise_form: exForm,
              raw_score: scaledRaw,
              max_score: remoteMax,
              note: noteText,
            });
          };

          for (const stu of computed.students) {
            const match = studentMatches.get(stu.studentId);
            if (!match) continue;
            const tStuId = match.teachingStudentId;

            if (!isRobotics) {
              for (const sess of computed.btvnSessions) {
                const sn = sess.sessionNumber;
                const cell = stu.btvnCells?.[sn];
                const theoryMax =
                  cell && Number(cell.theoryMax) > 0
                    ? Number(cell.theoryMax)
                    : sess.maxTheoryScore > 0
                    ? sess.maxTheoryScore
                    : 100;
                const practiceMax =
                  cell && Number(cell.practiceMax) > 0
                    ? Number(cell.practiceMax)
                    : sess.maxPracticeScore > 0
                    ? sess.maxPracticeScore
                    : 100;

                pushOrTrackSlot(
                  tStuId,
                  sn,
                  "btvn",
                  "theory",
                  cell?.theoryRaw ?? null,
                  theoryMax,
                  cell?.theoryNote || ""
                );
                pushOrTrackSlot(
                  tStuId,
                  sn,
                  "btvn",
                  "practice",
                  cell?.practiceRaw ?? null,
                  practiceMax,
                  cell?.practiceNote || ""
                );
              }
            }

            // CP1
            pushOrTrackSlot(
              tStuId,
              cp1Session,
              "cp1",
              "theory",
              stu.cp1.theory.value,
              5,
              stu.cp1.theory.note
            );
            pushOrTrackSlot(
              tStuId,
              cp1Session,
              "cp1",
              "practice",
              stu.cp1.practice.value,
              5,
              stu.cp1.practice.note
            );
            pushOrTrackSlot(
              tStuId,
              cp1Session,
              "cp1",
              "nang_luc",
              stu.cp1.competency.value,
              5,
              stu.cp1.competency.note
            );

            // CP2
            pushOrTrackSlot(
              tStuId,
              cp2Session,
              "cp2",
              "theory",
              stu.cp2.theory.value,
              5,
              stu.cp2.theory.note
            );
            pushOrTrackSlot(
              tStuId,
              cp2Session,
              "cp2",
              "practice",
              stu.cp2.practice.value,
              5,
              stu.cp2.practice.note
            );
            pushOrTrackSlot(
              tStuId,
              cp2Session,
              "cp2",
              "nang_luc",
              stu.cp2.competency.value,
              5,
              stu.cp2.competency.note
            );

            // Final DEMO
            pushOrTrackSlot(
              tStuId,
              finalSession,
              "final",
              "practice",
              stu.final.product.value,
              5,
              stu.final.product.note
            );
            pushOrTrackSlot(
              tStuId,
              finalSession,
              "final",
              "nang_luc",
              stu.final.competency.value,
              5,
              stu.final.competency.note
            );
          }

          if (scoresToSave.length === 0) {
            throw new Error(
              `Không có điểm số nào trong phiếu điểm của lớp ${classId} để đồng bộ lên Teaching.`
            );
          }

          ensureQueueNotStopped();

          // 4. Push scores to Teaching
          const saveRes = await runWithStopGuard(() =>
            transport.saveScores(scoresToSave)
          );
          if (!saveRes || !saveRes.success) {
            throw new Error(
              saveRes?.message ||
                `Lỗi khi lưu ${scoresToSave.length} mục điểm của lớp ${classId} lên Teaching.`
            );
          }

          // 5. Read-after-Write Verification via get_scores
          const remoteScores = await runWithStopGuard(() =>
            transport.getScores(classId)
          );
          if (!Array.isArray(remoteScores)) {
            throw new Error(
              `[Read-after-Write Error] Dữ liệu điểm đọc lại từ Teaching không phải mảng hợp lệ.`
            );
          }

          const verifiedScoreMap = new Map<string, RemoteTeachingScoreRow>();
          for (const sc of remoteScores) {
            if (
              sc?.class_code !== undefined &&
              sc?.class_code !== null &&
              String(sc.class_code).trim() !== "" &&
              String(sc.class_code).trim().toUpperCase() !== classId
            ) {
              throw new Error(
                `[Cross-Class Guard Error] Điểm đọc lại từ Teaching thuộc lớp "${sc.class_code}" (không khớp "${classId}").`
              );
            }
            const stuId = parseStrictPositiveIntInput(sc?.student_id);
            const sn = parseStrictPositiveIntInput(sc?.session_number);
            const exType = String(sc?.exercise_type || "").trim();
            const exForm = String(sc?.exercise_form || "").trim();
            if (stuId === null || sn === null || !exType || !exForm) {
              continue;
            }
            const key = `${stuId}-${sn}-${exType}-${exForm}`;
            if (verifiedScoreMap.has(key)) {
              throw new Error(
                `[Read-after-Write Error] Teaching trả về bản ghi điểm trùng lặp tại khóa (${key}).`
              );
            }
            verifiedScoreMap.set(key, sc);
          }

          // 5a. Verify every saved score matches 100% (both raw_score and authoritative normalized_score)
          for (const expected of scoresToSave) {
            const key = `${expected.student_id}-${expected.session_number}-${expected.exercise_type}-${expected.exercise_form}`;
            const actualRow = verifiedScoreMap.get(key);
            if (!actualRow) {
              throw new Error(
                `[Read-after-Write Error] Không tìm thấy điểm tại (${key}) khi đọc lại từ Teaching sau khi lưu.`
              );
            }

            const actualRaw = parseStrictFiniteScore(actualRow.raw_score);
            if (actualRaw === null) {
              throw new Error(
                `[Read-after-Write Error] Điểm raw_score tại (${key}) trên Teaching trống hoặc không hợp lệ (${JSON.stringify(actualRow.raw_score)}).`
              );
            }

            if (Math.abs(round2(actualRaw) - round2(expected.raw_score)) > 1e-6) {
              throw new Error(
                `[Read-after-Write Error] Điểm raw_score tại (${key}) trên Teaching (${actualRaw}) không khớp với giá trị đã lưu (${expected.raw_score}).`
              );
            }

            const actualNorm = parseStrictFiniteScore(actualRow.normalized_score);
            const expectedNorm = round2(
              (expected.raw_score / expected.max_score) * 5
            );
            if (actualNorm === null) {
              throw new Error(
                `[Read-after-Write Error] Điểm quy đổi thang 5 (normalized_score) tại (${key}) trên Teaching bị thiếu hoặc không hợp lệ (${JSON.stringify(actualRow.normalized_score)}).`
              );
            }
            if (Math.abs(round2(actualNorm) - expectedNorm) > 1e-6) {
              throw new Error(
                `[Read-after-Write Error] Điểm quy đổi thang 5 tại (${key}) trên Teaching (${actualRow.normalized_score}) không khớp mức kỳ vọng (${expectedNorm}).`
              );
            }
          }

          // 5b. Verify no expected-null slot still holds a stale numeric or malformed score on Teaching
          for (const nullKey of expectedNullSlotKeys) {
            const staleRow = verifiedScoreMap.get(nullKey);
            if (staleRow) {
              const staleRaw = parseStrictFiniteScore(staleRow.raw_score);
              const staleNorm = parseStrictFiniteScore(staleRow.normalized_score);
              if (
                staleRaw !== null ||
                !isLegitimateEmptyScoreField(staleRow.raw_score)
              ) {
                throw new Error(
                  `[Read-after-Write Error] Phát hiện điểm raw_score cũ hoặc không hợp lệ trên Teaching tại (${nullKey}) = ${JSON.stringify(staleRow.raw_score)} trong khi bản duyệt hiện tại để trống (null).`
                );
              }
              if (
                staleNorm !== null ||
                !isLegitimateEmptyScoreField(staleRow.normalized_score)
              ) {
                throw new Error(
                  `[Read-after-Write Error] Phát hiện điểm normalized_score cũ hoặc không hợp lệ trên Teaching tại (${nullKey}) = ${JSON.stringify(staleRow.normalized_score)} trong khi bản duyệt hiện tại để trống (null).`
                );
              }
            }
          }

          // 6. Mark VERIFIED in SQLite (with atomic liveHash, expectedVersion & SAVING/SYNCING ownership check)
          const verifiedRecord = reportCardRepo.markTeachingVerified(
            classId,
            liveHash,
            {
              classCode: classId,
              isRobotics,
              syncedScoreCount: scoresToSave.length,
              declaredExerciseCount,
              verifiedAt: new Date().toISOString(),
              studentCount: studentMatches.size,
              scores: scoresToSave,
            },
            parsedExpectedVersion
          );

          jobLogRepo.add({
            jobId,
            jobType: "CUSTOM",
            classId,
            level: "SUCCESS",
            message: `✅ VERIFIED: Đã đồng bộ và đối chiếu thành công ${scoresToSave.length} mục điểm của lớp ${classId} lên Teaching!`,
          });

          return {
            success: true,
            statusCode: 200,
            classId,
            classCode: classId,
            syncedScoreCount: scoresToSave.length,
            declaredExerciseCount,
            record: verifiedRecord,
            reportCard: computed,
          };
        } catch (err: any) {
          const errMsg = err instanceof Error ? err.message : String(err);
          let latestRecord = reportCardRepo.findOne(classId) || undefined;
          if (enteredSaving && latestRecord?.status === "SAVING") {
            latestRecord = reportCardRepo.markTeachingSyncFailed(classId, errMsg);
          }

          jobLogRepo.add({
            jobId,
            jobType: "CUSTOM",
            classId,
            level: "ERROR",
            message: `❌ Lỗi đồng bộ Phiếu Điểm lớp ${classId} lên Teaching: ${errMsg}`,
          });

          return {
            success: false,
            statusCode: 400,
            classId,
            classCode: classId,
            syncedScoreCount: 0,
            declaredExerciseCount: 0,
            record: latestRecord,
            error: errMsg,
          };
        }
      },
    });
  }
}
