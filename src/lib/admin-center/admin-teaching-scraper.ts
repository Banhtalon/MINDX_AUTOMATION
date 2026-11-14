import { getDynamicAdminConfig } from "../config";
import { isRoboticsClassCode } from "../db/sqlite";
import { sanitizeErrorMessage } from "../security/secret-redactor";
import {
  LiveTeachingHttpTransport,
  type RemoteTeachingProject,
  type RemoteTeachingStudent,
  type RemoteTeachingTask,
} from "../playwright/teaching-project-service";
import {
  LiveTeachingReportCardHttpTransport,
  type RemoteTeachingExercise,
  type RemoteTeachingScoreRow,
} from "../playwright/teaching-report-card-sync";
import {
  TeachingHttpClient,
  ensureQueueNotStopped,
  resolveTeachingBaseOrigin,
  runWithStopGuard,
} from "../teaching/teaching-http-client";
import type { AdminBlockType } from "./admin-types";

export interface TeachingScheduleClassEntry {
  classCode: string;
  blockType: AdminBlockType;
  instructor: string;
  assistantTeacher: string;
  sessionNumber: number;
  specialEvent: string;
  timeSlot: string;
  rawText: string;
}

export interface TeachingCheckNhanXetEntry {
  classCode: string;
  sessionNumber: number;
  sessionDate: string;
  mainTeacher: string;
  assistantTeacher: string;
  block: string;
  zaloDeadline: string;
  zaloStatus: string;
  lmsDeadline: string;
  lmsStatus: string;
  issueDescription: string;
  teacherNote: string;
  evalStatus: string;
}

export interface TeachingHocBuEntry {
  classCode: string;
  studentName: string;
  sessionLabel: string;
  teacher: string;
  status: string;
}

export type TeachingEndpointKey =
  | "students"
  | "exercises"
  | "scores"
  | "project"
  | "tasks";

export interface TeachingPerClassDetail {
  classCode: string;
  students: RemoteTeachingStudent[];
  exercises: RemoteTeachingExercise[];
  scores: RemoteTeachingScoreRow[];
  project: RemoteTeachingProject | null;
  tasks: RemoteTeachingTask[];
  taskProgress: Record<string, number>;
  hasFetchError?: boolean;
  fetchErrors?: string[];
  failedEndpoints?: TeachingEndpointKey[];
}

export interface AdminTeachingCampusSnapshot {
  baseOrigin: string;
  scheduleByClass: Map<string, TeachingScheduleClassEntry>;
  checkRowsByClass: Map<string, TeachingCheckNhanXetEntry[]>;
  makeupRows: TeachingHocBuEntry[];
  makeupByClass: Map<string, TeachingHocBuEntry[]>;
  perClassDetails: Map<string, TeachingPerClassDetail>;
  fetchWarnings: string[];
}

function decodeHtmlEntities(raw: string): string {
  return String(raw || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec)))
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtmlTags(raw: string): string {
  return decodeHtmlEntities(String(raw || "").replace(/<[^>]+>/g, " "));
}

function parseAttributes(tagOpen: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(tagOpen)) !== null) {
    const key = m[1].toLowerCase();
    const val = m[2] ?? m[3] ?? m[4] ?? "";
    attrs[key] = decodeHtmlEntities(val);
  }
  return attrs;
}

function resolveBlockFromHint(rawBlock: string, classCode: string): AdminBlockType {
  const b = String(rawBlock || "").trim().toUpperCase();
  if (b.includes("ROBOT")) return "ROBOTICS";
  if (b.includes("COD")) return "CODING";
  return isRoboticsClassCode(classCode) ? "ROBOTICS" : "CODING";
}

function normalizeSpecialEvent(raw: string): string {
  const clean = String(raw || "").trim().toUpperCase();
  if (!clean) return "";
  if (clean.includes("KHAI")) return "KHAI_GIANG";
  if (clean.includes("CP1") || clean.includes("CHECKPOINT 1")) return "CP1";
  if (clean.includes("CP2") || clean.includes("CHECKPOINT 2")) return "CP2";
  if (clean.includes("DEMO") || clean.includes("SPCK")) return "DEMO";
  return clean;
}

