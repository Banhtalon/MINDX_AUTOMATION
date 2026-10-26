// Additional Round 21 assertions. All expectations describe SAFE behavior.
// The self-contained verify-independent.mjs includes the unchanged product-body VM harness.
const fullMutation=(patch={})=>({operationName:'SaveHomeworkGrade',query:'mutation SaveHomeworkGrade { saveHomeworkGrade }',variables:{studentId:'S1',submissionId:'SUB1',classId:cid,sessionId:sid,score:80,decision:'GRADE',feedback:'APPROVED FEEDBACK'},...patch});
const strictWorker=opt=>workerScenario({apiBody:fullMutation(),readbackFeedback:'APPROVED FEEDBACK',...opt});
const columns=[{columnId:'L1',lessonId:'L1',sessionNumber:1,colIndex:0},{columnId:'L2',lessonId:'L2',sessionNumber:2,colIndex:1}];
const uiItem = row => ({...row,criteriaGrades:JSON.parse(row.criteriaGradesJson),fullName:'Synthetic'});
// b.req seeds a single-submission request; remove that synthetic default for real bulk mode.
const approvalRequest = (b,body) => b.req({...body,...(body.approveAll?{submissionId:''}:{})});
async function expectInvalidImage(ext,data){
  let decoderError='';try{await sharp(data).raw().toBuffer();}catch(e){decoderError=e.message;}
  assert(decoderError,'Independent decoder must prove that the fixture is invalid');
  const r=parse(data,'bad.'+ext),o={bytes:data.length,decoderError,parseStatus:r.parseStatus,inlineParts:r.inlineDataParts.length};
  expect(r.parseStatus==='PARSE_ERROR'&&r.inlineDataParts.length===0,o,'Undecodable media still reaches multimodal grading');return o;
}
try {
  for(const ext of ['png','jpg','webp','pdf'])await check('R21-01-valid-'+ext,'Media hợp lệ vẫn giữ nguyên bytes',()=>{
    const data=inlineMedia[ext],r=parse(data,'valid.'+ext);assert.equal(r.parseStatus,'PARSED');assert.equal(Buffer.compare(Buffer.from(r.inlineDataParts[0].inlineData.data,'base64'),data),0);return{bytes:data.length};
  });
  const png=Buffer.from(inlineMedia.png);let offset=8;
  while(offset<png.length){const n=png.readUInt32BE(offset);if(png.toString('ascii',offset+4,offset+8)==='IDAT'){png.fill(0x41,offset+8,offset+8+n);break;}offset+=n+12;}
  await check('R21-01-png-invalid-idat','IHDR/IDAT/IEND đầy đủ nhưng nội dung nén hỏng phải bị chặn',()=>expectInvalidImage('png',png));
  const jpg=Buffer.from([255,216,255,224,0,4,0,0,255,192,0,2,255,218,0,2,1,2,3,4,255,217]);
  await check('R21-01-jpeg-empty-sof','SOF/SOS có tên nhưng thiếu kích thước/thành phần ảnh phải bị chặn',()=>expectInvalidImage('jpg',jpg));
  for(const fourcc of ['VP8 ','VP8L','VP8X'])await check('R21-01-webp-'+fourcc.trim(),'Container RIFF đúng nhưng payload không phải ảnh phải bị chặn',()=>{
    const data=Buffer.alloc(30);data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WEBP',8);data.write(fourcc,12);data.writeUInt32LE(10,16);data.fill(65,20);return expectInvalidImage('webp',data);
  });
  await check('R21-01-pdf-token-spoof','PDF chỉ chứa các từ khóa, không có đối tượng/trang hợp lệ, phải PARSE_ERROR',()=>{
    const data=Buffer.from('%PDF-1.4\nnot-an-object endobj %%EOF obj\nTHIS IS NOT A PDF');
    assert(!/\d+\s+\d+\s+obj\b/.test(data.toString()));const r=parse(data,'invalid.pdf');
    const o={bytes:data.length,parseStatus:r.parseStatus,inlineParts:r.inlineDataParts.length};expect(r.parseStatus==='PARSE_ERROR',o,'Keyword-only fake PDF accepted');return o;
  });
  await check('R21-02-rubric-integrity','Barem trùng và điểm thiếu bằng chứng vẫn bị chặn',()=>{
    assert.equal(auditor.auditCriterionGrades(grades(),{...rubric,criteria:[...rubric.criteria,...rubric.criteria]}).valid,false);
    assert.equal(auditor.auditCriterionGrades([{...grades()[0],evidenceSnippet:''}],rubric).valid,false);
  });
  await check('R21-03-content-hash','Hash khóa toàn bộ file/tiêu chí/điểm/quyết định/nhận xét',()=>{const b=backend();try{
    const r=record();r.contentHash=b.computeHomeworkContentHash(r);assert(b.verifyHomeworkContentIntegrity(r));
    for(const patch of [{fileHash:'different'},{feedbackHtml:'different'},{decision:'REDO'},{calculatedScore:90},{criteriaGradesJson:'[]'},{teacherOverrideScore:90}])assert.equal(b.verifyHomeworkContentIntegrity({...r,...patch}),false);
  }finally{b.db.close();}});
  for(const mode of ['unchanged','before','during','deleted','supplied-during'])await check('R21-04-disk-'+mode,'Đề xuất AI phải gắn cùng phiên bản bytes trên đĩa',async()=>{const b=backend();try{
    const p=path.join(work,'physical-'+mode+'.py');fs.writeFileSync(p,'print(1)');const oldHash=sha(fs.readFileSync(p));b.seed({localFilePath:p,fileHash:oldHash});
    const before=JSON.stringify(b.row());const supplied=mode==='supplied-during'?parser.parseSubmissionFile(p):undefined;
    if(mode==='before')fs.writeFileSync(p,'print(2)');let calls=0;
    const g=loadGrader(b,async()=>{calls++;if(mode==='during'||mode==='supplied-during')fs.writeFileSync(p,'print(2)');if(mode==='deleted')fs.unlinkSync(p);return aiResponse();});
    const result=await g.HomeworkAiGrader.gradeSingleSubmission(candidate({parsedContent:supplied,localFilePath:p}),rubric);
    const o={calls,staleIgnored:result.staleIgnored??false,status:b.row().status,dbHash:b.row().fileHash,diskHash:fs.existsSync(p)?sha(fs.readFileSync(p)):null};
    if(['during','deleted','supplied-during'].includes(mode))expect(result.staleIgnored===true&&JSON.stringify(b.row())===before,o,'AI response committed after physical-file drift');
    else {assert.equal(result.staleIgnored??false,false);assert.equal(b.row().fileHash,o.diskHash);assert.equal(b.row().status,'WAITING_APPROVAL');}return o;
  }finally{b.db.close();}});
  await check('R21-05-no-rubric-draft','Chưa có barem khóa thì không tự tạo barem từ điểm',async()=>{const b=backend();try{
    b.seed({criteriaGradesJson:'[]',status:'PENDING'});const res=await b.draft.POST(b.req({criteriaGrades:grades()}));assert.equal(res.status,400);assert.equal(b.row().criteriaGradesJson,'[]');
  }finally{b.db.close();}});
  await check('R21-05-explicit-rubric','API duyệt đối chiếu barem được truyền thay vì tự tin danh sách điểm',async()=>{const b=backend();try{
    b.seed({criteriaGradesJson:JSON.stringify([{...grades()[0],criterionId:'UNRELATED'}])});const res=await b.approve(b.req({rubric,fileHash:b.row().fileHash}));assert.equal(res.status,400);assert.notEqual(b.row().status,'APPROVED');
  }finally{b.db.close();}});
  await check('R21-05-ui-authoritative-rubric','Barem đang chọn trên UI phải được áp dụng khi duyệt',async()=>{const b=backend();try{
    b.seed({criteriaGradesJson:'[]',status:'PENDING'});const forgedGrades=[{...grades()[0],criterionId:'UNRELATED'}];
    const forgedRubric={...rubric,criteria:[{...rubric.criteria[0],criterionId:'UNRELATED'}]};
    const draft=await b.draft.POST(b.req({criteriaGrades:forgedGrades,rubric:forgedRubric,feedbackHtml:'APPROVED FEEDBACK'}));
    assert.equal(draft.status,200);let sent;
    const h=ui(async(url,opts)=>{if(url.includes('/approve')){sent=JSON.parse(opts.body);return b.approve(b.req(sent));}return Response.json({success:true,data:{submissions:[uiItem(b.row())]}});},{initialRubrics:[rubric]});
    await h.flush();assert.equal(h.api.activeRubric.criteria[0].criterionId,'C1');
    const approved=await h.api.handleApproveSubmission(h.api.submissions[0]);await h.flush();
    const o={draftHttp:draft.status,approved,status:b.row().status,selectedRubric:h.api.activeRubric.criteria.map(c=>c.criterionId),storedCriteria:JSON.parse(b.row().criteriaGradesJson).map(c=>c.criterionId),requestHasRubric:Boolean(sent?.rubric)};
    expect(!approved&&b.row().status!=='APPROVED',o,'UI approved criteria outside the currently selected authoritative rubric');return o;
  }finally{b.db.close();}});
  for(const mode of ['fresh','stale','omitted','bulk'])await check('R21-06-version-'+mode,'Duyệt đơn/hàng loạt phải chứng minh đúng file giáo viên đã xem',async()=>{const b=backend();try{
    b.seed({fileHash:'reviewed-v1'});const item=uiItem(b.row());let requestBody;
    const h=ui(async(url,opts)=>{if(url.includes('/approve')){requestBody=JSON.parse(opts.body);return b.approve(approvalRequest(b,requestBody));}return Response.json({success:true,data:{submissions:[uiItem(b.row())]}});});await h.flush();
    if(mode!=='fresh')b.homeworkSubmissionRepo.upsert({...b.row(),fileHash:'new-v2',status:'WAITING_APPROVAL'});
    let res;
    if(mode==='bulk'){res=await h.api.handleApproveAll();}
    else if(mode==='omitted'){const reply=await b.approve(b.req({feedbackHtml:item.feedbackHtml,criteriaGrades:item.criteriaGrades,decision:item.decision}));res=reply.status;}
    else {res=await h.api.handleApproveSubmission(h.api.submissions[0]);}
    const o={mode,result:res,status:b.row().status,currentHash:b.row().fileHash,requestBody};
    if(mode==='fresh')assert.equal(b.row().status,'APPROVED');else expect(b.row().status!=='APPROVED',o,'Approval signed a different file version without review');return o;
  }finally{b.db.close();}});
  await check('R21-07-exact-identity','Khớp một phần mã học viên/bài nộp không được ghi',async()=>{for(const modalText of ['S10 SUB1','S1 SUB10','Học Viên Mẫu','']){const r=await strictWorker({modalText});assert.equal(r.writes,0);assert.equal(r.verified,0);}});
  for(const mode of ['valid','mismatch','missing'])await check('R21-08-mapping-'+mode,'Chỉ ghi khi lesson và session có ánh xạ xác minh',async()=>{
    if(mode==='mismatch'){await assert.rejects(()=>strictWorker({columns,options:{lessonId:'L2'}}),/Integrity Violation/);return;}
    const r=await strictWorker({...(mode==='valid'?{columns}:{}),options:{lessonId:'L1'}});assert.equal(r.writes,mode==='valid'?1:0);assert.equal(r.verified,mode==='valid'?1:0);return{writes:r.writes,verified:r.verified};
  });
  for(const field of ['submissionId','studentId','score','feedback'])await check('R21-09-required-'+field,'Thiếu trường nghiệp vụ bắt buộc không được xác nhận lưu',async()=>{
    const body=fullMutation();delete body.variables[field];const r=await strictWorker({apiBody:body});assert.equal(r.verified,0);return{verified:r.verified};
  });
  for(const [name,query,operationName] of [
    ['plain-query','query GradeSummary { studentSubmission { id } }','GradeSummary'],
    ['comment-query','# mutation\nquery SaveHomeworkGrade { studentSubmission { id } }','SaveHomeworkGrade'],
    ['other-mutation','mutation SaveHomeworkGrade($submissionId: ID!) { saveSubmissionAttachment(submissionId: $submissionId) { id } }','SaveHomeworkGrade'],
    ['selected-query','mutation Unselected { saveHomeworkGrade } query GradeLookup { studentSubmission { id } }','GradeLookup']
  ])await check('R21-09-operation-'+name,'Tên thao tác/payload đúng không được thay thế kiểm tra thao tác GraphQL thực tế',async()=>{
    const body=fullMutation({query,operationName});const r=await strictWorker({apiBody:body});const o={verified:r.verified,writes:r.writes,query,operationName};expect(r.verified===0,o,'A non-grading GraphQL operation confirmed the grade');return o;
  });
  await check('R21-09-hostname','Hostname thật được dùng khi lọc phản hồi',async()=>{
    const w=await strictWorker();const N=mod('src/lib/playwright/network-interceptor.ts',['NetworkInterceptor'],{SELECTORS}).NetworkInterceptor;
    const observations=[];for(const [url,expected]of [['https://lms-api.mindx.edu.vn/',true],['https://unrelated.invalid/?return=mindx.edu.vn',false],['https://mindx.edu.vn.evil.invalid/',false]]){
      let matched=false;const response={url:()=>url,status:()=>200,json:async()=>({data:{saveGrade:true}}),request:()=>({method:()=> 'POST',postData:()=>JSON.stringify(fullMutation())})};
      await new N({waitForResponse:async f=>{matched=f(response);return response;}}).waitForApiResponse(w.apiOptions.url,{method:'POST',requestPredicate:w.predicate});assert.equal(matched,expected);observations.push({url,matched});
    }return observations;
  });
  await check('R21-09-phase4-host-token','Hợp đồng chuỗi URL lms-api mà R12 kiểm tra vẫn phải đạt cổng hồi quy',async()=>{
    const N=mod('src/lib/playwright/network-interceptor.ts',['NetworkInterceptor'],{SELECTORS}).NetworkInterceptor;
    let matched=false;const response={url:()=> 'https://lms-api.mindx.edu.vn/',status:()=>200,json:async()=>({data:{}}),request:()=>({method:()=> 'POST',postData:()=>JSON.stringify({operationName:'SaveSlotComment'})})};
    await new N({waitForResponse:async f=>{matched=f(response);return response;}}).waitForApiResponse('lms-api',{method:'POST',operationName:'SaveSlotComment'});
    const o={filter:'lms-api',url:response.url(),matched};expect(matched,o,'The legacy phase-4 URL filter can no longer match its legitimate hostname');return o;
  });
  for(const [name,opt]of [['complete',{}],['empty',{readbackFeedback:''}],['unreadable',{readbackError:true}],['wrong-decision',{readbackDecision:'REDO'}],['wrong-feedback',{readbackFeedback:'WRONG'}],['redo-complete',{seed:{decision:'REDO'},readbackDecision:'REDO',apiBody:fullMutation({variables:{studentId:'S1',submissionId:'SUB1',decision:'REDO',feedback:'APPROVED FEEDBACK'}})}]])
    await check('R21-10-readback-'+name,'Chỉ VERIFIED khi nhận xét và quyết định đọc lại khớp',async()=>{const r=await strictWorker(opt);assert.equal(r.verified,['complete','redo-complete'].includes(name)?1:0);return{verified:r.verified,radioReads:r.radioReads,modalReads:r.modalReads};});
  await check('R21-11-final-cas','Chỉnh sửa trong lúc đọc lại không được nâng VERIFIED',async()=>{
    const r=await strictWorker({duringReadback:b=>b.homeworkSubmissionRepo.upsert({...b.row(),feedbackHtml:'NEW EDIT',status:'WAITING_APPROVAL',contentHash:''})});assert.equal(r.verified,0);assert.equal(r.status,'WAITING_APPROVAL');
  });
  await check('R21-12-scope-race','Phản hồi buổi cũ đến muộn không ghi đè buổi mới',async()=>{
    const hold=defer();const h=ui(async url=>{if(url.includes('_SESS_01')){await hold.promise;return Response.json({success:true,data:{submissions:[uiItem(record())]}});}return Response.json({success:true,data:{submissions:[uiItem(record({sessionId:cid+'_SESS_02',submissionId:'SUB2'}))]}});});
    await h.flush();h.api.setSelectedSessionNumber(2);await h.flush();hold.resolve();await h.flush();assert.equal(h.api.submissions[0].submissionId,'SUB2');
  });
  await check('R21-13-old-success-new-failure','Phản hồi thành công cũ không xóa cờ bản mới thất bại',async()=>{
    const hold=defer();let saves=0,approvals=0;const item=uiItem(record());const h=ui(async(url,opts)=>{
      if(url.includes('/approve')){approvals++;return Response.json({success:false},{status:409});}
      if(opts?.method==='POST'){if(++saves===1){await hold.promise;return Response.json({success:true});}return Response.json({success:false},{status:500});}
      return Response.json({success:true,data:{submissions:[item]}});
    });await h.flush();const first=h.api.handleFieldUpdate(h.api.submissions[0],{feedbackHtml:'FIRST'});await h.flush();await h.api.handleFieldUpdate(h.api.submissions[0],{feedbackHtml:'LATEST'});await h.flush();hold.resolve();await first;await h.flush();
    await h.api.handleApproveAll();assert.equal(approvals,0);assert.equal(h.api.unsavedSubIds.SUB1,true);
  });
  await check('R21-13-reordered-successes','Hai lần lưu đều 200 nhưng đến máy chủ ngược thứ tự không được duyệt bản cũ',async()=>{const b=backend();try{
    b.seed();const hold=defer();let saves=0,approvals=0;
    const h=ui(async(url,opts)=>{
      if(url.includes('/approve')){approvals++;return b.approve(approvalRequest(b,JSON.parse(opts.body)));}
      if(opts?.method==='POST'){const body=JSON.parse(opts.body);if(++saves===1)await hold.promise;return b.draft.POST(b.req(body));}
      return Response.json({success:true,data:{submissions:[uiItem(b.row())]}});
    });await h.flush();const first=h.api.handleFieldUpdate(h.api.submissions[0],{feedbackHtml:'FIRST OLD'});await h.flush();await h.api.handleFieldUpdate(h.api.submissions[0],{feedbackHtml:'LATEST REVIEWED'});await h.flush();hold.resolve();await first;await h.flush();
    const before={visible:h.api.submissions[0].feedbackHtml,stored:b.row().feedbackHtml,unsaved:structuredClone(h.api.unsavedSubIds)};await h.api.handleApproveAll();await h.flush();
    const o={before,approvals,status:b.row().status,stored:b.row().feedbackHtml,visible:h.api.submissions[0].feedbackHtml};
    expect(!(b.row().status==='APPROVED'&&b.row().feedbackHtml!=='LATEST REVIEWED'),o,'A successful older save overwrote the newer draft and bulk approval signed it');return o;
  }finally{b.db.close();}});
  await check('R21-14-download-error','Tải lỗi không được gọi AI, kể cả skipAi',async()=>{const b=backend();try{
    b.seed();let calls=0;const route=mod('src/app/api/homework-grader/download-and-grade/route.ts',['POST'],{...b,...local,NextResponse:Response,taskQueue:{enqueue:async t=>t.execute()},SubmissionDownloader:{downloadLessonSubmissions:async()=>({success:false,error:'synthetic',items:[]})},HomeworkAiGrader:{gradeBatchSubmissions:async()=>{calls++;return[];}},getGradingRubrics:()=>[rubric],findLessonInSyllabus:()=>null});
    for(const skipAi of [false,true]){const res=await route.POST(b.req({rubric,skipAi}));assert.equal(res.status,502);assert.equal(calls,0);}
  }finally{b.db.close();}});
} finally {
  process.chdir(previousCwd);
  const sourceFiles=['src/lib/file-parsers/media-reader.ts','src/lib/gemini/homework-grader.ts','src/lib/gemini/score-auditor.ts','src/lib/db/sqlite.ts','src/lib/playwright/download-submissions.ts','src/lib/playwright/grade-worker.ts','src/lib/playwright/network-interceptor.ts','src/app/api/homework-grader/submissions/route.ts','src/app/api/homework-grader/approve/route.ts','src/components/homework-auto-grader-tab.tsx'];
  const summary={checkedAt:new Date().toISOString(),sourceRoot:root,fixtureWorkspace:work,sqlite:':memory:',realLmsCalls:0,realGeminiCalls:0,method:'Actual product function bodies loaded from snapshot; explicit VM doubles for DOM/Gemini; real in-memory SQLite and physical synthetic files. Independent decoder sharp checks malformed image fixtures. No browser or real React scheduling claim.',sourceHashes:Object.fromEntries(sourceFiles.map(f=>[f,sha(read(f))])),total:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
  fs.writeFileSync(path.join(out,'independent-results.json'),JSON.stringify(summary,null,2)+'\n');
  console.log('SUMMARY '+JSON.stringify({total:summary.total,passed:summary.passed,failed:summary.failed}));if(summary.failed)process.exitCode=1;
}
