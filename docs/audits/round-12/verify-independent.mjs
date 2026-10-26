// Round 12: independent synthetic audit. Run from the repository root:
// node docs/audits/round-12/verify-independent.mjs
// No application DB, persistent browser profile, credentials or remote service is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import Database from 'better-sqlite3';
import * as XLSX from 'xlsx';

const results = [];
const quiet = { log() {}, warn() {}, error() {} };
const read = f => fs.readFileSync(f, 'utf8');
const clean = s => s.replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, '').replace(/\bexport\s+default\s+/g, '').replace(/\bexport\s+/g, '');
function moduleAt(file, names, bindings = {}, source = read(file)) {
  const ctx = vm.createContext({ console: quiet, Request, Response, URL, setTimeout, clearTimeout, ...bindings });
  if (file.endsWith('/page.tsx')) source = source.slice(0, source.indexOf('export default function'));
  const js = stripTypeScriptTypes(clean(source), { mode: 'transform' });
  vm.runInContext(js + '\n;globalThis.out = {' + names.join(',') + '};', ctx, { filename: file });
  return ctx.out;
}
async function check(name, fn) {
  try { await fn(); results.push({ name, pass: true }); console.log('PASS ' + name); }
  catch (e) { results.push({ name, pass: false, error: e.stack }); console.log('FAIL ' + name + ': ' + e.message); }
}
const defer = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const cid = 'VT-C4K-GA38', sid = cid + '_SESS_01';
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const noImportsConfig = { allowedLocalDirs: [] };
const allow = moduleAt('src/lib/security/path-allowlist.ts', ['assertPathAllowed', 'isPathAllowed'], { fs, path, process, config: noImportsConfig });
const local = moduleAt('src/lib/security/local-guard.ts', ['validateLocalRequest', 'isLocalRequest'], { NextResponse: Response });
function backend() {
  const db = new Database(':memory:');
  const sql = moduleAt('src/lib/db/sqlite.ts', ['getDb','studentRepo','classSessionRepo','sessionFeedbackRepo','scoreMatrixRepo','homeworkSubmissionRepo','calculateSha256','verifyContentIntegrity'], {
    Database: function () { return db; }, crypto, path, process,
    fs: { existsSync: () => true }, assertPathAllowed: p => p,
  });
  sql.getDb();
  const bindings = { ...sql, ...local, NextResponse: Response, getQuickTags: () => [], getCoursesSyllabus: () => [], getZaloTemplates: () => [] };
  const save = moduleAt('src/app/api/session-comments/save-draft/route.ts', ['POST'], bindings).POST;
  const approve = moduleAt('src/app/api/session-comments/approve/route.ts', ['POST'], bindings).POST;
  const list = moduleAt('src/app/api/session-comments/list/route.ts', ['GET'], bindings).GET;
  const request = (url, body) => new Request('http://127.0.0.1:3000'+url, { method: body ? 'POST' : 'GET', headers: { host:'127.0.0.1:3000', 'content-type':'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const dispatch = (url, opts={}) => {
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    return url.includes('/list') ? list(request(url)) : url.includes('/approve') ? approve(request(url,body)) : save(request(url,body));
  };
  function seed(studentId='S1', extra={}) {
    sql.studentRepo.upsert({ classId:cid, studentId, fullName:'Audit '+studentId, isActive:1 });
    sql.sessionFeedbackRepo.upsert({ classId:cid, sessionId:sid, studentId, attendanceStatus:'ABSENT', quickTagsJson:'[]', teacherNote:'old '+studentId, strengths:'old strength', improvements:'old improvement', actionPlan:'old plan', finalText:'old final', status:'DRAFT', ...extra });
  }
  const row = (id='S1') => sql.sessionFeedbackRepo.findOne(cid,sid,id);
  return { ...sql, db, save, approve, list, request, dispatch, seed, row };
}

// A small deterministic hook scheduler executes actual page handlers. This is
// logic-level verification, not a claim of browser/React concurrent-mode QA.
function ui(file, name, exposed, fetch) {
  const text = read(file);
  const componentStart = text.indexOf('export default function '+name);
  const returnPos = text.indexOf('\n  return (\n    <div className="space-y-6">', componentStart);
  assert(returnPos > componentStart, 'page boundary must exist');
  const badgePos = text.indexOf('  const renderCellBadge = ', componentStart);
  const cut = badgePos > componentStart ? badgePos : returnPos;
  const src = text.slice(0,cut) + '\n globalThis.api={'+exposed+'}; return null; }';
  let cursor=0, dirty=true, pending=[];
  const slots=[], effects=[];
  const ctx=vm.createContext({ console:quiet, fetch, setTimeout, clearTimeout,
    useState(initial) { const i=cursor++; if (!(i in slots)) slots[i]=initial; return [slots[i], v => { const n=typeof v==='function'?v(slots[i]):v; if (!Object.is(n,slots[i])) { slots[i]=n; dirty=true; } }]; },
    useRef(initial) { const i=cursor++; if (!(i in slots)) slots[i]={current:initial}; return slots[i]; },
    useEffect(fn,deps) { const i=cursor++; const old=effects[i]; if (!old || deps.some((d,j)=>!Object.is(d,old[j]))) { effects[i]=deps; pending.push(fn); } },
  });
  vm.runInContext(stripTypeScriptTypes(clean(src),{mode:'transform'})+'\nglobalThis.render='+name+';',ctx);
  const flush=async()=>{ for(let turn=0;turn<20;turn++) { await new Promise(r=>setImmediate(r)); if(dirty) { dirty=false; cursor=0;ctx.render(); const run=pending;pending=[];run.forEach(f=>f()); } } };
  return { get api(){return ctx.api;}, flush };
}
const sc=(b,fetch=b.dispatch)=>ui('src/app/session-comments/page.tsx','SessionCommentsPage','students,setStudents,setClassId,setSelectedSessionId,handleNoteChange,toggleQuickTag,handleAttendanceChange,handleTextEdit,handleConfirmAllPresent,handleApprove,handleApproveAll,handleGenerateAi,loadClassData,statusMessage',fetch);
const hw=fetch=>ui('src/app/homework-grader/page.tsx','HomeworkGraderPage','classId,setClassId,setClassCode,matrix,isScraping,isLoadingCache,handleScrapeScores,handleExportFile,handleCopyForGoogleSheets',fetch);

// Independent fake Playwright locators; actual worker logic runs unmodified.
function locator(overrides={}) {
  return { first(){return this;}, nth(){return this;}, filter(){return this;}, locator(){return locator();}, count:async()=>0, isVisible:async()=>false, isEnabled:async()=>false, getAttribute:async()=>null, innerText:async()=>'', waitFor:async()=>{}, click:async()=>{}, scrollIntoViewIfNeeded:async()=>{}, evaluate:async()=>true, ...overrides };
}
async function saveScenario(opt={}) {
  const b=backend(); b.seed('S1',{attendanceStatus:'PRESENT',status:'APPROVED',finalText:'APPROVED <img src=x onerror=alert(1)> END',contentHash:hash('APPROVED <img src=x onerror=alert(1)> END')});
  let predicate, editorCallback;
  const record=()=>b.row();
  const loc=()=>locator({ count:async()=>1, isVisible:async()=>true, isEnabled:async()=>true, getAttribute:async()=>opt.inactiveSlot?'disabled':'active', innerText:async()=>opt.readback??record().finalText, locator:()=>loc(), evaluate:async(fn,arg)=>{ if(arg!==undefined){editorCallback=fn;if(opt.editDuringSave)b.sessionFeedbackRepo.upsert({...record(),finalText:'new draft',status:'DRAFT',contentHash:''});} return opt.activeSlot!==false; } });
  const page={ locator:()=>loc(),waitForTimeout:async()=>{},keyboard:{press:async()=>{}},screenshot:async()=>{} };
  const names=['CommentSaver'];
  const worker=moduleAt('src/lib/playwright/save-comments.ts',names,{ ...b, config:{}, BrowserManager:{getInstance:()=>({getPage:async()=>page})},authService:{ensureAuthenticated:async()=>{}},LmsHelpers:{openClassDrawer:async()=>{},switchDrawerTab:async()=>{}},SELECTORS:{tabs:{comments:[]}},jobLogRepo:{add(){}},createNetworkInterceptor:()=>({dismissForbiddenToast:async()=>{},waitForApiResponse:async(_url,opts)=>{predicate=opts.requestPredicate;return {status:()=>opt.http??200,json:async()=>opt.graphql?{errors:[{message:'denied'}]}:{data:{}}};}})}).CommentSaver;
  try { const out=await worker.saveComments({classId:cid,classCode:opt.classCode??cid,sessionId:opt.sessionId??sid}); return {out,row:record(),predicate,editorCallback}; }
  finally {b.db.close();}
}

async function scrapeScenario(opt={}) {
  let listener, emitted=false, writes=0;
  const empty=locator();
  const payload={classCode:cid,lessons:[{id:'L1',name:'Buổi 1',displayOrder:1}],students:[{studentUid:'S1',displayName:'Audit S1'}],submissions:[],...opt.payload};
  const page={locator:()=>empty,on:(_e,fn)=>listener=fn,off:()=>{},waitForTimeout:async()=>{if(!emitted&&!opt.noGql){emitted=true;await listener({url:()=> 'https://lms-api.mindx.edu.vn/',status:()=>opt.http??200,request:()=>({method:()=> 'POST',postDataJSON:()=>({operationName:'FindStudentSubmissionByClass',variables:{payload:{classId:opt.reqClass??cid}}})}),json:async()=>({data:{findStudentSubmissionByClass:payload}})});}}};
  const scraper=moduleAt('src/lib/playwright/scrape-scores.ts',['ScoreScraper'],{BrowserManager:{getInstance:()=>({getPage:async()=>page})},authService:{ensureAuthenticated:async()=>{}},LmsHelpers:{openClassDrawer:async()=>{},switchDrawerTab:async()=>{}},createNetworkInterceptor:()=>({dismissForbiddenToast:async()=>{}}),SELECTORS:{tabs:{grading:[]}},studentRepo:{findByClass:()=>opt.roster??[{studentId:'S1',fullName:'Audit S1',isActive:1}],upsert(){}},scoreMatrixRepo:{save:()=>writes++},jobLogRepo:{add(){}},getDb:()=>({transaction:fn=>fn})}).ScoreScraper;
  const out=await scraper.scrapeClassScores(cid);return {out,writes,scraper};
}

function grid({duplicate=false,infinite=false,pages=2}={}) {
  let page=0;
  const empty=locator();
  const header=locator({count:async()=>2,nth:i=>locator({innerText:async()=>i?'Homework 1':'Name'})});
  const child=()=>locator({count:async()=>2,nth:i=>locator({innerText:async()=>i?'0/100':'Audit '+(duplicate?0:page)})});
  const row=locator({count:async()=>1,nth:()=>locator({locator:()=>locator({locator:()=>locator({locator:child})})})});
  const next=locator({count:async()=>1,isVisible:async()=>true,isEnabled:async()=>infinite||page<pages-1,click:async()=>{page++;}});
  return locator({locator:s=>s.includes('Homework')?header:s.includes('ExpandMoreIcon')?row:s.includes('next page')?next:empty});
}

await check('R1 #1/#2/#3/#5; R2-01/A01; R3-01: HTTP + exact full readback + edit drift',async()=>{
  assert.equal((await saveScenario()).out.verifiedCount,1);
  for(const opt of [{readback:'APPROVED <img src=x onerror=alert(1)> END extra'},{readback:'APPROVED <img src=x onerror=alert(1)> END\nextra'},{http:500},{graphql:true},{editDuringSave:true}]) assert.equal((await saveScenario(opt)).out.verifiedCount,0);
  assert.equal((await saveScenario({editDuringSave:true})).row.status,'DRAFT');
  await assert.rejects(()=>saveScenario({classCode:'OTHER'}));
  await assert.rejects(()=>saveScenario({sessionId:cid+'1_SESS_01'}));
  await assert.rejects(()=>saveScenario({activeSlot:false}));
});
await check('R1 #6: editor treats markup as literal text',async()=>{
  const {editorCallback}=await saveScenario(); let literal='';
  // Execute the editor callback fallback with malicious markup; no innerHTML sink.
  const el={textContent:'',dispatchEvent(){}};
  const callback=vm.runInNewContext('('+editorCallback.toString()+')',{Event:class {}});
  callback(el,'<img src=x onerror=alert(1)>'); literal=el.textContent;
  assert.equal(literal,'<img src=x onerror=alert(1)>'); assert(!('innerHTML' in el));
});
await check('R2-02/A09; R3-02; R4-02; R5-03: mutation target predicate',async()=>{
  const {predicate:p}=await saveScenario();
  const body=variables=>JSON.stringify({operationName:'SaveSlotComment',variables});
  assert.equal(p(body({classId:cid,sessionId:sid,studentId:'S1'})),true);
  for(const v of [{},{comment:'APPROVED <img src=x onerror=alert(1)> END'},{studentId:'S2'},{sessionId:cid+'_SESS_02'},{classId:'OTHER'},{studentId:'S1',payload:{studentId:'S2'}}])assert.equal(p(body(v)),false);
  const fields=['classCode','classId','className','sessionId','slotId','slotNumber','sessionNumber','slotIndex','studentId','studentUid','userId','comment','content','note','feedback'];
  for(const f of fields)for(const nesting of ['root','payload','input']){
    const v=nesting==='root'?{studentId:'S1',[f]:null}:{studentId:'S1',[nesting]:{[f]:null}};
    assert.equal(p(body(v)),false,f+' '+nesting);
  }
});
await check('R2-02/A09: actual network filter rejects unrelated requests and GraphQL errors',async()=>{
  const {NetworkInterceptor}=moduleAt('src/lib/playwright/network-interceptor.ts',['NetworkInterceptor'],{SELECTORS:{}});
  const res=(op,status=200)=>({url:()=> 'https://lms-api.mindx.edu.vn/',status:()=>status,request:()=>({method:()=> 'POST',postData:()=>JSON.stringify({operationName:op})}),json:async()=>({data:{}})});
  let probes=0;
  const interceptor=new NetworkInterceptor({waitForResponse:async filter=>{assert.equal(filter(res('Other')),false);probes++;assert.equal(filter(res('SaveSlotComment')),true);return res('SaveSlotComment',500);}});
  await assert.rejects(()=>interceptor.waitForApiResponse('lms-api',{method:'POST',operationName:'SaveSlotComment'}),/HTTP status 500/);assert.equal(probes,1);
  await assert.rejects(()=>new NetworkInterceptor({waitForResponse:async()=>({...res('SaveSlotComment'),json:async()=>({errors:[{message:'no'}]})})}).waitForApiResponse('lms-api'),/GraphQL/);
});
await check('R2-03/A02: full name cannot prefix-match a longer student name',async()=>{
  const text=read('src/lib/playwright/save-comments.ts');
  const expr=text.match(/const exactNameLineRegex = new RegExp\(([\s\S]*?)\n\s*\);/)[0];
  const re=vm.runInNewContext(expr+';exactNameLineRegex',{escapedStudentId:'S1',escapedName:'Nguyễn An'});
  assert.equal(re.test('Nguyễn An Bình'),false);assert.equal(re.test('Nguyễn An\nNhận xét'),true);
});
await check('R1 #3/#7/#8/#11; R2-05/A03/A05; R3-03: GraphQL identity and score separation',async()=>{
  const ok=await scrapeScenario({payload:{lessons:[{id:'L1',name:'Quiz 1',type:'QUIZ'}],submissions:[{id:'B1',studentUid:'S1',lessonId:'L1',submissionType:'QUIZ',status:'MARKED',score:88}]}});
  assert.equal(ok.out.success,true);assert.equal(ok.out.rows[0].averageScore,null);assert.equal(ok.out.rows[0].averageQuizScore,88);
  const roster=[{studentId:'S1',fullName:'Same Name',isActive:1},{studentId:'S2',fullName:'Same Name',isActive:1}];
  for(const opt of [{http:500},{reqClass:'66f123456789abcdef012345',payload:{classCode:undefined}},{payload:{students:[{studentUid:'X',displayName:'Wrong Name'}]}},{roster,payload:{students:[{studentUid:'X1',displayName:'Same Name'},{studentUid:'X2',displayName:'Same Name'}]}},{payload:{submissions:undefined}},{payload:{submissions:[{id:'B1',studentUid:'S1',lessonId:'L1',submissionType:'PRACTICE',status:'MARKED',score:null}]}},{payload:{lessons:[{id:'L1',name:'Quiz 1',type:'QUIZ'}],submissions:[{id:'B1',studentUid:'S1',lessonId:'L1',submissionType:'QUIZ',status:'MARKED',score:null}]}}]){
    const bad=await scrapeScenario(opt);assert.equal(bad.out.success,false,JSON.stringify(opt));assert.equal(bad.writes,0);
  }
});
await check('R1 #8; R2-10/A12/A14: four score states and Quiz-only',async()=>{
  const {scraper}=await scrapeScenario();
  for(const [text,status,score] of [['0/100','GRADED',0],['Chưa chấm (0/1) 0/100','SUBMITTED_UNGRADED',null],['Chưa nộp','NOT_SUBMITTED',null],['Làm lại','REDO_REQUESTED',null],['Quiz: 84/100','NOT_SUBMITTED',null]]){const c=scraper.parseScoreCell(text,'H',1);assert.equal(c.status,status);assert.equal(c.score,score);}
  assert.equal(scraper.parseScoreCell('Quiz: 84/100','H',1).quizScore,84);
  assert.throws(()=>scraper.parseScoreCell('Đã chấm (1/1)','H',1));
});
await check('R2-07/A12; R4-06: DOM pagination duplicate and 50-page limit',async()=>{
  const {scraper}=await scrapeScenario();
  const call=ctx=>scraper.scrapeFromDomGrid(ctx,cid,new Map(),new Map(),s=>s.toLowerCase());
  assert.equal((await call(grid())).rows.length,2);
  await assert.rejects(()=>call(grid({duplicate:true})),/trùng lặp|mơ hồ/);
  await assert.rejects(()=>call(grid({infinite:true})),/50/);
});
await check('R1 #4/#12; R2-04/A11: roster multi-page IDs stable across order',async()=>{
  const {ClassSyncer}=moduleAt('src/lib/playwright/sync-class.ts',['ClassSyncer'],{createNetworkInterceptor:()=>({dismissForbiddenToast:async()=>{}}),SELECTORS:{students:{pageSizeSelect:'size'}}});
  async function roster(pages){let p=0;const empty=locator();const next=locator({count:async()=>1,isVisible:async()=>true,isEnabled:async()=>p<pages.length-1,click:async()=>p++});const rows=locator({count:async()=>pages[p].length,nth:i=>locator({innerText:async()=>pages[p][i],locator:()=>empty})});const drawer=locator({isVisible:async()=>true,locator:s=>s==='table tbody tr'?rows:s.includes('next page')?next:empty});return ClassSyncer.scrapeStudents({locator:()=>drawer,waitForTimeout:async()=>{}},cid);}
  const a=await roster([['Alpha Audit','Beta Audit'],['Gamma Audit']]);const b=await roster([['Gamma Audit'],['Beta Audit','Alpha Audit']]);
  assert.equal(a.length,3);assert.deepEqual(Object.fromEntries(a.map(x=>[x.fullName,x.studentId])),Object.fromEntries(b.map(x=>[x.fullName,x.studentId])));
  await assert.rejects(()=>roster([['Same Audit','Same Audit']]),/trùng tên/);
  const empty=locator();
  let dbWrites=0;
  const {ClassSyncer:failed}=moduleAt('src/lib/playwright/sync-class.ts',['ClassSyncer'],{BrowserManager:{getInstance:()=>({getPage:async()=>({url:()=> 'https://lms.mindx.edu.vn/classes',locator:()=>empty,waitForTimeout:async()=>{}})})},authService:{ensureAuthenticated:async()=>{}},LmsHelpers:{openClassDrawer:async()=>{},switchDrawerTab:async()=>{}},SELECTORS:{tabs:{comments:[],students:[]},students:{pageSizeSelect:'size'}},getCoursesSyllabus:()=>[],createNetworkInterceptor:()=>({dismissForbiddenToast:async()=>{}}),jobLogRepo:{add(){}},getDb:()=>{dbWrites++;throw Error('must not write');}});
  const failedResult=await failed.syncClass(cid);assert.equal(failedResult.success,false);assert.match(failedResult.error,/chưa tải đủ/);assert.equal(dbWrites,0);
});
await check('R2-06/A04/A06; R3-04; R4-04: invalid score cache rejected without overwrite',async()=>{
  const b=backend();try{
    const good={success:true,classId:cid,columns:[{columnId:'H'}],rows:[{studentId:'S1',cells:{H:{columnId:'H',status:'GRADED',score:0,maxScore:100}}}]};
    b.scoreMatrixRepo.save(cid,good);
    for(const change of [{status:'BOGUS'},{score:null},{score:NaN},{score:101},{columnId:'OTHER'},{columnId:undefined},{maxScore:undefined},{score:undefined}]){
      const bad=structuredClone(good);Object.assign(bad.rows[0].cells.H,change);assert.throws(()=>b.scoreMatrixRepo.save(cid,bad));
    }
    for(const bad of [{...good,success:false},{...good,rows:[{studentId:'S1'}]}])assert.throws(()=>b.scoreMatrixRepo.save(cid,bad));
    assert.equal(b.scoreMatrixRepo.findByClass(cid).matrix.rows[0].cells.H.score,0);
    assert.equal(b.studentRepo.findOne('S1'),undefined);
  }finally{b.db.close();}
});
await check('R2-09/A07; R3-05/R3-06; R6-01: real routes enforce membership, attendance, patch preservation',async()=>{
  const b=backend();try{b.seed();
    const send=(method,data)=>b[method](b.request('/api/test',{classId:cid,sessionId:sid,studentId:'S1',...data}));
    assert.equal((await send('save',{teacherNote:'new',status:'DRAFT'})).status,200);assert.equal(b.row().finalText,'old final');assert.equal(b.row().attendanceStatus,'ABSENT');
    for(const id of ['GHOST','OTHERCLASS','INACTIVE']){if(id!=='GHOST')b.studentRepo.upsert({classId:id==='OTHERCLASS'?'OTHER':cid,studentId:id,fullName:id,isActive:id==='INACTIVE'?0:1});for(const method of ['save','approve'])assert.equal((await send(method,{studentId:id,approvedText:'text'})).status,400);}
    for(const a of ['UNKNOWN','ABSENT','EXCUSED']){await send('save',{attendanceStatus:a});assert.equal((await send('approve',{approvedText:'text'})).status,400);assert.equal(b.row().status,'DRAFT');}
    for(const a of ['PRESENT','LATE']){await send('save',{attendanceStatus:a});assert.equal((await send('approve',{approvedText:'text'})).status,200);assert.equal(b.row().contentHash,hash('text'));}
    assert.equal((await send('save',{status:'APPROVED'})).status,400);
  }finally{b.db.close();}
});
await check('R1 #13; R2-09/A08/R2-11/A13; R3-05/R3-07; R4-05: AI guards and redaction',async()=>{
  const b=backend();try{b.seed();let calls=0,prompt='';
    const {CommentGenerator:g}=moduleAt('src/lib/gemini/comment-generator.ts',['CommentGenerator'],{...b,getGeminiModel:()=>({generateContent:async p=>{calls++;prompt=p;return {response:{text:()=>JSON.stringify({feedbacks:[]})}};}})});
    const session={classId:cid,classCode:cid,sessionId:sid,sessionNumber:1,topic:'Audit'};
    const st={studentId:'S1',fullName:'Audit S1',attendanceStatus:'PRESENT',teacherNote:'Audit S1 learned well',quickTags:['Audit S1 focused']};
    await assert.rejects(()=>g.generateBatchComments({...session,classId:''},[st]));
    await assert.rejects(()=>g.generateBatchComments({...session,sessionId:'OTHER_SESS_01'},[st]));assert.equal(calls,0);
    assert.equal((await g.generateBatchComments(session,[{...st,studentId:'GHOST'}])).length,0);
    assert.equal((await g.generateBatchComments(session,[{...st,teacherNote:'',quickTags:[]}]))[0].status,'INSUFFICIENT_INFO');assert.equal(calls,0);
    b.seed();const out=await g.generateBatchComments(session,[st]);assert.equal(out[0].status,'FAILED');assert.equal(b.row().finalText,'old final');assert(!prompt.includes('Audit S1'));assert(prompt.includes('STUDENT_01'));
  }finally{b.db.close();}
});
await check('R1 #9/#11: exported spreadsheet formulas and TSV delimiters neutralized',async()=>{
  const exp=moduleAt('src/app/api/homework-grader/export/route.ts',['sanitizeSpreadsheetCell','formatCellForExport'],{XLSX});
  const helpers=moduleAt('src/app/homework-grader/page.tsx',['sanitizeTsvCell','htmlToPlainText']);
  for(const text of ['=1+1',' +SUM(A1:A2)','@SUM(A1)','-2+3','\t=HYPERLINK("x")']){assert.equal(String(exp.sanitizeSpreadsheetCell(text))[0],"'");const t=helpers.sanitizeTsvCell(text+'\tA\nB');assert.equal(t[0],"'");assert(!/[\t\r\n]/.test(t));}
  assert.equal(exp.formatCellForExport({status:'GRADED',score:0,quizScore:90},'practice'),0);
  assert.equal(exp.formatCellForExport({status:'GRADED',score:0,quizScore:90},'both'),'0 (Quiz: 90)');
});
await check('R1 #12/#14: course-specific Zalo, guarded config file reads',async()=>{
  const cfg=moduleAt('src/lib/db/json-config.ts',['getQuickTags','getZaloTemplates','renderZaloBroadcast','findLessonInSyllabus'],{fs,path,process,...allow});
  const {ZaloBroadcastGenerator:g}=moduleAt('src/lib/zalo/broadcast-generator.ts',['ZaloBroadcastGenerator'],cfg);
  const text=g.generate({classCode:'VT-C4K-PTA13',sessionNumber:2}).renderedText;
  assert(!/GML|GameMaker|18h00-20h00 Chủ nhật/.test(text));
  assert(Array.isArray(cfg.getQuickTags()));assert.throws(()=>allow.assertPathAllowed('C:\\Windows\\System32\\drivers\\etc\\hosts'));
  assert.equal(allow.isPathAllowed(path.join(process.cwd(),'missing','audit.py')),true);
});

await check('R1 #10; R2-08/A10; R4-03; R5-04: failed scrape clears both loading flags',async()=>{
  for(const changeClass of [false,true]){const initial=defer();let gets=0;const h=hw(async(_url,opts)=>{if(!opts?.method){gets++;return initial.promise;}return Response.json({success:false,error:'synthetic'});});await h.flush();if(changeClass){h.api.setClassCode('OTHER');await h.flush();}await h.api.handleScrapeScores();await h.flush();assert.equal(h.api.isScraping,false);assert.equal(h.api.isLoadingCache,false);assert.equal(gets,1);initial.resolve(Response.json({success:true,data:{matrix:null}}));await h.flush();}
});
await check('R4-01; R5-01: stale class and session lists cannot cross scope',async()=>{
  const b=backend();try{b.seed();const old=defer();const h=sc(b,async(url,opts)=>url.includes('/list')&&new URL('http://x'+url).searchParams.get('classId')===cid?old.promise:b.dispatch(url,opts));await h.flush();h.api.setClassId('OTHER');h.api.setSelectedSessionId('OTHER_SESS_01');await h.flush();old.resolve(Response.json({success:true,data:{students:[{studentId:'OLD',classId:cid,isActive:true}],feedbacks:[]}}));await h.flush();assert.equal(h.api.students.some(s=>s.studentId==='OLD'),false);
    const newSession=defer();let badWrites=0;const h2=sc(b,(url,opts)=>{
      if(url.includes('/list')&&url.includes(encodeURIComponent(cid+'_SESS_02')))return newSession.promise;
      if(opts?.body&&JSON.parse(opts.body).sessionId===cid+'_SESS_02')badWrites++;
      return b.dispatch(url,opts);
    });await h2.flush();h2.api.setSelectedSessionId(sid);await h2.flush();h2.api.setSelectedSessionId(cid+'_SESS_02');await h2.flush();assert.equal(h2.api.students.length,0);h2.api.handleNoteChange('S1','cross-session attempt');await h2.flush();assert.equal(badWrites,0);assert.equal(b.row().teacherNote,'old S1');
  }finally{b.db.close();}
});
await check('R5-02: slow approve cannot approve a newer edit',async()=>{
  const b=backend();try{b.seed('S1',{attendanceStatus:'PRESENT'});const hold=defer();const h=sc(b,async(url,opts)=>{const res=await b.dispatch(url,opts);if(url.includes('/approve'))await hold.promise;return res;});await h.flush();h.api.setSelectedSessionId(sid);await h.flush();const pending=h.api.handleApprove('S1');await h.flush();h.api.handleTextEdit('S1','finalText','newer final');await h.flush();hold.resolve();await pending;await h.flush();assert.equal(h.api.students[0].status,'DRAFT');assert.equal(b.row().finalText,'newer final');}finally{b.db.close();}
});
await check('R3-06: FAILED AI response preserves existing draft on UI and next save',async()=>{
  const b=backend();try{b.seed('S1',{attendanceStatus:'PRESENT'});const h=sc(b,(url,opts)=>url.includes('/generate-ai')?Response.json({success:true,data:[{studentId:'S1',status:'FAILED',formattedFullComment:'',strengths:'',improvements:'',actionPlan:''}]}):b.dispatch(url,opts));await h.flush();h.api.setSelectedSessionId(sid);await h.flush();await h.api.handleGenerateAi();await h.flush();assert.equal(h.api.students[0].finalText,'old final');h.api.handleNoteChange('S1','post failure');await h.flush();assert.equal(b.row().finalText,'old final');}finally{b.db.close();}
});
await check('R9-01B: failed save from old class cannot roll back new class row',async()=>{
  const b=backend();try{b.seed();b.studentRepo.upsert({classId:'OTHER',studentId:'S1',fullName:'Other S1',isActive:1});b.sessionFeedbackRepo.upsert({classId:'OTHER',sessionId:'OTHER_SESS_01',studentId:'S1',status:'DRAFT',teacherNote:'OTHER NOTE'});const pending=defer();const h=sc(b,(url,opts)=>opts?.body?pending.promise:b.dispatch(url,opts));await h.flush();h.api.setSelectedSessionId(sid);await h.flush();h.api.handleNoteChange('S1','old class pending');h.api.setClassId('OTHER');h.api.setSelectedSessionId('OTHER_SESS_01');await h.flush();pending.resolve(Response.json({success:false},{status:500}));await h.flush();assert.equal(h.api.students[0].teacherNote,'OTHER NOTE');assert.equal(h.api.students[0].classId,'OTHER');}finally{b.db.close();}
});
for(const failure of ['400','500','network','inactive'])await check('R8-01: mixed bulk success and '+failure+' must report error and reconcile',async()=>{
  const b=backend();try{b.seed('S1');b.seed('S2');const h=sc(b,(url,opts)=>{if(opts?.body&&JSON.parse(opts.body).studentId==='S1'){if(failure==='network')throw Error('synthetic');if(failure!=='inactive')return Response.json({success:false},{status:Number(failure)});}return b.dispatch(url,opts);});await h.flush();h.api.setSelectedSessionId(sid);await h.flush();if(failure==='inactive')b.studentRepo.upsert({classId:cid,studentId:'S1',fullName:'Audit S1',isActive:0});await h.api.handleConfirmAllPresent();await h.flush();assert.equal(h.api.statusMessage.type,'error');assert.equal(h.api.students.find(s=>s.studentId==='S1').attendanceStatus,'ABSENT');assert.equal(h.api.students.find(s=>s.studentId==='S2').attendanceStatus,'PRESENT');assert.equal(b.row('S2').attendanceStatus,'PRESENT');}finally{b.db.close();}
});
await check('R7-01: all 9 approved-state/edit combinations persist DRAFT',async()=>{
  for(const state of ['DRAFT','APPROVED','VERIFIED'])for(const action of ['note','tag','attendance']){const b=backend();try{b.seed('S1',{status:state,attendanceStatus:'PRESENT',contentHash:hash('old final')});const h=sc(b);await h.flush();h.api.setSelectedSessionId(sid);await h.flush();if(action==='note')h.api.handleNoteChange('S1','edited');if(action==='tag')await h.api.toggleQuickTag('S1','focused');if(action==='attendance')h.api.handleAttendanceChange('S1','LATE');await h.flush();assert.equal(b.row().status,'DRAFT');await h.api.loadClassData(cid,sid);await h.flush();assert.equal(h.api.students[0].status,'DRAFT');}finally{b.db.close();}}
});
for(const mode of ['http','network']){
  await check('R8-01/R9-01/R10-01: stale '+mode+' failure preserves pending newer edit',async()=>{
    const b=backend();try{b.seed();const fail=defer(),note=defer();const h=sc(b,async(url,opts)=>{if(opts?.body){const body=JSON.parse(opts.body);if(body.attendanceStatus==='PRESENT'){await fail.promise;if(mode==='network')throw Error('synthetic');return Response.json({success:false},{status:500});}if(body.teacherNote==='new pending')await note.promise;}return b.dispatch(url,opts);});await h.flush();h.api.setSelectedSessionId(sid);await h.flush();const bulk=h.api.handleConfirmAllPresent();await h.flush();h.api.handleNoteChange('S1','new pending');await h.flush();fail.resolve();await bulk;await h.flush();assert.equal(h.api.statusMessage.type,'error');assert.equal(h.api.students[0].teacherNote,'new pending');note.resolve();await h.flush();assert.equal(b.row().teacherNote,'new pending');}finally{b.db.close();}
  });
}
for(const mode of ['control','first-success','first-http-error','first-network-error'])for(const edit of ['note','tag','text','attendance']){
  await check('R11-01: '+mode+' / S2 '+edit,async()=>{
    const b=backend();try{b.seed('S1');b.seed('S2');const first=defer();const bodies=[];const h=sc(b,async(url,opts)=>{if(opts?.body){const body=JSON.parse(opts.body);bodies.push(body);if(body.studentId==='S1'){await first.promise;if(mode==='first-http-error')return Response.json({success:false},{status:500});if(mode==='first-network-error')throw Error('synthetic');}}return b.dispatch(url,opts);});await h.flush();h.api.setSelectedSessionId(sid);await h.flush();const bulk=h.api.handleConfirmAllPresent();await h.flush();if(mode!=='control'){if(edit==='note')h.api.handleNoteChange('S2','new S2');if(edit==='tag')await h.api.toggleQuickTag('S2','new tag');if(edit==='text')h.api.handleTextEdit('S2','strengths','new strength');if(edit==='attendance')h.api.handleAttendanceChange('S2','LATE');await h.flush();}first.resolve();await bulk;await h.flush();
      const expected=mode==='control'?{teacherNote:'old S2',strengths:'old strength',quickTagsJson:'[]',attendanceStatus:'PRESENT'}:edit==='note'?{teacherNote:'new S2'}:edit==='tag'?{quickTagsJson:'["new tag"]'}:edit==='text'?{strengths:'new strength'}:{attendanceStatus:'LATE'};
      for(const [key,value]of Object.entries(expected))assert.equal(b.row('S2')[key],value,key);
      const bulkS2=bodies.find(x=>x.studentId==='S2'&&x.attendanceStatus==='PRESENT');if(bulkS2)assert.deepEqual(Object.keys(bulkS2).sort(),['attendanceStatus','classId','sessionId','status','studentId'].sort());
      const before=b.row('S2');await h.api.loadClassData(cid,sid);await h.flush();const visible=h.api.students.find(s=>s.studentId==='S2');assert.equal(visible.teacherNote,before.teacherNote);assert.equal(visible.strengths,before.strengths);assert.equal(visible.attendanceStatus,before.attendanceStatus);assert.equal(JSON.stringify(visible.quickTags),before.quickTagsJson);
    }finally{b.db.close();}
  });
}

// Additional adversarial case beyond the supplied regression suite. The expected
// invariant is that the latest teacher edit survives requests arriving out of order.
await check('R12-01: earlier successful note request cannot overwrite newer successful note',async()=>{
  const b=backend();try{b.seed();const old=defer();const statuses=[];const h=sc(b,async(url,opts)=>{if(opts?.body&&JSON.parse(opts.body).teacherNote==='older edit')await old.promise;const res=await b.dispatch(url,opts);if(opts?.body)statuses.push(res.status);return res;});await h.flush();h.api.setSelectedSessionId(sid);await h.flush();h.api.handleNoteChange('S1','older edit');await h.flush();h.api.handleNoteChange('S1','LATEST EDIT');await h.flush();assert.equal(b.row().teacherNote,'LATEST EDIT');old.resolve();await h.flush();const visible=h.api.students[0].teacherNote;const stored=b.row().teacherNote;await h.api.loadClassData(cid,sid);await h.flush();const reloaded=h.api.students[0].teacherNote;assert.deepEqual(statuses,[200,200]);console.log('OBSERVED R12-01 '+JSON.stringify({statuses,visible,stored,reloaded}));assert.equal(stored,'LATEST EDIT','older successful HTTP request overwrote the latest saved edit');assert.equal(reloaded,'LATEST EDIT');}finally{b.db.close();}
});

const summary={generatedAt:new Date().toISOString(),passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass).length,results};
fs.writeFileSync('docs/audits/round-12/independent-results.json',JSON.stringify(summary,null,2)+'\n');
console.log('SUMMARY '+JSON.stringify({passed:summary.passed,failed:summary.failed}));
process.exitCode=summary.failed?1:0;
