// Run from the repository root: node docs/audits/round-13/verify-independent.mjs
// Round 13 assertions are new. Only the synthetic fixtures (not assertions) are
// reused from the independent Round 12 auditor. Product code is read at runtime.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import Database from 'better-sqlite3';
import * as XLSX from 'xlsx';

const fixtureSource = fs.readFileSync('docs/audits/round-12/verify-independent.mjs', 'utf8')
  .split('\nawait check(')[0].replace(/^import .*;\r?$/gm, '');
assert(!fixtureSource.includes('await check('), 'Do not reuse old test assertions');
const fixtureContext = vm.createContext({
  assert, fs, path, crypto, vm, stripTypeScriptTypes, Database, XLSX,
  Request, Response, URL, process, console, setTimeout, clearTimeout, setImmediate,
});
vm.runInContext(fixtureSource + '\nglobalThis.fixtures={backend,sc,local,cid,sid};', fixtureContext);
const { backend, sc, local, cid, sid } = fixtureContext.fixtures;
const results = [];
const observations = [];
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const plain = value => JSON.parse(JSON.stringify(value));
async function check(name, fn) {
  try { await fn(); results.push({ name, pass: true }); console.log('PASS ' + name); }
  catch (e) { results.push({ name, pass: false, error: e.stack }); console.log('FAIL ' + name + ': ' + e.message); }
}
const readField = (row, field) => field === 'quickTags' ? JSON.parse(row.quickTagsJson) : row[field];
function edit(h, field, newer) {
  if (field === 'teacherNote') return h.api.handleNoteChange('S1', newer ? '' : 'OLDER NOTE');
  if (field === 'quickTags') return h.api.toggleQuickTag('S1', 'audit tag'); // add, then clear
  if (field === 'attendanceStatus') return h.api.handleAttendanceChange('S1', newer ? 'LATE' : 'PRESENT');
  return h.api.handleTextEdit('S1', field, newer ? 'LATEST ' + field : 'OLDER ' + field);
}
const expected = field => field === 'teacherNote' ? '' : field === 'quickTags' ? [] : field === 'attendanceStatus' ? 'LATE' : 'LATEST ' + field;
const fields = ['teacherNote', 'quickTags', 'attendanceStatus', 'strengths', 'improvements', 'actionPlan', 'finalText'];

for (const field of fields) for (const initialStatus of ['DRAFT', 'APPROVED', 'VERIFIED']) {
  for (const order of ['older-request-last', 'older-response-last']) {
    await check(`R12-01 / ${field} / ${initialStatus} / ${order}`, async () => {
      const b = backend(); const hold = defer();
      try {
        b.seed('S1', { status: initialStatus, attendanceStatus: 'PRESENT', contentHash: b.calculateSha256('old final') });
        const requests = [], responses = [];
        const h = sc(b, async (url, opts) => {
          if (!opts?.body) return b.dispatch(url, opts);
          const index = requests.length;
          requests.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
          if (index === 0 && order === 'older-request-last') await hold.promise;
          // Unlike the older fixture dispatcher, preserve actual UI headers too.
          const res = await b.save(new Request('http://127.0.0.1:3000' + url, {
            method: 'POST', headers: { host: '127.0.0.1:3000', ...opts.headers }, body: opts.body,
          }));
          const data = await res.clone().json();
          if (index === 0 && order === 'older-response-last') await hold.promise;
          responses.push({ index, status: res.status, data });
          return res;
        });
        await h.flush(); h.api.setSelectedSessionId(sid); await h.flush();
        // Intentionally no render between the two teacher actions.
        const first = edit(h, field, false);
        const second = edit(h, field, true);
        await second; await h.flush();
        assert.deepEqual(plain(readField(b.row(), field)), expected(field), 'newer edit must reach SQLite first');
        assert.equal(requests.length, 2);
        const urls = requests.map(r => new URL('http://127.0.0.1:3000' + r.url));
        assert.equal(urls[0].searchParams.get('cid'), urls[1].searchParams.get('cid'));
        assert(Number(urls[1].searchParams.get('rev')) > Number(urls[0].searchParams.get('rev')));
        for (const r of requests) {
          const u = new URL('http://127.0.0.1:3000' + r.url);
          assert.equal(r.headers['X-Client-Instance'], u.searchParams.get('cid'));
          assert.equal(r.headers['X-Edit-Revision'], u.searchParams.get('rev'));
          assert(!('clientRevision' in r.body), 'revision must stay outside JSON payload');
          const allowed = ['classId', 'sessionId', 'studentId', 'status', field];
          if (field === 'teacherNote') allowed.push('finalText'); // current source also carries this snapshot
          if (['strengths', 'improvements', 'actionPlan', 'finalText'].includes(field)) allowed.push('strengths', 'improvements', 'actionPlan', 'finalText');
          assert(Object.keys(r.body).every(key => allowed.includes(key)), 'no unrelated attendance/tag/note snapshot');
        }
        const savedBeforeOlderFinishes = Object.fromEntries(fields.map(f => [f, plain(readField(b.row(), f))]));
        hold.resolve(); await first; await h.flush();
        assert.deepEqual(responses.map(r => r.status), [200, 200]);
        if (order === 'older-request-last') {
          const older = responses.find(r => r.index === 0);
          assert.equal(older.data.staleIgnored, true);
        }
        assert.deepEqual(Object.fromEntries(fields.map(f => [f, plain(readField(b.row(), f))])), savedBeforeOlderFinishes, 'all seven persisted fields remain intact');
        const beforeReload = plain(readField(b.row(), field));
        assert.deepEqual(beforeReload, expected(field), 'late old success must not overwrite persisted newer edit');
        assert.equal(b.row().status, 'DRAFT');
        assert.deepEqual(plain(h.api.students[0][field]), expected(field), 'visible current edit');
        await h.api.loadClassData(cid, sid); await h.flush();
        assert.deepEqual(plain(h.api.students[0][field]), expected(field), 'reload current page');
        const freshPage = sc(b); await freshPage.flush(); freshPage.api.setSelectedSessionId(sid); await freshPage.flush();
        assert.deepEqual(plain(freshPage.api.students[0][field]), expected(field), 'new page reload from SQLite');
        observations.push({ field, initialStatus, order, statuses: responses.map(r => r.status), stored: beforeReload });
      } finally { hold.resolve(); b.db.close(); }
    });
  }
}

