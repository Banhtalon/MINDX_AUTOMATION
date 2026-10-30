import pathlib,os,json,shutil,subprocess,time
out=pathlib.Path(__file__).resolve().parent
info=json.loads((out/'isolation.json').read_text(encoding='utf8'))
base=pathlib.Path(info['temp']); root=pathlib.Path(info['root']); dest=base/'build-native'
dest.mkdir(exist_ok=True)
for folder in ['src','public','data/config']:
    if (base/'tsc'/folder).exists():shutil.copytree(base/'tsc'/folder,dest/folder,dirs_exist_ok=True)
for p in (base/'tsc').iterdir():
    if p.is_file() and p.name!='adversarial-probe.cjs':shutil.copy2(p,dest/p.name)
modules=dest/'node_modules';modules.mkdir(exist_ok=True)
# Next and its native compiler must share a real C: path; a cross-drive junction
# produces invalid webpack paths, while preserve-symlinks duplicates SWC state.
for name in ['next','@next']:
    shutil.copytree(root/'node_modules'/name,modules/name,dirs_exist_ok=True)
for p in (root/'node_modules').iterdir():
    if p.is_dir() and p.name not in ['next','@next','.bin']:
        subprocess.run(['powershell','-NoProfile','-Command',f"New-Item -ItemType Junction -Path '{modules/p.name}' -Target '{p}' | Out-Null"],capture_output=True,check=True)
(modules/'.bin').mkdir(exist_ok=True)
shutil.copy2(root/'node_modules/.bin/next.cmd',modules/'.bin/next.cmd')
env=os.environ.copy();env.update(ALLOWED_LOCAL_DIRS=str(dest),MINDX_DB_PATH=str(dest/'data/test.db'),MINDX_RUNNING_CLASSES_PATH=str(dest/'data/running_classes.json'),NODE_OPTIONS='--require='+str(base/'network-guard.cjs'),NEXT_TELEMETRY_DISABLED='1')
for k in ['GEMINI_API_KEY','LMS_PASSWORD','TEACHING_PASSWORD']:env.pop(k,None)
start=time.time()
with (out/'production-build-native.log').open('w',encoding='utf8') as log:
    r=subprocess.run(['npx.cmd','next','build','--webpack'],cwd=dest,env=env,stdout=log,stderr=subprocess.STDOUT)
record={'command':'npx next build --webpack','exitCode':r.returncode,'seconds':round(time.time()-start,2),'cwd':str(dest),'environment':{k:env[k] for k in ['ALLOWED_LOCAL_DIRS','MINDX_DB_PATH','MINDX_RUNNING_CLASSES_PATH']},'adaptation':'Next and @next copied inside TEMP; no source/config changes, no skipped type checks'}
(out/'production-build-native.json').write_text(json.dumps(record,indent=2),encoding='utf8');print(json.dumps(record),flush=True)
