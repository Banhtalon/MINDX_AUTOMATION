/**
 * MINDX AUTOMATION BOT - DEMO DAY CLASS INSPECTOR
 * Reuses existing SQLite SPCK submissions, student roster, thumbnails, and local SPCK folders
 * in read-only mode (never mutating `spck_uploads` or original student files) to prepare
 * Slides, Canva links, and local executable product entries for Demo Day.
 */

import fs from "node:fs";
import path from "node:path";
import { getClassDemoSheetMeta } from "@/app/api/spck/list/route";
import { isSyntheticClassCode, listStudents, queryClassDirectory } from "../classes/class-directory";
import {
  demoDayRepo,
  spckSessionRepo,
  spckUploadRepo,
  type DemoDayStudentOverride,
} from "../db/sqlite";
import {
  classifySpckRelatedLink,
  DEFAULT_SPCK_THUMBNAIL_PATH,
  isSensitiveSecretFile,
  parseLinksTxtContent,
  resolveDefaultSpckClassFolder,
  resolveStudentFolderInsideClassRoot,
} from "../local-files/spck-scanner";
import { detectCoursePrefixFromClassId } from "../playwright/spck-drive-uploader";
import { assertPathAllowed, isPathAllowed } from "../security/path-allowlist";
import {
  cleanDemoProjectTitle,
  detectSlideLinkMeta,
  encodeDemoEntryOption,
  getDemoTrackBadge,
  parseDemoEntryOption,
  reconcileDemoOrder,
  sortDemoStudentsByOrder,
  type DemoDayClassStateResponse,
  type DemoDayStudentItem,
  type DemoEntryOption,
  type DemoProductKind,
  type DemoProductSource,
  type DemoSlideSource,
  type DemoTrackCategory,
} from "./demo-day-helpers";
import { getActiveDemoProcessCount } from "./demo-day-launcher";
import { ensureStudentWebPreviewUrl } from "./demo-web-preview-server";

const SKIP_SCAN_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  ".vscode",
  ".idea",
  "__pycache__",
  "venv",
  ".venv",
  "env",
  ".next",
  "dist",
  "build",
  "out",
  "_spck_app_shots",
  "_spck_owner_uploads",
  "_spck_youtube_frames",
  "_spck_prev_backup",
  "_portal_backups",
]);

const DRAFT_DIR_REGEX = /^(draf|draft|drafts|backup|backups|old|temp|tmp|archive)$/i;
const IMAGE_THUMB_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const IGNORED_EXE_REGEX = /^(unins|setup|install|vcredist|dxsetup)/i;

interface ScannedStudentFiles {
  slideFiles: Array<{ relPath: string; depth: number; inDraft: boolean; ext: string }>;
  pyFiles: Array<{ relPath: string; depth: number; inDraft: boolean; score: number }>;
  htmlFiles: Array<{ relPath: string; depth: number; inDraft: boolean; rank: number }>;
  exeFiles: Array<{ relPath: string; depth: number; inDraft: boolean }>;
  yypFiles: Array<{ relPath: string; depth: number; inDraft: boolean }>;
  yyzFiles: Array<{ relPath: string; depth: number; inDraft: boolean }>;
  sb3Files: Array<{ relPath: string; depth: number; inDraft: boolean }>;
  videoFiles: Array<{ relPath: string; depth: number; inDraft: boolean }>;
  linksTxtUrls: Array<{ name: string; url: string }>;
  linksTxtYoutube: string[];
  linksTxtCustomTitle: string;
}

export interface InternalStudentDemoTarget {
  studentId: string;
  fullName: string;
  studentRootDir: string;
  item: DemoDayStudentItem;
}

