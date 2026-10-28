# CHANGELOG — LỊCH SỬ PHIÊN BẢN DỰ ÁN MINDX AUTOMATION BOT

Tài liệu này ghi nhận đầy đủ các mốc phát triển, tính năng mới, cải tiến giao diện và các bản vá lỗi thực tế trên hệ thống MindX LMS theo từng phiên bản.

---

## [v3.1.1] — 2026-10-28 (Tự Động Chuyển Bộ Thẻ Robotics Theo Mã Lớp `ROB`, Tự Nhớ Quick Tags Từ Buổi Học Trước & Tinh Gọn Ghi Chú Trang SPCK)

> **Kiểm định độc lập v3.1.1 — Vòng 3 (2026-10-28): GO trong phạm vi tái kiểm được yêu cầu.** Commit `3afb54c` đã đóng cả `R2-01` và `R2-02`: chuyển tiếp thao tác xóa hết thẻ khi ghi chú/điểm danh và bảo toàn thẻ đang chờ khi điểm danh cả lớp, kể cả bật thẻ mặc định. Chạy mới **7/7 cổng PASS**, probe gốc **18/18**, probe Vòng 2 **57/57**, Dashboard **8/8 tổ hợp đạt**; **48/48 assertion bổ sung PASS** (probe kết hợp 105/105, không cộng trùng). Đã xác nhận metadata xóa thẻ trong SQLite và giữ đúng ý định sau tải lại qua harness. Không sửa mã ứng dụng hoặc DB Owner; chưa nghiệm thu production/LMS thật. Báo cáo: `docs/audits/v311/CODEX_REVIEW_ROUND3.md`; bằng chứng mới: `docs/audits/v311/round3/`. Các kết luận NO-GO bên dưới là lịch sử vòng trước.

> **Kiểm định độc lập v3.1.1 — Vòng 2 (2026-10-28): NO-GO.** Commit `2b70f95` chạy mới **6/6 cổng PASS**, probe vòng 1 **18/18 PASS**, Dashboard **8/8 tổ hợp vừa viewport**. Cả bốn biểu hiện vòng 1 đã hết; phạm vi lưu thẻ của R1-02 còn hai thiếu sót P2: `R2-01` không chuyển tiếp xóa trắng thẻ khi ghi chú/điểm danh lưu chồng nhau, `R2-02` điểm danh cả lớp bỏ qua thẻ đang chờ lưu. Probe mở rộng **47/57 PASS, 10 assertion FAIL thuộc hai lỗi**; so sánh component cũ xác nhận lỗi có sẵn, không quy là hồi quy mới của bản sửa. Không sửa mã ứng dụng hoặc DB Owner. Báo cáo và điều kiện GO: `docs/audits/v311/CODEX_REVIEW_ROUND2.md`; bằng chứng mới: `docs/audits/v311/round2/`.

> **Kiểm định độc lập Vòng 1 (2026-10-28): NO-GO.** Chạy mới 4/4 cổng đạt trong bản sao tạm, nhưng probe độc lập chỉ đạt 12/18 kiểm tra: `R1-01` test có thể xóa nhận xét lớp thật, `R1-02` chưa lưu bền thẻ kế thừa khi hai lần nhập chồng nhau và lần đầu thất bại, `R1-03` nhánh số buổi không xác định có thể kế thừa sai thời gian. Dashboard đã có từ commit nền còn chưa vừa 1366×768 (`R1-04`). Không sửa mã ứng dụng hay DB Owner; bổ sung báo cáo, probe và bằng chứng tại `docs/audits/v311/CODEX_REVIEW_ROUND1.md`.

### 🤖 Tự Động Nhận Diện Bộ Thẻ Robotics / Lập Trình & Bỏ Hộp Đổi Thẻ Thủ Công (`src/app/session-comments/page.tsx`, `src/lib/quick-tags/index.ts`)
- Khi chọn hoặc tải lớp trên `/session-comments`, mọi lớp có chữ `ROB` (ví dụ `VT-ROB-SEMIA05`, `VT-KIND-ROB4I02`, `VT-ROB-ARMA13`) hoặc mã Robotics (`PRE`, `ARM`, `SEMI`, `VEX`) tự động áp dụng **bộ 6 thẻ Robotics**; các lớp còn lại tự động áp dụng **bộ 7 thẻ Lập trình**.
- Loại bỏ hoàn toàn hộp nút **`[💻 Thẻ Lập trình (7) | ⇄ Đổi bộ thẻ]`** trên thanh công cụ và ngừng nối thêm các thẻ mẫu cũ (`"👍 Đạt yêu cầu"`) vào danh sách nút chọn của học viên.

### 🧠 Tự Động Nhớ Quick Tags Từ Buổi Học Trước (`src/app/api/session-comments/list/route.ts`, `src/app/session-comments/page.tsx`, `src/lib/quick-tags/index.ts`, `src/lib/gemini/comment-generator.ts`)
- Bổ sung `previousQuickTagsByStudent` trong `GET /api/session-comments/list`: tự động tìm bộ thẻ của buổi học gần nhất trước đó (`sessionNumber < curSessNum`) cho từng học viên, tôn trọng trường hợp giáo viên đã chủ động xóa trắng thẻ ở buổi liền trước (`fields.quickTags`), và chuẩn hóa thẻ cũ sang bộ thẻ chuẩn theo bộ môn qua `normalizeQuickTagsForTrack`.
- Trên `/session-comments`, học viên ở buổi mới chưa có thẻ/nhận xét sẽ được tự động gắn sẵn bộ thẻ từ buổi trước kèm nhãn nhỏ **`↺ Nhớ từ Buổi X`**, giúp giáo viên chỉ cần gắn thẻ 1 lần ở Buổi 1 và các buổi sau chỉ chỉnh lại những bạn có thay đổi. Khi điểm danh, nhập ghi chú hoặc bấm soạn AI, bộ thẻ kế thừa được tự động lưu bền vững vào SQLite của buổi hiện tại.

### 🧹 Tinh Gọn Giao Diện Trang Chủ (`/`) & Trang SPCK (`/final-project`) (`src/app/page.tsx`, `src/app/final-project/page.tsx`)
- Cân đối lại chiều cao và bố cục 2 cột trên Dashboard (`src/app/page.tsx`) để lấp đầy khung nhìn màn hình hài hòa, không bị khoảng trống thừa bên dưới.
- Loại bỏ 6 cụm chữ ghi chú nhỏ gây rối mắt trên `/final-project` (dưới mục `1A`, `1B`, `1C`, `Bước 2`, khu vực `Chuẩn bị Demo`, thanh lọc chọn học viên, `Bước 3` và `Bước 4`).

---

## [v3.1.0] — 2026-10-28 (Thiết Kế Lại Toàn Diện Giao Diện Chế Độ Sáng / Tối — Light Mode & Dark Mode 1 Chạm)

> **Kết quả kiểm định Vòng 4 hiện tại: GO trong phạm vi xác minh giao diện được yêu cầu (2026-10-28).** Đã đóng `R3-01`, duy trì Vòng 1 và `R2-01`/`R2-02`; cả năm nhãn trạng thái và nhãn cổng SPCK có chữ trắng, tương phản tối thiểu 5,36:1 qua đủ bốn tổ hợp màu ứng dụng/hệ điều hành. Ba lệnh yêu cầu (theme probe, TypeScript, phase4 repros) và probe mở rộng đều chạy mới đạt (exit 0). Không sửa mã ứng dụng; không xác nhận lại bản dựng đầy đủ, 12 bộ kiểm thử hay toàn bộ năm màn hình. Reviewer Claude không có trong môi trường; Codex trực tiếp kiểm định. Chi tiết: `docs/audits/v310/CODEX_REVIEW_ROUND4.md`; lịch sử NO-GO Vòng 3: `docs/audits/v310/CODEX_REVIEW_ROUND3.md`.

### 🎨 Hệ Thống Chủ Đề Sáng / Tối 1 Chạm (`src/components/top-navbar.tsx`, `src/app/layout.tsx`, `src/app/globals.css`)
- **Nút chuyển đổi `☀️ Sáng / 🌙 Tối` trên Thanh điều hướng (`TopNavbar`):**
  - Mặc định mở ở **Chế độ Sáng (Light Mode)** (`data-theme="light"` trên `<html>`), tự động lưu lựa chọn vào `localStorage` (`mindx_ui_theme`), đồng bộ tức thì qua `MutationObserver` và đánh dấu gạch chân nổi bật dưới mục menu đang mở (trắng ở chế độ Sáng, xanh lam phát sáng `#38bdf8` ở chế độ Tối).
  - Khai báo `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));` trong `src/app/globals.css` để toàn bộ lớp `dark:*` của Tailwind CSS v4 bám chính xác theo nút chuyển đổi của ứng dụng thay vì phụ thuộc cài đặt hệ điều hành.
- **Phong cách Chế độ Sáng (Light Mode — Theo đúng 5 ảnh mẫu của Owner):**
  - Thanh điều hướng xanh Navy đậm (`#132f7c -> #1c3d94`), nền trang xám xanh dịu mắt (`#dce6f2 -> #e8eff8`), khối tiêu đề đầu trang **Xanh Hoàng Gia (`.mindx-hero`: `#1d3a8a -> #2563eb`)** chữ trắng sắc nét.
  - Các thẻ nội dung và dòng học viên nền trắng tinh khiết (`#ffffff`) kèm **viền điểm nhấn dày bên trái (`border-l-4` / `5px`)** theo 4 nhóm màu (Cam `#d97706`, Xanh dương `#0284c7`, Xanh lá `#059669`, Tím `#7c3aed`) và nhãn viên thuốc đặc màu (`.mindx-badge-*`).
  - Tiêu đề bảng (`.mindx-thead`) màu xanh đen đậm (`#172554`) chữ trắng in hoa; hộp kiến thức buổi học & cấu hình Buổi Kiểm tra (Checkpoint) nền vàng kem ấm (`.mindx-warm-box`: `#fef3c7`).
- **Phong cách Chế độ Tối (Dark Mode — Theo đúng ảnh mẫu Midnight Navy & Viền Phát Sáng Dịu):**
  - Nền trang xanh đêm sâu (`radial-gradient` `#15254d -> #0b1224 -> #070c18`), khối tiêu đề và các thẻ chức năng nền xanh đêm (`#16213a -> #10192e`) có **viền màu mảnh `1.5px` phát sáng nhẹ (`box-shadow: 0 0 20px ...`)**, nhãn viên thuốc bán trong suốt có viền sáng, và viên thuốc nhật ký góc dưới trái (`.mindx-log-pill`) phát sáng xanh ngọc.
- **Kiểm thử & Kiểm định Độc lập (`Codex CLI gpt-6.1-sol high`):** Toàn bộ **12/12 bộ kiểm thử tự động PASS 100%**, chụp ảnh đối chiếu đủ 10 khung hình (5 Sáng + 5 Tối) và đạt **VERDICT: GO** từ Codex CLI.

---

## [v3.0.0] — 2026-10-28 (Tái Thiết Kế Quick Tags Theo Bộ Môn Lập Trình / Robotics, Chế Độ Nhận Xét Buổi Kiểm Tra Checkpoint & Tinh Gọn Toàn Diện Giao Diện 5 Màn Hình)

### 🏷️ Tách Biệt Triệt Để & Tái Thiết Kế Quick Tags Theo Bộ Môn (`data/config/quick_tags.json`, `src/lib/quick-tags/index.ts`)
- **Xóa bỏ hoàn toàn sự chồng chéo giữa thẻ buổi thường và buổi 14 SPCK:**
  - Màn hình 1 (`/session-comments`) và `CommentGenerator` (`src/lib/gemini/comment-generator.ts`) chỉ sử dụng bộ thẻ đánh giá buổi học thường kỳ (`regular_coding` hoặc `regular_robotics`) theo đúng bộ môn của lớp, tuyệt đối không bao giờ trộn lẫn thẻ `spck_session14_presentation` / `spck_session14_product`.
  - Màn hình 3 (`/final-project`) đọc trực tiếp thẻ thuyết trình & sản phẩm Buổi 14 từ `quick_tags.json` làm nguồn chuẩn duy nhất (Single Source of Truth), loại bỏ mảng hằng số trùng lặp.
