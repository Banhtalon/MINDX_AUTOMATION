/** Independent Stage 3 probe. Run only with disposable paths beneath TEMP. No live LMS/Teaching calls. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function main() {
  for (const key of ["MINDX_DB_PATH", "MINDX_RUNNING_CLASSES_PATH"]) {
    const value = process.env[key];
    assert(value && path.resolve(value).toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase() + path.sep));
  }
  const db = await import("../../../../src/lib/db/sqlite");
  const sync = await import("../../../../src/lib/playwright/teaching-report-card-sync");
  const calc = await import("../../../../src/lib/report-card/report-card-calculator");
  const api = await import("../../../../src/app/api/report-card/route");
  const syncApi = await import("../../../../src/app/api/report-card/sync-teaching/route");
  const { NextRequest } = await import("next/server");
  const { taskQueue } = await import("../../../../src/lib/queue/task-queue");
  const { config } = await import("../../../../src/lib/config");
  if (!config.allowedLocalDirs.includes(os.tmpdir())) {
    config.allowedLocalDirs.push(os.tmpdir());
  }
  const { assertPathAllowed } = await import("../../../../src/lib/security/path-allowlist");
  const observations: Array<{ id: string; result: string; details: unknown }> = [];
  const observe = (id: string, result: string, details: unknown) => {
    observations.push({ id, result, details });
    console.log(JSON.stringify({ id, result, details }));
  };
  const originalFetch = globalThis.fetch;
  // Unexpected network access is always a failing probe, never a live write.
  globalThis.fetch = async () => { throw new Error("AUDIT: unexpected network access"); };
  let counter = 0;
  const makeSnapshot = (robotics = false): any => {
    const classId = `AUDIT-${robotics ? "ROB" : "CODE"}-${++counter}`;
    return {
      classId, classCode: classId, isRobotics: robotics, scrapedAt: "2026-10-29T00:00:00Z",
      btvnSessions: robotics ? [] : [{ sessionNumber: 1, title: "Buổi 1", hasTheory: true, hasPractice: true, maxTheoryScore: 100, maxPracticeScore: 100 }],
      students: [{ studentId: "LMS_01", fullName: "Nguyễn Văn An", isActive: true,
        btvnScores: { 1: { sessionNumber: 1, theoryRaw: 80, theoryMax: 100, practiceRaw: null, practiceMax: 100 } },
        stageScores: { cp1Theory: 4, cp1Practice: 4, cp1Competency: 4, cp2Theory: 4, cp2Practice: 4, cp2Competency: 4, finalProduct: 4, finalCompetency: 4 },
      }],
    };
  };
  const approve = (snapshot: any) => {
    const record = db.reportCardRepo.saveLmsSnapshot(snapshot.classId, snapshot);
    const result = db.reportCardRepo.approveReportCard(snapshot.classId, record.draftVersion);
    assert.equal(result.success, true);
    return result.record;
  };
  const makeTransport = (snapshot: any, options: any = {}): any => {
    const exercises: any[] = [];
    const saved: any[] = [];
    const declared: any[] = [];
    return {
      exercises, saved, declared,
      async getStudents() { return options.students ?? snapshot.students.map((s: any, i: number) => ({ id: 101 + i, student_name: s.fullName, class_code: snapshot.classId, status: "active" })); },
      async getExercises() { if (options.onExercises) await options.onExercises(); return exercises; },
      async addMultiExercise(payload: any) {
        declared.push(payload);
        for (const sn of payload.sessions) for (const form of payload.exerciseForms) {
          if (!exercises.some((x) => x.session_number === sn && x.exercise_type === payload.exerciseType && x.exercise_form === form))
            exercises.push({ id: exercises.length + 1, class_code: snapshot.classId, session_number: sn, exercise_type: payload.exerciseType, exercise_form: form, max_score: form === "nang_luc" ? payload.maxScoreNangLuc : payload.maxScore });
        }
        return { success: true };
      },
      async saveScores(scores: any[]) { saved.push(...scores); if (options.onSave) await options.onSave(scores); return { success: true }; },
      async getScores() {
        const rows = saved.map((x) => ({ ...x, normalized_score: calc.round2(x.raw_score / x.max_score * 5) }));
        return options.readback ? options.readback(rows) : rows;
      },
    };
  };
  const runSync = async (snapshot: any, options: any = {}, omitVersion = false) => {
    const record = approve(snapshot);
    const transport = makeTransport(snapshot, options);
    const result = await sync.TeachingReportCardSyncService.syncReportCardToTeaching(snapshot.classId, {
      transport, ...(omitVersion ? {} : { expectedVersion: record.draftVersion }),
    });
    return { record, result, transport };
  };
  const request = (method: string, body?: any, url = "http://127.0.0.1:3000/api/report-card", headers: any = {}) => new NextRequest(url, {
    method, headers: { host: "127.0.0.1:3000", "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  try {
    // Positive and negative controls against actual exported functions and actual SQLite.
    for (const value of ["", " ", true, false, [], [0], {}, NaN, Infinity, -Infinity, "NaN", "Infinity", null, undefined])
      assert.equal(sync.parseStrictFiniteScore(value), null);
    assert.equal(sync.parseStrictFiniteScore("0"), 0);
    assert.equal(sync.parseStrictFiniteScore(" 4.25 "), 4.25);
    observe("CONTROL-parser", "PASS", "Invalid numeric inputs rejected; zero and numeric strings retained");

    const matchingSnapshot = makeSnapshot();
    const local = calc.computeClassReportCard(matchingSnapshot, {}).students;
    const remoteStudent = (id: number, student_name: string, status = "active", class_code = matchingSnapshot.classId) => ({ id, student_name, status, class_code });
    assert.throws(() => sync.matchReportCardStudentsToTeaching(local, [
      remoteStudent(101, "Nguyễn Văn An"), remoteStudent(102, "Nguyễn Văn An"),
    ], matchingSnapshot.classId), /trùng tên/);
    assert.throws(() => sync.matchReportCardStudentsToTeaching(local, [
      remoteStudent(101, "Nguyễn Văn An", "active", "OTHER"),
    ], matchingSnapshot.classId), /Cross-Class/);
    observe("CONTROL-identity", "PASS", "Ordinary duplicate names and cross-class rows blocked");

    const numericLocal = [{ ...local[0], studentId: "101" }];
    const exactToneMap = sync.matchReportCardStudentsToTeaching(numericLocal, [
      remoteStudent(101, "Nguyễn Văn Ân"),
      remoteStudent(102, "Nguyễn Văn An"),
    ], matchingSnapshot.classId);
    assert.equal(exactToneMap.get("101")?.teachingStudentId, 102);
    observe("S3-01-accent-collision", "PASS", exactToneMap.get("101"));
    assert.throws(() => sync.matchReportCardStudentsToTeaching(numericLocal, [
      remoteStudent(101, "Nguyễn Văn An"), remoteStudent(102, "Nguyễn Văn An"),
    ], matchingSnapshot.classId), /trùng tên/);
    observe("S3-01-duplicate-bypass", "PASS", "Bare numeric LMS ID does not bypass duplicate Teaching name ambiguity");
    const wrongStudentSnapshot = makeSnapshot(); wrongStudentSnapshot.students[0].studentId = "101";
    const wrongStudent = await runSync(wrongStudentSnapshot, { students: [
      { id: 101, student_name: "Nguyễn Văn Ân", status: "active" },
      { id: 102, student_name: "Nguyễn Văn An", status: "active" },
    ] });
    assert.equal(wrongStudent.result.success, true);
    assert(wrongStudent.transport.saved.every((x: any) => x.student_id === 102));
    observe("S3-01-end-to-end", "PASS", "VERIFIED after all scores written to exact match An (#102), never Ân (#101)");

    for (const status of ["inactive", "dropped", "nghỉ học", "nghi_hoc"]) {
      assert.throws(() => sync.matchReportCardStudentsToTeaching(local, [remoteStudent(101, "Nguyễn Văn An", status)], matchingSnapshot.classId), /nghỉ học|inactive/i);
      observe(`S3-02-${status}`, "PASS", { status, excluded: true });
    }
    const asciiFilteredMap = sync.matchReportCardStudentsToTeaching(local, [
      remoteStudent(101, "Nguyễn Văn An", "nghi_hoc"),
      remoteStudent(102, "Nguyễn Văn An"),
    ], matchingSnapshot.classId);
    assert.equal(asciiFilteredMap.get("LMS_01")?.teachingStudentId, 102);
    observe("S3-02-ascii-status", "PASS", "nghi_hoc excluded cleanly and active #102 selected");
    const inactiveStudent = await runSync(makeSnapshot(), { students: [{ id: 101, student_name: "Nguyễn Văn An", status: "inactive" }] });
    assert.equal(inactiveStudent.result.success, false);
    assert.equal(inactiveStudent.result.record?.status, "FAILED");
    assert.equal(inactiveStudent.transport.saved.length, 0);
    observe("S3-02-end-to-end", "PASS", { status: inactiveStudent.result.record?.status, inactiveStudentScoresWritten: inactiveStudent.transport.saved.length });

    for (const norm of [undefined, null, "", "   ", []]) {
      const { result } = await runSync(makeSnapshot(), { readback: (rows: any[]) => rows.map((x) => ({ ...x, normalized_score: norm })) });
      assert.equal(result.success, false);
      assert.equal(result.record?.status, "FAILED");
      observe(`S3-03-normalized-${JSON.stringify(norm) ?? "undefined"}`, "PASS", { success: result.success, status: result.record?.status });
    }
    const nullSnapshot = makeSnapshot();
    const staleNorm = await runSync(nullSnapshot, { readback: (rows: any[]) => [...rows, {
      student_id: 101, class_code: nullSnapshot.classId, session_number: 1, exercise_type: "btvn", exercise_form: "practice", raw_score: null, normalized_score: 5,
    }] });
    assert.equal(staleNorm.result.success, false);
    assert.equal(staleNorm.result.record?.status, "FAILED");
    observe("S3-03-null-slot-normalized", "PASS", { success: staleNorm.result.success, status: staleNorm.result.record?.status });

    for (const kind of ["raw", "normalized", "stale-null"]) {
      const snapshot = makeSnapshot();
      const { result } = await runSync(snapshot, { readback: (rows: any[]) => {
        if (kind === "raw") rows[0].raw_score = 1;
        if (kind === "normalized") rows[0].normalized_score = 1;
        if (kind === "stale-null") rows.push({ student_id: 101, class_code: snapshot.classId, session_number: 1, exercise_type: "btvn", exercise_form: "practice", raw_score: 90 });
        return rows;
      } });
      assert.equal(result.success, false);
      assert.equal(result.record?.status, "FAILED");
      observe(`CONTROL-readback-${kind}`, "PASS", { status: result.record?.status, error: result.error });
    }
    const robotics = await runSync(makeSnapshot(true));
    assert.equal(robotics.result.success, true);
    assert(!robotics.transport.saved.some((x: any) => x.exercise_type === "btvn"));
    assert.deepEqual(robotics.transport.declared.map((x: any) => [x.exerciseType, x.sessions]), [["cp1", [4]], ["cp2", [8]], ["final", [14]]]);
    observe("CONTROL-robotics", "PASS", "CP1=4, CP2=8, final=14; no BTVN declarations or scores");

    const noVersion = await runSync(makeSnapshot(), {}, true);
    assert.equal(noVersion.result.success, false);
    assert.equal(noVersion.result.statusCode, 400);
    observe("S3-05-omitted-service-version", "PASS", { statusCode: noVersion.result.statusCode, status: noVersion.result.record?.status });

    // Atomic hash drift and normal edit exclusion during SAVING are working.
    const driftSnapshot = makeSnapshot();
    let editConflict = false;
    const drift = await runSync(driftSnapshot, { onSave: () => {
      const record = db.reportCardRepo.findOne(driftSnapshot.classId)!;
      editConflict = !!db.reportCardRepo.saveManualOverrides({ classId: driftSnapshot.classId, expectedVersion: record.draftVersion, updates: [{ studentId: "LMS_01", fieldKey: "cp1_theory", normScore: 1 }] }).conflict;
      const changed = structuredClone(driftSnapshot); changed.students[0].stageScores.cp1Theory = 1;
      db.getDb().prepare("UPDATE class_report_cards SET lmsSnapshotJson=? WHERE classId=?").run(JSON.stringify(changed), driftSnapshot.classId);
    } });
    assert(editConflict); assert.equal(drift.result.success, false); assert.equal(drift.result.record?.status, "WAITING_APPROVAL"); assert.equal(drift.result.record?.contentHash, "");
    observe("CONTROL-midflight-content-drift", "PASS", "Normal edits blocked; external SQL score change rejected and approval durably cleared");

    const stateSnapshot = makeSnapshot();
    const state = await runSync(stateSnapshot, { onSave: () => {
      db.getDb().prepare("UPDATE class_report_cards SET status='FAILED', teachingSyncStatus='FAILED' WHERE classId=?").run(stateSnapshot.classId);
    } });
    assert.equal(state.result.success, false);
    assert.equal(state.result.record?.status, "FAILED");
    observe("S3-09-state-transition", "PASS", "Externally changed FAILED state rejected by SAVING/SYNCING ownership predicate");

    const stopSnapshot = makeSnapshot(true);
    const stopped = await runSync(stopSnapshot, { onExercises: () => { taskQueue.stopQueue(); } });
    assert.equal(stopped.result.success, false);
    assert.equal(stopped.transport.declared.length, 0);
    assert.equal(stopped.transport.saved.length, 0);
    assert.equal(stopped.result.record?.status, "FAILED");
    observe("S3-08-stop-side-effects", "PASS", { declarationsAfterStop: stopped.transport.declared.map((x: any) => x.exerciseType), status: stopped.result.record?.status });
    taskQueue.resumeQueue();

    // Queue-local version check: enqueue behind an active task, then mutate before it executes.
    const queuedSnapshot = makeSnapshot(); const queuedRecord = approve(queuedSnapshot);
    let releaseBlock!: () => void;
    const blocker = taskQueue.enqueue({ id: "stage3-blocker", jobType: "CUSTOM", description: "audit queue blocker", execute: () => new Promise<void>((resolve) => { releaseBlock = resolve; }) });
    const queuedTransport = makeTransport(queuedSnapshot);
    const pending = sync.TeachingReportCardSyncService.syncReportCardToTeaching(queuedSnapshot.classId, { expectedVersion: queuedRecord.draftVersion, transport: queuedTransport });
    const edit = db.reportCardRepo.saveManualOverrides({ classId: queuedSnapshot.classId, expectedVersion: queuedRecord.draftVersion, updates: [{ studentId: "LMS_01", fieldKey: "cp1_theory", normScore: 3 }] });
    assert(edit.success); releaseBlock(); await blocker;
    const staleResult = await pending; assert.equal(staleResult.statusCode, 409); assert.equal(queuedTransport.declared.length, 0);
    observe("CONTROL-queued-version", "PASS", "Version checked after earlier queue task completes; stale task rejected before transport writes");

    for (const [method, handler, url] of [
      ["GET", api.GET, "http://127.0.0.1:3000/api/report-card"],
      ["POST", api.POST, "http://127.0.0.1:3000/api/report-card"],
      ["PUT", api.PUT, "http://127.0.0.1:3000/api/report-card"],
      ["POST", syncApi.POST, "http://127.0.0.1:3000/api/report-card/sync-teaching"],
    ] as const) {
      for (const headers of [{ host: "evil.example" }, { origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }]) {
        assert.equal((await handler(request(method, method === "GET" ? undefined : "{", url, headers))).status, 403);
      }
      if (method !== "GET") {
        const response = await handler(request(method, "{", url));
        assert.equal(response.status, 400);
        observe(`S3-06-malformed-${method}-${url.split("/").pop()}`, "PASS", { status: response.status, body: await response.json() });
        assert.equal((await handler(request(method, {}, url))).status, 400);
      }
    }
    observe("CONTROL-route-guards", "PASS", "All 4 handlers reject nonlocal Host, cross-origin and cross-site requests before JSON parse");
    const apiSnapshot = makeSnapshot(); let apiRecord = approve(apiSnapshot);
    for (const value of [undefined, "", "bad", 0, -1, 1.5, true, [], {}]) {
      assert.equal((await api.PUT(request("PUT", { classId: apiSnapshot.classId, expectedVersion: value, updates: [{ studentId: "LMS_01", fieldKey: "cp1_theory", normScore: 4 }] }))).status, 400);
      assert.equal((await syncApi.POST(request("POST", { classId: apiSnapshot.classId, expectedVersion: value }))).status, 400);
    }
    for (const score of [-1, 6, "4", true, []]) {
      assert.equal((await api.PUT(request("PUT", { classId: apiSnapshot.classId, expectedVersion: apiRecord.draftVersion, updates: [{ studentId: "LMS_01", fieldKey: "cp1_theory", normScore: score }] }))).status, 400);
    }
    assert.equal((await api.PUT(request("PUT", { classId: apiSnapshot.classId, expectedVersion: apiRecord.draftVersion + 1, updates: [{ studentId: "LMS_01", fieldKey: "cp1_theory", normScore: 4 }] }))).status, 409);
    assert.equal((await syncApi.POST(request("POST", { classId: apiSnapshot.classId, expectedVersion: apiRecord.draftVersion + 1 }))).status, 409);
    observe("CONTROL-api-validation", "PASS", "Missing/invalid versions, invalid scores and stale version 409 checks pass");
    for (const action of ["set_override", "clear_override", "reset_student_overrides", "reset_all_overrides", "approve"]) {
      const response = await api.PUT(request("PUT", { action, classId: apiSnapshot.classId, expectedVersion: apiRecord.draftVersion, studentId: "LMS_01", fieldKey: "cp1_theory", normScore: 3 }));
      assert.equal(response.status, 200);
      const body = await response.json();
      apiRecord = body.record;
      observe(`S3-07-action-${action}`, "PASS", { status: response.status, version: apiRecord.draftVersion, recordStatus: apiRecord.status });
    }
    const ignoredAction = await api.PUT(request("PUT", { action: "clear_override", classId: apiSnapshot.classId, expectedVersion: apiRecord.draftVersion, updates: [{ studentId: "LMS_01", fieldKey: "cp1_theory", normScore: 2 }] }));
    assert.equal(ignoredAction.status, 400);
    observe("S3-07-action-ignored", "PASS", "clear_override + updates rejected with 400; contradictory/unknown actions rejected");

    // Actual live transport with a fully intercepted fetch (no credentials from .env).
    const oldConfig = { teachingUsername: config.teachingUsername, teachingPassword: config.teachingPassword };
    config.teachingUsername = "AUDIT_USER"; config.teachingPassword = "AUDIT_SECRET_SENTINEL";
    try {
      const liveSnapshot = makeSnapshot(true); const liveRecord = approve(liveSnapshot);
      const fake = makeTransport(liveSnapshot); let exerciseReads = 0; let writesAfterError = 0; const loginStatuses: number[] = [];
      const requests: Array<{ url: string; hasSignal: boolean }> = [];
      let simulate503Login = true;
      globalThis.fetch = async (input: any, init?: any) => {
        const url = new URL(String(input)); requests.push({ url: String(url), hasSignal: !!init?.signal });
        if (url.pathname === "/login.php") {
          const status = simulate503Login ? 503 : 200;
          loginStatuses.push(status);
          return new Response(simulate503Login ? "Maintenance" : "OK", { status, headers: { "set-cookie": "PHPSESSID=AUDIT; Path=/" } });
        }
        if (url.searchParams.has("get_students_of_class")) return Response.json(await fake.getStudents());
        if (url.searchParams.has("get_class_exercises")) {
          if (++exerciseReads === 1) return Response.json({ success: false, message: "Audit read denied" });
          return Response.json(fake.exercises);
        }
        if (url.searchParams.has("get_scores")) return Response.json(await fake.getScores());
        const params = new URLSearchParams(String(init?.body));
        if (params.get("action") === "add_multi_exercise") {
          writesAfterError++;
          return Response.json(await fake.addMultiExercise({ classCode: params.get("class_code"), exerciseType: params.get("exercise_type"), exerciseForms: params.getAll("exercise_form[]"), sessions: params.getAll("sessions[]").map(Number), maxScore: Number(params.get("max_score")), maxScoreNangLuc: Number(params.get("max_score_nang_luc")) }));
        }
        if (params.get("action") === "save_scores") {
          const scores: any[] = [];
          for (let i = 0; params.has(`scores[${i}][student_id]`); i++) {
            const row: any = {};
            for (const key of ["student_id", "class_code", "session_number", "exercise_type", "exercise_form", "raw_score", "max_score", "note"]) {
              const value = params.get(`scores[${i}][${key}]`); row[key] = ["student_id", "session_number", "raw_score", "max_score"].includes(key) ? Number(value) : value;
            }
            scores.push(row);
          }
          return Response.json(await fake.saveScores(scores));
        }
        throw new Error(`AUDIT: unexpected fake URL ${url}`);
      };
      const login503Result = await sync.TeachingReportCardSyncService.syncReportCardToTeaching(liveSnapshot.classId, { expectedVersion: liveRecord.draftVersion, transport: new sync.LiveTeachingReportCardHttpTransport("https://teachingmindx.top") });
      assert.equal(login503Result.success, false); assert.equal(writesAfterError, 0);
      simulate503Login = false;
      const reApprovedLive = db.reportCardRepo.approveReportCard(liveSnapshot.classId, db.reportCardRepo.findOne(liveSnapshot.classId)!.draftVersion);
      assert.equal(reApprovedLive.success, true);
      const liveResult = await sync.TeachingReportCardSyncService.syncReportCardToTeaching(liveSnapshot.classId, { expectedVersion: reApprovedLive.record.draftVersion, transport: new sync.LiveTeachingReportCardHttpTransport("https://teachingmindx.top") });
      assert.equal(liveResult.success, false); assert.equal(writesAfterError, 0); assert(requests.every((x) => x.hasSignal));
      observe("S3-04-live-protocol", "PASS", { loginStatuses, firstExerciseRead: { success: false }, writesAfterError, finalStatus: liveResult.record?.status, requestsHaveAbortSignal: requests.every((x) => x.hasSignal) });

      const stalledSnapshot = makeSnapshot(true); const stalledRecord = approve(stalledSnapshot);
      let enterRead!: () => void; let rejectRead!: (error: Error) => void; let stalledSignal = false;
      const readEntered = new Promise<void>((resolve) => { enterRead = resolve; });
      globalThis.fetch = async (input: any, init?: any) => {
        if (String(input).includes("login.php")) return new Response("", { headers: { "set-cookie": "PHPSESSID=AUDIT; Path=/" } });
        stalledSignal = !!init?.signal; enterRead();
        return await new Promise<Response>((_resolve, reject) => { rejectRead = reject; });
      };
      let syncSettled = false;
      const stalledPromise = sync.TeachingReportCardSyncService.syncReportCardToTeaching(stalledSnapshot.classId, { expectedVersion: stalledRecord.draftVersion, transport: new sync.LiveTeachingReportCardHttpTransport("https://teachingmindx.top") });
      void stalledPromise.then(() => { syncSettled = true; });
      await readEntered; taskQueue.stopQueue();
      const released = await stalledPromise;
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(syncSettled, true); assert.equal(stalledSignal, true);
      const stalled = db.reportCardRepo.findOne(stalledSnapshot.classId)!;
      assert.equal(stalled.status, "FAILED"); assert.equal(taskQueue.getStatus().isRunning, false);
      observe("S3-08-stalled-read-stop", "PASS", { syncSettled, requestHasAbortSignal: stalledSignal, statusAfterStop: stalled.status, queueRunningAfterStop: taskQueue.getStatus().isRunning });
      rejectRead(new Error("AUDIT cleanup releases stalled request"));
      assert.equal(released.record?.status, "FAILED"); taskQueue.resumeQueue();

      // JSON syntax errors and real HTTP failure statuses do reject; arrays are not silently coerced.
      for (const mode of ["invalid-json", "http-403"]) {
        globalThis.fetch = async (input: any) => String(input).includes("login.php")
          ? new Response("", { headers: { "set-cookie": "PHPSESSID=AUDIT; Path=/" } })
          : mode === "invalid-json" ? new Response("<html>login</html>") : new Response("denied", { status: 403 });
        await assert.rejects(() => new sync.LiveTeachingReportCardHttpTransport("https://teachingmindx.top").getExercises("AUDIT"));
      }
      observe("CONTROL-live-http-json", "PASS", "Invalid JSON syntax and business HTTP 403 rejected");
    } finally { Object.assign(config, oldConfig); }
  } finally {
    globalThis.fetch = originalFetch;
    taskQueue.resumeQueue();
    db.closeDb();
    const output = assertPathAllowed(process.env.MINDX_AUDIT_OBSERVATIONS || path.join(os.tmpdir(), "mindx-stage3-observations.json"));
    fs.writeFileSync(output, JSON.stringify(observations, null, 2));
    console.log(`OBSERVATIONS=${observations.length}; BUG_REPRODUCED=${observations.filter((x) => x.result === "BUG_REPRODUCED").length}; CONTROLS_PASS=${observations.filter((x) => x.result === "PASS").length}`);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
