// New Round 15 assertions against current product code. Synthetic data only.
// Run: node docs/audits/round-15/verify-independent.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import EventEmitter from 'node:events';
import { stripTypeScriptTypes } from 'node:module';
import Database from 'better-sqlite3';
import * as XLSX from 'xlsx';

// Reuse fixture construction only. No historical assertions are executed here.
const fixtureSource = fs.readFileSync('docs/audits/round-12/verify-independent.mjs', 'utf8')
  .split('\nawait check(')[0].replace(/^import .*;\r?$/gm, '');
const ctx = vm.createContext({ assert, fs, path, crypto, vm, stripTypeScriptTypes,
  Database, XLSX, Request, Response, URL, process, console, setTimeout, clearTimeout, setImmediate });
vm.runInContext(fixtureSource + '\nglobalThis.fixtures={backend,sc,moduleAt,locator,cid,sid,local};', ctx);
const { backend, sc, moduleAt, locator, cid, sid, local } = ctx.fixtures;
const results = [];
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function check(id, kind, fn) {
  try { const observation = await fn(); results.push({ id, kind, reproducedOrPassed: true, observation }); console.log(kind + ' ' + id + ' ' + JSON.stringify(observation)); }
  catch (error) { results.push({ id, kind, reproducedOrPassed: false, error: error.stack }); console.log('ERROR ' + id + ': ' + error.message); }
}
const modelResult = () => ({ response: { text: () => JSON.stringify({ feedbacks: [{
  anonymousId: 'STUDENT_01', strengths: 'AI strength', improvements: 'AI improvement',
  actionPlan: 'AI action', formattedFullComment: 'AI RESULT FROM OLD INPUT',
}] }) } });
const session = { classId: cid, classCode: cid, sessionId: sid, sessionNumber: 1, topic: 'Synthetic lesson' };

await check('R15-01', 'CONFIRMED_BUG', async () => {
  const b = backend(), hold = defer();
  try {
    b.seed('S1', { attendanceStatus: 'PRESENT' });
    const h = sc(b, async (url, opts) => { if (url.includes('/approve')) await hold.promise; return b.dispatch(url, opts); });
    await h.flush(); h.api.setSelectedSessionId(sid); await h.flush();
    const pending = h.api.handleApprove('S1'); await h.flush();
    h.api.handleTextEdit('S1', 'finalText', 'LATEST TEACHER TEXT'); await h.flush();
    assert.equal(b.row().finalText, 'LATEST TEACHER TEXT');
    hold.resolve(); const approvedOnUi = await pending; await h.flush();
    assert.equal(approvedOnUi, false); assert.equal(h.api.students[0].status, 'DRAFT');
    assert.equal(b.row().finalText, 'old final'); assert.equal(b.row().status, 'APPROVED');
    return { uiText: h.api.students[0].finalText, uiStatus: h.api.students[0].status,
      storedText: b.row().finalText, storedStatus: b.row().status, hashMatchesOldText: b.row().contentHash === b.calculateSha256('old final') };
  } finally { hold.resolve(); b.db.close(); }
});

await check('R15-02', 'CONFIRMED_BUG', async () => {
  const b = backend(), hold = defer();
  try {
    b.seed('S1', { attendanceStatus: 'PRESENT' });
    const { CommentGenerator } = moduleAt('src/lib/gemini/comment-generator.ts', ['CommentGenerator'], {
      ...b, getGeminiModel: () => ({ generateContent: async () => { await hold.promise; return modelResult(); } }),
    });
    const h = sc(b, async (url, opts) => {
      if (!url.includes('/generate-ai')) return b.dispatch(url, opts);
      const body = JSON.parse(opts.body);
      return Response.json({ success: true, data: await CommentGenerator.generateBatchComments(body.session, body.students) });
    });
    await h.flush(); h.api.setSelectedSessionId(sid); await h.flush();
    const pending = h.api.handleGenerateAi(); await h.flush();
    h.api.handleNoteChange('S1', 'LATEST TEACHER NOTE');
    h.api.handleTextEdit('S1', 'finalText', 'LATEST TEACHER TEXT');
    h.api.handleAttendanceChange('S1', 'ABSENT'); await h.flush();
    assert.equal(b.row().attendanceStatus, 'ABSENT'); assert.equal(b.row().finalText, 'LATEST TEACHER TEXT');
    hold.resolve(); await pending; await h.flush();
    assert.equal(b.row().teacherNote, 'old S1'); assert.equal(b.row().attendanceStatus, 'PRESENT');
    assert.equal(b.row().finalText, 'AI RESULT FROM OLD INPUT');
    assert.equal(h.api.students[0].finalText, 'AI RESULT FROM OLD INPUT');
    return { storedNote: b.row().teacherNote, storedAttendance: b.row().attendanceStatus,
      storedText: b.row().finalText, uiAttendance: h.api.students[0].attendanceStatus, uiNote: h.api.students[0].teacherNote };
  } finally { hold.resolve(); b.db.close(); }
});

