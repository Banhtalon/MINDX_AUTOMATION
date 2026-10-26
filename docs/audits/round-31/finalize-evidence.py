"""Reconcile fresh receipts, source bytes, historical contracts and audit artifacts."""
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil

out=Path(__file__).resolve().parent
root=out.parents[2]
e=out/'evidence'
read=lambda p:json.loads(p.read_text(encoding='utf-8'))
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,d):(e/n).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
commands=read(e/'commands.json');latest={}
for c in commands:
    assert Path(c['cwd']).resolve().is_relative_to(Path(os.environ['TEMP']).resolve())
    assert sha(e/c['log'])==c['logSha256'],c['log']
    if 'results' in c:assert sha(e/c['results'])==c['resultsSha256'],c['results']
    latest[c['name']]=c
assert {p.name for p in e.glob('*.log')}=={c['log'] for c in commands}
def data(n):return read(e/latest[n]['results'])
required={'round31':819,'native31-media':221,'native31-worker':88,'pdf-name':4,'pdf-name-oracle':4,
    'pdf-dict-oracle':54,'graphql-js-oracle':88,'graphql-worker-oracle':88,'r31-boundary':28,
    'round30':819,'native30-media':221,'native30-worker':88,
    'round29':815,'native29-media':217,'native29-worker':88,
    'round28':737,'native28-media':163,'native28-worker':64,
    'round27':662,'native27-media':120,'native27-worker':32,
    'round26':510,'native26-media':94,'native26-worker':54,
    'round25':344,'native25-media':25,'native25-worker':9,
    'round24':230,'round23':116,'round22':53,'native24-media':8}
for name,count in required.items():
    c=latest[name];d=data(name)
    assert c['exitCode']==0 and (d['total'],d['passed'],d['failed'])==(count,count,0),name
for name,count in [('round12',43),('round13',89),('round17',38)]:
    assert latest[name]['exitCode']==0 and data(name)['passed']==count and data(name)['failed']==0,name
for name in ['phase4','phase5','typecheck-before','build','typecheck-after','pdf-oracle','export-worker-cases']:
    assert latest[name]['exitCode']==0,name
assert latest['typecheck-before']['startedAt']<latest['build']['startedAt']<latest['typecheck-after']['startedAt']
assert '22/22' in (e/latest['build']['log']).read_text(encoding='utf-8')
assert data('pdf-oracle')['r29IndependentDictionaryChecks']==54 and len(data('pdf-oracle')['results'])==117
main=data('round31');historical=data('round30');media=data('native31-media');worker=data('native31-worker')
assert [(r['id'],r['criterion'],r['pass']) for r in main['results']]==[(r['id'],r['criterion'],r['pass']) for r in historical['results']]
assert len({r['id'] for r in main['results']})==819
assert all(r['expectedVerified']!=0 or r['verified']==0 for r in worker['results'])
write('inherited-cases-check.json',{'round30CaseCount':819,'round31CaseCount':819,'sameOrderedIdsCriteriaAndPassResults':True,
    'nativeMediaSameIdsExpectationsAndStatus':[(r['id'],r['expected'],r['parseStatus']) for r in media['results']]==[(r['id'],r['expected'],r['parseStatus']) for r in data('native30-media')['results']],
    'nativeWorkerSameIdsExpectedAndVerified':[(r['id'],r['expectedVerified'],r['verified']) for r in worker['results']]==[(r['id'],r['expectedVerified'],r['verified']) for r in data('native30-worker')['results']],
    'additionalBoundaryChecks':28,'nativeAndOracleCountsNotAddedToMain819':True})
assert read(e/'inherited-cases-check.json')['nativeMediaSameIdsExpectationsAndStatus']
assert read(e/'inherited-cases-check.json')['nativeWorkerSameIdsExpectedAndVerified']

# Prove the new main harness is a metadata-only derivative of the immutable R30 file.
old=(out.parent/'round-30/verify-independent.mjs').read_text(encoding='utf-8')
expected=old.replace('docs/audits/round-30','docs/audits/round-31').replace('mindx-round30-','mindx-round31-').replace('// Round 30 harness','// Round 31 harness',1).replace('round:30,inheritedR29Checks:815','round:31,inheritedR30Checks:819')
assert (out/'verify-independent.mjs').read_text(encoding='utf-8')==expected

