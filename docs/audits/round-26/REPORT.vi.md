# AUDIT-R26 — Kiểm toán độc lập Giai đoạn 5

**Phán quyết chính thức: NO-GO Giai đoạn 5 ở cấp mã nguồn. Chưa đủ điều kiện cấp GO.**

Có **12/14 nhóm CLOSED_SOURCE**, còn **R19-01 (P2)** và **R19-09 (P1) PARTIALLY_FIXED**. Toàn bộ tám lệnh bắt buộc đều PASS, nhưng bộ kiểm chứng độc lập R26 đạt **499/510**, còn **11 ca trượt**. Hai bộ nạp trực tiếp mô-đun sản phẩm xác nhận lại đúng 11 ca đó. Bản sửa đã giải quyết toàn bộ tình huống R25, nhưng chưa giải quyết hết hai nhóm lỗi.

`CLOSED_SOURCE` nghĩa là đạt trong phạm vi mã nguồn và các tình huống đã kiểm. Trạng thái này không thay thế nghiệm thu bằng tài khoản, dữ liệu và LMS thật. P1 cần ưu tiên vì có thể xác nhận lưu điểm sai; P2 ảnh hưởng việc nhận diện và xử lý bài nộp.

## 1. Bản nguồn và phạm vi

- Ngày kiểm toán: **20/10/2026**. Bản chụp được tạo lúc `2026-10-20T14:20:26Z`, tương ứng **21:20:26 giờ Việt Nam**.
- HEAD: `2570d96b6770957e218031c91f14ce98e766dfa7`. Cây làm việc có nhiều thay đổi chưa commit từ trước; không reset, commit hoặc ghi đè. [Trạng thái đầu](evidence/source-state.json).
- [Danh mục nguồn](evidence/source-manifest.json): **74 file**, gồm **57 file src/scripts**; mã băm tổng hợp `b01fc4b210410d600c35991e91b4f9647f708efea1fde08b2536c145d580d572`.
- So với danh mục nguồn R25, có sẵn năm file khác: `media-reader.ts`, `grade-worker.ts`, `homework-grader/export/route.ts`, `homework-grader/page.tsx`, `test-phase4-codex-repros.ts`. Không có thay đổi sản phẩm nào do kiểm toán R26 thực hiện. [Đối chiếu](evidence/changes-since-r25.json).
- Đã đọc kế hoạch, quy tắc dự án, báo cáo và bộ kiểm chứng R25; đối chiếu TASK-5.1–TASK-5.5: tải bài theo ID → đọc file → đề xuất điểm → giáo viên duyệt → lưu LMS → đọc lại → VERIFIED. Rà các nhánh liên quan trong parser, AI, kiểm toán điểm, SQLite, API, giao diện, worker, bộ lọc mạng, hàng đợi và quản lý trình duyệt.

Bản sao chính để chạy thử:

```text
C:\Users\QQ\AppData\Local\Temp\mindx-round26-20261020T142026Z-mindx-round25-compat-mindx-round24-compat-mindx-round23-compat-mindx-round22-compat\snapshot
```

R20/R21 chạy bổ sung trong bản sao thứ hai tại `../mindx-round20-compat-mindx-round21-compat/snapshot` tính từ thư mục cha của bản sao chính; đường dẫn tuyệt đối có trong [nhật ký lệnh](evidence/commands.json).

## 2. Cách kiểm chứng và cô lập

[verify-independent.mjs](verify-independent.mjs) kế thừa nguyên **344 ID và điều kiện kiểm tra R25**, thay phần bao ngoài dành cho vòng kiểm toán rồi bổ sung **166 ca**. [Cách lắp bộ kiểm chứng](assemble-verifier.py), [phần ca mới](r26-cases.inc.txt), [nguồn gốc bộ kiểm chứng](evidence/harness-provenance.json) và [đối chiếu kết quả](evidence/artifact-check.json) ghi rõ việc kế thừa. 344 ca đầu có cùng ID, điều kiện và PASS/FAIL với lượt R25 nguyên bản vừa chạy.

| Phần R26 | Đạt / Tổng | Trượt |
|---|---:|---:|
| 344 ca R25 kế thừa | 344/344 | 0 |
| Media mới: 48 ảnh hợp lệ, 30 ảnh biến đổi/cắt dữ liệu, 15 PDF, 1 canvas sai | 87/94 | 7 |
| Yêu cầu/phản hồi lưu điểm mới | 50/54 | 4 |
| Đối chứng mới cho các nhóm còn lại và lỗi lưu SQLite | 13/13 | 0 |
| Đối chứng tương thích hợp đồng R20/R21 | 5/5 | 0 |
| **Tổng** | **499/510** | **11** |