await check('R15-03', 'CONFIRMED_BUG', async () => {
  const b = backend(), hold = defer(), urls = [];
  try {
    b.seed('S1', { attendanceStatus: 'PRESENT' });
    const first = sc(b, async (url, opts) => { if (opts?.body) { urls.push(url); await hold.promise; } return b.dispatch(url, opts); });
    await first.flush(); first.api.setSelectedSessionId(sid); await first.flush();
    first.api.handleNoteChange('S1', 'OLDER PAGE EDIT'); await first.flush();
    const second = sc(b, (url, opts) => { if (opts?.body) urls.push(url); return b.dispatch(url, opts); });
    await second.flush(); second.api.setSelectedSessionId(sid); await second.flush();
    second.api.handleNoteChange('S1', 'LATEST NEW PAGE EDIT'); await second.flush();
    assert.equal(b.row().teacherNote, 'LATEST NEW PAGE EDIT');
    const clients = urls.map(u => new URL('http://127.0.0.1:3000' + u).searchParams.get('cid'));
    assert.notEqual(clients[0], clients[1]);
    hold.resolve(); await first.flush(); await second.flush();
    assert.equal(b.row().teacherNote, 'OLDER PAGE EDIT');
    await second.api.loadClassData(cid, sid); await second.flush();
    assert.equal(second.api.students[0].teacherNote, 'OLDER PAGE EDIT');
    return { distinctPageInstances: clients[0] !== clients[1], storedAndReloaded: b.row().teacherNote };
  } finally { hold.resolve(); b.db.close(); }
});

async function runSaveAfterRosterChange(isActive, attendanceStatus) {
  const b = backend();
  try {
    b.seed('S1', { attendanceStatus, status: 'APPROVED', contentHash: b.calculateSha256('old final') });
    b.studentRepo.upsert({ classId: cid, studentId: 'S1', fullName: 'Audit S1', isActive });
    const loc = () => locator({ count: async () => 1, isVisible: async () => true, isEnabled: async () => true,
      getAttribute: async () => 'active', innerText: async () => b.row().finalText, locator: () => loc(), evaluate: async () => true });
    const page = { locator: () => loc(), waitForTimeout: async () => {}, keyboard: { press: async () => {} }, screenshot: async () => {} };
    const { CommentSaver } = moduleAt('src/lib/playwright/save-comments.ts', ['CommentSaver'], {
      ...b, config: {}, BrowserManager: { getInstance: () => ({ getPage: async () => page }) },
      authService: { ensureAuthenticated: async () => {} }, LmsHelpers: { openClassDrawer: async () => {}, switchDrawerTab: async () => {} },
      SELECTORS: { tabs: { comments: [] } }, jobLogRepo: { add() {} },
      createNetworkInterceptor: () => ({ dismissForbiddenToast: async () => {}, waitForApiResponse: async () => ({ status: () => 200, json: async () => ({ data: {} }) }) }),
    });
    const out = await CommentSaver.saveComments({ classId: cid, classCode: cid, sessionId: sid });
    return { isActive, attendanceStatus, verified: out.verifiedCount, storedStatus: b.row().status };
  } finally { b.db.close(); }
}
await check('R15-04', 'CONFIRMED_BUG', async () => {
  const control = await runSaveAfterRosterChange(1, 'PRESENT'); assert.equal(control.verified, 1);
  // Real flow: approve while active, then sync updates the student's active flag.
  const inactive = await runSaveAfterRosterChange(0, 'PRESENT');
  assert.equal(inactive.verified, 1); assert.equal(inactive.storedStatus, 'VERIFIED');
  return { control, inactive };
});

