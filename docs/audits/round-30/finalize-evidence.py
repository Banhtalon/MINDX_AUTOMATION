"""Reconcile original gates, exact source, native corroboration and preserved workspace bytes."""
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

p=Path(__file__).resolve().parent
root=p.parents[2]
e=p/'evidence'
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
read=lambda f:json.loads(f.read_text(encoding='utf-8'))
def write(n,d):
    (e/n).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

commands=read(e/'commands.json')
latest={}
for r in commands:
    assert Path(r['cwd']).resolve().is_relative_to(Path(os.environ['TEMP']).resolve())
    assert sha(e/r['log'])==r['logSha256'],r['log']
    if 'results' in r:assert sha(e/r['results'])==r['resultsSha256'],r['results']
    if r['attempt']>latest.get(r['name'],{}).get('attempt',0):latest[r['name']]=r
assert {f.name for f in e.glob('*.log')}=={r['log'] for r in commands}
assert len(latest)==42 and len(commands)==48,(len(latest),len(commands))
def data(n):return read(e/latest[n]['results'])
required={'native30-worker':88,'pdf-name-oracle':4,
    'round29':815,'native29-media':217,'native29-worker':88,
    'round28':737,'native28-media':163,'native28-worker':64,
    'round27':662,'native27-media':120,'native27-worker':32,
    'round26':510,'native26-media':94,'native26-worker':54,
    'round25':344,'native25-media':25,'native25-worker':9,
    'round24':230,'round23':116,'round22':53,'native24':8,
    'graphql-oracle':88,'pdf-baseline':8}
for name,count in required.items():
    d=data(name)
    assert latest[name]['exitCode']==0 and (d['total'],d['passed'],d['failed'])==(count,count,0),name
for name in ['round12','round13','round17','phase4','phase5','typecheck-before','build','typecheck-after','pdf-oracle']:
    assert latest[name]['exitCode']==0,name
assert latest['typecheck-before']['startedAt']<latest['build']['startedAt']<latest['typecheck-after']['startedAt']
assert '22/22' in (e/latest['build']['log']).read_text(encoding='utf-8')
assert len(data('pdf-oracle')['results'])==113 and data('pdf-oracle')['r29IndependentDictionaryChecks']==54
assert data('pdf-baseline')['status']=='HASH_VERIFIED_R28_R29_BASELINES'
main=data('round30');old=data('round29');media=data('native30-media');worker=data('native30-worker')
assert (main['total'],main['passed'],main['failed'])==(819,817,2)
assert (media['total'],media['passed'],media['failed'])==(221,219,2)
assert [(r['id'],r['criterion'],r['pass']) for r in main['results'][:815]]==[(r['id'],r['criterion'],r['pass']) for r in old['results']]
assert len({r['id'] for r in main['results']})==819
assert {r['id'] for r in main['results'] if not r['pass']}=={r['id'] for r in media['results'] if not r['pass']}=={r['id'] for r in data('pdf-name')['results'] if not r['pass']}
assert not any(r['expectedVerified']==0 and r['verified']!=0 for r in worker['results'])
base=(p.parent/'round-29/verify-independent.mjs').read_text(encoding='utf-8')
s=base.replace('// Round 29 harness','// Round 30 harness',1)
s=s.replace("from './worker-cases.mjs'","from '../round-29/worker-cases.mjs'").replace("from './media-cases.mjs'","from '../round-29/media-cases.mjs'")
s=s.replace('docs/audits/round-29','docs/audits/round-30').replace("root.includes('mindx-round29-')","root.includes('mindx-round30-')").replace("'mindx-round29-fixtures-'","'mindx-round30-fixtures-'")
s=s.replace('round:29,inheritedR28Checks:737','round:30,inheritedR29Checks:815')
s=s.replace('const root =',"import {createR30MediaCases} from './media-cases.mjs';\n\nconst root =",1)
s=s.replace('} finally {\n  process.chdir(previousCwd);',(p/'r30-cases.inc.txt').read_text(encoding='utf-8')+'\n} finally {\n  process.chdir(previousCwd);')
assert (p/'verify-independent.mjs').read_bytes()==s.encode('utf-8')

manifest=read(e/'source-manifest.json')['files']
snapshot_checks=[]
for cwd in sorted({r['cwd'] for r in commands}):
    snap=Path(cwd)
    changed=[k for k,v in manifest.items() if not (snap/k).is_file() or sha(snap/k)!=v['sha256']]
    assert changed in [[],['next-env.d.ts']],(cwd,changed)
    snapshot_checks.append({'snapshot':cwd,'sourceFileCount':len(manifest),'changedFiles':changed,'productFilesMatchManifest':True})
