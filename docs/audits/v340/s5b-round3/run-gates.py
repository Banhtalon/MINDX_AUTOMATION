import os, pathlib, subprocess, json, time
out=pathlib.Path(__file__).resolve().parent
mirror=pathlib.Path((out/'mirror-path.txt').read_text(encoding='utf8'))
gates=[('tsc',['tsc','--noEmit','--incremental','false'])]
gates += [(name,['tsx','scripts/'+name+'.ts']) for name in ('test-streamline-v340-s5','test-streamline-v340-s5a','test-spck-v270','test-spck-v272','test-phase6','test-phase5','test-phase7','test-phase4-codex-repros','test-lms-reliability-v280','test-session14-v290','test-teaching-project-v320','test-report-card-v330','test-streamline-v340-s1','test-streamline-v340-s2','test-streamline-v340-s3','test-streamline-v340-s4')]
for name,args in gates:
    env=os.environ.copy()
    env.update(ALLOWED_LOCAL_DIRS=env['TEMP'],MINDX_DB_PATH=str(pathlib.Path(env['TEMP'])/'codex_s5b_r3.db'),MINDX_RUNNING_CLASSES_PATH=str(pathlib.Path(env['TEMP'])/'codex_s5b_r3_classes.json'),GEMINI_API_KEY='audit-dummy-key-no-real-credential',NEXT_TELEMETRY_DISABLED='1')
    start=time.time()
    with (out/(name+'.log')).open('wb') as f:
        try:
            proc=subprocess.run(['npx.cmd',*args],cwd=mirror,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=300)
            code=proc.returncode
        except subprocess.TimeoutExpired:
            code='TIMEOUT'
    item={'gate':name,'args':['npx',*args],'exit':code,'seconds':round(time.time()-start,2),'cwd':str(mirror)}
    with (out/'gates.jsonl').open('a',encoding='utf8') as f: f.write(json.dumps(item)+'\n')
    print(json.dumps(item),flush=True)
