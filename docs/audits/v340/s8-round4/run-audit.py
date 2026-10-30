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
BASE = Path(tempfile.mkdtemp(prefix='mindx-s8-r4-'))
TEMP = Path(os.environ['TEMP'])

def save(name, value):
    (OUT/name).write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding='utf8')

def hashes(paths, root=ROOT):
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest().upper()
            for p in paths if p.is_file()}

def protected():
    paths = list((ROOT/'src').rglob('*')) + list((ROOT/'scripts').rglob('*'))
    paths += [ROOT/name for name in ['next-env.d.ts','AGENTS.md','GEMINI.md','package.json','package-lock.json','tsconfig.json']]
    for n in range(12,42):
        paths += list((ROOT/f'docs/audits/round-{n}').rglob('*'))
    paths += [p for p in (ROOT/'docs/audits').rglob('*') if 's8-round4' not in p.parts and p.name not in ['CODEX_V340_FINAL.md','CODEX_V340_FINAL_ROUND4.md']] 
    return hashes(paths)

before = protected()
save('protected-before.json', before)
old = json.loads((ROOT/'docs/audits/v340/s8-round3/protected-before.json').read_text(encoding='utf8'))
changes = {p:{'round3':h, 'round4':before.get(p)} for p,h in old.items() if before.get(p)!=h}
save('round3-comparison.json', {'round3Count':len(old), 'changed':changes,
    'addedSource':[p for p in before if p.startswith(('src/','scripts/')) and p not in old]})
(OUT/'git-status-before.txt').write_text(subprocess.check_output(['git','status','--short'],cwd=ROOT,text=True,encoding='utf8'),encoding='utf8')
for name in ['PROJECT_STATE.md','CHANGELOG.md','MINDX_AUTOMATION_PLAN.md','docs/audits/v340/CODEX_V340_FINAL.md']:
    dest=OUT/'documents-before'/Path(name).name
    dest.parent.mkdir(exist_ok=True)
    shutil.copy2(ROOT/name,dest)
for folder in ['src','scripts','.agents']:
    if (ROOT/folder).exists(): shutil.copytree(ROOT/folder,BASE/folder)
for p in ROOT.iterdir():
    if p.is_file() and p.suffix in ['.json','.mjs','.js','.cjs','.ts','.md']:
        shutil.copy2(p, BASE/p.name)
(BASE/'data/config').mkdir(parents=True)
for name in ['default-spck-thumbnail.png','grading_rubrics.json','zalo_templates.json']:
    shutil.copy2(ROOT/'data/config'/name,BASE/'data/config'/name)
for sub in ['types','dev/types']:
    if (ROOT/'.next'/sub).exists(): shutil.copytree(ROOT/'.next'/sub, BASE/'.next'/sub)
subprocess.run(['powershell','-NoProfile','-Command',
    f"New-Item -ItemType Junction -Path '{BASE/'node_modules'}' -Target '{ROOT/'node_modules'}' | Out-Null"],check=True,capture_output=True)
for src in [ROOT/'docs/audits/v340/s8-final/path-probe.cjs',ROOT/'docs/audits/v340/s8-final/browser-policy-probe.cjs',ROOT/'docs/audits/v340/s8-round2/renderer-resource-probe.cjs',ROOT/'docs/audits/v340/s8-round2/edge-probe.cjs']+[ROOT/'docs/audits/v340/s8-round3/renderer-compatibility-probe.cjs',ROOT/'docs/audits/v340/s8-round3/renderer-payload-probe.cjs']:
    shutil.copy2(src, BASE/src.name)
