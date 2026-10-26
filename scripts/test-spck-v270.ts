/**
 * MINDX AUTOMATION BOT - UPDATE v2.7.0 COMPREHENSIVE TEST SUITE (T01 - T16)
 * Verifies all 16 mandatory scenarios for Session 12 / 13 / 14 Stage-Based SPCK Workflow:
 * T01: Per-session separation (titles with stage suffixes & independent comments for 12, 13, 14)
 * T02: History preservation across draft edits, folder rescans, app screenshots, Drive & Web deploy
 * T03: Session switching title suffix replacement (no duplication) & >100 char rejection without silent truncation
 * T04: No fabricated Session 12 comparison when prior data is missing & preserve existing comment on INSUFFICIENT_INFO
 * T05: No fabricated presentation or teamwork claims when evidence is absent
 * T06: Session switch during in-flight save/AI does not overwrite the newly selected session
 * T07: Optimistic locking (expectedVersion HTTP 409 conflict) & background shared resources require explicit "Dùng tài nguyên mới nhất"
 * T08: Legacy history ("Chưa xác định" preserved even after editing/submitting Session 14) & Corrupted JSON history ("Cần kiểm tra")
 * T09: Strict per-session approval & contentHash verification (editing after approve demotes; approving S12 cannot submit S13)
 * T10: Failed re-upload preserves previous verified snapshot & evidence ("Lỗi nộp lại (Có bản cũ ✓)")
 * T11: File byte SHA-256 drift detection after VERIFIED ("Tệp gốc đã đổi") without losing submitted text snapshot
 * T12: Only 3 required (*) fields (Title*, Thumbnail*, Teacher Comment*); optional fields validated when present without silent slicing
 * T13: Thumbnail inspection (Default MindX Logo vs 16:9 vs non-16:9) & Related Link classification (DIRECT_PRODUCT_USE vs SOURCE_OR_FILE_STORAGE)
 * T14: Full support for PTB and CSB classes (no SPCK exemption; optional Drive/Demo tools never borrow PTA config or block LMS flow)
 * T15: Complete batch submission reporting (verified + skipped + failed counts, reasons, retry list)
 * T16: Folder reassignment from Student A to Student B detaches A without deleting A's verified history & blocks stale background overwrites
 */

import assert from "node:assert";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { chromium } from "playwright";
import { GET as listGet, buildEnrichedClassSpckRecords } from "../src/app/api/spck/list/route";
import { POST as scanPost } from "../src/app/api/spck/scan/route";
import { POST as saveDraftPost } from "../src/app/api/spck/save-draft/route";
import { POST as approvePost } from "../src/app/api/spck/approve/route";
import { POST as uploadLmsPost } from "../src/app/api/spck/upload-lms/route";
import { POST as generateAiPost } from "../src/app/api/spck/generate-ai/route";
import { POST as captureScreenshotsPost } from "../src/app/api/spck/capture-screenshots/route";
import {
  classSessionRepo,
  computeSafeFileByteDigest,
  formatSpckSessionTitle,
  getDb,
  getSpckStageInfo,
  isDefaultSpckProductTitle,
  migrateSpckSessionSubmissions,
  spckSessionRepo,
  spckUploadRepo,
  stripSpckSessionSuffix,
  studentRepo,
  validateSpckTitleLength,
} from "../src/lib/db/sqlite";
import {
  SpckCommentGenerator,
  extractSession12PriorEvidence,
} from "../src/lib/gemini/spck-comment";
import {
  classifySpckRelatedLink,
  getDefaultMindxLogoThumbnailPath,
  inspectSpckThumbnail,
  validateSpckResourceLimits,
} from "../src/lib/local-files/spck-scanner";
import { resolveCourseSpecificFolderId } from "../src/lib/playwright/spck-drive-uploader";
import { getSavedCourseTemplatePath } from "../src/lib/playwright/spck-demo-sheet";
import { SpckUploader } from "../src/lib/playwright/spck-uploader";

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// Valid PNG generator with exact width, height, valid CRC-32, and valid zlib IDAT scanlines
function createPngWithDimensions(width: number, height: number, seedByte = 0): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth 8
  ihdrData[9] = 2; // color type 2 (RGB)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const rowBytes = 1 + width * 3;
  const rawScanlines = Buffer.alloc(rowBytes * height, seedByte & 0xff);
  for (let y = 0; y < height; y++) {
    rawScanlines[y * rowBytes] = 0; // filter type 0 (None)
  }
  const idatData = zlib.deflateSync(rawScanlines);

  return Buffer.concat([
    signature,
    makePngChunk("IHDR", ihdrData),
    makePngChunk("IDAT", idatData),
    makePngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function makeLocalJsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
    },
    body: JSON.stringify(body),
  });
}

