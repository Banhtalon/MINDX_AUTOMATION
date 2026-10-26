"""AUDIT-R38: isolated exact working-tree snapshot; no product modifications."""
import hashlib, json, os, shutil, subprocess, sys, time
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'docs/audits/round-38/evidence'
SNAP = Path(os.environ['TEMP']).resolve() / 'mindx-round31-r38-phase6'
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest().upper()
def save(n, v): (OUT/n).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def manifest():
    files = [ROOT/n for n in ['package.json','package-lock.json','tsconfig.json','next.config.ts','next-env.d.ts','AGENTS.md','GEMINI.md'] if (ROOT/n).is_file()]
    for d in ['src','scripts','data/config'] + [f'docs/audits/round-{i}' for i in range(12,38)]:
        files += [p for p in (ROOT/d).rglob('*') if p.is_file()]
    return {p.relative_to(ROOT).as_posix():sha(p) for p in sorted(set(files))}
def env():
    e=os.environ.copy()
    for k in list(e):
        if any(s in k.upper() for s in ['PASSWORD','API_KEY','TOKEN','SECRET']) or k in ['NODE_OPTIONS','ALLOWED_LOCAL_DIRS']: e.pop(k,None)
    e['ESBUILD_BINARY_PATH']=str(SNAP.parent/'mindx-esbuild.exe')
    e['NODE_OPTIONS']='--require="'+(SNAP/'docs/audits/round-31/network-guard.cjs').as_posix()+'"'
    return e
