import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const out = 'docs/audits/round-17';
const s = JSON.parse(fs.readFileSync(out + '/source-state.json', 'utf8'));
const hash = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const f = path.posix.join(dir, e.name); return e.isDirectory() ? walk(f) : [f];
});
const json = (name, value) => fs.writeFileSync(out + '/' + name, JSON.stringify(value, null, 2) + '\n');
let report = fs.readFileSync(out + '/REPORT.vi.md', 'utf8');
if (report.includes('<!-- ISSUE_TABLE -->')) {
  report = report.replace('<!-- ISSUE_TABLE -->', fs.readFileSync(out + '/issue-table.md', 'utf8').trimEnd());
  fs.writeFileSync(out + '/REPORT.vi.md', report);
}
const note = '* [x] **AUDIT-R17:** Đã kiểm toán độc lập và đối chiếu đủ 61 mã tại `docs/audits/round-17/REPORT.vi.md`. Sáu lệnh bắt buộc thoát 0, build đủ 18/18 trang; 148/148 nhóm độc lập cũ đạt, gồm 7 ca gốc Vòng 15 và 5 ca gốc Vòng 16. Bộ mở rộng cuối có 32/38 ca đạt, 6 ca trượt thuộc 4 nhóm lỗi (1 P1, 3 P2); hai lỗi UI xác nhận bằng Chromium/HTTP và dữ liệu giả. Kết luận hiện tại: **NO-GO cấp mã nguồn để chuyển sang Giai đoạn 5**. Không sửa sản phẩm hoặc dùng LMS/Gemini thật; 111 tệp bảo vệ gồm `next-env.d.ts` và hồ sơ Vòng 12–16 giữ nguyên từng byte.';
const before = fs.readFileSync(out + '/plan.before.md', 'utf8');
const plan = fs.readFileSync('MINDX_AUTOMATION_PLAN.md', 'utf8');
const nl = before.includes('\r\n') ? '\r\n' : '\n';
if (!plan.includes('**AUDIT-R17:**')) {
  assert.equal(plan, before, 'Plan changed outside this audit');
  const marker = '> **✅ ĐIỀU KIỆN NGHIỆM THU GIAI ĐOẠN 4:**';
  assert.equal(plan.split(marker).length, 2);
  fs.writeFileSync('MINDX_AUTOMATION_PLAN.md', plan.replace(marker, note + nl + nl + marker));
}
const after = fs.readFileSync('MINDX_AUTOMATION_PLAN.md', 'utf8');
assert.equal(after.replace(note + nl + nl, ''), before, 'Plan changed beyond audit note');
const currentProtected = ['next-env.d.ts', ...['12','13','14','15','16'].flatMap(n => walk('docs/audits/round-' + n))].sort();
const protectedChanged = Object.entries(s.protectedFiles).filter(([f,h]) => !fs.existsSync(f) || hash(f) !== h).map(([f]) => f);
const protectedAdded = currentProtected.filter(f => !(f in s.protectedFiles));
const preservation = { checkedAt: new Date().toISOString(), checkedFiles: currentProtected.length, changed: protectedChanged, added: protectedAdded,
  byteIdentical: protectedChanged.length === 0 && protectedAdded.length === 0 && currentProtected.length === Object.keys(s.protectedFiles).length };
json('preservation-check.json', preservation);
const changed = Object.entries(s.files).filter(([f,h]) => !fs.existsSync(f) || hash(f) !== h).map(([f]) => f);
const unexpected = changed.filter(f => f !== 'MINDX_AUTOMATION_PLAN.md');
const snapshotProductMismatch = Object.entries(s.files).filter(([f]) => f.startsWith('src/') || f.startsWith('scripts/') || f.startsWith('data/config/') || ['package.json','package-lock.json','next.config.ts','tsconfig.json','postcss.config.mjs'].includes(f))
  .filter(([f,h]) => hash(path.join(s.snapshot,f)) !== h).map(([f]) => f);
const commands = JSON.parse(fs.readFileSync(out + '/commands.json', 'utf8'));
for (const c of commands) assert.equal(hash(out + '/' + c.log), c.logSha256, 'Changed log: ' + c.log);
assert.equal(commands.slice(0,6).length, 6); assert(commands.slice(0,6).every(c => c.exitCode === 0));
assert.equal(commands.at(-1).log, 'verify-independent-final.log'); assert.equal(commands.at(-1).exitCode, 1);
assert.equal(hash(out + '/verify-independent.mjs'), hash(path.join(s.snapshot,out,'verify-independent.mjs')));
const reg = JSON.parse(fs.readFileSync(out + '/issue-status.json', 'utf8'));
assert.equal(reg.issues.length, 61); assert.equal(new Set(reg.issues.map(i=>i.id)).size, 61);
assert.equal(report.split(/\r?\n/).filter(l => /^\| (#[0-9]+|R(?:[2-9]|10|11|12|15|16)-[0-9]{2}) \|/.test(l)).length, 61);
for (const match of report.matchAll(/\]\(([^)]+)\)/g)) {
  if (match[1] !== 'final-state.json') assert(fs.existsSync(path.resolve(out,match[1])), 'Missing report link: ' + match[1]);
}
const independent = JSON.parse(fs.readFileSync(out + '/independent-results.json', 'utf8'));
assert.equal(independent.passed, 32); assert.equal(independent.failed, 6);
const smoke = JSON.parse(fs.readFileSync(out + '/smoke-results.json', 'utf8')); assert(smoke.completed);
assert.equal(smoke.externalRequests.length, 0); assert.equal(smoke.pageErrors.length, 0);
fs.writeFileSync(out + '/git-status.after.txt', execFileSync('git', ['status', '--short']));
const final = { checkedAt: new Date().toISOString(), head: execFileSync('git', ['rev-parse','HEAD'], { encoding:'utf8' }).trim(),
  verdict: 'NO-GO', sourceManifestSha256: s.sourceManifestSha256, sourceFiles: Object.keys(s.files).length,
  changedSinceCapture: changed, unexpectedProductChanges: unexpected, snapshotProductMismatch,
  protectedByteIdentical: preservation.byteIdentical, protectedFiles: preservation.checkedFiles, planOnlyAuditNoteAdded: true,
  issueRows: reg.issues.length, historicalOriginalScenariosPassed: 61, requiredCommandsPassed: 6, expandedTests: { passed: 32, failed: 6 },
  finalIndependentScriptSha256: hash(out + '/verify-independent.mjs'), smokeCompleted: true,
  auditArtifacts: Object.fromEntries(walk(out).filter(f => !f.endsWith('/final-state.json')).sort().map(f => [f,hash(f)])) };
json('final-state.json', final);
assert(preservation.byteIdentical); assert.equal(unexpected.length, 0); assert.equal(snapshotProductMismatch.length, 0); assert.equal(final.head, s.head);
console.log(JSON.stringify({ verdict: final.verdict, protectedFiles: final.protectedFiles, protectedByteIdentical: true,
  unexpectedProductChanges: unexpected, snapshotProductMismatch, issueRows: 61, requiredCommandsPassed: 6, expandedTests: final.expandedTests, planOnlyAuditNoteAdded: true }));
