"""Inherit all 662 R27 assertions without altering bodies or expectations."""
import hashlib
import json
from pathlib import Path
p=Path(__file__).resolve().parent
old=p.parent/'round-27'
base=(old/'verify-independent.mjs').read_text(encoding='utf-8')
s=base.replace('// Round 27 harness','// Round 28 harness',1)
s=s.replace("from './worker-cases.mjs'","from '../round-27/worker-cases.mjs'").replace("from './media-cases.mjs'","from '../round-27/media-cases.mjs'")
s=s.replace('const root =',"import {createR28WorkerCases} from './worker-cases.mjs';\nimport {createR28MediaCases} from './media-cases.mjs';\n\nconst root =",1)
s=s.replace('docs/audits/round-27','docs/audits/round-28').replace("root.includes('mindx-round27-')","root.includes('mindx-round28-')").replace("'mindx-round27-fixtures-'","'mindx-round28-fixtures-'")
fragment=(p/'r28-cases.inc.txt').read_text(encoding='utf-8')
marker='} finally {\n  process.chdir(previousCwd);'
assert s.count(marker)==1
s=s.replace(marker,fragment+'\n'+marker).replace('round:27,inheritedR26Checks:510','round:28,inheritedR27Checks:662')
(p/'verify-independent.mjs').write_text(s,encoding='utf-8',newline='\n')
sha=lambda b:hashlib.sha256(b).hexdigest()
(p/'evidence/harness-provenance.json').write_text(json.dumps({'base':'../round-27/verify-independent.mjs','baseSha256':sha((old/'verify-independent.mjs').read_bytes()),'inheritedChecks':662,'inheritedAssertionsChanged':False,'newFragmentSha256':sha(fragment.encode()),'harnessSha256':sha(s.encode()),'envelopeChanges':['round/output directory','TEMP prefix','case import locations','summary round/inherited count','new case imports'],'method':'Entire R27 assertion bodies inherited verbatim, new R28 checks appended; native imports corroborate.'},indent=2)+'\n',encoding='utf-8')
