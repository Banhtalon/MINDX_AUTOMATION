"""Build the Vietnamese report from reconciled fresh receipts."""
from pathlib import Path
import hashlib
import json
import os
import pypdf

p=Path(__file__).resolve().parent
e=p/'evidence'
read=lambda name:json.loads((e/name).read_text(encoding='utf-8'))
commands=read('commands.json');latest={}
for r in commands:
    if r['attempt']>latest.get(r['name'],{}).get('attempt',0):latest[r['name']]=r
source=read('source-state.json');manifest=read('source-manifest.json');issues=read('issue-status.json')['issues']
snap=read('snapshot.json')['snapshot'];secondary=read('secondary-snapshot.json')['snapshot']
rows=[]
order=['round29','native29-media','native29-worker','round28','native28-media','native28-worker','round27','native27-media','native27-worker',
    'round26','native26-media','native26-worker','round25','native25-media','native25-worker','round24','round23','round22','native24',
    'round12','round13','round15','round16','round17','round19','round20','round21','historical14','historical18',
    'phase4','phase5','typecheck-before','build','typecheck-after','graphql-oracle','pdf-oracle','pdf-baseline']
assert set(order)==set(latest)
for name in order:
    r=latest[name]
    d=read(r['results']) if 'results' in r else {}
    if d.get('passed') is not None:
        total=d.get('total') or d['passed']+d['failed']
        result=f"{d['passed']}/{total} "+('PASS' if d['failed']==0 else 'FAIL')
    else:
        result={'round15':'2 baseline đạt; 8 assertion lỗi/lệch lịch sử',
            'historical14':'BLOCKED_REPLAY_PRECONDITION','historical18':'BLOCKED_REPLAY_PRECONDITION',
            'build':'PASS — 22/22 trang','pdf-oracle':'54/54 kỳ vọng R29; quan sát 113 PDF',
            'pdf-baseline':'BASELINE_SOURCE_HASH_MISMATCH; không chạy sản phẩm cũ'}.get(name,'PASS' if r['exitCode']==0 else 'FAIL')
    argv=r['argv'][1:]
    if argv[0]=='node_modules/tsx/dist/cli.mjs':argv=['tsx',*argv[1:]]
    elif argv[0]=='node_modules/typescript/bin/tsc':argv=['tsc',*argv[1:]]
    elif argv[0]=='node_modules/next/dist/bin/next':argv=['next',*argv[1:]]
    else:argv=[('python' if name=='pdf-oracle' else 'node'),*argv]
    rows.append(f"| {name} — `{' '.join(argv)}` | **{result}** | {r['exitCode']} | [log](evidence/{r['log']}) |")

labels=['Đọc file hỏng','Barem và tổng điểm','Hash bản duyệt','AI cũ hoặc file đổi','Duyệt phải kiểm toán','Duyệt bản xem cũ',
    'Đúng người và bài','Đúng lớp, buổi và lesson','Đúng API lưu điểm','Đọc lại đầy đủ','Cập nhật VERIFIED cuối','Giao diện và phản hồi cũ','Thứ tự lưu nháp bền','Phạm vi bài đưa vào AI']
issue_rows=[f"| {i['issueId']} — {label} | {i['status']}"+(', P2' if i['severity'] else '')+f" | {i['passed']}/{len(i['currentChecks'])} |" for i,label in zip(issues,labels)]
fixtures=read('fixture-manifest.json')
fixture_rows=[]
for f in fixtures:
    observation=f"{f['expected']} → {f['observed']}, {f['inlineParts']} inlineData"
    fixture_rows.append(f"| `{f['id']}` | {observation} | [PDF](evidence/{f['file']}) |")
