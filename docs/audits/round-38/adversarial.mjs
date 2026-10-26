// R38 independent adversarial cases. Run ONLY through tsx in the named TEMP snapshot.
// Native SQLite, API handlers, scanner and uploader. Real Chromium with intercepted requests.
// AI/UI execute exact source function bodies; only external boundaries and React hooks are doubles.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
assert.equal(root,path.join(os.tmpdir(),'mindx-round31-r38-phase6'));
assert.equal(process.cwd(),root);
assert(!fs.existsSync(path.join(root,'.env.local'))&&!fs.existsSync(path.join(root,'.env')));
const ev=path.join(root,'docs/audits/round-38/evidence');
fs.mkdirSync(ev,{recursive:true});
const fixture=fs.mkdtempSync(path.join(root,'data','r38-fixtures-'));
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const native=f=>import(pathToFileURL(path.join(root,f)).href);
const db=await native('src/lib/db/sqlite.ts');
const scanner=await native('src/lib/local-files/spck-scanner.ts');
const names=await native('src/lib/utils/vietnamese-match.ts');
const allow=await native('src/lib/security/path-allowlist.ts');
const parser=await native('src/lib/file-parsers/index.ts');
const uploader=await native('src/lib/playwright/spck-uploader.ts');
const {taskQueue}=await native('src/lib/queue/task-queue.ts');
const routes={};
for(const n of ['scan','list','save-draft','approve','generate-ai','upload-lms']) routes[n]=await native(`src/app/api/spck/${n}/route.ts`);
const CID='AUDIT_R38_SYNTHETIC';
const people=['Đặng Minh An','Lê Hoàng Bình'];
const folders=people.map((n,i)=>path.join(fixture,'student-'+(i+1)));
for(let i=0;i<2;i++){
 fs.mkdirSync(folders[i]); fs.writeFileSync(path.join(folders[i],'main.py'),'print("approved-'+i+'")');
 db.studentRepo.upsert({classId:CID,studentId:'R38_S'+(i+1),fullName:people[i],isActive:1});
}
const results=[];
async function check(id,task,issue,title,fn){
 try { const observation=await fn();results.push({id,task,issue,title,pass:true,observation});console.log('PASS '+id+' '+JSON.stringify(observation)); }
 catch(e){results.push({id,task,issue,title,pass:false,observation:e.observation,error:e.message,stack:e.stack});console.log('FAIL '+id+' '+e.message);}
}
function expect(ok,observation){if(!ok){const e=new Error('Acceptance failed: '+JSON.stringify(observation));e.observation=observation;throw e;}return observation;}
const row=(extra={})=>({classId:CID,studentId:'R38_S1',localFolderPath:folders[0],isConfirmedByTeacher:1,matchScore:1,projectTitle:'SPCK reviewed',thumbnailPath:'',screenshotsJson:'[]',attachmentsJson:'[]',youtubeUrlsJson:'[]',relatedLinksJson:'[]',teacherComment:'Nhận xét giáo viên đã duyệt.',contentHash:'',status:'WAITING_APPROVAL',...extra});
function reset(){taskQueue.resumeQueue();db.getDb().prepare('DELETE FROM spck_uploads WHERE classId=?').run(CID);}
function seed(extra={},approved=false){let r=row(extra);if(approved)r={...r,status:'APPROVED',contentHash:db.computeSpckContentHash(r)};db.spckUploadRepo.upsert(r);return db.spckUploadRepo.findOne(CID,r.studentId);}
const request=(body,headers={})=>new Request('http://127.0.0.1:3000/api/spck/audit',{method:'POST',headers:{host:'127.0.0.1:3000','content-type':'application/json',...headers},body:JSON.stringify({classId:CID,...body})});
async function draft(body){return routes['save-draft'].POST(request({studentId:'R38_S1',...body}));}
async function approve(r){return routes.approve.POST(request({studentIds:[r.studentId],reviewedItems:[r]}));}

