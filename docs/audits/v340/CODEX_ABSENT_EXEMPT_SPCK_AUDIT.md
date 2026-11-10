# Kiểm định ABSENT_EXEMPT — Vòng 3 — 10/11/2026

**VERDICT: GO**

**F01: CLOSED; F02: CLOSED; F03: CLOSED; F04: CLOSED; F05: CLOSED.**

Cả 4 cổng bắt buộc đều PASS (exit 0): TypeScript, S6 (4/4 nhóm), probe cũ (31/31) và probe bổ sung Vòng 2 (11/11). Sáu kiểm tra từng thất bại ở Vòng 2 nay đều PASS. Không phát hiện lỗi phải sửa thêm trong phạm vi này. Hai tệp dữ liệu thật giữ nguyên SHA-256 và khớp chính xác giá trị Owner cung cấp.

## Phạm vi và bản mã đã kiểm định

- Reviewer chỉ kiểm định, không triển khai bản sửa.
- HEAD: `7b8fcc456e24c5966c2aa2ecdb1ca7508e0e2e4f`. Các thay đổi vẫn nằm trong cây làm việc chưa commit; kết luận áp dụng cho đúng bản sao và dấu vân tay mã nguồn được lưu trong đợt này, không chỉ riêng HEAD.
- Đã đọc PROJECT_STATE.md trước, đối chiếu MINDX_AUTOMATION_PLAN.md, CHANGELOG.md, AGENTS.md, README.md, báo cáo Vòng 1 và báo cáo Vòng 2.
- Đã kiểm tra phần thay đổi và các phần gọi trực tiếp: điểm danh theo buổi → lịch sử/miễn nộp → danh sách/duyệt → bộ nộp LMS → lựa chọn, đếm và thử lại trên giao diện → hoàn thành Trang chủ.
- Không sửa mã ứng dụng, kiểm thử gốc, cấu hình hoặc tài liệu dự án; không commit/push. Trạng thái Git trước/sau giống nhau.
- Đúng 11 tệp cần kiểm định:
  1. `src/lib/dashboard/today-tasks.ts`
  2. `src/lib/db/sqlite.ts`
  3. `src/lib/classes/class-directory.ts`
  4. `src/app/api/spck/list/route.ts`
  5. `src/app/api/spck/approve/route.ts`
  6. `src/lib/playwright/spck-uploader.ts`
  7. `src/components/final-project/types.ts`
  8. `src/components/final-project/useSpckWorkflow.ts`
  9. `src/components/final-project/SubmitBar.tsx`
  10. `src/app/final-project/page.tsx`
  11. `scripts/test-streamline-v340-s6.ts`
- 151/151 tệp trong `src/**` và `scripts/**`, cùng 10 tệp gốc đã sao chép, khớp SHA-256 giữa dự án thật và checkout TEMP lúc tạo bản sao và sau kiểm thử. Tổng cộng **161/161 tệp giữ nguyên và khớp bản sao**.
- Giả định sử dụng: một giáo viên dùng ứng dụng cục bộ với hàng đợi trình duyệt của dự án.

## Xác minh đóng F01–F05

| Mã | Trạng thái | Bằng chứng hành vi chạy mới |
|---|---|---|
| F01 | **CLOSED** | Toàn bảng thiếu nút: giữ PRESENT, không miễn âm thầm. Dòng thiếu cả hai nút nhưng bạn khác có nút: nhận diện vắng theo quy tắc đã thống nhất. Dòng còn nút Nhận xét, thiếu Sản phẩm và bạn khác có Sản phẩm: giữ PRESENT, giữ APPROVED, không trả miễn nộp. Cả 3 kiểm tra bảo vệ mới PASS. |
| F02 | **CLOSED** | Gọi hàm dựng lịch sử và gọi trực tiếp hàm làm sạch đều giữ nguyên chuỗi JSON bị cắt dở; không đổi thành `{}`, không bỏ cảnh báo hỏng lịch sử. Hàm làm sạch trực tiếp trả false và giữ FAILED khi chưa thể xác minh lịch sử. Lịch sử VERIFIED hợp lệ của buổi khác vẫn được bảo toàn trong ca làm sạch thông thường. |
| F03 | **CLOSED** | Tự chọn Buổi 12/14 loại cả người vắng có lịch sử VERIFIED. Người vắng có bản sửa sau VERIFIED không chặn gợi ý Teaching. Lớp gồm một người có mặt VERIFIED và một người vắng VERIFIED hiển thị **1/1 HV**, miễn 1 người; toàn bộ vắng hiển thị **0/0 HV**, không gợi ý Teaching. Trang chủ không báo hoàn tất khi toàn bộ vắng ở Buổi 12/13/14, kể cả đánh giá Buổi 14. |
| F04 | **CLOSED** | Học viên vắng chưa có bản ghi SPCK vẫn có dòng ABSENT_EXEMPT trong kết quả danh sách; không tạo bản ghi SPCK giả vào dữ liệu. Danh sách học viên chuyển được điểm danh theo từng buổi. Kết xuất SubmitBar bằng dữ liệu đã chuyển qua JSON và xóa bộ nhớ đệm toàn cục vẫn hiện gợi ý Teaching đúng. |
| F05 | **CLOSED** | Gộp kết quả thử lại Buổi 14 không đưa người đã miễn trở lại danh sách thử lại. Cả phản hồi upload `success:false` và lỗi kết nối `TypeError: Failed to fetch` đều chỉ thử lại P; A tiếp tục nằm trong `skippedItems` với lý do miễn, không nằm trong `failedItems`. |