- **Bộ Quick Tags tinh gọn theo đúng đặc thù bộ môn:**
  - **Lập trình (`regular_coding` — 7 thẻ):** `✅ Tiếp thu tốt` (`good`), `📝 Làm bài tập đầy đủ` (`good`), `🙋 Hăng hái phát biểu` (`positive`), `💡 Vận dụng & Sáng tạo tốt` (`excellent`), `🐢 Tiếp thu chậm` (`slow`), `👀 Mất tập trung` (`distracted`), `⌨️ Thao tác / Cú pháp còn chậm` (`improve`).
  - **Robotics (`regular_robotics` — 6 thẻ):** `🤖 Lắp ráp & Lập trình tốt` (`good`), `🙋 Hăng hái phát biểu` (`positive`), `🤝 Phối hợp nhóm & Giữ Kit tốt` (`positive`), `👀 Mất tập trung` (`distracted`), `🔩 Lắp ráp còn chậm / Nhầm chốt` (`slow`), `🔌 Lập trình / Đấu mạch còn lúng túng` (`improve`).

### 🎯 Cơ Chế Xử Lý Buổi Kiểm Tra Định Kỳ — Checkpoint (`Buổi 5 & 9` Lập trình; `Buổi 4 & 8` Robotics)
- **Tự động nhận diện Buổi Kiểm tra (Checkpoint) theo từng khóa học (`data/config/courses_syllabus.json`, `src/lib/quick-tags/index.ts`):**
  - Các khóa Lập trình (`SCRATCH`, `GAMEMAKER`, `PYTHON`, `WEB`, `CS`): `checkpointSessions: [5, 9]`.
  - Các khóa Robotics (`ROBO_PRE`, `ROBO_ARM`): `checkpointSessions: [4, 8]`.
- **Nguyên tắc Vàng khi lưu LMS ở Buổi Checkpoint (`src/lib/playwright/save-comments.ts`):**
  - Giáo viên tự chấm điểm kiểm tra và tích chọn 9 mục Điểm Năng lực `[ĐNL]` trên LMS trước.
  - Bot mở hộp thoại nhận xét (tự động chuyển từ chế độ Xem sang chế độ Sửa nếu đã có bảng tổng hợp điểm năng lực), **chỉ điền duy nhất ô `"Đánh giá chung *"` (`.ql-editor`)**, **tuyệt đối không chạm vào bất kỳ nút chọn năng lực (`input[type="radio"]`), ô ghi chú năng lực (`textarea`), ô tích bài kiểm tra (`checkbox`) hay ô điểm thực hành nào**, sau đó bấm `Save` và mở lại hộp thoại để đối chiếu `Read-after-Write`.
  - Nếu giáo viên quên chưa tích Điểm Năng lực `[ĐNL]` khiến LMS từ chối lưu, Bot tự động trả về thông báo rõ ràng nhắc giáo viên tích `[ĐNL]` trên LMS trước.
- **Hỗ trợ tính Điểm Demo Buổi 14 chuẩn xác cho cả lớp Robotics (`src/lib/local-files/spck-demo-score-reader.ts`, `src/lib/gemini/session14-course-summary.ts`):**
  - Tự động nhận diện thang điểm Demo 5 tiêu chí riêng của khóa Robotics (`1.0 / 0.5 / 1.25 / 0.75 / 1.0`, tổng `4.5` điểm) và hiển thị đúng thang điểm trong prompt AI tổng kết cuối khóa Buổi 14.

### ✨ Tinh Gọn Toàn Diện Giao Diện 5 Màn Hình & Thanh Nhật Ký (`src/app/**`, `src/components/live-log-drawer.tsx`)
- **Trang chủ (`/`) & Thanh Nhật ký (`live-log-drawer.tsx`):** Thu gọn còn 4 thẻ công cụ trực quan và dải trạng thái 1 dòng; chuyển nút mở thanh nhật ký sang dạng viên thuốc gọn nhẹ ở góc dưới bên phải (không còn thanh bar cố định che khuất nội dung).
- **Màn hình 1 (`/session-comments`):** Gộp thanh chọn Lớp + Buổi + Tải danh sách lên 1 hàng ngang duy nhất; hiển thị nhãn phân biệt rõ `Buổi thường` / `🎯 Buổi Kiểm tra (Checkpoint)` kèm lưu ý ngắn gọn; tự động ẩn các nút chọn hàng loạt mẫu cũ không thuộc bộ thẻ mới.
- **Màn hình 2 (`/homework-grader`):** Dùng chung danh sách lớp đang dạy (`runningClasses`) và tự động nhớ mã lớp vừa chọn (`mindx_last_class_code`), giáo viên chỉ cần chọn 1 lần ở đầu trang cho cả 2 tab *Cào Bảng Điểm* và *Chấm Bài Tập*.
- **Màn hình 3 (`/final-project`):** Gom các công cụ phụ (Cổng thu bài học sinh, Tạo bảng chấm điểm Demo, Tải lên Google Drive / GitHub Pages, Nhập link YouTube) vào menu gọn **"🧰 Công cụ chuẩn bị & thu bài"**; tự động ẩn khu vực Đánh giá Buổi 14 khi đang chọn Buổi 12 hoặc Buổi 13.
- **Màn hình 4 (`/syllabus-config`):** Ẩn tab *Mẫu Zalo* không còn dùng trên giao diện (vẫn giữ nguyên API backend tương thích ngược) và hiển thị thẻ Quick Tags phân nhóm rõ theo 3 danh mục (*Lập trình*, *Robotics*, *SPCK Buổi 14*).
- **Kiểm thử & Kiểm định Độc lập (`scripts/test-quick-tags-v300.ts`, `scripts/test-checkpoint-v300.ts`):** Toàn bộ **12/12 bộ kiểm thử tự động PASS 100%**, đạt **VERDICT: GO** từ Codex CLI (`gpt-6.1-sol` high).

---

## [v2.9.0] — 2026-10-27 (Thiết kế lại Buổi 14 — Tổng kết Cuối khóa, Tự động đọc Điểm Demo từ File Chấm Điểm BGK, AI Nhận xét SPCK 2 Phần & Thư từ MindX 3 Phần)

### 🚫 Tách Biệt Hoàn Toàn Buổi 14 Khỏi Màn Hình 1 (`/session-comments` $\rightarrow$ Chuyển 100% Sang `/final-project`)
- **Loại bỏ Buổi 14 khỏi danh sách nhận xét buổi học thường kỳ (`src/app/session-comments/page.tsx`, `src/app/api/session-comments/save-lms/route.ts`, `src/lib/playwright/save-comments.ts`):**
  - Màn hình 1 (`/session-comments`) chỉ hiển thị và xử lý **Buổi 1 $\rightarrow$ Buổi 13** (mẫu nhận xét 3 gạch đầu dòng in đậm gửi phụ huynh sau buổi học).
  - Bổ sung thông báo hướng dẫn kèm nút chuyển nhanh sang **Màn hình 3 — Sản phẩm cuối khóa (`Tab SPCK — Buổi 14`)** và chặn cứng mọi yêu cầu lưu nhận xét 3 gạch đầu dòng cho `sessionNumber === 14` (`_SESS_14`) ở cả tầng API và tầng `CommentSaver`.

### ✨ Nâng Cấp AI Nhận Xét SPCK Buổi 14 Theo Mẫu Giáo Viên Thực Tế 2 Phần (`src/lib/gemini/spck-comment.ts`, `data/config/quick_tags.json`)
- **Bố cục 2 mục đánh số chuẩn mẫu giáo viên (`1. Về phần thuyết trình` & `2. Về phần sản phẩm cuối khóa`):**
  - Khi soạn nhận xét SPCK ở **Buổi 14**, AI tự động trình bày thành 2 mục rõ ràng:
    1. `1. Về phần thuyết trình`: Đánh giá việc chuẩn bị slide (mẫu thiết kế đẹp, bố cục rõ ràng, nội dung đầy đủ/dễ nhìn), cách giới thiệu các nội dung chính & ý tưởng sản phẩm, và lời khuyên rèn luyện sự tự tin/diễn đạt hoặc tìm hiểu kỹ hơn về đoạn code trong sản phẩm để giải thích khi thuyết trình.
    2. `2. Về phần sản phẩm cuối khóa`: Nêu rõ tên đề tài/website/ứng dụng, đánh giá giao diện/màu sắc/bố cục, các kỹ thuật đã vận dụng (tự động quét `.html/.css/.js` nhận diện `<title>`, `<h1>`, số trang HTML, `Flexbox`, `CSS Grid`, `Responsive`), và nhắc nhở khéo léo nếu học viên còn phụ thuộc nhiều vào AI mà chưa hiểu sâu phần cốt lõi của code.
  - Tự động rút gọn cách gọi tên học viên ở Buổi 14 (`formatSpckStudentCallName`: ví dụ `"Mccully Mac Dallas" -> "Dallas"`, `"Nguyễn Thiên Phúc" -> "Thiên Phúc"`) kết hợp đại từ `"em"`.

### 📊 Tự Động Đọc Điểm Demo Từ File Chấm Điểm BGK & Soạn Thư Từ MindX 3 Phần (`spck-demo-score-reader.ts`, `session14-course-summary.ts`, `session14-eval-uploader.ts`)
- **Bảng CSDL `spck_session14_evaluations` (`src/lib/db/sqlite.ts`):** Lưu trữ độc lập 9 tiêu chí Điểm Năng lực `[ĐNL]` (thang `1..5`, tự động tính trung bình làm tròn 2 chữ số thập phân), 5 tiêu chí Điểm Demo (tổng tối đa `5.0`), 3 ô `Thư từ MindX` (`learnedFromMindx`, `suggestionsFromMindx`, `futureDirection`), kèm khóa `contentHash` (`SHA-256`) và tự động hạ trạng thái về `WAITING_APPROVAL` nếu chỉnh sửa sau khi duyệt.
- **Đọc tự động `Bảng chấm điểm buổi Demo (.xlsx / Google Sheet)` (`src/lib/local-files/spck-demo-score-reader.ts`):**
  - Đọc trực tiếp file `.xlsx` trong thư mục lớp hoặc xuất từ link Google Sheet (`export?format=xlsx`), khớp từng tab học viên / ô `B2` (`Họ và tên Học viên:`), cộng điểm trực tiếp từ `E8:E27` / `B32:B36` cho 5 tiêu chí (`Tư duy máy tính, thuật toán` `1.5`, `Tư duy sáng tạo` `1.0`, `Kỹ năng giao tiếp, hợp tác` `0.5`, `Giải quyết vấn đề` `1.0`, `Kỹ năng sử dụng máy tính` `1.0`), trích xuất nhận xét BGK (`B30`/`C30`) và gợi ý 9 mục Điểm Năng lực `[ĐNL]`.
- **AI Soạn Thư Tổng Kết Cuối Khóa 3 Phần Theo Mẫu Mccully Mac Dallas (`src/lib/gemini/session14-course-summary.ts`):**
  - Ẩn danh 100% tên học viên (`STUDENT_FULL_01`, `STUDENT_SHORT_01`) trước khi gọi Gemini (`gemini-3.5-flash-lite`); trả về `INSUFFICIENT_INFO` nếu thiếu dữ kiện đầu vào.
  - **Phần 1 (`Learned From Mindx`):** Lời chào trang trọng có đầy đủ họ tên $\rightarrow$ `Về kiến thức chuyên môn:` (3 đoạn văn: quá trình học, điểm cần lưu ý từ lịch sử buổi 1–13, kết quả dự án cuối khóa & slide) $\rightarrow$ `Kết quả đánh giá:` (`Điểm Demo: X điểm` & `Điểm Năng lực: Y điểm` do TypeScript chèn chính xác 100%) $\rightarrow$ `Về kỹ năng mềm (giao tiếp, hợp tác, thuyết trình):` (2 đoạn văn) $\rightarrow$ `Nhận xét cá nhân:` (3 đoạn văn kết thúc bằng lời chúc chuẩn MindX).
  - **Phần 2 (`Suggestions From Mindx`):** 2–3 câu khuyên duy trì điểm mạnh và cải thiện sự tập trung/cẩn thận.
  - **Phần 3 (`Future Direction`):** 3–4 câu đánh giá tiềm năng và định hướng học lên khóa nâng cao tiếp theo (`JSB -> JSA`, `JSA -> JSI`, `PTB -> PTA`, `PTA -> PTI`, `SB -> SA`, `GB -> GA`, `CSB -> CSA`...).
