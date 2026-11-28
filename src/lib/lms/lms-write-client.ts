/**
 * MINDX AUTOMATION BOT - PURE-NODE LMS WRITE API OVERWRITE ENGINE (v3.8.9 — Phase 2A)
 *
 * Replaces fragile Playwright drawer/dropzone/modal DOM automation with direct
 * MindX Resource Upload (`POST https://resources.mindx.edu.vn/api/v1/resources`) +
 * MindX LMS GraphQL mutations (`CreateStudentWork`, `UpdateStudentWork`,
 * `DeleteStudentWork`, `UpdateSlotComment`, `CreateStudentLetters`, `UpdateStudentLetters`)
 * enforced with:
 * 1. SHA-256 -> Remote URL SQLite deduplication cache (`lmsResourceCacheRepo`).
 * 2. Exact Session 12/13/14 overwrite semantics (update Item 01 in place, prune duplicate Item 02+).
 * 3. Path Allowlist, pre-write CAS hash checks, and mandatory Read-after-Write GraphQL verification.
 * 4. Two-layer safety kill-switch (`MINDX_LMS_API_WRITE=false` + Playwright fallback on transport failures).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { getDynamicLmsApiWriteEnvValue } from "../config";
import { getCoursesSyllabus } from "../db/json-config";
import {
  COMPETENCY_AREA_SPECS,
  LEGO_COMPETENCY_AREA_SPECS,
  clampCompetencyRating,
  getCompetencyKeysForClassPure,
  isLegoRoboticsClassCodePure,
  matchesCompetencyAreaIdPure,
  parseCompetencyScoresPure,
  type CompetencyScores,
} from "../checkpoint/competency-specs";
import {
  hasMatchingCheckpointLmsCompetency,
  parseCheckpointDataJson,
  resolveCheckpointStageForSession,
} from "../checkpoint/checkpoint-competency";
import {
  assertClassHasSpckSession,
  buildEnrichedSession14EvalList,
  computeSafeFileByteDigest,
  computeSession14EvalHash,
  computeSpckContentHash,
  extractCheckpointCoreSnapshotHash,
  formatRoboticsAwardRankingHtmlForLms,
  getDb,
  getSession14DemoLimitsForClass,
  isLegoRoboticsClassCode,
  isRoboticsClassCode,
  isValidSpckSessionSlot,
  jobLogRepo,
  lmsResourceCacheRepo,
  normalizeSpckFolderKey,
  parseSession14CompetencyScores,
  parseSession14DemoScores,
  resolveRoboticsAwardRankGrade,
  SESSION14_COMPETENCY_KEYS,
  session14ClassSummaryRepo,
  session14EvalRepo,
  sessionFeedbackRepo,
  spckSessionRepo,
  spckUploadRepo,
  stripSpckSessionSuffix,
  studentRepo,
  syncVerifiedCheckpointToReportCardSnapshot,
  validateSpckTitleLength,
  verifyContentIntegrity,
  verifySession14EvalIntegrity,
  verifySpckContentIntegrity,
  verifySpckSessionIntegrity,
  type SessionFeedbackRecord,
  type SpckSession14CompetencyScores,
  type SpckSession14DemoScores,
  type SpckSessionSlotNumber,
  type SpckUploadRecord,
} from "../db/sqlite";
import { parseMediaBuffer } from "../file-parsers/media-reader";
import { getEffectiveClassSession14Summary } from "../local-files/spck-demo-score-reader";
import { normalizeImagesToLms16x9 } from "../local-files/spck-image-normalizer";
import {
  ALLOWED_IMAGE_EXTENSIONS,
  MAX_SPCK_ATTACHMENTS,
  MAX_SPCK_RELATED_LINKS,
  MAX_SPCK_SCREENSHOTS,
  MAX_SPCK_TITLE_LENGTH,
  MAX_SPCK_YOUTUBE_URLS,
  validateSpckAttachmentFile,
  validateSpckRelatedUrl,
  validateSpckYoutubeUrl,
  type SpckRelatedLink,
} from "../local-files/spck-scanner";
import { assertPathAllowed } from "../security/path-allowlist";
import { redactSecrets } from "../security/secret-redactor";
import { ensureQueueNotStopped } from "../teaching/teaching-http-client";
import { normalizeVietnameseName } from "../utils/vietnamese-match";
import { resolveKnownLmsClassId } from "./lms-class-id-store";
import {
  LMS_CREATE_STUDENT_LETTERS_MUTATION,
  LMS_CREATE_STUDENT_WORK_MUTATION,
  LMS_DELETE_STUDENT_WORK_MUTATION,
  LMS_EMAIL_TEMPLATES_QUERY,
  LMS_FIND_ALL_STUDENT_WORKS_FULL_QUERY,
  LMS_FIND_ONE_STUDENT_LETTER_QUERY,
  LMS_GET_CLASSES_MINIMAL_QUERY,
  LMS_GET_CLASS_BY_ID_QUERY,
  LMS_GET_CLASS_BY_ID_SAFE_QUERY,
  LMS_GET_CLASS_WRITE_CONTEXT_QUERY,
  LMS_UPDATE_SLOT_COMMENT_MUTATION,
  LMS_UPDATE_STUDENT_LETTERS_MUTATION,
  LMS_UPDATE_STUDENT_WORK_MUTATION,
} from "./lms-graphql-queries";
import {
  assertMatchingLmsClassPayload,
  isAdminSpckExemptClass,
} from "../admin-center/admin-lms-scanner";
import {
  DEFAULT_MINDX_LMS_API_URL,
  isQueueStoppedError,
  lmsHttpClient,
  mindxNodeHttpRequest,
} from "./lms-http-client";
import type {
  SpckBatchUploadResult,
  SpckStudentUploadSummary,
} from "../playwright/spck-uploader";
import type {
  Session14EvalStudentUploadResult,
  UploadSession14EvalSummary,
} from "../playwright/session14-eval-uploader";
import type {
  SaveCommentItemResult,
  SaveCommentsBatchResult,
} from "../playwright/save-comments";

export const DEFAULT_MINDX_RESOURCE_UPLOAD_URL =
  "https://resources.mindx.edu.vn/api/v1/resources";

const CODING_FORCE_ZIP_ATTACHMENT_EXTS = new Set([
  ".html",
  ".htm",
  ".css",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".json",
  ".txt",
  ".ui",
  ".qss",
  ".xml",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".code-workspace",
]);

const ROBOTICS_FORCE_ZIP_ATTACHMENT_EXTS = new Set([
  ".html",
  ".htm",
  ".css",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".json",
  ".txt",
  ".ui",
  ".qss",
  ".xml",
  ".code-workspace",
]);

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".py": "text/x-python",
  ".ipynb": "application/json",
  ".sb3": "application/octet-stream",
  ".yyz": "application/octet-stream",
  ".iqblocks": "application/octet-stream",
  ".goblocks": "application/octet-stream",
  ".vexblocks": "application/octet-stream",
  ".v5blocks": "application/octet-stream",
  ".v5python": "text/x-python",
  ".ino": "text/plain",
  ".c": "text/plain",
  ".cpp": "text/plain",
  ".h": "text/plain",
  ".hpp": "text/plain",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".ppt": "application/vnd.ms-powerpoint",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
};

/**
 * Error indicating a non-recoverable validation, allowlist, CAS drift, max-cap,
 * or Read-after-Write verification failure that MUST NOT silently fall back to Playwright.
 */
export class LmsWriteStrictError extends Error {
  public readonly isStrictWriteError = true;
  constructor(message: string) {
    super(message);
    this.name = "LmsWriteStrictError";
  }
}

export function isRecoverableLmsApiWriteError(err: unknown): boolean {
  if (!err) return true;
  if (isQueueStoppedError(err)) return false;
  if (err instanceof LmsWriteStrictError || (err as any)?.isStrictWriteError === true) {
    return false;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (
    /\[(Read-after-Write|Integrity Guard|Identity Guard|Path Allowlist|CAS|Score Cap|LMS Class Mismatch)\]/i.test(
      msg
    ) ||
    /ALLOWLIST|vượt quá trần tối đa|vượt giới hạn LMS|đã bị chỉnh sửa|không thuộc danh sách/i.test(
      msg
    )
  ) {
    return false;
  }
  return true;
}

/**
 * Checks whether pure-Node LMS Write API is active.
 * Always honors explicit `MINDX_LMS_API_WRITE` (`true`/`false`), disables during
 * legacy Playwright customPage/skipNavigation DOM tests unless `preferApiWrite=true`,
 * and auto-disables in offline test runs unless explicitly enabled.
 */
export function isLmsApiWriteEnabled(options?: {
  forcePlaywright?: boolean;
  customPage?: unknown;
  skipNavigation?: boolean;
  preferApiWrite?: boolean;
}): boolean {
  if (options?.forcePlaywright) return false;
  if ((options?.customPage || options?.skipNavigation) && !options?.preferApiWrite) {
    return false;
  }

  const raw = getDynamicLmsApiWriteEnvValue();
  if (raw !== undefined && String(raw).trim() !== "") {
    const trimmed = String(raw).trim().toLowerCase();
    if (/^(?:false|0|off|no)$/.test(trimmed)) return false;
    if (/^(?:true|1|on|yes)$/.test(trimmed)) return true;
  }

  if (options?.preferApiWrite) {
    return true;
  }

  if (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.MINDX_DB_PATH?.trim()) ||
    Boolean(process.env.MINDX_ROLE_STATE_DIR?.trim())
  ) {
    return false;
  }
  return true;
}

function parseJsonArraySafe<T>(raw?: string | null): T[] {
  if (!raw || typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function resolveResourceEndpoint(explicitEndpoint?: string): string {
  return (
    explicitEndpoint?.trim() ||
    process.env.MINDX_LMS_RESOURCE_UPLOAD_URL?.trim() ||
    DEFAULT_MINDX_RESOURCE_UPLOAD_URL
  );
}

function resolveGraphqlEndpoint(explicitEndpoint?: string): string {
  return (
    explicitEndpoint?.trim() ||
    process.env.MINDX_LMS_API_URL?.trim() ||
    DEFAULT_MINDX_LMS_API_URL
  );
}

function sanitizeMultipartFilename(rawName: string): string {
  return String(rawName || "file.bin")
    .replace(/["\r\n\\/]/g, "_")
    .trim() || "file.bin";
}

function buildMultipartFormBody(params: {
  fieldName: string;
  fileName: string;
  mimeType: string;
  fileBytes: Buffer;
}): { boundary: string; body: Buffer } {
  const boundary = `----MindXBotBoundary${crypto.randomBytes(12).toString("hex")}`;
  const headerPart = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${params.fieldName}"; filename="${sanitizeMultipartFilename(
        params.fileName
      )}"\r\n` +
      `Content-Type: ${params.mimeType}\r\n\r\n`,
    "utf8"
  );
  const footerPart = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return {
    boundary,
    body: Buffer.concat([headerPart, params.fileBytes, footerPart]),
  };
}

/**
 * Uploads a local allowlisted file to `https://resources.mindx.edu.vn/api/v1/resources`
 * via pure-Node `multipart/form-data` (`field="files"`), backed by SQLite SHA-256 URL cache.
 */
export async function uploadFileToMindxResources(
  localFilePath: string,
  options?: {
    uploadEndpoint?: string;
    authTokenOverride?: string;
    bypassCache?: boolean;
    timeoutMs?: number;
  }
): Promise<{ url: string; sha256: string; fileSize: number; fromCache: boolean }> {
  ensureQueueNotStopped();
  const safePath = assertPathAllowed(localFilePath);
  if (!fs.existsSync(safePath)) {
    throw new LmsWriteStrictError(
      `[Path Allowlist] Không tìm thấy tệp trên ổ cứng để tải lên LMS: '${safePath}'`
    );
  }

  const fileBytes = fs.readFileSync(safePath);
  const sha256 = crypto.createHash("sha256").update(fileBytes).digest("hex");
  const fileSize = fileBytes.byteLength;
  const ext = path.extname(safePath).toLowerCase();
  const endpoint = resolveResourceEndpoint(options?.uploadEndpoint);
  const endpointOrigin = new URL(endpoint).origin;

  if (!options?.bypassCache) {
    const cachedUrl = lmsResourceCacheRepo.get(
      sha256,
      fileSize,
      ext,
      `${endpointOrigin}/`
    );
    if (cachedUrl) {
      return { url: cachedUrl, sha256, fileSize, fromCache: true };
    }
  }

  const mimeType = MIME_BY_EXT[ext] || "application/octet-stream";
  const { boundary, body } = buildMultipartFormBody({
    fieldName: "files",
    fileName: path.basename(safePath),
    mimeType,
    fileBytes,
  });

  const executeUpload = async (token: string) =>
    await mindxNodeHttpRequest({
      url: endpoint,
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": String(body.byteLength),
        Accept: "application/json",
        authorization: token,
        Origin: "https://lms.mindx.edu.vn",
        Referer: "https://lms.mindx.edu.vn/",
      },
      body,
      timeoutMs: options?.timeoutMs ?? 60000,
    });

  let token = options?.authTokenOverride?.trim() || "";
  if (!token) {
    token = (await lmsHttpClient.getValidTokenRecord("TEACHER")).idToken;
  }

  let resp = await executeUpload(token);
  if ((resp.status === 401 || resp.status === 403) && !options?.authTokenOverride) {
    const refreshed = await lmsHttpClient.getValidTokenRecord("TEACHER", {
      forceRefresh: true,
    });
    token = refreshed.idToken;
    resp = await executeUpload(token);
  }

  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(
      redactSecrets(
        `Tải tệp '${path.basename(safePath)}' lên MindX Resources thất bại với HTTP ${resp.status}.`,
        [token]
      )
    );
  }

  let parsed: any = null;
  try {
    parsed = JSON.parse(resp.body.toString("utf8"));
  } catch {
    parsed = null;
  }

  const firstArrayItem = Array.isArray(parsed) ? parsed[0] : Array.isArray(parsed?.data) ? parsed.data[0] : null;
  const rawLink = String(
    parsed?.link ||
      parsed?.url ||
      parsed?.fileUrl ||
      parsed?.data?.link ||
      parsed?.data?.url ||
      firstArrayItem?.link ||
      firstArrayItem?.url ||
      ""
  ).trim();

  if (!rawLink) {
    throw new Error(
      `API Resources MindX không trả về link tệp hợp lệ cho '${path.basename(safePath)}'.`
    );
  }

  const finalUrl = /^https?:\/\//i.test(rawLink)
    ? rawLink
    : `${endpointOrigin}${rawLink.startsWith("/") ? rawLink : `/${rawLink}`}`;

  lmsResourceCacheRepo.set(sha256, fileSize, ext, finalUrl);
  return { url: finalUrl, sha256, fileSize, fromCache: false };
}

function normalizeEndpointUrl(url: string): string {
  return String(url || "").trim().replace(/\/+$/, "").toLowerCase();
}

async function runLmsWriteGql<T = any>(params: {
  query: string;
  variables?: Record<string, unknown>;
  operationName: string;
  graphqlEndpoint?: string;
  authTokenOverride?: string;
  timeoutMs?: number;
}): Promise<T> {
  ensureQueueNotStopped();
  const customEndpoint = params.graphqlEndpoint?.trim() || process.env.MINDX_LMS_API_URL?.trim();
  const endpoint = resolveGraphqlEndpoint(customEndpoint);
  const isCustomNonDefaultEndpoint =
    Boolean(customEndpoint) &&
    normalizeEndpointUrl(endpoint) !== normalizeEndpointUrl(DEFAULT_MINDX_LMS_API_URL);

  if (!isCustomNonDefaultEndpoint && !params.authTokenOverride) {
    const res = await lmsHttpClient.gql<T>({
      role: "TEACHER",
      query: params.query,
      variables: params.variables,
      operationName: params.operationName,
      timeoutMs: params.timeoutMs,
    });
    if (Array.isArray(res.errors) && res.errors.length > 0) {
      throw new Error(
        String(res.errors[0]?.message || `GraphQL ${params.operationName} error`)
      );
    }
    if (res.status < 200 || res.status >= 300 || !res.data) {
      throw new Error(
        `GraphQL ${params.operationName} trả về HTTP ${res.status} hoặc thiếu dữ liệu.`
      );
    }
    return res.data;
  }

  const executeDirectGql = async (tokenStr: string) =>
    await mindxNodeHttpRequest({
      url: endpoint,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        authorization: tokenStr,
        "Content-Language": "vi",
      },
      body: JSON.stringify({
        query: params.query,
        ...(params.variables !== undefined ? { variables: params.variables } : {}),
        operationName: params.operationName,
      }),
      timeoutMs: params.timeoutMs ?? 25000,
    });

  let token =
    params.authTokenOverride?.trim() ||
    (await lmsHttpClient.getValidTokenRecord("TEACHER")).idToken;
  let resp = await executeDirectGql(token);
  if ((resp.status === 401 || resp.status === 403) && !params.authTokenOverride) {
    token = (await lmsHttpClient.getValidTokenRecord("TEACHER", { forceRefresh: true })).idToken;
    resp = await executeDirectGql(token);
  }

  let parsed: any = null;
  try {
    parsed = JSON.parse(resp.body.toString("utf8"));
  } catch {
    parsed = null;
  }
  if (Array.isArray(parsed?.errors) && parsed.errors.length > 0) {
    throw new Error(
      redactSecrets(
        String(parsed.errors[0]?.message || `GraphQL ${params.operationName} error`),
        [token]
      )
    );
  }
  if (resp.status < 200 || resp.status >= 300 || !parsed?.data) {
    throw new Error(
      redactSecrets(
        `GraphQL ${params.operationName} trả về HTTP ${resp.status}.`,
        [token]
      )
    );
  }
  return parsed.data as T;
}

async function resolveTargetLmsClassId(params: {
  classId: string;
  lmsClassIdOverride?: string;
  graphqlEndpoint?: string;
  authTokenOverride?: string;
}): Promise<string> {
  if (params.lmsClassIdOverride?.trim()) {
    return params.lmsClassIdOverride.trim();
  }
  const known = resolveKnownLmsClassId(params.classId);
  if (known.lmsClassId) {
    return known.lmsClassId;
  }

  const normalized = params.classId.trim().toUpperCase();
  const searchCandidates = [
    normalized,
    normalized.replace(/^VT-(?:C4K-|ROB-|KIND-)?/i, ""),
  ].filter(Boolean);

  for (const term of searchCandidates) {
    const data = await runLmsWriteGql<any>({
      query: LMS_GET_CLASSES_MINIMAL_QUERY,
      variables: {
        payload: {
          filter_textSearch: term,
          pageIndex: 0,
          itemsPerPage: 20,
        },
      },
      operationName: "LmsGetClassesMinimal",
      graphqlEndpoint: params.graphqlEndpoint,
      authTokenOverride: params.authTokenOverride,
    });
    const list = Array.isArray(data?.classes?.data) ? data.classes.data : [];
    const exact = list.find(
      (c: any) => String(c?.name || "").trim().toUpperCase() === normalized
    );
    if (exact?.id) return String(exact.id);
    const suffixMatch = list.find((c: any) => {
      const cName = String(c?.name || "").trim().toUpperCase();
      return cName && normalized.endsWith(cName);
    });
    if (suffixMatch?.id) return String(suffixMatch.id);
  }

  throw new Error(
    `Không tìm thấy ID lớp MindX LMS cho '${params.classId}'. Vui lòng đồng bộ lớp từ LMS trước.`
  );
}

async function fetchClassWriteContext(params: {
  classId: string;
  lmsClassId: string;
  graphqlEndpoint?: string;
  authTokenOverride?: string;
}): Promise<any> {
  let classDoc: any = null;
  const queries: Array<{ query: string; operationName: string }> = [
    { query: LMS_GET_CLASS_WRITE_CONTEXT_QUERY, operationName: "GetClassWriteContext" },
    { query: LMS_GET_CLASS_BY_ID_SAFE_QUERY, operationName: "GetClassByIdSafe" },
    { query: LMS_GET_CLASS_BY_ID_QUERY, operationName: "GetClassById" },
  ];
  let lastErr: unknown = null;
  for (const q of queries) {
    try {
      const data = await runLmsWriteGql<any>({
        query: q.query,
        variables: { id: params.lmsClassId },
        operationName: q.operationName,
        graphqlEndpoint: params.graphqlEndpoint,
        authTokenOverride: params.authTokenOverride,
      });
      if (data?.classesById) {
        classDoc = data.classesById;
        break;
      }
    } catch (err) {
      lastErr = err;
    }
  }

  if (!classDoc) {
    if (lastErr instanceof Error) throw lastErr;
    throw new Error(
      `Không tải được dữ liệu lớp ${params.classId} (${params.lmsClassId}) từ MindX LMS API.`
    );
  }
  try {
    assertMatchingLmsClassPayload(classDoc, params.classId, params.lmsClassId);
  } catch (err) {
    if (err instanceof LmsWriteStrictError) throw err;
    throw new LmsWriteStrictError(err instanceof Error ? err.message : String(err));
  }
  return classDoc;
}

