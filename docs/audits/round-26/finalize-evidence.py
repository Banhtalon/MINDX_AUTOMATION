"""Read-only cross-checks of receipts, product identity, test lineage, and delivered evidence."""
import datetime
import base64
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

commands=read(E/'commands.json')
latest={r['name']:r for r in commands}
def data(name):return read(E/latest[name]['results'])
main=data('round26');old=data('round25');media=data('native26-media');worker=data('native26-worker')
required={'round25':344,'native25-media':25,'native25-worker':9,'round24':230,'round23':116,'round22':53}
for name,count in required.items():
    assert latest[name]['exitCode']==0
    assert (data(name)['total'],data(name)['passed'],data(name)['failed'])==(count,count,0)
for name in ['typecheck-before','build','typecheck-after','phase4','phase5']:
    assert latest[name]['exitCode']==0
assert main['total']==510 and main['passed']==499 and main['failed']==11
assert [(r['id'],r['criterion'],r['pass']) for r in main['results'][:344]]==[(r['id'],r['criterion'],r['pass']) for r in old['results']]
assert len({r['id'] for r in main['results']})==main['total']
fail=lambda d:{r['id'] for r in d['results'] if not r['pass']}
assert fail(main)==fail(media)|fail(worker)
assert len(fail(media))==7 and len(fail(worker))==4
snap=Path(read(E/'snapshot.json')['snapshot'])
manifest=read(E/'source-manifest.json')
before=read(E/'before-hashes.json')
snapshot_changes=[k for k,v in manifest['files'].items() if not (snap/k).is_file() or sha(snap/k)!=v['sha256']]
assert snapshot_changes==['next-env.d.ts'],snapshot_changes
source_hash_mismatch=[k for k,v in main['sourceHashes'].items() if v!=sha(ROOT/k) or v!=sha(snap/k)]
assert not source_hash_mismatch
executed=['verify-independent.mjs','media-cases.mjs','worker-cases.mjs','native-media-repro.mjs','native-worker-repro.mjs','graphql-oracle.mjs','pdf-oracle.py','network-guard.cjs']
assert all(sha(OUT/f)==sha(snap/'docs/audits/round-26'/f) for f in executed)
assert main['harnessSha256']==sha(OUT/'verify-independent.mjs')
assert media['harnessSha256']==sha(OUT/'native-media-repro.mjs')
assert worker['harnessSha256']==sha(OUT/'native-worker-repro.mjs')
for r in commands:
    assert sha(E/r['log'])==r['logSha256']
    if 'results' in r:assert sha(E/r['results'])==r['resultsSha256']

for name,target in [('round26','verify-results.json'),('native26-media','native-media-results.json'),('native26-worker','native-worker-results.json'),('pdf-oracle','pdf-oracle-results.json'),('graphql-oracle','graphql-oracle-results.json')]:
    shutil.copy2(E/latest[name]['results'],E/target)

fixtures=E/'fixtures';fixtures.mkdir(exist_ok=True)
fixture_manifest=[]
for r in media['results']:
    if r['pass']:continue
    p=fixtures/(r['id']+('.pdf' if '-pdf-' in r['id'] else '.webp'))
    p.write_bytes(base64.b64decode(r['fixtureBase64']))
    fixture_manifest.append({'id':r['id'],'file':p.relative_to(E).as_posix(),'sha256':sha(p),'size':p.stat().st_size,
        'expected':r['expected'],'observed':r['parseStatus'],'decoderError':r['decoderError']})
for r in worker['results']:
    if r['pass']:continue
    p=fixtures/(r['id']+'.json');p.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    fixture_manifest.append({'id':r['id'],'file':p.relative_to(E).as_posix(),'sha256':sha(p),
        'expectedVerified':r['expectedVerified'],'observedVerified':r['verified']})
write('fixture-manifest.json',fixture_manifest)

