export const DEFAULT_LMS_BASE_ORIGIN = "https://lms.mindx.edu.vn";
export const LMS_COMMENTS_TAB_INDEX = 10;

const VALID_CLASS_CODE_REGEX = /^[A-Z0-9][A-Z0-9_-]{1,63}$/;
const VALID_OBJECT_ID_REGEX = /^[a-zA-Z0-9_-]{8,64}$/;
const DISALLOWED_ID_LITERALS = new Set([
  "undefined",
  "null",
  "true",
  "false",
  "nan",
  "infinity",
]);

/**
 * Validates that a class code consists strictly of safe uppercase-compatible identifier characters.
 */
export function isValidLmsClassCode(raw: unknown): boolean {
  const normalized = String(raw ?? "")
    .trim()
    .toUpperCase();
  if (!normalized) return false;
  return VALID_CLASS_CODE_REGEX.test(normalized);
}

/**
 * Validates a MindX LMS backend class ID (e.g. 24-hex ObjectId or safe slug/UUID)
 * while rejecting placeholder literals or short numeric row counters.
 */
export function isValidLmsClassObjectId(raw: unknown): boolean {
  const normalized = String(raw ?? "").trim();
  if (!normalized) return false;
  if (DISALLOWED_ID_LITERALS.has(normalized.toLowerCase())) {
    return false;
  }
  return VALID_OBJECT_ID_REGEX.test(normalized);
}

/**
 * Normalizes LMS base URL to a safe http(s) origin (`protocol//host[:port]`),
 * falling back to `DEFAULT_LMS_BASE_ORIGIN` on invalid or unsafe schemes.
 */
export function normalizeLmsBaseOrigin(rawUrl?: unknown): string {
  const trimmed = String(rawUrl ?? "").trim();
  if (!trimmed) return DEFAULT_LMS_BASE_ORIGIN;
  const match = trimmed.match(/^(https?:\/\/[a-zA-Z0-9.-]+(?::\d+)?)(?:\/|$)/i);
  if (!match) {
    return DEFAULT_LMS_BASE_ORIGIN;
  }
  return match[1].replace(/\/+$/, "");
}

/**
 * Builds the exact MindX LMS `/admin/classes` deep-link URL using JSON-quoted query parameters
 * compatible with LMS's `query-string` + `JSON.parse` router contract:
 * - When `lmsClassId` is valid: opens the class table filtered by `classCode` AND opens the class Drawer on `tab` (default 10 = Comments).
 * - When `lmsClassId` is missing/invalid: falls back cleanly to table search (`?search=%22<CODE>%22`) without crashing `GetClassById`.
 */
export function buildLmsClassCommentsUrl(params: {
  lmsBaseUrl?: string;
  classCode: string;
  lmsClassId?: string | null;
  tab?: number;
}): string {
  const origin = normalizeLmsBaseOrigin(params?.lmsBaseUrl);
  const code = String(params?.classCode ?? "")
    .trim()
    .toUpperCase();
  if (!isValidLmsClassCode(code)) {
    return `${origin}/admin/classes`;
  }

  const encodedSearch = encodeURIComponent(JSON.stringify(code));
  const cleanId = String(params?.lmsClassId ?? "").trim();
  const tabNum =
    typeof params?.tab === "number" &&
    Number.isInteger(params.tab) &&
    params.tab >= 0
      ? params.tab
      : LMS_COMMENTS_TAB_INDEX;

  if (isValidLmsClassObjectId(cleanId)) {
    const encodedId = encodeURIComponent(JSON.stringify(cleanId));
    return `${origin}/admin/classes?search=${encodedSearch}&id=${encodedId}&tab=${tabNum}`;
  }

  return `${origin}/admin/classes?search=${encodedSearch}`;
}

/**
 * Extracts a validated `lmsClassId` from an LMS `/admin/classes?...&id=...` URL,
 * supporting both JSON-quoted (`%22...%22` / `"..."`) and unquoted query values.
 */
export function extractLmsClassIdFromDrawerUrl(rawUrl: unknown): string | null {
  const raw = String(rawUrl ?? "").trim();
  if (!raw) return null;
  const qIdx = raw.indexOf("?");
  if (qIdx < 0) return null;

  const hashIdx = raw.indexOf("#", qIdx);
  const queryStr = hashIdx >= 0 ? raw.slice(qIdx + 1, hashIdx) : raw.slice(qIdx + 1);
  if (!queryStr) return null;

  for (const part of queryStr.split("&")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx < 0) continue;
    const rawKey = part.slice(0, eqIdx).trim();
    let key = rawKey;
    try {
      key = decodeURIComponent(rawKey.replace(/\+/g, " "));
    } catch {}
    if (key !== "id") continue;

    let rawVal = part.slice(eqIdx + 1);
    try {
      rawVal = decodeURIComponent(rawVal.replace(/\+/g, " "));
    } catch {}
    rawVal = rawVal.trim();

    if (rawVal.startsWith('"') && rawVal.endsWith('"') && rawVal.length >= 2) {
      try {
        const parsed = JSON.parse(rawVal);
        rawVal = typeof parsed === "string" ? parsed.trim() : rawVal.slice(1, -1).trim();
      } catch {
        rawVal = rawVal.slice(1, -1).trim();
      }
    }

    if (isValidLmsClassObjectId(rawVal)) {
      return rawVal;
    }
  }

  return null;
}
