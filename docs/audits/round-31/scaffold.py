"""Build audit-only derivatives. Never change historical harnesses or product files."""
from pathlib import Path
import hashlib
import json

out=Path(__file__).resolve().parent
old=out.parent/'round-30'
(out/'evidence').mkdir(exist_ok=True)
assert not (out/'evidence/snapshot.json').exists(), 'Scaffold is one-time setup; do not overwrite finalized audit files.'
files=['verify-independent.mjs','native-media-repro.mjs','native-worker-repro.mjs',
       'media-cases.mjs','network-guard.cjs','graphql-oracle.mjs','block-string-oracle.mjs',
       'pdf-oracle.py','pdf-name-oracle.py','pdf_dict_oracle.py','capture-static.py']
records=[]
for name in files:
    original=(old/name).read_text(encoding='utf-8')
    content=original.replace('docs/audits/round-30','docs/audits/round-31').replace('mindx-round30-','mindx-round31-')
    if name=='verify-independent.mjs':
        content=content.replace('// Round 30 harness','// Round 31 harness',1).replace('round:30,inheritedR29Checks:815','round:31,inheritedR30Checks:819')
    elif name.startswith('native-'):
        content=content.replace('round:30','round:31')
    (out/name).write_text(content,encoding='utf-8')
    records.append({'file':name,'derivedFrom':'docs/audits/round-30/'+name,
        'originalSha256':hashlib.sha256((old/name).read_bytes()).hexdigest(),
        'sha256':hashlib.sha256((out/name).read_bytes()).hexdigest(),
        'changes':'Audit output/TEMP prefix/round metadata only; all case IDs and expectations preserved.'})
(out/'evidence/harness-provenance.json').write_text(json.dumps(records,indent=2)+'\n',encoding='utf-8')
print('R31 harness scaffold created; 819 inherited checks unchanged.')
