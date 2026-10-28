# v2.8.0 — Kiểm định độc lập, Vòng 3 (Final Verification)

Ngày: 2026-10-26 (UTC+7). Reviewer: Codex, thực hiện vai trò kiểm định độc lập theo yêu cầu Owner. Đối chiếu trực tiếp [Vòng 1](CODEX_REVIEW_ROUND1.md), [Vòng 2](CODEX_REVIEW_ROUND2.md), mã hiện tại và kết quả chạy mới.

**Kết luận: NO-GO cho toàn bộ đợt kiểm chứng yêu cầu.** Sáu phát hiện cũ `F01`–`F04`, `R2-01`–`R2-02` đã **CLOSED** trong phạm vi kiểm định này. Bộ v280 và phép thử từng tái hiện lỗi Vòng 2 đều đạt. Tuy nhiên, **chỉ 6/7 lệnh yêu cầu đạt**: `test-spck-v270.ts` nguyên trạng thất bại tại T11 vì dữ liệu mô phỏng hộp thoại không tương thích với kiểm tra đóng hộp thoại mới. Điểm còn mở là **R3-01 (P2), thuộc bài kiểm thử**; không có bằng chứng từ lần chạy này rằng ứng dụng vẫn lưu nhầm buổi theo R2-01.

## 1. Bản mã và cách kiểm định

- HEAD: `eeb73d31d51e5915b52ebbcea377aeee5c7384c1`. Đối tượng kiểm định là **nội dung chưa commit trong thư mục làm việc**, không chỉ nội dung của HEAD. Khi bắt đầu có 8 tệp đã sửa và hai đường dẫn chưa được Git theo dõi (`docs/audits/v280/`, `scripts/test-lms-reliability-v280.ts`).
- Đọc `PROJECT_STATE.md` trước, sau đó đối chiếu kế hoạch, CHANGELOG, hai báo cáo cũ và các tệp nguồn/bài kiểm thử liên quan. So sánh thêm với bản sao mã được giữ từ Vòng 2.
- Chạy TypeScript tại repo bằng đúng lệnh yêu cầu. Chạy sáu bộ kiểm thử nguyên trạng **lần lượt** trong bản sao TEMP, dùng Chromium và SQLite mẫu riêng. Nguồn, bài kiểm thử và cấu hình mẫu trong bản sao trùng byte với repo.
- Không sao chép cơ sở dữ liệu thật, `.env`, `.env.local`, danh sách thư mục giáo viên hoặc hồ sơ `playwright-auth`. Dùng thư viện đã cài qua junction `node_modules`, không cài/cập nhật thư viện. Khóa Gemini trong tiến trình kiểm thử là chuỗi giả cho nhánh AI đã được mô phỏng.
- Không sửa mã ứng dụng hoặc bài kiểm thử trong repo. Chỉ tạo báo cáo này và cập nhật kết luận trong ba tài liệu trạng thái theo `AGENTS.md`; đã sao lưu nguyên trạng ba tài liệu trước khi cập nhật.
- Trước khi ghi tài liệu, đối chiếu **1.431/1.431 tệp ghi dấu ban đầu: không thay đổi**; **112/112 tệp đã sao chép: không khác bản repo** sau các bộ thử. Bao gồm việc giữ nguyên `next-env.d.ts`, báo cáo cũ và dữ liệu cục bộ đã ghi dấu.

SHA-256 của bản nguồn/bài kiểm thử được xét:

| Tệp | SHA-256 |
| --- | --- |
| `src/lib/playwright/lms-helpers.ts` | `cf1d7fa3ece52f5ee81b4b7fad575d810c1eb30049c8e03dd1ce73debb1738f4` |
| `src/lib/playwright/save-comments.ts` | `db05ff790e6e7b4536ebf9bac5e9c494754a11d58094c6f825abd776d9211877` |
| `src/lib/playwright/spck-uploader.ts` | `25c158e35c3f4ad1219125984a01bc81a865e67b9b9c53e144f580d033ff7072` |
| `src/lib/playwright/grade-worker.ts` | `402836adde656b35f9e143daeaeee57e5eb0f74832ce78260f909d4969f4f13d` |
| `src/lib/playwright/sync-class.ts` | `7df954bbe4dbd68cfefd9fd83c8b2eb513c33c288f4011e3bf9f3542aa2ba419` |
| `scripts/test-lms-reliability-v280.ts` | `dc129d5edf9c8c3eaa9be0ebab6a92c8048e8dba4b20b12857e0167f1d743133` |
| `scripts/test-spck-v270.ts` | `9fe3b8076b8603ca9dfcb62bf6c48226f8bf7329b4869c38734438cb176987a0` |

