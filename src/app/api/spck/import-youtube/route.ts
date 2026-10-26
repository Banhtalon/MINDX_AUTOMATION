import { NextResponse } from "next/server";
import { assertClassHasSpckSession } from "@/lib/db/sqlite";
import { importYoutubeProductsForClass } from "@/lib/local-files/spck-youtube-import";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { buildEnrichedClassSpckRecords } from "../list/route";

/**
 * POST /api/spck/import-youtube
 * Robotics classes (product = YouTube presentation video only):
 * body: { classId, sessionNumber (12|13|14), input: "<playlist link and/or 'Tên - link' lines>" }
 * → reads the playlist, matches each video to a student, adds the student's own YouTube link,
 *   extracts 2 presentation frames into the gallery and keeps Owner Thumbnail / MindX logo.
 */
export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const classId = String(body?.classId || "").trim().toUpperCase();
    const input = String(body?.input || "").trim();
    if (!classId) {
      return NextResponse.json(
        { success: false, error: "Thiếu mã lớp (classId)." },
        { status: 400 }
      );
    }
    if (!input) {
      return NextResponse.json(
        {
          success: false,
          error: "Vui lòng dán link Playlist YouTube của lớp hoặc danh sách link video của học viên.",
        },
        { status: 400 }
      );
    }
    if (input.length > 20_000) {
      return NextResponse.json(
        { success: false, error: "Nội dung dán vào quá dài (tối đa 20.000 ký tự)." },
        { status: 400 }
      );
    }

    const stageInfo = assertClassHasSpckSession(classId, Number(body?.sessionNumber));
    const importResult = await importYoutubeProductsForClass({
      classId,
      sessionNumber: stageInfo.sessionNumber,
      input,
    });

    if (importResult.totalVideos === 0) {
      const plError = importResult.playlists.find((p) => p.error)?.error;
      return NextResponse.json(
        {
          success: false,
          error:
            plError ||
            "Không tìm thấy video YouTube nào trong nội dung đã dán. Vui lòng kiểm tra lại link Playlist / link video.",
          importResult,
          records: buildEnrichedClassSpckRecords(classId, stageInfo.sessionNumber),
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      importResult,
      records: buildEnrichedClassSpckRecords(classId, stageInfo.sessionNumber),
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
