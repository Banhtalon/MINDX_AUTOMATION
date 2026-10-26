// R36 positive closure assertions. Product files and historical harnesses are not edited.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {pathToFileURL} from 'node:url';
import AdmZip from 'adm-zip';
const root=process.cwd();
assert(root.startsWith(path.resolve(os.tmpdir())+path.sep)&&root.endsWith('mindx-round31-r36-check'));
const out=path.join(root,'docs/audits/round-36/evidence');fs.mkdirSync(out,{recursive:true});
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const clean=s=>s.replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,'').replace(/\bexport\s+default\s+/g,'').replace(/\bexport\s+/g,'');
function mod(file,names,bindings={}){const ctx=vm.createContext({console,Buffer,URL,Request,Response,structuredClone,setTimeout,clearTimeout,...bindings});vm.runInContext(stripTypeScriptTypes(clean(read(file)),{mode:'transform'})+'\nglobalThis.out={'+names.join(',')+'};',ctx,{filename:file});return ctx.out;}
const results=[];
async function check(id,fn){try{const observation=await fn();results.push({id,pass:true,observation});}catch(e){results.push({id,pass:false,error:e.stack});}console.log(JSON.stringify(results.at(-1)));}
// Reuse only the original hook-harness helpers, before its scenarios; expose helpers in a NEW R36 file.
const original=read('docs/audits/round-35/ui-repro.mjs');
const helper=path.join(root,'docs/audits/round-36/ui-harness-derived.mjs');
fs.writeFileSync(helper,original.slice(0,original.indexOf('const results=[];')).replace('unsavedSubIds,isLoadingSubs};','unsavedSubIds,isLoadingSubs,handleApproveSubmission};')+'\nexport {ui,ok,base,cid,sid,deferred};\n');
const {ui,ok,base,cid,sid}=await import(pathToFileURL(helper).href);
const {auditCriterionGrades,calculateTotalScoreFromCriteria}=mod('src/lib/gemini/score-auditor.ts',['auditCriterionGrades','calculateTotalScoreFromCriteria']);
const {sanitizeFeedbackHtml}=mod('src/lib/gemini/homework-grader.ts',['sanitizeFeedbackHtml']);
const rubric=n=>({rubricId:'R36',courseCode:'PTA',sessionNumber:1,assignmentTitle:'Synthetic',assignmentPrompt:'Synthetic',maxTotalScore:n,criteria:[{criterionId:'C1',name:'Output',maxPoints:n/2},{criterionId:'C2',name:'Style',maxPoints:n/2}]});
const grades=n=>rubric(n).criteria.map(c=>({criterionId:c.criterionId,criterionName:c.name,maxPoints:c.maxPoints,earnedPoints:c.maxPoints*.8,evidenceSnippet:'print(1)',deductionReason:'Synthetic deduction'}));
await check('R35-01-config-reject10-accept100',async()=>{
 let saved=[],writes=0;const route=mod('src/app/api/config/route.ts',['POST'],{NextResponse:Response,validateLocalRequest:()=>null,saveGradingRubrics:r=>{saved=r;writes++;},getGradingRubrics:()=>saved});
 const post=n=>route.POST(new Request('http://127.0.0.1/api/config',{method:'POST',body:JSON.stringify({section:'rubrics',rubrics:[rubric(n)]})}));
 const bad=await post(10);assert.equal(bad.status,400);assert.equal(writes,0);const good=await post(100);assert.equal(good.status,200);assert.equal(saved[0].maxTotalScore,100);return{badHttp:bad.status,goodHttp:good.status,writes};
});
await check('R35-01-auditor-reject10-accept80',()=>{const bad=auditCriterionGrades(grades(10),rubric(10)),good=auditCriterionGrades(grades(100),rubric(100));assert.equal(bad.valid,false);assert.equal(good.valid,true);assert.equal(good.calculatedScore,80);return{badValid:bad.valid,goodValid:good.valid,score:good.calculatedScore};});
await check('R35-01-approve-reject10-approve80',async()=>{
 const statuses=[];for(const n of [10,100]){let writes=0,row={...base,criteriaGradesJson:JSON.stringify(grades(n)),calculatedScore:n*.8,teacherOverrideScore:null};
 const route=mod('src/app/api/homework-grader/approve/route.ts',['POST'],{NextResponse:Response,validateLocalRequest:()=>null,auditCriterionGrades,calculateTotalScoreFromCriteria,sanitizeFeedbackHtml,computeHomeworkContentHash:()=> 'a'.repeat(64),homeworkSubmissionRepo:{findBySubmissionId:()=>row,upsert:r=>{row=r;writes++;}}});
 const response=await route.POST(new Request('http://127.0.0.1/api/homework-grader/approve',{method:'POST',body:JSON.stringify({...base,fileHash:base.fileHash,rubric:rubric(n),criteriaGrades:grades(n),teacherOverrideScore:null})}));
 assert.equal(response.status,n===10?400:200);assert.equal(writes,n===10?0:1);if(n===100){assert.equal(row.status,'APPROVED');assert.equal(row.calculatedScore,80);}statuses.push({n,http:response.status,writes,status:row.status,score:row.calculatedScore});}return statuses;
});
const parsed={parseStatus:'PARSED',fileName:'synthetic.py',fileHash:'synthetic',extractedText:'print(1)',subjectType:'PYTHON',extension:'.py',inlineDataParts:[]};
await check('R35-01-grader-reject10-before-ai',async()=>{
 let calls=0,writes=0;const {HomeworkAiGrader}=mod('src/lib/gemini/homework-grader.ts',['HomeworkAiGrader'],{getGeminiModel:()=>({generateContent:async()=>{calls++;throw Error('UNEXPECTED_AI');}}),homeworkSubmissionRepo:{findBySubmissionId:()=>undefined,upsert:()=>writes++},studentRepo:{findByClass:()=>[]}});
 await assert.rejects(()=>HomeworkAiGrader.gradeSingleSubmission({...base,parsedContent:parsed},rubric(10)),/100/);assert.equal(calls,0);assert.equal(writes,0);return{calls,writes};
});
await check('R35-01-route-reject10-before-ai',async()=>{
 let calls=0;const route=mod('src/app/api/homework-grader/download-and-grade/route.ts',['POST'],{NextResponse:Response,validateLocalRequest:()=>null,taskQueue:{getStatus:()=>({isStopped:false})},HomeworkAiGrader:{gradeBatchSubmissions:()=>calls++}});
 const res=await route.POST(new Request('http://127.0.0.1/api/homework-grader/download-and-grade',{method:'POST',body:JSON.stringify({classId:cid,classCode:cid,sessionId:sid,skipDownload:true,rubric:rubric(10)})}));assert.equal(res.status,400);assert.equal(calls,0);return{http:res.status,calls};
});
await check('R35-04-stop-before-write-real-single-grader',async()=>{
 let stopped=false,writes=0,calls=0;const {HomeworkAiGrader}=mod('src/lib/gemini/homework-grader.ts',['HomeworkAiGrader'],{auditCriterionGrades,getGeminiModel:()=>({generateContent:async()=>{calls++;stopped=true;return{response:{text:()=>JSON.stringify({criteriaGrades:grades(100),feedbackHtml:'<p>STUDENT_01 synthetic feedback</p>',suggestedDecision:'GRADE'})}};}}),homeworkSubmissionRepo:{findBySubmissionId:()=>undefined,upsert:()=>writes++},studentRepo:{findByClass:()=>[]}});
 const result=await HomeworkAiGrader.gradeSingleSubmission({...base,parsedContent:parsed},rubric(100),{shouldStop:()=>stopped});fs.writeFileSync(path.join(out,'stop-single-observation.json'),JSON.stringify({calls,writes,result},null,2));assert.equal(calls,1);assert.equal(writes,0);assert.equal(result.staleIgnored,true);assert.match(result.errorMessage,/TASK_CANCELLED/);return{calls,writes,staleIgnored:result.staleIgnored,error:result.errorMessage};
});
await check('R35-02-refresh-preserve-then-confirm-draft',async()=>{
 let sequence=0;const h=ui(async(_u,opts)=>{if(opts?.method==='POST')throw Error('OFFLINE');return ok({submissions:[{...base,draftSeq:sequence,feedbackHtml:sequence?'UNSAVED':'OLD SAVED FEEDBACK'}]});});await h.flush();await h.api.handleFieldUpdate(h.api.submissions[0],{feedbackHtml:'UNSAVED'});await h.flush();await h.api.loadSessionSubmissions();await h.flush();assert.equal(h.api.submissions[0].feedbackHtml,'UNSAVED');assert.equal(h.api.unsavedSubIds.SUB1,true);sequence=1000000;await h.api.loadSessionSubmissions();await h.flush();assert.equal(Boolean(h.api.unsavedSubIds.SUB1),false);return{retainedBeforeConfirmation:true,clearedAfterConfirmation:true};
});
await check('R36-UI-new-file-clears-unsaved-marker',async()=>{
 let changed=false,approvalCalls=0;const h=ui(async(url,opts)=>{if(url.includes('/approve')){approvalCalls++;return ok({...base,status:'APPROVED',contentHash:'synthetic'});}if(opts?.method==='POST')throw Error('OFFLINE');return ok({submissions:[{...base,fileHash:changed?'file-v2':base.fileHash,draftSeq:0}]});});await h.flush();await h.api.handleFieldUpdate(h.api.submissions[0],{feedbackHtml:'OLD FILE UNSAVED'});await h.flush();changed=true;await h.api.loadSessionSubmissions();await h.flush();const observation={fileHash:h.api.submissions[0].fileHash,feedback:h.api.submissions[0].feedbackHtml,unsaved:structuredClone(h.api.unsavedSubIds)};observation.approveResult=await h.api.handleApproveSubmission(h.api.submissions[0]);await h.flush();observation.approvalCalls=approvalCalls;observation.banner=h.api.banner;await h.api.loadSessionSubmissions();await h.flush();observation.afterSecondRefresh={unsaved:structuredClone(h.api.unsavedSubIds),approveResult:await h.api.handleApproveSubmission(h.api.submissions[0]),approvalCalls};fs.writeFileSync(path.join(out,'new-file-observation.json'),JSON.stringify(observation,null,2));assert.equal(observation.fileHash,'file-v2');assert.equal(Boolean(observation.unsaved.SUB1),false,'New server file replaced the local draft but UI still marks it unsaved and blocks approval');return observation;
});
const {parseScratchSb3Buffer,parseGameMakerBuffer}=await import(pathToFileURL(path.join(root,'src/lib/file-parsers/game-reader.ts')).href);
await check('R35-06-cycle-and-depth-terminate',()=>{
 const run=mode=>{const blocks={hat:{opcode:'event_whenflagclicked',topLevel:true,next:'move',inputs:{},fields:{}},move:{opcode:'motion_movesteps',next:null,inputs:{STEPS:[3,'n0']},fields:{}}};for(let i=0;i<20;i++)blocks['n'+i]={opcode:'operator_add',inputs:{NUM1:[3,mode==='cycle'?'n0':'n'+(i+1)],NUM2:[1,[4,'1']]},fields:{}};const z=new AdmZip();z.addFile('project.json',Buffer.from(JSON.stringify({targets:[{isStage:true,name:'Stage',blocks:{}},{isStage:false,name:'Sprite',blocks}]})));const result=parseScratchSb3Buffer(z.toBuffer(),mode+'.sb3');assert.equal(result.success,true);assert(result.extractedText.includes(mode==='cycle'?'cycle:':'(...)'));return{mode,chars:result.extractedText.length};};return[run('cycle'),run('deep')];
});
await check('R35-07-valid-and-corrupt-yy',()=>{
 const results=[];for(const bad of [false,true]){const z=new AdmZip();z.addFile('Project.yyp',Buffer.from(JSON.stringify({resourceType:'GMProject',name:'Project'})));z.addFile('objects/player/player.yy',Buffer.from(bad?'{bad json':JSON.stringify({resourceType:'GMObject',name:'player',eventList:[]})));z.addFile('objects/player/Create_0.gml',Buffer.from('show_debug_message(1);'));const result=parseGameMakerBuffer(z.toBuffer(),'fixture.yyz','.yyz');assert.equal(result.success,!bad);if(bad)assert.match(result.errorReason,/player\.yy/);results.push({bad,success:result.success,error:result.errorReason});}return results;
});
const summary={syntheticOnly:true,total:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
fs.writeFileSync(path.join(out,'closure-results.json'),JSON.stringify(summary,null,2)+'\n');console.log('SUMMARY '+JSON.stringify({total:summary.total,passed:summary.passed,failed:summary.failed}));if(summary.failed)process.exitCode=1;