function findSlotBySessionNumber(classDoc: any, sessionNumber: number): any {
  const slots = Array.isArray(classDoc?.slots) ? classDoc.slots : [];
  // Live MindX LMS uses 0-based `index` (`0` = Session 1, ..., `11` = Session 12, `12` = Session 13, `13` = Session 14).
  const hasZeroBasedIndex = slots.some((s: any) => Number(s?.index) === 0);
  const hasOneBasedSession14 =
    !hasZeroBasedIndex && slots.some((s: any) => Number(s?.index) === 14);
  const targetIndex = hasOneBasedSession14 ? sessionNumber : sessionNumber - 1;
  const byIndex = slots.find(
    (s: any) =>
      s &&
      s.index !== undefined &&
      s.index !== null &&
      Number(s.index) === targetIndex
  );
  if (byIndex?._id) return byIndex;
  const fallback = slots[sessionNumber - 1];
  if (!fallback?._id) {
    throw new Error(
      `Không tìm thấy Buổi #${sessionNumber} trong danh sách slots của lớp trên LMS.`
    );
  }
  return fallback;
}

function resolveLmsStudentIdForRecord(
  localStudentId: string,
  fullName: string,
  classDoc: any,
  slot?: any
): string {
  const cleanLocal = String(localStudentId || "").trim();
  const roster = Array.isArray(classDoc?.students) ? classDoc.students : [];
  const slotAttend = Array.isArray(slot?.studentAttendance) ? slot.studentAttendance : [];

  for (const entry of roster) {
    const sid = String(entry?.student?.id || "").trim();
    if (sid && sid === cleanLocal) return sid;
  }
  for (const att of slotAttend) {
    const sid = String(att?.student?.id || "").trim();
    if (sid && sid === cleanLocal) return sid;
  }

  const targetNorm = normalizeVietnameseName(fullName);
  if (!targetNorm) {
    if (/^[a-f0-9]{24}$/i.test(cleanLocal)) return cleanLocal;
    throw new LmsWriteStrictError(
      `[Identity Guard] Không xác định được ID học viên trên LMS cho '${fullName}' (${cleanLocal}).`
    );
  }

  const candidates = new Map<string, string>();
  for (const entry of roster) {
    const sid = String(entry?.student?.id || "").trim();
    const sName = String(entry?.student?.fullName || "").trim();
    if (sid && normalizeVietnameseName(sName) === targetNorm) {
      candidates.set(sid, sName);
    }
  }
  for (const att of slotAttend) {
    const sid = String(att?.student?.id || "").trim();
    const sName = String(att?.student?.fullName || "").trim();
    if (sid && normalizeVietnameseName(sName) === targetNorm) {
      candidates.set(sid, sName);
    }
  }

  if (candidates.size === 1) {
    return Array.from(candidates.keys())[0];
  }
  if (candidates.size > 1) {
    throw new LmsWriteStrictError(
      `[Identity Guard] Có nhiều học viên trùng tên '${fullName}' trên LMS nên từ chối ghi API tự động.`
    );
  }
  if (/^[a-f0-9]{24}$/i.test(cleanLocal)) {
    return cleanLocal;
  }
  throw new LmsWriteStrictError(
    `[Identity Guard] Học viên '${fullName}' (${cleanLocal}) không có trong danh sách lớp trên LMS.`
  );
}

function resolveSpckStagingDir(): string {
  const envDb = (process.env.MINDX_DB_PATH || "").trim();
  const tmpRootNorm = path.resolve(os.tmpdir()).toLowerCase();
  if (envDb && path.resolve(envDb).toLowerCase().startsWith(tmpRootNorm)) {
    const candidate = path.join(path.dirname(path.resolve(envDb)), "temp_submissions");
    try {
      assertPathAllowed(path.dirname(path.resolve(envDb)));
      return candidate;
    } catch {
      // Fallback to workspace temp_submissions
    }
  }
  return assertPathAllowed(path.resolve(process.cwd(), "temp_submissions"));
}

async function normalizeImageForLmsApi(rawPath: string): Promise<string> {
  const safeImg = assertPathAllowed(rawPath);
  const ext = path.extname(safeImg).toLowerCase();
  const needsWebpConversion = ext === ".webp";
  if (!needsWebpConversion) {
    return safeImg;
  }
  const rawBuf = fs.readFileSync(safeImg);
  const hash12 = crypto.createHash("sha256").update(rawBuf).digest("hex").slice(0, 12);
  const stageDir = resolveSpckStagingDir();
  const stem = path
    .basename(safeImg, ext)
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  const outPngPath = path.join(stageDir, `${stem || "spck_img"}_${hash12}.png`);
  if (!fs.existsSync(outPngPath) || fs.statSync(outPngPath).size <= 32) {
    const [normBuf] = await normalizeImagesToLms16x9([
      { buffer: rawBuf, mimeType: "image/webp", fit: "contain" },
    ]);
    if (normBuf && normBuf.length > 32) {
      fs.mkdirSync(stageDir, { recursive: true });
      const tmpPath = `${outPngPath}.tmp`;
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      fs.writeFileSync(tmpPath, normBuf);
      fs.renameSync(tmpPath, outPngPath);
      return assertPathAllowed(outPngPath);
    }
  } else {
    return assertPathAllowed(outPngPath);
  }
  return safeImg;
}

function prepareAttachmentsForApiUpload(params: {
  classId: string;
  studentId: string;
  attachments: string[];
}): string[] {
  const isRobotics = isRoboticsClassCode(params.classId);
  const forceZipExts = isRobotics
    ? ROBOTICS_FORCE_ZIP_ATTACHMENT_EXTS
    : CODING_FORCE_ZIP_ATTACHMENT_EXTS;

  const directFiles: string[] = [];
  const bundleFiles: string[] = [];
  for (const rawPath of params.attachments) {
    const safePath = assertPathAllowed(rawPath);
    const ext = path.extname(safePath).toLowerCase();
    if (forceZipExts.has(ext)) {
      bundleFiles.push(safePath);
    } else {
      directFiles.push(safePath);
    }
  }

  // If direct + 1 bundle fits or multiple attachments push count > MAX_SPCK_ATTACHMENTS, pack overflow into zip
  const roomForDirect = bundleFiles.length > 0 ? MAX_SPCK_ATTACHMENTS - 1 : MAX_SPCK_ATTACHMENTS;
  if (directFiles.length > roomForDirect) {
    const overflow = directFiles.splice(roomForDirect);
    bundleFiles.push(...overflow);
  }

  const finalFiles = [...directFiles];
  if (bundleFiles.length > 0) {
    const safeSlug = params.studentId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const fp = bundleFiles
      .map((f) => `${path.basename(f)}:${computeSafeFileByteDigest(f) || "missing"}`)
      .sort()
      .join("|");
    const hashShort = crypto.createHash("sha256").update(fp).digest("hex").slice(0, 8);
    const zipPath = path.join(resolveSpckStagingDir(), `spck_${safeSlug}_${hashShort}.zip`);
    const zip = new AdmZip();
    const fixedDate = new Date("2026-01-01T00:00:00.000Z");
    for (const fPath of [...bundleFiles].sort()) {
      zip.addFile(path.basename(fPath), fs.readFileSync(fPath));
      const ze = zip.getEntry(path.basename(fPath));
      if (ze) ze.header.time = fixedDate;
    }
    fs.mkdirSync(path.dirname(zipPath), { recursive: true });
    const nextBuf = zip.toBuffer();
    const prevBuf = fs.existsSync(zipPath) ? fs.readFileSync(zipPath) : null;
    if (!prevBuf || !prevBuf.equals(nextBuf)) {
      fs.writeFileSync(zipPath, nextBuf);
    }
    finalFiles.push(assertPathAllowed(zipPath));
  }

  if (finalFiles.length > MAX_SPCK_ATTACHMENTS) {
    throw new LmsWriteStrictError(
      `[Read-after-Write] Số lượng tài liệu đính kèm vượt giới hạn LMS (${finalFiles.length}/${MAX_SPCK_ATTACHMENTS}).`
    );
  }
  return finalFiles;
}

function validateSpckRecordForApiUpload(
  record: SpckUploadRecord,
  expectedSessionNumber?: SpckSessionSlotNumber
): {
  valid: boolean;
  demoteToWaitingApproval?: boolean;
  reason?: string;
  screenshots: string[];
  attachments: string[];
  youtubeUrls: string[];
  relatedLinks: SpckRelatedLink[];
} {
  const screenshots = parseJsonArraySafe<string>(record.screenshotsJson);
  const attachments = parseJsonArraySafe<string>(record.attachmentsJson);
  const youtubeUrls = parseJsonArraySafe<string>(record.youtubeUrlsJson);
  const relatedLinks = parseJsonArraySafe<SpckRelatedLink>(record.relatedLinksJson);

  if (Number(record.isConfirmedByTeacher) !== 1) {
    return {
      valid: false,
      demoteToWaitingApproval: true,
      reason: "Chưa được giáo viên xác nhận ghép nối studentId (isConfirmedByTeacher !== 1).",
      screenshots,
      attachments,
      youtubeUrls,
      relatedLinks,
    };
  }
  if (record.status !== "APPROVED" && record.status !== "SAVING") {
    return {
      valid: false,
      demoteToWaitingApproval: true,
      reason: `Bản ghi chưa ở trạng thái APPROVED (hiện tại: '${record.status}').`,
      screenshots,
      attachments,
      youtubeUrls,
      relatedLinks,
    };
  }
  if (
    expectedSessionNumber !== undefined &&
    record.approvedSessionNumber !== undefined &&
    record.approvedSessionNumber !== null &&
    Number(record.approvedSessionNumber) !== Number(expectedSessionNumber)
  ) {
    return {
      valid: false,
      demoteToWaitingApproval: true,
      reason: `Bản ghi đang được duyệt cho Buổi ${record.approvedSessionNumber}, không khớp Buổi ${expectedSessionNumber}.`,
      screenshots,
      attachments,
      youtubeUrls,
      relatedLinks,
    };
  }
  if (!verifySpckContentIntegrity(record)) {
    return {
      valid: false,
      demoteToWaitingApproval: true,
      reason: "Phát hiện nội dung SPCK đã bị chỉnh sửa sau khi duyệt (Hash Drift).",
      screenshots,
      attachments,
      youtubeUrls,
      relatedLinks,
    };
  }

  const title = (record.projectTitle || "").trim();
  const titleCheck = validateSpckTitleLength(
    title,
    expectedSessionNumber && record.approvedSessionNumber ? expectedSessionNumber : undefined
  );
  if (!titleCheck.valid) {
    return {
      valid: false,
      demoteToWaitingApproval: true,
      reason: titleCheck.reason || `Tiêu đề dự án phải từ 1..${MAX_SPCK_TITLE_LENGTH} ký tự.`,
      screenshots,
      attachments,
      youtubeUrls,
      relatedLinks,
    };
  }
  if (!(record.teacherComment || "").trim()) {
    return {
      valid: false,
      demoteToWaitingApproval: true,
      reason: "Bình luận của giáo viên* không được để trống.",
      screenshots,
      attachments,
      youtubeUrls,
      relatedLinks,
    };
  }
  if (
    screenshots.length > MAX_SPCK_SCREENSHOTS ||
    attachments.length > MAX_SPCK_ATTACHMENTS ||
    youtubeUrls.length > MAX_SPCK_YOUTUBE_URLS ||
    relatedLinks.length > MAX_SPCK_RELATED_LINKS
  ) {
    return {
      valid: false,
      demoteToWaitingApproval: true,
      reason: "Số lượng tệp/liên kết SPCK vượt quá giới hạn tối đa của MindX LMS (10).",
      screenshots,
      attachments,
      youtubeUrls,
      relatedLinks,
    };
  }
  for (const ytUrl of youtubeUrls) {
    const res = validateSpckYoutubeUrl(String(ytUrl || ""));
    if (!res.valid) {
      return {
        valid: false,
        demoteToWaitingApproval: true,
        reason: res.reason || "Đường dẫn YouTube không hợp lệ.",
        screenshots,
        attachments,
        youtubeUrls,
        relatedLinks,
      };
    }
  }
  for (const rel of relatedLinks) {
    const res = validateSpckRelatedUrl(String(rel?.url || ""));
    if (!res.valid) {
      return {
        valid: false,
        demoteToWaitingApproval: true,
        reason: res.reason || "Đường dẫn liên quan không hợp lệ.",
        screenshots,
        attachments,
        youtubeUrls,
        relatedLinks,
      };
    }
  }

  try {
    if (record.localFolderPath) {
      assertPathAllowed(record.localFolderPath);
    }
    if (record.thumbnailPath) {
      const safeThumb = assertPathAllowed(record.thumbnailPath);
      if (!fs.existsSync(safeThumb)) {
        return {
          valid: false,
          reason: `Không tìm thấy file ảnh Thumbnail trên ổ cứng: '${record.thumbnailPath}'`,
          screenshots,
          attachments,
          youtubeUrls,
          relatedLinks,
        };
      }
      const ext = path.extname(safeThumb).toLowerCase();
      if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
        return {
          valid: false,
          demoteToWaitingApproval: true,
          reason: `Ảnh Thumbnail '${path.basename(safeThumb)}' không thuộc định dạng ảnh hợp lệ.`,
          screenshots,
          attachments,
          youtubeUrls,
          relatedLinks,
        };
      }
      const parsed = parseMediaBuffer(fs.readFileSync(safeThumb), path.basename(safeThumb), ext);
      if (!parsed.success) {
        return {
          valid: false,
          demoteToWaitingApproval: true,
          reason: `Ảnh Thumbnail bị hỏng chữ ký nhị phân: ${parsed.errorReason}`,
          screenshots,
          attachments,
          youtubeUrls,
          relatedLinks,
        };
      }
    }
    for (const imgPath of screenshots) {
      const safeImg = assertPathAllowed(imgPath);
      if (!fs.existsSync(safeImg)) {
        return {
          valid: false,
          reason: `Không tìm thấy ảnh sản phẩm trên ổ cứng: '${imgPath}'`,
          screenshots,
          attachments,
          youtubeUrls,
          relatedLinks,
        };
      }
      const ext = path.extname(safeImg).toLowerCase();
      if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
        return {
          valid: false,
          demoteToWaitingApproval: true,
          reason: `Ảnh sản phẩm '${path.basename(safeImg)}' không thuộc định dạng ảnh hợp lệ.`,
          screenshots,
          attachments,
          youtubeUrls,
          relatedLinks,
        };
      }
      const parsed = parseMediaBuffer(fs.readFileSync(safeImg), path.basename(safeImg), ext);
      if (!parsed.success) {
        return {
          valid: false,
          demoteToWaitingApproval: true,
          reason: `Ảnh sản phẩm '${path.basename(safeImg)}' không hợp lệ: ${parsed.errorReason}`,
          screenshots,
          attachments,
          youtubeUrls,
          relatedLinks,
        };
      }
    }
    for (const attPath of attachments) {
      const check = validateSpckAttachmentFile(attPath);
      if (!check.valid) {
        return {
          valid: false,
          demoteToWaitingApproval: true,
          reason: check.reason || `Tệp đính kèm '${attPath}' không hợp lệ.`,
          screenshots,
          attachments,
          youtubeUrls,
          relatedLinks,
        };
      }
    }
  } catch (secErr) {
    return {
      valid: false,
      reason: secErr instanceof Error ? secErr.message : String(secErr),
      screenshots,
      attachments,
      youtubeUrls,
      relatedLinks,
    };
  }

  return {
    valid: true,
    screenshots,
    attachments,
    youtubeUrls,
    relatedLinks,
  };
}

interface NormalizedLatestData {
  title: string;
  thumbnail: string;
  videoUrls: string[];
  imageUrl: string[];
  attachmentUrls: string[];
  relatedUrls: Array<{ name: string; url: string }>;
  comment: string;
  rejectReason: string;
}

function normalizeLatestDataForCompare(raw: any): NormalizedLatestData {
  const rels = Array.isArray(raw?.relatedUrls)
    ? raw.relatedUrls
    : Array.isArray(raw?.relatedLinks)
    ? raw.relatedLinks
    : [];
  return {
    title: String(raw?.title || "").trim(),
    thumbnail: String(raw?.thumbnail || "").trim(),
    videoUrls: Array.isArray(raw?.videoUrls)
      ? raw.videoUrls.map((u: any) => String(u || "").trim()).filter(Boolean)
      : [],
    imageUrl: Array.isArray(raw?.imageUrl)
      ? raw.imageUrl.map((u: any) => String(u || "").trim()).filter(Boolean)
      : [],
    attachmentUrls: Array.isArray(raw?.attachmentUrls)
      ? raw.attachmentUrls.map((u: any) => String(u || "").trim()).filter(Boolean)
      : [],
    relatedUrls: rels
      .map((r: any) => ({
        name: String(r?.name || "").trim(),
        url: String(r?.url || "").trim(),
      }))
      .filter((r: any) => r.url.length > 0),
    comment: String(raw?.comment || "").trim(),
    rejectReason: String(raw?.rejectReason || "").trim(),
  };
}

function isLatestDataEquivalent(a: NormalizedLatestData, b: NormalizedLatestData): boolean {
  if (a.title !== b.title || a.comment !== b.comment || a.thumbnail !== b.thumbnail) {
    return false;
  }
  if (
    a.videoUrls.length !== b.videoUrls.length ||
    a.imageUrl.length !== b.imageUrl.length ||
    a.attachmentUrls.length !== b.attachmentUrls.length ||
    a.relatedUrls.length !== b.relatedUrls.length
  ) {
    return false;
  }
  for (let i = 0; i < a.videoUrls.length; i++) {
    if (a.videoUrls[i] !== b.videoUrls[i]) return false;
  }
  for (let i = 0; i < a.imageUrl.length; i++) {
    if (a.imageUrl[i] !== b.imageUrl[i]) return false;
  }
  for (let i = 0; i < a.attachmentUrls.length; i++) {
    if (a.attachmentUrls[i] !== b.attachmentUrls[i]) return false;
  }
  for (let i = 0; i < a.relatedUrls.length; i++) {
    const normA = a.relatedUrls[i].url.replace(/\/+$/, "").toLowerCase();
    const normB = b.relatedUrls[i].url.replace(/\/+$/, "").toLowerCase();
    if (a.relatedUrls[i].name !== b.relatedUrls[i].name || normA !== normB) {
      return false;
    }
  }
  return true;
}

function resolveSessionRecordForApiUpload(
  classId: string,
  baseRecord: SpckUploadRecord,
  sessionNumber?: SpckSessionSlotNumber
): SpckUploadRecord {
  if (sessionNumber && isValidSpckSessionSlot(sessionNumber)) {
    const sessRow = spckSessionRepo.findOne(classId, baseRecord.studentId, sessionNumber);
    if (sessRow) {
      const isSessApproved =
        sessRow.draftStatus === "APPROVED" && Boolean(sessRow.approvedContentHash);
      const isLegacyDirectApprove =
        !isSessApproved &&
        baseRecord.status === "APPROVED" &&
        Boolean(baseRecord.contentHash) &&
        !baseRecord.approvedSessionNumber;

      if (isSessApproved) {
        return {
          ...baseRecord,
          localFolderPath: sessRow.localFolderPath ?? baseRecord.localFolderPath,
          isConfirmedByTeacher:
            sessRow.isConfirmedByTeacher ?? baseRecord.isConfirmedByTeacher,
          projectTitle: sessRow.projectTitle || baseRecord.projectTitle,
          baseProjectTitle: stripSpckSessionSuffix(
            sessRow.projectTitle || baseRecord.projectTitle
          ),
          thumbnailPath: sessRow.thumbnailPath ?? baseRecord.thumbnailPath,
          screenshotsJson: sessRow.screenshotsJson || baseRecord.screenshotsJson,
          attachmentsJson: sessRow.attachmentsJson || baseRecord.attachmentsJson,
          youtubeUrlsJson: sessRow.youtubeUrlsJson || baseRecord.youtubeUrlsJson,
          relatedLinksJson: sessRow.relatedLinksJson || baseRecord.relatedLinksJson,
          teacherComment: sessRow.teacherComment ?? baseRecord.teacherComment,
          status: "APPROVED",
          contentHash: sessRow.approvedContentHash,
          approvedSessionNumber: sessionNumber,
        };
      }
      if (!isLegacyDirectApprove) {
        return {
          ...baseRecord,
          localFolderPath: sessRow.localFolderPath ?? baseRecord.localFolderPath,
          isConfirmedByTeacher:
            sessRow.isConfirmedByTeacher ?? baseRecord.isConfirmedByTeacher,
          projectTitle: sessRow.projectTitle || baseRecord.projectTitle,
          baseProjectTitle: stripSpckSessionSuffix(
            sessRow.projectTitle || baseRecord.projectTitle
          ),
          thumbnailPath: sessRow.thumbnailPath ?? baseRecord.thumbnailPath,
          screenshotsJson: sessRow.screenshotsJson || baseRecord.screenshotsJson,
          attachmentsJson: sessRow.attachmentsJson || baseRecord.attachmentsJson,
          youtubeUrlsJson: sessRow.youtubeUrlsJson || baseRecord.youtubeUrlsJson,
          relatedLinksJson: sessRow.relatedLinksJson || baseRecord.relatedLinksJson,
          teacherComment: sessRow.teacherComment ?? baseRecord.teacherComment,
          status: sessRow.draftStatus,
          contentHash: "",
          approvedSessionNumber: null,
        };
      }
    }
  }
  return baseRecord;
}

