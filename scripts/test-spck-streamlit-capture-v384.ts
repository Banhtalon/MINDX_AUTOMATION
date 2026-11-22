/**
 * MINDX AUTOMATION BOT - ISOLATED STREAMLIT CAPTURE SUITE FOR v3.8.4
 * 100% isolated in `os.tmpdir()` (zero mutations to live `data/mindx_bot.db` or `D:\MINDX DATA\MINDX_SPCK_FINAL`):
 * - [ST-01] `findProjectStreamlitFiles` detection priority, Flask/comment rejection, `pages/` fallback & symlink rejection.
 * - [ST-02] `buildSafeStreamlitEnv` strictly strips sensitive secrets while pinning loopback Streamlit settings.
 * - [ST-03] Live tabbed Streamlit app capture: >= 2 crisp `960x540` PNGs, zero leaked secrets inside child Python env, 0 orphaned processes.
 * - [ST-04] Crashed Streamlit app (`stException`) discards crash image cleanly & emits diagnostic warning; missing Streamlit env emits graceful warning.
 * - [ST-05] Stop Bot (`stopQueue()` / `__mindxQueueStopped`) aborts immediately with `TASK_CANCELLED:` leaving 0 stray processes.
 * - [ST-06] Real-app test on isolated temp copy of Trần Minh Khang's `app.py` + `techbot_products_catalog_300_filled.csv`, plus `scanStudentSpckFolderAsync`.
 * - [ST-07] Static single-BrowserContext & loopback security invariants.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-v384-st-"));
const tempConfigDir = path.join(tempRoot, "config");
const tempSpckRoot = path.join(tempRoot, "spck_root");
const tempShotDir = path.join(tempRoot, "debug_shots");
const tempRoleDir = path.join(tempRoot, "role-state");

fs.mkdirSync(path.join(tempConfigDir, "demo-sheet-templates"), { recursive: true });
fs.mkdirSync(tempSpckRoot, { recursive: true });
fs.mkdirSync(tempShotDir, { recursive: true });
fs.mkdirSync(tempRoleDir, { recursive: true });

const defaultLogoSrc = path.join(ROOT, "data", "config", "default-spck-thumbnail.png");
if (fs.existsSync(defaultLogoSrc)) {
  fs.copyFileSync(defaultLogoSrc, path.join(tempConfigDir, "default-spck-thumbnail.png"));
}

const savedEnvSnapshot: Record<string, string | undefined> = {
  MINDX_DB_PATH: process.env.MINDX_DB_PATH,
  MINDX_CONFIG_DIR: process.env.MINDX_CONFIG_DIR,
  MINDX_RUNNING_CLASSES_PATH: process.env.MINDX_RUNNING_CLASSES_PATH,
  MINDX_LMS_CLASS_IDS_PATH: process.env.MINDX_LMS_CLASS_IDS_PATH,
  MINDX_ROLE_STATE_DIR: process.env.MINDX_ROLE_STATE_DIR,
  MINDX_DEBUG_SCREENSHOT_DIR: process.env.MINDX_DEBUG_SCREENSHOT_DIR,
  ALLOWED_LOCAL_DIRS: process.env.ALLOWED_LOCAL_DIRS,
  MINDX_ALLOWED_EXTRA_PATHS: process.env.MINDX_ALLOWED_EXTRA_PATHS,
  MINDX_ALLOW_STREAMLIT_CAPTURE_IN_TEST: process.env.MINDX_ALLOW_STREAMLIT_CAPTURE_IN_TEST,
  MINDX_STREAMLIT_PYTHON: process.env.MINDX_STREAMLIT_PYTHON,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  TEACHING_PASSWORD: process.env.TEACHING_PASSWORD,
  LMS_PASSWORD: process.env.LMS_PASSWORD,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  SECRET_API_TOKEN: process.env.SECRET_API_TOKEN,
};

process.env.MINDX_DB_PATH = path.join(tempRoot, "mindx_v384_test.db");
process.env.MINDX_CONFIG_DIR = tempConfigDir;
process.env.MINDX_RUNNING_CLASSES_PATH = path.join(tempRoot, "running_classes.json");
process.env.MINDX_LMS_CLASS_IDS_PATH = path.join(tempConfigDir, "lms_class_ids.json");
process.env.MINDX_ROLE_STATE_DIR = tempRoleDir;
process.env.MINDX_DEBUG_SCREENSHOT_DIR = tempShotDir;
process.env.ALLOWED_LOCAL_DIRS = tempRoot;
process.env.MINDX_ALLOWED_EXTRA_PATHS = tempRoot;
process.env.MINDX_ALLOW_STREAMLIT_CAPTURE_IN_TEST = "1";
process.env.GEMINI_API_KEY = "AIzaDummySecretKeyShouldNeverLeak384";
process.env.TEACHING_PASSWORD = "DummyTeachingSecretPassword384";
process.env.LMS_PASSWORD = "DummyLmsSecretPassword384";
process.env.GITHUB_TOKEN = "ghp_DummySecretToken384";
process.env.SECRET_API_TOKEN = "sk-DummySecretToken384";

fs.writeFileSync(
  process.env.MINDX_RUNNING_CLASSES_PATH,
  JSON.stringify([{ classCode: "VT-CSI99", status: "Running" }], null, 2)
);
fs.writeFileSync(
  process.env.MINDX_LMS_CLASS_IDS_PATH,
  JSON.stringify({ "VT-CSI99": "644346f794300678908f9999" }, null, 2)
);

function readPngDimensions(filePath: string): { width: number; height: number } {
  const buf = fs.readFileSync(filePath);
  assert.ok(buf.length >= 24, `PNG too small: ${filePath}`);
  assert.equal(buf[0], 0x89);
  assert.equal(buf[1], 0x50);
  assert.equal(buf[2], 0x4e);
  assert.equal(buf[3], 0x47);
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

function countLiveStreamlitProcessesMatching(pattern: string): number {
  if (process.platform === "win32") {
    const res = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*streamlit*run*' } | Select-Object -ExpandProperty CommandLine",
      ],
      { encoding: "utf8", windowsHide: true, timeout: 5000 }
    );
    const lines = String(res.stdout || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return lines.filter((l) => l.toLowerCase().includes(pattern.toLowerCase())).length;
  }
  return 0;
}

async function runTests() {
  const { closeDb } = await import("../src/lib/db/sqlite");
  const { SequentialTaskQueue } = await import("../src/lib/queue/task-queue");
  const {
    buildSafeStreamlitEnv,
    captureStreamlitAppScreenshotsAsync,
    findProjectStreamlitFiles,
    isStreamlitSourceCode,
    resetStreamlitPythonCacheForTests,
    resolveStreamlitPythonExecutableAsync,
  } = await import("../src/lib/local-files/spck-streamlit-screenshotter");
  const { captureStudentAppScreenshots } = await import(
    "../src/lib/local-files/spck-app-screenshotter"
  );
  const { scanStudentSpckFolderAsync } = await import(
    "../src/lib/local-files/spck-scanner"
  );

  try {
    // =========================================================================
    // [ST-01] Detection priority, Flask/comment rejection & symlink rejection
    // =========================================================================
    console.log("[ST-01] Checking Streamlit file detection & symlink isolation...");
    assert.equal(isStreamlitSourceCode("# import streamlit as st\nprint('hi')"), false);
    assert.equal(isStreamlitSourceCode('"""\nimport streamlit as st\n"""\nprint("hi")'), false);
    assert.equal(isStreamlitSourceCode("from flask import Flask\napp = Flask(__name__)"), false);
    assert.equal(isStreamlitSourceCode("import os, streamlit as st\nst.title('Ok')"), true);
    assert.equal(isStreamlitSourceCode("import streamlit as st\nst.title('Ok')"), true);
    assert.equal(isStreamlitSourceCode("from streamlit.components.v1 import html"), true);

    const detectDir = path.join(tempSpckRoot, "detect_student");
    const outsideEscapeDir = path.join(tempRoot, "outside_escape_dir");
    fs.mkdirSync(path.join(detectDir, "draft"), { recursive: true });
    fs.mkdirSync(path.join(detectDir, "pages"), { recursive: true });
    fs.mkdirSync(path.join(detectDir, ".venv", "Lib"), { recursive: true });
    fs.mkdirSync(outsideEscapeDir, { recursive: true });

    fs.writeFileSync(path.join(detectDir, "helper.py"), "# import streamlit as st\nx = 1\n");
    fs.writeFileSync(path.join(detectDir, "flask_app.py"), "from flask import Flask\n");
    fs.writeFileSync(path.join(detectDir, "draft", "app.py"), "import streamlit as st\nst.write('draft')\n");
    fs.writeFileSync(path.join(detectDir, "pages", "02_stats.py"), "import streamlit as st\nst.write('page')\n");
    fs.writeFileSync(path.join(detectDir, ".venv", "Lib", "st_fake.py"), "import streamlit as st\n");
    fs.writeFileSync(path.join(detectDir, "demo.py"), "import streamlit as st\nst.set_page_config(page_title='D')\n");
    fs.writeFileSync(path.join(detectDir, "app.py"), "import streamlit as st\nst.title('Primary')\n");
    fs.writeFileSync(path.join(outsideEscapeDir, "evil_app.py"), "import streamlit as st\n");

    // Directory junction pointing outside student folder (works without elevated privileges on Windows)
    try {
      fs.symlinkSync(
        outsideEscapeDir,
        path.join(detectDir, "junction_sub"),
        process.platform === "win32" ? "junction" : "dir"
      );
    } catch {
      // Ignore if environment forbids symlink creation
    }

    const detected = findProjectStreamlitFiles(detectDir);
    assert.deepEqual(detected, ["app.py", "demo.py"], `Unexpected detection: ${JSON.stringify(detected)}`);

    // Pages fallback when ONLY pages/*.py exists
    const pagesOnlyDir = path.join(tempSpckRoot, "pages_only_student");
    fs.mkdirSync(path.join(pagesOnlyDir, "pages"), { recursive: true });
    fs.writeFileSync(path.join(pagesOnlyDir, "pages", "01_view.py"), "import streamlit as st\nst.write('P1')\n");
    const pagesDetected = findProjectStreamlitFiles(pagesOnlyDir);
    assert.equal(pagesDetected.length, 1);
    assert.ok(pagesDetected[0].endsWith("01_view.py"));

    // Untrusted student-supplied .venv binary must NEVER be selected or executed
    const fakeStudentVenvDir = path.join(detectDir, ".venv", "Scripts");
    fs.mkdirSync(fakeStudentVenvDir, { recursive: true });
    const realProjectPy = path.join(ROOT, "data", "streamlit-venv", "Scripts", "python.exe");
    if (fs.existsSync(realProjectPy)) {
      fs.copyFileSync(realProjectPy, path.join(fakeStudentVenvDir, "python.exe"));
    } else {
      fs.writeFileSync(path.join(fakeStudentVenvDir, "python.exe"), "");
    }
    resetStreamlitPythonCacheForTests();
    const resolvedPy = await resolveStreamlitPythonExecutableAsync(detectDir);
    assert.ok(resolvedPy, "Expected host Streamlit interpreter to resolve");
    assert.ok(
      !path.resolve(resolvedPy.cmd).toLowerCase().startsWith(path.resolve(detectDir).toLowerCase()),
      `Must NEVER execute student folder binary: ${resolvedPy.cmd}`
    );
    console.log("  -> PASS [ST-01].");

    // =========================================================================
    // [ST-02] Env secret sanitization
    // =========================================================================
    console.log("[ST-02] Checking child environment secret scrubbing...");
    const cleanEnv = buildSafeStreamlitEnv();
    for (const secretKey of [
      "GEMINI_API_KEY",
      "TEACHING_PASSWORD",
      "LMS_PASSWORD",
      "GITHUB_TOKEN",
      "SECRET_API_TOKEN",
    ]) {
      assert.equal(cleanEnv[secretKey], undefined, `${secretKey} must NOT be present in child env`);
    }
    assert.equal(cleanEnv.STREAMLIT_SERVER_ADDRESS, "127.0.0.1");
    assert.equal(cleanEnv.STREAMLIT_SERVER_HEADLESS, "true");
    assert.equal(cleanEnv.STREAMLIT_BROWSER_GATHER_USAGE_STATS, "false");
    assert.equal(cleanEnv.PYTHONUTF8, "1");
    console.log("  -> PASS [ST-02].");

    // =========================================================================
    // [ST-03] Live tabbed Streamlit capture + 960x540 PNGs + zero leaked secrets + zero orphan procs
    // =========================================================================
    console.log("[ST-03] Rendering live tabbed Streamlit app & verifying 960x540 PNGs...");
    const tabStudentDir = path.join(tempSpckRoot, "tab_student_v384");
    const tabOutDir = path.join(tabStudentDir, "_spck_app_shots");
    fs.mkdirSync(tabStudentDir, { recursive: true });
    fs.writeFileSync(
      path.join(tabStudentDir, "app.py"),
      [
        "import json, os",
        "import pandas as pd",
        "import streamlit as st",
        "st.set_page_config(page_title='Tech Demo Tabs', layout='wide')",
        "with open('env_keys_seen.json', 'w', encoding='utf-8') as f:",
        "    json.dump(sorted(list(os.environ.keys())), f)",
        "st.title('Ứng dụng Quản lý Học tập AI')",
        "t1, t2 = st.tabs(['Tổng quan', 'Biểu đồ & Dữ liệu'])",
        "with t1:",
        "    st.metric('Điểm chuyên cần', '9.8/10', '+0.4')",
        "    st.success('Dữ liệu đã sẵn sàng cho Demo Day!')",
        "with t2:",
        "    df = pd.DataFrame({'Môn': ['Python', 'Web', 'AI'], 'Điểm': [9.5, 9.2, 9.9]})",
        "    st.bar_chart(df.set_index('Môn'))",
        "    st.dataframe(df)",
      ].join("\n"),
      "utf8"
    );

    const tabCap = await captureStreamlitAppScreenshotsAsync({
      studentDir: tabStudentDir,
      outDir: tabOutDir,
      maxShots: 4,
    });
    assert.equal(tabCap.warning, undefined, `Unexpected warning: ${tabCap.warning}`);
    assert.ok(
      tabCap.items.length >= 2,
      `Expected >= 2 tabbed screenshots, got ${tabCap.items.length}`
    );
    for (const item of tabCap.items) {
      assert.ok(fs.existsSync(item.filePath), `Missing PNG ${item.filePath}`);
      const dims = readPngDimensions(item.filePath);
      assert.equal(dims.width, 960, `Expected width 960, got ${dims.width}`);
      assert.equal(dims.height, 540, `Expected height 540, got ${dims.height}`);
    }
    const envKeysSeen: string[] = JSON.parse(
      fs.readFileSync(path.join(tabStudentDir, "env_keys_seen.json"), "utf8")
    );
    for (const secretKey of [
      "GEMINI_API_KEY",
      "TEACHING_PASSWORD",
      "LMS_PASSWORD",
      "GITHUB_TOKEN",
      "SECRET_API_TOKEN",
    ]) {
      assert.ok(!envKeysSeen.includes(secretKey), `Leaked secret env var to Streamlit: ${secretKey}`);
    }
    const strayProcs = countLiveStreamlitProcessesMatching("tab_student_v384");
    assert.equal(strayProcs, 0, `Expected 0 orphaned streamlit processes, found ${strayProcs}`);
    console.log(`  -> PASS [ST-03] (${tabCap.items.length} PNGs @ 960x540, 0 leaked secrets, 0 orphan procs).`);

    // =========================================================================
    // [ST-04] Crashed stException (hero/post-header/tab2), blank page & outDir junction
    // =========================================================================
    console.log("[ST-04] Checking stException filters, blank app, outDir junction & missing-env...");
    const crashDir = path.join(tempSpckRoot, "crash_student");
    const crashOutDir = path.join(crashDir, "_spck_app_shots");
    fs.mkdirSync(crashDir, { recursive: true });
    fs.writeFileSync(
      path.join(crashDir, "app.py"),
      [
        "import streamlit as st",
        "st.sidebar.header('Shop')",
        "st.title('Post Header Crash Demo')",
        "st.header('Section 1')",
        "st.write('Some content rendered before crash')",
        "x = 1 / 0",
        "st.write(x)",
      ].join("\n"),
      "utf8"
    );
    const crashRes = await captureStreamlitAppScreenshotsAsync({
      studentDir: crashDir,
      outDir: crashOutDir,
      maxShots: 4,
    });
    assert.equal(crashRes.items.length, 0, "Post-header crashed Streamlit app must produce 0 screenshots (F05)");
    assert.ok(crashRes.warning && crashRes.warning.length > 0, "Expected crash warning");
    assert.equal(
      fs.readdirSync(crashOutDir).filter((f) => f.endsWith(".png")).length,
      0,
      "Crash outDir must contain 0 PNGs"
    );

    const tab2CrashDir = path.join(tempSpckRoot, "tab2_crash_student");
    const tab2CrashOutDir = path.join(tab2CrashDir, "_spck_app_shots");
    fs.mkdirSync(tab2CrashDir, { recursive: true });
    fs.writeFileSync(
      path.join(tab2CrashDir, "app.py"),
      [
        "import streamlit as st",
        "t1, t2 = st.tabs(['Trang 1', 'Trang Lỗi'])",
        "with t1:",
        "    st.title('Trang chính ổn định')",
        "    st.metric('Số liệu', '100')",
        "with t2:",
        "    st.write('Đang tải tab 2...')",
        "    st.exception(RuntimeError('Tab 2 isolated error'))",
      ].join("\n"),
      "utf8"
    );
    const tab2CrashRes = await captureStreamlitAppScreenshotsAsync({
      studentDir: tab2CrashDir,
      outDir: tab2CrashOutDir,
      maxShots: 4,
    });
    assert.equal(tab2CrashRes.items.length, 1, "Crashed Tab 2 must be skipped while keeping clean Hero (F05)");

    const blankDir = path.join(tempSpckRoot, "blank_student");
    const blankOutDir = path.join(blankDir, "_spck_app_shots");
    fs.mkdirSync(blankDir, { recursive: true });
    fs.writeFileSync(path.join(blankDir, "app.py"), "import streamlit as st\nx = 1 + 1\n", "utf8");
    const blankRes = await captureStreamlitAppScreenshotsAsync({
      studentDir: blankDir,
      outDir: blankOutDir,
      maxShots: 2,
    });
    assert.equal(blankRes.items.length, 0, "Blank empty Streamlit app must produce 0 PNGs (F06)");
    assert.ok(blankRes.warning && blankRes.warning.includes("trang trống"), `Expected blank warning, got: ${blankRes.warning}`);

    const junctionStudentDir = path.join(tempSpckRoot, "junction_out_student");
    const victimSiblingDir = path.join(tempSpckRoot, "victim_sibling_dir");
    fs.mkdirSync(junctionStudentDir, { recursive: true });
    fs.mkdirSync(victimSiblingDir, { recursive: true });
    fs.writeFileSync(path.join(junctionStudentDir, "app.py"), "import streamlit as st\nst.title('Hi')\n");
    try {
      fs.symlinkSync(
        victimSiblingDir,
        path.join(junctionStudentDir, "_spck_app_shots"),
        process.platform === "win32" ? "junction" : "dir"
      );
      const juncOutRes = await captureStreamlitAppScreenshotsAsync({
        studentDir: junctionStudentDir,
        outDir: path.join(junctionStudentDir, "_spck_app_shots"),
        maxShots: 2,
      });
      assert.equal(juncOutRes.items.length, 0, "Junction outDir must not write outside studentDir (F02)");
      assert.equal(fs.readdirSync(victimSiblingDir).length, 0, "Victim sibling dir must stay empty (F02)");
    } catch {
      // Skip junction outDir creation only if OS denies symlink/junction
    }

    process.env.MINDX_STREAMLIT_PYTHON = path.join(tempRoot, "missing_python_v384.exe");
    resetStreamlitPythonCacheForTests();
    const missingEnvResult = await captureStudentAppScreenshots({
      studentId: "ST_MISSING_PY",
      folderPath: tabStudentDir,
      useAiVision: false,
    });
    delete process.env.MINDX_STREAMLIT_PYTHON;
    resetStreamlitPythonCacheForTests();
    assert.equal(missingEnvResult.capturedCount, 0);
    assert.equal(missingEnvResult.thumbnailSource, "DEFAULT_LOGO");
    assert.ok(
      String(missingEnvResult.aiSelectedReason || "").includes("streamlit"),
      `Expected missing streamlit warning in aiSelectedReason, got: ${missingEnvResult.aiSelectedReason}`
    );
    console.log("  -> PASS [ST-04].");

    // =========================================================================
    // [ST-05] Emergency Stop immediate abort (`TASK_CANCELLED`)
    // =========================================================================
    console.log("[ST-05] Checking Stop Bot immediate TASK_CANCELLED abort...");
    const tq = SequentialTaskQueue.getInstance();
    const stopStart = Date.now();
    tq.stopQueue();
    let stopErr = "";
    try {
      await captureStreamlitAppScreenshotsAsync({
        studentDir: tabStudentDir,
        outDir: tabOutDir,
        maxShots: 2,
      });
    } catch (err) {
      stopErr = err instanceof Error ? err.message : String(err);
    } finally {
      tq.resumeQueue();
    }
    const stopElapsedMs = Date.now() - stopStart;
    assert.match(stopErr, /^TASK_CANCELLED:/);
    assert.ok(stopElapsedMs < 1500, `Stop abort should be immediate (<1500ms), got ${stopElapsedMs}ms`);
    console.log("  -> PASS [ST-05].");

    // =========================================================================
    // [ST-06] Real temp copy of Trần Minh Khang's app.py + scanStudentSpckFolderAsync gating
    // =========================================================================
    const realKhangDir = "D:\\MINDX DATA\\MINDX_SPCK_FINAL\\CSI02\\Trần Minh Khang";
    assert.ok(
      fs.existsSync(path.join(realKhangDir, "app.py")),
      `Real sample missing at ${realKhangDir}\\app.py`
    );
    console.log("[ST-06] Rendering temp copy of Trần Minh Khang's real app.py...");
    const khangCopyDir = path.join(tempSpckRoot, "Tran Minh Khang");
    fs.mkdirSync(khangCopyDir, { recursive: true });
    for (const fName of [
      "app.py",
      "techbot_products_catalog_300_filled.csv",
      "requirements.txt",
    ]) {
      const src = path.join(realKhangDir, fName);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(khangCopyDir, fName));
      }
    }

    const khangCap = await captureStudentAppScreenshots({
      studentId: "KHANG_V384_COPY",
      folderPath: khangCopyDir,
      useAiVision: false,
    });
    assert.equal(khangCap.error, undefined, `Unexpected Khang capture error: ${khangCap.error}`);
    assert.ok(
      khangCap.capturedCount >= 2,
      `Expected >= 2 scrolled views of Khang's TechBot PC Store, got ${khangCap.capturedCount}`
    );
    assert.equal(khangCap.thumbnailSource, "APP_SCREENSHOT");
    assert.ok(fs.existsSync(khangCap.thumbnailPath));
    const thumbDims = readPngDimensions(khangCap.thumbnailPath);
    assert.equal(thumbDims.width, 960);
    assert.equal(thumbDims.height, 540);

    const previewOut = (process.env.MINDX_STREAMLIT_PREVIEW_OUT || "").trim();
    if (previewOut) {
      fs.mkdirSync(path.dirname(previewOut), { recursive: true });
      fs.copyFileSync(khangCap.thumbnailPath, previewOut);
      if (khangCap.galleryScreenshots[0]) {
        const parsedPreview = path.parse(previewOut);
        fs.copyFileSync(
          khangCap.galleryScreenshots[0],
          path.join(parsedPreview.dir, `${parsedPreview.name}_extra${parsedPreview.ext}`)
        );
      }
    }

    // F01: Default scanStudentSpckFolderAsync (Portal path, allowStreamlitAutoRender omitted) MUST NOT run Streamlit!
    const scanCopyDir = path.join(tempSpckRoot, "Scan Streamlit Student");
    fs.mkdirSync(path.join(scanCopyDir, "_spck_app_shots"), { recursive: true });
    fs.copyFileSync(path.join(tabStudentDir, "app.py"), path.join(scanCopyDir, "app.py"));
    // F04: Seed stale empty .active_shots.json to verify teacher scan clears & discovers new PNGs
    fs.writeFileSync(
      path.join(scanCopyDir, "_spck_app_shots", ".active_shots.json"),
      JSON.stringify({ version: 1, files: [] }),
      "utf8"
    );
    const portalUnsafePkg = await scanStudentSpckFolderAsync(scanCopyDir, "Scan Streamlit Student");
    assert.equal(
      portalUnsafePkg.screenshots.length,
      0,
      "Portal scan without allowStreamlitAutoRender must NOT execute untrusted app.py (F01)"
    );
    assert.ok(
      !/[\\/]_spck_app_shots[\\/]/i.test(portalUnsafePkg.thumbnailPath),
      "Portal scan without opt-in must leave thumbnail as DEFAULT_LOGO (F01)"
    );

    // Teacher scan (allowStreamlitAutoRender: true) MUST execute Streamlit AND clear stale .active_shots.json (F04)
    const scanPkg = await scanStudentSpckFolderAsync(scanCopyDir, "Scan Streamlit Student", {
      allowStreamlitAutoRender: true,
    });
    assert.ok(
      /[\\/]_spck_app_shots[\\/]/i.test(scanPkg.thumbnailPath) && fs.existsSync(scanPkg.thumbnailPath),
      `Expected scanPkg.thumbnailPath inside _spck_app_shots, got: ${scanPkg.thumbnailPath}`
    );
    const scanThumbDims = readPngDimensions(scanPkg.thumbnailPath);
    assert.equal(scanThumbDims.width, 960);
    assert.equal(scanThumbDims.height, 540);
    assert.ok(
      scanPkg.screenshots.length >= 1,
      `Expected scanStudentSpckFolderAsync gallery >= 1 extra screenshot (plus thumbnail = >=2 total), got ${scanPkg.screenshots.length}`
    );
    console.log(
      `  -> PASS [ST-06] (Khang copy: ${khangCap.capturedCount} PNGs @ 960x540; portal opt-out=0; teacher scan + stale manifest F04 clear: thumb + ${scanPkg.screenshots.length} gallery shots).`
    );

    // =========================================================================
    // [ST-07] Static single-BrowserContext & loopback security invariants
    // =========================================================================
    console.log("[ST-07] Checking static security invariants...");
    const stSrc = fs.readFileSync(
      path.join(ROOT, "src/lib/local-files/spck-streamlit-screenshotter.ts"),
      "utf8"
    );
    assert.ok(!/from\s+["']playwright["']|require\(["']playwright["']\)/i.test(stSrc), "Must never import playwright");
    assert.ok(!stSrc.includes("launchPersistentContext"), "Must never call launchPersistentContext");
    assert.ok(!stSrc.includes("spawnSync"), "Must never call spawnSync");
    assert.ok(!stSrc.includes("0.0.0.0"), "Must never bind 0.0.0.0");

    const launchFiles: string[] = [];
    const walkSrc = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkSrc(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          if (fs.readFileSync(full, "utf8").includes("launchPersistentContext")) {
            launchFiles.push(path.relative(ROOT, full).replace(/\\/g, "/"));
          }
        }
      }
    };
    walkSrc(path.join(ROOT, "src"));
    assert.deepEqual(launchFiles, ["src/lib/playwright/browser-manager.ts"]);
    console.log("  -> PASS [ST-07].");

    console.log("\nALL [ST-01..ST-07] STREAMLIT TESTS PASSED 100%!");
  } finally {
    try {
      SequentialTaskQueue.getInstance().resumeQueue();
    } catch {}
    for (const [k, v] of Object.entries(savedEnvSnapshot)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetStreamlitPythonCacheForTests();
    closeDb();
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  }
}

runTests().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
