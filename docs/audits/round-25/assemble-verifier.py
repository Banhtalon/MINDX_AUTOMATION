"""Reuse all 230 R24 assertions, changing audit envelope only; append R25 cases."""
import hashlib
import json
from pathlib import Path
out=Path(__file__).resolve().parent
base=(out.parent/'round-24/verify-independent.mjs').read_text(encoding='utf-8')
fragment=(out/'r25-cases.inc.txt').read_text(encoding='utf-8')
source=base.replace('// Round 24 harness','// Round 25 harness',1)
source=source.replace("import sharp from 'sharp';", "import sharp from 'sharp';\nimport {createMediaCases} from './media-cases.mjs';",1)
source=source.replace("docs/audits/round-24", "docs/audits/round-25").replace("root.includes('mindx-round24-')", "root.includes('mindx-round25-')").replace("'mindx-r24-fixtures-'", "'mindx-round25-fixtures-'")
assert source.count('} finally {\n  process.chdir(previousCwd);')==1
source=source.replace('} finally {\n  process.chdir(previousCwd);',fragment+'\n} finally {\n  process.chdir(previousCwd);')
source=source.replace('round:24,inheritedR23Checks:116','round:25,inheritedR24Checks:230')
source=source.replace("path.join(out,'independent-results.json')", "path.join(out,'verify-results.json')")
(out/'verify-independent.mjs').write_text(source,encoding='utf-8',newline='\n')
sha=lambda b:hashlib.sha256(b).hexdigest()
(out/'harness-provenance.json').write_text(json.dumps({'base':'../round-24/verify-independent.mjs','baseSha256':sha((out.parent/'round-24/verify-independent.mjs').read_bytes()),'inheritedChecks':230,'inheritedAssertionsChanged':False,'newCaseFragmentSha256':sha(fragment.encode()),'harnessSha256':sha(source.encode()),'envelopeChanges':['round/output directory','TEMP assertion and fixture prefix','media fixture import','summary metadata and output name'],'productTransform':'Same R24 helper removes imports/exports/types only, no function body edits; native media is also tested by direct product import.'},indent=2)+'\n',encoding='utf-8')
