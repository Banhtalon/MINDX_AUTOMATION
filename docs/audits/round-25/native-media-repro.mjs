import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {parseSubmissionBuffer} from '../../../src/lib/file-parsers/index.ts';
import {createMediaCases} from './media-cases.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
assert(root===process.cwd()&&root.startsWith(path.resolve(os.tmpdir())+path.sep)&&root.includes('mindx-round25-'));
const results=[];
for(const c of await createMediaCases()) {
  let decoderError='';if(c.decode)try{await sharp(c.buf).raw().toBuffer();}catch(e){decoderError=e.message;}
  const p=parseSubmissionBuffer(c.buf,c.id+'.'+c.ext);
  const decoderMatches=!c.decode||(c.expected==='PARSED'?!decoderError:!!decoderError);
  const bytesMatch=c.expected==='PARSED'?p.inlineDataParts.length===1&&p.inlineDataParts[0].inlineData.data===c.buf.toString('base64'):p.inlineDataParts.length===0;
  const pass=p.parseStatus===c.expected&&decoderMatches&&bytesMatch;
  results.push({id:c.id,pass,expected:c.expected,parseStatus:p.parseStatus,inlineParts:p.inlineDataParts.length,decoderError,decoderMatches,fixtureBase64:c.buf.toString('base64')});
  console.log((pass?'PASS ':'FAIL ')+c.id+' '+JSON.stringify({parseStatus:p.parseStatus,decoderError,decoderMatches}));
}
const summary={round:25,sourceRoot:root,checkedAt:new Date().toISOString(),method:'Actual product imports through tsx; sharp independently decodes all WebP fixtures. PDF checks use explicit object graphs and xref fixtures, no independent PDF decoder.',harnessSha256:crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'),total:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
fs.writeFileSync(path.join(root,'docs/audits/round-25/native-media-results.json'),JSON.stringify(summary,null,2)+'\n');
console.log('SUMMARY '+JSON.stringify({total:summary.total,passed:summary.passed,failed:summary.failed}));if(summary.failed)process.exitCode=1;
