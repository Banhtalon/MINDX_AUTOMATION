/**
 * Test Student Portal upload into resolved class folder
 */

import assert from "node:assert";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { studentPortalManager } from "../src/lib/student-portal/student-portal-server";
import { closeDb, getDb, studentRepo } from "../src/lib/db/sqlite";

async function runPortalUploadTest() {
  console.log("=== STUDENT PORTAL DIRECTORY INTEGRATION TEST ===");

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-portal-test-"));
  const tempDb = path.join(tempRoot, "test.db");
  process.env.MINDX_DB_PATH = tempDb;

  const testClassId = "S5B_DIR_TEST";
  const studentId = "STU_TEST_01";
  const fullName = "Dương Đăng Khôi";

  try {
    const db = getDb();
    db.prepare(
      `INSERT OR REPLACE INTO students (studentId, classId, fullName, isActive)
       VALUES (?, ?, ?, 1)`
    ).run(studentId, testClassId, fullName);

    db.prepare(
      `INSERT OR REPLACE INTO classes_sessions (classId, sessionId, sessionNumber, className)
       VALUES (?, ?, 12, ?)`
    ).run(testClassId, "SESS_TEST_12", "Lớp Lập Trình Thử Nghiệm");

    const portalStatus = await studentPortalManager.startPortal({
      classId: testClassId,
      autoUploadDrive: false,
    });

    console.log(`[Portal Started] Root folder: ${portalStatus.rootFolderPath}`);
    assert.ok(portalStatus.rootFolderPath, "Root folder path must be set");
    assert.ok(
      portalStatus.rootFolderPath.includes("S5B_DIR_TEST") || portalStatus.rootFolderPath.includes("TEST"),
      "Root folder path must contain class identifier"
    );

    // Make an upload via processStudentSubmission
    const testFileContent = Buffer.from("console.log('SPCK Demo');").toString("base64");
    const uploadRes = await studentPortalManager.processStudentSubmission({
      studentId,
      projectTitle: "Game Phi Thuyền Không Gian",
      files: [
        {
          relativePath: "main.js",
          base64Data: testFileContent,
        },
      ],
    });

    assert.ok(uploadRes.success, `Upload should succeed: ${uploadRes.error}`);
    console.log(`[Upload 1 OK] Saved into: ${uploadRes.submission?.folderPath}`);

    const expectedStudentDir = path.join(portalStatus.rootFolderPath, fullName);
    assert.ok(
      fs.existsSync(expectedStudentDir),
      `Expected student folder to exist at ${expectedStudentDir}`
    );
    assert.ok(
      fs.existsSync(path.join(expectedStudentDir, "main.js")),
      "Uploaded file main.js must exist on disk"
    );

    // Second upload for the same student
    const uploadRes2 = await studentPortalManager.processStudentSubmission({
      studentId,
      projectTitle: "Game Phi Thuyền Không Gian (Bản cập nhật)",
      files: [
        {
          relativePath: "index.html",
          base64Data: Buffer.from("<h1>Game Demo</h1>").toString("base64"),
        },
      ],
    });
    assert.ok(uploadRes2.success, `Upload 2 should succeed: ${uploadRes2.error}`);
    assert.strictEqual(
      uploadRes2.submission?.folderPath,
      uploadRes.submission?.folderPath,
      "Second upload must use the exact same student folder"
    );
    assert.ok(
      fs.existsSync(path.join(expectedStudentDir, "index.html")),
      "Second uploaded file index.html must exist on disk"
    );

    await studentPortalManager.stopPortal();
    console.log("[Portal Stopped cleanly]");
    console.log("=== PORTAL DIRECTORY INTEGRATION TEST PASSED (100%) ===");
  } finally {
    await studentPortalManager.stopPortal().catch(() => {});
    closeDb();
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
    delete process.env.MINDX_DB_PATH;
  }
}

runPortalUploadTest().catch((err) => {
  console.error("Portal test failed:", err);
  process.exit(1);
});
