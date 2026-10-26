import { NextResponse } from "next/server";
import { type SpckSessionNumber } from "@/lib/db/sqlite";
import {
  DEFAULT_SPCK_WEB_REPO_URL,
  SpckWebDeployer,
} from "@/lib/github/spck-web-deployer";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { buildEnrichedClassSpckRecords } from "../list/route";

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const classId = String(body?.classId || "").trim().toUpperCase();
    const repoUrl =
      String(body?.repoUrl || "").trim() || DEFAULT_SPCK_WEB_REPO_URL;
    const rawSession = Number(body?.sessionNumber);
    const activeSessionNumber: SpckSessionNumber | undefined =
      rawSession === 12 || rawSession === 13 || rawSession === 14
        ? (rawSession as SpckSessionNumber)
        : undefined;
    const studentIds: string[] | undefined = Array.isArray(body?.studentIds)
      ? body.studentIds.map((id: any) => String(id).trim()).filter(Boolean)
      : body?.studentId
      ? [String(body.studentId).trim()]
      : undefined;

    if (!classId || !/^[A-Z0-9_-]{2,80}$/.test(classId)) {
      return NextResponse.json(
        {
          success: false,
          error: "Mã lớp (classId) thiếu hoặc không hợp lệ khi thực hiện đẩy Web SPCK lên GitHub Pages.",
        },
        { status: 400 }
      );
    }

    if (!/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/i.test(repoUrl)) {
      return NextResponse.json(
        {
          success: false,
          error: "Đường dẫn GitHub Repository không hợp lệ (chỉ chấp nhận https://github.com/<owner>/<repo>).",
        },
        { status: 400 }
      );
    }

    const deployResult = await SpckWebDeployer.deployClassWebSpckToGithubPages({
      classId,
      repoUrl,
      studentIds,
    });

    const updatedRecords = buildEnrichedClassSpckRecords(classId, activeSessionNumber);

    return NextResponse.json({
      success: true,
      deployResult,
      records: updatedRecords,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
