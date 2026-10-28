**Vòng 3: 10 mục CLOSED, 4 mục OPEN — chưa đủ điều kiện phát hành.**

Đã đối chiếu báo cáo Vòng 1, Vòng 2 và kế hoạch được chỉ định, kiểm tra working tree trên nền commit `060f04b`, bao gồm các thay đổi chưa commit. Không sửa file, không mở SQLite qua ứng dụng, không gọi Teaching/LMS/Gemini thật. Báo cáo được trả trực tiếp dưới đây.

| Mục | Trạng thái | Kết quả kiểm định |
|---|---|---|
| F01 | **CLOSED** | Đối chiếu đủ bốn trường dự án cho cả nhánh mới/có sẵn; truyền dữ liệu đọc lại vào bước kiểm tra hash. [Service:800](</D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/teaching-project-service.ts:800>) |
| F02 | **CLOSED** | Tải dự án không tự duyệt hoặc đánh dấu VERIFIED; dữ liệu nhập vào bắt đầu ở DRAFT. [Service:543](</D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/teaching-project-service.ts:543>) |
| F03 | **CLOSED** | Các thao tác giữ mã lớp/sequence và bỏ phản hồi cũ; khóa thao tác khi lớp chưa tải xong. [Page:370](</D:/MY PROJECT/MINDX_AUTOMATION/src/app/teaching-projects/page.tsx:370>) |
| F04 | **CLOSED** | Mặc định không ghi đè nháp; lỗi mạng giữ bản cục bộ; cập nhật metadata riêng. [Service:453](</D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/teaching-project-service.ts:453>) |
| F05 | **CLOSED** | Kiểm tra trạng thái, công việc và phân công ở cả SQLite/Teaching trước lượt ghi đầu tiên. Các ca từ chối bổ sung đều không gọi ghi. [Service:1053](</D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/teaching-project-service.ts:1053>) |
| F06 | **OPEN** | Họ tên trùng đã xử lý đúng, nhưng tên gọi một từ không dấu vẫn lọt qua. [Generator:612](</D:/MY PROJECT/MINDX_AUTOMATION/src/lib/gemini/teaching-project-generator.ts:612>) |
| F07 | **CLOSED** | Các route thay đổi bản nháp bắt buộc phiên bản; nhánh sync bản đã duyệt và kết quả AI/LMS vẫn kiểm tra xung đột. [Sync route:90](</D:/MY PROJECT/MINDX_AUTOMATION/src/app/api/teaching-projects/sync/route.ts:90>) |
| F08 | **CLOSED** | Giữ nguyên `20.4`; validator từ chối số lẻ; `approveDraft` trả thất bại khi validation không đạt. [SQLite:4814](</D:/MY PROJECT/MINDX_AUTOMATION/src/lib/db/sqlite.ts:4814>) |
| F09 | **OPEN — tái mở** | Khóa thiếu đã bị chặn, nhưng tầng transport biến giá trị không hợp lệ thành `0`, dẫn đến xác nhận giả ở mức 0%. [Service:307](</D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/teaching-project-service.ts:307>) |
| F10 | **CLOSED** | Parser ưu tiên YMD, từ chối ngày không tồn tại và phân biệt đúng năm nhuận. [Parser:30](</D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/sync-class.ts:30>) |
| F11 | **OPEN** | Bộ chờ vẫn có thể nhận API khác hoặc mã lớp có chung tiền tố, rồi dùng DOM cũ để báo LMS_LIVE. [Sync-class:1355](</D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/sync-class.ts:1355>) |
| F12 | **CLOSED** | Các màu hover/banner đã sửa; tính từ palette hiện tại cho chữ trắng trên nền đậm đạt tối thiểu khoảng **5,37:1**. Chưa xác minh lại bằng trình duyệt. [Page:1452](</D:/MY PROJECT/MINDX_AUTOMATION/src/app/teaching-projects/page.tsx:1452>) |
| F13 | **OPEN** | Đã bổ sung nhiều ca yêu cầu, nhưng còn thiếu các ca lọt lỗi bên dưới và bộ kiểm thử vẫn ghi cache cấu hình thật. [Test:240](</D:/MY PROJECT/MINDX_AUTOMATION/scripts/test-teaching-project-v320.ts:240>) |
| F14 | **CLOSED** | Đã có Giai đoạn 8, công việc/API/điều kiện nghiệm thu; endpoint trong state/changelog đã thống nhất `hocsinh.php`. [Plan:612](</D:/MY PROJECT/MINDX_AUTOMATION/MINDX_AUTOMATION_PLAN.md:612>) |

**F06 — P1: còn lọt tên gọi không dấu.**

