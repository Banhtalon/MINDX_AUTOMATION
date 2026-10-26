"""Insert the R30 audit and source-only acceptance; preserve every prior plan byte."""
import datetime
import hashlib
import json
from pathlib import Path
import re

p=Path(__file__).resolve().parent
e=p/'evidence'
plan=p.parents[2]/'MINDX_AUTOMATION_PLAN.md'
read=lambda n:json.loads((e/n).read_text(encoding='utf-8'))
sha=lambda b:hashlib.sha256(b).hexdigest()
assert read('issue-status.json')['closedSource']==13 and read('issue-status.json')['verdict']=='NO-GO'
assert read('gate-summary.json')['allInheritedR29RequiredGatesPassed']
assert read('artifact-check.json')['allReceiptHashesVerified']
assert read('preservation-check.json')['allProductAndProtectedFilesPreserved']
current=plan.read_bytes()
before=(e/'plan.before.md').read_bytes() if (e/'plan-update.json').exists() else current
if (e/'plan-update.json').exists():
    assert sha(current)==read('plan-update.json')['afterSha256']
    marker='---\n\n### GIAI ĐOẠN 6:'.encode('utf-8')
    prefix,suffix=before.split(marker,1)
    assert current.startswith(prefix) and current.endswith(marker+suffix)
    own=current[len(prefix):len(current)-len(marker+suffix)]
    assert own.count(b'**AUDIT-R30:**')==1
assert sha(before)==read('before-hashes.json')['MINDX_AUTOMATION_PLAN.md']['sha256']
(e/'plan.before.md').write_bytes(before)
needle='---\n\n### GIAI ĐOẠN 6:'.encode('utf-8')
assert before.count(needle)==1
entry=(p/'plan-entry.vi.txt').read_bytes().rstrip(b'\n')+b'\n\n'
after=before.replace(needle,entry+needle,1)
assert after.replace(entry,b'',1)==before
plan.write_bytes(after)
record={'beforeSha256':sha(before),'afterSha256':sha(after),'onlyInsertion':True,'entryFile':'plan-entry.vi.txt',
    'auditCompleted':True,'sourceAcceptance':False,'liveOperationalAcceptance':False,'verdict':'NO-GO','closedSource':13,
    'existingTaskCheckboxesUnchanged':re.findall(rb'\* \[[ x]\] \*\*TASK-5\.[^\r\n]*',before)==re.findall(rb'\* \[[ x]\] \*\*TASK-5\.[^\r\n]*',after),
    'updatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
(e/'plan-update.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('R30 audit completed; acceptance unchecked because of two new P2 regressions. All prior plan bytes retained.')