primary=Path(read(e/'snapshot.json')['snapshot'])
executed=['verify-independent.mjs','media-cases.mjs','native-media-repro.mjs','native-worker-repro.mjs','graphql-oracle.mjs','pdf-name-repro.mjs','pdf-name-oracle.py',
    'block-string-oracle.mjs','pdf-oracle.py','pdf_dict_oracle.py','pdf-baseline-repro.mjs','network-guard.cjs']
assert all(sha(p/f)==sha(primary/'docs/audits/round-30'/f) for f in executed)
for d,f in [(main,'verify-independent.mjs'),(media,'native-media-repro.mjs'),(worker,'native-worker-repro.mjs')]:
    assert d['harnessSha256']==sha(p/f)
assert all(v==sha(root/k)==sha(primary/k) for k,v in main['sourceHashes'].items())
for n in range(12,30):
    before=read(e/'before-hashes.json')
    for k,v in before.items():
        if k.startswith(f'docs/audits/round-{n}/') and k.endswith(('.mjs','.cjs','.py','.ts','.txt')):
            # Original harnesses are copied byte-identically; result/log files may change only inside TEMP.
            assert sha(primary/k)==v['sha256'],k

for name,target in [('round30','verify-results.json'),('native30-media','native-media-results.json'),('native30-worker','native-worker-results.json'),
    ('pdf-oracle','pdf-oracle-results.json'),('graphql-oracle','graphql-oracle-results.json'),('pdf-baseline','pdf-baseline-results.json'),
    ('pdf-name','pdf-name-results.json'),('pdf-name-oracle','pdf-name-oracle-results.json')]:
    shutil.copy2(e/latest[name]['results'],e/target)
closure=[]
fixtures=e/'fixtures';fixtures.mkdir(exist_ok=True)
for previous in read(p.parent/'round-29/evidence/fixture-manifest.json'):
    a=next(r for r in main['results'] if r['id']==previous['id'])
    b=next(r for r in media['results'] if r['id']==previous['id'])
    c=next(r for r in data('pdf-baseline')['results'] if r['id']==previous['id'])
    assert a['pass'] and b['pass'] and c['pass']
    target=fixtures/(previous['id']+'.pdf')
    target.write_bytes(base64.b64decode(b['fixtureBase64']))
    assert sha(target)==previous['sha256']
    closure.append({'id':previous['id'],'expected':b['expected'],'currentStatus':b['parseStatus'],'inlineParts':b['inlineParts'],
        'mainPass':True,'nativePass':True,'r29FaultReproducedOnHashVerifiedSource':True,
        'r28Success':c['r28Success'],'r29Success':c['r29Success'],'fixture':target.relative_to(e).as_posix(),
        'sha256':sha(target),'size':target.stat().st_size})
write('r29-fix-closure.json',{'total':8,'closed':8,'failed':0,'results':closure})
new=[]
for r in data('pdf-name')['results']:
    assert r['r29Success']
    if r['pass']:continue
    target=fixtures/(r['id']+'.pdf');target.write_bytes(base64.b64decode(r['fixtureBase64']))
    assert sha(target)==r['fixtureSha256']
    new.append({'id':r['id'],'issueId':'R19-01','severity':'P2','expected':'PARSED','currentStatus':r['currentStatus'],
        'inlineParts':r['inlineParts'],'r29Success':True,'mainPass':False,'nativePass':False,'pypdfAndIndependentOraclePass':True,
        'fixture':target.relative_to(e).as_posix(),'sha256':sha(target),'size':target.stat().st_size})
