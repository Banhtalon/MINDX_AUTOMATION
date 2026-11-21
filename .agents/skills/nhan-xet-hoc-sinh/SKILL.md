---
name: nhan-xet-hoc-sinh
description: Viết nhận xét tình hình học tập của học sinh sau buổi học lập trình, công nghệ, AI hoặc robotics để gửi phụ huynh qua Zalo. Sử dụng khi người dùng yêu cầu viết nhận xét học sinh, đánh giá sau buổi học, hoặc tạo mẫu báo cáo tình hình học tập gửi phụ huynh.
---
# Nhận Xét Học Sinh Sau Buổi Học (v3.0.0)

Kỹ năng này giúp soạn thảo các mẫu nhận xét tình hình học tập của học sinh sau mỗi buổi học lập trình và công nghệ (Buổi 1–13, bao gồm cả buổi thường và buổi Kiểm tra / Checkpoint), tối ưu hóa để lưu lên LMS và gửi trực tiếp cho phụ huynh qua Zalo.

## Khi Nào Sử Dụng

- Khi người dùng yêu cầu viết nhận xét học sinh sau buổi học lập trình, công nghệ, thiết kế giao diện, làm game, AI hoặc lắp ráp và lập trình robotics (Buổi 1–13).
- Khi người dùng chọn bộ thẻ đánh giá nhanh (Quick Tags) 1 hàng gọn theo hướng học (Lập trình hoặc Robotics) kèm ghi chú riêng của giáo viên.
- Lưu ý: **Buổi 14 (Tổng kết cuối khóa & SPCK)** sử dụng bộ thẻ riêng ở Màn hình 3 (`/final-project`), tuyệt đối không trộn lẫn sang nhận xét buổi 1–13.

## Bộ Thẻ Đánh Giá Nhanh (Quick Tags v3.0.0 — Buổi 1–13)

- **Hướng Lập trình (`regular_coding` — 7 thẻ):**
  1. `✅ Tiếp thu tốt` (`role: "good"`)
  2. `📝 Làm bài tập đầy đủ` (`role: "good"`)
  3. `🙋 Hăng hái phát biểu` (`role: "positive"`)
  4. `💡 Vận dụng & Sáng tạo tốt` (`role: "excellent"`)
  5. `🐢 Tiếp thu chậm` (`role: "slow"`)
  6. `👀 Mất tập trung` (`role: "distracted"`)
  7. `⌨️ Thao tác / Cú pháp còn chậm` (`role: "improve"`)

- **Hướng Robotics (`regular_robotics` — 7 thẻ):**
  1. `🔧 Lắp ráp đúng mẫu` (`role: "good"`)
  2. `💻 Lập trình chạy đúng` (`role: "good"`)
  3. `🧠 Chủ động thử & sửa lỗi` (`role: "excellent"`)
  4. `🤝 Hợp tác nhóm tốt` (`role: "positive"`)
  5. `🔩 Lắp ráp cần hỗ trợ` (`role: "slow"`)
  6. `🧩 Lập trình cần hỗ trợ` (`role: "improve"`)
  7. `👀 Cần nhắc tập trung` (`role: "distracted"`)

- **Quy tắc Buổi Kiểm tra / Checkpoint (Lập trình: Buổi 5 & 9; Robotics: Buổi 4 & 8 — `v3.7.0`):**
  - Giáo viên vẫn trực tiếp chấm điểm Lý thuyết (LT) và Thực hành (TH) (thang `0..5.0`) trên MindX LMS. Bot tự động tổng hợp dữ liệu quá trình của từng giai đoạn (`prior session_feedbacks`, Sao/Huy hiệu/Lỗi từ `classroom_session_logs`, BTVN từ `score_matrix_cache`/`class_report_cards` đối với lớp Lập trình — tự bỏ qua sạch cho lớp Robotics, và điểm LT/TH trên LMS) để tự tính đủ `9` tiêu chí Điểm Năng lực `[ĐNL]` (`1..5`).
  - Nhận xét văn bản vẫn giữ nguyên cấu trúc 3 gạch đầu dòng chuẩn mực bên dưới (lồng ghép đánh giá quá trình học tập của chặng + nhận định điểm LT/TH/9 `[ĐNL]` vào nhận xét buổi kiểm tra), và TypeScript tự gắn thêm **1 dòng điểm tổng kết Checkpoint riêng** ở đầu ô nhận xét (`📊 **Kết quả Checkpoint [1/2]:** Lý thuyết **X.X/5.0** | Thực hành **Y.Y/5.0** | Điểm năng lực **Z.ZZ/5.0**`).
  - Khi đẩy lên LMS, Bot **CHỈ điền ô `"Đánh giá chung *"` (`.ql-editor`) và tự tích đúng `9` nhóm radio `[ĐNL]` (`1..5`)** kèm đối chiếu `Read-after-Write` (`DOM` + GraphQL); **tuyệt đối không chạm, click hay sửa đổi các ô số Điểm LT/TH (`<input type="number">`), các radio/checkbox câu hỏi bài kiểm tra, hay các ô `<textarea>` nhận xét năng lực**.

