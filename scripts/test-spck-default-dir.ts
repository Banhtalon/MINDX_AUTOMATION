/**
 * MINDX AUTOMATION BOT - SPCK DEFAULT DIRECTORY TEST SUITE
 * Verifies F:\MINDX_SPCK_FINAL auto-resolution, class folder matching/creation,
 * and Student Portal upload routing.
 */

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_SPCK_BASE_DIR,
  extractSpckClassFolderCode,
  resolveDefaultSpckClassFolder,
  resolveStudentFolderInsideClassRoot,
  resolveTargetSpckClassFolder,
} from "../src/lib/local-files/spck-scanner";
import { isPathAllowed } from "../src/lib/security/path-allowlist";

async function runTests() {
  console.log("=== SPCK DEFAULT DIRECTORY TEST SUITE ===");

  // 1. extractSpckClassFolderCode
  console.log("[Test 1] extractSpckClassFolderCode...");
  const c1 = extractSpckClassFolderCode("VT-JSB16");
  assert.strictEqual(c1.shortCode, "JSB16");
  assert.strictEqual(c1.fullCode, "VT-JSB16");

  const c2 = extractSpckClassFolderCode("VT-C4K-GA38");
  assert.strictEqual(c2.shortCode, "GA38");

  const c3 = extractSpckClassFolderCode("VT-ROB-SEMIA05");
  assert.strictEqual(c3.shortCode, "SEMIA05");

  const c4 = extractSpckClassFolderCode("VT-CSA04-HB");
  assert.strictEqual(c4.shortCode, "CSA04");
  assert.strictEqual(c4.tailCode, "CSA04-HB");
  console.log("  ✓ extractSpckClassFolderCode parsed class tokens correctly.");

  // 2. Real resolution on F:\MINDX_SPCK_FINAL for existing classes
  console.log("[Test 2] Real resolution against existing F:\\MINDX_SPCK_FINAL folders...");
  if (fs.existsSync(DEFAULT_SPCK_BASE_DIR)) {
    const jsb16Path = resolveDefaultSpckClassFolder("VT-JSB16", {
      createIfMissing: false,
      baseDir: DEFAULT_SPCK_BASE_DIR,
    });
    assert.strictEqual(
      path.resolve(jsb16Path).toLowerCase(),
      path.resolve(DEFAULT_SPCK_BASE_DIR, "JSB16").toLowerCase(),
      `Expected JSB16 folder, got ${jsb16Path}`
    );

    const jsb15Path = resolveDefaultSpckClassFolder("VT-JSB15", {
      createIfMissing: false,
      baseDir: DEFAULT_SPCK_BASE_DIR,
    });
    assert.strictEqual(
      path.resolve(jsb15Path).toLowerCase(),
      path.resolve(DEFAULT_SPCK_BASE_DIR, "jsb15").toLowerCase(),
      `Expected jsb15 folder, got ${jsb15Path}`
    );

    const ga38Path = resolveDefaultSpckClassFolder("VT-C4K-GA38", {
      createIfMissing: false,
      baseDir: DEFAULT_SPCK_BASE_DIR,
    });
    assert.strictEqual(
      path.resolve(ga38Path).toLowerCase(),
      path.resolve(DEFAULT_SPCK_BASE_DIR, "GA38").toLowerCase(),
      `Expected GA38 folder, got ${ga38Path}`
    );

    assert.ok(isPathAllowed(jsb16Path), "F:\\MINDX_SPCK_FINAL\\JSB16 must be allowlisted.");
    console.log("  ✓ Successfully matched existing folders JSB16, jsb15, GA38.");
  } else {
    console.log("  (Skipping real F: drive check - drive not mounted in this container)");
  }

  // 3. Auto-creation of missing class folders in a mock baseDir
  console.log("[Test 3] Auto-creation of missing class folder in mock baseDir...");
  const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-spck-test-"));
  try {
    const missingClassId = "VT-C4K-PTA99";
    const resolvedMissing = resolveDefaultSpckClassFolder(missingClassId, {
      createIfMissing: true,
      baseDir: tempBase,
    });
    assert.strictEqual(
      path.resolve(resolvedMissing).toLowerCase(),
      path.resolve(tempBase, "PTA99").toLowerCase()
    );
    assert.ok(fs.existsSync(resolvedMissing), "Missing folder must be auto-created.");
    assert.ok(isPathAllowed(resolvedMissing), "Auto-created class folder must be allowlisted.");
    console.log("  ✓ Successfully auto-created missing class folder PTA99 and registered in allowlist.");

    // 4. resolveTargetSpckClassFolder fallback logic
    console.log("[Test 4] resolveTargetSpckClassFolder fallbacks...");
    const tEmpty = resolveTargetSpckClassFolder(missingClassId, "", { baseDir: tempBase });
    assert.strictEqual(path.resolve(tEmpty).toLowerCase(), path.resolve(resolvedMissing).toLowerCase());

    const tCwd = resolveTargetSpckClassFolder(missingClassId, process.cwd(), { baseDir: tempBase });
    assert.strictEqual(path.resolve(tCwd).toLowerCase(), path.resolve(resolvedMissing).toLowerCase());

    const tLegacyData = resolveTargetSpckClassFolder(
      missingClassId,
      path.resolve(process.cwd(), "data", "spck", "VT-C4K-PTA99"),
      { baseDir: tempBase }
    );
    assert.strictEqual(path.resolve(tLegacyData).toLowerCase(), path.resolve(resolvedMissing).toLowerCase());

    const tBaseOnly = resolveTargetSpckClassFolder(missingClassId, tempBase, { baseDir: tempBase });
    assert.strictEqual(path.resolve(tBaseOnly).toLowerCase(), path.resolve(resolvedMissing).toLowerCase());

    console.log("  ✓ Correctly redirected empty, cwd, legacy data/spck, and baseDir inputs to class subfolder.");

    // 5. resolveStudentFolderInsideClassRoot
    console.log("[Test 5] resolveStudentFolderInsideClassRoot diacritic-insensitive matching...");
    // Create an existing folder "Duong Dang Khoi" (without diacritics)
    const mockStudentFolder = path.join(resolvedMissing, "Duong Dang Khoi");
    fs.mkdirSync(mockStudentFolder, { recursive: true });

    // Request with diacritics "Dương Đăng Khôi"
    const matchedStudentDir = resolveStudentFolderInsideClassRoot(
      resolvedMissing,
      "Dương Đăng Khôi",
      "STU_01"
    );
    assert.strictEqual(
      path.resolve(matchedStudentDir).toLowerCase(),
      path.resolve(mockStudentFolder).toLowerCase(),
      "Must reuse existing folder Duong Dang Khoi for Dương Đăng Khôi"
    );

    // Request for new student "Trần Gia Vĩ"
    const newStudentDir = resolveStudentFolderInsideClassRoot(
      resolvedMissing,
      "Trần Gia Vĩ",
      "STU_02"
    );
    assert.strictEqual(
      path.resolve(newStudentDir).toLowerCase(),
      path.resolve(resolvedMissing, "Trần Gia Vĩ").toLowerCase()
    );
    console.log("  ✓ Diacritic-insensitive student folder reuse and new folder naming verified.");
  } finally {
    fs.rmSync(tempBase, { recursive: true, force: true });
  }

  console.log("=== ALL SPCK DEFAULT DIRECTORY TESTS PASSED (100%) ===");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
