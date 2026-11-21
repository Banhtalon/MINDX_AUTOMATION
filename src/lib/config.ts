import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const envLocalPath = path.resolve(process.cwd(), ".env.local");
const envBasePath = path.resolve(process.cwd(), ".env");

function readEnvFileMap(filePath: string): Record<string, string> {
  try {
    if (fs.existsSync(filePath)) {
      return dotenv.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch {
    // ignore transient env read errors
  }
  return {};
}

const startupEnvLocalMap = readEnvFileMap(envLocalPath);
const startupEnvBaseMap = readEnvFileMap(envBasePath);

const HOT_RELOAD_ADMIN_ENV_KEYS = [
  "ADMIN_LMS_USERNAME",
  "ADMIN_LMS_PASSWORD",
  "ADMIN_TEACHING_USERNAME",
  "ADMIN_TEACHING_PASSWORD",
  "ADMIN_CENTER_CODE",
  "ADMIN_LMS_CENTRE_IDS",
] as const;

function detectPreseededAdminTestEnv(): boolean {
  if (
    process.env.MINDX_ROLE_STATE_DIR !== undefined ||
    process.env.MINDX_CONFIG_DIR !== undefined ||
    process.env.MINDX_DB_PATH !== undefined ||
    process.env.MINDX_RUNNING_CLASSES_PATH !== undefined ||
    process.env.MINDX_LMS_CLASS_IDS_PATH !== undefined ||
    process.env.NODE_ENV === "test"
  ) {
    return true;
  }
  // Note: Next.js (@next/env) injects .env.local/.env into process.env BEFORE this module loads.
  // Treat process.env keys as test-preseeded if they don't exist in .env.local/.env or have an explicit non-matching override.
  for (const key of HOT_RELOAD_ADMIN_ENV_KEYS) {
    const currentVal = process.env[key];
    if (currentVal === undefined) continue;
    const inLocal = Object.prototype.hasOwnProperty.call(startupEnvLocalMap, key);
    const inBase = Object.prototype.hasOwnProperty.call(startupEnvBaseMap, key);
    if (!inLocal && !inBase) {
      return true;
    }
    const expectedFromFiles = inLocal ? startupEnvLocalMap[key] : startupEnvBaseMap[key];
    if (!String(expectedFromFiles || "").includes("$") && expectedFromFiles !== currentVal) {
      return true;
    }
  }
  return false;
}

const hasPreseededAdminTestEnv = detectPreseededAdminTestEnv();

// Load .env.local / .env if available (especially when running via scripts / tsx)
dotenv.config({ path: envLocalPath });
dotenv.config({ path: envBasePath });

let lastEnvLocalMtimeMs: number | null = null;
let didHotReloadEnvLocal = false;
try {
  if (fs.existsSync(envLocalPath)) {
    lastEnvLocalMtimeMs = fs.statSync(envLocalPath).mtimeMs;
  }
} catch {
  lastEnvLocalMtimeMs = null;
}

export const DEFAULT_ADMIN_LMS_CENTRE_IDS_BY_CENTER: Record<string, string[]> = {
  "205ALHP": ["644346f794300678908f79bc"],
};

export function isCentreFilterExplicitlyDisabled(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  return /^(?:NONE|-)$/i.test(String(raw).trim());
}

export function parseCentreIdsList(
  raw: string | undefined,
  centerCode: string
): string[] {
  const normalizedCenter = String(centerCode || "205ALHP")
    .trim()
    .toUpperCase();
  if (raw !== undefined) {
    const trimmed = String(raw).trim();
    if (/^(?:NONE|-)$/i.test(trimmed)) {
      return [];
    }
    if (trimmed.length > 0) {
      const tokens = Array.from(
        new Set(
          trimmed
            .split(/[\s,;]+/)
            .map((id) => id.trim())
            .filter(Boolean)
        )
      );
      if (tokens.length > 0) {
        return tokens;
      }
    }
  }
  return [...(DEFAULT_ADMIN_LMS_CENTRE_IDS_BY_CENTER[normalizedCenter] || [])];
}

export interface AppConfig {
  teachingUrl: string;
  teachingUsername: string;
  teachingPassword: string;
  lmsUrl: string;
  lmsUsername: string;
  lmsPassword: string;
  adminLmsUsername: string;
  adminLmsPassword: string;
  adminTeachingUsername: string;
  adminTeachingPassword: string;
  adminCenterCode: string;
  adminLmsCentreIds: string[];
  geminiApiKey: string;
  geminiModel: string;
  headlessMode: boolean;
  allowedLocalDirs: string[];
}

const initialAdminCenterCode = (process.env.ADMIN_CENTER_CODE || "205ALHP")
  .trim()
  .toUpperCase();

export const config: AppConfig = {
  teachingUrl: process.env.TEACHING_URL || "https://teaching.mindx.edu.vn",
  teachingUsername:
    process.env.TEACHING_USERNAME || process.env.MINDX_USERNAME || "",
  teachingPassword:
    process.env.TEACHING_PASSWORD || process.env.MINDX_PASSWORD || "",

  lmsUrl: process.env.LMS_URL || "https://lms.mindx.edu.vn",
  lmsUsername:
    process.env.LMS_USERNAME || process.env.MINDX_USERNAME || "",
  lmsPassword:
    process.env.LMS_PASSWORD || process.env.MINDX_PASSWORD || "",

  adminLmsUsername: process.env.ADMIN_LMS_USERNAME || "",
  adminLmsPassword: process.env.ADMIN_LMS_PASSWORD || "",
  adminTeachingUsername:
    process.env.ADMIN_TEACHING_USERNAME ||
    process.env.TEACHING_USERNAME ||
    process.env.MINDX_USERNAME ||
    "",
  adminTeachingPassword:
    process.env.ADMIN_TEACHING_PASSWORD ||
    process.env.TEACHING_PASSWORD ||
    process.env.MINDX_PASSWORD ||
    "",
  adminCenterCode: initialAdminCenterCode,
  adminLmsCentreIds: parseCentreIdsList(
    process.env.ADMIN_LMS_CENTRE_IDS,
    initialAdminCenterCode
  ),

  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
  headlessMode: process.env.HEADLESS_MODE === "true",
  allowedLocalDirs: (process.env.ALLOWED_LOCAL_DIRS || "")
    .split(/[;,]/)
    .map((dir) => dir.trim())
    .filter(Boolean),
};

export function getDynamicAdminConfig() {
  if (!hasPreseededAdminTestEnv) {
    try {
      if (fs.existsSync(envLocalPath)) {
        const currentMtimeMs = fs.statSync(envLocalPath).mtimeMs;
        if (lastEnvLocalMtimeMs !== currentMtimeMs) {
          const parsedLocal = readEnvFileMap(envLocalPath);
          const parsedBase = readEnvFileMap(envBasePath);
          for (const key of HOT_RELOAD_ADMIN_ENV_KEYS) {
            if (Object.prototype.hasOwnProperty.call(parsedLocal, key)) {
              process.env[key] = parsedLocal[key];
            } else if (Object.prototype.hasOwnProperty.call(parsedBase, key)) {
              process.env[key] = parsedBase[key];
            } else {
              delete process.env[key];
            }
          }
          lastEnvLocalMtimeMs = currentMtimeMs;
          didHotReloadEnvLocal = true;
        }
      } else if (lastEnvLocalMtimeMs !== null) {
        const parsedBase = readEnvFileMap(envBasePath);
        for (const key of HOT_RELOAD_ADMIN_ENV_KEYS) {
          if (Object.prototype.hasOwnProperty.call(parsedBase, key)) {
            process.env[key] = parsedBase[key];
          } else {
            delete process.env[key];
          }
        }
        lastEnvLocalMtimeMs = null;
        didHotReloadEnvLocal = true;
      }
    } catch {
      // ignore transient .env.local read errors
    }
  }

  const useStartupFallback = !didHotReloadEnvLocal;
  const adminLmsUsername = (
    process.env.ADMIN_LMS_USERNAME ?? (useStartupFallback ? config.adminLmsUsername : "")
  ).trim();
  const adminLmsPassword =
    process.env.ADMIN_LMS_PASSWORD ?? (useStartupFallback ? config.adminLmsPassword : "");
  const adminTeachingUsername = (
    process.env.ADMIN_TEACHING_USERNAME ||
    process.env.TEACHING_USERNAME ||
    process.env.MINDX_USERNAME ||
    (useStartupFallback ? config.adminTeachingUsername : "") ||
    config.teachingUsername ||
    ""
  ).trim();
  const adminTeachingPassword =
    process.env.ADMIN_TEACHING_PASSWORD ||
    process.env.TEACHING_PASSWORD ||
    process.env.MINDX_PASSWORD ||
    (useStartupFallback ? config.adminTeachingPassword : "") ||
    config.teachingPassword ||
    "";
  const adminCenterCode = (
    process.env.ADMIN_CENTER_CODE ||
    (useStartupFallback ? config.adminCenterCode : "") ||
    "205ALHP"
  )
    .trim()
    .toUpperCase();
  const rawCentreIds = process.env.ADMIN_LMS_CENTRE_IDS;
  const adminLmsCentreFilterDisabled = isCentreFilterExplicitlyDisabled(rawCentreIds);
  const adminLmsCentreIds = parseCentreIdsList(rawCentreIds, adminCenterCode);

  return {
    adminLmsUsername,
    adminLmsPassword,
    adminTeachingUsername,
    adminTeachingPassword,
    adminCenterCode,
    adminLmsCentreIds,
    adminLmsCentreFilterDisabled,
  };
}

function maskUsername(u: string): string {
  if (!u) return "";
  if (u.includes("@")) {
    return u.replace(/^(.{2})(.*)(@.*)$/, "$1***$3");
  }
  return u.length > 3 ? `${u.slice(0, 2)}***${u.slice(-1)}` : "***";
}

/**
 * Returns safe environment settings for client display (never leaks passwords or API keys)
 */
export function getSafePublicConfig() {
  const adminCfg = getDynamicAdminConfig();
  return {
    teachingUrl: config.teachingUrl,
    teachingUsernameMasked: maskUsername(config.teachingUsername),
    lmsUrl: config.lmsUrl,
    lmsUsernameMasked: maskUsername(config.lmsUsername),
    adminCenterCode: adminCfg.adminCenterCode,
    adminLmsUsernameMasked: maskUsername(adminCfg.adminLmsUsername),
    adminTeachingUsernameMasked: maskUsername(adminCfg.adminTeachingUsername),
    hasTeachingAuth: Boolean(config.teachingUsername && config.teachingPassword),
    hasLmsAuth: Boolean(config.lmsUsername && config.lmsPassword),
    hasAdminLmsAuth: Boolean(
      adminCfg.adminLmsUsername && adminCfg.adminLmsPassword
    ),
    hasAdminTeachingAuth: Boolean(
      adminCfg.adminTeachingUsername && adminCfg.adminTeachingPassword
    ),
    hasGeminiKey: Boolean(config.geminiApiKey),
    geminiModel: config.geminiModel,
    headlessMode: config.headlessMode,
  };
}
