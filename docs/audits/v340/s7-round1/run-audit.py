import os, pathlib, shutil, subprocess, tempfile, json, hashlib, concurrent.futures, time
ROOT = pathlib.Path(__file__).resolve().parents[4]
OUT = pathlib.Path(__file__).resolve().parent
BASE = pathlib.Path(tempfile.mkdtemp(prefix='mindx-s7-audit-'))
def manifest():
    files = list((ROOT/'src').rglob('*')) + list((ROOT/'scripts').rglob('*')) + [ROOT/'next-env.d.ts']
    for i in range(12,42):
        files += list((ROOT/f'docs/audits/round-{i}').rglob('*'))
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files if p.is_file()}
(OUT/'protected-before.json').write_text(json.dumps(manifest(), indent=2), encoding='utf8')
(OUT/'isolation.json').write_text(json.dumps({'root':str(ROOT),'temp':str(BASE),'policy':'source-only mirrors; no .env, production data, login profiles; per-gate TEMP environment'},indent=2),encoding='utf8')
def mirror(name):
    dest = BASE/name
    dest.mkdir()
    for folder in ['src','scripts','public','.agents']:
        if (ROOT/folder).exists(): shutil.copytree(ROOT/folder,dest/folder)
    for p in ROOT.iterdir():
        if p.is_file() and (p.suffix in ['.json','.mjs','.js','.cjs','.ts','.md','.bat','.command']): shutil.copy2(p,dest/p.name)
    (dest/'data').mkdir(exist_ok=True)
    shutil.copytree(ROOT/'data/config',dest/'data/config',ignore=shutil.ignore_patterns('teacher_browsed_dirs.json'))
    for sub in ['types','dev/types']:
        if (ROOT/'.next'/sub).exists(): shutil.copytree(ROOT/'.next'/sub,dest/'.next'/sub)
    subprocess.run(['powershell','-NoProfile','-Command',f"New-Item -ItemType Junction -Path '{dest/'node_modules'}' -Target '{ROOT/'node_modules'}' | Out-Null"],check=True,capture_output=True)
    return dest
GUARD = BASE/'network-guard.cjs'
GUARD.write_text('''const net=require('node:net'); const tls=require('node:tls');
const deny=()=>{throw new Error('AUDIT: live network disabled');};
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...a){let o=a[0];if(Array.isArray(o))o=o[0];if(typeof o==='string' && (o.includes('pipe')||o.includes('sock')))return connect.apply(this,a);if(o&&typeof o==='object'&&(o.path||['127.0.0.1','localhost','::1'].includes(o.host)))return connect.apply(this,a);throw new Error('AUDIT: socket network disabled '+JSON.stringify(a));};
tls.connect=deny; globalThis.fetch=deny;
''',encoding='utf8')
GATES = [('tsc',['npx.cmd','tsc','--noEmit','--incremental','false'])]+[(n,['npx.cmd','tsx',f'scripts/{n}.ts']) for n in ['test-streamline-v340-s7','test-streamline-v340-s4','test-phase4-codex-repros','test-phase5','test-phase7','test-teaching-project-v320','test-report-card-v330']]
def run(item):
    name, cmd = item
    dest=mirror(name)
    env=os.environ.copy()
    env.update(ALLOWED_LOCAL_DIRS=str(dest),MINDX_DB_PATH=str(dest/'data/test.db'),MINDX_RUNNING_CLASSES_PATH=str(dest/'data/running_classes.json'),NODE_OPTIONS=f'--require={GUARD}',NEXT_TELEMETRY_DISABLED='1')
    for key in ['GEMINI_API_KEY','LMS_PASSWORD','TEACHING_PASSWORD']: env.pop(key,None)
    start=time.time()
    if (OUT/(name+'.log')).exists(): shutil.copy2(OUT/(name+'.log'),OUT/(name+'.attempt1.log'))
    if (OUT/(name+'.json')).exists(): shutil.copy2(OUT/(name+'.json'),OUT/(name+'.attempt1.json'))
    with (OUT/(name+'.log')).open('w',encoding='utf8') as log:
        result=subprocess.run(cmd,cwd=dest,env=env,stdout=log,stderr=subprocess.STDOUT)
    record={'name':name,'command':' '.join(cmd).replace('npx.cmd','npx'),'exitCode':result.returncode,'seconds':round(time.time()-start,2),'cwd':str(dest),'environment':{k:env[k] for k in ['ALLOWED_LOCAL_DIRS','MINDX_DB_PATH','MINDX_RUNNING_CLASSES_PATH']}}
    (OUT/(name+'.json')).write_text(json.dumps(record,indent=2),encoding='utf8')
    print(json.dumps(record),flush=True)
    return record
if __name__=='__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: results=list(pool.map(run,GATES))
    (OUT/'gates.json').write_text(json.dumps(results,indent=2),encoding='utf8')
    (OUT/'protected-after-gates.json').write_text(json.dumps(manifest(),indent=2),encoding='utf8')
