/**
 * MINDX AUTOMATION BOT - NATIVE GOOGLE SHEETS DEMO SCORING GENERATOR
 * Creates a true native Google Spreadsheet ("Trang tính của Google",
 * `application/vnd.google-apps.spreadsheet` — NEVER saving or leaving an Excel `.xlsx` file)
 * directly inside the class's Google Drive folder (`CODING - SPCK -> <Course> -> <classId>`),
 * with 1 tab per student + "Phân bổ điểm" tab, pre-filled with:
 * - Course Demo Title (e.g., "Bảng chấm điểm buổi Demo App Producer - Advanced")
 * - Student Full Name ("Họ và tên Học viên:")
 * - Demo Date ("Ngày Demo:" -> Session 14 date)
 * - Evaluation Date ("Ngày đánh giá:")
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import type { Frame, Page } from "playwright";
import { getDb, jobLogRepo, spckUploadRepo, studentRepo } from "../db/sqlite";
import { taskQueue } from "../queue/task-queue";
import { assertPathAllowed } from "../security/path-allowlist";
import { BrowserManager } from "./browser-manager";
import {
  CODING_SPCK_COURSE_FOLDER_MAP,
  CODING_SPCK_ROOT_FOLDER_ID,
  DEFAULT_SPCK_DRIVE_FOLDER_URL,
  detectCoursePrefixFromClassId,
  extractDriveFolderId,
} from "./spck-drive-uploader";

export const COURSE_DEMO_TITLE_MAP: Record<string, string> = {
  PTB: "Bảng chấm điểm buổi Demo App Producer - Basic",
  PTA: "Bảng chấm điểm buổi Demo App Producer - Advanced",
  PTI: "Bảng chấm điểm buổi demo App Producer - Intensive",
  PSI: "Bảng chấm điểm buổi demo App Producer - Intensive",
  SB: "Bảng chấm điểm buổi demo Scratch Creator - Basic",
  SA: "Bảng chấm điểm buổi demo Scratch Creator - Advanced",
  SI: "Bảng chấm điểm buổi demo Scratch Creator - Intensive",
  GB: "Bảng chấm điểm buổi demo Game Maker - Basic",
  GA: "Bảng chấm điểm buổi demo Game Maker - Advanced",
  GI: "Bảng chấm điểm buổi demo Game Maker - Intensive",
  JSB: "Bảng chấm điểm buổi Demo Web Developer - Basic",
  JSA: "Bảng chấm điểm buổi Demo Web Developer - Advanced",
  JSI: "Bảng chấm điểm buổi Demo Web Developer - Intensive",
  CSB: "Bảng chấm điểm buổi demo Computer Scientist - Basic",
  CSA: "Bảng chấm điểm buổi demo Computer Scientist - Advanced",
  CSI: "Bảng chấm điểm buổi demo Computer Scientist - Intensive",
};

export interface DemoSheetStudentTab {
  studentId: string;
  fullName: string;
  tabName: string;
}

export interface CreateDemoSheetOptions {
  classId: string;
  templateSheetUrl?: string;
  driveFolderUrl?: string;
  localClassFolderPath?: string;
  customDemoDate?: string;
  customEvalDate?: string;
  /** @internal Test-only Playwright Page & origin overrides for isolated DOM verification */
  _testHarness?: {
    page: Page;
    driveBaseUrl?: string;
    sheetsBaseUrl?: string;
  };
}

export interface CreateDemoSheetResult {
  classId: string;
  sheetTitle: string;
  fileName: string;
  isNativeGoogleSheet: boolean;
  mimeType: "application/vnd.google-apps.spreadsheet";
  demoDate: string;
  evalDate: string;
  studentCount: number;
  studentTabNames: string[];
  localFilePath: string;
  copiedToClassFolderPath?: string;
  driveFileId?: string;
  googleSheetUrl?: string;
  classDriveFolderUrl?: string;
  usedTemplateUrl?: string;
}

function escapeXml(str: string): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function getDemoSheetTitleForClass(classId: string): string {
  const prefix = detectCoursePrefixFromClassId(classId);
  if (prefix && COURSE_DEMO_TITLE_MAP[prefix]) {
    return COURSE_DEMO_TITLE_MAP[prefix];
  }
  return `Bảng chấm điểm buổi Demo - ${String(classId || "").trim().toUpperCase()}`;
}

/**
 * Parses a DD/MM/YYYY or YYYY-MM-DD date string into a UTC Date object.
 */
function parseFlexibleDate(raw: string): Date | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;

  // Match DD/MM/YYYY or DD-MM-YYYY
  const dmy = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    const dt = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  // Match YYYY-MM-DD
  const ymd = trimmed.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymd) {
    const year = Number(ymd[1]);
    const month = Number(ymd[2]);
    const day = Number(ymd[3]);
    const dt = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  return null;
}

function formatDateIso(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDaysUtc(dt: Date, days: number): Date {
  return new Date(dt.getTime() + days * 86_400_000);
}

/**
 * Resolves Session 14 (Buổi 14) Demo Date for a class from `classes_sessions` in SQLite.
 * If Session 14's date is empty, projects +7 days per session from the latest dated session.
 */
export function resolveSession14DemoDate(classId: string): {
  demoDate: string;
  evalDate: string;
} {
  const normalizedClassId = String(classId || "").trim().toUpperCase();
  const db = getDb();
  const sessions = db
    .prepare(
      `SELECT sessionNumber, date
       FROM classes_sessions
       WHERE classId = ?
       ORDER BY sessionNumber ASC`
    )
    .all(normalizedClassId) as Array<{ sessionNumber: number; date: string }>;

  let demoDateObj: Date | null = null;

  const s14 = sessions.find((s) => Number(s.sessionNumber) === 14);
  if (s14 && s14.date) {
    demoDateObj = parseFlexibleDate(s14.date);
  }

  if (!demoDateObj) {
    // Find the latest session that has a valid date and project forward to session 14 (+7 days per session)
    for (let i = sessions.length - 1; i >= 0; i--) {
      const s = sessions[i];
      const parsed = parseFlexibleDate(s.date);
      if (parsed && Number(s.sessionNumber) > 0) {
        const diffSessions = 14 - Number(s.sessionNumber);
        demoDateObj = addDaysUtc(parsed, diffSessions * 7);
        break;
      }
    }
  }

  if (!demoDateObj) {
    const now = new Date();
    demoDateObj = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  }

  const evalDateObj = addDaysUtc(demoDateObj, 7);
  return {
    demoDate: formatDateIso(demoDateObj),
    evalDate: formatDateIso(evalDateObj),
  };
}

/**
 * Builds unique, valid Excel/Google Sheets worksheet tab names (<= 31 chars, no []:*?/\)
 * for the class's student roster.
 */
export function buildStudentTabsForClass(classId: string): DemoSheetStudentTab[] {
  const normalizedClassId = String(classId || "").trim().toUpperCase();
  const activeStudents = studentRepo.findByClass(normalizedClassId, false);
  const spckRows = spckUploadRepo.findByClass(normalizedClassId);

  const studentList: Array<{ studentId: string; fullName: string }> = [];
  const seenIds = new Set<string>();

  for (const s of activeStudents) {
    if (!seenIds.has(s.studentId)) {
      seenIds.add(s.studentId);
      studentList.push({ studentId: s.studentId, fullName: s.fullName });
    }
  }
  for (const r of spckRows) {
    if (r.studentId && !seenIds.has(r.studentId)) {
      seenIds.add(r.studentId);
      studentList.push({ studentId: r.studentId, fullName: r.studentId });
    }
  }

  const usedTabNames = new Set<string>();
  return studentList.map((stu, idx) => {
    const rawClean = String(stu.fullName || `Hoc Vien ${idx + 1}`)
      .replace(/[\[\]\:\*\?\/\\]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    let candidate = rawClean.slice(0, 31) || `HV ${idx + 1}`;
    let counter = 2;
    while (usedTabNames.has(candidate.toLowerCase())) {
      const suffix = ` (${counter++})`;
      candidate = `${rawClean.slice(0, 31 - suffix.length)}${suffix}`;
    }
    usedTabNames.add(candidate.toLowerCase());
    return {
      studentId: stu.studentId,
      fullName: stu.fullName,
      tabName: candidate,
    };
  });
}

/**
 * Extracts Google Spreadsheet ID from a Google Sheets URL if present.
 */
export function extractGoogleSheetId(rawUrl: string): string | null {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) return null;
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{15,80})/);
  if (match && match[1]) return match[1];
  return null;
}

/**
 * Generates a single student worksheet XML (`xl/worksheets/sheetK.xml`) using the standard MindX Demo Rubric layout.
 */