function resolveCurrentVerifiedRecord(
  classId: string,
  studentId: string,
  expectedHash: string,
  sessionNumber: SpckSessionSlotNumber
): boolean {
  const sess = spckSessionRepo.findOne(classId, studentId, sessionNumber);
  if (
    sess &&
    sess.draftStatus !== "DRAFT" &&
    sess.draftStatus !== "WAITING_APPROVAL" &&
    Boolean(sess.approvedContentHash) &&
    sess.approvedContentHash === expectedHash &&
    verifySpckSessionIntegrity(sess, sessionNumber)
  ) {
    return true;
  }
  const rec = spckUploadRepo.findOne(classId, studentId);
  if (
    rec &&
    (rec.status === "APPROVED" || rec.status === "SAVING") &&
    rec.contentHash === expectedHash &&
    verifySpckContentIntegrity(rec) &&
    (!rec.approvedSessionNumber || rec.approvedSessionNumber === sessionNumber)
  ) {
    return true;
  }
  return false;
}

function demoteApiRecordToWaitingApproval(
  normalizedClassId: string,
  studentId: string,
  resolvedSessionNumber: number | undefined,
  errorMessage: string
): void {
  const db = getDb();
  if (resolvedSessionNumber && isValidSpckSessionSlot(resolvedSessionNumber)) {
    try {
      db.prepare(
        `UPDATE spck_session_submissions
         SET draftStatus = 'WAITING_APPROVAL',
             approvedContentHash = '',
             lastErrorMessage = ?,
             updatedAt = datetime('now', 'localtime')
         WHERE classId = ? AND studentId = ? AND sessionNumber = ?`
      ).run(errorMessage, normalizedClassId, studentId, resolvedSessionNumber);
    } catch {}
  }
  const freshUpload = spckUploadRepo.findOne(normalizedClassId, studentId);
  if (
    freshUpload &&
    (!resolvedSessionNumber ||
      !freshUpload.approvedSessionNumber ||
      freshUpload.approvedSessionNumber === resolvedSessionNumber)
  ) {
    spckUploadRepo.upsert({
      ...freshUpload,
      status: "WAITING_APPROVAL",
      contentHash: "",
      errorMessage,
    });
  }
}

/**
 * Uploads approved SPCK items for Sessions 12, 13, or 14 via pure-Node GraphQL + `/api/v1/resources`
 * with exact Item 01 overwrite semantics, Item 02+ duplicate cleanup, and Read-after-Write verification.
 */
