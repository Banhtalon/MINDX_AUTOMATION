// Independent Round 16 assertions; synthetic identities and in-memory SQLite only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import EventEmitter from 'node:events';
import { stripTypeScriptTypes } from 'node:module';
import Database from 'better-sqlite3';
import * as XLSX from 'xlsx';
const fixtureSource = fs.readFileSync('docs/audits/round-12/verify-independent.mjs', 'utf8').split('\nawait check(')[0].replace(/^import .*;\r?$/gm, '');
const ctx = vm.createContext({ assert, fs, path, crypto, vm, stripTypeScriptTypes, Database, XLSX, Request, Response, URL, process, console, setTimeout, clearTimeout, setImmediate });
vm.runInContext(fixtureSource + '\nglobalThis.fixtures={backend,sc,ui,moduleAt,locator,cid,sid,local};', ctx);
const { backend, sc, ui, moduleAt, locator, cid, sid, local } = ctx.fixtures;
const results = [];
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function check(id, criterion, fn) {
  try { const observation = await fn(); results.push({ id, criterion, pass: true, observation }); console.log('PASS ' + id + ' ' + JSON.stringify(observation)); }
  catch (e) { results.push({ id, criterion, pass: false, error: e.stack, observation: e.observation }); console.log('FAIL ' + id + ': ' + e.message); }
}
function expect(condition, observation, message) { if (!condition) { const e = Error(message); e.observation = observation; throw e; } }
const session = { classId: cid, classCode: cid, sessionId: sid, sessionNumber: 1, topic: 'Synthetic lesson' };
const input = extra => ({ studentId: 'S1', fullName: 'Audit S1', attendanceStatus: 'PRESENT', quickTags: ['focused'], teacherNote: 'old S1', ...extra });
const modelResult = text => ({ response: { text: () => JSON.stringify({ feedbacks: [{ anonymousId: 'STUDENT_01', strengths: 'AI strength', improvements: 'AI improvement', actionPlan: 'AI action', formattedFullComment: text || 'AI RESULT' }] }) } });
const gen = (b, generateContent) => moduleAt('src/lib/gemini/comment-generator.ts', ['CommentGenerator'], { ...b, getGeminiModel: () => ({ generateContent }) }).CommentGenerator;
const version = b => JSON.parse(b.row().versionMetaJson).rowVer;
async function save(b, patch, query = '') {
  const res = await b.dispatch('/api/session-comments/save-draft' + query, { body: JSON.stringify({ classId: cid, sessionId: sid, studentId: 'S1', ...patch }) });
  assert.equal(res.status, 200); return res.json();
}

