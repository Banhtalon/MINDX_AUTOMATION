---
description: Quy trình làm việc nhóm AI (Main Coder + Reviewer claude-sonnet-5-5-high + Escalation opus-5-5-high) và báo cáo dễ hiểu cho Owner
---

# Workflow Phối Hợp Đội Ngũ AI (`/team-workflow`)

1. **Bạn (Agent chính):** Điều phối công việc và trực tiếp viết/sửa code chính.
2. **Khi gặp bài toán quá khó:** Ủy quyền hoặc tham vấn Subagent **`opus-5-5-high`** (`Model: "pro"`) để giải quyết.
3. **Khi hoàn thành code / cần kiểm thử & kiểm toán:** Ủy quyền cho Subagent Reviewer **`claude-sonnet-5-5-high`** kiểm tra độc lập và xác nhận chất lượng.
4. **Khi báo cáo cho Owner:** Viết **ngắn gọn, dễ hiểu bằng ngôn ngữ đời thường**, tuyệt đối tránh thuật ngữ kỹ thuật/code phức tạp vì Owner không biết code.
