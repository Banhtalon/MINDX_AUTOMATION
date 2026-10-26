"""Read evidence and preserve original files; write only inside this round directory."""
import datetime, hashlib, json, os, pathlib, subprocess

OUT = pathlib.Path(__file__).resolve().parent
ROOT = OUT.parents[2]
def digest(p):
    with p.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()
def write(name, data):
    (OUT/name).write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
def inventory(paths):
    return {p.relative_to(ROOT).as_posix(): {'sha256': digest(p), 'bytes': p.stat().st_size}
            for p in sorted(set(paths)) if p.is_file()}

state = json.loads((OUT/'source-state.json').read_text(encoding='utf-8'))
SNAP = pathlib.Path(state['snapshot'])
protected = json.loads((OUT/'protected-hashes.json').read_text(encoding='utf-8'))
paths = [ROOT/'next-env.d.ts']
for n in range(12,22):
    paths.extend((ROOT/f'docs/audits/round-{n}').rglob('*'))
protected['after'] = inventory(paths)
protected['unchanged'] = protected['before'] == protected['after']
protected['checkedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
protected['count'] = len(protected['before'])
write('protected-hashes.json', protected)
source_after = inventory(ROOT/f for f in state['files'])
source_changes = [f for f in state['files'] if state['files'][f] != source_after.get(f)]
snapshot_changes = [f for f in state['files'] if not (SNAP/f).exists() or digest(SNAP/f) != state['files'][f]['sha256']]
write('preservation-check.json', {'checkedAt': protected['checkedAt'], 'protectedCount': len(protected['before']), 'protectedUnchanged': protected['unchanged'], 'sourceCount': len(state['files']), 'originalSourceUnchanged': not source_changes, 'originalSourceChanges': source_changes, 'snapshotSourceChangesAfterGates': snapshot_changes, 'originalNextEnvSha256': digest(ROOT/'next-env.d.ts').upper(), 'planUnchanged': digest(ROOT/'MINDX_AUTOMATION_PLAN.md') == state['files']['MINDX_AUTOMATION_PLAN.md']['sha256']})
assert protected['unchanged'] and not source_changes
assert digest(ROOT/'next-env.d.ts').upper() == 'B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000'
(OUT/'git-status.after.txt').write_bytes(subprocess.run(['git','status','--short','--untracked-files=all'], cwd=ROOT, capture_output=True, check=True).stdout)

receipts = json.loads((OUT/'commands.json').read_text(encoding='utf-8'))
latest = {r['name']:r for r in receipts}
required = ['round20','round21','round22','round12','round13','round16','round17','phase4','phase5','typecheck','build']
assert set(latest) == set(required)
for r in receipts:
    assert pathlib.Path(r['cwd']) == SNAP
    assert digest(OUT/r['log']) == r['logSha256']
final_suite = latest['round22']
assert digest(OUT/'verify-independent.mjs') == final_suite['scriptSha256'] == digest(SNAP/'docs/audits/round-22/verify-independent.mjs')
independent = json.loads((OUT/'independent-results.json').read_text(encoding='utf-8'))
assert independent == json.loads((OUT/final_suite['results']).read_text(encoding='utf-8'))
assert independent['total'] == len(independent['results']) == independent['passed']+independent['failed']
assert len(set(r['id'] for r in independent['results'])) == independent['total']
assert all(h == state['files'][f]['sha256'] for f,h in independent['sourceHashes'].items())
assert all(r['sourceRoot'] == str(SNAP) for r in [independent])
assert final_suite['exitCode'] == (1 if independent['failed'] else 0)
regression = {}
for n,expected in [(12,43),(13,89),(16,16),(17,38),(20,145),(21,49)]:
    d=json.loads((OUT/latest[f'round{n}']['results']).read_text(encoding='utf-8'))
    assert d['passed'] == expected and d['failed'] == 0 and latest[f'round{n}']['exitCode'] == 0
    regression[str(n)] = {'passed': d['passed'], 'failed': d['failed']}

issues=[]
notes={
 1:'CRC/header checks fix old samples, but undecodable payloads, invalid PDF objects and valid alpha WebP still fail safe parsing requirements.',
 2:'Original R20/R21 rubric-integrity checks pass.',
 3:'Original R20/R21 composite content-hash checks pass.',
 4:'Physical file checked after AI for both parsed and supplied content; changed/deleted fixtures are ignored without overwriting DB.',
 5:'Single approval, bulk approval and criterion editing all send active rubric; unrelated criteria blocked.',
 6:'Bulk ignores reviewed points/override/decision; missing proof is optional; graded file hash is only in process memory.',
 7:'Exact submission/student modal identity checks retain passing regressions.',
 8:'Lesson/session mapping checks retain passing regressions.',
 9:'Old comment/selected-operation samples blocked, but alias/introspection, skipped mutation, missing query and unbound variables can still verify.',
10:'Feedback and decision readback retain passing regressions.',
11:'Conditional final verification retains passing regressions.',
12:'Class/session response-race checks retain passing regressions.',
13:'Same-field monotonic case fixed, but partial-field saves, independent counters, invalid-request poisoning and reloads remain unsafe.',
14:'Download failure blocks AI, including skipAi, with retained passing regressions.'}
for n in range(1,15):
    failing=[r['id'] for r in independent['results'] if not r['pass'] and r['id'].startswith(f'R22-{n:02d}-')]
    issues.append({'issueId':f'R19-{n:02d}','status':'PARTIALLY_FIXED' if failing else 'CLOSED_SOURCE','remainingSeverity':('P2' if n==1 else 'P1') if failing else None,'round22Checks':[r['id'] for r in independent['results'] if r['id'].startswith(f'R22-{n:02d}-')],'failingRound22Checks':failing,'basis':'Fresh unchanged R20 (145), R21 (49), required regression suites, plus R22 boundary cases where present. Source-level scope only.','assessment':notes[n]})
assert sum(len(i['failingRound22Checks']) for i in issues) == independent['failed']
closed=sum(i['status']=='CLOSED_SOURCE' for i in issues)
write('issue-status.json',{'closedSource':closed,'partiallyFixed':14-closed,'issues':issues,'R12Regression':{'status':'PASS','passed':43,'total':43,'extraHostnameChecks':'R22-R12-host-mindx.edu.vn and R22-R12-host-lms-api PASS'}})
verdict='GO' if closed==14 and all(latest[n]['exitCode']==0 for n in required) else 'NO-GO'
write('audit-summary.json', {'verdict':verdict,'scope':'source only, no live service or Owner acceptance','sourceManifestSha256':state['manifestHash'],'head':state['head'],'snapshot':str(SNAP),'closedSource':closed,'partiallyFixed':14-closed,'requiredDistinctCommands':len(required),'passingCommands':sum(latest[n]['exitCode']==0 for n in required),'failingCommands':[n for n in required if latest[n]['exitCode']!=0],'R22':{k:independent[k] for k in ['total','passed','failed']},'freshRegressions':regression,'protectedUnchanged':protected['unchanged'],'protectedFiles':len(protected['before']),'sourceUnchanged':not source_changes,'sourceFiles':len(state['files']),'suiteSha256':digest(OUT/'verify-independent.mjs')})
write('artifact-check.json', {'checkedAt':protected['checkedAt'],'commandsOnlyInSnapshot':True,'logHashesMatch':True,'finalSuiteMatchesExecutedBytes':True,'resultsMatchFinalRun':True,'sourceHashesMatchCapturedState':True,'uniqueR22Ids':True,'protectedUnchanged':True,'sourceUnchanged':True})
print(json.dumps({'verdict':verdict,'closedSource':closed,'R22':[independent['passed'],independent['total']],'protectedUnchanged':protected['unchanged'],'protectedFiles':len(protected['before']),'sourceFiles':len(state['files']),'snapshotChanges':snapshot_changes},ensure_ascii=False))
