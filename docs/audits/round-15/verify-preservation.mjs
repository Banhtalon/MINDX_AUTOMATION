import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const dir = 'docs/audits/round-15';
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const state = JSON.parse(fs.readFileSync(`${dir}/source-state.json`, 'utf8'));
const changed = Object.keys(state.files).filter(f => !fs.existsSync(f) || hash(f) !== state.files[f]);
const changedHistory = Object.keys(state.historicalArtifacts).filter(f => !fs.existsSync(f) || hash(f) !== state.historicalArtifacts[f]);
assert.deepEqual(changed, ['MINDX_AUTOMATION_PLAN.md']);
assert.deepEqual(changedHistory, []);
const before = fs.readFileSync(`${dir}/plan.before.md`), note = fs.readFileSync(`${dir}/plan-note.txt`);
const plan = fs.readFileSync('MINDX_AUTOMATION_PLAN.md');
const noteIndex = plan.indexOf(note); assert(noteIndex >= 0);
assert(Buffer.concat([plan.subarray(0, noteIndex), plan.subarray(noteIndex + note.length)]).equals(before));
assert(fs.readFileSync('next-env.d.ts').equals(fs.readFileSync(`${dir}/next-env.before.txt`)));
const walk = folder => fs.readdirSync(folder, { withFileTypes: true }).flatMap(e => {
  const file = path.posix.join(folder, e.name); return e.isDirectory() ? walk(file) : [file];
});
const initialProductFiles = Object.keys(state.files).filter(f => /^(src|scripts|data\/config)\//.test(f)).sort();
assert.deepEqual(['src', 'scripts', 'data/config'].flatMap(walk).sort(), initialProductFiles);
const report = fs.readFileSync(`${dir}/REPORT.vi.md`, 'utf8');
const historicalRows = [...report.matchAll(/^\| (#\d+|R(?:2|3|4|5|6|7|8|9|10|11|12)-\d+) \|/gm)];
assert.equal(historicalRows.length, 49); assert.equal(new Set(historicalRows.map(m => m[1])).size, 49);
assert.equal([...report.matchAll(/^\| A\d\d \|/gm)].length, 14);
const missingLinks = [...report.matchAll(/\]\(([^)]+)\)/g)].map(m => m[1].split('#')[0])
  .filter(target => !/^https?:/.test(target) && target !== 'preservation-check.json' && !fs.existsSync(path.resolve(dir, target)));
assert.deepEqual(missingLinks, []);
const checks = JSON.parse(fs.readFileSync(`${dir}/commands.json`, 'utf8'));
assert.equal(checks.length, 5); assert(checks.every(c => c.exitCode === 0));
const newChecks = JSON.parse(fs.readFileSync(`${dir}/independent-results.json`, 'utf8'));
assert.equal(newChecks.confirmedBugs, 7); assert.equal(newChecks.baselinePassed, 3); assert.equal(newChecks.executionErrors, 0);
const result = { checkedAt: new Date().toISOString(), protectedFileCount: Object.keys(state.files).length,
  unchangedProtectedFiles: Object.keys(state.files).length - changed.length, intentionalChanges: changed,
  planOnlyAuditNoteAdded: true, productTestDataConfigFilesIdentical: true,
  historicalArtifactCount: Object.keys(state.historicalArtifacts).length, changedHistoricalArtifacts: changedHistory,
  nextEnvByteIdentical: true, nextEnvSha256: hash('next-env.d.ts'), historicalCodesInReport: historicalRows.length,
  round2CasesInReport: 14, missingReportLinks: missingLinks, requiredCommandsExitZero: true,
  confirmedNewBugs: 7, newBaselineGroupsPassed: 3 };
fs.writeFileSync(`${dir}/preservation-check.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
