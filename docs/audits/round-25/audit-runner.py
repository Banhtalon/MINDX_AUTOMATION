"""AUDIT-R25 orchestration. Product and historical files are read-only in the original tree."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'docs/audits/round-25'
CONFIG = OUT / 'snapshot.json'

def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def write(name, obj):
    (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def inventory():
    files = []
    for folder in ['src', 'scripts', 'public', 'data/config']:
        files.extend(p for p in (ROOT / folder).rglob('*') if p.is_file())
    files.extend(p for p in ROOT.iterdir() if p.is_file() and not p.name.startswith('.env') and p.name != 'tsconfig.tsbuildinfo')
    files.extend(p for p in (ROOT / 'docs').rglob('*') if p.is_file() and not p.is_relative_to(OUT))
    return {p.relative_to(ROOT).as_posix(): {'size': p.stat().st_size, 'sha256': sha(p)} for p in sorted(set(files))}

def prepare():
    assert not CONFIG.exists(), 'Do not overwrite an existing audit snapshot'
    before = inventory()
    write('before-hashes.json', before)
    assert before['next-env.d.ts']['sha256'].upper() == 'B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000'
    state = {'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
             'gitStatus': subprocess.check_output(['git', 'status', '--short'], cwd=ROOT, text=True),
             'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    write('source-state.json', state)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    snap = Path(os.environ['TEMP']) / ('mindx-round25-' + stamp + '-mindx-round24-compat-mindx-round23-compat-mindx-round22-compat-mindx-round21-compat-mindx-round20-compat') / 'snapshot'
    snap.mkdir(parents=True)
    write('snapshot.json', {'root': str(ROOT), 'out': str(OUT), 'snapshot': str(snap)})
    for folder in ['src', 'scripts', 'public', 'data/config', 'docs/audits', 'node_modules']:
        source = ROOT / folder
        if source.exists():
            shutil.copytree(source, snap / folder, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    for p in ROOT.iterdir():
        if p.is_file() and not p.name.startswith('.env') and p.name != 'tsconfig.tsbuildinfo':
            shutil.copy2(p, snap / p.name)
    changed = [name for name, meta in before.items() if name.startswith(('src/', 'scripts/')) or '/' not in name
               if not (snap / name).is_file() or sha(snap / name) != meta['sha256']]
    assert not changed, changed
    excluded = ['.env.local', '.env', '.git', '.next', 'playwright-auth', 'data/mindx_bot.db', 'temp_submissions']
    assert all(not (snap / n).exists() for n in excluded)
    write('snapshot-check.json', {'snapshot': str(snap), 'sourceMismatch': changed,
          'excludedAbsent': excluded, 'dependenciesCopied': True, 'dependencyJunctionUsed': False,
          'nodeVersion': subprocess.check_output(['node', '--version'], text=True).strip(),
          'preparedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()})
    print(str(snap), flush=True)

def run(names):
    cfg = json.loads(CONFIG.read_text(encoding='utf-8'))
    snap = Path(cfg['snapshot'])
    assert snap.is_relative_to(Path(os.environ['TEMP'])) and 'mindx-round25-' in str(snap) and snap != ROOT
    allowed = {'SYSTEMROOT','WINDIR','COMSPEC','PATH','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA',
               'LOCALAPPDATA','PROGRAMFILES','PROGRAMFILES(X86)','PROGRAMDATA','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','OS'}
    env = {k:v for k,v in os.environ.items() if k.upper() in allowed}
    guard = snap / 'docs/audits/round-19/network-guard.cjs'
    env.update({'NODE_OPTIONS': '--require "' + guard.as_posix() + '"', 'NEXT_TELEMETRY_DISABLED':'1',
                'npm_config_offline':'true','npm_config_audit':'false','npm_config_fund':'false','CI':'1','NO_COLOR':'1'})
    write('isolation.json', {'environmentKeys': sorted(env), 'secretsInherited':False, 'credentialsCopied':False,
          'nodeSocketGuard':str(guard), 'limits':'Node socket guard, not OS firewall. No real LMS/Gemini/browser calls.'})
    dest = snap / 'docs/audits/round-25'
    dest.mkdir(exist_ok=True)
    for p in OUT.glob('*.mjs'):
        shutil.copy2(p, dest / p.name)
    receipts = json.loads((OUT/'commands.json').read_text(encoding='utf-8')) if (OUT/'commands.json').exists() else []
    new = []
    for name in names:
        result = None
        if name.startswith('round'):
            n = int(name[5:]); script = f'docs/audits/round-{n}/verify-independent.mjs'
            argv = [shutil.which('node.exe'), script]
            result = f'docs/audits/round-{n}/' + ('verify-results.json' if n == 25 else 'independent-results.json')
        elif name == 'native24':
            argv = [shutil.which('node.exe'), 'node_modules/tsx/dist/cli.mjs', 'docs/audits/round-24/native-media-repro.mjs']
            result = 'docs/audits/round-24/native-media-results.json'
        elif name in ['phase4','phase5','typecheck','native25','native-worker']:
            args = {'phase4':['node_modules/tsx/dist/cli.mjs','scripts/test-phase4-codex-repros.ts'],
                    'phase5':['node_modules/tsx/dist/cli.mjs','scripts/test-phase5.ts'],
                    'typecheck':['node_modules/typescript/bin/tsc','--noEmit','--incremental','false'],
                    'native25':['node_modules/tsx/dist/cli.mjs','docs/audits/round-25/native-media-repro.mjs'],
                    'native-worker':['node_modules/tsx/dist/cli.mjs','docs/audits/round-25/native-worker-repro.mjs']}[name]
            argv = [shutil.which('node.exe'), *args]
            if name == 'native25': result = 'docs/audits/round-25/native-media-results.json'
            if name == 'native-worker': result = 'docs/audits/round-25/native-worker-results.json'
        elif name == 'build':
            argv = [os.environ.get('COMSPEC', r'C:\Windows\System32\cmd.exe'), '/d','/s','/c','npm run build']
        else:
            raise ValueError(name)
        attempt = 1 + sum(r['name']==name for r in receipts)
        log = OUT / f'{name}.attempt-{attempt}.log'
        if result: (snap/result).unlink(missing_ok=True)
        started = datetime.datetime.now(datetime.timezone.utc).isoformat(); tick = time.monotonic()
        print('START '+name, flush=True)
        with log.open('wb') as f:
            proc = subprocess.run(argv, cwd=snap, env=env, stdout=f, stderr=subprocess.STDOUT)
        receipt = {'name':name,'attempt':attempt,'argv':argv,'cwd':str(snap),'exitCode':proc.returncode,
                   'startedAt':started,'elapsedSeconds':round(time.monotonic()-tick,3),'log':log.name,'logSha256':sha(log)}
        if result and (snap/result).exists():
            target = OUT / f'{name}.attempt-{attempt}-results.json'
            shutil.copy2(snap/result,target)
            canonical = 'verify-results.json' if name=='round25' else name+'-results.json'
            shutil.copy2(target,OUT/canonical)
            data=json.loads(target.read_text(encoding='utf-8'))
            receipt.update({'results':target.name,'resultsSha256':sha(target),'canonicalResults':canonical,
                            **{k:data.get(k) for k in ['total','passed','failed']}})
        receipts.append(receipt); new.append(receipt); write('commands.json',receipts)
        print('DONE '+json.dumps(receipt), flush=True)
    return int(any(r['exitCode'] for r in new))

def preserve():
    before=json.loads((OUT/'before-hashes.json').read_text(encoding='utf-8')); after=inventory()
    changed=[k for k in before.keys() & after.keys() if before[k]!=after[k]]
    added=sorted(after.keys()-before.keys()); missing=sorted(before.keys()-after.keys())
    protected=[k for k in before if k=='next-env.d.ts' or any(k.startswith(f'docs/audits/round-{n}/') for n in range(12,25))]
    source={k:v for k,v in before.items() if k.startswith(('src/','scripts/')) or ('/' not in k and k != 'tsconfig.tsbuildinfo') or k.startswith('data/config/')}
    write('preservation-check.json', {'totalBefore':len(before),'totalAfter':len(after),'changed':changed,'added':added,'missing':missing,
          'protectedCount':len(protected),'sourceFiles':len(source),'nextEnvSha256':sha(ROOT/'next-env.d.ts'),
          'allPreserved':not changed and not added and not missing,'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
    write('source-manifest.json', {'files':source,'aggregateSha256':hashlib.sha256(json.dumps(source,sort_keys=True).encode()).hexdigest()})
    assert not changed and not added and not missing, (changed,added,missing)

if __name__=='__main__':
    if sys.argv[1]=='prepare': prepare()
    elif sys.argv[1]=='preserve': preserve()
    elif sys.argv[1]=='run': raise SystemExit(run(sys.argv[2:]))
    else: raise ValueError(sys.argv[1])
