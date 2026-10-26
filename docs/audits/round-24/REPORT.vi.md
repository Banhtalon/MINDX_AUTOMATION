# AUDIT-R24 — Kiểm toán độc lập Giai đoạn 5

**Phán quyết chính thức: NO-GO cấp mã nguồn. Chưa nghiệm thu Giai đoạn 5.**

Đạt **12/14 nhóm CLOSED_SOURCE**, còn **R19-01 (P2)** và **R19-09 (P1) PARTIALLY_FIXED**. Hai nhóm R19-06 và R19-13 có đủ bằng chứng để đóng trong phạm vi mã nguồn và dữ liệu giả. `CLOSED_SOURCE` nghĩa là đạt các điều kiện đã kiểm tại mã nguồn hiện tại, không thay cho nghiệm thu bằng tài khoản, trình duyệt và LMS thật.

Bộ R23 nguyên bản đã đạt **116/116**, gồm toàn bộ 24 ca từng trượt tại R23. Tuy nhiên bộ R24 mở rộng đạt **203/230**, còn **27 ca trượt**: 6 ca kiểm tra file, 19 ca chấp nhận bằng chứng lưu điểm sai/thiếu và 2 đối chứng từ chối nhầm đối số hợp lệ. Vì vậy chưa đạt điều kiện **14/14 CLOSED_SOURCE** để ký GO.

Đã chạy đủ **13 lệnh bắt buộc** trong snapshot TEMP: **10 PASS, 3 FAIL**. Ba lệnh FAIL là R24, R20 và R16; hai bộ lịch sử R20/R16 có chênh lệch hợp đồng được giải thích riêng ở mục 7. Kiểm tra bổ sung bằng cách nạp trực tiếp mô-đun sản phẩm xác nhận lại sáu ca file hỏng bị chấp nhận. **Không sửa mã sản phẩm hoặc bộ kiểm chứng lịch sử.**

## 1. Phạm vi và bản nguồn được kiểm

- Đối tượng: TASK-5.1–TASK-5.5, luồng tải bài → đọc file → AI đề xuất điểm → lưu nháp → giáo viên duyệt → lưu LMS → đọc lại → VERIFIED. Đối chiếu thêm 10 nhóm đã đóng và hồi quy Giai đoạn 1–4 được yêu cầu.
- Đã đọc quy tắc dự án, phần liên quan của `MINDX_AUTOMATION_PLAN.md`, báo cáo R23, bốn phần mã trọng tâm, luồng duyệt trên giao diện, bộ kiểm toán điểm và các hàm hỗ trợ kiểm chứng lịch sử. Giả định sử dụng: ứng dụng cục bộ của một giáo viên, có thể mở nhiều tab.
- Ngày kiểm toán: **20/10/2026**. Chụp bản nguồn lúc **19:37:58 giờ Việt Nam**, tức `2026-10-20T12:37:58.906386+00:00`.
- HEAD: `2570d96b6770957e218031c91f14ce98e766dfa7`. Cây làm việc có nhiều thay đổi chưa commit và file mới; kết luận gắn với danh mục SHA-256, không chỉ với HEAD.
- [source-state.json](source-state.json) ghi **74 tệp** nguồn/script/cấu hình và tệp cấp gốc công khai, mã băm tổng hợp **`a5ed2fda036cae4e820ca6a9be58bb63c39cbe2f2cbd24a7f9e5fdbf8f0fcfcd`**. Danh mục này loại `.env*` và tệp bộ nhớ đệm `tsconfig.tsbuildinfo`.
- [changes-since-r23.json](changes-since-r23.json): có **6 tệp nguồn/script thay đổi từ bản chụp R23**: `media-reader.ts`, `approve/route.ts`, `grade-worker.ts`, `sqlite.ts`, `homework-auto-grader-tab.tsx`, `test-phase5.ts`. Kế hoạch cũng khác bản chụp trước kiểm toán R23. Đây là thay đổi có sẵn trước khi bắt đầu R24.

Đường dẫn snapshot:

