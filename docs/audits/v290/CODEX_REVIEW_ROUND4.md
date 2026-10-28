# v2.9.0 — Kiểm định độc lập Buổi 14, Vòng 4

Ngày kiểm định: **27/10/2026, UTC+7**. Reviewer: **Codex, vai trò Independent Code & Quality Reviewer theo yêu cầu Owner**.

**Overall Verdict: NO-GO.** Cả **8/8 verification gates PASS ngay lần chạy đầu, exit code 0**. Kiểm chứng mới đủ căn cứ đóng **11/12 phát hiện**; còn **F01 OPEN — HIGH**. **F06, F08, F09 được đóng trong vòng này**; F02–F05, F07, F10–F12 tiếp tục CLOSED.

Các ca cụ thể còn mở ở Vòng 3 đều đã được sửa. Tuy nhiên, F01 vẫn có ba biến thể cùng lỗi: hộp thoại tự đóng sau Save, đóng bằng Escape, hoặc mở lại từ bản nháp trong bộ nhớ giao diện đều có thể dẫn đến **SQLite VERIFIED dù kho lưu giả lập không được cập nhật**. Xóa nội dung DOM — các ô đang hiển thị — chưa chứng minh lần mở lại lấy dữ liệu đã lưu trên máy chủ.

Kết luận áp dụng cho **toàn bộ bản mã đang làm việc đã lấy để kiểm**, bao gồm tệp mới chưa được Git theo dõi, tại HEAD `eeb73d31d51e5915b52ebbcea377aeee5c7384c1`. Không phải kết luận chỉ dựa vào commit hoặc nội dung CHANGELOG.

## 1. Phạm vi, bản mã và bảo vệ dữ liệu

- Đọc `PROJECT_STATE.md` đầu tiên; đọc đủ ba báo cáo `CODEX_REVIEW_ROUND1.md`, `CODEX_REVIEW_ROUND2.md`, `CODEX_REVIEW_ROUND3.md` trước khi thực thi kiểm định. Đối chiếu `AGENTS.md`, kế hoạch, CHANGELOG, mã xử lý và các bài thử liên quan.
- Khi bắt đầu có **22 tệp được theo dõi bị sửa**, gồm `tsconfig.tsbuildinfo`, cùng các đường dẫn mới v280/v290. Giữ nguyên công việc có sẵn; không commit, reset hoặc đổi HEAD.
- **Trong repo chỉ thêm báo cáo Vòng 4 này.** Không sửa mã ứng dụng, bài thử, `next-env.d.ts`, ba tài liệu trạng thái hoặc các báo cáo trước.
- Chạy nguyên trạng cả tám lệnh, tuần tự trong bản sao TEMP. Không chạy các bộ thử ghi/xóa dữ liệu trên cơ sở dữ liệu thật.
- Đối chiếu SHA-256 — dấu kiểm tra nội dung tệp — của **127/127 đầu vào**: bản gốc và bản sao đều giữ nguyên sau toàn bộ kiểm tra. `next-env.d.ts` nằm trong danh sách này.
- Đối chiếu riêng **13 tệp được bảo vệ** tại repo gốc, gồm bốn tệp DB `data/mindx_bot.db`, `mindx_bot.db-wal`, `mindx_bot.db-shm`, `mindx_automation.db`, cấu hình thư mục giáo viên, `.env.local`, `tsconfig.tsbuildinfo`, ba tài liệu trạng thái và ba báo cáo trước: **không đổi byte**. Không đưa nội dung bí mật vào log.
- Không sao chép `.env`, `.env.local`, cơ sở dữ liệu thật, `playwright-auth` hoặc `teacher_browsed_dirs.json`. Chỉ dùng tên học viên giả, dữ liệu mẫu và `GEMINI_API_KEY=ROUND4_SYNTHETIC_KEY` trong tiến trình kiểm tra. Các lời gọi AI và HTTP nghiệp vụ dùng phản hồi mô phỏng.
- Dùng các thư viện đã cài qua junction `node_modules` — liên kết thư mục tới thư viện hiện có. Không cài/cập nhật thư viện. Môi trường: Windows, Node **v24.21.0**, npm **11.19.0**.
- So với manifest Vòng 3, đúng **năm đầu vào thay đổi**: bốn tệp ứng dụng trong tóm tắt sửa lỗi của Owner và `scripts/test-session14-v290.ts`. Các đầu vào còn lại giữ cùng hash với bản Vòng 3.
- Đánh giá theo quy mô ứng dụng cục bộ cho một giáo viên, có tính đến mạng chậm, gõ tiếp khi lưu, đổi lớp và phản hồi đảo thứ tự.

