import { NextResponse } from "next/server";
import {
  buildStudentTabsForClass,
  createAndUploadClassDemoSheetToDrive,
  getDemoSheetTitleForClass,
  resolveSession14DemoDate,
} from "@/lib/playwright/spck-demo-sheet";
import { validateLocalRequest } from "@/lib/security/local-guard";

export async function GET(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const url = new URL(req.url);
    const classId = (url.searchParams.get("classId") || "").trim().toUpperCase();
    if (!classId) {
      return NextResponse.json(
        { success: false, error: "Thiếu mã lớp (classId)." },
        { status: 400 }
      );
    }

    const sheetTitle = getDemoSheetTitleForClass(classId);
    const { demoDate, evalDate } = resolveSession14DemoDate(classId);
    const studentTabs = buildStudentTabsForClass(classId);

    return NextResponse.json({
      success: true,
      classId,
      sheetTitle,
      demoDate,
      evalDate,
      studentCount: studentTabs.length,
      studentTabNames: studentTabs.map((s) => s.tabName),
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

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const classId = String(body?.classId || "").trim().toUpperCase();
    const templateSheetUrl =
      typeof body?.templateSheetUrl === "string"
        ? body.templateSheetUrl.trim()
        : undefined;
    const driveFolderUrl =
      typeof body?.driveFolderUrl === "string"
        ? body.driveFolderUrl.trim()
        : undefined;
    const localClassFolderPath =
      typeof body?.localClassFolderPath === "string"
        ? body.localClassFolderPath.trim()
        : undefined;
    const customDemoDate =
      typeof body?.demoDate === "string" ? body.demoDate.trim() : undefined;
    const customEvalDate =
      typeof body?.evalDate === "string" ? body.evalDate.trim() : undefined;

    if (!classId) {
      return NextResponse.json(
        { success: false, error: "Thiếu mã lớp (classId)." },
        { status: 400 }
      );
    }

    const result = await createAndUploadClassDemoSheetToDrive({
      classId,
      templateSheetUrl,
      driveFolderUrl,
      localClassFolderPath,
      customDemoDate,
      customEvalDate,
    });

    return NextResponse.json({
      success: true,
      demoSheetResult: result,
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
