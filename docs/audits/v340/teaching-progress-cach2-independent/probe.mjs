import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

// Reviewer-authored oracle: count DISTINCT Teaching tasks with positive progress
// from a current, assigned, active learner. No progress is raised or sent online.
const root = process.cwd();
const out = path.join(root, 'docs/audits/v340/teaching-progress-cach2-independent');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mindx-cach2-independent-'));
const realMode = process.argv.includes('--real');
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const protectedFiles = ['data/mindx_bot.db', 'data/running_classes.json'];
const before = Object.fromEntries(protectedFiles.map(p => [p, hash(path.join(root, p))]));
process.env.ALLOWED_LOCAL_DIRS = sandbox;
process.env.MINDX_DB_PATH = path.join(sandbox, realMode ? 'snapshot.sqlite' : 'synthetic.sqlite');
process.env.MINDX_RUNNING_CLASSES_PATH = path.join(sandbox, 'running.json');

const { assertPathAllowed } = await import('../../../../src/lib/security/path-allowlist.ts');
if (realMode) {
  // Open the supplied real snapshot READ ONLY; all application reads/migrations use its backup.
  const original = new Database(assertPathAllowed(path.join(root, protectedFiles[0])), { readonly: true, fileMustExist: true });
  try { await original.backup(process.env.MINDX_DB_PATH); } finally { original.close(); }
  fs.copyFileSync(assertPathAllowed(path.join(root, protectedFiles[1])), process.env.MINDX_RUNNING_CLASSES_PATH);
} else {
  fs.writeFileSync(process.env.MINDX_RUNNING_CLASSES_PATH, '[]');
}

const { getDb, closeDb, teachingProjectRepo } = await import('../../../../src/lib/db/sqlite.ts');
const { hasClassUpdatedTeachingProgressForSession: helper, getDashboardTodayTodoCards: dashboard, buildClassTodayTodoCard: buildCard } = await import('../../../../src/lib/dashboard/today-tasks.ts');
const db = getDb();
const results = [];
function check(id, fn) {
  try { const observed = fn(); results.push({ id, status: 'PASS', observed }); }
  catch (e) { results.push({ id, status: e.code === 'ERR_ASSERTION' ? 'FAIL' : 'ERROR', message: e.message, actual: e.actual, expected: e.expected }); }
  console.log(`${results.at(-1).status} ${id}`);
}
const tasks = (assigned = [1, 2, 3, 4, 5]) => Array.from({ length: 5 }, (_, i) => ({ taskId: 101 + i, taskName: `Task ${i + 1}`, weightPercent: 20, assignedStudentIds: assigned }));
const roster = [
  { id: 1, status: 'Đang học' }, { id: 2, status: 'Đang học' },
  { id: 3, status: 'Bảo lưu' }, { id: 4, status: 'Nghỉ học' }, { id: 5, status: 'inactive' },
];
const json = JSON.stringify;
const makeProgress = (ids, studentId = 1, value = 1) => Object.fromEntries(ids.map(tid => [`${tid}_${studentId}`, value]));
const requiredBySession = { 11: 1, 12: 3, 13: 4, 14: 5 };
const oracle = (n, ts, pm, ss) => {
  const active = new Set(ss.filter(s => !/bảo lưu|nghỉ học|inactive/i.test(s.status || '')).map(s => Number(s.id)));
  const positive = new Set(ts.filter(t => Number.isInteger(t.taskId) && t.taskId > 0 &&
    (t.assignedStudentIds || []).some(sid => active.has(Number(sid)) && Number.isFinite(Number(pm[`${t.taskId}_${sid}`])) && Number(pm[`${t.taskId}_${sid}`]) > 0)).map(t => t.taskId));
  return positive.size >= requiredBySession[n];
};

function seedClass(n) {
  const cls = `VT-C4K-PTA98${n}`;
  fs.writeFileSync(process.env.MINDX_RUNNING_CLASSES_PATH, json([{ classCode: cls, className: cls, status: 'Running', currentSessionNumber: n }]));
  db.prepare('INSERT INTO classes_sessions(classId,className,sessionId,sessionNumber,date) VALUES(?,?,?,?,?)').run(cls, cls, `${cls}_SESS_${n}`, n, '10/11/2026');
  for (const sid of ['A', 'B']) {
    db.prepare('INSERT INTO students(classId,studentId,fullName,isActive) VALUES(?,?,?,1)').run(cls, sid, `Synthetic ${sid}`);
    db.prepare("INSERT INTO session_feedbacks(classId,studentId,sessionId,attendanceStatus,status,finalText) VALUES(?,?,?,'PRESENT','VERIFIED','Synthetic verified comment')").run(cls, sid, `${cls}_SESS_${n}`);
    if (n >= 12) db.prepare("INSERT INTO spck_session_submissions(classId,studentId,sessionNumber,draftStatus) VALUES(?,?,?,'VERIFIED')").run(cls, sid, n);
    if (n === 14) db.prepare("INSERT INTO spck_session14_evaluations(classId,studentId,status,updatedAt) VALUES(?,?,'VERIFIED','2026-11-01 00:00:00')").run(cls, sid);
  }
  if (n === 14) db.prepare("INSERT INTO class_report_cards(classId,classCode,status,teachingSyncStatus,lmsSnapshotJson,updatedAt) VALUES(?,?,'VERIFIED','VERIFIED',?,'2026-11-10 12:00:00')").run(cls, cls, json({ scrapedAt: '2026-11-10T12:00:00.000Z' }));
  db.prepare("INSERT INTO teaching_final_projects(classId,status) VALUES(?,'VERIFIED')").run(cls);
  return cls;
}

