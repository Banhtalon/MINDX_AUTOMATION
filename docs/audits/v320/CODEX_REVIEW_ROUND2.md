**Vòng 2: chưa đủ điều kiện phát hành — 7 CLOSED, 7 OPEN.**

Đã đối chiếu mã hiện tại với [báo cáo Vòng 1](</D:/MY PROJECT/MINDX_AUTOMATION/docs/audits/v320/CODEX_REVIEW_ROUND1.md>) và kế hoạch được chỉ định. Phạm vi là working tree trên nền commit `060f04b`, bao gồm các thay đổi chưa commit.

Không sửa tệp, không mở SQLite bằng ứng dụng, không gọi Teaching/LMS/Gemini thật. Báo cáo được trả trực tiếp dưới đây.

| Finding | Trạng thái | Kết quả đối chiếu |
|---|---|---|
| F01 | **CLOSED** | So sánh đủ bốn trường dự án cho cả dự án mới và có sẵn; truyền dữ liệu đọc lại vào `verifiedProject` để kiểm tra hash. [Service:800](</D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/teaching-project-service.ts:800>), [SQLite:5378](</D:/MY PROJECT/MINDX_AUTOMATION/src/lib/db/sqlite.ts:5378>). |
| F02 | **CLOSED** | Tải dữ liệu không tự duyệt/xác nhận; tự bổ sung học viên vào công việc rỗng đã bật `wasAutoCompleted`. [Service:543](</D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/teaching-project-service.ts:543>), [Generator:404](</D:/MY PROJECT/MINDX_AUTOMATION/src/lib/gemini/teaching-project-generator.ts:404>). |
| F03 | **CLOSED** | Các thao tác bất đồng bộ chụp và đối chiếu lớp/sequence; nút ghi bị khóa khi tải lớp hoặc lớp chưa sẵn sàng. [Page:382](</D:/MY PROJECT/MINDX_AUTOMATION/src/app/teaching-projects/page.tsx:382>), [Page:562](</D:/MY PROJECT/MINDX_AUTOMATION/src/app/teaching-projects/page.tsx:562>), [Page:1441](</D:/MY PROJECT/MINDX_AUTOMATION/src/app/teaching-projects/page.tsx:1441>). |
| F04 | **CLOSED** | Mặc định không force refresh; lỗi mạng giữ bản nháp; cập nhật metadata không tăng phiên bản hay ghi lại nội dung. [Page:219](</D:/MY PROJECT/MINDX_AUTOMATION/src/app/teaching-projects/page.tsx:219>), [Service:453](</D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/teaching-project-service.ts:453>), [SQLite:5050](</D:/MY PROJECT/MINDX_AUTOMATION/src/lib/db/sqlite.ts:5050>). |
| F05 | **OPEN** | Vẫn ghi được khi danh sách người được giao rỗng hoặc công việc chưa thuộc danh sách đã duyệt. |
| F06 | **OPEN** | Xử lý tên theo từng học viên có thể để lọt một phần họ tên và gán sai mã ẩn danh. |
| F07 | **CLOSED** | Bốn route bắt buộc phiên bản; kiểm tra xung đột đã có cả nhánh sync dự án đang được duyệt và trước khi lưu kết quả AI/LMS. [Main:111](</D:/MY PROJECT/MINDX_AUTOMATION/src/app/api/teaching-projects/route.ts:111>), [Sync:90](</D:/MY PROJECT/MINDX_AUTOMATION/src/app/api/teaching-projects/sync/route.ts:90>), [AI:146](</D:/MY PROJECT/MINDX_AUTOMATION/src/app/api/teaching-projects/generate-ai/route.ts:146>), [Dates:89](</D:/MY PROJECT/MINDX_AUTOMATION/src/app/api/teaching-projects/fetch-lms-dates/route.ts:89>). |
| F08 | **OPEN** | Đã giữ mảng hơn năm việc, người được giao rỗng và deadline rỗng; tỷ trọng số lẻ vẫn bị làm tròn trước khi kiểm tra. |
| F09 | **CLOSED** | Bắt buộc có khóa đọc lại; không còn mặc định khóa thiếu thành `0%`. [Service:1132](</D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/teaching-project-service.ts:1132>). |
| F10 | **CLOSED** | Ưu tiên YMD và kiểm tra ngày lịch bằng đối chiếu ngược. [Parser:30](</D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/sync-class.ts:30>). |
| F11 | **OPEN** | Vẫn trả `LMS_LIVE` sau timeout hoặc HTTP 403 nếu còn dòng lớp trên trang. |
| F12 | **OPEN** | Badge thông thường đã sửa; nút đồng bộ vẫn thiếu tương phản khi rê chuột. |
| F13 | **OPEN** | Đã cô lập DB, bổ sung allowlist và kiểm tra hash; bộ kiểm thử chưa bao phủ đầy đủ các lỗi còn lại. |
| F14 | **OPEN** | State/changelog đã bổ sung; kế hoạch gốc chỉ đổi dòng phiên bản, chưa bổ sung nội dung triển khai v3.2.0. |

