const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const root = process.cwd();
const req = createRequire(path.join(root,'package.json'));
const pii = req('./src/lib/ai/pii-anonymizer.ts');
const vi = req('./src/lib/utils/vietnamese-match.ts');
const observations=[];
function check(id,ok,detail){observations.push({id,pass:!!ok,detail});}
const names=['Nguyễn Minh Khôi','Trần Minh Khôi','Lê Thị Ý','Phạm Văn Y','Đỗ Bảo An'];
const roster=names.map((fullName,i)=>({fullName,studentId:`AUDIT_${i+1}`}));
for(const [i,name] of names.entries()){
  const words=name.split(' ');
  const variants=[name,words.slice(-2).join(' '),words.at(-1),vi.stripVietnameseAccentsPreserveCase(name),vi.stripVietnameseAccentsPreserveCase(words.at(-1)),name.normalize('NFD')];
  for(const [j,text] of variants.entries()){
    const result=pii.anonymize(text,{roster});
    check(`direct-${i}-${j}`,/^(STUDENT_\d+)$/.test(result.text),{input:text,output:result.text});
  }
  const result=pii.anonymize(name,{targetFullName:name});
  check(`roundtrip-${i}`,pii.deanonymize(result.text,{tokenMap:result.tokenMap})===name,result);
}
for(const given of ['Á','Ý','Y','y','Ỷ','Ứ']){
  const result=pii.anonymize(`Con ${given} hoàn thành bài.`,{targetFullName:`Lê Thị ${given}`});
  check(`one-char-${given}`,result.text==='Con STUDENT_01 hoàn thành bài.',result);
}
for(const name of names){
  for(const sep of ['','_','-','.']){
    const filename=vi.stripVietnameseAccentsPreserveCase(name).split(' ').join(sep)+'.py';
    const output=pii.anonymize(filename,{targetFullName:name,matchJoinedFileNames:true,matchAllNameTokens:true}).text;
    check(`joined-${name}-${sep}`,!/[\p{L}\p{N}]/u.test(output.replace(/STUDENT_\d+/g,'').replace(/\.py$/,'')),{input:filename,output});
  }
}
check('tones-preserved',vi.normalizeVietnameseNamePreserveTones('  LÊ  BẢO  AN ')==='lê bảo an' && vi.normalizeVietnameseNamePreserveTones('Lê Bá An')!=='lê bảo an',{});
check('strip-lower',vi.stripVietnameseDiacritics('ĐẶNG Thị Ý')==='dang thi y',{});
check('strip-case',vi.stripVietnameseAccentsPreserveCase('ĐẶNG Thị Ý')==='DANG Thi Y',{});
check('strip-nfd',vi.stripVietnameseAccentsPreserveCase('ĐẶNG Thị Ý'.normalize('NFD'))==='DANG Thi Y',{});
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const files=walk(path.join(root,'src')).filter(f=>/\.[tj]sx?$/.test(f));
for(const [id,re] of [['dead-false',/\{\s*false\s*&&/],['dead-boolean',/Boolean\(\s*0\s*\)/],['duplicate-nfd',/\.normalize\(\s*['"]NFD['"]\s*\)/]]){
  const hits=files.filter(f=>!(id==='duplicate-nfd'&&f.endsWith(path.join('utils','vietnamese-match.ts')))&&re.test(fs.readFileSync(f,'utf8')));
  check(id,hits.length===0,hits.map(f=>path.relative(root,f)));
}
check('removed-tab',!fs.existsSync(path.join(root,'src/components/homework-auto-grader-tab.tsx')),{});
check('shared-types',['CriterionGradeItem','GradingCriterion','GradingRubric','SubmissionRowItem'].every(t=>fs.readFileSync(path.join(root,'src/lib/types/index.ts'),'utf8').includes(`interface ${t}`)),{});
check('configs-preserved',['grading_rubrics.json','zalo_templates.json'].every(n=>fs.existsSync(path.join(root,'data/config',n))),fs.readdirSync(path.join(root,'data/config')));
// Invoke actual generators and intercept the exact Google boundary. No live AI call occurs.
let captured=[];
const clientPath=req.resolve('./src/lib/gemini/client.ts');
req.cache[clientPath]={id:clientPath,filename:clientPath,loaded:true,exports:{getGeminiModel:()=>({generateContent:async payload=>{captured.push(payload);throw new Error('AUDIT_CAPTURE_STOP');}})}};
const dbmod=req('./src/lib/db/sqlite.ts');
const db=dbmod.getDb();
const cid='VT-C4K-PTA_AUDIT';
for(const student of roster){
  dbmod.studentRepo.upsert({classId:cid,studentId:student.studentId,fullName:student.fullName,isActive:1});
}
db.prepare('INSERT OR REPLACE INTO classes_sessions (classId,className,sessionId,sessionNumber,topic,date) VALUES (?,?,?,?,?,?)').run(cid,cid,`${cid}_SESS_14`,14,'Tổng kết','30/10/2026');
const cg=req('./src/lib/gemini/comment-generator.ts');
const hw=req('./src/lib/gemini/homework-grader.ts');
const s14=req('./src/lib/gemini/session14-course-summary.ts');
const spck=req('./src/lib/gemini/spck-comment.ts');
const teaching=req('./src/lib/gemini/teaching-project-generator.ts');
const rubric={rubricId:'AUDIT',courseCode:'PTA',sessionNumber:2,assignmentTitle:'Python',assignmentPrompt:'In kết quả',maxTotalScore:100,criteria:[{criterionId:'C1',name:'Kết quả',description:'In',maxPoints:100,expectedSnippetOrConcept:'print'}]};
async function runGenerator(label,student,note){
  captured=[];
  let result,error;
  try{
    if(label==='comment') result=await cg.CommentGenerator.generateBatchComments({classId:cid,classCode:cid,sessionId:`${cid}_SESS_2`,sessionNumber:2,topic:'Python'},[{...student,attendanceStatus:'PRESENT',teacherNote:note}]);
    if(label==='homework') result=await hw.HomeworkAiGrader.gradeSingleSubmission({classId:cid,sessionId:`${cid}_SESS_2`,studentId:student.studentId,fullName:student.fullName,submissionId:`SUB_${student.studentId}_${observations.length}`,parsedContent:{parseStatus:'PARSED',subjectType:'PYTHON',fileName:'main.py',extractedText:note,inlineDataParts:[],fileHash:'audit'}},rubric,{peerRoster:roster});
    if(label==='session14') result=await s14.Session14CourseSummaryGenerator.generateBatch(cid,[{...student,teacherNote:note,quickTags:['Chủ động làm bài']}]);
    if(label==='spck') result=await spck.SpckCommentGenerator.generateBatchSpckComments({classId:cid,sessionNumber:14},[{...student,teacherNote:note,projectTitle:'Ứng dụng Python',attachments:[],screenshots:[]}]);
    if(label==='teaching') result=await teaching.generateTeachingProjectTasksWithAI({classCode:cid,courseName:'Python',teacherHint:note,studentNamesToRedact:names,endDate:'2026-11-01',mockAiExecutor:async prompt=>{captured.push(prompt);throw new Error('AUDIT_CAPTURE_STOP');}});
  }catch(e){error=String(e);}
  return {captured:JSON.parse(JSON.stringify(captured)),error,result};
}
async function main(){
  const variants=['Nguyễn Minh Khôi cùng Trần Minh Khôi, Thị Ý, Ý và Y hoàn thành bài.', 'Nguyen Minh Khoi cùng Tran Minh Khoi hoàn thành bài.', 'Nguyen_Minh_Khoi.py; Tran_Minh_Khoi.py; Le_Thi_Y.py; Pham_Van_Y.py', 'NguyenMinhKhoi.py; TranMinhKhoi.py; LeThiY.py; PhamVanY.py'];
  for(const label of ['comment','homework','session14','spck','teaching']){
    for(const [i,note] of variants.entries()){
      const r=await runGenerator(label,roster[0],note);
      check(`${label}-${i}-boundary`,r.captured.length===1,{error:r.error,result:r.captured.length?undefined:r.result});
      const payload=JSON.stringify(r.captured);
      const leaks=['Nguyễn Minh Khôi','Trần Minh Khôi','Thị Ý','Nguyen Minh Khoi','Tran Minh Khoi','Nguyen_Minh_Khoi','Tran_Minh_Khoi','Le_Thi_Y','Pham_Van_Y','NguyenMinhKhoi','TranMinhKhoi','LeThiY','PhamVanY'].filter(s=>payload.includes(s));
      check(`${label}-${i}-privacy`,r.captured.length===1&&leaks.length===0,{leaks,payload:r.captured});
      if(label==='spck'&&i>=2){
        check(`${label}-${i}-one-char-filename`,!/(?:STUDENT_(?:PEER|\d+))_?Y\.py/.test(payload),{payload:r.captured});
      }
    }
  }
  // Actual React rendering of both settings tabs and navbar with network-free hook stubs.
  const esbuild=req('esbuild'), vm=require('node:vm');
  const React=req('react'), ReactDOM=req('react-dom/server');
  function component(file,tab='courses'){
    let n=0;
    const mockReact={...React,useState:init=>{const index=n++;return [index===0?tab:index===1?[{courseCode:'AUDIT',courseName:'Python Audit',description:'Dữ liệu giả',sessions:[{sessionNumber:1,topic:'Python',keyKnowledge:['Biến'],homeworkBrief:'Bài tập'}]}]:index===3?[{category:'AUDIT',categoryName:'Nhận xét thử',tags:[]}]:index===4?false:typeof init==='function'?init():init,()=>{}]},useEffect:()=>{},useCallback:fn=>fn,useRef:v=>({current:v})};
    const module={exports:{}};
    const js=esbuild.transformSync(fs.readFileSync(path.join(root,file),'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic',target:'es2022'}).code;
    vm.runInNewContext(js,{module,exports:module.exports,require:id=>id==='react'?mockReact:id==='next/navigation'?{usePathname:()=>'/syllabus-config'}:id==='next/link'?{__esModule:true,default:({href,children,...props})=>React.createElement('a',{href,...props},children)}:req(id),console});
    return ReactDOM.renderToStaticMarkup(React.createElement(module.exports.default||module.exports.TopNavbar));
  }
  const navbar=component('src/components/top-navbar.tsx','light');
  const courses=component('src/app/syllabus-config/page.tsx');
  const tags=component('src/app/syllabus-config/page.tsx','quickTags');
  fs.writeFileSync(process.env.AUDIT_HTML_OUT,JSON.stringify({navbar,courses,tags},null,2));
  const nav=navbar.match(/<nav[\s\S]*?<\/nav>/)?.[0]||'';
  check('navbar-five-links',(nav.match(/<a /g)||[]).length===5&&!nav.includes('/syllabus-config'),{nav});
  check('navbar-settings-right',navbar.indexOf('href="/syllabus-config"')>navbar.indexOf('</nav>')&&navbar.includes('Cài đặt'),{navbar});
  check('syllabus-two-tabs',[courses,tags].every(h=>h.includes('Giáo trình')&&h.includes('Quick Tags')&&!h.includes('Barem')&&!h.includes('Mẫu Zalo')),{courses,tags});
  dbmod.closeDb();
  fs.writeFileSync(process.env.AUDIT_RESULT_OUT,JSON.stringify({total:observations.length,passed:observations.filter(x=>x.pass).length,failed:observations.filter(x=>!x.pass).length,observations},null,2));
  console.log(JSON.stringify({total:observations.length,failed:observations.filter(x=>!x.pass).map(x=>({id:x.id,detail:x.detail.leaks||x.detail.output||x.detail}))},null,2));
  process.exitCode=observations.every(x=>x.pass)?0:1;
}
main().catch(e=>{console.error(e);dbmod.closeDb();process.exitCode=2;});
