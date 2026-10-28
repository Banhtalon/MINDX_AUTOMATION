# v2.9.0 — Kiểm định độc lập Buổi 14, Vòng 2

Ngày kiểm định: **27/10/2026, UTC+7**. Reviewer: **Codex, thực hiện trực tiếp vai trò Independent Code & Quality Reviewer theo chỉ định Owner**.

**KẾT LUẬN: NO-GO.** Cả **8/8 cổng kiểm tra có kết quả cuối PASS**, gồm đủ **S14-01–S14-07**. Tuy nhiên, kiểm chứng bổ sung chỉ đủ căn cứ đóng **6/12 phát hiện**. Còn **6 OPEN: F01, F06, F07, F08, F09, F10** — giữ mức độ của Vòng 1 là **5 HIGH và 1 MEDIUM**. Các bản sửa đã có tác dụng, nhưng chưa bảo vệ đầy đủ việc xác nhận lưu, duyệt đúng phiên bản, giữ nội dung đang soạn, ẩn danh và nhập điểm chấm dở.

Kết luận áp dụng cho **nội dung thư mục làm việc hiện tại, bao gồm tệp mới chưa được Git theo dõi**, tại HEAD `eeb73d31d51e5915b52ebbcea377aeee5c7384c1`. Không phải kết luận chỉ dựa vào commit hoặc lời công bố trong CHANGELOG.

## 1. Phạm vi và cách thực hiện

