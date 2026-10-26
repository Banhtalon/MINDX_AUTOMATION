import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
const out = path.resolve('docs/audits/round-16');
const { snapshot } = JSON.parse(fs.readFileSync(path.join(out, 'source-state.json'), 'utf8'));
const [log, ...args] = process.argv.slice(2);
const command = args.join(' ');
if (!log || !command) throw Error('Usage: node run-extra.mjs log command');
const fd = fs.openSync(path.join(out, log), 'wx');
const entry = { command, cwd: snapshot, startedAt: new Date().toISOString(), log };
try {
  const child = spawn('cmd.exe', ['/d', '/s', '/c', command], { cwd: snapshot, stdio: ['ignore', fd, fd], windowsHide: true,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
  entry.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => { entry.signal = signal; resolve(code); }); });
} catch (e) { entry.exitCode = null; entry.error = e.stack; }
finally {
  fs.closeSync(fd); entry.finishedAt = new Date().toISOString();
  entry.logSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(out, log))).digest('hex');
  const commandsFile = path.join(out, 'commands.json');
  const commands = JSON.parse(fs.readFileSync(commandsFile, 'utf8')); commands.push(entry);
  fs.writeFileSync(commandsFile, JSON.stringify(commands, null, 2) + '\n'); console.log(JSON.stringify(entry));
}
process.exitCode = entry.exitCode === 0 ? 0 : 1;
