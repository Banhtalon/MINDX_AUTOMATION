// Supplemental Round 2 scenarios. Concatenated after the original probe's
// fixture/hook harness; application source is instrumented only in memory.
exposed.push('isScrapingLms', 'isApproving', 'isSyncingTeaching',
  'isSavingOverride', 'overrideInputValue', 'isClassMatched');
const actions = ['handleApproveReportCard', 'handleSyncToTeaching',
  'handleSaveManualOverride', 'handleClearSingleOverride',
  'handleResetAllOverrides', 'handleScrapeFromLms'];
const modalInfo = {studentId: 'SHARED', studentName: 'Pupil A',
  fieldKey: 'cp1_theory', fieldLabel: 'CP1 LT', currentNorm: 2,
  currentRaw: 2, lmsNorm: 2, lmsRaw: 2, maxRawScore: 5,
  isBtvnField: false, isOverridden: true, note: ''};
async function prepare(h, action) {
  if (['handleSaveManualOverride', 'handleClearSingleOverride'].includes(action)) {
    h.api.openOverrideEditor(modalInfo); await h.flush();
  }
}
function observe(id, name, good, details) {
  note(id, name, good ? 'CLOSED' : 'OPEN', details);
}

// Round 1 acceptance explicitly requires A -> B -> A and delayed JSON,
// including error/finally state ownership, for all six mutation handlers.
for (const action of actions) for (const phase of ['fetch', 'json']) {
  for (const outcome of ['success', 'business-error', 'body-error']) {
    const gate = defer(); let aVersion = 2, bodyEntered = false;
    const data = outcome === 'business-error'
      ? {success: false, error: 'old operation failed', ...fixture('A', 3), success: false}
      : fixture('A', 3);
    const delayedResponse = {ok: outcome !== 'business-error', json: async () => {
      bodyEntered = true;
      if (phase === 'json') await gate.promise;
      if (outcome === 'body-error') throw new Error('old JSON body failed');
      return data;
    }};
    let gets = 0;
    const h = harness((url, opts) => {
      if (opts?.method) return phase === 'fetch' ? gate.promise : Promise.resolve(delayedResponse);
      gets++;
      const code = new URL(String(url), 'http://local').searchParams.get('classId');
      return Promise.resolve(response(fixture(code, code === 'A' ? aVersion : 2)));
    });
    await h.flush(); await prepare(h, action);
    const pending = h.api[action](); await h.flush();
    if (phase === 'json') assert.equal(bodyEntered, true);
    h.props({classId: 'B', classCode: 'B'}); await h.flush();
    aVersion = 4; h.props({classId: 'A', classCode: 'A'}); await h.flush();
    const getsBefore = gets;
    if (phase === 'fetch') gate.resolve(delayedResponse); else gate.resolve();
    await pending; await h.flush();
    assert.equal(h.api.record.classId, 'A'); assert.equal(h.api.record.draftVersion, 4);
    assert.equal(h.api.errorMsg, null); assert.equal(h.api.toastMsg, null);
    assert.equal(h.api.isApproving || h.api.isSyncingTeaching ||
      h.api.isSavingOverride || h.api.isScrapingLms, false);
    assert.equal(gets, getsBefore, 'stale scrape must not issue follow-up GET');
    observe('S4-01-CONTROL', `${action} A-B-A ${phase} ${outcome}`, true,
      {version: h.api.record.draftVersion, extraGets: gets - getsBefore});
  }
}

