// Run from repository root: node --require tsx/cjs docs/audits/v340/s4-round1/probe.cjs
// All database/cache locations must be supplied by the caller and remain in TEMP.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { transformSync } = require('esbuild');
const root = process.cwd();
for (const name of ['MINDX_DB_PATH', 'MINDX_RUNNING_CLASSES_PATH']) {
  const relative = path.relative(os.tmpdir(), path.resolve(process.env[name] || '.'));
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `${name} must be under TEMP`);
}
const db = require(path.join(root, 'src/lib/db/sqlite.ts'));
const calc = require(path.join(root, 'src/lib/report-card/report-card-calculator.ts'));
const route = require(path.join(root, 'src/app/api/report-card/route.ts'));
const syncRoute = require(path.join(root, 'src/app/api/report-card/sync-teaching/route.ts'));
const scoresRoute = require(path.join(root, 'src/app/api/homework-grader/scores/route.ts'));
const exportRoute = require(path.join(root, 'src/app/api/homework-grader/export/route.ts'));
const source = fs.readFileSync('scripts/test-streamline-v340-s4.ts', 'utf8');
let harnessSource = source.slice(source.indexOf('  function createReportCardViewHarness('), source.indexOf('  // ========================================================================='));
harnessSource = harnessSource.replace('get treeText() {', 'get tree() { return tree; },\n      get treeText() {');
const harnessContext = vm.createContext({ fs, path, vm, process, transformSync, ...calc, console, setTimeout, clearTimeout, setImmediate });
vm.runInContext(transformSync(harnessSource, { loader: 'ts', target: 'es2022' }).code + '\nglobalThis.makeHarness = createReportCardViewHarness;', harnessContext);
const makeHarness = harnessContext.makeHarness;
const results = [];
function observe(id, finding, details) { const item = { id, finding, ...details }; results.push(item); console.log(JSON.stringify(item)); }
function fixture(id, scrapedAt = '2026-10-30T08:00:00.500Z') {
  return { classId: id, classCode: id, isRobotics: false, scrapedAt, btvnSessions: [], students: [{ studentId: `${id}_S1`, fullName: 'Hoc Vien Gia Lap', isActive: true, btvnScores: {}, stageScores: { cp1Theory: 4, cp1Practice: 4, cp1Competency: 4, cp2Theory: 4, cp2Practice: 4, cp2Competency: 4, finalProduct: 4, finalCompetency: 4 } }] };
}
const local = (url, options = {}) => new Request(`http://127.0.0.1:3000${url}`, { ...options, headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'content-type': 'application/json' } });
const reply = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }
function nodes(tree, predicate, found = []) { if (!tree || typeof tree !== 'object') return found; if (Array.isArray(tree)) tree.forEach(n => nodes(n, predicate, found)); else { if (predicate(tree)) found.push(tree); nodes(tree.props?.children, predicate, found); } return found; }
function textOf(node) { if (node == null || typeof node === 'boolean') return ''; if (typeof node !== 'object') return String(node); if (Array.isArray(node)) return node.map(textOf).join(' '); return textOf(node.props?.children); }

