/**
 * MINDX AUTOMATION BOT - SPCK YOUTUBE IMPORT FOR ROBOTICS CLASSES (v2.7.2)
 * Robotics final products usually have NO source files — only a YouTube presentation video.
 *
 * Flow:
 * 1. Owner pastes ONE class playlist link (`youtube.com/playlist?list=...`, mobile links included)
 *    and/or single video links (optionally prefixed with the student's name: `Minh Khang - https://youtu.be/...`).
 * 2. The bot reads every video + title in the playlist, strips the class code from the title
 *    (`SB28-Gia Bách`, `Minh Phi - SB28`) and matches it to the LMS student list.
 * 3. For every confident, unique match it:
 *    - puts the student's own video link into "YouTube URL",
 *    - extracts EXACTLY 2 HD 16:9 frames of the student presenting (YouTube auto frames at
 *      different moments of the video; the video cover image as last resort — plain HTTP downloads,
 *      no browser is opened on YouTube) into the gallery,
 *    - keeps the Owner-uploaded Thumbnail, otherwise sets the MindX logo as Thumbnail
 *      (YouTube frames are NEVER used as Thumbnail).
 * Ambiguous / duplicate / unmatched videos are reported and never applied automatically.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  getDb,
  spckSessionRepo,
  spckUploadRepo,
  studentRepo,
  type SpckSessionSlotNumber,
} from "../db/sqlite";
import { assertPathAllowed } from "../security/path-allowlist";
import {
  calculateNameSimilarity,
  normalizeVietnameseName,
} from "../utils/vietnamese-match";
import {
  OWNER_UPLOADS_SUBDIR,
  YOUTUBE_FRAMES_SUBDIR,
  listOwnerUploadedImages,
} from "./spck-app-screenshotter";
import { normalizeImagesToLms16x9 } from "./spck-image-normalizer";
import {
  DEFAULT_SPCK_THUMBNAIL_PATH,
  MAX_SPCK_SCREENSHOTS,
  findOwnerProvidedRootPhotos,
} from "./spck-scanner";

export const YOUTUBE_FRAMES_PER_STUDENT = 2;
const YT_FETCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
  Cookie: "CONSENT=YES+1",
};

// ---------------------------------------------------------------------------
// 1. Parsing the Owner's input
// ---------------------------------------------------------------------------

export function extractYoutubeVideoId(rawUrl: string): string | null {
  const s = String(rawUrl || "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    const host = u.hostname.toLowerCase().replace(/^www\.|^m\.|^music\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0] || "";
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtube-nocookie.com") {
      const v = u.searchParams.get("v");
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1];
    }
  } catch {
    // not a URL
  }
  return null;
}

export function extractYoutubePlaylistId(rawUrl: string): string | null {
  const s = String(rawUrl || "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    const host = u.hostname.toLowerCase().replace(/^www\.|^m\.|^music\./, "");
    if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be") {
      const list = u.searchParams.get("list");
      if (list && /^[A-Za-z0-9_-]{10,64}$/.test(list)) return list;
    }
  } catch {
    // not a URL
  }
  return null;
}

export function buildYoutubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export interface ParsedYoutubeImportInput {
  playlistIds: string[];
  videos: Array<{ videoId: string; url: string; nameHint?: string }>;
  invalidLines: string[];
}

/**
 * Parses free text pasted by the Owner. Each line may contain:
 * - a playlist link (`playlist?list=...`) → every video in the playlist is imported,
 * - a single video link, optionally with the student's name before/after it
 *   (`Minh Khang - https://youtu.be/xxxx`).
 */