assessments={
 1:'344 ca R25 đạt. R26 vẫn nhận 3 VP8 bị cắt đuôi, 3 PDF có Root đánh lạc hướng/xung đột và 1 PDF thiếu Parent. 48 ảnh mới hợp lệ đều đạt.',
 2:'Kiểm toán tiêu chí, bằng chứng, giới hạn và tổng điểm đạt; ca mới giữ đúng 79.37 và từ chối evidence rỗng.',
 3:'Hash duyệt chặn thay feedback/decision trước Save; hợp đồng duyệt hiện tại đạt đối chứng tương thích.',
 4:'Kết quả AI cũ không ghi đè khi phiên bản file thay đổi; kiểm tra file vật lý và parsedContent đạt.',
 5:'API và handler chặn duyệt PARSE_ERROR; không bỏ kiểm toán barem hiện hành.',
 6:'Duyệt cần đủ snapshot đã xem; thay điểm/feedback sau bản xem bị 409, metadata giữ qua mở lại DB.',
 7:'Modal khác submission hoặc ID chỉ khớp một phần không được Save; khóa chủ bài đạt hồi quy.',
 8:'Lớp/buổi/lesson không khớp bị chặn; đối chứng mapping đúng đạt với trường response đúng.',
 9:'R25 135/135 ca nhóm đạt. R26 còn 2 mutation giả trong chuỗi khiến VERIFIED sai và 2 literal hợp lệ bị từ chối; xác nhận qua import trực tiếp.',
10:'Đọc lại điểm/quyết định/feedback phải khớp; không đọc được feedback không VERIFIED; control GRADE/REDO hiện tại đạt.',
11:'Drift trong Save/readback và cập nhật VERIFIED cuối thất bại đều không nâng VERIFIED; ca CAS tương thích giữ WAITING_APPROVAL.',
12:'Phản hồi lớp/buổi cũ đến muộn không thay danh sách mới trong mô phỏng handler.',
13:'SQLite rollback ở hai bảng, sequence bền sau reload, sửa nhiều trường lỗi không ghi một phần; phục hồi sau trigger lỗi đạt.',
14:'Tải thất bại/một phần dừng AI; tải thành công chỉ chấm đúng SUB1 mới tải, loại OLD_CACHED.'}
issues=[]
for n in range(1,15):
    checks=[r for r in main['results'] if re.match(r'^R\d{2}-'+f'{n:02d}'+'-',r['id'])]
    checks += [r for r in main['results'] if r['id'].startswith('R26-COMPAT-') and re.search(r'-'+f'{n:02d}'+'-',r['id'])]
    issue={'issueId':f'R19-{n:02d}','status':'PARTIALLY_FIXED' if n in [1,9] else 'CLOSED_SOURCE',
       'severity':'P1' if n==9 else 'P2' if n==1 else None,'assessment':assessments[n],
       'currentChecks':[r['id'] for r in checks],'passed':sum(r['pass'] for r in checks),'failed':sum(not r['pass'] for r in checks),
       'failingChecks':[r['id'] for r in checks if not r['pass']]}
    assert checks
    if n not in [1,9]:assert not issue['failingChecks']
    issues.append(issue)
write('issue-status.json',{'round':26,'verdict':'NO-GO','closedSource':12,'partiallyFixed':2,'issues':issues})
old_manifest=read(OUT.parent/'round-25/source-manifest.json')['files']
write('changes-since-r25.json',{'changed':[k for k,v in manifest['files'].items() if old_manifest.get(k)!=v],
    'note':'All five differences existed before this audit. No product fixes were made.'})
