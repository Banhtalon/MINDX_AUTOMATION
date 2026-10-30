import os, pathlib, shutil, subprocess, tempfile, json, time
root=pathlib.Path.cwd()
out=pathlib.Path(__file__).resolve().parent
build=pathlib.Path(tempfile.mkdtemp(prefix='codex-s6-r2-production-'))
for d in ('src',):shutil.copytree(root/d,build/d)
shutil.copytree(root/'data/config',build/'data/config')
for name in ('package.json','package-lock.json','tsconfig.json','next-env.d.ts','next.config.ts','postcss.config.mjs'):
    if (root/name).exists():shutil.copy2(root/name,build/name)
(build/'node_modules').mkdir()
for p in (root/'node_modules').iterdir():
    dest=build/'node_modules'/p.name
    if p.name=='next':shutil.copytree(p,dest)
    elif p.is_dir():subprocess.run(['cmd','/c','mklink','/J',str(dest),str(p)],check=True,capture_output=True)
    else:shutil.copy2(p,dest)
(out/'production-mirror.txt').write_text(str(build),encoding='utf8')
env=os.environ.copy()
env.pop('NODE_OPTIONS',None)
env.update(ALLOWED_LOCAL_DIRS=env['TEMP'],MINDX_DB_PATH=str(pathlib.Path(env['TEMP'])/'codex_s6_r2.sqlite'),MINDX_RUNNING_CLASSES_PATH=str(pathlib.Path(env['TEMP'])/'codex_s6_r2_classes.json'),GEMINI_API_KEY='audit-dummy-key-no-real-credential',NEXT_TELEMETRY_DISABLED='1')
start=time.time()
with (out/'production-build-physical-next.log').open('wb') as log:
    proc=subprocess.run(['node',str(build/'node_modules/next/dist/bin/next'),'build','--webpack'],cwd=build,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=300)
result={'exit':proc.returncode,'seconds':round(time.time()-start,2),'cwd':str(build),'command':'node node_modules/next/dist/bin/next build --webpack','note':'Physical copy of next package; other dependencies reused by junction; no product edits'}
(out/'production-build-result.json').write_text(json.dumps(result,indent=2),encoding='utf8')
print(json.dumps(result),flush=True)
