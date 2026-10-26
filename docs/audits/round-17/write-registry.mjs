import fs from 'node:fs';
import assert from 'node:assert/strict';
const out = 'docs/audits/round-17';
const previous = JSON.parse(fs.readFileSync('docs/audits/round-16/issue-status.json', 'utf8'));
const r16 = JSON.parse(fs.readFileSync(out + '/round16-independent-results.json', 'utf8'));
const current = JSON.parse(fs.readFileSync(out + '/independent-results.json', 'utf8'));
assert.equal(r16.failed, 0); assert.equal(r16.passed, 16);
assert.equal(current.failed, 6); assert.equal(current.passed, 32);
const issues = previous.issues.map(item => {
  const lines = item.evidence.match(/I12:[0-9,–]+/g) || [];
  return { id: item.id, criterion: item.criterion, originalScenario: 'PASS', status: 'Đạt ca lịch sử', evidence: ['T', ...lines].join('; ') };
});
const statuses = {
  'R15-01': ['Đạt ca đã thử', 'I16:R15-01; duyệt cũ bị chặn, duyệt mới hợp lệ thành công.'],
  'R15-02': ['Đạt ca gốc; còn mở rộng', 'I16:R15-02; R17-01/02 còn mở bảo vệ bản duyệt và phản hồi thiếu dữ kiện.'],
  'R15-03': ['Đạt ca gốc; còn mở rộng', 'I16:R15-03; I17:R16-04-detail; SM:noteConflictFixed; R17-04 còn mở so sánh Quick Tags.'],
  'R15-04': ['Đạt ca đã thử', 'I16:R15-04; I17:13 ca R16-05 gồm PRESENT/LATE, 10 ca trước click và 1 ca sau click.'],
  'R15-05': ['Đạt phân trang DOM; còn nhánh mạng', 'I16:R15-05; I17:9 ca DOM; R17-03 còn mở bảo toàn cache qua GraphQL.'],
  'R15-06': ['Đạt ca đã thử', 'I16:R15-06; 40 luồng, không còn đăng ký nhận sự kiện.'],
  'R15-07': ['Đạt phạm vi dữ liệu giả', 'I16:R15-07; T; không có tên ứng viên/bạn vắng trong prompt giả.'],
};
for (const i of issues) {
  if (i.id === 'R12-01') i.evidence += '; I13:89 nhóm; I16:R15-03';
  if (i.id === 'R7-01') i.evidence += '; I13';
  if (statuses[i.id]) { i.status = statuses[i.id][0]; i.evidence = statuses[i.id][1]; }
}
issues.push(
  { id: 'R16-01', criterion: 'Phân trang DOM trễ 650 ms vẫn thu đủ', originalScenario: 'PASS', status: 'Đạt ca đã thử', evidence: 'T:3825; I16:R16-01; I17:0/100/650 ms có/không trống tải.' },
  { id: 'R16-02', criterion: 'Không coi 0 dòng khi tải là hết trang; thiếu roster phải giữ cache', originalScenario: 'PASS', status: 'Đạt DOM; chưa đóng toàn quy tắc', evidence: 'T:3828; I16:R16-02; I17:9 ca DOM; R17-03 còn hở nhánh mạng.' },
  { id: 'R16-03', criterion: 'Mọi nhánh AI bảo vệ phiên bản 0, bản duyệt và nội dung hiện có', originalScenario: 'PASS', status: 'Chưa đóng toàn diện', evidence: 'T:3835; I16:R16-03; I17:6 ca version 0 đạt; R17-01/02 trượt.' },
  { id: 'R16-04', criterion: 'staleIgnored trả false, giữ bản nhập và hiển thị đúng bản đã lưu', originalScenario: 'PASS', status: 'Đạt ghi chú; chưa đủ Quick Tags', evidence: 'T:3957; I16:R16-04; I17:R16-04-detail đạt; SM:noteConflictFixed; R17-04 trượt.' },
  { id: 'R16-05', criterion: 'Đọc lại điều kiện/nội dung ngay trước Save và kiểm tra sau ghi', originalScenario: 'PASS', status: 'Đạt ca đã thử', evidence: 'T:4036; I16:R16-05; I17:13 ca R16-05 đạt.' },
);
assert.equal(issues.length, 61); assert.equal(new Set(issues.map(i => i.id)).size, 61);
const findings = [
  { id: 'R17-01', priority: 'P1', related: ['R16-03','R15-02'], title: 'Nhánh AI đủ dữ kiện vẫn ghi đè bản APPROVED/VERIFIED', tests: ['R17-01-APPROVED-true','R17-01-VERIFIED-true'] },
  { id: 'R17-02', priority: 'P2', related: ['R16-03','R15-02'], title: 'Thiếu dữ kiện giữ SQLite nhưng thay nội dung màn hình và clipboard', tests: ['R17-02-insufficient-response','R17-02-ui'], smoke: 'insufficientCopy' },
  { id: 'R17-03', priority: 'P2', related: ['R16-02','R15-05'], title: 'GraphQL thiếu inactive vẫn báo thành công và thay cache đủ bằng cache thiếu', tests: ['R17-03-partial-network'] },
  { id: 'R17-04', priority: 'P2', related: ['R16-04','R15-03'], title: 'Xung đột Quick Tags hiển thị điểm danh thay các thẻ đã lưu', tests: ['R17-04-tags-conflict'], smoke: 'tagConflictWrongValue' },
];
const registry = { generatedAt: new Date().toISOString(), verdict: 'NO-GO', scope: 'Cấp mã nguồn để chuyển Giai đoạn 5', historicalOriginalScenariosPassed: 49, round15OriginalScenariosPassed: 7,
  round16OriginalScenariosPassed: 5, independentRound12GroupsPassed: 43, independentRound13GroupsPassed: 89, independentRound16GroupsPassed: 16,
  round17Expanded: { total: 38, passed: 32, failed: 6, findingGroups: 4 }, issues, findings };
fs.writeFileSync(out + '/issue-status.json', JSON.stringify(registry, null, 2) + '\n');
const table = ['| Mã | Nội dung đối chiếu | Kết quả Vòng 17 | Bằng chứng mới |', '|---|---|---|---|', ...issues.map(i => `| ${i.id} | ${i.criterion} | ${i.status} | ${i.evidence} |`)].join('\n');
fs.writeFileSync(out + '/issue-table.md', table + '\n');
console.log(JSON.stringify({ issues: issues.length, originalScenariosPassed: 61, findingGroups: findings.length, expanded: registry.round17Expanded }));
