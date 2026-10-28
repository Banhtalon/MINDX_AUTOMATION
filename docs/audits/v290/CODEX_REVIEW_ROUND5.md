# v2.9.0 — Round 5 Final Verification Audit — Buổi 14

Ngày kiểm định: **27/10/2026, UTC+7**. Reviewer: **Codex, thực hiện trực tiếp vai trò Independent Code & Quality Reviewer theo yêu cầu Owner**.

**Overall Verdict: NO-GO.** Đã chạy mới đủ **8/8 verification gates: PASS, exit 0** và **119 trường hợp quan sát bổ sung**. **F02–F12 CLOSED; F01 vẫn OPEN (HIGH)**. Ba ca cache của Round 4 đã bị chặn, nhưng bản sửa chưa chứng minh được dữ liệu đọc lại đến từ máy chủ: khi bản nháp nằm trong bộ nhớ riêng của giao diện, cả ba cách đóng/mở vẫn cho **VERIFIED dù kho lưu giữ nguyên bản cũ**.

Kết luận áp dụng cho toàn bộ bản mã trong thư mục làm việc đã chụp để kiểm tra, bao gồm các tệp chưa được Git theo dõi, tại HEAD **`eeb73d31d51e5915b52ebbcea377aeee5c7384c1`**. Không dùng kết quả PASS của vòng cũ thay cho lần chạy mới.

## 1. Phạm vi và bảo vệ dữ liệu

