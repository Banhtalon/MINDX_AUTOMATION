import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { getGeminiModel } from "@/lib/gemini/client";
import { ZaloBroadcastGenerator } from "@/lib/zalo/broadcast-generator";

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const { imageBase64, mimeType } = body;

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return NextResponse.json(
        { success: false, error: "Vui lòng chọn ảnh chụp danh sách nộp BTVN." },
        { status: 400 }
      );
    }

    const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, "").trim();
    const safeMimeType =
      typeof mimeType === "string" && mimeType.startsWith("image/")
        ? mimeType
        : "image/png";

    const model = getGeminiModel();
    const prompt = `Bạn là trợ lý giáo viên kiểm tra tình trạng làm Bài tập về nhà (BTVN) từ ảnh chụp màn hình hệ thống LMS/Denise.
Hãy đọc bảng danh sách học sinh trong ảnh và trả về đúng 1 JSON object theo cấu trúc:
{
  "unsubmittedStudents": ["Tên học sinh 1", "Tên học sinh 2"],
  "totalStudentsInImage": 8
}
Quy tắc:
1. Lọc ra TẤT CẢ học sinh có trạng thái "Not submitted" (Chưa nộp) hoặc chưa hoàn thành đủ bài tập.
2. Trả về danh sách tên học sinh đó trong mảng "unsubmittedStudents" và tổng số học sinh trong ảnh ở "totalStudentsInImage".
3. Nếu tất cả học sinh trong ảnh đều đã "Submitted" / "Marked" đầy đủ, trả về mảng "unsubmittedStudents" rỗng [].`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: cleanBase64,
          mimeType: safeMimeType,
        },
      },
    ]);

    const rawText = result.response.text();
    const parsed = JSON.parse(rawText);
    const rawNames: string[] = Array.isArray(parsed?.unsubmittedStudents)
      ? parsed.unsubmittedStudents.map((n: any) => String(n || "").trim()).filter(Boolean)
      : [];

    const shortNames = rawNames.map((n) => ZaloBroadcastGenerator.formatShortStudentName(n));
    const part2Text = ZaloBroadcastGenerator.buildBtvnPart2(rawNames);

    return NextResponse.json({
      success: true,
      data: {
        unsubmittedRawNames: rawNames,
        unsubmittedShortNames: shortNames,
        totalStudentsInImage: Number(parsed?.totalStudentsInImage || 0),
        part2Text,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
