"""Retain native R25 collaborators unchanged; run independent R26 worker cases."""
from pathlib import Path
p=Path(__file__).resolve().parent
s=(p.parent/'round-25/native-worker-repro.mjs').read_text(encoding='utf-8')
s=s.replace("import {fileURLToPath} from 'node:url';", "import {fileURLToPath} from 'node:url';\nimport {createR26WorkerCases} from './worker-cases.mjs';")
s=s.replace("root.includes('mindx-round25-')","root.includes('mindx-round26-')").replace("cid='R25_NATIVE_PTA'","cid='R26_NATIVE_PTA'")
s=s.replace("studentRepo.upsert({classId:cid", "const fixtureWorkspace=fs.mkdtempSync(path.join(os.tmpdir(),'mindx-round26-native-worker-'));process.chdir(fixtureWorkspace);\nstudentRepo.upsert({classId:cid",1)
s=s.replace('getDb().close();','getDb().close();process.chdir(root);')
s=s.replace('round:25,sourceRoot:root,','round:26,sourceRoot:root,fixtureWorkspace,')
start=s.index('const input=()=>')
end=s.index('try {\n  for(',start)
s=s[:start]+"const cases=createR26WorkerCases(cid,sid);\n"+s[end:]
s=s.replace('for(const [name,req,response,expected]of cases) {','for(const c of cases) {\n    const {id,request:req,response,expected,feedback}=c;')
s=s.replace("feedbackHtml:'<p>APPROVED FEEDBACK</p>'","feedbackHtml:feedback")
s=s.replace("innerText:async()=> 'APPROVED FEEDBACK'","innerText:async()=> feedback")
s=s.replace("id:'R25-NATIVE-09-'+name","id")
s=s.replace('round:25,','round:26,').replace('docs/audits/round-25/native-worker-results.json','docs/audits/round-26/evidence/native-worker-results.json')
(p/'native-worker-repro.mjs').write_text(s,encoding='utf-8',newline='\n')
