// Literal expectations implement GraphQL BlockStringValue, not whitespace relaxation.
export function createR29WorkerCases(cid,sid) {
  const cases=[];
  const prefix=`classId:${JSON.stringify(cid)},sessionId:${JSON.stringify(sid)},submissionId:"SUB1",studentId:"S1",decision:GRADE,score:80`;
  const add=(label,raw,feedback,expected=1)=>cases.push({id:'R29-09-'+label,request:{operationName:'SaveHomeworkGrade',query:`mutation SaveHomeworkGrade { saved:saveHomeworkGrade(${prefix},feedback:${raw}) { id } }`,variables:{}},response:{data:{saved:{id:'SUB1'}}},expected,feedback});
  const block=(label,raw,value)=>{
    add(label,'"""'+raw+'"""',value);
    add(label+'-wrong-feedback','"""'+raw+'"""',value+' CHANGED',0);
  };
  block('first-line-excluded','APPROVED\n    FEEDBACK','APPROVED\nFEEDBACK');
  block('first-line-indent-retained','  APPROVED\n    FEEDBACK','  APPROVED\nFEEDBACK');
  block('blank-edges','\n \t\n    APPROVED\n    FEEDBACK\n \t\n','APPROVED\nFEEDBACK');
  block('internal-blank','\n    APPROVED\n\n    FEEDBACK\n','APPROVED\n\nFEEDBACK');
  block('mixed-eols','\r\n    APPROVED\r    FEEDBACK\n','APPROVED\nFEEDBACK');
  block('tab-space-indent','\n\t APPROVED\n\t FEEDBACK\n','APPROVED\nFEEDBACK');
  block('unequal-indent','\n    APPROVED\n      FEEDBACK\n','APPROVED\n  FEEDBACK');
  block('zero-common-indent','\nAPPROVED\n    FEEDBACK\n','APPROVED\n    FEEDBACK');
  block('escape-triple','\n    APPROVED \\"""\n    FEEDBACK\n','APPROVED """\nFEEDBACK');
  block('single-quote-opaque','\n    APPROVED " FEEDBACK\n    END\n','APPROVED " FEEDBACK\nEND');
  block('literal-backslash','\n    APPROVED\\n\n    FEEDBACK\n','APPROVED\\n\nFEEDBACK');
  block('brace-comment-opaque','\n    APPROVED } #\n    FEEDBACK\n','APPROVED } #\nFEEDBACK');
  return cases;
}
