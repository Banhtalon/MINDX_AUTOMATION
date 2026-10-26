"""Add the audit completion receipt; preserve every existing plan byte."""
import hashlib, json, pathlib

out=pathlib.Path(__file__).resolve().parent
plan=out.parents[2]/'MINDX_AUTOMATION_PLAN.md'
before=plan.read_bytes()
state=json.loads((out/'source-state.json').read_text(encoding='utf-8'))
assert hashlib.sha256(before).hexdigest()==state['files']['MINDX_AUTOMATION_PLAN.md']['sha256']
assert b'**AUDIT-R23:**' not in before
(out/'plan.before.md').write_bytes(before)
newline='\r\n' if b'\r\n' in before else '\n'
start=before.index(b'* [x] **AUDIT-R20:**')
at=before.index(b'\n',start)+1
entry=newline+'* [x] **AUDIT-R23:** Đã hoàn tất kiểm toán độc lập Giai đoạn 5 tại `docs/audits/round-23/REPORT.vi.md`; phán quyết **NO-GO cấp mã nguồn**, chưa nghiệm thu. Có 10/14 nhóm CLOSED_SOURCE, còn R19-01/R19-06/R19-09/R19-13; R23 đạt 92/116, còn 24 ca trượt. R22/R21/R20 nguyên bản đạt 53/53, 49/49, 145/145; hồi quy R12/13/16/17 đạt 185/186 (R16 lệch kỳ vọng 7 bảng so với 8 bảng hiện tại). Đã chạy đủ 12 lệnh trong snapshot TEMP: 10 PASS, 2 FAIL; Phase 4/5, TypeScript và build đạt. Giữ nguyên 364/364 tệp bảo vệ, không sửa src/scripts và không dùng dịch vụ hoặc dữ liệu thật. Dấu hoàn tất chỉ xác nhận đã làm kiểm toán, không ký nghiệm thu TASK-5.x.'+newline
plan.write_bytes(before[:at]+entry.encode('utf-8')+before[at:])
print('Added AUDIT-R23 completion receipt; all original plan bytes retained.')
