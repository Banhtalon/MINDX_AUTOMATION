"""Write the R38 audit, verify protected files, append one plan entry, and remove owned TEMP only."""
import hashlib, json, os, shutil, subprocess
from pathlib import Path
from datetime import datetime, timezone
from importlib.util import spec_from_file_location, module_from_spec
ROOT=Path(__file__).resolve().parents[3]
AUDIT=ROOT/'docs/audits/round-38'
OUT=AUDIT/'evidence'
spec=spec_from_file_location('runner',AUDIT/'audit-runner.py');runner=module_from_spec(spec);spec.loader.exec_module(runner)
def load(n): return json.loads((OUT/n).read_text(encoding='utf-8'))
def save(n,data): (OUT/n).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def write(n,text): (AUDIT/n).write_text(text.rstrip()+'\n',encoding='utf-8')

FINDINGS=[
 {'id':'R38-01','priority':'P1','title':'Link vừa hiện trên form bị coi là bằng chứng LMS đã lưu',
  'location':'src/lib/playwright/spck-uploader.ts:973-981',
  'cause':'Điều kiện hasRenderedNonInputEvidence chấp nhận bất kỳ danh sách link/file khác rỗng. Danh sách này đã được cập nhật ngay khi bấm + Thêm, trước khi có bằng chứng máy chủ lưu thành công.',
  'repro':'R38-P-no-persist: form có link mới; phản hồi HTTP 200 đúng mã học viên nhưng máy chủ giả không ghi bản nào (serverRows={}). SQLite vẫn thành VERIFIED.',
  'fix':'Sau Lưu, đọc lại dữ liệu SPCK từ máy chủ hoặc mở lại khung từ dữ liệu vừa tải; đối chiếu đầy đủ tiêu đề, bình luận và danh sách đã lưu. Không dùng danh sách cục bộ vừa sửa làm bằng chứng.',
  'impact':'Giáo viên thấy hoàn tất nhưng sản phẩm thực tế chưa được lưu.'},
 {'id':'R38-02','priority':'P1','title':'Phản hồi request của học viên/lớp khác vẫn có thể VERIFIED',
  'location':'src/lib/playwright/spck-uploader.ts:790-869',
  'cause':'Bộ chờ chỉ lọc URL/method và tên operation rất rộng; không khóa variables của request theo classId/studentId. Mã trong response chỉ được so khi có mặt.',
  'repro':'R38-P-wrong-request: request SaveStudentSpck gửi OTHER_CLASS/OTHER_STUDENT, response data.saveStudentSpck={persisted:true}. Máy chủ giả chỉ có OTHER_STUDENT nhưng SQLite ghi R38_S1=VERIFIED.',
  'fix':'Khóa phản hồi theo mutation đúng SPCK và variables đúng lớp/học viên; kiểm tra định danh kết quả hoặc lần đọc lại độc lập. Thiếu bằng chứng định danh phải từ chối.',
  'impact':'Trạng thái hoàn tất bị gắn cho học viên chưa được lưu đúng.'},
 {'id':'R38-03','priority':'P1','title':'Chưa tải xong file vẫn bấm Lưu và VERIFIED',
  'location':'src/lib/playwright/spck-uploader.ts:623-638, 713-720, 786-806, 872-882',
  'cause':'setInputFiles chỉ chọn file. Bộ đếm chấp nhận một HTTP 200/201 có chuỗi /file, /media, /storage hoặc /upload; không gắn với từng file, không đợi tất cả upload kết thúc trước Lưu.',
  'repro':'R38-P-pending-files: chọn 2 file, cả 2 vẫn pending; chỉ POST /files/telemetry trả 200. Bot gửi Lưu và ghi VERIFIED, attachmentsUploadedCount=2 dù không có request tải file nào hoàn tất.',
  'fix':'Theo dõi upload thật của từng tài nguyên và mã file trả về, đợi mọi upload thành công trước bấm Lưu; phản hồi nền không được tính. Đối chiếu manifest đã lưu sau đó.',
  'impact':'LMS có thể thiếu file dù giáo viên được báo đã tải đủ.'},
 {'id':'R38-04','priority':'P1','title':'File mới trùng tên file cũ trên LMS bị bỏ qua',
  'location':'src/lib/playwright/spck-uploader.ts:686-720, 936-947',
  'cause':'Chống trùng ảnh/tài liệu chỉ so basename. Đối chiếu sau lưu cũng chỉ kiểm tra tên, không chứng minh file trên LMS là phiên bản bytes giáo viên đã duyệt.',
  'repro':'R38-P-old-file: LMS giả đã có main.py phiên bản cũ, ổ đĩa có main.py bytes khác. Không chọn/upload file nào (uploadChanges=0), hai SHA-256 khác nhau, vẫn VERIFIED khi response có filesUploaded=true.',
  'fix':'Giữ manifest phiên bản file/định danh server gắn với hash đã duyệt; file cùng tên nhưng khác nội dung phải thay thế. Nếu LMS không cung cấp bằng chứng đủ tin cậy, không đánh dấu VERIFIED.',
  'impact':'Giáo viên có thể nộp nhầm phiên bản cũ của sản phẩm.'},
 {'id':'R38-05','priority':'P1','title':'Stop Bot không chặn học viên kế tiếp trong một lượt cả lớp',
  'location':'src/lib/gemini/spck-comment.ts:286-289; src/lib/playwright/spck-uploader.ts:517-520; src/lib/queue/task-queue.ts:155-185',
  'cause':'stopQueue hủy tác vụ còn chờ, nhưng cả lớp đang nằm trong một tác vụ. Hai vòng lặp AI/upload không kiểm tra tín hiệu dừng giữa các học viên.',
  'repro':'R38-G-stop: dừng sau lời gọi AI đầu, vẫn có 2 calls/2 results. R38-P-stop: dừng khi lưu học viên đầu, vẫn lưu và VERIFIED cả R38_S1 lẫn R38_S2, stopFlag=true.',
  'fix':'Truyền tín hiệu hủy chung; kiểm tra trước học viên kế tiếp và trước các bước gây ghi dữ liệu. Học viên chưa chạy phải giữ nguyên, không ghi đè các bản đã VERIFIED.',
  'impact':'Bot tiếp tục gọi AI và ghi lên LMS sau khi giáo viên yêu cầu dừng.'},
 {'id':'R38-06','priority':'P2','title':'Gói ZIP, Scratch, GameMaker và Office hỏng vẫn được nhận',
  'location':'src/lib/local-files/spck-scanner.ts:309-324; src/lib/playwright/spck-uploader.ts:270-299',
  'cause':'Ảnh/PDF được kiểm tra cấu trúc, nhưng các gói zip/sb3/yyz/docx/pptx chỉ cần khác 0 bytes và đúng đuôi tên.',
  'repro':'5 ca R38-S-corrupt-*: mỗi file chỉ chứa THIS IS NOT A ZIP OR OFFICE PACKAGE nhưng vẫn nằm trong attachments, không có cảnh báo hỏng.',
  'fix':'Kiểm tra chữ ký và cấu trúc thực của từng loại gói; chặn hoặc cảnh báo bắt buộc xử lý trước duyệt. Không đánh đồng lỗi đọc file với bài làm kém.',
  'impact':'Gói không mở được vẫn đi qua bước chuẩn bị nộp.'},
 {'id':'R38-07','priority':'P2','title':'API cho duyệt URL không phải HTTP/HTTPS',
  'location':'src/app/api/spck/save-draft/route.ts:143-165; src/app/api/spck/approve/route.ts:208-227; src/lib/playwright/spck-uploader.ts:88-208',
  'cause':'Bộ đọc links.txt có kiểm tra URL nhưng đường lưu/sửa nháp chỉ trim/cắt số lượng. Bước duyệt và chuẩn bị upload cũng không kiểm tra lại giao thức hay cấu trúc URL.',
  'repro':'R38-D-unsafe-url: javascript:alert(1) và file:///C:/Windows/system.ini được save-draft=200, approve=200, status=APPROVED, uploadValidation=true.',
  'fix':'Dùng chung kiểm tra new URL và chỉ nhận http:/https: ở phía server cho cả lưu, duyệt và upload; kiểm tra thêm hostname Youtube cho danh sách Youtube.',
  'impact':'Dữ liệu không hợp lệ lọt qua luồng API cục bộ. Chưa kết luận LMS thực thi script; không chứng minh tấn công từ website ngoài.'},
 {'id':'R38-08','priority':'P2','title':'Đường API bỏ qua danh mục file được phép nộp',
  'location':'src/app/api/spck/save-draft/route.ts:137-141; src/app/api/spck/approve/route.ts:208-227; src/lib/playwright/spck-uploader.ts:269-302',
  'cause':'API chỉ kiểm tra đường dẫn nằm trong vùng cho phép; approve chỉ kiểm tra số lượng; upload chỉ kiểm tra tồn tại và cấu trúc nếu là PDF. Không dùng chung danh mục đuôi file.',
  'repro':'R38-D-exe: payload.exe nằm trong thư mục giả được APPROVED và preflightValid=true dù không có trong danh mục LMS hoặc bộ quét.',
  'fix':'Áp dụng danh mục và kiểm tra kiểu file thống nhất ở mọi cửa vào, rồi kiểm tra lại trước upload.',
  'impact':'Người gọi API cục bộ có thể đưa nhầm tài nguyên không được LMS hỗ trợ qua bước duyệt.'},
 {'id':'R38-09','priority':'P2','title':'Sau tải lại trang, sửa nháp mới bị bỏ qua mà UI vẫn báo lưu thành công',
  'location':'src/app/final-project/page.tsx:135-137, 369-370, 414-429; src/app/api/spck/save-draft/route.ts:51-62',
  'cause':'Số thứ tự nháp của trình duyệt bắt đầu lại từ 0 mỗi lần tải trang nhưng SQLite giữ số cũ. Server trả staleIgnored=true; UI vẫn return true và không cảnh báo nội dung chưa lưu.',
  'repro':'R38-U-reload: DB draftSeq=900, lần sửa đầu sau reload gửi seq=1. Nội dung vẫn OLD PERSISTED, UI trả success=true và staleIgnored=true.',
  'fix':'Khởi tạo phiên bản từ server hoặc dùng định danh phiên chỉnh sửa cùng phiên bản bản ghi; staleIgnored phải báo xung đột/tải lại, không được coi như đã lưu sửa mới.',
  'impact':'Giáo viên có thể mất phần vừa sửa. Bước kiểm tra snapshot hiện vẫn chặn duyệt nội dung lệch; chưa chứng minh lỗi này vượt khóa duyệt.'},
 {'id':'R38-10','priority':'P2','title':'Đổi lớp trong lúc duyệt/upload làm hiển thị trạng thái của lớp trước',
  'location':'src/app/final-project/page.tsx:560-698, 761',
  'cause':'Ô chọn lớp chỉ bị khóa khi đang tải/quét, vẫn đổi được khi duyệt/upload. Handler duyệt/upload không kiểm tra lớp đang hiển thị trước khi ghép kết quả theo studentId.',
  'repro':'R38-U-class-race: lớp A đang chờ duyệt; chuyển sang lớp B có cùng học viên. Phản hồi A đến sau: nội dung B giữ CLASS B STILL WAITING nhưng trạng thái đổi VERIFIED và nhận HASH_OF_CLASS_A.',
  'fix':'Khóa yêu cầu và kết quả bằng classId+studentId, bỏ kết quả khỏi UI khi đã đổi lớp; có thể khóa đổi lớp trong bước ghi nếu phù hợp trải nghiệm.',
  'impact':'Giao diện gắn nhãn đã nộp sai lớp. Ca này không chứng minh dữ liệu lớp B trên LMS bị ghi sai.'},
 {'id':'R38-11','priority':'P2','title':'AI trả muộn vẫn áp dụng nhận xét dựa trên ghi chú cũ',
  'location':'src/app/final-project/page.tsx:465-480, 521-544',
  'cause':'Snapshot chống ghi đè chỉ so teacherComment/projectTitle/folderPath; bỏ qua teacherNote, quickTags, includePresentation và các tài nguyên đầu vào khác.',
  'repro':'R38-U-note-race: đang gọi AI, giáo viên sửa note thành sản phẩm chưa hoàn thành. AI dựa trên note cũ vẫn thay teacherComment thành OLD AI BASED ON OLD NOTE.',
  'fix':'So phiên bản hoặc dấu kiểm tra toàn bộ đầu vào AI trước khi nhận kết quả. Nếu đã đổi dữ kiện, giữ sửa mới và yêu cầu soạn lại.',
  'impact':'Nhận xét có thể trái với dữ kiện giáo viên vừa chỉnh, nhưng vẫn cần giáo viên duyệt trước khi upload.'},
 {'id':'R38-12','priority':'P2','title':'Nhận xét cuối khóa chỉ đọc lịch sử của buổi 01',
  'location':'src/lib/gemini/spck-comment.ts:233-268',
  'cause':'Hai truy vấn lịch sử đều cố định sessionId `${classId}_SESS_01`, không lấy toàn khóa hoặc buổi có ID thực khác.',
  'repro':'R38-G-history: DB có nhận xét VERIFIED với marker R38_HISTORY_SESSION_TWO ở buổi 02. Prompt không chứa marker và còn báo Chưa có lịch sử điểm/nhận xét.',
  'fix':'Đọc lịch sử theo classId+studentId xuyên các buổi, có chính sách lọc trạng thái hợp lệ; tổng hợp điểm/nhận xét từ đúng dữ liệu thay vì giả định chỉ buổi đầu.',
  'impact':'AI tổng kết cuối khóa bỏ sót tiến bộ hoặc vấn đề ở các buổi sau.'},
]

