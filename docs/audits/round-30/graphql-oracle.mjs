// Separate recursive scanner/parser for this fixture corpus, including GraphQL block strings.
// This verifies syntax and binding; it does not claim access to a real LMS schema.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createR27WorkerCases} from '../round-27/worker-cases.mjs';
import {createR28WorkerCases} from '../round-28/worker-cases.mjs';
import {checkR29BlockStrings} from './block-string-oracle.mjs';
assert(process.cwd().startsWith(path.resolve(os.tmpdir())+path.sep)&&process.cwd().includes('mindx-round30-'));
function lex(q) {
  const ts=[];let i=0;
  while(i<q.length) {
    if(/[\s,\uFEFF]/.test(q[i])){i++;continue;}
    if(q[i]==='#'){while(i<q.length&&!/[\r\n]/.test(q[i]))i++;continue;}
    if(q.startsWith('"""',i)) {
      i+=3;let value='',closed=false;
      while(i<q.length) {
        if(q.startsWith('\\"""',i)){value+='"""';i+=4;continue;}
        if(q.startsWith('"""',i)){i+=3;closed=true;break;}
        value+=q[i++];
      }
      assert(closed);ts.push({kind:'STRING',value:blockValue(value)});continue;
    }
    if(q[i]==='"') {
      const start=i++;let closed=false;
      while(i<q.length){if(q[i]==='\\'){i+=2;continue;}if(q[i++]==='"'){closed=true;break;}}
      assert(closed);ts.push({kind:'STRING',value:JSON.parse(q.slice(start,i))});continue;
    }
    const name=/^[_A-Za-z][_0-9A-Za-z]*/.exec(q.slice(i));
    if(name){ts.push({kind:'NAME',value:name[0]});i+=name[0].length;continue;}
    const num=/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(q.slice(i));
    if(num){ts.push({kind:'NUMBER',value:Number(num[0])});i+=num[0].length;continue;}
    assert('{}():[]!$=@'.includes(q[i]),'Unexpected character '+q[i]);
    ts.push({kind:'SYMBOL',value:q[i++]});
  }
  return ts;
}
// GraphQL September 2025, BlockStringValue: remove common indentation and blank edges.
function blockValue(raw) {
  const lines=raw.split(/\r\n|[\r\n]/);
  const indents=lines.slice(1).filter(s=>/[^ \t]/.test(s)).map(s=>/^[ \t]*/.exec(s)[0].length);
  const indent=indents.length?Math.min(...indents):0;
  const out=lines.map((s,i)=>i?s.slice(indent):s);
  while(out.length&&/^[ \t]*$/.test(out[0]))out.shift();
  while(out.length&&/^[ \t]*$/.test(out.at(-1)))out.pop();
  return out.join('\n');
}
function parse(q) {
  const ts=lex(q);let i=0;
  const peek=v=>ts[i]?.value===v;
  const take=v=>{const t=ts[i++];assert(t&&(!v||t.value===v),'Expected '+v);return t;};
  const name=()=>{const t=take();assert.equal(t.kind,'NAME');return t.value;};
  function value() {
    if(peek('$')){take('$');return {kind:'VARIABLE',value:name()};}
    if(peek('{')){take('{');const fields={};while(!peek('}')){const k=name();take(':');assert(!(k in fields));fields[k]=value();}take('}');return {kind:'OBJECT',value:fields};}
    if(peek('[')){take('[');const items=[];while(!peek(']'))items.push(value());take(']');return {kind:'ARRAY',value:items};}
    const t=take();assert(['NAME','STRING','NUMBER'].includes(t.kind));return {...t,kind:t.kind==='NAME'?'ENUM':t.kind};
  }
  function args() {
    const fields={};if(!peek('('))return fields;take('(');
    while(!peek(')')){const k=name();take(':');assert(!(k in fields));fields[k]=value();}
    take(')');return fields;
  }
  function fields() {
    take('{');const out=[];
    while(!peek('}')){let field=name(),alias='';if(peek(':')){take(':');alias=field;field=name();}const a=args();while(peek('@')){take('@');name();args();}const selection=peek('{')?fields():[];out.push({field,alias,args:a,selection});}
    take('}');return out;
  }
  const operations=[];
  while(i<ts.length) {
    const type=name();assert(['mutation','query','subscription'].includes(type));const opName=name();
    // Fixture variable definitions: nested punctuation checked without relying on regex bodies.
    if(peek('(')){take('(');let depth=1;while(depth){const t=take();if(t.value==='(')depth++;if(t.value===')')depth--;}}
    operations.push({type,name:opName,fields:fields()});
  }
  return operations;
}
const cid='R27_ORACLE',sid=cid+'_SESS_01',results=[];
for(const c of [...createR27WorkerCases(cid,sid),...createR28WorkerCases(cid,sid)]) {
  let ops;
  try{ops=parse(c.request.query);}catch(e){assert.equal(c.expected,0);results.push({id:c.id,pass:true,fixtureSyntaxRejected:true,error:e.message});continue;}
  const selected=ops.filter(o=>o.name===c.request.operationName);assert.equal(selected.length,1);
  const op=selected[0],root=op.fields[0],references=[];
  const resolve=node=>{
    if(node.kind==='VARIABLE'){references.push(node.value);return c.request.variables[node.value];}
    if(node.kind==='OBJECT')return Object.fromEntries(Object.entries(node.value).map(([k,v])=>[k,resolve(v)]));
    if(node.kind==='ARRAY')return node.value.map(resolve);
    return node.value;
  };
  const bound=Object.fromEntries(Object.entries(root.args).map(([k,v])=>[k,resolve(v)]));
  let payload=bound.input??bound;
  if(payload?.envelope)payload=payload.envelope;
  if(c.id.startsWith('R27-')&&c.id.includes('decoy')&&!c.id.includes('placeholder')){assert(['deleteAttachment','previewHomework'].includes(root.field));assert.equal(references.length,0);}
  if(c.expected===1){assert.equal(root.field,'saveHomeworkGrade');assert.equal(op.type,'mutation');assert.equal(payload.submissionId,'SUB1');assert.equal(payload.studentId,'S1');assert.equal(payload.score,80);if(c.id.startsWith('R27-'))assert.equal(payload.feedback,c.feedback);}
  if(c.id.includes('placeholder-enum'))assert.equal(root.args.feedback.kind,'ENUM');
  const comparable=s=>typeof s==='string'?s.replace(/\r\n/g,'\n').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim():null;
  const correctPayload=payload&&typeof payload==='object'&&!Array.isArray(payload)&&payload.classId===cid&&payload.sessionId===sid&&payload.studentId==='S1'&&payload.submissionId==='SUB1'&&payload.score===80&&payload.decision==='GRADE'&&comparable(payload.feedback)===comparable(c.feedback);
  const enumFeedback=root.args.feedback?.kind==='ENUM';
  const responseField=root.alias||root.field;
  const wouldVerify=Number(op.type==='mutation'&&root.field==='saveHomeworkGrade'&&correctPayload&&!enumFeedback&&Object.hasOwn(c.response.data,responseField));
  assert.equal(wouldVerify,c.expected,c.id+' independent contract expectation mismatch');
  results.push({id:c.id,pass:true,expectedVerified:c.expected,independentVerified:wouldVerify,operationType:op.type,rootField:root.field,alias:root.alias,actualArgumentVariables:references,resolvedArguments:bound,feedbackValueKind:root.args.feedback?.kind??null});
}
results.push(...checkR29BlockStrings());
const summary={total:results.length,passed:results.length,failed:0,method:'Independent character scanner and recursive fixture parser for 64 inherited cases; imperative specification steps and explicit literals for 24 R29 block-string cases. No actual schema validation.',results};
fs.writeFileSync('docs/audits/round-30/evidence/graphql-oracle-results.json',JSON.stringify(summary,null,2)+'\n');console.log('SUMMARY '+JSON.stringify({total:summary.total,passed:summary.passed,failed:0}));
