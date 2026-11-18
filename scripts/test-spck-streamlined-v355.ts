/**
 * MINDX AUTOMATION BOT - VERIFICATION SUITE FOR v3.5.5
 * 100% isolated in `os.tmpdir()` (zero mutations to live `data/mindx_bot.db` or `data/running_classes.json`):
 * - R355-01: `PTB`/`CSB` SPCK & Demo exemptions (selectable in `/api/spck/list`, blocked on Portal/Drive/Web) +
 *            `CSA`/`CSI` & Web (`JSB, JSA, JSI`) GitHub Pages clean wipe-and-replace (`git add -A`) via local bare
 *            Git repository, skipping pure Python students (`SKIPPED_NO_HTML`) in <5ms with 0 git calls.
 * - R355-02: Google Drive "Cách 1" (`zip_bundle` default: `<StudentSlug>_SPCK_<B12|B13|B14>_*.zip` + standalone
 *            `.pptx`/`.pdf`/`.mp4`) + upload-first safety ("Tải mới xong mới xóa cũ": failed upload keeps 100% of
 *            old files & legacy subfolders; successful re-upload trashes old `.zip`/slides/subfolders while keeping
 *            `studentDriveFolderId` & share URL identical).
 * - R355-03: Student Portal auto-confirm (`requireTeacherConfirmation: false` default) + safe `.zip` auto-extract
 *            (single-folder unwrap, `.rar`/`.7z` & Zip-Slip & `.exe` inside `.zip` rejections) + automatic 16:9
 *            screenshot capture + 1-click rolling backup restore (`restore_backup`).
 * - R355-04: Clean screenshot re-capture (`_spck_app_shots` 100% wipe + cache-busted filenames + zero false
 *            `VERIFIED_FILE_DRIFT` on prior verified sessions), Quick Tags inheritance (`12 -> 13 -> 14`),
 *            smart `folderContentChanged` digest scan, per-student error isolation (`/api/spck/capture-screenshots`
 *            `partialFailure: true` & `/api/spck/approve` `isolatePerStudent`), and Real LMS Modal (`reusedExistingItem01`)
 *            100% gallery screenshot & attachment tile wipe-and-replace.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { chromium } from "playwright";

const ROOT = process.cwd();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-v355-test-"));
const tempConfigDir = path.join(tempRoot, "config");
const tempSpckRoot = path.join(tempRoot, "spck_root");
const tempRoleDir = path.join(tempRoot, "role-state");

fs.mkdirSync(path.join(tempConfigDir, "demo-sheet-templates"), { recursive: true });
fs.mkdirSync(tempSpckRoot, { recursive: true });
fs.mkdirSync(tempRoleDir, { recursive: true });

const liveTemplatesDir = path.join(ROOT, "data", "config", "demo-sheet-templates");
if (fs.existsSync(liveTemplatesDir)) {
  for (const file of fs.readdirSync(liveTemplatesDir)) {
    if (file.toLowerCase().endsWith(".xlsx")) {
      fs.copyFileSync(
        path.join(liveTemplatesDir, file),
        path.join(tempConfigDir, "demo-sheet-templates", file)
      );
    }
  }
}
for (const cfgFile of ["default-demo-sheet-template.xlsx", "default-spck-thumbnail.png"]) {
  const srcPath = path.join(ROOT, "data", "config", cfgFile);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, path.join(tempConfigDir, cfgFile));
  }
}

process.env.MINDX_DB_PATH = path.join(tempRoot, "mindx_v355_test.db");
process.env.MINDX_CONFIG_DIR = tempConfigDir;
process.env.MINDX_RUNNING_CLASSES_PATH = path.join(tempRoot, "running_classes.json");
process.env.MINDX_LMS_CLASS_IDS_PATH = path.join(tempConfigDir, "lms_class_ids.json");
process.env.MINDX_ROLE_STATE_DIR = tempRoleDir;
process.env.ALLOWED_LOCAL_DIRS = tempRoot;
process.env.MINDX_ALLOWED_EXTRA_PATHS = tempRoot;
process.env.MINDX_DISABLE_PORTAL_TUNNEL = "1";
process.env.MINDX_DISABLE_BROWSER_EXPORT_FALLBACK = "1";
process.env.GEMINI_API_KEY = "AIzaDummyTestKeyV355_NeverLive";

fs.writeFileSync(
  process.env.MINDX_RUNNING_CLASSES_PATH,
  JSON.stringify(
    [
      { classCode: "VT-C4K-CSB09", status: "Running" },
      { classCode: "VT-C4K-PTB02", status: "Running" },
      { classCode: "VT-C4K-CSA12", status: "Running" },
      { classCode: "VT-C4K-PTA15", status: "Running" },
      { classCode: "VT-JSB18", status: "Running" },
    ],
    null,
    2
  ),
  "utf-8"
);
fs.writeFileSync(process.env.MINDX_LMS_CLASS_IDS_PATH, JSON.stringify({}, null, 2), "utf-8");

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

/**
 * Crafts a raw minimal ZIP archive buffer containing an exact entry filename (even `../escape.html`)
 * without `adm-zip` normalizing away `..` segments before write, so server-side Zip-Slip guards are genuinely tested.
 */
function buildRawZipWithExactEntryName(rawFileName: string, content: Buffer): Buffer {
  const nameBuf = Buffer.from(rawFileName, "utf8");
  // CRC-32 calculation
  let crc = 0xffffffff;
  for (let i = 0; i < content.length; i++) {
    crc ^= content[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  crc = (crc ^ 0xffffffff) >>> 0;

  const localHeader = Buffer.alloc(30 + nameBuf.length);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0x0800, 6); // UTF-8
  localHeader.writeUInt16LE(0, 8); // Store (0)
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0, 12);
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(content.length, 18);
  localHeader.writeUInt32LE(content.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);
  nameBuf.copy(localHeader, 30);

  const centralHeader = Buffer.alloc(46 + nameBuf.length);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0x0800, 8);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt16LE(0, 12);
  centralHeader.writeUInt16LE(0, 14);
  centralHeader.writeUInt32LE(crc, 16);
  centralHeader.writeUInt32LE(content.length, 20);
  centralHeader.writeUInt32LE(content.length, 24);
  centralHeader.writeUInt16LE(nameBuf.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(0, 42);
  nameBuf.copy(centralHeader, 46);

  const cdOffset = localHeader.length + content.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralHeader.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localHeader, content, centralHeader, eocd]);
}

interface MockDriveNode {
  id: string;
  parentId: string;
  name: string;
  isFolder: boolean;
  mimeType: string;
  trashed?: boolean;
  fileBuffer?: Buffer;
}

