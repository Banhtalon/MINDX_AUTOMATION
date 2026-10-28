# Kiểm định độc lập v3.1.1 — Codex, Vòng 2

**Ngày:** 28/10/2026. **Commit kiểm định:** `2b70f95174d000c621de957b4726ed51a1713812` (`2b70f95`). **Đối chiếu:** `52adb1b` và `CODEX_REVIEW_ROUND1.md`.

**Kết luận: NO-GO.** Cả **6/6 lệnh được yêu cầu đều PASS**, probe vòng 1 đạt **18/18**, Dashboard đạt đủ **8/8 tổ hợp** kích thước/chế độ màu. Bản sửa loại được cả bốn biểu hiện đã báo ở vòng 1. Tuy nhiên, kiểm tra mở rộng trong chính luồng lưu thẻ của R1-02 phát hiện **hai lỗ hổng P2 còn tồn tại**: không chuyển tiếp thao tác xóa hết thẻ khi lưu chồng nhau, và không chuyển tiếp thẻ đang chờ lưu khi điểm danh cả lớp. Hai lỗi này có thể khiến giao diện hiển thị khác dữ liệu đã lưu; vì vậy chưa đủ điều kiện GO cho toàn bộ cơ chế lưu thẻ.

## 1. Phương pháp và môi trường

