# MINDX AUTOMATION BOT - AI AGENT RULES

1. **Single Source of Truth:** Luôn đọc `@PROJECT_STATE.md` đầu tiên để nắm nhanh tổng quan, bản đồ file và các đặc thù thực tế của MindX LMS, sau đó đối chiếu `@MINDX_AUTOMATION_PLAN.md` và `@CHANGELOG.md` trước khi viết hoặc sửa code. Khi hoàn thành một task hoặc thay đổi kiến trúc/luồng nghiệp vụ, bắt buộc cập nhật cả `PROJECT_STATE.md`, `CHANGELOG.md` và `MINDX_AUTOMATION_PLAN.md`.
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
   - **Quy tắc Nhận xét Học sinh (`.agents/skills/nhan-xet-hoc-sinh/SKILL.md`):**
     - Phân loại học sinh vào 1 trong **5 cấp độ chuẩn** dựa theo Quick Tags đã tích chọn (*Cấp độ 1: Giỏi*, *Cấp độ 2: Khá*, *Cấp độ 3: Khá nhưng mất tập trung*, *Cấp độ 4: Trung bình*, *Cấp độ 5: Trung bình, mất tập trung*) kết hợp chủ đề buổi học (Lập trình / Robotics).
     - Hiển thị gộp chung trong **1 ô nhận xét duy nhất** với bố cục **3 gạch đầu dòng in đậm bắt buộc** (không ghi tên học sinh ở đầu nhận xét): `- **Điểm mạnh của học viên:**`, `- **Điểm cần cải thiện:**`, `- **Lời khuyên:**` (xưng "thầy", gọi học sinh là "con", gọi phụ huynh là "ba mẹ"/"gia đình", độ dài 100–300 từ, in đậm từ khóa trọng tâm, văn phong tích cực, không dùng từ phán xét nặng nề).
   - **Quy tắc Thông báo Zalo Tổng kết Buổi học & BTVN (`.agents/skills/nhan-xet-hoc-sinh-zalo/SKILL.md`):**
     - **Phần 1 (Tổng kết buổi học):** Gồm đúng 6 mục ngắn gọn, súc tích (mỗi ý 1 câu): Chào hỏi + Buổi số + Ngày + Mã lớp; Chuyên cần & Tình hình chung (2 gạch đầu dòng `- `); `📘 NỘI DUNG BUỔI HỌC:` (`BÀI N: ...` + các gạch đầu dòng `- `); `📍 NHỮNG ĐIỂM CẦN LƯU Ý:` (các gạch đầu dòng `- `); `📌 NỘI DUNG BUỔI HỌC KẾ TIẾP:` (tự động tịnh tiến +7 ngày cho ngày học kế tiếp & tra cứu tên bài `BUỔI N+1`); `📝 NHIỆM VỤ KHI VỀ NHÀ:` (`+ 10 câu hỏi trắc nghiệm.`, `+ 2 bài thực hành (làm theo yêu cầu đề bài).`, `⏰ Hạn nộp: [Thứ], ngày [Ngày buổi học kế tiếp]`).
     - **Phần 2 (Nhận xét tình trạng làm BTVN):** **CHỈ xuất khi có tải lên hình ảnh chụp kết quả làm BTVN**, lọc danh sách học sinh `Not submitted` với tên rút gọn **Tên đệm + Tên** (bỏ họ đầu nếu tên $\ge 3$ chữ).
   - Chấm bài tập: AI chỉ chấm điểm từng tiêu chí kèm bằng chứng code; code TypeScript tự tính tổng điểm (`sum(earnedPoints)`).
   - File lỗi không đọc được -> gắn cờ `PARSE_ERROR`, cấm tự chấm 0 điểm hoặc tự tích chọn "Yêu cầu học sinh làm lại bài tập".
   - **Quy tắc Ảnh bìa SPCK (Thumbnail):** Khi quét hoặc nộp Sản phẩm cuối khóa (SPCK), nếu thư mục dự án của học sinh không có hình ảnh riêng, bắt buộc tự động lấy ảnh **Logo MindX (`data/config/default-spck-thumbnail.png`)** làm ảnh bìa (Thumbnail) mặc định.
6. **Team Workflow & Owner Communication:**
   - **Điều phối & Code chính:** Agent hiện tại điều phối công việc và trực tiếp viết/sửa code chính.
   - **Reviewer (`claude-sonnet-5-5-high`):** Phụ trách kiểm định độc lập (code review & chạy kiểm thử/kiểm toán chất lượng).
   - **Escalation (`opus-5-5-high` / `pro`):** Nhờ hỗ trợ khi gặp bài toán hoặc lỗi kỹ thuật quá khó.
   - **Báo cáo cho Owner:** Luôn báo cáo **ngắn gọn, dễ hiểu bằng ngôn ngữ đời thường** vì Owner không biết code (hạn chế tối đa thuật ngữ lập trình phức tạp).
   - **Cấm tuyệt đối `send_input` (`Thêm dữ liệu từ bàn phím (stdin)`):** Cả Agent chính lẫn mọi Subagent **tuyệt đối KHÔNG BAO GIỜ** gọi `manage_task` với `Action: "send_input"`, vì trên giao diện Antigravity khi chạy ngầm hoặc trong Subagent, hộp thoại này không hiện nút bấm ra màn hình chính mà sẽ làm kẹt cứng tiến trình vô thời hạn. Nếu một lệnh chạy nền bị treo, chỉ được dùng `manage_task(Action: "kill")` để tắt đi. Mọi lệnh `run_command` phải chạy ở chế độ tự động thoát (không tương tác bàn phím, đặt `WaitMsBeforeAsync: 10000` cho lệnh kiểm tra nhanh).

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
