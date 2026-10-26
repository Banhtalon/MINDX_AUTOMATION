// Run ONLY in the disposable clone: node --import tsx docs/audits/round-40/adversarial.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
assert.equal(fs.realpathSync(root).toLowerCase(), path.join(os.tmpdir(), 'mindx-round40-phase7').toLowerCase(), 'Refuse running outside exact TEMP clone');
assert(!fs.lstatSync(path.join(root, 'src')).isSymbolicLink(), 'src must be a real copy');
assert.equal(process.env.ESBUILD_BINARY_PATH, path.join(os.tmpdir(), 'mindx-esbuild.exe'));
for (const key of ['TEACHING_PASSWORD','LMS_PASSWORD','GEMINI_API_KEY','MINDX_PASSWORD']) delete process.env[key];
const imp = p => import(pathToFileURL(path.join(root,p)).href);
const configRoute = await imp('src/app/api/config/route.ts');
const control = await imp('src/app/api/queue/control/route.ts');
const stream = await imp('src/app/api/queue/stream/route.ts');
const json = await imp('src/lib/db/json-config.ts');
const dbmod = await imp('src/lib/db/sqlite.ts');
const { taskQueue: queue } = await imp('src/lib/queue/task-queue.ts');
const { assertPathAllowed } = await imp('src/lib/security/path-allowlist.ts');
const evidence = path.join(root,'docs/audits/round-40/evidence');
fs.mkdirSync(evidence,{recursive:true});
const tests=[];
async function check(id, finding, fn) {
  try { const detail = await fn(); tests.push({id,finding,status:'PASS',detail:detail ?? null}); }
  catch(e) { tests.push({id,finding,status:'FAIL',detail:String(e.message).slice(0,1400)}); }
}
const headers={host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000','content-type':'application/json'};
const req=(url,body,extra={},method=body===undefined?'GET':'POST')=>new Request('http://127.0.0.1:3000'+url,{method,headers:{...headers,...extra},...(method==='POST'?{body:JSON.stringify(body)}:{})});
const post=async(section,value)=>configRoute.POST(req('/api/config',{section,[section]:value}));
const get=async()=> (await configRoute.GET(req('/api/config'))).json();
const course=(code='PTA')=>({courseCode:code,courseName:'Synthetic '+code,description:'R40 fixture',sessions:[{sessionNumber:1,topic:'Topic',keyKnowledge:['Loop'],homeworkBrief:'Code a loop'}]});
const criterion=(id,points)=>({criterionId:id,name:id,maxPoints:points,description:'Evidence',expectedSnippetOrConcept:'for'});
const rubric=()=>({rubricId:'R40-R',courseCode:'PTA',sessionNumber:1,assignmentTitle:'Loop',assignmentPrompt:'Write a loop',maxTotalScore:999,criteria:[criterion('C1',40),criterion('C2',60)]});
const tag=(id='T1')=>({id,label:'Participates',sentiment:'positive',hint:'Participates in class'});
const category=()=>({category:'attitude',categoryName:'Attitude',tags:[tag()]});
const template=(id='Z1')=>({id,name:id,template:'Class {{className}} learned {{topic}}'});
const files=['courses_syllabus.json','grading_rubrics.json','quick_tags.json','zalo_templates.json'];
const backups=new Map(files.map(f=>[path.join(root,'data/config',f),fs.readFileSync(path.join(root,'data/config',f))]));
async function seed() { await post('courses',[course()]); await post('rubrics',[rubric()]); await post('quickTags',[category()]); await post('zaloTemplates',[template()]); }
async function reject(section,value) {
  await seed(); const before=JSON.stringify((await get())[section]); const res=await post(section,value);
  assert.equal(res.status,400,`Invalid ${section} accepted HTTP ${res.status}; saved=${JSON.stringify((await get())[section])}`);
  assert.equal(JSON.stringify((await get())[section]),before,'Rejected write changed stored data');
}
let context;
try {
  for(const [name,handler,url,body] of [['config-get',configRoute.GET,'/api/config',undefined],['config-post',configRoute.POST,'/api/config',{section:'courses',courses:[]}],['stream',stream.GET,'/api/queue/stream',undefined],['control-get',control.GET,'/api/queue/control',undefined],['control-post',control.POST,'/api/queue/control',{action:'stop'}]]) {
    for(const [attack,extra] of [['origin',{origin:'https://attacker.invalid'}],['host',{host:'attacker.invalid:3000'}],['cross-site',{'sec-fetch-site':'cross-site'}],['null-origin',{origin:'null'}]]) {
      await check(`security-${name}-${attack}`,null,async()=>assert.equal((await handler(req(url,body,extra))).status,403));
    }
  }
  await check('path-outside-root',null,()=>assert.throws(()=>assertPathAllowed(path.join(os.tmpdir(),'round40-outside.json')),/Security Exception/));
  await check('path-traversal',null,()=>assert.throws(()=>assertPathAllowed(path.join(root,'..','outside.json')),/Security Exception/));
  await check('config-junction-escape-blocked',null,async()=>{
    const dir=path.join(root,'data/config'),backup=path.join(root,'data/config-r40-backup');
    fs.renameSync(dir,backup);
    try {fs.symlinkSync(path.join(root,'node_modules'),dir,'junction');assert.equal((await configRoute.GET(req('/api/config'))).status,500);assert.equal((await post('courses',[course()])).status,500);}
    finally {if(fs.existsSync(dir))fs.unlinkSync(dir);fs.renameSync(backup,dir);}
  });
  await check('config-crud-all-sections',null,async()=>{
    await seed();
    for(const [section,value] of [['courses',[course(),course('JSB')]],['rubrics',[rubric(),{...rubric(),rubricId:'R2',sessionNumber:2}]],['quickTags',[category(),{...category(),category:'execution'}]],['zaloTemplates',[template(),template('Z2')]]]) {
      assert.equal((await post(section,value)).status,200); assert.equal((await get())[section].length,2);
      assert.equal((await post(section,value.slice(0,1))).status,200); assert.equal((await get())[section].length,1);
    }
    const c=course(); c.sessions[0].topic='Changed'; c.sessions.push({...c.sessions[0],sessionNumber:2});
    await post('courses',[c]); assert.equal((await get()).courses[0].sessions.length,2);
    c.sessions.splice(0,1); await post('courses',[c]); assert.equal((await get()).courses[0].sessions[0].sessionNumber,2);
    assert.equal((await get()).rubrics[0].maxTotalScore,100);
  });
  await check('reject-scale-10',null,async()=>{const r=rubric();r.criteria=[criterion('C1',10)];await reject('rubrics',[r]);});
  await check('reject-duplicate-course-id',null,()=>reject('courses',[course(),course('pta')]));
  await check('reject-duplicate-rubric-id',null,()=>reject('rubrics',[rubric(),rubric()]));
  for(const section of ['courses','rubrics','quickTags']) await check(`empty-${section}`,'R40-01',()=>reject(section,[]));
  await check('malformed-course-sessions','R40-01',()=>reject('courses',[{...course(),sessions:'not-an-array'}]));
  await check('malformed-course-code','R40-01',()=>reject('courses',[{...course(),courseCode:{a:1}}]));
  await check('blank-session-topic','R40-01',()=>reject('courses',[{...course(),sessions:[{...course().sessions[0],topic:'   '}]}]));
  await check('malformed-quicktag-tags','R40-01',()=>reject('quickTags',[{...category(),tags:'not-an-array'}]));
  await check('zalo-invalid-row-silently-dropped','R40-01',()=>reject('zaloTemplates',[template(),{...template('Z2'),template:'   '}]));
  await check('rubric-negative-session','R40-01',()=>reject('rubrics',[{...rubric(),sessionNumber:-1}]));
  for(const n of [-1,0,0.2]) await check(`bad-session-${n}`,'R40-01',()=>reject('courses',[{...course(),sessions:[{...course().sessions[0],sessionNumber:n}]}]));
  await check('duplicate-session-id','R40-02',()=>reject('courses',[{...course(),sessions:[course().sessions[0],{...course().sessions[0],topic:'Conflicting topic'}]}]));
  await check('duplicate-criterion-id','R40-02',async()=>{const r=rubric();r.criteria[1].criterionId='C1';await reject('rubrics',[r]);});
  await check('duplicate-quicktag-id','R40-02',()=>reject('quickTags',[{...category(),tags:[tag(),{...tag(),label:'Opposite',sentiment:'constructive'}]}]));
  await check('duplicate-category-id','R40-02',()=>reject('quickTags',[category(),category()]));
  await check('duplicate-zalo-id','R40-02',()=>reject('zaloTemplates',[template(),{...template(),template:'Conflicting template'}]));
  for(const n of [-5,0,'NaN',null,true]) await check(`invalid-points-${n}`,'R40-03',async()=>{const r=rubric();r.criteria=[criterion('C1',n),criterion('C2',99)];await reject('rubrics',[r]);});
  await check('round-positive-to-zero','R40-03',async()=>{const r=rubric();r.criteria=[criterion('C1',0.001),criterion('C2',100)];await reject('rubrics',[r]);});
  await check('json-overflow-infinity','R40-03',async()=>{
    await seed();const r=rubric();r.criteria=[criterion('C1','OVERFLOW'),criterion('C2',99)];
    const body=JSON.stringify({section:'rubrics',rubrics:[r]}).replace('"OVERFLOW"','1e309');
    const res=await configRoute.POST(new Request('http://127.0.0.1:3000/api/config',{method:'POST',headers,body}));
    assert.equal(res.status,400,`Overflow accepted ${res.status}`);
  });
  await check('stale-two-client-save','R40-04',async()=>{
    await seed(); const a=(await get()).courses; const b=(await get()).courses;
    a[0].courseName='Teacher A revision'; b[0].description='Teacher B revision';
    assert.equal((await post('courses',a)).status,200); const rb=await post('courses',b); const final=(await get()).courses;
    assert(rb.status===409 || (final[0].courseName==='Teacher A revision' && final[0].description==='Teacher B revision'),`Both writes succeeded; final=${JSON.stringify(final)}`);
  });
  await check('approved-verified-preserved-config-and-stop',null,async()=>{
    const db=dbmod.getDb();const hw=[];const sp=[];
    for(const status of ['APPROVED','VERIFIED']) {
      const h={submissionId:'R40-H-'+status,classId:'R40-PTA',sessionId:'R40-PTA_SESS_1',studentId:'R40-S-'+status,fileHash:'fixturehash',parseStatus:'PARSED',criteriaGradesJson:JSON.stringify([criterion('C1',100)]),calculatedScore:80,decision:'GRADE',feedbackHtml:'Synthetic feedback',status};h.contentHash=dbmod.computeHomeworkContentHash(h);dbmod.homeworkSubmissionRepo.upsert(h);hw.push(h.submissionId);
      const s={classId:'R40-PTA',studentId:'R40-S-'+status,isConfirmedByTeacher:1,projectTitle:'Fixture',teacherComment:'Synthetic',status};s.contentHash=dbmod.computeSpckContentHash(s);dbmod.spckUploadRepo.upsert(s);sp.push(s.studentId);
    }
    const before=JSON.stringify({h:db.prepare("SELECT * FROM homework_submissions WHERE classId='R40-PTA' ORDER BY submissionId").all(),s:db.prepare("SELECT * FROM spck_uploads WHERE classId='R40-PTA' ORDER BY studentId").all()});
    for(const table of ['homework_submissions','spck_uploads'])assert.deepEqual(db.prepare(`SELECT status FROM ${table} WHERE classId='R40-PTA' ORDER BY status`).all().map(r=>r.status),['APPROVED','VERIFIED']);
    await seed();const r=rubric();r.criteria=[criterion('DIFFERENT',100)];await post('rubrics',[r]);await post('courses',[course('JSB')]);await control.POST(req('/api/queue/control',{action:'stop'}));
    const after=JSON.stringify({h:db.prepare("SELECT * FROM homework_submissions WHERE classId='R40-PTA' ORDER BY submissionId").all(),s:db.prepare("SELECT * FROM spck_uploads WHERE classId='R40-PTA' ORDER BY studentId").all()});assert.equal(after,before);queue.resumeQueue();
    return {homework:hw.length,spck:sp.length,byteEquivalentRows:true};
  });
  await check('queue-pending-stop-serial-preserves',null,async()=>{
    queue.resumeQueue();let release;let active=0,max=0,second=false;
    const gate=new Promise(r=>release=r);
    const first=queue.enqueue({id:'R40-first',jobType:'CUSTOM',description:'Synthetic',execute:async()=>{max=Math.max(max,++active);await gate;active--;}});
    const pending=queue.enqueue({id:'R40-second',jobType:'CUSTOM',description:'Synthetic',execute:async()=>{second=true;max=Math.max(max,++active);active--;}}).then(()=>false,e=>e.message.includes('TASK_CANCELLED'));
    await control.POST(req('/api/queue/control',{action:'stop'}));assert.equal(await pending,true);release();await first;await new Promise(r=>setImmediate(r));assert.equal(second,false);assert.equal(max,1);assert.equal(queue.getStatus().pendingCount,0);queue.resumeQueue();
  });
  await check('sse-final-status-is-idle','R40-08',async()=>{
    queue.resumeQueue();const statuses=[];const off=queue.subscribeStatus(s=>statuses.push(structuredClone(s)));
    try {await queue.enqueue({id:'R40-idle',jobType:'CUSTOM',description:'Synthetic idle',execute:async()=>42});await new Promise(r=>setImmediate(r));assert.equal(queue.getStatus().isRunning,false);assert.equal(statuses.at(-1).isRunning,false,`Last emitted status=${JSON.stringify(statuses.at(-1))}; actual idle=true`);} finally {off();}
  });
  await check('sse-live-and-cleanup-60-connections',null,async()=>{
    const emitter=queue.emitter;const before=[emitter.listenerCount('log'),emitter.listenerCount('status')];
    for(let i=0;i<60;i++) {
      const ac=new AbortController(); const request=new Request('http://127.0.0.1:3000/api/queue/stream',{headers,signal:ac.signal});
      const response=await stream.GET(request);const reader=response.body.getReader();const dec=new TextDecoder();
      assert(dec.decode((await reader.read()).value).includes('STATUS'));assert(dec.decode((await reader.read()).value).includes('RECENT_LOGS'));
      queue.log({jobId:'R40-SSE',jobType:'CUSTOM',level:'INFO',message:'R40 synthetic event'});assert(dec.decode((await reader.read()).value).includes('R40 synthetic event'));
      if(i%2) ac.abort(); await reader.cancel();assert.deepEqual([emitter.listenerCount('log'),emitter.listenerCount('status')],before);
    }
    return {connections:60,listenersBefore:before,listenersAfter:[emitter.listenerCount('log'),emitter.listenerCount('status')]};
  });
  await check('phase5-batch-halts-next-student','R40-05',async()=>{
    const {HomeworkGradeWorker}=await imp('src/lib/playwright/grade-worker.ts');
    const {BrowserManager}=await imp('src/lib/playwright/browser-manager.ts');
    const {authService}=await imp('src/lib/playwright/auth.ts');const {LmsHelpers}=await imp('src/lib/playwright/lms-helpers.ts');
    const original=[BrowserManager.getInstance,authService.ensureAuthenticated,LmsHelpers.openClassDrawer,LmsHelpers.switchDrawerTab];
    let touched=0;const page={waitForTimeout:async()=>{},locator:()=>{touched++;throw Error('R40_BROWSER_BOUNDARY_AFTER_STOP');}};
    BrowserManager.getInstance=()=>({getPage:async()=>page});authService.ensureAuthenticated=async()=>{};LmsHelpers.openClassDrawer=async()=>{};LmsHelpers.switchDrawerTab=async()=>{};
    const db=dbmod.getDb();
    for(let i=1;i<=2;i++){const h={submissionId:'R40-BATCH-'+i,classId:'R40-BATCH',sessionId:'R40-BATCH_SESS_1',studentId:'R40-BS-'+i,fileHash:'fixture',parseStatus:'PARSED',criteriaGradesJson:'[]',calculatedScore:80,decision:'GRADE',feedbackHtml:'Synthetic',status:'APPROVED'};h.contentHash=dbmod.computeHomeworkContentHash(h);dbmod.homeworkSubmissionRepo.upsert(h);}
    try {
      // Trigger Stop during first student's browser interaction; subsequent student must be skipped.
      page.locator=()=>{touched++;if(touched>=2)queue.stopQueue();throw Error('R40_BROWSER_BOUNDARY_AFTER_STOP');};
      queue.resumeQueue(); const result=await HomeworkGradeWorker.saveApprovedGrades({classId:'R40-BATCH',classCode:'R40-BATCH',sessionId:'R40-BATCH_SESS_1'});
      const second=db.prepare("SELECT status FROM homework_submissions WHERE submissionId='R40-BATCH-2'").get();
      assert.equal(second.status,'APPROVED',`Next student processed after Stop: ${JSON.stringify({result,second,touched})}`);
    } finally {[BrowserManager.getInstance,authService.ensureAuthenticated,LmsHelpers.openClassDrawer,LmsHelpers.switchDrawerTab]=original;queue.resumeQueue();}
  });
  await check('launcher-windows-npm-failure-detected','R40-06',async()=>{
    const source=fs.readFileSync(path.join(root,'start-bot.bat'),'utf8');
    const block=source.slice(source.indexOf('if not exist "node_modules"'),source.indexOf(':: 4.'));
    const fixture=path.join(root,'launcher with spaces');fs.mkdirSync(fixture,{recursive:true});
    fs.writeFileSync(path.join(fixture,'npm.cmd'),'@echo off\r\nexit /b 37\r\n');
    fs.writeFileSync(path.join(fixture,'install-block.cmd'),'@echo off\r\nsetlocal EnableDelayedExpansion\r\ncmd /d /c exit 0\r\n'+block+'\r\necho R40_REACHED_SERVER_START\r\n');
    const r=spawnSync(process.env.ComSpec||'cmd.exe',['/d','/c','install-block.cmd'],{cwd:fixture,encoding:'utf8',input:'\r\n',windowsHide:true,timeout:10000,env:{...process.env,PATH:fixture+';'+process.env.PATH}});
    fs.writeFileSync(path.join(evidence,'launcher-install-block.log'),(r.stdout||'')+(r.stderr||''));
    assert(!r.stdout?.includes('R40_REACHED_SERVER_START'),`npm install exit=37 but launcher continued; shell exit=${r.status}`);
  });
  await check('launcher-local-bind-and-quoted-cwd',null,()=>{
    const bat=fs.readFileSync(path.join(root,'start-bot.bat'),'utf8'), mac=fs.readFileSync(path.join(root,'start-bot.command'),'utf8');
    const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
    assert(bat.includes('cd /d "%~dp0"'));assert(mac.includes('cd "$(dirname "$0")"'));
    assert.equal(pkg.scripts.dev,'next dev -H 127.0.0.1 -p 3000');assert.equal(pkg.scripts.start,'next start -H 127.0.0.1 -p 3000');assert(!/0\.0\.0\.0/.test(bat+mac));
  });
  await check('launcher-windows-env-preflight-spaces',null,()=>{
    const source=fs.readFileSync(path.join(root,'start-bot.bat'),'utf8');
    const block=source.slice(source.indexOf(':: 1.'),source.indexOf(':: 3.'));
    const fixture=path.join(root,'launcher env with spaces');fs.mkdirSync(fixture,{recursive:true});
    fs.writeFileSync(path.join(fixture,'node.cmd'),'@echo off\r\necho v22.0.0\r\nexit /b 0\r\n');
    fs.writeFileSync(path.join(fixture,'.env.example'),'R40_SYNTHETIC_PLACEHOLDER=fixture\n');
    fs.writeFileSync(path.join(fixture,'preflight.cmd'),'@echo off\r\nsetlocal EnableDelayedExpansion\r\n'+block+'\r\n');
    const r=spawnSync(process.env.ComSpec||'cmd.exe',['/d','/c','preflight.cmd'],{cwd:fixture,encoding:'utf8',input:'\r\n',windowsHide:true,timeout:10000,env:{...process.env,PATH:fixture+';'+process.env.PATH}});
    assert.equal(r.status,0);assert.equal(fs.readFileSync(path.join(fixture,'.env.local'),'utf8'),'R40_SYNTHETIC_PLACEHOLDER=fixture\n');
  });
  await check('client-bundle-does-not-import-secrets',null,async()=>{
    const esbuild=await import('esbuild');
    const build=await esbuild.build({stdin:{contents:'import React from "react";import {createRoot} from "react-dom/client";import Page from "./src/app/syllabus-config/page.tsx";import {LiveLogDrawer} from "./src/components/live-log-drawer.tsx";window.mountR40=()=>{window.rootR40=createRoot(document.getElementById("root"));window.rootR40.render(<><Page/><LiveLogDrawer/></>)};window.mountR40();',resolveDir:root,loader:'tsx'},bundle:true,platform:'browser',format:'iife',write:false,metafile:true,define:{'process.env.NODE_ENV':'"production"'}});
    const inputs=Object.keys(build.metafile.inputs);assert(!inputs.some(p=>/src\/lib\/(config|db|playwright|queue)/.test(p)));
    const bundle=build.outputFiles[0].text;for(const k of ['TEACHING_PASSWORD','LMS_PASSWORD','GEMINI_API_KEY'])assert(!bundle.includes(k));
    fs.writeFileSync(path.join(evidence,'client-inputs.json'),JSON.stringify(inputs,null,2));
    const {chromium}=await import('playwright');context=await chromium.launchPersistentContext(path.join(root,'playwright-auth'),{headless:true});
    let delayed=false,releaseResponse;let streamCount=0;
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.pathname==='/bundle.js')return route.fulfill({contentType:'text/javascript',body:bundle});
      if(url.pathname==='/api/config'){
        const body=request.method()==='POST'?request.postDataJSON():undefined;
        const res=body?await configRoute.POST(req('/api/config',body)):await configRoute.GET(req('/api/config'));
        if(body&&delayed){delayed=false;await new Promise(r=>releaseResponse=r);}
        return route.fulfill({status:res.status,contentType:'application/json',body:await res.text()});
      }
      if(url.pathname==='/api/queue/stream'){streamCount++;return route.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify({type:'STATUS',data:queue.getStatus()})+'\n\n'});}
      if(url.pathname==='/api/queue/control'){const res=await control.POST(req('/api/queue/control',request.postDataJSON()));return route.fulfill({status:res.status,contentType:'application/json',body:await res.text()});}
      if(url.hostname!=='127.0.0.1')return route.abort();
      return route.fulfill({contentType:'text/html',body:'<div id="root"></div><script src="/bundle.js"></script>'});
    });
    await seed();const page=await context.newPage();await page.goto('http://127.0.0.1:3000/syllabus-config');await page.getByRole('button',{name:/Lưu.*Giáo trình/i}).waitFor();
    await check('ui-add-edit-delete-session',null,async()=>{
      await page.getByRole('button',{name:/Thêm buổi/i}).click();assert.equal(await page.locator('input[type=number]').count(),2);
      await page.getByRole('button',{name:/Lưu.*Giáo trình/i}).click();await page.getByText(/Đã lưu thành công/).waitFor();assert.equal((await get()).courses[0].sessions.length,2);
      await page.getByRole('button',{name:'Xóa buổi',exact:true}).last().click();await page.getByRole('button',{name:/Lưu.*Giáo trình/i}).click();await page.getByText(/Đã lưu thành công 1 khóa/).waitFor();assert.equal((await get()).courses[0].sessions.length,1);
    });
    await check('ui-inflight-edit-preserved','R40-07',async()=>{
      const name=page.locator('input').filter({visible:true}).nth(1);
      await name.fill('First submitted name');delayed=true;await page.getByRole('button',{name:/Lưu.*Giáo trình/i}).click();
      for(let i=0;i<100&&!releaseResponse;i++)await new Promise(r=>setTimeout(r,10));assert(releaseResponse,'Delayed POST was not received');
      await name.fill('Second unsaved name');for(let i=0;i<30&&!releaseResponse;i++)await new Promise(r=>setTimeout(r,10));assert(releaseResponse);releaseResponse();
      await page.getByText(/Đã lưu thành công/).waitFor();assert.equal(await name.inputValue(),'Second unsaved name','Successful older response overwrote newer unsaved edit');
    });
    await check('ui-drawer-control-stop-resume',null,async()=>{
      await page.getByRole('button',{name:/Dừng khẩn cấp \(Stop Bot\)/}).click();await page.getByRole('button',{name:/Tiếp tục chạy/}).waitFor();assert.equal(queue.getStatus().isStopped,true);
      await page.getByRole('button',{name:/Tiếp tục chạy/}).click();await page.getByRole('button',{name:/Dừng khẩn cấp \(Stop Bot\)/}).waitFor();assert.equal(queue.getStatus().isStopped,false);
    });
    await check('ui-delete-add-criterion-unique','R40-02',async()=>{
      await page.getByRole('button',{name:/Barem chấm bài/}).click();await page.getByRole('button',{name:'Xóa',exact:true}).first().click();await page.getByRole('button',{name:/Thêm tiêu chí/i}).click();
      const points=page.locator('input[type=number][step="0.5"]');await points.nth(1).fill('40');
      await page.getByRole('button',{name:/Lưu.*Barem/i}).click();await page.getByText(/Đã lưu thành công/).waitFor();
      const criteria=(await get()).rubrics[0].criteria;assert.equal(new Set(criteria.map(c=>c.criterionId)).size,criteria.length,`Saved duplicate criteria: ${JSON.stringify(criteria)}`);
    });
    await page.screenshot({path:path.join(evidence,'ui-syllabus.png'),fullPage:true});await page.close();return {bundleInputs:inputs.length,streamConnections:streamCount};
  });
} finally {
  if(context)await context.close();queue.resumeQueue();queue.clearQueue();
  for(const [file,data] of backups)fs.writeFileSync(file,data);
  const summary={total:tests.length,pass:tests.filter(t=>t.status==='PASS').length,fail:tests.filter(t=>t.status==='FAIL').length};
  fs.writeFileSync(path.join(evidence,'adversarial-results.json'),JSON.stringify({audit:'AUDIT-R40',createdAt:new Date().toISOString(),mode:'synthetic TEMP only',summary,tests},null,2));
  console.log(JSON.stringify(summary));
}
process.exitCode=tests.some(t=>t.status==='FAIL')?1:0;
