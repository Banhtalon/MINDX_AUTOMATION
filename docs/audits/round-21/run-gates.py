"""All commands, including npm/npx/build, run only in the copied snapshot."""
import datetime, hashlib, json, os, pathlib, shutil, subprocess, sys, time
OUT = pathlib.Path(__file__).resolve().parent
state = json.loads((OUT/'source-state.json').read_text(encoding='utf-8'))
SNAP = pathlib.Path(state['snapshot'])
assert SNAP.name == 'snapshot' and 'mindx-round21-' in str(SNAP) and str(SNAP).startswith(os.environ['TEMP'])
env = {k:v for k,v in os.environ.items() if k.upper() in {'PATH','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','TEMP','TMP','LOCALAPPDATA','APPDATA','USERPROFILE','PROGRAMFILES','PROGRAMFILES(X86)','PROGRAMDATA','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE'}}
env.update({'NEXT_TELEMETRY_DISABLED':'1','npm_config_offline':'true','npm_config_audit':'false','npm_config_fund':'false','CI':'1','NODE_OPTIONS':'--require="'+(SNAP/'docs/audits/round-19/network-guard.cjs').as_posix()+'"'})
commands = [
 ('round20','node docs/audits/round-20/verify-independent.mjs','docs/audits/round-20/independent-results.json'),
 ('round12','node docs/audits/round-12/verify-independent.mjs','docs/audits/round-12/independent-results.json'),
 ('round13','node docs/audits/round-13/verify-independent.mjs','docs/audits/round-13/independent-results.json'),
 ('round16','node docs/audits/round-16/verify-independent.mjs','docs/audits/round-16/independent-results.json'),
 ('round17','node docs/audits/round-17/verify-independent.mjs','docs/audits/round-17/independent-results.json'),
 ('phase4','npx tsx scripts/test-phase4-codex-repros.ts',None),
 ('phase5','npx tsx scripts/test-phase5.ts',None),
 ('typecheck','npx tsc --noEmit --incremental false',None),
 ('build','npm run build',None),
]
if len(sys.argv)>1 and sys.argv[1]=='round21':
    shutil.copy2(OUT/'verify-independent.mjs',SNAP/'docs/audits/round-21/verify-independent.mjs')
    commands=[('round21','node docs/audits/round-21/verify-independent.mjs','docs/audits/round-21/independent-results.json')]
receipts = json.loads((OUT/'commands.json').read_text(encoding='utf-8')) if (OUT/'commands.json').exists() else []
for name,command,result_path in commands:
    start_epoch=time.time()
    start=datetime.datetime.now(datetime.timezone.utc).isoformat()
    attempt=1+sum(r['name']==name for r in receipts)
    log=OUT/(name+'.attempt-'+str(attempt)+'.log')
    print('START '+name,flush=True)
    with log.open('wb') as f:
        try:
            run=subprocess.run([env['COMSPEC'],'/d','/s','/c',command],cwd=SNAP,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=900)
            code=run.returncode
        except subprocess.TimeoutExpired:
            code='TIMEOUT'
    receipt={'name':name,'command':command,'cwd':str(SNAP),'startedAt':start,'endedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':code,'log':log.name,'logSha256':hashlib.sha256(log.read_bytes()).hexdigest()}
    if name=='round21': receipt['scriptSha256']=hashlib.sha256((SNAP/'docs/audits/round-21/verify-independent.mjs').read_bytes()).hexdigest()
    if result_path and (SNAP/result_path).exists() and (SNAP/result_path).stat().st_mtime >= start_epoch:
        dest=name+'.attempt-'+str(attempt)+'-results.json'
        shutil.copy2(SNAP/result_path,OUT/dest)
        receipt['results']=dest
        canonical='independent-results.json' if name=='round21' else name+'-results.json'
        shutil.copy2(SNAP/result_path,OUT/canonical)
    receipts.append(receipt)
    (OUT/'commands.json').write_text(json.dumps(receipts,indent=2)+'\n',encoding='utf-8')
    print('END '+name+' '+str(code),flush=True)
