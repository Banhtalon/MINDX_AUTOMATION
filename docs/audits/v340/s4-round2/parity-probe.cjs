// Run from repository root with node --require tsx/cjs and isolated TEMP overrides.
// Exit 0 means evidence collection completed; inspect OPEN records for failed expectations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = process.cwd();
for (const name of ['MINDX_DB_PATH', 'MINDX_RUNNING_CLASSES_PATH']) {
  const rel = path.relative(os.tmpdir(), path.resolve(process.env[name] || '.'));
  assert(rel && !rel.startsWith('..') && !path.isAbsolute(rel), `${name} must be under TEMP`);
}
const db = require(path.join(root, 'src/lib/db/sqlite.ts'));
const route = require(path.join(root, 'src/app/api/report-card/route.ts'));
const { ScoreScraper } = require(path.join(root, 'src/lib/playwright/scrape-scores.ts'));
const records = [];
function record(id, state, details) {
  records.push({ id, state, ...details });
  console.log(JSON.stringify(records.at(-1)));
}
const local = (url, options = {}) => new Request(`http://127.0.0.1:3000${url}`, {
  ...options,
  headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'content-type': 'application/json' },
});
const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
const slug = (c, name) => `STU_${c}_${norm(name).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase()}`;
function pupil(c, sid, name, active = 1) { db.studentRepo.upsert({ classId: c, studentId: sid, fullName: name, isActive: active }); }
function evaluation(c, sid, demo, comp = 4, timestamp = '2026-10-30T08:00:00Z', status = 'APPROVED') {
  db.session14EvalRepo.getOrInit(c, sid);
  db.getDb().prepare('UPDATE spck_session14_evaluations SET demoTotalScore=?, competencyTotalScore=?, updatedAt=?, status=? WHERE classId=? AND studentId=?')
    .run(demo, comp, timestamp, status, c, sid);
}
function snapshot(c, students, at = '2026-10-30T08:01:00Z', sourceRows) {
  const attendance = students.map(s => ({
    student: { id: s.id, fullName: s.fullName },
    commentByAreas: [
      { type: 'RATE', grade: 4 },
      { type: 'CHECKPOINT', checkpoint: { checkpointScore: 4, practiceScore: 4 } },
      { type: 'DEMO', demoQuestions: Array.from({ length: 5 }, () => ({ score: 0.8 })) },
    ],
  }));
  return ScoreScraper.extractReportCardSnapshotFromGql({
    classId: c, classCode: c, isRobotics: false, scrapedAt: at,
    existingStudents: db.studentRepo.findByClass(c, false),
    session14Evals: sourceRows || db.session14EvalRepo.findByClass(c),
    submissionGqlData: { students: students.map(s => ({ id: s.id, studentUid: s.uid, displayName: s.fullName })), lessons: [], submissions: [] },
    classByIdGqlData: {
      students: students.map(s => ({ student: { id: s.id, fullName: s.fullName }, activeInClass: true })),
      slots: [4, 8, 13].map(index => ({ index, studentAttendance: attendance })),
    },
  });
}
function simpleSnapshot(c, studentId, fullName, demo, comp = 4) {
  return { classId: c, classCode: c, isRobotics: false, scrapedAt: '2026-10-30T08:00:00.500Z', btvnSessions: [],
    students: [{ studentId, fullName, isActive: true, btvnScores: {}, stageScores: {
      cp1Theory: 4, cp2Theory: 4, finalProduct: demo, finalCompetency: comp,
    } }] };
}
async function main() {
  // Exercise each advertised identity path with one unambiguous pupil.
  for (const identity of ['studentId', 'studentUid', 'lmsStudentUid', 'normalized-name', 'expected-slug']) {
    const c = `AUDIT-S4-R2-ID-${identity.toUpperCase()}`;
    const name = 'Đỗ  Minh An';
    const snap = simpleSnapshot(c, 'SNAP_A', 'Do Minh An', 4);
    let eid = 'SNAP_A';
    if (identity === 'studentUid') { snap.students[0].studentUid = 'UID_A'; eid = 'UID_A'; }
    if (identity === 'lmsStudentUid') { snap.students[0].lmsStudentUid = 'LMS_UID_A'; eid = 'LMS_UID_A'; }
    if (identity === 'normalized-name') { eid = 'LOCAL_A'; pupil(c, eid, name); }
    if (identity === 'expected-slug') eid = slug(c, name);
    evaluation(c, eid, 5);
    assert.equal(route.computeReportCardStaleness(c, snap).hasNewerSession14, true);
    snap.students[0].stageScores.finalProduct = 5;
    assert.equal(route.computeReportCardStaleness(c, snap).hasNewerSession14, false);
    record(`ID-${identity}`, 'PASS', { staleDetected: true, refreshedClears: true });
  }

  // Same-second, overlapping and old edits in ISO and SQLite local time, including zero.
  const ctime = 'AUDIT-S4-R2-MATRIX';
  const d = new Date('2026-10-30T08:00:00Z'), pad = n => String(n).padStart(2, '0');
  const localStamp = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  let transitions = 0;
  for (const timestamp of ['2026-10-30T08:00:00Z', localStamp, '2026-10-30T07:59:30Z']) {
    for (const [oldScore, newScore] of [[4, 0], [0, 4], [4, 5], [4, 4]]) {
      const snap = simpleSnapshot(ctime, 'TIME_A', 'Time Fixture', oldScore);
      evaluation(ctime, 'TIME_A', newScore, 4, timestamp);
      assert.equal(route.computeReportCardStaleness(ctime, snap).hasNewerSession14, oldScore !== newScore);
      transitions++;
    }
  }
  record('TIME-MATRIX', 'PASS', { cases: transitions, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  evaluation(ctime, 'TIME_A', 4, 5);
  assert.equal(route.computeReportCardStaleness(ctime, simpleSnapshot(ctime, 'TIME_A', 'Time Fixture', 4)).hasNewerSession14, true);
  record('COMPETENCY', 'PASS', { competencyChangeDetected: true });

  // R2-01: Two real IDs with the same name. First has a direct UID evaluation;
  // second uses the legacy name slug. Guard binds that slug to the FIRST pupil.
  const c = 'AUDIT-S4-R2-SLUG-COLLISION', name = 'Nguyễn Văn An';
  const people = [{ id: 'CRM_A', uid: 'UID_A', fullName: name }, { id: 'CRM_B', uid: 'UID_B', fullName: name }];
  pupil(c, 'CRM_A', name); pupil(c, 'CRM_B', name);
  evaluation(c, 'UID_A', 5); evaluation(c, slug(c, name), 4);
  const capturedBeforeEdit = db.session14EvalRepo.findByClass(c);
  evaluation(c, slug(c, name), 5, 4, '2026-10-30T08:00:30Z');
  const staleSnapshot = snapshot(c, people, '2026-10-30T08:01:00Z', capturedBeforeEdit);
  const freshSnapshot = snapshot(c, people, '2026-10-30T08:02:00Z');
  assert.deepEqual(staleSnapshot.students.map(s => s.stageScores.finalProduct), [5, 4]);
  assert.deepEqual(freshSnapshot.students.map(s => s.stageScores.finalProduct), [5, 5]);
  const staleInfo = route.computeReportCardStaleness(c, staleSnapshot);
  assert.equal(staleInfo.missingCheckpointScores, false);
  record('R2-01-PURE', staleInfo.hasNewerSession14 ? 'CLOSED' : 'OPEN', {
    finding: 'S4-R2-01', severity: 'HIGH', snapshotScores: [5, 4], currentEffectiveScores: [5, 5],
    actualStale: staleInfo.isStale, expectedStale: true, actualHasNewer: staleInfo.hasNewerSession14,
  });
  db.reportCardRepo.saveLmsSnapshot(c, staleSnapshot);
  const getData = await (await route.GET(local(`/api/report-card?classId=${c}`))).json();
  const approveResponse = await route.POST(local('/api/report-card', { method: 'POST', body: JSON.stringify({ action: 'approve', classId: c, expectedVersion: getData.record.draftVersion }) }));
  const approveData = await approveResponse.json();
  assert.equal(approveResponse.status, 200);
  assert.equal(approveData.success, true);
  record('R2-01-API', approveData.staleness.hasNewerSession14 ? 'CLOSED' : 'OPEN', {
    finding: 'S4-R2-01', severity: 'HIGH', getHasNewer: getData.staleness.hasNewerSession14,
    approveHttp: approveResponse.status, contentHashSet: !!approveData.record.contentHash,
    approvedScores: approveData.snapshot.students.map(s => s.stageScores.finalProduct), actualStale: approveData.staleness.isStale,
  });
  assert.equal(route.computeReportCardStaleness(c, freshSnapshot).hasNewerSession14, false);
  record('R2-01-FRESH-CONTROL', 'PASS', { refreshedScores: [5, 5], actualStale: false });

  // R2-02: WAITING_APPROVAL/zero/empty learnedFromMindx is included by the guard,
  // but not by ScoreScraper. A real saveDraft with suggestions alone reaches this state.
  const cw = 'AUDIT-S4-R2-WAITING-PARITY';
  pupil(cw, 'UID_A', 'Student Alpha');
  const save = db.session14EvalRepo.saveDraft({ classId: cw, studentId: 'UID_A', suggestionsFromMindx: 'Need more practice' });
  assert.equal(save.success, true); assert.equal(save.record.status, 'WAITING_APPROVAL');
  assert.equal(save.record.demoTotalScore, 0); assert.equal(save.record.learnedFromMindx, '');
  db.getDb().prepare('UPDATE spck_session14_evaluations SET updatedAt=? WHERE classId=?').run('2026-10-30T08:00:00Z', cw);
  const pw = [{ id: 'CRM_A', uid: 'UID_A', fullName: 'Student Alpha' }];
  for (let scan = 1; scan <= 2; scan++) {
    const snap = snapshot(cw, pw, `2026-10-30T08:0${scan+1}:00Z`);
    assert.equal(snap.students[0].stageScores.finalProduct, 4);
    const info = route.computeReportCardStaleness(cw, snap);
    assert.equal(info.missingCheckpointScores, false);
    record(`R2-02-RESCAN-${scan}`, info.hasNewerSession14 ? 'OPEN' : 'CLOSED', {
      finding: 'S4-R2-02', severity: 'LOW', freshlyExtractedDemo: 4, localDefaultDemo: 0,
      sourceStatus: 'WAITING_APPROVAL', sourceLearned: '', actualHasNewer: info.hasNewerSession14, expectedHasNewer: false,
    });
  }

  // R2-03: Extractor knows crmStudentId; saved snapshot omits it, so guard
  // mistakes a freshly consumed CRM-keyed evaluation for a missing pupil.
  const cc = 'AUDIT-S4-R2-CRM-PARITY';
  pupil(cc, 'CANONICAL_A', 'Student Alpha'); evaluation(cc, 'CRM_A', 5);
  for (let scan = 1; scan <= 2; scan++) {
    const snap = snapshot(cc, pw, `2026-10-30T08:0${scan+1}:00Z`);
    assert.equal(snap.students[0].studentId, 'CANONICAL_A');
    assert.equal(snap.students[0].studentUid, 'UID_A');
    assert.equal(snap.students[0].stageScores.finalProduct, 5);
    const info = route.computeReportCardStaleness(cc, snap);
    assert.equal(info.missingCheckpointScores, false);
    record(`R2-03-RESCAN-${scan}`, info.hasNewerSession14 ? 'OPEN' : 'CLOSED', {
      finding: 'S4-R2-03', severity: 'LOW', evalStudentId: 'CRM_A', snapshotStudentId: 'CANONICAL_A', snapshotUid: 'UID_A',
      freshlyExtractedDemo: 5, currentDemo: 5, actualHasNewer: info.hasNewerSession14, expectedHasNewer: false,
    });
  }
  const outDir = path.join(os.tmpdir(), 'codex_s4_r2_audit');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'parity-results.json'), JSON.stringify(records, null, 2));
  console.log(JSON.stringify({ observations: records.length, open: records.filter(r => r.state === 'OPEN').length,
    passOrClosed: records.filter(r => r.state !== 'OPEN').length }));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.closeDb());
