import fs from "node:fs";
import path from "node:path";
import { assertPathAllowed } from "../security/path-allowlist";
import type { GradingCriterion, GradingRubric } from "../types";
export type { GradingCriterion, GradingRubric };

const DEFAULT_CONFIG_DIR = path.resolve(process.cwd(), "data", "config");

function resolveConfigDir(): string {
  const customDir = process.env.MINDX_CONFIG_DIR?.trim();
  if (customDir) {
    return path.resolve(process.cwd(), customDir);
  }
  return DEFAULT_CONFIG_DIR;
}

function resolveSafeConfigFilePath(fileName: string): string {
  const safeBaseName = path.basename(fileName);
  if (!safeBaseName || safeBaseName !== fileName || fileName.includes("..")) {
    throw new Error(`[Security Exception] Invalid config file name: '${fileName}'`);
  }
  const allowedDir = assertPathAllowed(resolveConfigDir());
  if (!fs.existsSync(allowedDir)) {
    fs.mkdirSync(allowedDir, { recursive: true });
  }
  return assertPathAllowed(path.join(allowedDir, safeBaseName));
}

function readJsonFile<T>(fileName: string, fallback: T): T {
  const filePath = resolveSafeConfigFilePath(fileName);
  if (!fs.existsSync(filePath)) {
    writeJsonFile(fileName, fallback);
    return fallback;
  }
  try {
    const safeReadPath = assertPathAllowed(filePath);
    const raw = fs.readFileSync(safeReadPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(fallback) && !Array.isArray(parsed)) {
      console.warn(`[json-config] Expected array in ${fileName}, got ${typeof parsed}. Using fallback.`);
      return fallback;
    }
    return parsed as T;
  } catch (err) {
    if (err instanceof Error && err.message.includes("[Security Exception]")) {
      throw err;
    }
    console.error(`[json-config] Error reading ${fileName}:`, err);
    return fallback;
  }
}

function writeJsonFile<T>(fileName: string, data: T): void {
  const filePath = resolveSafeConfigFilePath(fileName);
  const tempPath = assertPathAllowed(`${filePath}.tmp`);
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tempPath, filePath);
}

// ==========================================
// 1. COURSES & SYLLABUS
// ==========================================

export interface CourseSession {
  sessionNumber: number;
  topic: string;
  keyKnowledge: string[];
  homeworkBrief: string;
}

export interface CourseSyllabus {
  courseCode: string;
  courseName: string;
  description: string;
  checkpointSessions?: number[];
  sessions: CourseSession[];
}

export function getCoursesSyllabus(): CourseSyllabus[] {
  return readJsonFile<CourseSyllabus[]>("courses_syllabus.json", []);
}

export function saveCoursesSyllabus(courses: CourseSyllabus[]): void {
  writeJsonFile("courses_syllabus.json", courses);
}

export function getSyllabusByCourse(courseCode: string): CourseSyllabus | undefined {
  const all = getCoursesSyllabus();
  return all.find((c) => c.courseCode.toUpperCase() === courseCode.toUpperCase());
}

export function doesClassCodeMatchCourseCode(
  classCode: string,
  courseCode: string
): boolean {
  const cleanClass = String(classCode || "").trim().toUpperCase();
  const cleanCourse = String(courseCode || "").trim().toUpperCase();
  if (!cleanClass || !cleanCourse) return false;
  if (cleanClass === cleanCourse) return true;

  const escapedCourse = cleanCourse.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exactTokenOrNumberedRegex = new RegExp(`^${escapedCourse}(?:$|\\d+$)`);
  const segments = cleanClass.split(/[^A-Z0-9]+/).filter(Boolean);
  return segments.some((seg) => exactTokenOrNumberedRegex.test(seg));
}