assert len(new)==2
write('new-findings.json',{'issueId':'R19-01','severity':'P2','totalFailingCases':2,'results':new})
write('fixture-manifest.json',closure+new)
old_issues=read(p.parent/'round-29/evidence/issue-status.json')['issues'];issues=[]
for n in range(1,15):
    checks=[r for r in main['results'] if re.match(r'^R\d{2}-'+f'{n:02d}'+'-',r['id'])]
    checks += [r for r in main['results'] if r['id'].startswith('R26-COMPAT-') and re.search(r'-'+f'{n:02d}'+'-',r['id'])]
    assert checks and (n==1 or all(r['pass'] for r in checks))
    assessment=old_issues[n-1]['assessment']
    if n==1:assessment='Đóng đủ 8 lỗi R29, 410/410 ca kế thừa gắn nhóm đạt. Bốn ca R30 bổ sung có hai ca hồi quy P2: empty Name hợp lệ trong mảng/từ điển con bị PARSE_ERROR. Nguồn R29 đúng hash nhận cả bốn; pypdf strict và oracle byte độc lập xác nhận 4/4 hợp lệ. Còn 2/414 ca gắn nhóm trượt.'
    if n==9:assessment='Giữ nguyên grade-worker.ts đúng hash R29. Đủ 277/277 ca gắn nhóm, native worker 88/88, oracle GraphQL 88/88; không tái hiện VERIFIED sai trong corpus. Chưa xác nhận schema hoặc tài khoản LMS thật.'
    issues.append({'issueId':f'R19-{n:02d}','status':'PARTIALLY_FIXED' if n==1 else 'CLOSED_SOURCE','severity':'P2' if n==1 else None,'assessment':assessment,
        'currentChecks':[r['id'] for r in checks],'passed':sum(r['pass'] for r in checks),'failed':sum(not r['pass'] for r in checks),'failingChecks':[r['id'] for r in checks if not r['pass']]})
write('issue-status.json',{'round':30,'verdict':'NO-GO','scope':'SOURCE_ONLY','closedSource':13,'partiallyFixed':1,'remainingP1':0,'remainingP2':1,'issues':issues})
history=read(p.parent/'round-29/evidence/historical-contract-differences.json')
for name in ['round16','round19','round20','round21']:
    d=data(name);failed=sorted(r['id'] for r in d['results'] if not r['pass'])
    assert d['failed']==history['raw'][name]['failed'] and failed==history['raw'][name]['failedIds']
    history['raw'][name]={'passed':d['passed'],'failed':d['failed'],'failedIds':failed}
compat=[r for r in main['results'] if '-COMPAT-' in r['id']]
assert len(compat)==10 and all(r['pass'] for r in compat)
history['freshCompatibilityChecks']=compat
history['round15']={'confirmedBugs':data('round15')['confirmedBugs'],'baselinePassed':data('round15')['baselinePassed'],
    'executionErrors':data('round15')['executionErrors'],'meaning':'Original historical bug-reproduction and outdated fixture/schema expectations retained; not a product PASS.'}
history['round14and18']={'status':'BLOCKED_REPLAY_PRECONDITION','exitCodes':{n:latest[n]['exitCode'] for n in ['historical14','historical18']},
    'reason':'Original one-time capture runners refuse overwriting already captured evidence. No deletion or bypass. Current component/type/build gates executed independently.'}
assert latest['historical14']['exitCode']==latest['historical18']['exitCode']==1
write('historical-contract-differences.json',history)
write('snapshot-source-check.json',snapshot_checks)
write('gate-summary.json',{'distinctCommands':len(latest),'attempts':len(commands),'finalExitZero':sum(r['exitCode']==0 for r in latest.values()),
    'historicalNonzero':[n for n,r in latest.items() if r['exitCode']!=0 and n not in ['round30','native30-media','pdf-name']],
    'currentFailureNames':['round30','native30-media','pdf-name'],'allInheritedR29RequiredGatesPassed':True,
    'allCurrentRequiredGatesPassed':False,'historicalFailuresPreserved':True,'gates':list(latest.values())})
write('artifact-check.json',{'inheritedR29AssertionsAndResultsIdentical':True,'inheritedCount':815,'newMainAssertions':4,
    'nativeFailureIdsMatchMain':True,'sourceHashesMatchRootAndAllExecutionSnapshots':True,'executedHarnessBytesMatchDelivery':True,
    'allReceiptHashesVerified':True,'r29EightFixturesByteIdenticalAndClosed':True,'tenCompatibilityControlsPass':True,
    'commandAttempts':len(commands),'distinctCommands':len(latest),'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
subprocess.run(['python',str(p/'audit-runner.py'),'preserve'],cwd=root,check=True)
write('source-state-after.json',{'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),
    'gitStatus':subprocess.check_output(['git','status','--short'],cwd=root,text=True,encoding='utf-8'),'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
print(json.dumps({'verdict':'NO-GO_SOURCE_ONLY','closedSource':13,'main':'817/819','media':'219/221','worker':'88/88',
    'protected':read(e/'preservation-check.json')['protectedCount']}))
