"""Render the Vietnamese audit record from verified receipts; does not edit product files."""
import json
from pathlib import Path
p=Path(__file__).resolve().parent
e=p/'evidence'
read=lambda n:json.loads((e/n).read_text(encoding='utf-8'))
latest={r['name']:r for r in read('commands.json')}
state=read('source-state.json');manifest=read('source-manifest.json');issues=read('issue-status.json')['issues']
titles=['Đọc file hỏng','Barem và tổng điểm','Hash bản duyệt','AI cũ hoặc file đổi','Duyệt phải kiểm toán','Duyệt bản xem cũ','Đúng người và bài','Đúng lớp, buổi và lesson','Đúng API lưu điểm','Đọc lại đầy đủ','Cập nhật VERIFIED cuối','Giao diện và phản hồi cũ','Thứ tự lưu nháp bền','Phạm vi bài đưa vào AI']
groups='\n'.join(f"| {i['issueId']} — {title} | {i['status']}{', P2' if i['severity'] else ''} | {i['passed']}/{i['passed']+i['failed']} |" for i,title in zip(issues,titles))
order=['round28','native28-media','native28-worker','round27','native27-media','native27-worker','round26','native26-media','native26-worker','round25','native25-media','native25-worker','round24','round23','round22','native24','round12','round13','round15','round16','round17','round19','round20','round21','historical14','historical18','phase4','phase5','typecheck-before','build','typecheck-after','graphql-oracle','pdf-oracle']
rows=[]
for name in order:
    r=latest[name]
    if name=='round15':result='2 baseline đạt; 8 assertion lỗi/lệch lịch sử'
    elif name in ['historical14','historical18']:result='BLOCKED_REPLAY_PRECONDITION'
    elif name=='pdf-oracle':result='Thực thi đạt; quan sát 59 PDF, không chứng nhận hợp lệ toàn bộ'
    elif name=='build':result='PASS — 22/22 trang'
    elif r.get('passed') is not None:
        total=r.get('total') or r['passed']+r['failed'];result=f"{r['passed']}/{total} {'PASS' if not r['failed'] else 'FAIL'}"
    else:result='PASS' if r['exitCode']==0 else 'FAIL'
    command='node '+' '.join(r['argv'][1:]) if name!='pdf-oracle' else 'python '+' '.join(r['argv'][1:])
    rows.append(f"| {name} — `{command}` | {result} | {r['exitCode']} | [log](evidence/{r['log']}) |")
