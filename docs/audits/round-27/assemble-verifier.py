"""Inherit all R26 assertions unchanged; only change envelope/import locations and append R27."""
import hashlib
import json
from pathlib import Path
p=Path(__file__).resolve().parent
base=(p.parent/'round-26/verify-independent.mjs').read_text(encoding='utf-8')
s=base.replace('// Round 26 harness','// Round 27 harness',1)
s=s.replace("from './media-cases.mjs'","from '../round-26/media-cases.mjs'").replace("from './worker-cases.mjs'","from '../round-26/worker-cases.mjs'")
s=s.replace("import {createR26WorkerCases} from '../round-26/worker-cases.mjs';", "import {createR26WorkerCases} from '../round-26/worker-cases.mjs';\nimport {createR27WorkerCases} from './worker-cases.mjs';\nimport {createR27MediaCases} from './media-cases.mjs';")
s=s.replace('docs/audits/round-26','docs/audits/round-27').replace("root.includes('mindx-round26-')","root.includes('mindx-round27-')").replace("'mindx-round26-fixtures-'","'mindx-round27-fixtures-'")
fragment=(p/'r27-cases.inc.txt').read_text(encoding='utf-8')
marker='} finally {\n  process.chdir(previousCwd);'
assert s.count(marker)==1
s=s.replace(marker,fragment+'\n'+marker).replace('round:26,inheritedR25Checks:344','round:27,inheritedR26Checks:510')
(p/'verify-independent.mjs').write_text(s,encoding='utf-8',newline='\n')
sha=lambda b:hashlib.sha256(b).hexdigest()
(p/'evidence/harness-provenance.json').write_text(json.dumps({'base':'../round-26/verify-independent.mjs','baseSha256':sha((p.parent/'round-26/verify-independent.mjs').read_bytes()),'inheritedChecks':510,'inheritedAssertionsChanged':False,'newFragmentSha256':sha(fragment.encode()),'harnessSha256':sha(s.encode()),'envelopeChanges':['round/output directory','TEMP prefix','case import locations','summary round/inherited count'],'method':'Inherited VM bodies; independent corroboration imports actual product modules through tsx.'},indent=2)+'\n',encoding='utf-8')
for name in ['native-media-repro.mjs','native-worker-repro.mjs']:
    s=(p.parent/'round-26'/name).read_text(encoding='utf-8')
    s=s.replace('R26','R27').replace('round26','round27').replace('round-26','round-27').replace('round:26','round:27')
    (p/name).write_text(s,encoding='utf-8',newline='\n')
