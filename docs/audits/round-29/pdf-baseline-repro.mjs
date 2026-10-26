// Differential evidence for the two legal NUL-whitespace controls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import {parseSubmissionBuffer} from '../../../src/lib/file-parsers/index.ts';
import {createR29MediaCases} from './media-cases.mjs';
const root=process.cwd();
assert(root.startsWith(path.resolve(os.tmpdir())+path.sep)&&root.includes('mindx-round29-'));
const previous=JSON.parse(fs.readFileSync('docs/audits/round-28/evidence/snapshot.json','utf8')).snapshot;
const file='src/lib/file-parsers/media-reader.ts';
const bytes=fs.readFileSync(path.join(previous,file));
const digest=crypto.createHash('sha256').update(bytes).digest('hex');
const declared=JSON.parse(fs.readFileSync('docs/audits/round-28/evidence/source-manifest.json','utf8')).files[file].sha256;
if(digest!==declared) {
  const summary={status:'BASELINE_SOURCE_HASH_MISMATCH',method:'Read-only hash check. Old TEMP snapshot is mutable and no longer matches the R28 recorded source. No baseline product executed; no regression claim.',baselinePath:path.join(previous,file),observedSha256:digest,declaredSha256:declared,results:[]};
  fs.writeFileSync('docs/audits/round-29/evidence/pdf-baseline-results.json',JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify(summary));
  process.exit(0);
}
const ctx=vm.createContext({Buffer,console});
vm.runInContext(stripTypeScriptTypes(bytes.toString('utf8').replace(/\bexport\s+/g,''),{mode:'transform'})+'\nglobalThis.parseMedia=parseMediaBuffer;',ctx);
const results=createR29MediaCases().filter(c=>c.id.endsWith('whitespace-nul')).map(c=>{
  const before=ctx.parseMedia(c.buf,c.id+'.pdf','.pdf');
  const after=parseSubmissionBuffer(c.buf,c.id+'.pdf');
  assert.equal(before.success,true,c.id+' baseline');
  assert.equal(after.parseStatus,'PARSE_ERROR',c.id+' current native import');
  return {id:c.id,pass:true,baselineSuccess:before.success,baselineInlineParts:before.inlineDataParts.length,currentParseStatus:after.parseStatus,currentInlineParts:after.inlineDataParts.length};
});
assert.equal(results.length,2);
const summary={total:2,passed:2,failed:0,method:'Hash-verified R28 media source executed in VM; current product imported natively. Same two byte-identical PDF fixtures. No historical source changed.',baselinePath:path.join(previous,file),baselineSha256:digest,results};
fs.writeFileSync('docs/audits/round-29/evidence/pdf-baseline-results.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary));
