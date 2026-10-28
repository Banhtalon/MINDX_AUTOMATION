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

- **Hướng Robotics (`regular_robotics` — 6 thẻ):**
  1. `🤖 Lắp ráp & Lập trình tốt` (`role: "good"`)
  2. `🙋 Hăng hái phát biểu` (`role: "positive"`)
  3. `🤝 Phối hợp nhóm & Giữ Kit tốt` (`role: "positive"`)
  4. `👀 Mất tập trung` (`role: "distracted"`)
  5. `🔩 Lắp ráp còn chậm / Nhầm chốt` (`role: "slow"`)
  6. `🔌 Lập trình / Đấu mạch còn lúng túng` (`role: "improve"`)

- **Quy tắc Buổi Kiểm tra / Checkpoint (Lập trình: Buổi 5 & 9; Robotics: Buổi 4 & 8):**
  - Nhận xét văn bản vẫn giữ nguyên cấu trúc 3 gạch đầu dòng chuẩn mực bên dưới.
  - Khi đẩy lên LMS, Bot **chỉ điền duy nhất ô `"Đánh giá chung *"` (`.ql-editor`)** và **tuyệt đối không tự động tích chọn hay sửa đổi các ô Điểm Năng lực `[ĐNL]`, nhận xét năng lực hoặc Điểm kiểm tra/thực hành** (việc tích ô năng lực và điểm kiểm tra do giáo viên tự thực hiện trên LMS).

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

3. **Áp dụng cấu trúc 3 gạch đầu dòng kèm in đậm bắt buộc cho mỗi nhận xét:**
   - `- **Điểm mạnh của học viên:**` Nêu rõ kỹ năng đạt được, thái độ tích cực, sự hào hứng hoặc tiến bộ của con dựa trên nội dung bài học. In đậm các từ khóa kỹ năng, kiến thức hoặc sản phẩm trọng tâm con đã làm được.
   - `- **Điểm cần cải thiện:**` Nêu các vấn đề về kỹ năng thao tác, tư duy logic hoặc sự tập trung một cách khéo léo, nhẹ nhàng, tránh gây tâm lý nặng nề. In đậm các điểm mấu chốt cần lưu ý khắc phục.
   - `- **Lời khuyên:**` Gợi ý giải pháp cụ thể, thiết thực để phụ huynh dễ dàng đồng hành, khích lệ và nhắc nhở con ôn tập ở nhà. In đậm hành động cụ thể gợi ý cho con/ba mẹ.

4. **Đảm bảo hình thức, độ dài và văn phong:**
   - **Độ dài:** Khoảng 100 đến 300 từ cho mỗi mẫu nhận xét.
   - **Trình bày:** Bắt buộc có dấu gạch đầu dòng (`- `) cho 3 mục, **KHÔNG ghi tên học sinh ở đầu nhận xét**, in đậm 3 tiêu đề đầu mục (`**Điểm mạnh của học viên:**`, `**Điểm cần cải thiện:**`, `**Lời khuyên:**`) và các từ khóa quan trọng trong nội dung. Ngắt dòng tạo khoảng trống rõ ràng giữa 3 mục để dễ đọc và thuận tiện gửi qua LMS/Zalo.
   - **Xưng hô:** Xưng "thầy", gọi học sinh là "con", gọi phụ huynh là "ba mẹ" hoặc "gia đình" (không lặp lại tên học sinh ở đầu bài).
   - **Văn phong:** Chuyên nghiệp, lịch sự, tích cực, mang tính xây dựng cao để phụ huynh cảm thấy thoải mái, tin tưởng và sẵn sàng hợp tác cùng thầy.

## Định Dạng Đầu Ra Chuẩn

Mỗi mẫu nhận xét bắt buộc tuân thủ bố cục 3 gạch đầu dòng, in đậm và tách dòng rõ ràng như sau (không có dòng tên học sinh ở đầu):

- **Điểm mạnh của học viên:** [Nội dung nhận xét điểm mạnh cụ thể của con trong buổi học, có **in đậm các kỹ năng/kiến thức trọng tâm**...]

- **Điểm cần cải thiện:** [Nội dung góp ý khéo léo, tích cực, có **in đậm điểm cần khắc phục**...]

- **Lời khuyên:** [Gợi ý cụ thể để ba mẹ đồng hành cùng con tại nhà, có **in đậm hoạt động ôn tập chính**...]

## Lưu Ý Quan Trọng

- Luôn bắt đầu bằng sự ghi nhận tích cực, ngay cả với học sinh thuộc nhóm "Trung bình, mất tập trung" (khen ngợi sự có mặt, một thao tác làm được hoặc thái độ lễ phép của con).
- Không dùng từ ngữ phán xét nặng nề (như "yếu kém", "lười biếng", "cá biệt"). Thay bằng các cụm từ mang tính hỗ trợ (như "cần rèn luyện thêm sự tỉ mỉ", "nếu con tập trung hơn sẽ phát huy rất tốt", "cần thêm thời gian thực hành để quen thao tác").
- Tuyệt đối không bỏ sót bất kỳ cấp độ nào trong 5 cấp độ hoặc thiếu cấu trúc 3 gạch đầu dòng in đậm.
