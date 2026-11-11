/**
 * KIỂM THỬ TOÀN DIỆN BẢN VÁ AUDIT & DỌN DẸP MÃ NGUỒN (v3.4.1)
 * Chạy 100% trong thư mục tạm cô lập (os.tmpdir()), tuyệt đối không chạm dữ liệu thật.
 *
 * Bao phủ đầy đủ T1 -> T8 theo kế hoạch đã được Owner phê duyệt:
 *   T1: Student Portal Atomic Swap + Rollback khi lỗi giữa chừng + Protected Backup + isConfirmedByTeacher = 0
 *   T2: Student Portal Chặn .exe/.bat ở độ sâu > 5 + Chống trùng đường dẫn Hoa/Thường + Bảo toàn file 0-byte hợp lệ (__init__.py) + Không cắt cụt cây thư mục <= 10 cấp
 *   T3: /teaching-projects chống mất chữ đang gõ khi lưu nháp đang bay (localEditSeqRef > requestEditSeq)
 *   T4: /final-project mergePortalRecordIntoUiRow bảo toàn ô giáo viên đang sửa (isDirty / draftVersion) + knownStateVersion 0-disk/DB short-circuit
 *   T5: /api/config chống ghi đè cấu hình cũ (409 Conflict) bất kể bao nhiêu lần GET xen giữa (expectedRevision + recentCoursesSnapshots)
 *   T6: Dashboard Bảng Việc Cần Làm Hôm Nay không báo xanh giả khi chỉ có 1/20 học sinh VERIFIED còn 19 bạn rỗng DRAFT
 *   T7: Google Drive Uploader upload-first-cleanup-after — tuyệt đối không xóa file/thư mục cũ khi bước tải lên hoặc cây thư mục con gặp lỗi
 *   T8: PyQt Screenshotter cô lập tuyệt đối theo từng học sinh (không mượn ảnh của bạn cùng lớp) + chạy bất đồng bộ spawn không khóa Event Loop
 *   Bổ sung: D3 (/api/homework-grader/download-and-grade không fallback sang allRubrics[0] sai buổi) + B5 (SequentialTaskQueue globalThis singleton) + C2 (Request-scoped SHA-256 cache)
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-v341-audit-"));
const tempConfigDir = path.join(tempDir, "config");
fs.mkdirSync(tempConfigDir, { recursive: true });

process.env.MINDX_DB_PATH = path.join(tempDir, "mindx_v341_test.db");
process.env.MINDX_CONFIG_DIR = tempConfigDir;
process.env.MINDX_RUNNING_CLASSES_PATH = path.join(tempDir, "running_classes_v341.json");
process.env.ALLOWED_LOCAL_DIRS = tempDir;
process.env.MINDX_DISABLE_PORTAL_TUNNEL = "1";

// Copy default thumbnail if present so scanner/portal tests have realistic config dir
const realDefaultThumb = path.resolve(process.cwd(), "data", "config", "default-spck-thumbnail.png");
if (fs.existsSync(realDefaultThumb)) {
  fs.copyFileSync(realDefaultThumb, path.join(tempConfigDir, "default-spck-thumbnail.png"));
}

async function main() {
  console.log("=== BẮT ĐẦU KIỂM THỬ AUDIT REMEDIATION & CODEBASE HYGIENE (v3.4.1) ===");
  console.log(`   [Isolated TEMP Root]: ${tempDir}`);

  const {
    classSessionRepo,
    studentRepo,
    sessionFeedbackRepo,
    spckUploadRepo,
    calculateSha256,
    computeSpckContentHash,
    withRequestScopedFileSha256Cache,
    computeSafeFileByteDigest,
    closeDb,
  } = await import("../src/lib/db/sqlite");

  const {
    studentPortalManager,
    inspectRelativeUploadPath,
    sanitizeRelativeUploadPath,
  } = await import("../src/lib/student-portal/student-portal-server");

  const { GET: portalRouteGET } = await import("../src/app/api/spck/student-portal/route");
  const { POST: saveSpckDraftPOST } = await import("../src/app/api/spck/save-draft/route");
  const { mergePortalRecordIntoUiRow } = await import(
    "../src/components/final-project/useSpckWorkflow"
  );
  const { buildRowFromDbRecord } = await import("../src/lib/spck/spck-ui-helpers");
  const { GET: configGET, POST: configPOST } = await import("../src/app/api/config/route");
  const { getDashboardTodayTodoCards } = await import("../src/lib/dashboard/today-tasks");
  const {
    uploadFilesIntoDriveFolder,
    uploadStudentDirectoryTreeToDrive,
  } = await import("../src/lib/playwright/spck-drive-uploader");
  const { renderPyQtUiScreenshotsAsync } = await import(
    "../src/lib/local-files/spck-app-screenshotter"
  );
  const { SequentialTaskQueue, taskQueue } = await import("../src/lib/queue/task-queue");
  const { POST: downloadAndGradePOST } = await import(
    "../src/app/api/homework-grader/download-and-grade/route"
  );

  try {
    // =========================================================================
    // T1: Student Portal Atomic Swap + Rollback + Protected Backup + Unconfirmed Guard
    // =========================================================================
    console.log("1. [T1] Kiểm tra Student Portal Atomic Swap, Rollback & Protected Backup...");
    const portalClassId = "VT_CSI15_V341";
    const portalRootDir = path.join(tempDir, "SPCK_PORTAL_CLASS");
    fs.mkdirSync(portalRootDir, { recursive: true });

    classSessionRepo.upsert({
      classId: portalClassId,
      className: "Lớp Python App CSI15",
      sessionId: `${portalClassId}_SESS_12`,
      sessionNumber: 12,
      date: "11/11/2026",
      topic: "Tổng duyệt SPCK GĐ1",
    });

    const stu1Id = "STU_PORTAL_01";
    const stu1Name = "Nguyễn Minh Quân";
    studentRepo.upsert({
      studentId: stu1Id,
      classId: portalClassId,
      fullName: stu1Name,
      isActive: 1,
    });

    // Pre-populate teacher's existing verified student folder & SQLite record
    const stu1Dir = path.join(portalRootDir, stu1Name);
    fs.mkdirSync(path.join(stu1Dir, "src"), { recursive: true });
    const originalPyCode = "print('Teacher Verified Original Project v1.0')\n";
    fs.writeFileSync(path.join(stu1Dir, "src", "app.py"), originalPyCode, "utf-8");

    const initialSpckPayload = {
      classId: portalClassId,
      studentId: stu1Id,
      localFolderPath: stu1Dir,
      matchScore: 1.0,
      isConfirmedByTeacher: 1,
      projectTitle: "Ứng dụng Quản lý Học tập — Buổi 12 (GĐ1)",
      baseProjectTitle: "Ứng dụng Quản lý Học tập",
      activeSessionNumber: 12 as const,
      thumbnailPath: "",
      screenshotsJson: "[]",
      attachmentsJson: JSON.stringify([path.join(stu1Dir, "src", "app.py")]),
      youtubeUrlsJson: JSON.stringify(["https://youtu.be/original_teacher_video"]),
      relatedLinksJson: JSON.stringify([
        { name: "Canva Gốc", url: "https://www.canva.com/design/original" },
      ]),
      quickTagsJson: JSON.stringify(["Code sạch"]),
      teacherNote: "Bài gốc giáo viên đã chấm",
      teacherComment: "- **Điểm mạnh của học viên:** Bài tốt.",
    };
    spckUploadRepo.upsert({
      ...initialSpckPayload,
      contentHash: computeSpckContentHash(initialSpckPayload),
      status: "VERIFIED",
      verifiedAt: "2026-11-10T10:00:00.000Z",
    });

    await studentPortalManager.startPortal({
      classId: portalClassId,
      folderPath: portalRootDir,
      autoUploadDrive: false,
    });

    // Case T1.a: Mid-batch invalid upload (2nd file has forbidden .exe at depth 7) -> MUST preserve 100% existing folder & VERIFIED DB row
    const badRes = await studentPortalManager.processStudentSubmission({
      studentId: stu1Id,
      projectTitle: "Upload Lỗi Giữa Chừng",
      files: [
        {
          relativePath: "MyProject/main.py",
          base64Data: Buffer.from("print('new half upload')").toString("base64"),
        },
        {
          relativePath: "MyProject/a/b/c/d/e/f/trojan.exe",
          base64Data: Buffer.from("MZ_FAKE_EXE").toString("base64"),
        },
      ],
    });
    assert.equal(badRes.success, false, "Upload chứa .exe ở cấp sâu phải bị từ chối");
    assert.equal(
      fs.readFileSync(path.join(stu1Dir, "src", "app.py"), "utf-8"),
      originalPyCode,
      "Thư mục cũ của học sinh phải nguyên vẹn 100% khi upload bị từ chối"
    );
    assert.equal(
      fs.existsSync(path.join(stu1Dir, "main.py")),
      false,
      "Không được ghi rò rỉ một nửa số file mới vào thư mục học sinh"
    );
    const dbAfterBad = spckUploadRepo.findOne(portalClassId, stu1Id);
    assert.equal(dbAfterBad?.status, "VERIFIED", "Trạng thái VERIFIED trong SQLite phải giữ nguyên");
    assert.equal(dbAfterBad?.isConfirmedByTeacher, 1);

    // Case T1.b: Simulated SQLite upsert failure during atomic swap -> MUST rollback disk folder to original state!
    const origUpsert = spckUploadRepo.upsert.bind(spckUploadRepo);
    (spckUploadRepo as any).upsert = () => {
      throw new Error("SIMULATED_SQLITE_DISK_FULL_ERROR");
    };
    try {
      const dbFailRes = await studentPortalManager.processStudentSubmission({
        studentId: stu1Id,
        projectTitle: "Upload Lỗi DB Giữa Chừng",
        files: [
          {
            relativePath: "NewApp/main.py",
            base64Data: Buffer.from("print('should be rolled back')").toString("base64"),
          },
        ],
      });
      assert.equal(dbFailRes.success, false, "Khi SQLite lỗi phải trả về success=false");
    } finally {
      (spckUploadRepo as any).upsert = origUpsert;
    }
    assert.equal(
      fs.readFileSync(path.join(stu1Dir, "src", "app.py"), "utf-8"),
      originalPyCode,
      "Khi SQLite lỗi sau khi swap staging, cơ chế rollback phải khôi phục nguyên vẹn 100% file cũ trên ổ cứng"
    );
    assert.equal(
      fs.existsSync(path.join(stu1Dir, "main.py")),
      false,
      "File mới trong đợt lỗi DB phải được dọn sạch hoàn toàn sau khi rollback"
    );

    // Case T1.c: Valid student portal re-upload -> backs up original into _spck_prev_backup/protected AND sets isConfirmedByTeacher = 0
    const validRes1 = await studentPortalManager.processStudentSubmission({
      studentId: stu1Id,
      projectTitle: "Ứng dụng Thời Tiết AI v2",
      files: [
        {
          relativePath: "WeatherApp/main.py",
          base64Data: Buffer.from("print('Weather AI v2')\n").toString("base64"),
        },
        {
          relativePath: "WeatherApp/pkg/__init__.py",
          base64Data: "", // valid 0-byte Python package marker!
        },
      ],
    });
    assert.equal(validRes1.success, true, `Upload hợp lệ phải thành công: ${validRes1.error}`);
    assert.equal(
      fs.existsSync(path.join(stu1Dir, "_spck_prev_backup", "protected", "src", "app.py")),
      true,
      "Bản gốc của giáo viên phải được cất an toàn trong _spck_prev_backup/protected/"
    );
    assert.equal(
      fs.readFileSync(
        path.join(stu1Dir, "_spck_prev_backup", "protected", "src", "app.py"),
        "utf-8"
      ),
      originalPyCode
    );
    assert.equal(
      fs.existsSync(path.join(stu1Dir, "pkg", "__init__.py")),
      true,
      "File __init__.py 0-byte hợp lệ phải được giữ nguyên"
    );

    const dbAfterValid1 = spckUploadRepo.findOne(portalClassId, stu1Id);
    assert.equal(
      dbAfterValid1?.isConfirmedByTeacher,
      0,
      "Bài nộp từ Cổng Học Sinh không mật khẩu bắt buộc đặt isConfirmedByTeacher = 0 chờ giáo viên xác nhận"
    );
    assert.equal(
      dbAfterValid1?.status === "DRAFT" || dbAfterValid1?.status === "WAITING_APPROVAL",
      true,
      `Trạng thái sau khi học sinh nộp lại phải hạ về DRAFT/WAITING_APPROVAL (nhận được: ${dbAfterValid1?.status})`
    );

    // Case T1.d: Second portal upload (e.g. accidental overwrite) MUST NOT overwrite _spck_prev_backup/protected!
    const validRes2 = await studentPortalManager.processStudentSubmission({
      studentId: stu1Id,
      projectTitle: "Ứng dụng Thời Tiết AI v3",
      files: [
        {
          relativePath: "WeatherApp/main.py",
          base64Data: Buffer.from("print('Weather AI v3')\n").toString("base64"),
        },
      ],
    });
    assert.equal(validRes2.success, true);
    assert.equal(
      fs.readFileSync(
        path.join(stu1Dir, "_spck_prev_backup", "protected", "src", "app.py"),
        "utf-8"
      ),
      originalPyCode,
      "_spck_prev_backup/protected tuyệt đối không bị ghi đè bởi các lần nộp tiếp theo"
    );
    assert.equal(
      fs.readFileSync(path.join(stu1Dir, "_spck_prev_backup", "latest", "main.py"), "utf-8"),
      "print('Weather AI v2')\n",
      "_spck_prev_backup/latest lưu bản nộp liền trước"
    );

    // Verify ordinary draft save WITHOUT confirmTeacherAssignment keeps isConfirmedByTeacher = 0 (F05 guard)
    const ordinarySaveResp = await saveSpckDraftPOST(
      new Request("http://127.0.0.1:3000/api/spck/save-draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
        },
        body: JSON.stringify({
          classId: portalClassId,
          studentId: stu1Id,
          localFolderPath: stu1Dir,
          isConfirmedByTeacher: true,
          teacherNote: "Ghi chú nháp thường không bấm nút xác nhận",
          projectTitle: "Ứng dụng Thời Tiết AI v3",
          sessionNumber: 12,
        }),
      })
    );
    const ordinarySaveJson = await ordinarySaveResp.json();
    assert.equal(ordinarySaveResp.status, 200);
    assert.equal(
      ordinarySaveJson.record?.isConfirmedByTeacher,
      0,
      "Lưu nháp thường không có cờ confirmTeacherAssignment tuyệt đối không được tự xác nhận bài nộp Portal mới"
    );

    // Verify explicit 1-click teacher confirmation via /api/spck/save-draft (confirmTeacherAssignment: true) sets isConfirmedByTeacher = 1
    const confirmReq = new Request("http://127.0.0.1:3000/api/spck/save-draft", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
      },
      body: JSON.stringify({
        classId: portalClassId,
        studentId: stu1Id,
        localFolderPath: stu1Dir,
        isConfirmedByTeacher: true,
        confirmTeacherAssignment: true,
        projectTitle: "Ứng dụng Thời Tiết AI v3",
        sessionNumber: 12,
      }),
    });
    const confirmResp = await saveSpckDraftPOST(confirmReq);
    const confirmJson = await confirmResp.json();
    assert.equal(confirmResp.status, 200);
    assert.equal(confirmJson.record?.isConfirmedByTeacher, 1);
    console.log("   [PASS] T1 đạt 100%.");

    // =========================================================================
    // T2: Path Sanitizer Deep .exe Block, Case-Collision Guard & Depth Preservation
    // =========================================================================
    console.log("2. [T2] Kiểm tra Path Sanitizer (.exe sâu > 5 cấp, trùng tên Hoa/Thường, độ sâu <= 10)...");
    const deepExeCheck = inspectRelativeUploadPath("root/l1/l2/l3/l4/l5/l6/l7/malware.exe");
    assert.equal(deepExeCheck.status, "REJECTED", ".exe ở độ sâu 9 phải bị REJECTED ngay lập tức");

    const deepBatTrailingDot = inspectRelativeUploadPath("root/a/b/c/d/e/f/script.bat...");
    assert.equal(
      deepBatTrailingDot.status,
      "REJECTED",
      ".bat kèm dấu chấm đuôi Windows ở cấp sâu phải bị REJECTED"
    );

    const validNested8 = sanitizeRelativeUploadPath(
      "OuterProject/src/modules/ui/widgets/cards/icons/logo.png"
    );
    assert.equal(
      validNested8,
      "OuterProject/src/modules/ui/widgets/cards/icons/logo.png",
      "Cấu trúc thư mục lồng nhau hợp lệ (8 cấp) không được bị cắt cụt mất thư mục cha"
    );

    // Case-insensitive collision test on Windows (`src/Main.py` vs `src/main.py`)
    const collisionRes = await studentPortalManager.processStudentSubmission({
      studentId: stu1Id,
      projectTitle: "Case Collision Project",
      files: [
        {
          relativePath: "Proj/src/Main.py",
          base64Data: Buffer.from("print(1)").toString("base64"),
        },
        {
          relativePath: "Proj/src/main.py",
          base64Data: Buffer.from("print(2)").toString("base64"),
        },
      ],
    });
    assert.equal(
      collisionRes.success,
      false,
      "Hai file trùng đường dẫn không phân biệt hoa/thường trên Windows phải bị từ chối rõ ràng"
    );
    assert.match(collisionRes.error || "", /trùng (?:tên|đường dẫn)/i);

    // Reject all-empty 0-byte submission (`totalRawBytes === 0`)
    const allZeroBytesRes = await studentPortalManager.processStudentSubmission({
      studentId: stu1Id,
      projectTitle: "Empty Project",
      files: [
        {
          relativePath: "Proj/__init__.py",
          base64Data: "",
        },
      ],
    });
    assert.equal(
      allZeroBytesRes.success,
      false,
      "Bài nộp chỉ toàn file 0 byte (tổng dung lượng = 0) phải bị từ chối"
    );
    console.log("   [PASS] T2 đạt 100%.");

    // =========================================================================
    // T3: /teaching-projects In-Flight Save Edit-Sequence Guard
    // =========================================================================
    console.log("3. [T3] Kiểm tra /teaching-projects localEditSeqRef chống mất chữ khi lưu nháp đang bay...");
    const teachingProjectsSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src", "app", "teaching-projects", "page.tsx"),
      "utf-8"
    );
    assert.equal(
      teachingProjectsSrc.includes("const requestEditSeq = localEditSeqRef.current;"),
      true,
      "persistDraftInternal phải chụp lại requestEditSeq trước khi gửi request"
    );
    assert.equal(
      teachingProjectsSrc.includes("const hasNewerLocalEdits = localEditSeqRef.current !== requestEditSeq;"),
      true,
      "persistDraftInternal phải kiểm tra localEditSeqRef.current !== requestEditSeq khi response quay về"
    );
    assert.equal(
      teachingProjectsSrc.includes("flushAllUnsavedLocalEdits"),
      true,
      "Phải có hàm flushAllUnsavedLocalEdits chạy vòng lặp đến khi đồng bộ hết mọi chỉnh sửa gõ dở"
    );

    // Behavioral state-machine verification of the exact sequence guard:
    let simulatedLocalEditSeq = 0;
    let simulatedHasUnsavedLocalEdits = false;
    let simulatedFormNote = "Ghi chú ban đầu";
    const pendingResolvers: Array<(savedNote: string) => void> = [];

    const simulateEdit = (nextNote: string) => {
      simulatedLocalEditSeq += 1;
      simulatedHasUnsavedLocalEdits = true;
      simulatedFormNote = nextNote;
    };

    const simulatePersistDraft = async (): Promise<void> => {
      const requestEditSeq = simulatedLocalEditSeq;
      const payloadNote = simulatedFormNote;
      const serverEchoNote = await new Promise<string>((resolve) => {
        pendingResolvers.push(() => resolve(payloadNote));
      });
      const noNewerLocalEdits = simulatedLocalEditSeq === requestEditSeq;
      if (noNewerLocalEdits) {
        simulatedHasUnsavedLocalEdits = false;
        simulatedFormNote = serverEchoNote;
      }
    };

    // Edit A -> fire save A -> while A is in flight, teacher types Edit B -> A resolves!
    simulateEdit("Bản sửa A");
    const saveAPromise = simulatePersistDraft();
    simulateEdit("Bản sửa B (gõ thêm khi mạng đang lưu A)");
    pendingResolvers.shift()!("Bản sửa A");
    await saveAPromise;

    assert.equal(
      simulatedFormNote,
      "Bản sửa B (gõ thêm khi mạng đang lưu A)",
      "Response cũ của A tuyệt đối không được ghi đè nội dung B giáo viên vừa gõ"
    );
    assert.equal(
      simulatedHasUnsavedLocalEdits,
      true,
      "Cờ hasUnsavedLocalEdits phải giữ nguyên là true để flush tiếp Bản sửa B trước khi Duyệt"
    );
    console.log("   [PASS] T3 đạt 100%.");

    // =========================================================================
    // T4: /final-project mergePortalRecordIntoUiRow & knownStateVersion Short-Circuit
    // =========================================================================
    console.log("4. [T4] Kiểm tra mergePortalRecordIntoUiRow & knownStateVersion short-circuit...");
    const portalInitResp = await portalRouteGET(
      new Request(
        `http://127.0.0.1:3000/api/spck/student-portal?classId=${portalClassId}`,
        { headers: { host: "127.0.0.1:3000" } }
      )
    );
    const portalInitJson = await portalInitResp.json();
    assert.equal(portalInitJson.success, true);
    const currentStateVer = portalInitJson.portalStatus.stateVersion;
    assert.equal(typeof currentStateVer, "number");

    // Spy on spckUploadRepo.findByClass to verify ZERO DB reads when knownStateVersion matches
    let dbReadsDuringUnchangedPoll = 0;
    const origFindByClass = spckUploadRepo.findByClass.bind(spckUploadRepo);
    (spckUploadRepo as any).findByClass = (...args: any[]) => {
      dbReadsDuringUnchangedPoll += 1;
      return (origFindByClass as any)(...args);
    };
    try {
      const unchangedResp = await portalRouteGET(
        new Request(
          `http://127.0.0.1:3000/api/spck/student-portal?classId=${portalClassId}&knownStateVersion=${currentStateVer}`,
          { headers: { host: "127.0.0.1:3000" } }
        )
      );
      const unchangedJson = await unchangedResp.json();
      assert.equal(unchangedJson.success, true);
      assert.equal(unchangedJson.unchanged, true);
      assert.equal(
        dbReadsDuringUnchangedPoll,
        0,
        "Polling khi stateVersion không đổi không được đọc lại SQLite/ổ cứng"
      );
    } finally {
      (spckUploadRepo as any).findByClass = origFindByClass;
    }

    // Verify mergePortalRecordIntoUiRow never clobbers dirty row or unbumped draftVersion links
    const sampleDbRec = spckUploadRepo.findOne(portalClassId, stu1Id)!;
    const baseUiRow = buildRowFromDbRecord(
      { ...sampleDbRec, draftVersion: 5 } as any,
      { studentId: stu1Id, fullName: stu1Name, classId: portalClassId, isActive: 1 },
      12
    );
    const dirtyTeacherRow = {
      ...baseUiRow,
      isDirty: true,
      projectTitle: "Tên Giáo Viên Đang Sửa Dở",
      youtubeUrlsText: "https://youtu.be/teacher_typing_now",
      relatedLinksText: "Slide GV | https://canva.com/teacher_typing",
      teacherComment: "Nhận xét giáo viên đang gõ dở",
    };

    const incomingPortalDbRec = {
      ...sampleDbRec,
      draftVersion: 6,
      projectTitle: "Tên Cũ Từ Poll",
      youtubeUrlsJson: JSON.stringify(["https://youtu.be/stale_poll"]),
      relatedLinksJson: JSON.stringify([
        { name: "Google Drive SPCK", url: "https://drive.google.com/drive/folders/NEW_DRIVE_999" },
      ]),
    } as any;

    const mergedWhileDirty = mergePortalRecordIntoUiRow(
      dirtyTeacherRow,
      incomingPortalDbRec
    );
    assert.equal(
      mergedWhileDirty.projectTitle,
      "Tên Giáo Viên Đang Sửa Dở",
      "Khi isDirty=true, không được ghi đè projectTitle giáo viên đang gõ"
    );
    assert.equal(
      mergedWhileDirty.youtubeUrlsText,
      "https://youtu.be/teacher_typing_now",
      "Khi isDirty=true, không được ghi đè youtubeUrlsText giáo viên đang gõ"
    );
    assert.equal(
      mergedWhileDirty.teacherComment,
      "Nhận xét giáo viên đang gõ dở",
      "Khi isDirty=true, không được xóa/ghi đè nhận xét giáo viên đang gõ"
    );

    // Even when isDirty=false, if incoming draftVersion === existing draftVersion, teacher's local links stay intact (only new Drive link is additively appended if missing)
    const cleanEditedLinksRow = {
      ...baseUiRow,
      isDirty: false,
      draftVersion: 5,
      youtubeUrlsText: "https://youtu.be/just_saved_by_teacher",
      relatedLinksText: "Canva | https://canva.com/just_saved",
    };
    const stalePollSameDraftVer = {
      ...incomingPortalDbRec,
      draftVersion: 5,
    };
    const mergedSameVer = mergePortalRecordIntoUiRow(
      cleanEditedLinksRow,
      stalePollSameDraftVer
    );
    assert.equal(
      mergedSameVer.youtubeUrlsText,
      "https://youtu.be/just_saved_by_teacher",
      "Poll có cùng draftVersion không được ghi đè youtubeUrlsText"
    );
    assert.equal(
      mergedSameVer.relatedLinksText.includes("https://canva.com/just_saved"),
      true,
      "Link Canva vừa lưu phải giữ nguyên"
    );
    assert.equal(
      mergedSameVer.relatedLinksText.includes("https://drive.google.com/drive/folders/NEW_DRIVE_999"),
      true,
      "Link Google Drive mới từ nền vẫn được ghép bổ sung an toàn mà không xóa link cũ"
    );

    await studentPortalManager.stopPortal();
    console.log("   [PASS] T4 đạt 100%.");

    // =========================================================================
    // T5: /api/config Optimistic Concurrency Guard Across Intervening GETs
    // =========================================================================
    console.log("5. [T5] Kiểm tra /api/config chống ghi đè cấu hình cũ (409 Conflict) qua nhiều lần GET...");
    const makeLocalReq = (url: string, init?: RequestInit) =>
      new Request(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          ...(init?.headers || {}),
        },
      });

    // Tab A loads initial config
    const getAResp = await configGET(makeLocalReq("http://127.0.0.1:3000/api/config"));
    const getAJson = await getAResp.json();
    assert.equal(getAJson.success, true);
    const revA = getAJson.revisions.courses;
    const revTagsA = getAJson.revisions.quickTags;
    assert.equal(typeof revA, "string");
    assert.equal(revA.length, 64);

    // Tab B saves a new course into courses
    const baseCoursesA =
      Array.isArray(getAJson.courses) && getAJson.courses.length > 0
        ? getAJson.courses
        : [
            {
              courseCode: "GA",
              courseName: "GameMaker Basic",
              sessions: [{ sessionNumber: 1, topic: "Intro", keyKnowledge: ["Sprite"] }],
            },
          ];
    // Ensure baseCoursesA is persisted once if tempConfigDir started empty
    if (!Array.isArray(getAJson.courses) || getAJson.courses.length === 0) {
      await configPOST(
        makeLocalReq("http://127.0.0.1:3000/api/config", {
          method: "POST",
          body: JSON.stringify({
            section: "courses",
            courses: baseCoursesA,
          }),
        })
      );
    }
    const seededAResp = await configGET(makeLocalReq("http://127.0.0.1:3000/api/config"));
    const seededAJson = await seededAResp.json();
    const seededRevCoursesA = seededAJson.revisions.courses;

    const coursesTabB = [
      ...seededAJson.courses,
      {
        courseCode: "CSI15_TAB_B",
        courseName: "Python App Tab B",
        sessions: [{ sessionNumber: 1, topic: "Intro", keyKnowledge: ["Biến"] }],
      },
    ];
    const postBResp = await configPOST(
      makeLocalReq("http://127.0.0.1:3000/api/config", {
        method: "POST",
        body: JSON.stringify({
          section: "courses",
          expectedRevision: seededRevCoursesA,
          courses: coursesTabB,
        }),
      })
    );
    assert.equal(postBResp.status, 200, "Tab B lưu hợp lệ với expectedRevision hiện tại phải thành công");

    // Trigger 3 intervening GET /api/config calls (simulating other components/tabs polling)
    for (let i = 0; i < 3; i++) {
      const pollResp = await configGET(makeLocalReq("http://127.0.0.1:3000/api/config"));
      assert.equal(pollResp.status, 200);
    }

    // Now Tab A tries to save stale payload WITH stale expectedRevision -> MUST get 409 Conflict!
    const stalePostWithRev = await configPOST(
      makeLocalReq("http://127.0.0.1:3000/api/config", {
        method: "POST",
        body: JSON.stringify({
          section: "courses",
          expectedRevision: seededRevCoursesA,
          courses: seededAJson.courses,
        }),
      })
    );
    assert.equal(
      stalePostWithRev.status,
      409,
      "Tab A gửi expectedRevision cũ sau nhiều lần GET xen giữa bắt buộc bị chặn 409 Conflict"
    );

    // Even a legacy caller WITHOUT expectedRevision trying to save based on Tab A's stale snapshot (reverting Tab B's courseName edit while changing description) after 3 intervening GETs -> MUST still get 409 Conflict!
    const coursesTabBEditedFirst = structuredClone(seededAJson.courses);
    coursesTabBEditedFirst[0].courseName = "Tên Khóa Học Đã Được Tab B Cập Nhật";
    const postBEditResp = await configPOST(
      makeLocalReq("http://127.0.0.1:3000/api/config", {
        method: "POST",
        body: JSON.stringify({
          section: "courses",
          courses: coursesTabBEditedFirst,
        }),
      })
    );
    assert.equal(postBEditResp.status, 200);

    // Intervening GETs MUST NOT wipe out recentCoursesSnapshots!
    for (let i = 0; i < 3; i++) {
      await configGET(makeLocalReq("http://127.0.0.1:3000/api/config"));
    }

    const staleLegacyPayload = structuredClone(seededAJson.courses);
    staleLegacyPayload[0].description = "Tab A sửa mô tả nhưng giữ courseName cũ trước khi Tab B lưu";
    const staleLegacyPost = await configPOST(
      makeLocalReq("http://127.0.0.1:3000/api/config", {
        method: "POST",
        body: JSON.stringify({
          section: "courses",
          courses: staleLegacyPayload,
        }),
      })
    );
    assert.equal(
      staleLegacyPost.status,
      409,
      "Legacy caller không gửi expectedRevision làm mất chỉnh sửa của Tab B sau nhiều lần GET xen giữa vẫn phải bị chặn 409"
    );

    // Also verify quickTags section enforces expectedRevision 409 Conflict
    const baseTagsA =
      Array.isArray(seededAJson.quickTags) && seededAJson.quickTags.length > 0
        ? seededAJson.quickTags
        : [
            {
              category: "positive",
              categoryName: "Điểm mạnh",
              tags: [{ id: "tag_init", label: "Chăm chỉ" }],
            },
          ];
    const postTagsB = await configPOST(
      makeLocalReq("http://127.0.0.1:3000/api/config", {
        method: "POST",
        body: JSON.stringify({
          section: "quickTags",
          expectedRevision: seededAJson.revisions.quickTags,
          quickTags: [
            ...baseTagsA,
            {
              category: "v341_cat",
              categoryName: "Nhóm Mới v3.4.1",
              tags: [{ id: "tag_v341", label: "Tư duy tốt" }],
            },
          ],
        }),
      })
    );
    assert.equal(postTagsB.status, 200);

    const staleTagsPost = await configPOST(
      makeLocalReq("http://127.0.0.1:3000/api/config", {
        method: "POST",
        body: JSON.stringify({
          section: "quickTags",
          expectedRevision: seededAJson.revisions.quickTags,
          quickTags: baseTagsA,
        }),
      })
    );
    assert.equal(
      staleTagsPost.status,
      409,
      "Mọi phân mục cấu hình (quickTags, rubrics, zaloTemplates) đều phải chặn 409 khi expectedRevision đã cũ"
    );
    console.log("   [PASS] T5 đạt 100%.");

    // =========================================================================
    // T6: Dashboard Today Tasks Strict Verification (No False-Green on 1/20 Verified)
    // =========================================================================
    console.log("6. [T6] Kiểm tra Bảng Việc Cần Làm Hôm Nay không báo xanh giả khi còn học sinh chưa VERIFIED...");
    const todayDate = "11/11/2026";
    const dashClassId = "HB-C4K-SB24";
    const dashSessionId = `${dashClassId}_SESS_03`;

    fs.writeFileSync(
      process.env.MINDX_RUNNING_CLASSES_PATH!,
      JSON.stringify(
        [{ classCode: dashClassId, status: "RUNNING" }],
        null,
        2
      ),
      "utf-8"
    );

    classSessionRepo.upsert({
      classId: dashClassId,
      className: dashClassId,
      sessionId: dashSessionId,
      sessionNumber: 3,
      date: todayDate,
      topic: "Cảm biến siêu âm",
    });

    for (let i = 1; i <= 20; i++) {
      const sid = `DASH_STU_${String(i).padStart(2, "0")}`;
      studentRepo.upsert({
        studentId: sid,
        classId: dashClassId,
        fullName: `Học Sinh ${i}`,
        isActive: 1,
      });
      if (i === 1) {
        const text1 = "- **Điểm mạnh của học viên:** Tốt.";
        sessionFeedbackRepo.upsert({
          classId: dashClassId,
          sessionId: dashSessionId,
          studentId: sid,
          attendanceStatus: "PRESENT",
          quickTagsJson: JSON.stringify(["Hiểu bài nhanh"]),
          teacherNote: "",
          finalText: text1,
          contentHash: calculateSha256(text1),
          status: "VERIFIED",
          verifiedAt: "2026-11-11T08:10:00.000Z",
        });
      } else {
        // Remaining 19 PRESENT students only have empty DRAFT rows!
        sessionFeedbackRepo.upsert({
          classId: dashClassId,
          sessionId: dashSessionId,
          studentId: sid,
          attendanceStatus: "PRESENT",
          quickTagsJson: "[]",
          teacherNote: "",
          finalText: "",
          contentHash: "",
          status: "DRAFT",
        });
      }
    }

    const cardsPartial = getDashboardTodayTodoCards();
    const dashCard1 = cardsPartial.find((c) => c.classId === dashClassId);
    assert.ok(dashCard1, "Phải tìm thấy thẻ lớp học hôm nay trên Dashboard");
    assert.equal(
      dashCard1.steps[0]?.isDone,
      false,
      "Khi mới có 1/20 học sinh VERIFIED và 19 bạn còn rỗng DRAFT, bước Nhận xét buổi học bắt buộc là isDone=false"
    );
    assert.equal(
      dashCard1.allDone,
      false,
      "allDone bắt buộc là false khi 19 học sinh có mặt chưa được nhận xét & lưu LMS"
    );

    // Now mark all remaining 19 students VERIFIED -> steps[0].isDone & allDone MUST turn true!
    for (let i = 2; i <= 20; i++) {
      const sid = `DASH_STU_${String(i).padStart(2, "0")}`;
      const textI = `- **Điểm mạnh của học viên:** Chăm chỉ (${i}).`;
      sessionFeedbackRepo.upsert({
        classId: dashClassId,
        sessionId: dashSessionId,
        studentId: sid,
        attendanceStatus: "PRESENT",
        quickTagsJson: JSON.stringify(["Chăm chỉ"]),
        teacherNote: "",
        finalText: textI,
        contentHash: calculateSha256(textI),
        status: "VERIFIED",
        verifiedAt: "2026-11-11T08:15:00.000Z",
      });
    }
    const cardsAllDone = getDashboardTodayTodoCards();
    const dashCard2 = cardsAllDone.find((c) => c.classId === dashClassId)!;
    assert.equal(dashCard2.steps[0]?.isDone, true);
    assert.equal(dashCard2.allDone, true);
    console.log("   [PASS] T6 đạt 100%.");

    // =========================================================================
    // T7: Google Drive Uploader — Upload-First, Cleanup-After (Zero Data Loss)
    // =========================================================================
    console.log("7. [T7] Kiểm tra Google Drive Uploader không bao giờ xóa file cũ trước khi tải xong file mới...");
    const localUploadTestDir = path.join(tempDir, "drive_upload_stu");
    fs.mkdirSync(path.join(localUploadTestDir, "sub"), { recursive: true });
    const newMainPath = path.join(localUploadTestDir, "main.py");
    const newSubPath = path.join(localUploadTestDir, "sub", "helper.py");
    fs.writeFileSync(newMainPath, "print('new version')\n", "utf-8");
    fs.writeFileSync(newSubPath, "print('sub helper')\n", "utf-8");

    let deleteKeyPresses = 0;
    let trashMenuClicks = 0;
    const mockDriveFolderId = "1AbCdEfGhIjKlMnOpQrStUvWxYz01234";

    const createFailingDriveMockPage = () => {
      const currentUrl = `https://drive.google.com/drive/folders/${mockDriveFolderId}`;
      const makeLocator = (selector: string): any => ({
        first: () => makeLocator(selector),
        last: () => makeLocator(selector),
        filter: () => makeLocator(selector),
        count: async () => 0,
        isVisible: async () => {
          if (selector.includes("new_menu_button")) return true;
          // Menu item "Tải tệp lên" fails to appear!
          return false;
        },
        click: async () => {
          if (/thùng rác|Move to trash|Remove/i.test(selector)) {
            trashMenuClicks += 1;
          }
        },
        waitFor: async () => {},
      });

      return {
        url: () => currentUrl,
        goto: async () => {},
        waitForTimeout: async () => {},
        bringToFront: async () => {},
        evaluate: async () => [
          {
            id: "OLD_DRIVE_FILE_ID_999999999",
            name: "bai_cu_cua_hoc_sinh.sb3",
            isFolder: false,
          },
        ],
        locator: (sel: string) => makeLocator(sel),
        keyboard: {
          press: async (key: string) => {
            if (key === "Delete") deleteKeyPresses += 1;
          },
        },
        waitForEvent: async () => {
          throw new Error("SIMULATED_DRIVE_FILECHOOSER_FAILURE");
        },
      } as any;
    };

    await assert.rejects(
      async () => {
        await uploadFilesIntoDriveFolder(
          createFailingDriveMockPage(),
          mockDriveFolderId,
          [newMainPath],
          true
        );
      },
      /SIMULATED_DRIVE_FILECHOOSER_FAILURE/
    );
    assert.equal(
      deleteKeyPresses,
      0,
      "Khi mở hộp chọn file Drive thất bại, tuyệt đối không được bấm phím Delete xóa file cũ"
    );
    assert.equal(
      trashMenuClicks,
      0,
      "Khi tải file mới lên Drive thất bại, tuyệt đối không được chuyển file cũ vào thùng rác"
    );

    // Also verify recursive tree upload: even if root folder upload succeeds, failure in child folder prevents trashing ANY root stale file!
    let treeCallStep = 0;
    const createTreeMidFailureMockPage = () => {
      let currentFolderUrl = `https://drive.google.com/drive/folders/${mockDriveFolderId}`;
      const makeLocator = (selector: string): any => ({
        first: () => makeLocator(selector),
        last: () => makeLocator(selector),
        filter: () => makeLocator(selector),
        count: async () => 0,
        isVisible: async () => {
          if (selector.includes("new_menu_button")) return true;
          if (selector.includes("Tải tệp lên") || selector.includes("File upload")) {
            return true;
          }
          // Subfolder creation menu fails!
          return false;
        },
        click: async () => {
          if (/thùng rác|Move to trash|Remove/i.test(selector)) {
            trashMenuClicks += 1;
          }
        },
        waitFor: async () => {
          if (selector.includes('[role="dialog"]')) {
            throw new Error("SIMULATED_SUBFOLDER_CREATE_FAILURE");
          }
        },
      });

      return {
        url: () => currentFolderUrl,
        goto: async (u: string) => {
          currentFolderUrl = u;
        },
        reload: async () => {},
        waitForTimeout: async () => {},
        bringToFront: async () => {},
        evaluate: async () => {
          // First listDriveItemsOnPage returns old file; after filechooser setFiles returns both old file + newly uploaded main.py
          if (treeCallStep === 0) {
            return [
              {
                id: "OLD_ROOT_DRIVE_FILE_88888888",
                name: "old_root_project.py",
                isFolder: false,
              },
            ];
          }
          return [
            {
              id: "OLD_ROOT_DRIVE_FILE_88888888",
              name: "old_root_project.py",
              isFolder: false,
            },
            {
              id: "NEW_ROOT_DRIVE_FILE_77777777",
              name: "main.py",
              isFolder: false,
            },
          ];
        },
        locator: (sel: string) => makeLocator(sel),
        keyboard: {
          press: async (key: string) => {
            if (key === "Delete") deleteKeyPresses += 1;
          },
        },
        waitForEvent: async () => ({
          setFiles: async () => {
            treeCallStep = 1;
          },
        }),
      } as any;
    };

    await assert.rejects(
      async () => {
        await uploadStudentDirectoryTreeToDrive(
          createTreeMidFailureMockPage(),
          mockDriveFolderId,
          localUploadTestDir,
          "STU_TREE_01",
          "Học Sinh Test Tree",
          0
        );
      },
      /SIMULATED_SUBFOLDER_CREATE_FAILURE/
    );
    assert.equal(
      deleteKeyPresses,
      0,
      "Khi tải thư mục con thất bại giữa chừng, các file cũ ở thư mục gốc cũng chưa được phép xóa (deferredCleanup chưa chạy)"
    );
    assert.equal(trashMenuClicks, 0);
    console.log("   [PASS] T7 đạt 100%.");

    // =========================================================================
    // T8: PyQt Screenshotter Strict Per-Student Isolation & Non-Blocking Async Spawn
    // =========================================================================
    console.log("8. [T8] Kiểm tra PyQt Screenshotter không mượn ảnh của bạn cùng lớp & không khóa Event Loop...");
    const classUiRoot = path.join(tempDir, "CLASS_PYQT_ISOLATION");
    const studentADir = path.join(classUiRoot, "Nguyen Van A");
    const studentBDir = path.join(classUiRoot, "Tran Thi B");
    fs.mkdirSync(studentADir, { recursive: true });
    fs.mkdirSync(studentBDir, { recursive: true });

    // Create a vivid bright-red 64x64 PNG inside Student A's folder named `secret_world_map.png`
    // (1x1 or 64x64 valid PNG generated via zlib/Buffer so zero external deps needed)
    const zlib = await import("node:zlib");
    const createSolidRgbPng = (width: number, height: number, r: number, g: number, b: number) => {
      const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      const crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
          c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        crcTable[n] = c >>> 0;
      }
      const crc32 = (buf: Buffer) => {
        let c = 0xffffffff;
        for (let i = 0; i < buf.length; i++) {
          c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
        }
        return (c ^ 0xffffffff) >>> 0;
      };
      const makeChunk = (type: string, data: Buffer) => {
        const typeBuf = Buffer.from(type, "ascii");
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32BE(data.length, 0);
        const crcBuf = Buffer.alloc(4);
        crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
        return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
      };
      const ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(width, 0);
      ihdr.writeUInt32BE(height, 4);
      ihdr[8] = 8; // bit depth
      ihdr[9] = 2; // RGB
      const rowBytes = 1 + width * 3;
      const raw = Buffer.alloc(rowBytes * height);
      for (let y = 0; y < height; y++) {
        const offset = y * rowBytes;
        raw[offset] = 0;
        for (let x = 0; x < width; x++) {
          raw[offset + 1 + x * 3] = r;
          raw[offset + 1 + x * 3 + 1] = g;
          raw[offset + 1 + x * 3 + 2] = b;
        }
      }
      const idat = zlib.deflateSync(raw);
      return Buffer.concat([
        signature,
        makeChunk("IHDR", ihdr),
        makeChunk("IDAT", idat),
        makeChunk("IEND", Buffer.alloc(0)),
      ]);
    };

    const redPngBuffer = createSolidRgbPng(120, 120, 255, 0, 0);
    const studentASecretImg = path.join(studentADir, "secret_world_map.png");
    fs.writeFileSync(studentASecretImg, redPngBuffer);

    // Student B has a `.ui` referencing `secret_world_map.png`, PLUS an explicit `../Nguyen Van A/secret_world_map.png` traversal attempt!
    const studentBUiPath = path.join(studentBDir, "main_window.ui");
    const uiXml = `<?xml version="1.0" encoding="UTF-8"?>
<ui version="4.0">
 <class>MainWindow</class>
 <widget class="QMainWindow" name="MainWindow">
  <property name="geometry"><rect><x>0</x><y>0</y><width>600</width><height>400</height></rect></property>
  <property name="windowTitle"><string>Student B App</string></property>
  <widget class="QWidget" name="centralwidget">
   <widget class="QLabel" name="labelMap">
    <property name="geometry"><rect><x>20</x><y>20</y><width>250</width><height>180</height></rect></property>
    <property name="pixmap"><pixmap>secret_world_map.png</pixmap></property>
   </widget>
   <widget class="QLabel" name="labelTraversal">
    <property name="geometry"><rect><x>300</x><y>20</y><width>250</width><height>180</height></rect></property>
    <property name="pixmap"><pixmap>../Nguyen Van A/secret_world_map.png</pixmap></property>
   </widget>
  </widget>
 </widget>
</ui>`;
    fs.writeFileSync(studentBUiPath, uiXml, "utf-8");

    // Verify screenshotter source strictly removed cross-student recovery & decorative fake art
    const screenshotterSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src", "lib", "local-files", "spck-app-screenshotter.ts"),
      "utf-8"
    );
    assert.equal(
      screenshotterSrc.includes("build_class_recovery_index"),
      false,
      "Hàm quét mượn ảnh chéo cả lớp build_class_recovery_index phải bị gỡ bỏ hoàn toàn"
    );
    assert.equal(
      screenshotterSrc.includes("synthesize_missing_asset"),
      false,
      "Hàm tự vẽ minh họa giả lập synthesize_missing_asset phải bị gỡ bỏ hoàn toàn"
    );

    // Measure Node.js timer responsiveness while renderPyQtUiScreenshotsAsync runs in parallel
    let timerTicksDuringRender = 0;
    const tickInterval = setInterval(() => {
      timerTicksDuringRender += 1;
    }, 25);

    let renderedShots: Array<{ filePath: string }> = [];
    try {
      renderedShots = await renderPyQtUiScreenshotsAsync({
        studentDir: studentBDir,
        uiFiles: ["main_window.ui"],
        outDir: path.join(studentBDir, "_spck_app_shots"),
      });
    } finally {
      clearInterval(tickInterval);
    }

    // Even if Python/PyQt6 is or isn't installed on a machine, Student B's folder MUST NOT contain any copy of Student A's image,
    // and if PyQt6 rendered a screenshot, timer ticks must have fired asynchronously (> 0) and no bright-red pixel from Student A was borrowed!
    const allFilesInStudentB = fs.readdirSync(studentBDir, { recursive: true }) as string[];
    const leakedSecretInB = allFilesInStudentB.some((rel) =>
      String(rel).toLowerCase().includes("secret_world_map")
    );
    assert.equal(
      leakedSecretInB,
      false,
      "Tuyệt đối không được chép hoặc mượn file ảnh từ thư mục của học sinh A sang học sinh B"
    );
    if (renderedShots.length > 0) {
      assert.ok(
        timerTicksDuringRender > 0,
        "renderPyQtUiScreenshotsAsync phải chạy bất đồng bộ (spawn), không được khóa cứng Event Loop của Node.js"
      );
      const { spawnSync } = await import("node:child_process");
      const pxCheck = spawnSync(
        "python",
        [
          "-c",
          [
            "import sys",
            "from PyQt6.QtGui import QImage",
            "img = QImage(sys.argv[1])",
            "red_count = 0",
            "for y in range(img.height()):",
            "    for x in range(img.width()):",
            "        c = img.pixelColor(x, y)",
            "        if c.red() > 220 and c.green() < 40 and c.blue() < 40:",
            "            red_count += 1",
            "print(red_count)",
          ].join("\n"),
          renderedShots[0].filePath,
        ],
        { encoding: "utf-8", windowsHide: true, timeout: 10000 }
      );
      const redPixelCount = Number(String(pxCheck.stdout || "").trim());
      assert.equal(
        redPixelCount,
        0,
        `Ảnh chụp giao diện của học sinh B tuyệt đối không được chứa bất kỳ pixel màu đỏ nào mượn từ ảnh của học sinh A (redPixelCount=${redPixelCount})`
      );
      console.log(
        `   [PyQt6 Async Render & Pixel Isolation Verified]: Đã xuất ${renderedShots.length} ảnh (0 pixel rò rỉ từ bạn cùng lớp), Event Loop vẫn nhịp ${timerTicksDuringRender} ticks mượt mà.`
      );
    }
    console.log("   [PASS] T8 đạt 100%.");

    // =========================================================================
    // Extra Guard Checks: D3 (Rubric Safety), B5 (Global Singleton Queue), C2 (SHA-256 Cache)
    // =========================================================================
    console.log("9. [D3 + B5 + C2] Kiểm tra an toàn Rubric, Singleton Queue & Request-scoped SHA-256 Cache...");

    // B5: SequentialTaskQueue anchored on globalThis
    assert.equal(
      SequentialTaskQueue.getInstance(),
      taskQueue,
      "SequentialTaskQueue.getInstance() phải trả về đúng thực thể duy nhất trên globalThis"
    );
    assert.equal(
      (globalThis as any).__mindxSequentialTaskQueue,
      taskQueue,
      "globalThis.__mindxSequentialTaskQueue phải giữ đúng hàng đợi đơn luồng"
    );

    // C2: withRequestScopedFileSha256Cache avoids duplicate disk reads within the same request
    const sampleHashFile = path.join(tempDir, "hash_cache_sample.bin");
    fs.writeFileSync(sampleHashFile, crypto.randomBytes(4096));
    let rawReadCount = 0;
    const origReadFileSync = fs.readFileSync.bind(fs);
    (fs as any).readFileSync = (targetPath: any, ...rest: any[]) => {
      if (String(targetPath) === sampleHashFile) {
        rawReadCount += 1;
      }
      return (origReadFileSync as any)(targetPath, ...rest);
    };
    try {
      await withRequestScopedFileSha256Cache(async () => {
        const h1 = computeSafeFileByteDigest(sampleHashFile);
        const h2 = computeSafeFileByteDigest(sampleHashFile);
        const h3 = computeSafeFileByteDigest(sampleHashFile);
        assert.ok(h1 && h1.length === 64);
        assert.equal(h1, h2);
        assert.equal(h2, h3);
      });
    } finally {
      (fs as any).readFileSync = origReadFileSync;
    }
    assert.equal(
      rawReadCount,
      1,
      "Trong phạm vi 1 request, computeSafeFileByteDigest chỉ đọc file trên đĩa đúng 1 lần duy nhất cho cùng (path, size, mtimeMs)"
    );

    // D3: /api/homework-grader/download-and-grade refuses wrong-session / wrong-course rubric fallback
    // Seed a rubric for session 1 ONLY, then request grading for session 7 -> MUST return 400!
    const getCfgNow = await (
      await configGET(makeLocalReq("http://127.0.0.1:3000/api/config"))
    ).json();
    const seedRubricResp = await configPOST(
      makeLocalReq("http://127.0.0.1:3000/api/config", {
        method: "POST",
        body: JSON.stringify({
          section: "rubrics",
          expectedRevision: getCfgNow.revisions.rubrics,
          rubrics: [
            {
              rubricId: "rubric_ga_sess1",
              courseCode: "GA",
              sessionNumber: 1,
              assignmentTitle: "Barem Buổi 1",
              assignmentPrompt: "Test Barem Buổi 1",
              maxTotalScore: 100,
              criteria: [
                {
                  criterionId: "c1",
                  name: "Tiêu chí B1",
                  maxPoints: 100,
                  description: "Test",
                },
              ],
            },
          ],
        }),
      })
    );
    assert.equal(seedRubricResp.status, 200);

    const wrongSessGradeResp = await downloadAndGradePOST(
      makeLocalReq("http://127.0.0.1:3000/api/homework-grader/download-and-grade", {
        method: "POST",
        body: JSON.stringify({
          classId: "VT-C4K-GA38",
          classCode: "VT-C4K-GA38",
          sessionId: "VT-C4K-GA38_SESS_07",
          skipDownload: true,
        }),
      })
    );
    assert.equal(
      wrongSessGradeResp.status,
      400,
      "Khi buổi 7 chưa có barem riêng, tuyệt đối không được lấy nhầm barem của buổi 1 hay allRubrics[0]"
    );

    console.log("   [PASS] D3 + B5 + C2 đạt 100%.");

    // =========================================================================
    // T9: Adversarial Counter-Example Regression Suite (Codex Round-1 P01 -> P09 + B3 previousUpdatedAt)
    // =========================================================================
    console.log("10. [T9] Kiểm tra toàn bộ 9 kịch bản phá hoại độc lập P01 -> P09 & previousUpdatedAt...");
    const vm = await import("node:vm");
    const { stripTypeScriptTypes } = await import("node:module");
    const { pathToFileURL } = await import("node:url");
    const { spckSessionRepo } = await import("../src/lib/db/sqlite");

    // P01 (F01): SQLite failure + EBUSY on rollback restore MUST keep rollback directory intact on disk (never delete sole recovery copy!)
    {
      const p01ClassId = "VT-CSI-P01";
      const p01StuId = "P01_STU";
      const p01ClassDir = path.join(tempDir, "p01_class");
      const p01StuDir = path.join(p01ClassDir, "Nguyen P01");
      fs.mkdirSync(p01StuDir, { recursive: true });
      fs.writeFileSync(path.join(p01StuDir, "old.txt"), "ONLY_ORIGINAL_COPY", "utf-8");
      studentRepo.upsert({ classId: p01ClassId, studentId: p01StuId, fullName: "Nguyen P01", isActive: 1 });
      classSessionRepo.upsert({
        classId: p01ClassId,
        className: "P01 Class",
        sessionId: "P01_S12",
        sessionNumber: 12,
        date: "11/11/2026",
        topic: "SPCK",
      });
      await studentPortalManager.startPortal({
        classId: p01ClassId,
        folderPath: p01ClassDir,
        autoUploadDrive: false,
      });

      const origRename = fs.renameSync.bind(fs);
      const origUpsert = spckUploadRepo.upsert.bind(spckUploadRepo);
      (fs as any).renameSync = (a: any, b: any) => {
        if (String(a).includes(".spck_portal_rollback_") && path.resolve(String(b)) === path.resolve(p01StuDir)) {
          throw Object.assign(new Error("SIMULATED_EBUSY_RESTORE"), { code: "EBUSY" });
        }
        return origRename(a, b);
      };
      (spckUploadRepo as any).upsert = () => {
        throw new Error("SIMULATED_SQLITE_FULL");
      };
      let p01Res: any;
      try {
        p01Res = await studentPortalManager.processStudentSubmission({
          studentId: p01StuId,
          files: [{ relativePath: "new.txt", base64Data: Buffer.from("NEW").toString("base64") }],
        });
      } finally {
        (fs as any).renameSync = origRename;
        (spckUploadRepo as any).upsert = origUpsert;
      }
      assert.equal(p01Res.success, false);
      const recoveryDirs = fs
        .readdirSync(p01ClassDir)
        .filter((d) => d.startsWith(".spck_portal_rollback_"));
      assert.equal(
        recoveryDirs.length,
        1,
        "P01: Khi khôi phục rollback gặp lỗi EBUSY, tuyệt đối không được xóa thư mục rollback duy nhất"
      );
      assert.equal(
        fs.readFileSync(path.join(p01ClassDir, recoveryDirs[0], "old.txt"), "utf-8"),
        "ONLY_ORIGINAL_COPY",
        "P01: Dữ liệu gốc trong thư mục rollback phải còn nguyên vẹn 100%"
      );

      // Re-starting portal must self-heal the encoded rollback directory back into `p01StuDir` instead of deleting it!
      await studentPortalManager.stopPortal();
      await studentPortalManager.startPortal({
        classId: p01ClassId,
        folderPath: p01ClassDir,
        autoUploadDrive: false,
      });
      assert.equal(
        fs.existsSync(path.join(p01StuDir, "old.txt")),
        true,
        "P01: Khi mở lại cổng, thư mục rollback dang dở phải tự động khôi phục lại về đúng thư mục học sinh"
      );
    }

    // P02 & P03 (F02): Backup read failure MUST abort submission before touching original folder, AND >130MB existing file MUST be backed up completely
    {
      const p02ClassId = "VT-CSI-P02";
      const p02StuId = "P02_STU";
      const p02ClassDir = path.join(tempDir, "p02_class");
      const p02StuDir = path.join(p02ClassDir, "Nguyen P02");
      const p02OldSrc = path.join(p02StuDir, "src");
      fs.mkdirSync(p02OldSrc, { recursive: true });
      fs.writeFileSync(path.join(p02OldSrc, "old.py"), "ONLY_ORIGINAL_CODE", "utf-8");
      studentRepo.upsert({ classId: p02ClassId, studentId: p02StuId, fullName: "Nguyen P02", isActive: 1 });
      classSessionRepo.upsert({
        classId: p02ClassId,
        className: "P02 Class",
        sessionId: "P02_S12",
        sessionNumber: 12,
        date: "11/11/2026",
        topic: "SPCK",
      });
      await studentPortalManager.stopPortal();
      await studentPortalManager.startPortal({
        classId: p02ClassId,
        folderPath: p02ClassDir,
        autoUploadDrive: false,
      });

      const origReaddir = fs.readdirSync.bind(fs);
      (fs as any).readdirSync = (p: any, ...args: any[]) => {
        if (path.resolve(String(p)) === path.resolve(p02OldSrc)) {
          throw Object.assign(new Error("SIMULATED_EACCES_BACKUP"), { code: "EACCES" });
        }
        return (origReaddir as any)(p, ...args);
      };
      let p02Res: any;
      try {
        p02Res = await studentPortalManager.processStudentSubmission({
          studentId: p02StuId,
          files: [{ relativePath: "new.py", base64Data: Buffer.from("print(2)").toString("base64") }],
        });
      } finally {
        (fs as any).readdirSync = origReaddir;
      }
      assert.equal(p02Res.success, false, "P02: Khi sao lưu bài cũ gặp lỗi đọc thư mục, phải từ chối thay bài");
      assert.equal(
        fs.readFileSync(path.join(p02OldSrc, "old.py"), "utf-8"),
        "ONLY_ORIGINAL_CODE",
        "P02: File gốc phải còn nguyên trong thư mục chính khi sao lưu thất bại"
      );

      // P03: Pre-existing >130MB sparse/large file on teacher's disk must NOT be dropped from protected/latest backups
      const hugeOldPath = path.join(p02StuDir, "oversized_asset.dat");
      const hugeSize = 130 * 1024 * 1024 + 1;
      const fd = fs.openSync(hugeOldPath, "w");
      fs.ftruncateSync(fd, hugeSize);
      fs.closeSync(fd);

      const p03Res = await studentPortalManager.processStudentSubmission({
        studentId: p02StuId,
        files: [{ relativePath: "new.py", base64Data: Buffer.from("print(3)").toString("base64") }],
      });
      assert.equal(p03Res.success, true, `P03: ${p03Res.error}`);
      assert.equal(
        fs.statSync(path.join(p02StuDir, "_spck_prev_backup", "protected", "oversized_asset.dat")).size,
        hugeSize,
        "P03: File cũ >130MB của giáo viên phải được sao lưu nguyên vẹn vào protected"
      );
      assert.equal(
        fs.statSync(path.join(p02StuDir, "_spck_prev_backup", "latest", "oversized_asset.dat")).size,
        hugeSize,
        "P03: File cũ >130MB của giáo viên phải được sao lưu nguyên vẹn vào latest"
      );
      // Clean up sparse 130MB files right away to keep temp disk footprint tiny
      fs.rmSync(p02ClassDir, { recursive: true, force: true });
    }

    // P04 (F03): Google Drive progress bar still visible -> MUST reject and NEVER click Move to trash
    {
      let uploaded = false;
      let p04TrashClicks = 0;
      const p04Folder = "SYNTHETIC_FOLDER_12345678";
      const oldItem = { id: "OLD_FILE_1234567890", name: "old.txt", isFolder: false };
      const freshItem = { id: "NEW_FILE_1234567890", name: "new.txt", isFolder: false };
      const loc = (selector: string): any => ({
        first: () => loc(selector),
        last: () => loc(selector),
        filter: () => loc(selector),
        count: async () => 1,
        isVisible: async () =>
          selector.includes("progressbar") ||
          (!selector.includes('[role="dialog"]') &&
            !selector.includes("Upload failed") &&
            (selector.includes("new_menu_button") ||
              selector.includes('[data-target="doc"]') ||
              selector.includes('[role="menuitem"]'))),
        click: async () => {
          if (/Move to trash|thùng rác/i.test(selector)) p04TrashClicks += 1;
        },
        waitFor: async () => {},
      });
      const p04Page: any = {
        url: () => `https://drive.google.com/drive/folders/${p04Folder}`,
        goto: async () => {},
        waitForTimeout: async () => {},
        locator: loc,
        evaluate: async () => (uploaded ? [oldItem, freshItem] : [oldItem]),
        keyboard: { press: async () => {} },
        waitForEvent: async () => ({
          setFiles: async () => {
            uploaded = true;
          },
        }),
      };
      const p04LocalFile = path.join(tempDir, "p04_new.txt");
      fs.writeFileSync(p04LocalFile, "NEW SOURCE", "utf-8");
      await assert.rejects(
        async () => {
          await uploadFilesIntoDriveFolder(p04Page, p04Folder, [p04LocalFile]);
        },
        /thanh tiến trình vẫn đang chạy/i,
        "P04: Khi thanh tiến trình Google Drive vẫn đang hiện, không được coi là tải xong"
      );
      assert.equal(
        p04TrashClicks,
        0,
        "P04: Tuyệt đối không được bấm xóa file cũ khi thanh tải lên Google Drive vẫn đang chạy"
      );
    }

    // P05 (F04): /teaching-projects handleApproveAndSyncToTeaching preserves newer typing while sync is in flight
    {
      const tpSource = fs.readFileSync(
        path.resolve(process.cwd(), "src", "app", "teaching-projects", "page.tsx"),
        "utf8"
      );
      const startIdx = tpSource.indexOf("const handleApproveAndSyncToTeaching = ");
      const endIdx = tpSource.indexOf("\n  const handleBulkMilestoneUpdate", startIdx);
      const handlerCode =
        tpSource.slice(startIdx, endIdx) + "\nglobalThis.run = handleApproveAndSyncToTeaching;";
      let releaseSync: any;
      let currentFormName = "Draft A";
      let unsavedFlag = false;
      const editSeqRef = { current: 1 };
      const vmCtx: any = {
        loadedClassCodeRef: { current: "CLASS_A" },
        activeLoadSeqRef: { current: 1 },
        draftVersion: 1,
        activeClassCode: "CLASS_A",
        isLoadingClass: false,
        projectName: "Draft A",
        startDate: "2026-11-11",
        endDate: "2026-11-12",
        description: "A",
        tasks: [],
        assignedStudentIds: [],
        localEditSeqRef: editSeqRef,
        setIsSyncingTeaching: () => {},
        setBanner: () => {},
        applyRecordAndTasksState: (rec: any) => {
          currentFormName = rec.projectName;
          unsavedFlag = false;
        },
        fetch: () => new Promise((r) => (releaseSync = r)),
      };
      vm.runInNewContext((stripTypeScriptTypes as any)(handlerCode, { mode: "transform" }), vmCtx);
      const pendingSync = vmCtx.run();
      currentFormName = "Draft B typed while sync pending";
      unsavedFlag = true;
      editSeqRef.current += 1;
      releaseSync(Response.json({ success: true, record: { classId: "CLASS_A", projectName: "Draft A" } }));
      await pendingSync;
      assert.equal(
        currentFormName,
        "Draft B typed while sync pending",
        "P05: Phản hồi đồng bộ Teaching cũ không được ghi đè nội dung mới giáo viên vừa gõ thêm"
      );
      assert.equal(unsavedFlag, true, "P05: Cờ chưa lưu phải được giữ nguyên");
    }

    // P06 (F05): Dirty UI row merged with new unconfirmed Portal upload MUST demote confirmation to false and ordinary save MUST NOT queue Drive
    {
      const p06ClassId = "VT-CSI-P06";
      const p06StuId = "P06_STU";
      const p06ClassDir = path.join(tempDir, "p06_class");
      const p06StuDir = path.join(p06ClassDir, "Nguyen P06");
      fs.mkdirSync(p06StuDir, { recursive: true });
      fs.writeFileSync(path.join(p06StuDir, "old.py"), "print('old')", "utf-8");
      studentRepo.upsert({ classId: p06ClassId, studentId: p06StuId, fullName: "Nguyen P06", isActive: 1 });
      classSessionRepo.upsert({
        classId: p06ClassId,
        className: "P06 Class",
        sessionId: "P06_S12",
        sessionNumber: 12,
        date: "11/11/2026",
        topic: "SPCK",
      });
      spckUploadRepo.upsert({
        classId: p06ClassId,
        studentId: p06StuId,
        localFolderPath: p06StuDir,
        matchScore: 1,
        isConfirmedByTeacher: 1,
        projectTitle: "Old Title",
        thumbnailPath: "",
        screenshotsJson: "[]",
        attachmentsJson: "[]",
        youtubeUrlsJson: "[]",
        relatedLinksJson: "[]",
        teacherComment: "Original comment",
        contentHash: "ORIG_HASH",
        status: "VERIFIED",
      });
      await studentPortalManager.stopPortal();
      await studentPortalManager.startPortal({
        classId: p06ClassId,
        folderPath: p06ClassDir,
        autoUploadDrive: true,
      });

      const oldRec = spckUploadRepo.findOne(p06ClassId, p06StuId)!;
      const dirtyUi: any = buildRowFromDbRecord(
        { ...(oldRec as any), draftVersion: 1 },
        { studentId: p06StuId, classId: p06ClassId, fullName: "Nguyen P06", isActive: 1 },
        12
      );
      dirtyUi.isDirty = true;
      dirtyUi.teacherNote = "Ghi chú đang gõ dở";

      const p06Sub = await studentPortalManager.processStudentSubmission({
        studentId: p06StuId,
        files: [{ relativePath: "new.py", base64Data: Buffer.from("print('new')").toString("base64") }],
      });
      assert.equal(p06Sub.success, true);

      const afterPortalRec = spckUploadRepo.findOne(p06ClassId, p06StuId)!;
      const sess12 = spckSessionRepo.getOrInitSessionDraft(p06ClassId, p06StuId, 12);
      const mergedP06 = mergePortalRecordIntoUiRow(dirtyUi, {
        ...(afterPortalRec as any),
        draftVersion: sess12.draftVersion,
      });
      assert.equal(
        mergedP06.isConfirmedByTeacher,
        false,
        "P06: mergePortalRecordIntoUiRow bắt buộc hạ isConfirmedByTeacher về false khi có bài Portal mới chưa xác nhận"
      );
      assert.equal(
        mergedP06.teacherNote,
        "Ghi chú đang gõ dở",
        "P06: Ghi chú giáo viên đang gõ dở vẫn được giữ nguyên"
      );
    }

    // P07 & P08 (F06 & F08): HTML <img src="file:///..."> inside Qt QLabel MUST NOT leak foreign student pixels AND Portal .ui scan MUST NOT block Event Loop
    {
      const p07ClassADir = path.join(tempDir, "p07_class_a", "student_a");
      const p07ClassBDir = path.join(tempDir, "p07_class_b", "student_b");
      fs.mkdirSync(p07ClassADir, { recursive: true });
      fs.mkdirSync(p07ClassBDir, { recursive: true });
      const foreignRedImg = path.join(p07ClassBDir, "foreign_red.png");
      fs.writeFileSync(foreignRedImg, redPngBuffer);
      const foreignFileUrl = pathToFileURL(foreignRedImg).href;
      const htmlRichText = `<html><body><img src="${foreignFileUrl}" width="160" height="100"/></body></html>`;
      const xmlEsc = (s: string) =>
        s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const richTextUiXml = `<?xml version="1.0"?><ui version="4.0"><class>Form</class><widget class="QWidget" name="Form"><property name="geometry"><rect><x>0</x><y>0</y><width>260</width><height>180</rect></property><widget class="QLabel" name="label"><property name="geometry"><rect><x>10</x><y>10</y><width>220</width><height>140</rect></property><property name="text"><string>${xmlEsc(
        htmlRichText
      )}</string></property></widget></widget><resources/><connections/></ui>`.replace(
        /<\/rect>/g,
        "</height></rect>"
      );
      // Write clean valid XML for P07 & P08
      const cleanRichUiXml = `<?xml version="1.0"?><ui version="4.0"><class>Form</class><widget class="QWidget" name="Form"><property name="geometry"><rect><x>0</x><y>0</x><width>260</width><height>180</height></rect></property><widget class="QLabel" name="label"><property name="geometry"><rect><x>10</x><y>10</x><width>220</width><height>140</height></rect></property><property name="text"><string>${xmlEsc(
        htmlRichText
      )}</string></property></widget></widget><resources/><connections/></ui>`.replace(
        /<y>0<\/x>/g,
        "<y>0</y>"
      ).replace(/<y>10<\/x>/g, "<y>10</y>");
      fs.writeFileSync(path.join(p07ClassADir, "rich_screen.ui"), cleanRichUiXml, "utf-8");

      const p07Shots = await renderPyQtUiScreenshotsAsync({
        studentDir: p07ClassADir,
        outDir: path.join(p07ClassADir, "_spck_app_shots"),
        uiFiles: ["rich_screen.ui"],
        maxShots: 1,
      });
      assert.equal(
        p07Shots.length,
        1,
        "P07: renderPyQtUiScreenshotsAsync bắt buộc phải kết xuất được 1 ảnh giao diện (không được trả mảng rỗng do SyntaxError)"
      );
      const { spawnSync } = await import("node:child_process");
      const pxRes = spawnSync(
        "python",
        [
          "-c",
          "from PyQt6.QtGui import QImage; import sys; im=QImage(sys.argv[1]); assert not im.isNull(); print(sum(1 for y in range(im.height()) for x in range(im.width()) if (lambda c:c.red()>240 and c.green()<15 and c.blue()<15)(im.pixelColor(x,y))))",
          p07Shots[0].filePath,
        ],
        { encoding: "utf8", windowsHide: true }
      );
      assert.equal(
        pxRes.status,
        0,
        `P07: Kiểm tra pixel ảnh chụp PyQt bắt buộc thành công (stderr=${pxRes.stderr || ""})`
      );
      assert.equal(
        Number(pxRes.stdout.trim()),
        0,
        "P07: HTML <img src='file:///...'> trong QLabel tuyệt đối không được đọc ảnh đỏ của học sinh lớp khác"
      );

      // P08: Submitting `.ui` through Student Portal must render asynchronously without freezing 10ms Event Loop heartbeat!
      let p08Ticks = 0;
      const p08Timer = setInterval(() => {
        p08Ticks += 1;
      }, 10);
      try {
        const p08Res = await studentPortalManager.processStudentSubmission({
          studentId: "P06_STU",
          files: [
            {
              relativePath: "rich_screen.ui",
              base64Data: Buffer.from(cleanRichUiXml, "utf8").toString("base64"),
            },
          ],
        });
        assert.equal(p08Res.success, true);
      } finally {
        clearInterval(p08Timer);
      }
      assert.ok(
        p08Ticks > 0,
        `P08: Luồng nhận bài .ui qua Student Portal phải chạy bất đồng bộ không khóa Event Loop (ticks=${p08Ticks})`
      );
    }

    // P09 (F07) & B3 previousUpdatedAt: `SB` rubric MUST NOT match `VT-JSB15`, and stale `previousUpdatedAt` returns 409 Conflict
    {
      const cfgBeforeP09 = await (
        await configGET(makeLocalReq("http://127.0.0.1:3000/api/config"))
      ).json();
      const staleUpdatedAt = "1999-01-01T00:00:00.000Z";
      const stalePrevUpdatedResp = await configPOST(
        makeLocalReq("http://127.0.0.1:3000/api/config", {
          method: "POST",
          body: JSON.stringify({
            section: "courses",
            previousUpdatedAt: staleUpdatedAt,
            courses: cfgBeforeP09.courses,
          }),
        })
      );
      assert.equal(
        stalePrevUpdatedResp.status,
        409,
        "B3: previousUpdatedAt cũ phải trả về 409 Conflict"
      );

      const seedSbResp = await configPOST(
        makeLocalReq("http://127.0.0.1:3000/api/config", {
          method: "POST",
          body: JSON.stringify({
            section: "rubrics",
            expectedRevision: cfgBeforeP09.revisions.rubrics,
            rubrics: [
              {
                rubricId: "scratch-sb-session1",
                courseCode: "SB",
                sessionNumber: 1,
                assignmentTitle: "Scratch Basic B1",
                assignmentPrompt: "Scratch blocks",
                maxTotalScore: 100,
                criteria: [
                  {
                    criterionId: "c1",
                    name: "Scratch",
                    maxPoints: 100,
                    description: "Scratch",
                  },
                ],
              },
            ],
          }),
        })
      );
      assert.equal(seedSbResp.status, 200);

      const jsbWithOnlySbRubricResp = await downloadAndGradePOST(
        makeLocalReq("http://127.0.0.1:3000/api/homework-grader/download-and-grade", {
          method: "POST",
          body: JSON.stringify({
            classId: "VT-JSB15",
            classCode: "VT-JSB15",
            sessionId: "VT-JSB15_SESS_1",
            skipDownload: true,
          }),
        })
      );
      assert.equal(
        jsbWithOnlySbRubricResp.status,
        400,
        "P09: Lớp VT-JSB15 tuyệt đối không được nhận nhầm barem của khóa SB do trùng chuỗi con"
      );
    }

    console.log("   [PASS] T9 (P01 -> P09 & previousUpdatedAt) đạt 100%.");

    // =========================================================================
    // T10: Codex Round-2 Counterexamples (F2-01 N03, F2-02 N04/N05, F2-03 N06/N07, F2-04 N12)
    // =========================================================================
    console.log("11. [T10] Kiểm tra các phản ví dụ Vòng 2 (F2-01 -> F2-04)...");
    {
      const { pathToFileURL } = await import("node:url");
      const { spawnSync } = await import("node:child_process");
      const { spckSessionRepo } = await import("../src/lib/db/sqlite");
      const { scanStudentSpckFolderAsync } = await import("../src/lib/local-files/spck-scanner");
      const { POST: spckScanPOST } = await import("../src/app/api/spck/scan/route");

      // 11.1 F2-01 (N03): Multi-element strict-mode locators (2 progressbars / 2 alerts / 2 dialogs) + trailing dialog after DOM read
      const n03Folder = "N03_FOLDER_1234567890";
      const n03Old = { id: "N03_OLD_FILE_1234567890", name: "old.txt", isFolder: false };
      const n03New = { id: "N03_NEW_FILE_1234567890", name: "new.txt", isFolder: false };
      const n03LocalFile = path.join(tempDir, "n03_new.txt");
      fs.writeFileSync(n03LocalFile, "N03 NEW CONTENT", "utf-8");

      const runN03Variant = async (
        variant: "two_progress" | "two_alerts" | "trailing_dialog" | "locator_throw"
      ) => {
        let uploaded = false;
        let domReadCount = 0;
        let trashClicks = 0;

        const makeLoc = (selector: string, scopedSingle = false): any => ({
          first: () => makeLoc(selector, true),
          last: () => makeLoc(selector, true),
          filter: () => makeLoc(selector, scopedSingle),
          count: async () => 2,
          isVisible: async () => {
            if (selector.includes("new_menu_button") || selector.includes('[role="menuitem"]') || selector.includes('[data-target="doc"]')) {
              if (/Move to trash|thùng rác/i.test(selector)) return true;
              return !selector.includes("Giữ cả hai") && !selector.includes("Thư mục mới");
            }
            if (selector.includes("Giữ cả hai") || selector.includes("Keep both")) {
              return false;
            }
            if (variant === "locator_throw" && selector.includes("progressbar")) {
              throw new Error("Simulated frame detached during locator inspection");
            }
            if (variant === "two_progress" && selector.includes("progressbar")) {
              if (!scopedSingle) {
                throw new Error("strict mode violation: locator resolved to 2 elements");
              }
              return true;
            }
            if (variant === "two_alerts" && selector.includes("Upload failed")) {
              if (!scopedSingle) {
                throw new Error("strict mode violation: locator resolved to 2 elements");
              }
              return true;
            }
            if (variant === "trailing_dialog" && selector === '[role="dialog"]:visible') {
              return domReadCount >= 2;
            }
            return false;
          },
          click: async () => {
            if (/Move to trash|thùng rác/i.test(selector)) trashClicks += 1;
          },
          waitFor: async () => {},
        });

        const mockPage: any = {
          url: () => `https://drive.google.com/drive/folders/${n03Folder}`,
          goto: async () => {},
          waitForTimeout: async () => {},
          locator: (sel: string) => makeLoc(sel, false),
          evaluate: async () => {
            domReadCount += 1;
            return uploaded ? [n03Old, n03New] : [n03Old];
          },
          keyboard: { press: async () => {} },
          waitForEvent: async () => ({
            setFiles: async () => {
              uploaded = true;
            },
          }),
        };

        await assert.rejects(
          async () => {
            await uploadFilesIntoDriveFolder(mockPage, n03Folder, [n03LocalFile]);
          },
          variant === "two_alerts"
            ? /Google Drive báo lỗi tải tệp lên/i
            : /thanh tiến trình vẫn đang chạy/i,
          `N03 (${variant}): Phải chặn hoàn tất upload và ném lỗi an toàn`
        );
        assert.equal(
          trashClicks,
          0,
          `N03 (${variant}): Tuyệt đối 0 lần bấm Move to trash`
        );
      };

      await runN03Variant("two_progress");
      await runN03Variant("two_alerts");
      await runN03Variant("trailing_dialog");
      await runN03Variant("locator_throw");

      // 11.2 F2-02 (N04 + N05): Portal restart & class switch MUST NOT allow ordinary draft save to confirm or queue Drive
      const n04ClassA = "VT-CSI-N04A";
      const n04ClassB = "VT-CSI-N04B";
      const n04StuId = "N04_STU_01";
      const n04DirA = path.join(tempDir, "n04_class_a");
      const n04DirB = path.join(tempDir, "n04_class_b");
      fs.mkdirSync(n04DirA, { recursive: true });
      fs.mkdirSync(n04DirB, { recursive: true });
      studentRepo.upsert({ classId: n04ClassA, studentId: n04StuId, fullName: "Tran Van N04", isActive: 1 });
      studentRepo.upsert({ classId: n04ClassB, studentId: "N04_STU_B", fullName: "Le Thi B", isActive: 1 });
      classSessionRepo.upsert({
        classId: n04ClassA,
        className: "N04 Class A",
        sessionId: "N04A_S12",
        sessionNumber: 12,
        date: "11/11/2026",
        topic: "SPCK",
      });
      classSessionRepo.upsert({
        classId: n04ClassB,
        className: "N04 Class B",
        sessionId: "N04B_S12",
        sessionNumber: 12,
        date: "11/11/2026",
        topic: "SPCK",
      });

      await studentPortalManager.stopPortal();
      await studentPortalManager.startPortal({
        classId: n04ClassA,
        folderPath: n04DirA,
        autoUploadDrive: true,
      });

      const n04Upload = await studentPortalManager.processStudentSubmission({
        studentId: n04StuId,
        files: [
          {
            relativePath: "app.py",
            base64Data: Buffer.from("print('portal v1')").toString("base64"),
          },
        ],
      });
      assert.equal(n04Upload.success, true);
      assert.equal(spckUploadRepo.findOne(n04ClassA, n04StuId)?.isConfirmedByTeacher, 0);

      let driveQueueCalls = 0;
      const origQueueDrive = studentPortalManager.queueDriveUploadForConfirmedStudent.bind(
        studentPortalManager
      );
      (studentPortalManager as any).queueDriveUploadForConfirmedStudent = (
        cid: string,
        sid: string
      ) => {
        driveQueueCalls += 1;
        studentPortalManager.clearUnconfirmedSubmission(cid, sid);
      };

      try {
        // Case A: Restart portal on same class -> ordinary save with stale `isConfirmedByTeacher: true`
        await studentPortalManager.stopPortal();
        await studentPortalManager.startPortal({
          classId: n04ClassA,
          folderPath: n04DirA,
          autoUploadDrive: true,
        });
        assert.equal(
          studentPortalManager.hasUnconfirmedSubmission(n04ClassA, n04StuId),
          true,
          "N04: Sau khi mở lại Portal, trạng thái chờ giáo viên xác nhận phải được phục hồi từ đĩa"
        );

        const ordinarySaveAfterRestart = await saveSpckDraftPOST(
          new Request("http://127.0.0.1:3000/api/spck/save-draft", {
            method: "POST",
            headers: {
              host: "127.0.0.1:3000",
              origin: "http://127.0.0.1:3000",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              classId: n04ClassA,
              studentId: n04StuId,
              sessionNumber: 12,
              isConfirmedByTeacher: true,
              teacherComment: "Lưu nháp thường sau khi mở lại cổng",
            }),
          })
        );
        assert.equal(ordinarySaveAfterRestart.status, 200);
        assert.equal(
          spckUploadRepo.findOne(n04ClassA, n04StuId)?.isConfirmedByTeacher,
          0,
          "N04: Lưu nháp thường sau mở lại cổng KHÔNG được nâng isConfirmedByTeacher lên 1"
        );
        assert.equal(driveQueueCalls, 0, "N04: Không được xếp hàng tải Drive khi chưa xác nhận rõ ràng");

        // Case B: Switch portal to Class B -> ordinary save on Class A + scan on Class A
        await studentPortalManager.startPortal({
          classId: n04ClassB,
          folderPath: n04DirB,
          autoUploadDrive: true,
        });
        const ordinarySaveAfterClassSwitch = await saveSpckDraftPOST(
          new Request("http://127.0.0.1:3000/api/spck/save-draft", {
            method: "POST",
            headers: {
              host: "127.0.0.1:3000",
              origin: "http://127.0.0.1:3000",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              classId: n04ClassA,
              studentId: n04StuId,
              sessionNumber: 12,
              isConfirmedByTeacher: true,
              teacherComment: "Lưu nháp thường sau khi đổi lớp",
            }),
          })
        );
        assert.equal(ordinarySaveAfterClassSwitch.status, 200);
        assert.equal(
          spckUploadRepo.findOne(n04ClassA, n04StuId)?.isConfirmedByTeacher,
          0,
          "N04: Lưu nháp thường sau khi đổi lớp Portal sang lớp khác vẫn phải giữ isConfirmedByTeacher = 0"
        );
        assert.equal(driveQueueCalls, 0);

        const scanAfterPortalResp = await spckScanPOST(
          new Request("http://127.0.0.1:3000/api/spck/scan", {
            method: "POST",
            headers: {
              host: "127.0.0.1:3000",
              origin: "http://127.0.0.1:3000",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              classId: n04ClassA,
              folderPath: n04DirA,
              sessionNumber: 12,
            }),
          })
        );
        assert.equal(scanAfterPortalResp.status, 200);
        assert.equal(
          spckUploadRepo.findOne(n04ClassA, n04StuId)?.isConfirmedByTeacher,
          0,
          "N04: Quét lại thư mục cũng không được tự xác nhận bài nộp Portal chưa duyệt"
        );

        // Case C: Explicit teacher confirmation (`confirmTeacherAssignment: true`) transitions 0 -> 1 and queues Drive once
        const explicitConfirmResp = await saveSpckDraftPOST(
          new Request("http://127.0.0.1:3000/api/spck/save-draft", {
            method: "POST",
            headers: {
              host: "127.0.0.1:3000",
              origin: "http://127.0.0.1:3000",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              classId: n04ClassA,
              studentId: n04StuId,
              sessionNumber: 12,
              isConfirmedByTeacher: true,
              confirmTeacherAssignment: true,
              teacherComment: "Giáo viên bấm xác nhận rõ ràng",
            }),
          })
        );
        assert.equal(explicitConfirmResp.status, 200);
        assert.equal(
          spckUploadRepo.findOne(n04ClassA, n04StuId)?.isConfirmedByTeacher,
          1,
          "N04: Khi gửi confirmTeacherAssignment=true rõ ràng, isConfirmedByTeacher phải chuyển sang 1"
        );
        assert.equal(driveQueueCalls, 1, "N04: Xác nhận rõ ràng phải gọi xếp Drive đúng 1 lần");
      } finally {
        (studentPortalManager as any).queueDriveUploadForConfirmedStudent = origQueueDrive;
      }

      // N05: mergePortalRecordIntoUiRow unconditionally sets WAITING_APPROVAL and empty hash when server reports isConfirmedByTeacher = 0
      const baseN05Row: any = buildRowFromDbRecord(
        {
          ...(spckUploadRepo.findOne(n04ClassA, n04StuId) as any),
          isConfirmedByTeacher: 1,
          status: "APPROVED",
          contentHash: "APPROVED_HASH",
          draftVersion: 1,
        },
        { studentId: n04StuId, classId: n04ClassA, fullName: "Tran Van N04", isActive: 1 },
        12
      );
      baseN05Row.isDirty = true;
      baseN05Row.teacherNote = "Đang gõ";
      const mergedN05 = mergePortalRecordIntoUiRow(baseN05Row, {
        ...(spckUploadRepo.findOne(n04ClassA, n04StuId) as any),
        isConfirmedByTeacher: 0,
        status: "APPROVED",
        contentHash: "STALE_HASH",
        draftVersion: 2,
      });
      assert.equal(mergedN05.isConfirmedByTeacher, false);
      assert.equal(
        mergedN05.status,
        "WAITING_APPROVAL",
        "N05: Khi server báo isConfirmedByTeacher=0 thì status bắt buộc về WAITING_APPROVAL vô điều kiện"
      );
      assert.equal(mergedN05.contentHash, "");
      assert.equal(mergedN05.teacherNote, "Đang gõ");

      // 11.3 F2-03 (N06/N07): Own valid green image MUST render >500 green pixels while all 6 foreign red HTML/CSS/entity vectors produce 0 red pixels
      const n06StudentDir = path.join(tempDir, "n06_class_a", "student_own");
      const n06ForeignDir = path.join(tempDir, "n06_class_b", "student_foreign");
      fs.mkdirSync(n06StudentDir, { recursive: true });
      fs.mkdirSync(n06ForeignDir, { recursive: true });

      const makeSolidPngRes = spawnSync(
        "python",
        [
          "-c",
          "from PyQt6.QtGui import QImage, QColor; import sys; im=QImage(120,90,QImage.Format.Format_RGB32); im.fill(QColor(int(sys.argv[2]),int(sys.argv[3]),int(sys.argv[4]))); assert im.save(sys.argv[1],'PNG')",
          path.join(n06StudentDir, "own_green.png"),
          "0",
          "250",
          "0",
        ],
        { encoding: "utf8", windowsHide: true }
      );
      assert.equal(makeSolidPngRes.status, 0);
      const makeForeignRedRes = spawnSync(
        "python",
        [
          "-c",
          "from PyQt6.QtGui import QImage, QColor; import sys; im=QImage(120,90,QImage.Format.Format_RGB32); im.fill(QColor(255,0,0)); assert im.save(sys.argv[1],'PNG')",
          path.join(n06ForeignDir, "foreign_red.png"),
        ],
        { encoding: "utf8", windowsHide: true }
      );
      assert.equal(makeForeignRedRes.status, 0);

      const foreignUrl = pathToFileURL(path.join(n06ForeignDir, "foreign_red.png")).href;
      const entityForeignUrl = foreignUrl.replace(/^file/i, "&#102;ile");
      const xmlEsc = (s: string) =>
        s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const adversarialRichHtml = [
        `<html><body background="${foreignUrl}">`,
        `<img src='own_green.png' width="120" height="90"/>`,
        `<img src=${foreignUrl} width="60" height="50"/>`,
        `<img src="${entityForeignUrl}" width="60" height="50"/>`,
        `<div style="background-image: &#117;rl('${foreignUrl}'); width:60px; height:50px;">X</div>`,
        `</body></html>`,
      ].join("");

      const n06UiXml = [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<ui version="4.0"><class>MainWin</class>`,
        `<widget class="QWidget" name="MainWin">`,
        `<property name="geometry"><rect><x>0</x><y>0</y><width>420</width><height>280</height></rect></property>`,
        `<property name="styleSheet"><string>${xmlEsc(`QFrame#badBox { border-image: url("${foreignUrl}"); }`)}</string></property>`,
        `<widget class="QLabel" name="richLbl">`,
        `<property name="geometry"><rect><x>10</x><y>10</y><width>260</width><height>220</height></rect></property>`,
        `<property name="text"><string>${xmlEsc(adversarialRichHtml)}</string></property>`,
        `</widget>`,
        `<widget class="QFrame" name="badBox">`,
        `<property name="geometry"><rect><x>280</x><y>10</y><width>120</width><height>120</height></rect></property>`,
        `</widget>`,
        `</widget><resources/><connections/></ui>`,
      ].join("");
      fs.writeFileSync(path.join(n06StudentDir, "n06_screen.ui"), n06UiXml, "utf-8");

      const n06Shots = await renderPyQtUiScreenshotsAsync({
        studentDir: n06StudentDir,
        outDir: path.join(n06StudentDir, "_spck_app_shots"),
        uiFiles: ["n06_screen.ui"],
        maxShots: 1,
      });
      assert.equal(n06Shots.length, 1, "N06/N07: Phải kết xuất thành công 1 ảnh từ .ui hợp lệ");
      const n06ColorRes = spawnSync(
        "python",
        [
          "-c",
          [
            "from PyQt6.QtGui import QImage; import sys, json",
            "im = QImage(sys.argv[1])",
            "assert not im.isNull()",
            "red = 0; green = 0",
            "for y in range(im.height()):",
            "  for x in range(im.width()):",
            "    c = im.pixelColor(x, y)",
            "    if c.red() > 220 and c.green() < 30 and c.blue() < 30: red += 1",
            "    if c.green() > 200 and c.red() < 40 and c.blue() < 40: green += 1",
            "print(json.dumps({'red': red, 'green': green}))",
          ].join("\n"),
          n06Shots[0].filePath,
        ],
        { encoding: "utf8", windowsHide: true }
      );
      assert.equal(n06ColorRes.status, 0, n06ColorRes.stderr || "pixel check failed");
      const n06Counts = JSON.parse(n06ColorRes.stdout.trim()) as { red: number; green: number };
      assert.equal(
        n06Counts.red,
        0,
        "N06/N07: Tuyệt đối 0 pixel đỏ rò rỉ từ mọi biến thể unquoted/entity/background/CSS url(...)"
      );
      assert.ok(
        n06Counts.green > 500,
        `N06/N07: Ảnh xanh hợp lệ của chính học sinh phải hiển thị rõ ràng (green=${n06Counts.green})`
      );

      // 11.4 F2-04 (N12): Legacy 320x240 JPEG in `_spck_app_shots` normalized asynchronously without blocking Event Loop
      const n12ClassId = "VT-CSI-N12";
      const n12ClassDir = path.join(tempDir, "n12_class");
      const n12StuDir = path.join(n12ClassDir, "Pham Van N12");
      const n12ShotsDir = path.join(n12StuDir, "_spck_app_shots");
      fs.mkdirSync(n12ShotsDir, { recursive: true });
      fs.writeFileSync(path.join(n12StuDir, "main.py"), "print('hello n12')", "utf-8");
      studentRepo.upsert({
        classId: n12ClassId,
        studentId: "N12_STU_01",
        fullName: "Pham Van N12",
        isActive: 1,
      });
      classSessionRepo.upsert({
        classId: n12ClassId,
        className: "N12 Class",
        sessionId: "N12_S12",
        sessionNumber: 12,
        date: "11/11/2026",
        topic: "SPCK",
      });

      const makeLegacyJpg = (targetJpg: string) => {
        const jr = spawnSync(
          "python",
          [
            "-c",
            "from PyQt6.QtGui import QImage, QColor; import sys; im=QImage(320,240,QImage.Format.Format_RGB32); im.fill(QColor(30,144,255)); assert im.save(sys.argv[1],'JPG')",
            targetJpg,
          ],
          { encoding: "utf8", windowsHide: true }
        );
        assert.equal(jr.status, 0);
      };

      const jpg1 = path.join(n12ShotsDir, "app_01_legacy_aaaaaa.jpg");
      makeLegacyJpg(jpg1);
      let n12StudentTicks = 0;
      const n12Timer1 = setInterval(() => {
        n12StudentTicks += 1;
      }, 10);
      try {
        const pkg = await scanStudentSpckFolderAsync(n12StuDir, "Pham Van N12");
        assert.ok(pkg.screenshots.some((p) => p.endsWith("app_01_legacy_aaaaaa.png")));
      } finally {
        clearInterval(n12Timer1);
      }
      assert.ok(
        n12StudentTicks > 0,
        `N12: scanStudentSpckFolderAsync chuẩn hóa JPEG cũ không được khóa Event Loop (ticks=${n12StudentTicks})`
      );

      // Re-create legacy JPEG and run POST /api/spck/scan
      fs.rmSync(path.join(n12ShotsDir, "app_01_legacy_aaaaaa.png"), { force: true });
      makeLegacyJpg(jpg1);
      let n12RouteTicks = 0;
      const n12Timer2 = setInterval(() => {
        n12RouteTicks += 1;
      }, 10);
      let n12ScanResp: Response;
      try {
        n12ScanResp = await spckScanPOST(
          new Request("http://127.0.0.1:3000/api/spck/scan", {
            method: "POST",
            headers: {
              host: "127.0.0.1:3000",
              origin: "http://127.0.0.1:3000",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              classId: n12ClassId,
              folderPath: n12ClassDir,
              sessionNumber: 12,
            }),
          })
        );
      } finally {
        clearInterval(n12Timer2);
      }
      assert.equal(n12ScanResp.status, 200);
      assert.ok(
        n12RouteTicks > 0,
        `N12: POST /api/spck/scan chuẩn hóa JPEG cũ không được khóa Event Loop (ticks=${n12RouteTicks})`
      );
      const normPngPath = path.join(n12ShotsDir, "app_01_legacy_aaaaaa.png");
      assert.equal(fs.existsSync(normPngPath), true);
      const dimCheck = spawnSync(
        "python",
        [
          "-c",
          "from PyQt6.QtGui import QImage; import sys; im=QImage(sys.argv[1]); print(f'{im.width()}x{im.height()}')",
          normPngPath,
        ],
        { encoding: "utf8", windowsHide: true }
      );
      assert.equal(dimCheck.stdout.trim(), "960x540");
    }
    console.log("   [PASS] T10 (Phản ví dụ Vòng 2: F2-01 -> F2-04) đạt 100%.");

    // =========================================================================
    // T11: Codex Round-3 Counterexamples (F3-01 Marker Read/Stat/Corrupt Fail-Closed & F3-02 Marker Write Before Swap)
    // =========================================================================
    console.log("12. [T11] Kiểm tra các phản ví dụ Vòng 3 (F3-01 & F3-02)...");
    {
      const { getDb } = await import("../src/lib/db/sqlite");
      const { scanStudentSpckFolderAsync } = await import("../src/lib/local-files/spck-scanner");

      // 12.1 F3-02: ENOSPC / EACCES when writing `portal_unconfirmed.json` MUST leave active `safeStudentFolder` intact immediately!
      const f302ClassId = "VT-CSI-F302";
      const f302StuId = "F302_STU_01";
      const f302ClassDir = path.join(tempDir, "f302_class");
      const f302StuDir = path.join(f302ClassDir, "Le Van F302");
      fs.mkdirSync(f302StuDir, { recursive: true });
      fs.writeFileSync(path.join(f302StuDir, "old.txt"), "ONLY ORIGINAL SOURCE", "utf-8");
      fs.writeFileSync(path.join(f302StuDir, "main.py"), "print('original')", "utf-8");

      studentRepo.upsert({
        classId: f302ClassId,
        studentId: f302StuId,
        fullName: "Le Van F302",
        isActive: 1,
      });
      classSessionRepo.upsert({
        classId: f302ClassId,
        className: "F302 Class",
        sessionId: "F302_S12",
        sessionNumber: 12,
        date: "11/11/2026",
        topic: "SPCK",
      });
      spckUploadRepo.upsert({
        classId: f302ClassId,
        studentId: f302StuId,
        localFolderPath: f302StuDir,
        matchScore: 1,
        isConfirmedByTeacher: 1,
        projectTitle: "SPCK Le Van F302",
        thumbnailPath: "",
        screenshotsJson: "[]",
        attachmentsJson: "[]",
        youtubeUrlsJson: "[]",
        relatedLinksJson: "[]",
        teacherComment: "Đã xác nhận bài cũ",
        contentHash: "",
        status: "WAITING_APPROVAL",
      });

      await studentPortalManager.stopPortal();
      await studentPortalManager.startPortal({
        classId: f302ClassId,
        folderPath: f302ClassDir,
        autoUploadDrive: false,
      });

      for (const writeErrCode of ["ENOSPC", "EACCES"] as const) {
        const origWrite = fs.writeFileSync.bind(fs);
        (fs as any).writeFileSync = (targetPath: any, data: any, ...rest: any[]) => {
          if (String(targetPath).endsWith("portal_unconfirmed.json")) {
            throw Object.assign(new Error(`SIM_MARKER_${writeErrCode}`), { code: writeErrCode });
          }
          return (origWrite as any)(targetPath, data, ...rest);
        };
        let failedSub: any;
        try {
          failedSub = await studentPortalManager.processStudentSubmission({
            studentId: f302StuId,
            files: [
              {
                relativePath: "new.py",
                base64Data: Buffer.from("print('untrusted new')").toString("base64"),
              },
            ],
          });
        } finally {
          (fs as any).writeFileSync = origWrite;
        }
        assert.equal(failedSub.success, false);
        assert.equal(
          fs.existsSync(path.join(f302StuDir, "old.txt")),
          true,
          `F3-02 (${writeErrCode}): Thư mục bài đang dùng phải còn nguyên ngay lập tức mà không cần mở lại Portal`
        );
        assert.equal(
          fs.readFileSync(path.join(f302StuDir, "old.txt"), "utf-8"),
          "ONLY ORIGINAL SOURCE"
        );
        const immediateScan = await scanStudentSpckFolderAsync(f302StuDir, "Le Van F302");
        assert.ok(
          immediateScan.attachments.some((p) => p.endsWith("main.py")),
          `F3-02 (${writeErrCode}): Quét thư mục học sinh phải hoạt động ngay lập tức sau lỗi ghi marker`
        );
      }

      // 12.2 F3-01: Unreadable/EACCES/corrupt `portal_unconfirmed.json` after cold in-memory wipe MUST fail closed (never transition 0 -> 1 on ordinary save)
      const f301Sub = await studentPortalManager.processStudentSubmission({
        studentId: f302StuId,
        files: [
          {
            relativePath: "portal_new.py",
            base64Data: Buffer.from("print('portal submission')").toString("base64"),
          },
        ],
      });
      assert.equal(f301Sub.success, true);
      const markerPath = path.join(f302StuDir, "_spck_prev_backup", "portal_unconfirmed.json");
      assert.equal(fs.existsSync(markerPath), true);
      assert.equal(spckUploadRepo.findOne(f302ClassId, f302StuId)?.isConfirmedByTeacher, 0);
      assert.equal(spckUploadRepo.findOne(f302ClassId, f302StuId)?.pendingPortalConfirmation, 1);

      let f301DriveQueueCalls = 0;
      const origQueue = studentPortalManager.queueDriveUploadForConfirmedStudent.bind(
        studentPortalManager
      );
      (studentPortalManager as any).queueDriveUploadForConfirmedStudent = (
        cid: string,
        sid: string
      ) => {
        f301DriveQueueCalls += 1;
        studentPortalManager.clearUnconfirmedSubmission(cid, sid);
      };

      try {
        await studentPortalManager.stopPortal();

        // Test all 3 disk marker fault modes BOTH with DB pendingPortalConfirmation=1 AND even if DB column were 0 (pure disk fail-closed test!)
        for (const dbPendingVal of [1, 0] as const) {
          for (const faultMode of ["read_eacces", "lstat_eacces", "corrupt_json"] as const) {
            // Simulate cold Node process memory wipe
            (studentPortalManager as any).submissions.clear();
            (studentPortalManager as any).unconfirmedPortalByClassStudent.clear();
            getDb()
              .prepare(
                `UPDATE spck_uploads SET isConfirmedByTeacher = 0, pendingPortalConfirmation = ? WHERE classId = ? AND studentId = ?`
              )
              .run(dbPendingVal, f302ClassId, f302StuId);

            const origMarkerContent = fs.readFileSync(markerPath, "utf-8");
            if (faultMode === "corrupt_json") {
              fs.writeFileSync(markerPath, "{corrupt_not_json", "utf-8");
            }

            const origRead = fs.readFileSync.bind(fs);
            const origLstat = fs.lstatSync.bind(fs);
            if (faultMode === "read_eacces") {
              (fs as any).readFileSync = (p: any, ...args: any[]) => {
                if (path.resolve(String(p)) === path.resolve(markerPath)) {
                  throw Object.assign(new Error("SIM_MARKER_READ_EACCES"), { code: "EACCES" });
                }
                return (origRead as any)(p, ...args);
              };
            }
            if (faultMode === "lstat_eacces") {
              (fs as any).lstatSync = (p: any, ...args: any[]) => {
                if (path.resolve(String(p)) === path.resolve(markerPath)) {
                  throw Object.assign(new Error("SIM_MARKER_LSTAT_EACCES"), { code: "EACCES" });
                }
                return (origLstat as any)(p, ...args);
              };
            }

            try {
              assert.equal(
                studentPortalManager.hasUnconfirmedSubmission(f302ClassId, f302StuId),
                true,
                `F3-01 (db=${dbPendingVal}, mode=${faultMode}): Không đọc được marker bắt buộc phải fail-closed giữ pending=true`
              );

              const ordinarySave = await saveSpckDraftPOST(
                new Request("http://127.0.0.1:3000/api/spck/save-draft", {
                  method: "POST",
                  headers: {
                    host: "127.0.0.1:3000",
                    origin: "http://127.0.0.1:3000",
                    "content-type": "application/json",
                  },
                  body: JSON.stringify({
                    classId: f302ClassId,
                    studentId: f302StuId,
                    sessionNumber: 12,
                    isConfirmedByTeacher: true,
                    teacherComment: `Ordinary blur save under ${faultMode}`,
                  }),
                })
              );
              assert.equal(ordinarySave.status, 200);
              assert.equal(
                spckUploadRepo.findOne(f302ClassId, f302StuId)?.isConfirmedByTeacher,
                0,
                `F3-01 (db=${dbPendingVal}, mode=${faultMode}): Lưu nháp thường không được nâng 0 -> 1`
              );
              assert.equal(
                f301DriveQueueCalls,
                0,
                `F3-01 (db=${dbPendingVal}, mode=${faultMode}): Không được gọi queueDriveUploadForConfirmedStudent`
              );
            } finally {
              (fs as any).readFileSync = origRead;
              (fs as any).lstatSync = origLstat;
              if (faultMode === "corrupt_json") {
                fs.writeFileSync(markerPath, origMarkerContent, "utf-8");
              }
            }
          }
        }

        // Finally, explicit teacher confirmation (`confirmTeacherAssignment: true`) transitions 0 -> 1 cleanly
        const explicitSave = await saveSpckDraftPOST(
          new Request("http://127.0.0.1:3000/api/spck/save-draft", {
            method: "POST",
            headers: {
              host: "127.0.0.1:3000",
              origin: "http://127.0.0.1:3000",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              classId: f302ClassId,
              studentId: f302StuId,
              sessionNumber: 12,
              isConfirmedByTeacher: true,
              confirmTeacherAssignment: true,
              teacherComment: "Giáo viên bấm xác nhận rõ ràng sau lỗi đĩa",
            }),
          })
        );
        assert.equal(explicitSave.status, 200);
        assert.equal(spckUploadRepo.findOne(f302ClassId, f302StuId)?.isConfirmedByTeacher, 1);
        assert.equal(spckUploadRepo.findOne(f302ClassId, f302StuId)?.pendingPortalConfirmation, 0);
        assert.equal(f301DriveQueueCalls, 1);
      } finally {
        (studentPortalManager as any).queueDriveUploadForConfirmedStudent = origQueue;
      }
    }
    console.log("   [PASS] T11 (Phản ví dụ Vòng 3: F3-01 & F3-02) đạt 100%.");
    console.log("\n=== HOÀN TẤT: TẤT CẢ 12 NHÓM KIỂM THỬ AUDIT v3.4.1 ĐẠT 100% ===");
  } finally {
    await studentPortalManager.stopPortal().catch(() => {});
    closeDb();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error("KIỂM THỬ AUDIT v3.4.1 THẤT BẠI:", err);
  process.exit(1);
});
