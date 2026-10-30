// @ts-nocheck -- independent audit artifact
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { transformSync } from 'esbuild';
import { classSessionRepo, studentRepo, spckSessionRepo, spckUploadRepo, session14EvalRepo } from '../../../../src/lib/db/sqlite';
import { POST as saveDraft } from '../../../../src/app/api/spck/save-draft/route';
import { POST as importDemo } from '../../../../src/app/api/spck/session14-eval/import-demo-scores/route';

const observations=[];
const out=process.env.S5B_R2_EVIDENCE!;
function record(id,details){observations.push({id,...details});fs.writeFileSync(path.join(out,'repository-observations.json'),JSON.stringify(observations,null,2));console.log('PASS',id);}
function req(url,body){return new Request('http://127.0.0.1:3000'+url,{method:'POST',headers:{host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000','content-type':'application/json'},body:JSON.stringify(body)});}
async function main(){
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'codex-s5b-r2-repo-'));
  const classId='AUDIT-S5B-R2-JSB', studentId='AUDIT-S5B-R2-A';
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
  for(const name of ['old.png','new.png'])fs.writeFileSync(path.join(folder,name),png);
  classSessionRepo.upsert({classId,className:'Lớp mô phỏng kiểm định',sessionId:classId+'_13',sessionNumber:13,date:'2026-10-30',topic:'SPCK'});
  studentRepo.upsert({classId,studentId,fullName:'Alpha Audit',isActive:1});
  const first=spckSessionRepo.saveSessionDraft({classId,studentId,sessionNumber:13,localFolderPath:folder,isConfirmedByTeacher:1,projectTitle:'Website tiệm bánh',thumbnailPath:path.join(folder,'old.png'),screenshotsJson:'[]',attachmentsJson:'[]',youtubeUrlsJson:'[]',relatedLinksJson:'[]',teacherComment:'Con hoàn thành giao diện.',teacherNote:'Giao diện rõ ràng',quickTagsJson:'[]'}).record;
  const initialVersion=first.draftVersion;
  for(const stage of ['capture','web','drive']){
    const prev=spckSessionRepo.findOne(classId,studentId,13);
    const links=JSON.parse(prev.relatedLinksJson||'[]');
    if(stage!=='capture')links.push({name:stage,url:stage==='web'?'https://example.com':'https://drive.google.com/drive/folders/AUDIT'});
    spckUploadRepo.updateSharedResources({classId,studentId,expectedFolderPath:folder,thumbnailPath:path.join(folder,'new.png'),screenshotsJson:JSON.stringify([path.join(folder,'new.png')]),relatedLinksJson:JSON.stringify(links),syncSessionNumber:13});
    const fresh=spckSessionRepo.findOne(classId,studentId,13);
    const body={classId,studentId,sessionNumber:13,expectedVersion:fresh.draftVersion,localFolderPath:folder,isConfirmedByTeacher:1,projectTitle:fresh.projectTitle,thumbnailPath:fresh.thumbnailPath,screenshots:JSON.parse(fresh.screenshotsJson),attachments:[],youtubeUrls:[],relatedLinks:JSON.parse(fresh.relatedLinksJson),teacherComment:fresh.teacherComment,teacherNote:fresh.teacherNote,quickTags:[]};
    const res=await saveDraft(req('/api/spck/save-draft',body));const data=await res.json();assert.equal(res.status,200);assert.equal(data.success,true);
    const after=spckSessionRepo.findOne(classId,studentId,13);assert.equal(after.thumbnailPath,path.join(folder,'new.png'));assert.deepEqual(JSON.parse(after.relatedLinksJson),links);
    record('R2-DB01-'+stage,{previousVersion:prev.draftVersion,resourceVersion:fresh.draftVersion,savedVersion:after.draftVersion,http:res.status,links});
  }
  const stale=await saveDraft(req('/api/spck/save-draft',{classId,studentId,sessionNumber:13,expectedVersion:initialVersion,localFolderPath:folder,projectTitle:'Website cũ'}));assert.equal(stale.status,409);
  record('R2-DB02',{scenario:'Stale version protection remains active',http:stale.status});
  const demoClass='AUDIT-S5B-R2-DEMO';
  classSessionRepo.upsert({classId:demoClass,className:'Lớp Demo giả',sessionId:demoClass+'_14',sessionNumber:14,date:'2026-10-30',topic:'Demo'});
  const people=[['R2_DEMO_A','Alpha Audit'],['R2_DEMO_B','Beta Audit']];
  for(const [id,name] of people)studentRepo.upsert({classId:demoClass,studentId:id,fullName:name,isActive:1});
  session14EvalRepo.saveDraft({classId:demoClass,studentId:people[0][0],demoScores:{algorithm:1,creativity:.5,communication:.5,problemSolving:1,computerSkills:1},teacherNote:'Điểm giáo viên tự chỉnh',learnedFromMindx:'Nội dung giữ nguyên'});
  session14EvalRepo.getOrInit(demoClass,people[1][0]);
  const beforeA=session14EvalRepo.findOne(demoClass,people[0][0]);
  assert.equal(beforeA.demoTotalScore,4);
  const testSource=fs.readFileSync('scripts/test-session14-v290.ts','utf8');
  const builderSource=testSource.slice(testSource.indexOf('function buildTestDemoWorkbookBuffer'),testSource.indexOf('async function runTests()'));
  const build=new Function('AdmZip',transformSync(builderSource,{loader:'ts',target:'es2020'}).code+';return buildTestDemoWorkbookBuffer;')(AdmZip);
  const zip=new AdmZip(build(people[0][1]));const zipB=new AdmZip(build(people[1][1]));
  let workbook=zip.getEntry('xl/workbook.xml').getData().toString('utf8').replace('</sheets>','<sheet name="Beta Audit" sheetId="3" r:id="rId3"/></sheets>');
  let rels=zip.getEntry('xl/_rels/workbook.xml.rels').getData().toString('utf8').replace('</Relationships>','<Relationship Id="rId3" Target="worksheets/sheet3.xml"/></Relationships>');
  zip.updateFile('xl/workbook.xml',Buffer.from(workbook));zip.updateFile('xl/_rels/workbook.xml.rels',Buffer.from(rels));zip.addFile('xl/worksheets/sheet3.xml',zipB.getEntry('xl/worksheets/sheet1.xml').getData());
  const source=path.join(folder,'demo.xlsx');fs.writeFileSync(source,zip.toBuffer());
  const response=await importDemo(req('/api/spck/session14-eval/import-demo-scores',{classId:demoClass,sourcePathOrUrl:source,onlyMissingStudents:true}));const data=await response.json();
  assert.equal(response.status,200,JSON.stringify(data));assert.equal(data.importResult.matchedCount,1);
  assert.deepEqual(session14EvalRepo.findOne(demoClass,people[0][0]),beforeA);
  const afterB=session14EvalRepo.findOne(demoClass,people[1][0]);assert.ok(afterB.demoTotalScore>0);
  record('R2-DB03',{scenario:'Real API + workbook + SQLite: preserve positive score, fill missing only',matched:data.importResult.matchedCount,preservedScore:beforeA.demoTotalScore,importedScore:afterB.demoTotalScore,preservedAllFields:true});
  const repeat=await importDemo(req('/api/spck/session14-eval/import-demo-scores',{classId:demoClass,sourcePathOrUrl:source,onlyMissingStudents:true}));const repeatData=await repeat.json();assert.equal(repeatData.importResult.matchedCount,0);assert.deepEqual(session14EvalRepo.findOne(demoClass,people[1][0]),afterB);
  record('R2-DB04',{scenario:'Repeat only-missing import is idempotent',matched:repeatData.importResult.matchedCount});
  const manual=await importDemo(req('/api/spck/session14-eval/import-demo-scores',{classId:demoClass,sourcePathOrUrl:source,onlyMissingStudents:false}));const manualData=await manual.json();assert.equal(manualData.importResult.matchedCount,2);
  record('R2-DB05',{scenario:'Explicit manual import retains overwrite behavior',matched:manualData.importResult.matchedCount});
}
main().catch(err=>{console.error(err);process.exitCode=1;});
