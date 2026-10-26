// Round 22 harness adapted from Round 21/20: real source functions, synthetic inputs, in-memory SQLite.
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const out = path.join(root, 'docs/audits/round-22');
assert(path.resolve(process.cwd()) === root && root.includes('mindx-round22-') && root.startsWith(path.resolve(os.tmpdir())), 'Run this audit only from its isolated TEMP snapshot');
const previousCwd = process.cwd();
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mindx-r22-fixtures-'));
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
function backend(extra={}) {
  const db = new Database(':memory:');
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
} finally {
  process.chdir(previousCwd);
  assert.equal(new Set(results.map(r=>r.id)).size,results.length,'Duplicate audit IDs');
  const sourceFiles=['src/lib/file-parsers/media-reader.ts','src/lib/gemini/homework-grader.ts','src/lib/gemini/score-auditor.ts','src/lib/db/sqlite.ts','src/lib/playwright/download-submissions.ts','src/lib/playwright/grade-worker.ts','src/lib/playwright/network-interceptor.ts','src/app/api/homework-grader/submissions/route.ts','src/app/api/homework-grader/approve/route.ts','src/components/homework-auto-grader-tab.tsx'];
  const summary={round:22,checkedAt:new Date().toISOString(),sourceRoot:root,fixtureWorkspace:work,sqlite:':memory:',realLmsCalls:0,realGeminiCalls:0,method:'Actual snapshot function bodies, imports/types removed only; deterministic UI/DOM/Gemini doubles, real in-memory SQLite and physical synthetic files; sharp independently decodes image fixtures. Module reload tests instantiate the same unmodified source against the same SQLite database. No live browser/React scheduling acceptance.',sourceHashes:Object.fromEntries(sourceFiles.map(f=>[f,sha(read(f))])),total:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
  fs.writeFileSync(path.join(out,'independent-results.json'),JSON.stringify(summary,null,2)+'\n');
  console.log('SUMMARY '+JSON.stringify({total:summary.total,passed:summary.passed,failed:summary.failed}));if(summary.failed)process.exitCode=1;
}