Các điểm sửa chính đã đối chiếu trong mã:

- F01: [spck-uploader.ts:2710](<F:/MINDX_project test/MINDX-AUTOMATION/src/lib/playwright/spck-uploader.ts:2710>) — khi suy luận từ nút của bạn khác, dòng hiện tại phải thiếu nút nhận xét.
- F02: [sqlite.ts:3672](<F:/MINDX_project test/MINDX-AUTOMATION/src/lib/db/sqlite.ts:3672>) và [sqlite.ts:3788](<F:/MINDX_project test/MINDX-AUTOMATION/src/lib/db/sqlite.ts:3788>) — kiểm tra lịch sử hợp lệ trước khi làm sạch.
- F03: [SubmitBar.tsx:119](<F:/MINDX_project test/MINDX-AUTOMATION/src/components/final-project/SubmitBar.tsx:119>) và [SubmitBar.tsx:211](<F:/MINDX_project test/MINDX-AUTOMATION/src/components/final-project/SubmitBar.tsx:211>) — loại người vắng khỏi số VERIFIED dùng để tính hoàn thành; số người phải nộp bằng 0 không tạo gợi ý.
- F04: [list/route.ts:94](<F:/MINDX_project test/MINDX-AUTOMATION/src/app/api/spck/list/route.ts:94>) và [class-directory.ts:401](<F:/MINDX_project test/MINDX-AUTOMATION/src/lib/classes/class-directory.ts:401>) — biểu diễn người vắng chưa có bài và chuyển điểm danh theo buổi.
- F05: [page.tsx:2211](<F:/MINDX_project test/MINDX-AUTOMATION/src/app/final-project/page.tsx:2211>) và [page.tsx:2707](<F:/MINDX_project test/MINDX-AUTOMATION/src/app/final-project/page.tsx:2707>) — giữ kết quả duyệt/miễn trong phạm vi nhánh bắt lỗi có thể đọc; tạo danh sách lỗi và thử lại từ tập còn phải nộp.

## Kết quả các cổng bắt buộc

| Lệnh chạy trong checkout TEMP | Kết quả | Bằng chứng |
|---|---|---|
| `npx tsc --noEmit --incremental false` | **PASS**, exit 0 | [tsc.log](tsc.log), [mã thoát](tsc-exit.json) |
| `npx --no-install tsx scripts/test-streamline-v340-s6.ts` | **PASS 4/4 nhóm S6-T1..T4**, exit 0 | [s6.log](s6.log), [mã thoát](s6-exit.json) |
| `npx --no-install tsx scripts/reviewer-absent-probe.tsx` | **31/31 PASS, 0 FAIL**, exit 0 | [từng ca](independent-results.json), [log](independent.log) |
| `npx --no-install tsx scripts/reviewer-absent-round2-supplement.tsx` | **11/11 PASS, 0 FAIL**, exit 0 | [từng ca](supplemental-results.json), [log](supplemental.log) |

Tổng hai bộ probe: **42/42 PASS, không lỗi thực thi**. Cả hai probe được sao chép nguyên byte từ thư mục Vòng 2, không sửa để chạy qua. [Dấu vân tay hai probe](probe-manifest.json).

