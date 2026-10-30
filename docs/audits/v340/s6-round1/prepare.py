import hashlib, json, os, pathlib, shutil, subprocess, tempfile

root = pathlib.Path.cwd()
out = pathlib.Path(__file__).resolve().parent
files = sorted(p for d in ('src', 'scripts') for p in (root/d).rglob('*') if p.is_file())
files += [root/p for p in ('AGENTS.md','PROJECT_STATE.md','MINDX_AUTOMATION_PLAN.md','CHANGELOG.md','package.json','package-lock.json','tsconfig.json','next-env.d.ts')]
manifest = {str(p.relative_to(root)): {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(), 'size':p.stat().st_size} for p in files}
(out/'source-before.json').write_text(json.dumps(manifest, indent=2), encoding='utf8')
(out/'git-status-before.txt').write_bytes(subprocess.check_output(['git','status','--short']))
(out/'working-tree.patch').write_bytes(subprocess.check_output(['git','diff','--','src','scripts']))
(out/'head.txt').write_bytes(subprocess.check_output(['git','rev-parse','HEAD']))
mirror = pathlib.Path(tempfile.mkdtemp(prefix='codex-s6-r1-'))
for d in ('src','scripts'):
    shutil.copytree(root/d, mirror/d)
shutil.copytree(root/'data/config', mirror/'data/config')
for p in root.iterdir():
    if p.is_file() and (p.suffix in ('.md','.json','.ts','.mjs','.js','.cjs') or p.name == '.env.example'):
        shutil.copy2(p, mirror/p.name)
for p in (root/'docs').rglob('*.md'):
    dest=mirror/p.relative_to(root); dest.parent.mkdir(parents=True,exist_ok=True); shutil.copy2(p,dest)
subprocess.run(['cmd','/c','mklink','/J',str(mirror/'node_modules'),str(root/'node_modules')],check=True,capture_output=True)
plan=pathlib.Path(r'C:\Users\QQ\.gemini\antigravity\brain\2dc5f134-f73b-44e2-9d14-6c8333eb3c3b\STREAMLINE_PLAN_v340.md')
shutil.copy2(plan,out/'approved-plan.source.md')
(out/'mirror-path.txt').write_text(str(mirror),encoding='utf8')
print(json.dumps({'mirror':str(mirror),'protected_files':len(manifest),'owner_data_accessed':False}))