Thư mục bằng chứng cục bộ:

`C:\Users\QQ\AppData\Local\Temp\mindx-v290-round4-lu6e9k\`

Tám lệnh và các probe đã chạy trong `workspace\` bên trong đường dẫn này. **Đã xóa toàn bộ workspace cùng DB/dữ liệu thử trước khi kết thúc**; giữ log, JSON, manifest và bảy script tại `probes\` để đối chiếu. Không thay đổi thư mục probe Vòng 3 mà Owner cung cấp.

## 2. Verification Gate Table — đủ 8 lệnh và exit code

Đợt chạy: **11:36:06–11:38:46, ngày 27/10/2026, UTC+7**. Không cần chạy lại cổng nào; không chỉnh bài thử để làm cổng đạt.

| STT | Lệnh nguyên trạng | Kết quả | Exit code | Thời gian | Bằng chứng |
| --- | --- | --- | --- | --- | --- |
| 1 | `npx tsc --noEmit` | **PASS** | **0** | 2,237 giây | `gate-1.log`, không có chẩn đoán lỗi |
| 2 | `npx tsx scripts/test-session14-v290.ts` | **PASS** | **0** | 22,006 giây | `gate-2.log`, đủ S14-01–S14-07 |
| 3 | `npx tsx scripts/test-lms-reliability-v280.ts` | **PASS** | **0** | 82,725 giây | `gate-3.log`, đủ T280-01–T280-05 |
| 4 | `npx tsx scripts/test-spck-v270.ts` | **PASS** | **0** | 9,167 giây | `gate-4.log`, đủ T01–T16 |
| 5 | `npx tsx scripts/test-spck-v272.ts` | **PASS** | **0** | 27,009 giây | `gate-5.log`, đủ V01–V16 |
| 6 | `npx tsx scripts/test-phase5.ts` | **PASS** | **0** | 3,235 giây | `gate-6.log` |
| 7 | `npx tsx scripts/test-phase6.ts` | **PASS** | **0** | 11,088 giây | `gate-7.log` |
| 8 | `npx tsx scripts/test-phase7.ts` | **PASS** | **0** | 2,285 giây | `gate-8.log` |

`gates.json` lưu thời điểm bắt đầu/kết thúc, thời gian và exit code từng lệnh. Cảnh báo `ExperimentalWarning` ở Phase 5/6 không làm các lệnh thất bại.

**Giới hạn của các cổng:** S14-06 vẫn dùng `skipNavigation:true`. S14-07 đã bổ sung đủ `studentId`/`classId`/`slotNumber` cùng ca query-only và cached-draft; ca cache này chỉ giữ các ô DOM, chưa dựng lại bản nháp từ bộ nhớ giao diện hoặc kiểm tra hai cách đóng còn lại ở mục 4. Phần ghi chú “F07, F08 & F12” cuối bộ thử vẫn thực thi hàm chọn buổi, chưa chạy handler F07/F08. Vì vậy đã chạy lại nguyên bốn probe Vòng 3, dùng đủ định danh, `skipNavigation:false`, kho lưu tách biệt và React thật, rồi thêm các ca kiểm chứng bên dưới.

## 3. Status Table — F01 đến F12

`CLOSED` nghĩa là đã đối chiếu mã và kiểm chứng ranh giới tương ứng trên dữ liệu giả trong vòng này. Không đồng nghĩa nghiệm thu LMS/Gemini thật. `OPEN` bao gồm trường hợp ca cũ đã hết nhưng còn biến thể tái hiện cùng lỗi.

| ID | Trạng thái | Bằng chứng kiểm chứng mới |
| --- | --- | --- |
| **F01** | **OPEN** | `session14-eval-uploader.ts:429–633`: `UPLOAD-QUERY-ONLY` nay **verified=0, failed=1, opens=1**; `UPLOAD-CACHED-DRAFT` cũ nay **verified=0, failed=1, opens=2**. Các ca sai/thiếu định danh, sai host, StudentWork, JSON lỗi, primitive, `success:true`, HTTP 202/500 và GraphQL lỗi đều bị từ chối; control lưu đúng HTTP 200/201 rồi đọc kho lưu đều đạt. Nhưng ba ca mới **AUTOCLOSE-CACHED-DRAFT / ESCAPE-CACHED-DRAFT / STATE-CACHED-DRAFT** đều **verified=1, failed=0, SQLite VERIFIED, opens=2, serverSaved=false**. Chi tiết mục 4. |
| **F02** | **CLOSED** | `session14-eval-uploader.ts:644–668`: cả sáu ca `UPLOAD-TAIL-0/1/2`, `UPLOAD-TRUNCATE-0/1/2` sửa/cắt cuối riêng từng ô đều **verified=0, failed=1**. Request đủ định danh, phản hồi lưu hợp lệ và mở lại nạp kho lưu riêng, nên thực sự tới bước đối chiếu toàn văn. `UPLOAD-WHITESPACE` đạt **verified=1**. |
| **F03** | **CLOSED** | `session14-eval-uploader.ts:399–421`: `UPLOAD-SLOT-DRIFT` đổi sang buổi 13 trong lúc chọn radio bị dừng sát Save: **savedSlots=[], reqSeen=0, verified=0, failed=1**. Helper điều hướng được thay có chủ đích để ném lỗi khi buổi khác 14; không coi đây là nghiệm thu điều hướng LMS thật. |
| **F04** | **CLOSED** | `spck-demo-score-reader.ts:624–714`: `F04-AMBIGUOUS`, `F04-CONFLICT`, `F04-DUPLICATE` đều **matched=0**, trả các tab chưa khớp và **toàn bộ bản ghi cũ giữ nguyên**. Control tên duy nhất, đủ điểm nhập được qua cả bộ v290 và probe. |
| **F05** | **CLOSED** | `session14-course-summary.ts`, chốt phiên bản trước/sau AI và khi `saveDraft`: `F05-EDIT/APPROVE/VERIFY` đều **CONFLICT**, **toàn bộ bản ghi mới giữ nguyên** sau khi thả phản hồi AI đang chờ. Không hạ APPROVED/VERIFIED hoặc thay điểm/nội dung đã sửa. |
| **F06** | **CLOSED** | `sqlite.ts:4026–4106`, nơi kiểm trước duyệt: đủ bảy ca PLAIN/BOLD/BULLET/UNDERLINE/TILDE/SPLIT/NUMBERED tự cập nhật Demo **3,5**, năng lực **3,78**, rồi duyệt thành công. `F06-MISSING-LINES`, `UNPARSEABLE`, `BOLD-TAMPER` đều bị từ chối. Chín ca thêm xác nhận các tiền tố `-`, `*`, `•`, `+`, `1.`, `2)` kết hợp nhãn in đậm tách/gạch ngang đều đồng bộ; thiếu riêng Demo, thiếu riêng năng lực và dòng đánh số bị sửa thành 99 đều không vượt kiểm tra. |
| **F07** | **CLOSED** | API duyệt: thiếu version, bản đồ thiếu học viên/thiếu mục batch, null, chuỗi, 0 và số lẻ đều **HTTP 400**, không đổi bản ghi. Version cũ ở ba ca nhận **409**, không duyệt phần còn lại của batch. Batch đủ phiên bản nhận **200**, cả hai APPROVED. Ba control React xác nhận dừng khi lưu còn chờ/lưu lỗi, và lưu chữ đang hiển thị → duyệt đúng version 2 → mới upload. |
| **F08** | **CLOSED** | `final-project/page.tsx`, năm nhánh load/save/import/AI/upload: cả năm ca gõ giữ đủ **7 trường chỉnh sửa**, cả năm ca đổi lớp giữ lớp B, tải đảo thứ tự giữ v3. `F08-AI-OLDER-RECORD`, `IMPORT-OLDER-RECORD` nay giữ **v3 / OLD LETTER / VERIFIED**, không nhận `STALE V2 LETTER` hoặc ghi chú v2. Control thêm `UPLOAD-OLDER-RECORD` giữ nguyên toàn bộ bản v3, gồm hash và ghi chú. `TYPING-DURING-APPROVE` và `TYPING-DURING-FLUSH` giữ chữ mới, **WAITING_APPROVAL, contentHash=""** khi upload trả bản VERIFIED cũ. |
| **F09** | **CLOSED** | `session14-course-summary.ts:163–171` và lượt xử lý trước `generateContent`: bắt đúng prompt gửi model với học viên giả “Lê Hoài Ý”; cả **Ý/ý/Y/y** đều thành `STUDENT_SHORT_01`. Control tên trùng “An” thay trọn họ tên bạn thành `PEER_STUDENT`; tên không dấu và Unicode NFD đều được thay, không còn phần tên từng sót trong probe Vòng 2/3. |
| **F10** | **CLOSED** | `spck-demo-score-reader.ts`, kiểm đủ/đúng miền điểm trước nhập: bảng trống, thiếu B, chỉ 5/20 ô E, âm/vượt trần và NaN đều **matched=0**, toàn bộ bản ghi cũ giữ nguyên. Control năm số 0 nhập được tổng **0**; đủ B nhập **5**, đủ E nhập **2** theo dữ liệu mẫu. |
| **F11** | **CLOSED** | `session14-course-summary.ts`, chốt dữ kiện và các trường AI bắt buộc: không lịch sử, chỉ ABSENT hoặc chỉ PRESENT đều **INSUFFICIENT_INFO, 0 lời gọi AI**. Lịch sử có ghi chú thực nhận SUCCESS; phản hồi thiếu `knowledgeParagraph2` nhận ERROR. Prompt không chứa câu mặc định “Tham gia đầy đủ các hoạt động thực hành trên lớp.” |
| **F12** | **CLOSED** | Hàm chọn buổi thật trả ID rỗng khi chỉ có 14/15, chọn 13 khi có 13/14. Nguyên khối lọc trong `loadClassData` với chỉ 14/15 đặt **sessions=[], students=[], selected=""**, dừng trước khi nạp học viên. Với 13/14, chỉ giữ và chọn 13; không quay lại chọn 14. |

Tên tệp trong bảng được viết gọn; vị trí và bằng chứng đầy đủ của điểm OPEN nằm dưới đây. Các ca sai radio/điểm đọc lại (`UPLOAD-RADIO-DRIFT`, `UPLOAD-DEMO-DRIFT`) cũng đều bị từ chối, mỗi ca verified 0 / failed 1.

## 4. F01 — HIGH — Mở lại hộp thoại vẫn có thể đối chiếu bản nháp trong bộ nhớ

### Nguyên nhân và vị trí

**Vị trí chính:** `src/lib/playwright/session14-eval-uploader.ts:600–633`; bước đối chiếu ở `644–697`, đánh dấu VERIFIED ở `172–176`.

Bản sửa đã chặn rõ request có `query` không phải mutation — thao tác ghi — tại `466–477`. Ca `UPLOAD-QUERY-ONLY` cũ không còn vượt qua. Nhánh ẩn bằng CSS cũng đã được bỏ.

Tuy nhiên, việc xóa ô nhập chỉ chạy khi **dialog vẫn đang hiện và tìm được nút đóng**. Nếu Save đã tự đóng dialog hoặc code dùng Escape, các ô giữ nguyên. Với nhánh có nút đóng, `textContent`, `value`, `checked` được xóa trực tiếp trên DOM; bản nháp riêng trong bộ nhớ giao diện vẫn có thể được dùng để dựng lại những ô ấy. Code không chờ hoặc xác nhận một lần **đọc dữ liệu đánh giá từ máy chủ** khi mở lại.

Phản hồi lưu `{data:{updateStudentEvaluation:{id:"E1"}}}` vẫn được chấp nhận mà không bắt buộc mang đủ điểm và nội dung để đối chiếu. Vì vậy khi lần mở lại trả bản nháp cũ, toàn văn, radio và điểm đều có thể khớp bản duyệt dù không có dữ liệu lưu độc lập chứng minh điều đó.

### Tái hiện trên đúng uploader hiện tại

Script: `probes/round4-upload-extra.ts`, dẫn xuất từ fixture Vòng 3; **không sửa uploader**. Ba ca đều có:

- `skipNavigation:false`, đúng POST `https://lms-api.mindx.edu.vn/graphql`.
- `operationName: "UpdateStudentEvaluation"` và trường `query` bắt đầu bằng **`mutation UpdateStudentEvaluation(...)`**, không dùng đường query-only đã sửa.
- Đủ `studentId`, `classId`, `slotNumber:14`; HTTP **200**, kết quả `data.updateStudentEvaluation:{id:"E1"}`.
- Kho lưu `persisted` giữ dữ liệu **SERVER OLD / điểm 0 / radio 1**; **serverSaved=false**. Bộ nhớ bản nháp và kho lưu là hai đối tượng riêng.