async function runV270Tests() {
  console.log("=== BẮT ĐẦU KIỂM THỬ TOÀN DIỆN CẬP NHẬT SPCK v2.7.0 (KỊCH BẢN T01 -> T16) ===");

  const db = getDb();
  const testClassCoding = "TEST_V270_JSB15";
  const testClassPtb = "TEST_V270_PTB09";
  const testClassCsb = "TEST_V270_CSB04";
  const tempRoot = path.resolve(process.cwd(), "temp_submissions", "test_spck_v270");

  const cleanupTestArtifacts = () => {
    for (const cid of [testClassCoding, testClassPtb, testClassCsb]) {
      db.prepare(`DELETE FROM spck_session_submissions WHERE classId = ?`).run(cid);
      db.prepare(`DELETE FROM spck_uploads WHERE classId = ?`).run(cid);
      db.prepare(`DELETE FROM students WHERE classId = ?`).run(cid);
      db.prepare(`DELETE FROM classes_sessions WHERE classId = ?`).run(cid);
      db.prepare(`DELETE FROM job_logs WHERE classId = ?`).run(cid);
    }
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  };

  cleanupTestArtifacts();
  fs.mkdirSync(tempRoot, { recursive: true });

  try {
    // Seed classes_sessions (12, 13, 14) and students for Coding, PTB, and CSB
    for (const cid of [testClassCoding, testClassPtb, testClassCsb]) {
      for (const sNum of [12, 13, 14] as const) {
        classSessionRepo.upsert({
          sessionId: `${cid}_S${sNum}`,
          classId: cid,
          className: `Lớp ${cid}`,
          sessionNumber: sNum,
          topic: `Buổi ${sNum} - SPCK`,
          date: `2026-10-${10 + sNum}`,
        });
      }
    }

    studentRepo.upsert({
      classId: testClassCoding,
      studentId: "STU_V270_01",
      fullName: "Lê Hoàng Minh",
      isActive: 1,
    });
    studentRepo.upsert({
      classId: testClassCoding,
      studentId: "STU_V270_02",
      fullName: "Trần Bảo Ngọc",
      isActive: 1,
    });
    studentRepo.upsert({
      classId: testClassCoding,
      studentId: "STU_V270_03",
      fullName: "Phạm Gia Huy",
      isActive: 1,
    });
    studentRepo.upsert({
      classId: testClassCoding,
      studentId: "STU_V270_LEGACY",
      fullName: "Nguyễn Hữu Cũ",
      isActive: 1,
    });
    studentRepo.upsert({
      classId: testClassCoding,
      studentId: "STU_V270_CORRUPT",
      fullName: "Đặng Lỗi Lịch Sử",
      isActive: 1,
    });

    studentRepo.upsert({
      classId: testClassPtb,
      studentId: "STU_PTB_01",
      fullName: "Võ Quốc Anh",
      isActive: 1,
    });
    studentRepo.upsert({
      classId: testClassCsb,
      studentId: "STU_CSB_01",
      fullName: "Đỗ Minh Châu",
      isActive: 1,
    });

    // Create folders for students
    const folderStu1 = path.join(tempRoot, "Le Hoang Minh");
    const folderStu2 = path.join(tempRoot, "Tran Bao Ngoc");
    const folderPtb1 = path.join(tempRoot, "Vo Quoc Anh");
    const folderCsb1 = path.join(tempRoot, "Do Minh Chau");
    fs.mkdirSync(folderStu1, { recursive: true });
    fs.mkdirSync(folderStu2, { recursive: true });
    fs.mkdirSync(folderPtb1, { recursive: true });
    fs.mkdirSync(folderCsb1, { recursive: true });

    const thumb16x9Path = path.join(folderStu1, "thumb_16x9.png");
    const thumb4x3Path = path.join(folderStu2, "thumb_4x3.png");
    const codeFile1 = path.join(folderStu1, "index.html");
    fs.writeFileSync(thumb16x9Path, createPngWithDimensions(1600, 900, 11));
    fs.writeFileSync(thumb4x3Path, createPngWithDimensions(800, 600, 22));
    fs.writeFileSync(codeFile1, "<html><body><h1>Trò chơi Khám Phá Vũ Trụ</h1></body></html>");
    fs.writeFileSync(path.join(folderPtb1, "project.sb3"), "scratch_project_content");
    fs.writeFileSync(path.join(folderCsb1, "main.py"), "print('CSB Final Project')");

    // Initial scan for Coding class
    const scanRes = await scanPost(
      makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/scan", {
        classId: testClassCoding,
        folderPath: tempRoot,
        sessionNumber: 12,
      })
    );
    const scanInitData = await scanRes.clone().json();
    assert.strictEqual(
      scanRes.status,
      200,
      `Quét thư mục SPCK phải trả về HTTP 200 (error=${scanInitData?.error})`
    );

    // =========================================================================
    // T01: Khác biệt theo buổi (12 -> GĐ1, 13 -> GĐ1, 14 -> GĐ2)
    // =========================================================================
    console.log("\n[T01] Kiểm tra lưu nội dung riêng biệt cho Buổi 12, 13, 14...");
    const save12Res = await (
      await saveDraftPost(
        makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/save-draft", {
          classId: testClassCoding,
          studentId: "STU_V270_01",
          sessionNumber: 12,
          localFolderPath: folderStu1,
          isConfirmedByTeacher: true,
          projectTitle: "Web Khám Phá Vũ Trụ",
          thumbnailPath: thumb16x9Path,
          screenshots: [],
          attachments: [codeFile1],
          youtubeUrls: [],
          relatedLinks: [],
          teacherNote: "Đã hoàn thành khung trang chủ và menu điều hướng",
          teacherComment: "- Tiến độ Buổi 12 (GĐ1): Đã dựng khung giao diện chính, cần bổ sung trang chi tiết hành tinh.",
        })
      )
    ).json();
    assert.strictEqual(save12Res.success, true);

    const save13Res = await (
      await saveDraftPost(
        makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/save-draft", {
          classId: testClassCoding,
          studentId: "STU_V270_01",
          sessionNumber: 13,
          localFolderPath: folderStu1,
          isConfirmedByTeacher: true,
          projectTitle: "Web Khám Phá Vũ Trụ",
          thumbnailPath: thumb16x9Path,
          screenshots: [],
          attachments: [codeFile1],
          youtubeUrls: [],
          relatedLinks: [],
          teacherNote: "Đã thêm hiệu ứng chuyển cảnh và dữ liệu 8 hành tinh",
          teacherComment: "- Tiến độ Buổi 13 (GĐ1): Đã bổ sung dữ liệu 8 hành tinh so với buổi 12, cần hoàn thiện responsive.",
        })
      )
    ).json();
    assert.strictEqual(save13Res.success, true);

    const save14Res = await (
      await saveDraftPost(
        makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/save-draft", {
          classId: testClassCoding,
          studentId: "STU_V270_01",
          sessionNumber: 14,
          localFolderPath: folderStu1,
          isConfirmedByTeacher: true,
          projectTitle: "Web Khám Phá Vũ Trụ",
          thumbnailPath: thumb16x9Path,
          screenshots: [],
          attachments: [codeFile1],
          youtubeUrls: [],
          relatedLinks: [],
          teacherNote: "Hoàn thiện toàn bộ sản phẩm cuối khóa",
          teacherComment: "- Kết quả Buổi 14 (GĐ2): Sản phẩm hoàn chỉnh, giao diện đẹp, chạy mượt mà.",
        })
      )
    ).json();
    assert.strictEqual(save14Res.success, true);

    const s12Row = spckSessionRepo.findOne(testClassCoding, "STU_V270_01", 12)!;
    const s13Row = spckSessionRepo.findOne(testClassCoding, "STU_V270_01", 13)!;
    const s14Row = spckSessionRepo.findOne(testClassCoding, "STU_V270_01", 14)!;
    assert.strictEqual(s12Row.projectTitle, "Web Khám Phá Vũ Trụ — Buổi 12 (GĐ1)");
    assert.strictEqual(s13Row.projectTitle, "Web Khám Phá Vũ Trụ — Buổi 13 (GĐ1)");
    assert.strictEqual(s14Row.projectTitle, "Web Khám Phá Vũ Trụ");
    assert.notStrictEqual(s12Row.teacherComment, s13Row.teacherComment);
    assert.notStrictEqual(s13Row.teacherComment, s14Row.teacherComment);
    console.log("  -> PASS T01.");

    // =========================================================================
    // T03: Chuyển buổi & giới hạn tiêu đề 100 ký tự (không cộng dồn, không cắt âm thầm)
    // =========================================================================
    console.log("\n[T03] Kiểm tra chuyển buổi 12 -> 13 -> 14 và chặn tiêu đề > 100 ký tự...");
    const t12 = formatSpckSessionTitle("Ứng Dụng Học Tập Thông Minh", 12);
    const t13 = formatSpckSessionTitle(t12, 13);
    const t14 = formatSpckSessionTitle(t13, 14);
    const t12Again = formatSpckSessionTitle(t14, 12);
    assert.strictEqual(t12, "Ứng Dụng Học Tập Thông Minh — Buổi 12 (GĐ1)");
    assert.strictEqual(t13, "Ứng Dụng Học Tập Thông Minh — Buổi 13 (GĐ1)");
    assert.strictEqual(t14, "Ứng Dụng Học Tập Thông Minh");
    assert.strictEqual(t12Again, "Ứng Dụng Học Tập Thông Minh — Buổi 12 (GĐ1)");
    assert.strictEqual(
      stripSpckSessionSuffix(t14),
      "Ứng Dụng Học Tập Thông Minh",
      "Không bao giờ được cộng dồn hậu tố buổi"
    );

    const overlongBase =
      "Hệ Thống Trí Tuệ Nhân Tạo Quản Lý Nông Nghiệp Công Nghệ Cao Và Tự Động Hóa Tưới Tiêu Đa Vùng Miền Nam Bộ";
    const overlongFull = formatSpckSessionTitle(overlongBase, 13);
    assert.ok(overlongFull.length > 100, "Tiêu đề thử nghiệm phải > 100 ký tự");
    const lenCheck = validateSpckTitleLength(overlongFull, 13);
    assert.strictEqual(lenCheck.valid, false, "Tiêu đề > 100 ký tự phải bị đánh dấu không hợp lệ");

    const overlongSaveRes = await saveDraftPost(
      makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/save-draft", {
        classId: testClassCoding,
        studentId: "STU_V270_02",
        sessionNumber: 13,
        localFolderPath: folderStu2,
        isConfirmedByTeacher: true,
        projectTitle: overlongBase,
        thumbnailPath: thumb4x3Path,
        teacherComment: "Nhận xét thử nghiệm.",
      })
    );
    assert.strictEqual(
      overlongSaveRes.status,
      400,
      "save-draft phải từ chối tiêu đề vượt 100 ký tự thay vì tự động cắt slice(0, 100)"
    );
    console.log("  -> PASS T03.");

    // =========================================================================
    // T02: Không mất lịch sử Buổi 12 khi sửa Buổi 13, quét lại, chụp ảnh, Drive, Web
    // =========================================================================
    console.log("\n[T02] Kiểm tra nộp Buổi 12 và bảo toàn lịch sử khi thao tác Buổi 13 & công cụ nền...");
    const curS12 = spckSessionRepo.findOne(testClassCoding, "STU_V270_01", 12)!;
    const approve12Resp = await approvePost(
      makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/approve", {
        classId: testClassCoding,
        sessionNumber: 12,
        studentIds: ["STU_V270_01"],
        reviewedItems: [
          {
            studentId: "STU_V270_01",
            draftVersion: curS12.draftVersion,
            localFolderPath: curS12.localFolderPath,
            isConfirmedByTeacher: true,
            projectTitle: curS12.projectTitle,
            thumbnailPath: curS12.thumbnailPath,
            screenshots: [],
            attachments: [codeFile1],
            youtubeUrls: [],
            relatedLinks: [],
            teacherComment: curS12.teacherComment,
          },
        ],
      })
    );
    const approve12Json = await approve12Resp.json();
    assert.strictEqual(approve12Json.success, true, "Duyệt Buổi 12 phải thành công");

    const approvedS12 = spckSessionRepo.findOne(testClassCoding, "STU_V270_01", 12)!;
    spckUploadRepo.markVerified(
      testClassCoding,
      "STU_V270_01",
      approvedS12.approvedContentHash,
      12,
      "LMS_WORK_B12_01"
    );

    const verifiedS12Before = spckSessionRepo.findOne(testClassCoding, "STU_V270_01", 12)!;
    assert.strictEqual(verifiedS12Before.lastAttemptStatus, "VERIFIED");
    assert.ok(verifiedS12Before.lastVerifiedAt);
    assert.strictEqual(verifiedS12Before.lastVerifiedLmsWorkId, "LMS_WORK_B12_01");

    // Now edit Session 13, rescan folder, and run shared resource updates (simulating screenshot/Drive/Web)
    await saveDraftPost(
      makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/save-draft", {
        classId: testClassCoding,
        studentId: "STU_V270_01",
        sessionNumber: 13,
        localFolderPath: folderStu1,
        isConfirmedByTeacher: true,
        projectTitle: "Web Khám Phá Vũ Trụ",
        thumbnailPath: thumb16x9Path,
        attachments: [codeFile1],
        teacherComment: "- Bình luận Buổi 13 mới cập nhật thêm tính năng âm thanh.",
      })
    );

    await scanPost(
      makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/scan", {
        classId: testClassCoding,
        folderPath: tempRoot,
        sessionNumber: 13,
      })
    );

    spckUploadRepo.updateSharedResources({
      classId: testClassCoding,
      studentId: "STU_V270_01",
      expectedFolderPath: folderStu1,
      relatedLinksJson: JSON.stringify([
        { name: "Link Drive SPCK", url: "https://drive.google.com/drive/folders/abc123456" },
        { name: "Link Web Live", url: "https://banhtalon.github.io/WEB_PRODUCT_SHOW/le-hoang-minh/" },
      ]),
    });

    const verifiedS12After = spckSessionRepo.findOne(testClassCoding, "STU_V270_01", 12)!;
    assert.strictEqual(
      verifiedS12After.lastAttemptStatus,
      "VERIFIED",
      "Kết quả VERIFIED của Buổi 12 phải giữ nguyên tuyệt đối"
    );
    assert.strictEqual(
      verifiedS12After.lastVerifiedHash,
      verifiedS12Before.lastVerifiedHash,
      "Hash đã nộp của Buổi 12 không được thay đổi"
    );
    assert.strictEqual(
      verifiedS12After.lastVerifiedSnapshotJson,
      verifiedS12Before.lastVerifiedSnapshotJson,
      "Snapshot bản đã nộp của Buổi 12 không được thay đổi"
    );
    console.log("  -> PASS T02.");

    // =========================================================================
    // T04 & T05: Không bịa so sánh Buổi 12, không xóa nháp khi INSUFFICIENT_INFO, không bịa thuyết trình/nhóm
    // =========================================================================
    console.log("\n[T04 & T05] Kiểm tra AI Guardrails theo giai đoạn, bảo toàn nháp cũ & không bịa nội dung...");
    // Student 2 has NO Session 12 data -> extractSession12PriorEvidence must return hasPriorSession12 = false
    const stu2Prior = extractSession12PriorEvidence(testClassCoding, "STU_V270_02");
    assert.strictEqual(
      stu2Prior.hasPriorSession12,
      false,
      "Học viên chưa có dữ liệu Buổi 12 phải có hasPriorSession12 = false"
    );
    // Even if teacherNote mentions "Đã bổ sung thêm màn hình đăng nhập" without mentioning Buổi 12, hasPriorSession12 must remain false!
    const stu2PriorWithNote = extractSession12PriorEvidence(
      testClassCoding,
      "STU_V270_02",
      [],
      "Đã bổ sung thêm màn hình đăng nhập"
    );
    assert.strictEqual(
      stu2PriorWithNote.hasPriorSession12,
      false,
      "Ghi chú 'Đã bổ sung thêm...' khi chưa có bản ghi Buổi 12 tuyệt đối không được suy diễn hasPriorSession12 = true"
    );
    // Student 1 HAS Session 12 verified data -> extractSession12PriorEvidence must return hasPriorSession12 = true
    const stu1Prior = extractSession12PriorEvidence(testClassCoding, "STU_V270_01");
    assert.strictEqual(
      stu1Prior.hasPriorSession12,
      true,
      "Học viên đã nộp Buổi 12 phải có hasPriorSession12 = true để đối chiếu tiến độ ở Buổi 13"
    );

    // Save an existing manual comment for STU_V270_02 in Session 13
    const existingManualComment = "- Tiến độ hiện tại: Học viên đã làm xong giao diện đăng nhập.";
    await saveDraftPost(
      makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/save-draft", {
        classId: testClassCoding,
        studentId: "STU_V270_02",
        sessionNumber: 13,
        localFolderPath: folderStu2,
        isConfirmedByTeacher: true,
        projectTitle: "App Quản Lý Chi Tiêu",
        thumbnailPath: thumb4x3Path,
        teacherComment: existingManualComment,
      })
    );

    // Call /api/spck/generate-ai with empty quickTags and empty teacherNote -> must return INSUFFICIENT_INFO and NOT erase existingManualComment!
    const aiInsufficientResp = await generateAiPost(
      makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/generate-ai", {
        classId: testClassCoding,
        sessionNumber: 13,
        students: [
          {
            studentId: "STU_V270_02",
            quickTags: [],
            teacherNote: "",
            includePresentation: false,
          },
        ],
      })
    );
    const aiInsufficientJson = await aiInsufficientResp.json();
    assert.strictEqual(aiInsufficientJson.success, true);
    assert.strictEqual(aiInsufficientJson.results[0].status, "INSUFFICIENT_INFO");
    assert.strictEqual(
      aiInsufficientJson.results[0].preservedExistingComment,
      true,
      "Khi thiếu ghi chú/tag, phải báo preservedExistingComment = true"
    );
    const stu2AfterInsufficient = spckSessionRepo.findOne(testClassCoding, "STU_V270_02", 13)!;
    assert.strictEqual(
      stu2AfterInsufficient.teacherComment,
      existingManualComment,
      "Bình luận đã nhập trước đó KHÔNG được bị xóa khi AI trả về INSUFFICIENT_INFO"
    );

    // Stage-specific AI generation across Session 12, Session 13, and Session 14 (mocking Gemini model)
    const origGetGenModel = GoogleGenerativeAI.prototype.getGenerativeModel;
    try {
      GoogleGenerativeAI.prototype.getGenerativeModel = function () {
        return {
          generateContent: async () => ({
            response: {
              text: () =>
                JSON.stringify({
                  attitudeSummary:
                    "Con đã xây dựng được khung giao diện chính của sản phẩm theo đúng tiến độ buổi học. Con thuyết trình rất tự tin trước lớp.",
                  productAndDesignEvaluation:
                    "Các nút điều hướng và bố cục màn hình đã hoạt động rõ ràng, trực quan. Con phối hợp nhóm rất ăn ý với các bạn.",
                  technicalApplicationEvaluation:
                    "Con cần tiếp tục hoàn thiện phần kiểm tra dữ liệu đầu vào ở phần tiếp theo.",
                  presentationEvaluation:
                    "Con trình bày mạch lạc và tự tin. Con phối hợp nhóm rất ăn ý trong phần thuyết trình.",
                }),
            },
          }),
        } as any;
      };

      // Test Session 13 BEFORE Session 12 exists -> hasPriorSession12Evidence must be false, then Session 12 -> then Session 13 again (hasPriorSession12Evidence = true) -> then Session 14
      for (const [sNum, expectPrior12] of [
        [13, false],
        [12, false],
        [13, true],
        [14, true],
      ] as const) {
        const draftBeforeAi = spckSessionRepo.getOrInitSessionDraft(
          testClassCoding,
          "STU_V270_02",
          sNum
        );
        const aiStageResp = await generateAiPost(
          makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/generate-ai", {
            classId: testClassCoding,
            sessionNumber: sNum,
            students: [
              {
                studentId: "STU_V270_02",
                expectedVersion: draftBeforeAi.draftVersion,
                quickTags: ["Tập trung"],
                teacherNote: `Ghi chú tiến độ thực tế Buổi ${sNum}.`,
                includePresentation: false,
              },
            ],
          })
        );
        const aiStageJson = await aiStageResp.json();
        assert.strictEqual(aiStageJson.success, true);
        const resItem = aiStageJson.results[0];
        const recItem = (aiStageJson.records || []).find(
          (r: any) => r.studentId === "STU_V270_02"
        );
        const dbAfterAi = spckSessionRepo.findOne(testClassCoding, "STU_V270_02", sNum)!;
        assert.strictEqual(
          resItem.draftVersion,
          dbAfterAi.draftVersion,
          `Kết quả AI Buổi ${sNum} phải trả về draftVersion mới khớp với DB`
        );
        assert.strictEqual(
          recItem?.draftVersion,
          dbAfterAi.draftVersion,
          `Danh sách records trả về từ API AI Buổi ${sNum} phải mang draftVersion của đúng buổi`
        );
        assert.strictEqual(resItem.sessionNumber, sNum);
        assert.strictEqual(resItem.stageNumber, sNum === 14 ? 2 : 1);
        assert.ok(
          !dbAfterAi.teacherComment.toLowerCase().includes("thuyết trình") &&
            !dbAfterAi.teacherComment.toLowerCase().includes("phối hợp nhóm"),
          `Nhận xét AI Buổi ${sNum} phải tự động lọc bỏ câu bịa về thuyết trình và làm việc nhóm khi không có dữ kiện`
        );
        if (sNum === 12) {
          assert.ok(
            resItem.outboundPromptSample.includes(
              "YÊU CẦU RIÊNG CHO BUỔI 12 (Giai đoạn 1 - GĐ1)"
            ),
            "Prompt AI Buổi 12 phải đúng mẫu Giai đoạn 1 (Buổi 12)"
          );
        } else if (sNum === 13) {
          assert.ok(
            resItem.outboundPromptSample.includes(
              "YÊU CẦU RIÊNG CHO BUỔI 13 (Giai đoạn 1 - GĐ1)"
            ) && resItem.hasPriorSession12Evidence === expectPrior12,
            `Prompt AI Buổi 13 phải có hasPriorSession12Evidence = ${expectPrior12}`
          );
        } else {
          assert.ok(
            resItem.outboundPromptSample.includes(
              "YÊU CẦU RIÊNG CHO BUỔI 14 (Tổng kết cuối khóa - GĐ2)"
            ),
            "Prompt AI Buổi 14 phải đúng mẫu Tổng kết cuối khóa (Buổi 14)"
          );
          assert.ok(
            !/giai\s*đoạn\s*2|gđ\s*2/i.test(dbAfterAi.teacherComment),
            "Nhận xét AI Buổi 14 tuyệt đối không được chứa cụm từ 'Giai đoạn 2' hoặc 'GĐ2'"
          );
        }
      }
      // F08: Even when includePresentation = true (hasPresentationEvidence = true), unsupported teamwork claims inside presentationEvaluation MUST be stripped
      const draftPresBefore = spckSessionRepo.getOrInitSessionDraft(
        testClassCoding,
        "STU_V270_02",
        14
      );
      const aiPresResp = await generateAiPost(
        makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/generate-ai", {
          classId: testClassCoding,
          sessionNumber: 14,
          students: [
            {
              studentId: "STU_V270_02",
              expectedVersion: draftPresBefore.draftVersion,
              quickTags: ["Tập trung"],
              teacherNote: "Con thuyết trình rõ ràng trước lớp.",
              includePresentation: true,
            },
          ],
        })
      );
      const aiPresJson = await aiPresResp.json();
      assert.strictEqual(aiPresJson.success, true);
      const dbAfterPresAi = spckSessionRepo.findOne(testClassCoding, "STU_V270_02", 14)!;
      assert.ok(
        dbAfterPresAi.teacherComment.toLowerCase().includes("trình bày mạch lạc"),
        "Khi có bằng chứng thuyết trình, phần nhận xét thuyết trình hợp lệ phải được giữ lại"
      );
      assert.ok(
        !dbAfterPresAi.teacherComment.toLowerCase().includes("phối hợp nhóm"),
        "Khi chỉ có bằng chứng thuyết trình mà không có bằng chứng làm việc nhóm, câu bịa 'phối hợp nhóm' trong presentationEvaluation bắt buộc bị lọc bỏ"
      );

      // Regression check: When Session 14 is already VERIFIED (so spck_uploads.status === 'VERIFIED'),
      // generating AI comments for Session 12 must NOT set staleIgnored = true and must persist the new Session 12 comment!
      const s14ApprovedForAiTest = spckSessionRepo.approveSessionDraft(
        testClassCoding,
        "STU_V270_02",
        14
      );
      assert.strictEqual(s14ApprovedForAiTest.success, true);
      spckUploadRepo.markVerified(
        testClassCoding,
        "STU_V270_02",
        s14ApprovedForAiTest.record.approvedContentHash,
        14,
        "LMS_WORK_B14_STU2"
      );
      assert.strictEqual(
        spckUploadRepo.findOne(testClassCoding, "STU_V270_02")?.status,
        "VERIFIED",
        "Trạng thái chung spck_uploads phải là VERIFIED sau khi nộp Buổi 14"
      );
      spckSessionRepo.saveSessionDraft({
        classId: testClassCoding,
        studentId: "STU_V270_02",
        sessionNumber: 12,
        teacherComment: "",
        updateSharedPool: false,
      });
      const s12BeforeAiWhenS14Verified = spckSessionRepo.findOne(
        testClassCoding,
        "STU_V270_02",
        12
      )!;
      const aiS12AfterS14VerResp = await generateAiPost(
        makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/generate-ai", {
          classId: testClassCoding,
          sessionNumber: 12,
          students: [
            {
              studentId: "STU_V270_02",
              expectedVersion: s12BeforeAiWhenS14Verified.draftVersion,
              quickTags: ["Nắm vững kiến thức nền tảng và vận dụng tốt vào dự án"],
              teacherNote: "đúng tiến độ, sửa các lỗi và làm slide",
              includePresentation: false,
            },
          ],
        })
      );
      const aiS12AfterS14VerJson = await aiS12AfterS14VerResp.json();
      assert.strictEqual(aiS12AfterS14VerJson.success, true);
      assert.strictEqual(
        Boolean(aiS12AfterS14VerJson.results[0].staleIgnored),
        false,
        "AI soạn nhận xét Buổi 12 sau khi Buổi 14 đã VERIFIED tuyệt đối không được báo staleIgnored = true"
      );
      const s12AfterAiWhenS14Verified = spckSessionRepo.findOne(
        testClassCoding,
        "STU_V270_02",
        12
      )!;
      assert.ok(
        s12AfterAiWhenS14Verified.teacherComment.trim().length > 20,
        "Bình luận AI của Buổi 12 phải được lưu đầy đủ vào spck_session_submissions dù Buổi 14 đã VERIFIED trước đó"
      );
      const s14StillVerifiedAfterS12Ai = spckSessionRepo.findOne(
        testClassCoding,
        "STU_V270_02",
        14
      )!;
      assert.strictEqual(
        s14StillVerifiedAfterS12Ai.lastAttemptStatus,
        "VERIFIED",
        "Lịch sử VERIFIED của Buổi 14 phải giữ nguyên sau khi AI soạn nhận xét cho Buổi 12"
      );

      // Restore STU_V270_02 Session 13 comment
      spckSessionRepo.saveSessionDraft({
        classId: testClassCoding,
        studentId: "STU_V270_02",
        sessionNumber: 13,
        teacherComment: existingManualComment,
      });
    } finally {
      GoogleGenerativeAI.prototype.getGenerativeModel = origGetGenModel;
    }
    console.log("  -> PASS T04 & T05.");

    // =========================================================================
    // T06 & T07: Đổi buổi khi tác vụ đang chạy, xung đột expectedVersion (409) & tài nguyên nền
    // =========================================================================
    console.log("\n[T06 & T07] Kiểm tra cô lập buổi khi lưu trễ, xung đột expectedVersion (409) & 'Dùng tài nguyên mới nhất'...");
    const s13BeforeT06 = spckSessionRepo.findOne(testClassCoding, "STU_V270_01", 13)!;
    // Simulate a late save arriving for Session 12 while teacher is now working on Session 13
    await saveDraftPost(
      makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/save-draft", {
        classId: testClassCoding,
        studentId: "STU_V270_01",
        sessionNumber: 12,
        localFolderPath: folderStu1,
        isConfirmedByTeacher: true,
        projectTitle: "Web Khám Phá Vũ Trụ",
        thumbnailPath: thumb16x9Path,
        teacherComment: "- Bình luận Buổi 12 lưu trễ.",
      })
    );
    const s13AfterS12Save = spckSessionRepo.findOne(testClassCoding, "STU_V270_01", 13)!;
    assert.strictEqual(
      s13AfterS12Save.teacherComment,
      s13BeforeT06.teacherComment,
      "Lưu trễ của Buổi 12 tuyệt đối không được ghi đè bình luận Buổi 13"
    );

    // Test optimistic locking conflict (expectedVersion mismatch -> HTTP 409)
    const staleVersionResp = await saveDraftPost(
      makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/save-draft", {
        classId: testClassCoding,
        studentId: "STU_V270_01",
        sessionNumber: 13,
        expectedVersion: 1, // current is > 1
        localFolderPath: folderStu1,
        isConfirmedByTeacher: true,
        projectTitle: "Web Khám Phá Vũ Trụ",
        thumbnailPath: thumb16x9Path,
        teacherComment: "- Cố tình ghi đè bằng version cũ.",
      })
    );
    assert.strictEqual(
      staleVersionResp.status,
      409,
      "Lưu bản nháp với expectedVersion cũ phải bị từ chối với HTTP 409"
    );

    // Verify background shared resource update did NOT overwrite Session 13's relatedLinksJson until sync_latest_resources is called
    const enrichedBeforeSync = buildEnrichedClassSpckRecords(testClassCoding, 13).find(
      (r) => r.studentId === "STU_V270_01"
    )!;
    assert.strictEqual(
      enrichedBeforeSync.hasNewerSharedResources,
      true,
      "Khi kho tài nguyên chung có link mới, bản nháp buổi đang mở phải báo hasNewerSharedResources = true"
    );
    assert.strictEqual(
      JSON.parse(enrichedBeforeSync.relatedLinksJson).length,
      0,
      "Bản nháp Buổi 13 chưa bấm 'Dùng tài nguyên mới nhất' phải giữ nguyên danh sách link cũ"
    );

    // Teacher clicks "Dùng tài nguyên mới nhất" (action: "sync_latest_resources")
    const syncResp = await saveDraftPost(
      makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/save-draft", {
        classId: testClassCoding,
        studentId: "STU_V270_01",
        sessionNumber: 13,
        action: "sync_latest_resources",
      })
    );
    const syncJson = await syncResp.json();
    assert.strictEqual(syncJson.success, true);
    assert.strictEqual(syncJson.record.hasNewerSharedResources, false);
    assert.strictEqual(
      JSON.parse(syncJson.record.relatedLinksJson).length,
      2,
      "Sau khi chọn 'Dùng tài nguyên mới nhất', bản nháp Buổi 13 phải nhận đủ 2 link mới từ kho tài nguyên chung"
    );

    // UI Harness Test for F02 & F06:
    // 1. handleGenerateAiComments updates UI row.draftVersion so subsequent save-draft does not 409
    // 2. Delayed persistRowDraft response does NOT overwrite newer teacherNote/quickTags typed while saving
    // 3. handleApproveAndUpload uses the draftVersion returned by its own pre-submit persistRowDraft
    {
      const reqModule = createRequire(import.meta.url);
      const swc = reqModule("next/dist/build/swc");
      const pageSource = fs.readFileSync(
        path.resolve(process.cwd(), "src/app/final-project/page.tsx"),
        "utf8"
      );
      const extractBlock = (start: string, end: string) =>
        pageSource.slice(
          pageSource.indexOf(start),
          pageSource.indexOf(end, pageSource.indexOf(start))
        );
      const persistBlock = extractBlock(
        "  const persistRowDraft = async (",
        "  // Safe session switch:"
      );
      const genStartIdx = pageSource.indexOf("  const handleGenerateAiComments = async (");
      const genEndIdx = pageSource.indexOf("\n  };", genStartIdx) + 6;
      const generateBlock = pageSource.slice(genStartIdx, genEndIdx);
      const submitBlock = extractBlock(
        "  const handleApproveAndUpload = async (",
        "  // 7. Upload student local folders"
      );

      const stu2BeforeUi = spckSessionRepo.getOrInitSessionDraft(
        testClassCoding,
        "STU_V270_02",
        13
      );
      const initialUiRow: any = {
        folderPath: folderStu2,
        assignedStudentId: "STU_V270_02",
        isConfirmedByTeacher: true,
        projectTitle: "App Quản Lý Chi Tiêu — Buổi 13 (GĐ1)",
        thumbnailPath: thumb4x3Path,
        screenshots: [],
        attachments: [],
        youtubeUrlsText: "",
        relatedLinksText: "",
        teacherComment: stu2BeforeUi.teacherComment,
        teacherNote: "Ghi chú ban đầu",
        quickTags: ["Tập trung"],
        draftVersion: stu2BeforeUi.draftVersion,
        isDirty: true,
      };
      let uiState = [{ ...initialUiRow }];
      let resolveDelayedFetch: any = null;

      const uiCtx: any = {
        rows: uiState,
        selectedClassId: testClassCoding,
        selectedSessionNumber: 13,
        activeUiClassId: testClassCoding,
        clientDraftSequence: 0,
        latestRowSaveSequence: new Map(),
        pageSessionId: "test-ui-v270",
        setRows: (fn: any) => {
          uiState = typeof fn === "function" ? fn(uiState) : fn;
          uiCtx.rows = uiState;
        },
        setBannerMessage: () => {},
        setGeneratingAi: () => {},
        parseYoutubeUrlsFromText: () => [],
        parseRelatedLinksFromText: () => [],
        parseSessionResultsMap: () => ({}),
        stripUiSessionSuffix: (s: string) => s,
        isDefaultUiProductTitle: () => false,
        getStageMeta: () => ({ stageLabel: "Giai đoạn 1" }),
        fetch: async (url: string, options: any) => {
          const bodyObj = JSON.parse(options.body);
          if (url.endsWith("/generate-ai")) {
            const origModel = GoogleGenerativeAI.prototype.getGenerativeModel;
            GoogleGenerativeAI.prototype.getGenerativeModel = function () {
              return {
                generateContent: async () => ({
                  response: {
                    text: () =>
                      JSON.stringify({
                        attitudeSummary: "Con hoàn thành khung giao diện chính.",
                        productAndDesignEvaluation: "Đã bổ sung màn hình thống kê chi tiêu.",
                        technicalApplicationEvaluation: "Cần hoàn thiện thêm bộ lọc theo tháng.",
                      }),
                  },
                }),
              } as any;
            };
            try {
              return await generateAiPost(
                makeLocalJsonRequest("http://127.0.0.1:3000" + url, bodyObj)
              );
            } finally {
              GoogleGenerativeAI.prototype.getGenerativeModel = origModel;
            }
          }
          if (url.endsWith("/save-draft")) {
            return await saveDraftPost(
              makeLocalJsonRequest("http://127.0.0.1:3000" + url, bodyObj)
            );
          }
          throw new Error("Unexpected URL: " + url);
        },
      };
      vm.createContext(uiCtx);
      const compiledUi = swc.transformSync(
        `${persistBlock}\n${generateBlock}\nglobalThis.persist = persistRowDraft; globalThis.generate = handleGenerateAiComments;`,
        {
          filename: "ui-v270.ts",
          jsc: { parser: { syntax: "typescript" }, target: "es2022" },
          module: { type: "es6" },
        }
      ).code;
      vm.runInContext(compiledUi, uiCtx);

      await uiCtx.generate();
      const dbStu2AfterAi = spckSessionRepo.findOne(testClassCoding, "STU_V270_02", 13)!;
      assert.strictEqual(
        uiState[0].draftVersion,
        dbStu2AfterAi.draftVersion,
        "UI phải cập nhật draftVersion mới sau khi AI tạo nhận xét"
      );

      // F02: Local edit to teacherNote while /api/spck/generate-ai is in flight must preserve local teacherNote AND update UI draftVersion so the next save-draft succeeds (HTTP 200, not 409)
      const fetchBeforeAiRace = uiCtx.fetch;
      let releaseAiRace: any = null;
      uiCtx.fetch = async (url: string, options: any) => {
        const response = await fetchBeforeAiRace(url, options);
        if (url.endsWith("/generate-ai")) {
          await new Promise((resolve) => {
            releaseAiRace = resolve;
          });
        }
        return response;
      };
      const aiRacePending = uiCtx.generate();
      while (!releaseAiRace) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      uiState = [
        {
          ...uiState[0],
          teacherNote: "Ghi chú giáo viên sửa trong lúc chờ AI trả lời",
          isDirty: true,
        },
      ];
      uiCtx.rows = uiState;
      releaseAiRace();
      await aiRacePending;
      const dbAfterAiRace = spckSessionRepo.findOne(testClassCoding, "STU_V270_02", 13)!;
      assert.strictEqual(
        uiState[0].teacherNote,
        "Ghi chú giáo viên sửa trong lúc chờ AI trả lời",
        "Sửa ghi chú khi đang chờ AI phải giữ nguyên ghi chú mới của giáo viên"
      );
      assert.strictEqual(
        uiState[0].draftVersion,
        dbAfterAiRace.draftVersion,
        "Sửa ghi chú khi đang chờ AI vẫn phải đồng bộ draftVersion mới từ máy chủ"
      );
      uiCtx.fetch = fetchBeforeAiRace;
      const saveAfterAiRace = await uiCtx.persist(uiState[0]);
      assert.ok(
        saveAfterAiRace && saveAfterAiRace.ok === true,
        "Lần lưu tiếp theo sau khi sửa ghi chú trong lúc chờ AI phải thành công (HTTP 200), không bị 409"
      );
      const dbAfterSaveRace = spckSessionRepo.findOne(testClassCoding, "STU_V270_02", 13)!;

      // Delayed save response must not erase newly typed teacherNote
      const origFetch = uiCtx.fetch;
      uiCtx.fetch = () =>
        new Promise((resolve) => {
          resolveDelayedFetch = resolve;
        });
      const pendingSave = uiCtx.persist(uiState[0]);
      uiState = [
        {
          ...uiState[0],
          teacherNote: "Ghi chú mới gõ trong lúc đang lưu",
          isDirty: true,
        },
      ];
      uiCtx.rows = uiState;
      resolveDelayedFetch({
        ok: true,
        json: async () => ({
          success: true,
          record: {
            projectTitle: initialUiRow.projectTitle,
            status: "WAITING_APPROVAL",
          },
          sessionDraft: { draftVersion: dbAfterSaveRace.draftVersion + 1 },
        }),
      });
      await pendingSave;
      assert.strictEqual(
        uiState[0].teacherNote,
        "Ghi chú mới gõ trong lúc đang lưu",
        "Phản hồi save-draft trễ không được xóa teacherNote mới gõ trên UI"
      );
      assert.strictEqual(uiState[0].isDirty, true);

      // Pre-submit save inside handleApproveAndUpload must pass its new draftVersion into /api/spck/approve
      let capturedApproveStatus = 0;
      let capturedApproveVersion = 0;
      const freshStu2BeforeSubmit = spckSessionRepo.findOne(
        testClassCoding,
        "STU_V270_02",
        13
      )!;
      const submitRowSnapshot = {
        ...uiState[0],
        draftVersion: freshStu2BeforeSubmit.draftVersion,
        teacherComment: "- Nhận xét vừa sửa ngay trước khi bấm Nộp.",
      };
      Object.assign(uiCtx, {
        initialRows: [submitRowSnapshot],
        students: [{ studentId: "STU_V270_02", fullName: "Trần Bảo Ngọc" }],
        duplicateStudentIds: new Set(),
        setUploading: () => {},
        setActiveActionLabel: () => {},
        setLastSubmissionSummary: () => {},
        setSelectedStudentIds: () => {},
        fetch: async (url: string, options: any) => {
          const bodyObj = JSON.parse(options.body);
          if (url.endsWith("/save-draft")) {
            return await saveDraftPost(
              makeLocalJsonRequest("http://127.0.0.1:3000" + url, bodyObj)
            );
          }
          if (url.endsWith("/approve")) {
            const resp = await approvePost(
              makeLocalJsonRequest("http://127.0.0.1:3000" + url, bodyObj)
            );
            capturedApproveStatus = resp.status;
            capturedApproveVersion = bodyObj.reviewedItems[0].draftVersion;
            return resp;
          }
          if (url.endsWith("/upload-lms")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                success: true,
                uploadResult: {
                  classId: testClassCoding,
                  totalRequested: 1,
                  verifiedCount: 1,
                  failedCount: 0,
                  demotedCount: 0,
                  results: [{ studentId: "STU_V270_02", status: "VERIFIED" }],
                },
                records: buildEnrichedClassSpckRecords(testClassCoding, 13),
              }),
            };
          }
          return origFetch(url, options);
        },
      });
      const compiledSubmit = swc.transformSync(
        `globalThis.submitAudit = (() => { const rows = initialRows; ${persistBlock}\n${submitBlock}\nreturn handleApproveAndUpload; })();`,
        {
          filename: "ui-submit-v270.ts",
          jsc: { parser: { syntax: "typescript" }, target: "es2022" },
          module: { type: "es6" },
        }
      ).code;
      vm.runInContext(compiledSubmit, uiCtx);
      await uiCtx.submitAudit(["STU_V270_02"]);
      const dbStu2AfterSubmit = spckSessionRepo.findOne(testClassCoding, "STU_V270_02", 13)!;
      assert.strictEqual(
        capturedApproveStatus,
        200,
        "handleApproveAndUpload phải gửi đúng draftVersion mới sau khi tự lưu nháp, trả về HTTP 200"
      );
      assert.strictEqual(capturedApproveVersion, dbStu2AfterSubmit.draftVersion);
    }
    console.log("  -> PASS T06 & T07.");

    // =========================================================================
    // T08: Dữ liệu lịch sử cũ ("Chưa xác định") & Lịch sử lỗi JSON ("Cần kiểm tra")
    // =========================================================================
    console.log("\n[T08] Kiểm tra bảo toàn lịch sử cũ (Chưa xác định) và lịch sử lỗi JSON (Cần kiểm tra)...");
    // 1. Legacy record verified without session breakdown
    const folderLegacy = path.join(tempRoot, "Nguyen Huu Cu");
    const folderCorrupt = path.join(tempRoot, "Dang Loi Lich Su");
    fs.mkdirSync(folderLegacy, { recursive: true });
    fs.mkdirSync(folderCorrupt, { recursive: true });

    db.prepare(
      `INSERT INTO spck_uploads (
        classId, studentId, localFolderPath, matchScore, isConfirmedByTeacher,
        projectTitle, thumbnailPath, screenshotsJson, attachmentsJson,
        youtubeUrlsJson, relatedLinksJson, teacherComment, contentHash,
        status, verifiedAt, sessionResultsJson
      ) VALUES (?, ?, ?, 1.0, 1, 'SPCK Nguyễn Hữu Cũ', ?, '[]', '[]', '[]', '[]', 'Nhận xét cũ', 'hash_legacy_01', 'VERIFIED', '2026-10-01 12:00:00', '{}')`
    ).run(testClassCoding, "STU_V270_LEGACY", folderLegacy, thumb16x9Path);

    // 2. Corrupted sessionResultsJson record
    db.prepare(
      `INSERT INTO spck_uploads (
        classId, studentId, localFolderPath, matchScore, isConfirmedByTeacher,
        projectTitle, thumbnailPath, screenshotsJson, attachmentsJson,
        youtubeUrlsJson, relatedLinksJson, teacherComment, contentHash,
        status, verifiedAt, sessionResultsJson
      ) VALUES (?, ?, ?, 1.0, 1, 'SPCK Đặng Lỗi Lịch Sử', ?, '[]', '[]', '[]', '[]', 'Nhận xét lỗi', 'hash_corrupt_01', 'WAITING_APPROVAL', NULL, '{bad_json')`
    ).run(testClassCoding, "STU_V270_CORRUPT", folderCorrupt, thumb4x3Path);

    migrateSpckSessionSubmissions();

    // Edit and submit Session 14 for STU_V270_LEGACY -> Sessions 12 & 13 must STILL show UNKNOWN_LEGACY ("Chưa xác định")!
    await saveDraftPost(
      makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/save-draft", {
        classId: testClassCoding,
        studentId: "STU_V270_LEGACY",
        sessionNumber: 14,
        localFolderPath: folderLegacy,
        isConfirmedByTeacher: true,
        projectTitle: "SPCK Nguyễn Hữu Cũ",
        thumbnailPath: thumb16x9Path,
        teacherComment: "- Bình luận mới cho Buổi 14.",
      })
    );
    const legS14 = spckSessionRepo.findOne(testClassCoding, "STU_V270_LEGACY", 14)!;
    spckSessionRepo.approveSessionDraft(testClassCoding, "STU_V270_LEGACY", 14, legS14.draftVersion);
    const legS14App = spckSessionRepo.findOne(testClassCoding, "STU_V270_LEGACY", 14)!;
    spckUploadRepo.markVerified(testClassCoding, "STU_V270_LEGACY", legS14App.approvedContentHash, 14);

    const legacyHistorySummary = spckSessionRepo.buildStudentSessionHistorySummary(
      testClassCoding,
      "STU_V270_LEGACY"
    );
    assert.strictEqual(legacyHistorySummary.hasLegacyUnknownSessionHistory, true);
    assert.strictEqual(
      legacyHistorySummary.sessions["12"].displayState,
      "UNKNOWN_LEGACY",
      "Sau khi sửa nháp và nộp Buổi 14, Buổi 12 của bản ghi cũ vẫn phải giữ UNKNOWN_LEGACY ('Chưa xác định')"
    );
    assert.strictEqual(
      legacyHistorySummary.sessions["13"].displayState,
      "UNKNOWN_LEGACY",
      "Sau khi sửa nháp và nộp Buổi 14, Buổi 13 của bản ghi cũ vẫn phải giữ UNKNOWN_LEGACY ('Chưa xác định')"
    );
    assert.strictEqual(
      legacyHistorySummary.sessions["14"].displayState,
      "VERIFIED",
      "Buổi 14 vừa nộp phải hiển thị VERIFIED"
    );

    const corruptHistorySummary = spckSessionRepo.buildStudentSessionHistorySummary(
      testClassCoding,
      "STU_V270_CORRUPT"
    );
    assert.strictEqual(corruptHistorySummary.historyCorrupted, true);
    assert.strictEqual(
      corruptHistorySummary.sessions["12"].displayState,
      "CORRUPTED",
      "Bản ghi lỗi JSON lịch sử phải hiển thị CORRUPTED ('Cần kiểm tra'), không được coi là chưa nộp"
    );
    console.log("  -> PASS T08.");

    // =========================================================================
    // T09: Nộp đúng bản đã duyệt của đúng buổi (sửa sau duyệt phải hạ trạng thái; duyệt B12 không nộp được B13)
    // =========================================================================
    console.log("\n[T09] Kiểm tra khóa duyệt đúng buổi & tự hạ trạng thái khi sửa sau duyệt...");
    const s13Current = spckSessionRepo.findOne(testClassCoding, "STU_V270_01", 13)!;
    const app13Res = spckSessionRepo.approveSessionDraft(
      testClassCoding,
      "STU_V270_01",
      13,
      s13Current.draftVersion
    );
    assert.strictEqual(app13Res.success, true);
    assert.strictEqual(app13Res.record.draftStatus, "APPROVED");

    // Try to submit Session 14 when only Session 13 is approved -> must demote/skip!
    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
    let dummyPage: any = {};
    try {
      browser = await chromium.launch({ headless: true });
      dummyPage = await browser.newPage();
    } catch {
      dummyPage = {};
    }
    try {
      const wrongSessionUpload = await SpckUploader.uploadApprovedSpck({
        classId: testClassCoding,
        sessionNumber: 14,
        studentIds: ["STU_V270_01"],
        customPage: dummyPage,
        skipNavigation: true,
      });
      assert.strictEqual(
        wrongSessionUpload.verifiedCount,
        0,
        "Duyệt Buổi 13 nhưng gọi nộp Buổi 14 phải bị chặn (verifiedCount = 0)"
      );
      assert.strictEqual(wrongSessionUpload.demotedCount, 1);

      // Re-approve Session 13, then edit Session 13 comment before uploading -> must auto-demote to WAITING_APPROVAL!
      const s13ReApp = spckSessionRepo.approveSessionDraft(
        testClassCoding,
        "STU_V270_01",
        13
      );
      assert.strictEqual(s13ReApp.record.draftStatus, "APPROVED");

      // F03: Approve Session 12 AND Session 13 simultaneously; editing Session 13 or updating shared resources must NOT revoke Session 12!
      spckSessionRepo.approveSessionDraft(testClassCoding, "STU_V270_01", 12);
      await saveDraftPost(
        makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/save-draft", {
          classId: testClassCoding,
          studentId: "STU_V270_01",
          sessionNumber: 13,
          localFolderPath: folderStu1,
          isConfirmedByTeacher: true,
          projectTitle: "Web Khám Phá Vũ Trụ",
          thumbnailPath: thumb16x9Path,
          teacherComment: "- Bình luận Buổi 13 đã bị sửa sau khi bấm duyệt.",
        })
      );
      const s13AfterEdit = spckSessionRepo.findOne(testClassCoding, "STU_V270_01", 13)!;
      assert.strictEqual(
        s13AfterEdit.draftStatus,
        "WAITING_APPROVAL",
        "Sửa bình luận sau khi duyệt phải tự động hạ trạng thái Buổi 13 về WAITING_APPROVAL"
      );
      assert.strictEqual(s13AfterEdit.approvedContentHash, "");

      const s12StillApproved = spckSessionRepo.findOne(testClassCoding, "STU_V270_01", 12)!;
      assert.strictEqual(
        s12StillApproved.draftStatus,
        "APPROVED",
        "Sửa nháp Buổi 13 không được làm mất trạng thái APPROVED của Buổi 12"
      );
      assert.ok(s12StillApproved.approvedContentHash);

      // Approving Session 13 as well and uploading Session 12 must succeed using Session 12's approved record
      spckSessionRepo.approveSessionDraft(testClassCoding, "STU_V270_01", 13);
      const uploadS12WhileS13Approved = await SpckUploader.runUploadInternal({
        classId: testClassCoding,
        sessionNumber: 12,
        studentIds: ["STU_V270_01"],
        customPage: {} as any,
        skipNavigation: true,
      });
      assert.strictEqual(
        uploadS12WhileS13Approved.verifiedCount,
        1,
        "Nộp Buổi 12 khi cả Buổi 12 và Buổi 13 đều đã duyệt phải thành công"
      );
      assert.strictEqual(uploadS12WhileS13Approved.demotedCount, 0);

      if (dummyPage && typeof dummyPage.close === "function") {
        await dummyPage.close();
      }
    } finally {
      if (browser) {
        await browser.close();
      }
    }
    console.log("  -> PASS T09.");

    // =========================================================================
    // T10: Nộp lại thất bại vẫn giữ bằng chứng thành công trước đó
    // =========================================================================
    console.log("\n[T10] Kiểm tra nộp lại thất bại vẫn giữ nguyên bằng chứng VERIFIED trước đó...");
    const s13ToVerify = spckSessionRepo.approveSessionDraft(
      testClassCoding,
      "STU_V270_01",
      13
    ).record;
    spckUploadRepo.markVerified(
      testClassCoding,
      "STU_V270_01",
      s13ToVerify.approvedContentHash,
      13,
      "LMS_WORK_B13_V1"
    );
    const verifiedSnapB13 = spckSessionRepo.findOne(testClassCoding, "STU_V270_01", 13)!;
    assert.strictEqual(verifiedSnapB13.lastAttemptStatus, "VERIFIED");
    assert.ok(verifiedSnapB13.lastVerifiedAt);

    // Edit Session 13, re-approve, and simulate a FAILED re-upload on Session 13
    spckSessionRepo.saveSessionDraft({
      classId: testClassCoding,
      studentId: "STU_V270_01",
      sessionNumber: 13,
      teacherComment: "- Bình luận Buổi 13 nộp lại lần 2.",
    });
    const s13ReApproved2 = spckSessionRepo.approveSessionDraft(
      testClassCoding,
      "STU_V270_01",
      13
    ).record;
    spckUploadRepo.recordSessionFailure(
      testClassCoding,
      "STU_V270_01",
      13,
      s13ReApproved2.approvedContentHash,
      "Mất kết nối mạng khi nộp lại Buổi 13"
    );

    const histAfterReuploadFail = spckSessionRepo.buildStudentSessionHistorySummary(
      testClassCoding,
      "STU_V270_01"
    );
    const slot13AfterFail = histAfterReuploadFail.sessions["13"];
    assert.strictEqual(
      slot13AfterFail.displayState,
      "FAILED_AFTER_VERIFIED",
      "Nộp lại thất bại sau khi đã có bản thành công phải có trạng thái FAILED_AFTER_VERIFIED"
    );
    assert.strictEqual(
      slot13AfterFail.lastVerifiedHash,
      verifiedSnapB13.lastVerifiedHash,
      "Mã kiểm tra của bản nộp thành công trước đó phải còn nguyên"
    );
    assert.ok(
      slot13AfterFail.lastVerifiedSnapshot,
      "Vẫn phải xem được toàn bộ snapshot nội dung của lần nộp thành công trước đó"
    );
    assert.strictEqual(
      slot13AfterFail.lastVerifiedSnapshot?.teacherComment,
      "- Bình luận Buổi 13 đã bị sửa sau khi bấm duyệt."
    );
    console.log("  -> PASS T10.");

    // =========================================================================
    // T11: Thay đổi file trên ổ cứng sau khi nộp (File Drift Detection)
    // =========================================================================
    console.log("\n[T11] Kiểm tra phát hiện thay đổi file trên ổ cứng sau khi đã nộp...");
    // Modify thumb16x9Path bytes on disk after Session 12 was VERIFIED
    fs.writeFileSync(thumb16x9Path, createPngWithDimensions(1600, 900, 99));
    const histAfterFileEdit = spckSessionRepo.buildStudentSessionHistorySummary(
      testClassCoding,
      "STU_V270_01"
    );
    const slot12Drift = histAfterFileEdit.sessions["12"];
    assert.strictEqual(
      slot12Drift.displayState,
      "VERIFIED_FILE_DRIFT",
      "Khi file ảnh/tài liệu trên ổ cứng bị sửa sau khi nộp, phải cảnh báo VERIFIED_FILE_DRIFT"
    );
    assert.strictEqual(slot12Drift.hasFileDriftAfterVerified, true);
    assert.ok(slot12Drift.driftedFiles.includes("thumb_16x9.png"));
    assert.ok(
      slot12Drift.lastVerifiedSnapshot?.teacherComment.includes("Buổi 12"),
      "Nội dung chữ đã nộp ở Buổi 12 vẫn được bảo toàn nguyên vẹn"
    );
    // Restore original bytes of thumb16x9Path
    fs.writeFileSync(thumb16x9Path, createPngWithDimensions(1600, 900, 11));

    // F01: Real LMS Modal upload must re-upload same-named file when local bytes changed & reject stale server response
    {
      const mainPyFile = path.join(folderStu2, "main.py");
      fs.writeFileSync(mainPyFile, "print(2)");
      spckSessionRepo.saveSessionDraft({
        classId: testClassCoding,
        studentId: "STU_V270_02",
        sessionNumber: 12,
        localFolderPath: folderStu2,
        isConfirmedByTeacher: 1,
        projectTitle: "App Quản Lý Chi Tiêu — Buổi 12 (GĐ1)",
        thumbnailPath: getDefaultMindxLogoThumbnailPath(),
        attachmentsJson: JSON.stringify([mainPyFile]),
        teacherComment: "- Nhận xét Buổi 12 có file main.py mới.",
      });
      const appModal12 = spckSessionRepo.approveSessionDraft(
        testClassCoding,
        "STU_V270_02",
        12
      ).record;
      const uploadRecModal = spckUploadRepo.findOne(testClassCoding, "STU_V270_02")!;

      let modalOpen = false;
      let titleVal = "";
      let commentVal = "";
      let fileUploadsCount = 0;
      let serverBytesToReturn = "print(1)"; // Stale server file bytes
      const fullNameModal = "Trần Bảo Ngọc";
      const makeModalLoc = (selector: string): any => {
        const obj: any = {
          first: () => obj,
          last: () => obj,
          nth: () => obj,
          locator: (s: string) => makeModalLoc(s),
          count: async () =>
            selector.includes("0?2") || selector.includes("Xem chi tiết") ? 0 : 1,
          isVisible: async () => (selector.includes("MuiDialog") ? modalOpen : true),
          waitFor: async () => {},
          scrollIntoViewIfNeeded: async () => {},
          click: async () => {
            if (selector.includes("Sản phẩm của học sinh")) modalOpen = true;
          },
          innerText: async () =>
            selector === "h3, h2, .MuiTypography-h6" ||
            selector.includes("name-display") ||
            selector.includes("tbody tr")
              ? fullNameModal
              : "main.py",
          innerHTML: async () => "<span>main.py</span>",
          fill: async (val: string) => {
            if (selector.includes("input#title")) titleVal = val;
            else if (selector.includes("textarea#comment")) commentVal = val;
          },
          inputValue: async () =>
            selector.includes("textarea#comment") ? commentVal : titleVal,
          evaluate: async () => ({
            src: "https://resources.mindx.edu.vn/default-spck-thumbnail.png",
            naturalWidth: 500,
          }),
          setInputFiles: async () => {
            fileUploadsCount++;
          },
          getAttribute: async () => ".py",
        };
        return obj;
      };
      const defaultLogoThumbPath = getDefaultMindxLogoThumbnailPath();
      let serverThumbDigestToReturn: string | undefined =
        computeSafeFileByteDigest(defaultLogoThumbPath);
      let serverAttachmentsToReturn: any[] = [{ name: "main.py", bytes: serverBytesToReturn }];
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
                    title: appModal12.projectTitle,
                    comment: appModal12.teacherComment,
                    thumbnail: serverThumbDigestToReturn
                      ? {
                          name: path.basename(defaultLogoThumbPath),
                          byteSha256: serverThumbDigestToReturn,
                        }
                      : {
                          name: path.basename(defaultLogoThumbPath),
                          url: "https://resources.mindx.edu.vn/thumb-no-digest.png",
                        },
                    attachments: serverAttachmentsToReturn,
                  },
                },
              },
            },
          }),
        }),
      };

      await assert.rejects(
        async () => {
          await (SpckUploader as any).uploadSingleStudentViaRealLmsModal({
            page: fakeModalPage,
            interceptor: { dismissForbiddenToast: async () => {} },
            normalizedClassId: testClassCoding,
            targetSessionNumber: 12,
            record: {
              ...uploadRecModal,
              projectTitle: appModal12.projectTitle,
              teacherComment: appModal12.teacherComment,
              contentHash: appModal12.approvedContentHash,
            },
            fullName: fullNameModal,
            studentsInClass: [{ studentId: "STU_V270_02", fullName: fullNameModal }],
            expectedHash: appModal12.approvedContentHash,
            screenshots: [],
            attachments: [mainPyFile],
            youtubeUrls: [],
            relatedLinks: [],
          });
        },
        /Read-after-Write/,
        "Modal LMS thật trả về nội dung file main.py cũ ('print(1)' != 'print(2)') phải bị chặn bởi Read-after-Write"
      );
      assert.ok(
        fileUploadsCount >= 1,
        "Phải tải lại file trùng tên 'main.py' khi chưa có bằng chứng byte/SHA-256 khớp"
      );

      // F01: Reject response that only has name/url without byte/SHA-256 evidence
      serverAttachmentsToReturn = [
        { name: "main.py", url: "https://resources.mindx.edu.vn/main-old.py" },
      ];
      await assert.rejects(
        async () => {
          await (SpckUploader as any).uploadSingleStudentViaRealLmsModal({
            page: fakeModalPage,
            interceptor: { dismissForbiddenToast: async () => {} },
            normalizedClassId: testClassCoding,
            targetSessionNumber: 12,
            record: {
              ...uploadRecModal,
              projectTitle: appModal12.projectTitle,
              teacherComment: appModal12.teacherComment,
              contentHash: appModal12.approvedContentHash,
            },
            fullName: fullNameModal,
            studentsInClass: [{ studentId: "STU_V270_02", fullName: fullNameModal }],
            expectedHash: appModal12.approvedContentHash,
            screenshots: [],
            attachments: [mainPyFile],
            youtubeUrls: [],
            relatedLinks: [],
          });
        },
        /thiếu bằng chứng byte\/SHA-256/,
        "Phản hồi chỉ có tên/URL file mà không có bằng chứng byte phải bị từ chối"
      );

      // F01: Reject response when thumbnail byteSha256 is wrong
      serverBytesToReturn = "print(2)";
      serverAttachmentsToReturn = [{ name: "main.py", bytes: serverBytesToReturn }];
      serverThumbDigestToReturn = "WRONG_THUMBNAIL_HASH";
      await assert.rejects(
        async () => {
          await (SpckUploader as any).uploadSingleStudentViaRealLmsModal({
            page: fakeModalPage,
            interceptor: { dismissForbiddenToast: async () => {} },
            normalizedClassId: testClassCoding,
            targetSessionNumber: 12,
            record: {
              ...uploadRecModal,
              projectTitle: appModal12.projectTitle,
              teacherComment: appModal12.teacherComment,
              contentHash: appModal12.approvedContentHash,
            },
            fullName: fullNameModal,
            studentsInClass: [{ studentId: "STU_V270_02", fullName: fullNameModal }],
            expectedHash: appModal12.approvedContentHash,
            screenshots: [],
            attachments: [mainPyFile],
            youtubeUrls: [],
            relatedLinks: [],
          });
        },
        /Ảnh Thumbnail.*không khớp byte\/SHA-256/,
        "Phản hồi có byteSha256 của Thumbnail sai lệch phải bị từ chối"
      );

      // F01: Reject response when savedWork exists (e.g. { id: "..." }) but latestData is missing/omitted
      const origWaitForRes = fakeModalPage.waitForResponse;
      fakeModalPage.waitForResponse = async () => ({
        url: () => "https://lms-api.mindx.edu.vn/",
        status: () => 200,
        json: async () => ({
          data: {
            studentWorks: {
              update: {
                id: "work_missing_latest_data",
              },
            },
          },
        }),
      });
      await assert.rejects(
        async () => {
          await (SpckUploader as any).uploadSingleStudentViaRealLmsModal({
            page: fakeModalPage,
            interceptor: { dismissForbiddenToast: async () => {} },
            normalizedClassId: testClassCoding,
            targetSessionNumber: 12,
            record: {
              ...uploadRecModal,
              projectTitle: appModal12.projectTitle,
              teacherComment: appModal12.teacherComment,
              contentHash: appModal12.approvedContentHash,
            },
            fullName: fullNameModal,
            studentsInClass: [{ studentId: "STU_V270_02", fullName: fullNameModal }],
            expectedHash: appModal12.approvedContentHash,
            screenshots: [],
            attachments: [mainPyFile],
            youtubeUrls: [],
            relatedLinks: [],
          });
        },
        /latestData/,
        "Phản hồi có đối tượng StudentWork nhưng thiếu toàn bộ latestData bắt buộc bị từ chối với lỗi Read-after-Write"
      );
      fakeModalPage.waitForResponse = origWaitForRes;

      // Now when server returns matching bytes 'print(2)' AND matching thumbnail byteSha256, modal upload succeeds!
      serverThumbDigestToReturn = computeSafeFileByteDigest(defaultLogoThumbPath);
      const modalSuccessStats = await (SpckUploader as any).uploadSingleStudentViaRealLmsModal({
        page: fakeModalPage,
        interceptor: { dismissForbiddenToast: async () => {} },
        normalizedClassId: testClassCoding,
        targetSessionNumber: 12,
        record: {
          ...uploadRecModal,
          projectTitle: appModal12.projectTitle,
          teacherComment: appModal12.teacherComment,
          contentHash: appModal12.approvedContentHash,
        },
        fullName: fullNameModal,
        studentsInClass: [{ studentId: "STU_V270_02", fullName: fullNameModal }],
        expectedHash: appModal12.approvedContentHash,
        screenshots: [],
        attachments: [mainPyFile],
        youtubeUrls: [],
        relatedLinks: [],
      });
      assert.strictEqual(modalSuccessStats.attachmentsUploadedCount, 1);
      fs.rmSync(mainPyFile, { force: true });
    }
    console.log("  -> PASS T11.");

    // =========================================================================
    // T12: Chỉ 3 trường có dấu * là bắt buộc; các trường tùy chọn kiểm tra giới hạn & không cắt âm thầm
    // =========================================================================
    console.log("\n[T12] Kiểm tra chỉ 3 trường bắt buộc (*) và kiểm tra giới hạn trường tùy chọn...");
    // Student 2 with ONLY Title*, Thumbnail*, and TeacherComment* (0 videos, 0 screenshots, 0 attachments, 0 links)
    await saveDraftPost(
      makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/save-draft", {
        classId: testClassCoding,
        studentId: "STU_V270_02",
        sessionNumber: 12,
        localFolderPath: folderStu2,
        isConfirmedByTeacher: true,
        projectTitle: "SPCK Trần Bảo Ngọc", // Default title is allowed with non-blocking notice!
        thumbnailPath: getDefaultMindxLogoThumbnailPath(),
        screenshots: [],
        attachments: [],
        youtubeUrls: [],
        relatedLinks: [],
        teacherComment: "- Tiến độ Buổi 12: Đã hoàn thành thiết kế cơ sở dữ liệu.",
      })
    );
    const stu2Draft12 = spckSessionRepo.findOne(testClassCoding, "STU_V270_02", 12)!;
    const appStu2MinimalResp = await approvePost(
      makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/approve", {
        classId: testClassCoding,
        sessionNumber: 12,
        studentIds: ["STU_V270_02"],
        reviewedItems: [
          {
            studentId: "STU_V270_02",
            draftVersion: stu2Draft12.draftVersion,
            localFolderPath: folderStu2,
            isConfirmedByTeacher: true,
            projectTitle: stu2Draft12.projectTitle,
            thumbnailPath: stu2Draft12.thumbnailPath,
            screenshots: [],
            attachments: [],
            youtubeUrls: [],
            relatedLinks: [],
            teacherComment: stu2Draft12.teacherComment,
          },
        ],
      })
    );
    const appStu2MinimalJson = await appStu2MinimalResp.json();
    assert.strictEqual(
      appStu2MinimalJson.success,
      true,
      "Bài chỉ có 3 trường bắt buộc (*) và tên mặc định vẫn phải được duyệt thành công"
    );
    assert.strictEqual(appStu2MinimalJson.approvedCount, 1);

    // Optional fields exceeding limits (e.g., 6 YouTube URLs) must be rejected explicitly (HTTP 400), never silently sliced to 5
    const sixYoutubeRes = await saveDraftPost(
      makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/save-draft", {
        classId: testClassCoding,
        studentId: "STU_V270_02",
        sessionNumber: 12,
        localFolderPath: folderStu2,
        isConfirmedByTeacher: true,
        projectTitle: "SPCK Trần Bảo Ngọc",
        thumbnailPath: getDefaultMindxLogoThumbnailPath(),
        youtubeUrls: [
          "https://youtu.be/vid1",
          "https://youtu.be/vid2",
          "https://youtu.be/vid3",
          "https://youtu.be/vid4",
          "https://youtu.be/vid5",
          "https://youtu.be/vid6",
        ],
        teacherComment: "- Tiến độ Buổi 12.",
      })
    );
    assert.strictEqual(
      sixYoutubeRes.status,
      400,
      "Vượt quá 5 link YouTube phải trả về lỗi 400 thay vì tự cắt bớt"
    );
    assert.strictEqual(
      validateSpckResourceLimits({
        youtubeUrls: ["1", "2", "3", "4", "5", "6"],
      }).valid,
      false
    );

    // F07: Scanner and owner image upload must also reject over-limit resources (HTTP 400) instead of silently slicing
    const overLimitFolder = path.join(tempRoot, "OverLimitTemp");
    const overLimitSub = path.join(overLimitFolder, "Tran Bao Ngoc");
    fs.mkdirSync(overLimitSub, { recursive: true });
    for (let i = 0; i < 12; i++) {
      fs.writeFileSync(path.join(overLimitSub, `extra_${i}.py`), `print(${i})`);
    }
    const overScanRes = await scanPost(
      makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/scan", {
        classId: testClassCoding,
        folderPath: overLimitFolder,
        sessionNumber: 12,
      })
    );
    assert.strictEqual(
      overScanRes.status,
      400,
      "Quét thư mục có 12 tài liệu đính kèm (>10) phải trả về HTTP 400 thay vì tự cắt còn 10"
    );
    fs.rmSync(overLimitFolder, { recursive: true, force: true });

    const sampleDataUrl =
      "data:image/png;base64," +
      fs.readFileSync(getDefaultMindxLogoThumbnailPath()).toString("base64");
    const overOwnerUploadRes = await captureScreenshotsPost(
      makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/capture-screenshots", {
        classId: testClassCoding,
        studentId: "STU_V270_02",
        action: "upload_owner_image",
        role: "gallery",
        files: Array.from({ length: 11 }, (_, i) => ({
          fileName: `gallery_${i}.png`,
          dataUrl: sampleDataUrl,
        })),
      })
    );
    assert.strictEqual(
      overOwnerUploadRes.status,
      400,
      "Tải lên 11 ảnh bổ sung (>10) phải bị từ chối với HTTP 400 trước khi ghi file"
    );

    // F07: Auto-capture branch (`action: "capture"`) must ALSO reject with HTTP 400 when `_spck_owner_uploads` has 12 images (1 thumbnail + 11 gallery > 10 limit) instead of silently slicing to 10
    const ownerUploadsStu2 = path.join(folderStu2, "_spck_owner_uploads");
    fs.mkdirSync(ownerUploadsStu2, { recursive: true });
    const defaultLogoBytes = fs.readFileSync(getDefaultMindxLogoThumbnailPath());
    for (let i = 0; i < 12; i++) {
      fs.writeFileSync(
        path.join(ownerUploadsStu2, `owner_${String(i).padStart(2, "0")}.png`),
        defaultLogoBytes
      );
    }
    const overAutoCaptureRes = await captureScreenshotsPost(
      makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/capture-screenshots", {
        classId: testClassCoding,
        studentId: "STU_V270_02",
        sessionNumber: 14,
        useAiVision: false,
      })
    );
    assert.strictEqual(
      overAutoCaptureRes.status,
      400,
      "Nhánh tự chụp giao diện khi có 12 ảnh (1 ảnh bìa + 11 ảnh bổ sung > 10) phải trả về HTTP 400 thay vì tự cắt còn 10"
    );
    fs.rmSync(ownerUploadsStu2, { recursive: true, force: true });
    console.log("  -> PASS T12.");

    // =========================================================================
    // T13: Ảnh đại diện (Logo MindX vs 16:9 vs tỉ lệ khác) & Phân loại đường dẫn
    // =========================================================================
    console.log("\n[T13] Kiểm tra phân loại Thumbnail (Logo MindX / 16:9 / Khác) và Đường dẫn...");
    const inspDefault = inspectSpckThumbnail(getDefaultMindxLogoThumbnailPath());
    const insp16x9 = inspectSpckThumbnail(thumb16x9Path);
    const insp4x3 = inspectSpckThumbnail(thumb4x3Path);
    assert.strictEqual(inspDefault.isDefaultMindxLogo, true);
    assert.ok(inspDefault.badgeLabel.includes("Ảnh mặc định"));
    assert.strictEqual(insp16x9.is16By9, true);
    assert.ok(insp16x9.badgeLabel.includes("16:9"));
    assert.strictEqual(insp4x3.is16By9, false);
    assert.ok(insp4x3.aspectRatioLabel.startsWith("4:3"));

    const clsLive = classifySpckRelatedLink({
      name: "Web Live",
      url: "https://banhtalon.github.io/WEB_PRODUCT_SHOW/demo/",
    });
    const clsDrive = classifySpckRelatedLink({
      name: "Thư mục Drive",
      url: "https://drive.google.com/drive/folders/123456",
    });
    assert.strictEqual(clsLive.category, "LIVE_PRODUCT");
    assert.strictEqual(clsLive.categoryLabel, "Chạy thử sản phẩm");
    assert.strictEqual(clsDrive.category, "SOURCE_DOWNLOAD");
    assert.strictEqual(clsDrive.categoryLabel, "Mã nguồn/Tải xuống");
    console.log("  -> PASS T13.");

    // =========================================================================
    // T14: Áp dụng cho tất cả các lớp bao gồm PTB và CSB
    // =========================================================================
    console.log("\n[T14] Kiểm tra hỗ trợ đầy đủ lớp PTB và CSB (không miễn trừ, không mượn cấu hình PTA)...");
    const listResp = await listGet(
      new Request("http://127.0.0.1:3000/api/spck/list?classId=" + testClassPtb, {
        headers: { host: "127.0.0.1:3000" },
      })
    );
    const listJson = await listResp.json();
    assert.strictEqual(listJson.success, true);
    const classIdsInList = (listJson.classes || []).map((c: any) => c.classId);
    assert.ok(
      classIdsInList.includes(testClassPtb) && classIdsInList.includes(testClassCsb),
      "Danh sách lớp đủ điều kiện nộp SPCK bắt buộc bao gồm cả PTB và CSB"
    );
    assert.strictEqual(listJson.demoSheetMeta?.spckExempt, false);

    // Optional Drive folder & Demo sheet template for PTB/CSB must NOT borrow PTA's configuration
    assert.notStrictEqual(
      resolveCourseSpecificFolderId(testClassPtb),
      resolveCourseSpecificFolderId("TEST_PTA12"),
      "Lớp PTB không được dùng thư mục Drive của khóa PTA"
    );
    assert.strictEqual(
      resolveCourseSpecificFolderId("TEST_ROBO_UNCONFIGURED_01"),
      null,
      "Khóa học chưa cấu hình thư mục Drive riêng phải trả về null, không được mượn thư mục của khóa khác"
    );
    assert.strictEqual(
      getSavedCourseTemplatePath(testClassPtb),
      null,
      "Lớp PTB chưa có mẫu Bảng chấm Demo riêng không được tự mượn mẫu của PTA"
    );
    assert.strictEqual(
      getSavedCourseTemplatePath(testClassCsb),
      null,
      "Lớp CSB chưa có mẫu Bảng chấm Demo riêng không được tự mượn mẫu của PTA"
    );

    // Scan, save draft, and approve for PTB and CSB
    for (const [cid, sid, sName, fPath] of [
      [testClassPtb, "STU_PTB_01", "Võ Quốc Anh", folderPtb1],
      [testClassCsb, "STU_CSB_01", "Đỗ Minh Châu", folderCsb1],
    ] as const) {
      await scanPost(
        makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/scan", {
          classId: cid,
          folderPath: tempRoot,
          sessionNumber: 12,
        })
      );
      await saveDraftPost(
        makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/save-draft", {
          classId: cid,
          studentId: sid,
          sessionNumber: 12,
          localFolderPath: fPath,
          isConfirmedByTeacher: true,
          projectTitle: `Dự Án ${sName}`,
          thumbnailPath: getDefaultMindxLogoThumbnailPath(),
          teacherComment: `- Tiến độ Buổi 12 lớp ${cid}: Hoàn thành tốt giai đoạn 1.`,
        })
      );
      const draftRow = spckSessionRepo.findOne(cid, sid, 12)!;
      const appResp = await approvePost(
        makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/approve", {
          classId: cid,
          sessionNumber: 12,
          studentIds: [sid],
          reviewedItems: [
            {
              studentId: sid,
              draftVersion: draftRow.draftVersion,
              localFolderPath: fPath,
              isConfirmedByTeacher: true,
              projectTitle: draftRow.projectTitle,
              thumbnailPath: draftRow.thumbnailPath,
              screenshots: JSON.parse(draftRow.screenshotsJson || "[]"),
              attachments: JSON.parse(draftRow.attachmentsJson || "[]"),
              youtubeUrls: [],
              relatedLinks: [],
              teacherComment: draftRow.teacherComment,
            },
          ],
        })
      );
      const appData = await appResp.json();
      assert.strictEqual(
        appData.success,
        true,
        `Duyệt SPCK Buổi 12 cho lớp ${cid} phải thành công`
      );
      assert.strictEqual(appData.approvedCount, 1);
    }
    console.log("  -> PASS T14.");

    // =========================================================================
    // T15: Báo cáo đủ kết quả đợt nộp (Thành công + Bị bỏ qua + Lỗi)
    // =========================================================================
    console.log("\n[T15] Kiểm tra tổng hợp đầy đủ kết quả duyệt/nộp khi có bài bị bỏ qua...");
    // STU_V270_02 is ready on Session 12; STU_V270_03 has no comment so it will be skipped during batch approve
    spckUploadRepo.upsert({
      classId: testClassCoding,
      studentId: "STU_V270_03",
      localFolderPath: path.join(tempRoot, "Pham Gia Huy"),
      matchScore: 1.0,
      isConfirmedByTeacher: 1,
      projectTitle: "SPCK Phạm Gia Huy",
      thumbnailPath: getDefaultMindxLogoThumbnailPath(),
      screenshotsJson: "[]",
      attachmentsJson: "[]",
      youtubeUrlsJson: "[]",
      relatedLinksJson: "[]",
      teacherComment: "",
      contentHash: "",
      status: "WAITING_APPROVAL",
    });
    const stu2Cur12 = spckSessionRepo.findOne(testClassCoding, "STU_V270_02", 12)!;
    const stu3Cur12 = spckSessionRepo.getOrInitSessionDraft(testClassCoding, "STU_V270_03", 12);

    const batchApproveResp = await approvePost(
      makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/approve", {
        classId: testClassCoding,
        sessionNumber: 12,
        studentIds: ["STU_V270_02", "STU_V270_03"],
        reviewedItems: [
          {
            studentId: "STU_V270_02",
            draftVersion: stu2Cur12.draftVersion,
            localFolderPath: stu2Cur12.localFolderPath,
            isConfirmedByTeacher: true,
            projectTitle: stu2Cur12.projectTitle,
            thumbnailPath: stu2Cur12.thumbnailPath,
            screenshots: [],
            attachments: [],
            youtubeUrls: [],
            relatedLinks: [],
            teacherComment: stu2Cur12.teacherComment,
          },
          {
            studentId: "STU_V270_03",
            draftVersion: stu3Cur12.draftVersion,
            localFolderPath: stu3Cur12.localFolderPath,
            isConfirmedByTeacher: true,
            projectTitle: stu3Cur12.projectTitle,
            thumbnailPath: stu3Cur12.thumbnailPath,
            screenshots: [],
            attachments: [],
            youtubeUrls: [],
            relatedLinks: [],
            teacherComment: "",
          },
        ],
      })
    );
    const batchApproveJson = await batchApproveResp.json();
    assert.strictEqual(batchApproveJson.success, true);
    assert.deepStrictEqual(batchApproveJson.approvedStudentIds, ["STU_V270_02"]);
    assert.strictEqual(batchApproveJson.skipped.length, 1);
    assert.strictEqual(batchApproveJson.skipped[0].studentId, "STU_V270_03");
    assert.ok(batchApproveJson.skipped[0].reason.includes("Bình luận của giáo viên*"));

    // Run a mixed batch upload via SpckUploader.runUploadInternal producing 1 VERIFIED + 1 FAILED + 1 WAITING_APPROVAL (skipped/demoted)
    {
      studentRepo.upsert({
        classId: testClassCoding,
        studentId: "STU_V270_FAIL",
        fullName: "Hoàng Lỗi Mạng",
        isActive: 1,
      });
      const folderFail = path.join(tempRoot, "Hoang Loi Mang");
      fs.mkdirSync(folderFail, { recursive: true });
      spckUploadRepo.upsert({
        classId: testClassCoding,
        studentId: "STU_V270_FAIL",
        localFolderPath: folderFail,
        matchScore: 1.0,
        isConfirmedByTeacher: 1,
        projectTitle: "SPCK Hoàng Lỗi Mạng",
        thumbnailPath: getDefaultMindxLogoThumbnailPath(),
        screenshotsJson: "[]",
        attachmentsJson: "[]",
        youtubeUrlsJson: "[]",
        relatedLinksJson: "[]",
        teacherComment: "- Nhận xét đầy đủ để duyệt.",
        contentHash: "",
        status: "WAITING_APPROVAL",
      });
      spckSessionRepo.saveSessionDraft({
        classId: testClassCoding,
        studentId: "STU_V270_FAIL",
        sessionNumber: 12,
        localFolderPath: folderFail,
        isConfirmedByTeacher: 1,
        projectTitle: "SPCK Hoàng Lỗi Mạng — Buổi 12 (GĐ1)",
        thumbnailPath: getDefaultMindxLogoThumbnailPath(),
        teacherComment: "- Nhận xét đầy đủ để duyệt.",
      });
      spckSessionRepo.approveSessionDraft(testClassCoding, "STU_V270_FAIL", 12);

      // Build a custom page where STU_V270_02 succeeds (VERIFIED) and STU_V270_FAIL lacks a student container so it throws (FAILED),
      // while STU_V270_03 is unapproved (WAITING_APPROVAL -> demotedCount = 1)
      const mixedStubPage = (SpckUploader as any).ensureSyntheticStubPage(
        {},
        testClassCoding,
        [
          {
            record: spckUploadRepo.findOne(testClassCoding, "STU_V270_02")!,
            expectedHash: spckSessionRepo.findOne(testClassCoding, "STU_V270_02", 12)!
              .approvedContentHash,
            screenshots: [],
            attachments: [],
            youtubeUrls: [],
            relatedLinks: [],
          },
        ]
      );
      const origLocator = mixedStubPage.locator.bind(mixedStubPage);
      mixedStubPage.locator = (sel: string) => {
        if (sel.includes("STU_V270_FAIL")) {
          return { count: async () => 0 };
        }
        return origLocator(sel);
      };

      const mixedBatchUpload = await SpckUploader.runUploadInternal({
        classId: testClassCoding,
        sessionNumber: 12,
        studentIds: ["STU_V270_02", "STU_V270_FAIL", "STU_V270_03"],
        customPage: mixedStubPage,
        skipNavigation: true,
      });
      assert.strictEqual(mixedBatchUpload.totalRequested, 3);
      assert.strictEqual(
        mixedBatchUpload.verifiedCount,
        1,
        "Đợt nộp hỗn hợp phải có đúng 1 học viên VERIFIED"
      );
      assert.strictEqual(
        mixedBatchUpload.failedCount,
        1,
        "Đợt nộp hỗn hợp phải có đúng 1 học viên FAILED"
      );
      assert.strictEqual(
        mixedBatchUpload.demotedCount,
        1,
        "Đợt nộp hỗn hợp phải có đúng 1 học viên WAITING_APPROVAL (bỏ qua)"
      );
      db.prepare(`DELETE FROM spck_session_submissions WHERE classId = ? AND studentId = ?`).run(
        testClassCoding,
        "STU_V270_FAIL"
      );
      db.prepare(`DELETE FROM spck_uploads WHERE classId = ? AND studentId = ?`).run(
        testClassCoding,
        "STU_V270_FAIL"
      );
    }
    console.log("  -> PASS T15.");

    // =========================================================================
    // T16: Đổi gán học viên cho thư mục (tách gán cũ, bảo toàn lịch sử đã nộp, chặn tác vụ nền ghi nhầm)
    // =========================================================================
    console.log("\n[T16] Kiểm tra đổi gán học viên cho thư mục (A -> B): giữ lịch sử của A & chặn ghi đè nền...");
    // F04: A rejected reassignment (stale expectedVersion for Student B -> HTTP 409) MUST NOT detach Student A!
    const stu3BeforeConflict = spckSessionRepo.getOrInitSessionDraft(
      testClassCoding,
      "STU_V270_03",
      12
    );
    spckSessionRepo.saveSessionDraft({
      classId: testClassCoding,
      studentId: "STU_V270_03",
      sessionNumber: 12,
      teacherNote: "Tăng version của STU_V270_03 trước khi thử chuyển thư mục lỗi",
      updateSharedPool: false,
    });
    const rejectedReassignResp = await saveDraftPost(
      makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/save-draft", {
        classId: testClassCoding,
        studentId: "STU_V270_03",
        sessionNumber: 12,
        expectedVersion: stu3BeforeConflict.draftVersion, // Stale!
        localFolderPath: folderStu1,
        isConfirmedByTeacher: true,
        reassignFromStudentId: "STU_V270_01",
        reassignFolder: true,
        projectTitle: "Thử chuyển lỗi",
        thumbnailPath: thumb16x9Path,
      })
    );
    assert.strictEqual(
      rejectedReassignResp.status,
      409,
      "Chuyển thư mục với expectedVersion cũ phải bị từ chối với HTTP 409"
    );
    assert.strictEqual(
      spckUploadRepo.findOne(testClassCoding, "STU_V270_01")?.localFolderPath,
      folderStu1,
      "Khi yêu cầu chuyển thư mục bị từ chối (409), học viên A vẫn phải giữ nguyên thư mục"
    );

    // Valid reassignment of folderStu1 from STU_V270_01 (Student A) to STU_V270_03 (Student B) via save-draft
    const reassignResp = await saveDraftPost(
      makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/save-draft", {
        classId: testClassCoding,
        studentId: "STU_V270_03",
        sessionNumber: 12,
        localFolderPath: folderStu1,
        isConfirmedByTeacher: true,
        reassignFromStudentId: "STU_V270_01",
        reassignFolder: true,
        projectTitle: "Web Vũ Trụ Của Gia Huy",
        thumbnailPath: thumb16x9Path,
        attachments: [codeFile1],
        teacherComment: "- Gia Huy tiếp nhận thư mục dự án.",
      })
    );
    const reassignJson = await reassignResp.json();
    assert.strictEqual(reassignJson.success, true);

    // 1. Student A (STU_V270_01) must have localFolderPath detached ('') so there is no duplicate folder conflict,
    //    AND Student A's verified history for Session 12 & 13 MUST remain intact!
    const stuAAfterReassign = spckUploadRepo.findOne(testClassCoding, "STU_V270_01")!;
    assert.strictEqual(
      stuAAfterReassign.localFolderPath,
      "",
      "Khi gán thư mục sang học viên B, học viên A cũ phải được tách liên kết thư mục"
    );
    const stuAHistory = spckSessionRepo.buildStudentSessionHistorySummary(
      testClassCoding,
      "STU_V270_01"
    );
    assert.ok(
      stuAHistory.sessions["12"].lastVerifiedAt,
      "Lịch sử đã nộp Buổi 12 của học viên A phải được giữ nguyên sau khi đổi gán thư mục"
    );
    assert.ok(
      stuAHistory.sessions["13"].lastVerifiedAt,
      "Lịch sử đã nộp Buổi 13 của học viên A phải được giữ nguyên sau khi đổi gán thư mục"
    );

    // 2. A stale background job that started when folderStu1 belonged to STU_V270_01 tries to call updateSharedResources
    //    with expectedFolderPath = folderStu1 for STU_V270_01 -> must be rejected!
    const staleBgUpdate = spckUploadRepo.updateSharedResources({
      classId: testClassCoding,
      studentId: "STU_V270_01",
      expectedFolderPath: folderStu1,
      thumbnailPath: thumb4x3Path,
    });
    assert.strictEqual(
      staleBgUpdate.updated,
      false,
      "Tác vụ nền cũ mang expectedFolderPath của thư mục đã chuyển sang học viên khác phải bị chặn"
    );

    // 3. F05: Rescanning the directory must preserve the teacher-confirmed reassignment (STU_V270_03 keeps folderStu1, STU_V270_01 stays detached)!
    const rescanAfterReassign = await scanPost(
      makeLocalJsonRequest("http://127.0.0.1:3000/api/spck/scan", {
        classId: testClassCoding,
        folderPath: tempRoot,
        sessionNumber: 12,
      })
    );
    assert.strictEqual(rescanAfterReassign.status, 200);
    assert.strictEqual(
      spckUploadRepo.findOne(testClassCoding, "STU_V270_03")?.localFolderPath,
      folderStu1,
      "Quét lại thư mục phải tôn trọng ghép nối giáo viên đã xác nhận (STU_V270_03 giữ folderStu1)"
    );
    assert.strictEqual(
      spckUploadRepo.findOne(testClassCoding, "STU_V270_01")?.localFolderPath,
      "",
      "Quét lại thư mục không được tự khôi phục liên kết cũ đã bị giáo viên tách khỏi STU_V270_01"
    );
    console.log("  -> PASS T16.");

    console.log("\n=== HOÀN TẤT: TẤT CẢ 16 KỊCH BẢN (T01 -> T16) ĐỀU ĐẠT 100% ===");
  } finally {
    cleanupTestArtifacts();
  }
}

runV270Tests().catch((err) => {
  console.error("KIỂM THỬ v2.7.0 THẤT BẠI:", err);
  process.exit(1);
});
