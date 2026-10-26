import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const dir = 'docs/audits/round-13';
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const initial = JSON.parse(fs.readFileSync(`${dir}/source-state.json`, 'utf8'));
const changed = Object.entries(initial.files)
  .filter(([file, hash]) => digest(fs.readFileSync(file)) !== hash).map(([file]) => file);
assert.deepEqual(changed, ['MINDX_AUTOMATION_PLAN.md'], 'only the audit note may change in baseline files');
const before = fs.readFileSync(`${dir}/plan.before.md`, 'utf8').replace(/\r\n/g, '\n');
const after = fs.readFileSync('MINDX_AUTOMATION_PLAN.md', 'utf8').replace(/\r\n/g, '\n');
assert.equal(after.replace(/^\* \[x\] \*\*AUDIT-R13:\*\*[^\n]*\n\n/m, ''), before, 'preserve every other plan item');
const preserved = [
  ['next-env.d.ts', `${dir}/next-env.before.txt`],
  ['docs/audits/round-12/independent-results.json', `${dir}/round12-results.before.json`],
].map(([file, backup]) => {
  const current = fs.readFileSync(file), original = fs.readFileSync(backup);
  assert(current.equals(original), file + ' must match original bytes');
  return { file, sha256: digest(current), byteIdentical: true };
});
const oldResults = JSON.parse(fs.readFileSync(`${dir}/round12-independent-results.json`, 'utf8'));
const newResults = JSON.parse(fs.readFileSync(`${dir}/independent-results.json`, 'utf8'));
assert.equal(oldResults.passed, 43); assert.equal(oldResults.failed, 0);
assert.equal(newResults.passed, 89); assert.equal(newResults.failed, 0);
const report = fs.readFileSync(`${dir}/REPORT.vi.md`, 'utf8');
const codes = [...Array.from({ length: 14 }, (_, i) => '#' + (i + 1)),
  ...[11, 7, 6, 4, 1, 1, 1, 1, 1, 1, 1].flatMap((n, i) => Array.from({ length: n }, (_, j) => 'R' + (i + 2) + '-' + String(j + 1).padStart(2, '0')))];
assert.equal(codes.length, 49);
for (const code of codes) assert(report.includes('| ' + code + ' |') || report.includes('/ ' + code + ' |'), 'missing report row: ' + code);
for (let i = 1; i <= 14; i++) assert(report.includes('| A' + String(i).padStart(2, '0') + ' |'), 'missing A case');
const result = {
  checkedAt: new Date().toISOString(), baselineFileCount: Object.keys(initial.files).length,
  unchangedFiles: Object.keys(initial.files).length - changed.length,
  intentionalChanges: changed, planOnlyAddsAuditNote: true, preserved,
  reportCoverage: { historicalCodes: codes.length, round2Subcases: 14 },
  independentResults: { round12: { passed: 43, failed: 0 }, round13: { passed: 89, failed: 0 } },
  artifacts: Object.fromEntries(fs.readdirSync(dir).filter(f => /\.(mjs|md|log|json)$/.test(f) && f !== 'preservation-check.json')
    .map(f => [f, digest(fs.readFileSync(`${dir}/${f}`))])),
};
fs.writeFileSync(`${dir}/preservation-check.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ unchangedFiles: result.unchangedFiles, intentionalChanges: changed, preserved, historicalCodes: codes.length }));