Các mục còn mở có bằng chứng và điều kiện đóng như sau.

**F05 — P1: kiểm tra phân công vẫn có đường vượt qua.**  
[Service:1105](</D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/teaching-project-service.ts:1105>) chỉ từ chối học viên không được giao khi `taskAssignees.length > 0`. Vì vậy `assigned_students = []` lại cho phép ghi. Đồng thời, danh sách công việc được kiểm tra lấy từ Teaching, chưa đối chiếu danh sách công việc đã duyệt trong SQLite.

Phép thử bằng thân hàm hiện tại, với kho dữ liệu và transport giả lập trong bộ nhớ, cho kết quả:

| Tình huống | Kết quả hiện tại |
|---|---|
| Công việc có danh sách được giao rỗng | `success: true`, gọi ghi một lần |
| Công việc cùng dự án nhưng ngoài danh sách đã duyệt | `success: true`, gọi ghi một lần |
| ID công việc không tồn tại trong dự án | Bị chặn trước khi ghi |

Cần kiểm tra đồng thời danh sách đã duyệt, quyền sở hữu trên Teaching và học viên thực sự được phân công; danh sách phân công rỗng phải bị từ chối.

**F06 — P1: ẩn danh sai khi tên học viên trùng nhau.**  
[Generator:531](</D:/MY PROJECT/MINDX_AUTOMATION/src/lib/gemini/teaching-project-generator.ts:531>) thay tên đầy đủ, tên hai từ và tên gọi ngay trong cùng một lượt của từng học viên. Tên gọi của người đầu có thể phá vỡ tên đầy đủ của người sau trước khi tên đó được xử lý.

Phép thử thân hàm hiện tại:

```text
Danh sách:
STUDENT_01 = Nguyễn Minh Khôi
STUDENT_02 = Trần Gia Khôi

Đầu vào: Trần Gia Khôi
Đầu ra:  Trần Gia STUDENT_01
```

Các bổ sung về SQLite, email/SĐT, model cố định và `INSUFFICIENT_INFO` đã có. Tuy nhiên, lỗi trên vẫn để lọt thông tin nhận dạng. Cần xử lý tên đầy đủ của toàn bộ danh sách trước khi xử lý các dạng tên ngắn, đồng thời kiểm tra trường hợp tên trùng/chồng lấn.

**F08 — P2: tỷ trọng sai vẫn được sửa ngầm rồi duyệt.**  
[SQLite:4814](</D:/MY PROJECT/MINDX_AUTOMATION/src/lib/db/sqlite.ts:4814>) gọi `Math.round(rawWeight)` trước khi [validator:4953](</D:/MY PROJECT/MINDX_AUTOMATION/src/lib/db/sqlite.ts:4953>) kiểm tra số nguyên.

Phép thử normalizer và validator hiện tại:

```text
Đầu vào:       20.4 × 5 = 102%
Sau chuẩn hóa: 20   × 5 = 100%
Kết quả duyệt: ok = true
```

Cần giữ giá trị số lẻ để từ chối rõ ràng, kể cả qua luồng lưu nháp rồi duyệt.

