"""Write the Vietnamese R30 report from reconciled fresh evidence."""
import json
from pathlib import Path

p=Path(__file__).resolve().parent
e=p/'evidence'
read=lambda n:json.loads((e/n).read_text(encoding='utf-8'))
gates=read('gate-summary.json')
latest={r['name']:r for r in gates['gates']}
source=read('source-manifest.json')
state=read('source-state.json')
change=read('changes-since-r29.json')
preserve=read('preservation-check.json')
issues=read('issue-status.json')['issues']
labels=['Đọc file hỏng','Barem và tổng điểm','Hash bản duyệt','AI cũ hoặc file đổi','Duyệt phải kiểm toán','Duyệt bản đã xem',
    'Đúng người và bài','Đúng lớp, buổi và lesson','Đúng API lưu điểm','Đọc lại đầy đủ','Cập nhật VERIFIED cuối','Giao diện và phản hồi cũ','Thứ tự lưu nháp bền','Phạm vi bài đưa vào AI']
issue_table='\n'.join(f"| {r['issueId']} — {labels[i]} | {r['status']} | {r['passed']}/{len(r['currentChecks'])} |" for i,r in enumerate(issues))
historical={'round12':'43/43 PASS','round13':'89/89 PASS','round15':'2 baseline đạt; 8 assertion lỗi/lệch lịch sử',
    'round16':'15/16 FAIL lịch sử','round17':'38/38 PASS','round19':'89/94 FAIL lịch sử','round20':'140/145 FAIL lịch sử',
    'round21':'45/49 FAIL lịch sử','historical14':'BLOCKED_REPLAY_PRECONDITION','historical18':'BLOCKED_REPLAY_PRECONDITION',
    'phase4':'PASS','phase5':'PASS','typecheck-before':'PASS','build':'PASS — 22/22 trang','typecheck-after':'PASS',
    'pdf-oracle':'54/54 kỳ vọng từ điển R29; quan sát 113 PDF','pdf-baseline':'8/8; nguồn R28/R29 đúng hash'}
def command(r):
    args=r['argv'][1:]
    if args[0]=='node_modules/tsx/dist/cli.mjs':return 'tsx '+' '.join(args[1:])
    if args[0]=='node_modules/typescript/bin/tsc':return 'tsc '+' '.join(args[1:])
    if args[0]=='node_modules/next/dist/bin/next':return 'next '+' '.join(args[1:])
    return ('python ' if args[0].endswith('.py') else 'node ')+' '.join(args)
rows=[]
for r in gates['gates']:
    value=historical.get(r['name'],f"{r.get('passed')}/{r.get('total')} "+('PASS' if r['exitCode']==0 else 'FAIL'))
    rows.append(f"| {r['name']} — `{command(r)}` | **{value}** | {r['exitCode']} | [log](evidence/{r['log']}) |")
