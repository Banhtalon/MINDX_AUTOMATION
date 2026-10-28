# v2.9.0 — Round 6 Final Verification Audit — Buổi 14

Ngày kiểm định: **27/10/2026, UTC+7**. Reviewer: **Codex, trực tiếp thực hiện vai trò Independent Code & Quality Reviewer theo yêu cầu Owner**.

**Overall Verdict: NO-GO.** Đã chạy mới đủ **8/8 verification gates: PASS, exit code 0**. **F02–F12 CLOSED; F01 vẫn OPEN.** Bản sửa đã chặn các ca bản nháp trong bộ nhớ riêng của Round 5, nhưng bước xác minh dữ liệu máy chủ còn làm tròn điểm năng lực: **máy chủ lưu/trả 4,4, bản duyệt và DOM là 4, nhưng vẫn VERIFIED**. Tái hiện được ở cả nguồn Save và nguồn tải lại. Ngoài ra, phản hồi tải lại hợp lệ đến sau **450 ms** bị bỏ lỡ vì chỉ chờ **350 ms**.

Kết luận áp dụng cho **toàn bộ bản mã thư mục làm việc đã chụp để kiểm tra, gồm tệp chưa được Git theo dõi**, tại HEAD **`eeb73d31d51e5915b52ebbcea377aeee5c7384c1`**. Không dùng kết quả cũ thay cho lần chạy mới. `CLOSED` trong báo cáo là xác minh ranh giới lỗi trên dữ liệu giả, chưa phải nghiệm thu LMS thật.

## 1. Phạm vi và bảo vệ dữ liệu

