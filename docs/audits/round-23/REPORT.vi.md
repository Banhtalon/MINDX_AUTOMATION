# AUDIT-R23 — Kiểm toán độc lập Giai đoạn 5

**Phán quyết chính thức: NO-GO cấp mã nguồn. Chưa nghiệm thu Giai đoạn 5.**

Hiện có **10/14 nhóm CLOSED_SOURCE**, còn **R19-01, R19-06, R19-09, R19-13 PARTIALLY_FIXED**. R22 nguyên bản đạt **53/53**, nhưng R23 đạt **92/116**, còn **24 ca trượt**: 8 kiểm tra file, 6 duyệt phiên bản, 9 xác nhận API và 1 khôi phục sau lỗi lưu SQLite. Vì vậy vượt qua các mẫu cũ chưa đủ để đóng bốn nhóm này.

Đã chạy đủ **12 lệnh bắt buộc**, trong snapshot TEMP: **10 PASS, 2 FAIL**. Ngoài R23, R16 nguyên bản trượt một ca đếm đúng 7 bảng, vì bản sửa đã thêm bảng thứ 8. Không sửa lịch sử để đổi kết quả thành PASS. Không sửa bất kỳ file nào trong `src/`, `scripts/` hoặc `round-12`…`round-22` của repo gốc.

## 1. Phạm vi, nguồn và cách kiểm tra

- Đối tượng: TASK-5.1–TASK-5.5, luồng tải bài → phân tích file → AI đề xuất → lưu nháp → giáo viên duyệt → lưu LMS → đọc lại → VERIFIED, cùng các cổng hồi quy được yêu cầu.
- Đối chiếu `AGENTS.md`, `MINDX_AUTOMATION_PLAN.md`, báo cáo R19–R22, mã liên quan và các bộ kiểm chứng lịch sử. Giả định tải sử dụng: ứng dụng cục bộ của một giáo viên, có thể mở nhiều tab; không đánh giá triển khai nhiều máy chủ.
- Ngày kiểm toán: **20/10/2026**. Snapshot lúc **19:14:37 giờ Việt Nam**, tức `2026-10-20T12:14:37.010619+00:00`.
- HEAD: `2570d96b6770957e218031c91f14ce98e766dfa7`. Đây là **cây làm việc có thay đổi chưa commit và file mới chưa được theo dõi**; HEAD không đại diện đầy đủ cho nguồn đã kiểm.
- [source-state.json](source-state.json): danh mục **75 file** nguồn/script/cấu hình và file cấp gốc; mã băm tổng hợp `07d9a21b600e9700bee1a56cc145f137e0d845dd10b42bd43d2652300e91acdf`.
- So với dấu vết R22, có đúng **6 file sản phẩm thay đổi**: `approve/route.ts`, `submissions/route.ts`, `homework-auto-grader-tab.tsx`, `sqlite.ts`, `media-reader.ts`, `grade-worker.ts`. Không lấy kết quả cũ làm bằng chứng cho bản mới.

[verify-independent.mjs](verify-independent.mjs) kế thừa minh bạch các hàm hỗ trợ và **53 ca R22 giữ nguyên ID/điều kiện**, đồng thời thêm **63 ca R23**: **39 PASS, 24 FAIL**. Mã sản phẩm được đọc từ snapshot, bỏ import/type để thực thi nguyên thân hàm với các phụ thuộc giả được chỉ rõ. Không thay điều kiện hoặc thân hàm sản phẩm để tạo kết quả mong muốn.

SQLite chạy thật trong bộ nhớ; một ca dùng file SQLite giả trong TEMP, đóng kết nối rồi mở lại cùng file. `sharp` giải mã thật các ảnh đối chứng. API/DOM/Gemini và các hook giao diện dùng bộ mô phỏng xác định; đây không phải chạy Chromium/React hoặc dịch vụ thật. Không cộng các bộ thành số tình huống nghiệp vụ duy nhất vì có ca trùng phạm vi.

## 2. Snapshot và bảo toàn

Tất cả lệnh kiểm thử, TypeScript và build chạy tại:

```text
C:\Users\QQ\AppData\Local\Temp\mindx-round23-20261020T121436965204Z-mindx-round22-compat-mindx-round21-mindx-round20-compat\snapshot
```

