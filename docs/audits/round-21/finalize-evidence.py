"""Read-only comparison of original tree; write evidence only below round-21."""
import datetime, hashlib, json, pathlib, subprocess
OUT=pathlib.Path(__file__).resolve().parent
ROOT=OUT.parents[2]
def read(name): return json.loads((OUT/name).read_text(encoding='utf-8'))
def write(name,data): (OUT/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def digest(p): return hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
def inventory(paths):
    return {p.relative_to(ROOT).as_posix():{'sha256':digest(p),'bytes':p.stat().st_size} for p in sorted(set(paths)) if p.is_file()}
state=read('source-state.json');snap=pathlib.Path(state['snapshot'])
before=read('protected-hashes.json')['before'];paths=[ROOT/'next-env.d.ts']
for n in range(12,21): paths.extend((ROOT/f'docs/audits/round-{n}').rglob('*'))
after=inventory(paths)
write('protected-hashes.json',{'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'algorithm':'SHA-256','before':before,'after':after,'beforeCount':len(before),'afterCount':len(after),'unchanged':before==after,'nextEnvExpectedSha256':'B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000'})
paths=[p for p in ROOT.iterdir() if p.is_file() and not p.name.startswith('.env')]
for name in ['src','scripts','data/config']: paths.extend((ROOT/name).rglob('*'))
source_after=inventory(paths)
changed=[name for name in set(source_after)|set(state['files']) if source_after.get(name)!=state['files'].get(name)]
snapshot_changes=[name for name,info in state['files'].items() if not (snap/name).exists() or digest(snap/name)!=info['sha256']]
write('preservation-check.json',{'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'originalSourceUnchanged':not changed,'originalSourceChangedFiles':changed,'sourceBefore':state['files'],'sourceAfter':source_after,'protectedUnchanged':before==after,'protectedCount':len(before),'snapshotChangedFiles':snapshot_changes,'originalPlanUnchanged':digest(ROOT/'MINDX_AUTOMATION_PLAN.md')==state['files']['MINDX_AUTOMATION_PLAN.md']['sha256'],'originalNextEnvSha256':digest(ROOT/'next-env.d.ts'),'snapshotNextEnvSha256':digest(snap/'next-env.d.ts')})
status=subprocess.run(['git','status','--short','--untracked-files=all'],cwd=ROOT,capture_output=True,check=True).stdout
(OUT/'git-status.after.txt').write_bytes(status)
commands=read('commands.json')
# Initial startup-only attempts never executed tests; any copied historical JSON is not fresh evidence.
for r in commands:
    if r['log'].endswith('.log') and '.attempt-' not in r['log']:
        r.pop('results',None);r['classification']='HARNESS_STARTUP_ERROR';r['note']='NODE_OPTIONS Windows path quoting failed before test code; logs retained. No test results attributable to this attempt.'
    elif r.get('results') and 'attempt-' not in r['results']:
        # Old runner used a canonical result path. Pin valid final outputs to attempt-specific names.
        valid_latest=max((x for x in commands if x['name']==r['name']),key=lambda x:x['startedAt']) is r
        if valid_latest:
            target=r['log'].replace('.log','-results.json')
            (OUT/target).write_bytes((OUT/r['results']).read_bytes());r['results']=target
        else:
            r.pop('results',None);r['note']='Earlier suite run superseded after correcting the audit bulk-request adapter; retained log only.'
write('commands.json',commands)
latest={r['name']:r for r in commands if r.get('classification')!='HARNESS_STARTUP_ERROR'}
gates=[]
for name in ['round20','round21','round12','round13','round16','round17','phase4','phase5','typecheck','build']:
    r=latest[name];g={'name':name,'exitCode':r['exitCode'],'pass':r['exitCode']==0,'log':r['log']}
    if r.get('results'):
        d=read(r['results']);g.update({'total':d.get('total',d.get('passed',0)+d.get('failed',0)),'passed':d['passed'],'failed':d['failed'],'results':r['results']})
    gates.append(g)
closed={'02','03','07','08','10','11','12','14'}
descriptions={
 '01':('P2','Media chỉ xác nhận cấu trúc nông; 5 ảnh không giải mã được và PDF giả vẫn PARSED.'),
 '04':('P2','Nhánh parsedContent được truyền sẵn bỏ qua kiểm tra lại bytes trên đĩa; route hiện tại không truyền nhánh này.'),
 '05':('P1','UI không gửi barem đang chọn khi duyệt; điểm của barem khác vẫn được APPROVED.'),
 '06':('P1','fileHash là tùy chọn ở duyệt đơn; duyệt hàng loạt không đối chiếu phiên bản đã xem.'),
 '09':('P1','GraphQL comment/selected query/mutation attachment vẫn xác nhận lưu điểm.'),
 '13':('P1','Hai lưu nháp đều thành công nhưng đến máy chủ ngược thứ tự; duyệt hàng loạt ký bản cũ.')}
r21=read('independent-results.json');r20=read('round20-results.json')
issues=[]
for n in range(1,15):
    key=f'{n:02}';new=[r for r in r21['results'] if r['id'].startswith('R21-'+key+'-')]
    old=[r for r in r20['results'] if r['id'].startswith(('R19-'+key+'-','R20-'+key+'-'))]
    severity,reason=descriptions.get(key,(None,'Đạt các tái hiện R20 và các kiểm tra R21 trong phạm vi mã nguồn/dữ liệu giả.'))
    issues.append({'id':'R19-'+key,'status':'CLOSED_SOURCE' if key in closed else 'PARTIALLY_FIXED','remainingSeverity':severity,'reason':reason,'r21Cases':[r['id'] for r in new],'r21Failed':[r['id'] for r in new if not r['pass']],'r20Cases':[r['id'] for r in old]})
write('issue-status.json',{'closedSource':8,'partiallyFixed':6,'issues':issues,'extraGateCompatibilityFailure':{'case':'R21-09-phase4-host-token','severity':'P2','note':'R12 requires substring token lms-api; current Phase 4 caller uses a RegExp. Gate FAIL is confirmed; an actual Phase 4 production-flow failure is not established.'}})
source_hashes_match=all(state['files'][name]['sha256']==value for name,value in r21['sourceHashes'].items())
verdict='GO' if all(g['pass'] for g in gates) and len(closed)==14 and not changed and before==after else 'NO-GO'
write('audit-summary.json',{'verdict':verdict,'sourceHead':state['head'],'sourceManifestHash':state['manifestHash'],'snapshot':str(snap),'gates':gates,'passedGates':sum(g['pass'] for g in gates),'totalGates':len(gates),'regressions':{'total':186,'passed':sum(latest_n['passed'] for latest_n in gates if latest_n['name'] in ['round12','round13','round16','round17'])},'closedSource':8,'partiallyFixed':6,'originalSourceUnchanged':not changed,'protectedUnchanged':before==after,'r21SourceHashesMatchSnapshotBaseline':source_hashes_match})
write('isolation.json',{'snapshot':str(snap),'pathCompatibilitySuffix':'mindx-round20-compat keeps the original R20 path guard unchanged within TEMP/mindx-round21-<timestamp>/snapshot','noCredentialsCopied':True,'noLiveDatabaseCopied':True,'noBrowserProfileCopied':True,'nodeModules':'Physical copy, not a junction or symlink; no package install/update','processEnvironment':'Minimal Windows runtime allowlist, npm offline, telemetry disabled; no service credential variables','networkGuard':'--require docs/audits/round-19/network-guard.cjs from snapshot; Node socket guard, not an OS firewall','noRealBrowserLaunchedByAudit':True,'limitations':'VM DOM/API/Gemini doubles and real in-memory SQLite; no LMS/Gemini calls or real account acceptance. R21 malformed-image controls use installed sharp.'})
quality={'uniqueR21CaseIds':len(set(r['id'] for r in r21['results']))==r21['total'],'r21CountConsistent':r21['passed']+r21['failed']==r21['total']==len(r21['results']),'canonicalResultsMatchLastAttempt':digest(OUT/'independent-results.json')==digest(OUT/latest['round21']['results']),'allLogHashesMatch':all(digest(OUT/r['log'])==r['logSha256'] for r in commands),'r21ScriptMatchesExecutedSnapshot':digest(OUT/'verify-independent.mjs')==digest(snap/'docs/audits/round-21/verify-independent.mjs'),'originalProtectedFilesUnchanged':before==after,'originalSourceFilesUnchanged':not changed,'resultSourceHashesMatchBaseline':source_hashes_match,'mandatoryArtifactsPresent':all((OUT/f).is_file() for f in ['REPORT.vi.md','verify-independent.mjs','independent-results.json','protected-hashes.json'])}
if latest['round21'].get('scriptSha256'): quality['r21ScriptMatchesReceipt']=digest(OUT/'verify-independent.mjs')==latest['round21']['scriptSha256']
write('artifact-check.json',quality)
assert not changed and before==after and source_hashes_match
print(json.dumps({'verdict':verdict,'protectedFiles':len(before),'sourceFiles':len(source_after),'closed':8,'partial':6,'passedGates':sum(g['pass'] for g in gates),'gates':len(gates),'snapshotChangedFiles':snapshot_changes}))
