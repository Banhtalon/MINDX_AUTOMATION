**1. Tóm tắt và kết luận: NO-GO**

Bản đang kiểm định còn lỗi có thể **gắn video nhầm học viên, làm mất nội dung đang sửa và xóa ảnh cũ khi nhập lại thất bại**.

Đã kiểm định cây làm việc hiện tại tại `2570d96…`, có nhiều thay đổi chưa commit. Không sửa mã nguồn, tài liệu hoặc tải bài lên LMS thật.

**2. Bảng phát hiện**

Các tình huống dưới đây được đối chiếu mã nguồn và tái hiện bằng dữ liệu giả trong bộ nhớ; riêng F10 được xác định qua luồng gọi trình duyệt.

| Mã | Mức độ | File:dòng | Mô tả và cách tái hiện | Đề xuất sửa |
|---|---|---|---|---|
| **V272-F01** | **High** | [spck-youtube-import.ts:299](/F:/MINDX_project%20test/MINDX-AUTOMATION/src/lib/local-files/spck-youtube-import.ts:299) | Bộ lọc xóa chữ **“Thế”** khỏi tên. Với hai học viên “Nguyễn Văn Thế Anh” và “Nguyễn Văn Anh”, video mang đầy đủ tên người thứ nhất lại được gắn cho người thứ hai, trạng thái `MATCHED`, điểm khớp **1.0**. | Khớp đầy đủ tên trong danh sách lớp trước khi loại từ chung; bảo toàn các từ có thể thuộc tên người. |
| **V272-F02** | **High** | [spck-youtube-import.ts:704](/F:/MINDX_project%20test/MINDX-AUTOMATION/src/lib/local-files/spck-youtube-import.ts:704) | **Xóa ảnh trước khi xác nhận nhập thành công.** Nhập lại khi có 10 ảnh Owner: hai ảnh mới khiến gallery vượt giới hạn 11 ảnh. Kết quả báo thất bại nhưng hai ảnh YouTube cũ đã bị xóa, trong khi kho chung và bản nháp vẫn trỏ đến chúng. | Kiểm tra giới hạn trước; chỉ dọn ảnh sau khi lưu thành công. Bảo vệ cả ảnh đang được kho chung, bản nháp và lịch sử sử dụng. |
| **V272-F03** | **High** | [page.tsx:2770](/F:/MINDX_project%20test/MINDX-AUTOMATION/src/app/final-project/page.tsx:2770) | **Mất nội dung gõ trong lúc nhập YouTube.** Hàm giữ bản chụp các dòng từ lúc bắt đầu yêu cầu. Giáo viên sửa bình luận khi đang chờ; khi phản hồi đến, nội dung mới bị thay bằng nội dung cũ và đánh dấu đã lưu. Các ô nhập vẫn cho phép sửa trong thời gian này. | Ghép kết quả vào trạng thái dòng mới nhất bằng hàm cập nhật trạng thái; giữ các trường giáo viên vừa sửa. |
| **V272-F04** | Medium | [page.tsx:1244](/F:/MINDX_project%20test/MINDX-AUTOMATION/src/app/final-project/page.tsx:1244) | Quét lại giữ ghi chú/bình luận trên màn hình khi dữ liệu lưu còn trống, nhưng đặt `isDirty=false` — nghĩa là coi như đã lưu. Sau một lần lưu nháp lỗi hoặc chậm, chuyển buổi sẽ không lưu lại các nội dung này và có thể làm mất chúng. | Nội dung lấy từ màn hình mà chưa lưu phải tiếp tục được đánh dấu cần lưu; chỉ bỏ dấu sau phản hồi lưu thành công. |
| **V272-F05** | Medium | [spck-youtube-import.ts:748](/F:/MINDX_project%20test/MINDX-AUTOMATION/src/lib/local-files/spck-youtube-import.ts:748), [scan/route.ts:151](/F:/MINDX_project%20test/MINDX-AUTOMATION/src/app/api/spck/scan/route.ts:151) | **Bỏ sót ảnh Owner trong gallery.** Có `Demo.png` và `Presentation.png` ở thư mục gốc: nhập YouTube lấy ảnh đầu làm bìa nhưng không thêm ảnh thứ hai vào gallery. Khi quét lại một bài đã có ảnh tự chụp, gallery cũ cũng có thể khiến ảnh Owner mới bị bỏ qua. Cả hai luồng vẫn báo thành công. | Gộp đầy đủ ảnh Owner từ thư mục gốc vào gallery, loại trùng rồi kiểm tra giới hạn; không bỏ qua âm thầm. |
| **V272-F06** | Medium | [spck-scanner.ts:1259](/F:/MINDX_project%20test/MINDX-AUTOMATION/src/lib/local-files/spck-scanner.ts:1259), [scan/route.ts:168](/F:/MINDX_project%20test/MINDX-AUTOMATION/src/app/api/spck/scan/route.ts:168) | Quét thư mục Robotics chỉ có `_spck_youtube_frames` khiến scanner chọn một khung hình YouTube làm bìa (`AUTO_IMAGE`). Luồng quét lại có thể thay Logo MindX đang đúng bằng ảnh này, trái quy tắc “không dùng khung YouTube làm Thumbnail”. | Loại `_spck_youtube_frames` khỏi mọi ứng viên ảnh bìa; dùng ảnh Owner hoặc Logo MindX cho trường hợp này. |
| **V272-F07** | Medium | [spck-scanner.ts:905](/F:/MINDX_project%20test/MINDX-AUTOMATION/src/lib/local-files/spck-scanner.ts:905) | Nhận diện nhầm tài nguyên ứng dụng thành ảnh Owner. Ví dụ chương trình dùng `QPixmap("banner" + ".png")`: bộ quét không tìm thấy nguyên chuỗi `banner.png`, nên nhận ảnh ứng dụng này là ảnh Owner và ưu tiên làm bìa. | Không dùng việc “không tìm thấy nguyên tên file” làm bằng chứng duy nhất về nguồn ảnh. Giữ các trường hợp liên kết động/chưa rõ để xác nhận. |
| **V272-F08** | Medium | [spck-youtube-import.ts:800](/F:/MINDX_project%20test/MINDX-AUTOMATION/src/lib/local-files/spck-youtube-import.ts:800), [page.tsx:2800](/F:/MINDX_project%20test/MINDX-AUTOMATION/src/app/final-project/page.tsx:2800) | Không tải được ảnh và trình phát dự phòng cũng lỗi vẫn trả `applied=true`, **0 ảnh**. Banner tiếp tục hiện màu xanh, thông báo **“đã gắn link YouTube + 2 ảnh”**. Banner cũng không phân biệt dữ liệu chỉ lưu kho chung với dữ liệu đã áp dụng vào buổi. | Đếm ảnh thực tế và số bài đã đồng bộ vào buổi; báo rõ kết quả một phần hoặc cảnh báo khi thiếu ảnh. |
| **V272-F09** | **High** | [spck-app-screenshotter.ts:843](/F:/MINDX_project%20test/MINDX-AUTOMATION/src/lib/local-files/spck-app-screenshotter.ts:843) | Máy chủ chụp Web chỉ kiểm tra đường dẫn theo chữ, sau đó đọc file trực tiếp. Nếu thư mục học viên chứa **junction** — thư mục dẫn sang vị trí khác — nó có thể đọc file ngoài vùng được phép. Mô phỏng nhánh này trả **HTTP 200** với dữ liệu giả ngoài vùng; đường dẫn file con không được kiểm tra Allowlist. | Xác minh đường dẫn thực tế của từng file trước khi đọc, kiểm tra Allowlist và bảo đảm nó vẫn nằm trong thư mục học viên. Đây là lỗi trong luồng được giao kiểm định; chưa xác định phiên bản đầu tiên phát sinh. |
| **V272-F10** | Medium | [spck-youtube-import.ts:480](/F:/MINDX_project%20test/MINDX-AUTOMATION/src/lib/local-files/spck-youtube-import.ts:480) | Khi thiếu ảnh tải về, luồng dự phòng tự mở Chromium và truy cập YouTube trực tiếp, ngoài `SequentialTaskQueue`. Đây là thao tác có mạng, không thuộc trường hợp chỉ dựng ảnh cục bộ; chưa tuân thủ quy tắc một phiên trình duyệt/hàng đợi trong `AGENTS.md`. | Đưa thao tác dự phòng vào cơ chế chạy lần lượt và thống nhất cách quản lý phiên trình duyệt. Nếu giữ ngoại lệ cho dựng ảnh ngoại tuyến, cần ghi rõ phạm vi ngoại lệ. |