- **Playwright Tự Động Đẩy Lên LMS Kèm Đối Chiếu Read-after-Write (`src/lib/playwright/session14-eval-uploader.ts`):** Tự động mở modal `"Nhận xét học sinh"` ở Buổi 14, tích chọn 9 nhóm radio `[ĐNL]` (45 radio), điền 5 ô `input[type="number"]` Điểm Demo và 3 ô `.ql-editor` Thư từ MindX, kiểm tra lại trạng thái slot Buổi 14 ngay sát nút `Save` (`F03`), bấm `Save`, khóa chặt đúng mutation lưu đánh giá từ `lms-api.mindx.edu.vn` (`F01`), và đọc lại DOM đối chiếu toàn văn 100% cả 3 ô chữ (`F02`) + 9 radio + 5 ô điểm trước khi đánh dấu `VERIFIED`.
- **Gia cố 12 Ranh Giới An Toàn Từ Kiểm Định Độc Lập Vòng 1 (`F01` $\rightarrow$ `F12`):**
  - Chặn ghép nhầm học viên khi tên ngắn trùng nhiều người, xung đột tên giữa ô `B2` và tên tab, hai tab trùng cùng 1 học viên (`F04`), hoặc bảng điểm trống/chưa chấm đủ 5 tiêu chí (`F10`).
  - Tự động đồng bộ 2 dòng `Điểm Demo:` và `Điểm Năng lực:` trong thư `Learned From Mindx` mỗi khi điểm thay đổi và kiểm tra khớp điểm trước khi cho `APPROVED` (`F06`).
  - Bảo vệ chống phản hồi AI chậm ghi đè lên bản giáo viên vừa sửa/duyệt (`F05`), ẩn danh triệt để cả tên gọi 1 từ, tên không dấu và tên bạn cùng lớp (`F09`), và chặn bản ghi chỉ có điểm danh `ABSENT` không có nhận xét vượt qua cổng `INSUFFICIENT_INFO` (`F11`).
  - Đồng bộ chờ lưu nháp `onBlur` hoàn tất và khóa `expectedVersion` (`HTTP 409` khi lệch phiên bản) trước khi Duyệt & Đẩy LMS (`F07`), bảo vệ chống phản hồi lưu chậm xóa chữ đang gõ hoặc trộn dữ liệu khi chuyển lớp (`F08`), và loại bỏ hoàn toàn fallback chọn Buổi 14 ở `/session-comments` (`F12`).
- **Kiểm thử Tự động (`scripts/test-session14-v290.ts`) & Kiểm định Độc lập Vòng 9 (`docs/audits/v290/CODEX_REVIEW_ROUND9.md`):** Đạt **VERDICT: GO** trên Codex CLI (`gpt-6.1-sol xhigh`), toàn bộ **12/12 hạng mục `F01` $\rightarrow$ `F12` đều CLOSED**, **8/8 cổng kiểm thử bắt buộc PASS (`exit code 0`)** và **263/263 ca probe độc lập đúng kỳ vọng (`100%`)**. Khóa chặt phản hồi tải lại vào đúng yêu cầu đã bắt (`res.request() === req`) trong cửa sổ `6000ms`, không dùng nguồn Save để bỏ qua khi yêu cầu tải lại bị lỗi/timeout, và kiểm tra nghiêm ngặt số nguyên `1..5` cho 9 tiêu chí năng lực `[ĐNL]`.

---

## [v2.8.0] — 2026-10-26 (Nâng cấp Độ tin cậy & Cơ chế Tự phục hồi Giao diện LMS — Chống kẹt hộp thoại, Chống tự tắt bảng học viên & Vét tự động Lượt 2)

### 🛡️ Bộ Hàm Tự phục hồi Giao diện Dùng chung (`src/lib/playwright/lms-helpers.ts`)
- **`LmsHelpers.ensureCleanDialogAndToast(page, interceptor)`:** Tự động tắt thông báo `.Forbidden` góc dưới phải và kiểm tra đóng hộp thoại `[role="dialog"]:visible` bị kẹt từ học viên trước (kể cả khi DOM có một `[role="dialog"]` ẩn đứng trước). Chỉ nhấn `Escape` khi có dialog đang hiển thị và cô lập việc click `.MuiBackdrop-root` bên trong tổ tiên `.MuiDialog-root:not(.MuiDrawer-root)` để **không bao giờ bấm nhầm vào backdrop của ngăn kéo `.MuiDrawer-root`**.
- **`LmsHelpers.ensureCommentsSlotReady(page, classCode, slotNumber, options)`:** Kiểm tra ngăn kéo lớp học và tab `Comments` (`#tab-10`), kiểm tra chính xác class `.active` trên `#class-comments-slot-carousel-{slotIndex}`; **tuyệt đối không bấm lại vào ô buổi học khi đã có `.active`** (tránh hành vi toggle của MindX LMS làm ẩn bảng học viên), tự động bấm `.info-container` tối đa 3 lần nếu ô buổi học không có `.active`, chờ bảng học viên (`.comment-list-table table`) hiển thị sẵn sàng, và **bắt buộc ném lỗi dừng ngay** nếu không tìm thấy slot, slot bị `disabled`, hoặc sau 3 lần thử vẫn chưa lên `.active` (chống ghi nhầm sang buổi học khác).

### 🔧 Chống Tắt Bảng Học Viên, Cách ly Thanh Tab `Homework` & Vét Tự Động Lượt 2 (`save-comments.ts`, `spck-uploader.ts`, `sync-class.ts`, `grade-worker.ts`)
- **Cách ly selector `Summary` / `Homework` & Kích hoạt `ClickAwayListener` an toàn (`src/lib/playwright/save-comments.ts`):**
  - Loại trừ `:not(:has([role="tablist"])):not(:has([role="tab"]))` trong `fillSlotSection` để mục `Homework` của buổi học không bao giờ khớp nhầm vào nút `<button role="tab">Homework</button>` trên thanh điều hướng đầu Drawer.
  - Khi lưu `Summary` và `Homework`, kích hoạt `ClickAwayListener` bằng cách click vào tiêu đề cột bảng học viên (`th:has-text("student"), th:has-text("Comment")`) và phát sự kiện `mousedown/mouseup/click` — tuyệt đối không click vào `slotItem` đang `.active`; đồng thời kiểm tra lại `.active` ngoài khối `try/catch` của `Summary`/`Homework` trước khi xử lý học viên.
  - Loại bỏ hàm con lồng bên trong `editor.evaluate` để tương thích 100% với cả Next.js SWC và `tsx`/esbuild CLI (không phát sinh lỗi `__name is not defined`).
- **Tự phục hồi trước mỗi học viên & Ranh giới Vét tự động Lượt 2 (`Auto-Retry Pass 2`):**
  - Trong `CommentSaver.saveComments` (`save-comments.ts`), `SpckUploader.uploadApprovedSpck` (`spck-uploader.ts`) và `HomeworkGradeWorker.saveApprovedGrades` (`grade-worker.ts`), trước mỗi học viên và ngay trước khi bấm `Save` đều kiểm tra xác nhận ô buổi học đích đang `.active` (nếu mất `.active` và không khôi phục được thì dừng ngay trước khi bấm `Save`).
  - Khóa cờ `saveMutationDispatched = true` ngay trước khi bấm nút `Save` (trên cả `save-comments.ts` và `spck-uploader.ts`) và chỉ cho phép chế độ `alreadySavedAndVerifiedInViewMode` khi bản ghi trong SQLite vốn đã là `VERIFIED` ở lượt đầu: đảm bảo **Vét tự động Lượt 2 (`Auto-Retry Pass 2`) chỉ chạy cho lỗi giao diện xảy ra trước khi bấm `Save`**, tuyệt đối không bao giờ gửi lặp sau khi đã bấm `Save` hoặc tự đánh dấu `VERIFIED` từ bộ nhớ đệm giao diện khi API mạng bị đứt, và không bao giờ retry các lỗi bảo vệ dữ liệu (`Hash drift`, `IN_FLIGHT_DRIFT`, `Read-after-Write`, học viên `ABSENT`, ngừng hoạt động hoặc trùng tên).
- **Bảo vệ trạng thái `.active` khi đồng bộ lớp (`src/lib/playwright/sync-class.ts`):** Trong `scrapeSessions`, kiểm tra `latestSlot.classList.contains("active")` trước khi click để không vô tình tắt buổi học đang mở trên LMS.
- **Sửa triệt để lỗi bỏ qua Tự động Đăng nhập LMS (`src/lib/playwright/auth.ts`, `src/lib/playwright/lms-helpers.ts`, `src/lib/playwright/sync-class.ts`):** Tách chuẩn `hostname` và `pathname` qua `new URL()` (`parseUrlParts`, `isLoginHostOrPath`) thay vì tìm chuỗi trên toàn URL (tránh bị lừa bởi tham số `?callbackUrl=https://lms.mindx.edu.vn/admin/dashboard` trên trang đăng nhập `base.mindx.edu.vn/login`); chờ phản hồi kiểm tra phiên SPA của LMS ổn định trước khi kết luận đã đăng nhập; và tự động gọi `authService.ensureAuthenticated("LMS")` ngay trong `LmsHelpers.openClassDrawer` nếu phát hiện bị chuyển hướng muộn về màn hình đăng nhập. (Đã xác minh đồng bộ trực tiếp lớp `VT-C4K-GA38` thành công: 14 buổi, 9 học viên).
- **Khử trùng lặp ảnh tự chụp `_spck_app_shots` khi chụp nhiều lần (`src/lib/local-files/spck-app-screenshotter.ts`, `src/lib/local-files/spck-scanner.ts`, `src/app/api/spck/scan/route.ts`):** Chỉ khóa giữ lại các file `app_*.png` thuộc bản ghi buổi học đã duyệt/đã nộp (`APPROVED`/`SUBMITTED_PENDING_VERIFY`/`VERIFIED`), tự động dọn các file `app_*.png` dư thừa sau khi chọn xong bộ ảnh, khử trùng lặp theo khe `app_XX_<tên_trang>` khi quét thư mục và giới hạn số ảnh do bot tự sinh (`_spck_app_shots`, `_spck_youtube_frames`) tối đa lấp đầy phần còn lại của 10 vị trí LMS (giữ nguyên toàn bộ ảnh của Owner và kiểm tra lỗi nghiêm ngặt nếu ảnh của Owner vượt quá 10). Đã dọn sạch và xác minh quét + chụp thành công cho lớp `VT-JSB15` Buổi 13 (`F:\MINDX_SPCK_FINAL\jsb15`).
- **Giữ lại các lớp vừa kết thúc (`Finished` trong vòng 15 ngày sau Buổi 14) khi quét LMS (`src/lib/playwright/sync-class.ts`, `src/app/api/spck/list/route.ts`, `src/app/final-project/page.tsx`, `src/lib/playwright/lms-helpers.ts`):** Bổ sung `FINISHED_CLASS_GRACE_DAYS = 15`, `resolveClassSession14DateInfo` và `isFinishedClassWithinGraceWindow` để khi sang tuần mới sau Buổi 14 (trạng thái lớp trên LMS chuyển thành `Finished`), bộ quét vẫn lấy các lớp `Finished` có ngày học Buổi 14 trong vòng $\le 15$ ngày (như `VT-JSB15` `25/10/2026`, `VT-C4K-PTA12` `23/10/2026`, `VT-ROB-ARMA13` `17/10/2026`), tự động điền ngày Buổi 14 vào `classes_sessions` và hiển thị rõ nhãn `— Đã xong Buổi 14 (dd/mm/yyyy)` trên màn hình nộp SPCK; sau 15 ngày sẽ tự động ẩn đi.
- **Kiểm định độc lập Vòng 4 (2026-10-26):** **VERDICT: GO**, đóng `R3-01` và giữ `F01`–`F04`, `R2-01`–`R2-02` ở trạng thái CLOSED. Đối chiếu 79/79 tệp ứng dụng trùng byte Vòng 3; chỉ fixture `count()` của T11 đổi theo trạng thái `modalOpen`, toàn bộ điều kiện T01–T16 giữ nguyên. Chạy mới **7/7 lệnh PASS**, gồm v270 đủ T01–T16 và v280 đủ T280-01–05; không sửa mã ứng dụng/bài thử trong vòng kiểm định. Báo cáo: `docs/audits/v280/CODEX_REVIEW_ROUND4.md`. Chưa nghiệm thu lại LMS thật.
- **Kiểm định độc lập Vòng 3 (2026-10-26):** Đóng `F01`–`F04` và `R2-01`–`R2-02`; bộ `test-lms-reliability-v280.ts` đạt đủ T280-01–05, gồm 01f/04c2/05b2, và phép thử từng tái hiện lỗi Vòng 2 nay dừng an toàn. **6/7 lệnh yêu cầu PASS; VERDICT: NO-GO** vì `test-spck-v270.ts` nguyên trạng thất bại ở T11 do fixture đếm dialog sai (**R3-01**). Bản chẩn đoán chỉ sửa fixture trong TEMP đạt T01–T16; chưa sửa bài thử của repo hoặc mã ứng dụng. Chi tiết: `docs/audits/v280/CODEX_REVIEW_ROUND3.md`.
- **Nghiệm thu đã ghi nhận trước Vòng 3:** Lớp **`VT-CSA04-HB` (Buổi 1)** từng lưu **`7/7 VERIFIED`** học viên trên MindX LMS; thông tin lịch sử này chưa được Vòng 3 xác minh lại trên dịch vụ thật.

