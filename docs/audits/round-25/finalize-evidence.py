"""Reconcile fresh results with source bytes; writes evidence in round-25 only."""
import datetime
import hashlib
import json
from pathlib import Path
import re

OUT=Path(__file__).resolve().parent
ROOT=OUT.parents[2]
read=lambda p:json.loads(p.read_text(encoding='utf-8'))
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def write(name,value): (OUT/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

current=read(OUT/'verify-results.json'); prior=read(OUT/'round24-results.json')
lookup={r['id']:r for r in current['results']}
assert len(lookup)==current['total']==344
assert prior['total']==prior['passed']==230 and prior['failed']==0
assert [(r['id'],r['criterion'],r['pass'])for r in current['results'][:230]]==[(r['id'],r['criterion'],r['pass'])for r in prior['results']]
assert current['passed']==312 and current['failed']==32
native=read(OUT/'native25-results.json'); worker=read(OUT/'native-worker-results.json')
assert (native['total'],native['passed'],native['failed'])==(25,11,14)
assert (worker['total'],worker['passed'],worker['failed'])==(9,3,6)
for r in native['results']:
    assert r['pass']==lookup[r['id']]['pass'] and r['parseStatus']==lookup[r['id']]['observation']['parseStatus']
    assert r['decoderMatches']
fresh={f'R{n}':read(OUT/f'round{n}-results.json') for n in [12,13,16,17,20,21,22,23]}
compat={r['observation']['originalId']:r['id'] for r in current['results'] if r['id'].startswith('R24-COMPAT-R20-')}
expected_drift={'API-approval-control','R20-03-legacy-reapproval','R20-05-override-control','R20-06-latest-control'}
assert {r['id']for r in fresh['R20']['results'] if not r['pass']}==expected_drift==set(compat)
assert all(lookup[v]['pass']for v in compat.values())
assert [(r['id'],r['pass']) for r in fresh['R16']['results'] if not r['pass']]==[('PHASE1-SCHEMA',False)]
assert lookup['R23-COMPAT-R16-schema']['pass']
assessments={
 '01':'Các mẫu R24 đã được chặn; 8 WebP hỏng có dữ liệu giả hợp hình thức và 3 PDF Root mồi vẫn PARSED; 3 WebP hợp lệ bị từ chối.',
 '02':'Mã tiêu chí, giới hạn barem, bằng chứng và tổng điểm tính bằng code đạt hồi quy cùng đối chứng mới.',
 '03':'Hash tổng hợp chặn nội dung duyệt bị sửa; hợp đồng duyệt hiện tại đạt các đối chứng tương thích R20.',
 '04':'File thay đổi/xóa trước hoặc trong AI bị chặn, kể cả nhánh parsedContent có sẵn và khác file vật lý.',
 '05':'Handler gửi barem hiện hành và chặn duyệt bài PARSE_ERROR; điểm ghi đè hợp lệ đạt hợp đồng hiện tại.',
 '06':'Duyệt đơn/hàng loạt bắt buộc đủ năm trường đã xem; bản xem đủ nhưng cũ bị 409; phiên bản file giữ qua mở lại DB.',
 '07':'Tên/ID từng phần hoặc sai submissionId trong modal không cho Save; khóa chủ sở hữu đạt hồi quy.',
 '08':'lessonId khác buổi hoặc thiếu ánh xạ bị chặn; đối chiếu session/class đạt hồi quy.',
 '09':'R24 31/31 đạt; còn 18 ca mới nhận sai phản hồi có trường mâu thuẫn/null/mảng, tên kết quả ngoài trường chọn hoặc trường định danh/điểm bị bọc object.',
 '10':'HTTP thành công chưa đủ; quyết định, điểm và nhận xét đọc lại phải khớp bản duyệt trong DOM mô phỏng.',
 '11':'Drift trong lúc Save hoặc đọc lại chặn VERIFIED; nội dung và hash được kiểm lại.',
 '12':'Phản hồi lớp/buổi cũ đến muộn không ghi đè lớp/buổi mới trong kiểm chứng handler.',
 '13':'Lỗi SQLite ở cả hai bảng được hoàn tác; chỉnh sửa nhiều trường không hợp lệ không ghi một phần hoặc tiêu thụ sequence.',
 '14':'Tải lỗi/toàn phần/một phần dừng AI; lượt thành công chỉ chấm đúng tập bài mới tải.'}
issues=[]
for old in read(OUT.parent/'round-24/issue-status.json')['issues']:
    num=old['issueId'][-2:]
    ids=set(old['independentChecks']+old['r24Checks'])
    ids.update(r['id']for r in current['results']if r['id'].startswith(f'R25-{num}-'))
    assert ids and ids.issubset(lookup), (num,ids-set(lookup))
    historical={}
    unexplained=[]
    for name,oldids in old['freshHistoricalChecks'].items():
        index={r['id']:r for r in fresh[name]['results']}; assert set(oldids).issubset(index)
        failed=[i for i in oldids if not index[i]['pass']]
        historical[name]={'passed':[i for i in oldids if index[i]['pass']],'failed':failed}
        unexplained.extend((name,i)for i in failed if name!='R20' or i not in expected_drift)
    fails=sorted(i for i in ids if not lookup[i]['pass'])
    closed=num not in ['01','09']
    if closed: assert not fails and not unexplained, (num,fails,unexplained)
    issues.append({'issueId':old['issueId'],'status':'CLOSED_SOURCE'if closed else'PARTIALLY_FIXED',
        'severity':None if closed else ('P2'if num=='01'else'P1'),'assessment':assessments[num],
        'currentChecks':sorted(ids),'failingChecks':fails,'freshHistoricalOutcomes':historical,
        'compatibilityChecks':old['compatibilityChecks'],
        'newChecks':sorted(i for i in ids if i.startswith('R25-'))})
write('issue-status.json',{'round':25,'verdict':'NO-GO','closedSource':12,'partiallyFixed':2,'issues':issues,
      'r20Compatibility':compat,'r16Compatibility':'Original 15/16; PHASE1-SCHEMA expects 7 tables, product has 8 including homework_submission_meta; R23-COMPAT-R16-schema passes.'})
before=read(OUT/'before-hashes.json'); source=read(OUT/'source-manifest.json')
oldsource=read(OUT.parent/'round-24/source-state.json')['files']
write('changes-since-r24.json',{'files':[{'path':name,'r24':oldsource.get(name),'r25':meta}for name,meta in source['files'].items() if name not in oldsource or oldsource[name]['sha256']!=meta['sha256']]})
cfg=read(OUT/'snapshot.json'); snap=Path(cfg['snapshot'])
for name,digest in current['sourceHashes'].items():
    assert digest==before[name]['sha256']==sha(snap/name)
assert sha(OUT/'verify-independent.mjs')==current['harnessSha256']==sha(snap/'docs/audits/round-25/verify-independent.mjs')
assert sha(OUT/'media-cases.mjs')==sha(snap/'docs/audits/round-25/media-cases.mjs')
for name,data in [('native-media-repro.mjs',native),('native-worker-repro.mjs',worker)]:
    assert sha(OUT/name)==data['harnessSha256']==sha(snap/'docs/audits/round-25'/name)
receipts=read(OUT/'commands.json'); latest={}
for r in receipts:
    assert sha(OUT/r['log'])==r['logSha256']
    assert Path(r['cwd'])==snap
    if 'results'in r: assert sha(OUT/r['results'])==r['resultsSha256']
    latest[r['name']]=r
assert len(latest)==17 and sum(r['exitCode']==0 for r in latest.values())==12
preservation=read(OUT/'preservation-check.json')
assert preservation['allPreserved'] and preservation['protectedCount']==487
report=(OUT/'REPORT.vi.md').read_text(encoding='utf-8')
assert all(f'| R19-{n:02} |'in report for n in range(1,15))
assert '**312/344**'in report and '**230/230**'in report and '**8/8**'in report
links=re.findall(r'\]\(([^)]+)\)',report)
broken=[link for link in links if not (OUT/link.split('#')[0]).resolve().is_file()]
assert not broken,broken
write('document-check.json',{'reportExists':True,'all14StatusRowsPresent':True,'mainCountsMatchResults':True,
      'localLinksChecked':len(links),'brokenLinks':broken,'preservationReceiptPassed':True})
write('artifact-check.json',{'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'allCommandCwdsAreSnapshot':True,
      'inheritedR24ChecksIdentical':230,'sourceHashesMatchOriginalAndSnapshot':len(current['sourceHashes']),
      'snapshotSourceDifferences':[name for name,meta in source['files'].items()if (snap/name).exists()and sha(snap/name)!=meta['sha256']],
      'mainHarnessSha256':current['harnessSha256'],'mediaOracleAgreement':25,
      'commandReceipts':len(receipts),'distinctGates':len(latest),'latestGatePassed':12,'latestGateFailed':5,
      'allLogAndResultHashesMatch':True})
write('evidence-manifest.json',{'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':{
    p.name:{'bytes':p.stat().st_size,'sha256':sha(p)}for p in sorted(OUT.iterdir())if p.is_file()and p.name!='evidence-manifest.json'}})
print(json.dumps({'closed':12,'open':2,'checks':current['total'],'passed':current['passed'],'failed':current['failed'],'protected':read(OUT/'preservation-check.json')['protectedCount']}))