await check('R15-01', 'Delayed approval request cannot restore old text', async () => {
  const b = backend(), hold = defer();
  try {
    b.seed('S1', { attendanceStatus: 'PRESENT' });
    const h = sc(b, async (url, opts) => { if (url.includes('/approve')) await hold.promise; return b.dispatch(url, opts); });
    await h.flush(); h.api.setSelectedSessionId(sid); await h.flush();
    const pending = h.api.handleApprove('S1'); await h.flush();
    h.api.handleTextEdit('S1', 'finalText', 'LATEST TEACHER TEXT'); await h.flush();
    hold.resolve(); assert.equal(await pending, false); await h.flush();
    assert.equal(b.row().finalText, 'LATEST TEACHER TEXT'); assert.equal(b.row().status, 'DRAFT'); assert.equal(h.api.students[0].status, 'DRAFT');
    assert.equal(await h.api.handleApprove('S1'), true);
    assert.equal(b.row().status, 'APPROVED'); assert.equal(b.row().finalText, 'LATEST TEACHER TEXT');
    return { delayedOldApprovalRejected: true, freshApprovalWorks: true };
  } finally { hold.resolve(); b.db.close(); }
});
await check('R15-02', 'Delayed AI result preserves latest note/text/attendance in DB and UI', async () => {
  const b = backend(), hold = defer();
  try {
    b.seed('S1', { attendanceStatus: 'PRESENT' });
    const generator = gen(b, async () => { await hold.promise; return modelResult(); });
    const h = sc(b, async (url, opts) => {
      if (!url.includes('/generate-ai')) return b.dispatch(url, opts);
      const body = JSON.parse(opts.body);
      return Response.json({ success: true, data: await generator.generateBatchComments(body.session, body.students) });
    });
    await h.flush(); h.api.setSelectedSessionId(sid); await h.flush();
    const pending = h.api.handleGenerateAi(); await h.flush();
    h.api.handleNoteChange('S1', 'LATEST TEACHER NOTE'); h.api.handleTextEdit('S1', 'finalText', 'LATEST TEACHER TEXT'); h.api.handleAttendanceChange('S1', 'ABSENT'); await h.flush();
    hold.resolve(); await pending; await h.flush();
    assert.equal(b.row().teacherNote, 'LATEST TEACHER NOTE'); assert.equal(b.row().finalText, 'LATEST TEACHER TEXT'); assert.equal(b.row().attendanceStatus, 'ABSENT');
    assert.equal(h.api.students[0].finalText, 'LATEST TEACHER TEXT');
    return { storedNote: b.row().teacherNote, storedText: b.row().finalText, storedAttendance: b.row().attendanceStatus };
  } finally { hold.resolve(); b.db.close(); }
});
await check('R15-03', 'Different page instances and recreated route preserve newer edit', async () => {
  const b = backend(), hold = defer(), clients = [];
  try {
    b.seed('S1', { attendanceStatus: 'PRESENT' });
    const first = sc(b, async (url, opts) => { if (opts?.body) { clients.push(new URL('http://127.0.0.1' + url).searchParams.get('cid')); await hold.promise; } return b.dispatch(url, opts); });
    await first.flush(); first.api.setSelectedSessionId(sid); await first.flush();
    first.api.handleNoteChange('S1', 'OLDER PAGE EDIT'); await first.flush();
    const second = sc(b, async (url, opts) => { if (opts?.body) clients.push(new URL('http://127.0.0.1' + url).searchParams.get('cid')); return b.dispatch(url, opts); });
    await second.flush(); second.api.setSelectedSessionId(sid); await second.flush(); second.api.handleNoteChange('S1', 'LATEST NEW PAGE EDIT'); await second.flush();
    assert.notEqual(clients[0], clients[1]); hold.resolve(); await first.flush(); await second.flush();
    assert.equal(b.row().teacherNote, 'LATEST NEW PAGE EDIT');
    const recreated = moduleAt('src/app/api/session-comments/save-draft/route.ts', ['POST'], { ...b, ...local, NextResponse: Response }).POST;
    const ignored = await recreated(b.request('/api/session-comments/save-draft?cid=old_page&rev=1&base=0&fbase=teacherNote%3A0&f=teacherNote', { classId: cid, sessionId: sid, studentId: 'S1', teacherNote: 'STALE AFTER RELOAD' }));
    assert.equal((await ignored.json()).staleIgnored, true); assert.equal(b.row().teacherNote, 'LATEST NEW PAGE EDIT');
    return { distinctPages: true, recreatedRouteUsesPersistedVersion: true, storedNote: b.row().teacherNote };
  } finally { hold.resolve(); b.db.close(); }
});