- Đọc `PROJECT_STATE.md` đầu tiên; đọc cả bốn báo cáo `CODEX_REVIEW_ROUND1.md` đến `CODEX_REVIEW_ROUND4.md` trước khi chạy kiểm định. Đối chiếu `AGENTS.md`, `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, mã xử lý, nơi gọi và bài thử.
- Khi bắt đầu đã có **22 tệp được theo dõi bị sửa**, cùng các đường dẫn mới của v280/v290. Giữ nguyên các thay đổi có sẵn, không commit/reset/đổi HEAD.
- **Trong repo chỉ thêm báo cáo này.** Không sửa mã ứng dụng, bài thử, `next-env.d.ts`, ba tài liệu trạng thái hoặc bốn báo cáo trước.
- Chạy tuần tự cả tám lệnh nguyên trạng trong bản sao TEMP vì các bộ thử ghi/xóa dữ liệu mẫu. Bản sao chứa **128 tệp đầu vào**; đã kiểm tra không thiếu tệp `.ts`/`.tsx`/`.json` nào trong `src/` và `scripts/` so với danh sách chụp.
- Trước và sau toàn bộ gates/probes, **128/128 tệp gốc và 128/128 tệp đầu vào bản sao giữ nguyên SHA-256** — dấu kiểm tra nội dung. `next-env.d.ts` nằm trong danh sách này. Các tệp `data/mindx_bot.db`, `mindx_bot.db-wal`, `mindx_bot.db-shm`, `mindx_automation.db` và `tsconfig.tsbuildinfo` của repo gốc cũng giữ nguyên byte.
- Không sao chép `.env`, `.env.local`, cơ sở dữ liệu thật, `playwright-auth` hoặc `teacher_browsed_dirs.json`. Dùng tên học viên giả và **`GEMINI_API_KEY=ROUND5_SYNTHETIC_KEY`** trong tiến trình thử; AI và HTTP nghiệp vụ được mô phỏng.
- Dùng thư viện đã cài qua junction `node_modules` — liên kết tới thư viện hiện có. Không cài/cập nhật thư viện. Môi trường đã kiểm tra: Windows, Node **v24.21.0**, npm **11.19.0**.
- So với manifest Round 4, đúng **hai đầu vào thay đổi**: `src/lib/playwright/session14-eval-uploader.ts` và `scripts/test-session14-v290.ts`. Các đầu vào còn lại trong manifest cũ giữ nguyên hash.
- Đã chạy lại nguyên byte cả **bảy script Round 3/4** tại đường dẫn Owner cung cấp. Chỉ thêm probe độc lập ở TEMP, không sửa các probe cũ hoặc nguồn ứng dụng để tạo kết quả.

Thư mục bằng chứng cục bộ:

`C:\Users\QQ\AppData\Local\Temp\mindx-v290-round5-6z0KJG\`

Các lệnh chạy trong `workspace\` bên trong đường dẫn này. **Đã xóa toàn bộ workspace và cơ sở dữ liệu thử trước khi kết thúc**, giữ log, JSON, manifest và tám script tại `probes\`. Giữ nguyên thư mục probe Round 4 của Owner.

## 2. Verification Gate Table — đủ tám lệnh và exit code

Đợt chạy **11:53:23–11:55:58 ngày 27/10/2026, UTC+7**. Mỗi lệnh chạy một lần, không sửa bài thử hoặc chạy lại cổng để thay kết quả.

| STT | Lệnh nguyên trạng | Kết quả | Exit code | Thời gian | Bằng chứng |
| --- | --- | --- | --- | --- | --- |
| 1 | `npx tsc --noEmit` | **PASS** | **0** | 2,257 giây | `gate-1.log`, không có chẩn đoán lỗi |
| 2 | `npx tsx scripts/test-session14-v290.ts` | **PASS** | **0** | 27,210 giây | `gate-2.log`, đủ S14-01–S14-07 |
| 3 | `npx tsx scripts/test-lms-reliability-v280.ts` | **PASS** | **0** | 81,467 giây | `gate-3.log`, đủ T280-01–T280-05 |
| 4 | `npx tsx scripts/test-spck-v270.ts` | **PASS** | **0** | 6,769 giây | `gate-4.log`, đủ T01–T16 |
| 5 | `npx tsx scripts/test-spck-v272.ts` | **PASS** | **0** | 24,516 giây | `gate-5.log`, đủ V01–V16 |
| 6 | `npx tsx scripts/test-phase5.ts` | **PASS** | **0** | 2,316 giây | `gate-6.log` |
| 7 | `npx tsx scripts/test-phase6.ts` | **PASS** | **0** | 9,109 giây | `gate-7.log` |
| 8 | `npx tsx scripts/test-phase7.ts` | **PASS** | **0** | 1,563 giây | `gate-8.log` |

`gates.json` ghi thời điểm bắt đầu/kết thúc, thời gian, exit code và log từng lệnh.

**Đánh giá thay đổi bài thử:** S14-06 nay dùng `skipNavigation:false`, có POST GraphQL đúng định danh và mở lại từ kho `window.persisted`; đã cải thiện so với Round 4. S14-07 thêm ba nhánh auto-close/Escape/state-cache và đều PASS. Tuy nhiên, các fixture này đặt kho lưu và cache trên `window`; mã mới cũng xóa/dò chính các thuộc tính của `window`. Chúng chưa kiểm tra trường hợp state nằm trong bộ nhớ riêng của thành phần giao diện. Mục cuối mang tên “F07, F08 & F12” vẫn chỉ thực thi hàm chọn buổi; đã dùng probe React riêng để kiểm tra F07/F08.

## 3. Status Table — F01 đến F12

`CLOSED` là đủ bằng chứng cho ranh giới lỗi tương ứng trên dữ liệu giả trong vòng này, không đồng nghĩa nghiệm thu LMS/Gemini thật. `OPEN` bao gồm trường hợp ca cũ đã hết nhưng còn biến thể tái hiện cùng lỗi. Vị trí mã theo bản Round 5.

| ID | Trạng thái | Bằng chứng kiểm chứng mới |
| --- | --- | --- |
| **F01** | **OPEN** | `session14-eval-uploader.ts:300–304, 605–650, 718–756`: các ca mạng sai/thiếu định danh, query-only, cached-draft cũ và cả ba ca Round 4 đều bị chặn. Control lưu đúng HTTP 200/201 rồi mở lại kho lưu đều đạt. Nhưng **UPLOAD-CLOSURE-BUTTON / AUTOCLOSE / ESCAPE** đều **verified=1, failed=0, SQLite VERIFIED, opens=2, reqSeen=1, serverSaved=false**; ba ô thư, năm điểm và chín rating của kho lưu vẫn là bản cũ. Chi tiết mục 4. |
| **F02** | **CLOSED** | `session14-eval-uploader.ts:663–684`: đủ sáu ca `UPLOAD-TAIL-0/1/2`, `UPLOAD-TRUNCATE-0/1/2` đổi/cắt cuối từng ô đều **verified=0, failed=1**, lỗi tại đối chiếu toàn văn DOM. Request đủ định danh và mở lại nạp kho lưu riêng, nên các ca thực sự tới bước so chữ. `UPLOAD-WHITESPACE` đạt **verified=1**. |
| **F03** | **CLOSED** | `session14-eval-uploader.ts:403–425`: `UPLOAD-SLOT-DRIFT` đổi buổi thành 13 trong lúc chọn radio bị chặn sát Save: **savedSlots=[], reqSeen=0, verified=0, failed=1**. Helper điều hướng được thay có chủ đích để báo lỗi khi buổi khác 14; đây là bằng chứng chốt trước Save, chưa phải nghiệm thu điều hướng LMS thật. |
| **F04** | **CLOSED** | `spck-demo-score-reader.ts:624–714`: `F04-AMBIGUOUS`, `CONFLICT`, `DUPLICATE` đều **matched=0**, trả các tab chưa khớp và **toàn bộ bản ghi cũ giữ nguyên**. Control tên duy nhất, đủ điểm vẫn nhập được. |
| **F05** | **CLOSED** | `session14-course-summary.ts`, chốt version/trạng thái sau AI và truyền `expectedVersion` vào `saveDraft`: ba ca `F05-EDIT/APPROVE/VERIFY` giữ AI chờ rồi thay bản hiện tại đều trả **CONFLICT**, **toàn bộ bản ghi mới giữ nguyên**. |
| **F06** | **CLOSED** | `sqlite.ts:4026–4106` và chốt trước duyệt: đủ PLAIN/BOLD/BULLET/UNDERLINE/TILDE/SPLIT/NUMBERED đồng bộ Demo **3,5**, năng lực **3,78**, rồi duyệt được. `BOLD-TAMPER`, `UNPARSEABLE`, `MISSING-LINES` đều bị từ chối. Chạy lại chín ca Round 4: sáu tiền tố `-`, `*`, `•`, `+`, `1.`, `2)` kết hợp nhãn tách/in đậm/gạch ngang đều đồng bộ đúng; thiếu riêng một dòng điểm hoặc dòng đánh số bị sửa thành 99 đều bị chặn. |
| **F07** | **CLOSED** | `session14-eval/route.ts:95–184`: thiếu version, bản đồ thiếu học viên/thiếu mục batch, null, chuỗi, 0, số lẻ đều **HTTP 400**, không đổi bản ghi. Ba ca version cũ trả **409**, không duyệt một phần batch. Batch đủ version trả **200**, hai bản APPROVED. Ba control React xác nhận khi lưu còn chờ/lưu lỗi chưa có approve/upload; control đúng lưu chữ đang hiển thị → duyệt **expectedVersions.S1=2** → mới upload. |
| **F08** | **CLOSED** | `final-project/page.tsx`, năm nhánh load/save/import/AI/upload: cả năm ca đang gõ giữ đủ **bảy trường chỉnh sửa**; cả năm ca đổi lớp giữ lớp B; tải đảo thứ tự giữ **v3 / NEW SERVER V3**. AI/nhập điểm trả v2 sau v3 vẫn giữ **v3 / OLD LETTER / VERIFIED**; ca upload cũ giữ nguyên toàn bộ bản v3, gồm hash và ghi chú. Gõ trong lúc approve hoặc flush giữ chữ mới, **WAITING_APPROVAL, contentHash=""** khi upload trả bản VERIFIED cũ. |
| **F09** | **CLOSED** | `session14-course-summary.ts:163–171` và xử lý prompt trước `generateContent`: bắt đúng payload gửi model. Với tên giả “Lê Hoài Ý”, cả **Ý/ý/Y/y** đều thành `STUDENT_SHORT_01`; tên bạn trùng “An” được thay trọn cụm thành `PEER_STUDENT`, không còn phần họ đệm. Control không dấu và Unicode NFD cũng không còn tên trong các dòng ghi chú đã bắt. |
| **F10** | **CLOSED** | `spck-demo-score-reader.ts`, kiểm đủ điểm và đúng miền trước nhập: bảng trống, thiếu B, chỉ **5/20 ô E**, âm/vượt trần và NaN đều **matched=0**, **toàn bộ bản ghi cũ giữ nguyên**. Năm số 0 thật nhập tổng **0**; đủ B nhập **5**, đủ E nhập **2** theo dữ liệu mẫu. |
| **F11** | **CLOSED** | `session14-course-summary.ts`, chốt dữ kiện và trường AI bắt buộc: không lịch sử, chỉ ABSENT hoặc chỉ PRESENT đều **INSUFFICIENT_INFO, 0 lời gọi AI**. Có ghi chú thực nhận SUCCESS; phản hồi thiếu `knowledgeParagraph2` nhận ERROR. Prompt không chứa câu suy diễn “Tham gia đầy đủ các hoạt động thực hành trên lớp.” |
| **F12** | **CLOSED** | Hàm chọn buổi thật trả ID rỗng với chỉ 14/15, chọn 13 khi có 13/14. Chạy nguyên khối lọc của `loadClassData`: chỉ 14/15 cho **sessions=[], students=[], selected=""**, dừng trước nạp học viên. Với 13/14, chỉ giữ và chọn buổi 13; không chọn lại buổi 14. |

Các ca `UPLOAD-RADIO-DRIFT` và `UPLOAD-DEMO-DRIFT` cũng bị từ chối đúng, mỗi ca verified 0 / failed 1 khi mở lại nạp dữ liệu lưu khác bản duyệt.

## 4. F01 — HIGH — Xóa biến trên window chưa loại được bản nháp trong bộ nhớ riêng

### Nguyên nhân và vị trí

**Vị trí:** `src/lib/playwright/session14-eval-uploader.ts:300–304` chụp tên thuộc tính ban đầu; `624–648` xóa DOM và thuộc tính mới trên `window`; `650–653` mở lại; `719–756` dò kho có dạng `{texts, nums, ratings}`; `172–177` đánh dấu VERIFIED sau khi hàm kiểm tra trả về.

Bản sửa nay xóa DOM ở cả ba cách đóng, và xóa `window.cached` được tạo sau lúc mở modal. Vì vậy **ba probe Round 4 đã hết lỗi**. Tuy nhiên, một biến được giữ trong hàm, module hoặc state của thành phần giao diện không phải thuộc tính mới của `window`; `Object.keys(window)` không đọc hoặc xóa được nó. Khi mở lại, giao diện có thể dựng lại đủ chữ, điểm và radio từ bản nháp ấy sau bước xóa DOM.

Lượt dò kho lưu cũng chỉ xét đối tượng trực tiếp trên `window` có đúng ba mảng và đúng kích thước. **Không tìm thấy đối tượng nào thì trả `[]` và vẫn tiếp tục**; tìm thấy thì chỉ đối chiếu ba chuỗi chữ, chưa biến nó thành nguồn dữ liệu máy chủ được xác nhận theo lớp/buổi/học viên. Phản hồi lưu `{data:{updateStudentEvaluation:{id:"E1"}}}` vẫn đủ qua kiểm tra mạng; không bắt buộc có bản đánh giá đầy đủ hoặc một phản hồi đọc độc lập sau Save.

Do đó ranh giới “đọc lại dữ liệu đã lưu” vẫn phụ thuộc vào nơi fixture/giao diện đặt cache, thay vì chứng minh nguồn dữ liệu đã được lưu.

### Tái hiện trên đúng uploader Round 5

Script mới chỉ ở TEMP: **`probes/round5-upload-closure.ts`**. Dùng DOM/HTTP mô phỏng, gọi uploader và SQLite hiện tại; **không sửa hoặc thay hàm xác minh của uploader**. Helper điều hướng được thay như các vòng trước để cô lập bước lưu/đọc lại.

Kho `persisted` và bản nháp `cached` là hai biến riêng nằm trong phạm vi hàm — **closure**, tức bộ nhớ riêng mà trình xử lý sự kiện giữ lại. Không gắn đối tượng `{texts, nums, ratings}` lên `window`. Một hàm chẩn đoán đã có từ trước chỉ trả bản chụp để probe đọc kết quả sau khi uploader chạy; uploader không gọi hàm này. Đây là mô phỏng bộ nhớ giao diện được đóng kín, không phải probe chạy toàn bộ LMS hoặc một component React của LMS thật.

Mỗi ca có đầy đủ:

- `customPage`, **`skipNavigation:false`**.
- Đúng POST `https://lms-api.mindx.edu.vn/graphql`, `operationName:"UpdateStudentEvaluation"`, trường `query` bắt đầu bằng **`mutation UpdateStudentEvaluation`**.
- Đủ **studentId=S1, classId=ROUND5-CLOSURE, slotNumber=14**; HTTP **200**, kết quả lưu `{id:"E1"}`.
- Bản duyệt: Demo `[1.5,1,0.5,1,1]`, chín rating **4**, đủ ba phần thư.
- Kho lưu trong ba ca lỗi giữ **`["SERVER OLD","SERVER OLD","SERVER OLD"]`**, năm điểm **0**, chín rating **1**, **serverSaved=false**. Khi mở lại, các ca lỗi dựng form từ `cached`.