Hậu tố đường dẫn đáp ứng chốt TEMP của các bộ cũ. Thư viện được **sao chép thành file riêng**, không nối về `node_modules` gốc, không cài/cập nhật thư viện. Không sao `.env*`, DB thật, hồ sơ đăng nhập, bài nộp thật, `.git` hay `.next`; dữ liệu chỉ lấy `data/config`.

Tiến trình chỉ nhận danh sách biến Windows tối thiểu; npm chạy offline, telemetry tắt và nạp rào socket Node từ bản sao `round-19/network-guard.cjs`. Rào này chặn kết nối ngoài loopback trong Node, không phải tường lửa hệ điều hành. Không dùng tài khoản, mở trình duyệt hoặc gọi LMS/Gemini thật. Xem [snapshot-check.json](snapshot-check.json), [isolation.json](isolation.json).

**Kết quả bảo toàn:**

- [protected-hashes.json](protected-hashes.json): **364/364 tệp giữ nguyên danh mục, kích thước và SHA-256**. Thực tế có **363 file lịch sử R12–R22**, cộng `next-env.d.ts`; số “319” trong yêu cầu không khớp danh mục hiện có. Đã bảo vệ toàn bộ danh mục thực tế, không giới hạn ở 319 file.
- `next-env.d.ts` gốc vẫn là **`B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000`**.
- [preservation-check.json](preservation-check.json): mọi file sản phẩm, script và cấu hình giữ nguyên. Trong snapshot, build chỉ đổi `next-env.d.ts` trong danh mục 75 file; không cần khôi phục tệp gốc.
- Các bộ cũ ghi kết quả mới vào thư mục lịch sử **trong snapshot**. Bằng chứng được sao về tên mới dưới R23, không ghi đè lịch sử gốc.
- Chỉ thêm hồ sơ R23, tạo `LATEST.md`/`INDEX.md` vốn chưa tồn tại, và thêm mục hoàn tất **kiểm toán** AUDIT-R23 vào kế hoạch theo AGENTS.md. [plan.before.md](plan.before.md) giữ bản kế hoạch trước thay đổi; dấu `[x]` không phải nghiệm thu Phase 5.

## 3. Kết quả đủ 12 lệnh

| Lệnh trong snapshot | Mã thoát | Kết quả | Bằng chứng mới |
|---|---:|---|---|
| `node docs/audits/round-23/verify-independent.mjs` | **1** | **92/116; 24 FAIL** | [log cuối](round23.attempt-4.log), [JSON](independent-results.json) |
| `node docs/audits/round-22/verify-independent.mjs` | 0 | **53/53 PASS** | [log](round22.attempt-1.log), [JSON](round22-results.json) |
| `node docs/audits/round-21/verify-independent.mjs` | 0 | **49/49 PASS** | [log](round21.attempt-1.log), [JSON](round21-results.json) |
| `node docs/audits/round-20/verify-independent.mjs` | 0 | **145/145 PASS** | [log](round20.attempt-1.log), [JSON](round20-results.json) |
| `node docs/audits/round-12/verify-independent.mjs` | 0 | **43/43 PASS** | [log](round12.attempt-1.log), [JSON](round12-results.json) |
| `node docs/audits/round-13/verify-independent.mjs` | 0 | **89/89 PASS** | [log](round13.attempt-1.log), [JSON](round13-results.json) |
| `node docs/audits/round-16/verify-independent.mjs` | **1** | **15/16; PHASE1-SCHEMA FAIL** | [log](round16.attempt-1.log), [JSON](round16-results.json) |
| `node docs/audits/round-17/verify-independent.mjs` | 0 | **38/38 PASS** | [log](round17.attempt-1.log), [JSON](round17-results.json) |
| `npx tsx scripts/test-phase4-codex-repros.ts` | 0 | Các mục của script PASS | [log](phase4.attempt-1.log) |
| `npx tsx scripts/test-phase5.ts` | 0 | **7/7 mục PASS** | [log](phase5.attempt-1.log) |
| `npx tsc --noEmit --incremental false` | 0 | Không có lỗi kiểu dữ liệu | [log](typecheck.attempt-1.log) |
| `npm run build` | 0 | Dựng thành công **22/22 trang** | [log](build.attempt-1.log) |

Hồi quy R12/13/16/17 thực tế là **185/186**, không phải 186/186. Các lỗi mạng trong log Phase 4 là lỗi cố ý tạo bằng dữ liệu giả; script kết thúc 0.

