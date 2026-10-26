"""Validate captured R37 evidence, publish the report, append one plan status."""
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from runpy import run_path

_runner = run_path(str(Path(__file__).with_name('audit-runner.py')))
ROOT, OUT, SNAP, protected, save, sha = (_runner[k] for k in ['ROOT', 'OUT', 'SNAP', 'protected', 'save', 'sha'])

EXPECTED_ENV = 'B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000'

def read(name):
    return json.loads((OUT / name).read_text(encoding='utf-8'))

def main():
    before = read('integrity-before.json')
    after = protected()
    assert before == after, 'Protected main-tree files changed'
    assert sha(ROOT / 'next-env.d.ts') == EXPECTED_ENV
    historical = {p: h for p, h in before.items() if p.startswith('docs/audits/')}
    previous = json.loads((ROOT / 'docs/audits/round-36/evidence/integrity-before.json').read_text(encoding='utf-8'))
    changed = [p for p in previous if previous[p] != before.get(p)]
    assert set(changed) == {'scripts/test-phase5.ts', 'src/components/homework-auto-grader-tab.tsx'}
    snapshot = read('snapshot.json')
    assert all(before[p] == h for p, h in snapshot['copiedHashes'].items())
    assert snapshot['forbiddenFilesFound'] == []
    cleanup = read('cleanup.json')
    assert cleanup['snapshotAbsent'] and not SNAP.exists()
    assert all(t['removed'] and not Path(t['path']).exists() for t in cleanup['targets'])
    assert cleanup['originalNodeModulesPresent'] and cleanup['preexistingEsbuildPresent']
    assert sha(Path(snapshot['esbuildPath'])) == snapshot['esbuildSha256']

    runs = read('gate-runs.json')
    assert len(runs) == 11
    expected_counts = [(819, 'fresh-verify-results.json'), (221, 'fresh-native-media-results.json'),
        (88, 'fresh-native-worker-results.json'), (4, 'fresh-pdf-name-results.json'),
        (28, 'fresh-pdf-boundary-results.json')]
    for i, (count, filename) in enumerate(expected_counts):
        data = read(filename)
        assert (data['total'], data['passed'], data['failed']) == (count, count, 0)
        assert len(data['results']) == count and all(r['pass'] is True for r in data['results'])
        runs[i].update(status='PASS', summary={'total': count, 'passed': count, 'failed': 0})
    phase = (OUT / '06-phase5.log').read_text(encoding='utf-8')
    assert len(re.findall(r'^✅ [1-8]\.', phase, re.M)) == 8
    assert '✅ 8. Bộ kiểm thử hồi quy R35 & R36-01 hoạt động chuẩn xác.' in phase
    runs[5].update(status='PASS', summary={'groupsPassed': 8, 'includesR35AndR3601': True})
    assert (OUT / '07-typescript.log').read_bytes() == b''
    runs[6].update(status='PASS', summary={'diagnostics': 0})
    core = read('fresh-core-repro-results.json')['results']
    ui = read('fresh-ui-repro-results.json')['results']
    rubric = read('fresh-rubric-repro-results.json')['results']
    assert len(core) == 3 and all(r['pass'] is True for r in core)
    assert len(ui) == 3 and all(r['bugReproduced'] is False for r in ui)
    assert len(rubric) == 1 and rubric[0]['bugReproduced'] is False
    runs[7].update(status='PASS', summary={'total': 3, 'passed': 3})
    for index, data in [(8, ui), (9, rubric)]:
        runs[index].update(status='PASS_EXPECTED_LEGACY_EXIT_1',
            summary={'total': len(data), 'bugReproduced': [r['bugReproduced'] for r in data]},
            explanation='Unmodified historical detector exits 1 when any original bug is no longer reproduced; fresh JSON confirms every requested case false.')
    closure = read('fresh-closure-results.json')
    assert (closure['total'], closure['passed'], closure['failed']) == (10, 10, 0)
    assert all(r['pass'] is True for r in closure['results'])
    newfile = next(r['observation'] for r in closure['results'] if r['id'] == 'R36-UI-new-file-clears-unsaved-marker')
    assert newfile['fileHash'] == 'file-v2' and newfile['unsaved'] == {}
    assert newfile['approveResult'] is True and newfile['approvalCalls'] == 1
    runs[10].update(status='PASS', summary={'total': 10, 'passed': 10, 'failed': 0})
    for i, run in enumerate(runs):
        assert run['exitCode'] == (1 if i in [8, 9] else 0)
        if 'artifact' in run:
            assert run['freshArtifactCreated'] is True
            assert sha(OUT / run['artifact']) == run['artifactSha256']

    review = [
        {'id': 'R35-01', 'status': 'CLOSED_SOURCE', 'source': ['src/app/syllabus-config/page.tsx:667', 'src/app/api/config/route.ts:193', 'src/lib/gemini/score-auditor.ts:113', 'src/lib/gemini/homework-grader.ts:360', 'src/app/api/homework-grader/download-and-grade/route.ts:143', 'src/app/api/homework-grader/approve/route.ts'], 'proof': 'Thang 10 bị cấu hình/kiểm điểm/chấm/duyệt từ chối; thang 100 cho 40+40=80, duyệt APPROVED. AI calls=0 với barem sai.'},
        {'id': 'R35-02', 'status': 'CLOSED_SOURCE', 'source': ['src/components/homework-auto-grader-tab.tsx:231'], 'proof': 'Lưu lỗi rồi làm mới cùng file giữ chữ và cờ chưa lưu; xác nhận draftSeq mới xóa cờ.'},
        {'id': 'R35-03', 'status': 'CLOSED_SOURCE', 'source': ['src/components/homework-auto-grader-tab.tsx:208', 'src/components/homework-auto-grader-tab.tsx:355'], 'proof': 'Đổi sang buổi 2 khi chấm buổi 1: SUB2 hiện đúng và isLoadingSubs=false; không phát GET cũ làm vô hiệu lượt mới.'},
        {'id': 'R35-04', 'status': 'CLOSED_SOURCE', 'source': ['src/lib/gemini/homework-grader.ts:618', 'src/lib/gemini/homework-grader.ts:710', 'src/app/api/homework-grader/download-and-grade/route.ts:231'], 'proof': 'Stop ngăn SUB2; API success=false; chấm đơn gọi AI giả 1 lần, ghi 0 lần, trả TASK_CANCELLED.'},
        {'id': 'R35-05', 'status': 'CLOSED_SOURCE', 'source': ['src/lib/playwright/download-submissions.ts:147'], 'proof': 'Đọc bảng mới trước khi lọc: scrapeCalls=1 dù cache cũ chưa có bài. Bộ gốc cố ý dừng tại BrowserManager giả, chưa chứng minh tải thật.'},
        {'id': 'R35-06', 'status': 'CLOSED_SOURCE', 'source': ['src/lib/file-parsers/game-reader.ts:25'], 'proof': 'Giữ đủ toán hạng 1+2 và 100+200; ca vòng tham chiếu và sâu đều kết thúc có giới hạn.'},
        {'id': 'R35-07', 'status': 'CLOSED_SOURCE', 'source': ['src/lib/file-parsers/game-reader.ts:623', 'src/lib/file-parsers/game-reader.ts:646'], 'proof': 'GML hỏng làm PARSE_ERROR với tên Step_0.gml; YY JSON hỏng bị từ chối; gói hợp lệ vẫn đọc được.'},
        {'id': 'R36-01', 'status': 'CLOSED_SOURCE', 'source': ['src/components/homework-auto-grader-tab.tsx:231', 'src/components/homework-auto-grader-tab.tsx:306', 'scripts/test-phase5.ts:686'], 'proof': 'file-v2 thay nháp cũ, unsaved={} ngay lần làm mới đầu; approveResult=true, approvalCalls=1. Test Phase5 kiểm tra cả giữ nháp cùng file và Duyệt sau đổi file.'},
    ]
    save('source-review.json', {'changedSinceR36': changed,
        'changedFileHashes': {p: before[p] for p in changed}, 'findings': [], 'closures': review,
        'scope': 'Direct reading of the final source and related callers; no product edits; synthetic/runtime-source verification only.'})

    matrix = '''# AUDIT-R37 — Ma trận kiểm chứng / đóng lỗi Giai đoạn 5

Kết luận: **GO cấp mã nguồn**, đóng đủ **R35-01..R35-07 và R36-01** trong phạm vi kiểm chứng cô lập. Mọi kết quả dưới đây được chạy mới trên cây làm việc có dấu vân tay ở `evidence/integrity-before.json`.

## 11 cổng yêu cầu

| # | Lệnh nguyên văn | Kết quả mới | Mã thoát gốc |
|---|---|---|---:|
'''
    descriptions = ['819/819 PASS', '221/221 PASS', '88/88 PASS', '4/4 PASS', '28/28 PASS',
        '8/8 nhóm PASS, có hồi quy R35 và R36-01', '0 lỗi', '3/3 pass:true',
        '3/3 bugReproduced:false', '1/1 bugReproduced:false', '10/10 PASS, gồm R36-UI-new-file-clears-unsaved-marker']
    for i, run in enumerate(runs):
        matrix += f"| {i+1} | `{run['command']}` | {descriptions[i]} | {run['exitCode']} |\n"
    matrix += '''
Hai cổng 9–10 có mã thoát 1 theo quy ước đảo của script lịch sử: `results.some(r => !r.bugReproduced)` đặt exit 1. Đã đọc mã và kiểm tra toàn bộ JSON mới; đây là PASS theo tiêu chí Owner yêu cầu. Không sửa script hoặc che mã thoát. Các bộ có trùng phạm vi, không cộng thành số tình huống duy nhất.

Log nguyên bản và thời gian: `evidence/gate-runs.json`, `evidence/01-independent.log` .. `11-r36-closure.log`. JSON được sao lưu rồi loại khỏi bản sao TEMP trước khi chạy từng cổng để tránh dùng lại bằng chứng cũ; bản gốc trong repo giữ nguyên.

## Đóng từng lỗi

| Mã | Trạng thái | Bằng chứng và hành vi đã xác nhận |
|---|---|---|
'''
    for row in review:
        matrix += f"| {row['id']} | {row['status']} | {row['proof']} |\n"
    matrix += '''
## Giới hạn

Giao diện được kiểm bằng thân hàm nguồn trong bộ mô phỏng React hooks, không phải trình duyệt thật. SQLite/dữ liệu/file thử đều giả và cô lập; mạng TCP/DNS/fetch bị chặn. Không gọi LMS/Gemini thật, không chạy build hoặc nghiệm thu vận hành. Nhóm 8 Phase5 kiểm trực tiếp 01/06/07 và nhánh 02/R36-01; các ca 03/04/05 được chứng minh bằng bộ R35/R36 riêng. Không suy diễn PASS của cả nhóm thành chứng cứ riêng cho mọi lỗi.
'''
    (ROOT / 'docs/audits/round-37/REGRESSION_MATRIX.md').write_text(matrix, encoding='utf-8')

    source_hash_lines = '\n'.join(f"- `{p}`: `{before[p]}`" for p in changed)
    report = f'''# AUDIT-R37 — Closure Verification Giai đoạn 5

**Kết luận: GO cấp mã nguồn cho Giai đoạn 5 trong phạm vi kiểm định.** Đóng đủ **8/8 mã R35-01..R35-07 và R36-01**; không phát hiện lỗi cần sửa thêm trong phần nguồn đã rà. Kết luận này thay thế NO-GO cấp mã nguồn của AUDIT-R36, không thay cho nghiệm thu tài khoản/dữ liệu/LMS thật.

Kiểm định ngày 21/10/2026, do chính Codex của phiên hiện tại thực hiện, không ủy quyền agent khác. Cấu hình Owner yêu cầu: `gpt-6.1-sol`, suy luận `high`; không có chứng thư độc lập xác nhận cấu hình mô hình thực chạy. HEAD `{snapshot['head']}`; đối tượng là cây làm việc hiện tại, gồm thay đổi chưa commit/chưa được Git theo dõi. Không sửa mã sản phẩm, không tạo commit.

## 1. Kết quả chạy mới

Đã chạy **đủ 11/11 lệnh nguyên văn** trong `%TEMP%\\mindx-round31-r36-check`, với `ESBUILD_BINARY_PATH=%TEMP%\\mindx-esbuild.exe`. Năm bộ nền tảng đạt **819/819, 221/221, 88/88, 4/4, 28/28**; Phase5 đạt đủ 8 nhóm (gồm ca mới R36-01); TypeScript 0 lỗi; core R35 đạt 3/3; UI R35 có 3/3 `bugReproduced:false`; barem R35 có 1/1 `bugReproduced:false`; R36 closure đạt **10/10**, không còn FAIL.

Có **9 lệnh thoát 0 và 2 lệnh thoát 1 theo quy ước bộ dò cũ**. Hai script R35 UI/barem cố ý thoát 1 khi lỗi gốc không còn tái hiện. Đã giữ nguyên mã thoát, đọc đủ JSON mới và đọc mã script, không sửa script lịch sử để đổi thành 0. Ma trận đầy đủ, lệnh/log/JSON và giới hạn từng ca ở `REGRESSION_MATRIX.md` và `evidence/results.json`.

## 2. Rà trực tiếp bản sửa R36-01

Đối chiếu SHA-256 với dấu vân tay nguồn trước R36 cho thấy chỉ hai tệp sau thay đổi trong tập nguồn/config/quy tắc được R36 bảo vệ:

{source_hash_lines}

Tại `homework-auto-grader-tab.tsx:231–274`, mã lập bản ghép cuối từ hàng máy chủ và bản nháp cục bộ trước. Nó so cả `draftSeq` và `fileHash`: cùng file chưa được xác nhận lưu thì giữ điểm/nhận xét và cờ chưa lưu; file mới thì dùng dữ liệu máy chủ, xóa cờ phụ và thay bản nháp. Sau đó `:306–307` mới đặt `unsavedSubIds` và `submissions` từ cùng kết quả. Không còn cập nhật cờ dùng chung bên trong hàm cập nhật React của nhánh này. Phạm vi lớp/buổi và thứ tự phản hồi vẫn được kiểm trước khi ghép.

Tại `scripts/test-phase5.ts:686–835`, ca hồi quy chạy thân hàm nguồn thật với dữ liệu giả: lưu nháp lỗi → làm mới cùng file giữ nguyên chữ/cờ → đổi `fileHash` sang file-v2 → ngay lần làm mới đầu, chữ cũ được thay và cờ hết → hàm Duyệt trả true, gửi đúng một yêu cầu. Test không chỉ kiểm tra chuỗi mã hoặc cờ ngoài giao diện. Bộ R36 độc lập cho cùng quan sát: `unsaved={{}}`, `approveResult=true`, `approvalCalls=1`; lần làm mới thứ hai vẫn ổn định.

Đã đọc thêm các bên gọi và nhánh liên quan: API submissions/approve/download-and-grade, cấu hình barem/mặc định giao diện, ScoreAuditor, chấm đơn/chấm lô, tải bài và parser Scratch/GameMaker. R35-01 chặn thang 10 ở các cổng và chấp nhận 80/100; R35-02 giữ nháp cùng file; R35-03 không để phản hồi buổi cũ lấn buổi mới; R35-04 Stop chặn học viên kế tiếp và ghi kết quả; R35-05 đọc bảng mới trước lọc; R35-06 giữ toán hạng, giới hạn đệ quy; R35-07 từ chối GML/YY hỏng. Chi tiết định vị và chứng cứ từng mã: `evidence/source-review.json`.

## 3. Tính toàn vẹn và an toàn

- Bản sao chứa đúng `package.json`, `tsconfig.json`, `next.config.ts`, `next-env.d.ts`, `src`, `scripts`, `docs`, `data/config`; `node_modules` là junction tới thư viện sẵn có. **{snapshot['copiedMatchingFiles']:,} tệp thuộc tập bảo vệ có trong bản sao khớp từng SHA-256**. Không sao chép `.env*`, DB thật hay `playwright-auth`; không cài thư viện.
- Chỉ tiến trình thử nhận đường dẫn esbuild yêu cầu; gỡ biến môi trường có tên chứa PASSWORD/API_KEY/TOKEN/SECRET và dùng network-guard lịch sử chặn TCP/DNS/fetch. Dòng dotenv “injected env (0)” trong log không có nghĩa đã sao chép file bí mật; kiểm tra bản sao xác nhận không có file bị cấm.
- Bằng chứng R35/R36 được sao lưu riêng trong R37 trước khi chạy; chỉ bản sao TEMP của JSON đầu ra bị thay. Không chạy cổng thử có ghi bằng chứng trong repo chính, không dùng lại JSON lịch sử làm kết quả mới.
- Sau kiểm thử và sau dọn dẹp, **{len(before):,}/{len(before):,} tệp bảo vệ nguyên vẹn**, gồm **{len(historical):,} tệp R12–R36**. Không thêm/xóa tệp trong các tập bảo vệ. `next-env.d.ts` giữ đúng `{EXPECTED_ENV}`.
- Đã gỡ junction riêng trước khi xóa TEMP; xác nhận không còn liên kết con rồi xóa bản sao và hai thư mục dữ liệu giả do bộ thử tạo. Thư viện gốc và tệp esbuild đã tồn tại được giữ lại. Lượt dọn có Force bị kiểm tra tự động từ chối với lý do “blocked by policy”; cách không dùng Force đã hoàn tất. PowerShell cũ lỗi khi gỡ junction nên dùng xóa liên kết không đệ quy, sau đó dọn thư mục thường bằng PowerShell. Chi tiết: `evidence/cleanup.json`.

Chỉ thêm hồ sơ `round-37` và nối đúng một dòng AUDIT-R37 vào cuối kế hoạch. Phần kế hoạch có sẵn được giữ nguyên từng byte; `[x]` xác nhận hoàn tất kiểm định, không tự mở rộng nghiệm thu TASK-5.x. Dấu vân tay trước/sau, bản kế hoạch trước và trạng thái Git được giữ trong `evidence/` để đối chiếu.

## 4. Chưa kiểm tra và việc tiếp theo

Chưa chạy giao diện trong trình duyệt thật, bản dựng ứng dụng, LMS/Gemini thật, dữ liệu thật hoặc toàn bộ Giai đoạn 6/7 trong R37. Ca tải bài R35-05 dừng có chủ ý tại BrowserManager giả, chỉ xác nhận việc đọc mới trước khi lọc. Stop chưa chứng minh hủy được yêu cầu AI đã gửi ra ngoài. Bộ mô phỏng hooks không phải chứng minh về mọi lịch chạy React.

Không còn việc sửa mã cần làm cho 8 mã thuộc vòng đóng lỗi này. Owner chưa cần thao tác hay cung cấp tài khoản. Nghiệm thu vận hành thật vẫn cần một lượt riêng có phạm vi được duyệt.
'''
    (ROOT / 'docs/audits/round-37/REPORT.vi.md').write_text(report, encoding='utf-8')

    plan = ROOT / 'MINDX_AUTOMATION_PLAN.md'
    prefix = (OUT / 'plan-before.bin').read_bytes()
    assert plan.read_bytes() == prefix, 'Plan changed during audit; refusing overwrite'
    assert b'**AUDIT-R37:**' not in prefix
    line = '* [x] **AUDIT-R37:** Đã hoàn tất Closure Verification độc lập Giai đoạn 5 tại `docs/audits/round-37/REPORT.vi.md`; **GO cấp mã nguồn**, thay thế NO-GO của AUDIT-R36 trong phạm vi nguồn đã kiểm. Đóng 8/8 mã R35-01..R35-07 và R36-01; chạy đủ 11 cổng yêu cầu: R31 đạt 819/819, 221/221, 88/88, 4/4, 28/28; Phase5 đủ 8 nhóm, TypeScript 0 lỗi, core R35 3/3, UI/barem R35 hết tái hiện (giữ đúng mã thoát 1 lịch sử), R36 10/10. Giữ nguyên 1.738/1.738 tệp bảo vệ gồm 1.657 hồ sơ R12–R36 và next-env.d.ts đúng hash; đã xóa bản sao TEMP và dữ liệu giả. Không sửa sản phẩm, chưa nghiệm thu trình duyệt/LMS/Gemini/dữ liệu thật. Dấu [x] xác nhận hoàn tất kiểm định, không tự nghiệm thu vận hành TASK-5.x.'
    newline = '\r\n' if b'\r\n' in prefix else '\n'
    plan.write_bytes(prefix + (newline + line + newline).encode('utf-8'))
    assert plan.read_bytes().startswith(prefix)
    assert protected() == before
    integrity = {'beforeCount': len(before), 'afterCount': len(after), 'unchanged': True,
        'historicalRounds': '12..36', 'historicalFileCount': len(historical),
        'historicalUnchanged': True, 'nextEnvSha256': EXPECTED_ENV,
        'changed': [], 'added': [], 'deleted': [], 'planPriorBytesPreserved': True,
        'planBeforeSha256': sha(OUT / 'plan-before.bin'), 'planAfterSha256': sha(plan)}
    save('integrity-after-cleanup.json', integrity)
    result = {'audit': 'AUDIT-R37', 'completedAt': datetime.now(timezone.utc).isoformat(),
        'verdict': 'GO_SOURCE', 'head': snapshot['head'],
        'scope': 'Phase 5 closure for exact current working-tree contents including uncommitted/untracked files; source-level and synthetic verification',
        'reviewer': {'actor': 'Current Codex assistant; direct independent audit, no delegated agents',
            'requestedModel': 'gpt-6.1-sol', 'requestedReasoningEffort': 'high',
            'identityProvenance': 'Owner-requested configuration; no independent runtime attestation'},
        'requiredCommandsExecuted': 11, 'gatesPassedByRequiredCriteria': 11,
        'exitCodeZeroCount': 9, 'expectedLegacyExitCodeOneCount': 2,
        'gates': runs, 'closures': review, 'openFindings': [],
        'changedSinceR36': {p: before[p] for p in changed},
        'integrity': integrity, 'cleanup': cleanup,
        'snapshot': {'path': snapshot['root'], 'copiedMatchingFiles': snapshot['copiedMatchingFiles'],
            'forbiddenFilesFound': [], 'nodeVersion': snapshot['nodeVersion'],
            'esbuildPath': snapshot['esbuildPath'], 'esbuildSha256': snapshot['esbuildSha256']},
        'notChecked': ['Real browser and React scheduling', 'Application build',
            'Real LMS/Gemini/accounts/student data', 'Complete Phase 6/7 flow', 'Cancellation of already dispatched external AI requests'],
        'productCodeEdited': False, 'historicalAuditFilesEdited': False,
        'report': 'docs/audits/round-37/REPORT.vi.md',
        'regressionMatrix': 'docs/audits/round-37/REGRESSION_MATRIX.md'}
    save('results.json', result)
    (OUT / 'git-status-after.txt').write_bytes(subprocess.check_output(['git', 'status', '--porcelain=v1', '-uall'], cwd=ROOT))
    save('artifact-manifest.json', {p.relative_to(OUT.parent).as_posix(): sha(p)
        for p in sorted(OUT.parent.rglob('*')) if p.is_file() and p.name != 'artifact-manifest.json' and '__pycache__' not in p.parts})
    print(json.dumps({'verdict': result['verdict'], 'gates': len(runs), 'closed': len(review),
        'protected': len(before), 'historical': len(historical), 'tempRemoved': not SNAP.exists()}, ensure_ascii=False))

if __name__ == '__main__':
    main()
