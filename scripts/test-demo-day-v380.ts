/**
 * KIỂM THỬ TOÀN DIỆN v3.8.0 — TRANG THI & DEMO CUỐI KHÓA (/demo-day)
 *
 * Bao phủ:
 * - [DD-01] Local-Only Guard (403 IP lạ / cross-site), Input Validation (400), Path Containment
 *           (403 traversal `../`, `.env`, symlink/junction, tệp nhạy cảm), & Isolated Web Preview Server
 * - [DD-02] Tự động nhận diện 3 bộ môn (Python App, Web, GameMaker .yyz/.yyp), lọc tên đề tài sạch,
 *           giải nén GameMaker vào `os.tmpdir()` bảo toàn 100% SHA-256 thư mục & `spck_uploads` VERIFIED,
 *           bắt lỗi Python thiếu thư viện (`ModuleNotFoundError`) và đóng sạch tiến trình Python
 * - [DD-03] Bốc thăm ngẫu nhiên (`Fisher-Yates`), đổi thứ tự, đánh dấu vắng (`excluded`),
 *           dán bổ sung link Canva & khóa đồng bộ `expectedRowVer` (`409` khi xung đột)
 * - [DD-04] E2E trình duyệt Chromium thật (`127.0.0.1:3096`, `1280×800`, `1366×768`, `1440×900` Light/Dark):
 *           TopNavbar 1 dòng, ảnh bìa 16:9 thật (`naturalWidth > 0`), WCAG AA `>= 4.5`, 0 console/page error,
 *           0 rò rỉ đường dẫn ổ cứng trên Sân khấu, và lối tắt `🎤 Thi Demo` từ `/final-project`
 *
 * Chạy 100% cô lập trong `os.tmpdir()` — KHÔNG bao giờ chạm dữ liệu thật trong `data/`.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import AdmZip from "adm-zip";
import { chromium } from "playwright";

const VALID_1X1_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttpReady(url: string, timeoutMs = 60000): Promise<void> {
  const start = Date.now();
  let lastErr = "";
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastErr = `HTTP ${res.status}`;
    } catch (err: unknown) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await sleep(400);
  }
  throw new Error(`Hết thời gian chờ máy chủ kiểm thử tại ${url}: ${lastErr}`);
}

function buildRawZipArchive(
  entries: Array<{
    name: string;
    compressedData: Buffer;
    method?: number;
    declaredUncompressedSize: number;
    declaredCompressedSize?: number;
  }>
): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const item of entries) {
    const nameBuf = Buffer.from(item.name, "utf8");
    const method = item.method ?? 8;
    const compSize = (item.declaredCompressedSize ?? item.compressedData.length) >>> 0;
    const uncompSize = item.declaredUncompressedSize >>> 0;

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0, 6);
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt32LE(0, 14); // crc32 ignored by AdmZip entry parse
    lfh.writeUInt32LE(compSize, 18);
    lfh.writeUInt32LE(uncompSize, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    localChunks.push(lfh, nameBuf, item.compressedData);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt32LE(0, 16);
    cdh.writeUInt32LE(compSize, 20);
    cdh.writeUInt32LE(uncompSize, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt32LE(offset >>> 0, 42);
    centralChunks.push(cdh, nameBuf);

    offset += 30 + nameBuf.length + item.compressedData.length;
  }

  const centralBuf = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length >>> 0, 12);
  eocd.writeUInt32LE(offset >>> 0, 16);

  return Buffer.concat([...localChunks, centralBuf, eocd]);
}

function killProcessTree(proc: ChildProcess | null) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/F", "/T", "/PID", String(proc.pid)], {
        stdio: "ignore",
      });
    } else {
      proc.kill("SIGKILL");
    }
  } catch {}
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-dd-v380-"));
  const outsideSecretDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-dd-outside-"));
  const tmpConfigDir = path.join(tmpRoot, "config");
  const tmpDbPath = path.join(tmpRoot, "test_dd_v380.db");
  const tmpRunningClassesPath = path.join(tmpRoot, "running_classes.json");
  const spckBaseDir = path.join(tmpRoot, "MINDX_SPCK_FINAL");

  fs.mkdirSync(tmpConfigDir, { recursive: true });
  fs.mkdirSync(spckBaseDir, { recursive: true });
  fs.writeFileSync(path.join(outsideSecretDir, "secret.py"), "print('SECRET')", "utf8");
  fs.writeFileSync(path.join(outsideSecretDir, "secret.html"), "<h1>SECRET</h1>", "utf8");

  const realConfigDir = path.join(process.cwd(), "data", "config");
  for (const cfgFile of ["courses_syllabus.json", "quick_tags.json"]) {
    const srcPath = path.join(realConfigDir, cfgFile);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, path.join(tmpConfigDir, cfgFile));
    }
  }

  // Isolate BEFORE importing server/DB modules
  process.env.ALLOWED_LOCAL_DIRS = tmpRoot;
  process.env.MINDX_ALLOWED_EXTRA_PATHS = tmpRoot;
  process.env.MINDX_DB_PATH = tmpDbPath;
  process.env.MINDX_CONFIG_DIR = tmpConfigDir;
  process.env.MINDX_RUNNING_CLASSES_PATH = tmpRunningClassesPath;
  process.env.MINDX_DEMO_LAUNCH_DRY_RUN = "1";
  process.env.MINDX_DEMO_ALLOW_PYTHON_IN_DRY_RUN = "1";

  const {
    classSessionRepo,
    closeDb,
    computeSpckContentHash,
    demoDayRepo,
    getDb,
    spckUploadRepo,
    studentRepo,
  } = await import("../src/lib/db/sqlite");
  const { saveRunningClasses } = await import("../src/lib/db/json-config");
  const { computeStudentFolderContentDigest } = await import(
    "../src/lib/local-files/spck-scanner"
  );
  const {
    cleanDemoProjectTitle,
    detectSlideLinkMeta,
    reconcileDemoOrder,
    shuffleDemoStudentOrder,
  } = await import("../src/lib/demo-day/demo-day-helpers");
  const {
    clearDryRunLaunchLog,
    getDryRunLaunchLog,
    stageGameMakerProjectToTemp,
    stopActiveDemoProcesses,
  } = await import("../src/lib/demo-day/demo-day-launcher");
  const { closeDemoWebPreviewServer } = await import(
    "../src/lib/demo-day/demo-web-preview-server"
  );
  const { GET: stateGET } = await import("../src/app/api/demo-day/state/route");
  const { POST: savePOST } = await import("../src/app/api/demo-day/save/route");
  const { POST: launchPOST } = await import("../src/app/api/demo-day/launch/route");

  let nextServer: ChildProcess | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  const serverLogs: string[] = [];
  const nextEnvPath = path.join(process.cwd(), "next-env.d.ts");
  const origNextEnvDts = fs.existsSync(nextEnvPath) ? fs.readFileSync(nextEnvPath) : null;
  const testPort = 3096;
  const runUid = `${process.pid}-${Date.now()}`;
  const e2eDistRel = `.next/e2e-dd380-${runUid}`;
  const e2eDistAbs = path.join(process.cwd(), e2eDistRel);
  const e2eTsconfigRel = `.next/e2e-tsconfig-dd380-${runUid}.json`;
  const e2eTsconfigAbs = path.join(process.cwd(), e2eTsconfigRel);
  let createdE2eDist = false;
  let createdE2eTsconfig = false;
  const createdGmStageDirs: string[] = [];

  try {
    console.log("🚀 BẮT ĐẦU KIỂM THỬ v3.8.0 (Khu vực cô lập):", tmpRoot);

    const pyClassId = "SYNTH-PTA14";
    const webClassId = "SYNTH-JSB14";
    const gmClassId = "SYNTH-GA14";

    saveRunningClasses([
      { classCode: pyClassId, courseName: "Python App Producer Advanced", status: "Running" },
      { classCode: webClassId, courseName: "Web Development Basic", status: "Running" },
      { classCode: gmClassId, courseName: "GameMaker Advanced", status: "Running" },
    ]);

    for (const cid of [pyClassId, webClassId, gmClassId]) {
      classSessionRepo.upsert({
        classId: cid,
        className: cid,
        sessionId: `${cid}_SESS_14`,
        sessionNumber: 14,
        topic: "Demo Cuối Khóa",
        date: "2026-11-28",
      });
    }

    // Seed Google Sheet Demo link in job_logs for pyClassId
    getDb()
      .prepare(
        `INSERT INTO job_logs (jobId, jobType, classId, level, message)
         VALUES (?, 'SPCK_DEMO_SHEET', ?, 'SUCCESS', ?)`
      )
      .run(
        "job_demo_sheet_test",
        pyClassId,
        "Đã tạo Google Trang tính Demo: https://docs.google.com/spreadsheets/d/demoSheet123/edit"
      );

    // -------------------------------------------------------------------------
    // Seed 3 classes folders
    // -------------------------------------------------------------------------
    // 1. Python Class
    const pyClassDir = path.join(spckBaseDir, pyClassId);
    const pyStu1Dir = path.join(pyClassDir, "Nguyen Minh Khoi");
    const pyStu2Dir = path.join(pyClassDir, "Tran Bao Ngoc");
    const pyStu3Dir = path.join(pyClassDir, "Le Gia Huy");
    const pyStu4Dir = path.join(pyClassDir, "Pham Khanh Linh");
    for (const d of [pyStu1Dir, pyStu2Dir, pyStu3Dir, pyStu4Dir]) {
      fs.mkdirSync(d, { recursive: true });
    }

    fs.writeFileSync(
      path.join(pyStu1Dir, "main.py"),
      "import time\ntime.sleep(12)\n",
      "utf8"
    );
    fs.writeFileSync(path.join(pyStu1Dir, "ui_home.py"), "print('ui helper')\n", "utf8");
    fs.writeFileSync(
      path.join(pyStu1Dir, "links.txt"),
      [
        "Tiêu đề: Quản Lý Chi Tiêu",
        "Slide / Link thuyết trình (Nguyễn Minh Khôi) | https://www.canva.com/design/DAKHOI/view",
        "Google Drive | https://drive.google.com/drive/folders/1abcFolder",
      ].join("\n"),
      "utf8"
    );
    const khoiThumbDir = path.join(pyStu1Dir, "_spck_owner_uploads");
    fs.mkdirSync(khoiThumbDir, { recursive: true });
    const khoiThumbPath = path.join(khoiThumbDir, "thumb_khoi.png");
    fs.writeFileSync(khoiThumbPath, VALID_1X1_PNG);

    fs.writeFileSync(path.join(pyStu2Dir, "app.py"), "import time\ntime.sleep(5)\n", "utf8");
    const ngocShotsDir = path.join(pyStu2Dir, "_spck_app_shots");
    fs.mkdirSync(ngocShotsDir, { recursive: true });
    const ngocThumbPath = path.join(ngocShotsDir, "app_01_main.png");
    fs.writeFileSync(ngocThumbPath, VALID_1X1_PNG);

    fs.writeFileSync(
      path.join(pyStu3Dir, "missing_mod.py"),
      "import mindx_nonexistent_pkg_999\nprint('ok')\n",
      "utf8"
    );
    fs.writeFileSync(path.join(pyStu3Dir, "BaoCao.pptx"), "PK_DUMMY_PPTX", "utf8");
    fs.writeFileSync(path.join(pyStu3Dir, "bad_script.bat"), "@echo off\n", "utf8");
    fs.writeFileSync(path.join(pyStu3Dir, ".env"), "SECRET=12345\n", "utf8");

    // Junction escape inside pyStu1Dir pointing to outsideSecretDir
    const evilJunctionDir = path.join(pyStu1Dir, "evil_link");
    try {
      fs.symlinkSync(outsideSecretDir, evilJunctionDir, "junction");
    } catch {
      // Non-fatal on non-Windows if junction not supported
    }

    const pyStudents = [
      { id: "STU_PY_01", name: "Nguyễn Minh Khôi", dir: pyStu1Dir, thumb: khoiThumbPath, title: "Quản Lý Chi Tiêu - Nguyễn Minh Khôi — Buổi 14 (GĐ2)" },
      { id: "STU_PY_02", name: "Trần Bảo Ngọc", dir: pyStu2Dir, thumb: ngocThumbPath, title: "Từ Điển PyQt6 — Buổi 13 (GĐ1)" },
      { id: "STU_PY_03", name: "Lê Gia Huy", dir: pyStu3Dir, thumb: "", title: "SPCK Lê Gia Huy" },
      { id: "STU_PY_04", name: "Phạm Khánh Linh", dir: pyStu4Dir, thumb: "", title: "" },
    ];
    let expectedPy01Hash = "";
    for (const s of pyStudents) {
      studentRepo.upsert({ classId: pyClassId, studentId: s.id, fullName: s.name, isActive: 1 });
      const baseRec = {
        classId: pyClassId,
        studentId: s.id,
        localFolderPath: s.dir,
        projectTitle: s.title,
        thumbnailPath: s.thumb,
        isConfirmedByTeacher: 1,
      };
      const verifiedHash = s.id === "STU_PY_01" ? computeSpckContentHash(baseRec) : "";
      if (s.id === "STU_PY_01") expectedPy01Hash = verifiedHash;
      spckUploadRepo.upsert({
        ...baseRec,
        status: s.id === "STU_PY_01" ? "VERIFIED" : "DRAFT",
        contentHash: verifiedHash,
      });
    }

    // 2. Web Class
    const webClassDir = path.join(spckBaseDir, webClassId);
    const webStu1Dir = path.join(webClassDir, "Dang Hoang Nam");
    const webStu2Dir = path.join(webClassDir, "Vo Thao Vy");
    fs.mkdirSync(webStu1Dir, { recursive: true });
    fs.mkdirSync(webStu2Dir, { recursive: true });

    fs.writeFileSync(path.join(webStu1Dir, "index.html"), "<!doctype html><h1>Tiem Banh</h1>", "utf8");
    fs.writeFileSync(path.join(webStu1Dir, "menu.html"), "<!doctype html><h1>Menu</h1>", "utf8");
    fs.writeFileSync(path.join(webStu1Dir, "style.css"), "body { color: #111; }", "utf8");
    fs.writeFileSync(path.join(webStu1Dir, ".env"), "API_KEY=DO_NOT_SERVE", "utf8");
    fs.writeFileSync(path.join(webStu2Dir, "home.html"), "<!doctype html><h1>Shop</h1>", "utf8");
    fs.writeFileSync(path.join(webStu2Dir, "Slide.pptx"), "PK_SLIDE", "utf8");

    studentRepo.upsert({ classId: webClassId, studentId: "STU_WEB_01", fullName: "Đặng Hoàng Nam", isActive: 1 });
    const web1Base = {
      classId: webClassId,
      studentId: "STU_WEB_01",
      localFolderPath: webStu1Dir,
      projectTitle: "Website Tiệm Bánh Ngọt — Buổi 14 (GĐ2)",
      relatedLinksJson: JSON.stringify([
        { name: "Slide", url: "https://docs.google.com/presentation/d/abc123/edit" },
      ]),
      isConfirmedByTeacher: 1,
    };
    spckUploadRepo.upsert({
      ...web1Base,
      status: "VERIFIED",
      contentHash: computeSpckContentHash(web1Base),
    });

    studentRepo.upsert({ classId: webClassId, studentId: "STU_WEB_02", fullName: "Võ Thảo Vy", isActive: 1 });
    spckUploadRepo.upsert({
      classId: webClassId,
      studentId: "STU_WEB_02",
      localFolderPath: webStu2Dir,
      projectTitle: "Web Shop Thời Trang",
      relatedLinksJson: JSON.stringify([
        { name: "Chạy thử web", url: "https://banhtalon.github.io/WEB_PRODUCT_SHOW/SYNTH-JSB14/VoThaoVy/" },
      ]),
      isConfirmedByTeacher: 1,
      status: "DRAFT",
    });

    // 3. GameMaker Class
    const gmClassDir = path.join(spckBaseDir, gmClassId);
    const gmStu1Dir = path.join(gmClassDir, "Bui Minh Quan");
    const gmStu2Dir = path.join(gmClassDir, "Hoang Anh Thu");
    fs.mkdirSync(gmStu1Dir, { recursive: true });
    fs.mkdirSync(gmStu2Dir, { recursive: true });

    const yyzZip = new AdmZip();
    yyzZip.addFile(
      "SpaceWar.yyp",
      Buffer.from(JSON.stringify({ name: "SpaceWar", resources: [] }), "utf8")
    );
    yyzZip.addFile(
      "rooms/rm_game/rm_game.yy",
      Buffer.from(JSON.stringify({ name: "rm_game" }), "utf8")
    );
    yyzZip.writeZip(path.join(gmStu1Dir, "SpaceWar.yyz"));
    fs.writeFileSync(path.join(gmStu1Dir, "Slide_BaoCao.pptx"), "PK_GM_SLIDE", "utf8");

    fs.writeFileSync(
      path.join(gmStu2Dir, "Dungeon.yyp"),
      JSON.stringify({ name: "Dungeon" }),
      "utf8"
    );

    studentRepo.upsert({ classId: gmClassId, studentId: "STU_GM_01", fullName: "Bùi Minh Quân", isActive: 1 });
    const gm1Base = {
      classId: gmClassId,
      studentId: "STU_GM_01",
      localFolderPath: gmStu1Dir,
      projectTitle: "Game Chiến Cơ Vũ Trụ — Buổi 14 (GĐ2)",
      isConfirmedByTeacher: 1,
    };
    const expectedGm01Hash = computeSpckContentHash(gm1Base);
    spckUploadRepo.upsert({
      ...gm1Base,
      status: "VERIFIED",
      contentHash: expectedGm01Hash,
    });
    studentRepo.upsert({ classId: gmClassId, studentId: "STU_GM_02", fullName: "Hoàng Anh Thư", isActive: 1 });
    spckUploadRepo.upsert({
      classId: gmClassId,
      studentId: "STU_GM_02",
      localFolderPath: gmStu2Dir,
      projectTitle: "Dungeon Explorer",
      isConfirmedByTeacher: 1,
      status: "DRAFT",
    });

    const gm1DigestBefore = computeStudentFolderContentDigest(gmStu1Dir);

    // =========================================================================
    // [DD-01] Security: Local-Only Guard, Validation, Containment & Preview Server
    // =========================================================================
    console.log("\n[DD-01] Kiểm tra bảo mật Local-Only, Path Containment & Web Preview...");

    const localHeaders = {
      "Content-Type": "application/json",
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
    };

    const badGetRemote = await stateGET(
      new Request(`http://evil.example.com/api/demo-day/state?classId=${pyClassId}`, {
        headers: { host: "evil.example.com", "sec-fetch-site": "cross-site" },
      })
    );
    assert.equal(badGetRemote.status, 403, "[DD-01] GET state từ domain ngoài phải trả 403");

    const badSaveCross = await savePOST(
      new Request("http://127.0.0.1:3000/api/demo-day/save", {
        method: "POST",
        headers: { ...localHeaders, "sec-fetch-site": "cross-site" },
        body: JSON.stringify({ classId: pyClassId }),
      })
    );
    assert.equal(badSaveCross.status, 403, "[DD-01] POST save cross-site phải trả 403");

    const badLaunchRemote = await launchPOST(
      new Request("http://evil.example.com/api/demo-day/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json", host: "evil.example.com" },
        body: JSON.stringify({ action: "STOP_PROCESSES" }),
      })
    );
    assert.equal(badLaunchRemote.status, 403, "[DD-01] POST launch từ ngoài localhost phải trả 403");

    const badJsonSave = await savePOST(
      new Request("http://127.0.0.1:3000/api/demo-day/save", {
        method: "POST",
        headers: localHeaders,
        body: "[]",
      })
    );
    assert.equal(badJsonSave.status, 400, "[DD-01] JSON mảng phải trả 400");

    const badClassIdSave = await savePOST(
      new Request("http://127.0.0.1:3000/api/demo-day/save", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({ classId: "../EVIL" }),
      })
    );
    assert.equal(badClassIdSave.status, 400, "[DD-01] classId chứa ký tự lạ phải trả 400");

    // [F02] Strict validation & 404 on GET /api/demo-day/state (including empty ?classId=)
    for (const badStateQuery of ["!!", "", "%20%20"]) {
      const badStateMalformed = await stateGET(
        new Request(`http://127.0.0.1:3000/api/demo-day/state?classId=${badStateQuery}`, {
          headers: { host: "127.0.0.1:3000" },
        })
      );
      assert.equal(
        badStateMalformed.status,
        400,
        `[F02] GET state với ?classId=${badStateQuery} phải trả 400`
      );
    }

    const badStateMissing = await stateGET(
      new Request("http://127.0.0.1:3000/api/demo-day/state?classId=NO_SUCH_CLASS_999", {
        headers: { host: "127.0.0.1:3000" },
      })
    );
    assert.equal(badStateMissing.status, 404, "[F02] GET state với classId không tồn tại phải trả 404");

    // [F01] Hostile GameMaker .yyz archives must abort cleanly & leave zero partial files
    const gmStageBase = path.join(os.tmpdir(), "mindx-demo-gm-stage");
    const gmStageBefore = fs.existsSync(gmStageBase) ? fs.readdirSync(gmStageBase) : [];

    // 1) High-ratio ZIP bomb
    const bombYyzPath = path.join(gmStu1Dir, "BombGame.yyz");
    const bombZip = new AdmZip();
    const bigZeros = Buffer.alloc(12 * 1024 * 1024, 0x41);
    for (let i = 0; i < 6; i++) {
      bombZip.addFile(`assets/pad_${i}.bin`, bigZeros);
    }
    bombZip.addFile("Bomb.yyp", Buffer.from("{}", "utf8"));
    bombZip.writeZip(bombYyzPath);
    assert.throws(
      () =>
        stageGameMakerProjectToTemp({
          classId: gmClassId,
          studentId: "STU_GM_BOMB",
          studentRootDir: gmStu1Dir,
          relPath: "BombGame.yyz",
        }),
      /tỷ lệ nén bất thường|vượt quá/i,
      "[F01] Tệp .yyz có tỷ lệ nén bất thường (zip bomb) phải bị chặn trước khi giải nén"
    );
    fs.rmSync(bombYyzPath, { force: true });

    // 2) Zip-slip traversal (`../escape.yyp`)
    const slipYyzPath = path.join(gmStu1Dir, "SlipGame.yyz");
    fs.writeFileSync(
      slipYyzPath,
      buildRawZipArchive([
        {
          name: "../escape.yyp",
          compressedData: zlib.deflateRawSync(Buffer.from("{}", "utf8")),
          declaredUncompressedSize: 2,
        },
      ])
    );
    assert.throws(
      () =>
        stageGameMakerProjectToTemp({
          classId: gmClassId,
          studentId: "STU_GM_SLIP",
          studentRootDir: gmStu1Dir,
          relPath: "SlipGame.yyz",
        }),
      /thoát thư mục|không hợp lệ/i,
      "[F01] .yyz chứa đường dẫn zip-slip ../ phải bị chặn"
    );
    fs.rmSync(slipYyzPath, { force: true });

    // 3) Declared single entry > 200 MiB & cumulative > 600 MiB
    const overSingleYyzPath = path.join(gmStu1Dir, "OverSingle.yyz");
    fs.writeFileSync(
      overSingleYyzPath,
      buildRawZipArchive([
        {
          name: "huge.bin",
          compressedData: zlib.deflateRawSync(Buffer.from("x", "utf8")),
          declaredUncompressedSize: 201 * 1024 * 1024,
        },
      ])
    );
    assert.throws(
      () =>
        stageGameMakerProjectToTemp({
          classId: gmClassId,
          studentId: "STU_GM_OVERSINGLE",
          studentRootDir: gmStu1Dir,
          relPath: "OverSingle.yyz",
        }),
      /200 MB/i,
      "[F01] Entry .yyz khai báo > 200 MiB phải bị chặn"
    );
    fs.rmSync(overSingleYyzPath, { force: true });

    const overTotalYyzPath = path.join(gmStu1Dir, "OverTotal.yyz");
    const tinyDeflate = zlib.deflateRawSync(Buffer.from("ok", "utf8"));
    const reasonableDeclaredComp = 4 * 1024 * 1024;
    fs.writeFileSync(
      overTotalYyzPath,
      buildRawZipArchive([
        { name: "a.bin", compressedData: tinyDeflate, declaredUncompressedSize: 160 * 1024 * 1024, declaredCompressedSize: reasonableDeclaredComp },
        { name: "b.bin", compressedData: tinyDeflate, declaredUncompressedSize: 160 * 1024 * 1024, declaredCompressedSize: reasonableDeclaredComp },
        { name: "c.bin", compressedData: tinyDeflate, declaredUncompressedSize: 160 * 1024 * 1024, declaredCompressedSize: reasonableDeclaredComp },
        { name: "d.bin", compressedData: tinyDeflate, declaredUncompressedSize: 160 * 1024 * 1024, declaredCompressedSize: reasonableDeclaredComp },
      ])
    );
    assert.throws(
      () =>
        stageGameMakerProjectToTemp({
          classId: gmClassId,
          studentId: "STU_GM_OVERTOTAL",
          studentRootDir: gmStu1Dir,
          relPath: "OverTotal.yyz",
        }),
      /600 MB/i,
      "[F01] Tổng dung lượng khai báo > 600 MiB phải bị chặn"
    );
    fs.rmSync(overTotalYyzPath, { force: true });

    // 4) Forged small header size whose real deflate stream inflates past 200 MiB
    const spoofBombYyzPath = path.join(gmStu1Dir, "SpoofInflate.yyz");
    const real201MiBCompressed = zlib.deflateRawSync(Buffer.alloc(201 * 1024 * 1024, 0));
    fs.writeFileSync(
      spoofBombYyzPath,
      buildRawZipArchive([
        {
          name: "spoof.bin",
          compressedData: real201MiBCompressed,
          declaredUncompressedSize: 1024,
        },
      ])
    );
    assert.throws(
      () =>
        stageGameMakerProjectToTemp({
          classId: gmClassId,
          studentId: "STU_GM_SPOOF",
          studentRootDir: gmStu1Dir,
          relPath: "SpoofInflate.yyz",
        }),
      /vượt quá giới hạn an toàn|600 MB/i,
      "[F01] Tệp .yyz giả mạo header nhỏ nhưng bung > 200 MiB phải bị chặn"
    );
    fs.rmSync(spoofBombYyzPath, { force: true });

    const gmStageAfterHostile = fs.existsSync(gmStageBase) ? fs.readdirSync(gmStageBase) : [];
    assert.deepEqual(
      gmStageAfterHostile,
      gmStageBefore,
      "[F01] Khi .yyz độc hại thất bại, không được để sót thư mục giải nén dở trong TEMP"
    );

    const badTraversalPy = await launchPOST(
      new Request("http://127.0.0.1:3000/api/demo-day/launch", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({
          action: "LAUNCH_PRODUCT",
          classId: pyClassId,
          studentId: "STU_PY_01",
          relPath: "../../outside_secret/secret.py",
        }),
      })
    );
    assert.equal(badTraversalPy.status, 403, "[DD-01] Path traversal ../ phải trả 403");

    const badTraversalHtml = await launchPOST(
      new Request("http://127.0.0.1:3000/api/demo-day/launch", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({
          action: "LAUNCH_PRODUCT",
          classId: webClassId,
          studentId: "STU_WEB_01",
          relPath: "../../outside_secret/secret.html",
        }),
      })
    );
    assert.equal(badTraversalHtml.status, 403, "[DD-01] Path traversal .html phải trả 403");

    const badDotEnv = await launchPOST(
      new Request("http://127.0.0.1:3000/api/demo-day/launch", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({
          action: "LAUNCH_PRODUCT",
          classId: pyClassId,
          studentId: "STU_PY_03",
          relPath: ".env",
        }),
      })
    );
    assert.equal(badDotEnv.status, 403, "[DD-01] Tệp .env phải bị chặn 403");

    const badBatExt = await launchPOST(
      new Request("http://127.0.0.1:3000/api/demo-day/launch", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({
          action: "LAUNCH_PRODUCT",
          classId: pyClassId,
          studentId: "STU_PY_03",
          relPath: "bad_script.bat",
        }),
      })
    );
    assert.equal(badBatExt.status, 400, "[DD-01] Đuôi .bat phải bị từ chối 400");

    if (fs.existsSync(evilJunctionDir)) {
      const badJunction = await launchPOST(
        new Request("http://127.0.0.1:3000/api/demo-day/launch", {
          method: "POST",
          headers: localHeaders,
          body: JSON.stringify({
            action: "LAUNCH_PRODUCT",
            classId: pyClassId,
            studentId: "STU_PY_01",
            relPath: "evil_link/secret.py",
          }),
        })
      );
      assert.equal(badJunction.status, 403, "[DD-01] Junction/Symlink phải bị chặn 403");
    }

    // Isolated Web Preview Server checks
    const webStateRes = await stateGET(
      new Request(`http://127.0.0.1:3000/api/demo-day/state?classId=${webClassId}`, {
        headers: { host: "127.0.0.1:3000" },
      })
    );
    const webStateJson = await webStateRes.json();
    assert.equal(webStateRes.status, 200);
    const webStu1 = webStateJson.data.students.find((s: any) => s.studentId === "STU_WEB_01");
    assert.ok(webStu1?.product?.previewUrl, "[DD-01] Web student phải có previewUrl nội bộ");
    const previewUrlObj = new URL(webStu1.product.previewUrl);
    assert.equal(previewUrlObj.hostname, "127.0.0.1");
    assert.notEqual(previewUrlObj.port, "3000");

    const previewHtmlRes = await fetch(webStu1.product.previewUrl);
    assert.equal(previewHtmlRes.status, 200);
    assert.equal(previewHtmlRes.headers.get("x-content-type-options"), "nosniff");
    const previewHtmlBody = await previewHtmlRes.text();
    assert.ok(previewHtmlBody.includes("Tiem Banh"));

    const previewCssRes = await fetch(`${previewUrlObj.origin}${path.posix.dirname(previewUrlObj.pathname)}/style.css`);
    assert.equal(previewCssRes.status, 200);

    const previewEnvRes = await fetch(`${previewUrlObj.origin}${path.posix.dirname(previewUrlObj.pathname)}/.env`);
    assert.equal(previewEnvRes.status, 403, "[DD-01] Web preview server phải chặn .env (403)");

    const previewBadToken = await fetch(`${previewUrlObj.origin}/p/${"a".repeat(36)}/index.html`);
    assert.equal(previewBadToken.status, 403, "[DD-01] Token giả trên Web preview server phải trả 403");

    console.log("   ✅ [DD-01] PASSED!");

    // =========================================================================
    // [DD-02] Auto-Discovery, Non-Destructive GameMaker Staging & Python Launch
    // =========================================================================
    console.log("\n[DD-02] Kiểm tra nhận diện 3 bộ môn, giải nén GameMaker & Python launcher...");

    assert.equal(
      cleanDemoProjectTitle("Quản Lý Chi Tiêu - Nguyễn Minh Khôi — Buổi 14 (GĐ2)", "Nguyễn Minh Khôi"),
      "Quản Lý Chi Tiêu"
    );
    assert.equal(cleanDemoProjectTitle("SPCK Lê Gia Huy", "Lê Gia Huy"), "Sản phẩm cuối khóa");
    assert.equal(detectSlideLinkMeta({ url: "https://www.canva.com/design/abc/view" })?.kind, "CANVA");
    assert.equal(detectSlideLinkMeta({ url: "https://drive.google.com/drive/folders/123" }), null);

    const pyStateRes = await stateGET(
      new Request(`http://127.0.0.1:3000/api/demo-day/state?classId=${pyClassId}`, {
        headers: { host: "127.0.0.1:3000" },
      })
    );
    const pyStateJson = await pyStateRes.json();
    assert.equal(pyStateRes.status, 200);
    assert.equal(
      pyStateJson.data.demoSheetUrl,
      "https://docs.google.com/spreadsheets/d/demoSheet123/edit"
    );

    const pyStu1 = pyStateJson.data.students.find((s: any) => s.studentId === "STU_PY_01");
    const pyStu2 = pyStateJson.data.students.find((s: any) => s.studentId === "STU_PY_02");
    const pyStu3 = pyStateJson.data.students.find((s: any) => s.studentId === "STU_PY_03");
    const pyStu4 = pyStateJson.data.students.find((s: any) => s.studentId === "STU_PY_04");

    assert.equal(pyStu1.projectTitle, "Quản Lý Chi Tiêu");
    assert.equal(pyStu1.slide.kind, "CANVA");
    assert.equal(pyStu1.product.relPath, "main.py");
    assert.ok(pyStu1.thumbnailUrl.includes("thumb_khoi.png"));
    assert.equal(pyStu2.slide.kind, "MISSING");
    assert.equal(pyStu3.slide.kind, "LOCAL_PPTX");
    assert.ok(pyStu4.thumbnailUrl.includes("default-spck-thumbnail.png"));

    // Web check
    const webStu2 = webStateJson.data.students.find((s: any) => s.studentId === "STU_WEB_02");
    assert.equal(webStu1.slide.kind, "GOOGLE_SLIDES");
    assert.equal(webStu2.slide.kind, "LOCAL_PPTX");
    assert.equal(webStu2.product.kind, "WEB_LOCAL");

    // GameMaker check & non-destructive staging
    const gmStateRes = await stateGET(
      new Request(`http://127.0.0.1:3000/api/demo-day/state?classId=${gmClassId}`, {
        headers: { host: "127.0.0.1:3000" },
      })
    );
    const gmStateJson = await gmStateRes.json();
    assert.equal(gmStateJson.data.hasAnyGameMakerProject, true);

    const prepGmRes1 = await launchPOST(
      new Request("http://127.0.0.1:3000/api/demo-day/launch", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({ action: "PREP_GAMEMAKER_CLASS", classId: gmClassId }),
      })
    );
    const prepGmJson1 = await prepGmRes1.json();
    assert.equal(prepGmRes1.status, 200);
    assert.equal(prepGmJson1.stagedCount, 2, "[DD-02] Phải giải nén đủ 2 bài GameMaker (.yyz + .yyp)");

    const prepGmRes2 = await launchPOST(
      new Request("http://127.0.0.1:3000/api/demo-day/launch", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({ action: "PREP_GAMEMAKER_CLASS", classId: gmClassId }),
      })
    );
    const prepGmJson2 = await prepGmRes2.json();
    assert.equal(prepGmJson2.reusedCount, 2, "[DD-02] Chạy lần 2 phải dùng lại cache stage TEMP");

    clearDryRunLaunchLog();
    const gmLaunchRes = await launchPOST(
      new Request("http://127.0.0.1:3000/api/demo-day/launch", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({
          action: "LAUNCH_PRODUCT",
          classId: gmClassId,
          studentId: "STU_GM_01",
        }),
      })
    );
    const gmLaunchJson = await gmLaunchRes.json();
    assert.equal(gmLaunchRes.status, 200);
    assert.ok(gmLaunchJson.stagedYypPath && fs.existsSync(gmLaunchJson.stagedYypPath));
    createdGmStageDirs.push(path.dirname(gmLaunchJson.stagedYypPath));

    const gm1DigestAfter = computeStudentFolderContentDigest(gmStu1Dir);
    assert.equal(
      gm1DigestAfter.digest,
      gm1DigestBefore.digest,
      "[DD-02] Thư mục SPCK gốc của học sinh GameMaker phải giữ nguyên vẹn 100% SHA-256"
    );
    const gmUploadRow = spckUploadRepo.findOne(gmClassId, "STU_GM_01");
    assert.equal(gmUploadRow?.status, "VERIFIED");
    assert.equal(gmUploadRow?.contentHash, expectedGm01Hash);

    // Local PPTX Slide dry-run launch
    const pptxRes = await launchPOST(
      new Request("http://127.0.0.1:3000/api/demo-day/launch", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({
          action: "OPEN_SLIDE",
          classId: pyClassId,
          studentId: "STU_PY_03",
        }),
      })
    );
    assert.equal(pptxRes.status, 200);
    assert.ok(getDryRunLaunchLog().some((r) => r.action === "OPEN_SLIDE" && r.filePath.endsWith("BaoCao.pptx")));

    // Real Python crash detection (`ModuleNotFoundError`)
    const pyCrashRes = await launchPOST(
      new Request("http://127.0.0.1:3000/api/demo-day/launch", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({
          action: "TEST_PRODUCT",
          classId: pyClassId,
          studentId: "STU_PY_03",
        }),
      })
    );
    const pyCrashJson = await pyCrashRes.json();
    assert.equal(pyCrashRes.status, 422, "[DD-02] File Python thiếu thư viện phải trả 422");
    assert.ok(
      pyCrashJson.error.includes("mindx_nonexistent_pkg_999"),
      `[DD-02] Lỗi phải nêu rõ tên thư viện thiếu: ${pyCrashJson.error}`
    );

    // Real Python live spawn + debounce + clean kill
    const pyRunRes = await launchPOST(
      new Request("http://127.0.0.1:3000/api/demo-day/launch", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({
          action: "LAUNCH_PRODUCT",
          classId: pyClassId,
          studentId: "STU_PY_01",
        }),
      })
    );
    const pyRunJson = await pyRunRes.json();
    assert.equal(pyRunRes.status, 200);
    assert.equal(pyRunJson.activeProcessCount, 1);

    const pyDebounceRes = await launchPOST(
      new Request("http://127.0.0.1:3000/api/demo-day/launch", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({
          action: "LAUNCH_PRODUCT",
          classId: pyClassId,
          studentId: "STU_PY_01",
        }),
      })
    );
    const pyDebounceJson = await pyDebounceRes.json();
    assert.equal(pyDebounceJson.debounced, true, "[DD-02] Bấm đúp trong 1.8s phải được chống trùng");

    const stopRes = await launchPOST(
      new Request("http://127.0.0.1:3000/api/demo-day/launch", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({ action: "STOP_PROCESSES" }),
      })
    );
    const stopJson = await stopRes.json();
    assert.equal(stopJson.activeProcessCount, 0);

    console.log("   ✅ [DD-02] PASSED!");

    // =========================================================================
    // [DD-03] Shuffle, Excluded Toggle, Canva Override, CAS & SPCK Isolation
    // =========================================================================
    console.log("\n[DD-03] Kiểm tra bốc thăm ngẫu nhiên, ẩn bạn vắng, lưu Canva & CAS rowVer...");

    const shuffled = shuffleDemoStudentOrder(["A", "B", "C", "D"], ["E"], () => 0.2);
    assert.equal(shuffled.length, 5);
    assert.equal(shuffled[4], "E");
    assert.deepEqual(
      reconcileDemoOrder(["C", "A"], ["A", "B", "C", "D"], { B: { excluded: true } }),
      ["C", "A", "D", "B"]
    );

    const shuffleSaveRes = await savePOST(
      new Request("http://127.0.0.1:3000/api/demo-day/save", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({ classId: pyClassId, shuffleRandom: true }),
      })
    );
    const shuffleSaveJson = await shuffleSaveRes.json();
    assert.equal(shuffleSaveRes.status, 200);
    assert.equal(shuffleSaveJson.data.order.length, 4);
    assert.equal(shuffleSaveJson.data.currentStudentId, shuffleSaveJson.data.order[0]);
    const verAfterShuffle = shuffleSaveJson.rowVer;

    // Exclude STU_PY_04 -> moves to tail
    const exclRes = await savePOST(
      new Request("http://127.0.0.1:3000/api/demo-day/save", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({
          classId: pyClassId,
          expectedRowVer: verAfterShuffle,
          studentOverride: { studentId: "STU_PY_04", excluded: true },
        }),
      })
    );
    const exclJson = await exclRes.json();
    assert.equal(exclRes.status, 200);
    assert.equal(exclJson.data.order[exclJson.data.order.length - 1], "STU_PY_04");

    // Stale CAS check
    const staleRes = await savePOST(
      new Request("http://127.0.0.1:3000/api/demo-day/save", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({
          classId: pyClassId,
          expectedRowVer: verAfterShuffle,
          currentStudentId: "STU_PY_02",
        }),
      })
    );
    const staleJson = await staleRes.json();
    assert.equal(staleRes.status, 409);
    assert.equal(staleJson.staleIgnored, true);

    // [F03] Invalid expectedRowVer (including explicit null) must return 400 and NEVER bypass CAS
    for (const badVer of ["oops", true, null, 0, -2, 1.5]) {
      const badVerRes = await savePOST(
        new Request("http://127.0.0.1:3000/api/demo-day/save", {
          method: "POST",
          headers: localHeaders,
          body: JSON.stringify({
            classId: pyClassId,
            expectedRowVer: badVer,
            currentStudentId: "STU_PY_02",
          }),
        })
      );
      assert.equal(
        badVerRes.status,
        400,
        `[F03] expectedRowVer=${JSON.stringify(badVer)} phải trả 400 thay vì tắt CAS`
      );
    }
    for (const badRepoVer of ["oops", null]) {
      assert.throws(
        () =>
          demoDayRepo.upsert({
            classId: pyClassId,
            currentStudentId: "STU_PY_02",
            expectedRowVer: badRepoVer as unknown as number,
          }),
        /expectedRowVer/i,
        `[F03] demoDayRepo.upsert phải từ chối expectedRowVer=${JSON.stringify(badRepoVer)}`
      );
    }

    // [F06] Unknown well-formed classId on POST save/launch must return 404 WITHOUT writing an orphan DB row
    const unknownSaveRes = await savePOST(
      new Request("http://127.0.0.1:3000/api/demo-day/save", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({
          classId: "NO_SUCH_CLASS_999",
          shuffleRandom: true,
        }),
      })
    );
    assert.equal(unknownSaveRes.status, 404, "[F06] Save vào lớp không tồn tại phải trả 404");
    assert.equal(
      demoDayRepo.findByClass("NO_SUCH_CLASS_999"),
      undefined,
      "[F06] Save thất bại (404) tuyệt đối không được tạo bản ghi rác trong SQLite"
    );

    const unknownLaunchRes = await launchPOST(
      new Request("http://127.0.0.1:3000/api/demo-day/launch", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({
          action: "PREP_GAMEMAKER_CLASS",
          classId: "NO_SUCH_CLASS_999",
        }),
      })
    );
    assert.equal(unknownLaunchRes.status, 404, "[F06] Launch vào lớp không tồn tại phải trả 404");

    // Reset pyClassId to clean deterministic order before E2E
    await savePOST(
      new Request("http://127.0.0.1:3000/api/demo-day/save", {
        method: "POST",
        headers: localHeaders,
        body: JSON.stringify({
          classId: pyClassId,
          order: ["STU_PY_01", "STU_PY_02", "STU_PY_03", "STU_PY_04"],
          currentStudentId: "STU_PY_01",
          completedStudentIds: [],
          studentOverride: { studentId: "STU_PY_04", excluded: false },
        }),
      })
    );

    const pyUploadAfter = spckUploadRepo.findOne(pyClassId, "STU_PY_01");
    assert.equal(pyUploadAfter?.status, "VERIFIED");
    assert.equal(pyUploadAfter?.contentHash, expectedPy01Hash);

    await closeDemoWebPreviewServer();
    stopActiveDemoProcesses();
    closeDb();

    console.log("   ✅ [DD-03] PASSED!");

    // =========================================================================
    // [DD-04] Live Headless Chromium E2E on 127.0.0.1:3096 (Light & Dark)
    // =========================================================================
    console.log("\n[DD-04] Khởi chạy máy chủ thử nghiệm Next.js & kiểm thử Chromium thật...");
    if (fs.existsSync(e2eDistAbs) || fs.existsSync(e2eTsconfigAbs)) {
      throw new Error(`Thư mục tạm E2E đã tồn tại ngoài ý muốn: ${e2eDistAbs}`);
    }
    fs.mkdirSync(e2eDistAbs, { recursive: true });
    createdE2eDist = true;
    const rootTsconfig = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "tsconfig.json"), "utf8")
    );
    rootTsconfig.compilerOptions = {
      ...(rootTsconfig.compilerOptions || {}),
      paths: { "@/*": ["../src/*"] },
    };
    fs.writeFileSync(e2eTsconfigAbs, JSON.stringify(rootTsconfig, null, 2), "utf8");
    createdE2eTsconfig = true;

    const baseUrl = `http://127.0.0.1:${testPort}`;
    nextServer = spawn(
      process.execPath,
      ["./node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(testPort)],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          MINDX_NEXT_DIST_DIR: e2eDistRel,
          MINDX_NEXT_TSCONFIG_PATH: e2eTsconfigRel,
          ALLOWED_LOCAL_DIRS: tmpRoot,
          MINDX_ALLOWED_EXTRA_PATHS: tmpRoot,
          MINDX_DB_PATH: tmpDbPath,
          MINDX_CONFIG_DIR: tmpConfigDir,
          MINDX_RUNNING_CLASSES_PATH: tmpRunningClassesPath,
          MINDX_DEMO_LAUNCH_DRY_RUN: "1",
          MINDX_DEMO_ALLOW_PYTHON_IN_DRY_RUN: "1",
          NEXT_TELEMETRY_DISABLED: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    nextServer.stdout?.on("data", (d) => serverLogs.push(String(d)));
    nextServer.stderr?.on("data", (d) => serverLogs.push(String(d)));

    await waitForHttpReady(`${baseUrl}/api/demo-day/state?classId=${pyClassId}`, 60000);

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript("globalThis.__name = globalThis.__name || ((x) => x);");
    const page = await context.newPage();

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });

    await page.goto(`${baseUrl}/demo-day?classId=${pyClassId}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(`[data-testid="dd-stage-student-name"]`, { timeout: 60000 });
    await page.waitForFunction(
      () =>
        document
          .querySelector(`[data-testid="dd-stage-student-name"]`)
          ?.textContent?.includes("Nguyễn Minh Khôi")
    );

    const assertNavbarAndOverflow = async (vpLabel: string) => {
      const issues = await page.evaluate(() => {
        const probs: string[] = [];
        const links = Array.from(document.querySelectorAll("header.mindx-navbar nav a"));
        for (const a of links) {
          const r = a.getBoundingClientRect();
          if (r.height > 60) {
            probs.push(`Nav wrapped (${Math.round(r.height)}px): ${a.textContent?.trim()}`);
          }
        }
        if (document.documentElement.scrollWidth > window.innerWidth + 1) {
          probs.push(
            `Horizontal overflow: ${document.documentElement.scrollWidth} > ${window.innerWidth}`
          );
        }
        return probs;
      });
      assert.deepEqual(issues, [], `[DD-04] TopNavbar & overflow (${vpLabel}): ${issues.join("; ")}`);
    };

    const assertWcagContrast = async (themeLabel: string) => {
      const bad = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const toRgba = (str: string) => {
          if (!str || str === "transparent") return null;
          const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
          if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
          if (!ctx) return null;
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = str;
          ctx.fillRect(0, 0, 1, 1);
          const d = ctx.getImageData(0, 0, 1, 1).data;
          return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
        };
        const over = (fg: any, bg: any) => ({
          r: fg.r * fg.a + bg.r * (1 - fg.a),
          g: fg.g * fg.a + bg.g * (1 - fg.a),
          b: fg.b * fg.a + bg.b * (1 - fg.a),
        });
        const lum = (c: any) => {
          const lin = [c.r, c.g, c.b].map((v: number) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
        };
        const bgOf = (el: Element | null) => {
          const layers: any[] = [];
          let cur: Element | null = el;
          while (cur) {
            const bg = toRgba(getComputedStyle(cur).backgroundColor);
            if (bg && bg.a > 0) layers.push(bg);
            cur = cur.parentElement;
          }
          const isDark = document.documentElement.getAttribute("data-theme") === "dark";
          let acc = isDark ? { r: 11, g: 18, b: 36 } : { r: 220, g: 230, b: 242 };
          for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i], acc);
          return acc;
        };

        const targets = Array.from(
          document.querySelectorAll(
            "[data-testid^='dd-']:not(:disabled)"
          )
        );
        const failures: string[] = [];
        for (const el of targets) {
          if (el.tagName === "IMG" || el.tagName === "INPUT") continue;
          const txt = (el.textContent || "").trim();
          if (!txt) continue;
          const cs = getComputedStyle(el);
          const fgRaw = toRgba(cs.color);
          if (!fgRaw) continue;
          const bg = bgOf(el);
          const fg = fgRaw.a < 1 ? over(fgRaw, bg) : fgRaw;
          const l1 = lum(fg);
          const l2 = lum(bg);
          const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          if (ratio < 4.5) {
            failures.push(`${el.getAttribute("data-testid")} ("${txt.slice(0, 24)}"): ${ratio.toFixed(2)}`);
          }
        }
        return failures;
      });
      assert.deepEqual(bad, [], `[DD-04] WCAG AA >= 4.5 (${themeLabel}): ${bad.join("; ")}`);
    };

    // Check real 16:9 thumbnail image loads & no local path leaks on Stage
    await page.waitForFunction(() => {
      const img = document.querySelector(`[data-testid="dd-stage-thumbnail-img"]`) as HTMLImageElement | null;
      return Boolean(img && img.complete && img.naturalWidth > 0);
    });

    const stageAudit = await page.evaluate(() => {
      const txt = document.body.innerText;
      return {
        student: document.querySelector(`[data-testid="dd-stage-student-name"]`)?.textContent?.trim(),
        title: document.querySelector(`[data-testid="dd-stage-project-title"]`)?.textContent?.trim(),
        hasPathLeak: /[A-Z]:\\|\.yyz|\.pptx|MINDX_SPCK_FINAL|mindx-dd-v380/i.test(txt),
      };
    });
    assert.equal(stageAudit.student, "Nguyễn Minh Khôi");
    assert.equal(stageAudit.title, "Quản Lý Chi Tiêu");
    assert.equal(stageAudit.hasPathLeak, false, "[DD-04] Màn Sân khấu tuyệt đối không được lộ đường dẫn ổ cứng");

    for (const vp of [
      { width: 1280, height: 800, label: "1280x800" },
      { width: 1366, height: 768, label: "1366x768" },
      { width: 1440, height: 900, label: "1440x900" },
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await assertNavbarAndOverflow(vp.label);
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await assertWcagContrast("Stage Light");
    await page.click("button.mindx-theme-toggle");
    await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "dark");
    await sleep(250);
    await assertWcagContrast("Stage Dark");
    await page.click("button.mindx-theme-toggle");
    await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "light");
    await sleep(250);

    // Click Next -> marks STU_PY_01 completed ✓ and moves to STU_PY_02
    await page.click(`[data-testid="dd-next-btn"]`);
    await page.waitForSelector(`[data-testid="dd-queue-done-STU_PY_01"]`);
    await page.waitForFunction(
      () =>
        document
          .querySelector(`[data-testid="dd-stage-student-name"]`)
          ?.textContent?.includes("Trần Bảo Ngọc")
    );

    // Switch to Prep tab -> verify Canva inline save updates ready count to 3/4
    await page.click(`[data-testid="dd-tab-prep"]`);
    await page.waitForSelector(`[data-testid="dd-prep-ready-count"]`);
    await assertWcagContrast("Prep Light");
    await page.click("button.mindx-theme-toggle");
    await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "dark");
    await sleep(250);
    await assertWcagContrast("Prep Dark");
    await page.click("button.mindx-theme-toggle");
    await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "light");
    await sleep(250);

    await page.fill(`[data-testid="dd-slide-input-STU_PY_02"]`, "https://www.canva.com/design/NGOC/view");
    await page.click(`[data-testid="dd-save-slide-STU_PY_02"]`);
    await page.waitForSelector(`[data-testid="dd-slide-badge-STU_PY_02"]`);
    const readyText = await page.textContent(`[data-testid="dd-prep-ready-count"]`);
    assert.ok(readyText?.includes("3/4"), `[DD-04] Cập nhật Canva cho STU_PY_02 phải tăng đủ bài lên 3/4 (got: ${readyText})`);

    // Shuffle via button
    await page.click(`[data-testid="dd-shuffle-btn"]`);
    await page.waitForSelector(`[data-testid="dd-status-pill"]`);

    // Check /final-project renders shortcut link to /demo-day
    await page.goto(`${baseUrl}/final-project?classId=${pyClassId}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(`[data-testid="spck-open-demo-day-link"]`, { timeout: 60000 });

    assert.deepEqual(consoleErrors, [], `[DD-04] Console errors: ${consoleErrors.join(" | ")}`);
    assert.deepEqual(pageErrors, [], `[DD-04] Page errors: ${pageErrors.join(" | ")}`);

    // [F02-E2E] Stale localStorage auto-recovery vs explicit empty ?classId= error banner on separate page
    const probePage = await context.newPage();
    await probePage.addInitScript(() => {
      window.localStorage.setItem("mindx_selected_class_code", "STALE_GONE_CLASS_999");
    });
    await probePage.goto(`${baseUrl}/demo-day`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await probePage.waitForSelector(`[data-testid="dd-stage-student-name"]`, { timeout: 60000 });
    assert.equal(
      await probePage.locator(`[data-testid="dd-error-banner"]`).count(),
      0,
      "[F02-E2E] Stale localStorage trên /demo-day phải tự chuyển về lớp mặc định không hiện lỗi"
    );

    await probePage.goto(`${baseUrl}/demo-day?classId=`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await probePage.waitForSelector(`[data-testid="dd-error-banner"]`, { timeout: 60000 });
    assert.equal(
      await probePage.locator(`[data-testid="dd-stage-student-name"]`).count(),
      0,
      "[F02-E2E] URL ?classId= rỗng tường minh phải báo lỗi thay vì tự tải lớp mặc định"
    );
    await probePage.close();

    console.log("   ✅ [DD-04] PASSED!");
    console.log("\n🎉 TẤT CẢ KIỂM THỬ v3.8.0 [DD-01..DD-04] ĐỀU ĐẠT 100%!");
  } catch (err) {
    if (serverLogs.length > 0) {
      console.error("\n--- NEXT DEV SERVER LOGS (LAST 25 LINES) ---");
      console.error(serverLogs.join("").split(/\r?\n/).slice(-25).join("\n"));
    }
    throw err;
  } finally {
    if (browser) await browser.close().catch(() => {});
    killProcessTree(nextServer);
    await closeDemoWebPreviewServer().catch(() => {});
    stopActiveDemoProcesses();
    closeDb();
    try {
      if (origNextEnvDts !== null) {
        fs.writeFileSync(nextEnvPath, origNextEnvDts);
      }
      for (const dir of createdGmStageDirs) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      if (createdE2eDist && fs.existsSync(e2eDistAbs) && fs.lstatSync(e2eDistAbs).isDirectory()) {
        fs.rmSync(e2eDistAbs, { recursive: true, force: true });
      }
      if (createdE2eTsconfig && fs.existsSync(e2eTsconfigAbs) && fs.lstatSync(e2eTsconfigAbs).isFile()) {
        fs.rmSync(e2eTsconfigAbs, { force: true });
      }
      fs.rmSync(outsideSecretDir, { recursive: true, force: true });
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error("❌ KIỂM THỬ v3.8.0 THẤT BẠI:", err);
  process.exit(1);
});