[commands.json](commands.json) giữ thư mục làm việc, thời gian, mã thoát trực tiếp và hash log. Xóa JSON cũ chỉ trong snapshot trước từng lệnh, tránh lấy bằng chứng lịch sử làm kết quả mới. Không dùng đường ống làm mất mã thoát.

R23 có bốn lần chạy, giữ đủ log: lần 1 lỗi cú pháp của bộ kiểm toán, chưa có kết quả và **không tính thành lỗi sản phẩm**; lần 2 có 115 ca; lần 3 thêm ca lỗi dung lượng SQLite; lần 4 tăng độ chặt của đối chứng thiếu trường bulk và dùng file SQLite thật để đóng/mở lại. Bản cuối có **116 ca**, giữ nguyên toàn bộ 53 ca kế thừa. Không sửa mã sản phẩm hoặc bộ lịch sử giữa các lần. Chỉ dùng lần 4 làm kết quả chính thức. Các bộ cũ không cần chạy lại vì nguồn và bộ cũ không đổi.

SHA-256 bộ R23 cuối, trùng đúng bytes đã chạy: **`af410d446dea5b9a95fe92bfcafaa979fc02b325de3578ec2cbd92551f225a83`**. [artifact-check.json](artifact-check.json) và [evidence-manifest.json](evidence-manifest.json) đối chiếu log, kết quả, nguồn và tính toàn vẹn bằng chứng.

## 4. Đối chiếu đủ 14 nhóm

`CLOSED_SOURCE` nghĩa là đóng trong phạm vi mã nguồn và dữ liệu giả đã kiểm, không thay nghiệm thu LMS thật. [issue-status.json](issue-status.json) liệt kê mã ca cụ thể của từng nhóm trong R20/R21/R22/R23.

| Nhóm | Trạng thái R23 | Căn cứ chính |
|---|---|---|
| R19-01 | **PARTIALLY_FIXED — P2** | IHDR, zlib/filter thường, JPEG SOF/SOS và WebP alpha đã sửa; 8 mẫu mới vẫn lọt. |
| R19-02 | **CLOSED_SOURCE** | Giữ chặn mã tiêu chí trùng/thiếu, giới hạn barem, bằng chứng và tổng tính bằng code. |
| R19-03 | **CLOSED_SOURCE** | Hash tổng hợp tiếp tục khóa file, tiêu chí, điểm, quyết định và nhận xét. |
| R19-04 | **CLOSED_SOURCE** | Ca file đổi/xóa trước hoặc trong AI đều chặn kết quả cũ, cả khi có parsedContent sẵn. |
| R19-05 | **CLOSED_SOURCE** | Ba handler UI gửi barem đang chọn; server chặn tiêu chí lạ và bài chưa phân tích. |
| R19-06 | **PARTIALLY_FIXED — P1** | Hash đã chấm lưu bền thành công; thiếu đồng thời rubric/decision vẫn bỏ qua hash; bulk chưa bắt buộc mọi trường. |
| R19-07 | **CLOSED_SOURCE** | Giữ khóa đúng bài/học viên, chặn tên trùng, ID một phần hoặc modal thiếu ID. |
| R19-08 | **CLOSED_SOURCE** | Giữ đối chiếu lesson/session, không đoán cột khi thiếu ánh xạ. |
| R19-09 | **PARTIALLY_FIXED — P1** | Chặn mẫu R22, alias introspection và directive; còn nhận data sai/thiếu và đối số không khớp. |
| R19-10 | **CLOSED_SOURCE** | Giữ đọc lại nhận xét/quyết định/điểm, đối chứng GRADE và REDO đạt. |
| R19-11 | **CLOSED_SOURCE** | Giữ kiểm tra hash có điều kiện ngay trước nâng VERIFIED. |
| R19-12 | **CLOSED_SOURCE** | Phản hồi lớp/buổi cũ không ghi đè phạm vi mới. |
| R19-13 | **PARTIALLY_FIXED — P2** | Đã lưu bền sequence từng trường và đồng bộ UI; lỗi ghi DB vẫn để sequence tăng dù nội dung không lưu. |
| R19-14 | **CLOSED_SOURCE** | Tải lỗi/toàn phần/một phần đều dừng AI, cả khi skipAi; lượt thành công chỉ chấm đúng tập bài đã tải. |