---

## [v2.7.2] — 2026-10-25 (Sửa AI nhận xét Buổi 12/13 khi Buổi 14 đã nộp, Ưu tiên Ảnh Owner làm Thumbnail, Ảnh chụp App/Web 960×540 không lệch, Nhập Playlist YouTube cho lớp Robotics)

### 🐛 Sửa lỗi AI soạn nhận xét Buổi 12/13 bị bỏ trống & lỗi ẩn bảng học viên khi lưu nhận xét buổi học (`src/lib/gemini/spck-comment.ts`, `src/app/final-project/page.tsx`, `src/lib/playwright/save-comments.ts`)
- **Khắc phục lỗi mất bảng học viên (`số dòng khớp=0`) sau khi lưu `Summary`/`Homework` trên LMS (`VT-CSA04-HB` Buổi 1):** Trên MindX LMS, việc click lại vào ô buổi học (`#class-comments-slot-carousel-X`) khi ô đó đang `.active` sẽ làm LMS bỏ chọn buổi học (`.inactive`) và ẩn toàn bộ bảng học viên bên dưới. Đã đổi sang click tiêu đề bảng học viên (`th:has-text("student")`) để kích hoạt `ClickAwayListener` lưu `Summary`/`Homework` và kiểm tra đảm bảo slot luôn giữ trạng thái `.active` trước khi điền nhận xét từng học viên (đã đẩy thành công `7/7 VERIFIED` cho lớp `VT-CSA04-HB` Buổi 1).
- **Nguyên nhân:** Khi Buổi 14 đã `VERIFIED`, bản ghi chung `spck_uploads.status = "VERIFIED"` khiến bộ kiểm tra "sửa đồng thời" coi mọi lần soạn AI ở Buổi 12/13 là xung đột (`staleIgnored = true`) → nhận xét AI bị bỏ, nộp lỗi `Bình luận của giáo viên* không được để trống`.
- **Khắc phục:** Chỉ coi là xung đột khi trạng thái **thay đổi trong lúc AI đang chạy** (so với `initialDbStatus` / `initialSessionStatus`); bỏ nhãn nội bộ `buổi 12`, `giai đoạn 1` khỏi câu thay thế trong `sanitizeStage1ProgressClaims`.
- **Thông báo trung thực:** Banner sau khi AI soạn ghi rõ số bài soạn thành công / thiếu Quick Tags-Ghi chú / lỗi AI (không còn báo xanh giả). Quét lại thư mục không làm mất Quick Tags / Ghi chú / Nhận xét đang có trên màn hình và đánh dấu đúng `isDirty = true` khi giữ dữ liệu chưa lưu từ màn hình.
- Bổ sung kịch bản hồi quy trong `scripts/test-spck-v270.ts` (Buổi 14 `VERIFIED` → AI Buổi 12 vẫn lưu đủ nhận xét, Buổi 14 giữ nguyên `VERIFIED`).

### 🖼️ Ưu tiên Ảnh Owner làm Ảnh đại diện (Thumbnail) (`spck-scanner.ts`, `spck-app-screenshotter.ts`, `api/spck/scan`)
- Hàm mới `findOwnerProvidedRootPhotos()` nhận diện ảnh Owner để sẵn ở thư mục gốc của học viên (VD `Demo.png`, `Presentation.png`, ảnh thuyết trình) mà **code của học viên không dùng tới** (quét `.html/.css/.js/.py/.ui/.qss/.json/.ipynb`, gộp chuỗi ghép động như `"ban" + "ner"` trong Python/JS và yêu cầu dấu hiệu ảnh Owner rõ ràng khi dự án có mã gọi ảnh động), bỏ qua icon nhỏ (< 200px) và ảnh hỏng.
- Thứ tự Thumbnail mới: `_spck_owner_uploads/thumb_*` → ảnh Owner tải lên khác → ảnh Owner để sẵn → ảnh giao diện đẹp nhất (AI) → Logo MindX (tuyệt đối không lấy ảnh YouTube `_spck_youtube_frames` làm Thumbnail). Ảnh chụp giao diện chuyển xuống ô ảnh bổ sung; mọi ảnh của Owner đều được giữ trong ô ảnh bổ sung và không bao giờ bị tự bỏ (báo lỗi nếu vượt giới hạn 10 ảnh).
- Quét lại thư mục: ảnh Owner thay thế ảnh giao diện tự chụp đang làm Thumbnail (ảnh cũ được đưa xuống ô ảnh bổ sung); bổ sung kiểm tra `realpathSync` (`resolveSafeStaticFile`) trong máy chủ xem trước Web để chặn liên kết thư mục (junction/symlink) trỏ ra ngoài thư mục học viên.

### 📐 Ảnh chụp App/Web vừa khít khung xem LMS, không mất chi tiết (`spck-app-screenshotter.ts`, `spck-image-normalizer.ts`)
- **Web:** dàn trang khổ máy tính `1440×810` nhưng xuất ảnh **`960×540`** (`deviceScaleFactor = 2/3`) → không còn bị cắt chữ hai bên / thanh cuộn ngang trong hộp thoại xem ảnh của MindX LMS; ép mọi hiệu ứng `fadeIn`, `data-aos`, `animation-timeline: view()`, lớp `reveal/fade/animate` về trạng thái hiện đầy đủ, chụp với `animations: "disabled"` (hết lỗi phần đầu trang bị đen).
- **App PyQt6:** cửa sổ App được thu vừa trọn vẹn vào khung `960×540` trên nền mờ (không lẹm nút bấm); bản chụp gốc chỉ bị xóa khi không thuộc bản nháp/bản đã nộp nào.

### 🎬 Lớp Robotics: Nhập Playlist YouTube → Tự khớp học viên & lấy 2 ảnh thuyết trình (`spck-youtube-import.ts`, `POST /api/spck/import-youtube`, giao diện mục **1D**)
- Owner dán **1 link Playlist của lớp** (hỗ trợ `m.youtube.com`, `youtu.be`, `shorts`) hoặc từng dòng `Tên học viên - link`; bot đọc tiêu đề từng video, bỏ mã lớp (`SB28-Gia Bách` → `Gia Bách`) và khớp danh sách học viên (ưu tiên khớp nguyên họ tên trước khi chấm điểm gần đúng, giữ nguyên các chữ lót như `"Thế"`). Trùng tên, 2 video cùng 1 bạn, hoặc không khớp → **báo lại, không tự gắn**.
- Gắn link riêng của từng bạn vào ô YouTube URL, lấy **đúng 2 khung hình HD** học viên thuyết trình qua HTTP thuần (`i.ytimg.com/vi/<id>/maxres1|3.jpg`, dự phòng `sd/hq` và ảnh bìa video — không mở trình duyệt tới YouTube) chuẩn `960×540` vào ô ảnh bổ sung; Thumbnail = ảnh Owner tải lên/để sẵn, nếu không có thì **Logo MindX** (không lấy ảnh YouTube làm Thumbnail).
- Không cần thư mục code: tự tạo thư mục `data/spck_youtube/<Lớp>/<studentId>/`, tiêu đề mặc định `SPCK <Họ Tên>`; lưu DB nguyên tử trong transaction SQLite kèm tự động xóa ảnh mới tạo nếu phát sinh lỗi ghi và chỉ dọn ảnh cũ sau khi lưu thành công; trên giao diện giữ nguyên chữ đang gõ và chặn phản hồi đến muộn kéo lùi `draftVersion` (tránh lỗi HTTP 409 khi lưu tiếp).
- **Kiểm thử & Kiểm định Độc lập (`gpt-6.1-sol` `xhigh`):** Bộ kiểm thử `scripts/test-spck-v272.ts` (**16/16 kịch bản V01–V16 PASS**), `scripts/test-spck-v270.ts` (**16/16 T01–T16 PASS**), `scripts/test-phase6.ts` (**PASS 100%**) và đạt chứng nhận kiểm định độc lập **Codex CLI (`gpt-6.1-sol` `xhigh`) Vòng 3 — GO (đóng 10/10 phát hiện `F01`–`F10` và 3/3 điểm `R2-01`..`R2-03`)** (`docs/audits/v272/CODEX_REVIEW_ROUND3.md`).

---

## [v2.7.0] — 2026-10-24 (Cập nhật Quy trình Nộp SPCK Buổi 12–13–14 theo Giai đoạn 1 & Giai đoạn 2 của MindX, Tách Dữ liệu theo Buổi & Mở khóa cho Tất cả các Lớp)

### ✨ Tách Dữ liệu Riêng từng Buổi & Bảo toàn Lịch sử (`src/lib/db/sqlite.ts`, `src/app/api/spck/`)
- **Bảng cơ sở dữ liệu theo buổi (`spck_session_submissions`):**
  - Lưu riêng cho từng bộ **`classId + studentId + sessionNumber`** (`12 | 13 | 14`): nội dung nháp của 7 nhóm thông tin, ghi chú giáo viên, phiên bản nháp (`draftVersion`), nội dung đã duyệt (`approvedContentHash`, `approvedSnapshotJson`), kết quả lần nộp gần nhất và bản lưu lần nộp thành công gần nhất (`lastVerifiedSnapshotJson`, `lastVerifiedContentHash`, `lastVerifiedAt`, `lmsWorkId`).
  - Giữ kho tài nguyên chung trong `spck_uploads` để tái sử dụng ảnh, file và đường dẫn, kèm nút **"Dùng tài nguyên mới nhất"** để giáo viên chủ động kéo tài nguyên mới vào buổi đang chọn mà không tự động ghi đè khi chuyển buổi.
  - Sửa nháp hoặc chạy công cụ nền ở một buổi **không làm mất trạng thái `APPROVED` hoặc bằng chứng `VERIFIED` của các buổi khác**.
  - Lưu dấu **`hasLegacyUnknownSessionHistory`** độc lập với trạng thái nháp; dữ liệu cũ thiếu bản lưu nội dung hiển thị rõ `"Thiếu bản lưu nội dung cũ"` / `"Chưa xác định"` (không tự gán cho Buổi 13 và không bị biến mất khi sửa nháp hoặc nộp Buổi 14); dữ liệu lịch sử hỏng hiển thị `"Cần kiểm tra"`.
  - Khi ghép lại học viên cho thư mục khác (`save-draft`), kiểm tra `expectedVersion` trước và thực hiện nguyên tử trong transaction SQLite: tách học viên cũ (`localFolderPath = ''`), tăng `draftVersion` để chặn request cũ ghi đè nhưng bảo toàn nguyên vẹn lịch sử đã nộp (`lastVerified*`).

### ✨ Chuẩn hóa Tiêu đề & Bình luận AI theo Giai đoạn (`src/lib/local-files/spck-scanner.ts`, `src/lib/gemini/spck-comment.ts`)
- **Tự động gắn hậu tố buổi vào tiêu đề sản phẩm (Tuyệt đối không ghi `Giai đoạn 2` / `GĐ2` ở Tiêu đề):**
  - Buổi 12: `<Tên sản phẩm> — Buổi 12 (GĐ1)`
  - Buổi 13: `<Tên sản phẩm> — Buổi 13 (GĐ1)`
  - Buổi 14: `<Tên sản phẩm>` (giữ nguyên tên sạch, tuyệt đối không gắn `— Buổi 14 (GĐ2)`, `Giai đoạn 2` hay `GĐ2`)
  - Khi chuyển qua lại giữa Buổi 12 / 13 / 14, hệ thống tự động cập nhật phần hậu tố (không lặp `— Buổi ...`), kiểm tra nghiêm ngặt giới hạn $\le 100$ ký tự trên toàn chuỗi tiêu đề (chặn lưu/duyệt khi vượt 100 ký tự, tuyệt đối không tự cắt ngắn âm thầm), và hiển thị nhắc nhẹ không chặn duyệt khi đang dùng tên mặc định `SPCK <Tên học viên>`.
