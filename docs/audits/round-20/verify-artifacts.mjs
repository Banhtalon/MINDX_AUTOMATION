// Read-only evidence check. Does not run application code, builds or old audits.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const out=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(out,'../../..');
const json=p=>JSON.parse(fs.readFileSync(path.join(out,p),'utf8'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const fileHash=p=>hash(fs.readFileSync(p));
const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(p,e.name)):[path.join(p,e.name)]);
const state=json('source-state.json'),preservation=json('preservation-check.json');
const currentProtected=['next-env.d.ts',...Array.from({length:8},(_,i)=>'docs/audits/round-'+(12+i))].flatMap(p=>fs.statSync(path.join(root,p)).isDirectory()?walk(path.join(root,p)):[path.join(root,p)]).map(p=>path.relative(root,p).replaceAll('\\','/')).sort();
assert.deepEqual(currentProtected,state.protected.map(x=>x.path).sort(),'Protected file inventory changed');
for(const f of state.protected){const p=path.join(root,f.path);assert.equal(fs.statSync(p).size,f.bytes,f.path+' size');assert.equal(fileHash(p),f.sha256,f.path+' hash');}
assert.equal(preservation.byteIdentical,true);assert.equal(preservation.checkedFiles,233);
assert.equal(hash(JSON.stringify(state.source)),state.sourceManifestSha256);
const changed=state.source.filter(f=>fileHash(path.join(root,f.path))!==f.sha256).map(f=>f.path);
assert.deepEqual(changed,['MINDX_AUTOMATION_PLAN.md']);
const sourceFiles=[...['src','scripts','data/config'].flatMap(p=>walk(path.join(root,p))),...fs.readdirSync(root,{withFileTypes:true}).filter(e=>e.isFile()&&(!e.name.startsWith('.env')||e.name==='.env.example')).map(e=>path.join(root,e.name))].map(p=>path.relative(root,p).replaceAll('\\','/')).sort();
assert.deepEqual(sourceFiles,state.source.map(x=>x.path).sort(),'Product/source inventory changed');
const plan=fs.readFileSync(path.join(root,'MINDX_AUTOMATION_PLAN.md'),'utf8');
assert.equal(plan.split('**AUDIT-R20:**').length,2);
assert(/\*\*AUDIT-R19:\*\*[^\n]*\n\n\* \[x\] \*\*AUDIT-R20:/.test(plan),'R20 must follow R19');
assert.equal(hash(plan.replace(/\n\n\* \[x\] \*\*AUDIT-R20:\*\*[^\r\n]*/,'')),state.planSha256,'Only R20 plan line may change');
const required=['npx tsx scripts/test-phase5.ts','npx tsx scripts/test-phase4-codex-repros.ts',...[12,13,16,17,19,20].map(n=>'node docs/audits/round-'+n+'/verify-independent.mjs'),'npx tsc --noEmit --incremental false','npm run build'];
const commands=json('commands.json');assert.equal(commands.length,11);
for(const c of commands){assert.equal(c.cwd,path.join(state.temp,'snapshot'));assert.equal(c.sourceManifestSha256,state.sourceManifestSha256);assert.equal(fileHash(path.join(out,c.log)),c.logSha256);if(c.result)assert.equal(fileHash(path.join(out,c.result)),c.resultSha256);}
for(const command of required){const c=commands.filter(x=>x.command===command).at(-1);assert(c,command);assert.equal(c.exitCode,command.includes('round-20/')?1:0,command);}
const r19=json('round19-independent-results.json'),r20=json('independent-results.json');
assert.equal(r19.total,94);assert.equal(r19.passed,94);assert.equal(r20.total,145);assert.equal(r20.passed,129);assert.equal(r20.failed,16);
assert.equal(new Set(r20.results.map(x=>x.id)).size,145);
assert.deepEqual(r20.results.slice(0,94).map(x=>x.id),r19.results.map(x=>x.id));
assert(r20.results.slice(0,94).every(x=>x.pass));
assert.equal(fileHash(path.join(out,'independent-results.json')),commands.at(-1).resultSha256);
assert.equal(fileHash(path.join(out,'verify-independent.mjs')),commands.at(-1).verifierSha256);
const inherited=json('inheritance-check.json');assert(inherited.inherited94IdsAndOrderIdentical);assert(inherited.inherited94AssertionsAndCriteriaUnchangedAfterDocumentedFixtureSubstitution);
const issues=json('issue-status.json');assert.equal(issues.findings.length,14);assert.equal(issues.verdict,'NO-GO');assert.equal(issues.findings.filter(x=>x.status==='CLOSED_SOURCE').length,6);assert.equal(issues.findings.filter(x=>x.status==='PARTIALLY_FIXED').length,8);
for(const f of issues.findings){assert(f.originalCases.every(id=>r20.results.find(x=>x.id===id)?.pass));assert(f.remainingFailureCases.every(id=>r20.results.find(x=>x.id===id)?.pass===false));}
const failedIds=r20.results.filter(x=>!x.pass).map(x=>x.id).sort();assert.deepEqual(issues.findings.flatMap(x=>x.remainingFailureCases).sort(),failedIds);
for(const n of [12,13,16,17]){const r=json('round'+n+'-independent-results.json');assert.equal(r.failed,0);assert.equal(r.passed,({12:43,13:89,16:16,17:38})[n]);}
for(const f of json('evidence-manifest.json').files)assert.equal(fileHash(path.join(out,f.path)),f.sha256,'Evidence changed: '+f.path);
console.log(JSON.stringify({checkedAt:new Date().toISOString(),verdict:'NO-GO',requiredCommands:10,executions:commands.length,closed:6,partiallyFixed:8,r20:{passed:129,total:145,failed:16},protectedFiles:233,byteIdentical:true,productCodeUnchanged:true,planOnlyAuthorizedLineAdded:true}));