write('artifact-check.json',{'mainTotal':main['total'],'mainPassed':main['passed'],'mainFailed':main['failed'],
    'inheritedR25AssertionsIdentical':True,'inheritedCount':344,'newCount':166,'newPassed':155,'newFailed':11,
    'nativeMediaTotal':media['total'],'nativeMediaPassed':media['passed'],'nativeWorkerTotal':worker['total'],'nativeWorkerPassed':worker['passed'],
    'nativeFailedIdsExactlyMatchMain':True,'executedHarnessFilesMatchDelivery':executed,'sourceHashesMatchOriginalAndSnapshot':True,
    'snapshotSourceDifferencesAfterBuild':snapshot_changes,'originalNextEnvSha256':sha(ROOT/'next-env.d.ts'),
    'snapshotNextEnvSha256':sha(snap/'next-env.d.ts'),'sourceFileCount':len(manifest['files']),
    'srcScriptsCount':sum(k.startswith(('src/','scripts/')) for k in manifest['files']),
    'requiredCommandsPass':True,'allAuditChecksPass':False,'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
write('historical-contract-differences.json',{
    'round20':{'passed':data('round20')['passed'],'total':data('round20')['total'],'failedIds':sorted(fail(data('round20')))},
    'round21':{'passed':data('round21')['passed'],'total':data('round21')['total'],'failedIds':sorted(fail(data('round21')))},
    'oldApprovalContract':['API-approval-control','R20-03-legacy-reapproval','R20-05-override-control','R20-06-latest-control'],
    'oldResponseContract':['R20-10-complete-control','R21-08-mapping-valid','R21-10-readback-complete','R21-10-readback-redo-complete','R21-11-final-cas'],
    'compatibilityChecks':[{'id':r['id'],'pass':r['pass'],'observation':r.get('observation')} for r in main['results'] if r['id'].startswith(('R26-COMPAT-','R24-COMPAT-R20-'))],
    'historicalResultsNotReclassified':True})
write('static-review.json',{'method':'Targeted read-only source inspection, supported by fresh source-level tests; no real server/browser claim.',
    'localHostScripts':json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['scripts'],
    'references':{'persistentSingleContext':'src/lib/playwright/browser-manager.ts:6-103',
       'saveQueue':'src/app/api/homework-grader/save-lms/route.ts:29','downloadQueue':'src/app/api/homework-grader/download-and-grade/route.ts:65',
       'pathAllowlist':'src/lib/playwright/download-submissions.ts:87-91; src/lib/file-parsers/index.ts; src/lib/security/path-allowlist.ts',
       'clientBoundaries':'src/components/homework-auto-grader-tab.tsx; src/app/homework-grader/page.tsx',
       'appRouterExports':'src/app/api/homework-grader/export/route.ts:54; src/app/homework-grader/page.tsx:112'},
    'appRouterRuntimeExports':{'exportRoute':['GET'],'homeworkPage':['default']},
    'noSensitiveEnvironmentReferencesOrServerConfigImportsInTwoReviewedClientEntrypoints':True})
for name in ['next','typescript','tsx','sharp','better-sqlite3','playwright']:
    package=ROOT/'node_modules'/name/'package.json'
    value=read(package)
    assert sha(package)==sha(snap/'node_modules'/name/'package.json')
    if name=='next':versions={}
    versions[name]={'version':value['version'],'packageSha256':sha(package)}
write('runtime-versions.json',versions)
subprocess.run(['python',str(OUT/'audit-runner.py'),'preserve'],cwd=ROOT,check=True)
preserve=read(E/'preservation-check.json');assert preserve['allPreserved']
write('evidence-manifest.json',{'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'files':{p.relative_to(OUT).as_posix():{'size':p.stat().st_size,'sha256':sha(p)} for p in sorted(OUT.rglob('*')) if p.is_file() and p.name!='evidence-manifest.json'},
    'note':'Manifest excludes itself; all files and per-attempt command logs retained.'})
print(json.dumps({'total':main['total'],'passed':main['passed'],'failed':main['failed'],'sourceFiles':len(manifest['files']),
    'protectedFiles':preserve['protectedCount'],'allOriginalFilesPreserved':preserve['totalBefore'],'closedSource':12,'verdict':'NO-GO'},ensure_ascii=False))
