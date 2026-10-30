import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const absProdDb = path.resolve(root, "data/mindx_bot.db");
const absProdRunningClasses = path.resolve(root, "data/running_classes.json");

function sha256File(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function formatDdMmYyyy(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

async function runTests() {
  console.log("=== [v3.4.0-S2] UNIFIED CLASS DIRECTORY & SHARED CLASSPICKER SUITE ===");

  const prodDbBefore = sha256File(absProdDb);
  const prodRunningBefore = sha256File(absProdRunningClasses);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-v340-s2-"));
  const tempDbPath = path.join(tempDir, "mindx_bot_s2.db");
  const tempRunningClassesPath = path.join(tempDir, "running_classes.json");

  process.env.MINDX_DB_PATH = tempDbPath;
  process.env.MINDX_RUNNING_CLASSES_PATH = tempRunningClassesPath;
  process.env.ALLOWED_LOCAL_DIRS = `${tempDir},${root}`;

  const { closeDb, classSessionRepo, studentRepo } = await import(
    "../src/lib/db/sqlite"
  );
  const {
    SYNTHETIC_CLASS_REGEX,
    isSyntheticClassCode,
    listClasses,
    listStudents,
  } = await import("../src/lib/classes/class-directory");
  const { ClassSyncer } = await import("../src/lib/playwright/sync-class");
  const { taskQueue } = await import("../src/lib/queue/task-queue");
  const {
    LAST_SELECTED_CLASS_STORAGE_KEY,
    normalizeClassOption,
    readSavedClassCode,
    resolvePreferredClassCode,
    writeSavedClassCode,
  } = await import("../src/components/class-picker");

  try {
    // -------------------------------------------------------------------------
    // 1. Seed isolated SQLite DB & running_classes.json with real + synthetic + grace-window classes
    // -------------------------------------------------------------------------
    console.log("-> [S2.1] Seeding isolated DB & running_classes.json...");
    const now = new Date();
    const date14DaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const date16DaysAgo = new Date(now.getTime() - 16 * 24 * 60 * 60 * 1000);
    const dateStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const runningConfig = [
      {
        classCode: "VT-C4K-RUN08",
        courseName: "Scratch Basic",
        status: "Running",
        startDate: formatDdMmYyyy(dateStart),
        endDate: formatDdMmYyyy(now),
      },
      {
        classCode: "VT-C4K-SPCK13",
        courseName: "GameMaker Advanced",
        status: "Running",
        startDate: formatDdMmYyyy(dateStart),
        endDate: formatDdMmYyyy(now),
      },
      {
        classCode: "VT-C4K-FIN14D",
        courseName: "Python Basic",
        status: "Finished",
        startDate: formatDdMmYyyy(dateStart),
        endDate: formatDdMmYyyy(date14DaysAgo),
      },
      {
        classCode: "VT-C4K-FIN16D",
        courseName: "Python Expired",
        status: "Finished",
        startDate: formatDdMmYyyy(dateStart),
        endDate: formatDdMmYyyy(date16DaysAgo),
      },
      // Synthetic classes that must be filtered out across all scopes
      { classCode: "TEST_SYNTH_01", courseName: "Test", status: "Running" },
      { classCode: "AUDIT_SYNTH_01", courseName: "Audit", status: "Running" },
      { classCode: "R38_SYNTH_01", courseName: "Round 38", status: "Running" },
      { classCode: "CLASS_SYNTH_01", courseName: "Class", status: "Running" },
      { classCode: "SYNTH_01", courseName: "Synth", status: "Running" },
    ];
    fs.writeFileSync(tempRunningClassesPath, JSON.stringify(runningConfig, null, 2), "utf8");

    // Seed sessions:
    // - VT-C4K-RUN08: up to Session 8 (passed yesterday)
    for (let s = 1; s <= 8; s++) {
      classSessionRepo.upsert({
        sessionId: `RUN08_S${s}`,
        classId: "VT-C4K-RUN08",
        className: "Scratch Basic",
        sessionNumber: s,
        date: formatDdMmYyyy(date14DaysAgo),
        topic: `Lesson ${s}`,
      });
    }
    // - VT-C4K-SPCK13: up to Session 13 (passed yesterday)
    for (let s = 1; s <= 13; s++) {
      classSessionRepo.upsert({
        sessionId: `SPCK13_S${s}`,
        classId: "VT-C4K-SPCK13",
        className: "GameMaker Advanced",
        sessionNumber: s,
        date: formatDdMmYyyy(date14DaysAgo),
        topic: `Lesson ${s}`,
      });
    }
    // - VT-C4K-FIN14D: Session 14 ended 14 days ago (within 15-day grace window)
    for (let s = 1; s <= 14; s++) {
      classSessionRepo.upsert({
        sessionId: `FIN14D_S${s}`,
        classId: "VT-C4K-FIN14D",
        className: "Python Basic",
        sessionNumber: s,
        date: formatDdMmYyyy(date14DaysAgo),
        topic: `Lesson ${s}`,
      });
    }
    // - VT-C4K-FIN16D: Session 14 ended 16 days ago (outside 15-day grace window)
    for (let s = 1; s <= 14; s++) {
      classSessionRepo.upsert({
        sessionId: `FIN16D_S${s}`,
        classId: "VT-C4K-FIN16D",
        className: "Python Expired",
        sessionNumber: s,
        date: formatDdMmYyyy(date16DaysAgo),
        topic: `Lesson ${s}`,
      });
    }
    // - Synthetic classes in DB as well
    for (const synthCode of [
      "TEST_SYNTH_01",
      "AUDIT_SYNTH_01",
      "R38_SYNTH_01",
      "CLASS_SYNTH_01",
      "SYNTH_01",
    ]) {
      classSessionRepo.upsert({
        sessionId: `${synthCode}_S13`,
        classId: synthCode,
        className: synthCode,
        sessionNumber: 13,
        date: formatDdMmYyyy(date14DaysAgo),
        topic: "Synth Lesson",
      });
    }

    // Seed students (active + inactive) for VT-C4K-SPCK13 and VT-C4K-RUN08
    studentRepo.upsert({
      studentId: "ST_ACTIVE_1",
      classId: "VT-C4K-SPCK13",
      fullName: "Nguyễn Văn An",
      isActive: 1,
    });
    studentRepo.upsert({
      studentId: "ST_INACTIVE_2",
      classId: "VT-C4K-SPCK13",
      fullName: "Trần Thị Bình",
      isActive: 0,
    });
    studentRepo.upsert({
      studentId: "ST_RUN08_1",
      classId: "VT-C4K-RUN08",
      fullName: "Lê Hoàng Cường",
      isActive: 1,
    });

    // Verify SYNTHETIC_CLASS_REGEX
    for (const code of [
      "TEST_01",
      "AUDIT_R38",
      "R12_CLASS",
      "CLASS_A",
      "SYNTH_99",
    ]) {
      assert.equal(
        SYNTHETIC_CLASS_REGEX.test(code),
        true,
        `SYNTHETIC_CLASS_REGEX must match ${code}`
      );
      assert.equal(isSyntheticClassCode(code), true);
    }
    assert.equal(isSyntheticClassCode("VT-C4K-SPCK13"), false);

    // Verify listClasses across scopes
    const runningScope = listClasses({ scope: "running" }).map((c) => c.classCode).sort();
    const spckScope = listClasses({ scope: "spck" }).map((c) => c.classCode).sort();
    const allScope = listClasses({ scope: "all" }).map((c) => c.classCode).sort();

    assert.deepEqual(
      runningScope,
      ["VT-C4K-FIN14D", "VT-C4K-RUN08", "VT-C4K-SPCK13"],
      "running scope must include Running classes + Finished <= 15d, and exclude > 15d + synthetic"
    );
    assert.deepEqual(
      spckScope,
      ["VT-C4K-FIN14D", "VT-C4K-SPCK13"],
      "spck scope must include only session >= 12 classes within 15d grace window, excluding session 8, > 15d, and synthetic"
    );
    assert.deepEqual(
      allScope,
      ["VT-C4K-FIN14D", "VT-C4K-FIN16D", "VT-C4K-RUN08", "VT-C4K-SPCK13"],
      "all scope must include expired finished classes while still excluding synthetic classes"
    );

    // Verify listStudents activeOnly filtering
    const activeOnlyStudents = listStudents("VT-C4K-SPCK13", { activeOnly: true });
    const allStudents = listStudents("VT-C4K-SPCK13", { activeOnly: false });
    assert.equal(activeOnlyStudents.length, 1);
    assert.equal(activeOnlyStudents[0].studentId, "ST_ACTIVE_1");
    assert.equal(allStudents.length, 2);
    console.log("   [PASS] S2.1 class-directory scopes, 15d grace, synthetic regex, and listStudents verified.");

    // -------------------------------------------------------------------------
    // 2. Verify all 6 routes return the unified class list for their scope (S2.2)
    // -------------------------------------------------------------------------
    console.log("-> [S2.2] Verifying all 6 routes return identical scope-filtered class sets...");
    const scListRoute = await import("../src/app/api/session-comments/list/route");
    const scFetchRoute = await import("../src/app/api/session-comments/fetch-classes/route");
    const rcRoute = await import("../src/app/api/report-card/route");
    const tpRoute = await import("../src/app/api/teaching-projects/route");
    const hwScoresRoute = await import("../src/app/api/homework-grader/scores/route");
    const spckListRoute = await import("../src/app/api/spck/list/route");

    const localHeaders = { host: "127.0.0.1:3000" };

    const scListRes = await scListRoute.GET(
      new Request("http://127.0.0.1:3000/api/session-comments/list?classId=VT-C4K-SPCK13", {
        headers: localHeaders,
      })
    );
    const scListJson = await scListRes.json();
    const scListCodes = (scListJson.data?.runningClasses || [])
      .map((c: any) => c.classCode)
      .sort();

    const scFetchRes = await scFetchRoute.GET(
      new Request("http://127.0.0.1:3000/api/session-comments/fetch-classes", {
        headers: localHeaders,
      })
    );
    const scFetchJson = await scFetchRes.json();
    const scFetchCodes = (scFetchJson.classes || [])
      .map((c: any) => c.classCode)
      .sort();

    const rcRes = await rcRoute.GET(
      new Request("http://127.0.0.1:3000/api/report-card?classId=VT-C4K-SPCK13", {
        headers: localHeaders,
      }) as any
    );
    const rcJson = await rcRes.json();
    const rcCodes = (rcJson.classes || [])
      .map((c: any) => c.classCode)
      .sort();

    const tpRes = await tpRoute.GET(
      new Request("http://127.0.0.1:3000/api/teaching-projects", {
        headers: localHeaders,
      }) as any
    );
    const tpJson = await tpRes.json();
    const tpCodes = (tpJson.classes || [])
      .map((c: any) => c.classCode)
      .sort();

    const hwRes = await hwScoresRoute.GET(
      new Request("http://127.0.0.1:3000/api/homework-grader/scores?classId=VT-C4K-SPCK13", {
        headers: localHeaders,
      })
    );
    const hwJson = await hwRes.json();
    const hwCodes = (hwJson.data?.runningClasses || []).slice().sort();

    const spckRes = await spckListRoute.GET(
      new Request("http://127.0.0.1:3000/api/spck/list", {
        headers: localHeaders,
      })
    );
    const spckJson = await spckRes.json();
    const spckCodes = (spckJson.classes || [])
      .map((c: any) => c.classId)
      .sort();

    const expectedRunning = ["VT-C4K-FIN14D", "VT-C4K-RUN08", "VT-C4K-SPCK13"];
    const expectedSpck = ["VT-C4K-FIN14D", "VT-C4K-SPCK13"];

    assert.deepEqual(scListCodes, expectedRunning, "session-comments/list must match runningScope");
    assert.deepEqual(scFetchCodes, expectedRunning, "session-comments/fetch-classes must match runningScope");
    assert.deepEqual(rcCodes, expectedRunning, "report-card must match runningScope");
    assert.deepEqual(tpCodes, expectedRunning, "teaching-projects must match runningScope");
    assert.deepEqual(hwCodes, expectedRunning, "homework-grader/scores must match runningScope");
    assert.deepEqual(spckCodes, expectedSpck, "spck/list must match spckScope");
    console.log("   [PASS] S2.2 all 6 routes return consistent scope-filtered class lists.");

    // -------------------------------------------------------------------------
    // 3. Verify POST /api/classes/refresh single-task queueing & stop handling (S2.3)
    // -------------------------------------------------------------------------
    console.log("-> [S2.3] Verifying POST /api/classes/refresh single-task queueing & security...");
    const refreshRoute = await import("../src/app/api/classes/refresh/route");

    // 3a. Cross-site request blocked with 403
    const crossSiteRes = await refreshRoute.POST(
      new Request("http://127.0.0.1:3000/api/classes/refresh", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "https://evil.example.com",
          "sec-fetch-site": "cross-site",
          "content-type": "application/json",
        },
        body: JSON.stringify({ scope: "running" }),
      })
    );
    assert.equal(crossSiteRes.status, 403, "Cross-site POST /api/classes/refresh must return 403");

    // 3b. Conflicting classId vs classCode or invalid scope returns 400
    const badScopeRes = await refreshRoute.POST(
      new Request("http://127.0.0.1:3000/api/classes/refresh", {
        method: "POST",
        headers: { ...localHeaders, "content-type": "application/json" },
        body: JSON.stringify({ scope: "invalid_scope" }),
      })
    );
    assert.equal(badScopeRes.status, 400, "Invalid scope must return 400");

    const conflictRes = await refreshRoute.POST(
      new Request("http://127.0.0.1:3000/api/classes/refresh", {
        method: "POST",
        headers: { ...localHeaders, "content-type": "application/json" },
        body: JSON.stringify({ classId: "VT-C4K-RUN08", classCode: "VT-C4K-SPCK13" }),
      })
    );
    assert.equal(conflictRes.status, 400, "Conflicting classId and classCode must return 400");

    // 3c. Single queued task executes both fetchRunningClasses + syncClass(classCode)
    const origEnqueue = taskQueue.enqueue.bind(taskQueue);
    const origFetchRunning = ClassSyncer.fetchRunningClasses.bind(ClassSyncer);
    const origSyncClass = ClassSyncer.syncClass.bind(ClassSyncer);

    let enqueueCount = 0;
    const callOrder: string[] = [];

    (taskQueue as any).enqueue = async (task: any) => {
      enqueueCount++;
      return origEnqueue(task);
    };
    (ClassSyncer as any).fetchRunningClasses = async () => {
      callOrder.push("fetchRunningClasses");
      return { success: true, classes: runningConfig.slice(0, 3) };
    };
    (ClassSyncer as any).syncClass = async (code: string) => {
      callOrder.push(`syncClass:${code}`);
      return {
        success: true,
        classId: code,
        sessions: [{ sessionId: `${code}_S1`, sessionNumber: 1 }],
        students: [{ studentId: "S1", fullName: "An" }],
      };
    };

    try {
      taskQueue.resumeQueue();
      const okRes = await refreshRoute.POST(
        new Request("http://127.0.0.1:3000/api/classes/refresh", {
          method: "POST",
          headers: { ...localHeaders, "content-type": "application/json" },
          body: JSON.stringify({ scope: "running", classCode: "VT-C4K-SPCK13" }),
        })
      );
      assert.equal(okRes.status, 200);
      const okJson = await okRes.json();
      assert.equal(okJson.success, true);
      assert.equal(enqueueCount, 1, "POST /api/classes/refresh must enqueue exactly 1 task");
      assert.deepEqual(callOrder, ["fetchRunningClasses", "syncClass:VT-C4K-SPCK13"]);
      assert.equal(okJson.syncedClassCode, "VT-C4K-SPCK13");
      assert.deepEqual(
        okJson.classes.map((c: any) => c.classCode).sort(),
        expectedRunning
      );

      // 3d. Stop during fetchRunningClasses aborts before syncClass runs (HTTP 499)
      callOrder.length = 0;
      (ClassSyncer as any).fetchRunningClasses = async () => {
        callOrder.push("fetchRunningClasses_then_stop");
        taskQueue.stopQueue();
        return { success: true, classes: runningConfig.slice(0, 3) };
      };
      const stopRes = await refreshRoute.POST(
        new Request("http://127.0.0.1:3000/api/classes/refresh", {
          method: "POST",
          headers: { ...localHeaders, "content-type": "application/json" },
          body: JSON.stringify({ scope: "running", classCode: "VT-C4K-SPCK13" }),
        })
      );
      assert.equal(stopRes.status, 499, "Stopped queue during refresh must return HTTP 499");
      assert.deepEqual(
        callOrder,
        ["fetchRunningClasses_then_stop"],
        "syncClass must not execute after stopQueue()"
      );
    } finally {
      taskQueue.resumeQueue();
      (taskQueue as any).enqueue = origEnqueue;
      (ClassSyncer as any).fetchRunningClasses = origFetchRunning;
      (ClassSyncer as any).syncClass = origSyncClass;
    }
    console.log("   [PASS] S2.3 POST /api/classes/refresh single-task queueing & stop abort verified.");

    // -------------------------------------------------------------------------
    // 4. Verify ClassPicker localStorage sync, SPCK fallback, and 4-screen wiring (S2.4 & S2.5)
    // -------------------------------------------------------------------------
    console.log("-> [S2.4 & S2.5] Verifying ClassPicker helpers, localStorage fallback & 4-screen integration...");
    const mockStorage = new Map<string, string>();
    const prevWindow = (globalThis as any).window;
    (globalThis as any).window = {
      localStorage: {
        getItem: (k: string) => mockStorage.get(k) ?? null,
        setItem: (k: string, v: string) => mockStorage.set(k, v),
      },
    };
    try {
      writeSavedClassCode("vt-c4k-run08");
      assert.equal(
        mockStorage.get(LAST_SELECTED_CLASS_STORAGE_KEY),
        "VT-C4K-RUN08"
      );
      assert.equal(readSavedClassCode(), "VT-C4K-RUN08");

      // In running scope, VT-C4K-RUN08 is valid so resolvePreferredClassCode restores it
      const runningList = listClasses({ scope: "running" });
      assert.equal(
        resolvePreferredClassCode(runningList),
        "VT-C4K-RUN08",
        "Running scope must restore saved VT-C4K-RUN08"
      );

      // In spck scope, VT-C4K-RUN08 (Session 8 < 12) is NOT in spckList, so it falls back to first eligible SPCK class
      const spckList = listClasses({ scope: "spck" });
      const resolvedForSpck = resolvePreferredClassCode(spckList);
      assert.equal(
        resolvedForSpck,
        spckList[0].classCode,
        "SPCK scope must fall back to first eligible >=12 class when saved class is session < 12"
      );

      // When saved class IS an SPCK class (VT-C4K-SPCK13), SPCK scope restores it
      writeSavedClassCode("VT-C4K-SPCK13");
      assert.equal(
        resolvePreferredClassCode(spckList),
        "VT-C4K-SPCK13",
        "SPCK scope must restore saved class when it is eligible (session >= 12)"
      );
      assert.equal(normalizeClassOption("vt-c4k-sb21").code, "VT-C4K-SB21");
    } finally {
      (globalThis as any).window = prevWindow;
    }

    // Verify client security & ClassPicker wiring across all 4 screens
    const pickerSrc = fs.readFileSync(
      path.resolve(root, "src/components/class-picker.tsx"),
      "utf8"
    );
    assert.ok(pickerSrc.startsWith('"use client";'));
    for (const secret of ["TEACHING_PASSWORD", "LMS_PASSWORD", "GEMINI_API_KEY"]) {
      assert.ok(!pickerSrc.includes(secret), `class-picker.tsx must not reference ${secret}`);
    }

    for (const relScreen of [
      "src/app/session-comments/page.tsx",
      "src/app/homework-grader/page.tsx",
      "src/app/final-project/page.tsx",
      "src/app/teaching-projects/page.tsx",
    ]) {
      const screenSrc = fs.readFileSync(path.resolve(root, relScreen), "utf8");
      assert.ok(
        screenSrc.includes("<ClassPicker"),
        `${relScreen} must render <ClassPicker />`
      );
    }

    const rcViewSrc = fs.readFileSync(
      path.resolve(root, "src/components/teaching-report-card-view.tsx"),
      "utf8"
    );
    assert.ok(
      !rcViewSrc.includes("Lớp đang dạy:"),
      "teaching-report-card-view.tsx must not render duplicate 'Lớp đang dạy:' pills"
    );
    console.log("   [PASS] S2.4 & S2.5 ClassPicker behavior and 4-screen integration verified.");

    // -------------------------------------------------------------------------
    // 5. Verify Codex Round 1 Regressions (S2-01..S2-05)
    // -------------------------------------------------------------------------
    console.log("-> [S2-R1 REGRESSIONS] Verifying closure of S2-01..S2-05...");

    // S2-02: SPCK eligible class sync failure in POST /api/classes/refresh must return HTTP 500 & success:false
    {
      (ClassSyncer as any).fetchRunningClasses = async () => ({
        success: true,
        classes: runningConfig.slice(0, 3),
      });
      (ClassSyncer as any).syncClass = async () => ({
        success: false,
        error: "fixture upstream HTTP 503",
      });
      try {
        taskQueue.resumeQueue();
        const failSpckRes = await refreshRoute.POST(
          new Request("http://127.0.0.1:3000/api/classes/refresh", {
            method: "POST",
            headers: { ...localHeaders, "content-type": "application/json" },
            body: JSON.stringify({ scope: "spck", forceResyncAll: true }),
          })
        );
        assert.equal(
          failSpckRes.status,
          500,
          "S2-02: Failed SPCK eligible sync must return HTTP 500"
        );
        const failSpckJson = await failSpckRes.json();
        assert.equal(
          failSpckJson.success,
          false,
          "S2-02: Failed SPCK eligible sync must return success:false"
        );
        assert.ok(
          String(failSpckJson.error || "").includes("fixture upstream HTTP 503"),
          "S2-02: Error message must surface failed SPCK class reason"
        );
        assert.ok(
          Array.isArray(failSpckJson.failedClassCodes) &&
            failSpckJson.failedClassCodes.length > 0,
          "S2-02: failedClassCodes must list the failed SPCK classes"
        );
      } finally {
        (ClassSyncer as any).fetchRunningClasses = origFetchRunning;
        (ClassSyncer as any).syncClass = origSyncClass;
      }
    }

    // S2-01: FinalProjectPage out-of-order restore/switch race guard (single restore coordinator + loadClassRequestSeq)
    {
      const vm = await import("node:vm");
      const { stripTypeScriptTypes } = await import("node:module");
      const fpSrc = fs.readFileSync(
        path.resolve(root, "src/app/final-project/page.tsx"),
        "utf8"
      );
      assert.ok(
        fpSrc.includes("autoRestore={false}"),
        "S2-01: FinalProjectPage must pass autoRestore={false} to ClassPicker so only loadClassData coordinates restore"
      );
      const cutIdx = fpSrc.indexOf('\n  return (\n    <div className="space-y-6">');
      assert.ok(cutIdx > 0);
      const cleaned = fpSrc
        .slice(0, cutIdx)
        .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
        .replace(/\bexport\s+default\s+/g, "")
        .replace(/\bexport\s+/g, "");
      const states: any[] = [[], "", [], "", []];
      let stateIdx = 0;
      let releaseSlowB!: () => void;
      const slowBGate = new Promise<void>((r) => {
        releaseSlowB = r;
      });
      const requests: string[] = [];

      const ctx = vm.createContext({
        console,
        URLSearchParams,
        window: {
          localStorage: {
            getItem: (k: string) =>
              k === "mindx_last_class_code" ? "VT-C4K-BETA" : null,
            setItem: () => {},
          },
        },
        fetch: async (url: string) => {
          requests.push(url);
          const u = new URL(url, "http://127.0.0.1:3000");
          const code = u.searchParams.get("classId") || "VT-C4K-ALPHA";
          if (code === "VT-C4K-BETA") {
            await slowBGate;
          }
          const stId = code === "VT-C4K-BETA" ? "STUDENT_B" : "STUDENT_A";
          return {
            json: async () => ({
              success: true,
              classes: [
                { classId: "VT-C4K-ALPHA", className: "Alpha", currentSessionNumber: 13 },
                { classId: "VT-C4K-BETA", className: "Beta", currentSessionNumber: 13 },
              ],
              selectedClassId: code,
              selectedSessionNumber: 13,
              students: [{ studentId: stId, fullName: stId, classId: code, isActive: 1 }],
              records: [
                {
                  classId: code,
                  studentId: stId,
                  localFolderPath: `C:/fixture/${stId}`,
                  projectTitle: `PROJECT_${stId}`,
                  isConfirmedByTeacher: 1,
                  status: "DRAFT",
                  activeSessionNumber: 13,
                },
              ],
              quickTags: [],
            }),
          };
        },
        useState: (init: any) => {
          const i = stateIdx++;
          if (!(i in states)) states[i] = typeof init === "function" ? init() : init;
          return [
            states[i],
            (v: any) => {
              states[i] = typeof v === "function" ? v(states[i]) : v;
            },
          ];
        },
        useCallback: (f: any) => f,
        useEffect: () => {},
        useMemo: (f: any) => f(),
      });

      vm.runInContext(
        stripTypeScriptTypes(
          `${cleaned}\nreturn { loadClassData, handleClassChange };\n}\nglobalThis.fpApi = FinalProjectPage();`,
          { mode: "transform" } as any
        ),
        ctx
      );

      // Start initial mount loadClassData() which discovers saved class VT-C4K-BETA and waits on slowBGate
      const mountLoadPromise = ctx.fpApi.loadClassData();
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(
        states[1],
        "VT-C4K-BETA",
        "S2-01: Initial restore must set selectedClassId to VT-C4K-BETA before awaiting B response"
      );

      // Teacher switches to VT-C4K-ALPHA while VT-C4K-BETA is still in flight
      await ctx.fpApi.handleClassChange("VT-C4K-ALPHA");
      assert.equal(states[1], "VT-C4K-ALPHA");
      assert.equal(states[2][0]?.studentId, "STUDENT_A");
      assert.equal(states[4][0]?.assignedStudentId, "STUDENT_A");

      // Now release stale VT-C4K-BETA response — it must NOT overwrite VT-C4K-ALPHA students or rows!
      releaseSlowB();
      await mountLoadPromise;
      assert.equal(
        states[1],
        "VT-C4K-ALPHA",
        "S2-01: selectedClassId must remain VT-C4K-ALPHA after stale B resolves"
      );
      assert.equal(
        states[2][0]?.studentId,
        "STUDENT_A",
        "S2-01: students must remain STUDENT_A after stale B resolves"
      );
      assert.equal(
        states[4][0]?.assignedStudentId,
        "STUDENT_A",
        "S2-01: rows must remain STUDENT_A after stale B resolves"
      );
    }

    // S2-03, S2-04 & S2-05: Verify error surfacing, busy manual-commit guard, and empty refresh list handling
    {
      assert.ok(
        pickerSrc.includes("if (effectiveBusy) return;") &&
          pickerSrc.includes('role="alert"') &&
          pickerSrc.includes("onRefreshError"),
        "S2-03 & S2-04: ClassPicker must guard manual commit when busy and render visible refreshError alert"
      );
      const scPageSrc = fs.readFileSync(
        path.resolve(root, "src/app/session-comments/page.tsx"),
        "utf8"
      );
      const hwPageSrc = fs.readFileSync(
        path.resolve(root, "src/app/homework-grader/page.tsx"),
        "utf8"
      );
      const tpPageSrc = fs.readFileSync(
        path.resolve(root, "src/app/teaching-projects/page.tsx"),
        "utf8"
      );
      assert.ok(
        scPageSrc.includes("res.ok !== false && data.success && Array.isArray(data.classes)"),
        "S2-05: session-comments/page.tsx must accept empty classes array on successful refresh"
      );
      assert.ok(
        hwPageSrc.includes("res.ok !== false && json.success && Array.isArray(rawList)") &&
          hwPageSrc.includes("Không lấy được danh sách lớp từ LMS:"),
        "S2-03 & S2-05: homework-grader/page.tsx must clear stale classes on empty refresh and surface refresh errors"
      );
      assert.ok(
        tpPageSrc.includes("onRefreshError="),
        "S2-03: teaching-projects/page.tsx must wire onRefreshError to banner"
      );
    }
    console.log("   [PASS] S2-R1 REGRESSIONS (S2-01..S2-05) verified 100%.");
  } finally {
    closeDb();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }

  const prodDbAfter = sha256File(absProdDb);
  const prodRunningAfter = sha256File(absProdRunningClasses);
  assert.equal(
    prodDbAfter,
    prodDbBefore,
    "Production data/mindx_bot.db must remain 100% untouched"
  );
  assert.equal(
    prodRunningAfter,
    prodRunningBefore,
    "Production data/running_classes.json must remain 100% untouched"
  );

  console.log("=== [v3.4.0-S2] ALL STAGE S2 TESTS PASSED 100% ===");
}

runTests().catch((err) => {
  console.error("❌ [v3.4.0-S2] TEST FAILED:", err);
  process.exit(1);
});
