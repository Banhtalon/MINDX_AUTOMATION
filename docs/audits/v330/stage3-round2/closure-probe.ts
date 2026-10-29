/** Independent Round 2 closure checks. All data paths must be under TEMP; all fetches are intercepted. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function main() {
  for (const key of ["MINDX_DB_PATH", "MINDX_RUNNING_CLASSES_PATH", "MINDX_AUDIT_OBSERVATIONS"]) {
    assert(process.env[key] && path.resolve(process.env[key]!).toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase() + path.sep));
  }
  const db = await import("../../../../src/lib/db/sqlite");
  const sync = await import("../../../../src/lib/playwright/teaching-report-card-sync");
  const calc = await import("../../../../src/lib/report-card/report-card-calculator");
  const api = await import("../../../../src/app/api/report-card/route");
  const syncApi = await import("../../../../src/app/api/report-card/sync-teaching/route");
  const { NextRequest } = await import("next/server");
  const { taskQueue } = await import("../../../../src/lib/queue/task-queue");
  const { config } = await import("../../../../src/lib/config");
  const { assertPathAllowed } = await import("../../../../src/lib/security/path-allowlist");
  config.allowedLocalDirs.push(os.tmpdir());
  const observations: any[] = [];
  const observe = (id: string, closed: boolean, details: unknown) => {
    const row = { id, result: closed ? "CLOSED" : "OPEN", details };
    observations.push(row); console.log(JSON.stringify(row));
  };
  const originalFetch = globalThis.fetch;
  const oldConfig = { teachingUsername: config.teachingUsername, teachingPassword: config.teachingPassword };
  globalThis.fetch = async () => { throw new Error("AUDIT: unexpected network call"); };
  config.teachingUsername = "AUDIT_USER"; config.teachingPassword = "AUDIT_PASSWORD";
  let sequence = 0;
  const snapshot = (): any => {
    const classId = `AUDIT-R2-CODE-${++sequence}`;
    return { classId, classCode: classId, isRobotics: false, scrapedAt: "2026-10-29T00:00:00Z",
      btvnSessions: [{ sessionNumber: 1, hasTheory: true, hasPractice: true, maxTheoryScore: 100, maxPracticeScore: 100 }],
      students: [{ studentId: "LMS_01", fullName: "Nguyễn Văn An", isActive: true,
        btvnScores: { 1: { sessionNumber: 1, theoryRaw: 80, theoryMax: 100, practiceRaw: null, practiceMax: 100 } },
        stageScores: { cp1Theory: 4, cp1Practice: 4, cp1Competency: 4, cp2Theory: 4, cp2Practice: 4, cp2Competency: 4, finalProduct: 4, finalCompetency: 4 } }] };
  };
  const approve = (s: any) => {
    const r = db.reportCardRepo.saveLmsSnapshot(s.classId, s);
    const result = db.reportCardRepo.approveReportCard(s.classId, r.draftVersion);
    assert(result.success); return result.record;
  };
  const transport = (s: any, readback?: (rows: any[]) => any[]) => {
    const saved: any[] = [], declared: any[] = [], exercises: any[] = [];
    return { saved, declared, exercises,
      async getStudents() { return [{ id: 101, student_name: "Nguyễn Văn An", status: "active", class_code: s.classId }]; },
      async getExercises() { return exercises; },
      async addMultiExercise(p: any) { declared.push(p); for (const sn of p.sessions) for (const form of p.exerciseForms) exercises.push({ id: exercises.length + 1, class_code: s.classId, session_number: sn, exercise_type: p.exerciseType, exercise_form: form, max_score: form === "nang_luc" ? p.maxScoreNangLuc : p.maxScore }); return { success: true }; },
      async saveScores(rows: any[]) { saved.push(...rows); return { success: true }; },
      async getScores() { const rows = saved.map(x => ({ ...x, normalized_score: calc.round2(x.raw_score / x.max_score * 5) })); return readback ? readback(rows) : rows; },
    };
  };
  const run = async (readback?: (rows: any[]) => any[]) => {
    const s = snapshot(), r = approve(s), t = transport(s, readback);
    return { s, t, result: await sync.TeachingReportCardSyncService.syncReportCardToTeaching(s.classId, { expectedVersion: r.draftVersion, transport: t }) };
  };
  const remote = (name = "Nguyễn Văn An", status = "active", id = 101) => ({ id, student_name: name, status });
  const request = (method: string, body: any, url = "http://127.0.0.1:3000/api/report-card") => new NextRequest(url, {
    method, headers: { host: "127.0.0.1:3000", "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const matching = (id: string, students: any[], name = "Nguyễn Văn An") => {
    const local = calc.computeClassReportCard(snapshot(), {}).students;
    local[0].studentId = id; local[0].fullName = name;
    try { return { id: sync.matchReportCardStudentsToTeaching(local, students, "AUDIT-MATCH").get(id)?.teachingStudentId, rejected: false }; }
    catch (e) { return { rejected: true, error: String(e) }; }
  };
  try {
    for (const id of ["TEACHING_101", "TID:101"]) {
      observe(`S3-01-valid-${id}`, matching(id, [remote()]).id === 101, "Exact active explicit binding accepted");
      const result = matching(id, [remote("Nguyễn Văn Ân")]);
      observe(`S3-01-wrong-tone-${id}`, result.rejected, result);
      const inactive = matching(id, [remote("Nguyễn Văn An", "inactive")]);
      observe(`S3-02-explicit-${id}`, inactive.rejected, inactive);
      const duplicate = matching(id, [remote(), remote("Nguyễn Văn An", "active", 102)]);
      observe(`S3-01-duplicate-${id}`, duplicate.rejected, duplicate);
    }
    const numeric = matching("101", [remote("Nguyễn Văn Ân"), remote("Nguyễn Văn An", "active", 102)]);
    observe("S3-01-numeric-name-priority", numeric.id === 102, numeric);
    const bindingS = snapshot(); bindingS.students[0].studentId = "TEACHING_101";
    const bindingR = approve(bindingS), bindingT = transport(bindingS);
    bindingT.getStudents = async () => [{ ...remote("Nguyễn Văn Ân"), class_code: bindingS.classId }];
    const bindingResult = await sync.TeachingReportCardSyncService.syncReportCardToTeaching(bindingS.classId, { expectedVersion: bindingR.draftVersion, transport: bindingT });
    observe("S3-01-explicit-wrong-tone-end-to-end", !bindingResult.success && bindingT.saved.length === 0, { success: bindingResult.success, status: bindingResult.record?.status, scoreWrites: bindingT.saved.length, writtenStudentIds: [...new Set(bindingT.saved.map(x => x.student_id))] });
    for (const status of ["inactive", "dropped", "nghỉ học", "nghi_hoc", "tam_nghi", "bao_luu", "tạm nghỉ", "bảo lưu", "chuyen_lop", "bo_hoc", "da_nghi", "disabled", "archived"]) {
      for (const name of ["Nguyễn Văn An", "Nguyen Van An"]) {
        const result = matching("LMS_01", [remote(name, status)]);
        assert(result.rejected); // Covers exact and tone-insensitive branches.
      }
    }
    observe("S3-02-status-matrix", true, "13 inactive statuses excluded from exact and no-tone branches; explicit inactive cases above");

    for (const [field, values] of [
      ["normalized_score", [undefined, null, "", " ", [], {}, true, NaN, Infinity, "bad"]],
    ] as const) {
      for (const [index, value] of values.entries()) {
        const { result } = await run(rows => rows.map(x => ({ ...x, [field]: value })));
        assert(!result.success && result.record?.status === "FAILED");
        observe(`S3-03-pushed-${index}`, true, { value: String(value), status: result.record?.status });
      }
    }
    for (const field of ["raw_score", "normalized_score"]) for (const [index, value] of [0, 5, "0", "5", [], {}, true, NaN, Infinity, "bad"].entries()) {
      const { result } = await run(rows => [...rows, { student_id: 101, session_number: 1, exercise_type: "btvn", exercise_form: "practice", raw_score: null, normalized_score: null, [field]: value }]);
      assert(!result.success && result.record?.status === "FAILED");
      observe(`S3-03-null-${field}-${index}`, true, { value: String(value), status: result.record?.status });
    }
    for (const delta of [0.01, -0.01]) {
      const { result } = await run(rows => rows.map(x => ({ ...x, normalized_score: calc.round2(x.normalized_score + delta) })));
      observe(`S3-03-normalized-cent-${delta}`, !result.success, { expected: 4, returned: calc.round2(4 + delta), success: result.success, status: result.record?.status });
    }

    for (const version of [undefined, null, "", 0, -1, 1.5, true, [], {}, Infinity, "bad"]) {
      const s = snapshot(), r = approve(s), t = transport(s);
      const result = await sync.TeachingReportCardSyncService.syncReportCardToTeaching(s.classId, { expectedVersion: version, transport: t });
      assert(result.statusCode === 400 && !result.success && !t.saved.length && !t.declared.length);
      assert(db.reportCardRepo.findOne(s.classId)?.draftVersion === r.draftVersion);
    }
    observe("S3-05-invalid-service-versions", true, "11 invalid/omitted versions rejected before transport");
    const markSyncing = db.reportCardRepo.markSyncingTeaching, markVerified = db.reportCardRepo.markTeachingVerified;
    const forwarded: any[] = [];
    db.reportCardRepo.markSyncingTeaching = function(...args: Parameters<typeof markSyncing>) { forwarded.push(["syncing", args[2]]); return markSyncing.apply(this, args); };
    db.reportCardRepo.markTeachingVerified = function(...args: Parameters<typeof markVerified>) { forwarded.push(["verified", args[3]]); return markVerified.apply(this, args); };
    try {
      const s = snapshot(), r = approve(s);
      const result = await sync.TeachingReportCardSyncService.syncReportCardToTeaching(s.classId, { expectedVersion: r.draftVersion, transport: transport(s) });
      assert(result.success); assert.deepEqual(forwarded, [["syncing", r.draftVersion], ["verified", r.draftVersion]]);
      observe("S3-05-repository-version-forwarding", true, forwarded);
    } finally { db.reportCardRepo.markSyncingTeaching = markSyncing; db.reportCardRepo.markTeachingVerified = markVerified; }
    const repoS = snapshot(), repoR = approve(repoS);
    db.reportCardRepo.markSyncingTeaching(repoS.classId, repoR.contentHash, repoR.draftVersion);
    db.getDb().prepare("UPDATE class_report_cards SET draftVersion=draftVersion+1 WHERE classId=?").run(repoS.classId);
    assert.throws(() => db.reportCardRepo.markTeachingVerified(repoS.classId, repoR.contentHash, {}, repoR.draftVersion), /Phiên bản/);
    observe("S3-09-stale-version", true, "Same hash, stale expectedVersion cannot verify");

    for (const [method, handler, url] of [["POST", api.POST, "http://127.0.0.1:3000/api/report-card"], ["PUT", api.PUT, "http://127.0.0.1:3000/api/report-card"], ["POST", syncApi.POST, "http://127.0.0.1:3000/api/report-card/sync-teaching"]] as const) {
      for (const body of ["{", "null", "[]", "true", "3", '"text"']) assert.equal((await handler(request(method, body, url))).status, 400);
    }
    observe("S3-06-body-matrix", true, "18 malformed/non-object requests returned 400");
    const actionS = snapshot(); let actionR = approve(actionS);
    const put = (body: any) => api.PUT(request("PUT", { classId: actionS.classId, expectedVersion: actionR.draftVersion, ...body }));
    for (const body of [{ action: "unknown", updates: [{ studentId: "LMS_01", fieldKey: "cp1_theory", normScore: 2 }] }, { action: "clear_override", studentId: "LMS_01", fieldKey: "cp1_theory", updates: [] }, { action: "approve", restoreLms: {} }]) assert.equal((await put(body)).status, 400);
    observe("S3-07-invalid-actions", true, "Unknown action and specified contradictory action payloads rejected");
    const contradictory = await put({ action: "set_override", studentId: "LMS_01", fieldKey: "cp1_theory", normScore: 1, updates: [{ studentId: "LMS_01", fieldKey: "cp1_theory", normScore: 5 }] });
    const contradictoryBody = await contradictory.json(); actionR = contradictoryBody.record || actionR;
    observe("S3-07-conflicting-score-payloads", contradictory.status === 400, { status: contradictory.status, overrides: contradictoryBody.overrides });

    const effectsS = snapshot(); effectsS.students.push({ ...structuredClone(effectsS.students[0]), studentId: "LMS_02", fullName: "Trần Minh Bình" });
    let effectsR = approve(effectsS);
    const apply = async (body: any) => {
      const response = await api.PUT(request("PUT", { classId: effectsS.classId, expectedVersion: effectsR.draftVersion, ...body }));
      assert.equal(response.status, 200); const payload = await response.json(); effectsR = payload.record; return payload;
    };
    const set = await apply({ action: "set_override", studentId: "LMS_01", fieldKey: "cp1_theory", normScore: 2 });
    assert.equal(set.overrides["LMS_01::cp1_theory"].normScore, 2);
    await apply({ action: "set_override", updates: [{ studentId: "LMS_01", fieldKey: "cp1_practice", normScore: 3 }, { studentId: "LMS_02", fieldKey: "cp1_theory", normScore: 1 }] });
    const cleared = await apply({ action: "clear_override", studentId: "LMS_01", fieldKey: "cp1_theory" });
    assert(!cleared.overrides["LMS_01::cp1_theory"]); assert(cleared.overrides["LMS_01::cp1_practice"] && cleared.overrides["LMS_02::cp1_theory"]);
    const resetStudent = await apply({ action: "reset_student_overrides", studentId: "LMS_01" });
    assert.deepEqual(Object.keys(resetStudent.overrides), ["LMS_02::cp1_theory"]);
    const resetAll = await apply({ action: "reset_all_overrides" }); assert.deepEqual(resetAll.overrides, {});
    const approved = await apply({ action: "approve" }); assert.equal(approved.record.status, "APPROVED"); assert(approved.record.contentHash);
    for (const action of ["approve", "set_override", "clear_override", "reset_student_overrides", "reset_all_overrides"]) {
      const response = await api.PUT(request("PUT", { classId: effectsS.classId, expectedVersion: effectsR.draftVersion + 1, action, studentId: "LMS_01", fieldKey: "cp1_theory", normScore: 2 }));
      assert.equal(response.status, 409);
    }
    observe("S3-07-action-effects-and-stale-versions", true, "All five actions verified against actual override contents/status; each rejects stale version with 409");

    // All HTTP is mocked, including login. No real network calls or real credentials.
    const loginResponse = () => new Response("", { headers: { "set-cookie": "PHPSESSID=AUDIT; Path=/" } });
    for (const stage of ["GET", "POST"]) for (const status of [400, 503]) {
      globalThis.fetch = async (input, init) => String(input).includes("login.php")
        ? (String(init?.method || "GET") === stage ? new Response("denied", { status }) : loginResponse()) : Response.json([]);
      await assert.rejects(() => new sync.LiveTeachingReportCardHttpTransport().getExercises("AUDIT"), new RegExp(`HTTP ${status}`));
    }
    observe("S3-04-login-statuses", true, "Both login GET/POST reject 400 and 503");
    for (const endpoint of ["getStudents", "getExercises", "getScores"] as const) {
      for (const payload of [{ success: false }, {}, null, "bad", 4]) {
        globalThis.fetch = async input => String(input).includes("login.php") ? loginResponse() : Response.json(payload);
        await assert.rejects(() => new sync.LiveTeachingReportCardHttpTransport()[endpoint]("AUDIT"));
      }
    }
    observe("S3-04-read-shapes", true, "15 error/non-array responses rejected on all three read endpoints");
    for (const [index, ack] of [{ ok: true }, { status: "success" }, { success: "true", ok: true }, { success: 1, status: "success" }, { success: true }].entries()) {
      globalThis.fetch = async input => String(input).includes("login.php") ? loginResponse() : Response.json(ack);
      for (const method of ["addMultiExercise", "saveScores"] as const) {
        let accepted = false;
        try {
          const live = new sync.LiveTeachingReportCardHttpTransport();
          const result = method === "saveScores" ? await live.saveScores([]) : await live.addMultiExercise({ classCode: "AUDIT", exerciseType: "cp1", exerciseForms: ["theory"], sessions: [5], maxScore: 5 });
          accepted = result.success;
        } catch { /* Fail closed is expected without literal success:true. */ }
        observe(`S3-04-ack-${method}-${index}`, accepted === (ack.success === true), { ack, accepted });
      }
    }

    for (const mode of ["stop", "timeout"] as const) {
      let headerSignal!: AbortSignal, notifyHeaders!: () => void;
      const headerEntered = new Promise<void>(resolve => { notifyHeaders = resolve; });
      globalThis.fetch = async (input, init) => {
        if (String(input).includes("login.php")) return loginResponse();
        headerSignal = init!.signal!; notifyHeaders();
        return await new Promise<Response>((_resolve, reject) => headerSignal.addEventListener("abort", () => reject(headerSignal.reason), { once: true }));
      };
      const pending = new sync.LiveTeachingReportCardHttpTransport("https://teachingmindx.top", 20).getStudents("AUDIT").then(() => false, () => true);
      await headerEntered; if (mode === "stop") taskQueue.stopQueue();
      const rejected = await pending; assert(headerSignal.aborted && rejected);
      observe(`S3-08-before-headers-${mode}`, true, { requestSignalAborted: headerSignal.aborted, rejected }); taskQueue.resumeQueue();
    }

    // A real Response body stream remains pending after headers; abort handlers model fetch's body cancellation.
    for (const mode of ["stop", "timeout"] as const) {
      let signal!: AbortSignal, streamController!: ReadableStreamDefaultController<Uint8Array>, bodyEntered!: () => void;
      const entered = new Promise<void>(resolve => { bodyEntered = resolve; });
      globalThis.fetch = async (input, init) => {
        if (String(input).includes("login.php")) return loginResponse();
        signal = init!.signal!;
        const stream = new ReadableStream<Uint8Array>({ start(controller) {
          streamController = controller;
          signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
        } });
        const response = new Response(stream, { headers: { "content-type": "application/json" } });
        const originalJson = response.json.bind(response);
        response.json = () => { bodyEntered(); return originalJson(); };
        return response;
      };
      let settled = false;
      const live = new sync.LiveTeachingReportCardHttpTransport("https://teachingmindx.top", 20);
      const pending = live.saveScores([]).then(value => ({ value }), error => ({ error: String(error) })).finally(() => { settled = true; });
      await entered;
      if (mode === "stop") taskQueue.stopQueue();
      await new Promise(resolve => setTimeout(resolve, 60));
      observe(`S3-08-response-body-${mode}`, signal.aborted && settled, { requestSignalAborted: signal.aborted, settledAfter60ms: settled, requestTimeoutMs: 20 });
      if (!signal.aborted) { streamController.enqueue(new TextEncoder().encode('{"success":true}')); streamController.close(); }
      await pending; taskQueue.resumeQueue();
    }

    // Repeat the body-phase Stop through the real service, observing the queue slot and outstanding signal.
    const bodyS = snapshot(), bodyR = approve(bodyS);
    let bodySignal!: AbortSignal, bodyController!: ReadableStreamDefaultController<Uint8Array>, notifyBody!: () => void;
    const bodyEntered = new Promise<void>(resolve => { notifyBody = resolve; });
    globalThis.fetch = async (input, init) => {
      if (String(input).includes("login.php")) return loginResponse();
      bodySignal = init!.signal!;
      const stream = new ReadableStream<Uint8Array>({ start(controller) {
        bodyController = controller; bodySignal.addEventListener("abort", () => controller.error(bodySignal.reason), { once: true });
      } });
      const response = new Response(stream);
      const originalJson = response.json.bind(response);
      response.json = () => { notifyBody(); return originalJson(); };
      return response;
    };
    const bodyPending = sync.TeachingReportCardSyncService.syncReportCardToTeaching(bodyS.classId, { expectedVersion: bodyR.draftVersion, transport: new sync.LiveTeachingReportCardHttpTransport("https://teachingmindx.top", 20) });
    await bodyEntered; taskQueue.stopQueue(); const bodyResult = await bodyPending;
    await new Promise<void>(resolve => setImmediate(resolve));
    observe("S3-08-service-body-stop", bodySignal.aborted, { success: bodyResult.success, status: bodyResult.record?.status, queueRunning: taskQueue.getStatus().isRunning, requestSignalAborted: bodySignal.aborted });
    if (!bodySignal.aborted) { bodyController.enqueue(new TextEncoder().encode('[]')); bodyController.close(); }
    await new Promise<void>(resolve => setImmediate(resolve)); taskQueue.resumeQueue();

    // Stop at each service transport boundary. No subsequent service call may begin.
    for (const stopAt of ["getStudents", "getExercises", "addMultiExercise", "saveScores", "getScores"] as const) {
      const s = snapshot(), r = approve(s), t = transport(s), calls: string[] = [];
      let stopSeen = false, callsAfterStop = 0;
      for (const key of ["getStudents", "getExercises", "addMultiExercise", "saveScores", "getScores"] as const) {
        const original = t[key].bind(t) as (...args: any[]) => Promise<any>;
        (t as any)[key] = async (...args: any[]) => {
          if (stopSeen) callsAfterStop++;
          calls.push(key); const result = await original(...args);
          if (key === stopAt && !stopSeen) { stopSeen = true; taskQueue.stopQueue(); }
          return result;
        };
      }
      const result = await sync.TeachingReportCardSyncService.syncReportCardToTeaching(s.classId, { expectedVersion: r.draftVersion, transport: t });
      assert(stopSeen && !result.success && callsAfterStop === 0 && result.record?.status === "FAILED");
      observe(`S3-08-service-stop-${stopAt}`, true, { calls, callsAfterStop, status: result.record?.status });
      taskQueue.resumeQueue();
    }
  } finally {
    globalThis.fetch = originalFetch; Object.assign(config, oldConfig); taskQueue.resumeQueue(); db.closeDb();
    fs.writeFileSync(assertPathAllowed(process.env.MINDX_AUDIT_OBSERVATIONS!), JSON.stringify(observations, null, 2));
    console.log(`OBSERVATIONS=${observations.length}; OPEN=${observations.filter(x => x.result === "OPEN").length}; CLOSED=${observations.filter(x => x.result === "CLOSED").length}`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
