// Independent Stage 4 closure verification probe (S4-01..S4-06 + Controls).
// Run via tsx with BOTH data overrides below TEMP. Does not read production data.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as calc from '../../../../src/lib/report-card/report-card-calculator.ts';
const require = createRequire(import.meta.url);
const { transformSync } = require('esbuild');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
for (const key of ['MINDX_DB_PATH', 'MINDX_RUNNING_CLASSES_PATH']) {
  const relative = path.relative(os.tmpdir(), path.resolve(process.env[key] || '.'));
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `${key} must be below TEMP`);
}
const observations = [];
function note(id, caseName, status, observed) { observations.push({ id, case: caseName, status, observed }); }
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const response = (data, ok = true) => ({ ok, json: async () => data });
function fixture(code, version = 2, options = {}) {
  const scores = {cp1Theory: 2, cp1Practice: 4, cp1Competency: 5,
    cp2Theory: 4, cp2Practice: 2, cp2Competency: 3, finalProduct: 5, finalCompetency: 1};
  const snapshot = {classId: code, classCode: code, isRobotics: false, scrapedAt: '2026-10-29T00:00:00Z',
    btvnSessions: [1, 2].map(n => ({sessionNumber: n, title: `Lesson ${n}`, hasTheory: true,
      hasPractice: true, practiceTaskCount: 2, maxTheoryScore: 100, maxPracticeScore: 100})),
    students: [{studentId: 'SHARED', fullName: `Pupil ${code}`, isActive: true,
      btvnScores: {1: {theoryRaw: 80, theoryMax: 100, practiceRaw: 60, practiceMax: 100,
        practiceTask1Raw: 40, practiceTask2Raw: 80},
        2: {theoryRaw: 20, theoryMax: 100, practiceRaw: null, practiceMax: 100}}, stageScores: scores}], ...options};
  return {success: true, record: {classId: code, classCode: code, draftVersion: version, status: 'APPROVED', contentHash: `hash-${code}-${version}`},
    snapshot, overrides: {}, reportCard: calc.computeClassReportCard(snapshot)};
}
function canvasFactory() {
  const calls = [];
  const context = new Proxy({}, { get(t, key) { if (key in t) return t[key]; return (...args) => calls.push({op: key, args, color: t.fillStyle, stroke: t.strokeStyle}); },
    set(t, k, v) { t[k] = v; return true; } });
  return {calls, width: 0, height: 0, getContext: () => context,
    toBlob: cb => cb({type: 'image/png'}), toDataURL: () => 'data:image/png;base64,stub'};
}
const exposed = ['record','snapshot','overrides','computedReportCard','selectedBtvnSessions','isLoading','errorMsg','toastMsg','overrideModal',
  'loadReportCard','handleScrapeFromLms','handleApproveReportCard','handleSyncToTeaching','handleSaveManualOverride',
  'handleClearSingleOverride','handleResetAllOverrides','openOverrideEditor','setOverrideInputValue','setOverrideInputMode',
  'setSelectedBtvnSessions','setStageFilter','setScaleMode','setShowFormulaModal','setActiveChartModal','setChartVisibility',
  'handleCopyTsvToSheets','handleCopyBlockImageToZalo','handleCopyChartImage','handleSortColumn','sortedStudents','chartCanvasRef'];