await check('R15-05', 'CONFIRMED_BUG', async () => {
  const { ScoreScraper } = moduleAt('src/lib/playwright/scrape-scores.ts', ['ScoreScraper']);
  async function scrape(delay) {
    let page = 0, timer;
    const empty = locator();
    const headers = locator({ count: async () => 2, nth: i => locator({ innerText: async () => i ? 'Homework 1' : 'Name' }) });
    const cells = () => locator({ count: async () => 2, nth: i => locator({ innerText: async () => i ? '0/100' : 'Audit page ' + page }) });
    const rows = locator({ count: async () => 1, nth: () => locator({ locator: () => locator({ locator: () => locator({ locator: cells }) }) }) });
    const next = locator({ count: async () => 1, isVisible: async () => true, isEnabled: async () => page === 0,
      click: async () => { if (delay) timer = setTimeout(() => { page = 1; }, delay); else page = 1; } });
    const grid = locator({ locator: s => s.includes('Homework') ? headers : s.includes('ExpandMoreIcon') ? rows : s.includes('next page') ? next : empty });
    try { return { rows: (await ScoreScraper.scrapeFromDomGrid(grid, cid, new Map(), new Map(), s => s.toLowerCase())).rows.length }; }
    catch (error) { return { error: error.message, pageWhenFailed: page }; }
    finally { clearTimeout(timer); }
  }
  const control = await scrape(0), delayed = await scrape(100);
  assert.equal(control.rows, 2); assert.match(delayed.error, /trùng lặp|mơ hồ/); assert.equal(delayed.pageWhenFailed, 0);
  return { control, delayed };
});

await check('R15-06', 'CONFIRMED_BUG', async () => {
  const logs = new Set(), statuses = new Set();
  const taskQueue = { getStatus: () => ({}), subscribeLogs: fn => { logs.add(fn); return () => logs.delete(fn); },
    subscribeStatus: fn => { statuses.add(fn); return () => statuses.delete(fn); } };
  const { GET } = moduleAt('src/app/api/queue/stream/route.ts', ['GET'], { ...local, taskQueue, TextEncoder, ReadableStream });
  for (let i = 0; i < 3; i++) {
    const abort = new AbortController();
    const res = await GET(new Request('http://127.0.0.1:3000/api/queue/stream', { headers: { host: '127.0.0.1:3000' }, signal: abort.signal }));
    assert.equal(res.status, 200); abort.abort(); await res.body.cancel();
  }
  assert.equal(logs.size, 3); assert.equal(statuses.size, 3);
  return { closedStreams: 3, remainingLogSubscriptions: logs.size, remainingStatusSubscriptions: statuses.size };
});

await check('R15-07', 'CONFIRMED_BUG', async () => {
  const b = backend(); let prompt;
  try {
    b.seed('S1', { attendanceStatus: 'PRESENT' });
    const { CommentGenerator } = moduleAt('src/lib/gemini/comment-generator.ts', ['CommentGenerator'], {
      ...b, getGeminiModel: () => ({ generateContent: async p => { prompt = p; return modelResult(); } }),
    });
    await CommentGenerator.generateBatchComments({ ...session, topic: 'Dự án của Audit S1', keyKnowledge: ['Audit S1 thuyết trình'] }, [
      { studentId: 'S1', fullName: 'Audit S1', attendanceStatus: 'PRESENT', quickTags: ['Audit S1 focused'], teacherNote: 'Audit S1 worked well' },
    ]);
    assert(prompt.includes('- Chủ đề bài học: Dự án của Audit S1'));
    assert(prompt.includes('- Kiến thức trọng tâm: Audit S1 thuyết trình'));
    assert(!prompt.includes('Audit S1 worked well')); assert(!prompt.includes('Audit S1 focused'));
    return { syntheticStudentNameVisibleInTopic: true, visibleInKeyKnowledge: true, noteAndTagRedacted: true, externalApiCalls: 0 };
  } finally { b.db.close(); }
});

