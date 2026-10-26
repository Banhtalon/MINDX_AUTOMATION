// Round 27 harness adapted transparently from Round 22/21/20: real source functions, synthetic inputs, in-memory SQLite.
// Run only in the isolated snapshot. Reuses R20 helpers and valid media; R22 boundary checks follow. Run unchanged R20 and R21 separately for their 145 and 49 assertions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import Database from 'better-sqlite3';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import {createMediaCases} from '../round-25/media-cases.mjs';
import {createR26MediaCases} from '../round-26/media-cases.mjs';
import {createR26WorkerCases} from '../round-26/worker-cases.mjs';
import {createR27WorkerCases} from './worker-cases.mjs';
import {createR27MediaCases} from './media-cases.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const out = path.join(root, 'docs/audits/round-27');
assert(path.resolve(process.cwd()) === root && root.includes('mindx-round27-') && root.startsWith(path.resolve(os.tmpdir())), 'Run this audit only from its isolated TEMP snapshot');
const previousCwd = process.cwd();
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mindx-round27-fixtures-'));
process.chdir(work);
const results = [], quiet = { log() {}, warn() {}, error() {} };
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const clean = s => s.replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, '')
  .replace(/^\s*export\s+type\s+\{[^}]*\}\s+from\s+["'][^"']+["'];?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '').replace(/\bexport\s+/g, '');
function mod(file, names, bindings = {}, source = read(file)) {
  const ctx = vm.createContext({ console: quiet, Buffer, URL, Request, Response, process, structuredClone, setTimeout, clearTimeout,
    fetch() { throw Error('REAL_NETWORK_FORBIDDEN'); }, ...bindings });
  vm.runInContext(stripTypeScriptTypes(clean(source), { mode: 'transform' }) + '\nglobalThis.out={' + names.join(',') + '};', ctx, { filename: file });
  return ctx.out;
}
function expect(ok, observation, message) { if (!ok) { const e = Error(message); e.observation = observation; throw e; } }
async function check(id, criterion, fn) {
  try { const observation = await fn(); results.push({ id, criterion, pass: true, observation }); console.log('PASS ' + id + ' ' + JSON.stringify(observation)); }
  catch (e) { results.push({ id, criterion, pass: false, observation: e.observation, error: e.stack }); console.log('FAIL ' + id + ': ' + e.message); }
}
const allow = mod('src/lib/security/path-allowlist.ts', ['assertPathAllowed','isPathAllowed'], { fs,path,process,config:{allowedLocalDirs:[]} });
const code = mod('src/lib/file-parsers/code-reader.ts', ['parseCodeBuffer','isCorruptedBinaryBuffer']);
const archive = mod('src/lib/file-parsers/archive-reader.ts', ['inspectZipArchiveSafely','parseZipArchiveBuffer','ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES'], { AdmZip,path,...code });
const game = mod('src/lib/file-parsers/game-reader.ts', ['parseScratchSb3Buffer','parseGameMakerBuffer'], { ...archive,...code });
const media = mod('src/lib/file-parsers/media-reader.ts', ['parseMediaBuffer']);
const parser = mod('src/lib/file-parsers/index.ts', ['parseSubmissionBuffer','parseSubmissionFile'], { fs,path,...allow,...code,...archive,...game,...media,calculateSha256:sha });
const auditor = mod('src/lib/gemini/score-auditor.ts', ['auditCriterionGrades','calculateTotalScoreFromCriteria']);
const local = mod('src/lib/security/local-guard.ts', ['validateLocalRequest'], { NextResponse:Response });
const {SELECTORS} = mod('src/lib/playwright/selectors.ts', ['SELECTORS']);
const cid = 'AUDIT_PTA_CLASS', sid = cid + '_SESS_01';
const rubric = { rubricId:'R19', courseCode:'PTA', sessionNumber:1, assignmentTitle:'Print', assignmentPrompt:'Print 1', maxTotalScore:100,
  criteria:[{criterionId:'C1',name:'Output',maxPoints:100,description:'Print 1',expectedSnippetOrConcept:'print(1)'}] };
const grades = (points=80) => [{criterionId:'C1',criterionName:'Output',earnedPoints:points,maxPoints:100,evidenceSnippet:'print(1)',deductionReason:'Thiếu định dạng'}];
const record = extra => ({classId:cid,sessionId:sid,studentId:'S1',submissionId:'SUB1',originalFileName:'main.py',localFilePath:'',fileHash:'file-v1',
  parseStatus:'PARSED',parseErrorReason:null,criteriaGradesJson:JSON.stringify(grades()),calculatedScore:80,teacherOverrideScore:null,decision:'GRADE',
  feedbackHtml:'<p>APPROVED FEEDBACK</p>',contentHash:'',status:'WAITING_APPROVAL',verifiedAt:null,errorMessage:null,...extra});
function backend(extra={}, databaseFile=':memory:') {
  const db = new Database(databaseFile);
  const b = mod('src/lib/db/sqlite.ts', ['getDb','studentRepo','homeworkSubmissionRepo','scoreMatrixRepo','classSessionRepo','calculateSha256','computeHomeworkContentHash','verifyHomeworkContentIntegrity'], {
    Database:function(){return db;},crypto,path,process,fs:{existsSync:()=>true},assertPathAllowed:p=>p,
  });
  b.getDb(); b.studentRepo.upsert({classId:cid,studentId:'S1',fullName:'Học Viên Mẫu',isActive:1});
  b.seed = patch => {const r=record(patch); if(r.status==='APPROVED'||r.status==='VERIFIED')r.contentHash=b.computeHomeworkContentHash(r); b.homeworkSubmissionRepo.upsert(r);return r;};
  b.row = () => b.homeworkSubmissionRepo.findBySubmissionId('SUB1');
  b.db=db;
  const grader = mod('src/lib/gemini/homework-grader.ts', ['HomeworkAiGrader','sanitizeFeedbackHtml','wrapInPromptInjectionSandbox'], {...b,...parser,...auditor,getGeminiModel:()=>{throw Error('UNMOCKED_AI_FORBIDDEN');}});
  const bindings={...b,...local,...parser,...auditor,...grader,...allow,fs,NextResponse:Response,...extra};
  b.approve=mod('src/app/api/homework-grader/approve/route.ts',['POST'],bindings).POST;
  b.draft=mod('src/app/api/homework-grader/submissions/route.ts',['POST','GET'],bindings);
  b.req=(body,origin)=>new Request('http://127.0.0.1:3000/api/homework-grader/submissions',{method:'POST',headers:{host:'127.0.0.1:3000','content-type':'application/json',...(origin?{origin}:{})},body:JSON.stringify({classId:cid,sessionId:sid,studentId:'S1',submissionId:'SUB1',...body})});
  return b;
}
const zip = entries => {const z=new AdmZip();for(const [name,value]of entries)z.addFile(name,Buffer.isBuffer(value)?value:Buffer.from(value));return z.toBuffer();};
const parse = (data,name) => parser.parseSubmissionBuffer(Buffer.isBuffer(data)?data:Buffer.from(data),name);
const loc = overrides => ({first(){return this;},last(){return this;},nth(){return this;},locator(){return loc();},count:async()=>0,isVisible:async()=>false,
  scrollIntoViewIfNeeded:async()=>{},waitFor:async()=>{},click:async()=>{},innerText:async()=>'',getAttribute:async()=>null,fill:async()=>{},evaluate:async()=>{},...overrides});
const browserBindings = page => ({ BrowserManager:{getInstance:()=>({getPage:async()=>page})},authService:{ensureAuthenticated:async()=>{}},
  LmsHelpers:{openClassDrawer:async()=>{},switchDrawerTab:async()=>{}},SELECTORS,jobLogRepo:{add(){}},config:{lmsUrl:'https://lms.invalid'} });
const aiResponse = value => ({response:{text:()=>JSON.stringify({anonymousId:'STUDENT_01',suggestedDecision:'GRADE',feedbackHtml:'<p>Good STUDENT_01</p>',criteriaGrades:grades(),...value})}});
const candidate = patch => ({classId:cid,classCode:cid,sessionId:sid,studentId:'S1',fullName:'Học Viên Mẫu',submissionId:'SUB1',parsedContent:parse('print(1)','main.py'),...patch});
const loadGrader=(b,generateContent)=>mod('src/lib/gemini/homework-grader.ts',['HomeworkAiGrader','sanitizeFeedbackHtml','wrapInPromptInjectionSandbox'],{...b,...parser,...auditor,getGeminiModel:()=>({generateContent})});

// Real worker path, independent deterministic DOM/API doubles. No browser/network.
async function workerScenario(opt={}) {
  const b=backend(); b.seed({status:'APPROVED',...opt.seed});
  let writes=0,editorText='',radio='',score='',predicate,apiOptions,modalReads=0,radioReads=0;
  const modal=loc({count:async()=>1,isVisible:async()=>true,innerText:async()=>{modalReads++;return opt.modalText??'Học Viên Mẫu S1 SUB1';},
    locator:s=>s===SELECTORS.grading.modal.saveButton?loc({count:async()=>1,click:async()=>{writes++;opt.afterClick?.(b);}}):
      s===SELECTORS.grading.modal.richTextEditor?loc({count:async()=>opt.missingEditor?0:1,innerText:async()=>{if(opt.readbackError)throw Error('Synthetic unreadable editor');return opt.readbackFeedback??'';},evaluate:async(_fn,text)=>{editorText=text;opt.beforeClick?.(b);}}):
      s===SELECTORS.grading.modal.scoreInput?loc({count:async()=>1,fill:async v=>{score=v;}}):
      loc({count:async()=>1,isChecked:async()=>{radioReads++;return opt.readbackDecision?(s===(opt.readbackDecision==='REDO'?SELECTORS.grading.modal.radioRedo:SELECTORS.grading.modal.radioGrade)):(s===radio);},click:async()=>{radio=s;}})});
  const cell=loc({count:async()=>1,innerText:async()=>{opt.duringReadback?.(b);return opt.cellText??(opt.seed?.decision==='REDO'?'Yêu cầu làm lại':'80/100');}});
  const cells=loc({count:async()=>2,nth:()=>cell});
  const row=loc({count:async()=>1,innerText:async()=> 'Học Viên Mẫu\nS1',locator:s=>s==='> div, > td'?cells:row});
  const rows=loc({count:async()=>1,nth:()=>row});
  const panel=loc({isVisible:async()=>true,locator:()=>rows});
  const drawer=loc({locator:s=>s==='#tabpanel-3'?panel:rows});
  const page={locator:s=>s===SELECTORS.grading.modal.container?modal:drawer,waitForTimeout:async()=>{},keyboard:{press:async()=>{}}};
  const interceptor={dismissForbiddenToast:async()=>{},waitForApiResponse:async(url,options)=>{
    predicate=options.requestPredicate;apiOptions={url,method:options.method,operationName:options.operationName??null};
    if(opt.apiBody&&!predicate(JSON.stringify(opt.apiBody)))throw Error('Synthetic API did not match');
    return {status:()=>opt.http??200,json:async()=>opt.graphql?{errors:[{message:'denied'}]}:(opt.responseBody??{data:{saveGrade:true}})};
  }};
  const W=mod('src/lib/playwright/grade-worker.ts',['HomeworkGradeWorker'],{...b,...browserBindings(page),...(opt.columns?{scoreMatrixRepo:{findByClass:()=>({matrix:{columns:opt.columns}})}}:{}),createNetworkInterceptor:()=>interceptor}).HomeworkGradeWorker;
  try {const result=await W.saveApprovedGrades({classId:cid,classCode:cid,sessionId:sid,...opt.options});return {writes,verified:result.verifiedCount,status:b.row().status,feedback:b.row().feedbackHtml,editorText,radio,score,modalReads,radioReads,predicate,apiOptions,error:result.results[0]?.error};}
  finally{b.db.close();}
}
async function downloadScenario(opt={}) {
  const b=backend();
  const content=Buffer.from(opt.bytes??'print("S1")');let clicked=0;
  const modal=loc({isVisible:async()=>true,innerText:async()=>opt.modalText??'Học Viên Mẫu S1 SUB1',locator:s=>s.includes('button')?loc({count:async()=>1,click:async()=>{clicked++;}}):loc()});
  const cell=loc({click:async()=>{}}),cells=loc({count:async()=>2,nth:()=>cell});
  const row=loc({count:async()=>1,innerText:async()=>opt.rowText??'Học Viên Mẫu S1',locator:s=>s==='> div, > td'?cells:row});
  const rows=loc({count:async()=>1,nth:()=>row});const panel=loc({isVisible:async()=>true,locator:()=>rows});const drawer=loc({locator:s=>s==='#tabpanel-3'?panel:rows});
  const page={locator:s=>s===SELECTORS.grading.modal.container?modal:drawer,waitForTimeout:async()=>{},keyboard:{press:async()=>{}},
    waitForEvent:async()=>({saveAs:async f=>fs.writeFileSync(f,content)})};
  const matrix={success:true,columns:[{columnId:'L1',lessonId:'L1',sessionNumber:1,colIndex:0},{columnId:'L2',lessonId:'L2',sessionNumber:2,colIndex:1}],
    rows:[{studentId:'S1',fullName:'Học Viên Mẫu',cells:{L1:{submissionId:'SUB1',status:'SUBMITTED_UNGRADED',attachments:['main.py']},L2:{submissionId:'SUB2',status:'SUBMITTED_UNGRADED',attachments:['main.py']}}}]};
  const D=mod('src/lib/playwright/download-submissions.ts',['SubmissionDownloader','buildSubmissionFilePath'],{...b,...parser,...allow,fs,path,...browserBindings(page),
    scoreMatrixRepo:{findByClass:()=>({matrix})},ScoreScraper:{scrapeClassScores:async()=>{throw Error('Must use synthetic cache');}},createNetworkInterceptor:()=>({dismissForbiddenToast:async()=>{}})});
  if (opt.existingStatus) {
    const p=D.buildSubmissionFilePath({classId:cid,lessonId:'L1',submissionId:'SUB1',fileName:'main.py'});
    fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,content);
    b.seed({status:opt.existingStatus,localFilePath:p,fileHash:sha(content)});
  }
  if(opt.wrongOwner)b.seed({studentId:'S2'});
  try{const result=await D.SubmissionDownloader.downloadLessonSubmissions({classId:cid,classCode:cid,sessionId:sid,...opt.options});
    return {success:result.success,count:result.downloadedCount,clicked,error:result.error,itemErrors:result.items.filter(i=>!i.success).map(i=>i.error),items:result.items.map(i=>({studentId:i.studentId,submissionId:i.submissionId,sessionId:i.sessionId,lessonId:i.lessonId,fileHash:i.fileHash})),
      stored:b.homeworkSubmissionRepo.findBySession(cid,sid).map(r=>({submissionId:r.submissionId,studentId:r.studentId,fileHash:r.fileHash,status:r.status})),downloadedHash:sha(content)};
  }finally{b.db.close();}
}