function buildStandardStudentWorksheetXml(params: {
  sheetTitle: string;
  studentName: string;
  demoDate: string;
  evalDate: string;
  isFirstTab: boolean;
}): string {
  const { sheetTitle, studentName, demoDate, evalDate, isFirstTab } = params;

  const cellStr = (ref: string, styleIdx: number, text: string) =>
    `<c r="${ref}" s="${styleIdx}" t="inlineStr"><is><t>${escapeXml(text)}</t></is></c>`;
  const cellNum = (ref: string, styleIdx: number, num: number) =>
    `<c r="${ref}" s="${styleIdx}"><v>${num}</v></c>`;
  const cellFormula = (
    ref: string,
    styleIdx: number,
    formula: string,
    cachedVal: string | number,
    isStringResult = false
  ) =>
    `<c r="${ref}" s="${styleIdx}"${isStringResult ? ' t="str"' : ""}><f>${escapeXml(
      formula
    )}</f><v>${escapeXml(String(cachedVal))}</v></c>`;

  const criteriaRows: Array<{
    catTitle?: string;
    content: string;
    maxPts: number;
  }> = [
    {
      catTitle: "Tư duy máy tính, tư duy thuật toán\n(1,5 điểm)",
      content: "Sử dụng Lớp và Kế thừa để kết nối hiển thị giao diện",
      maxPts: 0.25,
    },
    {
      content: "Có sử dụng signal và slot hoặc event để xử lí tương tác",
      maxPts: 0.25,
    },
    {
      content: "Có sử dụng container và áp dụng bố cục cho giao diện.",
      maxPts: 0.25,
    },
    {
      content: "Có thể lấy ra được thông tin nhập từ bàn phím của widgets LineEdit.",
      maxPts: 0.25,
    },
    {
      content: "Có lưu thông tin admin và kiểm tra được đăng nhập và đăng kí.",
      maxPts: 0.25,
    },
    {
      content: "Sử dụng QMessagebox để thông báo đến người dùng",
      maxPts: 0.25,
    },
    {
      catTitle: "Tư duy sáng tạo\n(1 điểm)",
      content: "Ý tưởng phù hợp nhu cầu người dùng và độ tuổi",
      maxPts: 0.25,
    },
    {
      content:
        "Nội dung độc đáo, sáng tạo, hạn chế sử dụng lại ý tưởng của sản phẩm mẫu",
      maxPts: 0.25,
    },
    {
      content: "Bố cục rõ ràng, hình ảnh, màu sắc đẹp mắt ",
      maxPts: 0.25,
    },
    {
      content: "Giao diện hợp logic và trải nghiệm người dùng.",
      maxPts: 0.25,
    },
    {
      catTitle: "Kỹ năng giao tiếp, hợp tác\n(0,5 điểm)",
      content:
        "Tự tin trình bày dự án rõ ràng, mạch lạc, có tương tác với các bạn khác",
      maxPts: 0.25,
    },
    {
      content: "Có thái độ tốt và đánh giá được sản phẩm sau khi nhận góp ý từ BGK",
      maxPts: 0.25,
    },
    {
      catTitle: "Giải quyết vấn đề\n(1 điểm)",
      content: "Ý tưởng real-world giải quyết được các vấn đề xã hội.",
      maxPts: 0.25,
    },
    {
      content:
        "Giải quyết được các vấn đề không lập trình bảo đảm không bị lỗi khi thực thi.",
      maxPts: 0.5,
    },
    {
      content: "Trả lời tốt các vấn đề mà BGK đặt ra về cách lập trình dự án",
      maxPts: 0.25,
    },
    {
      catTitle: "Kỹ năng sử dụng máy tính\n(1,0 điểm)",
      content:
        "Quản lý tốt các tài nguyên của dự án (lưu trữ hình ảnh, đặt tên file, ...)",
      maxPts: 0.125,
    },
    {
      content: "Đường dẫn trải nghiệm dự án: (Video Demo độ dài 1 - 3 phút/ link tải)",
      maxPts: 0.125,
    },
    {
      content: "Thiết kế bài trình chiếu có hiệu ứng sinh động, không có lỗi định dạng",
      maxPts: 0.25,
    },
    {
      content:
        "Bài trình chiếu mô tả được nội dung của dự án, hỗ trợ tốt cho việc thuyết trình",
      maxPts: 0.25,
    },
    {
      content: "Có ứng dụng các công cụ chỉnh sửa ảnh và xây dựng giao diện đồ họa.",
      maxPts: 0.25,
    },
  ];

  const rowsXml: string[] = [];

  // Row 1: Title Banner
  rowsXml.push(
    `<row r="1" ht="30" customHeight="1">` +
      cellStr("A1", 1, sheetTitle) +
      cellStr("B1", 1, "") +
      cellStr("C1", 1, "") +
      cellStr("D1", 1, "") +
      cellStr("E1", 1, "") +
      cellStr("F1", 1, "") +
      `</row>`
  );

  // Rows 2-5: Student & Demo Metadata
  rowsXml.push(
    `<row r="2" ht="22" customHeight="1">` +
      cellStr("A2", 2, "Họ và tên Học viên:") +
      cellStr("B2", 3, studentName) +
      `</row>`
  );
  rowsXml.push(
    `<row r="3" ht="20" customHeight="1">` +
      cellStr("A3", 2, "Ngày Demo:") +
      cellStr("B3", 4, demoDate) +
      `</row>`
  );
  rowsXml.push(
    `<row r="4" ht="20" customHeight="1">` +
      cellStr("A4", 2, "Ngày đánh giá:") +
      cellStr("B4", 4, evalDate) +
      `</row>`
  );
  rowsXml.push(
    `<row r="5" ht="22" customHeight="1">` +
      cellStr("A5", 2, "Tổng điểm đạt được:") +
      cellFormula("B5", 3, 'F8&" / 5"', "5 / 5", true) +
      `</row>`
  );

  // Rows 6-7: Table Headers
  rowsXml.push(
    `<row r="6" ht="24" customHeight="1">` +
      cellStr("A6", 5, "Tiêu chí đầu ra") +
      cellStr("B6", 5, "Nội dung") +
      cellStr("C6", 5, "Điểm tối đa") +
      cellStr("D6", 5, "Mức độ đạt được") +
      cellStr("E6", 5, "Điểm đạt được") +
      cellStr("F6", 5, "Tổng Điểm") +
      `</row>`
  );
  rowsXml.push(
    `<row r="7" ht="20" customHeight="1">` +
      cellStr("A7", 5, "") +
      cellStr("B7", 5, "") +
      cellStr("C7", 5, "") +
      cellStr("D7", 5, "(Chưa đạt - Hoàn thành - Tốt)") +
      cellStr("E7", 5, "") +
      cellStr("F7", 5, "") +
      `</row>`
  );

  // Rows 8-27: 20 Criteria Rows
  criteriaRows.forEach((item, idx) => {
    const r = 8 + idx;
    const catCell = item.catTitle
      ? cellStr(`A${r}`, 6, item.catTitle)
      : cellStr(`A${r}`, 6, "");
    const totalCell =
      r === 8
        ? cellFormula("F8", 9, "SUM(E8:E27)", 5, false)
        : cellStr(`F${r}`, 9, "");

    rowsXml.push(
      `<row r="${r}" ht="26" customHeight="1">` +
        catCell +
        cellStr(`B${r}`, 7, item.content) +
        cellNum(`C${r}`, 8, item.maxPts) +
        cellStr(`D${r}`, 8, "Tốt") +
        cellNum(`E${r}`, 8, item.maxPts) +
        totalCell +
        `</row>`
    );
  });

  // Row 28: Spacer
  rowsXml.push(`<row r="28" ht="14" customHeight="1"/>`);

  // Rows 29-30: Judge Comments (Nhận xét BGK1 / BGK2)
  rowsXml.push(
    `<row r="29" ht="22" customHeight="1">` +
      cellStr("A29", 2, "") +
      cellStr("B29", 5, "Nhận xét") +
      cellStr("C29", 5, "") +
      `</row>`
  );
  rowsXml.push(
    `<row r="30" ht="45" customHeight="1">` +
      cellStr("A30", 7, "") +
      cellStr("B30", 7, "BGK1") +
      cellStr("C30", 7, "BGK2") +
      `</row>`
  );

  // Rows 31-36: LOs Summary Table
  rowsXml.push(
    `<row r="31" ht="22" customHeight="1">` +
      cellStr("A31", 5, "LOs") +
      cellStr("B31", 5, "Tổng điểm") +
      cellStr("C31", 5, "Tỉ trọng") +
      `</row>`
  );
  const losRows: Array<{ label: string; formula: string; val: number; weight: number }> = [
    {
      label: "Tư duy thuật toán, tư duy máy tính",
      formula: "SUM(E8:E13)",
      val: 1.5,
      weight: 0.3,
    },
    {
      label: "Kỹ năng sử dụng máy tính",
      formula: "SUM(E23:E27)",
      val: 1,
      weight: 0.2,
    },
    { label: "Tư duy sáng tạo", formula: "SUM(E14:E17)", val: 1, weight: 0.2 },
    { label: "Giải quyết vấn đề", formula: "SUM(E20:E22)", val: 1, weight: 0.2 },
    {
      label: "Thể hiện khả năng giao tiếp, hợp tác",
      formula: "SUM(E18:E19)",
      val: 0.5,
      weight: 0.1,
    },
  ];
  losRows.forEach((lo, idx) => {
    const r = 32 + idx;
    rowsXml.push(
      `<row r="${r}" ht="20" customHeight="1">` +
        cellStr(`A${r}`, 7, lo.label) +
        cellFormula(`B${r}`, 8, lo.formula, lo.val, false) +
        cellNum(`C${r}`, 8, lo.weight) +
        `</row>`
    );
  });

  const merges = [
    "A1:F1",
    "A6:A7",
    "B6:B7",
    "C6:C7",
    "E6:E7",
    "F6:F7",
    "A8:A13",
    "A14:A17",
    "A18:A19",
    "A20:A22",
    "A23:A27",
    "F8:F27",
  ];

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetViews><sheetView${isFirstTab ? ' tabSelected="1"' : ""} workbookViewId="0"/></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="18"/>` +
    `<cols>` +
    `<col min="1" max="1" width="28" customWidth="1"/>` +
    `<col min="2" max="2" width="56" customWidth="1"/>` +
    `<col min="3" max="3" width="14" customWidth="1"/>` +
    `<col min="4" max="4" width="28" customWidth="1"/>` +
    `<col min="5" max="5" width="15" customWidth="1"/>` +
    `<col min="6" max="6" width="14" customWidth="1"/>` +
    `</cols>` +
    `<sheetData>${rowsXml.join("")}</sheetData>` +
    `<mergeCells count="${merges.length}">` +
    merges.map((m) => `<mergeCell ref="${m}"/>`).join("") +
    `</mergeCells>` +
    `<dataValidations count="1">` +
    `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="D8:D27">` +
    `<formula1>"Chưa đạt,Hoàn thành,Tốt"</formula1>` +
    `</dataValidation>` +
    `</dataValidations>` +
    `</worksheet>`
  );
}

function buildStylesXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="5">` +
    `<font><sz val="11"/><name val="Arial"/></font>` +
    `<font><b/><sz val="14"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>` +
    `<font><b/><sz val="11"/><color rgb="FF1E293B"/><name val="Arial"/></font>` +
    `<font><b/><sz val="11"/><color rgb="FF0F766E"/><name val="Arial"/></font>` +
    `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>` +
    `</fonts>` +
    `<fills count="5">` +
    `<fill><patternFill patternType="none"/></fill>` +
    `<fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FF0F172A"/></patternFill></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FF0D9488"/></patternFill></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/></patternFill></fill>` +
    `</fills>` +
    `<borders count="2">` +
    `<border><left/><right/><top/><bottom/><diagonal/></border>` +
    `<border>` +
    `<left style="thin"><color rgb="FFCBD5E1"/></left>` +
    `<right style="thin"><color rgb="FFCBD5E1"/></right>` +
    `<top style="thin"><color rgb="FFCBD5E1"/></top>` +
    `<bottom style="thin"><color rgb="FFCBD5E1"/></bottom>` +
    `<diagonal/>` +
    `</border>` +
    `</borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="10">` +
    // 0: default
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    // 1: Title Banner (Font 1 white bold 14pt, Fill 2 dark navy, centered)
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>` +
    // 2: Meta Label (Font 2 bold)
    `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>` +
    // 3: Meta Highlight Value (Font 3 teal bold)
    `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>` +
    // 4: Meta Normal Value
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>` +
    // 5: Table Header (Font 4 white bold, Fill 3 teal, border 1, centered wrap)
    `<xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>` +
    // 6: Category Merged Column (Font 2 bold, Fill 4 light slate, border 1, centered wrap)
    `<xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>` +
    // 7: Criteria Content (Font 0, border 1, left wrap)
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>` +
    // 8: Centered Score / Dropdown Cell (Font 0, border 1, centered)
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>` +
    // 9: Total Score Merged Column F (Font 3 bold teal, Fill 4, border 1, centered)
    `<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>` +
    `</cellXfs>` +
    `</styleSheet>`
  );
}