/**
 * Parses `index.php` weekly schedule cards (`div.regular-class`).
 */
export function parseTeachingWeeklyScheduleHtml(
  html: string
): TeachingScheduleClassEntry[] {
  const out: TeachingScheduleClassEntry[] = [];
  const src = String(html || "");
  if (!src) return out;

  const openDivRegex = /<div\b[^>]*class\s*=\s*["'][^"']*\bregular-class\b[^"']*["'][^>]*>/gi;
  const matches: Array<{ index: number; tag: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = openDivRegex.exec(src)) !== null) {
    matches.push({ index: m.index, tag: m[0] });
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : Math.min(src.length, start + 3500);
    const chunk = src.slice(start, end);
    const attrs = parseAttributes(matches[i].tag);
    const plain = stripHtmlTags(chunk);

    const codeAttr = attrs["data-class-code"] || attrs["data-class"] || "";
    const codeRegex = /\b(?:VT|205ALHP|KIND|TEENS|PRE|ARM|SEMI)[A-Z0-9_-]{2,40}\b/i;
    const codeMatch = plain.match(codeRegex);
    const classCode = (codeAttr || codeMatch?.[0] || "").trim().toUpperCase();
    if (!classCode) continue;

    const rawSession =
      attrs["data-session-number"] ||
      attrs["data-session"] ||
      (plain.match(/Buổi\s*[:#]?\s*(\d{1,2})/i)?.[1] ?? "0");
    const sessionNumber = Number.parseInt(String(rawSession), 10) || 0;

    const instructor = (
      attrs["data-instructor"] ||
      attrs["data-teacher"] ||
      plain.match(/GV\s*[:\-]\s*([^|\n,]+)/i)?.[1] ||
      ""
    ).trim();

    const assistantTeacher = (
      attrs["data-ta"] ||
      attrs["data-assistant"] ||
      plain.match(/TA\s*[:\-]\s*([^|\n,]+)/i)?.[1] ||
      ""
    ).trim();

    const timeMatch = plain.match(
      /\b(\d{1,2}[:h]\d{2})(?::\d{2})?\s*[-–]\s*(\d{1,2}[:h]\d{2})(?::\d{2})?\b/i
    );
    const parsedTime = timeMatch ? `${timeMatch[1]} - ${timeMatch[2]}` : "";
    const timeSlot = (attrs["data-time"] || attrs["data-time-slot"] || parsedTime).trim();

    out.push({
      classCode,
      blockType: resolveBlockFromHint(attrs["data-block"] || "", classCode),
      instructor,
      assistantTeacher,
      sessionNumber,
      specialEvent: normalizeSpecialEvent(attrs["data-special-event"] || ""),
      timeSlot,
      rawText: plain.slice(0, 240),
    });
  }

  return out;
}

interface TableCellSnapshot {
  text: string;
  html: string;
}

function stripScriptAndStyleBlocks(html: string): string {
  return String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
}

function extractTableRowsDetailed(html: string): TableCellSnapshot[][] {
  const cleanHtml = stripScriptAndStyleBlocks(html);
  const rows: TableCellSnapshot[][] = [];
  const tableRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = tableRegex.exec(cleanHtml)) !== null) {
    const rowHtml = rowMatch[1];
    if (!/<td\b/i.test(rowHtml)) continue;
    const cells: TableCellSnapshot[] = [];
    const cellRegex = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      const innerHtml = cellMatch[1] || "";
      cells.push({
        text: stripHtmlTags(innerHtml),
        html: innerHtml,
      });
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

function extractTableRowsText(html: string): string[][] {
  return extractTableRowsDetailed(html).map((row) => row.map((cell) => cell.text));
}

function resolveCheckColumnStatus(
  statusCell: TableCellSnapshot | undefined,
  deadlineCell: TableCellSnapshot | undefined,
  evalStatusText: string,
  nowMs: number
): string {
  if (!statusCell) return "";
  const inputMatch = statusCell.html.match(/<input\b[^>]*>/i);
  if (inputMatch) {
    const inputTag = inputMatch[0];
    const hasChecked =
      /(?:^|\s)checked(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s/>]+))?(?=[\s/>])/i.test(inputTag) &&
      !/\bchecked\s*=\s*["']?(?:false|0)["']?(?=[\s/>])/i.test(inputTag);
    if (hasChecked) return "Đã hoàn thành";

    const deadlineMatch = (deadlineCell?.html || "").match(/data-deadline\s*=\s*["'](\d{9,13})["']/i);
    let isOverdue = /quá hạn|muộn|trễ/i.test(evalStatusText);
    if (deadlineMatch) {
      const rawEpoch = Number(deadlineMatch[1]);
      const deadlineMs = rawEpoch > 1e11 ? rawEpoch : rawEpoch * 1000;
      if (Number.isFinite(deadlineMs) && deadlineMs < nowMs) {
        isOverdue = true;
      }
    }
    return isOverdue ? "Chưa hoàn thành (Quá hạn)" : "Chưa hoàn thành";
  }
  return statusCell.text.trim();
}

function cleanCheckPlaceholder(text: string): string {
  const clean = String(text || "").trim();
  if (!clean) return "";
  if (/^\+?\s*(?:ghi chú qc|gv nhập giải trình|thêm ghi chú)\s*$/i.test(clean)) {
    return "";
  }
  return clean;
}

function extractTableHeadersText(html: string): string[] {
  const cleanHtml = stripScriptAndStyleBlocks(html);
  const theadMatch = cleanHtml.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i);
  const target = theadMatch ? theadMatch[1] : cleanHtml.slice(0, 4000);
  const headers: string[] = [];
  const thRegex = /<th\b[^>]*>([\s\S]*?)<\/th>/gi;
  let m: RegExpExecArray | null;
  while ((m = thRegex.exec(target)) !== null) {
    headers.push(stripHtmlTags(m[1]).toLowerCase());
  }
  return headers;
}

function findTableColumnIndex(
  headers: string[],
  keywords: string[],
  fallback: number,
  excludeKeywords: string[] = []
): number {
  for (const kw of keywords) {
    const idx = headers.findIndex(
      (h) => h.includes(kw) && !excludeKeywords.some((ex) => h.includes(ex))
    );
    if (idx >= 0) return idx;
  }
  return fallback;
}

/**
 * Parses `check_nhanxet.php` weekly comment compliance table.
 */
export function parseTeachingCheckNhanXetHtml(
  html: string,
  nowMs: number = Date.now()
): TeachingCheckNhanXetEntry[] {
  const headers = extractTableHeadersText(html);
  const rows = extractTableRowsDetailed(html);
  if (rows.length === 0) return [];

  const cCode = findTableColumnIndex(headers, ["mã lớp", "lớp"], 1);
  const cSession = findTableColumnIndex(headers, ["buổi"], 2);
  const cDate = findTableColumnIndex(headers, ["ngày học", "ngày"], 3);
  const cMain = findTableColumnIndex(headers, ["giảng viên chính", "gv chính", "giảng viên"], 4);
  const cTa = findTableColumnIndex(headers, ["trợ giảng", "ta"], 5);
  const cBlock = findTableColumnIndex(headers, ["khối"], 6);
  const cZaloDl = findTableColumnIndex(headers, ["deadline zalo", "hạn zalo"], 7);
  const cZaloSt = findTableColumnIndex(headers, ["nx zalo", "tình trạng zalo", "zalo"], 8, ["deadline"]);
  const cLmsDl = findTableColumnIndex(headers, ["deadline lms", "hạn lms"], 9);
  const cLmsSt = findTableColumnIndex(headers, ["nx lms", "tình trạng lms", "lms"], 10, ["deadline"]);
  const cIssue = findTableColumnIndex(headers, ["mô tả vấn đề", "vấn đề"], 11);
  const cNote = findTableColumnIndex(headers, ["ghi chú"], 12);
  const cEval = findTableColumnIndex(headers, ["tình trạng đánh giá", "đánh giá"], 13);

  const out: TeachingCheckNhanXetEntry[] = [];
  for (const cells of rows) {
    const rawCode = (cells[cCode]?.text || "").trim().toUpperCase();
    if (!rawCode || rawCode === "-") continue;
    const rawSess = cells[cSession]?.text || "";
    const sessNum = Number.parseInt(rawSess.replace(/[^\d]/g, ""), 10) || 0;
    const evalStatus = (cells[cEval]?.text || "").trim();

    out.push({
      classCode: rawCode,
      sessionNumber: sessNum,
      sessionDate: (cells[cDate]?.text || "").trim(),
      mainTeacher: (cells[cMain]?.text || "").trim(),
      assistantTeacher: (cells[cTa]?.text || "").trim(),
      block: (cells[cBlock]?.text || "").trim(),
      zaloDeadline: (cells[cZaloDl]?.text || "").trim(),
      zaloStatus: resolveCheckColumnStatus(cells[cZaloSt], cells[cZaloDl], evalStatus, nowMs),
      lmsDeadline: (cells[cLmsDl]?.text || "").trim(),
      lmsStatus: resolveCheckColumnStatus(cells[cLmsSt], cells[cLmsDl], evalStatus, nowMs),
      issueDescription: cleanCheckPlaceholder(cells[cIssue]?.text || ""),
      teacherNote: cleanCheckPlaceholder(cells[cNote]?.text || ""),
      evalStatus,
    });
  }
  return out;
}

/**
 * Returns true if a makeup entry is already completed, attended, or cancelled
 * (i.e. NOT pending makeup debt). Shared cleanly between HTML and DataTables JSON parsers.
 */
export function isCompletedOrCancelledMakeupStatus(
  status: string,
  attendanceStatus = ""
): boolean {
  const s = String(status || "").trim();
  const a = String(attendanceStatus || "").trim();
  if (/đã\s*học|hoàn\s*thành|đã\s*bù|hủy|huỷ|cancel|done|completed/i.test(s)) {
    return true;
  }
  if (/có\s*mặt|đã\s*điểm\s*danh|present|attended/i.test(a)) {
    return true;
  }
  return false;
}

/**
 * Parses `hocbu.php` makeup classes table for pending / unscheduled makeup debt.
 */
export function parseTeachingHocBuHtml(html: string): TeachingHocBuEntry[] {
  const headers = extractTableHeadersText(html);
  const rows = extractTableRowsText(html);
  if (rows.length === 0) return [];

  const cCode = findTableColumnIndex(headers, ["mã lớp", "lớp"], 1);
  const cStu = findTableColumnIndex(headers, ["học sinh", "học viên", "tên"], 2);
  const cSess = findTableColumnIndex(headers, ["buổi"], 3);
  const cTeacher = findTableColumnIndex(headers, ["giảng viên", "gv"], 4);
  const cStatus = findTableColumnIndex(headers, ["trạng thái", "tình trạng"], 5);
  const cAtt = findTableColumnIndex(headers, ["điểm danh"], -1);

  const out: TeachingHocBuEntry[] = [];
  for (const cells of rows) {
    if (cells.some((c) => c.includes("${"))) continue;
    const joined = cells.join(" ").toUpperCase();
    let classCode = (cells[cCode] || "").trim().toUpperCase();
    if (!classCode || classCode.length > 40) {
      const m = joined.match(/\b(?:VT|205ALHP|KIND|TEENS)[A-Z0-9_-]{2,30}\b/);
      classCode = m ? m[0] : "";
    }
    if (!classCode) continue;

    const status = (cells[cStatus] || "Chờ học bù").trim();
    const attendanceStatus = cAtt >= 0 ? (cells[cAtt] || "").trim() : "";
    if (isCompletedOrCancelledMakeupStatus(status, attendanceStatus)) continue;

    out.push({
      classCode,
      studentName: (cells[cStu] || "").trim(),
      sessionLabel: (cells[cSess] || "").trim(),
      teacher: (cells[cTeacher] || "").trim(),
      status: status || "Chờ học bù",
    });
  }
  return out;
}

function parseTeachingHocBuDatatablePage(rawJson: string): {
  rows: TeachingHocBuEntry[];
  recordsFiltered: number | null;
  rawCount: number;
  isJson: boolean;
} {
  const src = String(rawJson || "").trim();
  if (!src) return { rows: [], recordsFiltered: 0, rawCount: 0, isJson: false };
  let parsed: any = null;
  try {
    parsed = JSON.parse(src);
  } catch {
    return { rows: [], recordsFiltered: 0, rawCount: 0, isJson: false };
  }
  if (!Array.isArray(parsed?.data)) {
    return { rows: [], recordsFiltered: 0, rawCount: 0, isJson: true };
  }

  const totalRaw = Number(parsed?.recordsFiltered ?? parsed?.recordsTotal ?? NaN);
  const recordsFiltered = Number.isFinite(totalRaw) && totalRaw >= 0 ? totalRaw : null;

  const out: TeachingHocBuEntry[] = [];
  for (const row of parsed.data) {
    const status = String(row?.status ?? "").trim();
    const attendanceStatus = String(row?.attendance_status ?? "").trim();
    if (isCompletedOrCancelledMakeupStatus(status, attendanceStatus)) continue;

    const classCode = String(row?.class_code ?? "").trim().toUpperCase();
    if (!classCode) continue;

    const sessNum = Number(row?.session_number || 0);
    const sessionLabel =
      Number.isFinite(sessNum) && sessNum > 0
        ? `Buổi ${sessNum}`
        : String(row?.session_label ?? "").trim();
    const teacher = String(row?.instructor_name || row?.instructor || "").trim();

    out.push({
      classCode,
      studentName: String(row?.student_name ?? "").trim(),
      sessionLabel,
      teacher,
      status: status || "Chờ học bù",
    });
  }
  return {
    rows: out,
    recordsFiltered,
    rawCount: parsed.data.length,
    isJson: true,
  };
}

/**
 * Parses `hocbu.php?datatable=hocbu` DataTables JSON payload for pending makeup debt.
 */
export function parseTeachingHocBuDatatableJson(rawJson: string): TeachingHocBuEntry[] {
  return parseTeachingHocBuDatatablePage(rawJson).rows;
}

export function isTeachingCheckLateOrMissing(statusText: string): boolean {
  const s = String(statusText || "").trim().toLowerCase();
  if (!s) return false;
  if (/chưa\s*xác\s*minh|unverified|chưa\s*có\s*dữ\s*liệu/i.test(s)) return false;
  if (/muộn|trễ|chưa|thiếu|quá hạn|late|missing|chờ/i.test(s)) return true;
  if (/đạt|đúng hạn|ok|hoàn thành|đã/i.test(s)) return false;
  return false;
}

export interface AdminTeachingHttpFetcherDeps {
  httpClient?: TeachingHttpClient;
  projectTransport?: LiveTeachingHttpTransport;
  reportCardTransport?: LiveTeachingReportCardHttpTransport;
}

export async function fetchAdminTeachingOverviewPages(
  deps?: AdminTeachingHttpFetcherDeps
): Promise<{
  baseOrigin: string;
  scheduleByClass: Map<string, TeachingScheduleClassEntry>;
  checkRowsByClass: Map<string, TeachingCheckNhanXetEntry[]>;
  makeupRows: TeachingHocBuEntry[];
  makeupByClass: Map<string, TeachingHocBuEntry[]>;
  fetchWarnings: string[];
}> {
  const adminCfg = getDynamicAdminConfig();
  const baseOrigin = resolveTeachingBaseOrigin();
  const credentials = {
    username: adminCfg.adminTeachingUsername,
    password: adminCfg.adminTeachingPassword,
  };
  const client =
    deps?.httpClient || new TeachingHttpClient(baseOrigin, 25000, credentials);

  const scheduleByClass = new Map<string, TeachingScheduleClassEntry>();
  const checkRowsByClass = new Map<string, TeachingCheckNhanXetEntry[]>();
  const makeupRows: TeachingHocBuEntry[] = [];
  const makeupByClass = new Map<string, TeachingHocBuEntry[]>();
  const fetchWarnings: string[] = [];

  ensureQueueNotStopped();
  try {
    const indexHtml = await runWithStopGuard(() =>
      client.getHtmlPage("/index.php", "đọc lịch dạy tuần cơ sở trên Teaching")
    );
    for (const item of parseTeachingWeeklyScheduleHtml(indexHtml)) {
      scheduleByClass.set(item.classCode, item);
    }
  } catch (err: any) {
    if (String(err?.message || "").includes("QUEUE_STOPPED")) throw err;
    fetchWarnings.push(`Không đọc được /index.php Teaching: ${sanitizeErrorMessage(err)}`);
  }

  ensureQueueNotStopped();
  try {
    const checkHtml = await runWithStopGuard(() =>
      client.getHtmlPage("/check_nhanxet.php", "đọc bảng kiểm tra nhận xét 48h trên Teaching")
    );
    for (const row of parseTeachingCheckNhanXetHtml(checkHtml)) {
      const list = checkRowsByClass.get(row.classCode) || [];
      list.push(row);
      checkRowsByClass.set(row.classCode, list);
    }
  } catch (err: any) {
    if (String(err?.message || "").includes("QUEUE_STOPPED")) throw err;
    fetchWarnings.push(`Không đọc được /check_nhanxet.php Teaching: ${sanitizeErrorMessage(err)}`);
  }

  ensureQueueNotStopped();
  try {
    const pageSize = 200;
    const maxPages = 25;
    let start = 0;
    let expectedFiltered: number | null = null;
    for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
      ensureQueueNotStopped();
      const hocBuRaw = await runWithStopGuard(() =>
        client.getHtmlPage(
          `/hocbu.php?datatable=hocbu&start=${start}&length=${pageSize}`,
          "đọc danh sách học bù trên Teaching"
        )
      );
      if (pageIdx === 0 && !hocBuRaw.trim().startsWith("{")) {
        const htmlRows = parseTeachingHocBuHtml(hocBuRaw);
        for (const row of htmlRows) {
          makeupRows.push(row);
          const list = makeupByClass.get(row.classCode) || [];
          list.push(row);
          makeupByClass.set(row.classCode, list);
        }
        break;
      }

      const page = parseTeachingHocBuDatatablePage(hocBuRaw);
      if (!page.isJson) {
        fetchWarnings.push("Phản hồi /hocbu.php Teaching không phải JSON DataTables hợp lệ.");
        break;
      }
      if (page.recordsFiltered !== null) {
        expectedFiltered = page.recordsFiltered;
      }
      for (const row of page.rows) {
        makeupRows.push(row);
        const list = makeupByClass.get(row.classCode) || [];
        list.push(row);
        makeupByClass.set(row.classCode, list);
      }

      if (page.rawCount === 0) {
        if (expectedFiltered !== null && start < expectedFiltered) {
          fetchWarnings.push(
            `Danh sách học bù Teaching chưa tải đủ (${start}/${expectedFiltered} bản ghi; trang kế tiếp trả rỗng).`
          );
        }
        break;
      }
      start += page.rawCount;
      if (expectedFiltered !== null) {
        if (start >= expectedFiltered) break;
        if (pageIdx === maxPages - 1 && start < expectedFiltered) {
          fetchWarnings.push(
            `Danh sách học bù Teaching chưa tải đủ (${start}/${expectedFiltered} bản ghi).`
          );
        }
      } else if (page.rawCount < pageSize) {
        break;
      }
    }
  } catch (err: any) {
    if (String(err?.message || "").includes("QUEUE_STOPPED")) throw err;
    fetchWarnings.push(`Không đọc được /hocbu.php Teaching: ${sanitizeErrorMessage(err)}`);
  }

  return {
    baseOrigin,
    scheduleByClass,
    checkRowsByClass,
    makeupRows,
    makeupByClass,
    fetchWarnings,
  };
}

export async function fetchTeachingClassDetailsBatch(
  targets: Array<{
    classCode: string;
    blockType: AdminBlockType;
    needScores: boolean;
    needSpckProject: boolean;
  }>,
  deps?: AdminTeachingHttpFetcherDeps
): Promise<{
  detailsByClass: Map<string, TeachingPerClassDetail>;
  warnings: string[];
}> {
  const adminCfg = getDynamicAdminConfig();
  const baseOrigin = resolveTeachingBaseOrigin();
  const credentials = {
    username: adminCfg.adminTeachingUsername,
    password: adminCfg.adminTeachingPassword,
  };

  const projectTransport =
    deps?.projectTransport || new LiveTeachingHttpTransport(baseOrigin, 20000, credentials);
  const rcTransport =
    deps?.reportCardTransport ||
    new LiveTeachingReportCardHttpTransport(baseOrigin, 20000, credentials);

  const detailsByClass = new Map<string, TeachingPerClassDetail>();
  const warnings: string[] = [];

  for (const t of targets) {
    ensureQueueNotStopped();
    const classCode = t.classCode.trim().toUpperCase();
    const failedEndpoints: TeachingEndpointKey[] = [];
    const fetchErrors: string[] = [];

    const captureCall = async <R>(
      endpoint: TeachingEndpointKey,
      fn: () => Promise<R>,
      fallback: R
    ): Promise<R> => {
      try {
        return await runWithStopGuard(fn);
      } catch (err: any) {
        if (String(err?.message || "").includes("QUEUE_STOPPED")) throw err;
        const safeErr = sanitizeErrorMessage(err);
        if (!failedEndpoints.includes(endpoint)) {
          failedEndpoints.push(endpoint);
        }
        fetchErrors.push(`${endpoint}: ${safeErr}`);
        warnings.push(`Lỗi đọc Teaching (${endpoint}) lớp ${classCode}: ${safeErr}`);
        return fallback;
      }
    };

    try {
      const students = await captureCall(
        "students",
        () => rcTransport.getStudents(classCode),
        [] as RemoteTeachingStudent[]
      );

      const exercises = t.needScores
        ? await captureCall(
            "exercises",
            () => rcTransport.getExercises(classCode),
            [] as RemoteTeachingExercise[]
          )
        : [];
      const scores = t.needScores
        ? await captureCall(
            "scores",
            () => rcTransport.getScores(classCode),
            [] as RemoteTeachingScoreRow[]
          )
        : [];

      let project: RemoteTeachingProject | null = null;
      let tasks: RemoteTeachingTask[] = [];
      let taskProgress: Record<string, number> = {};

      if (t.needSpckProject) {
        project = await captureCall(
          "project",
          () => projectTransport.getProject(classCode),
          null
        );
        if (project && project.id) {
          const projectId = project.id;
          const [tList, progMap] = await captureCall(
            "tasks",
            () =>
              Promise.all([
                projectTransport.getTasks(projectId),
                projectTransport.getTaskProgress(projectId),
              ]),
            [[], {}] as [RemoteTeachingTask[], Record<string, number>]
          );
          tasks = tList;
          taskProgress = progMap;
        }
      }

      detailsByClass.set(classCode, {
        classCode,
        students,
        exercises,
        scores,
        project,
        tasks,
        taskProgress,
        hasFetchError: failedEndpoints.length > 0,
        fetchErrors,
        failedEndpoints,
      });
    } catch (err: any) {
      if (String(err?.message || "").includes("QUEUE_STOPPED")) throw err;
      const safeErr = sanitizeErrorMessage(err);
      warnings.push(`Lỗi đọc Teaching lớp ${classCode}: ${safeErr}`);
      detailsByClass.set(classCode, {
        classCode,
        students: [],
        exercises: [],
        scores: [],
        project: null,
        tasks: [],
        taskProgress: {},
        hasFetchError: true,
        fetchErrors: [safeErr],
        failedEndpoints: ["students"],
      });
    }
  }

  return { detailsByClass, warnings };
}