manifest=read(e/'source-manifest.json')['files'];before=read(e/'before-hashes.json')
snapshot_checks=[]
for cwd in sorted({c['cwd'] for c in commands}):
    snap=Path(cwd)
    changed=[k for k,v in manifest.items() if not (snap/k).is_file() or sha(snap/k)!=v['sha256']]
    assert changed in [[],['next-env.d.ts']],(cwd,changed)
    altered_harness=[k for k,v in before.items() if any(k.startswith(f'docs/audits/round-{n}/') for n in range(12,31)) and k.endswith(('.mjs','.cjs','.py','.ts','.txt')) and sha(snap/k)!=v['sha256']]
    assert not altered_harness,(cwd,altered_harness)
    snapshot_checks.append({'snapshot':cwd,'filesChecked':len(manifest),'changedFiles':changed,'productMatches':True,'historicalHarnessBytesUnchanged':True})
primary=Path(read(e/'snapshot.json')['snapshot'])
executed=['verify-independent.mjs','native-media-repro.mjs','native-worker-repro.mjs','media-cases.mjs','network-guard.cjs',
    'pdf-name-repro.mjs','pdf-name-oracle.py','pdf_dict_oracle.py','pdf-oracle.py','graphql-oracle.mjs','block-string-oracle.mjs',
    'graphql_worker_oracle.py','export-worker-cases.mjs','pdf-boundary-repro.mjs']
for f in executed:assert sha(out/f)==sha(primary/'docs/audits/round-31'/f),f
for d,f in [(main,'verify-independent.mjs'),(media,'native-media-repro.mjs'),(worker,'native-worker-repro.mjs')]:assert d['harnessSha256']==sha(out/f)
assert all(value==sha(root/file)==sha(primary/file) for file,value in main['sourceHashes'].items())
write('snapshot-source-check.json',{'snapshots':snapshot_checks,'executedAuditFiles':{f:sha(out/f) for f in executed},'allMatch':True})
for name,target in [('round31','verify-results.json'),('native31-media','native-media-results.json'),('native31-worker','native-worker-results.json'),
    ('pdf-name','pdf-name-results.json'),('pdf-name-oracle','pdf-name-oracle-results.json'),('pdf-dict-oracle','pdf-dict-oracle-results.json'),
    ('pdf-oracle','pdf-oracle-results.json'),('graphql-worker-oracle','graphql-worker-oracle-results.json'),('graphql-js-oracle','graphql-oracle-results.json'),('r31-boundary','pdf-boundary-results.json')]:shutil.copy2(e/latest[name]['results'],e/target)

fixtures=e/'fixtures';fixtures.mkdir(exist_ok=True);closure=[]
previous_names=read(out.parent/'round-30/evidence/pdf-name-results.json')
for c in data('pdf-name')['results']:
    a=next(r for r in main['results'] if r['id']==c['id']);b=next(r for r in media['results'] if r['id']==c['id'])
    assert a['pass'] and b['pass'] and c['pass'] and c['currentStatus']=='PARSED' and c['inlineParts']==1
    prior=next(r for r in previous_names['results'] if r['id']==c['id'])
    assert prior['fixtureSha256']==c['fixtureSha256']
    target=fixtures/(c['id']+'.pdf');target.write_bytes(base64.b64decode(c['fixtureBase64']));assert sha(target)==c['fixtureSha256']
    closure.append({'id':c['id'],'r30Status':prior['currentStatus'],'r30BaselineSuccess':c['r30Success'],
        'currentStatus':c['currentStatus'],'inlineParts':c['inlineParts'],'mainPass':True,'nativePass':True,'oraclePass':True,
        'fixture':'fixtures/'+target.name,'sha256':sha(target),'size':target.stat().st_size})
assert [r['r30BaselineSuccess'] for r in closure]==[False,False,True,True]
write('r30-fix-closure.json',{'faultsClosed':2,'nonemptyControlsPreserved':2,'total':4,'passed':4,'failed':0,'results':closure})
write('fixture-manifest.json',closure)
write('new-findings.json',{'newConfirmedProductIssues':0,'remainingOpenIssues':0,'additionalBoundaryChecks':28,'results':[],
    'limits':'No new issue found in reviewed source delta, inherited corpus and directed boundary checks; not proof for every PDF or live LMS behavior.'})