```text
C:\Users\QQ\AppData\Local\Temp\mindx-round24-20261020T123758Z-mindx-round23-mindx-round22-compat-mindx-round21-mindx-round20-compat\snapshot
```

Hậu tố tên thư mục đáp ứng các chốt an toàn của bộ cũ; không sửa bộ cũ để chạy ở thư mục khác. Thư viện được sao chép thành tệp độc lập, không nối về `node_modules` gốc và không cài/cập nhật thư viện. Không sao `.env*`, DB thật, hồ sơ đăng nhập, bài nộp thật, ảnh/debug thật, `.git` hoặc `.next`. Chỉ lấy dữ liệu cấu hình trong `data/config`.

## 2. Cách kiểm chứng và bảo toàn

[verify-independent.mjs](verify-independent.mjs) kế thừa minh bạch **116 ca R23**, giữ nguyên ID và điều kiện kiểm tra, thêm **114 ca R24**. Kết quả: ca kế thừa **116/116**; ca mới **87/114**. [assemble-verifier.py](assemble-verifier.py), [r24-cases.inc.txt](r24-cases.inc.txt) và [harness-provenance.json](harness-provenance.json) chỉ rõ cách tạo tệp độc lập cuối.

Các hàm sản phẩm được nạp từ đúng snapshot, bỏ import/export và khai báo kiểu theo hàm hỗ trợ R23 rồi thực thi nguyên thân hàm. Không thay thân hàm sản phẩm hoặc điều kiện an toàn để tạo PASS. SQLite chạy thật trong bộ nhớ, có ca đóng/mở file SQLite giả; `sharp` giải mã thật ảnh đối chứng. API, DOM, Gemini và hook giao diện dùng mô phỏng xác định. **Chưa chạy Chromium/React hoặc LMS thật.**

Bổ sung [native-media-repro.mjs](native-media-repro.mjs) nạp trực tiếp `src/lib/file-parsers/index.ts` qua `tsx`, không tách thân hàm hay sửa mã: **2/8 PASS, 6 FAIL**, xác nhận cùng sáu ca file. Mẫu PDF bổ sung có bảng xref; kết luận tham chiếu dựa trên chính quan hệ đối tượng trong mẫu, chưa dùng bộ giải mã PDF độc lập. [Kết quả bổ sung](native-media-results.json).

Tiến trình chỉ nhận danh sách biến Windows tối thiểu, không kế thừa khóa/mật khẩu; npm chạy offline, telemetry tắt. Nạp rào socket Node từ bản sao `round-19/network-guard.cjs` để chặn kết nối ngoài loopback. Đây là rào trong Node, không phải tường lửa hệ điều hành. Không mở trình duyệt hoặc gọi LMS/Gemini thật. Xem [snapshot-check.json](snapshot-check.json), [isolation.json](isolation.json).

**Bảo toàn tại repo gốc:**

- **417/417 tệp được bảo vệ giữ nguyên danh mục, kích thước và SHA-256**: 416 tệp lịch sử R12–R23 và `next-env.d.ts`. [Danh mục trước](protected-hashes.json), [đối chiếu sau](preservation-check.json).
- `next-env.d.ts` vẫn đúng **`B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000`**.
- **57/57 tệp trong `src/` và `scripts/` giữ nguyên**, không thêm/xóa tệp trong hai thư mục đó. Mọi cấu hình trong danh mục nguồn cũng giữ nguyên. Chỉ kế hoạch được cập nhật theo yêu cầu.
- Build chỉ thay `next-env.d.ts` **trong snapshot** trong số 74 tệp đối chiếu; không cần ghi đè hay khôi phục tệp gốc.
- Bộ lịch sử ghi kết quả mới trong snapshot; bản sao bằng chứng mang tên mới dưới R24. Không ghi kết quả mới lên thư mục R12–R23 gốc.
- Trước khi cập nhật tài liệu đã giữ [bản kế hoạch](MINDX_AUTOMATION_PLAN.before.md), [LATEST](LATEST.before.md), [INDEX](INDEX.before.md). Chỉ thêm hồ sơ R24 và cập nhật ba tài liệu được yêu cầu; không commit/reset thay đổi của Owner.

