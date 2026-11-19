/**
 * MINDX AUTOMATION BOT - ISOLATED VERIFICATION SUITE FOR v3.6.3
 * "Tự động quét & gắn Ảnh bìa SPCK từ Google Drive (thiếu dùng Logo MindX dự phòng)"
 *
 * 100% hermetically isolated in `os.tmpdir()` (`MINDX_DB_PATH`, `MINDX_CONFIG_DIR`,
 * `MINDX_RUNNING_CLASSES_PATH`, `MINDX_LMS_CLASS_IDS_PATH`, `MINDX_ROLE_STATE_DIR`,
 * `ALLOWED_LOCAL_DIRS` set BEFORE any dynamic import from `../src/**`).
 *
 * Covers:
 * - [V363-01] Class subfolder matching (`GA38`, `JSB16`, non-collision `JSB15` != `JSB16`, `ARMA13` != `ARMI13`,
 *             `PTA12` != `PTI12`) + Vietnamese photo filename stem cleaning (preserves `"Anh"`, strips `"ảnh bìa"`).
 * - [V363-02] 4-pass Vietnamese student matching (`GA38` 7/8 + Logo MindX, `JSB16` 10/10 incl. `Tuấn Kiệt.png` ->
 *             `Nguyễn Trần Gia Kiệt` Pass 2 + `"Thế Anh.png"`, inactive-student guard, duplicate-given ambiguity guard).
 * - [V363-03] Embedded HTML parser, binary magic-byte validation, local cache reuse & `forceRedownload`,
 *             fallback to MindX Logo without losing `_spck_app_shots` gallery, verified snapshot protection
 *             (`.active_gdrive_thumb.json`), `preferDefaultLogoWhenNoOwnerPhoto` on `/api/spck/scan` & capture,
 *             and manual owner thumbnail override via `/api/spck/capture-screenshots`.
 * - [V363-04] API guardrails (`POST /api/spck/sync-drive-thumbnails` 403/400/200) & client-bundle secret/server isolation.
 * - [V363-05] Read-only live Tier 1 HTTP check against `1FmMyv6YkfeJ6mCgSs1_gDxZGyUI3pXvs` (`GA38` & `JSB16`).
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = process.cwd();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-v363-test-"));
const tempDbPath = path.join(tempRoot, "mindx_v363_test.db");
const tempConfigDir = path.join(tempRoot, "config");
const tempSpckRoot = path.join(tempRoot, "spck_root");
const tempRoleDir = path.join(tempRoot, "role-state");

fs.mkdirSync(path.join(tempConfigDir, "demo-sheet-templates"), { recursive: true });
fs.mkdirSync(tempSpckRoot, { recursive: true });
fs.mkdirSync(tempRoleDir, { recursive: true });

function makeSolidPngBuffer(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number
): Buffer {
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      t[n] = c >>> 0;
    }
    return t;
  })();

  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  };

  const makeChunk = (type: string, data: Buffer) => {
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  };

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowStride = 1 + width * 3;
  const raw = Buffer.alloc(rowStride * height);
  for (let y = 0; y < height; y++) {
    const base = y * rowStride;
    raw[base] = 0; // filter none
    for (let x = 0; x < width; x++) {
      const px = base + 1 + x * 3;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
    }
  }
  const idat = zlib.deflateSync(raw);

  return Buffer.concat([
    sig,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", idat),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

const liveLogoPath = path.join(ROOT, "data", "config", "default-spck-thumbnail.png");
if (fs.existsSync(liveLogoPath)) {
  fs.copyFileSync(liveLogoPath, path.join(tempConfigDir, "default-spck-thumbnail.png"));
} else {
  fs.writeFileSync(
    path.join(tempConfigDir, "default-spck-thumbnail.png"),
    makeSolidPngBuffer(320, 180, 220, 38, 38)
  );
}
fs.writeFileSync(
  path.join(tempConfigDir, "lms_class_ids.json"),
  JSON.stringify({}, null, 2),
  "utf8"
);
fs.writeFileSync(
  path.join(tempRoot, "running_classes.json"),
  JSON.stringify(
    [
      { classCode: "VT-C4K-GA38", status: "Running" },
      { classCode: "VT-JSB16", status: "Running" },
      { classCode: "VT-C4K-PTB02", status: "Running" },
    ],
    null,
    2
  ),
  "utf8"
);

// Isolate ALL runtime paths BEFORE importing ../src/**
process.env.MINDX_DB_PATH = tempDbPath;
process.env.MINDX_CONFIG_DIR = tempConfigDir;
process.env.MINDX_RUNNING_CLASSES_PATH = path.join(tempRoot, "running_classes.json");
process.env.MINDX_LMS_CLASS_IDS_PATH = path.join(tempConfigDir, "lms_class_ids.json");
process.env.MINDX_ROLE_STATE_DIR = tempRoleDir;
process.env.ALLOWED_LOCAL_DIRS = tempRoot;
process.env.MINDX_ALLOWED_EXTRA_PATHS = tempRoot;
process.env.MINDX_DISABLE_PORTAL_TUNNEL = "1";
process.env.MINDX_DISABLE_BROWSER_EXPORT_FALLBACK = "1";
process.env.GEMINI_API_KEY = "AIzaDummyTestKeyV363_NeverLive";

function localJsonRequest(
  url: string,
  bodyObj?: unknown,
  method = "POST",
  hostOverride = "127.0.0.1:3000"
): Request {
  return new Request(url, {
    method,
    headers: {
      host: hostOverride,
      "content-type": "application/json",
    },
    ...(bodyObj !== undefined ? { body: JSON.stringify(bodyObj) } : {}),
  });
}

async function runTests(): Promise<void> {
  const {
    checkSpckSnapshotFileDrift,
    closeDb,
    computeSpckSessionContentHash,
    getDb,
    parseSpckSubmissionSnapshot,
    spckSessionRepo,
    spckUploadRepo,
    studentRepo,
  } = await import("../src/lib/db/sqlite");
  const {
    ACTIVE_GDRIVE_THUMB_MANIFEST,
    DEFAULT_SPCK_STUDENT_THUMBNAIL_FOLDER_ID,
    cleanDrivePhotoStem,
    downloadPublicDriveImageHttp,
    listPublicDriveFolderHttp,
    matchDriveClassSubfolder,
    matchDrivePhotosToStudents,
    parseDriveEmbeddedFolderHtml,
    readActiveGdriveThumbManifest,
    syncClassStudentThumbnailsFromGoogleDrive,
    validateDownloadedDriveImageBuffer,
  } = await import("../src/lib/google-drive/spck-drive-thumbnails");
  const {
    DEFAULT_SPCK_THUMBNAIL_PATH,
    scanClassSpckDirectory,
  } = await import("../src/lib/local-files/spck-scanner");
  const {
    isOwnerUploadImageActive,
  } = await import("../src/lib/local-files/spck-app-screenshotter");
  const {
    fetchBoundedGoogleDriveBufferWithCookies,
  } = await import("../src/lib/playwright/spck-drive-uploader");
  const { POST: syncDriveThumbsPost } = await import(
    "../src/app/api/spck/sync-drive-thumbnails/route"
  );
  const { POST: scanPost } = await import("../src/app/api/spck/scan/route");
  const { POST: capturePost } = await import(
    "../src/app/api/spck/capture-screenshots/route"
  );

  try {
    // =========================================================================
    // [V363-01] Class Subfolder Matching & Vietnamese Photo Filename Cleaning
    // =========================================================================
    console.log("1. [V363-01] Checking class folder matching & filename stem cleaning...");
    const sampleSubfolders = [
      { id: "FLD_GA38_ID0001", name: "GA38", isFolder: true },
      { id: "FLD_JSB16_ID002", name: "JSB16", isFolder: true },
      { id: "FLD_ARMA13_003", name: "ARMA13", isFolder: true },
      { id: "FLD_PTI12_0004", name: "PTI12", isFolder: true },
      { id: "FILE_README_001", name: "GA38.png", isFolder: false },
    ];
    assert.equal(matchDriveClassSubfolder("VT-C4K-GA38", sampleSubfolders)?.id, "FLD_GA38_ID0001");
    assert.equal(matchDriveClassSubfolder("VT-JSB16", sampleSubfolders)?.id, "FLD_JSB16_ID002");
    assert.equal(
      matchDriveClassSubfolder("VT-C4K-GA38", [
        { id: "FLD_DESC_GA38", name: "Lớp GA38 - Demo Day", isFolder: true },
      ])?.id,
      "FLD_DESC_GA38"
    );
    // Strict non-collision across similar course codes
    assert.equal(matchDriveClassSubfolder("VT-JSB15", sampleSubfolders), null);
    assert.equal(matchDriveClassSubfolder("VT-ROB-ARMI13", sampleSubfolders), null);
    assert.equal(matchDriveClassSubfolder("VT-C4K-PTA12", sampleSubfolders), null);

    // Preserve given name "Anh" while removing Vietnamese label "ảnh bìa"
    assert.equal(cleanDrivePhotoStem("Thế Anh.png", "VT-JSB16"), "Thế Anh");
    assert.equal(cleanDrivePhotoStem("01. Ảnh bìa - Bảo Anh (1).png", "VT-C4K-GA38"), "Bảo Anh");
    assert.equal(cleanDrivePhotoStem("GA38_Hoàng_Long_final.png", "VT-C4K-GA38"), "Hoàng Long");
    assert.equal(
      cleanDrivePhotoStem("Lớp VT-C4K-GA38 : An Nhiên poster copy.png", "VT-C4K-GA38"),
      "An Nhiên"
    );
    console.log("  -> PASS V363-01.");

    // =========================================================================
    // [V363-02] 4-Pass Vietnamese Matching & Anti-Misassignment Guards
    // =========================================================================
    console.log("2. [V363-02] Checking GA38, JSB16, inactive-guard & duplicate-given-name guard...");
    const ga38Roster = [
      { studentId: "GA38_1", fullName: "Nguyễn Ngọc An Nhiên", isActive: 1 },
      { studentId: "GA38_2", fullName: "Nguyễn Bảo Anh", isActive: 1 },
      { studentId: "GA38_3", fullName: "Nguyễn Hoàng Long", isActive: 1 },
      { studentId: "GA38_4", fullName: "Lê Khánh Thi", isActive: 1 },
      { studentId: "GA38_5", fullName: "Phạm Mạnh Đức", isActive: 1 },
      { studentId: "GA38_6", fullName: "Trần Trung Tín", isActive: 1 },
      { studentId: "GA38_7", fullName: "Nguyễn Tuấn Kiệt", isActive: 1 },
      { studentId: "GA38_8", fullName: "Phạm Hà Thanh Nguyên", isActive: 1 },
      { studentId: "GA38_9_INACT", fullName: "Lê Anh Tú", isActive: 0 },
    ];
    const ga38Files = [
      { id: "G_FILE_000001", name: "An Nhiên.png", isFolder: false },
      { id: "G_FILE_000002", name: "Bảo Anh.png", isFolder: false },
      { id: "G_FILE_000003", name: "Hoàng Long.png", isFolder: false },
      { id: "G_FILE_000004", name: "Khánh Thi.png", isFolder: false },
      { id: "G_FILE_000005", name: "Mạnh Đức.png", isFolder: false },
      { id: "G_FILE_000006", name: "Trung Tín.png", isFolder: false },
      { id: "G_FILE_000007", name: "Tuấn Kiệt.png", isFolder: false },
    ];
    const ga38Match = matchDrivePhotosToStudents(ga38Files, ga38Roster, "VT-C4K-GA38");
    assert.equal(ga38Match.matchedByStudentId.size, 7);
    assert.equal(ga38Match.matchedByStudentId.has("GA38_8"), false);
    assert.equal(ga38Match.matchedByStudentId.has("GA38_9_INACT"), false);
    assert.equal(ga38Match.unmatchedFiles.length, 0);

    const jsb16Roster = [
      { studentId: "JSB16_01", fullName: "Phạm Gia Vỹ", isActive: 1 },
      { studentId: "JSB16_02", fullName: "Nguyễn Hoàng Bách", isActive: 1 },
      { studentId: "JSB16_03", fullName: "Trần Hữu Phước", isActive: 1 },
      { studentId: "JSB16_04", fullName: "Nguyễn Lê Minh", isActive: 1 },
      { studentId: "JSB16_05", fullName: "Đặng Quang Minh", isActive: 1 },
      { studentId: "JSB16_06", fullName: "Nguyễn Sỹ Tùng", isActive: 1 },
      { studentId: "JSB16_07", fullName: "Trần Thế Anh", isActive: 1 },
      { studentId: "JSB16_08", fullName: "Nguyễn Trần Gia Kiệt", isActive: 1 },
      { studentId: "JSB16_09", fullName: "Nguyễn Xuân Nguyên", isActive: 1 },
      { studentId: "JSB16_10", fullName: "Trần Đăng Khôi", isActive: 1 },
    ];
    const jsb16Files = [
      { id: "J_FILE_000001", name: "Gia Vỹ.png", isFolder: false },
      { id: "J_FILE_000002", name: "Hoàng Bách.png", isFolder: false },
      { id: "J_FILE_000003", name: "Hữu Phước.png", isFolder: false },
      { id: "J_FILE_000004", name: "Lê Minh.png", isFolder: false },
      { id: "J_FILE_000005", name: "Quang Minh.png", isFolder: false },
      { id: "J_FILE_000006", name: "Sỹ Tùng.png", isFolder: false },
      { id: "J_FILE_000007", name: "Thế Anh.png", isFolder: false },
      { id: "J_FILE_000008", name: "Tuấn Kiệt.png", isFolder: false },
      { id: "J_FILE_000009", name: "Xuân Nguyên.png", isFolder: false },
      { id: "J_FILE_000010", name: "Đăng Khôi.png", isFolder: false },
    ];
    const jsb16Match = matchDrivePhotosToStudents(jsb16Files, jsb16Roster, "VT-JSB16");
    assert.equal(jsb16Match.matchedByStudentId.size, 10);
    assert.equal(jsb16Match.matchedByStudentId.get("JSB16_04")?.file.name, "Lê Minh.png");
    assert.equal(jsb16Match.matchedByStudentId.get("JSB16_05")?.file.name, "Quang Minh.png");
    assert.equal(jsb16Match.matchedByStudentId.get("JSB16_07")?.file.name, "Thế Anh.png");
    const kietMatch = jsb16Match.matchedByStudentId.get("JSB16_08");
    assert.equal(kietMatch?.file.name, "Tuấn Kiệt.png");
    assert.equal(kietMatch?.tier, "PASS_2_UNIQUE_GIVEN");
    assert.ok(kietMatch?.matchWarning?.includes("Kiệt"));

    // Inactive student guard: photo of inactive "Nguyễn Trần Gia Kiệt" must NOT steal active "Bùi Anh Kiệt"
    const inactiveGuardMatch = matchDrivePhotosToStudents(
      [{ id: "G_INACT_00001", name: "Gia Kiệt.png", isFolder: false }],
      [
        { studentId: "J15_ACT", fullName: "Bùi Anh Kiệt", isActive: 1 },
        { studentId: "J15_INACT", fullName: "Nguyễn Trần Gia Kiệt", isActive: 0 },
      ],
      "VT-JSB15"
    );
    assert.equal(inactiveGuardMatch.matchedByStudentId.size, 0);
    assert.equal(inactiveGuardMatch.inactiveClaimedFiles.length, 1);

    // Duplicate given-name ambiguity guard: 2 students ending in "Minh", neither is "Hoàng Minh"
    const dupMinhMatch = matchDrivePhotosToStudents(
      [{ id: "G_DUP_0000001", name: "Hoàng Minh.png", isFolder: false }],
      [
        { studentId: "DUP_1", fullName: "Nguyễn Nhật Minh", isActive: 1 },
        { studentId: "DUP_2", fullName: "Trần Quang Minh", isActive: 1 },
      ],
      "VT-JSB16"
    );
    assert.equal(dupMinhMatch.matchedByStudentId.size, 0);
    console.log("  -> PASS V363-02.");

    // =========================================================================
    // [V363-03] Parser, Validation, Cache, Snapshot Protection, Scan & Manual Upload
    // =========================================================================
    console.log("3. [V363-03] Checking HTML parser, magic check, sync, snapshot & fallback...");
    const sampleFlipHtml = `<!DOCTYPE html><html><body><div class="flip-entries">
      <div class="flip-entry" id="entry-1QmzEij1JzM2QQfZVpMNmF5j-qHBgRYG7"><div class="flip-entry-title"><a href="https://drive.google.com/drive/folders/1QmzEij1JzM2QQfZVpMNmF5j-qHBgRYG7">GA38</a></div></div>
      <div class="flip-entry" id="entry-1KtTBRAefndkEXnEzNY5kk2u2naOyqQ0c"><div class="flip-entry-title"><a href="https://drive.google.com/file/d/1KtTBRAefndkEXnEzNY5kk2u2naOyqQ0c/view">An Nhi&ecirc;n.png</a></div></div>
    </div></body></html>`;
    const parsedEntries = parseDriveEmbeddedFolderHtml(sampleFlipHtml);
    assert.ok(parsedEntries && parsedEntries.length === 2);
    assert.equal(parsedEntries![0].isFolder, true);
    assert.equal(parsedEntries![1].isFolder, false);
    assert.equal(parsedEntries![1].name, "An Nhiên.png");
    assert.equal(
      parseDriveEmbeddedFolderHtml("<html><title>Sign in - Google Accounts</title></html>"),
      null
    );

    const verticalPosterPng = makeSolidPngBuffer(836, 941, 18, 92, 165);
    const updatedPosterPng = makeSolidPngBuffer(836, 941, 200, 120, 30);
    const appShotPng = makeSolidPngBuffer(1280, 720, 45, 55, 72);
    const manualUploadPng = makeSolidPngBuffer(640, 360, 20, 160, 90);

    assert.equal(validateDownloadedDriveImageBuffer(verticalPosterPng, "a.png").valid, true);
    assert.equal(
      validateDownloadedDriveImageBuffer(Buffer.from("<script>alert(1)</script>"), "bad.png").valid,
      false
    );
    assert.equal(
      validateDownloadedDriveImageBuffer(
        Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
        "bad.svg"
      ).valid,
      false
    );

    const db = getDb();
    const classId = "VT-C4K-GA38";
    for (const sNum of [12, 13, 14] as const) {
      db.prepare(
        `INSERT OR REPLACE INTO classes_sessions (sessionId, classId, className, sessionNumber, date) VALUES (?, ?, ?, ?, '2026-11-19')`
      ).run(`${classId}_S_${sNum}`, classId, classId, sNum);
    }

    const gaClassLocalDir = path.join(tempSpckRoot, classId);
    const anNhienDir = path.join(gaClassLocalDir, "Nguyen Ngoc An Nhien");
    const thanhNguyenDir = path.join(gaClassLocalDir, "Pham Ha Thanh Nguyen");
    for (const dir of [anNhienDir, thanhNguyenDir]) {
      fs.mkdirSync(path.join(dir, "_spck_app_shots"), { recursive: true });
      fs.writeFileSync(path.join(dir, "main.py"), "print('demo day')\n", "utf8");
    }
    const nguyenOldShot = path.join(thanhNguyenDir, "_spck_app_shots", "shot_01.png");
    fs.writeFileSync(nguyenOldShot, appShotPng);

    studentRepo.upsert({
      studentId: "GA38_1",
      classId,
      fullName: "Nguyễn Ngọc An Nhiên",
      isActive: 1,
    });
    studentRepo.upsert({
      studentId: "GA38_8",
      classId,
      fullName: "Phạm Hà Thanh Nguyên",
      isActive: 1,
    });
    spckUploadRepo.upsert({
      classId,
      studentId: "GA38_1",
      localFolderPath: anNhienDir,
      matchScore: 1,
      isConfirmedByTeacher: 1,
      projectTitle: "Flappy Bird - Nguyễn Ngọc An Nhiên",
      baseProjectTitle: "Flappy Bird - Nguyễn Ngọc An Nhiên",
      thumbnailPath: DEFAULT_SPCK_THUMBNAIL_PATH,
      screenshotsJson: "[]",
      attachmentsJson: JSON.stringify([path.join(anNhienDir, "main.py")]),
      youtubeUrlsJson: "[]",
      relatedLinksJson: "[]",
      teacherComment: "Nhận xét tốt.",
      contentHash: "",
      status: "WAITING_APPROVAL",
    });
    // Student 8 initially has `_spck_app_shots/shot_01.png` as thumbnail — MUST switch to MindX Logo without losing shot_01.png!
    spckUploadRepo.upsert({
      classId,
      studentId: "GA38_8",
      localFolderPath: thanhNguyenDir,
      matchScore: 1,
      isConfirmedByTeacher: 1,
      projectTitle: "Space Shooter - Phạm Hà Thanh Nguyên",
      baseProjectTitle: "Space Shooter - Phạm Hà Thanh Nguyên",
      thumbnailPath: nguyenOldShot,
      screenshotsJson: JSON.stringify([nguyenOldShot]),
      attachmentsJson: JSON.stringify([path.join(thanhNguyenDir, "main.py")]),
      youtubeUrlsJson: "[]",
      relatedLinksJson: "[]",
      teacherComment: "Nhận xét ổn.",
      contentHash: "",
      status: "WAITING_APPROVAL",
    });
    spckSessionRepo.getOrInitSessionDraft(classId, "GA38_1", 12, "Nguyễn Ngọc An Nhiên");
    spckSessionRepo.getOrInitSessionDraft(classId, "GA38_8", 12, "Phạm Hà Thanh Nguyên");

    let downloadCalls = 0;
    let driveHasAnNhien = true;
    let currentPosterBytes = verticalPosterPng;

    const testProvider = {
      listFolder: async (folderId: string) => {
        if (folderId === DEFAULT_SPCK_STUDENT_THUMBNAIL_FOLDER_ID) {
          return [{ id: "GA38_SUBFOLDER_01", name: "GA38", isFolder: true }];
        }
        if (folderId === "GA38_SUBFOLDER_01") {
          return driveHasAnNhien
            ? [{ id: "GDRV_AN_NHIEN_001", name: "An Nhiên.png", isFolder: false }]
            : [];
        }
        return [];
      },
      downloadFile: async (fileId: string) => {
        downloadCalls++;
        return fileId === "GDRV_AN_NHIEN_001" ? currentPosterBytes : null;
      },
    };

    const sync1 = await syncClassStudentThumbnailsFromGoogleDrive({
      classId,
      sessionNumber: 12,
      _testDriveProvider: testProvider,
    });
    assert.equal(sync1.classSubfolderFound, true);
    assert.equal(sync1.matchedFromDriveCount, 1);
    assert.equal(sync1.downloadedCount, 1);
    assert.equal(sync1.fallbackLogoCount, 1);
    assert.equal(downloadCalls, 1);

    const anNhienAfter1 = spckUploadRepo.findOne(classId, "GA38_1")!;
    const expectedDriveThumbPath = path.join(
      anNhienDir,
      "_spck_owner_uploads",
      "thumb_gdrive_GDRV_AN_NHIEN_001.png"
    );
    assert.equal(
      path.resolve(anNhienAfter1.thumbnailPath || "").toLowerCase(),
      path.resolve(expectedDriveThumbPath).toLowerCase()
    );
    assert.equal(fs.existsSync(expectedDriveThumbPath), true);
    assert.equal(isOwnerUploadImageActive(expectedDriveThumbPath), true);
    assert.equal(
      readActiveGdriveThumbManifest(path.join(anNhienDir, "_spck_owner_uploads"))?.status,
      "ACTIVE"
    );

    // Check Phạm Hà Thanh Nguyên reset thumbnail to MindX Logo AND kept `_spck_app_shots/shot_01.png` in gallery
    const nguyenAfter1 = spckUploadRepo.findOne(classId, "GA38_8")!;
    assert.equal(
      path.resolve(nguyenAfter1.thumbnailPath || "").toLowerCase(),
      path.resolve(DEFAULT_SPCK_THUMBNAIL_PATH).toLowerCase()
    );
    const nguyenGallery1: string[] = JSON.parse(nguyenAfter1.screenshotsJson || "[]");
    assert.ok(
      nguyenGallery1.some((p) => path.resolve(p).toLowerCase() === path.resolve(nguyenOldShot).toLowerCase()),
      "Displaced _spck_app_shots/shot_01.png MUST be preserved in screenshotsJson!"
    );

    // Second run uses local cache (0 extra downloads)
    const sync2 = await syncClassStudentThumbnailsFromGoogleDrive({
      classId,
      sessionNumber: 12,
      _testDriveProvider: testProvider,
    });
    assert.equal(sync2.reusedCachedCount, 1);
    assert.equal(downloadCalls, 1);

    // `forceRedownload: true` fetches updated bytes
    currentPosterBytes = updatedPosterPng;
    const sync3 = await syncClassStudentThumbnailsFromGoogleDrive({
      classId,
      sessionNumber: 12,
      forceRedownload: true,
      _testDriveProvider: testProvider,
    });
    assert.equal(sync3.downloadedCount, 1);
    assert.equal(downloadCalls, 2);
    assert.equal(
      crypto.createHash("sha256").update(fs.readFileSync(expectedDriveThumbPath)).digest("hex"),
      crypto.createHash("sha256").update(updatedPosterPng).digest("hex")
    );

    // Mark Session 12 VERIFIED with frozen snapshots pointing to `expectedDriveThumbPath`
    const s12Draft = spckSessionRepo.getOrInitSessionDraft(classId, "GA38_1", 12, "Nguyễn Ngọc An Nhiên");
    const s12SnapObj = {
      title: s12Draft.projectTitle,
      thumbnailPath: expectedDriveThumbPath,
      screenshots: [],
      attachments: JSON.parse(s12Draft.attachmentsJson || "[]"),
      youtubeUrls: [],
      relatedLinks: [],
      teacherComment: s12Draft.teacherComment,
      quickTags: JSON.parse(s12Draft.quickTagsJson || "[]"),
    };
    const s12SnapJson = JSON.stringify(s12SnapObj);
    const s12Hash = computeSpckSessionContentHash(s12Draft, 12);
    db.prepare(
      `UPDATE spck_session_submissions
       SET draftStatus = 'VERIFIED',
           approvedContentHash = ?,
           approvedSnapshotJson = ?,
           approvedAt = datetime('now', 'localtime'),
           lastVerifiedAt = datetime('now', 'localtime'),
           lastVerifiedHash = ?,
           lastVerifiedSnapshotJson = ?
       WHERE classId = ? AND studentId = ? AND sessionNumber = 12`
    ).run(s12Hash, s12SnapJson, s12Hash, s12SnapJson, classId, "GA38_1");

    // Initialize Session 13, then delete An Nhiên's photo on Drive!
    spckSessionRepo.getOrInitSessionDraft(classId, "GA38_1", 13, "Nguyễn Ngọc An Nhiên");
    driveHasAnNhien = false;
    const syncS13 = await syncClassStudentThumbnailsFromGoogleDrive({
      classId,
      sessionNumber: 13,
      _testDriveProvider: testProvider,
    });
    assert.equal(syncS13.fallbackLogoCount, 2);

    // Verify snapshot protection: old file STILL on disk (0 drift on B12), manifest NONE, B13 uses MindX Logo!
    assert.equal(fs.existsSync(expectedDriveThumbPath), true);
    assert.equal(
      readActiveGdriveThumbManifest(path.join(anNhienDir, "_spck_owner_uploads"))?.status,
      "NONE"
    );
    assert.equal(isOwnerUploadImageActive(expectedDriveThumbPath), false);
    const s12Check = spckSessionRepo.findOne(classId, "GA38_1", 12)!;
    assert.equal(s12Check.draftStatus, "VERIFIED");
    assert.equal(
      checkSpckSnapshotFileDrift(parseSpckSubmissionSnapshot(s12Check.lastVerifiedSnapshotJson))
        .hasFileDrift,
      false
    );
    const s13Check = spckSessionRepo.findOne(classId, "GA38_1", 13)!;
    assert.equal(
      path.resolve(s13Check.thumbnailPath || "").toLowerCase(),
      path.resolve(DEFAULT_SPCK_THUMBNAIL_PATH).toLowerCase()
    );

    // Scan with `preferDefaultLogoWhenNoOwnerPhoto: true` MUST NOT resurrect inactive Drive photo or app shots
    const activeStudentsOnly = studentRepo.findByClass(classId, false);
    const directScan = scanClassSpckDirectory(
      classId,
      gaClassLocalDir,
      activeStudentsOnly,
      { preferDefaultLogoWhenNoOwnerPhoto: true }
    );
    for (const scItem of directScan.items) {
      assert.equal(
        path.resolve(scItem.packageData.thumbnailPath).toLowerCase(),
        path.resolve(DEFAULT_SPCK_THUMBNAIL_PATH).toLowerCase()
      );
    }
    const scanResp = await scanPost(
      localJsonRequest("http://127.0.0.1:3000/api/spck/scan", {
        classId,
        folderPath: gaClassLocalDir,
        sessionNumber: 13,
        syncActiveSession: true,
        preferDefaultLogoWhenNoOwnerPhoto: true,
      })
    );
    assert.equal(scanResp.status, 200);
    const scanJson = (await scanResp.json()) as {
      success: boolean;
      records: Array<{ studentId: string; thumbnailPath: string; screenshotsJson: string }>;
    };
    assert.equal(scanJson.success, true);
    const scanRecNhien = scanJson.records.find((r) => r.studentId === "GA38_1")!;
    const scanRecNguyen = scanJson.records.find((r) => r.studentId === "GA38_8")!;
    assert.equal(
      path.resolve(scanRecNhien.thumbnailPath).toLowerCase(),
      path.resolve(DEFAULT_SPCK_THUMBNAIL_PATH).toLowerCase()
    );
    assert.equal(
      path.resolve(scanRecNguyen.thumbnailPath).toLowerCase(),
      path.resolve(DEFAULT_SPCK_THUMBNAIL_PATH).toLowerCase()
    );
    assert.ok(
      JSON.parse(scanRecNguyen.screenshotsJson || "[]").some(
        (p: string) => path.resolve(p).toLowerCase() === path.resolve(nguyenOldShot).toLowerCase()
      )
    );

    // Restore Drive photo cleanly, then verify manual owner upload overrides & deactivates Drive photo
    driveHasAnNhien = true;
    await syncClassStudentThumbnailsFromGoogleDrive({
      classId,
      sessionNumber: 13,
      _testDriveProvider: testProvider,
    });
    assert.equal(
      readActiveGdriveThumbManifest(path.join(anNhienDir, "_spck_owner_uploads"))?.status,
      "ACTIVE"
    );

    const manualResp = await capturePost(
      localJsonRequest("http://127.0.0.1:3000/api/spck/capture-screenshots", {
        action: "upload_owner_image",
        classId,
        studentId: "GA38_1",
        sessionNumber: 13,
        role: "thumbnail",
        files: [
          {
            fileName: "manual_override.png",
            dataUrl: `data:image/png;base64,${manualUploadPng.toString("base64")}`,
          },
        ],
      })
    );
    assert.equal(manualResp.status, 200);
    const s13AfterManual = spckSessionRepo.findOne(classId, "GA38_1", 13)!;
    assert.match(path.basename(s13AfterManual.thumbnailPath || ""), /^thumb_\d+_0_manual_override\.png$/);
    assert.equal(isOwnerUploadImageActive(expectedDriveThumbPath), false);
    assert.equal(fs.existsSync(expectedDriveThumbPath), true, "Snapshot-protected Drive file must stay for B12!");
    console.log("  -> PASS V363-03.");

    // =========================================================================
    // [V363-04] API Security Guardrails & Client Bundle Isolation
    // =========================================================================
    console.log("4. [V363-04] Checking /api/spck/sync-drive-thumbnails security & client isolation...");
    const nonLocalRes = await syncDriveThumbsPost(
      localJsonRequest(
        "http://example.com/api/spck/sync-drive-thumbnails",
        { classId },
        "POST",
        "example.com"
      )
    );
    assert.equal(nonLocalRes.status, 403);

    const badJsonRes = await syncDriveThumbsPost(
      new Request("http://127.0.0.1:3000/api/spck/sync-drive-thumbnails", {
        method: "POST",
        headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
        body: "{bad-json",
      })
    );
    assert.equal(badJsonRes.status, 400);

    const emptyClassRes = await syncDriveThumbsPost(
      localJsonRequest("http://127.0.0.1:3000/api/spck/sync-drive-thumbnails", {
        classId: "",
      })
    );
    assert.equal(emptyClassRes.status, 400);

    const exemptClassRes = await syncDriveThumbsPost(
      localJsonRequest("http://127.0.0.1:3000/api/spck/sync-drive-thumbnails", {
        classId: "VT-C4K-PTB02",
      })
    );
    assert.equal(exemptClassRes.status, 400);

    const invalidUrlRes = await syncDriveThumbsPost(
      localJsonRequest("http://127.0.0.1:3000/api/spck/sync-drive-thumbnails", {
        classId,
        driveFolderUrl: "https://example.com/not valid url!",
      })
    );
    assert.equal(invalidUrlRes.status, 400);

    // End-to-end HTTP 200 check via mocked Tier 1 Google Drive endpoints
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const u = String(input);
        if (u.includes(`id=${DEFAULT_SPCK_STUDENT_THUMBNAIL_FOLDER_ID}`)) {
          return new Response(
            '<div class="flip-entries"><div class="flip-entry" id="entry-GA38_HTTP_00001"><div class="flip-entry-title"><a href="https://drive.google.com/drive/folders/GA38_HTTP_00001">GA38</a></div></div></div>',
            { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
          );
        }
        if (u.includes("id=GA38_HTTP_00001")) {
          return new Response(
            '<div class="flip-entries"><div class="flip-entry" id="entry-NHIEN_HTTP_0001"><div class="flip-entry-title"><a href="https://drive.google.com/file/d/NHIEN_HTTP_0001/view">An Nhiên.png</a></div></div></div>',
            { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
          );
        }
        if (u.includes("id=NHIEN_HTTP_0001")) {
          return new Response(new Uint8Array(verticalPosterPng), {
            status: 200,
            headers: { "content-type": "image/png" },
          });
        }
        return new Response("Not Found", { status: 404 });
      }) as typeof fetch;

      const validRouteRes = await syncDriveThumbsPost(
        localJsonRequest("http://127.0.0.1:3000/api/spck/sync-drive-thumbnails", {
          classId,
          sessionNumber: 13,
          forceRedownload: true,
        })
      );
      assert.equal(validRouteRes.status, 200);
      const validRouteJson = (await validRouteRes.json()) as {
        success: boolean;
        syncResult: {
          classSubfolderFound: boolean;
          matchedFromDriveCount: number;
          fallbackLogoCount: number;
          failedCount: number;
        };
        records: Array<{ studentId: string; thumbnailPath: string }>;
      };
      assert.equal(validRouteJson.success, true);
      assert.equal(validRouteJson.syncResult.classSubfolderFound, true);
      assert.equal(validRouteJson.syncResult.matchedFromDriveCount, 1);
      assert.equal(validRouteJson.syncResult.fallbackLogoCount, 1);
      assert.equal(validRouteJson.syncResult.failedCount, 0);
      const s13RouteNhien = validRouteJson.records.find((r) => r.studentId === "GA38_1");
      assert.ok(s13RouteNhien);
      assert.match(s13RouteNhien!.thumbnailPath, /thumb_gdrive_NHIEN_HTTP_0001\.png$/);
    } finally {
      globalThis.fetch = origFetch;
    }

    const clientFilesToCheck = [
      "src/app/final-project/page.tsx",
      "src/components/final-project/useSpckWorkflow.ts",
      "src/components/final-project/Step1Header.tsx",
      "src/components/final-project/ToolsDrawer.tsx",
      "src/components/final-project/StudentRow.tsx",
      "src/lib/spck/spck-ui-helpers.ts",
    ];
    for (const rel of clientFilesToCheck) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      assert.equal(
        /TEACHING_PASSWORD|LMS_PASSWORD|GEMINI_API_KEY|from\s+["'][^"']*(?:lib\/db|lib\/config|lib\/playwright|lib\/google-drive)/.test(
          src
        ),
        false,
        `Client file '${rel}' must not import server modules or reference secrets!`
      );
    }
    const pageSrc = fs.readFileSync(path.join(ROOT, "src/app/final-project/page.tsx"), "utf8");
    assert.ok(pageSrc.includes('\n  return (\n    <div className="space-y-6">'));
    const navbarSrc = fs.readFileSync(path.join(ROOT, "src/components/top-navbar.tsx"), "utf8");
    assert.ok(navbarSrc.includes("MindX Bot v3.6.3"));
    console.log("  -> PASS V363-04.");

    // =========================================================================
    // [V363-05] Read-Only Live Tier 1 HTTP Smoke Check
    // =========================================================================
    console.log("5. [V363-05] Checking live read-only Tier 1 Google Drive listing...");
    const liveItems = await listPublicDriveFolderHttp(DEFAULT_SPCK_STUDENT_THUMBNAIL_FOLDER_ID);
    if (liveItems === null) {
      console.log("  -> INFO: Live Google Drive unreachable/offline; skipping live Tier 1 check.");
    } else {
      assert.equal(
        matchDriveClassSubfolder("VT-C4K-GA38", liveItems)?.name,
        "GA38",
        "Expected live Google Drive folder to contain GA38!"
      );
      assert.equal(
        matchDriveClassSubfolder("VT-JSB16", liveItems)?.name,
        "JSB16",
        "Expected live Google Drive folder to contain JSB16!"
      );
      console.log(`  -> PASS V363-05 (${liveItems.length} folders seen cleanly via Tier 1 HTTP).`);
    }

    // =========================================================================
    // [V363-06] Codex Audit Hardening: Verified Same-ID Force Refresh, Symlinks,
    //           Spoofed Owner Image Guard, Untouched VERIFIED Scan & >20MB Stream
    // =========================================================================
    console.log("6. [V363-06] Verifying Codex audit hardening invariants...");

    // 6a. Same-fileId forced refresh AFTER Session 12 is VERIFIED must version filename instead of overwriting verified snapshot bytes!
    const v363Class6 = "VT-C4K-GA38";
    const s12Before6 = spckSessionRepo.findOne(v363Class6, "GA38_1", 12)!;
    assert.equal(s12Before6.draftStatus, "VERIFIED");
    const expectedV1Bytes = updatedPosterPng;
    const expectedV1Sha = crypto.createHash("sha256").update(expectedV1Bytes).digest("hex");
    // Ensure expectedDriveThumbPath still holds exact V1 bytes
    assert.equal(
      crypto.createHash("sha256").update(fs.readFileSync(expectedDriveThumbPath)).digest("hex"),
      expectedV1Sha
    );
    const v3PosterBytes = makeSolidPngBuffer(836, 941, 240, 40, 140);
    const v3Sha8 = crypto.createHash("sha256").update(v3PosterBytes).digest("hex").slice(0, 8);
    currentPosterBytes = v3PosterBytes;
    driveHasAnNhien = true;
    const syncForce6 = await syncClassStudentThumbnailsFromGoogleDrive({
      classId: v363Class6,
      sessionNumber: 13,
      forceRedownload: true,
      _testDriveProvider: testProvider,
    });
    assert.equal(syncForce6.failedCount, 0);
    // Original verified snapshot file on disk MUST keep exact V1 SHA-256 (0 VERIFIED_FILE_DRIFT!)
    assert.equal(
      crypto.createHash("sha256").update(fs.readFileSync(expectedDriveThumbPath)).digest("hex"),
      expectedV1Sha,
      "Frozen VERIFIED snapshot file must NEVER be overwritten in-place on forced Drive refresh!"
    );
    assert.equal(
      checkSpckSnapshotFileDrift(
        parseSpckSubmissionSnapshot(spckSessionRepo.findOne(v363Class6, "GA38_1", 12)!.lastVerifiedSnapshotJson)
      ).hasFileDrift,
      false
    );
    const s13AfterForce6 = spckSessionRepo.findOne(v363Class6, "GA38_1", 13)!;
    assert.match(
      path.basename(s13AfterForce6.thumbnailPath || ""),
      new RegExp(`^thumb_gdrive_GDRV_AN_NHIEN_001_${v3Sha8}\\.png$`)
    );
    assert.equal(
      readActiveGdriveThumbManifest(path.join(anNhienDir, "_spck_owner_uploads"))?.activeFileName,
      `thumb_gdrive_GDRV_AN_NHIEN_001_${v3Sha8}.png`
    );

    // 6b. Symlink/junction `_spck_owner_uploads` inside allowed temp root must be rejected (cross-student containment)
    const crossTargetDir = path.join(gaClassLocalDir, "ProtectedVictimTarget");
    fs.mkdirSync(crossTargetDir, { recursive: true });
    fs.writeFileSync(path.join(crossTargetDir, "thumb_gdrive_SECRET.png"), appShotPng);
    const plantedStuDir = path.join(gaClassLocalDir, "Tran Hoang Long");
    fs.mkdirSync(plantedStuDir, { recursive: true });
    const plantedOwnerDir = path.join(plantedStuDir, "_spck_owner_uploads");
    fs.symlinkSync(
      crossTargetDir,
      plantedOwnerDir,
      process.platform === "win32" ? "junction" : "dir"
    );
    studentRepo.upsert({
      studentId: "GA38_3",
      classId: v363Class6,
      fullName: "Nguyễn Hoàng Long",
      isActive: 1,
    });
    spckUploadRepo.upsert({
      classId: v363Class6,
      studentId: "GA38_3",
      localFolderPath: plantedStuDir,
      matchScore: 1,
      isConfirmedByTeacher: 1,
      projectTitle: "SPCK Hoàng Long",
      baseProjectTitle: "SPCK Hoàng Long",
      thumbnailPath: DEFAULT_SPCK_THUMBNAIL_PATH,
      screenshotsJson: "[]",
      attachmentsJson: "[]",
      youtubeUrlsJson: "[]",
      relatedLinksJson: "[]",
      teacherComment: "",
      contentHash: "",
      status: "DRAFT",
    });
    const symlinkSyncRes = await syncClassStudentThumbnailsFromGoogleDrive({
      classId: v363Class6,
      studentIds: ["GA38_3"],
      sessionNumber: 13,
      _testDriveProvider: {
        listFolder: async (fid) =>
          fid === DEFAULT_SPCK_STUDENT_THUMBNAIL_FOLDER_ID
            ? [{ id: "GA38_SUBFOLDER_01", name: "GA38", isFolder: true }]
            : [{ id: "GDRV_HLONG_0001", name: "Hoàng Long.png", isFolder: false }],
        downloadFile: async () => v3PosterBytes,
      },
    });
    assert.equal(symlinkSyncRes.failedCount, 1);
    assert.equal(symlinkSyncRes.results[0].status, "FAILED");
    assert.match(symlinkSyncRes.results[0].errorMessage || "", /Security|liên kết|symlink/i);
    assert.equal(
      fs.existsSync(path.join(crossTargetDir, "thumb_gdrive_SECRET.png")),
      true,
      "Symlink rejection must stop BEFORE touching or cleaning target directory!"
    );

    // 6c. Manual upload_owner_image rejects spoofed script bytes & symlink ownerDir
    const spoofUploadRes = await capturePost(
      localJsonRequest("http://127.0.0.1:3000/api/spck/capture-screenshots", {
        action: "upload_owner_image",
        classId: v363Class6,
        studentId: "GA38_1",
        sessionNumber: 13,
        role: "thumbnail",
        files: [
          {
            fileName: "evil.png",
            dataUrl: `data:image/png;base64,${Buffer.from("<script>alert(1)</script>").toString("base64")}`,
          },
        ],
      })
    );
    assert.equal(spoofUploadRes.status, 400);

    // 6d. Untouched VERIFIED Session 12 using old `_spck_app_shots` must NOT be demoted by `preferDefaultLogoWhenNoOwnerPhoto` scan
    const legacyVerifiedDir = path.join(gaClassLocalDir, "Legacy Verified Student");
    fs.mkdirSync(path.join(legacyVerifiedDir, "_spck_app_shots"), { recursive: true });
    fs.writeFileSync(path.join(legacyVerifiedDir, "main.py"), "print('stable')\n", "utf8");
    const legacyShot = path.join(legacyVerifiedDir, "_spck_app_shots", "shot_legacy.png");
    fs.writeFileSync(legacyShot, appShotPng);
    studentRepo.upsert({
      studentId: "GA38_LEG",
      classId: v363Class6,
      fullName: "Lê Khánh Thi",
      isActive: 1,
    });
    spckUploadRepo.upsert({
      classId: v363Class6,
      studentId: "GA38_LEG",
      localFolderPath: legacyVerifiedDir,
      matchScore: 1,
      isConfirmedByTeacher: 1,
      projectTitle: "Chess - Lê Khánh Thi",
      baseProjectTitle: "Chess - Lê Khánh Thi",
      thumbnailPath: legacyShot,
      screenshotsJson: JSON.stringify([legacyShot]),
      attachmentsJson: JSON.stringify([path.join(legacyVerifiedDir, "main.py")]),
      youtubeUrlsJson: "[]",
      relatedLinksJson: "[]",
      teacherComment: "- Nhận xét đã duyệt.",
      contentHash: "",
      status: "VERIFIED",
    });
    const legDraft = spckSessionRepo.getOrInitSessionDraft(v363Class6, "GA38_LEG", 12, "Lê Khánh Thi");
    const legApp = spckSessionRepo.approveSessionDraft(v363Class6, "GA38_LEG", 12, legDraft.draftVersion);
    spckSessionRepo.markSessionVerifiedFromUpload(
      v363Class6,
      "GA38_LEG",
      12,
      {
        ...spckUploadRepo.findOne(v363Class6, "GA38_LEG")!,
        projectTitle: legApp.record.projectTitle,
        teacherComment: legApp.record.teacherComment,
        contentHash: legApp.record.approvedContentHash,
      },
      "2026-11-18T10:00:00",
      "LMS_WORK_LEG_12"
    );
    // Clean up planted junction folder so scan only checks real folders cleanly, then mark folder prepped
    fs.rmSync(plantedStuDir, { recursive: true, force: true });
    const { computeStudentFolderContentDigest } = await import("../src/lib/local-files/spck-scanner");
    spckUploadRepo.markFolderPrepped(
      v363Class6,
      "GA38_LEG",
      computeStudentFolderContentDigest(legacyVerifiedDir).digest
    );
    const legScanRes = await scanPost(
      localJsonRequest("http://127.0.0.1:3000/api/spck/scan", {
        classId: v363Class6,
        folderPath: gaClassLocalDir,
        sessionNumber: 12,
        syncActiveSession: true,
        preferDefaultLogoWhenNoOwnerPhoto: true,
      })
    );
    assert.equal(legScanRes.status, 200);
    assert.equal(
      spckSessionRepo.findOne(v363Class6, "GA38_LEG", 12)?.draftStatus,
      "VERIFIED",
      "Untouched VERIFIED Session 12 must NOT be demoted merely because preferDefaultLogoWhenNoOwnerPhoto replaced _spck_app_shots in shared pool!"
    );

    // 6e. Bounded streaming: >20MB Content-Length cancels stream without buffering giant payload
    const origFetch6 = globalThis.fetch;
    let bodyReadCancelled = false;
    try {
      globalThis.fetch = (async () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers({
            "content-type": "image/png",
            "content-length": String(25 * 1024 * 1024),
          }),
          body: {
            cancel: async () => {
              bodyReadCancelled = true;
            },
            getReader: () => {
              throw new Error("Should not call getReader when Content-Length > 20MB!");
            },
          },
        } as unknown as Response)) as typeof fetch;
      const hugeRes = await downloadPublicDriveImageHttp("G_HUGE_FILE_00001");
      assert.equal(hugeRes, null);
      assert.equal(bodyReadCancelled, true);
    } finally {
      globalThis.fetch = origFetch6;
    }

    // 6f. Protected `<sha8>` hash-prefix collision must preserve BOTH protected files and pick `<sha16>`
    const v4PosterBytes = makeSolidPngBuffer(836, 941, 15, 210, 120);
    const v4FullSha = crypto.createHash("sha256").update(v4PosterBytes).digest("hex");
    const v4Sha8 = v4FullSha.slice(0, 8);
    const v4Sha16 = v4FullSha.slice(0, 16);
    const collidingSha8Name = `thumb_gdrive_GDRV_AN_NHIEN_001_${v4Sha8}.png`;
    const collidingSha8Path = path.join(anNhienDir, "_spck_owner_uploads", collidingSha8Name);
    const collidingPreBytes = makeSolidPngBuffer(836, 941, 90, 90, 90);
    const collidingPreSha = crypto.createHash("sha256").update(collidingPreBytes).digest("hex");
    fs.writeFileSync(collidingSha8Path, collidingPreBytes);
    // Lock colliding `<v4Sha8>` inside Session 12's frozen `approvedSnapshotJson` (while keeping `lastVerifiedSnapshotJson` valid too)
    const curS12 = spckSessionRepo.findOne(v363Class6, "GA38_1", 12)!;
    const prevAppSnap = JSON.parse(curS12.approvedSnapshotJson || "{}");
    prevAppSnap.screenshots = [collidingSha8Path];
    db.prepare(
      `UPDATE spck_session_submissions SET approvedSnapshotJson = ? WHERE classId = ? AND studentId = 'GA38_1' AND sessionNumber = 12`
    ).run(JSON.stringify(prevAppSnap), v363Class6);

    currentPosterBytes = v4PosterBytes;
    const syncCollision6f = await syncClassStudentThumbnailsFromGoogleDrive({
      classId: v363Class6,
      sessionNumber: 13,
      forceRedownload: true,
      _testDriveProvider: testProvider,
    });
    assert.equal(syncCollision6f.failedCount, 0);
    assert.equal(
      crypto.createHash("sha256").update(fs.readFileSync(collidingSha8Path)).digest("hex"),
      collidingPreSha,
      "Colliding protected `<sha8>` file must NEVER be overwritten!"
    );
    const s13AfterCollision6f = spckSessionRepo.findOne(v363Class6, "GA38_1", 13)!;
    assert.equal(
      path.basename(s13AfterCollision6f.thumbnailPath || ""),
      `thumb_gdrive_GDRV_AN_NHIEN_001_${v4Sha16}.png`
    );

    // 6g. Capture-route junction rejection (403) + >20MB manual upload size cap (400)
    const capJuncStuDir = path.join(gaClassLocalDir, "Capture Junction Student");
    const capJuncVictim = path.join(gaClassLocalDir, "Capture Junction Victim");
    fs.mkdirSync(capJuncStuDir, { recursive: true });
    fs.mkdirSync(capJuncVictim, { recursive: true });
    fs.symlinkSync(
      capJuncVictim,
      path.join(capJuncStuDir, "_spck_owner_uploads"),
      process.platform === "win32" ? "junction" : "dir"
    );
    studentRepo.upsert({
      studentId: "GA38_CAPJ",
      classId: v363Class6,
      fullName: "Nguyễn Junction Test",
      isActive: 1,
    });
    spckUploadRepo.upsert({
      classId: v363Class6,
      studentId: "GA38_CAPJ",
      localFolderPath: capJuncStuDir,
      matchScore: 1,
      isConfirmedByTeacher: 1,
      projectTitle: "SPCK Junction",
      baseProjectTitle: "SPCK Junction",
      thumbnailPath: DEFAULT_SPCK_THUMBNAIL_PATH,
      screenshotsJson: "[]",
      attachmentsJson: "[]",
      youtubeUrlsJson: "[]",
      relatedLinksJson: "[]",
      teacherComment: "",
      contentHash: "",
      status: "DRAFT",
    });
    const capJunctionRes = await capturePost(
      localJsonRequest("http://127.0.0.1:3000/api/spck/capture-screenshots", {
        action: "upload_owner_image",
        classId: v363Class6,
        studentId: "GA38_CAPJ",
        sessionNumber: 13,
        role: "thumbnail",
        files: [
          {
            fileName: "valid.png",
            dataUrl: `data:image/png;base64,${manualUploadPng.toString("base64")}`,
          },
        ],
      })
    );
    assert.equal(capJunctionRes.status, 403, "Capture route must reject symlinked _spck_owner_uploads with 403!");
    assert.equal(fs.readdirSync(capJuncVictim).length, 0);
    fs.rmSync(capJuncStuDir, { recursive: true, force: true });

    const oversizedDataUrl = `data:image/png;base64,${"A".repeat(29 * 1024 * 1024)}`;
    const oversizedUploadRes = await capturePost(
      localJsonRequest("http://127.0.0.1:3000/api/spck/capture-screenshots", {
        action: "upload_owner_image",
        classId: v363Class6,
        studentId: "GA38_1",
        sessionNumber: 13,
        role: "thumbnail",
        files: [{ fileName: "huge.png", dataUrl: oversizedDataUrl }],
      })
    );
    assert.equal(oversizedUploadRes.status, 400, "Manual upload >20MB must return 400!");

    // 6h. Tier 2 bounded chunked streaming (no Content-Length) + untrusted redirect rejection
    let chunksSentByMock = 0;
    const chunkedServer = http.createServer((req, res) => {
      if (req.url === "/redirect-evil") {
        res.writeHead(302, { Location: "https://evil.example.com/steal.png" });
        res.end();
        return;
      }
      // Deliberately omit Content-Length -> Transfer-Encoding: chunked
      res.writeHead(200, { "Content-Type": "image/png" });
      let sent = 0;
      const chunk = Buffer.alloc(512 * 1024, 0x41);
      const timer = setInterval(() => {
        if (res.destroyed || sent >= 25) {
          clearInterval(timer);
          if (!res.destroyed) res.end();
          return;
        }
        chunksSentByMock++;
        sent++;
        res.write(chunk);
      }, 5);
    });
    await new Promise<void>((resolve) => chunkedServer.listen(0, "127.0.0.1", resolve));
    try {
      const port = (chunkedServer.address() as { port: number }).port;
      let evilCookieLookups = 0;
      const blockedEvilRes = await fetchBoundedGoogleDriveBufferWithCookies(
        `http://127.0.0.1:${port}/redirect-evil`,
        async (u) => {
          if (u.includes("evil.example.com")) evilCookieLookups++;
          return [{ name: "SID", value: "SECRET_COOKIE" }];
        },
        { maxBytes: 2 * 1024 * 1024, _allowTestHttpLocalhost: true }
      );
      assert.equal(blockedEvilRes, null);
      assert.equal(evilCookieLookups, 0, "Must never attach cookies for untrusted redirect origin!");

      const boundedAbortRes = await fetchBoundedGoogleDriveBufferWithCookies(
        `http://127.0.0.1:${port}/chunked-stream`,
        async () => [{ name: "SID", value: "SECRET_COOKIE" }],
        { maxBytes: 2 * 1024 * 1024, _allowTestHttpLocalhost: true }
      );
      assert.equal(boundedAbortRes, null, "Chunked stream exceeding maxBytes without Content-Length must abort and return null!");
      assert.ok(chunksSentByMock < 20, `Expected early stream cancellation before 25 chunks, saw ${chunksSentByMock}`);
    } finally {
      chunkedServer.close();
    }

    console.log("  -> PASS V363-06.");
    console.log("\n=== TẤT CẢ KIỂM THỬ v3.6.3 (V363-01 -> V363-06) ĐỀU PASS 100% ===");
  } finally {
    try {
      closeDb();
    } catch {}
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  }
}

runTests().catch((err) => {
  console.error("❌ FAIL test-drive-thumbnails-v363:", err);
  process.exit(1);
});
