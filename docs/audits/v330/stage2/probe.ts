// Stage 2 Closure Verification Probe: Asserts all 9 findings (S2-01..S2-09) are CLOSED.
// No live browser/network. Real SQLite writes are restricted to a disposable DB.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import * as calculator from '../../../../src/lib/report-card/report-card-calculator';
import { assertPathAllowed } from '../../../../src/lib/security/path-allowlist';

const prod = assertPathAllowed(path.resolve('data/mindx_bot.db'));
const hash = () => crypto.createHash('sha256').update(fs.readFileSync(prod)).digest('hex');
const before = hash();
const tempDir = fs.mkdtempSync(assertPathAllowed(path.resolve('data/_temp_stage2_probe_')));
process.env.MINDX_DB_PATH = path.join(tempDir, 'probe.db');
const dbmod = await import('../../../../src/lib/db/sqlite');
const source = fs.readFileSync(assertPathAllowed(path.resolve('src/lib/playwright/scrape-scores.ts')), 'utf8');
const js = stripTypeScriptTypes(source)
  .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, '')
  .replace(/\bexport\s+/g, '');
const observations: any[] = [];
const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const st = (id: string, name: string, cid = 'CLASS_A') => ({ classId: cid, studentId: id, fullName: name, isActive: 1 });
const roster = (id: string, name: string) => ({ student: { id, fullName: name }, activeInClass: true });
const homework = { id: 'L1', name: 'Homework 1', displayOrder: 1, type: 'REVIEW_AND_PRACTICE' };
const sub = (uid: string, score: number, lessonId = 'L1', category = 'PRACTICE_TASK1') => ({ id: `${uid}_${lessonId}_${category}`, studentUid: uid, lessonId, category, type: category === 'QUIZ' ? 'QUIZ' : 'UPLOAD_FILE', status: 'MARKED', score });
const att = (id: string, fullName: string, cp = 4) => ({ student: { id, fullName }, commentByAreas: [{ type: 'CHECKPOINT', checkpoint: { checkpointScore: cp, practiceScore: cp } }, { type: 'RATE', grade: 4 }] });
const snap = (cid: string) => ({ classId: cid, classCode: cid, isRobotics: cid.includes('ROB'), scrapedAt: '2026-10-29T00:00:00.000Z', btvnSessions: [], students: [{ studentId: 'LOCAL_A', fullName: 'Student Alpha', isActive: true, btvnScores: {}, stageScores: { cp1Theory: 4, cp1Practice: 4, cp1Competency: 4, cp2Theory: 4, cp2Practice: 4, cp2Competency: 4, finalProduct: 4, finalCompetency: 4 } }] });

