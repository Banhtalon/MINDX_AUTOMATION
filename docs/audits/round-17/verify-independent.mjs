// Independent acceptance tests. Real in-memory SQLite; synthetic students; no remote requests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import Database from 'better-sqlite3';
import * as XLSX from 'xlsx';
const fixtureSource = fs.readFileSync('docs/audits/round-12/verify-independent.mjs', 'utf8').split('\nawait check(')[0].replace(/^import .*;\r?$/gm, '');
const ctx = vm.createContext({ assert, fs, path, crypto, vm, stripTypeScriptTypes, Database, XLSX, Request, Response, URL, process, console, setTimeout, clearTimeout, setImmediate });
vm.runInContext(fixtureSource + '\nglobalThis.fixtures={backend,sc,ui,moduleAt,locator,cid,sid,local};', ctx);
const { backend, sc, ui, moduleAt, locator, cid, sid, local } = ctx.fixtures;
const results = [];
async function check(id, criterion, fn) {
  try { const observation = await fn(); results.push({ id, criterion, pass: true, observation }); console.log('PASS ' + id + ' ' + JSON.stringify(observation)); }
  catch (e) { results.push({ id, criterion, pass: false, error: e.stack, observation: e.observation }); console.log('FAIL ' + id + ': ' + e.message); }
}
function expect(condition, observation, message) { if (!condition) { const e = Error(message); e.observation = observation; throw e; } }
const session = { classId: cid, classCode: cid, sessionId: sid, sessionNumber: 1, topic: 'Synthetic lesson' };
const input = extra => ({ studentId: 'S1', fullName: 'Audit S1', attendanceStatus: 'PRESENT', quickTags: ['focused'], teacherNote: 'note', ...extra });
const modelResult = () => ({ response: { text: () => JSON.stringify({ feedbacks: [{ anonymousId: 'STUDENT_01', strengths: 'AI strength', improvements: 'AI improvement', actionPlan: 'AI action', formattedFullComment: 'AI RESULT' }] }) } });
const gen = (b, generateContent) => moduleAt('src/lib/gemini/comment-generator.ts', ['CommentGenerator'], { ...b, getGeminiModel: () => ({ generateContent }) }).CommentGenerator;
const version = b => JSON.parse(b.row().versionMetaJson).rowVer;
const save = async (b, patch) => {
  const res = await b.dispatch('/api/session-comments/save-draft', { body: JSON.stringify({ classId: cid, sessionId: sid, studentId: 'S1', ...patch }) });
  assert.equal(res.status, 200); return res.json();
};

for (const status of ['DRAFT', 'APPROVED', 'VERIFIED']) for (const tags of [false, true]) {
  await check('R16-03-zero-' + status + '-' + tags, 'Version zero is not permission to overwrite a newer row', async () => {
    const b = backend(); let calls = 0;
    try {
      b.seed('S1', { attendanceStatus: 'PRESENT', status, finalText: 'PRESERVED TEXT', contentHash: b.calculateSha256('PRESERVED TEXT'), verifiedAt: '2026-10-20T00:00:00Z' });
      const before = JSON.stringify(b.row());
      const r = await gen(b, async () => { calls++; return modelResult(); }).generateBatchComments(session, [input({ expectedRowVer: 0, quickTags: tags ? ['focused'] : [], teacherNote: '' })]);
      const obs = { calls, status: b.row().status, text: b.row().finalText, staleIgnored: r[0]?.staleIgnored };
      expect(before === JSON.stringify(b.row()) && calls === 0 && r[0]?.staleIgnored, obs, 'Stale zero-version request changed current row'); return obs;
    } finally { b.db.close(); }
  });
}