- Đọc `PROJECT_STATE.md` trước; đối chiếu báo cáo Vòng 1, `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, `AGENTS.md`, mã xử lý, nơi gọi và các bài thử tương ứng. Các tài liệu hiện công bố đã đóng F01–F12; báo cáo này kiểm tra lại công bố đó bằng mã và lần chạy mới.
- Khi bắt đầu có **21 tệp được theo dõi đã sửa** và các đường dẫn mới của v280/v290. Giữ nguyên công việc có sẵn; không commit, reset hoặc đổi HEAD.
- Theo giới hạn trực tiếp của Owner, **chỉ tạo báo cáo này trong repo**. Không sửa mã ứng dụng, tệp kiểm thử, ba tài liệu trạng thái hoặc báo cáo Vòng 1.
- Chạy bảy bộ thử trong bản sao TEMP vì chúng ghi/xóa dữ liệu mẫu. TypeScript chạy ở bản sao và chạy thêm trực tiếp tại repo gốc. Không chạy các bộ thử trên SQLite thật.
- Bản sao chứa mã, bài thử, cấu hình mẫu cần thiết và tệp khởi chạy; dùng junction `node_modules` tới các thư viện đã cài. Không cài/cập nhật thư viện. Đối chiếu cuối vòng xác nhận **131/131 tệp đầu vào ở bản gốc và bản thử trùng SHA-256** — dấu kiểm tra nội dung tệp.
- Không sao chép `.env`, `.env.local`, cơ sở dữ liệu thật, `playwright-auth` hoặc `teacher_browsed_dirs.json`. Chỉ dùng học viên giả, cơ sở dữ liệu mẫu và khóa AI giả. Lời gọi Gemini được thay bằng phản hồi kiểm soát; mọi HTTP của fixture uploader được chặn và trả dữ liệu giả tại máy.
- Môi trường: Windows, Node **v24.21.0**, npm **11.19.0**. Quy mô kiểm định: ứng dụng cục bộ cho một giáo viên, có mạng chậm, gõ tiếp trong khi lưu, chuyển lớp và phản hồi đảo thứ tự.

Thư mục bằng chứng:

`C:\Users\QQ\AppData\Local\Temp\mindx-v290-round2-20261027-103348\`

Thư mục thực thi: `workspace\` bên trong đường dẫn trên. Mã probe bổ sung chỉ nằm tại `workspace\scratch\`, **không nằm trong thư mục kiểm thử của repo gốc**.

## 2. Kết quả thực chạy đủ 8 cổng

Lượt chạy tuần tự bắt đầu **10:34:05**. Cổng 1–7 kết thúc **10:36:30**; cổng 8 đạt ở lần chạy lại **10:38:13**, sau khi hoàn thiện bản sao đầu vào.

| STT | Lệnh nguyên trạng | Kết quả cuối | Exit | Thời gian | Bằng chứng |
| --- | --- | --- | --- | --- | --- |
| 1 | `npx tsc --noEmit --incremental false` | **PASS** | `0` | 1,778 giây | `01-typescript.log`; không có chẩn đoán lỗi |
| 2 | `npx tsx scripts/test-session14-v290.ts` | **PASS** | `0` | 13,829 giây | Đủ **S14-01–S14-07**; `02-session14-v290.log` |
| 3 | `npx tsx scripts/test-lms-reliability-v280.ts` | **PASS** | `0` | 81,043 giây | Đủ T280-01–T280-05; `03-lms-v280.log` |
| 4 | `npx tsx scripts/test-spck-v270.ts` | **PASS** | `0` | 4,273 giây | Đủ T01–T16; `04-spck-v270.log` |
| 5 | `npx tsx scripts/test-spck-v272.ts` | **PASS** | `0` | 32,533 giây | Đủ V01–V16; `05-spck-v272.log` |
| 6 | `npx tsx scripts/test-phase5.ts` | **PASS** | `0` | 1,709 giây | `06-phase5.log` |
| 7 | `npx tsx scripts/test-phase6.ts` | **PASS** | `0` | 8,986 giây | `07-phase6.log` |
| 8 | `npx tsx scripts/test-phase7.ts` | **PASS** | `0` | 1,022 giây | `08-phase7-retry.log` |

**Ghi rõ lần chưa đạt:** lần đầu cổng 8 exit `1` sau 1,191 giây vì bản sao TEMP thiếu `start-bot.bat` và `start-bot.command`; hai tệp vẫn có ở repo gốc. Đã sao chép nguyên byte hai tệp đó, bổ sung vào đối chiếu nội dung và chạy lại **đúng lệnh, không sửa bài thử**. Kết quả PASS. Giữ cả `08-phase7.log`, `phase7-retry.json` và bản tổng hợp `gate-results-final.json`; không coi lỗi chuẩn bị bản sao này là lỗi ứng dụng.

TypeScript chạy thêm **trực tiếp tại `F:\MINDX_project test\MINDX-AUTOMATION`** lúc **10:40:46**, exit `0`, thời gian **2,037 giây**; bằng chứng `typescript-original.json` và `typescript-original.log`.

**Giới hạn của PASS:** S14-06 vẫn dùng `skipNavigation:true`, cho phép không có phản hồi mạng. S14-07 đã thêm ca hồi quy, nhưng phần cuối ghi chú “F07, F08 & F12” thực tế chỉ trích và chạy hàm chọn buổi F12 (`scripts/test-session14-v290.ts:953–980`); chưa chạy handler giao diện F07/F08. Vì vậy, PASS của bộ thử không đủ để xác nhận toàn bộ 12 phát hiện đã đóng.

## 3. Bảng đóng từng phát hiện F01–F12

`CLOSED` nghĩa là đã đối chiếu bản sửa và kiểm chứng ranh giới tương ứng trên dữ liệu giả. Không đồng nghĩa đã nghiệm thu LMS/Gemini thật. `OPEN` gồm cả trường hợp đã sửa được ca ban đầu nhưng còn cách tái hiện cùng loại lỗi.

| ID | Mức độ Vòng 1 | Trạng thái | Mã đã đối chiếu và bằng chứng chạy mới |
| --- | --- | --- | --- |
| **F01** | HIGH | **OPEN** | `session14-eval-uploader.ts:429–518, 523–530`: `GetTeacherProfile` và định danh sai khi có gửi đã bị chặn. Nhưng định danh vẫn tùy chọn, tên mutation khớp rộng, JSON lỗi có nhánh nới lỏng, kết quả không bắt buộc là đối tượng và `success:true` có thể bỏ qua `data`. Các probe `UPLOAD-MISSING-IDS`, `OTHER-MUTATION`, `PRIMITIVE`, `SUCCESS-BYPASS`, `MALFORMED-JSON`, `FOREIGN-HOST`, `HTTP-202` đều **VERIFIED=1**. Chi tiết mục 4.1. |
| **F02** | HIGH | **CLOSED** | `session14-eval-uploader.ts:533–553`: so sánh toàn văn cả ba ô sau chuẩn hóa. Sáu ca `UPLOAD-TAIL-0/1/2`, `UPLOAD-TRUNCATE-0/1/2` đổi hoặc cắt riêng cuối từng ô đều **verified=0, failed=1**; ca `UPLOAD-WHITESPACE` giữ nội dung, thay khoảng trắng đạt **verified=1**. |
| **F03** | HIGH | **CLOSED** | `session14-eval-uploader.ts:399–424`: đã kiểm tra hash, gọi `ensureCommentsSlotReady(...,14,...)`, rồi xác nhận dialog còn hiển thị trước Save. `UPLOAD-SLOT-DRIFT` chuyển slot thành 13 khi chọn radio: **savedSlots=[]**, **verified=0, failed=1**. Helper được mô phỏng để báo lỗi khi sai buổi; đây là chứng minh chốt trước Save, không phải nghiệm thu điều hướng LMS thật. |
| **F04** | HIGH | **CLOSED** | `spck-demo-score-reader.ts:561–649`: thu thập ứng viên từ B2/tên tab, kiểm tra giao nhau, gom trước theo `studentId`, loại cả hai tab trùng trước khi ghi. `F04-AMBIGUOUS`, `F04-CONFLICT`, `F04-DUPLICATE`: đều **matched=0**, trả tab chưa khớp và **giữ nguyên toàn bộ bản ghi cũ**. Ca tên duy nhất vẫn nhập được qua S14-03 và probe điểm 0. |
| **F05** | HIGH | **CLOSED** | `session14-course-summary.ts:397–420, 617–690`: chốt `initialVersion`, kiểm tra lại version/trạng thái sau AI, truyền version vào `saveDraft`, xử lý xung đột. Ba ca `F05-EDIT`, `F05-APPROVE`, `F05-VERIFY` giữ AI chờ rồi sửa/duyệt/xác minh: đều trả **CONFLICT** và giữ nguyên toàn bộ bản ghi mới; trạng thái lần lượt WAITING_APPROVAL / APPROVED / VERIFIED. |
| **F06** | HIGH | **OPEN** | `sqlite.ts:4026–4074, 4233–4239, 4405–4415`: đồng bộ và chặn lệch điểm với dòng chữ thuần đã hoạt động. Tuy nhiên, thêm in đậm `**Điểm Demo:**` làm cả đồng bộ và kiểm tra bỏ qua. `F06-FORMATTED-SCORE-DRIFT`: Demo thực **3,5**, thư vẫn ghi **5**, nhưng **APPROVED**. Chi tiết mục 4.2. |
| **F07** | HIGH | **OPEN** | Phần giao diện đã tiến bộ: chờ/dừng lưu đang chạy, báo lỗi, lưu bản đang hiển thị rồi duyệt version trả về (`page.tsx:3555–3707`). API bắt version cũ đúng **409** cho cả dạng đơn và bản đồ. Nhưng `route.ts:95–108` vẫn duyệt khi thiếu version hoặc bản đồ không có học viên đích: hai probe đều **HTTP 200, APPROVED** bản mới mà bên gọi chưa xem. Chi tiết mục 4.3. |
| **F08** | HIGH | **OPEN** | Lưu nháp riêng đã giữ chữ gõ thêm và giữ dữ liệu lớp B trong hai control. Nhưng tải danh sách/soạn AI/nhập điểm vẫn thay cả danh sách; so sánh `selectedClassId` trong hàm đang chờ đọc giá trị của lần dựng giao diện cũ. Probe chạy **React thật trong Chromium** tái hiện lớp đang chọn B nhưng danh sách A, mất chữ đang gõ khi AI/nhập điểm trả về, và version bị kéo **3 → 2** khi tải đảo thứ tự. Chi tiết mục 4.4. |
| **F09** | HIGH | **OPEN** | `session14-course-summary.ts:163–251, 563–574`: đã xử lý tên thường gặp, không dấu, Unicode và quét lại prompt. Các control cơ bản đạt. Nhưng tên một ký tự “Ý” vẫn đi ra, và thay tên đơn của học viên trước tên đầy đủ bạn cùng lớp làm sót “Trần Hoài” / “Tran Hoai”. Đã bắt **đúng chuỗi truyền vào `generateContent`**, không chỉ kiểm tra hàm phụ. Chi tiết mục 4.5. |
| **F10** | MEDIUM | **OPEN** | `spck-demo-score-reader.ts:170–182, 209–275, 628–630`: bảng trống/thiếu cả một tiêu chí đã bị chặn, điểm 0 thật được giữ. Nhưng `hasAnyNumeric` coi mỗi nhóm có một ô là đủ: chỉ chấm **5/20 ô E** vẫn nhập tổng **0,5**. Bộ có điểm âm/vượt trần cũng được nhập sau tự ép về giới hạn, thay vì từ chối. Chi tiết mục 4.6. |
| **F11** | MEDIUM | **CLOSED** | `session14-course-summary.ts:284–332, 593–614`: `hasHistory` phụ thuộc nội dung thực; bỏ câu suy diễn mặc định, bắt buộc `knowledgeParagraph2`. `F11-EMPTY` và `F11-ABSENT`: **INSUFFICIENT_INFO, 0 lời gọi AI**; `SUBSTANTIVE`: **SUCCESS**; `MISSING-K2`: **ERROR**. Không có câu mặc định “Tham gia đầy đủ...” trong prompt đã bắt. |
| **F12** | MEDIUM | **CLOSED** | `session-comments/page.tsx:187–213, 346–364`: không quay về danh sách chưa lọc. Hàm thật trả ID rỗng với chỉ buổi 14 hoặc 15; danh sách 13/14 chọn 13. Khối lọc thật trong `loadClassData`, khi chỉ có 14, đặt danh sách buổi/học viên rỗng và xóa ID 14 trước khi nạp học viên. |

Tên tệp ở bảng được viết ngắn để dễ đọc; đường dẫn đầy đủ cho từng điểm còn mở nằm dưới đây. Sáu điểm CLOSED không bị mở lại chỉ vì chưa dùng dịch vụ thật; giới hạn nghiệm thu được ghi riêng ở mục 6.

## 4. Sáu phát hiện còn mở và hướng sửa tối thiểu

### 4.1. F01 — HIGH — Vẫn có thể xác nhận lưu từ phản hồi không chứng minh đánh giá đã được lưu

**Nguyên nhân:** `saveMutationPattern` vẫn khớp cả thao tác khác như `UpdateStudentWork`. Kiểm tra `studentId`, `classId`, `slotNumber` chỉ chạy **nếu có trường đó**. URL dùng `includes`, JSON yêu cầu lỗi lại rơi về tìm chuỗi. Kết quả lưu chỉ cần khác `null`/`undefined`/`false`, không cần là đối tượng; `bodyJson.success === true` bỏ qua yêu cầu có kết quả lưu trong `data`. Mã chấp nhận toàn bộ HTTP 2xx. Nếu dialog vẫn mở, dữ liệu “đọc lại” là chính các ô vừa điền, chưa buộc tải lại từ máy chủ.

**Vị trí:** `src/lib/playwright/session14-eval-uploader.ts:429–475`, `487–518`, `523–530`.

**Tái hiện mới:** mọi ca dùng `customPage` nhưng **`skipNavigation:false`**, chạy mã uploader và SQLite hiện tại; HTTP hoàn toàn giả lập tại máy.

| Probe | Đầu vào đáng chú ý | Kết quả thực tế |
| --- | --- | --- |
| `UPLOAD-UNRELATED` | POST `GetTeacherProfile`, HTTP 200 | Đã sửa đúng: verified `0`, failed `1` |
| `UPLOAD-WRONG-STUDENT/CLASS/SLOT` | Có định danh nhưng sai | Đã sửa đúng: mỗi ca verified `0` |
| `UPLOAD-MISSING-IDS` | `UpdateStudentEvaluation`, `variables:{}` | **verified `1`, SQLite VERIFIED** |
| `UPLOAD-OTHER-MUTATION` | `UpdateStudentWork`, `data.updateStudentWork:{id:"WORK1"}` | **verified `1`, SQLite VERIFIED** |
| `UPLOAD-PRIMITIVE` | `data.updateStudentEvaluation:123` | **verified `1`, SQLite VERIFIED** |
| `UPLOAD-SUCCESS-BYPASS` | `data:{}, success:true` | **verified `1`, SQLite VERIFIED** |
| `UPLOAD-MALFORMED-JSON` | Request body `UpdateStudentEvaluation broken JSON` | **verified `1`, SQLite VERIFIED** |
| `UPLOAD-FOREIGN-HOST` | POST tới `https://example.invalid/graphql` | **verified `1`, SQLite VERIFIED** |
| `UPLOAD-HTTP-202` | Phản hồi HTTP 202 | **verified `1`, SQLite VERIFIED** |
| `UPLOAD-HTTP-500` | Phản hồi lưu HTTP 500 | Đã chặn: verified `0`, failed `1`, Save đúng một lần |