// A GET started AFTER a mutation may legitimately observe a newer version
// while the older mutation response is still awaiting delivery/body parsing.
for (const action of actions) for (const phase of ['fetch', 'json']) {
  const gate = defer(), reloadGate = defer(); let getCount = 0;
  const older = fixture('A', 3); older.snapshot.students[0].stageScores.cp1Theory = 1;
  older.reportCard = calc.computeClassReportCard(older.snapshot);
  const newer = fixture('A', 4); newer.snapshot.students[0].stageScores.cp1Theory = 5;
  newer.reportCard = calc.computeClassReportCard(newer.snapshot);
  const h = harness((url, opts) => {
    if (opts?.method) return phase === 'fetch' ? gate.promise
      : Promise.resolve({ok: true, json: () => gate.promise});
    getCount++;
    if (getCount === 1) return Promise.resolve(response(fixture('A', 2)));
    if (getCount === 2) return Promise.resolve(response(newer));
    return reloadGate.promise;
  });
  await h.flush(); await prepare(h, action);
  const pending = h.api[action](); await h.flush();
  h.props({scrapeTrigger: 'external-update-v4'}); await h.flush();
  assert.equal(h.api.record.draftVersion, 4);
  gate.resolve(phase === 'fetch' ? response(older) : older);
  await h.flush();
  if (action !== 'handleScrapeFromLms') await pending;
  await h.flush();
  const actual = {acceptedGetVersion: 4, finalVisibleVersion: h.api.record.draftVersion,
    finalVisibleTheory: h.api.computedReportCard.students[0].cp1.theory.value,
    toast: h.api.toastMsg};
  observe('S4-01', `${action}: late ${phase} mutation after v4 GET`,
    actual.finalVisibleVersion === 4, actual);
  if (action === 'handleScrapeFromLms') {
    reloadGate.resolve(response(newer)); await pending; await h.flush();
  }
}

// Rejected response identity must not still be announced as a successful write.
for (const action of actions.filter(a => a !== 'handleScrapeFromLms')) {
  const h = harness((url, opts) => Promise.resolve(response(fixture(opts?.method ? 'B' : 'A', 3))));
  await h.flush(); await prepare(h, action); await h.api[action](); await h.flush();
  observe('S4-01', `${action}: wrong-class successful payload`, !h.api.toastMsg,
    {recordClass: h.api.record.classId, error: h.api.errorMsg, toast: h.api.toastMsg});
}

// Different operation types are simultaneously enabled by the actual JSX.
// Global opGen changes must not strand a previous operation's own busy flag.
for (const first of ['handleApproveReportCard', 'handleSyncToTeaching', 'handleScrapeFromLms']) {
  const firstGate = defer(); let writes = 0;
  const seeded = fixture('A', 2);
  seeded.overrides = {'SHARED::cp1_theory': {normScore: 2}};
  const reset = fixture('A', 3); reset.record.status = 'DRAFT';
  const h = harness((url, opts) => {
    if (!opts?.method) return Promise.resolve(response(seeded));
    writes++; return writes === 1 ? firstGate.promise : Promise.resolve(response(reset));
  });
  await h.flush(); const pending = h.api[first](); await h.flush();
  // Reset is also directly available through the public toolbar on the same view.
  const resetButtons = nodes(h.tree).filter(n => n.type === 'button' && n.props.onClick === h.api.handleResetAllOverrides);
  assert.equal(resetButtons.length, 1); assert.equal(resetButtons[0].props.disabled, false);
  await h.api.handleResetAllOverrides(); await h.flush();
  firstGate.resolve(response(fixture('A', 2))); await pending; await h.flush();
  const flags = {isApproving: h.api.isApproving, isSyncingTeaching: h.api.isSyncingTeaching,
    isScrapingLms: h.api.isScrapingLms, isSavingOverride: h.api.isSavingOverride};
  const strandedButton = nodes(h.tree).find(n => n.type === 'button' && n.props.onClick === h.api[first]);
  assert.equal(strandedButton.props.disabled, true);
  observe('R2-01', `${first} superseded by enabled reset`,
    !Object.values(flags).some(Boolean), {requestsCompleted: 2, flags,
      strandedButtonDisabled: strandedButton.props.disabled, displayedVersion: h.api.record.draftVersion});
}

