import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
const out = 'docs/audits/round-18';
const state = JSON.parse(fs.readFileSync(out + '/source-state.json', 'utf8'));
const commands = JSON.parse(fs.readFileSync(out + '/commands.json', 'utf8'));
const script = process.argv[2] || 'smoke-local.mjs';
const log = process.argv[3] || script.replace(/\.mjs$/, '.log');
const hash = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
fs.copyFileSync(out + '/' + script, path.join(state.snapshot, out, script));
const entry = { command: 'node ' + out + '/' + script, cwd: state.snapshot, startedAt: new Date().toISOString(), log };
const fd = fs.openSync(out + '/' + log, 'wx');
const env = {};
for (const k of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','ProgramFiles','ProgramFiles(x86)','ProgramData','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE']) if (process.env[k]) env[k] = process.env[k];
Object.assign(env, { NEXT_TELEMETRY_DISABLED: '1', NODE_OPTIONS: '--require=' + JSON.stringify(path.join(state.snapshot, out, 'network-guard.cjs')) });
try {
  const child = spawn(process.execPath, [out + '/' + script], { cwd: state.snapshot, stdio: ['ignore', fd, fd], windowsHide: true, env });
  entry.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => { entry.signal = signal; resolve(code); }); });
} finally {
  fs.closeSync(fd); entry.finishedAt = new Date().toISOString(); entry.logSha256 = hash(out + '/' + log);
  // Export only fresh outputs of this script, never the snapshot's copied source-state/commands.
  const names = script === 'smoke-local.mjs' ? ['smoke-server.log', 'smoke-results.json', 'insufficient-copy.png', 'tag-conflict.png'] : ['independent-results.json'];
  for (const name of names) if (fs.existsSync(path.join(state.snapshot, out, name))) fs.copyFileSync(path.join(state.snapshot, out, name), out + '/' + name);
  commands.push(entry); fs.writeFileSync(out + '/commands.json', JSON.stringify(commands, null, 2) + '\n'); console.log(JSON.stringify(entry));
}
process.exitCode = entry.exitCode ?? 1;
