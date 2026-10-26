"""Prepare an isolated audit copy; never execute product/test code in the source tree."""
import datetime, hashlib, json, os, pathlib, shutil, subprocess

ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT = ROOT / 'docs/audits/round-23'
def digest(p):
    return hashlib.file_digest(p.open('rb'), 'sha256').hexdigest()
def inventory(paths):
    return {p.relative_to(ROOT).as_posix(): {'sha256': digest(p), 'bytes': p.stat().st_size}
            for p in sorted(set(paths)) if p.is_file()}
def write(name, data):
    (OUT/name).write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

protected = [ROOT/'next-env.d.ts']
for n in range(12,23):
    protected.extend((ROOT/f'docs/audits/round-{n}').rglob('*'))
baseline = inventory(protected)
assert baseline['next-env.d.ts']['sha256'].upper() == 'B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000'
write('protected-hashes.json', {'before': baseline, 'after': None, 'unchanged': None})
source_paths = [p for p in ROOT.iterdir() if p.is_file() and not p.name.startswith('.env')]
for folder in ['src','scripts','data/config']:
    source_paths.extend((ROOT/folder).rglob('*'))
source = inventory(source_paths)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
snapshot = pathlib.Path(os.environ['TEMP'])/f'mindx-round23-{stamp}-mindx-round22-compat-mindx-round21-mindx-round20-compat'/'snapshot'
snapshot.mkdir(parents=True)
git = subprocess.run(['git','status','--short','--untracked-files=all'], cwd=ROOT, capture_output=True, check=True).stdout
(OUT/'git-status.before.txt').write_bytes(git)
head = subprocess.run(['git','rev-parse','HEAD'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
write('source-state.json', {'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'root': str(ROOT), 'snapshot': str(snapshot), 'head': head, 'files': source, 'manifestHash': hashlib.sha256(json.dumps(source,sort_keys=True).encode()).hexdigest()})
for p in ROOT.iterdir():
    if p.is_file() and not p.name.startswith('.env'):
        shutil.copy2(p,snapshot/p.name)
for name in ['src','scripts','docs','node_modules']:
    shutil.copytree(ROOT/name,snapshot/name, ignore=shutil.ignore_patterns('__pycache__'), symlinks=False)
shutil.copytree(ROOT/'data/config',snapshot/'data/config')
absent = {name: not (snapshot/name).exists() for name in ['.env','.env.local','.git','.next','playwright-auth','temp_submissions','data/mindx_bot.db']}
matches = all(digest(snapshot/name)==info['sha256'] for name,info in source.items())
protected_matches = all(digest(snapshot/name)==info['sha256'] for name,info in baseline.items())
write('snapshot-check.json', {'snapshot': str(snapshot), 'sourceMatches':matches, 'protectedMatches':protected_matches, 'excludedAbsent':absent, 'nodeModulesCopiedNotLinked': not (snapshot/'node_modules').is_symlink()})
assert matches and protected_matches and all(absent.values())
print(str(snapshot),flush=True)