/**
 * Replaces the value of a specific cell (`cellRef`, e.g., "A1", "B2", "B3", "B4") inside an existing OpenXML worksheet XML string
 * while preserving the cell's `s="..."` style attribute!
 */
function replaceXmlCellWithInlineString(
  sheetXml: string,
  cellRef: string,
  newValue: string
): string {
  const escapedVal = escapeXml(newValue);
  // Match either `<c r="B2" ...>...</c>` or self-closing `<c r="B2" .../>`
  const fullCellRegex = new RegExp(
    `<c\\b([^>]*?\\br="${cellRef}"[^>]*?)>(?:[\\s\\S]*?)<\\/c>|<c\\b([^>]*?\\br="${cellRef}"[^>]*?)\\/>`,
    "i"
  );
  return sheetXml.replace(fullCellRegex, (_match, attrs1, attrs2) => {
    const rawAttrs = String(attrs1 || attrs2 || "");
    const styleMatch = rawAttrs.match(/\bs="(\d+)"/);
    const styleAttr = styleMatch ? ` s="${styleMatch[1]}"` : "";
    return `<c r="${cellRef}"${styleAttr} t="inlineStr"><is><t>${escapedVal}</t></is></c>`;
  });
}

/**
 * Clones the first worksheet of an existing `.xlsx` template buffer into `studentTabs.length` tabs,
 * updating `A1` (Title), `B2` (Student Name), `B3` (Demo Date), and `B4` (Eval Date) in each tab
 * while preserving 100% of the template's styles, merged cells, formulas, and column widths.
 */
