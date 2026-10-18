# MINDX LMS & TEACHING - GHI CHÉP KHẢO SÁT HỆ THỐNG (RECON NOTES)

Tài liệu tổng hợp các quan sát DOM, hành vi UI và Network API của MindX LMS & Teaching dựa trên phân tích thực tế từ 4 hình ảnh LMS và quá trình khảo sát.

---

## 1. Hệ thống Teaching (`https://teaching.mindx.edu.vn`)
* **Mục đích:** Quản lý lịch dạy thực tế của Giảng viên, danh sách lớp học và ca dạy.
* **Đăng nhập:** Thường sử dụng email MindX (`@mindx.edu.vn`) hoặc đăng nhập Google OAuth.
* **Các trường dữ liệu cần trích xuất:**
  - `classId`: Mã định danh lớp trên Teaching.
  - `sessionId`: Mã buổi học / ca học cụ thể trong lịch giảng dạy.
  - `sessionDate`: Ngày diễn ra buổi học.
  - Trạng thái điểm danh (`attendanceStatus`): Có mặt, Vắng mặt, Nghỉ phép.

---

## 2. Hệ thống MindX LMS (`https://lms.mindx.edu.vn`)
* **Mục đích:** Quản lý học viên, bài tập về nhà, chấm điểm, nhận xét buổi học và sản phẩm cuối khóa (SPCK).
* **Đăng nhập:** Form đăng nhập gồm email/username và password.

### 2.1. Cấu trúc Drawer Lớp học (Slide-over Drawer)
* Khi click vào một lớp học ở danh sách bên trái (ví dụ `VT-C4K-PTA13` ở trạng thái `Running`), LMS mở một **Drawer chiếm 2/3 màn hình bên phải**.
* **Thanh Tab điều hướng trong Drawer:**
  - `Thông tin chung`
  - `Lịch học` (hoặc `Điểm danh`)
  - `Bài tập về nhà`
  - `Chấm bài`
  - `Học viên`
  - `Giảng viên`
  - `Bảng tin lớp học`
* **Xử lý Toast Forbidden màu đỏ:**
  - Ở góc dưới bên phải thường xuất hiện toast thông báo `.Forbidden` do một số API CRM phụ gọi ngầm bị giới hạn quyền.
  - **Quy tắc:** Bắt lỗi nghiệp vụ dựa trên HTTP Status (`401/403/500`) của đúng API đang gọi. Tự động đóng toast phụ này nếu nó nổi lên che khuất các nút bấm chính (`Lưu`, `Thoát`, `Chấm bài`).

### 2.2. Tab `Học viên` & Trạng thái Đang học
* Cột `Trạng thái` có công tắc Switch:
  - **Màu xanh (`Active`):** Học viên đang theo học bình thường.
  - **Màu xám (`Inactive`) kèm dấu ✕ đỏ ở cột Hoàn thành:** Học viên đã chuyển lớp/bảo lưu/nghỉ học.
* **Phân trang:**
  - Dropdown chọn số dòng: `Số dòng mỗi trang: 100` (`select` hoặc custom dropdown).
  - Chỉ số trang: `1-7 trong 7` kèm nút chuyển trang `<` và `>`.

### 2.3. Tab `Chấm bài` & Modal Chấm Điểm
* Bảng hiển thị học viên theo dòng và các cột buổi học:
  - Trạng thái: `Đã chấm (1/1)` kèm điểm số (VD `90/100`), hoặc `Chưa chấm`, `Chưa nộp`.
* **Modal Chấm Điểm:**
  - Tên file đính kèm: VD `1788605566199-baitapvenha.py`.
  - Icon Tải xuống (Download icon button): Trigger sự kiện `page.waitForEvent('download')`.
  - Hai Radio button: `Chấm điểm` và `Yêu cầu học sinh làm lại bài tập`.
  - Input `Điểm số`: Nhập số nguyên 0-100.
  - Rich Text Editor `Nhận xét`: Vùng soạn thảo văn bản (hỗ trợ định dạng).
  - Nút hành động: `Thoát` và `Lưu` (màu xanh).

### 2.4. Form Upload Sản phẩm Cuối khóa (SPCK)
* Khung `Sản Phẩm Học Viên 01` (trạng thái `Pending #1`) hoặc nút `+ Thêm sản phẩm học viên`.
* Các trường dữ liệu:
  - `Tiêu đề *`: Input text (giới hạn tối đa 100 ký tự).
  - `Youtube Video (Youtube URL)`: Input + nút `+ Thêm` (bắt buộc bấm Thêm).
  - `Ảnh thumbnail *`: Nút `+ Thay ảnh` (nạp ảnh tỷ lệ 16:9).
  - `Tải hình ảnh lên`: Dropzone nhận ảnh (tối đa 10 ảnh).
  - `Tài liệu đính kèm`: Dropzone nhận file `.py`, `.zip`, `.sb3`, `.yyz`, `.pptx`, `.pdf`... (tối đa 10 files).
  - `Đường dẫn liên quan`: Input `Đặt tên đường dẫn` + `Nhập đường dẫn` + nút `+ Thêm`.
  - `Bình luận của giáo viên*`: Nhận xét tổng kết.
  - Nút `Lưu` góc phải dưới.

---

## 3. Bản đồ Selectors Trọng yếu (CSS / XPath)
Được tập hợp và chuẩn hóa tại `src/lib/playwright/selectors.ts`.
