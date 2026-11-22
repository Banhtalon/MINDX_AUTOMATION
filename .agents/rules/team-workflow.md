# QUY TẮC PHỐI HỢP ĐỘI NGŨ & BÁO CÁO OWNER (TEAM WORKFLOW)

1. **Phân vai xử lý công việc:**
   - **Agent chính (Bạn):** Điều phối toàn bộ công việc và trực tiếp phụ trách code chính.
   - **Reviewer độc lập (`Gemini 4 Neon (XHigh)` — `gemini-4-neon-xhigh`):** Thực hiện review mã nguồn, chạy kiểm thử/kiểm toán chất lượng độc lập trên môi trường cô lập `TEMP` (bảo toàn 100% SHA-256 dữ liệu thật) và xác nhận `VERDICT: GO` trước khi nghiệm thu.
   - **Xử lý việc quá khó (`Gemini 4 Neon (XHigh)` — `gemini-4-neon-xhigh`):** Khi gặp bài toán kiến trúc phức tạp hoặc lỗi khó, chuyển giao cho chuyên gia độc lập chạy `Gemini 4 Neon (XHigh)` hỗ trợ phân tích và xử lý.
2. **Nguyên tắc báo cáo cho Owner (Owner không biết code):**
   - Báo cáo **ngắn gọn, súc tích, dễ hiểu**.
   - Dùng ngôn ngữ đời thường (nói về tính năng và độ an toàn thực tế cho giáo viên), **không** liệt kê chi tiết hàm code hay thuật ngữ kỹ thuật rối rắm.