| Probe | Hành vi hộp thoại được mô phỏng | Kết quả thực tế |
| --- | --- | --- |
| `UPLOAD-AUTOCLOSE-CACHED-DRAFT` | Save tự đóng dialog; mở lại giữ các ô nhập của lần trước | **opens=2, reqSeen=1, verified=1, failed=0, SQLite VERIFIED, serverSaved=false** |
| `UPLOAD-ESCAPE-CACHED-DRAFT` | Không có nút đóng; Escape đóng dialog; mở lại giữ bản nháp | **opens=2, reqSeen=1, verified=1, failed=0, SQLite VERIFIED, serverSaved=false** |
| `UPLOAD-STATE-CACHED-DRAFT` | Có nút đóng, code đã xóa DOM; mở lại nạp lại bản nháp từ bộ nhớ giao diện | **opens=2, reqSeen=1, verified=1, failed=0, SQLite VERIFIED, serverSaved=false** |

Control Vòng 3 `UPLOAD-CACHED-DRAFT` nay bị chặn vì fixture chỉ giữ DOM, không dựng lại từ bộ nhớ. `UPLOAD-SERVER-OLD` nạp đúng kho lưu cũ cũng bị chặn. Control lưu đúng rồi mở lại đọc kho lưu đạt ở HTTP **200 và 201**. Những control này xác nhận bản sửa có tác dụng trong một số cách mở/đóng, nhưng chưa tạo ranh giới đọc lại độc lập cho mọi nhánh.