for (const status of ['APPROVED', 'VERIFIED']) for (const tags of [false, true]) {
  await check('R17-01-' + status + '-' + tags, 'Approved or verified row is protected before every AI write branch', async () => {
    const b = backend(); let calls = 0;
    try {
      b.seed('S1', { attendanceStatus: 'PRESENT', status, finalText: 'APPROVED TEACHER TEXT', contentHash: b.calculateSha256('APPROVED TEACHER TEXT'), verifiedAt: '2026-10-20T00:00:00Z' });
      const before = JSON.stringify(b.row());
      const r = await gen(b, async () => { calls++; return modelResult(); }).generateBatchComments(session, [input({ expectedRowVer: version(b), quickTags: tags ? ['focused'] : [], teacherNote: '' })]);
      const obs = { calls, initialStatus: status, tags, afterStatus: b.row().status, afterText: b.row().finalText, afterHash: b.row().contentHash, result: r[0]?.status };
      expect(before === JSON.stringify(b.row()) && calls === 0, obs, 'Normal AI branch replaced an already approved/verified comment'); return obs;
    } finally { b.db.close(); }
  });
}

await check('R17-02-insufficient-response', 'No-information response preserves the same existing draft that SQLite preserves', async () => {
  const b = backend(); let calls = 0;
  try {
    b.seed('S1', { attendanceStatus: 'PRESENT', quickTagsJson: '[]', teacherNote: '', finalText: 'TEACHER DRAFT TO PRESERVE' });
    const r = await gen(b, async () => { calls++; return modelResult(); }).generateBatchComments(session, [input({ expectedRowVer: version(b), quickTags: [], teacherNote: '' })]);
    const obs = { calls, storedText: b.row().finalText, returnedText: r[0].formattedFullComment, storedStrengths: b.row().strengths, returnedStrengths: r[0].strengths };
    expect(r[0].formattedFullComment === b.row().finalText && r[0].strengths === b.row().strengths, obs, 'API response replaces preserved teacher draft with a no-information notice'); return obs;
  } finally { b.db.close(); }
});

await check('R17-02-ui', 'Actual page retains all prior comment sections after no-information generation', async () => {
  const b = backend();
  try {
    b.seed('S1', { attendanceStatus: 'PRESENT', quickTagsJson: '[]', teacherNote: '', finalText: 'TEACHER DRAFT TO PRESERVE' });
    const generator = gen(b, async () => { throw Error('No-information must not call AI'); });
    const h = sc(b, async (url, opts) => {
      if (!url.includes('/generate-ai')) return b.dispatch(url, opts);
      const body = JSON.parse(opts.body); return Response.json({ success: true, data: await generator.generateBatchComments(body.session, body.students) });
    });
    await h.flush(); h.api.setSelectedSessionId(sid); await h.flush();
    await h.api.handleGenerateAi(); await h.flush();
    const afterGenerate = { visibleText: h.api.students[0].finalText, storedText: b.row().finalText, visibleImprovement: h.api.students[0].improvements, storedImprovement: b.row().improvements };
    const obs = { afterGenerate, status: h.api.students[0].status, storedTextPreserved: b.row().finalText === 'TEACHER DRAFT TO PRESERVE' };
    expect(afterGenerate.visibleText === afterGenerate.storedText && afterGenerate.visibleImprovement === afterGenerate.storedImprovement, obs, 'Page replaced preserved content and sections with the no-information result'); return obs;
  } finally { b.db.close(); }
});

