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
BASE = Path(tempfile.mkdtemp(prefix='mindx-s8-final-'))
TEMP = Path(os.environ['TEMP'])
EXPECTED = {
    'data/mindx_bot.db': 'A911EB02CD6E2610340604DCF42D53AFB428C50C02727C4CE44F138DEC9C8F16',
    'data/running_classes.json': 'ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2',
}

def save(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding='utf8')

def hashes(paths, root=ROOT):
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest().upper()
            for p in paths if p.is_file()}

def protected():
    paths = list((ROOT/'src').rglob('*')) + list((ROOT/'scripts').rglob('*'))
    paths += [ROOT/'next-env.d.ts', ROOT/'AGENTS.md', ROOT/'GEMINI.md', ROOT/'package.json', ROOT/'tsconfig.json']
    for number in range(12, 42):
        paths += list((ROOT/f'docs/audits/round-{number}').rglob('*'))
    return hashes(paths)

before = protected()
save('protected-before.json', before)
prod_before = hashes([ROOT/p for p in EXPECTED])
save('production-before.json', prod_before)
if prod_before != EXPECTED:
    raise RuntimeError('Production hashes differ from required baseline')
for folder in ['src', 'scripts', '.agents', 'public']:
    if (ROOT/folder).exists():
        shutil.copytree(ROOT/folder, BASE/folder)
for p in ROOT.iterdir():
    if p.is_file() and p.suffix in ['.json', '.mjs', '.js', '.cjs', '.ts', '.md']:
        shutil.copy2(p, BASE/p.name)
shutil.copytree(ROOT/'data/config', BASE/'data/config', ignore=shutil.ignore_patterns('teacher_browsed_dirs.json'))
for sub in ['types', 'dev/types']:
    if (ROOT/'.next'/sub).exists():
        shutil.copytree(ROOT/'.next'/sub, BASE/'.next'/sub)
probe = Path('docs/audits/v340/s7-round1/adversarial-probe.cjs')
(BASE/probe).parent.mkdir(parents=True)
shutil.copy2(ROOT/probe, BASE/probe)
for name in ['node_modules', '.git']:
    subprocess.run(['powershell', '-NoProfile', '-Command',
        f"New-Item -ItemType Junction -Path '{BASE/name}' -Target '{ROOT/name}' | Out-Null"],
        check=True, capture_output=True)
guard = BASE/'network-guard.cjs'
guard.write_text('''const net=require('node:net');const tls=require('node:tls');
const deny=()=>{throw new Error('AUDIT: live network disabled');};
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...a){let o=a[0];if(Array.isArray(o))o=o[0];if(typeof o==='string'&&(o.includes('pipe')||o.includes('sock')))return connect.apply(this,a);if(o&&typeof o==='object'&&(o.path||['127.0.0.1','localhost','::1'].includes(o.host)))return connect.apply(this,a);throw new Error('AUDIT: socket network disabled');};
tls.connect=deny;globalThis.fetch=deny;
''', encoding='utf8')
env = os.environ.copy()
env.update(ALLOWED_LOCAL_DIRS=str(TEMP), MINDX_DB_PATH=str(TEMP/'mindx_codex_s8_final.db'),
    MINDX_RUNNING_CLASSES_PATH=str(TEMP/'mindx_codex_s8_final_rc.json'),
    GEMINI_API_KEY='test-s8-dummy-key', NODE_OPTIONS='--require='+str(guard), NEXT_TELEMETRY_DISABLED='1',
    AUDIT_RESULT_OUT=str(OUT/'adversarial-results.json'), AUDIT_HTML_OUT=str(OUT/'rendered-html.json'))
for key in ['LMS_PASSWORD', 'TEACHING_PASSWORD']:
    env.pop(key, None)
save('isolation.json', {'root':str(ROOT), 'temp':str(BASE),
    'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
    'environment':{k:env[k] for k in ['ALLOWED_LOCAL_DIRS','MINDX_DB_PATH','MINDX_RUNNING_CLASSES_PATH','GEMINI_API_KEY']},
    'policy':'Source-only TEMP mirror; no .env, production data or login profile; external Node network blocked',
    'sourceMatches':hashes((ROOT/'src').rglob('*'))==hashes((BASE/'src').rglob('*'),BASE)})
(OUT/'git-status-before.txt').write_text(subprocess.check_output(['git','status','--short'],cwd=ROOT,text=True),encoding='utf8')
(OUT/'working-tree.patch').write_text(subprocess.check_output(['git','diff','--no-ext-diff'],cwd=ROOT,text=True,encoding='utf8'),encoding='utf8')
for name in ['PROJECT_STATE.md','CHANGELOG.md','MINDX_AUTOMATION_PLAN.md']:
    (OUT/'documents-before').mkdir(exist_ok=True)
    shutil.copy2(ROOT/name,OUT/'documents-before'/name)
gates=[('tsc',['npx.cmd','tsc','--noEmit','--incremental','false'])]
for stage in ['s1','s2','s3','s4','s5a','s5','s6','s7']:
    gates.append((stage,['npx.cmd','tsx',f'scripts/test-streamline-v340-{stage}.ts']))
gates += [('pii-adversarial',['npx.cmd','tsx',probe.as_posix()]),
          ('build',['npx.cmd','next','build','--webpack'])]
results=[]
try:
    for name,cmd in gates:
        started=time.time()
        try:
            with (OUT/(name+'.log')).open('w',encoding='utf8') as log:
                run=subprocess.run(cmd,cwd=BASE,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=900)
            code=run.returncode
        except subprocess.TimeoutExpired:
            code='TIMEOUT'
        record={'name':name,'command':' '.join(cmd).replace('npx.cmd','npx'),'exitCode':code,
                'seconds':round(time.time()-started,2),'startedEpoch':started,'cwd':str(BASE)}
        results.append(record)
        save('gates.json',results)
        print(json.dumps(record),flush=True)
finally:
    after=protected()
    prod_after=hashes([ROOT/p for p in EXPECTED])
    save('production-after.json',prod_after)
    save('preservation.json',{'countBefore':len(before),'countAfter':len(after),
        'changed':[p for p in before if before[p]!=after.get(p)],'added':sorted(set(after)-set(before)),
        'productionMatchesExpected':prod_after==EXPECTED,'productionBefore':prod_before,'productionAfter':prod_after,
        'sourceMirrorAfterMatches':hashes((ROOT/'src').rglob('*'))==hashes((BASE/'src').rglob('*'),BASE)})
    print('PRESERVATION '+json.dumps({'changed':[p for p in before if before[p]!=after.get(p)],
         'productionMatchesExpected':prod_after==EXPECTED}),flush=True)
