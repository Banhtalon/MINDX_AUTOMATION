import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const out = 'docs/audits/round-16';
const state = JSON.parse(fs.readFileSync(out + '/source-state.json', 'utf8'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const walk = folder => fs.readdirSync(folder, { withFileTypes: true }).flatMap(e => {
  const f = path.posix.join(folder, e.name); return e.isDirectory() ? walk(f) : [f];
});
const currentProtected = ['next-env.d.ts', ...['12', '13', '14', '15'].flatMap(n => walk('docs/audits/round-' + n))].sort();
const protectedChanged = Object.entries(state.protectedFiles).filter(([f, h]) => !fs.existsSync(f) || hash(f) !== h).map(([f]) => f);
const addedProtected = currentProtected.filter(f => !(f in state.protectedFiles));
const preservation = { checkedAt: new Date().toISOString(), checkedFiles: currentProtected.length, changed: protectedChanged, added: addedProtected,
  byteIdentical: protectedChanged.length === 0 && addedProtected.length === 0 };
fs.writeFileSync(out + '/preservation-check.json', JSON.stringify(preservation, null, 2) + '\n');
const changed = Object.entries(state.files).filter(([f, h]) => !fs.existsSync(f) || hash(f) !== h).map(([f]) => f);
const unexpected = changed.filter(f => f !== 'MINDX_AUTOMATION_PLAN.md');
const registry = JSON.parse(fs.readFileSync(out + '/issue-status.json', 'utf8'));
assert.equal(registry.issues.length, 56); assert.equal(new Set(registry.issues.map(r => r.id)).size, 56);
const report = fs.readFileSync(out + '/REPORT.vi.md', 'utf8');
assert.equal(report.split(/\r?\n/).filter(l => /^\| (#[0-9]+|R(?:[2-9]|10|11|12|15)-[0-9]{2}) \|/.test(l)).length, 56);
for (const match of report.matchAll(/\]\(([^)]+)\)/g)) {
  if (match[1] !== 'final-state.json') assert(fs.existsSync(path.resolve(out, match[1])), 'Missing report link: ' + match[1]);
}
const commands = JSON.parse(fs.readFileSync(out + '/commands.json', 'utf8'));
for (const c of commands) assert.equal(hash(out + '/' + c.log), c.logSha256, 'Changed command log: ' + c.log);
const planBefore = fs.readFileSync(out + '/plan.before.md', 'utf8');
const planAfter = fs.readFileSync('MINDX_AUTOMATION_PLAN.md', 'utf8');
const restoredPlanText = planAfter.replace(/^\* \[x\] \*\*AUDIT-R16:\*\*[^\r\n]*\r?\n\r?\n/m, '');
assert.equal(restoredPlanText, planBefore, 'Plan changed beyond AUDIT-R16 note');
const productSnapshotMismatch = Object.entries(state.files).filter(([f]) => f.startsWith('src/') || f.startsWith('scripts/') || f.startsWith('data/config/') || ['package.json','package-lock.json','next.config.ts','tsconfig.json','postcss.config.mjs'].includes(f))
  .filter(([f,h]) => hash(path.join(state.snapshot,f)) !== h).map(([f]) => f);
fs.writeFileSync(out + '/git-status.after.txt', execFileSync('git', ['status', '--short']));
const final = { checkedAt: new Date().toISOString(), head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  changedSinceCapture: changed, unexpectedProductChanges: unexpected, productSnapshotMismatch,
  protectedByteIdentical: preservation.byteIdentical, planOnlyAuditNoteAdded: true, issueRows: registry.issues.length,
  auditArtifacts: Object.fromEntries(walk(out).filter(f => !f.endsWith('/final-state.json')).sort().map(f => [f, hash(f)])) };
fs.writeFileSync(out + '/final-state.json', JSON.stringify(final, null, 2) + '\n');
assert(preservation.byteIdentical); assert.equal(unexpected.length, 0); assert.equal(productSnapshotMismatch.length, 0);
console.log(JSON.stringify({ protectedFiles: preservation.checkedFiles, protectedByteIdentical: true, unexpectedProductChanges: unexpected, productSnapshotMismatch, planOnlyAuditNoteAdded: true, issueRows: registry.issues.length }));
