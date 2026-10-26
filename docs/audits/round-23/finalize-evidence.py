"""Verify fresh audit receipts and preservation. Never write product or historical files."""
import datetime, hashlib, json, pathlib, re, subprocess

OUT = pathlib.Path(__file__).resolve().parent
ROOT = OUT.parents[2]

def digest(p):
    with p.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def read(name):
    return json.loads((OUT/name).read_text(encoding='utf-8'))

def write(name, value):
    (OUT/name).write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

def inventory(paths):
    return {p.relative_to(ROOT).as_posix(): {'sha256':digest(p), 'bytes':p.stat().st_size}
            for p in sorted(set(paths)) if p.is_file()}

state=read('source-state.json')
SNAP=pathlib.Path(state['snapshot'])
protected=read('protected-hashes.json')
files=[ROOT/'next-env.d.ts']
for n in range(12,23):
    files.extend((ROOT/f'docs/audits/round-{n}').rglob('*'))
protected.update(after=inventory(files), checkedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
protected['unchanged']=protected['before']==protected['after']
protected['count']=len(protected['before'])
assert protected['unchanged']
assert digest(ROOT/'next-env.d.ts').upper()=='B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000'
write('protected-hashes.json',protected)

source_paths=[p for p in ROOT.iterdir() if p.is_file() and not p.name.startswith('.env')]
for folder in ['src','scripts','data/config']:
    source_paths.extend((ROOT/folder).rglob('*'))
after=inventory(source_paths)
changes=[f for f in sorted(set(after)|set(state['files'])) if after.get(f)!=state['files'].get(f)]
assert set(changes)<= {'MINDX_AUTOMATION_PLAN.md'},changes
if changes:
    assert digest(OUT/'plan.before.md')==state['files']['MINDX_AUTOMATION_PLAN.md']['sha256']
snapshot_changes=[f for f,info in state['files'].items() if not (SNAP/f).exists() or digest(SNAP/f)!=info['sha256']]
assert set(snapshot_changes)<= {'next-env.d.ts'},snapshot_changes
write('preservation-check.json',{
    'checkedAt':protected['checkedAt'],'protectedFiles':len(protected['before']),
    'historicalFiles':len(protected['before'])-1,'protectedUnchanged':True,
    'sourceFiles':len(state['files']),'productSourceScriptsConfigUnchanged':True,
    'originalChanges':changes,'allowedPlanUpdate':bool(changes),
    'snapshotSourceChangesAfterGates':snapshot_changes,
    'originalNextEnvSha256':digest(ROOT/'next-env.d.ts').upper()
})
(OUT/'git-status.after.txt').write_bytes(subprocess.run(['git','status','--short','--untracked-files=all'],cwd=ROOT,capture_output=True,check=True).stdout)

receipts=read('commands.json')
latest={r['name']:r for r in receipts}
required=['round23','round22','round21','round20','round12','round13','round16','round17','phase4','phase5','typecheck','build']
assert set(latest)==set(required)
for receipt in receipts:
    assert pathlib.Path(receipt['cwd'])==SNAP
    assert digest(OUT/receipt['log'])==receipt['logSha256']
last=latest['round23']
assert last['scriptSha256']==digest(OUT/'verify-independent.mjs')==digest(SNAP/'docs/audits/round-23/verify-independent.mjs')
independent=read('independent-results.json')
assert independent==read(last['results'])
assert independent['sourceRoot']==str(SNAP)
assert independent['total']==len(independent['results'])==independent['passed']+independent['failed']
assert independent['failed']==sum(not r['pass'] for r in independent['results'])
assert len({r['id'] for r in independent['results']})==independent['total']
assert last['exitCode']==(1 if independent['failed'] else 0)
assert all(h==state['files'][f]['sha256'] for f,h in independent['sourceHashes'].items())

regressions={}
for n,expected in [(12,43),(13,89),(16,16),(17,38),(20,145),(21,49),(22,53)]:
    receipt=latest[f'round{n}']; data=read(receipt['results'])
    assert data['passed']+data['failed']==expected
    assert receipt['exitCode']==(1 if data['failed'] else 0)
    regressions[str(n)]={'passed':data['passed'],'failed':data['failed'],'total':expected,'exitCode':receipt['exitCode']}
assert all(regressions[str(n)]['failed']==0 for n in [12,13,17,20,21,22])
assert regressions['16']['failed']==1
assert [r['id'] for r in read(latest['round16']['results'])['results'] if not r['pass']]==['PHASE1-SCHEMA']
assert next(r for r in independent['results'] if r['id']=='R23-COMPAT-R16-schema')['pass']

notes={
 1:'IHDR and noninterlaced inflate/filter checks, JPEG SOF/SOS IDs and alpha WebP controls pass. Adam7 scanlines, nonempty garbage VP8/VP8L, and connected PDF page graph still fail.',
 2:'Fresh R20/R21 rubric IDs, limits, evidence and deterministic sum checks pass.',
 3:'Fresh composite content hash regressions pass.',
 4:'Fresh supplied/disk file drift and deletion checks pass; product source unchanged since R22.',
 5:'Fresh UI active rubric checks and server criteria/parse status checks pass.',
 6:'Physical SQLite reopen retains gradedFileHash. Minimal single approval still omits hash; missing/malformed decision, override and criteria allow unreviewed bulk approval.',
 7:'Exact student/submission identity and substring rejection controls pass.',
 8:'Session/lesson ownership and no-mapping checks pass.',
 9:'Missing operation/query, alias introspection, directives and old literal tests pass; absent/invalid/unrelated response data and incomplete argument binding still verify.',
10:'Grade/redo feedback and decision DOM readback regressions pass.',
11:'Conditional final content hash check prevents promoting changed records.',
12:'Fresh old-class and old-session response race checks pass.',
13:'Persisted per-field sequence, equal sequence, two clients, different-field ordering, validation and actual GET/UI reload all pass. SQLITE_FULL leaves metadata committed while row write fails, blocking next valid draft.',
14:'Failed/partial download stops AI, including skipAi; successful batches retain verified submission scope.'
}
issues=[]
for n in range(1,15):
    rx=re.compile(r'^R(?:19|20|21|22|23)-'+f'{n:02d}'+r'-')
    independent_cases=[r for r in independent['results'] if rx.match(r['id'])]
    failures=[r['id'] for r in independent_cases if not r['pass']]
    regression_cases={}
    for round_n in [20,21,22]:
        data=read(latest[f'round{round_n}']['results'])
        ids=[r['id'] for r in data['results'] if rx.match(r['id'])]
        if ids: regression_cases[f'R{round_n}']=ids
    assert regression_cases
    issues.append({'issueId':f'R19-{n:02d}', 'status':'PARTIALLY_FIXED' if failures else 'CLOSED_SOURCE',
                   'severity':('P2' if n in [1,13] else 'P1') if failures else None,
                   'assessment':notes[n], 'independentChecks':[r['id'] for r in independent_cases],
                   'failingChecks':failures,'freshHistoricalChecks':regression_cases})
assert sum(len(i['failingChecks']) for i in issues)==independent['failed']
closed=sum(i['status']=='CLOSED_SOURCE' for i in issues)
write('issue-status.json',{'closedSource':closed,'partiallyFixed':14-closed,'issues':issues,
                         'schemaCompatibility':{'historicalR16':'FAIL: expects exactly 7 tables; actual 8',
                                                'newSupersetOwnershipControl':'PASS; does not replace or modify historical gate'}})
verdict='GO' if closed==14 and all(latest[n]['exitCode']==0 for n in required) else 'NO-GO'
new_cases=[r for r in independent['results'] if r['id'].startswith('R23-')]
write('audit-summary.json',{
    'round':23,'verdict':verdict,'scope':'source and synthetic checks only, no live-service or Owner acceptance',
    'head':state['head'],'sourceManifestSha256':state['manifestHash'],'snapshot':str(SNAP),
    'closedSource':closed,'partiallyFixed':14-closed,'requiredDistinctCommands':len(required),
    'passingCommands':sum(latest[n]['exitCode']==0 for n in required),
    'failingCommands':[n for n in required if latest[n]['exitCode']!=0],
    'R23':{k:independent[k] for k in ['total','passed','failed']},
    'newR23Checks':{'total':len(new_cases),'passed':sum(r['pass'] for r in new_cases),'failed':sum(not r['pass'] for r in new_cases)},
    'freshRegressions':regressions,'historicalRegressionPassed':sum(regressions[str(n)]['passed'] for n in [12,13,16,17]),
    'historicalRegressionTotal':186,'protectedUnchanged':True,'protectedFiles':len(protected['before']),
    'historicalFiles':len(protected['before'])-1,'productSourceScriptsConfigUnchanged':True,
    'sourceFiles':len(state['files']),'allowedOriginalChanges':changes,'suiteSha256':digest(OUT/'verify-independent.mjs')
})
write('isolation.json',{'snapshot':str(SNAP),'libraries':'physical copy, no junction to original',
    'excluded':['.env*','.git','.next','data/mindx_bot.db','playwright-auth','temp_submissions','real data except data/config'],
    'environment':'Windows allowlist only; no inherited application credentials; npm offline; telemetry disabled',
    'nodeSocketGuard':'copied round-19/network-guard.cjs; permits loopback; not an OS firewall',
    'fixtures':'in-memory SQLite plus one file-backed synthetic SQLite reopened; sharp image decoder; deterministic UI/DOM/Gemini doubles',
    'externalServiceCalls':0,'realBrowserLaunched':False})
write('artifact-check.json',{'checkedAt':protected['checkedAt'],'logsMatchHashes':True,
    'finalSuiteMatchesExecutedBytes':True,'finalResultsMatchLastReceipt':True,'uniqueCaseIds':True,
    'sourceHashesMatchSnapshot':True,'allCommandsInSnapshot':True,'protectedUnchanged':True,
    'productSourceScriptsConfigUnchanged':True,'historicalFailuresRetained':True})
write('evidence-manifest.json',{p.name:{'sha256':digest(p),'bytes':p.stat().st_size}
    for p in sorted(OUT.iterdir()) if p.is_file() and p.name!='evidence-manifest.json'})
print(json.dumps(read('audit-summary.json'),ensure_ascii=True))