| Probe | Hành vi đóng/mở | Kết quả thực chạy |
| --- | --- | --- |
| **UPLOAD-CLOSURE-BUTTON** | Có nút Cancel; đóng rồi dựng lại từ bộ nhớ riêng | **verified=1, failed=0, SQLite VERIFIED, opens=2, reqSeen=1, serverSaved=false** |
| **UPLOAD-CLOSURE-AUTOCLOSE** | Save tự đóng; mở lại dựng từ bộ nhớ riêng | **verified=1, failed=0, SQLite VERIFIED, opens=2, reqSeen=1, serverSaved=false** |
| **UPLOAD-CLOSURE-ESCAPE** | Không có nút đóng; Escape đóng; mở lại dựng từ bộ nhớ riêng | **verified=1, failed=0, SQLite VERIFIED, opens=2, reqSeen=1, serverSaved=false** |

`reqSeen=1` là đúng một POST lưu được chặn/trả giả tại máy; **không có yêu cầu tải lại dữ liệu đánh giá**. `savedSlots=[14]`; các assert xác nhận toàn bộ kho lưu vẫn cũ, không chỉ kiểm một cờ `serverSaved`.

Control cùng fixture: **VALID-200 / VALID-201** thực sự cập nhật kho riêng, mở lại nạp kho và đều **verified=1, failed=0, serverSaved=true**. **SERVER-OLD** mở lại nạp kho cũ thì **verified=0, failed=1** ở bước so toàn văn. Như vậy kết quả lỗi phụ thuộc vào nguồn dữ liệu khi mở lại, không phải do fixture chặn mọi thao tác hoặc luôn buộc uploader thành công.