// Deterministic hooks execute actual component handlers; no layout/browser claim.
function ui(fetch, initialProps={}) {
  const file='src/components/homework-auto-grader-tab.tsx', text=read(file), cut=text.indexOf('  const renderStatusBadge =');
  assert(cut>0);const source=text.slice(0,cut)+'\n globalThis.api={submissions,banner,loadSessionSubmissions,handleFieldUpdate,handleApproveSubmission,handleDownloadAndAiGrade,selectedSessionNumber,setSelectedSessionNumber,handleApproveAll,handleSaveToLms,unsavedSubIds,activeRubric,setActiveRubric,handleCriterionPointsChange,isLoadingSubs}; return null; }';
  let cursor=0,dirty=true,pending=[];const slots=[],effects=[];
  const bindings={fetch,useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>{const next=typeof v==='function'?v(slots[i]):v;if(!Object.is(next,slots[i])){slots[i]=next;dirty=true;}}];},
    useEffect(fn,deps){const i=cursor++;if(!effects[i]||deps.some((d,j)=>!Object.is(d,effects[i][j]))){effects[i]=deps;pending.push(fn);}}};
  const ctx=vm.createContext({console:quiet,structuredClone,...bindings});
  vm.runInContext(stripTypeScriptTypes(clean(source),{mode:'transform'})+'\nglobalThis.render=HomeworkAutoGraderTab;',ctx);
  let props={classId:cid,classCode:cid,columns:[{sessionNumber:1,columnId:'L1'},{sessionNumber:2,columnId:'L2'}],initialRubrics:[],...initialProps};
  const flush=async()=>{for(let i=0;i<15;i++){await new Promise(r=>setImmediate(r));if(dirty){dirty=false;cursor=0;ctx.render(props);const run=pending;pending=[];run.forEach(f=>f());}}};
  return {get api(){return ctx.api;},flush,setProps(patch){props={...props,...patch};dirty=true;}};
}
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};


// R19 INLINE checks measure MIME/Base64 fidelity. Its tiny JPG/WebP/PDF examples
// are not valid media. Keep all 94 assertions and IDs, supply valid fixtures so
// stronger corruption rejection can pass without contradicting those checks.
function blankPdf(){
  let text='%PDF-1.4\n';const offsets=[0];
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Resources << >> /Contents 4 0 R >>','<< /Length 0 >>\nstream\nendstream'];
  objects.forEach((v,i)=>{offsets.push(Buffer.byteLength(text));text+=(i+1)+' 0 obj\n'+v+'\nendobj\n';});
  const xref=Buffer.byteLength(text);text+='xref\n0 5\n0000000000 65535 f \n'+offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';return Buffer.from(text);
}
const inlineMedia={pdf:blankPdf()};
for(const ext of ['png','jpg','webp'])inlineMedia[ext]=await sharp({create:{width:2,height:2,channels:3,background:'#e02040'}}).toFormat(ext==='jpg'?'jpeg':ext).toBuffer();