function harness(fetchImpl, props = {}, parent = false) {
  let source = fs.readFileSync(path.join(root, parent ? 'src/app/homework-grader/page.tsx' : 'src/components/teaching-report-card-view.tsx'), 'utf8');
  let names = exposed;
  let component = 'TeachingReportCardView';
  if (parent) {
    source = source.slice(0, source.indexOf('  const renderCellBadge ='));
    names = ['handleScrapeScores', 'statusMessage']; component = 'HomeworkGraderPage';
    source += `\nglobalThis.api = {${names}}; return null; }`;
  } else {
    const marker = '\n  return (\n    <div className="space-y-5">';
    assert.ok(source.includes(marker));
    source = source.replace(marker, `\nglobalThis.api = {${names}};${marker}`);
  }
  source = source.replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, '')
    .replace(/\bexport\s+default\s+/g, '').replace(/\bexport\s+/g, '');
  const js = transformSync(source, {loader: 'tsx', target: 'es2022', jsx: 'transform'}).code;
  const slots = [], dependencies = [], memoValues = [], cleanups = [];
  let cursor = 0, dirty = true, pending = [], tree;
  const canvases = [], clipboard = [];
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { const next = typeof value === 'function' ? value(slots[i]) : value;
        if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = {current: initial}; return slots[i]; },
    useEffect(fn, deps) { const i = cursor++; if (changed(dependencies[i], deps)) { dependencies[i] = deps; pending.push(() => { cleanups[i]?.(); cleanups[i] = fn(); }); } },
    useMemo(fn, deps) { const i = cursor++; if (changed(dependencies[i], deps)) { dependencies[i] = deps; memoValues[i] = fn(); } return memoValues[i]; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); }
  };
  const context = vm.createContext({console, ...calc, ...hooks, setTimeout, clearTimeout, encodeURIComponent,
    fetch: fetchImpl,
    React: {...hooks, Fragment: 'fragment', createElement(type, props, ...children) {
      if (type === 'canvas' && props?.ref) { if (!props.ref.current) props.ref.current = canvasFactory(); }
      return {type, props: {...props, children}};
    }},
    navigator: {clipboard: {writeText: async text => clipboard.push(text), write: async image => clipboard.push(image)}},
    window: {devicePixelRatio: 2, ClipboardItem: class {constructor(obj) {this.obj = obj;}}, localStorage: {getItem: () => null, setItem() {}}},
    document: {createElement(type) {if (type === 'canvas') {const c = canvasFactory(); canvases.push(c); return c;} return {click() {}};}}
  });
  vm.runInContext(js + `\nglobalThis.render = ${component};`, context);
  let currentProps = {classId: 'A', classCode: 'A', ...props};
  const flush = async () => { for (let n = 0; n < 12; n++) { await new Promise(r => setImmediate(r));
    if (dirty) { dirty = false; cursor = 0; tree = context.render(currentProps); const effects = pending; pending = []; effects.forEach(fn => fn()); } } };
  return {get api() {return context.api;}, get tree() {return tree;}, canvases, clipboard, flush,
    props(next) {currentProps = {...currentProps, ...next}; dirty = true;},
    unmount() {cleanups.forEach(fn => fn?.());}};
}
function nodes(tree) {if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];}
function textOf(tree) {if (tree === null || tree === undefined || typeof tree === 'boolean') return '';
  if (Array.isArray(tree)) return tree.map(textOf).join(''); if (typeof tree !== 'object') return String(tree);
  return textOf(tree.props?.children);}

