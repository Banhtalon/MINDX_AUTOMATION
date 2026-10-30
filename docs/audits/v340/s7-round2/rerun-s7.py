import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
info = json.loads((OUT / 'isolation.json').read_text(encoding='utf8'))
BASE = Path(info['temp'])
name = 'test-streamline-v340-s7'
for suffix in ['.log', '.json']:
    shutil.copy2(OUT / (name + suffix), OUT / (name + '.attempt1' + suffix))
env = os.environ.copy()
env.update(info['environment'])
for key in ['GEMINI_API_KEY', 'LMS_PASSWORD', 'TEACHING_PASSWORD']:
    env.pop(key, None)
env.update(GEMINI_API_KEY='test-s7-dummy-key',
           NODE_OPTIONS='--require=' + str(BASE / 'network-guard.cjs'), NEXT_TELEMETRY_DISABLED='1')
command = ['npx.cmd', 'tsx', 'scripts/test-streamline-v340-s7.ts']
started = time.time()
with (OUT / (name + '.log')).open('w', encoding='utf8') as log:
    result = subprocess.run(command, cwd=BASE, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=600)
record = {'name': name, 'command': ' '.join(command).replace('npx.cmd', 'npx'),
          'exitCode': result.returncode, 'seconds': round(time.time() - started, 2),
          'cwd': str(BASE), 'startedEpoch': started, 'environment': info['environment'],
          'testSetup': 'GEMINI_API_KEY=test-s7-dummy-key supplied before config import; network blocked',
          'applicationAndTestSourcesUnmodified': True}
(OUT / (name + '.json')).write_text(json.dumps(record, indent=2), encoding='utf8')
gates = json.loads((OUT / 'gates.json').read_text(encoding='utf8'))
gates = [record if g['name'] == name else g for g in gates]
(OUT / 'gates.json').write_text(json.dumps(gates, indent=2), encoding='utf8')
before = json.loads((OUT / 'protected-before.json').read_text(encoding='utf8'))
changed = [p for p, h in before.items() if not (ROOT / p).is_file() or
           hashlib.sha256((ROOT / p).read_bytes()).hexdigest().upper() != h]
production = {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest().upper()
              for p in ['data/mindx_bot.db', 'data/running_classes.json']}
(OUT / 'production-after.json').write_text(json.dumps(production, indent=2), encoding='utf8')
preservation = json.loads((OUT / 'preservation.json').read_text(encoding='utf8'))
preservation.update(changed=changed, productionAfter=production,
                    productionMatchesExpected=production == preservation['productionBefore'])
(OUT / 'preservation.json').write_text(json.dumps(preservation, indent=2), encoding='utf8')
print(json.dumps(record), flush=True)
print(json.dumps({'changed': changed, 'productionPreserved': preservation['productionMatchesExpected']}), flush=True)