Bộ chính chạy thân hàm sản phẩm sau khi bỏ import/export và khai báo kiểu theo cách của R25. SQLite và file giả chạy thật; DOM, API, Gemini và hook giao diện được mô phỏng. Hai bộ bổ sung **import trực tiếp mô-đun sản phẩm qua tsx, không tách hoặc sửa mã nguồn**:

- [native-media-repro.mjs](native-media-repro.mjs): **87/94**, xác nhận đúng bảy ca media trượt. `sharp`/libwebp giải mã toàn bộ pixel để đối chiếu ảnh. [Kết quả](evidence/native-media-results.json).
- [native-worker-repro.mjs](native-worker-repro.mjs): **50/54**, xác nhận hai ca VERIFIED sai và hai ca literal hợp lệ bị từ chối. SQLite riêng trong TEMP; thay các phương thức cộng tác bằng trình duyệt/API giả lúc chạy. [Kết quả](evidence/native-worker-results.json).

Không cộng các bộ này thành số tình huống duy nhất vì chúng kiểm chứng chéo cùng ca lỗi.

[Danh mục mẫu tái hiện](evidence/fixture-manifest.json) liên kết bảy file media đúng bytes và bốn hồ sơ request/response trượt tại `evidence/fixtures/`, kèm mã băm và kết quả mong đợi/thực tế.

Đối chứng thêm:

- [Bộ đọc GraphQL độc lập](graphql-oracle.mjs) coi chuỗi trích dẫn là một khối, kiểm tra cân bằng dấu, trường thực sự được gọi và biến thực sự xuất hiện bên ngoài chuỗi: **54/54**. Đây là kiểm tra từ vựng của các mẫu xác định, không xác nhận schema LMS. [Kết quả](evidence/graphql-oracle-results.json).
- [pypdf strict](pdf-oracle.py) đọc đúng bytes, lấy Root từ trailer và tra bảng xref — bảng chỉ vị trí các đối tượng PDF. Nó xác nhận Root thật bị thiếu và khóa Root trùng ở hai mẫu; đồng thời ghi rõ các trường hợp nó vẫn mở hoặc tự tìm lại đối tượng. Không coi pypdf là bộ kết xuất PDF hoặc là đối chứng từ chối cho mọi mẫu. [Kết quả](evidence/pdf-oracle-results.json).

Mọi lần chạy verifier, TypeScript, build, SQLite trigger và file thử nghiệm đều ở TEMP. Thư viện được sao thành file riêng, không dùng liên kết thư mục trỏ về dự án gốc; không cài/cập nhật thư viện. Không sao `.env*`, `.git`, DB thật, `playwright-auth`, bài nộp hoặc file debug thật. Chỉ sao `data/config`; sao thêm các khai báo kiểu `.next/types` và `.next/dev/types` để kiểm đúng trạng thái trước build. [Cô lập](evidence/isolation.json).

Tiến trình con nhận danh sách biến Windows tối thiểu, không nhận mật khẩu/khóa. [Rào mạng Node](network-guard.cjs) chặn TCP, DNS và fetch; cho phép named pipe để tsx/Next liên lạc nội bộ. Đây không phải tường lửa hệ điều hành. Không khởi động Chromium, không gọi LMS/Gemini và không dùng tài khoản thật.

## 3. Các cổng chạy lại

Tất cả lệnh trong bảng chạy với thư mục làm việc là bản sao TEMP. Mỗi lần chạy có thời gian, mã thoát, log và SHA-256 trong [commands.json](evidence/commands.json).