## 2. Trạng thái đóng F01–F04 và R2-01–R2-02

| Mã | Trạng thái Vòng 3 | Bằng chứng trực tiếp |
| --- | --- | --- |
| **F01** — Cấm thử lại sau Save, cấm VERIFIED từ cache sau lỗi API | **CLOSED** | Cờ gửi Save vẫn đặt trước click; Comments chỉ đưa lỗi trước Save vào danh sách lượt 2; SPCK truyền cờ qua lỗi và chặn lượt 2. T280-04a/b/d và T280-05a/b đạt. |
| **F02** — Phải xác nhận đúng buổi trước khi lưu | **CLOSED**, gồm R2-01 | Helper ném lỗi khi thiếu/disabled/không bật được slot hoặc bảng không hiện; nơi gọi không còn coi lỗi đọc `.active` là thành công. T280-04c/c2, T280-05b2 và phép thử độc lập đạt, không có lệnh Save khi slot đích biến mất. |
| **F03** — Chọn dialog đang hiện, cô lập backdrop và xác nhận đã đóng | **CLOSED**, gồm R2-02 | Chọn `[role="dialog"]:visible`, nền thuộc tổ tiên `.MuiDialog-root` không phải Drawer; kiểm tra lại số dialog sau thao tác đóng và ném lỗi nếu còn. T280-01d/e/f và phép thử độc lập đạt. |
| **F04** — Bao phủ các ranh giới nguy hiểm trong bộ v280 | **CLOSED trong phạm vi danh mục yêu cầu** | T280-01–05 chạy đủ, có các ca mới 01f/04c2/05b2; giữ ca rơi slot giữa hai học viên, các lỗi cấm retry, SPCK, Grade Worker và syncClass. Lỗi tương thích của bộ v270 được ghi riêng R3-01, không đổi kết quả đó thành PASS. |
| **R2-01** — Slot đích biến mất vẫn Save/VERIFIED | **CLOSED** | Comments và SPCK đều kiểm tra số lượng phần tử và `.active` với lỗi đọc trả `false`; trước Save dừng bằng lỗi rõ ràng. Phép thử Vòng 2 chạy lại: cả hai luồng Save `0`, VERIFIED `0`. |
| **R2-02** — Helper trả thành công dù dialog không đóng | **CLOSED** | `lms-helpers.ts:443–447` kiểm tra lại và ném đúng thông báo yêu cầu. Phép thử không đóng được: `cleanupThrew=true`, `drawerClicks=0`, `dialogClicks=1`. |

### R2-01: đối chiếu từng vị trí bắt buộc

**Comments — `src/lib/playwright/save-comments.ts`:**

| Điểm kiểm tra | Vị trí | Kết quả đọc mã |
| --- | --- | --- |
| Sau Summary/Homework | `421–433` | `slotCountAfterMeta > 0` và đọc `classList.contains("active")` với `.catch(() => false)`; không đạt thì gọi helper và truyền lỗi ra. |
| Trước mỗi học viên | `586–600` | `currentSlotCount > 0` và `.active` với `.catch(() => false)`; lượt 2 cũng phải xác nhận lại bằng helper. |
| Ngay trước Save | `947–961` | Kiểm tra số lượng và `.active`; ném lỗi khi không xác nhận được, trước khi bật `saveMutationDispatched` và gửi Save. |
| Chặn retry | `455–479` | Có cả `"không còn tồn tại"` và `"Không thể đóng hộp thoại"` trong nhóm loại trừ. |

Không còn `.catch(() => true)` trong các phép đọc `.active` của tệp này. Đoạn dọn giao diện trong nhánh **đã bắt lỗi** tại `1365` có `.catch(() => {})` để giữ lỗi gốc; đó không phải chốt cho phép Save. Chốt đầu mỗi học viên (`587`) và trước lượt 2 (`1440`) vẫn bắt buộc thành công.

**SPCK — `src/lib/playwright/spck-uploader.ts`:**