**Ảnh hưởng:** giáo viên vẫn có thể nhận thông báo đã lưu/xác minh khi chữ, điểm và radio đang khớp chỉ vì trình duyệt còn bản nháp. Giữ F01 OPEN, không tạo số finding mới cho cùng ranh giới lỗi.

**Giới hạn:** đã chứng minh bằng fixture trên đúng mã Round 5. Chưa khẳng định LMS thật hiện giữ cache theo cách này, chấp nhận đúng schema mutation giả này hoặc đã xảy ra mất dữ liệu thật. Không suy ra tương thích LMS thật từ tên mutation trong probe.

### Cách sửa và điều kiện đóng

Buộc bước xác minh lấy được **bản đánh giá đã lưu cho đúng lớp/buổi/học viên từ nguồn máy chủ độc lập**: dùng phản hồi tải đánh giá đúng nghiệp vụ khi mở lại, hoặc yêu cầu đọc đánh giá thích hợp; nếu dựa vào phản hồi lưu thì phải có đầy đủ dữ liệu đã lưu để đối chiếu. Kiểm đủ ba phần thư, chín năng lực và năm điểm với bản duyệt. Không có bằng chứng nguồn dữ liệu đã lưu thì trả lỗi, không đánh dấu VERIFIED.

Không dùng việc xóa toàn bộ thuộc tính mới của `window` hoặc tìm một đối tượng có cấu trúc giống fixture làm điều kiện chứng minh đã lưu. Giữ các bảo vệ định danh, HTTP 200/201, query-only, đối chiếu toàn văn và chốt trước Save đã đạt.

