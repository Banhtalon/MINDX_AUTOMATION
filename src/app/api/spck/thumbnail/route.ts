import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { assertPathAllowed } from "@/lib/security/path-allowlist";

const ALLOWED_IMAGE_MIMES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const MAX_THUMBNAIL_BYTES = 20 * 1024 * 1024;

function hasValidImageMagicBytes(buf: Buffer, ext: string): boolean {
  if (buf.length < 12) return false;
  if (ext === ".png") {
    return (
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47
    );
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  if (ext === ".webp") {
    return (
      buf.subarray(0, 4).toString("ascii") === "RIFF" &&
      buf.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }
  if (ext === ".gif") {
    const hdr = buf.subarray(0, 6).toString("ascii");
    return hdr === "GIF87a" || hdr === "GIF89a";
  }
  return false;
}

export async function GET(req: Request) {
  const guardError = validateLocalRequest(req);
  if (guardError) return guardError;

  try {
    const url = new URL(req.url);
    const rawPath = String(url.searchParams.get("path") || "").trim();
    if (!rawPath || rawPath.includes("\0")) {
      return NextResponse.json(
        { success: false, error: "Thiếu đường dẫn ảnh hợp lệ." },
        { status: 400 }
      );
    }

    const ext = path.extname(rawPath).toLowerCase();
    const mimeType = ALLOWED_IMAGE_MIMES[ext];
    if (!mimeType) {
      return NextResponse.json(
        { success: false, error: "Định dạng ảnh không được hỗ trợ." },
        { status: 415 }
      );
    }

    let safePath = "";
    try {
      safePath = assertPathAllowed(rawPath);
    } catch {
      return NextResponse.json(
        { success: false, error: "Đường dẫn nằm ngoài vùng cho phép." },
        { status: 403 }
      );
    }

    let st: fs.Stats;
    try {
      st = fs.lstatSync(safePath);
    } catch {
      return NextResponse.json(
        { success: false, error: "Không tìm thấy tệp ảnh." },
        { status: 404 }
      );
    }

    if (
      st.isSymbolicLink() ||
      !st.isFile() ||
      st.size <= 0 ||
      st.size > MAX_THUMBNAIL_BYTES
    ) {
      return NextResponse.json(
        { success: false, error: "Tệp ảnh không hợp lệ." },
        { status: 403 }
      );
    }

    const buf = fs.readFileSync(safePath);
    if (!hasValidImageMagicBytes(buf, ext)) {
      return NextResponse.json(
        { success: false, error: "Nội dung tệp ảnh không hợp lệ." },
        { status: 415 }
      );
    }

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(buf.length),
        "Cache-Control": "private, max-age=120",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "Không thể đọc ảnh xem trước." },
      { status: 500 }
    );
  }
}
