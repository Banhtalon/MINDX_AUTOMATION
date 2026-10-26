import assert from 'node:assert/strict';
import {createR29WorkerCases} from './worker-cases.mjs';

// Imperative implementation of specification steps, independent of product code.
function valueOfBlock(raw) {
  const lines=[];let line='';
  for(let i=0;i<raw.length;i++) {
    if(raw[i]==='\r'||raw[i]==='\n') {
      lines.push(line);line='';
      if(raw[i]==='\r'&&raw[i+1]==='\n')i++;
    } else line+=raw[i];
  }
  lines.push(line);
  const whitespace=c=>c===' '||c==='\t';
  let common=null;
  for(let i=1;i<lines.length;i++) {
    let indent=0;while(indent<lines[i].length&&whitespace(lines[i][indent]))indent++;
    if(indent<lines[i].length&&(common===null||indent<common))common=indent;
  }
  if(common!==null)for(let i=1;i<lines.length;i++)lines[i]=lines[i].substring(common);
  const blank=s=>[...s].every(whitespace);
  let begin=0,end=lines.length;
  while(begin<end&&blank(lines[begin]))begin++;
  while(end>begin&&blank(lines[end-1]))end--;
  return lines.slice(begin,end).join('\n');
}
export function checkR29BlockStrings() {
  const out=[];
  for(const c of createR29WorkerCases('R29_ORACLE','R29_ORACLE_SESS_01')) {
    const q=c.request.query,marker=',feedback:"""';
    let i=q.indexOf(marker)+marker.length,raw='',closed=false;
    assert(i>=marker.length);
    while(i<q.length) {
      if(q[i]==='\\'&&q.substring(i+1,i+4)==='"""'){raw+='"""';i+=4;continue;}
      if(q.substring(i,i+3)==='"""'){closed=true;break;}
      raw+=q[i++];
    }
    assert(closed,c.id);
    const actual=valueOfBlock(raw);
    const expected=c.expected===1?c.feedback:c.feedback.slice(0,-' CHANGED'.length);
    assert.equal(actual,expected,c.id);
    assert.equal(Number(actual===c.feedback),c.expected,c.id);
    out.push({id:c.id,pass:true,independentValue:actual,expectedVerified:c.expected,method:'Spec steps with character iteration and explicit expected literal'});
  }
  return out;
}
