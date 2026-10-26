// Supplementary R24 proof: import actual product modules using tsx, without VM source stripping.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {parseSubmissionBuffer} from '../../../src/lib/file-parsers/index.ts';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
assert(root===process.cwd()&&root.startsWith(path.resolve(os.tmpdir()))&&root.includes('mindx-round24-'));
const results=[];
function chunk(type,payload){const b=Buffer.alloc(8+payload.length+(payload.length%2));b.write(type);b.writeUInt32LE(payload.length,4);payload.copy(b,8);return b;}
function riff(...chunks){const b=Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WEBP'),...chunks]);b.writeUInt32LE(b.length-8,4);return b;}
function pdf(){let text='%PDF-1.4\n';const offsets=[];
  for(const [i,body] of ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Resources << >> >>'].entries()){
    offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${body}\nendobj\n`;
  }
  const xref=Buffer.byteLength(text);return Buffer.from(text+'xref\n0 4\n0000000000 65535 f \n'+offsets.map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
async function check(id,buf,ext,expected,decode){
  let decoderError='';if(decode){try{await sharp(buf).raw().toBuffer();}catch(e){decoderError=e.message;}}
  const parsed=parseSubmissionBuffer(buf,id+'.'+ext),pass=parsed.parseStatus===expected&&(!decode||!!decoderError);
  results.push({id,expected,pass,parseStatus:parsed.parseStatus,inlineParts:parsed.inlineDataParts.length,decoderError,fixtureBase64:buf.toString('base64')});
  console.log((pass?'PASS ':'FAIL ')+id+' '+JSON.stringify({parseStatus:parsed.parseStatus,decoderError}));
}
const vp8=Buffer.from([0x70,0,0,0x9d,1,0x2a,1,0,1,0,0,0,0,0]);
const vp8l=Buffer.from([0x2f,0,0,0,0,0,1,2,3,4,5]);
for(const [kind,payload]of [['VP8 ',vp8],['VP8L',vp8l]])for(const extended of [false,true])
  await check('native-'+kind.trim()+'-'+extended,riff(...(extended?[chunk('VP8X',Buffer.alloc(10))]:[]),chunk(kind,payload)),'webp','PARSE_ERROR',true);
await check('native-pdf-missing-root',Buffer.from(pdf().toString().replace('/Root 1 0 R','/Root 9 0 R')),'pdf','PARSE_ERROR',false);
await check('native-pdf-missing-generation',Buffer.from(pdf().toString().replace('/Pages 2 0 R','/Pages 2 1 R')),'pdf','PARSE_ERROR',false);
await check('native-valid-pdf',pdf(),'pdf','PARSED',false);
await check('native-valid-webp',await sharp({create:{width:3,height:3,channels:3,background:'#b01060'}}).webp().toBuffer(),'webp','PARSED',false);
const summary={round:24,method:'Actual product imports through tsx; no product code transformations. sharp independently decodes WebP. PDF fixtures contain xref; no independent PDF decoder used.',sourceRoot:root,checkedAt:new Date().toISOString(),total:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
fs.writeFileSync(path.join(root,'docs/audits/round-24/native-media-results.json'),JSON.stringify(summary,null,2)+'\n');
console.log('SUMMARY '+JSON.stringify({total:summary.total,passed:summary.passed,failed:summary.failed}));
if(summary.failed)process.exitCode=1;
