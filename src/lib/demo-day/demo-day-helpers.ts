/**
 * MINDX AUTOMATION BOT - DEMO DAY SHARED TYPES & PURE HELPERS
 * Browser-safe pure helpers used across API routes, backend inspector, and React UI.
 */

export type DemoTrackCategory =
  | "PYTHON"
  | "WEB"
  | "GAMEMAKER"
  | "SCRATCH"
  | "ROBOTICS"
  | "OTHER";

export type DemoSlideKind =
  | "CANVA"
  | "GOOGLE_SLIDES"
  | "WEB_SLIDE"
  | "LOCAL_PPTX"
  | "LOCAL_PDF"
  | "MISSING";

export type DemoProductKind =
  | "PYTHON"
  | "WEB_LOCAL"
  | "WEB_URL"
  | "GAMEMAKER_EXE"
  | "GAMEMAKER_YYP"
  | "GAMEMAKER_YYZ"
  | "SCRATCH_SB3"
  | "LOCAL_VIDEO"
  | "YOUTUBE_URL"
  | "MISSING";

export interface DemoEntryOption {
  value: string;
  label: string;
  kind: DemoProductKind;
}

export interface DemoSlideSource {
  kind: DemoSlideKind;
  label: string;
  url?: string;
  relPath?: string;
}

export interface DemoProductSource {
  kind: DemoProductKind;
  label: string;
  relPath?: string;
  url?: string;
  previewUrl?: string;
}

export interface DemoDayStudentItem {
  studentId: string;
  fullName: string;
  projectTitle: string;
  trackCategory: DemoTrackCategory;
  trackBadge: string;
  thumbnailUrl: string;
  hasFolder: boolean;
  excluded: boolean;
  completed: boolean;
  slide: DemoSlideSource;
  product: DemoProductSource;
  entryOptions: DemoEntryOption[];
  selectedEntryValue: string;
  hasGameMakerArchive: boolean;
}

export interface DemoDayClassStateResponse {
  classId: string;
  className: string;
  coursePrefix: string | null;
  runningClasses: Array<{
    classId: string;
    classCode: string;
    className: string;
    courseName?: string;
    status?: string;
    currentSessionNumber?: number;
    maxSessionNumber?: number;
  }>;
  demoSheetUrl: string;
  order: string[];
  currentStudentId: string;
  completedStudentIds: string[];
  rowVer: number;
  activeProcessCount: number;
  hasAnyGameMakerProject: boolean;
  students: DemoDayStudentItem[];
}

function stripDiacriticsBasic(text: string): string {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

/**
 * Cleans internal LMS/stage suffixes (`— Buổi 12 (GĐ1)`, trailing `- <StudentName>`)
 * so the stage displays only the student's actual project title.
 */
export function cleanDemoProjectTitle(
  rawTitle: string,
  studentFullName: string
): string {
  let title = String(rawTitle || "")
    .replace(/\s+/g, " ")
    .trim();

  title = title
    .replace(/\s*[—–-]\s*Buổi\s*1[234]\s*(?:\([^)]*\))?\s*$/i, "")
    .trim();

  const cleanName = String(studentFullName || "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleanName && title) {
    const foldTitle = stripDiacriticsBasic(title).toLowerCase();
    const foldName = stripDiacriticsBasic(cleanName).toLowerCase();
    const sepMatch = title.match(/^(.*?)\s+[-–—]\s+([^-–—]+)$/);
    if (sepMatch) {
      const candidateTopic = sepMatch[1].trim();
      const trailingName = stripDiacriticsBasic(sepMatch[2].trim()).toLowerCase();
      if (
        candidateTopic &&
        (trailingName === foldName ||
          foldName.endsWith(" " + trailingName) ||
          trailingName.endsWith(" " + foldName))
      ) {
        title = candidateTopic;
      }
    } else if (
      foldTitle === `spck ${foldName}` ||
      foldTitle === `spck - ${foldName}` ||
      foldTitle === foldName
    ) {
      title = "";
    }
  }

  const finalFold = stripDiacriticsBasic(title).toLowerCase();
  if (!title || /^spck\b/i.test(finalFold) && finalFold.length <= 45 && cleanName && finalFold.includes(stripDiacriticsBasic(cleanName).toLowerCase())) {
    return "Sản phẩm cuối khóa";
  }

  return title || "Sản phẩm cuối khóa";
}

/**
 * Classifies an online URL as Canva / Google Slides / Web Slide if applicable.
 * Ignores Google Drive folders, YouTube links, and code repositories without explicit slide markers.
 */
