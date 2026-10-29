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


exposed.push('isScrapingLms', 'isApproving', 'isSyncingTeaching', 'isSavingOverride', 'overrideInputValue', 'isClassMatched');
export {harness, fixture, response, defer, nodes, textOf, calc};

