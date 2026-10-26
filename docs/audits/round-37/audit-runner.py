"""R37: snapshot exact working tree and capture the eleven requested gates."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'docs/audits/round-37/evidence'
TEMP = Path(os.environ['TEMP']).resolve()
SNAP = TEMP / 'mindx-round31-r36-check'
TOP = ['package.json', 'tsconfig.json', 'next.config.ts', 'next-env.d.ts']
DIRS = ['src', 'scripts', 'docs', 'data/config']

def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest().upper()

def protected():
    paths = [ROOT / p for p in TOP + ['AGENTS.md', 'GEMINI.md', 'package-lock.json'] if (ROOT / p).is_file()]
    for name in ['src', 'scripts', 'data/config']:
        paths.extend(p for p in (ROOT / name).rglob('*') if p.is_file())
    for n in range(12, 37):
        paths.extend(p for p in (ROOT / f'docs/audits/round-{n}').rglob('*') if p.is_file())
    return {p.relative_to(ROOT).as_posix(): sha(p) for p in sorted(set(paths))}

def save(name, data):
    (OUT / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    if SNAP.exists():
        raise RuntimeError('Refusing to overwrite existing snapshot')
    before = protected()
    save('integrity-before.json', before)
    (OUT / 'plan-before.bin').write_bytes((ROOT / 'MINDX_AUTOMATION_PLAN.md').read_bytes())
    (OUT / 'git-status-before.txt').write_bytes(subprocess.check_output(['git', 'status', '--porcelain=v1', '-uall'], cwd=ROOT))
    prior_temp = {p.name for p in TEMP.glob('mindx-round31-*')}
    def ignore(directory, names):
        return [n for n in names if n.startswith('.env') or n == 'playwright-auth' or (n.startswith('mindx') and '.db' in n)]
    SNAP.mkdir()
    for f in TOP:
        shutil.copy2(ROOT / f, SNAP / f)
    for d in DIRS:
        shutil.copytree(ROOT / d, SNAP / d, ignore=ignore)
    junction = SNAP / 'node_modules'
    create = subprocess.run(['powershell', '-NoProfile', '-Command',
        "New-Item -ItemType Junction -Path '" + str(junction) + "' -Target '" + str(ROOT / 'node_modules') + "' | Out-Null"], capture_output=True)
    if create.returncode:
        raise RuntimeError(repr(create.stdout + create.stderr))
    esbuild = TEMP / 'mindx-esbuild.exe'
    assert esbuild.is_file(), 'Expected existing esbuild binary'
    assert os.environ['ESBUILD_BINARY_PATH'] == str(esbuild)
    copies = {p: sha(SNAP / p) for p in before if (SNAP / p).is_file()}
    assert all(copies[p] == before[p] for p in copies)
    # Never traverse the node_modules junction when inspecting exclusions.
    excluded = []
    for directory, dirs, files in os.walk(SNAP, followlinks=False):
        dirs[:] = [d for d in dirs if d != 'node_modules']
        for name in dirs + files:
            if name.startswith('.env') or name == 'playwright-auth' or (name.startswith('mindx') and '.db' in name):
                excluded.append(str(Path(directory, name).relative_to(SNAP)))
    assert not excluded
    save('snapshot.json', {'root': str(SNAP), 'createdAt': datetime.now(timezone.utc).isoformat(),
        'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'copiedMatchingFiles': len(copies), 'copiedHashes': copies, 'forbiddenFilesFound': excluded,
        'nodeModulesJunctionTarget': str(ROOT / 'node_modules'), 'esbuildPath': str(esbuild),
        'esbuildPreexisting': True, 'esbuildSha256': sha(esbuild), 'priorTemp': sorted(prior_temp),
        'nodeVersion': subprocess.check_output(['node', '--version'], text=True).strip()})
    env = os.environ.copy()
    for key in list(env):
        if any(s in key.upper() for s in ['PASSWORD', 'API_KEY', 'TOKEN', 'SECRET']) or key in ['NODE_OPTIONS', 'ALLOWED_LOCAL_DIRS']:
            env.pop(key, None)
    guard = str(SNAP / 'docs/audits/round-31/network-guard.cjs').replace('\\', '/')
    env['NODE_OPTIONS'] = '--require="' + guard + '"'
    commands = [
        ('01-independent', ['node', 'docs/audits/round-31/verify-independent.mjs']),
        ('02-native-media', ['node', 'node_modules/tsx/dist/cli.mjs', 'docs/audits/round-31/native-media-repro.mjs']),
        ('03-native-worker', ['node', 'node_modules/tsx/dist/cli.mjs', 'docs/audits/round-31/native-worker-repro.mjs']),
        ('04-pdf-name', ['node', 'node_modules/tsx/dist/cli.mjs', 'docs/audits/round-31/pdf-name-repro.mjs']),
        ('05-pdf-boundary', ['node', 'node_modules/tsx/dist/cli.mjs', 'docs/audits/round-31/pdf-boundary-repro.mjs']),
        ('06-phase5', ['node', 'node_modules/tsx/dist/cli.mjs', 'scripts/test-phase5.ts']),
        ('07-typescript', ['node', 'node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false']),
        ('08-r35-core', ['node', 'node_modules/tsx/dist/cli.mjs', 'docs/audits/round-35/core-repro.mjs']),
        ('09-r35-ui', ['node', 'node_modules/tsx/dist/cli.mjs', 'docs/audits/round-35/ui-repro.mjs']),
        ('10-r35-rubric', ['node', 'node_modules/tsx/dist/cli.mjs', 'docs/audits/round-35/rubric-repro.mjs']),
        ('11-r36-closure', ['node', 'node_modules/tsx/dist/cli.mjs', 'docs/audits/round-36/closure-repro.mjs']),
    ]
    artifacts = {
        '01-independent': 'docs/audits/round-31/verify-results.json',
        '02-native-media': 'docs/audits/round-31/evidence/native-media-results.json',
        '03-native-worker': 'docs/audits/round-31/evidence/native-worker-results.json',
        '04-pdf-name': 'docs/audits/round-31/evidence/pdf-name-results.json',
        '05-pdf-boundary': 'docs/audits/round-31/evidence/pdf-boundary-results.json',
        '08-r35-core': 'docs/audits/round-35/evidence/core-repro-results.json',
        '09-r35-ui': 'docs/audits/round-35/evidence/ui-repro-results.json',
        '10-r35-rubric': 'docs/audits/round-35/evidence/rubric-repro-results.json',
        '11-r36-closure': 'docs/audits/round-36/evidence/closure-results.json',
    }
    runs = []
    for label, cmd in commands:
        source = SNAP / artifacts[label] if label in artifacts else None
        # Preserve old evidence in R37, remove only the snapshot copy before its gate.
        # A gate that writes nothing cannot accidentally pass by reusing historical JSON.
        if source and source.exists():
            shutil.copy2(source, OUT / ('historical-copy-' + source.name))
            source.unlink()
        start = time.monotonic()
        with (OUT / (label + '.log')).open('wb') as log:
            try:
                proc = subprocess.run(cmd, cwd=SNAP, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=240)
                exit_code = proc.returncode
            except subprocess.TimeoutExpired:
                exit_code = 'TIMEOUT'
        run = {'id': label, 'command': ' '.join(cmd), 'cwd': str(SNAP), 'exitCode': exit_code,
               'seconds': round(time.monotonic() - start, 3), 'log': label + '.log'}
        if source:
            run['freshArtifactCreated'] = source.is_file()
            if source.is_file():
                target = 'fresh-' + source.name
                shutil.copy2(source, OUT / target)
                run.update(artifact=target, artifactSha256=sha(OUT / target))
        runs.append(run)
        save('gate-runs.json', runs)
        print(json.dumps(run), flush=True)
    for name in ['new-file-observation.json', 'stop-single-observation.json']:
        shutil.copy2(SNAP / 'docs/audits/round-36/evidence' / name, OUT / ('fresh-' + name))
    after = protected()
    save('integrity-after-gates.json', {'beforeCount': len(before), 'afterCount': len(after),
        'unchanged': before == after, 'changed': [p for p in before if after.get(p) != before[p]],
        'added': sorted(set(after) - set(before))})
    save('temp-created.json', sorted(p.name for p in TEMP.glob('mindx-round31-*') if p.name not in prior_temp))

if __name__ == '__main__':
    main()