def run(label,args):
    start=time.monotonic()
    p=subprocess.run(args,cwd=SNAP,env=env(),stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    log=OUT/(label+'.log')
    if log.exists(): shutil.copy2(log,OUT/(label+'.previous.log'))
    log.write_bytes(p.stdout)
    entry={'label':label,'command':subprocess.list2cmdline(args),'cwd':str(SNAP),'exitCode':p.returncode,'seconds':round(time.monotonic()-start,2),'log':label+'.log'}
    print(json.dumps(entry),flush=True)
    return entry
def main():
    OUT.mkdir(parents=True,exist_ok=True)
    if sys.argv[1]=='setup':
        assert not SNAP.exists(), 'Existing TEMP path: refusing overwrite'
        save('integrity-before.json',manifest())
        (OUT/'plan-before.bin').write_bytes((ROOT/'MINDX_AUTOMATION_PLAN.md').read_bytes())
        (OUT/'git-status-before.txt').write_bytes(subprocess.check_output(['git','status','--porcelain=v1','-uall'],cwd=ROOT))
        SNAP.mkdir()
        for f in ['package.json','tsconfig.json','next.config.ts','next-env.d.ts']: shutil.copy2(ROOT/f,SNAP/f)
        def ignore(d,names): return [n for n in names if n.startswith('.env') or n=='playwright-auth' or (n.startswith('mindx') and '.db' in n)]
        for d in ['src','scripts','docs','data/config']: shutil.copytree(ROOT/d,SNAP/d,ignore=ignore)
        subprocess.run(['powershell','-NoProfile','-Command',f"New-Item -ItemType Junction -Path '{SNAP / 'node_modules'}' -Target '{ROOT / 'node_modules'}' | Out-Null"],check=True)
        binary=SNAP.parent/'mindx-esbuild.exe'
        source=ROOT/'node_modules/@esbuild/win32-x64/esbuild.exe'
        existed=binary.exists()
        if not existed: shutil.copy2(source,binary)
        assert sha(binary)==sha(source)
        original=manifest()
        copied={p:sha(SNAP/p) for p in original if (SNAP/p).is_file()}
        assert all(v==original[p] for p,v in copied.items())
        forbidden=[]
        for d,dirs,files in os.walk(SNAP,followlinks=False):
            dirs[:]=[n for n in dirs if n!='node_modules']
            forbidden += [str(Path(d,n).relative_to(SNAP)) for n in dirs+files if n.startswith('.env') or n=='playwright-auth' or (n.startswith('mindx') and '.db' in n)]
        assert not forbidden
        save('snapshot.json',{'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'path':str(SNAP),'copiedHashes':copied,'forbiddenFiles':forbidden,'esbuildPreexisting':existed,'esbuildSha256':sha(binary),'nodeModulesTarget':str(ROOT/'node_modules')})
        gates=[]
        for label,args in [('01-r32',['node','node_modules/tsx/dist/cli.mjs','docs/audits/round-32/verify-phase6.mjs']),('02-phase6',['node','node_modules/tsx/dist/cli.mjs','scripts/test-phase6.ts']),('03-phase5',['node','node_modules/tsx/dist/cli.mjs','scripts/test-phase5.ts']),('04-typescript',['node','node_modules/typescript/bin/tsc','--noEmit','--incremental','false'])]: gates.append(run(label,args))
        save('baseline-gates.json',gates)
        for f in ['phase6-results.json','browser-scenarios.json']:
            src=SNAP/'docs/audits/round-32/evidence'/f
            if src.exists(): shutil.copy2(src,OUT/('r32-'+f))
    elif sys.argv[1]=='resume-baseline':
        before=json.loads((OUT/'integrity-before.json').read_text())
        copied={p:sha(SNAP/p) for p in before if (SNAP/p).is_file()}
        assert all(v==before[p] for p,v in copied.items())
        save('snapshot.json',{'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'path':str(SNAP),'copiedHashes':copied,'forbiddenFiles':[str(p.relative_to(SNAP)) for p in SNAP.glob('.env*')],'esbuildSha256':sha(SNAP.parent/'mindx-esbuild.exe'),'nodeModulesTarget':str(ROOT/'node_modules'),'setupInterruption':'Stopped own setup process during redundant hash comparison; resumed on same byte-identical snapshot before running any gates.'})
        gates=[]
        for label,args in [('01-r32',['node','node_modules/tsx/dist/cli.mjs','docs/audits/round-32/verify-phase6.mjs']),('02-phase6',['node','node_modules/tsx/dist/cli.mjs','scripts/test-phase6.ts']),('03-phase5',['node','node_modules/tsx/dist/cli.mjs','scripts/test-phase5.ts']),('04-typescript',['node','node_modules/typescript/bin/tsc','--noEmit','--incremental','false'])]: gates.append(run(label,args))
        save('baseline-gates.json',gates)
    elif sys.argv[1]=='compatibility':
        original=(SNAP/'docs/audits/round-32/verify-phase6.mjs').read_text(encoding='utf-8')
        assert original.count("'mindx-round31-r32-'")==1
        adapted=original.replace("'mindx-round31-r32-'","'mindx-round31-r38-phase6'")
        (SNAP/'docs/audits/round-38/r32-compatible.mjs').write_text(adapted,encoding='utf-8')
        (ROOT/'docs/audits/round-38/r32-compatible.mjs').write_text(adapted,encoding='utf-8')
        prior={p.name for p in SNAP.parent.glob('r32-out-*')}
        gate=run('01b-r32-compatible',['node','node_modules/tsx/dist/cli.mjs','docs/audits/round-38/r32-compatible.mjs'])
        gate['adaptation']={'onlyChange':'TEMP folder-name guard r32 to r38','originalSha256':sha(SNAP/'docs/audits/round-32/verify-phase6.mjs'),'adaptedSha256':sha(SNAP/'docs/audits/round-38/r32-compatible.mjs')}
        gate['newExternalFixtures']=[str(p) for p in SNAP.parent.glob('r32-out-*') if p.name not in prior]
        save('compatibility-gate.json',gate)
        for f in ['phase6-results.json','browser-scenarios.json']:
            shutil.copy2(SNAP/'docs/audits/round-32/evidence'/f,OUT/('r32-'+f))
    elif sys.argv[1]=='adversarial':
        for p in (ROOT/'docs/audits/round-38').glob('*.mjs'): shutil.copy2(p,SNAP/'docs/audits/round-38'/p.name)
        save('adversarial-gate.json',run('05-adversarial',['node','node_modules/tsx/dist/cli.mjs','docs/audits/round-38/adversarial.mjs']))
        for p in (SNAP/'docs/audits/round-38/evidence').glob('r38-*'): shutil.copy2(p,OUT/p.name)
if __name__=='__main__': main()
