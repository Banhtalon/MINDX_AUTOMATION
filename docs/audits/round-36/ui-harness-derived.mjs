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
function ui(fetch){const file='src/components/homework-auto-grader-tab.tsx',text=read(file),cut=text.indexOf('  const renderStatusBadge =');const source=text.slice(0,cut)+'\n globalThis.api={submissions,banner,loadSessionSubmissions,handleFieldUpdate,handleDownloadAndAiGrade,selectedSessionNumber,setSelectedSessionNumber,unsavedSubIds,isLoadingSubs,handleApproveSubmission}; return null; }';let cursor=0,dirty=true,pending=[];const slots=[],effects=[];const bindings={fetch,useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>{const next=typeof v==='function'?v(slots[i]):v;if(!Object.is(next,slots[i])){slots[i]=next;dirty=true;}}];},useEffect(fn,deps){const i=cursor++;if(!effects[i]||deps.some((d,j)=>!Object.is(d,effects[i][j]))){effects[i]=deps;pending.push(fn);}}};const ctx=vm.createContext({console,structuredClone,...bindings});vm.runInContext(stripTypeScriptTypes(clean(source),{mode:'transform'})+'\nglobalThis.render=HomeworkAutoGraderTab;',ctx);const props={classId:cid,classCode:cid,columns:[{sessionNumber:1,columnId:'L1'},{sessionNumber:2,columnId:'L2'}],initialRubrics:[]};const flush=async()=>{for(let i=0;i<15;i++){await new Promise(r=>setImmediate(r));if(dirty){dirty=false;cursor=0;ctx.render(props);const run=pending;pending=[];run.forEach(f=>f());}}};return{get api(){return ctx.api;},flush};}
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});return{promise,resolve,reject};};
const ok=data=>Response.json({success:true,data});

export {ui,ok,base,cid,sid,deferred};