async function run(): Promise<void> {
  const {
    closeDb,
    computeSafeFileByteDigest,
    getDb,
    spckSessionRepo,
    spckUploadRepo,
    studentRepo,
    verifySpckSessionIntegrity,
  } = await import("../src/lib/db/sqlite");
  const {
    computeStudentFolderContentDigest,
    isCourseExemptFromSpck,
    isWebOrCsGithubTrack,
  } = await import("../src/lib/local-files/spck-scanner");
  const { BrowserManager } = await import("../src/lib/playwright/browser-manager");
  const {
    CODING_SPCK_COURSE_FOLDER_MAP,
    CODING_SPCK_ROOT_FOLDER_ID,
    prepareStudentZipBundleAndStandaloneMediaForDrive,
  } = await import("../src/lib/playwright/spck-drive-uploader");
  const { SpckWebDeployer } = await import("../src/lib/github/spck-web-deployer");
  const { SpckUploader } = await import("../src/lib/playwright/spck-uploader");
  const { studentPortalManager } = await import(
    "../src/lib/student-portal/student-portal-server"
  );

  const { GET: listGet } = await import("../src/app/api/spck/list/route");
  const { POST: scanPost } = await import("../src/app/api/spck/scan/route");
  const { POST: capturePost } = await import(
    "../src/app/api/spck/capture-screenshots/route"
  );
  const { POST: uploadDrivePost } = await import(
    "../src/app/api/spck/upload-drive/route"
  );
  const { POST: deployWebPost } = await import("../src/app/api/spck/deploy-web/route");
  const { POST: portalPost } = await import("../src/app/api/spck/student-portal/route");
  const { POST: approvePost } = await import("../src/app/api/spck/approve/route");

  let mockDriveServer: http.Server | null = null;
  let mockLmsServer: http.Server | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  const origGetPage = BrowserManager.prototype.getPage;

  try {
    const db = getDb();
    for (const cid of [
      "VT-C4K-CSB09",
      "VT-C4K-PTB02",
      "VT-C4K-CSA12",
      "VT-C4K-PTA15",
      "VT-JSB18",
    ]) {
      for (const sNum of [12, 13, 14]) {
        db.prepare(
          `INSERT OR REPLACE INTO classes_sessions (sessionId, classId, className, sessionNumber, date) VALUES (?, ?, ?, ?, '2026-11-16')`
        ).run(`${cid}_S_${sNum}`, cid, cid, sNum);
      }
    }

    // =========================================================================
    // R355-01: Course Exemptions (PTB/CSB) + CSA/CSI & Web GitHub Pages Clean Wipe-and-Replace
    // =========================================================================
    console.log(
      "1. [R355-01] Kiểm tra miễn SPCK cho PTB/CSB + đẩy GitHub Pages xóa cũ thêm mới cho CSA/CSI & Web..."
    );
    assert.strictEqual(isCourseExemptFromSpck("VT-C4K-PTB02"), true);
    assert.strictEqual(isCourseExemptFromSpck("VT-C4K-CSB09"), true);
    assert.strictEqual(isCourseExemptFromSpck("VT-C4K-PTA15"), false);
    assert.strictEqual(isCourseExemptFromSpck("VT-C4K-CSA12"), false);
    assert.strictEqual(isCourseExemptFromSpck("VT-JSB18"), false);

    assert.strictEqual(isWebOrCsGithubTrack("VT-JSB18"), true);
    assert.strictEqual(isWebOrCsGithubTrack("VT-JSA04"), true);
    assert.strictEqual(isWebOrCsGithubTrack("VT-JSI02"), true);
    assert.strictEqual(isWebOrCsGithubTrack("VT-C4K-CSA12"), true);
    assert.strictEqual(isWebOrCsGithubTrack("VT-C4K-CSI07"), true);
    assert.strictEqual(isWebOrCsGithubTrack("VT-C4K-CSB09"), false);
    assert.strictEqual(isWebOrCsGithubTrack("VT-C4K-PTA15"), false);

    studentRepo.upsert({
      studentId: "CSB_STU_01",
      classId: "VT-C4K-CSB09",
      fullName: "Lê Minh Quân",
      isActive: 1,
    });
    studentRepo.upsert({
      studentId: "PTB_STU_01",
      classId: "VT-C4K-PTB02",
      fullName: "Trần Bảo Ngọc",
      isActive: 1,
    });

    const listCsbRes = await listGet(
      makeLocalRequest("http://127.0.0.1:3000/api/spck/list?classId=VT-C4K-CSB09&sessionNumber=14")
    );
    const listCsbJson = await listCsbRes.json();
    assert.strictEqual(listCsbRes.status, 200);
    const listedClassIds = (listCsbJson.classes || []).map((c: any) =>
      typeof c === "string" ? c : c.classId
    );
    assert.ok(listedClassIds.includes("VT-C4K-CSB09"));
    assert.ok(listedClassIds.includes("VT-C4K-PTB02"));
    assert.strictEqual(listCsbJson.demoSheetMeta?.spckExempt, true);
    assert.strictEqual(listCsbJson.demoSheetMeta?.demoExempt, true);

    for (const exemptCid of ["VT-C4K-CSB09", "VT-C4K-PTB02"]) {
      const pRes = await portalPost(
        makeLocalRequest("http://127.0.0.1:3000/api/spck/student-portal", "POST", {
          action: "start",
          classId: exemptCid,
          folderPath: path.join(tempSpckRoot, exemptCid),
        })
      );
      assert.strictEqual(
        pRes.status,
        400,
        `Cổng thu bài SPCK phải chặn lớp miễn thi ${exemptCid} với HTTP 400!`
      );

      const dRes = await uploadDrivePost(
        makeLocalRequest("http://127.0.0.1:3000/api/spck/upload-drive", "POST", {
          classId: exemptCid,
        })
      );
      assert.strictEqual(
        dRes.status,
        400,
        `Upload Google Drive SPCK mặc định phải chặn lớp miễn thi ${exemptCid} với HTTP 400!`
      );

      const wRes = await deployWebPost(
        makeLocalRequest("http://127.0.0.1:3000/api/spck/deploy-web", "POST", {
          classId: exemptCid,
          repoUrl: "https://github.com/mindx-test/spck-pages",
        })
      );
      assert.strictEqual(
        wRes.status,
        400,
        `Deploy GitHub Pages phải chặn lớp miễn thi ${exemptCid} với HTTP 400!`
      );
    }

    // Local bare Git repo test for CSA12 (1 HTML student + 1 pure Python student)
    const bareRepoDir = path.join(tempRoot, "mock-github-pages.git");
    execFileSync("git", ["init", "--bare", "--initial-branch=main", bareRepoDir], {
      stdio: "pipe",
    });

    // Seed initial commit with >280-char Windows MAX_PATH (>260) relative path
    const longRelPath =
      "VT-JSB16/nguyen-huu-phuoc/image 3d printer/uniformation-gk3-pro-16k-resin-3d-printer-385nm-uv-sla-printer-with-industrial-grade-quality-west3d-3d-printing-supplies-uniformation-7603412-win32-longpath-regression-padding-0123456789.webp";
    const clonedWorkRepoLongPathLen = path.join(
      tempRoot,
      "_spck_web_work",
      "_github_pages_repo",
      ...longRelPath.split("/")
    ).length;
    assert.ok(
      clonedWorkRepoLongPathLen > 280,
      `Expected Win32 >260 MAX_PATH regression length (>280), got ${clonedWorkRepoLongPathLen}`
    );
    const seedCloneDir = path.join(tempRoot, "seed-clone");
    execFileSync(
      "git",
      [
        "-c",
        "core.longpaths=true",
        "clone",
        "--config",
        "core.longpaths=true",
        bareRepoDir,
        seedCloneDir,
      ],
      { stdio: "pipe" }
    );
    const seedLongFilePath = path.join(seedCloneDir, ...longRelPath.split("/"));
    fs.mkdirSync(path.dirname(seedLongFilePath), { recursive: true });
    fs.writeFileSync(seedLongFilePath, "FAKE_WEBP_BYTES", "utf-8");
    execFileSync(
      "git",
      ["-c", "core.longpaths=true", "-C", seedCloneDir, "add", "--", longRelPath],
      { stdio: "pipe" }
    );
    execFileSync(
      "git",
      [
        "-c",
        "core.longpaths=true",
        "-c",
        "user.name=Seed",
        "-c",
        "user.email=seed@mindx.local",
        "-C",
        seedCloneDir,
        "commit",
        "-m",
        "Seed Win32 >260 MAX_PATH regression file",
      ],
      { stdio: "pipe" }
    );
    execFileSync(
      "git",
      ["-c", "core.longpaths=true", "-C", seedCloneDir, "push", "origin", "HEAD:main"],
      { stdio: "pipe" }
    );
    fs.rmSync(seedCloneDir, { recursive: true, force: true });

    const csaRootDir = path.join(tempSpckRoot, "CSA12");
    const csaHtmlDir = path.join(csaRootDir, "Pham Minh Khoa");
    const csaPyDir = path.join(csaRootDir, "Do Thanh Tung");
    fs.mkdirSync(csaHtmlDir, { recursive: true });
    fs.mkdirSync(csaPyDir, { recursive: true });

    fs.writeFileSync(
      path.join(csaHtmlDir, "index.html"),
      "<!doctype html><html><body><h1>CSA12 Khoa V1</h1><link rel='stylesheet' href='legacy_v1.css'/></body></html>",
      "utf-8"
    );
    fs.writeFileSync(path.join(csaHtmlDir, "legacy_v1.css"), "body { color: #111; }\n", "utf-8");
    fs.writeFileSync(path.join(csaHtmlDir, "empty_placeholder.css"), "", "utf-8");
    fs.writeFileSync(path.join(csaPyDir, "main.py"), "print('Pure Python CLI CSA')\n", "utf-8");

    studentRepo.upsert({
      studentId: "CSA_HTML",
      classId: "VT-C4K-CSA12",
      fullName: "Phạm Minh Khoa",
      isActive: 1,
    });
    studentRepo.upsert({
      studentId: "CSA_PY",
      classId: "VT-C4K-CSA12",
      fullName: "Đỗ Thanh Tùng",
      isActive: 1,
    });

    const scanCsaRes = await scanPost(
      makeLocalRequest("http://127.0.0.1:3000/api/spck/scan", "POST", {
        classId: "VT-C4K-CSA12",
        sessionNumber: 12,
        folderPath: csaRootDir,
        syncActiveSession: true,
      })
    );
    const scanCsaJson = await scanCsaRes.json();
    assert.strictEqual(scanCsaRes.status, 200);
    const khoaScanItem = (scanCsaJson.scanResult?.items || []).find(
      (m: any) => m.match?.suggestedStudentId === "CSA_HTML"
    );
    const tungScanItem = (scanCsaJson.scanResult?.items || []).find(
      (m: any) => m.match?.suggestedStudentId === "CSA_PY"
    );
    assert.strictEqual(khoaScanItem?.hasHtmlFiles, true);
    assert.strictEqual(tungScanItem?.hasHtmlFiles, false);

    // Pure Python student alone -> 0 git calls, SKIPPED_NO_HTML
    const pyOnlyDeploy = await SpckWebDeployer.deployClassWebSpckToGithubPages({
      classId: "VT-C4K-CSA12",
      repoUrl: bareRepoDir,
      studentIds: ["CSA_PY"],
      sessionNumber: 12,
      syncAllUnverifiedSessions: true,
    });
    assert.strictEqual(pyOnlyDeploy.deployedStudentsCount, 0);
    assert.strictEqual(pyOnlyDeploy.results[0]?.status, "SKIPPED_NO_HTML");

    // Full CSA12 class deploy (Buổi 12)
    const csaDeployB12 = await SpckWebDeployer.deployClassWebSpckToGithubPages({
      classId: "VT-C4K-CSA12",
      repoUrl: bareRepoDir,
      sessionNumber: 12,
      syncAllUnverifiedSessions: true,
    });
    assert.strictEqual(csaDeployB12.deployedStudentsCount, 1);
    const khoaB12Res = csaDeployB12.results.find((r) => r.studentId === "CSA_HTML")!;
    const tungB12Res = csaDeployB12.results.find((r) => r.studentId === "CSA_PY")!;
    assert.strictEqual(khoaB12Res.status, "SUCCESS");
    assert.strictEqual(tungB12Res.status, "SKIPPED_NO_HTML");
    assert.ok(khoaB12Res.liveWebUrl && khoaB12Res.liveWebUrl.startsWith("https://"));

    const treeB12 = execFileSync("git", ["ls-tree", "-r", "--name-only", "main"], {
      cwd: bareRepoDir,
      encoding: "utf-8",
    });
    assert.ok(treeB12.includes("legacy_v1.css"), `Tree B12 phải có legacy_v1.css: ${treeB12}`);
    assert.ok(
      treeB12.includes("empty_placeholder.css"),
      `Tree B12 phải giữ lại tệp 0-byte empty_placeholder.css của học viên: ${treeB12}`
    );

    // Deliberately disable core.longpaths on cached clone to verify SpckWebDeployer overrides & resets >260 char paths cleanly
    const tempWorkRepoDir = path.join(tempRoot, "_spck_web_work", "_github_pages_repo");
    execFileSync("git", ["-C", tempWorkRepoDir, "config", "core.longpaths", "false"], {
      stdio: "pipe",
    });

    // Buổi 13 Re-deploy: delete `legacy_v1.css`, add `modern_v2.js` -> verify `git add -A` deletes `legacy_v1.css`!
    fs.unlinkSync(path.join(csaHtmlDir, "legacy_v1.css"));
    fs.writeFileSync(
      path.join(csaHtmlDir, "index.html"),
      "<!doctype html><html><body><h1>CSA12 Khoa V2 Updated</h1><script src='modern_v2.js'></script></body></html>",
      "utf-8"
    );
    fs.writeFileSync(path.join(csaHtmlDir, "modern_v2.js"), "console.log('B13 clean');\n", "utf-8");

    const csaDeployB13 = await SpckWebDeployer.deployClassWebSpckToGithubPages({
      classId: "VT-C4K-CSA12",
      repoUrl: bareRepoDir,
      sessionNumber: 13,
      syncAllUnverifiedSessions: true,
    });
    const khoaB13Res = csaDeployB13.results.find((r) => r.studentId === "CSA_HTML")!;
    assert.strictEqual(khoaB13Res.status, "SUCCESS");
    assert.strictEqual(
      khoaB13Res.liveWebUrl,
      khoaB12Res.liveWebUrl,
      "Link Web chạy thử GitHub Pages ở Buổi 13 phải giữ nguyên 100% URL từ Buổi 12!"
    );

    const treeB13 = execFileSync("git", ["ls-tree", "-r", "--name-only", "main"], {
      cwd: bareRepoDir,
      encoding: "utf-8",
    });
    assert.ok(
      !treeB13.includes("legacy_v1.css"),
      `File cũ 'legacy_v1.css' phải bị xóa sạch khỏi nhánh main nhờ 'git add -A'! Tree thực tế:\n${treeB13}`
    );
    assert.ok(
      treeB13.includes("modern_v2.js"),
      `File mới 'modern_v2.js' phải có trên nhánh main! Tree thực tế:\n${treeB13}`
    );
    console.log("  -> PASS R355-01.");

    // =========================================================================
    // R355-02: Google Drive "Cách 1" (.zip Bundle + Standalone Slide/Video) & Upload-First Safety
    // =========================================================================
    console.log(
      "2. [R355-02] Kiểm tra Google Drive Cách 1 (.zip + Slide/Video rời) & an toàn 'Tải mới xong mới xóa cũ'..."
    );
    const ptaClassId = "VT-C4K-PTA15";
    const ptaRootDir = path.join(tempSpckRoot, "PTA15");
    const anDir = path.join(ptaRootDir, "Nguyen Gia An");
    fs.mkdirSync(path.join(anDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(anDir, "_spck_app_shots"), { recursive: true });
    fs.mkdirSync(path.join(anDir, "_portal_backups"), { recursive: true });
    fs.mkdirSync(path.join(anDir, "node_modules", "dummy"), { recursive: true });
    fs.mkdirSync(path.join(anDir, ".venv"), { recursive: true });

    fs.writeFileSync(path.join(anDir, "main.py"), "print('PTA15 Gia An B12')\n", "utf-8");
    fs.writeFileSync(path.join(anDir, "src", "engine.py"), "SCORE = 100\n", "utf-8");
    fs.writeFileSync(path.join(anDir, "Slide_Thuyet_Trinh_B12.pptx"), "PPTX_B12_BYTES", "utf-8");
    fs.writeFileSync(path.join(anDir, "Demo_Gameplay_B12.mp4"), "MP4_B12_BYTES", "utf-8");

    // Junk / Bot artifacts that MUST NOT enter the student's `.zip` archive
    fs.writeFileSync(path.join(anDir, "_spck_app_shots", "app_01_old.png"), MINIMAL_PNG_BUF);
    fs.writeFileSync(path.join(anDir, "_portal_backups", "old.py"), "old", "utf-8");
    fs.writeFileSync(path.join(anDir, "node_modules", "dummy", "index.js"), "noop", "utf-8");
    fs.writeFileSync(path.join(anDir, ".venv", "pyvenv.cfg"), "home = /usr", "utf-8");
    fs.writeFileSync(path.join(anDir, "an_app_package.zip"), "bot_zip", "utf-8");

    const preparedZip = prepareStudentZipBundleAndStandaloneMediaForDrive(
      anDir,
      "PTA_AN",
      "Nguyễn Gia An",
      { sessionNumber: 12 }
    );
    try {
      assert.match(preparedZip.zipFileName, /_SPCK_B12_\d{4}_\d{6}\.zip$/);
      assert.ok(
        preparedZip.zipFilePath.startsWith(tempRoot),
        `File staging zip phải nằm trong os.tmpdir(), không chạm workspace! Thực tế: ${preparedZip.zipFilePath}`
      );
      const zipEntries = new AdmZip(preparedZip.zipFilePath)
        .getEntries()
        .map((e) => e.entryName.replace(/\\/g, "/"));
      assert.ok(zipEntries.includes("main.py"));
      assert.ok(zipEntries.includes("src/engine.py"));
      assert.ok(!zipEntries.some((n) => n.includes("_spck_app_shots")));
      assert.ok(!zipEntries.some((n) => n.includes("_portal_backups")));
      assert.ok(!zipEntries.some((n) => n.includes("node_modules")));
      assert.ok(!zipEntries.some((n) => n.includes(".venv")));
      assert.ok(!zipEntries.some((n) => n.includes("an_app_package.zip")));

      const standaloneNames = preparedZip.standaloneMediaPaths.map((p) => path.basename(p));
      assert.ok(standaloneNames.includes("Slide_Thuyet_Trinh_B12.pptx"));
      assert.ok(standaloneNames.includes("Demo_Gameplay_B12.mp4"));
    } finally {
      preparedZip.cleanup();
    }

    studentRepo.upsert({
      studentId: "PTA_AN",
      classId: ptaClassId,
      fullName: "Nguyễn Gia An",
      isActive: 1,
    });
    await scanPost(
      makeLocalRequest("http://127.0.0.1:3000/api/spck/scan", "POST", {
        classId: ptaClassId,
        sessionNumber: 12,
        folderPath: ptaRootDir,
        syncActiveSession: true,
      })
    );

    const driveItems = new Map<string, MockDriveNode>();
    let driveSeq = 1;
    const nextDriveId = (prefix: string) =>
      `${prefix}_V355_${String(driveSeq++).padStart(6, "0")}_ID`;
    let blockFileRenderOnUpload = false;

    const ptaCourseFolderId = CODING_SPCK_COURSE_FOLDER_MAP.PTA;
    driveItems.set(CODING_SPCK_ROOT_FOLDER_ID, {
      id: CODING_SPCK_ROOT_FOLDER_ID,
      parentId: "MY_DRIVE",
      name: "CODING - SPCK",
      isFolder: true,
      mimeType: "application/vnd.google-apps.folder",
    });
    driveItems.set(ptaCourseFolderId, {
      id: ptaCourseFolderId,
      parentId: CODING_SPCK_ROOT_FOLDER_ID,
      name: "2. PTA",
      isFolder: true,
      mimeType: "application/vnd.google-apps.folder",
    });

    mockDriveServer = http.createServer((req, res) => {
      const u = new URL(req.url || "/", "http://127.0.0.1");

      if (req.method === "POST" && u.pathname === "/api/create-folder") {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          const { parentId, name } = JSON.parse(raw);
          const existing = Array.from(driveItems.values()).find(
            (i) => !i.trashed && i.isFolder && i.parentId === parentId && i.name === name
          );
          if (existing) {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ id: existing.id }));
            return;
          }
          const id = nextDriveId("FOLDER");
          driveItems.set(id, {
            id,
            parentId,
            name,
            isFolder: true,
            mimeType: "application/vnd.google-apps.folder",
          });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ id }));
        });
        return;
      }

      if (req.method === "POST" && u.pathname === "/api/upload-file") {
        const parentId = u.searchParams.get("parentId") || "";
        const fileName = u.searchParams.get("fileName") || "unnamed.bin";
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          if (blockFileRenderOnUpload) {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ simulatedErrorAlert: true }));
            return;
          }
          const id = nextDriveId("FILE");
          driveItems.set(id, {
            id,
            parentId,
            name: fileName,
            isFolder: false,
            mimeType: "application/octet-stream",
            fileBuffer: Buffer.concat(chunks),
          });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ id }));
        });
        return;
      }

      if (req.method === "POST" && u.pathname === "/api/trash") {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          const { id } = JSON.parse(raw);
          const node = driveItems.get(id);
          if (node) node.trashed = true;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }

      const folderMatch = u.pathname.match(/^\/drive\/folders\/([^/]+)$/);
      if (req.method === "GET" && folderMatch) {
        const folderId = folderMatch[1];
        const currentFolder = driveItems.get(folderId);
        const children = Array.from(driveItems.values()).filter(
          (i) => i.parentId === folderId && !i.trashed
        );
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html><html><head><title>${currentFolder?.name || folderId} - Google Drive</title></head><body>
          <button guidedhelpid="new_menu_button" aria-label="Mới" aria-expanded="false" id="btn-new">+ Mới</button>
          <ul id="new-menu" role="menu" style="display:none;">
            <li tabindex="0" role="menuitem" id="mi-folder">Thư mục mới</li>
            <li tabindex="0" role="menuitem" id="mi-upload">Tải tệp lên</li>
          </ul>
          <div id="dlg-new-folder" role="dialog" style="display:none;">
            <div>Thư mục mới</div>
            <input type="text" id="nf-input" />
            <button type="button" id="nf-create">Tạo</button>
          </div>
          <input type="file" id="hidden-file" multiple style="display:none;" />
          <div id="ctx-menu" role="menu" style="display:none;position:fixed;left:120px;top:120px;background:#fff;border:1px solid #000;">
            <div role="menuitem" id="mi-trash">Chuyển vào thùng rác</div>
          </div>
          <div id="err-alert-slot"></div>
          <main role="main">
            ${children
              .map((c) => {
                const t = c.isFolder ? "folder" : "file";
                return `<div data-target="doc" data-id="${c.id}" data-type="${t}" data-mime-type="${c.mimeType}" style="padding:6px;"><div data-id="${c.id}">${c.name}</div></div>`;
              })
              .join("")}
          </main>
          <script>
            const folderId = ${JSON.stringify(folderId)};
            let ctxId = '';
            document.getElementById('btn-new').onclick = () => {
              document.getElementById('new-menu').style.display = 'block';
              document.getElementById('btn-new').setAttribute('aria-expanded', 'true');
            };
            document.addEventListener('keydown', (e) => {
              if (e.key === 'Escape') {
                document.getElementById('new-menu').style.display = 'none';
                document.getElementById('ctx-menu').style.display = 'none';
              }
            });
            document.getElementById('mi-folder').onclick = () => {
              document.getElementById('new-menu').style.display = 'none';
              document.getElementById('dlg-new-folder').style.display = 'block';
            };
            document.getElementById('nf-create').onclick = async () => {
              const name = document.getElementById('nf-input').value;
              await fetch('/api/create-folder', { method: 'POST', body: JSON.stringify({ parentId: folderId, name }) });
              location.reload();
            };
            document.getElementById('mi-upload').onclick = () => {
              document.getElementById('new-menu').style.display = 'none';
              document.getElementById('hidden-file').click();
            };
            document.getElementById('hidden-file').onchange = async (e) => {
              const list = Array.from(e.target.files || []);
              let failed = false;
              for (const f of list) {
                const body = new Uint8Array(await f.arrayBuffer());
                const r = await fetch('/api/upload-file?parentId=' + folderId + '&fileName=' + encodeURIComponent(f.name), { method: 'POST', body });
                const j = await r.json();
                if (j && j.simulatedErrorAlert) failed = true;
              }
              if (failed) {
                document.getElementById('err-alert-slot').innerHTML = '<div role="alert">Tải lên không thành công</div>';
              } else {
                location.reload();
              }
            };
            document.querySelectorAll('[data-target="doc"]').forEach((el) => {
              el.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                ctxId = el.getAttribute('data-id');
                document.getElementById('ctx-menu').style.display = 'block';
              });
            });
            document.getElementById('mi-trash').onclick = async () => {
              document.getElementById('ctx-menu').style.display = 'none';
              await fetch('/api/trash', { method: 'POST', body: JSON.stringify({ id: ctxId }) });
              location.reload();
            };
          </script>
        </body></html>`);
        return;
      }

      res.writeHead(404).end();
    });

    await new Promise<void>((resolve) =>
      mockDriveServer!.listen(0, "127.0.0.1", () => resolve())
    );
    const drivePort = (mockDriveServer.address() as any).port;

    browser = await chromium.launch({ headless: true });
    const driveCtx = await browser.newContext();
    await driveCtx.route(/^https:\/\/drive\.google\.com\/.*/i, async (route) => {
      const req = route.request();
      const origUrl = new URL(req.url());
      const targetUrl = `http://127.0.0.1:${drivePort}${origUrl.pathname}${origUrl.search}`;
      const rawPost = req.postDataBuffer();
      const resp = await fetch(targetUrl, {
        method: req.method(),
        body:
          req.method() !== "GET" && req.method() !== "HEAD" && rawPost
            ? new Uint8Array(rawPost)
            : undefined,
      });
      const buf = Buffer.from(await resp.arrayBuffer());
      await route.fulfill({
        status: resp.status,
        contentType: resp.headers.get("content-type") || "text/html; charset=utf-8",
        body: buf,
      });
    });
    const drivePage = await driveCtx.newPage();
    BrowserManager.prototype.getPage = async () => drivePage;

    // Upload Buổi 12 via default `zip_bundle` mode
    const driveB12Res = await uploadDrivePost(
      makeLocalRequest("http://127.0.0.1:3000/api/spck/upload-drive", "POST", {
        classId: ptaClassId,
        sessionNumber: 12,
        syncAllUnverifiedSessions: true,
      })
    );
    const driveB12Json = await driveB12Res.json();
    assert.strictEqual(
      driveB12Res.status,
      200,
      `Upload Drive B12 thất bại: ${JSON.stringify(driveB12Json)}`
    );
    assert.strictEqual(driveB12Json.driveResult.successCount, 1);
    const anDriveFolderUrlB12: string = driveB12Json.driveResult.results[0].driveFolderUrl;
    const anDriveFolderId = anDriveFolderUrlB12.split("/folders/")[1];
    assert.ok(anDriveFolderId, `Thiếu folderId trong URL: ${anDriveFolderUrlB12}`);

    const activeB12Children = Array.from(driveItems.values()).filter(
      (i) => i.parentId === anDriveFolderId && !i.trashed
    );
    const activeB12Names = activeB12Children.map((i) => i.name);
    assert.strictEqual(activeB12Names.length, 3, `Drive B12 phải có đúng 3 file (.zip + .pptx + .mp4): ${JSON.stringify(activeB12Names)}`);
    assert.ok(activeB12Names.some((n) => /_SPCK_B12_\d{4}_\d{6}\.zip$/.test(n)));
    assert.ok(activeB12Names.includes("Slide_Thuyet_Trinh_B12.pptx"));
    assert.ok(activeB12Names.includes("Demo_Gameplay_B12.mp4"));

    // Verify `lastPreppedFolderDigest` was persisted
    const anRecordAfterB12 = spckUploadRepo.findOne(ptaClassId, "PTA_AN")!;
    assert.ok(
      anRecordAfterB12.lastPreppedFolderDigest &&
        anRecordAfterB12.lastPreppedFolderDigest.length === 64,
      "Sau khi tải Drive thành công, lastPreppedFolderDigest phải được lưu!"
    );

    // Seed a legacy subfolder inside `anDriveFolderId` to verify Buổi 13 trashes legacy subfolders too
    driveItems.set("LEGACY_SUBFOLDER_B12_ID", {
      id: "LEGACY_SUBFOLDER_B12_ID",
      parentId: anDriveFolderId,
      name: "legacy_src_b12",
      isFolder: true,
      mimeType: "application/vnd.google-apps.folder",
    });

    // Update local files for Buổi 13
    fs.unlinkSync(path.join(anDir, "Slide_Thuyet_Trinh_B12.pptx"));
    fs.unlinkSync(path.join(anDir, "Demo_Gameplay_B12.mp4"));
    fs.writeFileSync(path.join(anDir, "main.py"), "print('PTA15 Gia An B13 V2')\n", "utf-8");
    fs.writeFileSync(path.join(anDir, "Slide_Final_B13.pptx"), "PPTX_B13_NEW", "utf-8");

    // Simulate failed upload on Buổi 13 -> MUST NOT trash ANY old Buổi 12 items!
    blockFileRenderOnUpload = true;
    const driveB13FailRes = await uploadDrivePost(
      makeLocalRequest("http://127.0.0.1:3000/api/spck/upload-drive", "POST", {
        classId: ptaClassId,
        sessionNumber: 13,
      })
    );
    const driveB13FailJson = await driveB13FailRes.json();
    assert.strictEqual(
      driveB13FailJson.driveResult?.failedCount,
      1,
      `Khi tải Drive lỗi phải ghi nhận failedCount=1: ${JSON.stringify(driveB13FailJson)}`
    );
    assert.strictEqual(driveB13FailJson.driveResult?.successCount, 0);
    const preservedOnFail = Array.from(driveItems.values()).filter(
      (i) => i.parentId === anDriveFolderId && !i.trashed
    );
    assert.strictEqual(
      preservedOnFail.length,
      4,
      `Khi tải mới bị lỗi, 100% bài cũ Buổi 12 + thư mục con cũ phải giữ nguyên! Thực tế: ${JSON.stringify(preservedOnFail.map((i) => i.name))}`
    );

    // Restore normal Drive upload -> verify upload-first & clean trash of ALL old B12 files + legacy subfolder!
    blockFileRenderOnUpload = false;
    await drivePage.goto(`https://drive.google.com/drive/folders/${anDriveFolderId}`);
    const driveB13OkRes = await uploadDrivePost(
      makeLocalRequest("http://127.0.0.1:3000/api/spck/upload-drive", "POST", {
        classId: ptaClassId,
        sessionNumber: 13,
        syncActiveSession: true,
      })
    );
    const driveB13OkJson = await driveB13OkRes.json();
    assert.strictEqual(driveB13OkRes.status, 200);
    assert.strictEqual(driveB13OkJson.driveResult.successCount, 1);
    assert.strictEqual(
      driveB13OkJson.driveResult.results[0].driveFolderUrl,
      anDriveFolderUrlB12,
      "Link Google Drive của học sinh ở Buổi 13 phải giữ nguyên 100% URL từ Buổi 12!"
    );

    const activeB13Children = Array.from(driveItems.values()).filter(
      (i) => i.parentId === anDriveFolderId && !i.trashed
    );
    const activeB13Names = activeB13Children.map((i) => i.name).sort();
    assert.strictEqual(
      activeB13Names.length,
      2,
      `Sau khi nộp lại Buổi 13, thư mục Drive chỉ còn đúng 1 file .zip B13 mới + 1 Slide B13 mới (đã dọn sạch .zip cũ, slide cũ, video cũ và subfolder cũ)! Thực tế: ${JSON.stringify(activeB13Names)}`
    );
    assert.ok(activeB13Names.some((n) => /_SPCK_B13_\d{4}_\d{6}\.zip$/.test(n)));
    assert.ok(activeB13Names.includes("Slide_Final_B13.pptx"));
    assert.strictEqual(driveItems.get("LEGACY_SUBFOLDER_B12_ID")?.trashed, true);
    console.log("  -> PASS R355-02.");

    // =========================================================================
    // R355-03: Student Portal Auto-Confirm, Safe .zip Auto-Extract, Security Guards & Backup Restore
    // =========================================================================
    console.log(
      "3. [R355-03] Kiểm tra Cổng Thu Bài tự nhận bài, tự giải nén .zip an toàn, chặn .rar/Zip-Slip/.exe & khôi phục bản trước..."
    );
    const jsbClassId = "VT-JSB18";
    const jsbPortalRoot = path.join(tempSpckRoot, "JSB18_PORTAL");
    fs.mkdirSync(jsbPortalRoot, { recursive: true });

    studentRepo.upsert({
      studentId: "JSB_LINH",
      classId: jsbClassId,
      fullName: "Hoàng Khánh Linh",
      isActive: 1,
    });
    studentRepo.upsert({
      studentId: "JSB_NAM",
      classId: jsbClassId,
      fullName: "Vũ Hải Nam",
      isActive: 1,
    });

    const startPortalRes = await portalPost(
      makeLocalRequest("http://127.0.0.1:3000/api/spck/student-portal", "POST", {
        action: "start",
        classId: jsbClassId,
        folderPath: jsbPortalRoot,
        autoUploadDrive: false,
        sessionNumber: 12,
      })
    );
    const startPortalJson = await startPortalRes.json();
    assert.strictEqual(startPortalRes.status, 200);
    const portalLocalUrl: string = startPortalJson.portalStatus.localUrl;
    assert.ok(portalLocalUrl.startsWith("http://127.0.0.1:"));

    // Check rendered Student Portal HTML contains .rar/.7z notice & overwrite confirm
    const portalHtmlRes = await fetch(portalLocalUrl);
    const portalHtml = await portalHtmlRes.text();
    assert.strictEqual(portalHtmlRes.status, 200);
    assert.ok(portalHtml.includes(".rar") && portalHtml.includes(".7z"));
    assert.ok(portalHtml.includes("hasSubmitted") && portalHtml.includes("window.confirm"));

    // 1) Reject `.rar` upload
    const rarRes = await fetch(`${portalLocalUrl}/upload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        studentId: "JSB_LINH",
        files: [
          {
            relativePath: "BaiLam.rar",
            base64Data: Buffer.from("Rar!\x1a\x07\x00dummy").toString("base64"),
          },
        ],
      }),
    });
    assert.strictEqual(rarRes.status, 400, "Phải từ chối file .rar với HTTP 400!");

    // 2) Reject Zip-Slip (`../escape.html`) inside `.zip`
    const zipSlipBuf = buildRawZipWithExactEntryName(
      "../escape.html",
      Buffer.from("<h1>escaped</h1>", "utf8")
    );
    const zipSlipRes = await fetch(`${portalLocalUrl}/upload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        studentId: "JSB_LINH",
        files: [
          {
            relativePath: "evil_slip.zip",
            base64Data: zipSlipBuf.toString("base64"),
          },
        ],
      }),
    });
    assert.strictEqual(zipSlipRes.status, 400, "Phải chặn Zip-Slip (../escape.html) với HTTP 400!");

    // 3) Reject `.exe` hidden inside `.zip`
    const exeZip = new AdmZip();
    exeZip.addFile("MyWeb/trojan.exe", Buffer.from("MZ_FAKE_EXE", "utf8"));
    const exeZipRes = await fetch(`${portalLocalUrl}/upload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        studentId: "JSB_LINH",
        files: [
          {
            relativePath: "MyWeb.zip",
            base64Data: exeZip.toBuffer().toString("base64"),
          },
        ],
      }),
    });
    assert.strictEqual(exeZipRes.status, 400, "Phải chặn file .exe ẩn bên trong .zip với HTTP 400!");

    // 4) Accept valid single-folder `.zip` -> auto-unwrap, auto-confirm (`isConfirmedByTeacher === 1`), & background screenshot capture
    const validZip = new AdmZip();
    validZip.addFile(
      "ShopHoaB12/index.html",
      Buffer.from(
        "<!doctype html><html><body style='background:#0f172a;color:#38bdf8;padding:32px'><h1>Shop Hoa Tươi Khánh Linh B12</h1></body></html>",
        "utf8"
      )
    );
    validZip.addFile(
      "ShopHoaB12/app.js",
      Buffer.from("console.log('Shop Hoa B12 ready');\n", "utf8")
    );

    const okPortalUploadRes = await fetch(`${portalLocalUrl}/upload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        studentId: "JSB_LINH",
        projectTitle: "Website Shop Hoa Tươi",
        files: [
          {
            relativePath: "ShopHoaB12.zip",
            base64Data: validZip.toBuffer().toString("base64"),
          },
        ],
      }),
    });
    const okPortalUploadJson = await okPortalUploadRes.json();
    assert.strictEqual(
      okPortalUploadRes.status,
      200,
      `Upload .zip hợp lệ qua Cổng thu bài thất bại: ${JSON.stringify(okPortalUploadJson)}`
    );

    const linhRecImmediate = spckUploadRepo.findOne(jsbClassId, "JSB_LINH")!;
    assert.strictEqual(
      linhRecImmediate.isConfirmedByTeacher,
      1,
      "Mặc định requireTeacherConfirmation=false phải tự xác nhận bài nộp ngay lập tức!"
    );
    assert.strictEqual(Number(linhRecImmediate.pendingPortalConfirmation || 0), 0);
    const linhDir = String(linhRecImmediate.localFolderPath || "");
    assert.ok(linhDir.length > 0);
    assert.ok(
      fs.existsSync(path.join(linhDir, "index.html")) &&
        fs.existsSync(path.join(linhDir, "app.js")),
      "File .zip có 1 thư mục gốc 'ShopHoaB12/' phải được tự bóc thẳng ra thư mục học sinh!"
    );

    // Poll briefly (up to 12s) for background Auto-Prep screenshot capture to complete
    let capturedBgShot = false;
    for (let i = 0; i < 30; i++) {
      const latestRec = spckUploadRepo.findOne(jsbClassId, "JSB_LINH");
      if (latestRec?.thumbnailPath && latestRec.thumbnailPath.includes("_spck_app_shots")) {
        capturedBgShot = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    assert.strictEqual(
      capturedBgShot,
      true,
      "Sau khi học sinh nộp qua Cổng thu bài, tiến trình nền phải tự động chụp ảnh giao diện 16:9!"
    );

    // 5) Second submission (`wrong_b13.html`) + `hasPortalBackup` + 1-click `restore_backup`
    const wrongUploadRes = await fetch(`${portalLocalUrl}/upload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        studentId: "JSB_LINH",
        replaceExisting: true,
        files: [
          {
            relativePath: "wrong_b13.html",
            base64Data: Buffer.from(
              "<!doctype html><html><body><h1>Nộp nhầm bài</h1></body></html>",
              "utf8"
            ).toString("base64"),
          },
        ],
      }),
    });
    assert.strictEqual(wrongUploadRes.status, 200);
    assert.ok(fs.existsSync(path.join(linhDir, "wrong_b13.html")));
    assert.ok(!fs.existsSync(path.join(linhDir, "app.js")));

    const listWithBackupRes = await listGet(
      makeLocalRequest(`http://127.0.0.1:3000/api/spck/list?classId=${jsbClassId}&sessionNumber=12`)
    );
    const listWithBackupJson = await listWithBackupRes.json();
    const linhRowInList = listWithBackupJson.records.find(
      (r: any) => r.studentId === "JSB_LINH"
    );
    assert.strictEqual(
      linhRowInList?.hasPortalBackup,
      true,
      "GET /api/spck/list phải trả về hasPortalBackup=true khi có bản sao lưu trước đó!"
    );

    // Wait briefly for any background screenshot pass from second upload to settle before restoring
    await new Promise((r) => setTimeout(r, 1200));

    const restoreRes = await portalPost(
      makeLocalRequest("http://127.0.0.1:3000/api/spck/student-portal", "POST", {
        action: "restore_backup",
        classId: jsbClassId,
        studentId: "JSB_LINH",
        sessionNumber: 12,
      })
    );
    const restoreJson = await restoreRes.json();
    assert.strictEqual(
      restoreRes.status,
      200,
      `Khôi phục bản trước thất bại: ${JSON.stringify(restoreJson)}`
    );
    assert.ok(
      fs.existsSync(path.join(linhDir, "index.html")) &&
        fs.existsSync(path.join(linhDir, "app.js")),
      "Khôi phục bản trước phải trả lại đầy đủ index.html + app.js của bản trước!"
    );
    assert.ok(
      !fs.existsSync(path.join(linhDir, "wrong_b13.html")),
      "File nộp nhầm wrong_b13.html không được còn lẫn ở thư mục gốc sau khi khôi phục!"
    );
    assert.strictEqual(
      restoreJson.restored?.restoredFrom,
      "latest",
      "Lần khôi phục đầu tiên phải lấy từ bản sao lưu gần nhất (latest)!"
    );
    assert.ok(
      fs.existsSync(path.join(linhDir, "_spck_prev_backup", "latest", "index.html")),
      "Bản sao lưu bảo vệ (protected) vẫn phải được giữ lại an toàn cho lần khôi phục kế tiếp!"
    );

    await studentPortalManager.stopPortal();
    console.log("  -> PASS R355-03.");

    // =========================================================================
    // R355-04: Clean Screenshot Re-Capture, Quick Tags 12->13->14, Smart Digest Scan,
    //          Per-Student Isolation & Real LMS Modal Gallery/Attachment Wipe
    // =========================================================================
    console.log(
      "4. [R355-04] Kiểm tra chụp lại ảnh sạch 100%, kế thừa Quick Tags 12->13->14, quét thông minh, cô lập lỗi & xóa sạch ảnh/file cũ trên Modal LMS..."
    );

    // Seed broken folder record for `JSB_NAM` to test per-student isolation in `/api/spck/capture-screenshots`
    const missingNamDir = path.join(jsbPortalRoot, "Missing_Nam_Folder");
    spckUploadRepo.upsert({
      classId: jsbClassId,
      studentId: "JSB_NAM",
      localFolderPath: missingNamDir,
      isConfirmedByTeacher: 1,
      projectTitle: "SPCK Vũ Hải Nam",
      thumbnailPath: "",
      screenshotsJson: "[]",
      attachmentsJson: "[]",
      youtubeUrlsJson: "[]",
      relatedLinksJson: "[]",
      teacherComment: "",
      status: "DRAFT",
    });

    const capB12Res = await capturePost(
      makeLocalRequest("http://127.0.0.1:3000/api/spck/capture-screenshots", "POST", {
        classId: jsbClassId,
        useAiVision: false,
        sessionNumber: 12,
        syncAllUnverifiedSessions: true,
      })
    );
    const capB12Json = await capB12Res.json();
    assert.strictEqual(
      capB12Res.status,
      200,
      `Khi 1 bạn thành công & 1 bạn lỗi, /api/spck/capture-screenshots phải trả HTTP 200 partialFailure! Thực tế: ${JSON.stringify(capB12Json)}`
    );
    assert.strictEqual(capB12Json.partialFailure, true);
    assert.strictEqual(capB12Json.failedItems?.length, 1);
    assert.strictEqual(capB12Json.batchResult?.results?.length, 2);

    const shotsDir = path.join(linhDir, "_spck_app_shots");
    const shotsB12 = fs.readdirSync(shotsDir).filter((f) => f.endsWith(".png"));
    assert.strictEqual(shotsB12.length, 1);
    const oldShotNameB12 = shotsB12[0];

    // Save Quick Tags on Session 12, approve & mark VERIFIED on Session 12
    const linhS12Draft = spckSessionRepo.getOrInitSessionDraft(jsbClassId, "JSB_LINH", 12);
    const savedS12 = spckSessionRepo.saveSessionDraft({
      classId: jsbClassId,
      studentId: "JSB_LINH",
      sessionNumber: 12,
      expectedVersion: linhS12Draft.draftVersion,
      localFolderPath: linhS12Draft.localFolderPath,
      isConfirmedByTeacher: 1,
      projectTitle: "Website Shop Hoa Tươi B12",
      thumbnailPath: linhS12Draft.thumbnailPath,
      screenshotsJson: linhS12Draft.screenshotsJson,
      attachmentsJson: linhS12Draft.attachmentsJson,
      youtubeUrlsJson: "[]",
      relatedLinksJson: "[]",
      quickTagsJson: JSON.stringify(["Tư duy tốt", "Chủ động sáng tạo"]),
      teacherComment: "- Nhận xét riêng của Buổi 12.",
    }).record;
    const appS12 = spckSessionRepo.approveSessionDraft(
      jsbClassId,
      "JSB_LINH",
      12,
      savedS12.draftVersion
    );
    assert.strictEqual(appS12.success, true);
    const sharedLinhB12 = spckUploadRepo.findOne(jsbClassId, "JSB_LINH")!;
    spckSessionRepo.markSessionVerifiedFromUpload(
      jsbClassId,
      "JSB_LINH",
      12,
      {
        ...sharedLinhB12,
        projectTitle: appS12.record.projectTitle,
        teacherComment: appS12.record.teacherComment,
        contentHash: appS12.record.approvedContentHash,
      },
      "2026-11-16T09:00:00",
      "LMS_WORK_LINH_12"
    );

    // Quick Tags Inheritance: Session 12 -> Session 13 -> Session 14
    const linhS13Init = spckSessionRepo.getOrInitSessionDraft(jsbClassId, "JSB_LINH", 13);
    assert.deepStrictEqual(
      JSON.parse(linhS13Init.quickTagsJson),
      ["Tư duy tốt", "Chủ động sáng tạo"],
      "Khởi tạo Buổi 13 phải tự kế thừa Quick Tags từ Buổi 12!"
    );
    assert.strictEqual(
      linhS13Init.teacherComment,
      "",
      "Khởi tạo Buổi 13 không được chép nguyên văn nhận xét cũ của Buổi 12!"
    );

    const savedS13Tags = spckSessionRepo.saveSessionDraft({
      classId: jsbClassId,
      studentId: "JSB_LINH",
      sessionNumber: 13,
      expectedVersion: linhS13Init.draftVersion,
      quickTagsJson: JSON.stringify(["Hoàn thiện xuất sắc"]),
      teacherComment: "- Nhận xét riêng của Buổi 13.",
    }).record;
    assert.ok(savedS13Tags.draftVersion > linhS13Init.draftVersion);

    const linhS14Init = spckSessionRepo.getOrInitSessionDraft(jsbClassId, "JSB_LINH", 14);
    assert.deepStrictEqual(
      JSON.parse(linhS14Init.quickTagsJson),
      ["Hoàn thiện xuất sắc"],
      "Khởi tạo Buổi 14 phải tự kế thừa Quick Tags mới nhất từ Buổi 13!"
    );
    assert.strictEqual(linhS14Init.teacherComment, "");

    // Re-capture screenshots on Session 13 -> old B12 shot in `_spck_app_shots` is wiped ("MISSING"),
    // new cache-busted shot created, AND Session 12 VERIFIED snapshot does NOT trigger false `hasFileDriftAfterVerified`!
    const capB13Res = await capturePost(
      makeLocalRequest("http://127.0.0.1:3000/api/spck/capture-screenshots", "POST", {
        classId: jsbClassId,
        studentIds: ["JSB_LINH"],
        useAiVision: false,
        sessionNumber: 13,
        syncAllUnverifiedSessions: true,
      })
    );
    assert.strictEqual(capB13Res.status, 200);
    const shotsB13 = fs.readdirSync(shotsDir).filter((f) => f.endsWith(".png"));
    assert.strictEqual(
      shotsB13.length,
      1,
      `Thư mục _spck_app_shots phải xóa sạch ảnh cũ và chỉ giữ ảnh lượt mới! Thực tế: ${JSON.stringify(shotsB13)}`
    );
    assert.notStrictEqual(
      shotsB13[0],
      oldShotNameB12,
      "Tên ảnh chụp mới phải có hậu tố chống trùng cache khác hoàn toàn ảnh cũ!"
    );

    const listCheckS12Res = await listGet(
      makeLocalRequest(`http://127.0.0.1:3000/api/spck/list?classId=${jsbClassId}&sessionNumber=12`)
    );
    const listCheckS12Json = await listCheckS12Res.json();
    const linhS12RowAfterB13Cap = listCheckS12Json.records.find(
      (r: any) => r.studentId === "JSB_LINH"
    );
    assert.strictEqual(linhS12RowAfterB13Cap?.status, "VERIFIED");
    assert.strictEqual(
      linhS12RowAfterB13Cap?.sessionHistory?.sessions?.["12"]?.hasFileDriftAfterVerified,
      false,
      "Xoay vòng ảnh trong _spck_app_shots ở Buổi 13 tuyệt đối không được báo động giả VERIFIED_FILE_DRIFT cho Buổi 12!"
    );
    assert.notStrictEqual(
      linhS12RowAfterB13Cap?.sessionHistory?.sessions?.["12"]?.displayState,
      "VERIFIED_FILE_DRIFT"
    );

    // Smart `folderContentChanged` check in `/api/spck/scan`
    const currentDigest = computeStudentFolderContentDigest(linhDir).digest;
    spckUploadRepo.markFolderPrepped(jsbClassId, "JSB_LINH", currentDigest);

    const scanUnchangedRes = await scanPost(
      makeLocalRequest("http://127.0.0.1:3000/api/spck/scan", "POST", {
        classId: jsbClassId,
        sessionNumber: 13,
        folderPath: jsbPortalRoot,
      })
    );
    const scanUnchangedJson = await scanUnchangedRes.json();
    const linhUnchangedScan = (scanUnchangedJson.scanResult?.items || []).find(
      (m: any) => m.match?.suggestedStudentId === "JSB_LINH"
    );
    assert.strictEqual(
      linhUnchangedScan?.folderContentChanged,
      false,
      "Khi học sinh không đổi file sau lần chuẩn bị trước, folderContentChanged phải bằng false!"
    );

    fs.writeFileSync(
      path.join(linhDir, "app.js"),
      "console.log('Shop Hoa B13 updated feature!');\n",
      "utf-8"
    );
    const scanChangedRes = await scanPost(
      makeLocalRequest("http://127.0.0.1:3000/api/spck/scan", "POST", {
        classId: jsbClassId,
        sessionNumber: 13,
        folderPath: jsbPortalRoot,
        syncActiveSession: true,
      })
    );
    const scanChangedJson = await scanChangedRes.json();
    const linhChangedScan = (scanChangedJson.scanResult?.items || []).find(
      (m: any) => m.match?.suggestedStudentId === "JSB_LINH"
    );
    assert.strictEqual(
      linhChangedScan?.folderContentChanged,
      true,
      "Khi học sinh sửa bất kỳ file nào trong thư mục, folderContentChanged phải bằng true!"
    );

    // Per-student isolation in `/api/spck/approve` (`isolatePerStudent: true` vs strict default)
    const namDirValid = path.join(jsbPortalRoot, "Vu Hai Nam");
    fs.mkdirSync(namDirValid, { recursive: true });
    fs.writeFileSync(path.join(namDirValid, "index.html"), "<h1>Nam Web</h1>", "utf-8");
    await scanPost(
      makeLocalRequest("http://127.0.0.1:3000/api/spck/scan", "POST", {
        classId: jsbClassId,
        sessionNumber: 13,
        folderPath: jsbPortalRoot,
        syncActiveSession: true,
      })
    );
    const linhS13Ready = spckSessionRepo.saveSessionDraft({
      classId: jsbClassId,
      studentId: "JSB_LINH",
      sessionNumber: 13,
      isConfirmedByTeacher: 1,
      projectTitle: "Website Shop Hoa Khánh Linh B13",
      teacherComment: "- Bản cập nhật Buổi 13 đầy đủ.",
    }).record;
    const namS13Ready = spckSessionRepo.saveSessionDraft({
      classId: jsbClassId,
      studentId: "JSB_NAM",
      sessionNumber: 13,
      isConfirmedByTeacher: 1,
      projectTitle: "Website Vũ Hải Nam B13",
      teacherComment: "- Nhận xét Nam B13.",
    }).record;

    const conflictReviewedItems = [
      { ...linhS13Ready, isConfirmedByTeacher: 1 },
      { ...namS13Ready, draftVersion: 999999, isConfirmedByTeacher: 1 },
    ];

    // Strict mode (isolatePerStudent omitted) -> HTTP 409 when 1 student has stale version
    const strictApproveRes = await approvePost(
      makeLocalRequest("http://127.0.0.1:3000/api/spck/approve", "POST", {
        classId: jsbClassId,
        sessionNumber: 13,
        studentIds: ["JSB_LINH", "JSB_NAM"],
        reviewedItems: conflictReviewedItems,
      })
    );
    assert.strictEqual(
      strictApproveRes.status,
      409,
      "Chế độ mặc định (không truyền isolatePerStudent) phải giữ nguyên HTTP 409 khi lệch phiên bản!"
    );

    // Isolated mode (`isolatePerStudent: true`) -> approves JSB_LINH, isolates JSB_NAM in `skipped`!
    const isolatedApproveRes = await approvePost(
      makeLocalRequest("http://127.0.0.1:3000/api/spck/approve", "POST", {
        classId: jsbClassId,
        sessionNumber: 13,
        studentIds: ["JSB_LINH", "JSB_NAM"],
        reviewedItems: conflictReviewedItems,
        isolatePerStudent: true,
      })
    );
    const isolatedApproveJson = await isolatedApproveRes.json();
    assert.strictEqual(isolatedApproveRes.status, 200);
    assert.strictEqual(isolatedApproveJson.approvedCount, 1);
    assert.ok(
      (isolatedApproveJson.skipped || []).some(
        (s: any) =>
          (typeof s === "string" ? s : s?.studentId || s?.reason || "").includes(
            "JSB_NAM"
          )
      ),
      `Bạn lệch phiên bản phải nằm trong skipped: ${JSON.stringify(isolatedApproveJson.skipped)}`
    );

    // Real LMS Modal Gallery Screenshot & Attachment Tile Clean Wipe-and-Replace (`reusedExistingItem01: true`)
    const approvedLinhS13 = spckSessionRepo.findOne(jsbClassId, "JSB_LINH", 13)!;
    assert.strictEqual(approvedLinhS13.draftStatus, "APPROVED");
    const freshShotPath = path.join(shotsDir, shotsB13[0]);
    const freshHtmlAttPath = path.join(linhDir, "index.html");
    const keepYt = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const freshLiveUrl = "https://mindx-local.github.io/jsb18/khanh-linh/";

    let lastGraphqlVars: any = null;
    mockLmsServer = http.createServer((req, res) => {
      const u = new URL(req.url || "/", "http://127.0.0.1");
      if (u.pathname === "/mock-lms-v355") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html><html><body>
          <div class="MuiDrawer-paper MuiDrawer-paperAnchorRight" aria-labelledby="class-detail">
            <h2>${jsbClassId}</h2>
            <div role="tablist"><button role="tab" aria-selected="true">Nhận xét</button></div>
            <div id="class-comments-slot-carousel-12" class="active"><div class="info-container">Buổi 13</div></div>
            <div class="comment-list-table">
              <table><tbody>
                <tr>
                  <td><span class="name-display">Hoàng Khánh Linh</span></td>
                  <td><button type="button" id="btn-open-spck">Sản phẩm của học sinh</button></td>
                </tr>
              </tbody></table>
            </div>
          </div>

          <div class="MuiDialog-root" id="spck-dialog-root" style="display:none;">
            <div class="MuiDialog-paper" role="dialog" style="padding:16px;">
              <h2 class="MuiTypography-h6">Hoàng Khánh Linh</h2>
              <button type="button" id="btn-expand-detail">Xem chi tiết</button>
              <input id="title" name="title" value="Website Shop Hoa Cũ B12" />

              <div id="thumb-box">
                <img id="modal-thumb" src="/resources.mindx.edu.vn/old-thumb-b12.png" width="160" height="90" />
                <button type="button" id="btn-change-thumb">Thay ảnh</button>
                <input type="file" id="thumb-input" accept="image/png, image/jpeg" style="display:none;" />
              </div>

              <div id="gallery-list">
                <div class="shot-tile">
                  <img src="/resources.mindx.edu.vn/old-shot-b12-1.png" width="120" height="68" />
                  <button type="button" class="btn-del-shot" aria-label="delete">✕</button>
                </div>
                <div class="shot-tile">
                  <img src="/resources.mindx.edu.vn/old-shot-b12-2.png" width="120" height="68" />
                  <button type="button" class="btn-del-shot" aria-label="delete">✕</button>
                </div>
              </div>
              <input type="file" id="gallery-input" accept="image/jpeg, image/png, image/jpg, image/tiff" multiple style="display:none;" />

              <div id="att-list">
                <div class="att-tile" data-url="/resources.mindx.edu.vn/old_b12_package.zip">
                  <span class="MuiTypography-caption">old_b12_package.zip</span>
                  <button type="button" class="btn-del-att" aria-label="delete">✕</button>
                </div>
                <div class="att-tile" data-url="/resources.mindx.edu.vn/old_notes_b12.pdf">
                  <span class="MuiTypography-caption">old_notes_b12.pdf</span>
                  <button type="button" class="btn-del-att" aria-label="delete">✕</button>
                </div>
              </div>
              <input type="file" id="att-input" accept=".py,.zip,.pdf,.pptx,.docx" multiple style="display:none;" />

              <div id="yt-list">
                <div class="yt-row">
                  <a href="${keepYt}">Video Demo</a>
                  <button type="button" class="btn-del-yt">✕</button>
                </div>
              </div>
              <div class="yt-add-wrap">
                <div class="MuiFormControl-root"><input id="inputYoutube" placeholder="Nhập đường dẫn YouTube" /></div>
                <button type="button" id="btn-add-yt">+ Thêm</button>
              </div>

              <div class="rel-add-wrap">
                <input id="inputRelativeUrlName" placeholder="Đặt tên đường dẫn" />
                <input id="inputRelativeUrl" placeholder="Nhập đường dẫn" />
                <button type="button" id="btn-add-rel">+ Thêm</button>
              </div>
              <div id="rel-list">
                <div class="rel-row">
                  <a href="https://stale-b12.example.com">Link cũ B12</a>
                  <button type="button" class="btn-del-rel">✕</button>
                </div>
              </div>

              <textarea id="comment" name="comment">Nhận xét cũ B12</textarea>
              <button type="submit" id="btn-save">Save</button>
            </div>
          </div>

          <script>
            document.getElementById('btn-open-spck').onclick = () => {
              document.getElementById('spck-dialog-root').style.display = 'block';
            };
            document.addEventListener('keydown', (e) => {
              if (e.key === 'Escape') {
                document.getElementById('spck-dialog-root').style.display = 'none';
              }
            });
            document.querySelectorAll('.btn-del-shot, .btn-del-att, .btn-del-rel, .btn-del-yt').forEach((btn) => {
              btn.onclick = () => btn.parentElement.remove();
            });
            document.getElementById('thumb-input').onchange = async (e) => {
              const f = e.target.files[0];
              const fd = new FormData();
              fd.append('file', f);
              const r = await fetch('/resources.mindx.edu.vn/upload?name=' + encodeURIComponent(f.name), { method: 'POST', body: fd });
              const d = await r.json();
              document.getElementById('modal-thumb').src = d.url;
            };
            document.getElementById('gallery-input').onchange = async (e) => {
              for (const f of Array.from(e.target.files || [])) {
                const fd = new FormData();
                fd.append('file', f);
                const r = await fetch('/resources.mindx.edu.vn/upload?name=' + encodeURIComponent(f.name), { method: 'POST', body: fd });
                const d = await r.json();
                const tile = document.createElement('div');
                tile.className = 'shot-tile';
                tile.innerHTML = '<img src="' + d.url + '" width="120" height="68" /><button type="button" class="btn-del-shot">✕</button>';
                tile.querySelector('.btn-del-shot').onclick = () => tile.remove();
                document.getElementById('gallery-list').appendChild(tile);
              }
            };
            document.getElementById('att-input').onchange = async (e) => {
              for (const f of Array.from(e.target.files || [])) {
                const fd = new FormData();
                fd.append('file', f);
                const r = await fetch('/resources.mindx.edu.vn/upload?name=' + encodeURIComponent(f.name), { method: 'POST', body: fd });
                const d = await r.json();
                const tile = document.createElement('div');
                tile.className = 'att-tile';
                tile.setAttribute('data-url', d.url);
                tile.innerHTML = '<span class="MuiTypography-caption">' + f.name + '</span><button type="button" class="btn-del-att">✕</button>';
                tile.querySelector('.btn-del-att').onclick = () => tile.remove();
                document.getElementById('att-list').appendChild(tile);
              }
            };
            document.getElementById('btn-add-rel').onclick = () => {
              const name = document.getElementById('inputRelativeUrlName').value;
              const url = document.getElementById('inputRelativeUrl').value;
              const row = document.createElement('div');
              row.className = 'rel-row';
              row.innerHTML = '<a href="' + url + '">' + name + '</a><button type="button" class="btn-del-rel">✕</button>';
              row.querySelector('.btn-del-rel').onclick = () => row.remove();
              document.getElementById('rel-list').appendChild(row);
            };
            document.getElementById('btn-save').onclick = async () => {
              const title = document.getElementById('title').value;
              const comment = document.getElementById('comment').value;
              const thumbUrl = document.getElementById('modal-thumb').getAttribute('src');
              const screenshots = Array.from(document.querySelectorAll('#gallery-list img')).map((img) => ({
                url: img.getAttribute('src'),
              }));
              const attachments = Array.from(document.querySelectorAll('#att-list .att-tile')).map((el) => ({
                name: el.querySelector('span.MuiTypography-caption').textContent,
                url: el.getAttribute('data-url'),
              }));
              const relativeUrls = Array.from(document.querySelectorAll('#rel-list a')).map((a) => ({
                name: a.textContent,
                url: a.getAttribute('href'),
              }));
              await fetch('/graphql', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  operationName: 'UpdateStudentWork',
                  variables: { title, comment, thumbUrl, screenshots, attachments, relativeUrls },
                }),
              });
            };
          </script>
        </body></html>`);
        return;
      }

      if (u.pathname.startsWith("/resources.mindx.edu.vn/")) {
        if (req.method === "POST") {
          const chunks: Buffer[] = [];
          req.on("data", (c) => chunks.push(c));
          req.on("end", () => {
            const name = u.searchParams.get("name") || `asset_${Date.now()}.bin`;
            const hostHdr = req.headers.host || "127.0.0.1";
            res.writeHead(200, { "content-type": "application/json" });
            res.end(
              JSON.stringify({
                url: `http://${hostHdr}/resources.mindx.edu.vn/uploaded_${encodeURIComponent(name)}`,
              })
            );
          });
          return;
        }
        res.writeHead(200, { "content-type": "image/png" });
        res.end(MINIMAL_PNG_BUF);
        return;
      }

      if (req.method === "POST" && u.pathname === "/graphql") {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          const parsed = JSON.parse(raw);
          const vars = parsed.variables || {};
          lastGraphqlVars = vars;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              data: {
                studentWorks: {
                  update: {
                    id: "LMS_WORK_LINH_13",
                    latestData: {
                      title: vars.title,
                      comment: vars.comment,
                      thumbnail: {
                        url: vars.thumbUrl,
                      },
                      screenshots: vars.screenshots,
                      attachments: vars.attachments,
                      relativeUrls: vars.relativeUrls,
                    },
                  },
                },
              },
            })
          );
        });
        return;
      }

      res.writeHead(404).end();
    });

    await new Promise<void>((resolve) =>
      mockLmsServer!.listen(0, "127.0.0.1", () => resolve())
    );
    const lmsPort = (mockLmsServer.address() as any).port;

    const lmsCtx = await browser.newContext();

    const lmsPage = await lmsCtx.newPage();
    await lmsPage.goto(`http://127.0.0.1:${lmsPort}/mock-lms-v355`, {
      waitUntil: "domcontentloaded",
    });

    const baseLinhRec = spckUploadRepo.findOne(jsbClassId, "JSB_LINH")!;
    const modalRes = await (SpckUploader as any).uploadSingleStudentViaRealLmsModal({
      page: lmsPage,
      interceptor: { dismissForbiddenToast: async () => {} },
      normalizedClassId: jsbClassId,
      targetSessionNumber: 13,
      record: {
        ...baseLinhRec,
        projectTitle: approvedLinhS13.projectTitle,
        thumbnailPath: freshShotPath,
        teacherComment: approvedLinhS13.teacherComment,
        contentHash: approvedLinhS13.approvedContentHash,
      },
      fullName: "Hoàng Khánh Linh",
      studentsInClass: [
        { studentId: "JSB_LINH", fullName: "Hoàng Khánh Linh" },
        { studentId: "JSB_NAM", fullName: "Vũ Hải Nam" },
      ],
      expectedHash: approvedLinhS13.approvedContentHash,
      screenshots: [freshShotPath],
      attachments: [freshHtmlAttPath],
      youtubeUrls: [keepYt],
      relatedLinks: [{ name: "Link Web Chạy Thử (Hoàng Khánh Linh)", url: freshLiveUrl }],
    });

    assert.strictEqual(modalRes.reusedExistingItem01, true);
    assert.strictEqual(modalRes.screenshotsUploadedCount, 1);
    assert.strictEqual(modalRes.attachmentsUploadedCount, 1);

    const domGallerySrcs = await lmsPage.evaluate(() =>
      Array.from(document.querySelectorAll("#gallery-list img")).map((img) =>
        img.getAttribute("src") || ""
      )
    );
    assert.strictEqual(
      domGallerySrcs.length,
      1,
      `Modal LMS phải xóa sạch 2 ảnh cũ B12 và chỉ còn đúng 1 ảnh mới B13! Thực tế: ${JSON.stringify(domGallerySrcs)}`
    );
    assert.ok(!domGallerySrcs[0].includes("old-shot-b12"));

    const domAttCaptions = await lmsPage.evaluate(() =>
      Array.from(document.querySelectorAll("#att-list span.MuiTypography-caption")).map((el) =>
        (el.textContent || "").trim()
      )
    );
    assert.strictEqual(
      domAttCaptions.length,
      1,
      `Modal LMS phải xóa sạch 2 file đính kèm cũ B12 và chỉ còn đúng 1 gói .zip mới B13! Thực tế: ${JSON.stringify(domAttCaptions)}`
    );
    assert.match(domAttCaptions[0], /^spck_.*\.zip$/i);
    assert.strictEqual(lastGraphqlVars?.screenshots?.length, 1);
    assert.strictEqual(lastGraphqlVars?.attachments?.length, 1);
    assert.deepStrictEqual(
      (lastGraphqlVars?.relativeUrls || []).map((r: any) => r.url),
      [freshLiveUrl]
    );
    console.log("  -> PASS R355-04.");

    // =========================================================================
    // R355-05: Adversarial Safety & Data-Integrity Guards (F01-F10 Regression)
    // =========================================================================
    console.log(
      "5. [R355-05] Kiểm tra bộ chốt chặn an toàn (Zip-bomb/Symlink/0-byte, chống mất bài khi SQLITE_FULL/BUSY, giữ ảnh APPROVED B12, xung đột 409 & quét sâu 9+ cấp)..."
    );
    const { jobLogRepo, verifySpckSessionIntegrity } = await import(
      "../src/lib/db/sqlite"
    );
    const { POST: saveDraftPost } = await import(
      "../src/app/api/spck/save-draft/route"
    );

    const startPortalR5Res = await portalPost(
      makeLocalRequest("http://127.0.0.1:3000/api/spck/student-portal", "POST", {
        action: "start",
        classId: jsbClassId,
        folderPath: jsbPortalRoot,
        autoUploadDrive: false,
        sessionNumber: 12,
      })
    );
    const startPortalR5Json = await startPortalR5Res.json();
    assert.strictEqual(startPortalR5Res.status, 200);
    const r5PortalUrl: string = startPortalR5Json.portalStatus.localUrl;

    // 5a) Zip-bomb (>130 MiB cumulative), Unix symlink, .bat/.ps1, mixed 0-byte vs valid __init__.py
    const bombZip = new AdmZip();
    for (let bIdx = 1; bIdx <= 3; bIdx++) {
      bombZip.addFile(`Project/chunk_${bIdx}.bin`, Buffer.alloc(50 * 1024 * 1024, 0x41));
    }
    const bombUploadRes = await fetch(`${r5PortalUrl}/upload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        studentId: "JSB_NAM",
        files: [{ relativePath: "bomb.zip", base64Data: bombZip.toBuffer().toString("base64") }],
      }),
    });
    assert.strictEqual(bombUploadRes.status, 400, "Phải chặn zip-bomb vượt 130MB trước khi giải nén!");

    const symZip = new AdmZip();
    symZip.addFile("Project/index.html", Buffer.from("<h1>ok</h1>"));
    symZip.addFile("Project/link.txt", Buffer.from("../../secret.txt"));
    const symEntry = symZip.getEntry("Project/link.txt")!;
    symEntry.header.attr = (0o120777 << 16) >>> 0;
    symEntry.header.made = 0x0314;
    const symUploadRes = await fetch(`${r5PortalUrl}/upload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        studentId: "JSB_NAM",
        files: [{ relativePath: "symlink.zip", base64Data: symZip.toBuffer().toString("base64") }],
      }),
    });
    assert.strictEqual(symUploadRes.status, 400, "Phải chặn Unix symlink bên trong file .zip!");

    const zeroBadZip = new AdmZip();
    zeroBadZip.addFile("Project/empty.py", Buffer.alloc(0));
    zeroBadZip.addFile("Project/main.py", Buffer.from("print('ok')"));
    const zeroBadRes = await fetch(`${r5PortalUrl}/upload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        studentId: "JSB_NAM",
        files: [{ relativePath: "zero_bad.zip", base64Data: zeroBadZip.toBuffer().toString("base64") }],
      }),
    });
    assert.strictEqual(zeroBadRes.status, 400, "Phải chặn file code rỗng 0-byte (empty.py) bên trong .zip!");

    const validPkgZip = new AdmZip();
    validPkgZip.addFile("Project/pkg/__init__.py", Buffer.alloc(0));
    validPkgZip.addFile("Project/index.html", Buffer.from("<h1>NamPkgV1</h1>"));
    const validPkgRes = await fetch(`${r5PortalUrl}/upload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        studentId: "JSB_NAM",
        files: [{ relativePath: "valid_pkg.zip", base64Data: validPkgZip.toBuffer().toString("base64") }],
      }),
    });
    assert.strictEqual(validPkgRes.status, 200, "Phải cho phép __init__.py 0-byte hợp lệ trong gói Python!");

    // 5b) Upload V2 for JSB_NAM to create backup, then verify restore survives jobLogRepo.add SQLITE_FULL
    const namV2Zip = new AdmZip();
    namV2Zip.addFile("Project/index.html", Buffer.from("<h1>NamPkgV2</h1>"));
    const namV2Res = await fetch(`${r5PortalUrl}/upload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        studentId: "JSB_NAM",
        files: [{ relativePath: "v2.zip", base64Data: namV2Zip.toBuffer().toString("base64") }],
      }),
    });
    assert.strictEqual(namV2Res.status, 200);
    await studentPortalManager.stopPortal().catch(() => {});
    const { SequentialTaskQueue: R5Queue } = await import("../src/lib/queue/task-queue");
    const settleDeadline = Date.now() + 15000;
    while (Date.now() < settleDeadline) {
      const qSt = R5Queue.getInstance().getStatus();
      if (!qSt.currentTask && qSt.pendingCount === 0) break;
      await new Promise((r) => setTimeout(r, 150));
    }

    const origLogAdd = jobLogRepo.add;
    jobLogRepo.add = ((entry: any) => {
      if (String(entry?.jobId || "").startsWith("RESTORE_PORTAL_BACKUP_")) {
        throw new Error("SQLITE_FULL simulated log error");
      }
      return origLogAdd.call(jobLogRepo, entry);
    }) as any;
    try {
      const restoreNamRes = await studentPortalManager.restoreStudentPreviousBackup(
        jsbClassId,
        "JSB_NAM",
        12
      );
      assert.ok(fs.existsSync(path.join(restoreNamRes.folderPath, "index.html")));
      assert.match(
        fs.readFileSync(path.join(restoreNamRes.folderPath, "index.html"), "utf8"),
        /NamPkgV1/
      );
    } finally {
      jobLogRepo.add = origLogAdd;
    }

    // 5c) Preserve APPROVED B12 screenshots when capturing B13 + rollback on SQLITE_BUSY
    const namCapB12 = await capturePost(
      makeLocalRequest("http://127.0.0.1:3000/api/spck/capture-screenshots", "POST", {
        classId: jsbClassId,
        studentIds: ["JSB_NAM"],
        sessionNumber: 12,
        useAiVision: false,
      })
    );
    assert.strictEqual(namCapB12.status, 200);
    const namRecB12 = spckUploadRepo.findOne(jsbClassId, "JSB_NAM")!;
    const namFolderB12 = String(namRecB12.localFolderPath || "");
    const namApprovedShotB12 = String(namRecB12.thumbnailPath || "");
    assert.ok(namApprovedShotB12.includes("_spck_app_shots") && fs.existsSync(namApprovedShotB12));

    const namDraft12 = spckSessionRepo.saveSessionDraft({
      classId: jsbClassId,
      studentId: "JSB_NAM",
      sessionNumber: 12,
      teacherComment: "Nhận xét B12 đã duyệt chờ nộp",
      thumbnailPath: namApprovedShotB12,
      screenshotsJson: namRecB12.screenshotsJson,
      attachmentsJson: "[]",
      isConfirmedByTeacher: 1,
    }).record;
    const namApprove12 = spckSessionRepo.approveSessionDraft(
      jsbClassId,
      "JSB_NAM",
      12,
      namDraft12.draftVersion
    );
    assert.strictEqual(namApprove12.success, true);

    // Edit HTML for B13 and capture screenshots for B13 -> B12 APPROVED file & hash must remain 100% intact!
    spckSessionRepo.getOrInitSessionDraft(jsbClassId, "JSB_NAM", 13);
    fs.writeFileSync(
      path.join(namFolderB12, "index.html"),
      "<html><body style='background:#064e3b;color:#fff'><h1>Nam B13 Fresh</h1></body></html>",
      "utf8"
    );
    const namCapB13 = await capturePost(
      makeLocalRequest("http://127.0.0.1:3000/api/spck/capture-screenshots", "POST", {
        classId: jsbClassId,
        studentIds: ["JSB_NAM"],
        sessionNumber: 13,
        useAiVision: false,
      })
    );
    assert.strictEqual(namCapB13.status, 200);
    const afterNamS12 = spckSessionRepo.findOne(jsbClassId, "JSB_NAM", 12)!;
    assert.strictEqual(fs.existsSync(namApprovedShotB12), true);
    assert.strictEqual(
      verifySpckSessionIntegrity(afterNamS12, 12),
      true,
      "Chụp ảnh mới cho Buổi 13 không được làm hỏng chữ ký SHA-256 của Buổi 12 đang ở trạng thái APPROVED!"
    );

    // Simulate SQLITE_BUSY during updateSharedResources -> must return HTTP 400 and restore previous screenshot on disk
    const namShotBeforeBusy = String(
      spckUploadRepo.findOne(jsbClassId, "JSB_NAM")!.thumbnailPath || ""
    );
    const origUpdateShared = spckUploadRepo.updateSharedResources;
    spckUploadRepo.updateSharedResources = (() => {
      throw new Error("SQLITE_BUSY simulated lock");
    }) as any;
    try {
      const busyCapRes = await capturePost(
        makeLocalRequest("http://127.0.0.1:3000/api/spck/capture-screenshots", "POST", {
          classId: jsbClassId,
          studentIds: ["JSB_NAM"],
          sessionNumber: 13,
          useAiVision: false,
        })
      );
      const busyCapJson = await busyCapRes.json();
      assert.strictEqual(busyCapRes.status, 400);
      assert.strictEqual(busyCapJson.success, false);
      assert.strictEqual(fs.existsSync(namShotBeforeBusy), true);
    } finally {
      spckUploadRepo.updateSharedResources = origUpdateShared;
    }

    // 5d) save-draft 409 returns currentSessionDraft for conflict inspection
    const curNam13 = spckSessionRepo.findOne(jsbClassId, "JSB_NAM", 13)!;
    spckSessionRepo.saveSessionDraft({
      classId: jsbClassId,
      studentId: "JSB_NAM",
      sessionNumber: 13,
      expectedVersion: curNam13.draftVersion,
      teacherComment: "Nhận xét mới hơn ở tab khác",
    });
    const staleSaveRes = await saveDraftPost(
      makeLocalRequest("http://127.0.0.1:3000/api/spck/save-draft", "POST", {
        classId: jsbClassId,
        studentId: "JSB_NAM",
        sessionNumber: 13,
        expectedVersion: curNam13.draftVersion,
        folderPath: namRecB12.localFolderPath,
        projectTitle: curNam13.projectTitle,
        teacherComment: "Nhận xét cũ bị lệch phiên bản",
      })
    );
    const staleSaveJson = await staleSaveRes.json();
    assert.strictEqual(staleSaveRes.status, 409);
    assert.strictEqual(
      staleSaveJson.currentSessionDraft?.teacherComment,
      "Nhận xét mới hơn ở tab khác"
    );

    // 5e) Deep nested file edit (depth=10) & last-file deletion both change computeStudentFolderContentDigest
    const deepSandbox = path.join(tempSpckRoot, "DEEP_DIGEST_CHECK");
    const deepLeafDir = path.join(deepSandbox, "d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9", "d10");
    fs.mkdirSync(deepLeafDir, { recursive: true });
    const deepFile = path.join(deepLeafDir, "logic.js");
    fs.writeFileSync(deepFile, "console.log('v1');", "utf8");
    const dInfo1 = computeStudentFolderContentDigest(deepSandbox);
    fs.writeFileSync(deepFile, "console.log('v2');", "utf8");
    const dInfo2 = computeStudentFolderContentDigest(deepSandbox);
    assert.notStrictEqual(dInfo1.digest, dInfo2.digest, "Sửa file ở độ sâu 10 thư mục phải đổi digest!");
    fs.unlinkSync(deepFile);
    const dInfoEmpty = computeStudentFolderContentDigest(deepSandbox);
    assert.ok(dInfoEmpty.digest.length === 64 && dInfoEmpty.filesCount === 0);
    assert.notStrictEqual(dInfoEmpty.digest, dInfo2.digest, "Xóa file cuối cùng phải đổi sang empty-folder digest!");

    // 5f) [R2-04] Corrupted CRC32 `.zip` rejected by bounded inflateRawSync while preserving existing student files
    await studentPortalManager.startPortal({
      classId: jsbClassId,
      folderPath: jsbPortalRoot,
      autoUploadDrive: false,
      requireTeacherConfirmation: true,
      sessionNumber: 13,
    });
    const namHtmlBeforeBadCrc = fs.readFileSync(path.join(namFolderB12, "index.html"), "utf8");
    const badCrcZip = new AdmZip();
    badCrcZip.addFile("index.html", Buffer.from("<h1>CORRUPTED CRC</h1>\n", "utf8"));
    const badCrcBuf = badCrcZip.toBuffer();
    for (let i = 0; i < badCrcBuf.length - 30; i++) {
      const sig = badCrcBuf.readUInt32LE(i);
      if (sig === 0x04034b50) {
        badCrcBuf.writeUInt32LE((badCrcBuf.readUInt32LE(i + 14) ^ 0xffffffff) >>> 0, i + 14);
      }
      if (sig === 0x02014b50) {
        badCrcBuf.writeUInt32LE((badCrcBuf.readUInt32LE(i + 16) ^ 0xffffffff) >>> 0, i + 16);
      }
    }
    const badCrcRes = await studentPortalManager.processStudentSubmission({
      studentId: "JSB_NAM",
      files: [{ relativePath: "corrupted.zip", base64Data: badCrcBuf.toString("base64") }],
    });
    assert.strictEqual(badCrcRes.success, false, "Gói .zip lỗi CRC32 bắt buộc phải bị từ chối!");
    assert.match(String(badCrcRes.error || ""), /CRC32|lỗi/i);
    assert.strictEqual(
      fs.readFileSync(path.join(namFolderB12, "index.html"), "utf8"),
      namHtmlBeforeBadCrc,
      "Từ chối gói .zip lỗi CRC32 phải giữ nguyên 100% bài hiện tại trên ổ đĩa!"
    );

    // 5g) [R2-01] Two consecutive Portal background Auto-Prep runs on Session 13 preserve APPROVED Session 12 status, hash & screenshot
    const namS12BeforePortalBg = spckSessionRepo.findOne(jsbClassId, "JSB_NAM", 12)!;
    assert.strictEqual(namS12BeforePortalBg.draftStatus, "APPROVED");
    (studentPortalManager as any).activeSessionNumber = 13;
    await (studentPortalManager as any).uploadSingleStudentToDriveInBackground(
      jsbClassId,
      "JSB_NAM",
      "",
      { runFullAutoPrep: true }
    );
    await (studentPortalManager as any).uploadSingleStudentToDriveInBackground(
      jsbClassId,
      "JSB_NAM",
      "",
      { runFullAutoPrep: true }
    );
    const namS12AfterPortalBg = spckSessionRepo.findOne(jsbClassId, "JSB_NAM", 12)!;
    assert.strictEqual(namS12AfterPortalBg.draftStatus, "APPROVED");
    assert.strictEqual(
      namS12AfterPortalBg.approvedContentHash,
      namS12BeforePortalBg.approvedContentHash
    );
    assert.strictEqual(fs.existsSync(namApprovedShotB12), true);
    assert.strictEqual(verifySpckSessionIntegrity(namS12AfterPortalBg, 12), true);

    // 5h) [R2-03] spckUploadRepo.markFolderPrepped(..., "") clears stale digest
    spckUploadRepo.markFolderPrepped(jsbClassId, "JSB_NAM", "a".repeat(64));
    assert.strictEqual(
      spckUploadRepo.findOne(jsbClassId, "JSB_NAM")?.lastPreppedFolderDigest,
      "a".repeat(64)
    );
    spckUploadRepo.markFolderPrepped(jsbClassId, "JSB_NAM", "");
    assert.strictEqual(
      spckUploadRepo.findOne(jsbClassId, "JSB_NAM")?.lastPreppedFolderDigest,
      ""
    );

    // 5i) [R3-01] Copy error (`EACCES`) when preserving `_spck_app_shots` of an `APPROVED` or `SAVING`
    //     session MUST fail closed before swapping `safeStudentFolder` in both `processStudentSubmission`
    //     and `restoreStudentPreviousBackup`, preserving 100% of screenshot bytes, session integrity, and student code.
    const { captureClassAppScreenshotsAndSelectThumbnails } = await import(
      "../src/lib/local-files/spck-app-screenshotter"
    );
    for (const frozenStatus of ["APPROVED", "SAVING"] as const) {
      const r3Cid = `VT-JSB-R3_${frozenStatus}`;
      const r3Root = path.join(tempSpckRoot, r3Cid);
      const r3Folder = path.join(r3Root, "Student R3");
      fs.mkdirSync(r3Folder, { recursive: true });
      fs.writeFileSync(path.join(r3Folder, "main.py"), "print('CURRENT_R3')\n", "utf-8");
      fs.writeFileSync(
        path.join(r3Folder, "index.html"),
        "<!doctype html><html><body><h1>FROZEN R3</h1></body></html>",
        "utf-8"
      );
      for (const n of [12, 13, 14]) {
        getDb()
          .prepare(
            "INSERT INTO classes_sessions(sessionId, classId, className, sessionNumber, date) VALUES(?, ?, ?, ?, ?)"
          )
          .run(`${r3Cid}_${n}`, r3Cid, r3Cid, n, "2026-11-16");
      }
      studentRepo.upsert({
        classId: r3Cid,
        studentId: "S_R3",
        fullName: "Student R3",
        isActive: 1,
      });
      spckUploadRepo.upsert({
        classId: r3Cid,
        studentId: "S_R3",
        localFolderPath: r3Folder,
        isConfirmedByTeacher: 1,
        projectTitle: "Frozen R3 Project",
        thumbnailPath: path.join(tempConfigDir, "default-spck-thumbnail.png"),
        screenshotsJson: "[]",
        attachmentsJson: "[]",
        youtubeUrlsJson: "[]",
        relatedLinksJson: "[]",
        teacherComment: "Initial",
        status: "DRAFT",
      });
      const r3Cap = await captureClassAppScreenshotsAndSelectThumbnails({
        classId: r3Cid,
        studentIds: ["S_R3"],
        sessionNumber: 12,
        useAiVision: false,
      });
      assert.strictEqual(r3Cap.results[0].capturedCount, 1);
      const protectedShotPath = r3Cap.results[0].thumbnailPath;
      const protectedShotDigest = computeSafeFileByteDigest(protectedShotPath);
      const saved12 = spckSessionRepo.saveSessionDraft({
        classId: r3Cid,
        studentId: "S_R3",
        sessionNumber: 12,
        teacherComment: "APPROVED R3 COMMENT",
        teacherNote: "PRIVATE R3 NOTE",
        quickTagsJson: '["FOCUSED"]',
        thumbnailPath: protectedShotPath,
        isConfirmedByTeacher: 1,
      }).record;
      assert.strictEqual(
        spckSessionRepo.approveSessionDraft(r3Cid, "S_R3", 12, saved12.draftVersion).success,
        true
      );
      if (frozenStatus === "SAVING") {
        getDb()
          .prepare(
            "UPDATE spck_session_submissions SET draftStatus = 'SAVING' WHERE classId = ? AND studentId = 'S_R3' AND sessionNumber = 12"
          )
          .run(r3Cid);
      }
      const frozenBefore = spckSessionRepo.findOne(r3Cid, "S_R3", 12);

      await studentPortalManager.stopPortal().catch(() => {});
      await studentPortalManager.startPortal({
        classId: r3Cid,
        folderPath: r3Root,
        autoUploadDrive: false,
        requireTeacherConfirmation: true,
        sessionNumber: 13,
      });

      for (const action of ["SUBMIT", "RESTORE"] as const) {
        if (action === "RESTORE") {
          const bkDir = path.join(r3Folder, "_spck_prev_backup", "latest");
          fs.mkdirSync(bkDir, { recursive: true });
          fs.writeFileSync(path.join(bkDir, "main.py"), "print('BACKUP_R3')\n", "utf-8");
        }
        const origCopyFileSync = fs.copyFileSync;
        let injectedCount = 0;
        (fs as unknown as { copyFileSync: typeof fs.copyFileSync }).copyFileSync = ((
          src: fs.PathLike,
          dest: fs.PathLike,
          mode?: number
        ) => {
          if (
            path.resolve(String(src)) === path.resolve(protectedShotPath) &&
            String(dest).includes("_spck_app_shots")
          ) {
            injectedCount += 1;
            throw Object.assign(new Error("EACCES injected protected-image copy"), {
              code: "EACCES",
            });
          }
          return origCopyFileSync(src, dest, mode);
        }) as typeof fs.copyFileSync;

        try {
          if (action === "SUBMIT") {
            const subFail = await studentPortalManager.processStudentSubmission({
              studentId: "S_R3",
              files: [
                {
                  relativePath: "main.py",
                  base64Data: Buffer.from("print('NEW_R3')\n", "utf-8").toString("base64"),
                },
              ],
            });
            assert.strictEqual(
              subFail.success,
              false,
              `R3-01 SUBMIT (${frozenStatus}) must return success=false on protected screenshot copy error`
            );
            assert.match(String(subFail.error || ""), /EACCES/i);
          } else {
            await assert.rejects(
              () => studentPortalManager.restoreStudentPreviousBackup(r3Cid, "S_R3", 13),
              /EACCES/i,
              `R3-01 RESTORE (${frozenStatus}) must reject on protected screenshot copy error`
            );
          }
        } finally {
          (fs as unknown as { copyFileSync: typeof fs.copyFileSync }).copyFileSync =
            origCopyFileSync;
        }

        assert.ok(injectedCount > 0, `Fault must be injected for ${action} (${frozenStatus})`);
        assert.ok(
          fs.existsSync(protectedShotPath),
          `Protected screenshot must still exist after ${action} (${frozenStatus})`
        );
        assert.strictEqual(
          computeSafeFileByteDigest(protectedShotPath),
          protectedShotDigest,
          `Protected screenshot bytes must be 100% intact after ${action} (${frozenStatus})`
        );
        assert.deepStrictEqual(spckSessionRepo.findOne(r3Cid, "S_R3", 12), frozenBefore);
        assert.strictEqual(
          verifySpckSessionIntegrity(spckSessionRepo.findOne(r3Cid, "S_R3", 12), 12),
          true
        );
        assert.strictEqual(
          fs.readFileSync(path.join(r3Folder, "main.py"), "utf-8"),
          "print('CURRENT_R3')\n"
        );
      }
    }
    await studentPortalManager.stopPortal().catch(() => {});
    console.log("  -> PASS R355-05.");

    console.log(
      "\n=== TẤT CẢ 5 NHÓM KIỂM THỬ v3.5.5 (R355-01 → R355-05) ĐÃ ĐẠT 100% ==="
    );
  } finally {
    BrowserManager.prototype.getPage = origGetPage;
    await studentPortalManager.stopPortal().catch(() => {});
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (mockDriveServer) {
      mockDriveServer.close();
    }
    if (mockLmsServer) {
      mockLmsServer.close();
    }
    try {
      closeDb();
    } catch {}
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  }
}

run().catch((err) => {
  console.error("[FAIL] test-spck-streamlined-v355:", err);
  process.exit(1);
});
