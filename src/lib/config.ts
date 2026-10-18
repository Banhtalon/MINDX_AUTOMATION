import path from "node:path";
import dotenv from "dotenv";

// Load .env.local if available (especially when running via scripts / tsx)
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

export interface AppConfig {
  teachingUrl: string;
  lmsUrl: string;
  mindxUsername: string;
  mindxPassword: string;
  geminiApiKey: string;
  geminiModel: string;
  headlessMode: boolean;
  allowedLocalDirs: string[];
}

export const config: AppConfig = {
  teachingUrl: process.env.TEACHING_URL || "https://teaching.mindx.edu.vn",
  lmsUrl: process.env.LMS_URL || "https://lms.mindx.edu.vn",
  mindxUsername: process.env.MINDX_USERNAME || "",
  mindxPassword: process.env.MINDX_PASSWORD || "",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
  headlessMode: process.env.HEADLESS_MODE === "true",
  allowedLocalDirs: (process.env.ALLOWED_LOCAL_DIRS || "")
    .split(/[;,]/)
    .map((dir) => dir.trim())
    .filter(Boolean),
};

/**
 * Returns safe environment settings for client display (never leaks passwords or API keys)
 */
export function getSafePublicConfig() {
  return {
    teachingUrl: config.teachingUrl,
    lmsUrl: config.lmsUrl,
    usernameMasked: config.mindxUsername
      ? config.mindxUsername.replace(/^(.{2})(.*)(@.*)$/, "$1***$3")
      : "",
    hasGeminiKey: Boolean(config.geminiApiKey),
    geminiModel: config.geminiModel,
    headlessMode: config.headlessMode,
  };
}