function cloneTemplateXlsxBufferForStudents(params: {
  templateBuffer: Buffer;
  sheetTitle: string;
  demoDate: string;
  evalDate: string;
  studentTabs: DemoSheetStudentTab[];
}): Buffer {
  const { templateBuffer, sheetTitle, demoDate, evalDate, studentTabs } = params;
  const zip = new AdmZip(templateBuffer);
  const baseSheetEntry =
    zip.getEntry("xl/worksheets/sheet1.xml") ||
    zip
      .getEntries()
      .find((e) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(e.entryName));

  if (!baseSheetEntry) {
    throw new Error("Tệp Google Sheet mẫu không chứa worksheet hợp lệ.");
  }

  const baseSheetXml = baseSheetEntry.getData().toString("utf8");

  // Capture any extra sheets (e.g. sheet2.xml = "Phân bổ điểm") so we can append them after student tabs
  const extraSheets: Array<{ name: string; xml: string }> = [];
  const workbookEntryInit = zip.getEntry("xl/workbook.xml");
  const wbRelsEntryInit = zip.getEntry("xl/_rels/workbook.xml.rels");
  if (workbookEntryInit && wbRelsEntryInit) {
    const wbXmlInit = workbookEntryInit.getData().toString("utf8");
    const relsXmlInit = wbRelsEntryInit.getData().toString("utf8");
    const sheetTags = Array.from(wbXmlInit.matchAll(/<sheet\b([^>]*?)\/>/gi));
    for (let i = 1; i < sheetTags.length; i++) {
      const attrs = sheetTags[i][1] || "";
      const nameMatch = attrs.match(/\bname="([^"]+)"/i);
      const rIdMatch = attrs.match(/\br:id="([^"]+)"/i);
      if (nameMatch && rIdMatch) {
        const relMatch = new RegExp(
          `<Relationship\\b[^>]*?\\bId="${rIdMatch[1]}"[^>]*?\\bTarget="([^"]+)"`,
          "i"
        ).exec(relsXmlInit);
        if (relMatch?.[1]) {
          const entryPath = relMatch[1].startsWith("xl/")
            ? relMatch[1]
            : `xl/${relMatch[1].replace(/^\/+/, "")}`;
          const extraEntry = zip.getEntry(entryPath);
          if (extraEntry) {
            extraSheets.push({
              name: nameMatch[1],
              xml: extraEntry.getData().toString("utf8"),
            });
          }
        }
      }
    }
  }

  // Remove existing worksheet entries, calcChain.xml, and GoogleSheets binary metadata
  for (const entry of zip.getEntries()) {
    if (
      /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.entryName) ||
      entry.entryName === "xl/calcChain.xml" ||
      entry.entryName === "xl/metadata"
    ) {
      zip.deleteFile(entry.entryName);
    }
  }

  const baseSheetRelsEntry = zip.getEntry("xl/worksheets/_rels/sheet1.xml.rels");
  const baseSheetRelsXml = baseSheetRelsEntry
    ? baseSheetRelsEntry.getData().toString("utf8")
    : null;

  studentTabs.forEach((stu, idx) => {
    const sheetNum = idx + 1;
    let xml = baseSheetXml;
    if (idx > 0) {
      xml = xml.replace(/\btabSelected="1"/g, 'tabSelected="0"');
      xml = xml.replace(
        /xr:uid="\{00000000-0001-0000-0100-000000000000\}"/g,
        `xr:uid="{00000000-0001-0000-${String(sheetNum).padStart(4, "0")}-000000000000}"`
      );
    }
    xml = replaceXmlCellWithInlineString(xml, "A1", sheetTitle);
    xml = replaceXmlCellWithInlineString(xml, "B2", stu.fullName);
    xml = replaceXmlCellWithInlineString(xml, "B3", demoDate);
    xml = replaceXmlCellWithInlineString(xml, "B4", evalDate);

    zip.addFile(`xl/worksheets/sheet${sheetNum}.xml`, Buffer.from(xml, "utf8"));
    if (baseSheetRelsXml && sheetNum > 1) {
      zip.addFile(
        `xl/worksheets/_rels/sheet${sheetNum}.xml.rels`,
        Buffer.from(baseSheetRelsXml, "utf8")
      );
    }
  });

  extraSheets.forEach((extra, idx) => {
    const sheetNum = studentTabs.length + idx + 1;
    const xml = extra.xml.replace(/\btabSelected="1"/g, 'tabSelected="0"');
    zip.addFile(`xl/worksheets/sheet${sheetNum}.xml`, Buffer.from(xml, "utf8"));
  });

  const allSheetDescriptors = [
    ...studentTabs.map((stu, idx) => ({
      name: stu.tabName,
      sheetNum: idx + 1,
    })),
    ...extraSheets.map((extra, idx) => ({
      name: extra.name,
      sheetNum: studentTabs.length + idx + 1,
    })),
  ];

  // Update xl/workbook.xml `<sheets>...</sheets>` and remove GoogleSheetsCustomDataVersion2 checksum
  const workbookEntry = zip.getEntry("xl/workbook.xml");
  if (workbookEntry) {
    let wbXml = workbookEntry.getData().toString("utf8");
    const sheetsXml =
      `<sheets>` +
      allSheetDescriptors
        .map(
          (desc) =>
            `<sheet name="${escapeXml(desc.name)}" sheetId="${desc.sheetNum}" r:id="rIdStuSheet${desc.sheetNum}"/>`
        )
        .join("") +
      `</sheets>`;
    wbXml = wbXml.replace(/<sheets>[\s\S]*?<\/sheets>/i, sheetsXml);
    wbXml = wbXml.replace(
      /<ext\b[^>]*?uri="GoogleSheetsCustomDataVersion2"[^>]*?>[\s\S]*?<\/ext>/gi,
      ""
    );
    zip.updateFile("xl/workbook.xml", Buffer.from(wbXml, "utf8"));
  }

  // Update xl/_rels/workbook.xml.rels
  const wbRelsEntry = zip.getEntry("xl/_rels/workbook.xml.rels");
  if (wbRelsEntry) {
    let relsXml = wbRelsEntry.getData().toString("utf8");
    // Remove old worksheet, calcChain, and workbookmetadata relationships
    relsXml = relsXml.replace(
      /<Relationship\b[^>]*?Type="[^"]*?\/(?:worksheet|calcChain|workbookmetadata)"[^>]*?\/>/gi,
      ""
    );
    const newRels = allSheetDescriptors
      .map(
        (desc) =>
          `<Relationship Id="rIdStuSheet${desc.sheetNum}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${desc.sheetNum}.xml"/>`
      )
      .join("");
    relsXml = relsXml.replace(/<\/Relationships>/i, `${newRels}</Relationships>`);
    zip.updateFile("xl/_rels/workbook.xml.rels", Buffer.from(relsXml, "utf8"));
  }

  // Update [Content_Types].xml
  const ctEntry = zip.getEntry("[Content_Types].xml");
  if (ctEntry) {
    let ctXml = ctEntry.getData().toString("utf8");
    ctXml = ctXml.replace(
      /<Override\b[^>]*?PartName="\/xl\/(?:worksheets\/sheet\d+\.xml|calcChain\.xml|metadata)"[^>]*?\/>/gi,
      ""
    );
    const newOverrides = allSheetDescriptors
      .map(
        (desc) =>
          `<Override PartName="/xl/worksheets/sheet${desc.sheetNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      )
      .join("");
    ctXml = ctXml.replace(/<\/Types>/i, `${newOverrides}</Types>`);
    zip.updateFile("[Content_Types].xml", Buffer.from(ctXml, "utf8"));
  }

  return zip.toBuffer();
}

export const DEFAULT_DEMO_SHEET_TEMPLATE_PATH = path.resolve(
  process.cwd(),
  "data/config/default-demo-sheet-template.xlsx"
);

export const COURSE_DEMO_SHEET_TEMPLATES_DIR = path.resolve(
  process.cwd(),
  "data/config/demo-sheet-templates"
);

function unescapeXmlEntities(raw: string): string {
  return String(raw || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
}

export function validateTemplateWorkbookBuffer(
  buf: Buffer | null | undefined,
  sourceLabel: string
): Buffer {
  if (
    !buf ||
    buf.length < 120 ||
    buf[0] !== 0x50 ||
    buf[1] !== 0x4b
  ) {
    throw new Error(
      `Mẫu bảng chấm điểm Demo từ '${sourceLabel}' không hợp lệ hoặc không thể tải xuống (không phải gói bảng tính chuẩn).`
    );
  }
  let zip: AdmZip;
  try {
    zip = new AdmZip(buf);
  } catch {
    throw new Error(
      `Mẫu bảng chấm điểm Demo từ '${sourceLabel}' bị hỏng định dạng nén.`
    );
  }
  const wbEntry = zip.getEntry("xl/workbook.xml");
  const sheetEntry =
    zip.getEntry("xl/worksheets/sheet1.xml") ||
    zip
      .getEntries()
      .find((e) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(e.entryName));
  if (!wbEntry || !sheetEntry) {
    throw new Error(
      `Mẫu bảng chấm điểm Demo từ '${sourceLabel}' thiếu cấu trúc xl/workbook.xml hoặc worksheet.`
    );
  }
  const wbXml = wbEntry.getData().toString("utf8");
  const sheetXml = sheetEntry.getData().toString("utf8");
  if (!/<sheet\b/i.test(wbXml) || !/<worksheet\b/i.test(sheetXml)) {
    throw new Error(
      `Mẫu bảng chấm điểm Demo từ '${sourceLabel}' có nội dung XML bảng tính không hợp lệ.`
    );
  }
  return buf;
}

export function getSavedCourseTemplatePath(classIdOrPrefix?: string): string | null {
  const prefix =
    detectCoursePrefixFromClassId(String(classIdOrPrefix || "")) ||
    String(classIdOrPrefix || "")
      .trim()
      .toUpperCase();

  const candidateTemplateDirs: string[] = [];
  if (process.env.MINDX_CONFIG_DIR) {
    candidateTemplateDirs.push(
      path.resolve(process.env.MINDX_CONFIG_DIR, "demo-sheet-templates")
    );
  }
  candidateTemplateDirs.push(
    path.resolve(process.cwd(), "data/config/demo-sheet-templates"),
    COURSE_DEMO_SHEET_TEMPLATES_DIR
  );

  if (prefix && /^[A-Z0-9]{2,6}$/.test(prefix)) {
    for (const dir of candidateTemplateDirs) {
      const coursePath = path.join(dir, `${prefix}.xlsx`);
      if (fs.existsSync(coursePath)) {
        return coursePath;
      }
    }
    // Never substitute another course's template (default-demo-sheet-template.xlsx is PTA's template)
    if (prefix === "PTA") {
      const candidateDefaults = [
        ...(process.env.MINDX_CONFIG_DIR
          ? [path.resolve(process.env.MINDX_CONFIG_DIR, "default-demo-sheet-template.xlsx")]
          : []),
        path.resolve(process.cwd(), "data/config/default-demo-sheet-template.xlsx"),
        DEFAULT_DEMO_SHEET_TEMPLATE_PATH,
      ];
      for (const defPath of candidateDefaults) {
        if (fs.existsSync(defPath)) return defPath;
      }
    }
    return null;
  }
  if (!prefix && fs.existsSync(DEFAULT_DEMO_SHEET_TEMPLATE_PATH)) {
    return DEFAULT_DEMO_SHEET_TEMPLATE_PATH;
  }
  return null;
}

/**
 * Builds the complete `.xlsx` workbook Buffer for a class (1 tab per student).
 * Uses `templateBuffer` if provided, or `data/config/demo-sheet-templates/<COURSE>.xlsx` / `default-demo-sheet-template.xlsx` if available.
 * Never silently substitutes PTA's built-in rubric when a non-PTA course lacks a valid template or when an explicit template is corrupt.
 */
export function buildDemoScoringWorkbookBuffer(params: {
  classId?: string;
  sheetTitle: string;
  demoDate: string;
  evalDate: string;
  studentTabs: DemoSheetStudentTab[];
  templateBuffer?: Buffer | null;
}): Buffer {
  const { classId, sheetTitle, demoDate, evalDate, studentTabs, templateBuffer } = params;
  const effectiveTabs =
    studentTabs.length > 0
      ? studentTabs
      : [{ studentId: "STU_01", fullName: "Nguyễn Văn A", tabName: "Nguyễn Văn A" }];

  const coursePrefix = detectCoursePrefixFromClassId(String(classId || ""));

  if (templateBuffer !== undefined && templateBuffer !== null) {
    const validated = validateTemplateWorkbookBuffer(templateBuffer, "templateBuffer");
    return cloneTemplateXlsxBufferForStudents({
      templateBuffer: validated,
      sheetTitle,
      demoDate,
      evalDate,
      studentTabs: effectiveTabs,
    });
  }

  let resolvedTemplateBuffer: Buffer | null = null;
  const savedTemplatePath = getSavedCourseTemplatePath(classId || "PTA");
  if (savedTemplatePath) {
    const rawSaved = fs.readFileSync(savedTemplatePath);
    resolvedTemplateBuffer = validateTemplateWorkbookBuffer(rawSaved, savedTemplatePath);
  }

  if (resolvedTemplateBuffer && resolvedTemplateBuffer.length > 0) {
    return cloneTemplateXlsxBufferForStudents({
      templateBuffer: resolvedTemplateBuffer,
      sheetTitle,
      demoDate,
      evalDate,
      studentTabs: effectiveTabs,
    });
  }

  if (coursePrefix && coursePrefix !== "PTA") {
    throw new Error(
      `Khóa học '${coursePrefix}' của lớp '${classId}' chưa có mẫu bảng chấm điểm Demo hợp lệ. Hệ thống dừng lại để không dùng nhầm tiêu chí của PTA.`
    );
  }

  const zip = new AdmZip();

  const contentTypesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    effectiveTabs
      .map(
        (_stu, idx) =>
          `<Override PartName="/xl/worksheets/sheet${
            idx + 1
          }.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      )
      .join("") +
    `</Types>`;

  const rootRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>` +
    effectiveTabs
      .map(
        (stu, idx) =>
          `<sheet name="${escapeXml(stu.tabName)}" sheetId="${idx + 1}" r:id="rIdSheet${
            idx + 1
          }"/>`
      )
      .join("") +
    `</sheets>` +
    `</workbook>`;

  const workbookRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    effectiveTabs
      .map(
        (_stu, idx) =>
          `<Relationship Id="rIdSheet${
            idx + 1
          }" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${
            idx + 1
          }.xml"/>`
      )
      .join("") +
    `</Relationships>`;

  zip.addFile("[Content_Types].xml", Buffer.from(contentTypesXml, "utf8"));
  zip.addFile("_rels/.rels", Buffer.from(rootRelsXml, "utf8"));
  zip.addFile("xl/workbook.xml", Buffer.from(workbookXml, "utf8"));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(workbookRelsXml, "utf8"));
  zip.addFile("xl/styles.xml", Buffer.from(buildStylesXml(), "utf8"));

  effectiveTabs.forEach((stu, idx) => {
    const sheetXml = buildStandardStudentWorksheetXml({
      sheetTitle,
      studentName: stu.fullName,
      demoDate,
      evalDate,
      isFirstTab: idx === 0,
    });
    zip.addFile(`xl/worksheets/sheet${idx + 1}.xml`, Buffer.from(sheetXml, "utf8"));
  });

  return zip.toBuffer();
}

