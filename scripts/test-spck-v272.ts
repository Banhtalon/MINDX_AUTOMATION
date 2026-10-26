/**
 * MINDX AUTOMATION BOT - UPDATE v2.7.2 TEST SUITE (Owner Thumbnail priority, LMS-safe 960×540 captures,
 * Robotics YouTube playlist import with 2 presentation frames).
 *
 * V01: Image normalizer outputs exactly 960×540 for `contain` (App window) and `cover` (4:3 YouTube frame)
 * V02: Owner root photo detection (unreferenced `Demo.png` wins; code-referenced assets & tiny icons ignored)
 * V03: Scanner Thumbnail priority — Owner root photo beats auto App screenshot (thumbnailSource = OWNER_ROOT_PHOTO)
 * V04: Web capture — screenshots are 960×540, Owner `Demo.png` becomes Thumbnail, app shots go to gallery
 * V05: YouTube input parsing (mobile playlist, youtu.be, shorts, "Tên - link", invalid lines)
 * V06: Video title → student name extraction & matching (MATCHED / AMBIGUOUS / CONFLICT / UNMATCHED)
 * V07: Full /api/spck/import-youtube flow (mocked YouTube) — link + exactly 2 frames 960×540 in gallery,
 *      Thumbnail = Owner upload or MindX logo (never a YouTube frame), session draft synced
 * V08: Re-import replaces previous frames (no pile-up), keeps Owner Thumbnail, never alters a VERIFIED session
 * V09–V14: Regressions for Codex review findings V272-F01 ("Thế" name token), F07 (dynamic Python assets),
 *          F06 (YouTube frames never Thumbnail), F05 (all Owner photos in gallery), F02 (over-limit re-import
 *          keeps old frames), F09 (preview server blocks junctions outside the student folder)
 */

import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { POST as importYoutubePost } from "../src/app/api/spck/import-youtube/route";
import { POST as saveDraftPost } from "../src/app/api/spck/save-draft/route";
import {
  classSessionRepo,
  getDb,
  spckSessionRepo,
  spckUploadRepo,
  studentRepo,
} from "../src/lib/db/sqlite";
import {
  captureStudentAppScreenshots,
  resolveSafeStaticFile,
} from "../src/lib/local-files/spck-app-screenshotter";
import { normalizeImagesToLms16x9 } from "../src/lib/local-files/spck-image-normalizer";
import {
  DEFAULT_SPCK_THUMBNAIL_PATH,
  extractImageDimensionsFromBuffer,
  findOwnerProvidedRootPhotos,
  scanStudentSpckFolder,
} from "../src/lib/local-files/spck-scanner";
import {
  extractStudentNameFromVideoTitle,
  matchYoutubeVideosToStudents,
  parseYoutubeImportInput,
} from "../src/lib/local-files/spck-youtube-import";

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, c]);
}
/** Valid PNG; `noisy` produces incompressible pixels so the file is large like a real photo. */
function makePng(width: number, height: number, seed = 0, noisy = false): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rowBytes = 1 + width * 3;
  const raw = noisy ? crypto.randomBytes(rowBytes * height) : Buffer.alloc(rowBytes * height, seed & 0xff);
  for (let y = 0; y < height; y++) raw[y * rowBytes] = 0;
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function dimsOf(p: string) {
  return extractImageDimensionsFromBuffer(fs.readFileSync(p), path.extname(p));
}
function req(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
    body: JSON.stringify(body),
  });
}

