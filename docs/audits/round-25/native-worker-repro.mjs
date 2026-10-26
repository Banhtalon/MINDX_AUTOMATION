// Corroboration through actual product module imports. Only collaborators are doubled at runtime.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {HomeworkGradeWorker} from '../../../src/lib/playwright/grade-worker.ts';
import {BrowserManager} from '../../../src/lib/playwright/browser-manager.ts';
import {authService} from '../../../src/lib/playwright/auth.ts';
import {LmsHelpers} from '../../../src/lib/playwright/lms-helpers.ts';
import {NetworkInterceptor} from '../../../src/lib/playwright/network-interceptor.ts';
import {SELECTORS} from '../../../src/lib/playwright/selectors.ts';
import {getDb,studentRepo,homeworkSubmissionRepo,computeHomeworkContentHash} from '../../../src/lib/db/sqlite.ts';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
assert(root===process.cwd()&&root.startsWith(path.resolve(os.tmpdir())+path.sep)&&root.includes('mindx-round25-'));
const cid='R25_NATIVE_PTA',sid=cid+'_SESS_01',results=[];
const loc=o=>({first(){return this;},last(){return this;},nth(){return this;},locator(){return loc();},count:async()=>0,isVisible:async()=>false,scrollIntoViewIfNeeded:async()=>{},waitFor:async()=>{},click:async()=>{},innerText:async()=>'',getAttribute:async()=>null,fill:async()=>{},evaluate:async()=>{},...o});
studentRepo.upsert({classId:cid,studentId:'S1',fullName:'Synthetic Native',isActive:1});
const original={getInstance:BrowserManager.getInstance,auth:authService.ensureAuthenticated,open:LmsHelpers.openClassDrawer,tab:LmsHelpers.switchDrawerTab,wait:NetworkInterceptor.prototype.waitForApiResponse,dismiss:NetworkInterceptor.prototype.dismissForbiddenToast};
authService.ensureAuthenticated=async()=>{};LmsHelpers.openClassDrawer=async()=>{};LmsHelpers.switchDrawerTab=async()=>{};NetworkInterceptor.prototype.dismissForbiddenToast=async()=>{};
const input=()=>({classId:cid,sessionId:sid,submissionId:'SUB1',studentId:'S1',score:80,decision:'GRADE',feedback:'APPROVED FEEDBACK'});
const request=i=>({operationName:'SaveHomeworkGrade',query:'mutation SaveHomeworkGrade($input:GradeInput!) { saved:saveHomeworkGrade(input:$input) { id } }',variables:{input:i}});
const cases=[
  ['valid',request(input()),{data:{saved:{id:'SUB1',decision:'GRADE'}}},1],
  ['wrong-direct-id',request(input()),{data:{saved:{id:'OTHER'}}},0],
  ['conflicting-ids',request(input()),{data:{saved:{submissionId:'SUB1',id:'OTHER'}}},0],
  ['null-primary-id',request(input()),{data:{saved:{submissionId:null,id:'SUB1'}}},0],
  ['conflicting-decision',request(input()),{data:{saved:{decision:'GRADE',status:'REDO'}}},0],
  ['array-decision',request(input()),{data:{saved:{id:'SUB1',decision:['GRADE']}}},0],
  ['object-score',request({...input(),score:{value:1},nested:{score:80}}),{data:{saved:true}},0],
  ['unused-decoys',{...request(input()),variables:{input:input(),submissionId:'OTHER',score:1}},{data:{saved:true}},1],
  ['noargs-wrong-result',{operationName:'SaveHomeworkGrade',query:'mutation SaveHomeworkGrade { saveHomeworkGrade }',variables:input()},{data:{saveGrade:true}},0]
];
try {
  for(const [name,req,response,expected]of cases) {
    const record={classId:cid,sessionId:sid,studentId:'S1',submissionId:'SUB1',originalFileName:'synthetic.py',localFilePath:'',fileHash:'synthetic-file-v1',parseStatus:'PARSED',parseErrorReason:null,criteriaGradesJson:JSON.stringify([{criterionId:'C1',criterionName:'Output',earnedPoints:80,maxPoints:100,evidenceSnippet:'print(1)',deductionReason:'Synthetic'}]),calculatedScore:80,teacherOverrideScore:null,decision:'GRADE',feedbackHtml:'<p>APPROVED FEEDBACK</p>',status:'APPROVED',contentHash:'',verifiedAt:null,errorMessage:null};
    record.contentHash=computeHomeworkContentHash(record);homeworkSubmissionRepo.upsert(record);
    let writes=0,radio='';
    const modal=loc({count:async()=>1,isVisible:async()=>true,innerText:async()=> 'Synthetic Native S1 SUB1',locator:s=>s===SELECTORS.grading.modal.saveButton?loc({count:async()=>1,click:async()=>{writes++;}}):s===SELECTORS.grading.modal.richTextEditor?loc({count:async()=>1,innerText:async()=> 'APPROVED FEEDBACK'}):s===SELECTORS.grading.modal.scoreInput?loc({count:async()=>1}):loc({count:async()=>1,isChecked:async()=>s===radio,click:async()=>{radio=s;}})});
    const cell=loc({count:async()=>1,innerText:async()=> '80/100'}),cells=loc({count:async()=>2,nth:()=>cell});
    const row=loc({count:async()=>1,innerText:async()=> 'Synthetic Native\nS1',locator:s=>s==='> div, > td'?cells:row}),rows=loc({count:async()=>1,nth:()=>row});
    const panel=loc({isVisible:async()=>true,locator:()=>rows}),drawer=loc({locator:s=>s==='#tabpanel-3'?panel:rows});
    const page={locator:s=>s===SELECTORS.grading.modal.container?modal:drawer,waitForTimeout:async()=>{},keyboard:{press:async()=>{}}};
    BrowserManager.getInstance=()=>({getPage:async()=>page});
    NetworkInterceptor.prototype.waitForApiResponse=async(_url,options)=>{if(!options.requestPredicate(JSON.stringify(req)))throw Error('Synthetic API did not match');return {status:()=>200,json:async()=>response};};
    const r=await HomeworkGradeWorker.saveApprovedGrades({classId:cid,classCode:cid,sessionId:sid});
    const observation={id:'R25-NATIVE-09-'+name,pass:r.verifiedCount===expected,expectedVerified:expected,verified:r.verifiedCount,status:homeworkSubmissionRepo.findBySubmissionId('SUB1').status,writes,request:req,response,error:r.results[0]?.error};
    results.push(observation);console.log((observation.pass?'PASS ':'FAIL ')+observation.id+' '+JSON.stringify(observation));
  }
}finally{
  BrowserManager.getInstance=original.getInstance;authService.ensureAuthenticated=original.auth;LmsHelpers.openClassDrawer=original.open;LmsHelpers.switchDrawerTab=original.tab;NetworkInterceptor.prototype.waitForApiResponse=original.wait;NetworkInterceptor.prototype.dismissForbiddenToast=original.dismiss;
  getDb().close();
}
const summary={round:25,sourceRoot:root,checkedAt:new Date().toISOString(),method:'Actual product modules imported through tsx, no source/type/import stripping. Real SQLite in snapshot; deterministic browser/API doubles by replacing collaborator methods at runtime. No actual browser or LMS.',harnessSha256:crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'),total:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
fs.writeFileSync(path.join(root,'docs/audits/round-25/native-worker-results.json'),JSON.stringify(summary,null,2)+'\n');console.log('SUMMARY '+JSON.stringify({total:summary.total,passed:summary.passed,failed:summary.failed}));if(summary.failed)process.exitCode=1;
