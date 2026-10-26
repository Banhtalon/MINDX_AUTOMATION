# AUDIT-R27 — Kiểm toán độc lập Giai đoạn 5

**Phán quyết: NO-GO Giai đoạn 5 ở cấp mã nguồn. Chưa đủ điều kiện nghiệm thu.**

Có **12/14 nhóm CLOSED_SOURCE**, còn **R19-09 (P1)** và **R19-01 (P2) PARTIALLY_FIXED**. Bản hiện tại đã vượt toàn bộ **510/510 ca R26**, gồm đúng 11 ca từng trượt; native R26 đạt **94/94 media** và **54/54 worker**. Tuy nhiên, bộ độc lập R27 đạt **650/662**, còn **12 ca trượt mới**, được xác nhận lại bằng cách nạp trực tiếp mô-đun sản phẩm.

`CLOSED_SOURCE` nghĩa là đạt trong phạm vi mã nguồn và tình huống đã kiểm. Kết quả này chưa thay thế nghiệm thu trên tài khoản, dữ liệu và LMS thật. P1 cần ưu tiên vì rào xác nhận vẫn có thể ghi VERIFIED sai; P2 còn nhận PDF sai cấu trúc. Không có bằng chứng về sự cố lưu nhầm đã xảy ra trên LMS thật.

## 1. Bản nguồn và phạm vi

- Ngày kiểm toán: **21/10/2026**, giờ Việt Nam. Trạng thái nguồn được ghi lúc `2026-10-20T19:48:06.877984Z`, tức **02:48:06 ngày 21/10**.
- HEAD: `2570d96b6770957e218031c91f14ce98e766dfa7`. Cây làm việc có nhiều thay đổi chưa commit từ trước; kiểm toán không reset, commit hoặc ghi đè những thay đổi đó. [Trạng thái đầu](evidence/source-state.json).
- [Danh mục nguồn lúc chụp](evidence/source-manifest.json): **74 file**, trong đó **57 file src/scripts**; SHA-256 tổng hợp `bacf63959b237558d2ede553c93841d45a95015aec278408269320f844cdf8c0`.
- So với danh mục R26, chỉ có sẵn hai file khác: `src/lib/file-parsers/media-reader.ts` và `src/lib/playwright/grade-worker.ts`. Đây là thay đổi có trước R27. [Đối chiếu](evidence/changes-since-r26.json).
- Đã đọc kế hoạch, quy tắc dự án, REPORT/FIX_PROMPT R26 và các bộ kiểm chứng liên quan; đối chiếu TASK-5.1–TASK-5.5: tải đúng bài → đọc file → đề xuất điểm → giáo viên xem và duyệt → lưu LMS → đọc lại → VERIFIED. Rà parser, AI, kiểm toán điểm, SQLite, API duyệt/lưu, giao diện, worker, bộ lọc mạng, hàng đợi và quản lý trình duyệt.
- Giả định sử dụng: **một giáo viên chạy trên máy cục bộ**, tác vụ trình duyệt chạy tuần tự; các phản hồi AI, lưu nháp và tải giao diện vẫn có thể đến lệch thứ tự.

Bản sao chính:

```text
C:\Users\QQ\AppData\Local\Temp\mindx-round27-20261020T194806Z-mindx-round26-compat-mindx-round25-compat-mindx-round24-compat-mindx-round23-compat-mindx-round22-compat\snapshot
```

R20/R21 chạy nguyên bản trong bản sao phụ `../mindx-round20-compat-mindx-round21-compat/snapshot`, tính từ thư mục cha của snapshot chính. Đường dẫn, thời gian, lệnh và mã thoát từng lượt có trong [commands.json](evidence/commands.json).

Mã băm nguồn nói trên mô tả **bản đầu vào của kiểm toán**. Khi hoàn tất chỉ thêm mục AUDIT-R27 vào kế hoạch theo AGENTS.md; [plan-update.json](evidence/plan-update.json) ghi riêng thay đổi tài liệu này. Code sản phẩm không đổi.

## 2. Cách kiểm chứng và cô lập

[verify-independent.mjs](verify-independent.mjs) kế thừa nguyên **510 ID và điều kiện kiểm tra R26**, chỉ đổi phần bao ngoài của vòng kiểm toán và vị trí import bộ mẫu, rồi thêm **152 ca**. [assemble-verifier.py](assemble-verifier.py), [phần ca mới](r27-cases.inc.txt), [nguồn gốc](evidence/harness-provenance.json) và [kiểm tra hiện vật](evidence/artifact-check.json) cho phép đối chiếu. 510 ca đầu có cùng ID, điều kiện và kết quả với lượt R26 nguyên bản vừa chạy; không đổi kỳ vọng để làm xanh.