async function scrapeNetwork(complete) {
  const b = backend(); let responseListener, emitted = false, writes = 0;
  try {
    const roster = [{ studentId: 'S1', fullName: 'Audit S1', isActive: 1 }, { studentId: 'S2', fullName: 'Audit S2', isActive: 0 }];
    for (const st of roster) b.studentRepo.upsert({ ...st, classId: cid });
    b.scoreMatrixRepo.save(cid, { success: true, classId: cid, columns: [{ columnId: 'OLD' }], rows: roster.map(st => ({ ...st, cells: { OLD: { columnId: 'OLD', status: 'GRADED', score: 80, maxScore: 100 } } })) });
    const before = JSON.stringify(b.scoreMatrixRepo.findByClass(cid));
    const page = { locator: () => locator(), on: (_e, f) => { responseListener = f; }, off() {}, waitForTimeout: async () => {
      if (emitted) return; emitted = true;
      await responseListener({ url: () => 'https://lms-api.mindx.edu.vn/', status: () => 200, request: () => ({ method: () => 'POST', postDataJSON: () => ({ operationName: 'FindStudentSubmissionByClass', variables: { payload: { classId: cid } } }) }),
        json: async () => ({ data: { findStudentSubmissionByClass: { classCode: cid, lessons: [{ id: 'L1', name: 'Homework 1', displayOrder: 1 }], students: (complete ? roster : roster.slice(0, 1)).map(st => ({ studentUid: st.studentId, displayName: st.fullName })), submissions: [] } } }) });
    } };
    const worker = moduleAt('src/lib/playwright/scrape-scores.ts', ['ScoreScraper'], {
      BrowserManager: { getInstance: () => ({ getPage: async () => page }) }, authService: { ensureAuthenticated: async () => {} },
      LmsHelpers: { openClassDrawer: async () => {}, switchDrawerTab: async () => {} }, SELECTORS: { tabs: { grading: [] } }, studentRepo: b.studentRepo,
      scoreMatrixRepo: { ...b.scoreMatrixRepo, save: (id, value) => { writes++; b.scoreMatrixRepo.save(id, value); } }, jobLogRepo: { add() {} }, createNetworkInterceptor: () => ({ dismissForbiddenToast: async () => {} }),
    }).ScoreScraper;
    const result = await worker.scrapeClassScores(cid), cached = b.scoreMatrixRepo.findByClass(cid);
    return { success: result.success, rows: result.rows.length, writes, cachedRows: cached.matrix.rows.length, cacheUnchanged: JSON.stringify(cached) === before, rosterRows: roster.length, error: result.error };
  } finally { b.db.close(); }
}
await check('R17-03-complete-control', 'Complete network roster remains supported', async () => { const r = await scrapeNetwork(true); assert.equal(r.success, true); assert.equal(r.rows, 2); return r; });
await check('R17-03-partial-network', 'Missing inactive student in GraphQL must preserve complete cache', async () => { const r = await scrapeNetwork(false); expect(!r.success && r.writes === 0 && r.cacheUnchanged, r, 'Network path overwrote two-student cache with one-student matrix'); return r; });

async function saver(change, stage = 'editor', attendance = 'PRESENT') {
  const b = backend(); let writes = 0, readback = 'old final', changed = false;
  try {
    b.seed('S1', { attendanceStatus: attendance, status: 'APPROVED', contentHash: b.calculateSha256('old final') });
    const mutate = async () => { if (!changed && change) { changed = true; await change(b); } };
    const loc = (selector = '') => locator({ count: async () => 1, isVisible: async () => true, isEnabled: async () => true,
      getAttribute: async () => selector.includes('data-student-id') ? 'S1' : 'active', innerText: async () => readback, locator: s => loc(s),
      click: async () => { if (selector.includes('has-text("Save")')) { writes++; if (stage === 'after-click') await mutate(); } },
      evaluate: async (_fn, value) => { if (value !== undefined) { readback = value; if (stage === 'editor') await mutate(); } return true; } });
    const page = { locator: s => loc(s), waitForTimeout: async () => {}, keyboard: { press: async () => {} }, screenshot: async () => {} };
    const worker = moduleAt('src/lib/playwright/save-comments.ts', ['CommentSaver'], { ...b, config: {}, BrowserManager: { getInstance: () => ({ getPage: async () => page }) }, authService: { ensureAuthenticated: async () => {} },
      LmsHelpers: { openClassDrawer: async () => {}, switchDrawerTab: async () => {} }, SELECTORS: { tabs: { comments: [] } }, jobLogRepo: { add() {} },
      createNetworkInterceptor: () => ({ dismissForbiddenToast: async () => { if (stage === 'toast' && b.row().status === 'SAVING') await mutate(); }, waitForApiResponse: async () => ({ status: () => 200, json: async () => ({ data: {} }) }) }) }).CommentSaver;
    const out = await worker.saveComments({ classId: cid, classCode: cid, sessionId: sid });
    return { writes, verified: out.verifiedCount, status: b.row().status, text: b.row().finalText, attendance: b.row().attendanceStatus, changed };
  } finally { b.db.close(); }
}
for (const attendance of ['PRESENT', 'LATE']) await check('R16-05-control-' + attendance, 'Eligible approved comment saves normally', async () => { const r = await saver(null, 'editor', attendance); assert.equal(r.writes, 1); assert.equal(r.verified, 1); return r; });
const changes = {
  absent: b => save(b, { attendanceStatus: 'ABSENT' }), unknown: b => save(b, { attendanceStatus: 'UNKNOWN' }),
  inactive: b => b.studentRepo.upsert({ classId: cid, studentId: 'S1', fullName: 'Audit S1', isActive: 0 }),
  text: b => save(b, { finalText: 'LATEST DRAFT' }), note: b => save(b, { teacherNote: 'NEW NOTE' }),
};
for (const stage of ['editor', 'toast']) for (const [name, change] of Object.entries(changes)) await check('R16-05-' + stage + '-' + name, 'Drift blocks outgoing Save and preserves DRAFT', async () => {
  const r = await saver(change, stage); expect(r.writes === 0 && r.verified === 0 && r.status === 'DRAFT', r, 'Pre-click drift was not blocked safely'); return r;
});
await check('R16-05-after-click', 'Post-write drift must still prevent VERIFIED', async () => { const r = await saver(changes.absent, 'after-click'); assert.equal(r.writes, 1); assert.equal(r.verified, 0); assert.equal(r.status, 'DRAFT'); return r; });