function isDemoSheetStopped(): boolean {
  return (
    taskQueue.getStatus().isStopped ||
    (process as any)?.__mindxQueueStopped === true
  );
}

function assertDemoSheetNotStopped(): void {
  if (isDemoSheetStopped()) {
    throw new Error(
      "Đã dừng tác vụ tạo Google Trang tính chấm điểm Demo theo lệnh Dừng khẩn cấp (Stop Bot)."
    );
  }
}
interface DriveFolderItemSummary {
  id: string;
  name: string;
  isFolder: boolean;
  isExcelFile: boolean;
  isGoogleSheet: boolean;
}

interface InMemoryWorkbookPayload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

function extractSheetTabNamesFromWorkbookBuffer(buf: Buffer): string[] {
  try {
    const zip = new AdmZip(buf);
    const wbEntry = zip.getEntry("xl/workbook.xml");
    if (!wbEntry) return [];
    const wbXml = wbEntry.getData().toString("utf8");
    return Array.from(wbXml.matchAll(/<sheet\b[^>]*?\bname="([^"]+)"/gi)).map((m) =>
      unescapeXmlEntities(m[1]).trim()
    );
  } catch {
    return [];
  }
}

/**
 * Lists items in a Google Drive folder DOM and distinguishes native Google Sheets from Excel `.xlsx` files.
 */
async function listDriveFilesInFolder(
  page: Page,
  parentFolderId: string
): Promise<DriveFolderItemSummary[]> {
  try {
    return await page.evaluate((expectedParentId) => {
      const mainEl = document.querySelector('[role="main"]') as HTMLElement | null;
      if (!mainEl) return [];
      const exactLabelById = new Map<string, string>();
      for (const el of Array.from(mainEl.querySelectorAll("[data-id]"))) {
        const id = el.getAttribute("data-id") || "";
        if (!id || id.length < 15 || id === expectedParentId) continue;
        if (el.getAttribute("data-target") === "doc") continue;
        const txt = ((el as HTMLElement).innerText || "").trim();
        if (txt && !txt.includes("\n") && !txt.includes("\t")) {
          exactLabelById.set(id, txt);
        }
      }
      const out: DriveFolderItemSummary[] = [];
      for (const el of Array.from(mainEl.querySelectorAll('[data-target="doc"][data-id]'))) {
        const id = el.getAttribute("data-id") || "";
        if (!id || id.length < 15 || id === "EBS5u" || id === expectedParentId) continue;
        const rawText = (el as HTMLElement).innerText || el.getAttribute("aria-label") || "";
        const ariaLower = (el.getAttribute("aria-label") || "").toLowerCase();
        const dataType = (el.getAttribute("data-type") || "").toLowerCase();
        const dataMime = (
          el.getAttribute("data-mime-type") ||
          el.getAttribute("data-mimetype") ||
          ""
        ).toLowerCase();
        const htmlLower = (el.innerHTML || "").toLowerCase();
        const name =
          exactLabelById.get(id) ||
          rawText
            .split(/[\r\n\t]+/)
            .map((s) => s.trim())
            .filter(
              (s) =>
                Boolean(s) &&
                s !== "Shared folder" &&
                s !== "Thư mục được chia sẻ" &&
                s !== "Thư mục" &&
                s !== "Folder"
            )[0] ||
          "";
        if (!name) continue;

        const isFolder =
          dataType === "folder" ||
          dataMime === "application/vnd.google-apps.folder" ||
          ariaLower.startsWith("thư mục ") ||
          ariaLower.startsWith("folder ") ||
          ariaLower.includes("google drive folder");
        const isExcelFile =
          !isFolder &&
          (/\.xls[xm]?$/i.test(name) ||
            dataMime.includes("spreadsheetml") ||
            dataMime.includes("ms-excel") ||
            ariaLower.includes("microsoft excel"));
        const isGoogleSheet =
          !isFolder &&
          !isExcelFile &&
          (dataMime === "application/vnd.google-apps.spreadsheet" ||
            dataType === "spreadsheet" ||
            ariaLower.includes("google trang tính") ||
            ariaLower.includes("google sheets") ||
            htmlLower.includes("spreadsheet"));

        out.push({ id, name, isFolder, isExcelFile, isGoogleSheet });
      }
      return out;
    }, parentFolderId);
  } catch {
    return [];
  }
}

async function ensureDriveFolderReady(
  page: Page,
  driveBaseUrl: string,
  folderId: string
): Promise<void> {
  const targetUrl = `${driveBaseUrl}/drive/folders/${folderId}`;
  if (!page.url().includes(`/folders/${folderId}`)) {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  }
  const newBtn = page
    .locator(
      'button[guidedhelpid="new_menu_button"]:visible, button[aria-label="Mới"]:visible, button[aria-label="New"]:visible'
    )
    .first();
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    assertDemoSheetNotStopped();
    if (await newBtn.isVisible().catch(() => false)) return;
    await page.waitForTimeout(600);
  }
  throw new Error(
    "Chưa phát hiện nút '+ Mới' trên Google Drive. Vui lòng kiểm tra đăng nhập Google trên trình duyệt của Bot."
  );
}

async function moveDriveItemToTrash(
  page: Page,
  driveBaseUrl: string,
  classDriveFolderId: string,
  itemId: string
): Promise<boolean> {
  if (!itemId) return true;
  if (!page.url().includes(`/folders/${classDriveFolderId}`)) {
    await page
      .goto(`${driveBaseUrl}/drive/folders/${classDriveFolderId}`, {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      })
      .catch(() => {});
    await page.waitForTimeout(900);
  }

  const row = page.locator(`[role="main"] [data-target="doc"][data-id="${itemId}"]`).first();
  if (!(await row.isVisible().catch(() => false))) {
    const listed = await listDriveFilesInFolder(page, classDriveFolderId);
    return !listed.some((i) => i.id === itemId);
  }

  await row.click({ button: "right" }).catch(() => {});
  await page.waitForTimeout(350);
  const trashItem = page
    .locator(
      '[role="menuitem"]:has-text("Chuyển vào thùng rác"):visible, [role="menuitem"]:has-text("Đưa vào thùng rác"):visible, [role="menuitem"]:has-text("Move to trash"):visible, [role="menuitem"]:has-text("Move to bin"):visible'
    )
    .first();
  if (await trashItem.isVisible().catch(() => false)) {
    await trashItem.click().catch(() => {});
  } else {
    await page.keyboard.press("Escape").catch(() => {});
    await row.click().catch(() => {});
    await page.keyboard.press("Delete").catch(() => {});
  }

  await page.waitForTimeout(450);
  const confirmBtn = page
    .locator(
      '[role="dialog"] button:has-text("Chuyển vào thùng rác"):visible, [role="dialog"] button:has-text("Move to trash"):visible, [role="dialog"] button:has-text("Xóa"):visible'
    )
    .first();
  if (await confirmBtn.isVisible().catch(() => false)) {
    await confirmBtn.click().catch(() => {});
  }

  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    assertDemoSheetNotStopped();
    await page.waitForTimeout(500);
    const listed = await listDriveFilesInFolder(page, classDriveFolderId);
    if (!listed.some((i) => i.id === itemId)) return true;
  }
  return false;
}

async function renameAndVerifyNativeGoogleSheetEditor(
  sheetPage: Page,
  expectedTitle: string,
  expectedTabNames: string[]
): Promise<void> {
  const titleInput = sheetPage
    .locator('input.docs-title-input, #docs-title-widget input')
    .first();
  await titleInput.waitFor({ state: "visible", timeout: 30000 });

  const tabDeadline = Date.now() + 25_000;
  let actualTabs: string[] = [];
  while (Date.now() < tabDeadline) {
    assertDemoSheetNotStopped();
    const state = await sheetPage
      .evaluate(() => {
        const badges = Array.from(
          document.querySelectorAll(
            ".docs-CommonBadge, #docs-titlebar-badges [aria-label], .docs-title-outer [aria-label]"
          )
        );
        const hasXlsxBadge = badges.some((el) => {
          const txt = ((el as HTMLElement).innerText || "").trim().toLowerCase();
          const aria = (el.getAttribute("aria-label") || "").trim().toLowerCase();
          return txt === ".xlsx" || txt === "xlsx" || aria.includes("microsoft excel");
        });
        const tabs = Array.from(document.querySelectorAll(".docs-sheet-tab-name"))
          .map((el) => ((el as HTMLElement).innerText || el.textContent || "").trim())
          .filter(Boolean);
        return { hasXlsxBadge, tabs };
      })
      .catch(() => ({ hasXlsxBadge: false, tabs: [] as string[] }));

    if (state.hasXlsxBadge) {
      throw new Error(
        "Tệp đang mở ở chế độ tương thích Microsoft Excel (.XLSX), không phải Google Trang tính chuẩn."
      );
    }
    actualTabs = state.tabs;
    const actualLower = new Set(actualTabs.map((t) => t.toLowerCase()));
    if (
      expectedTabNames.length === 0 ||
      expectedTabNames.every((t) => actualLower.has(t.trim().toLowerCase()))
    ) {
      break;
    }
    await sheetPage.waitForTimeout(500);
  }

  const actualLower = new Set(actualTabs.map((t) => t.toLowerCase()));
  const missingTabs = expectedTabNames.filter(
    (t) => !actualLower.has(t.trim().toLowerCase())
  );
  if (missingTabs.length > 0) {
    throw new Error(
      `Google Trang tính thiếu tab học viên sau khi nhập dữ liệu: ${missingTabs.join(", ")}.`
    );
  }

  const cleanTitle = expectedTitle.replace(/\.xls[xm]?$/i, "").trim();
  const curTitle = (await titleInput.inputValue().catch(() => "")).trim();
  if (curTitle !== cleanTitle) {
    await titleInput.click();
    await sheetPage.waitForTimeout(150);
    await titleInput.fill(cleanTitle);
    await titleInput.press("Enter");
    await sheetPage.waitForTimeout(600);
  }

  const finalTitle = (await titleInput.inputValue().catch(() => "")).trim();
  if (finalTitle !== cleanTitle || /\.xls[xm]?$/i.test(finalTitle)) {
    throw new Error(
      `Tên Google Trang tính sau khi đổi ('${finalTitle}') không khớp '${cleanTitle}'.`
    );
  }

  // Wait briefly if Google Sheets is still actively saving changes to Drive
  const saveDeadline = Date.now() + 10_000;
  while (Date.now() < saveDeadline) {
    assertDemoSheetNotStopped();
    const saveState = await sheetPage
      .evaluate(() => {
        const nodes = Array.from(
          document.querySelectorAll(
            '#docs-save-indicator-badge, .docs-save-indicator-caption, [aria-label*="Drive"], [aria-label*="Lưu"], [aria-label*="Save"]'
          )
        );
        const text = nodes
          .map(
            (el) =>
              `${(el as HTMLElement).innerText || ""} ${el.getAttribute("aria-label") || ""}`
          )
          .join(" ")
          .toLowerCase();
        if (text.includes("lỗi lưu") || text.includes("error saving") || text.includes("can't save")) {
          return "error";
        }
        if (text.includes("đang lưu") || text.includes("saving")) {
          return "saving";
        }
        return "settled";
      })
      .catch(() => "settled");
    if (saveState === "error") {
      throw new Error("Google Trang tính báo lỗi khi lưu dữ liệu lên Google Drive.");
    }
    if (saveState === "settled") break;
    await sheetPage.waitForTimeout(400);
  }
}

