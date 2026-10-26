"""Inherit all 737 R28 assertions without changing their bodies or expectations."""
from pathlib import Path
import hashlib
import json
p=Path(__file__).resolve().parent
old=p.parent/'round-28'
base=(old/'verify-independent.mjs').read_text(encoding='utf-8')
s=base.replace('// Round 28 harness','// Round 29 harness',1)
s=s.replace("from './worker-cases.mjs'","from '../round-28/worker-cases.mjs'").replace("from './media-cases.mjs'","from '../round-28/media-cases.mjs'")
s=s.replace('const root =',"import {createR29WorkerCases} from './worker-cases.mjs';\nimport {createR29MediaCases} from './media-cases.mjs';\n\nconst root =",1)
s=s.replace('docs/audits/round-28','docs/audits/round-29').replace("root.includes('mindx-round28-')","root.includes('mindx-round29-')").replace("'mindx-round28-fixtures-'","'mindx-round29-fixtures-'")
fragment=(p/'r29-cases.inc.txt').read_text(encoding='utf-8')
marker='} finally {\n  process.chdir(previousCwd);'
assert s.count(marker)==1
s=s.replace(marker,fragment+'\n'+marker).replace('round:28,inheritedR27Checks:662','round:29,inheritedR28Checks:737')
(p/'verify-independent.mjs').write_text(s,encoding='utf-8',newline='\n')
sha=lambda b:hashlib.sha256(b).hexdigest()
(p/'evidence/harness-provenance.json').write_text(json.dumps({'base':'../round-28/verify-independent.mjs','baseSha256':sha((old/'verify-independent.mjs').read_bytes()),'inheritedChecks':737,'inheritedAssertionsChanged':False,'newFragmentSha256':sha(fragment.encode()),'harnessSha256':sha(s.encode()),'envelopeChanges':['round/output directory','TEMP prefix','case import locations','summary round/inherited count','new case imports'],'method':'All R28 assertion bodies and expectations inherited verbatim; append R29 checks and corroborate through direct product imports.'},indent=2)+'\n',encoding='utf-8')
print('737 original assertions retained; R29 assertions appended.')