await check('R16-04-detail', 'Conflict returns false, retains input, reads correct scope and shows stored value', async () => {
  const b = backend(), reads = [];
  try {
    b.seed('S1', { attendanceStatus: 'PRESENT' });
    const first = sc(b), second = ui('src/app/session-comments/page.tsx', 'SessionCommentsPage', 'students,setSelectedSessionId,saveDraftToServer,statusMessage', async (url, opts) => { if (url.includes('/list')) reads.push(url); return b.dispatch(url, opts); });
    for (const h of [first, second]) { await h.flush(); h.api.setSelectedSessionId(sid); await h.flush(); }
    first.api.handleNoteChange('S1', 'FIRST TAB SAVED NOTE'); await first.flush();
    const ok = await second.api.saveDraftToServer('S1', { teacherNote: 'SECOND TAB UNSAVED NOTE' }); await second.flush();
    const obs = { ok, storedNote: b.row().teacherNote, visibleNote: second.api.students[0].teacherNote, message: second.api.statusMessage, reread: reads.at(-1) };
    expect(ok === false && obs.storedNote === 'FIRST TAB SAVED NOTE' && obs.visibleNote === 'SECOND TAB UNSAVED NOTE' && obs.message?.type === 'error' && obs.message.text.includes('FIRST TAB SAVED NOTE') && obs.reread.includes('classId=' + cid) && obs.reread.includes('sessionId=' + sid), obs, 'Conflict feedback incomplete'); return obs;
  } finally { b.db.close(); }
});

await check('R17-04-tags-conflict', 'Quick-tag conflict shows the actual stored tags for comparison', async () => {
  const b = backend();
  try {
    b.seed('S1', { attendanceStatus: 'PRESENT' });
    const first = sc(b), second = sc(b);
    for (const h of [first, second]) { await h.flush(); h.api.setSelectedSessionId(sid); await h.flush(); }
    first.api.toggleQuickTag('S1', 'SAVED_TAG_A'); await first.flush();
    second.api.toggleQuickTag('S1', 'UNSAVED_TAG_B'); await second.flush();
    const obs = { storedTags: b.row().quickTagsJson, visibleTags: second.api.students[0].quickTags, message: second.api.statusMessage };
    expect(obs.message?.type === 'error' && obs.message.text.includes('SAVED_TAG_A'), obs, 'Tag conflict displays attendance instead of stored quick tags'); return obs;
  } finally { b.db.close(); }
});

