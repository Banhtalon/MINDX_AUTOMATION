"""Reconcile actual receipts, exact source, assertion lineage, native repro, fixtures and protected files."""
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
def write(name,data):
    (E/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
commands=read(E/'commands.json');latest={r['name']:r for r in commands}
def data(name):return read(E/latest[name]['results'])
main=data('round27');old=data('round26');media=data('native27-media');worker=data('native27-worker')
required={'round26':510,'native26-media':94,'native26-worker':54,'round25':344,'native25-media':25,'native25-worker':9,'round24':230,'round23':116,'round22':53,'native24':8}
for name,count in required.items():
    d=data(name)
    assert latest[name]['exitCode']==0 and (d['total'],d['passed'],d['failed'])==(count,count,0),name
for name in ['phase4','phase5','typecheck-before','build','typecheck-after','graphql-oracle','pdf-oracle']:
    assert latest[name]['exitCode']==0,name
assert (main['total'],main['passed'],main['failed'])==(662,650,12)
assert (media['total'],media['passed'],media['failed'])==(120,116,4)
assert (worker['total'],worker['passed'],worker['failed'])==(32,24,8)
assert [(r['id'],r['criterion'],r['pass']) for r in main['results'][:510]]==[(r['id'],r['criterion'],r['pass']) for r in old['results']]
assert len({r['id'] for r in main['results']})==main['total']
fail=lambda d:{r['id'] for r in d['results'] if not r['pass']}
assert fail(main)==fail(media)|fail(worker)
assert data('graphql-oracle')['passed']==32
snap=Path(read(E/'snapshot.json')['snapshot']);manifest=read(E/'source-manifest.json')
snapshot_changes=[k for k,v in manifest['files'].items() if not (snap/k).is_file() or sha(snap/k)!=v['sha256']]
assert snapshot_changes==['next-env.d.ts'],snapshot_changes
secondary=snap.parent/'mindx-round20-compat-mindx-round21-compat/snapshot'
secondary_product_changes=[k for k,v in manifest['files'].items() if k.startswith(('src/','scripts/')) and (not (secondary/k).is_file() or sha(secondary/k)!=v['sha256'])]
assert not secondary_product_changes,secondary_product_changes
original_changes=[k for k,v in manifest['files'].items() if not (ROOT/k).is_file() or sha(ROOT/k)!=v['sha256']]
allowed=['MINDX_AUTOMATION_PLAN.md'] if (E/'plan-update.json').exists() else []
assert original_changes==allowed,original_changes
assert not [k for k,v in main['sourceHashes'].items() if v!=sha(ROOT/k) or v!=sha(snap/k)]
executed=['verify-independent.mjs','media-cases.mjs','worker-cases.mjs','native-media-repro.mjs','native-worker-repro.mjs','graphql-oracle.mjs','pdf-oracle.py','network-guard.cjs']
assert all(sha(OUT/f)==sha(snap/'docs/audits/round-27'/f) for f in executed)
for d,f in [(main,'verify-independent.mjs'),(media,'native-media-repro.mjs'),(worker,'native-worker-repro.mjs')]:assert d['harnessSha256']==sha(OUT/f)
for r in commands:
    assert sha(E/r['log'])==r['logSha256'],r['log']
    if 'results' in r:assert sha(E/r['results'])==r['resultsSha256'],r['results']
    assert Path(r['cwd']).is_relative_to(snap.parent)
for name,target in [('round27','verify-results.json'),('native27-media','native-media-results.json'),('native27-worker','native-worker-results.json'),('graphql-oracle','graphql-oracle-results.json'),('pdf-oracle','pdf-oracle-results.json')]:
    shutil.copy2(E/latest[name]['results'],E/target)
fixtures=E/'fixtures';fixtures.mkdir(exist_ok=True);fixture_manifest=[]
for r in media['results']:
    if r['pass']:continue
    p=fixtures/(r['id']+('.pdf' if '-pdf-' in r['id'] else '.webp'));p.write_bytes(base64.b64decode(r['fixtureBase64']))
    fixture_manifest.append({'id':r['id'],'file':p.relative_to(E).as_posix(),'sha256':sha(p),'size':p.stat().st_size,'expected':r['expected'],'observed':r['parseStatus']})
for r in worker['results']:
    if r['pass']:continue
    p=fixtures/(r['id']+'.json');p.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    fixture_manifest.append({'id':r['id'],'file':p.relative_to(E).as_posix(),'sha256':sha(p),'expectedVerified':r['expectedVerified'],'observedVerified':r['verified']})
assert len(fixture_manifest)==12
write('fixture-manifest.json',fixture_manifest)
old_issues=read(OUT.parent/'round-26/evidence/issue-status.json')['issues'];issues=[]
for n in range(1,15):
    checks=[r for r in main['results'] if re.match(r'^R\d{2}-'+f'{n:02d}'+'-',r['id'])]
    checks += [r for r in main['results'] if r['id'].startswith('R26-COMPAT-') and re.search(r'-'+f'{n:02d}'+'-',r['id'])]
    assert checks
    assessment=old_issues[n-1]['assessment']
    if n==1:assessment='R26 94/94 và 104 WebP mới đạt. Còn 3 PDF marker endstream nằm trong stream bị coi là ranh giới thật và 1 Kids có số 999 được nhận PARSED; native xác nhận 4/4.'
    if n==9:assessment='R26 54/54 đạt. Còn 2 block-string decoy và 1 enum trùng token nội bộ gây VERIFIED sai trong hợp đồng giả; 5 dạng GraphQL hợp lệ bị từ chối. Native xác nhận 8/8; chưa xác nhận schema LMS thật.'
    issue={'issueId':f'R19-{n:02d}','status':'PARTIALLY_FIXED' if n in [1,9] else 'CLOSED_SOURCE','severity':'P1' if n==9 else 'P2' if n==1 else None,
           'assessment':assessment,'currentChecks':[r['id'] for r in checks],'passed':sum(r['pass'] for r in checks),'failed':sum(not r['pass'] for r in checks),'failingChecks':[r['id'] for r in checks if not r['pass']]}
    if n not in [1,9]:assert issue['failed']==0
    issues.append(issue)
write('issue-status.json',{'round':27,'verdict':'NO-GO','closedSource':12,'partiallyFixed':2,'issues':issues})
write('historical-contract-differences.json',{
    'raw':{name:{'passed':data(name)['passed'],'failed':data(name)['failed'],'failedIds':sorted(fail(data(name)))} for name in ['round16','round19','round20','round21']},
    'round16Reason':'Seven-table expectation predates eighth durable metadata table; original assertion retained as FAIL.',
    'round19Reason':'Four old inline placeholders are corrupt/incomplete and now rejected; approval lacks mandatory reviewed snapshot.',
    'round20Reason':'Four approvals lack reviewed snapshot, one response uses saveGrade instead of selected saveHomeworkGrade.',
    'round21Reason':'Four responses use saveGrade instead of selected saveHomeworkGrade, including CAS fixture before readback.',
    'freshCompatibilityChecks':[{'id':r['id'],'pass':r['pass'],'observation':r.get('observation')} for r in main['results'] if r['id']=='R23-COMPAT-R16-schema' or r['id'].startswith(('R24-COMPAT-R20-','R26-COMPAT-'))],
    'historicalResultsNotReclassified':True})
write('static-review.json',{'method':'Read-only inspection of source and connected flows, supported by fresh source-function tests; no real browser claim.',
    'loadAssumption':'One teacher on a local computer; browser jobs sequential, asynchronous AI/draft/UI results can overlap.',
    'localHostScripts':read(ROOT/'package.json')['scripts'],
    'references':{'singlePersistentContext':'src/lib/playwright/browser-manager.ts:6-103','singleQueue':'src/lib/queue/task-queue.ts:53',
        'saveQueue':'src/app/api/homework-grader/save-lms/route.ts:29','downloadQueue':'src/app/api/homework-grader/download-and-grade/route.ts:65',
        'fileAllowlist':'src/lib/file-parsers/index.ts:287; src/lib/playwright/download-submissions.ts:87',
        'finalHashConditionalUpdate':'src/lib/db/sqlite.ts:942','graphqlTokenizer':'src/lib/playwright/grade-worker.ts:426',
        'pdfStreamMask':'src/lib/file-parsers/media-reader.ts:1156','pdfKidsScan':'src/lib/file-parsers/media-reader.ts:1318'},
    'clientEntrypoints':{f:{'sensitiveEnvironmentReference':bool(re.search(r'TEACHING_PASSWORD|LMS_PASSWORD|GEMINI_API_KEY', (ROOT/f).read_text(encoding='utf-8')))} for f in ['src/components/homework-auto-grader-tab.tsx','src/app/homework-grader/page.tsx']},
    'limits':'Targeted Phase 5 and related Phase 4 flows; not a whole-project penetration test or production acceptance.'})
versions={}
for name in ['next','typescript','tsx','sharp','better-sqlite3','playwright']:
    p=ROOT/'node_modules'/name/'package.json';assert sha(p)==sha(snap/'node_modules'/name/'package.json')
    versions[name]={'version':read(p)['version'],'packageSha256':sha(p)}
write('runtime-versions.json',versions)
write('artifact-check.json',{'mainTotal':main['total'],'mainPassed':main['passed'],'mainFailed':main['failed'],'inheritedR26IdCriterionResultIdentical':True,
    'inheritedCount':510,'newCount':152,'newPassed':140,'newFailed':12,'nativeFailedIdsExactlyMatchMain':True,'nativeMediaTotal':120,'nativeMediaPassed':116,'nativeWorkerTotal':32,'nativeWorkerPassed':24,
    'executedHarnessFilesMatchDelivery':executed,'sourceFunctionHashesMatchMainAndSnapshot':True,'secondarySnapshotProductHashesMatch':True,'snapshotSourceDifferencesAfterBuild':snapshot_changes,'originalSourceDifferencesAtDelivery':original_changes,
    'originalNextEnvSha256':sha(ROOT/'next-env.d.ts'),'snapshotNextEnvSha256':sha(snap/'next-env.d.ts'),'sourceFileCount':len(manifest['files']),
    'srcScriptsCount':sum(k.startswith(('src/','scripts/')) for k in manifest['files']),
    'r26RequiredGatesAllPass':True,'allAuditChecksPass':False,'commandAttempts':len(commands),'uniqueCommands':len(latest),'latestExitZero':sum(r['exitCode']==0 for r in latest.values()),'latestExitNonzero':sum(r['exitCode']!=0 for r in latest.values()),
    'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
subprocess.run(['python',str(OUT/'audit-runner.py'),'preserve'],cwd=ROOT,check=True)
write('source-state-after.json',{'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
    'gitStatus':subprocess.check_output(['git','status','--short'],cwd=ROOT,text=True,encoding='utf-8'),
    'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
write('evidence-manifest.json',{'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'files':{p.relative_to(OUT).as_posix():{'size':p.stat().st_size,'sha256':sha(p)} for p in sorted(OUT.rglob('*')) if p.is_file() and p.name!='evidence-manifest.json'},
    'note':'Excludes itself. Original attempt files and logs retained. Only R27 documentation and the explicitly recorded audit-plan entry may change in main workspace.'})
print(json.dumps({'total':main['total'],'passed':main['passed'],'failed':main['failed'],'closedSource':12,'verdict':'NO-GO','protected':read(E/'preservation-check.json')['protectedCount']}))
