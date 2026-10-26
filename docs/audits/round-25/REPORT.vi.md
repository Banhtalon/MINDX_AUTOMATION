# AUDIT-R25 — Kiểm toán độc lập Giai đoạn 5

**Phán quyết: NO-GO cấp mã nguồn. Chưa nghiệm thu Giai đoạn 5.**

Có **12/14 nhóm CLOSED_SOURCE**, còn **R19-01 (P2)** và **R19-09 (P1) PARTIALLY_FIXED**. `CLOSED_SOURCE` nghĩa là đạt trong phạm vi mã nguồn và các tình huống đã kiểm; không thay thế nghiệm thu bằng tài khoản, trình duyệt và LMS thật. P1 cần xử lý trước vì liên quan xác nhận lưu điểm; P2 liên quan nhận diện file và độ tin cậy của luồng chấm.

Toàn bộ ca từng biết ở Round 24 nay đạt: **230/230** trong bộ nguyên bản và **8/8** trong bộ nạp trực tiếp file. Tuy nhiên, bộ Round 25 đạt **312/344**, còn **32 ca trượt**, đều thuộc hai nhóm trên. Trong 114 ca mới, **82 đạt, 32 trượt**. Vì chưa đủ 14/14 CLOSED_SOURCE, chưa có cơ sở ký GO.

## 1. Phạm vi và bản nguồn được kiểm

- Luồng TASK-5.1–TASK-5.5: tải bài theo định danh → đọc file → AI đề xuất điểm → giáo viên xem/duyệt → lưu LMS → đọc lại → VERIFIED. Giả định ứng dụng cục bộ của một giáo viên, có thể mở nhiều tab.
- Đã đối chiếu `MINDX_AUTOMATION_PLAN.md`, quy tắc dự án, báo cáo/harness Round 24; đọc các phần trọng tâm trong parser, tải bài, chấm AI, kiểm toán điểm, SQLite, duyệt/lưu nháp, giao diện, worker và bộ lọc mạng. Kiểm tra hồi quy thêm các vòng 12/13/16/17/20/21/22/23 và script Phase 4/5.
- Ngày kiểm toán: **20/10/2026**; bản chụp được tạo lúc **20:08:41 giờ Việt Nam**, tương ứng `2026-10-20T13:08:41Z`.
- HEAD: `2570d96b6770957e218031c91f14ce98e766dfa7`. Có nhiều thay đổi chưa commit trước kiểm toán; không reset, commit hoặc ghi đè chúng. [Trạng thái đầu](source-state.json).
- [Danh mục nguồn](source-manifest.json): **74 tệp** nguồn, script, cấu hình và tệp công khai cấp gốc; mã băm tổng hợp `7cb675ae8fd8764f3e42201abd3528671819fc289d4a1760939b772324a2e5fa`. Danh mục loại `.env*` và bộ nhớ đệm `tsconfig.tsbuildinfo`.
- So với bản chụp trước kiểm toán R24, chỉ **hai tệp sản phẩm** đã thay đổi: `media-reader.ts` và `grade-worker.ts`; kế hoạch cũng khác vì có mục kết quả R24. Đây đều là thay đổi có sẵn trước R25. [Đối chiếu](changes-since-r24.json).

Snapshot dùng để chạy tất cả kiểm tra:

```text
C:\Users\QQ\AppData\Local\Temp\mindx-round25-20261020T130841Z-mindx-round24-compat-mindx-round23-compat-mindx-round22-compat-mindx-round21-compat-mindx-round20-compat\snapshot
```

Thư viện được sao chép thành tệp riêng, không dùng junction trỏ về dự án gốc và không cài/cập nhật thư viện. Không sao `.env*`, `.git`, `.next`, DB thật, hồ sơ đăng nhập, bài nộp hoặc tệp debug thật; chỉ lấy `data/config`. Bộ nạp worker trực tiếp tạo **SQLite giả trong snapshot**.

