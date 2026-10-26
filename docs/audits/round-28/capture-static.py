"""Record narrow, read-only source checks and their current file hashes."""
import hashlib
import json
from pathlib import Path
p=Path(__file__).resolve().parent
root=p.parents[2]
files=['src/lib/playwright/browser-manager.ts','src/lib/queue/task-queue.ts','src/app/api/homework-grader/save-lms/route.ts','src/app/api/homework-grader/download-and-grade/route.ts','src/lib/file-parsers/index.ts','src/lib/playwright/download-submissions.ts','src/lib/playwright/grade-worker.ts','src/lib/file-parsers/media-reader.ts','src/lib/playwright/network-interceptor.ts','src/lib/db/sqlite.ts','src/lib/gemini/homework-grader.ts','src/lib/gemini/score-auditor.ts','src/app/api/homework-grader/approve/route.ts','src/app/api/homework-grader/submissions/route.ts','src/components/homework-auto-grader-tab.tsx','src/app/homework-grader/page.tsx']
source={f:(root/f).read_text(encoding='utf-8') for f in files}
clients={f:{'sensitiveEnvironmentReference':any(k in source[f] for k in ['TEACHING_PASSWORD','LMS_PASSWORD','GEMINI_API_KEY'])} for f in files[-2:]}
assert not any(v['sensitiveEnvironmentReference'] for v in clients.values())
pkg=json.loads((root/'package.json').read_text(encoding='utf-8'))
assert all('127.0.0.1' in pkg['scripts'][k] for k in ['dev','start'])
data={'method':'Narrow read-only inspection plus current inherited/directed source-function evidence. No actual browser or whole-repo security claim.','loadAssumption':'One local teacher; sequential browser work; asynchronous AI/draft/UI results may overlap.','localHostScripts':{k:pkg['scripts'][k] for k in ['dev','start']},'sourceHashes':{f:hashlib.sha256((root/f).read_bytes()).hexdigest() for f in files},'references':{'singlePersistentContext':'src/lib/playwright/browser-manager.ts:86','singleQueue':'src/lib/queue/task-queue.ts:53','saveQueue':'src/app/api/homework-grader/save-lms/route.ts:36','fileAllowlist':'src/lib/file-parsers/index.ts:287','businessResponseAndToast':'src/lib/playwright/network-interceptor.ts:22','finalHashConditionalUpdate':'src/lib/db/sqlite.ts:942','pdfLength':'src/lib/file-parsers/media-reader.ts:1271','pdfCount':'src/lib/file-parsers/media-reader.ts:1442','graphqlBlockValue':'src/lib/playwright/grade-worker.ts:465','reviewedSnapshot':'src/app/api/homework-grader/approve/route.ts:106','staleUiRequest':'src/components/homework-auto-grader-tab.tsx:211','aiAnonymization':'src/lib/gemini/homework-grader.ts:178','parseErrorGuard':'src/lib/gemini/homework-grader.ts:283','typescriptSum':'src/lib/gemini/score-auditor.ts:24'},'clientEntrypoints':clients,'limits':'No LMS schema validation, real API call, live UI/React scheduling, credentials or full production acceptance.'}
(p/'evidence/static-review.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
