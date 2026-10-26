// Independent R28 cases. Expectations describe actual values, not product tokenization.
export function createR28WorkerCases(cid,sid) {
  const cases=[], feedback='APPROVED FEEDBACK';
  const input={classId:cid,sessionId:sid,submissionId:'SUB1',studentId:'S1',score:80,decision:'GRADE',feedback};
  const prefix=`classId:${JSON.stringify(cid)},sessionId:${JSON.stringify(sid)},submissionId:"SUB1",studentId:"S1",decision:GRADE`;
  const query=(fb='"APPROVED FEEDBACK"',score='80')=>`mutation SaveHomeworkGrade { saved:saveHomeworkGrade(${prefix},score:${score},feedback:${fb}) { id } }`;
  const add=(label,q,expected=1,fb=feedback,variables={})=>cases.push({id:'R28-09-'+label,request:{operationName:'SaveHomeworkGrade',query:q,variables},response:{data:{saved:{id:'SUB1'}}},expected,feedback:fb});
  for(const n of ['8E1','8e+1','80.0','0.8e2','800e-1'])add('number-'+n.replace(/[^a-z0-9]/gi,'_'),query(undefined,n));
  for(const [label,raw,actual] of [
    ['block-two-lines','"""\n    APPROVED\n    FEEDBACK\n"""','APPROVED\nFEEDBACK'],
    ['block-two-lines-crlf','"""\r\n    APPROVED\r\n    FEEDBACK\r\n"""','APPROVED\nFEEDBACK'],
    ['block-uneven-indent','"""\n    APPROVED\n      FEEDBACK\n"""','APPROVED\n  FEEDBACK'],
    ['block-tabs','"""\n\tAPPROVED\n\tFEEDBACK\n"""','APPROVED\nFEEDBACK'],
    ['block-escaped-triple','"""APPROVED \\""" FEEDBACK"""','APPROVED """ FEEDBACK'],
    ['ordinary-unicode','"APPROVED \\u0046EEDBACK"',feedback],
    ['ordinary-escaped-tab','"APPROVED\\tFEEDBACK"',feedback],
    ['ordinary-escaped-newline','"APPROVED\\nFEEDBACK"','APPROVED\nFEEDBACK'],
  ])add(label,query(raw),1,actual);
  const bound='mutation SaveHomeworkGrade($input:GradeInput!) { saved:saveHomeworkGrade(input:$input) { id } }';
  for(const depth of [3,8,24])add('selection-depth-'+depth,bound.replace('{ id }','{ '+ 'child { '.repeat(depth)+'id'+' }'.repeat(depth)+' }'),1,feedback,{input});
  add('comment-crlf',bound.replace('saved:','# } mutation Wrong { fake }\r\n saved:'),1,feedback,{input});
  add('nested-object',`mutation SaveHomeworkGrade { saved:saveHomeworkGrade(input:{envelope:{${prefix},score:80,feedback:"APPROVED FEEDBACK"}}) { id } }`);
  add('nested-wrong-submission',`mutation SaveHomeworkGrade { saved:saveHomeworkGrade(input:{envelope:{${prefix.replace('"SUB1"','"OTHER"')},score:80,feedback:"APPROVED FEEDBACK"}}) { id } }`,0);
  add('array-business-decoy',`mutation SaveHomeworkGrade { saved:saveHomeworkGrade(input:[{${prefix},score:80,feedback:"APPROVED FEEDBACK"}]) { id } }`,0);
  add('duplicate-score',query().replace('score:80','score:80,score:1'),0);
  add('nested-duplicate-feedback',query().replace('feedback:"APPROVED FEEDBACK"','feedback:"APPROVED FEEDBACK",feedback:"WRONG"'),0);
  for(const v of ['__GQL_STR_1__','APPROVED_FEEDBACK','null','false'])add('feedback-kind-'+v,query(v),0);
  for(const v of ['80','null','["SUB1"]','{id:"SUB1"}'])add('submission-kind-'+v.replace(/[^a-z0-9]/gi,'_'),query().replace('submissionId:"SUB1"','submissionId:'+v),0);
  for(const s of ['"APPROVED } # FEEDBACK"','"""APPROVED } # FEEDBACK"""'])add('opaque-feedback-'+(s.startsWith('"""')?'block':'ordinary'),query(s),1,'APPROVED } # FEEDBACK');
  return cases;
}
