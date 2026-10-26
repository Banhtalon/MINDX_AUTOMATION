"""Render the report from reconciled evidence, not from test-process exit alone."""
from pathlib import Path
import json
out=Path(__file__).resolve().parent
e=out/'evidence'
read=lambda n:json.loads((e/n).read_text(encoding='utf-8'))
g=read('gate-summary.json');m=read('source-manifest.json');pres=read('preservation-check.json');state=read('source-state.json')
issues=read('issue-status.json');assert issues['verdict']=='GO' and issues['closedSource']==14 and pres['allPreserved']
labels=['Đọc file/ảnh/PDF an toàn','Kiểm tiêu chí và tự cộng điểm','Hash bản đã duyệt','AI cũ và phiên bản file','Chặn duyệt file lỗi',
    'Bản đã xem và duyệt không lỗi thời','Đúng học viên/bài nộp trên modal','Đúng lớp/buổi/cột bài tập','Đúng yêu cầu và phản hồi lưu điểm',
    'Đọc lại điểm/quyết định/nhận xét','Chỉ VERIFIED khi bản duyệt còn nguyên','Phản hồi giao diện về sai thứ tự','Lưu nháp nguyên khối và thứ tự bền','Dừng AI khi tải lỗi/chỉ chấm bài mới tải']
group_table='\n'.join(f"| {r['issueId']} | {labels[i]} | {r['passed']}/{r['passed']} | CLOSED_SOURCE |" for i,r in enumerate(issues['issues']))
matrix=['# Ma trận hồi quy AUDIT-R31','',
    'Nguồn kết luận: [source-manifest.json](evidence/source-manifest.json). Mọi kết quả dưới đây đều chạy mới trong TEMP; cột kết quả dùng lượt cuối, mọi lượt trước được giữ trong [commands.json](evidence/commands.json).',
    '', '819 ca chính giữ nguyên ID, tiêu chí và kỳ vọng R30. Native (import mô-đun thật) và oracle (bộ đối chiếu riêng) là kiểm chứng chéo, không cộng trùng vào 819. 28 ca biên R31 là bộ bổ sung riêng.',
    '', '| Cổng | Kết quả | Trạng thái | Mã thoát | Log / kết quả |','|---|---|---|---:|---|']
for r in g['gates']:
    name=r['name']
    if name=='pdf-oracle':result='54/54 kỳ vọng từ điển; quan sát 117 PDF'
    elif name=='export-worker-cases':result='88 mẫu giả, không import sản phẩm'
    elif name=='round15':result='2 baseline đạt; 8 assertion lỗi/lệch lịch sử'
    elif name in ['historical14','historical18']:result='Tự chặn ghi đè bằng chứng đã có'
    elif name=='build':result='22/22 trang'
    elif r['passed'] is not None:result=f"{r['passed']}/{r['total'] if r['total'] is not None else r['passed']+(r['failed'] or 0)}"
    else:result='Đạt'
    links=f"[log](evidence/{r['log']})"+(f" / [JSON](evidence/{r['results']})" if r['results'] else '')
    matrix.append(f"| {name} | {result} | {r['status']} | {r['exitCode']} | {links} |")
