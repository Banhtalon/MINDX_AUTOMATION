// Independent Round 2 probes. Exit 0 means the observations below were reproduced;
// it is not a closure verdict. Browser events are mocked; repositories are real.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { assertPathAllowed } from '../../../../src/lib/security/path-allowlist';
import * as calculator from '../../../../src/lib/report-card/report-card-calculator';

assert.ok(process.env.MINDX_DB_PATH, 'An isolated MINDX_DB_PATH is required');
assert.notEqual(path.resolve(process.env.MINDX_DB_PATH!), path.resolve('data/mindx_bot.db'));
const dbmod = await import('../../../../src/lib/db/sqlite');
const source = fs.readFileSync(assertPathAllowed(path.resolve('src/lib/playwright/scrape-scores.ts')), 'utf8');
const js = stripTypeScriptTypes(source)
  .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, '')
  .replace(/\bexport\s+/g, '');
const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const crm = (id = 'CRM_A', name = 'Student Alpha') => ({ student: { id, fullName: name }, activeInClass: true });
const local = { classId: 'CLASS_A', studentId: 'LOCAL_A', fullName: 'Student Alpha', isActive: 1 };
const homework = { id: 'L1', name: 'Homework 1', type: 'REVIEW_AND_PRACTICE', displayOrder: 1 };
const submission = (score: number, lessonId = 'L1', category = 'PRACTICE_TASK1') => ({
  id: `${lessonId}_${category}`, studentUid: 'UID_A', lessonId, category,
  type: category === 'QUIZ' ? 'QUIZ' : 'UPLOAD_FILE', status: 'MARKED', score,
});
const payload = (score: number) => ({
  lessons: [homework], students: [{ id: 'CRM_A', studentUid: 'UID_A', displayName: 'Student Alpha' }],
  submissions: [submission(score)],
});
const request = (operationName: string) => ({
  method: () => 'POST',
  postDataJSON: () => ({ operationName, variables: operationName === 'GetClassById' ? { id: A } : { payload: { classId: A } } }),
});

function harness(opts: any = {}) {
  const listeners = new Map<string, Set<any>>();
  const events: string[] = [];
  // Created before the scrape starts: no request event for this object occurs in this run.
  const oldRequest = request('FindStudentSubmissionByClass');
  async function emitRequest(req: any) {
    for (const listener of listeners.get('request') || []) await listener(req);
  }
  async function emitResponse(req: any, data: any) {
    const op = req.postDataJSON().operationName;
    const res = { url: () => 'https://lms-api.mindx.edu.vn/graphql', status: () => 200,
      request: () => req, json: async () => op === 'GetClassById' && opts.classError
        ? { errors: [{ message: 'injected GraphQL error' }] }
        : { data: { [op === 'GetClassById' ? 'classesById' : 'findStudentSubmissionByClass']: data } } };
    for (const listener of listeners.get('response') || []) await listener(res);
  }
  const empty: any = { first() { return this; }, locator() { return this; },
    count: async () => 0, isVisible: async () => false, innerText: async () => opts.cid || 'CLASS_A',
    getAttribute: async () => 'false', scrollIntoViewIfNeeded: async () => {}, click: async () => {} };
  const tab = { ...empty, count: async () => 1, click: async () => {
    if (opts.noSubmission) return;
    const req = request('FindStudentSubmissionByClass');
    events.push('fresh request'); await emitRequest(req);
    events.push('fresh response score=80'); await emitResponse(req, opts.submission || payload(80));
    if (opts.stale) {
      events.push('old request response score=99'); await emitResponse(oldRequest, payload(99));
    }
  } };
  const drawer = { ...empty, locator: (s: string) => s.includes('#tab-3') ? tab : empty };
  const page: any = { locator: () => drawer, waitForTimeout: async () => {},
    url: () => 'https://lms.mindx.edu.vn/admin/classes', keyboard: { press: async () => {} },
    on: (event: string, listener: any) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(listener); },
    off: (event: string, listener: any) => { listeners.get(event)?.delete(listener); } };
  const sb: any = { console, Date, Math, Map, Set, JSON, RegExp, Error, Array, Object, Number, String, Boolean,
    parseInt, parseFloat, setTimeout, ...calculator,
    isRoboticsClassCode: dbmod.isRoboticsClassCode, getDb: dbmod.getDb,
    authService: { ensureAuthenticated: async () => {} }, BrowserManager: { getInstance: () => ({ getPage: async () => page }) },
    createNetworkInterceptor: () => ({ dismissForbiddenToast: async () => {} }),
    LmsHelpers: { openClassDrawer: async () => {
      if (opts.noClass) return;
      const req = request('GetClassById'); await emitRequest(req);
      await emitResponse(req, opts.cls || { id: A, name: 'CLASS_A', students: [crm()], slots: [] });
    }, switchDrawerTab: async () => {} }, SELECTORS: { tabs: { grading: '' } },
    studentRepo: { findByClass: () => opts.existing || [local] }, jobLogRepo: { add() {} },
    session14EvalRepo: { findByClass: () => [] }, reportCardRepo: dbmod.reportCardRepo, scoreMatrixRepo: dbmod.scoreMatrixRepo,
  };
  vm.createContext(sb); vm.runInContext(js + '\nglobalThis.scraper = ScoreScraper;', sb);
  return { scraper: sb.scraper, events };
}