Sau sửa: ba ca closure trên phải **verified=0, failed=1** khi kho lưu cũ; control lưu đúng và đọc kho mới HTTP 200/201 vẫn phải **verified=1**. Chạy lại toàn bộ ca Round 3/4 và tám gates trên đúng bản sau sửa. **Chỉ GO khi F01–F12 đều CLOSED và 8/8 gates PASS.**

## 5. Probe, bằng chứng và tính nguyên vẹn

Các probe chạy **11:56:07–11:58:24, UTC+7**. Cả tám script hoàn tất ngay lượt đầu, exit **0**; không sửa fixture để chạy lại sau lỗi thực thi.

| Script giữ tại `probes/` | Số ca | Exit code | Kết quả / bằng chứng |
| --- | --- | --- | --- |
| `round3-core.ts` | 46 | **0** | `core-results.json`: nhập điểm, đồng bộ thư, duyệt version, AI chậm, ẩn danh, dữ kiện, chọn buổi |
| `round3-upload.ts` | 33 | **0** | `upload-results.json`: control HTTP 200/201, các ca mạng âm tính, chữ/radio/điểm lệch, đổi buổi |
| `round3-ui.ts` | 17 | **0** | `ui-results.json`: handler nguyên trạng trong React/ReactDOM thật với Chromium, giữ chữ/lớp/version và trình tự lưu/duyệt |
| `round3-selector.ts` | 3 | **0** | `selector-results.json`: khối lọc/nạp buổi thật |
| `round4-upload-extra.ts` | 3 | **0** | `upload-extra-results.json`: cả AUTOCLOSE/ESCAPE/STATE-CACHED-DRAFT cũ nay **verified=0, failed=1** |
| `round4-ui-extra.ts` | 2 | **0** | `ui-extra-results.json`: giữ chữ gõ trong flush và giữ toàn bộ v3 khi upload v2 trả muộn |
| `round4-score-extra.ts` | 9 | **0** | `score-extra-results.json`: sáu dạng tiền tố đạt; thiếu/sai dòng điểm bị chặn |
| `round5-upload-closure.ts` | 6 | **0** | `upload-closure-results.json`: hai control lưu đúng, một control kho cũ, **ba ca tái hiện F01** |
| **Tổng** | **119** | | **11 CLOSED / 1 OPEN** |