## Quy Trình Thực Hiện

1. **Xác định ngữ cảnh bài học và đối tượng:**
   - Nếu người dùng cung cấp chủ đề buổi học cụ thể (ví dụ: Python, PyQt6, GameMaker/GML, HTML/CSS/Bootstrap, AI/NLP/CNN, VEX GO / VEX IQ Robotics...), lồng ghép trực tiếp kiến thức và kỹ năng của bài học đó vào phần nhận xét.
   - Nếu người dùng chưa nêu chủ đề cụ thể, viết mẫu nhận xét tổng quát cho môn lập trình và công nghệ hoặc tạo đầy đủ 5 mẫu tương ứng với 5 cấp độ học sinh.

2. **Phân loại 5 cấp độ học sinh (Tự động suy luận từ `role` của Quick Tags đã chọn):**
   - **Cấp độ 1 - Giỏi:** Tiếp thu nhanh, nắm vững tư duy thuật toán và công nghệ, chủ động hoàn thành tốt bài tập cơ bản lẫn nâng cao, có sự sáng tạo (`excellent` và không có thẻ cần cải thiện).
   - **Cấp độ 2 - Khá:** Nắm được kiến thức trọng tâm, thái độ học tập nghiêm túc, hoàn thành đúng yêu cầu bài thực hành nhưng cần thêm thời gian hoặc gợi ý ở các phần mở rộng/tối ưu hóa (`good`/`positive`, không có `distracted`/`slow`).
   - **Cấp độ 3 - Khá nhưng mất tập trung:** Tư duy nhạy bén, hiểu bài nhanh nhưng đôi lúc còn xao nhãng, làm việc riêng hoặc thao tác vội vàng dẫn đến lỗi nhỏ không đáng có (có cả thẻ tích cực `good`/`excellent` và `distracted`, không có `slow`).
   - **Cấp độ 4 - Trung bình:** Có sự cố gắng và thái độ hợp tác tốt nhưng tốc độ tiếp thu và thao tác thực hành còn chậm, cần thầy hướng dẫn từng bước để hoàn thành sản phẩm (có `slow` hoặc `improve`, không có `distracted`).
   - **Cấp độ 5 - Trung bình, mất tập trung:** Chưa nắm chắc kiến thức cơ bản của buổi học do chưa thực sự tập trung lắng nghe khi thầy giảng giải, cần sự sát sao nhiều hơn để theo kịp tiến độ (có cả `slow` và `distracted`, hoặc chỉ có `distracted`).

3. **Áp dụng cấu trúc 3 gạch đầu dòng kèm in đậm bắt buộc cho mỗi nhận xét (Mẫu 1 — Thẳng thắn & Tách dòng `+ `):**
   - `- **Điểm mạnh của học viên:**` Ghi nhận trung thực kỹ năng đạt được, thái độ tích cực, số Sao hoặc danh hiệu **Huy hiệu Top 3 học viên xuất sắc nhất lớp** (nếu có). Tuyệt đối không khen vống với học sinh `0 sao` vi phạm nhiều lỗi, và không đưa lỗi vi phạm vào mục Điểm mạnh.
   - `- **Điểm cần cải thiện:**`
     + **Khi học sinh CÓ lỗi vi phạm / đi muộn / thiếu BTVN / cần khắc phục:** Sử dụng **văn phong thẳng thắn, trực diện, nghiêm túc** (cấm nói giảm nói tránh kiểu *"đôi lúc phân tâm"*, *"hơi vội vàng"*, *"gặp chút lúng túng"*). Mở đầu bằng 1 câu dẫn thẳng thắn kết thúc bằng dấu `:`, sau đó **xuống dòng (`\n`) liệt kê ĐẦY ĐỦ 100% từng vấn đề bằng dấu `+ `** (`\n  + **...**` kèm số lần `(X lần)` nếu có và hệ quả học tập).
     + **Khi học sinh ngoan (`0` lỗi):** Góp ý ngắn gọn 1 câu phát triển kỹ năng nâng cao tự nhiên, không tự bịa dòng `+ ` vi phạm.
   - `- **Lời khuyên:**` Đề nghị giải pháp phối hợp cụ thể, sát sao tương ứng trực tiếp với các lỗi hoặc mục tiêu của con cho ba mẹ tại nhà. In đậm hành động cụ thể gợi ý cho con/ba mẹ.

