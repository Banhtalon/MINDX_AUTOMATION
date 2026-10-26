// Read-only product verification; run from the repository root.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';

const dir = 'docs/audits/round-15';
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const json = (file, value) => fs.writeFileSync(`${dir}/${file}`, JSON.stringify(value, null, 2) + '\n');
const walk = folder => fs.readdirSync(folder, { withFileTypes: true }).flatMap(e => {
  const file = path.posix.join(folder, e.name);
  return e.isDirectory() ? walk(file) : [file];
});
assert(!fs.existsSync(`${dir}/source-state.json`), 'Do not overwrite an existing audit');
const files = [...walk('src'), ...walk('scripts'), ...walk('data/config'),
  'AGENTS.md', 'MINDX_AUTOMATION_PLAN.md', 'package.json', 'package-lock.json',
  'next-env.d.ts', 'next.config.ts', 'tsconfig.json', 'tsconfig.tsbuildinfo', '.gitignore',
  'postcss.config.mjs', 'start-bot.bat', 'start-bot.command'];
const history = ['round-12', 'round-13', 'round-14'].flatMap(r => walk(`docs/audits/${r}`));
const state = { capturedAt: new Date().toISOString(), node: process.version, platform: process.platform,
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  files: Object.fromEntries(files.sort().map(f => [f, hash(f)])),
  historicalArtifacts: Object.fromEntries(history.sort().map(f => [f, hash(f)])) };
json('source-state.json', state);
fs.writeFileSync(`${dir}/git-status.before.txt`, execFileSync('git', ['status', '--short']));
for (const [from, to] of [['next-env.d.ts', 'next-env.before.txt'],
  ['MINDX_AUTOMATION_PLAN.md', 'plan.before.md'],
  ['docs/audits/round-12/independent-results.json', 'round12-results.before.json'],
  ['docs/audits/round-13/independent-results.json', 'round13-results.before.json']])
  fs.copyFileSync(from, `${dir}/${to}`);
const previous = JSON.parse(fs.readFileSync('docs/audits/round-14/source-state.json', 'utf8'));
json('baseline-comparison.json', { baseline: 'round-14/source-state.json',
  changed: Object.keys(previous.files).filter(f => !fs.existsSync(f) || hash(f) !== previous.files[f]),
  added: files.filter(f => !(f in previous.files)) });
const commands = [];
async function run(command, log, restore) {
  const entry = { command, startedAt: new Date().toISOString(), log };
  const fd = fs.openSync(`${dir}/${log}`, 'wx');
  try {
    const child = spawn('cmd.exe', ['/d', '/s', '/c', command], { stdio: ['ignore', fd, fd], windowsHide: true });
    entry.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => { entry.signal = signal; resolve(code); });
    });
  } catch (error) { entry.error = error.message; entry.exitCode = null; }
  finally {
    fs.closeSync(fd);
    if (restore) {
      const [file, backup, copy] = restore;
      try { if (copy && fs.existsSync(file)) fs.copyFileSync(file, `${dir}/${copy}`); }
      finally {
        fs.copyFileSync(`${dir}/${backup}`, file);
        assert(fs.readFileSync(file).equals(fs.readFileSync(`${dir}/${backup}`)));
        entry.restoredByteIdentical = true;
      }
    }
    entry.finishedAt = new Date().toISOString(); entry.logSha256 = hash(`${dir}/${log}`);
    commands.push(entry); json('commands.json', commands); console.log(JSON.stringify(entry));
  }
}
await run('npx tsx scripts/test-phase4-codex-repros.ts', 'regressions.log');
await run('node docs/audits/round-12/verify-independent.mjs', 'round12-independent.log',
  ['docs/audits/round-12/independent-results.json', 'round12-results.before.json', 'round12-independent-results.json']);
await run('node docs/audits/round-13/verify-independent.mjs', 'round13-independent.log',
  ['docs/audits/round-13/independent-results.json', 'round13-results.before.json', 'round13-independent-results.json']);
await run('npx tsc --noEmit --incremental false', 'typecheck.log');
await run('npm run build', 'build.log', ['next-env.d.ts', 'next-env.before.txt']);
process.exitCode = commands.every(c => c.exitCode === 0) ? 0 : 1;
