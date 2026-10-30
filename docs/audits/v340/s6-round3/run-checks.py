import json, os, pathlib, subprocess, time

root=pathlib.Path.cwd()
out=pathlib.Path(__file__).resolve().parent
mirror=pathlib.Path((out/'mirror-path.txt').read_text(encoding='utf8'))
env=os.environ.copy()
env.update(ALLOWED_LOCAL_DIRS=env['TEMP'],MINDX_DB_PATH=str(mirror/'audit.sqlite'),MINDX_RUNNING_CLASSES_PATH=str(mirror/'classes.json'),GEMINI_API_KEY='audit-dummy-no-real-credential',NEXT_TELEMETRY_DISABLED='1',AUDIT_OUT=str(out))
checks=[('tsc',root,['tsc','--noEmit','--incremental','false']),('repository-probe',mirror,['tsx','repository-probe.ts']),('independent-ui',mirror,['tsx','independent-ui.ts']),('test-streamline-v340-s6',mirror,['tsx','scripts/test-streamline-v340-s6.ts'])]
for name,cwd,args in checks:
    start=time.time()
    with (out/(name+'.log')).open('wb') as f:
        try: code=subprocess.run(['npx.cmd',*args],cwd=cwd,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=300).returncode
        except subprocess.TimeoutExpired: code='TIMEOUT'
    result={'name':name,'command':['npx',*args],'cwd':str(cwd),'exit':code,'seconds':round(time.time()-start,2),'isolation':{k:env[k] for k in ('ALLOWED_LOCAL_DIRS','MINDX_DB_PATH','MINDX_RUNNING_CLASSES_PATH')}}
    with (out/'checks.jsonl').open('a',encoding='utf8') as f: f.write(json.dumps(result)+'\n')
    print(json.dumps(result),flush=True)
    for obsname in ('repository-observations.json','ui-observations.json'):
        if (out/obsname).exists():
            obs=json.loads((out/obsname).read_text(encoding='utf8'))
            print(json.dumps({'file':obsname,'count':len(obs),'pass':sum(x['pass'] for x in obs),'failed':[x['id'] for x in obs if not x['pass']]}),flush=True)