function harness(opts: any = {}) {
  let reqListener: any;
  let listener: any;
  let tabClicks = 0;
  let waitTicks = 0;
  let releaseClass: (() => void) | undefined;
  const writes: any[] = [];
  const empty: any = { first() { return this; }, locator() { return this; }, count: async () => 0, isVisible: async () => false, innerText: async () => opts.cid || 'CLASS_A', getAttribute: async () => 'false', scrollIntoViewIfNeeded: async () => {}, click: async () => {} };
  const emit = async (operationName: string, payload: any, requestId = A, status = 200) => {
    if (!listener) return;
    const reqObj = { method: () => 'POST', postDataJSON: () => ({ operationName, variables: operationName === 'GetClassById' ? { id: requestId } : { payload: { classId: requestId } } }) };
    if (reqListener) await reqListener(reqObj);
    await listener({ url: () => 'https://lms-api.mindx.edu.vn/graphql', status: () => status,
      request: () => reqObj,
      json: async () => { if (operationName === 'GetClassById' && (opts.deferClass || opts.deferClassTicks)) await new Promise<void>((resolve) => { releaseClass = resolve; }); return { data: { [operationName === 'GetClassById' ? 'classesById' : 'findStudentSubmissionByClass']: payload } }; } });
  };
  const tab = { ...empty, count: async () => 1, click: async () => { tabClicks++; if (opts.submission) await emit('FindStudentSubmissionByClass', opts.submission, opts.submissionRequestId || A); } };
  const drawer = { ...empty, locator: (s: string) => s.includes('#tab-3') ? tab : empty };
  const page = {
    locator: () => drawer,
    on: (ev: string, fn: any) => { if (ev === 'request') reqListener = fn; if (ev === 'response') listener = fn; },
    off: (ev: string) => { if (ev === 'request') reqListener = null; if (ev === 'response') listener = null; },
    waitForTimeout: async () => {
      waitTicks++;
      if (opts.deferClassTicks && waitTicks >= opts.deferClassTicks && releaseClass) {
        const rel = releaseClass;
        releaseClass = undefined;
        rel();
        await new Promise((r) => setTimeout(r, 0));
      }
    },
  };
  const sb: any = { console, Date, Math, Map, Set, JSON, RegExp, Error, Array, Object, Number, String, Boolean, parseInt, parseFloat, setTimeout, ...calculator,
    isRoboticsClassCode: dbmod.isRoboticsClassCode,
    getDb: opts.realDb ? dbmod.getDb : undefined,
    authService: { ensureAuthenticated: async () => {} },
    BrowserManager: { getInstance: () => ({ getPage: async () => page }) },
    createNetworkInterceptor: () => ({ dismissForbiddenToast: async () => {} }),
    LmsHelpers: { openClassDrawer: async () => { if (opts.cls || opts.classStatus) { const task = emit('GetClassById', opts.cls, opts.classRequestId || A, opts.classStatus || 200); if (!opts.deferClass && !opts.deferClassTicks) await task; } }, switchDrawerTab: async () => {} },
    SELECTORS: { tabs: { grading: '' } }, studentRepo: { findByClass: () => opts.existing || [] }, jobLogRepo: { add() {} }, session14EvalRepo: { findByClass: () => [] },
    reportCardRepo: opts.realDb ? dbmod.reportCardRepo : { saveLmsSnapshot: (cid: string, s: any) => { writes.push({ kind: 'snapshot', cid, snapshot: s }); } },
    scoreMatrixRepo: opts.realDb ? dbmod.scoreMatrixRepo : { save: (cid: string, matrix: any) => { writes.push({ kind: 'matrix', cid, matrix }); } },
  };
  vm.createContext(sb);
  vm.runInContext(js + '\nglobalThis.scraper = ScoreScraper;', sb);
  return { scraper: sb.scraper, writes, clicks: () => tabClicks, releaseClass: () => releaseClass?.() };
}