**Exit 0 của probe nghĩa chương trình quan sát hoàn tất, không có nghĩa mọi hành vi sản phẩm PASS.** Ba kết quả sai được giữ nguyên trong JSON và mục 4. `verify-evidence.mjs` đối chiếu kết quả các gates/probes và những điều kiện quan trọng, hoàn tất exit 0; `evidence-summary.json` tổng hợp **NO-GO**, gồm ba bản ghi tái hiện F01. Không tính bước tổng hợp thành gate thứ chín.

SHA-256 các tệp trọng tâm của bản thực kiểm:

| Tệp | SHA-256 |
| --- | --- |
| `src/app/final-project/page.tsx` | `0f3b9ad7a6e7391b8007f87e1e5c76eca1f108f2dab61ee902d6aad64dd3d84e` |
| `src/app/session-comments/page.tsx` | `ac7e9d1f780cb5568ea0c721968cb2122157599590e1684f65ce2ead45472817` |
| `src/app/api/spck/session14-eval/route.ts` | `3d057b0bd3078bddcc6861ccb095ff71ccfc2c44ed39ebc99b607afbb3a82cc7` |
| `src/lib/db/sqlite.ts` | `422d639af47b7dbacb84738cf4cfab117d1bed2913d8fe363a11773db00e02af` |
| `src/lib/gemini/session14-course-summary.ts` | `e90a0ee42368508257fd89950cb73921e07f91d1e2bd1a4124c9be7a68c0dc80` |
| `src/lib/local-files/spck-demo-score-reader.ts` | `0f4e0e3bc44b565114104dc7620f61abacb1fc205ac8a5ad069783c1b59fd56a` |
| `src/lib/playwright/session14-eval-uploader.ts` | `aa62852c8bbd6aabdafbf8cbb0479cdd93366410918d8244579042ecf4036a36` |
| `scripts/test-session14-v290.ts` | `a6e11aaabcc33a0c48e8f29cbb577c554435fa0edad5778f6bcf45a5c1f1331b` |
| `next-env.d.ts` | `b8b3a344484b959af5e4e3fc1a1609dac3cb9ece0cdeb6c145be29bc4c491000` |

