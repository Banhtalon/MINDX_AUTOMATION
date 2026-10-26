"""Check report links, numeric claims and byte-exact scope of the plan insertion."""
import hashlib
import json
from pathlib import Path
import re
p=Path(__file__).resolve().parent
root=p.parents[2]
e=p/'evidence'
report=(p/'REPORT.vi.md').read_text(encoding='utf-8')
prompt=(p/'FIX_PROMPT.vi.md').read_text(encoding='utf-8')
missing=[];links=[]
for text in [report,prompt]:
    for target in re.findall(r'\]\(([^)]+)\)',text):
        if target.startswith(('https://','http://','#')):continue
        links.append(target)
        if not (p/target.split('#')[0]).is_file():missing.append(target)
assert not missing,missing
assert all(s in report for s in ['728/737','157/163','61/64','662/662','120/120','32/32','12/14','772/772','NO-GO'])
assert all(s in prompt for s in ['737/737','163/163','64/64','P2'])
read=lambda n:json.loads((e/n).read_text(encoding='utf-8'))
assert (read('verify-results.json')['passed'],read('verify-results.json')['total'])==(728,737)
before=(e/'plan.before.md').read_bytes();after=(root/'MINDX_AUTOMATION_PLAN.md').read_bytes()
entry=(p/'plan-entry.vi.txt').read_bytes().rstrip(b'\n')+b'\n\n'
assert after.count(entry)==1 and after.replace(entry,b'',1)==before
assert read('plan-update.json')['existingTaskCheckboxesUnchanged']
assert hashlib.sha256(after).hexdigest()==read('plan-update.json')['afterSha256']
assert hashlib.sha256((root/'next-env.d.ts').read_bytes()).hexdigest().upper()=='B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000'
assert '\ufffd' not in report+prompt and '???' not in report+prompt
data={'localLinksChecked':len(links),'missingLinks':missing,'reportedCountsMatchResults':True,'planOnlyRecordedInsertion':True,'existingTaskCheckboxesUnchanged':True,'nextEnvExpectedHash':True,'utf8DocumentsReadable':True,'sourceAcceptance':False,'verdict':'NO-GO'}
(e/'document-check.json').write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
print(json.dumps(data))
