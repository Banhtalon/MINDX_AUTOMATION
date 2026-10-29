// Additional audit cases absent from RC-04C. Exit 0 confirms recorded observations,
// including reproduced defects; it is not a closure verdict.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { assertPathAllowed } from '../../../../src/lib/security/path-allowlist';
import * as calculator from '../../../../src/lib/report-card/report-card-calculator';

assert.ok(process.env.MINDX_DB_PATH, 'An isolated database override is required');
assert.ok(process.env.MINDX_RUNNING_CLASSES_PATH, 'An isolated cache override is required');
assert.notEqual(path.resolve(process.env.MINDX_DB_PATH!), path.resolve('data/mindx_bot.db'));
assert.notEqual(path.resolve(process.env.MINDX_RUNNING_CLASSES_PATH!), path.resolve('data/running_classes.json'));
const dbmod = await import('../../../../src/lib/db/sqlite');
const source = fs.readFileSync(assertPathAllowed(path.resolve('src/lib/playwright/scrape-scores.ts')), 'utf8');
const js = stripTypeScriptTypes(source)
  .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, '')
  .replace(/\bexport\s+/g, '');
const classLmsId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const crm = { student: { id: 'CRM_A', fullName: 'Student Alpha' }, activeInClass: true };
const local = { classId: 'CLASS_A', studentId: 'LOCAL_A', fullName: 'Student Alpha', isActive: 1 };
const student = { id: 'CRM_A', studentUid: 'UID_A', displayName: 'Student Alpha' };
const submission = (id: string, score: number, category = 'PRACTICE_TASK1') => ({
  id: `${id}_${category}`, lessonId: id, studentUid: 'UID_A', category,
  type: category === 'QUIZ' ? 'QUIZ' : 'UPLOAD_FILE', status: 'MARKED', score,
});

function harness(cid: string, staleClassOnly: boolean) {
  const listeners = new Map<string, Set<any>>();
  const events: string[] = [];
  const request = (operationName: string) => ({ method: () => 'POST',
    postDataJSON: () => ({ operationName, variables: operationName === 'GetClassById'
      ? { id: classLmsId } : { payload: { classId: classLmsId } } }) });
  // This stable object predates scrapeClassScores. Its request event is never emitted.
  const preexistingClassRequest = request('GetClassById');
  async function emitResponse(req: any, payload: any) {
    const op = req.postDataJSON().operationName;
    const response = { url: () => 'https://lms-api.mindx.edu.vn/graphql', status: () => 200,
      request: () => req, json: async () => ({ data: {
        [op === 'GetClassById' ? 'classesById' : 'findStudentSubmissionByClass']: payload,
      } }) };
    for (const listener of listeners.get('response') || []) await listener(response);
  }
  async function emitRequest(req: any) {
    for (const listener of listeners.get('request') || []) await listener(req);
  }
  const empty: any = { first() { return this; }, locator() { return this; },
    count: async () => 0, isVisible: async () => false, innerText: async () => cid,
    getAttribute: async () => 'false', scrollIntoViewIfNeeded: async () => {}, click: async () => {} };
  const tab = { ...empty, count: async () => 1, click: async () => {
    const req = request('FindStudentSubmissionByClass');
    events.push('fresh submission request'); await emitRequest(req);
    events.push('fresh submission response'); await emitResponse(req, {
      lessons: [{ id: 'L1', name: 'Homework 1', type: 'REVIEW_AND_PRACTICE', displayOrder: 1 }],
      students: [student], submissions: [submission('L1', 80)],
    });
  } };
  const drawer = { ...empty, locator: (s: string) => s.includes('#tab-3') ? tab : empty };
  const page: any = { locator: () => drawer, waitForTimeout: async () => {},
    url: () => 'https://lms.mindx.edu.vn/admin/classes', keyboard: { press: async () => {} },
    on: (event: string, listener: any) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    }, off: (event: string, listener: any) => { listeners.get(event)?.delete(listener); } };
  const sb: any = { console, Date, Math, Map, Set, JSON, RegExp, Error, Array, Object, Number, String, Boolean,
    parseInt, parseFloat, setTimeout, ...calculator, isRoboticsClassCode: dbmod.isRoboticsClassCode,
    getDb: dbmod.getDb, authService: { ensureAuthenticated: async () => {} },
    BrowserManager: { getInstance: () => ({ getPage: async () => page }) },
    createNetworkInterceptor: () => ({ dismissForbiddenToast: async () => {} }),
    LmsHelpers: { openClassDrawer: async () => {
      const req = staleClassOnly ? preexistingClassRequest : request('GetClassById');
      if (!staleClassOnly) { events.push('fresh class request'); await emitRequest(req); }
      events.push(staleClassOnly ? 'stale class response before first fresh request' : 'fresh class response');
      const score = staleClassOnly ? 5 : 4;
      await emitResponse(req, { id: classLmsId, name: cid, students: [crm], slots: [{
        index: cid.includes('ROB') ? 3 : 4, studentAttendance: [{ student: crm.student,
          commentByAreas: [{ type: 'CHECKPOINT', checkpoint: { checkpointScore: score, practiceScore: score } }],
        }],
      }] });
    }, switchDrawerTab: async () => {} }, SELECTORS: { tabs: { grading: '' } },
    studentRepo: { findByClass: () => [{ ...local, classId: cid }] }, jobLogRepo: { add() {} },
    session14EvalRepo: { findByClass: () => [] }, reportCardRepo: dbmod.reportCardRepo,
    scoreMatrixRepo: dbmod.scoreMatrixRepo,
  };
  vm.createContext(sb); vm.runInContext(js + '\nglobalThis.scraper = ScoreScraper;', sb);
  return { scraper: sb.scraper, events };
}

