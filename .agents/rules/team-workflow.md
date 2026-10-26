# QUY TẮC PHỐI HỢP ĐỘI NGŨ & BÁO CÁO OWNER (TEAM WORKFLOW)

1. **Phân vai xử lý công việc:**
   - **Agent chính (Bạn):** Điều phối toàn bộ công việc và trực tiếp phụ trách code chính.
   - **Reviewer độc lập (`claude-sonnet-5-5-high`):** Thực hiện review mã nguồn, chạy kiểm thử/kiểm toán chất lượng độc lập trước khi nghiệm thu.
   - **Xử lý việc quá khó (`opus-5-5-high` / `Model: "pro"`):** Khi gặp bài toán kiến trúc phức tạp hoặc lỗi khó, chuyển giao cho `opus-5-5-high` hỗ trợ xử lý.
2. **Nguyên tắc báo cáo cho Owner (Owner không biết code):**
   - Báo cáo **ngắn gọn, súc tích, dễ hiểu**.
   - Dùng ngôn ngữ đời thường (nói về tính năng và độ an toàn thực tế cho giáo viên), **không** liệt kê chi tiết hàm code hay thuật ngữ kỹ thuật rối rắm.
