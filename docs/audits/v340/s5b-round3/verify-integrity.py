import pathlib,json,hashlib,subprocess,shutil
out=pathlib.Path(__file__).resolve().parent
root=out.parents[3]
manifest=json.loads((out/'source-before.json').read_text(encoding='utf8'))
results=[]
for rel,before in manifest.items():
    p=root/rel
    after={'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'size':p.stat().st_size,'mtime_ns':p.stat().st_mtime_ns} if p.exists() else None
    results.append({'path':rel,'same':before==after,'before':before,'after':after})
source=[r for r in results if r['path'].startswith(('src\\','scripts\\'))]
extras=[str(p.relative_to(root)) for d in ('src','scripts') for p in (root/d).rglob('*') if p.is_file() and str(p.relative_to(root)) not in manifest]
mirror=pathlib.Path((out/'mirror-path.txt').read_text(encoding='utf8'))
mirror_source=[{'path':r['path'],'same':hashlib.sha256((mirror/r['path']).read_bytes()).hexdigest()==r['before']['sha256']} for r in source]
summary={'source_count':len(source),'source_unchanged':sum(r['same'] for r in source),'extra_source_files':extras,'mirror_sources_match_snapshot':all(r['same'] for r in mirror_source),'other_changed':[r['path'] for r in results if not r['same'] and r not in source],'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()}
(out/'source-integrity.json').write_text(json.dumps({'summary':summary,'files':results,'mirror_sources':mirror_source},indent=2),encoding='utf8')
(out/'git-status-final.txt').write_bytes(subprocess.check_output(['git','status','--short'],cwd=root))
shutil.copy2(root/'scripts/test-streamline-v340-s5.ts',out/'test-streamline-v340-s5.source.txt')
print(json.dumps(summary))
assert all(r['same'] for r in source) and not extras and summary['mirror_sources_match_snapshot']
