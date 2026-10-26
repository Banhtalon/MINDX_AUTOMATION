"""Reconcile fresh R28 receipts with inherited assertions, direct imports and original bytes."""
import base64
import datetime
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess

OUT=Path(__file__).resolve().parent
ROOT=OUT.parents[2]
E=OUT/'evidence'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
read=lambda p:json.loads(p.read_text(encoding='utf-8'))
def write(name,obj):
    (E/name).write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
commands=read(E/'commands.json')
latest={r['name']:r for r in commands}
def data(name):return read(E/latest[name]['results'])
main=data('round28');old=data('round27');media=data('native28-media');worker=data('native28-worker')
required={'round27':662,'native27-media':120,'native27-worker':32,'round26':510,'native26-media':94,'native26-worker':54,'round25':344,'native25-media':25,'native25-worker':9,'round24':230,'round23':116,'round22':53,'native24':8}
for name,count in required.items():
    d=data(name)
    assert latest[name]['exitCode']==0 and (d['total'],d['passed'],d['failed'])==(count,count,0),name
for name in ['phase4','phase5','typecheck-before','build','typecheck-after','graphql-oracle','pdf-oracle','round12','round13','round17']:
    assert latest[name]['exitCode']==0,name
assert (main['total'],main['passed'],main['failed'])==(737,728,9)
assert (media['total'],media['passed'],media['failed'])==(163,157,6)
assert (worker['total'],worker['passed'],worker['failed'])==(64,61,3)
assert data('graphql-oracle')['passed']==64
assert [(r['id'],r['criterion'],r['pass']) for r in main['results'][:662]]==[(r['id'],r['criterion'],r['pass']) for r in old['results']]
assert len({r['id'] for r in main['results']})==main['total']
fail=lambda d:{r['id'] for r in d['results'] if not r['pass']}
assert fail(main)==fail(media)|fail(worker)
assert not any(r['expectedVerified']==0 and r['verified']!=0 for r in worker['results'])
for name in ['round16','round19','round20','round21']:
    previous=read(OUT.parent/'round-27/evidence/historical-contract-differences.json')['raw'][name]
    assert data(name)['failed']==previous['failed'] and sorted(fail(data(name)))==previous['failedIds']
snap=Path(read(E/'snapshot.json')['snapshot'])
manifest=read(E/'source-manifest.json')
snapshot_changes=[k for k,v in manifest['files'].items() if not (snap/k).is_file() or sha(snap/k)!=v['sha256']]
assert snapshot_changes==['next-env.d.ts'],snapshot_changes
secondary=snap.parent/'mindx-round20-compat-mindx-round21-compat/snapshot'
assert all((secondary/k).is_file() and sha(secondary/k)==v['sha256'] for k,v in manifest['files'].items() if k.startswith(('src/','scripts/')))
original_changes=[k for k,v in manifest['files'].items() if not (ROOT/k).is_file() or sha(ROOT/k)!=v['sha256']]
allowed=['MINDX_AUTOMATION_PLAN.md'] if (E/'plan-update.json').exists() else []
assert original_changes==allowed,original_changes
assert all(v==sha(ROOT/k)==sha(snap/k) for k,v in main['sourceHashes'].items())
executed=['verify-independent.mjs','media-cases.mjs','worker-cases.mjs','native-media-repro.mjs','native-worker-repro.mjs','graphql-oracle.mjs','pdf-oracle.py','network-guard.cjs']
assert all(sha(OUT/f)==sha(snap/'docs/audits/round-28'/f) for f in executed)
for d,f in [(main,'verify-independent.mjs'),(media,'native-media-repro.mjs'),(worker,'native-worker-repro.mjs')]:assert d['harnessSha256']==sha(OUT/f)
for r in commands:
    assert sha(E/r['log'])==r['logSha256'],r['log']
    if 'results' in r:assert sha(E/r['results'])==r['resultsSha256'],r['results']
    assert Path(r['cwd']).is_relative_to(snap.parent)
for name,target in [('round28','verify-results.json'),('native28-media','native-media-results.json'),('native28-worker','native-worker-results.json'),('graphql-oracle','graphql-oracle-results.json'),('pdf-oracle','pdf-oracle-results.json')]:shutil.copy2(E/latest[name]['results'],E/target)
fixtures=E/'fixtures';fixtures.mkdir(exist_ok=True);fixture_manifest=[]
for r in media['results']:
    if r['pass']:continue
    p=fixtures/(r['id']+'.pdf');p.write_bytes(base64.b64decode(r['fixtureBase64']))
    fixture_manifest.append({'id':r['id'],'file':p.relative_to(E).as_posix(),'sha256':sha(p),'size':p.stat().st_size,'expected':r['expected'],'observed':r['parseStatus']})
for r in worker['results']:
    if r['pass']:continue
    p=fixtures/(r['id']+'.json');p.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    fixture_manifest.append({'id':r['id'],'file':p.relative_to(E).as_posix(),'sha256':sha(p),'expectedVerified':r['expectedVerified'],'observedVerified':r['verified']})