Fixture không lưu dữ liệu đánh giá vào kho máy chủ; cờ kiểm soát `serverSaved=false` vẫn giữ nguyên. Việc các ca thiếu/sai bằng chứng vẫn thành VERIFIED cho thấy phần đọc chính ô đang sửa chưa tạo được bằng chứng độc lập về dữ liệu đã lưu.

**Ảnh hưởng:** tiếp tục có thông báo hoàn tất sai, hoặc một thao tác SPCK khác bị nhận là lưu đánh giá cuối khóa.

**Cách sửa:** xác định chính xác mutation lưu đánh giá và cấu trúc request/response từ bằng chứng LMS; đối chiếu hostname chuẩn, phương thức được phép và đủ định danh. Request không đọc được phải loại. Chỉ nhận HTTP 200/201 cùng đối tượng kết quả của đúng thao tác; bỏ đường tắt `success:true`. Sau đó bắt buộc lấy lại dữ liệu đã lưu rồi mới đối chiếu và đặt VERIFIED.

**Sau khi sửa:** tất cả ca âm tính trên phải thất bại; thêm control lưu đúng và đọc lại từ kho dữ liệu giả độc lập, cùng ca máy chủ giữ bản cũ dù ô nhập vẫn chứa bản mới.

### 4.2. F06 — HIGH — Định dạng in đậm khiến thư lệch điểm vẫn được duyệt

