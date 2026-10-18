import path from "node:path";
import dotenv from "dotenv";

// Load .env.local if available (especially when running via scripts / tsx)
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

export interface AppConfig {
  teachingUrl: string;
  teachingUsername: string;
  teachingPassword: string;
  lmsUrl: string;
  lmsUsername: string;
  lmsPassword: string;
  geminiApiKey: string;
  geminiModel: string;
  headlessMode: boolean;
  allowedLocalDirs: string[];
}

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

  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
  headlessMode: process.env.HEADLESS_MODE === "true",
  allowedLocalDirs: (process.env.ALLOWED_LOCAL_DIRS || "")
    .split(/[;,]/)
    .map((dir) => dir.trim())
    .filter(Boolean),
};

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
  return {
    teachingUrl: config.teachingUrl,
    teachingUsernameMasked: maskUsername(config.teachingUsername),
    lmsUrl: config.lmsUrl,
    lmsUsernameMasked: maskUsername(config.lmsUsername),
    hasTeachingAuth: Boolean(config.teachingUsername && config.teachingPassword),
    hasLmsAuth: Boolean(config.lmsUsername && config.lmsPassword),
    hasGeminiKey: Boolean(config.geminiApiKey),
    geminiModel: config.geminiModel,
    headlessMode: config.headlessMode,
  };
}
