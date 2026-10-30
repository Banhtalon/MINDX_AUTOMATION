from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent

history = '> **Lịch sử S8 Round 3 (30/10/2026): VERDICT: NO-GO.** **S8-01: CLOSED; S8-02: CLOSED; S8-R2-01: CLOSED (3/3 phát hiện cũ).** Probe tài nguyên gốc **5/5 PASS**, path **403**, browser **0 context phụ**, edge **20/20 PASS**; TypeScript và ba suite SPCK/S5/S7 đều PASS. Tuy nhiên, probe ảnh hợp lệ/junction **11/14 PASS, 3 FAIL**: mất ảnh hợp lệ trong `style="..."` và CSS liên kết, tương ứng **S8-R3-01, S8-R3-02 — MEDIUM OPEN** tại thời điểm Round 3. **Hai SHA-256 dữ liệu thật giữ nguyên; 2.892/2.892 tệp nguồn/cấu hình/hồ sơ lịch sử bất biến giữ nguyên.** Khi đó S8 chưa đóng; chưa nghiệm thu dịch vụ/lớp thật. Báo cáo: [CODEX_V340_FINAL_ROUND3.md](REPORT3); bằng chứng: `docs/audits/v340/s8-round3/`. Kết luận này được giữ làm lịch sử trước bản sửa Round 4.'

current = '> **Trạng thái hiện tại — S8 Round 4 (30/10/2026): VERDICT: GO.** **S8-01: CLOSED; S8-02: CLOSED; S8-R2-01: CLOSED; S8-R3-01: CLOSED; S8-R3-02: CLOSED — toàn bộ 5/5 phát hiện đã đóng.** Probe ảnh hợp lệ/junction **14/14 PASS** (7/7 có ảnh hợp lệ, 7/7 chặn junction); tài nguyên **5/5 PASS**, path **403**, browser **0 context phụ**, edge **20/20 PASS**; TypeScript và ba suite SPCK/S5/S7 đều PASS, **10/10 lệnh exit 0**. **Hai tệp dữ liệu thật bảo toàn 100% SHA-256; 2.951/2.951 tệp bất biến giữ nguyên.** Đủ điều kiện đóng Stage S8 cho v3.4.0 trong phạm vi kiểm định cục bộ; chưa kiểm tra lớp/dịch vụ thật hoặc build production mới. Không sửa mã sản phẩm. [Báo cáo Round 4](REPORT4); bằng chứng: `docs/audits/v340/s8-round4/`. Các kết luận NO-GO bên dưới là lịch sử.'

results = []
for name in ['PROJECT_STATE.md', 'CHANGELOG.md', 'MINDX_AUTOMATION_PLAN.md', 'docs/audits/v340/CODEX_V340_FINAL.md']:
    target = ROOT / name
    # Always derive from the exact backup, retaining all bytes outside the allowed prefix.
    old = (OUT / 'documents-before' / target.name).read_bytes().decode('utf8')
    eol = '\r\n' if '\r\n' in old else '\n'
    final = target.name == 'CODEX_V340_FINAL.md'
    prefix = '' if final else 'docs/audits/v340/'
    r3 = history.replace('REPORT3', prefix + 'CODEX_V340_FINAL_ROUND3.md')
    r4 = current.replace('REPORT4', prefix + 'CODEX_V340_FINAL_ROUND4.md')
    if final:
        cut = old.index(eol + eol)
        tail = old[cut:]
        broken = '## L?ch s? S8 Round 2 ? gi? nguy?n n?i dung tr??c Round 3 b?n d??i'
        assert tail.count(broken) == 1
        tail = tail.replace(broken, '## Lịch sử S8 Round 2 — giữ nguyên nội dung trước Round 3 bên dưới', 1)
        new = r4 + eol + eol + '---' + eol + eol + '## Lịch sử S8 Round 3 — kết quả trước bản sửa Round 4' + eol + eol + r3 + tail
    else:
        start = old.index('> **S8 Round 3 ')
        cut = old.index(eol + eol, start)
        new = old[:start] + r4 + eol + eol + r3 + old[cut:]
        assert new.endswith(old[cut:])
    staged = OUT / 'documents-after' / target.name
    staged.parent.mkdir(exist_ok=True)
    staged.write_bytes(new.encode('utf8'))
    results.append({'path': name, 'encoding': 'UTF-8', 'historicalTailPreserved': True, 'round3AccentsRepaired': True})

(OUT / 'document-updates.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf8')
