"""Reconcile fresh results with exact source, inherited assertions and protected bytes."""
import base64
import datetime
import difflib
import hashlib
import json
import os
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
snap=Path(read(E/'snapshot.json')['snapshot'])
# The first historical launch failed before a child existed. Retain its empty log
# and represent the missing exit code honestly rather than inventing a test FAIL.
orphan=E/'round20.attempt-1.log'
if orphan.exists() and not any(r['log']==orphan.name for r in commands):
    commands.append({'name':'round20','attempt':1,'argv':[shutil.which('node.exe'),'docs/audits/round-20/verify-independent.mjs'],
        'cwd':str(snap.parent/'mindx-round20-compat-mindx-round21-compat/snapshot'),
        'exitCode':None,'runnerExitCode':1,'executionStarted':False,'launchError':'NotADirectoryError [WinError 267]: cwd exceeds Windows process-launch path limit',
        'startedAt':datetime.datetime.fromtimestamp(orphan.stat().st_mtime,datetime.timezone.utc).isoformat(),
        'elapsedSeconds':0,'log':orphan.name,'logSha256':sha(orphan),'secretEnvironmentInherited':False})
commands.sort(key=lambda r:r['startedAt'])
write('commands.json',commands)
latest={}
for r in commands:
    if r['attempt']>latest.get(r['name'],{}).get('attempt',0):latest[r['name']]=r
def data(name):return read(E/latest[name]['results'])
main=data('round29');old=data('round28');media=data('native29-media');worker=data('native29-worker')
required={'round28':737,'native28-media':163,'native28-worker':64,'round27':662,'native27-media':120,'native27-worker':32,
    'round26':510,'native26-media':94,'native26-worker':54,'round25':344,'native25-media':25,'native25-worker':9,
    'round24':230,'round23':116,'round22':53,'native24':8}
for name,count in required.items():
    d=data(name)
    assert latest[name]['exitCode']==0 and (d['total'],d['passed'],d['failed'])==(count,count,0),name
for name in ['phase4','phase5','typecheck-before','build','typecheck-after','graphql-oracle','pdf-oracle','round12','round13','round17']:
    assert latest[name]['exitCode']==0,name
assert (main['total'],main['passed'],main['failed'])==(815,807,8)
assert (media['total'],media['passed'],media['failed'])==(217,209,8)
assert (worker['total'],worker['passed'],worker['failed'])==(88,88,0)
assert data('graphql-oracle')['passed']==88
assert len(data('pdf-oracle')['results'])==113
assert data('pdf-oracle')['r29IndependentDictionaryChecks']==54
assert data('pdf-baseline')['status']=='BASELINE_SOURCE_HASH_MISMATCH'
assert [(r['id'],r['criterion'],r['pass']) for r in main['results'][:737]]==[(r['id'],r['criterion'],r['pass']) for r in old['results']]
assert len({r['id'] for r in main['results']})==main['total']
fail=lambda d:{r['id'] for r in d['results'] if not r['pass']}
assert fail(main)==fail(media)|fail(worker)
assert not any(r['expectedVerified']==0 and r['verified']!=0 for r in worker['results'])
for name in ['round16','round19','round20','round21']:
    previous=read(OUT.parent/'round-28/evidence/historical-contract-differences.json')['raw'][name]
    assert data(name)['failed']==previous['failed'] and sorted(fail(data(name)))==previous['failedIds'],name
manifest=read(E/'source-manifest.json')
snapshot_changes=[k for k,v in manifest['files'].items() if not (snap/k).is_file() or sha(snap/k)!=v['sha256']]
assert snapshot_changes==['next-env.d.ts'],snapshot_changes
secondary=Path(read(E/'secondary-snapshot.json')['snapshot'])
assert all((secondary/k).is_file() and sha(secondary/k)==v['sha256'] for k,v in manifest['files'].items() if k.startswith(('src/','scripts/')))
original_changes=[k for k,v in manifest['files'].items() if not (ROOT/k).is_file() or sha(ROOT/k)!=v['sha256']]
allowed=['MINDX_AUTOMATION_PLAN.md'] if (E/'plan-update.json').exists() else []
assert original_changes==allowed,original_changes
assert all(v==sha(ROOT/k)==sha(snap/k) for k,v in main['sourceHashes'].items())
executed=['verify-independent.mjs','media-cases.mjs','worker-cases.mjs','native-media-repro.mjs','native-worker-repro.mjs',
    'graphql-oracle.mjs','block-string-oracle.mjs','pdf-oracle.py','pdf_dict_oracle.py','pdf-baseline-repro.mjs','network-guard.cjs']
