import fs from "node:fs";
import path from "node:path";
import { assertPathAllowed } from "../security/path-allowlist";

const CONFIG_DIR = path.resolve(process.cwd(), "data", "config");

function resolveSafeConfigFilePath(fileName: string): string {
  const safeBaseName = path.basename(fileName);
  if (!safeBaseName || safeBaseName !== fileName || fileName.includes("..")) {
    throw new Error(`[Security Exception] Invalid config file name: '${fileName}'`);
  }
  const allowedDir = assertPathAllowed(CONFIG_DIR);
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

export function findLessonInSyllabus(
  classCode: string,
  sessionNumber: number
): CourseSession | undefined {
  const allCourses = getCoursesSyllabus();
  const upperCode = classCode.toUpperCase();
  const sorted = [...allCourses].sort((a, b) => b.courseCode.length - a.courseCode.length);
  const matched = sorted.find((c) => upperCode.includes(c.courseCode.toUpperCase()));
  if (!matched) return undefined;
  return matched.sessions.find((s) => s.sessionNumber === sessionNumber);
}

// ==========================================
// 2. GRADING RUBRICS
// ==========================================

export interface GradingCriterion {
  criterionId: string;
  name: string;
  maxPoints: number;
  description: string;
  expectedSnippetOrConcept: string;
}

export interface GradingRubric {
  rubricId: string;
  courseCode: string;
  sessionNumber: number;
  assignmentTitle: string;
  assignmentPrompt: string;
  maxTotalScore: number;
  criteria: GradingCriterion[];
}

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
  hint: string;
  category?: string;
  categoryName?: string;
}

export interface QuickTagCategory {
  category: "attitude" | "comprehension" | "execution" | "robotics" | "presentation" | string;
  categoryName: string;
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
  courseName?: string;
  center?: string;
  status: string;
  endDate?: string;
  updatedAt?: string;
}

const RUNNING_CLASSES_FILE = path.resolve(process.cwd(), "data", "running_classes.json");

export function getRunningClasses(): RunningClassItem[] {
  try {
    const safePath = assertPathAllowed(RUNNING_CLASSES_FILE);
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
  const safePath = assertPathAllowed(RUNNING_CLASSES_FILE);
  const tempPath = assertPathAllowed(`${safePath}.tmp`);
  fs.writeFileSync(tempPath, JSON.stringify(classes, null, 2), "utf-8");
  fs.renameSync(tempPath, safePath);
}