await check('PHASE1-SCHEMA', 'BASELINE_PASS', async () => {
  const b = backend();
  try {
    const tables = b.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    assert.equal(tables.length, 7); b.seed('S1');
    b.studentRepo.upsert({ classId: 'OTHER', studentId: 'S1', fullName: 'Other fake student', isActive: 1 });
    assert.equal(b.studentRepo.findOne('S1', cid).fullName, 'Audit S1');
    const record = { classId: cid, sessionId: sid, studentId: 'S1', submissionId: 'AUDIT_SUB', parseStatus: 'PENDING', decision: 'GRADE', status: 'PENDING' };
    b.homeworkSubmissionRepo.upsert(record);
    assert.throws(() => b.homeworkSubmissionRepo.upsert({ ...record, studentId: 'S2' }), /Integrity Violation/);
    return { tables: tables.length, compositeStudentKey: true, submissionReassignmentBlocked: true };
  } finally { b.db.close(); }
});

await check('PHASE2-QUEUE', 'BASELINE_PASS', async () => {
  const { SequentialTaskQueue } = moduleAt('src/lib/queue/task-queue.ts', ['SequentialTaskQueue'], { EventEmitter, jobLogRepo: { add() {} } });
  const q = SequentialTaskQueue.getInstance(), hold = defer(); let running = 0, maxRunning = 0;
  const task = (id, wait = false) => ({ id, jobType: 'CUSTOM', description: id, execute: async () => {
    running++; maxRunning = Math.max(maxRunning, running); if (wait) await hold.promise; running--; return id;
  } });
  const first = q.enqueue(task('first', true));
  const pending = [q.enqueue(task('second')), q.enqueue(task('third'))].map(p => p.then(() => 'ran', e => e.message));
  q.stopQueue(); const cancelled = await Promise.all(pending);
  assert(cancelled.every(s => s.startsWith('TASK_CANCELLED')));
  await assert.rejects(q.enqueue(task('stopped')), /QUEUE_STOPPED/);
  hold.resolve(); await first; await new Promise(r => setImmediate(r));
  q.resumeQueue(); assert.equal(await q.enqueue(task('resumed')), 'resumed'); assert.equal(maxRunning, 1);
  return { maxConcurrentTasks: maxRunning, cancelledPendingTasks: cancelled.length, resumed: true };
});

await check('PHASE2-BROWSER', 'BASELINE_PASS', async () => {
  let launches = 0, newPages = 0, closeCallback, pages = [{}];
  const fakePage = { isClosed: () => false }; pages = [fakePage];
  const context = { pages: () => pages, newPage: async () => { newPages++; pages = [fakePage]; return fakePage; }, on: (_event, fn) => { closeCallback = fn; } };
  const { BrowserManager } = moduleAt('src/lib/playwright/browser-manager.ts', ['BrowserManager'], {
    path, process, fs: { existsSync: () => true }, config: { headlessMode: true },
    chromium: { launchPersistentContext: async () => { launches++; await new Promise(r => setImmediate(r)); return context; } },
  });
  const manager = BrowserManager.getInstance();
  await Promise.all(Array.from({ length: 8 }, () => manager.getPage())); assert.equal(launches, 1);
  pages = []; await Promise.all(Array.from({ length: 8 }, () => manager.getContext())); assert.equal(newPages, 1);
  closeCallback(); await manager.getPage(); assert.equal(launches, 2);
  return { initialConcurrentCalls: 8, initialLaunches: 1, emptyContextRecoveredWithOneTab: true, relaunchedAfterClose: true };
});

const summary = { generatedAt: new Date().toISOString(), confirmedBugs: results.filter(r => r.kind === 'CONFIRMED_BUG' && r.reproducedOrPassed).length,
  baselinePassed: results.filter(r => r.kind === 'BASELINE_PASS' && r.reproducedOrPassed).length,
  executionErrors: results.filter(r => !r.reproducedOrPassed).length, results };
fs.writeFileSync('docs/audits/round-15/independent-results.json', JSON.stringify(summary, null, 2) + '\n');
console.log('SUMMARY ' + JSON.stringify({ confirmedBugs: summary.confirmedBugs, baselinePassed: summary.baselinePassed, executionErrors: summary.executionErrors }));
process.exitCode = summary.executionErrors ? 1 : 0;