assert all(sha(OUT/f)==sha(snap/'docs/audits/round-29'/f) for f in executed)
for d,f in [(main,'verify-independent.mjs'),(media,'native-media-repro.mjs'),(worker,'native-worker-repro.mjs')]:assert d['harnessSha256']==sha(OUT/f)
for r in commands:
    assert sha(E/r['log'])==r['logSha256'],r['log']
    if 'results' in r:assert sha(E/r['results'])==r['resultsSha256'],r['results']
    assert Path(r['cwd']).is_relative_to(Path(os.environ['TEMP']))
assert {p.name for p in E.glob('*.log')}=={r['log'] for r in commands}
for name,target in [('round29','verify-results.json'),('native29-media','native-media-results.json'),('native29-worker','native-worker-results.json'),
    ('graphql-oracle','graphql-oracle-results.json'),('pdf-oracle','pdf-oracle-results.json'),('pdf-baseline','pdf-baseline-results.json')]:
    shutil.copy2(E/latest[name]['results'],E/target)
fixtures=E/'fixtures';fixtures.mkdir(exist_ok=True);fixture_manifest=[]
for r in media['results']:
    if r['pass']:continue
    p=fixtures/(r['id']+'.pdf');p.write_bytes(base64.b64decode(r['fixtureBase64']))
    fixture_manifest.append({'id':r['id'],'file':p.relative_to(E).as_posix(),'sha256':sha(p),'size':p.stat().st_size,
        'expected':r['expected'],'observed':r['parseStatus'],'inlineParts':r['inlineParts']})
assert len(fixture_manifest)==8
write('fixture-manifest.json',fixture_manifest)
old_issues=read(OUT.parent/'round-28/evidence/issue-status.json')['issues'];issues=[]
for n in range(1,15):
    checks=[r for r in main['results'] if re.match(r'^R\d{2}-'+f'{n:02d}'+'-',r['id'])]
    checks += [r for r in main['results'] if r['id'].startswith('R26-COMPAT-') and re.search(r'-'+f'{n:02d}'+'-',r['id'])]
    assert checks
    assessment=old_issues[n-1]['assessment']
    if n==1:assessment='6/6 PDF lỗi R28 đã đóng. Còn 8 ca mới R29: 6 từ điển chứa dấu phân cách rời sai cú pháp vẫn PARSED + inlineData, 2 PDF dùng NUL hợp lệ bị PARSE_ERROR. Native xác nhận đủ 8. Không gọi hai ca NUL là hồi quy đã chứng minh vì bản TEMP R28 không còn khớp hash nguồn lịch sử.'
    if n==9:assessment='3/3 block string lỗi R28 đã đóng. 277/277 ca gắn nhóm đạt, native R29 88/88, gồm 24 ca mới theo BlockStringValue và nhận xét đổi phải bị chặn. Không tái hiện VERIFIED sai trong corpus; chưa xác nhận schema LMS thật.'
    issue={'issueId':f'R19-{n:02d}','status':'PARTIALLY_FIXED' if n==1 else 'CLOSED_SOURCE','severity':'P2' if n==1 else None,
        'assessment':assessment,'currentChecks':[r['id'] for r in checks],'passed':sum(r['pass'] for r in checks),
        'failed':sum(not r['pass'] for r in checks),'failingChecks':[r['id'] for r in checks if not r['pass']]}
    if n!=1:assert issue['failed']==0
    issues.append(issue)
