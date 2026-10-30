import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent
BASE = Path(tempfile.mkdtemp(prefix='mindx-s7r2-audit-'))
TEMP = Path(os.environ['TEMP'])
EXPECTED = {
    'data/mindx_bot.db': 'A911EB02CD6E2610340604DCF42D53AFB428C50C02727C4CE44F138DEC9C8F16',
    'data/running_classes.json': 'ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2',
}

def save(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding='utf8')

def hashes(paths):
    return {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest().upper()
            for p in paths if p.is_file()}

def protected():
    paths = list((ROOT / 'src').rglob('*')) + list((ROOT / 'scripts').rglob('*'))
    paths += [ROOT / 'next-env.d.ts']
    paths += list((ROOT / 'docs/audits/v340/s7-round1').rglob('*'))
    for number in range(12, 42):
        paths += list((ROOT / f'docs/audits/round-{number}').rglob('*'))
    return hashes(paths)

before = protected()
production_before = hashes([ROOT / p for p in EXPECTED])
save('protected-before.json', before)
save('production-before.json', production_before)
if production_before != EXPECTED:
    raise RuntimeError('Production hashes differ from Owner baseline; no tests started')

for folder in ['src', 'scripts', '.agents']:
    shutil.copytree(ROOT / folder, BASE / folder)
for p in ROOT.iterdir():
    if p.is_file() and p.suffix in ['.json', '.mjs', '.js', '.cjs', '.ts', '.md']:
        shutil.copy2(p, BASE / p.name)
shutil.copytree(ROOT / 'data/config', BASE / 'data/config',
                ignore=shutil.ignore_patterns('teacher_browsed_dirs.json'))
for sub in ['types', 'dev/types']:
    if (ROOT / '.next' / sub).exists():
        shutil.copytree(ROOT / '.next' / sub, BASE / '.next' / sub)
probe = Path('docs/audits/v340/s7-round1/adversarial-probe.cjs')
(BASE / probe).parent.mkdir(parents=True)
shutil.copy2(ROOT / probe, BASE / probe)
subprocess.run(['powershell', '-NoProfile', '-Command',
                f"New-Item -ItemType Junction -Path '{BASE / 'node_modules'}' -Target '{ROOT / 'node_modules'}' | Out-Null"],
               check=True, capture_output=True)
guard = BASE / 'network-guard.cjs'
guard.write_text('''const net=require('node:net');const tls=require('node:tls');
const deny=()=>{throw new Error('AUDIT: live network disabled');};
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...a){let o=a[0];if(Array.isArray(o))o=o[0];if(typeof o==='string'&&(o.includes('pipe')||o.includes('sock')))return connect.apply(this,a);if(o&&typeof o==='object'&&(o.path||['127.0.0.1','localhost','::1'].includes(o.host)))return connect.apply(this,a);throw new Error('AUDIT: socket network disabled');};
tls.connect=deny;globalThis.fetch=deny;
''', encoding='utf8')
env = os.environ.copy()
env.update(ALLOWED_LOCAL_DIRS=str(TEMP),
           MINDX_DB_PATH=str(TEMP / 'mindx_codex_s7r2.db'),
           MINDX_RUNNING_CLASSES_PATH=str(TEMP / 'mindx_codex_s7r2_rc.json'),
           NODE_OPTIONS='--require=' + str(guard), NEXT_TELEMETRY_DISABLED='1',
           AUDIT_RESULT_OUT=str(OUT / 'adversarial-results.json'),
           AUDIT_HTML_OUT=str(OUT / 'rendered-html.json'))
for key in ['GEMINI_API_KEY', 'LMS_PASSWORD', 'TEACHING_PASSWORD']:
    env.pop(key, None)
save('isolation.json', {'root': str(ROOT), 'temp': str(BASE),
     'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
     'environment': {k: env[k] for k in ['ALLOWED_LOCAL_DIRS', 'MINDX_DB_PATH', 'MINDX_RUNNING_CLASSES_PATH']},
     'policy': 'Source-only TEMP mirror; no .env, production DB/cache or login profile; external network blocked',
     'probeSha256': hashlib.sha256((ROOT / probe).read_bytes()).hexdigest(),
     'initialTempDataExists': {k: Path(env[k]).exists() for k in ['MINDX_DB_PATH', 'MINDX_RUNNING_CLASSES_PATH']},
     'sourceMirrorMatches': hashes((ROOT / 'src').rglob('*')) == {
         p.relative_to(BASE).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest().upper()
         for p in (BASE / 'src').rglob('*') if p.is_file()}})
gates = [
    ('tsc', ['npx.cmd', 'tsc', '--noEmit', '--incremental', 'false']),
    ('test-streamline-v340-s7', ['npx.cmd', 'tsx', 'scripts/test-streamline-v340-s7.ts']),
    ('adversarial-probe', ['npx.cmd', 'tsx', str(probe).replace('\\', '/')]),
    ('test-phase4-codex-repros', ['npx.cmd', 'tsx', 'scripts/test-phase4-codex-repros.ts']),
]
results = []
try:
    for name, command in gates:
        started = time.time()
        with (OUT / (name + '.log')).open('w', encoding='utf8') as log:
            result = subprocess.run(command, cwd=BASE, env=env, stdout=log, stderr=subprocess.STDOUT,
                                    timeout=600)
        record = {'name': name, 'command': ' '.join(command).replace('npx.cmd', 'npx'),
                  'exitCode': result.returncode, 'seconds': round(time.time() - started, 2),
                  'cwd': str(BASE), 'startedEpoch': started,
                  'environment': {k: env[k] for k in ['ALLOWED_LOCAL_DIRS', 'MINDX_DB_PATH', 'MINDX_RUNNING_CLASSES_PATH']}}
        results.append(record)
        save(name + '.json', record)
        print(json.dumps(record), flush=True)
finally:
    save('gates.json', results)
    after = protected()
    production_after = hashes([ROOT / p for p in EXPECTED])
    save('production-after.json', production_after)
    save('preservation.json', {
        'protectedCount': len(before), 'afterCount': len(after),
        'changed': [p for p in before if before[p] != after.get(p)],
        'added': sorted(set(after) - set(before)),
        'productionBefore': production_before, 'productionAfter': production_after,
        'productionMatchesExpected': production_after == EXPECTED,
        'sourceMirrorAfterMatches': hashes((ROOT / 'src').rglob('*')) == {
            p.relative_to(BASE).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest().upper()
            for p in (BASE / 'src').rglob('*') if p.is_file()}})