Đã chạy thân hàm sanitizer trích từ mã hiện tại trong bộ nhớ, chỉ bỏ chú thích kiểu TypeScript và giả lập nguồn danh sách học viên:

| Đầu vào | Đầu ra thực tế |
|---|---|
| `Trần Gia Khôi` | `STUDENT_02` |
| `Tran Gia Khoi` | `STUDENT_02` |
| `Khôi` | `STUDENT_01` |
| `Khoi` | **`Khoi`** |
| `Bach` | **`Bach`** |

Bốn lượt xử lý đã có, nhưng lượt tên gọi một từ chỉ thay dạng có dấu. Cần bổ sung dạng không dấu và kiểm thử xuyên suốt nội dung gửi AI trước khi đóng F06.

**F11 — P2: chưa khóa đúng yêu cầu tìm lớp.**

Bộ lọc chấp nhận URL chứa hostname LMS hoặc `graphql`, rồi kiểm tra mã lớp bằng `includes`. Nó chưa xác định đúng nghiệp vụ tìm lớp và chưa so khớp chính xác giá trị mã lớp.

Chạy thân hàm thực tế với trang/phản hồi giả lập trong bộ nhớ:

| Tình huống | Kết quả thực tế |
|---|---|
| Tìm lớp trả HTTP 403 | Dừng; không đọc DOM, không gọi ghi cache |
| Timeout | Dừng; không đọc DOM, không gọi ghi cache |
| HTTP 200 có GraphQL errors | Dừng; không đọc DOM, không gọi ghi cache |
| HTTP 200 đúng yêu cầu | Thành công |
| `GetStudents` HTTP 200 đến trước yêu cầu tìm lớp HTTP 403 | **Thành công sai; trả LMS_LIVE và gọi ghi cache** |
| Phản hồi cho `SYNTH-LMS-F11-OTHER`, đang tìm `SYNTH-LMS-F11` | **Vẫn được chấp nhận** |

Cần nhận diện chính xác yêu cầu tìm lớp, mã lớp và phản hồi tương ứng; API khác không được dùng để xác nhận DOM cũ.

**F09 — P2: dữ liệu đọc lại sai vẫn được coi là 0%.**

Tầng transport dùng:

```ts
Number(progress_percent) || 0
```

Phép thử kết hợp thân hàm transport và cập nhật tiến độ hiện tại cho thấy:

| Dữ liệu đọc lại | Kết quả khi yêu cầu lưu 0% |
|---|---|
| Không có khóa | Bị từ chối đúng |
| `progress_percent: null` | **Báo thành công sai** |
| `progress_percent: ""` | **Báo thành công sai** |
| `progress_percent: "not-a-number"` | **Báo thành công sai** |
| `progress_percent: 0` | Thành công đúng |

Cần từ chối giá trị không hợp lệ trước khi chuyển đổi hoặc chuẩn hóa. Đây là thiếu sót được phát hiện thêm trong nhánh transport; chưa có bằng chứng để quy là hồi quy mới sau Vòng 2.

**F13 — P2: kiểm thử còn thiếu và chưa cô lập toàn bộ dữ liệu.**

Đã có các ca 403/timeout/200, họ tên trùng, tỷ trọng lẻ, tám trường hợp sai metadata dự án, công việc chưa duyệt, phân công rỗng, kiểm tra hover và mount component React thật qua esbuild.

Tuy nhiên:

- Chưa bao phủ tên gọi không dấu, API khác cùng mã lớp và tiến độ đọc lại không hợp lệ.
- Ca LMS thành công gọi `saveRunningClasses`, ghi vào `data/running_classes.json` thật; sau đó test khôi phục bản chụp cũ tại [dòng 404](</D:/MY PROJECT/MINDX_AUTOMATION/scripts/test-teaching-project-v320.ts:404>). Cách này có thể ghi đè cập nhật đồng thời hoặc để lại dữ liệu giả nếu tiến trình bị ngắt.
- Cần đưa cache cấu hình vào môi trường thử riêng, rồi chạy lại toàn bộ suite.

Các phép thử Vòng 3 chạy trong bộ nhớ với phụ thuộc giả lập. **Không chạy suite đầy đủ, TypeScript, build hoặc nghiệm thu trình duyệt/dịch vụ thật**; không coi tuyên bố “6/6 PASS” trong tài liệu là kết quả chạy mới của vòng này.

SHA-256 của `data/mindx_bot.db` trước/sau trùng nhau:

```text
0016D3096C5F0E195DED58799C501697AE9E5F700B5E6053EA2C7E0A34351AE8
```

**VERDICT: NO-GO**