function send(b, patch, rev, { client = 'independent', classId = cid, sessionId = sid, studentId = 'S1', headersOnly = false } = {}) {
  const suffix = headersOnly ? '' : '?cid=' + client + '&rev=' + rev;
  return b.save(new Request('http://127.0.0.1:3000/api/session-comments/save-draft' + suffix, {
    method: 'POST', headers: { host: '127.0.0.1:3000', 'content-type': 'application/json',
      ...(headersOnly ? { 'X-Client-Instance': client, 'X-Edit-Revision': String(rev) } : {}) },
    body: JSON.stringify({ classId, sessionId, studentId, status: 'DRAFT', ...patch }),
  }));
}

await check('R12-01: header-only metadata protects every field, including clearing tags/text', async () => {
  const b = backend(); try {
    b.seed();
    const latest = { teacherNote: '', quickTags: [], attendanceStatus: 'LATE', strengths: '', improvements: '', actionPlan: '', finalText: '' };
    assert.equal((await send(b, latest, 90, { headersOnly: true })).status, 200);
    const older = await send(b, { teacherNote: 'old', quickTags: ['old'], attendanceStatus: 'ABSENT', strengths: 'old', improvements: 'old', actionPlan: 'old', finalText: 'old' }, 20, { headersOnly: true });
    assert.equal(older.status, 200); assert.equal((await older.json()).staleIgnored, true);
    for (const [field, value] of Object.entries(latest)) assert.deepEqual(plain(readField(b.row(), field)), value);
  } finally { b.db.close(); }
});

for (const earlierField of fields) for (const laterField of fields.filter(f => f !== earlierField)) {
  await check(`R12-01: independent fields ${earlierField} rev10 and ${laterField} rev20 both survive`, async () => {
    const b = backend(); try {
      b.seed();
      const value = f => f === 'quickTags' ? ['NEW TAG'] : f === 'attendanceStatus' ? 'LATE' : 'VALUE ' + f;
      assert.equal((await send(b, { [laterField]: value(laterField) }, 20)).status, 200);
      const older = await send(b, { [earlierField]: value(earlierField) }, 10);
      assert.equal(older.status, 200); assert.notEqual((await older.json()).staleIgnored, true);
      for (const f of [earlierField, laterField]) assert.deepEqual(plain(readField(b.row(), f)), value(f));
    } finally { b.db.close(); }
  });
}

await check('R12-01: mixed stale/fresh payload preserves latest finalText and applies older independent note', async () => {
  const b = backend(); try {
    b.seed(); await send(b, { finalText: 'LATEST' }, 20);
    assert.equal((await send(b, { finalText: 'OLDER', teacherNote: 'KEEP THIS NOTE' }, 10)).status, 200);
    assert.equal(b.row().finalText, 'LATEST'); assert.equal(b.row().teacherNote, 'KEEP THIS NOTE');
  } finally { b.db.close(); }
});