gate_table='\n'.join(rows)
closure_table='\n'.join(f"| `{r['id']}` | {r['currentStatus']} | {r['inlineParts']} | [PDF](evidence/{r['fixture']}) |" for r in read('r29-fix-closure.json')['results'])
snapshot=read('snapshot.json')['snapshot']
secondary=read('secondary-snapshot.json')['snapshot']
short=read('sqlite-snapshot.json')['snapshot']
report=f'''# AUDIT-R30 — Kiểm toán độc lập Giai đoạn 5

**Phán quyết: NO-GO cấp mã nguồn; 13/14 nhóm CLOSED_SOURCE, còn R19-01 P2.**

Đóng đủ **8/8 ca lỗi R29**; các cổng R29 nguyên bản đạt **815/815, 217/217, 88/88**. R30 giữ nguyên 815 ca đó và thêm bốn ca độc lập, đạt **817/819**; native media **219/221**, native worker **88/88**. Hai ca trượt mới là PDF hợp lệ chứa tên rỗng trong mảng hoặc từ điển con bị từ chối. Nguồn R29 đúng hash nhận chúng; pypdf strict và bộ đọc byte độc lập xác nhận hợp lệ. [Kết quả](evidence/verify-results.json), [đóng lỗi R29](evidence/r29-fix-closure.json), [lỗi mới](evidence/new-findings.json).

Đánh dấu [x] hoàn tất kiểm toán R30; mục **nghiệm thu sau R30 giữ [ ]** vì chưa đạt 14/14 CLOSED_SOURCE / GO. Chưa nghiệm thu vận hành trên tài khoản, bài nộp hoặc LMS/Gemini thật. Giữ nguyên các mục R28/R29 như lịch sử.

## 1. Nguồn được kiểm và phạm vi

- Ngày kiểm toán: **21/10/2026**, giờ Việt Nam; chụp nguồn lúc `{state['capturedAt']}` UTC.
- HEAD: `{state['head']}`. Workspace có nhiều thay đổi chưa commit từ trước; không reset, commit, phục hồi đè hoặc sửa sản phẩm. [Trạng thái đầu](evidence/source-state.json).
- Danh mục **{len(source['files'])} file**, gồm **57 src/scripts**; SHA-256 tổng hợp `{source['aggregateSha256']}`. [Danh mục nguồn](evidence/source-manifest.json).
- So với nguồn ghi trong R29, **chỉ `src/lib/file-parsers/media-reader.ts` đổi trong src/scripts**; khác biệt tài liệu là kế hoạch. `grade-worker.ts` giữ nguyên. [Đối chiếu](evidence/changes-since-r29.json), [diff nguồn](evidence/media-reader.since-r29.diff).
- SHA-256 `media-reader.ts`: `{change['currentMediaSha256']}`.
- SHA-256 `grade-worker.ts`: `{change['currentWorkerSha256']}`.

Đã đối chiếu AGENTS.md, TASK-5.1–5.5 và điều kiện nghiệm thu, REPORT/FIX_PROMPT R29; rà bản sửa PDF cùng các rào liên quan tới đường dẫn file, barem/tổng điểm, hash bản duyệt, đúng định danh, đúng API lưu, đọc lại và cập nhật VERIFIED. Tải dự kiến: một giáo viên dùng cục bộ, thao tác trình duyệt nối tiếp; phản hồi AI/nháp/giao diện có thể về sai thứ tự. Đây là kiểm toán Giai đoạn 5 cùng các cổng hồi quy yêu cầu, không phải kiểm thâm nhập toàn bộ dự án. [Rà nguồn](evidence/static-review.json).

## 2. Cô lập và bảo toàn

Bản sao chính có đủ tiền tố tương thích R22–R30:

```text
{snapshot}
```

Bản sao phụ R20/R21:

```text
{secondary}
```

Bản sao ngắn cho R25 native worker, Phase 4/5 và oracle PDF:

```text
{short}
```

Toàn bộ lần thực thi sản phẩm, SQLite giả, TypeScript và build đều trong TEMP. Thư viện được sao chép vật lý; không nối junction về workspace. Không sao chép `.env`, `.env.local`, `.git`, hồ sơ đăng nhập, DB hay bài nộp thật. Tiến trình dùng môi trường lọc và rào Node chặn TCP/DNS/fetch, cho phép named pipe nội bộ. Không mở server/trình duyệt hoặc gọi LMS/Gemini thật. Rào Node là biện pháp của bộ kiểm, không phải tường lửa hệ điều hành. [Cô lập](evidence/isolation.json), [bản sao lịch sử](evidence/secondary-snapshot.json), [bản sao ngắn](evidence/sqlite-snapshot.json).

Runner kế thừa R29, giữ `ESBUILD_BINARY_PATH` trỏ tới bản sao `esbuild.exe` cùng SHA-256 ở đường dẫn TEMP ngắn. [Bằng chứng](evidence/esbuild-path-workaround.json). Thêm một tiền tố R29 làm đường dẫn dài hơn: lần đầu native25-worker, Phase 4/5 gặp `SQLITE_CANTOPEN`; oracle PDF gặp `ModuleNotFoundError` khi Python tìm module dưới đường dẫn dài. Bốn cổng chạy lại trong bản sao vật lý ngắn hơn và đạt; không sửa sản phẩm, thư viện hoặc bộ kiểm cũ. Đủ cả bốn log thất bại đầu được giữ. [Ghi chú](evidence/harness-development-notes.md).

Trong tập kiểm **{preserve['totalBefore']} file** ngoài R30, chỉ cho phép chèn mục R30 vào kế hoạch. **{preserve['protectedCount']}/{preserve['protectedCount']} file bảo vệ**, gồm `next-env.d.ts` và toàn bộ R12–R29, cùng **57/57 src/scripts** giữ nguyên từng byte. Không thay checkbox TASK-5.x hoặc mục nghiệm thu cũ. Không thay INDEX/LATEST ngoài phạm vi. [Bảo toàn](evidence/preservation-check.json), [kế hoạch trước](evidence/plan.before.md), [phép chèn](evidence/plan-update.json).

SHA-256 `next-env.d.ts` tại workspace chính giữ đúng **B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000**. Build chỉ tái tạo file đó bên trong TEMP; nguồn sản phẩm ở cả ba bản thực thi khớp manifest. Tập hash không bao gồm toàn bộ node_modules/.next hoặc mọi dữ liệu thật. [Đối chiếu bản sao](evidence/snapshot-source-check.json).

## 3. Tính độc lập và đóng tám lỗi PDF

[verify-independent.mjs](verify-independent.mjs) kế thừa nguyên **815/815 ca R29**; chỉ đổi vỏ đường dẫn, tiền tố, import và nhãn vòng, sau đó thêm bốn ca R30 về Name hợp lệ. Không xóa ID hoặc thay kỳ vọng cũ. So sánh 815 ID/tiêu chí/trạng thái đầu với bộ R29 nguyên bản vừa chạy khớp hoàn toàn. [append-r30.py](append-r30.py) dựng lại được đúng verifier; [nguồn gốc](evidence/harness-provenance.json), [kiểm hiện vật](evidence/artifact-check.json).

Bộ chính nạp thân hàm thật sau khi bỏ import/khai báo kiểu, dùng SQLite thật trong bộ nhớ và file giả; DOM/API/AI/giao diện được mô phỏng. Hai bộ [native media](native-media-repro.mjs) và [native worker](native-worker-repro.mjs) import trực tiếp TypeScript qua tsx, không cắt thân hàm hoặc sửa nguồn. Native là kiểm chứng chéo cùng mẫu, không cộng thêm vào 819. Các lần đầu R30 815/815 và native media 217/217 trước khi thêm bốn ca mới được giữ nguyên trong hồ sơ.

[pdf-oracle.py](pdf-oracle.py) dùng pypdf **6.10.2**, `strict=True`, quan sát **113 PDF** và ghi riêng hành vi phục hồi. [pdf_dict_oracle.py](pdf_dict_oracle.py) kiểm độc lập **54/54 kỳ vọng R29** trên byte từ điển chưa che; không dùng bộ đọc hoặc regex sản phẩm. pypdf có thể phục hồi file sai, nên việc mở được file không thay thế kiểm cú pháp. Không kiểm render hoặc chứng nhận đầy đủ PDF. Các ca WebP kế thừa vẫn được sharp/libwebp giải mã toàn bộ pixel. [Kết quả PDF](evidence/pdf-oracle-results.json).

Quy tắc đối chiếu là PDF 32000-1:2008, mục 7.2.2 Tables 1–2 và 7.3.7: sáu whitespace byte **00, 09, 0A, 0C, 0D, 20** và mười delimiter **()<>[]{{}}/%**. [Đặc tả Adobe](https://opensource.adobe.com/dc-acrobat-sdk-docs/standards/pdfstandards/pdf/PDF32000_2008.pdf), [nguồn tham chiếu](evidence/reference-sources.json).

Bản sửa quét liên tục từng byte, từ chối dấu phân cách rời thay vì bỏ qua; dùng đúng whitespace PDF tại bộ quét từ điển và kiểm giá trị con. Giữ kiểm INT/REAL, khóa thiếu/khóa trùng, Name, boolean/null, chuỗi/mảng/từ điển con, Length/reference/generation/stream và cây trang trong corpus kế thừa. Phần REAL cũng bỏ cú pháp số mũ vốn không thuộc dạng số PDF. Đã rà toàn bộ diff; không đổi worker.

| ID | Kết quả hiện tại | inlineData | Mẫu |
|---|---|---:|---|
{closure_table}

Sáu dấu `>`, `{{`, `}}` rời hiện bị chặn và không có inlineData. Hai PDF NUL hợp lệ hiện được nhận với đúng một inlineData nguyên byte. Cả tám mẫu có SHA-256 trùng fixture R29. [Danh mục mẫu](evidence/fixture-manifest.json).

Hai nguồn TEMP R28/R29 đã khôi phục đều khớp **57/57 src/scripts** ghi trong manifest của từng vòng. [pdf-baseline-repro.mjs](pdf-baseline-repro.mjs) kiểm hash trước, chỉ đọc nguồn cũ rồi chạy trong VM tại bản TEMP R30; không sửa hai bản cũ. Kết quả **8/8**: tái hiện đủ tám lỗi trên nguồn R29 đúng hash và xác nhận nguồn hiện tại đã sửa. R28 nhận hai mẫu NUL; R29 từ chối; R30 nhận lại đúng. Đây là đối chứng hồi quy hai ca NUL có nguồn đã xác minh, khắc phục giới hạn baseline được ghi ở R29 mà không sửa hồ sơ R29. [Nguồn baseline](evidence/baseline-source-availability.json), [kết quả đối chứng](evidence/pdf-baseline-results.json).

## 4. R19-09 tiếp tục CLOSED_SOURCE

`grade-worker.ts` giữ nguyên SHA-256 R29; **277/277** ca gắn nhóm và **88/88** native worker đạt. [graphql-oracle.mjs](graphql-oracle.mjs) và [block-string-oracle.mjs](block-string-oracle.mjs) kiểm độc lập **88/88**, gồm 24 ca chuẩn hóa block string R29 và nhận xét đổi phải bị chặn. Không tái hiện VERIFIED sai trong các ca âm tính đã kiểm. [Native worker](evidence/native-worker-results.json), [oracle](evidence/graphql-oracle-results.json).

Giữ các rào chọn mutation/root/alias, biến được tham chiếu, loại STRING/ENUM, phản hồi đúng trường, HTTP 200/201, GraphQL errors, đọc lại và cập nhật VERIFIED theo hash. Đây là bằng chứng trong corpus giả; chưa xác nhận schema LMS thật.

## 4a. Lỗi mới R19-01 — P2: PDF hợp lệ có Name rỗng bị từ chối

**Nguyên nhân:** `validateRawPdfDict` tại [media-reader.ts](../../../src/lib/file-parsers/media-reader.ts):1222 dùng `return idx > ns ? "NAME" : null`, bắt buộc Name sau `/` có ít nhất một ký tự. PDF 32000-1 mục **7.3.5** xác định riêng dấu `/` là một Name hợp lệ có chuỗi tên rỗng. [Đặc tả Adobe](https://raw.githubusercontent.com/adobe/dc-acrobat-sdk-docs/master/docs/standards/pdfstandards/pdf/PDF32000_2008.pdf).

**Tái hiện:** [media-cases.mjs](media-cases.mjs) chỉ thêm `/Other << /Value / >>` hoặc `/Other [/]` vào từ điển Pages của cây trang/xref thật. Cả hai giữ `/Count 1` hợp lệ. Bộ chính và native trả **PARSE_ERROR, 0 inlineData**; kỳ vọng **PARSED, 1 inlineData nguyên byte**. Hai đối chứng chỉ đổi `/` thành `/Nonempty` đều đạt. ID lỗi: `R30-01-pdf-nested-empty-name` và `R30-01-pdf-array-empty-name`. [Hai mẫu PDF](evidence/new-findings.json).

[pdf-name-repro.mjs](pdf-name-repro.mjs) đọc nguồn R29 đúng hash trong VM: **4/4 mẫu được nhận**, chứng minh hai ca mới là hồi quy nguồn. [pdf-name-oracle.py](pdf-name-oracle.py) kiểm **4/4** bằng pypdf strict trên từ điển thật và PDF hoàn chỉnh (một trang), đồng thời bộ đọc byte độc lập nhận `('NAME', b'')`. Không dựa riêng vào cơ chế phục hồi của pypdf. [Đối chứng cũ/mới](evidence/pdf-name-results.json), [oracle](evidence/pdf-name-oracle-results.json).

**Ảnh hưởng:** PDF hợp lệ theo cú pháp bị gắn lỗi đọc file; giáo viên phải xử lý thủ công và bài không đi tiếp tới chấm. Chưa gọi AI thật, không suy ra điểm sai hoặc dữ liệu thật bị ảnh hưởng.

**Cách sửa hẹp:** phân biệt việc đã tiêu thụ dấu `/` tạo Name rỗng hợp lệ với việc không có giá trị sau khóa. Cho phép Name rỗng ở vị trí giá trị hợp lệ trong mảng/từ điển con, giữ kiểm tiêu thụ liên tục, dấu phân cách rời, khóa thiếu giá trị, INT/REAL, NUL và mọi rào đã đạt. Không sửa worker. [FIX_PROMPT.vi.md](FIX_PROMPT.vi.md).

## 5. Toàn bộ cổng chạy mới

Có **42 lệnh riêng biệt, 48 lượt thử**, giữ đủ stdout/stderr, mã thoát, thời gian và hash. **32 cổng cuối thoát 0**; ba cổng R30 (`round30`, `native30-media`, `pdf-name`) cùng tái hiện hai lỗi mới; bảy cổng lịch sử FAIL/BLOCKED được giữ nguyên và giải thích ở mục 7. Không gọi tất cả cổng lịch sử là PASS. Tên `tsx`, `tsc`, `next` dưới đây viết gọn; runner gọi đúng file trong node_modules bản sao. Lệnh và cwd tuyệt đối nằm trong [commands.json](evidence/commands.json); [tổng hợp](evidence/gate-summary.json).

| Bộ / lệnh | Kết quả cuối | Mã thoát | Bằng chứng |
|---|---|---:|---|
{gate_table}

TypeScript trước/sau dùng đúng `--noEmit --incremental false`, chạy lần lượt trước và sau `next build --webpack` trong cùng bản sao chính. Build hoàn tất **22/22 trang**. Phase 4/5 đạt trong bản TEMP ngắn có cùng nguồn. [Phiên bản công cụ](evidence/runtime-versions.json).

## 6. Đối chiếu đủ 14 nhóm

`CLOSED_SOURCE` nghĩa là đạt trong nguồn/tình huống đã kiểm. Các ca gắn nhóm không gồm mọi ca API/COMPAT, nên không cộng bảng này thành 819. [Trạng thái và đủ ID](evidence/issue-status.json).

| Nhóm | Trạng thái | Đạt / tổng |
|---|---|---:|
{issue_table}

## 7. Kết quả lịch sử nguyên bản

- **R12 43/43, R13 89/89, R17 38/38:** đạt khi chạy mới.
- **R16 15/16:** kỳ vọng bảy bảng đã cũ; hiện có tám bảng. Đối chứng schema R23 đạt.
- **R19 89/94:** bốn placeholder media không đủ cấu trúc bị từ chối; một approval thiếu bản giáo viên đã xem.
- **R20 140/145:** bốn approval thiếu bản đã xem; một phản hồi `saveGrade` không khớp mutation `saveHomeworkGrade`.
- **R21 45/49:** bốn control dùng phản hồi sai trường mutation; các đối chứng R26 đúng hợp đồng đạt.
- **R15:** `confirmedBugs=0`, `baselinePassed=2`, `executionErrors=8`, mã 1. Assertion tái hiện lỗi/hợp đồng cũ, fixture và schema bảy bảng không đạt. Không gọi là PASS hoặc khẳng định mọi lỗi cũ đã sửa từ kết quả này.
- **R14/R18:** chạy nguyên bản `run-checks.mjs` nhưng bị rào giữ hồ sơ chặn (`Do not overwrite a previous run`, `Audit already captured`). Không xóa file hoặc bỏ rào để chạy lại. Các bộ thành phần/TypeScript/build được chạy riêng.

Tập ID trượt R16/R19/R20/R21 khớp R29. Đủ **10/10 đối chứng tương thích** kế thừa đều chạy mới và đạt. Không đổi assertion, không dùng log cũ thay thực thi. [Giải thích và ID](evidence/historical-contract-differences.json).

## 8. Giới hạn và bàn giao

Rà nguồn cho thấy dev/start bind **127.0.0.1**; một persistent BrowserContext có khóa khởi tạo; save/download qua SequentialTaskQueue; đọc bài qua allowlist; HTTP 200/201, đóng toast, hash bản duyệt và cập nhật VERIFIED có điều kiện được giữ. Hai entrypoint giao diện Giai đoạn 5 không tham chiếu ba biến mật khẩu/khóa nhạy cảm trong quy tắc dự án. Đây là rà các đường liên quan, không phải chứng nhận an toàn toàn hệ thống.

Chưa đăng nhập hoặc thao tác LMS/Gemini thật; chưa dùng tài khoản/DB/bài nộp thật, chưa chạy trình duyệt/giao diện React thật, chưa xác nhận schema hay lưu/đọc lại LMS thật. Corpus PDF hẹp không bao phủ mọi tài liệu PDF. Kết luận NO-GO áp dụng đúng danh mục hash nguồn R30.

**Đã làm:** hoàn tất kiểm toán độc lập, giữ nguyên 815 ca R29, chạy đủ cổng yêu cầu, đối chứng tám lỗi bằng nguồn cũ đúng hash, xuất báo cáo/log/mẫu/hash và cập nhật kế hoạch.

**Kết quả:** **NO-GO cấp mã nguồn, 13/14 CLOSED_SOURCE**; đủ tám lỗi R29 đã đóng nhưng còn hai ca hồi quy mới thuộc R19-01 P2. Mục nghiệm thu sau R30 giữ [ ].

**Chưa kiểm tra:** tài khoản, dữ liệu, dịch vụ, trình duyệt và lưu/đọc lại LMS thật.

**Việc tiếp theo:** chuyển [FIX_PROMPT.vi.md](FIX_PROMPT.vi.md) cho bên triển khai sửa hẹp bộ đọc PDF, rồi kiểm toán lại nguồn cuối. Owner chưa cần chạy Terminal hoặc cung cấp tài khoản. Chưa ký nghiệm thu Giai đoạn 5.
'''
(p/'REPORT.vi.md').write_text(report,encoding='utf-8',newline='\n')
(p/'FIX_PROMPT.vi.md').write_text('''# Yêu cầu sửa sau AUDIT-R30

**NO-GO cấp mã nguồn, 13/14 CLOSED_SOURCE; còn R19-01 P2.** Đã đóng đủ tám lỗi R29. Còn hai PDF hợp lệ chứa Name rỗng trong mảng/từ điển con bị từ chối; nguồn R29 đúng hash nhận chúng, pypdf strict và oracle byte độc lập xác nhận hợp lệ. [Báo cáo](REPORT.vi.md), [mẫu và hash](evidence/new-findings.json).

Chuyển nội dung dưới đây cho bên triển khai:

```text
Đọc AGENTS.md, MINDX_AUTOMATION_PLAN.md và docs/audits/round-30/REPORT.vi.md. Giữ công việc chưa commit; không sửa bất kỳ hồ sơ round-12..round-30 hoặc thay kỳ vọng để làm xanh. Giữ next-env.d.ts ở workspace chính đúng SHA-256 B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000.

Sửa tối thiểu src/lib/file-parsers/media-reader.ts, hash nguồn R30 3d677823077a3c7eb36f7261f45970ca7b7903e9797b1568ce602f86109760ac. Không sửa grade-worker.ts.

Lỗi tại validateRawPdfDict, dòng 1222: return idx > ns ? "NAME" : null từ chối giá trị Name rỗng '/'. PDF 32000-1 mục 7.3.5 xác định dấu '/' không có ký tự tên theo sau là Name hợp lệ. Hai mẫu thêm /Other << /Value / >> hoặc /Other [/] vào từ điển Pages hợp lệ hiện trả PARSE_ERROR/0 inlineData; phải PARSED/1 inlineData nguyên byte:
- R30-01-pdf-nested-empty-name
- R30-01-pdf-array-empty-name

Phân biệt đã tiêu thụ dấu '/' tạo Name hợp lệ với trường hợp khóa không có giá trị. Giữ hai đối chứng /Nonempty đạt, không nhận sai khóa thiếu giá trị hoặc delimiter rời. Không chỉ bỏ validateRawPdfDict hoặc bỏ rào quét liên tục.

Giữ tám ca R29 đã đóng và toàn bộ rào INT/REAL, sáu whitespace PDF 00/09/0A/0C/0D/20, mười delimiter, khóa trùng/thiếu giá trị, Length reference/generation, stream boundary/endstream/endobj, Kids/Parent/Count và chu kỳ. Giữ worker và các rào HTTP 200/201, đúng mutation/alias/root/biến tham chiếu, GraphQL errors, đọc lại và VERIFIED theo hash.

Chỉ chạy sản phẩm, SQLite giả, test, TypeScript và build trong TEMP cô lập theo audit-runner.py R30; không sao chép mật khẩu, hồ sơ đăng nhập, DB hoặc bài nộp thật. Dùng ESBUILD_BINARY_PATH ở đường dẫn TEMP ngắn và bản sao ngắn cho SQLite/Python khi cần; không cài lại thư viện hoặc sửa kiểm thử lịch sử.

Bằng chứng trên đúng nguồn cuối:
- R30: 819/819, native media 221/221, native worker 88/88; giữ nguyên 815 ca R29 và bốn ca R30. pdf-name oracle 4/4; đối chứng nguồn R29 nhận hai mẫu phải giữ đúng hash.
- R29: 815/815, native media 217/217, native worker 88/88; R28: 737/737, 163/163, 64/64; R27: 662/662, 120/120, 32/32; R26: 510/510, 94/94, 54/54.
- R25: 344/344, native media 25/25, native worker 9/9; R24 230/230, R23 116/116, R22 53/53; native R24 8/8.
- PDF oracle đủ 54 kỳ vọng R29; GraphQL oracle 88/88. Không coi pypdf tự phục hồi file sai là bằng chứng cú pháp hợp lệ.
- Phase 4/5, tsc --noEmit --incremental false trước/sau next build --webpack phải đạt.
- Chạy R12..R21 nguyên bản, giữ FAIL/BLOCKED và giải thích hợp đồng cũ; 10 đối chứng tương thích phải đạt. Không sửa/xóa lịch sử R14/R18 để bỏ rào.

Trả diff, danh sách file sửa, SHA-256 nguồn cuối, lệnh/mã thoát/log và giới hạn chưa kiểm thực tế. Chỉ đề nghị GO sau kiểm toán mới; không ký nghiệm thu LMS thật từ dữ liệu giả.
```
''',encoding='utf-8',newline='\n')
(e/'harness-development-notes.md').write_text('''# Ghi chú bộ kiểm R30

- Giữ nguyên 815 ID/tiêu chí/kỳ vọng R29; đổi vỏ đường dẫn, prefix, import và nhãn vòng, sau đó thêm bốn ca R30 về Name rỗng/đối chứng. Không sửa bộ kiểm hoặc hồ sơ R12–R29 trong workspace chính.
- Tiền tố tương thích thêm R29 làm đường dẫn dài hơn R29. Lần 1 native25-worker, Phase 4/5 gặp SQLITE_CANTOPEN khi mở SQLite/WAL tại cwd dài; PDF oracle không import được pdf_dict_oracle dưới đường dẫn dài (ModuleNotFoundError).
- Chạy lại đúng các file kiểm nguyên bản với nguồn/thư viện sao chép vật lý sang TEMP ngắn hơn. Cả bốn lần 2 đạt; giữ tất cả log lần 1 trong commands.json. Không cài lại, đổi phiên bản, sửa sản phẩm hoặc bỏ assertion.
- Build và TypeScript trước/sau đạt ngay lần 1 trong bản sao chính; không chạy build ở workspace chính.
- Đã chạy lại nguyên bản R12–R21; R14/R18 tự chặn ghi đè hồ sơ. Các kết quả lịch sử FAIL/BLOCKED không đổi thành PASS. 10 đối chứng tương thích hiện hành đạt.
- capture-review.py kiểm nguồn R28/R29 theo manifest trước khi diff; pdf-baseline-repro.mjs kiểm lại toàn bộ 57 src/scripts trước khi chạy nguồn media cũ trong VM. Không sửa bản nguồn lịch sử.
- scaffold.py là bước dựng ban đầu. audit-runner.py hiện tại có bổ sung chọn bản TEMP ngắn cho bốn cổng trên; không chạy lại scaffold.py để ghi đè runner đã hoàn thiện. finalize-evidence.py tự dựng lại vỏ verifier trong bộ nhớ để đối chiếu từng byte.
- Bốn ca R30 mới được thêm sau khi rà điều kiện Name của validator mới; cả bộ chính/native cùng trượt đúng hai ca. Nguồn R29 đúng hash và pypdf/oracle độc lập chứng minh hồi quy. Các kết quả 815/815, 217/217 trước khi mở rộng giữ nguyên dưới attempt-1; kết quả cuối là 817/819 và 219/221.
- Một lệnh chuẩn bị capture-static ban đầu sai dấu nháy của PowerShell, chưa tạo hoặc chạy được bộ kiểm. Đã thay bằng capture-review.py; đây không phải lượt thực thi sản phẩm và không tính vào 48 lượt chạy cổng.
''',encoding='utf-8',newline='\n')
(e/'reference-sources.json').write_text(json.dumps({'checkedAt':state['capturedAt'],'references':[
    {'title':'PDF 32000-1:2008','url':'https://opensource.adobe.com/dc-acrobat-sdk-docs/standards/pdfstandards/pdf/PDF32000_2008.pdf',
     'sections':['7.2.2 Tables 1 and 2','7.3.5','7.3.7'],'method':'Fresh web searches against the Adobe primary specification, including the explicit empty Name rule in 7.3.5; web open rejected the 22491828-byte PDF due to response size. Independent byte syntax and pypdf strict checks are recorded separately.',
     'pdfWhitespaceHex':['00','09','0A','0C','0D','20'],'pdfDelimiters':'()<>[]{}/%'},
    {'title':'Installed Next.js TypeScript guide','file':'node_modules/next/dist/docs/01-app/03-api-reference/05-config/02-typescript.md',
     'method':'Read from installed package before verification; documents next-env.d.ts regeneration on build and TypeScript CLI.'} ]},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Vietnamese R30 report, handoff and harness notes written from fresh receipts.')
