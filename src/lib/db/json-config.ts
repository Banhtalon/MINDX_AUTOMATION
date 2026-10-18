import fs from "node:fs";
import path from "node:path";

const CONFIG_DIR = path.resolve(process.cwd(), "data", "config");

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function readJsonFile<T>(fileName: string, fallback: T): T {
  ensureConfigDir();
  const filePath = path.join(CONFIG_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    writeJsonFile(fileName, fallback);
    return fallback;
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(fallback) && !Array.isArray(parsed)) {
      console.warn(`[json-config] Expected array in ${fileName}, got ${typeof parsed}. Using fallback.`);
      return fallback;
    }
    return parsed as T;
  } catch (err) {
    console.error(`[json-config] Error reading ${fileName}:`, err);
    return fallback;
  }
}

function writeJsonFile<T>(fileName: string, data: T): void {
  ensureConfigDir();
  const filePath = path.join(CONFIG_DIR, fileName);
  const tempPath = `${filePath}.tmp`;
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
}

export interface QuickTagCategory {
  category: "attitude" | "comprehension" | "execution" | "presentation" | string;
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
