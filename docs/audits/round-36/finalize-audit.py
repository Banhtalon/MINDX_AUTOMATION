"""Record final proof, remove only this run's checked TEMP paths, append audit status."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
from datetime import datetime, timezone

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT = HERE / 'evidence'
spec = importlib.util.spec_from_file_location('r36_runner', HERE / 'audit-runner.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

def read(name):
    return json.loads((OUT / name).read_text(encoding='utf-8'))

def save(name, obj):
    (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

before = read('integrity-before.json')
assert before == runner.protected(), 'Source/history drift: do not finalize'
snapshot = read('snapshot.json')
snap = Path(snapshot['root'])
assert snap.parent.resolve() == runner.TEMP and snap.name == 'mindx-round31-r36-check'
assert not snap.is_symlink()
source_prefixes = ('src/', 'scripts/', 'data/config/')
snapshot_drift = [p for p, h in before.items() if (p.startswith(source_prefixes) or p in runner.TOP) and runner.sha(snap / p) != h]
assert not snapshot_drift, snapshot_drift

diagnostic = snap / 'docs/audits/round-36/evidence/15-closure-diagnostic.log'
if diagnostic.exists():
    shutil.copy2(diagnostic, OUT / diagnostic.name)
derived = snap / 'docs/audits/round-36/ui-harness-derived.mjs'
shutil.copy2(derived, HERE / derived.name)
# PowerShell's native output capture is UTF-16; normalize only new R36 logs.
for p in OUT.glob('15-*.log'):
    data = p.read_bytes()
    if data.startswith((b'\xff\xfe', b'\xfe\xff')):
        p.write_text(data.decode('utf-16'), encoding='utf-8')

gates = read('gate-runs.json')
artifact_map = {
    '01-independent': ('fresh-verify-results.json', 819),
    '11-media': ('fresh-native-media-results.json', 221),
    '12-worker': ('fresh-native-worker-results.json', 88),
    '13-name': ('fresh-pdf-name-results.json', 4),
    '14-boundary': ('fresh-pdf-boundary-results.json', 28),
}
for g in gates:
    if g['id'] in artifact_map:
        filename, expected = artifact_map[g['id']]
        d = read(filename)
        assert d['total'] == expected and d['passed'] == expected and d['failed'] == 0
        assert g['exitCode'] == 0
        g.update(status='PASS', summary={k: d[k] for k in ['total', 'passed', 'failed']}, artifact=filename)
    elif g['id'].startswith(('02-', '03-', '04-', '05-')):
        assert g['exitCode'] == 1 and 'MODULE_NOT_FOUND' in (OUT / g['log']).read_text(encoding='utf-8')
        g.update(status='UNAVAILABLE_REQUESTED_PATH', reason='Requested historical path absent; corresponding unmodified R31 suite run separately')
    elif g['id'] in ['09-ui', '10-rubric']:
        filename = 'fresh-' + ('ui' if g['id'] == '09-ui' else 'rubric') + '-repro-results.json'
        d = read(filename)
        assert all(x['bugReproduced'] is False for x in d['results']) and g['exitCode'] == 1
        g.update(status='CLOSURE_CRITERIA_PASS', reason='Historical bug detector exits 1 when any bug no longer reproduces', artifact=filename)
    elif g['id'] == '08-core':
        assert all(x['pass'] for x in read('fresh-core-repro-results.json')['results'])
        assert g['exitCode'] == 0
        g.update(status='PASS', artifact='fresh-core-repro-results.json')
    else:
        assert g['exitCode'] == 0
        g.update(status='PASS')
assert len(gates) == 14
closure = read('closure-results.json')
assert (closure['total'], closure['passed'], closure['failed']) == (10, 9, 1)
assert [r['id'] for r in closure['results'] if not r['pass']] == ['R36-UI-new-file-clears-unsaved-marker']
observation = read('new-file-observation.json')
assert observation['approveResult'] is False and observation['approvalCalls'] == 0
assert observation['afterSecondRefresh']['approveResult'] is True

created = read('temp-created.json')
targets = []
for name in created:
    target = runner.TEMP / name
    assert target.parent.resolve() == runner.TEMP
    assert name == snap.name or name.startswith(('mindx-round31-fixtures-', 'mindx-round31-native-worker-'))
    assert name not in snapshot['priorTemp']
    assert target.resolve() == target.absolute() and not target.is_symlink()
    targets.append(target)
assert snap in targets
print('Validated cleanup targets: ' + json.dumps([str(p) for p in targets]), flush=True)
junction = snap / 'node_modules'
assert junction.is_junction() and junction.resolve() == (ROOT / 'node_modules').resolve()
os.rmdir(junction)  # Removes only the junction, never its source target.
for target in targets:
    shutil.rmtree(target)
assert all(not t.exists() for t in targets)
assert (ROOT / 'node_modules/tsx/dist/cli.mjs').is_file()

after = runner.protected()
assert before == after
expected_next = 'B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000'
assert runner.sha(ROOT / 'next-env.d.ts') == expected_next
plan = ROOT / 'MINDX_AUTOMATION_PLAN.md'
original_plan = (OUT / 'plan-before.bin').read_bytes()
assert plan.read_bytes() == original_plan, 'Plan changed externally; refusing to overwrite'
status_line = '* [x] **AUDIT-R36:** Đã hoàn tất tái kiểm định độc lập Giai đoạn 5 tại `docs/audits/round-36/REPORT.vi.md`; **NO-GO cấp mã nguồn**: đóng 7/7 tình huống gốc R35-01..R35-07 nhưng phát hiện R36-01 (P2), cờ nháp cũ chặn Duyệt sau khi file đổi phiên bản. Các bộ tương ứng đúng vị trí R31 đạt 819/819, 221/221, 88/88, 4/4, 28/28; Phase 5 và TypeScript đạt; bộ R36 bổ sung đạt 9/10. Đã chạy đủ 10 lệnh yêu cầu, giữ rõ 4 đường dẫn không tồn tại và mã thoát đảo của 2 bộ dò cũ; không đổi chúng thành PASS. Giữ nguyên 1.691/1.691 tệp bảo vệ, gồm 1.611 hồ sơ R12–R35 và next-env.d.ts đúng hash; đã xóa bản sao TEMP cùng dữ liệu giả. Không sửa sản phẩm hoặc dùng dịch vụ/dữ liệu thật. Dấu [x] xác nhận hoàn tất kiểm định, chưa nghiệm thu TASK-5.x.\r\n'
with plan.open('ab') as handle:
    handle.write(('\r\n' + status_line).encode('utf-8'))
assert plan.read_bytes().startswith(original_plan)

review_paths = ['src/app/syllabus-config/page.tsx','src/app/api/config/route.ts','src/lib/gemini/score-auditor.ts','src/lib/gemini/homework-grader.ts','src/app/api/homework-grader/download-and-grade/route.ts','src/components/homework-auto-grader-tab.tsx','src/lib/playwright/download-submissions.ts','src/lib/file-parsers/game-reader.ts']
r35_before = json.loads((ROOT / 'docs/audits/round-35/evidence/integrity.json').read_text(encoding='utf-8'))['after']
changed_since_r35 = [p for p, h in r35_before.items() if p in before and before[p] != h]
closure_ids = {'R35-01': 'rubric', 'R35-02': 'ui', 'R35-03': 'ui', 'R35-04': 'ui', 'R35-05': 'core', 'R35-06': 'core', 'R35-07': 'core'}
results = {
    'audit': 'AUDIT-R36', 'completedAt': datetime.now(timezone.utc).isoformat(),
    'verdict': 'NO-GO_SOURCE', 'head': snapshot['head'],
    'scope': 'Current working tree including uncommitted/untracked files; Phase 5 closure, no product edits',
    'reviewer': {'actor': 'Current Codex assistant, self review, no delegated agents', 'requestedModel': 'gpt-6.1-sol', 'requestedReasoningEffort': 'high', 'identityProvenance': 'Owner-requested configuration; no independent runtime attestation'},
    'requiredCommandsExecuted': 10, 'correctedPathCommandsExecuted': 4,
    'gates': gates,
    'supplementalGate': {'command': 'node node_modules/tsx/dist/cli.mjs docs/audits/round-36/closure-repro.mjs', 'cwd': str(snap), 'exitCode': 1, 'total': 10, 'passed': 9, 'failed': 1, 'artifact': 'closure-results.json', 'log': '15-closure.log'},
    'originalFindingClosure': [{'id': k, 'status': 'CLOSED_SOURCE_ORIGINAL_SCENARIO', 'artifact': 'fresh-' + v + '-repro-results.json', 'relatedNewFinding': 'R36-01' if k == 'R35-02' else None} for k, v in closure_ids.items()],
    'newFindings': [{'id': 'R36-01', 'severity': 'P2', 'status': 'OPEN', 'title': 'Stale unsaved marker blocks approval after a new file replaces the local draft', 'file': review_paths[5], 'lines': [227,246,278,290,557,566], 'evidence': 'new-file-observation.json', 'observation': observation, 'mitigation': 'A second refresh clears the stale marker; no server data loss or incorrect LMS write claimed', 'fixScope': 'Derive merged rows and both unsaved flag sets consistently after comparing fileHash and draftSeq'}],
    'reviewedFiles': [{'path': p, 'sha256': before[p]} for p in review_paths],
    'changedSinceR35': changed_since_r35,
    'testCoverageNote': 'Phase5 group8 directly tests R35-01,06,07 only; 02,03,04,05 verified separately',
    'snapshot': {k: v for k, v in snapshot.items() if k != 'copiedHashes'},
    'snapshotProductFilesUnchangedAfterTests': not snapshot_drift,
    'integrity': {'protectedCount': len(before), 'unchangedCount': len(after), 'allUnchanged': before == after, 'historicalFilesCount': sum(p.startswith('docs/audits/') for p in before), 'historicalRounds': '12..35', 'srcScriptsCount': sum(p.startswith(('src/', 'scripts/')) for p in before), 'nextEnvExpectedSha256': expected_next, 'nextEnvActualSha256': runner.sha(ROOT / 'next-env.d.ts'), 'filesBefore': 'integrity-before.json', 'filesAfter': after, 'added': [], 'removed': [], 'changed': []},
    'cleanup': {'snapshotAbsent': not snap.exists(), 'nodeModulesJunctionRemovedBeforeSnapshot': True, 'removedOnlyNewValidatedPaths': [str(p) for p in targets], 'allTargetsAbsent': all(not p.exists() for p in targets), 'sharedNodeModulesPreserved': True, 'esbuildRetained': True},
    'plan': {'appendOnly': plan.read_bytes().startswith(original_plan), 'originalBytesBackup': 'plan-before.bin', 'status': 'Audit completed, acceptance not approved'},
    'preparatoryAttempts': [{'log': '15-closure-preload-error.log', 'reason': 'Windows backslashes removed by NODE_OPTIONS parser; tests did not start'}, {'log': '15-closure-harness-missing-binding.log', 'reason': 'Missing auditCriterionGrades binding in supplemental VM fixture; corrected and rerun'}, {'log': '15-closure-diagnostic.log', 'reason': 'Diagnostic observation confirmed missing fixture binding, not product error'}],
    'notVerified': ['Real browser React interaction', 'Real LMS/Gemini/authentication/data/submissions', 'Application build', 'Full Phase 6/7 flows'],
}
save('results.json', results)
save('integrity-final.json', {'allUnchanged': before == after, 'beforeCount': len(before), 'afterCount': len(after), 'snapshotProductFilesUnchanged': not snapshot_drift, 'nextEnvSha256': expected_next, 'planAppendOnly': True})
matrix = ['# AUDIT-R36 — Ma trận hồi quy', '', 'Kết luận: **NO-GO_SOURCE**, 7/7 tình huống gốc R35 đóng; R36-01 (P2) còn mở.', '', '## Lệnh thực thi nguyên bản và đối ứng', '', '| ID | Lệnh | Exit | Đánh giá |', '|---|---|---:|---|']
for g in gates:
    summary = g.get('summary')
    status = g['status'] + (f" ({summary['passed']}/{summary['total']})" if summary else '')
    matrix.append(f"| {g['id']} | `{g['command']}` | {g['exitCode']} | {status}; [log](evidence/{g['log']}) |")
matrix += ['', 'Bốn đường dẫn yêu cầu không tồn tại được giữ nguyên UNAVAILABLE; bốn cổng R31 đối ứng chạy bằng tsx. UI/barem R35 dùng quy ước mã thoát đảo khi lỗi đã hết; đã xác nhận JSON đầy đủ, không đổi mã thoát gốc.', '', '## Trạng thái từng lỗi cũ', '', '| Mã | Trạng thái | Bằng chứng mới |', '|---|---|---|']
for k, v in closure_ids.items():
    matrix.append(f'| {k} | CLOSED_SOURCE tình huống gốc' + ('; nhánh đổi file còn R36-01' if k == 'R35-02' else '') + f' | [Kết quả {v}](evidence/fresh-{v}-repro-results.json) |')
matrix += ['', '## Ca xác minh bổ sung R36', '', '| Ca | Kết quả |', '|---|---|']
for case in closure['results']:
    matrix.append(f"| `{case['id']}` | {'PASS' if case['pass'] else 'FAIL — R36-01 (P2)'} |")
matrix += ['', 'Tổng bổ sung: **9/10**, exit 1. [Dữ liệu ca thử](evidence/closure-results.json), [quan sát R36-01](evidence/new-file-observation.json).', '', '## Toàn vẹn và giới hạn', '', f'- {len(before)}/{len(before)} tệp bảo vệ giữ nguyên, gồm 1.611 tệp R12–R35; next-env.d.ts đúng SHA-256 yêu cầu.', '- Bản sao có 1.689 tệp được bảo vệ khớp nguồn; mã sản phẩm trong bản sao giữ nguyên sau thử.', '- Đã xóa bản sao TEMP và hai thư mục dữ liệu giả mới tạo; node_modules gốc giữ nguyên.', '- Chưa kiểm tra trình duyệt thật/LMS/Gemini thật/build hoặc toàn bộ Giai đoạn 6/7.', '- Không dùng tổng lượt thử trùng phạm vi làm số tình huống duy nhất.', '']
(HERE / 'REGRESSION_MATRIX.md').write_text('\n'.join(matrix), encoding='utf-8')
(OUT / 'git-status-after.txt').write_bytes(subprocess.check_output(['git', 'status', '--porcelain=v1', '-uall'], cwd=ROOT))
print(json.dumps({'verdict': results['verdict'], 'protectedFilesUnchanged': len(after), 'closedOriginalFindings': 7, 'newOpenFindings': 1, 'cleanup': results['cleanup'], 'planAppendOnly': True}, ensure_ascii=False), flush=True)