**Nguyên nhân:** hai hàm đồng bộ/kiểm tra chỉ nhận dòng bắt đầu bằng `Điểm Demo:` hoặc `Điểm Năng lực:` thuần chữ. Dòng không khớp biểu thức kiểm tra được coi là không có vấn đề, thay vì yêu cầu xác minh điểm. Đây là văn bản giáo viên có thể sửa trong textarea; uploader cũng có xử lý dấu `**` khi chuyển nội dung sang ô thư.

**Vị trí:** `src/lib/db/sqlite.ts:4026–4074`, nơi gọi tại `4233–4239`, `4405–4415`.

**Tái hiện:** tạo thư hợp lệ, chỉ đổi nhãn thành `**Điểm Demo:**` và `**Điểm Năng lực:**`, rồi thay thuật toán từ 1,5 xuống 0 bằng `saveDraft`, không gửi lại thư. Kết quả `F06-FORMATTED-SCORE-DRIFT`:

```text
demoTotalScore = 3.5
learnedFromMindx chứa: **Điểm Demo:** 5 điểm
approveDraft.success = true
status = APPROVED
```

Các control xác nhận bản sửa có tác dụng với dòng thuần chữ: đổi Demo xuống 4 và năng lực xuống 3,78 thì thư tự đồng bộ đúng cả hai; sửa trực tiếp dòng thuần thành Demo 99 trong SQLite mẫu bị từ chối duyệt.

