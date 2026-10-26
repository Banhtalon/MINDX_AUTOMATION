"""Insert only the R29 audit entry; retain every other original byte."""
import datetime
import hashlib
import json
from pathlib import Path
import re
p=Path(__file__).resolve().parent
e=p/'evidence'
plan=p.parents[2]/'MINDX_AUTOMATION_PLAN.md'
before=plan.read_bytes()
assert b'**AUDIT-R29:**' not in before
sha=lambda b:hashlib.sha256(b).hexdigest()
assert sha(before)==json.loads((e/'before-hashes.json').read_text(encoding='utf-8'))['MINDX_AUTOMATION_PLAN.md']['sha256']
(e/'plan.before.md').write_bytes(before)
needle='---\n\n### GIAI ĐOẠN 6:'.encode('utf-8')
assert before.count(needle)==1
entry=(p/'plan-entry.vi.txt').read_bytes().rstrip(b'\n')+b'\n\n'
after=before.replace(needle,entry+needle,1)
assert after.replace(entry,b'',1)==before
plan.write_bytes(after)
(e/'plan-update.json').write_text(json.dumps({'beforeSha256':sha(before),'afterSha256':sha(after),'onlyInsertion':True,
    'entryFile':'plan-entry.vi.txt','auditCompleted':True,'sourceAcceptance':False,'verdict':'NO-GO','closedSource':13,
    'existingTaskCheckboxesUnchanged':re.findall(rb'\* \[[ x]\] \*\*TASK-5\.[^\r\n]*',before)==re.findall(rb'\* \[[ x]\] \*\*TASK-5\.[^\r\n]*',after),
    'updatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Only R29 documentation inserted; acceptance remains unchecked.')
