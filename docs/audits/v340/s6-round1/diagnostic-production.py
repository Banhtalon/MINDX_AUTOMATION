import os,pathlib,json,subprocess,time,sqlite3,socket,urllib.request
out=pathlib.Path(__file__).resolve().parent
build=pathlib.Path((out/'production-mirror.txt').read_text(encoding='utf8'))
config=build/'next.config.ts'
original=config.read_text(encoding='utf8')
(out/'production-config-before.ts.txt').write_text(original,encoding='utf8')
config.write_text(original.replace('serverExternalPackages:', 'typescript: { ignoreBuildErrors: true },\n  serverExternalPackages:'),encoding='utf8')
env=os.environ.copy()
env.update(ALLOWED_LOCAL_DIRS=env['TEMP'],MINDX_DB_PATH=str(pathlib.Path(env['TEMP'])/'codex_s6_r1.sqlite'),MINDX_RUNNING_CLASSES_PATH=str(pathlib.Path(env['TEMP'])/'codex_s6_r1_classes.json'),GEMINI_API_KEY='audit-dummy-key-no-real-credential',NEXT_TELEMETRY_DISABLED='1')
env.pop('NODE_OPTIONS',None)
with (out/'diagnostic-build.log').open('wb') as log:
    result=subprocess.run(['node',str(build/'node_modules/next/dist/bin/next'),'build','--webpack'],cwd=build,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=300)
meta={'exit':result.returncode,'diagnostic_only':True,'config_exception':'TEMP mirror next.config.ts typescript.ignoreBuildErrors=true; original config/source unchanged','build_dir':str(build)}
(out/'diagnostic-build-result.json').write_text(json.dumps(meta,indent=2),encoding='utf8')
print(json.dumps(meta),flush=True)
if result.returncode:raise SystemExit(1)
manifest=json.loads((build/'.next/prerender-manifest.json').read_text(encoding='utf8'))
(out/'prerender-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')
db=sqlite3.connect(env['MINDX_DB_PATH'])
db.execute("UPDATE classes_sessions SET sessionNumber=12 WHERE classId='VT-C4K-JSB88'")
db.commit();db.close()
pathlib.Path(env['MINDX_RUNNING_CLASSES_PATH']).write_text(json.dumps([{'classCode':'VT-C4K-JSB88','className':'SYNTHETIC_BUILD_FIXTURE','status':'Running','currentSessionNumber':12}]),encoding='utf8')
with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
with (out/'diagnostic-server.log').open('wb') as log:
    server=subprocess.Popen(['node',str(build/'node_modules/next/dist/bin/next'),'start','-H','127.0.0.1','-p',str(port)],cwd=build,env=env,stdout=log,stderr=subprocess.STDOUT)
    try:
        for i in range(80):
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{port}/',timeout=2) as r:html=r.read().decode('utf8');break
            except Exception:time.sleep(.25)
        else:raise RuntimeError('Diagnostic localhost server did not start')
        (out/'dashboard-production-after-db-change.html').write_text(html,encoding='utf8')
        observation={'id':'PROD01-dashboard-fresh-after-db-change','expected_session':12,'rendered_session_1_href_present':'/session-comments?classId=VT-C4K-JSB88&amp;sessionNumber=1' in html,'rendered_session_12_href_present':'/session-comments?classId=VT-C4K-JSB88&amp;sessionNumber=12' in html,'prerendered_root':'/' in manifest.get('routes',{}),'diagnostic_only':True}
        (out/'production-observation.json').write_text(json.dumps(observation,indent=2),encoding='utf8')
        print(json.dumps(observation),flush=True)
    finally:
        server.terminate()
        try:server.wait(timeout=10)
        except subprocess.TimeoutExpired:server.kill()
config.write_text(original,encoding='utf8')
