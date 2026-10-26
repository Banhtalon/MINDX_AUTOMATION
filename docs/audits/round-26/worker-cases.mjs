// Independent GraphQL contract fixtures, with exact approved feedback and strict expected outcome.
export function createR26WorkerCases(cid,sid) {
  const input=()=>({classId:cid,sessionId:sid,submissionId:'SUB1',studentId:'S1',score:80,decision:'GRADE',feedback:'APPROVED FEEDBACK'});
  const bound=i=>({operationName:'SaveHomeworkGrade',query:'mutation SaveHomeworkGrade($input:GradeInput!) { saved:saveHomeworkGrade(input:$input) { id } }',variables:{input:i}});
  const cases=[];
  const add=(name,request,response,expected=0,feedback='APPROVED FEEDBACK')=>cases.push({id:'R26-09-'+name,request,response,expected,feedback});
  add('control-all-synonyms',bound(input()),{data:{saved:{submissionId:'SUB1',id:'SUB1',_id:'SUB1',studentId:'S1',studentUid:'S1',classId:cid,classCode:cid,sessionId:sid,score:80,decision:'GRADE',status:'GRADED',feedback:'APPROVED FEEDBACK',comment:'APPROVED FEEDBACK',teacherNote:'APPROVED FEEDBACK',feedbackHtml:'<p>APPROVED FEEDBACK</p>'}}},1);
  for(const key of ['submissionId','id','_id','studentId','studentUid','classId','classCode','sessionId','score','decision','status','feedback','comment','teacherNote','feedbackHtml']) {
    add('response-null-'+key,bound(input()),{data:{saved:{success:true,...input(),[key]:null}}});
    add('request-container-'+key,bound({...input(),[key]:{value:'OTHER'},decoy:input()}),{data:{saved:true}});
  }
  for(const [name,feedback]of [['hash','APPROVED # FEEDBACK'],['quote','APPROVED " FEEDBACK'],['parentheses','APPROVED ( FEEDBACK )'],['braces','APPROVED { FEEDBACK }'],['brace-open','APPROVED { FEEDBACK'],['close-brace','APPROVED } FEEDBACK'],['backslash','APPROVED \\ FEEDBACK'],['unicode','Đã làm đúng # cần luyện thêm']]) {
    const args=`classId:${JSON.stringify(cid)},sessionId:${JSON.stringify(sid)},submissionId:"SUB1",studentId:"S1",score:80,decision:GRADE,feedback:${JSON.stringify(feedback)}`;
    add('literal-'+name,{operationName:'SaveHomeworkGrade',query:`mutation SaveHomeworkGrade { saved:saveHomeworkGrade(${args}) { id } }`,variables:{}},{data:{saved:{id:'SUB1',score:80,feedback}}},1,feedback);
    add('variable-'+name,bound({...input(),feedback}),{data:{saved:{id:'SUB1',score:80,feedback}}},1,feedback);
  }
  add('comment-with-spoofed-keys',{...bound(input()),query:'mutation SaveHomeworkGrade($input:GradeInput!) { # score:1 submissionId:"OTHER"\n saved:saveHomeworkGrade(input:$input) { id } }'},{data:{saved:true}},1);
  add('alias-other-result',bound(input()),{data:{saveGrade:true}});
  add('error-array',bound(input()),{data:{saved:true},errors:[{message:'DENIED'}]});
  add('object-no-confirmation',bound(input()),{data:{saved:{message:'ok'}}});
  add('selected-query',{...bound(input()),query:'query SaveHomeworkGrade($input:GradeInput!) { saved:saveHomeworkGrade(input:$input) { id } }'},{data:{saved:true}});
  // The selected real root is not a grade mutation. The apparent grade operation exists only inside a string.
  add('quoted-operation-decoy',{operationName:'SaveHomeworkGrade',query:'mutation SaveHomeworkGrade { saved:deleteAttachment(note:"mutation SaveHomeworkGrade { saved:saveHomeworkGrade(input:$input) { id } }") { id } }',variables:{input:input()}},{data:{saved:{id:'SUB1'}}});
  add('quoted-operation-preview-decoy',{operationName:'SaveHomeworkGrade',query:'mutation SaveHomeworkGrade { saved:previewHomework(note:"mutation SaveHomeworkGrade { saved:saveHomeworkGrade(input:$input) { id } }") { id } }',variables:{input:input()}},{data:{saved:{id:'SUB1'}}});
  return cases;
}