| Phần R27 | Đạt / Tổng | Trượt |
|---|---:|---:|
| 510 ca R26 kế thừa | **510/510** | 0 |
| 64 WebP mới hợp lệ, 40 WebP cắt đuôi đối chiếu giải mã | **104/104** | 0 |
| 16 PDF mới, gồm đối chứng hợp lệ và mẫu sai cấu trúc | **12/16** | 4 |
| 32 yêu cầu/phản hồi lưu điểm mới | **24/32** | 8 |
| **Tổng** | **650/662** | **12** |

Bộ chính chạy thân hàm sản phẩm sau khi bỏ import/export và khai báo kiểu theo bộ R26. SQLite trong bộ này chạy thật ở bộ nhớ; file thử nghiệm là file vật lý giả; DOM/API/Gemini và hook giao diện được mô phỏng. Điều này chưa kiểm hành vi React hoặc trình duyệt thật.

Hai bộ bổ sung **import trực tiếp mô-đun sản phẩm qua tsx, không tách hoặc sửa mã nguồn**:

- [native-media-repro.mjs](native-media-repro.mjs): **116/120**, xác nhận đúng bốn PDF trượt. 104 WebP được giải mã toàn bộ pixel bằng `sharp`/libwebp, thư viện giải mã ảnh độc lập với bộ kiểm tra của sản phẩm. [Kết quả](evidence/native-media-results.json).
- [native-worker-repro.mjs](native-worker-repro.mjs): **24/32**, xác nhận ba ca VERIFIED sai trong hợp đồng giả và năm dạng yêu cầu hợp lệ bị từ chối. SQLite riêng trong TEMP; chỉ thay phương thức cộng tác bằng DOM/API giả lúc chạy. [Kết quả](evidence/native-worker-results.json).

Không cộng các bộ native vào 662 ca vì chúng kiểm chứng chéo cùng tình huống. [Danh mục mẫu lỗi](evidence/fixture-manifest.json) liên kết **4 PDF đúng bytes và 8 hồ sơ request/response**, kèm SHA-256, mong đợi và thực tế.

Đối chứng độc lập bổ sung:

- [graphql-oracle.mjs](graphql-oracle.mjs) dùng bộ đọc ký tự và cấu trúc đệ quy riêng, nhận biết chuỗi thường, chuỗi ba dấu nháy, comment, số dạng mũ và selection lồng nhau: **32/32**. Nó xác nhận root field thực sự được gọi và biến thực sự nằm trong đối số của root, không dùng text bên trong chuỗi làm bằng chứng. Đây là kiểm cú pháp và liên kết đối số trên bộ mẫu, **không xác nhận schema LMS thật**. [Kết quả](evidence/graphql-oracle-results.json).
- [pdf-oracle.py](pdf-oracle.py) dùng **pypdf strict=True**, lấy Root từ trailer thật, ghi bảng xref trước khi thư viện tự phục hồi, đọc bytes stream theo Length và kiểm kiểu phần tử Kids. Nó xác nhận Root 9 không có trong xref ở ba mẫu và văn bản object 9 nằm trong stream thật; xác nhận số `999` có trong Kids ở mẫu còn lại. pypdf vẫn tự tìm lại object 9 và mở được một số mẫu; **không coi đây là đối chứng từ chối hoặc kết xuất PDF**. [Kết quả](evidence/pdf-oracle-results.json).

[audit-runner.py](audit-runner.py) sao thư viện thành file riêng, không dùng junction trỏ ngược thư mục chính, không cài hoặc cập nhật thư viện. Chỉ sao `data/config`, không sao `.env*`, `.git`, DB thật, `playwright-auth`, bài nộp hay file debug thật. Có sao `.next/types` và `.next/dev/types` để kiểm đúng trạng thái kiểu trước build. [Cô lập](evidence/isolation.json).

Tiến trình con chỉ nhận danh sách biến Windows tối thiểu, không nhận mật khẩu hoặc khóa API. [network-guard.cjs](network-guard.cjs) chặn TCP, DNS và fetch của Node; cho phép named pipe dùng nội bộ bởi tsx/Next. Đây không phải tường lửa hệ điều hành. Không khởi động Chromium, gọi LMS/Gemini hay dùng tài khoản thật. Các thông báo dotenv trong log build đều báo nạp **0 biến**.