// R22 cases describe required safe outcomes; failures must remain visible.
const fullMutation=(patch={})=>({operationName:'SaveHomeworkGrade',query:'mutation SaveHomeworkGrade { saveHomeworkGrade }',variables:{studentId:'S1',submissionId:'SUB1',classId:cid,sessionId:sid,score:80,decision:'GRADE',feedback:'APPROVED FEEDBACK'},...patch});
const strictWorker=opt=>workerScenario({apiBody:fullMutation(),readbackFeedback:'APPROVED FEEDBACK',...opt});
const uiItem=row=>({...row,criteriaGrades:JSON.parse(row.criteriaGradesJson),fullName:'Synthetic'});
const approvalRequest=(b,body)=>b.req({...body,...(body.approveAll?{submissionId:''}:{})});
const safeGrades=points=>grades(points).map(g=>({...g,deductionReason:'Teacher reviewed'}));
const view=b=>({submissionId:'SUB1',fileHash:b.row().fileHash,feedbackHtml:b.row().feedbackHtml,criteriaGrades:JSON.parse(b.row().criteriaGradesJson),decision:b.row().decision,teacherOverrideScore:b.row().teacherOverrideScore});
function wiredUi(b,observations=[],intercept){return ui(async(url,opts)=>{
  if(url.includes('/approve')){const body=JSON.parse(opts.body);observations.push({kind:'approve',body});const r=await b.approve(approvalRequest(b,body));observations.at(-1).http=r.status;return r;}
  if(opts?.method==='POST'){const body=JSON.parse(opts.body);if(intercept)await intercept(body);const r=await b.draft.POST(b.req(body));observations.push({kind:'draft',body,http:r.status});return r;}
  return Response.json({success:true,data:{submissions:[uiItem(b.row())]}});
},{initialRubrics:[rubric]});}
function crc32(buf){let crc=0xffffffff;for(const n of buf){crc^=n;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
function alterPng(type,fn,repairCrc=true){const buf=Buffer.from(inlineMedia.png);for(let o=8;o<buf.length;){const n=buf.readUInt32BE(o);if(buf.toString('ascii',o+4,o+8)===type){fn(buf,o+8,n);if(repairCrc)buf.writeUInt32BE(crc32(buf.subarray(o+4,o+8+n)),o+8+n);return buf;}o+=12+n;}throw Error('Fixture chunk missing');}
function webpChunk(fourcc,payload){const chunk=Buffer.alloc(8+payload.length+(payload.length%2));chunk.write(fourcc);chunk.writeUInt32LE(payload.length,4);payload.copy(chunk,8);return chunk;}
function riff(...chunks){const payload=Buffer.concat([Buffer.from('WEBP'),...chunks]);const header=Buffer.alloc(8);header.write('RIFF');header.writeUInt32LE(payload.length,4);return Buffer.concat([header,payload]);}
async function invalidImage(ext,data){let decoderError='';try{await sharp(data).raw().toBuffer();}catch(e){decoderError=e.message;}assert(decoderError,'Independent decoder must reject the fixture');const r=parse(data,'invalid.'+ext);const o={bytes:data.length,decoderError,parseStatus:r.parseStatus,inlineParts:r.inlineDataParts.length};expect(r.parseStatus==='PARSE_ERROR'&&r.inlineDataParts.length===0,o,'Invalid media accepted as multimodal input');return o;}
function reloadRepo(b){return mod('src/lib/db/sqlite.ts',['getDb','studentRepo','homeworkSubmissionRepo','scoreMatrixRepo','classSessionRepo','calculateSha256','computeHomeworkContentHash','verifyHomeworkContentIntegrity'],{Database:function(){return b.db;},crypto,path,process,fs:{existsSync:()=>true},assertPathAllowed:p=>p});}
function routeBindings(b){return {...b,...local,...parser,...auditor,...allow,fs,NextResponse:Response,...loadGrader(b,async()=>aiResponse())};}
try {
  for(const ext of ['png','jpg','webp','pdf'])await check('R22-01-valid-'+ext,'Valid media must retain exact bytes',()=>{const r=parse(inlineMedia[ext],'valid.'+ext);assert.equal(r.parseStatus,'PARSED');assert.equal(Buffer.compare(Buffer.from(r.inlineDataParts[0].inlineData.data,'base64'),inlineMedia[ext]),0);return {bytes:inlineMedia[ext].length};});
  for(const type of ['IHDR','IDAT','IEND'])await check('R22-01-png-crc-'+type,'CRC of every PNG chunk must be checked',()=>{const buf=alterPng(type,(b,s,n)=>{b[s+n]^=1;},false);const r=parse(buf,'crc.png');assert.equal(r.parseStatus,'PARSE_ERROR');assert.equal(r.inlineDataParts.length,0);});
  await check('R22-01-png-invalid-zlib-header','Recomputed CRC cannot hide invalid zlib header',()=>invalidImage('png',alterPng('IDAT',(b,s)=>{b[s]=0;b[s+1]=0;})));
  await check('R22-01-png-valid-header-broken-deflate','Valid zlib header and CRC do not prove compressed data is valid',()=>invalidImage('png',alterPng('IDAT',(b,s,n)=>{b[s]=0x78;b[s+1]=0x9c;b.fill(0xff,s+2,s+n);} )));
  await check('R22-01-png-invalid-bit-depth','Invalid IHDR bit depth with correct CRC must be rejected',()=>invalidImage('png',alterPng('IHDR',(b,s)=>{b[s+8]=0;})));
  const jpegSegment=(marker,payload)=>{const h=Buffer.alloc(4);h[0]=255;h[1]=marker;h.writeUInt16BE(payload.length+2,2);return Buffer.concat([h,payload]);};
  const fakeJpeg=Buffer.concat([Buffer.from([255,216]),jpegSegment(0xdb,Buffer.concat([Buffer.from([0]),Buffer.alloc(64,1)])),jpegSegment(0xc0,Buffer.from([8,0,1,0,1,1,1,0x11,0])),jpegSegment(0xda,Buffer.from([1,2,0,0,63,0])),Buffer.from([0,255,217])]);
  await check('R22-01-jpeg-valid-markers-invalid-component','SOF/SOS component IDs must refer to the same actual image components',()=>invalidImage('jpg',fakeJpeg));
  await check('R22-01-jpeg-zero-dimension','JPEG zero dimension must be rejected',()=>{const b=Buffer.from(fakeJpeg);const i=b.indexOf(Buffer.from([255,192]));b.writeUInt16BE(0,i+5);assert.equal(parse(b,'zero.jpg').parseStatus,'PARSE_ERROR');});
  const vp8=Buffer.from([0x10,0,0,0x9d,1,0x2a,1,0,1,0]);
  const vp8l=Buffer.from([0x2f,0,0,0,0]);
  await check('R22-01-webp-vp8-header-only','VP8 start code and dimensions without image data must fail',()=>invalidImage('webp',riff(webpChunk('VP8 ',vp8))));
  await check('R22-01-webp-vp8l-header-only','VP8L signature/version without image data must fail',()=>invalidImage('webp',riff(webpChunk('VP8L',vp8l))));
  await check('R22-01-webp-vp8x-empty-child','VP8X must validate the declared following image chunk',()=>invalidImage('webp',riff(webpChunk('VP8X',Buffer.alloc(10)),webpChunk('VP8 ',Buffer.alloc(0)))));
  await check('R22-01-webp-valid-transparent','A decoder-valid transparent extended WebP must remain supported',async()=>{const buf=await sharp({create:{width:2,height:2,channels:4,background:{r:100,g:30,b:200,alpha:0.5}}}).webp().toBuffer();await sharp(buf).raw().toBuffer();const r=parse(buf,'transparent.webp');const o={bytes:buf.length,firstChunk:buf.toString('ascii',12,16),nextChunk:buf.toString('ascii',30,34),parseStatus:r.parseStatus};expect(r.parseStatus==='PARSED',o,'Valid alpha WebP rejected');return o;});
  for(const [name,data]of [
    ['comments-only',Buffer.from('%PDF-1.4\n% 1 0 obj /Type /Catalog endobj\n% NO REAL OBJECTS HERE, ONLY COMMENTS\n%%EOF\n')],
    ['missing-pages',Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 999 0 R >>\nendobj\n%%EOF\n'+' '.repeat(20))]
  ])await check('R22-01-pdf-'+name,'PDF words must identify actual usable objects/pages',()=>{const r=parse(data,'invalid.pdf');const o={bytes:data.length,parseStatus:r.parseStatus,inlineParts:r.inlineDataParts.length,body:data.toString()};expect(r.parseStatus==='PARSE_ERROR'&&r.inlineDataParts.length===0,o,'Structurally invalid PDF accepted');return o;});
  for(const mode of ['unchanged','changed','deleted'])await check('R22-04-supplied-'+mode,'Disk must be rechecked after AI even with supplied parsed content',async()=>{const b=backend();try{const p=path.join(work,'supplied-'+mode+'.py');fs.writeFileSync(p,'print(1)');b.seed({localFilePath:p,fileHash:sha(fs.readFileSync(p))});const before=JSON.stringify(b.row());const supplied=parser.parseSubmissionFile(p);const g=loadGrader(b,async()=>{if(mode==='changed')fs.writeFileSync(p,'print(2)');if(mode==='deleted')fs.unlinkSync(p);return aiResponse();});const r=await g.HomeworkAiGrader.gradeSingleSubmission(candidate({localFilePath:p,parsedContent:supplied}),rubric);const o={mode,staleIgnored:r.staleIgnored??false,dbUnchanged:JSON.stringify(b.row())===before};if(mode==='unchanged')assert.equal(r.staleIgnored??false,false);else expect(r.staleIgnored===true&&o.dbUnchanged,o,'Stale physical file was graded');return o;}finally{b.db.close();}});
  for(const mode of ['single','bulk','criterion'])await check('R22-05-ui-rubric-'+mode,'All three UI handlers must send and enforce active rubric',async()=>{const b=backend();try{b.seed({criteriaGradesJson:JSON.stringify([{...grades()[0],criterionId:'UNRELATED'}])});const events=[];const h=wiredUi(b,events);await h.flush();if(mode==='single')await h.api.handleApproveSubmission(h.api.submissions[0]);else if(mode==='bulk')await h.api.handleApproveAll();else await h.api.handleCriterionPointsChange(h.api.submissions[0],'UNRELATED','90');await h.flush();const e=events.find(e=>e.kind===(mode==='criterion'?'draft':'approve'));const o={mode,requestHasRubric:Boolean(e?.body?.rubric),rubricId:e?.body?.rubric?.rubricId,status:b.row().status,points:JSON.parse(b.row().criteriaGradesJson)[0].earnedPoints,http:e?.http};expect(o.requestHasRubric&&e.body.rubric.criteria[0].criterionId==='C1'&&b.row().status!=='APPROVED'&&(mode!=='criterion'||o.points===80),o,'Active rubric missing or ignored');return o;}finally{b.db.close();}});
  for(const withDecision of [true,false])await check('R22-06-single-missing-hash-'+withDecision,'Every single approval must prove reviewed file version',async()=>{const b=backend();try{b.seed();const r=await b.approve(b.req({rubric,...(withDecision?{decision:'GRADE'}:{})}));const o={withDecision,http:r.status,status:b.row().status};expect(r.status===409&&b.row().status!=='APPROVED',o,'Omitting decision bypasses mandatory file version');return o;}finally{b.db.close();}});
  for(const mode of ['missing-list','missing-feedback','matching','wrong-hash'])await check('R22-06-bulk-review-'+mode,'Bulk approval must require the complete reviewed version',async()=>{const b=backend();try{b.seed();const rev=view(b);if(mode==='missing-feedback'){delete rev.feedbackHtml;b.homeworkSubmissionRepo.upsert({...b.row(),feedbackHtml:'NOT REVIEWED'});}if(mode==='wrong-hash')rev.fileHash='older';const body={approveAll:true,rubric,...(mode==='missing-list'?{}:{reviewedSubmissions:[rev]})};const res=await b.approve(approvalRequest(b,body));const json=await res.json();const o={mode,http:res.status,status:b.row().status,approvedCount:json.data?.approvedCount,skipped:json.data?.skippedIds};expect(mode==='matching'?b.row().status==='APPROVED':b.row().status!=='APPROVED',o,'Bulk signed data without complete matching reviewed snapshot');return o;}finally{b.db.close();}});
  for(const field of ['criteria','override','decision','feedback','file'])await check('R22-06-ui-bulk-drift-'+field,'Bulk must compare every reviewed scoring field',async()=>{const b=backend();try{b.seed();const events=[];const h=wiredUi(b,events);await h.flush();const old={score:h.api.submissions[0].calculatedScore,decision:h.api.submissions[0].decision};if(field==='file')b.homeworkSubmissionRepo.upsert({...b.row(),fileHash:'new-v2'});else{const patch=field==='criteria'?{criteriaGrades:safeGrades(90),rubric}:field==='override'?{teacherOverrideScore:25}:field==='decision'?{decision:'REDO'}:{feedbackHtml:'NOT REVIEWED'};const r=await b.draft.POST(b.req({draftSeq:1,...patch}));assert.equal(r.status,200);}const result=await h.api.handleApproveAll();await h.flush();const o={field,result,status:b.row().status,reviewed:old,stored:{score:b.row().calculatedScore,override:b.row().teacherOverrideScore,decision:b.row().decision},request:events.find(e=>e.kind==='approve')?.body};expect(b.row().status!=='APPROVED',o,'Real UI bulk handler signed a different reviewed score/decision');return o;}finally{b.db.close();}});
  await check('R22-06-graded-hash-reload','Graded file version must survive repository module restart',async()=>{const b=backend();try{b.seed({fileHash:'graded-v1'});b.homeworkSubmissionRepo.upsert({...b.row(),fileHash:'ungraded-v2',status:'WAITING_APPROVAL'});const before=b.row()._gradedFileHash;const fresh=reloadRepo(b);const after=fresh.homeworkSubmissionRepo.findBySubmissionId('SUB1')._gradedFileHash;const route=mod('src/app/api/homework-grader/approve/route.ts',['POST'],{...routeBindings(b),...fresh}).POST;const r=await route(b.req({rubric,decision:'GRADE',fileHash:'ungraded-v2'}));const o={beforeRestart:before,afterRestart:after,http:r.status,status:b.row().status};expect(r.status===409&&b.row().status!=='APPROVED',o,'In-memory graded hash was lost and an ungraded version approved');return o;}finally{b.db.close();}});
  for(const [name,patch,expected]of [
    ['normal',{},1],
    ['comment-query',{query:'# mutation\nquery SaveHomeworkGrade { studentSubmission { id } }'},0],
    ['selected-query',{query:'mutation Other { saveHomeworkGrade } query SaveHomeworkGrade { studentSubmission { id } }'},0],
    ['attachment',{query:'mutation SaveHomeworkGrade { saveSubmissionAttachment { id } }'},0],
    ['selected-mutation',{query:'query Other { studentSubmission { id } } mutation SaveHomeworkGrade { saveHomeworkGrade }'},1],
    ['missing-query',{query:undefined},0],
    ['alias-introspection',{query:'mutation SaveHomeworkGrade { score: __typename }'},0],
    ['skipped-grade',{query:'mutation SaveHomeworkGrade { saveHomeworkGrade @skip(if: true) { id } }'},0],
    ['literal-other-submission',{query:'mutation SaveHomeworkGrade { saveHomeworkGrade(submissionId: "SUB_OTHER", studentId: "S_OTHER", score: 1, feedback: "WRONG") }'},0]
  ])await check('R22-09-operation-'+name,'Only the selected actual grading mutation with matching arguments may confirm a write',async()=>{const responseBody=name==='alias-introspection'?{data:{score:'Mutation'}}:name==='skipped-grade'?{data:{}}:name==='literal-other-submission'?{data:{saveHomeworkGrade:{id:'SUB_OTHER'}}}:{data:{saveHomeworkGrade:{id:'SUB1'}}};const r=await strictWorker({apiBody:fullMutation(patch),responseBody});const o={name,verified:r.verified,writes:r.writes,query:patch.query??null};expect(r.verified===expected,o,'GraphQL operation contract not enforced');return o;});
  for(const filter of ['mindx.edu.vn','lms-api'])await check('R22-R12-host-'+filter,'Domain and legacy hostname label must match only parsed hostname',async()=>{const N=mod('src/lib/playwright/network-interceptor.ts',['NetworkInterceptor'],{SELECTORS}).NetworkInterceptor;const obs=[];for(const [url,expected]of [['https://lms-api.mindx.edu.vn/',true],['https://evil.invalid/?next=https://lms-api.mindx.edu.vn/',false],['https://evil.invalid/lms-api/mindx.edu.vn',false],['https://mindx.edu.vn.evil.invalid/',false]]){let matched;const response={url:()=>url,status:()=>200,json:async()=>({data:{}}),request:()=>({method:()=> 'POST',postData:()=>JSON.stringify(fullMutation())})};await new N({waitForResponse:async fn=>{matched=fn(response);return response;}}).waitForApiResponse(filter,{method:'POST'});obs.push({url,matched,expected});assert.equal(matched,expected);}return obs;});
  await check('R22-13-reordered-same-field','Older draft arriving after newer draft must get 409',async()=>{const b=backend();try{b.seed();const newer=await b.draft.POST(b.req({draftSeq:2,feedbackHtml:'LATEST'}));const older=await b.draft.POST(b.req({draftSeq:1,feedbackHtml:'OLD'}));const o={newer:newer.status,older:older.status,stored:b.row().feedbackHtml};expect(newer.status===200&&older.status===409&&o.stored==='LATEST',o,'Older sequence overwrote newer content');return o;}finally{b.db.close();}});
  await check('R22-13-cross-field-reorder','Reordering partial drafts must retain all latest edited fields',async()=>{const b=backend();try{b.seed();const hold=defer(),events=[];let saves=0;const h=wiredUi(b,events,async()=>{if(++saves===1)await hold.promise;});await h.flush();const first=h.api.handleFieldUpdate(h.api.submissions[0],{feedbackHtml:'LATEST FEEDBACK'});await h.flush();await h.api.handleFieldUpdate(h.api.submissions[0],{teacherOverrideScore:25});await h.flush();hold.resolve();await first;await h.flush();const o={storedFeedback:b.row().feedbackHtml,visibleFeedback:h.api.submissions[0].feedbackHtml,override:b.row().teacherOverrideScore,unsaved:structuredClone(h.api.unsavedSubIds),http:events.filter(e=>e.kind==='draft').map(e=>e.http)};expect(o.storedFeedback==='LATEST FEEDBACK'&&o.override===25,o,'Latest successful partial save discarded another edited field');return o;}finally{b.db.close();}});
  await check('R22-13-two-tabs-equal-sequence','Independent UI counters must not let an older tab overwrite and approve the newest score',async()=>{const b=backend();try{b.seed();const hold=defer(),events=[];const firstTab=wiredUi(b,events,async()=>hold.promise);const secondTab=wiredUi(b,events);await firstTab.flush();await secondTab.flush();const old=firstTab.api.handleCriterionPointsChange(firstTab.api.submissions[0],'C1','60');await firstTab.flush();await secondTab.api.handleCriterionPointsChange(secondTab.api.submissions[0],'C1','90');await secondTab.flush();hold.resolve();await old;await firstTab.flush();const before={visible:secondTab.api.submissions[0].calculatedScore,stored:b.row().calculatedScore,unsaved:structuredClone(secondTab.api.unsavedSubIds)};await secondTab.api.handleApproveAll();await secondTab.flush();const o={before,status:b.row().status,stored:b.row().calculatedScore,drafts:events.filter(e=>e.kind==='draft').map(e=>({seq:e.body.draftSeq,http:e.http,points:e.body.criteriaGrades[0].earnedPoints}))};expect(b.row().calculatedScore===90&&!(b.row().status==='APPROVED'&&b.row().calculatedScore!==before.visible),o,'Equal client sequences allowed old score to be signed');return o;}finally{b.db.close();}});
  await check('R22-13-reload-counter','A legitimate edit after browser reload must still save',async()=>{const b=backend();try{b.seed();const h1=wiredUi(b);await h1.flush();await h1.api.handleFieldUpdate(h1.api.submissions[0],{feedbackHtml:'ONE'});await h1.flush();await h1.api.handleFieldUpdate(h1.api.submissions[0],{feedbackHtml:'TWO'});await h1.flush();const events=[];const h2=wiredUi(b,events);await h2.flush();const ok=await h2.api.handleFieldUpdate(h2.api.submissions[0],{feedbackHtml:'THREE AFTER RELOAD'});await h2.flush();const o={saved:ok,stored:b.row().feedbackHtml,visible:h2.api.submissions[0].feedbackHtml,http:events[0]?.http,seq:events[0]?.body.draftSeq};expect(ok&&o.stored==='THREE AFTER RELOAD',o,'Browser reload reset client counter below server counter');return o;}finally{b.db.close();}});
  await check('R22-13-invalid-request-poison','A rejected identity must not advance another submission sequence',async()=>{const b=backend();try{b.seed();const bad=await b.draft.POST(b.req({classId:'WRONG_CLASS',draftSeq:100,feedbackHtml:'BAD'}));const good=await b.draft.POST(b.req({draftSeq:1,feedbackHtml:'LEGITIMATE'}));const o={bad:bad.status,good:good.status,stored:b.row().feedbackHtml};expect(bad.status===400&&good.status===200&&o.stored==='LEGITIMATE',o,'Rejected request advanced sequence before identity validation');return o;}finally{b.db.close();}});
  await check('R22-13-route-reload','Server sequence protection must survive route module reload',async()=>{const b=backend();try{b.seed();await b.draft.POST(b.req({draftSeq:2,feedbackHtml:'LATEST'}));const fresh=mod('src/app/api/homework-grader/submissions/route.ts',['POST'],routeBindings(b)).POST;const old=await fresh(b.req({draftSeq:1,feedbackHtml:'OLD AFTER RELOAD'}));const o={http:old.status,stored:b.row().feedbackHtml};expect(old.status===409&&o.stored==='LATEST',o,'Server sequence existed only in process memory');return o;}finally{b.db.close();}});

  // New R23 boundaries, in addition to the 53 unchanged inherited R22 assertions.
  const zlib = process.getBuiltinModule('node:zlib');
  function pngChunk(type, data) {
    const n=Buffer.alloc(4); n.writeUInt32BE(data.length);
    const body=Buffer.concat([Buffer.from(type),data]); const crc=Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([n,body,crc]);
  }
  function tinyPng(raw, {depth=8,color=2,interlace=0}={}) {
    const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(1,0); ihdr.writeUInt32BE(1,4);
    ihdr[8]=depth; ihdr[9]=color; ihdr[12]=interlace;
    return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',ihdr),pngChunk('IDAT',zlib.deflateSync(raw)),pngChunk('IEND',Buffer.alloc(0))]);
  }
  for(const [name,depth,color] of [['zero-depth',0,2],['rgb-depth4',4,2],['palette-depth16',16,3],['reserved-color',8,1]])
    await check('R23-01-png-'+name,'IHDR must reject invalid bitDepth/colorType combinations',()=>invalidImage('png',tinyPng(Buffer.from([0,255,0,0]),{depth,color})));
  for(const filterByte of [0,1,2,3,4]) await check('R23-01-png-valid-filter-'+filterByte,'Every valid non-interlaced PNG filter remains accepted',async()=>{
    const buf=tinyPng(Buffer.from([filterByte,255,0,0])); await sharp(buf).raw().toBuffer();
    const r=parse(buf,'valid-filter.png'); assert.equal(r.parseStatus,'PARSED'); return {filterByte,bytes:buf.length};
  });
  for(const interlace of [0,1]) for(const [name,raw] of [['filter5',Buffer.from([5,255,0,0])],['short-row',Buffer.from([0])]])
    await check('R23-01-png-interlace'+interlace+'-'+name,'Inflated PNG scanlines need valid filter bytes and lengths, including Adam7',()=>invalidImage('png',tinyPng(raw,{interlace})));
  await check('R23-01-png-valid-adam7','A valid interlaced 1x1 PNG remains supported',async()=>{
    const buf=tinyPng(Buffer.from([0,255,0,0]),{interlace:1}); await sharp(buf).raw().toBuffer(); assert.equal(parse(buf,'adam7.png').parseStatus,'PARSED');
  });
  const forgedVp8=Buffer.from([0x20,0,0,0x9d,1,0x2a,1,0,1,0,255]);
  const forgedVp8l=Buffer.from([0x2f,0,0,0,0,255,255,255]);
  for(const [name,buf] of [
    ['vp8-nonempty-garbage',riff(webpChunk('VP8 ',forgedVp8))],
    ['vp8l-nonempty-garbage',riff(webpChunk('VP8L',forgedVp8l))],
    ['vp8x-alpha-garbage',riff(webpChunk('VP8X',Buffer.from([16,0,0,0,0,0,0,0,0,0])),webpChunk('ALPH',Buffer.from([0,128])),webpChunk('VP8 ',forgedVp8))]
  ]) await check('R23-01-webp-'+name,'Nonempty VP8/VP8L payloads must contain decodable image data',()=>invalidImage('webp',buf));
  for(const lossless of [false,true]) await check('R23-01-webp-valid-alpha-'+lossless,'Valid alpha WebP must preserve original bytes',async()=>{
    const buf=await sharp({create:{width:3,height:3,channels:4,background:{r:120,g:30,b:200,alpha:0.3}}}).webp({lossless}).toBuffer();
    await sharp(buf).raw().toBuffer(); const p=parse(buf,'alpha.webp'); assert.equal(p.parseStatus,'PARSED'); assert.equal(p.inlineDataParts[0].inlineData.data,buf.toString('base64')); return {lossless,bytes:buf.length};
  });
  const pdfBody = objects => Buffer.from('%PDF-1.4\n'+objects.map((v,i)=>(i+1)+' 0 obj\n'+v+'\nendobj\n').join('')+'trailer\n<< /Root 1 0 R >>\n%%EOF\n');
  for(const [name,objects] of [
    ['missing-kid',['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [999 0 R] /Count 1 >>','<< /Type /Page /Parent 777 0 R >>']],
    ['empty-pages-orphan-leaf',['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [] /Count 0 >>','<< /Type /Page /Parent 999 0 R >>']],
    ['cycle-with-orphan-leaf',['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [2 0 R] /Count 1 >>','<< /Type /Page /Parent 999 0 R >>']]
  ]) await check('R23-01-pdf-'+name,'Catalog must reach a real Page through its actual Pages tree',()=>{
    const buf=pdfBody(objects),r=parse(buf,'broken-tree.pdf'); const o={body:buf.toString(),parseStatus:r.parseStatus,inlineParts:r.inlineDataParts.length};
    expect(r.parseStatus==='PARSE_ERROR'&&r.inlineDataParts.length===0,o,'Disconnected/cyclic PDF page tree accepted'); return o;
  });
  await check('R23-06-single-omits-hash-decision-rubric','File version is mandatory even when both decision and rubric are absent',async()=>{
    const b=backend(); try {b.seed(); const r=await b.approve(b.req({})); const o={http:r.status,status:b.row().status}; expect(r.status===409&&o.status!=='APPROVED',o,'Minimal approval bypassed mandatory fileHash'); return o;} finally {b.db.close();}
  });
  for(const field of ['fileHash','feedbackHtml','decision','teacherOverrideScore','criteriaGrades']) for(const malformed of [false,true])
    await check('R23-06-bulk-'+(malformed?'malformed-':'missing-')+field,'Bulk must require a complete typed reviewed snapshot for every scoring field',async()=>{
      const b=backend(); try {b.seed(); const rev=view(b); if(malformed)rev[field]=field==='teacherOverrideScore'?{}:null; else delete rev[field];
        if(['decision','teacherOverrideScore','criteriaGrades'].includes(field)) {
          const patch=field==='decision'?{decision:'REDO'}:field==='teacherOverrideScore'?{teacherOverrideScore:25}:{criteriaGrades:safeGrades(90),rubric};
          assert.equal((await b.draft.POST(b.req({draftSeq:1,...patch}))).status,200);
        }
        const r=await b.approve(approvalRequest(b,{approveAll:true,rubric,reviewedSubmissions:[rev]})); const j=await r.json();
        const o={field,malformed,http:r.status,status:b.row().status,approvedCount:j.data?.approvedCount,skipped:j.data?.skippedIds,reviewed:rev,stored:{score:b.row().calculatedScore,override:b.row().teacherOverrideScore,decision:b.row().decision}};
        expect(o.status!=='APPROVED',o,'Incomplete reviewed snapshot was signed'); return o;
      } finally {b.db.close();}
    });
  await check('R23-06-file-backed-reopen','Graded file hash and per-field sequence survive closing and reopening physical SQLite',async()=>{
    const file=path.join(work,'durability.sqlite'),b=backend({},file); let disk; try {
      b.seed({fileHash:'graded-v1'}); await b.draft.POST(b.req({draftSeq:4,feedbackHtml:'REVIEWED V1'}));
      b.homeworkSubmissionRepo.upsert({...b.row(),fileHash:'ungraded-v2'});
      b.db.close(); disk=new Database(file);
      const fresh=mod('src/lib/db/sqlite.ts',['getDb','homeworkSubmissionRepo'],{Database:function(){return disk;},crypto,path,process,fs:{existsSync:()=>true},assertPathAllowed:p=>p});
      fresh.getDb(); const row=fresh.homeworkSubmissionRepo.findBySubmissionId('SUB1');
      const approval=mod('src/app/api/homework-grader/approve/route.ts',['POST'],{...routeBindings(b),...fresh}).POST;
      const r=await approval(b.req({rubric,decision:'GRADE',fileHash:'ungraded-v2'}));
      const o={gradedFileHash:row._gradedFileHash,fileHash:row.fileHash,draftSeq:row._draftSeq,fieldSeq:JSON.parse(row._fieldSeqJson),http:r.status};
      expect(o.gradedFileHash==='graded-v1'&&o.draftSeq===4&&o.fieldSeq.feedbackHtml===4&&r.status===409,o,'Durable metadata failed after physical database reopen'); return o;
    } finally {disk?.close();if(b.db.open)b.db.close();}
  });
  for(const [name,responseBody] of [
    ['missing-data',{}],['null-data',{data:null}],['string-data',{data:'not a result'}],['array-data',{data:[]}],
    ['empty-data',{data:{}}],['null-result',{data:{saveHomeworkGrade:null}}],['false-result',{data:{saveHomeworkGrade:false}}],
    ['unrelated-root',{data:{health:true}}],['wrong-result-id',{data:{saveHomeworkGrade:{id:'SUB_OTHER'}}}]
  ]) await check('R23-09-response-'+name,'HTTP success must contain a valid selected grading result',async()=>{
    const r=await strictWorker({responseBody}); const o={name,responseBody,verified:r.verified,status:r.status,error:r.error};
    expect(r.verified===0,o,'Invalid GraphQL response still marked VERIFIED'); return o;
  });
  for(const [name,patch] of [
    ['missing-operation',{operationName:undefined}],
    ['include-false',{query:'mutation SaveHomeworkGrade { saveHomeworkGrade @include(if: false) { id } }'}],
    ['include-true',{query:'mutation SaveHomeworkGrade { saveHomeworkGrade @include(if: true) { id } }'}],
    ['literal-wrong-class',{query:'mutation SaveHomeworkGrade { saveHomeworkGrade(classId: "WRONG") }'}],
    ['literal-wrong-session',{query:'mutation SaveHomeworkGrade { saveHomeworkGrade(sessionId: "WRONG") }'}],
    ['literal-wrong-decision',{query:'mutation SaveHomeworkGrade { saveHomeworkGrade(decision: REDO) }'}],
    ['nested-wrong-submission',{query:'mutation SaveHomeworkGrade { saveHomeworkGrade(input: {submissionId: "SUB_OTHER"}) }'}],
    ['bound-wrong-variable',{query:'mutation SaveHomeworkGrade($otherId: ID!) { saveHomeworkGrade(submissionId: $otherId) }',variables:{...fullMutation().variables,otherId:'SUB_OTHER'}}]
  ]) await check('R23-09-request-'+name,'Selected arguments and variable bindings must match the approved submission',async()=>{
    const body=fullMutation(patch),r=await strictWorker({apiBody:body,responseBody:{data:{saveHomeworkGrade:true}}});
    const o={name,request:body,verified:r.verified,status:r.status,error:r.error}; expect(r.verified===0,o,'Request contract accepted unproven or mismatched grading operation'); return o;
  });
  await check('R23-09-valid-alias','A valid alias of the actual grading field remains accepted',async()=>{
    const r=await strictWorker({apiBody:fullMutation({query:'mutation SaveHomeworkGrade { saved: saveHomeworkGrade }'}),responseBody:{data:{saved:{id:'SUB1'}}}}); assert.equal(r.verified,1);return {verified:r.verified};
  });
  for(const [name,bad] of [['wrong-owner',{studentId:'S_OTHER',feedbackHtml:'BAD'}],['bad-override',{teacherOverrideScore:101}],['bad-criteria',{criteriaGrades:safeGrades(-1),rubric}]])
    await check('R23-13-invalid-'+name,'Rejected input must not advance committed metadata',async()=>{
      const b=backend();try{b.seed();const before=b.db.prepare('SELECT * FROM homework_submission_meta').get();const r=await b.draft.POST(b.req({draftSeq:100,...bad}));const after=b.db.prepare('SELECT * FROM homework_submission_meta').get();const good=await b.draft.POST(b.req({draftSeq:1,feedbackHtml:'GOOD'}));
        const o={badHttp:r.status,goodHttp:good.status,before,after,stored:b.row().feedbackHtml};expect(r.status===400&&JSON.stringify(before)===JSON.stringify(after)&&good.status===200,o,'Rejected input changed persisted sequence');return o;}finally{b.db.close();}
    });
  for(const field of ['feedbackHtml','decision','teacherOverrideScore','criteriaGrades']) await check('R23-13-equal-sequence-'+field,'Equal sequences are rejected on every same field across route/repository reload',async()=>{
    const b=backend();try{b.seed();const first=field==='feedbackHtml'?{feedbackHtml:'NEW'}:field==='decision'?{decision:'REDO'}:field==='teacherOverrideScore'?{teacherOverrideScore:90}:{criteriaGrades:safeGrades(90),rubric};
      const old=field==='feedbackHtml'?{feedbackHtml:'OLD'}:field==='decision'?{decision:'GRADE'}:field==='teacherOverrideScore'?{teacherOverrideScore:60}:{criteriaGrades:safeGrades(60),rubric};
      const firstRes=await b.draft.POST(b.req({draftSeq:1,...first}));const repo=reloadRepo(b);const route=mod('src/app/api/homework-grader/submissions/route.ts',['POST'],{...routeBindings(b),...repo}).POST;
      const before=JSON.stringify(b.row()),r=await route(b.req({draftSeq:1,...old}));const meta=b.db.prepare('SELECT * FROM homework_submission_meta').get();const o={field,firstHttp:firstRes.status,secondHttp:r.status,unchanged:before===JSON.stringify(b.row()),meta};
      expect(firstRes.status===200&&r.status===409&&o.unchanged&&JSON.parse(meta.fieldSeqJson)[field]===1,o,'Equal sequence overwrote a committed field');return o;}finally{b.db.close();}
  });
  await check('R23-13-distinct-fields-reversed','Different fields retain their values when sequence 2 arrives before sequence 1',async()=>{
    const b=backend();try{b.seed();const newer=await b.draft.POST(b.req({draftSeq:2,teacherOverrideScore:25}));const older=await b.draft.POST(b.req({draftSeq:1,feedbackHtml:'LATE FEEDBACK'}));
      const row=b.row(),meta=b.db.prepare('SELECT * FROM homework_submission_meta').get();const o={newer:newer.status,older:older.status,feedback:row.feedbackHtml,override:row.teacherOverrideScore,meta};
      expect(newer.status===200&&older.status===200&&o.feedback==='LATE FEEDBACK'&&o.override===25&&meta.draftSeq===2&&JSON.parse(meta.fieldSeqJson).feedbackHtml===1,o,'Independent fields lost a valid update');return o;}finally{b.db.close();}
  });
  await check('R23-13-real-get-ui-reload','Actual GET returns persisted draftSeq and the reloaded UI increments it',async()=>{
    const b=backend();try{b.seed();await b.draft.POST(b.req({draftSeq:7,feedbackHtml:'SEVEN'}));const fresh=mod('src/app/api/homework-grader/submissions/route.ts',['POST','GET'],{...routeBindings(b),...reloadRepo(b)});const events=[];
      const h=ui(async(url,opts)=>{if(opts?.method==='POST'){const body=JSON.parse(opts.body);events.push(body);return fresh.POST(b.req(body));}return fresh.GET(new Request('http://127.0.0.1:3000'+url,{headers:{host:'127.0.0.1:3000'}}));},{initialRubrics:[rubric]});
      await h.flush();const loaded=h.api.submissions[0]?.draftSeq;const saved=await h.api.handleFieldUpdate(h.api.submissions[0],{feedbackHtml:'EIGHT'});await h.flush();
      const o={loadedSeq:loaded,sentSeq:events[0]?.draftSeq,saved,stored:b.row().feedbackHtml,storedSeq:b.row()._draftSeq};expect(loaded===7&&o.sentSeq===8&&saved&&o.stored==='EIGHT'&&o.storedSeq===8,o,'Page reload did not synchronize persisted sequence');return o;
    }finally{b.db.close();}
  });
  await check('R23-13-failed-write-metadata','A failed SQLite row write must not commit sequence or reviewed-file metadata',async()=>{
    const b=backend();try{
      b.seed();const before=b.db.prepare('SELECT * FROM homework_submission_meta').get();const originalLimit=b.db.pragma('max_page_count',{simple:true});
      const pages=b.db.pragma('page_count',{simple:true});b.db.pragma('max_page_count = '+pages);
      const failed=await b.draft.POST(b.req({draftSeq:100,feedbackHtml:'X'.repeat(1024*1024)}));
      b.db.pragma('max_page_count = '+originalLimit);
      const after=b.db.prepare('SELECT * FROM homework_submission_meta').get(),body=await failed.json();
      const next=await b.draft.POST(b.req({draftSeq:1,feedbackHtml:'RECOVERED'}));
      const o={failedHttp:failed.status,failure:body.error,before,after,nextHttp:next.status,stored:b.row().feedbackHtml};
      expect(failed.status===500&&JSON.stringify(before)===JSON.stringify(after)&&next.status===200&&o.stored==='RECOVERED',o,'Failed row write committed metadata and poisoned the next valid draft');return o;
    }finally{b.db.close();}
  });
  await check('R23-COMPAT-R16-schema','Eight tables include all seven historical tables plus durable homework metadata',()=>{
    const b=backend();try{const tables=b.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(x=>x.name).sort();
      const expected=['classes_sessions','students','session_feedbacks','homework_submissions','spck_uploads','job_logs','score_matrix_cache','homework_submission_meta'].sort();
      const o={tables,columns:b.db.prepare('PRAGMA table_info(homework_submission_meta)').all().map(x=>x.name)};
      b.studentRepo.upsert({classId:'OTHER',studentId:'S1',fullName:'OTHER SYNTHETIC',isActive:1});
      assert.equal(b.studentRepo.findOne('S1',cid).fullName,'Học Viên Mẫu');
      b.seed(); assert.throws(()=>b.homeworkSubmissionRepo.upsert({...b.row(),studentId:'S_OTHER'}),/Integrity Violation/);
      o.scopedStudent=true; o.immutableOwner=true;
      expect(JSON.stringify(tables)===JSON.stringify(expected)&&['submissionId','gradedFileHash','draftSeq','fieldSeqJson'].every(k=>o.columns.includes(k)),o,'New schema does not preserve old tables plus metadata');return o;}finally{b.db.close();}
  });
  // R24 additions. This fragment is inserted inside the inherited try block.
  // Product code is never rewritten. Reuse of the R23 helpers/cases is explicit.
  const r24Passes = [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]];
  function r24Adam7(w,h,depth=8,color=2) {
    const channels=color===2?3:1, pieces=[], starts=[];
    let offset=0;
    for(const [x,y,dx,dy] of r24Passes) {
      const cols=w>x?Math.ceil((w-x)/dx):0, rows=h>y?Math.ceil((h-y)/dy):0;
      starts.push(cols&&rows?offset:null);
      if(cols&&rows) { const size=1+Math.ceil(cols*channels*depth/8); pieces.push(Buffer.alloc(size*rows)); offset+=size*rows; }
    }
    const raw=Buffer.concat(pieces);
    const encode=data=>{const hdr=Buffer.alloc(13);hdr.writeUInt32BE(w);hdr.writeUInt32BE(h,4);hdr[8]=depth;hdr[9]=color;hdr[12]=1;
      return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',hdr),pngChunk('IDAT',zlib.deflateSync(data)),pngChunk('IEND',Buffer.alloc(0))]);};
    return {raw,starts,encode};
  }
  for(const [w,h,depth,color] of [[8,8,8,2],[17,11,8,2],[1,9,8,2],[9,1,8,2],[9,9,1,0],[9,9,4,0],[9,9,16,0]])
    await check(`R24-01-adam7-valid-${w}x${h}-${depth}-${color}`,'Valid Adam7 images with all passes, empty passes and packed pixels remain supported',async()=>{
      const f=r24Adam7(w,h,depth,color),buf=f.encode(f.raw); await sharp(buf).raw().toBuffer();
      const p=parse(buf,'adam7.png');assert.equal(p.parseStatus,'PARSED');assert.equal(p.inlineDataParts[0].inlineData.data,buf.toString('base64'));
      return {w,h,depth,color,passStarts:f.starts,inflatedBytes:f.raw.length};
    });
  for(let pass=0;pass<7;pass++) for(const mode of ['bad-filter','truncated'])
    await check(`R24-01-adam7-pass${pass+1}-${mode}`,'Each of the seven actual Adam7 passes validates filters and byte length',async()=>{
      const f=r24Adam7(8,8);let raw=Buffer.from(f.raw);
      if(mode==='bad-filter')raw[f.starts[pass]]=5;else raw=raw.subarray(0,f.starts[pass]+1);
      return invalidImage('png',f.encode(raw));
    });
  await check('R24-01-adam7-extra-bytes','Trailing inflated bytes beyond the seven passes are rejected',()=>{
    const f=r24Adam7(8,8),p=parse(f.encode(Buffer.concat([f.raw,Buffer.from([0])])),'extra.png');assert.equal(p.parseStatus,'PARSE_ERROR');
  });
  const r24Vp8=Buffer.from([0x70,0,0,0x9d,1,0x2a,1,0,1,0,0,0,0,0]);
  const r24Vp8l=Buffer.from([0x2f,0,0,0,0,0,1,2,3,4,5]);
  for(const [kind,payload] of [['VP8 ',r24Vp8],['VP8L',r24Vp8l]]) for(const extended of [false,true])
    await check(`R24-01-webp-${kind.trim()}-${extended?'extended':'plain'}-plausible-garbage`,'Plausible VP8/VP8L headers plus nonempty corrupt image data must not become PARSED',()=>{
      const chunks=extended?[webpChunk('VP8X',Buffer.alloc(10)),webpChunk(kind,payload)]:[webpChunk(kind,payload)];
      return invalidImage('webp',riff(...chunks));
    });
  for(const lossless of [false,true]) await check(`R24-01-webp-valid17-${lossless}`,'Larger valid WebP with alpha is preserved',async()=>{
    const buf=await sharp({create:{width:17,height:11,channels:4,background:{r:30,g:100,b:220,alpha:.4}}}).webp({lossless}).toBuffer();
    await sharp(buf).raw().toBuffer();const p=parse(buf,'valid.webp');assert.equal(p.parseStatus,'PARSED');assert.equal(p.inlineDataParts[0].inlineData.data,buf.toString('base64'));
  });
  const r24Pdf=(objects,rootRef='1 0 R')=>Buffer.from('%PDF-1.4\n'+objects.map((b,i)=>`${i+1} 0 obj\n${b}\nendobj\n`).join('')+`trailer\n<< /Root ${rootRef} >>\n%%EOF\n`);
  const r24Tree=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R >>'];
  for(const [name,objects,rootRef] of [
    ['trailer-missing-root',r24Tree,'999 0 R'],
    ['missing-generation',[r24Tree[0].replace('2 0 R','2 1 R'),...r24Tree.slice(1)],'1 0 R'],
    ['reachable-page-plus-cycle',[r24Tree[0],'<< /Type /Pages /Kids [3 0 R 2 0 R] /Count 1 >>',r24Tree[2]],'1 0 R'],
    ['reachable-page-plus-missing-kid',[r24Tree[0],'<< /Type /Pages /Kids [3 0 R 99 0 R] /Count 2 >>',r24Tree[2]],'1 0 R'],
    ['wrong-parent',[...r24Tree.slice(0,2),'<< /Type /Page /Parent 99 0 R >>'],'1 0 R']
  ]) await check('R24-01-pdf-'+name,'PDF uses the actual catalog root and resolves every page reference including its generation',()=>{
    const buf=r24Pdf(objects,rootRef),p=parse(buf,'bad-tree.pdf'),o={fixture:buf.toString(),parseStatus:p.parseStatus,inlineParts:p.inlineDataParts.length};
    expect(p.parseStatus==='PARSE_ERROR'&&p.inlineDataParts.length===0,o,'Invalid PDF reference graph accepted');return o;
  });
  await check('R24-01-pdf-valid-nested-tree','A valid nested Pages tree remains supported',()=>{
    const buf=r24Pdf([r24Tree[0],'<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Pages /Parent 2 0 R /Kids [4 0 R] /Count 1 >>','<< /Type /Page /Parent 3 0 R >>']);
    assert.equal(parse(buf,'nested.pdf').parseStatus,'PARSED');
  });

  const r24Malformed={fileHash:12,feedbackHtml:[],decision:'INVALID',teacherOverrideScore:'0',criteriaGrades:{}};
  const r24Changed={fileHash:'different-version',feedbackHtml:'OTHER FEEDBACK',decision:'REDO',teacherOverrideScore:25,criteriaGrades:grades(90)};
  for(const mode of ['single','bulk']) for(const field of ['fileHash','feedbackHtml','decision','teacherOverrideScore','criteriaGrades'])
    for(const kind of ['missing','wrong-type','different']) await check(`R24-06-${mode}-${kind}-${field}`,'Every reviewed snapshot field is mandatory, typed and matched in both approval modes',async()=>{
      const b=backend();try{b.seed();const reviewed=view(b);
        if(kind==='missing')delete reviewed[field];else reviewed[field]=(kind==='wrong-type'?r24Malformed:r24Changed)[field];
        const body=mode==='bulk'?{approveAll:true,rubric,reviewedSubmissions:[reviewed]}:{...reviewed,rubric};
        const r=await b.approve(approvalRequest(b,body)),j=await r.json();
        const o={mode,field,kind,http:r.status,status:b.row().status,approved:j.data?.approvedCount??null,error:j.error??j.data?.skippedIds};
        expect(o.status!=='APPROVED'&&o.status!=='VERIFIED'&&(mode==='single'?r.status>=400:o.approved===0),o,'Incomplete or mismatched reviewed snapshot approved');return o;
      }finally{b.db.close();}
    });
  for(const mode of ['single','bulk']) for(const decision of ['GRADE','REDO']) for(const override of [null,0,100])
    await check(`R24-06-${mode}-valid-${decision}-${override}`,'Complete reviewed snapshots including null and zero override remain approvable',async()=>{
      const b=backend();try{b.seed({decision,teacherOverrideScore:override});const body=mode==='single'?{...view(b),rubric}:{approveAll:true,rubric,reviewedSubmissions:[view(b)]};
        const r=await b.approve(approvalRequest(b,body));assert.equal(r.status,200);assert.equal(b.row().status,'APPROVED');assert(b.verifyHomeworkContentIntegrity(b.row()));return {mode,decision,override,http:r.status};
      }finally{b.db.close();}
    });

  // Preserve each original R20 assertion. Only the new request supplies the full R24 reviewed contract.
  for(const originalId of ['API-approval-control','R20-03-legacy-reapproval','R20-05-override-control','R20-06-latest-control'])
    await check('R24-COMPAT-R20-'+originalId,'Old R20 request remains rejected; a complete current reviewed snapshot satisfies the original safety assertion',async()=>{
      const b=backend();try{
        if(originalId==='R20-03-legacy-reapproval'){
          b.homeworkSubmissionRepo.upsert(record({status:'APPROVED',contentHash:sha(record().feedbackHtml)}));assert.equal(b.row().status,'WAITING_APPROVAL');assert.equal(b.row().contentHash,'');
        }else b.seed();
        let oldBody={};
        if(originalId==='R20-05-override-control'){assert.equal((await b.draft.POST(b.req({teacherOverrideScore:90}))).status,200);oldBody={teacherOverrideScore:90};}
        if(originalId==='R20-06-latest-control'){assert.equal((await b.draft.POST(b.req({feedbackHtml:'LATEST'}))).status,200);oldBody={feedbackHtml:'LATEST',criteriaGrades:JSON.parse(b.row().criteriaGradesJson)};}
        const old=await b.approve(b.req(oldBody));assert.equal(old.status,409);assert.notEqual(b.row().status,'APPROVED');
        const r=await b.approve(b.req({...view(b),rubric}));assert.equal(r.status,200);assert.equal(b.row().status,'APPROVED');assert(b.verifyHomeworkContentIntegrity(b.row()));
        assert.equal(b.row().contentHash,b.computeHomeworkContentHash(b.row()));
        if(originalId==='R20-05-override-control')assert.equal(b.row().teacherOverrideScore,90);
        if(originalId==='R20-06-latest-control')assert.equal(b.row().feedbackHtml,'LATEST');
        return {originalId,originalRequestHttp:old.status,completeRequestHttp:r.status,contentHash:b.row().contentHash,status:b.row().status};
      }finally{b.db.close();}
    });

  const r24Input=()=>({...fullMutation().variables});
  const r24Bound=(patch={})=>({operationName:'SaveHomeworkGrade',query:'mutation SaveHomeworkGrade($input: GradeInput!) { saved: saveHomeworkGrade(input: $input) { id } }',variables:{input:r24Input()},...patch});
  const r24Result={data:{saved:{id:'SUB1',studentId:'S1',classId:cid,sessionId:sid,score:80}}};
  await check('R24-09-valid-bound-input','A genuine variable binding with no unused decoy variables is accepted',async()=>{
    const r=await strictWorker({apiBody:r24Bound(),responseBody:r24Result});expect(r.verified===1,r,'Valid bound input rejected');return {verified:r.verified,status:r.status};
  });
  for(const [name,value] of [['zero',0],['number',1],['string','ok'],['empty-string',''],['array',[]],['empty-object',{}],['explicit-failure',{success:false}],
    ['numeric-id',{id:123}],['empty-id',{id:''}],['wrong-score-type',{id:'SUB1',score:'90'}],['wrong-score',{id:'SUB1',score:90}],
    ['wrong-decision',{id:'SUB1',decision:'REDO'}],['wrong-feedback',{id:'SUB1',feedback:'OTHER FEEDBACK'}],['wrong-owner',{id:'SUB1',studentId:'S2'}]])
    await check('R24-09-result-'+name,'Selected result must prove success and cannot contradict the approved grade or identity',async()=>{
      const responseBody={data:{saved:value}},r=await strictWorker({apiBody:r24Bound(),responseBody}),o={responseBody,verified:r.verified,status:r.status,error:r.error};
      expect(r.verified===0,o,'Invalid or contradictory response result marked VERIFIED');return o;
    });
  for(const [name,data] of [['alias-original-field',{saveHomeworkGrade:true}],['other-grading-field',{updateOtherGrade:true}],['wrong-alias',{gradeResult:{id:'SUB1'}}]])
    await check('R24-09-response-field-'+name,'Response must contain the selected exact field or its chosen alias',async()=>{
      const r=await strictWorker({apiBody:r24Bound(),responseBody:{data}}),o={data,verified:r.verified,status:r.status,error:r.error};
      expect(r.verified===0,o,'Unselected grading-like result accepted instead of selected alias');return o;
    });
  const r24LiteralArgs=`classId: "${cid}", sessionId: "${sid}", submissionId: "SUB1", studentId: "S1", score: 80, decision: GRADE, feedback: "APPROVED FEEDBACK"`;
  const r24Queries=[
    ['unused-id-decoys',{query:'mutation SaveHomeworkGrade { saveHomeworkGrade(score: 80) { id } }',variables:r24Input()}],
    ['nested-bound-wrong-id',{query:'mutation SaveHomeworkGrade($wrapped: GradeInput!) { saveHomeworkGrade(input: $wrapped) { id } }',variables:{...r24Input(),wrapped:{payload:{...r24Input(),submissionId:'SUB_OTHER'}}}}],
    ['nested-bound-wrong-score',{query:'mutation SaveHomeworkGrade($wrapped: GradeInput!) { saveHomeworkGrade(input: $wrapped) { id } }',variables:{...r24Input(),wrapped:{payload:{...r24Input(),score:1}}}}],
    ['nested-bound-wrong-feedback',{query:'mutation SaveHomeworkGrade($wrapped: GradeInput!) { saveHomeworkGrade(input: $wrapped) { id } }',variables:{...r24Input(),wrapped:{payload:{...r24Input(),feedback:'OTHER FEEDBACK'}}}}]
  ];
  for(const [name,patch] of r24Queries) await check('R24-09-request-'+name,'Only values really passed to the selected mutation may prove its identity and content',async()=>{
    const request=fullMutation(patch),r=await strictWorker({apiBody:request,responseBody:{data:{saveHomeworkGrade:{id:'SUB1'}}}}),o={request,verified:r.verified,status:r.status,error:r.error};
    expect(r.verified===0,o,'Unused variables or shallow nested validation bypassed actual argument checks');return o;
  });
  for(const [name,args,variables] of [
    ['all-literals',r24LiteralArgs,{}],
    ['renamed-bound-variables','classId: $c, sessionId: $s, submissionId: $sub, studentId: $stu, score: $n, decision: $d, feedback: $f',{c:cid,s:sid,sub:'SUB1',stu:'S1',n:80,d:'GRADE',f:'APPROVED FEEDBACK'}]
  ]) await check('R24-09-valid-'+name,'Complete correct literal/renamed variable arguments work without unused identity variables',async()=>{
    const request={operationName:'SaveHomeworkGrade',query:`mutation SaveHomeworkGrade${name==='all-literals'?'':'($c: ID!, $s: ID!, $sub: ID!, $stu: ID!, $n: Int!, $d: String!, $f: String!)'} { saveHomeworkGrade(${args}) { id } }`,variables};
    const r=await strictWorker({apiBody:request,responseBody:{data:{saveHomeworkGrade:{id:'SUB1'}}}}),o={request,verified:r.verified,status:r.status,error:r.error};
    expect(r.verified===1,o,'Correct transmitted arguments required unrelated variable names to pass');return o;
  });
  for(const [field,value] of [['submissionId','SUB_OTHER'],['studentId','S2'],['classId','WRONG'],['sessionId','WRONG'],['score',1],['decision','REDO'],['feedback','OTHER FEEDBACK']])
    await check('R24-09-bound-input-mismatch-'+field,'Every direct field in a bound input is checked',async()=>{
      const request=r24Bound({variables:{input:{...r24Input(),[field]:value}}}),r=await strictWorker({apiBody:request,responseBody:r24Result});
      expect(r.verified===0,r,'Wrong bound input accepted');return {field,verified:r.verified,status:r.status};
    });

  for(const table of ['homework_submissions','homework_submission_meta']) await check('R24-13-rollback-'+table,'A real SQLite error in either write rolls back both tables and permits the next valid sequence',async()=>{
    const b=backend();try{b.seed();const rowBefore=JSON.stringify(b.row()),metaBefore=b.db.prepare('SELECT * FROM homework_submission_meta').get();
      b.db.exec(`CREATE TRIGGER audit_fail BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'AUDIT_FORCED_WRITE_FAILURE'); END;`);
      const failed=await b.draft.POST(b.req({draftSeq:100,feedbackHtml:'MUST ROLL BACK'})),body=await failed.json();
      const unchanged=rowBefore===JSON.stringify(b.row()),metaAfter=b.db.prepare('SELECT * FROM homework_submission_meta').get();
      b.db.exec('DROP TRIGGER audit_fail');const next=await b.draft.POST(b.req({draftSeq:1,feedbackHtml:'RECOVERED'}));
      const o={table,http:failed.status,error:body.error,rowUnchanged:unchanged,metaBefore,metaAfter,nextHttp:next.status,stored:b.row().feedbackHtml};
      expect(failed.status===500&&unchanged&&JSON.stringify(metaBefore)===JSON.stringify(metaAfter)&&next.status===200&&o.stored==='RECOVERED',o,'SQLite write left a partial commit');return o;
    }finally{b.db.close();}
  });
  await check('R24-13-new-row-meta-failure','Failed metadata insert cannot leave an orphan new submission',()=>{
    const b=backend();try{b.db.exec("CREATE TRIGGER audit_fail BEFORE INSERT ON homework_submission_meta BEGIN SELECT RAISE(ABORT,'AUDIT_META_FAILURE'); END;");
      assert.throws(()=>b.seed(),/AUDIT_META_FAILURE/);const rows=b.db.prepare('SELECT count(*) AS n FROM homework_submissions').get().n,meta=b.db.prepare('SELECT count(*) AS n FROM homework_submission_meta').get().n;
      assert.equal(rows,0);assert.equal(meta,0);b.db.exec('DROP TRIGGER audit_fail');b.seed();assert(b.row());return {rowsAfterFailure:rows,metaAfterFailure:meta,recovered:!!b.row()};
    }finally{b.db.close();}
  });

  // R25 independent boundaries. Inherited R24 assertions above remain unchanged.
  for(const c of await createMediaCases())await check(c.id,'Independent decoder/explicit PDF reference graph agrees with product parser',async()=>{
    let decoderError='';if(c.decode)try{await sharp(c.buf).raw().toBuffer();}catch(e){decoderError=e.message;}
    const p=parse(c.buf,c.id+'.'+c.ext),decoderMatches=!c.decode||(c.expected==='PARSED'?!decoderError:!!decoderError);
    const bytesMatch=c.expected==='PARSED'?p.inlineDataParts.length===1&&p.inlineDataParts[0].inlineData.data===c.buf.toString('base64'):p.inlineDataParts.length===0;
    const o={expected:c.expected,parseStatus:p.parseStatus,inlineParts:p.inlineDataParts.length,decoderError,decoderMatches,fixtureBase64:c.buf.toString('base64')};
    expect(p.parseStatus===c.expected&&decoderMatches&&bytesMatch,o,'Product parser disagrees with valid/invalid media oracle');return o;
  });
  const r25Input=()=>({...fullMutation().variables});
  const r25Req=(input=r25Input(),patch={})=>({operationName:'SaveHomeworkGrade',query:'mutation SaveHomeworkGrade($input: GradeInput!) { saved: saveHomeworkGrade(input: $input) { id } }',variables:{input},...patch});
  const r25Run=(request,response,patch={})=>strictWorker({apiBody:request,responseBody:{data:{saved:response}},...patch});
  for(const response of [true,{id:'SUB1'},{success:true},{submissionId:'SUB1',studentId:'S1',classId:cid,sessionId:sid,score:80,decision:'GRADE',feedback:'APPROVED FEEDBACK'}])
    await check('R25-09-valid-result-'+(typeof response==='boolean'?'true':Object.keys(response).join('-')),'Selected boolean true or a nonempty matching object remains supported',async()=>{
      const r=await r25Run(r25Req(),response);expect(r.verified===1,r,'Valid selected result rejected');return {response,verified:r.verified};
    });
  for(const field of ['id','submissionId','studentId','classId','sessionId','score','decision','status','feedback'])for(const [kind,value]of [['null',null],['number',17],['empty',''],['array',[]],['object',{}]])
    await check(`R25-09-response-type-${field}-${kind}`,'Every present business field must have the required type and approved value',async()=>{
      const response={id:'SUB1',[field]:value},r=await r25Run(r25Req(),response),o={response,verified:r.verified,status:r.status,error:r.error};
      expect(r.verified===0,o,'Invalid present business field ignored/coerced');return o;
    });
  for(const [name,response]of [
    ['two-submission-ids',{submissionId:'SUB1',id:'OTHER'}],['two-student-ids',{studentId:'S1',studentUid:'OTHER'}],
    ['two-class-ids',{classId:cid,classCode:'OTHER'}],['two-decisions',{decision:'GRADE',status:'REDO'}],
    ['two-feedbacks',{feedback:'APPROVED FEEDBACK',feedbackHtml:'OTHER'}],
    ['null-primary-id',{submissionId:null,id:'SUB1'}],['null-primary-student',{studentId:null,studentUid:'S1'}],
    ['null-primary-class',{classId:null,classCode:cid}],['null-primary-decision',{decision:null,status:'GRADE'}],
    ['null-primary-feedback',{feedback:null,comment:'APPROVED FEEDBACK'}],
    ['array-grade-decision',{decision:['GRADE']}],['array-grade-status',{status:['GRADE']}]
  ])await check('R25-09-response-conflict-'+name,'Checking one synonym must not conceal another contradictory or malformed present field',async()=>{
    const r=await r25Run(r25Req(),response),o={response,verified:r.verified,status:r.status,error:r.error};expect(r.verified===0,o,'Conflicting/malformed result marked VERIFIED');return o;
  });
  for(const [name,request,response,expected]of [
    ['unreferenced-garbage',r25Req(r25Input(),{variables:{input:r25Input(),studentId:'OTHER',submissionId:'OTHER',score:1,feedback:'OTHER'}}),{data:{saved:true}},1],
    ['deep-valid',r25Req({level1:{level2:r25Input()}}),{data:{saved:true}},1],
    ['deep-wrong',r25Req({level1:{level2:{...r25Input(),submissionId:'OTHER'}}}),{data:{saved:true}},0],
    ['only-unused-proof',{...fullMutation(),query:'mutation SaveHomeworkGrade { saved: saveHomeworkGrade(score: 80) { id } }'},{data:{saved:true}},0],
    ['exact-field-no-alias',{...r25Req(),query:'mutation SaveHomeworkGrade($input: GradeInput!) { saveHomeworkGrade(input:$input) { id } }'},{data:{saveGrade:true}},0],
    ['exact-field-no-args',fullMutation(),{data:{saveGrade:true}},0],
    ['nonreferenced-object-not-proof',r25Req({score:80},{variables:{input:{score:80},decoy:r25Input()}}),{data:{saved:true}},0],
    ['bound-array',r25Req([r25Input()]),{data:{saved:true}},0],
    ['object-score',r25Req({...r25Input(),score:{value:1},nested:{score:80}}),{data:{saved:true}},0],
    ['object-identity',r25Req({...r25Input(),submissionId:{value:'OTHER'},id:'SUB1'}),{data:{saved:true}},0]
  ])await check('R25-09-request-'+name,'Only actual selected argument bindings count, and each recognized field keeps its own type',async()=>{
    const r=await strictWorker({apiBody:request,responseBody:response}),o={request,response,expected,verified:r.verified,status:r.status,error:r.error};
    expect(r.verified===expected,o,'Selected GraphQL argument/result contract violated');return o;
  });
  const r25Literal=`classId:"${cid}", sessionId:"${sid}", submissionId:"SUB1", studentId:"S1", score:80, decision:GRADE, feedback:"APPROVED FEEDBACK"`;
  for(const [name,args,variables]of [
    ['literal-with-decoys',r25Literal,{submissionId:'OTHER',studentId:'OTHER',score:1,feedback:'OTHER'}],
    ['renamed-mixed',`classId:$c,sessionId:"${sid}",submissionId:$sub,studentId:"S1",score:$n,decision:GRADE,feedback:$f`,{c:cid,sub:'SUB1',n:80,f:'APPROVED FEEDBACK'}]
  ])await check('R25-09-valid-'+name,'Literal and renamed variable arguments do not depend on unreferenced variables',async()=>{
    const request={operationName:'SaveHomeworkGrade',query:`mutation SaveHomeworkGrade${name==='renamed-mixed'?'($c:ID!,$sub:ID!,$n:Int!,$f:String!)':''} { saved: saveHomeworkGrade(${args}) { id } }`,variables};
    const r=await r25Run(request,true);expect(r.verified===1,r,'Correct selected arguments rejected');return {request,verified:r.verified};
  });
  for(const [name,response]of [['valid',{id:'SUB1',decision:'REDO',feedback:'APPROVED FEEDBACK'}],['wrong-decision',{id:'SUB1',decision:'GRADE'}],['array-decision',{id:'SUB1',decision:['REDO']}],['null-id',{submissionId:null,id:'SUB1'}]])
    await check('R25-09-redo-'+name,'REDO checks preserve strict response types and the approved decision',async()=>{
      const request=r25Req({...r25Input(),decision:'REDO'}),r=await r25Run(request,response,{seed:{decision:'REDO'}}),o={request,response,verified:r.verified,status:r.status,error:r.error};
      expect(r.verified===(name==='valid'?1:0),o,'REDO response contract violated');return o;
    });

  // One fresh focused control per other R19 group; broader regressions run unchanged separately.
  await check('R25-02-rubric-total-and-duplicate','Total comes from criterion points and duplicated criterion IDs fail',()=>{
    const good=auditor.auditCriterionGrades(grades(73.25),rubric),bad=auditor.auditCriterionGrades([...grades(),...grades()],rubric);
    assert.equal(good.calculatedScore,73.25);assert.equal(good.valid,true);assert.equal(bad.valid,false);return {total:good.calculatedScore,duplicateRejected:!bad.valid};
  });
  await check('R25-03-approved-feedback-tamper','A stale approval hash prevents a changed grade from reaching Save',async()=>{
    const r=await strictWorker({seed:{feedbackHtml:'<p>APPROVED FEEDBACK</p>'},beforeClick:b=>{b.homeworkSubmissionRepo.upsert({...b.row(),feedbackHtml:'CHANGED'});}});
    expect(r.verified===0&&r.writes===0,r,'Changed approved content reached Save');return {writes:r.writes,verified:r.verified,status:r.status};
  });
  await check('R25-04-disk-mismatch-supplied-parse','Supplied parsed data cannot hide a different physical submission',async()=>{
    const b=backend();try{const p=path.join(work,'r25-physical.py');fs.writeFileSync(p,'print(2)');b.seed({localFilePath:p,fileHash:sha('print(1)')});const before=JSON.stringify(b.row());
      const g=loadGrader(b,async()=>aiResponse()),r=await g.HomeworkAiGrader.gradeSingleSubmission(candidate({localFilePath:p,parsedContent:parse('print(1)','r25-physical.py')}),rubric);
      const o={staleIgnored:r.staleIgnored,unchanged:before===JSON.stringify(b.row())};expect(r.staleIgnored===true&&o.unchanged,o,'Physical mismatch was graded');return o;
    }finally{b.db.close();}
  });
  await check('R25-05-ui-unreadable-approval','Actual UI handler cannot approve a PARSE_ERROR record',async()=>{
    const b=backend();try{b.seed({parseStatus:'PARSE_ERROR'});const events=[],h=wiredUi(b,events);await h.flush();await h.api.handleApproveSubmission(h.api.submissions[0]);await h.flush();
      assert.notEqual(b.row().status,'APPROVED');return {status:b.row().status,requests:events};
    }finally{b.db.close();}
  });
  await check('R25-06-old-view-after-new-draft','A fully populated but outdated teacher review is rejected',async()=>{
    const b=backend();try{b.seed();const reviewed=view(b);assert.equal((await b.draft.POST(b.req({draftSeq:10,feedbackHtml:'NEW DRAFT'}))).status,200);const r=await b.approve(b.req({...reviewed,rubric}));
      assert.equal(r.status,409);assert.notEqual(b.row().status,'APPROVED');return {http:r.status,status:b.row().status};
    }finally{b.db.close();}
  });
  await check('R25-07-modal-wrong-submission','Matching student name/ID cannot override a wrong submission ID in modal',async()=>{
    const r=await strictWorker({modalText:'Học Viên Mẫu S1 SUB_OTHER'});expect(r.verified===0&&r.writes===0,r,'Wrong submission modal reached Save');return {writes:r.writes,verified:r.verified};
  });
  await check('R25-08-foreign-lesson','A lesson mapped to another session must stop before saving',async()=>{
    await assert.rejects(()=>strictWorker({options:{lessonId:'L2'},columns:[{columnId:'L2',lessonId:'L2',sessionNumber:2,colIndex:1}]}),/buổi|session|khớp/i);return {rejected:true};
  });
  await check('R25-10-wrong-readback-decision','HTTP success and correct score do not compensate for wrong persisted decision',async()=>{
    const r=await strictWorker({readbackDecision:'REDO'});expect(r.verified===0,r,'Wrong readback decision accepted');return {verified:r.verified,status:r.status};
  });
  await check('R25-11-drift-during-readback','Changing the approved grade during readback prevents VERIFIED',async()=>{
    const r=await strictWorker({duringReadback:b=>b.homeworkSubmissionRepo.upsert({...b.row(),teacherOverrideScore:21})});expect(r.verified===0,r,'Readback drift accepted');return {verified:r.verified,status:r.status};
  });
  await check('R25-12-old-class-response','An old class response cannot populate a newly selected class',async()=>{
    const hold=defer(),next='R25_NEW_CLASS';const h=ui(async url=>{if(url.includes(cid)){await hold.promise;return Response.json({success:true,data:{submissions:[uiItem(record())]}});}return Response.json({success:true,data:{submissions:[uiItem(record({classId:next,sessionId:next+'_SESS_01',submissionId:'NEW_SUB'}))]}});});
    await h.flush();h.setProps({classId:next,classCode:next});await h.flush();hold.resolve();await h.flush();assert.equal(h.api.submissions[0]?.classId,next);assert.equal(h.api.isLoadingSubs,false);return {visibleClass:h.api.submissions[0]?.classId};
  });
  await check('R25-13-rejected-multi-field-atomic','An invalid combined edit does not commit a valid companion field or consume its sequence',async()=>{
    const b=backend();try{b.seed();const before=JSON.stringify(b.row()),meta=JSON.stringify(b.db.prepare('SELECT * FROM homework_submission_meta').get());
      const bad=await b.draft.POST(b.req({draftSeq:50,feedbackHtml:'MUST NOT SAVE',criteriaGrades:safeGrades(101),rubric}));
      assert.equal(bad.status,400);assert.equal(JSON.stringify(b.row()),before);assert.equal(JSON.stringify(b.db.prepare('SELECT * FROM homework_submission_meta').get()),meta);
      const good=await b.draft.POST(b.req({draftSeq:1,feedbackHtml:'VALID'}));assert.equal(good.status,200);return {rejectedHttp:bad.status,recoveryHttp:good.status};
    }finally{b.db.close();}
  });
  await check('R25-14-partial-download-stops-ai','A partial failed download never sends old cached submissions to AI',async()=>{
    const b=backend();try{b.seed();let aiCalls=0;const download={success:false,downloadedCount:1,failedCount:1,items:[{success:true,submissionId:'SUB1'}]};
      const route=mod('src/app/api/homework-grader/download-and-grade/route.ts',['POST'],{...b,...local,NextResponse:Response,taskQueue:{enqueue:async t=>t.execute()},SubmissionDownloader:{downloadLessonSubmissions:async()=>download},HomeworkAiGrader:{gradeBatchSubmissions:async()=>{aiCalls++;return[];}},getGradingRubrics:()=>[rubric],findLessonInSyllabus:()=>null});
      const res=await route.POST(b.req({rubric}));assert.equal(res.status,502);assert.equal(aiCalls,0);return {http:res.status,aiCalls};
    }finally{b.db.close();}
  });

  // R26: independent media oracle, direct graph fixtures, and GraphQL string/type boundaries.
  for(const c of await createR26MediaCases())await check(c.id,'R26 media must match independent decoding or explicit direct PDF graph',async()=>{
    let decoderError='';if(c.decode)try{await sharp(c.buf).raw().toBuffer();}catch(e){decoderError=e.message;}
    const p=parse(c.buf,c.id+'.'+c.ext),o={expected:c.expected,parseStatus:p.parseStatus,inlineParts:p.inlineDataParts.length,decoderError,fixtureBase64:c.buf.toString('base64')};
    expect(!c.decode||(c.expected==='PARSED'?!decoderError:!!decoderError),o,'Invalid independent decoder expectation');
    expect(p.parseStatus===c.expected&&p.inlineDataParts.length===(c.expected==='PARSED'?1:0),o,'Media status differs from independent expectation');
    if(c.expected==='PARSED')assert.equal(p.inlineDataParts[0].inlineData.data,c.buf.toString('base64'));return o;
  });
  for(const c of createR26WorkerCases(cid,sid))await check(c.id,'Strict request/response binding with valid GraphQL strings and independent scalar checks',async()=>{
    const r=await strictWorker({apiBody:c.request,responseBody:c.response,seed:{feedbackHtml:c.feedback},readbackFeedback:c.feedback}),o={request:c.request,response:c.response,expected:c.expected,verified:r.verified,writes:r.writes,status:r.status,error:r.error};
    expect(r.verified===c.expected,o,'Worker verification differs from selected contract');return o;
  });
  await check('R26-02-missing-evidence-and-fractional-total','Reject missing evidence, retain independently calculated decimal score',()=>{
    const good=auditor.auditCriterionGrades(grades(79.37),rubric),bad=auditor.auditCriterionGrades(grades().map(g=>({...g,evidenceSnippet:''})),rubric);
    assert.equal(good.valid,true);assert.equal(good.calculatedScore,79.37);assert.equal(bad.valid,false);return {total:good.calculatedScore,emptyEvidenceRejected:!bad.valid};
  });
  await check('R26-03-decision-tamper-before-save','Approval cannot survive a changed decision before clicking Save',async()=>{
    const r=await strictWorker({beforeClick:b=>b.homeworkSubmissionRepo.upsert({...b.row(),decision:'REDO'})});expect(r.verified===0&&r.writes===0,r,'Unapproved decision reached Save');return {verified:r.verified,writes:r.writes};
  });
  await check('R26-04-outdated-ai-file-version','An AI response for a file version changed while awaiting AI must not overwrite it',async()=>{
    const b=backend();try{b.seed({fileHash:'old-version'});const hold=defer(),entered=defer();let calls=0;const g=loadGrader(b,async()=>{calls++;entered.resolve();await hold.promise;return aiResponse();});
      const pending=g.HomeworkAiGrader.gradeSingleSubmission(candidate(),rubric);await entered.promise;b.homeworkSubmissionRepo.upsert({...b.row(),fileHash:'new-version'});const before=JSON.stringify(b.row());hold.resolve();const r=await pending;
      expect(r.staleIgnored===true&&JSON.stringify(b.row())===before,{r,calls},'Old AI response overwrote the new file version');return {staleIgnored:r.staleIgnored,calls,unchanged:true};
    }finally{b.db.close();}
  });
  await check('R26-05-corrupt-file-cannot-be-approved','PARSE_ERROR cannot be approved through the actual API',async()=>{
    const b=backend();try{b.seed({parseStatus:'PARSE_ERROR'});const r=await b.approve(b.req({...view(b),rubric}));assert.notEqual(r.status,200);assert.notEqual(b.row().status,'APPROVED');return {http:r.status,status:b.row().status};}finally{b.db.close();}
  });
  await check('R26-06-stale-score-review','Teacher review cannot approve a newer score it did not show',async()=>{
    const b=backend();try{b.seed();const reviewed=view(b);assert.equal((await b.draft.POST(b.req({draftSeq:12,teacherOverrideScore:47}))).status,200);const r=await b.approve(b.req({...reviewed,rubric}));assert.equal(r.status,409);assert.notEqual(b.row().status,'APPROVED');return {http:r.status,override:b.row().teacherOverrideScore};}finally{b.db.close();}
  });
  await check('R26-07-substring-id-is-not-identity','S1/SUB1 must not match S10/SUB10 in a modal',async()=>{
    const r=await strictWorker({modalText:'Học Viên Mẫu S10 SUB10'});expect(r.verified===0&&r.writes===0,r,'Substring identity accepted');return {verified:r.verified,writes:r.writes};
  });
  await check('R26-08-foreign-session-before-browser','A session belonging to another class cannot enter the worker',async()=>{
    await assert.rejects(()=>strictWorker({options:{sessionId:'FOREIGN_SESS_01'}}),/buổi|session|lớp/i);return {rejected:true};
  });
  await check('R26-10-readback-unavailable','An unreadable persisted feedback prevents VERIFIED after HTTP success',async()=>{
    const r=await strictWorker({readbackError:true});expect(r.verified===0,r,'Unreadable feedback accepted');return {verified:r.verified,status:r.status};
  });
  await check('R26-13-db-write-failure-rolls-back','SQLite storage failure cannot partially change approved content or metadata',async()=>{
    const b=backend();try{b.seed();const row=JSON.stringify(b.row()),meta=JSON.stringify(b.db.prepare('SELECT * FROM homework_submission_meta').get());
      b.db.exec("CREATE TRIGGER r26_abort BEFORE INSERT ON homework_submission_meta BEGIN SELECT RAISE(ABORT,'R26_SYNTHETIC_FAILURE'); END;");
      const r=await b.draft.POST(b.req({draftSeq:999,teacherOverrideScore:12}));assert.equal(r.status,500);assert.equal(JSON.stringify(b.row()),row);assert.equal(JSON.stringify(b.db.prepare('SELECT * FROM homework_submission_meta').get()),meta);b.db.exec('DROP TRIGGER r26_abort');
      const good=await b.draft.POST(b.req({draftSeq:1,teacherOverrideScore:13}));assert.equal(good.status,200);return {failureHttp:r.status,recoveryHttp:good.status};
    }finally{b.db.close();}
  });
  await check('R26-11-mark-verified-update-aborts','A failed final conditional VERIFIED update must not be reported as verified',async()=>{
    const r=await strictWorker({beforeClick:b=>b.db.exec("CREATE TRIGGER r26_verify_abort BEFORE UPDATE ON homework_submissions WHEN NEW.status='VERIFIED' BEGIN SELECT RAISE(ABORT,'R26_VERIFY_FAILURE'); END;")});
    expect(r.verified===0&&r.status==='FAILED'&&r.writes===1,r,'Failed VERIFIED update was reported as verified');return {verified:r.verified,status:r.status,writes:r.writes,error:r.error};
  });
  await check('R26-12-session-switch-stale-response','A slow prior session response cannot replace newly selected session rows',async()=>{
    const hold=defer(),h=ui(async url=>{if(url.includes('_SESS_01')){await hold.promise;return Response.json({success:true,data:{submissions:[uiItem(record())]}});}return Response.json({success:true,data:{submissions:[uiItem(record({sessionId:cid+'_SESS_02',submissionId:'NEW_SESSION'}))]}});});
    await h.flush();h.api.setSelectedSessionNumber(2);await h.flush();hold.resolve();await h.flush();assert.equal(h.api.submissions[0]?.submissionId,'NEW_SESSION');return {visibleSubmission:h.api.submissions[0]?.submissionId};
  });
  await check('R26-13-sequence-survives-module-reload','Persisted sequence rejects an equal-sequence conflicting feedback after reload',async()=>{
    const b=backend();try{b.seed();assert.equal((await b.draft.POST(b.req({draftSeq:17,feedbackHtml:'SEVENTEEN'}))).status,200);const repo=reloadRepo(b),post=mod('src/app/api/homework-grader/submissions/route.ts',['POST'],{...routeBindings(b),...repo}).POST;
      const r=await post(b.req({draftSeq:17,feedbackHtml:'STALE'}));assert.equal(r.status,409);assert.equal(b.row().feedbackHtml,'SEVENTEEN');return {http:r.status,feedback:b.row().feedbackHtml};
    }finally{b.db.close();}
  });
  await check('R26-14-only-new-download-enters-ai','A successful download batch excludes older cached submission IDs from AI',async()=>{
    const b=backend();try{b.seed();b.homeworkSubmissionRepo.upsert(record({submissionId:'OLD_CACHED',studentId:'S1'}));let seen=[];
      const route=mod('src/app/api/homework-grader/download-and-grade/route.ts',['POST'],{...b,...local,NextResponse:Response,taskQueue:{enqueue:async t=>t.execute()},SubmissionDownloader:{downloadLessonSubmissions:async()=>({success:true,items:[{success:true,submissionId:'SUB1'}]})},HomeworkAiGrader:{gradeBatchSubmissions:async c=>{seen=c.map(x=>x.submissionId);return[];}},getGradingRubrics:()=>[rubric],findLessonInSyllabus:()=>null});
      const r=await route.POST(b.req({rubric}));assert.equal(r.status,200);assert.deepEqual(seen,['SUB1']);return {http:r.status,aiSubmissions:seen};
    }finally{b.db.close();}
  });
  // R20/21 returned saveGrade for a selected saveHomeworkGrade. Preserve their failures; prove current contract separately.
  for(const originalId of ['R20-10-complete-control','R21-08-mapping-valid','R21-10-readback-complete','R21-10-readback-redo-complete','R21-11-final-cas'])
    await check('R26-COMPAT-'+originalId,'Original behavioral control with the response field corrected to its selected mutation',async()=>{
      const redo=originalId.includes('redo-complete'),cas=originalId.includes('final-cas');
      const patch={apiBody:fullMutation(redo?{variables:{studentId:'S1',submissionId:'SUB1',decision:'REDO',feedback:'APPROVED FEEDBACK'}}:{}),responseBody:{data:{saveHomeworkGrade:true}}};
      if(redo)Object.assign(patch,{seed:{decision:'REDO'},readbackDecision:'REDO'});
      if(originalId.includes('mapping-valid'))Object.assign(patch,{options:{lessonId:'L1'},columns:[{columnId:'L1',lessonId:'L1',sessionNumber:1,colIndex:0},{columnId:'L2',lessonId:'L2',sessionNumber:2,colIndex:1}]});
      if(cas)patch.duringReadback=b=>b.homeworkSubmissionRepo.upsert({...b.row(),feedbackHtml:'NEW EDIT',status:'WAITING_APPROVAL',contentHash:''});
      const r=await strictWorker(patch);assert.equal(r.verified,cas?0:1);if(cas)assert.equal(r.status,'WAITING_APPROVAL');if(originalId==='R20-10-complete-control'){assert.equal(r.writes,1);assert.equal(r.modalReads,2);}
      return {originalId,correctedResponseField:'saveHomeworkGrade',verified:r.verified,status:r.status,modalReads:r.modalReads};
    });

  for(const c of await createR27MediaCases())await check(c.id,'R27 media matches full pixel decoding or explicit PDF object graph',async()=>{
    let decoderError='';if(c.decode)try{await sharp(c.buf).raw().toBuffer();}catch(e){decoderError=e.message;}
    const p=parse(c.buf,c.id+'.'+c.ext),o={expected:c.expected,parseStatus:p.parseStatus,inlineParts:p.inlineDataParts.length,decoderError,fixtureBase64:c.buf.toString('base64')};
    expect(!c.decode||(c.expected==='PARSED'?!decoderError:!!decoderError),o,'Independent decoder expectation mismatch');
    expect(p.parseStatus===c.expected&&p.inlineDataParts.length===(c.expected==='PARSED'?1:0),o,'Media differs from independent expectation');
    if(c.expected==='PARSED')assert.equal(p.inlineDataParts[0].inlineData.data,c.buf.toString('base64'));return o;
  });
  for(const c of createR27WorkerCases(cid,sid))await check(c.id,'Selected actual GraphQL arguments and valid string forms must govern verification',async()=>{
    const r=await strictWorker({apiBody:c.request,responseBody:c.response,seed:{feedbackHtml:c.feedback},readbackFeedback:c.feedback}),o={request:c.request,response:c.response,expected:c.expected,verified:r.verified,writes:r.writes,status:r.status,error:r.error};
    expect(r.verified===c.expected,o,'Worker differs from the selected contract');return o;
  });

} finally {
  process.chdir(previousCwd);
  assert.equal(new Set(results.map(r=>r.id)).size,results.length,'Duplicate audit IDs');
  const sourceFiles=['src/lib/file-parsers/media-reader.ts','src/lib/gemini/homework-grader.ts','src/lib/gemini/score-auditor.ts','src/lib/db/sqlite.ts','src/lib/playwright/download-submissions.ts','src/lib/playwright/grade-worker.ts','src/lib/playwright/network-interceptor.ts','src/app/api/homework-grader/submissions/route.ts','src/app/api/homework-grader/approve/route.ts','src/components/homework-auto-grader-tab.tsx'];
  const summary={round:27,inheritedR26Checks:510,harnessSha256:sha(fs.readFileSync(fileURLToPath(import.meta.url))),checkedAt:new Date().toISOString(),sourceRoot:root,fixtureWorkspace:work,sqlite:':memory:',realLmsCalls:0,realGeminiCalls:0,method:'Actual snapshot function bodies, imports/types removed only; deterministic UI/DOM/Gemini doubles, real in-memory SQLite and physical synthetic files; sharp independently decodes image fixtures. Module reload tests instantiate the same unmodified source against the same SQLite database. No live browser/React scheduling acceptance.',sourceHashes:Object.fromEntries(sourceFiles.map(f=>[f,sha(read(f))])),total:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
  fs.writeFileSync(path.join(out,'verify-results.json'),JSON.stringify(summary,null,2)+'\n');
  console.log('SUMMARY '+JSON.stringify({total:summary.total,passed:summary.passed,failed:summary.failed}));if(summary.failed)process.exitCode=1;
}