- **AI soạn bình luận giáo viên ghi Học bạ cho Phụ huynh xem (Không chào hỏi, giọng văn sư phạm & trang trọng, tuyệt đối không ghi `Giai đoạn 2` / `GĐ2`):**
  - Đi thẳng vào nội dung nhận xét học bạ (không chào hỏi kiểu `"Chào ba mẹ"`, `"Kính gửi gia đình"`), giọng văn sư phạm, trang trọng, khách quan; nêu rõ **sản phẩm của học viên có những gì** (đề tài, các màn hình giao diện, tính năng thực tế, kiến thức lập trình đã vận dụng) và **cần cải thiện gì** (về giao diện, tính năng hoặc tối ưu mã nguồn).
  - **Buổi 12 (Giai đoạn 1):** Nêu rõ sản phẩm hiện tại đã có những gì và phần cần cải thiện, hoàn thiện tiếp; không viết như sản phẩm đã hoàn tất cuối khóa.
  - **Buổi 13 (Giai đoạn 1):** Nêu rõ hiện trạng sản phẩm, phần đã bổ sung và phần còn cần hoàn thiện; **chỉ đối chiếu với buổi trước khi có dữ liệu thực của Buổi 12** (không tự bịa phần tiến triển).
  - **Buổi 14 (Tổng kết cuối khóa):** Đánh giá tổng kết học bạ về mức độ hoàn thành dự án, các thành phần giao diện/chức năng thực tế có trong sản phẩm và những điểm cần cải thiện, tối ưu thêm; tuyệt đối không ghi cụm từ `"Giai đoạn 2"`, `"GĐ2"` hay `"Buổi 14"` trong nội dung nhận xét; tự động lọc bỏ mọi câu suy diễn về thuyết trình hoặc làm việc nhóm khi giáo viên không cung cấp dữ kiện.
  - Tự động chuẩn hóa ảnh tài nguyên web bị đặt lệch đuôi file (`.webp`/`.jpg` lưu tên `.png` như `album-giay-trang.png`, `album1.png`, `album2.png` ở lớp `VT-JSB15`) và tự động xóa cảnh báo độ khớp tên (`95%`) ngay khi giáo viên đã xác nhận đúng học viên (`Đúng HV`).

### 🛡️ Hoàn thiện 7 Nhóm Thông tin, Đối chiếu Byte SHA-256 trên LMS & Áp dụng cho Tất cả các Lớp (`PTB`, `CSB`)
- **Chỉ bắt buộc 3 trường có dấu `*` (`Tiêu đề*`, `Ảnh thumbnail*`, `Bình luận của giáo viên*`):**
  - Các trường không có dấu `*` (`YouTube`, `Ảnh bổ sung`, `Tài liệu đính kèm`, `Đường dẫn liên quan`) chỉ kiểm tra hợp lệ khi có dữ liệu (tối đa `5 video`, `10 ảnh`, `10 file`, `5 link` — báo lỗi rõ trên toàn bộ các cổng `scan`, `save-draft`, `approve`, `capture-screenshots`, `upload-drive`, `deploy-web`, không tự động cắt bớt âm thầm) và không chặn duyệt khi để trống.
  - Hiển thị rõ nguồn ảnh bìa (`Đang dùng Logo mặc định`, `Ảnh chụp giao diện`, `Ảnh phục dựng tự động`, `Ảnh giáo viên tải lên`), ưu tiên chọn ảnh tỷ lệ gần `16:9`, phân loại nhãn đường dẫn (`Chạy thử sản phẩm`, `Mã nguồn / Tải xuống`, `Tài liệu khác`) và hỗ trợ đóng gói `.zip` an toàn cho tài liệu dự án/mô hình Robotics.
  - **Hỗ trợ chụp giao diện Website (`.html/.htm`) thực tế cho các lớp Web (`JSB`, `JSA`, `JSI`...):** Tự động khởi tạo máy chủ HTTP tĩnh cục bộ (`127.0.0.1`) + Playwright Chromium ở độ phân giải chuẩn **16:9 (`1440×810`)**, hiển thị đầy đủ các phần tử hiệu ứng cuộn (`data-aos`), tự động chụp các trang `.html` và cuộn chụp các phân đoạn trang chủ, dùng Gemini Vision chọn ảnh bìa đẹp nhất, giữ lại ảnh chụp thuyết trình Demo tại lớp trong bộ ảnh bổ sung, bảo vệ không xóa file ảnh đang được buổi khác tham chiếu và tự động cập nhật ngay vào bản nháp của buổi chưa duyệt/chưa nộp.
  - **Tăng độ ổn định khi lưu & đối chiếu nhận xét buổi học trên LMS (`src/lib/playwright/save-comments.ts`):** Bổ sung cơ chế thử lại tối đa 3 lần kèm truy vấn lại dòng học viên mới nhất sau khi bảng `.comment-list-table` cập nhật trạng thái `Auto Approved #1` (tránh nuốt thao tác click khi đóng/mở hộp thoại `[role="dialog"]`), tự động đối chiếu trực tiếp ở chế độ xem (`View Mode`) nếu nhận xét đã được lưu khớp 100% trên LMS từ lượt trước, và đảm bảo kích hoạt `ClickAwayListener` lưu thành công cả 2 mục `Summary` & `Homework`.
- **Đối chiếu mã kiểm tra byte (`SHA-256`) & Vượt lỗi tải tệp trên MindX LMS thật (`src/lib/playwright/spck-uploader.ts`):**
  - Khi cập nhật bài đã nộp trên Modal LMS, đối chiếu cả tên file và mã băm nội dung byte (`thumbnailByteSha256`, `screenshots[].byteSha256`, `attachments[].byteSha256`) với `lastVerifiedSnapshotJson`; nếu file giữ nguyên tên nhưng nội dung byte đã thay đổi, tự động gỡ file cũ trên Modal và tải lại file mới (kể cả gói `.zip` đính kèm).
  - **Tự động gom các tệp mã nguồn Web & đa tệp (`.html`, `.htm`, `.css`, `.js`, `.txt`, `.json`, `.ui`, `.qss`...) vào gói nén `.zip` (`spck_<studentId>_<hash8>.zip`):** Khắc phục triệt để lỗi `react-dropzone` trên MindX LMS từ chối ngầm tệp `.html`/`.css` khiến `page.waitForResponse` hết thời gian chờ 25 giây (`Timeout 25000ms exceeded`), đồng thời giữ nguyên cấu trúc liên kết tương đối giữa các file Web.
  - **Vượt thanh cuộn ngang nổi (`.jss140`) che nút `"Sản phẩm của học sinh"` ở dòng cuối bảng:** Tự động cuộn phần tử về giữa vùng nhìn (`block: "center"`) và kích hoạt dự phòng `HTMLElement.prototype.click()` trực tiếp trên DOM khi thanh cuộn ngang nổi `.jss140` chặn sự kiện chuột (`intercepts pointer events`).
  - **Chuẩn hóa đối chiếu `Read-after-Write` theo cấu trúc JSON thực tế của `resources.mindx.edu.vn` và `CreateStudentWork`/`UpdateStudentWork`:** Đọc đầy đủ trường `resJson.link` (`/uploads/...`) từ máy chủ tài nguyên và kiểm tra đồng thời `latestData.attachmentUrls` / `latestData.attachments` cùng `latestData.imageUrl` / `latestData.screenshots`. Đã nghiệm thu nộp thực tế thành công **6/6 học viên (`VERIFIED`)** của lớp `VT-JSB15` (Buổi 14).
- **Mở khóa nộp SPCK cho tất cả các lớp (bao gồm `PTB` và `CSB`):**
  - Gỡ bỏ hoàn toàn quy tắc miễn SPCK cho `PTB` và `CSB`. Với các công cụ phụ (Google Drive, Bảng chấm điểm Demo), kiểm tra cấu hình độc lập theo từng khóa học (không lấy nhầm thư mục/mẫu của `PTA` và không chặn luồng nộp SPCK lên LMS khi công cụ phụ chưa cấu hình).

### 🧪 Kiểm thử & Kiểm định Độc lập (`scripts/test-spck-v270.ts`)
- Xây dựng bộ kiểm thử tự động `scripts/test-spck-v270.ts` bao phủ **16 kịch bản bắt buộc (`T01`–`T16`)** và các ca kiểm tra hồi quy sâu (`F01`–`F09`); đạt kiểm thử giả lập cục bộ trên `npx tsc --noEmit --incremental false`, `npx tsx scripts/test-spck-v270.ts`, `npx tsx scripts/test-phase5.ts`, `npx tsx scripts/test-phase6.ts`, `npx tsx scripts/test-phase7.ts` và đạt **GO (đóng 9/9 phát hiện `F01`–`F09`)** qua Vòng 4 kiểm định độc lập bằng Codex CLI (`gpt-6.1-sol` `xhigh`, phiên `01a16d96-5b27-7063-9429-d17ca0ed9074`).
- **Giới hạn phạm vi kiểm thử:** Toàn bộ kiểm thử của `v2.7.0` được thực hiện bằng dữ liệu giả cục bộ (không gọi mạng thật); **chưa nghiệm thu trên trình duyệt thật, MindX LMS thật, Gemini thật, Google Drive thật hay GitHub Pages thật** (chờ Owner duyệt mẫu thử cụ thể trước khi thực hiện).

---

## [v2.6.0] — 2026-10-24 (Tinh gọn Quy trình Nộp SPCK Buổi 12 / 13 / 14 thành 3 Bước Rõ ràng & Theo dõi Kết quả Riêng từng Buổi)

### ✨ Tinh gọn Luồng Nghiệp vụ & Giao diện (`src/app/final-project/page.tsx`)
- **Tổ chức màn hình SPCK (`/final-project`) thành 3 bước rõ ràng:**
  1. **Bước 1 (Chọn lớp $\rightarrow$ Chọn buổi 12/13/14 $\rightarrow$ Chọn thư mục & kiểm tra học viên):** Chọn buổi nộp SPCK (`Buổi 12`, `Buổi 13` hoặc `Buổi 14`) **một lần ở đầu trang** (không tự động nộp cả 3 buổi, không âm thầm chuyển sang Buổi 13 khi lựa chọn không hợp lệ).
  2. **Bước 2 (Chuẩn bị, xem lại bài & công cụ hỗ trợ theo ngữ cảnh):**
     - Mặc định hiển thị **Bảng tóm tắt gọn** gồm: Ô chọn học viên, Họ tên học viên & xác nhận khớp thư mục, Ảnh bìa & đường dẫn tái sử dụng (Google Drive / Web Live / YouTube), Tình trạng đủ/thiếu điều kiện nộp, **3 cột kết quả riêng cho Buổi 12 / Buổi 13 / Buổi 14**, nút nộp lẻ cho buổi đang chọn và nút **"Chi tiết"** để mở/đóng khung chỉnh sửa đầy đủ khi cần.
     - Đưa cấu hình Google Drive, Cổng Thu Bài Học Sinh Trực Tuyến và các công cụ phụ vào mục thu gọn; chỉ hiển thị công cụ **Đẩy Web chạy thử GitHub Pages** khi khóa học/thư mục có tài nguyên Web (`.html/.css/.js`) và công cụ **Chụp giao diện App** khi khóa học/thư mục có giao diện ứng dụng (`.ui/.py`).
     - Đưa chức năng tạo Google Sheet chấm điểm vào mục **"Chuẩn bị Demo"**, vẫn cho phép tạo trước Buổi 14.
  3. **Bước 3 (Nộp các bài đã chọn & Xem kết quả đầy đủ):**
     - Thay thế 3 nút nộp cả lớp và 3 nút nộp ở từng học viên bằng **1 nút chính ghi rõ số bài và buổi đang chọn** (ví dụ: **`"Nộp 8 bài — Buổi 13"`**), kèm nút nộp riêng từng học viên và nút **"Thử lại bài chưa nộp"** cho các bài lỗi/bị bỏ qua.
     - Trong lúc đang chuẩn bị hoặc nộp bài, khóa các thao tác xung đột (đổi lớp, đổi buổi, quét lại thư mục, chạy công cụ phụ) và hiển thị rõ đang xử lý buổi nào, bao nhiêu bài.