// Stale editor save AND clear preserve user input and do not send a mutation.
for (const action of ['handleSaveManualOverride', 'handleClearSingleOverride']) {
  let latest = fixture('A', 2), mutations = 0;
  const h = harness((url, opts) => {if (opts?.method) mutations++; return Promise.resolve(response(latest));});
  await h.flush(); await prepare(h, action); h.api.setOverrideInputValue('4.75'); await h.flush();
  latest = fixture('A', 3); latest.snapshot.students[0].stageScores.cp1Theory = 5;
  latest.reportCard = calc.computeClassReportCard(latest.snapshot);
  await h.api.loadReportCard('A'); await h.flush(); await h.api[action](); await h.flush();
  assert.equal(mutations, 0); assert.equal(h.api.overrideInputValue, '4.75');
  assert.ok(h.api.overrideModal); assert.match(h.api.errorMsg, /v3.*v2/);
  observe('S4-03', `${action} refuses newer version and preserves unsaved input`, true,
    {mutations, input: h.api.overrideInputValue, version: h.api.record.draftVersion});
}

// Failed reload blocks all writes and exports, including handlers themselves.
for (const kind of ['business', 'http', 'network', 'json']) {
  let failure = false, mutations = 0;
  const h = harness(async (url, opts) => {
    if (opts?.method) mutations++;
    if (!failure) return response(fixture('A'));
    if (kind === 'network') throw new Error('network failed');
    if (kind === 'json') return {ok: true, json: async () => {throw new Error('bad JSON');}};
    return response({success: kind === 'http', error: 'reload rejected'}, kind !== 'http');
  });
  await h.flush(); await prepare(h, 'handleSaveManualOverride');
  failure = true; assert.equal(await h.api.loadReportCard('A'), false); await h.flush();
  for (const a of actions.filter(a => a !== 'handleScrapeFromLms')) await h.api[a]();
  await h.api.handleCopyTsvToSheets(); await h.api.handleCopyBlockImageToZalo('summary'); await h.flush();
  assert.equal(mutations, 0); assert.equal(h.clipboard.length, 0);
  assert.equal(h.api.record, null); assert.equal(h.api.snapshot, null);
  observe('S4-02', `${kind} reload failure blocks mutations/exports`, true,
    {mutations, clipboardWrites: h.clipboard.length, modalRetained: !!h.api.overrideModal,
      selectedSessionsRetained: h.api.selectedBtvnSessions});
}

// Empty selection is consistent across both export renderers/scales; reload
// does not reselect the deliberately empty filter.
for (const mode of ['scale5', 'raw']) {
  const h = harness(async () => response(fixture('A'))); await h.flush();
  h.api.setScaleMode(mode); h.api.setSelectedBtvnSessions([]); await h.flush();
  await h.api.loadReportCard('A'); await h.flush();
  assert.deepEqual(Array.from(h.api.computedReportCard.activeBtvnSessionNumbers), []);
  const row = h.api.computedReportCard.students[0];
  assert.equal(row.btvnAvgNorm, null); assert.equal(row.btvnAvgRaw, null);
  assert.equal(row.submittedCount, 0); assert.equal(row.totalAssignedItems, 0);
  await h.api.handleCopyTsvToSheets(); const lines = h.clipboard.at(-1).split('\n').map(s => s.split('\t'));
  assert.equal(lines[0][3], 'BTVN Đã làm'); assert.equal(lines[1][3], '0/0');
  assert.equal(lines[1][4], "'-");
  await h.api.handleCopyBlockImageToZalo('btvn');
  const drawn = h.canvases.at(-1).calls.filter(c => c.op === 'fillText').map(c => c.args[0]);
  assert.ok(drawn.includes('0/0')); assert.ok(drawn.includes('-'));
  observe('S4-04', `empty sessions persist and match TSV/PNG ${mode}`, true,
    {active: [], submitted: '0/0', average: null});
}