4. **Đảm bảo hình thức, độ dài, văn phong và chống trùng lặp:**
   - **Độ dài:** Khoảng 100 đến 300 từ cho mỗi mẫu nhận xét.
   - **Trình bày:** Bắt buộc có dấu gạch đầu dòng (`- `) cho 3 mục, **KHÔNG ghi tên học sinh ở đầu nhận xét**, in đậm 3 tiêu đề đầu mục (`**Điểm mạnh của học viên:**`, `**Điểm cần cải thiện:**`, `**Lời khuyên:**`) và các từ khóa quan trọng trong nội dung. Ngắt dòng tạo khoảng trống rõ ràng giữa 3 mục và xuống dòng `  + ` cho từng lỗi để dễ đọc và thuận tiện gửi qua LMS/Zalo.
   - **Xưng hô:** Xưng "thầy", gọi học sinh là "con", gọi phụ huynh là "ba mẹ" hoặc "gia đình" (không lặp lại tên học sinh ở đầu bài).
   - **Văn phong:** Chuyên nghiệp, lịch sự, thẳng thắn đúng thực tế và có tính xây dựng rõ ràng để phụ huynh nắm đúng tình hình và phối hợp kịp thời cùng thầy.
   - **Chống trùng lặp câu chữ (Anti-Duplication):** Khi nhận xét nhiều học sinh trong cùng một lớp có cùng cấp độ hoặc cùng Quick Tags, mỗi học sinh phải có góc tiếp cận, cấu trúc câu mở đầu và cách diễn đạt riêng gắn với nội dung bài học; tuyệt đối không sao chép nguyên văn câu chữ giữa hai học sinh.

## Định Dạng Đầu Ra Chuẩn

Mỗi mẫu nhận xét bắt buộc tuân thủ bố cục 3 gạch đầu dòng, in đậm và tách dòng rõ ràng như sau (không có dòng tên học sinh ở đầu):

- **Điểm mạnh của học viên:** [Nội dung nhận xét điểm mạnh trung thực, đúng thực lực của con, có **in đậm các kỹ năng/kiến thức/thành tích Top 3 trọng tâm**...]

- **Điểm cần cải thiện:** [Nếu ngoan `0` lỗi: 1 câu gợi ý nâng cao. Nếu có lỗi: Câu dẫn thẳng thắn:]
  + [**Lỗi 1 (kèm số lần nếu có)** và ảnh hưởng trực tiếp tới việc học...]
  + [**Lỗi 2 (kèm số lần nếu có)** và ảnh hưởng trực tiếp tới việc học...]

- **Lời khuyên:** [Gợi ý cụ thể để ba mẹ phối hợp cùng con tại nhà, có **in đậm hoạt động ôn tập/chấn chỉnh chính**...]

## Lưu Ý Quan Trọng

- Tách bạch hoàn toàn phần ghi nhận ở `Điểm mạnh` khỏi phần phản ánh lỗi ở `Điểm cần cải thiện` (không bào chữa lỗi trong mục Điểm mạnh, không khen giả tạo khi học sinh `0 sao` và vi phạm nhiều).
- Không dùng từ ngữ miệt thị nhân cách (như "yếu kém", "lười biếng", "cá biệt"), nhưng phải nêu **thẳng thắn, đầy đủ 100% các lỗi thực tế** (đi học muộn, chưa làm BTVN, nói chuyện riêng, mất tập trung, làm việc riêng, rời khỏi chỗ ngồi) bằng danh sách xuống dòng `+ `, không nói giảm nói tránh hay bỏ sót lỗi.
- Tuyệt đối không bỏ sót bất kỳ cấp độ nào trong 5 cấp độ hoặc thiếu cấu trúc 3 gạch đầu dòng in đậm.