export function findLessonInSyllabus(
  classCode: string,
  sessionNumber: number
): CourseSession | undefined {
  const allCourses = getCoursesSyllabus();
  const sorted = [...allCourses].sort((a, b) => b.courseCode.length - a.courseCode.length);
  const matched = sorted.find((c) => doesClassCodeMatchCourseCode(classCode, c.courseCode));
  if (!matched) return undefined;
  return matched.sessions.find((s) => s.sessionNumber === sessionNumber);
}

// ==========================================
// 2. GRADING RUBRICS
// ==========================================

export function getGradingRubrics(): GradingRubric[] {
  return readJsonFile<GradingRubric[]>("grading_rubrics.json", []);
}

export function saveGradingRubrics(rubrics: GradingRubric[]): void {
  writeJsonFile("grading_rubrics.json", rubrics);
}

export function getRubricBySession(
  courseCode: string,
  sessionNumber: number
): GradingRubric | undefined {
  const all = getGradingRubrics();
  return all.find(
    (r) =>
      r.courseCode.toUpperCase() === courseCode.toUpperCase() &&
      r.sessionNumber === sessionNumber
  );
}

// ==========================================
// 3. QUICK TAGS
// ==========================================

export interface QuickTag {
  id: string;
  label: string;
  sentiment: "positive" | "constructive" | "neutral";
  role?: "excellent" | "good" | "positive" | "slow" | "distracted" | "improve" | string;
  hint: string;
  category?: string;
  categoryName?: string;
  track?: string;
}

export interface QuickTagCategory {
  category:
    | "regular_coding"
    | "regular_robotics"
    | "spck_session14_presentation"
    | "spck_session14_product"
    | "attitude"
    | "comprehension"
    | "execution"
    | "robotics"
    | "presentation"
    | string;
  categoryName: string;
  track?: "coding" | "robotics" | "session14" | string;
  tags: QuickTag[];
}

export function getQuickTags(): QuickTagCategory[] {
  return readJsonFile<QuickTagCategory[]>("quick_tags.json", []);
}

export function saveQuickTags(categories: QuickTagCategory[]): void {
  writeJsonFile("quick_tags.json", categories);
}

// ==========================================
// 4. ZALO BROADCAST TEMPLATES
// ==========================================

export interface ZaloTemplate {
  id: string;
  name: string;
  template: string;
}

export function getZaloTemplates(): ZaloTemplate[] {
  return readJsonFile<ZaloTemplate[]>("zalo_templates.json", []);
}

export function saveZaloTemplates(templates: ZaloTemplate[]): void {
  writeJsonFile("zalo_templates.json", templates);
}

export function renderZaloBroadcast(
  templateId: string,
  placeholders: Record<string, string>
): string {
  const templates = getZaloTemplates();
  const selected = templates.find((t) => t.id === templateId);
  if (!selected) {
    throw new Error(`[Zalo Template Error] Không tìm thấy mẫu Zalo với ID: '${templateId}'`);
  }

  let text = selected.template;
  for (const [key, val] of Object.entries(placeholders)) {
    const reg = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    // Functional replacer prevents regex special character corruption (e.g. $&, $')
    text = text.replace(reg, () => val ?? "");
  }
  return text;
}

// ==========================================
// 5. RUNNING CLASSES CACHE (FROM LMS)
// ==========================================

export interface RunningClassItem {
  classCode: string;
  lmsClassId?: string;
  courseName?: string;
  center?: string;
  status: string;
  startDate?: string;
  endDate?: string;
  updatedAt?: string;
}

const RUNNING_CLASSES_FILE = path.resolve(process.cwd(), "data", "running_classes.json");

function resolveRunningClassesFilePath(): string {
  const customPath = process.env.MINDX_RUNNING_CLASSES_PATH?.trim();
  if (customPath) {
    return assertPathAllowed(path.resolve(process.cwd(), customPath));
  }
  return assertPathAllowed(RUNNING_CLASSES_FILE);
}