SHA-256 bộ R24 cuối, khớp bytes đã chạy: **`59686d216b00a8655898e5cf4f8f0fb2a5c31e4326f933a44602671d823c607d`**. [artifact-check.json](artifact-check.json) đối chiếu bộ kiểm chứng, hash nguồn gốc/snapshot, log và JSON có lưu. [evidence-manifest.json](evidence-manifest.json) ghi mã băm hồ sơ.

## 3. Kết quả đầy đủ các lệnh

Tất cả lệnh trong bảng chạy tại snapshot nêu trên, với mã thoát của chính tiến trình kiểm tra được ghi trực tiếp vào [commands.json](commands.json).

| Lệnh | Mã thoát | Kết quả | Bằng chứng mới |
|---|---:|---|---|
| `node docs/audits/round-24/verify-independent.mjs` | **1** | **203/230; 27 FAIL** | [log cuối](round24.attempt-2.log), [JSON](independent-results.json) |
| `node docs/audits/round-23/verify-independent.mjs` | 0 | **116/116 PASS** | [log](round23.attempt-2.log), [JSON](round23-results.json) |
| `node docs/audits/round-22/verify-independent.mjs` | 0 | **53/53 PASS** | [log](round22.attempt-2.log), [JSON](round22-results.json) |
| `node docs/audits/round-21/verify-independent.mjs` | 0 | **49/49 PASS** | [log](round21.attempt-2.log), [JSON](round21-results.json) |
| `node docs/audits/round-20/verify-independent.mjs` | **1** | **141/145; 4 lệch hợp đồng cũ** | [log](round20.attempt-2.log), [JSON](round20-results.json) |
| `node docs/audits/round-12/verify-independent.mjs` | 0 | **43/43 PASS** | [log](round12.attempt-2.log), [JSON](round12-results.json) |
| `node docs/audits/round-13/verify-independent.mjs` | 0 | **89/89 PASS** | [log](round13.attempt-2.log), [JSON](round13-results.json) |
| `node docs/audits/round-16/verify-independent.mjs` | **1** | **15/16; lệch kỳ vọng 7 bảng** | [log](round16.attempt-2.log), [JSON](round16-results.json) |
| `node docs/audits/round-17/verify-independent.mjs` | 0 | **38/38 PASS** | [log](round17.attempt-2.log), [JSON](round17-results.json) |
| `npx tsx scripts/test-phase4-codex-repros.ts` | 0 | Các mục của script PASS | [log](phase4.attempt-2.log) |
| `npx tsx scripts/test-phase5.ts` | 0 | **7/7 mục PASS** | [log](phase5.attempt-2.log) |
| `npx tsc --noEmit --incremental false` | 0 | Không có lỗi kiểu dữ liệu | [log](typecheck.attempt-2.log) |
| `npm run build` | 0 | **22/22 trang PASS** | [log](build.attempt-2.log) |
| Bổ sung: `npx tsx docs/audits/round-24/native-media-repro.mjs` | **1** | **2/8; xác nhận lại 6 ca file** | [log](native-media.attempt-1.log), [JSON](native-media-results.json) |

Hồi quy R12/13/16/17 nguyên bản là **185/186**. Không cộng các bộ thành số tình huống nghiệp vụ duy nhất vì có ca kế thừa/trùng phạm vi. Các thông báo lỗi mạng trong Phase 4 thuộc tình huống lỗi cố ý tạo, script kết thúc 0.

**Ghi nhận vận hành kiểm toán:** Lần 1 của 12 lệnh lịch sử/Phase/type/build dừng trước khi vào kiểm tra do công cụ điều phối đặt đường dẫn Windows trong `NODE_OPTIONS` chưa đúng. Đã sửa cách ghi đường dẫn của công cụ R24 và chạy lại đủ 12 lệnh; không sửa sản phẩm. Giữ log lần lỗi, không tính chúng thành lỗi sản phẩm. R24 chạy hai lần cùng nguồn và cùng bộ kiểm chứng, đều 203/230; lần 2 xác nhận công cụ điều phối trả mã lỗi khi bộ kiểm chứng trượt. JSON lần R24 đầu bị bản cuối ghi đè trước khi bổ sung lưu JSON riêng từng lượt; đã ghi rõ hạn chế này trong biên nhận, giữ hash đã quan sát và log lượt đầu. JSON lượt cuối, bản sao theo lượt và toàn bộ log hiện có đã đối chiếu mã băm; không dùng JSON lượt đầu làm bằng chứng cuối.