### 🛡️ Theo dõi Riêng từng Buổi, Báo đủ Kết quả & Sửa lỗi Khai báo Tác vụ (`src/lib/db/sqlite.ts`, `src/lib/playwright/spck-uploader.ts`, `src/app/api/spck/upload-lms/route.ts`, `src/lib/queue/task-queue.ts`, `src/lib/playwright/spck-demo-sheet.ts`)
- **Theo dõi kết quả riêng cho Buổi 12, 13, 14 (`spck_uploads.sessionResultsJson`):**
  - Lưu kết quả nộp theo từng buổi (`12`, `13`, `14`) gồm trạng thái (`VERIFIED` / `FAILED`), mã băm phiên bản nội dung đã nộp (`submittedContentHash`), thời điểm nộp (`verifiedAt`) và mã băm lần xác nhận thành công gần nhất (`lastVerifiedContentHash`, `lastVerifiedAt`).
  - Khi giáo viên chỉnh sửa bản nháp để chuẩn bị cho buổi tiếp theo, kết quả đã nộp của các buổi trước **được giữ nguyên 100%**, đồng thời hiển thị phân biệt rõ **`"Đã nộp ✓ (Bản nháp đã đổi)"`** với **`"Đã nộp ✓"`** (bản hiện tại khớp với bản đã nộp).
  - Các bản ghi dữ liệu cũ chỉ có trạng thái chung (`status = 'VERIFIED'` nhưng chưa có lịch sử từng buổi trong `sessionResultsJson`) được hiển thị rõ là **`"Chưa xác định"`**, tuyệt đối không tự đoán là Buổi 13.
- **Khắc phục triệt để lỗi thông báo xanh che khuất bài bị bỏ qua:**
  - Tổng hợp kết quả theo **toàn bộ danh sách học viên đã chọn** (`totalSelected`), báo rõ số bài thành công trên tổng số bài đã chọn (ví dụ: chọn 2 học viên, 1 bài hợp lệ được nộp và 1 bài chưa đủ điều kiện bị bỏ qua sẽ báo cảnh báo vàng **`"Đã nộp 1/2 bài (Buổi 13) — 1 bài chưa nộp"`** kèm danh sách chi tiết từng học viên Thành công / Lỗi / Bỏ qua và lý do cụ thể).
- **Kiểm tra nghiêm ngặt `sessionNumber` & Sửa lỗi khai báo tác vụ xóa/reset SPCK (`clearSessionSpck`):**
  - `POST /api/spck/upload-lms`, `SpckUploader.uploadApprovedSpck` và `SpckUploader.clearSessionSpck` bắt buộc kiểm tra `sessionNumber` thuộc `{12, 13, 14}` (trả HTTP `400` / báo lỗi ngay nếu thiếu hoặc sai, không tự chuyển về `13`).
  - Bổ sung `"CLEAR_SPCK"` và `"SPCK_DEMO_SHEET"` vào `TaskJobType` (`src/lib/queue/task-queue.ts`), sửa `SpckUploader.clearSessionSpck` truyền đúng `jobType: "CLEAR_SPCK"`, `sessionId: "SESSION_" + targetSessionNumber`, hỗ trợ lọc theo `studentIds`, kiểm tra khớp chính xác mã lớp trên `FindClass`, kiểm tra `Array.isArray` cho dữ liệu GraphQL `FindWorks`/`VerifyWorks`, kiểm tra nghiêm ngặt định danh buổi học (`classSessionNumber` phải là số nguyên dương hợp lệ hoặc có `classSessionId` khớp `effectiveSessionId` không xung đột) và chỉ xóa trạng thái của đúng buổi được chọn trong `sessionResultsJson` sau khi xác minh xóa thành công trên LMS (không gọi chức năng xóa/reset trên dữ liệu LMS thật).

### 🧪 Kiểm thử (Phân biệt rõ Kiểm thử Giả lập Cục bộ & Xác nhận trên LMS Thật)
- **Đã kiểm thử giả lập cục bộ (Synthetic & Local Verification — ĐẠT 100%):**
  - `npx tsc --noEmit --incremental false`: **0 lỗi TypeScript**.
  - `npx tsx scripts/test-phase6.ts`: **PASS 100% (5/5 nhóm)**, bao gồm nhóm `[5/5]` kiểm chứng đủ 6 điều kiện hoàn thành của quy trình 3 bước Buổi 12/13/14 trên SQLite và DOM giả lập.
  - Hồi quy độc lập trong thư mục `TEMP` cô lập: `docs/audits/round-32/verify-phase6.mjs` (**67/67 PASS**), `docs/audits/round-38/adversarial.mjs` (**41/41 PASS**), `scripts/test-phase5.ts` (**PASS 100%**), `scripts/test-phase7.ts` (**PASS 100%**).
- **Chưa thực hiện trên LMS thật / Google Drive thật / GitHub Pages thật:** Theo đúng giới hạn an toàn của Owner, phiên bản `v2.6.0` chỉ kiểm thử bằng dữ liệu giả cục bộ, chưa bấm nộp/xóa/thay đổi bài thật trên MindX LMS, chưa tải lên Google Drive thật hay xuất bản Web thật.

---

## [v2.5.0] — 2026-10-23 (Cổng Thu Bài Học Sinh Trực Tuyến: Học Sinh Tự Nộp Sản Phẩm $\rightarrow$ Tự Lưu Máy Thầy & Tự Động Up Lên Google Drive)

### ✨ Tính năng mới (Added)
- **Cổng Web Cho Học Sinh Tự Nộp Sản Phẩm Cuối Khóa (`src/lib/student-portal/student-portal-server.ts`, `src/app/api/spck/student-portal/route.ts`, `src/app/final-project/page.tsx`):**
  - Bổ sung nút **"Mở Link Cho Học Sinh Nộp Bài"** ngay trên Màn hình 3 (`/final-project`) để giáo viên tạo đường dẫn nộp bài trực tuyến (hỗ trợ cả **Link Internet Toàn Cầu qua Cloudflare Quick Tunnel `https://*.trycloudflare.com/s/<token>`**, **Link Wi-Fi nội bộ phòng học `http://<LAN_IP>:3088/s/<token>`** và **Mã QR**).
  - Giao diện trang nộp bài dành riêng cho học sinh (cô lập hoàn toàn với hệ thống quản trị `127.0.0.1:3000` của giáo viên):
    1. Học sinh chọn đúng **Họ và Tên** của mình từ danh sách học viên thực tế của lớp.
    2. Đặt **Tên Sản Phẩm / Dự Án**, dán **Link Video YouTube** hoặc **Link Slide / Canva** (nếu có).
    3. Hỗ trợ chọn **Cả Thư Mục Dự Án** (giữ nguyên cấu trúc thư mục con `gui/`, `img/`, `assets/`... và tự lọc bỏ thư mục rác `node_modules`, `__pycache__`, `.git`) hoặc chọn **File lẻ** (`.zip`, `.sb3`, `.yyz`, `.py`, `.pptx`, hình ảnh...).
  - **Tự động hóa khép kín ngay khi học sinh bấm Nộp:**
    1. Lưu toàn bộ file dự án vào đúng thư mục `<Thư-mục-SPCK-Lớp>/<Họ-Tên-Học-Sinh>/` trên ổ cứng máy tính của giáo viên (chống thoát thư mục và kiểm tra Path Allowlist nghiêm ngặt).
    2. Tự động quét phân loại tài nguyên, gắn ảnh Logo MindX mặc định nếu chưa có ảnh riêng, và khóa cứng `studentId` (`matchScore = 1.0`, `isConfirmedByTeacher = 1`) vào bảng `spck_uploads` trong SQLite.
    3. Tự động kích hoạt đẩy sản phẩm của học sinh đó lên **Google Drive (`CODING - SPCK -> Khóa học -> Mã Lớp -> Họ Tên Học Sinh`)** qua hàng đợi `TaskQueue`, tự động dán `Link Google Drive SPCK` vào ô `Đường dẫn liên quan` và hiển thị nút mở thư mục Google Drive trực tiếp trên màn hình của học sinh lẫn màn hình theo dõi thời gian thực của giáo viên.

---

## [v2.4.0] — 2026-10-23 (Tự động Chụp Giao diện App SPCK & AI Chọn Thumbnail Đẹp Nhất + Tạo Google Sheet Bảng Chấm Điểm Demo cho từng Lớp)

### ✨ Tính năng mới (Added)
- **Tự động mở App chụp hình giao diện, Khôi phục Ảnh bị thiếu 4 tầng & AI chọn hình đẹp nhất làm Thumbnail (`src/lib/local-files/spck-app-screenshotter.ts`, `src/app/api/spck/capture-screenshots/route.ts`):**
  - Tự động mở ngầm các màn hình giao diện ứng dụng của học viên (`.ui` PyQt6 với thuộc tính `WA_DontShowOnScreen = True` không làm bật cửa sổ làm phiền giáo viên), chụp hình sắc nét từng màn hình vào `<studentFolder>/_spck_app_shots/app_<NN>_<screenName>_<hash6>.png`.
  - **Cơ chế Khôi phục Ảnh bị thiếu 4 tầng (4-Layer Missing-Image Recovery):** Khắc phục triệt để lỗi học viên chèn ảnh trực tiếp từ `C:\Users\...\Downloads\...` trên máy cá nhân nhưng quên copy thư mục ảnh khi nộp bài (khiến màn hình bị các ô vuông trắng trống trơn):
    1. *Tầng 1 (Nội bộ thư mục học viên):* Tự tìm ảnh theo đường dẫn tương đối, tên file hoặc tên gốc bất kể lệch thư mục (`../img/` vs `./img/`) hay lệch đuôi file (`.jpg` $\leftrightarrow$ `.png` $\leftrightarrow$ `.webp`).
    2. *Tầng 2 (Đối chiếu khung giao diện cùng lớp — Sibling UI Widget Recovery):* Nếu file `.ui` của học viên bị thiếu ảnh nhưng có học viên cùng lớp dùng chung khung giao diện (cùng tên file `.ui`, tên widget và kích thước tương ứng, ví dụ `SPCK Hà Nhật Minh` và `10 - Nguyễn Phúc Kiên`), tự động khôi phục đúng bộ ảnh món ăn/icon từ bài cùng lớp.
    3. *Tầng 3 (Tra cứu theo tên file đặc trưng):* Tự tìm trong thư mục `Downloads` hoặc thư mục lớp với các tên file đặc trưng (`house-solid-full.svg`, `cat_mascot.jpg`...).
    4. *Tầng 4 (Tự động vẽ bù Icon & Phông nền minh họa bằng `QtGui.QPainter`):* Nếu ảnh hoàn toàn không tồn tại trên máy (như `History.jpg` hay bản đồ thế giới trong bài của `Gia An`), tự động vẽ bù icon vector hoặc phông nền Gradient/Bản đồ thế giới tương ứng với ngữ cảnh màn hình để không bao giờ xuất hiện ô vuông trắng.
  - Sử dụng **Gemini Vision (`gemini-3.5-flash-lite`)** quan sát trực tiếp các hình chụp giao diện (ưu tiên màn hình chính/chức năng, loại trừ màn hình đăng nhập/đăng ký đơn giản) để chọn ra **1 hình chụp giao diện App đẹp nhất** đặt làm **`Ảnh thumbnail *` (ô trên)**, đồng thời hỗ trợ nút **`+ Owner Up Thumbnail`** / **`+ Owner Up Ô Dưới`** để Owner chủ động tải thêm ảnh của riêng mình.
  - Tự động đưa toàn bộ các hình chụp giao diện App còn lại (không lặp lại hình đã làm Thumbnail ở ô trên, tối đa 10 hình) vào **`Tải hình ảnh lên` (`screenshotsJson` — ô dưới)**, và tự động xóa từng ảnh cũ/trùng lặp theo từng nhịp render React khi cập nhật lại trên MindX LMS.