**Ảnh hưởng:** vẫn có đường báo hoàn tất sai cho giáo viên; chữ, điểm và radio trong trình duyệt được dùng làm bằng chứng cho dữ liệu đã lưu dù chúng đến từ bản nháp.

**Giới hạn kết luận:** đây là lỗi chốt xác minh đã tái hiện trên DOM/HTTP giả lập. Không khẳng định LMS thật hiện dùng những cơ chế cache trên, hoặc đã làm mất dữ liệu thật. Việc kiểm định chưa quan sát hợp đồng mutation và cơ chế tải đánh giá của LMS thật.

### Cách sửa tối thiểu và kiểm tra sau sửa

Buộc bước đọc lại chứng minh được dữ liệu đánh giá đã lấy từ máy chủ cho đúng lớp/buổi/học viên: có thể chờ đúng phản hồi tải đánh giá khi mở modal, hoặc đọc đối tượng đánh giá đã lưu qua API phù hợp. Đối chiếu đủ ba phần thư, chín năng lực và năm điểm với bản duyệt. Khi không xác minh được nguồn dữ liệu đã lưu, dừng với trạng thái lỗi để giáo viên kiểm tra.

Áp dụng điều kiện này cho cả tự đóng, nút đóng và Escape. Việc xóa DOM có thể hỗ trợ fixture, nhưng chưa tự loại được state — bản nháp mà giao diện giữ riêng trong bộ nhớ.

