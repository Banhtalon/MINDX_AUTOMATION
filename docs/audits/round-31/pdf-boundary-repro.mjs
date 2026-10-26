// Adjacent Name/key boundaries after the minimal R30 fix. Generated xref stays valid.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {parseSubmissionBuffer} from '../../../src/lib/file-parsers/index.ts';
import {makePdf,pdfTree} from '../round-25/media-cases.mjs';
assert(process.cwd().startsWith(path.resolve(os.tmpdir())+path.sep)&&process.cwd().includes('mindx-round31-'));
const base='/Type /Pages /Kids [3 0 R] /Count 1';
const cases=[
 ['scalar-empty',base+' /Other /',true],
 ['empty-key-int',base+' / 7',true],
 ['empty-key-empty-name',base+' / /',true],
 ['nested-empty-key',base+' /Other << / 7 >>',true],
 ['nested-empty-both',base+' /Other << / / >>',true],
 ['array-many-empty',base+' /Other [/ / /]',true],
 ['array-nested-empty',base+' /Other [[/] << /V / >>]',true],
 ['nonempty-adjacent',base+' /Other /Nonempty',true],
 ['empty-before-key',base+' /Other / /Next true',true],
 ['empty-key-missing',base+' /',false],
 ['missing-value',base+' /Other',false],
 ['nested-missing-value',base+' /Other << /Value >>',false],
 ['nested-empty-key-missing',base+' /Other << / >>',false],
 ['duplicate-empty-key',base+' / 1 / 2',false],
 ['duplicate-nested-empty-key',base+' /Other << / 1 / 2 >>',false],
 ['stray-gt',base+' /Other / >',false],
 ['stray-open-brace',base+' /Other / {',false],
 ['stray-close-brace',base+' /Other / }',false],
 ['array-stray-gt',base+' /Other [/ >]',false],
 ['nested-stray-close-brace',base+' /Other << /V / } >>',false],
 ['empty-count','/Type /Pages /Kids [3 0 R] /Count /',false],
 ['empty-type','/Type / /Kids [3 0 R] /Count 1',false],
];
for(const ws of ['\x00','\t','\n','\f','\r',' '])cases.push(['ws-'+ws.charCodeAt(0).toString(16),base+' /Other'+ws+'/'+ws,true]);
const results=[];
for(const [label,body,valid] of cases){
 const t=pdfTree(),raw='<< '+body+' >>',buf=makePdf([t[0],[2,0,raw],t[2]]),p=parseSubmissionBuffer(buf,label+'.pdf');
 const pass=p.parseStatus===(valid?'PARSED':'PARSE_ERROR')&&p.inlineDataParts.length===(valid?1:0)&&(!valid||p.inlineDataParts[0].inlineData.data===buf.toString('base64'));
 results.push({id:'R31-01-pdf-'+label,expected:valid?'PARSED':'PARSE_ERROR',parseStatus:p.parseStatus,inlineParts:p.inlineDataParts.length,pass,rawDictionaryBase64:Buffer.from(raw,'latin1').toString('base64'),fixtureBase64:buf.toString('base64')});
}
const summary={total:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,method:'Direct product import; adjacent legal empty Names/keys and invalid missing values, duplicates, stray delimiters, required structural types and all six PDF whitespace bytes.',results};
fs.writeFileSync('docs/audits/round-31/evidence/pdf-boundary-results.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary));if(summary.failed)process.exitCode=1;