- Đọc `PROJECT_STATE.md` đầu tiên; đọc đủ năm báo cáo `CODEX_REVIEW_ROUND1.md` đến `CODEX_REVIEW_ROUND5.md` trước khi chạy kiểm định. Đối chiếu `AGENTS.md`, `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, mã xử lý, nơi gọi và bài thử.
- Khi bắt đầu có **22 tệp được Git theo dõi bị sửa**, cùng các đường dẫn mới v280/v290. Giữ nguyên công việc có sẵn; không commit/reset/đổi HEAD.
- **Trong repo chỉ thêm báo cáo này. Không sửa mã ứng dụng, bài thử hoặc `next-env.d.ts`.** Giữ nguyên ba tài liệu trạng thái và năm báo cáo trước để bảo toàn đầu vào kiểm định.
- Chạy đủ tám lệnh nguyên trạng, tuần tự trong bản sao TEMP vì các bộ thử ghi/xóa dữ liệu mẫu. Đối chiếu **128/128 tệp đầu vào** giữa bản gốc/bản thử; không thiếu tệp `.ts`, `.tsx`, `.json` nào trong `src/` và `scripts/` so với danh sách đầu vào.
- So với manifest Round 5, đúng **hai đầu vào thay đổi**: `src/lib/playwright/session14-eval-uploader.ts` và `scripts/test-session14-v290.ts`. Các đầu vào khác giữ cùng SHA-256 — dấu kiểm tra nội dung tệp.
- Không sao chép `.env`, `.env.local`, SQLite thật, `playwright-auth`, danh sách lớp thật hoặc `teacher_browsed_dirs.json`. Dùng tên học viên giả; đặt **`GEMINI_API_KEY=ROUND6_SYNTHETIC_KEY`**, bỏ biến mật khẩu LMS/Teaching khỏi tiến trình thử. AI và HTTP nghiệp vụ được mô phỏng.
- Dùng thư viện đã cài qua junction `node_modules` — liên kết tới thư viện hiện có; không cài/cập nhật thư viện. Windows, Node **v24.21.0**, npm **11.19.0**.
- Trước/sau các gates và probes, **128/128 đầu vào gốc và 128/128 đầu vào bản thử không đổi**. Đối chiếu riêng **18 đường dẫn được bảo vệ**, gồm trạng thái tồn tại/hash của DB, cấu hình riêng, `.env.local`, `tsconfig.tsbuildinfo`, tài liệu và báo cáo cũ: không thay đổi.
- Không chỉnh bất kỳ tệp nào trong thư mục Round 4 `mindx-v290-round4-lu6e9k` hoặc Round 5 `mindx-v290-round5-6z0KJG`. Các script cũ được sao chép vào thư mục Round 6; bản gốc và bản lưu nguyên trạng tiếp tục trùng hash.

Thư mục bằng chứng cục bộ:

`C:\Users\QQ\AppData\Local\Temp\mindx-v290-round6-3Vlx5e\`

Các lệnh chạy trong `workspace\` bên trong đường dẫn này. **Đã dọn toàn bộ workspace và DB thử trước khi hoàn tất**, giữ scripts tại `probes\`, log, JSON và manifest ở bên ngoài workspace. Không dùng cơ sở dữ liệu thật để chạy thử.

## 2. Verification Gate Table — đủ tám lệnh và exit code

Đợt chạy **14:54:33–14:57:22 ngày 27/10/2026, UTC+7**. Mỗi lệnh chạy một lần; không cần sửa hoặc chạy lại gate nào.

| STT | Lệnh nguyên trạng | Kết quả | Exit code | Thời gian | Bằng chứng |
| --- | --- | --- | --- | --- | --- |
| 1 | `npx tsc --noEmit` | **PASS** | **0** | 1,254 giây | `gate-1.log`, không có chẩn đoán lỗi |
| 2 | `npx tsx scripts/test-session14-v290.ts` | **PASS** | **0** | 36,150 giây | `gate-2.log`, đủ S14-01–S14-07 |
| 3 | `npx tsx scripts/test-lms-reliability-v280.ts` | **PASS** | **0** | 84,501 giây | `gate-3.log`, đủ T280-01–T280-05 |
| 4 | `npx tsx scripts/test-spck-v270.ts` | **PASS** | **0** | 4,411 giây | `gate-4.log`, đủ T01–T16 |
| 5 | `npx tsx scripts/test-spck-v272.ts` | **PASS** | **0** | 30,420 giây | `gate-5.log`, đủ V01–V16 |
| 6 | `npx tsx scripts/test-phase5.ts` | **PASS** | **0** | 1,882 giây | `gate-6.log` |
| 7 | `npx tsx scripts/test-phase6.ts` | **PASS** | **0** | 9,506 giây | `gate-7.log` |
| 8 | `npx tsx scripts/test-phase7.ts` | **PASS** | **0** | 1,345 giây | `gate-8.log` |

`gates.json` lưu thời điểm bắt đầu/kết thúc, exit code, thời gian và log từng lệnh.

**Đánh giá bài thử đã sửa:** S14-06 dùng `skipNavigation:false`, Save trả ID, mở lại phát `GetStudentEvaluation` lấy dữ liệu đã lưu. S14-07 đã thêm ba ca closure — bản nháp giữ trong bộ nhớ riêng của hàm — và đều bị chặn. Đây là cải thiện đúng hướng. Mục cuối mang tên “F07, F08 & F12” vẫn chỉ chạy hàm chọn buổi; đã dùng probe React độc lập để xác minh F07/F08. Bộ thử chưa có ca điểm năng lực máy chủ là số lẻ hoặc tải lại chậm 450 ms, nên 8/8 PASS không đóng được F01.

## 3. Status Table — F01 đến F12

Vị trí mã theo bản Round 6. Tên tệp trong bảng được viết gọn; đường dẫn đầy đủ của F01 nằm tại mục 4.

| ID | Trạng thái | Bằng chứng kiểm chứng mới |
| --- | --- | --- |
| **F01** | **OPEN** | `session14-eval-uploader.ts:58–232, 763–895, 961–995`: đã bỏ `initialWindowKeys`/`storeTextsList`; bare ID không có nguồn tải lại bị từ chối, cả ba closure và bốn ca cache cũ không VERIFIED. Control HTTP 200/201 và sáu control nguồn Save/tải lại theo dạng mảng/trường tên/đối tượng lồng đều đạt. Nhưng `SAVE-FRACTIONAL-RATING` và `REOPEN-FRACTIONAL-RATING` đều **verified=1, failed=0, SQLite VERIFIED**, trong khi năng lực thứ 9 ở kho lưu/phản hồi là **4,4**, bản duyệt/DOM là **4**. Chi tiết và ca phản hồi 450 ms tại mục 4. |
| **F02** | **CLOSED** | `session14-eval-uploader.ts:910–958`: đủ sáu ca `UPLOAD-TAIL-0/1/2`, `UPLOAD-TRUNCATE-0/1/2` đều **verified=0, failed=1, opens=2**, lỗi ghi rõ đối chiếu toàn văn **trên DOM**, trước bước xác minh nguồn máy chủ. `UPLOAD-SERVER-OLD` cũng dừng tại DOM. `UPLOAD-WHITESPACE` đạt **verified=1**; sai radio/điểm đọc lại bị từ chối đúng tại DOM. |
| **F03** | **CLOSED** | Chốt hash/buổi sát Save tại `session14-eval-uploader.ts:560–585`: `UPLOAD-SLOT-DRIFT` chuyển buổi sang 13 khi chọn radio, kết quả **savedSlots=[], reqSeen=0, verified=0, failed=1**. Helper điều hướng được thay có chủ đích để báo lỗi khi buổi khác 14; đây là chứng minh chốt trước Save, chưa phải nghiệm thu điều hướng LMS thật. |
| **F04** | **CLOSED** | `spck-demo-score-reader.ts:624–714`: `F04-AMBIGUOUS`, `CONFLICT`, `DUPLICATE` đều **matched=0**, trả tab chưa khớp và **toàn bộ bản ghi cũ giữ nguyên**. Control tên duy nhất/đủ điểm vẫn nhập đúng. |
| **F05** | **CLOSED** | `session14-course-summary.ts`, chốt version/trạng thái sau AI và `expectedVersion` khi lưu: `F05-EDIT/APPROVE/VERIFY` giữ phản hồi AI, thay bản hiện tại rồi thả phản hồi cũ; cả ba trả **CONFLICT**, **toàn bộ bản ghi mới giữ nguyên**. |
| **F06** | **CLOSED** | `sqlite.ts:4026–4106` và kiểm trước duyệt: bảy dạng PLAIN/BOLD/BULLET/UNDERLINE/TILDE/SPLIT/NUMBERED đồng bộ Demo **3,5**, năng lực **3,78**, rồi duyệt được. `BOLD-TAMPER`, `UNPARSEABLE`, `MISSING-LINES` bị từ chối. Chín ca Round 4 xác nhận sáu dạng tiền tố `-`, `*`, `•`, `+`, `1.`, `2)` kết hợp nhãn tách/in đậm/gạch ngang đều đồng bộ; thiếu riêng một dòng hoặc sửa điểm thành 99 đều bị chặn. |
| **F07** | **CLOSED** | `session14-eval/route.ts:95–184`: thiếu version, bản đồ thiếu học viên/thiếu mục batch, null, chuỗi, 0, số lẻ đều **HTTP 400**, bản ghi không đổi. Ba ca version cũ trả **409**, không duyệt một phần batch; batch đủ version trả **200**, cả hai APPROVED. Probe React xác nhận không approve/upload khi lưu còn chờ hoặc lưu lỗi; control đúng lưu chữ hiển thị → duyệt **expectedVersions.S1=2** → mới upload. |
| **F08** | **CLOSED** | `final-project/page.tsx`, năm nhánh load/save/import/AI/upload: cả năm ca gõ giữ đủ **bảy trường chỉnh sửa**; cả năm ca đổi lớp giữ lớp B. Tải đảo thứ tự giữ **v3 / NEW SERVER V3**; AI/nhập điểm trả v2 sau v3 giữ **v3 / OLD LETTER / VERIFIED**. Upload v2 trả muộn giữ nguyên toàn bộ bản v3, gồm hash/ghi chú. Gõ khi approve hoặc flush giữ chữ mới, **WAITING_APPROVAL, contentHash=""** khi upload trả bản VERIFIED cũ. |
| **F09** | **CLOSED** | `session14-course-summary.ts:163–171` và xử lý prompt trước `generateContent`: bắt đúng payload gửi model. Với tên giả “Lê Hoài Ý”, đủ **Ý/ý/Y/y** được thay thành bốn `STUDENT_SHORT_01`; tên bạn trùng “An” được thay trọn cụm thành `PEER_STUDENT`. Control không dấu/NFD cũng không còn tên trong dòng ghi chú đã bắt. |
| **F10** | **CLOSED** | `spck-demo-score-reader.ts`, kiểm đủ/đúng miền trước nhập: bảng trống, thiếu B, chỉ **5/20 ô E**, âm/vượt trần và NaN đều **matched=0**, **toàn bộ bản ghi cũ giữ nguyên**. Năm số 0 thật nhập tổng **0**; đủ B nhập **5**, đủ E nhập **2** theo dữ liệu mẫu. |
| **F11** | **CLOSED** | `session14-course-summary.ts`, chốt dữ kiện và trường bắt buộc: không lịch sử, chỉ ABSENT hoặc chỉ PRESENT đều **INSUFFICIENT_INFO, 0 lời gọi AI**. Có ghi chú thực nhận SUCCESS; thiếu `knowledgeParagraph2` nhận ERROR. Prompt không có câu suy diễn “Tham gia đầy đủ các hoạt động thực hành trên lớp.” |
| **F12** | **CLOSED** | Hàm chọn buổi thật trả ID rỗng với chỉ 14/15, chọn 13 khi có 13/14. Nguyên khối lọc của `loadClassData`: chỉ 14/15 cho **sessions=[], students=[], selected=""**, dừng trước nạp học viên; 13/14 chỉ giữ và chọn buổi 13. |

## 4. F01 còn mở — Xác minh sai điểm máy chủ và bỏ lỡ phản hồi hợp lệ

### 4.1. Điểm năng lực máy chủ bị làm tròn trước đối chiếu

**Nguyên nhân:** `verifyServerEvaluationPayload` dùng **`Math.round(actualRating) !== expectedRating`** tại **`src/lib/playwright/session14-eval-uploader.ts:163–170`**. Vì vậy mọi số lẻ quanh mức 4, chẳng hạn **4,4**, được coi bằng 4. Điểm năng lực là chín lựa chọn nguyên từ 1 đến 5; dữ liệu máy chủ khác bản duyệt hoặc không thuộc miền hợp lệ phải bị từ chối, không được tự sửa trước khi xác minh.

**Tái hiện:** `probes/round6-server-source.ts`, chạy uploader và SQLite nguyên trạng với `customPage`, **`skipNavigation:false`**, đúng POST/host/mutation/định danh **studentId=S1, classId=ROUND6-SOURCE, slotNumber=14**. Bản duyệt có đủ ba phần thư, năm Demo **[1.5, 1, 0.5, 1, 1]**, chín năng lực **4**. Kho lưu nằm trong bộ nhớ riêng, tách khỏi bản nháp. Máy chủ được mô phỏng lưu/trả năng lực thứ 9 `attitudeInClass=4.4`; modal mở lại dựng từ bản nháp có radio 4. Toàn bộ các trường khác khớp.

| Ca | Nguồn độc lập trả về | Kho lưu/phản hồi năng lực #9 | Bản duyệt/DOM #9 | Kết quả thực chạy |
| --- | --- | --- | --- | --- |
| **SAVE-FRACTIONAL-RATING** | Save HTTP 200 trả đủ dữ liệu; không có tải lại | **4,4** | **4** | **verified=1, failed=0, SQLite VERIFIED, opens=2, requests=1** |
| **REOPEN-FRACTIONAL-RATING** | Save trả ID; mở lại nhận đầy đủ `studentEvaluation` HTTP 200 | **4,4** | **4** | **verified=1, failed=0, SQLite VERIFIED, opens=2, requests=2** |

Đã chạy xác nhận lại cả hai ca, cùng kết quả. JSON giữ cả **`persisted.ratings[8]=4.4`**, **`serverResponse.ratings[8]=4.4`** và **`cached.ratings[8]=4`**; không chỉ dựa vào cờ báo thành công.

**Ảnh hưởng:** bước mới đã chứng minh có nguồn máy chủ, nhưng vẫn xác nhận trùng bản duyệt khi nguồn ấy chứa điểm khác/không hợp lệ. Giữ **F01 OPEN** cho cùng ranh giới xác minh dữ liệu đã lưu. Việc này không mở lại F02: DOM vẫn được so đúng, còn sai lệch nằm ở nguồn máy chủ.

**Cách sửa nhỏ nhất:** chỉ chấp nhận điểm máy chủ hữu hạn, **số nguyên trong 1..5**, và **bằng đúng điểm đã duyệt**; bỏ `Math.round` trên giá trị nhận từ máy chủ. Giữ nguyên các chốt thiếu trường, định danh, HTTP, mutation, toàn văn và bước DOM trước kiểm nguồn.

**Sau khi sửa:** hai ca trên phải **verified=0, failed=1**; thêm ca số lẻ, ngoài miền và sai số nguyên trên cả nguồn Save/tải lại. Các control số nguyên hợp lệ phải tiếp tục đạt.

### 4.2. Chỉ chờ tải lại 350 ms nên dữ liệu đúng cũng có thể bị báo thất bại

**Vị trí:** `src/lib/playwright/session14-eval-uploader.ts:763–850`, đặc biệt **`timeout:350` tại dòng 844**, rồi báo thiếu nguồn tại **992–995**.

**Tái hiện:** cùng fixture và cùng dữ liệu đã lưu đúng, Save chỉ trả `{id:"E1"}`. Mở lại phát query đúng lớp/buổi/học viên. Control **REOPEN-ARRAYS** trả ngay thì **verified=1, failed=0**. Chỉ trì hoãn phản hồi đúng **450 ms** ở **REOPEN-450MS** thì **verified=0, failed=1, SQLite FAILED, opens=2, requests=2, saved=true**, lỗi “Không có bằng chứng ... từ nguồn máy chủ độc lập”. Probe chờ cho phản hồi hoàn tất và giữ nội dung đầy đủ để xác nhận đây không phải ca không có phản hồi. Chạy lại vẫn tái hiện.

**Nguyên nhân:** bộ chờ mạng hết hạn trước khi phản hồi đến. Sau đó mã vẫn có thể chờ dialog tới 6000 ms, nhưng không tiếp nhận lại phản hồi đã bỏ lỡ. 450 ms là độ trễ thông thường có thể xảy ra, không phải một tình huống mạng treo vô hạn.

**Ảnh hưởng:** báo thất bại dù lưu đúng; đây là vấn đề độ tin cậy, **không phải đường VERIFIED sai** như mục 4.1.

**Cách sửa nhỏ nhất:** chờ phản hồi đánh giá đúng nghiệp vụ với thời hạn hợp lý, phù hợp bước tải modal; vẫn từ chối khi hết hạn thật, thiếu dữ liệu hoặc dữ liệu không khớp. Không bỏ điều kiện nguồn độc lập để làm ca này đạt. Kiểm lại control trả ngay, trả sau 450 ms, không bao giờ trả, HTTP lỗi và dữ liệu sai.

### 4.3. Những phần F01 đã xác nhận sửa đúng

- Không còn xóa thuộc tính mới của `window` hoặc dò kho `{texts,nums,ratings}` trên `window` để chứng minh đã lưu.
- Ba ca **CLOSURE-BUTTON / AUTOCLOSE / ESCAPE** nay đều **verified=0, failed=1, opens=2, reqSeen=1, serverSaved=false**; kho lưu giữ ba chuỗi `SERVER OLD`, năm số 0 và chín rating 1.
- `CACHED-DRAFT`, `AUTOCLOSE-CACHED-DRAFT`, `ESCAPE-CACHED-DRAFT`, `STATE-CACHED-DRAFT`, query-only và các ca mạng sai/thiếu định danh đều bị chặn.
- Hai ca **BARE-ID-PERSISTED-NO-LOAD / BARE-ID-UNPERSISTED-NO-LOAD** đều bị từ chối vì không có nguồn đầy đủ. Không coi control cũ chỉ trả ID là phải VERIFIED.
- Control lưu đúng HTTP 200/201 vẫn VERIFIED khi phản hồi Save chứa đầy đủ dữ liệu thực đã lưu. Sáu control dạng **mảng / trường tên / đối tượng lồng**, trên cả Save và tải lại, đều đạt.
- **68 ca** cố ý bỏ hoặc đổi từng phần trong ba thư, chín năng lực và năm Demo, trên cả hai nguồn, đều bị từ chối; các ca rating đổi ở đây là **số nguyên 1 thay cho 4**. Ca số lẻ 4,4 riêng ở mục 4.1 chưa bị chặn.

## 5. Probe bổ sung, thay đổi fixture và bằng chứng

Đã kiểm **211 trường hợp riêng biệt**: **119 ca từ Round 3/4/5** và **92 ca nguồn máy chủ mới**. Các script đều hoàn tất exit **0**; exit 0 của probe nghĩa thu thập kết quả thành công, **không đồng nghĩa mọi hành vi ứng dụng PASS**.

| Script cuối giữ tại `probes/` | Số ca | Exit code | Kết quả/bằng chứng |
| --- | --- | --- | --- |
| `round3-core.ts` | 46 | **0** | `core-results.json`: F04–F07, F09–F12 |
| `round6-from-round3-upload.ts` | 33 | **0** | `upload-results.json`: mạng/định danh, sáu ca toàn văn tại DOM, radio/điểm/buổi lệch, control 200/201/whitespace |
| `round3-ui.ts` | 17 | **0** | `ui-results.json`: handler thật trong React/ReactDOM/Chromium, F07/F08 |
| `round3-selector.ts` | 3 | **0** | `selector-results.json`: nguyên khối chọn/lọc buổi |
| `round4-upload-extra.ts` | 3 | **0** | `upload-extra-results.json`: ba cache cũ đều bị chặn |
| `round4-ui-extra.ts` | 2 | **0** | `ui-extra-results.json`: gõ khi flush và upload cũ trả sau bản mới |
| `round4-score-extra.ts` | 9 | **0** | `score-extra-results.json`: định dạng và chốt điểm trong thư |
| `round6-from-round5-upload-closure.ts` | 6 | **0** | `upload-closure-results.json`: hai control đạt, kho cũ và ba closure bị chặn |
| `round6-server-source.ts` | 92 | **0** | `server-source-results.json`: **89 đúng kỳ vọng; 2 VERIFIED sai; 1 từ chối nhầm** |
| **Tổng trường hợp riêng biệt** | **211** | | **11 CLOSED / 1 OPEN** |

**Điều chỉnh control theo yêu cầu Round 6:** chỉ hai bản sao probe uploader được thích nghi: khi `serverSaved===true`, phản hồi Save trả đầy đủ bản đã lưu cùng định danh. Các nhánh không lưu giữ phản hồi ID/bản cũ; các phản hồi lỗi/primitive khác giữ nguyên. Probe closure thêm assert bắt buộc từ chối ba ca chưa lưu. Không sửa các probe gốc tại thư mục Round 4/5; `probe-adaptations.json` và hai bản sao cũ lưu thay đổi để đối chiếu.

**Minh bạch việc chuẩn bị probe mới:** ở lượt đầu, fixture nguồn máy chủ chọn nhầm nhánh phản hồi đầy đủ cho hai ca mang tên bare-ID. Đã sửa điều kiện chọn nhánh **chỉ trong script TEMP**, giữ script/JSON đầu tại `round6-server-source-initial.ts` và `server-source-initial-results.json`, rồi chạy lại đúng hai ca. Đồng thời chạy xác nhận lại control tải ngay, tải 450 ms và hai ca số lẻ: **6 lượt, exit 0**. Bảng 92 ca dùng kết quả cuối; không tính hai kết quả fixture sai thành lỗi ứng dụng. `source-recheck-exit.json`, `server-source-recheck-results.json`, `round6-source-recheck.log` giữ đầy đủ chi tiết. Lỗi biểu thức tiếng Việt bị đổi mã ký tự trong lần chuẩn bị chương trình tổng hợp cũng đã sửa tại TEMP; không thay điều kiện kiểm sản phẩm.

`verify-evidence.mjs` đã đối chiếu tám gates, số lượng ca và các điều kiện quyết định, gồm thứ tự dừng tại DOM của F02, ba closure, kho lưu/rating thực của hai ca số lẻ và hai ca bare-ID. Kết thúc exit **0**, ghi `evidence-summary.json` với **NO-GO**, hai `falseVerified` và một `falseRejected`. Đây là bước tổng hợp, không tính thành verification gate thứ chín.

Thời gian probes: **14:57:22–15:03:14, UTC+7**. `probes-exits.json`, `source-probe-exit.json`, `source-recheck-exit.json` và từng `.log` lưu exit/thời gian/đầu ra.

## 6. Dấu bản mã và dọn workspace

SHA-256 của các tệp trọng tâm đã kiểm:

| Tệp | SHA-256 |
| --- | --- |
| `src/app/final-project/page.tsx` | `0f3b9ad7a6e7391b8007f87e1e5c76eca1f108f2dab61ee902d6aad64dd3d84e` |
| `src/app/session-comments/page.tsx` | `ac7e9d1f780cb5568ea0c721968cb2122157599590e1684f65ce2ead45472817` |
| `src/app/api/spck/session14-eval/route.ts` | `3d057b0bd3078bddcc6861ccb095ff71ccfc2c44ed39ebc99b607afbb3a82cc7` |
| `src/lib/db/sqlite.ts` | `422d639af47b7dbacb84738cf4cfab117d1bed2913d8fe363a11773db00e02af` |
| `src/lib/gemini/session14-course-summary.ts` | `e90a0ee42368508257fd89950cb73921e07f91d1e2bd1a4124c9be7a68c0dc80` |
| `src/lib/local-files/spck-demo-score-reader.ts` | `0f4e0e3bc44b565114104dc7620f61abacb1fc205ac8a5ad069783c1b59fd56a` |
| `src/lib/playwright/session14-eval-uploader.ts` | `0bd48797eb862e84af39519fdf1f1a65a2ea0adca571194903b97bec944119cb` |
| `scripts/test-session14-v290.ts` | `5beb73ef90a92f297988ca08665b8ba7b21fedc5ea8123e549e8b5aa3173d2b8` |
| `next-env.d.ts` | `b8b3a344484b959af5e4e3fc1a1609dac3cb9ece0cdeb6c145be29bc4c491000` |

`manifest.json`, `round5-source-delta.json`, `integrity-before-report.json`, `integrity-before-cleanup.json` lưu đầu vào và đối chiếu. `git-before.txt`, `git-after.txt`, `integrity-final.json` ghi trạng thái cuối. Không thay HEAD hoặc ghi vào DB gốc.

**Dọn bản sao:** đã xác nhận đường dẫn tuyệt đối là đúng workspace Round 6, lập danh sách từng tệp/thư mục, không đi theo junction. Gỡ riêng liên kết thư viện rồi xóa từng tệp/thư mục rỗng trong workspace. `cleanup-result.json` xác nhận **workspaceRemoved=true**, xóa **142 tệp / 77 thư mục**, giữ **12 script** tại `probes/`, thư viện gốc vẫn tồn tại. Không giữ DB/dữ liệu thử trong thư mục bằng chứng.

## 7. Giới hạn và bàn giao

- Không đăng nhập, đọc danh sách học viên thật hoặc ghi lên LMS thật; không gọi Gemini/Google Sheets riêng tư/Drive/GitHub thật. Không dùng nghiệm thu lịch sử v270/v272/v280 làm nghiệm thu mới v290.
- Uploader được kiểm bằng DOM/HTTP mô phỏng, một browser context trong mỗi tiến trình. Helper điều hướng được thay để cô lập chốt đổi buổi. Probe UI trích handler nguyên trạng vào React/ReactDOM thật, chưa phải toàn bộ trang Next.js hoặc modal LMS thật.
- Chưa chạy build phát hành; chưa xác nhận hợp đồng mutation/query, thứ tự trường/modal hoặc cơ chế tải lại trên LMS thật. Hai ca số lẻ chứng minh lỗ hổng kiểm tra dữ liệu máy chủ trong mã; **không khẳng định LMS thật hiện lưu số lẻ hoặc đã xảy ra sai dữ liệu thật**. Ca 450 ms chứng minh giới hạn chờ của mã, không phải đo độ trễ LMS thật.
- Log ở TEMP có thể bị hệ điều hành dọn. Đầu vào quan trọng, kết quả và hướng sửa đã được ghi trực tiếp trong báo cáo.

**Điều kiện kiểm định lại:** xử lý mục 4.1 và thời hạn tải lại ở 4.2, giữ các control đã đạt, chạy lại các ca nguồn máy chủ và tám lệnh trên đúng bản sau sửa. Chỉ **GO** khi **F01–F12 đều CLOSED và 8/8 gates PASS**.

**Đã làm:** kiểm định đủ 12 phát hiện, tám gates và 211 trường hợp riêng biệt; chỉ thêm báo cáo, đã dọn workspace thử.

**Kết quả:** **NO-GO — 11 CLOSED / 1 OPEN (F01); 8/8 gates PASS, exit code 0.**

**Chưa kiểm tra:** dịch vụ/dữ liệu thật, build phát hành và toàn bộ giao diện thật.

**Việc tiếp theo:** bên triển khai sửa chốt điểm năng lực nhận từ máy chủ và thời hạn chờ tải lại theo mục 4, rồi kiểm định lại. Owner không cần chạy Terminal hoặc cung cấp tài khoản để hoàn tất vòng này.
