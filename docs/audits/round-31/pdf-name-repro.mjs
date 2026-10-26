import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import {parseSubmissionBuffer} from '../../../src/lib/file-parsers/index.ts';
import {createR30MediaCases} from './media-cases.mjs';
assert(process.cwd().startsWith(path.resolve(os.tmpdir())+path.sep)&&process.cwd().includes('mindx-round31-'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const baseline='docs/audits/round-31/evidence/baseline/media-reader.r30.ts';
const file='src/lib/file-parsers/media-reader.ts';
const bytes=fs.readFileSync(baseline);
const expectedHash=JSON.parse(fs.readFileSync('docs/audits/round-30/evidence/source-manifest.json','utf8')).files[file].sha256;
assert.equal(hash(bytes),expectedHash,'R30 baseline must be hash verified');
const ctx=vm.createContext({Buffer,console});
vm.runInContext(stripTypeScriptTypes(bytes.toString('utf8').replace(/\bexport\s+/g,''),{mode:'transform'})+'\nglobalThis.parseMedia=parseMediaBuffer;',ctx);
const results=[];
for(const c of createR30MediaCases()) {
  const current=parseSubmissionBuffer(c.buf,c.id+'.pdf');
  const before=ctx.parseMedia(c.buf,c.id+'.pdf','.pdf');
  const baselineExpected=!c.id.includes('empty-name');
  const pass=before.success===baselineExpected&&current.parseStatus==='PARSED'&&current.inlineDataParts.length===1&&current.inlineDataParts[0].inlineData.data===c.buf.toString('base64');
  results.push({id:c.id,pass,expected:'PARSED',r30Success:before.success,baselineExpected,
    currentStatus:current.parseStatus,inlineParts:current.inlineDataParts.length,
    rawDictionaryBase64:Buffer.from(c.rawDictionary,'latin1').toString('base64'),fixtureBase64:c.buf.toString('base64'),fixtureSha256:hash(c.buf)});
}
const summary={total:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,
  baseline:{path:baseline,mediaSha256:hash(bytes),expectedHash,hashVerified:true},
  method:'Direct current product imports; immutable hash-verified R30 source in VM reproduces both faults and both passing controls.',results};
fs.writeFileSync('docs/audits/round-31/evidence/pdf-name-results.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary));if(summary.failed)process.exitCode=1;