**F11 — P2: phản hồi mạng chưa xác nhận đúng nghiệp vụ.**  
Bộ lọc tại [Sync-class:1333](</D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/sync-class.ts:1333>) chấp nhận bất kỳ URL chứa `graphql`, `/classes` hoặc `/api/`. Timeout trở thành `null`; HTTP 403 được bỏ qua.

Trong phép thử thân hàm với trang giả lập còn dòng lớp hợp lệ:

| Phản hồi tìm kiếm | Kết quả |
|---|---|
| Timeout | `success: true`, `source: "LMS_LIVE"` |
| HTTP 403 | `success: true`, `source: "LMS_LIVE"` |

Cả hai trường hợp còn đi tới bước ghi cache. Route đã chặn kết quả `success: false`, nhưng chưa bảo vệ được khi scraper báo thành công sai. Cần xác nhận đúng yêu cầu tìm lớp, mã lớp và phản hồi thành công; lỗi mạng không được sử dụng dòng cũ để xác nhận dữ liệu live.

**F12 — P2: trạng thái hover chưa đạt tương phản.**  
Đã bỏ `.mindx-badge-*`; sáu màu badge nền đậm có tương phản tính từ palette tối thiểu khoảng **5,37:1**.

Tuy nhiên, [nút Duyệt & Đẩy:1452](</D:/MY PROJECT/MINDX_AUTOMATION/src/app/teaching-projects/page.tsx:1452>) dùng `hover:bg-emerald-600` với chữ trắng. Theo [palette của repo](</D:/MY PROJECT/MINDX_AUTOMATION/node_modules/tailwindcss/theme.css:88>), tương phản khoảng **3,67:1**, dưới yêu cầu 4,5:1. Cần sửa màu hover và kiểm tra các trạng thái nút trên bốn tổ hợp theme.

**F13 — P2: bộ kiểm thử chưa đủ để đóng các lỗi.**  
Các phần cô lập DB, đọc file qua allowlist và so sánh SHA-256 đã được bổ sung. Nhưng:

- [TP-06:755](</D:/MY PROJECT/MINDX_AUTOMATION/scripts/test-teaching-project-v320.ts:755>) chỉ tìm tên biến bảo vệ trong source, chưa thử đổi lớp với phản hồi chậm.
- [TP-06:778](</D:/MY PROJECT/MINDX_AUTOMATION/scripts/test-teaching-project-v320.ts:778>) vẫn dựng HTML riêng, không render trang React thực tế và không kiểm tra hover.
- Chưa có kiểm thử lỗi mạng scraper/route lấy ngày LMS.
- Thiếu các ca tên trùng, tỷ trọng số lẻ, phân công rỗng và công việc ngoài danh sách đã duyệt.
- Ca sai metadata dự án mới chỉ kiểm tra tên dự án có sẵn, chưa phủ đủ bốn trường và hai nhánh tạo mới/có sẵn.

Cần bổ sung các ca này và chạy trong môi trường cô lập.

**F14 — P2: tài liệu cập nhật chưa đầy đủ.**  
Diff của [MINDX_AUTOMATION_PLAN.md:5](</D:/MY PROJECT/MINDX_AUTOMATION/MINDX_AUTOMATION_PLAN.md:5>) chỉ thay dòng phiên bản; chưa bổ sung phần công việc, API, kiểm thử và điều kiện nghiệm thu v3.2.0. Ngoài ra, [CHANGELOG.md:19](</D:/MY PROJECT/MINDX_AUTOMATION/CHANGELOG.md:19>) ghi endpoint `api_student_portal.php`, trong khi transport hiện gọi `hocsinh.php`.

Các kết luận `CLOSED` ở trên là kết luận kiểm định mã nguồn. Vòng này **không chạy toàn bộ suite, build hay nghiệm thu trình duyệt/LMS thật**. Các phép thử bổ sung chạy trong bộ nhớ, với phụ thuộc giả lập; parser ngày cũng xác nhận đúng `2026-10-28`, từ chối `31/02/2026` và phân biệt năm nhuận.

SHA-256 của `data/mindx_bot.db` trước/sau trùng nhau:

```text
0016D3096C5F0E195DED58799C501697AE9E5F700B5E6053EA2C7E0A34351AE8
```

**VERDICT: NO-GO**