assert len(fixture_manifest)==9
write('fixture-manifest.json',fixture_manifest)
old_issues=read(OUT.parent/'round-27/evidence/issue-status.json')['issues'];issues=[]
for n in range(1,15):
    checks=[r for r in main['results'] if re.match(r'^R\d{2}-'+f'{n:02d}'+'-',r['id'])]
    checks += [r for r in main['results'] if r['id'].startswith('R26-COMPAT-') and re.search(r'-'+f'{n:02d}'+'-',r['id'])]
    assert checks
    assessment=old_issues[n-1]['assessment']
    if n==1:assessment='4/4 PDF lỗi R27 đã đóng; 120/120 native R27 và 94/94 native R26 đạt. 6 PDF R28 sai kiểu Length/Count hoặc có khóa thiếu giá trị vẫn PARSED + inlineData; native xác nhận.'
    if n==9:assessment='8/8 lỗi R27 đã đóng, gồm 3 đường VERIFIED sai và 5 false negative. R28 không tái hiện VERIFIED sai; còn 3 block string nhiều dòng hợp lệ bị từ chối do thiếu BlockStringValue. Hạ mức còn lại từ P1 xuống P2 trong phạm vi đã kiểm; chưa xác nhận schema LMS thật.'
    issue={'issueId':f'R19-{n:02d}','status':'PARTIALLY_FIXED' if n in [1,9] else 'CLOSED_SOURCE','severity':'P2' if n in [1,9] else None,'assessment':assessment,'currentChecks':[r['id'] for r in checks],'passed':sum(r['pass'] for r in checks),'failed':sum(not r['pass'] for r in checks),'failingChecks':[r['id'] for r in checks if not r['pass']]}
    if n not in [1,9]:assert issue['failed']==0
    issues.append(issue)
write('issue-status.json',{'round':28,'verdict':'NO-GO','closedSource':12,'partiallyFixed':2,'remainingP1':0,'remainingP2':2,'issues':issues})
history=read(OUT.parent/'round-27/evidence/historical-contract-differences.json')
history['raw']={name:{'passed':data(name)['passed'],'failed':data(name)['failed'],'failedIds':sorted(fail(data(name)))} for name in ['round16','round19','round20','round21']}
history['freshCompatibilityChecks']=[r for r in main['results'] if '-COMPAT-' in r['id']]
assert len(history['freshCompatibilityChecks'])==10 and all(r['pass'] for r in history['freshCompatibilityChecks'])
history['round15']={'confirmedBugs':data('round15')['confirmedBugs'],'baselinePassed':data('round15')['baselinePassed'],'executionErrors':data('round15')['executionErrors'],'meaning':'Seven original bug-reproduction assertions or outdated fixture contracts fail, plus seven-table schema expectation. Includes a fixture type error; not evidence that all former bugs are fixed. Raw results are not converted to PASS.'}
history['round14and18']={'status':'BLOCKED_REPLAY_PRECONDITION','exitCodes':{name:latest[name]['exitCode'] for name in ['historical14','historical18']},'reason':'Original one-time capture runners explicitly refuse overwriting existing historical evidence. Executed unchanged in snapshot; did not delete old records or bypass guards. Their constituent R12/R13/R16/R17 and type/build gates ran separately.'}
write('historical-contract-differences.json',history)
old_manifest=read(OUT.parent/'round-27/evidence/source-manifest.json')['files']
write('changes-since-r27.json',{'productChanges':[k for k,v in manifest['files'].items() if k.startswith(('src/','scripts/')) and old_manifest.get(k)!=v],'documentDifferences':[k for k,v in manifest['files'].items() if not k.startswith(('src/','scripts/')) and old_manifest.get(k)!=v]})
write('runtime-versions.json',{'node':read(E/'isolation.json')['nodeVersion'],'python':subprocess.check_output(['python','--version'],text=True).strip(),'packages':{name:read(snap/'node_modules'/name/'package.json')['version'] for name in ['next','typescript','tsx','better-sqlite3','sharp','react','playwright']}})
write('artifact-check.json',{'inheritedR27AssertionsAndResultsIdentical':True,'inheritedCount':662,'r28NewChecks':75,'nativeFailureIdsEqualMain':True,'sourceHashesMatchRootAndSnapshot':True,'snapshotOnlyGeneratedNextEnvChanged':True,'executedHarnessBytesMatchDelivery':True,'allReceiptHashesVerified':True,'originalSourceChanges':original_changes,'commandAttempts':len(commands),'distinctCommands':len(latest),'latestExitZero':sum(r['exitCode']==0 for r in latest.values()),'latestExitNonzero':sum(r['exitCode']!=0 for r in latest.values()),'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
subprocess.run(['python',str(OUT/'audit-runner.py'),'preserve'],cwd=ROOT,check=True)
write('source-state-after.json',{'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'gitStatus':subprocess.check_output(['git','status','--short'],cwd=ROOT,text=True,encoding='utf-8'),'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
write('evidence-manifest.json',{'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':{p.relative_to(OUT).as_posix():{'size':p.stat().st_size,'sha256':sha(p)} for p in sorted(OUT.rglob('*')) if p.is_file() and p.name!='evidence-manifest.json'},'note':'Excludes itself. All attempts retained. Main workspace permits only new R28 documents and recorded plan entry.'})
print(json.dumps({'total':main['total'],'passed':main['passed'],'failed':main['failed'],'closedSource':12,'verdict':'NO-GO','protected':read(E/'preservation-check.json')['protectedCount']}))