previous=json.loads((p.parent/'round-28/evidence/verify-results.json').read_text(encoding='utf-8'))
current={r['id']:r for r in read('verify-results.json')['results']}
closing=[{'id':r['id'],'previousPass':False,'currentPass':current[r['id']]['pass']} for r in previous['results'] if not r['pass']]
assert len(closing)==9 and all(r['currentPass'] for r in closing)
(e/'r28-fix-closure.json').write_text(json.dumps({'freshSourceManifest':manifest['aggregateSha256'],'total':9,'closed':9,'results':closing},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
spec=Path(os.environ['TEMP'])/'mindx-r29-PDF32000_2008.pdf'
assert spec.is_file()
reference={'pdf':{'url':'https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf',
    'localSha256':hashlib.sha256(spec.read_bytes()).hexdigest(),'sections':['7.2.2 Table 1 and Table 2','7.3.7 Dictionary Objects'],
    'printedPages':[12,13,18,19],'paraphrase':'PDF whitespace includes NUL, HT, LF, FF, CR, SPACE; delimiters terminate objects but must still form valid syntax; dictionaries have name keys paired with object values.'},
    'graphql':{'url':'https://spec.graphql.org/September2025/#sec-String-Value',
    'algorithm':'BlockStringValue','paraphrase':'Split on line terminators, compute common indentation excluding first line and blank lines, strip indentation from later lines, remove blank edges, join with LF.'},
    'limits':'References inform explicit fixture expectations, not full PDF conformance or live LMS schema acceptance.'}
(e/'reference-sources.json').write_text(json.dumps(reference,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

text=f'''# AUDIT-R29 — Kiểm toán độc lập Giai đoạn 5

**Phán quyết: NO-GO cấp mã nguồn. 13/14 nhóm CLOSED_SOURCE; chưa nghiệm thu.**

Đã đóng đủ **9 ca lỗi R28**: bộ R28 chạy mới đạt **737/737**, native media **163/163**, native worker **64/64**. Nhóm **R19-09** đã CLOSED_SOURCE trong phạm vi kiểm chứng; không tái hiện VERIFIED sai trong các ca âm tính đã kiểm. [Đối chiếu 9 ca](evidence/r28-fix-closure.json).

R29 giữ nguyên 737 ca R28 và thêm **78 ca**, đạt **807/815**, còn **8 ca trượt mới thuộc R19-01, P2**: 6 PDF chứa dấu phân cách rời sai cú pháp vẫn được nhận; 2 PDF dùng NUL làm khoảng phân cách hợp lệ bị từ chối. Nạp trực tiếp mô-đun sản phẩm xác nhận đúng cả tám. Chưa đạt 14/14 nên mục nghiệm thu R29 giữ **[ ]**.

## 1. Nguồn đầu vào và cô lập

- Ngày kiểm toán: **21/10/2026**, giờ Việt Nam; chụp nguồn lúc `{source['capturedAt']}` UTC.
- HEAD: `{source['head']}`. Workspace đã có nhiều thay đổi chưa commit trước kiểm toán; không reset, commit hoặc sửa sản phẩm. [Trạng thái đầu](evidence/source-state.json).
- Danh mục **74 file**, gồm **57 src/scripts**; SHA-256 tổng hợp: `{manifest['aggregateSha256']}`. [Danh mục nguồn](evidence/source-manifest.json).
- So với danh mục hash R28, chỉ hai file sản phẩm đã đổi từ trước vòng này: `media-reader.ts` và `grade-worker.ts`; kế hoạch cũng khác do mục tài liệu cuối R28. [Đối chiếu](evidence/changes-since-r28.json).
- SHA-256 `src/lib/file-parsers/media-reader.ts`: `c019389c427ca6c0ce0607309850100f1d46020a0c942727e585aa6fbddb9a1a`.
- SHA-256 `src/lib/playwright/grade-worker.ts`: `f5db4a78fcdd2b2022a6c663444e0f6c24acfc6600da884cd5b62a75fef33d73`.
- Đã đọc AGENTS.md, TASK-5.1–5.5 và điều kiện nghiệm thu, REPORT/FIX_PROMPT R28; rà hai bản sửa cùng luồng tải đúng ID → đọc file → AI theo barem → cộng/kiểm toán điểm → duyệt đúng bản đã xem → lưu LMS → đọc lại → VERIFIED theo hash.

Bản sao chính đúng tiền tố tương thích yêu cầu:

```text
{snap}
```

Bản sao phụ chạy R20/R21:

```text
{secondary}
```

Tất cả lần thực thi sản phẩm, SQLite giả, TypeScript và build đều trong TEMP. Thư viện được sao chép vật lý, không dùng junction nối workspace chính. Không mang `.env`, `.env.local`, `.git`, hồ sơ `playwright-auth`, DB hoặc bài nộp thật vào bản sao. Môi trường tiến trình được lọc; rào Node chặn TCP/DNS/fetch, vẫn cho named pipe của công cụ nội bộ. Không khởi động server/trình duyệt thật, không gọi LMS/Gemini. [Cô lập](evidence/isolation.json), [bản sao phụ](evidence/secondary-snapshot.json).

## 2. Bộ kiểm chứng và tính độc lập

[verify-independent.mjs](verify-independent.mjs) giữ nguyên **737 ID, điều kiện và kỳ vọng R28**, chỉ đổi vỏ đường dẫn/tiền tố/nhãn vòng và thêm ca R29. [assemble-verifier.py](assemble-verifier.py) dựng lại được đúng byte đã chạy; [nguồn gốc](evidence/harness-provenance.json) và [kiểm hiện vật](evidence/artifact-check.json) ghi hash. 737 kết quả đầu trùng ID, tiêu chí và trạng thái với bộ R28 nguyên bản vừa chạy.

| Phần | Đạt / tổng | Trượt |
|---|---:|---:|
| R28 kế thừa nguyên vẹn | **737/737** | 0 |
| PDF mới R29 | **46/54** | 8 |
| GraphQL mới R29 | **24/24** | 0 |
| **Tổng R29** | **807/815** | **8** |

Bộ chính dùng cơ chế kế thừa nạp thân hàm sản phẩm sau khi bỏ khai báo kiểu/import; SQLite thật trong bộ nhớ, file giả vật lý, DOM/API/AI và hook giao diện mô phỏng. Hai bộ [native-media-repro.mjs](native-media-repro.mjs) và [native-worker-repro.mjs](native-worker-repro.mjs) import trực tiếp TypeScript qua tsx, không cắt thân hàm hoặc sửa nguồn. Native media **209/217**, native worker **88/88**; tập tám ID trượt khớp chính xác bộ chính. Native là kiểm chứng chéo cùng mẫu, không cộng vào 815.

[graphql-oracle.mjs](graphql-oracle.mjs) kiểm độc lập **88/88** ca: 64 ca kế thừa bằng scanner/parser riêng, 24 ca mới bằng [thuật toán tuần tự độc lập và giá trị chữ kỳ vọng](block-string-oracle.mjs). Ca mới bao phủ dòng đầu, thụt đầu dòng, dòng trắng ở hai đầu/ở giữa, LF/CRLF/CR, tab, dấu nháy, escape ba dấu nháy, backslash và dấu ngoặc/comment trong chuỗi. Mỗi giá trị hợp lệ đi kèm đối chứng nhận xét bị thay đổi phải bị chặn. Không xác nhận schema LMS thật.

[pdf-oracle.py](pdf-oracle.py) quan sát **113 PDF** bằng pypdf 6.14.0, `strict=True`, ghi riêng hành vi phục hồi. [pdf_dict_oracle.py](pdf_dict_oracle.py) đọc từ điển thật từng byte, dùng đúng tập whitespace/delimiter PDF và xác nhận **54/54 kỳ vọng R29**; không dùng regex hoặc từ điển đã che của sản phẩm. Đây là kiểm cú pháp/hợp đồng cho corpus hẹp, không phải chứng nhận mọi tính năng PDF hay kiểm render. Các WebP kế thừa tiếp tục giải mã đầy đủ pixel bằng sharp/libwebp. [PDF](evidence/pdf-oracle-results.json), [GraphQL](evidence/graphql-oracle-results.json).

Hai kỳ vọng mẫu đầu về `/Other /Dangling` đã được sửa thành đối chứng hợp lệ vì `/Dangling` là giá trị Name. Giữ nguyên kết quả lần đầu, không tính nhầm thành lỗi sản phẩm. Các vấn đề đường dẫn Windows và lần thăm dò baseline đều được giữ và giải thích tại [ghi chú bộ kiểm](evidence/harness-development-notes.md).

## 3. Toàn bộ cổng chạy mới

Có **37 lệnh riêng biệt, 52 lượt thử**, giữ đủ stdout/stderr, mã thoát và hash. Lệnh trong bảng chạy từ snapshot tương ứng; dạng `tsx` là cách viết gọn cho `node node_modules/tsx/dist/cli.mjs`, `tsc` và `next` cũng gọi đúng file trong node_modules bản sao. Đường dẫn tuyệt đối và thời gian ở [commands.json](evidence/commands.json). Mã 0 của phép kiểm hash baseline chỉ nói phép kiểm đã chạy xong; trạng thái vẫn là không có baseline đúng nguồn.

| Bộ / lệnh | Kết quả cuối | Mã thoát | Bằng chứng |
|---|---|---:|---|
{chr(10).join(rows)}

TypeScript trước/sau dùng đúng `--noEmit --incremental false`. Build webpack hoàn tất **22/22 trang**, chỉ đổi `next-env.d.ts` trong snapshot. Các mẫu nguồn sản phẩm không đổi trong lúc kiểm. Node v24.21.0, Next 16.4.2, TypeScript 7.0.2, tsx 4.23.15; [phiên bản](evidence/runtime-versions.json).

## 4. Đối chiếu đủ 14 nhóm

`CLOSED_SOURCE` là đạt trong phạm vi nguồn và tình huống đã kiểm, không thay cho nghiệm thu LMS thật. Ca gắn nhóm không bao gồm mọi ca API/COMPAT nên không cộng bảng này thành tổng 815. [Trạng thái và đủ ID](evidence/issue-status.json).

| Nhóm | Trạng thái | Ca gắn nhóm đạt / tổng |
|---|---|---:|
{chr(10).join(issue_rows)}

Mười đối chứng tương thích kế thừa đều chạy mới và đạt: schema tám bảng R23, bốn ca snapshot duyệt R24, năm ca đúng trường phản hồi R26. Không sửa kết quả bộ lịch sử để làm xanh. [Đối chiếu hợp đồng](evidence/historical-contract-differences.json).

## 5. R19-01 — P2: sáu từ điển PDF sai cú pháp vẫn được nhận

**Nguyên nhân:** `parsePdfDictEntries` dùng `scalarDict.match(...)` ở [media-reader.ts](../../../src/lib/file-parsers/media-reader.ts):1226–1229. Regex chỉ nhặt các đoạn khớp, bỏ qua ký tự không khớp; các dấu `>`, `{{`, `}}` rời bị mất thay vì gây lỗi. Vì vậy `/Length 8>` hoặc `/Count 1{{` biến thành đúng token số rồi được nhận. Bản sửa đã kiểm kiểu số đầy đủ, nhưng chưa chứng minh mọi byte trong từ điển được tiêu thụ hợp lệ.

**Tái hiện:** sáu mẫu delimiter trong bảng mục 7 có đồ thị Catalog/Pages/Page và xref thật, chỉ thêm đúng một dấu phân cách rời vào giá trị Length/Count. Bộ chính và native đều trả **PARSED, 1 inlineData**, giữ nguyên byte file sai. Bộ đọc cú pháp độc lập từ chối đúng vị trí dấu rời. pypdf đôi lúc phục hồi nên việc nó mở được mẫu không phủ định lỗi cú pháp.

**Ảnh hưởng:** PDF không đạt rào cấu trúc vẫn được phép đi tiếp tới luồng chấm. Chưa gọi AI thật và không kết luận đã có điểm sai hoặc REDO thật.

**Cách sửa hẹp:** đọc token từ vị trí hiện tại, tiêu thụ liên tục; mỗi byte ngoài whitespace/comment phải thuộc một token/cấu trúc hợp lệ. Gặp ký tự rời phải lỗi. Giữ giá trị Name, số, boolean, null, chuỗi, mảng và từ điển con hợp lệ; không cấm những ký tự này bên trong chuỗi dữ liệu.

PDF 32000-1 phân loại dấu phân cách tại 7.2.2 và cấu trúc cặp khóa/giá trị tại 7.3.7. [Đặc tả Adobe](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf), [dấu kiểm tài liệu tham chiếu](evidence/reference-sources.json).

## 6. R19-01 — P2: hai PDF có NUL hợp lệ bị từ chối

**Nguyên nhân:** cùng regex trên dùng `\\s` của JavaScript để ngăn token. Tập này thiếu byte **00 (NUL)** vốn là whitespace PDF, nên `/Length 8<NUL>` và `/Count 1<NUL>` bị đọc như số có đuôi lạ.

**Tái hiện:** hai mẫu NUL kỳ vọng PARSED và một inlineData nguyên byte; bộ chính và native trả **PARSE_ERROR, 0 inlineData**. Bộ đọc độc lập nhận số INT 8/1 và từ điển hợp lệ; pypdf đọc Count/Length là NumberObject. Các đối chứng tab/LF/FF/CR cùng khóa bổ sung hợp lệ đều đạt.

**Ảnh hưởng:** tài liệu đạt điều kiện kiểm tra hiện tại có thể bị báo lỗi đọc file, khiến giáo viên phải xử lý thủ công.

**Cách sửa hẹp:** dùng đúng sáu byte whitespace PDF: 00, 09, 0A, 0C, 0D, 20. Không xóa NUL toàn file vì nó có thể là dữ liệu stream/chuỗi và việc xóa làm lệch độ dài byte. Quy tắc nằm ở Table 1, 7.2.2 của [đặc tả Adobe](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf).

Không gọi hai ca này là hồi quy đã được chạy chứng minh: bản TEMP R28 cũ hiện không còn khớp hash nguồn ghi trong R28. Rào kiểm hash đã chặn việc dùng nó làm baseline; không chạy nguồn đó, không sửa bản cũ. Kết quả hiện tại vẫn được xác nhận bằng chính nguồn mới, fixture và đặc tả. [Giới hạn baseline](evidence/baseline-source-availability.json), [kết quả kiểm hash](evidence/pdf-baseline-results.json).

## 7. Tám mẫu lỗi có thể chuyển giao

| ID | Kỳ vọng → thực tế | Mẫu |
|---|---|---|
{chr(10).join(fixture_rows)}

[fixture-manifest.json](evidence/fixture-manifest.json) ghi SHA-256 và kích thước từng mẫu. [Bộ chính](evidence/verify-results.json), [native media](evidence/native-media-results.json), [native worker](evidence/native-worker-results.json) lưu byte mẫu/yêu cầu/phản hồi và quan sát. Tất cả là dữ liệu giả.

## 8. R19-09 đã đóng trong phạm vi nguồn

Ba ca LF, CRLF và tab của R28 đều đạt; cả **277/277** ca gắn nhóm và **88/88** native worker đạt. Bản sửa áp dụng chuẩn hóa dòng, tính thụt đầu dòng chung từ các dòng sau dòng đầu, bỏ dòng trắng hai đầu rồi nối LF tại lúc tạo token STRING. Đối chiếu [BlockStringValue trong đặc tả GraphQL September 2025](https://spec.graphql.org/September2025/#sec-String-Value) và oracle độc lập xác nhận corpus.

Các ca R27/R28 chống chuỗi giả operation/root, ENUM giả STRING, biến không được tham chiếu, phản hồi sai trường, sai ID/nội dung, HTTP lỗi và đọc lại không khớp tiếp tục đạt trong bộ kế thừa. Không phát hiện đường VERIFIED sai trong các ca đã chạy. Điều này không bảo đảm mọi truy vấn GraphQL đều hỗ trợ hoặc khớp schema LMS thật.

## 9. Kết quả lịch sử nguyên bản

- **R12 43/43, R13 89/89, R17 38/38:** đạt khi chạy mới.
- **R16 15/16:** một kỳ vọng bảy bảng trong khi sản phẩm hiện có tám bảng; đối chứng schema R23 đạt.
- **R19 89/94:** bốn placeholder media không đủ cấu trúc bị bộ đọc chặt hơn từ chối; một approval thiếu snapshot giáo viên đã xem.
- **R20 140/145:** bốn approval thiếu snapshot và một phản hồi `saveGrade` không khớp mutation `saveHomeworkGrade`.
- **R21 45/49:** bốn control dùng phản hồi sai trường mutation; đối chứng R26 đúng hợp đồng đạt.
- **R15:** `confirmedBugs=0`, `baselinePassed=2`, `executionErrors=8`, mã thoát 1. Assertion tái hiện lỗi/hợp đồng cũ và schema bảy bảng không đạt, gồm lỗi kiểu dữ liệu fixture. Không gọi là PASS hoặc dùng để khẳng định mọi lỗi cũ đã sửa.
- **R14/R18:** không có verify-independent riêng; thử nguyên bản run-checks và bị rào một lần ghi hồ sơ chặn (`Do not overwrite a previous run`, `Audit already captured`). Không xóa dữ liệu cũ hoặc bỏ rào. Các bộ thành phần và TypeScript/build đã được chạy riêng.

Tập ID trượt R16/R19/R20/R21 giống nguyên tập R28. Đây là so sánh từ lần chạy mới, không lấy log cũ thay việc thực thi. Kết quả FAIL/BLOCKED lịch sử được giữ và giải thích riêng, không chuyển thành PASS sản phẩm.

## 10. Bảo toàn và giới hạn

**905/905 file bảo vệ** (`next-env.d.ts` và toàn bộ R12–R28), **57/57 src/scripts** giữ nguyên từng byte. Trong tập SHA-256 **982 file** ngoài R29, chỉ kế hoạch thay đổi bằng phép chèn mục AUDIT-R29 được ghi nhận. Tập kiểm không bao gồm toàn bộ node_modules/.next hay mọi dữ liệu thật. [Bảo toàn](evidence/preservation-check.json), [kế hoạch trước](evidence/plan.before.md), [phép chèn](evidence/plan-update.json).

SHA-256 `next-env.d.ts` ở workspace chính giữ đúng **B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000**. Không đổi checkbox TASK-5.x hoặc mục nghiệm thu cũ; chỉ đánh dấu hoàn tất kiểm toán R29, mục nghiệm thu R29 để [ ]. Không thay INDEX/LATEST ngoài phạm vi yêu cầu.

Rà nguồn hiện tại cho thấy dev/start vẫn bind 127.0.0.1; một persistent BrowserContext có khóa khởi tạo; save/download qua SequentialTaskQueue; đọc bài qua allowlist; HTTP 200/201, đóng toast, hash bản duyệt và cập nhật VERIFIED có điều kiện được giữ. Hai entrypoint giao diện Giai đoạn 5 không tham chiếu ba biến mật khẩu/khóa nhạy cảm đã nêu trong quy tắc. Đây là rà phạm vi Giai đoạn 5 cùng bộ kiểm kế thừa, không phải kiểm thâm nhập toàn hệ thống. [Rà nguồn](evidence/static-review.json).

Chưa đăng nhập LMS/Gemini, chưa dùng tài khoản/DB/bài nộp thật; chưa chạy trình duyệt, giao diện React hoặc lưu/đọc lại LMS thật. Không xác nhận schema LMS hay nghiệm thu vận hành thật. Baseline TEMP cũ không đủ điều kiện hash, R14/R18 không thể chạy lại trọn bộ vì rào giữ lịch sử của chính runner.

## 11. Đã làm / Kết quả / Chưa kiểm tra / Việc tiếp theo

**Đã làm:** kiểm toán độc lập đúng nguồn, chạy toàn bộ cổng yêu cầu, giữ 737 ca R28 và thêm 78 ca; xác nhận chéo tám lỗi PDF, xuất mẫu/log/hash và cập nhật kế hoạch.

**Kết quả:** **NO-GO, 13/14 CLOSED_SOURCE**, còn R19-01 P2. Toàn bộ chín lỗi R28 đã đóng; build và TypeScript đạt không thay thế tám FAIL mới.

**Chưa kiểm tra:** tài khoản/dữ liệu/dịch vụ và lưu LMS thật; giao diện/trình duyệt thật; không xác nhận baseline R28 đã bị đổi trong TEMP.

**Việc tiếp theo:** chuyển [FIX_PROMPT.vi.md](FIX_PROMPT.vi.md) cho bên triển khai sửa bộ đọc PDF rồi kiểm toán lại nguồn cuối. Owner chưa cần chạy Terminal hoặc cung cấp tài khoản. Chưa ký nghiệm thu Giai đoạn 5.
'''
text=text.replace('pypdf 6.14.0','pypdf '+pypdf.__version__)
(p/'REPORT.vi.md').write_text(text,encoding='utf-8',newline='\n')
print('R29 report written from reconciled receipts.')
