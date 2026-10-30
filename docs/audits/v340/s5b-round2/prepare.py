import os, pathlib, json, hashlib, shutil, tempfile, subprocess
root = pathlib.Path.cwd()
out = root / 'docs/audits/v340/s5b-round2'
out.mkdir(parents=True, exist_ok=True)
files = sorted([p for d in ('src', 'scripts') for p in (root/d).rglob('*') if p.is_file()])
files += [root/p for p in ('AGENTS.md','PROJECT_STATE.md','MINDX_AUTOMATION_PLAN.md','CHANGELOG.md','package.json','tsconfig.json')]
manifest = {str(p.relative_to(root)): {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(), 'size':p.stat().st_size, 'mtime_ns':p.stat().st_mtime_ns} for p in files}
(out/'source-before.json').write_text(json.dumps(manifest, indent=2), encoding='utf8')
(out/'git-status-before.txt').write_bytes(subprocess.check_output(['git','status','--short']))
(out/'working-tree.patch').write_bytes(subprocess.check_output(['git','diff','--','src','scripts']))
mirror = pathlib.Path(tempfile.mkdtemp(prefix='codex-s5b-r2-'))
for d in ('src','scripts'):
    shutil.copytree(root/d, mirror/d)
shutil.copytree(root/'data/config', mirror/'data/config')
for p in root.iterdir():
    if p.is_file() and (p.suffix in ('.md','.json','.ts','.mjs','.js','.cjs','.bat','.command') or p.name in ('.gitignore','.env.example')):
        shutil.copy2(p, mirror/p.name)
for p in (root/'docs').rglob('*.md'):
    dest=mirror/p.relative_to(root); dest.parent.mkdir(parents=True,exist_ok=True); shutil.copy2(p,dest)
for name in ('node_modules','.git'):
    subprocess.run(['cmd','/c','mklink','/J',str(mirror/name),str(root/name)],check=True,capture_output=True)
(out/'mirror-path.txt').write_text(str(mirror),encoding='utf8')
print(json.dumps({'mirror':str(mirror),'protected_files':len(manifest),'head':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()}))