**Ảnh hưởng:** điểm hiển thị ở các ô số có thể khác điểm trong thư gửi phụ huynh, dù bản duyệt có hash hợp lệ.

**Cách sửa:** nhận diện nhãn điểm sau chuẩn hóa định dạng được hỗ trợ; đồng bộ và kiểm tra phải dùng chung cách nhận diện. Nếu không đọc được hai dòng điểm bắt buộc, trả lỗi rõ, không mặc nhiên coi là khớp.

**Sau khi sửa:** chạy lại thư chữ thuần và in đậm, thay riêng Demo/năng lực sau tạo thư; không cho duyệt khi còn điểm cũ hoặc dòng điểm không thể xác minh.

### 4.3. F07 — HIGH — API duyệt vẫn cho phép bỏ qua khóa phiên bản

**Phần đã đạt:** handler giao diện chạy trong React thật đã chứng minh:

- `F07-PENDING-SAVE`: lưu còn chờ quá ngưỡng thì dừng, chỉ có `save_draft`, không gọi approve/upload.
- `F07-PENDING-FAIL`: lưu trả HTTP 500 trong lúc nút đang chờ thì báo lỗi và dừng, không approve/upload.
- `F07-FLUSH-AND-APPROVE`: lưu bản đang hiển thị → nhận `draftVersion=2` → duyệt với `expectedVersions.S1=2` → mới gọi upload.
- API trả **409** với phiên bản cũ ở cả `expectedVersion` và `expectedVersions[studentId]`.

**Nguyên nhân phần còn lỗi:** API biến version thiếu/không hợp lệ thành `undefined`, rồi gọi `approveDraft`. Hàm này chỉ đối chiếu khi tham số version tồn tại. Bản đồ thiếu học viên đích cũng có cùng đường đi. Vì vậy, khóa phiên bản vẫn là lựa chọn của bên gọi, chưa phải điều kiện bắt buộc như yêu cầu sửa của Vòng 1.

**Vị trí:** `src/app/api/spck/session14-eval/route.ts:95–108`; điều kiện ở `src/lib/db/sqlite.ts:4364–4375`.

**Tái hiện độc lập, không phụ thuộc lỗi định dạng F06:** tạo bản giáo viên đã xem ở version 2, sau đó đổi Future thành `NEW UNREVIEWED FUTURE`, version 3. Gọi API thật trong tiến trình kiểm thử:

| Probe | Kết quả |
| --- | --- |
| `F07-STALE-SCALAR` | HTTP **409**, không duyệt |
| `F07-STALE-MAP` | HTTP **409**, không duyệt |
| `F07-MISSING-VERSION` | HTTP **200**, duyệt version **3**, Future mới chưa được bên gọi xem |
| `F07-MAP-MISSING-STUDENT` | HTTP **200**, duyệt version **3** dù bản đồ không có học viên đích |

**Ảnh hưởng:** lời gọi thiếu version vẫn có thể chốt một bản khác với bản bên gọi đang dựa vào. Không quy kết ca nút bấm giao diện đã kiểm là vẫn gửi bản cũ; phần giao diện đó đã đạt các probe nêu trên.

**Cách sửa:** kiểm tra trước toàn bộ danh sách duyệt; mỗi học viên phải có version hợp lệ. Thiếu/sai kiểu/thiếu mục trong bản đồ phải bị từ chối trước khi đổi trạng thái. Chỉ truyền version đã kiểm tra vào thao tác duyệt.

**Sau khi sửa:** giữ các control UI hiện đã đạt; cả hai ca thiếu version phải nhận HTTP 400/409 và không có học viên nào bị duyệt ngoài bản được xác định.

### 4.4. F08 — HIGH — Giao diện vẫn mất chữ và trộn lớp ở các nhánh chưa được bảo vệ

