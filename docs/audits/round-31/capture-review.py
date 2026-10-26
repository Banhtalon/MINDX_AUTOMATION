"""Read-only source/baseline capture, with output strictly under this audit."""
from pathlib import Path
import datetime
import difflib
import hashlib
import json
out=Path(__file__).resolve().parent
root=out.parents[2]
e=out/'evidence'
read=lambda p:json.loads(p.read_text(encoding='utf-8'))
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,d):(e/n).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
current=read(e/'source-manifest.json')['files']
previous=read(out.parent/'round-30/evidence/source-manifest.json')['files']
diff=[k for k in current.keys()&previous.keys() if current[k]['sha256']!=previous[k]['sha256']]
write('changes-since-r30.json',{'productChanges':sorted(k for k in diff if k.startswith(('src/','scripts/'))),
    'otherDifferences':sorted(k for k in diff if not k.startswith(('src/','scripts/'))),
    'added':sorted(current.keys()-previous.keys()),'removed':sorted(previous.keys()-current.keys()),
    'gradeWorkerUnchanged':current['src/lib/playwright/grade-worker.ts']==previous['src/lib/playwright/grade-worker.ts']})
old_snapshot=Path(read(out.parent/'round-30/evidence/snapshot.json')['snapshot'])
file='src/lib/file-parsers/media-reader.ts'
old=old_snapshot/file
assert old.is_file() and sha(old)==previous[file]['sha256']
(e/'baseline').mkdir(exist_ok=True)
(e/'baseline/media-reader.r30.ts').write_bytes(old.read_bytes())
write('baseline-provenance.json',{'round':30,'origin':str(old),'sha256':sha(old),'manifestSha256':previous[file]['sha256'],
    'hashVerified':True,'artifact':'baseline/media-reader.r30.ts','capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
difftext=''.join(difflib.unified_diff(old.read_text(encoding='utf-8').splitlines(True),(root/file).read_text(encoding='utf-8').splitlines(True),fromfile='R30/media-reader.ts',tofile='R31/media-reader.ts'))
(e/'media-reader.since-r30.diff').write_text(difftext,encoding='utf-8')
write('source-review-notes.json',{'reviewScope':'TASK-5.1..5.5, connected security/queue/DB/AI guards; one local teacher, sequential browser automation; out-of-order draft/AI/UI responses considered.',
    'changedSource':file,'currentSha256':sha(root/file),'baselineSha256':sha(old),
    'patchAssessment':'Raw parser consumes slash then returns NAME even for empty body; raw dictionary keys may be empty, duplicates still rejected. Scalar tokenizer retains slash and allows empty Name keys/values; missing value and stray delimiter checks remain. Only this product file changed from the R30 manifest.',
    'constraints':'No plan/checklist changes, no actual credentials/database/submissions/browser/LMS/Gemini; source-only decision.'})
print(json.dumps({'changedFiles':diff,'baselineVerified':True,'diff':difftext}))