// Latest-load control: stale GET A must not replace B.
{
  const old = defer(); const h = harness(url => String(url).includes('classId=A') ? old.promise : Promise.resolve(response(fixture('B'))));
  await h.flush(); h.props({classId: 'B', classCode: 'B'}); await h.flush(); old.resolve(response(fixture('A'))); await h.flush();
  assert.equal(h.api.record.classId, 'B'); note('CONTROL', 'late GET is correctly ignored', 'PASS', h.api.record.classId);
}
// S4-01: Every mutation handler is bound to class + operation generation and CANNOT overwrite a newer class payload (including A -> B and A -> B -> A).
for (const action of ['handleApproveReportCard','handleSyncToTeaching','handleSaveManualOverride','handleClearSingleOverride','handleResetAllOverrides','handleScrapeFromLms']) {
  const delayed = defer(); let waiting = false;
  const h = harness((url, options) => {if (options?.method) {waiting = true; return delayed.promise;}
    return Promise.resolve(response(fixture(new URL(String(url), 'http://local').searchParams.get('classId'))));});
  await h.flush();
  if (action.includes('Override') && !action.includes('All')) {
    h.api.openOverrideEditor({studentId: 'SHARED', studentName: 'Pupil A', fieldKey: 'cp1_theory', fieldLabel: 'CP1 LT', currentNorm: 2, currentRaw: 2, lmsNorm: 2, lmsRaw: 2, maxRawScore: 5, isBtvnField: false, isOverridden: true, note: ''});
    await h.flush();
  }
  const pending = h.api[action](); assert.equal(waiting, true);
  h.props({classId: 'B', classCode: 'B'}); await h.flush(); assert.equal(h.api.record.classId, 'B');
  delayed.resolve(response(fixture('A', 3))); await pending; await h.flush();
  assert.equal(h.api.record.classId, 'B'); assert.equal(h.api.snapshot.classId, 'B'); assert.ok(textOf(h.tree).includes('LỚP B'));
  note('S4-01', `late ${action} while B is selected is rejected`, 'CLOSED', {record: h.api.record.classId, snapshot: h.api.snapshot.classId, heading: 'B'});
}
// S4-02: Actual API proof — unseen B CANNOT be approved while B GET is still pending.
{
  const db = await import('../../../../src/lib/db/sqlite.ts');
  const {POST} = await import('../../../../src/app/api/report-card/route.ts');
  const {NextRequest} = await import('next/server');
  for (const code of ['AUDIT-S4-A', 'AUDIT-S4-B']) db.reportCardRepo.saveLmsSnapshot(code, fixture(code).snapshot);
  function actual(code) {const r = db.reportCardRepo.getOrInit(code); return {...fixture(code, r.draftVersion), record: r};}
  const delayed = defer(); let postCount = 0;
  const h = harness(async (url, options) => {
    if (options?.method === 'POST') {postCount++;
      const res = await POST(new NextRequest('http://127.0.0.1:3000/api/report-card', {method: 'POST', headers: {host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json'}, body: options.body}));
      return response(await res.json(), res.ok);
    }
    return String(url).includes('AUDIT-S4-B') ? delayed.promise : response(actual('AUDIT-S4-A'));
  }, {classId: 'AUDIT-S4-A', classCode: 'AUDIT-S4-A'});
  await h.flush(); h.props({classId: 'AUDIT-S4-B', classCode: 'AUDIT-S4-B'}); await h.flush();
  const approve = nodes(h.tree).find(n => n.type === 'button' && textOf(n).includes('Duyệt Phiếu Điểm'));
  assert.equal(approve.props.disabled, true); assert.equal(h.api.isLoading, true);
  assert.equal(h.api.record, null); await h.api.handleApproveReportCard(); await h.flush();
  const b = db.reportCardRepo.getOrInit('AUDIT-S4-B'); assert.equal(b.status, 'DRAFT'); assert.equal(postCount, 0);
  note('S4-02', 'unseen B is blocked from approval while B GET is loading', 'CLOSED', {postCount, status: b.status, loading: h.api.isLoading});
  delayed.resolve(response(actual('AUDIT-S4-B'))); await h.flush();
  assert.equal(h.api.record.classId, 'AUDIT-S4-B'); db.closeDb();
}
// S4-01: Stale A mutation during B load does NOT contaminate B's session filter.
{
  const mutation = defer(), getB = defer();
  const h = harness((url, opts) => opts?.method ? mutation.promise : String(url).includes('classId=B') ? getB.promise : Promise.resolve(response(fixture('A'))));
  await h.flush(); const saving = h.api.handleApproveReportCard();
  h.props({classId: 'B', classCode: 'B'}); await h.flush();
  mutation.resolve(response(fixture('A',3))); await saving; await h.flush();
  const b = fixture('B'); b.snapshot.btvnSessions.forEach(s => {s.sessionNumber += 5;});
  b.reportCard = calc.computeClassReportCard(b.snapshot); getB.resolve(response(b)); await h.flush();
  assert.equal(h.api.record.classId, 'B'); assert.deepEqual(Array.from(h.api.selectedBtvnSessions), [6,7]);
  assert.deepEqual(Array.from(h.api.computedReportCard.activeBtvnSessionNumbers), [6,7]);
  note('S4-01', 'late A action does not contaminate B session filter', 'CLOSED', {record: h.api.record.classId, selected: h.api.selectedBtvnSessions, effective: h.api.computedReportCard.activeBtvnSessionNumbers});
}
// S4-01: A stale same-class GET cannot regress a successful newer mutation.
{
  let slow = false; const old = defer();
  const h = harness((url, opts) => opts?.method ? Promise.resolve(response(fixture('A',3))) : slow ? old.promise : Promise.resolve(response(fixture('A',2))));
  await h.flush(); slow = true; const loading = h.api.loadReportCard('A');
  await h.api.handleApproveReportCard(); await h.flush(); assert.equal(h.api.record.draftVersion, 3);
  old.resolve(response(fixture('A',2))); await loading; await h.flush(); assert.equal(h.api.record.draftVersion, 3);
  note('S4-01', 'same-class late GET cannot regress post-mutation version', 'CLOSED', {expected: 3, actual: h.api.record.draftVersion});
}
// S4-03: An editor opened at v2 rejects stale save after background refresh to v3, preserving v3 score and unsaved input.
{
  let current = fixture('A', 2); let body = null;
  const h = harness((url, options) => {if (options?.method) {body = JSON.parse(options.body); return Promise.resolve(response(current));} return Promise.resolve(response(current));});
  await h.flush(); h.api.openOverrideEditor({studentId: 'SHARED', studentName: 'Pupil A', fieldKey: 'cp1_theory', fieldLabel: 'CP1 LT', currentNorm: 2, currentRaw: 2, lmsNorm: 2, lmsRaw: 2, maxRawScore: 5, isBtvnField: false, note: ''}); await h.flush();
  current = fixture('A', 3); current.snapshot.students[0].stageScores.cp1Theory = 5;
  current.reportCard = calc.computeClassReportCard(current.snapshot);
  await h.api.loadReportCard('A'); await h.flush(); assert.equal(h.api.computedReportCard.students[0].cp1.theory.value, 5);
  await h.api.handleSaveManualOverride(); await h.flush();
  assert.equal(body, null); assert.ok(h.api.errorMsg && h.api.errorMsg.includes('v3'));
  assert.equal(h.api.computedReportCard.students[0].cp1.theory.value, 5);
  assert.ok(h.api.overrideModal !== null);
  note('S4-03', 'editor opened at v2 rejects stale save after refresh to v3', 'CLOSED', {errorMsg: h.api.errorMsg, scorePreserved: h.api.computedReportCard.students[0].cp1.theory.value});
}
// S4-04: Explicit empty BTVN session selection stays empty (0 sessions) without silently selecting all sessions.
{
  const h = harness(async () => response(fixture('A'))); await h.flush();
  h.api.setSelectedBtvnSessions([1]); await h.flush(); assert.deepEqual(Array.from(h.api.computedReportCard.activeBtvnSessionNumbers), [1]);
  note('CONTROL', 'subset BTVN filter and average', 'PASS', {active: h.api.computedReportCard.activeBtvnSessionNumbers, avg: h.api.computedReportCard.students[0].btvnAvgNorm});
  h.api.setSelectedBtvnSessions([]); await h.flush();
  assert.deepEqual(Array.from(h.api.computedReportCard.activeBtvnSessionNumbers), []);
  assert.equal(h.api.computedReportCard.students[0].btvnAvgNorm, null);
  note('S4-04', 'unchecking final selected session keeps 0 active sessions', 'CLOSED', {selected: h.api.selectedBtvnSessions, effective: h.api.computedReportCard.activeBtvnSessionNumbers});
}
// S4-05: Integrated callback path propagates parent scrape failure and reload failure without false success toast.
{
  const parent = harness(async () => response({success: false, error: 'synthetic scrape rejected'}, false), {}, true);
  await parent.flush(); const h = harness(async () => response(fixture('A')), {onRequestScrapeLms: () => parent.api.handleScrapeScores()});
  await h.flush(); await h.api.handleScrapeFromLms(); await parent.flush(); await h.flush();
  assert.equal(parent.api.statusMessage.type, 'error'); assert.equal(h.api.toastMsg, null); assert.ok(h.api.errorMsg && h.api.errorMsg.includes('synthetic scrape rejected'));
  note('S4-05', 'parent scrape failure produces child error without success toast', 'CLOSED', {parent: parent.api.statusMessage, childError: h.api.errorMsg, childToast: h.api.toastMsg});
}
{
  let failing = false; const h = harness(async () => failing ? response({success:false,error:'reload failed'}, false) : response(fixture('A')),
    {onRequestScrapeLms: async () => {failing = true; return {success: true};}});
  await h.flush(); await h.api.handleScrapeFromLms(); await h.flush();
  assert.equal(h.api.errorMsg, 'reload failed'); assert.equal(h.api.toastMsg, null);
  note('S4-05', 'failed post-scrape read suppresses success toast', 'CLOSED', {error: h.api.errorMsg, toast: h.api.toastMsg});
}
// S4-06: Formula/rank text and missing-component tooltip match calculator weights (40/60 CP, 60/40 DEMO, 40/60 TBCK) and rank thresholds (4.50 / 4.00 / 2.50).
{
  const h = harness(async () => response(fixture('A'))); await h.flush(); h.api.setShowFormulaModal(true); await h.flush();
  const text = textOf(h.tree); const row = h.api.computedReportCard.students[0];
  assert.ok(text.includes('Tổng_CP = round(TB_chưa_làm_tròn(LT, TH) × 0.4 + Năng_Lực × 0.6, 2)'));
  assert.ok(text.includes('Tổng_DEMO = round(Sản_Phẩm × 0.6 + Năng_Lực × 0.4, 2)'));
  assert.ok(text.includes('Điểm_TBCK = round(TB_chưa_làm_tròn(Tổng_CP1, Tổng_CP2) × 0.4 + Tổng_DEMO × 0.6, 2)'));
  assert.ok(text.includes('Hạng A ≥ 4.50'));
  assert.ok(text.includes('Hạng B ≥ 4.00'));
  assert.equal(row.cp1.total, 4.2); assert.equal(row.final.total, 3.4); assert.equal(row.tbck, 3.48);
  note('S4-06', 'displayed formulas and legend match calculator 100%', 'CLOSED', {cp1: row.cp1.total, demo: row.final.total, tbck: row.tbck});
  const f = fixture('A'); for (const k of Object.keys(f.snapshot.students[0].stageScores)) f.snapshot.students[0].stageScores[k] = 5;
  f.snapshot.students[0].stageScores.cp1Theory = null;
  f.reportCard = calc.computeClassReportCard(f.snapshot);
  const hMissing = harness(async () => response(f)); await hMissing.flush();
  const r = hMissing.api.computedReportCard.students[0]; assert.equal(r.hang, 'Hạng C');
  const badge = nodes(hMissing.tree).find(n => n.type === 'span' && textOf(n) === 'Hạng C');
  assert.ok(badge.props.title.includes('xếp Hạng C do TBCK ≥ 2.50'));
  note('S4-06', 'missing component tooltip matches Hạng C when TBCK >= 2.50', 'CLOSED', {rank: r.hang, title: badge.props.title});
}
// Cross-output fidelity controls for both scales, missing/zero values, sorting and canvas datasets.
for (const mode of ['scale5','raw']) {
  const payload = fixture('A'); payload.snapshot.students.push({...structuredClone(payload.snapshot.students[0]), studentId: '=SUM(A1:A2)', fullName: '+Unsafe\tName', btvnScores: {1: {theoryRaw: 0, theoryMax: 100, practiceRaw: null, practiceMax: 100}}});
  payload.reportCard = calc.computeClassReportCard(payload.snapshot);
  const h = harness(async () => response(payload)); await h.flush(); h.api.setScaleMode(mode); await h.flush();
  await h.api.handleCopyTsvToSheets(); const lines = h.clipboard.at(-1).split('\n').map(l => l.split('\t'));
  assert.equal(lines[1][3], mode === 'raw' ? '80' : '4.00'); assert.equal(lines[2][1], "'=SUM(A1:A2)"); assert.equal(lines[2][2], "'+Unsafe Name");
  assert.equal(lines[2][3], mode === 'raw' ? '0' : '0.00');
  assert.ok(nodes(h.tree).some(n => n.type === 'td' && textOf(n) === (mode === 'raw' ? '80' : '4.00')));
  await h.api.handleCopyBlockImageToZalo('btvn'); const btvnText = h.canvases.at(-1).calls.filter(c => c.op === 'fillText').map(c => c.args[0]);
  assert.ok(btvnText.includes(mode === 'raw' ? '80' : '4.00'));
  await h.api.handleCopyBlockImageToZalo('summary'); const summaryText = h.canvases.at(-1).calls.filter(c => c.op === 'fillText').map(c => c.args[0]);
  assert.ok(summaryText.includes('4.20')); assert.ok(summaryText.includes('3.48'));
  const originalOrder = payload.reportCard.students.map(s => s.fullName);
  const descending = [...originalOrder].sort((a,b) => -a.localeCompare(b, 'vi'));
  h.api.handleSortColumn('fullName'); await h.flush(); assert.deepEqual(Array.from(h.api.sortedStudents, s => s.fullName), descending);
  h.api.handleSortColumn('fullName'); await h.flush(); assert.deepEqual(Array.from(h.api.sortedStudents, s => s.fullName), [...descending].reverse());
  h.api.handleSortColumn('fullName'); await h.flush(); assert.deepEqual(Array.from(h.api.sortedStudents, s => s.fullName), originalOrder);
  note('CONTROL', `TSV and canvas table values match calculator in ${mode}`, 'PASS', {tsvTheory: lines[1][3], summaryCp1: '4.20', tbck: '3.48', injectionGuard: lines[2].slice(1,3)});
  for (const stage of ['cp1','cp2','final']) {if (h.api.chartCanvasRef.current) h.api.chartCanvasRef.current.calls.length = 0;
    h.api.setActiveChartModal(stage); await h.flush(); const c = h.api.chartCanvasRef.current;
    assert.ok(c.calls.some(x => x.op === 'setLineDash' && String(x.args[0]) === '6,4'));
    const bars = c.calls.filter(x => x.op === 'fillRect' && ['#38bdf8','#34d399','#a78bfa'].includes(x.color));
    assert.equal(bars.length, stage === 'final' ? 4 : 6);
    assert.equal(bars[0].args[3], ((stage === 'final' ? 5 : stage === 'cp1' ? 2 : 4) / 5) * 277);
    assert.ok(c.calls.some(x => x.op === 'stroke' && x.stroke === '#f43f5e'));
    const expected = stage === 'cp1' ? '3.67' : stage === 'cp2' ? '3.00' : '3.00';
    assert.ok(c.calls.some(x => x.op === 'fillText' && x.args[0] === expected));
    c.calls.length = 0; h.api.setChartVisibility({c1: false,c2: false,c3: false,avg: false}); await h.flush();
    assert.ok(!c.calls.some(x => x.op === 'arc')); assert.ok(!c.calls.some(x => x.op === 'fillRect' && ['#38bdf8','#34d399','#a78bfa'].includes(x.color)));
    await h.api.handleCopyChartImage(); assert.ok(Array.isArray(h.clipboard.at(-1)));
    h.api.setChartVisibility({c1: true,c2: true,c3: true,avg: true}); await h.flush();
    note('CONTROL', `${stage} chart bars/average/threshold/toggles/image path ${mode}`, 'PASS', 'OK');
  }
}
// Robotics block hidden and stage columns actually filtered.
{
  const h = harness(async () => response(fixture('R', 2, {isRobotics: true})), {classId: 'R', classCode: 'R'}); await h.flush();
  assert.equal(nodes(h.tree).filter(n => n.type === 'table').length, 1);
  assert.ok(!nodes(h.tree).some(n => n.type === 'button' && textOf(n).includes('Copy ảnh BTVN')));
  for (const stage of ['all','cp1','cp2','cp1_cp2']) {h.api.setStageFilter(stage); await h.flush(); const th = nodes(h.tree).filter(n => n.type === 'th').map(textOf);
    assert.equal(th.some(t => t.includes('Cuối khóa DEMO')), stage === 'all');
    assert.equal(th.some(t => t.includes('Check-point 1')), stage !== 'cp2');
    assert.equal(th.some(t => t.includes('Check-point 2')), stage !== 'cp1');
    note('CONTROL', `robotics stage filter ${stage}`, 'PASS', 'OK');}
}
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'observations.json');
fs.writeFileSync(out, JSON.stringify(observations, null, 2) + '\n');
console.log(JSON.stringify({observations: observations.length, closedFindings: observations.filter(o => o.status === 'CLOSED').length, controls: observations.filter(o => o.status === 'PASS').length, output: out}, null, 2));