const observations: any[] = [];
try {
  for (const cid of ['CLASS_A', 'VT-ROB-AUDIT']) {
    const seeded = await harness(cid, false).scraper.scrapeClassScores(cid);
    assert.equal(seeded.success, true);
    assert.equal(seeded.reportCardSnapshot.students[0].stageScores.cp1Theory, 4);
    const stale = harness(cid, true);
    const result = await stale.scraper.scrapeClassScores(cid);
    // Closure assertion: without any fresh GetClassById request, scrape fails and preserves prior CP1=4.
    assert.equal(result.success, false);
    const persisted = JSON.parse(dbmod.reportCardRepo.findOne(cid)!.lmsSnapshotJson);
    assert.equal(persisted.students[0].stageScores.cp1Theory, 4);
    const cached: any = dbmod.scoreMatrixRepo.findByClass(cid)!.matrix;
    assert.equal(cached.reportCardSnapshot.students[0].stageScores.cp1Theory, 4);
    observations.push({ id: 'S2-02', status: 'CLOSED', cid, events: stale.events,
      expectedSuccess: false, actualSuccess: result.success, priorCp1: 4,
      persistedCp1: persisted.students[0].stageScores.cp1Theory,
      cachedCp1: cached.reportCardSnapshot.students[0].stageScores.cp1Theory, freshGetClassByIdRequests: 0 });
  }

  const pure = harness('CLASS_A', false).scraper;
  for (const position of [5, 9]) {
    const lessonId = 'opaque-lesson';
    const lessons = Array.from({ length: position - 1 }, (_, i) => ({
      id: `L${i + 1}`, name: `Homework ${i + 1}`, type: 'REVIEW_AND_PRACTICE',
    }));
    const snap = pure.extractReportCardSnapshotFromGql({ classId: 'CLASS_A', classCode: 'CLASS_A',
      submissionGqlData: { lessons: [...lessons, { id: lessonId, type: 'CHECKPOINT' }],
        students: [student], submissions: [submission(lessonId, 80, 'QUIZ'), submission(lessonId, 60)] } });
    const stage = position === 5 ? 'cp1Theory' : 'cp2Theory';
    assert.equal(snap.students[0].stageScores[stage], null);
    observations.push({ id: 'S2-07', status: 'CLOSED', position, checkpointHasName: false,
      checkpointHasSession: false, checkpointHasDisplayOrder: false, stage,
      expectedTheory: null, actualTheory: snap.students[0].stageScores[stage] });
  }

  function demo(score: unknown, rate: number, extra: any[] = []) {
    return pure.extractReportCardSnapshotFromGql({ classId: 'CLASS_A', classCode: 'CLASS_A',
      classByIdGqlData: { students: [crm], slots: [{ index: 13, studentAttendance: [{
        student: crm.student, commentByAreas: [{ type: 'RATE', grade: rate },
          { type: 'DEMO', demoQuestions: Array.from({ length: 5 }, () => ({ score })) }, ...extra],
      }] }] } }).students[0].stageScores.finalProduct;
  }
  for (const score of ['', '   ', null, undefined, true, false]) assert.equal(demo(score, 4), null);
  assert.equal(demo(0, 4), 0);
  assert.equal(demo('0', 4), 0);
  assert.equal(demo(0, 0), null);
  assert.equal(demo(0, 0, [{ type: 'CONTENT', content: 'Con tham gia tích cực.' }]), null);
  observations.push({ id: 'S2-08', status: 'CLOSED', generalContentDoesNotGradeDefaultZeros: true });
  observations.push({ id: 'R2-01', status: 'CLOSED', blankWhitespaceNullUndefinedAndBooleansStayMissing: true,
    explicitNumericAndStringZeroPreserved: true });
  const evidence = JSON.stringify({ observations }, null, 2) + '\n';
  fs.writeFileSync(assertPathAllowed(path.resolve('docs/audits/v330/stage2-round3/observations.json')), evidence);
  console.log(evidence);
} finally { dbmod.closeDb(); }
