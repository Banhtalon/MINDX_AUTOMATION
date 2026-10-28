// Run ONLY in an isolated copy: npx tsx docs/audits/v311/independent-probe.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { GET } from '../../../../src/app/api/session-comments/list/route';
import { POST as saveDraft } from '../../../../src/app/api/session-comments/save-draft/route';
import { getDb, sessionFeedbackRepo } from '../../../../src/lib/db/sqlite';
import * as quickTagHelpers from '../../../../src/lib/quick-tags';
import { assertPathAllowed } from '../../../../src/lib/security/path-allowlist';
import { getQuickTags, getCoursesSyllabus } from '../../../../src/lib/db/json-config';

assert(process.cwd().includes('mindx-v311-review-'), 'Use a disposable review copy; never run against owner data');
const read = (name: string) => fs.readFileSync(assertPathAllowed(path.resolve(name)), 'utf8');
const results: any[] = [];
const check = (name: string, actual: any, expected: any) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, pass, actual, expected });
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${name}`);
};
const db = getDb();
const cls = 'AUDIT-V311-ROB';
db.prepare('DELETE FROM session_feedbacks WHERE classId=?').run(cls);
db.prepare('DELETE FROM students WHERE classId=?').run(cls);
db.prepare('DELETE FROM classes_sessions WHERE classId=?').run(cls);
const good = '🤖 Lắp ráp & Lập trình tốt';
const distracted = '👀 Mất tập trung';
const metaClear = JSON.stringify({rowVer: 1, fields: {quickTags: {ver: 1, cid: 'audit', rev: 1}}});
function feedback(studentId: string, sessionId: string, tags: string[], extra: any = {}) {
  sessionFeedbackRepo.upsert({ classId: cls, sessionId, studentId, quickTagsJson: JSON.stringify(tags),
    attendanceStatus: 'UNKNOWN', teacherNote: '', strengths: '', improvements: '', actionPlan: '',
    finalText: '', status: 'DRAFT', ...extra });
}
async function list(sessionId: string, classId = cls) {
  const res = await GET(new Request(`http://127.0.0.1:3000/api/session-comments/list?classId=${classId}&sessionId=${sessionId}`,
    {headers: {host: '127.0.0.1:3000'}}));
  assert.equal(res.status, 200);
  return (await res.json()).data;
}
for (let n = 1; n <= 5; n++) {
  db.prepare('INSERT INTO classes_sessions (classId,className,sessionId,sessionNumber) VALUES (?,?,?,?)')
    .run(cls, cls, `${cls}_SESS_0${n}`, n);
}
for (const id of ['UI', 'RACE', 'ATTEND', 'BULK', 'CLEAR', 'FINAL', 'OLDER', 'FUTURE', 'UNKNOWN']) {
  db.prepare('INSERT INTO students (classId,studentId,fullName,isActive) VALUES (?,?,?,1)').run(cls, id, `STUDENT_${id}`);
}
feedback('OLDER', `${cls}_SESS_01`, ['👍 Đạt yêu cầu']);
feedback('OLDER', `${cls}_SESS_02`, [distracted]);
feedback('OLDER', `${cls}_SESS_05`, [good]);
feedback('CLEAR', `${cls}_SESS_01`, [good]);
feedback('CLEAR', `${cls}_SESS_02`, [], {versionMetaJson: metaClear});
feedback('FUTURE', `${cls}_SESS_05`, [good]);
feedback('UNKNOWN', `${cls}_SESS_UNKNOWN`, [good]);
feedback('UI', `${cls}_SESS_02`, ['👍 Đạt yêu cầu']);
feedback('RACE', `${cls}_SESS_02`, [good]);
feedback('ATTEND', `${cls}_SESS_02`, [good]);
feedback('BULK', `${cls}_SESS_02`, [good]);
feedback('FINAL', `${cls}_SESS_02`, [good]);
feedback('FINAL', `${cls}_SESS_03`, [], {finalText: 'Existing teacher comment'});
let data = await list(`${cls}_SESS_03`);
check('API chooses most recent earlier number, excluding future', data.previousQuickTagsByStudent.OLDER, {tags: [distracted], fromSessionNumber: 2});
check('API honors explicit clear in previous session', data.previousQuickTagsByStudent.CLEAR, undefined);
check('API excludes known future session', data.previousQuickTagsByStudent.FUTURE, undefined);
check('API must exclude history with unknown session number', data.previousQuickTagsByStudent.UNKNOWN, undefined);
check('API normalizes legacy tag to Robotics', data.previousQuickTagsByStudent.UI, {tags: [good], fromSessionNumber: 2});
const unknownCurrent = await list(`${cls}_SESS_PENDING`);
check('API must not inherit future tags when current number is unknown', unknownCurrent.previousQuickTagsByStudent.FUTURE, undefined);