async function saver({ active = 1, attendance = 'PRESENT', duringEditor } = {}) {
  const b = backend(); let writes = 0, readback = 'old final';
  try {
    b.seed('S1', { attendanceStatus: attendance, status: 'APPROVED', contentHash: b.calculateSha256('old final') });
    b.studentRepo.upsert({ classId: cid, studentId: 'S1', fullName: 'Audit S1', isActive: active });
    const loc = (selector = '') => locator({ count: async () => 1, isVisible: async () => true, isEnabled: async () => true,
      getAttribute: async () => selector.includes('data-student-id') ? 'S1' : 'active', innerText: async () => readback,
      locator: s => loc(s), click: async () => { if (selector.includes('has-text("Save")')) writes++; },
      evaluate: async (_fn, value) => { if (value !== undefined) { readback = value; if (duringEditor) await duringEditor(b); } return true; } });
    const page = { locator: s => loc(s), waitForTimeout: async () => {}, keyboard: { press: async () => {} }, screenshot: async () => {} };
    const { CommentSaver } = moduleAt('src/lib/playwright/save-comments.ts', ['CommentSaver'], { ...b, config: {}, BrowserManager: { getInstance: () => ({ getPage: async () => page }) },
      authService: { ensureAuthenticated: async () => {} }, LmsHelpers: { openClassDrawer: async () => {}, switchDrawerTab: async () => {} }, SELECTORS: { tabs: { comments: [] } }, jobLogRepo: { add() {} },
      createNetworkInterceptor: () => ({ dismissForbiddenToast: async () => {}, waitForApiResponse: async () => ({ status: () => 200, json: async () => ({ data: {} }) }) }) });
    const out = await CommentSaver.saveComments({ classId: cid, classCode: cid, sessionId: sid });
    return { writes, verified: out.verifiedCount, status: b.row().status, attendance: b.row().attendanceStatus, storedText: b.row().finalText, sentText: readback };
  } finally { b.db.close(); }
}
await check('R15-04', 'Inactive/absent/unknown students blocked before LMS Save', async () => {
  const control = await saver(); assert.equal(control.verified, 1); assert.equal(control.writes, 1);
  const blocked = [];
  for (const opt of [{ active: 0 }, { attendance: 'ABSENT' }, { attendance: 'UNKNOWN' }, { attendance: 'EXCUSED' }]) {
    const r = await saver(opt); assert.equal(r.verified, 0); assert.equal(r.writes, 0); assert.equal(r.status, 'DRAFT'); blocked.push(r);
  }
  return { control, blocked };
});

