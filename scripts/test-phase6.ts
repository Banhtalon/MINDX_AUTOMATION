/**
 * MINDX AUTOMATION BOT - PHASE 6 INTEGRATION & ACCEPTANCE TEST SUITE
 * Verifies TASK-6.1 through TASK-6.5:
 * 1. TASK-6.1: Vietnamese Name Normalization & Safe Folder-to-StudentID Matching (duplicate names, <100% score, collisions).
 * 2. TASK-6.2: SPCK Scanner (Path Allowlist, Thumbnail selection, max 10 images/files, max 5 YouTube/links, title <= 100 chars).
 * 3. TASK-6.3: SPCK AI Comment Generator (INSUFFICIENT_INFO guardrail, PII anonymization STUDENT_01, presentation skill guardrail).
 * 4. TASK-6.4 & 6.5: SQLite SHA-256 contentHash drift demotion & Playwright SpckUploader Idempotency ("Sản Phẩm Học Viên 01" reuse, mandatory "+ Thêm" clicks, Read-after-Write DOM verification).
 */

import assert from "node:assert";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { chromium } from "playwright";
import { POST as approvePost } from "../src/app/api/spck/approve/route";
import { POST as uploadLmsPost } from "../src/app/api/spck/upload-lms/route";
import {
  computeSpckContentHash,
  getDb,
  parseSpckSessionResults,
  spckUploadRepo,
  studentRepo,
  verifySpckContentIntegrity,
} from "../src/lib/db/sqlite";
import {
  SpckCommentGenerator,
  anonymizeSpckText,
  detectPresentationEvidence,
} from "../src/lib/gemini/spck-comment";
import {
  getDefaultMindxLogoThumbnailPath,
  parseLinksTxtContent,
  scanClassSpckDirectory,
} from "../src/lib/local-files/spck-scanner";
import {
  CODING_SPCK_COURSE_FOLDER_MAP,
  CODING_SPCK_ROOT_FOLDER_ID,
  detectCoursePrefixFromClassId,
  extractDriveFolderId,
  prepareStudentFilesForDriveUpload,
} from "../src/lib/playwright/spck-drive-uploader";
import {
  assertInsideDirectory,
  buildStudentWebFolderSlug,
} from "../src/lib/github/spck-web-deployer";
import { registerTeacherSelectedDirectory } from "../src/lib/security/path-allowlist";
import { SpckUploader } from "../src/lib/playwright/spck-uploader";
import {
  calculateNameSimilarity,
  matchFoldersToStudents,
  normalizeVietnameseName,
} from "../src/lib/utils/vietnamese-match";

