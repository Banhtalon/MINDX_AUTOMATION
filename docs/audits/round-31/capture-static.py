"""Record a scoped read-only source review; no claim of live LMS acceptance."""
import hashlib
import json
from pathlib import Path
p=Path(__file__).resolve().parent
root=p.parents[2]
files=['src/lib/playwright/browser-manager.ts','src/lib/queue/task-queue.ts',
    'src/app/api/homework-grader/save-lms/route.ts','src/app/api/homework-grader/download-and-grade/route.ts',
    'src/lib/file-parsers/index.ts','src/lib/playwright/download-submissions.ts','src/lib/playwright/grade-worker.ts',
    'src/lib/file-parsers/media-reader.ts','src/lib/playwright/network-interceptor.ts','src/lib/db/sqlite.ts',
    'src/lib/gemini/homework-grader.ts','src/lib/gemini/score-auditor.ts','src/app/api/homework-grader/approve/route.ts',
    'src/app/api/homework-grader/submissions/route.ts','src/components/homework-auto-grader-tab.tsx','src/app/homework-grader/page.tsx']
source={f:(root/f).read_text(encoding='utf-8') for f in files}
clients={f:{'sensitiveEnvironmentReference':any(k in source[f] for k in ['TEACHING_PASSWORD','LMS_PASSWORD','GEMINI_API_KEY'])} for f in files[-2:]}
assert not any(v['sensitiveEnvironmentReference'] for v in clients.values())
pkg=json.loads((root/'package.json').read_text(encoding='utf-8'))
assert all('127.0.0.1' in pkg['scripts'][k] for k in ['dev','start'])
needles={'singlePersistentContext':('src/lib/playwright/browser-manager.ts','chromium.launchPersistentContext'),
    'saveQueue':('src/app/api/homework-grader/save-lms/route.ts','taskQueue.enqueue'),
    'downloadQueue':('src/app/api/homework-grader/download-and-grade/route.ts','taskQueue.enqueue'),
    'fileAllowlist':('src/lib/file-parsers/index.ts','const safeResolvedPath = assertPathAllowed'),
    'http200or201':('src/lib/playwright/network-interceptor.ts','status !== 200 && status !== 201'),
    'toast':('src/lib/playwright/network-interceptor.ts','dismissForbiddenToast(maxAttempts'),
    'dictionaryParser':('src/lib/file-parsers/media-reader.ts','const parsePdfDictEntries'),
    'dictionaryContinuousScanner':('src/lib/file-parsers/media-reader.ts','while (idx < scalarDict.length)'),
    'blockString':('src/lib/playwright/grade-worker.ts','const lines = val.split'),
    'finalVerifiedHash':('src/lib/db/sqlite.ts',"AND contentHash = ?"),
    'anonymization':('src/lib/gemini/homework-grader.ts','const anonymousId = `STUDENT_'),
    'parseErrorGuard':('src/lib/gemini/homework-grader.ts','PARSE_ERROR'),
    'typescriptSum':('src/lib/gemini/score-auditor.ts','sum += pts')}
refs={}
for key,(f,needle) in needles.items():
    assert needle in source[f],key
    refs[key]={'file':f,'line':source[f][:source[f].index(needle)].count('\n')+1,'needle':needle}
data={'method':'Read-only source review and fresh inherited/directed execution. Scope is Phase 5 and connected controls, not whole-repo penetration testing.',
    'loadAssumption':'One local teacher, sequential browser tasks; AI/draft/UI responses may arrive out of order.',
    'sourceHashes':{f:hashlib.sha256((root/f).read_bytes()).hexdigest() for f in files},
    'localHostScripts':{k:pkg['scripts'][k] for k in ['dev','start']},'references':refs,'clientEntrypoints':clients,
    'limits':'No actual browser, LMS/Gemini request, LMS schema validation, real credentials/data or live React scheduling.'}
(p/'evidence/static-review.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Scoped source review captured.')