Tổng: **10 CLOSED_SOURCE, 4 PARTIALLY_FIXED**, gồm **2 nhóm P1, 2 nhóm P2** còn lại. Lệch kỳ vọng schema R16 được báo riêng, không tạo nhóm R19 thứ 15.

## 5. R19-06 — P1: Vẫn duyệt khi thiếu bằng chứng phiên bản đã xem

**Nguyên nhân:** [`approve/route.ts:336`](../../../src/app/api/homework-grader/approve/route.ts#L336) chỉ bắt buộc `fileHash` khi có `decision` **hoặc** `rubric`. Bỏ cả hai trường vẫn đi qua. Nhánh bulk yêu cầu danh sách, hash và nhận xét, nhưng chỉ đối chiếu quyết định khi là chuỗi, điểm ghi đè khi có trường, tiêu chí khi là mảng. Các điều kiện tùy chọn tại [dòng 147](../../../src/app/api/homework-grader/approve/route.ts#L147), 157 và 171 cho phép bỏ qua thông tin còn thiếu.

**Bằng chứng:**

- `R23-06-single-omits-hash-decision-rubric`: yêu cầu chỉ có bộ định danh, không hash/rubric/decision → **HTTP 200, APPROVED**.
- `R23-06-bulk-missing-decision` và `...malformed-decision`: sau khi API nháp thật đổi GRADE thành REDO, snapshot thiếu decision hoặc decision=null vẫn → **APPROVED REDO**.
- `...missing-teacherOverrideScore`: sau khi API nháp thật đặt điểm ghi đè 25, snapshot thiếu trường này vẫn → **APPROVED 25**.
- `...missing-criteriaGrades` và `...malformed-criteriaGrades`: bản xem ban đầu 80; API nháp thật lưu 90; snapshot thiếu/null tiêu chí vẫn → **APPROVED 90**.

Đây là **6 ca FAIL**. Không cần sửa trực tiếp DB để tạo các thay đổi điểm/quyết định. UI hiện gửi đủ trường trong đường bình thường; các ca thiếu trường kiểm tra hợp đồng API, không khẳng định UI bình thường đang tự bỏ trường.

**Phần đã sửa đúng:** `gradedFileHash` có trong `homework_submission_meta`, giữ `graded-v1` sau reload module và sau đóng/mở file SQLite, dù file hiện tại là `ungraded-v2`; duyệt v2 bị **409**. Tất cả đối chứng drift có đủ trường của R22 đạt. Thiếu/sai hash hoặc nhận xét bulk đều bị chặn.

**Cách sửa tối thiểu:** Bắt buộc `fileHash` cho mọi duyệt đơn; kiểm tra sự hiện diện và kiểu dữ liệu của đủ `fileHash`, `feedbackHtml`, `decision`, `teacherOverrideScore` và `criteriaGrades` trước khi đối chiếu bulk. Giá trị null hợp lệ cho điểm ghi đè cần được phân biệt với thiếu trường. Có thể dùng mã phiên bản tổng hợp đáng tin cậy thay đủ trường nếu hợp đồng được cập nhật nhất quán.

**Sau khi sửa:** Sáu ca trên không được APPROVED; các bản đầy đủ và khớp phải vẫn duyệt được. Không nới điều kiện để giữ ca cũ thiếu hash đạt.

## 6. R19-09 — P1: Phản hồi và đối số chưa chứng minh thao tác lưu đúng

**Nguyên nhân:** [`grade-worker.ts:627`](../../../src/lib/playwright/grade-worker.ts#L627) chỉ kiểm `data` **nếu** nó là object khác null. Thiếu data, null hoặc chuỗi bỏ qua toàn bộ nhánh. Dữ liệu có object nhưng trường không liên quan vẫn được nhận. Nhánh [dòng 469](../../../src/lib/playwright/grade-worker.ts#L469) tách đối số bằng dấu phẩy/hai chấm, chỉ xét một số literal; bỏ qua class/session/decision, đối tượng lồng và các giá trị bắt đầu bằng `$`. Biến được kiểm riêng, chưa gắn với đối số thực sự dùng.

**Bằng chứng:** **9 ca FAIL**, đều `verified=1, status=VERIFIED` khi DOM giả đã khớp nội dung đối chứng:

- `R23-09-response-missing-data`, `...null-data`, `...string-data`, `...unrelated-root`: lần lượt `{}`, `{data:null}`, `{data:"not a result"}`, `{data:{health:true}}` vẫn xác minh thành công.
- `R23-09-request-literal-wrong-class`, `...wrong-session`, `...wrong-decision`: đối số literal sai lớp, sai buổi hoặc REDO trong khi bản duyệt là GRADE vẫn được nhận vì variables riêng mang giá trị đúng.
- `...nested-wrong-submission`: `input: {submissionId:"SUB_OTHER"}` lọt kiểm tra.
- `...bound-wrong-variable`: trường dùng `submissionId:$otherId`, `$otherId=SUB_OTHER`, nhưng một thuộc tính variables riêng `submissionId=SUB1` khiến bộ lọc vẫn nhận.

**Phần đã sửa đúng:** Bắt buộc operationName/query; loại alias trước kiểm tra trường gốc, chặn `score: __typename`; chặn cả `@skip` và `@include`; chặn các literal sai đã có trong R22. Data rỗng, result null/false, ID trả về sai bị chặn. Alias hợp lệ của trường lưu vẫn đạt đối chứng.

**Cách sửa tối thiểu:** Thiếu hoặc sai hình dạng `data` phải thất bại. Gắn response với đúng trường/alias được chọn; đối chiếu operation, trường nghiệp vụ, toàn bộ đối số literal và giá trị biến thực sự được tham chiếu. Dùng bộ phân tích GraphQL hoặc hợp đồng nghiệp vụ đã được xác minh, tránh tìm từ khóa rồi kiểm một túi variables độc lập.

**Sau khi sửa:** Chín ca sai phải `verified=0`; mutation GRADE/REDO hợp lệ và alias hợp lệ vẫn đạt. HTTP 200/201 và DOM khớp cần đi cùng bằng chứng API đúng thao tác.

**Giới hạn:** Request/response trên là hợp đồng minh họa bằng dữ liệu giả, chưa xác nhận tên trường/kiểu tham số của LMS thật. Một lần bấm nút Lưu giả không chứng minh có ghi dữ liệu thật. Kết quả chứng minh bộ lọc chấp nhận bằng chứng sai, không chứng minh sự cố đã xảy ra trên LMS.

## 7. R19-01 — P2: Kiểm tra file vẫn bỏ sót dữ liệu ảnh và quan hệ trang

**Nguyên nhân và vị trí:**

- PNG tại [`media-reader.ts:155`](../../../src/lib/file-parsers/media-reader.ts#L155): giải nén thật và kiểm độ dài/filter khi interlace=0; interlace=1 chỉ yêu cầu có dữ liệu, không kiểm các lượt quét Adam7.
- WebP tại [dòng 294](../../../src/lib/file-parsers/media-reader.ts#L294) và 305: VP8 chỉ kiểm header/độ dài một phân đoạn; VP8L chấp nhận nếu có một byte khác 0 sau header. Dữ liệu không rỗng chưa chứng minh giải mã được.
- PDF tại [dòng 397](../../../src/lib/file-parsers/media-reader.ts#L397): tìm Catalog trỏ Pages, rồi độc lập tìm bất kỳ Page nào. Không lần theo Kids để chứng minh Catalog thực sự đi tới Page.

**Bằng chứng: 8 ca FAIL**, parser đều trả `PARSED` và một phần inlineData:

| Ca mới | Dữ liệu bị nhận sai |
|---|---|
| `R23-01-png-interlace1-filter5` | PNG Adam7 1×1, zlib/CRC đúng nhưng filter byte=5. |
| `R23-01-png-interlace1-short-row` | PNG Adam7 giải nén được nhưng thiếu dữ liệu một dòng. |
| `R23-01-webp-vp8-nonempty-garbage` | Header VP8 có kích thước và first-part-size hợp lệ, phần ảnh chỉ là byte rác. |
| `R23-01-webp-vp8l-nonempty-garbage` | Header VP8L hợp lệ và phần sau khác 0 nhưng không giải mã được. |
| `R23-01-webp-vp8x-alpha-garbage` | VP8X → ALPH → VP8, phần VP8 vẫn hỏng. |
| `R23-01-pdf-missing-kid` | Pages trỏ Kids 999 không tồn tại; Page riêng trỏ Parent 777. |
| `R23-01-pdf-empty-pages-orphan-leaf` | Pages rỗng; chỉ có Page không thuộc cây đó. |
| `R23-01-pdf-cycle-with-orphan-leaf` | Pages trỏ chính nó; Page còn lại không thuộc cây. |

Năm ảnh đầu đều bị `sharp` giải mã thật từ chối; lỗi giải mã/bytes được lưu trong JSON. Ba PDF có toàn bộ mẫu trong JSON, chứng minh trực tiếp quan hệ đối tượng sai; không dùng bộ giải mã PDF độc lập.

**Phần đã sửa đúng:** Ma trận bitDepth/colorType và zlib/filter PNG thường đạt, cả filter 0–4 hợp lệ. SOF/SOS của JPEG chặn ID không tồn tại. WebP trong suốt dạng lossless/lossy hợp lệ giữ nguyên bytes. Dòng comment PDF và Catalog trỏ Pages không tồn tại của R22 đã bị chặn. Toàn bộ đối chứng media R20/R21/R22 vẫn đạt.

**Cách sửa tối thiểu:** Kiểm tra các lượt quét Adam7 có giới hạn tài nguyên; xác thực dữ liệu VP8/VP8L bằng bộ giải mã đáng tin cậy; duyệt cây trang PDF từ Catalog, phát hiện tham chiếu thiếu/vòng lặp và chỉ nhận Page thực sự thuộc cây. Lỗi phải PARSE_ERROR, không tạo inlineData.

**Sau khi sửa:** Tám ca trên bị từ chối; ảnh thường, ảnh trong suốt và PDF hợp lệ vẫn được hỗ trợ. Chưa kiểm mọi biến thể định dạng, PDF mã hóa hay giới hạn bộ nhớ khi giải nén rất lớn.

## 8. R19-13 — P2: Lưu nội dung thất bại nhưng phiên bản đã tăng

**Phần đã sửa đúng:** `draftSeq` và `fieldSeqJson` lưu bền theo từng bài; cùng trường có số nhỏ hơn hoặc bằng bị 409, kể cả hai tab gửi số 1. Các trường khác nhau lưu đến ngược thứ tự vẫn giữ đủ nội dung. Yêu cầu sai chủ sở hữu, điểm ghi đè >100 hoặc tiêu chí âm không thay metadata. Reload route/repository giữ sequence. GET thật trả sequence=7, UI mới tải lại gửi 8 và lưu thành công. Các ca nháp của R22 đều đạt.

**Nguyên nhân còn lại:** [`sqlite.ts:861`](../../../src/lib/db/sqlite.ts#L861) ghi metadata trước, rồi [dòng 872](../../../src/lib/db/sqlite.ts#L872) mới ghi bài nộp. Hai câu lệnh không nằm trong một giao dịch SQLite chung — tức không cùng thành công hoặc cùng hoàn tác.

**Bằng chứng `R23-13-failed-write-metadata`:** Trong DB giả, giới hạn số trang SQLite ở mức đang có, rồi gửi nhận xét 1 MiB với draftSeq=100. Đây là cách tạo lỗi dung lượng có kiểm soát, không làm đầy ổ đĩa của Owner.

1. Trước: draftSeq=0, fieldSeqJson=`{}`, nhận xét cũ.
2. API trả **500**, lỗi thật `database or disk is full`; nội dung mới không được lưu.
3. Metadata lại đã thành draftSeq=100, fieldSeqJson=`{"feedbackHtml":100}`.
4. Bỏ giới hạn dung lượng, gửi lần lưu hợp lệ số 1 → **409**, nhận xét vẫn là bản cũ.

Đây là **1 ca FAIL mức P2**: mất khả năng lưu tiếp từ bộ đếm hiện tại sau lỗi lưu, không phải bằng chứng chấm nhầm người hoặc duyệt sai điểm. Chỉ chứng minh đường lỗi SQLite được tạo trong thử nghiệm; chưa quan sát máy Owner hết dung lượng thật.

**Cách sửa tối thiểu:** Gói ghi metadata và ghi bài nộp trong cùng giao dịch SQLite; chỉ coi phiên bản đã commit khi nội dung cũng lưu thành công. Giữ nguyên kiểm tra từng trường và đồng bộ UI hiện đã đạt.

**Sau khi sửa:** Ca dung lượng phải trả lỗi nhưng metadata giữ nguyên; sau khi phục hồi dung lượng, yêu cầu hợp lệ số 1 phải lưu được. Giữ toàn bộ đối chứng hai tab/reload/thứ tự khác trường.

## 9. R16 và những kỳ vọng lịch sử cần phân biệt

R16 `PHASE1-SCHEMA` tại [`round-16/verify-independent.mjs:212`](../round-16/verify-independent.mjs#L212) yêu cầu `tables.length === 7`; nguồn hiện có **8 bảng**, thêm `homework_submission_meta`. Do assertion đầu trượt, hai kiểm tra phía sau trong cùng ca không được thực thi. R23 thêm `R23-COMPAT-R16-schema`, xác nhận chính xác bảy bảng cũ còn đủ, bảng mới có đủ bốn cột, mã học viên vẫn tách theo lớp và chủ bài nộp không đổi được: **PASS**.

Đây là lệch kỳ vọng số lượng bảng, không phải bằng chứng mất bảng/dữ liệu. Tuy nhiên **không thay thế kết quả R16 nguyên bản**: vẫn ghi **15/16, exit 1**, hồi quy **185/186**. Không sửa file lịch sử hoặc giấu bảng khỏi harness để tạo PASS.

Ngoài ra, các ca đối chứng `R20-05-override-control` và `R20-06-latest-control` vẫn mong **200 cho duyệt đơn không có fileHash** ([dòng 243](../round-20/verify-independent.mjs#L243), 246), trong khi yêu cầu an toàn R23 bắt buộc hash với mọi duyệt. Vì vậy khi sửa đúng R19-06, kỳ vọng các ca cũ này cũng cần được đánh giá lại trong **bộ kiểm chứng phiên bản mới**. Không được nới an toàn để giữ bảng kết quả xanh, sửa lịch sử, hoặc tự coi bộ tương thích là PASS nguyên bản. Vòng này chỉ ghi nhận mâu thuẫn, chưa sửa mã hay thay hợp đồng nghiệm thu.

## 10. Việc tiếp theo và giới hạn phán quyết

Ưu tiên sửa **R19-06 và R19-09** trước; tiếp theo là kiểm tra file R19-01 và giao dịch lưu R19-13. Chỉ ký GO khi đủ **14/14 CLOSED_SOURCE** và toàn bộ cổng bắt buộc đạt theo hợp đồng kiểm chứng được thống nhất. Hiện tại cả hai điều kiện đều chưa đạt.

### Prompt giao vòng sửa riêng

> Sửa đúng bốn nhóm còn mở theo AUDIT-R23, không sửa các tệp lịch sử R12–R23. R19-06: mọi duyệt đơn bắt buộc fileHash kể cả không có decision/rubric; bulk bắt buộc đủ kiểu/trường và đối chiếu toàn bộ bản đã xem. R19-09: thiếu/sai data phải bị chặn; xác nhận đúng trường phản hồi và ràng buộc đối số literal/biến thực sự dùng với bài, học viên, lớp, buổi, quyết định, điểm, nhận xét đã duyệt. R19-01: kiểm tra Adam7, dữ liệu VP8/VP8L thật và cây Catalog→Pages→Page liên thông. R19-13: metadata và nội dung lưu trong cùng giao dịch để lỗi SQLite không tăng sequence. Giữ những đối chứng đã đạt. Không làm yếu an toàn để vượt các ca lịch sử có hợp đồng cũ; ghi riêng chênh lệch schema/hash và tạo bộ kiểm chứng phiên bản mới khi được thống nhất. Chạy kiểm tra/build trong snapshot TEMP và đối chiếu hash nguồn, không dùng dữ liệu thật trong vòng sửa này.

**Chưa kiểm tra:** LMS/Teaching/Gemini thật, tài khoản/bài nộp thật, hợp đồng GraphQL thực tế, Chromium/React thật, hai cửa sổ thật, đóng/mở toàn ứng dụng thật, disk-full trên máy thật, tải lớn hoặc nghiệm thu Owner. Kết quả TypeScript/build và dữ liệu giả không thay những bước đó.

**Đã làm:** Kiểm toán độc lập, bộ R23, đủ 12 lệnh, đối chiếu 14 nhóm và bảo toàn tệp; cập nhật chỉ mục/kế hoạch kiểm toán.

**Kết quả:** **NO-GO**; 10 nhóm đóng, 4 nhóm còn mở; R23 92/116, R16 15/16.

**Chưa kiểm tra:** Dịch vụ, trình duyệt và vận hành thật.

**Việc tiếp theo:** Giao vòng sửa riêng theo bằng chứng trên, rồi kiểm toán lại trên đúng bản nguồn đã sửa.
