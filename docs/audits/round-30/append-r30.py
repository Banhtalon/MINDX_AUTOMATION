"""Append four independent R30 controls; retain all original 815 R29 assertions."""
from pathlib import Path
import hashlib
import json
p=Path(__file__).resolve().parent
base=(p.parent/'round-29/verify-independent.mjs').read_text(encoding='utf-8')
s=base.replace('// Round 29 harness','// Round 30 harness',1)
s=s.replace("from './worker-cases.mjs'","from '../round-29/worker-cases.mjs'").replace("from './media-cases.mjs'","from '../round-29/media-cases.mjs'")
s=s.replace('docs/audits/round-29','docs/audits/round-30').replace("root.includes('mindx-round29-')","root.includes('mindx-round30-')").replace("'mindx-round29-fixtures-'","'mindx-round30-fixtures-'")
s=s.replace('round:29,inheritedR28Checks:737','round:30,inheritedR29Checks:815')
s=s.replace('const root =',"import {createR30MediaCases} from './media-cases.mjs';\n\nconst root =",1)
fragment='''  for(const c of createR30MediaCases())await check(c.id,'R30 legal empty Name values remain valid inside a dictionary or array; nonempty controls stay accepted',async()=>{
    const parsed=parse(c.buf,c.id+'.pdf'),o={expected:c.expected,parseStatus:parsed.parseStatus,inlineParts:parsed.inlineDataParts.length,fixtureBase64:c.buf.toString('base64')};
    expect(parsed.parseStatus===c.expected&&parsed.inlineDataParts.length===1,o,'Legal PDF Name was rejected');
    assert.equal(parsed.inlineDataParts[0].inlineData.data,c.buf.toString('base64'));return o;
  });
'''
(p/'r30-cases.inc.txt').write_text(fragment,encoding='utf-8',newline='\n')
marker='} finally {\n  process.chdir(previousCwd);'
assert s.count(marker)==1
s=s.replace(marker,fragment+'\n'+marker)
(p/'verify-independent.mjs').write_text(s,encoding='utf-8',newline='\n')
native=(p/'native-media-repro.mjs').read_text(encoding='utf-8')
if 'createR30MediaCases' not in native:
    native=native.replace('const root=',"import {createR30MediaCases} from './media-cases.mjs';\nconst root=",1)
    native=native.replace('...createR29MediaCases()]','...createR29MediaCases(),...createR30MediaCases()]')
    (p/'native-media-repro.mjs').write_text(native,encoding='utf-8',newline='\n')
sha=lambda b:hashlib.sha256(b).hexdigest()
record={'base':'../round-29/verify-independent.mjs','baseSha256':sha((p.parent/'round-29/verify-independent.mjs').read_bytes()),
    'inheritedChecks':815,'inheritedAssertionsChanged':False,'r30NewChecks':4,'newFragmentSha256':sha(fragment.encode()),
    'harnessSha256':sha(s.encode()),'method':'Original 815 R29 assertions retained verbatim; append four PDF empty-Name checks, corroborated by native import, pypdf and hash-verified R29 baseline.'}
(p/'evidence/harness-provenance.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
print('Inherited 815 unchanged; appended four R30 checks.')
