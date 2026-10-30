import hashlib, json, pathlib, shutil, subprocess, tempfile

root = pathlib.Path.cwd()
out = pathlib.Path(__file__).resolve().parent
files = sorted(p for d in ('src', 'scripts') for p in (root/d).rglob('*') if p.is_file())
files += [root/p for p in ('AGENTS.md','PROJECT_STATE.md','MINDX_AUTOMATION_PLAN.md','CHANGELOG.md','package.json','package-lock.json','tsconfig.json','next-env.d.ts')]
manifest = {p.relative_to(root).as_posix(): {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(), 'size':p.stat().st_size} for p in files}
(out/'source-before.json').write_text(json.dumps(manifest, indent=2), encoding='utf8')
for name,args in [('git-status-before.txt',['git','status','--short']),('working-tree.patch',['git','diff','--','src','scripts']),('head.txt',['git','rev-parse','HEAD'])]:
    (out/name).write_bytes(subprocess.check_output(args))
backup=out/'documents-before'; backup.mkdir(exist_ok=True)
for name in ('PROJECT_STATE.md','MINDX_AUTOMATION_PLAN.md','CHANGELOG.md'): shutil.copy2(root/name,backup/name)
mirror = pathlib.Path(tempfile.mkdtemp(prefix='codex-s6-r3-'))
for d in ('src','scripts'): shutil.copytree(root/d,mirror/d)
(mirror/'data/config').mkdir(parents=True)
for name in ('default-spck-thumbnail.png',):
    if (root/'data/config'/name).exists(): shutil.copy2(root/'data/config'/name,mirror/'data/config'/name)
for name in ('package.json','package-lock.json','tsconfig.json','next-env.d.ts','next.config.ts','next.config.js','next.config.mjs','postcss.config.mjs'):
    if (root/name).is_file(): shutil.copy2(root/name,mirror/name)
subprocess.run(['cmd','/c','mklink','/J',str(mirror/'node_modules'),str(root/'node_modules')],check=True,capture_output=True)
for name in ('repository-probe','independent-ui'):
    shutil.copy2(root/'docs/audits/v340/s6-round2'/f'{name}.ts.txt',mirror/f'{name}.ts')
(out/'mirror-path.txt').write_text(str(mirror),encoding='utf8')
# Reconstruct the two tracked Round 2 files from HEAD + the preserved patch.
baseline=pathlib.Path(tempfile.mkdtemp(prefix='codex-s6-r3-baseline-'))
tracked=['src/components/final-project/SubmitBar.tsx','src/components/final-project/StudentRow.tsx']
for name in tracked:
    target=baseline/name; target.parent.mkdir(parents=True,exist_ok=True)
    target.write_bytes(subprocess.check_output(['git','show','HEAD:'+name]))
patch=root/'docs/audits/v340/s6-round2/working-tree.patch'
subprocess.run(['git','apply','--unsafe-paths',*[f'--include={name}' for name in tracked],str(patch)],cwd=baseline,check=True,capture_output=True)
untracked={'src/lib/dashboard/today-tasks.ts':'src/lib/dashboard/today-tasks.ts.txt','scripts/test-streamline-v340-s6.ts':'scripts/test-streamline-v340-s6.ts.txt'}
for name,old in untracked.items():
    target=baseline/name; target.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(root/'docs/audits/v340/s6-round2/reviewed-untracked'/old,target)
import difflib
changes=[]
for name in tracked+list(untracked):
    changes.extend(difflib.unified_diff((baseline/name).read_text(encoding='utf8').splitlines(True),(root/name).read_text(encoding='utf8').splitlines(True),fromfile='round2/'+name,tofile='round3/'+name))
(out/'round2-to-round3.patch').write_text(''.join(changes),encoding='utf8')
print(json.dumps({'mirror':str(mirror),'protected_files':len(manifest),'owner_data_accessed':False}))