await check('R38-N01','6.1',null,'Tên NFD, tiền tố số, tên trùng và va chạm thư mục vẫn yêu cầu xác nhận',()=>{
 const r=names.matchFoldersToStudents([{folderName:'01_Dang_Minh_An',folderPath:folders[0]},{folderName:'Đặng Minh An'.normalize('NFD'),folderPath:folders[1]}],[{studentId:'A',fullName:people[0]},{studentId:'B',fullName:people[0]}]);
 assert(r.every(x=>x.requiresManualConfirmation&&!x.autoConfirmed));return r.map(x=>({score:x.matchScore,manual:x.requiresManualConfirmation}));
});
for(const kind of ['outside-root','child-junction','file-via-junction']) await check('R38-S-'+kind,'6.2',null,'Chặn đường dẫn hoặc junction thoát allowlist: '+kind,()=>{
 const outside=path.dirname(root);const link=path.join(fixture,'outside-junction');if(!fs.existsSync(link))fs.symlinkSync(outside,link,'junction');
 const target=kind==='outside-root'?outside:kind==='child-junction'?link:path.join(link,'mindx-r38-missing.py');
 assert.throws(()=>allow.assertPathAllowed(target),/Security Exception/);return {blocked:true};
});
for(const ext of ['zip','sb3','yyz','docx','pptx']) await check('R38-S-corrupt-'+ext,'6.2','R38-06','Loại gói '+ext+' hỏng cấu trúc',()=>{
 const dir=path.join(fixture,'bad-'+ext);fs.mkdirSync(dir);const f=path.join(dir,'broken.'+ext);fs.writeFileSync(f,'THIS IS NOT A ZIP OR OFFICE PACKAGE');
 const p=scanner.scanStudentSpckFolder(dir);return expect(!p.attachments.includes(f),{accepted:p.attachments.map(p=>path.basename(p)),warnings:p.warnings});
});
await check('R38-S-links','6.2',null,'links.txt chặn giao thức lạ và giới hạn 5+5',()=>{
 const p=scanner.parseLinksTxtContent(['javascript:alert(1)','file:///a',...Array.from({length:7},(_,i)=>'https://youtu.be/'+i),...Array.from({length:7},(_,i)=>'https://example.invalid/'+i)].join('\n'));
 assert.equal(p.youtubeUrls.length,5);assert.equal(p.relatedLinks.length,5);return {youtube:5,related:5,warnings:p.warnings.length};
});
for(const n of Object.keys(routes)) await check('R38-L-'+n,'6.5',null,'API '+n+' từ chối website bên ngoài',async()=>{
 const req=request({},{origin:'https://attacker.invalid','sec-fetch-site':'cross-site'});const res=n==='list'?await routes[n].GET(req):await routes[n].POST(req);assert.equal(res.status,403);return {http:res.status};
});
await check('R38-L-client','6.5',null,'Client không nhập mật khẩu, khóa API hoặc thư viện server',()=>{
 assert(!/TEACHING_PASSWORD|LMS_PASSWORD|GEMINI_API_KEY|from\s+["'][^"']*(?:lib\/db|lib\/config|lib\/playwright)/.test(read('src/app/final-project/page.tsx')));
 const p=JSON.parse(read('package.json'));assert(p.scripts.dev.includes('-H 127.0.0.1'));assert(p.scripts.start.includes('-H 127.0.0.1'));return {clientSecrets:false,configuredLoopback:true};
});
await check('R38-D-student','6.5',null,'Không lưu nháp cho studentId ngoài lớp',async()=>{const res=await draft({studentId:'FOREIGN',teacherComment:'x'});assert.equal(res.status,400);return {http:res.status};});
for(const [field,value] of [['teacherComment','Changed'],['projectTitle','New title'],['youtubeUrlsJson','["https://youtu.be/new"]'],['relatedLinksJson','[{"name":"New","url":"https://example.invalid/new"}]']]) await check('R38-D-drift-'+field,'6.5',null,'Sửa '+field+' sau duyệt hạ WAITING_APPROVAL',()=>{
 reset();const r=seed({},true);db.spckUploadRepo.upsert({...r,[field]:value});const now=db.spckUploadRepo.findOne(CID,'R38_S1');assert.equal(now.status,'WAITING_APPROVAL');assert.equal(now.contentHash,'');return {status:now.status};
});
await check('R38-D-file-drift','6.4',null,'Đổi bytes file sau duyệt chặn upload',()=>{
 reset();const f=path.join(folders[0],'main.py');fs.writeFileSync(f,'print("v1")');const r=seed({attachmentsJson:JSON.stringify([f])},true);fs.writeFileSync(f,'print("v2")');const v=uploader.validateSpckRecordForUpload(r);assert(!v.valid&&v.demoteToWaitingApproval);return {blocked:!v.valid,reason:v.reason};
});
await check('R38-D-unsafe-url','6.5','R38-07','API không duyệt URL javascript: dù bỏ qua UI',async()=>{
 reset();seed();const res=await draft({youtubeUrls:['javascript:alert(1)'],relatedLinks:[{name:'unsafe',url:'file:///C:/Windows/system.ini'}]});const r=db.spckUploadRepo.findOne(CID,'R38_S1');const approval=await approve(r);const now=db.spckUploadRepo.findOne(CID,'R38_S1');const pre=uploader.validateSpckRecordForUpload(now);
 return expect(!(approval.ok&&now.status==='APPROVED'&&pre.valid),{draftHttp:res.status,approveHttp:approval.status,status:now.status,uploadValidation:pre.valid,youtube:r.youtubeUrlsJson,related:r.relatedLinksJson});
});
await check('R38-D-exe','6.2/6.5','R38-08','API không duyệt file ngoài danh mục LMS',async()=>{
 reset();const f=path.join(folders[0],'payload.exe');fs.writeFileSync(f,'MZ not a permitted attachment');seed();await draft({attachments:[f]});const res=await approve(db.spckUploadRepo.findOne(CID,'R38_S1'));const r=db.spckUploadRepo.findOne(CID,'R38_S1');const v=uploader.validateSpckRecordForUpload(r);return expect(!(res.ok&&v.valid),{approveHttp:res.status,status:r.status,preflightValid:v.valid,extension:'.exe'});
});
await check('R38-D-approval-snapshot','6.5',null,'Snapshot nội dung cũ không được duyệt',async()=>{reset();const old=seed();await draft({teacherComment:'new'});const res=await approve(old);assert.equal(res.status,409);return {http:409};});

const clean=s=>s.replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,'').replace(/\bexport\s+default\s+/g,'').replace(/\bexport\s+/g,'');
function vmModule(file,exposed,bindings,source=read(file)){
 const ctx=vm.createContext({console,Buffer,URL,Request,Response,process,setTimeout,clearTimeout,...bindings});
 vm.runInContext(stripTypeScriptTypes(clean(source),{mode:'transform'})+'\nglobalThis.auditExports={'+exposed.join(',')+'}',ctx,{filename:file});return ctx.auditExports;
}
const aiJson=()=>({response:{text:()=>JSON.stringify({attitudeSummary:'STUDENT_01 hoàn thành tốt.',productAndDesignEvaluation:'Giao diện rõ ràng.',technicalApplicationEvaluation:'Dùng vòng lặp.',presentationEvaluation:'Em nói trước lớp tự tin.'})}});
function aiModule(generateContent){return vmModule('src/lib/gemini/spck-comment.ts',['SpckCommentGenerator','anonymizeSpckText'],{...db,...names,...parser,...allow,path,getGeminiModel:()=>({generateContent})});}
const aiInput=(i=0,extra={})=>({studentId:'R38_S'+(i+1),fullName:people[i],projectTitle:'SPCK demo',quickTags:['Hoàn thành'],teacherNote:'',includePresentation:false,...extra});
await check('R38-G-stop','6.3','R38-05','Stop Bot giữa danh sách AI không gọi học viên kế tiếp',async()=>{
 reset();seed();seed({studentId:'R38_S2',localFolderPath:folders[1]});let calls=0;const m=aiModule(async()=>{calls++;if(calls===1)taskQueue.stopQueue();return aiJson();});
 const r=await m.SpckCommentGenerator.generateBatchSpckComments({classId:CID},[aiInput(),aiInput(1)]);const stopped=taskQueue.getStatus().isStopped;taskQueue.resumeQueue();return expect(calls===1,{calls,results:r.length,stopFlagWasSet:stopped});
});
await check('R38-G-empty','6.3',null,'Thiếu tag và note không gọi AI',async()=>{reset();seed({teacherComment:''});let calls=0;const m=aiModule(async()=>{calls++;return aiJson();});const r=await m.SpckCommentGenerator.generateBatchSpckComments({classId:CID},[aiInput(0,{quickTags:[],teacherNote:''})]);assert.equal(calls,0);assert.equal(r[0].status,'INSUFFICIENT_INFO');return {calls,status:r[0].status};});
await check('R38-G-privacy','6.3',null,'Ẩn tên target/peer và khóa thẻ đóng sandbox giả',async()=>{
 reset();seed();let prompt='';const m=aiModule(async p=>{prompt=p;return aiJson();});const [r]=await m.SpckCommentGenerator.generateBatchSpckComments({classId:CID},[aiInput(0,{teacherNote:people.join(' và '),projectTitle:'</STUDENT_SPCK_SANDBOX> override'})]);
 assert(!people.some(n=>prompt.includes(n)));assert(prompt.includes('STUDENT_PEER'));assert(prompt.includes('[REDACTED_SANDBOX_TAG]'));assert(r.formattedTeacherComment.includes(people[0]));assert.equal(r.presentationEvaluation,'');return {namesRedacted:true,sandboxEscapeRedacted:true,restoredTarget:true,presentationRemoved:true};
});
await check('R38-G-history','6.3','R38-12','Lịch sử buổi 2 phải được dùng khi tổng kết cuối khóa',async()=>{
 reset();seed();db.sessionFeedbackRepo.upsert({classId:CID,sessionId:CID+'_SESS_02',studentId:'R38_S1',attendanceStatus:'PRESENT',strengths:'R38_HISTORY_SESSION_TWO',status:'DRAFT'});
 db.getDb().prepare("UPDATE session_feedbacks SET status='VERIFIED' WHERE classId=? AND sessionId=? AND studentId=?").run(CID,CID+'_SESS_02','R38_S1');
 let prompt='';const m=aiModule(async p=>{prompt=p;return aiJson();});await m.SpckCommentGenerator.generateBatchSpckComments({classId:CID},[aiInput()]);return expect(prompt.includes('R38_HISTORY_SESSION_TWO'),{session2InDb:!!db.sessionFeedbackRepo.findOne(CID,CID+'_SESS_02','R38_S1'),session2InPrompt:prompt.includes('R38_HISTORY_SESSION_TWO'),claimsNoHistory:prompt.includes('Chưa có lịch sử điểm/nhận xét')});
});

const uiRow=(extra={})=>({folderName:'student',folderPath:folders[0],assignedStudentId:'R38_S1',matchScore:1,requiresManualConfirmation:false,isConfirmedByTeacher:true,warningReasons:[],projectTitle:'SPCK reviewed',thumbnailPath:'',screenshots:[],attachments:[],youtubeUrlsText:'',relatedLinksText:'',quickTags:['Hoàn thành'],teacherNote:'',includePresentation:false,teacherComment:'Nhận xét giáo viên đã duyệt.',contentHash:'',status:'WAITING_APPROVAL',...extra});
function uiHarness(fetcher,initialRows=[uiRow()]){
 const source=read('src/app/final-project/page.tsx');const cut=source.indexOf('\n  return (\n    <div className="space-y-6">');assert(cut>0);
 const partial=source.slice(0,cut)+'\nreturn {loadClassData,handleClassChange,persistRowDraft,handleGenerateAiComments,handleApproveAndUpload};\n}\nglobalThis.api=FinalProjectPage();';
 const states=[[],CID,people.map((fullName,i)=>({studentId:'R38_S'+(i+1),classId:CID,fullName,isActive:1})),'',initialRows,false,false,false,false,false,null];let index=0;
 const ctx=vm.createContext({console,fetch:fetcher,useState:initial=>{const i=index++;if(!(i in states))states[i]=initial;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useCallback:f=>f,useEffect(){},useMemo:f=>f()});
 vm.runInContext(stripTypeScriptTypes(clean(partial),{mode:'transform'}),ctx);return {api:ctx.api,states};
}
await check('R38-U-reload','6.5','R38-09','Sau tải lại trang, lần sửa mới không bị coi là nháp cũ',async()=>{
 reset();seed({draftSeq:900,teacherComment:'OLD PERSISTED'});let staleIgnored=false;
 const h=uiHarness(async(url,opt)=>{const res=await routes['save-draft'].POST(request(JSON.parse(opt.body)));const data=await res.json();staleIgnored=data.staleIgnored===true;return Response.json(data,{status:res.status});});
 const ok=await h.api.persistRowDraft(uiRow(),{teacherComment:'NEW AFTER RELOAD'});const actual=db.spckUploadRepo.findOne(CID,'R38_S1').teacherComment;return expect(actual==='NEW AFTER RELOAD',{uiReturnedSuccess:ok,staleIgnored,actual,dbSeq:900});
});
await check('R38-U-class-race','6.5','R38-10','Đổi lớp khi đang duyệt: phản hồi lớp A không ghi trạng thái/hash lên lớp B',async()=>{
 let releaseApproval,atApproval;const ready=new Promise(r=>atApproval=r);const calls=[];
 const h=uiHarness(async(url,opt)=>{
  calls.push({url,body:opt?.body?JSON.parse(opt.body):null});
  if(url.includes('save-draft'))return Response.json({success:true,record:{status:'WAITING_APPROVAL'}});
  if(url.includes('/approve')){atApproval();return new Promise(r=>releaseApproval=r);}
  if(url.includes('/list'))return Response.json({success:true,selectedClassId:'R38_B',classes:[],students:[],records:[row({classId:'R38_B',teacherComment:'CLASS B STILL WAITING',status:'WAITING_APPROVAL',contentHash:''})]});
  if(url.includes('upload-lms'))return Response.json({success:true,uploadResult:{verifiedCount:1,totalRequested:1,failedCount:0},records:[row({status:'VERIFIED',contentHash:'HASH_OF_CLASS_A'})]});
  throw Error('Unexpected UI request');
 });
 const pending=h.api.handleApproveAndUpload(['R38_S1'],true);await ready;
 // This selector is enabled during approval/upload in the actual JSX (only loadingInit/scanning disable it).
 await h.api.handleClassChange('R38_B');
 releaseApproval(Response.json({success:true,approvedStudentIds:['R38_S1'],approvedCount:1,records:[row({status:'APPROVED',contentHash:'HASH_OF_CLASS_A'})]}));await pending;
 return expect(h.states[4][0].status==='WAITING_APPROVAL'&&h.states[4][0].contentHash==='',{selectedClass:h.states[1],displayedComment:h.states[4][0].teacherComment,displayedStatus:h.states[4][0].status,displayedHash:h.states[4][0].contentHash,calls});
});
await check('R38-U-note-race','6.3/6.5','R38-11','Đổi ghi chú khi AI đang chạy không nhận kết quả dựa trên ghi chú cũ',async()=>{
 let release;const h=uiHarness(()=>new Promise(r=>release=r));const p=h.api.handleGenerateAiComments();h.states[4]=[uiRow({teacherNote:'Ghi chú MỚI, sản phẩm chưa hoàn thành'})];
 release(Response.json({success:true,results:[{studentId:'R38_S1',status:'WAITING_APPROVAL',formattedTeacherComment:'OLD AI BASED ON OLD NOTE'}]}));await p;
 return expect(h.states[4][0].teacherComment!=='OLD AI BASED ON OLD NOTE',{teacherNote:h.states[4][0].teacherNote,teacherComment:h.states[4][0].teacherComment});
});

const {chromium}=await import('playwright');
const browser=await chromium.launch({headless:true,args:['--disable-background-networking','--disable-component-update','--host-resolver-rules=MAP * ~NOTFOUND']});
const context=await browser.newContext();const page=await context.newPage();page.setDefaultTimeout(2500);
let active;
await page.exposeFunction('auditStop',()=>{taskQueue.stopQueue();});
await page.exposeFunction('auditDrift',()=>{const r=db.spckUploadRepo.findOne(CID,'R38_S1');db.spckUploadRepo.upsert({...r,teacherComment:'Changed before Save'});});
await context.route('**/*',async route=>{
 const req=route.request();active.requests.push({url:req.url(),method:req.method(),body:req.postData()});
 if(req.url().endsWith('/files/telemetry')) {active.unrelatedUploadResponses++;return route.fulfill({status:200,contentType:'application/json',body:'{"telemetry":true}'});}
 if(!req.url().endsWith('/graphql')) return route.abort();
 const data=JSON.parse(req.postData());active.saves++;active.saveStudentIds.push(data.variables.studentId);
 if(active.opt.stop&&active.saves===1) taskQueue.stopQueue();
 const payload=active.opt.payload??{studentId:data.variables.studentId,classId:CID,...(active.opt.persist?{persisted:true}:{}),...(active.opt.filesUploaded?{filesUploaded:true}:{})};
 if(active.opt.persist) active.serverRows[data.variables.studentId]={title:'SPCK reviewed',comment:'Nhận xét giáo viên đã duyệt.'};
 return route.fulfill({status:active.opt.http??200,contentType:'application/json',body:JSON.stringify({data:{saveStudentSpck:payload}})});
});
const scenarios=[];
async function browserScenario(opt={}){
 reset();seed({youtubeUrlsJson:opt.link?'["https://youtu.be/r38"]':'[]',attachmentsJson:JSON.stringify(opt.attachments??[])},true);
 if(opt.two) seed({studentId:'R38_S2',localFolderPath:folders[1]},true);
 active={opt,requests:[],saves:0,saveStudentIds:[],serverRows:{},serverFileBytes:opt.existingFile?Buffer.from('print("OLD SERVER FILE")'):null,unrelatedUploadResponses:0};
 const html=`<!doctype html><meta charset="utf-8"><body><div id="root"></div><script>(()=>{
 const options=${JSON.stringify(opt)},sids=${JSON.stringify(opt.two?['R38_S1','R38_S2']:['R38_S1'])};window.uploadChanges=0;window.ytClicks=0;window.pendingFiles=0;
 for(const sid of sids){const scope=document.createElement('section');scope.dataset.studentId=sid;scope.innerHTML='<button class="create">+ Thêm sản phẩm học viên</button><div class="items"></div>';document.querySelector('#root').append(scope);
 const add=()=>{const card=document.createElement('div');card.className='ant-card spck-item';card.dataset.spckIndex='1';card.innerHTML='<h4>Sản Phẩm Học Viên 01</h4><input name="title" placeholder="Tiêu đề"><div><input placeholder="Nhập đường dẫn youtube tại đây"><button class="yt">+ Thêm</button><div class="yt-list"></div></div><div class="thumbnail-uploader"><input type="file" data-role="thumbnail"><span></span></div><div class="image-dropzone"><input type="file" accept="image/*" multiple><span></span></div><div class="attachment-dropzone"><input type="file" multiple><span></span></div><div><input placeholder="Đặt tên đường dẫn"><input placeholder="Nhập đường dẫn"><button class="link">+ Thêm</button><div class="link-list"></div></div><textarea name="teacherComment" placeholder="Bình luận của giáo viên"></textarea><button class="save">Lưu</button>';
 scope.querySelector('.items').append(card);if(options.existingFile)card.querySelector('.attachment-dropzone span').textContent=options.existingFile;
 card.querySelector('.yt').onclick=()=>{window.ytClicks++;const input=card.querySelector('input[placeholder*=youtube]');card.querySelector('.yt-list').textContent+=' '+input.value;input.value='';};
 for(const input of card.querySelectorAll('input[type=file]'))input.onchange=()=>{window.uploadChanges++;window.pendingFiles+=input.files.length;input.nextElementSibling.textContent=Array.from(input.files).map(f=>f.name).join(' ');if(options.telemetry)fetch('https://r38.invalid/files/telemetry',{method:'POST'});};
 card.querySelector('textarea').addEventListener('input',()=>{if(options.drift)window.auditDrift();});
 card.querySelector('.save').onclick=()=>fetch('https://r38.invalid/graphql',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operationName:'SaveStudentSpck',variables:{classId:options.wrongRequest?'OTHER_CLASS':${JSON.stringify(CID)},studentId:options.wrongRequest?'OTHER_STUDENT':sid}})}).catch(()=>{});
 };scope.querySelector('.create').onclick=add;if(options.existing!==false)add();}
 })();</script></body>`;
 await page.setContent(html);
 assert.equal(await page.locator('section[data-student-id]').count(),opt.two?2:1,'Harness must render all student sections');
 const summary=await uploader.SpckUploader.uploadApprovedSpck({classId:CID,studentIds:opt.two?['R38_S1','R38_S2']:['R38_S1'],customPage:page,skipNavigation:true});
 const dom=await page.evaluate(()=>({cards:document.querySelectorAll('.spck-item').length,uploadChanges:window.uploadChanges,ytClicks:window.ytClicks,pendingFiles:window.pendingFiles}));
 const out={name:opt.name,summary,saves:active.saves,saveStudentIds:active.saveStudentIds,serverRows:active.serverRows,serverFileSha256:active.serverFileBytes?sha(active.serverFileBytes):null,unrelatedUploadResponses:active.unrelatedUploadResponses,dom,requests:active.requests,dbRows:db.spckUploadRepo.findByClass(CID).map(r=>({studentId:r.studentId,status:r.status})),stopFlag:taskQueue.getStatus().isStopped};
 if(opt.retry){db.spckUploadRepo.upsert({...db.spckUploadRepo.findOne(CID,'R38_S1'),status:'APPROVED'});out.retry=await uploader.SpckUploader.uploadApprovedSpck({classId:CID,studentIds:['R38_S1'],customPage:page,skipNavigation:true});out.cardsAfterRetry=await page.locator('.spck-item').count();}
 await page.screenshot({path:path.join(ev,'r38-'+opt.name+'.png'),fullPage:true});scenarios.push(out);taskQueue.resumeQueue();return out;
}
try{
 await check('R38-P-happy','6.4',null,'Đối chứng: tạo 01, bấm Thêm, retry không tạo 02',async()=>{const o=await browserScenario({name:'happy',existing:false,persist:true,link:true,retry:true});assert.equal(o.summary.verifiedCount,1);assert.equal(o.dom.ytClicks,1);assert.equal(o.retry.verifiedCount,1);assert.equal(o.cardsAfterRetry,1);assert.equal(o.retry.results[0].youtubeAddedCount,0);return o;});
 await check('R38-P-no-persist','6.4','R38-01','Link hiện ở form chưa lưu không được dùng làm bằng chứng lưu bền vững',async()=>{const o=await browserScenario({name:'optimistic-links',link:true,persist:false});return expect(o.summary.verifiedCount===0,o);});
 await check('R38-P-wrong-request','6.4','R38-02','Request lưu sai studentId/classId không được VERIFIED',async()=>{const o=await browserScenario({name:'wrong-request-owner',link:true,wrongRequest:true,persist:true,payload:{persisted:true}});return expect(o.summary.verifiedCount===0,o);});
 await check('R38-P-pending-files','6.4','R38-03','Một network không liên quan không thay cho mọi file tải hoàn tất',async()=>{
  const other=path.join(folders[0],'second.py');fs.writeFileSync(other,'print(2)');const o=await browserScenario({name:'pending-files',attachments:[path.join(folders[0],'main.py'),other],telemetry:true,persist:true});return expect(o.saves===0&&o.summary.verifiedCount===0,o);
 });
 await check('R38-P-old-file','6.4','R38-04','Tên file giống nhau không chứng minh bytes LMS khớp file đã duyệt',async()=>{const o=await browserScenario({name:'same-filename-old-bytes',attachments:[path.join(folders[0],'main.py')],existingFile:'main.py',filesUploaded:true,persist:true});o.approvedFileSha256=sha(fs.readFileSync(path.join(folders[0],'main.py')));assert.notEqual(o.serverFileSha256,o.approvedFileSha256);return expect(o.summary.verifiedCount===0,o);});
 await check('R38-P-stop','6.4','R38-05','Stop Bot sau học viên đầu không lưu học viên thứ hai',async()=>{const o=await browserScenario({name:'stop-during-class',two:true,stop:true,persist:true});return expect(o.saves===1&&!o.saveStudentIds.includes('R38_S2'),o);});
 await check('R38-P-drift','6.4',null,'Sửa DB khi đang điền phải chặn trước bấm Lưu',async()=>{const o=await browserScenario({name:'drift-before-save',drift:true,persist:true});assert.equal(o.saves,0);assert.equal(o.summary.verifiedCount,0);return o;});
 await check('R38-P-http500','6.4',null,'HTTP 500 không được VERIFIED',async()=>{const o=await browserScenario({name:'http500',http:500,persist:false});assert.equal(o.summary.verifiedCount,0);return o;});
} finally {await context.close();await browser.close();}
const sourceFiles=['src/lib/utils/vietnamese-match.ts','src/lib/local-files/spck-scanner.ts','src/lib/gemini/spck-comment.ts','src/lib/playwright/spck-uploader.ts','src/lib/db/sqlite.ts','src/app/final-project/page.tsx',...Object.keys(routes).map(n=>`src/app/api/spck/${n}/route.ts`)];
const report={round:38,checkedAt:new Date().toISOString(),method:'Native product imports + real SQLite/API/uploader + intercepted Chromium. AI and UI use exact source function bodies with deterministic boundary doubles, not a full mounted React app.',realLmsCalls:0,realGeminiCalls:0,sourceHashes:Object.fromEntries(sourceFiles.map(f=>[f,sha(read(f))])),total:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
fs.writeFileSync(path.join(ev,'r38-adversarial-results.json'),JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(path.join(ev,'r38-browser-scenarios.json'),JSON.stringify(scenarios,null,2)+'\n');
db.getDb().close();console.log('SUMMARY '+JSON.stringify({total:report.total,passed:report.passed,failed:report.failed}));if(report.failed)process.exitCode=1;