export function getRunningClasses(): RunningClassItem[] {
  try {
    const safePath = resolveRunningClassesFilePath();
    if (!fs.existsSync(safePath)) {
      return [];
    }
    const raw = fs.readFileSync(safePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RunningClassItem =>
        Boolean(item && typeof item === "object" && typeof item.classCode === "string" && item.classCode.trim())
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes("[Security Exception]")) {
      throw err;
    }
    return [];
  }
}

export function saveRunningClasses(classes: RunningClassItem[]): void {
  const dataDir = assertPathAllowed(path.resolve(process.cwd(), "data"));
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const safePath = resolveRunningClassesFilePath();
  const tempPath = assertPathAllowed(`${safePath}.tmp`);
  fs.writeFileSync(tempPath, JSON.stringify(classes, null, 2), "utf-8");
  fs.renameSync(tempPath, safePath);
}

// ==========================================
// 6. LMS CLASS OBJECT ID CACHE (lms_class_ids.json)
// ==========================================

const LMS_CLASS_IDS_FILENAME = "lms_class_ids.json";

function isSafeLmsConfigClassCode(raw: unknown): boolean {
  const normalized = String(raw ?? "")
    .trim()
    .toUpperCase();
  return Boolean(normalized && /^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(normalized));
}

function isSafeLmsConfigObjectId(raw: unknown): boolean {
  const normalized = String(raw ?? "").trim();
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  if (
    lower === "undefined" ||
    lower === "null" ||
    lower === "true" ||
    lower === "false" ||
    lower === "nan" ||
    lower === "infinity"
  ) {
    return false;
  }
  return /^[a-zA-Z0-9_-]{8,64}$/.test(normalized);
}

/**
 * Pure read-only loader for cached LMS class ObjectIds (`lms_class_ids.json`).
 * Returns `{}` without creating any directories or files when absent.
 */
export function getLmsClassIdsMap(): Record<string, string> {
  try {
    const allowedDir = assertPathAllowed(resolveConfigDir());
    const filePath = assertPathAllowed(path.join(allowedDir, LMS_CLASS_IDS_FILENAME));
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const code = String(k || "").trim().toUpperCase();
      const id = typeof v === "string" ? v.trim() : "";
      if (isSafeLmsConfigClassCode(code) && isSafeLmsConfigObjectId(id)) {
        out[code] = id;
      }
    }
    return out;
  } catch (err) {
    if (err instanceof Error && err.message.includes("[Security Exception]")) {
      throw err;
    }
    return {};
  }
}

/**
 * Atomically merges and persists discovered `{ [CLASS_CODE]: lmsClassId }` mappings
 * into `lms_class_ids.json` inside `resolveConfigDir()`.
 */
export function saveLmsClassIdMappingsBatch(entries: Record<string, string>): void {
  if (!entries || typeof entries !== "object") return;
  const cleanEntries: Record<string, string> = {};
  for (const [k, v] of Object.entries(entries)) {
    const code = String(k || "").trim().toUpperCase();
    const id = typeof v === "string" ? v.trim() : "";
    if (isSafeLmsConfigClassCode(code) && isSafeLmsConfigObjectId(id)) {
      cleanEntries[code] = id;
    }
  }
  if (Object.keys(cleanEntries).length === 0) return;

  const existing = getLmsClassIdsMap();
  let changed = false;
  const merged: Record<string, string> = { ...existing };
  for (const [code, id] of Object.entries(cleanEntries)) {
    if (merged[code] !== id) {
      merged[code] = id;
      changed = true;
    }
  }
  const allowedDir = assertPathAllowed(resolveConfigDir());
  const existingPath = assertPathAllowed(path.join(allowedDir, LMS_CLASS_IDS_FILENAME));
  if (!changed && fs.existsSync(existingPath)) {
    return;
  }
  writeJsonFile(LMS_CLASS_IDS_FILENAME, merged);
}

/**
 * Persists a single `{ classCode -> lmsClassId }` mapping atomically.
 */
export function saveLmsClassIdMapping(classCode: string, lmsClassId: string): void {
  saveLmsClassIdMappingsBatch({ [classCode]: lmsClassId });
}
