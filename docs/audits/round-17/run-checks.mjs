import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';

const root = process.cwd(), out = path.join(root, 'docs/audits/round-17');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const walk = folder => fs.readdirSync(folder, { withFileTypes: true }).flatMap(e => {
  const f = path.join(folder, e.name);
  return e.isDirectory() ? walk(f) : [path.relative(root, f).replaceAll('\\', '/')];
});
const json = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n');
if (fs.existsSync(path.join(out, 'source-state.json'))) throw Error('Audit already captured');
const files = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'scripts')), ...walk(path.join(root, 'data/config')),
  'AGENTS.md', 'MINDX_AUTOMATION_PLAN.md', 'package.json', 'package-lock.json', 'next-env.d.ts', 'next.config.ts',
  'tsconfig.json', 'tsconfig.tsbuildinfo', '.gitignore', 'postcss.config.mjs', 'start-bot.bat', 'start-bot.command'];
const protectedFiles = ['next-env.d.ts', ...['12', '13', '14', '15', '16'].flatMap(n => walk(path.join(root, 'docs/audits/round-' + n)))];
const digest = list => Object.fromEntries([...list].sort().map(f => [f, hash(path.join(root, f))]));
const snapshot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindx-round17-'));
const state = { capturedAt: new Date().toISOString(), node: process.version, platform: process.platform,
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), snapshot,
  files: digest(files), protectedFiles: digest(protectedFiles) };
state.sourceManifestSha256 = crypto.createHash('sha256').update(JSON.stringify(state.files)).digest('hex');
json('source-state.json', state);
fs.writeFileSync(path.join(out, 'git-status.before.txt'), execFileSync('git', ['status', '--short']));
fs.copyFileSync('MINDX_AUTOMATION_PLAN.md', path.join(out, 'plan.before.md'));
for (const f of new Set([...files, ...protectedFiles])) {
  const target = path.join(snapshot, f);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, f), target);
}
console.log('Copying installed dependencies into isolated snapshot: ' + snapshot);
fs.cpSync(path.join(root, 'node_modules'), path.join(snapshot, 'node_modules'), { recursive: true });
const mismatches = [...new Set([...files, ...protectedFiles])].filter(f => hash(path.join(root, f)) !== hash(path.join(snapshot, f)));
json('snapshot-check.json', { checkedAt: new Date().toISOString(), files: files.length, protectedFiles: protectedFiles.length,
  mismatches, noCredentialsCopied: true, noRealDatabaseCopied: true, noRealBrowserProfileCopied: true });
if (mismatches.length) throw Error('Snapshot mismatch');
const commands = [];
async function run(command, log, result) {
  const entry = { command, cwd: snapshot, startedAt: new Date().toISOString(), log };
  const fd = fs.openSync(path.join(out, log), 'wx');
  try {
    const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
    for (const key of ['TEACHING_PASSWORD', 'LMS_PASSWORD', 'GEMINI_API_KEY', 'TEACHING_USERNAME', 'LMS_USERNAME']) delete env[key];
    const child = spawn('cmd.exe', ['/d', '/s', '/c', command], { cwd: snapshot, stdio: ['ignore', fd, fd], windowsHide: true, env });
    entry.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject); child.once('close', (code, signal) => { entry.signal = signal; resolve(code); });
    });
    if (result && fs.existsSync(path.join(snapshot, result))) fs.copyFileSync(path.join(snapshot, result), path.join(out, path.basename(log, '.log') + '-results.json'));
  } catch (e) { entry.error = e.stack; entry.exitCode = null; }
  finally {
    fs.closeSync(fd); entry.finishedAt = new Date().toISOString(); entry.logSha256 = hash(path.join(out, log));
    commands.push(entry); json('commands.json', commands); console.log(JSON.stringify(entry));
  }
}
await run('npx tsx scripts/test-phase4-codex-repros.ts', 'regressions.log');
await run('node docs/audits/round-12/verify-independent.mjs', 'round12-independent.log', 'docs/audits/round-12/independent-results.json');
await run('node docs/audits/round-13/verify-independent.mjs', 'round13-independent.log', 'docs/audits/round-13/independent-results.json');
await run('node docs/audits/round-16/verify-independent.mjs', 'round16-independent.log', 'docs/audits/round-16/independent-results.json');
await run('npx tsc --noEmit --incremental false', 'typecheck.log');
await run('npm run build', 'build.log');
const changed = Object.entries(state.protectedFiles).filter(([f, h]) => !fs.existsSync(path.join(root, f)) || hash(path.join(root, f)) !== h).map(([f]) => f);
json('preservation-check.json', { checkedAt: new Date().toISOString(), checkedFiles: protectedFiles.length, changed, byteIdentical: changed.length === 0 });
process.exitCode = changed.length || commands.some(c => c.exitCode !== 0) ? 1 : 0;
