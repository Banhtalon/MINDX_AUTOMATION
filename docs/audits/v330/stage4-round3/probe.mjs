// Round 3 independently authored scenarios; harness reused from the unchanged
// Stage 4 probe. Source instrumentation occurs only in memory. No live services.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {harness, fixture, response, defer, nodes, calc} from './harness.mjs';
for (const key of ['MINDX_DB_PATH', 'MINDX_RUNNING_CLASSES_PATH', 'ALLOWED_LOCAL_DIRS']) {
  const relative = path.relative(os.tmpdir(), path.resolve(process.env[key] || '.'));
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `${key} must be below TEMP`);
}
const observations = [];
const actions = [
  ['handleScrapeFromLms', 'isScrapingLms'],
  ['handleApproveReportCard', 'isApproving'],
  ['handleSyncToTeaching', 'isSyncingTeaching'],
  ['handleSaveManualOverride', 'isSavingOverride'],
  ['handleClearSingleOverride', 'isSavingOverride'],
  ['handleResetAllOverrides', 'isSavingOverride'],
];
const modal = {studentId: 'SHARED', studentName: 'Synthetic pupil', fieldKey: 'cp1_theory', fieldLabel: 'CP1 LT',
  currentNorm: 2, currentRaw: 2, lmsNorm: 2, lmsRaw: 2, maxRawScore: 5, isBtvnField: false, isOverridden: true, note: ''};
const isEditor = action => /SaveManual|ClearSingle/.test(action);
const flags = h => Object.fromEntries(actions.map(([, flag]) => [flag, h.api[flag]]));
const button = (h, action) => nodes(h.tree).find(n => n.type === 'button' && n.props.onClick === h.api[action]);
function payload(version, code = 'A') {
  const data = fixture(code, version);
  data.overrides = {'SHARED::cp1_theory': {normScore: version === 2 ? 2 : 5}};
  data.snapshot.students[0].stageScores.cp1Theory = version === 2 ? 2 : 5;
  data.reportCard = calc.computeClassReportCard(data.snapshot, data.overrides);
  return data;
}
async function editor(h) {h.api.openOverrideEditor(modal); await h.flush(); h.api.setOverrideInputValue('4.75'); await h.flush();}
function note(group, test, observed) {observations.push({group, case: test, status: 'CLOSED', observed});}
const failurePairs = [['success','success'], ['business','success'], ['success','business'],
  ['http','success'], ['success','http'], ['network','success'], ['success','network'],
  ['json','success'], ['success','json']];
function delayedFetch(gate, phase, outcome, data, label) {
  const answer = async () => {
    if (outcome === 'network') throw new Error(`${label}:network`);
    return {ok: outcome !== 'http', json: async () => {
      if (phase === 'json') await gate.promise;
      if (outcome === 'json') throw new Error(`${label}:json`);
      if (outcome === 'business' || outcome === 'http') return {success: false, error: `${label}:${outcome}`};
      return data;
    }};
  };
  // Network rejection has no JSON phase, so hold it at fetch for either label.
  return phase === 'fetch' || outcome === 'network' ? gate.promise.then(answer) : answer();
}