// Exercise actual component handlers with a minimal hook scheduler; no JSX/browser/LMS.
function harness(initialData: any, fetchSave?: (url: string, options: any) => Promise<any>) {
  let source = read('docs/audits/v311/round2/baseline-page.txt').replaceAll('\r\n', '\n');
  const marker = '\n  return (\n    <div className="space-y-6">';
  assert(source.includes(marker));
  source = source.slice(0, source.indexOf(marker)) + '\n globalThis.api = { students, handleNoteChange, handleAttendanceChange, handleConfirmAllPresent, handleGenerateAi, quickTagTrack, toggleQuickTag, studentEditVersionRef }; return null; }';
  source = stripTypeScriptTypes(source.replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, '')
    .replace(/\bexport\s+default\s+/g, '').replace(/\bexport\s+/g, ''));
  const slots: any[] = [], effects: any[] = [], saves: any[] = [];
  let cursor = 0, dirty = true, pending: any[] = [];
  const context: any = {console, setTimeout, clearTimeout, ...quickTagHelpers,
    fetch: async (url: string, options?: any) => {
      if (options?.method === 'POST') {
        saves.push({url, payload: JSON.parse(options.body)});
        if (fetchSave) return fetchSave(url, options);
        return saveDraft(new Request(`http://127.0.0.1:3000${url}`, {...options, headers: {...options.headers, host: '127.0.0.1:3000'}}));
      }
      return {json: async () => ({success: true, data: initialData})};
    },
    useState(initial: any) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (value: any) => { const n = typeof value === 'function' ? value(slots[i]) : value;
        if (!Object.is(n, slots[i])) {slots[i] = n; dirty = true;} }];
    },
    useRef(initial: any) { const i = cursor++; if (!(i in slots)) slots[i] = {current: initial}; return slots[i]; },
    useEffect(fn: any, deps: any) { const i = cursor++; if (!effects[i] || deps.some((v: any, j: number) => !Object.is(v, effects[i][j]))) {
      effects[i] = deps; pending.push(fn);
    } },
  };
  vm.createContext(context);
  vm.runInContext(source + '\nglobalThis.render = SessionCommentsPage;', context);
  const flush = async () => {for(let i=0;i<20;i++) {await new Promise(resolve => setImmediate(resolve));
    if (dirty) {dirty=false;cursor=0;context.render();const jobs=pending;pending=[];jobs.forEach(fn=>fn());}
  }};
  return {context, saves, flush};
}
// Keep selected session at 3 when component chooses latest active session.
data.sessions = data.sessions.filter((s: any) => s.sessionNumber === 3);
let h = harness(data);
await h.flush();
check('UI inherits normalized tags and provenance', JSON.parse(JSON.stringify(h.context.api.students.find((s: any) => s.studentId === 'UI').quickTags)), [good]);
check('UI provenance points to session 2', h.context.api.students.find((s: any) => s.studentId === 'UI').inheritedFromSession, 2);
check('UI preserves existing finalText without inheriting', h.context.api.students.find((s: any) => s.studentId === 'FINAL').quickTags.length, 0);
h.context.api.handleNoteChange('UI', 'audit note');
await h.flush();
check('Note interaction durably stores inherited tags', JSON.parse(sessionFeedbackRepo.findOne(cls, `${cls}_SESS_03`, 'UI')!.quickTagsJson!), [good]);

feedback('UI', `${cls}_SESS_03`, [], {versionMetaJson: metaClear});
data = await list(`${cls}_SESS_03`);data.sessions = data.sessions.filter((s: any) => s.sessionNumber === 3);
h = harness(data);await h.flush();
check('UI respects explicit clear in current session', h.context.api.students.find((s: any) => s.studentId === 'UI').quickTags.length, 0);

for (const id of ['ATTEND','BULK']) {
  const attendanceData = await list(`${cls}_SESS_03`);
  attendanceData.sessions = attendanceData.sessions.filter((s: any) => s.sessionNumber === 3);
  attendanceData.students = attendanceData.students.filter((s: any) => s.studentId === id);
  const attendanceHarness = harness(attendanceData);await attendanceHarness.flush();
  if (id === 'ATTEND') attendanceHarness.context.api.handleAttendanceChange(id,'PRESENT');
  else await attendanceHarness.context.api.handleConfirmAllPresent(true);
  await attendanceHarness.flush();
  check(`${id}: attendance durably preserves inherited tags`,JSON.parse(sessionFeedbackRepo.findOne(cls,`${cls}_SESS_03`,id)!.quickTagsJson!),[good]);
}

