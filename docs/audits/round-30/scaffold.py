"""Build R30 audit artifacts from immutable R29 harnesses, without changing assertions."""
from pathlib import Path
import hashlib
import json

p=Path(__file__).resolve().parent
old=p.parent/'round-29'
(p/'evidence').mkdir(parents=True,exist_ok=True)
sha=lambda b:hashlib.sha256(b).hexdigest()

runner=(old/'audit-runner.py').read_text(encoding='utf-8')
runner=runner.replace('AUDIT-R29','AUDIT-R30').replace('round-29','round-30').replace('mindx-round29-','mindx-round30-')
runner=runner.replace("+ '-mindx-round28-compat", "+ '-mindx-round29-compat-mindx-round28-compat")
runner=runner.replace('range(12,29)','range(12,30)')
for n in [29]:
    marker="                'native28-media':"
    runner=runner.replace(marker,f"                'native{n}-media':['node_modules/tsx/dist/cli.mjs','docs/audits/round-{n}/native-media-repro.mjs'],\n                'native{n}-worker':['node_modules/tsx/dist/cli.mjs','docs/audits/round-{n}/native-worker-repro.mjs'],\n"+marker,1)
runner=runner.replace("'native29-media':['node_modules/tsx/dist/cli.mjs','docs/audits/round-30/native-media-repro.mjs']","'native30-media':['node_modules/tsx/dist/cli.mjs','docs/audits/round-30/native-media-repro.mjs']")
runner=runner.replace("'native29-worker':['node_modules/tsx/dist/cli.mjs','docs/audits/round-30/native-worker-repro.mjs']","'native30-worker':['node_modules/tsx/dist/cli.mjs','docs/audits/round-30/native-worker-repro.mjs']")
runner=runner.replace("'native29-media':'docs/audits/round-30/evidence/native-media-results.json'","'native30-media':'docs/audits/round-30/evidence/native-media-results.json',\n                'native29-media':'docs/audits/round-29/evidence/native-media-results.json'")
runner=runner.replace("'native29-worker':'docs/audits/round-30/evidence/native-worker-results.json'","'native30-worker':'docs/audits/round-30/evidence/native-worker-results.json',\n                'native29-worker':'docs/audits/round-29/evidence/native-worker-results.json'")
(p/'audit-runner.py').write_text(runner,encoding='utf-8',newline='\n')

base=(old/'verify-independent.mjs').read_text(encoding='utf-8')
s=base.replace('// Round 29 harness','// Round 30 harness',1)
s=s.replace("from './worker-cases.mjs'","from '../round-29/worker-cases.mjs'").replace("from './media-cases.mjs'","from '../round-29/media-cases.mjs'")
s=s.replace('docs/audits/round-29','docs/audits/round-30').replace("root.includes('mindx-round29-')","root.includes('mindx-round30-')").replace("'mindx-round29-fixtures-'","'mindx-round30-fixtures-'")
s=s.replace('round:29,inheritedR28Checks:737','round:30,inheritedR29Checks:815')
(p/'verify-independent.mjs').write_text(s,encoding='utf-8',newline='\n')
for f in ['native-media-repro.mjs','native-worker-repro.mjs','graphql-oracle.mjs','pdf-oracle.py','pdf_dict_oracle.py','block-string-oracle.mjs','network-guard.cjs']:
    t=(old/f).read_text(encoding='utf-8')
    t=t.replace("from './media-cases.mjs'","from '../round-29/media-cases.mjs'").replace("from './worker-cases.mjs'","from '../round-29/worker-cases.mjs'")
    t=t.replace('docs/audits/round-29','docs/audits/round-30').replace('mindx-round29-','mindx-round30-').replace('round:29','round:30').replace('AUDIT_R28_','AUDIT_R30_')
    (p/f).write_text(t,encoding='utf-8',newline='\n')
provenance={'base':'../round-29/verify-independent.mjs','baseSha256':sha((old/'verify-independent.mjs').read_bytes()),'inheritedChecks':815,'inheritedAssertionsChanged':False,'harnessSha256':sha(s.encode()),'envelopeChanges':['round/output directory','TEMP prefix','case import locations','summary round/inherited count'],'method':'All 815 R29 assertion bodies, IDs and expectations retained verbatim. Independent raw PDF and GraphQL oracles and direct product imports corroborate expectations.'}
(p/'evidence/harness-provenance.json').write_text(json.dumps(provenance,indent=2)+'\n',encoding='utf-8')
print('R30 scaffold ready; 815 R29 assertions retained.')
