"""AUDIT-R30: all product execution occurs in a separate TEMP copy."""
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
OUT = ROOT / 'docs/audits/round-30'
EVIDENCE = OUT / 'evidence'
CONFIG = EVIDENCE / 'snapshot.json'

def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def write(name, obj):
    p = EVIDENCE / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def inventory():
    files = []
    for folder in ['src', 'scripts', 'public', 'data/config', 'docs']:
        files.extend(p for p in (ROOT / folder).rglob('*') if p.is_file() and not p.is_relative_to(OUT))
    files.extend(p for p in ROOT.iterdir() if p.is_file() and not p.name.startswith('.env'))
    return {p.relative_to(ROOT).as_posix(): {'size': p.stat().st_size, 'sha256': sha(p)} for p in sorted(set(files))}

def prepare():
    assert not CONFIG.exists(), 'An existing snapshot must not be overwritten'
    before = inventory()
    write('before-hashes.json', before)
    assert before['next-env.d.ts']['sha256'].upper() == 'B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000'
    write('source-state.json', {'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'gitStatus': subprocess.check_output(['git', 'status', '--short'], cwd=ROOT, text=True, encoding='utf-8'),
        'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()})
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    snap = Path(os.environ['TEMP']) / ('mindx-round30-' + stamp + '-mindx-round29-compat-mindx-round28-compat-mindx-round27-compat-mindx-round26-compat-mindx-round25-compat-mindx-round24-compat-mindx-round23-compat-mindx-round22-compat') / 'snapshot'
    snap.mkdir(parents=True)
    write('snapshot.json', {'root': str(ROOT), 'out': str(OUT), 'snapshot': str(snap)})
    for folder in ['src', 'scripts', 'public', 'data/config', 'docs/audits', 'node_modules']:
        source = ROOT / folder
        if source.exists():
            shutil.copytree(source, snap / folder, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    for p in ROOT.iterdir():
        if p.is_file() and not p.name.startswith('.env') and p.name != 'tsconfig.tsbuildinfo':
            shutil.copy2(p, snap / p.name)
    # Keep the existing generated route declarations to test the exact pre-build type state.
    for folder in ['.next/types', '.next/dev/types']:
        if (ROOT / folder).exists():
            shutil.copytree(ROOT / folder, snap / folder)
    source = {k:v for k,v in before.items() if k.startswith(('src/', 'scripts/', 'data/config/')) or '/' not in k and k != 'tsconfig.tsbuildinfo'}
    mismatch = [k for k,v in source.items() if not (snap/k).is_file() or sha(snap/k) != v['sha256']]
    assert not mismatch, mismatch
    excluded = ['.env.local', '.env', '.git', 'playwright-auth', 'data/mindx_bot.db', 'temp_submissions']
    assert all(not (snap / n).exists() for n in excluded)
    write('source-manifest.json', {'files': source, 'aggregateSha256': hashlib.sha256(json.dumps(source, sort_keys=True).encode()).hexdigest()})
    write('isolation.json', {'snapshot': str(snap), 'sourceMismatch': mismatch, 'excludedAbsent': excluded,
        'dependenciesCopied': True, 'dependencyJunctionUsed': False, 'generatedTypesCopied': True,
        'nodeVersion': subprocess.check_output(['node', '--version'], text=True).strip(),
        'noRealCredentialsOrDb': True, 'preparedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()})
    print('PREPARED ' + str(snap), flush=True)

def run(names):
    snap = Path(json.loads(CONFIG.read_text(encoding='utf-8'))['snapshot'])
    assert snap.resolve().is_relative_to(Path(os.environ['TEMP']).resolve()) and 'mindx-round30-' in str(snap) and snap != ROOT
    allowed = {'SYSTEMROOT','WINDIR','COMSPEC','PATH','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA',
               'PROGRAMFILES','PROGRAMFILES(X86)','PROGRAMDATA','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','OS'}
    env = {k:v for k,v in os.environ.items() if k.upper() in allowed}
    dest = snap / 'docs/audits/round-30'
    shutil.copytree(OUT, dest, dirs_exist_ok=True, ignore=shutil.ignore_patterns('*.log', '*results.json', 'before-hashes.json', 'commands.json', 'evidence-manifest.json'))
    guard = dest / 'network-guard.cjs'
    env.update({'NODE_OPTIONS': '--require "' + guard.as_posix() + '"', 'NEXT_TELEMETRY_DISABLED':'1',
                'npm_config_offline':'true','npm_config_audit':'false','npm_config_fund':'false','CI':'1','NO_COLOR':'1'})
    # Windows CreateProcess rejects this compatibility prefix's >260-char binary path.
    # Copy the identical isolated esbuild binary to a shorter TEMP path; no install.
    binary = snap / 'node_modules/@esbuild/win32-x64/esbuild.exe'
    short_binary = snap.parent / 'esbuild.exe'
    if not short_binary.exists(): shutil.copy2(binary, short_binary)
    assert sha(binary) == sha(short_binary)
    env['ESBUILD_BINARY_PATH'] = str(short_binary)
    write('esbuild-path-workaround.json', {'reason':'Windows executable path length', 'original':str(binary),
        'executionPath':str(short_binary),'sha256':sha(binary),'physicalCopy':True,'productSourceModified':False})
    receipts = json.loads((EVIDENCE/'commands.json').read_text(encoding='utf-8')) if (EVIDENCE/'commands.json').exists() else []
    new = []
    for name in names:
        run_cwd = snap
        if name in ['native25-worker','phase4','phase5','pdf-oracle','pdf-name-oracle']:
            run_cwd = Path(os.environ['TEMP']) / ('mindx-round30-native25-' + snap.parent.name.split('-')[2] + '-mindx-round25-compat') / 'snapshot'
            if not run_cwd.exists():
                shutil.copytree(snap, run_cwd)
            assert run_cwd.resolve().is_relative_to(Path(os.environ['TEMP']).resolve())
            write('sqlite-snapshot.json', {'snapshot':str(run_cwd),'source':str(snap),'physicalCopy':True,
                'reason':'Short physical copy for SQLite WAL in original R25/Phase4/Phase5 and Python PDF-oracle module imports; main compatibility path exceeds Windows native file-path limits. No historical harness or product changed.'})
        if name in ['round20','round21']:
            run_cwd = Path(os.environ['TEMP']) / ('mindx-round30-history-' + snap.parent.name.split('-')[2] + '-mindx-round20-compat-mindx-round21-compat') / 'snapshot'
            if not run_cwd.exists():
                shutil.copytree(snap, run_cwd)
            assert run_cwd.resolve().is_relative_to(Path(os.environ['TEMP']).resolve())
            write('secondary-snapshot.json', {'snapshot':str(run_cwd),'source':str(snap),'physicalCopy':True,
                'reason':'R20/R21 compatibility prefix plus Windows cwd path length'})
        result = None
        if name == 'pdf-name-oracle':
            shutil.copy2(dest/'pdf-name-oracle.py',run_cwd/'docs/audits/round-30/pdf-name-oracle.py')
            shutil.copy2(EVIDENCE/'pdf-name.attempt-1-results.json',run_cwd/'docs/audits/round-30/evidence/pdf-name-results.json')
        if name.startswith('round'):
            n = int(name[5:]); args = [f'docs/audits/round-{n}/verify-independent.mjs']
            result = f'docs/audits/round-{n}/' + ('verify-results.json' if n >= 25 else 'independent-results.json')
        else:
            args = {
                'native25-media':['node_modules/tsx/dist/cli.mjs','docs/audits/round-25/native-media-repro.mjs'],
                'native25-worker':['node_modules/tsx/dist/cli.mjs','docs/audits/round-25/native-worker-repro.mjs'],
                'native24':['node_modules/tsx/dist/cli.mjs','docs/audits/round-24/native-media-repro.mjs'],
                'native29-media':['node_modules/tsx/dist/cli.mjs','docs/audits/round-29/native-media-repro.mjs'],
                'native29-worker':['node_modules/tsx/dist/cli.mjs','docs/audits/round-29/native-worker-repro.mjs'],
                'native28-media':['node_modules/tsx/dist/cli.mjs','docs/audits/round-28/native-media-repro.mjs'],
                'native28-worker':['node_modules/tsx/dist/cli.mjs','docs/audits/round-28/native-worker-repro.mjs'],
                'native30-media':['node_modules/tsx/dist/cli.mjs','docs/audits/round-30/native-media-repro.mjs'],
                'native30-worker':['node_modules/tsx/dist/cli.mjs','docs/audits/round-30/native-worker-repro.mjs'],
                'native27-media':['node_modules/tsx/dist/cli.mjs','docs/audits/round-27/native-media-repro.mjs'],
                'native27-worker':['node_modules/tsx/dist/cli.mjs','docs/audits/round-27/native-worker-repro.mjs'],
                'native26-media':['node_modules/tsx/dist/cli.mjs','docs/audits/round-26/native-media-repro.mjs'],
                'native26-worker':['node_modules/tsx/dist/cli.mjs','docs/audits/round-26/native-worker-repro.mjs'],
                'historical14':['docs/audits/round-14/run-checks.mjs'],
                'historical18':['docs/audits/round-18/run-checks.mjs'],
                'phase4':['node_modules/tsx/dist/cli.mjs','scripts/test-phase4-codex-repros.ts'],
                'phase5':['node_modules/tsx/dist/cli.mjs','scripts/test-phase5.ts'],
                'typecheck-before':['node_modules/typescript/bin/tsc','--noEmit','--incremental','false'],
                'typecheck-after':['node_modules/typescript/bin/tsc','--noEmit','--incremental','false'],
                'build':['node_modules/next/dist/bin/next','build','--webpack'],
                'pdf-oracle':['docs/audits/round-30/pdf-oracle.py'],
                'pdf-baseline':['node_modules/tsx/dist/cli.mjs','docs/audits/round-30/pdf-baseline-repro.mjs'],
                'pdf-name':['node_modules/tsx/dist/cli.mjs','docs/audits/round-30/pdf-name-repro.mjs'],
                'pdf-name-oracle':['docs/audits/round-30/pdf-name-oracle.py'],
                'graphql-oracle':['docs/audits/round-30/graphql-oracle.mjs'],
            }[name]
            result = {'native28-media':'docs/audits/round-28/evidence/native-media-results.json',
                'native28-worker':'docs/audits/round-28/evidence/native-worker-results.json','native30-media':'docs/audits/round-30/evidence/native-media-results.json',
                'native29-media':'docs/audits/round-29/evidence/native-media-results.json',
                'native30-worker':'docs/audits/round-30/evidence/native-worker-results.json',
                'native29-worker':'docs/audits/round-29/evidence/native-worker-results.json',
                'native25-media':'docs/audits/round-25/native-media-results.json',
                'native25-worker':'docs/audits/round-25/native-worker-results.json',
                'native24':'docs/audits/round-24/native-media-results.json',
                'native27-media':'docs/audits/round-27/evidence/native-media-results.json',
                'native27-worker':'docs/audits/round-27/evidence/native-worker-results.json',
                'native26-media':'docs/audits/round-26/evidence/native-media-results.json',
                'native26-worker':'docs/audits/round-26/evidence/native-worker-results.json',
                'pdf-oracle':'docs/audits/round-30/evidence/pdf-oracle-results.json',
                'pdf-baseline':'docs/audits/round-30/evidence/pdf-baseline-results.json',
                'pdf-name':'docs/audits/round-30/evidence/pdf-name-results.json',
                'pdf-name-oracle':'docs/audits/round-30/evidence/pdf-name-oracle-results.json',
                'graphql-oracle':'docs/audits/round-30/evidence/graphql-oracle-results.json'}.get(name)
        argv = [shutil.which('python.exe') if name in ['pdf-oracle','pdf-name-oracle'] else shutil.which('node.exe'), *args]
        attempt = 1 + max([int(p.name.split('.attempt-')[1].split('.')[0]) for p in EVIDENCE.glob(name+'.attempt-*.log')], default=0)
        log = EVIDENCE / f'{name}.attempt-{attempt}.log'
        if result: (run_cwd/result).unlink(missing_ok=True)
        started = datetime.datetime.now(datetime.timezone.utc).isoformat(); tick = time.monotonic()
        print('START ' + name, flush=True)
        with log.open('wb') as f:
            try:
                proc = subprocess.run(argv, cwd=run_cwd, env=env, stdout=f, stderr=subprocess.STDOUT, timeout=900)
                code = proc.returncode
            except subprocess.TimeoutExpired:
                code = 124
            except OSError as error:
                code = 127
                write(f'{name}.attempt-{attempt}-launch-error.json', {'type':type(error).__name__,'error':str(error),'argv':argv,'cwd':str(run_cwd)})
        receipt = {'name':name,'attempt':attempt,'argv':argv,'cwd':str(run_cwd),'exitCode':code,
            'startedAt':started,'elapsedSeconds':round(time.monotonic()-tick,3),'log':log.name,'logSha256':sha(log),
            'secretEnvironmentInherited':False, 'nodeSocketGuard':str(guard),'esbuildBinaryPath':str(short_binary)}
        if result and (run_cwd/result).exists():
            target = EVIDENCE / f'{name}.attempt-{attempt}-results.json'
            shutil.copy2(run_cwd/result,target)
            data=json.loads(target.read_text(encoding='utf-8'))
            receipt.update({'results':target.name,'resultsSha256':sha(target),**{k:data.get(k) for k in ['total','passed','failed']}})
        receipts = json.loads((EVIDENCE/'commands.json').read_text(encoding='utf-8')) if (EVIDENCE/'commands.json').exists() else []
        receipts.append(receipt); new.append(receipt); write('commands.json',receipts)
        print('DONE ' + json.dumps(receipt), flush=True)
    return int(any(r['exitCode'] for r in new))

def preserve():
    before=json.loads((EVIDENCE/'before-hashes.json').read_text(encoding='utf-8')); after=inventory()
    changed=sorted(k for k in before.keys() & after.keys() if before[k]!=after[k])
    added=sorted(after.keys()-before.keys()); missing=sorted(before.keys()-after.keys())
    protected=[k for k in before if k=='next-env.d.ts' or any(k.startswith(f'docs/audits/round-{n}/') for n in range(12,30))]
    authorized=[]
    if (EVIDENCE/'plan-update.json').exists():
        update=json.loads((EVIDENCE/'plan-update.json').read_text(encoding='utf-8'))
        assert update['beforeSha256']==before['MINDX_AUTOMATION_PLAN.md']['sha256']
        assert update['afterSha256']==sha(ROOT/'MINDX_AUTOMATION_PLAN.md')
        authorized=['MINDX_AUTOMATION_PLAN.md']
    write('preservation-check.json', {'totalBefore':len(before),'totalAfter':len(after),'changed':changed,'added':added,'missing':missing,
        'protectedCount':len(protected),'protectedMismatches':[k for k in protected if k not in after or before[k]!=after[k]],
        'nextEnvSha256':sha(ROOT/'next-env.d.ts'),'allPreserved':not changed and not added and not missing,
        'authorizedAuditDocumentationChanges':authorized,'allProductAndProtectedFilesPreserved':changed==authorized and not added and not missing,
        'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
    assert changed==authorized and not added and not missing, (changed,added,missing)
    print('PRESERVED protected=' + str(len(protected)) + '; changed audit documentation=' + str(authorized), flush=True)

if __name__=='__main__':
    if sys.argv[1]=='prepare': prepare()
    elif sys.argv[1]=='preserve': preserve()
    elif sys.argv[1]=='run': raise SystemExit(run(sys.argv[2:]))
    else: raise ValueError(sys.argv[1])