Sau sửa, cả **ba ca mới phải verified=0** khi kho lưu vẫn cũ; giữ `QUERY-ONLY`, `CACHED-DRAFT` cũ và các ca mạng âm tính ở trạng thái bị từ chối. Control lưu đúng HTTP 200/201 rồi đọc lại kho lưu vẫn phải verified=1. Không cần thay đổi các phần đã CLOSED để xử lý F01.

## 5. Bằng chứng bổ sung và tính nguyên vẹn

Đã chạy lại **nguyên bốn script** tại `C:\Users\QQ\AppData\Local\Temp\mindx-v290-round3-UFSivc\probes\`, đặt vào `workspace/scratch/` của bản sao mới để import đúng mã hiện tại. Không dùng kết quả cũ thay cho lần chạy mới.

Tổng cộng **113 trường hợp quan sát bổ sung**, gồm control đúng và ca âm tính:

| Script giữ tại `probes/` | Số ca | Exit code | Bằng chứng |
| --- | --- | --- | --- |
| `round3-core.ts` | 46 | **0** | `round3-core.log`, `core-results.json` |
| `round3-upload.ts` | 33 | **0** | `round3-upload.log`, `upload-results.json` |
| `round3-ui.ts` | 17 | **0** | `round3-ui.log`, `ui-results.json` |
| `round3-selector.ts` | 3 | **0** | `round3-selector.log`, `selector-results.json` |
| `round4-upload-extra.ts` | 3 | **0** | `round4-upload-extra.log`, `upload-extra-results.json`; ba ca vẫn tái hiện F01 |
| `round4-ui-extra.ts` | 2 | **0** | `round4-ui-extra.log`, `ui-extra-results.json`; gõ trong lúc lưu trước duyệt và upload v2 trả sau v3 |
| `round4-score-extra.ts` | 9 | **0** | `score-extra-results.json`; chạy trực tiếp, exit 0 được công cụ thực thi ghi nhận |

**Exit 0 của probe chỉ nghĩa chương trình chạy xong và ghi được kết quả**, không có nghĩa mọi hành vi sản phẩm đạt. Ba kết quả sai được giữ nguyên ở mục 4 và JSON. `probes-exits-final.json` lưu exit các lượt chạy; không có probe nào cần sửa lỗi thực thi rồi chạy lại.

Các tệp trọng tâm, SHA-256 của bản thực kiểm:

| Tệp | SHA-256 |
| --- | --- |
| `src/app/final-project/page.tsx` | `0f3b9ad7a6e7391b8007f87e1e5c76eca1f108f2dab61ee902d6aad64dd3d84e` |
| `src/app/session-comments/page.tsx` | `ac7e9d1f780cb5568ea0c721968cb2122157599590e1684f65ce2ead45472817` |
| `src/app/api/spck/session14-eval/route.ts` | `3d057b0bd3078bddcc6861ccb095ff71ccfc2c44ed39ebc99b607afbb3a82cc7` |
| `src/lib/db/sqlite.ts` | `422d639af47b7dbacb84738cf4cfab117d1bed2913d8fe363a11773db00e02af` |
| `src/lib/gemini/session14-course-summary.ts` | `e90a0ee42368508257fd89950cb73921e07f91d1e2bd1a4124c9be7a68c0dc80` |
| `src/lib/local-files/spck-demo-score-reader.ts` | `0f4e0e3bc44b565114104dc7620f61abacb1fc205ac8a5ad069783c1b59fd56a` |
| `src/lib/playwright/session14-eval-uploader.ts` | `0be80ee4447e6af00e7f425ccdaf476647ff84913c946b9cbd610990591e8f06` |
| `scripts/test-session14-v290.ts` | `07e08d3de5afd26450a4ac349adb938491af62c4958c21e19b06189dee82748a` |
| `next-env.d.ts` | `b8b3a344484b959af5e4e3fc1a1609dac3cb9ece0cdeb6c145be29bc4c491000` |

`manifest.json`, `round3-source-delta.json`, `integrity-before-report.json` giữ danh sách 127 đầu vào, thay đổi từ Vòng 3 và kết quả đối chiếu. `integrity-final.json`, `git-before.txt`, `git-after.txt` ghi kiểm tra cuối; báo cáo này là tệp repo duy nhất được thêm trong vòng kiểm định.

**Dọn bản sao:** đã kiểm tra đường dẫn tuyệt đối thuộc đúng workspace thử, lập danh sách từng tệp/thư mục, không đi theo junction; gỡ riêng liên kết thư viện bằng thao tác không đệ quy rồi xóa các tệp và thư mục rỗng. `cleanup-result.json` xác nhận **workspaceRemoved=true**, đã xóa **137 tệp / 74 thư mục**, thư viện gốc vẫn tồn tại. Không giữ cơ sở dữ liệu thử trong thư mục bằng chứng.

## 6. Giới hạn và bước tiếp theo

- Không đăng nhập, đọc roster thật hoặc ghi LMS thật; không gọi Gemini/Google Sheets/Drive/GitHub thật. Không dùng kết quả nghiệm thu lịch sử v270/v272/v280 làm nghiệm thu mới của v290.
- Probe uploader dùng DOM/HTTP mô phỏng, một browser context trong mỗi tiến trình. Helper điều hướng được thay để kiểm tra chốt đổi buổi. Probe UI trích nguyên handler vào React/ReactDOM thật chạy Chromium; không phải nghiệm thu toàn bộ trang Next.js.
- Chưa chạy build phát hành, chưa xác nhận hợp đồng mutation, thứ tự trường/modal hoặc tải lại học bạ trên LMS thật. Tám cổng được yêu cầu đã chạy đủ; không coi các phần chưa nghiệm thu này là đã PASS.
- Log ở TEMP có thể bị hệ điều hành dọn; đầu vào và kết quả tái hiện quan trọng đã ghi trực tiếp trong báo cáo.

**Điều kiện GO:** sửa ranh giới đọc lại của **F01**, chạy lại các control và ba ca mục 4 trên đúng bản sau sửa, giữ **F01–F12 đều CLOSED và 8/8 gates PASS**. Vòng này chưa đạt điều kiện đó.

**Đã làm:** kiểm định đủ 12 phát hiện, chạy mới tám cổng và 113 ca bổ sung; chỉ thêm báo cáo và đã dọn workspace thử.

**Kết quả:** **NO-GO — 11 CLOSED / 1 OPEN (F01); 8/8 gates PASS, exit 0.**

**Chưa kiểm tra:** dịch vụ và dữ liệu thật, build phát hành, toàn bộ giao diện thật.

**Việc tiếp theo:** bên triển khai sửa F01 theo mục 4 rồi kiểm định lại; Owner không cần thao tác Terminal hoặc cung cấp tài khoản để hoàn tất vòng kiểm định này.