`manifest.json`, `round4-source-delta.json`, `integrity-before-report.json` lưu đầu vào, hai thay đổi so Round 4 và đối chiếu 128 tệp. Bảy probe cũ đã được đối chiếu hash với thư mục Owner cung cấp, không có khác biệt. `gates.json`, `probes-exits.json` và từng `.log` lưu exit/thời gian/đầu ra; `git-before.txt`, `git-after.txt`, `integrity-final.json` ghi kiểm tra trước/sau báo cáo.

**Dọn bản sao:** đã xác nhận đường dẫn tuyệt đối đúng workspace Round 5, lập danh sách từng tệp/thư mục, không đi theo junction; gỡ riêng liên kết thư viện rồi xóa từng tệp/thư mục rỗng trong workspace. `cleanup-result.json` xác nhận **workspaceRemoved=true**, xóa **139 tệp / 77 thư mục**, **probesRetained=8**, thư viện gốc vẫn tồn tại. Không giữ DB hoặc dữ liệu thử trong thư mục bằng chứng.

## 6. Giới hạn và bàn giao

- Không đăng nhập, đọc danh sách học viên thật hoặc ghi LMS thật; không dùng khóa Gemini, Google Sheets riêng tư, Drive hoặc GitHub thật. Không dùng nghiệm thu lịch sử của v270/v272/v280 làm nghiệm thu mới v290.
- Uploader được kiểm bằng DOM/HTTP giả lập; helper điều hướng được thay để cô lập chốt đổi buổi. Probe UI dùng handler trích nguyên trạng trong React thật, chưa phải toàn bộ trang Next.js hoặc modal LMS thật.
- Chưa chạy build phát hành; chưa xác nhận hợp đồng mutation/query, thứ tự trường/modal và nguồn dữ liệu khi mở lại trên LMS thật. Tám gates được yêu cầu đã chạy đủ; không ghi các phần chưa kiểm này thành PASS.
- Log ở TEMP có thể bị hệ điều hành dọn; đầu vào, kết quả và hướng sửa quyết định đã ghi trong báo cáo này.

**Đã làm:** kiểm định đủ F01–F12, tám gates và 119 ca bổ sung; chỉ thêm báo cáo, đã dọn workspace thử.

**Kết quả:** **NO-GO — 11 CLOSED / 1 OPEN (F01); 8/8 gates PASS, exit 0.**

**Chưa kiểm tra:** LMS/Gemini và dữ liệu thật, build phát hành, toàn bộ giao diện thật.

**Việc tiếp theo:** bên triển khai sửa nguồn dữ liệu dùng để xác minh F01 theo mục 4 rồi kiểm định lại. Owner không cần thao tác Terminal hoặc cung cấp tài khoản để hoàn tất vòng kiểm định này.
