"""Check report numbers, local links, inherited harness and exact plan insertion."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
p=Path(__file__).resolve().parent
root=p.parents[2]
e=p/'evidence'
sha=lambda b:hashlib.sha256(b).hexdigest()
read=lambda n:json.loads((e/n).read_text(encoding='utf-8'))
report=(p/'REPORT.vi.md').read_text(encoding='utf-8')
prompt=(p/'FIX_PROMPT.vi.md').read_text(encoding='utf-8')
links=[];missing=[]
for text in [report,prompt]:
    for target in re.findall(r'\]\(([^)]+)\)',text):
        if target.startswith(('https://','http://','#')):continue
        links.append(target)
        if not (p/target.split('#')[0]).is_file():missing.append(target)
assert not missing,missing
assert all(s in report for s in ['807/815','209/217','88/88','737/737','163/163','64/64','13/14','905/905','NO-GO'])
assert all(s in prompt for s in ['815/815','217/217','88/88','P2'])
assert (read('verify-results.json')['passed'],read('verify-results.json')['total'])==(807,815)
assert read('issue-status.json')['closedSource']==13
assert read('r28-fix-closure.json')['closed']==9
before=(e/'plan.before.md').read_bytes();after=(root/'MINDX_AUTOMATION_PLAN.md').read_bytes()
entry=(p/'plan-entry.vi.txt').read_bytes().rstrip(b'\n')+b'\n\n'
assert after.count(entry)==1 and after.replace(entry,b'',1)==before
assert read('plan-update.json')['existingTaskCheckboxesUnchanged']
assert sha(after)==read('plan-update.json')['afterSha256']
assert sha((root/'next-env.d.ts').read_bytes()).upper()=='B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000'
assert '* [ ] **NGHIỆM THU SAU AUDIT-R29:**'.encode('utf-8') in after
assert '\ufffd' not in report+prompt and '???' not in report+prompt
harness_hash=sha((p/'verify-independent.mjs').read_bytes())
subprocess.run(['python',str(p/'assemble-verifier.py')],cwd=root,check=True)
assert sha((p/'verify-independent.mjs').read_bytes())==harness_hash
commands=read('commands.json');names={r['name'] for r in commands}
assert len(names)==37 and len(commands)==52
assert read('preservation-check.json')['allProductAndProtectedFilesPreserved']
data={'localLinksChecked':len(links),'missingLinks':missing,'reportedCountsMatchResults':True,
    'planOnlyRecordedInsertion':True,'existingTaskCheckboxesUnchanged':True,'nextEnvExpectedHash':True,
    'utf8DocumentsReadable':True,'harnessReassemblyByteIdentical':True,'all37CommandNamesDocumented':all(n in report for n in names),
    'auditCompleted':True,'sourceAcceptance':False,'verdict':'NO-GO','closedSource':13}
assert data['all37CommandNamesDocumented']
(e/'document-check.json').write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
print(json.dumps(data))
