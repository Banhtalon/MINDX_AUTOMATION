import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const root = process.cwd();
const read = p => fs.readFileSync(path.join(root,p),'utf8').replace(/^\uFEFF/,'');
const json = p => JSON.parse(read(p));
const excerpt = (p,start,end) => read(p).split(/\r?\n/).slice(start-1,end).join('\n');
const evidence = 'docs/audits/round-41/evidence/';
const testSource=read('docs/audits/round-40/adversarial.mjs');
const testBlock=(start,end)=>testSource.slice(testSource.indexOf(start),testSource.indexOf(end,testSource.indexOf(start)));
const packet = {
  scope:'AUDIT-R41: original R40-01..08 reproducible-case closure; no expanded adversarial audit',
  history:{audit:'AUDIT-R40',summary:{total:65,pass:35,fail:30},groups:['invalid config shapes/empty arrays','duplicate IDs/UI delete-add','invalid criterion points','two stale clients saving consecutively','Stop skips next student','Windows install failure exit','late response preserves edits','final idle status event']},
  gates:json(evidence+'gates.json'),
  provenanceNote:'The coordinator did NOT modify product source or historical audit files. After a prior successful gate run, two out-of-task changes appeared (sessionDrift). They were NOT reverted or hidden. All five gates were then rerun on the CURRENT snapshot, with copyIntegrity and final-run integrity both identical. Distinguish full-session drift from final-run preservation. This is not a claim that historical files remained unchanged throughout the session.',
  sessionDrift:json(evidence+'post-gate-drift.json'),
  adversarial:json(evidence+'adversarial-results.json'),
  sourceExcerpts:{
    'config invalid shape':excerpt('src/app/api/config/route.ts',90,127),
    'config concurrency':excerpt('src/app/api/config/route.ts',226,262),
    'config points':excerpt('src/app/api/config/route.ts',403,432),
    'UI response guard':excerpt('src/app/syllabus-config/page.tsx',158,196),
    'UI criterion IDs':excerpt('src/app/syllabus-config/page.tsx',900,920),
    'worker stop':excerpt('src/lib/playwright/grade-worker.ts',188,207),
    'queue idle':excerpt('src/lib/queue/task-queue.ts',176,185),
    'queue stop/resume':excerpt('src/lib/queue/task-queue.ts',192,199)+'\n'+excerpt('src/lib/queue/task-queue.ts',225,238),
    'Windows install':excerpt('start-bot.bat',1,4)+'\n'+excerpt('start-bot.bat',41,52)
  },
  testAssertions:{
    reject:testBlock('async function reject','let context;'),
    stale:testBlock("await check('stale-two-client-save'","await check('approved-verified-preserved"),
    idle:testBlock("await check('sse-final-status-is-idle'","await check('sse-live-and-cleanup"),
    stop:testBlock("await check('phase5-batch-halts-next-student'","await check('launcher-windows-npm-failure-detected'"),
    windows:testBlock("await check('launcher-windows-npm-failure-detected'","await check('launcher-local-bind-and-quoted-cwd'"),
    lateResponse:testBlock("await check('ui-inflight-edit-preserved'","await check('ui-drawer-control-stop-resume'")
  },
  logs:Object.fromEntries(['adversarial','phase7','phase6','phase5','tsc'].map(id=>[id,read(evidence+id+'.log')]))
};
fs.writeFileSync(path.join(dir,'reviewer-packet.json'),JSON.stringify(packet,null,2));
const prompt = 'Review this inline evidence packet only. DO NOT CALL TOOLS, commands, or read files. No tool permissions are available. Give final reasoning assessment NOW, not a plan. This is independent reasoning review of coordinator-run tests; do not claim you reran them. Return Vietnamese JSON {decision:"GO or NO-GO for original-case SOURCE closure",findings:[{id,status,reason}],evidence_checks,limitations,additional_observations}. Scope: closure of the original 8 R40 cases only. Distinguish case closure from broader concurrency correctness and live LMS/Gemini/macOS acceptance. Note evidence gaps honestly. The coordinator reran ALL five gates after adding a SHA256 comparison of all 1871 cloned protected files against the live working-tree snapshot BEFORE executing the first gate (copyIntegrity in gates). This is not a clean HEAD claim. Original assertion excerpts and EnableDelayedExpansion are now embedded. R40-04 architectural concerns remain explicitly out of closure scope, not silently accepted as proven. Evaluate whether the original 8 cases can receive SOURCE GO, retaining broader limitations separately. All 5 gates, 65 test records, source excerpts, original assertion excerpts, integrity and cleanup are embedded below:\n'+JSON.stringify(packet);
if(prompt.length>28000)throw Error('Packet exceeds conservative Windows argument budget: '+prompt.length);
const startedAt = new Date().toISOString();
const r=spawnSync(path.join(process.env.LOCALAPPDATA,'agy/bin/agy.exe'),['--model','claude-sonnet-5-5-high','--effort','high','--mode','plan','--sandbox','--output-format','json','--print-timeout','180s','--print',prompt],{encoding:'utf8',windowsHide:true,timeout:210000,maxBuffer:8*1024*1024});
fs.writeFileSync(path.join(dir,'reviewer-packet-response.json'),r.stdout||'');
fs.writeFileSync(path.join(dir,'reviewer-packet-stderr.log'),r.stderr||'');
fs.writeFileSync(path.join(dir,'reviewer-packet-invocation.json'),JSON.stringify({requestedModel:'claude-sonnet-5-5-high',requestedEffort:'high',method:'inline read-only evidence packet; tools prohibited',promptCharacters:prompt.length,startedAt,completedAt:new Date().toISOString(),exitCode:r.status,error:r.error?String(r.error):null},null,2));
console.log(JSON.stringify({exitCode:r.status,responseBytes:(r.stdout||'').length,error:r.error?String(r.error):null}));
