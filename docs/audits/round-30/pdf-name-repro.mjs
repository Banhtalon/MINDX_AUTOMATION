import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import {parseSubmissionBuffer} from '../../../src/lib/file-parsers/index.ts';
import {makePdf,pdfTree} from '../round-25/media-cases.mjs';
assert(process.cwd().startsWith(path.resolve(os.tmpdir())+path.sep)&&process.cwd().includes('mindx-round30-'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const old=JSON.parse(fs.readFileSync('docs/audits/round-29/evidence/snapshot.json','utf8')).snapshot;
const file='src/lib/file-parsers/media-reader.ts';
const bytes=fs.readFileSync(path.join(old,file));
assert.equal(hash(bytes),JSON.parse(fs.readFileSync('docs/audits/round-29/evidence/source-manifest.json','utf8')).files[file].sha256);
const ctx=vm.createContext({Buffer,console});
vm.runInContext(stripTypeScriptTypes(bytes.toString('utf8').replace(/\bexport\s+/g,''),{mode:'transform'})+'\nglobalThis.parseMedia=parseMediaBuffer;',ctx);
const results=[];
for(const [label,value] of [['nested-empty-name','<< /Value / >>'],['array-empty-name','[/]'],['nested-name-control','<< /Value /Nonempty >>'],['array-name-control','[/Nonempty]']]) {
  const t=pdfTree();
  const dict='<< /Type /Pages /Kids [3 0 R] /Count 1 /Other '+value+' >>';
  const buf=makePdf([t[0],[2,0,dict],t[2]]);
  const current=parseSubmissionBuffer(buf,label+'.pdf');
  const before=ctx.parseMedia(buf,label+'.pdf','.pdf');
  const pass=current.parseStatus==='PARSED'&&current.inlineDataParts.length===1&&current.inlineDataParts[0].inlineData.data===buf.toString('base64');
  results.push({id:'R30-01-pdf-'+label,pass,expected:'PARSED',r29Success:before.success,currentStatus:current.parseStatus,inlineParts:current.inlineDataParts.length,
    rawDictionaryBase64:Buffer.from(dict,'latin1').toString('base64'),fixtureBase64:buf.toString('base64'),fixtureSha256:hash(buf)});
}
const summary={total:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,method:'Direct current product imports, hash-verified R29 media source in VM; legal empty PDF Name in nested dictionary/array and nonempty controls.',results};
fs.writeFileSync('docs/audits/round-30/evidence/pdf-name-results.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary));if(summary.failed)process.exitCode=1;