function resolveDemoTrackCategory(
  coursePrefix: string | null,
  courseName?: string | null
): DemoTrackCategory {
  const prefix = String(coursePrefix || "").toUpperCase();
  if (/^(PTB|PTA|PTI|CSB|CSA|CSI|PY)/.test(prefix)) {
    if (prefix === "CSA" || prefix === "CSI") {
      // CSA/CSI can contain Python or Web; Python fallback handled gracefully
      return "PYTHON";
    }
    return "PYTHON";
  }
  if (/^(JSB|JSA|JSI|WEB)/.test(prefix)) return "WEB";
  if (/^(GB|GA|GI|GMB|GMA|GMI)/.test(prefix)) return "GAMEMAKER";
  if (/^(SB|SA|SI)/.test(prefix)) return "SCRATCH";
  if (/^(ROB|VEX|PRE|ARM|SEMI)/.test(prefix)) return "ROBOTICS";

  const cname = String(courseName || "").toLowerCase();
  if (/\b(web|html|javascript|jsb|jsa|jsi)\b/.test(cname)) return "WEB";
  if (/\b(gamemaker|game\s*maker)\b/.test(cname)) return "GAMEMAKER";
  if (/\b(python|pyqt|app\s*producer)\b/.test(cname)) return "PYTHON";
  if (/\bscratch\b/.test(cname)) return "SCRATCH";
  if (/\brobotics\b/.test(cname)) return "ROBOTICS";
  return "OTHER";
}

function isValidLocalImagePath(rawPath: string): string | null {
  const trimmed = String(rawPath || "").trim();
  if (!trimmed || trimmed.includes("\0")) return null;
  const ext = path.extname(trimmed).toLowerCase();
  if (!IMAGE_THUMB_EXTS.has(ext)) return null;
  try {
    if (!isPathAllowed(trimmed)) return null;
    const safe = assertPathAllowed(trimmed);
    const st = fs.lstatSync(safe);
    if (st.isSymbolicLink() || !st.isFile() || st.size <= 0) return null;
    return safe;
  } catch {
    return null;
  }
}

function resolveSafeStudentDirectory(
  candidateDirs: string[],
  defaultClassFolder: string,
  studentFullName: string,
  studentId: string
): string {
  const toCheck = [...candidateDirs];
  if (defaultClassFolder && fs.existsSync(defaultClassFolder)) {
    const inferred = resolveStudentFolderInsideClassRoot(
      defaultClassFolder,
      studentFullName,
      studentId
    );
    if (inferred) toCheck.push(inferred);
  }

  for (const rawDir of toCheck) {
    const trimmed = String(rawDir || "").trim();
    if (!trimmed) continue;
    try {
      if (!isPathAllowed(trimmed)) continue;
      const safe = assertPathAllowed(trimmed);
      const st = fs.lstatSync(safe);
      if (!st.isSymbolicLink() && st.isDirectory()) {
        return fs.realpathSync(safe);
      }
    } catch {
      // Try next candidate
    }
  }
  return "";
}

function resolveStudentThumbnailPath(
  studentRootDir: string,
  candidateDbPaths: string[]
): string {
  for (const cand of candidateDbPaths) {
    const valid = isValidLocalImagePath(cand);
    if (
      valid &&
      path.resolve(valid).toLowerCase() !==
        path.resolve(DEFAULT_SPCK_THUMBNAIL_PATH).toLowerCase()
    ) {
      return valid;
    }
  }

  if (studentRootDir) {
    const subdirsToCheck = [
      "_spck_owner_uploads",
      "_spck_app_shots",
      "_spck_youtube_frames",
    ];
    for (const sub of subdirsToCheck) {
      const dir = path.join(studentRootDir, sub);
      try {
        if (!fs.existsSync(dir)) continue;
        const stDir = fs.lstatSync(dir);
        if (stDir.isSymbolicLink() || !stDir.isDirectory()) continue;
        const files = fs
          .readdirSync(dir)
          .filter((f) => IMAGE_THUMB_EXTS.has(path.extname(f).toLowerCase()))
          .sort((a, b) => {
            const aThumb = /^thumb_/i.test(a) ? 0 : 1;
            const bThumb = /^thumb_/i.test(b) ? 0 : 1;
            return aThumb - bThumb || a.localeCompare(b, "en", { numeric: true });
          });
        for (const f of files) {
          const valid = isValidLocalImagePath(path.join(dir, f));
          if (valid) return valid;
        }
      } catch {
        // ignore unreadable subdir
      }
    }
  }

  const fallback = isValidLocalImagePath(DEFAULT_SPCK_THUMBNAIL_PATH);
  return fallback || DEFAULT_SPCK_THUMBNAIL_PATH;
}