export function parseYoutubeImportInput(raw: string): ParsedYoutubeImportInput {
  const result: ParsedYoutubeImportInput = { playlistIds: [], videos: [], invalidLines: [] };
  const lines = String(raw || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    const urlMatches = line.match(/https?:\/\/[^\s<>"']+/gi) || [];
    if (urlMatches.length === 0) {
      result.invalidLines.push(line);
      continue;
    }
    let consumed = false;
    for (const rawUrl of urlMatches) {
      const videoId = extractYoutubeVideoId(rawUrl);
      const playlistId = extractYoutubePlaylistId(rawUrl);
      if (videoId) {
        const nameHint = line
          .replace(rawUrl, " ")
          .replace(/https?:\/\/[^\s<>"']+/gi, " ")
          .replace(/[|:;,\-–—>\t]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (!result.videos.some((v) => v.videoId === videoId)) {
          result.videos.push({
            videoId,
            url: buildYoutubeWatchUrl(videoId),
            nameHint: nameHint || undefined,
          });
        }
        consumed = true;
      } else if (playlistId) {
        if (!result.playlistIds.includes(playlistId)) result.playlistIds.push(playlistId);
        consumed = true;
      }
    }
    if (!consumed) result.invalidLines.push(line);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 2. Reading playlist videos & video titles from YouTube
// ---------------------------------------------------------------------------

function extractYtInitialData(html: string): any | null {
  const markers = ["var ytInitialData = ", "window[\"ytInitialData\"] = ", "ytInitialData = "];
  for (const marker of markers) {
    const start = html.indexOf(marker);
    if (start === -1) continue;
    const jsonStart = start + marker.length;
    const end = html.indexOf(";</script>", jsonStart);
    if (end === -1) continue;
    try {
      return JSON.parse(html.slice(jsonStart, end));
    } catch {
      // try next marker
    }
  }
  return null;
}

function collectPlaylistVideosFromData(data: any): Array<{ videoId: string; title: string }> {
  const out: Array<{ videoId: string; title: string }> = [];
  const seen = new Set<string>();
  const walk = (node: any, depth: number) => {
    if (!node || typeof node !== "object" || depth > 40) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    // New layout (2025+): lockupViewModel
    const lockup = node.lockupViewModel;
    if (lockup && typeof lockup === "object") {
      const vid = String(lockup.contentId || "");
      const title = String(lockup?.metadata?.lockupMetadataViewModel?.title?.content || "");
      const ctype = String(lockup.contentType || "");
      if (
        /^[A-Za-z0-9_-]{11}$/.test(vid) &&
        (!ctype || ctype.includes("VIDEO")) &&
        !seen.has(vid)
      ) {
        seen.add(vid);
        out.push({ videoId: vid, title });
      }
    }
    // Classic layout: playlistVideoRenderer
    const pvr = node.playlistVideoRenderer;
    if (pvr && typeof pvr === "object") {
      const vid = String(pvr.videoId || "");
      const title = String(pvr?.title?.runs?.[0]?.text || pvr?.title?.simpleText || "");
      if (/^[A-Za-z0-9_-]{11}$/.test(vid) && !seen.has(vid)) {
        seen.add(vid);
        out.push({ videoId: vid, title });
      }
    }
    for (const key of Object.keys(node)) {
      if (key === "lockupViewModel" || key === "playlistVideoRenderer") continue;
      walk(node[key], depth + 1);
    }
  };
  walk(data?.contents, 0);
  return out;
}

export async function fetchYoutubePlaylistVideos(playlistId: string): Promise<{
  playlistId: string;
  playlistTitle: string;
  videos: Array<{ videoId: string; title: string }>;
}> {
  const url = `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}&hl=vi`;
  const res = await fetch(url, { headers: YT_FETCH_HEADERS });
  if (!res.ok) {
    throw new Error(`Không đọc được danh sách phát YouTube (HTTP ${res.status}).`);
  }
  const html = await res.text();
  const data = extractYtInitialData(html);
  if (!data) {
    throw new Error("Không đọc được dữ liệu danh sách phát YouTube (playlist riêng tư hoặc không tồn tại).");
  }
  const alerts = JSON.stringify(data.alerts || []);
  const videos = collectPlaylistVideosFromData(data);
  if (videos.length === 0 && /(private|riêng tư|không có|does not exist|unavailable)/i.test(alerts)) {
    throw new Error("Danh sách phát YouTube đang ở chế độ riêng tư hoặc không tồn tại. Vui lòng để chế độ Công khai / Không công khai.");
  }
  const playlistTitle = String(
    data?.metadata?.playlistMetadataRenderer?.title ||
      data?.header?.pageHeaderRenderer?.pageTitle ||
      data?.header?.playlistHeaderRenderer?.title?.simpleText ||
      ""
  );
  return { playlistId, playlistTitle, videos };
}

export async function fetchYoutubeVideoTitle(videoId: string): Promise<string> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(buildYoutubeWatchUrl(videoId))}`,
      { headers: YT_FETCH_HEADERS }
    );
    if (!res.ok) return "";
    const json = (await res.json()) as { title?: string };
    return String(json?.title || "");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// 3. Matching video titles to LMS students
// ---------------------------------------------------------------------------

const TITLE_STOP_BIGRAMS = [
  "san pham",
  "cuoi khoa",
  "thuyet trinh",
  "trinh bay",
  "hoc vien",
  "hoc sinh",
  "bai tap",
  "final project",
];
// Only words that can never be part of a Vietnamese personal name (V272-F01: "Thế", "Văn", "Con",
// "Em", "Bản", "An"... are NOT removed because they can be real name tokens).
const TITLE_STOP_WORDS = new Set([
  "spck",
  "robot",
  "robotics",
  "demo",
  "video",
  "final",
  "project",
  "mindx",
  "lop",
  "buoi",
  "nhom",
  "team",
  "hv",
  "hs",
  "sp",
]);

function stripClassCodeAndDigitTokens(title: string, classId: string): string[] {
  const classTokens = normalizeVietnameseName(classId).split(" ").filter(Boolean);
  return normalizeVietnameseName(title)
    .split(" ")
    .filter(Boolean)
    .filter((t) => !/\d/.test(t))
    .filter((t) => !classTokens.includes(t));
}

/**
 * Extracts the student's name part from a video title, removing the class code (`SB28`, `VT-C4K-SB28`),
 * generic words (`SPCK`, `Robot`, `Demo`, `Sản phẩm cuối khóa`...) and any token containing digits.
 */
export function extractStudentNameFromVideoTitle(title: string, classId: string): string {
  let norm = ` ${stripClassCodeAndDigitTokens(title, classId).join(" ")} `;
  for (const bigram of TITLE_STOP_BIGRAMS) {
    norm = norm.replace(new RegExp(` ${bigram} `, "g"), " ");
  }
  const tokens = norm
    .split(" ")
    .filter(Boolean)
    .filter((t) => !TITLE_STOP_WORDS.has(t));
  return tokens.join(" ").trim();
}

/** 1.0 when the student's FULL name (≥ 2 tokens) appears contiguously in the title, else 0. */
function fullNameContainmentScore(rawTokens: string[], studentFullName: string): number {
  const stuTokens = normalizeVietnameseName(studentFullName).split(" ").filter(Boolean);
  if (stuTokens.length < 2 || rawTokens.length < stuTokens.length) return 0;
  for (let i = 0; i + stuTokens.length <= rawTokens.length; i++) {
    let ok = true;
    for (let j = 0; j < stuTokens.length; j++) {
      if (rawTokens[i + j] !== stuTokens[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return 1.0;
  }
  return 0;
}

function scoreNameAgainstStudent(nameNorm: string, studentFullName: string): number {
  const nameTokens = nameNorm.split(" ").filter(Boolean);
  const stuTokens = normalizeVietnameseName(studentFullName).split(" ").filter(Boolean);
  if (nameTokens.length === 0 || stuTokens.length === 0) return 0;
  if (nameTokens.join(" ") === stuTokens.join(" ")) return 1.0;
  // Suffix match: "gia bach" ↔ "nguyen gia bach"; "bach" ↔ "nguyen gia bach"
  if (nameTokens.length <= stuTokens.length) {
    const tail = stuTokens.slice(stuTokens.length - nameTokens.length).join(" ");
    if (tail === nameTokens.join(" ")) {
      return nameTokens.length >= 2 ? 0.95 : 0.85;
    }
  }
  const given = stuTokens[stuTokens.length - 1];
  const allIn = nameTokens.every((t) => stuTokens.includes(t));
  if (allIn && nameTokens.includes(given)) return 0.8;
  return Math.min(0.75, calculateNameSimilarity(nameNorm, studentFullName) * 0.9);
}

export interface YoutubeStudentMatch {
  videoId: string;
  url: string;
  videoTitle: string;
  extractedName: string;
  studentId: string;
  fullName: string;
  matchScore: number;
  status: "MATCHED" | "AMBIGUOUS" | "UNMATCHED" | "CONFLICT";
  message?: string;
  candidates: Array<{ studentId: string; fullName: string; matchScore: number }>;
}

export function matchYoutubeVideosToStudents(
  videos: Array<{ videoId: string; url: string; title: string; nameHint?: string }>,
  students: Array<{ studentId: string; fullName: string }>,
  classId: string
): YoutubeStudentMatch[] {
  const prelim: YoutubeStudentMatch[] = videos.map((v) => {
    const source = v.nameHint && v.nameHint.trim() ? v.nameHint : v.title;
    const extractedName = extractStudentNameFromVideoTitle(source, classId);
    const rawTokens = stripClassCodeAndDigitTokens(source, classId);
    const ranked = students
      .map((s) => ({
        studentId: s.studentId,
        fullName: s.fullName,
        matchScore:
          Math.round(
            Math.max(
              fullNameContainmentScore(rawTokens, s.fullName),
              scoreNameAgainstStudent(extractedName, s.fullName)
            ) * 100
          ) / 100,
      }))
      .sort((a, b) => b.matchScore - a.matchScore || a.fullName.localeCompare(b.fullName));
    const top = ranked[0];
    const second = ranked[1];
    const base = {
      videoId: v.videoId,
      url: v.url,
      videoTitle: v.title,
      extractedName,
      candidates: ranked.slice(0, 3),
    };
    if (!top || top.matchScore < 0.8) {
      return {
        ...base,
        studentId: "",
        fullName: "",
        matchScore: top?.matchScore ?? 0,
        status: "UNMATCHED" as const,
        message: `Không tìm thấy học viên khớp với tên "${extractedName || source}". Vui lòng ghi "Tên học viên - link" để bot gắn đúng.`,
      };
    }
    if (second && Math.abs(second.matchScore - top.matchScore) < 0.001) {
      return {
        ...base,
        studentId: "",
        fullName: "",
        matchScore: top.matchScore,
        status: "AMBIGUOUS" as const,
        message: `Tên "${extractedName}" khớp với nhiều học viên (${ranked
          .filter((r) => Math.abs(r.matchScore - top.matchScore) < 0.001)
          .map((r) => r.fullName)
          .join(", ")}). Vui lòng ghi đầy đủ họ tên trước link.`,
      };
    }
    return {
      ...base,
      studentId: top.studentId,
      fullName: top.fullName,
      matchScore: top.matchScore,
      status: "MATCHED" as const,
    };
  });

  // Two different videos pointing to the same student → do not apply either automatically
  const countByStudent = new Map<string, number>();
  for (const m of prelim) {
    if (m.status === "MATCHED") {
      countByStudent.set(m.studentId, (countByStudent.get(m.studentId) || 0) + 1);
    }
  }
  return prelim.map((m) =>
    m.status === "MATCHED" && (countByStudent.get(m.studentId) || 0) > 1
      ? {
          ...m,
          status: "CONFLICT" as const,
          message: `Có nhiều video cùng khớp học viên ${m.fullName}. Vui lòng ghi rõ "Tên học viên - link" cho từng video.`,
        }
      : m
  );
}

// ---------------------------------------------------------------------------
// 4. Extracting 2 presentation frames per video
// ---------------------------------------------------------------------------

async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { headers: YT_FETCH_HEADERS });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // YouTube placeholder "no image" frames are tiny (≈ 1 KB)
    return buf.length > 3000 ? buf : null;
  } catch {
    return null;
  }
}

/**
 * Downloads YouTube's own auto-generated frames of the video (taken at ~25%, ~50%, ~75% of the
 * video — never player buttons or ads), preferring HD `maxres` frames, and returns 2 distinct frames.
 */
async function fetchYoutubeAutoFrames(videoId: string): Promise<Buffer[]> {
  const base = `https://i.ytimg.com/vi/${videoId}`;
  const tiers = [
    ["maxres1.jpg", "maxres3.jpg", "maxres2.jpg"],
    ["sd1.jpg", "sd3.jpg", "sd2.jpg"],
    ["hq1.jpg", "hq3.jpg", "hq2.jpg"],
  ];
  const frames: Buffer[] = [];
  const hashes = new Set<string>();
  for (const tier of tiers) {
    for (const name of tier) {
      if (frames.length >= YOUTUBE_FRAMES_PER_STUDENT) break;
      const buf = await downloadImage(`${base}/${name}`);
      if (!buf) continue;
      const h = crypto.createHash("md5").update(buf).digest("hex");
      if (hashes.has(h)) continue;
      hashes.add(h);
      frames.push(buf);
    }
    if (frames.length >= YOUTUBE_FRAMES_PER_STUDENT) break;
  }
  return frames;
}

/**
 * Last-resort source when the video has fewer than 2 auto frames: YouTube's own cover images of
 * the video (`maxresdefault` / `sddefault` / `hqdefault`). Plain HTTP download only — no browser is
 * opened for YouTube (V272-F10: keeps Playwright discipline — the only browser contexts used by this
 * feature are the offline local image normalizer without any LMS session or network).
 */
async function fetchYoutubeCoverImages(videoId: string, existingHashes: Set<string>, needed: number): Promise<Buffer[]> {
  if (needed <= 0) return [];
  const out: Buffer[] = [];
  for (const name of ["maxresdefault.jpg", "sddefault.jpg", "hqdefault.jpg"]) {
    if (out.length >= needed) break;
    const buf = await downloadImage(`https://i.ytimg.com/vi/${videoId}/${name}`);
    if (!buf) continue;
    const h = crypto.createHash("md5").update(buf).digest("hex");
    if (existingHashes.has(h)) continue;
    existingHashes.add(h);
    out.push(buf);
    // Different cover sizes are usually the same picture — one cover is enough
    break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. Applying matches to SQLite (shared pool + active session draft)
// ---------------------------------------------------------------------------

export interface YoutubeImportStudentResult extends YoutubeStudentMatch {
  applied: boolean;
  frames: string[];
  thumbnailPath?: string;
  thumbnailIsOwnerPhoto?: boolean;
  syncedToSession?: boolean;
  frameSource?: "YOUTUBE_AUTO_FRAMES" | "YOUTUBE_COVER" | "MIXED" | "NONE";
}

export interface YoutubeImportResult {
  classId: string;
  sessionNumber: SpckSessionSlotNumber;
  playlists: Array<{ playlistId: string; playlistTitle: string; videoCount: number; error?: string }>;
  totalVideos: number;
  appliedCount: number;
  results: YoutubeImportStudentResult[];
  studentsWithoutVideo: Array<{ studentId: string; fullName: string }>;
  invalidLines: string[];
}

function resolveStudentYoutubeFolder(classId: string, studentId: string, existingFolder?: string): string {
  if (existingFolder) {
    try {
      const safe = assertPathAllowed(existingFolder);
      if (fs.existsSync(safe) && fs.statSync(safe).isDirectory()) return safe;
    } catch {
      // fall through to managed folder
    }
  }
  const safeClass = classId.replace(/[^A-Za-z0-9_-]+/g, "_");
  const safeStu = studentId.replace(/[^A-Za-z0-9_-]+/g, "_") || "student";
  const dir = assertPathAllowed(path.resolve(process.cwd(), "data", "spck_youtube", safeClass, safeStu));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Returns a lowercase text blob of every file path that must be KEPT on disk for this student:
 * the shared resource pool (`spck_uploads`), every session draft, and every approved / verified
 * snapshot. Called only AFTER the new data has been saved (V272-F02), so files that are still in use
 * anywhere are never deleted.
 */
function collectReferencedFileNames(
  classId: string,
  studentId: string,
  _targetSession: SpckSessionSlotNumber,
  _afterSave: boolean
): string | null {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT thumbnailPath, screenshotsJson, approvedSnapshotJson, lastVerifiedSnapshotJson
         FROM spck_session_submissions WHERE classId = ? AND studentId = ?`
      )
      .all(classId, studentId);
    const shared = db
      .prepare(`SELECT thumbnailPath, screenshotsJson FROM spck_uploads WHERE classId = ? AND studentId = ?`)
      .all(classId, studentId);
    return JSON.stringify([rows, shared]).toLowerCase();
  } catch {
    // If the reference check fails, keep everything (never delete blindly)
    return null;
  }
}

function isFileStillReferenced(blob: string | null, fileName: string): boolean {
  return blob === null || blob.includes(fileName.toLowerCase());
}

function parseJsonArray<T>(raw: string | null | undefined): T[] {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * Full Robotics import: parse input → read playlist(s) → match students → extract 2 frames →
 * update shared resources & sync the selected session draft (only when that session is not yet
 * approved / verified, so already-submitted sessions are never altered).
 */
export async function importYoutubeProductsForClass(params: {
  classId: string;
  sessionNumber: SpckSessionSlotNumber;
  input: string;
}): Promise<YoutubeImportResult> {
  const classId = String(params.classId || "").trim().toUpperCase();
  const sessionNumber = params.sessionNumber;
  const parsed = parseYoutubeImportInput(params.input);

  const playlists: YoutubeImportResult["playlists"] = [];
  const videoMap = new Map<string, { videoId: string; url: string; title: string; nameHint?: string }>();

  for (const plId of parsed.playlistIds) {
    try {
      const pl = await fetchYoutubePlaylistVideos(plId);
      playlists.push({ playlistId: plId, playlistTitle: pl.playlistTitle, videoCount: pl.videos.length });
      for (const v of pl.videos) {
        if (!videoMap.has(v.videoId)) {
          videoMap.set(v.videoId, { videoId: v.videoId, url: buildYoutubeWatchUrl(v.videoId), title: v.title });
        }
      }
    } catch (err) {
      playlists.push({
        playlistId: plId,
        playlistTitle: "",
        videoCount: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  for (const v of parsed.videos) {
    const existing = videoMap.get(v.videoId);
    const title = existing?.title || (await fetchYoutubeVideoTitle(v.videoId));
    videoMap.set(v.videoId, { videoId: v.videoId, url: v.url, title, nameHint: v.nameHint });
  }

  const students = studentRepo.findByClass(classId, true).map((s) => ({
    studentId: s.studentId,
    fullName: s.fullName,
  }));
  const matches = matchYoutubeVideosToStudents(Array.from(videoMap.values()), students, classId);

  // Extract frames for confident matches
  type Pending = { match: YoutubeStudentMatch; raw: Buffer[]; source: YoutubeImportStudentResult["frameSource"] };
  const pending: Pending[] = [];
  for (const m of matches) {
    if (m.status !== "MATCHED") continue;
    const auto = await fetchYoutubeAutoFrames(m.videoId);
    let source: YoutubeImportStudentResult["frameSource"] = auto.length > 0 ? "YOUTUBE_AUTO_FRAMES" : "NONE";
    let raw = auto;
    if (raw.length < YOUTUBE_FRAMES_PER_STUDENT) {
      const hashes = new Set(raw.map((b) => crypto.createHash("md5").update(b).digest("hex")));
      const extra = await fetchYoutubeCoverImages(m.videoId, hashes, YOUTUBE_FRAMES_PER_STUDENT - raw.length);
      if (extra.length > 0) {
        source = raw.length > 0 ? "MIXED" : "YOUTUBE_COVER";
        raw = [...raw, ...extra];
      }
    }
    pending.push({ match: m, raw: raw.slice(0, YOUTUBE_FRAMES_PER_STUDENT), source });
  }

  // Normalize every frame to LMS-safe 960×540 in a single local (offline) browser session
  const flatJobs = pending.flatMap((p) => p.raw.map((buffer) => ({ buffer, fit: "cover" as const })));
  const normalizedFlat = flatJobs.length > 0 ? await normalizeImagesToLms16x9(flatJobs) : [];
  let cursor = 0;

  const results: YoutubeImportStudentResult[] = [];
  for (const m of matches) {
    if (m.status !== "MATCHED") {
      results.push({ ...m, applied: false, frames: [] });
    }
  }

  const ytFrameDirRe = new RegExp(`[\\\\/]${YOUTUBE_FRAMES_SUBDIR}[\\\\/]`, "i");
  const samePath = (a: string, b: string) =>
    path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

  for (const p of pending) {
    const m = p.match;
    const studentId = String(m.studentId || "");
    const normalizedFrames = p.raw.map((orig) => normalizedFlat[cursor++] || orig);
    const createdFrameFiles: string[] = [];
    const rollbackCreatedFrames = () => {
      if (createdFrameFiles.length === 0) return;
      let blob: string | null = "";
      try {
        blob = collectReferencedFileNames(classId, studentId, sessionNumber, true);
      } catch {
        blob = "";
      }
      for (const filePath of createdFrameFiles) {
        if (!isFileStillReferenced(blob, path.basename(filePath))) {
          try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          } catch {
            // ignore
          }
        }
      }
    };
    try {
      const existing = spckUploadRepo.findOne(classId, studentId);
      const folder = resolveStudentYoutubeFolder(classId, studentId, existing?.localFolderPath);
      const framesDir = assertPathAllowed(path.join(folder, YOUTUBE_FRAMES_SUBDIR));

      // 1. Plan new frame files (names are content hashes) WITHOUT touching the disk yet
      const plannedFrames = normalizedFrames.map((buf, idx) => {
        const isPng = buf[0] === 0x89 && buf[1] === 0x50;
        const hash6 = crypto.createHash("md5").update(buf).digest("hex").slice(0, 6);
        return {
          buf,
          outPath: assertPathAllowed(
            path.join(framesDir, `yt_${m.videoId}_${idx + 1}_${hash6}.${isPng ? "png" : "jpg"}`)
          ),
        };
      });
      const framePaths = plannedFrames.map((f) => f.outPath);

      // 2. Thumbnail: Owner photo (upload / root photo) or MindX logo — never a YouTube frame
      const ownerUploads = listOwnerUploadedImages(folder);
      const ownerRootPhotos = findOwnerProvidedRootPhotos(folder);
      const ownerThumb =
        ownerUploads.find((p2) => /^thumb_/i.test(path.basename(p2))) ||
        ownerUploads[0] ||
        ownerRootPhotos[0] ||
        "";
      const existingThumb = existing?.thumbnailPath || "";
      const existingThumbIsOwner =
        Boolean(existingThumb) &&
        new RegExp(`[\\\\/]${OWNER_UPLOADS_SUBDIR}[\\\\/]`, "i").test(existingThumb) &&
        fs.existsSync(existingThumb);
      const thumbnailPath = ownerThumb || (existingThumbIsOwner ? existingThumb : DEFAULT_SPCK_THUMBNAIL_PATH);
      const thumbnailIsOwnerPhoto = thumbnailPath !== DEFAULT_SPCK_THUMBNAIL_PATH;

      // 3. Gallery: 2 presentation frames, then ALL Owner photos (uploads + root photos), then other
      //    previous non-auto images — limit checked BEFORE any file is written or deleted (V272-F02/F05)
      const prevScreens = parseJsonArray<string>(existing?.screenshotsJson).filter(
        (s) => !ytFrameDirRe.test(s) && !/[\\/]_spck_app_shots[\\/]/i.test(s)
      );
      const gallery: string[] = [];
      for (const s of [...framePaths, ...ownerUploads, ...ownerRootPhotos, ...prevScreens]) {
        if (!s || samePath(s, thumbnailPath) || gallery.some((g) => samePath(g, s))) continue;
        gallery.push(s);
      }
      if (gallery.length > MAX_SPCK_SCREENSHOTS) {
        throw new Error(
          `Học viên có ${gallery.length} ảnh bổ sung (2 ảnh thuyết trình + ảnh Owner), vượt giới hạn ${MAX_SPCK_SCREENSHOTS} ảnh của LMS. Vui lòng bỏ bớt ảnh Owner rồi nhập lại; ảnh cũ được giữ nguyên.`
        );
      }

      // 4. Write new frames and record which files were actually created by this import run (V272-R2-03)
      fs.mkdirSync(framesDir, { recursive: true });
      for (const f of plannedFrames) {
        if (!fs.existsSync(f.outPath)) {
          fs.writeFileSync(f.outPath, f.buf);
          createdFrameFiles.push(f.outPath);
        }
      }

      // 5. Save to DB atomically (shared pool + selected session draft if not approved/verified)
      const saveImportToDb = getDb().transaction(() => {
        if (!existing) {
          spckUploadRepo.upsert({
            classId,
            studentId,
            localFolderPath: folder,
            matchScore: m.matchScore,
            isConfirmedByTeacher: 1,
            projectTitle: `SPCK ${m.fullName}`,
            baseProjectTitle: `SPCK ${m.fullName}`,
            thumbnailPath: DEFAULT_SPCK_THUMBNAIL_PATH,
            screenshotsJson: "[]",
            attachmentsJson: "[]",
            youtubeUrlsJson: "[]",
            relatedLinksJson: "[]",
            teacherComment: "",
            contentHash: "",
            status: "DRAFT",
          });
        }

        const upd = spckUploadRepo.updateSharedResources({
          classId,
          studentId,
          localFolderPath: folder,
          isConfirmedByTeacher: 1,
          thumbnailPath,
          screenshotsJson: JSON.stringify(gallery),
          youtubeUrlsJson: JSON.stringify([m.url]),
          syncSessionNumber: sessionNumber,
        });
        if (!upd.updated) {
          throw new Error(upd.reason || "Không cập nhật được kho tài nguyên của học viên.");
        }
      });
      saveImportToDb();

      const sessRow = spckSessionRepo.getOrInitSessionDraft(classId, studentId, sessionNumber, m.fullName || undefined);
      const sessScreens = parseJsonArray<string>(sessRow.screenshotsJson);
      const syncedToSession =
        parseJsonArray<string>(sessRow.youtubeUrlsJson).includes(m.url) &&
        framePaths.every((f) => sessScreens.includes(f));

      // 6. Only now remove previous frames that nothing (shared pool, any draft, any snapshot) references
      const referencedBlob = collectReferencedFileNames(classId, studentId, sessionNumber, true);
      const newNames = new Set(framePaths.map((f) => path.basename(f).toLowerCase()));
      for (const f of fs.readdirSync(framesDir)) {
        const lower = f.toLowerCase();
        if (/^yt_/i.test(f) && !newNames.has(lower) && !isFileStillReferenced(referencedBlob, lower)) {
          try {
            fs.unlinkSync(path.join(framesDir, f));
          } catch {
            // ignore
          }
        }
      }

      const warnings: string[] = [];
      if (framePaths.length < YOUTUBE_FRAMES_PER_STUDENT) {
        warnings.push(
          framePaths.length === 0
            ? "Không lấy được ảnh thuyết trình nào từ video (chỉ gắn link)."
            : `Chỉ lấy được ${framePaths.length}/${YOUTUBE_FRAMES_PER_STUDENT} ảnh thuyết trình từ video.`
        );
      } else if (p.source === "MIXED") {
        warnings.push("1 ảnh lấy từ ảnh bìa video vì video thiếu khung hình tự động.");
      }
      if (!syncedToSession) {
        warnings.push(
          `Buổi ${sessionNumber} đã duyệt/nộp nên dữ liệu mới chỉ lưu vào kho chung (bấm "Dùng tài nguyên mới nhất" nếu cần nộp lại).`
        );
      }

      results.push({
        ...m,
        applied: true,
        frames: framePaths,
        thumbnailPath,
        thumbnailIsOwnerPhoto,
        syncedToSession,
        frameSource: p.source,
        message: warnings.length > 0 ? warnings.join(" ") : undefined,
      });
    } catch (err) {
      rollbackCreatedFrames();
      results.push({
        ...m,
        applied: false,
        frames: [],
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const appliedIds = new Set(results.filter((r) => r.applied).map((r) => r.studentId));
  const matchedIds = new Set(
    results.filter((r) => r.studentId).map((r) => r.studentId)
  );
  const studentsWithoutVideo = students.filter(
    (s) => !appliedIds.has(s.studentId) && !matchedIds.has(s.studentId)
  );

  return {
    classId,
    sessionNumber,
    playlists,
    totalVideos: videoMap.size,
    appliedCount: appliedIds.size,
    results,
    studentsWithoutVideo,
    invalidLines: parsed.invalidLines,
  };
}
