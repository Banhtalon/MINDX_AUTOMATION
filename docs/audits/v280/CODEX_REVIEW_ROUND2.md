# v2.8.0 — Kiểm định độc lập, vòng 2

Ngày: 2026-10-26. Reviewer: Codex, thực hiện vai trò kiểm định độc lập theo yêu cầu Owner. Đối chiếu trực tiếp `CODEX_REVIEW_ROUND1.md`, mã hiện tại và kết quả chạy mới. Giả định vận hành: một giáo viên, một hàng đợi trình duyệt tuần tự.

**Kết luận: chưa duyệt bản nâng cấp.** Cả 7 lệnh được yêu cầu đều PASS, nhưng phép thử bổ sung tái hiện việc vẫn gửi Save và báo VERIFIED khi ô buổi học đích đã biến mất. Hàm dọn hộp thoại cũng chưa báo lỗi khi không đóng được hộp thoại. Hai vấn đề còn lại được mô tả tại R2-01 và R2-02 bên dưới.

## 1. Bản mã và phạm vi kiểm định

- HEAD: `eeb73d31d51e5915b52ebbcea377aeee5c7384c1`.
- Đối tượng kiểm định là **nội dung chưa commit trong thư mục làm việc**, gồm năm tệp Playwright, bài kiểm thử v280 chưa được Git theo dõi và các hàm gọi/kiểm tra dữ liệu liên quan. HEAD trùng vòng 1 nhưng nội dung đang xét đã thay đổi.
- Đọc `PROJECT_STATE.md`, `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, báo cáo vòng 1, mã liên quan và các điều kiện khẳng định trong bài kiểm thử; không lấy tuyên bố đã đóng lỗi trong tài liệu làm bằng chứng nghiệm thu.
- Không sửa mã ứng dụng hoặc bài kiểm thử của dự án. Trong repo, vòng kiểm định này chỉ tạo báo cáo này. Vì kết luận NO-GO, không cập nhật trạng thái đạt trong ba tài liệu dự án.
- Đã đối chiếu SHA-256 trước/sau: 99 tệp trong danh sách ghi dấu ban đầu không thay đổi; mã nguồn/bài kiểm thử dùng chạy các bộ kiểm tra và mã ứng dụng dùng cho probe đều trùng bản được xét.

SHA-256 của năm tệp ứng dụng và bài kiểm thử trọng tâm:

| Tệp | SHA-256 |
| --- | --- |
| `src/lib/playwright/lms-helpers.ts` | `8ac8416750228b018b5c215596e986263072423df8e303104da7b235f8ff6d23` |
| `src/lib/playwright/save-comments.ts` | `b1f61bedec31fcb1aacf7b8bd2b09df0b1708947d0c3f6772877457867634fc4` |
| `src/lib/playwright/spck-uploader.ts` | `efbc703962a99c2a6076e3472ff8ae6241d6f7acbfc9e3c69866515a63c678bf` |
| `src/lib/playwright/grade-worker.ts` | `402836adde656b35f9e143daeaeee57e5eb0f74832ce78260f909d4969f4f13d` |
| `src/lib/playwright/sync-class.ts` | `7df954bbe4dbd68cfefd9fd83c8b2eb513c33c288f4011e3bf9f3542aa2ba419` |
| `scripts/test-lms-reliability-v280.ts` | `594cc2953a2887515115cf41a06434cfeb20107d403fa8347096b527d767c0a8` |

## 2. Trạng thái F01–F04

| Phát hiện vòng 1 | Trạng thái vòng 2 | Bằng chứng và phần còn thiếu |
| --- | --- | --- |
| **F01 — Không thử lại sau Save; không VERIFIED từ cache khi API lỗi** | **CLOSED** | Comments đặt cờ trước `Promise.all`, khóa danh sách retry bằng `!saveMutationDispatched`, giới hạn nhánh xem lại cho bản vốn VERIFIED ở lượt đầu. SPCK đặt cờ trước click, gắn cờ vào lỗi và chặn retry sau Save. T280-04a/b/d và T280-05a/b PASS. |
| **F02 — Phải xác nhận đúng ô buổi học trước khi lưu** | **PARTIAL / OPEN** | Helper đã ném lỗi khi thiếu slot, disabled, không kích hoạt được hoặc bảng không hiển thị; ca inactive không phục hồi được đã PASS. Tuy nhiên nơi gọi còn chuyển lỗi đọc `.active` thành `true`, và SPCK bỏ qua kiểm tra khi slot không còn tồn tại. Probe tái hiện cả hai luồng vẫn Save rồi VERIFIED. Xem **R2-01**. |
| **F03 — Chọn dialog đang hiện; cô lập backdrop của Dialog** | **PARTIAL / OPEN** | Hai lỗi chọn dialog ẩn và bấm nhầm backdrop Drawer đã được sửa; T280-01d/e PASS. Phần yêu cầu của vòng 1 “xác nhận đã đóng; nếu vẫn mở thì trả lỗi rõ ràng” chưa được thực hiện. Probe cho thấy helper trả về bình thường với một dialog vẫn hiện. Xem **R2-02**. |
| **F04 — Mở rộng kiểm thử T280-01 đến T280-05** | **CLOSED theo danh mục được yêu cầu** | Đã có và đã chạy các nhóm/điều kiện cụ thể trong yêu cầu vòng 2, kể cả đếm Save và modal opens ở các ranh giới quan trọng. Bộ test hiện vẫn thiếu hai biến thể R2-01/R2-02; việc đóng phần mở rộng đã yêu cầu không đồng nghĩa đủ điều kiện GO. |

### F01 — Đối chiếu mã và kết quả

- `save-comments.ts:574`: khởi tạo `saveMutationDispatched = false` riêng từng lần xử lý học viên.
- `save-comments.ts:947–950,1124`: đặt cờ `true` trước `Promise.all([interceptor.waitForApiResponse(...), saveBtn.click({ force: true })])`.
- `save-comments.ts:1384–1387,1407–1414`: chỉ thêm học viên vào `preSaveRetryEligibleIds` nếu là lượt đầu, chưa gửi Save và lỗi thuộc nhóm giao diện được phép thử lại; lượt 2 bắt buộc có tên trong danh sách này.
- `save-comments.ts:778–788`: nhánh `alreadySavedAndVerifiedInViewMode` bắt buộc `preSaveRecord.status === "VERIFIED" && !isRetryPass` cùng đối chiếu nội dung đầy đủ.
- `spck-uploader.ts:2563,3436–3438,3772–3776`: cờ được khởi tạo trước thao tác, bật ngay trước `await saveBtn.click()` và gắn vào `modalErr.saveMutationDispatched` khi lỗi trong khối xử lý modal.
- `spck-uploader.ts:1810–1834,1871–1873`: `wasSaveMutationDispatched === true` làm điều kiện retry sai; lỗi được ném ra thay vì chạy `runRealModalUpload()` lần hai.
- Thực nghiệm bộ v280: Comments mất mạng sau Save có `saves=1`, `verifiedCount=0`, bản ghi `FAILED`; ca optimistic cache có `saves=1`, `confirmedApiResponses=0`, `verifiedCount=0`. SPCK lỗi trước Save phục hồi và chỉ Save một lần; lỗi mạng sau Save có `spckSaves=1`, `verifiedCount=0`, `failedCount=1`.

### F02 — Phần đã sửa đúng

- `lms-helpers.ts:490–505`: ném lỗi rõ ràng khi không có ô buổi học đích hoặc ô bị disabled.
- `lms-helpers.ts:507–531`: dùng `classList.contains("active")`; tối đa ba lần click rồi ném lỗi nếu chưa active.
- `lms-helpers.ts:534–537`: lỗi chờ bảng hiển thị được truyền ra, không còn bị bỏ qua trong helper.
- Các lời gọi `ensureCommentsSlotReady` trong Comments/SPCK không còn nối `.catch(() => {})` để nuốt lỗi của helper.
- Comments kiểm tra sau Summary/Homework tại `420–428`, trước từng học viên tại `580–589`, trước Save tại `937–943`. SPCK có kiểm tra trước xử lý học viên tại `2581–2594` và trước Save tại `3425–3434`. Tuy nhiên các kiểm tra này chưa bắt buộc thành công ở mọi nhánh; chi tiết R2-01.
- T280-01c và T280-04c PASS cho slot còn tồn tại nhưng không bật lại được. Probe trực tiếp bổ sung xác nhận helper cũng ném lỗi ở cả ba ca thiếu slot, slot disabled và bảng ẩn.

### F03 — Phần đã sửa đúng

- `lms-helpers.ts:413`: chọn `page.locator('[role="dialog"]:visible')`, nên dialog ẩn đứng trước không che mất dialog đang hiện.
- `lms-helpers.ts:425–429`: chỉ tìm backdrop bằng selector:

```text
xpath=ancestor::*[contains(@class,"MuiDialog-root") and not(contains(@class,"MuiDrawer-root"))][1]//*[contains(@class,"MuiBackdrop-root")]
```

- T280-01d xác nhận có một lần Escape và dialog thứ hai được đóng. T280-01e xác nhận `wrongBackdropClicks=0`, Drawer còn hiện và Dialog đã đóng trong fixture mà backdrop của Dialog thực sự xử lý việc đóng.
- Chưa có kiểm tra cuối cùng rằng mọi dialog đã đóng; chi tiết R2-02.

### F04 — Đối chiếu từng nhóm kiểm thử

| Nhóm | Nội dung thực sự được khẳng định | Vị trí trong `scripts/test-lms-reliability-v280.ts` | Kết quả |
| --- | --- | --- | --- |
| T280-01 | Slot active không bị click; slot inactive được bật lại; slot không phục hồi được ném lỗi; dialog ẩn đứng trước dialog hiện; backdrop Dialog không tác động Drawer | `248–370` | PASS |
| T280-02 | Không bấm Tablist Homework; Summary/Homework đúng nội dung; không toggle tắt slot khi lưu metadata | `422–549,635–657` | PASS |
| T280-03 | Học viên 1 bị lỗi trước Save và làm slot inactive trước học viên 2; phục hồi rồi chạy lượt 2; `actualSavedSlots=[1,1]`, `verifiedCount=2`, `failedCount=0`, học viên 1 mở modal hai lần | `570–580,645–660` | PASS |
| T280-04a/b | Post-save network abort: `saves=1`; optimistic cache: `saves=1`, API xác nhận `0`, VERIFIED `0` | `842–862` | PASS |
| T280-04c/d/e | Wrong/unrecoverable slot: `saves=0`; Read-after-Write mismatch: `saves=1`, VERIFIED `0`; IN_FLIGHT_DRIFT: `saves=0`, `opens=1`, trạng thái DRAFT | `864–894` | PASS |
| T280-04f | Hash drift, ABSENT, `isActive=0`, trùng tên: tổng bốn bản ghi lỗi, không mở modal và có lý do riêng từng trường hợp | `896–989` | PASS |
| T280-05a/b | SPCK lỗi modal trước Save được thử lại; lỗi mạng sau Save chỉ Save một lần và không VERIFIED | `999–1150` | PASS |
| T280-05c | HomeworkGradeWorker dọn dialog tồn đọng và phục hồi khi click mở modal lần đầu không có tác dụng; `verifiedCount=1`, `failedCount=0` | `1152–1278`; mã ứng dụng `grade-worker.ts:258–324` | PASS |
| T280-05d | Gọi thật `ClassSyncer.scrapeSessions`; slot mới nhất đang active không bị click tắt; giữ đúng buổi mới nhất | `1280–1312`; mã ứng dụng `sync-class.ts:332–349` | PASS |

## 3. Phát hiện còn mở

### R2-01 — P1: Ô buổi học biến mất vẫn được phép Save và VERIFIED (tiếp diễn F02)

**Nguyên nhân:** Các kiểm tra bắt buộc đang coi việc không đọc được trạng thái là thành công. Comments dùng `.evaluate(...).catch(() => true)`. SPCK ngoài cách xử lý tương tự còn bọc kiểm tra bằng `if (slotItem.count() > 0)`, vì vậy không có slot thì bỏ qua hoàn toàn. Helper có báo lỗi khi thiếu slot nhưng các đường đi này không gọi helper.

**Vị trí:** `save-comments.ts:421–428,582–589,937–943`; `spck-uploader.ts:2584–2594,2622–2627,3425–3434` và điều kiện gọi phục hồi lượt 2 tại `1857–1870`.

**Tái hiện đã chạy bằng mã ứng dụng nguyên trạng:** Cho slot đích tồn tại và active lúc kiểm tra đầu. Khi mở modal học viên, gỡ slot đích khỏi DOM, giữ bảng học viên và kích hoạt slot khác. API lưu và nội dung đọc lại được giả lập bình thường. Đây là biến thể của ca sai buổi ở vòng 1, xảy ra sau kiểm tra ban đầu.

| Luồng | Buổi yêu cầu / trạng thái sau biến động | Kết quả quan sát |
| --- | --- | --- |
| Comments | Buổi 1; slot 1 không còn trong DOM, slot 2 active | `saves=1`, `actualSavedSlots=[2]`, `confirmedApiResponses=1`, `verifiedCount=1`, trạng thái SQLite `VERIFIED` |
| SPCK | Buổi 12; slot 12 không còn trong DOM, slot 13 active | `spckSaves=1`, `spckOpens=1`, `verifiedCount=1`, `failedCount=0` |

Trong ca Comments, request giả lập mang `slotId` MongoDB của Buổi 2 như ca vòng 1. Trong ca SPCK, slot 13 là trạng thái giao diện của fixture; kết quả chứng minh vẫn gửi Save và VERIFIED khi không xác nhận được Buổi 12, không phải bằng chứng đã ghi sai dữ liệu trên LMS thật.

**Ảnh hưởng:** Không còn bảo đảm “chỉ lưu khi xác nhận được đúng buổi”. HTTP thành công và nội dung đúng học viên vẫn có thể che khuất việc đang thao tác ở buổi khác.

**Sửa tối thiểu:** Không chuyển lỗi đọc `.active` thành `true`. Khi slot thiếu hoặc không xác nhận được trạng thái, phải phục hồi/xác nhận bằng helper hoặc dừng bằng lỗi rõ ràng; trước Save phải dừng nếu không xác nhận được slot đích. Bỏ các điều kiện “chỉ kiểm tra nếu slot tồn tại” ở đường đi LMS thật. Lỗi không xác nhận được buổi không được tự đi tiếp vào lượt retry.

**Sau khi sửa:** Thêm ca slot bị gỡ/thay trong lúc modal mở cho cả Comments và SPCK: bắt buộc `saves=0`, `verifiedCount=0`, có lỗi xác định buổi; giữ nguyên các ca pre-save retry hợp lệ và post-save non-retry hiện tại.

### R2-02 — P2: Dọn dialog không thành công nhưng helper vẫn trả về bình thường (phần còn lại F03)

**Nguyên nhân:** Helper kiểm tra trước Escape và trước click nền, nhưng kết thúc sau một lần thử mà không xác nhận còn `[role="dialog"]:visible` hay không. Các lỗi click cũng bị bỏ qua. Khi dialog không nhận Escape hoặc không đóng sau click nền, nơi gọi vẫn nhận một Promise hoàn thành bình thường.

**Vị trí:** `src/lib/playwright/lms-helpers.ts:419–443`, đặc biệt sau click tại `431–432` và trước khi hàm kết thúc.

**Tái hiện đã chạy:** Tạo một Drawer và một Dialog riêng; Dialog bỏ qua Escape và việc click backdrop của nó không đóng hộp thoại. Gọi helper thật. Kết quả: `cleanupThrew=false`, `visibleDialogs=1`, `drawerClicks=0`, `dialogClicks=1`. Selector nền đã được cô lập đúng, nhưng việc dọn giao diện chưa được xác nhận.

**Ảnh hưởng:** Hộp thoại tồn đọng tiếp tục chắn thao tác hoặc bị nhầm thành hộp thoại của học viên sau. Vòng 1 đã yêu cầu báo lỗi rõ ràng khi không dọn được; điều kiện này còn thiếu.

**Sửa tối thiểu:** Sau các bước đóng hiện có, chờ/xác nhận không còn dialog hiển thị; nếu vẫn còn thì ném lỗi rõ ràng để nơi gọi dừng an toàn. Giữ nguyên phạm vi backdrop thuộc Dialog.

**Sau khi sửa:** Thêm ca Escape và backdrop đều không đóng được: helper phải ném lỗi, Drawer còn nguyên, không bấm Save cho học viên kế tiếp.

## 4. Chạy thực nghiệm

`npx tsc` chạy tại repo với `--incremental false`, không sinh mã ứng dụng. Sáu bộ kiểm thử chạy **lần lượt** trong bản sao tại TEMP, với `src/`, `scripts/`, cấu hình mẫu/tệp khởi chạy cần thiết và SQLite riêng. Không sao chép cơ sở dữ liệu thật, `.env`, `.env.local` hoặc hồ sơ đăng nhập trình duyệt. Dùng thư viện đã cài qua junction `node_modules`; không cài thêm hoặc cập nhật thư viện. Khóa Gemini trong tiến trình kiểm thử là chuỗi giả để qua kiểm tra cấu hình của phần AI đã được giả lập.

| Lệnh yêu cầu | Kết quả chạy mới | Thời gian bộ test |
| --- | --- | --- |
| `npx tsc --noEmit --incremental false` | PASS, exit `0`, không có chẩn đoán lỗi | — |
| `npx tsx scripts/test-lms-reliability-v280.ts` | PASS, exit `0`, T280-01–05 | 75.42 giây |
| `npx tsx scripts/test-spck-v272.ts` | PASS, exit `0`, V01–V16 | 28.72 giây |
| `npx tsx scripts/test-spck-v270.ts` | PASS, exit `0`, T01–T16 | 3.62 giây |
| `npx tsx scripts/test-phase5.ts` | PASS, exit `0` | 1.81 giây |
| `npx tsx scripts/test-phase6.ts` | PASS, exit `0` | 9.58 giây |
| `npx tsx scripts/test-phase7.ts` | PASS, exit `0` | 1.09 giây |
| Probe bổ sung `npx tsx scripts/round2-boundary-probe.ts` | **FAIL điều kiện an toàn**, exit `1`; tái hiện R2-01/R2-02 | — |
| `git diff --check` | PASS; thông báo LF/CRLF không phải lỗi kiểm tra | — |

Probe bổ sung chạy trong một bản sao khác có dữ liệu riêng, tái sử dụng fixture/network mock của T280-04/05, chỉ thêm biến động DOM và điều kiện quan sát. Không sửa mã ứng dụng. Probe giảm thời gian chờ locator mặc định xuống 1 giây; bộ v280 vốn giảm chờ phản hồi mạng dài xuống 1 giây. Các thay đổi thời gian chờ chỉ phục vụ kiểm thử, không thêm vào dự án.

## 5. Bằng chứng giữ lại và cách chạy lại

Thư mục bằng chứng cục bộ: `C:\Users\QQ\AppData\Local\Temp\mindx-v280-round2-8hh478_d\`.

- `baseline.json`: HEAD, danh sách 99 tệp và SHA-256 ban đầu; `status-before.txt`: trạng thái Git trước kiểm định.
- `results.json`, `run-gates.py`, sáu tệp `test-*.log`: lệnh, thời gian, mã thoát và đầu ra của các bộ kiểm thử.
- `sandbox\`: bản sao chạy các bộ kiểm thử, với cơ sở dữ liệu mẫu riêng.
- `probe\scripts\round2-boundary-probe.ts`, `round2-boundary-probe.log`, `probe-observations.json`: mã tái hiện và các số liệu R2-01/R2-02.
- SHA-256 của probe: `626c2919e42fe1035cc9ac30a3caf0a825c0777aa941efa2a17c598bc3813381`.

Chạy lại probe từ thư mục dữ liệu cô lập đã giữ lại:

```powershell
Set-Location -LiteralPath 'C:\Users\QQ\AppData\Local\Temp\mindx-v280-round2-8hh478_d\probe'
npx tsx scripts/round2-boundary-probe.ts
```

Mã thoát `1` hiện tại là do điều kiện an toàn thất bại sau khi in đầy đủ các quan sát, không phải lỗi chuẩn bị môi trường. Không chạy probe trong thư mục dữ liệu thật. TEMP có thể bị hệ điều hành dọn về sau; các số liệu chính và dấu mã nguồn đã được ghi ngay trong báo cáo này.

## 6. Giới hạn và bước tiếp theo

Đây là kiểm định mã và thực nghiệm cục bộ với Chromium, SQLite mẫu và phản hồi mạng giả lập. Không đăng nhập hoặc ghi LMS thật; không kiểm chứng Gemini/Drive/GitHub thật, build Next.js hay nghiệm thu giao diện thủ công. Tuyên bố `7/7 VERIFIED` trên lớp thật trong CHANGELOG là thông tin có sẵn, chưa được vòng 2 xác minh lại.

Cần sửa R2-01/R2-02, thêm kiểm thử tương ứng và kiểm định lại đúng bản mã sau sửa. Không cập nhật ba tài liệu sang trạng thái GO khi các điều kiện trên còn thất bại. Reviewer không thực hiện sửa ứng dụng trong vòng này.

VERDICT: NO-GO
