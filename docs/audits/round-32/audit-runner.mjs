// Filesystem orchestration only on the main workspace. Product runs exclusively in TEMP.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const out=path.dirname(fileURLToPath(import.meta.url)), ev=path.join(out,'evidence');
const info=JSON.parse(fs.readFileSync(path.join(ev,'isolation.json'),'utf8')), temp=info.temp;
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
if(!temp.toLowerCase().startsWith(path.join(process.env.SystemRoot,'Temp').toLowerCase()+path.sep)||path.resolve(temp)===path.resolve(info.root))throw Error('Unsafe execution root');
const dst=path.join(temp,'docs/audits/round-32');fs.mkdirSync(dst,{recursive:true});
for(const f of fs.readdirSync(out))if(/\.(mjs|cjs)$/.test(f))fs.copyFileSync(path.join(out,f),path.join(dst,f));
const before=JSON.parse(fs.readFileSync(path.join(ev,'preservation-before.json'),'utf8'));
const source=before.files.filter(f=>f.path.startsWith('src/')||f.path.startsWith('scripts/')||f.path.startsWith('data/config/')||(!f.path.includes('/')&&f.path!=='tsconfig.tsbuildinfo'));
const mismatch=source.filter(f=>!fs.existsSync(path.join(temp,f.path))||sha(path.join(temp,f.path))!==f.sha256);
if(!fs.existsSync(path.join(ev,'snapshot-source-check.json')))fs.writeFileSync(path.join(ev,'snapshot-source-check.json'),JSON.stringify({checked:source.length,mismatch,esbuildSha256:sha(path.join(temp,'eb.exe')),originalEsbuildSha256:sha(path.join(temp,'node_modules/@esbuild/win32-x64/esbuild.exe')),excludedAbsent:['.env','.env.local','.git','playwright-auth','data/mindx_bot.db'].map(p=>({path:p,absent:!fs.existsSync(path.join(temp,p))}))},null,2));
// A later run may legitimately encounter synthetic DB/profile or generated next-env in TEMP.
if(mismatch.some(f=>f.path!=='next-env.d.ts'))throw Error('Snapshot source changed');
const allow=new Set(['SYSTEMROOT','WINDIR','COMSPEC','PATH','PATHEXT','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMFILES','PROGRAMFILES(X86)','PROGRAMDATA','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','OS']);
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>allow.has(k.toUpperCase())));
Object.assign(env,{TEMP:path.dirname(temp),TMP:path.dirname(temp),ESBUILD_BINARY_PATH:path.join(temp,'eb.exe'),NODE_OPTIONS:'--require "'+path.join(dst,'network-guard.cjs').replaceAll('\\','/')+'"',NEXT_TELEMETRY_DISABLED:'1',CI:'1',NO_COLOR:'1',HEADLESS_MODE:'true',npm_config_offline:'true'});
const gates={
 'typecheck-before':['node_modules/typescript/bin/tsc','--noEmit','--incremental','false'],
 phase4:['node_modules/tsx/dist/cli.mjs','scripts/test-phase4-codex-repros.ts'],
 phase5:['node_modules/tsx/dist/cli.mjs','scripts/test-phase5.ts'],
 phase6:['node_modules/tsx/dist/cli.mjs','scripts/test-phase6.ts'],
 r12:['docs/audits/round-12/verify-independent.mjs'],r13:['docs/audits/round-13/verify-independent.mjs'],
 r16:['docs/audits/round-16/verify-independent.mjs'],r17:['docs/audits/round-17/verify-independent.mjs'],
 r31:['docs/audits/round-31/verify-independent.mjs'],
 independent:['--import','tsx','docs/audits/round-32/verify-phase6.mjs'],
 build:['node_modules/next/dist/bin/next','build','--webpack'],
 'typecheck-after':['node_modules/typescript/bin/tsc','--noEmit','--incremental','false']
};
for(const name of process.argv.slice(2)){
 const args=gates[name];if(!args)throw Error('Unknown gate '+name);
 const attempt=fs.readdirSync(ev).filter(f=>f.startsWith(name+'.attempt-')&&f.endsWith('.log')).length+1;
 const log=path.join(ev,`${name}.attempt-${attempt}.log`), fd=fs.openSync(log,'w'), started=new Date(),tick=Date.now();
 console.log('START '+name);
 const code=await new Promise(resolve=>{const child=spawn(process.execPath,args,{cwd:temp,env,stdio:['ignore',fd,fd],windowsHide:true});const timer=setTimeout(()=>{child.kill();resolve(124)},900000);child.on('error',err=>{fs.writeSync(fd,String(err));clearTimeout(timer);resolve(127)});child.on('exit',c=>{clearTimeout(timer);resolve(c??128)})});fs.closeSync(fd);
 const receipt={name,attempt,argv:[process.execPath,...args],cwd:temp,startedAt:started.toISOString(),elapsedSeconds:(Date.now()-tick)/1000,exitCode:code,log:path.basename(log),logSha256:sha(log),secretEnvironmentInherited:false,esbuildBinaryPath:env.ESBUILD_BINARY_PATH};
 const results={r12:'docs/audits/round-12/independent-results.json',r13:'docs/audits/round-13/independent-results.json',r16:'docs/audits/round-16/independent-results.json',r17:'docs/audits/round-17/independent-results.json',r31:'docs/audits/round-31/verify-results.json',independent:'docs/audits/round-32/evidence/phase6-results.json'};
 if(results[name]&&fs.existsSync(path.join(temp,results[name]))&&fs.statSync(path.join(temp,results[name])).mtimeMs>=started.getTime()){const to=path.join(ev,`${name}.attempt-${attempt}-results.json`);fs.copyFileSync(path.join(temp,results[name]),to);receipt.results=path.basename(to);receipt.resultsSha256=sha(to);receipt.freshResults=true}
 const commandsFile=path.join(ev,'commands.json'),commands=fs.existsSync(commandsFile)?JSON.parse(fs.readFileSync(commandsFile,'utf8')):[];commands.push(receipt);fs.writeFileSync(commandsFile,JSON.stringify(commands,null,2));console.log('DONE '+JSON.stringify(receipt));
}
