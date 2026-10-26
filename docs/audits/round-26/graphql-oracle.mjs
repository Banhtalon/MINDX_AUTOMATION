// Independent lexical corroboration only. This does not assert a real LMS schema.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createR26WorkerCases} from './worker-cases.mjs';
const root=process.cwd();assert(root.startsWith(path.resolve(os.tmpdir())+path.sep)&&root.includes('mindx-round26-'));
function lex(q) {
  const tokens=[];let i=0;
  while(i<q.length) {
    if(/[\s,]/.test(q[i])){i++;continue;}
    if(q[i]==='#'){while(i<q.length&&q[i]!=='\n'&&q[i]!=='\r')i++;continue;}
    if(q[i]==='"'){
      const start=i++;while(i<q.length){if(q[i]==='\\'){i+=2;continue;}if(q[i++]==='"')break;}
      JSON.parse(q.slice(start,i));tokens.push({kind:'STRING',value:'<opaque string>'});continue;
    }
    const m=/^[_A-Za-z][_0-9A-Za-z]*/.exec(q.slice(i));
    if(m){tokens.push({kind:'NAME',value:m[0]});i+=m[0].length;continue;}
    tokens.push({kind:'SYMBOL',value:q[i++]});
  }
  return tokens;
}
const results=[];
for(const c of createR26WorkerCases('R26_ORACLE','R26_ORACLE_SESS_01')) {
  const ts=lex(c.request.query),stack=[];
  for(const t of ts){if(t.kind==='STRING')continue;if(['{','(','['].includes(t.value))stack.push(t.value);if(['}',')',']'].includes(t.value))assert.equal(stack.pop(),{'}':'{',')':'(',']':'['}[t.value]);}
  assert.equal(stack.length,0);
  assert.equal(ts[0].value,c.id.endsWith('selected-query')?'query':'mutation');assert.equal(ts[1].value,'SaveHomeworkGrade');
  const brace=ts.findIndex(t=>t.value==='{'),field=ts[brace+2]?.value===':'?ts[brace+3].value:ts[brace+1].value;
  const executableVariables=ts.flatMap((t,i)=>t.value==='$'?[ts[i+1].value]:[]);
  const decoy=c.id.includes('quoted-operation-');
  assert.equal(field,decoy?(c.id.includes('preview')?'previewHomework':'deleteAttachment'):'saveHomeworkGrade');
  if(decoy)assert(!executableVariables.includes('input'));
  results.push({id:c.id,pass:true,realRootField:field,executableVariables,stringsOpaque:true});
}
const summary={method:'Independent lexical scanner masks quoted strings and comments, verifies balanced delimiters, actual selected root, and executable variable tokens; no GraphQL schema validation.',sourceRoot:root,total:results.length,passed:results.length,failed:0,results};
fs.writeFileSync('docs/audits/round-26/evidence/graphql-oracle-results.json',JSON.stringify(summary,null,2)+'\n');
console.log('SUMMARY '+JSON.stringify({total:summary.total,passed:summary.passed,failed:summary.failed}));