try {
  const pure = harness().scraper;
  // S2-01 (CLOSED): GetClassById HTTP 500 fails and preserves prior CP1=4.
  const cid = 'VT-ROB-AUDIT';
  dbmod.reportCardRepo.saveLmsSnapshot(cid, snap(cid));
  const h1 = harness({ cid, existing: [st('LOCAL_A', 'Student Alpha', cid)], classStatus: 500, realDb: true });
  const r1 = await h1.scraper.scrapeClassScores(cid);
  assert.equal(r1.success, false);
  assert.equal(h1.clicks(), 0);
  const persisted1 = JSON.parse(dbmod.reportCardRepo.findOne(cid)!.lmsSnapshotJson);
  assert.equal(persisted1.students[0].stageScores.cp1Practice, 4);
  observations.push({ id: 'S2-01', status: 'CLOSED', success: r1.success, priorCp1: 4, persistedCp1: persisted1.students[0].stageScores.cp1Practice, roboticsTabClicks: h1.clicks() });

  // S2-01b (CLOSED): Delayed HTTP 200 GetClassById body resolving within wait loop is awaited (CP1=5), and never-resolving body times out with success=false.
  const delayedResolved = harness({ deferClassTicks: 2, existing: [st('LOCAL_A', 'Student Alpha')], cls: { id: A, name: 'CLASS_A', students: [roster('CRM_A', 'Student Alpha')], slots: [{ index: 4, studentAttendance: [att('CRM_A', 'Student Alpha', 5)] }] }, submission: { classCode: 'CLASS_A', lessons: [homework], students: [{ id: 'CRM_A', studentUid: 'UID_A', displayName: 'Student Alpha' }], submissions: [sub('UID_A', 80)] } });
  const delayedResolvedResult = await delayedResolved.scraper.scrapeClassScores('CLASS_A');
  assert.equal(delayedResolvedResult.success, true);
  assert.equal(delayedResolvedResult.reportCardSnapshot.students[0].stageScores.cp1Practice, 5);

  const delayedTimeout = harness({ deferClass: true, existing: [st('LOCAL_A', 'Student Alpha')], cls: { id: A, name: 'CLASS_A', students: [roster('CRM_A', 'Student Alpha')], slots: [{ index: 4, studentAttendance: [att('CRM_A', 'Student Alpha', 5)] }] }, submission: { classCode: 'CLASS_A', lessons: [homework], students: [{ id: 'CRM_A', studentUid: 'UID_A', displayName: 'Student Alpha' }], submissions: [sub('UID_A', 80)] } });
  const delayedTimeoutResult = await delayedTimeout.scraper.scrapeClassScores('CLASS_A');
  assert.equal(delayedTimeoutResult.success, false);
  delayedTimeout.releaseClass();
  observations.push({ id: 'S2-01b', status: 'CLOSED', delayedResolvedCp1: delayedResolvedResult.reportCardSnapshot.students[0].stageScores.cp1Practice, timeoutSuccess: delayedTimeoutResult.success });

  // S2-02 (CLOSED): Foreign submissionRequestId conflicting with verified lmsClassId is rejected.
  const h2 = harness({ cls: { id: A, name: 'CLASS_A', students: [roster('CRM_A', 'Student Alpha')], slots: [] }, existing: [st('LOCAL_A', 'Student Alpha')], submissionRequestId: B,
    submission: { lessons: [homework], students: [{ id: 'CRM_A', studentUid: 'UID_A', displayName: 'Student Alpha' }], submissions: [sub('UID_A', 99)] } });
  const r2 = await h2.scraper.scrapeClassScores('CLASS_A');
  assert.equal(r2.success, false);
  observations.push({ id: 'S2-02', status: 'CLOSED', verifiedClassId: A, rejectedForeignRequestId: B, success: r2.success });

  // S2-02b (CLOSED): GetClassById with foreign ID and missing code is rejected.
  const foreign = harness({ cid: 'VT-ROB-FOREIGN', existing: [st('LOCAL_A', 'Student Alpha', 'VT-ROB-FOREIGN')], cls: { id: B, students: [roster('CRM_A', 'Student Alpha')], slots: [{ index: 3, studentAttendance: [att('CRM_A', 'Student Alpha', 5)] }] } });
  const rf = await foreign.scraper.scrapeClassScores('VT-ROB-FOREIGN');
  assert.equal(rf.success, false);
  observations.push({ id: 'S2-02b', status: 'CLOSED', foreignCodeMissing: true, success: rf.success });

  // S2-03 (CLOSED): Snapshot persistence lock rejects both stores atomically and returns success=false.
  dbmod.reportCardRepo.saveLmsSnapshot('CLASS_A', snap('CLASS_A'));
  dbmod.getDb().prepare("UPDATE class_report_cards SET status='SAVING', teachingSyncStatus='SYNCING' WHERE classId='CLASS_A'").run();
  const h3 = harness({ realDb: true, existing: [st('LOCAL_A', 'Student Alpha')], cls: { id: A, name: 'CLASS_A', students: [roster('CRM_A', 'Student Alpha')], slots: [{ index: 4, studentAttendance: [att('CRM_A', 'Student Alpha', 2)] }] }, submission: { classCode: 'CLASS_A', lessons: [homework], students: [{ id: 'CRM_A', studentUid: 'UID_A', displayName: 'Student Alpha' }], submissions: [sub('UID_A', 80)] } });
  const r3 = await h3.scraper.scrapeClassScores('CLASS_A');
  const cached3 = dbmod.scoreMatrixRepo.findByClass('CLASS_A');
  const stored3 = JSON.parse(dbmod.reportCardRepo.findOne('CLASS_A')!.lmsSnapshotJson);
  assert.equal(r3.success, false);
  assert.equal(cached3, null);
  assert.equal(stored3.students[0].stageScores.cp1Practice, 4);
  observations.push({ id: 'S2-03', status: 'CLOSED', success: r3.success, matrixCached: cached3, persistedReportCp1: stored3.students[0].stageScores.cp1Practice });

  // S2-04 (CLOSED): A captured CRM roster attaches DOM fallback rows so BTVN cells reach the report card.
  const cell = { columnId: 'L1', lessonId: 'L1', sessionNumber: 1, status: 'GRADED', score: 80, quizScore: 90, maxScore: 100 };
  const dom = pure.extractReportCardSnapshotFromGql({ classId: 'CLASS_A', classCode: 'CLASS_A', classByIdGqlData: { students: [roster('CRM_A', 'Student Alpha')] }, existingStudents: [st('LOCAL_A', 'Student Alpha')], fallbackMatrix: { columns: [{ columnId: 'L1', lessonId: 'L1', title: 'Homework 1', sessionNumber: 1 }], rows: [{ studentId: 'LOCAL_A', fullName: 'Student Alpha', isActive: true, cells: { L1: cell } }] } });
  const domComputed = calculator.computeClassReportCard(dom);
  assert.equal(domComputed.students[0].btvnCells[1].practiceRaw, 80);
  assert.equal(domComputed.students[0].btvnCells[1].theoryRaw, 90);
  observations.push({ id: 'S2-04', status: 'CLOSED', domPractice: 80, reportPractice: domComputed.students[0].btvnCells[1].practiceRaw });

  // S2-05 (CLOSED): Verified CRM bridge wins over crossed mutable displayNames.
  const swapped = pure.extractReportCardSnapshotFromGql({ classId: 'CLASS_A', classCode: 'CLASS_A', existingStudents: [st('LOCAL_A', 'Student Alpha'), st('LOCAL_B', 'Student Beta')], classByIdGqlData: { students: [roster('CRM_A', 'Student Alpha'), roster('CRM_B', 'Student Beta')] }, submissionGqlData: { lessons: [homework], students: [{ id: 'CRM_A', studentUid: 'UID_A', displayName: 'Student Beta' }, { id: 'CRM_B', studentUid: 'UID_B', displayName: 'Student Alpha' }], submissions: [sub('UID_A', 90), sub('UID_B', 20)] } });
  assert.equal(swapped.students.find((s: any) => s.studentId === 'LOCAL_A').btvnScores[1].practiceRaw, 90);
  assert.equal(swapped.students.find((s: any) => s.studentId === 'LOCAL_B').btvnScores[1].practiceRaw, 20);
  observations.push({ id: 'S2-05', status: 'CLOSED', expectedLocalAScore: 90, assignedLocalAScore: swapped.students.find((s: any) => s.studentId === 'LOCAL_A').btvnScores[1].practiceRaw });

  // S2-06 (CLOSED): Active CRM student without local/Denise account is included in both matrix and snapshot, and distinct CRM IDs sharing a name are both preserved.
  const h6 = harness({ cls: { id: A, name: 'CLASS_A', students: [roster('CRM_A', 'Student Alpha'), roster('CRM_B', 'Student Beta')], slots: [] }, submission: { classCode: 'CLASS_A', lessons: [homework], students: [{ id: 'CRM_A', studentUid: 'UID_A', displayName: 'Student Alpha' }], submissions: [sub('UID_A', 80)] } });
  const r6 = await h6.scraper.scrapeClassScores('CLASS_A');
  assert.equal(r6.success, true);
  assert.equal(r6.rows.length, 2);
  assert.equal(r6.reportCardSnapshot.students.length, 2);
  const duplicate = pure.extractReportCardSnapshotFromGql({ classId: 'CLASS_A', classCode: 'CLASS_A', classByIdGqlData: { students: [roster('CRM_A', 'Same Name'), roster('CRM_B', 'Same Name')] }, submissionGqlData: { lessons: [homework], students: [{ id: 'CRM_A', studentUid: 'UID_A', displayName: 'Same Name' }], submissions: [] } });
  assert.equal(duplicate.students.length, 2);
  observations.push({ id: 'S2-06', status: 'CLOSED', activeCrmStudents: 2, returnedMatrixStudents: r6.rows.length, snapshotStudents: r6.reportCardSnapshot.students.length, sameNameDistinctCrmSnapshotStudents: duplicate.students.length });

  // S2-07 (CLOSED): Sole CHECKPOINT 2 populates CP2 (and leaves CP1 null).
  const cp2Only = pure.extractReportCardSnapshotFromGql({ classId: 'CLASS_A', classCode: 'CLASS_A', submissionGqlData: { lessons: [{ id: 'CP2', name: 'Checkpoint 2', type: 'CHECKPOINT', displayOrder: 10 }], students: [{ id: 'CRM_A', studentUid: 'UID_A', displayName: 'Student Alpha' }], submissions: [sub('UID_A', 80, 'CP2', 'QUIZ'), sub('UID_A', 60, 'CP2')] } });
  assert.equal(cp2Only.students[0].stageScores.cp1Theory, null);
  assert.equal(cp2Only.students[0].stageScores.cp2Theory, 4);
  assert.equal(cp2Only.students[0].stageScores.cp2Practice, 3);
  observations.push({ id: 'S2-07', status: 'CLOSED', source: 'Checkpoint 2', cp1Theory: cp2Only.students[0].stageScores.cp1Theory, cp2Theory: cp2Only.students[0].stageScores.cp2Theory });

  // S2-08 (CLOSED): Final DEMO with explicit five zero scores and RATE completion evidence preserves 0, while ungraded default template stays null.
  const zero = pure.extractReportCardSnapshotFromGql({ classId: 'CLASS_A', classCode: 'CLASS_A', classByIdGqlData: { students: [roster('CRM_A', 'Student Alpha')], slots: [{ index: 13, studentAttendance: [{ student: { id: 'CRM_A', fullName: 'Student Alpha' }, commentByAreas: [{ type: 'RATE', grade: 4 }, { type: 'DEMO', demoQuestions: Array.from({ length: 5 }, () => ({ score: 0 })) }] }] }] } });
  assert.equal(zero.students[0].stageScores.finalProduct, 0);
  const ungradedZero = pure.extractReportCardSnapshotFromGql({ classId: 'CLASS_A', classCode: 'CLASS_A', classByIdGqlData: { students: [roster('CRM_A', 'Student Alpha')], slots: [{ index: 13, studentAttendance: [{ student: { id: 'CRM_A', fullName: 'Student Alpha' }, commentByAreas: [{ type: 'RATE', grade: 0 }, { type: 'DEMO', demoQuestions: Array.from({ length: 5 }, () => ({ score: 0 })) }] }] }] } });
  assert.equal(ungradedZero.students[0].stageScores.finalProduct, null);
  observations.push({ id: 'S2-08', status: 'CLOSED', explicitDemoScores: [0, 0, 0, 0, 0], extractedFinalProduct: zero.students[0].stageScores.finalProduct, ungradedDefaultFinalProduct: ungradedZero.students[0].stageScores.finalProduct });

  // S2-09 (CLOSED): Checkpoint-session exclusion holds regardless of number of lessons.
  const few = pure.extractReportCardSnapshotFromGql({ classId: 'CLASS_A', classCode: 'CLASS_A', submissionGqlData: { lessons: [{ id: 'L5', name: 'Homework 5', type: 'REVIEW_AND_PRACTICE' }], students: [], submissions: [] } });
  assert.equal(few.btvnSessions.length, 0);
  observations.push({ id: 'S2-09', status: 'CLOSED', lessonsCount: 1, btvnSessionsLength: few.btvnSessions.length });

  const evidence = JSON.stringify({ observations, productionDbHashBefore: before, productionDbHashAfter: hash() }, null, 2);
  fs.writeFileSync(assertPathAllowed(path.resolve('docs/audits/v330/stage2/observations.json')), evidence + '\n');
  console.log(evidence);
} finally {
  dbmod.closeDb();
  assert.equal(hash(), before, 'Production DB changed');
  const resolvedTemp = path.resolve(tempDir);
  assert.ok(resolvedTemp.startsWith(path.resolve('data') + path.sep));
  fs.rmSync(assertPathAllowed(resolvedTemp), { recursive: true, force: true });
}
