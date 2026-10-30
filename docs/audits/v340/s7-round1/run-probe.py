import pathlib, os, json, shutil, subprocess, sys, time
out=pathlib.Path(__file__).resolve().parent
info=json.loads((out/'isolation.json').read_text(encoding='utf8'))
mirror=pathlib.Path(info['temp'])/'tsc'
env=os.environ.copy()
env.update(ALLOWED_LOCAL_DIRS=str(mirror),MINDX_DB_PATH=str(mirror/'data/probe.db'),MINDX_RUNNING_CLASSES_PATH=str(mirror/'data/probe-running.json'),NODE_OPTIONS='--require='+str(pathlib.Path(info['temp'])/'network-guard.cjs'),NEXT_TELEMETRY_DISABLED='1',AUDIT_RESULT_OUT=str(out/'adversarial-results.json'),AUDIT_HTML_OUT=str(out/'rendered-html.json'))
for k in ['GEMINI_API_KEY','LMS_PASSWORD','TEACHING_PASSWORD']: env.pop(k,None)
if '--build' in sys.argv:
    cmd=['npx.cmd','next','build','--webpack']; name='production-build'
    env['NODE_OPTIONS']+=' --preserve-symlinks --preserve-symlinks-main'
    if (out/(name+'.log')).exists(): shutil.copy2(out/(name+'.log'),out/(name+'.attempt1.log'))
    if (out/(name+'.json')).exists(): shutil.copy2(out/(name+'.json'),out/(name+'.attempt1.json'))
else:
    shutil.copy2(out/'adversarial-probe.cjs',mirror/'adversarial-probe.cjs')
    cmd=['npx.cmd','tsx','adversarial-probe.cjs']; name='adversarial-probe'
start=time.time()
with (out/(name+'.log')).open('w',encoding='utf8') as log:
    result=subprocess.run(cmd,cwd=mirror,env=env,stdout=log,stderr=subprocess.STDOUT)
record={'command':' '.join(cmd).replace('npx.cmd','npx'),'exitCode':result.returncode,'seconds':round(time.time()-start,2),'cwd':str(mirror),'environment':{k:env[k] for k in ['ALLOWED_LOCAL_DIRS','MINDX_DB_PATH','MINDX_RUNNING_CLASSES_PATH']}}
(out/(name+'.json')).write_text(json.dumps(record,indent=2),encoding='utf8')
print(json.dumps(record),flush=True)
sys.exit(result.returncode)