## 4. Đối chiếu đủ 14 nhóm

[issue-status.json](issue-status.json) chứa mã ca, kết quả hồi quy mới và ánh xạ tương thích riêng cho từng nhóm.

| Nhóm | Phán định R24 | Căn cứ |
|---|---|---|
| R19-01 | **PARTIALLY_FIXED — P2** | Adam7 đạt; 4 WebP hỏng và 2 PDF tham chiếu sai vẫn tạo inlineData. |
| R19-02 | **CLOSED_SOURCE** | Mã tiêu chí, giới hạn barem, bằng chứng và tổng điểm tính bằng code đạt hồi quy mới. |
| R19-03 | **CLOSED_SOURCE** | Hash tổng hợp bảo vệ toàn bộ nội dung; duyệt lại hash cũ đạt với snapshot đầy đủ trong ca tương thích R24. |
| R19-04 | **CLOSED_SOURCE** | File đổi/xóa trước hoặc trong AI bị chặn, cả nhánh có parsedContent sẵn. |
| R19-05 | **CLOSED_SOURCE** | Giao diện gửi barem đang chọn, chặn tiêu chí sai/bài chưa đọc; ghi đè hợp lệ đạt hợp đồng duyệt mới. |
| R19-06 | **CLOSED_SOURCE — mới đóng** | Đủ năm trường, kiểu và giá trị cho duyệt đơn/hàng loạt; hash lưu bền đạt; 42/42 ca mới đạt. |
| R19-07 | **CLOSED_SOURCE** | Khóa đúng học viên/bài nộp; từ chối tên trùng, ID một phần và modal thiếu ID. |
| R19-08 | **CLOSED_SOURCE** | Đối chiếu lesson/session và chặn thiếu ánh xạ đạt. |
| R19-09 | **PARTIALLY_FIXED — P1** | Chặn data sai hình dạng đã đạt; còn sai trường/alias, giá trị phản hồi và ràng buộc đối số. |
| R19-10 | **CLOSED_SOURCE** | Đọc lại điểm/quyết định/nhận xét GRADE và REDO đạt với DOM mô phỏng. |
| R19-11 | **CLOSED_SOURCE** | Đối chiếu hash ngay trước VERIFIED vẫn chặn bản bị sửa trong lúc lưu/đọc lại. |
| R19-12 | **CLOSED_SOURCE** | Phản hồi lớp/buổi cũ không ghi đè phạm vi mới trong kiểm chứng handler. |
| R19-13 | **CLOSED_SOURCE — mới đóng** | Hai câu ghi chung transaction; lỗi ở cả hai bảng đều hoàn tác, không tăng sequence dở dang. |
| R19-14 | **CLOSED_SOURCE** | Tải thất bại/một phần dừng AI; lượt thành công chỉ chấm đúng tập đã tải. |

Tổng: **12 CLOSED_SOURCE, 2 PARTIALLY_FIXED**; còn **1 nhóm P1 và 1 nhóm P2**. Chênh lệch R20/R16 được ghi riêng, không tạo nhóm R19 thứ 15 hoặc tự đổi thành PASS nguyên bản.

## 5. R19-09 — P1: Chưa chứng minh đúng thao tác lưu và kết quả trả về

### Nguyên nhân và vị trí