// Real parent callback contract: business, HTTP, network, JSON failure and success.
for (const kind of ['business', 'http', 'network', 'json', 'success']) {
  const parent = harness(async (url, opts) => {
    if (!opts?.method) return response({success: true, data: {}});
    if (kind === 'network') throw new Error('synthetic network');
    if (kind === 'json') return {ok: true, json: async () => {throw new Error('synthetic JSON');}};
    return response({success: kind !== 'business', error: 'synthetic rejected',
      classId: 'VT-C4K-PTA12', rows: [], summary: {}}, kind !== 'http');
  }, {}, true);
  await parent.flush();
  const child = harness(async () => response(fixture('A')),
    {onRequestScrapeLms: () => parent.api.handleScrapeScores()});
  await child.flush(); await child.api.handleScrapeFromLms(); await child.flush(); await parent.flush();
  assert.equal(!!child.api.toastMsg, kind === 'success');
  assert.equal(!!child.api.errorMsg, kind !== 'success');
  observe('S4-05', `integrated callback ${kind}`, true,
    {parentStatus: parent.api.statusMessage.type, childError: child.api.errorMsg, childToast: child.api.toastMsg});
}

// Displayed rank legend, numeric classifier and missing/zero tooltip.
for (const value of [2.49, 2.50, 3.99, 4.00, 4.49, 4.50]) {
  const f = fixture('A'); Object.keys(f.snapshot.students[0].stageScores).forEach(k => f.snapshot.students[0].stageScores[k] = value);
  f.reportCard = calc.computeClassReportCard(f.snapshot);
  const h = harness(async () => response(f)); await h.flush(); h.api.setShowFormulaModal(true); await h.flush();
  const row = h.api.computedReportCard.students[0];
  assert.equal(row.rankCode, value >= 4.50 ? 'A' : value >= 4 ? 'B' : value >= 2.5 ? 'C' : 'D');
  observe('S4-06', `rank boundary ${value}`, true, {tbck: row.tbck, rank: row.rankCode});
}
for (const missing of [null, 0]) for (const other of [5, 1]) {
  const f = fixture('A'); Object.keys(f.snapshot.students[0].stageScores).forEach(k => f.snapshot.students[0].stageScores[k] = other);
  f.snapshot.students[0].stageScores.cp1Theory = missing; f.reportCard = calc.computeClassReportCard(f.snapshot);
  const h = harness(async () => response(f)); await h.flush(); const row = h.api.computedReportCard.students[0];
  assert.equal(row.rankCode, row.tbck >= 2.5 ? 'C' : 'D');
  const badge = nodes(h.tree).find(n => n.type === 'span' && textOf(n) === row.hang);
  assert.ok(badge.props.title.includes(row.hang));
  observe('S4-06', `component ${missing} others ${other}`, true,
    {tbck: row.tbck, rank: row.rankCode, tooltip: badge.props.title});
}