| Điểm kiểm tra | Vị trí | Kết quả đọc mã |
| --- | --- | --- |
| Đầu hàm nộp qua modal thật | `2577–2592` | `initialSlotCount > 0` và `.active` với `.catch(() => false)`; thiếu slot cũng đi vào helper để báo lỗi, không bỏ qua. |
| Khi tìm lại dòng học viên | `2617–2625` | Gọi helper vô điều kiện trước khi quét lại; đã bỏ lớp `if (slotItem.count() > 0)` cũ. Helper tự kiểm tra tồn tại/active. |
| Lượt 2 | `1858–1867` | Gọi dọn dialog và helper xác nhận buổi; đã bỏ điều kiện chỉ gọi helper khi slot tồn tại. Lượt nộp lại còn đi qua kiểm tra đầu hàm. |
| Ngay trước `responsePromise` và Save | `3387–3436` | Số lượng và `.active` được kiểm tra **trước khi tạo Promise chờ phản hồi**; nếu sai thì ném lỗi, không bấm Save. Cờ gửi Save vẫn bật trước `saveBtn.click()`. |
| Chặn retry | `1815–1836` | Có cả hai chuỗi cấm retry mới; tiếp tục chặn lỗi sau Save, lỗi định danh và lỗi đối chiếu dữ liệu. |

Các chốt này áp dụng cho luồng modal LMS thật. Nhánh DOM mô phỏng `[data-student-id]` dùng trong Phase 6 được giữ nguyên. Với đối tượng Playwright thật, `count()` luôn có sẵn; nhánh tương thích đối tượng mô phỏng thiếu `count()` không thay thế phép kiểm tra ở vận hành thật.

### R2-02: xác nhận đóng hộp thoại

`lms-helpers.ts:413–447` đếm dialog đang hiển thị, thử Escape, sau đó nền thuộc Dialog hoặc nút đóng. Sau các bước này có kiểm tra cuối `if ((await countVisibleDialogs()) > 0)` và ném đúng thông báo:

> Không thể đóng hộp thoại ([role='dialog']) đang bị kẹt trên LMS sau khi bấm Escape và backdrop. Đã dừng thao tác để tránh ghi nhầm dữ liệu!

Chốt mới không yêu cầu coi dialog đã đóng khi thực tế vẫn mở. Trường hợp không đóng được phải trả lỗi để dừng đường đi tiếp theo.

### F01/F04: giữ nguyên các bảo vệ đã đạt

- Comments: `saveMutationDispatched` tại `580,961`; điều kiện nhánh xem lại bản vốn VERIFIED tại `788–797`; chặn thêm vào lượt retry tại `1398–1402` và lọc ứng viên tại `1421–1428`.
- SPCK: chặn retry sau Save tại `1812–1816`, cờ trước click tại `3434–3435`, truyền cờ qua lỗi tại `3770–3774`.
- Bộ v280 tiếp tục khẳng định: mất phản hồi sau Save chỉ Save một lần và VERIFIED bằng `0`; cache giao diện không đủ để xác minh; lỗi đối chiếu sau Save không thử lại; Hash drift/ABSENT/học viên ngừng hoạt động/trùng tên/IN_FLIGHT_DRIFT bị chặn; Grade Worker tự phục hồi và syncClass không bấm tắt slot đang active.

Ba ca mới đã đọc cả thiết lập tình huống lẫn điều kiện khẳng định, sau đó chạy trong bộ nguyên trạng:

| Ca mới | Vị trí trong `scripts/test-lms-reliability-v280.ts` | Điều kiện được xác nhận |
| --- | --- | --- |
| **T280-01f (R2-02)** | `372–407` | Escape/backdrop không đóng được; phải nhận lỗi `Không thể đóng hộp thoại`, `drawerClicks=0`, `dialogClicks=1`. |
| **T280-04c2 (R2-01)** | Tình huống `784–787`; kiểm tra `916–925` | Slot Comments đích bị gỡ khi mở modal; `saves=0`, `actualSavedSlots=[]`, `verifiedCount=0`, `failedCount=1`. |
| **T280-05b2 (R2-01)** | Tình huống `1139–1151`; kiểm tra `1219–1227` | Slot SPCK đích bị gỡ khi mở modal; `spckSaves=0`, `verifiedCount=0`, `failedCount=1`. |

## 3. Kết quả chạy đủ bảy lệnh yêu cầu

