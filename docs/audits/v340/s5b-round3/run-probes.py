import os,pathlib,subprocess,shutil,json,time,difflib
out=pathlib.Path(__file__).resolve().parent
root=out.parents[3]
mirror=pathlib.Path((out/'mirror-path.txt').read_text(encoding='utf8'))
target=mirror/'docs/audits/v340/s5b-round3'
target.mkdir(parents=True,exist_ok=True)
for name in ('build-probe.cjs','wrapper.js.txt','checks.ts.txt','matrix-checks.ts.txt','reset-checks.ts.txt','repository-probe.ts'):
    shutil.copy2(out/name,target/name)
prior=pathlib.Path((root/'docs/audits/v340/s5b-round2/mirror-path.txt').read_text(encoding='utf8'))
diff=[]
for rel in ('src/components/final-project/useSpckWorkflow.ts','src/components/final-project/SubmitBar.tsx','scripts/test-streamline-v340-s5.ts'):
    diff+=list(difflib.unified_diff((prior/rel).read_text(encoding='utf8').splitlines(True),(mirror/rel).read_text(encoding='utf8').splitlines(True),fromfile='round2/'+rel,tofile='round3/'+rel))
(out/'round2-to-round3.patch').write_text(''.join(diff),encoding='utf8')
for checks,name in [('checks.ts.txt','independent-probe.ts'),('matrix-checks.ts.txt','matrix-probe.ts'),('reset-checks.ts.txt','reset-probe.ts')]:
    subprocess.run(['node',str(target/'build-probe.cjs'),checks,name],cwd=mirror,check=True)
    shutil.copy2(target/name,out/name)
for name in ('reset-probe','independent-probe','matrix-probe','repository-probe'):
    if name=='repository-probe':
        deadline=time.time()+360
        while len((out/'gates.jsonl').read_text(encoding='utf8').splitlines())<17:
            if time.time()>deadline:raise TimeoutError('Wait for gates before using the shared isolated database')
            time.sleep(2)
    env=os.environ.copy()
    env.update(ALLOWED_LOCAL_DIRS=env['TEMP'],MINDX_DB_PATH=str(pathlib.Path(env['TEMP'])/'codex_s5b_r3.db'),MINDX_RUNNING_CLASSES_PATH=str(pathlib.Path(env['TEMP'])/'codex_s5b_r3_classes.json'),S5B_R3_EVIDENCE=str(out),GEMINI_API_KEY='audit-dummy-no-real-key',NEXT_TELEMETRY_DISABLED='1')
    start=time.time()
    with (out/(name+'.log')).open('wb') as f:
        try:
            code=subprocess.run(['npx.cmd','tsx',str(target/(name+'.ts'))],cwd=mirror,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=180).returncode
        except subprocess.TimeoutExpired:
            code='TIMEOUT'
    item={'probe':name,'exit':code,'seconds':round(time.time()-start,2),'cwd':str(mirror)}
    with (out/'probes.jsonl').open('a',encoding='utf8') as f:f.write(json.dumps(item)+'\n')
    print(json.dumps(item),flush=True)
