import json, os, pathlib, shutil, subprocess, time
out=pathlib.Path(__file__).resolve().parent
info=json.loads((out/'isolation.json').read_text(encoding='utf8'))
base=pathlib.Path(info['temp']); root=pathlib.Path(info['root']); dest=pathlib.Path(os.environ['TEMP'])/('mindx-s8-build-'+str(int(time.time())))
dest.mkdir()
for folder in ['src','public','data/config']:
    if (base/folder).exists(): shutil.copytree(base/folder,dest/folder)
for p in base.iterdir():
    if p.is_file() and p.suffix in ['.json','.mjs','.js','.cjs','.ts','.md']:
        shutil.copy2(p,dest/p.name)
modules=dest/'node_modules'; modules.mkdir()
for name in ['next','@next']:
    shutil.copytree(root/'node_modules'/name,modules/name)
for p in (root/'node_modules').iterdir():
    if p.is_dir() and p.name not in ['next','@next','.bin']:
        subprocess.run(['powershell','-NoProfile','-Command',f"New-Item -ItemType Junction -Path '{modules/p.name}' -Target '{p}' | Out-Null"],capture_output=True,check=True)
(modules/'.bin').mkdir()
shutil.copy2(root/'node_modules/.bin/next.cmd',modules/'.bin/next.cmd')
env=os.environ.copy(); env.update(ALLOWED_LOCAL_DIRS=os.environ['TEMP'],
    MINDX_DB_PATH=str(pathlib.Path(os.environ['TEMP'])/'mindx_codex_s8_final.db'),
    MINDX_RUNNING_CLASSES_PATH=str(pathlib.Path(os.environ['TEMP'])/'mindx_codex_s8_final_rc.json'),
    GEMINI_API_KEY='test-s8-dummy-key',NODE_OPTIONS='--require='+str(base/'network-guard.cjs'),NEXT_TELEMETRY_DISABLED='1')
for k in ['LMS_PASSWORD','TEACHING_PASSWORD']: env.pop(k,None)
start=time.time()
with (out/'build-native.log').open('w',encoding='utf8') as log:
    r=subprocess.run(['npx.cmd','next','build','--webpack'],cwd=dest,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=900)
record={'command':'npx next build --webpack','exitCode':r.returncode,'seconds':round(time.time()-start,2),'cwd':str(dest),
    'environment':{k:env[k] for k in ['ALLOWED_LOCAL_DIRS','MINDX_DB_PATH','MINDX_RUNNING_CLASSES_PATH','GEMINI_API_KEY']},
    'adaptation':'Next and @next physically copied to C: TEMP; remaining packages linked; source/config unchanged; no skipped type checks'}
(out/'build-native.json').write_text(json.dumps(record,indent=2),encoding='utf8')
print(json.dumps(record),flush=True)