save('probe-copy-hashes.json', {p.name:{'original':hashlib.sha256(p.read_bytes()).hexdigest().upper(),'copy':hashlib.sha256((BASE/p.name).read_bytes()).hexdigest().upper()} for p in [ROOT/'docs/audits/v340/s8-final/path-probe.cjs',ROOT/'docs/audits/v340/s8-final/browser-policy-probe.cjs',ROOT/'docs/audits/v340/s8-round2/renderer-resource-probe.cjs',ROOT/'docs/audits/v340/s8-round2/edge-probe.cjs',ROOT/'docs/audits/v340/s8-round3/renderer-compatibility-probe.cjs',ROOT/'docs/audits/v340/s8-round3/renderer-payload-probe.cjs']})
guard=BASE/'network-guard.cjs'
guard.write_text('''const net=require('node:net'),tls=require('node:tls');
const deny=()=>{throw new Error('AUDIT: live network disabled');};
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...a){let o=a[0];if(Array.isArray(o))o=o[0];if(typeof o==='string'&&(o.includes('pipe')||o.includes('sock')))return connect.apply(this,a);if(o&&typeof o==='object'&&(o.path||['127.0.0.1','localhost','::1'].includes(o.host)))return connect.apply(this,a);throw new Error('AUDIT: socket network disabled');};
tls.connect=deny;globalThis.fetch=deny;
const {chromium}=require('playwright');
const launch=chromium.launch;
chromium.launch=async function(options){
 const browser=await launch.call(this,{...options,args:[...(options?.args||[]),'--disable-background-networking','--disable-component-update','--no-proxy-server']});
 const newContext=browser.newContext;
 browser.newContext=async function(options){
  const context=await newContext.call(this,{...options,offline:true});
  await context.route('http://**/*',r=>r.abort());
  await context.route('https://**/*',r=>r.abort());
  return context;
 };
 return browser;
};
''',encoding='utf8')
env=os.environ.copy()
env.update(ALLOWED_LOCAL_DIRS=str(TEMP),MINDX_DB_PATH=str(TEMP/'mindx_codex_s8_r4.db'),
    MINDX_RUNNING_CLASSES_PATH=str(TEMP/'mindx_codex_s8_r4_rc.json'),GEMINI_API_KEY='test-s8-dummy-key',
    NODE_OPTIONS='--require='+str(guard),NEXT_TELEMETRY_DISABLED='1',QT_QPA_PLATFORM='offscreen',
    AUDIT_PATH_OUT=str(OUT/'path-probe.json'),AUDIT_BROWSER_OUT=str(OUT/'browser-policy-probe.json'),
    AUDIT_EXTRA_OUT=str(OUT/'edge-results.json'), AUDIT_RENDERER_OUT=str(OUT/'renderer-resources.json'), AUDIT_COMPAT_OUT=str(OUT/'renderer-compatibility.json'), AUDIT_PAYLOAD_OUT=str(OUT/'renderer-payload.json'), npm_config_offline='true', PYTHONIOENCODING='utf-8')
for key in ['LMS_PASSWORD','TEACHING_PASSWORD','MINDX_PASSWORD','LMS_USERNAME','TEACHING_USERNAME','MINDX_USERNAME']:
    env.pop(key,None)
save('isolation.json',{'root':str(ROOT),'mirror':str(BASE),
    'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
    'environment':{k:env[k] for k in ['ALLOWED_LOCAL_DIRS','MINDX_DB_PATH','MINDX_RUNNING_CLASSES_PATH','GEMINI_API_KEY','QT_QPA_PLATFORM']},
    'sourceMatches':hashes((ROOT/'src').rglob('*'))==hashes((BASE/'src').rglob('*'),BASE),
    'policy':'Chromium offline with HTTP(S) routes aborted; TEMP source mirror; no .env, Owner DB/cache/login profile/teacher directory registry; external Node network denied; synthetic offline fixtures only'})
gates=[('renderer-resource-probe',['npx.cmd','tsx','renderer-resource-probe.cjs']),('renderer-compatibility-probe',['npx.cmd','tsx','renderer-compatibility-probe.cjs']),('renderer-payload-probe',['npx.cmd','tsx','renderer-payload-probe.cjs']),('path-probe',['npx.cmd','tsx','path-probe.cjs']),
       ('browser-policy-probe',['npx.cmd','tsx','browser-policy-probe.cjs']),
       ('tsc',['npx.cmd','tsc','--noEmit','--incremental','false']),
       ('spck-v272',['npx.cmd','tsx','scripts/test-spck-v272.ts']),
       ('s5',['npx.cmd','tsx','scripts/test-streamline-v340-s5.ts']),
       ('s7',['npx.cmd','tsx','scripts/test-streamline-v340-s7.ts'])]
if (BASE/'edge-probe.cjs').exists(): gates.append(('edge-probe',['npx.cmd','tsx','edge-probe.cjs']))
results=[]
try:
    for name,cmd in gates:
        start=time.time()
        try:
            with (OUT/(name+'.log')).open('w',encoding='utf8') as log:
                run=subprocess.run(cmd,cwd=BASE,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=240)
            code=run.returncode
        except subprocess.TimeoutExpired: code='TIMEOUT'
        record={'name':name,'command':' '.join(cmd).replace('npx.cmd','npx'),'exitCode':code,'seconds':round(time.time()-start,2),'cwd':str(BASE)}
        results.append(record)
        save('gates.json',results)
        print(json.dumps(record),flush=True)
finally:
    after=protected()
    save('preservation.json',{'countBefore':len(before),'countAfter':len(after),
        'changed':[p for p in before if before[p]!=after.get(p)],'added':sorted(set(after)-set(before)),
        'mirrorSourceMatches':hashes((ROOT/'src').rglob('*'))==hashes((BASE/'src').rglob('*'),BASE)})