**Nguyên nhân:** nhánh lưu nháp riêng dùng `snapshotBeforeSend` và cập nhật theo bản ghi nên đã giữ được chữ mới trong control. Tuy nhiên, `loadSession14Evals`, nhập điểm, tạo thư AI và kết quả upload còn đặt lại toàn bộ danh sách. Kiểm tra `selectedClassId` trong hàm async chỉ đọc giá trị được giữ từ lần dựng giao diện khi yêu cầu bắt đầu; khi người dùng đổi lớp, hàm cũ không tự nhận giá trị lớp mới. Chưa có chốt thứ tự/version cho tải danh sách.

**Vị trí:** `src/app/final-project/page.tsx:3270–3292`, `3457–3470`, `3523–3536`, `3714–3720`. Phần lưu nháp đã cải thiện nằm tại `3300–3439`.

**Cách kiểm chứng:** trích nguyên handler hiện tại, giữ chúng bên trong một component dùng **React/ReactDOM thật đã cài trong dự án**, đóng gói vào Chromium, điều khiển phản hồi fetch. Đổi lớp dùng `setState` và đợi dựng lại giao diện; không sửa một biến toàn cục để giả lập lớp mới. Vì vậy probe giữ đúng cách hàm async nhớ trạng thái của React.

| Probe | Kết quả thực tế |
| --- | --- |
| `F08-SAVE-TYPING` | Đã đạt: giữ `NEW UNSAVED LETTER` và `NEW UNSAVED FUTURE`, nhận version 2 |
| `F08-SAVE-CLASS-SWITCH` | Đã đạt: vẫn hiển thị lớp B |
| `F08-LOAD-CLASS-SWITCH` | Chọn **CLASS-B**, nhưng phản hồi tải A đặt bản ghi **CLASS-A** vào danh sách |
| `F08-AI-TYPING` | Chữ đang gõ `NEW UNSAVED LETTER` bị thay bằng `OLD LETTER` |
| `F08-IMPORT-TYPING` | Chữ đang gõ `NEW UNSAVED LETTER` bị thay bằng `OLD LETTER` |
| `F08-LOAD-ORDER` | Phản hồi version 3 đã áp dụng; phản hồi cũ trả sau kéo lại **version 2 / OLD LETTER** |

**Ảnh hưởng:** mất nội dung chưa lưu, nhìn nhầm dữ liệu lớp và quay lại phiên bản cũ. Việc F05 giữ đúng dữ liệu ở máy chủ chưa bảo vệ được phần chữ giáo viên vừa gõ nhưng chưa gửi đi.

**Cách sửa:** dùng giá trị lớp hiện tại có thể đọc sau khi chờ, hoặc hủy/bỏ phản hồi của yêu cầu cũ khi lớp đổi; thêm thứ tự yêu cầu. Dùng cùng quy tắc giữ trường đang sửa và không kéo lùi version cho tất cả nhánh thay danh sách, gồm tải/nhập điểm/AI/upload.

**Sau khi sửa:** chạy lại đủ sáu ca, đặc biệt trên React thật; lớp B luôn giữ danh sách B, chữ vừa gõ không mất và version không giảm.

### 4.5. F09 — HIGH — Quét lại prompt chưa loại hết tên học viên

**Nguyên nhân:** `replaceWholeNamePhrase` bỏ qua chuỗi có độ dài dưới 2, nên tên một ký tự hợp lệ như “Ý” không được thay. Ngoài ra, tên đơn của học viên được thay trước họ tên bạn cùng lớp; khi cùng tên “An”, họ tên bạn bị cắt thành `Trần Hoài STUDENT_SHORT_01`, nên lượt thay đầy đủ và lượt quét cuối không còn nhận ra phần họ tên còn lại.

**Vị trí:** `src/lib/gemini/session14-course-summary.ts:163–170`, `208–249`, `563–574`.

**Tái hiện ở đúng đầu vào Gemini mô phỏng:**

```text
F09-OUTBOUND-SHARED-GIVEN
Học viên: Nguyễn Minh An; bạn cùng lớp: Trần Hoài An
Ghi chú gửi đi:
STUDENT_SHORT_01 phối hợp với Trần Hoài STUDENT_SHORT_01
và Tran Hoai STUDENT_SHORT_01.

F09-OUTBOUND-ONE-CHAR
Học viên: Lê Hoài Ý
Ghi chú gửi đi:
Ý chủ động thực hành, cần tự tin hơn.
```

Cả hai ca generator trả SUCCESS và prompt đã đi tới `model.generateContent`. Đây là tên giả trong probe. Các control họ tên/tên gọi/tên đơn thường gặp, không dấu, bạn cùng lớp không trùng tên và Unicode NFD đã đạt.

