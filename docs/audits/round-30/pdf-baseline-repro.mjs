// Read only historical source after matching every src/scripts hash to its round manifest.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import {parseSubmissionBuffer} from '../../../src/lib/file-parsers/index.ts';
import {createR29MediaCases} from '../round-29/media-cases.mjs';
const root=process.cwd();
assert(root.startsWith(path.resolve(os.tmpdir())+path.sep)&&root.includes('mindx-round30-'));
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const file='src/lib/file-parsers/media-reader.ts';
const ids=new Set(JSON.parse(fs.readFileSync('docs/audits/round-29/evidence/fixture-manifest.json','utf8')).map(x=>x.id));
const cases=createR29MediaCases().filter(c=>ids.has(c.id));assert.equal(cases.length,8);
const baselines=[],contexts={};
for(const n of [28,29]) {
  const folder=`docs/audits/round-${n}/evidence`;
  const historical=JSON.parse(fs.readFileSync(folder+'/snapshot.json','utf8')).snapshot;
  assert(path.resolve(historical).startsWith(path.resolve(os.tmpdir())+path.sep));
  assert(!path.resolve(historical).startsWith(path.resolve(root)+path.sep));
  const manifest=JSON.parse(fs.readFileSync(folder+'/source-manifest.json','utf8')).files;
  const checked=Object.entries(manifest).filter(([k])=>k.startsWith('src/')||k.startsWith('scripts/'));
  const checks=checked.map(([k,v])=>({file:k,expectedSha256:v.sha256,observedSha256:fs.existsSync(path.join(historical,k))?digest(fs.readFileSync(path.join(historical,k))):null}));
  assert(checks.every(c=>c.expectedSha256===c.observedSha256),'Historical source mismatch R'+n);
  const bytes=fs.readFileSync(path.join(historical,file));
  const ctx=vm.createContext({Buffer,console});
  vm.runInContext(stripTypeScriptTypes(bytes.toString('utf8').replace(/\bexport\s+/g,''),{mode:'transform'})+'\nglobalThis.parseMedia=parseMediaBuffer;',ctx);
  contexts[n]=ctx;
  baselines.push({round:n,snapshot:historical,productFileCount:checks.length,allProductHashesMatch:true,mediaSha256:digest(bytes),checks});
}
const results=cases.map(c=>{
  const r28=contexts[28].parseMedia(c.buf,c.id+'.pdf','.pdf');
  const r29=contexts[29].parseMedia(c.buf,c.id+'.pdf','.pdf');
  const current=parseSubmissionBuffer(c.buf,c.id+'.pdf');
  const legal=c.expected==='PARSED';
  assert.equal(r29.success,!legal,c.id+' must reproduce the original R29 fault');
  assert.equal(current.parseStatus,c.expected,c.id+' current status');
  assert.equal(current.inlineDataParts.length,legal?1:0);
  if(legal)assert.equal(current.inlineDataParts[0].inlineData.data,c.buf.toString('base64'));
  const recorded=JSON.parse(fs.readFileSync('docs/audits/round-29/evidence/fixture-manifest.json','utf8')).find(x=>x.id===c.id);
  assert.equal(digest(c.buf),recorded.sha256,c.id+' original fixture bytes');
  return {id:c.id,pass:true,expected:c.expected,fixtureSha256:digest(c.buf),r28Success:r28.success,r29Success:r29.success,currentParseStatus:current.parseStatus,currentInlineParts:current.inlineDataParts.length};
});
const summary={total:8,passed:8,failed:0,status:'HASH_VERIFIED_R28_R29_BASELINES',method:'All historical src/scripts hashes checked before executing read-only media source in VM. Current parser imported directly through tsx. Eight byte-identical R29 fixtures; no old snapshot modified.',baselines,results};
fs.writeFileSync('docs/audits/round-30/evidence/pdf-baseline-results.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary));