export function detectSlideLinkMeta(link: {
  name?: string | null;
  url?: string | null;
}): { kind: "CANVA" | "GOOGLE_SLIDES" | "WEB_SLIDE"; label: string } | null {
  const rawUrl = String(link?.url || "").trim();
  if (!rawUrl) return null;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const pathname = parsed.pathname.toLowerCase();
  const labelFold = stripDiacriticsBasic(String(link?.name || "")).toLowerCase();

  if (host === "canva.com" || host.endsWith(".canva.com")) {
    return { kind: "CANVA", label: "Canva" };
  }
  if (host === "docs.google.com" && pathname.includes("/presentation/")) {
    return { kind: "GOOGLE_SLIDES", label: "Google Slides" };
  }
  if (
    host === "gamma.app" ||
    host.endsWith(".gamma.app") ||
    host === "pitch.com" ||
    host === "prezi.com" ||
    host === "slideshare.net" ||
    host === "slides.com" ||
    host === "powerpoint.office.com" ||
    (host === "1drv.ms" && pathname.startsWith("/p/")) ||
    (host === "figma.com" && (pathname.includes("/deck") || pathname.includes("/slides")))
  ) {
    return { kind: "WEB_SLIDE", label: "Slide Online" };
  }

  const isExcludedHost =
    host === "youtube.com" ||
    host === "youtu.be" ||
    host === "m.youtube.com" ||
    (host === "drive.google.com" && pathname.includes("/folders/")) ||
    host.endsWith(".github.io") ||
    host === "github.com";

  if (
    !isExcludedHost &&
    /\b(slide|slides|canva|thuyet\s*trinh|bai\s*trinh\s*chieu|powerpoint|pptx|presentation)\b/i.test(
      labelFold
    )
  ) {
    return { kind: "WEB_SLIDE", label: "Slide Online" };
  }

  return null;
}

export function getDemoTrackBadge(track: DemoTrackCategory): string {
  switch (track) {
    case "PYTHON":
      return "🐍 Python App";
    case "WEB":
      return "🌐 Web";
    case "GAMEMAKER":
      return "🎮 GameMaker";
    case "SCRATCH":
      return "🐱 Scratch";
    case "ROBOTICS":
      return "🤖 Robotics";
    default:
      return "💻 Dự án";
  }
}

export function encodeDemoEntryOption(type: "file" | "url", target: string): string {
  return `${type}:${target}`;
}

export function parseDemoEntryOption(
  value: string
): { type: "file" | "url"; target: string } | null {
  const raw = String(value || "").trim();
  if (raw.startsWith("file:")) {
    const target = raw.slice(5).trim();
    return target ? { type: "file", target } : null;
  }
  if (raw.startsWith("url:")) {
    const target = raw.slice(4).trim();
    return target ? { type: "url", target } : null;
  }
  return null;
}

/**
 * Reconciles saved Demo Day order against the live student roster and exclusion flags:
 * - Preserves saved order among present (non-excluded) students
 * - Appends new present students not yet in savedOrder
 * - Places excluded students at the end
 */
export function reconcileDemoOrder(
  savedOrder: string[],
  rosterIds: string[],
  overrides: Record<string, { excluded?: boolean }>
): string[] {
  const rosterSet = new Set(rosterIds);
  const seen = new Set<string>();
  const presentOrdered: string[] = [];
  const excludedOrdered: string[] = [];

  for (const id of savedOrder || []) {
    if (!rosterSet.has(id) || seen.has(id)) continue;
    seen.add(id);
    if (overrides[id]?.excluded) {
      excludedOrdered.push(id);
    } else {
      presentOrdered.push(id);
    }
  }

  for (const id of rosterIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (overrides[id]?.excluded) {
      excludedOrdered.push(id);
    } else {
      presentOrdered.push(id);
    }
  }

  return [...presentOrdered, ...excludedOrdered];
}

/**
 * Fair Fisher-Yates shuffle on present students, keeping excluded students at the end.
 */
export function shuffleDemoStudentOrder(
  presentIds: string[],
  excludedIds: string[],
  rng?: () => number
): string[] {
  const randomFn = rng || Math.random;
  const arr = [...presentIds];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(randomFn() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  if (!rng && arr.length >= 2 && arr.every((id, idx) => id === presentIds[idx])) {
    const first = arr.shift();
    if (first !== undefined) arr.push(first);
  }
  return [...arr, ...excludedIds];
}

export function sortDemoStudentsByOrder(
  students: DemoDayStudentItem[],
  order: string[]
): DemoDayStudentItem[] {
  const rankMap = new Map<string, number>();
  order.forEach((id, idx) => rankMap.set(id, idx));
  return [...students].sort((a, b) => {
    const ra = rankMap.has(a.studentId) ? rankMap.get(a.studentId)! : Number.MAX_SAFE_INTEGER;
    const rb = rankMap.has(b.studentId) ? rankMap.get(b.studentId)! : Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return a.fullName.localeCompare(b.fullName, "vi");
  });
}