gates='\n'.join(rows)
failed=read('fixture-manifest.json')
failrows='\n'.join(f"| `{r['id']}` | {'PARSE_ERROR / 0 inline → PARSED / 1 inline' if r['file'].endswith('.pdf') else 'VERIFIED 1 → 0, FAILED'} | [mẫu](evidence/{r['file']}) |" for r in failed)
report=f'''# AUDIT-R28 — Kiểm toán độc lập Giai đoạn 5

**Phán quyết: NO-GO cấp mã nguồn. 12/14 nhóm CLOSED_SOURCE; chưa nghiệm thu.**

Toàn bộ **12 lỗi R27 đã đóng trong phạm vi kiểm chứng**: R27 chính **662/662**, native media **120/120**, native worker **32/32**. Bộ R28 giữ nguyên 662 ca đó và bổ sung **75 ca**, đạt **728/737**, còn **9 ca trượt mới**: 6 PDF sai cấu trúc được nhận và 3 yêu cầu GraphQL hợp lệ bị từ chối. Cả chín được xác nhận bằng nạp trực tiếp mô-đun sản phẩm, không tách thân hàm.

Hai nhóm còn mở là **R19-01 (P2)** và **R19-09 (P2)**. Các đường VERIFIED sai P1 của R27 không tái hiện; vì vậy mức độ phần còn lại của R19-09 được hạ từ P1 xuống P2. Điều này chỉ áp dụng các tình huống đã kiểm, không bảo đảm mọi yêu cầu GraphQL đều an toàn hoặc tương thích LMS thật.

## 1. Đúng bản nguồn và giới hạn kiểm toán

- Ngày kiểm toán: **21/10/2026**, giờ Việt Nam. Bản nguồn chụp lúc `{state['capturedAt']}` (UTC).
- HEAD: `{state['head']}`. Workspace có nhiều thay đổi từ trước. Không reset, commit, sửa code sản phẩm hoặc ghi đè công việc đó. [Trạng thái đầu](evidence/source-state.json).
- Danh mục đầu vào: **{len(manifest['files'])} file**, trong đó **57 file src/scripts**. SHA-256 tổng hợp: `{manifest['aggregateSha256']}`. [Danh mục nguồn](evidence/source-manifest.json).
- So với bản nguồn R27, chỉ hai file sản phẩm thay đổi từ trước kiểm toán: `src/lib/playwright/grade-worker.ts` và `src/lib/file-parsers/media-reader.ts`. Khác biệt kế hoạch là cập nhật tài liệu cuối R27. [Đối chiếu](evidence/changes-since-r27.json).
- Đã đối chiếu AGENTS.md, kế hoạch TASK-5.1–TASK-5.5, REPORT/FIX_PROMPT R27 và các bộ kiểm chứng; rà luồng tải bài theo ID → đọc file → AI đề xuất theo barem → kiểm toán điểm → giáo viên duyệt bản đã xem → lưu LMS → đọc lại → cập nhật VERIFIED theo hash.
- Giả định: một giáo viên dùng máy cục bộ, tác vụ trình duyệt tuần tự; tải giao diện, AI và lưu nháp có thể trả kết quả lệch thứ tự.

Bản sao chính đúng chuỗi tương thích yêu cầu:

```text
{read('snapshot.json')['snapshot']}
```

R20/R21 dùng bản sao phụ `../mindx-round20-compat-mindx-round21-compat/snapshot`. Tất cả lần thực thi sản phẩm, TypeScript và build diễn ra trong TEMP. Không khởi động server hay trình duyệt thật; không dùng LMS, Gemini, tài khoản, DB hoặc bài nộp thật. Bản sao không có `.env`, `.env.local`, `.git`, `playwright-auth`, DB thật hoặc thư mục tải thật. Thư viện được **sao chép vật lý**, không nối vào thư viện workspace chính. [Cô lập](evidence/isolation.json).

## 2. Bộ kiểm chứng và tính độc lập

[verify-independent.mjs](verify-independent.mjs) kế thừa nguyên **662 ID, điều kiện và kỳ vọng R27**. Chỉ đổi đường dẫn nhập, thư mục xuất, tiền tố TEMP và nhãn vòng; thêm 43 PDF và 32 request/response GraphQL. [assemble-verifier.py](assemble-verifier.py), [phần mới](r28-cases.inc.txt), [nguồn gốc](evidence/harness-provenance.json) và [đối chiếu hiện vật](evidence/artifact-check.json). 662 kết quả đầu trùng ID/điều kiện/trạng thái với lượt R27 nguyên bản vừa chạy.

| Phần | Đạt / tổng | Trượt |
|---|---:|---:|
| R27 kế thừa nguyên vẹn | **662/662** | 0 |
| PDF mới R28 | **37/43** | 6 |
| GraphQL mới R28 | **29/32** | 3 |
| **Tổng R28** | **728/737** | **9** |

Bộ chính dùng thân hàm sản phẩm bỏ khai báo kiểu/import theo cơ chế kế thừa; SQLite thật trong bộ nhớ, file vật lý giả, DOM/API/AI và hook giao diện được mô phỏng. Hai bộ [native-media-repro.mjs](native-media-repro.mjs) và [native-worker-repro.mjs](native-worker-repro.mjs) import trực tiếp file TypeScript qua tsx, giữ nguyên mã sản phẩm; chỉ thay cộng tác trình duyệt/API trong lúc chạy. Native media đạt **157/163**, native worker **61/64**, tập ID trượt khớp chính xác chín ca của bộ chính. Không cộng native vào tổng 737 vì là kiểm chứng chéo cùng mẫu.

WebP kế thừa vẫn được giải mã toàn bộ pixel bằng sharp/libwebp. [graphql-oracle.mjs](graphql-oracle.mjs) là scanner/parser kiểm mẫu riêng, đạt **64/64**, áp dụng BlockStringValue theo đặc tả và đối chiếu hợp đồng giả; không xác nhận schema LMS. [pdf-oracle.py](pdf-oracle.py) dùng pypdf `strict=True`, ghi kiểu Length/Count, Kids, xref và các quan sát khác của 59 PDF. pypdf có khả năng phục hồi: mở được một PDF không chứng minh PDF đúng cấu trúc. [Kết quả GraphQL](evidence/graphql-oracle-results.json), [kết quả PDF](evidence/pdf-oracle-results.json).

Toàn bộ lần chạy thử ban đầu được giữ. Một kỳ vọng mẫu mới dùng Length=9 cho payload tám byte đã tính thiếu LF ngăn cách; thực tế LF có thể là byte dữ liệu thứ chín. Mẫu được sửa thành Length=10 và chạy lại, không tính lỗi bộ kiểm tra này thành lỗi sản phẩm. Hai đối chứng từ điển có khóa bổ sung hợp lệ cũng được thêm và đều đạt. Các lỗi khi mở rộng oracle đã được sửa riêng, không đổi kỳ vọng sản phẩm. [Ghi chú phát triển bộ kiểm tra](evidence/harness-development-notes.md).

## 3. Các cổng chạy mới và kết quả thô

Lệnh dưới đây chạy từ snapshot tương ứng. Chi tiết đường dẫn tuyệt đối, thời gian, mã thoát và SHA-256 của từng log/kết quả ở [commands.json](evidence/commands.json). Có **33 lệnh riêng biệt**, gồm các lượt lịch sử bổ sung R14/R15/R18; không đổi mã thoát FAIL thành PASS.

| Bộ / lệnh | Kết quả mới nhất | Mã thoát | Bằng chứng |
|---|---|---:|---|
{gates}

TypeScript trước/sau dùng đúng `--noEmit --incremental false`. Build chỉ đổi `next-env.d.ts` trong snapshot như các vòng trước; file cùng tên ở workspace chính giữ nguyên. Node v24.21.0, Next 16.4.2, TypeScript 7.0.2, tsx 4.23.15. [Phiên bản](evidence/runtime-versions.json).

## 4. Đối chiếu đủ 14 nhóm

`CLOSED_SOURCE` nghĩa là đạt trong phạm vi nguồn và tình huống đã kiểm, không thay cho nghiệm thu thực tế. Số ca của các nhóm chỉ là phần có ID gắn nhóm; không cộng bảng này thành tổng 737 vì còn các ca API/COMPAT độc lập khác. [Danh sách đầy đủ và ID đối chiếu](evidence/issue-status.json).

| Nhóm | Trạng thái | Ca gắn nhóm đạt / tổng |
|---|---|---:|
{groups}

Mười đối chứng tương thích kế thừa đều chạy mới và đạt: schema tám bảng R23, bốn ca snapshot duyệt R24, năm ca response-field R26. Các ca này không sửa hoặc thay thế kết quả thô của bộ lịch sử. [Đối chiếu hợp đồng](evidence/historical-contract-differences.json).

## 5. R19-01 — P2: PDF sai kiểu số hoặc thiếu giá trị vẫn PARSED

**Nguyên nhân:** `media-reader.ts:1271` và `1442` dùng `\\d+\\b` để nhặt phần đầu giá trị. Dấu chấm tạo ranh giới từ nên `8.5`/`8.0` thành 8, `1.5`/`1.0` thành 1. Number.isInteger trên số đã cắt không còn kiểm được kiểu gốc. Hai mẫu `8/foo` và `1/foo` có token Name `/foo` riêng nhưng thiếu giá trị từ điển; mã chỉ tìm Length/Count rồi bỏ qua cấu trúc dư.

**Vị trí:** [media-reader.ts](../../../src/lib/file-parsers/media-reader.ts), phần Length dòng 1268–1273 và Count dòng 1440–1443. Mọi số dòng trong báo cáo gắn với hash nguồn đầu vào ở mục 1.

**Tái hiện:** sáu PDF trong bảng mục 7 đều trả `PARSED`, một inlineData chứa nguyên byte của file, thay vì `PARSE_ERROR`, không inlineData. Mẫu Length dùng payload `ABCDEFGH` tám byte; `.5` hoặc `.0` phải có kiểu real, không phải integer. pypdf đọc riêng kiểu `FloatObject` cho các giá trị thập phân; Count 1.5 không bằng một Page. Với `/foo` thiếu giá trị, pypdf có thể báo lỗi hoặc phục hồi và bỏ token: ghi nhận riêng, không dùng hành vi phục hồi làm chứng nhận đúng.

**Ảnh hưởng:** file không đạt điều kiện cấu trúc vẫn được cho đi tiếp tới luồng chấm. Kiểm toán không gọi AI thật, không kết luận đã chấm sai học viên thật hoặc chấm 0/REDO. Trạng thái PARSE_ERROR là rào phải giữ trước khi đưa dữ liệu sang AI.

**Cách sửa hẹp:** đọc giá trị nguyên đầy đủ theo token và kiểm kiểu ban đầu, không cắt phần thập phân; kiểm các cặp khóa/giá trị ở từ điển liên quan để chặn khóa không có giá trị. Giữ đối chứng có `/Other 1` hoặc `/Other 2` hợp lệ, Length reference trước/sau, generation, dòng kết thúc, Kids và Count cây nhiều tầng. Ba ca stream-marker và Kids chứa scalar của R27 đã đạt, không được làm hỏng lại.

Tài liệu Adobe phân biệt integer/real và yêu cầu Length là integer: [CosStream](https://opensource.adobe.com/dc-acrobat-sdk-docs/acrobatsdk/apireference/COS_Layer/CosStream.html). Mẫu từ điển thiếu giá trị được xác định trực tiếp từ byte fixture, không suy luận từ việc viewer mở được file.

## 6. R19-09 — P2: block string hợp lệ bị từ chối

**Nguyên nhân:** `grade-worker.ts:451–465` đọc được một token block string nhưng đặt `value=val` thô, thiếu bước BlockStringValue. GraphQL quy định loại thụt đầu dòng chung và dòng trắng ở hai đầu, rồi nối các dòng bằng LF. [Đặc tả GraphQL September 2025, String Value](https://spec.graphql.org/September2025/#sec-String-Value).

**Vị trí:** [grade-worker.ts](../../../src/lib/playwright/grade-worker.ts), nhánh lexer chuỗi ba dấu nháy. Đối chiếu nhận xét tại dòng 979 dùng giá trị chưa chuẩn hóa.

**Tái hiện:** ba ca LF, CRLF và tab có giá trị GraphQL thực `APPROVED\\nFEEDBACK`, trùng bản duyệt và DOM đọc lại giả. Token thô còn dấu thụt ở dòng sau nên requestPredicate trả false. Cả bộ chính và native đều cho `verified=0`, `status=FAILED`, `writes=1`; kỳ vọng `verified=1`. `writes` ở đây đếm lần bấm nút trong DOM giả, không phải ghi thành công lên LMS thật.

**Ảnh hưởng:** worker có thể báo thất bại cho thao tác hợp lệ. Chưa có dữ liệu cho thấy ba mẫu này thực sự do giao diện LMS thật phát ra. Không thấy VERIFIED sai trong các ca âm tính R27/R28 đang kiểm; phần P1 cũ đã được khắc phục trong phạm vi này.

**Cách sửa hẹp:** áp dụng thuật toán BlockStringValue khi tạo token STRING. Giữ escape ba dấu nháy, dấu nháy đơn bên trong, chuỗi thường và ranh giới token. Không nới cách so sánh nội dung giáo viên duyệt hoặc bỏ kiểm loại ENUM. Hai ca block-quote-decoy, placeholder-enum-decoy và năm false negative R27 phải tiếp tục đạt.

## 7. Chín bằng chứng lỗi có thể chuyển giao

| ID | Kỳ vọng → thực tế | Mẫu độc lập |
|---|---|---|
{failrows}

[fixture-manifest.json](evidence/fixture-manifest.json) ghi SHA-256 từng mẫu. [verify-results.json](evidence/verify-results.json), [native-media-results.json](evidence/native-media-results.json) và [native-worker-results.json](evidence/native-worker-results.json) giữ yêu cầu/phản hồi/byte mẫu và quan sát. Các dữ liệu này đều tổng hợp giả, không phải bài học viên.

## 8. Vì sao vẫn có FAIL lịch sử

- **R16 15/16:** một assertion kỳ vọng bảy bảng trong khi hiện tại có tám bảng, gồm bảng metadata bền. Đối chứng R23 cho cấu trúc hiện tại đạt.
- **R19 89/94:** bốn inline media placeholder lỗi/thiếu cấu trúc bị bộ đọc chặt hơn từ chối; một approval thiếu bản snapshot giáo viên đã xem. Giữ nguyên cả năm FAIL.
- **R20 140/145:** bốn approval thiếu snapshot, một control dùng response `saveGrade` cho mutation `saveHomeworkGrade`. Các đối chứng bổ sung đủ hợp đồng hiện tại đạt.
- **R21 45/49:** bốn control dùng response không khớp trường mutation; đối chứng R26 cùng hành vi, sửa đúng hợp đồng phản hồi, đạt.
- **R15:** bảy assertion tái hiện lỗi/hợp đồng cũ và một kỳ vọng schema bảy bảng không đạt; có cả lỗi kiểu dữ liệu của fixture không còn tương thích. Kết quả thô: `confirmedBugs=0`, `baselinePassed=2`, `executionErrors=8`, mã thoát 1. Không gọi đây là PASS hồi quy hoặc dùng riêng kết quả này để kết luận mọi lỗi cũ đã sửa.
- **R14/R18:** không có bộ verify-independent riêng. Đã thử nguyên bản `run-checks.mjs`; chúng bị chặn ngay bởi quy tắc không ghi đè hồ sơ đã có (`Do not overwrite a previous run`, `Audit already captured`). Không xóa hồ sơ hoặc bỏ rào để chạy lại. Các bộ thành phần R12/R13/R16/R17 và cổng TypeScript/build đã được chạy riêng. Đây là giới hạn chạy lại bộ điều phối lịch sử, không phải kết quả kiểm sản phẩm đạt.

Các ID trượt R16/R19/R20/R21 trùng nguyên tập trượt trong lượt R27; không xuất hiện hồi quy mới trong các bộ nguyên bản đó. Mọi so sánh lấy từ kết quả mới của R28, không dùng log R27 thay việc chạy lại.

## 9. Rà quy tắc an toàn và bảo toàn workspace

Rà nguồn và bằng chứng hiện tại cho thấy lệnh dev/start vẫn bind 127.0.0.1; BrowserManager dùng một persistent context với khóa khởi tạo; save-lms/download-and-grade đi qua SequentialTaskQueue; bộ lọc mạng kiểm request nghiệp vụ và HTTP 200/201, đóng toast; đọc file qua allowlist; hash bản duyệt và cập nhật VERIFIED có điều kiện vẫn được kiểm bởi bộ kế thừa. Không thấy tham chiếu ba biến mật khẩu/khóa nhạy cảm trong hai entrypoint giao diện Giai đoạn 5. Đây là rà phạm vi Giai đoạn 5 và liên quan, không phải kiểm thâm nhập toàn dự án. [Rà nguồn](evidence/static-review.json).

**772/772 file bảo vệ** (`next-env.d.ts` và toàn bộ hồ sơ R12–R27), **57/57 src/scripts** giữ nguyên từng byte. Tập kiểm SHA-256 gồm **849 file** ngoài R28; chỉ kế hoạch được phép thay khi ghi mục AUDIT-R28. Tập này không bao gồm toàn bộ node_modules/.next hay mọi tệp dữ liệu thật. [Bảo toàn](evidence/preservation-check.json).

SHA-256 workspace chính của `next-env.d.ts` giữ đúng **B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000**. Chỉ thêm hồ sơ `docs/audits/round-28/` và mục tài liệu vào kế hoạch; [plan-update.json](evidence/plan-update.json) ghi hash trước/sau và bản kế hoạch trước được giữ tại [plan.before.md](evidence/plan.before.md). Không thay trạng thái các TASK-5.x có từ trước. Mục kiểm toán hoàn tất được đánh dấu [x]; nghiệm thu sau R28 để [ ] vì chưa đạt 14/14.

## 10. Đã làm / Kết quả / Chưa kiểm tra / Việc tiếp theo

**Đã làm:** kiểm toán độc lập, chạy đủ bộ R27/R26 và các cổng yêu cầu, bổ sung 75 ca, xác nhận chéo chín lỗi, xuất fixture/log/hash và yêu cầu sửa.

**Kết quả:** **NO-GO, 12/14 CLOSED_SOURCE**; lỗi R27 đã đóng, còn hai nhóm P2 mới nêu trên. Bản dựng và kiểm tra kiểu đạt không thay cho kết quả 9 FAIL của R28.

**Chưa kiểm tra:** chưa đăng nhập/chạy LMS, Gemini hoặc dùng dữ liệu thật; chưa kiểm trình duyệt và lịch chạy React thực tế; không xác nhận tương thích schema LMS hoặc nghiệm thu lưu/đọc lại thật. R14/R18 không thể chạy lại trọn bộ vì điều kiện bảo toàn lịch sử của chính các runner.

**Việc tiếp theo:** chuyển [FIX_PROMPT.vi.md](FIX_PROMPT.vi.md) cho bên triển khai sửa hai nhóm, sau đó kiểm toán lại đúng nguồn cuối. Chưa cần Owner chạy Terminal hay cung cấp tài khoản/mật khẩu. Không ký nghiệm thu Giai đoạn 5 ở vòng này.
'''
(p/'REPORT.vi.md').write_text(report,encoding='utf-8',newline='\n')