## 3. Các cổng chạy lại

Mọi lệnh dưới đây chạy trong snapshot TEMP. [commands.json](evidence/commands.json) ghi **35 lượt chạy của 27 lệnh riêng**; xét lượt cuối của mỗi lệnh có **20 mã thoát 0, 7 mã thoát khác 0**. Các lượt R27 lặp lại giữ cùng ID/kết quả; lần cuối làm rõ response của hai mẫu selection lồng nhau để trả đủ các trường đã chọn, không đổi kỳ vọng. Mọi log và kết quả từng lượt đều được giữ. Ghi chú về khôi phục ba biên nhận lượt đầu từ console và rà bộ mẫu có tại [harness-development-notes.md](evidence/harness-development-notes.md); hash log/kết quả đã đối chiếu lại.

| Lệnh từ thư mục snapshot | Kết quả | Mã thoát |
|---|---|---:|
| `node docs/audits/round-27/verify-independent.mjs` | **650/662 FAIL** | 1 |
| `node node_modules/tsx/dist/cli.mjs docs/audits/round-27/native-media-repro.mjs` | **116/120 FAIL** | 1 |
| `node node_modules/tsx/dist/cli.mjs docs/audits/round-27/native-worker-repro.mjs` | **24/32 FAIL** | 1 |
| `node docs/audits/round-26/verify-independent.mjs` | **510/510 PASS** | 0 |
| `node node_modules/tsx/dist/cli.mjs docs/audits/round-26/native-media-repro.mjs` | **94/94 PASS** | 0 |
| `node node_modules/tsx/dist/cli.mjs docs/audits/round-26/native-worker-repro.mjs` | **54/54 PASS** | 0 |
| `node docs/audits/round-25/verify-independent.mjs` | **344/344 PASS** | 0 |
| `node node_modules/tsx/dist/cli.mjs docs/audits/round-25/native-media-repro.mjs` | **25/25 PASS** | 0 |
| `node node_modules/tsx/dist/cli.mjs docs/audits/round-25/native-worker-repro.mjs` | **9/9 PASS** | 0 |
| `node docs/audits/round-24/verify-independent.mjs` | **230/230 PASS** | 0 |
| `node docs/audits/round-23/verify-independent.mjs` | **116/116 PASS** | 0 |
| `node docs/audits/round-22/verify-independent.mjs` | **53/53 PASS** | 0 |
| `node node_modules/tsx/dist/cli.mjs docs/audits/round-24/native-media-repro.mjs` | **8/8 PASS** | 0 |
| `node node_modules/tsx/dist/cli.mjs scripts/test-phase4-codex-repros.ts` | **PASS** | 0 |
| `node node_modules/tsx/dist/cli.mjs scripts/test-phase5.ts` | **PASS** | 0 |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` trước build | **0 lỗi PASS** | 0 |
| `node node_modules/next/dist/bin/next build --webpack` | **22/22 trang PASS** | 0 |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` sau build | **0 lỗi PASS** | 0 |
| `node docs/audits/round-27/graphql-oracle.mjs` | **32/32 PASS**, kiểm bộ mẫu | 0 |
| `python docs/audits/round-27/pdf-oracle.py` | **PASS thực thi**, ghi quan sát 16 PDF; không phải 16 chứng nhận hợp lệ | 0 |
| `node docs/audits/round-12/verify-independent.mjs` | **43/43 PASS** | 0 |
| `node docs/audits/round-13/verify-independent.mjs` | **89/89 PASS** | 0 |
| `node docs/audits/round-16/verify-independent.mjs` | **15/16 FAIL**, kỳ vọng cũ 7 bảng | 1 |
| `node docs/audits/round-17/verify-independent.mjs` | **38/38 PASS** | 0 |
| `node docs/audits/round-19/verify-independent.mjs` | **89/94 FAIL**, phân tích ở mục 6 | 1 |
| `node docs/audits/round-20/verify-independent.mjs` | **140/145 FAIL**, hợp đồng cũ | 1 |
| `node docs/audits/round-21/verify-independent.mjs` | **45/49 FAIL**, hợp đồng cũ | 1 |