await check('R12-01: ignored stale request preserves APPROVED hash/status and VERIFIED timestamp', async () => {
  const b = backend(); try {
    b.seed('S1', { attendanceStatus: 'PRESENT' }); await send(b, { finalText: 'LATEST' }, 20);
    const approved = await b.approve(b.request('/api/approve', { classId: cid, sessionId: sid, studentId: 'S1', approvedText: 'LATEST' }));
    assert.equal(approved.status, 200);
    for (const state of ['APPROVED', 'VERIFIED']) {
      if (state === 'VERIFIED') b.sessionFeedbackRepo.updateStatus(cid, sid, 'S1', 'VERIFIED', 'audit timestamp');
      const snapshot = plain(b.row()); const stale = await send(b, { finalText: 'OLDER' }, 10);
      assert.equal(stale.status, 200); assert.equal((await stale.json()).staleIgnored, true);
      assert.deepEqual(plain(b.row()), snapshot);
    }
  } finally { b.db.close(); }
});

await check('R12-01: revision keys isolate student, session, class; page sequence survives leaving and returning', async () => {
  const b = backend(); try {
    b.seed('S1'); b.seed('S2');
    await send(b, { teacherNote: 'S1 high rev' }, 100);
    assert.equal((await send(b, { teacherNote: 'S2 low rev' }, 1, { studentId: 'S2' })).status, 200);
    assert.equal(b.row('S2').teacherNote, 'S2 low rev');
    const sess2 = cid + '_SESS_02';
    await send(b, { teacherNote: 'session 2 low rev' }, 1, { sessionId: sess2 });
    assert.equal(b.sessionFeedbackRepo.findOne(cid, sess2, 'S1').teacherNote, 'session 2 low rev');
    b.studentRepo.upsert({ classId: 'OTHER', studentId: 'S1', fullName: 'Audit Other', isActive: 1 });
    await send(b, { teacherNote: 'other class low rev' }, 1, { classId: 'OTHER', sessionId: 'OTHER_SESS_01' });
    assert.equal(b.sessionFeedbackRepo.findOne('OTHER', 'OTHER_SESS_01', 'S1').teacherNote, 'other class low rev');
    const sent = []; const hold = defer();
    const h = sc(b, async (url, opts) => {
      if (opts?.body) { sent.push(url); if (sent.length === 1) await hold.promise; }
      return b.dispatch(url, opts);
    });
    await h.flush(); h.api.setSelectedSessionId(sid); await h.flush();
    h.api.handleNoteChange('S1', 'before leaving'); await h.flush();
    h.api.setSelectedSessionId(sess2); await h.flush(); h.api.setSelectedSessionId(sid); await h.flush();
    h.api.handleNoteChange('S1', 'AFTER RETURN'); await h.flush(); hold.resolve(); await h.flush();
    const revisions = sent.map(url => Number(new URL('http://x' + url).searchParams.get('rev')));
    assert(revisions[1] > revisions[0], 'never restart revision after scope switch');
    assert.equal(b.row().teacherNote, 'AFTER RETURN');
  } finally { b.db.close(); }
});

await check('Security baseline: hostile Host/Origin/Sec-Fetch-Site blocked before save', async () => {
  const b = backend(); try {
    b.seed(); const before = plain(b.row());
    for (const headers of [{ host: 'evil.invalid' }, { host: '127.0.0.1:3000', origin: 'https://evil.invalid' }, { host: '127.0.0.1:3000', 'sec-fetch-site': 'cross-site' }]) {
      const res = await b.save(new Request('http://127.0.0.1:3000/api/session-comments/save-draft', { method: 'POST', headers, body: JSON.stringify({ classId: cid, sessionId: sid, studentId: 'S1', teacherNote: 'MUST NOT WRITE' }) }));
      assert.equal(res.status, 403); assert.deepEqual(plain(b.row()), before);
    }
    assert(local.isLocalRequest(new Request('http://127.0.0.1:3000', { headers: { host: '127.0.0.1:3000' } })));
  } finally { b.db.close(); }
});

const summary = { generatedAt: new Date().toISOString(), passed: results.filter(r => r.pass).length, failed: results.filter(r => !r.pass).length, results, observations };
fs.writeFileSync('docs/audits/round-13/independent-results.json', JSON.stringify(summary, null, 2) + '\n');
console.log('SUMMARY ' + JSON.stringify({ passed: summary.passed, failed: summary.failed }));
process.exitCode = summary.failed ? 1 : 0;
