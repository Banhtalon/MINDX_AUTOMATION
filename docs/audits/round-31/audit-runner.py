"""AUDIT-R31. Workspace is read-only except this audit directory; execution in TEMP."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/audits/round-31'
E=OUT/'evidence'
EXPECTED_NEXT='B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def write(n,d):
    (E/n).parent.mkdir(parents=True,exist_ok=True)
    (E/n).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def inventory():
    paths=[]
    for folder in ['src','scripts','public','data/config','docs']:
        paths.extend(p for p in (ROOT/folder).rglob('*') if p.is_file() and not p.is_relative_to(OUT))
    paths.extend(p for p in ROOT.iterdir() if p.is_file() and not p.name.startswith('.env'))
    return {p.relative_to(ROOT).as_posix():{'size':p.stat().st_size,'sha256':sha(p)} for p in sorted(set(paths))}
def safe_temp(p):
    assert p.resolve().is_relative_to(Path(os.environ['TEMP']).resolve()) and 'mindx-round31-' in str(p) and p!=ROOT
def prepare():
    assert not (E/'snapshot.json').exists(),'Do not overwrite a prepared snapshot'
    before=inventory();write('before-hashes.json',before)
    assert before['next-env.d.ts']['sha256'].upper()==EXPECTED_NEXT
    write('source-state.json',{'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
        'gitStatus':subprocess.check_output(['git','status','--short'],cwd=ROOT,text=True,encoding='utf-8'),
        'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    snap=Path(os.environ['TEMP'])/('mindx-round31-'+stamp+'-mindx-round25-compat')/'snapshot'
    safe_temp(snap);snap.mkdir(parents=True)
    write('snapshot.json',{'root':str(ROOT),'out':str(OUT),'snapshot':str(snap),'stamp':stamp})
    for folder in ['src','scripts','public','data/config','docs/audits','node_modules']:
        if (ROOT/folder).exists():
            shutil.copytree(ROOT/folder,snap/folder,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
    for p in ROOT.iterdir():
        if p.is_file() and not p.name.startswith('.env') and p.name!='tsconfig.tsbuildinfo':shutil.copy2(p,snap/p.name)
    for folder in ['.next/types','.next/dev/types']:
        if (ROOT/folder).exists():shutil.copytree(ROOT/folder,snap/folder)
    source={k:v for k,v in before.items() if k.startswith(('src/','scripts/','data/config/')) or '/' not in k and k!='tsconfig.tsbuildinfo'}
    mismatches=[k for k,v in source.items() if not (snap/k).is_file() or sha(snap/k)!=v['sha256']]
    assert not mismatches,mismatches
    excluded=['.env','.env.local','.git','playwright-auth','data/mindx_bot.db','temp_submissions']
    assert all(not (snap/k).exists() for k in excluded)
    write('source-manifest.json',{'files':source,'aggregateSha256':hashlib.sha256(json.dumps(source,sort_keys=True).encode()).hexdigest()})
    write('isolation.json',{'snapshot':str(snap),'sourceMismatch':mismatches,'excludedAbsent':excluded,
        'dependenciesCopied':True,'dependencyJunctionUsed':False,'generatedTypesCopied':True,
        'secretEnvironmentInherited':False,'noRealCredentialsOrDb':True,'networkPolicy':'Node TCP/DNS/fetch blocked; local named pipes allowed. Not OS firewall.'})
    print('PREPARED '+str(snap),flush=True)
def run(names):
    cfg=read(E/'snapshot.json');snap=Path(cfg['snapshot']);safe_temp(snap)
    # Sync only new audit assets, never overwrite historical harnesses in any snapshot.
    def sync(dest):
        shutil.copytree(OUT,dest/'docs/audits/round-31',dirs_exist_ok=True,
            ignore=shutil.ignore_patterns('*.log','before-hashes.json','commands.json','evidence-manifest.json','__pycache__','*.pyc'))
    sync(snap)
    allowed={'SYSTEMROOT','WINDIR','COMSPEC','PATH','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMFILES','PROGRAMFILES(X86)','PROGRAMDATA','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','OS'}
    env={k:v for k,v in os.environ.items() if k.upper() in allowed}
    guard=snap/'docs/audits/round-31/network-guard.cjs'
    env.update({'NODE_OPTIONS':'--require "'+guard.as_posix()+'"','NEXT_TELEMETRY_DISABLED':'1','CI':'1','NO_COLOR':'1','PYTHONDONTWRITEBYTECODE':'1','PYTHONUTF8':'1','npm_config_offline':'true','npm_config_audit':'false','npm_config_fund':'false'})
    binary=snap/'node_modules/@esbuild/win32-x64/esbuild.exe';short=snap.parent/'esbuild.exe'
    if not short.exists():shutil.copy2(binary,short)
    assert sha(binary)==sha(short);env['ESBUILD_BINARY_PATH']=str(short)
    write('esbuild-path-workaround.json',{'executionPath':str(short),'original':str(binary),'sha256':sha(binary),'physicalCopy':True,'productSourceModified':False})
    fresh=[]
    for name in names:
        cwd=snap;result=None
        if name.startswith('round') and 22<=int(name[5:])<=30 or name.startswith('native') and name not in ['native31-media','native31-worker','native25-worker']:
            compat='-'.join('mindx-round'+str(n)+'-x' for n in range(30,21,-1))
            cwd=Path(os.environ['TEMP'])/('mindx-round31-'+cfg['stamp']+'-'+compat)/'snapshot'
        elif name in ['round20','round21']:
            cwd=Path(os.environ['TEMP'])/('mindx-round31-history-'+cfg['stamp']+'-mindx-round20-compat-mindx-round21-compat')/'snapshot'
        safe_temp(cwd)
        if not cwd.exists():
            print('COPY '+str(cwd),flush=True);shutil.copytree(snap,cwd)
        sync(cwd)
        if name.startswith('round'):
            n=int(name[5:]);args=[f'docs/audits/round-{n}/verify-independent.mjs']
            result=f'docs/audits/round-{n}/'+('verify-results.json' if n>=25 else 'independent-results.json')
        elif name.startswith('native'):
            n=int(name[6:].split('-')[0]);kind=name.split('-')[1]
            args=['node_modules/tsx/dist/cli.mjs',f'docs/audits/round-{n}/native-{kind}-repro.mjs']
            result=f'docs/audits/round-{n}/'+('evidence/' if n>=26 else '')+f'native-{kind}-results.json'
        else:
            args={
                'historical14':['docs/audits/round-14/run-checks.mjs'],
                'historical18':['docs/audits/round-18/run-checks.mjs'],
                'phase4':['node_modules/tsx/dist/cli.mjs','scripts/test-phase4-codex-repros.ts'],
                'phase5':['node_modules/tsx/dist/cli.mjs','scripts/test-phase5.ts'],
                'typecheck-before':['node_modules/typescript/bin/tsc','--noEmit','--incremental','false'],
                'typecheck-after':['node_modules/typescript/bin/tsc','--noEmit','--incremental','false'],
                'build':['node_modules/next/dist/bin/next','build','--webpack'],
                'pdf-name':['node_modules/tsx/dist/cli.mjs','docs/audits/round-31/pdf-name-repro.mjs'],
                'pdf-name-oracle':['docs/audits/round-31/pdf-name-oracle.py'],
                'pdf-oracle':['docs/audits/round-31/pdf-oracle.py'],
                'pdf-dict-oracle':['docs/audits/round-31/pdf_dict_oracle.py'],
                'graphql-js-oracle':['docs/audits/round-31/graphql-oracle.mjs'],
                'export-worker-cases':['docs/audits/round-31/export-worker-cases.mjs'],
                'graphql-worker-oracle':['docs/audits/round-31/graphql_worker_oracle.py'],
                'r31-boundary':['node_modules/tsx/dist/cli.mjs','docs/audits/round-31/pdf-boundary-repro.mjs'],
            }[name]
            targets={'pdf-name':'pdf-name-results.json','pdf-name-oracle':'pdf-name-oracle-results.json','pdf-oracle':'pdf-oracle-results.json','pdf-dict-oracle':'pdf-dict-oracle-results.json','graphql-js-oracle':'graphql-oracle-results.json','graphql-worker-oracle':'graphql-worker-oracle-results.json','export-worker-cases':'worker-cases.json','r31-boundary':'pdf-boundary-results.json'}
            if name in targets:result='docs/audits/round-31/evidence/'+targets[name]
        python=name in ['pdf-name-oracle','pdf-oracle','pdf-dict-oracle','graphql-worker-oracle']
        argv=[shutil.which('python.exe') if python else shutil.which('node.exe'),*args]
        attempt=1+max([int(p.name.split('.attempt-')[1].split('.')[0]) for p in E.glob(name+'.attempt-*.log')],default=0)
        log=E/f'{name}.attempt-{attempt}.log'
        if result:(cwd/result).unlink(missing_ok=True)
        print('START '+name,flush=True);started=datetime.datetime.now(datetime.timezone.utc).isoformat();tick=time.monotonic()
        with log.open('wb') as f:
            try:code=subprocess.run(argv,cwd=cwd,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=900).returncode
            except subprocess.TimeoutExpired:code=124
            except OSError as error:
                code=127;write(f'{name}.attempt-{attempt}-launch-error.json',{'error':str(error)})
        receipt={'name':name,'attempt':attempt,'argv':argv,'cwd':str(cwd),'exitCode':code,'startedAt':started,
            'elapsedSeconds':round(time.monotonic()-tick,3),'log':log.name,'logSha256':sha(log),
            'secretEnvironmentInherited':False,'nodeSocketGuard':str(guard),'esbuildBinaryPath':str(short)}
        if result and (cwd/result).exists():
            target=E/f'{name}.attempt-{attempt}-results.json';shutil.copy2(cwd/result,target);d=read(target)
            receipt.update({'results':target.name,'resultsSha256':sha(target),**{k:d.get(k) for k in ['total','passed','failed']}})
            if name.startswith('native31-') or name in ['pdf-name','export-worker-cases']:
                shutil.copy2(target,E/Path(result).name)
        commands=read(E/'commands.json') if (E/'commands.json').exists() else []
        commands.append(receipt);write('commands.json',commands);fresh.append(receipt)
        print('DONE '+json.dumps(receipt),flush=True)
    return int(any(r['exitCode'] for r in fresh))
def preserve():
    before=read(E/'before-hashes.json');after=inventory()
    changed=sorted(k for k in before.keys()&after.keys() if before[k]!=after[k]);added=sorted(after.keys()-before.keys());missing=sorted(before.keys()-after.keys())
    protected=[k for k in before if k=='next-env.d.ts' or any(k.startswith(f'docs/audits/round-{n}/') for n in range(12,31))]
    write('preservation-check.json',{'totalBefore':len(before),'totalAfter':len(after),'changed':changed,'added':added,'missing':missing,
        'protectedCount':len(protected),'protectedMismatches':[k for k in protected if k not in after or before[k]!=after[k]],
        'nextEnvSha256':sha(ROOT/'next-env.d.ts'),'allPreserved':not changed and not added and not missing,
        'planUnchanged':sha(ROOT/'MINDX_AUTOMATION_PLAN.md')==before['MINDX_AUTOMATION_PLAN.md']['sha256'],
        'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
    assert not changed and not added and not missing,(changed,added,missing)
    assert sha(ROOT/'next-env.d.ts').upper()==EXPECTED_NEXT
    print('PRESERVED '+str(len(protected))+' protected files; zero writes outside R31.')
if __name__=='__main__':
    if sys.argv[1]=='prepare':prepare()
    elif sys.argv[1]=='run':raise SystemExit(run(sys.argv[2:]))
    elif sys.argv[1]=='preserve':preserve()
    else:raise ValueError(sys.argv[1])
