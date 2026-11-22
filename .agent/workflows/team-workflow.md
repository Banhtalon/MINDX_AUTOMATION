---
description: Quy trình làm việc nhóm AI (Main Coder + Reviewer độc lập & Xử lý việc khó bằng Gemini 4 Neon (XHigh)) và báo cáo dễ hiểu cho Owner
---

# Workflow Phối Hợp Đội Ngũ AI (`/team-workflow`)

1. **Bạn (Agent chính):** Điều phối công việc và trực tiếp viết/sửa code chính.
2. **Khi gặp bài toán quá khó:** Ủy quyền hoặc tham vấn chuyên gia độc lập chạy **`Gemini 4 Neon (XHigh)`** (`gemini-4-neon-xhigh`) để phân tích nguyên nhân gốc rễ và xử lý triệt để.
3. **Khi hoàn thành code / cần kiểm thử & kiểm toán:** Ủy quyền cho Reviewer độc lập chạy **`Gemini 4 Neon (XHigh)`** (`gemini-4-neon-xhigh` — khởi tạo worker độc lập ghim `model: "gemini-4-neon-xhigh"` hoặc subagent độc lập dùng `Gemini 4 Neon (XHigh)`) để kiểm tra chéo mã nguồn, chạy kiểm thử trong môi trường cô lập `TEMP` (bảo toàn 100% SHA-256 dữ liệu thật) và xác nhận chất lượng (`VERDICT: GO`) trước khi bàn giao.
4. **Khi báo cáo cho Owner:** Viết **ngắn gọn, dễ hiểu bằng ngôn ngữ đời thường**, tuyệt đối tránh thuật ngữ kỹ thuật/code phức tạp vì Owner không biết code.