**Ảnh hưởng:** vẫn chưa đáp ứng bảo vệ tên trước khi gửi dịch vụ AI; một phần tên bạn còn có thể bị gán nhầm token của học viên chính.

**Cách sửa:** thu thập biến thể của cả lớp rồi ưu tiên thay cụm dài trước cụm ngắn trên cùng đầu vào; xử lý tên một ký tự bằng ranh giới chữ phù hợp. Kiểm tra cuối phải tìm được tên còn sót, không chỉ gọi lại một phép thay đã bỏ lỡ chúng.

**Sau khi sửa:** bắt lại payload thực cho tên một ký tự, học viên/bạn cùng tên gọi, tên không dấu và Unicode; không còn tên thật hoặc phần tên bị bỏ lại do thay sai thứ tự.

### 4.6. F10 — MEDIUM — Có điểm trong mỗi nhóm chưa chứng minh bảng đã chấm đủ và hợp lệ

**Phần đã đạt:** `F10-BLANK` và `F10-PARTIAL` (thiếu cả một tiêu chí tổng hợp) đều matched `0`, giữ nguyên bản ghi cũ. `F10-ZERO` có 5 số 0 nhập rõ ràng được giữ đúng Demo `0`; năng lực gợi ý **2,44**, không còn mặc định tất cả 4/5.

**Nguyên nhân phần còn lỗi:** `sumCellRange` chỉ cần **bất kỳ một ô số** trong một nhóm E là có điểm. `hasCompleteScores` chỉ đếm đủ năm cờ như vậy, không kiểm tra đủ các dòng đang dùng để tính tiêu chí. Điểm âm/vượt trần được đếm là có điểm rồi chuyển sang `parseSession14DemoScores`, nơi tự ép về 0 hoặc trần.

**Vị trí:** `src/lib/local-files/spck-demo-score-reader.ts:170–182`, `209–275`, `628–630`; bước ép số tại `src/lib/db/sqlite.ts:3998–4013`.

**Tái hiện:**

- `F10-PARTIAL-E`: chỉ có E8, E14, E18, E20, E23, mỗi ô 0,1; **15/20 ô còn lại của E8:E27 trống**, không có điểm tổng hợp. Vẫn matched **1**, nhập năm tiêu chí 0,1, tổng **0,5** và cập nhật bản ghi.
- `F10-INVALID-RANGE`: B32..B36 lần lượt `[-1,100,100,100,100]`. Vẫn matched **1**, biến thành thuật toán 0, máy tính 1, sáng tạo 1, giải quyết vấn đề 1, giao tiếp 0,5, tổng **3,5**.

**Ảnh hưởng:** bảng chấm dở hoặc gõ sai số vẫn thay điểm cũ bằng một kết quả nhìn có vẻ hợp lệ. Kiểm tra đủ năm cờ chưa đáp ứng đủ năm tiêu chí **có điểm hợp lệ**.

**Cách sửa:** phân biệt rõ nguồn điểm tổng hợp đã nhập hợp lệ với nguồn tính từ E. Nếu dùng nhóm E để tính thì phải đủ các ô cần chấm của nhóm; thiếu phải từ chối nhập. Kiểm tra hữu hạn, không âm và đúng trần trước khi chuẩn hóa; số không hợp lệ không được tự sửa thành một điểm khác rồi ghi đè.

**Sau khi sửa:** giữ các ca trống/thiếu/0 thật đã đạt; hai ca trên phải matched `0` và giữ nguyên toàn bộ điểm/nhận xét cũ.

## 5. Bằng chứng bổ sung và dấu bản mã

Các probe cuối đã hoàn tất với exit **0**. Exit 0 của probe nghĩa là chương trình kiểm chứng chạy xong và ghi được kết quả quan sát; **không có nghĩa mọi hành vi ứng dụng đạt yêu cầu**.

| Chương trình tại TEMP | Phạm vi | Bằng chứng kết quả |
| --- | --- | --- |
| `workspace/scratch/round2-probes.ts` | 45 ca cho nhập điểm, đồng bộ thư, xung đột AI, ẩn danh, dữ kiện lịch sử và uploader; gọi mã hiện tại | `round2-probes-final.log`, `round2-probes.json` |
| `workspace/scratch/round2-ui-probes.ts` | 14 ca; handler thật trong React/Chromium, cộng hàm chọn buổi và khối lọc dữ liệu thật | `round2-ui-probes-final.log`, `round2-ui-probes.json` |
| `workspace/scratch/round2-approval-probe.ts` | 4 ca API duyệt: version cũ/thiếu, dạng đơn/bản đồ; thư chữ thuần hợp lệ | `round2-approval-probe.log`, `round2-approval-probe.json` |
| `workspace/scratch/evidence-summary.mjs` | Tổng hợp 8 cổng, kiểm tra 131 đầu vào và hash báo cáo | `gate-results-final.json`, `source-manifest.json`, `integrity-final.json` |