write('issue-status.json',{'round':29,'verdict':'NO-GO','closedSource':13,'partiallyFixed':1,'remainingP1':0,'remainingP2':1,'issues':issues})
history=read(OUT.parent/'round-28/evidence/historical-contract-differences.json')
history['raw']={name:{'passed':data(name)['passed'],'failed':data(name)['failed'],'failedIds':sorted(fail(data(name)))} for name in ['round16','round19','round20','round21']}
history['freshCompatibilityChecks']=[r for r in main['results'] if '-COMPAT-' in r['id']]
assert len(history['freshCompatibilityChecks'])==10 and all(r['pass'] for r in history['freshCompatibilityChecks'])
history['round15']={'confirmedBugs':data('round15')['confirmedBugs'],'baselinePassed':data('round15')['baselinePassed'],
    'executionErrors':data('round15')['executionErrors'],'meaning':'Original historical bug assertions and outdated contracts fail, including fixture type error and seven-table expectation. Not a product PASS.'}
history['round14and18']={'status':'BLOCKED_REPLAY_PRECONDITION','exitCodes':{name:latest[name]['exitCode'] for name in ['historical14','historical18']},
    'reason':'Original one-time capture runners refuse overwriting existing audit records. No deletion or bypass. Components and type/build gates executed separately.'}
write('historical-contract-differences.json',history)
old_manifest=read(OUT.parent/'round-28/evidence/source-manifest.json')['files']
changes={'productChanges':[k for k,v in manifest['files'].items() if k.startswith(('src/','scripts/')) and old_manifest.get(k)!=v],
    'documentDifferences':[k for k,v in manifest['files'].items() if not k.startswith(('src/','scripts/')) and old_manifest.get(k)!=v]}
assert changes['productChanges']==['src/lib/file-parsers/media-reader.ts','src/lib/playwright/grade-worker.ts']
write('changes-since-r28.json',changes)
baseline=Path(read(OUT.parent/'round-28/evidence/snapshot.json')['snapshot'])
availability=[]
for f in changes['productChanges']:
    available=(baseline/f).is_file() and sha(baseline/f)==old_manifest[f]['sha256']
    availability.append({'file':f,'baselineMatchesRecordedHash':available,'expectedSha256':old_manifest[f]['sha256'],
        'observedSha256':sha(baseline/f) if (baseline/f).is_file() else None,'diffProduced':available})
    if available:
        patch=''.join(difflib.unified_diff((baseline/f).read_text(encoding='utf-8').splitlines(True),(ROOT/f).read_text(encoding='utf-8').splitlines(True),fromfile='R28/'+f,tofile='R29/'+f))
        (E/(Path(f).stem+'.since-r28.diff')).write_text(patch,encoding='utf-8')
write('baseline-source-availability.json',availability)
write('runtime-versions.json',{'node':read(E/'isolation.json')['nodeVersion'],'python':subprocess.check_output(['python','--version'],text=True).strip(),
    'packages':{name:read(snap/'node_modules'/name/'package.json')['version'] for name in ['next','typescript','tsx','better-sqlite3','sharp','react','playwright']}})
write('artifact-check.json',{'inheritedR28AssertionsAndResultsIdentical':True,'inheritedCount':737,'r29NewChecks':78,
    'nativeFailureIdsEqualMain':True,'sourceHashesMatchRootAndSnapshot':True,'snapshotOnlyGeneratedNextEnvChanged':True,
    'executedHarnessBytesMatchDelivery':True,'allReceiptHashesVerified':True,'originalSourceChanges':original_changes,
    'commandAttempts':len(commands),'distinctCommands':len(latest),'latestExitZero':sum(r['exitCode']==0 for r in latest.values()),
    'latestExitNonzero':sum(r['exitCode'] not in [0,None] for r in latest.values()),'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
subprocess.run(['python',str(OUT/'audit-runner.py'),'preserve'],cwd=ROOT,check=True)
write('source-state-after.json',{'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
    'gitStatus':subprocess.check_output(['git','status','--short'],cwd=ROOT,text=True,encoding='utf-8'),'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
write('evidence-manifest.json',{'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'files':{p.relative_to(OUT).as_posix():{'size':p.stat().st_size,'sha256':sha(p)} for p in sorted(OUT.rglob('*')) if p.is_file() and p.name!='evidence-manifest.json'},
    'note':'Excludes itself. All attempts retained, including harness/launcher failures. Main workspace permits only R29 documentation and the recorded plan entry.'})
print(json.dumps({'total':main['total'],'passed':main['passed'],'failed':main['failed'],'closedSource':13,'verdict':'NO-GO','protected':read(E/'preservation-check.json')['protectedCount']}))