Tám cổng bắt buộc theo REPORT R26 và các yêu cầu hồi quy/native R26 trong FIX_PROMPT R26 đều đạt. Kết quả này **không làm bộ độc lập R27 thành PASS**. [Log build](evidence/build.attempt-1.log), [TypeScript trước](evidence/typecheck-before.attempt-1.log), [TypeScript sau](evidence/typecheck-after.attempt-1.log).

## 4. Đối chiếu đủ 14 nhóm R19

Danh sách ID, số đạt/trượt và nhận định từng nhóm có trong [issue-status.json](evidence/issue-status.json). Các trạng thái sau dựa trên lượt chạy mới của bản nguồn hiện tại.

| Nhóm | Trạng thái | Bằng chứng hiện tại |
|---|---|---|
| R19-01 — xử lý file hỏng | **PARTIALLY_FIXED, P2** | Tất cả media R26 đạt; 104 WebP mới đạt; còn 3 PDF có marker stream đánh lạc hướng và 1 Kids chứa số |
| R19-02 — barem và tổng điểm | CLOSED_SOURCE | Chặn tiêu chí trùng/thiếu, điểm sai giới hạn và evidence rỗng; tổng 79.37 tính đúng |
| R19-03 — hash bản duyệt | CLOSED_SOURCE | Thay feedback/decision trước Save không được ghi; đối chứng duyệt hiện tại đạt |
| R19-04 — AI cũ/file đổi | CLOSED_SOURCE | File vật lý/phiên bản đổi trong lúc AI chạy không bị kết quả cũ ghi đè |
| R19-05 — duyệt phải kiểm toán | CLOSED_SOURCE | API/handler chặn PARSE_ERROR, duyệt vẫn đối chiếu barem hiện hành |
| R19-06 — duyệt bản xem cũ | CLOSED_SOURCE | Đủ snapshot năm trường; điểm/nhận xét cũ nhận 409; metadata bền |
| R19-07 — đúng người/đúng bài | CLOSED_SOURCE | Sai submissionId hoặc S10/SUB10 không khớp S1/SUB1 để Save |
| R19-08 — đúng lớp/buổi/lesson | CLOSED_SOURCE | Chặn lớp/buổi/lesson sai; đối chứng mapping đúng đạt với response đúng trường |
| R19-09 — đúng API lưu điểm | **PARTIALLY_FIXED, P1** | Hai operation giả trong block string và một enum trùng token gây VERIFIED sai; năm dạng hợp lệ bị từ chối |
| R19-10 — đọc lại đầy đủ | CLOSED_SOURCE | Điểm/quyết định/feedback phải khớp; feedback không đọc được không VERIFIED |
| R19-11 — cập nhật VERIFIED cuối | CLOSED_SOURCE | Hash thay đổi hoặc UPDATE cuối bị lỗi đều không VERIFIED; CAS giữ bản mới chưa duyệt |
| R19-12 — phản hồi cũ trên giao diện | CLOSED_SOURCE | Phản hồi lớp/buổi cũ đến muộn không thay danh sách mới trong mô phỏng handler |
| R19-13 — lưu nháp/sequence/hoàn tác | CLOSED_SOURCE | Lỗi SQLite không ghi một phần, sequence bền qua reload, phục hồi sau trigger đạt |
| R19-14 — lỗi tải và phạm vi AI | CLOSED_SOURCE | Tải lỗi dừng AI; lượt thành công chỉ chấm bài mới tải, loại OLD_CACHED |

Rào cục bộ vẫn được giữ trong phần mã đã đọc: dev/start bind `127.0.0.1`; tải/lưu trình duyệt qua hàng đợi tuần tự; BrowserManager giữ một persistent context; đường dẫn bài nộp qua allowlist. Hai điểm vào Client không tham chiếu mật khẩu/khóa AI hoặc import cấu hình máy chủ trong phần đã rà. Đây là đối chiếu mã nguồn, chưa phải kiểm một server hay trình duyệt thật. [Tham chiếu](evidence/static-review.json).

## 5. Phát hiện còn mở

### R19-09 — P1: Block string vẫn làm văn bản trở thành operation được xác nhận