export async function upsertClassSpckViaApi(options: {
  classId: string;
  sessionNumber?: number;
  studentIds?: string[];
  lmsClassIdOverride?: string;
  graphqlEndpoint?: string;
  uploadEndpoint?: string;
  authTokenOverride?: string;
}): Promise<SpckBatchUploadResult> {
  const normalizedClassId = String(options.classId || "").trim().toUpperCase();
  const targetSessionNumber: SpckSessionSlotNumber = isValidSpckSessionSlot(
    options.sessionNumber
  )
    ? (Number(options.sessionNumber) as SpckSessionSlotNumber)
    : 14;
  assertClassHasSpckSession(normalizedClassId, targetSessionNumber, "upsertClassSpckViaApi");

  const allClassRecords = spckUploadRepo.findByClass(normalizedClassId);
  const effectiveRecords = allClassRecords.map((rec) =>
    resolveSessionRecordForApiUpload(normalizedClassId, rec, targetSessionNumber)
  );
  const studentsInClass = studentRepo.findByClass(normalizedClassId, false);
  const studentNameMap = new Map(studentsInClass.map((s) => [s.studentId, s.fullName]));

  const requestedSet =
    Array.isArray(options.studentIds) && options.studentIds.length > 0
      ? new Set(options.studentIds.map((id) => String(id).trim()).filter(Boolean))
      : null;

  const targetRecords = effectiveRecords.filter((rec) =>
    requestedSet ? requestedSet.has(rec.studentId) : rec.status === "APPROVED"
  );

  const results: SpckStudentUploadSummary[] = [];
  let verifiedCount = 0;
  let failedCount = 0;
  let demotedCount = 0;

  if (requestedSet) {
    const existingIds = new Set(targetRecords.map((r) => r.studentId));
    for (const reqSid of requestedSet) {
      if (!existingIds.has(reqSid)) {
        demotedCount++;
        results.push({
          studentId: reqSid,
          fullName: studentNameMap.get(reqSid) || reqSid,
          status: "WAITING_APPROVAL",
          reusedExistingItem01: false,
          clickedAddSpckButton: false,
          youtubeAddedCount: 0,
          relatedLinksAddedCount: 0,
          screenshotsUploadedCount: 0,
          attachmentsUploadedCount: 0,
          errorMessage: "Chưa có bản ghi SPCK đã duyệt cho học viên này.",
        });
      }
    }
  }

  const totalRequestedCount = requestedSet ? requestedSet.size : targetRecords.length;
  if (targetRecords.length === 0) {
    return {
      classId: normalizedClassId,
      sessionNumber: targetSessionNumber,
      totalRequested: totalRequestedCount,
      verifiedCount,
      failedCount,
      demotedCount,
      results,
    };
  }

  const folderUsageCount = new Map<string, number>();
  for (const r of effectiveRecords) {
    const normFolder = normalizeSpckFolderKey(r.localFolderPath);
    if (normFolder) {
      folderUsageCount.set(normFolder, (folderUsageCount.get(normFolder) || 0) + 1);
    }
  }

  const validQueue: Array<{
    record: SpckUploadRecord;
    expectedHash: string;
    screenshots: string[];
    attachments: string[];
    youtubeUrls: string[];
    relatedLinks: SpckRelatedLink[];
  }> = [];

  for (const rec of targetRecords) {
    const fullName = studentNameMap.get(rec.studentId) || rec.studentId;
    const normFolder = normalizeSpckFolderKey(rec.localFolderPath);

    if (normFolder && (folderUsageCount.get(normFolder) || 0) > 1) {
      demoteApiRecordToWaitingApproval(
        normalizedClassId,
        rec.studentId,
        targetSessionNumber,
        `Thư mục '${rec.localFolderPath}' đang bị gán trùng cho nhiều học viên trong lớp.`
      );
      demotedCount++;
      results.push({
        studentId: rec.studentId,
        fullName,
        status: "WAITING_APPROVAL",
        reusedExistingItem01: false,
        clickedAddSpckButton: false,
        youtubeAddedCount: 0,
        relatedLinksAddedCount: 0,
        screenshotsUploadedCount: 0,
        attachmentsUploadedCount: 0,
        errorMessage: `Thư mục '${rec.localFolderPath}' đang bị gán trùng cho nhiều học viên.`,
      });
      continue;
    }

    if (targetSessionNumber === 12 || targetSessionNumber === 13) {
      const attStatus =
        spckSessionRepo.getStudentSessionAttendanceMap(normalizedClassId, rec.studentId)[
          String(targetSessionNumber) as "12" | "13"
        ];
      if (attStatus === "ABSENT") {
        spckSessionRepo.clearAbsentStudentSessionFailure(
          normalizedClassId,
          rec.studentId,
          targetSessionNumber
        );
        demotedCount++;
        results.push({
          studentId: rec.studentId,
          fullName,
          status: "WAITING_APPROVAL",
          reusedExistingItem01: false,
          clickedAddSpckButton: false,
          youtubeAddedCount: 0,
          relatedLinksAddedCount: 0,
          screenshotsUploadedCount: 0,
          attachmentsUploadedCount: 0,
          errorMessage: `Học viên '${fullName}' vắng mặt tại Buổi ${targetSessionNumber} trên LMS — đã bỏ qua.`,
        });
        continue;
      }
    }

    const check = validateSpckRecordForApiUpload(rec, targetSessionNumber);
    if (!check.valid) {
      if (check.demoteToWaitingApproval) {
        demoteApiRecordToWaitingApproval(
          normalizedClassId,
          rec.studentId,
          targetSessionNumber,
          check.reason || "Cần giáo viên duyệt lại trước khi upload."
        );
        demotedCount++;
        results.push({
          studentId: rec.studentId,
          fullName,
          status: "WAITING_APPROVAL",
          reusedExistingItem01: false,
          clickedAddSpckButton: false,
          youtubeAddedCount: 0,
          relatedLinksAddedCount: 0,
          screenshotsUploadedCount: 0,
          attachmentsUploadedCount: 0,
          errorMessage: check.reason,
        });
      } else {
        failedCount++;
        results.push({
          studentId: rec.studentId,
          fullName,
          status: "FAILED",
          reusedExistingItem01: false,
          clickedAddSpckButton: false,
          youtubeAddedCount: 0,
          relatedLinksAddedCount: 0,
          screenshotsUploadedCount: 0,
          attachmentsUploadedCount: 0,
          errorMessage: check.reason,
        });
      }
      continue;
    }

    validQueue.push({
      record: rec,
      expectedHash: rec.contentHash || computeSpckContentHash(rec),
      screenshots: check.screenshots,
      attachments: check.attachments,
      youtubeUrls: check.youtubeUrls,
      relatedLinks: check.relatedLinks,
    });
  }

  if (validQueue.length === 0) {
    return {
      classId: normalizedClassId,
      sessionNumber: targetSessionNumber,
      totalRequested: totalRequestedCount,
      verifiedCount,
      failedCount,
      demotedCount,
      results,
    };
  }

  // Resolve remote LMS class & slot context (transport errors here fall back safely to Playwright)
  const lmsClassId = await resolveTargetLmsClassId({
    classId: normalizedClassId,
    lmsClassIdOverride: options.lmsClassIdOverride,
    graphqlEndpoint: options.graphqlEndpoint,
    authTokenOverride: options.authTokenOverride,
  });
  const classDoc = await fetchClassWriteContext({
    classId: normalizedClassId,
    lmsClassId,
    graphqlEndpoint: options.graphqlEndpoint,
    authTokenOverride: options.authTokenOverride,
  });
  const slot = findSlotBySessionNumber(classDoc, targetSessionNumber);
  const slotId = String(slot._id);

  const initialWorksData = await runLmsWriteGql<any>({
    query: LMS_FIND_ALL_STUDENT_WORKS_FULL_QUERY,
    variables: { classId: lmsClassId },
    operationName: "FindAllStudentWorks",
    graphqlEndpoint: options.graphqlEndpoint,
    authTokenOverride: options.authTokenOverride,
  });
  let allWorks: any[] = Array.isArray(initialWorksData?.findAllStudentWorks?.data)
    ? initialWorksData.findAllStudentWorks.data
    : [];
  let anyMutationDispatched = false;

  const defaultThumbPath = path.resolve(
    process.cwd(),
    "data",
    "config",
    "default-spck-thumbnail.png"
  );

  for (const item of validQueue) {
    ensureQueueNotStopped();
    const { record, expectedHash, screenshots, attachments, youtubeUrls, relatedLinks } = item;
    const fullName = studentNameMap.get(record.studentId) || record.studentId;

    if (
      !resolveCurrentVerifiedRecord(
        normalizedClassId,
        record.studentId,
        expectedHash,
        targetSessionNumber
      )
    ) {
      demoteApiRecordToWaitingApproval(
        normalizedClassId,
        record.studentId,
        targetSessionNumber,
        "Nội dung SPCK đã thay đổi trước khi upload. Cần duyệt lại."
      );
      demotedCount++;
      results.push({
        studentId: record.studentId,
        fullName,
        status: "WAITING_APPROVAL",
        reusedExistingItem01: false,
        clickedAddSpckButton: false,
        youtubeAddedCount: 0,
        relatedLinksAddedCount: 0,
        screenshotsUploadedCount: 0,
        attachmentsUploadedCount: 0,
        errorMessage: "Nội dung SPCK đã thay đổi trước khi upload.",
      });
      continue;
    }

    let reusedExistingItem01 = false;
    let clickedAddSpckButton = false;
    let screenshotsUploadedCount = 0;
    let attachmentsUploadedCount = 0;

    try {
      const lmsStudentId = resolveLmsStudentIdForRecord(
        record.studentId,
        fullName,
        classDoc,
        slot
      );

      // Prepare & upload Thumbnail*
      const rawThumbPath =
        record.thumbnailPath ||
        (screenshots.length > 0 ? screenshots[0] : "") ||
        (fs.existsSync(defaultThumbPath) ? defaultThumbPath : "");
      if (!rawThumbPath) {
        throw new LmsWriteStrictError(
          `[Path Allowlist] Thiếu ảnh Thumbnail mặc định cho học viên '${fullName}'.`
        );
      }
      const normThumbPath = await normalizeImageForLmsApi(rawThumbPath);
      const thumbRes = await uploadFileToMindxResources(normThumbPath, {
        uploadEndpoint: options.uploadEndpoint,
        authTokenOverride: options.authTokenOverride,
      });

      // Prepare & upload Screenshots (0..10; 0 photos is valid for Robotics!)
      const screenshotUrls: string[] = [];
      for (const rawShot of screenshots) {
        const normShot = await normalizeImageForLmsApi(rawShot);
        const up = await uploadFileToMindxResources(normShot, {
          uploadEndpoint: options.uploadEndpoint,
          authTokenOverride: options.authTokenOverride,
        });
        screenshotUrls.push(up.url);
        screenshotsUploadedCount++;
      }

      // Prepare & upload Attachments (0..10)
      const preparedAttachments = prepareAttachmentsForApiUpload({
        classId: normalizedClassId,
        studentId: record.studentId,
        attachments,
      });
      const attachmentUrls: string[] = [];
      for (const attPath of preparedAttachments) {
        const up = await uploadFileToMindxResources(attPath, {
          uploadEndpoint: options.uploadEndpoint,
          authTokenOverride: options.authTokenOverride,
        });
        attachmentUrls.push(up.url);
        attachmentsUploadedCount++;
      }

      const expectedTitle = (record.projectTitle || "").trim().slice(0, MAX_SPCK_TITLE_LENGTH);
      const expectedComment = (record.teacherComment || "").trim();
      const latestData = {
        title: expectedTitle,
        thumbnail: thumbRes.url,
        videoUrls: [...youtubeUrls],
        imageUrl: screenshotUrls,
        attachmentUrls,
        relatedUrls: relatedLinks.map((r) => ({ name: r.name, url: r.url })),
        comment: expectedComment,
        rejectReason: "",
      };
      const expectedNorm = normalizeLatestDataForCompare(latestData);

      // Re-check CAS hash immediately before LMS mutation
      if (
        !resolveCurrentVerifiedRecord(
          normalizedClassId,
          record.studentId,
          expectedHash,
          targetSessionNumber
        )
      ) {
        throw new LmsWriteStrictError(
          `[Integrity Guard] Bản ghi SPCK của '${fullName}' đã bị chỉnh sửa ngay trước khi ghi API.`
        );
      }

      const activeForStudentSession = allWorks
        .filter(
          (w: any) =>
            String(w?.studentId || "").trim() === lmsStudentId &&
            String(w?.classSessionId || "").trim() === slotId &&
            !w?.isDeleted &&
            String(w?.status || "").toUpperCase() !== "DELETED"
        )
        .sort((a: any, b: any) => Number(a?.displayOrder ?? 0) - Number(b?.displayOrder ?? 0));

      const primaryWork = activeForStudentSession[0];
      const duplicateWorks = activeForStudentSession.slice(1);
      const alreadyMatchesSingleWork =
        Boolean(primaryWork) &&
        duplicateWorks.length === 0 &&
        isLatestDataEquivalent(normalizeLatestDataForCompare(primaryWork?.latestData), expectedNorm);

      if (alreadyMatchesSingleWork) {
        reusedExistingItem01 = true;
        clickedAddSpckButton = false;
      } else if (primaryWork?.id) {
        reusedExistingItem01 = true;
        clickedAddSpckButton = false;
        await runLmsWriteGql<any>({
          query: LMS_UPDATE_STUDENT_WORK_MUTATION,
          variables: {
            payload: {
              id: String(primaryWork.id),
              payload: {
                classId: lmsClassId,
                classSessionId: slotId,
                studentId: lmsStudentId,
                displayOrder: 0,
                latestData,
              },
            },
          },
          operationName: "UpdateStudentWork",
          graphqlEndpoint: options.graphqlEndpoint,
          authTokenOverride: options.authTokenOverride,
        });
        anyMutationDispatched = true;
        for (const dup of duplicateWorks) {
          if (dup?.id) {
            await runLmsWriteGql<any>({
              query: LMS_DELETE_STUDENT_WORK_MUTATION,
              variables: { payload: { id: String(dup.id) } },
              operationName: "DeleteStudentWork",
              graphqlEndpoint: options.graphqlEndpoint,
              authTokenOverride: options.authTokenOverride,
            });
          }
        }
      } else {
        reusedExistingItem01 = false;
        clickedAddSpckButton = true;
        await runLmsWriteGql<any>({
          query: LMS_CREATE_STUDENT_WORK_MUTATION,
          variables: {
            payload: {
              classId: lmsClassId,
              classSessionId: slotId,
              classSessionNumber: targetSessionNumber,
              studentId: lmsStudentId,
              displayOrder: 0,
              latestData,
            },
          },
          operationName: "CreateStudentWork",
          graphqlEndpoint: options.graphqlEndpoint,
          authTokenOverride: options.authTokenOverride,
        });
        anyMutationDispatched = true;
      }

      // Mandatory Read-after-Write GraphQL Verification
      const verifyData = await runLmsWriteGql<any>({
        query: LMS_FIND_ALL_STUDENT_WORKS_FULL_QUERY,
        variables: { classId: lmsClassId },
        operationName: "FindAllStudentWorks",
        graphqlEndpoint: options.graphqlEndpoint,
        authTokenOverride: options.authTokenOverride,
      });
      allWorks = Array.isArray(verifyData?.findAllStudentWorks?.data)
        ? verifyData.findAllStudentWorks.data
        : [];
      const verifiedWorks = allWorks.filter(
        (w: any) =>
          String(w?.studentId || "").trim() === lmsStudentId &&
          String(w?.classSessionId || "").trim() === slotId &&
          !w?.isDeleted &&
          String(w?.status || "").toUpperCase() !== "DELETED"
      );

      if (verifiedWorks.length !== 1) {
        throw new LmsWriteStrictError(
          `[Read-after-Write] Mong đợi đúng 1 bản ghi SPCK trên Buổi ${targetSessionNumber} cho '${fullName}', thực tế trên LMS có ${verifiedWorks.length}.`
        );
      }
      const actualNorm = normalizeLatestDataForCompare(verifiedWorks[0]?.latestData);
      if (!isLatestDataEquivalent(actualNorm, expectedNorm)) {
        throw new LmsWriteStrictError(
          `[Read-after-Write] Dữ liệu SPCK đọc lại từ API LMS của '${fullName}' không khớp 100% với bản đã duyệt.`
        );
      }

      const markRes = spckUploadRepo.markVerified(
        normalizedClassId,
        record.studentId,
        expectedHash,
        targetSessionNumber,
        String(verifiedWorks[0]?.id || "")
      );
      if (markRes.changes === 0) {
        throw new LmsWriteStrictError(
          `[Integrity Guard] Bản ghi SPCK của '${record.studentId}' đã bị chỉnh sửa trong lúc ghi API nên không đánh dấu VERIFIED.`
        );
      }

      jobLogRepo.add({
        jobId: `SPCK_${normalizedClassId}`,
        jobType: "UPLOAD_SPCK",
        classId: normalizedClassId,
        sessionId: `SESSION_${targetSessionNumber}`,
        studentId: record.studentId,
        level: "SUCCESS",
        message: `[LMS API Write] Đã ghi & đối chiếu Read-after-Write VERIFIED SPCK (Buổi ${targetSessionNumber}) cho ${fullName}.`,
      });

      verifiedCount++;
      results.push({
        studentId: record.studentId,
        fullName,
        status: "VERIFIED",
        reusedExistingItem01,
        clickedAddSpckButton,
        youtubeAddedCount: youtubeUrls.length,
        relatedLinksAddedCount: relatedLinks.length,
        screenshotsUploadedCount,
        attachmentsUploadedCount,
      });
    } catch (err) {
      if (!anyMutationDispatched && verifiedCount === 0 && isRecoverableLmsApiWriteError(err)) {
        throw err;
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      spckUploadRepo.recordSessionFailure(
        normalizedClassId,
        record.studentId,
        targetSessionNumber,
        expectedHash,
        errMsg
      );
      failedCount++;
      results.push({
        studentId: record.studentId,
        fullName,
        status: "FAILED",
        reusedExistingItem01,
        clickedAddSpckButton,
        youtubeAddedCount: 0,
        relatedLinksAddedCount: 0,
        screenshotsUploadedCount,
        attachmentsUploadedCount,
        errorMessage: errMsg,
      });
    }
  }

  return {
    classId: normalizedClassId,
    sessionNumber: targetSessionNumber,
    totalRequested: totalRequestedCount,
    verifiedCount,
    failedCount,
    demotedCount,
    results,
  };
}

/**
 * Deletes active `StudentWork` entries strictly for the target session (`12|13|14`)
 * via `DeleteStudentWork`, verifies `0` remaining works via Read-after-Write GraphQL,
 * and clears SQLite session history while leaving other sessions untouched.
 */
export async function clearSessionSpckViaApi(options: {
  classId: string;
  sessionNumber: number;
  studentIds?: string[];
  lmsClassIdOverride?: string;
  graphqlEndpoint?: string;
  authTokenOverride?: string;
}): Promise<{
  classId: string;
  sessionNumber: SpckSessionSlotNumber;
  deletedCount: number;
  clearedLocalRows: number;
}> {
  const normalizedClassId = String(options.classId || "").trim().toUpperCase();
  if (!isValidSpckSessionSlot(options.sessionNumber)) {
    throw new LmsWriteStrictError(
      `Buổi '${options.sessionNumber}' không phải buổi nộp SPCK hợp lệ (12, 13, 14).`
    );
  }
  const targetSessionNumber = Number(options.sessionNumber) as SpckSessionSlotNumber;
  const requestedStudentIds = Array.isArray(options.studentIds)
    ? options.studentIds.map((id) => String(id).trim()).filter(Boolean)
    : [];

  const lmsClassId = await resolveTargetLmsClassId({
    classId: normalizedClassId,
    lmsClassIdOverride: options.lmsClassIdOverride,
    graphqlEndpoint: options.graphqlEndpoint,
    authTokenOverride: options.authTokenOverride,
  });
  const classDoc = await fetchClassWriteContext({
    classId: normalizedClassId,
    lmsClassId,
    graphqlEndpoint: options.graphqlEndpoint,
    authTokenOverride: options.authTokenOverride,
  });
  const slot = findSlotBySessionNumber(classDoc, targetSessionNumber);
  const slotId = String(slot._id);

  const roster = studentRepo.findByClass(normalizedClassId, false);
  const rosterMap = new Map(roster.map((s) => [s.studentId, s.fullName]));
  const targetLmsStudentSet =
    requestedStudentIds.length > 0
      ? new Set(
          requestedStudentIds.map((sid) =>
            resolveLmsStudentIdForRecord(sid, rosterMap.get(sid) || sid, classDoc, slot)
          )
        )
      : null;

  const worksData = await runLmsWriteGql<any>({
    query: LMS_FIND_ALL_STUDENT_WORKS_FULL_QUERY,
    variables: { classId: lmsClassId },
    operationName: "FindAllStudentWorks",
    graphqlEndpoint: options.graphqlEndpoint,
    authTokenOverride: options.authTokenOverride,
  });
  const allWorks: any[] = Array.isArray(worksData?.findAllStudentWorks?.data)
    ? worksData.findAllStudentWorks.data
    : [];

  const toDelete = allWorks.filter((w: any) => {
    if (String(w?.classSessionId || "").trim() !== slotId) return false;
    if (w?.isDeleted || String(w?.status || "").toUpperCase() === "DELETED") return false;
    if (targetLmsStudentSet && !targetLmsStudentSet.has(String(w?.studentId || "").trim())) {
      return false;
    }
    return Boolean(w?.id);
  });

  for (const w of toDelete) {
    await runLmsWriteGql<any>({
      query: LMS_DELETE_STUDENT_WORK_MUTATION,
      variables: { payload: { id: String(w.id) } },
      operationName: "DeleteStudentWork",
      graphqlEndpoint: options.graphqlEndpoint,
      authTokenOverride: options.authTokenOverride,
    });
  }

  // Read-after-Write GraphQL check: 0 active works remaining on slotId for target scope
  const verifyData = await runLmsWriteGql<any>({
    query: LMS_FIND_ALL_STUDENT_WORKS_FULL_QUERY,
    variables: { classId: lmsClassId },
    operationName: "FindAllStudentWorks",
    graphqlEndpoint: options.graphqlEndpoint,
    authTokenOverride: options.authTokenOverride,
  });
  const remaining = (verifyData?.findAllStudentWorks?.data || []).filter((w: any) => {
    if (String(w?.classSessionId || "").trim() !== slotId) return false;
    if (w?.isDeleted || String(w?.status || "").toUpperCase() === "DELETED") return false;
    if (targetLmsStudentSet && !targetLmsStudentSet.has(String(w?.studentId || "").trim())) {
      return false;
    }
    return true;
  });

  if (remaining.length > 0) {
    throw new LmsWriteStrictError(
      `[Read-after-Write] Vẫn còn ${remaining.length} bản ghi SPCK trên Buổi ${targetSessionNumber} sau khi xóa.`
    );
  }

  const localRows = spckUploadRepo.findByClass(normalizedClassId);
  const targetStudentSet =
    requestedStudentIds.length > 0 ? new Set(requestedStudentIds) : null;
  let clearedLocalRows = 0;
  for (const r of localRows) {
    if (targetStudentSet && !targetStudentSet.has(r.studentId)) {
      continue;
    }
    spckSessionRepo.clearSessionSubmissionHistory(
      normalizedClassId,
      r.studentId,
      targetSessionNumber
    );
    clearedLocalRows++;
  }
  if (requestedStudentIds.length > 0) {
    const localIdSet = new Set(localRows.map((r) => r.studentId));
    for (const reqSid of requestedStudentIds) {
      if (!localIdSet.has(reqSid)) {
        spckSessionRepo.clearSessionSubmissionHistory(
          normalizedClassId,
          reqSid,
          targetSessionNumber
        );
        clearedLocalRows++;
      }
    }
  }

  return {
    classId: normalizedClassId,
    sessionNumber: targetSessionNumber,
    deletedCount: toDelete.length,
    clearedLocalRows,
  };
}

function normalizePlainTextForEval(raw: string): string {
  return String(raw || "")
    .replace(/<\/(p|div|li|h[1-6]|br)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtmlText(raw: string): string {
  return String(raw || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function markdownToSimpleLetterHtml(rawText: string): string {
  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";
  return lines
    .map((line) => {
      const escaped = escapeHtmlText(line).replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
      return `<p>${escaped}</p>`;
    })
    .join("");
}

function mapDemoDetailTitleToKey(
  title: string,
  fallbackIdx: number,
  isRobotics: boolean = false,
  isLego: boolean = false
): keyof SpckSession14DemoScores {
  const norm = normalizeVietnameseName(title);
  if (norm.includes("thuat toan") || norm.includes("tu duy may tinh")) return "algorithm";
  if (norm.includes("sang tao")) return "creativity";
  if (norm.includes("giao tiep") || norm.includes("hop tac") || norm.includes("thuyet trinh")) {
    return "communication";
  }
  if (norm.includes("giai quyet van de")) return "problemSolving";
  if (
    norm.includes("su dung may tinh") ||
    norm.includes("ky nang may tinh") ||
    norm.includes("cong nghe")
  ) {
    return "computerSkills";
  }
  const order: Array<keyof SpckSession14DemoScores> =
    isRobotics && !isLego
      ? ["algorithm", "creativity", "communication", "computerSkills", "problemSolving"]
      : ["algorithm", "creativity", "communication", "problemSolving", "computerSkills"];
  return order[fallbackIdx % order.length];
}

function matchCompetencyKeyForArea(
  areaId: string,
  areaName: string
): keyof CompetencyScores | null {
  const cleanId = String(areaId || "").trim().toLowerCase();
  if (cleanId) {
    const legoMatch = LEGO_COMPETENCY_AREA_SPECS.find((s) => s.commentAreaId === cleanId);
    if (legoMatch) {
      return legoMatch.key;
    }
  }
  for (const spec of COMPETENCY_AREA_SPECS) {
    if (matchesCompetencyAreaIdPure(spec, areaId)) {
      return spec.key;
    }
  }
  const norm = normalizeVietnameseName(areaName);
  if (norm) {
    for (const spec of COMPETENCY_AREA_SPECS) {
      if (spec.keywordsNorm.some((kw) => norm.includes(kw))) {
        return spec.key;
      }
    }
    // Check additional Robotics/LEGO phrasing
    if (
      norm.includes("cong cu") ||
      norm.includes("cong nghe") ||
      norm.includes("lap trinh robot") ||
      norm.includes("may tinh")
    ) {
      return "skillComputerUse";
    }
  }
  return null;
}

function renderStudentLetterHtml(params: {
  sourceContent?: string | null;
  existingMacros?: Array<{ key?: string; value?: string }>;
  learnedFromMindx: string;
  suggestionsFromMindx: string;
  futureDirection: string;
  fullName: string;
  className: string;
}): {
  html: string;
  sourceContent: string;
  macros: Array<{ key: string; value: string }>;
} {
  const learnedHtml = markdownToSimpleLetterHtml(params.learnedFromMindx);
  const suggestionsHtml = markdownToSimpleLetterHtml(params.suggestionsFromMindx);
  const futureHtml = markdownToSimpleLetterHtml(params.futureDirection);

  const rawSource = String(params.sourceContent || "").trim();
  const macroMap = new Map<string, string>();
  for (const m of params.existingMacros || []) {
    const k = String(m?.key || "").trim();
    if (k) macroMap.set(k, String(m?.value || ""));
  }
  macroMap.set("@learnedFromMindx", learnedHtml);
  macroMap.set("@suggestionsFromMindx", suggestionsHtml);
  macroMap.set("@futureDirection", futureHtml);
  if (!macroMap.has("@studentName") && params.fullName) {
    macroMap.set("@studentName", escapeHtmlText(params.fullName));
  }
  if (!macroMap.has("@className") && params.className) {
    macroMap.set("@className", escapeHtmlText(params.className));
  }
  const macros = Array.from(macroMap.entries()).map(([key, value]) => ({ key, value }));

  if (!rawSource) {
    return {
      sourceContent: rawSource,
      macros,
      html: `<div><h3>Learned From Mindx</h3>${learnedHtml}<h3>Suggestions From Mindx</h3>${suggestionsHtml}<h3>Future Direction</h3>${futureHtml}</div>`,
    };
  }

  const safeStudentName = escapeHtmlText(params.fullName);
  const safeClassName = escapeHtmlText(params.className);
  let rendered = rawSource
    .replace(
      /@learnedFromMindx\b|\{\{\s*learned_from_mindx\s*\}\}|\{\s*learned_from_mindx\s*\}/gi,
      () => learnedHtml
    )
    .replace(
      /@suggestionsFromMindx\b|\{\{\s*suggestions_from_mindx\s*\}\}|\{\s*suggestions_from_mindx\s*\}/gi,
      () => suggestionsHtml
    )
    .replace(
      /@futureDirection\b|\{\{\s*future_direction\s*\}\}|\{\s*future_direction\s*\}/gi,
      () => futureHtml
    )
    .replace(
      /@studentName\b|\{\{\s*student_name\s*\}\}|\{\s*student_name\s*\}/gi,
      () => safeStudentName
    )
    .replace(
      /@className\b|\{\{\s*class_name\s*\}\}|\{\s*class_name\s*\}/gi,
      () => safeClassName
    );

  for (const [k, v] of macroMap.entries()) {
    if (
      k !== "@learnedFromMindx" &&
      k !== "@suggestionsFromMindx" &&
      k !== "@futureDirection" &&
      k !== "@studentName" &&
      k !== "@className" &&
      v
    ) {
      rendered = rendered.split(k).join(v);
    }
  }

  // Ensure all 3 sections appear in rendered HTML if template used unknown placeholder names
  const plainCheck = normalizePlainTextForEval(rendered);
  const missingParts: string[] = [];
  if (!plainCheck.includes(normalizePlainTextForEval(params.learnedFromMindx))) {
    missingParts.push(learnedHtml);
  }
  if (!plainCheck.includes(normalizePlainTextForEval(params.suggestionsFromMindx))) {
    missingParts.push(suggestionsHtml);
  }
  if (!plainCheck.includes(normalizePlainTextForEval(params.futureDirection))) {
    missingParts.push(futureHtml);
  }
  if (missingParts.length > 0) {
    rendered = `${rendered}${missingParts.join("")}`;
  }

  return {
    sourceContent: rawSource,
    macros,
    html: rendered,
  };
}

/**
 * Pure-Node Session 14 Column 2 & StudentLetter upload engine (`UpdateSlotComment` + `studentLetters`)
 * for both Coding and Robotics (including `Demo2024 | ROB`, dynamic 9 `[ROB-ĐNL]` IDs,
 * numeric + HTML Robotics award ranking `665e8440181e0e47f6c654c1`, `APPROVED` letter lock guard,
 * and mandatory Read-after-Write GraphQL verification).
 */
export async function uploadSession14EvalViaApi(options: {
  classId: string;
  studentIds?: string[];
  classSummaryHtml?: string;
  uploadClassSummary?: boolean;
  skipUnapproved?: boolean;
  lmsClassIdOverride?: string;
  graphqlEndpoint?: string;
  authTokenOverride?: string;
}): Promise<UploadSession14EvalSummary & { warnings?: string[] }> {
  const normalizedClassId = String(options.classId || "").trim().toUpperCase();
  if (!normalizedClassId) {
    throw new LmsWriteStrictError("Thiếu mã lớp (classId) khi đẩy đánh giá Buổi 14.");
  }

  const jobId = `job_s14_eval_api_${Date.now()}`;
  const roster = studentRepo.findByClass(normalizedClassId, false);
  const studentMap = new Map(roster.map((s) => [s.studentId, s]));

  const allEvalRows = session14EvalRepo.findByClass(normalizedClassId);
  const hasExplicitStudentIds = Boolean(options.studentIds && options.studentIds.length > 0);
  const targetRows = hasExplicitStudentIds
    ? allEvalRows.filter((r) => options.studentIds!.includes(r.studentId))
    : allEvalRows.filter((r) => {
        const stu = studentMap.get(r.studentId);
        return Number(stu?.isActive ?? 1) !== 0 && r.status === "APPROVED";
      });

  const explicitSummaryHtml =
    typeof options.classSummaryHtml === "string" ? options.classSummaryHtml.trim() : "";
  const shouldUploadClassSummary =
    explicitSummaryHtml.length > 0 ||
    options.uploadClassSummary === true ||
    options.uploadClassSummary !== false;

  const summary: UploadSession14EvalSummary & { warnings?: string[] } = {
    classId: normalizedClassId,
    totalRequested: targetRows.length,
    verifiedCount: 0,
    failedCount: 0,
    demotedCount: 0,
    skippedCount: 0,
    results: [],
    warnings: [],
  };

  if (targetRows.length === 0 && !shouldUploadClassSummary) {
    return summary;
  }

  const lmsClassId = await resolveTargetLmsClassId({
    classId: normalizedClassId,
    lmsClassIdOverride: options.lmsClassIdOverride,
    graphqlEndpoint: options.graphqlEndpoint,
    authTokenOverride: options.authTokenOverride,
  });
  let classDoc = await fetchClassWriteContext({
    classId: normalizedClassId,
    lmsClassId,
    graphqlEndpoint: options.graphqlEndpoint,
    authTokenOverride: options.authTokenOverride,
  });
  const slot14 = findSlotBySessionNumber(classDoc, 14);
  const slot14Id = String(slot14._id);
  const classSiteId = String(classDoc?.centre?.id || "").trim() || undefined;
  const courseProcess =
    (Array.isArray(classDoc?.courseProcesses)
      ? classDoc.courseProcesses[0]
      : classDoc?.courseProcesses) ||
    classDoc?.courseProcess ||
    classDoc?.course?.courseProcess ||
    null;
  const courseProcessId = String(courseProcess?.id || courseProcess?._id || "").trim() || undefined;

  // Step A: Upload & Verify Slot 14 Summary
  if (shouldUploadClassSummary) {
    let resolvedSummaryHtml = explicitSummaryHtml;
    if (!resolvedSummaryHtml) {
      const effective = getEffectiveClassSession14Summary(normalizedClassId);
      if (
        options.uploadClassSummary === true ||
        effective.classSummary.status !== "VERIFIED"
      ) {
        resolvedSummaryHtml = String(effective.classSummary.summaryHtml || "").trim();
      }
    }

    if (!resolvedSummaryHtml) {
      summary.classSummaryVerified = false;
      summary.classSummaryStatus = "SKIPPED";
    } else {
      let summaryMutated = false;
      try {
        await runLmsWriteGql<any>({
          query: LMS_UPDATE_SLOT_COMMENT_MUTATION,
          variables: {
            payload: {
              classId: lmsClassId,
              slotId: slot14Id,
              ...(classSiteId ? { classSiteId } : {}),
              sessionNumber: 14,
              summary: resolvedSummaryHtml,
              homework: String(slot14.homework || ""),
              ...(courseProcessId ? { courseProcessId } : {}),
            },
          },
          operationName: "UpdateSlotComment",
          graphqlEndpoint: options.graphqlEndpoint,
          authTokenOverride: options.authTokenOverride,
        });
        summaryMutated = true;

        // Read-after-Write verification for Slot 14 Summary
        classDoc = await fetchClassWriteContext({
          classId: normalizedClassId,
          lmsClassId,
          graphqlEndpoint: options.graphqlEndpoint,
          authTokenOverride: options.authTokenOverride,
        });
        const reopenedSlot14 = findSlotBySessionNumber(classDoc, 14);
        const expectedPlain = normalizePlainTextForEval(resolvedSummaryHtml);
        const actualPlain = normalizePlainTextForEval(String(reopenedSlot14?.summary || ""));
        if (!expectedPlain || !actualPlain.includes(expectedPlain)) {
          throw new LmsWriteStrictError(
            `[Read-after-Write] Nội dung Summary Buổi 14 đọc lại từ LMS không khớp bản đã duyệt.`
          );
        }

        session14ClassSummaryRepo.markVerified(normalizedClassId, resolvedSummaryHtml);
        summary.classSummaryVerified = true;
        summary.classSummaryStatus = "VERIFIED";
      } catch (sumErr) {
        if (!summaryMutated && isRecoverableLmsApiWriteError(sumErr)) {
          throw sumErr;
        }
        const sumMsg = sumErr instanceof Error ? sumErr.message : String(sumErr);
        session14ClassSummaryRepo.markFailed(normalizedClassId, sumMsg);
        summary.classSummaryVerified = false;
        summary.classSummaryStatus = "FAILED";
        summary.classSummaryError = sumMsg;
      }
    }
  }

  if (targetRows.length === 0) {
    return summary;
  }

  // Lazy-load default StudentLetter email template once per batch if any student needs creation
  let cachedDefaultTemplate: { id: string; content: string } | null = null;
  const getDefaultStudentLetterTemplate = async () => {
    if (cachedDefaultTemplate) return cachedDefaultTemplate;
    try {
      const tplRes = await runLmsWriteGql<any>({
        query: LMS_EMAIL_TEMPLATES_QUERY,
        variables: { payload: { type_in: ["StudentLetter"] } },
        operationName: "GetEmailTemplates",
        graphqlEndpoint: options.graphqlEndpoint,
        authTokenOverride: options.authTokenOverride,
      });
      const list = Array.isArray(tplRes?.emailTemplates?.data) ? tplRes.emailTemplates.data : [];
      const activeTpl = list.find((t: any) => t?.isActive !== false) || list[0];
      if (activeTpl?.id) {
        cachedDefaultTemplate = {
          id: String(activeTpl.id),
          content: String(activeTpl.content || ""),
        };
      }
    } catch {
      cachedDefaultTemplate = null;
    }
    return cachedDefaultTemplate;
  };

  // Precompute active-only dense ranking & attendance-aware grade info identical to UI `buildEnrichedSession14EvalList`
  const enrichedList = buildEnrichedSession14EvalList(normalizedClassId);
  const enrichedByStudent = new Map(enrichedList.map((it) => [it.studentId, it]));

  const isLego = isLegoRoboticsClassCode(normalizedClassId, String(classDoc?.course?.name || ""));
  const isRobotics = isRoboticsClassCode(normalizedClassId) || isLego;
  const isSpckExempt = isAdminSpckExemptClass(
    normalizedClassId,
    String(classDoc?.course?.name || "")
  );
  const limits = getSession14DemoLimitsForClass(normalizedClassId);
  let anyStudentEvalMutated = false;

  for (const row of targetRows) {
    ensureQueueNotStopped();
    const stu = studentMap.get(row.studentId);
    const fullName = stu?.fullName || row.studentId;

    if (stu && Number(stu.isActive ?? 1) === 0) {
      summary.skippedCount++;
      summary.results.push({
        studentId: row.studentId,
        fullName,
        status: "SKIPPED",
        errorMessage: "Bỏ qua học viên đã nghỉ/bảo lưu (isActive = 0).",
      });
      continue;
    }

    const freshRow = session14EvalRepo.findOne(normalizedClassId, row.studentId);
    if (!freshRow || freshRow.status !== "APPROVED") {
      if (options.skipUnapproved || freshRow?.status === "VERIFIED") {
        summary.skippedCount++;
        summary.results.push({
          studentId: row.studentId,
          fullName,
          status: "SKIPPED",
          errorMessage:
            freshRow?.status === "VERIFIED"
              ? "Học viên đã nộp xác thực (VERIFIED) trước đó."
              : "Bỏ qua học viên chưa bấm Duyệt (APPROVED).",
        });
        continue;
      }
      session14EvalRepo.demoteToWaitingApproval(
        normalizedClassId,
        row.studentId,
        "Chưa được bấm Duyệt (APPROVED) trước khi đẩy lên LMS."
      );
      summary.demotedCount++;
      summary.results.push({
        studentId: row.studentId,
        fullName,
        status: "DEMOTED_DRIFT",
        errorMessage: "Bản ghi chưa ở trạng thái APPROVED. Đã chuyển về WAITING_APPROVAL.",
      });
      continue;
    }

    if (!verifySession14EvalIntegrity(freshRow)) {
      session14EvalRepo.demoteToWaitingApproval(
        normalizedClassId,
        row.studentId,
        "Phát hiện nội dung đánh giá Buổi 14 bị thay đổi sau khi duyệt (Hash Drift)."
      );
      summary.demotedCount++;
      summary.results.push({
        studentId: row.studentId,
        fullName,
        status: "DEMOTED_DRIFT",
        errorMessage: "Nội dung đã thay đổi sau khi duyệt (Hash Drift). Vui lòng duyệt lại.",
      });
      continue;
    }

    const expectedHash = freshRow.contentHash;

    try {
      const currentSlot14 = findSlotBySessionNumber(classDoc, 14);
      const lmsStudentId = resolveLmsStudentIdForRecord(
        row.studentId,
        fullName,
        classDoc,
        currentSlot14
      );
      const stuAtt = (currentSlot14?.studentAttendance || []).find(
        (a: any) => String(a?.student?.id || "").trim() === lmsStudentId
      );
      if (!stuAtt?._id) {
        throw new LmsWriteStrictError(
          `[Identity Guard] Không tìm thấy studentAttendanceId tại Buổi 14 cho học viên '${fullName}'.`
        );
      }

      const compScores = parseSession14CompetencyScores(freshRow.competencyJson);
      const demoScores = parseSession14DemoScores(freshRow.demoScoresJson, normalizedClassId);
      const demoTotal =
        Math.round(
          (demoScores.algorithm +
            demoScores.creativity +
            demoScores.communication +
            demoScores.problemSolving +
            demoScores.computerSkills) *
            100
        ) / 100;

      // Build `byAreas` dynamically from `courseProcess.finalSession` -> fallback `stuAtt.commentByAreas` -> defaults
      const byAreas: Array<Record<string, unknown>> = [];
      const enrichedStu = enrichedByStudent.get(row.studentId);
      const isStuAbsentS14 =
        /ABSENT|OFF|VANG/i.test(String(stuAtt?.status || "")) ||
        Boolean(enrichedStu?.isAbsent);

      // 1) DEMO Area (`demoQuestions`) — skip when class is SPCK-exempt (`PTB`/`CSB`) and LMS has no DEMO area
      const cpDemoArea = Array.isArray(courseProcess?.finalSession?.demoScore?.commentAreas)
        ? courseProcess.finalSession.demoScore.commentAreas[0]
        : null;
      const existingDemoArea = Array.isArray(stuAtt?.commentByAreas)
        ? stuAtt.commentByAreas.find((a: any) => String(a?.type || "").toUpperCase() === "DEMO")
        : null;
      const includeDemoArea = !isSpckExempt || Boolean(cpDemoArea || existingDemoArea);
      let demoQuestionsPayload: Array<{
        courseProcessDemoDetailId?: string;
        title: string;
        result: string;
        score: number;
        maxScore: number;
      }> = [];

      if (includeDemoArea) {
        const demoCommentAreaId = String(
          cpDemoArea?.id ||
            existingDemoArea?.commentAreaId ||
            (isLego
              ? "683e8936dd5f276209a4af26"
              : isRobotics
              ? "66c810fc6ae1a9fab63875fd"
              : "665e88ae181e0e47f6c65642")
        );
        const courseProcessDemoId = String(
          courseProcess?.finalSession?.demoScore?.id ||
            existingDemoArea?.courseProcessDemoId ||
            ""
        ).trim();

        const rawDemoDetails: Array<{ id: string; title: string; maxScore: number }> =
          Array.isArray(cpDemoArea?.demoDetails) && cpDemoArea.demoDetails.length >= 5
            ? cpDemoArea.demoDetails.map((d: any) => ({
                id: String(d.id || ""),
                title: String(d.title || ""),
                maxScore: Number(d.score || 0),
              }))
            : Array.isArray(existingDemoArea?.demoQuestions) &&
                existingDemoArea.demoQuestions.length >= 5
            ? existingDemoArea.demoQuestions.map((q: any) => ({
                id: String(q.courseProcessDemoDetailId || ""),
                title: String(q.title || ""),
                maxScore: Number(q.maxScore || 0),
              }))
            : [
                { id: "demo_algo", title: "Tư duy máy tính, tư duy thuật toán", maxScore: limits.algorithm },
                { id: "demo_crea", title: isLego ? "Tư duy sáng tạo mô hình" : "Tư duy sáng tạo", maxScore: limits.creativity },
                { id: "demo_comm", title: "Kỹ năng giao tiếp, hợp tác", maxScore: limits.communication },
                { id: "demo_prob", title: "Kỹ năng giải quyết vấn đề", maxScore: limits.problemSolving },
                { id: "demo_comp", title: isLego ? "Kỹ năng sử dụng công nghệ" : "Kỹ năng sử dụng máy tính", maxScore: limits.computerSkills },
              ];

        demoQuestionsPayload = rawDemoDetails.slice(0, 5).map((det, idx) => {
          const key = mapDemoDetailTitleToKey(det.title, idx, isRobotics, isLego);
          const scoreVal = Number(demoScores[key] || 0);
          const cap = det.maxScore > 0 ? det.maxScore : Number(limits[key] || 5);
          if (scoreVal > cap + 1e-6) {
            throw new LmsWriteStrictError(
              `[Score Cap] Điểm Demo '${det.title}' (${scoreVal}) vượt quá trần tối đa trên LMS (${cap}) cho '${fullName}'.`
            );
          }
          return {
            ...(det.id ? { courseProcessDemoDetailId: det.id } : {}),
            title: det.title,
            result: String(scoreVal),
            score: scoreVal,
            maxScore: cap,
          };
        });

        byAreas.push({
          commentAreaId: demoCommentAreaId,
          type: "DEMO",
          grade: demoTotal,
          content: "",
          ...(courseProcessDemoId ? { courseProcessDemoId } : {}),
          demoQuestions: demoQuestionsPayload,
        });
      }

      // 2) [ĐNL] RATE Areas (7 areas for LEGO RBT 4+/6+, 9 areas for Coding & VEX Robotics)
      const finalEvalEntries = Array.isArray(courseProcess?.finalSession?.finalEvaluations)
        ? courseProcess.finalSession.finalEvaluations
        : [];
      const flattenedCpAreas: Array<{
        id: string;
        name: string;
        type: string;
        finalEvalId?: string;
        finalEvalTitle?: string;
      }> = [];
      for (const fe of finalEvalEntries) {
        const areas = Array.isArray(fe?.commentAreas) ? fe.commentAreas : [];
        for (const ca of areas) {
          flattenedCpAreas.push({
            id: String(ca?.id || ""),
            name: String(ca?.name || ""),
            type: String(ca?.type || "").toUpperCase(),
            finalEvalId: fe?.id ? String(fe.id) : undefined,
            finalEvalTitle: fe?.title ? String(fe.title) : undefined,
          });
        }
      }

      const minRateAreas = isLego ? 7 : 9;
      const rateAreasSource =
        flattenedCpAreas.filter((a) => a.type === "RATE").length >= minRateAreas
          ? flattenedCpAreas.filter((a) => a.type === "RATE")
          : Array.isArray(stuAtt?.commentByAreas) &&
            stuAtt.commentByAreas.filter((a: any) => String(a?.type || "").toUpperCase() === "RATE")
              .length >= minRateAreas
          ? stuAtt.commentByAreas
              .filter((a: any) => String(a?.type || "").toUpperCase() === "RATE")
              .map((a: any) => ({
                id: String(a.commentAreaId || ""),
                name: "",
                type: "RATE",
                finalEvalId: a.courseProcessFinalEvaluationId,
                finalEvalTitle: a.courseProcessFinalEvaluationTitle,
              }))
          : isLego
          ? LEGO_COMPETENCY_AREA_SPECS.map((s) => ({
              id: s.commentAreaId,
              name: s.labelVi,
              type: "RATE",
              finalEvalTitle: s.finalEvalTitle,
            }))
          : COMPETENCY_AREA_SPECS.map((s) => ({
              id: s.commentAreaId,
              name: isRobotics && s.roboticsLabelVi ? s.roboticsLabelVi : s.labelVi,
              type: "RATE",
            }));

      const usedCompKeys = new Set<keyof CompetencyScores>();
      const fallbackRateOrder: Array<keyof CompetencyScores> = isLego
        ? LEGO_COMPETENCY_AREA_SPECS.map((s) => s.key)
        : [...SESSION14_COMPETENCY_KEYS];
      const expectedRateChecks: Array<{ areaId: string; grade: number; key: keyof CompetencyScores }> = [];
      for (let idx = 0; idx < rateAreasSource.length; idx++) {
        const area = rateAreasSource[idx];
        let matchedKey = matchCompetencyKeyForArea(area.id, area.name);
        if (!matchedKey || usedCompKeys.has(matchedKey)) {
          const fallbackKey =
            fallbackRateOrder.find((k) => !usedCompKeys.has(k)) ||
            fallbackRateOrder[idx % fallbackRateOrder.length];
          matchedKey = fallbackKey;
        }
        usedCompKeys.add(matchedKey);
        const rating = Math.min(5, Math.max(1, Math.round(Number(compScores[matchedKey]) || 4)));
        expectedRateChecks.push({ areaId: area.id, grade: rating, key: matchedKey });
        byAreas.push({
          commentAreaId: area.id,
          type: "RATE",
          grade: rating,
          content: "",
          ...(area.finalEvalId ? { courseProcessFinalEvaluationId: area.finalEvalId } : {}),
          ...(area.finalEvalTitle
            ? { courseProcessFinalEvaluationTitle: area.finalEvalTitle }
            : {}),
        });
      }

      // 3) Robotics "Xếp hạng học viên trên lớp" (`665e8440181e0e47f6c654c1` or LEGO `67b54307f79c7bc326e017ff`, type: "CONTENT")
      // NEVER touch Coding CONTENT areas with Robotics criteria/maxes (e.g. 1.25 / "Robot")
      const contentAreaFromCp = flattenedCpAreas.find(
        (a) =>
          a.id === "665e8440181e0e47f6c654c1" ||
          (isLego && (a.id === "67b54307f79c7bc326e017ff" || /đánh giá chung/i.test(a.name))) ||
          /xếp hạng/i.test(a.name) ||
          (isRobotics && a.type === "CONTENT")
      );
      const existingContentArea = Array.isArray(stuAtt?.commentByAreas)
        ? stuAtt.commentByAreas.find(
            (a: any) =>
              String(a?.commentAreaId || "") === "665e8440181e0e47f6c654c1" ||
              (isLego && String(a?.commentAreaId || "") === "67b54307f79c7bc326e017ff") ||
              (isRobotics && String(a?.type || "").toUpperCase() === "CONTENT")
          )
        : null;
      const cleanAwardRanking = String(freshRow.awardRanking || "").trim();
      const shouldEmitRoboticsAwardArea = isRobotics;
      const shouldEmitExplicitCodingAwardArea =
        !isRobotics &&
        cleanAwardRanking.length > 0 &&
        Boolean(contentAreaFromCp || existingContentArea);

      let expectedAwardAreaId = "";
      let expectedAwardGrade = 0;
      let expectedAwardHtml = "";

      if (shouldEmitRoboticsAwardArea) {
        expectedAwardAreaId = String(
          contentAreaFromCp?.id ||
            existingContentArea?.commentAreaId ||
            (isLego ? "67b54307f79c7bc326e017ff" : "665e8440181e0e47f6c654c1")
        );
        expectedAwardGrade =
          freshRow.awardRankGrade !== undefined && freshRow.awardRankGrade !== null
            ? Math.min(5, Math.max(0, Math.round(Number(freshRow.awardRankGrade))))
            : resolveRoboticsAwardRankGrade({
                manualGrade: freshRow.awardRankGrade ?? null,
                isAbsent: isStuAbsentS14,
                awardRank: enrichedStu?.awardRank ?? null,
                demoTotalScore: demoTotal,
                awardRankingText: cleanAwardRanking || enrichedStu?.awardLabel || "",
              });
        expectedAwardHtml = formatRoboticsAwardRankingHtmlForLms({
          classId: normalizedClassId,
          awardRanking: cleanAwardRanking,
          demoScores,
          demoTotalScore: demoTotal,
          demoJudgeNote: freshRow.demoJudgeNote || "",
          awardLabel: enrichedStu?.awardLabel || "",
        });
        byAreas.push({
          commentAreaId: expectedAwardAreaId,
          type: "CONTENT",
          grade: expectedAwardGrade,
          content: expectedAwardHtml,
          ...(contentAreaFromCp?.finalEvalId
            ? { courseProcessFinalEvaluationId: contentAreaFromCp.finalEvalId }
            : {}),
          ...(contentAreaFromCp?.finalEvalTitle
            ? { courseProcessFinalEvaluationTitle: contentAreaFromCp.finalEvalTitle }
            : {}),
        });
      } else if (shouldEmitExplicitCodingAwardArea) {
        expectedAwardAreaId = String(
          contentAreaFromCp?.id || existingContentArea?.commentAreaId
        );
        expectedAwardGrade =
          freshRow.awardRankGrade !== undefined && freshRow.awardRankGrade !== null
            ? Math.min(5, Math.max(0, Math.round(Number(freshRow.awardRankGrade))))
            : Number(existingContentArea?.grade ?? 0);
        expectedAwardHtml = `<p>${escapeHtmlText(cleanAwardRanking)}</p>`;
        byAreas.push({
          commentAreaId: expectedAwardAreaId,
          type: "CONTENT",
          grade: expectedAwardGrade,
          content: expectedAwardHtml,
          ...(contentAreaFromCp?.finalEvalId
            ? { courseProcessFinalEvaluationId: contentAreaFromCp.finalEvalId }
            : {}),
          ...(contentAreaFromCp?.finalEvalTitle
            ? { courseProcessFinalEvaluationTitle: contentAreaFromCp.finalEvalTitle }
            : {}),
        });
      }

      // Re-verify CAS hash right before mutating LMS
      const latestCheck = session14EvalRepo.findOne(normalizedClassId, row.studentId);
      if (
        !latestCheck ||
        latestCheck.status !== "APPROVED" ||
        computeSession14EvalHash(latestCheck) !== expectedHash
      ) {
        throw new LmsWriteStrictError(
          `[Integrity Guard] Bản ghi Buổi 14 của '${fullName}' đã thay đổi trước khi ghi API.`
        );
      }

      // Mutate Slot Comment (`UpdateSlotComment`)
      await runLmsWriteGql<any>({
        query: LMS_UPDATE_SLOT_COMMENT_MUTATION,
        variables: {
          payload: {
            classId: lmsClassId,
            slotId: slot14Id,
            ...(classSiteId ? { classSiteId } : {}),
            sessionNumber: 14,
            ...(courseProcessId ? { courseProcessId } : {}),
            studentComment: {
              studentAttendanceId: String(stuAtt._id),
              studentId: lmsStudentId,
              content: String(stuAtt.comment || ""),
              byAreas,
            },
          },
        },
        operationName: "UpdateSlotComment",
        graphqlEndpoint: options.graphqlEndpoint,
        authTokenOverride: options.authTokenOverride,
      });
      anyStudentEvalMutated = true;

      // Step B2: `studentLetters` (with APPROVED lock guard)
      const existingLetterRes = await runLmsWriteGql<any>({
        query: LMS_FIND_ONE_STUDENT_LETTER_QUERY,
        variables: {
          payload: {
            classId_equals: lmsClassId,
            studentId_equals: lmsStudentId,
          },
        },
        operationName: "FindOneByCriteria",
        graphqlEndpoint: options.graphqlEndpoint,
        authTokenOverride: options.authTokenOverride,
      });
      const existingLetter = existingLetterRes?.findOneByCriteria || null;
      const existingLetterStatus = String(existingLetter?.status || "").toUpperCase();
      let letterLockedApproved = false;

      if (existingLetter && existingLetterStatus === "APPROVED") {
        letterLockedApproved = true;
        const warnMsg = `Thư StudentLetter của '${fullName}' đang ở trạng thái APPROVED đã khóa bởi quản lý — giữ nguyên thư cũ, chỉ cập nhật & xác minh bảng ĐNL/Demo.`;
        summary.warnings!.push(warnMsg);
        jobLogRepo.add({
          jobId,
          jobType: "UPLOAD_SESSION14_EVAL",
          classId: normalizedClassId,
          sessionId: `${normalizedClassId}_SESS_14_EVAL`,
          studentId: row.studentId,
          level: "WARN",
          message: warnMsg,
        });
      } else {
        const existingSourceContent = String(existingLetter?.sourceContent || "").trim();
        const defaultTpl =
          !existingSourceContent || !existingLetter?.emailTemplateId
            ? await getDefaultStudentLetterTemplate()
            : null;
        const resolvedSourceContent = existingSourceContent || defaultTpl?.content || "";
        const emailTemplateId = String(
          existingLetter?.emailTemplateId || defaultTpl?.id || ""
        ).trim();
        if (!emailTemplateId && !existingLetter?.id) {
          throw new Error(
            `Không lấy được EmailTemplateId StudentLetter từ LMS API cho '${fullName}'.`
          );
        }

        const letterRendered = renderStudentLetterHtml({
          sourceContent: resolvedSourceContent,
          existingMacros: Array.isArray(existingLetter?.macros) ? existingLetter.macros : [],
          learnedFromMindx: freshRow.learnedFromMindx,
          suggestionsFromMindx: freshRow.suggestionsFromMindx,
          futureDirection: freshRow.futureDirection,
          fullName,
          className: String(classDoc?.name || normalizedClassId),
        });

        if (existingLetter?.id) {
          await runLmsWriteGql<any>({
            query: LMS_UPDATE_STUDENT_LETTERS_MUTATION,
            variables: {
              payload: {
                id: String(existingLetter.id),
                ...(emailTemplateId ? { emailTemplateId } : {}),
                sourceContent: letterRendered.sourceContent,
                content: letterRendered.html,
                macros: letterRendered.macros,
              },
            },
            operationName: "UpdateStudentLetters",
            graphqlEndpoint: options.graphqlEndpoint,
            authTokenOverride: options.authTokenOverride,
          });
        } else {
          await runLmsWriteGql<any>({
            query: LMS_CREATE_STUDENT_LETTERS_MUTATION,
            variables: {
              payload: {
                studentId: lmsStudentId,
                classId: lmsClassId,
                emailTemplateId,
                sourceContent: letterRendered.sourceContent,
                content: letterRendered.html,
                macros: letterRendered.macros,
              },
            },
            operationName: "CreateStudentLetters",
            graphqlEndpoint: options.graphqlEndpoint,
            authTokenOverride: options.authTokenOverride,
          });
        }
      }

      // Mandatory Read-after-Write GraphQL Verification
      classDoc = await fetchClassWriteContext({
        classId: normalizedClassId,
        lmsClassId,
        graphqlEndpoint: options.graphqlEndpoint,
        authTokenOverride: options.authTokenOverride,
      });
      const verifiedSlot14 = findSlotBySessionNumber(classDoc, 14);
      const verifiedStuAtt = (verifiedSlot14?.studentAttendance || []).find(
        (a: any) => String(a?.student?.id || "").trim() === lmsStudentId
      );
      const verifiedAreas: any[] = Array.isArray(verifiedStuAtt?.commentByAreas)
        ? verifiedStuAtt.commentByAreas
        : [];

      // Verify 5 Demo scores (only when DEMO area is applicable on LMS)
      if (includeDemoArea) {
        const verifiedDemoArea = verifiedAreas.find(
          (a) => String(a?.type || "").toUpperCase() === "DEMO"
        );
        const verifiedDemoQs: any[] = Array.isArray(verifiedDemoArea?.demoQuestions)
          ? verifiedDemoArea.demoQuestions
          : [];
        if (verifiedDemoQs.length < 5) {
          throw new LmsWriteStrictError(
            `[Read-after-Write] Điểm Demo đọc lại từ LMS thiếu tiêu chí (${verifiedDemoQs.length}/5) cho '${fullName}'.`
          );
        }
        for (let i = 0; i < 5; i++) {
          const expQ = demoQuestionsPayload[i];
          const actQ =
            verifiedDemoQs.find(
              (q) =>
                (expQ.courseProcessDemoDetailId &&
                  String(q.courseProcessDemoDetailId || "") === expQ.courseProcessDemoDetailId) ||
                normalizeVietnameseName(String(q.title || "")) ===
                  normalizeVietnameseName(expQ.title)
            ) || verifiedDemoQs[i];
          if (!actQ || Math.abs(Number(actQ.score) - Number(expQ.score)) > 1e-6) {
            throw new LmsWriteStrictError(
              `[Read-after-Write] Điểm Demo '${expQ.title}' đọc lại (${actQ?.score}) không khớp bản đã duyệt (${expQ.score}) cho '${fullName}'.`
            );
          }
        }
      }

      // Verify 9 [ĐNL] ratings
      for (const chk of expectedRateChecks) {
        const actArea = verifiedAreas.find(
          (a) => String(a?.commentAreaId || "") === chk.areaId
        );
        if (!actArea || Number(actArea.grade) !== chk.grade) {
          throw new LmsWriteStrictError(
            `[Read-after-Write] Điểm năng lực [ĐNL] (${chk.key}=${chk.grade}) chưa khớp trên LMS cho '${fullName}'.`
          );
        }
      }

      // Verify Robotics award area (`grade` + `content`)
      if (expectedAwardAreaId) {
        const actAward = verifiedAreas.find(
          (a) =>
            String(a?.commentAreaId || "") === expectedAwardAreaId ||
            String(a?.type || "").toUpperCase() === "CONTENT"
        );
        if (!actAward || Number(actAward.grade) !== expectedAwardGrade) {
          throw new LmsWriteStrictError(
            `[Read-after-Write] Số thứ hạng Robotics (${expectedAwardGrade}) đọc lại từ LMS không khớp cho '${fullName}'.`
          );
        }
        const expAwardPlain = normalizePlainTextForEval(expectedAwardHtml);
        const actAwardPlain = normalizePlainTextForEval(String(actAward.content || ""));
        if (expAwardPlain && actAwardPlain !== expAwardPlain) {
          throw new LmsWriteStrictError(
            `[Read-after-Write] Nội dung nhận xét Demo Robotics đọc lại từ LMS không khớp cho '${fullName}'.`
          );
        }
      }

      // Verify StudentLetter unless locked as APPROVED
      if (!letterLockedApproved) {
        const verifiedLetterRes = await runLmsWriteGql<any>({
          query: LMS_FIND_ONE_STUDENT_LETTER_QUERY,
          variables: {
            payload: {
              classId_equals: lmsClassId,
              studentId_equals: lmsStudentId,
            },
          },
          operationName: "FindOneByCriteria",
          graphqlEndpoint: options.graphqlEndpoint,
          authTokenOverride: options.authTokenOverride,
        });
        const vLetter = verifiedLetterRes?.findOneByCriteria;
        const vPlain = normalizePlainTextForEval(String(vLetter?.content || ""));
        const macroVals = new Map<string, string>(
          (Array.isArray(vLetter?.macros) ? vLetter.macros : []).map((m: any) => [
            String(m?.key || ""),
            normalizePlainTextForEval(String(m?.value || "")),
          ])
        );
        const checkPart = (keys: string[], expectedText: string) => {
          const expPlain = normalizePlainTextForEval(expectedText);
          if (!expPlain) return true;
          if (vPlain.includes(expPlain)) return true;
          return keys.some((k) => macroVals.get(k) === expPlain);
        };
        if (
          !vLetter ||
          !checkPart(["@learnedFromMindx", "learned_from_mindx"], freshRow.learnedFromMindx) ||
          !checkPart(["@suggestionsFromMindx", "suggestions_from_mindx"], freshRow.suggestionsFromMindx) ||
          !checkPart(["@futureDirection", "future_direction"], freshRow.futureDirection)
        ) {
          throw new LmsWriteStrictError(
            `[Read-after-Write] Nội dung Thư từ MindX đọc lại từ LMS không khớp 100% cho '${fullName}'.`
          );
        }
      }

      const verifiedRecord = session14EvalRepo.markVerified(
        normalizedClassId,
        row.studentId,
        expectedHash
      );
      summary.verifiedCount++;
      summary.results.push({
        studentId: row.studentId,
        fullName,
        status: "VERIFIED",
        verifiedAt: verifiedRecord.verifiedAt || new Date().toISOString(),
        ...(letterLockedApproved
          ? { errorMessage: "Thư quản lý đã khóa APPROVED — đã lưu & xác minh bảng điểm ĐNL/Demo." }
          : {}),
      });

      jobLogRepo.add({
        jobId,
        jobType: "UPLOAD_SESSION14_EVAL",
        classId: normalizedClassId,
        sessionId: `${normalizedClassId}_SESS_14_EVAL`,
        studentId: row.studentId,
        level: "SUCCESS",
        message: `[LMS API Write] Đã lưu & xác minh Read-after-Write đánh giá Buổi 14 cho ${fullName}.`,
      });
    } catch (err) {
      if (!anyStudentEvalMutated && summary.verifiedCount === 0 && isRecoverableLmsApiWriteError(err)) {
        throw err;
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      session14EvalRepo.markFailed(normalizedClassId, row.studentId, errMsg);
      summary.failedCount++;
      summary.results.push({
        studentId: row.studentId,
        fullName,
        status: "FAILED",
        errorMessage: errMsg,
      });
      jobLogRepo.add({
        jobId,
        jobType: "UPLOAD_SESSION14_EVAL",
        classId: normalizedClassId,
        sessionId: `${normalizedClassId}_SESS_14_EVAL`,
        studentId: row.studentId,
        level: "ERROR",
        message: `[LMS API Write] Lỗi lưu đánh giá Buổi 14 cho ${fullName}: ${errMsg}`,
      });
    }
  }

  return summary;
}

export interface UploadSessionCommentsApiOptions {
  classId: string;
  classCode?: string;
  sessionId: string;
  studentId?: string;
  topic?: string;
  keyKnowledge?: string[];
  homeworkBrief?: string;
  syncSlotMeta?: boolean;
  forcePlaywright?: boolean;
  customPage?: unknown;
  skipNavigation?: boolean;
  preferApiWrite?: boolean;
  lmsClassIdOverride?: string;
  graphqlEndpoint?: string;
  authTokenOverride?: string;
}

function stripLeadingStudentHeaderForLmsComment(rawText: string): string {
  return String(rawText || "").replace(
    /^\s*\*\*[^*\n]+\*\*\s*\r?\n+(?=\s*[-•*]\s*\*\*Điểm mạnh)/i,
    ""
  );
}

function normalizeLmsCommentForCompare(raw: string): string {
  return normalizePlainTextForEval(raw)
    .normalize("NFC")
    .replace(/^-\s*(?:Đánh giá chung|General assessment|Nhận xét chung)\s*:\s*/i, "")
    .trim();
}

function normalizeExpectedCommentVariants(commentText: string): {
  rawNorm: string;
  plainNorm: string;
} {
  const rawNorm = commentText
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^-\s*(?:Đánh giá chung|General assessment|Nhận xét chung)\s*:\s*/i, "")
    .trim();
  const plainNorm = commentText
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^-\s*(?:Đánh giá chung|General assessment|Nhận xét chung)\s*:\s*/i, "")
    .trim();
  return { rawNorm, plainNorm };
}

function cloneAreaForUpdateSlotComment(area: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (area.commentAreaId !== undefined && area.commentAreaId !== null) {
    out.commentAreaId = String(area.commentAreaId);
  }
  if (area.type !== undefined && area.type !== null) {
    out.type = String(area.type);
  }
  if (area.grade !== undefined && area.grade !== null) {
    out.grade = Number(area.grade);
  }
  if (area.content !== undefined && area.content !== null) {
    out.content = String(area.content);
  }
  if (area.courseProcessDemoId) {
    out.courseProcessDemoId = String(area.courseProcessDemoId);
  }
  if (area.courseProcessFinalEvaluationId) {
    out.courseProcessFinalEvaluationId = String(area.courseProcessFinalEvaluationId);
  }
  if (area.courseProcessFinalEvaluationTitle) {
    out.courseProcessFinalEvaluationTitle = String(area.courseProcessFinalEvaluationTitle);
  }
  if (area.courseProcessCheckpointEvaluationId) {
    out.courseProcessCheckpointEvaluationId = String(area.courseProcessCheckpointEvaluationId);
  }
  if (area.courseProcessCheckpointEvaluationTitle) {
    out.courseProcessCheckpointEvaluationTitle = String(
      area.courseProcessCheckpointEvaluationTitle
    );
  }
  if (area.checkpoint && typeof area.checkpoint === "object") {
    const cpOut: Record<string, unknown> = {};
    if (area.checkpoint.checkpointScore !== undefined) {
      cpOut.checkpointScore = area.checkpoint.checkpointScore;
    }
    if (area.checkpoint.practiceScore !== undefined) {
      cpOut.practiceScore = area.checkpoint.practiceScore;
    }
    if (Array.isArray(area.checkpoint.checkpointQuestions)) {
      cpOut.checkpointQuestions = area.checkpoint.checkpointQuestions.map((q: any) => {
        const qOut: Record<string, unknown> = {};
        if (q?.id !== undefined) qOut.id = q.id;
        if (q?.title !== undefined) qOut.title = q.title;
        if (q?.result !== undefined) qOut.result = q.result;
        if (q?.score !== undefined) qOut.score = q.score;
        return qOut;
      });
    }
    out.checkpoint = cpOut;
  }
  if (Array.isArray(area.demoQuestions)) {
    out.demoQuestions = area.demoQuestions.map((dq: any) => {
      const dqOut: Record<string, unknown> = {};
      if (dq?.courseProcessDemoDetailId !== undefined) {
        dqOut.courseProcessDemoDetailId = dq.courseProcessDemoDetailId;
      }
      if (dq?.title !== undefined) dqOut.title = dq.title;
      if (dq?.result !== undefined) dqOut.result = dq.result;
      if (dq?.score !== undefined) dqOut.score = dq.score;
      if (dq?.maxScore !== undefined) dqOut.maxScore = dq.maxScore;
      return dqOut;
    });
  }
  return out;
}

function collectCourseProcessAreaMetaMap(classDoc: any): Map<
  string,
  { id: string; name: string; type: string; evalId?: string; evalTitle?: string }
> {
  const map = new Map<
    string,
    { id: string; name: string; type: string; evalId?: string; evalTitle?: string }
  >();
  const processes = Array.isArray(classDoc?.courseProcesses)
    ? classDoc.courseProcesses
    : classDoc?.courseProcesses
      ? [classDoc.courseProcesses]
      : classDoc?.courseProcess
        ? [classDoc.courseProcess]
        : [];

  const registerEvalList = (evalList: any[]) => {
    for (const ev of evalList) {
      const evalId = ev?.id ? String(ev.id) : undefined;
      const evalTitle = ev?.title ? String(ev.title) : undefined;
      const areas = Array.isArray(ev?.commentAreas) ? ev.commentAreas : [];
      for (const ca of areas) {
        const id = String(ca?.id || ca?._id || "").trim();
        if (!id) continue;
        map.set(id.toLowerCase(), {
          id,
          name: String(ca?.name || ca?.title || ""),
          type: String(ca?.type || "").toUpperCase(),
          evalId,
          evalTitle,
        });
      }
    }
  };

  for (const cp of processes) {
    if (!cp || typeof cp !== "object") continue;
    if (Array.isArray(cp?.finalSession?.finalEvaluations)) {
      registerEvalList(cp.finalSession.finalEvaluations);
    }
    if (Array.isArray(cp?.checkpointEvaluations)) {
      registerEvalList(cp.checkpointEvaluations);
    }
    if (Array.isArray(cp?.checkpoints)) {
      for (const ck of cp.checkpoints) {
        if (Array.isArray(ck?.checkpointEvaluations)) {
          registerEvalList(ck.checkpointEvaluations);
        }
        if (Array.isArray(ck?.evaluations)) {
          registerEvalList(ck.evaluations);
        }
      }
    }
  }
  return map;
}

function slotHasCheckpointOrCompetencyAreas(slot: any): boolean {
  const attendances = Array.isArray(slot?.studentAttendance) ? slot.studentAttendance : [];
  return attendances.some(
    (att: any) =>
      Array.isArray(att?.commentByAreas) &&
      att.commentByAreas.some((a: any) => {
        const t = String(a?.type || "").toUpperCase();
        return t === "CHECKPOINT" || t === "NUMBER" || t === "RATE" || Boolean(a?.checkpoint);
      })
  );
}

function isCheckpointAreaPayloadIncomplete(area: any): boolean {
  if (String(area?.type || "").toUpperCase() !== "CHECKPOINT") return false;
  const cpObj = area?.checkpoint;
  if (!cpObj || typeof cpObj !== "object") return true;
  const questions = cpObj.checkpointQuestions;
  if (Array.isArray(questions) && questions.length > 0) {
    return questions.some(
      (q: any) =>
        !q ||
        typeof q !== "object" ||
        q.id === undefined ||
        q.title === undefined ||
        q.score === undefined
    );
  }
  return false;
}

function getAreaCombinedTitle(
  area: any,
  metaMap: Map<string, { id: string; name: string; type: string; evalId?: string; evalTitle?: string }>,
  includeEvalTitle = true
): string {
  const areaId = String(area?.commentAreaId || area?.id || "").trim().toLowerCase();
  const meta = areaId ? metaMap.get(areaId) : undefined;
  return [
    area?.title,
    area?.name,
    area?.commentArea?.name,
    area?.commentArea?.title,
    ...(includeEvalTitle
      ? [area?.courseProcessCheckpointEvaluationTitle, area?.courseProcessFinalEvaluationTitle]
      : []),
    meta?.name,
  ]
    .filter(Boolean)
    .join(" ");
}

function isGeneralAssessmentArea(
  area: any,
  metaMap: Map<string, { id: string; name: string; type: string; evalId?: string; evalTitle?: string }>,
  isLegoClass: boolean
): boolean {
  const areaId = String(area?.commentAreaId || area?.id || "").trim().toLowerCase();
  if (isLegoClass && areaId === "67b54307f79c7bc326e017ff") return true;
  if (areaId && /(?:danh_gia_chung|general_comment|general_assessment)/i.test(areaId)) {
    return true;
  }
  const combinedTitle = getAreaCombinedTitle(area, metaMap, true);
  return /đánh giá chung|nhận xét chung|general\s*(?:assessment|comment)/i.test(combinedTitle);
}

function isExplicitCompetencyNoteContentArea(
  area: any,
  metaMap: Map<string, { id: string; name: string; type: string; evalId?: string; evalTitle?: string }>
): boolean {
  const areaId = String(area?.commentAreaId || area?.id || "").trim().toLowerCase();
  if (areaId && /(?:comp_note|competency_note|nhan_xet_nang_luc)/i.test(areaId)) {
    return true;
  }
  // Exclude parent section title (LMS attaches "Đánh giá năng lực" to general assessment too)
  const ownTitle = getAreaCombinedTitle(area, metaMap, false);
  if (matchCompetencyKeyForArea(areaId, ownTitle) !== null) {
    return true;
  }
  return /nhận xét năng lực|chi tiết năng lực|competency\s*(?:note|detail|comment)|\[(?:rob-)?đnl\]/i.test(
    ownTitle
  );
}

function canonicalJsonSort(val: unknown): unknown {
  if (Array.isArray(val)) return val.map(canonicalJsonSort);
  if (val && typeof val === "object") {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(val as Record<string, unknown>).sort()) {
      sorted[k] = canonicalJsonSort((val as Record<string, unknown>)[k]);
    }
    return sorted;
  }
  return val;
}

function buildPreservedAreaFingerprint(area: any): string {
  return JSON.stringify(canonicalJsonSort(cloneAreaForUpdateSlotComment(area)));
}

function mergeEnrichedCommentByAreas(origAreas: any[], fullAreas: any[]): any[] {
  if (!Array.isArray(origAreas) || origAreas.length === 0) return fullAreas;
  if (!Array.isArray(fullAreas) || fullAreas.length === 0) return origAreas;
  const usedFullIndices = new Set<number>();
  const merged = origAreas.map((orig, idx) => {
    const oId = String(orig?.commentAreaId || orig?.id || "").trim();
    const oType = String(orig?.type || "").toUpperCase();
    let matchIdx = fullAreas.findIndex(
      (fa, fi) =>
        !usedFullIndices.has(fi) &&
        Boolean(oId) &&
        String(fa?.commentAreaId || fa?.id || "").trim() === oId &&
        (!oType || String(fa?.type || "").toUpperCase() === oType)
    );
    if (matchIdx < 0 && idx < fullAreas.length && !usedFullIndices.has(idx)) {
      const candidate = fullAreas[idx];
      if (!oType || String(candidate?.type || "").toUpperCase() === oType) {
        matchIdx = idx;
      }
    }
    if (matchIdx < 0) return orig;
    usedFullIndices.add(matchIdx);
    const full = fullAreas[matchIdx];
    const combined: Record<string, unknown> = { ...orig };
    for (const [k, v] of Object.entries(full || {})) {
      if (v !== undefined && v !== null) {
        combined[k] = v;
      }
    }
    return combined;
  });
  for (let i = 0; i < fullAreas.length; i++) {
    if (!usedFullIndices.has(i)) merged.push(fullAreas[i]);
  }
  return merged;
}

async function enrichCheckpointSlotDetailsIfNeeded(params: {
  classId: string;
  lmsClassId: string;
  sessionNumber: number;
  slot: any;
  graphqlEndpoint?: string;
  authTokenOverride?: string;
}): Promise<any> {
  const attendances = Array.isArray(params.slot?.studentAttendance)
    ? params.slot.studentAttendance
    : [];
  const slotStillNeedsEnrichment = (): boolean =>
    attendances.some(
      (att: any) =>
        Array.isArray(att?.commentByAreas) &&
        att.commentByAreas.some((a: any) => {
          const t = String(a?.type || "").toUpperCase();
          return (
            isCheckpointAreaPayloadIncomplete(a) ||
            ((t === "CHECKPOINT" || t === "RATE" || t === "NUMBER") &&
              a?.courseProcessCheckpointEvaluationId === undefined)
          );
        })
    );
  if (!slotStillNeedsEnrichment()) return params.slot;

  const enrichQueries: Array<{ query: string; operationName: string }> = [
    { query: LMS_GET_CLASS_BY_ID_QUERY, operationName: "GetClassById" },
    { query: LMS_GET_CLASS_BY_ID_SAFE_QUERY, operationName: "GetClassByIdSafe" },
  ];

  for (const eq of enrichQueries) {
    if (!slotStillNeedsEnrichment()) break;
    try {
      const fullData = await runLmsWriteGql<any>({
        query: eq.query,
        variables: { id: params.lmsClassId },
        operationName: eq.operationName,
        graphqlEndpoint: params.graphqlEndpoint,
        authTokenOverride: params.authTokenOverride,
      });
      const fullClassDoc = fullData?.classesById;
      if (!fullClassDoc) continue;
      assertMatchingLmsClassPayload(fullClassDoc, params.classId, params.lmsClassId);
      const fullSlot = findSlotBySessionNumber(fullClassDoc, params.sessionNumber);
      if (!Array.isArray(fullSlot?.studentAttendance)) continue;

      const fullAttByStuId = new Map<string, any>();
      for (const fAtt of fullSlot.studentAttendance) {
        const sid = String(fAtt?.student?.id || "").trim();
        if (sid) fullAttByStuId.set(sid, fAtt);
        if (fAtt?._id) fullAttByStuId.set(`att:${String(fAtt._id)}`, fAtt);
      }

      for (const att of attendances) {
        const sid = String(att?.student?.id || "").trim();
        const matched =
          (sid ? fullAttByStuId.get(sid) : undefined) ||
          (att?._id ? fullAttByStuId.get(`att:${String(att._id)}`) : undefined);
        if (matched && Array.isArray(matched.commentByAreas)) {
          att.commentByAreas = mergeEnrichedCommentByAreas(
            att.commentByAreas,
            matched.commentByAreas
          );
        }
      }
    } catch (err) {
      if (err instanceof LmsWriteStrictError || !isRecoverableLmsApiWriteError(err)) {
        throw err;
      }
    }
  }
  return params.slot;
}

export function isVerifiedFeedbackStillCurrent(
  record: SessionFeedbackRecord,
  classCode: string,
  sessionNumber: number
): boolean {
  if (!record || record.status !== "VERIFIED") return false;
  if (!verifyContentIntegrity(record.finalText || "", record.contentHash)) {
    return false;
  }
  const cpParsed = parseCheckpointDataJson(record.checkpointDataJson);
  if (cpParsed?.approvedSnapshotHash) {
    const currentCoreHash = extractCheckpointCoreSnapshotHash(record.checkpointDataJson);
    if (currentCoreHash !== cpParsed.approvedSnapshotHash) {
      return false;
    }
  }
  const stageInfo = resolveCheckpointStageForSession(classCode, sessionNumber);
  if (stageInfo.isCheckpoint || Boolean(cpParsed?.competencyScores)) {
    if (!hasMatchingCheckpointLmsCompetency(cpParsed, classCode)) {
      return false;
    }
  }
  return true;
}

/**
 * Pure-Node LMS Write Engine for Sessions 1..13 (Regular + Checkpoint Coding B5/9, VEX B4/8, LEGO B5/9).
 * Rejects Session 14, enforces CAS hash + Read-after-Write GraphQL verification, and preserves
 * existing `NUMBER` LT/TH, `CHECKPOINT` questions, and competency-note `CONTENT` areas on Checkpoints.
 */
export async function uploadSessionCommentsViaApi(
  options: UploadSessionCommentsApiOptions
): Promise<SaveCommentsBatchResult & { skippedVerifiedCount: number }> {
  const classId = String(options.classId || "").trim().toUpperCase();
  const classCode = String(options.classCode || options.classId || "")
    .trim()
    .toUpperCase();
  const sessionId = String(options.sessionId || "").trim();
  const { studentId } = options;
  const jobId = `save_comment_api_${classCode}_${sessionId}_${Date.now()}`;

  if (!classId || !classCode || classId !== classCode) {
    throw new LmsWriteStrictError(
      `Mã định danh lớp (classId='${classId}') không đồng nhất với mã lớp mở LMS (classCode='${classCode}')! Đã chặn thao tác để tránh ghi nhầm lớp.`
    );
  }

  const escapedClassId = classId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exactSessionRegex = new RegExp(`^${escapedClassId}_SESS_(\\d+)$`, "i");
  const sessionMatch = sessionId.match(exactSessionRegex);
  if (!sessionMatch) {
    throw new LmsWriteStrictError(
      `Mã buổi học (${sessionId}) không thuộc đúng lớp ${classCode} (Yêu cầu định dạng ${classId}_SESS_XX)! Đã chặn thao tác để tránh ghi nhầm buổi học.`
    );
  }

  const sessionNumber = parseInt(sessionMatch[1], 10);
  if (!Number.isInteger(sessionNumber) || sessionNumber < 1 || sessionNumber > 13) {
    if (sessionNumber === 14) {
      throw new LmsWriteStrictError(
        `Buổi 14 (${sessionId}) là buổi Tổng kết cuối khóa (gồm Điểm Năng lực, Điểm Demo và Thư từ MindX 3 phần), không sử dụng luồng nhận xét buổi học thường kỳ. Vui lòng thực hiện tại Màn hình 3 — Sản phẩm cuối khóa (Tab SPCK — Buổi 14).`
      );
    }
    throw new LmsWriteStrictError(
      `Số buổi học (${sessionNumber}) không hợp lệ cho luồng nhận xét Buổi 1..13.`
    );
  }

  if (!isLmsApiWriteEnabled(options)) {
    throw new Error("LMS Write API đang tắt — sử dụng Playwright fallback.");
  }

  const getLatestFeedback = (targetStudentId: string): SessionFeedbackRecord | undefined => {
    if (typeof sessionFeedbackRepo.findOne === "function") {
      return sessionFeedbackRepo.findOne(classId, sessionId, targetStudentId);
    }
    if (typeof sessionFeedbackRepo.findBySession === "function") {
      return (sessionFeedbackRepo.findBySession(classId, sessionId) || []).find(
        (r) => r.studentId === targetStudentId
      );
    }
    return undefined;
  };

  let candidateFeedbacks: SessionFeedbackRecord[] = [];
  if (studentId) {
    const fb = getLatestFeedback(studentId);
    if (fb) candidateFeedbacks = [fb];
  } else {
    candidateFeedbacks = sessionFeedbackRepo.findBySession(classId, sessionId);
  }

  const validRecords = candidateFeedbacks.filter(
    (r) =>
      r.status === "APPROVED" ||
      r.status === "VERIFIED" ||
      ((r.status === "FAILED" || r.status === "SAVING") && Boolean(r.contentHash))
  );

  let skippedVerifiedCount = 0;
  const targetRecords = validRecords.filter((r) => {
    if (studentId) return true;
    if (isVerifiedFeedbackStillCurrent(r, classCode, sessionNumber)) {
      skippedVerifiedCount++;
      return false;
    }
    return true;
  });

  if (skippedVerifiedCount > 0) {
    jobLogRepo.add({
      jobId,
      jobType: "SAVE_COMMENTS",
      classId,
      sessionId,
      level: "INFO",
      message: `[LMS API Write] Đã bỏ qua ${skippedVerifiedCount} học viên đã lưu & đối chiếu VERIFIED hợp lệ trước đó.`,
    });
  }

  if (targetRecords.length === 0) {
    if (skippedVerifiedCount === 0) {
      jobLogRepo.add({
        jobId,
        jobType: "SAVE_COMMENTS",
        classId,
        sessionId,
        level: "WARN",
        message: "Không tìm thấy nhận xét nào ở trạng thái ĐÃ DUYỆT (APPROVED) để lưu lên LMS.",
      });
    }
    return {
      classCode,
      sessionId,
      totalCandidates: candidateFeedbacks.length,
      savedCount: 0,
      verifiedCount: 0,
      failedCount: 0,
      skippedVerifiedCount,
      results: [],
    };
  }

  const lmsClassId = await resolveTargetLmsClassId({
    classId,
    lmsClassIdOverride: options.lmsClassIdOverride,
    graphqlEndpoint: options.graphqlEndpoint,
    authTokenOverride: options.authTokenOverride,
  });

  let classDoc = await fetchClassWriteContext({
    classId,
    lmsClassId,
    graphqlEndpoint: options.graphqlEndpoint,
    authTokenOverride: options.authTokenOverride,
  });

  let targetSlot = findSlotBySessionNumber(classDoc, sessionNumber);
  const slotsArr = Array.isArray(classDoc?.slots) ? classDoc.slots : [];
  const hasOneBasedS14 =
    !slotsArr.some((s: any) => Number(s?.index) === 0) &&
    slotsArr.some((s: any) => Number(s?.index) === 14);
  if (
    targetSlot.index !== undefined &&
    targetSlot.index !== null &&
    Number(targetSlot.index) !== (hasOneBasedS14 ? sessionNumber : sessionNumber - 1)
  ) {
    throw new LmsWriteStrictError(
      `[LMS Class Mismatch] Slot đọc về không khớp Buổi #${sessionNumber} (index=${targetSlot.index}).`
    );
  }

  const stageInfo = resolveCheckpointStageForSession(classCode, sessionNumber);
  const isCheckpointSession = stageInfo.isCheckpoint;
  const isLegoClass = Boolean(
    stageInfo.isLego ||
      isLegoRoboticsClassCodePure(classCode, String(classDoc?.course?.name || ""))
  );

  if (isCheckpointSession || slotHasCheckpointOrCompetencyAreas(targetSlot)) {
    targetSlot = await enrichCheckpointSlotDetailsIfNeeded({
      classId,
      lmsClassId,
      sessionNumber,
      slot: targetSlot,
      graphqlEndpoint: options.graphqlEndpoint,
      authTokenOverride: options.authTokenOverride,
    });
  }

  const classSiteId = String(classDoc?.centre?.id || "").trim() || undefined;
  const courseProcess =
    (Array.isArray(classDoc?.courseProcesses)
      ? classDoc.courseProcesses[0]
      : classDoc?.courseProcesses) ||
    classDoc?.courseProcess ||
    classDoc?.course?.courseProcess ||
    null;
  const courseProcessId =
    String(courseProcess?.id || courseProcess?._id || "").trim() || undefined;
  const courseAreaMetaMap = collectCourseProcessAreaMetaMap(classDoc);

  let summaryMutated = false;
  let anyStudentMutated = false;

  // Optional Slot Summary / Homework sync when explicit metadata or syncSlotMeta is requested
  const hasExplicitSlotMeta =
    Boolean(options.topic?.trim()) ||
    (Array.isArray(options.keyKnowledge) && options.keyKnowledge.length > 0) ||
    Boolean(options.homeworkBrief?.trim()) ||
    options.syncSlotMeta === true;

  if (hasExplicitSlotMeta) {
    try {
      let resolvedTopic = (options.topic || "").trim();
      let resolvedKeyKnowledge = Array.isArray(options.keyKnowledge)
        ? options.keyKnowledge.map((k) => String(k || "").trim()).filter(Boolean)
        : [];
      let resolvedHomeworkBrief = (options.homeworkBrief || "").trim();

      if (
        (!resolvedTopic || resolvedKeyKnowledge.length === 0 || !resolvedHomeworkBrief) &&
        typeof getCoursesSyllabus === "function"
      ) {
        const syllabusList = [...(getCoursesSyllabus() || [])].sort(
          (a, b) =>
            String(b?.courseCode || "").trim().length - String(a?.courseCode || "").trim().length
        );
        const matchedCourse = syllabusList.find((c) => {
          const code = String(c?.courseCode || "").trim().toUpperCase();
          if (!code || !classCode.includes(code)) return false;
          // Generic ROB belongs to VEX/IoT; never match it onto LEGO classes
          if (isLegoClass && !isLegoRoboticsClassCodePure(code)) return false;
          return true;
        });
        const matchedSess = matchedCourse?.sessions?.find(
          (s) => s.sessionNumber === sessionNumber
        );
        if (matchedSess) {
          if (!resolvedTopic && matchedSess.topic) {
            resolvedTopic = String(matchedSess.topic).trim();
          }
          if (resolvedKeyKnowledge.length === 0 && Array.isArray(matchedSess.keyKnowledge)) {
            resolvedKeyKnowledge = matchedSess.keyKnowledge
              .map((k) => String(k || "").trim())
              .filter(Boolean);
          }
          const sessHw =
            (matchedSess as any).homeworkBrief || (matchedSess as any).homeworkSummary;
          if (!resolvedHomeworkBrief && sessHw) {
            resolvedHomeworkBrief = String(sessHw).trim();
          }
        }
      }

      const summaryLines: string[] = [];
      if (resolvedTopic) {
        const formattedTitle = /^(?:BÀI|BUỔI)\s+\d+/i.test(resolvedTopic)
          ? resolvedTopic.toUpperCase()
          : `BÀI ${sessionNumber}: ${resolvedTopic.toUpperCase()}`;
        summaryLines.push(formattedTitle);
      }
      for (const kItem of resolvedKeyKnowledge) {
        summaryLines.push(kItem);
      }
      const nextSummaryHtml =
        summaryLines.length > 0
          ? summaryLines.map((l) => `<p>${escapeHtmlText(l)}</p>`).join("")
          : String(targetSlot.summary || "");
      const nextHomeworkHtml = resolvedHomeworkBrief
        ? `<p>${escapeHtmlText(resolvedHomeworkBrief)}</p>`
        : String(targetSlot.homework || "");

      const summaryChanged =
        summaryLines.length > 0 &&
        normalizePlainTextForEval(String(targetSlot.summary || "")) !==
          normalizePlainTextForEval(summaryLines.join(" "));
      const homeworkChanged =
        Boolean(resolvedHomeworkBrief) &&
        normalizePlainTextForEval(String(targetSlot.homework || "")) !==
          normalizePlainTextForEval(resolvedHomeworkBrief);

      if (summaryChanged || homeworkChanged) {
        await runLmsWriteGql<any>({
          query: LMS_UPDATE_SLOT_COMMENT_MUTATION,
          variables: {
            payload: {
              classId: lmsClassId,
              slotId: String(targetSlot._id),
              ...(classSiteId ? { classSiteId } : {}),
              sessionNumber,
              summary: nextSummaryHtml,
              homework: nextHomeworkHtml,
              ...(courseProcessId ? { courseProcessId } : {}),
            },
          },
          operationName: "UpdateSlotComment",
          graphqlEndpoint: options.graphqlEndpoint,
          authTokenOverride: options.authTokenOverride,
        });
        summaryMutated = true;
      }
    } catch (metaErr) {
      if (!summaryMutated && !anyStudentMutated && isRecoverableLmsApiWriteError(metaErr)) {
        throw metaErr;
      }
      jobLogRepo.add({
        jobId,
        jobType: "SAVE_COMMENTS",
        classId,
        sessionId,
        level: "WARN",
        message: `[LMS API Write] Không thể cập nhật Summary/Homework Buổi ${sessionNumber}: ${
          metaErr instanceof Error ? metaErr.message : String(metaErr)
        }`,
      });
    }
  }

  const results: SaveCommentItemResult[] = [];
  const hasStudentRepoCheck = typeof studentRepo.findOne === "function";

  for (const record of targetRecords) {
    ensureQueueNotStopped();
    const student = hasStudentRepoCheck
      ? studentRepo.findOne(record.studentId, classId)
      : undefined;
    const fullName = student?.fullName || record.studentId;
    const preSaveRecord = getLatestFeedback(record.studentId) || record;
    const approvedText = preSaveRecord.finalText || "";
    const approvedHash = preSaveRecord.contentHash || "";

    const rosterOk =
      !hasStudentRepoCheck ||
      (Boolean(student) &&
        (!student?.classId || student.classId === classId) &&
        student?.isActive === 1);
    const attStatus = preSaveRecord.attendanceStatus;
    const attOk =
      attStatus === undefined ||
      attStatus === null ||
      attStatus === "PRESENT" ||
      attStatus === "LATE";

    if (!rosterOk || !attOk) {
      const eligibilityReason = !rosterOk
        ? `Học viên '${fullName}' không còn thuộc danh sách active của lớp ${classId}.`
        : `Học viên '${fullName}' đang có trạng thái điểm danh '${attStatus}' (không đủ điều kiện lưu nhận xét LMS).`;
      if (preSaveRecord.status !== "DRAFT") {
        sessionFeedbackRepo.updateStatus(
          classId,
          sessionId,
          record.studentId,
          "DRAFT",
          null,
          eligibilityReason,
          approvedHash
        );
      }
      results.push({
        studentId: record.studentId,
        fullName,
        success: false,
        verified: false,
        error: eligibilityReason,
      });
      continue;
    }

    const desiredCpData = parseCheckpointDataJson(preSaveRecord.checkpointDataJson);
    const cpSnapshotMatches =
      !desiredCpData?.approvedSnapshotHash ||
      extractCheckpointCoreSnapshotHash(preSaveRecord.checkpointDataJson) ===
        desiredCpData.approvedSnapshotHash;
    const isHashIntact =
      (preSaveRecord.status === "APPROVED" ||
        preSaveRecord.status === "VERIFIED" ||
        ((preSaveRecord.status === "FAILED" || preSaveRecord.status === "SAVING") &&
          Boolean(approvedHash))) &&
      verifyContentIntegrity(approvedText, approvedHash) &&
      cpSnapshotMatches;

    if (!isHashIntact) {
      if (preSaveRecord.status !== "DRAFT") {
        sessionFeedbackRepo.updateStatus(
          classId,
          sessionId,
          record.studentId,
          "DRAFT",
          null,
          "Nội dung nhận xét hoặc điểm [ĐNL] bị chỉnh sửa sau khi duyệt (Hash drift). Bắt buộc duyệt lại trước khi lưu.",
          approvedHash
        );
      }
      results.push({
        studentId: record.studentId,
        fullName,
        success: false,
        verified: false,
        error: "Hash drift: Nội dung đã bị thay đổi sau khi duyệt.",
      });
      continue;
    }

    const prevStatusBeforeSaving = preSaveRecord.status;
    sessionFeedbackRepo.updateStatus(
      classId,
      sessionId,
      record.studentId,
      "SAVING",
      null,
      null,
      approvedHash
    );

    let studentMutated = false;

    try {
      const lmsStudentId = resolveLmsStudentIdForRecord(
        record.studentId,
        fullName,
        classDoc,
        targetSlot
      );
      const stuAtt = (targetSlot?.studentAttendance || []).find(
        (a: any) => String(a?.student?.id || "").trim() === lmsStudentId
      );
      if (!stuAtt?._id) {
        throw new LmsWriteStrictError(
          `[Identity Guard] Không tìm thấy studentAttendanceId tại Buổi ${sessionNumber} cho học viên '${fullName}'.`
        );
      }

      const commentText = stripLeadingStudentHeaderForLmsComment(approvedText);
      const commentHtml = markdownToSimpleLetterHtml(commentText);
      const { rawNorm: expectedRawNorm, plainNorm: expectedPlainNorm } =
        normalizeExpectedCommentVariants(commentText);
      if (!expectedPlainNorm) {
        throw new LmsWriteStrictError(
          `[Integrity Guard] Nội dung nhận xét của '${fullName}' bị rỗng khi chuẩn bị đẩy API.`
        );
      }

      const existingAreas: any[] = Array.isArray(stuAtt.commentByAreas)
        ? stuAtt.commentByAreas
        : [];
      const isCheckpointStudent =
        isCheckpointSession ||
        Boolean(desiredCpData?.competencyScores) ||
        existingAreas.some((a) => {
          const t = String(a?.type || "").toUpperCase();
          return (
            t === "CHECKPOINT" ||
            t === "NUMBER" ||
            t === "RATE" ||
            Boolean(a?.checkpoint)
          );
        });

      let nextByAreas: Array<Record<string, unknown>> = [];
      let updatedGeneralAreaId: string | null = null;
      const expectedRateChecks: Array<{
        areaId: string;
        key: keyof CompetencyScores;
        grade: number;
      }> = [];
      const preservedAreasChecks: Array<{
        matchType: string;
        commentAreaId: string;
        fingerprint: string;
      }> = [];

      if (!isCheckpointStudent) {
        for (const area of existingAreas) {
          if (!area || typeof area !== "object") continue;
          const t = String(area?.type || "").toUpperCase();
          const cloned = cloneAreaForUpdateSlotComment(area);
          if (t === "CONTENT") {
            cloned.content = commentHtml;
            updatedGeneralAreaId = String(area.commentAreaId || "");
          }
          nextByAreas.push(cloned);
        }
      } else {
        const activeSpecs = isLegoClass
          ? LEGO_COMPETENCY_AREA_SPECS
          : COMPETENCY_AREA_SPECS;
        const activeKeys = getCompetencyKeysForClassPure(
          isLegoClass ? "LEGO" : classCode
        );
        const activeKeySet = new Set<keyof CompetencyScores>(activeKeys);
        const desiredCompScores = desiredCpData?.competencyScores ?? null;

        // Fail-closed if any CHECKPOINT area is missing its nested .checkpoint payload or has truncated question fields
        const hasMissingCheckpointPayload = existingAreas.some((a) =>
          isCheckpointAreaPayloadIncomplete(a)
        );
        if (hasMissingCheckpointPayload) {
          const msg = `Thiếu dữ liệu gốc CHECKPOINT (LT/TH hoặc id/title/score câu hỏi) cho '${fullName}' sau khi làm giàu GetClassById/Safe`;
          if (!anyStudentMutated && !studentMutated) {
            throw new Error(`CHECKPOINT_DETAIL_MISSING: ${msg} — chuyển sang Playwright fallback.`);
          }
          throw new LmsWriteStrictError(`[Integrity Guard] ${msg}.`);
        }

        // Pre-classify Checkpoint CONTENT areas so ambiguous 24-hex areas never fail silently or corrupt competency notes
        const contentAreas = existingAreas.filter(
          (a) => a && typeof a === "object" && String(a?.type || "").toUpperCase() === "CONTENT"
        );
        const explicitGeneralContentSet = new Set<any>();
        const explicitCompNoteContentSet = new Set<any>();
        for (const ca of contentAreas) {
          if (isGeneralAssessmentArea(ca, courseAreaMetaMap, isLegoClass)) {
            explicitGeneralContentSet.add(ca);
          } else if (isExplicitCompetencyNoteContentArea(ca, courseAreaMetaMap)) {
            explicitCompNoteContentSet.add(ca);
          }
        }
        if (explicitGeneralContentSet.size === 0 && contentAreas.length > 0) {
          const unidentifiedContentAreas = contentAreas.filter(
            (ca) => !explicitCompNoteContentSet.has(ca)
          );
          if (unidentifiedContentAreas.length > 0) {
            const stuAttCommentNorm = normalizeLmsCommentForCompare(String(stuAtt.comment || ""));
            const soleUnidentified = unidentifiedContentAreas[0];
            const soleContentNorm = normalizeLmsCommentForCompare(
              String(soleUnidentified?.content || "")
            );
            if (
              unidentifiedContentAreas.length === 1 &&
              Boolean(stuAttCommentNorm) &&
              soleContentNorm === stuAttCommentNorm
            ) {
              explicitGeneralContentSet.add(soleUnidentified);
            } else {
              const msg = `Không xác định chắc chắn vùng 'Đánh giá chung' trong commentByAreas của '${fullName}'`;
              if (!anyStudentMutated && !studentMutated) {
                throw new Error(
                  `AMBIGUOUS_CHECKPOINT_CONTENT_AREA: ${msg} — chuyển sang Playwright fallback.`
                );
              }
              throw new LmsWriteStrictError(`[Identity Guard] ${msg}.`);
            }
          }
        }

        const existingActiveRateCount = existingAreas.filter((a) => {
          if (String(a?.type || "").toUpperCase() !== "RATE") return false;
          const mKey = matchCompetencyKeyForArea(
            String(a?.commentAreaId || ""),
            String(a?.name || a?.title || a?.commentArea?.name || "")
          );
          return Boolean(mKey && activeKeySet.has(mKey) && Number(a?.grade) >= 1);
        }).length;

        if (!desiredCompScores && existingActiveRateCount === 0) {
          throw new LmsWriteStrictError(
            `CHECKPOINT_COMPETENCY_REQUIRED: Buổi Kiểm tra (Checkpoint): Vui lòng tính/tích Điểm Năng lực [ĐNL] cho học viên '${fullName}' trước khi đẩy nhận xét.`
          );
        }

        const seenCompKeys = new Set<keyof CompetencyScores>();
        for (const area of existingAreas) {
          if (!area || typeof area !== "object") continue;
          const areaType = String(area?.type || "").toUpperCase();
          const areaId = String(area?.commentAreaId || "").trim();
          const meta = areaId ? courseAreaMetaMap.get(areaId.toLowerCase()) : undefined;
          const areaTitle = String(
            area?.commentArea?.name ||
              area?.commentArea?.title ||
              area?.name ||
              area?.title ||
              meta?.name ||
              ""
          );

          if (areaType === "CHECKPOINT" || Boolean(area?.checkpoint) || areaType === "NUMBER") {
            const preserved = cloneAreaForUpdateSlotComment(area);
            nextByAreas.push(preserved);
            preservedAreasChecks.push({
              matchType: areaType || "CHECKPOINT",
              commentAreaId: areaId,
              fingerprint: buildPreservedAreaFingerprint(preserved),
            });
            continue;
          }

          if (areaType === "CONTENT") {
            if (explicitGeneralContentSet.has(area)) {
              const updatedGeneral = cloneAreaForUpdateSlotComment(area);
              updatedGeneral.content = commentHtml;
              nextByAreas.push(updatedGeneral);
              updatedGeneralAreaId = areaId || "__GENERAL_CONTENT__";
            } else {
              // Preserve competency-note CONTENT areas ("nhận xét năng lực") 100% unchanged
              const preservedContent = cloneAreaForUpdateSlotComment(area);
              nextByAreas.push(preservedContent);
              preservedAreasChecks.push({
                matchType: "CONTENT",
                commentAreaId: areaId,
                fingerprint: buildPreservedAreaFingerprint(preservedContent),
              });
            }
            continue;
          }

          if (areaType === "RATE") {
            const matchedKey = matchCompetencyKeyForArea(areaId, areaTitle);
            if (matchedKey && activeKeySet.has(matchedKey) && !seenCompKeys.has(matchedKey)) {
              seenCompKeys.add(matchedKey);
              const nextGrade = desiredCompScores
                ? clampCompetencyRating(desiredCompScores[matchedKey], 4)
                : clampCompetencyRating(area?.grade, 4);
              const updatedRate = cloneAreaForUpdateSlotComment(area);
              updatedRate.grade = nextGrade;
              if (updatedRate.content === undefined) updatedRate.content = "";
              nextByAreas.push(updatedRate);
              expectedRateChecks.push({
                areaId,
                key: matchedKey,
                grade: nextGrade,
              });
            } else {
              // Preserve unrelated non-competency RATE areas (e.g. survey radios)
              const preservedRate = cloneAreaForUpdateSlotComment(area);
              nextByAreas.push(preservedRate);
              preservedAreasChecks.push({
                matchType: "RATE",
                commentAreaId: areaId,
                fingerprint: buildPreservedAreaFingerprint(preservedRate),
              });
            }
            continue;
          }

          const preservedOther = cloneAreaForUpdateSlotComment(area);
          nextByAreas.push(preservedOther);
          preservedAreasChecks.push({
            matchType: areaType,
            commentAreaId: areaId,
            fingerprint: buildPreservedAreaFingerprint(preservedOther),
          });
        }

        if (desiredCompScores) {
          for (const spec of activeSpecs) {
            if (seenCompKeys.has(spec.key)) continue;
            seenCompKeys.add(spec.key);
            const metaFromCourse = courseAreaMetaMap.get(spec.commentAreaId.toLowerCase());
            const rating = clampCompetencyRating(desiredCompScores[spec.key], 4);
            const rateAreaId = metaFromCourse?.id || spec.commentAreaId;
            nextByAreas.push({
              commentAreaId: rateAreaId,
              type: "RATE",
              grade: rating,
              content: "",
              ...(metaFromCourse?.evalId
                ? { courseProcessCheckpointEvaluationId: metaFromCourse.evalId }
                : {}),
              ...(metaFromCourse?.evalTitle
                ? { courseProcessCheckpointEvaluationTitle: metaFromCourse.evalTitle }
                : {}),
            });
            expectedRateChecks.push({
              areaId: rateAreaId,
              key: spec.key,
              grade: rating,
            });
          }
        }

        if (!updatedGeneralAreaId) {
          for (const meta of courseAreaMetaMap.values()) {
            if (
              meta.type === "CONTENT" &&
              /đánh giá chung|nhận xét chung|general\s*assessment/i.test(meta.name)
            ) {
              updatedGeneralAreaId = meta.id;
              nextByAreas.push({
                commentAreaId: meta.id,
                type: "CONTENT",
                grade: 0,
                content: commentHtml,
                ...(meta.evalId ? { courseProcessCheckpointEvaluationId: meta.evalId } : {}),
                ...(meta.evalTitle ? { courseProcessCheckpointEvaluationTitle: meta.evalTitle } : {}),
              });
              break;
            }
          }
        }

        if (contentAreas.length > 0 && !updatedGeneralAreaId) {
          const msg = `Không tìm thấy vùng 'Đánh giá chung' để cập nhật cho '${fullName}'`;
          if (!anyStudentMutated && !studentMutated) {
            throw new Error(
              `AMBIGUOUS_CHECKPOINT_CONTENT_AREA: ${msg} — chuyển sang Playwright fallback.`
            );
          }
          throw new LmsWriteStrictError(`[Identity Guard] ${msg}.`);
        }
      }

      // Re-verify CAS hash & eligibility right before mutating LMS
      const latestBeforeWrite = getLatestFeedback(record.studentId);
      const latestCpBeforeWrite = parseCheckpointDataJson(
        latestBeforeWrite?.checkpointDataJson
      );
      const latestCpDrift = Boolean(
        desiredCpData?.approvedSnapshotHash &&
          latestBeforeWrite &&
          extractCheckpointCoreSnapshotHash(latestBeforeWrite.checkpointDataJson) !==
            desiredCpData.approvedSnapshotHash
      );
      if (
        latestBeforeWrite &&
        (latestBeforeWrite.contentHash !== approvedHash ||
          (latestBeforeWrite.finalText || "") !== approvedText ||
          latestCpDrift ||
          (latestCpBeforeWrite?.approvedSnapshotHash &&
            extractCheckpointCoreSnapshotHash(latestBeforeWrite.checkpointDataJson) !==
              latestCpBeforeWrite.approvedSnapshotHash) ||
          latestBeforeWrite.status === "DRAFT")
      ) {
        throw new LmsWriteStrictError(
          `[Integrity Guard] Nhận xét hoặc điểm [ĐNL] của '${fullName}' đã bị chỉnh sửa trước khi ghi API.`
        );
      }

      await runLmsWriteGql<any>({
        query: LMS_UPDATE_SLOT_COMMENT_MUTATION,
        variables: {
          payload: {
            classId: lmsClassId,
            slotId: String(targetSlot._id),
            ...(classSiteId ? { classSiteId } : {}),
            sessionNumber,
            ...(courseProcessId ? { courseProcessId } : {}),
            studentComment: {
              studentAttendanceId: String(stuAtt._id),
              studentId: lmsStudentId,
              content: commentHtml,
              byAreas: nextByAreas,
            },
          },
        },
        operationName: "UpdateSlotComment",
        graphqlEndpoint: options.graphqlEndpoint,
        authTokenOverride: options.authTokenOverride,
      });
      studentMutated = true;
      anyStudentMutated = true;

      // Mandatory Read-after-Write GraphQL Verification
      classDoc = await fetchClassWriteContext({
        classId,
        lmsClassId,
        graphqlEndpoint: options.graphqlEndpoint,
        authTokenOverride: options.authTokenOverride,
      });
      let verifiedSlot = findSlotBySessionNumber(classDoc, sessionNumber);
      if (
        isCheckpointSession ||
        isCheckpointStudent ||
        slotHasCheckpointOrCompetencyAreas(verifiedSlot)
      ) {
        verifiedSlot = await enrichCheckpointSlotDetailsIfNeeded({
          classId,
          lmsClassId,
          sessionNumber,
          slot: verifiedSlot,
          graphqlEndpoint: options.graphqlEndpoint,
          authTokenOverride: options.authTokenOverride,
        });
      }
      targetSlot = verifiedSlot;
      const verifiedStuAtt = (verifiedSlot?.studentAttendance || []).find(
        (a: any) => String(a?.student?.id || "").trim() === lmsStudentId
      );
      if (!verifiedStuAtt) {
        throw new LmsWriteStrictError(
          `[Read-after-Write] Không đọc lại được bản ghi nhận xét của '${fullName}' trên Buổi #${sessionNumber}.`
        );
      }

      const verifiedCommentNorm = normalizeLmsCommentForCompare(
        String(verifiedStuAtt.comment || "")
      );
      const verifiedAreas: any[] = Array.isArray(verifiedStuAtt.commentByAreas)
        ? verifiedStuAtt.commentByAreas
        : [];
      const verifiedGeneralArea = updatedGeneralAreaId
        ? updatedGeneralAreaId === "__GENERAL_CONTENT__"
          ? verifiedAreas.find(
              (a) =>
                String(a?.type || "").toUpperCase() === "CONTENT" &&
                !isExplicitCompetencyNoteContentArea(a, courseAreaMetaMap)
            )
          : verifiedAreas.find(
              (a) => String(a?.commentAreaId || "") === updatedGeneralAreaId
            )
        : null;
      const verifiedGeneralNorm = verifiedGeneralArea
        ? normalizeLmsCommentForCompare(String(verifiedGeneralArea.content || ""))
        : "";

      const commentMatches =
        (verifiedCommentNorm === expectedPlainNorm ||
          verifiedCommentNorm === expectedRawNorm ||
          (Boolean(verifiedGeneralNorm) &&
            (verifiedGeneralNorm === expectedPlainNorm ||
              verifiedGeneralNorm === expectedRawNorm))) &&
        (!updatedGeneralAreaId ||
          (Boolean(verifiedGeneralArea) &&
            (verifiedGeneralNorm === expectedPlainNorm ||
              verifiedGeneralNorm === expectedRawNorm)));

      if (!commentMatches) {
        throw new LmsWriteStrictError(
          `[Read-after-Write] Nội dung nhận xét Buổi #${sessionNumber} đọc lại từ LMS không khớp bản đã duyệt cho '${fullName}'.`
        );
      }

      if (isCheckpointStudent) {
        for (const chk of expectedRateChecks) {
          const actArea = verifiedAreas.find((a) => {
            if (String(a?.type || "").toUpperCase() !== "RATE") return false;
            const aid = String(a?.commentAreaId || "").trim();
            if (chk.areaId && aid === chk.areaId) return true;
            const aName = String(
              a?.commentArea?.name || a?.name || a?.title || ""
            );
            return matchCompetencyKeyForArea(aid, aName) === chk.key;
          });
          if (!actArea || Number(actArea.grade) !== chk.grade) {
            throw new LmsWriteStrictError(
              `[Read-after-Write] Điểm năng lực [ĐNL] (${chk.key}=${chk.grade}) đọc lại từ LMS không khớp cho '${fullName}'.`
            );
          }
        }

        // Verify preserved NUMBER / CHECKPOINT / competency-note CONTENT areas were not altered
        for (const pres of preservedAreasChecks) {
          const matchedAct = verifiedAreas.some((a) => {
            const actType = String(a?.type || "").toUpperCase();
            const actId = String(a?.commentAreaId || "").trim();
            if (pres.matchType === "CHECKPOINT" && isCheckpointAreaPayloadIncomplete(a)) {
              return false;
            }
            if (pres.commentAreaId) {
              return (
                (actType === pres.matchType || (pres.matchType === "CHECKPOINT" && Boolean(a?.checkpoint))) &&
                actId === pres.commentAreaId &&
                buildPreservedAreaFingerprint(a) === pres.fingerprint
              );
            }
            return (
              (actType === pres.matchType || (pres.matchType === "CHECKPOINT" && Boolean(a?.checkpoint))) &&
              buildPreservedAreaFingerprint(a) === pres.fingerprint
            );
          });
          if (!matchedAct) {
            throw new LmsWriteStrictError(
              `[Read-after-Write] Dữ liệu gốc (${pres.matchType} '${pres.commentAreaId}') bị sai lệch ngoài ý muốn cho '${fullName}'.`
            );
          }
        }
      }

      // Final CAS check before marking VERIFIED
      const postCasRec = getLatestFeedback(record.studentId);
      const postCasCp = parseCheckpointDataJson(postCasRec?.checkpointDataJson);
      const postCasDrift = Boolean(
        postCasRec &&
          (postCasRec.contentHash !== approvedHash ||
            (postCasRec.finalText || "") !== approvedText ||
            postCasRec.status === "DRAFT" ||
            (postCasCp?.approvedSnapshotHash &&
              extractCheckpointCoreSnapshotHash(postCasRec.checkpointDataJson) !==
                postCasCp.approvedSnapshotHash))
      );
      if (postCasDrift) {
        if (postCasRec && postCasRec.status !== "DRAFT") {
          sessionFeedbackRepo.updateStatus(
            classId,
            sessionId,
            record.studentId,
            "DRAFT",
            null,
            "Nhận xét hoặc điểm [ĐNL] bị chỉnh sửa trong lúc đang lưu API.",
            approvedHash
          );
        }
        throw new LmsWriteStrictError(
          `[Integrity Guard] Nhận xét hoặc điểm [ĐNL] của '${fullName}' bị sửa thành bản nháp mới trong lúc đang lưu.`
        );
      }

      const verifiedAt = new Date().toISOString();
      sessionFeedbackRepo.markVerified(
        classId,
        sessionId,
        record.studentId,
        approvedHash
      );
      if (
        isCheckpointStudent &&
        desiredCpData?.competencyScores &&
        typeof (sessionFeedbackRepo as any).markCheckpointLmsCompetencyVerified === "function"
      ) {
        const canonical9Scores = parseCompetencyScoresPure(desiredCpData.competencyScores);
        (sessionFeedbackRepo as any).markCheckpointLmsCompetencyVerified(
          classId,
          sessionId,
          record.studentId,
          canonical9Scores,
          verifiedAt,
          approvedHash
        );
      }

      jobLogRepo.add({
        jobId,
        jobType: "SAVE_COMMENTS",
        classId,
        sessionId,
        studentId: record.studentId,
        level: "SUCCESS",
        message: `[LMS API Write] Đã lưu & đối chiếu VERIFIED nhận xét Buổi #${sessionNumber} cho '${fullName}'.`,
      });

      results.push({
        studentId: record.studentId,
        fullName,
        success: true,
        verified: true,
      });
    } catch (itemErr: any) {
      const rawErrMsg = itemErr instanceof Error ? itemErr.message : String(itemErr);
      const latestOnErr = getLatestFeedback(record.studentId);
      const wasEditedDuringSave =
        latestOnErr &&
        (latestOnErr.contentHash !== approvedHash ||
          (latestOnErr.finalText || "") !== approvedText ||
          latestOnErr.status === "DRAFT");

      if (!anyStudentMutated && !studentMutated && isRecoverableLmsApiWriteError(itemErr)) {
        if (!wasEditedDuringSave && prevStatusBeforeSaving !== "SAVING") {
          sessionFeedbackRepo.updateStatus(
            classId,
            sessionId,
            record.studentId,
            prevStatusBeforeSaving,
            preSaveRecord.verifiedAt ?? null,
            preSaveRecord.errorMessage ?? null,
            approvedHash
          );
        }
        throw itemErr;
      }

      const isMissingComp = rawErrMsg.startsWith("CHECKPOINT_COMPETENCY_REQUIRED:");
      const isDriftErr = /\[Integrity Guard\]/i.test(rawErrMsg);
      const cleanErrMsg = rawErrMsg.replace(/^CHECKPOINT_COMPETENCY_REQUIRED:\s*/i, "");

      if (!wasEditedDuringSave) {
        sessionFeedbackRepo.updateStatus(
          classId,
          sessionId,
          record.studentId,
          isDriftErr ? "DRAFT" : isMissingComp ? "APPROVED" : "FAILED",
          null,
          cleanErrMsg,
          approvedHash
        );
      }

      jobLogRepo.add({
        jobId,
        jobType: "SAVE_COMMENTS",
        classId,
        sessionId,
        studentId: record.studentId,
        level: "ERROR",
        message: `[LMS API Write] Lỗi lưu nhận xét của '${fullName}': ${cleanErrMsg}`,
      });

      results.push({
        studentId: record.studentId,
        fullName,
        success: false,
        verified: false,
        error: cleanErrMsg,
      });
    }
  }

  const savedCount = results.filter((r) => r.success).length;
  const verifiedCount = results.filter((r) => r.verified).length;
  const failedCount = results.filter((r) => !r.success).length;

  if (
    isCheckpointSession &&
    verifiedCount > 0 &&
    typeof syncVerifiedCheckpointToReportCardSnapshot === "function"
  ) {
    try {
      syncVerifiedCheckpointToReportCardSnapshot(classId);
    } catch {}
  }

  return {
    classCode,
    sessionId,
    totalCandidates: targetRecords.length,
    savedCount,
    verifiedCount,
    failedCount,
    skippedVerifiedCount,
    results,
  };
}
