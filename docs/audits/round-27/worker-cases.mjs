// Expectations are the selected operation's actual bound arguments, not text resembling GraphQL.
export function createR27WorkerCases(cid,sid) {
  const input=feedback=>({classId:cid,sessionId:sid,submissionId:'SUB1',studentId:'S1',score:80,decision:'GRADE',feedback:feedback??'APPROVED FEEDBACK'});
  const cases=[];
  const add=(label,query,variables,expected=0,feedback='APPROVED FEEDBACK',response={data:{saved:{id:'SUB1'}}})=>cases.push({id:'R27-09-'+label,request:{operationName:'SaveHomeworkGrade',query,variables},response,expected,feedback});
  const bound='mutation SaveHomeworkGrade($input:GradeInput!) { saved:saveHomeworkGrade(input:$input) { id } }';
  add('control-bound',bound,{input:input()},1);
  for(const [label,feedback]of [['unpaired-open','APPROVED { FEEDBACK'],['unpaired-close','APPROVED } FEEDBACK'],['hash-newline','APPROVED #\nFEEDBACK'],['nested-parenthesis','APPROVED ) ( FEEDBACK'],['escaped-quote','APPROVED " FEEDBACK'],['sentinel-text','__GQL_STR_0__']]) {
    const args=`classId:${JSON.stringify(cid)},sessionId:${JSON.stringify(sid)},submissionId:"SUB1",studentId:"S1",score:80,decision:GRADE,feedback:${JSON.stringify(feedback)}`;
    add('literal-'+label,`mutation SaveHomeworkGrade { saved:saveHomeworkGrade(${args}) { id } }`,{},1,feedback);
    add('bound-'+label,bound,{input:input(feedback)},1,feedback);
  }
  const prefix=`classId:${JSON.stringify(cid)},sessionId:${JSON.stringify(sid)},submissionId:"SUB1",studentId:"S1",decision:GRADE`;
  add('literal-exponent-score',`mutation SaveHomeworkGrade { saved:saveHomeworkGrade(${prefix},score:8e1,feedback:"APPROVED FEEDBACK") { id } }`,{},1);
  add('literal-block-string',`mutation SaveHomeworkGrade { saved:saveHomeworkGrade(${prefix},score:80,feedback:"""APPROVED FEEDBACK""") { id } }`,{},1);
  add('literal-block-string-braces',`mutation SaveHomeworkGrade { saved:saveHomeworkGrade(${prefix},score:80,feedback:"""APPROVED { FEEDBACK""") { id } }`,{},1,'APPROVED { FEEDBACK');
  add('nested-selection',bound.replace('{ id }','{ id submission { id } }'),{input:input()},1,'APPROVED FEEDBACK',{data:{saved:{id:'SUB1',submission:{id:'SUB1'}}}});
  add('deep-nested-selection',bound.replace('{ id }','{ id submission { student { id } } }'),{input:input()},1,'APPROVED FEEDBACK',{data:{saved:{id:'SUB1',submission:{student:{id:'S1'}}}}});
  add('comment-bound',bound.replace('saved:','# fake saveHomeworkGrade(input:$wrong)\n saved:'),{input:input()},1);
  add('multi-operation-selected',`query ReadHomework { ignored:previewHomework { id } } ${bound}`,{input:input()},1);
  add('selected-query',bound.replace('mutation','query'),{input:input()});
  add('wrong-bound-variable',bound,{input:{...input(),submissionId:'OTHER'},unused:input()});
  add('no-referenced-variable',bound,{unused:input()});
  add('unreferenced-conflict',bound,{input:input(),unused:{submissionId:'OTHER',score:1}},1);
  for(const root of ['deleteAttachment','previewHomework'])for(const quote of ['"','"""']) {
    const fake='mutation SaveHomeworkGrade { saved:saveHomeworkGrade(input:$input) { id } }';
    add('quoted-decoy-'+root+'-'+quote.length,`mutation SaveHomeworkGrade { saved:${root}(note:${quote}${fake}${quote}) { id } }`,{input:input()});
    // A legal unescaped quote within a block string must not end that block string.
    if(quote.length===3)add('block-quote-decoy-'+root,`mutation SaveHomeworkGrade { saved:${root}(note:"""a " ${fake} " b""") { id } }`,{input:input()});
  }
  add('placeholder-enum-decoy',`mutation SaveHomeworkGrade { saved:saveHomeworkGrade(note:"APPROVED FEEDBACK",${prefix},score:80,feedback:__GQL_STR_0__) { id } }`,{});
  add('wrong-response-alias',bound,{input:input()},0,'APPROVED FEEDBACK',{data:{saveHomeworkGrade:{id:'SUB1'}}});
  return cases;
}