1. [`grade-worker.ts:715`](../../../src/lib/playwright/grade-worker.ts#L715) cho phép tên trường khác alias đã chọn nếu tên đó chứa `grade/score/mark/evaluate`. Chưa bắt buộc có chính trường đã chọn trong `data`.
2. [Dòng 724](../../../src/lib/playwright/grade-worker.ts#L724) chỉ loại một số giá trị như null/false/Mutation/Query. Số, chuỗi, mảng rỗng, object rỗng hoặc `{success:false}` vẫn đi qua. Các ID sai kiểu/trống bị bỏ qua; `score` chỉ so nếu đã là số tại [dòng 773](../../../src/lib/playwright/grade-worker.ts#L773); phản hồi mâu thuẫn quyết định/nhận xét chưa bị đối chiếu.
3. [Dòng 585](../../../src/lib/playwright/grade-worker.ts#L585) tiếp tục dùng toàn bộ túi `variables` làm bằng chứng dù không được mutation tham chiếu. [Dòng 560](../../../src/lib/playwright/grade-worker.ts#L560) chỉ duyệt một tầng object được gắn với `$var`, bỏ sót dữ liệu lồng tiếp. Các cờ đủ ID/điểm/nhận xét được đặt khi duyệt túi biến, không đặt khi đối số literal/biến đổi tên thực sự đã được kiểm đúng.

### Bằng chứng thực thi

**21/31 ca R24-09 trượt**, chia thành:

| Phần | Ca trượt | Quan sát |
|---|---:|---|
| Giá trị kết quả | 12 | `saved:0`, `1`, `"ok"`, `""`, `[]`, `{}`, `{success:false}`, ID số/trống, `score:"90"`, `decision:"REDO"`, nhận xét khác vẫn **VERIFIED**. |
| Tên trường/alias | 3 | Query chọn `saved:saveHomeworkGrade`, response chỉ có `saveHomeworkGrade`, `updateOtherGrade` hoặc `gradeResult` vẫn **VERIFIED**. |
| Đối số thực truyền | 4 | Mutation chỉ truyền `score:80` nhưng túi biến chứa đủ ID; hoặc `$wrapped.payload` chứa bài/điểm/nhận xét sai, túi biến ngoài lại đúng → vẫn **VERIFIED**. |
| Đối chứng hợp lệ | 2 | Đủ đối số literal đúng, hoặc đủ `$c/$s/$sub/$stu/$n/$d/$f` đúng nhưng không có biến tên nghiệp vụ dư → bị từ chối, **FAILED**. |

Ví dụ trọng tâm trong JSON:

```graphql
mutation SaveHomeworkGrade($input: GradeInput!) {
  saved: saveHomeworkGrade(input: $input) { id }
}
```

Với input đúng bài đã duyệt, `{data:{updateOtherGrade:true}}` vẫn được nhận, dù không có trường `saved`. Với `{data:{saved:{success:false}}}`, worker cũng nâng bản ghi SQLite lên VERIFIED khi DOM mô phỏng khớp. Các ca ghi đầy đủ request/response, trạng thái và lỗi trong [independent-results.json](independent-results.json), ID `R24-09-*`.

**Phần đã đạt:** Thiếu/null/mảng/rỗng ở chính `data` bị chặn; các literal sai và biến sai trực tiếp của R23 bị chặn; bound input thật với alias đúng đạt đối chứng; sai từng trường trực tiếp trong input bị chặn; điểm trả về là số 90 thay vì 80 bị chặn. Toàn bộ ca R22/R23 và hồi quy R20/R21 liên quan đạt.

**Cách sửa tối thiểu đề nghị:** Gắn bộ lọc vào mutation và trường/alias thực sự được chọn. Chỉ dùng các giá trị được truyền qua cây đối số của mutation đó; xử lý đệ quy đối tượng lồng và `$var`, không dùng biến dư làm bằng chứng. Kiểm tra kiểu/kết quả thành công và mọi thông tin bài/điểm/quyết định/nhận xét có trả về theo hợp đồng rõ ràng. Với GraphQL tổng quát, dùng bộ phân tích cú pháp thay biểu thức dò chuỗi; nếu chỉ hỗ trợ một hợp đồng LMS, chốt hợp đồng đó và từ chối hình dạng ngoài hợp đồng.

**Sau khi sửa:** 19 ca chấp nhận sai phải không được VERIFIED; hai đối chứng đúng phải được nhận nếu thuộc hợp đồng hỗ trợ. Giữ đối chứng input trực tiếp, alias hợp lệ, HTTP 200/201 và đọc lại DOM.

**Giới hạn:** Tên mutation và `GradeInput` là hợp đồng giả phục vụ kiểm chứng, chưa xác nhận schema LMS thật. Các ca chứng minh điều kiện xác minh hiện chấp nhận bằng chứng không đúng, không chứng minh LMS thật đã chấm nhầm. Không lấy kết quả này làm nghiệm thu trình duyệt thật.

## 6. R19-01 — P2: Header WebP hợp lệ vẫn che dữ liệu hỏng; PDF chưa dùng đúng gốc tham chiếu

### Nguyên nhân và vị trí

- [`media-reader.ts:316`](../../../src/lib/file-parsers/media-reader.ts#L316): VP8 kiểm header, kích thước, first partition và một bit, rồi trả true; chưa giải mã dữ liệu ảnh. [Dòng 332](../../../src/lib/file-parsers/media-reader.ts#L332) kiểm một phần VP8L; cuối cùng chỉ cần tồn tại byte khác 0 và khác FF tại [dòng 366](../../../src/lib/file-parsers/media-reader.ts#L366).
- [Dòng 441](../../../src/lib/file-parsers/media-reader.ts#L441) lưu đối tượng PDF bằng số ID, bỏ generation — tức phần số phiên bản của tham chiếu. [Dòng 450](../../../src/lib/file-parsers/media-reader.ts#L450) bắt đầu từ bất kỳ Catalog tìm được, chưa xác định Catalog thật qua `trailer /Root`.

### Bằng chứng

- **4 WebP hỏng**: VP8 có header `70 00 00 9d 01 2a 01 00 01 00 00 00 00 00`; VP8L có `2f 00 00 00 00 00 01 02 03 04 05`. Thử cả dạng chunk ảnh trực tiếp và dạng VP8X. `sharp` đều báo `webp2vips: unable to read pixels`, nhưng sản phẩm trả **PARSED, inlineParts=1**. Dữ liệu ngắn và an toàn, không phải thử làm đầy bộ nhớ.
- **2 PDF tham chiếu sai**: trailer `/Root` trỏ object không tồn tại nhưng có Catalog khác; Catalog trỏ `/Pages 2 1 R` trong khi chỉ có object `2 0 obj`. Cả hai vẫn **PARSED, inlineParts=1**. Bản nạp trực tiếp dùng PDF có xref và giữ nguyên độ dài khi thay tham chiếu, xác nhận cùng lỗi.
- ID: `R24-01-webp-*plausible-garbage`, `R24-01-pdf-trailer-missing-root`, `R24-01-pdf-missing-generation`. [Kết quả chính](independent-results.json), [bản nạp trực tiếp và Base64 mẫu](native-media-results.json).

**Phần đã đạt:** **22/22 ca PNG Adam7 mới** đạt: đủ bảy lượt với ảnh 8×8, kích thước lẻ, lượt rỗng, pixel đóng gói 1/4 bit và 16 bit; filter=5 hoặc thiếu dữ liệu tại từng lượt đều bị chặn; byte giải nén dư bị chặn. WebP alpha hợp lệ vẫn giữ đúng bytes. PDF có Kids liên thông/nested được nhận; chu trình hoặc Kids thiếu bên cạnh một Page hợp lệ đều bị từ chối, Parent sai bị chặn. Toàn bộ mẫu R23 cũ của nhóm này đạt.

**Cách sửa tối thiểu đề nghị:** Xác thực VP8/VP8L bằng bộ giải mã ảnh đáng tin cậy, có giới hạn tài nguyên; lỗi giải mã phải PARSE_ERROR và không tạo inlineData. Với PDF, xác định đúng Catalog từ trailer Root và phân giải đầy đủ cặp object ID/generation xuyên suốt cây trang; giữ phát hiện chu trình và tham chiếu thiếu đã có.

**Sau khi sửa:** Sáu mẫu trên phải bị từ chối; ảnh/PDF hợp lệ và 22 ca Adam7 tiếp tục đạt. Chưa kết luận hỗ trợ mọi dạng PDF như xref stream/object stream/mã hóa hoặc giới hạn tài nguyên với file cực lớn.

## 7. Hai nhóm mới đóng và các hợp đồng kiểm chứng lịch sử

### R19-06 — CLOSED_SOURCE

Đã xác minh nhánh duyệt đơn tại [`approve/route.ts:342`](../../../src/app/api/homework-grader/approve/route.ts#L342), 369, 382, 409, 426 và nhánh hàng loạt tại dòng 123–183: đều bắt buộc và đối chiếu `fileHash`, `feedbackHtml`, `decision`, `teacherOverrideScore`, `criteriaGrades`. Điểm ghi đè null được phân biệt với thiếu trường; điểm 0 không bị mất. Giao diện duyệt đơn tại [`homework-auto-grader-tab.tsx:508`](../../../src/components/homework-auto-grader-tab.tsx#L508) và hàng loạt tại dòng 568 gửi đầy đủ.

**42/42 ca mới đạt**: 30 ca thiếu/sai kiểu/khác giá trị cho cả hai chế độ và 12 đối chứng hợp lệ GRADE/REDO với điểm ghi đè null/0/100. Các ca bulk drift, duyệt không hash dù bỏ decision/rubric, reload repository và đóng/mở file SQLite của R23 đều đạt.

**Bốn ca R20 nguyên bản vẫn FAIL, không sửa lịch sử:**

| ID R20 | Lệnh duyệt cũ | Quan sát mới | Ca tương thích R24 |
|---|---|---|---|
| `API-approval-control` | `{}` ngoài bộ định danh | 409 thay cho 200 | `R24-COMPAT-R20-API-approval-control` PASS |
| `R20-03-legacy-reapproval` | `{}` sau hạ hash cũ | 409 thay cho 200 | `R24-COMPAT-R20-R20-03-legacy-reapproval` PASS |
| `R20-05-override-control` | Chỉ `teacherOverrideScore:90` | 409 thay cho 200 | `R24-COMPAT-R20-R20-05-override-control` PASS |
| `R20-06-latest-control` | Nhận xét và criteriaGrades | 409 thay cho 200 | `R24-COMPAT-R20-R20-06-latest-control` PASS |

Cả bốn yêu cầu cũ không gửi `fileHash` và thiếu thêm trường theo hợp đồng đầy đủ. Các ca tương thích trước hết khẳng định yêu cầu cũ vẫn bị 409, sau đó gửi **đủ snapshot vừa xem**, giữ nguyên mục tiêu gốc: hash tổng hợp đúng, duyệt lại hash cũ an toàn, giữ điểm 90 và giữ nhận xét LATEST. Kết quả **4/4 PASS** theo hướng dẫn mục 9 R23. Không nới server, không ghi “145/145 R20 nguyên bản”; kết quả nguyên bản vẫn **141/145, exit 1**. Đây là chênh lệch kiểm chứng có chủ đích khi siết hợp đồng an toàn, không phải bốn lỗi duyệt mới.

### R19-13 — CLOSED_SOURCE

[`sqlite.ts:899`](../../../src/lib/db/sqlite.ts#L899) gọi `db.transaction(...)`; ghi bài nộp bằng `stmt.run`, ghi metadata bằng `metaStmt.run` tại dòng 920 trong cùng callback, rồi thực thi giao dịch tại dòng 923. Nghĩa là cả hai cùng lưu thành công hoặc cùng hoàn tác.

- Ca `R23-13-failed-write-metadata` dùng lỗi dung lượng SQLite thật nay đạt: HTTP 500, metadata không tăng, lần lưu số 1 sau phục hồi nhận 200.
- `R24-13-rollback-homework_submissions` và `R24-13-rollback-homework_submission_meta`: trigger SQLite cố ý làm lỗi lần ghi ở từng bảng; API trả 500, cả nội dung và metadata giữ nguyên, lần số 1 sau gỡ trigger lưu RECOVERED với 200.
- `R24-13-new-row-meta-failure`: lỗi ghi metadata cho bài mới để lại **0 dòng bài nộp và 0 dòng metadata**, không có bản ghi mồ côi; bỏ trigger rồi lưu lại thành công.
- Hồi quy sequence từng trường, cùng số từ hai tab, thứ tự ngược giữa các trường, GET/UI reload và mở lại DB đều đạt trong mô phỏng đã chỉ rõ.

Không làm đầy ổ đĩa Owner hoặc thay DB thật. Chưa thử hệ điều hành mất điện/hết dung lượng ngoài môi trường giả.

### R16: vẫn ghi đúng 15/16

`PHASE1-SCHEMA` tại [`round-16/verify-independent.mjs:212`](../round-16/verify-independent.mjs#L212) yêu cầu đúng 7 bảng, hiện có 8 vì thêm `homework_submission_meta`. Đối chứng kế thừa `R23-COMPAT-R16-schema` chạy mới trong R24 đạt: đủ bảy bảng cũ, bảng mới đúng bốn cột, học viên vẫn tách theo lớp và không đổi được chủ bài nộp. Không giấu bảng hoặc sửa assertion lịch sử. Nguyên bản vẫn **15/16, exit 1**.

## 8. Việc tiếp theo và giới hạn phán quyết

Ưu tiên sửa **R19-09 (P1)** trước, tiếp theo **R19-01 (P2)**. Hai nhóm còn lại đã đóng trong phạm vi kiểm; giữ nguyên các đối chứng đã đạt. Chỉ xem xét GO sau khi hai nhóm còn mở đạt, đủ **14/14 CLOSED_SOURCE**, đồng thời giải trình rõ các cổng lịch sử có chênh lệch hợp đồng. GO cấp mã nguồn cũng chưa thay cho nghiệm thu LMS thật.

### Prompt giao vòng sửa riêng

> Sửa đúng hai nhóm còn mở theo AUDIT-R24, không sửa hồ sơ R12–R24. R19-09: bắt buộc đúng trường/alias phản hồi, kiểm kiểu và kết quả thành công; không bỏ qua thông tin bài/điểm/quyết định/nhận xét mâu thuẫn. Chỉ dùng đối số literal/nested/$var thực sự được mutation chọn truyền vào; không dùng túi biến dư làm bằng chứng, và giữ đối chứng đủ đối số đúng. R19-01: xác thực dữ liệu ảnh VP8/VP8L bằng giải mã thật có giới hạn tài nguyên; PDF bắt đầu từ trailer Root và phân giải cả ID/generation trong cây trang. Giữ R19-06/R19-13 đã đạt, không nới bắt buộc snapshot và không bỏ giao dịch SQLite. Dùng 27 ca trượt R24 làm bằng chứng sửa; giữ riêng kết quả R20/R16 nguyên bản và ca tương thích R24. Chạy kiểm tra/build trong snapshot TEMP, giữ nguyên hash next-env.d.ts gốc, không dùng dịch vụ hoặc dữ liệu thật trong vòng sửa.

**Đã làm:** Hoàn tất kiểm toán độc lập R24, chạy đủ 13 lệnh bắt buộc và một kiểm tra bổ sung, đối chiếu 14 nhóm, bảo toàn tệp và cập nhật tài liệu kiểm toán.

**Kết quả:** **NO-GO; 12/14 CLOSED_SOURCE**, còn R19-01/R19-09; R24 **203/230**, R23 **116/116**. Build và kiểm tra kiểu đạt.

**Chưa kiểm tra:** LMS/Teaching/Gemini thật, tài khoản/bài nộp thật, schema GraphQL thực tế, Chromium/React thật, hai cửa sổ thật, khởi động lại toàn ứng dụng, sự cố ổ đĩa/mất điện thật, tải lớn hoặc nghiệm thu Owner. Bản chụp và dữ liệu giả không thay thế các phần này.

**Việc tiếp theo:** Giao vòng sửa riêng cho hai nhóm còn mở rồi kiểm toán lại trên đúng bản nguồn đã sửa. Owner không cần chạy lệnh hoặc cung cấp tài khoản cho vòng kiểm toán này.