- **Tự động tạo Google Sheet Bảng chấm điểm buổi Demo theo từng lớp & Ngoại lệ miễn SPCK cho `PTB` / `CSB` (`src/lib/playwright/spck-demo-sheet.ts`, `src/app/api/spck/create-demo-sheet/route.ts`, `data/config/demo-sheet-templates/*.xlsx`):**
  - Tự động nhận diện tên bảng chấm điểm theo mã khóa học của lớp (ví dụ lớp `VT-C4K-PTA12` $\rightarrow$ **`Bảng chấm điểm buổi Demo App Producer - Advanced`**).
  - Hỗ trợ dán Link Google Sheet mẫu tùy chỉnh hoặc sử dụng trực tiếp mẫu chuẩn MindX (`data/config/default-demo-sheet-template.xlsx`) với đầy đủ định dạng màu đỏ thương hiệu MindX, phông chữ `Exo`, công thức tính điểm tự động (`IF(D8="Chưa đạt", 0, IF(D8="Hoàn thành", C8/2, C8))`, `ROUND(F8,3) & " / 5"`), danh sách chọn (`Chưa đạt, Hoàn thành, Tốt`), phần nhận xét `BGK1`/`BGK2` và tab `Phân bổ điểm` (`LOs`).
  - Tự động tạo đủ $N$ tab ứng với $N$ học viên của lớp (ví dụ `VT-C4K-PTA12` gồm 10 tab cho 10 học viên), tự động điền `Họ và tên Học viên:` vào từng tab, lấy **Ngày Demo là ngày học của Buổi 14** (tự động nội suy `+7 ngày` nếu lịch Buổi 14 trên LMS chưa điền ngày) và `Ngày đánh giá` (`+7 ngày`).
  - Tự động lưu file `.xlsx` vào thư mục SPCK của lớp trên máy tính (VD: `F:\MINDX_SPCK_FINAL\PTA12\Bảng chấm điểm buổi Demo App Producer - Advanced.xlsx`) đồng thời tải thẳng lên thư mục Google Drive của lớp (`CODING - SPCK -> PTA -> VT-C4K-PTA12`), trả về đường dẫn chia sẻ `https://docs.google.com/spreadsheets/d/<fileId>/edit?usp=sharing` kèm nút **Mở Google Sheet** và **Copy Link Cho Giám Khảo** ngay trên Màn hình 3 (`/final-project`).

---

## [v2.3.1] — 2026-10-22 (Kiểm định Độc lập bằng Codex CLI `gpt-6.1-sol` `xhigh` & Gia cố Toàn diện Bảo mật / Toàn vẹn Dữ liệu)

### 🛡️ Gia cố Bảo mật, Toàn vẹn Dữ liệu & Xác minh sau lưu (Fixed & Hardened)
- **Gia cố Bộ triển khai Web GitHub Pages (`src/lib/github/spck-web-deployer.ts`, `src/app/api/spck/deploy-web/route.ts`):**
  - Chặn tuyệt đối lỗi thoát thư mục đích (`assertInsideDirectory`) và kiểm tra định dạng mã lớp hợp lệ (`/^[A-Z0-9_-]{2,80}$/`).
  - Chỉ sao chép danh sách định dạng tài nguyên Web tĩnh an toàn (`ALLOWED_WEB_ASSET_EXTENSIONS`) và chặn mọi tệp nhạy cảm (`credentials.json`, `.env`, khóa riêng, token...).
  - Giữ nguyên cấu trúc cây thư mục gốc khi HTML nằm trong thư mục con (tạo trang chuyển hướng `index.html` ở gốc để không làm gãy đường dẫn tương đối `../assets/...`) và tự động chuẩn hóa tên `INDEX.HTML` về chữ thường `index.html` cho GitHub Pages.
  - Sao chép qua thư mục đệm (`staging`) trước khi cập nhật kho Git, chỉ `git add` các đường dẫn thành công, yêu cầu giáo viên xác nhận ghép thư mục trước khi xuất bản và tự động phân biệt tên thư mục khi lớp có học viên trùng tên.
- **Gia cố Bộ tải Google Drive SPCK (`src/lib/playwright/spck-drive-uploader.ts`):**
  - Xác minh chặt chẽ tất cả tệp đã xuất hiện trong DOM thư mục Google Drive trước khi báo thành công; tự động thay thế tệp cùng tên khi nội dung trên máy thay đổi.
  - Bổ sung ánh xạ khóa học `PSI` song song với `PTI`, chặn việc tạo nhầm thư mục lớp ở thư mục gốc khi không nhận diện được mã khóa học, nâng độ sâu đệ quy thư mục con lên 5 cấp và loại bỏ việc tự xóa các tệp `SPCK_*.zip` theo tên.
  - Hợp nhất `relatedLinksJson` từ bản ghi SQLite mới nhất ngay trước khi lưu để không làm mất link GitHub Pages được gắn song song, và hạ trạng thái về `WAITING_APPROVAL` khi danh sách link thay đổi (tuân thủ nghiêm ngặt Quy tắc 4).
- **Gia cố AI Nhận xét SPCK, Path Allowlist & Nộp SPCK LMS (`src/lib/gemini/spck-comment.ts`, `src/lib/security/path-allowlist.ts`, `src/lib/playwright/spck-uploader.ts`, `src/lib/playwright/save-comments.ts`, `src/app/api/spck/scan/route.ts`):**
  - Ẩn danh triệt để tên học viên viết liền hoặc nối bằng dấu gạch dưới/gạch ngang trong tên file (`Nguyen_Minh_An.py` $\rightarrow$ `STUDENT_01.py`), thay tên tệp đính kèm bằng nhãn `FILE_01`, và kiểm tra bắt buộc cấu trúc/độ dài phản hồi JSON từ Gemini trước khi lưu.
  - Giải quyết đường dẫn thực tế (`fs.realpathSync`) trước khi kiểm tra danh sách thư mục hệ thống bị cấm trong `path-allowlist.ts`.
  - Sửa triệt để selector điền `Đường dẫn liên quan (Link)` trên Modal SPCK của MindX LMS (`input#inputRelativeUrlName` và `input#inputRelativeUrl`, tách biệt hoàn toàn với `input#inputYoutube` ở phía trên), bổ sung kiểm tra `Read-after-Write` bắt buộc thẻ `<a href="...">` xuất hiện trong danh sách `#1:` trước khi bấm `Save`, và giữ nguyên danh sách link Google Drive / GitHub Pages đã gắn trong `relatedLinksJson` khi giáo viên bấm quét lại thư mục SPCK.
  - Gắn mã băm phiên bản ngắn theo tập tệp đính kèm vào gói `.zip` phụ trợ (`spck_<studentId>_<filesHash8>.zip`), kiểm tra lệnh Dừng khẩn cấp (`Stop Bot`) ngay trước mọi thao tác ghi/lưu, và xác minh phản hồi `UpdateSlotComment` + DOM khi lưu `Summary`/`Homework`.
  - Tinh gọn giao diện và luồng điều khiển trên thanh điều hướng trên cùng (`src/app/layout.tsx`) và Màn hình 3 (`src/app/final-project/page.tsx`): gỡ bỏ nhãn `127.0.0.1:3000`, khối tiêu đề giới thiệu đầu trang SPCK, nút `Duyệt Khóa Hash` rời, cụm chọn `Buổi nộp SPCK: Buổi 12/13/14` trùng lặp và nút `Nộp Thử 1 HV`; hợp nhất luồng tự động duyệt khóa & đẩy thẳng lên LMS ngay khi bấm `Nộp SPCK Buổi 12 / 13 / 14` (hoặc `Nộp B.12 / B.13 / B.14`).

---

## [v2.3.0] — 2026-10-22 (Tự động Up Sản Phẩm lên Google Drive theo từng Học viên & Nâng cấp AI Nhận xét SPCK Tự nhiên)

### ✨ Tính năng mới (Added)
- **Tự động tải Sản phẩm Cuối khóa (SPCK) lên Google Drive & Gắn Link vào SPCK (`src/lib/playwright/spck-drive-uploader.ts`, `src/app/api/spck/upload-drive/route.ts`):**
  - Tích hợp sẵn đường dẫn thư mục Google Drive gốc `CODING - SPCK` (`https://drive.google.com/drive/folders/1Xl8OZ7i1bOKf7000xbUBYLPcxVb2qvRD`) và tự động nhận diện thư mục khóa học tương ứng từ mã lớp (`SB`, `SA`, `SI`, `GB`, `GA`, `GI`, `PTB`, `PTA`, `PTI`, `JSB`, `JSA`, `JSI`, `CSB`, `CSA`, `CSI`).
  - Tự động kiểm tra/tạo thư mục Lớp học (VD: `VT-C4K-PTA12`) $\rightarrow$ tạo thư mục riêng cho từng học viên (theo họ tên học viên) $\rightarrow$ tải toàn bộ file và **tự động tái tạo nguyên vẹn các thư mục con** (`gui/`, `img/`, `image/`, `src/`... không tạo file `.zip` thừa) lên Google Drive.
  - Tự động lấy đường dẫn thư mục Google Drive của từng học viên (`https://drive.google.com/drive/folders/<folderId>`) và điền thẳng vào ô **`Đường dẫn liên quan (Link)`** (`Link Google Drive SPCK (<Tên Học Viên>) | https://drive.google.com/...`) trong SQLite và trên giao diện `/final-project`. Khi giáo viên bấm Nộp SPCK lên LMS, bot tự động dán link Drive này và bấm `+ Thêm`.
- **Nâng cấp AI Soạn Bình luận Giáo viên cho SPCK mượt mà, tự nhiên như người thật (`src/lib/gemini/spck-comment.ts`, `src/lib/gemini/client.ts`):**
  - Sử dụng Gemini API (`temperature = 0.85`) kết hợp **8 cấu trúc hành văn khác nhau** để mỗi học viên trong lớp có một đoạn nhận xét liền mạch, tự nhiên, xưng hô **"thầy – con"** đồng nhất (loại bỏ các tiêu đề gạch đầu dòng cứng nhắc `• Thái độ...`, không lặp lại câu chữ của Quick Tags và không trùng cấu trúc mở đầu giữa các học viên).
  - Tự động lồng ghép tự nhiên chủ đề dự án và các màn hình/tính năng thực tế trích xuất từ code của từng bạn (ví dụ: ứng dụng đặt món ăn, ứng dụng thể thao các cự ly chạy, ứng dụng tin tức bóng đá, ứng dụng chăm sóc thú cưng, ứng dụng khám phá Hệ Mặt Trời...).
- **Tự động Đẩy Sản phẩm Web (`.html/.css/.js`) lên GitHub Pages & Gắn Link Chạy Thử (`src/lib/github/spck-web-deployer.ts`, `src/app/api/spck/deploy-web/route.ts`):**
  - Tạo sẵn kho GitHub công khai dùng chung `https://github.com/Banhtalon/WEB_PRODUCT_SHOW.git` và kích hoạt tự động **GitHub Pages** tại `https://banhtalon.github.io/WEB_PRODUCT_SHOW/`.
  - Tự động sao chép thư mục Web của từng học viên theo phân cấp `<Mã-Lớp>/<Tên-Học-Viên>/` (tự động bổ sung `index.html` nếu học viên đặt tên file chính khác `index.html`), đẩy lên nhánh `main` và gắn đường dẫn `Link Web Chạy Thử (<Tên Học Viên>) | https://banhtalon.github.io/WEB_PRODUCT_SHOW/<Mã-Lớp>/<Tên-Học-Viên>/` vào ô **`Đường dẫn liên quan`** song song với Link Google Drive.
- **Giao diện Điều khiển Google Drive & GitHub Pages trên Màn hình 3 (`/final-project`):**
  - Bổ sung thanh nhập Link Google Drive gốc kèm nút **"Up Sản Phẩm Cả Lớp lên Drive & Gắn Link"**, thanh nhập Kho GitHub Pages kèm nút **"Đẩy Web Cả Lớp lên GitHub Pages & Gắn Link"**, và các nút thao tác lẻ (**"Up Drive & Gắn Link"**, **"Up Web Live"**) trên thẻ của từng học viên.
  - Cấu hình `ignoreDefaultArgs: ["--enable-automation"]` trong `browser-manager.ts` để trình duyệt Persistent Chromium (`./playwright-auth`) đăng nhập Google (`accounts.google.com`) mượt mà không bị Google chặn cảnh báo tự động hóa.

---

## [v2.2.0] — 2026-10-22 (Hoàn thiện Nộp SPCK Thực tế trên LMS & Quản lý Tài liệu Dự án)

