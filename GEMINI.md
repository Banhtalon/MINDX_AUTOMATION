# MINDX AUTOMATION BOT - AI AGENT RULES

1. **Single Source of Truth:** Luôn đọc và đối chiếu `@MINDX_AUTOMATION_PLAN.md` trước khi viết hoặc sửa code. Khi hoàn thành một task, bắt buộc cập nhật `- [ ]` thành `- [x]` trong `MINDX_AUTOMATION_PLAN.md`.
2. **Local-Only Security:**
   - Server chỉ bind vào `127.0.0.1`.
   - Không bao giờ import hoặc trả biến môi trường nhạy cảm (`TEACHING_PASSWORD`, `LMS_PASSWORD`, `GEMINI_API_KEY`) về Client Components (`'use client'`).
   - Mọi thao tác đọc file trên ổ cứng phải đi qua hàm kiểm tra Path Allowlist.
3. **Playwright Discipline:**
   - Chỉ sử dụng duy nhất 1 `BrowserContext` (Persistent Context tại `./playwright-auth`).
   - Mọi thao tác điều khiển trình duyệt phải đẩy vào `SequentialTaskQueue` đơn luồng.
   - Bắt lỗi ở tầng Network API (kiểm tra HTTP status của đúng API nghiệp vụ). Tự động đóng các toast `.Forbidden` phụ ở góc dưới bên phải để không che khuất nút bấm.
   - Luôn thực hiện **Read-after-Write Verification** (chờ HTTP 200/201 + đọc lại DOM đối chiếu với bản đã duyệt) trước khi đánh dấu `VERIFIED` trong SQLite.
4. **Data Integrity & Hashing:**
   - Khóa dữ liệu theo `classId`, `sessionId`, `studentId`, `submissionId`.
   - Khi giáo viên bấm Duyệt, lưu `contentHash` (SHA-256). Nếu nội dung bị chỉnh sửa sau khi duyệt (`newHash !== contentHash`), tự động hạ trạng thái về `DRAFT` / `WAITING_APPROVAL`.
5. **AI Guardrails (`gemini-3.5-flash-lite`):**
   - Ẩn danh tên học viên thành `STUDENT_01`, `STUDENT_02`... trước khi gọi Gemini API.
   - Không có Quick Tags và không có ghi chú của giáo viên -> trả về `INSUFFICIENT_INFO`, cấm AI tự suy diễn.
   - Chấm bài tập: AI chỉ chấm điểm từng tiêu chí kèm bằng chứng code; code TypeScript tự tính tổng điểm (`sum(earnedPoints)`).
   - File lỗi không đọc được -> gắn cờ `PARSE_ERROR`, cấm tự chấm 0 điểm hoặc tự tích chọn "Yêu cầu học sinh làm lại bài tập".