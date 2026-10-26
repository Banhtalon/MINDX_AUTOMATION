"""Audit-package checks only. No product execution."""
import datetime
import hashlib
import json
from pathlib import Path
import re
out=Path(__file__).resolve().parent
e=out/'evidence'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
read=lambda n:json.loads((e/n).read_text(encoding='utf-8'))
required=['REPORT.vi.md','FIX_PROMPT.vi.md','REGRESSION_MATRIX.md','audit-runner.py','verify-independent.mjs',
    'native-media-repro.mjs','native-worker-repro.mjs','pdf-name-repro.mjs','graphql_worker_oracle.py','pdf_dict_oracle.py']
assert all((out/f).is_file() and (out/f).stat().st_size>0 for f in required)
broken=[];links=0
for name in ['REPORT.vi.md','FIX_PROMPT.vi.md','REGRESSION_MATRIX.md']:
    text=(out/name).read_text(encoding='utf-8')
    assert '\ufffd' not in text and not re.search(r'[àáảãạăâêôơưđ][?][a-z]',text,re.I)
    for target in re.findall(r'\[[^\]]+\]\(([^)]+)\)',text):
        if '://' in target or target.startswith('#'):continue
        links+=1
        p=(out/target.split('#')[0]).resolve()
        if not p.is_file():broken.append({'file':name,'link':target})
assert not broken,broken
g=read('gate-summary.json');issues=read('issue-status.json');pres=read('preservation-check.json')
assert (g['distinctGates'],g['attempts'],g['pass'],g['historicalFail'],g['historicalBlocked'])==(48,71,41,5,2)
assert issues['verdict']=='GO' and issues['closedSource']==14 and all(x['status']=='CLOSED_SOURCE' and x['failed']==0 for x in issues['issues'])
assert pres['allPreserved'] and pres['planUnchanged'] and pres['protectedCount']==1210 and not pres['protectedMismatches']
assert pres['nextEnvSha256'].upper()=='B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000'
assert read('inherited-cases-check.json')['sameOrderedIdsCriteriaAndPassResults']
for name in ['verify-results.json','native-media-results.json','native-worker-results.json','pdf-name-results.json','pdf-name-oracle-results.json','pdf-dict-oracle-results.json','graphql-worker-oracle-results.json','graphql-oracle-results.json','pdf-boundary-results.json']:
    d=read(name);assert d['failed']==0 and d['passed']==d['total'],name
report=(out/'REPORT.vi.md').read_text(encoding='utf-8')
assert 'GO cấp mã nguồn' in report and '14/14' in report and 'chưa phải nghiệm thu vận hành' in report
check={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'requiredFiles':required,'allPresent':True,
    'localMarkdownLinksChecked':links,'brokenLinks':broken,'verdictAndCountsReconciled':True,'workspacePreserved':True,
    'scope':'Document/evidence integrity checks only; no new product test or execution.'}
(e/'artifact-check.json').write_text(json.dumps(check,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
files={p.relative_to(out).as_posix():{'sha256':sha(p),'size':p.stat().st_size} for p in sorted(out.rglob('*')) if p.is_file() and p.name!='evidence-manifest.json' and '__pycache__' not in p.parts}
manifest={'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'Every R31 artifact except this self-referential manifest and Python caches.',
    'fileCount':len(files),'files':files,'aggregateSha256':hashlib.sha256(json.dumps(files,sort_keys=True).encode()).hexdigest()}
(e/'evidence-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'artifactFiles':len(files),'linksChecked':links,'verdict':'GO_SOURCE_ONLY','protectedFiles':1210,'allPreserved':True}))