async function run() {
  console.log("=== KIỂM THỬ CẬP NHẬT SPCK v2.7.2 (V01 -> V14) ===");
  const db = getDb();
  const classId = "TEST_V272_SB28";
  const tempRoot = path.resolve(process.cwd(), "temp_submissions", "test_spck_v272");
  const managedYtRoot = path.resolve(process.cwd(), "data", "spck_youtube", classId);
  const cleanup = () => {
    db.prepare(`DELETE FROM spck_session_submissions WHERE classId = ?`).run(classId);
    db.prepare(`DELETE FROM spck_uploads WHERE classId = ?`).run(classId);
    db.prepare(`DELETE FROM students WHERE classId = ?`).run(classId);
    db.prepare(`DELETE FROM classes_sessions WHERE classId = ?`).run(classId);
    for (const d of [tempRoot, managedYtRoot]) {
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    }
  };
  cleanup();
  fs.mkdirSync(tempRoot, { recursive: true });
  const origFetch = globalThis.fetch;

  try {
    // V01
    console.log("\n[V01] Chuẩn hóa ảnh về 960×540...");
    const norm = await normalizeImagesToLms16x9([
      { buffer: makePng(800, 600, 90), fit: "contain" },
      { buffer: makePng(640, 480, 150), fit: "cover" },
    ]);
    for (const b of norm) {
      assert.ok(b, "Ảnh chuẩn hóa không được null");
      const d = extractImageDimensionsFromBuffer(b!, ".png");
      assert.deepStrictEqual(d, { width: 960, height: 540 }, "Ảnh chuẩn hóa phải đúng 960×540");
    }
    console.log("  -> PASS V01.");

    // V02 + V03
    console.log("\n[V02 & V03] Nhận diện ảnh Owner để sẵn & ưu tiên làm Thumbnail...");
    const webDir = path.join(tempRoot, "Le Minh Tri");
    fs.mkdirSync(path.join(webDir, "_spck_app_shots"), { recursive: true });
    fs.writeFileSync(
      path.join(webDir, "index.html"),
      `<!DOCTYPE html><html><head><style>
        body{margin:0;font-family:sans-serif;background:#111;color:#fff}
        .hero{height:100vh;display:flex;align-items:center;padding:0 5%;background:#234}
        .hero h1{font-size:64px;opacity:0;animation:fadeIn 4s ease forwards}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        section{height:900px;padding:40px;background:#345}
      </style></head><body>
        <header><img src="logo.png" alt="logo"></header>
        <div class="hero"><h1>Trang chủ sản phẩm</h1></div>
        <section><h2>Giới thiệu</h2></section>
      </body></html>`
    );
    fs.writeFileSync(path.join(webDir, "logo.png"), makePng(400, 300, 30));
    fs.writeFileSync(path.join(webDir, "icon.png"), makePng(64, 64, 40));
    fs.writeFileSync(path.join(webDir, "Demo.png"), makePng(1280, 720, 0, true));
    fs.writeFileSync(path.join(webDir, "_spck_app_shots", "app_01_index_aaaaaa.png"), makePng(960, 540, 70));
    const ownerRoot = findOwnerProvidedRootPhotos(webDir);
    assert.deepStrictEqual(
      ownerRoot.map((p) => path.basename(p)),
      ["Demo.png"],
      "Chỉ Demo.png (không dùng trong code, không phải icon) được coi là ảnh Owner"
    );
    const pkg = scanStudentSpckFolder(webDir, "Lê Minh Trí");
    assert.strictEqual(path.basename(pkg.thumbnailPath), "Demo.png", "Ảnh Owner phải làm Thumbnail");
    assert.strictEqual(pkg.thumbnailSource, "OWNER_ROOT_PHOTO");
    assert.ok(
      pkg.screenshots.some((s) => s.includes("_spck_app_shots")),
      "Ảnh chụp giao diện phải nằm trong ảnh bổ sung"
    );
    console.log("  -> PASS V02 & V03.");

    // V04
    console.log("\n[V04] Chụp giao diện Web 960×540 & Thumbnail ảnh Owner...");
    const cap = await captureStudentAppScreenshots({
      studentId: "STU_V272_WEB",
      folderPath: webDir,
      useAiVision: false,
    });
    assert.strictEqual(path.basename(cap.thumbnailPath), "Demo.png");
    assert.strictEqual(cap.thumbnailSource, "OWNER_ROOT_PHOTO");
    const appShots = cap.galleryScreenshots.filter((g) => g.includes("_spck_app_shots"));
    assert.ok(appShots.length >= 1, "Phải có ít nhất 1 ảnh giao diện trong ảnh bổ sung");
    for (const s of appShots) {
      assert.deepStrictEqual(dimsOf(s), { width: 960, height: 540 }, `Ảnh ${path.basename(s)} phải 960×540`);
    }
    assert.ok(!cap.galleryScreenshots.includes(cap.thumbnailPath), "Thumbnail không lặp lại trong ảnh bổ sung");
    console.log("  -> PASS V04.");

    // V05
    console.log("\n[V05] Đọc nội dung dán link YouTube...");
    const parsed = parseYoutubeImportInput(
      [
        "https://m.youtube.com/playlist?list=PLdFU7_SaLSPU&si=v-Qk6NFgQAm1pdTS",
        "Minh Khang - https://youtu.be/AAAAAAAAAAA",
        "https://www.youtube.com/shorts/BBBBBBBBBBB",
        "dòng không có link",
      ].join("\n")
    );
    assert.deepStrictEqual(parsed.playlistIds, ["PLdFU7_SaLSPU"]);
    assert.strictEqual(parsed.videos.length, 2);
    assert.strictEqual(parsed.videos[0].videoId, "AAAAAAAAAAA");
    assert.strictEqual(parsed.videos[0].nameHint, "Minh Khang");
    assert.strictEqual(parsed.videos[1].videoId, "BBBBBBBBBBB");
    assert.deepStrictEqual(parsed.invalidLines, ["dòng không có link"]);
    console.log("  -> PASS V05.");

    // V06
    console.log("\n[V06] Tách tên học viên từ tiêu đề video & khớp danh sách lớp...");
    assert.strictEqual(extractStudentNameFromVideoTitle("SB28-Gia Bách", "VT-C4K-SB28"), "gia bach");
    assert.strictEqual(extractStudentNameFromVideoTitle("Minh Phi - SB28", "VT-C4K-SB28"), "minh phi");
    assert.strictEqual(
      extractStudentNameFromVideoTitle("Sản phẩm cuối khóa - Bảo Hân SB28", "VT-C4K-SB28"),
      "bao han"
    );
    const roster = [
      { studentId: "S1", fullName: "Nguyễn Gia Bách" },
      { studentId: "S2", fullName: "Trần Minh Phi" },
      { studentId: "S3", fullName: "Lê Bảo Hân" },
      { studentId: "S4", fullName: "Phạm Việt Anh" },
      { studentId: "S5", fullName: "Đỗ Tuấn Anh" },
      { studentId: "S6", fullName: "Hoàng Minh Quang" },
    ];
    const vids = [
      { videoId: "v1xxxxxxxxx", url: "u1", title: "SB28-Gia Bách" },
      { videoId: "v2xxxxxxxxx", url: "u2", title: "Anh - SB28" },
      { videoId: "v3xxxxxxxxx", url: "u3", title: "Minh Quang SB28" },
      { videoId: "v4xxxxxxxxx", url: "u4", title: "Quang SB28" },
      { videoId: "v5xxxxxxxxx", url: "u5", title: "Nguyễn Văn Tèo SB28" },
      { videoId: "v6xxxxxxxxx", url: "u6", title: "Video lớp", nameHint: "Bảo Hân" },
    ];
    const ms = matchYoutubeVideosToStudents(vids, roster, "VT-C4K-SB28");
    const st = (id: string) => ms.find((m) => m.videoId === id)!;
    assert.strictEqual(st("v1xxxxxxxxx").status, "MATCHED");
    assert.strictEqual(st("v1xxxxxxxxx").studentId, "S1");
    assert.strictEqual(st("v2xxxxxxxxx").status, "AMBIGUOUS", "'Anh' trùng 2 học viên phải báo AMBIGUOUS");
    assert.strictEqual(st("v3xxxxxxxxx").status, "CONFLICT", "2 video cùng khớp 1 học viên phải báo CONFLICT");
    assert.strictEqual(st("v4xxxxxxxxx").status, "CONFLICT");
    assert.strictEqual(st("v5xxxxxxxxx").status, "UNMATCHED");
    assert.strictEqual(st("v6xxxxxxxxx").status, "MATCHED", "Tên ghi trước link phải được ưu tiên");
    assert.strictEqual(st("v6xxxxxxxxx").studentId, "S3");
    console.log("  -> PASS V06.");

    // V07
    console.log("\n[V07] Nhập Playlist YouTube trọn gói qua /api/spck/import-youtube...");
    for (const n of [12, 13, 14] as const) {
      classSessionRepo.upsert({
        sessionId: `${classId}_S${n}`,
        classId,
        className: `Lớp ${classId}`,
        sessionNumber: n,
        topic: `Buổi ${n}`,
        date: `2026-10-${10 + n}`,
      });
    }
    for (const s of roster.slice(0, 3)) {
      studentRepo.upsert({ classId, studentId: s.studentId, fullName: s.fullName, isActive: 1 });
    }
    studentRepo.upsert({ classId, studentId: "S7", fullName: "Vũ Hoài Nam", isActive: 1 });

    // Minh Phi already has a folder with an Owner thumbnail upload
    const phiDir = path.join(tempRoot, "Tran Minh Phi");
    fs.mkdirSync(path.join(phiDir, "_spck_owner_uploads"), { recursive: true });
    const phiThumb = path.join(phiDir, "_spck_owner_uploads", "thumb_1_phi.png");
    fs.writeFileSync(phiThumb, makePng(1280, 720, 0, true));
    spckUploadRepo.upsert({
      classId,
      studentId: "S2",
      localFolderPath: phiDir,
      matchScore: 1,
      isConfirmedByTeacher: 1,
      projectTitle: "SPCK Trần Minh Phi",
      thumbnailPath: phiThumb,
      screenshotsJson: "[]",
      attachmentsJson: "[]",
      youtubeUrlsJson: "[]",
      relatedLinksJson: "[]",
      teacherComment: "",
      contentHash: "",
      status: "DRAFT",
    });

    const playlistData = {
      header: { pageHeaderRenderer: { pageTitle: classId } },
      contents: {
        twoColumnBrowseResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                content: {
                  sectionListRenderer: {
                    contents: [
                      {
                        itemSectionRenderer: {
                          contents: [
                            ["Bach1234567", "SB28-Gia Bách"],
                            ["MinhPhi1234", "Minh Phi - SB28"],
                            ["BaoHan12345", "Bảo Hân - SB28"],
                          ].map(([id, title]) => ({
                            lockupViewModel: {
                              contentId: id,
                              contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
                              metadata: { lockupMetadataViewModel: { title: { content: title } } },
                            },
                          })),
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    };
    const frameCache = new Map<string, Buffer>();
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = String(typeof input === "string" ? input : input?.url || input);
      if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) {
        return origFetch(input, init);
      }
      if (url.includes("youtube.com/playlist")) {
        const html = `<html><script>var ytInitialData = ${JSON.stringify(playlistData)};</script></html>`;
        return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      }
      if (url.includes("youtube.com/oembed")) {
        return new Response(JSON.stringify({ title: "Video" }), { status: 200 });
      }
      const m = url.match(/i\.ytimg\.com\/vi\/([^/]+)\/(maxres[13])\.jpg/);
      if (m) {
        const key = `${m[1]}_${m[2]}`;
        if (!frameCache.has(key)) frameCache.set(key, makePng(1280, 720, 0, true));
        return new Response(new Uint8Array(frameCache.get(key)!), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const resp = await importYoutubePost(
      req("http://127.0.0.1:3000/api/spck/import-youtube", {
        classId,
        sessionNumber: 14,
        input: "https://m.youtube.com/playlist?list=PLtestV272list&si=abc",
      })
    );
    const json = await resp.json();
    assert.strictEqual(resp.status, 200, `import-youtube phải trả về HTTP 200 (error=${json.error})`);
    const ir = json.importResult;
    assert.strictEqual(ir.totalVideos, 3);
    assert.strictEqual(ir.appliedCount, 3, "Cả 3 video phải được gắn đúng học viên");
    assert.deepStrictEqual(
      ir.studentsWithoutVideo.map((s: any) => s.studentId),
      ["S7"],
      "Phải báo học viên chưa có video"
    );

    const checkStudent = (studentId: string, videoId: string, expectThumb: string) => {
      const rec = spckUploadRepo.findOne(classId, studentId)!;
      assert.ok(rec, `Phải tạo hồ sơ SPCK cho ${studentId}`);
      assert.deepStrictEqual(JSON.parse(rec.youtubeUrlsJson || "[]"), [
        `https://www.youtube.com/watch?v=${videoId}`,
      ]);
      const shots: string[] = JSON.parse(rec.screenshotsJson || "[]");
      const frames = shots.filter((s) => s.includes("_spck_youtube_frames"));
      assert.strictEqual(frames.length, 2, `${studentId} phải có đúng 2 ảnh thuyết trình`);
      for (const f of frames) {
        assert.ok(fs.existsSync(f));
        assert.deepStrictEqual(dimsOf(f), { width: 960, height: 540 });
      }
      assert.strictEqual(rec.thumbnailPath, expectThumb, `${studentId} sai ảnh đại diện`);
      assert.ok(!rec.thumbnailPath.includes("_spck_youtube_frames"), "Không được lấy ảnh YouTube làm Thumbnail");
      const sess = spckSessionRepo.findOne(classId, studentId, 14)!;
      assert.ok(sess, "Phải có bản nháp Buổi 14");
      assert.deepStrictEqual(JSON.parse(sess.youtubeUrlsJson), [`https://www.youtube.com/watch?v=${videoId}`]);
      assert.strictEqual(
        JSON.parse(sess.screenshotsJson).filter((s: string) => s.includes("_spck_youtube_frames")).length,
        2,
        "Bản nháp Buổi 14 phải nhận 2 ảnh thuyết trình"
      );
      assert.strictEqual(sess.thumbnailPath, expectThumb);
      return frames;
    };
    const bachFrames = checkStudent("S1", "Bach1234567", DEFAULT_SPCK_THUMBNAIL_PATH);
    checkStudent("S2", "MinhPhi1234", phiThumb);
    checkStudent("S3", "BaoHan12345", DEFAULT_SPCK_THUMBNAIL_PATH);
    assert.strictEqual(
      spckUploadRepo.findOne(classId, "S1")!.projectTitle,
      "SPCK Nguyễn Gia Bách",
      "Tiêu đề mặc định phải là 'SPCK <Họ Tên>'"
    );
    console.log("  -> PASS V07.");

    // V08
    console.log("\n[V08] Nhập lại không bị dồn ảnh cũ & giữ ảnh đại diện Owner...");
    frameCache.clear();
    const resp2 = await importYoutubePost(
      req("http://127.0.0.1:3000/api/spck/import-youtube", {
        classId,
        sessionNumber: 14,
        input: "https://www.youtube.com/playlist?list=PLtestV272list",
      })
    );
    assert.strictEqual(resp2.status, 200);
    const bachRec = spckUploadRepo.findOne(classId, "S1")!;
    const framesDir = path.dirname(JSON.parse(bachRec.screenshotsJson || "[]")[0]);
    const filesInDir = fs.readdirSync(framesDir).filter((f) => f.startsWith("yt_"));
    assert.strictEqual(filesInDir.length, 2, "Thư mục ảnh YouTube chỉ giữ 2 ảnh mới nhất");
    assert.ok(bachFrames.every((f) => !fs.existsSync(f)), "Ảnh cũ không được tham chiếu phải được dọn");
    assert.strictEqual(spckUploadRepo.findOne(classId, "S2")!.thumbnailPath, phiThumb);

    // Already submitted (VERIFIED) session must never be altered by a later re-import
    db.prepare(
      `UPDATE spck_session_submissions
       SET lastVerifiedAt = datetime('now', 'localtime'), lastAttemptStatus = 'VERIFIED',
           lastVerifiedSnapshotJson = json_object('screenshots', screenshotsJson)
       WHERE classId = ? AND studentId = ? AND sessionNumber = 14`
    ).run(classId, "S3");
    const hanBefore = spckSessionRepo.findOne(classId, "S3", 14)!;
    const hanFramesBefore: string[] = JSON.parse(hanBefore.screenshotsJson);
    frameCache.clear();
    const resp3 = await importYoutubePost(
      req("http://127.0.0.1:3000/api/spck/import-youtube", {
        classId,
        sessionNumber: 14,
        input: "https://www.youtube.com/playlist?list=PLtestV272list",
      })
    );
    const json3 = await resp3.json();
    assert.strictEqual(resp3.status, 200);
    const hanAfter = spckSessionRepo.findOne(classId, "S3", 14)!;
    assert.strictEqual(
      hanAfter.screenshotsJson,
      hanBefore.screenshotsJson,
      "Buổi đã nộp (VERIFIED) không được bị thay ảnh khi nhập lại"
    );
    assert.ok(hanFramesBefore.every((f) => fs.existsSync(f)), "Ảnh của bản đã nộp phải được giữ trên ổ cứng");
    const hanResult = json3.importResult.results.find((r: any) => r.studentId === "S3");
    assert.strictEqual(hanResult.syncedToSession, false, "Phải báo chưa áp dụng vào buổi đã nộp");
    console.log("  -> PASS V08.");

    // ===================== Regression for Codex review findings (V272-F01..F09) =====================
    // V09 (F01): name tokens like "Thế" must not be stripped — full name match wins
    console.log("\n[V09] (F01) Không cắt chữ 'Thế' khỏi tên — khớp đúng họ tên đầy đủ...");
    const rosterF01 = [
      { studentId: "T1", fullName: "Nguyễn Văn Thế Anh" },
      { studentId: "T2", fullName: "Nguyễn Văn Anh" },
    ];
    const msF01 = matchYoutubeVideosToStudents(
      [
        { videoId: "f01aaaaaaaa", url: "a", title: "SPCK Nguyễn Văn Thế Anh - SB28" },
        { videoId: "f01bbbbbbbb", url: "b", title: "Nguyễn Văn Anh SB28" },
      ],
      rosterF01,
      "VT-C4K-SB28"
    );
    assert.strictEqual(msF01[0].status, "MATCHED");
    assert.strictEqual(msF01[0].studentId, "T1", "Video 'Nguyễn Văn Thế Anh' phải gắn cho Thế Anh");
    assert.strictEqual(msF01[1].status, "MATCHED");
    assert.strictEqual(msF01[1].studentId, "T2", "Video 'Nguyễn Văn Anh' phải gắn cho Văn Anh");
    console.log("  -> PASS V09.");

    // V10 (F07 + R2-02): images loaded dynamically by Python code (including split string variables) must not be treated as Owner photos
    console.log("\n[V10] (F07 + R2-02) Ảnh dùng động trong code Python (kể cả ghép biến) không bị nhận nhầm là ảnh Owner...");
    const pyDir = path.join(tempRoot, "Python App");
    fs.mkdirSync(pyDir, { recursive: true });
    fs.writeFileSync(
      path.join(pyDir, "main.py"),
      'from PyQt6 import QtGui\nname = "ban" + "ner"\npix = QtGui.QPixmap(name + ".png")\nbg = load(other + ".png")\n'
    );
    fs.writeFileSync(path.join(pyDir, "banner.png"), makePng(800, 600, 11));
    fs.writeFileSync(path.join(pyDir, "bg_forest.png"), makePng(1000, 600, 12));
    fs.writeFileSync(path.join(pyDir, "Demo_thuyet_trinh.png"), makePng(1280, 720, 0, true));
    assert.deepStrictEqual(
      findOwnerProvidedRootPhotos(pyDir).map((p) => path.basename(p)),
      ["Demo_thuyet_trinh.png"],
      "Chỉ ảnh có dấu hiệu do Owner chụp mới được nhận; banner (ghép biến động) và bg_forest (dự án có code) bị loại"
    );
    console.log("  -> PASS V10.");

    // V11 (F06): Robotics folder with only YouTube frames → Thumbnail = MindX logo, frames stay in gallery
    console.log("\n[V11] (F06) Thư mục chỉ có ảnh YouTube: Thumbnail là Logo MindX, ảnh YouTube ở ảnh bổ sung...");
    const robDir = path.join(tempRoot, "Robot Only");
    fs.mkdirSync(path.join(robDir, "_spck_youtube_frames"), { recursive: true });
    fs.writeFileSync(path.join(robDir, "_spck_youtube_frames", "yt_abcdefghijk_1_aaaaaa.png"), makePng(960, 540, 50));
    fs.writeFileSync(path.join(robDir, "_spck_youtube_frames", "yt_abcdefghijk_2_bbbbbb.png"), makePng(960, 540, 60));
    const robPkg = scanStudentSpckFolder(robDir, "Robot Only");
    assert.strictEqual(robPkg.thumbnailSource, "DEFAULT_LOGO");
    assert.ok(!robPkg.thumbnailPath.includes("_spck_youtube_frames"), "Không được lấy ảnh YouTube làm Thumbnail");
    assert.strictEqual(
      robPkg.screenshots.filter((s) => s.includes("_spck_youtube_frames")).length,
      2,
      "2 ảnh YouTube phải nằm trong ảnh bổ sung"
    );
    console.log("  -> PASS V11.");

    // V12 (F05): every Owner root photo goes into the YouTube-import gallery
    console.log("\n[V12] (F05) Nhập YouTube: mọi ảnh Owner để sẵn đều vào ảnh bổ sung...");
    const hanDir = path.join(tempRoot, "Le Bao Han");
    fs.mkdirSync(hanDir, { recursive: true });
    fs.writeFileSync(path.join(hanDir, "Demo.png"), makePng(1280, 720, 0, true));
    fs.writeFileSync(path.join(hanDir, "Presentation.png"), makePng(1200, 700, 0, true));
    studentRepo.upsert({ classId, studentId: "S8", fullName: "Đinh Thu Trang", isActive: 1 });
    spckUploadRepo.upsert({
      classId,
      studentId: "S8",
      localFolderPath: hanDir,
      matchScore: 1,
      isConfirmedByTeacher: 1,
      projectTitle: "SPCK Đinh Thu Trang",
      thumbnailPath: DEFAULT_SPCK_THUMBNAIL_PATH,
      screenshotsJson: "[]",
      attachmentsJson: "[]",
      youtubeUrlsJson: "[]",
      relatedLinksJson: "[]",
      teacherComment: "",
      contentHash: "",
      status: "DRAFT",
    });
    frameCache.clear();
    const respF05 = await importYoutubePost(
      req("http://127.0.0.1:3000/api/spck/import-youtube", {
        classId,
        sessionNumber: 13,
        input: "Thu Trang - https://youtu.be/TrangVideo1",
      })
    );
    assert.strictEqual(respF05.status, 200);
    const trangRec = spckUploadRepo.findOne(classId, "S8")!;
    assert.strictEqual(path.basename(trangRec.thumbnailPath || ""), "Demo.png");
    const trangShots: string[] = JSON.parse(trangRec.screenshotsJson || "[]");
    assert.ok(
      trangShots.some((s) => path.basename(s) === "Presentation.png"),
      "Ảnh Owner thứ 2 (Presentation.png) phải nằm trong ảnh bổ sung"
    );
    assert.strictEqual(trangShots.filter((s) => s.includes("_spck_youtube_frames")).length, 2);
    console.log("  -> PASS V12.");

    // V13 (F02): over-limit re-import must fail WITHOUT deleting the previous frames
    console.log("\n[V13] (F02) Nhập lại vượt giới hạn ảnh: báo lỗi và GIỮ NGUYÊN ảnh cũ...");
    const bachBefore = spckUploadRepo.findOne(classId, "S1")!;
    const bachOldFrames: string[] = JSON.parse(bachBefore.screenshotsJson || "[]").filter((s: string) =>
      s.includes("_spck_youtube_frames")
    );
    const bachOwnerDir = path.join(bachBefore.localFolderPath || "", "_spck_owner_uploads");
    fs.mkdirSync(bachOwnerDir, { recursive: true });
    for (let i = 0; i < 9; i++) {
      fs.writeFileSync(path.join(bachOwnerDir, `owner_${i}.png`), makePng(640, 360, 20 + i));
    }
    fs.writeFileSync(path.join(bachOwnerDir, "thumb_bach.png"), makePng(1280, 720, 99));
    frameCache.clear();
    const respF02 = await importYoutubePost(
      req("http://127.0.0.1:3000/api/spck/import-youtube", {
        classId,
        sessionNumber: 14,
        input: "https://www.youtube.com/playlist?list=PLtestV272list",
      })
    );
    const jsonF02 = await respF02.json();
    const bachRes = jsonF02.importResult.results.find((r: any) => r.studentId === "S1");
    assert.strictEqual(bachRes.applied, false, "Vượt giới hạn 10 ảnh phải báo không áp dụng");
    assert.ok(bachOldFrames.every((f) => fs.existsSync(f)), "Ảnh YouTube cũ phải được giữ nguyên trên ổ cứng");
    assert.strictEqual(
      spckUploadRepo.findOne(classId, "S1")!.screenshotsJson,
      bachBefore.screenshotsJson,
      "Dữ liệu ảnh trong kho chung không được thay đổi khi nhập lỗi"
    );
    console.log("  -> PASS V13.");

    // V14 (F09): the local website preview server must not follow a junction outside the student folder
    console.log("\n[V14] (F09) Máy chủ xem trước Web chặn liên kết thư mục trỏ ra ngoài...");
    const outsideDir = path.join(tempRoot, "outside_secret");
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, "secret.txt"), "SECRET");
    const junctionPath = path.join(webDir, "leak");
    fs.symlinkSync(outsideDir, junctionPath, "junction");
    const okRes = resolveSafeStaticFile(webDir, "/index.html");
    assert.ok(okRes.ok, "File hợp lệ trong thư mục học viên phải đọc được");
    const leakRes = resolveSafeStaticFile(webDir, "/leak/secret.txt");
    assert.deepStrictEqual(leakRes, { ok: false, status: 403 }, "File ngoài thư mục qua junction phải bị chặn 403");
    const travRes = resolveSafeStaticFile(webDir, "/../outside_secret/secret.txt");
    assert.strictEqual(travRes.ok, false, "Đường dẫn ../ ra ngoài phải bị chặn");
    fs.rmSync(junctionPath, { recursive: false, force: true });
    console.log("  -> PASS V14.");

    // V15 (R2-03): when DB write throws an exception during YouTube import, newly created frame files are rolled back
    console.log("\n[V15] (R2-03) Lỗi ngoại lệ khi ghi DB trong lúc nhập YouTube phải dọn sạch ảnh mới tạo trên đĩa...");
    const trangBeforeErr = spckUploadRepo.findOne(classId, "S8")!;
    const trangFramesDir = path.join(hanDir, "_spck_youtube_frames");
    const trangOldFrameFiles = fs.readdirSync(trangFramesDir).filter((f) => f.startsWith("yt_"));
    assert.strictEqual(trangOldFrameFiles.length, 2, "Trước khi test lỗi phải có 2 ảnh cũ của S8");
    const origUpdateShared = spckUploadRepo.updateSharedResources.bind(spckUploadRepo);
    spckUploadRepo.updateSharedResources = ((params: any, ...rest: any[]) => {
      const sid = typeof params === "string" ? rest[0] : params?.studentId;
      if (sid === "S8") {
        throw new Error("Simulated SQLite write exception for S8");
      }
      return (origUpdateShared as any)(params, ...rest);
    }) as typeof spckUploadRepo.updateSharedResources;
    try {
      frameCache.clear();
      const respErr = await importYoutubePost(
        req("http://127.0.0.1:3000/api/spck/import-youtube", {
          classId,
          sessionNumber: 13,
          input: "Thu Trang - https://youtu.be/TrangFail99",
        })
      );
      const jsonErr = await respErr.json();
      const s8Res = jsonErr.importResult.results.find((r: any) => r.studentId === "S8");
      assert.strictEqual(s8Res.applied, false, "Khi ghi DB ném lỗi phải báo applied=false");
      const filesAfterErr = fs.readdirSync(trangFramesDir).filter((f) => f.startsWith("yt_"));
      assert.deepStrictEqual(
        filesAfterErr.sort(),
        trangOldFrameFiles.sort(),
        "Hai ảnh mới tạo của TrangFail99 phải được xóa sạch, chỉ giữ 2 ảnh cũ đang được tham chiếu"
      );
      assert.strictEqual(
        spckUploadRepo.findOne(classId, "S8")!.screenshotsJson,
        trangBeforeErr.screenshotsJson,
        "Dữ liệu DB của S8 phải giữ nguyên sau ngoại lệ"
      );
    } finally {
      spckUploadRepo.updateSharedResources = origUpdateShared;
    }
    console.log("  -> PASS V15.");

    // V16 (R2-01): out-of-order (stale) import response must never downgrade draftVersion or cause HTTP 409 on next save
    console.log("\n[V16] (R2-01) Phản hồi nhập YouTube đến muộn không kéo lùi draftVersion hay gây lỗi HTTP 409 khi lưu tiếp...");
    const pageSrc = fs.readFileSync(
      path.join(process.cwd(), "src", "app", "final-project", "page.tsx"),
      "utf8"
    );
    assert.ok(
      pageSrc.includes("if (currentVersion > 0 && freshVersion < currentVersion)"),
      "page.tsx phải chặn phản hồi nhập YouTube có freshVersion < currentVersion"
    );
    // Simulate: import response captured at version 2 while a newer save bumped session draft to version 3
    const s2DraftBefore = spckSessionRepo.getOrInitSessionDraft(classId, "S2", 14, "Trần Minh Phi");
    const staleImportVersion = s2DraftBefore.draftVersion;
    const save1 = await saveDraftPost(
      req("http://127.0.0.1:3000/api/spck/save-draft", {
        classId,
        studentId: "S2",
        sessionNumber: 14,
        expectedVersion: staleImportVersion,
        teacherComment: "Nhận xét mới lưu ở phiên bản cao hơn",
      })
    );
    const save1Json = await save1.json();
    assert.strictEqual(save1.status, 200, "Lần lưu 1 phải thành công");
    const newerVersion: number = save1Json.sessionDraft.draftVersion;
    assert.ok(newerVersion > staleImportVersion, "Sau khi lưu, draftVersion phải tăng lên");

    // Apply the exact merge rule from page.tsx when the late import response (staleImportVersion) arrives after newerVersion
    const currentRow = {
      assignedStudentId: "S2",
      folderPath: phiDir,
      isConfirmedByTeacher: true,
      thumbnailPath: phiThumb,
      screenshots: [] as string[],
      youtubeUrlsText: "https://www.youtube.com/watch?v=MinhPhi1234",
      teacherComment: "Nhận xét mới lưu ở phiên bản cao hơn",
      draftVersion: newerVersion,
      hasNewerSharedResources: false,
    };
    const lateFreshRow = {
      folderPath: phiDir,
      isConfirmedByTeacher: true,
      thumbnailPath: phiThumb,
      screenshots: ["new_yt_1.png", "new_yt_2.png"],
      youtubeUrlsText: "https://www.youtube.com/watch?v=MinhPhi1234",
      draftVersion: staleImportVersion,
      hasNewerSharedResources: false,
    };
    const mergedRow =
      currentRow.draftVersion > 0 && lateFreshRow.draftVersion < currentRow.draftVersion
        ? {
            ...currentRow,
            draftVersion: currentRow.draftVersion,
            hasNewerSharedResources:
              currentRow.hasNewerSharedResources ||
              currentRow.thumbnailPath !== lateFreshRow.thumbnailPath ||
              currentRow.youtubeUrlsText !== lateFreshRow.youtubeUrlsText ||
              JSON.stringify(currentRow.screenshots) !== JSON.stringify(lateFreshRow.screenshots),
          }
        : { ...currentRow, draftVersion: lateFreshRow.draftVersion };
    assert.strictEqual(mergedRow.draftVersion, newerVersion, "Không được hạ draftVersion về bản cũ");
    assert.strictEqual(mergedRow.hasNewerSharedResources, true, "Phải bật cờ đồng bộ tài nguyên mới");

    const save2 = await saveDraftPost(
      req("http://127.0.0.1:3000/api/spck/save-draft", {
        classId,
        studentId: "S2",
        sessionNumber: 14,
        expectedVersion: mergedRow.draftVersion,
        teacherComment: "Nhận xét lưu tiếp sau khi phản hồi muộn đến",
      })
    );
    assert.strictEqual(save2.status, 200, "Lần lưu tiếp theo phải đạt HTTP 200, không bị HTTP 409");
    console.log("  -> PASS V16.");

    console.log("\n=== HOÀN TẤT: TẤT CẢ 16 KỊCH BẢN v2.7.2 (V01 -> V16) ĐỀU ĐẠT 100% ===");
  } finally {
    globalThis.fetch = origFetch;
    cleanup();
  }
}

run().catch((err) => {
  console.error("KIỂM THỬ v2.7.2 THẤT BẠI:", err);
  process.exit(1);
});