matrix.extend(['','## 14 nhóm nguồn','', '| Nhóm | Điều được kiểm | Ca gắn nhóm | Trạng thái |','|---|---|---:|---|',group_table,'',
    'Các nhóm dùng cùng định nghĩa và danh sách ID của R30, đối chiếu lại với kết quả mới. Không dùng kết quả R30 cũ làm bằng chứng PASS. Bảy ca chính còn lại là các kiểm soát chung ngoài 14 nhóm.',
    '', '## Diễn giải lịch sử','',
    '- R16: kỳ vọng 7 bảng, hiện có 8 bảng do bổ sung bảng lưu phiên bản nháp; đối chứng cấu trúc hiện tại đạt.',
    '- R19: bốn mẫu ảnh/PDF cũ không hoàn chỉnh bị chặn; một yêu cầu duyệt thiếu bản đã xem bắt buộc.',
    '- R20: bốn yêu cầu duyệt thiếu bản đã xem; một phản hồi dùng `saveGrade` thay vì trường mutation đã chọn `saveHomeworkGrade`.',
    '- R21: bốn phản hồi có cùng sai khác trường trả về; ca kiểm chỉnh sửa trong lúc đọc lại chưa đi tới bước đọc lại trong bộ cũ.',
    '- R15: là bộ tái hiện lỗi cũ, giữ nguyên 0 lỗi cũ tái hiện, 2 baseline đạt, 8 assertion lỗi/lệch yêu cầu. Không gọi bộ này là PASS.',
    '- R14/R18: runner ghi nhận một lần từ chối ghi đè bằng chứng có sẵn. Giữ BLOCKED_REPLAY_PRECONDITION; không xóa hoặc sửa bộ cũ để chạy ép.',
    '', 'Danh sách ID trượt giống hệt R30; 10 đối chứng tương thích chạy mới đều đạt. Xem [historical-contract-differences.json](evidence/historical-contract-differences.json).',
    '', '## Lỗi môi trường đã xử lý','',
    f"Có {g['attempts']} lượt cho {g['distinctGates']} cổng; {g['launchFailuresRetained']} lượt ban đầu lỗi Windows `WinError 267` trước khi Node chạy vì cwd quá dài. Rút tiền tố `compat` thành `x` trong tên TEMP, giữ đủ nhãn vòng cho assertion cũ; chạy lại đủ 21 cổng và đều đạt. `ESBUILD_BINARY_PATH` luôn trỏ bản sao cùng hash tại TEMP ngắn. Không thay mã sản phẩm/harness lịch sử.",
    '', '## Giới hạn','',
    'PASS ở đây là bằng chứng nguồn và dữ liệu giả. Không chạy giao diện/trình duyệt thật, đăng nhập thật, LMS/Gemini thật hoặc kiểm định toàn bộ định dạng PDF. Các bộ lịch sử FAIL/BLOCKED được giữ rõ, không tuyên bố mọi bộ nguyên bản đều xanh.'])
(out/'REGRESSION_MATRIX.md').write_text('\n'.join(matrix)+'\n',encoding='utf-8')