// All 24 ordered cross-owner action pairs. Both completion orders, fetch/body
// delays, and failure on either side. JSX enabled state is checked; this is a
// hook/element-tree test, not browser pointer hit-testing through an open modal.
for (const [first, firstFlag] of actions) for (const [second, secondFlag] of actions) {
  if (firstFlag === secondFlag) continue;
  for (const phase of ['fetch', 'json']) for (const order of ['first-first', 'second-first']) {
    for (const [outcome1, outcome2] of failurePairs) {
      const gates = [defer(), defer()]; let writes = 0; let current = payload(2);
      const h = harness((url, opts) => {
        if (!opts?.method) return Promise.resolve(response(current));
        const index = writes++; assert.ok(index < 2);
        return delayedFetch(gates[index], phase, index ? outcome2 : outcome1,
          payload(index ? 4 : 3), index ? 'second' : 'first');
      });
      await h.flush(); if (isEditor(first) || isEditor(second)) await editor(h);
      assert.equal(!!button(h, first)?.props.disabled, false);
      const p1 = h.api[first](); await h.flush(); assert.equal(h.api[firstFlag], true);
      assert.ok(button(h, second)); assert.equal(!!button(h, second).props.disabled, false);
      const p2 = h.api[second](); await h.flush(); assert.equal(writes, 2);
      assert.equal(h.api[firstFlag], true); assert.equal(h.api[secondFlag], true);
      const finish = async index => {
        if (index === 1 && outcome2 === 'success') current = payload(4);
        gates[index].resolve(); await (index ? p2 : p1); await h.flush();
      };
      if (order === 'first-first') {
        await finish(0);
        assert.equal(h.api[firstFlag], false, 'completed first owner releases only itself');
        assert.equal(h.api[secondFlag], true, 'pending second owner stays busy');
        assert.equal(h.api.record.draftVersion, 2);
        assert.equal(h.api.toastMsg, null); assert.equal(h.api.errorMsg, null);
        await finish(1);
      } else {
        await finish(1);
        assert.equal(h.api[firstFlag], true, 'pending first owner stays busy');
        assert.equal(h.api[secondFlag], false);
        const before = JSON.stringify({version:h.api.record.draftVersion, toast:h.api.toastMsg, error:h.api.errorMsg, modal:h.api.overrideModal});
        await finish(0);
        assert.equal(JSON.stringify({version:h.api.record.draftVersion, toast:h.api.toastMsg, error:h.api.errorMsg, modal:h.api.overrideModal}), before,
          'superseded completion cannot change latest payload, notification or editor');
      }
      assert.ok(Object.values(flags(h)).every(v => v === false));
      if (outcome2 === 'success') {
        assert.equal(h.api.record.draftVersion, 4); assert.ok(h.api.toastMsg); assert.equal(h.api.errorMsg, null);
      } else {
        assert.equal(h.api.record.draftVersion, 2); assert.ok(h.api.errorMsg.includes(`second:${outcome2}`)); assert.equal(h.api.toastMsg, null);
      }
      note('R2-01-pairings', `${first} -> ${second}; ${phase}; ${order}; ${outcome1}/${outcome2}`,
        {flags:flags(h), version:h.api.record.draftVersion, error:h.api.errorMsg});
      h.unmount();
    }
  }
}

// Override variants intentionally share one owner. Their rendered controls must
// block a second override while the first is pending, then recover on completion.
for (const [first, flag] of actions.filter(([,f]) => f === 'isSavingOverride')) {
  for (const [second] of actions.filter(([a,f]) => f === flag && a !== first)) {
    const gate = defer(); const h = harness((url, opts) => opts?.method ? gate.promise : Promise.resolve(response(payload(2))));
    await h.flush(); await editor(h); const pending = h.api[first](); await h.flush();
    assert.equal(button(h, second).props.disabled, true);
    gate.resolve(response(payload(3))); await pending; await h.flush(); assert.equal(h.api[flag], false);
    note('R2-01-same-owner', `${first} blocks ${second}`, {busy:false}); h.unmount();
  }
}

// A-B-A plus a new SAME operation: an old finally must not clear the new busy ID.
for (const [action, flag] of actions) for (const phase of ['fetch','json']) {
  for (const outcome of ['success','business','http','network','json']) {
    const gates = [defer(),defer()]; let writes = 0;
    const h = harness((url,opts) => {
      if (!opts?.method) return Promise.resolve(response(payload(2, new URL(String(url),'http://local').searchParams.get('classId'))));
      const i = writes++; return delayedFetch(gates[i],phase,i ? 'success' : outcome,payload(i ? 4 : 3),i ? 'new' : 'old');
    });
    await h.flush(); if (isEditor(action)) await editor(h);
    const old = h.api[action](); await h.flush();
    h.props({classId:'B',classCode:'B'}); await h.flush(); h.props({classId:'A',classCode:'A'}); await h.flush();
    if (isEditor(action)) await editor(h);
    const fresh = h.api[action](); await h.flush(); assert.equal(h.api[flag],true);
    gates[0].resolve(); await old; await h.flush(); assert.equal(h.api[flag],true);
    assert.equal(h.api.record.draftVersion,2); assert.equal(h.api.toastMsg,null); assert.equal(h.api.errorMsg,null);
    // Scrape's follow-up GET must match the accepted write version.
    // Override loadReportCard here is not needed: GET v2 is rejected by the v4 floor.
    gates[1].resolve(); await fresh; await h.flush(); assert.equal(h.api[flag],false);
    assert.equal(h.api.record.draftVersion,4);
    note('R2-01-ABA-owner',`${action}; ${phase}; old ${outcome}`,{busy:false,version:4}); h.unmount();
  }
}