async function scrape(delay = 0, emptyWhileLoading = false, fullWorker = false) {
  const { ScoreScraper } = moduleAt('src/lib/playwright/scrape-scores.ts', ['ScoreScraper']);
  let index = 0, loading = false, timer;
  const empty = locator();
  const headers = locator({ count: async () => 2, nth: i => locator({ innerText: async () => i ? 'Homework 1' : 'Name' }) });
  const cells = () => locator({ count: async () => 2, nth: i => locator({ innerText: async () => i ? '0/100' : 'Audit page ' + index }) });
  const rows = locator({ count: async () => loading && emptyWhileLoading ? 0 : 1, nth: () => locator({ locator: () => locator({ locator: () => locator({ locator: cells }) }) }) });
  const next = locator({ count: async () => 1, isVisible: async () => true, isEnabled: async () => index === 0 && !loading,
    click: async () => { loading = true; if (delay) timer = setTimeout(() => { index = 1; loading = false; }, delay); else { index = 1; loading = false; } } });
  const grid = locator({ locator: s => s.includes('Homework') ? headers : s.includes('ExpandMoreIcon') ? rows : s.includes('next page') ? next : empty });
  try {
    if (fullWorker) {
      let writes = 0, cachedRows = 0;
      const roster = [{ studentId: 'S1', fullName: 'Audit page 0', isActive: 1 }, { studentId: 'S2', fullName: 'Audit page 1', isActive: 0 }];
      const cache = backend();
      for (const r of roster) cache.studentRepo.upsert({ ...r, classId: cid });
      cache.scoreMatrixRepo.save(cid, { success: true, classId: cid, columns: [{ columnId: 'OLD' }], rows: roster.map(r => ({ ...r, cells: { OLD: { columnId: 'OLD', status: 'GRADED', score: 80, maxScore: 100 } } })) });
      const cachedRowsBefore = cache.scoreMatrixRepo.findByClass(cid).matrix.rows.length;
      const page = { locator: () => grid, on() {}, off() {}, waitForTimeout: async () => {} };
      const { ScoreScraper: worker } = moduleAt('src/lib/playwright/scrape-scores.ts', ['ScoreScraper'], {
        BrowserManager: { getInstance: () => ({ getPage: async () => page }) }, authService: { ensureAuthenticated: async () => {} },
        LmsHelpers: { openClassDrawer: async () => {}, switchDrawerTab: async () => {} }, SELECTORS: { tabs: { grading: [] } },
        studentRepo: cache.studentRepo, scoreMatrixRepo: { ...cache.scoreMatrixRepo, save: (id, matrix) => { writes++; cache.scoreMatrixRepo.save(id, matrix); } },
        jobLogRepo: { add() {} }, createNetworkInterceptor: () => ({ dismissForbiddenToast: async () => {} }),
      });
      try {
        const result = await worker.scrapeClassScores(cid); cachedRows = cache.scoreMatrixRepo.findByClass(cid).matrix.rows.length;
        return { success: result.success, rows: result.rows.length, expectedRosterRows: roster.length, writes, cachedRowsBefore, cachedRows, index, loading, error: result.error };
      } finally { cache.db.close(); }
    }
    return { rows: (await ScoreScraper.scrapeFromDomGrid(grid, cid, new Map(), new Map(), s => s.toLowerCase())).rows.length, index, loading };
  }
  catch (e) { return { error: e.message, index, loading }; }
  finally { clearTimeout(timer); }
}
await check('R15-05', 'Original 100ms delayed transition yields both pages', async () => {
  const control = await scrape(), delayed = await scrape(100); assert.equal(control.rows, 2); assert.equal(delayed.rows, 2); return { control, delayed };
});
await check('R15-06', 'Abort-only, cancel-only, already-aborted streams release subscriptions', async () => {
  const logs = new Set(), statuses = new Set();
  const taskQueue = { getStatus: () => ({}), subscribeLogs: fn => { logs.add(fn); return () => logs.delete(fn); }, subscribeStatus: fn => { statuses.add(fn); return () => statuses.delete(fn); } };
  const { GET } = moduleAt('src/app/api/queue/stream/route.ts', ['GET'], { ...local, taskQueue, TextEncoder, ReadableStream });
  for (const mode of ['abort', 'cancel', 'both', 'pre-abort']) {
    for (let i = 0; i < 10; i++) {
      const abort = new AbortController(); if (mode === 'pre-abort') abort.abort();
      const res = await GET(new Request('http://127.0.0.1:3000/api/queue/stream', { headers: { host: '127.0.0.1:3000' }, signal: abort.signal }));
      assert.equal(res.status, 200); if (mode === 'abort' || mode === 'both') abort.abort();
      if (mode !== 'abort') await res.body.cancel(); assert.equal(logs.size, 0); assert.equal(statuses.size, 0);
    }
  }
  return { streams: 40, remainingLogs: logs.size, remainingStatus: statuses.size };
});
await check('R15-07', 'Topic, knowledge, note and tags contain no synthetic student names', async () => {
  const b = backend(); let prompt;
  try {
    b.seed('S1', { attendanceStatus: 'PRESENT' }); b.seed('S2', { attendanceStatus: 'ABSENT' });
    const generator = gen(b, async p => { prompt = p; return modelResult(); });
    await generator.generateBatchComments({ ...session, topic: 'Dự án của Audit S1 và Audit S2', keyKnowledge: ['Audit S1 thuyết trình cùng Audit S2'] }, [input({ quickTags: ['Audit S1 focused'], teacherNote: 'Audit S1 helped Audit S2' })]);
    assert(!prompt.includes('Audit S1')); assert(!prompt.includes('Audit S2')); assert(prompt.includes('STUDENT_01')); return { candidateAndAbsentPeerRedacted: true, externalCalls: 0 };
  } finally { b.db.close(); }
});