**Nguyên nhân:** Bộ thay chuỗi tại [grade-worker.ts:426](../../../src/lib/playwright/grade-worker.ts#L426) chỉ nhận chuỗi một dấu nháy. GraphQL còn có block string dùng ba dấu nháy `"""`. Dấu `"` đơn bên trong block string là nội dung hợp lệ, nhưng bộ hiện tại coi đó là điểm kết thúc chuỗi. `opRegex` tại [dòng 439](../../../src/lib/playwright/grade-worker.ts#L439) sau đó nhìn thấy một operation giả trong nội dung ấy.

**Tái hiện:** `R27-09-block-quote-decoy-deleteAttachment` và `R27-09-block-quote-decoy-previewHomework` có root thật là `deleteAttachment` hoặc `previewHomework`. Ví dụ:

```graphql
mutation SaveHomeworkGrade {
  saved:deleteAttachment(note:"""a " mutation SaveHomeworkGrade {
    saved:saveHomeworkGrade(input:$input) { id }
  } " b""") { id }
}
```

Toàn bộ `mutation ... saveHomeworkGrade ... $input` ở giữa là **văn bản của tham số note**, không thực thi. Thế nhưng khi response giả trả `{data:{saved:{id:"SUB1"}}}` và DOM giả khớp bản duyệt, worker trả **verifiedCount=1**, SQLite thành **VERIFIED**, mỗi ca có một lần bấm Save. Bộ native xác nhận cả hai; bộ đọc cấu trúc độc lập xác nhận root thật khác thao tác lưu điểm và không có biến input trong đối số thực thi.

Đây là phản ví dụ cho rào xác nhận với hợp đồng giả. Chưa xác nhận LMS thật có các trường trên, nhận block string này, hoặc đã lưu/xóa nhầm dữ liệu.

**Cách sửa:** Đọc cấu trúc GraphQL với kiểu token riêng cho chuỗi thường, block string, comment, số, tên và biến. Chọn đúng operation, root field/alias và đối số của nó bằng cân bằng cấu trúc; chỉ dùng biến thực sự được tham chiếu trong đối số đã chọn. Không tiếp tục vá từng mẫu bằng regex.

**Sau khi sửa:** Hai ca phải không VERIFIED. Giữ toàn bộ yêu cầu hợp lệ, response đúng field/alias, HTTP 200/201, đọc lại điểm/quyết định/nhận xét và hash/CAS cuối.

**Ca bổ sung — nhầm enum với token nội bộ:** `R27-09-placeholder-enum-decoy` dùng `note:"APPROVED FEEDBACK"`, nhưng đối số thật `feedback:__GQL_STR_0__` là **enum**, không phải chuỗi đã duyệt. Tại [dòng 629](../../../src/lib/playwright/grade-worker.ts#L629), tên này trùng token nội bộ nên bị đổi thành nội dung note; worker cũng ghi VERIFIED. Bộ độc lập xác nhận loại token ENUM. Tên bắt đầu `__` là mẫu cố ý kiểm đầu vào sai hợp đồng; không khẳng định schema LMS thật chấp nhận enum này. Cần giữ loại token để dữ liệu người gửi không thể giả làm token do bộ phân tích tạo ra.

**Năm ca hợp lệ bị từ chối — ảnh hưởng P2 trong cùng nhóm:**

| ID | Nội dung hợp lệ | Thực tế |
|---|---|---|
| `R27-09-literal-exponent-score` | `score:8e1`, giá trị số 80 | Không khớp request, FAILED |
| `R27-09-literal-block-string` | Feedback `"""APPROVED FEEDBACK"""` | FAILED |
| `R27-09-literal-block-string-braces` | Block string chứa dấu `{` | FAILED |
| `R27-09-nested-selection` | `{ id submission { id } }`, response đủ các trường đã chọn | FAILED |
| `R27-09-deep-nested-selection` | `{ id submission { student { id } } }`, response đủ các trường đã chọn | FAILED |

Mỗi ca có một lần bấm Save trong mô phỏng, nhưng không VERIFIED. Bộ đọc cấu trúc riêng xác nhận đúng root/đối số; bộ native tái hiện. Cần hỗ trợ các cấu trúc hợp lệ thay vì giới hạn độ sâu bằng regex. Chưa xác nhận schema LMS thật sử dụng từng cấu trúc trả về này.

**Phần sửa R26 đã đạt:** Cả 54/54 ca native R26, gồm hai operation giả trong chuỗi thường và hai literal dấu ngoặc từng trượt, đều đạt. R27 không yêu cầu bỏ các kiểm tra scalar, response đồng nghĩa, alias hoặc hash đang đúng.

### R19-01 — P2: PDF vẫn bị hiểu nhầm ranh giới stream và bỏ qua phần tử Kids sai kiểu

**Nguyên nhân và vị trí:** [media-reader.ts:1156](../../../src/lib/file-parsers/media-reader.ts#L1156) chọn chữ `endstream` đầu tiên bằng regex để kết thúc phần dữ liệu stream, chưa dùng Length. Nội dung stream được phép chứa những bytes giống marker này. Khi dừng quá sớm, các chữ `endobj`/`9 0 obj` tiếp theo bên trong dữ liệu bị quét như object PDF thật.

**Tái hiện:** Ba ca `R27-01-pdf-stream-early-marker-_endstream_`, `..._endstream_r_`, `..._endstream_n_` đặt Root thật của trailer là `9 0 R`, trong khi bảng xref chỉ có object 1, 2, 3, 4. Object 4 có Length đúng; **toàn bộ văn bản object 9 nằm trong payload của stream 4**. Sản phẩm vẫn trả **PARSED + 1 inlineData**.

Native xác nhận cả ba. pypdf đọc stream theo Length, xác nhận payload còn chứa marker sớm và object 9; trước bước tự phục hồi nó xác nhận Root 9 không có trong xref. Sau đó pypdf tự tìm lại object 9 và mở được, nên không dùng khả năng mở của thư viện này để chứng nhận file đúng cấu trúc hoặc khẳng định file không thể hiển thị. Ba đối chứng cùng payload nhưng trailer trỏ Root 1 thật đều đạt; không nên cấm toàn bộ PDF có chữ `endstream` trong dữ liệu.

**Lỗi liên quan:** [dòng 1320](../../../src/lib/file-parsers/media-reader.ts#L1320) và [dòng 1323](../../../src/lib/file-parsers/media-reader.ts#L1323) chỉ nhặt những đoạn giống tham chiếu trong Kids, bỏ qua phần dư. `R27-01-pdf-kids-foreign-scalar` có `/Kids [3 0 R 999]`; số `999` không phải tham chiếu node con nhưng file vẫn **PARSED + 1 inlineData**. pypdf xác nhận Kids thật chứa một `IndirectObject` và một `NumberObject`; đây là thiếu kiểm tra cấu trúc, không phải kết luận từ bộ kết xuất.

**Cách sửa:** Xác định object và stream bằng cấu trúc PDF; dùng Length đã xác minh, xử lý tham chiếu Length an toàn nếu hỗ trợ, rồi xác nhận marker tại đúng ranh giới. Không tìm catalog bằng text nằm trong payload và không phục hồi im lặng để cấp PARSED. Với Kids, yêu cầu mọi phần tử là tham chiếu hợp lệ, không chỉ trích ra các đoạn trông đúng; giữ kiểm generation, Parent và chu kỳ.

**Sau khi sửa:** Bốn mẫu phải PARSE_ERROR, không có inlineData; giữ các PDF đối chứng có stream cùng nội dung nhưng Root thật. Giữ 104/104 WebP mới và 94/94 media R26. File lỗi không được tự chấm 0 hoặc tự chọn REDO.

**Phần sửa R26 đã đạt:** Ba WebP cắt đuôi cũ và bốn PDF cũ đều bị từ chối đúng; 64 WebP hợp lệ mới và 40 biến thể cắt đuôi đều khớp giải mã độc lập. Không tìm thấy lỗi WebP mới trong bộ mẫu này; chưa chứng minh mọi ảnh hoặc mọi giới hạn tài nguyên đều an toàn.

## 6. Kết quả lịch sử và cách phân biệt lệch hợp đồng

Không sửa hoặc ghi lại bất kỳ file lịch sử nào trong workspace chính. Các FAIL dưới đây vẫn là FAIL thô, không đổi nhãn thành PASS. [Chi tiết và ID](evidence/historical-contract-differences.json).

- **R12/R13/R16/R17: 185/186.** R16 `PHASE1-SCHEMA` còn đòi đúng 7 bảng; bản hiện tại có 8 bảng, thêm metadata bền cho bài chấm. Ca kế thừa `R23-COMPAT-R16-schema` vừa chạy đạt và kiểm đủ bảng/cột, nhưng không thay thế kết quả thô 15/16 của R16.
- **R19: 89/94.** Bốn ca `INLINE-png/jpg/webp/pdf` dùng mẫu ảnh/tài liệu hỏng hoặc quá sơ sài, chỉ nhằm kiểm MIME/Base64 ở thời điểm cũ; bộ parser hiện tại từ chối. Mẫu JPEG chỉ 8 bytes, WebP dùng `RIFF0000WEBPsynthetic`, PDF chỉ header/EOF, PNG không vượt kiểm cấu trúc/CRC hiện tại. `API-approval-control` thiếu snapshot giáo viên đã xem. Không nới parser hoặc bỏ rào duyệt để lấy lại 94/94; các đối chứng media hợp lệ và duyệt đủ snapshot trong bộ hiện tại đạt.
- **R20: 140/145.** Bốn ca duyệt thiếu snapshot: `API-approval-control`, `R20-03-legacy-reapproval`, `R20-05-override-control`, `R20-06-latest-control`. Ca `R20-10-complete-control` trả response `saveGrade` dù query chọn `saveHomeworkGrade`.
- **R21: 45/49.** Bốn ca `R21-08-mapping-valid`, `R21-10-readback-complete`, `R21-10-readback-redo-complete`, `R21-11-final-cas` cũng trả sai tên trường response; dừng trước bước hành vi cần kiểm.
- Bốn đối chứng `R24-COMPAT-R20-*` đủ snapshot và năm đối chứng `R26-COMPAT-*` dùng đúng trường response đều vừa chạy đạt. Ca CAS tương thích vẫn giữ WAITING_APPROVAL khi nội dung đổi. Không cộng các đối chứng này để tuyên bố bộ lịch sử nguyên bản đạt.

## 7. Bảo toàn và khả năng đối chiếu

[preservation-before-plan.json](evidence/preservation-before-plan.json) xác nhận **729/729 file ban đầu giữ nguyên** trước khi cập nhật tài liệu hoàn tất. [preservation-check.json](evidence/preservation-check.json) cuối xác nhận **652/652 file bảo vệ** gồm `next-env.d.ts` và toàn bộ hồ sơ Vòng 12–26 giữ nguyên từng byte; **57/57 file src/scripts** giữ nguyên.

Thay đổi duy nhất ngoài thư mục R27 là thêm mục AUDIT-R27 vào `MINDX_AUTOMATION_PLAN.md` theo quy tắc dự án. Không thay dấu nghiệm thu TASK-5.x. [Bản kế hoạch trước](evidence/plan.before.md) và [biên nhận cập nhật](evidence/plan-update.json) cho phép khôi phục riêng mục này; không cần reset cây làm việc. 728/729 file ban đầu không đổi; file còn lại chỉ đổi tài liệu kiểm toán đã nêu.

`next-env.d.ts` trong thư mục chính vẫn đúng SHA-256:

```text
B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000
```

Next build chỉ viết lại `next-env.d.ts` trong snapshot; [artifact-check.json](evidence/artifact-check.json) ghi hash riêng của hai bản và xác nhận code sản phẩm snapshot không đổi sau kiểm thử. [evidence-manifest.json](evidence/evidence-manifest.json) ghi SHA-256 của tài liệu, bộ kiểm chứng, mẫu và log bàn giao, trừ chính file manifest.

## 8. Kết quả bàn giao

**Đã làm:** Hoàn tất AUDIT-R27 độc lập, chạy bộ lịch sử/native, TypeScript trước/sau build, hồi quy Phase 4/5 và đối chiếu đủ 14 nhóm. Tạo báo cáo, yêu cầu sửa, bộ tái hiện và bằng chứng; không sửa code sản phẩm.

**Kết quả:** **NO-GO cấp mã nguồn, 12/14 nhóm CLOSED_SOURCE.** R19-09 còn có thể VERIFIED sai trong hợp đồng giả; R19-01 còn nhận PDF sai cấu trúc. Bản sửa đã giải quyết các tình huống R26 nhưng chưa đóng hết hai nhóm.

**Chưa kiểm tra:** Chromium/React thực tế; tài khoản, schema, API và LMS thật; Gemini thật; DB/bài nộp thật; khả năng kết xuất mọi PDF, mọi ảnh và giới hạn tài nguyên ở mọi kích thước. Các bộ DOM/API giả không chứng minh một thao tác thật đã lưu nhầm.

**Việc tiếp theo:** Bên triển khai sửa đúng hai nhóm theo [FIX_PROMPT.vi.md](FIX_PROMPT.vi.md), sau đó kiểm toán độc lập mới trên đúng snapshot đã sửa. Owner chưa cần thao tác kỹ thuật hoặc cung cấp tài khoản.