### ✨ Tính năng mới (Added)
- **Nộp Sản phẩm Cuối khóa (SPCK) theo Buổi 12 / Buổi 13 / Buổi 14:**
  - Bổ sung bộ nút chọn buổi nộp SPCK tương ứng (**Buổi 12**, **Buổi 13**, **Buổi 14**) cho cả lớp (`Đẩy N bài Đã Duyệt lên LMS (Buổi X)`) hoặc từng học viên trên màn hình `/final-project` ([page.tsx](./src/app/final-project/page.tsx)).
  - Hỗ trợ truyền `sessionNumber` (`12 | 13 | 14`) qua API `POST /api/spck/upload-lms` ([route.ts](./src/app/api/spck/upload-lms/route.ts)) để bot tự động chuyển đúng ô buổi học trên thanh trượt `#class-comments-slot-carousel-{N-1}` của LMS.
- **Tự động lọc lớp đủ điều kiện nộp SPCK (Buổi học $\ge 12$):**
  - Tự động quét theo tài khoản giáo viên và chỉ hiển thị những lớp có số buổi hiện tại $\ge 12$ trong danh sách lớp SPCK (`GET /api/spck/list`), kèm nhãn tiến độ buổi học hiện tại (VD: `VT-C4K-PTA12 (Buổi 12/14)`).
- **Trình duyệt chọn thư mục SPCK trực tiếp trên giao diện Web (In-Page Folder Browser):**
  - Bổ sung hộp chọn thư mục trực quan ngay trên trình duyệt (`GET /api/system/pick-folder?mode=list`) bên cạnh hộp thoại Windows gốc, giúp giáo viên duyệt ổ đĩa (`C:\`, `D:\`, `F:\`...) và chọn thư mục SPCK ngay cả khi cửa sổ hệ điều hành bị ẩn.
  - Tự động cấp quyền an toàn (`registerTeacherSelectedDirectory`) vào danh sách thư mục cho phép (`data/config/teacher_browsed_dirs.json`).
- **Tài liệu Tổng quan & Lịch sử Phiên bản cho AI:**
  - Khởi tạo [PROJECT_STATE.md](./PROJECT_STATE.md) làm bản đồ tổng quan nhanh 1 trang cho AI Agent và [CHANGELOG.md](./CHANGELOG.md) để theo dõi lịch sử phiên bản.

### 🛠️ Sửa lỗi & Tối ưu Thực tế trên MindX LMS (Fixed & Changed)
- **Khắc phục triệt để lỗi tải ảnh/file SPCK lên `resources.mindx.edu.vn` (`ERR_CERT_AUTHORITY_INVALID`):**
  - Cập nhật [browser-manager.ts](./src/lib/playwright/browser-manager.ts) tách riêng phân giải DNS của máy chủ tải tài nguyên `resources.mindx.edu.vn` (`45.117.83.246`) khỏi máy chủ LMS chính (`103.109.43.92`) trong `--host-resolver-rules`, đồng thời tự động nâng cấp phiên `BrowserContext` khi đổi cấu hình mạng.
- **Tự động gắn Ảnh Logo MindX làm Ảnh bìa (Thumbnail) khi thư mục học sinh không có ảnh:**
  - Lưu ảnh **Logo MindX (`mindX Tech & AI School`)** tại [default-spck-thumbnail.png](./data/config/default-spck-thumbnail.png) và áp dụng nguyên tắc bắt buộc: nếu thư mục dự án của học sinh không có ảnh riêng, hệ thống tự động lấy ảnh Logo MindX làm Thumbnail mặc định ngay từ bước quét thư mục ([spck-scanner.ts](./src/lib/local-files/spck-scanner.ts)) và khi đẩy lên LMS ([spck-uploader.ts](./src/lib/playwright/spck-uploader.ts)).
  - Mở rộng [spck-scanner.ts](./src/lib/local-files/spck-scanner.ts) quét thêm 1 cấp thư mục con an toàn (`img/`, `image/`, `assets/`...) để tự động nhận diện ảnh chụp sản phẩm của từng dự án khi học sinh để ảnh trong thư mục con.
- **Xử lý thông minh Modal SPCK thực tế trên LMS ([spck-uploader.ts](./src/lib/playwright/spck-uploader.ts)):**
  - Tự động đóng gói các file giao diện phụ không nằm trong danh sách `accept` trực tiếp của LMS (như `.ui`, `.qss`) thành gói `.zip` để đính kèm hợp lệ.
  - Chờ xác nhận HTTP `200/201` từ `https://resources.mindx.edu.vn/api/v1/resources` cho từng ảnh/file trước khi bấm `Save`.
  - Bắt chính xác GraphQL mutation `CreateStudentWork` / `UpdateStudentWork` trên `https://lms-api.mindx.edu.vn/` và tự động mở rộng nút `Xem chi tiết trang` khi cập nhật lại thẻ `Sản Phẩm Học Viên 01` đã lưu trước đó.

---

## [v2.1.0] — 2026-10-22 (Tự động điền Summary/Homework LMS, Chuẩn hóa Zalo 2 Phần & Shortcut Desktop)

### ✨ Tính năng mới (Added)
- **Tự động điền `Summary` (Tóm tắt bài học) & `Homework` (BTVN) lên MindX LMS:**
  - Khi bấm **Đẩy nhận xét lên LMS** trên màn hình `/session-comments`, bot ([save-comments.ts](./src/lib/playwright/save-comments.ts)) tự động mở 2 hộp thu gọn `Summary` và `Homework` của buổi học trên LMS, điền **Tiêu đề + Nội dung bài học** vào `Summary` và **Tóm tắt BTVN** vào `Homework`, sau đó kích hoạt lưu tự động (`UpdateSlotComment`) cùng với nhận xét của toàn bộ học viên.
- **Chuẩn hóa Kỹ năng AI Thông báo Zalo Tổng kết Buổi học & Nhận xét BTVN ([SKILL.md](./.agents/skills/nhan-xet-hoc-sinh-zalo/SKILL.md)):**
  - **Phần 1 (Tổng kết buổi học):** Đúng 6 mục ngắn gọn, súc tích (mỗi gạch đầu dòng 1 câu), tự động tịnh tiến `+7 ngày` cho buổi học kế tiếp và tra cứu tên bài `BUỔI N+1` từ kho Giáo trình (`WEB.md`, `Game_maker.md`, `Scratch.md`, `Python.md`).
  - **Phần 2 (Nhận xét tình trạng làm BTVN):** Chỉ xuất khi giáo viên tải lên ảnh chụp danh sách nộp bài (Denise/LMS), tự động đọc ảnh bằng Gemini Vision để lọc học sinh `Not submitted` với tên rút gọn (**Tên đệm + Tên**).
- **Chuẩn hóa Kỹ năng AI Nhận xét Học sinh 5 Cấp độ ([SKILL.md](./.agents/skills/nhan-xet-hoc-sinh/SKILL.md)):**
  - Phân loại học sinh theo 5 cấp độ dựa trên Quick Tags và hiển thị gộp trong 1 ô nhận xét duy nhất với 3 gạch đầu dòng in đậm (`- **Điểm mạnh của học viên:**`, `- **Điểm cần cải thiện:**`, `- **Lời khuyên:**`), tự động chuyển đổi sang thẻ `<strong>` trên Quill Editor của LMS.
- **Tạo Shortcut khởi động nhanh ngoài Desktop:**
  - Tạo shortcut `MindX Automation Bot.lnk` ngoài màn hình Desktop với biểu tượng riêng (`mindx-bot.ico`) để giáo viên mở nhanh bằng 1 cú click đúp.

### 🛠️ Sửa lỗi (Fixed)
- **Sửa lỗi đứt kết nối đồng bộ LMS khi bật Cloudflare WARP (`1.1.1.1`):**
  - Tự động truy vấn IP `lms.mindx.edu.vn` từ nameserver gốc Viettel IDC (`115.84.177.33`) và giữ Singleton `BrowserManager` qua `globalThis` khi Next.js HMR reload.

---

## [v2.0.0] — 2026-10-21 (Hoàn thành Giai đoạn 6 & 7 — SPCK, Quản trị Giáo trình & Live Log SSE)

### ✨ Tính năng mới (Added)
- **Giai đoạn 6 — Tự động Quét, Nhận xét & Upload SPCK (`/final-project`):**
  - Chuẩn hóa tên tiếng Việt không dấu ([vietnamese-match.ts](./src/lib/utils/vietnamese-match.ts)), chấm điểm tương đồng `matchScore` và cảnh báo trùng tên học viên trong cùng lớp.
  - Quét thư mục dự án cục bộ dưới sự bảo vệ của Path Allowlist, phân loại Thumbnail, tối đa 10 ảnh sản phẩm, 10 file đính kèm, 5 link YouTube và 5 link dự án từ `links.txt`.
  - AI (`gemini-3.5-flash-lite`) sinh nhận xét cuối khóa 3 phần ẩn danh (`STUDENT_01`), chống tự bịa kỹ năng thuyết trình.
  - Đạt kiểm định độc lập `AUDIT-R39` (`41/41 PASS`).
- **Giai đoạn 7 — Quản lý Giáo trình, Barem, Live Log Drawer & Đóng gói (`/syllabus-config`):**
  - Giao diện quản lý Giáo trình đa môn (`PTA/PTB/PTI`, `JSB/JSA/JSI`, `SB/SA/SI`, `GB/GA/GI`, `ROB`, `CSI`), Barem chấm điểm, Quick Tags và Mẫu Zalo.
  - Thanh **Live Automation Log (SSE)** ([live-log-drawer.tsx](./src/components/live-log-drawer.tsx)) hiển thị tiến trình Playwright thời gian thực kèm nút **Dừng khẩn cấp (Stop Bot)**.
  - Bộ script khởi chạy 1 chạm `start-bot.bat` (Windows) và `start-bot.command` (macOS).
  - Đạt kiểm định độc lập `AUDIT-R34` & `AUDIT-R41` (`65/65 PASS`).

---

## [v1.5.0] — 2026-10-20 (Hoàn thành Giai đoạn 3, 4 & 5 — Nhận xét Buổi học, Cào Điểm & Chấm Bài Tập)

### ✨ Tính năng mới (Added)
- **Giai đoạn 3 — Nhận xét sau buổi học & Thông báo Zalo (`/session-comments`):**
  - Đồng bộ danh sách lớp đang dạy (`fetchRunningClasses`) và danh sách buổi học/học viên từ LMS (`syncClass`).
  - Khóa toàn vẹn dữ liệu bằng mã băm `contentHash` (SHA-256) và đối chiếu Read-after-Write sau khi lưu.
- **Giai đoạn 4 — Cào bảng điểm đa trang & Xuất báo cáo (`/homework-grader`):**
  - Tự động duyệt qua các trang điểm trên LMS, phân loại trạng thái bài nộp và xuất file Excel (`.xlsx`) / Copy Google Sheets. Đạt `AUDIT-R18`.
- **Giai đoạn 5 — Tự động Tải & Chấm bài tập đa môn theo Barem (`/homework-grader`):**
  - Bộ đọc file đa định dạng: Python (`.py`), Jupyter (`.ipynb`), Qt Designer (`.ui`, `.qss`), Web (`.html`, `.css`, `.js`), Scratch (`.sb3`), GameMaker (`.yyz`, `.gml`), nén (`.zip`), ảnh/PDF/Word/PPTX.
  - AI chấm từng tiêu chí kèm trích dẫn bằng chứng code (`evidence`), TypeScript tự tính tổng điểm (`sum(earnedPoints)`), gắn cờ `PARSE_ERROR` khi file hỏng và tự động điền điểm lên LMS. Đạt `AUDIT-R31` & `AUDIT-R37`.

---

## [v1.0.0] — 2026-10-19 (Hoàn thành Giai đoạn 0, 1 & 2 — Nền tảng Hệ thống & Lõi Playwright)

### ✨ Tính năng mới (Added)
- Khởi tạo ứng dụng Next.js (App Router + TypeScript + Tailwind CSS) chỉ lắng nghe cục bộ tại `127.0.0.1:3000`.
- Thiết lập cơ sở dữ liệu SQLite (`data/mindx_bot.db` với 8 bảng nghiệp vụ) và kho cấu hình JSON (`data/config/*.json`).
- Xây dựng lõi điều khiển trình duyệt Playwright với `PersistentContext` (`./playwright-auth`), hàng đợi đơn luồng `SequentialTaskQueue`, tự động đăng nhập SSO `id.mindx.edu.vn` và bộ chặn bắt lỗi Network API.
