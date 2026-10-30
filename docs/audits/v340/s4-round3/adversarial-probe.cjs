// Independent S4 R3: real snapshot builder + temporary SQLite + real route handlers.
const assert=require('node:assert/strict'), fs=require('node:fs'), os=require('node:os'), path=require('node:path'), vm=require('node:vm');
const {transformSync}=require('esbuild');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'codex-s4-r3-adversarial-'));
process.env.MINDX_DB_PATH=path.join(temp,'audit.db');
process.env.MINDX_RUNNING_CLASSES_PATH=path.join(temp,'running_classes.json');
process.env.ALLOWED_LOCAL_DIRS=temp;
const root=process.cwd(), db=require(path.join(root,'src/lib/db/sqlite.ts'));
const route=require(path.join(root,'src/app/api/report-card/route.ts'));
const {ScoreScraper}=require(path.join(root,'src/lib/playwright/scrape-scores.ts'));
const calc=require(path.join(root,'src/lib/report-card/report-card-calculator.ts'));
const exportRoute=require(path.join(root,'src/app/api/homework-grader/export/route.ts'));
const XLSX=require('xlsx');
const records=[];
function record(id,details){records.push({id,...details});console.log(JSON.stringify(records.at(-1)));}
const norm=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[đĐ]/g,'d').toLowerCase().replace(/\s+/g,' ').trim();
const slug=(c,n)=>`STU_${c}_${norm(n).replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').toUpperCase()}`;
const local=(url,body,method='POST')=>new Request('http://127.0.0.1:3000'+url,{method:body===undefined?'GET':method,headers:{host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
function evaluation(c,sid,score,comp=4,status='APPROVED',learned='') {
 db.session14EvalRepo.getOrInit(c,sid);
 db.getDb().prepare('UPDATE spck_session14_evaluations SET demoTotalScore=?,competencyTotalScore=?,status=?,learnedFromMindx=?,updatedAt=? WHERE classId=? AND studentId=?').run(score,comp,status,learned,'2026-10-30T08:00:30Z',c,sid);
}
function people(c,duplicate=false,robot=false) {
 const list=[{id:'CRM_A',uid:'UID_A',sid:robot?'CANON_A':'CRM_A',fullName:'Đỗ Minh An'},{id:'CRM_B',uid:'UID_B',sid:robot?'CANON_B':'CRM_B',fullName:duplicate?'Đỗ Minh An':'Trần Minh Bình'}];
 list.forEach(p=>db.studentRepo.upsert({classId:c,studentId:p.sid,fullName:p.fullName,isActive:1}));
 return list;
}
function extract(c,list,rows,robot=false) {
 const attendance=list.map(p=>({student:{id:p.id,fullName:p.fullName},commentByAreas:[{type:'RATE',grade:4},{type:'CHECKPOINT',checkpoint:{checkpointScore:4,practiceScore:4}},{type:'DEMO',demoQuestions:Array.from({length:5},()=>({score:0.8}))}]}));
 return ScoreScraper.extractReportCardSnapshotFromGql({classId:c,classCode:c,isRobotics:robot,scrapedAt:'2026-10-30T08:01:00Z',existingStudents:db.studentRepo.findByClass(c,false),session14Evals:rows||db.session14EvalRepo.findByClass(c),
 submissionGqlData:robot?undefined:{students:list.map(p=>({id:p.id,studentUid:p.uid,displayName:p.fullName})),lessons:[],submissions:[]},
 classByIdGqlData:{students:list.map(p=>({student:{id:p.id,fullName:p.fullName},activeInClass:true})),slots:(robot?[3,7,13]:[4,8,13]).map(index=>({index,studentAttendance:attendance}))}});
}
function projection(s){return s.students.map(p=>[p.studentId,p.stageScores.finalProduct,p.stageScores.finalCompetency]);}
const source=fs.readFileSync('scripts/test-streamline-v340-s4.ts','utf8');
let harnessSource=source.slice(source.indexOf('  function createReportCardViewHarness('),source.indexOf('  // ========================================================================='));
harnessSource=harnessSource.replace('get treeText() {','get tree() { return tree; },\n get treeText() {');
const hc=vm.createContext({fs,path,vm,process,transformSync,...calc,console,setTimeout,clearTimeout,setImmediate});
vm.runInContext(transformSync(harnessSource,{loader:'ts',target:'es2022'}).code+'\nglobalThis.makeHarness=createReportCardViewHarness;',hc);
const reply=(data,status=200)=>({ok:status<400,status,json:async()=>data});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function main(){
 // Exhaust alias precedence and duplicate-name combinations. Every edit precedes scrape completion.
 let changed=0,unchanged=0,fresh=0;
 for(const duplicate of [false,true]) for(let mask=1;mask<16;mask++) {
  const c=`AUDIT-R3-PRECEDENCE-${duplicate?1:0}-${mask}`, ps=people(c,duplicate);
  const aliases=['CRM_A','UID_A',slug(c,ps[0].fullName),'CRM_B'];
  aliases.forEach((id,i)=>{if(mask&(1<<i)) evaluation(c,id,2+i*0.5,3+i*0.25);});
  const base=extract(c,ps);
  assert.equal(route.computeReportCardStaleness(c,base).isStale,false,`fresh mask ${mask} duplicate ${duplicate}`); fresh++;
  for(let i=0;i<aliases.length;i++) if(mask&(1<<i)) {
   const old=db.session14EvalRepo.findOne(c,aliases[i]);
   for(const score of [0,5]) {
    evaluation(c,aliases[i],score,4.75);
    const next=extract(c,ps), actual=route.computeReportCardStaleness(c,base);
    const expected=JSON.stringify(projection(base))!==JSON.stringify(projection(next));
    assert.equal(actual.hasNewerSession14,expected,`edit ${c} alias ${aliases[i]} -> ${score}`);
    assert.equal(route.computeReportCardStaleness(c,next).isStale,false,`rescan ${c}`);
    if(expected) changed++; else unchanged++;
    evaluation(c,aliases[i],old.demoTotalScore,old.competencyTotalScore,old.status,old.learnedFromMindx);
   }
  }
 }
 record('R3-A01',{state:'PASS',freshSnapshots:fresh,changedEffectiveSources:changed,shadowedEdits:unchanged});
 // Predicate parity across statuses, numeric edges and both Coding/Robotics.
 let cases=0;
 for(const robot of [false,true]) for(const status of ['DRAFT','WAITING_APPROVAL','APPROVED','VERIFIED','FAILED','SAVING']) for(const score of [0,0.004,0.005,3.337,5,6]) for(const learned of ['', 'Đã đánh giá']) {
  const c=`${robot?'VT-ROB':'AUDIT'}-R3-STATE-${cases}`,ps=people(c,false,robot);
  evaluation(c,robot?'CANON_A':'UID_A',score,3.337,status,learned);
  const s=extract(c,ps,undefined,robot), p=s.students.find(s=>s.studentId===ps[0].sid);
  const effective=score>0||['APPROVED','VERIFIED'].includes(status)||Boolean(learned.trim());
  assert.equal(p.stageScores.finalProduct,effective?calc.round2(Math.max(0,Math.min(5,score))):4);
  assert.equal(route.computeReportCardStaleness(c,s).isStale,false,`state ${c} ${status} ${score}`);
  // A score override must not falsely claim that the immutable LMS snapshot changed.
  db.reportCardRepo.saveLmsSnapshot(c,s);
  const parsed=db.parseReportCardLmsSnapshot(db.reportCardRepo.findOne(c).lmsSnapshotJson,c);
  assert.deepEqual(parsed.students.map(s=>s.crmStudentId),s.students.map(s=>s.crmStudentId));
  assert.equal(route.computeReportCardStaleness(c,parsed).isStale,false);
  cases++;
 }
 record('R3-A02',{state:'PASS',statusScoreCourseCombinations:cases,crmRoundTrips:cases});
 // CRM edit under real GET + both approve verbs + wrong-version rejection.
 const c='AUDIT-R3-CRM-API',ps=[{id:'CRM_EXT',uid:'UID_EXT',sid:'CANON',fullName:'Học Viên Giả Lập'}];
 db.studentRepo.upsert({classId:c,studentId:'CANON',fullName:ps[0].fullName,isActive:1});
 evaluation(c,'CRM_EXT',4);const old=extract(c,ps); evaluation(c,'CRM_EXT',0);
 db.reportCardRepo.saveLmsSnapshot(c,old);
 const get=await (await route.GET(local(`/api/report-card?classId=${c}`))).json();
 assert.equal(get.staleness.hasNewerSession14,true);assert.equal(get.snapshot.students[0].crmStudentId,'CRM_EXT');
 const approvals=[];
 for(const verb of ['POST','PUT']) {
  const r=await route[verb](local('/api/report-card',{classId:c,action:'approve',expectedVersion:get.record.draftVersion},verb)),j=await r.json();
  assert.equal(r.status,200);assert.equal(j.staleness.hasNewerSession14,true);assert.ok(j.record.contentHash);approvals.push(verb);
 }
 const bad=await route.PUT(local('/api/report-card',{classId:c,action:'approve',expectedVersion:get.record.draftVersion+99},'PUT'));
 assert.equal(bad.status,409);
 db.reportCardRepo.saveLmsSnapshot(c,extract(c,ps));
 const refreshed=await (await route.GET(local(`/api/report-card?classId=${c}`))).json();
 assert.equal(refreshed.staleness.hasNewerSession14,false);
 record('R3-A03',{state:'PASS',crmPreserved:true,zeroEditWarningThrough:approvals,wrongVersion:409,rescanClears:true});
 // Real exports: every cell state, both file formats, all three modes, formula-like identifiers.
 const cells=[{status:'GRADED',score:0,quizScore:0},{status:'GRADED',score:95,quizScore:80},{status:'SUBMITTED_UNGRADED',score:null,quizScore:70},{status:'REDO_REQUESTED',score:null,quizScore:60},{status:'NOT_SUBMITTED',score:null,quizScore:null}].map((x,i)=>({...x,columnId:`C${i}`,sessionNumber:i+1,maxScore:100,rawText:''}));
 const ec='AUDIT-R3-EXPORT';
 db.scoreMatrixRepo.save(ec,{success:true,classId:ec,classCode:ec,columns:cells.map((_,i)=>({columnId:`C${i}`,title:`=COL${i}`,sessionNumber:i+1})),rows:[{studentId:'=1+1',fullName:'@formula',isActive:true,cells:Object.fromEntries(cells.map((x,i)=>[`C${i}`,x])),averageScore:0,averageQuizScore:0,gradedCount:2,submittedUngradedCount:1,notSubmittedCount:1,redoCount:1}],summary:{},scrapedAt:'2026-10-30T08:01:00Z'});
 const fmt=require(path.join(root,'src/lib/report-card/export-cell-formatter.ts'));let files=0;
 for(const format of ['csv','xlsx']) for(const mode of ['both','quiz','practice']) {
  const r=await exportRoute.GET(local(`/api/homework-grader/export?classId=${ec}&format=${format}&mode=${mode}`));assert.equal(r.status,200);
  const wb=XLSX.read(Buffer.from(await r.arrayBuffer()),{type:'buffer',raw:true}),sheet=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true});
  assert.equal(rows[1][1],"'=1+1");assert.equal(rows[1][2],"'@formula");
  for(let i=0;i<cells.length;i++) assert.equal(String(rows[1][4+i]),String(fmt.formatCellForExport(cells[i],mode)));
  assert.equal(Number(rows[1][9]),0);assert.equal(Number(rows[1][10]),0);
  for(const cell of Object.values(sheet)) if(cell&&typeof cell==='object') assert.equal(cell.f,undefined);
  files++;
 }
 record('R3-A04',{state:'PASS',exportFiles:files,gradeCells:files*cells.length,zeroRetained:true,formulaFieldsNeutralized:true});
 // Harness: standalone scrape reloads once; late cross-class responses and malformed JSON never sync.
 const payload=refreshed;
 for(const failure of ['malformed-approve','malformed-sync','wrong-class-approve']) {
  let calls=[];
  const h=hc.makeHarness(async(url,options)=>{
   if(!options) return reply(payload);
   calls.push(url);
   if(failure==='malformed-approve'||(failure==='malformed-sync'&&url.includes('sync-teaching'))) return {ok:true,json:async()=>{throw new SyntaxError('Invalid JSON');}};
   if(failure==='wrong-class-approve') return reply({...payload,success:true,record:{...payload.record,classId:'OTHER_CLASS'}});
   return reply({...payload,success:true});
  },{classId:c,classCode:c});
  await h.flush();await h.api.handleApproveAndSyncTeaching();await h.flush();
  assert.equal(calls.filter(x=>x.includes('sync-teaching')).length,failure==='malformed-sync'?1:0);
  assert.equal(h.api.isApproving,false);assert.equal(h.api.isSyncingTeaching,false);assert.equal(h.api.toastMsg,null);
 }
 record('R3-A05',{state:'PASS',malformedOrMismatchedResponses:3,noFalseSuccess:true,busyReleased:true});
 const d=deferred();let gets=0,posts=0;
 const h=hc.makeHarness(async(url,options)=>{if(!options){gets++;return reply(payload);}posts++;return d.promise;},{classId:c,classCode:c});
 await h.flush();const pending=h.api.handleScrapeFromLms();await h.flush();d.resolve(reply({success:true,classId:c}));await pending;await h.flush();
 assert.equal(posts,1);assert.equal(gets,2);assert.equal(h.api.isScrapingLms,false);assert.ok(h.api.toastMsg);
 record('R3-A06',{state:'PASS',standaloneScrapePosts:posts,initialGet:1,postScrapeReloads:gets-1});
 // Canonical/CRM/UID/slug competing sources, all three real IDs kept distinct.
 let precedenceCases=0,precedenceChanged=0,precedenceShadowed=0;
 for(let mask=1;mask<16;mask++) {
  const cid=`AUDIT-R3-FIVE-KEYS-${mask}`,list=[{sid:'CANON_A',id:'CRM_A',uid:'UID_A',fullName:'Đỗ Minh An'}];
  db.studentRepo.upsert({classId:cid,studentId:'CANON_A',fullName:list[0].fullName,isActive:1});
  const keys=['CANON_A','CRM_A','UID_A',slug(cid,list[0].fullName)];
  keys.forEach((id,i)=>{if(mask&(1<<i))evaluation(cid,id,1+i*0.6);});
  const baseline=extract(cid,list);
  assert.equal(baseline.students[0].studentId,'CANON_A');assert.equal(baseline.students[0].crmStudentId,'CRM_A');assert.equal(baseline.students[0].studentUid,'UID_A');
  assert.equal(route.computeReportCardStaleness(cid,baseline).isStale,false);
  for(let i=0;i<keys.length;i++) if(mask&(1<<i)) {
   const old=db.session14EvalRepo.findOne(cid,keys[i]);evaluation(cid,keys[i],5);
   const next=extract(cid,list),expected=JSON.stringify(projection(baseline))!==JSON.stringify(projection(next));
   assert.equal(route.computeReportCardStaleness(cid,baseline).hasNewerSession14,expected,`distinct aliases mask ${mask}, key ${keys[i]}`);
   assert.equal(route.computeReportCardStaleness(cid,next).isStale,false);
   evaluation(cid,keys[i],old.demoTotalScore,old.competencyTotalScore,old.status,old.learnedFromMindx);
   if(expected)precedenceChanged++;else precedenceShadowed++;precedenceCases++;
  }
 }
 record('R3-A07',{state:'PASS',aliasCombinations:15,individualEdits:precedenceCases,changed:precedenceChanged,shadowed:precedenceShadowed});
 const ambiguous='AUDIT-R3-AMBIGUOUS',ap=[{sid:'CANON_A',id:'CRM_A',uid:'UID_A',fullName:'Đỗ Minh An'}];
 for(const id of ['CANON_A','LEGACY_ID']) db.studentRepo.upsert({classId:ambiguous,studentId:id,fullName:ap[0].fullName,isActive:1});
 assert.throws(()=>extract(ambiguous,ap),/Xung đột định danh/);
 record('R3-A08',{state:'PASS',ambiguousCanonicalNameBridge:'rejected before manufacturing a snapshot'});
}
main().catch(e=>{record('HARNESS-ERROR',{state:'ERROR',error:e.stack});process.exitCode=1;}).finally(()=>{fs.writeFileSync(path.join(__dirname,'adversarial-results.json'),JSON.stringify({temp,records},null,2));db.closeDb();});