## 2. Cách kiểm chứng và giới hạn

[verify-independent.mjs](verify-independent.mjs) giữ nguyên **230 ID và điều kiện kiểm tra R24**, chỉ đổi phần bao ngoài dành cho vòng kiểm toán và thêm **114 ca R25**:

| Phần mới | Đạt / Tổng | Trượt |
|---|---:|---:|
| R19-01: media | 11/25 | 14 |
| R19-09: yêu cầu/phản hồi lưu điểm | 59/77 | 18 |
| Đối chứng mới cho 12 nhóm còn lại | 12/12 | 0 |
| Tổng ca mới | **82/114** | **32** |

[assemble-verifier.py](assemble-verifier.py), [r25-cases.inc.txt](r25-cases.inc.txt), [harness-provenance.json](harness-provenance.json) ghi cách kế thừa. [artifact-check.json](artifact-check.json) xác nhận 230 ID/điều kiện/kết quả đầu trùng với lượt R24 nguyên bản vừa chạy, hash của nguồn và tệp kiểm chứng khớp bản thực thi.

Bộ chính dùng nguyên thân hàm sản phẩm sau khi bỏ import/export và khai báo kiểu như harness R24. SQLite, tệp giả và bộ giải mã ảnh `sharp` chạy thật; API, DOM, Gemini và hook giao diện dùng mô phỏng. Không sửa thân hàm sản phẩm để tạo PASS.

Hai bộ bổ sung **nạp trực tiếp mô-đun sản phẩm qua `tsx`, không tách/sửa mã nguồn**:

- [native-media-repro.mjs](native-media-repro.mjs): **11/25 đạt**, xác nhận lại đủ **14 ca media trượt**, đồng nhất với bộ chính. `sharp` giải mã thật mọi mẫu WebP. PDF có bảng xref và cây đối tượng được ghi rõ trong mẫu; chưa dùng bộ giải mã PDF độc lập. [Kết quả](native25-results.json).
- [native-worker-repro.mjs](native-worker-repro.mjs): **3/9 đạt**, xác nhận **6 trường hợp bị VERIFIED sai**. Dùng SQLite thật trong snapshot; thay các phương thức cộng tác bằng đối tượng trình duyệt/API giả lúc chạy. Không khởi động trình duyệt hay gọi LMS. [Kết quả](native-worker-results.json).

Không cộng các bộ này thành số tình huống duy nhất vì chúng có chủ đích kiểm chứng chéo cùng lỗi.

Tiến trình kiểm tra chỉ nhận các biến Windows tối thiểu, không nhận khóa/mật khẩu. npm chạy offline; telemetry tắt; rào socket Node kế thừa từ R19 chặn kết nối ngoài loopback. Đây là rào trong Node, **không phải tường lửa hệ điều hành**. [Cấu hình cô lập](isolation.json), [kiểm tra snapshot](snapshot-check.json).

## 3. Kết quả các lệnh

Tất cả tiến trình kiểm tra khởi chạy với thư mục làm việc là snapshot TEMP trên. [commands.json](commands.json) giữ mã thoát trực tiếp, đối số, thư mục chạy, thời gian, log và hash JSON của từng lượt. Dùng `node` và CLI đã sao chép trong snapshot để tránh tải thư viện.