await check('R16-01', 'Slow pagination at 650ms must still collect both pages', async () => {
  const r = await scrape(650); expect(r.rows === 2, r, 'R15-05 still fails with 650ms pagination'); return r;
});
await check('R16-02', 'Loading placeholder must not be treated as end of pagination', async () => {
  const r = await scrape(100, true, true); expect(r.success === false || r.rows === 2, r, 'Empty loading page returned as successful incomplete matrix and overwrote cache'); return r;
});
await check('R16-03', 'Stale INSUFFICIENT_INFO request must preserve newer approved draft', async () => {
  const b = backend(); let calls = 0;
  try {
    b.seed('S1', { attendanceStatus: 'PRESENT', teacherNote: '', finalText: '' }); const oldVersion = version(b);
    await save(b, { teacherNote: 'LATEST TEACHER NOTE', finalText: 'LATEST APPROVED TEXT' }, '?cid=newpage&rev=2&f=teacherNote,finalText&fbase=teacherNote:0,finalText:0');
    const approved = await b.dispatch('/api/session-comments/approve', { body: JSON.stringify({ classId: cid, sessionId: sid, studentId: 'S1', approvedText: 'LATEST APPROVED TEXT', expectedRowVer: version(b) }) }); assert.equal(approved.status, 200);
    const before = b.row(); const generator = gen(b, async () => { calls++; return modelResult(); });
    const r = await generator.generateBatchComments(session, [input({ quickTags: [], teacherNote: '', expectedRowVer: oldVersion })]);
    const observed = { beforeText: before.finalText, beforeStatus: before.status, afterText: b.row().finalText, afterStatus: b.row().status, calls, result: r[0]?.status };
    expect(b.row().finalText === before.finalText && b.row().status === before.status, observed, 'Stale no-information branch erased newer approved content'); return observed;
  } finally { b.db.close(); }
});
await check('R16-04', 'Ignored edit in an already open page must show a conflict', async () => {
  const b = backend();
  try {
    b.seed('S1', { attendanceStatus: 'PRESENT' });
    const first = sc(b), second = sc(b);
    for (const h of [first, second]) { await h.flush(); h.api.setSelectedSessionId(sid); await h.flush(); }
    first.api.handleNoteChange('S1', 'FIRST PAGE SAVED'); await first.flush();
    second.api.handleNoteChange('S1', 'SECOND PAGE FIRST EDIT'); await second.flush();
    const afterFirstEdit = { storedNote: b.row().teacherNote, visibleNote: second.api.students[0].teacherNote, message: second.api.statusMessage };
    second.api.handleNoteChange('S1', 'SECOND PAGE SECOND EDIT'); await second.flush();
    const observed = { afterFirstEdit, afterSecondEdit: { storedNote: b.row().teacherNote, visibleNote: second.api.students[0].teacherNote } };
    expect(afterFirstEdit.storedNote === afterFirstEdit.visibleNote || afterFirstEdit.message?.type === 'error', observed, 'Ignored edit remains visible without a conflict warning; reload loses it'); return observed;
  } finally { b.db.close(); }
});
await check('R16-05', 'Eligibility change before LMS Save must prevent the outgoing write', async () => {
  const r = await saver({ duringEditor: async b => { await save(b, { attendanceStatus: 'ABSENT' }); } });
  expect(r.writes === 0, r, 'LMS Save was clicked after DB attendance became ABSENT'); return r;
});