Tổng cộng **63 trường hợp quan sát**, gồm cả control đúng và ca tái hiện lỗi. Trong lúc chuẩn bị probe đã sửa lỗi riêng của fixture: hàm trợ giúp `__name` do trình biên dịch tạo và cách lấy văn bản để giữ khoảng cách giữa các đoạn. Chỉ sửa script tại TEMP, sau đó chạy lại các script liên quan đến khi exit 0. Không dùng các lỗi chuẩn bị này làm phát hiện ứng dụng. Các log lần đầu vẫn được giữ để đối chiếu.

Các tệp trọng tâm, SHA-256 của bản thực kiểm:

| Tệp | SHA-256 |
| --- | --- |
| `src/app/final-project/page.tsx` | `f361e6ece03b96fb0e29583938e37443a4a50073cea2d9df380396b139db746f` |
| `src/app/session-comments/page.tsx` | `ac7e9d1f780cb5568ea0c721968cb2122157599590e1684f65ce2ead45472817` |
| `src/app/api/spck/session14-eval/route.ts` | `2cb645e08a63641d8a2254c7a609920bdecc3e22b999a35fc27d8b8e2676ba01` |
| `src/lib/db/sqlite.ts` | `4164c6e3fc39a8eb82a059aebe8a41a7debaded391938684e861d9f3098f9d57` |
| `src/lib/gemini/session14-course-summary.ts` | `c8c1ce49216aeb35383bdc1ac0d1e90c66c050e0db6642b5e17691c41a6fe222` |
| `src/lib/local-files/spck-demo-score-reader.ts` | `1c0c41928948eaeb3b08a433f5b7332a1077b77ef4cfb08b8ccb33748030ae91` |
| `src/lib/playwright/session14-eval-uploader.ts` | `7d102832071f839d411bd0b1482c08bcdb9cd80ae752cb41776d6f2c3b5e7ad0` |
| `scripts/test-session14-v290.ts` | `21931881e1e2bceaeec923099e36b45e201daad5c7a14fdf85c2c3f04b0404c6` |

`source-integrity.json` và `source-manifest.json` lưu đối chiếu 131 tệp; `integrity-final.json` lưu kiểm tra lại và hash báo cáo. `git-before.txt` / `git-after.txt` giữ trạng thái Git. Bằng chứng TEMP có thể bị hệ điều hành dọn; các kết quả, đầu vào quan trọng, vị trí mã và hướng sửa đã được ghi trực tiếp trong báo cáo này.

## 6. Giới hạn và điều kiện kiểm định lại

- Không đăng nhập, đọc danh sách lớp thật hoặc ghi lên LMS thật; không gọi Gemini/Google Sheets/Drive/GitHub thật. Không dùng nghiệm thu lịch sử của v270/v272/v280 để suy ra nghiệm thu mới của v290.
- Các probe uploader chứng minh chốt xử lý bằng DOM/HTTP giả lập. Helper kiểm tra slot được thay thế có chủ đích để cô lập tình huống đổi buổi. Việc F03 CLOSED chỉ áp dụng cho chốt đã kiểm, chưa xác nhận LMS thật giữ/hủy dialog thế nào khi đổi slot.
- Probe UI chạy handler trích nguyên trạng với React thật, không phải mở toàn bộ trang Next.js và thao tác trên dữ liệu giáo viên thật. Điều này đủ chứng minh các lỗi trạng thái đã tái hiện, chưa phải nghiệm thu toàn bộ giao diện.
- Chưa chạy build phát hành, chưa nghiệm thu ảnh, thư và điểm trên một học bạ thật sau tải lại. Đây không phải các cổng Owner yêu cầu trong vòng này.

Trước vòng tiếp theo cần sửa **F01, F06, F07, F08, F09, F10**, bổ sung ca hồi quy thực chất cho các đầu vào cụ thể ở mục 4, rồi chạy lại tám cổng trên đúng bản sau sửa. Với F01 cần bằng chứng về mutation và dữ liệu lưu thực, không đóng lỗi chỉ bằng đổi tên mẫu trong fixture. Giữ các ca CLOSED làm kiểm tra chống tái phát.

**Đã làm:** hoàn thành kiểm định lại 12 phát hiện, 8 cổng và các probe độc lập; chỉ ghi báo cáo.

**Kết quả:** **NO-GO — 6 CLOSED / 6 OPEN; 8/8 cổng có kết quả cuối PASS.**

**Chưa kiểm tra:** nghiệm thu trên LMS/Gemini và dữ liệu thật, build phát hành, toàn bộ trang giao diện thật.

**Việc tiếp theo:** chuyển sáu điểm OPEN cho bên sửa, sau đó kiểm định lại. Owner không cần thao tác Terminal hoặc cung cấp tài khoản để hoàn thành vòng này.