| Lệnh trong snapshot | Mã thoát | Kết quả | Bằng chứng |
|---|---:|---|---|
| `node docs/audits/round-24/verify-independent.mjs` | 0 | **230/230** | [log](round24.attempt-1.log), [JSON](round24-results.json) |
| `node node_modules/tsx/dist/cli.mjs docs/audits/round-24/native-media-repro.mjs` | 0 | **8/8** | [log](native24.attempt-1.log), [JSON](native24-results.json) |
| `node docs/audits/round-25/verify-independent.mjs` | **1** | **312/344; 32 trượt** | [log](round25.attempt-1.log), [JSON yêu cầu](verify-results.json) |
| `node node_modules/tsx/dist/cli.mjs docs/audits/round-25/native-media-repro.mjs` | **1** | **11/25; 14 trượt** | [log cuối](native25.attempt-2.log), [JSON](native25-results.json) |
| `node node_modules/tsx/dist/cli.mjs docs/audits/round-25/native-worker-repro.mjs` | **1** | **3/9; 6 trượt** | [log](native-worker.attempt-1.log), [JSON](native-worker-results.json) |
| `node docs/audits/round-23/verify-independent.mjs` | 0 | 116/116 | [log](round23.attempt-1.log), [JSON](round23-results.json) |
| `node docs/audits/round-22/verify-independent.mjs` | 0 | 53/53 | [log](round22.attempt-1.log), [JSON](round22-results.json) |
| `node docs/audits/round-21/verify-independent.mjs` | 0 | 49/49 | [log](round21.attempt-1.log), [JSON](round21-results.json) |
| `node docs/audits/round-20/verify-independent.mjs` | **1** | 141/145; 4 lệch hợp đồng cũ | [log](round20.attempt-1.log), [JSON](round20-results.json) |
| `node docs/audits/round-12/verify-independent.mjs` | 0 | 43/43 | [log](round12.attempt-1.log), [JSON](round12-results.json) |
| `node docs/audits/round-13/verify-independent.mjs` | 0 | 89/89 | [log](round13.attempt-1.log), [JSON](round13-results.json) |
| `node docs/audits/round-16/verify-independent.mjs` | **1** | 15/16; lệch số bảng | [log](round16.attempt-1.log), [JSON](round16-results.json) |
| `node docs/audits/round-17/verify-independent.mjs` | 0 | 38/38 | [log](round17.attempt-1.log), [JSON](round17-results.json) |
| `node node_modules/tsx/dist/cli.mjs scripts/test-phase4-codex-repros.ts` | 0 | Các mục của script đạt | [log](phase4.attempt-1.log) |
| `node node_modules/tsx/dist/cli.mjs scripts/test-phase5.ts` | 0 | 7/7 mục | [log](phase5.attempt-1.log) |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` | 0 | Không có lỗi kiểu dữ liệu | [log](typecheck.attempt-1.log) |
| `npm run build` | 0 | **22/22 trang** | [log](build.attempt-1.log) |

Có **17 lệnh kiểm tra khác nhau: 12 đạt, 5 trượt** theo lượt cuối; lưu **18 biên nhận** vì bộ native media R25 có hai lượt. Lượt đầu có canvas VP8X 64×64 cho payload VP8 1×1; đã sửa **mẫu kiểm thử mới**, không sửa sản phẩm, để canvas khớp ảnh rồi chạy lại. Cả hai lượt đều 11/25, nhưng kết luận dùng lượt cuối; giữ log và JSON riêng của lượt đầu. Bộ chính dùng mẫu đã chỉnh và chạy một lần, khớp bản cuối.

## 4. Bảng trạng thái đủ 14 nhóm

[issue-status.json](issue-status.json) ánh xạ từng ID kiểm tra mới, kiểm tra kế thừa và hồi quy vừa chạy cho từng nhóm; không lấy kết luận lịch sử thay kết quả hiện tại.

| Nhóm | Trạng thái R25 | Căn cứ hiện tại |
|---|---|---|
| R19-01 | **PARTIALLY_FIXED — P2** | Mẫu cũ đạt; 8 WebP hỏng và 3 PDF có Root mồi vẫn PARSED; 3 WebP hợp lệ bị từ chối. |
| R19-02 | **CLOSED_SOURCE** | Giới hạn barem, trùng/thiếu mã tiêu chí, bằng chứng và tổng điểm tính bằng code đạt. |
| R19-03 | **CLOSED_SOURCE** | Hash tổng hợp và duyệt lại theo hợp đồng mới đạt; nội dung bị sửa bị chặn trước Save. |
| R19-04 | **CLOSED_SOURCE** | Kiểm lại file vật lý trước/sau AI, kể cả có parsedContent sẵn, đạt. |
| R19-05 | **CLOSED_SOURCE** | Giao diện gửi barem đang chọn, chặn tiêu chí sai và bài chưa đọc; ghi đè hợp lệ đạt. |
| R19-06 | **CLOSED_SOURCE** | Đủ năm trường đã xem, đúng kiểu/phiên bản ở duyệt đơn/hàng loạt; bản xem cũ bị chặn; metadata giữ bền. |
| R19-07 | **CLOSED_SOURCE** | Khóa chủ sở hữu và đúng học viên/bài nộp; tên hoặc ID một phần không cho phép lưu. |
| R19-08 | **CLOSED_SOURCE** | Chặn lesson khác session và thiếu ánh xạ; lớp/buổi được đối chiếu. |
| R19-09 | **PARTIALLY_FIXED — P1** | Mẫu cũ đạt; 18 ca mới nhận sai trường hoặc kiểu/giá trị dữ liệu; native xác nhận 6 ca. |
| R19-10 | **CLOSED_SOURCE** | Đọc lại điểm, quyết định và nhận xét GRADE/REDO đạt với DOM mô phỏng. |
| R19-11 | **CLOSED_SOURCE** | Sửa nội dung trong lúc lưu hoặc đọc lại không được VERIFIED. |
| R19-12 | **CLOSED_SOURCE** | Phản hồi lớp/buổi cũ đến muộn không ghi đè phạm vi mới trong kiểm chứng handler. |
| R19-13 | **CLOSED_SOURCE** | Ghi hai bảng trong transaction; lỗi cưỡng bức hoàn tác; không ghi nửa chừng hoặc tiêu thụ sequence của yêu cầu bị từ chối. |
| R19-14 | **CLOSED_SOURCE** | Tải thất bại/một phần dừng AI; thành công chỉ chấm tập bài mới tải. |

**Tổng: 12 CLOSED_SOURCE, 2 PARTIALLY_FIXED. Không mở thêm nhóm R19 thứ 15.**

## 5. R19-09 — P1: Vẫn xác nhận lưu điểm khi bằng chứng mâu thuẫn

### Nguyên nhân và vị trí

1. [`grade-worker.ts:720`](../../../src/lib/playwright/grade-worker.ts#L720) dùng `submissionId ?? id ?? _id`, tức chọn một giá trị đầu tiên khác null. Các nhánh student, class, decision và feedback dùng cùng cách. Vì vậy một trường đúng che khuất trường khác sai hoặc null. Ví dụ `{submissionId:'SUB1', id:'OTHER'}` vẫn VERIFIED.
2. [Dòng 772](../../../src/lib/playwright/grade-worker.ts#L772) đổi decision/status thành chuỗi trước khi kiểm tra. Mảng `['GRADE']` hoặc `['REDO']` bị đổi thành chuỗi hợp lệ và được chấp nhận.
3. [Dòng 558](../../../src/lib/playwright/grade-worker.ts#L558) đệ quy vào giá trị object trước khi kiểm tra ý nghĩa của khóa. `score:{value:1}` bị coi là container; một `nested.score:80` khác có thể cung cấp cờ đủ điểm. Tương tự, `submissionId:{value:'OTHER'}` bị bỏ qua nếu có `id:'SUB1'` ở nơi khác trong input.
4. [Dòng 688](../../../src/lib/playwright/grade-worker.ts#L688) vẫn cho phép tên `saveGrade` khi mutation chọn `saveHomeworkGrade` mà không có danh sách đối số. Nhánh có đối số hoặc alias hiện kiểm tên chính xác. Đây là lỗ hổng riêng của nhánh tương thích không đối số; không đánh đồng với ca alias R24 đã sửa.

### Bằng chứng thực thi

**18/77 ca R25-09 trượt**:

| Loại | Số ca | Kết quả sai |
|---|---:|---|
| submissionId null bị bỏ qua khi có id đúng | 1 | VERIFIED |
| Hai trường tương đương mâu thuẫn, trường chính null, hoặc decision/status dạng mảng | 12 | VERIFIED |
| Tên response sai trong nhánh không đối số | 1 | VERIFIED |
| Trường score/submissionId bị bọc object, dữ liệu nơi khác cung cấp bằng chứng thay | 2 | VERIFIED |
| REDO với decision dạng mảng hoặc submissionId null bị bỏ qua | 2 | VERIFIED |

Ví dụ request dùng `saved: saveHomeworkGrade(input:$input)` với input đúng bài đã duyệt. Response `{data:{saved:{submissionId:'SUB1',id:'OTHER'}}}` hoặc `{data:{saved:{decision:'GRADE',status:'REDO'}}}` vẫn làm SQLite chuyển sang VERIFIED khi DOM giả khớp. Bộ native chạy nguyên worker xác nhận cả hai, cùng bốn trường hợp khác. Xem các ID `R25-09-*` và `R25-NATIVE-09-*` trong JSON.

**Phần đã đạt:** toàn bộ **31/31 ca R24-09**, gồm literal đúng, biến đổi tên, alias, bound input, biến dư không được tham chiếu và các mismatch đã biết. Ca mới cũng xác nhận input đúng vẫn được nhận dù biến dư sai; input lồng đúng được nhận, input lồng sai và mảng input bị chặn. Chỉ có một ID lặp về ý nghĩa giữa hai cách kiểm null; số 18 là số ca kiểm tra, không phải 18 nguyên nhân độc lập.

**Cách sửa tối thiểu đề nghị:** kiểm tra riêng từng khóa nghiệp vụ có mặt, không chọn một khóa để đại diện cho tất cả; kiểm kiểu chuỗi trước decision/status; khi gặp khóa scalar như score/submissionId thì kiểm ngay kiểu/giá trị trước khi đệ quy container; bỏ ngoại lệ tên `saveGrade` khác trường đã chọn. Giữ nhánh literal, biến đổi tên và chỉ xét biến thực sự được tham chiếu. Nếu vẫn hỗ trợ nhiều cú pháp GraphQL, dùng bộ phân tích cú pháp thay cho suy đoán bằng biểu thức dò chuỗi.

**Sau khi sửa:** 18 ca trên phải không được VERIFIED; giữ các ca hợp lệ và toàn bộ R24 đạt. Đây là hợp đồng GraphQL giả để kiểm rào an toàn; chưa xác nhận schema LMS thật, chưa chứng minh LMS thật đã lưu nhầm điểm. DOM giả cố ý khớp nhằm kiểm xem bằng chứng mạng sai có bị chặn hay không.

## 6. R19-01 — P2: Kiểm hình thức WebP chưa chứng minh ảnh đọc được; PDF lấy nhầm Root

### Nguyên nhân và vị trí

- [`media-reader.ts:331`](../../../src/lib/file-parsers/media-reader.ts#L331): VP8 chỉ đếm byte khác 0/FF và số byte khác nhau ở hai partition. Dữ liệu giả `[0,1,2,...]` đáp ứng điều kiện này nhưng không tạo ảnh giải mã được.
- [Dòng 367](../../../src/lib/file-parsers/media-reader.ts#L367): nhánh prefix phức tạp đọc header độ dài mã nhưng chưa dựng/giải mã cây Huffman và pixel. [Dòng 459](../../../src/lib/file-parsers/media-reader.ts#L459) còn trả sớm khi transform có cây không phải single-symbol, trước khi xác nhận luồng ảnh chính. Đọc đủ tên các cây không đồng nghĩa giải mã đúng nội dung của chúng.
- [Dòng 317](../../../src/lib/file-parsers/media-reader.ts#L317) và [347](../../../src/lib/file-parsers/media-reader.ts#L347): ngưỡng độ dài/độ đa dạng byte làm từ chối cả một số WebP nhỏ hợp lệ.
- [Dòng 544](../../../src/lib/file-parsers/media-reader.ts#L544): khi thấy `trailer`, regex tìm `/Root` đầu tiên trong **toàn bộ tài liệu**, thay vì khóa Root trực tiếp trong trailer. Chuỗi metadata hoặc dictionary lồng chứa `/Root 1 0 R` đánh lạc hướng kiểm tra trailer `/Root 9 0 R` không tồn tại.

### Bằng chứng thực thi

**14/25 ca R25-01 trượt**, được bộ native xác nhận đủ:

| Loại | Số ca | Đối chứng | Sản phẩm |
|---|---:|---|---|
| VP8 có entropy giả, header/partition đủ điều kiện | 2 | `sharp` không đọc được pixel; dạng thường và VP8X khớp kích thước | PARSED, 1 inlineData |
| VP8L thiếu pixel, cây mã lỗi, hoặc transform thiếu luồng chính | 6 | `sharp` không đọc được pixel; mỗi mẫu có dạng thường và VP8X | PARSED, 1 inlineData |
| WebP hợp lệ: đen 1×1 lossy/lossless, trắng 2×2 lossy | 3 | `sharp` giải mã thành công | PARSE_ERROR, 0 inlineData |
| PDF có Root mồi trong chuỗi/nhánh lồng, trailer Root thiếu hoặc trỏ object không tồn tại | 3 | Cây đối tượng và trailer sai được ghi rõ trong mẫu xref | PARSED, 1 inlineData |

Mẫu VP8 giả chỉ 28 byte payload; các mẫu VP8L nhỏ và xác định. Không thử làm đầy bộ nhớ. Từng mẫu có Base64 trong [verify-results.json](verify-results.json) và [native25-results.json](native25-results.json) để tái hiện đúng bytes.

**Phần đã đạt:** sáu ca file từng trượt ở R24 nay bị chặn; các ca Adam7 và cây Kids kế thừa đều đạt. Ca mới xác nhận generation khác 0 hợp lệ được nhận; Root thiếu/sai generation và Kids/Parent sai generation đơn giản bị từ chối. Vì vậy phần khóa `objNum:genNum` đã được chứng minh tiến bộ, nhưng cách xác định Root thực tế còn thiếu.

**Cách sửa tối thiểu đề nghị:** dùng bộ giải mã ảnh thực sự trước khi tạo inlineData, giữ bytes gốc và giới hạn tài nguyên, thay phép đo entropy/ngưỡng suy đoán. Với PDF, xác định đúng dictionary trailer và khóa Root trực tiếp, bỏ qua chuỗi/stream và khóa trong dictionary lồng; tiếp tục đối chiếu cả số object lẫn generation và cây trang.

**Sau khi sửa:** cả 25 ca mới phải đạt, gồm nhận đúng các ảnh nhỏ hợp lệ, đồng thời giữ nguyên 230/230 và 8/8 ca R24. Chưa có bộ giải mã PDF độc lập trong vòng này; kết luận PDF giới hạn ở yêu cầu Root/cây đối tượng được mô tả rõ.

## 7. Chênh lệch của bộ lịch sử

R20 nguyên bản **141/145**, giữ nguyên bốn ca trượt: `API-approval-control`, `R20-03-legacy-reapproval`, `R20-05-override-control`, `R20-06-latest-control`. Chúng gửi yêu cầu duyệt theo hợp đồng cũ thiếu snapshot đủ năm trường đã xem, nên hiện bị 409. Bốn ca `R24-COMPAT-R20-*` kế thừa chạy mới đều đạt: yêu cầu cũ bị chặn, yêu cầu đủ dữ liệu hiện tại được duyệt và giữ đúng hash/điểm/nội dung. Không sửa ca cũ hoặc đổi bốn FAIL thành PASS.

R16 nguyên bản **15/16**: `PHASE1-SCHEMA` đòi đúng bảy bảng trong khi hiện có tám, thêm `homework_submission_meta` để lưu phiên bản file và thứ tự sửa. `R23-COMPAT-R16-schema` chạy mới đạt, kiểm đủ bảy bảng cũ cộng bảng metadata. Hồi quy R12/13/16/17 vì vậy vẫn ghi **185/186**, không ghi 186/186.

Các chênh lệch trên giống R24, có đối chứng tương thích cụ thể và không phải lý do mới để mở lại nhóm khác. Lý do NO-GO R25 là các lỗi mới tái hiện của R19-01/R19-09.

## 8. Bảo toàn và khả năng tái kiểm

- [before-hashes.json](before-hashes.json), [preservation-check.json](preservation-check.json): **563/563 tệp trong danh mục trước/sau giữ nguyên**, không thêm/xóa/sửa bên ngoài thư mục R25 trong phạm vi danh mục này.
- **487/487 tệp được bảo vệ** giữ nguyên kích thước và SHA-256: toàn bộ 486 tệp lịch sử R12–R24 và `next-env.d.ts`.
- `next-env.d.ts` gốc luôn giữ `B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000`; không ghi rồi khôi phục tệp này. Build chỉ đổi bản trong snapshot.
- **57/57 tệp src/scripts và toàn bộ 74 tệp trong danh mục nguồn giữ nguyên ở repo gốc.** Trong snapshot, chỉ `next-env.d.ts` khác danh mục nguồn sau build; mười hash mô-đun mà bộ chính ghi nhận khớp cả nguồn gốc và snapshot.
- Chỉ tạo kết quả trong `docs/audits/round-25/`. Theo giới hạn riêng của yêu cầu R25, **không sửa kế hoạch, INDEX/LATEST hoặc hồ sơ lịch sử**. Dấu hoàn thành kiểm toán được ghi ở đây.
- Mã băm bộ chính đã chạy: `024c7c47e0e29d43315913cb2899ef3aa7f92032250fac1f56aec90e079065ab`. [evidence-manifest.json](evidence-manifest.json) ghi hash các tài liệu, script, log và JSON; [audit-runner.py](audit-runner.py) ghi cách tạo snapshot/chạy lệnh.
- Không cần hoàn tác mã sản phẩm vì không thay đổi mã. Giữ nguyên thư mục tạm để có thể kiểm tra lại; mọi kết quả tái chạy bộ lịch sử phải tiếp tục ở snapshot, không chạy tại repo gốc.

## 9. Hoàn tất và bước tiếp theo

- [x] **AUDIT-R25:** Đã chạy lại đủ 230+8 ca R24, bổ sung 114 ca, đối chiếu 14/14 nhóm, xác nhận chéo bằng nạp trực tiếp mô-đun và kiểm tra bảo toàn.

**Đã làm:** Tạo bộ kiểm chứng, JSON, log, ánh xạ trạng thái và báo cáo R25; không sửa sản phẩm.

**Kết quả:** **NO-GO — 12/14 CLOSED_SOURCE**. Bản sửa đã vượt toàn bộ ca R24 nhưng còn lỗi mới có bằng chứng thực thi trong hai nhóm còn mở.

**Chưa kiểm tra:** Chromium/React thực tế, tài khoản/schema/LMS thật, Gemini thật, bài nộp và DB thật; không coi bản dựng hoặc kiểm chứng giả là nghiệm thu sử dụng thật.

**Việc tiếp theo:** Giao hai nhóm R19-01/R19-09 cho bên triển khai theo [yêu cầu sửa có thể sao chép](FIX_PROMPT.vi.md), rồi kiểm toán lại trên đúng bản nguồn đã sửa. Chưa dùng báo cáo này để nghiệm thu luồng lưu điểm thật.