**3. Kết quả kiểm thử**

| Lệnh | Kết quả lần kiểm định này |
|---|---|
| `npx tsc --noEmit --incremental false` | **ĐẠT**, mã thoát 0. |
| `npx tsx scripts/test-spck-v270.ts` | **ĐẠT 16/16**, gồm hồi quy AI Buổi 12 khi Buổi 14 đã `VERIFIED`. |
| `npx tsx scripts/test-spck-v272.ts` | **Bị chặn tại V01**: Chromium không khởi chạy được, lỗi `spawn EPERM`. Chưa xác nhận V01–V08. |
| `npx tsx scripts/test-phase6.ts` | Ba nhóm đầu đạt; nhóm cuối bị chặn khi mở Chromium với cùng lỗi `spawn EPERM`. Chưa đạt toàn bộ bộ kiểm thử. |

Các phép tái hiện bổ sung chạy phần logic nguồn với mạng, ổ đĩa và dữ liệu giả trong bộ nhớ. Chúng **không thay thế kiểm tra trình duyệt thật**. Lỗi `EPERM` là giới hạn môi trường lần chạy này, chưa phải bằng chứng Chromium của sản phẩm bị lỗi.

**4. Những điểm đã kiểm tra và xác nhận đúng**

- Bộ hồi quy xác nhận dữ liệu riêng Buổi 12/13/14, khóa phiên bản nháp, hạ trạng thái sau sửa và bảo toàn lịch sử trong 16 tình huống hiện có.
- Tuyến nhập YouTube gọi kiểm tra yêu cầu cục bộ trước khi xử lý; có giới hạn nội dung nhập 20.000 ký tự.
- URL tải danh sách/video được dựng lại từ mã YouTube; không dùng trực tiếp địa chỉ tùy ý người dùng nhập.
- Không thấy biến mật khẩu hoặc khóa Gemini trong các phần giao diện mới được kiểm tra.
- Bộ chuẩn hóa ảnh dùng trình duyệt ngoại tuyến, không mang phiên đăng nhập LMS. Việc cô lập này hợp lý về an toàn; chưa xác nhận ảnh xuất thực tế vì Chromium bị chặn.
- Đối chiếu trước/sau cho thấy mã nguồn, tập lệnh, cấu hình và các tài liệu được kiểm tra giữ nguyên; trạng thái Git không đổi. Không còn bản ghi của các lớp `TEST_*` vừa chạy.

**Đã làm:** Hoàn tất kiểm định độc lập, không sửa nguồn.  
**Kết quả:** **NO-GO**, cần xử lý các phát hiện trên.  
**Chưa kiểm tra:** Ảnh xuất, giao diện trình duyệt thật và nghiệm thu LMS/YouTube thật.  
**Việc tiếp theo:** Ưu tiên sửa F01, F02, F03, F09; bổ sung hồi quy cho các lỗi rồi chạy lại đủ bốn lệnh trong môi trường mở được Chromium.

