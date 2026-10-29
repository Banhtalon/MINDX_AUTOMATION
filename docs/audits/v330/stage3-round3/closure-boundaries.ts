/** Independent Round 3 closure boundaries. TEMP-only data; every HTTP request is intercepted. */
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
  const { NextRequest } = await import("next/server");
  const { taskQueue } = await import("../../../../src/lib/queue/task-queue");
  const { config } = await import("../../../../src/lib/config");
  const { assertPathAllowed } = await import("../../../../src/lib/security/path-allowlist");
  config.allowedLocalDirs.push(path.dirname(process.env.MINDX_DB_PATH!));
  const observations: any[] = [];
  const observe = (id: string, details: unknown) => {
    const row = { id, result: "CLOSED", details }; observations.push(row); console.log(JSON.stringify(row));
  };
  const oldFetch = globalThis.fetch;
  const oldCredentials = { teachingUsername: config.teachingUsername, teachingPassword: config.teachingPassword };
  config.teachingUsername = "AUDIT_USER"; config.teachingPassword = "AUDIT_PASSWORD";
  globalThis.fetch = async () => { throw Error("AUDIT: unexpected network access"); };
  let serial = 0;
  const snapshot = (): any => {
    const classId = `AUDIT-R3-${++serial}`;
    return { classId, classCode: classId, isRobotics: false, scrapedAt: "2026-10-29T00:00:00Z",
      btvnSessions: [{ sessionNumber: 1, hasTheory: true, hasPractice: true, maxTheoryScore: 100, maxPracticeScore: 100 }],
      students: [{ studentId: "LMS_01", fullName: "Nguyễn Văn An", isActive: true,
        btvnScores: { 1: { sessionNumber: 1, theoryRaw: 80, theoryMax: 100, practiceRaw: null, practiceMax: 100 } },
        stageScores: { cp1Theory: 4, cp1Practice: 4, cp1Competency: 4, cp2Theory: 4, cp2Practice: 4, cp2Competency: 4, finalProduct: 4, finalCompetency: 4 } }] };
  };
  const approve = (s: any) => {
    const r = db.reportCardRepo.saveLmsSnapshot(s.classId, s);
    const a = db.reportCardRepo.approveReportCard(s.classId, r.draftVersion); assert(a.success); return a.record;
  };
  const transport = (s: any, normalized: (value: number) => unknown = x => x): any => {
    const calls: string[] = [], saved: any[] = [], exercises: any[] = [];
    return { calls, saved,
      async getStudents() { calls.push("getStudents"); return [{ id: 101, student_name: s.students[0].fullName, status: "active", class_code: s.classId }]; },
      async getExercises() { calls.push("getExercises"); return exercises; },
      async addMultiExercise(p: any) { calls.push("addMultiExercise"); for (const sn of p.sessions) for (const form of p.exerciseForms) exercises.push({ id: exercises.length + 1, class_code: s.classId, session_number: sn, exercise_type: p.exerciseType, exercise_form: form, max_score: form === "nang_luc" ? p.maxScoreNangLuc : p.maxScore }); return { success: true }; },
      async saveScores(rows: any[]) { calls.push("saveScores"); saved.push(...rows); return { success: true }; },
      async getScores() { calls.push("getScores"); return saved.map(x => ({ ...x, normalized_score: normalized(calc.round2(x.raw_score / x.max_score * 5)) })); },
    };
  };
  const remote = (id = 101, student_name = "Nguyễn Văn An", status = "active") => ({ id, student_name, status, class_code: "AUDIT" });
  const request = (body: any) => new NextRequest("http://127.0.0.1:3000/api/report-card", { method: "PUT", headers: { host: "127.0.0.1:3000", "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    for (const prefix of ["TEACHING_", "TID:"]) {
      const local = calc.computeClassReportCard(snapshot(), {}).students;
      local[0].studentId = `${prefix}101`;
      for (const [label, rows] of [
        ["missing-with-name-fallback", [remote(102)]],
        ["inactive-with-active-fallback", [remote(101, "Nguyễn Văn An", "inactive"), remote(102)]],
        ["wrong-tone-with-exact-fallback", [remote(101, "Nguyễn Văn Ân"), remote(102)]],
        ["wrong-name-with-no-tone-fallback", [remote(101, "Nguyễn Văn Ân")]],
        ["duplicate-remote-name", [remote(), remote(102)]],
        ["duplicate-remote-id", [remote(), remote()]],
      ] as const) {
        assert.throws(() => sync.matchReportCardStudentsToTeaching(local, [...rows], "AUDIT"));
        const s = snapshot(); s.students[0].studentId = `${prefix}101`; const r = approve(s), t = transport(s);
        t.getStudents = async () => { t.calls.push("getStudents"); return rows.map(row => ({ ...row, class_code: s.classId })); };
        const result = await sync.TeachingReportCardSyncService.syncReportCardToTeaching(s.classId, { expectedVersion: r.draftVersion, transport: t });
        assert(!result.success && result.record?.status === "FAILED"); assert.deepEqual(t.calls, ["getStudents"]); assert.equal(t.saved.length, 0);
        observe(`S3-01-${prefix}-${label}`, { status: result.record?.status, calls: t.calls, scoreWrites: t.saved.length });
      }
      const duplicateLocal = structuredClone(local[0]); duplicateLocal.studentId = prefix === "TID:" ? "TEACHING_101" : "TID:101";
      assert.throws(() => sync.matchReportCardStudentsToTeaching([...local, duplicateLocal], [remote()], "AUDIT"));
      observe(`S3-01-${prefix}-local-reuse`, "Both explicit prefixes cannot claim one remote student");
      for (const id of [`${prefix}0`, `${prefix}999999999999999999999999999999999999999999`]) {
        local[0].studentId = id; assert.throws(() => sync.matchReportCardStudentsToTeaching(local, [remote()], "AUDIT"));
      }
      local[0].studentId = `${prefix}101`; local[0].fullName = "  NGUYỄN   VĂN AN ".normalize("NFD");
      assert.equal(sync.matchReportCardStudentsToTeaching(local, [remote()], "AUDIT").get(local[0].studentId)?.teachingStudentId, 101);
      observe(`S3-01-${prefix}-normalized-positive`, "NFC, whitespace and case normalization preserve exact tones");
    }

    for (const [label, normalize, accepted] of [
      ["exact", (x: number) => x, true], ["numeric-string", (x: number) => x.toFixed(2), true],
      ["same-rounded-value", (x: number) => x + 0.0001, true],
      ["cent-plus-string", (x: number) => calc.round2(x + 0.01).toFixed(2), false],
      ["cent-minus-string", (x: number) => calc.round2(x - 0.01).toFixed(2), false],
    ] as const) {
      const s = snapshot(), r = approve(s), t = transport(s, normalize);
      const result = await sync.TeachingReportCardSyncService.syncReportCardToTeaching(s.classId, { expectedVersion: r.draftVersion, transport: t });
      assert.equal(result.success, accepted); assert.equal(result.record?.status, accepted ? "VERIFIED" : "FAILED");
      observe(`S3-03-${label}`, { status: result.record?.status, scoreWrites: t.saved.length });
    }

    const sourceS = snapshot(); let sourceR = approve(sourceS);
    const sources = [
      { studentId: "LMS_01", fieldKey: "cp1_theory", normScore: 1 },
      { updates: [{ studentId: "LMS_01", fieldKey: "cp1_theory", normScore: 2 }] },
      { patchOverrides: { "LMS_01::cp1_theory": { normScore: 3 } } },
    ];
    for (const action of [undefined, "set_override", "save_overrides"]) {
      for (const indices of [[0, 1], [0, 2], [1, 2], [0, 1, 2]]) {
        const before = db.reportCardRepo.findOne(sourceS.classId);
        const body = Object.assign({ classId: sourceS.classId, expectedVersion: sourceR.draftVersion, ...(action ? { action } : {}) }, ...indices.map(i => sources[i]));
        const result = await api.PUT(request(body)); assert.equal(result.status, 400);
        assert.deepEqual(db.reportCardRepo.findOne(sourceS.classId), before);
        observe(`S3-07-${action || "legacy"}-${indices.join("+")}`, { status: result.status, repositoryUnchanged: true });
      }
      for (const partial of [{ studentId: "LMS_01" }, { normScore: null }, { note: "" }, { maxScore: 5 }]) {
        const before = db.reportCardRepo.findOne(sourceS.classId);
        const result = await api.PUT(request({ classId: sourceS.classId, expectedVersion: sourceR.draftVersion, ...(action ? { action } : {}), updates: [], ...partial }));
        assert.equal(result.status, 400); assert.deepEqual(db.reportCardRepo.findOne(sourceS.classId), before);
      }
      observe(`S3-07-${action || "legacy"}-partial-sources`, "Four partial/empty top-level sources plus updates rejected without repository changes");
      for (const [index, source] of sources.entries()) {
        const result = await api.PUT(request({ classId: sourceS.classId, expectedVersion: sourceR.draftVersion, ...(action ? { action } : {}), ...source }));
        assert.equal(result.status, 200); const payload = await result.json(); sourceR = payload.record;
        assert.equal(payload.overrides["LMS_01::cp1_theory"].normScore, index + 1);
        observe(`S3-07-${action || "legacy"}-single-${index}`, { status: result.status, normScore: index + 1 });
      }
    }

    const login = () => new Response("", { headers: { "set-cookie": "PHPSESSID=AUDIT; Path=/" } });
    const methods = ["getStudents", "getExercises", "getScores", "addMultiExercise", "saveScores"] as const;
    type Method = typeof methods[number];
    const invoke = (live: InstanceType<typeof sync.LiveTeachingReportCardHttpTransport>, method: Method) => method === "saveScores" ? live.saveScores([]) : method === "addMultiExercise" ? live.addMultiExercise({ classCode: "AUDIT", exerciseType: "cp1", exerciseForms: ["theory"], sessions: [5], maxScore: 5 }) : live[method]("AUDIT");
    for (const method of ["addMultiExercise", "saveScores"] as const) {
      for (const [index, ack] of [null, [], true, { ok: true }, { status: "success" }, { success: "true", ok: true }, { success: 1, status: "success" }, { success: true }].entries()) {
        let businessCalls = 0;
        globalThis.fetch = async input => {
          if (String(input).includes("login.php")) return login();
          return ++businessCalls === 1 ? new Response("", { status: 302 }) : Response.json(ack);
        };
        const result = await invoke(new sync.LiveTeachingReportCardHttpTransport(), method).then(value => ({ value }), error => ({ error: String(error) }));
        const accepted = "value" in result && (result.value as any)?.success === true;
        assert.equal(accepted, (ack as any)?.success === true); assert.equal(businessCalls, 2);
        observe(`S3-04-retry-${method}-${index}`, { ack, accepted, businessCalls });
      }
    }

    const subscribe = taskQueue.subscribeStatus;
    let activeSubscriptions = 0;
    taskQueue.subscribeStatus = function(listener) {
      activeSubscriptions++; const off = subscribe.call(this, listener); let active = true;
      return () => { if (active) { active = false; activeSubscriptions--; off(); } };
    };
    try {
      for (const method of methods) for (const retry of [false, true]) for (const mode of ["stop", "timeout", "success", "malformed"] as const) {
        assert.equal(activeSubscriptions, 0); taskQueue.resumeQueue();
        let signal!: AbortSignal, streamController!: ReadableStreamDefaultController<Uint8Array>, enteredResolve!: () => void, businessCalls = 0;
        const entered = new Promise<void>(resolve => { enteredResolve = resolve; });
        globalThis.fetch = async (input, init) => {
          if (String(input).includes("login.php")) return login();
          businessCalls++;
          if (retry && businessCalls === 1) return new Response("", { status: 302 });
          signal = init!.signal!;
          const body = new ReadableStream<Uint8Array>({ start(c) { streamController = c; signal.addEventListener("abort", () => c.error(signal.reason), { once: true }); } });
          const res = new Response(body, { headers: { "content-type": "application/json" } });
          const json = res.json.bind(res); res.json = () => { enteredResolve(); return json(); }; return res;
        };
        const timeoutMs = mode === "timeout" ? 30 : 1000;
        let settled = false;
        const pending = invoke(new sync.LiveTeachingReportCardHttpTransport("https://teachingmindx.top", timeoutMs), method)
          .then(value => ({ value }), error => ({ error: String(error) })).finally(() => { settled = true; });
        let watchdog: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([entered, new Promise<never>((_, reject) => { watchdog = setTimeout(() => reject(Error("Probe did not reach JSON consumption")), 2000); })]);
        } finally { clearTimeout(watchdog); }
        assert(!signal.aborted && !settled); assert.equal(activeSubscriptions, 1);
        if (mode === "stop") taskQueue.stopQueue();
        if (mode === "success" || mode === "malformed") {
          const payload = mode === "malformed" ? "{" : method.startsWith("get") ? "[]" : '{"success":true}';
          streamController.enqueue(new TextEncoder().encode(payload)); streamController.close();
        }
        let completionWatchdog: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([pending, new Promise<never>((_, reject) => { completionWatchdog = setTimeout(() => reject(Error("Probe body operation did not settle")), 2000); })]).finally(() => clearTimeout(completionWatchdog));
        assert.equal("value" in result, mode === "success");
        assert.equal(signal.aborted, mode === "stop" || mode === "timeout");
        assert.equal(activeSubscriptions, 0); assert.equal(businessCalls, retry ? 2 : 1);
        observe(`S3-08-${method}-${retry ? "retry" : "direct"}-${mode}`, { signalAborted: signal.aborted, settled, subscriptionsAfter: activeSubscriptions, businessCalls, timeoutMs });
        taskQueue.resumeQueue();
      }
    } finally { taskQueue.subscribeStatus = subscribe; }
  } finally {
    globalThis.fetch = oldFetch; Object.assign(config, oldCredentials); taskQueue.resumeQueue(); db.closeDb();
    fs.writeFileSync(assertPathAllowed(process.env.MINDX_AUDIT_OBSERVATIONS!), JSON.stringify(observations, null, 2));
    console.log(`OBSERVATIONS=${observations.length}; CLOSED=${observations.length}`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