// Rejecting a mutation payload must also preserve open editor/input and suppress
// success/follow-up GET. Covers standalone scrape (previous wrong-class loop omitted it).
for (const [action] of actions) for (const phase of ['fetch','json']) for (const rejection of ['older','wrong-class']) {
  const gate=defer(); let gets=0; let current=payload(2);
  const h=harness((url,opts)=> {
    if (!opts?.method) {gets++; return Promise.resolve(response(current));}
    return delayedFetch(gate,phase,'success',payload(3,rejection === 'older' ? 'A' : 'B'),'mutation');
  });
  await h.flush(); await editor(h); const pending=h.api[action](); await h.flush();
  current=payload(4); await h.api.loadReportCard('A'); await h.flush(); const beforeGets=gets;
  gate.resolve(); await pending; await h.flush();
  assert.equal(h.api.record.draftVersion,4); assert.equal(h.api.toastMsg,null); assert.equal(gets,beforeGets);
  assert.ok(h.api.overrideModal); assert.equal(h.api.overrideInputValue,'4.75');
  await h.api.handleCopyTsvToSheets(); const table=h.clipboard.at(-1).split('\n').map(r=>r.split('\t'));
  assert.equal(table[1][table[0].indexOf('CP1 LT')],'5.00');
  note('S4-01-rejection',`${action}; ${phase}; ${rejection}`,{version:4,extraGets:gets-beforeGets,modalRetained:true,exportedTheory:'5.00'}); h.unmount();
}

// Explicit cleanup boundaries: load failures close editor; opening during a
// pending read or unmatched class is blocked. Equal versions remain admissible.
for (const outcome of ['business','http','network','json']) {
  let failing=false;
  const h=harness(async()=> {
    if (!failing) return response(payload(2));
    return delayedFetch({promise:Promise.resolve()},'fetch',outcome,payload(3),'reload');
  });
  await h.flush(); await editor(h); failing=true;
  assert.equal(await h.api.loadReportCard('A'),false); await h.flush(); assert.equal(h.api.overrideModal,null);
  h.api.openOverrideEditor(modal); await h.flush(); assert.equal(h.api.overrideModal,null);
  note('cleanup',`failed ${outcome} read closes and blocks editor`,{modal:null}); h.unmount();
}
{
  const gate=defer(); let slow=false;
  const h=harness(()=>slow ? gate.promise : Promise.resolve(response(payload(2)))); await h.flush(); slow=true;
  const pending=h.api.loadReportCard('A'); await h.flush(); assert.equal(h.api.isClassMatched,true); assert.equal(h.api.isLoading,true);
  h.api.openOverrideEditor(modal); await h.flush(); assert.equal(h.api.overrideModal,null);
  gate.resolve(response(payload(2))); assert.equal(await pending,true); await h.flush();
  h.api.openOverrideEditor(modal); await h.flush(); assert.ok(h.api.overrideModal);
  note('cleanup','loading blocks editor; equal-version GET accepted; editor recovers',{version:2}); h.unmount();
}
const summary={observations:observations.length,closed:observations.length,open:0,
  groups:Object.fromEntries([...new Set(observations.map(o=>o.group))].map(g=>[g,observations.filter(o=>o.group===g).length]))};
fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'observations.json'),JSON.stringify({summary,observations},null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
// Unlike earlier evidence collectors, any failed closure assertion exits nonzero.
