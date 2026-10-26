// R35 fresh checks: real source handlers in a deterministic hook harness, synthetic data only.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import EventEmitter from 'node:events';
import {stripTypeScriptTypes} from 'node:module';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
const root=path.resolve(process.cwd()),out=path.join(path.dirname(fileURLToPath(import.meta.url)),'evidence');
if(!root.startsWith(path.resolve(os.tmpdir())+path.sep)||!root.includes('mindx-round31-'))throw Error('RUN_ONLY_IN_ISOLATED_SNAPSHOT');
fs.mkdirSync(out,{recursive:true});
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const clean=s=>s.replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,'').replace(/\bexport\s+default\s+/g,'').replace(/\bexport\s+/g,'');
function mod(file,names,bindings={},source=read(file)){const ctx=vm.createContext({console,URL,Request,Response,structuredClone,setTimeout,clearTimeout,...bindings});vm.runInContext(stripTypeScriptTypes(clean(source),{mode:'transform'})+'\nglobalThis.out={'+names.join(',')+'};',ctx,{filename:file});return ctx.out;}
const cid='AUDIT_PTA_CLASS', sid=cid+'_SESS_01';
const base={classId:cid,sessionId:sid,studentId:'S1',submissionId:'SUB1',fullName:'Synthetic',fileHash:'file-v1',criteriaGrades:[],feedbackHtml:'OLD SAVED FEEDBACK',calculatedScore:80,decision:'GRADE',status:'WAITING_APPROVAL',parseStatus:'PARSED'};
function ui(fetch){const file='src/components/homework-auto-grader-tab.tsx',text=read(file),cut=text.indexOf('  const renderStatusBadge =');const source=text.slice(0,cut)+'\n globalThis.api={submissions,banner,loadSessionSubmissions,handleFieldUpdate,handleDownloadAndAiGrade,selectedSessionNumber,setSelectedSessionNumber,unsavedSubIds,isLoadingSubs}; return null; }';let cursor=0,dirty=true,pending=[];const slots=[],effects=[];const bindings={fetch,useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>{const next=typeof v==='function'?v(slots[i]):v;if(!Object.is(next,slots[i])){slots[i]=next;dirty=true;}}];},useEffect(fn,deps){const i=cursor++;if(!effects[i]||deps.some((d,j)=>!Object.is(d,effects[i][j]))){effects[i]=deps;pending.push(fn);}}};const ctx=vm.createContext({console,structuredClone,...bindings});vm.runInContext(stripTypeScriptTypes(clean(source),{mode:'transform'})+'\nglobalThis.render=HomeworkAutoGraderTab;',ctx);const props={classId:cid,classCode:cid,columns:[{sessionNumber:1,columnId:'L1'},{sessionNumber:2,columnId:'L2'}],initialRubrics:[]};const flush=async()=>{for(let i=0;i<15;i++){await new Promise(r=>setImmediate(r));if(dirty){dirty=false;cursor=0;ctx.render(props);const run=pending;pending=[];run.forEach(f=>f());}}};return{get api(){return ctx.api;},flush};}
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});return{promise,resolve,reject};};
const ok=data=>Response.json({success:true,data});
const results=[];
// One save fails and UI retains edited text until Refresh silently destroys it.
{
 let gets=0;const h=ui(async(url,opts)=>{if(opts?.method==='POST')throw Error('SYNTHETIC_OFFLINE');gets++;return ok({submissions:[base]});});await h.flush();await h.api.handleFieldUpdate(h.api.submissions[0],{feedbackHtml:'UNSAVED TEACHER EDIT'});await h.flush();const before={feedback:h.api.submissions[0].feedbackHtml,unsaved:structuredClone(h.api.unsavedSubIds)};await h.api.loadSessionSubmissions();await h.flush();const after={feedback:h.api.submissions[0].feedbackHtml,unsaved:structuredClone(h.api.unsavedSubIds),banner:h.api.banner};results.push({id:'R35-UI-DRAFT-REFRESH',expected:'Failed draft must remain visible and marked unsaved until explicit discard or successful save',before,after,bugReproduced:before.unsaved.SUB1===true&&after.feedback===base.feedbackHtml&&!after.unsaved.SUB1,gets});
}
// Old grade completion starts a stale GET after newer scope GET and invalidates the current GET.
{
 const grade=deferred(),newGet=deferred(),oldGet=deferred();let oldGets=0;const urls=[];const h=ui(async(url,opts)=>{urls.push(url);if(opts?.method==='POST')return grade.promise;const u=new URL(url,'http://127.0.0.1');if(u.searchParams.get('sessionId').endsWith('_02'))return newGet.promise;return ++oldGets===1?ok({submissions:[base]}):oldGet.promise;});await h.flush();const running=h.api.handleDownloadAndAiGrade();h.api.setSelectedSessionNumber(2);await h.flush();grade.resolve(ok({gradeResults:[]}));await h.flush();newGet.resolve(ok({submissions:[{...base,submissionId:'SUB2',sessionId:cid+'_SESS_02'}]}));oldGet.resolve(ok({submissions:[base]}));await running;await h.flush();const observed={selectedSession:h.api.selectedSessionNumber,submissions:h.api.submissions,isLoadingSubs:h.api.isLoadingSubs,urls};results.push({id:'R35-UI-OLD-COMPLETION',expected:'Session 2 response must load session 2 and clear loading after all requests settle',observed,bugReproduced:observed.selectedSession===2&&observed.submissions.length===0&&observed.isLoadingSubs===true});
}
// Real API route and queue + real batch loop, isolated AI and downloader doubles, no network/DB.
{
 const {taskQueue}=mod('src/lib/queue/task-queue.ts',['taskQueue'],{EventEmitter,jobLogRepo:{add(){}}});
 const {HomeworkAiGrader}=mod('src/lib/gemini/homework-grader.ts',['HomeworkAiGrader'],{});const first=deferred(),started=deferred(),calls=[];
 HomeworkAiGrader.gradeSingleSubmission=async c=>{calls.push(c.submissionId);if(calls.length===1){started.resolve();await first.promise;}return{...c,status:'WAITING_APPROVAL'};};
 const recs=[{...base},{...base,submissionId:'SUB2',studentId:'S2'}];const route=mod('src/app/api/homework-grader/download-and-grade/route.ts',['POST'],{NextResponse:Response,validateLocalRequest:()=>null,taskQueue,SubmissionDownloader:{downloadLessonSubmissions:async()=>({success:true,items:recs.map(r=>({...r,success:true}))})},HomeworkAiGrader,homeworkSubmissionRepo:{findBySession:()=>recs},studentRepo:{findByClass:()=>[]},classSessionRepo:{findByClass:()=>[]},getGradingRubrics:()=>[],findLessonInSyllabus:()=>null});
 const req=new Request('http://127.0.0.1/api/homework-grader/download-and-grade',{method:'POST',body:JSON.stringify({classId:cid,classCode:cid,sessionId:sid,lessonId:'L1',rubric:{criteria:[{criterionId:'C1'}]}})});const pending=route.POST(req);await started.promise;taskQueue.stopQueue();const atStop={calls:[...calls],queue:taskQueue.getStatus()};first.resolve();const response=await pending;const json=await response.json();results.push({id:'R35-STOP-AI-BATCH',expected:'Stop must prevent starting new student AI grading work',atStop:{calls:atStop.calls,isStopped:atStop.queue.isStopped,isRunning:atStop.queue.isRunning},after:{calls,success:json.success,isStopped:taskQueue.getStatus().isStopped},bugReproduced:calls.length===2&&taskQueue.getStatus().isStopped});
}
fs.writeFileSync(path.join(out,'ui-repro-results.json'),JSON.stringify({root,syntheticOnly:true,results},null,2));for(const r of results)console.log(JSON.stringify(r));
if(results.some(r=>!r.bugReproduced))process.exitCode=1;
