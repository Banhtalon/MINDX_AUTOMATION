"""Inherit all 344 R25 assertions unchanged; append independent R26 tests."""
import hashlib
import json
from pathlib import Path
p=Path(__file__).resolve().parent
base=(p.parent/'round-25/verify-independent.mjs').read_text(encoding='utf-8')
fragment=(p/'r26-cases.inc.txt').read_text(encoding='utf-8')
s=base.replace('// Round 25 harness','// Round 26 harness',1)
s=s.replace("import {createMediaCases} from './media-cases.mjs';", "import {createMediaCases} from '../round-25/media-cases.mjs';\nimport {createR26MediaCases} from './media-cases.mjs';\nimport {createR26WorkerCases} from './worker-cases.mjs';",1)
s=s.replace('docs/audits/round-25','docs/audits/round-26').replace("root.includes('mindx-round25-')","root.includes('mindx-round26-')").replace("'mindx-round25-fixtures-'","'mindx-round26-fixtures-'")
marker='} finally {\n  process.chdir(previousCwd);'
assert s.count(marker)==1
s=s.replace(marker,fragment+'\n'+marker)
s=s.replace('round:25,inheritedR24Checks:230','round:26,inheritedR25Checks:344')
(p/'verify-independent.mjs').write_text(s,encoding='utf-8',newline='\n')
sha=lambda b:hashlib.sha256(b).hexdigest()
(p/'evidence/harness-provenance.json').write_text(json.dumps({'base':'../round-25/verify-independent.mjs','baseSha256':sha((p.parent/'round-25/verify-independent.mjs').read_bytes()),'inheritedChecks':344,'inheritedAssertionsChanged':False,'newCaseFragmentSha256':sha(fragment.encode()),'harnessSha256':sha(s.encode()),'envelopeChanges':['round and output directory','TEMP guard and prefix','fixture imports','summary round and inherited count'],'productTransform':'Inherited helper strips imports/exports/types only. Native R26 repro imports actual product modules unchanged.'},indent=2)+'\n',encoding='utf-8')