const observations: any[] = [];
try {
  const pure = harness().scraper;
  const stale = harness({ stale: true });
  const result = await stale.scraper.scrapeClassScores('CLASS_A');
  assert.equal(result.success, true);
  assert.equal(result.rows[0].cells.L1.score, 80);
  const stored: any = dbmod.scoreMatrixRepo.findByClass('CLASS_A');
  const storedMatrix = stored.matrix;
  const storedSnapshot = JSON.parse(dbmod.reportCardRepo.findOne('CLASS_A')!.lmsSnapshotJson);
  assert.equal(storedMatrix.rows[0].cells.L1.score, 80);
  assert.equal(storedSnapshot.students[0].btvnScores[1].practiceRaw, 80);
  observations.push({ id: 'S2-02', status: 'CLOSED', events: stale.events, expectedFreshScore: 80,
    returnedScore: result.rows[0].cells.L1.score, cachedScore: storedMatrix.rows[0].cells.L1.score,
    snapshotScore: storedSnapshot.students[0].btvnScores[1].practiceRaw });

  const unknownCp = pure.extractReportCardSnapshotFromGql({ classId: 'CLASS_A', classCode: 'CLASS_A',
    submissionGqlData: { lessons: [{ id: 'opaque-lesson', name: 'Bài kiểm tra', type: 'CHECKPOINT' }],
      students: payload(80).students, submissions: [submission(80, 'opaque-lesson', 'QUIZ'), submission(60, 'opaque-lesson')] } });
  assert.equal(unknownCp.students[0].stageScores.cp1Theory, null);
  assert.equal(unknownCp.students[0].stageScores.cp1Practice, null);
  observations.push({ id: 'S2-07', status: 'CLOSED', sourceHasNoCheckpointOrSessionIdentity: true,
    expectedCp1Theory: null, actualCp1Theory: unknownCp.students[0].stageScores.cp1Theory,
    actualCp1Practice: unknownCp.students[0].stageScores.cp1Practice });

  const demoSnapshot = (questions: any[], extraAreas: any[] = []) => pure.extractReportCardSnapshotFromGql({
    classId: 'CLASS_A', classCode: 'CLASS_A', classByIdGqlData: { students: [crm()], slots: [{ index: 13,
      studentAttendance: [{ student: crm().student, commentByAreas: [{ type: 'RATE', grade: 0 },
        { type: 'DEMO', demoQuestions: questions }, ...extraAreas] }] }] } });
  const defaults = demoSnapshot(Array.from({ length: 5 }, () => ({ score: 0 })));
  assert.equal(defaults.students[0].stageScores.finalProduct, null);
  const noteOnly = demoSnapshot(Array.from({ length: 5 }, () => ({ score: 0 })),
    [{ type: 'CONTENT', content: 'Con tham gia tích cực.' }]);
  assert.equal(noteOnly.students[0].stageScores.finalProduct, null);
  observations.push({ id: 'S2-08', status: 'CLOSED', ungradedDefaultsWithoutNote: null,
    ungradedDefaultsWithGeneralNote: noteOnly.students[0].stageScores.finalProduct,
    hasDemoCompletionEvidence: false });
  const blanks = demoSnapshot(Array.from({ length: 5 }, () => ({ score: '' })), [{ type: 'RATE', grade: 4 }]);
  assert.equal(blanks.students[0].stageScores.finalProduct, null);
  observations.push({ id: 'R2-01', status: 'CLOSED', severity: 'P2', expectedMissingDemo: null,
    blankDemoScores: ['', '', '', '', ''], actualFinalProduct: blanks.students[0].stageScores.finalProduct });

  // Confirm outer transaction rolls back an already-written snapshot if matrix persistence fails.
  const beforeSnapshot = dbmod.reportCardRepo.findOne('CLASS_A')!;
  const originalSave = dbmod.scoreMatrixRepo.save;
  try {
    dbmod.scoreMatrixRepo.save = () => { throw new Error('injected matrix persistence failure'); };
    const rollback = await harness().scraper.scrapeClassScores('CLASS_A');
    assert.equal(rollback.success, false);
    assert.equal(dbmod.reportCardRepo.findOne('CLASS_A')!.lmsSnapshotJson, beforeSnapshot.lmsSnapshotJson);
    assert.equal(dbmod.reportCardRepo.findOne('CLASS_A')!.draftVersion, beforeSnapshot.draftVersion);
    assert.equal(dbmod.scoreMatrixRepo.findByClass('CLASS_A')!.matrix.rows[0].cells.L1.score, 80);
    observations.push({ id: 'S2-03', status: 'CLOSED', secondWriteFailureRollsBackSnapshotAndVersion: true });
  } finally { dbmod.scoreMatrixRepo.save = originalSave; }

  for (const cid of ['CLASS_A', 'VT-ROB-AUDIT']) {
    for (const failure of [{ classError: true }, { noClass: true }]) {
      const prior = dbmod.reportCardRepo.findOne(cid)?.lmsSnapshotJson;
      const failed = await harness({ cid, ...failure }).scraper.scrapeClassScores(cid);
      assert.equal(failed.success, false);
      assert.equal(dbmod.reportCardRepo.findOne(cid)?.lmsSnapshotJson, prior);
    }
  }
  observations.push({ id: 'S2-01', status: 'CLOSED', codingAndRoboticsRejectGraphqlErrorsAndMissingCapture: true });

  const domMatrix = { columns: [{ colIndex: 0, columnId: 'L1', lessonId: 'L1', title: 'Homework 1', sessionNumber: 1 }],
    rows: [{ studentId: 'LOCAL_A', fullName: 'Student Alpha', isActive: true, cells: {
      L1: { columnId: 'L1', lessonId: 'L1', sessionNumber: 1, status: 'GRADED', score: 80, quizScore: 90, maxScore: 100 },
    }, averageScore: 80, gradedCount: 1, submittedUngradedCount: 0, notSubmittedCount: 0, redoCount: 0 }] };
  const dom = harness({ noSubmission: true });
  dom.scraper.scrapeFromDomGrid = async () => domMatrix;
  const domResult = await dom.scraper.scrapeClassScores('CLASS_A');
  assert.equal(domResult.success, true);
  assert.equal(domResult.reportCardSnapshot.students[0].btvnScores[1].practiceRaw, 80);
  assert.equal(domResult.reportCardSnapshot.students[0].btvnScores[1].theoryRaw, 90);
  observations.push({ id: 'S2-04', status: 'CLOSED', fullWorkerWithCrmRosterAndDomScores: true });

  const crossed = harness({ existing: [local, { ...local, studentId: 'LOCAL_B', fullName: 'Student Beta' }],
    cls: { id: A, name: 'CLASS_A', students: [crm(), crm('CRM_B', 'Student Beta')], slots: [] },
    submission: { lessons: [homework], students: [
      { id: 'CRM_A', studentUid: 'UID_A', displayName: 'Student Beta' },
      { id: 'CRM_B', studentUid: 'UID_B', displayName: 'Student Alpha' },
    ], submissions: [submission(90), { ...submission(20), id: 'B_SUB', studentUid: 'UID_B' }] } });
  const crossedResult = await crossed.scraper.scrapeClassScores('CLASS_A');
  assert.equal(crossedResult.success, true);
  for (const [id, expected] of [['LOCAL_A', 90], ['LOCAL_B', 20]]) {
    assert.equal(crossedResult.rows.find((s: any) => s.studentId === id).cells.L1.score, expected);
    assert.equal(crossedResult.reportCardSnapshot.students.find((s: any) => s.studentId === id).btvnScores[1].practiceRaw, expected);
  }
  observations.push({ id: 'S2-05', status: 'CLOSED', crossedAliasesPreserveBothMatrixAndSnapshotIdentity: true });

  const sameNames = harness({ existing: [],
    cls: { id: A, name: 'CLASS_A', students: [crm('CRM_A', 'Same Name'), crm('CRM_B', 'Same Name')], slots: [] },
    submission: { ...payload(80), students: [{ id: 'CRM_A', studentUid: 'UID_A', displayName: 'Same Name' }] } });
  const sameNamesResult = await sameNames.scraper.scrapeClassScores('CLASS_A');
  assert.equal(sameNamesResult.success, true);
  assert.equal(sameNamesResult.rows.length, 2);
  assert.equal(sameNamesResult.reportCardSnapshot.students.length, 2);
  observations.push({ id: 'S2-06', status: 'CLOSED', distinctCrmIdsWithSameNameInBothOutputs: true });

  // S2-09: Small source payloads, DOM source, and explicit opt-in.
  for (const nums of [[5], [9], [5, 9]]) {
    const columns = nums.map((n) => ({ columnId: `L${n}`, title: `Homework ${n}`, sessionNumber: n }));
    for (const fromDom of [false, true]) {
      const params: any = { classId: 'CLASS_A', classCode: 'CLASS_A', ...(fromDom ? { fallbackMatrix: { columns, rows: [] } }
        : { submissionGqlData: { lessons: nums.map((n) => ({ id: `L${n}`, name: `Homework ${n}` })), students: [], submissions: [] } }) };
      assert.equal(pure.extractReportCardSnapshotFromGql(params).btvnSessions.length, 0);
      assert.equal(pure.extractReportCardSnapshotFromGql({ ...params, includeCheckpointSessionBtvn: true }).btvnSessions.length, nums.length);
    }
  }
  observations.push({ id: 'S2-09', status: 'CLOSED', smallGraphqlAndDomPayloadsAndOptIn: true });
  const evidence = JSON.stringify({ observations }, null, 2) + '\n';
  fs.writeFileSync(assertPathAllowed(path.resolve('docs/audits/v330/stage2-round2/observations.json')), evidence);
  console.log(evidence);
} finally { dbmod.closeDb(); }
