import path from "node:path";
import { NextResponse } from "next/server";
import {
  DemoDayClassNotFoundError,
  resolveStudentDemoLaunchTargets,
} from "@/lib/demo-day/demo-day-inspector";
import {
  getActiveDemoProcessCount,
  launchLocalProductFile,
  launchLocalSlideFile,
  resolveSafeStudentFile,
  stageGameMakerProjectToTemp,
  stopActiveDemoProcesses,
} from "@/lib/demo-day/demo-day-launcher";
import { ensureStudentWebPreviewUrl } from "@/lib/demo-day/demo-web-preview-server";
import {
  parseJsonPlainObjectBody,
  validateLocalRequest,
} from "@/lib/security/local-guard";

const SECURITY_ERROR_REGEX =
  /allowlist|symlink|junction|vượt ra ngoài|tương đối|null|bị chặn|nhạy cảm|không hợp lệ|thoát thư mục|thoát khỏi vùng/i;

function inferLaunchHttpStatus(message: string): number {
  if (SECURITY_ERROR_REGEX.test(message)) return 403;
  if (/không tìm thấy|chưa có/i.test(message)) return 404;
  if (/chỉ hỗ trợ|không được phép|không phải/i.test(message)) return 400;
  return 422;
}

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  const parsedBody = await parseJsonPlainObjectBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const body = parsedBody.body;
    const action = String(body.action || "").trim().toUpperCase();

    if (action === "STOP_PROCESSES") {
      const stopped = stopActiveDemoProcesses();
      return NextResponse.json({
        success: true,
        ...stopped,
        message: "✓ Đã đóng app đang chạy",
      });
    }

    const classId = String(body.classId || "").trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(classId)) {
      return NextResponse.json(
        { success: false, error: "Thiếu hoặc sai định dạng mã lớp (classId)." },
        { status: 400 }
      );
    }

    const targets = await resolveStudentDemoLaunchTargets(classId);

    if (action === "PREP_GAMEMAKER_CLASS") {
      let stagedCount = 0;
      let reusedCount = 0;
      const errors: Array<{ studentId: string; fullName: string; error: string }> = [];

      for (const t of targets) {
        if (!t.studentRootDir) continue;
        const gmOption = t.item.entryOptions.find(
          (o) => o.kind === "GAMEMAKER_YYZ" || o.kind === "GAMEMAKER_YYP"
        );
        if (!gmOption) continue;
        const relPath = gmOption.value.startsWith("file:")
          ? gmOption.value.slice(5)
          : gmOption.label;
        try {
          const res = stageGameMakerProjectToTemp({
            classId,
            studentId: t.studentId,
            studentRootDir: t.studentRootDir,
            relPath,
          });
          stagedCount++;
          if (res.reusedCache) reusedCount++;
        } catch (err: unknown) {
          errors.push({
            studentId: t.studentId,
            fullName: t.fullName,
            error: err instanceof Error ? err.message : "Lỗi giải nén dự án GameMaker",
          });
        }
      }

      return NextResponse.json({
        success: errors.length === 0,
        stagedCount,
        reusedCount,
        errors,
        activeProcessCount: getActiveDemoProcessCount(),
        message:
          stagedCount > 0
            ? `✓ Đã giải nén sẵn ${stagedCount} bài GameMaker`
            : "Không có gói GameMaker (.yyz/.yyp) nào trong lớp.",
      });
    }

    const studentId = String(body.studentId || "").trim();
    const target = targets.find((t) => t.studentId === studentId);
    if (!studentId || !target) {
      return NextResponse.json(
        { success: false, error: "Không tìm thấy học sinh trong lớp." },
        { status: 404 }
      );
    }

    if (action === "OPEN_SLIDE") {
      const requestedRel =
        typeof body.relPath === "string" && body.relPath.trim()
          ? body.relPath.trim()
          : "";

      if (requestedRel) {
        const res = await launchLocalSlideFile({
          classId,
          studentId,
          studentRootDir: target.studentRootDir,
          relPath: requestedRel,
        });
        return NextResponse.json({ success: res.ok, ...res });
      }

      if (target.item.slide.url) {
        return NextResponse.json({
          success: true,
          openUrl: target.item.slide.url,
          activeProcessCount: getActiveDemoProcessCount(),
          message: "✓ Đã mở Slide",
        });
      }

      if (target.item.slide.relPath) {
        const res = await launchLocalSlideFile({
          classId,
          studentId,
          studentRootDir: target.studentRootDir,
          relPath: target.item.slide.relPath,
        });
        return NextResponse.json({ success: res.ok, ...res });
      }

      return NextResponse.json(
        { success: false, error: "Học sinh này chưa có Slide thuyết trình." },
        { status: 404 }
      );
    }

    if (action === "LAUNCH_PRODUCT" || action === "TEST_PRODUCT") {
      const requestedRel =
        typeof body.relPath === "string" && body.relPath.trim()
          ? body.relPath.trim()
          : "";
      const relPath = requestedRel || target.item.product.relPath || "";

      if (!requestedRel && target.item.product.url) {
        return NextResponse.json({
          success: true,
          openUrl: target.item.product.url,
          activeProcessCount: getActiveDemoProcessCount(),
          message: "✓ Đã mở sản phẩm",
        });
      }

      if (!relPath) {
        return NextResponse.json(
          { success: false, error: "Học sinh này chưa có tệp sản phẩm để chạy." },
          { status: 404 }
        );
      }

      const ext = path.extname(relPath).toLowerCase();
      if (ext === ".html" || ext === ".htm") {
        resolveSafeStudentFile(target.studentRootDir, relPath);
        const previewUrl = await ensureStudentWebPreviewUrl(
          target.studentRootDir,
          relPath
        );
        return NextResponse.json({
          success: true,
          openUrl: previewUrl,
          activeProcessCount: getActiveDemoProcessCount(),
          message: "✓ Đã mở Web",
        });
      }

      const res = await launchLocalProductFile({
        classId,
        studentId,
        studentRootDir: target.studentRootDir,
        relPath,
        isTest: action === "TEST_PRODUCT",
      });

      if (!res.ok) {
        return NextResponse.json(
          {
            success: false,
            error: res.error || "Không thể khởi chạy sản phẩm.",
            activeProcessCount: res.activeProcessCount,
          },
          { status: 422 }
        );
      }

      return NextResponse.json({ success: true, ...res });
    }

    return NextResponse.json(
      { success: false, error: `Hành động '${action}' không hợp lệ.` },
      { status: 400 }
    );
  } catch (err: unknown) {
    if (err instanceof DemoDayClassNotFoundError) {
      return NextResponse.json(
        {
          success: false,
          error: err.message,
          activeProcessCount: getActiveDemoProcessCount(),
        },
        { status: 404 }
      );
    }
    const message =
      err instanceof Error ? err.message : "Lỗi khi khởi chạy bài Demo.";
    return NextResponse.json(
      {
        success: false,
        error: message,
        activeProcessCount: getActiveDemoProcessCount(),
      },
      { status: inferLaunchHttpStatus(message) }
    );
  }
}
