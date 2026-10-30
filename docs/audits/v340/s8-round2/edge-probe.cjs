const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {createRequire}=require('node:module');
const req=createRequire(path.join(process.cwd(),'package.json'));
const results=[];
async function check(name,fn){try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:String(e.stack||e)});}}
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'mindx-s8-r2-edges-'));
const allowed=path.join(fixture,'allowed'),denied=path.join(fixture,'denied');
fs.mkdirSync(allowed);fs.mkdirSync(denied);fs.mkdirSync(path.join(allowed,'safe-child'));fs.mkdirSync(path.join(denied,'PRIVATE_SYNTHETIC_CHILD'));
fs.symlinkSync(denied,path.join(allowed,'escape'),'junction');
fs.symlinkSync(path.join(allowed,'safe-child'),path.join(allowed,'safe-link'),'junction');
const request=body=>new Request('http://127.0.0.1:3000/api/spck/test',{method:'POST',headers:{host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000','content-type':'application/json'},body:JSON.stringify(body)});
async function main(){
  const {config}=req('./src/lib/config.ts'); config.allowedLocalDirs=[allowed,process.env.MINDX_DB_PATH];
  const security=req('./src/lib/security/path-allowlist.ts');
  const {POST}=req('./src/app/api/spck/browse-folder/route.ts');
  const registry=path.join(process.cwd(),'data/config/teacher_browsed_dirs.json');
  const registryBefore=fs.existsSync(registry)?fs.readFileSync(registry):null;
  const originalRead=fs.readdirSync;let forbiddenReads=0;
  fs.readdirSync=function(p,...args){if(path.resolve(String(p)).startsWith(denied))forbiddenReads++;return originalRead.call(this,p,...args);};
  for(const [name,body] of [
    ['outside-path',{path:denied}],['outside-initialDir',{initialDir:denied}],
    ['traversal',{path:path.join(allowed,'..','denied')}],['junction-direct',{path:path.join(allowed,'escape')}],
    ['outside-nonexistent',{path:path.join(denied,'missing')}]
  ]) await check(name,async()=>{const r=await POST(request({action:'list',...body}));assert.equal(r.status,403);const b=await r.json();assert.equal(b.directories,undefined);});
  await check('outside-not-read-or-registered',()=>{assert.equal(forbiddenReads,0);assert.equal(security.isPathAllowed(denied),false);const after=fs.existsSync(registry)?fs.readFileSync(registry):null;assert.deepEqual(after,registryBefore);});
  fs.readdirSync=originalRead;
  await check('allowed-200-junction-filter-and-metadata',async()=>{const r=await POST(request({action:'list',path:allowed}));assert.equal(r.status,200);const b=await r.json();assert(b.directories.some(x=>x.name==='safe-child'));assert(b.directories.some(x=>x.name==='safe-link'));assert(!b.directories.some(x=>x.name==='escape'));assert.equal(b.parentPath,null);for(const p of [...b.drives,...b.quickLinks.map(x=>x.path),...b.directories.map(x=>x.path)])assert(security.isPathAllowed(p)&&security.isPathAllowed(fs.realpathSync(p)),p);});
  await check('allowed-initialDir-200',async()=>{const r=await POST(request({action:'list',initialDir:allowed}));assert.equal(r.status,200);});
  await check('allowed-child-parent',async()=>{const r=await POST(request({action:'list',path:path.join(allowed,'safe-child')}));assert.equal(r.status,200);assert.equal((await r.json()).parentPath,allowed);});
  await check('default-start-is-allowed',async()=>{const r=await POST(request({action:'list'}));assert.equal(r.status,200);assert(security.isPathAllowed((await r.json()).currentPath));});
  await check('invalid-allowed-config-fallback-safe',async()=>{config.allowedLocalDirs=[denied+'-nonexistent'];try{const r=await POST(request({action:'list'}));assert.equal(r.status,200);assert(security.isPathAllowed((await r.json()).currentPath));}finally{config.allowedLocalDirs=[allowed,process.env.MINDX_DB_PATH];}});
  const {SequentialTaskQueue}=req('./src/lib/queue/task-queue.ts');
  const {spckUploadRepo}=req('./src/lib/db/sqlite.ts');
  const shots=req('./src/lib/local-files/spck-app-screenshotter.ts');
  const queue=SequentialTaskQueue.getInstance();
  await check('Stop-before-batch-rejects-before-repository-read',async()=>{const orig=spckUploadRepo.findByClass;let reads=0;spckUploadRepo.findByClass=()=>{reads++;return [];};queue.stopQueue();try{await assert.rejects(shots.captureClassAppScreenshotsAndSelectThumbnails({classId:'S8_STOP',useAiVision:false}),/TASK_CANCELLED/);assert.equal(reads,0);}finally{spckUploadRepo.findByClass=orig;queue.resumeQueue();}});
  await check('Stop-between-students-prevents-second-capture',async()=>{const folder=path.join(allowed,'web');fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'index.html'),'<html><body><h1>S8 synthetic page</h1><p>Only offline fixture</p></body></html>');const find=spckUploadRepo.findByClass,update=spckUploadRepo.updateSharedResources;let writes=0;spckUploadRepo.findByClass=()=>[{studentId:'S8_A',localFolderPath:folder},{studentId:'S8_B',localFolderPath:folder}];spckUploadRepo.updateSharedResources=()=>{writes++;queue.stopQueue();};try{await assert.rejects(shots.captureClassAppScreenshotsAndSelectThumbnails({classId:'S8_STOP',useAiVision:false}),/TASK_CANCELLED/);assert.equal(writes,1);}finally{spckUploadRepo.findByClass=find;spckUploadRepo.updateSharedResources=update;queue.resumeQueue();}});
  await check('capture-route-enqueues-UPLOAD_SPCK-and-serializes',async()=>{const {POST:capture}=req('./src/app/api/spck/capture-screenshots/route.ts');const orig=queue.enqueue;let release,enteredResolve;const gate=new Promise(r=>release=r),entered=new Promise(r=>enteredResolve=r);let jobs=[],active=0,max=0;queue.enqueue=function(task){jobs.push(task);return orig.call(this,{...task,execute:async()=>{active++;max=Math.max(max,active);try{if(jobs.length===1){enteredResolve();await gate;}return await task.execute();}finally{active--;}}});};try{const p1=capture(request({classId:'S8_QUEUE_A',useAiVision:false}));await entered;const p2=capture(request({classId:'S8_QUEUE_B',useAiVision:false}));await new Promise(r=>setTimeout(r,30));assert.equal(queue.getStatus().pendingCount,1);release();const rs=await Promise.all([p1,p2]);const bodies=await Promise.all(rs.map(r=>r.json()));assert.deepEqual(rs.map(r=>r.status),[200,200],JSON.stringify(bodies));assert.equal(jobs.length,2);assert(jobs.every(t=>t.jobType==='UPLOAD_SPCK'));assert.equal(max,1);}finally{release();queue.enqueue=orig;}});
  await check('stopped-capture-route-does-not-start-job',async()=>{const {POST:capture}=req('./src/app/api/spck/capture-screenshots/route.ts');queue.stopQueue();try{const r=await capture(request({classId:'S8_QUEUE_STOP',useAiVision:false}));assert.equal(r.status,500);assert.match((await r.json()).error,/QUEUE_STOPPED/);}finally{queue.resumeQueue();}});
  const fixtureRes=spawnSync('python',['-c',`import json,base64\nfrom PyQt6.QtGui import QImage,QColor\nfrom PyQt6.QtCore import QByteArray,QBuffer,QIODevice\nim=QImage(80,60,QImage.Format.Format_RGB32);im.fill(QColor(20,120,240))\nout={}\nfor fmt in ['PNG','JPEG','WEBP']:\n b=QByteArray();q=QBuffer(b);q.open(QIODevice.OpenModeFlag.WriteOnly);assert im.save(q,fmt);out[fmt]=base64.b64encode(bytes(b)).decode('ascii')\nprint(json.dumps(out))`],{encoding:'utf8',env:{...process.env,QT_QPA_PLATFORM:'offscreen'}});
  const formats=fixtureRes.status===0?JSON.parse(fixtureRes.stdout):{};
  const {normalizeImagesToLms16x9}=req('./src/lib/local-files/spck-image-normalizer.ts');
  for(const fmt of ['PNG','JPEG','WEBP','GIF'])await check('normalizer-'+fmt+'-contain-cover',async()=>{assert.equal(fixtureRes.status,0,fixtureRes.stderr);const buf=fmt==='GIF'?Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64'):Buffer.from(formats[fmt],'base64');const images=await normalizeImagesToLms16x9([{buffer:buf,fit:'contain'},{buffer:buf,fit:'cover'}]);for(const b of images){assert(b);assert.equal(b.readUInt32BE(16),960);assert.equal(b.readUInt32BE(20),540);}});
  await check('normalizer-invalid-and-empty-input',async()=>{assert.deepEqual(await normalizeImagesToLms16x9([]),[]);assert.deepEqual(await normalizeImagesToLms16x9([{buffer:Buffer.from('broken'),fit:'contain'}]),[null]);});
  const output={fixtureOnly:true,fixture,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
  fs.writeFileSync(process.env.AUDIT_EXTRA_OUT,JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));if(output.failed)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
