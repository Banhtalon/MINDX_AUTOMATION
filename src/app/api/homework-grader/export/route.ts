import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { scoreMatrixRepo } from "@/lib/db/sqlite";
import type { ClassScoreMatrixResult, StudentScoreCell } from "@/lib/playwright/scrape-scores";

type ScoreExportMode = "both" | "practice" | "quiz";

function sanitizeSpreadsheetCell(value: string | number): string | number {
  if (typeof value === "number") return value;
  const str = String(value ?? "");
  if (/^[\t\r\n ]*[=+\-@]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

function formatCellForExport(
  cell?: StudentScoreCell,
  mode: ScoreExportMode = "both"
): string | number {
  if (!cell) {
    return mode === "quiz" ? "Chưa làm" : "Chưa nộp";
  }

  if (mode === "quiz") {
    return typeof cell.quizScore === "number" ? cell.quizScore : "Chưa làm";
  }

  let basePractice: string | number;
  switch (cell.status) {
    case "GRADED":
      basePractice = typeof cell.score === "number" ? cell.score : 0;
      break;
    case "SUBMITTED_UNGRADED":
      basePractice = "Chưa chấm";
      break;
    case "REDO_REQUESTED":
      basePractice = "Làm lại";
      break;
    case "NOT_SUBMITTED":
    default:
      basePractice = "Chưa nộp";
      break;
  }

  if (mode === "both" && typeof cell.quizScore === "number") {
    return `${basePractice} (Quiz: ${cell.quizScore})`;
  }

  return basePractice;
}

export async function GET(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const url = new URL(req.url);
    const rawClassId = url.searchParams.get("classId") || "";
    const format = (url.searchParams.get("format") || "xlsx").toLowerCase();
    const rawMode = (url.searchParams.get("mode") || "both").toLowerCase();
    const mode: ScoreExportMode =
      rawMode === "practice" || rawMode === "quiz" ? rawMode : "both";
    const classId = rawClassId.trim().toUpperCase();

    if (!classId) {
      return NextResponse.json(
        { success: false, error: "Thiếu tham số classId." },
        { status: 400 }
      );
    }

    const cached = scoreMatrixRepo.findByClass(classId);
    if (!cached || !cached.matrix) {
      return NextResponse.json(
        {
          success: false,
          error: `Chưa có dữ liệu bảng điểm cho lớp ${classId}. Vui lòng bấm 'Cào dữ liệu điểm mới nhất' trước khi xuất file.`,
        },
        { status: 404 }
      );
    }

    const matrix = cached.matrix as ClassScoreMatrixResult;
    const columns = matrix.columns || [];
    const rows = matrix.rows || [];

    // Build header row
    const headers: (string | number)[] = [
      "STT",
      "Mã Học Viên (ID)",
      "Họ và Tên",
      "Trạng Thái Học",
      ...columns.map((c) => sanitizeSpreadsheetCell(c.title || `Buổi ${c.sessionNumber}`)),
      "Điểm TB Thực hành",
      "Điểm TB Quiz",
      "Đã chấm",
      "Chờ chấm",
      "Chưa nộp",
      "Làm lại",
    ];

    // Build data rows
    const aoa: (string | number)[][] = [headers];
    rows.forEach((r, idx) => {
      const rowValues: (string | number)[] = [
        idx + 1,
        sanitizeSpreadsheetCell(r.studentId),
        sanitizeSpreadsheetCell(r.fullName),
        r.isActive ? "Đang học" : "Nghỉ/Bảo lưu",
        ...columns.map((col) =>
          sanitizeSpreadsheetCell(formatCellForExport(r.cells?.[col.columnId], mode))
        ),
        typeof r.averageScore === "number" ? r.averageScore : "-",
        typeof r.averageQuizScore === "number" ? r.averageQuizScore : "-",
        r.gradedCount,
        r.submittedUngradedCount,
        r.notSubmittedCount,
        r.redoCount,
      ];
      aoa.push(rowValues);
    });

    const worksheet = XLSX.utils.aoa_to_sheet(aoa);

    // Set column widths for readability
    worksheet["!cols"] = [
      { wch: 6 },
      { wch: 22 },
      { wch: 26 },
      { wch: 15 },
      ...columns.map(() => ({ wch: 18 })),
      { wch: 16 },
      { wch: 14 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, `BangDiem_${classId}`.slice(0, 31));

    const dateStamp = new Date().toISOString().slice(0, 10);

    if (format === "csv") {
      const csvContent = XLSX.utils.sheet_to_csv(worksheet);
      // Prepend UTF-8 BOM so Excel opens Vietnamese characters properly
      const bomCsv = "\uFEFF" + csvContent;
      return new NextResponse(bomCsv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="BangDiem_${classId}_${dateStamp}.csv"`,
        },
      });
    }

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="BangDiem_${classId}_${dateStamp}.xlsx"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