| Lệnh bắt buộc | Kết quả | Mã thoát |
|---|---|---:|
| `node docs/audits/round-25/verify-independent.mjs` | **344/344 PASS** | 0 |
| `node node_modules/tsx/dist/cli.mjs docs/audits/round-25/native-media-repro.mjs` | **25/25 PASS** | 0 |
| `node node_modules/tsx/dist/cli.mjs docs/audits/round-25/native-worker-repro.mjs` | **9/9 PASS** | 0 |
| `node docs/audits/round-24/verify-independent.mjs` | **230/230 PASS** | 0 |
| `node docs/audits/round-23/verify-independent.mjs` | **116/116 PASS** | 0 |
| `node docs/audits/round-22/verify-independent.mjs` | **53/53 PASS** | 0 |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` trước build | **0 lỗi PASS** | 0 |
| `node node_modules/next/dist/bin/next build --webpack` | **22/22 trang PASS** | 0 |

Các kiểm tra bổ sung: TypeScript **sau build 0 lỗi**, native R24 **8/8**, script Phase 4 và Phase 5 đều thoát **0**. `route.ts` hiện chỉ export `GET`, `page.tsx` chỉ export mặc định; khai báo kiểu do Next tạo trước/sau build đều được chấp nhận. [Log build](evidence/build.attempt-1.log), [TypeScript trước](evidence/typecheck-before.attempt-1.log), [sau](evidence/typecheck-after.attempt-1.log).

Bộ R26 cuối thoát **1**, đạt **499/510**; native media thoát **1**, **87/94**; native worker thoát **1**, **50/54**. Đây là FAIL của sản phẩm trên các ca mới, không phải lý do để sửa kỳ vọng kiểm tra. [Kết quả chính](evidence/verify-results.json).

## 4. Đối chiếu đủ 14 nhóm

Danh sách ID, số đạt/trượt và nhận định theo nhóm có tại [issue-status.json](evidence/issue-status.json).

| Nhóm | Trạng thái | Bằng chứng hiện tại |
|---|---|---|
| R19-01 — xử lý file hỏng | **PARTIALLY_FIXED, P2** | R25 đạt; R26 vẫn nhận 3 WebP cắt đuôi và 4 PDF sai cấu trúc/tham chiếu |
| R19-02 — barem và tổng điểm | CLOSED_SOURCE | Chặn trùng/thiếu tiêu chí, điểm ngoài giới hạn, thiếu bằng chứng; tổng 79.37 tính đúng |
| R19-03 — hash bản đã duyệt | CLOSED_SOURCE | Thay feedback hoặc decision trước Save không được ghi lên LMS |
| R19-04 — AI cũ/file đổi | CLOSED_SOURCE | File vật lý khác hoặc đổi phiên bản trong lúc AI chạy không ghi đè bản mới |
| R19-05 — duyệt phải kiểm toán | CLOSED_SOURCE | PARSE_ERROR bị chặn qua API/handler; dùng barem hiện hành |
| R19-06 — duyệt bản xem cũ | CLOSED_SOURCE | Đủ snapshot năm trường, từ chối điểm/nhận xét cũ bằng 409; metadata bền |
| R19-07 — đúng người/đúng bài | CLOSED_SOURCE | Sai submissionId và S10/SUB10 không thể khớp S1/SUB1 để Save |
| R19-08 — đúng lớp/buổi/lesson | CLOSED_SOURCE | Chặn lớp/buổi/lesson sai; mapping đúng đạt với response đúng trường |
| R19-09 — đúng API lưu điểm | **PARTIALLY_FIXED, P1** | Hai operation nằm trong chuỗi được nhầm là thao tác thật; hai literal hợp lệ bị từ chối |
| R19-10 — đọc lại đầy đủ | CLOSED_SOURCE | Điểm/quyết định/feedback phải khớp; feedback không đọc được không VERIFIED |
| R19-11 — cập nhật VERIFIED cuối | CLOSED_SOURCE | Drift và trigger làm UPDATE cuối thất bại đều không VERIFIED; CAS giữ bản mới chưa duyệt |
| R19-12 — phản hồi cũ trên giao diện | CLOSED_SOURCE | Phản hồi lớp/buổi cũ đến muộn không thay danh sách mới trong kiểm tra handler |
| R19-13 — lưu nháp/sequence/hoàn tác | CLOSED_SOURCE | Lỗi lưu không ghi một phần, sequence bền qua reload, phục hồi sau trigger đạt |
| R19-14 — lỗi tải và phạm vi AI | CLOSED_SOURCE | Tải lỗi dừng AI; lượt thành công chỉ chấm SUB1 mới tải, loại OLD_CACHED |

Rào cục bộ và luồng điều khiển vẫn được giữ trong phạm vi đã đọc: dev/start bind `127.0.0.1`; route tải/lưu đưa việc vào hàng đợi; BrowserManager giữ persistent context; đường dẫn bài nộp qua allowlist. Hai điểm vào Client được rà không import cấu hình máy chủ hoặc tham chiếu mật khẩu/khóa AI. Đây là đối chiếu mã nguồn, chưa phải kiểm tra một server hay trình duyệt thật. [Tham chiếu](evidence/static-review.json).

## 5. Phát hiện còn mở

### R19-09 — P1: Nhầm operation nằm trong chuỗi với thao tác thật

**Nguyên nhân:** Sau khi bỏ comment, `opRegex` tiếp tục dò toàn bộ query bằng biểu thức chuỗi, chưa coi nội dung trích dẫn là dữ liệu. Khi dấu ngoặc trong chuỗi làm mẫu không khớp operation ngoài, nó có thể khớp một operation giả nằm bên trong chuỗi. Biến `$input` cũng chỉ xuất hiện trong chuỗi nhưng được dùng làm bằng chứng.

**Vị trí:** [grade-worker.ts:434](../../../src/lib/playwright/grade-worker.ts#L434), phần chọn operation và root field trong `requestPredicate`; [dòng 632](../../../src/lib/playwright/grade-worker.ts#L632), phần lấy giá trị biến.

**Tái hiện:** Hai ca `R26-09-quoted-operation-decoy` và `R26-09-quoted-operation-preview-decoy` có operation ngoài thực sự gọi `deleteAttachment` hoặc `previewHomework`, dùng alias `saved`. Tham số `note` chứa văn bản:

```graphql
mutation SaveHomeworkGrade { saved:saveHomeworkGrade(input:$input) { id } }
```

Đoạn này nằm hoàn toàn trong chuỗi, không thực thi. Tuy nhiên, với response giả `{data:{saved:{id:"SUB1"}}}` và DOM giả khớp bản duyệt, worker trả **verifiedCount=1**, SQLite thành **VERIFIED**, mỗi ca có một lần bấm Save. Bộ từ vựng độc lập xác nhận root thật là thao tác khác và không có biến `$input` thực thi. Bộ native tái hiện cùng kết quả.

Đây là bằng chứng rào xác nhận có thể chấp nhận sai hợp đồng. Chưa xác nhận LMS thật có các trường giả này hoặc đã xảy ra lưu/xóa sai trên LMS thật; không dùng kết quả này để khẳng định một sự cố thực tế.

**Cách sửa:** Phân tích operation theo cấu trúc GraphQL, giữ ranh giới chuỗi/comment; chọn đúng operation đang thực thi, root field/alias và đối số của nó. Chỉ dùng biến được tham chiếu thực sự trong đối số đã chọn. Không để một đoạn văn bản tạo ra operation hoặc bằng chứng nghiệp vụ.

**Sau khi sửa:** Hai ca trên phải không VERIFIED; giữ các ca hợp lệ, kiểm tra từng trường response, HTTP 200/201, đọc lại DOM và hash cuối.

**Lỗi liên quan, mức P2:** `R26-09-literal-brace-open` và `R26-09-literal-close-brace` có nhận xét hợp lệ `APPROVED { FEEDBACK` hoặc `APPROVED } FEEDBACK`. Dấu ngoặc nằm trong chuỗi nhưng bộ dò operation coi chúng là cấu trúc; worker từ chối request và ghi FAILED. Hai ca dùng cùng nội dung qua biến đều đạt. Bộ native và kiểm tra từ vựng xác nhận. Sửa cùng nguyên nhân phân tích chuỗi, không cấm giáo viên nhập dấu ngoặc.

**Phần đã sửa đạt:** Tất cả 135 ca nhóm này trong R25 đạt; # trong chuỗi, dấu nháy thoát, các trường scalar bị bọc object, response null/mâu thuẫn và sai tên trường kết quả đều vượt kiểm tra cũ và các đối chứng mới tương ứng.

### R19-01 — P2: WebP cắt đuôi và PDF đánh lạc hướng vẫn PARSED

**WebP — nguyên nhân và vị trí:** [media-reader.ts:386](../../../src/lib/file-parsers/media-reader.ts#L386) đến [dòng 700](../../../src/lib/file-parsers/media-reader.ts#L700) duyệt header, mode và token rồi trả true. Các ca dưới chứng minh việc duyệt hiện tại chưa đủ để xác nhận ảnh giải mã được. Chưa kết luận rằng chỉ thêm kiểm tra EOF sẽ sửa hết nguyên nhân.

Ba ca `differential-gradient-false-truncate2`, `differential-gradient-false-truncate7`, `differential-noise-false-truncate7` lấy VP8 hợp lệ 17×31 rồi bỏ 2 hoặc 7 byte cuối payload. Bộ tạo đã tính lại kích thước RIFF/chunk và byte đệm đúng, nên không chỉ kiểm một kích thước bao ngoài sai. `sharp.raw().toBuffer()` từ chối cả ba với lỗi không đọc được pixel; sản phẩm trả **PARSED và một inlineData**. Bytes chính xác có trong kết quả chính/native.

**PDF — nguyên nhân và vị trí:** [media-reader.ts:1232](../../../src/lib/file-parsers/media-reader.ts#L1232) dò object bằng regex trước khi xác định chúng có nằm trong chuỗi hay không; [dòng 1244](../../../src/lib/file-parsers/media-reader.ts#L1244) dò `trailer` trong toàn tài liệu; [dòng 1253](../../../src/lib/file-parsers/media-reader.ts#L1253) chọn Root đầu tiên; [dòng 1283](../../../src/lib/file-parsers/media-reader.ts#L1283) chỉ đối chiếu Parent nếu có.

| Ca | Kết quả và đối chứng |
|---|---|
| `pdf-root-trailer-token-in-string` | Root thật là `9 0 R`, không tồn tại. Chuỗi Hint chứa xuống dòng rồi `trailer << /Root 1 0 R >>`; sản phẩm dùng trailer giả và PARSED. pypdf strict lấy Root 9 thật và báo không tìm được object. |
| `pdf-root-duplicate-conflict` | Trailer chứa cả Root 1 và Root 9; sản phẩm nhận Root đầu. pypdf strict từ chối khóa Root được định nghĩa nhiều lần. |
| `pdf-root-object-in-string` | Root 9 không có trong xref. Chuỗi của object 4 chứa `endobj` và văn bản khai báo object 9; sản phẩm biến văn bản này thành catalog rồi PARSED. pypdf cũng tìm lại object bằng cơ chế phục hồi; không dùng nó làm đối chứng từ chối mẫu này. |
| `pdf-parent-missing` | Page trong Kids không có Parent; điều kiện hiện tại bỏ qua kiểm tra. pypdf mở được và xác nhận `pageParentsPresent=[false]`. Đây là thiếu kiểm tra liên kết cây trang; không khẳng định file này không thể hiển thị. |

**Cách sửa:** Dùng giải mã WebP đáng tin cậy với giới hạn tài nguyên trước inlineData, hoặc hoàn thiện và đối chiếu bộ giải mã hiện tại đủ để loại các payload bị cắt. Không thay bằng ngưỡng chiều dài/độ đa dạng byte. Với PDF, xác định token/object/trailer bên ngoài chuỗi, comment và stream ngay từ đầu; xử lý ranh giới stream theo cấu trúc, không tìm các marker nằm trong nội dung. Từ chối khóa điều hướng trùng/xung đột; yêu cầu Parent đúng cho node con; giữ đối chiếu object:generation.

**Sau khi sửa:** Bảy ca phải PARSE_ERROR và không có inlineData. Giữ 48/48 ảnh mới hợp lệ, toàn bộ media R25, PNG/JPEG, WebP alpha/VP8X/VP8L và PDF generation hợp lệ đã đạt. Không tự gán điểm 0 hoặc REDO cho file lỗi.

## 6. Chênh lệch của bộ lịch sử bổ sung

R20/R21 được chạy nguyên bản để mở rộng hồi quy, không thuộc tám cổng bắt buộc. Kết quả thô là **140/145** và **45/49**, không được ghi thành PASS.

- Bốn ca duyệt R20 (`API-approval-control`, `R20-03-legacy-reapproval`, `R20-05-override-control`, `R20-06-latest-control`) vẫn dùng hợp đồng cũ thiếu snapshot giáo viên đã xem, nên nhận 409. Bốn đối chứng `R24-COMPAT-R20-*` trong lượt R26 mới đều đạt.
- Năm ca còn lại (`R20-10-complete-control`, `R21-08-mapping-valid`, `R21-10-readback-complete`, `R21-10-readback-redo-complete`, `R21-11-final-cas`) giả lập response `saveGrade` trong khi query chọn `saveHomeworkGrade`. Bản sửa R26 bỏ ngoại lệ sai tên này nên dừng trước bước cần kiểm. Năm đối chứng `R26-COMPAT-*` giữ hành vi gốc, trả đúng trường đã chọn và đều đạt; ca CAS vẫn giữ WAITING_APPROVAL khi nội dung đổi.

Không sửa file lịch sử hoặc chuyển chín FAIL này thành PASS. Các đối chứng là bằng chứng riêng để phân biệt thay đổi hợp đồng với lỗi của hành vi đang kiểm. [Chi tiết](evidence/historical-contract-differences.json).

## 7. Bảo toàn và khả năng tái kiểm

- **633/633 file** trong danh mục đầu giữ nguyên kích thước và SHA-256; không thêm/xóa/sửa ngoài R26 trong phạm vi danh mục này. Danh mục gồm src/scripts, cấu hình, file cấp gốc không chứa `.env*`, và docs ngoài R26; không bao gồm nội dung `.git`, `.next`, `node_modules` hoặc dữ liệu thật.
- **556/556 file bảo vệ** giữ nguyên: **555 file R12–R25** và `next-env.d.ts`. [Mã băm đầu](evidence/before-hashes.json), [đối chiếu cuối](evidence/preservation-check.json).
- SHA-256 `next-env.d.ts` gốc: **`B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000`**. Không ghi rồi khôi phục file này. Build chỉ đổi bản trong TEMP.
- **57/57 file src/scripts** gốc giữ nguyên. Trong snapshot, toàn bộ 74 file nguồn/cấu hình khớp đầu vào sau chạy, ngoại trừ `next-env.d.ts` do build tạo lại. Mười hash mô-đun ghi trong kết quả chính khớp cả dự án gốc lẫn snapshot. Mã bộ kiểm chứng và các mô-đun ca thử đã chạy khớp bản giao. [Kiểm tra artifact](evidence/artifact-check.json).
- Chỉ tạo hồ sơ mới trong `docs/audits/round-26/`. Theo giới hạn riêng của yêu cầu này, không đánh dấu kế hoạch, không sửa AGENTS/GEMINI, INDEX/LATEST hay hồ sơ cũ. Dấu hoàn tất kiểm toán được ghi ở báo cáo này.
- Các lượt thử trong lúc xây bộ R26 được giữ nguyên log và kết quả. Đã sửa giả định sai của chính bộ thử: tham số fileHash ngoài hợp đồng, DB giả dùng chung và chỉ số cột giả; không sửa sản phẩm hoặc hạ điều kiện an toàn để lấy PASS. [Ghi chú các lượt thử](evidence/harness-development-notes.md).
- [evidence-manifest.json](evidence/evidence-manifest.json) ghi hash tài liệu, script, log và JSON. [audit-runner.py](audit-runner.py) ghi cách tạo bản sao và chạy lệnh. Bản sao TEMP được giữ để tái kiểm; không chạy các verifier tại dự án gốc.

## 8. Hoàn tất và việc tiếp theo

- [x] **AUDIT-R26:** Chạy đủ tám cổng bắt buộc và TypeScript sau build; xây bộ R26 510 ca; đối chiếu 14/14 nhóm; xác nhận chéo bằng import trực tiếp và kiểm tra bảo toàn.

**Đã làm:** Hoàn tất bộ kiểm chứng, bằng chứng, đối chiếu trạng thái và báo cáo độc lập, không sửa mã sản phẩm.

**Kết quả:** **NO-GO — 12/14 CLOSED_SOURCE**. R19-09 còn bằng chứng VERIFIED sai; R19-01 còn nhận file hỏng/sai cấu trúc. Kết quả xanh của các vòng cũ và build chưa đủ để ký GO.

**Chưa kiểm tra:** Chromium/React thực tế, tài khoản/schema/LMS thật, Gemini thật, DB và bài nộp thật; chưa chứng minh chất lượng mọi ảnh/PDF hoặc an toàn tài nguyên ở mọi kích thước. DOM/API giả cố ý khớp để kiểm rào xác nhận, không chứng minh một thao tác thật đã được lưu nhầm.

**Việc tiếp theo:** Bên triển khai sửa đúng hai nhóm theo [FIX_PROMPT.vi.md](FIX_PROMPT.vi.md), sau đó kiểm toán độc lập mới trên đúng bản nguồn đã sửa. Owner chưa cần thao tác kỹ thuật hoặc cung cấp tài khoản.