async function createNativeGoogleSheetViaDriveAndImport(params: {
  page: Page;
  driveBaseUrl: string;
  classDriveFolderId: string;
  sheetTitle: string;
  stagingPayload: InMemoryWorkbookPayload;
  expectedTabNames: string[];
  ephemeralDriveIdsToTrash: Set<string>;
}): Promise<string> {
  const {
    page,
    driveBaseUrl,
    classDriveFolderId,
    sheetTitle,
    stagingPayload,
    expectedTabNames,
    ephemeralDriveIdsToTrash,
  } = params;

  await ensureDriveFolderReady(page, driveBaseUrl, classDriveFolderId);
  const newBtn = page
    .locator(
      'button[guidedhelpid="new_menu_button"]:visible, button[aria-label="Mới"]:visible, button[aria-label="New"]:visible'
    )
    .first();
  await newBtn.click();
  await page.waitForTimeout(400);

  const sheetsMenuItem = page
    .locator(
      '[role="menuitem"]:has-text("Google Trang tính"):visible, [role="menuitem"]:has-text("Google Sheets"):visible'
    )
    .first();
  await sheetsMenuItem.waitFor({ state: "visible", timeout: 8000 });

  let openedPopupPage: Page | null = null;
  const popupListener = (p: Page) => {
    if (!openedPopupPage) openedPopupPage = p;
  };
  page.context().on("page", popupListener);

  let sheetPage: Page | null = null;
  let createdSheetId = "";
  try {
    await sheetsMenuItem.click({ position: { x: 28, y: 14 } });

    const openDeadline = Date.now() + 15_000;
    let clickedSharedConfirm = false;
    while (Date.now() < openDeadline && !openedPopupPage) {
      assertDemoSheetNotStopped();
      if (extractGoogleSheetId(page.url())) {
        sheetPage = page;
        break;
      }
      if (!clickedSharedConfirm) {
        const sharedConfirmBtn = page
          .locator(
            '[role="dialog"] button:has-text("Tạo và chia sẻ"):visible, [role="dialog"] button:has-text("Create and share"):visible'
          )
          .first();
        if (await sharedConfirmBtn.isVisible().catch(() => false)) {
          await sharedConfirmBtn.click();
          clickedSharedConfirm = true;
        }
      }
      await page.waitForTimeout(250);
    }
    if (openedPopupPage) sheetPage = openedPopupPage;
  } finally {
    page.context().off("page", popupListener);
  }

  if (!sheetPage) {
    throw new Error("Không mở được trình chỉnh sửa Google Trang tính mới từ Google Drive.");
  }

  try {
    await sheetPage.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
    const idDeadline = Date.now() + 20_000;
    while (Date.now() < idDeadline) {
      assertDemoSheetNotStopped();
      createdSheetId = extractGoogleSheetId(sheetPage.url()) || "";
      if (createdSheetId) break;
      await sheetPage.waitForTimeout(350);
    }
    if (!createdSheetId) {
      throw new Error("Không lấy được Spreadsheet ID của Google Trang tính mới.");
    }

    const fileMenu = sheetPage.locator("#docs-file-menu").first();
    await fileMenu.waitFor({ state: "visible", timeout: 25000 });
    await fileMenu.click();
    await sheetPage.waitForTimeout(400);

    const importItem = sheetPage
      .locator('.goog-menuitem:visible, [role="menuitem"]:visible')
      .filter({ hasText: /^Nhập$|^Import$/i })
      .first();
    await importItem.waitFor({ state: "visible", timeout: 8000 });
    await importItem.click();

    let pickerTarget: Frame | Page | null = null;
    const pickerDeadline = Date.now() + 18_000;
    while (Date.now() < pickerDeadline && !pickerTarget) {
      assertDemoSheetNotStopped();
      for (const frame of sheetPage.frames()) {
        if (frame === sheetPage.mainFrame()) continue;
        const tab = frame
          .locator('[role="tab"]:has-text("Tải lên"), [role="tab"]:has-text("Upload")')
          .first();
        if (await tab.isVisible().catch(() => false)) {
          pickerTarget = frame;
          break;
        }
      }
      if (!pickerTarget) {
        const mainTab = sheetPage
          .locator('[role="tab"]:has-text("Tải lên"):visible, [role="tab"]:has-text("Upload"):visible')
          .first();
        if (await mainTab.isVisible().catch(() => false)) pickerTarget = sheetPage;
      }
      if (!pickerTarget) await sheetPage.waitForTimeout(350);
    }
    if (!pickerTarget) {
      throw new Error("Không tìm thấy hộp thoại Nhập tệp (Google Picker).");
    }

    const uploadTab = pickerTarget
      .locator('[role="tab"]:has-text("Tải lên"), [role="tab"]:has-text("Upload")')
      .first();
    await uploadTab.click();
    await sheetPage.waitForTimeout(400);

    const fileInput = pickerTarget.locator('input[type="file"]').first();
    if ((await fileInput.count().catch(() => 0)) > 0) {
      await fileInput.setInputFiles([stagingPayload]);
    } else {
      const browseBtn = pickerTarget
        .locator(
          'button:has-text("Duyệt qua"), button:has-text("Browse"), [role="button"]:has-text("Duyệt qua"), [role="button"]:has-text("Browse")'
        )
        .first();
      const fcPromise = sheetPage.waitForEvent("filechooser", { timeout: 10000 });
      await browseBtn.click();
      const fc = await fcPromise;
      await fc.setFiles([stagingPayload]);
    }

    const importDialog = sheetPage
      .locator('[role="dialog"]:visible, .modal-dialog:visible')
      .filter({
        hasText: /Nhập tệp|Import file|Vị trí nhập|Import location|Thay thế bảng tính|Replace spreadsheet/i,
      })
      .last();
    await importDialog.waitFor({ state: "visible", timeout: 25000 });

    const nativeSelect = importDialog.locator("select").first();
    if (await nativeSelect.isVisible().catch(() => false)) {
      const val = await nativeSelect
        .evaluate((sel) => {
          const s = sel as HTMLSelectElement;
          const opt = Array.from(s.options).find((o) =>
            /thay thế bảng tính|replace spreadsheet/i.test(o.textContent || "")
          );
          return opt ? opt.value : "";
        })
        .catch(() => "");
      if (val) await nativeSelect.selectOption(val);
    } else {
      const replaceRadio = importDialog
        .locator('[role="radio"], label')
        .filter({ hasText: /Thay thế bảng tính|Replace spreadsheet/i })
        .first();
      if (await replaceRadio.isVisible().catch(() => false)) {
        await replaceRadio.click();
      } else {
        const listbox = importDialog.locator('[role="listbox"], .goog-flat-menu-button').first();
        if (await listbox.isVisible().catch(() => false)) {
          const lbText = (await listbox.innerText().catch(() => "")).trim();
          if (!/Thay thế bảng tính|Replace spreadsheet/i.test(lbText)) {
            await listbox.click();
            await sheetPage.waitForTimeout(250);
            const opt = sheetPage
              .locator('[role="option"]:visible, .goog-menuitem:visible')
              .filter({ hasText: /Thay thế bảng tính|Replace spreadsheet/i })
              .first();
            await opt.waitFor({ state: "visible", timeout: 5000 });
            await opt.click();
          }
        }
      }
    }

    const confirmImportBtn = importDialog
      .locator(
        'button[name="import-data"], button:has-text("Nhập dữ liệu"), button:has-text("Import data"), [role="button"]:has-text("Nhập dữ liệu"), [role="button"]:has-text("Import data")'
      )
      .first();
    await confirmImportBtn.waitFor({ state: "visible", timeout: 8000 });
    await confirmImportBtn.click();

    await renameAndVerifyNativeGoogleSheetEditor(sheetPage, sheetTitle, expectedTabNames);
    return createdSheetId;
  } catch (err) {
    if (createdSheetId) ephemeralDriveIdsToTrash.add(createdSheetId);
    throw err;
  } finally {
    if (sheetPage && sheetPage !== page) {
      await sheetPage.close().catch(() => {});
    }
  }
}

