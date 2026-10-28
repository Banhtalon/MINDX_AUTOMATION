# v2.8.0 — Kiểm định độc lập, Vòng 4 (Round 4 Final Verification)

Ngày: 2026-10-26 (UTC+7). Reviewer: Codex, thực hiện vai trò kiểm định độc lập theo yêu cầu Owner. Phạm vi: LMS Reliability & Self-Healing Upgrade; đối chiếu trực tiếp [báo cáo Vòng 3](CODEX_REVIEW_ROUND3.md), bản mã hiện tại và kết quả chạy mới.

**Kết luận: GO cho bản mã và đủ bảy cổng kiểm chứng được yêu cầu.** `R3-01` đã **CLOSED**; `F01`–`F04`, `R2-01`–`R2-02` tiếp tục **CLOSED**. Cả **7/7 lệnh PASS**, exit `0`; bộ v270 chạy nguyên trạng sau sửa fixture, đạt đủ **T01–T16**. Không còn phát hiện phải sửa trong phạm vi Vòng 4. Kết luận này chưa thay thế nghiệm thu trên LMS thật.

## 1. Bản mã, đối chiếu và cách chạy

- Thư mục: `F:\MINDX_project test\MINDX-AUTOMATION`; nhánh `main`; HEAD `eeb73d31d51e5915b52ebbcea377aeee5c7384c1`. Đối tượng kiểm định là **nội dung thư mục làm việc chưa commit**, gồm cả tệp mới, không chỉ bản HEAD.
- Đọc `PROJECT_STATE.md` trước, đối chiếu `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, `AGENTS.md`, báo cáo Vòng 3 và mã liên quan. Áp dụng kiểm chứng đúng phạm vi; không sửa mã ứng dụng hoặc bài kiểm thử trong repo.
- Khi bắt đầu có **9 tệp đã sửa** và hai đường dẫn chưa được Git theo dõi (`docs/audits/v280/`, `scripts/test-lms-reliability-v280.ts`). Giữ nguyên các thay đổi có sẵn.
- Xác nhận bản sao Vòng 3 còn lưu khớp **7/7 dấu SHA-256 được công bố trong báo cáo Vòng 3**, rồi so sánh trực tiếp với repo hiện tại: **79/79 tệp dưới `src/` trùng byte**; trong **10 tệp bài thử/công cụ dưới `scripts/`**, chỉ `test-spck-v270.ts` thay đổi.
- So sánh toàn bộ byte của v270 chứng minh thay đổi **chỉ** là biểu thức `count()` tại fixture T11. Thay đúng biểu thức cũ bằng biểu thức mới tái tạo chính xác tệp hiện tại. Không sửa điều kiện khẳng định, bỏ ca hoặc nới kỳ vọng của T01–T16.
- Chạy TypeScript trực tiếp tại repo. Sáu bộ kiểm thử chạy **lần lượt**, nguyên trạng, trong bản sao TEMP; **112/112 tệp đầu vào** trùng byte với repo trước và sau chạy. SQLite và các thư mục bài nộp mẫu nằm riêng trong bản sao.
- Không sao chép `.env`, `.env.local`, cơ sở dữ liệu thật, `teacher_browsed_dirs.json` hoặc `playwright-auth`. Loại thông tin đăng nhập/khóa dịch vụ khỏi môi trường tiến trình thử; dùng khóa Gemini giả cho nhánh AI đã mô phỏng. Dùng thư viện đã cài qua junction `node_modules`; `npx` ở chế độ không tải gói, không cài/cập nhật thư viện.
- Môi trường: Node `v24.21.0`, npm `11.19.0`, Windows. Đợt chạy bảy lệnh: **16:40:50–16:42:49**, ngày 2026-10-26 (UTC+7).

## 2. Trạng thái đóng các phát hiện

| Mã | Trạng thái Vòng 4 | Bằng chứng đối chiếu và chạy mới |
| --- | --- | --- |
| **F01** — Không thử lại sau Save; không xác nhận thành công từ cache sau lỗi API | **CLOSED** | Mã ứng dụng trùng Vòng 3. Comments giữ cờ trước gửi Save (`save-comments.ts:961`) và lọc lượt 2 (`1398–1428`); SPCK giữ chặn retry sau Save (`spck-uploader.ts:1812–1836,3434–3435,3770–3774`). T280-04a/b/d và 05a/b đạt: sau Save lỗi mạng chỉ Save một lần, VERIFIED bằng 0; cache không thay bằng chứng API. |
| **F02** — Xác nhận đúng buổi trước khi lưu | **CLOSED** | Helper vẫn kiểm tra slot tồn tại, không bị khóa, `.active` và bảng hiển thị. Comments giữ chốt sau Summary/Homework, trước mỗi học viên và ngay trước Save (`421–433,586–600,947–961`). SPCK giữ chốt tương ứng (`2577–2592,2617–2625,3387–3397`). T280-04c/c2 và 05b2 đạt. |
| **F03** — Chọn dialog hiện; cô lập backdrop; xác nhận đã đóng | **CLOSED** | `lms-helpers.ts:413–447` nguyên byte Vòng 3: `[role="dialog"]:visible`, chỉ tìm nền trong tổ tiên Dialog và kiểm tra lại số dialog sau thao tác đóng. T280-01d/e/f đạt; không bấm nền Drawer. |
| **F04** — Bao phủ các ranh giới nguy hiểm | **CLOSED trong phạm vi danh mục yêu cầu** | Bộ v280 nguyên byte Vòng 3 và chạy đủ T280-01–05; giữ ca rơi slot giữa hai học viên, lỗi cấm thử lại, SPCK, Grade Worker, syncClass và các chốt dữ liệu. Sáu lệnh kiểm chứng còn lại, gồm kiểm tra TypeScript, đều đạt. |
| **R2-01** — Slot đích biến mất vẫn Save/VERIFIED | **CLOSED** | T280-04c2 (`916–925`) xác nhận Comments Save `0`, `actualSavedSlots=[]`, VERIFIED `0`, failed `1`; T280-05b2 (`1219–1227`) xác nhận SPCK Save `0`, VERIFIED `0`, failed `1`. Không bỏ qua bước xác nhận chỉ vì slot không tồn tại. |
| **R2-02** — Helper thành công dù dialog không đóng | **CLOSED** | Chốt cuối `lms-helpers.ts:443–447` vẫn ném lỗi `Không thể đóng hộp thoại...` khi còn dialog hiện. T280-01f xác nhận có lỗi dừng, `drawerClicks=0`, `dialogClicks=1`. Sửa fixture không đụng chốt ứng dụng. |
| **R3-01** — Fixture T11 đếm dialog sai sau Escape | **CLOSED** | `scripts/test-spck-v270.ts:1422–1429` trả `modalOpen ? 1 : 0` cho selector chứa `[role="dialog"]`; Escape đặt `modalOpen=false` tại `1467–1468`. Toàn bộ T01–T16 giữ nguyên điều kiện; lệnh v270 chạy nguyên trạng sau sửa và đạt đủ 16 ca. |

Các kết quả số trong bảng là điều kiện khẳng định đã đọc và được kiểm tra trong các bộ thử mới. Vòng 4 **không chạy lại probe bổ sung Vòng 2**; không dùng kết quả cũ làm kết quả chạy mới. Việc giữ đóng dựa trên mã trùng byte Vòng 3, đọc lại các chốt và bộ v280 chạy mới với chính các tình huống 01f/04c2/05b2.

## 3. R3-01: xác nhận sửa đúng nguyên nhân, không giảm bảo vệ

**Nguyên nhân cũ:** Fixture trả `1` cho `[role="dialog"]:visible` dù `modalOpen=false`, khiến ứng dụng dừng đúng thiết kế vì tưởng hộp thoại vẫn mở. T11 chưa tới bước kiểm tra nội dung file.

**Mã hiện tại — `scripts/test-spck-v270.ts:1422–1429`:**

```typescript
count: async () =>
  selector.includes('[role="dialog"]')
    ? modalOpen
      ? 1
      : 0
    : selector.includes("0?2") || selector.includes("Xem chi tiết")
      ? 0
      : 1,
