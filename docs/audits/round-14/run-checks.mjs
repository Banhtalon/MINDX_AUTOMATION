// Run once from the repository root. Uses the exact requested commands.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';

const dir = 'docs/audits/round-14';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const hash = file => digest(fs.readFileSync(file));
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const walk = folder => fs.readdirSync(folder, { withFileTypes: true }).flatMap(e => {
  const file = path.posix.join(folder, e.name);
  return e.isDirectory() ? walk(file) : [file];
});
assert(!fs.existsSync(`${dir}/source-state.json`), 'Do not overwrite a previous run');
const previous = JSON.parse(fs.readFileSync('docs/audits/round-13/source-state.json', 'utf8'));
const changed = Object.keys(previous.files).filter(f => !fs.existsSync(f) || hash(f) !== previous.files[f]);
assert.deepEqual(changed, ['MINDX_AUTOMATION_PLAN.md']);
const plan = fs.readFileSync('MINDX_AUTOMATION_PLAN.md', 'utf8');
const normalize = text => text.replace(/\r\n/g, '\n');
assert.equal(normalize(plan).replace(/^\* \[x\] \*\*AUDIT-R13:\*\*[^\n]*\n\n/m, ''),
  normalize(fs.readFileSync('docs/audits/round-13/plan.before.md', 'utf8')));
const sourceFiles = [...walk('src'), ...walk('scripts'), ...walk('data/config')].sort();
const oldSourceFiles = Object.keys(previous.files).filter(f => /^(src|scripts|data\/config)\//.test(f)).sort();
assert.deepEqual(sourceFiles, oldSourceFiles, 'No added or removed product/test/data-config files');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(head, previous.head);
fs.writeFileSync(`${dir}/git-status.before.txt`, execFileSync('git', ['status', '--short']));
const files = [...new Set([...Object.keys(previous.files), ...fs.readdirSync('.').filter(f =>
  /^(next\.config\.|postcss\.config\.|eslint\.config\.|\.gitignore$|tsconfig\.tsbuildinfo$)/.test(f))])].sort();
const historyFiles = [...walk('docs/audits/round-12'), ...walk('docs/audits/round-13')].sort();
const state = { capturedAt: new Date().toISOString(), node: process.version, platform: process.platform,
  head, files: Object.fromEntries(files.map(f => [f, hash(f)])),
  historicalArtifacts: Object.fromEntries(historyFiles.map(f => [f, hash(f)])) };
json(`${dir}/source-state.json`, state);
json(`${dir}/baseline-comparison.json`, { checkedAt: state.capturedAt, headMatches: true,
  round13ManifestSha256: hash('docs/audits/round-13/source-state.json'),
  baselineFileCount: Object.keys(previous.files).length, unchangedFiles: files.filter(f => f in previous.files && !changed.includes(f)).length,
  intentionalChanges: changed, onlyRound13AuditNoteAdded: true,
  productTestConfigFileSetIdentical: true, missingFiles: [], addedProductTestConfigFiles: [], removedProductTestConfigFiles: [] });
for (const [file, backup] of [
  ['MINDX_AUTOMATION_PLAN.md', 'plan.before.md'], ['next-env.d.ts', 'next-env.before.txt'],
  ['docs/audits/round-12/independent-results.json', 'round12-results.before.json'],
  ['docs/audits/round-13/independent-results.json', 'round13-results.before.json'],
]) fs.copyFileSync(file, `${dir}/${backup}`);
console.log('BASELINE PASS: 52/53 hashes match; only the existing Round 13 plan note differs.');
const commands = [];
async function run(command, log, restoredFile, backup, resultCopy) {
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
    if (restoredFile) {
      try {
        if (resultCopy && fs.existsSync(restoredFile)) fs.copyFileSync(restoredFile, `${dir}/${resultCopy}`);
        if (!resultCopy && fs.existsSync(restoredFile)) entry.generatedFileSha256 = hash(restoredFile);
      } finally {
        fs.copyFileSync(`${dir}/${backup}`, restoredFile);
        assert(fs.readFileSync(restoredFile).equals(fs.readFileSync(`${dir}/${backup}`)));
        entry.restoredByteIdentical = true;
      }
    }
    entry.finishedAt = new Date().toISOString();
    entry.logSha256 = hash(`${dir}/${log}`);
    entry.logBytes = fs.statSync(`${dir}/${log}`).size;
    commands.push(entry);
    json(`${dir}/commands.json`, commands);
    console.log(JSON.stringify(entry));
  }
}
await run('npx tsx scripts/test-phase4-codex-repros.ts', 'regressions.log');
await run('node docs/audits/round-12/verify-independent.mjs', 'round12-independent.log',
  'docs/audits/round-12/independent-results.json', 'round12-results.before.json', 'round12-independent-results.json');
await run('node docs/audits/round-13/verify-independent.mjs', 'round13-independent.log',
  'docs/audits/round-13/independent-results.json', 'round13-results.before.json', 'round13-independent-results.json');
await run('npx tsc --noEmit --incremental false', 'typecheck.log');
await run('npm run build', 'build.log', 'next-env.d.ts', 'next-env.before.txt');
process.exitCode = commands.every(c => c.exitCode === 0) ? 0 : 1;