async function domScrape({ delay = 0, emptyLoading = false, missingNext = false, emptyFinal = false, stalled = false } = {}) {
  const b = backend(); let index = 0, loading = false, timer, writes = 0;
  try {
    const roster = [{ studentId: 'S1', fullName: 'Audit page 0', isActive: 1 }, { studentId: 'S2', fullName: 'Audit page 1', isActive: 0 }];
    for (const st of roster) b.studentRepo.upsert({ ...st, classId: cid });
    b.scoreMatrixRepo.save(cid, { success: true, classId: cid, columns: [{ columnId: 'OLD' }], rows: roster.map(st => ({ ...st, cells: { OLD: { columnId: 'OLD', status: 'GRADED', score: 80, maxScore: 100 } } })) });
    const before = JSON.stringify(b.scoreMatrixRepo.findByClass(cid)), empty = locator();
    const headers = locator({ count: async () => 2, nth: i => locator({ innerText: async () => i ? 'Homework 1' : 'Name' }) });
    const cells = () => locator({ count: async () => 2, nth: i => locator({ innerText: async () => i ? '0/100' : 'Audit page ' + index }) });
    const rows = locator({ count: async () => (loading && emptyLoading) || (index === 1 && emptyFinal) ? 0 : 1,
      nth: () => locator({ locator: () => locator({ locator: () => locator({ locator: cells }) }) }) });
    const next = locator({ count: async () => missingNext ? 0 : 1, isVisible: async () => true, isEnabled: async () => index === 0 && !loading,
      click: async () => { loading = true; if (!stalled) timer = setTimeout(() => { index = 1; loading = false; }, delay); } });
    const grid = locator({ locator: s => s.includes('Homework') ? headers : s.includes('ExpandMoreIcon') ? rows : s.includes('next page') ? next : empty });
    const worker = moduleAt('src/lib/playwright/scrape-scores.ts', ['ScoreScraper'], {
      BrowserManager: { getInstance: () => ({ getPage: async () => ({ locator: () => grid, on() {}, off() {}, waitForTimeout: async () => {} }) }) }, authService: { ensureAuthenticated: async () => {} },
      LmsHelpers: { openClassDrawer: async () => {}, switchDrawerTab: async () => {} }, SELECTORS: { tabs: { grading: [] } }, studentRepo: b.studentRepo,
      scoreMatrixRepo: { ...b.scoreMatrixRepo, save: (id, value) => { writes++; b.scoreMatrixRepo.save(id, value); } }, jobLogRepo: { add() {} }, createNetworkInterceptor: () => ({ dismissForbiddenToast: async () => {} }),
    }).ScoreScraper;
    const out = await worker.scrapeClassScores(cid), cached = b.scoreMatrixRepo.findByClass(cid);
    return { success: out.success, rows: out.rows.length, writes, cacheUnchanged: JSON.stringify(cached) === before, cachedRows: cached.matrix.rows.length, error: out.error };
  } finally { clearTimeout(timer); b.db.close(); }
}
for (const delay of [0, 100, 650]) for (const emptyLoading of [false, true]) await check('R16-01-02-DOM-' + delay + '-' + emptyLoading, 'Full DOM worker collects active and inactive students', async () => {
  const r = await domScrape({ delay, emptyLoading }); expect(r.success && r.rows === 2 && r.cachedRows === 2 && r.writes === 1, r, 'Incomplete DOM scrape'); return r;
});
for (const opt of [{ missingNext: true }, { emptyFinal: true }, { stalled: true }]) await check('R16-02-preserve-' + Object.keys(opt)[0], 'Incomplete or stalled DOM pagination preserves cache byte for byte', async () => {
  const r = await domScrape(opt); expect(!r.success && r.writes === 0 && r.cacheUnchanged, r, 'Incomplete DOM scan overwrote complete cache'); return r;
});

const summary = { generatedAt: new Date().toISOString(), passed: results.filter(r => r.pass).length, failed: results.filter(r => !r.pass).length, results };
fs.writeFileSync('docs/audits/round-17/independent-results.json', JSON.stringify(summary, null, 2) + '\n');
console.log('SUMMARY ' + JSON.stringify({ passed: summary.passed, failed: summary.failed }));
process.exitCode = summary.failed ? 1 : 0;
