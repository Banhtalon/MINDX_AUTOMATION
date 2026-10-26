---
name: team-workflow
description: >-
  Quy trình phối hợp đội ngũ AI cho dự án MINDX-AUTOMATION: Agent chính điều phối và code chính,
  claude-sonnet-5-5-high làm Reviewer kiểm định độc lập, opus-5-5-high xử lý các tác vụ quá khó,
  và báo cáo cho Owner ngắn gọn, dễ hiểu (không dùng thuật ngữ code phức tạp).
---

# Quy Trình Phối Hợp Đội Ngũ (Team Workflow) — MINDX AUTOMATION

## 1. Phân Công Vai Trò (Role Assignment)

1. **Điều phối viên & Code chính (Main Agent / Orchestrator):**
   - Trực tiếp nhận yêu cầu từ Owner, lập kế hoạch, điều phối luồng công việc và trực tiếp viết/sửa phần lớn mã nguồn.
   - Chịu trách nhiệm tổng hợp kết quả và báo cáo lại cho Owner.

2. **Kiểm định viên Độc lập — Reviewer (`claude-sonnet-5-5-high`):**
   - Sau khi Agent chính hoàn thành một tính năng hoặc giai đoạn, ủy quyền cho Subagent Reviewer (`claude-sonnet-5-5-high`) để:
     - Kiểm tra chéo chất lượng, độ an toàn và chạy bộ kiểm thử trong môi trường cô lập (`TEMP`).
     - Đưa ra kết luận **ĐẠT (GO)** hoặc danh sách điểm cần chỉnh sửa trước khi bàn giao cho Owner.

3. **Chuyên gia Giải quyết Bài toán Khó (`opus-5-5-high` / `Model: "pro"`):**
   - Chỉ triệu tập khi gặp lỗi kiến trúc phức tạp, xung đột dữ liệu đa luồng khó xử lý, hoặc khi sửa quá 2 lần vẫn chưa triệt để.

---

## 2. Các Bước Thực Hiện Chuẩn (Standard Operating Steps)

1. **Bước 1 — Tiếp nhận & Triển khai (Main Agent):**
   - Đọc `MINDX_AUTOMATION_PLAN.md` và `AGENTS.md`.
   - Viết hoặc sửa code, tự chạy kiểm tra nhanh để đảm bảo tính năng hoạt động.
2. **Bước 2 — Nếu gặp việc quá khó (Escalation -> `opus-5-5-high`):**
   - Khởi tạo subagent với `Model: "pro"` (vai trò `Opus 5.5 High Escalation Architect`) để phân tích nguyên nhân gốc rễ hoặc thiết kế giải pháp tối ưu.
3. **Bước 3 — Kiểm định chất lượng (Review -> `claude-sonnet-5-5-high`):**
   - Khởi tạo subagent Reviewer (`claude-sonnet-5-5-high`) để kiểm tra độc lập toàn bộ phần việc vừa làm.
   - **Quy tắc chống treo cứng (`stdin`):** Khi giao việc cho bất kỳ Subagent nào, bắt buộc dặn rõ trong Prompt: *"Tuyệt đối KHÔNG dùng `manage_task(Action: 'send_input')` (Thêm dữ liệu từ bàn phím / stdin) vì sẽ làm treo cứng Subagent mà không hiện nút bấm cho Owner; nếu lệnh bị treo chỉ được dùng `Action: 'kill'`."*
   - Nếu Reviewer phát hiện lỗi: Agent chính sửa ngay và nhờ Reviewer kiểm tra lại cho đến khi đạt 100%.
4. **Bước 4 — Báo cáo cho Owner (Ngắn gọn, Dễ hiểu, Không thuật ngữ code):**
   - Luôn trình bày theo ngôn ngữ đời thường, tập trung vào **ý nghĩa sử dụng thực tế** cho giáo viên/chủ dự án.

---

## 3. Chuẩn Báo Cáo Dành Cho Owner (Owner-Friendly Reporting)

Vì **Owner không biết code**, mọi báo cáo gửi Owner bắt buộc tuân thủ:
- **Ngắn gọn, đi thẳng vào kết quả:** Dùng gạch đầu dòng rõ ràng, tối đa 5–10 dòng cho mỗi mục chính.
- **Không dùng từ chuyên môn khó hiểu:** Thay vì nói *"SHA-256 contentHash, race condition, GraphQL mutation, SQLite transaction"*, hãy diễn đạt thành *"Khóa chống sửa nhầm sau khi duyệt, chống lưu đè khi mạng chậm, xác nhận đã lưu thật trên hệ thống LMS"*.
- **Bố cục 3 phần cố định:**
  1. **Kết quả chính:** (Đã xong chưa? Đạt chuẩn an toàn chưa?)
  2. **Hệ thống đã làm được gì cho giáo viên:** (2–4 ý ngắn gọn dễ hiểu)
  3. **Bước tiếp theo:** (Owner cần làm gì hoặc có thể bấm nút gì tiếp theo)
