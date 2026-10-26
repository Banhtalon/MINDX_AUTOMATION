import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
const out = 'docs/audits/round-17';
const state = JSON.parse(fs.readFileSync(out + '/source-state.json', 'utf8'));
const commands = JSON.parse(fs.readFileSync(out + '/commands.json', 'utf8'));
const script = process.argv[2] || 'verify-independent.mjs';
const log = process.argv[3] || script.replace(/\.mjs$/, '.log');
const hash = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
fs.mkdirSync(path.join(state.snapshot, out), { recursive: true });
fs.copyFileSync(out + '/' + script, path.join(state.snapshot, out, script));
const entry = { command: 'node ' + out + '/' + script, cwd: state.snapshot, startedAt: new Date().toISOString(), log };
const fd = fs.openSync(out + '/' + log, 'wx');
try {
  const child = spawn(process.execPath, [out + '/' + script], { cwd: state.snapshot, stdio: ['ignore', fd, fd], windowsHide: true });
  entry.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => { entry.signal = signal; resolve(code); }); });
} finally {
  fs.closeSync(fd); entry.finishedAt = new Date().toISOString(); entry.logSha256 = hash(out + '/' + log);
  for (const name of fs.readdirSync(path.join(state.snapshot, out))) if (/\.(json|log|png)$/.test(name)) fs.copyFileSync(path.join(state.snapshot, out, name), out + '/' + name);
  commands.push(entry); fs.writeFileSync(out + '/commands.json', JSON.stringify(commands, null, 2) + '\n'); console.log(JSON.stringify(entry));
}
process.exitCode = entry.exitCode ?? 1;