Bằng chứng là chạy hành vi của mã thật: phương thức nộp LMS chạy trên DOM cục bộ chặn mạng; SubmitBar thật được kết xuất; các hàm dữ liệu/danh sách thật được gọi; hàm chọn, hàm nộp của trang và hàm gộp Buổi 14 được trích nguyên từ mã đang kiểm định, với phản hồi mạng giả lập. S6-T4 dùng giao diện cục bộ và dữ liệu giả lập. Các kiểm tra này không phải chỉ tìm chuỗi trong mã.

## Cách ly và bảo toàn dữ liệu thật

- Mọi lệnh kiểm tra chạy tại `checkout/` dưới thư mục báo cáo TEMP này.
- Trước từng tiến trình, cấp `MINDX_DB_PATH` và `MINDX_RUNNING_CLASSES_PATH` tới các đường dẫn riêng trong TEMP; `ALLOWED_LOCAL_DIRS=$env:TEMP`.
- S6 tự tạo thư mục `mindx-v340-s6-*` trong TEMP và đổi hai đường dẫn sang dữ liệu thử của nó. Các đường dẫn trong biên nhận tiến trình S6 là giá trị được cấp trước khi khởi chạy; việc đổi bên trong được ghi rõ tại đầu mã S6.
- Không sao chép dữ liệu thật, không mở tệp thật bằng SQLite. Dữ liệu kiểm thử được tạo mới trong TEMP.
- Không sao chép tệp chứa thông tin đăng nhập `.env`/`.env.local`; dùng thư viện đã cài qua junction `checkout/node_modules`, không cài thêm.
- Hai tệp thật chỉ được đọc byte để tính SHA-256. `Get-FileHash` ban đầu không đọc được DB đang được ứng dụng khác mở; đã tính lại bằng luồng đọc chia sẻ quyền đọc/ghi, không đóng ứng dụng và không mở quyền ghi từ phía Reviewer.

| Tệp thật | SHA-256 trước = sau | Đối chiếu Owner |
|---|---|---|
| `data/mindx_bot.db` | `3f996294025a94b7dd19fc4db8368babd7d24f437b49bfc834e0ef901ee1416c` | Khớp |
| `data/running_classes.json` | `171f75d944fb37c604d6c6ee31bc53b23786d5240f03c20e4252b22260c8c2b4` | Khớp |

Bằng chứng: [SHA-256 trước](hashes-before.json), [sau](hashes-after.json), [dấu vân tay mã nguồn](source-manifest.json), [đối chiếu cuối lượt](source-verification-after.json), [Git trước](git-status-before.txt), [Git sau](git-status-after.txt), [diff đã kiểm định](reviewed-diff.patch), [tổng hợp kết quả](review-summary.json).

## Chạy lại hai bộ probe

Dùng dữ liệu TEMP mới cho mỗi bộ để tránh trùng bản ghi:

```powershell
Set-Location -LiteralPath 'C:\Users\QQ\AppData\Local\Temp\mindx-absent-round3-20261110-105212\checkout'
$reviewRoot = Split-Path (Get-Location) -Parent
$reviewRunId = [guid]::NewGuid().ToString('N')
$env:ALLOWED_LOCAL_DIRS = $env:TEMP
$env:MINDX_DB_PATH = Join-Path $reviewRoot ("rerun-31-" + $reviewRunId + '.sqlite')
$env:MINDX_RUNNING_CLASSES_PATH = Join-Path $reviewRoot ("rerun-31-" + $reviewRunId + '.json')
npx --no-install tsx scripts/reviewer-absent-probe.tsx

$env:MINDX_DB_PATH = Join-Path $reviewRoot ("rerun-11-" + $reviewRunId + '.sqlite')
$env:MINDX_RUNNING_CLASSES_PATH = Join-Path $reviewRoot ("rerun-11-" + $reviewRunId + '.json')
npx --no-install tsx scripts/reviewer-absent-round2-supplement.tsx
```

## Giới hạn và việc tiếp theo

GO áp dụng cho bản mã có dấu vân tay nêu trên trong phạm vi kiểm định cục bộ. Chưa kiểm tra trên lớp hoặc tài khoản LMS/Teaching/Drive thật; chưa chạy build phát hành hoặc toàn bộ các bộ kiểm thử ngoài yêu cầu.

Đủ bằng chứng để đóng F01–F05 của đợt ABSENT_EXEMPT. Agent triển khai có thể cập nhật ba tài liệu trạng thái và đồng bộ GitHub theo quy trình dự án; Reviewer không sửa hoặc commit thay phần việc đó. Mọi chỉnh sửa mã tiếp theo cần được đối chiếu lại với bằng chứng của đợt này.

