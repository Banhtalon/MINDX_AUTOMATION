# MindX Automation Bot (v2.1)

Hệ thống trợ lý tự động hóa toàn diện dành cho Giáo viên tại MindX — Giảm tải 90% các tác vụ thủ công sau mỗi buổi học và cuối khóa học.

## 🚀 Các tính năng cốt lõi

1. **Chuẩn bị & Tự động lưu Nhận xét sau buổi học + Thông báo Zalo**
   - Đọc lịch dạy thực tế từ Teaching và danh sách học viên từ LMS.
   - Hỗ trợ Quick Tags, ghi chú nhanh và dùng AI (`gemini-3.5-flash-lite`) sinh nhận xét 3 phần (Điểm mạnh, Điểm cần cải thiện, Hướng rèn luyện).
   - Tự động điền và lưu vào LMS (Read-after-Write verification) và tạo mẫu gửi Zalo.

2. **Cào dữ liệu điểm LMS để Giáo viên báo cáo**
   - Quét dữ liệu điểm các buổi học trên LMS, phân loại trạng thái (Đã chấm, Chưa chấm, Chưa nộp, Điểm 0).
   - Hỗ trợ xuất Excel/CSV và copy vào Google Sheets.

3. **Tự động Tải & Chấm bài tập theo Barem điểm**
   - Tải file bài làm của học viên từ LMS về máy cục bộ.
   - Đọc file code (Python, Web, GameMaker, Scratch,...) và đề xuất điểm kèm bằng chứng trích dẫn theo Barem.
   - Giáo viên duyệt và tự động đẩy điểm + nhận xét lên LMS.

4. **Tự động Upload Sản phẩm Cuối khóa (SPCK) & Nhận xét cuối khóa**
   - Quét thư mục dự án của học sinh trên máy, khớp nối học viên.
   - Tự động tải hình ảnh thumbnail, ảnh sản phẩm, file đính kèm, liên kết Youtube.
   - Tự động điền nhận xét tổng kết và lưu vào LMS.

## 🛠️ Công nghệ sử dụng

- **Frontend & Backend:** Next.js (App Router) + TypeScript + Tailwind CSS
- **Automation Engine:** Playwright (Chromium Persistent Context + Task Queue)
- **AI Engine:** Google Gemini SDK (`gemini-3.5-flash-lite`) với Structured Outputs (JSON Schema)
- **Lưu trữ Cục bộ:** SQLite (`better-sqlite3`) & JSON files

## 📖 Tài liệu chi tiết

Xem chi tiết kiến trúc và kế hoạch triển khai tại [MINDX_AUTOMATION_PLAN.md](./MINDX_AUTOMATION_PLAN.md).