async function createNativeGoogleSheetViaSaveAsFallback(params: {
  page: Page;
  driveBaseUrl: string;
  sheetsBaseUrl: string;
  classDriveFolderId: string;
  sheetTitle: string;
  stagingPayload: InMemoryWorkbookPayload;
  expectedTabNames: string[];
  preExistingIds: Set<string>;
  ephemeralDriveIdsToTrash: Set<string>;
}): Promise<string> {
  const {
    page,
    driveBaseUrl,
    sheetsBaseUrl,
    classDriveFolderId,
    sheetTitle,
    stagingPayload,
    expectedTabNames,
    preExistingIds,
    ephemeralDriveIdsToTrash,
  } = params;

  await ensureDriveFolderReady(page, driveBaseUrl, classDriveFolderId);
  const newBtn = page
    .locator(
      'button[guidedhelpid="new_menu_button"]:visible, button[aria-label="Mới"]:visible, button[aria-label="New"]:visible'
    )
    .first();
  await newBtn.click();
  await page.waitForTimeout(400);

  const fileUploadItem = page
    .locator('[role="menuitem"]:has-text("Tải tệp lên"):visible, [role="menuitem"]:has-text("File upload"):visible')
    .first();
  await fileUploadItem.waitFor({ state: "visible", timeout: 8000 });
  const fcPromise = page.waitForEvent("filechooser", { timeout: 12000 });
  await fileUploadItem.click();
  const fc = await fcPromise;
  await fc.setFiles([stagingPayload]);

  let stagingDriveId = "";
  const stagingLower = stagingPayload.name.toLowerCase();
  const uploadDeadline = Date.now() + 30_000;
  while (Date.now() < uploadDeadline) {
    assertDemoSheetNotStopped();
    await page.waitForTimeout(900);
    const items = await listDriveFilesInFolder(page, classDriveFolderId);
    const found = items.find(
      (i) => !preExistingIds.has(i.id) && i.name.toLowerCase() === stagingLower
    );
    if (found) {
      stagingDriveId = found.id;
      ephemeralDriveIdsToTrash.add(stagingDriveId);
      break;
    }
  }
  if (!stagingDriveId) {
    throw new Error("Không tải được dữ liệu tạm để chuyển sang Google Trang tính.");
  }

  let xlsxPage: Page | null = null;
  let convertedPage: Page | null = null;
  let convertedSheetId = "";
  try {
    xlsxPage = await page.context().newPage();
    await xlsxPage.goto(`${sheetsBaseUrl}/spreadsheets/d/${stagingDriveId}/edit`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    const fileMenu = xlsxPage.locator("#docs-file-menu").first();
    await fileMenu.waitFor({ state: "visible", timeout: 25000 });
    const popupPromise = page.context().waitForEvent("page", { timeout: 25000 });
    await fileMenu.click();
    await xlsxPage.waitForTimeout(400);
    const saveAsItem = xlsxPage
      .locator('.goog-menuitem:visible, [role="menuitem"]:visible')
      .filter({ hasText: /Lưu dưới dạng Google Trang tính|Save as Google Sheets/i })
      .first();
    await saveAsItem.waitFor({ state: "visible", timeout: 8000 });
    await saveAsItem.click();

    convertedPage = await popupPromise;
    await convertedPage.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
    const idDeadline = Date.now() + 15_000;
    while (Date.now() < idDeadline) {
      assertDemoSheetNotStopped();
      const id = extractGoogleSheetId(convertedPage.url()) || "";
      if (id && id !== stagingDriveId) {
        convertedSheetId = id;
        break;
      }
      await convertedPage.waitForTimeout(350);
    }
    if (!convertedSheetId) {
      throw new Error("Không nhận được ID của Google Trang tính sau khi chuyển đổi.");
    }

    await renameAndVerifyNativeGoogleSheetEditor(convertedPage, sheetTitle, expectedTabNames);
    return convertedSheetId;
  } catch (err) {
    if (convertedSheetId) ephemeralDriveIdsToTrash.add(convertedSheetId);
    throw err;
  } finally {
    if (convertedPage) await convertedPage.close().catch(() => {});
    if (xlsxPage) await xlsxPage.close().catch(() => {});
  }
}

/**
 * Exports a native Google Spreadsheet in RAM via the authenticated Playwright BrowserContext
 * when the sheet is restricted to signed-in MindX accounts. Zero files written to disk.
 */
export async function exportGoogleSheetBufferViaBrowser(
  sheetId: string,
  classId: string,
  originOverride?: string
): Promise<Buffer | null> {
  const cleanSheetId = String(sheetId || "").trim();
  if (!cleanSheetId) return null;
  const normalizedClassId = String(classId || "").trim().toUpperCase() || "UNKNOWN";
  const baseOrigin =
    originOverride && /^https?:\/\//i.test(originOverride)
      ? originOverride.replace(/\/+$/, "")
      : "https://docs.google.com";

  return await taskQueue.enqueue<Buffer | null>({
    id: `DEMO_SHEET_EXPORT_${normalizedClassId}_${Date.now()}`,
    jobType: "CUSTOM",
    description: `Đọc điểm từ Google Trang tính Demo (${normalizedClassId})`,
    classId: normalizedClassId,
    sessionId: "SESSION_14",
    execute: async () => {
      assertDemoSheetNotStopped();
      const page = await BrowserManager.getInstance().getPage();
      const resp = await page
        .context()
        .request.get(`${baseOrigin}/spreadsheets/d/${cleanSheetId}/export?format=xlsx`, {
          timeout: 25000,
        });
      if (!resp.ok()) return null;
      const body = await resp.body();
      return body && body.length > 4 && body[0] === 0x50 && body[1] === 0x4b
        ? Buffer.from(body)
        : null;
    },
  });
}

/**
 * Creates a multi-tab **Native Google Spreadsheet ("Trang tính của Google")** for `classId`
 * directly inside the class's Google Drive folder (`CODING - SPCK -> <Course> -> <classId>`),
 * without creating any Excel `.xlsx` file locally or leaving `.xlsx` files on Google Drive.
 */
export async function createAndUploadClassDemoSheetToDrive(
  options: CreateDemoSheetOptions
): Promise<CreateDemoSheetResult> {
  const normalizedClassId = String(options.classId || "").trim().toUpperCase();
  if (!normalizedClassId) {
    throw new Error("Thiếu mã lớp (classId) để tạo Bảng chấm điểm buổi Demo.");
  }

  if (options.localClassFolderPath && String(options.localClassFolderPath).trim()) {
    const resolvedLocalClass = path.resolve(String(options.localClassFolderPath).trim());
    assertPathAllowed(resolvedLocalClass);
    if (fs.existsSync(resolvedLocalClass)) {
      assertPathAllowed(fs.realpathSync(resolvedLocalClass));
    }
  }

  const sheetTitle = getDemoSheetTitleForClass(normalizedClassId);
  const resolvedDates = resolveSession14DemoDate(normalizedClassId);
  const demoDate = (options.customDemoDate || "").trim() || resolvedDates.demoDate;
  const evalDate = (options.customEvalDate || "").trim() || resolvedDates.evalDate;

  const studentTabs = buildStudentTabsForClass(normalizedClassId);
  if (studentTabs.length === 0) {
    throw new Error(
      `Lớp ${normalizedClassId} chưa có danh sách học viên trong CSDL. Vui lòng đồng bộ lớp hoặc quét thư mục SPCK trước.`
    );
  }

  const coursePrefixForGuard = detectCoursePrefixFromClassId(normalizedClassId);
  const rawTemplateUrl = String(options.templateSheetUrl || "").trim();
  const explicitTemplateSheetId = rawTemplateUrl ? extractGoogleSheetId(rawTemplateUrl) : null;
  if (rawTemplateUrl && !explicitTemplateSheetId) {
    throw new Error(`Đường dẫn Google Sheet mẫu '${rawTemplateUrl}' không hợp lệ.`);
  }

  const savedCourseTemplatePath = getSavedCourseTemplatePath(normalizedClassId);
  if (!explicitTemplateSheetId && !savedCourseTemplatePath) {
    throw new Error(
      `Khóa học '${coursePrefixForGuard || normalizedClassId}' của lớp '${normalizedClassId}' chưa có mẫu bảng chấm điểm Demo riêng.`
    );
  }

  let preloadedSavedTemplateBuf: Buffer | null = null;
  if (!explicitTemplateSheetId && savedCourseTemplatePath) {
    preloadedSavedTemplateBuf = validateTemplateWorkbookBuffer(
      fs.readFileSync(savedCourseTemplatePath),
      savedCourseTemplatePath
    );
  }

  const preCheckDriveFolderId = extractDriveFolderId(
    options.driveFolderUrl || DEFAULT_SPCK_DRIVE_FOLDER_URL
  );
  if (
    preCheckDriveFolderId === CODING_SPCK_ROOT_FOLDER_ID &&
    (!coursePrefixForGuard || !CODING_SPCK_COURSE_FOLDER_MAP[coursePrefixForGuard])
  ) {
    throw new Error(
      `Khóa học '${coursePrefixForGuard || normalizedClassId}' chưa có thư mục khóa học cấu hình sẵn trên Google Drive. Vui lòng dán trực tiếp link thư mục Drive của lớp.`
    );
  }

  const driveBaseUrl = (options._testHarness?.driveBaseUrl || "https://drive.google.com").replace(
    /\/+$/,
    ""
  );
  const sheetsBaseUrl = (options._testHarness?.sheetsBaseUrl || "https://docs.google.com").replace(
    /\/+$/,
    ""
  );

  return await taskQueue.enqueue<CreateDemoSheetResult>({
    id: `DEMO_SHEET_${normalizedClassId}_${Date.now()}`,
    jobType: "SPCK_DEMO_SHEET",
    description: `Tạo Google Trang tính chấm điểm Demo (${normalizedClassId})`,
    classId: normalizedClassId,
    sessionId: "SESSION_14",
    execute: async () => {
      assertDemoSheetNotStopped();
      const page = options._testHarness?.page || (await BrowserManager.getInstance().getPage());
      const ephemeralDriveIdsToTrash = new Set<string>();
      let classDriveFolderId = "";

      try {
        let templateBuffer: Buffer | null = preloadedSavedTemplateBuf;
        if (explicitTemplateSheetId) {
          const exportUrl = `${sheetsBaseUrl}/spreadsheets/d/${explicitTemplateSheetId}/export?format=xlsx`;
          const resp = await page.context().request.get(exportUrl, { timeout: 20000 });
          if (!resp.ok()) {
            throw new Error(
              `Không thể tải mẫu bảng chấm điểm Demo từ '${rawTemplateUrl}' (HTTP ${resp.status()}).`
            );
          }
          templateBuffer = validateTemplateWorkbookBuffer(
            Buffer.from(await resp.body()),
            rawTemplateUrl
          );
        }

        const workbookBuf = buildDemoScoringWorkbookBuffer({
          classId: normalizedClassId,
          sheetTitle,
          demoDate,
          evalDate,
          studentTabs,
          templateBuffer,
        });
        const expectedAllTabs = extractSheetTabNamesFromWorkbookBuffer(workbookBuf);
        const stagingPayload: InMemoryWorkbookPayload = {
          name: `_staging_gsheet_${normalizedClassId}_${Date.now()}_${crypto
            .randomBytes(3)
            .toString("hex")}.xlsx`,
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: workbookBuf,
        };

        let courseParentFolderId = preCheckDriveFolderId;
        if (preCheckDriveFolderId === CODING_SPCK_ROOT_FOLDER_ID && coursePrefixForGuard) {
          courseParentFolderId = CODING_SPCK_COURSE_FOLDER_MAP[coursePrefixForGuard];
        }

        await ensureDriveFolderReady(page, driveBaseUrl, courseParentFolderId);
        const courseItems = await listDriveFilesInFolder(page, courseParentFolderId);
        classDriveFolderId =
          courseItems.find((i) => i.isFolder && i.name.trim().toUpperCase() === normalizedClassId)
            ?.id || "";

        if (!classDriveFolderId) {
          const newBtn = page
            .locator(
              'button[guidedhelpid="new_menu_button"]:visible, button[aria-label="Mới"]:visible, button[aria-label="New"]:visible'
            )
            .first();
          await newBtn.click();
          await page.waitForTimeout(400);
          await page
            .locator(
              '[role="menuitem"]:has-text("Thư mục mới"):visible, [role="menuitem"]:has-text("New folder"):visible'
            )
            .first()
            .click();
          const dlg = page
            .locator('[role="dialog"]')
            .filter({ hasText: /Thư mục mới|New folder/i })
            .last();
          await dlg.waitFor({ state: "visible", timeout: 8000 });
          const input = dlg.locator('input[type="text"]').first();
          await input.fill(normalizedClassId);
          await input.press("Enter");
          await page.waitForTimeout(2200);
          const updatedItems = await listDriveFilesInFolder(page, courseParentFolderId);
          classDriveFolderId =
            updatedItems.find(
              (i) => i.isFolder && i.name.trim().toUpperCase() === normalizedClassId
            )?.id || "";
          if (!classDriveFolderId) {
            throw new Error(
              `Không tìm thấy thư mục lớp '${normalizedClassId}' trên Google Drive.`
            );
          }
        }

        const classDriveFolderUrl = `${driveBaseUrl}/drive/folders/${classDriveFolderId}`;
        await ensureDriveFolderReady(page, driveBaseUrl, classDriveFolderId);
        const preExistingIds = new Set(
          (await listDriveFilesInFolder(page, classDriveFolderId)).map((i) => i.id)
        );

        let nativeSpreadsheetId = "";
        try {
          nativeSpreadsheetId = await createNativeGoogleSheetViaDriveAndImport({
            page,
            driveBaseUrl,
            classDriveFolderId,
            sheetTitle,
            stagingPayload,
            expectedTabNames:
              expectedAllTabs.length > 0 ? expectedAllTabs : studentTabs.map((s) => s.tabName),
            ephemeralDriveIdsToTrash,
          });
        } catch (primaryErr) {
          assertDemoSheetNotStopped();
          nativeSpreadsheetId = await createNativeGoogleSheetViaSaveAsFallback({
            page,
            driveBaseUrl,
            sheetsBaseUrl,
            classDriveFolderId,
            sheetTitle,
            stagingPayload,
            expectedTabNames:
              expectedAllTabs.length > 0 ? expectedAllTabs : studentTabs.map((s) => s.tabName),
            preExistingIds,
            ephemeralDriveIdsToTrash,
          }).catch((fallbackErr) => {
            throw new Error(
              `Không thể tạo Google Trang tính chấm điểm Demo cho lớp ${normalizedClassId}: ${
                primaryErr instanceof Error ? primaryErr.message : String(primaryErr)
              } | Dự phòng: ${
                fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
              }`
            );
          });
        }

        // Read-after-Write Verification inside Google Drive Class Folder
        await page.goto(classDriveFolderUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(1200);

        const targetLower = sheetTitle.trim().toLowerCase();
        let verifiedOnDrive = false;
        const verifyDeadline = Date.now() + 20_000;
        while (Date.now() < verifyDeadline) {
          assertDemoSheetNotStopped();
          const folderItems = await listDriveFilesInFolder(page, classDriveFolderId);
          const item = folderItems.find((i) => i.id === nativeSpreadsheetId);
          if (
            item &&
            !item.isFolder &&
            !item.isExcelFile &&
            item.isGoogleSheet &&
            !preExistingIds.has(item.id) &&
            item.name.trim().toLowerCase() === targetLower
          ) {
            verifiedOnDrive = true;
            break;
          }
          await page.waitForTimeout(900);
        }

        if (!verifiedOnDrive) {
          ephemeralDriveIdsToTrash.add(nativeSpreadsheetId);
          throw new Error(
            `Không thể xác nhận Google Trang tính '${sheetTitle}' trong thư mục Google Drive của lớp ${normalizedClassId}.`
          );
        }

        // Clean up superseded Demo sheets / legacy .xlsx / staging items on Drive AFTER verification
        const legacyXlsxLower = `${sheetTitle}.xlsx`.toLowerCase();
        const currentItems = await listDriveFilesInFolder(page, classDriveFolderId);
        for (const item of currentItems) {
          if (item.id === nativeSpreadsheetId || item.isFolder) continue;
          const lower = item.name.trim().toLowerCase();
          if (
            ephemeralDriveIdsToTrash.has(item.id) ||
            lower === legacyXlsxLower ||
            lower === targetLower ||
            lower.startsWith("_staging_gsheet_")
          ) {
            const ok = await moveDriveItemToTrash(
              page,
              driveBaseUrl,
              classDriveFolderId,
              item.id
            );
            if (ok) ephemeralDriveIdsToTrash.delete(item.id);
          }
        }

        // Clean up any legacy local <sheetTitle>.xlsx left by older versions in the class folder
        const spckRows = spckUploadRepo.findByClass(normalizedClassId);
        const inferredClassRoot =
          (options.localClassFolderPath || "").trim() ||
          (spckRows[0]?.localFolderPath ? path.dirname(spckRows[0].localFolderPath) : "");
        if (inferredClassRoot) {
          try {
            const safeRoot = assertPathAllowed(path.resolve(inferredClassRoot));
            const legacyLocalXlsx = assertPathAllowed(path.join(safeRoot, `${sheetTitle}.xlsx`));
            if (fs.existsSync(legacyLocalXlsx) && fs.lstatSync(legacyLocalXlsx).isFile()) {
              fs.rmSync(legacyLocalXlsx, { force: true });
            }
          } catch {
            // Ignore optional legacy local file cleanup outside allowlist
          }
        }

        const googleSheetUrl = `${sheetsBaseUrl}/spreadsheets/d/${nativeSpreadsheetId}/edit?usp=sharing`;
        jobLogRepo.add({
          jobId: `DEMO_SHEET_${normalizedClassId}_${Date.now()}`,
          jobType: "SPCK_DEMO_SHEET",
          classId: normalizedClassId,
          level: "SUCCESS",
          message: `Đã tạo Google Trang tính '${sheetTitle}' (${studentTabs.length} tab học viên, Ngày Demo: ${demoDate}) trong thư mục Drive lớp ${normalizedClassId}: ${googleSheetUrl}`,
        });

        return {
          classId: normalizedClassId,
          sheetTitle,
          fileName: sheetTitle,
          isNativeGoogleSheet: true,
          mimeType: "application/vnd.google-apps.spreadsheet",
          demoDate,
          evalDate,
          studentCount: studentTabs.length,
          studentTabNames: studentTabs.map((s) => s.tabName),
          localFilePath: "",
          copiedToClassFolderPath: undefined,
          driveFileId: nativeSpreadsheetId,
          googleSheetUrl,
          classDriveFolderUrl,
          usedTemplateUrl: explicitTemplateSheetId ? rawTemplateUrl : undefined,
        };
      } finally {
        if (ephemeralDriveIdsToTrash.size > 0 && classDriveFolderId && !isDemoSheetStopped()) {
          for (const trashId of Array.from(ephemeralDriveIdsToTrash)) {
            await moveDriveItemToTrash(page, driveBaseUrl, classDriveFolderId, trashId).catch(
              () => {}
            );
          }
        }
      }
    },
  });
}