// Start with a fresh inherited row, then simulate first save failing while a newer note is queued.
data = await list(`${cls}_SESS_03`);data.sessions = data.sessions.filter((s: any) => s.sessionNumber === 3);
let release!: (value: any) => void;
let count = 0;
h = harness(data, async (url, options) => { if (++count === 1) return new Promise(r => {release=r;});
  return saveDraft(new Request(`http://127.0.0.1:3000${url}`, {...options, headers: {...options.headers, host: '127.0.0.1:3000'}})); });
await h.flush();
h.context.api.handleNoteChange('RACE', 'first');await h.flush();
h.context.api.handleNoteChange('RACE', 'second');await h.flush();
release({ok:false,status:500,json:async()=>({success:false,error:'simulated first-save failure'})});await h.flush();
check('Overlapping second note must retain tags when first save fails', h.saves[1]?.payload.quickTags, [good]);
check('After failure unsaved tags must retain inheritance marker', h.context.api.students.find((s: any) => s.studentId === 'RACE').inheritedFromSession, 2);
check('Database retains tags after overlapping note succeeds', JSON.parse(sessionFeedbackRepo.findOne(cls, `${cls}_SESS_03`, 'RACE')!.quickTagsJson!), [good]);

// Execute real generator source with only Gemini transport stubbed; SQLite remains real.
const generatorSource = stripTypeScriptTypes(read('src/lib/gemini/comment-generator.ts')
  .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, '').replace(/\bexport\s+/g, ''));
const generatorCtx: any = {console, sessionFeedbackRepo, getQuickTags, getCoursesSyllabus,
  studentRepo: {findOne: (id: string, classId: string) => db.prepare('SELECT * FROM students WHERE studentId=? AND classId=?').get(id, classId)},
  getGeminiModel: () => ({generateContent: async () => ({response:{text:()=>JSON.stringify({feedbacks:[{
    anonymousId:'STUDENT_01',strengths:'Con tiếp thu tốt.',improvements:'Con cần luyện tập.',actionPlan:'Thầy khuyên con ôn bài.',formattedFullComment:'fixture comment'
  }]})}})}),
};
vm.createContext(generatorCtx);
vm.runInContext(generatorSource+'\nglobalThis.generator=CommentGenerator;',generatorCtx);
feedback('UI', `${cls}_SESS_04`, [], {attendanceStatus:'PRESENT',versionMetaJson:JSON.stringify({rowVer:1,fields:{attendanceStatus:{ver:1,cid:'audit',rev:1}}})});
await generatorCtx.generator.generateBatchComments({classId:cls,classCode:cls,sessionId:`${cls}_SESS_04`,sessionNumber:4,topic:'Robotics'},
  [{studentId:'UI',fullName:'STUDENT_UI',isActive:true,attendanceStatus:'PRESENT',quickTags:[good],expectedRowVer:1}]);
check('AI success persists inherited tags over attendance-only empty row',JSON.parse(sessionFeedbackRepo.findOne(cls,`${cls}_SESS_04`,'UI')!.quickTagsJson!),[good]);

// Reproduce destructive cleanup with a synthetic sentinel in disposable DB only.
const sentinelClass = 'VT-ROB-SEMIA05';
sessionFeedbackRepo.upsert({classId:sentinelClass,sessionId:`${sentinelClass}_SESS_07`,studentId:'AUDIT_SENTINEL',quickTagsJson:'[]',finalText:'Approved owner content',status:'DRAFT'});
const child = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/test-quick-tags-v300.ts'], {encoding:'utf8'});
assert.equal(child.status, 0, child.stderr);
check('Required quick-tag test preserves unrelated pre-existing feedback', Boolean(sessionFeedbackRepo.findOne(sentinelClass, `${sentinelClass}_SESS_07`, 'AUDIT_SENTINEL')), true);


