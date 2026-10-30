const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const root = process.cwd(), out = __dirname;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-s4-r3-'));
const walk = dir => fs.readdirSync(dir, {withFileTypes:true}).flatMap(e => e.isDirectory() ? walk(path.join(dir,e.name)) : [path.join(dir,e.name)]);
const protectedFiles = [...walk('src'), ...walk('scripts'), ...walk('docs/audits/v340/s4-round1'), ...walk('docs/audits/v340/s4-round2'), 'docs/audits/v340/CODEX_S4_ROUND1.md', 'docs/audits/v340/CODEX_S4_ROUND2.md', 'AGENTS.md', 'PROJECT_STATE.md', 'MINDX_AUTOMATION_PLAN.md', 'CHANGELOG.md', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.tsbuildinfo'].filter(f => fs.existsSync(f));
const fingerprint = f => ({path:f.replaceAll('\\','/'), sha256:crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'), size:fs.statSync(f).size, mtimeMs:fs.statSync(f).mtimeMs});
const before = protectedFiles.map(fingerprint);
fs.writeFileSync(path.join(out,'protected-before.json'),JSON.stringify(before,null,2));
fs.writeFileSync(path.join(out,'environment.json'),JSON.stringify({node:process.version,platform:process.platform,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,temp,root,head:spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim()},null,2));
fs.writeFileSync(path.join(out,'working-tree.patch'),spawnSync('git',['diff','--','src','scripts'],{encoding:'utf8',maxBuffer:8e6}).stdout);
const gates = [
 ['closure','node --require tsx/cjs docs/audits/v340/s4-round2/closure-probe.cjs'],
 ['parity','node --require tsx/cjs docs/audits/v340/s4-round2/parity-probe.cjs'],
 ['tsc','npx tsc --noEmit --incremental false'],
 ['s4','npx tsx scripts/test-streamline-v340-s4.ts'],
 ['v330','npx tsx scripts/test-report-card-v330.ts'],
 ['phase4','npx tsx scripts/test-phase4-codex-repros.ts'],
];
const results = [];
for(const [id,command] of gates) {
 const dir=path.join(temp,id); fs.mkdirSync(dir);
 const env={...process.env,MINDX_DB_PATH:path.join(dir,'audit.db'),MINDX_RUNNING_CLASSES_PATH:path.join(dir,'running_classes.json'),ALLOWED_LOCAL_DIRS:temp};
 fs.mkdirSync(path.join(os.tmpdir(),'codex_s4_r2_audit'),{recursive:true});
 const start=Date.now();
 const r=spawnSync(process.env.ComSpec || 'cmd.exe',['/d','/s','/c',command],{cwd:root,env,encoding:'utf8',timeout:240000,maxBuffer:16e6,windowsHide:true});
 fs.writeFileSync(path.join(out,id+'.log'),(r.stdout || '')+'\n'+(r.stderr || ''));
 results.push({id,command,exit:r.status,signal:r.signal,error:r.error?.message,ms:Date.now()-start,env:{MINDX_DB_PATH:env.MINDX_DB_PATH,MINDX_RUNNING_CLASSES_PATH:env.MINDX_RUNNING_CLASSES_PATH,ALLOWED_LOCAL_DIRS:env.ALLOWED_LOCAL_DIRS}});
 if(['closure','parity'].includes(id)) {
  const p=path.join(os.tmpdir(),'codex_s4_r2_audit',id+'-results.json');
  if(fs.existsSync(p)) fs.copyFileSync(p,path.join(out,id+'-results.json'));
 }
 fs.writeFileSync(path.join(out,'gates.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify(results.at(-1)));
}
const changes=before.filter(b => JSON.stringify(fingerprint(b.path))!==JSON.stringify(b));
fs.writeFileSync(path.join(out,'protected-verification.json'),JSON.stringify({checked:before.length,unchanged:before.length-changes.length,changes},null,2));
console.log(JSON.stringify({protected:before.length,changes:changes.length,temp}));
process.exitCode=results.some(r=>r.exit!==0)||changes.length ? 1 : 0;