await check('PHASE1-SCHEMA', 'Seven tables, scoped student keys and immutable submission owner', async () => {
  const b = backend();
  try {
    const tables = b.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all(); assert.equal(tables.length, 7); b.seed();
    b.studentRepo.upsert({ classId: 'OTHER', studentId: 'S1', fullName: 'Other synthetic', isActive: 1 }); assert.equal(b.studentRepo.findOne('S1', cid).fullName, 'Audit S1');
    const record = { classId: cid, sessionId: sid, studentId: 'S1', submissionId: 'AUDIT_SUB', parseStatus: 'PENDING', decision: 'GRADE', status: 'PENDING' };
    b.homeworkSubmissionRepo.upsert(record); assert.throws(() => b.homeworkSubmissionRepo.upsert({ ...record, studentId: 'S2' }), /Integrity Violation/); return { tables: tables.length, scopedStudent: true, immutableOwner: true };
  } finally { b.db.close(); }
});
await check('PHASE1-UPGRADE', 'Adding versionMetaJson preserves pre-existing feedback text', async () => {
  const b = backend();
  try {
    b.seed(); b.db.exec('ALTER TABLE session_feedbacks DROP COLUMN versionMetaJson');
    const fresh = moduleAt('src/lib/db/sqlite.ts', ['getDb', 'sessionFeedbackRepo'], {
      Database: function () { return b.db; }, crypto, path, process, fs: { existsSync: () => true }, assertPathAllowed: p => p,
    });
    fresh.getDb(); assert.equal(fresh.sessionFeedbackRepo.findOne(cid, sid, 'S1').finalText, 'old final');
    assert(b.db.prepare('PRAGMA table_info(session_feedbacks)').all().some(c => c.name === 'versionMetaJson'));
    return { columnAdded: true, existingFeedbackPreserved: true };
  } finally { b.db.close(); }
});
await check('PHASE2-QUEUE', 'Queue stays serial, cancels pending tasks and resumes', async () => {
  const { SequentialTaskQueue } = moduleAt('src/lib/queue/task-queue.ts', ['SequentialTaskQueue'], { EventEmitter, jobLogRepo: { add() {} } });
  const q = SequentialTaskQueue.getInstance(), hold = defer(); let running = 0, maxRunning = 0;
  const task = (id, wait = false) => ({ id, jobType: 'CUSTOM', description: id, execute: async () => { running++; maxRunning = Math.max(running, maxRunning); if (wait) await hold.promise; running--; return id; } });
  const first = q.enqueue(task('first', true)); const rest = ['second', 'third'].map(id => q.enqueue(task(id)).then(() => 'ran', e => e.message));
  q.stopQueue(); assert((await Promise.all(rest)).every(s => s.startsWith('TASK_CANCELLED'))); await assert.rejects(q.enqueue(task('stopped')), /QUEUE_STOPPED/);
  hold.resolve(); await first; await new Promise(r => setImmediate(r)); q.resumeQueue(); assert.equal(await q.enqueue(task('resumed')), 'resumed'); assert.equal(maxRunning, 1); return { maxRunning, cancelled: 2 };
});
await check('PHASE2-BROWSER', 'Concurrent initialization creates one persistent context', async () => {
  let launches = 0, newPages = 0, closed; const page = { isClosed: () => false }; let pages = [page];
  const context = { pages: () => pages, newPage: async () => { newPages++; pages = [page]; return page; }, on: (_e, fn) => { closed = fn; } };
  const { BrowserManager } = moduleAt('src/lib/playwright/browser-manager.ts', ['BrowserManager'], { path, process, fs: { existsSync: () => true }, config: {}, chromium: { launchPersistentContext: async () => { launches++; await new Promise(r => setImmediate(r)); return context; } } });
  const m = BrowserManager.getInstance(); await Promise.all(Array.from({ length: 8 }, () => m.getPage())); assert.equal(launches, 1);
  pages = []; await Promise.all(Array.from({ length: 8 }, () => m.getContext())); assert.equal(newPages, 1); closed(); await m.getPage(); assert.equal(launches, 2); return { initialLaunches: 1, recoveredTabs: 1, relaunched: true };
});
const summary = { generatedAt: new Date().toISOString(), passed: results.filter(r => r.pass).length, failed: results.filter(r => !r.pass).length, results };
fs.writeFileSync('docs/audits/round-16/independent-results.json', JSON.stringify(summary, null, 2) + '\n');
console.log('SUMMARY ' + JSON.stringify({ passed: summary.passed, failed: summary.failed })); process.exitCode = summary.failed ? 1 : 0;