// Round 2 reviewer additions: use unchanged production handlers and real SQLite.
for (const [mode,action] of [['inherit','attendance'],['replace','note'],['replace','attendance'],['clear','note'],['clear','attendance'],['replace','bulk'],['inherit-clear','note'],['inherit-clear','attendance']]) {
 const id=`EXT_${mode}_${action}`;
 db.prepare('INSERT INTO students (classId,studentId,fullName,isActive) VALUES (?,?,?,1)').run(cls,id,id);
 feedback(id,`${cls}_SESS_02`,[good]);
 if(mode!=='inherit' && mode!=='inherit-clear') feedback(id,`${cls}_SESS_03`,[good]);
 const d=await list(`${cls}_SESS_03`);d.sessions=d.sessions.filter((s:any)=>s.sessionNumber===3);d.students=d.students.filter((s:any)=>s.studentId===id);
 let resolveFirst!:(value:any)=>void;let calls=0;
 const hh=harness(d,async(url,options)=>{if(++calls===1)return new Promise(r=>{resolveFirst=r;});return saveDraft(new Request(`http://127.0.0.1:3000${url}`,{...options,headers:{...options.headers,host:'127.0.0.1:3000'}}));});
 await hh.flush();
 const first=mode==='inherit'?hh.context.api.handleNoteChange(id,'first note'):hh.context.api.toggleQuickTag(id,mode.includes('clear')?good:distracted);
 await hh.flush();
 if(action==='note')hh.context.api.handleNoteChange(id,'newest note');
 else if(action==='attendance')hh.context.api.handleAttendanceChange(id,'PRESENT');
 else await hh.context.api.handleConfirmAllPresent(false);
 await hh.flush();
 resolveFirst({ok:false,status:500,json:async()=>({success:false,error:'first request fails'})});await first;await hh.flush();
 const expected=mode.includes('clear')?[]:mode==='replace'?[good,distracted]:[good];
 check(`EXT ${mode}/${action}: second save includes pending tags`,hh.saves[1]?.payload.quickTags,expected);
 check(`EXT ${mode}/${action}: SQLite equals visible tags`,JSON.parse(sessionFeedbackRepo.findOne(cls,`${cls}_SESS_03`,id)!.quickTagsJson!),expected);
 check(`EXT ${mode}/${action}: failed older response preserves visible tags`,JSON.parse(JSON.stringify(hh.context.api.students[0].quickTags)),expected);
 if(mode==='inherit-clear'){const reloaded=await list(`${cls}_SESS_03`);reloaded.sessions=reloaded.sessions.filter((s:any)=>s.sessionNumber===3);reloaded.students=reloaded.students.filter((s:any)=>s.studentId===id);const rh=harness(reloaded);await rh.flush();check(`EXT ${mode}/${action}: explicit clear stays clear after reload`,JSON.parse(JSON.stringify(rh.context.api.students[0].quickTags)),[]);}
}
// Reject invalid metadata and arbitrary numeric suffixes; accept documented SESS fallback.
for(const [suffix,num,expectedNum] of [['BAD_77',0,0],['SESS_UNKNOWN',0,0],['SESS_ZERO',0,0],['SESS_NEG',-2,0],['SESS_FRAC',1.5,0],['SESS_0002',0,2],['SESS_03',0,3],['SESS_05',0,0],['CUSTOM',2,2]]) {
 const id=`NUM_${suffix}`;db.prepare('INSERT INTO students(classId,studentId,fullName,isActive) VALUES(?,?,?,1)').run(cls,id,id);
 const sid=`${cls}_${suffix}`;
 if(!db.prepare('SELECT 1 FROM classes_sessions WHERE classId=? AND sessionId=?').get(cls,sid))db.prepare('INSERT INTO classes_sessions(classId,className,sessionId,sessionNumber)VALUES(?,?,?,?)').run(cls,cls,sid,num);
 feedback(id,sid,[good]);
 const r=await list(`${cls}_SESS_04`);
 check(`EXT number ${suffix}/${num}: valid earlier only`,r.previousQuickTagsByStudent[id],expectedNum?{tags:[good],fromSessionNumber:expectedNum}:undefined);
}
// Compare full row content of pre-existing real-class sentinel and unrelated synthetic keys.
const fixtureClass='TEST_V311_ROB_SEMIA05';
const keep=[['VT-ROB-SEMIA05','VT-ROB-SEMIA05_SESS_99_SENTINEL','STU_SENTINEL_R101'],[fixtureClass,`${fixtureClass}_SESS_09`,'STU_INHERIT_1'],[fixtureClass,`${fixtureClass}_SESS_01`,'UNRELATED_STUDENT']];
const before=keep.map(([classId,sessionId,studentId])=>{sessionFeedbackRepo.upsert({classId,sessionId,studentId,quickTagsJson:JSON.stringify([good]),teacherNote:'Keep exact content',finalText:'Owner approved content',status:'DRAFT'});return sessionFeedbackRepo.findOne(classId,sessionId,studentId);});
const child2=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/test-quick-tags-v300.ts'],{encoding:'utf8'});
check('EXT quick-tags runner exits successfully with pre-existing sentinel',child2.status,0);
keep.forEach(([classId,sessionId,studentId],i)=>check(`EXT preserve full unrelated row ${i}`,sessionFeedbackRepo.findOne(classId,sessionId,studentId),before[i]));

fs.writeFileSync(assertPathAllowed(path.resolve('docs/audits/v311/round2/baseline-results.json')), JSON.stringify(results, null, 2));
console.log(JSON.stringify({passed:results.filter(x=>x.pass).length, failed:results.filter(x=>!x.pass).length}));
process.exitCode = results.some(x=>!x.pass) ? 1 : 0;
