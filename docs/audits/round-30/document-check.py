"""Verify every delivered link, source acceptance record and artifact hash, then seal inventory."""
import datetime
import hashlib
import json
from pathlib import Path
import re

p=Path(__file__).resolve().parent
root=p.parents[2]
e=p/'evidence'
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
read=lambda n:json.loads((e/n).read_text(encoding='utf-8'))
report=(p/'REPORT.vi.md').read_text(encoding='utf-8')
handoff=(p/'FIX_PROMPT.vi.md').read_text(encoding='utf-8')
links=[]
for text in [report,handoff]:
    assert '\ufffd' not in text and '???' not in text
    for target in re.findall(r'\]\(([^)]+)\)',text):
        if target.startswith(('https://','http://','#')):continue
        assert (p/target.split('#')[0]).is_file(),target
        links.append(target)
assert all(t in report for t in ['815/815','817/819','219/221','88/88','737/737','163/163','64/64','13/14','1051/1051','42 lệnh','48 lượt','22/22','NO-GO'])
assert (read('verify-results.json')['passed'],read('verify-results.json')['total'])==(817,819)
assert read('issue-status.json')['closedSource']==13
assert read('new-findings.json')['totalFailingCases']==2
assert read('r29-fix-closure.json')['closed']==8
assert read('preservation-check.json')['allProductAndProtectedFilesPreserved']
assert read('preservation-check.json')['protectedCount']==1051
assert read('preservation-check.json')['protectedMismatches']==[]
before=(e/'plan.before.md').read_bytes()
after=(root/'MINDX_AUTOMATION_PLAN.md').read_bytes()
entry=(p/'plan-entry.vi.txt').read_bytes().rstrip(b'\n')+b'\n\n'
assert after.count(entry)==1 and after.replace(entry,b'',1)==before
assert read('plan-update.json')['existingTaskCheckboxesUnchanged']
assert not read('plan-update.json')['sourceAcceptance'] and not read('plan-update.json')['liveOperationalAcceptance']
assert sha(root/'MINDX_AUTOMATION_PLAN.md')==read('plan-update.json')['afterSha256']
assert '* [ ] **NGHIỆM THU SAU AUDIT-R30 — CẤP MÃ NGUỒN:**'.encode('utf-8') in after
assert sha(root/'next-env.d.ts').upper()=='B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000'
commands=read('commands.json');names={r['name'] for r in commands}
assert len(commands)==48 and len(names)==42 and all(n in report for n in names)
for r in commands:
    assert sha(e/r['log'])==r['logSha256']
    if 'results' in r:assert sha(e/r['results'])==r['resultsSha256']
result={'localLinksChecked':len(links),'missingLinks':[],'reportedCountsMatchResults':True,'planOnlyRecordedInsertion':True,
    'existingTaskCheckboxesUnchanged':True,'nextEnvExpectedHash':True,'utf8DocumentsReadable':True,
    'all42CommandNamesDocumented':True,'all48AttemptReceiptsVerified':True,'auditCompleted':True,
    'sourceAcceptance':False,'liveOperationalAcceptance':False,'verdict':'NO-GO','closedSource':13,
    'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
(e/'document-check.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
manifest={'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'files':{f.relative_to(p).as_posix():{'size':f.stat().st_size,'sha256':sha(f)} for f in sorted(p.rglob('*')) if f.is_file() and f.name!='evidence-manifest.json'},
    'note':'Excludes itself. Original FAIL/BLOCKED and path-related first attempts retained. Workspace changes limited to R30 audit documentation and recorded plan insertion.'}
(e/'evidence-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
assert all(sha(p/f)==v['sha256'] for f,v in manifest['files'].items())
print(json.dumps({**result,'sealedFiles':len(manifest['files'])}))