// Confirm version regression with the actual GET/PUT routes and actual TEMP
// SQLite, rather than relying only on synthetic version payloads.
{
  const db = await import('../../../../src/lib/db/sqlite.ts');
  const route = await import('../../../../src/app/api/report-card/route.ts');
  const {NextRequest} = await import('next/server');
  const code = 'AUDIT-S4-R2-REAL';
  db.reportCardRepo.saveLmsSnapshot(code, fixture(code).snapshot);
  const headers = {host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json'};
  async function getActual() {
    return route.GET(new NextRequest(`http://127.0.0.1:3000/api/report-card?classId=${code}`, {headers}));
  }
  async function putActual(body) {
    return route.PUT(new NextRequest('http://127.0.0.1:3000/api/report-card',
      {method: 'PUT', headers, body: JSON.stringify(body)}));
  }
  const bodyGate = defer(); let firstPayload;
  const h = harness(async (url, opts) => {
    if (!opts?.method) return getActual();
    const actual = await putActual(JSON.parse(opts.body));
    assert.equal(actual.status, 200); firstPayload = await actual.json();
    return {ok: actual.ok, json: async () => {await bodyGate.promise; return firstPayload;}};
  }, {classId: code, classCode: code});
  await h.flush(); assert.equal(h.api.record.draftVersion, 2);
  h.api.openOverrideEditor({...modalInfo, studentName: 'Synthetic pupil'}); await h.flush();
  h.api.setOverrideInputValue('1'); await h.flush();
  const pending = h.api.handleSaveManualOverride(); await h.flush();
  assert.equal(firstPayload.record.draftVersion, 3);
  const second = await putActual({action: 'set_override', classId: code, expectedVersion: 3,
    updates: [{studentId: 'SHARED', fieldKey: 'cp1_theory', normScore: 5}]});
  assert.equal(second.status, 200); assert.equal((await second.json()).record.draftVersion, 4);
  h.props({scrapeTrigger: 'other-client-v4'}); await h.flush();
  assert.equal(h.api.record.draftVersion, 4);
  assert.equal(h.api.computedReportCard.students[0].cp1.theory.value, 5);
  bodyGate.resolve(); await pending; await h.flush();
  await h.api.handleCopyTsvToSheets();
  const exported = h.clipboard.at(-1).split('\n').map(s => s.split('\t'));
  const cp1Column = exported[0].indexOf('CP1 LT');
  const persisted = db.reportCardRepo.getOrInit(code);
  observe('S4-01', 'REAL GET/PUT + TEMP SQLite: late v3 body overwrites displayed/exported v4',
    h.api.record.draftVersion === persisted.draftVersion,
    {databaseVersion: persisted.draftVersion, displayedVersion: h.api.record.draftVersion,
      displayedTheory: h.api.computedReportCard.students[0].cp1.theory.value,
      exportedTheory: exported[1][cp1Column], toast: h.api.toastMsg});
  // The repository version guard still prevents blindly writing the stale
  // displayed version back; this is a UI regression, not proven DB corruption.
  const staleWrite = await putActual({action: 'set_override', classId: code, expectedVersion: 3,
    updates: [{studentId: 'SHARED', fieldKey: 'cp1_theory', normScore: 2}]});
  assert.equal(staleWrite.status, 409);
  observe('CONTROL', 'REAL stale write remains rejected by server version guard', true,
    {http: staleWrite.status, databaseVersion: db.reportCardRepo.getOrInit(code).draftVersion});

  // Actual approve/reset requests on the current TEMP record also strand busy state.
  const approveGate = defer(); let approvePrepared = false;
  const hBusy = harness(async (url, opts) => {
    if (!opts?.method) return getActual();
    const body = JSON.parse(opts.body);
    if (body.action !== 'approve') return putActual(body);
    const res = await route.POST(new NextRequest('http://127.0.0.1:3000/api/report-card',
      {method: 'POST', headers, body: opts.body}));
    assert.equal(res.status, 200); const payload = await res.json(); approvePrepared = true;
    return {ok: res.ok, json: async () => {await approveGate.promise; return payload;}};
  }, {classId: code, classCode: code});
  await hBusy.flush(); const approving = hBusy.api.handleApproveReportCard(); await hBusy.flush();
  assert.equal(approvePrepared, true);
  const enabledReset = nodes(hBusy.tree).find(n => n.type === 'button' && n.props.onClick === hBusy.api.handleResetAllOverrides);
  assert.equal(enabledReset.props.disabled, false);
  await enabledReset.props.onClick(); await hBusy.flush();
  approveGate.resolve(); await approving; await hBusy.flush();
  const finalDb = db.reportCardRepo.getOrInit(code);
  assert.equal(finalDb.status, 'WAITING_APPROVAL');
  assert.equal(hBusy.api.record.draftVersion, finalDb.draftVersion);
  observe('R2-01', 'REAL POST approve + PUT reset complete but approve remains busy',
    !hBusy.api.isApproving,
    {databaseVersion: finalDb.draftVersion, databaseStatus: finalDb.status,
      isApproving: hBusy.api.isApproving, isSavingOverride: hBusy.api.isSavingOverride});
  db.closeDb();
}

const summary = {observations: observations.length,
  closed: observations.filter(o => o.status === 'CLOSED').length,
  open: observations.filter(o => o.status === 'OPEN').length};
fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'observations.json'),
  JSON.stringify({summary, observations}, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
// Exit 0 means collection/assertions completed, not that all findings are closed.