if (!realMode) {
  for (const [rawN, required] of Object.entries(requiredBySession)) {
    const n = Number(rawN), cls = seedClass(n);
    const ids = Array.from({ length: required }, (_, i) => 101 + i);
    const positive = makeProgress(ids);
    const cases = [
      ['none', tasks(), {}, roster],
      ['insufficient-updated-tasks', tasks(), makeProgress(ids.slice(0, -1)), roster],
      ['enough-at-1-percent-other-active-at-zero', tasks(), positive, roster],
      ['enough-mixed-below-100', tasks(), { ...makeProgress(ids, 1, 25), ...makeProgress(ids, 2, 60) }, roster],
      ['only-reserved-student', tasks(), makeProgress(ids, 3, 100), roster],
      ['only-withdrawn-student', tasks(), makeProgress(ids, 4, 100), roster],
      ['only-inactive-student', tasks(), makeProgress(ids, 5, 100), roster],
      ['active-not-assigned', tasks([2]), positive, roster],
      ['explicit-no-assignees-with-stale-progress', tasks([]), positive, roster],
      ['assignee-no-longer-in-current-roster', tasks([99]), makeProgress(ids, 99, 100), roster],
      ['too-few-real-task-ids', tasks().map((t, i) => i >= required - 1 ? { ...t, taskId: null } : t), positive, roster],
      ['non-first-tasks-count-too', tasks(), makeProgress(Array.from({length: required}, (_, i) => 105 - i)), roster],
    ];
    for (const [name, ts, pm, ss] of cases) {
      const expected = oracle(n, ts, pm, ss);
      const params = { sessionNumber: n, tasksJson: json(ts), progressJson: json(pm), studentsJson: json(ss) };
      check(`HELPER-S${n}-${name}`, () => { const actual = helper(params); assert.equal(actual, expected); return { actual, expected }; });
      db.prepare('UPDATE teaching_final_projects SET tasksJson=?,progressJson=?,studentsJson=? WHERE classId=?').run(params.tasksJson, params.progressJson, params.studentsJson, cls);
      check(`DASH-S${n}-${name}`, () => {
        const card = dashboard({ includeSynthetic: true, limit: 100 }).find(c => c.classId === cls);
        assert.ok(card, 'class missing'); assert.equal(card.currentSessionNumber, n);
        const step = card.steps.find(s => s.href.startsWith('/teaching-projects'));
        assert.ok(step); assert.equal(step.isDone, expected, 'progress isDone'); assert.equal(card.allDone, expected, 'allDone');
        assert.deepEqual(JSON.parse(db.prepare('SELECT progressJson FROM teaching_final_projects WHERE classId=?').get(cls).progressJson), pm, 'dashboard must not raise any progress');
        return { step, allDone: card.allDone };
      });
    }
    for (const [name, badJson] of [['broken-json', '{'], ['array', '[]'], ['null', 'null']]) {
      check(`HELPER-S${n}-${name}`, () => { assert.equal(helper({ sessionNumber: n, tasksJson: json(tasks()), progressJson: badJson, studentsJson: json(roster) }), false); });
    }
    // A true/false result from the new rule must override the old weighted-percent threshold.
    for (const flag of [true, false]) check(`CARD-S${n}-explicit-${flag}-overrides-percent`, () => {
      const c = buildCard({ classId: cls, currentSessionNumber: n, teachingSessionProgressUpdated: flag, teachingProgressPercent: flag ? 1 : 100 });
      assert.equal(c.steps.find(s => s.href.startsWith('/teaching-projects')).isDone, flag);
    });
  }
  // Actual repository flow: deselect all learners while retaining the last remote progress snapshot.
  check('REPO-explicit-deselection-preserves-stale-progress-but-must-not-complete', () => {
    const cls = 'VT-C4K-PTA9814';
    const current = teachingProjectRepo.findOne(cls);
    const oldProgress = makeProgress([101, 102, 103, 104, 105], 1, 100);
    db.prepare('UPDATE teaching_final_projects SET tasksJson=?,studentsJson=?,progressJson=? WHERE classId=?').run(json(tasks([1, 2])), json(roster), json(oldProgress), cls);
    const saved = teachingProjectRepo.saveDraft({ classId: cls, tasks: tasks([]) });
    assert.equal(saved.success, true, 'saveDraft failed');
    const row = teachingProjectRepo.findOne(cls);
    assert.deepEqual(JSON.parse(row.progressJson), oldProgress, 'cached progress stays after deselection');
    assert.ok(JSON.parse(row.tasksJson).every(t => t.assignedStudentIds.length === 0));
    const c = dashboard({ includeSynthetic: true, limit: 100 }).find(c => c.classId === cls);
    assert.equal(c.steps.find(s => s.href.startsWith('/teaching-projects')).isDone, false);
    return { priorVersion: current.draftVersion, savedVersion: row.draftVersion };
  });
  // A normal remote refresh updates the roster/progress while preserving saved task assignments.
  // Reproduce a removed learner still present in the historical task/progress snapshot.
  const serviceCaseId = 'SERVICE-roster-refresh-removes-learner-but-historical-progress-must-not-complete';
  try {
    const cls = 'VT-C4K-PTA9814';
    const pm = makeProgress([101, 102, 103, 104, 105], 99, 100);
    db.prepare('UPDATE teaching_final_projects SET tasksJson=?,studentsJson=?,progressJson=? WHERE classId=?').run(json(tasks([1, 99])), json([{ id: 1, status: 'Đang học' }, { id: 99, status: 'Đang học' }]), json(pm), cls);
    const { TeachingProjectService } = await import('../../../../src/lib/playwright/teaching-project-service.ts');
    const transport = {
      getProject: async () => ({ id: 9, class_code: cls, project_name: 'Synthetic', start_date: '2026-08-01', end_date: '2026-11-10', description: '' }),
      getStudents: async () => [{ id: 1, student_name: 'Synthetic A', class_code: cls, status: 'Đang học' }],
      getTasks: async () => tasks([1]).map(t => ({ ...t, id: t.taskId, project_id: 9, task_name: t.taskName, assigned_students: [1], weight_percent: 20, deadline: '2026-11-10' })),
      getTaskProgress: async () => pm,
    };
    const loaded = await TeachingProjectService.loadClassProject(cls, { transport });
    check(serviceCaseId, () => {
      assert.equal(loaded.success, true);
      const row = teachingProjectRepo.findOne(cls);
      assert.deepEqual(JSON.parse(row.studentsJson).map(s => s.id), [1]);
      assert.ok(JSON.parse(row.tasksJson).every(t => t.assignedStudentIds.includes(99)));
      const card = dashboard({ includeSynthetic: true, limit: 100 }).find(c => c.classId === cls);
      assert.equal(card.steps.find(s => s.href.startsWith('/teaching-projects')).isDone, false);
    });
  } catch (e) { results.push({ id: serviceCaseId, status: 'ERROR', message: e.message }); }
} else {
  for (const [cls, expectedSession] of [['VT-C4K-PTA13', 12], ['VT-C4K-GA38', 13]]) {
    check(`SNAPSHOT-${cls}-session-and-progress`, () => {
      const row = db.prepare('SELECT tasksJson,progressJson,studentsJson FROM teaching_final_projects WHERE classId=?').get(cls);
      assert.ok(row, 'Teaching project missing');
      const ts = JSON.parse(row.tasksJson), pm = JSON.parse(row.progressJson), ss = JSON.parse(row.studentsJson);
      const card = dashboard({ limit: 100 }).find(c => c.classId === cls);
      assert.ok(card, 'class missing from dashboard'); assert.equal(card.currentSessionNumber, expectedSession);
      const expected = oracle(expectedSession, ts, pm, ss);
      assert.equal(expected, true, 'Owner named class should meet milestone');
      assert.equal(helper({ sessionNumber: expectedSession, ...row }), expected);
      const step = card.steps.find(s => s.href.startsWith('/teaching-projects'));
      assert.equal(step.isDone, expected); assert.equal(card.allDone, true, 'Owner named class should be in Done group');
      return { classId: cls, session: card.currentSessionNumber, tasks: ts.map(t => ({ taskId: t.taskId, assignees: t.assignedStudentIds.length, positiveAssigneeCount: t.assignedStudentIds.filter(sid => Number(pm[`${t.taskId}_${sid}`]) > 0).length })), step, allDone: card.allDone, steps: card.steps };
    });
  }
}
closeDb();
const after = Object.fromEntries(protectedFiles.map(p => [p, hash(path.join(root, p))]));
check('PROTECTED-DATA-SHA256-UNCHANGED', () => { assert.deepEqual(after, before); return after; });
const counts = Object.fromEntries(['PASS', 'FAIL', 'ERROR'].map(s => [s, results.filter(r => r.status === s).length]));
fs.writeFileSync(path.join(out, realMode ? 'snapshot-results.json' : 'independent-results.json'), json({ mode: realMode ? 'read-only-source-backup' : 'synthetic', sandbox, counts, protectedHashes: { before, after }, results }, null, 2));
console.log(json(counts));
process.exitCode = counts.FAIL || counts.ERROR ? 1 : 0;
