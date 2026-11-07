# MindX Automation Bot (v3.4.0)

Hệ thống trợ lý tự động hóa toàn diện dành cho Giáo viên tại MindX — Giảm tải 90% các tác vụ thủ công sau mỗi buổi học và cuối khóa học.

## 🚀 Các tính năng cốt lõi

1. **Chuẩn bị & Tự động lưu Nhận xét sau buổi học + Thông báo Zalo (`/session-comments`)**
   - Đọc lịch dạy thực tế từ Teaching và danh sách học viên từ LMS.
   - Hỗ trợ Quick Tags, ghi chú nhanh và dùng AI (`gemini-3.5-flash-lite`) sinh nhận xét 3 phần (Điểm mạnh, Điểm cần cải thiện, Lời khuyên).
   - Tự động điền và lưu vào LMS (Read-after-Write verification) và tạo mẫu gửi Zalo.

2. **Phiếu Điểm Tổng Kết (Chuẩn Teaching) & Bảng Điểm BTVN (`/homework-grader`)**
   - Quét dữ liệu điểm BTVN, Check-point 1 & 2, Điểm Năng lực `[ĐNL]` và Cuối khóa DEMO từ LMS (cho cả Lập trình và Robotics).
   - Tính toán tự động trên thang điểm 5, vẽ biểu đồ, xuất ảnh gửi Zalo / TSV Google Sheets và đồng bộ 1 chạm lên Teaching.

3. **Tự động Upload Sản phẩm Cuối khóa (SPCK) & Tổng kết Buổi 14 (`/final-project`)**
   - Quét thư mục dự án của học sinh trên máy (`F:\MINDX_SPCK_FINAL`) hoặc nhập Playlist YouTube (Robotics), khớp nối học viên và thu bài trực tuyến qua Cổng thu bài học sinh.
   - Tự động chụp ảnh giao diện / màn chơi `960×540`, tải lên Google Drive / GitHub Pages, nộp SPCK các buổi 12–13–14 và đẩy Thư tổng kết cuối khóa Buổi 14 lên LMS.

4. **Đồng bộ Dự án Cuối khóa & Tiến độ Học viên trên Teaching (`/teaching-projects`)**
   - Tự động khởi tạo dự án cuối khóa, tạo 5 phần công việc chuẩn theo 6 nhóm môn (`20% × 5 = 100%`) và cập nhật tiến độ 1 chạm theo buổi học hiện tại lên `teachingmindx.top`.

## 🤝 Quy định Phối hợp Đội ngũ AI & Kiểm định Độc lập (Team Workflow)

- **Điều phối & Code chính:** Agent hiện tại trực tiếp điều phối công việc và viết/sửa mã nguồn chính.
- **Review Độc lập (`Codex CLI` — `gpt-6.1-sol` `xhigh`):** Sử dụng **Codex CLI (`gpt-6.1-sol` `xhigh`)** để kiểm định độc lập (code review & chạy bộ kiểm thử trong môi trường cô lập `TEMP`, bảo toàn 100% SHA-256 của dữ liệu thật `data/mindx_bot.db` và `data/running_classes.json`).
- **Xử lý Tác vụ Khó (Subagent `Argon High`):** Khi gặp bài toán kiến trúc hoặc lỗi kỹ thuật quá khó, gọi **Subagent `Argon High`** (`Model: "pro"` / `"inherit"`) hỗ trợ phân tích và giải quyết (không sử dụng các mô hình Claude).
- **Báo cáo cho Owner:** Luôn báo cáo ngắn gọn, dễ hiểu bằng ngôn ngữ đời thường.

## 🛠️ Công nghệ sử dụng

- **Frontend & Backend:** Next.js (App Router) + TypeScript + Tailwind CSS
- **Automation Engine:** Playwright (Chromium Persistent Context + Sequential Task Queue)
- **AI Engine:** Google Gemini SDK (`gemini-3.5-flash-lite`) với Structured Outputs (JSON Schema)
- **Lưu trữ Cục bộ:** SQLite (`better-sqlite3`) & JSON files

## 📖 Tài liệu chi tiết

- **Tổng quan nhanh & Bản đồ file hiện tại:** [PROJECT_STATE.md](./PROJECT_STATE.md)
- **Lịch sử các phiên bản thay đổi (Changelog):** [CHANGELOG.md](./CHANGELOG.md)
- **Kế hoạch triển khai & Kiến trúc đầy đủ:** [MINDX_AUTOMATION_PLAN.md](./MINDX_AUTOMATION_PLAN.md)
- **Quy tắc dành cho AI Agent:** [AGENTS.md](./AGENTS.md) | [SKILL.md](./.agents/skills/team-workflow/SKILL.md)