```

Nhấn mở sản phẩm đặt `modalOpen=true` (`1433–1434`); nhấn Escape đặt `modalOpen=false` (`1467–1468`). Cả selector có `:visible` cũng khớp nhánh này. Vì vậy số đếm phản ánh đúng trạng thái mở/đóng, còn cách xử lý selector khác được giữ nguyên.

**T11 vẫn thực sự kiểm tra toàn vẹn file và phản hồi:**

| Tình huống giữ nguyên | Điều kiện khẳng định | Vị trí hiện tại |
| --- | --- | --- |
| Server trả file cũ `print(1)` thay vì `print(2)` | Phải nhận lỗi `/Read-after-Write/`; đã thực sự tải file lên ít nhất một lần | `1500–1527` |
| Server chỉ trả tên/URL, thiếu bằng chứng byte | Phải nhận lỗi `/thiếu bằng chứng byte\/SHA-256/` | `1530–1557` |
| Ảnh thumbnail có dấu SHA-256 sai | Phải bị từ chối vì byte/SHA-256 không khớp | `1560–1587` |
| Phản hồi có StudentWork nhưng thiếu `latestData` | Phải nhận lỗi `/latestData/` | `1590–1629` |
| File `print(2)` và dấu thumbnail đều khớp | Nộp thành công, `attachmentsUploadedCount === 1` | `1632–1653` |

Kết quả mới ghi rõ `PASS T11`, sau đó tiếp tục `PASS T12` đến `PASS T16` và dòng kết thúc đủ 16 kịch bản. Đây là **bộ v270 của repo sau sửa fixture**, không phải bản chẩn đoán đã chỉnh thêm trong TEMP như Vòng 3.

## 4. Kết quả thực nghiệm đủ bảy lệnh

| Lệnh nguyên trạng | Kết quả | Mã thoát | Thời gian | Phạm vi được xác nhận |
| --- | --- | --- | --- | --- |
| `npx tsc --noEmit --incremental false` | **PASS** | `0` | 1.27 giây | Không có chẩn đoán lỗi |
| `npx tsx scripts/test-lms-reliability-v280.ts` | **PASS** | `0` | 80.09 giây | Đủ T280-01–05; gồm 01f/04c2/05b2 |
| `npx tsx scripts/test-spck-v272.ts` | **PASS** | `0` | 22.74 giây | Đủ V01–V16 |
| `npx tsx scripts/test-spck-v270.ts` | **PASS** | `0` | 4.06 giây | Đủ T01–T16, gồm T11 nguyên trạng sau sửa fixture |
| `npx tsx scripts/test-phase5.ts` | **PASS** | `0` | 1.74 giây | Toàn bộ bài thử Giai đoạn 5 đạt |
| `npx tsx scripts/test-phase6.ts` | **PASS** | `0` | 7.81 giây | Toàn bộ bài thử Giai đoạn 6 đạt |
| `npx tsx scripts/test-phase7.ts` | **PASS** | `0` | 1.19 giây | Toàn bộ bài thử Giai đoạn 7 đạt |

Thư mục chạy TypeScript: `F:\MINDX_project test\MINDX-AUTOMATION`. Thư mục chạy sáu bộ thử: `C:\Users\QQ\AppData\Local\Temp\mindx-v280-round4-nhg1olbc\sandbox`. Không sửa nội dung lệnh hoặc các tệp bài thử để làm chúng đạt. Bộ thử có mô phỏng dữ liệu, mạng và dịch vụ; kết quả không phải thao tác ghi lên LMS thật.

Cảnh báo `ExperimentalWarning` về xử lý TypeScript của Node trong Phase 5 và Phase 6 không làm bài thử thất bại; tất cả mã thoát vẫn bằng `0`. `git diff --check` cũng đạt.

## 5. Dấu bản mã và bằng chứng

SHA-256 của các tệp trọng tâm:

| Tệp | SHA-256 |
| --- | --- |
| `src/lib/playwright/lms-helpers.ts` | `cf1d7fa3ece52f5ee81b4b7fad575d810c1eb30049c8e03dd1ce73debb1738f4` |
| `src/lib/playwright/save-comments.ts` | `db05ff790e6e7b4536ebf9bac5e9c494754a11d58094c6f825abd776d9211877` |
| `src/lib/playwright/spck-uploader.ts` | `25c158e35c3f4ad1219125984a01bc81a865e67b9b9c53e144f580d033ff7072` |
| `src/lib/playwright/grade-worker.ts` | `402836adde656b35f9e143daeaeee57e5eb0f74832ce78260f909d4969f4f13d` |
| `src/lib/playwright/sync-class.ts` | `7df954bbe4dbd68cfefd9fd83c8b2eb513c33c288f4011e3bf9f3542aa2ba419` |
| `scripts/test-lms-reliability-v280.ts` | `dc129d5edf9c8c3eaa9be0ebab6a92c8048e8dba4b20b12857e0167f1d743133` |
| `scripts/test-spck-v270.ts` | `15dcf25a0f6679509ffb7b623a48a6731c68a095be1b40d37e8ec2131c24c176` |

Sáu dấu đầu giữ nguyên Vòng 3. Riêng v270 đổi từ `9fe3b8076b8603ca9dfcb62bf6c48226f8bf7329b4869c38734438cb176987a0` sang dấu nêu trên do sửa duy nhất biểu thức đếm dialog.

Thư mục bằng chứng cục bộ: `C:\Users\QQ\AppData\Local\Temp\mindx-v280-round4-nhg1olbc\`.

- `baseline.json`, `status-before.txt`: trạng thái đầu đợt và dấu **1,716 tệp** (bao gồm dữ liệu cục bộ được ghi dấu, không sao chép dữ liệu thật sang bản thử).
- `round3-comparison.json`, `round3-to-round4-fixture.diff`: đối chiếu 7 dấu công bố của Vòng 3, 79 tệp ứng dụng, 10 tệp dưới `scripts/` và chứng minh chỉ sửa biểu thức fixture.
- `copied-files.json`, `sandbox\`: danh sách 112 tệp đầu vào và bản mã thực tế đã chạy.
- `results.json`: đủ bảy lệnh, thư mục chạy, thời điểm, thời gian, mã thoát và dấu log. `typecheck.log` rỗng vì không có chẩn đoán; sáu `test-*.log` giữ đầy đủ đầu ra nguyên trạng.
- `pre-report-integrity.json`: sau chạy và trước ghi tài liệu, **1,716/1,716 tệp repo không đổi**, **112/112 đầu vào bản sao không đổi**.
- `docs-before\`: bản sao nguyên trạng ba tài liệu trạng thái trước cập nhật. `final-integrity.json`, `status-after.txt`: đối chiếu cuối; chỉ ba tài liệu trạng thái và báo cáo Vòng 4 được ghi trong repo.
- `review-round4.py`, `finalize-round4.py`: trình ghi bằng chứng và hoàn thiện tài liệu tại TEMP, không đưa vào mã ứng dụng.

TEMP có thể được hệ điều hành dọn. Các kết quả chính, dấu bản mã và kết luận đã được ghi trong báo cáo này. Không thay đổi HEAD, không commit, không cài/cập nhật thư viện, không sửa mã ứng dụng hoặc bài thử trong Vòng 4. Ba tài liệu trạng thái được cập nhật theo `AGENTS.md`; báo cáo Vòng 3 được giữ nguyên làm lịch sử.

## 6. Giới hạn và kết luận cuối

Chưa kiểm tra LMS/Gemini/Drive/GitHub thật, bản build Next.js, tải nhiều người dùng hoặc nghiệm thu giao diện thủ công. Thông tin lịch sử `7/7 VERIFIED` trên lớp thật chưa được Vòng 4 xác minh lại. Không kết luận hoạt động thật chỉ từ dữ liệu mô phỏng và các bộ thử đạt.

**Đã làm:** Đối chiếu bản Vòng 3, xác nhận sửa đúng R3-01 và giữ nguyên các chốt an toàn, chạy mới đủ bảy lệnh, ghi báo cáo cùng bằng chứng.

**Kết quả:** `F01`–`F04`, `R2-01`–`R2-02`, `R3-01` đều CLOSED; **7/7 lệnh PASS**, v270 đủ T01–T16. Không còn điểm phải sửa trong phạm vi kiểm chứng này.

**Chưa kiểm tra:** Dịch vụ thật và nghiệm thu thủ công như giới hạn trên.

**Việc tiếp theo:** Có thể chấp nhận cổng kiểm chứng mã v2.8.0; nghiệm thu luồng thực tế trên LMS là bước riêng khi Owner cần. Không còn yêu cầu sửa mã từ Vòng 4.

VERDICT: GO
