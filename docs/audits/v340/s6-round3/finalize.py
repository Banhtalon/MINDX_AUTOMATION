import hashlib, json, pathlib, subprocess

root=pathlib.Path.cwd()
out=pathlib.Path(__file__).resolve().parent
note='**Kiểm định độc lập S6 Round 3 (2026-10-30): GO cục bộ.** Đóng toàn bộ **7/7 mục S6-01–S6-07**; ba lỗi còn mở về bỏ ghép học viên, sửa đánh giá sau combo và dữ liệu cũ của học viên đã nghỉ không còn tái hiện. Chạy mới **20/20 ca dữ liệu/API, 34/34 ca giao diện, TypeScript và S6-T1–S6-T4 PASS**, không chạy lại toàn bộ 18 cổng/build production. Nguồn ngoài bốn tệp sửa Round 3 khớp Round 2; S6-07 tái sử dụng bằng chứng production chẩn đoán Round 2 trên nguồn không đổi. **142/142 tệp nguồn/test và `next-env.d.ts` giữ nguyên trong audit**, không truy cập DB/cache/hồ sơ đăng nhập thật, không commit. Đủ điều kiện đóng S6 cục bộ; chưa nghiệm thu production/LMS/Teaching thật hoặc toàn bộ v3.4.0, chưa triển khai S7. Báo cáo: [CODEX_S6_ROUND3.md](docs/audits/v340/CODEX_S6_ROUND3.md); bằng chứng: `docs/audits/v340/s6-round3/`. Các kết luận NO-GO bên dưới là lịch sử trước bản sửa.'
for name in ('PROJECT_STATE.md','MINDX_AUTOMATION_PLAN.md','CHANGELOG.md'):
    p=root/name
    content=p.read_bytes()
    nl=b'\r\n' if b'\r\n' in content else b'\n'
    marker=b'\n' if name!='CHANGELOG.md' else '## [v3.4.0'.encode()
    if name=='CHANGELOG.md':
        idx=content.index(b'\n',content.index(marker))+1
        addition=nl+('- '+note).encode('utf8')+nl
    else:
        idx=content.index(b'\n')+1
        addition=nl+('> '+note).encode('utf8')+nl
    assert 'S6 Round 3 (2026-10-30): GO cục bộ'.encode() not in content
    content=content[:idx]+addition+content[idx:]
    old='(Màn 5 `/teaching-projects` 1 nút bấm + Liên thông các màn hình — Round 2 NO-GO, còn S6-02/03/04)'.encode('utf8')
    new='(Màn 5 `/teaching-projects` 1 nút bấm + Liên thông các màn hình — Round 3 GO cục bộ, 7/7 CLOSED)'.encode('utf8')
    if name=='CHANGELOG.md': content=content.replace(old,new)
    p.write_bytes(content)

before=json.loads((out/'source-before.json').read_text(encoding='utf8'))
protected=[k for k in before if k.startswith(('src/','scripts/')) or k=='next-env.d.ts']
mirror=pathlib.Path((out/'mirror-path.txt').read_text(encoding='utf8'))
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
changed=[k for k in protected if sha(root/k)!=before[k]['sha256']]
mirror_changed=[k for k in protected if sha(mirror/k)!=before[k]['sha256']]
probe_checks={name:sha(mirror/f'{name}.ts')==sha(root/'docs/audits/v340/s6-round2'/f'{name}.ts.txt') for name in ('repository-probe','independent-ui')}
observations={}
for name,count in [('repository-observations',20),('ui-observations',34)]:
    obs=json.loads((out/f'{name}.json').read_text(encoding='utf8'))
    observations[name]={'count':len(obs),'pass':sum(x['pass'] for x in obs)}
    assert len(obs)==count and all(x['pass'] for x in obs)
checks=[json.loads(l) for l in (out/'checks.jsonl').read_text(encoding='utf8').splitlines()]
assert len(checks)==4 and all(x['exit']==0 for x in checks)
integrity={'source_test_files':sum(k.startswith(('src/','scripts/')) for k in protected),'next_env_unchanged':'next-env.d.ts' not in changed,'changed_protected_files':changed,'mirror_mismatches':mirror_changed,'round2_probe_byte_identity':probe_checks,'owner_data_read_or_hashed':False,'fresh_checks':checks,'observations':observations}
(out/'source-integrity.json').write_text(json.dumps(integrity,indent=2),encoding='utf8')
assert not changed and not mirror_changed and all(probe_checks.values())
(out/'git-status-final.txt').write_bytes(subprocess.check_output(['git','status','--short']))
report=(root/'docs/audits/v340/CODEX_S6_ROUND3.md').read_text(encoding='utf8')
assert report.startswith('Verdict: GO')
assert all(f'S6-{i:02}' in report for i in range(1,8))
print(json.dumps({'protected_source_test_files':integrity['source_test_files'],'next_env_unchanged':integrity['next_env_unchanged'],'changed':changed,'mirror_mismatches':mirror_changed,'probes_match':probe_checks,'observations':observations,'verdict':'GO'},indent=2))