def main():
 before=load('integrity-before.json');after=runner.manifest()
 assert before==after, 'Protected source/history changed: stop finalization'
 assert runner.sha(ROOT/'next-env.d.ts')=='B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000'
 plan=ROOT/'MINDX_AUTOMATION_PLAN.md';old=(OUT/'plan-before.bin').read_bytes()
 assert plan.read_bytes()==old, 'Plan changed externally: refusing overwrite'
 adv=load('r38-adversarial-results.json');r32=load('r32-phase6-results.json');gates=load('baseline-gates.json');compat=load('compatibility-gate.json')
 assert (adv['total'],adv['passed'],adv['failed'])==(41,24,17)
 assert (r32['total'],r32['passed'],r32['failed'])==(67,67,0)
 assert all(g['exitCode']==0 for g in gates[1:]) and gates[0]['exitCode']==1 and compat['exitCode']==0
 for f in FINDINGS:
  f['cases']=[r['id'] for r in adv['results'] if r['issue']==f['id']]
  assert f['cases'] and all(not r['pass'] for r in adv['results'] if r['issue']==f['id'])
 # Confirm the tested product bytes equal the protected working-tree snapshot.
 for name,digest in adv['sourceHashes'].items(): assert before[name].lower()==digest
 save('integrity-after.json',after)
 protected_count=len(before);source_count=sum(n.startswith(('src/','scripts/')) for n in before);history_count=sum(n.startswith('docs/audits/') for n in before)
 snap=runner.SNAP;expected=Path(os.environ['TEMP']).resolve()/'mindx-round31-r38-phase6'
 assert snap==expected and snap.resolve()==expected and snap.parent==Path(os.environ['TEMP']).resolve()
 assert not os.path.isjunction(snap) and not snap.is_symlink()
 # Collect synthetic fixture hashes and reject any environment files, without following junctions.
 fixtures=[];junctions=[];envfiles=[]
 for d,dirs,files in os.walk(snap,followlinks=False):
  for n in list(dirs):
   p=Path(d,n)
   if os.path.isjunction(p) or p.is_symlink():
    junctions.append({'path':str(p),'target':os.path.realpath(p)});dirs.remove(n)
  for n in files:
   p=Path(d,n)
   if n.startswith('.env'):envfiles.append(str(p))
   if 'r38-fixtures-' in str(p) and not p.is_symlink():fixtures.append({'path':str(p.relative_to(snap)),'sha256':runner.sha(p),'size':p.stat().st_size})
 assert not envfiles
 save('fixture-manifest.json',fixtures)
 # Delete only validated owned links; never recurse through node_modules or fixture junction targets.
 for j in junctions:
  p=Path(j['path']);assert p.is_relative_to(snap) and p!=snap
  if os.path.isjunction(p):os.rmdir(p)
  else:p.unlink()
 shutil.rmtree(snap)
 external=[]
 for value in compat['newExternalFixtures']:
  p=Path(value);assert p.parent==expected.parent and p.name.startswith('r32-out-') and not p.is_symlink() and not os.path.isjunction(p)
  assert not any(p.iterdir()), 'External synthetic folder unexpectedly nonempty'
  p.rmdir();external.append(str(p))
 cleanup={'expectedPath':str(expected),'existsAfter':expected.exists(),'removedLinksOnly':junctions,'removedExternalEmptyFixtures':external,'workspaceNodeModulesExists':(ROOT/'node_modules/tsx/dist/cli.mjs').is_file(),'environmentFilesFound':envfiles}
 assert not cleanup['existsAfter'] and cleanup['workspaceNodeModulesExists']
 save('cleanup.json',cleanup)
 assert runner.manifest()==before
 result={'audit':'AUDIT-R38','phase':6,'scope':['TASK-6.1','TASK-6.2','TASK-6.3','TASK-6.4','TASK-6.5'],'verdict':'NO-GO','completedAt':datetime.now(timezone.utc).isoformat(),'reviewer':{'agent':'Codex primary agent, direct independent audit','requestedModel':'gpt-6.1-sol','requestedReasoning':'high','runtimeModelIndependentlyAttested':False,'delegated':False},'head':load('snapshot.json')['head'],'sourceBasis':'Exact dirty working tree; HEAD alone does not identify the audited source. See integrity-before/after and snapshot copiedHashes.','baselineGates':gates,'r32Compatibility':compat,'baselineR32':{'total':67,'passed':67,'failed':0,'exactCommandStatus':'BLOCKED_BY_HISTORICAL_TEMP_NAME_GUARD','compatibilityOnlyChange':'TEMP directory-name assertion r32 -> r38; 67 original cases unchanged'},'adversarial':{'total':adv['total'],'passed':adv['passed'],'failed':adv['failed'],'evidence':'r38-adversarial-results.json','syntheticBrowser':True,'uiMethod':'Exact pre-JSX handlers with deterministic hook doubles, not full mounted React or live LMS','aiMethod':'Exact source body with fake Gemini boundary, no real call'},'findings':FINDINGS,'counts':{'P1':5,'P2':7,'groups':12},'integrity':{'protectedFiles':protected_count,'unchangedFiles':len(after),'srcScripts':source_count,'historicalFilesR12R37':history_count,'nextEnvSha256':runner.sha(ROOT/'next-env.d.ts'),'allUnchanged':True,'addedDeletedProtectedFiles':0},'cleanup':cleanup,'realServices':{'lmsCalls':0,'geminiCalls':0,'credentialsCopied':False,'realDatabasesCopied':False,'realBrowserProfileCopied':False},'notChecked':['Live LMS identity/selectors/upload/network contract','Live Gemini quality and refusal robustness','Mounted React end-to-end scheduling','Production operation/owner acceptance'],'scopeRemapping':{'missing':['src/app/api/final-project/route.ts','src/lib/db/repositories/spck-submission-repo.ts'],'actual':['src/app/api/spck/{scan,list,save-draft,approve,generate-ai,upload-lms}/route.ts','src/lib/db/sqlite.ts']}}
 save('results.json',result)
 matrix=['# AUDIT-R38 — Ma trận hồi quy','', 'Kết luận: **NO-GO**. 12 nhóm lỗi mới (5 P1, 7 P2), 17/41 tình huống mới chưa đạt. PASS nền không thay thế kiểm toán đối kháng.','', '## Cổng nền trong TEMP','', '| Cổng | Kết quả thực tế | Bằng chứng |','|---|---|---|']
 matrix += ['| R32, lệnh nguyên bản | BLOCKED: assertion tên TEMP chỉ cho R32, exit 1; chưa chạy 67 ca | evidence/01-r32.log |','| R32, bản tương thích | 67/67 PASS, exit 0; chỉ đổi tên TEMP trong assertion | evidence/01b-r32-compatible.log, r32-phase6-results.json |','| Phase 6 | PASS đủ 4 nhóm, exit 0 | evidence/02-phase6.log |','| Phase 5 | PASS đủ 8 nhóm, exit 0 | evidence/03-phase5.log |','| TypeScript | PASS 0 lỗi, exit 0 | evidence/04-typescript.log |','| R38 đối kháng mới | 24/41 PASS; 17 FAIL, exit 1 | evidence/05-adversarial.log, r38-adversarial-results.json |','', '## Từng ca R38 mới','', '| Ca | TASK | Điều kiện cần đạt | Thực tế | Nhóm lỗi |','|---|---|---|---|---|']
 for r in adv['results']:matrix.append('| '+ ' | '.join([r['id'],r['task'],r['title'].replace('|','/'),'PASS' if r['pass'] else 'FAIL',r['issue'] or '—'])+' |')
 matrix += ['', '## Đối chiếu toàn phạm vi','', '| TASK | Kết luận trong phạm vi kiểm |','|---|---|','| 6.1 | Chuẩn hóa, trùng tên, fuzzy và va chạm: các ca đã chạy đạt; không suy rộng sang roster LMS thật. |','| 6.2 | Allowlist/junction, ảnh/PDF, giới hạn links/ảnh/file nền đạt; gói ZIP/Office hỏng và cửa vào API còn R38-06/08. |','| 6.3 | Không đủ dữ kiện không gọi AI; ẩn danh/hủy thẻ sandbox/thuyết trình/stale cơ bản đạt. Stop, note mới và lịch sử còn R38-05/11/12. |','| 6.4 | Queue, tạo/reuse 01, + Thêm, HTTP lỗi, drift trước/sau lưu nền đạt. Persisted, định danh response, file/phiên bản và Stop còn R38-01..05. |','| 6.5 | Local guard, khóa lớp/học viên đầu vào, snapshot duyệt và hạ duyệt khi sửa cơ bản đạt. URL/file API, reload, đổi lớp còn R38-07..11. |','', 'Hàm computeSpckContentHash có SHA-256 bytes của tài nguyên cục bộ; không có trường riêng tên filesFingerprint. Kiểm tra đổi bytes sau duyệt đạt. Không coi tên trường khác hợp đồng là lỗi độc lập; việc đối chiếu file server vẫn thất bại ở R38-04.','', 'Các file .previous.log ghi lượt chuẩn bị trước khi hoàn thiện harness; không được cộng vào số PASS/FAIL cuối. Lượt cuối là 05-adversarial.log và r38-adversarial-results.json.']
 write('REGRESSION_MATRIX.md','\n'.join(matrix))
 report=['# AUDIT-R38 — Kiểm toán độc lập Giai đoạn 6','', '**Kết luận: NO-GO — chưa đủ điều kiện nghiệm thu TASK-6.1..TASK-6.5.** Có **12 nhóm lỗi mới: 5 P1 (cần sửa trước khi nộp thật), 7 P2**. Bộ đối kháng mới đạt **24/41**, còn **17 tình huống FAIL**. Không sửa mã sản phẩm.','', 'Ứng dụng giúp một giáo viên quét thư mục sản phẩm cuối khóa trên máy, ghép với học viên, soạn nhận xét, duyệt và upload LMS. Kiểm toán giả định một người dùng cục bộ, nhưng vẫn có phản hồi mạng chậm, đổi lớp, tải lại trang và chỉnh dữ liệu khi tác vụ đang chạy.','', '## Nguồn và cách kiểm','', f'- Thực hiện trực tiếp bởi Codex; yêu cầu reviewer `gpt-6.1-sol`/`high`, không giao agent khác. Không có chứng thư runtime độc lập để khẳng định danh tính model ngoài cấu hình được yêu cầu.',f'- HEAD: `{result["head"]}`. Cây làm việc đã có nhiều thay đổi trước kiểm toán; bằng chứng gắn với SHA-256 từng file, không gắn với HEAD đơn lẻ.','- Đã đọc sâu 6 tệp sản phẩm được nêu có tồn tại, toàn bộ API SPCK thực tế và phần lưu SPCK trong SQLite, cùng queue, local-guard, allowlist, browser-manager, selectors, network-interceptor và các bài kiểm tra nền.','- Hai đường dẫn yêu cầu không tồn tại: `src/app/api/final-project/route.ts`, `src/lib/db/repositories/spck-submission-repo.ts`. Đã lần theo giao diện đến `src/app/api/spck/{scan,list,save-draft,approve,generate-ai,upload-lms}/route.ts` và `src/lib/db/sqlite.ts`; không tạo đường dẫn giả.','- Bản sao đúng `$env:TEMP\\mindx-round31-r38-phase6`: chỉ chép package.json, tsconfig.json, next.config.ts, next-env.d.ts, src, scripts, docs, data/config; node_modules là junction. Không chép `.env*`, DB thật hoặc playwright-auth thật. Cấu hình ESBUILD_BINARY_PATH trỏ `$env:TEMP\\mindx-esbuild.exe`.','- Node được chặn TCP/DNS/fetch bằng network-guard lịch sử; Chromium chặn toàn bộ request qua route. SQLite, scanner, route handlers và uploader là mã sản phẩm thật trong TEMP. AI dùng lời gọi giả tại ranh giới Gemini. UI chạy nguyên thân hàm trước JSX với hook giả để điều khiển thứ tự phản hồi; chưa phải ứng dụng React được mount đầy đủ.','- Đã xem ảnh chụp trình duyệt của ca pending-files; ảnh là form giả lập để chứng minh hành vi uploader, không phải ảnh LMS thật.','', '## Cổng nền','', '- Phase 6 PASS đủ 4 nhóm; Phase 5 PASS đủ 8 nhóm; TypeScript `--noEmit --incremental false` PASS, 0 lỗi.','- Lệnh R32 nguyên bản đã chạy đúng trong thư mục yêu cầu nhưng **BLOCKED** bởi assertion chỉ chấp nhận tên `mindx-round31-r32-*`. Không đổi kết quả này thành PASS.','- Chạy thêm `docs/audits/round-38/r32-compatible.mjs`: **67/67 PASS**. Diff chỉ thay một literal trong assertion từ tên R32 sang R38, giữ nguyên 67 ca và toàn bộ hồ sơ gốc. Hash bản gốc/bản tương thích ở compatibility-gate.json.','- Bộ mới `adversarial.mjs`: **24 PASS, 17 FAIL / 41 ca**. Mọi FAIL cuối đều có dữ kiện tái hiện tương ứng bên dưới.','', '## Phát hiện phải sửa']
 for f in FINDINGS:
  report += ['',f'### {f["id"]} — {f["priority"]}: {f["title"]}', '',f'- **Nguyên nhân:** {f["cause"]}',f'- **Vị trí:** `{f["location"]}`.',f'- **Tái hiện / hậu quả:** {f["repro"]} {f["impact"]}',f'- **Cách sửa:** {f["fix"]}',f'- **Sau khi sửa:** chạy lại {", ".join("`"+c+"`" for c in f["cases"])} với cùng điều kiện mong đợi trong `adversarial.mjs`; tất cả phải PASS.']
 report += ['', '## Những phần đã có bằng chứng đạt','', '- Chuẩn hóa tiếng Việt, xử lý tên mơ hồ/trùng tên và va chạm thư mục trong các ca đã chạy.','- Chặn đường dẫn ngoài vùng cho phép, junction thoát vùng; chặn Origin ngoài ở cả 6 API; client không nhập bí mật server; lệnh start/dev bind 127.0.0.1. Đây là kiểm tra handler/cấu hình, chưa phải đo socket một server đang chạy.','- Ảnh/PDF giả hỏng bị chặn ở bộ nền; giới hạn 10 ảnh/10 tài liệu, 5 Youtube/5 liên kết và tiêu đề theo bộ nền.','- Không có tag/note trả INSUFFICIENT_INFO, không gọi Gemini; tên target/peer và thẻ đóng giả được xử lý trong các ca đã chạy; ánh xạ lại tên và loại phần thuyết trình khi không tích chọn đạt. Không coi những ca này là chứng minh AI thật miễn nhiễm mọi prompt injection.','- Thay comment/title/link/file bytes sau duyệt bị phát hiện; snapshot nội dung cũ bị từ chối. computeSpckContentHash đã bao gồm byte hash cục bộ, tương đương phần phát hiện drift local của filesFingerprint; không có trường riêng cùng tên.','- Native browser đối chứng tạo 01, bấm + Thêm và chạy lại không tạo 02; HTTP 500 và đổi DB trước Lưu bị chặn. Các ca R32 cũ còn kiểm tra GraphQL errors, sai ID phản hồi có mặt, drift sau click và một số lỗi upload/card khác.','', '## Bảo toàn và dọn dẹp','', f'- **{protected_count}/{protected_count} file bảo vệ giữ nguyên SHA-256**, gồm **{source_count}/{source_count} src/scripts**, **{history_count}/{history_count} hồ sơ R12–R37**, cấu hình và các tệp nền liên quan. Không thêm/xóa file trong các vùng bảo vệ.', '- `next-env.d.ts` giữ đúng `B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000`.','- Chỉ thêm docs/audits/round-38 và nối một dòng AUDIT-R38 ở cuối MINDX_AUTOMATION_PLAN.md; không đổi các checkbox TASK-6.x hoặc ghi đè lịch sử.','- Đã tháo các junction trước khi xóa TEMP; không đi theo junction node_modules hoặc fixture ra ngoài. TEMP yêu cầu và thư mục giả r32-out do lượt này tạo đã xóa; node_modules gốc còn nguyên. Xem evidence/cleanup.json.','- Trong chuẩn bị có một phép so hash bị lặp thừa nên dừng đúng tiến trình chuẩn bị của lượt này rồi tiếp tục bản sao đã khớp. Có một lượt NODE_OPTIONS dùng dấu gạch đường dẫn Windows chưa đúng khiến Node chưa chạy được; log .previous được giữ. Harness mới được sửa lỗi map(path.basename) và phạm vi const trong script DOM trước khi chốt 41 ca. Các lỗi công cụ này không được tính là lỗi sản phẩm.','', '## Chưa kiểm tra và việc tiếp theo','', '- Chưa gọi LMS/Gemini thật; chưa xác nhận selector, API nghiệp vụ thật, nội dung AI thật, tốc độ upload thật hoặc nghiệm thu sản phẩm trên tài khoản giáo viên. Không dùng tài khoản, mật khẩu, DB, profile hoặc bài nộp thật.','- Chưa chạy giao diện React đầy đủ hoặc live end-to-end. Kết quả UI giới hạn ở thân hàm thật với hook giả; ca đổi lớp đã đối chiếu điều kiện disabled trong JSX để bảo đảm thao tác này được phép khi đang duyệt/upload.','- Sửa 5 nhóm P1 trước, sau đó 7 nhóm P2; chạy lại R38, R32 tương thích, Phase 6, Phase 5 và TypeScript trên đúng nguồn cuối. Sau khi hết lỗi cấp mã nguồn mới kiểm tra thật có kiểm soát theo quyết định của Owner.','- Lời giao việc sửa gọn: xem `FIX_PROMPT.vi.md`. Bộ lệnh đã chạy, mã thoát, quan sát từng ca và dấu kiểm tra nguồn nằm ở `evidence/results.json`, `REGRESSION_MATRIX.md` và các file bằng chứng kèm theo. Dấu [x] của AUDIT-R38 chỉ xác nhận đã làm kiểm toán, không nghiệm thu Giai đoạn 6.']
 write('REPORT.vi.md','\n'.join(report))
 prompt=['# Giao việc sửa sau AUDIT-R38','', 'Sửa đúng 12 nhóm trong REPORT.vi.md; không tự ký nghiệm thu. Đọc AGENTS.md và MINDX_AUTOMATION_PLAN.md, sao lưu thay đổi đang có trước khi sửa; giữ nguyên lịch sử audit.','', 'Ưu tiên theo thứ tự:']
 prompt += [f'{i}. **{f["id"]} ({f["priority"]})** — {f["fix"]}' for i,f in enumerate(FINDINGS,1)]
 prompt += ['', 'Điều kiện đóng: giữ nguyên expectation của 41 ca R38 và bổ sung kiểm tra thực giao diện cho reload/đổi lớp/ghi chú AI; 41/41 PASS, 67/67 R32 tương thích PASS, Phase 6/5 PASS và TypeScript 0 lỗi. Xác nhận từng file được lưu đúng phiên bản/đúng học viên bằng lần đọc lại độc lập, không hạ tiêu chuẩn VERIFIED để làm xanh bài test.','', 'Chỉ gọi LMS/Gemini thật khi Owner đã cho phép phạm vi chạy thật. Không đổi các ca giả thành nghiệm thu vận hành.']
 write('FIX_PROMPT.vi.md','\n'.join(prompt))
 entry=f'\n\n* [x] **AUDIT-R38:** Đã hoàn tất Adversarial Review độc lập Giai đoạn 6 (`TASK-6.1`..`TASK-6.5`) tại `docs/audits/round-38/REPORT.vi.md`; **NO-GO cấp mã nguồn**: 12 nhóm lỗi mới (5 P1, 7 P2), bộ mới **24/41 PASS, 17 FAIL**. Phase 6, Phase 5 (8 nhóm) và TypeScript 0 lỗi đạt; R32 nguyên bản bị chặn bởi tên TEMP, bản tương thích chỉ đổi assertion tên đạt **67/67**. Bảo toàn **{protected_count}/{protected_count} tệp**, gồm **{source_count}/{source_count} src/scripts**, **{history_count}/{history_count} hồ sơ R12–R37** và next-env.d.ts đúng hash. Đã xóa bản sao TEMP cùng fixture ngoài do lượt này tạo; không sửa sản phẩm, không dùng LMS/Gemini/dữ liệu thật. Dấu [x] chỉ xác nhận hoàn tất kiểm toán, chưa nghiệm thu Giai đoạn 6.\n'
 plan.write_bytes(old+entry.encode('utf-8'))
 assert plan.read_bytes()==old+entry.encode('utf-8')
 assert runner.manifest()==before
 (OUT/'git-status-after.txt').write_bytes(subprocess.check_output(['git','status','--porcelain=v1','-uall'],cwd=ROOT))
 result['planUpdate']={'prefixPreserved':True,'beforeSha256':hashlib.sha256(old).hexdigest().upper(),'afterSha256':runner.sha(plan),'appendedEntry':entry.strip()}
 result['artifactHashes']={p.relative_to(AUDIT).as_posix():runner.sha(p) for p in AUDIT.rglob('*') if p.is_file() and p!=OUT/'results.json'}
 save('results.json',result)
 print(json.dumps({'verdict':'NO-GO','findings':12,'P1':5,'P2':7,'adversarial':[24,41],'protected':protected_count,'srcScripts':source_count,'history':history_count,'tempRemoved':not expected.exists()}))
if __name__=='__main__':main()
