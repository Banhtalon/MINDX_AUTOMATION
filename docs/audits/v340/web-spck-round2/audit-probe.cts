const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const zlib = require('node:zlib');
const { Module } = require('node:module');
const swc = require('next/dist/build/swc');
const AdmZip = require('adm-zip');
const scanner = require('./src/lib/local-files/spck-scanner');
const dbmod = require('./src/lib/db/sqlite');
const deployer = require('./src/lib/github/spck-web-deployer');
const { POST } = require('./src/app/api/spck/scan/route');
const root = path.join(process.cwd(), 'temp_submissions', 'independent-web-probe');
const auditDir = path.dirname(process.cwd());
const checks = [];
const observations = {};
fs.mkdirSync(root, { recursive: true });
const write = (p, data) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); return p; };
const names = zipPath => new AdmZip(zipPath).getEntries().filter(e => !e.isDirectory).map(e => e.entryName).sort();
const zipOf = p => (p.allAttachments || []).find(p => /_web_package\.zip$/i.test(p));
const request = (classId, folderPath, sessionNumber = 12) => new Request('http://127.0.0.1:3000/api/spck/scan', {
  method: 'POST', headers: { 'content-type': 'application/json', host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' },
  body: JSON.stringify({ classId, folderPath, sessionNumber })
});
async function check(id, fn) {
  try { await fn(); checks.push({ id, status: 'PASS' }); console.log('PASS', id); }
  catch (e) { checks.push({ id, status: 'FAIL', error: String(e.stack || e) }); console.log('FAIL', id, e.message); }
}
function crc32(b) { let c = 0xffffffff; for (const v of b) { c ^= v; for (let i=0;i<8;i++) c=(c>>>1)^((c&1)?0xedb88320:0); } return (c^0xffffffff)>>>0; }
function chunk(t,b) { const n=Buffer.alloc(4), c=Buffer.alloc(4), type=Buffer.from(t);n.writeUInt32BE(b.length);c.writeUInt32BE(crc32(Buffer.concat([type,b])));return Buffer.concat([n,type,b,c]); }
function png(w=64,h=64,seed=1,noisy=false) {
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;
  const raw=Buffer.alloc((1+w*3)*h,seed);let s=seed;
  if(noisy) for(let i=0;i<raw.length;i++){s^=s<<13;s^=s>>>17;s^=s<<5;raw[i]=s&255;}
  for(let y=0;y<h;y++)raw[y*(1+w*3)]=0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
function seed(classId, students) {
  for(const sessionNumber of [12,13,14]) dbmod.classSessionRepo.upsert({classId,sessionId:`${classId}_${sessionNumber}`,className:classId,sessionNumber,topic:'Synthetic audit',date:'2026-11-03'});
  for(const s of students) dbmod.studentRepo.upsert({classId,studentId:s.id,fullName:s.name,isActive:1});
}
// Execute the actual private staging collector without changing any on-disk application file.
// This checkout has no function named collectStudentWebFiles; the production call is copyWebDirectoryRecursive.
const deployPath=path.join(process.cwd(),'src/lib/github/spck-web-deployer.ts');
const privateSource=fs.readFileSync(deployPath,'utf8')+'\nexport { copyWebDirectoryRecursive, ensureRootIndexHtmlEntry };';
const privateModule=new Module(deployPath,module);privateModule.filename=deployPath;privateModule.paths=Module._nodeModulePaths(path.dirname(deployPath));
privateModule._compile(swc.transformSync(privateSource,{filename:'audit-deployer.ts',jsc:{parser:{syntax:'typescript'},target:'es2022'},module:{type:'commonjs'}}).code,deployPath);
const {copyWebDirectoryRecursive,ensureRootIndexHtmlEntry}=privateModule.exports;

async function main(){
  assert.equal(process.env.ALLOWED_LOCAL_DIRS,process.env.TEMP);
  assert.equal(process.env.MINDX_DB_PATH,path.join(process.env.TEMP,'mindx_codex_web_spck.db'));
  for(const table of ['spck_session_submissions','spck_uploads','students','classes_sessions','job_logs'])dbmod.getDb().prepare(`DELETE FROM ${table} WHERE classId=?`).run('TEST_AUDIT_WEB_SPCK');
  const web=path.join(root,'Web Nested');
  const expected=[];
  for(let i=0;i<15;i++) { const rel=i===0?'HTML/main/index.html':i%3===0?`HTML/main/page${i}.html`:i%3===1?`CSS/style${i}.css`:`JS/file${i}.js`; expected.push(rel);write(path.join(web,rel),i===0?'<html><body>Audit nested site</body></html>':`/* source ${i} */`); }
  for(const ext of ['htm','mjs','json','txt','text','md','csv','xml']){const rel=`HTML/main/extra.${ext}`;expected.push(rel);write(path.join(web,rel),ext==='json'?'{}':`valid ${ext}`);}
  write(path.join(web,'HTML/main/zero.html'),'');write(path.join(web,'HTML/main/blank.html'),' \n\t');write(path.join(web,'JS/null.js'),Buffer.from([97,0,98]));
  for(let i=0;i<24;i++)write(path.join(web,'images',`asset${i}.png`),png());
  for(const d of ['Articles','LCourses','printer accessories','img'])write(path.join(web,d,'asset.png'),png());
  write(path.join(web,'Icon.png'),png());
  let pkg;
  await check('P01_nested_web_assets_and_valid_zip',()=>{pkg=scanner.scanStudentSpckFolder(web);const zip=zipOf(pkg);assert.ok(zip);assert.equal(scanner.validateSpckAttachmentFile(zip).valid,true);assert.deepEqual(pkg.screenshots,[]);assert.deepEqual(names(zip),expected.sort());observations.nested={attachments:pkg.attachments.map(p=>path.basename(p)),entries:names(zip),screenshots:pkg.screenshots};});
  await check('P02_rescan_no_nested_zip',()=>{const second=scanner.scanStudentSpckFolder(web);assert.equal(second.allAttachments.length,1);assert.deepEqual(names(zipOf(second)),expected.sort());assert.ok(names(zipOf(second)).every(n=>!/_web_package\.zip$/i.test(n)));});
  await check('P03_deployer_depth2_and3_staging_privacy',()=>{
    for(const d of ['_spck_app_shots','_spck_owner_uploads','_spck_youtube_frames'])write(path.join(web,d,'private.png'),png());
    write(path.join(web,'image.jfif'),Buffer.from([255,216,255,217]));write(path.join(web,'description.text'),'audit text');
    const entry=deployer.findStudentWebRootAndEntryHtml(web);assert.equal(entry.entryRelativePath,'HTML/main/index.html');
    const out=path.join(root,'staging');copyWebDirectoryRecursive(web,out,out);ensureRootIndexHtmlEntry(out,entry.entryRelativePath,out);
    for(const d of ['_spck_app_shots','_spck_owner_uploads','_spck_youtube_frames'])assert.equal(fs.existsSync(path.join(out,d)),false);
    assert.equal(fs.existsSync(path.join(out,path.basename(zipOf(pkg)))),false);assert.ok(fs.existsSync(path.join(out,'image.jfif')));assert.ok(fs.existsSync(path.join(out,'description.text')));
    assert.ok(fs.readFileSync(path.join(out,'index.html'),'utf8').includes('./HTML/main/index.html'));
    const depth3=path.join(root,'Depth3');write(path.join(depth3,'html/main/site/index.html'),'<h1>depth3</h1>');assert.equal(deployer.findStudentWebRootAndEntryHtml(depth3).entryRelativePath,'html/main/site/index.html');
  });
  const classId='TEST_AUDIT_WEB_SPCK';const mixed=path.join(root,'Mixed');const good=path.join(mixed,'Nguyen Audit Tot'),bad=path.join(mixed,'Tran Audit Loi');
  seed(classId,[{id:'AUDIT_GOOD',name:'Nguyễn Audit Tốt'},{id:'AUDIT_BAD',name:'Trần Audit Lỗi'}]);
  write(path.join(good,'index.html'),'<h1>good</h1>');write(path.join(bad,'index.html'),'<h1>bad</h1>');
  for(let i=0;i<13;i++)write(path.join(bad,'_spck_owner_uploads',`photo${i}.png`),png(64,64,i+1));
  let mixedData;
  await check('P04_api_mixed_200_warning_valid_record',async()=>{const res=await POST(request(classId,mixed));mixedData=await res.json();assert.equal(res.status,200);assert.equal(mixedData.success,true);assert.ok(mixedData.warning);assert.ok(mixedData.records.some(r=>r.studentId==='AUDIT_GOOD'));assert.equal(dbmod.spckUploadRepo.findOne(classId,'AUDIT_BAD'),undefined);observations.mixed={status:res.status,warning:mixedData.warning,records:mixedData.records.map(r=>r.studentId)};});
  await check('P05_api_all_invalid_400',async()=>{const allBad=path.join(root,'AllBad');fs.mkdirSync(allBad,{recursive:true});fs.cpSync(bad,path.join(allBad,path.basename(bad)),{recursive:true});const res=await POST(request(classId,allBad));const body=await res.json();assert.equal(res.status,400);assert.equal(body.success,false);});
  await check('P06_untouched_drafts_all_sessions_refresh',async()=>{
    const old=write(path.join(good,'old.js'),'/* old */');
    dbmod.spckUploadRepo.upsert({classId,studentId:'AUDIT_GOOD',localFolderPath:good,projectTitle:'Audit site',baseProjectTitle:'Audit site',thumbnailPath:scanner.DEFAULT_SPCK_THUMBNAIL_PATH,attachmentsJson:JSON.stringify([old]),screenshotsJson:'[]',isConfirmedByTeacher:1,status:'DRAFT'});
    for(const s of [12,13,14]){dbmod.spckSessionRepo.getOrInitSessionDraft(classId,'AUDIT_GOOD',s);dbmod.spckSessionRepo.saveSessionDraft({classId,studentId:'AUDIT_GOOD',sessionNumber:s,attachmentsJson:JSON.stringify([old]),teacherComment:'',teacherNote:'',draftStatus:'DRAFT',updateSharedPool:false});}
    fs.unlinkSync(old);const newer=write(path.join(good,'new.js'),'/* new */');
    const res=await POST(request(classId,mixed));assert.equal(res.status,200);
    for(const s of [12,13,14]){const r=dbmod.spckSessionRepo.findOne(classId,'AUDIT_GOOD',s);assert.ok(JSON.parse(r.attachmentsJson).includes(newer));assert.equal(r.teacherComment,'');assert.equal(r.draftStatus,'DRAFT');}
  });
  await check('P07_commented_waiting_approved_verified_preserved',async()=>{
    for(const [s,status] of [[12,'WAITING_APPROVAL'],[13,'APPROVED'],[14,'VERIFIED']]){
      dbmod.spckSessionRepo.saveSessionDraft({classId,studentId:'AUDIT_GOOD',sessionNumber:s,teacherComment:`Nhận xét giữ nguyên ${s}`,teacherNote:'Ghi chú riêng',updateSharedPool:false});
      dbmod.getDb().prepare('UPDATE spck_session_submissions SET draftStatus=?, lastVerifiedAt=? WHERE classId=? AND studentId=? AND sessionNumber=?').run(status,s===14?'2026-11-01T00:00:00.000Z':null,classId,'AUDIT_GOOD',s);
    }
    const before=[12,13,14].map(s=>dbmod.spckSessionRepo.findOne(classId,'AUDIT_GOOD',s));write(path.join(good,'additional.js'),'/* after approval */');
    const res=await POST(request(classId,mixed,13));assert.equal(res.status,200);for(let i=0;i<3;i++)assert.deepEqual(dbmod.spckSessionRepo.findOne(classId,'AUDIT_GOOD',i+12),before[i]);
  });
  await check('P08_stale_root_assets_removed_from_shared_pool',async()=>{
    const stale=write(path.join(good,'images/old.png'),png());const shot=write(path.join(good,'_spck_app_shots/app_01_abcdef.png'),png());
    dbmod.spckUploadRepo.upsert({...dbmod.spckUploadRepo.findOne(classId,'AUDIT_GOOD'),thumbnailPath:shot,screenshotsJson:JSON.stringify([stale,shot])});
    const res=await POST(request(classId,mixed));const body=await res.json();observations.staleRescan={status:res.status,error:body.error};assert.equal(res.status,200);const r=dbmod.spckUploadRepo.findOne(classId,'AUDIT_GOOD');assert.ok(!JSON.parse(r.screenshotsJson).includes(stale));assert.ok(JSON.parse(r.screenshotsJson).includes(shot));
  });
  await check('P09_root_htm_over10_must_bundle',()=>{const p=path.join(root,'RootHtm');for(let i=0;i<12;i++)write(path.join(p,`page${i}.htm`),'<h1>htm</h1>');const r=scanner.scanStudentSpckFolder(p);observations.rootHtm={attachments:r.allAttachments,warnings:r.warnings};assert.ok(zipOf(r),'12 .htm hợp lệ nhưng không tạo ZIP');});
  await check('P10_root_mjs_over10_must_bundle',()=>{const p=path.join(root,'RootMjs');write(path.join(p,'index.html'),'<h1>module app</h1>');for(let i=0;i<12;i++)write(path.join(p,`app${i}.mjs`),'export default 1;');const r=scanner.scanStudentSpckFolder(p);observations.rootMjs={attachments:r.allAttachments,warnings:r.warnings};assert.ok(zipOf(r),'index.html + 12 .mjs nhưng không tạo ZIP');});
  await check('P11_subfolder_mjs_must_bundle',()=>{const p=path.join(root,'NestedMjs');write(path.join(p,'index.html'),'<script type="module" src="./modules/app.mjs"></script>');write(path.join(p,'modules/app.mjs'),'export default 1;');const r=scanner.scanStudentSpckFolder(p);observations.nestedMjs={attachments:r.allAttachments};assert.ok(zipOf(r),'Mã .mjs trong thư mục con bị bỏ sót');});
  await check('P12_large_valid_source_must_not_disappear',()=>{const p=path.join(root,'LargeSource');write(path.join(p,'index.html'),'<h1>large</h1>');const big=write(path.join(p,'large.js'),'/*'+ 'a'.repeat(5*1024*1024)+'*/');write(path.join(p,'CSS/style.css'),'body{}');assert.equal(scanner.validateSpckAttachmentFile(big).valid,true);const r=scanner.scanStudentSpckFolder(p);observations.largeSource={attachments:r.allAttachments,zipEntries:names(zipOf(r)),warnings:r.warnings};assert.ok(names(zipOf(r)).includes('large.js') || r.allAttachments.includes(big),'large.js hợp lệ >5MB biến mất khỏi cả ZIP và danh sách đính kèm');});
  await check('P13_blank_root_html_must_be_ignored',()=>{const p=path.join(root,'BlankRoot');write(path.join(p,'index.html'),'<h1>real</h1>');const blank=write(path.join(p,'empty.html'),' \n\t');const r=scanner.scanStudentSpckFolder(p);observations.blankRoot={attachments:r.allAttachments};assert.ok(!r.allAttachments.includes(blank),'HTML chỉ chứa khoảng trắng vẫn được đính kèm');});
  await check('P14_ui_preserves_approved_attachment_snapshot',async()=>{
    const res=await POST(request(classId,mixed,13));const data=await res.json();const saved=data.records.find(r=>r.studentId==='AUDIT_GOOD');
    const source=fs.readFileSync(path.join(process.cwd(),'src/app/final-project/page.tsx'),'utf8');const start=source.indexOf('  const handleScanFolder = async (');const end=source.indexOf('  const persistRowDraft = async (',start);assert.ok(start>0&&end>start);
    let uiRows=[];const ctx={rows:[],folderPathInput:mixed,selectedClassId:classId,activeUiClassId:classId,selectedSessionNumber:13,setScanning:()=>{},setBannerMessage:()=>{},setRows:r=>uiRows=r,setSelectedStudentIds:()=>{},fetch:async()=>({json:async()=>data}),parseJsonSafe:(s,f)=>{try{return JSON.parse(s)}catch{return f}},formatUiSessionTitle:s=>s,stripUiSessionSuffix:s=>s,serializeRelatedLinksToText:ls=>JSON.stringify(ls),parseSessionResultsMap:()=>({}),isDefaultUiProductTitle:()=>false,getSessionSlotDisplay:()=>({label:'Chưa nộp'})};
    vm.createContext(ctx);vm.runInContext(swc.transformSync(source.slice(start,end)+'\nglobalThis.scan=handleScanFolder;', {filename:'audit-ui.ts',jsc:{parser:{syntax:'typescript'},target:'es2022'},module:{type:'es6'}}).code,ctx);await ctx.scan();
    const ui=uiRows.find(r=>r.assignedStudentId==='AUDIT_GOOD');observations.uiApproved={status:ui.status,dbAttachments:JSON.parse(saved.attachmentsJson),uiAttachments:ui.attachments,hasNewerSharedResources:ui.hasNewerSharedResources};assert.equal(JSON.stringify(ui.attachments),saved.attachmentsJson,'UI hiển thị tài nguyên mới thay cho bộ đính kèm đã duyệt');
  });
  await check('P15_null_source_not_bundled',()=>{const r=scanner.scanStudentSpckFolder(web);assert.ok(!names(zipOf(r)).includes('JS/null.js'));});
  await check('P16_large_html_capture_real_offline',async()=>{
    const p=path.join(root,'LargeCapture');let html='<html><body><h1>Large local images audit</h1>';
    let bytes=0;for(let i=0;i<24;i++){const b=png(640,360,i+1,true);bytes+=b.length;write(path.join(p,'images',`large${i}.png`),b);html+=`<img width="320" height="180" src="images/large${i}.png">`;}
    write(path.join(p,'index.html'),html+'</body></html>');
    const {captureStudentAppScreenshots}=require('./src/lib/local-files/spck-app-screenshotter');const r=await captureStudentAppScreenshots({studentId:'AUDIT_CAPTURE',folderPath:p,useAiVision:false,maxShots:2});observations.largeCapture={inputBytes:bytes,screenshots:r.galleryScreenshots,thumbnail:r.thumbnailPath};
    const outputs=[r.thumbnailPath,...r.galleryScreenshots].filter(p=>p.includes('_spck_app_shots'));assert.ok(outputs.length>0);assert.ok(outputs.some(p=>!/synthetic|reconstruct|fallback/i.test(path.basename(p))),'Chỉ sinh ảnh phục dựng thay vì ảnh chụp offline');for(const f of outputs)assert.deepEqual(scanner.extractImageDimensionsFromBuffer(fs.readFileSync(f),'.png'),{width:960,height:540});
  });
  await check('P17_root_html_js_over10_bundles_correctly',()=>{const p=path.join(root,'RootHtmlJs');for(let i=0;i<13;i++)write(path.join(p,i===0?'index.html':`app${i}.js`),i===0?'<h1>Root project</h1>':'/* valid */');const r=scanner.scanStudentSpckFolder(p);assert.equal(r.allAttachments.length,1);assert.equal(names(zipOf(r)).length,13);assert.equal(scanner.validateSpckAttachmentFile(zipOf(r)).valid,true);});
  await check('P18_draft_teacher_note_or_comment_preserved',async()=>{
    for(const [s,comment,note] of [[12,'Nhận xét nháp riêng',''],[13,'','Ghi chú giáo viên']]){dbmod.getDb().prepare('UPDATE spck_session_submissions SET draftStatus=?,lastVerifiedAt=NULL,teacherComment=?,teacherNote=? WHERE classId=? AND studentId=? AND sessionNumber=?').run('DRAFT',comment,note,classId,'AUDIT_GOOD',s);}
    const before=[12,13].map(s=>dbmod.spckSessionRepo.findOne(classId,'AUDIT_GOOD',s));write(path.join(good,'keepNote.js'),'/* preserve teacher edits */');const res=await POST(request(classId,mixed,12));assert.equal(res.status,200);for(let i=0;i<2;i++)assert.deepEqual(dbmod.spckSessionRepo.findOne(classId,'AUDIT_GOOD',i+12),before[i]);
  });
  await check('P19_draft_with_verified_history_preserved',async()=>{
    dbmod.getDb().prepare('UPDATE spck_session_submissions SET draftStatus=?,teacherComment=?,teacherNote=? WHERE classId=? AND studentId=? AND sessionNumber=?').run('DRAFT','','',classId,'AUDIT_GOOD',14);const before=dbmod.spckSessionRepo.findOne(classId,'AUDIT_GOOD',14);assert.ok(before.lastVerifiedAt);write(path.join(good,'historyProtected.js'),'/* preserve verified history */');const res=await POST(request(classId,mixed,14));assert.equal(res.status,200);assert.deepEqual(dbmod.spckSessionRepo.findOne(classId,'AUDIT_GOOD',14),before);
  });
  const result={time:new Date().toISOString(),passed:checks.filter(c=>c.status==='PASS').length,failed:checks.filter(c=>c.status==='FAIL').length,checks,observations};
  fs.writeFileSync(path.join(auditDir,'probe-results.json'),JSON.stringify(result,null,2));dbmod.closeDb();console.log('PROBE_RESULT',JSON.stringify({passed:result.passed,failed:result.failed}));process.exitCode=result.failed?1:0;
}
main().catch(e=>{console.error(e);dbmod.closeDb();process.exitCode=2;});
