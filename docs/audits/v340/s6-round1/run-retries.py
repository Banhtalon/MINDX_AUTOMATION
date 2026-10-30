import os, pathlib, subprocess, json, time
out=pathlib.Path(__file__).resolve().parent
mirror=pathlib.Path((out/'mirror-path.txt').read_text(encoding='utf8'))
root=pathlib.Path.cwd()
for name in ('test-phase7','test-streamline-v340-s5a'):
    env=os.environ.copy()
    env.update(ALLOWED_LOCAL_DIRS=env['TEMP'],MINDX_DB_PATH=str(pathlib.Path(env['TEMP'])/'codex_s6_r1.sqlite'),MINDX_RUNNING_CLASSES_PATH=str(pathlib.Path(env['TEMP'])/'codex_s6_r1_classes.json'),GEMINI_API_KEY='audit-dummy-key-no-real-credential',NEXT_TELEMETRY_DISABLED='1',GIT_DIR=str(root/'.git'),GIT_WORK_TREE=str(mirror))
    start=time.time()
    with (out/(name+'.rerun.log')).open('wb') as f:
        proc=subprocess.run(['npx.cmd','tsx','scripts/'+name+'.ts'],cwd=mirror,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=300)
    item={'gate':name,'exit':proc.returncode,'seconds':round(time.time()-start,2),'note':'Restored launcher fixtures; GIT_DIR provided for read-only git show of S5a baseline; product test unchanged'}
    with (out/'gate-retries.jsonl').open('a',encoding='utf8') as f:f.write(json.dumps(item)+'\n')
    print(json.dumps(item),flush=True)