old_issues=read(out.parent/'round-30/evidence/issue-status.json')['issues'];issues=[]
for previous in old_issues:
    cases=[next(r for r in main['results'] if r['id']==case_id) for case_id in previous['currentChecks']]
    assert cases and all(r['pass'] for r in cases)
    note=previous['assessment']
    if previous['issueId']=='R19-01':note='Đã đóng hai lỗi Name rỗng R30 bằng nguồn cũ đúng hash và mẫu PDF cùng hash; 414/414 ca gắn nhóm, 221/221 native media, oracle từ điển 54/54 và Name 4/4, 28/28 kiểm tra biên bổ sung đạt.'
    if previous['issueId']=='R19-09':note='grade-worker.ts giữ nguyên hash R30; 277/277 ca gắn nhóm, 88/88 native worker và hai oracle JS/Python 88/88 đạt. Không tái hiện VERIFIED sai trong corpus giả; chưa xác nhận LMS thật.'
    issues.append({'issueId':previous['issueId'],'status':'CLOSED_SOURCE','severity':None,'assessment':note,
        'passed':len(cases),'failed':0,'currentChecks':[r['id'] for r in cases],'failingChecks':[]})
assert len(issues)==14
write('issue-status.json',{'round':31,'verdict':'GO','scope':'SOURCE_ONLY','closedSource':14,'remainingOpen':0,'remainingP1':0,'remainingP2':0,'issues':issues})

# Preserve raw historical FAIL/BLOCKED, then corroborate the current contract separately.
old_history=read(out.parent/'round-30/evidence/historical-contract-differences.json');raw={}
for name in ['round16','round19','round20','round21']:
    d=data(name);row={'passed':d['passed'],'failed':d['failed'],'failedIds':sorted(r['id'] for r in d['results'] if not r['pass'])}
    assert row==old_history['raw'][name],(name,row)
    assert latest[name]['exitCode']==1
    raw[name]=row
legacy=data('round15')
assert (legacy['confirmedBugs'],legacy['baselinePassed'],legacy['executionErrors'])==(0,2,8)
for name,text in [('historical14','Do not overwrite a previous run'),('historical18','Audit already captured')]:
    assert latest[name]['exitCode']==1 and text in (e/latest[name]['log']).read_text(encoding='utf-8')
compat=[r for r in main['results'] if '-COMPAT-' in r['id']]
assert len(compat)==10 and all(r['pass'] for r in compat)
write('historical-contract-differences.json',{'raw':raw,'sameFailuresAsR30':True,
    'round15':{'confirmedBugs':0,'baselinePassed':2,'executionErrors':8,'status':'FAIL_HISTORICAL_CONTRACT'},
    'round14and18':{'status':'BLOCKED_REPLAY_PRECONDITION','reason':'Immutable one-time runners refuse overwriting previously captured evidence. No bypass/deletion.'},
    'round16Reason':old_history['round16Reason'] if 'round16Reason' in old_history else 'Historical expectation is 7 tables; current schema has 8, including durable homework metadata.',
    'round19Reason':old_history['round19Reason'],'round20Reason':old_history['round20Reason'],'round21Reason':old_history['round21Reason'],
    'freshCompatibilityChecks':compat,'historicalResultsNotReclassified':True})

rows=[]
for name,c in latest.items():
    status='PASS' if c['exitCode']==0 else ('BLOCKED_REPLAY_PRECONDITION' if name in ['historical14','historical18'] else 'FAIL_HISTORICAL_CONTRACT')
    rows.append({'name':name,'status':status,'attempt':c['attempt'],'exitCode':c['exitCode'],
        'total':c.get('total'),'passed':c.get('passed'),'failed':c.get('failed'),'log':c['log'],'results':c.get('results')})
write('gate-summary.json',{'distinctGates':len(latest),'attempts':len(commands),'pass':sum(r['status']=='PASS' for r in rows),
    'historicalFail':sum(r['status']=='FAIL_HISTORICAL_CONTRACT' for r in rows),'historicalBlocked':2,
    'launchFailuresRetained':sum(c['exitCode']==127 for c in commands),'gates':rows})
provenance=read(e/'harness-provenance.json')
if isinstance(provenance,dict):provenance=provenance['derivatives']
for row in provenance:
    row['sha256']=sha(out/row['file'])
    if row['file']=='pdf_dict_oracle.py':row['changes']='Original independent dictionary() unchanged; added executable 54-case wrapper.'
    if row['file']=='pdf-name-oracle.py':row['changes']='Audit paths/prefix and baseline metadata key r29Success -> r30Success; same 4 Name expectations.'
write('harness-provenance.json',{'derivatives':provenance,'newIndependentFiles':[
    {'file':f,'sha256':sha(out/f)} for f in ['pdf-name-repro.mjs','graphql_worker_oracle.py','export-worker-cases.mjs','pdf-boundary-repro.mjs']],
    'main819UnchangedExceptAuditMetadata':True,'historicalHarnessesModified':False})
print(json.dumps({'verdict':'GO','closedSource':14,'distinctGates':len(latest),'attempts':len(commands),'boundaryChecks':28}))