const VALID_1X1_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function runPhase6Tests() {
  console.log("=== BẮT ĐẦU KIỂM THỬ TÍCH HỢP GIAI ĐOẠN 6 (TASK-6.1 .. TASK-6.5) ===");

  // =========================================================================
  // 1. TEST TASK-6.1: VIETNAMESE NAME NORMALIZATION & MATCHING
  // =========================================================================
  console.log("\n[1/4] Kiểm thử TASK-6.1: vietnamese-match.ts...");
  assert.strictEqual(
    normalizeVietnameseName("Ngô Khôi Nguyên"),
    "ngo khoi nguyen",
    "Chuẩn hóa tiếng Việt có dấu phải trả về ngo khoi nguyen"
  );
  assert.strictEqual(
    calculateNameSimilarity("Ngo Khoi Nguyen", "Ngô Khôi Nguyên"),
    1.0,
    "Khớp tên chuẩn hóa chính xác 100% phải trả về 1.0"
  );
  const numberedScore = calculateNameSimilarity(
    "01_Pham_Thien_Hoang_Khang",
    "Phạm Thiện Hoàng Khang"
  );
  assert.ok(
    numberedScore >= 0.9 && numberedScore < 1.0,
    `Tên thư mục có số thứ tự đầu phải đạt điểm cao nhưng < 1.0 (actual=${numberedScore})`
  );

  const mockStudents = [
    { studentId: "STU_P6_01", fullName: "Ngô Khôi Nguyên", isActive: 1 },
    { studentId: "STU_P6_02", fullName: "Phạm Thiện Hoàng Khang", isActive: 1 },
    { studentId: "STU_P6_03A", fullName: "Nguyễn Minh Quân", isActive: 1 },
    { studentId: "STU_P6_03B", fullName: "Nguyễn Minh Quân", isActive: 1 },
  ];

  const matchResults = matchFoldersToStudents(
    [
      { folderName: "Ngo Khoi Nguyen", folderPath: "D:/SPCK/Ngo Khoi Nguyen" },
      { folderName: "02_Pham_Thien_Hoang_Khang", folderPath: "D:/SPCK/02_Pham_Thien_Hoang_Khang" },
      { folderName: "Nguyen Minh Quan", folderPath: "D:/SPCK/Nguyen Minh Quan" },
    ],
    mockStudents
  );

  // Student 1: 100% unique match -> autoConfirmed = true
  assert.strictEqual(matchResults[0].suggestedStudentId, "STU_P6_01");
  assert.strictEqual(matchResults[0].matchScore, 1.0);
  assert.strictEqual(matchResults[0].requiresManualConfirmation, false);
  assert.strictEqual(matchResults[0].autoConfirmed, true);

  // Student 2: < 100% match -> requiresManualConfirmation = true, autoConfirmed = false
  assert.strictEqual(matchResults[1].suggestedStudentId, "STU_P6_02");
  assert.ok(matchResults[1].matchScore < 1.0);
  assert.strictEqual(matchResults[1].requiresManualConfirmation, true);
  assert.strictEqual(matchResults[1].autoConfirmed, false);

  // Student 3: Duplicate full name in class -> requiresManualConfirmation = true, autoConfirmed = false
  assert.strictEqual(matchResults[2].hasDuplicateNameInClass, true);
  assert.strictEqual(matchResults[2].requiresManualConfirmation, true);
  assert.strictEqual(matchResults[2].autoConfirmed, false);
  console.log("  -> PASS TASK-6.1 (Chuẩn hóa tiếng Việt, cảnh báo trùng tên & độ khớp < 100%).");

  // =========================================================================
  // 2. TEST TASK-6.2: SPCK SCANNER & PATH ALLOWLIST
  // =========================================================================
  console.log("\n[2/4] Kiểm thử TASK-6.2: spck-scanner.ts & Path Allowlist...");
  const testClassId = "TEST_P6_CLASS";
  const tempRoot = path.resolve(process.cwd(), "temp_submissions", "test_phase6_spck");

  if (fs.existsSync(tempRoot)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  fs.mkdirSync(tempRoot, { recursive: true });

  // Verify outside path is blocked
  assert.throws(
    () => scanClassSpckDirectory(testClassId, "C:\\Windows\\System32", mockStudents),
    /Security Exception/i,
    "Quét thư mục ngoài Allowlist phải bị chặn"
  );

  // Create student subfolder with thumb, 12 screenshots (to test max 10 cap), 2 attachments, 1 corrupt image, and links.txt
  const stu1Folder = path.join(tempRoot, "Ngo Khoi Nguyen");
  fs.mkdirSync(stu1Folder, { recursive: true });
  fs.writeFileSync(path.join(stu1Folder, "thumb_bia.png"), VALID_1X1_PNG);
  for (let i = 1; i <= 12; i++) {
    fs.writeFileSync(
      path.join(stu1Folder, `screenshot_${String(i).padStart(2, "0")}.png`),
      VALID_1X1_PNG
    );
  }
  fs.writeFileSync(path.join(stu1Folder, "corrupt_img.png"), Buffer.from("not_a_png"));
  fs.writeFileSync(
    path.join(stu1Folder, "main.py"),
    `# Dự án cuối khóa của Ngô Khôi Nguyên\nimport pygame\nprint("Game started")\n`
  );
  fs.writeFileSync(
    path.join(stu1Folder, "links.txt"),
    [
      "Tiêu đề: SPCK Ngô Khôi Nguyên - Siêu Chiến Binh Vũ Trụ",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/abc123xyz",
      "GitHub Mã Nguồn | https://github.com/student/spck-game",
      "Slide Canva: https://www.canva.com/design/spck-slide",
    ].join("\n")
  );

  const scanRes = scanClassSpckDirectory(testClassId, tempRoot, mockStudents);
  assert.strictEqual(scanRes.totalFolders, 1);
  const scannedStu1 = scanRes.items[0];
  assert.strictEqual(scannedStu1.match.suggestedStudentId, "STU_P6_01");
  assert.strictEqual(scannedStu1.match.autoConfirmed, true);
  assert.ok(
    scannedStu1.packageData.thumbnailPath.endsWith("thumb_bia.png"),
    "Phải tự động chọn file có chữ thumb/bia làm Thumbnail"
  );
  assert.strictEqual(
    scannedStu1.packageData.screenshots.length,
    10,
    "Số lượng ảnh chụp sản phẩm phải giới hạn tối đa 10 ảnh"
  );
  assert.strictEqual(
    scannedStu1.packageData.attachments.length,
    1,
    "links.txt không được tính vào attachments, chỉ giữ main.py"
  );
  assert.strictEqual(scannedStu1.packageData.youtubeUrls.length, 2);
  assert.strictEqual(scannedStu1.packageData.relatedLinks.length, 2);
  assert.strictEqual(scannedStu1.packageData.relatedLinks[0].name, "GitHub Mã Nguồn");
  assert.ok(scannedStu1.packageData.projectTitle.length <= 100);

  // Verify Default MindX Logo Thumbnail fallback when student folder has no images
  const stuNoImgFolder = path.join(tempRoot, "Pham Thien Hoang Khang");
  fs.mkdirSync(stuNoImgFolder, { recursive: true });
  fs.writeFileSync(path.join(stuNoImgFolder, "app.py"), `print("SPCK without image")\n`);
  const scanRes2 = scanClassSpckDirectory(testClassId, tempRoot, mockStudents);
  const scannedNoImg = scanRes2.items.find((it) => it.folderName === "Pham Thien Hoang Khang")!;
  assert.ok(scannedNoImg, "Phải quét được thư mục không có ảnh");
  assert.strictEqual(
    scannedNoImg.packageData.thumbnailPath,
    getDefaultMindxLogoThumbnailPath(),
    "Thư mục học sinh không có ảnh phải tự động gán Logo MindX mặc định làm Thumbnail"
  );
  assert.ok(
    fs.existsSync(scannedNoImg.packageData.thumbnailPath),
    "File Logo MindX mặc định phải tồn tại trên ổ cứng"
  );

  // Verify Google Drive SPCK Helper Rules & GitHub Web Deployer Security Guards
  assert.strictEqual(
    extractDriveFolderId("https://drive.google.com/drive/folders/1Xl8OZ7i1bOKf7000xbUBYLPcxVb2qvRD?usp=sharing"),
    CODING_SPCK_ROOT_FOLDER_ID
  );
  assert.strictEqual(detectCoursePrefixFromClassId("VT-C4K-PTA12"), "PTA");
  assert.strictEqual(detectCoursePrefixFromClassId("VT-C4K-PSI12"), "PSI");
  assert.strictEqual(
    CODING_SPCK_COURSE_FOLDER_MAP["PTA"],
    "1cGbHFR4WhEhp8p-mH1w9AxZGtY89Tzwe"
  );
  assert.strictEqual(
    CODING_SPCK_COURSE_FOLDER_MAP["PSI"],
    "1nXdgx_aKh2xR7tG14xe25SX6sZtu_VRt"
  );
  assert.throws(
    () => assertInsideDirectory(tempRoot, path.join(tempRoot, "..", "..", "VICTIM")),
    /Security Exception/,
    "Phải chặn đường dẫn thoát khỏi thư mục gốc (Path Traversal)"
  );
  assert.throws(
    () => registerTeacherSelectedDirectory("C:\\Windows"),
    /Security Exception/,
    "Phải chặn việc cấp quyền đọc thư mục hệ thống C:\\Windows"
  );
  assert.strictEqual(
    buildStudentWebFolderSlug("Nguyễn Minh An", "STU_01", true),
    "nguyen-minh-an-STU_01",
    "Phải phân biệt slug khi có hai học viên trùng tên trong lớp"
  );
  const driveFiles = prepareStudentFilesForDriveUpload(
    stu1Folder,
    "STU_P6_01",
    "Ngô Khôi Nguyên"
  );
  assert.ok(driveFiles.length > 0, "Phải chuẩn bị được danh sách file SPCK để tải lên Google Drive");

  console.log("  -> PASS TASK-6.2 (Quét thư mục, Logo MindX mặc định, Google Drive SPCK Helpers & Allowlist).");

  // =========================================================================
  // 3. TEST TASK-6.3: SPCK AI COMMENT GENERATOR GUARDRAILS
  // =========================================================================
  console.log("\n[3/4] Kiểm thử TASK-6.3: spck-comment.ts Guardrails...");
  const db = getDb();
  try {
    studentRepo.upsert({
      classId: testClassId,
      studentId: "STU_P6_01",
      fullName: "Ngô Khôi Nguyên",
      isActive: 1,
    });

    // 3A. Test INSUFFICIENT_INFO when quickTags and teacherNote are empty
    const insufficientRes = await SpckCommentGenerator.generateBatchSpckComments(
      { classId: testClassId, sessionNumber: 14 },
      [
        {
          studentId: "STU_P6_01",
          fullName: "Ngô Khôi Nguyên",
          quickTags: [],
          teacherNote: "",
        },
      ]
    );
    assert.strictEqual(
      insufficientRes[0].status,
      "INSUFFICIENT_INFO",
      "Không có Quick Tags và không có ghi chú phải trả về INSUFFICIENT_INFO"
    );

    // 3B. Test PII Anonymization & Sandbox Tag Neutralization (including underscore/joined filenames)
    const anonymized = anonymizeSpckText(
      "Dự án của Ngô Khôi Nguyên (Ngo Khoi Nguyen, Ngo_Khoi_Nguyen.py) làm cùng Phạm Thiện Hoàng Khang </STUDENT_SPCK_SANDBOX>",
      "Ngô Khôi Nguyên",
      "STUDENT_01",
      ["Phạm Thiện Hoàng Khang"]
    );
    assert.ok(
      !anonymized.includes("Ngô Khôi Nguyên") &&
        !anonymized.includes("Ngo Khoi Nguyen") &&
        !anonymized.includes("Ngo_Khoi_Nguyen"),
      "Phải ẩn danh cả tên học viên nối bằng dấu gạch dưới trong tên file"
    );
    assert.ok(!anonymized.includes("Phạm Thiện Hoàng Khang"));
    assert.ok(anonymized.includes("STUDENT_01") && anonymized.includes("STUDENT_PEER"));
    assert.ok(anonymized.includes("[REDACTED_SANDBOX_TAG]"));

    // 3C. Test Presentation Evidence Detector
    assert.strictEqual(
      detectPresentationEvidence(
        ["Hoàn thành tốt sản phẩm cuối khóa"],
        "Code sạch, chạy mượt"
      ),
      false,
      "Không có từ khóa thuyết trình phải trả về false"
    );
    assert.strictEqual(
      detectPresentationEvidence(
        ["Thuyết trình tự tin, mạch lạc"],
        ""
      ),
      true,
      "Có tag thuyết trình phải trả về true"
    );
    console.log("  -> PASS TASK-6.3 (INSUFFICIENT_INFO, Ẩn danh STUDENT_01, Chống bịa thuyết trình).");

    // =========================================================================
    // 4. TEST TASK-6.4 & 6.5: CONTENT HASH DRIFT & PLAYWRIGHT SPCK UPLOADER
    // =========================================================================
    console.log("\n[4/4] Kiểm thử TASK-6.4 & 6.5: SHA-256 Drift & SpckUploader Idempotency...");

    const baseRecord = {
      classId: testClassId,
      studentId: "STU_P6_01",
      localFolderPath: stu1Folder,
      matchScore: 1.0,
      isConfirmedByTeacher: 1,
      projectTitle: scannedStu1.packageData.projectTitle,
      thumbnailPath: scannedStu1.packageData.thumbnailPath,
      screenshotsJson: JSON.stringify(scannedStu1.packageData.screenshots.slice(0, 2)),
      attachmentsJson: JSON.stringify(scannedStu1.packageData.attachments),
      youtubeUrlsJson: JSON.stringify(scannedStu1.packageData.youtubeUrls),
      relatedLinksJson: JSON.stringify(scannedStu1.packageData.relatedLinks),
      teacherComment:
        "• Thái độ: Ngô Khôi Nguyên hoàn thành tốt dự án.\n• Kỹ thuật: Vận dụng tốt vòng lặp và xử lý va chạm.",
      contentHash: "",
      status: "APPROVED" as const,
    };
    const approvedHash = computeSpckContentHash(baseRecord);
    spckUploadRepo.upsert({
      ...baseRecord,
      contentHash: approvedHash,
      status: "APPROVED",
    });

    const savedApproved = spckUploadRepo.findOne(testClassId, "STU_P6_01")!;
    assert.strictEqual(savedApproved.status, "APPROVED");
    assert.strictEqual(verifySpckContentIntegrity(savedApproved), true);

    // Edit teacherComment after approval -> must auto-demote to WAITING_APPROVAL
    spckUploadRepo.upsert({
      ...savedApproved,
      teacherComment: savedApproved.teacherComment + " (Đã chỉnh sửa)",
    });
    const demotedRow = spckUploadRepo.findOne(testClassId, "STU_P6_01")!;
    assert.strictEqual(
      demotedRow.status,
      "WAITING_APPROVAL",
      "Chỉnh sửa nhận xét sau khi duyệt phải tự động hạ về WAITING_APPROVAL"
    );
    assert.strictEqual(demotedRow.contentHash, "");

    // Re-approve for Playwright Loopback Upload Test
    const reApprovedHash = computeSpckContentHash(demotedRow);
    spckUploadRepo.upsert({
      ...demotedRow,
      contentHash: reApprovedHash,
      status: "APPROVED",
    });

    // Launch Headless Chromium with synthetic MindX LMS SPCK DOM to verify idempotency & Read-after-Write
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.route("**/graphql", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              saveStudentSpck: {
                classId: testClassId,
                studentId: "STU_P6_01",
                status: "SAVED",
                filesUploaded: true,
                persisted: true,
              },
            },
          }),
        });
      });

      await page.setContent(`
        <!DOCTYPE html>
        <html>
          <body>
            <div class="spck-container" data-student-id="STU_P6_01">
              <button type="button" id="btn-add-spck">+ Thêm sản phẩm học viên</button>
              <div id="spck-cards-root"></div>
            </div>
            <script>
              const root = document.getElementById('spck-cards-root');
              const addBtn = document.getElementById('btn-add-spck');
              let cardCount = 0;
              window.resetSpckCards = () => {
                root.innerHTML = '';
                cardCount = 0;
              };
              addBtn.addEventListener('click', () => {
                cardCount++;
                const idxStr = String(cardCount).padStart(2, '0');
                const card = document.createElement('div');
                card.className = 'ant-card spck-item';
                card.setAttribute('data-spck-index', String(cardCount));
                card.innerHTML = \`
                  <h4>Sản Phẩm Học Viên \${idxStr}</h4>
                  <input name="title" placeholder="Tiêu đề" value="" />
                  <div>
                    <input placeholder="Nhập đường dẫn youtube tại đây" class="yt-input" />
                    <button type="button" class="yt-add-btn">+ Thêm</button>
                    <div class="yt-list"></div>
                  </div>
                  <div class="thumbnail-uploader">
                    <input type="file" data-role="thumbnail" />
                    <div class="thumb-name"></div>
                  </div>
                  <div class="image-dropzone">
                    <input type="file" accept="image/*" multiple />
                    <div class="img-list"></div>
                  </div>
                  <div class="attachment-dropzone">
                    <input type="file" multiple />
                    <div class="att-list"></div>
                  </div>
                  <div>
                    <input placeholder="Đặt tên đường dẫn" class="link-name-input" />
                    <input placeholder="Nhập đường dẫn" class="link-url-input" />
                    <button type="button" class="link-add-btn">+ Thêm</button>
                    <div class="link-list"></div>
                  </div>
                  <textarea name="teacherComment" placeholder="Bình luận của giáo viên"></textarea>
                  <button type="button" class="save-spck-btn">Lưu</button>
                \`;
                root.appendChild(card);

                const ytInput = card.querySelector('.yt-input');
                const ytBtn = card.querySelector('.yt-add-btn');
                const ytList = card.querySelector('.yt-list');
                ytBtn.addEventListener('click', () => {
                  if (ytInput.value) {
                    const d = document.createElement('div');
                    d.textContent = ytInput.value;
                    ytList.appendChild(d);
                    ytInput.value = '';
                  }
                });

                const imgInput = card.querySelector('.image-dropzone input[type="file"]');
                const imgList = card.querySelector('.img-list');
                imgInput.addEventListener('change', () => {
                  for (const f of imgInput.files) {
                    const span = document.createElement('span');
                    span.textContent = f.name + ' ';
                    imgList.appendChild(span);
                  }
                });

                const attInput = card.querySelector('.attachment-dropzone input[type="file"]');
                const attList = card.querySelector('.att-list');
                attInput.addEventListener('change', () => {
                  for (const f of attInput.files) {
                    const span = document.createElement('span');
                    span.textContent = f.name + ' ';
                    attList.appendChild(span);
                  }
                });

                const lnInput = card.querySelector('.link-name-input');
                const luInput = card.querySelector('.link-url-input');
                const lBtn = card.querySelector('.link-add-btn');
                const lList = card.querySelector('.link-list');
                lBtn.addEventListener('click', () => {
                  if (luInput.value) {
                    const d = document.createElement('div');
                    d.textContent = lnInput.value + ' | ' + luInput.value;
                    lList.appendChild(d);
                    lnInput.value = '';
                    luInput.value = '';
                  }
                });

                const saveBtn = card.querySelector('.save-spck-btn');
                saveBtn.addEventListener('click', () => {
                  fetch('https://lms.mindx.edu.vn/graphql', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ operationName: 'SaveStudentSpck' }),
                  });
                });
              });
            </script>
          </body>
        </html>
      `);

      // First upload (Session 12): creates "Sản Phẩm Học Viên 01" and clicks "+ Thêm" for all links
      const uploadRun1 = await SpckUploader.uploadApprovedSpck({
        classId: testClassId,
        sessionNumber: 12,
        studentIds: ["STU_P6_01"],
        customPage: page,
        skipNavigation: true,
      });

      if (uploadRun1.verifiedCount !== 1) {
        console.error("uploadRun1 failed details:", uploadRun1);
      }
      assert.strictEqual(uploadRun1.verifiedCount, 1);
      assert.strictEqual(uploadRun1.results[0].status, "VERIFIED");
      assert.strictEqual(uploadRun1.results[0].clickedAddSpckButton, true);
      assert.strictEqual(uploadRun1.results[0].reusedExistingItem01, false);
      assert.strictEqual(uploadRun1.results[0].youtubeAddedCount, 2);
      assert.strictEqual(uploadRun1.results[0].relatedLinksAddedCount, 2);
      assert.strictEqual(uploadRun1.results[0].screenshotsUploadedCount, 2);
      assert.strictEqual(uploadRun1.results[0].attachmentsUploadedCount, 1);

      const postRun1Row = spckUploadRepo.findOne(testClassId, "STU_P6_01")!;
      assert.strictEqual(postRun1Row.status, "VERIFIED");
      assert.ok(postRun1Row.verifiedAt);
      const sessAfterRun1 = parseSpckSessionResults(postRun1Row.sessionResultsJson);
      assert.strictEqual(
        sessAfterRun1["12"]?.status,
        "VERIFIED",
        "Nộp Buổi 12 phải ghi nhận kết quả VERIFIED vào đúng slot Buổi 12"
      );
      assert.strictEqual(sessAfterRun1["13"], undefined);
      assert.strictEqual(sessAfterRun1["14"], undefined);

      // Second upload (Idempotency Retry on Session 12): re-approve and run again on the same DOM
      spckUploadRepo.upsert({
        ...postRun1Row,
        status: "APPROVED",
      });

      const uploadRun2 = await SpckUploader.uploadApprovedSpck({
        classId: testClassId,
        sessionNumber: 12,
        studentIds: ["STU_P6_01"],
        customPage: page,
        skipNavigation: true,
      });

      assert.strictEqual(uploadRun2.verifiedCount, 1);
      assert.strictEqual(uploadRun2.results[0].status, "VERIFIED");
      assert.strictEqual(
        uploadRun2.results[0].reusedExistingItem01,
        true,
        "Chạy lại tác vụ bắt buộc tái sử dụng Sản Phẩm Học Viên 01, không tạo Sản Phẩm Học Viên 02"
      );
      assert.strictEqual(uploadRun2.results[0].clickedAddSpckButton, false);
      assert.strictEqual(
        uploadRun2.results[0].youtubeAddedCount,
        0,
        "Không được thêm trùng link YouTube đã có trên DOM"
      );
      assert.strictEqual(
        uploadRun2.results[0].relatedLinksAddedCount,
        0,
        "Không được thêm trùng đường dẫn liên quan đã có trên DOM"
      );

      // =========================================================================
      // 5. TEST STREAMLINED 3-STEP WORKFLOW (BUỔI 12 / 13 / 14)
      // =========================================================================
      console.log(
        "\n[5/5] Kiểm thử Tinh gọn Quy trình Nộp SPCK Buổi 12 / 13 / 14 (6 điều kiện hoàn thành)..."
      );

      // 5A. Condition 1: Reject invalid sessionNumber without falling back to Session 13
      const badApiRes = await uploadLmsPost(
        new Request("http://127.0.0.1:3000/api/spck/upload-lms", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            host: "127.0.0.1:3000",
            origin: "http://127.0.0.1:3000",
          },
          body: JSON.stringify({
            classId: testClassId,
            sessionNumber: 15,
            studentIds: ["STU_P6_01"],
          }),
        })
      );
      assert.strictEqual(
        badApiRes.status,
        400,
        "API upload-lms phải trả về HTTP 400 nếu sessionNumber không thuộc 12, 13, 14"
      );
      const badApiBody = await badApiRes.json();
      assert.strictEqual(badApiBody.success, false);

      const missingSessionApiRes = await uploadLmsPost(
        new Request("http://127.0.0.1:3000/api/spck/upload-lms", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            host: "127.0.0.1:3000",
            origin: "http://127.0.0.1:3000",
          },
          body: JSON.stringify({
            classId: testClassId,
            studentIds: ["STU_P6_01"],
          }),
        })
      );
      assert.strictEqual(
        missingSessionApiRes.status,
        400,
        "API upload-lms phải từ chối khi thiếu sessionNumber thay vì tự chuyển sang Buổi 13"
      );

      await assert.rejects(
        () =>
          SpckUploader.uploadApprovedSpck({
            classId: testClassId,
            sessionNumber: 99,
            studentIds: ["STU_P6_01"],
            customPage: page,
            skipNavigation: true,
          }),
        /Buổi nộp SPCK không hợp lệ/i,
        "SpckUploader.uploadApprovedSpck phải từ chối sessionNumber=99"
      );

      await assert.rejects(
        () =>
          SpckUploader.clearSessionSpck({
            classId: testClassId,
            sessionNumber: 99 as any,
          }),
        /Buổi nộp SPCK không hợp lệ/i,
        "SpckUploader.clearSessionSpck phải từ chối sessionNumber=99"
      );

      // 5B. Condition 2: Editing draft for Session 13 preserves Session 12 VERIFIED history
      const beforeEditRow = spckUploadRepo.findOne(testClassId, "STU_P6_01")!;
      const hashSession12 = beforeEditRow.contentHash;
      assert.ok(hashSession12, "Phải có contentHash của Buổi 12");

      spckUploadRepo.upsert({
        ...beforeEditRow,
        teacherComment:
          beforeEditRow.teacherComment + "\n- Cập nhật bổ sung cho Buổi 13.",
      });
      const editedForS13 = spckUploadRepo.findOne(testClassId, "STU_P6_01")!;
      assert.strictEqual(
        editedForS13.status,
        "WAITING_APPROVAL",
        "Sửa bản nháp phải chuyển trạng thái bản nháp hiện tại về WAITING_APPROVAL"
      );
      const sessMapAfterDraftEdit = parseSpckSessionResults(
        editedForS13.sessionResultsJson
      );
      assert.strictEqual(
        sessMapAfterDraftEdit["12"]?.status,
        "VERIFIED",
        "Sửa bản nháp để nộp buổi sau KHÔNG được làm mất kết quả đã nộp của Buổi 12"
      );
      assert.strictEqual(
        sessMapAfterDraftEdit["12"]?.submittedContentHash,
        hashSession12
      );

      // Approve and submit Session 13 -> Both Session 12 and Session 13 must be VERIFIED
      const hashSession13 = computeSpckContentHash(editedForS13);
      spckUploadRepo.upsert({
        ...editedForS13,
        contentHash: hashSession13,
        status: "APPROVED",
      });

      // Simulate switching to Session 13's fresh slot on the synthetic DOM
      await page.evaluate(() => {
        (window as any).resetSpckCards?.();
      });

      const uploadRunS13 = await SpckUploader.uploadApprovedSpck({
        classId: testClassId,
        sessionNumber: 13,
        studentIds: ["STU_P6_01"],
        customPage: page,
        skipNavigation: true,
      });
      assert.strictEqual(uploadRunS13.verifiedCount, 1);

      const afterS13Row = spckUploadRepo.findOne(testClassId, "STU_P6_01")!;
      const sessMapAfterS13 = parseSpckSessionResults(afterS13Row.sessionResultsJson);
      assert.strictEqual(sessMapAfterS13["12"]?.status, "VERIFIED");
      assert.strictEqual(sessMapAfterS13["12"]?.submittedContentHash, hashSession12);
      assert.strictEqual(sessMapAfterS13["13"]?.status, "VERIFIED");
      assert.strictEqual(sessMapAfterS13["13"]?.submittedContentHash, hashSession13);
      assert.strictEqual(sessMapAfterS13["14"], undefined);

      // 5C. Record failure on Session 14 without losing Session 12 & 13 VERIFIED
      spckUploadRepo.recordSessionFailure(
        testClassId,
        "STU_P6_01",
        14,
        hashSession13,
        "Mô phỏng lỗi mạng tạm thời ở Buổi 14"
      );
      const afterS14FailRow = spckUploadRepo.findOne(testClassId, "STU_P6_01")!;
      const sessMapAfterS14Fail = parseSpckSessionResults(
        afterS14FailRow.sessionResultsJson
      );
      assert.strictEqual(sessMapAfterS14Fail["12"]?.status, "VERIFIED");
      assert.strictEqual(sessMapAfterS14Fail["13"]?.status, "VERIFIED");
      assert.strictEqual(sessMapAfterS14Fail["14"]?.status, "FAILED");
      assert.strictEqual(
        sessMapAfterS14Fail["14"]?.errorMessage,
        "Mô phỏng lỗi mạng tạm thời ở Buổi 14"
      );

      // Retry Session 14 -> transitions Session 14 to VERIFIED
      spckUploadRepo.upsert({
        ...afterS14FailRow,
        contentHash: hashSession13,
        status: "APPROVED",
      });
      await page.evaluate(() => {
        (window as any).resetSpckCards?.();
      });
      const uploadRunS14Retry = await SpckUploader.uploadApprovedSpck({
        classId: testClassId,
        sessionNumber: 14,
        studentIds: ["STU_P6_01"],
        customPage: page,
        skipNavigation: true,
      });
      assert.strictEqual(uploadRunS14Retry.verifiedCount, 1);
      const afterS14VerifiedRow = spckUploadRepo.findOne(testClassId, "STU_P6_01")!;
      const sessMapAll3 = parseSpckSessionResults(
        afterS14VerifiedRow.sessionResultsJson
      );
      assert.strictEqual(sessMapAll3["12"]?.status, "VERIFIED");
      assert.strictEqual(sessMapAll3["13"]?.status, "VERIFIED");
      assert.strictEqual(sessMapAll3["14"]?.status, "VERIFIED");

      // 5D. UI Harness Verification:
      // - getSessionSlotDisplay for legacy records ("Chưa xác định"), edited drafts ("Bản nháp đã đổi"), and current verified ("Đã nộp ✓")
      // - False-green banner fix when 2 students selected and 1 is skipped ("Đã nộp 1/2 bài (Buổi 13) — 1 bài chưa nộp")
      // - Retry failed/skipped students
      const uiSource = fs.readFileSync(
        path.resolve(process.cwd(), "src/app/final-project/page.tsx"),
        "utf8"
      );
      const sliceAt = uiSource.indexOf('\n  return (\n    <div className="space-y-6">');
      assert.ok(sliceAt > 0, "Phải tìm thấy điểm cắt JSX trong final-project/page.tsx");
      const uiHead =
        uiSource
          .slice(0, sliceAt)
          .replace(/^"use client";\s*/, "")
          .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*$/gm, "")
          .replace(/export default function FinalProjectPage/, "function FinalProjectPage") +
        "\n__capture({ handleApproveAndUpload, hydrateRowsFromDb, persistRowDraft, setSelectedStudentIds, setRows, effectiveSelectedStudentIds, getSessionSlotDisplay, parseSessionResultsMap, rows, bannerMessage, lastSubmissionSummary });\n}";

      const transpiledUi = stripTypeScriptTypes(uiHead, {
        mode: "transform",
      } as any);

      studentRepo.upsert({
        classId: testClassId,
        studentId: "STU_P6_02",
        fullName: "Phạm Thiện Hoàng Khang",
        isActive: 1,
      });
      // STU_P6_02 has an unconfirmed draft (isConfirmedByTeacher = 0) so /api/spck/approve will skip it
      spckUploadRepo.upsert({
        classId: testClassId,
        studentId: "STU_P6_02",
        localFolderPath: stuNoImgFolder,
        matchScore: 0.92,
        isConfirmedByTeacher: 0,
        projectTitle: "SPCK Phạm Thiện Hoàng Khang",
        thumbnailPath: getDefaultMindxLogoThumbnailPath(),
        screenshotsJson: "[]",
        attachmentsJson: "[]",
        youtubeUrlsJson: "[]",
        relatedLinksJson: "[]",
        teacherComment: "Nhận xét nháp cho Khang.",
        contentHash: "",
        status: "WAITING_APPROVAL",
      });

      const uiStateSlots: any[] = [];
      let uiCursor = 0;
      let capturedApi: any = {};
      let uploadCallsCount = 0;

      const uiSandbox: any = {
        console,
        setTimeout,
        clearTimeout,
        setInterval: () => 0,
        clearInterval: () => {},
        Date,
        Math,
        JSON,
        Map,
        Set,
        Array,
        Object,
        String,
        Number,
        Boolean,
        Error,
        RegExp,
        Promise,
        encodeURIComponent,
        useState(initVal: any) {
          const idx = uiCursor++;
          if (!(idx in uiStateSlots)) {
            uiStateSlots[idx] = typeof initVal === "function" ? initVal() : initVal;
          }
          const setter = (nextVal: any) => {
            uiStateSlots[idx] =
              typeof nextVal === "function" ? nextVal(uiStateSlots[idx]) : nextVal;
          };
          return [uiStateSlots[idx], setter];
        },
        useCallback(fn: any) {
          return fn;
        },
        useMemo(fn: any) {
          return fn();
        },
        useEffect() {},
        fetch: async (url: string, init?: any) => {
          const bodyObj = init?.body ? JSON.parse(String(init.body)) : {};
          if (url.includes("/api/spck/save-draft")) {
            const rec = spckUploadRepo.findOne(bodyObj.classId, bodyObj.studentId);
            return {
              ok: true,
              status: 200,
              json: async () => ({
                success: true,
                record: rec,
              }),
            };
          }
          if (url.includes("/api/spck/approve")) {
            const req = new Request("http://127.0.0.1:3000/api/spck/approve", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                host: "127.0.0.1:3000",
                origin: "http://127.0.0.1:3000",
              },
              body: JSON.stringify(bodyObj),
            });
            const res = await approvePost(req);
            const data = await res.json();
            return {
              ok: res.ok,
              status: res.status,
              json: async () => data,
            };
          }
          if (url.includes("/api/spck/upload-lms")) {
            uploadCallsCount++;
            assert.strictEqual(
              bodyObj.sessionNumber,
              13,
              "UI phải gửi đúng sessionNumber=13 đã chọn"
            );
            assert.deepStrictEqual(
              bodyObj.studentIds,
              ["STU_P6_01"],
              "Chỉ học viên đã được duyệt (STU_P6_01) mới được gửi sang upload-lms"
            );
            const verifiedRec = spckUploadRepo.markVerified(
              bodyObj.classId,
              "STU_P6_01",
              spckUploadRepo.findOne(bodyObj.classId, "STU_P6_01")!.contentHash,
              13
            );
            return {
              ok: true,
              status: 200,
              json: async () => ({
                success: true,
                uploadResult: {
                  classId: bodyObj.classId,
                  totalRequested: 1,
                  verifiedCount: 1,
                  failedCount: 0,
                  results: [
                    {
                      studentId: "STU_P6_01",
                      status: "VERIFIED",
                    },
                  ],
                },
                records: [
                  verifiedRec,
                  spckUploadRepo.findOne(bodyObj.classId, "STU_P6_02"),
                ].filter(Boolean),
              }),
            };
          }
          return { ok: true, status: 200, json: async () => ({ success: true }) };
        },
        __capture(api: any) {
          capturedApi = api;
        },
      };

      vm.runInNewContext(transpiledUi, uiSandbox);

      function renderUiHarness() {
        uiCursor = 0;
        vm.runInNewContext("FinalProjectPage()", uiSandbox);
      }

      // Initialize UI state with testClassId and the 2 students
      uiStateSlots[1] = testClassId;
      uiStateSlots[2] = [
        { studentId: "STU_P6_01", fullName: "Ngô Khôi Nguyên" },
        { studentId: "STU_P6_02", fullName: "Phạm Thiện Hoàng Khang" },
      ];
      renderUiHarness();
      capturedApi.hydrateRowsFromDb(
        spckUploadRepo.findByClass(testClassId),
        uiStateSlots[2]
      );
      renderUiHarness();

      // Verify legacy record display ("Chưa xác định") when status=VERIFIED but sessionResults is empty
      const legacySlotDisplay = capturedApi.getSessionSlotDisplay(
        {
          status: "VERIFIED",
          verifiedAt: "2026-10-20 10:00:00",
          contentHash: "legacy_hash",
          sessionResults: {},
        },
        13
      );
      assert.strictEqual(
        legacySlotDisplay.state,
        "UNKNOWN_LEGACY",
        "Bản ghi cũ chỉ có trạng thái chung phải trả về UNKNOWN_LEGACY"
      );
      assert.strictEqual(
        legacySlotDisplay.label,
        "Chưa xác định",
        "Bản ghi cũ thiếu bằng chứng buổi phải hiển thị 'Chưa xác định', không được tự đoán Buổi 13"
      );

      // Verify edited draft display ("Đã nộp ✓ (Bản nháp đã đổi)") vs current verified ("Đã nộp ✓")
      const hydratedStu1 = capturedApi.rows.find(
        (r: any) => r.assignedStudentId === "STU_P6_01"
      );
      assert.ok(hydratedStu1, "Phải nạp được dòng của STU_P6_01");
      const slot12Display = capturedApi.getSessionSlotDisplay(hydratedStu1, 12);
      assert.strictEqual(
        slot12Display.state,
        "VERIFIED_DRAFT_CHANGED",
        "Buổi 12 có hash cũ khác với bản nháp Buổi 13 hiện tại phải hiển thị VERIFIED_DRAFT_CHANGED"
      );
      assert.ok(slot12Display.label.includes("Đã nộp ✓"));
      const slot13Display = capturedApi.getSessionSlotDisplay(hydratedStu1, 13);
      assert.strictEqual(
        slot13Display.state,
        "VERIFIED_CURRENT",
        "Buổi 13 có cùng contentHash hiện tại phải hiển thị VERIFIED_CURRENT"
      );

      // Verify invalid session number is rejected on UI without calling upload-lms
      await capturedApi.handleApproveAndUpload(["STU_P6_01"], true, 99);
      renderUiHarness();
      assert.strictEqual(uploadCallsCount, 0, "Buổi không hợp lệ không được gọi upload-lms");
      assert.strictEqual(capturedApi.bannerMessage?.type, "error");

      // Condition 3: Select 2 students (STU_P6_01 ready, STU_P6_02 unconfirmed) -> must NOT show false-green "1/1, lỗi 0"!
      await capturedApi.handleApproveAndUpload(
        ["STU_P6_01", "STU_P6_02"],
        true,
        13
      );
      renderUiHarness();
      const bannerAfterPartial = capturedApi.bannerMessage;
      assert.ok(bannerAfterPartial, "Phải có thông báo kết quả sau khi nộp");
      assert.strictEqual(
        bannerAfterPartial.type,
        "warning",
        `Chọn 2 học viên nhưng 1 bài bị bỏ qua thì thông báo phải là 'warning', không được báo xanh 'success' (actual=${bannerAfterPartial.type}: ${bannerAfterPartial.text})`
      );
      assert.ok(
        bannerAfterPartial.text.includes("Đã nộp 1/2 bài (Buổi 13) — 1 bài chưa nộp"),
        `Thông báo phải ghi rõ 'Đã nộp 1/2 bài (Buổi 13) — 1 bài chưa nộp', actual=${bannerAfterPartial.text}`
      );
      assert.ok(
        bannerAfterPartial.text.includes("Phạm Thiện Hoàng Khang"),
        "Thông báo phải nêu tên học viên bị bỏ qua"
      );
      assert.strictEqual(capturedApi.lastSubmissionSummary?.totalSelected, 2);
      assert.strictEqual(capturedApi.lastSubmissionSummary?.verifiedItems.length, 1);
      assert.strictEqual(capturedApi.lastSubmissionSummary?.skippedItems.length, 1);
      assert.deepStrictEqual(capturedApi.lastSubmissionSummary?.retryStudentIds, [
        "STU_P6_02",
      ]);

      // 5E. Verify "Bỏ chọn" keeps selection empty (0 selected), WAITING_APPROVAL in uploadResult is reported & retryable, and delayed save-draft doesn't overwrite newer typing
      capturedApi.setSelectedStudentIds([]);
      renderUiHarness();
      assert.deepStrictEqual(
        capturedApi.effectiveSelectedStudentIds,
        [],
        "Khi bấm 'Bỏ chọn', effectiveSelectedStudentIds phải giữ nguyên mảng rỗng [] (0 bài), không được tự chọn lại"
      );

      // Test WAITING_APPROVAL returned from upload-lms is included in skippedItems & retryStudentIds
      const origFetch = uiSandbox.fetch;
      uiSandbox.fetch = async (url: string, init?: any) => {
        if (url.includes("/api/spck/upload-lms")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              uploadResult: {
                classId: testClassId,
                totalRequested: 1,
                verifiedCount: 0,
                failedCount: 0,
                demotedCount: 1,
                results: [
                  {
                    studentId: "STU_P6_01",
                    status: "WAITING_APPROVAL",
                    errorMessage: "Nội dung SPCK đã thay đổi trước khi upload.",
                  },
                ],
              },
              records: spckUploadRepo.findByClass(testClassId),
            }),
          };
        }
        return origFetch(url, init);
      };
      await capturedApi.handleApproveAndUpload(["STU_P6_01"], true, 13);
      renderUiHarness();
      assert.strictEqual(capturedApi.lastSubmissionSummary?.verifiedItems.length, 0);
      assert.strictEqual(
        capturedApi.lastSubmissionSummary?.skippedItems.length,
        1,
        "Học viên bị trả về WAITING_APPROVAL phải xuất hiện trong skippedItems"
      );
      assert.deepStrictEqual(
        capturedApi.lastSubmissionSummary?.retryStudentIds,
        ["STU_P6_01"],
        "Học viên bị trả về WAITING_APPROVAL phải có trong retryStudentIds"
      );

      // Test delayed save-draft response does not overwrite newer local typing
      let resolveDelayedSave: ((val: any) => void) | null = null;
      uiSandbox.fetch = async (url: string, init?: any) => {
        if (url.includes("/api/spck/save-draft")) {
          const bodyObj = init?.body ? JSON.parse(String(init.body)) : {};
          return await new Promise((resolve) => {
            resolveDelayedSave = () =>
              resolve({
                ok: true,
                status: 200,
                json: async () => ({
                  success: true,
                  record: {
                    ...spckUploadRepo.findOne(bodyObj.classId, bodyObj.studentId),
                    teacherComment: bodyObj.teacherComment,
                    status: "WAITING_APPROVAL",
                    contentHash: "",
                  },
                }),
              });
          });
        }
        return origFetch(url, init);
      };
      const rowBeforeTyping = capturedApi.rows.find(
        (r: any) => r.assignedStudentId === "STU_P6_01"
      );
      const savePromise = capturedApi.persistRowDraft({
        ...rowBeforeTyping,
        teacherComment: "Old comment",
      });
      // Simulate user continuing to type while save-draft is in flight
      capturedApi.setRows((prev: any[]) =>
        prev.map((r: any) =>
          r.assignedStudentId === "STU_P6_01"
            ? { ...r, teacherComment: "New comment being typed" }
            : r
        )
      );
      renderUiHarness();
      assert.ok(resolveDelayedSave, "Phải bắt được request save-draft đang chờ");
      (resolveDelayedSave as any)(null);
      await savePromise;
      renderUiHarness();
      const rowAfterDelayedSave = capturedApi.rows.find(
        (r: any) => r.assignedStudentId === "STU_P6_01"
      );
      assert.strictEqual(
        rowAfterDelayedSave.teacherComment,
        "New comment being typed",
        "Phản hồi save-draft đến muộn KHÔNG được ghi đè nội dung mới người dùng vừa gõ"
      );
      uiSandbox.fetch = origFetch;

      // 5F. Verify clearSessionSpck safety guards (slot switch failure, LMS delete rejection, and single-session clear)
      const clearPage = await browser.newPage();
      try {
        let deletedWorkIds: string[] = [];
        let rejectDelete = false;
        let returnWrongClassName = false;
        let returnVerifyNullData = false;
        let activeWorksOnLms: any[] = [
          {
            id: "work12",
            studentId: "STU_P6_01",
            classSessionId: "slot12",
            classSessionNumber: 12,
            isDeleted: false,
            latestData: { title: "SPCK B12" },
          },
          {
            id: "work13",
            studentId: "STU_P6_01",
            classSessionId: "slot13",
            classSessionNumber: 13,
            isDeleted: false,
            latestData: { title: "SPCK B13" },
          },
        ];

        await clearPage.route(/lms-api\.mindx\.edu\.vn/i, async (route) => {
          const corsHeaders = {
            "access-control-allow-origin": "*",
            "access-control-allow-headers": "*",
            "access-control-allow-methods": "POST, GET, OPTIONS",
          };
          if (route.request().method().toUpperCase() === "OPTIONS") {
            await route.fulfill({ status: 204, headers: corsHeaders });
            return;
          }
          const postData = route.request().postData() || "";
          if (postData.includes("FindClass")) {
            await route.fulfill({
              status: 200,
              headers: corsHeaders,
              contentType: "application/json",
              body: JSON.stringify({
                data: {
                  classes: {
                    data: [
                      {
                        id: "CLS_INTERNAL_1",
                        name: returnWrongClassName ? `${testClassId}_OTHER` : testClassId,
                      },
                    ],
                  },
                },
              }),
            });
            return;
          }
          if (postData.includes("VerifyWorks") && returnVerifyNullData) {
            await route.fulfill({
              status: 200,
              headers: corsHeaders,
              contentType: "application/json",
              body: JSON.stringify({
                data: { findAllStudentWorks: { data: null } },
              }),
            });
            return;
          }
          if (postData.includes("FindWorks") || postData.includes("VerifyWorks")) {
            await route.fulfill({
              status: 200,
              headers: corsHeaders,
              contentType: "application/json",
              body: JSON.stringify({
                data: { findAllStudentWorks: { data: activeWorksOnLms } },
              }),
            });
            return;
          }
          if (postData.includes("DeleteWork")) {
            const parsed = JSON.parse(postData);
            const targetId = parsed?.variables?.payload?.id;
            if (rejectDelete) {
              await route.fulfill({
                status: 200,
                headers: corsHeaders,
                contentType: "application/json",
                body: JSON.stringify({
                  errors: [{ message: "Forbidden delete on LMS" }],
                }),
              });
              return;
            }
            deletedWorkIds.push(targetId);
            activeWorksOnLms = activeWorksOnLms.map((w) =>
              w.id === targetId ? { ...w, isDeleted: true } : w
            );
            await route.fulfill({
              status: 200,
              headers: corsHeaders,
              contentType: "application/json",
              body: JSON.stringify({
                data: {
                  studentWorks: {
                    del: { id: targetId, isDeleted: true, deletedAt: new Date().toISOString() },
                  },
                },
              }),
            });
            return;
          }
          await route.fulfill({
            status: 200,
            headers: corsHeaders,
            contentType: "application/json",
            body: JSON.stringify({ data: {} }),
          });
        });

        // Case 1: UI fails to activate Session 13 (Session 12 stays .active) -> must throw & delete 0 works
        await clearPage.setContent(`
          <div aria-labelledby="class-detail">
            <div id="class-comments-slot-carousel-11" class="active"><div class="info-container">#12</div></div>
            <div id="class-comments-slot-carousel-12"><div class="info-container">#13</div></div>
          </div>
        `);
        await assert.rejects(
          () =>
            SpckUploader.clearSessionSpck({
              classId: testClassId,
              sessionNumber: 13,
              customPage: clearPage,
            }),
          /Không thể kích hoạt Buổi học số 13/i,
          "clearSessionSpck phải dừng ngay khi không chuyển được sang Buổi 13"
        );
        assert.deepStrictEqual(
          deletedWorkIds,
          [],
          "Khi chuyển buổi thất bại, không được phép xóa bất kỳ bài nào trên LMS"
        );

        // Case 2: UI activates Session 13 properly, but LMS rejects DeleteWork -> must throw & preserve Session 13 in SQLite
        await clearPage.setContent(`
          <div aria-labelledby="class-detail">
            <div id="class-comments-slot-carousel-11"><div class="info-container">#12</div></div>
            <div id="class-comments-slot-carousel-12" class="active"><div class="info-container">#13</div></div>
          </div>
        `);
        rejectDelete = true;
        await assert.rejects(
          () =>
            SpckUploader.clearSessionSpck({
              classId: testClassId,
              sessionNumber: 13,
              customPage: clearPage,
            }),
          /Clear SPCK Verification Failed|Forbidden delete/i,
          "Khi LMS từ chối xóa, clearSessionSpck phải báo lỗi"
        );
        const rowAfterRejectedClear = spckUploadRepo.findOne(testClassId, "STU_P6_01")!;
        const mapAfterRejectedClear = parseSpckSessionResults(
          rowAfterRejectedClear.sessionResultsJson
        );
        assert.strictEqual(
          mapAfterRejectedClear["13"]?.status,
          "VERIFIED",
          "Khi LMS từ chối xóa Buổi 13, lịch sử VERIFIED của Buổi 13 trong SQLite phải được giữ nguyên"
        );

        // Case 2B: FindClass returns non-exact class name -> must reject without deleting or clearing SQLite
        returnWrongClassName = true;
        rejectDelete = false;
        await assert.rejects(
          () =>
            SpckUploader.clearSessionSpck({
              classId: testClassId,
              sessionNumber: 13,
              customPage: clearPage,
            }),
          /Không tìm thấy lớp khớp chính xác mã/i,
          "Khi FindClass không khớp chính xác mã lớp, phải từ chối ngay thay vì lấy classesList[0]"
        );
        returnWrongClassName = false;

        // Case 2C: VerifyWorks returns data: null -> must reject & preserve Session 13 in SQLite
        returnVerifyNullData = true;
        await assert.rejects(
          () =>
            SpckUploader.clearSessionSpck({
              classId: testClassId,
              sessionNumber: 13,
              customPage: clearPage,
            }),
          /VerifyWorks.*không hợp lệ/i,
          "Khi VerifyWorks trả về data: null, phải báo lỗi và giữ nguyên lịch sử"
        );
        returnVerifyNullData = false;
        // Restore work13 to active on mock LMS
        activeWorksOnLms = activeWorksOnLms.map((w) =>
          w.id === "work13" ? { ...w, isDeleted: false } : w
        );
        assert.strictEqual(
          parseSpckSessionResults(
            spckUploadRepo.findOne(testClassId, "STU_P6_01")!.sessionResultsJson
          )["13"]?.status,
          "VERIFIED",
          "Lịch sử Buổi 13 phải còn nguyên sau khi VerifyWorks trả null"
        );

        // Case 2D: Active work has missing or invalid classSessionNumber (null, 0, -1, 13.5, true) while effectiveSessionId is empty -> must reject & preserve Session 13
        for (const bogusSessionNum of [null, 0, -1, 13.5, true]) {
          activeWorksOnLms = [
            {
              id: "work12",
              studentId: "STU_P6_01",
              classSessionId: "slot12",
              classSessionNumber: 12,
              isDeleted: false,
              latestData: { title: "SPCK B12" },
            },
            {
              id: "work13_no_num",
              studentId: "STU_P6_01",
              classSessionId: "slot13",
              classSessionNumber: bogusSessionNum,
              isDeleted: false,
              latestData: { title: "SPCK B13" },
            },
          ];
          await assert.rejects(
            () =>
              SpckUploader.clearSessionSpck({
                classId: testClassId,
                sessionNumber: 13,
                customPage: clearPage,
              }),
            /thiếu định danh buổi học/i,
            `Khi có bài mang classSessionNumber=${String(bogusSessionNum)} mà chưa có effectiveSessionId, phải dừng xóa và giữ nguyên lịch sử`
          );
          assert.strictEqual(
            parseSpckSessionResults(
              spckUploadRepo.findOne(testClassId, "STU_P6_01")!.sessionResultsJson
            )["13"]?.status,
            "VERIFIED",
            `Lịch sử Buổi 13 phải còn nguyên khi classSessionNumber=${String(bogusSessionNum)}`
          );
        }

        // Restore explicit classSessionNumber: 13 for Case 3
        activeWorksOnLms = [
          {
            id: "work12",
            studentId: "STU_P6_01",
            classSessionId: "slot12",
            classSessionNumber: 12,
            isDeleted: false,
            latestData: { title: "SPCK B12" },
          },
          {
            id: "work13",
            studentId: "STU_P6_01",
            classSessionId: "slot13",
            classSessionNumber: 13,
            isDeleted: false,
            latestData: { title: "SPCK B13" },
          },
        ];

        // Case 3: LMS allows DeleteWork for Session 13 -> only work13 is deleted, Session 12 stays VERIFIED, Session 13 is cleared
        rejectDelete = false;
        deletedWorkIds = [];
        await SpckUploader.clearSessionSpck({
          classId: testClassId,
          sessionNumber: 13,
          customPage: clearPage,
        });
        assert.deepStrictEqual(
          deletedWorkIds,
          ["work13"],
          "clearSessionSpck cho Buổi 13 chỉ được xóa đúng work13, không đụng vào work12"
        );
        const rowAfterValidClear = spckUploadRepo.findOne(testClassId, "STU_P6_01")!;
        const mapAfterValidClear = parseSpckSessionResults(
          rowAfterValidClear.sessionResultsJson
        );
        assert.strictEqual(
          mapAfterValidClear["12"]?.status,
          "VERIFIED",
          "Sau khi xóa Buổi 13, kết quả Buổi 12 phải còn nguyên VERIFIED"
        );
        assert.strictEqual(
          mapAfterValidClear["13"],
          undefined,
          "Sau khi xóa Buổi 13 thành công, lịch sử Buổi 13 được xóa khỏi sessionResultsJson"
        );
      } finally {
        await clearPage.close();
      }

      console.log(
        "  -> PASS [5/5] (Theo dõi riêng Buổi 12/13/14, giữ lịch sử khi sửa nháp, 'Chưa xác định' cho dữ liệu cũ, báo đủ bài bị bỏ qua 1/2 và chặn buổi không hợp lệ)."
      );
    } finally {
      await browser.close();
    }

    console.log(
      "  -> PASS TASK-6.4 & 6.5 (Khóa contentHash, Idempotency chống trùng Sản Phẩm Học Viên 02, + Thêm Links & Read-after-Write VERIFIED)."
    );
  } finally {
    // Cleanup temporary SQLite rows & folder
    db.prepare(`DELETE FROM spck_session_submissions WHERE classId = ?`).run(testClassId);
    db.prepare(`DELETE FROM spck_uploads WHERE classId = ?`).run(testClassId);
    db.prepare(`DELETE FROM students WHERE classId = ?`).run(testClassId);
    db.prepare(`DELETE FROM job_logs WHERE classId = ?`).run(testClassId);
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  console.log("\n=== HOÀN TẤT: TẤT CẢ CÁC BÀI KIỂM THỬ GIAI ĐOẠN 6 ĐỀU ĐẠT 100% ===");
}

runPhase6Tests().catch((err) => {
  console.error("KIỂM THỬ GIAI ĐOẠN 6 THẤT BẠI:", err);
  process.exit(1);
});