async function main() {
  // Controls for correct timestamp interpretation and strictly newer rows.
  const id = 'AUDIT-S4-R1-TIME';
  const snap = fixture(id);
  db.session14EvalRepo.getOrInit(id, snap.students[0].studentId);
  function setEval(demo, comp, timestamp, status = 'APPROVED') {
    db.getDb().prepare('UPDATE spck_session14_evaluations SET demoTotalScore=?, competencyTotalScore=?, updatedAt=?, status=? WHERE classId=?').run(demo, comp, timestamp, status, id);
  }
  setEval(4, 4, '2026-10-30T08:00:01.000Z');
  assert.equal(route.computeReportCardStaleness(id, snap).hasNewerSession14, true);
  const localTs = new Date('2026-10-30T08:00:01Z');
  const z = n => String(n).padStart(2, '0');
  const dbTs = `${localTs.getFullYear()}-${z(localTs.getMonth()+1)}-${z(localTs.getDate())} ${z(localTs.getHours())}:${z(localTs.getMinutes())}:${z(localTs.getSeconds())}`;
  setEval(4, 4, dbTs);
  assert.equal(route.computeReportCardStaleness(id, snap).hasNewerSession14, true);
  observe('P01', null, { control: 'ISO and SQLite localtime both detect newer evaluation', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });

  // Evaluation was read by scraper at t0; user edits it at t1; scrape finishes at t2.
  // Production captures session14Evals before walking submission pages and timestamps at finish.
  setEval(5, 4, '2026-10-30T08:00:30.000Z');
  const overlapping = fixture(id, '2026-10-30T08:01:00.000Z');
  const stale = route.computeReportCardStaleness(id, overlapping);
  assert.equal(stale.isStale, false);
  assert.notEqual(overlapping.students[0].stageScores.finalProduct, db.session14EvalRepo.findByClass(id)[0].demoTotalScore);
  observe('P02', 'S4-01', { actualStale: stale.isStale, expectedStale: true, snapshotDemo: 4, currentDemo: 5, evaluationUpdated: '08:00:30Z', scrapeFinished: '08:01:00Z' });
  db.reportCardRepo.saveLmsSnapshot(id, overlapping);
  const version = db.reportCardRepo.findOne(id).draftVersion;
  const approved = await route.POST(local('/api/report-card', { method: 'POST', body: JSON.stringify({ action: 'approve', classId: id, expectedVersion: version }) }));
  const approvedBody = await approved.json();
  assert.equal(approvedBody.success, true);
  assert.equal(approvedBody.staleness.isStale, false);
  observe('P03', 'S4-01', { actualApproval: approved.status, approvedStaleScore: approvedBody.snapshot.students[0].stageScores.finalProduct, contentHashSet: !!approvedBody.record.contentHash });

  // Same-second timestamp precision: valid correction from a positive Demo score to zero.
  setEval(0, 4, '2026-10-30T08:00:00.000Z');
  const zeroStale = route.computeReportCardStaleness(id, snap);
  assert.equal(zeroStale.hasNewerSession14, false);
  observe('P04', 'S4-02', { actualStale: zeroStale.isStale, expectedStale: true, previousDemo: 4, correctedDemo: 0, sameSecond: true });
  setEval(5, 4, '2026-10-30T08:00:00.000Z');
  assert.equal(route.computeReportCardStaleness(id, snap).hasNewerSession14, true);
  observe('P05', null, { control: 'same-second nonzero correction is detected' });

  const cpId = 'AUDIT-S4-R1-CP';
  const allZero = fixture(cpId);
  for (const key of ['cp1Theory', 'cp1Practice', 'cp1Competency', 'cp2Theory', 'cp2Practice', 'cp2Competency']) allZero.students[0].stageScores[key] = 0;
  assert.equal(route.computeReportCardStaleness(cpId, allZero).missingCheckpointScores, false);
  const allMissing = structuredClone(allZero);
  for (const key of ['cp1Theory', 'cp1Practice', 'cp1Competency', 'cp2Theory', 'cp2Practice', 'cp2Competency']) allMissing.students[0].stageScores[key] = null;
  assert.equal(route.computeReportCardStaleness(cpId, allMissing).missingCp1, true);
  assert.equal(route.computeReportCardStaleness(cpId, allMissing).missingCp2, true);
  const inactive = structuredClone(allMissing.students[0]); inactive.isActive = false; inactive.studentId = 'INACTIVE';
  const withInactive = fixture(cpId); withInactive.students.push(inactive);
  assert.equal(route.computeReportCardStaleness(cpId, withInactive).missingCheckpointScores, false);
  assert.equal(route.computeReportCardStaleness(cpId, null).isStale, false);
  observe('C-CP-boundaries', null, { control: 'zero CP scores are present; null checkpoints are missing; inactive students excluded; no snapshot/no evaluations does not crash', cases: 5 });

  const uiId = 'AUDIT-S4-R1-UI';
  db.reportCardRepo.saveLmsSnapshot(uiId, fixture(uiId));
  const payload = await (await route.GET(local(`/api/report-card?classId=${uiId}`))).json();
  for (const status of [400, 409, 500]) {
    const calls = [];
    const h = makeHarness(async (url, options) => { if (!options?.method) return reply(payload); calls.push(url); return reply({ ...payload, success: false, error: `error-${status}` }, status); }, { classId: uiId, classCode: uiId });
    await h.flush(); await h.api.handleApproveAndSyncTeaching(); await h.flush();
    assert.equal(calls.length, 1); assert(!h.api.isApproving && !h.api.isSyncingTeaching);
    observe(`C-${status}`, null, { control: 'approval error prevents sync and releases busy state' });
  }
  for (const scenario of ['class-switch', 'newer-load', 'network-error']) {
    const d = deferred(); let syncCalls = 0;
    const h = makeHarness(async (url, options) => { if (!options?.method) return reply(payload); if (url.includes('sync-teaching')) { syncCalls++; return reply({ ...payload, record: { ...payload.record, status: 'VERIFIED' } }); } if (scenario === 'network-error') throw Error('offline'); return d.promise; }, { classId: uiId, classCode: uiId });
    await h.flush(); const pending = h.api.handleApproveAndSyncTeaching(); await h.flush();
    if (scenario === 'class-switch') { h.setProps({ classId: 'AUDIT-S4-R1-OTHER', classCode: 'AUDIT-S4-R1-OTHER' }); await h.flush(); }
    if (scenario === 'newer-load') {
      // A later GET raises the client version floor before old approve resolves.
      payload.record.draftVersion += 1;
      await h.api.loadReportCard(uiId); await h.flush();
      payload.record.draftVersion -= 1;
    }
    d.resolve(reply({ ...payload, record: { ...payload.record, status: 'APPROVED', contentHash: 'approved' } }));
    await pending; await h.flush(); assert.equal(syncCalls, 0);
    observe(`C-${scenario}`, null, { control: 'combined action stops before sync', syncCalls });
  }

  for (const scenario of ['sync-409', 'sync-network', 'switch-during-sync']) {
    const d = deferred();
    const h = makeHarness(async (url, options) => {
      if (!options?.method) return reply(payload);
      if (!url.includes('sync-teaching')) return reply({ ...payload, record: { ...payload.record, status: 'APPROVED', contentHash: 'approved' } });
      if (scenario === 'sync-409') return reply({ ...payload, success: false, error: 'sync conflict' }, 409);
      if (scenario === 'sync-network') throw Error('offline during sync');
      return d.promise;
    }, { classId: uiId, classCode: uiId });
    await h.flush(); const pending = h.api.handleApproveAndSyncTeaching(); await h.flush();
    if (scenario === 'switch-during-sync') {
      h.setProps({ classId: 'AUDIT-S4-R1-OTHER', classCode: 'AUDIT-S4-R1-OTHER' }); await h.flush();
      d.resolve(reply({ ...payload, record: { ...payload.record, status: 'VERIFIED' } }));
    }
    await pending; await h.flush();
    assert.equal(h.api.isApproving, false); assert.equal(h.api.isSyncingTeaching, false); assert.equal(h.api.toastMsg, null);
    observe(`C-${scenario}`, null, { control: 'no success toast after failed or obsolete sync; busy state released' });
  }

  // Missing CP-only banner currently attributes the problem to Buoi 14.
  const cpPayload = structuredClone(payload);
  cpPayload.staleness = { isStale: true, hasNewerSession14: false, missingCheckpointScores: true, missingCp1: false, missingCp2: true, reasons: ['Chưa có điểm Check-point 2 trên bản quét hiện tại'] };
  const cpHarness = makeHarness(async () => reply(cpPayload), { classId: uiId, classCode: uiId });
  await cpHarness.flush();
  assert(cpHarness.treeText.includes('Có dữ liệu Buổi 14 mới, bấm Quét lại'));
  observe('P06', 'S4-03', { actualTitle: 'Có dữ liệu Buổi 14 mới, bấm Quét lại', hasNewerSession14: false, missingCp2: true });

  // Real API + SQLite version and hash boundaries; fail before any external transport.
  const approvedRes = await route.POST(local('/api/report-card', { method: 'POST', body: JSON.stringify({ action: 'approve', classId: uiId, expectedVersion: payload.record.draftVersion }) }));
  assert.equal(approvedRes.status, 200);
  const current = db.reportCardRepo.findOne(uiId);
  const badVersion = await syncRoute.POST(local('/api/report-card/sync-teaching', { method: 'POST', body: JSON.stringify({ classId: uiId, expectedVersion: current.draftVersion + 99 }) }));
  assert.equal(badVersion.status, 409);
  db.getDb().prepare('UPDATE class_report_cards SET contentHash=? WHERE classId=?').run('TAMPERED', uiId);
  const badHash = await syncRoute.POST(local('/api/report-card/sync-teaching', { method: 'POST', body: JSON.stringify({ classId: uiId, expectedVersion: current.draftVersion }) }));
  assert.equal(badHash.status, 400);
  assert.equal(db.reportCardRepo.findOne(uiId).contentHash, '');
  observe('C-hash-version', null, { control: 'real handlers reject stale version and invalid SHA-256 before remote access', wrongVersionStatus: badVersion.status, wrongHashStatus: badHash.status });

  for (const [name, handler, method] of [['report-get', route.GET, 'GET'], ['report-post', route.POST, 'POST'], ['report-put', route.PUT, 'PUT'], ['scores-get', scoresRoute.GET, 'GET'], ['scores-post', scoresRoute.POST, 'POST'], ['export-get', exportRoute.GET, 'GET'], ['sync-post', syncRoute.POST, 'POST']]) {
    const req = new Request('http://attacker.example/api/test', { method, headers: { host: 'attacker.example' }, ...(method !== 'GET' ? { body: '{}' } : {}) });
    const res = await handler(req); assert.equal(res.status, 403);
    observe(`C-local-${name}`, null, { control: 'nonlocal request rejected before business work', status: res.status });
  }
  const formatter = require(path.join(root, 'src/lib/report-card/export-cell-formatter.ts'));
  let cases = 0;
  for (const mode of ['both', 'practice', 'quiz']) for (const cell of [null, undefined, {status:'GRADED',score:0,quizScore:0}, {status:'GRADED',score:4,quizScore:5}, {status:'SUBMITTED_UNGRADED',quizScore:0}, {status:'REDO_REQUESTED'}, {status:'NOT_SUBMITTED'}]) {
    assert.equal(formatter.formatCellForExport(cell, mode), exportRoute.formatCellForExport(cell, mode)); cases++;
  }
  for (const input of ['=SUM(A1:A2)', '+1', '-1', '@foo', '\t =cmd()', 'Nguyen An', 0, 4.5]) { assert.equal(formatter.sanitizeSpreadsheetCell(input), exportRoute.sanitizeSpreadsheetCell(input)); cases++; }
  observe('C-formatter', null, { control: 'formatter parity and formula escaping', cases });
  console.log(JSON.stringify({ observations: results.length, findingIds: [...new Set(results.map(r => r.finding).filter(Boolean))] }));
  fs.writeFileSync(path.join(os.tmpdir(), 'codex_s4_audit_round1', 'probe-results.json'), JSON.stringify(results, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.closeDb());
