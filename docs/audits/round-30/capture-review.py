"""Record current source review, exact R29 diff and restored historical source availability."""
import datetime
import difflib
import hashlib
import json
from pathlib import Path
import subprocess

p=Path(__file__).resolve().parent
root=p.parents[2]
e=p/'evidence'
read=lambda f:json.loads(f.read_text(encoding='utf-8'))
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
def write(n,d):
    (e/n).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

t=(p.parent/'round-29/capture-static.py').read_text(encoding='utf-8')
t=t.replace('dictionaryTokenRegex','dictionaryContinuousScanner').replace('scalarDict.match(','while (idx < scalarDict.length)')
(p/'capture-static.py').write_text(t,encoding='utf-8',newline='\n')
subprocess.run(['python',str(p/'capture-static.py')],cwd=root,check=True)
media=(root/'src/lib/file-parsers/media-reader.ts').read_text(encoding='utf-8')
assert 'scalarDict.match(' not in media
assert 'const validateRawPdfDict' in media
current=read(e/'source-manifest.json')['files']
old=read(p.parent/'round-29/evidence/source-manifest.json')['files']
changed=[k for k,v in current.items() if old.get(k)!=v]
product=[k for k in changed if k.startswith(('src/','scripts/'))]
assert product==['src/lib/file-parsers/media-reader.ts'],product
assert current['src/lib/playwright/grade-worker.ts']==old['src/lib/playwright/grade-worker.ts']
write('changes-since-r29.json',{'productChanges':product,'otherDifferences':[k for k in changed if k not in product],
    'gradeWorkerUnchanged':True,'currentMediaSha256':sha(root/product[0]),'currentWorkerSha256':sha(root/'src/lib/playwright/grade-worker.ts')})
baselines=[]
for n in [28,29]:
    folder=p.parent/f'round-{n}'/'evidence'
    snap=Path(read(folder/'snapshot.json')['snapshot'])
    manifest=read(folder/'source-manifest.json')['files']
    files=[k for k in manifest if k.startswith(('src/','scripts/'))]
    mismatch=[k for k in files if not (snap/k).is_file() or sha(snap/k)!=manifest[k]['sha256']]
    assert not mismatch,(n,mismatch)
    baselines.append({'round':n,'snapshot':str(snap),'productFiles':len(files),'mismatches':mismatch,'sourceHashesMatchRecordedManifest':True,
        'sourceHashes':{k:sha(snap/k) for k in files}})
    if n==29:
        patch=''.join(difflib.unified_diff((snap/product[0]).read_text(encoding='utf-8').splitlines(True),media.splitlines(True),fromfile='R29/'+product[0],tofile='R30/'+product[0]))
        (e/'media-reader.since-r29.diff').write_text(patch,encoding='utf-8')
write('baseline-source-availability.json',baselines)
write('runtime-versions.json',{'node':read(e/'isolation.json')['nodeVersion'],'python':subprocess.check_output(['python','--version'],text=True).strip(),
    'packages':{name:read(root/'node_modules'/name/'package.json')['version'] for name in ['next','typescript','tsx','better-sqlite3','sharp','react','playwright']}})
print('Only media-reader.ts changed since R29. Restored R28/R29 source hashes verified.')
