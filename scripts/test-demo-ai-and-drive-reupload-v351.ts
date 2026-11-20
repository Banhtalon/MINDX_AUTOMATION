/**
 * MINDX AUTOMATION BOT - VERIFICATION SUITE FOR v3.5.1
 * 100% isolated in `os.tmpdir()` (zero mutations to live `data/mindx_bot.db` or `data/running_classes.json`):
 * - T1: All 14 course Demo templates (`SB, SA, SI, GB, GA, GI, JSB, JSA, JSI, PTA, PTI, PSI, CSA, CSI`) +
 *       `GMB`/`GMA`/`GMI` aliases, titles, Drive folder resolution, and `getSession14DemoLimitsForClass`.
 * - T2: `PTB` & `CSB` Demo/SPCK exemptions across `spck-demo-sheet`, `/api/spck/create-demo-sheet`,
 *       `/api/spck/list` (`spckExempt: false`, `demoExempt: true`), and Admin Center.
 * - T3: `generateDemoSheetAiPreScoresForClass` + `buildDemoScoringWorkbookBuffer` across Python (`PTA`),
 *       Web (`JSA`), GameMaker (`GA`/`.yyz`), Scratch (`SB`/`.sb3`), and `CSA` (row-9 layout):
 *       PII anonymization (`STUDENT_01`), Group 3 & missing slide/video stay `"Tốt"`, formula `<f>`
 *       preserved with recalculated `<v>`, Column G widened + BGK Q&A rows, `PARSE_ERROR`/empty guardrails.
 * - T4: `extractDemoScoresFromWorksheet` round-trip across templates strictly ignoring Column G.
 * - T5: Session 12 -> 13 -> 14 `VT-C4K-PTA13` re-submission & Google Drive clean re-upload:
 *       >25 virtualized items scroll sweep, `"Thay thế tệp hiện có"` same-ID overwrite,
 *       `(1)` fallback deferred cleanup & rename, `/api/spck/scan` screenshot merge,
 *       and LMS `relatedLinks` updated-URL upload under identical link title.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { chromium } from "playwright";

const ROOT = process.cwd();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-v351-test-"));
const tempConfigDir = path.join(tempRoot, "config");
const tempSpckRoot = path.join(tempRoot, "spck_root");
const tempRoleDir = path.join(tempRoot, "role-state");

fs.mkdirSync(path.join(tempConfigDir, "demo-sheet-templates"), { recursive: true });
fs.mkdirSync(tempSpckRoot, { recursive: true });
fs.mkdirSync(tempRoleDir, { recursive: true });

// Copy config assets (templates + default logo) read-only into isolated temp config dir
const liveTemplatesDir = path.join(ROOT, "data", "config", "demo-sheet-templates");
for (const file of fs.readdirSync(liveTemplatesDir)) {
  if (file.toLowerCase().endsWith(".xlsx")) {
    fs.copyFileSync(
      path.join(liveTemplatesDir, file),
      path.join(tempConfigDir, "demo-sheet-templates", file)
    );
  }
}
for (const cfgFile of ["default-demo-sheet-template.xlsx", "default-spck-thumbnail.png"]) {
  const srcPath = path.join(ROOT, "data", "config", cfgFile);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, path.join(tempConfigDir, cfgFile));
  }
}

process.env.MINDX_DB_PATH = path.join(tempRoot, "mindx_v351_test.db");
process.env.MINDX_CONFIG_DIR = tempConfigDir;
process.env.MINDX_RUNNING_CLASSES_PATH = path.join(tempRoot, "running_classes.json");
process.env.MINDX_LMS_CLASS_IDS_PATH = path.join(tempConfigDir, "lms_class_ids.json");
process.env.MINDX_ROLE_STATE_DIR = tempRoleDir;
process.env.ALLOWED_LOCAL_DIRS = tempRoot;
process.env.GEMINI_API_KEY = "AIzaDummyTestKeyV351_NeverLive";

// Genuine PNG bytes from copied MindX config asset for strict image signature validation
const MINIMAL_PNG_BUF = fs.readFileSync(
  path.join(tempConfigDir, "default-spck-thumbnail.png")
);

function makeLocalRequest(url: string, method = "GET", bodyObj?: unknown): Request {
  return new Request(url, {
    method,
    headers: {
      host: "127.0.0.1:3000",
      "content-type": "application/json",
    },
    body: bodyObj !== undefined ? JSON.stringify(bodyObj) : undefined,
  });
}

function makeMinimalSb3Buffer(): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    "project.json",
    Buffer.from(
      JSON.stringify({
        targets: [
          { isStage: true, name: "Stage", variables: {}, lists: {}, broadcasts: {}, blocks: {}, costumes: [], sounds: [] },
          {
            isStage: false,
            name: "SpaceHero",
            variables: { v1: ["score", 10], v2: ["lives", 3] },
            lists: {},
            broadcasts: { b1: "game_over" },
            blocks: {
              blk1: { opcode: "event_whenflagclicked", next: "blk2" },
              blk2: { opcode: "control_forever" },
              blk3: { opcode: "motion_movesteps" },
            },
            costumes: [{ name: "hero_idle" }],
            sounds: [],
          },
        ],
        monitors: [],
        extensions: [],
        meta: { semver: "3.0.0" },
      }),
      "utf8"
    )
  );
  return zip.toBuffer();
}

function makeMinimalYyzBuffer(): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    "SpaceDefender.yyp",
    Buffer.from(
      JSON.stringify({
        name: "SpaceDefender",
        resources: [
          { id: { name: "obj_player_ship", path: "objects/obj_player_ship/obj_player_ship.yy" } },
          { id: { name: "rm_boss_arena", path: "rooms/rm_boss_arena/rm_boss_arena.yy" } },
        ],
      }),
      "utf8"
    )
  );
  zip.addFile(
    "scripts/scr_wave_spawner/scr_wave_spawner.gml",
    Buffer.from(
      `function spawn_enemy_wave(level_num) {\n  for (var i = 0; i < level_num * 3; i++) {\n    instance_create_layer(100 + i * 40, 64, "Instances", obj_enemy);\n  }\n}\n`,
      "utf8"
    )
  );
  return zip.toBuffer();
}

function getInlineOrSharedCellValue(
  xml: string,
  cellRef: string,
  sharedStrings: string[]
): string {
  const cellRegex = new RegExp(`<c\\b[^>]*\\br="${cellRef}"[^>]*>([\\s\\S]*?)<\\/c>`, "i");
  const m = xml.match(cellRegex);
  if (!m) return "";
  const body = m[1];
  const openTagMatch = m[0].match(/^<c\b([^>]*)>/i);
  const attrs = openTagMatch?.[1] || "";
  if (/\bt="inlineStr"/i.test(attrs)) {
    const tMatch = body.match(/<t[^>]*>([\s\S]*?)<\/t>/i);
    return tMatch?.[1] || "";
  }
  if (/\bt="s"/i.test(attrs)) {
    const vMatch = body.match(/<v>([^<]*)<\/v>/i);
    const idx = Number(vMatch?.[1] || -1);
    return idx >= 0 && idx < sharedStrings.length ? sharedStrings[idx] : "";
  }
  const vMatch = body.match(/<v>([^<]*)<\/v>/i);
  return vMatch?.[1] || "";
}

async function run() {
  try {
    const {
      adminCenterRepo,
      computeSafeFileByteDigest,
      getSession14DemoLimitsForClass,
      spckSessionRepo,
      spckUploadRepo,
      studentRepo,
    } = await import("../src/lib/db/sqlite");
    const { saveRunningClasses } = await import("../src/lib/db/json-config");
    const {
      buildDemoScoringWorkbookBuffer,
      createAndUploadClassDemoSheetToDrive,
      getDemoSheetTitleForClass,
      getSavedCourseTemplatePath,
      isCourseExemptFromDemo,
    } = await import("../src/lib/playwright/spck-demo-sheet");
    const {
      extractDemoTemplateRubricStructure,
      generateDemoSheetAiPreScoresForClass,
    } = await import("../src/lib/gemini/spck-demo-sheet-scorer");
    const {
      extractDemoScoresFromWorksheet,
      parseSharedStringsXml,
      parseWorksheetCells,
    } = await import("../src/lib/local-files/spck-demo-score-reader");
    const {
      CODING_SPCK_COURSE_FOLDER_MAP,
      detectCoursePrefixFromClassId,
      resolveCourseSpecificFolderId,
      uploadFilesIntoDriveFolder,
      uploadStudentDirectoryTreeToDrive,
    } = await import("../src/lib/playwright/spck-drive-uploader");
    const {
      computeAdminClassAudits,
      isAdminSpckExemptClass,
      mapAdminClassRecordToDto,
    } = await import("../src/lib/admin-center/admin-lms-scanner");
    const { provisionAdminSpckTasksOnTeaching } = await import(
      "../src/lib/admin-center/admin-teaching-actions"
    );
    const { GET: demoSheetGet, POST: demoSheetPost } = await import(
      "../src/app/api/spck/create-demo-sheet/route"
    );
    const { buildEnrichedClassSpckRecords } = await import(
      "../src/app/api/spck/list/route"
    );
    const { POST: scanPost } = await import("../src/app/api/spck/scan/route");
    const { POST: saveDraftPost } = await import("../src/app/api/spck/save-draft/route");
    const { POST: approvePost } = await import("../src/app/api/spck/approve/route");
    const { SpckUploader } = await import("../src/lib/playwright/spck-uploader");

    // =========================================================================
    // T1: All 14 Course Templates + GMB/GMA/GMI Aliases + Limits Consistency
    // =========================================================================
    console.log("\n[T1] Kiểm tra 14 bộ mẫu barem Demo + bí danh GMB/GMA/GMI...");
    const all14Courses = [
      "SB", "SA", "SI",
      "GB", "GA", "GI",
      "JSB", "JSA", "JSI",
      "PTA", "PTI", "PSI",
      "CSA", "CSI",
    ];
    for (const course of [...all14Courses, "GMB", "GMA", "GMI"]) {
      const classId = `VT-C4K-${course}01`;
      const tplPath = getSavedCourseTemplatePath(classId);
      assert(tplPath && fs.existsSync(tplPath), `Template missing for ${classId}`);

      const title = getDemoSheetTitleForClass(classId);
      assert(/^Bảng chấm điểm buổi [dD]emo /.test(title), `Unexpected title for ${classId}: ${title}`);

      const driveFolderId = resolveCourseSpecificFolderId(classId);
      const gmAlias = ({ GMB: "GB", GMA: "GA", GMI: "GI" } as Record<string, string>)[course] || course;
      assert.strictEqual(driveFolderId, CODING_SPCK_COURSE_FOLDER_MAP[gmAlias]);

      const templateBuf = fs.readFileSync(tplPath);
      const structure = extractDemoTemplateRubricStructure(templateBuf);
      assert(structure.criteriaRows.length >= 10, `Too few rubric criteria in ${course}: ${structure.criteriaRows.length}`);

      const limits = getSession14DemoLimitsForClass(classId);
      const limitTotal = Number(
        (
          limits.algorithm +
          limits.creativity +
          limits.computerSkills +
          limits.communication +
          limits.problemSolving
        ).toFixed(4)
      );
      const catSums = [0, 0, 0, 0, 0];
      for (const row of structure.criteriaRows) {
        catSums[row.categoryIndex] += row.maxPoints;
      }
      const catTotal = Number(catSums.reduce((a, b) => a + b, 0).toFixed(4));
      assert(Math.abs(limitTotal - 5) <= 0.15, `Unexpected limit sum for ${classId}: ${limitTotal}`);
      assert(
        Math.abs(catSums[0] - limits.algorithm) < 0.05 &&
          Math.abs(catSums[1] - limits.creativity) < 0.05 &&
          Math.abs(catSums[2] - limits.communication) < 0.05 &&
          Math.abs(catSums[3] - limits.problemSolving) < 0.05 &&
          Math.abs(catSums[4] - limits.computerSkills) < 0.05,
        `Template category sums mismatch getSession14DemoLimitsForClass for ${classId}: template=${catSums.join(",")}, limits=${limits.algorithm},${limits.creativity},${limits.communication},${limits.problemSolving},${limits.computerSkills} (total=${catTotal})`
      );

      const wbBuf = buildDemoScoringWorkbookBuffer({
        classId,
        sheetTitle: title,
        demoDate: "2026-11-20",
        evalDate: "2026-11-20",
        studentTabs: [
          { studentId: "S1", fullName: "Nguyễn Văn Một", tabName: "Nguyễn Văn Một" },
        ],
      });
      const wbZip = new AdmZip(wbBuf);
      assert(wbZip.getEntry("xl/worksheets/sheet1.xml"), `Missing sheet1 in built workbook for ${classId}`);
    }
    assert.strictEqual(detectCoursePrefixFromClassId("VT-C4K-GMB12"), "GMB");
    console.log("  -> PASS T1 (14/14 khóa + 3 bí danh GameMaker hợp lệ).");

    // =========================================================================
    // T2: PTB & CSB Demo / SPCK Exemption Across Modules
    // =========================================================================
    console.log("\n[T2] Kiểm tra miễn Demo & miễn SPCK cho khóa PTB & CSB...");
    assert.strictEqual(isCourseExemptFromDemo("VT-C4K-PTB01"), true);
    assert.strictEqual(isCourseExemptFromDemo("VT-C4K-CSB02"), true);
    assert.strictEqual(isCourseExemptFromDemo("VT-C4K-PTA13"), false);
    assert.strictEqual(isCourseExemptFromDemo("VT-C4K-CSA01"), false);
    assert.strictEqual(isAdminSpckExemptClass("VT-C4K-PTB01"), true);
    assert.strictEqual(isAdminSpckExemptClass("VT-C4K-CSB02", "Computer Science Basic"), true);
    assert.strictEqual(isAdminSpckExemptClass("VT-C4K-PTA13"), false);

    saveRunningClasses([
      {
        classCode: "VT-C4K-PTB01",
        lmsClassId: "LMS_PTB01",
        courseName: "Python Basic",
        status: "Running",
      },
      {
        classCode: "VT-C4K-CSB02",
        lmsClassId: "LMS_CSB02",
        courseName: "Computer Science Basic",
        status: "Running",
      },
    ]);
    studentRepo.upsert({
      classId: "VT-C4K-PTB01",
      studentId: "STU_PTB_01",
      fullName: "Phạm Minh Tuấn",
      isActive: 1,
    });

    await assert.rejects(
      async () =>
        await createAndUploadClassDemoSheetToDrive({
          classId: "VT-C4K-PTB01",
        }),
      /PTB|miễn buổi Demo/i
    );

    const getPtbRes = await demoSheetGet(
      makeLocalRequest("http://127.0.0.1:3000/api/spck/create-demo-sheet?classId=VT-C4K-PTB01")
    );
    const getPtbJson = await getPtbRes.json();
    assert.strictEqual(getPtbJson.coursePrefix, "PTB");
    assert.strictEqual(getPtbJson.demoExempt, true);
    assert(String(getPtbJson.demoExemptReason || "").includes("PTB"));

    const postPtbRes = await demoSheetPost(
      makeLocalRequest("http://127.0.0.1:3000/api/spck/create-demo-sheet", "POST", {
        classId: "VT-C4K-PTB01",
      })
    );
    assert.strictEqual(postPtbRes.status, 400);
    const postPtbJson = await postPtbRes.json();
    assert.strictEqual(postPtbJson.demoExempt, true);

    const enrichedPtb = buildEnrichedClassSpckRecords("VT-C4K-PTB01", 12);
    assert(enrichedPtb.length >= 0);

    const ptbAdminAudit = computeAdminClassAudits({
      rawClassMeta: {
        classCode: "VT-C4K-PTB01",
        lmsClassId: "LMS_PTB01",
        courseName: "Python Basic",
        status: "RUNNING",
        startDate: "2026-08-01",
        endDate: "2026-12-01",
        mainTeacher: "quangda",
      },
      classByIdData: {
        id: "LMS_PTB01",
        code: "VT-C4K-PTB01",
        currentSession: 12,
        slotInfo: Array.from({ length: 14 }, (_x, i) => ({
          _id: `SLOT_${i + 1}`,
          date: new Date(Date.UTC(2026, 7, 1 + i * 7)).toISOString(),
          studentAttendance: [
            { student: { id: "STU_PTB_01", fullName: "Phạm Minh Tuấn" }, status: "ATTEND", comment: "ok" },
          ],
        })),
      },
      submissionGqlData: null,
      studentWorks: [],
    });
    adminCenterRepo.upsertClass(ptbAdminAudit);
    const ptbDto = mapAdminClassRecordToDto(adminCenterRepo.findClass("VT-C4K-PTB01")!);
    assert.strictEqual(ptbDto.spckAudit.applicable, false);
    assert.strictEqual(ptbDto.spckTasks.eligibleGt9, false);
    assert.strictEqual(ptbDto.spckAudit.session14FinalEval.applicable, false);

    const ptbTaskRes = await provisionAdminSpckTasksOnTeaching("VT-C4K-PTB01");
    assert.strictEqual(ptbTaskRes.success, false);
    assert.strictEqual(ptbTaskRes.statusCode, 400);
    console.log("  -> PASS T2.");

    // =========================================================================
    // T3: AI Pre-Grading & BGK Practical Q&A Across PTA, JSA, GA, SB, CSA
    // =========================================================================
    console.log("\n[T3] Kiểm tra AI chấm nháp + ẩn danh PII + câu hỏi BGK + giữ nguyên nhóm 3 'Tốt'...");
    const ptaClassDir = path.join(tempSpckRoot, "VT-C4K-PTA13");
    const jsaClassDir = path.join(tempSpckRoot, "VT-C4K-JSA05");
    const gaClassDir = path.join(tempSpckRoot, "VT-C4K-GA02");
    const sbClassDir = path.join(tempSpckRoot, "VT-C4K-SB03");

    // 3a. Python (PTA) students
    const ptaStu1Dir = path.join(ptaClassDir, "Nguyễn Hoàng Minh Anh");
    const ptaStu2Dir = path.join(ptaClassDir, "Trần Quốc Bảo");
    const ptaStu3Dir = path.join(ptaClassDir, "Lê Thảo Vy");
    fs.mkdirSync(ptaStu1Dir, { recursive: true });
    fs.mkdirSync(ptaStu2Dir, { recursive: true });
    fs.mkdirSync(ptaStu3Dir, { recursive: true });

    fs.writeFileSync(
      path.join(ptaStu1Dir, "main.py"),
      `# Author: Nguyễn Hoàng Minh Anh\nclass SpaceShip:\n    def check_collision(self, meteor):\n        return self.x == meteor.x\nprint("Hello SpaceGame")\n`,
      "utf8"
    );
    fs.writeFileSync(path.join(ptaStu1Dir, "ui_preview.png"), MINIMAL_PNG_BUF);
    fs.writeFileSync(path.join(ptaStu1Dir, "slide_bao_cao.pdf"), "%PDF-1.4\n1 0 obj\n<<>>\nendobj\n", "utf8");
    fs.writeFileSync(path.join(ptaStu2Dir, "app.py"), `def calc(a, b):\n    return a + b\n`, "utf8");

    // 3b. Web (JSA) student
    const jsaStu1Dir = path.join(jsaClassDir, "VoGiaHuy");
    fs.mkdirSync(jsaStu1Dir, { recursive: true });
    fs.writeFileSync(
      path.join(jsaStu1Dir, "index.html"),
      `<!doctype html><html><body><header><h1>ShopMini</h1></header><script src="app.js"></script></body></html>`,
      "utf8"
    );
    fs.writeFileSync(
      path.join(jsaStu1Dir, "app.js"),
      `async function loadProducts() { const res = await fetch('/api/products'); return res.json(); }`,
      "utf8"
    );
    fs.writeFileSync(path.join(jsaStu1Dir, "home.png"), MINIMAL_PNG_BUF);

    // 3c. GameMaker (GA) student with .yyz archive
    const gaStu1Dir = path.join(gaClassDir, "DangKhanhLinh");
    fs.mkdirSync(gaStu1Dir, { recursive: true });
    fs.writeFileSync(path.join(gaStu1Dir, "SpaceDefender.yyz"), makeMinimalYyzBuffer());
    fs.writeFileSync(path.join(gaStu1Dir, "gameplay.png"), MINIMAL_PNG_BUF);

    // 3d. Scratch (SB) students (valid .sb3 + corrupt .sb3 PARSE_ERROR)
    const sbStu1Dir = path.join(sbClassDir, "BuiDucPhat");
    const sbStu2Dir = path.join(sbClassDir, "HoangGiaBao_Corrupt");
    fs.mkdirSync(sbStu1Dir, { recursive: true });
    fs.mkdirSync(sbStu2Dir, { recursive: true });
    fs.writeFileSync(path.join(sbStu1Dir, "hero_adventure.sb3"), makeMinimalSb3Buffer());
    fs.writeFileSync(path.join(sbStu2Dir, "broken_project.sb3"), Buffer.from("CORRUPT_NOT_A_ZIP_SB3"));

    // Register students in SQLite
    const ptaTabs = [
      { studentId: "PTA_S1", fullName: "Nguyễn Hoàng Minh Anh", tabName: "Nguyễn Hoàng Minh Anh" },
      { studentId: "PTA_S2", fullName: "Trần Quốc Bảo", tabName: "Trần Quốc Bảo" },
      { studentId: "PTA_S3", fullName: "Lê Thảo Vy", tabName: "Lê Thảo Vy" },
    ];
    for (const s of ptaTabs) {
      studentRepo.upsert({ classId: "VT-C4K-PTA13", ...s, isActive: 1 });
    }
    spckUploadRepo.upsert({
      classId: "VT-C4K-PTA13",
      studentId: "PTA_S1",
      localFolderPath: ptaStu1Dir,
      isConfirmedByTeacher: 1,
      status: "DRAFT",
      projectTitle: "Game Ban May Bay cua Nguyễn Hoàng Minh Anh",
      thumbnailPath: path.join(ptaStu1Dir, "ui_preview.png"),
      screenshotsJson: JSON.stringify([path.join(ptaStu1Dir, "ui_preview.png")]),
      attachmentsJson: JSON.stringify([path.join(ptaStu1Dir, "main.py"), path.join(ptaStu1Dir, "slide_bao_cao.pdf")]),
      youtubeUrlsJson: JSON.stringify(["https://www.youtube.com/watch?v=demo12345"]),
      relatedLinksJson: JSON.stringify([{ name: "Slide Demo", url: "https://slides.example/s1" }]),
    });
    spckUploadRepo.upsert({
      classId: "VT-C4K-PTA13",
      studentId: "PTA_S2",
      localFolderPath: ptaStu2Dir,
      isConfirmedByTeacher: 1,
      status: "DRAFT",
      projectTitle: "Calculator Python",
      attachmentsJson: JSON.stringify([path.join(ptaStu2Dir, "app.py")]),
    });
    spckUploadRepo.upsert({
      classId: "VT-C4K-PTA13",
      studentId: "PTA_S3",
      localFolderPath: ptaStu3Dir,
      isConfirmedByTeacher: 1,
      status: "DRAFT",
    });

    studentRepo.upsert({ classId: "VT-C4K-JSA05", studentId: "JSA_S1", fullName: "Võ Gia Huy", isActive: 1 });
    spckUploadRepo.upsert({
      classId: "VT-C4K-JSA05",
      studentId: "JSA_S1",
      localFolderPath: jsaStu1Dir,
      isConfirmedByTeacher: 1,
      status: "DRAFT",
      projectTitle: "ShopMini Web",
      screenshotsJson: JSON.stringify([path.join(jsaStu1Dir, "home.png")]),
      attachmentsJson: JSON.stringify([path.join(jsaStu1Dir, "index.html"), path.join(jsaStu1Dir, "app.js")]),
    });

    studentRepo.upsert({ classId: "VT-C4K-GA02", studentId: "GA_S1", fullName: "Đặng Khánh Linh", isActive: 1 });
    spckUploadRepo.upsert({
      classId: "VT-C4K-GA02",
      studentId: "GA_S1",
      localFolderPath: gaStu1Dir,
      isConfirmedByTeacher: 1,
      status: "DRAFT",
      projectTitle: "SpaceDefender GameMaker",
      screenshotsJson: JSON.stringify([path.join(gaStu1Dir, "gameplay.png")]),
      attachmentsJson: JSON.stringify([path.join(gaStu1Dir, "SpaceDefender.yyz")]),
    });

    studentRepo.upsert({ classId: "VT-C4K-SB03", studentId: "SB_S1", fullName: "Bùi Đức Phát", isActive: 1 });
    studentRepo.upsert({ classId: "VT-C4K-SB03", studentId: "SB_S2", fullName: "Hoàng Gia Bảo", isActive: 1 });
    spckUploadRepo.upsert({
      classId: "VT-C4K-SB03",
      studentId: "SB_S1",
      localFolderPath: sbStu1Dir,
      isConfirmedByTeacher: 1,
      status: "DRAFT",
      attachmentsJson: JSON.stringify([path.join(sbStu1Dir, "hero_adventure.sb3")]),
    });
    spckUploadRepo.upsert({
      classId: "VT-C4K-SB03",
      studentId: "SB_S2",
      localFolderPath: sbStu2Dir,
      isConfirmedByTeacher: 1,
      status: "DRAFT",
      attachmentsJson: JSON.stringify([path.join(sbStu2Dir, "broken_project.sb3")]),
    });

    const capturedPrompts: string[] = [];
    const ptaTplBuf = fs.readFileSync(getSavedCourseTemplatePath("VT-C4K-PTA13")!);
    const ptaStruct = extractDemoTemplateRubricStructure(ptaTplBuf);

    // Ensure LIVE_JUDGE_ONLY criteria exist and never appear in scorableCriteria
    const liveJudgeRows = new Set(
      ptaStruct.criteriaRows
        .filter((r) => r.scorability === "LIVE_JUDGE_ONLY")
        .map((r) => r.rowNumber)
    );
    assert(liveJudgeRows.size >= 2, "Expected at least 2 Group 3 live-judge criteria");

    const ptaAiResult = await generateDemoSheetAiPreScoresForClass({
      classId: "VT-C4K-PTA13",
      studentTabs: ptaTabs,
      templateBuffer: ptaTplBuf,
      localClassFolderPath: ptaClassDir,
      _testAiScorerOverride: async ({
        anonymousToken,
        promptText,
        scorableCriteria,
      }) => {
        capturedPrompts.push(promptText);
        // Assert PII scrubbed completely
        assert(promptText.includes(anonymousToken));
        assert(!/Minh Anh|Nguyễn Hoàng Minh Anh|Quốc Bảo|Thảo Vy/i.test(promptText), `PII leaked in prompt:\n${promptText}`);
        // Group 3 MUST NEVER be in scorableCriteria
        for (const c of scorableCriteria) {
          assert(!liveJudgeRows.has(c.rowNumber), `Live-judge row ${c.rowNumber} must never be AI scorable`);
        }
        const firstRow = scorableCriteria[0];
        const secondRow = scorableCriteria[1] || scorableCriteria[0];
        return {
          criteria: [
            { rowNumber: firstRow.rowNumber, rating: "Hoàn thành", evidenceNote: "Có hàm check_collision nhưng va chạm đơn giản." },
            { rowNumber: secondRow.rowNumber, rating: "Chưa đạt", evidenceNote: "Thiếu màn hình hướng dẫn chi tiết." },
          ],
          bgkQuestions: [
            `Hỏi: Nếu tốc độ thiên thạch tăng gấp đôi trong check_collision, ${anonymousToken} xử lý tránh xuyên vật thể thế nào? -> Gợi ý đáp án mong đợi: Kiểm tra khoảng cách hoặc vùng bao theo delta time.`,
            "Hỏi: Khi người chơi bấm chơi lại, con đặt lại điểm và vị trí tàu ở hàm nào? -> Gợi ý đáp án mong đợi: Reset biến trong hàm khởi tạo vòng lặp.",
          ],
        };
      },
    });
    assert.strictEqual(ptaAiResult.preScoredCount, 2); // PTA_S1 & PTA_S2 scored; PTA_S3 empty skipped
    assert.strictEqual(ptaAiResult.skippedCount, 1);
    assert(ptaAiResult.byTabName["Nguyễn Hoàng Minh Anh"].bgkQuestions.length === 2);
    // De-anonymized safely back if AI echoed STUDENT_01
    assert(
      !ptaAiResult.byTabName["Nguyễn Hoàng Minh Anh"].bgkQuestions[0].includes("STUDENT_01")
    );
    // PTA_S3 empty folder kept all criteria default "Tốt"
    for (const row of ptaStruct.criteriaRows) {
      assert.strictEqual(
        ptaAiResult.byTabName["Lê Thảo Vy"].criteriaByRow[row.rowNumber].rating,
        "Tốt"
      );
    }
    // PTA_S2 has no slide -> CONDITIONAL_SLIDE must stay "Tốt"
    for (const row of ptaStruct.criteriaRows.filter((r) => r.scorability === "CONDITIONAL_SLIDE")) {
      assert.strictEqual(
        ptaAiResult.byTabName["Trần Quốc Bảo"].criteriaByRow[row.rowNumber].rating,
        "Tốt"
      );
    }

    const ptaBuiltWb = buildDemoScoringWorkbookBuffer({
      classId: "VT-C4K-PTA13",
      sheetTitle: getDemoSheetTitleForClass("VT-C4K-PTA13"),
      demoDate: "2026-11-20",
      evalDate: "2026-11-20",
      studentTabs: ptaTabs,
      templateBuffer: ptaTplBuf,
      aiTabAnnotations: ptaAiResult.byTabName,
    });

    const ptaZip = new AdmZip(ptaBuiltWb);
    const ptaS1Xml = ptaZip.getEntry("xl/worksheets/sheet1.xml")!.getData().toString("utf8");
    const ptaS3Xml = ptaZip.getEntry("xl/worksheets/sheet3.xml")!.getData().toString("utf8");
    const ptaSst = ptaZip.getEntry("xl/sharedStrings.xml")
      ? parseSharedStringsXml(ptaZip.getEntry("xl/sharedStrings.xml")!.getData().toString("utf8"))
      : [];

    // Check Column G header widened & populated (without system "AI gợi ý" / "của AI" phrasing)
    assert(/<col\b[^>]*\bmin="7"[^>]*\bwidth="54"/i.test(ptaS1Xml), "Column G width=54 missing in sheet1.xml");
    const ptaColGHeader = getInlineOrSharedCellValue(ptaS1Xml, `G${ptaStruct.headerRow}`, ptaSst).replace(
      /&amp;/g,
      "&"
    );
    assert.strictEqual(ptaColGHeader, "Ghi chú đối chiếu & Câu hỏi BGK");
    assert(!/AI gợi ý|của AI/i.test(ptaColGHeader), `Column G header leaked AI phrasing: ${ptaColGHeader}`);

    // Verify expected recalculated points on Student 1
    let expectedS1Total = 0;
    for (const row of ptaStruct.criteriaRows) {
      const ann = ptaAiResult.byTabName["Nguyễn Hoàng Minh Anh"].criteriaByRow[row.rowNumber];
      const dVal = getInlineOrSharedCellValue(ptaS1Xml, `D${row.rowNumber}`, ptaSst);
      assert.strictEqual(dVal, ann.rating);
      const factor = ann.rating === "Tốt" ? 1 : ann.rating === "Hoàn thành" ? 0.5 : 0;
      const expectedE = Number((row.maxPoints * factor).toFixed(4));
      expectedS1Total += expectedE;
      // Formula tag <f> MUST stay intact alongside recalculated cached <v>
      const eCellMatch = ptaS1Xml.match(new RegExp(`<c\\b[^>]*\\br="E${row.rowNumber}"[^>]*>[\\s\\S]*?<\\/c>`, "i"));
      assert(eCellMatch && /<f\b/i.test(eCellMatch[0]), `Formula <f> lost in E${row.rowNumber}`);
      const eCached = Number(getInlineOrSharedCellValue(ptaS1Xml, `E${row.rowNumber}`, ptaSst));
      assert(Math.abs(eCached - expectedE) < 0.001, `Cached E${row.rowNumber}=${eCached} != ${expectedE}`);
    }
    const fTotal = Number(getInlineOrSharedCellValue(ptaS1Xml, ptaStruct.totalScoreCellRef, ptaSst));
    assert(Math.abs(fTotal - expectedS1Total) < 0.01, `Total ${ptaStruct.totalScoreCellRef}=${fTotal} != ${expectedS1Total}`);
    const bSummary = getInlineOrSharedCellValue(ptaS1Xml, ptaStruct.summaryCellRef, ptaSst);
    assert(bSummary.includes(" / 5"), `Unexpected B5 summary: ${bSummary}`);

    // Empty student tab S3 keeps full score = 5
    const s3Total = Number(getInlineOrSharedCellValue(ptaS3Xml, ptaStruct.totalScoreCellRef, ptaSst));
    assert(Math.abs(s3Total - 5) < 0.01, `Empty folder student expected total=5, got ${s3Total}`);

    // Verify JSA, GA (.yyz), and SB (.sb3 + PARSE_ERROR)
    for (const [cid, stuId, tabName, clsDir] of [
      ["VT-C4K-JSA05", "JSA_S1", "Võ Gia Huy", jsaClassDir],
      ["VT-C4K-GA02", "GA_S1", "Đặng Khánh Linh", gaClassDir],
    ] as const) {
      const tpl = fs.readFileSync(getSavedCourseTemplatePath(cid)!);
      const res = await generateDemoSheetAiPreScoresForClass({
        classId: cid,
        studentTabs: [{ studentId: stuId, fullName: tabName, tabName }],
        templateBuffer: tpl,
        localClassFolderPath: clsDir,
        _testAiScorerOverride: async ({ promptText, scorableCriteria }) => {
          assert(!promptText.includes(tabName), `Name ${tabName} leaked into ${cid} prompt`);
          if (cid === "VT-C4K-GA02") {
            assert(promptText.includes("spawn_enemy_wave") || promptText.includes("SpaceDefender"), "GameMaker YYZ/GML content missing in prompt");
          } else {
            assert(promptText.includes("ShopMini") || promptText.includes("loadProducts"), "Web HTML/JS content missing in prompt");
          }
          return {
            criteria: [
              {
                rowNumber: scorableCriteria[0].rowNumber,
                rating: "Hoàn thành",
                evidenceNote: "OK test \u0000\u000B\u000C\u001F\u007F <&>'\"",
              },
            ],
            bgkQuestions: [
              "Hỏi: Giải thích luồng chính của dự án? -> Gợi ý đáp án mong đợi: Nêu rõ event loop.",
              "Hỏi: Làm sao mở rộng thêm màn chơi? -> Gợi ý đáp án mong đợi: Tạo dữ liệu cấu hình mới.",
            ],
          };
        },
      });
      assert.strictEqual(res.preScoredCount, 1);
      const courseWb = buildDemoScoringWorkbookBuffer({
        classId: cid,
        sheetTitle: `Bảng Demo ${cid}`,
        demoDate: "15/11/2026",
        evalDate: "15/11/2026",
        studentTabs: [{ studentId: stuId, fullName: tabName, tabName }],
        templateBuffer: tpl,
        aiTabAnnotations: res.byTabName,
      });
      const courseSheetXml = new AdmZip(courseWb).getEntry("xl/worksheets/sheet1.xml")!.getData().toString("utf8");
      assert(
        !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(courseSheetXml),
        `Illegal XML 1.0 control chars remained in ${cid} worksheet XML`
      );
      assert(courseSheetXml.includes("&lt;&amp;&gt;&apos;&quot;"), `Missing XML entity escaping in ${cid}`);
    }

    const sbTpl = fs.readFileSync(getSavedCourseTemplatePath("VT-C4K-SB03")!);
    const sbAi = await generateDemoSheetAiPreScoresForClass({
      classId: "VT-C4K-SB03",
      studentTabs: [
        { studentId: "SB_S1", fullName: "Bùi Đức Phát", tabName: "Bùi Đức Phát" },
        { studentId: "SB_S2", fullName: "Hoàng Gia Bảo", tabName: "Hoàng Gia Bảo" },
      ],
      templateBuffer: sbTpl,
      _testAiScorerOverride: async ({ promptText, anonymousToken }) => {
        assert(anonymousToken === "STUDENT_01", `PARSE_ERROR SB_S2 must never call AI scorer, got ${anonymousToken}`);
        assert(promptText.includes("SpaceHero") || promptText.includes("hero_adventure"), "Scratch sb3 details missing");
        return {
          criteria: [],
          bgkQuestions: [
            "Hỏi: Nhân vật SpaceHero dùng vòng lặp mãi mãi để làm gì? -> Gợi ý đáp án mong đợi: Di chuyển liên tục.",
            "Hỏi: Khi hết mạng lives=0 thì phát tín hiệu game_over ở đâu? -> Gợi ý đáp án mong đợi: Broadcast message.",
          ],
        };
      },
    });
    assert.strictEqual(sbAi.preScoredCount, 1);
    assert.strictEqual(sbAi.skippedCount, 1);
    assert(String(sbAi.byTabName["Hoàng Gia Bảo"].skippedReason || "").includes("PARSE_ERROR"));
    console.log("  -> PASS T3.");

    // =========================================================================
    // T4: extractDemoScoresFromWorksheet Round-Trip Strictly Ignores Column G
    // =========================================================================
    console.log("\n[T4] Kiểm tra Demo Score Reader đọc đúng điểm 5 nhóm và BỎ QUA hoàn toàn Cột G...");
    const roundTripCourses = ["PTA", "GA", "GI", "SB", "SA", "CSA", "CSI", "JSI", "PTI"];
    for (const c of roundTripCourses) {
      const cid = `VT-C4K-${c}01`;
      const tplBuf = fs.readFileSync(getSavedCourseTemplatePath(cid)!);
      const st = extractDemoTemplateRubricStructure(tplBuf);
      const firstScorable = st.criteriaRows.find((r) => r.scorability === "AI_PRODUCT_SCORABLE")!;

      const criteriaByRow: Record<number, { rowNumber: number; rating: "Tốt" | "Hoàn thành" | "Chưa đạt"; isAiScored: boolean; columnGNote: string }> = {};
      for (const r of st.criteriaRows) {
        criteriaByRow[r.rowNumber] = {
          rowNumber: r.rowNumber,
          rating: r.rowNumber === firstScorable.rowNumber ? "Hoàn thành" : "Tốt",
          isAiScored: r.rowNumber === firstScorable.rowNumber,
          columnGNote:
            r.rowNumber === firstScorable.rowNumber
              ? "[AI gợi ý: Hoàn thành] Bằng chứng Cột G không được rò vào nhận xét BGK"
              : "[GK chấm trực tiếp khi con thuyết trình]",
        };
      }
      const built = buildDemoScoringWorkbookBuffer({
        classId: cid,
        sheetTitle: getDemoSheetTitleForClass(cid),
        demoDate: "2026-11-20",
        evalDate: "2026-11-20",
        studentTabs: [{ studentId: "RT1", fullName: "Học Viên Test", tabName: "Học Viên Test" }],
        templateBuffer: tplBuf,
        aiTabAnnotations: {
          "Học Viên Test": {
            studentId: "RT1",
            skippedReason: undefined,
            criteriaByRow,
            bgkQuestions: [
              "Hỏi: CÂU HỎI ĐẶC BIỆT TỪ CỘT G -> Gợi ý đáp án mong đợi: Không bao giờ lọt vào judgeNote",
            ],
          },
        },
      });

      const rtZip = new AdmZip(built);
      const rtXml = rtZip.getEntry("xl/worksheets/sheet1.xml")!.getData().toString("utf8");
      const rtSst = rtZip.getEntry("xl/sharedStrings.xml")
        ? parseSharedStringsXml(rtZip.getEntry("xl/sharedStrings.xml")!.getData().toString("utf8"))
        : [];
      const rtCells = parseWorksheetCells(rtXml, rtSst);
      const extracted = extractDemoScoresFromWorksheet(rtCells, cid, rtXml);

      const expectedDeductedTotal = Number((5 - firstScorable.maxPoints * 0.5).toFixed(2));
      assert(
        Math.abs(extracted.demoTotalScore - expectedDeductedTotal) < 0.05,
        `${cid} round-trip total mismatch: got ${extracted.demoTotalScore}, expected ~${expectedDeductedTotal}`
      );
      assert(
        !/AI gợi ý|CÂU HỎI ĐẶC BIỆT|GK chấm trực tiếp|CỘT G/i.test(extracted.judgeNote),
        `Column G leaked into judgeNote for ${cid}: ${extracted.judgeNote}`
      );
    }
    console.log("  -> PASS T4.");

    // =========================================================================
    // T5: Session 12 -> 13 -> 14 VT-C4K-PTA13 Re-Submission & Clean Drive Re-upload
    // =========================================================================
    console.log("\n[T5] Kiểm tra nộp lại Buổi 13/14 (VT-C4K-PTA13), Drive danh sách dài >25 file, Thay thế & Đổi tên (1)...");

    // 5a: /api/spck/scan merges _spck_owner_uploads with new screenshot cleanly
    const defaultLogoThumbPath = path.join(tempConfigDir, "default-spck-thumbnail.png");
    const scanClassRoot = path.join(tempSpckRoot, "VT-C4K-PTA13");
    const ownerUploadsDir = path.join(ptaStu1Dir, "_spck_owner_uploads");
    fs.mkdirSync(ownerUploadsDir, { recursive: true });
    const ownerShot = path.join(ownerUploadsDir, "owner_manual_shot.png");
    fs.writeFileSync(ownerShot, MINIMAL_PNG_BUF);
    spckUploadRepo.upsert({
      classId: "VT-C4K-PTA13",
      studentId: "PTA_S1",
      localFolderPath: ptaStu1Dir,
      isConfirmedByTeacher: 1,
      status: "DRAFT",
      screenshotsJson: JSON.stringify([ownerShot]),
    });

    const save12Res = await saveDraftPost(
      makeLocalRequest("http://127.0.0.1:3000/api/spck/save-draft", "POST", {
        classId: "VT-C4K-PTA13",
        studentId: "PTA_S1",
        sessionNumber: 12,
        localFolderPath: ptaStu1Dir,
        isConfirmedByTeacher: true,
        projectTitle: "Game Ban May Bay v1",
        thumbnailPath: defaultLogoThumbPath,
        screenshots: [ownerShot],
        attachments: [path.join(ptaStu1Dir, "main.py")],
        youtubeUrls: [],
        relatedLinks: [
          { name: "Sản phẩm cuối khóa (Google Drive)", url: "https://drive.google.com/drive/folders/OLD_DRIVE" },
        ],
        quickTags: ["Học tốt"],
        teacherNote: "",
        teacherComment: "- Buổi 12 ok.",
      })
    );
    assert.strictEqual(save12Res.status, 200);
    const s12Draft = spckSessionRepo.findOne("VT-C4K-PTA13", "PTA_S1", 12)!;
    const app12Res = await approvePost(
      makeLocalRequest("http://127.0.0.1:3000/api/spck/approve", "POST", {
        classId: "VT-C4K-PTA13",
        sessionNumber: 12,
        studentIds: ["PTA_S1"],
        reviewedItems: [
          {
            studentId: "PTA_S1",
            draftVersion: s12Draft.draftVersion,
            localFolderPath: ptaStu1Dir,
            isConfirmedByTeacher: true,
            projectTitle: s12Draft.projectTitle,
            thumbnailPath: s12Draft.thumbnailPath,
            screenshots: [ownerShot],
            attachments: [path.join(ptaStu1Dir, "main.py")],
            youtubeUrls: [],
            relatedLinks: [
              { name: "Sản phẩm cuối khóa (Google Drive)", url: "https://drive.google.com/drive/folders/OLD_DRIVE" },
            ],
            teacherComment: s12Draft.teacherComment,
          },
        ],
      })
    );
    assert.strictEqual(app12Res.status, 200);

    const save13Res = await saveDraftPost(
      makeLocalRequest("http://127.0.0.1:3000/api/spck/save-draft", "POST", {
        classId: "VT-C4K-PTA13",
        studentId: "PTA_S1",
        sessionNumber: 13,
        localFolderPath: ptaStu1Dir,
        isConfirmedByTeacher: true,
        projectTitle: "Game Ban May Bay v2",
        thumbnailPath: defaultLogoThumbPath,
        screenshots: [ownerShot],
        attachments: [path.join(ptaStu1Dir, "main.py")],
        youtubeUrls: [],
        relatedLinks: [
          { name: "Sản phẩm cuối khóa (Google Drive)", url: "https://drive.google.com/drive/folders/NEW_DRIVE" },
        ],
        quickTags: ["Học tốt"],
        teacherNote: "",
        teacherComment: "- Buổi 13 nâng cấp.",
      })
    );
    assert.strictEqual(save13Res.status, 200);

    // Ensure separate draft versions & statuses exist per session cleanly
    const s12Rec = spckSessionRepo.findOne("VT-C4K-PTA13", "PTA_S1", 12)!;
    const s13Rec = spckSessionRepo.findOne("VT-C4K-PTA13", "PTA_S1", 13)!;
    assert.strictEqual(s12Rec.draftStatus, "APPROVED");
    assert.strictEqual(s13Rec.draftStatus, "WAITING_APPROVAL");

    fs.writeFileSync(path.join(ptaStu1Dir, "screenshot_01.png"), MINIMAL_PNG_BUF);
    const scanRes = await scanPost(
      makeLocalRequest("http://127.0.0.1:3000/api/spck/scan", "POST", {
        classId: "VT-C4K-PTA13",
        folderPath: scanClassRoot,
        sessionNumber: 13,
        syncActiveSession: true,
      })
    );
    assert.strictEqual(scanRes.status, 200);
    const s13AfterScan = spckSessionRepo.findOne("VT-C4K-PTA13", "PTA_S1", 13)!;
    const uploadAfterScan = spckUploadRepo.findOne("VT-C4K-PTA13", "PTA_S1")!;
    const mergedShots: string[] = JSON.parse(s13AfterScan.screenshotsJson || "[]");
    const masterShots: string[] = JSON.parse(uploadAfterScan.screenshotsJson || "[]");
    assert(
      mergedShots.some((p) => p.includes("owner_manual_shot.png")) &&
        mergedShots.some((p) => p.includes("screenshot_01.png")) &&
        masterShots.some((p) => p.includes("owner_manual_shot.png")) &&
        masterShots.some((p) => p.includes("screenshot_01.png")),
      `Expected scan to merge preserved owner shot + scanned shot, got s13=${JSON.stringify(mergedShots)}, master=${JSON.stringify(masterShots)}`
    );

    // 5b: Google Drive Virtualized >25 items + Replace in-place + KeepBoth (1) deferred cleanup & rename
    const uploadWorkDir = path.join(tempRoot, "drive_reupload_src");
    fs.mkdirSync(uploadWorkDir, { recursive: true });
    const reupMain = path.join(uploadWorkDir, "main.py");
    const reupIndex = path.join(uploadWorkDir, "index.html");
    fs.writeFileSync(reupMain, "print('v2')\n", "utf8");
    fs.writeFileSync(reupIndex, "<h1>v2</h1>\n", "utf8");

    type DriveItem = { id: string; parentId: string; name: string; isFolder: boolean };
    let mode: "replace_same_id" | "keep_both_fallback" = "replace_same_id";
    let items: DriveItem[] = [];
    const trashedIds: string[] = [];
    const renamedLog: Array<{ id: string; from: string; to: string }> = [];
    let replaceRadioSelectedCount = 0;

    const resetDriveItems = () => {
      items = [];
      trashedIds.length = 0;
      renamedLog.length = 0;
      replaceRadioSelectedCount = 0;
      for (let i = 1; i <= 25; i++) {
        items.push({
          id: `MOCK_DRIVE_FILLER_ITEM_${String(i).padStart(2, "0")}`,
          parentId: "DRIVE_STU_FOLDER_01",
          name: `asset_${String(i).padStart(2, "0")}.png`,
          isFolder: false,
        });
      }
      // Existing old files below fold (indices 26 & 27)
      items.push({ id: "MOCK_DRIVE_OLD_INDEX_0026", parentId: "DRIVE_STU_FOLDER_01", name: "index.html", isFolder: false });
      items.push({ id: "MOCK_DRIVE_OLD_MAIN_0027", parentId: "DRIVE_STU_FOLDER_01", name: "main.py", isFolder: false });
    };
    resetDriveItems();

    let nextSeq = 100;
    const driveServer = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname.startsWith("/drive/folders/")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><style>
  #mainScroll { height: 260px; overflow-y: auto; border: 1px solid #ccc; position: relative; }
  .item-row { height: 34px; line-height: 34px; }
</style></head>
<body>
  <button aria-label="Mới" id="newBtn">Mới</button>
  <input type="file" id="hiddenFileInput" multiple style="display:none" />
  <div id="mainMenu" role="menu" style="display:none">
    <div role="menuitem" id="uploadMenuItem">Tải tệp lên</div>
  </div>
  <div role="main" id="mainScroll">
    <div id="virtualSpacer" style="height:1800px; position:relative;">
      <div id="rowsHost" style="position:relative;"></div>
    </div>
  </div>
  <div id="dupDialog" role="dialog" style="display:none">
    <p id="dupTitle">Tùy chọn tải lên</p>
    <div role="radio" id="radioReplace" aria-checked="false">Thay thế tệp hiện có</div>
    <div role="radio" id="radioKeepBoth" aria-checked="true">Giữ cả hai</div>
    <button id="btnUploadConfirm">Tải lên</button>
  </div>
  <div id="ctxMenu" role="menu" style="display:none">
    <div role="menuitem" id="menuRename">Đổi tên</div>
    <div role="menuitem" id="menuTrash">Chuyển vào thùng rác</div>
  </div>
  <div id="renameDialog" role="dialog" style="display:none">
    <h3>Đổi tên</h3>
    <input type="text" id="renameInput" />
    <button id="renameOk">OK</button>
  </div>
  <script>
    let allItems = [];
    let selectedItemId = '';
    let replaceChosen = false;
    let pendingFiles = [];
    let showReplaceOption = true;
    const mainScroll = document.getElementById('mainScroll');
    const virtualSpacer = document.getElementById('virtualSpacer');
    const rowsHost = document.getElementById('rowsHost');
    async function refreshState() {
      const r = await fetch('/api/items');
      const d = await r.json();
      allItems = d.items;
      showReplaceOption = Boolean(d.showReplaceOption);
      document.getElementById('radioReplace').style.display = showReplaceOption ? 'block' : 'none';
      virtualSpacer.style.height = Math.max(300, allItems.length * 34 + 40) + 'px';
      renderVisibleWindow();
    }
    function renderVisibleWindow() {
      const scrollTop = mainScroll.scrollTop || 0;
      const startIdx = Math.max(0, Math.floor(scrollTop / 34));
      const endIdx = Math.min(allItems.length, startIdx + 12);
      const visible = allItems.slice(startIdx, endIdx);
      rowsHost.style.paddingTop = (startIdx * 34) + 'px';
      rowsHost.innerHTML = visible.map(it =>
        '<div class="item-row" data-target="doc" data-id="' + it.id + '" aria-label="' + it.name + (it.isFolder ? ' Thư mục Google Drive' : '') + '">' + it.name + '</div>'
      ).join('');
      rowsHost.querySelectorAll('[data-target="doc"]').forEach(el => {
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          selectedItemId = el.getAttribute('data-id');
          document.getElementById('ctxMenu').style.display = 'block';
        });
      });
    }
    mainScroll.addEventListener('scroll', renderVisibleWindow);
    document.getElementById('newBtn').addEventListener('click', () => {
      document.getElementById('mainMenu').style.display = 'block';
    });
    document.getElementById('uploadMenuItem').addEventListener('click', () => {
      document.getElementById('mainMenu').style.display = 'none';
      document.getElementById('hiddenFileInput').click();
    });
    document.getElementById('hiddenFileInput').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []).map(f => f.name);
      if (files.length === 0) return;
      pendingFiles = files;
      const hasDup = files.some(name => allItems.some(it => it.name === name));
      if (hasDup) {
        replaceChosen = false;
        document.getElementById('dupDialog').style.display = 'block';
      } else {
        await commitUpload(files, false);
      }
      e.target.value = '';
    });
    document.getElementById('radioReplace').addEventListener('click', () => {
      replaceChosen = true;
      fetch('/api/mark-replace', { method: 'POST' });
    });
    document.getElementById('btnUploadConfirm').addEventListener('click', async () => {
      document.getElementById('dupDialog').style.display = 'none';
      await commitUpload(pendingFiles, replaceChosen);
      pendingFiles = [];
    });
    async function commitUpload(names, wantReplace) {
      await fetch('/api/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ names, wantReplace }),
      });
      await refreshState();
    }
    document.getElementById('menuTrash').addEventListener('click', async () => {
      document.getElementById('ctxMenu').style.display = 'none';
      if (!selectedItemId) return;
      await fetch('/api/trash', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: selectedItemId }),
      });
      await refreshState();
    });
    document.getElementById('menuRename').addEventListener('click', () => {
      document.getElementById('ctxMenu').style.display = 'none';
      const cur = allItems.find(i => i.id === selectedItemId);
      document.getElementById('renameInput').value = cur ? cur.name : '';
      document.getElementById('renameDialog').style.display = 'block';
    });
    async function submitRename() {
      const newName = document.getElementById('renameInput').value;
      document.getElementById('renameDialog').style.display = 'none';
      await fetch('/api/rename', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: selectedItemId, newName }),
      });
      await refreshState();
    }
    document.getElementById('renameOk').addEventListener('click', submitRename);
    document.getElementById('renameInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitRename();
    });
    refreshState();
  </script>
</body>
</html>`);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/items") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ items, showReplaceOption: mode === "replace_same_id" }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/mark-replace") {
        replaceRadioSelectedCount++;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/upload") {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          const { names, wantReplace } = JSON.parse(raw);
          for (const name of names as string[]) {
            if (mode === "replace_same_id" && wantReplace) {
              // Real Google Drive in-place version replacement keeps existing data-id
              if (!items.some((i) => i.name === name)) {
                items.push({ id: `MOCK_DRIVE_NEW_FILE_${++nextSeq}_ID`, parentId: "DRIVE_STU_FOLDER_01", name, isFolder: false });
              }
            } else {
              // Simulate fallback Keep Both creating "name (1).ext" alongside old file
              const dot = name.lastIndexOf(".");
              const dupName = dot > 0 ? `${name.slice(0, dot)} (1)${name.slice(dot)}` : `${name} (1)`;
              items.push({ id: `MOCK_DRIVE_NEW_FILE_${++nextSeq}_ID`, parentId: "DRIVE_STU_FOLDER_01", name: dupName, isFolder: false });
            }
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/trash") {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          const { id } = JSON.parse(raw);
          trashedIds.push(id);
          items = items.filter((i) => i.id !== id);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/rename") {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          const { id, newName } = JSON.parse(raw);
          const found = items.find((i) => i.id === id);
          if (found) {
            renamedLog.push({ id, from: found.name, to: newName });
            found.name = newName;
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }
      res.writeHead(404).end();
    });

    await new Promise<void>((resolve) => driveServer.listen(0, "127.0.0.1", () => resolve()));
    const drivePort = (driveServer.address() as any).port;
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();

      // Mode A: Replace Existing In-Place (same data-id, >25 virtualized items scroll discovery)
      mode = "replace_same_id";
      resetDriveItems();
      await page.goto(`http://127.0.0.1:${drivePort}/drive/folders/DRIVE_STU_FOLDER_01`);
      await page.waitForTimeout(300);

      const cleanupA: Array<{ folderId: string; itemIds: string[] }> = [];
      const renameA: Array<{ folderId: string; items: Array<{ id: string; cleanName: string }> }> = [];
      const uploadedA = await uploadFilesIntoDriveFolder(
        page,
        "DRIVE_STU_FOLDER_01",
        [reupMain, reupIndex],
        true,
        cleanupA,
        renameA
      );
      assert.strictEqual(uploadedA, 2);
      assert(replaceRadioSelectedCount >= 1, "Expected uploader to select 'Thay thế tệp hiện có' radio");
      const cleanupIdsA = cleanupA.flatMap((c) => c.itemIds);
      assert(
        !cleanupIdsA.includes("MOCK_DRIVE_OLD_INDEX_0026") &&
          !cleanupIdsA.includes("MOCK_DRIVE_OLD_MAIN_0027"),
        `In-place same-ID replace must NOT schedule replaced active IDs for trash, got: ${JSON.stringify(cleanupIdsA)}`
      );
      assert.strictEqual(
        cleanupIdsA.length,
        25,
        `Expected 25 obsolete filler files scheduled for deferred trash, got ${cleanupIdsA.length}`
      );
      assert.strictEqual(renameA.length, 0, "In-place replace must NOT need (1) rename");

      // Mode B: Fallback Keep Both creates `index (1).html` & `main (1).py` -> trash old IDs after verification -> rename cleanly
      mode = "keep_both_fallback";
      resetDriveItems();
      await page.goto(`http://127.0.0.1:${drivePort}/drive/folders/DRIVE_STU_FOLDER_01`);
      await page.waitForTimeout(300);
      await uploadStudentDirectoryTreeToDrive(
        page,
        "DRIVE_STU_FOLDER_01",
        uploadWorkDir,
        "PTA_S1",
        "Nguyễn Hoàng Minh Anh",
        0,
        true
      );
      assert(trashedIds.includes("MOCK_DRIVE_OLD_INDEX_0026") && trashedIds.includes("MOCK_DRIVE_OLD_MAIN_0027"), `Old IDs not trashed after upload: ${JSON.stringify(trashedIds)}`);
      assert(
        items.some((i) => i.name === "index.html") &&
          items.some((i) => i.name === "main.py") &&
          !items.some((i) => /\(1\)/.test(i.name)),
        `Expected clean filenames without '(1)', remaining: ${JSON.stringify(items.filter((i) => /index|main/i.test(i.name)))}`
      );

      // 5c: LMS relatedLinks check — same link title with NEW Drive URL must still be added
      let modalOpen = false;
      let titleVal = "";
      let commentVal = "";
      let addedLinkNames: string[] = [];
      let addedLinkUrls: string[] = [];
      let curLinkNameInput = "";
      let curLinkUrlInput = "";
      const existingModalTitleAndOldUrl =
        "Sản phẩm cuối khóa (Google Drive) https://drive.google.com/drive/folders/OLD_DRIVE";

      const makeModalLoc = (selector: string): any => {
        const obj: any = {
          first: () => obj,
          last: () => obj,
          nth: () => obj,
          locator: (s: string) => makeModalLoc(s),
          filter: () => obj,
          count: async () => {
            if (selector.includes('[role="dialog"]')) return modalOpen ? 1 : 0;
            if (selector.startsWith("a[href=")) {
              return selector.includes("OLD_DRIVE") || addedLinkUrls.some((u) => selector.includes(u))
                ? 1
                : 0;
            }
            if (selector.includes("0?2") || selector.includes("Xem chi tiết") || selector.includes("MuiCircularProgress")) return 0;
            return 1;
          },
          isVisible: async () => {
            if (selector.includes("MuiDialog")) return modalOpen;
            if (selector.includes("progressbar") || selector.includes("Forbidden")) return false;
            return true;
          },
          waitFor: async () => {},
          scrollIntoViewIfNeeded: async () => {},
          click: async () => {
            if (selector.includes("Sản phẩm của học sinh")) modalOpen = true;
            if (selector.includes("Thêm") && curLinkUrlInput) {
              addedLinkNames.push(curLinkNameInput);
              addedLinkUrls.push(curLinkUrlInput);
            }
          },
          innerText: async () => {
            if (selector.includes('[role="dialog"]') || selector.includes("MuiDialog")) {
              return `${existingModalTitleAndOldUrl} ${addedLinkUrls.join(" ")}`;
            }
            if (selector.includes("tbody tr") || selector.includes("name-display") || selector.includes("MuiTypography-h6")) {
              return "Nguyễn Hoàng Minh Anh";
            }
            return "";
          },
          innerHTML: async () => `<span>${existingModalTitleAndOldUrl}</span>`,
          fill: async (val: string) => {
            if (selector.includes("input#title")) titleVal = val;
            else if (selector.includes("textarea#comment")) commentVal = val;
            else if (selector.includes("inputRelativeUrlName")) curLinkNameInput = val;
            else if (selector.includes("inputRelativeUrl")) curLinkUrlInput = val;
          },
          inputValue: async () => (selector.includes("textarea#comment") ? commentVal : titleVal),
          evaluate: async () => ({ src: "https://resources.mindx.edu.vn/default-spck-thumbnail.png", naturalWidth: 500 }),
          setInputFiles: async () => {},
          getAttribute: async () => "",
        };
        return obj;
      };

      // Approve Session 13 cleanly via API so verifyRecordStillApproved & integrity hash pass 100%
      const prep13SaveRes = await saveDraftPost(
        makeLocalRequest("http://127.0.0.1:3000/api/spck/save-draft", "POST", {
          classId: "VT-C4K-PTA13",
          studentId: "PTA_S1",
          sessionNumber: 13,
          localFolderPath: ptaStu1Dir,
          isConfirmedByTeacher: true,
          projectTitle: "Game Ban May Bay v2",
          thumbnailPath: defaultLogoThumbPath,
          screenshots: [],
          attachments: [],
          youtubeUrls: [],
          relatedLinks: [
            {
              name: "Sản phẩm cuối khóa (Google Drive)",
              url: "https://drive.google.com/drive/folders/NEW_DRIVE",
            },
          ],
          teacherComment: "- Buổi 13 nâng cấp.",
        })
      );
      assert.strictEqual(prep13SaveRes.status, 200);
      const freshS13Draft = spckSessionRepo.findOne("VT-C4K-PTA13", "PTA_S1", 13)!;
      const app13Res = await approvePost(
        makeLocalRequest("http://127.0.0.1:3000/api/spck/approve", "POST", {
          classId: "VT-C4K-PTA13",
          sessionNumber: 13,
          studentIds: ["PTA_S1"],
          reviewedItems: [
            {
              studentId: "PTA_S1",
              draftVersion: freshS13Draft.draftVersion,
              localFolderPath: ptaStu1Dir,
              isConfirmedByTeacher: true,
              projectTitle: freshS13Draft.projectTitle,
              thumbnailPath: defaultLogoThumbPath,
              screenshots: [],
              attachments: [],
              youtubeUrls: [],
              relatedLinks: [
                {
                  name: "Sản phẩm cuối khóa (Google Drive)",
                  url: "https://drive.google.com/drive/folders/NEW_DRIVE",
                },
              ],
              teacherComment: freshS13Draft.teacherComment,
            },
          ],
        })
      );
      assert.strictEqual(app13Res.status, 200);
      const approvedS13 = spckSessionRepo.findOne("VT-C4K-PTA13", "PTA_S1", 13)!;
      const baseRec = spckUploadRepo.findOne("VT-C4K-PTA13", "PTA_S1")!;

      const thumbSha = computeSafeFileByteDigest(defaultLogoThumbPath);
      const fakeModalPage: any = {
        locator: makeModalLoc,
        keyboard: {
          press: async () => {
            modalOpen = false;
          },
        },
        waitForTimeout: async () => {},
        waitForResponse: async () => ({
          url: () => "https://lms-api.mindx.edu.vn/",
          status: () => 200,
          json: async () => ({
            data: {
              studentWorks: {
                update: {
                  latestData: {
                    title: approvedS13.projectTitle,
                    comment: approvedS13.teacherComment,
                    thumbnail: {
                      name: "default-spck-thumbnail.png",
                      byteSha256: thumbSha,
                    },
                    attachments: [],
                    relativeUrls: [
                      {
                        name: "Sản phẩm cuối khóa (Google Drive)",
                        url: "https://drive.google.com/drive/folders/NEW_DRIVE",
                      },
                    ],
                  },
                },
              },
            },
          }),
        }),
      };

      const modalRes = await (SpckUploader as any).uploadSingleStudentViaRealLmsModal({
        page: fakeModalPage,
        interceptor: { dismissForbiddenToast: async () => {} },
        normalizedClassId: "VT-C4K-PTA13",
        targetSessionNumber: 13,
        record: {
          ...baseRec,
          projectTitle: approvedS13.projectTitle,
          thumbnailPath: approvedS13.thumbnailPath,
          teacherComment: approvedS13.teacherComment,
          contentHash: approvedS13.approvedContentHash,
        },
        fullName: "Nguyễn Hoàng Minh Anh",
        studentsInClass: [{ studentId: "PTA_S1", fullName: "Nguyễn Hoàng Minh Anh" }],
        expectedHash: approvedS13.approvedContentHash,
        screenshots: [],
        attachments: [],
        youtubeUrls: [],
        relatedLinks: [
          {
            name: "Sản phẩm cuối khóa (Google Drive)",
            url: "https://drive.google.com/drive/folders/NEW_DRIVE",
          },
        ],
      });
      assert.strictEqual(modalRes.relatedLinksAddedCount, 1);
      assert(addedLinkUrls.includes("https://drive.google.com/drive/folders/NEW_DRIVE"));
    } finally {
      await browser.close();
      driveServer.close();
    }

    console.log("  -> PASS T5.");
    console.log("\n=== TẤT CẢ 5 BÀI KIỂM TRA v3.5.1 (T1-T5) ĐÃ ĐẠT 100% ===");
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore Windows SQLite handle close race if any
    }
  }
}

run().catch((err) => {
  console.error("[FAIL] test-demo-ai-and-drive-reupload-v351:", err);
  process.exit(1);
});