report=f'''# AUDIT-R31 — Kiểm toán độc lập Giai đoạn 5

**Quyết định: GO cấp mã nguồn — 14/14 nhóm R19-01..R19-14 đạt CLOSED_SOURCE.**

Hai lỗi PDF Name rỗng của R30 đã đóng; không phát hiện lỗi sản phẩm mới trong phần nguồn đã rà, 819 ca kế thừa và 28 ca biên bổ sung. Quyết định gắn với đúng danh mục nguồn bên dưới; chưa phải nghiệm thu vận hành LMS/Gemini thật.

## 1. Kết quả chính

| Kiểm tra | Kết quả chạy mới |
|---|---:|
| R31 và R30 nguyên bản | 819/819 mỗi bộ |
| Native media R31 và R30 | 221/221 mỗi bộ |
| Native worker R31 và R30 | 88/88 mỗi bộ |
| pdf-name-repro | 4/4 |
| Name: pypdf strict và bộ đọc byte độc lập | 4/4 |
| pdf_dict_oracle | 54/54 |
| graphql_worker_oracle.py | 88/88 |
| Oracle GraphQL JS kế thừa | 88/88 |
| Biên bổ sung về Name/khóa/thiếu giá trị | 28/28 |
| Phase 4 và Phase 5 | PASS |
| TypeScript trước và sau build | PASS, `--noEmit --incremental false` |
| `next build --webpack` | PASS, 22/22 trang |

Toàn bộ R29..R22 cùng các bộ native yêu cầu chạy mới đạt. Chuỗi R12..R21 đã chạy đầy đủ các entrypoint như các vòng trước: R12/R13/R17 đạt; R15/R16/R19/R20/R21 giữ FAIL lịch sử, R14/R18 giữ BLOCKED. Sai khác ID và kỳ vọng không đổi so với R30; 10 đối chứng tương thích hiện tại đạt. Không sửa bộ kiểm cũ để biến kết quả thành xanh. Xem [ma trận đủ 48 cổng](REGRESSION_MATRIX.md), [tổng hợp](evidence/gate-summary.json), [71 lượt và lệnh đầy đủ](evidence/commands.json).

Có **{g['pass']} cổng PASS, {g['historicalFail']} FAIL lịch sử, {g['historicalBlocked']} BLOCKED lịch sử** ở lượt cuối. Native và oracle kiểm chứng chéo cùng mẫu, không được cộng trùng vào 819 ca chính.

## 2. Nguồn được kiểm

- Ngày kiểm toán: **21/10/2026**, giờ Việt Nam; chụp nguồn lúc `{state['capturedAt']}` UTC.
- HEAD: `{state['head']}`. Nguồn có thay đổi chưa commit từ trước; không reset, phục hồi đè hoặc sửa sản phẩm. [Trạng thái đầu](evidence/source-state.json).
- Danh mục **74 file**, gồm **57 src/scripts**. SHA-256 tổng hợp: `{m['aggregateSha256']}`. [Manifest](evidence/source-manifest.json).
- `media-reader.ts`: `{m['files']['src/lib/file-parsers/media-reader.ts']['sha256']}`.
- `grade-worker.ts`: `{m['files']['src/lib/playwright/grade-worker.ts']['sha256']}` — giữ nguyên so với R30.

So với manifest R30, chỉ **`src/lib/file-parsers/media-reader.ts`** đổi trong src/scripts. Kế hoạch có khác biệt do hồ sơ R30 đã được cập nhật sau lần chụp R30; đó là trạng thái có sẵn trước R31. R31 không cập nhật kế hoạch. [Đối chiếu](evidence/changes-since-r30.json), [toàn bộ diff](evidence/media-reader.since-r30.diff).

Đã đọc AGENTS.md, yêu cầu TASK-5.1..5.5, báo cáo/prompt sửa R30 và luồng liên quan: tải bài gắn định danh, allowlist đường dẫn, parser, ẩn danh/kiểm điểm AI, duyệt/hash, thứ tự lưu nháp, worker/API lưu và đọc lại, giao diện gọi các bước này. Tải dự kiến là một giáo viên dùng cục bộ; thao tác trình duyệt nối tiếp, nhưng phản hồi AI/nháp/giao diện có thể về sai thứ tự. Đây là kiểm toán Giai đoạn 5 cùng các cổng hồi quy, không phải kiểm thâm nhập toàn dự án. [Rà nguồn](evidence/static-review.json), [ghi chú delta](evidence/source-review-notes.json).

## 3. Đóng hoàn toàn R19-01 trong phạm vi mã nguồn

**Nguyên nhân trước sửa:** bộ đọc coi tên sau dấu `/` bắt buộc có ký tự, nên từ chối Name rỗng hợp lệ. Lần này `validateRawPdfDict` đã tiêu thụ `/` và trả loại NAME; `parsePdfDictEntries` giữ token `/` và chấp nhận nó tại vị trí Name. Tên khóa cũng có thể rỗng; kiểm khóa trùng, thiếu giá trị và dấu phân cách rời vẫn còn.

PDF 32000-1 mục **7.3.5**, trang PDF **25** (trang in **17**), cho phép Name rỗng sau SOLIDUS. Đã tải mới bản đặc tả từ [kho Adobe](https://raw.githubusercontent.com/adobe/dc-acrobat-sdk-docs/master/docs/standards/pdfstandards/pdf/PDF32000_2008.pdf), kiểm đoạn quy tắc và SHA-256; công cụ web không mở được file 22 MB nên kiểm nội dung trong bộ nhớ. [Nguồn tham chiếu](evidence/reference-sources.json).

| ID giữ nguyên từ R30 | Nguồn R30 đúng hash | Nguồn hiện tại | inlineData |
|---|---|---|---:|
| R30-01-pdf-nested-empty-name | PARSE_ERROR | PARSED | 1 |
| R30-01-pdf-array-empty-name | PARSE_ERROR | PARSED | 1 |
| R30-01-pdf-nested-name-control (`/Nonempty`) | PARSED | PARSED | 1 |
| R30-01-pdf-array-name-control (`/Nonempty`) | PARSED | PARSED | 1 |

[pdf-name-repro.mjs](pdf-name-repro.mjs) import trực tiếp sản phẩm hiện tại, đồng thời nạp nguồn R30 trong VM sau khi kiểm hash. Bản nguồn cũ được lưu trong hồ sơ R31 để chạy lại mà không phụ thuộc TEMP cũ: [nguồn gốc](evidence/baseline-provenance.json). Cả bốn PDF có SHA-256 giống mẫu R30; kiểm inlineData đúng Base64 nguyên byte. [Đóng lỗi](evidence/r30-fix-closure.json), [mẫu PDF](evidence/fixture-manifest.json).

`pypdf 6.10.2 strict=True` đọc từ điển thật, kiểm NameObject `/` hoặc `/Nonempty` và giải cây một trang cho đủ bốn mẫu. Bộ đọc byte độc lập xác nhận tên có chuỗi rỗng. Oracle từ điển giữ nguyên hàm đọc R30, kiểm **54/54** kỳ vọng R29 bằng đúng sáu whitespace và mười delimiter PDF. Oracle pypdf ghi quan sát **117 PDF**, gồm bốn mẫu R30, và ghi rõ hành vi phục hồi; mở được PDF không tự chứng minh file đúng cú pháp. Chưa kiểm render hay chứng nhận toàn bộ PDF. [Oracle PDF](evidence/pdf-oracle-results.json), [oracle từ điển](evidence/pdf-dict-oracle-results.json), [oracle Name](evidence/pdf-name-oracle-results.json).

Thêm **28 ca biên** để kiểm tác động của việc nhận Name rỗng ở cả khóa và giá trị: scalar, từ điển/mảng lồng nhau, khóa rỗng, sáu whitespace hợp lệ; các trường hợp thiếu giá trị, khóa trùng, dấu `>`, `{{`, `}}` rời và sai loại `/Count` hoặc `/Type` vẫn bị chặn, không có inlineData. **28/28 đạt**. [Bộ kiểm](pdf-boundary-repro.mjs), [kết quả](evidence/pdf-boundary-results.json).

## 4. Trạng thái 14 nhóm

| Nhóm | Điều được kiểm | Ca gắn nhóm | Trạng thái |
|---|---|---:|---|
{group_table}

Mọi danh sách ID gắn nhóm được lấy theo R30 và đối chiếu với kết quả R31 vừa chạy; chi tiết từng ID ở [issue-status.json](evidence/issue-status.json). Không dùng trạng thái cũ thay kết quả mới. Không còn P1/P2 mở trong phạm vi này.

Riêng R19-09, worker giữ đúng hash R30. **277/277** ca gắn nhóm, **88/88** native worker, **88/88** oracle JS và **88/88** oracle Python mới đều đạt. Bộ Python tự quét ký tự, đọc cấu trúc yêu cầu, chuẩn hóa block string theo [đặc tả GraphQL](https://spec.graphql.org/September2025/#sec-String-Value), ghép biến được tham chiếu và trường phản hồi được chọn, rồi so với quan sát native; không import parser sản phẩm hoặc oracle JS. Không tái hiện VERIFIED sai trong ca âm tính đã kiểm; chưa xác minh schema LMS thật. [Kết quả Python](evidence/graphql-worker-oracle-results.json).

## 5. Cô lập và bảo toàn

Mọi lần thực thi sản phẩm, SQLite giả, TypeScript và build chạy trong các **bản sao vật lý tại TEMP**. Không dùng junction về workspace; không sao chép `.env`, `.env.local`, `.git`, DB/bài nộp thật hoặc `playwright-auth`. Môi trường tiến trình được lọc để không kế thừa mật khẩu/khóa. Rào Node chặn TCP/DNS/fetch, cho phép named pipe nội bộ; đây không phải tường lửa hệ điều hành. Không mở server, trình duyệt hoặc gọi LMS/Gemini thật. Việc tải công khai đặc tả Adobe phục vụ kiểm toán được thực hiện riêng, không qua sản phẩm. [Cô lập](evidence/isolation.json).

`ESBUILD_BINARY_PATH` trỏ tới bản sao `esbuild.exe` cùng hash ở TEMP ngắn. **21 lượt khởi chạy đầu** của chuỗi R22..R30/native bị Windows từ chối cwd quá dài (`WinError 267`), trước khi Node chạy. Chỉ rút ngắn tiền tố tên thư mục từ `compat` thành `x`, giữ đầy đủ nhãn vòng mà harness cũ yêu cầu; **21 cổng chạy lại đều đạt**. Hai lượt pdf-name/oracle chạy lại sau khi đưa baseline vào hồ sơ để gói tự chứa nguồn cũ. Giữ đủ mọi log và lỗi khởi chạy; không thay sản phẩm/harness lịch sử. [Ghi chú môi trường](evidence/harness-development-notes.md), [esbuild](evidence/esbuild-path-workaround.json).

Đối chiếu cuối **{pres['totalBefore']}/{pres['totalBefore']} file ngoài R31** giữ nguyên; trong đó **{pres['protectedCount']}/{pres['protectedCount']} file bảo vệ** gồm toàn bộ R12..R30 và `next-env.d.ts`. **57/57 src/scripts**, kế hoạch và các file gốc trong tập kiểm không đổi. Không sửa INDEX/LATEST hay checkbox. User yêu cầu chỉ ghi R31 nên quy tắc cập nhật kế hoạch không được áp dụng trong lượt kiểm toán này. [Bảo toàn](evidence/preservation-check.json).

SHA-256 `next-env.d.ts` tại workspace chính giữ đúng **B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000**. Next chỉ tái tạo file này trong TEMP khi build. Các nguồn ở cả bốn bản sao, kể cả bản đường dẫn dài không chạy được, khớp manifest; các harness lịch sử giữ nguyên byte. Tập kiểm bảo toàn không bao gồm toàn bộ node_modules/.next hoặc dữ liệu thật. [Đối chiếu snapshot](evidence/snapshot-source-check.json).

## 6. Tính độc lập và giới hạn

[verify-independent.mjs](verify-independent.mjs) giữ nguyên toàn bộ **819 ID, tiêu chí và kỳ vọng** R30, chỉ đổi đường dẫn đầu ra, tiền tố TEMP và metadata vòng. Kết quả mới của hai bộ trùng đủ 819/819. Bộ chính nạp thân hàm thật sau khi bỏ import/kiểu TypeScript; dùng SQLite thật trong bộ nhớ, file giả và mô phỏng DOM/API/AI/handler giao diện. Native media/worker import trực tiếp mô-đun TypeScript, không cắt thân hàm. Sharp/libwebp giải mã đầy đủ pixel các ca WebP kế thừa. [Nguồn gốc bộ kiểm](evidence/harness-provenance.json), [đối chiếu 819 ca](evidence/inherited-cases-check.json).

Rà nguồn xác nhận dev/start bind `127.0.0.1`, một persistent BrowserContext có khóa khởi tạo, thao tác save/download qua hàng đợi nối tiếp, đọc bài qua allowlist, ẩn danh văn bản gửi AI, tổng điểm tính bằng TypeScript, hash duyệt và cập nhật VERIFIED có điều kiện. Kiểm HTTP 200/201, đúng yêu cầu nghiệp vụ, đóng toast phụ và đọc lại vẫn được giữ. Hai entrypoint giao diện Giai đoạn 5 không tham chiếu ba biến bí mật bị cấm. Đây là rà luồng liên quan; không chứng nhận riêng tư/an toàn tuyệt đối hoặc bảo đảm AI luôn tuân thủ chỉ dẫn.

Chưa chạy trình duyệt/giao diện React thật, tài khoản thật, bài nộp/DB thật, Gemini thật, schema hay lưu/đọc lại LMS thật. Chưa kiểm mọi tài liệu PDF hoặc mọi hành vi người dùng. GO chỉ cho đúng nguồn đã ghi hash và phạm vi kiểm trên; không tự ký nghiệm thu vận hành hay chuyển Giai đoạn 6.

**Đã làm:** hoàn tất kiểm toán R31, đóng hai lỗi R30 với đối chứng đúng hash, chạy đủ chuỗi kiểm, tạo hồ sơ/bằng chứng và kiểm bảo toàn.

**Kết quả:** **GO cấp mã nguồn, 14/14 CLOSED_SOURCE**; không phát hiện lỗi mới trong phạm vi đã kiểm.

**Chưa kiểm tra:** vận hành trên giao diện, tài khoản, dữ liệu và LMS/Gemini thật.

**Việc tiếp theo:** Owner đọc báo cáo và ma trận; không có sửa nguồn bắt buộc từ R31. Nếu triển khai bước nghiệm thu vận hành, cần một phạm vi kiểm riêng do Owner cho phép. [FIX_PROMPT.vi.md](FIX_PROMPT.vi.md) ghi rõ không yêu cầu sửa thêm.
'''
(out/'REPORT.vi.md').write_text(report,encoding='utf-8')
(out/'FIX_PROMPT.vi.md').write_text('''# FIX_PROMPT — AUDIT-R31

**Không có sửa mã nguồn bắt buộc từ kết quả R31. Quyết định: GO cấp mã nguồn, 14/14 CLOSED_SOURCE.**

Hai ca `R30-01-pdf-nested-empty-name` và `R30-01-pdf-array-empty-name` đã đạt PARSED với đúng 1 inlineData nguyên byte; hai đối chứng `/Nonempty` giữ PASS. 819/819 ca chính, 221/221 native media, 88/88 native worker, 54/54 oracle từ điển, 88/88 oracle GraphQL và các cổng nguồn hiện hành đều đạt. Chi tiết và giới hạn ở [REPORT.vi.md](REPORT.vi.md) và [REGRESSION_MATRIX.md](REGRESSION_MATRIX.md).

Nếu cần chuyển giao cho bên triển khai, dùng nguyên văn:

```text
Đối chiếu hồ sơ docs/audits/round-31/REPORT.vi.md và source-manifest.json trước mọi bước tiếp theo.
R31 đã GO cấp mã nguồn, đủ 14/14 CLOSED_SOURCE; không có yêu cầu sửa bổ sung từ kiểm toán này.
Giữ bản sửa Name rỗng hợp lệ trong validateRawPdfDict và parsePdfDictEntries; giữ kiểm thiếu giá trị,
khóa trùng, dấu phân cách, INT/REAL, NUL, cây trang, stream và mọi rào định danh/hash/API/đọc lại.
Không chỉnh sản phẩm chỉ để làm xanh các harness lịch sử lệch yêu cầu; giữ nguyên hồ sơ R12..R31.
Không coi GO nguồn là đã lưu và đọc lại thành công trên LMS thật.
Không thay checkbox/kế hoạch hoặc dùng tài khoản, dữ liệu, Gemini/LMS thật chỉ dựa vào prompt này.
Bước tiếp theo là chuẩn bị phạm vi nghiệm thu vận hành để Owner xem xét; chỉ thực hiện khi đã được giao.
Nếu nguồn thay đổi sau manifest R31, kiểm lại đúng nguồn cuối và lập bằng chứng mới trước kết luận mới.
```

Owner không cần chạy Terminal, cung cấp mật khẩu/khóa hoặc tự sửa code cho lượt kiểm toán này.
''',encoding='utf-8')
(e/'harness-development-notes.md').write_text('''# Ghi chú môi trường và bộ kiểm R31

- 21 lần khởi chạy chuỗi lịch sử thất bại với WinError 267 do cwd dài hơn giới hạn Windows. Node chưa chạy; log trống cùng launch-error JSON được giữ. Không phân loại là lỗi sản phẩm.
- Rút `compat` thành `x` trong tên bản sao TEMP, giữ đủ các chuỗi `mindx-roundNN-` cho assertion cũ. Sao chép vật lý mới và chạy lại 21/21 cổng đạt. Không sửa file trong R12..R30.
- ESBUILD_BINARY_PATH luôn trỏ bản sao cùng SHA-256 tại đường dẫn TEMP ngắn; không cài lại thư viện.
- pdf-name lần 1 dùng nguồn TEMP R30 đúng hash. Lần 2 chuyển sang bản nguồn cũ cùng hash lưu trong R31/evidence/baseline để tái hiện độc lập với tuổi thọ TEMP cũ; 4/4 và oracle 4/4 đều đạt ở hai lượt.
- Oracle pypdf lần này quan sát 117 PDF thay vì con số 113 trong báo cáo R30: R31 dùng corpus native cuối cùng có thêm bốn mẫu Name R30. Số kỳ vọng từ điển R29 vẫn 54/54. Không tái sử dụng kết quả pypdf cũ.
- Tiện ích đọc đặc tả ban đầu không tìm thấy chuỗi vì giới hạn trang và chữ `empty` bị xuống dòng thành `emp` + `ty` trong phần text PDF. Đã xác minh lại trên trang PDF 25 bằng so sánh bỏ whitespace; không thay đổi giả định kiểm thử hoặc sản phẩm.
- Một lệnh soạn metadata bằng Python -c lỗi dấu nháy trong PowerShell; thay bằng apply_patch. Một số lần đọc metadata bằng Python gặp bảng mã mặc định Windows; đọc lại UTF-8. Đây là tiện ích hồ sơ, không phải lượt thực thi sản phẩm; không che lỗi kiểm thử.
- Không sửa MINDX_AUTOMATION_PLAN.md vì Owner chỉ cho ghi docs/audits/round-31/. Checklist ở kế hoạch là lịch sử, báo cáo R31 là quyết định nguồn của lượt này.
''',encoding='utf-8')
print('WROTE REPORT.vi.md, FIX_PROMPT.vi.md, REGRESSION_MATRIX.md and environment notes.')
