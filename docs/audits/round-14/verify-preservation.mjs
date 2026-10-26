// Run from the repository root after writing the Round 14 report and plan note.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const dir = 'docs/audits/round-14';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const hash = file => digest(fs.readFileSync(file));
const state = JSON.parse(fs.readFileSync(`${dir}/source-state.json`, 'utf8'));
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), state.head);
const changed = Object.keys(state.files).filter(f => !fs.existsSync(f) || hash(f) !== state.files[f]);
assert.deepEqual(changed, ['MINDX_AUTOMATION_PLAN.md']);
const before = fs.readFileSync(`${dir}/plan.before.md`);
const after = fs.readFileSync('MINDX_AUTOMATION_PLAN.md');
const note = /^\* \[x\] \*\*AUDIT-R14:\*\*[^\r\n]*\r?\n\r?\n/gm;
assert.equal([...after.toString('utf8').matchAll(note)].length, 1);
assert(Buffer.from(after.toString('utf8').replace(note, ''), 'utf8').equals(before), 'Only add the R14 note; preserve every previous byte');
for (const [file, expected] of Object.entries(state.historicalArtifacts)) assert.equal(hash(file), expected, file);
const walk = folder => fs.readdirSync(folder, { withFileTypes: true }).flatMap(e => {
  const file = path.posix.join(folder, e.name);
  return e.isDirectory() ? walk(file) : [file];
});
assert.deepEqual([...walk('src'), ...walk('scripts'), ...walk('data/config')].sort(),
  Object.keys(state.files).filter(f => /^(src|scripts|data\/config)\//.test(f)).sort());
assert(fs.readFileSync('next-env.d.ts').equals(fs.readFileSync(`${dir}/next-env.before.txt`)));
const commands = JSON.parse(fs.readFileSync(`${dir}/commands.json`, 'utf8'));
assert.deepEqual(commands.map(c => c.command), [
  'npx tsx scripts/test-phase4-codex-repros.ts', 'node docs/audits/round-12/verify-independent.mjs',
  'node docs/audits/round-13/verify-independent.mjs', 'npx tsc --noEmit --incremental false', 'npm run build',
]);
for (const c of commands) { assert.equal(c.exitCode, 0); assert.equal(hash(`${dir}/${c.log}`), c.logSha256); }
for (const [file, count] of [['round12-independent-results.json', 43], ['round13-independent-results.json', 89]]) {
  const result = JSON.parse(fs.readFileSync(`${dir}/${file}`, 'utf8'));
  assert.equal(result.passed, count); assert.equal(result.failed, 0);
  assert.equal(result.results.length, count); assert(result.results.every(r => r.pass));
  const command = commands.find(c => c.command.includes(file.startsWith('round12') ? 'round-12/' : 'round-13/'));
  assert(Date.parse(result.generatedAt) >= Date.parse(command.startedAt));
  assert(Date.parse(result.generatedAt) <= Date.parse(command.finishedAt));
}
const build = fs.readFileSync(`${dir}/build.log`, 'utf8');
assert(build.includes('Compiled successfully'));
assert(build.includes('Finished TypeScript'));
assert(build.includes('(18/18)'));
assert(build.includes('Finalizing page optimization'));
assert(!/spawn EPERM|Skipping validation|Ignoring type errors/i.test(build));
const buildArtifacts = ['.next/BUILD_ID', '.next/prerender-manifest.json', '.next/routes-manifest.json', '.next/server/app-paths-manifest.json'];
for (const file of buildArtifacts) assert(fs.statSync(file).size > 0);
const report = fs.readFileSync(`${dir}/REPORT.vi.md`, 'utf8');
assert(!report.includes('<!-- HISTORICAL_TABLES -->'));
for (const match of report.matchAll(/\]\(([^)]+)\)/g)) {
  if (!match[1].includes('://')) assert(fs.existsSync(path.resolve(dir, match[1].split('#')[0])), match[1]);
}
const codes = [...Array.from({ length: 14 }, (_, i) => '#' + (i + 1)),
  ...[11, 7, 6, 4, 1, 1, 1, 1, 1, 1, 1].flatMap((n, i) => Array.from({ length: n }, (_, j) => 'R' + (i + 2) + '-' + String(j + 1).padStart(2, '0')))];
assert.equal(codes.length, 49);
for (const code of codes) assert(report.includes('| ' + code + ' |') || report.includes('/ ' + code + ' |'), code);
for (let i = 1; i <= 14; i++) assert(report.includes('| A' + String(i).padStart(2, '0') + ' |'));
assert(report.includes('**GO cấp mã nguồn để chuyển sang triển khai Giai đoạn 5.**'));
assert(report.includes('**B13-BUILD: ĐÓNG — ĐẠT.**'));
const result = { checkedAt: new Date().toISOString(), head: state.head,
  baselineFileCount: Object.keys(state.files).length, unchangedFiles: Object.keys(state.files).length - 1,
  intentionalChanges: changed, planOnlyAddsRound14AuditNote: true,
  historicalArtifactCount: Object.keys(state.historicalArtifacts).length, allHistoricalArtifactsByteIdentical: true,
  nextEnv: { byteIdentical: true, sha256: hash('next-env.d.ts') },
  allFiveCommandsPassed: true, independentGroups: { passed: 132, failed: 0 },
  reportCoverage: { historicalCodes: codes.length, round2Subcases: 14 },
  buildArtifacts: Object.fromEntries(buildArtifacts.map(f => [f, hash(f)])),
  artifacts: Object.fromEntries(walk(dir).filter(f => !f.endsWith('/preservation-check.json') && !f.endsWith('/preservation.log')).sort().map(f => [f, hash(f)])),
};
fs.writeFileSync(`${dir}/preservation-check.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ pass: true, unchangedFiles: result.unchangedFiles,
  intentionalChanges: changed, historicalArtifactsPreserved: result.historicalArtifactCount,
  nextEnvByteIdentical: true, independentGroups: result.independentGroups, historicalCodes: codes.length }));