function scorePythonEntryFile(filePath: string, relPath: string, depth: number, inDraft: boolean): number {
  let score = inDraft ? -50 : 0;
  score -= depth * 12;
  const baseLower = path.basename(relPath).toLowerCase();

  if (baseLower === "main.py") score += 120;
  else if (baseLower === "app.py" || baseLower === "run.py" || baseLower === "spck.py") score += 100;
  else if (baseLower === "login.py" || baseLower === "home.py" || baseLower === "trangchu.py") score += 75;
  else if (baseLower === "index.py" || baseLower === "game.py" || baseLower === "start.py") score += 65;
  else if (baseLower === "__init__.py" || baseLower.startsWith("test_")) score -= 80;
  else if (baseLower.startsWith("ui_") || baseLower.endsWith("_ui.py")) score -= 25;

  try {
    const content = fs.readFileSync(filePath, "utf8").slice(0, 32768);
    if (/\bQApplication\s*\(/.test(content)) score += 60;
    if (/\b(?:Tk|CTk)\s*\(/.test(content) || /\.mainloop\s*\(/.test(content)) score += 50;
    if (/\bpygame\.init\s*\(/.test(content)) score += 50;
    if (/uic\.loadUi\s*\(/i.test(content)) score += 30;
    if (/if\s+__name__\s*==\s*['"]__main__['"]/.test(content)) score += 35;
  } catch {
    // Ignore read error
  }

  return score;
}

function scoreHtmlEntryFile(relPath: string, depth: number, inDraft: boolean): number {
  let rank = inDraft ? 100 : 0;
  rank += depth * 20;
  const baseLower = path.basename(relPath).toLowerCase();
  if (baseLower === "index.html" || baseLower === "index.htm") rank += 0;
  else if (baseLower === "home.html" || baseLower === "trangchu.html" || baseLower === "main.html") rank += 5;
  else if (baseLower.includes("404")) rank += 60;
  else rank += 15;
  return rank;
}

function scanStudentFilesForDemo(studentRootDir: string): ScannedStudentFiles {
  const result: ScannedStudentFiles = {
    slideFiles: [],
    pyFiles: [],
    htmlFiles: [],
    exeFiles: [],
    yypFiles: [],
    yyzFiles: [],
    sb3Files: [],
    videoFiles: [],
    linksTxtUrls: [],
    linksTxtYoutube: [],
    linksTxtCustomTitle: "",
  };

  if (!studentRootDir) return result;

  const walk = (dir: string, depth: number, inDraft: boolean) => {
    if (depth > 3) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const name = entry.name;
      const lower = name.toLowerCase();
      if (
        name.startsWith(".") ||
        name.startsWith("~$") ||
        lower.startsWith("_spck_") ||
        lower.startsWith("_portal_") ||
        SKIP_SCAN_DIRS.has(lower)
      ) {
        continue;
      }

      const fullPath = path.join(dir, name);
      let st: fs.Stats;
      try {
        st = fs.lstatSync(fullPath);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;

      if (st.isDirectory()) {
        walk(fullPath, depth + 1, inDraft || DRAFT_DIR_REGEX.test(name));
        continue;
      }
      if (!st.isFile() || isSensitiveSecretFile(lower)) continue;

      const relPath = path.relative(studentRootDir, fullPath).replace(/\\/g, "/");
      const ext = path.extname(lower);

      if (depth <= 1 && (lower === "links.txt" || lower === "youtube.txt")) {
        try {
          const parsedLinks = parseLinksTxtContent(fs.readFileSync(fullPath, "utf8"));
          for (const rl of parsedLinks.relatedLinks || []) {
            result.linksTxtUrls.push({ name: rl.name, url: rl.url });
          }
          for (const yt of parsedLinks.youtubeUrls || []) {
            result.linksTxtYoutube.push(yt);
          }
          if (!result.linksTxtCustomTitle && parsedLinks.customTitle) {
            result.linksTxtCustomTitle = parsedLinks.customTitle;
          }
        } catch {
          // Ignore unreadable links.txt
        }
        continue;
      }

      if (ext === ".pptx" || ext === ".ppt" || ext === ".pdf") {
        result.slideFiles.push({ relPath, depth, inDraft, ext });
      } else if (ext === ".py") {
        result.pyFiles.push({
          relPath,
          depth,
          inDraft,
          score: scorePythonEntryFile(fullPath, relPath, depth, inDraft),
        });
      } else if (ext === ".html" || ext === ".htm") {
        result.htmlFiles.push({
          relPath,
          depth,
          inDraft,
          rank: scoreHtmlEntryFile(relPath, depth, inDraft),
        });
      } else if (ext === ".exe" && !IGNORED_EXE_REGEX.test(name)) {
        result.exeFiles.push({ relPath, depth, inDraft });
      } else if (ext === ".yyp") {
        result.yypFiles.push({ relPath, depth, inDraft });
      } else if (ext === ".yyz" && !lower.endsWith("_gamemaker.yyz")) {
        result.yyzFiles.push({ relPath, depth, inDraft });
      } else if (ext === ".sb3") {
        result.sb3Files.push({ relPath, depth, inDraft });
      } else if (ext === ".mp4" || ext === ".webm" || ext === ".mov") {
        result.videoFiles.push({ relPath, depth, inDraft });
      }
    }
  };

  walk(studentRootDir, 0, false);

  result.slideFiles.sort((a, b) => {
    const draftCmp = Number(a.inDraft) - Number(b.inDraft);
    if (draftCmp !== 0) return draftCmp;
    const extRank = (e: string) => (e === ".pptx" ? 0 : e === ".ppt" ? 1 : 2);
    return (
      extRank(a.ext) - extRank(b.ext) ||
      a.depth - b.depth ||
      a.relPath.localeCompare(b.relPath, "en", { numeric: true })
    );
  });

  result.pyFiles.sort(
    (a, b) => b.score - a.score || a.relPath.localeCompare(b.relPath, "en", { numeric: true })
  );
  result.htmlFiles.sort(
    (a, b) => a.rank - b.rank || a.relPath.localeCompare(b.relPath, "en", { numeric: true })
  );
  const sortSimple = (a: { depth: number; inDraft: boolean; relPath: string }, b: { depth: number; inDraft: boolean; relPath: string }) =>
    Number(a.inDraft) - Number(b.inDraft) ||
    a.depth - b.depth ||
    a.relPath.localeCompare(b.relPath, "en", { numeric: true });
  result.exeFiles.sort(sortSimple);
  result.yypFiles.sort(sortSimple);
  result.yyzFiles.sort(sortSimple);
  result.sb3Files.sort(sortSimple);
  result.videoFiles.sort(sortSimple);

  return result;
}

function safeParseJsonArray<T>(rawJson: string | undefined | null): T[] {
  if (!rawJson) return [];
  try {
    const parsed = JSON.parse(rawJson);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function resolveSlideForStudent(
  scanned: ScannedStudentFiles,
  mergedLinks: Array<{ name: string; url: string }>,
  override?: DemoDayStudentOverride
): DemoSlideSource {
  if (override?.slideUrl) {
    const meta = detectSlideLinkMeta({ name: "Canva", url: override.slideUrl });
    return {
      kind: meta?.kind || "WEB_SLIDE",
      label: meta?.label || "Slide Online",
      url: override.slideUrl,
    };
  }

  if (override?.slideRelPath) {
    const matched = scanned.slideFiles.find((f) => f.relPath === override.slideRelPath);
    if (matched) {
      return {
        kind: matched.ext === ".pdf" ? "LOCAL_PDF" : "LOCAL_PPTX",
        label: path.basename(matched.relPath),
        relPath: matched.relPath,
      };
    }
  }

  // Prefer online Canva -> Google Slides -> other web slide links
  const onlineCandidates: Array<{ kind: "CANVA" | "GOOGLE_SLIDES" | "WEB_SLIDE"; label: string; url: string; priority: number }> = [];
  for (const link of mergedLinks) {
    const meta = detectSlideLinkMeta(link);
    if (!meta) continue;
    const priority = meta.kind === "CANVA" ? 0 : meta.kind === "GOOGLE_SLIDES" ? 1 : 2;
    onlineCandidates.push({ ...meta, url: link.url, priority });
  }
  if (onlineCandidates.length > 0) {
    onlineCandidates.sort((a, b) => a.priority - b.priority);
    const best = onlineCandidates[0];
    return { kind: best.kind, label: best.label, url: best.url };
  }

  if (scanned.slideFiles.length > 0) {
    const first = scanned.slideFiles[0];
    return {
      kind: first.ext === ".pdf" ? "LOCAL_PDF" : "LOCAL_PPTX",
      label: path.basename(first.relPath),
      relPath: first.relPath,
    };
  }

  return { kind: "MISSING", label: "Chưa có Slide" };
}

async function resolveProductsForStudent(params: {
  studentRootDir: string;
  trackCategory: DemoTrackCategory;
  scanned: ScannedStudentFiles;
  mergedLinks: Array<{ name: string; url: string }>;
  mergedYoutube: string[];
  override?: DemoDayStudentOverride;
}): Promise<{
  product: DemoProductSource;
  entryOptions: DemoEntryOption[];
  selectedEntryValue: string;
}> {
  const { studentRootDir, trackCategory, scanned, mergedLinks, mergedYoutube, override } = params;
  const options: DemoEntryOption[] = [];
  const previewUrlByRelPath = new Map<string, string>();
  const seenValues = new Set<string>();

  const pushOption = (opt: DemoEntryOption) => {
    if (seenValues.has(opt.value)) return;
    seenValues.add(opt.value);
    options.push(opt);
  };

  const addPythonOptions = () => {
    for (const f of scanned.pyFiles) {
      pushOption({
        value: encodeDemoEntryOption("file", f.relPath),
        label: f.relPath,
        kind: "PYTHON",
      });
    }
  };

  const addWebOptions = async () => {
    for (const f of scanned.htmlFiles) {
      if (studentRootDir) {
        try {
          const prev = await ensureStudentWebPreviewUrl(studentRootDir, f.relPath);
          previewUrlByRelPath.set(f.relPath, prev);
        } catch {
          // Ignore preview register error
        }
      }
      pushOption({
        value: encodeDemoEntryOption("file", f.relPath),
        label: f.relPath,
        kind: "WEB_LOCAL",
      });
    }
    for (const l of mergedLinks) {
      if (detectSlideLinkMeta(l)) continue;
      const cls = classifySpckRelatedLink(l);
      if (cls.category === "LIVE_PRODUCT") {
        let labelHost = "Web Online";
        try {
          labelHost = new URL(l.url).hostname.replace(/^www\./, "");
        } catch {}
        pushOption({
          value: encodeDemoEntryOption("url", l.url),
          label: `${labelHost} (Web)`,
          kind: "WEB_URL",
        });
      }
    }
  };

  const addGameMakerOptions = () => {
    for (const f of scanned.exeFiles) {
      pushOption({
        value: encodeDemoEntryOption("file", f.relPath),
        label: `${f.relPath} (Chạy ngay)`,
        kind: "GAMEMAKER_EXE",
      });
    }
    for (const f of scanned.yypFiles) {
      pushOption({
        value: encodeDemoEntryOption("file", f.relPath),
        label: f.relPath,
        kind: "GAMEMAKER_YYP",
      });
    }
    for (const f of scanned.yyzFiles) {
      pushOption({
        value: encodeDemoEntryOption("file", f.relPath),
        label: f.relPath,
        kind: "GAMEMAKER_YYZ",
      });
    }
  };

  const addFallbackOptions = () => {
    for (const f of scanned.sb3Files) {
      pushOption({
        value: encodeDemoEntryOption("file", f.relPath),
        label: f.relPath,
        kind: "SCRATCH_SB3",
      });
    }
    for (const f of scanned.videoFiles) {
      pushOption({
        value: encodeDemoEntryOption("file", f.relPath),
        label: f.relPath,
        kind: "LOCAL_VIDEO",
      });
    }
    for (const yt of mergedYoutube) {
      pushOption({
        value: encodeDemoEntryOption("url", yt),
        label: "Video YouTube",
        kind: "YOUTUBE_URL",
      });
    }
  };

  if (trackCategory === "WEB") {
    await addWebOptions();
    addPythonOptions();
    addGameMakerOptions();
    addFallbackOptions();
  } else if (trackCategory === "GAMEMAKER") {
    addGameMakerOptions();
    addPythonOptions();
    await addWebOptions();
    addFallbackOptions();
  } else if (trackCategory === "SCRATCH" || trackCategory === "ROBOTICS") {
    addFallbackOptions();
    addPythonOptions();
    await addWebOptions();
    addGameMakerOptions();
  } else {
    // PYTHON or OTHER
    addPythonOptions();
    await addWebOptions();
    addGameMakerOptions();
    addFallbackOptions();
  }

  let selectedOpt: DemoEntryOption | undefined;
  if (override?.productRelPath) {
    const targetVal = encodeDemoEntryOption("file", override.productRelPath);
    selectedOpt = options.find((o) => o.value === targetVal);
  } else if (override?.productLiveUrl) {
    const targetVal = encodeDemoEntryOption("url", override.productLiveUrl);
    selectedOpt = options.find((o) => o.value === targetVal);
  }
  if (!selectedOpt) {
    selectedOpt = options[0];
  }

  if (!selectedOpt) {
    return {
      product: { kind: "MISSING", label: "Chưa có sản phẩm" },
      entryOptions: options,
      selectedEntryValue: "",
    };
  }

  const parsed = parseDemoEntryOption(selectedOpt.value);
  let product: DemoProductSource;
  if (parsed?.type === "url") {
    product = {
      kind: selectedOpt.kind,
      label: selectedOpt.label,
      url: parsed.target,
    };
  } else {
    const relPath = parsed?.target || selectedOpt.label;
    const previewUrl =
      selectedOpt.kind === "WEB_LOCAL"
        ? previewUrlByRelPath.get(relPath)
        : undefined;
    product = {
      kind: selectedOpt.kind as DemoProductKind,
      label: selectedOpt.label,
      relPath,
      ...(previewUrl ? { previewUrl } : {}),
    };
  }

  return {
    product,
    entryOptions: options,
    selectedEntryValue: selectedOpt.value,
  };
}

function inferDisplayTrackCategory(
  classTrack: DemoTrackCategory,
  productKind: DemoProductKind
): DemoTrackCategory {
  if (productKind === "PYTHON") return "PYTHON";
  if (productKind === "WEB_LOCAL" || productKind === "WEB_URL") return "WEB";
  if (
    productKind === "GAMEMAKER_EXE" ||
    productKind === "GAMEMAKER_YYP" ||
    productKind === "GAMEMAKER_YYZ"
  ) {
    return "GAMEMAKER";
  }
  if (productKind === "SCRATCH_SB3") return "SCRATCH";
  if (productKind === "LOCAL_VIDEO" || productKind === "YOUTUBE_URL") {
    return classTrack === "ROBOTICS" ? "ROBOTICS" : classTrack;
  }
  return classTrack;
}

async function buildInspectedStudentsForClass(
  classId: string,
  courseName?: string
): Promise<{
  targets: InternalStudentDemoTarget[];
  order: string[];
  currentStudentId: string;
  completedStudentIds: string[];
  rowVer: number;
}> {
  const coursePrefix = detectCoursePrefixFromClassId(classId);
  const classTrack = resolveDemoTrackCategory(coursePrefix, courseName);

  const savedSession = demoDayRepo.findByClass(classId);
  const savedOrder = safeParseJsonArray<string>(savedSession?.orderJson);
  const completedIds = safeParseJsonArray<string>(savedSession?.completedStudentIdsJson);
  const completedSet = new Set(completedIds);

  let overrides: Record<string, DemoDayStudentOverride> = {};
  try {
    const parsed = JSON.parse(savedSession?.overridesJson || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      overrides = parsed as Record<string, DemoDayStudentOverride>;
    }
  } catch {
    overrides = {};
  }

  const roster = listStudents(classId, { activeOnly: true });
  const uploads = spckUploadRepo.findByClass(classId);
  const uploadMap = new Map(uploads.map((u) => [u.studentId, u]));

  const defaultClassFolder = resolveDefaultSpckClassFolder(classId, {
    createIfMissing: false,
  });

  const targets: InternalStudentDemoTarget[] = [];

  for (const stu of roster) {
    const upload = uploadMap.get(stu.studentId);
    const sessByNum = spckSessionRepo.findByStudent(classId, stu.studentId);
    const s14 = sessByNum["14"];
    const s13 = sessByNum["13"];
    const s12 = sessByNum["12"];

    const studentRootDir = resolveSafeStudentDirectory(
      [
        s14?.localFolderPath || "",
        s13?.localFolderPath || "",
        s12?.localFolderPath || "",
        upload?.localFolderPath || "",
      ],
      defaultClassFolder,
      stu.fullName,
      stu.studentId
    );

    const scanned = scanStudentFilesForDemo(studentRootDir);

    const thumbPath = resolveStudentThumbnailPath(studentRootDir, [
      s14?.thumbnailPath || "",
      s13?.thumbnailPath || "",
      s12?.thumbnailPath || "",
      upload?.thumbnailPath || "",
    ]);
    const thumbnailUrl = `/api/spck/thumbnail?path=${encodeURIComponent(thumbPath)}`;

    const linkSeen = new Set<string>();
    const mergedLinks: Array<{ name: string; url: string }> = [];
    const addLink = (name: string, url: string) => {
      const cleanUrl = String(url || "").trim();
      if (!cleanUrl || linkSeen.has(cleanUrl)) return;
      linkSeen.add(cleanUrl);
      mergedLinks.push({ name: String(name || cleanUrl), url: cleanUrl });
    };

    for (const rawJson of [
      s14?.relatedLinksJson,
      s13?.relatedLinksJson,
      s12?.relatedLinksJson,
      upload?.relatedLinksJson,
    ]) {
      for (const item of safeParseJsonArray<{ name?: string; url?: string }>(rawJson)) {
        if (item?.url) addLink(item.name || item.url, item.url);
      }
    }
    for (const item of scanned.linksTxtUrls) {
      addLink(item.name, item.url);
    }

    const ytSeen = new Set<string>();
    const mergedYoutube: string[] = [];
    const addYt = (u: string) => {
      const clean = String(u || "").trim();
      if (!clean || ytSeen.has(clean)) return;
      ytSeen.add(clean);
      mergedYoutube.push(clean);
    };
    for (const rawJson of [
      s14?.youtubeUrlsJson,
      s13?.youtubeUrlsJson,
      s12?.youtubeUrlsJson,
      upload?.youtubeUrlsJson,
    ]) {
      for (const yt of safeParseJsonArray<string>(rawJson)) {
        addYt(yt);
      }
    }
    for (const yt of scanned.linksTxtYoutube) {
      addYt(yt);
    }

    const override = overrides[stu.studentId];
    const slide = resolveSlideForStudent(scanned, mergedLinks, override);
    const { product, entryOptions, selectedEntryValue } =
      await resolveProductsForStudent({
        studentRootDir,
        trackCategory: classTrack,
        scanned,
        mergedLinks,
        mergedYoutube,
        override,
      });

    const rawTitle =
      override?.customTitle ||
      s14?.projectTitle ||
      s13?.projectTitle ||
      s12?.projectTitle ||
      upload?.projectTitle ||
      scanned.linksTxtCustomTitle ||
      "";

    const projectTitle = cleanDemoProjectTitle(rawTitle, stu.fullName);
    const displayTrack = inferDisplayTrackCategory(classTrack, product.kind);

    targets.push({
      studentId: stu.studentId,
      fullName: stu.fullName,
      studentRootDir,
      item: {
        studentId: stu.studentId,
        fullName: stu.fullName,
        projectTitle,
        trackCategory: displayTrack,
        trackBadge: getDemoTrackBadge(displayTrack),
        thumbnailUrl,
        hasFolder: Boolean(studentRootDir),
        excluded: Boolean(override?.excluded),
        completed: completedSet.has(stu.studentId),
        slide,
        product,
        entryOptions,
        selectedEntryValue,
        hasGameMakerArchive:
          scanned.yyzFiles.length > 0 || scanned.yypFiles.length > 0,
      },
    });
  }

  const rosterIds = targets.map((t) => t.studentId);
  const order = reconcileDemoOrder(savedOrder, rosterIds, overrides);
  const sortedItems = sortDemoStudentsByOrder(
    targets.map((t) => t.item),
    order
  );

  const targetById = new Map(targets.map((t) => [t.studentId, t]));
  const sortedTargets = sortedItems
    .map((it) => targetById.get(it.studentId)!)
    .filter(Boolean);

  let currentStudentId = String(savedSession?.currentStudentId || "").trim();
  if (!order.includes(currentStudentId)) {
    currentStudentId =
      sortedItems.find((s) => !s.excluded)?.studentId || order[0] || "";
  }

  return {
    targets: sortedTargets,
    order,
    currentStudentId,
    completedStudentIds: completedIds.filter((id) => order.includes(id)),
    rowVer: Number(savedSession?.rowVer || 0),
  };
}

export class DemoDayClassNotFoundError extends Error {
  constructor(classId: string) {
    super(`Không tìm thấy lớp '${classId}' trong danh sách lớp.`);
    this.name = "DemoDayClassNotFoundError";
  }
}

function resolveClassDirectoryContext(requestedRaw?: string) {
  const requested = String(requestedRaw || "").trim().toUpperCase();
  const includeSynthetic = Boolean(requested && isSyntheticClassCode(requested));

  const { classes: spckClasses, allClassesMap } = queryClassDirectory({
    scope: "spck",
    minSessionNumber: 12,
    includeSynthetic,
  });

  const allDirectory =
    spckClasses.length === 0 || (requested && !allClassesMap.has(requested))
      ? queryClassDirectory({ scope: "all", includeSynthetic })
      : null;

  const mergedClasses =
    spckClasses.length > 0
      ? spckClasses
      : allDirectory?.classes || [];

  let targetClassId = "";
  if (requested) {
    const existsInDir =
      allClassesMap.has(requested) ||
      Boolean(allDirectory?.allClassesMap.has(requested)) ||
      listStudents(requested, { activeOnly: true }).length > 0;
    if (!existsInDir) {
      throw new DemoDayClassNotFoundError(requested);
    }
    targetClassId = requested;
  } else {
    targetClassId = mergedClasses[0]?.classId || "";
  }

  const classMeta =
    allClassesMap.get(targetClassId) ||
    allDirectory?.allClassesMap.get(targetClassId);

  return { targetClassId, classMeta, mergedClasses };
}

export async function inspectClassDemoDayState(
  requestedClassId?: string
): Promise<DemoDayClassStateResponse> {
  const { targetClassId, classMeta, mergedClasses } =
    resolveClassDirectoryContext(requestedClassId);

  const runningClasses = mergedClasses.map((c) => ({
    classId: c.classId,
    classCode: c.classCode,
    className: c.className,
    courseName: c.courseName,
    status: c.status,
    currentSessionNumber: c.currentSessionNumber,
    maxSessionNumber: c.maxSessionNumber,
  }));

  if (!targetClassId) {
    return {
      classId: "",
      className: "",
      coursePrefix: null,
      runningClasses,
      demoSheetUrl: "",
      order: [],
      currentStudentId: "",
      completedStudentIds: [],
      rowVer: 0,
      activeProcessCount: getActiveDemoProcessCount(),
      hasAnyGameMakerProject: false,
      students: [],
    };
  }

  const inspected = await buildInspectedStudentsForClass(
    targetClassId,
    classMeta?.courseName
  );
  const sheetMeta = getClassDemoSheetMeta(targetClassId);

  return {
    classId: targetClassId,
    className: classMeta?.className || targetClassId,
    coursePrefix: detectCoursePrefixFromClassId(targetClassId),
    runningClasses,
    demoSheetUrl: sheetMeta?.latestDemoSheetUrl || "",
    order: inspected.order,
    currentStudentId: inspected.currentStudentId,
    completedStudentIds: inspected.completedStudentIds,
    rowVer: inspected.rowVer,
    activeProcessCount: getActiveDemoProcessCount(),
    hasAnyGameMakerProject: inspected.targets.some(
      (t) => t.item.hasGameMakerArchive
    ),
    students: inspected.targets.map((t) => t.item),
  };
}

export async function resolveStudentDemoLaunchTargets(
  classId: string
): Promise<InternalStudentDemoTarget[]> {
  const normalized = String(classId || "").trim().toUpperCase();
  if (!normalized) {
    throw new DemoDayClassNotFoundError(normalized);
  }
  const { targetClassId, classMeta } = resolveClassDirectoryContext(normalized);
  const inspected = await buildInspectedStudentsForClass(
    targetClassId,
    classMeta?.courseName
  );
  return inspected.targets;
}
