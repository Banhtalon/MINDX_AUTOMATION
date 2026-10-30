// @ts-nocheck -- independent audit artifact
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { classSessionRepo, studentRepo, spckSessionRepo, spckUploadRepo } from '../../../../src/lib/db/sqlite';
import { POST as saveDraft } from '../../../../src/app/api/spck/save-draft/route';

async function main() {
  const classId = 'AUDIT-S5B-JSB';
  const studentId = 'AUDIT-S5B-01';
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-s5b-resource-'));
  const thumbnail = path.join(folder,'old.png');
  const newThumbnail = path.join(folder,'new.png');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
  fs.writeFileSync(thumbnail,png); fs.writeFileSync(newThumbnail,png);
  classSessionRepo.upsert({classId,className:'Lớp giả lập',sessionId:'audit13',sessionNumber:13,date:'2026-10-30',topic:'SPCK'});
  studentRepo.upsert({classId,studentId,fullName:'Học Viên Mẫu',isActive:1});
  const initial = spckSessionRepo.saveSessionDraft({classId,studentId,sessionNumber:13,localFolderPath:folder,isConfirmedByTeacher:1,projectTitle:'Website tiệm bánh',thumbnailPath:thumbnail,screenshotsJson:'[]',attachmentsJson:'[]',youtubeUrlsJson:'[]',relatedLinksJson:'[]',teacherComment:'Con hoàn thành giao diện.',teacherNote:'Giao diện rõ ràng',quickTagsJson:'[]'});
  const initialVersion = initial.record.draftVersion;
  const captured = spckUploadRepo.updateSharedResources({classId,studentId,expectedFolderPath:folder,thumbnailPath:newThumbnail,screenshotsJson:JSON.stringify([thumbnail]),syncSessionNumber:13});
  assert.equal(captured.updated,true);
  const afterCapture = spckSessionRepo.findOne(classId,studentId,13);
  assert.equal(afterCapture.draftVersion,initialVersion+1);
  const response = await saveDraft(new Request('http://127.0.0.1:3000/api/spck/save-draft',{method:'POST',headers:{host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000','content-type':'application/json'},body:JSON.stringify({classId,studentId,sessionNumber:13,expectedVersion:initialVersion,localFolderPath:folder,projectTitle:'Website tiệm bánh',thumbnailPath:thumbnail})}));
  const body = await response.json();
  assert.equal(response.status,409);
  assert.equal(body.conflict,true);
  const observation = {id:'DB01',initialVersion,afterCaptureVersion:afterCapture.draftVersion,attemptedVersion:initialVersion,httpStatus:response.status,response:body};
  fs.writeFileSync(path.join(process.cwd(),'docs/audits/v340/s5b-round1/repository-observations.json'),JSON.stringify(observation,null,2));
  console.log(JSON.stringify(observation,null,2));
  // Keep fixture files in TEMP for reproducibility; never inspect production data.
}
main().catch(err=>{console.error(err);process.exitCode=1;});