| Lệnh nguyên trạng | Kết quả chạy mới | Thời gian |
| --- | --- | --- |
| `npx tsc --noEmit --incremental false` | **PASS**, exit `0`, không có chẩn đoán lỗi | 1,11 giây |
| `npx tsx scripts/test-lms-reliability-v280.ts` | **PASS**, exit `0`, T280-01–05, gồm ba ca bổ sung | 82,38 giây |
| `npx tsx scripts/test-spck-v272.ts` | **PASS**, exit `0`, V01–V16 | 31,59 giây |
| `npx tsx scripts/test-spck-v270.ts` | **FAIL**, exit `1`, dừng trong T11; xem R3-01 | 2,95 giây |
| `npx tsx scripts/test-phase5.ts` | **PASS**, exit `0` | 1,53 giây |
| `npx tsx scripts/test-phase6.ts` | **PASS**, exit `0` | 8,62 giây |
| `npx tsx scripts/test-phase7.ts` | **PASS**, exit `0` | 1,20 giây |

`git diff --check` cũng đạt. Các cảnh báo về tính năng thử nghiệm của Node trong Phase 6 không làm bộ thử thất bại.

Trình ghi log Python ban đầu gặp lỗi in tiếng Việt ra console Windows sau khi đã lưu kết quả FAIL của v270. Đã sửa **trình chạy trong TEMP** để xuất UTF-8 và tiếp tục ba lệnh Phase 5/6/7; cả ba đã chạy và đạt. Kết quả v270 thất bại ở trên là lỗi khẳng định trong bài thử, độc lập với lỗi xuất console; không bị bỏ qua hoặc thay bằng kết quả khác.

## 4. Chạy lại đúng phép thử Vòng 2

Tái sử dụng **nguyên byte** `round2-boundary-probe.ts` từ bằng chứng Vòng 2, SHA-256 `626c2919e42fe1035cc9ac30a3caf0a825c0777aa941efa2a17c598bc3813381`. Chạy với bản mã ứng dụng hiện tại trong bản sao TEMP thứ hai có dữ liệu riêng. Mã thoát `0`, thời gian **9,44 giây**. Đã kiểm tra thêm các số liệu JSON sau khi chạy, không chỉ dựa vào mã thoát của probe.

| Quan sát | Vòng 2 đã ghi nhận | Lần chạy Vòng 3 |
| --- | --- | --- |
| Comments: mất slot 1, slot 2 active khi mở modal | Save `1`, VERIFIED `1`, thực lưu slot `[2]` | **Save `0`, opens `1`, VERIFIED `0`, failed `1`, SQLite FAILED**, không có slot được lưu, API lưu xác nhận `0`; lỗi xác nhận đúng buổi trước Save. |
| SPCK: mất slot 12, slot 13 active khi mở modal | Save `1`, VERIFIED `1` | **Save `0`, opens `1`, VERIFIED `0`, failed `1`**; lỗi xác nhận đúng buổi trước Save. |
| Dialog bỏ qua Escape và backdrop | `cleanupThrew=false`, dialog còn `1` | **`cleanupThrew=true`**, dialog vẫn `1`, `drawerClicks=0`, `dialogClicks=1`; đây là dừng an toàn đúng yêu cầu. |
| Helper: thiếu slot / slot disabled / bảng ẩn | Đã ném lỗi ở cả ba ca | Tiếp tục **ném lỗi cả ba ca**. |

Probe giữ việc giảm thời gian chờ locator xuống 1 giây và thời gian chờ phản hồi dài xuống 1 giây để chạy nhanh. Không thay đổi chốt an toàn hoặc mã ứng dụng. Các quan sát là bằng chứng trên DOM/mạng giả lập, không phải việc ghi dữ liệu lên LMS thật.

## 5. Điểm còn mở: R3-01 — P2, bộ v270 thất bại do mô phỏng đếm dialog sai

**Nguyên nhân:** Trong `makeModalLoc`, hàm `count()` trả `1` cho gần như mọi selector, bao gồm `[role="dialog"]:visible`, kể cả khi biến `modalOpen=false`. Escape chỉ đổi `modalOpen`, không làm số đếm thay đổi. Chốt mới của R2-02 vì vậy nhận một hộp thoại vẫn mở và dừng đúng thiết kế trước khi bài T11 có thể kiểm tra nội dung file cũ.

**Vị trí:** `scripts/test-spck-v270.ts:1410–1429`, nhất là `1422–1424`; Escape ở `1460–1463`; khẳng định thất bại tại `1494–1517`. Chốt ứng dụng trả lỗi tại `lms-helpers.ts:443–447`, được gọi từ `spck-uploader.ts:2562`.

**Kết quả thực tế của bộ nguyên trạng:** T11 mong lỗi khớp `/Read-after-Write/` nhưng nhận `Không thể đóng hộp thoại ([role='dialog'])...`. Các kịch bản T12–T16 phía sau không được chạy trong lần nguyên trạng; không ghi nhận chúng là PASS.