- Đọc `PROJECT_STATE.md` trước, đối chiếu `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, `AGENTS.md`, skill `team-workflow` và hướng dẫn Next.js cục bộ liên quan tới layout/server-client. Theo yêu cầu trực tiếp, Codex đảm nhiệm Reviewer độc lập; không sửa mã ứng dụng để làm bài kiểm tra đạt.
- Working tree ban đầu sạch, HEAD đúng `2b70f95`. Bản sao cô lập: `C:\Users\QQ\AppData\Local\Temp\mindx-v311-review-round2-zs9eeyl3\repo`. Chép nguyên byte các tệp được Git theo dõi; không chép SQLite, `.env` thật hay hồ sơ đăng nhập. Dùng SQLite mới, cấu hình không có mật khẩu/khóa AI; bỏ các biến thông tin đăng nhập khỏi tiến trình chạy sáu cổng. Thư viện đã cài được dùng qua junction `node_modules`.
- Node `v24.15.0`, TypeScript `7.0.2`; dùng `npx.cmd` trên Windows với đúng chương trình/tham số yêu cầu. Không chạy test ghi/xóa dữ liệu trên DB Owner, không mở LMS thật, không gọi Gemini trả phí.
- Probe nghiệp vụ gọi handler GET/POST và SQLite thật. Bộ mô phỏng hooks thực thi hàm xử lý của component thật; chỉ thay tầng vận chuyển mạng để điều khiển thứ tự phản hồi hoặc tạo HTTP 500. AI được thay phản hồi vận chuyển bằng mẫu.
- Hai probe trình duyệt chạy nối tiếp, mỗi lần một persistent BrowserContext cô lập, thao tác trang qua SequentialTaskQueue. Dashboard dùng `./playwright-auth` trong bản sao tạm. CSS được **biên dịch mới từ mã hiện tại bởi cổng 4 trước cổng 6**, không dùng kết quả CSS cũ để kết luận bố cục.
- Đã đối chiếu SHA-256 của 10 tệp nguồn/probe trong bản sao với working tree: khớp. Hồ sơ vòng này nằm riêng ở `docs/audits/v311/round2/`; giữ nguyên bằng chứng vòng 1 và v3.1.0 trong working tree.

## 2. Đối chiếu bốn finding vòng 1

| Finding | Kết quả vòng 2 | Bằng chứng |
|---|---|---|
| **R1-01 — Test xóa nhận xét lớp thật** | **CLOSED** đối với lỗi xóa dữ liệu ngoài fixture | `scripts/test-quick-tags-v300.ts:165`, `:279`: dùng lớp tổng hợp, dọn bốn tổ hợp khóa fixture thay vì xóa cả lớp. Sentinel lớp thật vẫn tồn tại trong probe gốc. Probe mở rộng so sánh **toàn bộ bản ghi** trước/sau: sentinel trùng đúng khóa sentinel của test, bản ghi khác buổi và bản ghi khác học viên trong lớp tổng hợp đều nguyên vẹn. |
| **R1-02 — Nhập liên tiếp, lần lưu đầu lỗi làm mất thẻ kế thừa** | **Ca tái hiện gốc đã hết lỗi; phạm vi lưu thẻ chưa hoàn tất** | `src/app/session-comments/page.tsx:1123`, `:1173`, `:1262`, `:1290`, `:1466`: giữ nguồn kế thừa, theo dõi thẻ chờ lưu. Hai ghi chú chồng nhau/lần đầu HTTP 500 nay lưu đủ thẻ vào SQLite, giữ nhãn nguồn; ghi chú rồi điểm danh đơn lẻ cũng đạt. Tuy nhiên, còn `R2-01` và `R2-02` bên dưới. |
| **R1-03 — Kế thừa sai thời gian khi không biết số buổi** | **CLOSED** | `src/app/api/session-comments/list/route.ts:100`, `:111`, `:141`: chỉ nhận số nguyên dương từ lịch hoặc hậu tố SESS hợp lệ, bắt buộc cả hai số hợp lệ và số lịch sử nhỏ hơn hiện tại. Probe gốc và chín ca số buổi bổ sung đều đạt. |
| **R1-04 — Dashboard tràn chiều cao laptop** | **CLOSED trong phạm vi render được yêu cầu** | `src/app/page.tsx:87`, `:128`, `src/app/layout.tsx:34`, `:43`: đủ 4 kích thước × 2 chế độ màu có `scrollHeight === height`, không tràn ngang, hai cột cân nhau, khoảng cuối 8px. Đã xem ảnh 1366×768 Sáng/Tối. |

R1-01 hiện giới hạn việc dọn dữ liệu vào namespace fixture cố định; bản thân test không tự tạo DB tạm. Kết quả đóng lỗi xóa dữ liệu thật không đồng nghĩa mọi lệnh test của dự án đều có thể chạy tùy ý trên DB đang sử dụng.

Với R1-03, probe mở rộng loại hậu tố số tùy ý `BAD_77`, số 0, số âm, số thập phân và buổi tương lai; chấp nhận `SESS_0002`, buổi trước hợp lệ và số buổi hợp lệ từ bảng lịch ngay cả khi ID không có đuôi SESS. Giữ được chọn buổi gần nhất, chuẩn hóa legacy sang Robotics và tôn trọng xóa trắng đã lưu.

## 3. Hai lỗi còn mở trong luồng R1-02

### R2-01 — P2: Thẻ chờ lưu rỗng không được chuyển tiếp, làm mất thao tác xóa hết thẻ

**Vị trí:** `src/app/session-comments/page.tsx:1124`, `:1174`. **Liên quan:** `:1079`, `:1263`, `:1356`.

Hai nhánh ghi chú/điểm danh chỉ gắn `quickTags` khi `target?.quickTags?.length` khác 0. Vì vậy, dù `__qt_pending__<studentId>` đang báo có thay đổi chưa được xác nhận, giá trị hợp lệ `[]` vẫn bị bỏ khỏi request tiếp theo. Thao tác gỡ thẻ đã xóa `inheritedFromSession`; khi phản hồi lỗi của lần lưu cũ về sau một chỉnh sửa mới, bảo vệ phản hồi cũ giữ nguyên giao diện nhưng không khôi phục thao tác chưa lưu.

**Tái hiện, đã chạy với cả ghi chú và điểm danh đơn lẻ:**

1. Buổi hiện tại có một thẻ đã lưu, hoặc đang nhận một thẻ từ Buổi 2.
2. Giáo viên gỡ thẻ cuối cùng; request đầu chứa `quickTags: []`, được giữ ở trạng thái chờ.
3. Giáo viên nhập ghi chú hoặc điểm danh. Request thứ hai thành công nhưng **không có trường `quickTags`**.
4. Cho request đầu trả HTTP 500. Giao diện giữ danh sách thẻ rỗng.
5. Nếu thẻ đã lưu ở buổi hiện tại, SQLite vẫn giữ thẻ cũ. Nếu thẻ vừa kế thừa, SQLite có `[]` nhưng không có dấu xác nhận xóa trong `fields.quickTags`; thực thi tải lại component thật lại điền thẻ từ Buổi 2.

**Kết quả quan sát:** bốn ca `clear/note`, `clear/attendance`, `inherit-clear/note`, `inherit-clear/attendance` có **8 assertion FAIL**: bốn request thiếu `quickTags`, hai bản ghi DB còn thẻ cũ, hai lần tải lại tự điền thẻ đã gỡ. Giao diện trước tải lại vẫn rỗng, đúng với tình huống người dùng tưởng đã xóa thành công.

**Tác động:** ý định xóa thẻ không được lưu; lần soạn nhận xét sau có thể tiếp tục dựa vào thẻ giáo viên đã bỏ. Đây là thiếu sót về lưu dữ liệu, không chỉ mất nhãn nguồn trên giao diện.

**Hướng sửa:** khi có thay đổi thẻ đang chờ lưu, đính kèm cả mảng rỗng; tách điều kiện “có thay đổi chưa xác nhận” khỏi điều kiện “thẻ kế thừa có nội dung”. Giữ bảo vệ phản hồi cũ và ghi metadata xác nhận thao tác xóa. Kiểm thử cả DB lẫn tải lại trang.

### R2-02 — P2: Điểm danh cả lớp bỏ qua thẻ đã chỉnh đang chờ lưu

**Vị trí:** `src/app/session-comments/page.tsx:1561`, `:1570`. **Liên quan:** `:1079`, `:1263`.

`handleConfirmAllPresent` chỉ chuyển tiếp thẻ khi `curStu.inheritedFromSession` còn tồn tại, không xét `__qt_pending__<studentId>`. Trong khi đó, thao tác sửa thẻ chủ động xóa dấu kế thừa ngay. Nhánh điểm danh đơn lẻ đã bổ sung kiểm tra pending, nhánh cả lớp còn thiếu.

**Tái hiện:**

1. Học viên đang có thẻ Robotics tốt đã lưu. Giáo viên thêm `👀 Mất tập trung`.
2. Giữ request lưu thẻ đầu ở trạng thái chờ; giao diện có cả hai thẻ.
3. Bấm xác nhận “Có mặt” cả lớp (`handleConfirmAllPresent(false)`). Request này thành công nhưng không có `quickTags`.
4. Cho request lưu thẻ đầu trả HTTP 500.
5. Giao diện vẫn có cả hai thẻ; SQLite chỉ còn thẻ Robotics tốt trước đó. Điểm danh đã được lưu và thông báo điểm danh thành công.

**Kết quả:** ca `replace/bulk` có **2 assertion FAIL**: request điểm danh không mang thẻ chờ lưu; DB thiếu `👀 Mất tập trung`. Assertion bảo toàn giao diện trước phản hồi cũ đạt, chứng minh sự lệch giữa giao diện và dữ liệu lưu.

**Hướng sửa:** áp dụng quy tắc chuyển tiếp thẻ chờ lưu thống nhất cho ghi chú, điểm danh đơn lẻ và cả lớp, bao gồm `[]`. Khi xác nhận mặc định thẻ tốt, cần giữ ý định sửa/xóa chủ động chưa được xác nhận theo quy tắc sản phẩm. Thêm ca request lưu thẻ lỗi trong lúc điểm danh hàng loạt thành công.

**Phân biệt nguồn gốc lỗi:** cả 10 assertion nêu trên cũng thất bại khi chỉ thay component bằng mã `52adb1b`, giữ endpoint/test runner hiện tại. Đây là **hai thiếu sót có sẵn vừa phát hiện**, không có bằng chứng chúng do `2b70f95` tạo mới. So sánh này chỉ dùng để xác định nguồn gốc component, không phải kiểm định đầy đủ commit cũ. Chúng vẫn thuộc cơ chế lưu thẻ mà bản sửa R1-02 cần hoàn thiện; không xem việc probe vòng 1 đã đạt là đủ để đóng toàn bộ phạm vi này.

## 4. Kết quả sáu cổng được yêu cầu

| # | Lệnh | Exit | Kết quả chạy mới |
|---|---|---:|---|
| 1 | `npx tsc --noEmit --incremental false` | 0 | PASS, không lỗi TypeScript |
| 2 | `npx tsx scripts/test-quick-tags-v300.ts` | 0 | PASS toàn bộ Quick Tags/Checkpoint và kiểm tra sentinel |
| 3 | `npx tsx scripts/test-phase4-codex-repros.ts` | 0 | PASS toàn bộ bộ hồi quy hiện có tới Round 17 |
| 4 | `node docs/audits/v310/round3/theme-probe.mjs` | 0 | PASS đủ 4 tổ hợp màu hệ điều hành/ứng dụng; CSS được dựng mới |
| 5 | `npx tsx docs/audits/v311/independent-probe.ts` | 0 | **18 PASS / 0 FAIL**, toàn bộ ca vòng 1 đạt |
| 6 | `npx tsx docs/audits/v311/dashboard-probe.tsx` | 0 | **8/8 tổ hợp đạt** các assertion, bao gồm chiều cao |

Log phase4 có lỗi mạng do chính test chủ động tạo; không phải cổng thất bại. Cảnh báo `stripTypeScriptTypes` thuộc API thử nghiệm của Node. Đã chạy thêm TypeScript sau khi thêm các tệp probe mở rộng trong bản sao cô lập: exit 0.

**Probe mở rộng của Reviewer:** `npx tsx docs/audits/v311/round2/extended-probe.ts` trả **exit 1**, **47 PASS / 10 FAIL trên 57 assertion**. Bộ này bao gồm lại 18 assertion gốc, không cộng 18 lần nữa vào tổng. Mười assertion lỗi thuộc đúng hai nguyên nhân R2-01/R2-02. Các ca bổ sung thẻ không rỗng rồi ghi chú/điểm danh đơn lẻ trong lúc lần lưu đầu lỗi đều đạt.

## 5. Số đo Dashboard

| Viewport | Chiều cao tài liệu Sáng | Chiều cao tài liệu Tối | Tràn ngang | Khoảng thanh lớp–footer |
|---|---:|---:|---|---:|
| 1440×900 | 900px | 900px | Không | 8px |
| 1366×768 | 768px | 768px | Không | 8px |
| 1920×1080 | 1080px | 1080px | Không | 8px |
| 1024×768 | 768px | 768px | Không | 8px |

Các phép đo dùng Dashboard/TopNavbar thật, lớp layout thật, dữ liệu tổng hợp đủ 5 lớp gần đây và CSS mới. Hai cột cùng hàng/cùng chiều cao qua đủ tám tổ hợp. Ảnh 1366×768 Sáng/Tối cho thấy footer hiển thị đầy đủ và không thấy nội dung bị cắt. Chế độ màu được đặt trực tiếp vào `data-theme` trong render tĩnh; nhãn nút theme không được hydration để đổi theo, không dùng ảnh này để kết luận hoạt động của nút chuyển màu.

## 6. Hồ sơ bàn giao và giới hạn

Tất cả bằng chứng mới ở `docs/audits/v311/round2/`:

- `gate-results.json`, `gate1.log`–`gate6.log`: lệnh, thời gian, mã thoát và log đầy đủ của sáu cổng.
- `independent-results.json`, `dashboard-results.json`, `theme-probe-results.json`, `probe.css`: kết quả chạy mới và CSS đã dùng.
- `extended-probe.ts`, `extended-results.json`, `extended-probe.log`: probe mở rộng có thể tái hiện, chỉ cho chạy trong bản sao tạm mang tiền tố `mindx-v311-review-`.
- `baseline-probe.ts`, `baseline-page.txt`, `baseline-results.json`, `baseline-probe.log`: mã component `52adb1b` và so sánh nguồn gốc của hai lỗi còn mở.
- `dashboard-1366-light.png`, `dashboard-1366-dark.png`, `dashboard-1440-light.png`, `dashboard-1440-dark.png`: ảnh mới.
- `reviewed-source-hashes.json`: dấu SHA-256 của các tệp nguồn/probe được đối chiếu.

Không chạy bản dựng production, toàn bộ bộ test dự án, trình duyệt có hydration trên cả năm trang hay lưu thật lên LMS. Thay đổi layout dùng chung có phạm vi rộng hơn Dashboard; vòng này không nghiệm thu đầy đủ các trang khác. Probe hooks không thay thế kiểm thử tương tác React trong trình duyệt. Những giới hạn này không làm mất hiệu lực các lỗi lưu dữ liệu đã tái hiện qua handler và SQLite thật.

Không thay đổi mã ứng dụng, test gốc, DB Owner, `next-env.d.ts` hoặc các hồ sơ audit cũ. Chỉ thêm báo cáo/bằng chứng vòng 2 và cập nhật ba tài liệu quản lý theo AGENTS.md.

## 7. Điều kiện chuyển GO

1. Đóng R2-01: chuyển tiếp cả `quickTags: []` tới request kế tiếp khi thao tác xóa còn chờ; DB và giao diện sau tải lại phải giữ đúng việc xóa.
2. Đóng R2-02: điểm danh cả lớp phải bảo toàn thẻ đang chờ lưu kể cả khi request lưu thẻ đầu thất bại; không ghi đè chỉnh sửa mới bởi phản hồi cũ.
3. Chạy lại đủ sáu cổng, giữ 18/18 ca vòng 1 và 8/8 tổ hợp Dashboard; probe mở rộng phải không còn lỗi. Không cần sửa điều kiện kiểm tra để bỏ qua mảng rỗng hoặc tình huống điểm danh cả lớp.

**VERDICT: NO-GO**
