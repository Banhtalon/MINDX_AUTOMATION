// Add only the completed audit entry. Keep all original plan bytes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
const dir = 'docs/audits/round-15';
const state = JSON.parse(fs.readFileSync(`${dir}/source-state.json`, 'utf8'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.deepEqual(Object.keys(state.files).filter(f => hash(f) !== state.files[f]), []);
assert.deepEqual(Object.keys(state.historicalArtifacts).filter(f => hash(f) !== state.historicalArtifacts[f]), []);
const file = 'MINDX_AUTOMATION_PLAN.md', before = fs.readFileSync(file);
assert(before.equals(fs.readFileSync(`${dir}/plan.before.md`)));
const start = before.indexOf(Buffer.from('* [x] **AUDIT-R14:**')); assert(start >= 0);
let end = before.indexOf(10, start); assert(end >= 0); end++;
const nl = before.subarray(end - 2, end).equals(Buffer.from('\r\n')) ? '\r\n' : '\n';
const note = Buffer.from(nl + '* [x] **AUDIT-R15:** Đã kiểm toán sâu độc lập Giai đoạn 1–4 và đối chiếu đủ 49 mã lịch sử; báo cáo tại `docs/audits/round-15/REPORT.vi.md`. Cả 5 lệnh bắt buộc thoát 0, 132/132 nhóm cũ đạt và build hoàn tất 18/18 trang; ca mới tái hiện 7 lỗi (4 P1, 3 P2), mở lại phạm vi R5-02 và R12-01. Kết luận hiện tại: **NO-GO cấp mã nguồn để chuyển sang Giai đoạn 5**, thay thế GO của AUDIT-R14; chưa sửa mã sản phẩm hoặc nghiệm thu LMS thật. Đã khôi phục `next-env.d.ts` đúng từng byte và bảo toàn hồ sơ Vòng 12–14.' + nl);
fs.writeFileSync(`${dir}/plan-note.txt`, note);
fs.writeFileSync(file, Buffer.concat([before.subarray(0, end), note, before.subarray(end)]));
console.log('Added only AUDIT-R15 to the plan; product and historical artifacts unchanged.');
