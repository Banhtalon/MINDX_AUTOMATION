"""AUDIT-R36: immutable-source snapshot and verbatim gate capture. No real services."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'docs/audits/round-36/evidence'
TEMP = Path(os.environ['TEMP']).resolve()
SNAP = TEMP / 'mindx-round31-r36-check'
TOP = ['package.json', 'tsconfig.json', 'next.config.ts', 'next-env.d.ts']
DIRS = ['src', 'scripts', 'docs', 'data/config']

def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest().upper()

def protected():
    paths = [ROOT / p for p in TOP + ['AGENTS.md', 'GEMINI.md']]
    for name in ['src', 'scripts', 'data/config']:
        paths.extend(p for p in (ROOT / name).rglob('*') if p.is_file())
    for n in range(12, 36):
        paths.extend(p for p in (ROOT / f'docs/audits/round-{n}').rglob('*') if p.is_file())
    return {p.relative_to(ROOT).as_posix(): sha(p) for p in sorted(set(paths))}

def save(name, data):
    (OUT / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    if SNAP.exists():
        raise RuntimeError('Snapshot already exists; refusing to overwrite it')
    before = protected()
    save('integrity-before.json', before)
    (OUT / 'plan-before.bin').write_bytes((ROOT / 'MINDX_AUTOMATION_PLAN.md').read_bytes())
    status = subprocess.check_output(['git', 'status', '--porcelain=v1', '-uall'], cwd=ROOT)
    (OUT / 'git-status-before.txt').write_bytes(status)
    prior_temp = {p.name for p in TEMP.glob('mindx-round31-*')}
    SNAP.mkdir()
    def ignore(directory, names):
        return [n for n in names if n.startswith('.env') or n == 'playwright-auth' or (n.startswith('mindx') and '.db' in n)]
    for f in TOP:
        shutil.copy2(ROOT / f, SNAP / f)
    for d in DIRS:
        shutil.copytree(ROOT / d, SNAP / d, ignore=ignore)
    junction = SNAP / 'node_modules'
    result = subprocess.run(['cmd', '/c', 'mklink', '/J', str(junction), str(ROOT / 'node_modules')], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    esbuild = TEMP / 'mindx-esbuild.exe'
    existed = esbuild.exists()
    if not existed:
        shutil.copy2(ROOT / 'node_modules/@esbuild/win32-x64/esbuild.exe', esbuild)
    copies = {p: sha(SNAP / p) for p in before if (SNAP / p).is_file()}
    assert all(copies[p] == before[p] for p in copies)
    excluded = [p.relative_to(SNAP).as_posix() for p in SNAP.rglob('.env*') if 'node_modules' not in p.parts]
    assert not excluded and not (SNAP / 'playwright-auth').exists()
    save('snapshot.json', {'root': str(SNAP), 'createdAt': datetime.now(timezone.utc).isoformat(), 'head': subprocess.check_output(['git','rev-parse','HEAD'], cwd=ROOT, text=True).strip(), 'copiedMatchingFiles': len(copies), 'copiedHashes': copies, 'excludedEnvFilesFound': excluded, 'esbuildPreexisting': existed, 'esbuildSha256': sha(esbuild), 'priorTemp': sorted(prior_temp)})
    env = os.environ.copy()
    for key in list(env):
        if any(x in key.upper() for x in ['PASSWORD', 'API_KEY', 'TOKEN', 'SECRET']) or key in ['NODE_OPTIONS', 'ALLOWED_LOCAL_DIRS']:
            env.pop(key, None)
    env['ESBUILD_BINARY_PATH'] = str(esbuild)
    guard = str(SNAP / 'docs/audits/round-31/network-guard.cjs').replace('\\', '/')
    env['NODE_OPTIONS'] = '--require="' + guard + '"'
    commands = [
        ('01-independent', ['node','docs/audits/round-31/verify-independent.mjs']),
        ('02-requested-media', ['node','docs/audits/round-22/native-media-repro.mjs']),
        ('03-requested-worker', ['node','docs/audits/round-24/native-worker-repro.mjs']),
        ('04-requested-name', ['node','docs/audits/round-25/pdf-name-repro.mjs']),
        ('05-requested-boundary', ['node','docs/audits/round-26/pdf-boundary-repro.mjs']),
        ('06-phase5', ['node','node_modules/tsx/dist/cli.mjs','scripts/test-phase5.ts']),
        ('07-typescript', ['node','node_modules/typescript/bin/tsc','--noEmit','--incremental','false']),
        ('08-core', ['node','node_modules/tsx/dist/cli.mjs','docs/audits/round-35/core-repro.mjs']),
        ('09-ui', ['node','node_modules/tsx/dist/cli.mjs','docs/audits/round-35/ui-repro.mjs']),
        ('10-rubric', ['node','node_modules/tsx/dist/cli.mjs','docs/audits/round-35/rubric-repro.mjs']),
    ]
    for label, file in [('11-media','native-media-repro.mjs'), ('12-worker','native-worker-repro.mjs'), ('13-name','pdf-name-repro.mjs'), ('14-boundary','pdf-boundary-repro.mjs')]:
        commands.append((label, ['node','node_modules/tsx/dist/cli.mjs','docs/audits/round-31/' + file]))
    runs = []
    for label, cmd in commands:
        start = time.monotonic()
        with (OUT / (label + '.log')).open('wb') as log:
            proc = subprocess.run(cmd, cwd=SNAP, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=240)
        runs.append({'id': label, 'command': ' '.join(cmd), 'cwd': str(SNAP), 'exitCode': proc.returncode, 'seconds': round(time.monotonic() - start, 3), 'log': label + '.log'})
        save('gate-runs.json', runs)
        print(json.dumps(runs[-1]), flush=True)
    for source in ['docs/audits/round-31/verify-results.json','docs/audits/round-31/evidence/native-media-results.json','docs/audits/round-31/evidence/native-worker-results.json','docs/audits/round-31/evidence/pdf-name-results.json','docs/audits/round-31/evidence/pdf-boundary-results.json','docs/audits/round-35/evidence/core-repro-results.json','docs/audits/round-35/evidence/ui-repro-results.json','docs/audits/round-35/evidence/rubric-repro-results.json']:
        p = SNAP / source
        if p.exists():
            shutil.copy2(p, OUT / ('fresh-' + p.name))
    after = protected()
    save('integrity-after-gates.json', {'beforeCount': len(before), 'afterCount': len(after), 'unchanged': before == after, 'changed': [p for p in before if after.get(p) != before[p]], 'added': sorted(set(after) - set(before))})
    save('temp-created.json', [p.name for p in TEMP.glob('mindx-round31-*') if p.name not in prior_temp])

if __name__ == '__main__':
    main()
