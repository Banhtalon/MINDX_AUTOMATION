import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  parseJsonPlainObjectBody,
  validateLocalRequest,
} from "@/lib/security/local-guard";
import { assertPathAllowed } from "@/lib/security/path-allowlist";
import { homeworkSubmissionRepo } from "@/lib/db/sqlite";

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  const bodyRes = await parseJsonPlainObjectBody(req);
  if (!bodyRes.ok) return bodyRes.response;

  const body = bodyRes.body;
  const rawClassId =
    typeof body.classId === "string" ? body.classId.trim().toUpperCase() : "";
  const rawClassCode =
    typeof body.classCode === "string" ? body.classCode.trim().toUpperCase() : "";

  if (rawClassId && rawClassCode && rawClassId !== rawClassCode) {
    return NextResponse.json(
      {
        success: false,
        error: `Mã lớp classId ('${rawClassId}') và classCode ('${rawClassCode}') không đồng nhất.`,
      },
      { status: 400 }
    );
  }

  const classId = rawClassId || rawClassCode;
  const sessionId =
    typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const submissionId =
    typeof body.submissionId === "string" ? body.submissionId.trim() : "";

  if (!classId || !sessionId || !submissionId) {
    return NextResponse.json(
      {
        success: false,
        error: "Thiếu bộ định danh bắt buộc (classId/classCode, sessionId, submissionId).",
      },
      { status: 400 }
    );
  }

  const existing = homeworkSubmissionRepo.findBySubmissionId(submissionId);
  if (!existing) {
    return NextResponse.json(
      {
        success: false,
        error: `Không tìm thấy bài nộp submissionId '${submissionId}' trong cơ sở dữ liệu.`,
      },
      { status: 404 }
    );
  }

  if (existing.classId !== classId || existing.sessionId !== sessionId) {
    return NextResponse.json(
      {
        success: false,
        error: `[Integrity Violation] submissionId '${submissionId}' không thuộc (${classId}, ${sessionId}).`,
      },
      { status: 400 }
    );
  }

  if (
    typeof body.studentId === "string" &&
    body.studentId.trim() &&
    body.studentId.trim() !== existing.studentId
  ) {
    return NextResponse.json(
      {
        success: false,
        error: `[Integrity Violation] submissionId '${submissionId}' thuộc học viên '${existing.studentId}', không phải '${body.studentId.trim()}'.`,
      },
      { status: 400 }
    );
  }

  const rawLocalPath = String(existing.localFilePath || "").trim();
  if (!rawLocalPath || rawLocalPath.includes("\0")) {
    return NextResponse.json(
      {
        success: false,
        error: "Bài nộp chưa có đường dẫn tệp cục bộ hợp lệ (localFilePath) để mở xem.",
      },
      { status: 400 }
    );
  }

  let allowedPath: string;
  try {
    allowedPath = assertPathAllowed(rawLocalPath);
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "[Security] Đường dẫn tệp bài nộp nằm ngoài vùng thư mục cho phép.",
      },
      { status: 403 }
    );
  }

  const projectTempSubRoot = path.resolve(process.cwd(), "temp_submissions");
  if (!fs.existsSync(projectTempSubRoot)) {
    return NextResponse.json(
      {
        success: false,
        error: "Thư mục gốc temp_submissions của dự án không tồn tại.",
      },
      { status: 404 }
    );
  }

  if (!fs.existsSync(allowedPath)) {
    return NextResponse.json(
      {
        success: false,
        error: "Không tìm thấy tệp bài nộp gốc trên ổ cứng.",
      },
      { status: 404 }
    );
  }

  let realRoot: string;
  let realTarget: string;
  try {
    realRoot = fs.realpathSync(projectTempSubRoot);
    realTarget = fs.realpathSync(allowedPath);
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "[Security] Không thể xác thực đường dẫn thực tế của tệp bài nộp.",
      },
      { status: 403 }
    );
  }

  const normRealRoot =
    process.platform === "win32" ? realRoot.toLowerCase() : realRoot;
  const normRealTarget =
    process.platform === "win32" ? realTarget.toLowerCase() : realTarget;
  const rootPrefix = normRealRoot.endsWith(path.sep)
    ? normRealRoot
    : normRealRoot + path.sep;

  if (normRealTarget === normRealRoot || !normRealTarget.startsWith(rootPrefix)) {
    return NextResponse.json(
      {
        success: false,
        error:
          "[Security] Từ chối mở tệp nằm ngoài thư mục temp_submissions của dự án (chặn traversal/symlink).",
      },
      { status: 403 }
    );
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(realTarget);
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Không thể đọc thông tin tệp bài nộp gốc.",
      },
      { status: 404 }
    );
  }
  if (!stat.isFile()) {
    return NextResponse.json(
      {
        success: false,
        error: "Đường dẫn bài nộp không trỏ tới một tệp hợp lệ.",
      },
      { status: 400 }
    );
  }

  if (process.env.MINDX_OPEN_FILE_DRY_RUN === "1") {
    return NextResponse.json({
      success: true,
      data: {
        dryRun: true,
        resolvedPath: realTarget,
      },
    });
  }

  if (process.platform !== "win32") {
    return NextResponse.json(
      {
        success: false,
        error: "Tính năng mở tệp trong Explorer chỉ hỗ trợ hệ điều hành Windows.",
      },
      { status: 400 }
    );
  }

  try {
    const child = execFile(
      "explorer.exe",
      [`/select,${realTarget}`],
      { windowsHide: false, shell: false },
      () => {
        // explorer.exe routinely exits with status 1 when focusing an existing shell window
      }
    );
    child.unref?.();
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: `Không thể mở Windows Explorer: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      dryRun: false,
      resolvedPath: realTarget,
    },
  });
}