**Thực nghiệm xác định nguyên nhân:** Tạo bản sao riêng `round3-v270-fixture-probe.ts` trong TEMP, chỉ sửa `count()` của **đối tượng mô phỏng** để selector `[role="dialog"]:visible` trả `modalOpen ? 1 : 0`; giữ nguyên toàn bộ mã ứng dụng và các điều kiện khẳng định T01–T16. Bản chẩn đoán này chạy **PASS đủ T01–T16**, exit `0`, **4,05 giây**. Bản diff và log được giữ lại. Kết quả này xác nhận nguyên nhân tương thích bài thử; **không thay thế FAIL của lệnh nguyên trạng**.

**Cách sửa tối thiểu đề nghị:** Cập nhật cách đếm dialog trong fixture ở `scripts/test-spck-v270.ts` theo trạng thái mở/đóng thực của nó. Giữ nguyên chốt R2-02 trong ứng dụng và các khẳng định kiểm tra byte/SHA-256; không bỏ T11 hoặc nới điều kiện mong đợi để chấp nhận lỗi dọn hộp thoại.

**Sau khi sửa:** Chạy lại `npx tsx scripts/test-spck-v270.ts` nguyên trạng sau sửa, bảo đảm đủ T01–T16; chạy lại bộ v280 và kiểm tra TypeScript trên cùng bản mã. Chỉ đổi sang GO khi cổng v270 của repo đạt. Reviewer không thực hiện thay đổi fixture trong repo ở vòng này.

## 6. Bằng chứng, giới hạn và kết luận

Thư mục bằng chứng cục bộ: `C:\Users\QQ\AppData\Local\Temp\mindx-v280-round3-31pfh71c\`.

- `baseline.json`, `status-before.txt`, `copied-files.json`, `pre-report-integrity.json`, `final-integrity.json`: trạng thái trước/sau và dấu SHA-256. TypeScript chạy trực tiếp qua công cụ; không có log chẩn đoán vì lệnh không xuất lỗi.
- `results.json`, sáu tệp `test-*.log`, `sandbox\`: kết quả nguyên trạng và bản sao đã chạy.
- `probe\scripts\round2-boundary-probe.ts`, `round2-boundary-probe.log`, `probe-result.json`, `probe-observations.json`: phép thử Vòng 2 chạy với mã hiện tại.
- `diagnose-v270.py`, `v270-fixture-probe.diff`, `v270-fixture-probe.log`, `v270-fixture-probe-result.json`, `probe\scripts\round3-v270-fixture-probe.ts`: chẩn đoán R3-01, chỉ thay fixture trong TEMP.
- `docs-before\`: bản sao ba tài liệu trạng thái trước khi ghi kết luận. TEMP có thể bị hệ điều hành dọn; các số liệu và dấu nguồn trọng tâm đã được ghi ngay trong báo cáo này.

Để chạy lại hai phép thử bổ sung, mở PowerShell tại thư mục `C:\Users\QQ\AppData\Local\Temp\mindx-v280-round3-31pfh71c\probe`, dùng khóa Gemini giả trong tiến trình nếu bước kiểm tra cấu hình yêu cầu, rồi chạy lần lượt `npx tsx scripts/round2-boundary-probe.ts` và `npx tsx scripts/round3-v270-fixture-probe.ts`. Không chạy chúng tại thư mục dữ liệu thật.

Chưa kiểm tra LMS/Gemini/Drive/GitHub thật, build Next.js hoặc nghiệm thu giao diện thủ công. Thông tin lịch sử `7/7 VERIFIED` trên lớp thật trong CHANGELOG không được Vòng 3 xác minh lại. GO cấp mã nguồn sau khi đóng R3-01 cũng không tự thay thế nghiệm thu vận hành thật.

**Đã làm:** Đối chiếu và xác nhận đóng sáu phát hiện cũ; chạy đủ bảy lệnh, chạy lại phép thử độc lập và xác định lỗi tương thích của bộ v270.

**Kết quả:** Hai lỗi an toàn Vòng 2 hết tái hiện; còn một cổng bắt buộc thất bại do fixture T11. Không sửa ứng dụng/bài kiểm thử của repo.

**Chưa kiểm tra:** Dịch vụ thật và nghiệm thu thủ công như giới hạn trên.

**Việc tiếp theo:** Sửa riêng fixture R3-01 rồi kiểm chứng lại cổng v270 trên mã repo trước khi duyệt bản nâng cấp.

VERDICT: NO-GO
