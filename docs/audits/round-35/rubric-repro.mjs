// R35 fresh checks: real source handlers in a deterministic hook harness, synthetic data only.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
const root=path.resolve(process.cwd()),out=path.join(path.dirname(fileURLToPath(import.meta.url)),'evidence');
if(!root.startsWith(path.resolve(os.tmpdir())+path.sep)||!root.includes('mindx-round31-'))throw Error('RUN_ONLY_IN_ISOLATED_SNAPSHOT');
fs.mkdirSync(out,{recursive:true});
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const clean=s=>s.replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,'').replace(/\bexport\s+default\s+/g,'').replace(/\bexport\s+/g,'');
function mod(file,names,bindings={},source=read(file)){const ctx=vm.createContext({console,URL,Request,Response,structuredClone,setTimeout,clearTimeout,...bindings});vm.runInContext(stripTypeScriptTypes(clean(source),{mode:'transform'})+'\nglobalThis.out={'+names.join(',')+'};',ctx,{filename:file});return ctx.out;}
const cid='AUDIT_PTA_CLASS', sid=cid+'_SESS_01';
const base={classId:cid,sessionId:sid,studentId:'S1',submissionId:'SUB1',fullName:'Synthetic',fileHash:'file-v1',criteriaGrades:[],feedbackHtml:'OLD SAVED FEEDBACK',calculatedScore:80,decision:'GRADE',status:'WAITING_APPROVAL',parseStatus:'PARSED'};
const results=[];
// New Phase 7 default rubric is saved as 10 points, while the grade pipeline approves raw 8 as LMS score.
{
 const {auditCriterionGrades,calculateTotalScoreFromCriteria}=mod('src/lib/gemini/score-auditor.ts',['auditCriterionGrades','calculateTotalScoreFromCriteria']);
 const {sanitizeFeedbackHtml}=mod('src/lib/gemini/homework-grader.ts',['sanitizeFeedbackHtml']);
 let savedRubrics=[];const config=mod('src/app/api/config/route.ts',['POST'],{NextResponse:Response,validateLocalRequest:()=>null,saveGradingRubrics:r=>savedRubrics=r,getGradingRubrics:()=>savedRubrics});
 const rubric={rubricId:'NEW_DEFAULT',courseCode:'PTA',sessionNumber:1,assignmentTitle:'Synthetic',assignmentPrompt:'Synthetic',maxTotalScore:10,criteria:[{criterionId:'C1',name:'Output',maxPoints:5},{criterionId:'C2',name:'Style',maxPoints:5}]};
 const configResponse=await config.POST(new Request('http://127.0.0.1/api/config',{method:'POST',body:JSON.stringify({section:'rubrics',rubrics:[rubric]})}));
 const criteriaGrades=rubric.criteria.map(c=>({criterionId:c.criterionId,criterionName:c.name,maxPoints:c.maxPoints,earnedPoints:4,evidenceSnippet:'print(1)',deductionReason:'Synthetic deduction'}));
 const audit=auditCriterionGrades(criteriaGrades,savedRubrics[0]);
 let row={...base,criteriaGradesJson:JSON.stringify(criteriaGrades),calculatedScore:audit.calculatedScore,teacherOverrideScore:null};
 const approve=mod('src/app/api/homework-grader/approve/route.ts',['POST'],{NextResponse:Response,validateLocalRequest:()=>null,auditCriterionGrades,calculateTotalScoreFromCriteria,sanitizeFeedbackHtml,computeHomeworkContentHash:()=> 'synthetic-hash',homeworkSubmissionRepo:{findBySubmissionId:()=>row,upsert:r=>row=r}});
 const response=await approve.POST(new Request('http://127.0.0.1/api/homework-grader/approve',{method:'POST',body:JSON.stringify({...base,rubric:savedRubrics[0],criteriaGrades,teacherOverrideScore:null})}));const json=await response.json();
 const observed={configHttp:configResponse.status,rubricMax:savedRubrics[0]?.maxTotalScore,auditValid:audit.valid,earned:audit.calculatedScore,approveHttp:response.status,status:row.status,approvedScore:row.calculatedScore,displayFromRealUi:`${row.calculatedScore}/100`,workerPassesRawScore:read('src/lib/playwright/grade-worker.ts').includes('await scoreInput.fill(String(effectiveScore))')};
 results.push({id:'R35-RUBRIC-SCALE',expected:'Default new Phase 7 rubric must retain correct 80-percent result on 100-point LMS',observed,bugReproduced:observed.configHttp===200&&observed.rubricMax===10&&observed.auditValid&&row.status==='APPROVED'&&row.calculatedScore===8&&observed.workerPassesRawScore});
}
fs.writeFileSync(path.join(out,'rubric-repro-results.json'),JSON.stringify({root,syntheticOnly:true,limitations:'Config route, score auditor and approval route executed from exact source; worker raw score fill and /100 contract confirmed by source inspection, no browser/LMS runtime claim.',results},null,2));
for(const r of results)console.log(JSON.stringify(r));
if(results.some(r=>!r.bugReproduced))process.exitCode=1;
